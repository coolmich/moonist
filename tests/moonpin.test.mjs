import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moonPinXY } from '../src/ui/ui.js';
import { SITES } from '../src/sites.js';

// The picker's site pins ride an orthographic near-side disc, north up and
// EAST TO THE RIGHT — the Moon as it faces the Earth. A sign slip here puts
// Apollo 11 on the wrong limb and no one notices until a user does.

test('every site pin lands inside the disc', () => {
  for (const s of SITES) {
    const { x, y } = moonPinXY(s.lat, s.lon);
    assert.ok(x * x + y * y < 1, `${s.id} at (${x.toFixed(2)}, ${y.toFixed(2)}) is off the disc`);
  }
});

test('pins sit where the landmarks say they must', () => {
  const at = (id) => moonPinXY(SITES.find((s) => s.id === id).lat, SITES.find((s) => s.id === id).lon);
  // Tranquility Base is in the eastern hemisphere: right of centre.
  assert.ok(at('apollo11').x > 0.3, `apollo11 x = ${at('apollo11').x.toFixed(3)}`);
  // Grimaldi hugs the western limb: far left.
  assert.ok(at('grimaldi').x < -0.85, `grimaldi x = ${at('grimaldi').x.toFixed(3)}`);
  // Tycho is deep south; Chang'e 3 is north-west.
  assert.ok(at('tycho').y < -0.6, `tycho y = ${at('tycho').y.toFixed(3)}`);
  assert.ok(at('change3').x < 0 && at('change3').y > 0.6, `change3 at (${at('change3').x.toFixed(2)}, ${at('change3').y.toFixed(2)})`);
  // Exact value for one: x = sin(lon)·cos(lat), y = sin(lat).
  const a11 = at('apollo11');
  assert.ok(Math.abs(a11.x - Math.sin(23.47314 * Math.PI / 180) * Math.cos(0.67416 * Math.PI / 180)) < 1e-12);
  assert.ok(Math.abs(a11.y - Math.sin(0.67416 * Math.PI / 180)) < 1e-12);
});
