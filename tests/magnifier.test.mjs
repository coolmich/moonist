import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capRemap } from '../src/scene/earth.js';

// The magnifier's cap remap (see earth.js). The drawn mesh at xN is
// geometrically a closer Earth; capRemap carries a surface point's off-axis
// angle between the two viewpoints so the drawn disc shows the x1 projection
// scaled. Fixture: the Earth's angular radius measured from the live scene at
// 2026-08-18T03:52Z (the night the artefact was reported — Seattle at 80.94°
// off-centre sat 0.21° behind the x10 drawn rim while truly visible).

const D2R = Math.PI / 180;
const ANG = 0.9273; // deg, Earth's angular radius from the Moon that night
const dist = (scale) => 1 / Math.sin(ANG * scale * D2R); // viewer distance, globe radii
const cap = (d) => Math.acos(1 / d); // visible-cap half-angle from distance d

// Viewer-side angle and impact parameter of the sight line to a surface
// point at off-axis angle g, seen from distance d — the projection the remap
// is defined to preserve. Independent re-derivation for the assertions.
const alpha = (g, d) => Math.atan2(Math.sin(g), d - Math.cos(g));
const impact = (g, d) => d * Math.sin(alpha(g, d));

const DT = dist(1);   // true distance, ~61.8 radii
const D10 = dist(10); // drawn distance at x10, ~6.2 radii
const D20 = dist(20); // drawn distance at x20, ~3.1 radii

test('capRemap is the identity when the viewpoints agree (x1)', () => {
  for (const d of [DT, D10, D20]) {
    for (let deg = 0; deg <= 89; deg++) {
      const g = deg * D2R;
      assert.ok(Math.abs(capRemap(g, d, d) - g) < 1e-12, `d=${d} g=${deg}`);
    }
  }
});

test('the drawn limb shows the true limb', () => {
  for (const dd of [D10, D20]) {
    const got = capRemap(cap(dd), dd, DT);
    assert.ok(Math.abs(got - cap(DT)) < 1e-9, `cap ${cap(dd) / D2R} -> ${got / D2R}`);
  }
});

test('forward and inverse round-trip across the visible cap', () => {
  for (const dd of [D10, D20]) {
    for (let deg = 0; deg < cap(DT) / D2R; deg += 0.25) {
      const g = deg * D2R;
      const back = capRemap(capRemap(g, DT, dd), dd, DT);
      assert.ok(Math.abs(back - g) < 1e-9, `x? g=${deg} back=${back / D2R}`);
    }
  }
});

test('capRemap preserves the projected disc-radius fraction', () => {
  // The remap is DEFINED by impact-parameter preservation: a feature must sit
  // at the same fraction of the disc radius at every dial setting.
  for (const dd of [D10, D20]) {
    for (let deg = 1; deg < cap(DT) / D2R; deg += 1) {
      const g = deg * D2R;
      const gd = capRemap(g, DT, dd);
      assert.ok(Math.abs(impact(gd, dd) - impact(g, DT)) < 1e-9, `g=${deg}`);
    }
  }
});

test('strictly monotone over the drawn cap', () => {
  for (const dd of [D10, D20]) {
    let prev = -1;
    for (let i = 0; i <= 1000; i++) {
      const g = (i / 1000) * cap(dd);
      const t = capRemap(g, dd, DT);
      assert.ok(t > prev, `g=${g / D2R}`);
      prev = t;
    }
  }
});

test('Seattle that night lands on the visible drawn cap at x10 and x20', () => {
  const g = 80.94 * D2R; // measured off-centre angle, 2026-08-18T03:52Z
  for (const dd of [D10, D20]) {
    const gd = capRemap(g, DT, dd);
    assert.ok(gd < cap(dd), `x? drawn ${gd / D2R} vs cap ${cap(dd) / D2R}`);
    // ... at the same disc-radius fraction the x1 view puts it (98.5%).
    assert.ok(Math.abs(impact(gd, dd) - impact(g, DT)) < 1e-9);
  }
});

test('a home truly behind the limb stays behind the drawn limb', () => {
  for (const dd of [D10, D20]) {
    for (const deg of [cap(DT) / D2R + 0.5, 100, 130, 180]) {
      const gd = capRemap(deg * D2R, DT, dd);
      assert.ok(gd > cap(dd), `g=${deg} drawn=${gd / D2R} cap=${cap(dd) / D2R}`);
    }
  }
});
