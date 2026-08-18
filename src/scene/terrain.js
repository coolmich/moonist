import * as THREE from 'three';
import { assetUrl } from '../assetUrl.js';
import { createSurface, fbm, hashSeed, EYE } from './terrain-shape.js';

// The ground: one continuous polar mesh centered on the observer, built from
// the site's real LOLA patch plus the procedural detail in terrain-shape.js.
// Everything below the mesh's resolution — regolith grain, pebbles, the fine
// shadowing that makes the surface read as dust rather than clay — is added
// per-fragment in the material.

const SPOKES = 320;
const RINGS = 320;
const R_MIN = 0.35;
const R_MAX = 65000;

async function loadPatch(siteId) {
  const [meta, bin] = await Promise.all([
    fetch(assetUrl(`terrain/${siteId}.meta.json`)).then((r) => {
      if (!r.ok) throw new Error(`terrain meta for ${siteId}: HTTP ${r.status}`);
      return r.json();
    }),
    fetch(assetUrl(`terrain/${siteId}.bin`)).then((r) => {
      if (!r.ok) throw new Error(`terrain data for ${siteId}: HTTP ${r.status}`);
      return r.arrayBuffer();
    }),
  ]);
  return { meta, data: new Float32Array(bin) };
}

// Per-fragment regolith: normal perturbation and albedo speckle at scales the
// mesh cannot carry, faded out with distance so it never aliases.
const DETAIL_PARS = /* glsl */ `
  varying vec3 vWorldPos;
  uniform vec3 uSunDir;
  uniform float uGrainSeed;

  // A random unit gradient per lattice point. Value noise was the wrong tool
  // here: its extrema sit exactly ON the lattice, so every octave marks out its
  // own grid and the ground reads as woven rather than weathered. Gradient
  // noise is zero at the lattice points and peaks between them, at positions
  // the gradients choose.
  vec2 mnHash2(vec2 p) {
    p = fract(p * vec2(127.31, 311.7) + uGrainSeed);
    p += dot(p, p + 34.19);
    vec2 h = fract(vec2(p.x * p.y, p.x + p.y * 1.61803)) * 2.0 - 1.0;
    return h * inversesqrt(max(dot(h, h), 1e-6));
  }
  float mnNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = dot(mnHash2(i), f);
    float b = dot(mnHash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
    float c = dot(mnHash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
    float d = dot(mnHash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6;
  }
  // Dust at centimetre scale, pebbles at decimetre scale. Kept coherent:
  // high-frequency noise dominating reads as TV static, not regolith.
  //
  // Each octave is turned by 40 degrees first. The noise lattice is square and
  // the scene axes are due east and due south, so stacking octaves on one
  // orientation lines the pebbles up in rows — which is the one thing real
  // regolith never does.
  const mat2 MN_TURN = mat2(0.76604, -0.64279, 0.64279, 0.76604);

  // An octave whose wavelength has dropped near the size of a pixel cannot be
  // sampled any more: what reaches the screen is the lattice it was built on,
  // not the dust it stands for. Fade each one out as it approaches that limit.
  float mnBand(float fp, float freq) {
    return 1.0 - smoothstep(0.15, 0.4, fp * freq);
  }

  float mnGrain(vec2 p, float fp) {
    // Value noise puts its extrema on the lattice, so raising one octave to a
    // high power — which is what makes the pebbles — lays down exactly one
    // pebble per cell, in rows. Warping the domain with a slower noise first
    // scatters them; rotating alone only turns the rows diagonal.
    vec2 w = vec2(mnNoise(p * 0.83), mnNoise(p * 0.83 + 41.7)) * 0.75;
    vec2 a = p;
    float h = mnNoise(a * 24.0) * 0.004 * mnBand(fp, 24.0);
    a = MN_TURN * a;
    h += mnNoise(a * 6.0) * 0.018 * mnBand(fp, 6.0);
    a = MN_TURN * a;
    h += mnNoise(a * 1.7) * 0.06 * mnBand(fp, 1.7);
    vec2 q = MN_TURN * (p + w);
    h += pow(max(mnNoise(q * 2.6), 0.0), 5.0) * 0.13 * mnBand(fp, 2.6);
    h += pow(max(mnNoise((MN_TURN * q) * 1.61 + 7.3), 0.0), 5.0) * 0.13 * mnBand(fp, 1.61);
    return h;
  }
`;

export async function createTerrain(site) {
  const { meta, data } = await loadPatch(site.id);
  const surface = createSurface(meta, data, site);
  const noiseSeed = hashSeed(site.id) ^ 0x51ed270b;

  const vertCount = (RINGS + 1) * SPOKES + 1;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);

  // Albedo: the site's real normal albedo (mare ~0.08, highlands ~0.18)
  // scaled once into the renderer's diffuse range, with mottling and slightly
  // brighter fresh crater rims.
  const base = site.albedo * 2.2;
  function shade(x, z, s, out, idx) {
    const mottle = 1
      + 0.16 * fbm(x / 55, -z / 55, noiseSeed + 31, 3)
      + 0.08 * fbm(x / 6, -z / 6, noiseSeed + 47, 2);
    const a = base * mottle * (1 + Math.min(s.rim, 1) * 0.35);
    out[idx] = a;
    out[idx + 1] = a * 0.982;
    out[idx + 2] = a * 0.947;
  }

  const c0 = surface.surfaceAt(0, 0);
  positions.set([0, c0.y, 0], 0);
  shade(0, 0, c0, colors, 0);

  for (let k = 0; k <= RINGS; k++) {
    const r = R_MIN * Math.pow(R_MAX / R_MIN, k / RINGS);
    for (let sp = 0; sp < SPOKES; sp++) {
      const th = (sp / SPOKES) * Math.PI * 2;
      const x = r * Math.sin(th);
      const z = -r * Math.cos(th);
      const s = surface.surfaceAt(x, z);
      const idx = (1 + k * SPOKES + sp) * 3;
      positions[idx] = x;
      positions[idx + 1] = s.y;
      positions[idx + 2] = z;
      shade(x, z, s, colors, idx);
    }
  }

  const indices = [];
  for (let sp = 0; sp < SPOKES; sp++) {
    indices.push(0, 1 + ((sp + 1) % SPOKES), 1 + sp);
  }
  for (let k = 0; k < RINGS; k++) {
    for (let sp = 0; sp < SPOKES; sp++) {
      const a = 1 + k * SPOKES + sp;
      const b = 1 + k * SPOKES + ((sp + 1) % SPOKES);
      const c = a + SPOKES;
      const d = b + SPOKES;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geom.setIndex(indices);
  geom.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1.0,
    metalness: 0.0,
  });
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uGrainSeed: { value: (noiseSeed % 1000) / 1000 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    mat.userData.shader = shader;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec3 vWorldPos;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DETAIL_PARS}`)
      // Perturb the normal with sub-mesh-scale relief, close in only.
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        {
          float camDist = length(cameraPosition - vWorldPos);
          float grain = 1.0 / (1.0 + camDist * camDist / 400.0);
          if (grain > 0.004) {
            vec2 p = vWorldPos.xz;
            // World size of one pixel here. The slope has to be measured over
            // about that distance: the old fixed 3 cm step straddled the 4 cm
            // dust octave, and differencing across a wavelength turns dust into
            // a tidy grid of dimples — which is what the ground used to show.
            float fp = max(fwidth(vWorldPos.x), fwidth(vWorldPos.z));
            float e = max(fp, 0.012);
            float h0 = mnGrain(p, fp);
            float hx = mnGrain(p + vec2(e, 0.0), fp);
            float hz = mnGrain(p + vec2(0.0, e), fp);
            vec3 bump = vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * grain;
            normal = normalize(normal + bump);
          }
        }`)
      // Regolith speckle in the albedo, and the opposition surge: real
      // regolith backscatters, brightening sharply toward the anti-solar
      // point — the glow around the photographer's shadow in Apollo frames.
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float camDist = length(cameraPosition - vWorldPos);
          float grain = 1.0 / (1.0 + camDist * camDist / 2500.0);
          diffuseColor.rgb *= 1.0 + mnNoise(vWorldPos.xz * 2.2) * 0.09 * grain;
        }`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        {
          vec3 toEye = normalize(cameraPosition - vWorldPos);
          float g = max(dot(toEye, uSunDir), 0.0);
          float surge = 1.0 + 0.32 * pow(g, 9.0) + 0.12 * pow(g, 2.0);
          gl_FragColor.rgb *= surge;
        }`);
  };

  const mesh = new THREE.Mesh(geom, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;

  // Skyline profile, so sky labels hide behind ridges rather than floating in
  // front of a 4 km massif.
  const eyeY = c0.y + EYE;
  const HB = 360;
  const horizon = new Float32Array(HB);
  for (let b = 0; b < HB; b++) {
    horizon[b] = surface.skylineAlt((b / HB) * Math.PI * 2, eyeY);
  }

  return {
    group: mesh,
    surface,
    heightAt: surface.heightAt,
    /** Ground height under the observer; the camera sits EYE metres above it. */
    groundY: c0.y,
    dispose() {
      geom.dispose();
      mat.dispose();
    },
    setSunDir(v) {
      uniforms.uSunDir.value.set(v[0], v[1], v[2]);
    },
    /** Skyline altitude (radians) toward an azimuth given in radians. */
    horizonAlt(azRad) {
      const t = (((azRad / (Math.PI * 2)) % 1) + 1) % 1 * HB;
      const i0 = Math.floor(t) % HB;
      const i1 = (i0 + 1) % HB;
      const f = t - Math.floor(t);
      return horizon[i0] * (1 - f) + horizon[i1] * f;
    },
  };
}

export { EYE };
