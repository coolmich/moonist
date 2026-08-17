import * as THREE from 'three';
import { SKY_RADIUS } from './starfield.js';

// The five naked-eye planets.
//
// They are drawn as two things at once, because that is what they are. A
// planet is a real disc — Jupiter runs to 50 arcsec, Venus to 66, Saturn's
// rings span 2.27 globe diameters — so at a wide field it is far too small to
// resolve and all you see is the glare a bright point makes in any eye or
// lens, while zoomed in the disc takes over and grows with the magnification,
// as it does in a telescope.
//
// The one law the sizes must obey: zooming in must never make a planet
// smaller. The first cut of this got it wrong twice over — the glare pinned at
// a constant 26 px across the whole zoom range, and then dimmed away at a
// fixed disc-pixel threshold, collapsing a bright blob into a disc a fifth its
// size. So the glare now keeps full strength until the planet's true extent
// has actually grown to rival it (the handoff is keyed on the ratio of the two
// sizes, never on a fixed threshold), and the sprite is always sized by
// whichever of the two is larger.
//
// The disc carries its phase (Venus is a crescent, not a circle), Jupiter its
// two equatorial belts, and Saturn its rings — tilted by the real IAU pole,
// which is what makes the rings open and close over the years.

const TINTS = {
  Mercury: [1.0, 0.93, 0.82],
  Venus: [1.0, 0.98, 0.9],
  Mars: [1.0, 0.62, 0.42],
  Jupiter: [1.0, 0.92, 0.8],
  Saturn: [1.0, 0.88, 0.68],
};

// 0 = plain disc, 1 = belts (Jupiter), 2 = rings (Saturn).
const KINDS = { Mercury: 0, Venus: 0, Mars: 0, Jupiter: 1, Saturn: 2 };

// Per-pixel brightness of the resolved disc. A disc does not inherit the point
// sprite's magnitude-driven intensity — surface brightness follows geometric
// albedo over solar distance squared, which is why Venus' disc is blinding
// white while Jupiter's is soft enough to show its belts. Ratios here are the
// physical ones (Venus:Jupiter:Saturn ≈ 66:1:0.24) sqrt-compressed and
// anchored so Jupiter's night-time disc sits mid-range in the tone curve —
// a display choice: the eye adapts across that 270:1 span, a screen cannot.
const SURF = { Mercury: 1.73, Venus: 2.04, Mars: 0.48, Jupiter: 0.25, Saturn: 0.12 };

// Saturn's A ring outer edge, in globe equatorial radii — the true apparent
// extent of the planet, and what the glare handoff is measured against.
const RING_OUTER = 2.27;

// Glare is a property of the optics, not of the planet, so it is bounded in
// pixels (26 sits just above Sirius' ~25 so Venus outranks every star, per
// their real brightness); but at a wide field it must also stay small on the
// sky or a planet becomes a flying saucer. Both limits apply.
const GLARE_MAX_PX = 26;
const GLARE_MAX_DEG = 1.5;

const VERT = /* glsl */ `
  attribute float aMag;
  attribute vec3 aColor;
  attribute float aSize;       // sprite size in css px
  attribute float aDiscFrac;   // globe diameter as a fraction of the sprite
  attribute float aGlareFrac;  // glare footprint diameter as a fraction of the sprite
  attribute float aTakeover;   // 0 = glare-dominated, 1 = the real disc has taken over
  attribute float aKind;       // 0 plain, 1 belts, 2 rings
  attribute float aSurf;       // resolved-disc surface brightness
  attribute vec2 aPhase;       // (cos, sin) of the phase angle
  attribute vec2 aSunScreen;   // unit vector toward the Sun in sprite coords (y down)
  attribute vec2 aPoleScreen;  // unit vector toward the north pole in sprite coords (y down)
  attribute vec2 aTilt;        // (sin sub-observer lat, sin sub-solar lat)
  uniform float uPixelRatio;
  uniform float uDim;
  varying vec3 vColor;
  varying float vIntensity;
  varying float vBright;
  varying float vDiscFrac;
  varying float vGlareFrac;
  varying float vDiscRadiusPx;
  varying float vTakeover;
  varying float vKind;
  varying float vSurf;
  varying vec2 vPhase;
  varying vec2 vSunScreen;
  varying vec2 vPole;
  varying vec2 vTilt;
  void main() {
    vDiscRadiusPx = aDiscFrac * 0.5 * aSize;
    vIntensity = clamp(0.075 * pow(10.0, -0.25 * (aMag - 2.0)), 0.004, 4.0) * uDim;
    vBright = 1.0 - step(-1.0, aMag); // glare cross for Venus/Jupiter class
    vColor = aColor;
    vDiscFrac = aDiscFrac;
    vGlareFrac = aGlareFrac;
    vTakeover = aTakeover;
    vKind = aKind;
    vSurf = aSurf * uDim;
    vPhase = aPhase;
    vSunScreen = aSunScreen;
    vPole = aPoleScreen;
    vTilt = aTilt;
    gl_PointSize = aSize * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vIntensity;
  varying float vBright;
  varying float vDiscFrac;
  varying float vGlareFrac;
  varying float vDiscRadiusPx;
  varying float vTakeover;
  varying float vKind;
  varying float vSurf;
  varying vec2 vPhase;
  varying vec2 vSunScreen;
  varying vec2 vPole;
  varying vec2 vTilt;

  float band(float x, float lo, float hi, float e) {
    return smoothstep(lo - e, lo + e, x) * (1.0 - smoothstep(hi - e, hi + e, x));
  }

  void main() {
    // Sprite coordinates. gl_PointCoord runs y downward and the screen-space
    // attributes are given in the same convention, so they compare directly —
    // verified by painting the sunward half of the disc and looking, because
    // getting this backwards lights the wrong limb and a crescent facing away
    // from the Sun is a thing no one would notice in a screenshot of a tiny dot.
    vec2 p = gl_PointCoord - 0.5;
    vec3 tint = pow(vColor, vec3(1.4));

    // Glare, normalized to its own footprint. It carries the whole planet
    // while the disc is unresolved, and eases back to a bloom as the real
    // extent takes over — never a cliff, or the planet visibly shrinks.
    float glareR = max(vGlareFrac * 0.5, 1e-4);
    vec2 pg = p / glareR;
    float g = exp(-dot(pg, pg) * 5.0);
    if (vBright > 0.5) {
      // The spikes say "this is a brilliant point". Once there is a disc they
      // are just something drawn over it, so they go as the disc arrives.
      g += (exp(-abs(pg.x) * 3.0) * exp(-pg.y * pg.y * 125.0)
          + exp(-abs(pg.y) * 3.0) * exp(-pg.x * pg.x * 125.0)) * 0.3 * (1.0 - vTakeover);
    }
    vec3 col = tint * vIntensity * g * mix(1.0, 0.2, vTakeover);

    // The disc, lit by the Sun. A point on it at (x, y) in globe radii stands
    // at z = sqrt(1 - x² - y²) toward us; the Sun's direction in that frame is
    // (screen direction × sin(phase), cos(phase)). Lit where they face.
    float gr = max(vDiscFrac * 0.5, 1e-5);
    vec2 u = p / gr;
    float rg = length(u);
    // One pixel, in globe radii — softening widths live in this unit. Using
    // the sprite-space radius here instead smears the terminator across the
    // whole disc, which looks like the phase is wrong.
    float px = 1.0 / max(vDiscRadiusPx, 1.5);
    // Under ~2 px there is no disc worth drawing, only a hard little square.
    float discOn = smoothstep(0.6, 1.2, vDiscRadiusPx);
    bool rings = vKind > 1.5;

    if (discOn > 0.001 && (rg < 1.0 + px || rings)) {
      float z = sqrt(max(1.0 - dot(u, u), 0.0));
      vec3 sunDir = vec3(vSunScreen * vPhase.y, vPhase.x);
      float day = smoothstep(-px, px, dot(vec3(u, z), sunDir));
      float edge = 1.0 - smoothstep(1.0 - px, 1.0 + px, rg);
      float limb = 0.6 + 0.4 * z; // gentle limb darkening
      vec3 discCol = tint * day * limb;

      float sinBo = vTilt.x;
      float cosBo = sqrt(max(1.0 - sinBo * sinBo, 0.0));
      if (vKind > 0.5 && !rings) {
        // Jupiter's two equatorial belts (NEB/SEB, ~7°–19° either side),
        // banded by true planetocentric latitude: the pole direction in the
        // sprite frame is the screen pole tipped toward us by the
        // sub-observer latitude. Illustrative shading, not imagery.
        vec3 pole3 = vec3(vPole * cosBo, sinBo);
        float slat = dot(vec3(u, z), pole3);
        float eb = max(px * 1.5, 0.025);
        discCol *= 1.0 - 0.22 * band(abs(slat), 0.11, 0.33, eb)
                       - 0.10 * smoothstep(0.72, 0.85, abs(slat));
      }

      vec3 obj = discCol * edge;
      if (rings) {
        // Saturn's rings: circles in the equator plane, seen as ellipses
        // foreshortened by the opening angle B (= sub-observer latitude). The
        // major axis is perpendicular to the projected pole. Zone radii are
        // the real ones in globe radii: C 1.24–1.53, B 1.53–1.95, Cassini
        // division, A 2.03–2.27.
        vec2 maj = vec2(-vPole.y, vPole.x);
        float a = dot(u, maj);
        float b = dot(u, vPole);
        float sB = max(abs(sinBo), 2e-3);
        float rr = sqrt(a * a + (b * b) / (sB * sB));
        float e = max(fwidth(rr) * 0.75, px);
        float opac = 0.25 * band(rr, 1.24, 1.53, e)
                   + 1.00 * band(rr, 1.53, 1.95, e)
                   + 0.06 * band(rr, 1.95, 2.03, e)
                   + 0.70 * band(rr, 2.03, 2.27, e);
        // Ring brightness tracks how steeply sunlight strikes the ring plane;
        // when observer and Sun sit on opposite sides we see the unlit face,
        // nearly dark. The small floors are a display choice so a ring seen
        // near a plane crossing reads as a hairline rather than vanishing.
        float sinBs = vTilt.y;
        float lit = step(0.0, sinBo * sinBs);
        float ringLight = mix(0.05, max(0.09, min(abs(sinBs) / 0.26, 1.0)), lit);
        // The near arm crosses in front of the globe on the side away from
        // the visible pole; the far arm hides behind it. (Globe shadow on the
        // rings and ring shadow on the globe are not modeled.)
        float front = step(0.0, -b * sign(sinBo));
        float visible = max(1.0 - edge, front);
        obj = discCol * edge * (1.0 - opac * front)
            + vec3(1.0, 0.96, 0.88) * opac * ringLight * visible;
      }

      col += obj * vSurf * discOn;
    }

    if (max(max(col.r, col.g), col.b) < 1e-5) discard;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createPlanets(pixelRatio) {
  const names = Object.keys(TINTS);
  const n = names.length;
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(n * 3);
  const mags = new Float32Array(n);
  const colors = new Float32Array(n * 3);
  const sizes = new Float32Array(n).fill(2);
  const discFrac = new Float32Array(n);
  const glareFrac = new Float32Array(n).fill(1);
  const takeover = new Float32Array(n);
  const kinds = new Float32Array(n);
  const phase = new Float32Array(n * 2);
  const sunScreen = new Float32Array(n * 2).fill(0);
  const poleScreen = new Float32Array(n * 2).fill(0);
  const tilt = new Float32Array(n * 2).fill(0);
  const surf = new Float32Array(n);
  names.forEach((name, i) => {
    colors.set(TINTS[name], i * 3);
    kinds[i] = KINDS[name];
    surf[i] = SURF[name];
  });
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aMag', new THREE.BufferAttribute(mags, 1));
  geom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geom.setAttribute('aDiscFrac', new THREE.BufferAttribute(discFrac, 1));
  geom.setAttribute('aGlareFrac', new THREE.BufferAttribute(glareFrac, 1));
  geom.setAttribute('aTakeover', new THREE.BufferAttribute(takeover, 1));
  geom.setAttribute('aKind', new THREE.BufferAttribute(kinds, 1));
  geom.setAttribute('aSurf', new THREE.BufferAttribute(surf, 1));
  geom.setAttribute('aPhase', new THREE.BufferAttribute(phase, 2));
  geom.setAttribute('aSunScreen', new THREE.BufferAttribute(sunScreen, 2));
  geom.setAttribute('aPoleScreen', new THREE.BufferAttribute(poleScreen, 2));
  geom.setAttribute('aTilt', new THREE.BufferAttribute(tilt, 2));

  const uniforms = {
    uPixelRatio: { value: pixelRatio ?? 1 },
    uDim: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  points.renderOrder = 2;

  /** Latest per-planet screen size, so the label layer can clear the disc. */
  const sizePx = new Map();
  let latest = [];

  return {
    group: points,
    update(planetStates) {
      latest = planetStates;
      for (const p of planetStates) {
        const i = names.indexOf(p.name);
        if (i === -1) continue;
        positions.set([
          p.sceneDir[0] * SKY_RADIUS,
          p.sceneDir[1] * SKY_RADIUS,
          p.sceneDir[2] * SKY_RADIUS,
        ], i * 3);
        mags[i] = p.mag;
        const ph = (p.phaseAngleDeg ?? 0) * Math.PI / 180;
        phase.set([Math.cos(ph), Math.sin(ph)], i * 2);
        tilt.set([
          Math.sin((p.subObsLatDeg ?? 0) * Math.PI / 180),
          Math.sin((p.subSunLatDeg ?? 0) * Math.PI / 180),
        ], i * 2);
      }
      geom.attributes.position.needsUpdate = true;
      geom.attributes.aMag.needsUpdate = true;
      geom.attributes.aPhase.needsUpdate = true;
      geom.attributes.aTilt.needsUpdate = true;
    },
    /**
     * Screen-space directions from each planet toward the Sun (so the
     * terminator faces it) and toward its north pole (so the rings and belts
     * tilt the right way). The camera's own axes are the only reliable way to
     * ask: taking the difference of two projected points collapses when the
     * target is near the planet on the sky, which is exactly when a crescent
     * is worth drawing. `right`/`up` are the camera's world axes; results are
     * in sprite coordinates, y downward.
     */
    setScreenDirs(sunSceneDir, right, up) {
      const toScreen = (d, target) => {
        // Tangent at the planet's place on the sky, pointing at the target.
        const k = d[0] * target[0] + d[1] * target[1] + d[2] * target[2];
        const t = [target[0] - d[0] * k, target[1] - d[1] * k, target[2] - d[2] * k];
        const len = Math.hypot(t[0], t[1], t[2]) || 1;
        const sx = (t[0] * right[0] + t[1] * right[1] + t[2] * right[2]) / len;
        const sy = -(t[0] * up[0] + t[1] * up[1] + t[2] * up[2]) / len;
        const m = Math.hypot(sx, sy) || 1;
        return [sx / m, sy / m];
      };
      for (const p of latest) {
        const i = names.indexOf(p.name);
        if (i === -1) continue;
        sunScreen.set(toScreen(p.sceneDir, sunSceneDir), i * 2);
        if (p.poleSceneDir) poleScreen.set(toScreen(p.sceneDir, p.poleSceneDir), i * 2);
      }
      geom.attributes.aSunScreen.needsUpdate = true;
      geom.attributes.aPoleScreen.needsUpdate = true;
    },
    setDim(v) {
      uniforms.uDim.value = v;
    },
    updateApparentSizes(fovDeg, heightPx) {
      const pxPerRad = heightPx / (2 * Math.tan(fovDeg * Math.PI / 360));
      const zoom = THREE.MathUtils.clamp(pxPerRad / 565, 0.85, 4.0);
      const glareCap = Math.min(GLARE_MAX_PX, GLARE_MAX_DEG * pxPerRad * Math.PI / 180);
      for (const p of latest) {
        const i = names.indexOf(p.name);
        if (i === -1) continue;
        const glare = THREE.MathUtils.clamp(11 * Math.pow(0.76, p.mag) * zoom, 1.8, glareCap);
        const disc = 2 * (p.angRadiusDeg ?? 0) * (Math.PI / 180) * pxPerRad;
        const extent = p.name === 'Saturn' ? disc * RING_OUTER : disc;
        // The handoff from glare to the real thing is keyed on their size
        // ratio, so the visible object can only grow through it; the glare
        // footprint spans whichever is larger, ending as a bloom around the
        // disc rather than vanishing. The window starts late (0.55) because
        // fading the amplitude visibly shrinks the halo — measured as a
        // 22 px → 18 px dip on Saturn when it began at 0.3 — so the fade must
        // not lead the disc by much.
        const t = THREE.MathUtils.smoothstep(extent / glare, 0.55, 1.3);
        const glareFoot = Math.max(glare, extent);
        const size = Math.max(glareFoot * 1.05, extent * 1.12, 1.8);
        sizes[i] = size;
        discFrac[i] = disc / size;
        glareFrac[i] = glareFoot / size;
        takeover[i] = t;
        sizePx.set(p.name, size);
      }
      geom.attributes.aSize.needsUpdate = true;
      geom.attributes.aDiscFrac.needsUpdate = true;
      geom.attributes.aGlareFrac.needsUpdate = true;
      geom.attributes.aTakeover.needsUpdate = true;
    },
    /** Screen size in css px, for the label layer's clearance around the disc. */
    sizePxOf(name) {
      return sizePx.get(name) ?? 4;
    },
  };
}
