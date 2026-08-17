// Render the site picker's Moon-face preview from the NASA CGI Moon Kit
// color map (LRO LROC/LOLA) — the same credited source the terrain uses.
//
// Output: public/textures/moonface.webp — an orthographic near-side albedo
// disc, north up, EAST TO THE RIGHT: the Moon exactly as it faces the Earth,
// which is the frame a viewer already knows from the night sky. Alpha is
// transparent outside the limb.
//
// The result is landmark-asserted before writing: a disc that mirrored or
// flipped would still look like a Moon, so Crisium, Procellarum and Tycho
// have to be where they belong or the script refuses to ship it.
//
// Usage: node scripts/make-moonface.mjs   (needs cwebp on the PATH)

import { execFileSync } from 'node:child_process';
import { writeFileSync, statSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

const SRC = 'https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_2k.tif';
const OUT = new URL('../public/textures/moonface.webp', import.meta.url).pathname;
const N = 384; // output disc size; drawn at ~54 css px, so this is >2x retina

// --- fetch, then decode via sips ------------------------------------------
// The color map is LZW-compressed TIFF (unlike the uncompressed ldem the
// terrain script parses raw), so macOS's built-in sips converts it to PNG
// and the PNG is decoded here — inflate plus per-row unfiltering.
const dir = mkdtempSync(join(tmpdir(), 'moonface-'));
const tifPath = join(dir, 'src.tif');
const srcPng = join(dir, 'src.png');
writeFileSync(tifPath, execFileSync('curl', ['-sf', '--retry', '3', SRC], { maxBuffer: 1 << 28 }));
execFileSync('sips', ['-s', 'format', 'png', tifPath, '--out', srcPng], { stdio: 'pipe' });

function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let off = 8;
  let w = 0, h = 0, channels = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      if (body[8] !== 8) throw new Error('expected 8-bit PNG');
      channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[body[9]];
      if (body[12] !== 0) throw new Error('interlaced PNG unsupported');
    } else if (type === 'IDAT') {
      idat.push(body);
    }
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = x >= channels && prev ? prev[x - channels] : 0;
      let v = row[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { w, h, channels, data: out };
}

const img = decodePng(execFileSync('cat', [srcPng], { maxBuffer: 1 << 28 }));
const { w: W, h: H, channels: CH } = img;
if (W < 1024) throw new Error(`source too small: ${W}x${H}`);
const pixel = (x, y) => {
  const off = (y * W + x) * CH;
  return [img.data[off], img.data[off + 1], img.data[off + 2]];
};

// Equirect mapping, 180°W at the left edge — the CGI Moon Kit convention the
// terrain script already verified against Horizons-checked landmarks.
const sample = (lonDeg, latDeg) => {
  const x = Math.min(W - 1, Math.max(0, Math.round((lonDeg + 180) / 360 * W - 0.5)));
  const y = Math.min(H - 1, Math.max(0, Math.round((90 - latDeg) / 180 * H - 0.5)));
  return pixel(x, y);
};
const lum = (lonDeg, latDeg) => {
  const [r, g, b] = sample(lonDeg, latDeg);
  return (r + g + b) / 3;
};

// --- landmark assertions ----------------------------------------------------
// Dark maria vs bright highlands, at positions that break under any mirror
// or flip: Crisium sits far east, Procellarum far west, Tycho far south.
const checks = [
  ['Mare Crisium darker than highlands south of it', lum(59, 17), lum(59, -25)],
  ['Oceanus Procellarum darker than southern highlands', lum(-57, 18), lum(-20, -40)],
  ['Mare Imbrium darker than Tycho region', lum(-16, 35), lum(-11, -43)],
];
for (const [what, dark, bright] of checks) {
  if (!(dark < bright * 0.8)) {
    throw new Error(`landmark check failed: ${what} (${dark.toFixed(0)} vs ${bright.toFixed(0)})`);
  }
  console.log(`ok: ${what} (${dark.toFixed(0)} < ${bright.toFixed(0)})`);
}

// --- orthographic near-side disc -------------------------------------------
// Disc frame: +x east (right), +y north (up), +z toward the Earth.
const rgba = Buffer.alloc(N * N * 4);
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / (N / 2) - 1;
    const y = 1 - (j + 0.5) / (N / 2);
    const r2 = x * x + y * y;
    const o = (j * N + i) * 4;
    if (r2 > 1) continue; // transparent
    const z = Math.sqrt(1 - r2);
    const lat = Math.asin(y) * 180 / Math.PI;
    const lon = Math.atan2(x, z) * 180 / Math.PI;
    const [r, g, b] = sample(lon, lat);
    rgba[o] = r;
    rgba[o + 1] = g;
    rgba[o + 2] = b;
    // Soft limb: fade the outer ~1.5 px so the disc does not alias.
    const edge = Math.min(1, (1 - Math.sqrt(r2)) * (N / 2) / 1.5);
    rgba[o + 3] = Math.round(255 * edge);
  }
}

// --- minimal RGBA PNG (for cwebp), then webp --------------------------------
function png(width, height, data) {
  const crcTable = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, body) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'ascii');
    body.copy(out, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let yy = 0; yy < height; yy++) {
    data.copy(raw, yy * (1 + width * 4) + 1, yy * width * 4, (yy + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const tmp = join(dir, 'moonface.png');
writeFileSync(tmp, png(N, N, rgba));
execFileSync('cwebp', ['-quiet', '-q', '90', tmp, '-o', OUT]);
const kb = statSync(OUT).size / 1024;
console.log(`wrote ${OUT} (${kb.toFixed(0)} KB, ${N}x${N})`);
if (kb > 200) throw new Error('preview unexpectedly large');
