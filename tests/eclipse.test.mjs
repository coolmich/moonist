import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Astronomy from 'astronomy-engine';
import { skyState, solarObscurationAt } from '../src/astro/engine.js';

// The Moon's shadow on the Earth — the geometry behind the eclipse smudge the
// Earth shader draws. Cross-checked against astronomy-engine's *independent*
// eclipse searches (its own root-finding over its own shadow model), never
// against this code's output: the sanctioned external check for new
// astronomical behaviour.
//
// Tolerances: solarObscurationAt models a spherical sea-level Earth with
// geocentric latitude; astronomy-engine's local search uses the observer
// ellipsoid. That geometry difference moves a surface point by up to ~21 km,
// worth under 1% of obscuration on the penumbra's ~3400 km gradient.

/** The global eclipse whose peak falls in the given UTC month. */
function globalEclipse(y, m) {
  const ecl = Astronomy.SearchGlobalSolarEclipse(new Date(Date.UTC(y, m - 1, 1)));
  const peak = ecl.peak.date;
  assert.equal(peak.getUTCFullYear(), y, `eclipse search left ${y}`);
  assert.equal(peak.getUTCMonth(), m - 1, `eclipse search left month ${m}`);
  return ecl;
}

for (const [y, m, label] of [
  [2026, 8, 'Iceland/Spain'],
  [2024, 4, 'North America'],
]) {
  test(`total eclipse of ${y}-${String(m).padStart(2, '0')} (${label}): umbra lands where the independent search says`, () => {
    const ecl = globalEclipse(y, m);
    assert.equal(ecl.kind, 'total');

    // At the searched peak point the Sun is fully covered. Allow the
    // geodetic-vs-geocentric displacement to shave the last fraction…
    const atPeak = solarObscurationAt(ecl.peak.date, ecl.latitude, ecl.longitude);
    assert.ok(atPeak >= 0.995,
      `obscuration at peak point ${atPeak.toFixed(4)} — umbra missed the searched ground point`);

    // …but somewhere within a third of a degree of it, totality must be exact.
    let best = 0;
    for (let dLat = -0.3; dLat <= 0.3; dLat += 0.1) {
      for (let dLon = -0.7; dLon <= 0.7; dLon += 0.1) {
        best = Math.max(best, solarObscurationAt(ecl.peak.date, ecl.latitude + dLat, ecl.longitude + dLon));
        if (best === 1) break;
      }
    }
    assert.equal(best, 1, `no total coverage near the peak point (max ${best.toFixed(5)})`);

    // The far side of the planet sees nothing.
    const far = solarObscurationAt(ecl.peak.date, -ecl.latitude, ((ecl.longitude + 360) % 360) - 180);
    assert.equal(far, 0, `antipodal-ish point reports ${far}`);
  });
}

test('partial obscuration matches SearchLocalSolarEclipse city by city', () => {
  // Cities inside the 2026-08-12 partial zone, spread across the penumbra.
  const cities = [
    ['Reykjavik', 64.147, -21.94],
    ['Madrid', 40.417, -3.703],
    ['London', 51.507, -0.128],
  ];
  for (const [name, lat, lon] of cities) {
    const info = Astronomy.SearchLocalSolarEclipse(
      new Date(Date.UTC(2026, 7, 1)),
      new Astronomy.Observer(lat, lon, 0),
    );
    const peak = info.peak.time.date;
    assert.equal(peak.getUTCFullYear(), 2026, `${name}: found eclipse at ${peak.toISOString()}`);
    assert.equal(peak.getUTCMonth(), 7, `${name}: found eclipse at ${peak.toISOString()}`);
    const ours = solarObscurationAt(peak, lat, lon);
    const err = Math.abs(ours - info.obscuration);
    assert.ok(err < 0.02,
      `${name}: obscuration ${ours.toFixed(4)} vs astronomy-engine ${info.obscuration.toFixed(4)} (err ${err.toFixed(4)})`);
  }
});

test('no eclipse, no shadow — a week off new moon the whole planet is clear', () => {
  const when = new Date(Date.UTC(2026, 7, 5, 12, 0, 0));
  for (const [lat, lon] of [[0, 0], [45, -90], [-30, 140], [65, -25]]) {
    assert.equal(solarObscurationAt(when, lat, lon), 0);
  }
});

test('earth.moonPosBody agrees with the sub-lunar point already in the state', () => {
  const s = skyState(new Date(Date.UTC(2026, 7, 12, 17, 45, 47)), { lat: -5.2, lon: -68.3 });
  const [x, y, z] = s.earth.moonPosBody;
  const r = Math.hypot(x, y, z);
  // Earth–Moon distance in Earth radii: 55–64 over the orbit.
  assert.ok(r > 55 && r < 64, `|moonPosBody| = ${r.toFixed(2)} earth radii`);
  const lat = Math.asin(z / r) * 180 / Math.PI;
  const lon = Math.atan2(y, x) * 180 / Math.PI;
  const dLon = ((lon - s.subLunar.lon + 540) % 360) - 180;
  assert.ok(Math.abs(lat - s.subLunar.lat) < 0.05, `sub-lunar lat ${lat.toFixed(3)} vs ${s.subLunar.lat.toFixed(3)}`);
  assert.ok(Math.abs(dLon) < 0.05, `sub-lunar lon ${lon.toFixed(3)} vs ${s.subLunar.lon.toFixed(3)}`);
});
