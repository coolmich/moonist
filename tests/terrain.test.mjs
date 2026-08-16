import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SITES } from '../src/sites.js';
import { createSurface, MOON_R, EYE } from '../src/scene/terrain-shape.js';

// These tests exercise the SAME shape module the renderer draws from, so a
// flipped patch, a lost curvature term or an inflated procedural amplitude
// fails here rather than quietly appearing on screen.

function loadSite(id) {
  const dir = fileURLToPath(new URL('../public/terrain/', import.meta.url));
  const meta = JSON.parse(readFileSync(`${dir}${id}.meta.json`, 'utf8'));
  const buf = readFileSync(`${dir}${id}.bin`);
  const data = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const site = SITES.find((s) => s.id === id);
  return { meta, data, site, surface: createSurface(meta, data, site) };
}

/** Highest real (LOLA) point within maxKm, as relief above the site + bearing. */
function peakWithin(s, maxKm) {
  let best = { relief: -Infinity, km: 0, az: 0 };
  const step = 400;
  for (let east = -maxKm * 1000; east <= maxKm * 1000; east += step) {
    for (let north = -maxKm * 1000; north <= maxKm * 1000; north += step) {
      const km = Math.hypot(east, north) / 1000;
      if (km > maxKm) continue;
      const relief = s.surface.sampleElev(east, north);
      if (relief > best.relief) {
        best = { relief, km, az: ((Math.atan2(east, north) * 180 / Math.PI) + 360) % 360 };
      }
    }
  }
  return best;
}

test('every site has a patch with sane georeferencing', () => {
  for (const site of SITES) {
    const { meta, data } = loadSite(site.id);
    assert.equal(meta.lat, site.lat);
    assert.equal(meta.lon, site.lon);
    assert.equal(data.length, meta.n * meta.n);
    assert.ok(meta.centerElevM > -9000 && meta.centerElevM < 9000, `${site.id} center ${meta.centerElevM}`);
    for (let i = 0; i < data.length; i += 997) {
      assert.ok(Number.isFinite(data[i]) && Math.abs(data[i]) < 12000, `${site.id} bad sample ${data[i]}`);
    }
  }
});

test('Apollo 15 sits below the Apennine front, ~4.5 km of relief nearby', () => {
  const p = peakWithin(loadSite('apollo15'), 35);
  assert.ok(p.relief > 3500 && p.relief < 5200, `relief ${p.relief.toFixed(0)} m`);
  assert.ok(p.km > 10 && p.km < 35, `distance ${p.km.toFixed(1)} km`);
  assert.ok(p.az > 40 && p.az < 140, `bearing ${p.az.toFixed(0)}°`);
});

test('Apollo 17 is a valley boxed in by ~2 km massifs', () => {
  const p = peakWithin(loadSite('apollo17'), 15);
  assert.ok(p.relief > 1800 && p.relief < 3000, `relief ${p.relief.toFixed(0)} m`);
  assert.ok(p.km < 15, `distance ${p.km.toFixed(1)} km`);
});

test('Tycho floor is ringed by walls climbing kilometres to the rim', () => {
  const p = peakWithin(loadSite('tycho'), 45);
  assert.ok(p.relief > 3000, `relief ${p.relief.toFixed(0)} m`);
});

test('mare sites are flat: no big relief close in', () => {
  for (const id of ['apollo11', 'change3']) {
    const p = peakWithin(loadSite(id), 12);
    assert.ok(p.relief < 600, `${id} has ${p.relief.toFixed(0)} m of relief within 12 km`);
  }
});

test('the renderer bends the ground away over the Moon\'s curvature', () => {
  // The ground the renderer draws must be the LOLA elevation MINUS the
  // curvature drop. Comparing the two functions pins the term itself, without
  // depending on the terrain happening to be flat in any direction.
  const { surface } = loadSite('apollo11');
  for (const r of [300, 2430, 8000, 40000]) {
    for (let i = 0; i < 4; i++) {
      const az = (i / 4) * Math.PI * 2;
      const east = r * Math.sin(az), north = r * Math.cos(az);
      const drop = surface.sampleElev(east, north) - surface.baseAt(east, north);
      assert.ok(Math.abs(drop - (r * r) / (2 * MOON_R)) < 1e-6,
        `at ${r} m the drop is ${drop.toFixed(3)} m, expected ${((r * r) / (2 * MOON_R)).toFixed(3)}`);
    }
  }
  // That curvature is what closes the horizon at ~2.4 km for a 1.7 m eye: the
  // ground has fallen exactly eye-height by then.
  const d = Math.sqrt(2 * MOON_R * EYE);
  assert.ok(d > 2300 && d < 2500, `horizon distance ${d.toFixed(0)} m`);
  assert.ok(Math.abs((d * d) / (2 * MOON_R) - EYE) < 0.01);
});

test('procedural detail never invents a horizon: the skyline stays the real one', () => {
  // The regression that matters. Procedural relief has to add texture without
  // building a false ridge line: if it does, the true 2.4 km horizon vanishes
  // and real mountains hide behind phantom rims.
  for (const site of SITES) {
    const { surface } = loadSite(site.id);
    const eyeY = surface.surfaceAt(0, 0).y + EYE;
    let worst = 0;
    let worstAz = 0;
    let sum = 0;
    for (let b = 0; b < 36; b++) {
      const az = (b / 36) * Math.PI * 2;
      const diff = (surface.skylineAlt(az, eyeY) - surface.lolaSkylineAlt(az, eyeY)) * 180 / Math.PI;
      sum += diff;
      if (Math.abs(diff) > worst) {
        worst = Math.abs(diff);
        worstAz = az * 180 / Math.PI;
      }
    }
    // A single crater rim may legitimately break a mare horizon by about a
    // degree — real ones do, and LOLA at 475 m/px cannot resolve them...
    assert.ok(worst < 1.2,
      `${site.id}: skyline is ${worst.toFixed(2)}° from the LOLA skyline at az ${worstAz.toFixed(0)}°`);
    // ...but the horizon as a whole must still sit where the real data puts
    // it. A systematic offset is the signature of an invented landscape.
    assert.ok(Math.abs(sum / 36) < 0.3,
      `${site.id}: skyline is offset ${(sum / 36).toFixed(2)}° on average`);
  }
});

test('the observer stands on the ground, not in a procedural pit', () => {
  for (const site of SITES) {
    const { surface } = loadSite(site.id);
    const feet = surface.surfaceAt(0, 0).y;
    assert.ok(Math.abs(feet) < 2, `${site.id}: feet are ${feet.toFixed(2)} m off the real datum`);
  }
});

test('each site has the skyline its description promises', () => {
  const skyline = (id) => {
    const { surface } = loadSite(id);
    const eyeY = surface.surfaceAt(0, 0).y + EYE;
    let peak = -90, sum = 0;
    for (let b = 0; b < 72; b++) {
      const alt = surface.skylineAlt((b / 72) * Math.PI * 2, eyeY) * 180 / Math.PI;
      sum += alt;
      if (alt > peak) peak = alt;
    }
    return { peak, mean: sum / 72 };
  };
  for (const id of ['apollo11', 'change3', 'grimaldi']) {
    assert.ok(skyline(id).peak < 1.5, `${id} skyline peaks at ${skyline(id).peak.toFixed(2)}°`);
  }
  for (const id of ['apollo15', 'apollo17']) {
    const s = skyline(id);
    assert.ok(s.peak > 8 && s.mean > 2.5, `${id} peak ${s.peak.toFixed(1)}° mean ${s.mean.toFixed(1)}°`);
  }
  const tycho = skyline('tycho');
  assert.ok(tycho.peak > 20 && tycho.mean > 8, `tycho peak ${tycho.peak.toFixed(1)}° mean ${tycho.mean.toFixed(1)}°`);
});
