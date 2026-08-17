import { test } from 'node:test';
import assert from 'node:assert/strict';
import { angSepDeg, skyState } from '../src/astro/engine.js';

// angSepDeg backs the "is home facing the Moon" readout: the great-circle
// separation between the sub-lunar point and the viewer's home.

test('angSepDeg identities', () => {
  assert.ok(Math.abs(angSepDeg(47.6, -122.3, 47.6, -122.3)) < 1e-9, 'same point is 0');
  assert.ok(Math.abs(angSepDeg(47.6, -122.3, -47.6, 57.7) - 180) < 1e-9, 'antipode is 180');
  assert.ok(Math.abs(angSepDeg(90, 0, 0, 123) - 90) < 1e-9, 'pole to equator is 90');
  assert.ok(Math.abs(angSepDeg(10, 20, 30, 40) - angSepDeg(30, 40, 10, 20)) < 1e-12, 'symmetric');
  // Pure longitude separation on the equator is the longitude difference.
  assert.ok(Math.abs(angSepDeg(0, 10, 0, 75) - 65) < 1e-9);
});

test('home visibility flips exactly with the sub-lunar hemisphere', () => {
  // At any instant, the sub-lunar point itself is facing the Moon (sep 0)
  // and its antipode is not (sep 180) — the readout's two extremes.
  const s = skyState(new Date(Date.UTC(2026, 7, 17, 12, 0, 0)), { lat: 0, lon: 0 });
  assert.ok(angSepDeg(s.subLunar.lat, s.subLunar.lon, s.subLunar.lat, s.subLunar.lon) < 1e-9);
  const anti = angSepDeg(s.subLunar.lat, s.subLunar.lon, -s.subLunar.lat, s.subLunar.lon + 180);
  assert.ok(Math.abs(anti - 180) < 1e-9);
});
