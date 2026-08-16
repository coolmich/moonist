// Minimal vector/matrix math on plain arrays so the astro core stays
// importable in node tests without any rendering dependency.
// Vectors are [x, y, z]; matrices are row-major flat arrays of 9.

export const DEG = Math.PI / 180;

export function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function length(a) { return Math.hypot(a[0], a[1], a[2]); }
export function normalize(a) { const l = length(a); return [a[0] / l, a[1] / l, a[2] / l]; }
export function negate(a) { return [-a[0], -a[1], -a[2]]; }

export function mulMV(m, v) {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function mulMM(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  return r;
}

export function transpose(m) {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

// Active rotations: rotZ(θ) rotates a vector by +θ about the z axis.
export function rotZ(deg) {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

export function rotX(deg) {
  const c = Math.cos(deg * DEG), s = Math.sin(deg * DEG);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
