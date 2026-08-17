// The shape of the ground: pure maths, no renderer and no network, so the
// tests can exercise exactly what the renderer draws.
//
// Two sources are combined:
//   * the real LOLA patch for this site (64 px/deg ≈ 475 m), which owns
//     everything from a few hundred metres out to the horizon, and
//   * procedural detail below LOLA's resolution.
//
// The procedural part is deliberately kept small. It has to add texture
// without inventing landscape: if it grows past about a metre of relief per
// hundred metres of distance it starts forming its own false horizon, which
// hides the real one (a 1.7 m eye sees 2.4 km on flat mare) and buries real
// mountains behind phantom ridges.

export const MOON_R = 1737400;
export const EYE = 1.7;

// Procedural budget. Coarse features fade in with distance so the observer is
// never standing inside a fabricated crater, while fine detail stays underfoot.
const R0 = 0.45;              // smallest crater radius, metres
const CLASS_COUNT = 9;        // up to R0 * 2^8 ≈ 115 m radius
const COARSE_FROM = 6;        // crater radius (m) above which a class is "coarse"
const CELL_FACTOR = 3.4;
const FBM_MID_M = 0.30;       // amplitude of the 30 m undulation
const FBM_FAR_M = 0.85;       // amplitude of the 260 m undulation
const NEAR_FLAT_R = 14;       // metres of locally undisturbed ground underfoot
const NEAR_FLAT_BLEND = 55;   // ...blending to full coarse detail by this range
// Ring spacing of the renderer's polar mesh as a fraction of distance; the
// smallest feature it can hold at range r is about r * this.
const MESH_CELL = 0.035;

function hash2(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

// Every lattice here is square and axis-aligned, and the scene's axes are due
// east and due south. Stack a few of them and the eye finds the rows: real
// regolith has no preferred direction, so each octave and each crater class is
// turned by an angle that is not a fraction of a right angle, which leaves the
// statistics alone and destroys the alignment.
const LATTICE_TURN = 0.6981317; // 40°, so classes cycle 40/80/120... never 90
function turn(x, y, k) {
  const a = k * LATTICE_TURN;
  const c = Math.cos(a), s = Math.sin(a);
  return [x * c - y * s, x * s + y * c];
}

export function fbm(x, y, seed, octaves) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  let px = x, py = y;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(px * freq, py * freq, seed + o * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
    [px, py] = turn(px, py, 1);
  }
  return sum / norm;
}

// Crater cascade: one jittered grid per size class. Large classes are sparse
// (big craters are rare), small ones nearly saturate the ground.
function craters(x, y, seed, dist, coarseWeight) {
  let h = 0;
  let rim = 0;
  for (let c = 0; c < CLASS_COUNT; c++) {
    const R = R0 * Math.pow(2, c);
    // Band-limit to what the mesh can actually carry. The ground is a polar
    // grid whose cells grow with distance (~0.038 r), so a crater smaller than
    // a cell out there is not drawn small — it is sampled once per quad, and
    // the mesh's own regularity becomes a lattice of identical dimples marching
    // across the surface. Below this size the per-fragment grain takes over.
    if (R < dist * MESH_CELL) continue;
    const coarse = R >= COARSE_FROM;
    const w = coarse ? coarseWeight : 1;
    if (w < 0.01) continue;
    // Small craters saturate the ground; big ones are rare, and rarer still
    // because anything much larger starts to be carried by the LOLA data.
    const density = R < 2 ? 0.82 : R < 8 ? 0.55 : R < 24 ? 0.3 : R < 60 ? 0.16 : 0.09;
    const cell = R * CELL_FACTOR;
    // Each class gets its own lattice orientation. Cell sizes are exact powers
    // of two of each other, so without this the classes nest and their craters
    // fall into shared rows running due east and due south.
    const [rx, ry] = turn(x, y, c);
    const gx = Math.floor(rx / cell), gy = Math.floor(ry / cell);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const cx = gx + ox, cy = gy + oy;
        const s = seed + c * 7919;
        if (hash2(cx, cy, s) > density) continue;
        const px = (cx + hash2(cx, cy, s + 1)) * cell;
        const py = (cy + hash2(cx, cy, s + 2)) * cell;
        const rad = R * (0.55 + 0.9 * hash2(cx, cy, s + 3));
        const age = hash2(cx, cy, s + 4);        // 0 fresh, 1 degraded
        const depth = rad * (0.04 + 0.12 * (1 - age) ** 1.5);
        const rimH = rad * (0.012 + 0.03 * (1 - age));
        // Rotation preserves distance, so the crater is still round in world
        // space; only where its centre falls has changed.
        const d = Math.hypot(rx - px, ry - py);
        const t = d / rad;
        if (t < 1) {
          const b = 1 - t * t;
          h += (-depth * b * b + rimH * (1 - b * b)) * w;
          rim += (1 - age) * (1 - t) * 0.5 * w;
        } else if (t < 1.8) {
          const f = (1.8 - t) / 0.8;
          h += rimH * f * f * w;
          rim += (1 - age) * f * f * 0.35 * w;
        }
      }
    }
  }
  return { h, rim };
}

// Sparse boulders, close in only.
function boulders(x, y, seed, dist) {
  if (dist > 300) return 0;
  let h = 0;
  for (let c = 0; c < 3; c++) {
    const R = 0.22 * Math.pow(2.4, c);
    if (R < dist * MESH_CELL) continue;          // as for craters: mesh-limited
    const cell = R * 16;
    const [rx, ry] = turn(x, y, c + 0.5);
    const gx = Math.floor(rx / cell), gy = Math.floor(ry / cell);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const cx = gx + ox, cy = gy + oy;
        const s = seed + 4441 + c * 313;
        if (hash2(cx, cy, s) > 0.3) continue;
        const px = (cx + hash2(cx, cy, s + 1)) * cell;
        const py = (cy + hash2(cx, cy, s + 2)) * cell;
        const rad = R * (0.6 + 0.8 * hash2(cx, cy, s + 3));
        const d = Math.hypot(rx - px, ry - py);
        if (d < rad) h += rad * 0.7 * Math.sqrt(Math.max(1 - (d / rad) ** 2, 0));
      }
    }
  }
  return h;
}

/**
 * Build the surface functions for a site.
 * @param {object} meta   the patch meta.json
 * @param {Float32Array} data  the patch elevations
 * @param {object} site   entry from src/sites.js
 */
export function createSurface(meta, data, site) {
  const n = meta.n;
  const cosLat = Math.cos(meta.lat * Math.PI / 180);
  const seed = hashSeed(site.id);
  const noiseSeed = seed ^ 0x9e3779b9;

  /** Real LOLA elevation relative to the site, by east/north offset in metres. */
  function sampleElev(eastM, northM) {
    const dLat = (northM / MOON_R) * 180 / Math.PI;
    const dLon = (eastM / (MOON_R * cosLat)) * 180 / Math.PI;
    let fx = (dLon + meta.halfLonDeg) / (2 * meta.halfLonDeg) * (n - 1);
    let fy = (meta.halfLatDeg - dLat) / (2 * meta.halfLatDeg) * (n - 1);
    fx = Math.min(Math.max(fx, 0), n - 1.001);
    fy = Math.min(Math.max(fy, 0), n - 1.001);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const gx = fx - x0, gy = fy - y0;
    return (
      data[y0 * n + x0] * (1 - gx) * (1 - gy) +
      data[y0 * n + x0 + 1] * gx * (1 - gy) +
      data[(y0 + 1) * n + x0] * (1 - gx) * gy +
      data[(y0 + 1) * n + x0 + 1] * gx * gy
    ) - meta.centerElevM;
  }

  /** The real ground: LOLA elevation minus the Moon's curvature drop. */
  function baseAt(eastM, northM) {
    const r2 = eastM * eastM + northM * northM;
    return sampleElev(eastM, northM) - r2 / (2 * MOON_R);
  }

  /**
   * Full surface at a point given in scene coordinates (x east, z south).
   * Returns height in metres relative to the observer's feet, plus a 0..1
   * "fresh rim" weight used for albedo.
   */
  function surfaceAt(x, z) {
    const north = -z;
    const r = Math.hypot(x, north);
    const base = baseAt(x, north);

    // Coarse procedural relief fades in past the observer's own patch of
    // ground and fades out again where LOLA takes over.
    const nearFlat = Math.min(Math.max((r - NEAR_FLAT_R) / NEAR_FLAT_BLEND, 0), 1);
    const coarseWeight = nearFlat * nearFlat * (3 - 2 * nearFlat) / (1 + (r / 900) ** 2);
    const fine = 1 / (1 + (r / 2600) ** 2);

    const cr = craters(x, north, seed, r, coarseWeight);
    let detail = cr.h + boulders(x, north, seed, r) * fine;
    detail += (
      fbm(x / 30, north / 30, noiseSeed + 7, 4) * FBM_MID_M +
      fbm(x / 260, north / 260, noiseSeed + 17, 4) * FBM_FAR_M
    ) * coarseWeight;
    if (r < 600) detail += fbm(x / 3.2, north / 3.2, noiseSeed, 3) * 0.05 * fine;
    if (r < 60) detail += fbm(x / 0.55, north / 0.55, noiseSeed + 3, 2) * 0.018;

    return { y: base + detail, rim: cr.rim };
  }

  function heightAt(x, z) {
    return surfaceAt(x, z).y;
  }

  /**
   * Skyline altitude in radians for an azimuth in radians, marching out to
   * `maxR`. Used both to hide sky labels behind ridges and, in the tests, to
   * prove the procedural detail is not inventing a horizon.
   */
  function skylineAlt(azRad, eyeY = EYE, maxR = 65000, steps = 140) {
    const se = Math.sin(azRad), cs = Math.cos(azRad);
    let best = -Math.PI / 2;
    for (let i = 0; i < steps; i++) {
      const r = 3 * Math.pow(maxR / 3, i / (steps - 1));
      const a = Math.atan2(heightAt(r * se, -r * cs) - eyeY, r);
      if (a > best) best = a;
    }
    return best;
  }

  /** Same, but from the real LOLA data alone — the horizon that ought to be there. */
  function lolaSkylineAlt(azRad, eyeY = EYE, maxR = 65000, steps = 140) {
    const se = Math.sin(azRad), cs = Math.cos(azRad);
    let best = -Math.PI / 2;
    for (let i = 0; i < steps; i++) {
      const r = 3 * Math.pow(maxR / 3, i / (steps - 1));
      const a = Math.atan2(baseAt(r * se, r * cs) - eyeY, r);
      if (a > best) best = a;
    }
    return best;
  }

  return { sampleElev, baseAt, surfaceAt, heightAt, skylineAlt, lolaSkylineAlt, seed, noiseSeed };
}
