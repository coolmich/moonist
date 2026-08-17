import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TEXTURE_GAIN } from '../src/scene/milkyway.js';

// The Milky Way texture is the one asset whose orientation cannot be checked
// by reading the code: a mirrored or rotated sky still looks like a sky. These
// tests cross-check the shipped pixels against the IAU galactic frame — the
// band must lie on the galactic equator, the bulge must be the Sagittarius
// star cloud and not the anticentre, and the Magellanic Clouds must be where
// the catalogues put them. Each of the three wrong flip/mirror combinations
// fails at least one of those.
//
// The grid is a coarse luminance map of exactly what shipped, written by
// scripts/make-milkyway.mjs; the hash ties it to the file.

const fixture = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/milkyway-grid.json', import.meta.url)), 'utf8',
));
const { gridWidth: GW, gridHeight: GH, grid } = fixture;
const D = Math.PI / 180;

// Galactic pole and centre, IAU 1958 in J2000 (Hipparcos/Gaia convention).
const RA_P = 192.85948 * D;
const DEC_P = 27.12825 * D;
function galacticLat(raDeg, decDeg) {
  const ra = raDeg * D;
  const dec = decDeg * D;
  return Math.asin(
    Math.sin(dec) * Math.sin(DEC_P) + Math.cos(dec) * Math.cos(DEC_P) * Math.cos(ra - RA_P),
  ) / D;
}

// The convention the shader samples with: u = RA/2π + 0.5, v = dec/π + 0.5,
// row 0 = Dec +90. Cell centres, in degrees.
const cellRa = (gx) => (((gx + 0.5) / GW - 0.5) * 360 + 360) % 360;
const cellDec = (gy) => 90 - ((gy + 0.5) / GH) * 180;
const cellAt = (raDeg, decDeg) => {
  const u = ((((raDeg + 180) % 360) + 360) % 360) / 360;
  const v = (90 - decDeg) / 180;
  const gx = Math.min(GW - 1, Math.floor(u * GW));
  const gy = Math.min(GH - 1, Math.floor(v * GH));
  return grid[gy * GW + gx];
};

function angularSep(ra1, dec1, ra2, dec2) {
  const [a1, d1, a2, d2] = [ra1 * D, dec1 * D, ra2 * D, dec2 * D];
  return Math.acos(Math.min(1, Math.sin(d1) * Math.sin(d2)
    + Math.cos(d1) * Math.cos(d2) * Math.cos(a1 - a2))) / D;
}

test('the shipped texture is the one this fixture describes', () => {
  const file = readFileSync(fileURLToPath(new URL('../public/textures/milkyway.webp', import.meta.url)));
  assert.equal(file.length, fixture.bytes);
  assert.equal(createHash('sha256').update(file).digest('hex'), fixture.sha256);
  assert.equal(fixture.gridWidth * fixture.gridHeight, grid.length);
  // The shader divides out the gain the script multiplied in. Nothing but this
  // binds the two halves of that contract: get it wrong and the whole sky is
  // silently mis-scaled, with every other test still passing.
  assert.equal(fixture.gain, TEXTURE_GAIN);
});

test('the stars the app draws itself have been subtracted from the map', () => {
  // Left in, each one is a clipped white core that adds to its own sprite,
  // making a mag-6 star as bright as a mag-1 one — and at high zoom the map's
  // texels become visible white squares.
  const worstPeak = fixture.starChecks.reduce((m, s) => Math.max(m, s.peak), 0);
  assert.ok(worstPeak < 0.25, `brightest residual star core is ${worstPeak} linear`);
  const ratios = fixture.starChecks
    .filter((s) => s.bg > 0)
    .map((s) => s.peak / s.bg)
    .sort((a, b) => a - b);
  const median = ratios[ratios.length >> 1];
  assert.ok(median < 1.5, `median residual is ${median.toFixed(2)}x the local background`);
});

test('the deep star layer has been subtracted from the map too', () => {
  // The zoom draws Tycho-2 to V 10 as points; left in the map, each of those
  // stars magnifies into a fog ball centred on its own sharp point. Bounds are
  // looser than the catalogue's: these sit in crowded fields where the
  // measurement window can legitimately catch a fainter-than-V10 neighbour.
  assert.ok(fixture.deepStarChecks.length >= 200, 'fixture lost its deep checks');
  const worstPeak = fixture.deepStarChecks.reduce((m, s) => Math.max(m, s.peak), 0);
  assert.ok(worstPeak < 0.25, `brightest residual deep-star core is ${worstPeak} linear`);
  const ratios = fixture.deepStarChecks
    .filter((s) => s.bg > 0)
    .map((s) => s.peak / s.bg)
    .sort((a, b) => a - b);
  const median = ratios[ratios.length >> 1];
  assert.ok(median < 1.8, `median deep residual is ${median.toFixed(2)}x the local background`);
});

test('the band lies on the galactic equator', () => {
  const near = [];
  const far = [];
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const b = Math.abs(galacticLat(cellRa(gx), cellDec(gy)));
      const v = grid[gy * GW + gx];
      if (b < 5) near.push(v);
      else if (b > 70) far.push(v);
    }
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  // Real ratio is large; a mirrored or rotated sky scatters the band and
  // collapses this toward 1.
  assert.ok(mean(near) / mean(far) > 8, `plane/pole contrast ${(mean(near) / mean(far)).toFixed(1)}`);
});

test('the brightest region of the sky is the Sagittarius star cloud', () => {
  let best = -Infinity;
  let at = null;
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      if (grid[gy * GW + gx] > best) {
        best = grid[gy * GW + gx];
        at = [cellRa(gx), cellDec(gy)];
      }
    }
  }
  // Sgr star cloud / galactic bulge, RA 17h50m Dec -28. This is what breaks
  // the 180-degree rotation ambiguity: the anticentre is 180 degrees away.
  const sep = angularSep(at[0], at[1], 267.5, -28.0);
  assert.ok(sep < 15, `brightest cell at RA ${at[0].toFixed(1)} Dec ${at[1].toFixed(1)}, ${sep.toFixed(1)}° from the bulge`);
});

test('the galactic centre outshines the anticentre', () => {
  const centre = cellAt(267.5, -28.0);
  const anti = cellAt(87.5, 28.0);
  assert.ok(centre > anti * 1.5, `centre/anticentre = ${(centre / anti).toFixed(2)}`);
});

test('the Magellanic Clouds are at their catalogued positions', () => {
  // Both sit ~33° and ~44° off the galactic plane, where the sky is otherwise
  // empty, so they only show up if the mapping is right in both axes.
  for (const [name, ra, dec] of [['LMC', 80.894, -69.756], ['SMC', 13.187, -72.829]]) {
    const here = cellAt(ra, dec);
    // Compare against the mirrored position, which is empty sky.
    const mirrored = cellAt(360 - ra, dec);
    assert.ok(here > mirrored * 2, `${name}: ${here.toExponential(2)} vs mirrored ${mirrored.toExponential(2)}`);
  }
});

test('the galactic poles are dark and the texture is not clipped', () => {
  const poleN = cellAt(192.859, 27.128);
  const poleS = cellAt(12.859, -27.128);
  const bulge = cellAt(267.5, -28.0);
  assert.ok(poleN < bulge * 0.1, `north galactic pole ${poleN.toExponential(2)}`);
  assert.ok(poleS < bulge * 0.1, `south galactic pole ${poleS.toExponential(2)}`);
  // A cell mean at the bulge saturating would mean the gain was set too high.
  assert.ok(bulge < 0.75, `bulge cell mean ${bulge.toFixed(3)} is close to clipping`);
});
