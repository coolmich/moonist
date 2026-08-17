// Build the Milky Way sky texture from NASA's Deep Star Maps 2020.
//
// The source is NOT a photograph or a mosaic of photographs: it is a render of
// 1.7 billion catalogued stars (Hipparcos-2 brighter than mag 8, Tycho-2 to
// 11.5, Gaia DR2 beyond that), with star colours from B-V temperature and a
// blackbody fit. The Milky Way in it is therefore the real integrated light of
// real stars at their real positions — the band, the star clouds and the dust
// lanes all fall out of the catalogue rather than being painted.
//   https://svs.gsfc.nasa.gov/4851  (NASA/Goddard SVS; Gaia DR2: ESA/Gaia/DPAC)
//
// Source layout (measured, not assumed — see the assertions below): 8192x4096
// linear-light OpenEXR, plate carrée in ICRF/J2000 equatorial coordinates,
// stored rotated 180° from this project's convention (RA decreasing to the
// right, first row at Dec −90). The map's brightest diffuse region lands on
// the Sagittarius star cloud and the LMC lands at its catalogue position only
// in that reading; the other three flip/mirror combinations put the peak on
// the galactic anticentre or scatter the band off the galactic equator.
//
// The 5,044 stars the app draws itself are then subtracted: this layer is the
// light of everything *fainter* than the catalogue, so leaving them in would
// draw each one twice — and the x3 gain below clips their cores, which flattens
// a mag-6 star and a mag-1 star into the same white dot and inverts the
// brightness hierarchy the star shader is built around. Each one is pulled down
// to the local background measured in an annulus around it.
//
// Output: public/textures/milkyway.webp in the project convention — north at
// the top row, u = RA/2π + 0.5 (RA 0 at the centre), the same convention the
// Earth textures use. Values keep the source's LINEAR radiometry and carry
// only the sRGB transfer curve, so the renderer samples it as scene-linear
// radiance and the camera exposure model does all the photographic work.
//
// Radiance is scaled by GAIN before encoding (the renderer divides it back
// out). Eight bits of sRGB over the raw range would put the faint sky at code
// 1-2, where both quantisation and lossy compression cost ~25% of the signal;
// the gain lifts it to code ~4 and the band to ~92 at the price of clipping
// 0.2% of pixels, almost all of them star cores this app draws from the
// catalogue anyway.
//
// Usage: node --max-old-space-size=8192 scripts/make-milkyway.mjs [outWidth]

import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

const SRC = 'https://svs.gsfc.nasa.gov/vis/a000000/a004800/a004851/starmap_2020_8k.exr';
const SRC_W = 8192;
const SRC_H = 4096;
const OUT_W = Number(process.argv[2]) || 8192;
const OUT_H = OUT_W / 2;
const OUT_DIR = new URL('../public/textures/', import.meta.url).pathname;
const OUT_FILE = join(OUT_DIR, 'milkyway.webp');
const FIXTURE = new URL('../tests/fixtures/milkyway-grid.json', import.meta.url).pathname;
const GRID_W = 72;
const GRID_H = 36;
const GAIN = 3;
const QUALITY = 68;
const D = Math.PI / 180;

// --- source ------------------------------------------------------------------
const cache = join(tmpdir(), 'moonist-starmap_2020_8k.exr');
if (!existsSync(cache)) {
  console.log(`fetching ${SRC} (~130 MB)`);
  execFileSync('curl', ['-sf', '--retry', '3', '-o', cache, SRC]);
}
const buf = readFileSync(cache);
const loader = new EXRLoader();
loader.setDataType(THREE.FloatType);
const src = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
if (src.width !== SRC_W || src.height !== SRC_H) {
  throw new Error(`unexpected source size ${src.width}x${src.height}`);
}
const NC = src.data.length / (SRC_W * SRC_H);
const srcLum = (x, y) => {
  const i = (y * SRC_W + x) * NC;
  return 0.2126 * src.data[i] + 0.7152 * src.data[i + 1] + 0.0722 * src.data[i + 2];
};

// --- confirm the source's orientation before trusting it ----------------------
// Galactic pole (IAU 1958, J2000): RA 192.85948°, Dec 27.12825°.
const RA_P = 192.85948 * D;
const DEC_P = 27.12825 * D;
function galacticLat(raDeg, decDeg) {
  const ra = raDeg * D;
  const dec = decDeg * D;
  return Math.asin(
    Math.sin(dec) * Math.sin(DEC_P) + Math.cos(dec) * Math.cos(DEC_P) * Math.cos(ra - RA_P),
  ) / D;
}
// Source pixel → sky, in the reading this script assumes.
const srcRa = (x) => (180 - ((x + 0.5) / SRC_W) * 360 + 360) % 360;
const srcDec = (y) => -90 + ((y + 0.5) / SRC_H) * 180;
{
  // The diffuse band must sit on the galactic equator: sample a coarse grid of
  // 40th-percentile blocks (percentile so single bright stars cannot define it).
  const near = [];
  const far = [];
  for (let by = 4; by < 60; by++) {
    for (let bx = 0; bx < 128; bx++) {
      const vals = [];
      for (let y = by * 64; y < by * 64 + 64; y += 8) {
        for (let x = bx * 64; x < bx * 64 + 64; x += 8) vals.push(srcLum(x, y));
      }
      vals.sort((a, b) => a - b);
      const bg = vals[Math.floor(vals.length * 0.4)];
      const b = Math.abs(galacticLat(srcRa(bx * 64 + 32), srcDec(by * 64 + 32)));
      if (b < 5) near.push(bg);
      else if (b > 60) far.push(bg);
    }
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const contrast = mean(near) / mean(far);
  if (!(contrast > 5)) {
    throw new Error(`galactic plane is not where it should be (contrast ${contrast.toFixed(2)})`);
  }
  // The peak of the integrated light is the Sagittarius star cloud, not the
  // anticentre: this is what breaks the 180°-rotation ambiguity.
  const boxMean = (raDeg, decDeg) => {
    const x0 = Math.round(((180 - raDeg + 360) % 360) / 360 * SRC_W);
    const y0 = Math.round((decDeg + 90) / 180 * SRC_H);
    let s = 0;
    let n = 0;
    for (let y = y0 - 24; y <= y0 + 24; y += 2) {
      for (let x = x0 - 24; x <= x0 + 24; x += 2) {
        s += srcLum(((x % SRC_W) + SRC_W) % SRC_W, Math.min(SRC_H - 1, Math.max(0, y)));
        n++;
      }
    }
    return s / n;
  };
  const centre = boxMean(268.0, -25.0);   // Sgr star cloud
  const anti = boxMean(88.0, 30.0);       // galactic anticentre, same |b|
  if (!(centre > anti * 1.5)) {
    throw new Error(`source appears rotated: centre/anticentre = ${(centre / anti).toFixed(2)}`);
  }
  console.log(`orientation ok: plane/pole ${contrast.toFixed(1)}x, centre/anticentre ${(centre / anti).toFixed(1)}x`);
}

// --- subtract the stars the app draws itself -----------------------------------
{
  const stars = JSON.parse(readFileSync(
    new URL('../public/data/stars.6.json', import.meta.url).pathname, 'utf8',
  ));
  const at = (x, y) => (((y * SRC_W + ((x % SRC_W) + SRC_W) % SRC_W)) * NC);
  let removed = 0;
  let brightest = 0;
  for (const f of stars.features) {
    const [lonDeg, latDeg] = f.geometry.coordinates;
    const ra = lonDeg < 0 ? lonDeg + 360 : lonDeg;
    const mag = f.properties.mag;
    const cx = ((180 - ra + 360) % 360) / 360 * SRC_W - 0.5;
    const cy = (latDeg + 90) / 180 * SRC_H - 0.5;
    // Core radius by magnitude: the render's PSF grows with brightness, and a
    // mag -1 star saturates ~9 texels across where a mag 6 one is barely 3.
    const r0 = Math.min(11, Math.max(2.5, 2.5 + (6.5 - mag) * 1.0)) * (SRC_W / 8192);
    const r1 = r0 + 3;
    const r2 = r0 + 9;
    // Local background: the median of an annulus, so a neighbouring star or a
    // dust lane edge cannot drag it.
    const ring = [];
    for (let dy = -Math.ceil(r2); dy <= Math.ceil(r2); dy++) {
      const y = Math.round(cy) + dy;
      if (y < 0 || y >= SRC_H) continue;
      for (let dx = -Math.ceil(r2); dx <= Math.ceil(r2); dx++) {
        const d = Math.hypot(dx, dy);
        if (d < r1 || d > r2) continue;
        const i = at(Math.round(cx) + dx, y);
        ring.push(0.2126 * src.data[i] + 0.7152 * src.data[i + 1] + 0.0722 * src.data[i + 2]);
      }
    }
    if (!ring.length) continue;
    ring.sort((a, b) => a - b);
    const bg = ring[ring.length >> 1];
    for (let dy = -Math.ceil(r0 + 2); dy <= Math.ceil(r0 + 2); dy++) {
      const y = Math.round(cy) + dy;
      if (y < 0 || y >= SRC_H) continue;
      for (let dx = -Math.ceil(r0 + 2); dx <= Math.ceil(r0 + 2); dx++) {
        const d = Math.hypot(dx, dy);
        const w = d <= r0 ? 1 : d < r0 + 2 ? (r0 + 2 - d) / 2 : 0;
        if (w <= 0) continue;
        const i = at(Math.round(cx) + dx, y);
        const lum = 0.2126 * src.data[i] + 0.7152 * src.data[i + 1] + 0.0722 * src.data[i + 2];
        if (lum <= bg) continue;
        brightest = Math.max(brightest, lum);
        // Pull the excess over the background down, keeping the hue.
        const scale = (bg + (lum - bg) * (1 - w)) / lum;
        src.data[i] *= scale;
        src.data[i + 1] *= scale;
        src.data[i + 2] *= scale;
      }
    }
    removed++;
  }
  console.log(`subtracted ${removed} catalogue stars (peak removed radiance ${brightest.toFixed(3)})`);
}

// --- resample -----------------------------------------------------------------
// Project convention → source is a 180° rotation, so this is an exact gather
// (plus box averaging when the output is smaller than the source).
const step = SRC_W / OUT_W;
if (!Number.isInteger(step)) throw new Error(`out width must divide ${SRC_W}`);
const rgb = new Uint8Array(OUT_W * OUT_H * 3);

// sRGB transfer curve, and a deterministic ±0.5 LSB dither so the faint sky
// gradients quantise to grain rather than to contour bands.
const srgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
function dither(x, y, c) {
  let h = (x * 374761393 + y * 668265263 + c * 2147483647) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296 - 0.5;
}

let maxLin = 0;
let clipped = 0;
for (let Y = 0; Y < OUT_H; Y++) {
  const sy0 = (OUT_H - 1 - Y) * step;
  for (let X = 0; X < OUT_W; X++) {
    const sx0 = (OUT_W - 1 - X) * step;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let dy = 0; dy < step; dy++) {
      for (let dx = 0; dx < step; dx++) {
        const i = ((sy0 + dy) * SRC_W + (sx0 + dx)) * NC;
        r += src.data[i];
        g += src.data[i + 1];
        b += src.data[i + 2];
      }
    }
    const n = step * step;
    r /= n; g /= n; b /= n;
    maxLin = Math.max(maxLin, r, g, b);
    if (Math.max(r, g, b) * GAIN > 1) clipped++;
    const o = (Y * OUT_W + X) * 3;
    rgb[o] = Math.min(255, Math.max(0, Math.round(srgb(Math.min(1, r * GAIN)) * 255 + dither(X, Y, 0))));
    rgb[o + 1] = Math.min(255, Math.max(0, Math.round(srgb(Math.min(1, g * GAIN)) * 255 + dither(X, Y, 1))));
    rgb[o + 2] = Math.min(255, Math.max(0, Math.round(srgb(Math.min(1, b * GAIN)) * 255 + dither(X, Y, 2))));
  }
}
console.log(`resampled to ${OUT_W}x${OUT_H} (peak source radiance ${maxLin.toFixed(3)}, `
  + `${(clipped / (OUT_W * OUT_H) * 100).toFixed(3)}% clipped by the x${GAIN} gain)`);

// --- encode -------------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });
const pam = join(tmpdir(), 'moonist-milkyway.pam');
const header = Buffer.from(
  `P7\nWIDTH ${OUT_W}\nHEIGHT ${OUT_H}\nDEPTH 3\nMAXVAL 255\nTUPLTYPE RGB\nENDHDR\n`,
  'ascii',
);
writeFileSync(pam, Buffer.concat([header, Buffer.from(rgb.buffer, rgb.byteOffset, rgb.length)]));
execFileSync('cwebp', [
  '-q', String(QUALITY), '-m', '6', '-sharp_yuv', '-metadata', 'none', pam, '-o', OUT_FILE,
], { stdio: 'inherit' });
const out = readFileSync(OUT_FILE);
console.log(`wrote ${OUT_FILE} (${(out.length / 1e6).toFixed(2)} MB)`);

// --- fixture ------------------------------------------------------------------
// Measured by decoding the file that just shipped, not the buffer that went
// into the encoder, so the tests check the actual pixels. The hash ties the
// measurements to the file: re-encode without rerunning this and they fail.
const ppmPath = join(tmpdir(), 'moonist-milkyway-check.ppm');
execFileSync('dwebp', ['-quiet', '-ppm', OUT_FILE, '-o', ppmPath]);
const dec = (() => {
  const buf = readFileSync(ppmPath);
  let o = 0;
  const tok = () => {
    while (buf[o] === 32 || buf[o] === 10 || buf[o] === 13 || buf[o] === 9) o++;
    let s = '';
    while (o < buf.length && ![32, 10, 13, 9].includes(buf[o])) s += String.fromCharCode(buf[o++]);
    return s;
  };
  if (tok() !== 'P6') throw new Error('dwebp did not produce a P6 PPM');
  const w = Number(tok());
  const h = Number(tok());
  tok();
  o++;
  return { w, h, px: buf.subarray(o) };
})();
if (dec.w !== OUT_W || dec.h !== OUT_H) throw new Error('decoded size mismatch');
const toLinear = (u) => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
const lut = Array.from({ length: 256 }, (_, i) => toLinear(i / 255));
const decLum = (X, Y) => {
  const o = ((Y * OUT_W + ((X % OUT_W) + OUT_W) % OUT_W)) * 3;
  return 0.2126 * lut[dec.px[o]] + 0.7152 * lut[dec.px[o + 1]] + 0.0722 * lut[dec.px[o + 2]];
};

const grid = [];
for (let gy = 0; gy < GRID_H; gy++) {
  for (let gx = 0; gx < GRID_W; gx++) {
    let s = 0;
    let n = 0;
    for (let Y = Math.floor(gy * OUT_H / GRID_H); Y < Math.floor((gy + 1) * OUT_H / GRID_H); Y += 2) {
      for (let X = Math.floor(gx * OUT_W / GRID_W); X < Math.floor((gx + 1) * OUT_W / GRID_W); X += 2) {
        s += decLum(X, Y);
        n++;
      }
    }
    grid.push(Number((s / n).toPrecision(5)));
  }
}

// Residual spike at each of the brightest catalogue stars, against the local
// background — this is what proves the subtraction above actually happened in
// the shipped pixels rather than only in the author's intention.
const catalogue = JSON.parse(readFileSync(
  new URL('../public/data/stars.6.json', import.meta.url).pathname, 'utf8',
));
const starChecks = catalogue.features
  .map((f) => ({ mag: f.properties.mag, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }))
  .sort((a, b) => a.mag - b.mag)
  .slice(0, 300)
  .map(({ mag, lon, lat }) => {
    const ra = lon < 0 ? lon + 360 : lon;
    const cx = (((ra + 180) % 360) / 360) * OUT_W - 0.5;
    const cy = ((90 - lat) / 180) * OUT_H - 0.5;
    let peak = 0;
    const ring = [];
    for (let dy = -18; dy <= 18; dy++) {
      const Y = Math.round(cy) + dy;
      if (Y < 0 || Y >= OUT_H) continue;
      for (let dx = -18; dx <= 18; dx++) {
        const d = Math.hypot(dx, dy);
        const v = decLum(Math.round(cx) + dx, Y);
        if (d <= 5) peak = Math.max(peak, v);
        else if (d >= 13 && d <= 18) ring.push(v);
      }
    }
    ring.sort((a, b) => a - b);
    return {
      mag,
      peak: Number(peak.toPrecision(4)),
      bg: Number((ring[ring.length >> 1] ?? 0).toPrecision(4)),
    };
  });
const worst = starChecks.reduce((m, s) => Math.max(m, s.bg > 0 ? s.peak / s.bg : 0), 0);
console.log(`brightest 300 catalogue stars: worst residual peak/background ${worst.toFixed(2)}x`);
writeFileSync(FIXTURE, `${JSON.stringify({
  source: SRC,
  credit: 'NASA/Goddard Space Flight Center Scientific Visualization Studio; Gaia DR2: ESA/Gaia/DPAC',
  texture: 'public/textures/milkyway.webp',
  width: OUT_W,
  height: OUT_H,
  gain: GAIN,
  bytes: out.length,
  sha256: createHash('sha256').update(out).digest('hex'),
  // Mean linear luminance per cell of the shipped texture, row 0 = Dec +90,
  // column 0 = RA 180° (u = RA/2π + 0.5).
  gridWidth: GRID_W,
  gridHeight: GRID_H,
  grid,
  // Residual peak vs local background at the 300 brightest catalogue stars.
  starChecks,
}, null, 1)}\n`);
console.log(`wrote ${FIXTURE}`);
