import * as THREE from 'three';
import { assetUrl } from '../assetUrl.js';
import { createSurface, fbm, hashSeed, EYE } from './terrain-shape.js';
import { createRocks } from './rocks.js';

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

  // A scalar hash for placing things (craters), as distinct from mnHash2's
  // gradient vectors, which exist to make noise rather than to pick positions.
  float mnHash1(vec2 p) {
    p = fract(p * vec2(127.31, 311.7) + uGrainSeed + 19.7);
    p += dot(p, p + 34.19);
    return fract(p.x * p.y * 95.4307);
  }

  // Micro-craters. The height-field cascade in terrain-shape.js has to stop at
  // the mesh's own cell (~0.035 * distance) or its craters get sampled once per
  // quad and march in rows; everything smaller than that has to be drawn here
  // instead, which is why the ground used to go glassy between the boulders.
  // Each class fades IN as the mesh cell grows past it (so the two never draw
  // the same crater twice) and OUT as the pixel footprint reaches it (so none
  // of them alias into a lattice).
  float mnCraterClass(vec2 p, float R, float dens, float so) {
    float cell = R * 2.6;
    vec2 g = floor(p / cell);
    float h = 0.0;
    for (int oy = -1; oy <= 1; oy++) {
      for (int ox = -1; ox <= 1; ox++) {
        vec2 c = g + vec2(float(ox), float(oy));
        if (mnHash1(c + so) > dens) continue;
        vec2 ctr = (c + vec2(mnHash1(c + so + 3.1), mnHash1(c + so + 7.3))) * cell;
        float rad = R * (0.55 + 0.75 * mnHash1(c + so + 11.9));
        float fresh = mnHash1(c + so + 17.5);
        float d = length(p - ctr) / rad;
        // Bowl inside, raised rim outside: the same profile the mesh cascade
        // uses, one size class down.
        // Fresh simple craters sit near depth/diameter 0.2, i.e. 0.4 of the
        // radius; degraded ones infill toward a third of that. The first cut
        // of this used 0.05-0.17 and was invisible on screen.
        if (d < 1.0) {
          float b = 1.0 - d * d;
          h += -rad * (0.13 + 0.29 * fresh) * b * b + rad * 0.05 * (1.0 - b * b);
        } else if (d < 1.6) {
          float f = (1.6 - d) / 0.6;
          h += rad * 0.05 * f * f;
        }
      }
    }
    return h;
  }

  float mnCraters(vec2 p, float fp, float dist) {
    float meshCell = dist * 0.035;   // MESH_CELL in terrain-shape.js
    float h = 0.0;
    for (int i = 0; i < 3; i++) {
      float R = 0.075 * pow(2.6, float(i));
      float wIn = smoothstep(0.6, 1.5, meshCell / R);      // mesh has lost it
      float wOut = 1.0 - smoothstep(0.16, 0.42, fp / R);   // pixel is reaching it
      float w = wIn * wOut;
      if (w < 0.01) continue;
      h += mnCraterClass(p, R, 0.42, float(i) * 23.0) * w;
    }
    return h;
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
          if (camDist < 900.0) {
            vec2 p = vWorldPos.xz;
            // World size of one pixel here. The slope has to be measured over
            // about that distance: the old fixed 3 cm step straddled the 4 cm
            // dust octave, and differencing across a wavelength turns dust into
            // a tidy grid of dimples — which is what the ground used to show.
            float fp = max(fwidth(vWorldPos.x), fwidth(vWorldPos.z));
            float e = max(fp, 0.012);
            // Grain fades with distance because it stands for dust; craters
            // carry their own distance window instead (mesh cell vs pixel
            // footprint), so they survive out to where the mesh takes over.
            float h0 = mnGrain(p, fp) * grain + mnCraters(p, fp, camDist);
            float hx = mnGrain(p + vec2(e, 0.0), fp) * grain
                     + mnCraters(p + vec2(e, 0.0), fp, camDist);
            float hz = mnGrain(p + vec2(0.0, e), fp) * grain
                     + mnCraters(p + vec2(0.0, e), fp, camDist);
            // The slope is differenced along world X and Z, but at this point
            // in three's chunk order the normal is normalize(vNormal) — VIEW
            // space. Rotate the bump into view before adding it, or the relief
            // is lit from a direction that turns with the camera instead of
            // tracking the Sun: at the heading 180 deg from north the world
            // axes negate and every crater renders convex, disagreeing with
            // both the shadow map and the mesh cascade's own craters. This
            // line predates the micro-craters and the error was invisible
            // while the only carrier was isotropic grain, whose rotated
            // gradient is statistically identical; craters have recognisable
            // shape, so they are what makes it show. mat3(viewMatrix) and not
            // normalMatrix: three declares normalMatrix only in the vertex
            // prefix, and the view matrix is rigid, so its rotation is the
            // correct world->view map for a direction.
            vec3 bump = vec3(-(hx - h0) / e, 0.0, -(hz - h0) / e);
            normal = normalize(normal + mat3(viewMatrix) * bump);
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
          // Past ~15 m a crater is narrower than the pixel that has to draw it,
          // so it can no longer be shaded as relief. What a photograph keeps of
          // it there is contrast, not shape: unresolved bowls and their shadows
          // read as mottling. Carry that as albedo, on the same band-limit
          // logic, or the mid-field goes glassy exactly where the reference
          // imagery is at its most textured.
          float fpc = max(fwidth(vWorldPos.x), fwidth(vWorldPos.z));
          float sub = smoothstep(0.16, 0.42, fpc / 0.5);
          if (sub > 0.01) {
            float t = mnNoise(vWorldPos.xz * 1.7) * 0.55
                    + mnNoise(vWorldPos.xz * 4.3) * 0.3;
            diffuseColor.rgb *= 1.0 + t * 0.20 * sub;
          }
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

  // Blocks ride along as children of the ground, so they follow it through a
  // site change and are disposed with it.
  const rocks = createRocks(surface, noiseSeed, site.rockAbundance ?? 1, site.albedo);
  mesh.add(rocks.group);

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
    rockCount: rocks.count,
    dispose() {
      geom.dispose();
      mat.dispose();
      rocks.dispose();
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
