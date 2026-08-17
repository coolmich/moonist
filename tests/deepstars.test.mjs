// The deep star layer: Tycho-2 to V 10, revealed by zoom. The binary is
// pinned by SHA-256 (re-encoding without rerunning the build script fails, by
// design), spot-checked against SIMBAD as the independent cross-check, and
// swept against the 5,044-star catalogue so no star is ever drawn twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const bin = readFileSync(fileURLToPath(new URL('../public/data/deepstars.bin', import.meta.url)));
const meta = JSON.parse(readFileSync(
  fileURLToPath(new URL('./fixtures/deepstars-meta.json', import.meta.url)), 'utf8',
));

function parseStars() {
  assert.equal(bin.toString('ascii', 0, 4), 'MDS1', 'magic');
  const count = bin.readUInt32LE(4);
  const stars = new Array(count);
  for (let i = 0; i < count; i++) {
    const o = 8 + i * 10;
    stars[i] = {
      ra: bin.readFloatLE(o),
      dec: bin.readFloatLE(o + 4),
      v: bin.readUInt8(o + 8) / 32 + 4.0,
      bv: bin.readUInt8(o + 9) / 64 - 0.5,
    };
  }
  return stars;
}

const DEG = Math.PI / 180;
function sepArcsec(a, b) {
  const dra = (a.ra - b.ra) * Math.cos(((a.dec + b.dec) / 2) * DEG);
  return Math.hypot(dra, a.dec - b.dec) * 3600;
}

test('deep star binary matches its fixture and is well-formed', () => {
  assert.equal(createHash('sha256').update(bin).digest('hex'), meta.sha256,
    'deepstars.bin does not match the fixture — rerun scripts/make-deepstars.mjs');
  const stars = parseStars();
  assert.equal(stars.length, meta.count);
  assert.ok(stars.length > 250000 && stars.length < 450000,
    `implausible star count ${stars.length}`);
  for (const s of stars) {
    assert.ok(s.ra >= 0 && s.ra < 360 && s.dec >= -90 && s.dec <= 90,
      `bad position ${s.ra},${s.dec}`);
    assert.ok(s.v >= 4.0 && s.v <= 10.05, `mag ${s.v} out of range`);
  }
  // Sorted brightest-first, so a future draw-range cut stays possible.
  for (let i = 1; i < stars.length; i++) {
    assert.ok(stars[i].v >= stars[i - 1].v - 1e-9, 'not sorted by magnitude');
  }
});

test('deep stars sit where SIMBAD puts them', () => {
  // Independent cross-check: five mid-magnitude stars looked up in SIMBAD by
  // identifier (fixture records the fetch). Both catalogues quote ICRS J2000,
  // so 3 arcsec and 0.3 mag absorb the Tycho->Johnson transformation error.
  const stars = parseStars();
  assert.ok(meta.simbadChecks.length >= 5, 'fixture lost its SIMBAD checks');
  for (const ref of meta.simbadChecks) {
    const target = { ra: ref.raDeg, dec: ref.decDeg };
    const hit = stars.find((s) => Math.abs(s.dec - ref.decDeg) < 0.01
      && sepArcsec(s, target) < 3 && Math.abs(s.v - ref.V) < 0.3);
    assert.ok(hit, `${ref.id} (V ${ref.V}) missing from the deep layer`);
  }
});

test('no deep star duplicates a catalogue star', () => {
  // Same-star criterion: within 2 arcsec and 0.5 mag of one of the 5,044.
  // (Genuine close companions — gamma-1 Velorum sits 41 arcsec from gamma-2 —
  // must survive; they are the point of the deep layer.)
  const stars = parseStars();
  const main = JSON.parse(readFileSync(
    fileURLToPath(new URL('../public/data/stars.6.json', import.meta.url)), 'utf8',
  ));
  const cells = new Map();
  for (const f of main.features) {
    const [lon, lat] = f.geometry.coordinates;
    const m = { ra: lon < 0 ? lon + 360 : lon, dec: lat, v: f.properties.mag };
    const key = `${Math.round(m.ra * 2)},${Math.round(m.dec * 2)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(m);
  }
  let dupes = 0;
  for (const s of stars) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dd = -1; dd <= 1; dd++) {
        const key = `${Math.round(s.ra * 2) + dr},${Math.round(s.dec * 2) + dd}`;
        for (const m of cells.get(key) ?? []) {
          if (Math.abs(s.v - m.v) < 0.5 && sepArcsec(s, m) < 2) dupes++;
        }
      }
    }
  }
  assert.equal(dupes, 0, `${dupes} deep stars duplicate catalogue stars`);
});
