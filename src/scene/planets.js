import * as THREE from 'three';
import { SKY_RADIUS } from './starfield.js';

// The five naked-eye planets.
//
// They are drawn as two things at once, because that is what they are. A
// planet is a real disc — Jupiter runs to 50 arcsec, Venus to 66 — so at a wide
// field it is far too small to resolve and all you see is the glare a bright
// point makes in any eye or lens, while zoomed in past about a degree the disc
// takes over and grows with the magnification, as it does in a telescope.
// Drawing only the glare made every planet the same 16 px blob at every zoom,
// which is what it looked like: a bug.
//
// The disc carries its phase. Venus can be a 36%-lit crescent, and drawing it
// as a full circle once it is resolved would swap one wrong picture for another.

const TINTS = {
  Mercury: [1.0, 0.93, 0.82],
  Venus: [1.0, 0.98, 0.9],
  Mars: [1.0, 0.62, 0.42],
  Jupiter: [1.0, 0.92, 0.8],
  Saturn: [1.0, 0.88, 0.68],
};

// Glare is a property of the optics, not of the planet, so it is bounded in
// pixels; but at a wide field it must also stay small on the sky or a planet
// becomes a flying saucer. Both limits apply.
const GLARE_MAX_PX = 26;
const GLARE_MAX_DEG = 1.5;

const VERT = /* glsl */ `
  attribute float aMag;
  attribute vec3 aColor;
  attribute float aSize;       // sprite size in css px
  attribute float aDiscFrac;   // disc diameter as a fraction of the sprite
  attribute float aResolved;   // 0 = a point with glare, 1 = a disc worth drawing
  attribute vec2 aPhase;       // (cos, sin) of the phase angle
  attribute vec2 aSunScreen;   // unit vector toward the Sun in sprite coords (y down)
  uniform float uPixelRatio;
  uniform float uDim;
  varying vec3 vColor;
  varying float vIntensity;
  varying float vBright;
  varying float vDiscFrac;
  varying float vDiscRadiusPx;
  varying float vResolved;
  varying vec2 vPhase;
  varying vec2 vSunScreen;
  void main() {
    vDiscRadiusPx = aDiscFrac * 0.5 * aSize;
    vIntensity = clamp(0.075 * pow(10.0, -0.25 * (aMag - 2.0)), 0.004, 4.0) * uDim;
    vBright = 1.0 - step(-1.0, aMag); // glare cross for Venus/Jupiter class
    vColor = aColor;
    vDiscFrac = aDiscFrac;
    vResolved = aResolved;
    vPhase = aPhase;
    vSunScreen = aSunScreen;
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
  varying float vDiscRadiusPx;
  varying float vResolved;
  varying vec2 vPhase;
  varying vec2 vSunScreen;
  void main() {
    // Sprite coordinates. gl_PointCoord runs y downward and aSunScreen is given
    // in the same convention, so they compare directly — verified by painting
    // the sunward half of the disc and looking, because getting this backwards
    // lights the wrong limb and a crescent facing away from the Sun is a thing
    // no one would notice in a screenshot of a tiny dot.
    vec2 p = gl_PointCoord - 0.5;
    vec2 q = p;
    float r = length(q);

    // Glare. It carries the whole planet while the disc is unresolved, and
    // drops back to a bloom around the disc once there is a disc to see.
    float g = exp(-dot(p, p) * mix(24.0, 60.0, vBright));
    if (vBright > 0.5) {
      // The spikes say "this is a brilliant point". Once there is a disc they
      // are just something drawn over it, so they go as the disc arrives.
      g += (exp(-abs(p.x) * 6.0) * exp(-p.y * p.y * 500.0)
          + exp(-abs(p.y) * 6.0) * exp(-p.x * p.x * 500.0)) * 0.3 * (1.0 - vResolved);
    }
    vec3 col = pow(vColor, vec3(1.4)) * vIntensity * g * mix(1.0, 0.09, vResolved);

    // The disc, lit by the Sun. A point on it at (x, y) in disc radii stands at
    // z = sqrt(1 - x² - y²) toward us; the Sun's direction in that frame is
    // (screen direction × sin(phase), cos(phase)). Lit where they face.
    float rad = max(vDiscFrac * 0.5, 1e-5);
    if (vResolved > 0.001 && r < rad) {
      vec2 u = q / rad;
      float z = sqrt(max(1.0 - dot(u, u), 0.0));
      vec3 sunDir = vec3(vSunScreen * vPhase.y, vPhase.x);
      float lambert = dot(vec3(u, z), sunDir);
      // Soften the terminator and the limb by one pixel — expressed in disc
      // radii, which means dividing by the disc's radius IN PIXELS. Using the
      // sprite-space radius here instead smears the terminator across the whole
      // disc and fades the limb away, which looks like the phase is wrong.
      float px = 1.0 / max(vDiscRadiusPx, 1.5);
      float day = smoothstep(-px, px, lambert);
      float edge = 1.0 - smoothstep(1.0 - px * 1.5, 1.0, r / rad);
      col += pow(vColor, vec3(1.4)) * vIntensity * day * edge * vResolved;
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
  const resolved = new Float32Array(n);
  const phase = new Float32Array(n * 2);
  const sunScreen = new Float32Array(n * 2).fill(0);
  names.forEach((name, i) => colors.set(TINTS[name], i * 3));
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aMag', new THREE.BufferAttribute(mags, 1));
  geom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geom.setAttribute('aDiscFrac', new THREE.BufferAttribute(discFrac, 1));
  geom.setAttribute('aResolved', new THREE.BufferAttribute(resolved, 1));
  geom.setAttribute('aPhase', new THREE.BufferAttribute(phase, 2));
  geom.setAttribute('aSunScreen', new THREE.BufferAttribute(sunScreen, 2));

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

  /** Latest per-planet screen size, so the label layer's ring can match. */
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
      }
      geom.attributes.position.needsUpdate = true;
      geom.attributes.aMag.needsUpdate = true;
      geom.attributes.aPhase.needsUpdate = true;
    },
    /**
     * Which way the Sun lies on screen from each planet, so the terminator can
     * face it. The camera's own axes are the only reliable way to ask: taking
     * the difference of two projected points collapses when the Sun is near the
     * planet on the sky, which is exactly when a crescent is worth drawing.
     * `right`/`up` are the camera's world axes; the result is in sprite
     * coordinates, y downward.
     */
    setSunScreenDir(sunSceneDir, right, up) {
      for (const p of latest) {
        const i = names.indexOf(p.name);
        if (i === -1) continue;
        // Tangent at the planet's place on the sky, pointing at the Sun.
        const d = p.sceneDir;
        const k = d[0] * sunSceneDir[0] + d[1] * sunSceneDir[1] + d[2] * sunSceneDir[2];
        const t = [
          sunSceneDir[0] - d[0] * k,
          sunSceneDir[1] - d[1] * k,
          sunSceneDir[2] - d[2] * k,
        ];
        const len = Math.hypot(t[0], t[1], t[2]) || 1;
        const sx = (t[0] * right[0] + t[1] * right[1] + t[2] * right[2]) / len;
        const sy = -(t[0] * up[0] + t[1] * up[1] + t[2] * up[2]) / len;
        const m = Math.hypot(sx, sy) || 1;
        sunScreen.set([sx / m, sy / m], i * 2);
      }
      geom.attributes.aSunScreen.needsUpdate = true;
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
        const size = Math.max(glare, disc * 1.25);
        sizes[i] = size;
        discFrac[i] = disc / size;
        // Under ~2 px there is no disc to speak of and drawing one only makes a
        // hard little square; hand it back to the glare.
        resolved[i] = THREE.MathUtils.smoothstep(disc, 1.8, 4.5);
        sizePx.set(p.name, size);
      }
      geom.attributes.aSize.needsUpdate = true;
      geom.attributes.aDiscFrac.needsUpdate = true;
      geom.attributes.aResolved.needsUpdate = true;
    },
    /** Screen size in css px, for the label layer's identification ring. */
    sizePxOf(name) {
      return sizePx.get(name) ?? 4;
    },
  };
}
