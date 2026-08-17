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
const liveCloudsUrl = (w) => `https://clouds.matteason.co.uk/images/${w}x${w / 2}/clouds-alpha.png`;
const FALLBACK_CLOUDS_URL = '/textures/clouds-fallback.png';
const CLOUD_REFRESH_MS = 3 * 3600 * 1000;
// The source publishes the same map at 4096 and 8192 wide. The 8k is real
// extra detail, not an upscale — box-downsampling it reproduces the 4k to a
// mean of 3.5 levels, while its own gradient energy is 0.79x the 4k's rather
// than the 0.5x a pure interpolation would give — but it costs 24 MB against
// 7. An equirect map is oversampled until the disc is drawn wider than half
// the texture, so the 4k is already more than the screen can show until the
// view is zoomed well in; the 8k is fetched at that point and not before.
const CLOUD_W_BASE = 4096;
const CLOUD_W_DEEP = 8192;

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
  uniform float uViewDistBody;
  uniform float uBrightness;

  const float PI = 3.14159265358979;

  void main() {
    vec3 n = normalize(vObjDir);
    float lon = atan(n.y, n.x);            // east-positive, 0 at Greenwich
    float lat = asin(clamp(n.z, -1.0, 1.0));
    vec2 uv = vec2(lon / (2.0 * PI) + 0.5, lat / PI + 0.5);
    // atan2 jumps by a full turn at the antimeridian, so dFdx(uv) is garbage
    // there and the hardware picks the smallest mip: a bright seam down the
    // mid-Pacific. Differentiate the direction and apply the chain rule
    // instead — exact, and continuous everywhere except exactly on the poles.
    vec3 dndx = dFdx(n), dndy = dFdy(n);
    float k = 1.0 / (2.0 * PI * max(n.x * n.x + n.y * n.y, 1e-12));
    float p = 1.0 / (PI * sqrt(max(1.0 - n.z * n.z, 1e-12)));
    vec2 dUVdx = vec2((n.x * dndx.y - n.y * dndx.x) * k, dndx.z * p);
    vec2 dUVdy = vec2((n.x * dndy.y - n.y * dndy.x) * k, dndy.z * p);

    float cosSun = dot(n, uSunDirBody);
    float dayT = smoothstep(-0.03, 0.12, cosSun);   // soft twilight band
    float diffuse = max(cosSun, 0.0);

    vec3 day = textureGrad(uDay, uv, dUVdx, dUVdy).rgb;
    vec3 nightLights = textureGrad(uNight, uv, dUVdx, dUVdy).rgb;
    float cloudRaw = textureGrad(uClouds, uv, dUVdx, dUVdy).a;
    float water = textureGrad(uSpec, uv, dUVdx, dUVdy).r;

    // The cloud map carries one number per texel — satellite-measured
    // brightness, which conflates how much sky the cloud covers with how
    // brightly it reflects. Splitting that number into the two is a display
    // choice, but not a free one: the pair is pinned by a measured constant.
    //
    // Painting cloud as a perfect white reflector (albedo 1.0, what this did)
    // made the planet return 0.601 of the light falling on it — 1.96x the
    // Earth's measured Bond albedo of 0.306 — and that excess is precisely
    // what washed the disc out. Everything landed in the shoulder of the ACES
    // curve, where its slope is ~0.13 against ~0.89 in the midtones, so the
    // map's structure was compressed 7x on the way to the screen: a milky
    // sheet with the ocean painted over at 92% opacity.
    //
    // Coverage v^1.5 with reflectance rising 0.25 -> 0.59 across the same
    // range puts the planet back on 0.306 exactly, and gives thin cirrus and
    // a convective tower the different brightnesses they have in life. The
    // exponent is the free parameter in that split; 1.5 was chosen by eye
    // against the source imagery, with the reflectance solved from it so the
    // total reflected light stays right whatever the exponent.
    float cover = 0.92 * pow(cloudRaw, 1.5);
    float cloudAlb = 0.25 + 0.342 * cloudRaw;

    // Sunlit side: surface albedo under clouds, lit at the same intensity the
    // Sun lights the regolith (both textures are sRGB-decoded to linear, so
    // the ocean really is ~0.01 and deserts ~0.5 — that contrast is the point).
    vec3 dayLit = day * diffuse;
    vec3 cloudLit = vec3(1.0, 0.99, 0.97) * cloudAlb * diffuse;
    dayLit = mix(dayLit, cloudLit, cover);

    // Ocean sun glint where it is not overcast. The viewer is not at infinity
    // once the mesh is magnified (x10 puts it ~6 radii out), so use the true
    // per-fragment view ray, not the disc-centre direction.
    vec3 refl = reflect(-uSunDirBody, n);
    vec3 toView = normalize(uViewDirBody * uViewDistBody - n);
    float glint = pow(max(dot(refl, toView), 0.0), 140.0);
    dayLit += vec3(1.0, 0.95, 0.85) * glint * water * (1.0 - cover) * 0.5;

    // Night side: city lights, dimmed under cloud cover.
    vec3 nightSide = nightLights * vec3(1.0, 0.86, 0.66) * 0.85 * (1.0 - cover * 0.85);
    nightSide += vec3(0.55, 0.65, 0.85) * cover * 0.004; // hint of moonlit cloud

    vec3 color = mix(nightSide, dayLit, dayT) * uBrightness;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

// The air, which you can only see where you are looking past the planet.
//
// Shading this from the shell's own normal spreads it right across the disc —
// measured, a ring 11% brighter than the surface at 0.91 of the radius, on the
// sunlit side only, which is exactly the artefact it looked like. The depth
// buffer cannot help: with near 0.5 and far 2e6, the globe and the shell 6,600
// units behind it differ by ~1e-7 in NDC depth, so nothing occludes anything
// out here. So work out the geometry directly — how close this fragment's line
// of sight passes to the Earth's centre — and light only the rays that miss the
// surface and graze the air. From the Moon that is an arc a pixel or two wide.
const ATMO_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vObjDir;
  uniform vec3 uSunDirBody;
  uniform vec3 uViewDirBody;
  uniform float uViewDistBody;
  uniform float uBrightness;

  const float SHELL = 1.016;   // ~100 km of atmosphere over a 6371 km Earth

  void main() {
    vec3 n = normalize(vObjDir);
    vec3 p = n * SHELL;
    // Impact parameter: how far this sight line passes from the centre. The
    // ray must come from the actual viewer position — the parallel-ray
    // shortcut (dot with the centre direction) holds at the true size, where
    // the viewer is ~60 shell radii out, but a x10 magnified mesh puts the
    // viewer ~6 radii out, rays diverge up to ~10 deg, and the halo detaches
    // from the limb.
    vec3 d = normalize(p - uViewDirBody * uViewDistBody);
    float pv = dot(p, d);
    float b = sqrt(max(SHELL * SHELL - pv * pv, 0.0));
    // Below 1 the line of sight ends on the surface; above SHELL it never
    // entered the air. Between, it grazes — brightest just above the limb.
    float arc = smoothstep(0.998, 1.006, b) * (1.0 - smoothstep(1.0, SHELL, b));
    float lit = smoothstep(-0.12, 0.25, dot(n, uSunDirBody));
    float a = arc * lit;
    vec3 col = vec3(0.30, 0.52, 1.0) * a * uBrightness * 1.7;
    gl_FragColor = vec4(col, a);
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
  // The equirect is stretched hardest exactly where the sight line is most
  // oblique — the limb — so take all the anisotropy the GPU offers.
  for (const t of [day, night, spec]) t.anisotropy = Math.min(16, maxAniso);

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
    uViewDistBody: { value: 60.0 }, // viewer distance in globe radii
    uBrightness: { value: 1.0 },
  };

  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(1, 128, 96),
    new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: FRAG }),
  );

  const atmoUniforms = {
    uSunDirBody: uniforms.uSunDirBody,
    uViewDirBody: uniforms.uViewDirBody,
    uViewDistBody: { value: 60.0 }, // NOT shared: tracks the mesh as drawn
    uBrightness: uniforms.uBrightness,
  };
  // Back faces, so each sight line through the shell is shaded once.
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(1.016, 96, 72),
    new THREE.ShaderMaterial({
      uniforms: atmoUniforms,
      vertexShader: VERT,
      fragmentShader: ATMO_FRAG,
      side: THREE.BackSide,
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
  let cloudWidth = CLOUD_W_BASE;   // what the view has asked for
  let loadedWidth = 0;             // what is actually on the GPU

  function setClouds(tex, kind) {
    const old = uniforms.uClouds.value;
    tex.anisotropy = Math.min(16, maxAniso);
    uniforms.uClouds.value = tex;
    cloudStatus = { kind, fetchedAt: new Date() };
    if (old && old !== tex) old.dispose();
  }

  async function refreshClouds() {
    if (cloudFetchInFlight) return;
    cloudFetchInFlight = true;
    const want = cloudWidth;
    let loaded = false;
    try {
      const live = await loadTexture(loader, `${liveCloudsUrl(want)}?t=${Date.now()}`, { srgb: false });
      setClouds(live, 'live');
      loadedWidth = want;
      loaded = true;
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
    // A zoom can raise the target while a fetch is already in the air. Only
    // chase it after a load that worked, or a dead network would spin here.
    if (loaded && loadedWidth < cloudWidth) refreshClouds();
  }
  refreshClouds();

  const rotM = new THREE.Matrix4();
  let displayScale = 1;

  return {
    group,
    get cloudStatus() {
      return cloudStatus;
    },
    /**
     * How wide the disc is being drawn, in css px. Past half the cloud map's
     * width the texels are what the eye is looking at, and only then is the
     * bigger map worth its download.
     */
    requestDetail(discPx) {
      if (cloudWidth >= CLOUD_W_DEEP || discPx <= cloudWidth / 2) return;
      cloudWidth = CLOUD_W_DEEP;
      if (!cloudFetchInFlight) refreshClouds();
    },
    update(state) {
      if (Date.now() > nextCloudFetch) {
        nextCloudFetch = Date.now() + CLOUD_REFRESH_MS; // don't stack requests
        refreshClouds();
      }

      const e = state.earth;
      // Display choice, not physics: the user can inflate the drawn disc — a
      // magnifying glass held over the Earth alone. Only this mesh grows, so
      // the enlarged image covers more of the sky behind it (including the
      // Sun near new moon), exactly as a magnifier's image does. Everything
      // computed FROM the Earth — earthshine, eclipse dimming, phase,
      // orientation, the ephemeris itself — keeps the true angular radius.
      const radius = EARTH_DIST * Math.sin(e.angRadiusDeg * displayScale * Math.PI / 180);
      // Two viewer distances, in globe radii. The globe's picture content —
      // which patch of ocean carries the glint — uses the TRUE geometry, so
      // nothing on the disc can move with the display dial. The atmosphere
      // arc instead must hug the limb of the mesh as drawn, and a x10
      // magnification puts that mesh ~6 radii from the camera, not ~60.
      // One accepted residue of the enlarged-mesh approach (see PRD): the
      // visible cap is that of the closer viewpoint, so the outer ~1.4% of
      // the true disc — already foreshortened to nothing at x1 — slips out
      // of frame as the dial rises.
      uniforms.uViewDistBody.value = 1 / Math.sin(e.angRadiusDeg * Math.PI / 180);
      atmoUniforms.uViewDistBody.value = EARTH_DIST / radius;
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
    setScale(s) {
      displayScale = s;
    },
  };
}
