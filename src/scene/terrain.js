import * as THREE from 'three';

// Lunar ground: one continuous polar mesh centered on the observer.
//   - Base elevation from the real LOLA patch (64 ppd ≈ 475 m/px) for this
//     site, plus the Moon's curvature drop, so distant real relief (the
//     Apennines from Apollo 15, Tycho's terraces) sits at the right bearing
//     and height and the horizon closes at the true ~2.4 km on flat mare.
//   - Near field adds a self-similar crater cascade, boulders and regolith
//     noise, because LOLA's ~475 m sampling carries nothing at human scale.
// Scene units are meters; the observer stands at the origin, eye at +1.7 m.

const MOON_R = 1737400;
const SPOKES = 320;
const RINGS = 320;
const R_MIN = 0.35;
const R_MAX = 65000;
const EYE = 1.7;

// --- hashing ----------------------------------------------------------------
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Deterministic [0,1) from an integer lattice point.
function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// --- value noise fBm --------------------------------------------------------
function valueNoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed) * 2 - 1;
  const b = hash2(ix + 1, iy, seed) * 2 - 1;
  const c = hash2(ix, iy + 1, seed) * 2 - 1;
  const d = hash2(ix + 1, iy + 1, seed) * 2 - 1;
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fbm(x, y, seed, octaves) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

// --- crater cascade ---------------------------------------------------------
// One jittered grid per size class. Craters are self-similar: each class
// covers the same fraction of ground, which is what makes a real regolith
// surface look the same at every zoom level. Classes whose craters would be
// smaller than a pixel at the sampled distance are skipped.
const CLASS_COUNT = 12;
const R0 = 0.45;          // smallest crater radius, meters
const CELL_FACTOR = 3.2;  // grid cell = CELL_FACTOR * radius → ~10% coverage

function craterDetail(x, y, seed, dist) {
  let h = 0;
  let rim = 0;
  for (let c = 0; c < CLASS_COUNT; c++) {
    const R = R0 * Math.pow(2, c);
    // Skip detail too fine to resolve at this distance (~0.5 mrad per pixel).
    if (R < dist * 4e-4) continue;
    if (R > 260) break;
    const cell = R * CELL_FACTOR;
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const cx = gx + ox, cy = gy + oy;
        const s = seed + c * 7919;
        // Small craters saturate the surface; large ones are sparse.
        if (hash2(cx, cy, s) > (c < 4 ? 0.86 : 0.6)) continue;
        const px = (cx + hash2(cx, cy, s + 1)) * cell;
        const py = (cy + hash2(cx, cy, s + 2)) * cell;
        const rad = R * (0.55 + 0.9 * hash2(cx, cy, s + 3));
        const age = hash2(cx, cy, s + 4);          // 0 fresh, 1 degraded
        const depth = rad * (0.055 + 0.16 * (1 - age) ** 1.5);
        const rimH = rad * (0.02 + 0.045 * (1 - age));
        const d = Math.hypot(x - px, y - py);
        const t = d / rad;
        if (t < 1) {
          const b = 1 - t * t;
          h += -depth * b * b + rimH * (1 - b * b);
          rim += (1 - age) * (1 - t) * 0.5;
        } else if (t < 1.8) {
          const f = (1.8 - t) / 0.8;
          h += rimH * f * f;
          rim += (1 - age) * f * f * 0.35;
        }
      }
    }
  }
  return { h, rim };
}

// Scattered boulders: rare, small, and only near the observer.
function boulders(x, y, seed, dist) {
  if (dist > 400) return 0;
  let h = 0;
  for (let c = 0; c < 3; c++) {
    const R = 0.25 * Math.pow(2.4, c);
    if (R < dist * 4e-4) continue;
    const cell = R * 14;
    const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const cx = gx + ox, cy = gy + oy;
        const s = seed + 4441 + c * 313;
        if (hash2(cx, cy, s) > 0.35) continue;
        const px = (cx + hash2(cx, cy, s + 1)) * cell;
        const py = (cy + hash2(cx, cy, s + 2)) * cell;
        const rad = R * (0.6 + 0.8 * hash2(cx, cy, s + 3));
        const d = Math.hypot(x - px, y - py);
        if (d < rad) {
          const b = 1 - (d / rad) ** 2;
          h += rad * 0.75 * Math.sqrt(Math.max(b, 0));
        }
      }
    }
  }
  return h;
}

// --- LOLA patch sampling ----------------------------------------------------
async function loadPatch(siteId) {
  const [meta, bin] = await Promise.all([
    fetch(`/terrain/${siteId}.meta.json`).then((r) => {
      if (!r.ok) throw new Error(`terrain meta ${r.status}`);
      return r.json();
    }),
    fetch(`/terrain/${siteId}.bin`).then((r) => {
      if (!r.ok) throw new Error(`terrain bin ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  const data = new Float32Array(bin);
  const n = meta.n;
  const cosLat = Math.cos(meta.lat * Math.PI / 180);
  return function sampleElev(eastM, northM) {
    const dLat = (northM / MOON_R) * 180 / Math.PI;
    const dLon = (eastM / (MOON_R * cosLat)) * 180 / Math.PI;
    let fx = (dLon + meta.halfLonDeg) / (2 * meta.halfLonDeg) * (n - 1);
    let fy = (meta.halfLatDeg - dLat) / (2 * meta.halfLatDeg) * (n - 1);
    fx = Math.min(Math.max(fx, 0), n - 1.001);
    fy = Math.min(Math.max(fy, 0), n - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const gx = fx - x0, gy = fy - y0;
    const v =
      data[y0 * n + x0] * (1 - gx) * (1 - gy) +
      data[y0 * n + x0 + 1] * gx * (1 - gy) +
      data[(y0 + 1) * n + x0] * (1 - gx) * gy +
      data[(y0 + 1) * n + x0 + 1] * gx * gy;
    return v - meta.centerElevM;
  };
}

export async function createTerrain(site) {
  const sampleElev = await loadPatch(site.id);
  const seed = hashSeed(site.id);
  const noiseSeed = seed ^ 0x9e3779b9;

  // Height and surface character at a point, in scene coords (x east, z south).
  function surfaceAt(x, z) {
    const north = -z;
    const r = Math.hypot(x, north);
    const base = sampleElev(x, north) - (r * r) / (2 * MOON_R);
    // Procedural detail fades out where LOLA takes over.
    const amp = 1 / (1 + (r / 2600) ** 2);
    if (amp < 0.015) return { y: base, rim: 0, rough: 0 };
    const cr = craterDetail(x, north, seed, r);
    const rock = boulders(x, north, seed, r);
    // Regolith roughness across scales. The finest octaves only matter within
    // a few metres of the boots, so they are skipped further out.
    let reg =
      fbm(x / 30, north / 30, noiseSeed + 7, 4) * 0.5 +
      fbm(x / 260, north / 260, noiseSeed + 17, 4) * 3.2;
    if (r < 600) reg += fbm(x / 3.2, north / 3.2, noiseSeed, 3) * 0.075;
    if (r < 60) reg += fbm(x / 0.55, north / 0.55, noiseSeed + 3, 2) * 0.022;
    return { y: base + (cr.h + rock + reg) * amp, rim: cr.rim * amp, rough: reg };
  }

  function heightAt(x, z) {
    return surfaceAt(x, z).y;
  }

  const h0 = heightAt(0, 0);

  const vertCount = (RINGS + 1) * SPOKES + 1;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);

  // Albedo: the site's real normal albedo (mare ~0.08, highlands ~0.18),
  // scaled once into the renderer's diffuse range, with mottling and brighter
  // fresh crater rims.
  const base = site.albedo * 2.2;
  function shade(x, z, s, out, idx) {
    const mottle = 1
      + 0.16 * fbm(x / 55, -z / 55, noiseSeed + 31, 3)
      + 0.08 * fbm(x / 6, -z / 6, noiseSeed + 47, 2)
      + 0.06 * fbm(x / 0.7, -z / 0.7, noiseSeed + 53, 1); // regolith grain
    const a = base * mottle * (1 + Math.min(s.rim, 1) * 0.35);
    out[idx] = a;
    out[idx + 1] = a * 0.982;
    out[idx + 2] = a * 0.947;
  }

  const c0 = surfaceAt(0, 0);
  positions.set([0, 0, 0], 0);
  shade(0, 0, c0, colors, 0);

  for (let k = 0; k <= RINGS; k++) {
    const r = R_MIN * Math.pow(R_MAX / R_MIN, k / RINGS);
    for (let sp = 0; sp < SPOKES; sp++) {
      const th = (sp / SPOKES) * Math.PI * 2;
      const x = r * Math.sin(th);
      const z = -r * Math.cos(th);
      const s = surfaceAt(x, z);
      const idx = (1 + k * SPOKES + sp) * 3;
      positions[idx] = x;
      positions[idx + 1] = s.y - h0;
      positions[idx + 2] = z;
      shade(x, z, s, colors, idx);
    }
  }

  const indices = [];
  for (let sp = 0; sp < SPOKES; sp++) {
    indices.push(0, 1 + ((sp + 1) % SPOKES), 1 + sp);
  }
  for (let k = 0; k < RINGS; k++) {
    for (let sp = 0; sp < SPOKES; sp++) {
      const a = 1 + k * SPOKES + sp;
      const b = 1 + k * SPOKES + ((sp + 1) % SPOKES);
      const c = a + SPOKES;
      const d = b + SPOKES;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  // Regolith BRDF: strongly backscattering, so the surface brightens sharply
  // toward the anti-solar point (the opposition surge / heiligenschein that
  // makes the Apollo photographs glow around the photographer's shadow) and
  // stays flatter across the disc than a Lambertian surface would.
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = { value: new THREE.Vector3(0, 1, 0) };
    mat.userData.shader = shader;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uSunDir;
        varying vec3 vWorldPos;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        {
          vec3 toEye = normalize(cameraPosition - vWorldPos);
          float g = max(dot(toEye, uSunDir), 0.0);      // 1 at opposition
          // ~1.4x at zero phase, matching the measured lunar opposition surge.
          float surge = 1.0 + 0.32 * pow(g, 9.0) + 0.12 * pow(g, 2.0);
          gl_FragColor.rgb *= surge;
        }`);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWorldPos;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
  };

  const mesh = new THREE.Mesh(geom, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;

  // Horizon profile: the terrain's skyline altitude per azimuth, so sky labels
  // hide behind ridges instead of floating in front of them.
  const HB = 360;
  const horizon = new Float32Array(HB);
  for (let b = 0; b < HB; b++) {
    const az = (b / HB) * Math.PI * 2;
    const se = Math.sin(az), cs = Math.cos(az);
    let maxAlt = -Math.PI / 2;
    for (let i = 0; i < 110; i++) {
      const r = 3 * Math.pow(R_MAX / 3, i / 109);
      const h = heightAt(r * se, -r * cs) - h0 - EYE;
      const a = Math.atan2(h, r);
      if (a > maxAlt) maxAlt = a;
    }
    horizon[b] = maxAlt;
  }

  return {
    group: mesh,
    heightAt,
    setSunDir(v) {
      const shader = mat.userData.shader;
      if (shader) shader.uniforms.uSunDir.value.set(v[0], v[1], v[2]);
    },
    /** Skyline altitude (radians) toward an azimuth given in radians. */
    horizonAlt(azRad) {
      const t = (((azRad / (Math.PI * 2)) % 1) + 1) % 1 * HB;
      const i0 = Math.floor(t) % HB;
      const i1 = (i0 + 1) % HB;
      const f = t - Math.floor(t);
      return horizon[i0] * (1 - f) + horizon[i1] * f;
    },
  };
}
