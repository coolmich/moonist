// Build the deep star layer: Tycho-2 to V = 10, the stars the zoom reveals.
//
// The Milky Way texture carries these stars only as 2.6-arcmin integrated
// light, so under magnification they bloat into blobs; this layer draws them
// as the points they are. Tycho-2 is the natural source — it is the same
// catalogue NASA's Deep Star Maps uses for this magnitude range — pulled from
// VizieR (I/259) with the standard Johnson conversions from the catalogue
// documentation: V = VT - 0.090(BT-VT), B-V = 0.850(BT-VT).
//
// Stars already in the app's 5,044-star catalogue are dropped (by HIP
// cross-reference, with a positional sweep as belt and braces), so no star is
// ever drawn twice as a point. Output is a quantized binary:
//   'MDS1' | uint32 count | per star: f32 RA deg, f32 Dec deg,
//   u8 mag ((V-4)*32), u8 B-V ((bv+0.5)*64)   -- little-endian
// plus a fixture carrying the file's SHA-256, so re-encoding the data without
// rerunning this script fails the tests, by design.
//
// Usage: node scripts/make-deepstars.mjs   (~20 MB download, cached in tmp)

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/data/deepstars.bin');
const META = join(ROOT, 'tests/fixtures/deepstars-meta.json');
const CACHE = join(tmpdir(), 'moonist-tycho2-vt105.csv');

const TAP = 'https://tapvizier.cds.unistra.fr/TAPVizieR/tap/sync';
const QUERY = 'SELECT RAmdeg, DEmdeg, BTmag, VTmag, HIP FROM "I/259/tyc2" '
  + 'WHERE VTmag < 10.5 AND RAmdeg IS NOT NULL';
const V_MAX = 10.0;

if (!existsSync(CACHE) || statSync(CACHE).size < 1e6) {
  console.log('fetching Tycho-2 VT<10.5 from VizieR TAP (~20 MB)...');
  execFileSync('curl', ['-sf', TAP,
    '--data-urlencode', 'REQUEST=doQuery',
    '--data-urlencode', 'LANG=ADQL',
    '--data-urlencode', 'FORMAT=csv',
    '--data-urlencode', 'MAXREC=2000000',
    '--data-urlencode', `QUERY=${QUERY}`,
    '-o', CACHE,
  ], { stdio: 'inherit', timeout: 600000 });
}
console.log(`source csv: ${CACHE} (${(statSync(CACHE).size / 1e6).toFixed(1)} MB)`);

// --- The 5,044 already-drawn stars, for dedup ------------------------------
const main = JSON.parse(readFileSync(join(ROOT, 'public/data/stars.6.json'), 'utf8'));
const mainHip = new Set(main.features.map((f) => f.id));
const mainPos = main.features.map((f) => {
  const [lon, lat] = f.geometry.coordinates;
  return { ra: lon < 0 ? lon + 360 : lon, dec: lat };
});

const DEG = Math.PI / 180;
function sepArcsec(ra1, de1, ra2, de2) {
  const dra = (ra1 - ra2) * Math.cos(((de1 + de2) / 2) * DEG);
  return Math.hypot(dra, de1 - de2) * 3600;
}

// --- Parse, convert, filter ------------------------------------------------
const lines = readFileSync(CACHE, 'utf8').split('\n');
const header = lines[0].trim().split(',');
const col = Object.fromEntries(header.map((h, i) => [h, i]));
for (const need of ['RAmdeg', 'DEmdeg', 'BTmag', 'VTmag', 'HIP']) {
  if (!(need in col)) throw new Error(`column ${need} missing from TAP result`);
}

const stars = [];
let dropHip = 0;
let noBt = 0;
for (let i = 1; i < lines.length; i++) {
  const row = lines[i].split(',');
  if (row.length < header.length) continue;
  const vt = parseFloat(row[col.VTmag]);
  if (!Number.isFinite(vt)) continue;
  const bt = parseFloat(row[col.BTmag]);
  let v, bv;
  if (Number.isFinite(bt)) {
    v = vt - 0.090 * (bt - vt);
    bv = 0.850 * (bt - vt);
  } else {
    v = vt;
    bv = 0.7; // no BT solution: a middling color beats a wrong one
    noBt++;
  }
  if (v > V_MAX) continue;
  const hip = parseInt(row[col.HIP], 10);
  if (Number.isFinite(hip) && mainHip.has(hip)) {
    dropHip++;
    continue;
  }
  stars.push({
    ra: parseFloat(row[col.RAmdeg]),
    dec: parseFloat(row[col.DEmdeg]),
    v,
    bv,
  });
}

// Positional sweep for bright strays whose HIP field is empty: anything this
// bright and this close to a catalogue star is that star.
const before = stars.length;
const kept = stars.filter((s) => !(s.v < 6.5
  && mainPos.some((m) => Math.abs(m.dec - s.dec) < 0.004
    && sepArcsec(s.ra, s.dec, m.ra, m.dec) < 10)));
const dropPos = before - kept.length;

kept.sort((a, b) => a.v - b.v);

// --- Quantize and write ----------------------------------------------------
const buf = Buffer.alloc(8 + kept.length * 10);
buf.write('MDS1', 0, 'ascii');
buf.writeUInt32LE(kept.length, 4);
kept.forEach((s, i) => {
  const o = 8 + i * 10;
  buf.writeFloatLE(s.ra, o);
  buf.writeFloatLE(s.dec, o + 4);
  buf.writeUInt8(Math.min(255, Math.max(0, Math.round((s.v - 4.0) * 32))), o + 8);
  buf.writeUInt8(Math.min(255, Math.max(0, Math.round((s.bv + 0.5) * 64))), o + 9);
});
writeFileSync(OUT, buf);

const sha256 = createHash('sha256').update(buf).digest('hex');
const prevMeta = existsSync(META) ? JSON.parse(readFileSync(META, 'utf8')) : {};
writeFileSync(META, `${JSON.stringify({
  source: 'Tycho-2 (Hog et al. 2000), VizieR I/259 via TAP; Johnson V and B-V '
    + 'from the standard BT/VT transformations; stars in the app\'s 5,044-star '
    + 'catalogue removed by HIP id plus a 10-arcsec positional sweep below V 6.5.',
  query: QUERY,
  vMax: V_MAX,
  count: kept.length,
  sha256,
  // Independent cross-checks (SIMBAD): kept across regenerations.
  simbadChecks: prevMeta.simbadChecks ?? [],
}, null, 2)}\n`);

console.log(`kept ${kept.length} stars V<=${V_MAX} `
  + `(dropped ${dropHip} by HIP, ${dropPos} by position; ${noBt} had no BT)`);
console.log(`V range ${kept[0].v.toFixed(2)}..${kept[kept.length - 1].v.toFixed(2)}`);
console.log(`wrote ${OUT} (${(buf.length / 1e6).toFixed(1)} MB), sha256 ${sha256.slice(0, 12)}...`);
