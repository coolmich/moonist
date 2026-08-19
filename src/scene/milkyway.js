import * as THREE from 'three';
import { assetUrl } from '../assetUrl.js';

// The Milky Way: the integrated light of the stars too faint to draw one by
// one. The texture is NASA's Deep Star Maps 2020 resampled by
// scripts/make-milkyway.mjs — a render of 1.7 billion catalogued stars
// (Hipparcos-2, Tycho-2, Gaia DR2), not a photograph and not a mosaic, so the
// band, the star clouds and the dust lanes are all where the catalogue puts
// them. Geometry is EQJ like the star dome; the app rotates it to the local
// horizon frame each frame.
//
// Radiometry: the texture carries the source's linear radiance (times
// TEXTURE_GAIN, which the shader divides out) under an sRGB transfer curve.
// The material is scene-linear and tone-mapped like the stars and the ground —
// no exposure compensation — so the band washes out under a sunlit surface and
// opens up through the lunar night along with everything else.

// Radiance is stored scaled by this and divided back out here; the build script
// records the value it used in the test fixture, and the suite fails if the two
// ever drift apart.
export const TEXTURE_GAIN = 3;

// A display choice, marked as such. Relative brightness across the sky is the
// data's; this constant sets the absolute level. It cannot be derived from the
// star renderer, because that is already on a compressed magnitude curve
// rather than a flux scale: a mag-2 star's sprite here is half a degree wide
// where the real thing is arcseconds, so no single scale can be physical for
// both. Set so the Sagittarius star cloud holds its structure instead of
// blowing out at the top of the night exposure ramp, which is where a
// too-bright band stops looking like a photograph and starts looking painted.
// Raised 1.0 -> 1.5 on 2026-08-17 (user: band too dim); the Sagittarius core
// was re-checked at full night exposure and still holds its structure.
const BRIGHTNESS = 1.5;

// A second display choice, marked as such. The band's colour is the data's --
// the source EXR carries per-star B-V, so the dust really is redder than the
// clouds behind it -- but almost none of it reaches the eye. Measured on
// 2026-08-18: NASA source 0.194 mean saturation, our 8-bit encode 0.168, the
// shipped webp 0.099. Chroma subsampling at quality 68 destroys 41% of what
// survives the encode, and what is left is a grey band.
//
// The stretch is about luminance, so it moves no light around the sky -- the
// per-cell luminance the test fixture pins is untouched by construction. It is
// still a camera's answer rather than an eye's: at these levels human colour
// vision has given up entirely and the honest scotopic view is grey, exactly
// as the exposure ramp elsewhere in this project is a camera's answer. Set to
// land near the colour of a long-exposure photograph of the same sky.
const SATURATION = 2.4;

const RADIUS = 940000; // beyond the star dome, inside the camera's far plane
const URL = assetUrl('textures/milkyway.webp');
const FADE_MS = 700;

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vDir;
  uniform sampler2D uMap;
  uniform float uIntensity;
  uniform float uSaturation;

  const float PI = 3.14159265358979;

  void main() {
    vec3 n = normalize(vDir);
    float ra = atan(n.y, n.x);
    float dec = asin(clamp(n.z, -1.0, 1.0));
    vec2 uv = vec2(ra / (2.0 * PI) + 0.5, dec / PI + 0.5);
    // atan2 jumps a full turn at RA 180°, so dFdx(uv) is garbage there and the
    // hardware picks the smallest mip: a bright seam across the sky.
    // Differentiate the direction and apply the chain rule instead (the Earth
    // globe does the same) — exact, and with no kink at RA 90/270 where a
    // folded stand-in would flatten to zero and over-sharpen the mip.
    vec3 dndx = dFdx(n), dndy = dFdy(n);
    float k = 1.0 / (2.0 * PI * max(n.x * n.x + n.y * n.y, 1e-12));
    float p = 1.0 / (PI * sqrt(max(1.0 - n.z * n.z, 1e-12)));
    vec2 dUVdx = vec2((n.x * dndx.y - n.y * dndx.x) * k, dndx.z * p);
    vec2 dUVdy = vec2((n.x * dndy.y - n.y * dndy.x) * k, dndy.z * p);

    // Band-limit under magnification — the terrain rule, applied to the sky:
    // never present structure finer than the data carries. A texel is 2.6
    // arcmin of integrated light; once it would span more than ~3 screen px,
    // its faint-star speckle stops reading as grain and starts reading as
    // bloated blobs. So past that point, walk up the mip chain to hold the
    // displayed granularity at ~3 px: the speckle melts into the smooth glow
    // it honestly is (the resolved stars on top come from the catalogue), and
    // large-scale band structure survives as long as it is real. Mip box
    // filtering conserves the light, it only stops pretending to place it.
    float fpTexels = max(length(dUVdx * vec2(8192.0, 4096.0)),
                         length(dUVdy * vec2(8192.0, 4096.0)));
    float lod = clamp(log2(1.0 / (3.0 * max(fpTexels, 1e-7))), 0.0, 4.0);
    vec3 radiance = (lod > 0.001
      ? textureLod(uMap, uv, lod).rgb
      : textureGrad(uMap, uv, dUVdx, dUVdy).rgb) * uIntensity;
    // Stretch chroma about luminance (see SATURATION): luminance-preserving,
    // so the band keeps the brightness distribution the data gives it.
    float lum = dot(radiance, vec3(0.2126, 0.7152, 0.0722));
    radiance = max(vec3(lum) + (radiance - vec3(lum)) * uSaturation, 0.0);
    gl_FragColor = vec4(radiance, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createMilkyWay(renderer) {
  // The sky map is 5 MB, so it loads alongside the first frames rather than
  // holding them up, and fades in when it arrives.
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blank.needsUpdate = true;

  const uniforms = {
    uMap: { value: blank },
    uIntensity: { value: 0 },
    uSaturation: { value: SATURATION },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
  });
  const geom = new THREE.SphereGeometry(RADIUS, 64, 32);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  // First thing drawn, and it writes no depth: the ground then paints over it
  // wherever there is ground, and every sky object composites on top.
  mesh.renderOrder = -10;

  let readyAt = 0;
  let dim = 1;
  new THREE.TextureLoader().loadAsync(URL).then((tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    uniforms.uMap.value = tex;
    blank.dispose();
    readyAt = performance.now();
  }).catch((err) => {
    console.warn(`Milky Way map unavailable (${URL}):`, err);
  });

  function applyIntensity() {
    const fade = readyAt ? Math.min(1, (performance.now() - readyAt) / FADE_MS) : 0;
    uniforms.uIntensity.value = (BRIGHTNESS / TEXTURE_GAIN) * dim * fade;
  }

  return {
    group: mesh,
    setOrientation(eqjToScene) {
      const m = eqjToScene;
      mesh.matrix.set(
        m[0], m[1], m[2], 0,
        m[3], m[4], m[5], 0,
        m[6], m[7], m[8], 0,
        0, 0, 0, 1,
      );
    },
    /** Called every frame: carries the daylight wash, and the arrival fade. */
    setDim(v) {
      dim = v;
      applyIntensity();
    },
  };
}
