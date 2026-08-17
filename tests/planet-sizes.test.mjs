// The law the planet sprites must obey on screen: zooming in never makes a
// planet smaller, and by the deep end of the zoom the real disc (for Saturn,
// the ring span) has decisively overtaken the wide-field glare blob. This was
// broken twice — first every planet pinned at the same 26 px from 45° FOV
// inward, then the fix collapsed the blob into a disc a fifth its size at a
// fixed threshold — so the actual size law runs here against real ephemeris
// states, not in anyone's head.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skyState } from '../src/astro/engine.js';
import { createPlanets } from '../src/scene/planets.js';

const GRIMALDI = { id: 'grimaldi', lat: -5.38, lon: -68.36 };
const HEIGHT_PX = 970;
const NAMES = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];

// Log-spaced FOV sweep from wide field to the 0.2° floor.
const FOVS = [];
for (let f = 100; f >= 0.2 * 0.999; f /= 1.15) FOVS.push(f);

function sizesAcrossZoom(when) {
  const state = skyState(when, GRIMALDI);
  const planets = createPlanets(1);
  planets.update(state.planets);
  const rows = new Map(NAMES.map((n) => [n, []]));
  for (const fov of FOVS) {
    planets.updateApparentSizes(fov, HEIGHT_PX);
    for (const n of NAMES) rows.get(n).push(planets.sizePxOf(n));
  }
  return rows;
}

test('zooming in never shrinks a planet, at any FOV', () => {
  // Two epochs with very different geometries (Venus 36% lit vs 77% lit,
  // Mars 5" vs 13").
  for (const t of ['2026-09-05T00:00:00Z', '2027-03-14T12:00:00Z']) {
    const rows = sizesAcrossZoom(new Date(t));
    for (const n of NAMES) {
      const sizes = rows.get(n);
      for (let i = 1; i < sizes.length; i++) {
        assert.ok(sizes[i] >= sizes[i - 1] - 1e-9,
          `${n} @ ${t}: shrank from ${sizes[i - 1].toFixed(2)}px at ${FOVS[i - 1].toFixed(2)}° `
          + `to ${sizes[i].toFixed(2)}px at ${FOVS[i].toFixed(2)}°`);
      }
    }
  }
});

test('the deep zoom actually magnifies: discs overtake the glare blob', () => {
  const planets = createPlanets(1);
  const state = skyState(new Date('2026-09-05T00:00:00Z'), GRIMALDI);
  planets.update(state.planets);

  const at = (fov) => {
    planets.updateApparentSizes(fov, HEIGHT_PX);
    return Object.fromEntries(NAMES.map((n) => [n, planets.sizePxOf(n)]));
  };
  const wide = at(65);
  const deep = at(0.2);

  // The exact dogfooding report: Saturn between 69° and 1° must grow, and at
  // the floor the ring span (2.27 globe diameters, 19.4" globe at this epoch)
  // must dominate the sprite.
  const mid = at(1);
  assert.ok(mid.Saturn > wide.Saturn * 1.5,
    `Saturn at 1° (${mid.Saturn.toFixed(1)}px) should clearly exceed 65° (${wide.Saturn.toFixed(1)}px)`);
  for (const n of ['Venus', 'Jupiter', 'Saturn']) {
    assert.ok(deep[n] > wide[n] * 2,
      `${n}: ${wide[n].toFixed(1)}px at 65° -> ${deep[n].toFixed(1)}px at 0.2° is not a magnification`);
  }
  assert.ok(deep.Saturn > 50, `Saturn ring span at 0.2° is ${deep.Saturn.toFixed(1)}px`);
});

test('the glare only yields to a disc of comparable size', () => {
  // The original shrink: the glare amplitude collapsed at a fixed disc-pixel
  // threshold, while the disc was still a fifth of the blob's size. The sprite
  // size stayed monotone through that, so this pins the mechanism itself:
  // wherever the glare has mostly faded (takeover > 0.5), the planet's true
  // extent must have grown to rival the glare footprint it is replacing.
  const planets = createPlanets(1);
  const state = skyState(new Date('2026-09-05T00:00:00Z'), GRIMALDI);
  planets.update(state.planets);
  const attr = planets.group.geometry.attributes;
  for (const fov of FOVS) {
    planets.updateApparentSizes(fov, HEIGHT_PX);
    for (let i = 0; i < NAMES.length; i++) {
      const t = attr.aTakeover.array[i];
      if (t <= 0.5) continue;
      const size = attr.aSize.array[i];
      const discPx = attr.aDiscFrac.array[i] * size;
      const extentPx = NAMES[i] === 'Saturn' ? discPx * 2.27 : discPx;
      const glareFootPx = attr.aGlareFrac.array[i] * size;
      assert.ok(extentPx >= glareFootPx * 0.6,
        `${NAMES[i]} at ${fov.toFixed(2)}°: glare fading (takeover ${t.toFixed(2)}) while the `
        + `extent is only ${extentPx.toFixed(1)}px against a ${glareFootPx.toFixed(1)}px blob`);
    }
  }
});
