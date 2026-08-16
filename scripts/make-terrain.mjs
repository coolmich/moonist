// Extract per-site LOLA elevation patches from the NASA CGI Moon Kit
// displacement map ldem_64_uint.tif (23040x11520, 64 px/deg ≈ 475 m/px).
//
// The file is 530 MB, but it is an uncompressed TIFF with one row per strip,
// so each site only needs the ~300 rows covering its patch. Rows are pulled
// with HTTP range requests through curl (geotiff.js opens parallel sockets
// that hit an unreachable IPv6 route for this host).
//
// Encoding: uint16 counts of 0.5 m over radius 1727.4 km
//   elevation_m = raw * 0.5 - 10000   (relative to the 1737.4 km sphere)
//
// Output per site: public/terrain/<id>.bin  (Float32 elevation meters,
// row-major, row 0 = north edge) and <id>.meta.json.
//
// Usage: node scripts/make-terrain.mjs

import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { SITES } from '../src/sites.js';

const SRC = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_64_uint.tif';
const OUT_DIR = new URL('../public/terrain/', import.meta.url).pathname;
const PPD = 64;
const W = 360 * PPD;   // 23040
const H = 180 * PPD;   // 11520
const ROW_BYTES = W * 2;
const HALF_DEG_LAT = 2.4; // patch half-extent in latitude (~73 km)
const N = 512;            // output grid (~285 m/sample)

function range(start, end) {
  return execFileSync('curl', ['-sf', '--retry', '3', '-r', `${start}-${end}`, SRC], {
    maxBuffer: 1 << 29,
  });
}

// --- TIFF structure ---------------------------------------------------------
const head = range(0, 15);
if (head.toString('ascii', 0, 2) !== 'II' || head.readUInt16LE(2) !== 42) {
  throw new Error('not a little-endian classic TIFF');
}
const ifdOff = head.readUInt32LE(4);
const entryCount = range(ifdOff, ifdOff + 1).readUInt16LE(0);
const entries = range(ifdOff + 2, ifdOff + 2 + entryCount * 12 - 1);
const tags = {};
for (let i = 0; i < entryCount; i++) {
  const o = i * 12;
  tags[entries.readUInt16LE(o)] = { count: entries.readUInt32LE(o + 4), value: entries.readUInt32LE(o + 8) };
}
if (tags[256].value !== W || tags[257].value !== H) {
  throw new Error(`unexpected dimensions ${tags[256].value}x${tags[257].value}`);
}
if (tags[259].value !== 1) throw new Error('expected uncompressed TIFF');
if (tags[278].value !== 1) throw new Error('expected one row per strip');

// Row offsets (11520 uint32s).
const stripOffsets = range(tags[273].value, tags[273].value + tags[273].count * 4 - 1);
const rowOffset = (row) => stripOffsets.readUInt32LE(row * 4);

mkdirSync(OUT_DIR, { recursive: true });

const px = (lon) => (lon + 180) * PPD - 0.5;
const py = (lat) => (90 - lat) * PPD - 0.5;

for (const site of SITES) {
  const halfLat = HALF_DEG_LAT;
  const halfLon = HALF_DEG_LAT / Math.max(Math.cos(site.lat * Math.PI / 180), 0.2);

  const y0 = Math.max(0, Math.floor(py(site.lat + halfLat)) - 1);
  const y1 = Math.min(H - 1, Math.ceil(py(site.lat - halfLat)) + 1);
  const rows = y1 - y0 + 1;

  // Rows are stored contiguously; pull them in one range request.
  const first = rowOffset(y0);
  const last = rowOffset(y1) + ROW_BYTES - 1;
  if (last - first + 1 !== rows * ROW_BYTES) throw new Error('rows are not contiguous');
  const buf = range(first, last);
  const raw = new Uint16Array(buf.buffer, buf.byteOffset, rows * W);

  const at = (ix, iy) => {
    const x = ((ix % W) + W) % W;
    const y = Math.min(Math.max(iy, y0), y1) - y0;
    return raw[y * W + x];
  };

  function sample(lonDeg, latDeg) {
    const x = px(lonDeg);
    const y = py(latDeg);
    const x0 = Math.floor(x), yy0 = Math.floor(y);
    const fx = x - x0, fy = y - yy0;
    const v =
      at(x0, yy0) * (1 - fx) * (1 - fy) +
      at(x0 + 1, yy0) * fx * (1 - fy) +
      at(x0, yy0 + 1) * (1 - fx) * fy +
      at(x0 + 1, yy0 + 1) * fx * fy;
    return v * 0.5 - 10000;
  }

  const data = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const lat = site.lat + halfLat - (j / (N - 1)) * 2 * halfLat; // north → south
    for (let i = 0; i < N; i++) {
      const lon = site.lon - halfLon + (i / (N - 1)) * 2 * halfLon;
      data[j * N + i] = sample(lon, lat);
    }
  }
  const center = sample(site.lon, site.lat);

  writeFileSync(`${OUT_DIR}${site.id}.bin`, Buffer.from(data.buffer));
  writeFileSync(`${OUT_DIR}${site.id}.meta.json`, JSON.stringify({
    id: site.id,
    lat: site.lat,
    lon: site.lon,
    halfLatDeg: halfLat,
    halfLonDeg: halfLon,
    n: N,
    centerElevM: center,
    order: 'row-major, row 0 = north edge, col 0 = west edge',
    source: 'NASA SVS CGI Moon Kit ldem_64_uint.tif (LRO LOLA), 64 ppd (~475 m/px)',
  }, null, 2));

  let min = Infinity, max = -Infinity;
  for (const v of data) { if (v < min) min = v; if (v > max) max = v; }
  console.log(
    `${site.id.padEnd(9)} center ${center.toFixed(0).padStart(6)} m, ` +
    `relief ${(min - center).toFixed(0).padStart(6)} .. ${(max - center).toFixed(0).padStart(5)} m ` +
    `(${(rows * ROW_BYTES / 1e6).toFixed(0)} MB fetched)`,
  );
}
console.log('done');
