import * as THREE from 'three';

// Star dome: 5044 Hipparcos stars (mag ≤ 6) + constellation figures.
// All geometry is built in EQJ (J2000 equatorial) coordinates; the whole
// group is rotated to the local horizon frame each frame via the astro core's
// eqjToScene matrix. Stars do not twinkle — there is no atmosphere here.
//
// Labels are NOT rendered here: they live in the screen-space label layer
// (labels2d.js). This module exposes the label data (named stars,
// constellation anchors) for the app to feed that layer.

export const SKY_RADIUS = 900000;

const STAR_VERT = /* glsl */ `
  attribute float aMag;
  attribute vec3 aColor;
  uniform float uZoom;       // apparent-size zoom factor (1 at default FOV)
  uniform float uPixelRatio;
  uniform float uDim;
  varying vec3 vColor;
  varying float vIntensity;
  varying float vSharp;
  varying float vSpike;
  void main() {
    // Magnitude → apparent radius: wide non-linear curve so the brightness
    // hierarchy survives (Sirius ~20 css px, mag 6 ~2 css px at 65° FOV;
    // the visible gaussian disc is ~0.85x the point-sprite size).
    float sizeCss = clamp(13.0 * pow(0.74, aMag) * uZoom, 1.3, 46.0);
    vSpike = 1.0 - step(1.0, aMag); // diffraction spikes for mag < 1
    vSharp = mix(1.0, 3.4, vSpike);
    if (vSpike > 0.5) sizeCss *= 1.85;
    vIntensity = clamp(pow(10.0, -0.25 * (aMag - 3.0)), 0.12, 1.0) * uDim;
    vColor = aColor;
    gl_PointSize = sizeCss * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const STAR_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vIntensity;
  varying float vSharp;
  varying float vSpike;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float r2 = dot(p, p);
    // Gaussian point-spread core (sharpened when the point is enlarged to
    // make room for spikes).
    float g = exp(-r2 * 18.0 * vSharp);
    if (vSpike > 0.5) {
      // Arms span the whole point sprite (gl_PointCoord is [-0.5, 0.5] —
      // decay constants must be O(5), not O(25), or the arms die within 1px).
      g += (exp(-abs(p.x) * 5.5) * exp(-p.y * p.y * 500.0)
          + exp(-abs(p.y) * 5.5) * exp(-p.x * p.x * 500.0)) * 0.35;
    }
    if (g < 0.004) discard;
    // Saturation boost: the clipped-white core washes tint out, so the halo
    // carries the star's color (Betelgeuse orange vs Rigel blue).
    vec3 tint = pow(vColor, vec3(1.7));
    gl_FragColor = vec4(tint * vIntensity * g, 1.0);
  }
`;

// B-V color index → RGB via Ballesteros temperature + blackbody fit.
function bvToRgb(bv) {
  const t = 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
  const x = Math.min(Math.max(t, 1500), 15000) / 100;
  let r, g, b;
  if (x <= 66) {
    r = 255;
    g = Math.min(Math.max(99.47 * Math.log(x) - 161.12, 0), 255);
    b = x <= 19 ? 0 : Math.min(Math.max(138.52 * Math.log(x - 10) - 305.04, 0), 255);
  } else {
    r = Math.min(Math.max(329.7 * Math.pow(x - 60, -0.1332), 0), 255);
    g = Math.min(Math.max(288.12 * Math.pow(x - 60, -0.0755), 0), 255);
    b = 255;
  }
  return [r / 255, g / 255, b / 255];
}

// GeoJSON [lon, lat] (lon = RA remapped to -180..180) → EQJ unit vector.
function coordToVec(lon, lat, radius) {
  const ra = (lon < 0 ? lon + 360 : lon) * Math.PI / 180;
  const dec = lat * Math.PI / 180;
  return new THREE.Vector3(
    radius * Math.cos(dec) * Math.cos(ra),
    radius * Math.cos(dec) * Math.sin(ra),
    radius * Math.sin(dec),
  );
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function createStarfield(pixelRatio) {
  const [stars, lines, consts, starNames] = await Promise.all([
    fetchJson('/data/stars.6.json'),
    fetchJson('/data/constellations.lines.json'),
    fetchJson('/data/constellations.json'),
    fetchJson('/data/starnames.min.json'),
  ]);

  const group = new THREE.Group();
  group.matrixAutoUpdate = false;

  // --- Stars ---------------------------------------------------------------
  const n = stars.features.length;
  const positions = new Float32Array(n * 3);
  const mags = new Float32Array(n);
  const colors = new Float32Array(n * 3);
  const starById = new Map();
  stars.features.forEach((f, i) => {
    const [lon, lat] = f.geometry.coordinates;
    const v = coordToVec(lon, lat, SKY_RADIUS);
    positions.set([v.x, v.y, v.z], i * 3);
    mags[i] = f.properties.mag;
    const bv = parseFloat(f.properties.bv);
    colors.set(bvToRgb(Number.isFinite(bv) ? bv : 0.6), i * 3);
    starById.set(f.id, { v, mag: f.properties.mag });
  });

  const starGeom = new THREE.BufferGeometry();
  starGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  starGeom.setAttribute('aMag', new THREE.BufferAttribute(mags, 1));
  starGeom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const starUniforms = {
    uZoom: { value: 1 },
    uPixelRatio: { value: pixelRatio ?? 1 },
    uDim: { value: 1 },
  };
  const starMat = new THREE.ShaderMaterial({
    uniforms: starUniforms,
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const points = new THREE.Points(starGeom, starMat);
  points.frustumCulled = false;
  points.renderOrder = 2; // stars draw over constellation lines, not under
  group.add(points);

  // --- Constellation lines ---------------------------------------------------
  const lineVerts = [];
  const lineRadius = SKY_RADIUS * 0.995;
  for (const f of lines.features) {
    for (const line of f.geometry.coordinates) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = coordToVec(line[i][0], line[i][1], 1);
        const b = coordToVec(line[i + 1][0], line[i + 1][1], 1);
        // Subdivide long chords so they follow the great circle.
        const ang = a.angleTo(b);
        const steps = Math.max(1, Math.ceil(ang / (3 * Math.PI / 180)));
        let prev = a;
        for (let s = 1; s <= steps; s++) {
          const p = a.clone().lerp(b, s / steps).normalize();
          lineVerts.push(
            prev.x * lineRadius, prev.y * lineRadius, prev.z * lineRadius,
            p.x * lineRadius, p.y * lineRadius, p.z * lineRadius,
          );
          prev = p;
        }
      }
    }
  }
  const lineGeom = new THREE.BufferGeometry();
  lineGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lineVerts), 3));
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x5b7fa3,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
  });
  const constLines = new THREE.LineSegments(lineGeom, lineMat);
  constLines.frustumCulled = false;
  constLines.renderOrder = 1;
  group.add(constLines);

  // --- Label data (rendered by the screen-space layer) -------------------------
  // Named stars, brightest first, minus overprints (e.g. the α Cen pair are
  // 0.008° apart — keep only the brighter name).
  const labeled = Object.entries(starNames)
    .map(([hip, name]) => ({ name, hip, s: starById.get(Number(hip)) }))
    .filter((e) => e.s)
    .sort((a, b) => a.s.mag - b.s.mag);
  const MIN_SEP = Math.cos(0.2 * Math.PI / 180);
  const keptDirs = [];
  const seenNames = new Set();
  const namedStars = [];
  for (const e of labeled) {
    const dir = e.s.v.clone().normalize();
    if (keptDirs.some((k) => k.dot(dir) > MIN_SEP)) continue;
    // Some traditional names are attached to two stars (e.g. Atik on both
    // ο and ζ Persei) — keep only the brighter bearer.
    if (seenNames.has(e.name)) continue;
    keptDirs.push(dir);
    seenNames.add(e.name);
    namedStars.push({ id: `hip${e.hip}`, name: e.name, mag: e.s.mag, vEqj: [dir.x, dir.y, dir.z] });
  }

  const constellations = consts.features.map((f) => {
    const a = coordToVec(f.geometry.coordinates[0], f.geometry.coordinates[1], 1);
    return {
      id: f.id + (f.properties.name.includes('Cauda') ? '2' : ''),
      name: f.properties.name,
      rank: Number(f.properties.rank) || 3,
      anchorEqj: [a.x, a.y, a.z],
    };
  });

  let visible = { constellations: true };

  return {
    group,
    namedStars,
    constellations,
    get constellationsVisible() {
      return visible.constellations;
    },
    setOrientation(eqjToScene) {
      // eqjToScene rows map EQJ→scene; star coords are EQJ, world is scene.
      const m = eqjToScene;
      group.matrix.set(
        m[0], m[1], m[2], 0,
        m[3], m[4], m[5], 0,
        m[6], m[7], m[8], 0,
        0, 0, 0, 1,
      );
    },
    setDim(v) {
      starUniforms.uDim.value = v;
      lineMat.opacity = 0.6 * Math.min(1, v * 1.15);
    },
    showConstellations(v) {
      visible.constellations = v;
      constLines.visible = v;
    },
    updateApparentSizes(fovDeg, heightPx) {
      const pxPerRad = heightPx / (2 * Math.tan(fovDeg * Math.PI / 360));
      starUniforms.uZoom.value = THREE.MathUtils.clamp(pxPerRad / 565, 0.85, 4.0);
    },
  };
}

// Continuous star-name magnitude cut: more names as you zoom in.
export function starNameMagCut(fovDeg) {
  const t = Math.log(100 / THREE.MathUtils.clamp(fovDeg, 4, 100)) / Math.log(100 / 4);
  return 1.2 + 5.3 * t;
}
