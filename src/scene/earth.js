import * as THREE from 'three';
import { mulMV, transpose } from '../astro/vec.js';

// The Earth in the lunar sky. A shader sphere whose texture mapping is
// computed from object-space direction (body frame: +x → 0°N/0°E, +y → 0°N/90°E,
// +z → north pole), so orientation comes straight from the astro core's
// earth.sceneMatrix with no dependence on SphereGeometry UV conventions.
//
// Textures: Solar System Scope day/night/specular (CC BY 4.0) — equirect,
// 180°W at the left edge → u = lon/2π + 0.5. Live clouds from Matt Eason's
// EUMETSAT-derived maps (CORS *, updates every 3 h), bundled fallback.

const EARTH_DIST = 200000; // scene units; well inside the star dome
const LIVE_CLOUDS_URL = 'https://clouds.matteason.co.uk/images/4096x2048/clouds-alpha.png';
const FALLBACK_CLOUDS_URL = '/textures/clouds-fallback.png';
const CLOUD_REFRESH_MS = 3 * 3600 * 1000;

const VERT = /* glsl */ `
  varying vec3 vObjDir;
  void main() {
    vObjDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vObjDir;
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uSpec;
  uniform sampler2D uClouds;
  uniform vec3 uSunDirBody;
  uniform vec3 uViewDirBody;
  uniform float uBrightness;

  const float PI = 3.14159265358979;

  void main() {
    vec3 n = normalize(vObjDir);
    float lon = atan(n.y, n.x);            // east-positive, 0 at Greenwich
    float lat = asin(clamp(n.z, -1.0, 1.0));
    vec2 uv = vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);
    // atan2 jumps by a full turn at the antimeridian, so the u derivative
    // explodes there and the hardware picks the smallest mip: a bright seam
    // down the mid-Pacific. Differentiate a continuous stand-in instead.
    vec2 uvA = vec2(atan(n.y, abs(n.x)) / (2.0 * PI), uv.y);
    vec2 dUVdx = vec2(dFdx(uvA.x), dFdx(uv.y));
    vec2 dUVdy = vec2(dFdy(uvA.x), dFdy(uv.y));

    float cosSun = dot(n, uSunDirBody);
    float dayT = smoothstep(-0.03, 0.12, cosSun);   // soft twilight band
    float diffuse = max(cosSun, 0.0);

    vec3 day = textureGrad(uDay, uv, dUVdx, dUVdy).rgb;
    vec3 nightLights = textureGrad(uNight, uv, dUVdx, dUVdy).rgb;
    float cloud = textureGrad(uClouds, uv, dUVdx, dUVdy).a;
    float water = textureGrad(uSpec, uv, dUVdx, dUVdy).r;

    // Sunlit side: surface albedo under clouds, lit at the same intensity the
    // Sun lights the regolith (both textures are sRGB-decoded to linear, so
    // the ocean really is ~0.01 and deserts ~0.5 — that contrast is the point).
    vec3 dayLit = day * diffuse;
    vec3 cloudLit = vec3(1.0, 0.99, 0.97) * diffuse;
    dayLit = mix(dayLit, cloudLit, cloud * 0.92);

    // Ocean sun glint where it is not overcast.
    vec3 refl = reflect(-uSunDirBody, n);
    float glint = pow(max(dot(refl, uViewDirBody), 0.0), 140.0);
    dayLit += vec3(1.0, 0.95, 0.85) * glint * water * (1.0 - cloud) * 0.5;

    // Night side: city lights, dimmed under cloud cover.
    vec3 nightSide = nightLights * vec3(1.0, 0.86, 0.66) * 0.85 * (1.0 - cloud * 0.85);
    nightSide += vec3(0.55, 0.65, 0.85) * cloud * 0.004; // hint of moonlit cloud

    vec3 color = mix(nightSide, dayLit, dayT) * uBrightness;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const ATMO_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vObjDir;
  uniform vec3 uSunDirBody;
  uniform vec3 uViewDirBody;
  uniform float uBrightness;
  void main() {
    vec3 n = normalize(vObjDir);
    float limb = 1.0 - abs(dot(n, uViewDirBody));
    float rim = pow(clamp(limb, 0.0, 1.0), 2.2);
    float lit = smoothstep(-0.12, 0.25, dot(n, uSunDirBody));
    vec3 col = vec3(0.30, 0.52, 1.0) * rim * lit * uBrightness * 0.55;
    gl_FragColor = vec4(col, rim * lit * 0.9);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function loadTexture(loader, url, { srgb = true } = {}) {
  return new Promise((resolve, reject) => {
    loader.load(url, (t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      resolve(t);
    }, undefined, reject);
  });
}

export async function createEarth(renderer) {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');

  const [day, night, spec] = await Promise.all([
    loadTexture(loader, '/textures/earth-day.jpg'),
    loadTexture(loader, '/textures/earth-night.jpg'),
    loadTexture(loader, '/textures/earth-specular.png', { srgb: false }),
  ]);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  for (const t of [day, night, spec]) t.anisotropy = Math.min(8, maxAniso);

  // Cloudless placeholder until the live map arrives, so nothing blocks the
  // first frame on a 7 MB download.
  const emptyClouds = new THREE.DataTexture(new Uint8Array([255, 255, 255, 0]), 1, 1);
  emptyClouds.needsUpdate = true;

  const uniforms = {
    uDay: { value: day },
    uNight: { value: night },
    uSpec: { value: spec },
    uClouds: { value: emptyClouds },
    uSunDirBody: { value: new THREE.Vector3(1, 0, 0) },
    uViewDirBody: { value: new THREE.Vector3(1, 0, 0) },
    uBrightness: { value: 1.0 },
  };

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 96),
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG }),
  );

  const atmoUniforms = {
    uSunDirBody: uniforms.uSunDirBody,
    uViewDirBody: uniforms.uViewDirBody,
    uBrightness: uniforms.uBrightness,
  };
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(1.016, 96, 72),
    new THREE.ShaderMaterial({
      uniforms: atmoUniforms,
      vertexShader: VERT,
      fragmentShader: ATMO_FRAG,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );

  const group = new THREE.Group();
  group.add(globe);
  group.add(atmo);

  // Cloud cover: fetch the live EUMETSAT-derived map, fall back to the
  // bundled copy only if that fails, and never leak the texture it replaces.
  // The source republishes every three hours; there is no machine-readable
  // data timestamp, so the app reports when it fetched.
  let cloudStatus = { kind: 'loading', fetchedAt: null };
  let nextCloudFetch = 0;
  let usingFallback = false;
  let cloudFetchInFlight = false;

  function setClouds(tex, kind) {
    const old = uniforms.uClouds.value;
    tex.anisotropy = Math.min(8, maxAniso);
    uniforms.uClouds.value = tex;
    cloudStatus = { kind, fetchedAt: new Date() };
    if (old && old !== tex) old.dispose();
  }

  async function refreshClouds() {
    if (cloudFetchInFlight) return;
    cloudFetchInFlight = true;
    try {
      const live = await loadTexture(loader, `${LIVE_CLOUDS_URL}?t=${Date.now()}`, { srgb: false });
      setClouds(live, 'live');
      usingFallback = false;
      nextCloudFetch = Date.now() + CLOUD_REFRESH_MS;
    } catch {
      // Retry sooner than the normal refresh — a failed load usually means a
      // transient network problem, not three hours of bad weather data.
      nextCloudFetch = Date.now() + 5 * 60 * 1000;
      if (!usingFallback) {
        try {
          setClouds(await loadTexture(loader, FALLBACK_CLOUDS_URL, { srgb: false }), 'offline');
          usingFallback = true;
        } catch {
          cloudStatus = { kind: 'unavailable', fetchedAt: null };
        }
      }
    } finally {
      cloudFetchInFlight = false;
    }
  }
  refreshClouds();

  const rotM = new THREE.Matrix4();

  return {
    group,
    get cloudStatus() {
      return cloudStatus;
    },
    update(state) {
      if (Date.now() > nextCloudFetch) {
        nextCloudFetch = Date.now() + CLOUD_REFRESH_MS; // don't stack requests
        refreshClouds();
      }

      const e = state.earth;
      const radius = EARTH_DIST * Math.sin(e.angRadiusDeg * Math.PI / 180);
      group.position.set(
        e.sceneDir[0] * EARTH_DIST,
        e.sceneDir[1] * EARTH_DIST,
        e.sceneDir[2] * EARTH_DIST,
      );
      group.scale.setScalar(radius);
      const m = e.sceneMatrix; // body → scene, row-major 3x3
      rotM.set(
        m[0], m[1], m[2], 0,
        m[3], m[4], m[5], 0,
        m[6], m[7], m[8], 0,
        0, 0, 0, 1,
      );
      group.setRotationFromMatrix(rotM);

      // Sun and viewer directions in the Earth's body frame.
      const mt = transpose(m);
      const sunBody = mulMV(mt, state.sun.sceneDir);
      const viewBody = mulMV(mt, [-e.sceneDir[0], -e.sceneDir[1], -e.sceneDir[2]]);
      uniforms.uSunDirBody.value.set(sunBody[0], sunBody[1], sunBody[2]).normalize();
      uniforms.uViewDirBody.value.set(viewBody[0], viewBody[1], viewBody[2]).normalize();
    },
    setBrightness(v) {
      uniforms.uBrightness.value = v;
    },
  };
}
