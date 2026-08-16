import * as THREE from 'three';
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
    fetch(`/terrain/${siteId}.meta.json`).then((r) => {
      if (!r.ok) throw new Error(`terrain meta for ${siteId}: HTTP ${r.status}`);
      return r.json();
    }),
    fetch(`/terrain/${siteId}.bin`).then((r) => {
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

  float mnHash(vec2 p) {
    p = fract(p * vec2(127.31, 311.7) + uGrainSeed);
    p += dot(p, p + 34.19);
    return fract(p.x * p.y);
  }
  float mnNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = mnHash(i), b = mnHash(i + vec2(1.0, 0.0));
    float c = mnHash(i + vec2(0.0, 1.0)), d = mnHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
  }
  // Dust at centimetre scale, pebbles at decimetre scale.
  float mnGrain(vec2 p) {
    return mnNoise(p * 24.0) * 0.008
         + mnNoise(p * 7.0) * 0.022
         + mnNoise(p * 2.1) * 0.05
         + pow(max(mnNoise(p * 3.7), 0.0), 6.0) * 0.16;
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
  positions.set([0, 0, 0], 0);
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
          float grain = 1.0 / (1.0 + camDist * camDist / 900.0);
          if (grain > 0.004) {
            vec2 p = vWorldPos.xz;
            float e = 0.03 + camDist * 0.0015;
            float h0 = mnGrain(p);
            float hx = mnGrain(p + vec2(e, 0.0));
            float hz = mnGrain(p + vec2(0.0, e));
            vec3 bump = vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e) * grain * 1.6;
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
          diffuseColor.rgb *= 1.0 + mnNoise(vWorldPos.xz * 6.0) * 0.16 * grain;
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
