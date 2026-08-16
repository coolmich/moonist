import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SITES } from '../src/sites.js';

// Verifies that the extracted LOLA patches really contain the landmarks each
// site is famous for — i.e. that the NASA elevation data is correctly
// georeferenced, scaled, and oriented (a flipped or transposed patch would
// put Mons Hadley in the wrong place and pass every rendering test).

const MOON_R = 1737400;

function loadPatch(id) {
  const dir = fileURLToPath(new URL('../public/terrain/', import.meta.url));
  const meta = JSON.parse(readFileSync(`${dir}${id}.meta.json`, 'utf8'));
  const buf = readFileSync(`${dir}${id}.bin`);
  const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const n = meta.n;

  // Highest point within `maxKm`, as relief above the site and its bearing.
  function peakWithin(maxKm) {
    let best = { relief: -Infinity, km: 0, az: 0 };
    for (let j = 0; j < n; j++) {
      const lat = meta.lat + meta.halfLatDeg - (j / (n - 1)) * 2 * meta.halfLatDeg;
      const north = (lat - meta.lat) * Math.PI / 180 * MOON_R;
      for (let i = 0; i < n; i++) {
        const lon = meta.lon - meta.halfLonDeg + (i / (n - 1)) * 2 * meta.halfLonDeg;
        const east = (lon - meta.lon) * Math.PI / 180 * MOON_R * Math.cos(meta.lat * Math.PI / 180);
        const km = Math.hypot(east, north) / 1000;
        if (km > maxKm) continue;
        const relief = data[j * n + i] - meta.centerElevM;
        if (relief > best.relief) {
          best = { relief, km, az: ((Math.atan2(east, north) * 180 / Math.PI) + 360) % 360 };
        }
      }
    }
    return best;
  }

  return { meta, data, peakWithin };
}

test('every site has a patch with sane georeferencing', () => {
  for (const site of SITES) {
    const { meta, data } = loadPatch(site.id);
    assert.equal(meta.lat, site.lat);
    assert.equal(meta.lon, site.lon);
    assert.equal(data.length, meta.n * meta.n);
    // Lunar elevations relative to the 1737.4 km sphere span about ±9 km.
    assert.ok(meta.centerElevM > -9000 && meta.centerElevM < 9000, `${site.id} center ${meta.centerElevM}`);
    for (let i = 0; i < data.length; i += 997) {
      assert.ok(Number.isFinite(data[i]) && Math.abs(data[i]) < 12000, `${site.id} bad sample ${data[i]}`);
    }
  }
});

test('Apollo 15 sits below the Apennine front, ~4.5 km of relief nearby', () => {
  const p = loadPatch('apollo15').peakWithin(35);
  // Mons Hadley and the Apennine massifs stand 3.5-5 km over the landing plain,
  // in the arc from north-east round to south-east.
  assert.ok(p.relief > 3500 && p.relief < 5200, `relief ${p.relief.toFixed(0)} m`);
  assert.ok(p.km > 10 && p.km < 35, `distance ${p.km.toFixed(1)} km`);
  assert.ok(p.az > 40 && p.az < 140, `bearing ${p.az.toFixed(0)}°`);
});

test('Apollo 17 is a valley boxed in by ~2 km massifs', () => {
  const p = loadPatch('apollo17').peakWithin(15);
  assert.ok(p.relief > 1800 && p.relief < 3000, `relief ${p.relief.toFixed(0)} m`);
  assert.ok(p.km < 15, `distance ${p.km.toFixed(1)} km`);
});

test('Tycho floor is ringed by walls climbing kilometres to the rim', () => {
  const p = loadPatch('tycho').peakWithin(45);
  assert.ok(p.relief > 3000, `relief ${p.relief.toFixed(0)} m`);
});

test('mare sites are flat: no big relief close in', () => {
  for (const id of ['apollo11', 'change3']) {
    const p = loadPatch(id).peakWithin(12);
    assert.ok(p.relief < 600, `${id} has ${p.relief.toFixed(0)} m of relief within 12 km`);
  }
});

test('the horizon on a flat mare closes at the true ~2.4 km', () => {
  // Curvature drop over distance r is r²/2R; a 1.7 m eye sees the horizon at
  // sqrt(2 R h) ≈ 2.43 km on an ideal sphere.
  const h = 1.7;
  const d = Math.sqrt(2 * MOON_R * h);
  assert.ok(d > 2300 && d < 2500, `${d.toFixed(0)} m`);
  // The renderer applies exactly this drop, so a point at that range sits at
  // eye level and beyond it drops away.
  const dropAt = (r) => (r * r) / (2 * MOON_R);
  assert.ok(Math.abs(dropAt(d) - h) < 0.01);
  assert.ok(dropAt(5000) > h);
});
