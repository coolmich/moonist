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

// --------------------------------------------------------------------------
// The round-disc magnifier. Display choice, not physics — see PRD.
//
// A rectilinear projection draws an off-axis sphere as an ellipse stretched
// along the screen radius by sec(phi): 1.30 at 39.5° off-axis, measured, with
// the area up sec³(phi). That is correct, and it is what a wide lens does. At
// the Earth's true 1.87° it is also invisible — a 21 x 16 px disc at 100° fov,
// 5 px of stretch. But the magnifier draws the disc up to ten times that, and
// a 19°-wide sphere 40° off-axis cannot be round in a rectilinear frame: the
// egg in the corner is 50 px of it.
//
// So squash the drawn mesh back, in clip space, along the screen radius
// through the disc centre. An anisotropic scale by a_t/a_r maps the ellipse
// exactly onto a circle; done about the projection of the disc centre it is a
// fixed point, so the Earth does not move, depth is untouched, and not one
// star is displaced. What is given up is that the limb no longer marks where
// an occultation would happen — which at x10, where the disc is ten times too
// big, it did not mark anyway.
//
// Projecting the silhouette cone (half-angle rho, off-axis phi) onto the image
// plane gives semi-axes a_r = cos(rho)sin(rho)/P and a_t = sin(rho)/sqrt(P)
// with P = cos²(rho) − sin²(phi), so the ratio is sqrt(1 − (sin phi/cos rho)²)
// — which is 1/sec(phi) in the small-disc limit, as it must be.

/**
 * How much of the projection's radial stretch to take out of the drawn disc,
 * as a factor on its radial extent. 1 = leave the geometry exactly as it is.
 *
 * The correction is ramped by 1 − 1/S rather than switched on, because at S = 1
 * the ellipse is the truth and must be left alone, and the dial is continuous:
 * a step would pop. 1 − 1/S is the fraction of the drawn radius the dial made
 * up, so this undoes the stretch on the fabricated part and no more.
 *
 * @param cosPhi     cosine of the angle between the view axis and the disc
 * @param rhoRad     angular radius of the disc AS DRAWN (magnified), radians
 * @param scale      the magnifier's setting
 */
export function discSquash(cosPhi, rhoRad, scale) {
  if (!(scale > 1) || !(cosPhi > 1e-6)) return 1;
  const sinPhi = Math.sqrt(Math.max(1 - cosPhi * cosPhi, 0));
  const s = sinPhi / Math.cos(rhoRad);
  if (!(s < 1)) return 1; // disc straddles the 90° cone; nothing sane on screen
  return Math.pow(Math.sqrt(1 - s * s), 1 - 1 / scale);
}

/**
 * Build the clip-space squash. `sr`/`su` are the disc direction's components
 * along the camera's right and up axes — the screen radius points that way.
 */
function setWarp(m, k, cosPhi, sr, su, camera) {
  const sinPhi = Math.hypot(sr, su);
  if (k === 1 || sinPhi < 1e-9 || !(cosPhi > 1e-6)) return m.identity();
  const nx = sr / sinPhi;
  const ny = su / sinPhi;
  // NDC x spans the same [-1, 1] as y over an `aspect` times wider frame, so
  // the off-diagonals carry that factor: the scale is isotropic in pixels.
  const a = camera.aspect;
  const g = k - 1;
  const m00 = 1 + g * nx * nx;
  const m01 = (g * nx * ny) / a;
  const m10 = g * nx * ny * a;
  const m11 = 1 + g * ny * ny;
  // Disc centre in NDC, held fixed so the squash cannot shift the Earth.
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  const cx = sr / (cosPhi * a * t);
  const cy = su / (cosPhi * t);
  return m.set(
    m00, m01, 0, (1 - m00) * cx - m01 * cy,
    m10, m11, 0, (1 - m11) * cy - m10 * cx,
    0, 0, 1, 0,
    0, 0, 0, 1,
  );
}

const VERT = /* glsl */ `
  uniform mat4 uWarp;
  varying vec3 vObjDir;
  void main() {
    vObjDir = normalize(position);
    gl_Position = uWarp * projectionMatrix * modelViewMatrix * vec4(position, 1.0);
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
  uniform vec3 uSunPosBody;
  uniform vec3 uMoonPosBody;
  uniform vec3 uViewDirBody;
  uniform float uViewDistBody;
  uniform float uBrightness;
  uniform vec3 uHomeDir;   // viewer's home point, unit vector in the body frame
  uniform float uHomeMark; // marker ring radius, radians on the sphere; 0 = off

  const float PI = 3.14159265358979;
  // Radii in Earth radii — the same numbers engine.js uses, whose
  // sunObscuration() is this code's node-tested twin.
  const float R_SUN_ER = 109.19793;
  const float R_MOON_ER = 0.27270445;

  // Fraction of a disc of radius rs hidden by a disc of radius ro, centres
  // sep apart: the lens formula, mirrored from engine.js discOverlapFraction.
  float discOverlap(float sep, float rs, float ro) {
    if (sep >= rs + ro) return 0.0;
    if (sep <= ro - rs) return 1.0;
    if (sep <= rs - ro) return (ro * ro) / (rs * rs);
    float a = clamp((sep * sep + rs * rs - ro * ro) / (2.0 * sep * rs), -1.0, 1.0);
    float b = clamp((sep * sep + ro * ro - rs * rs) / (2.0 * sep * ro), -1.0, 1.0);
    float area = rs * rs * (acos(a) - a * sqrt(1.0 - a * a))
               + ro * ro * (acos(b) - b * sqrt(1.0 - b * b));
    return area / (PI * rs * rs);
  }

  // The Moon's shadow: how much of the Sun's disc the Moon covers as seen
  // from this point of the surface. Lunar parallax (about a degree across
  // the globe) is the entire eclipse geometry, so both directions come from
  // the fragment, never the Earth's centre; the half-angle separation keeps
  // float precision at the milliradian scales an eclipse lives at.
  float moonCover(vec3 n) {
    vec3 toSun = uSunPosBody - n;
    vec3 toMoon = uMoonPosBody - n;
    float ds = length(toSun);
    float dm = length(toMoon);
    float rs = asin(min(R_SUN_ER / ds, 1.0));
    float rm = asin(min(R_MOON_ER / dm, 1.0));
    float sep = 2.0 * asin(min(0.5 * length(toSun / ds - toMoon / dm), 1.0));
    return discOverlap(sep, rs, rm);
  }

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
    // During a solar eclipse (the Earth's kind) the near side watches the
    // Moon's own shadow cross the disc — a broad penumbral smudge with a tiny
    // umbral core, as DSCOVR photographs it. sunVis is the surviving fraction
    // of sunlight; away from an eclipse moonCover is identically zero.
    float sunVis = 1.0 - moonCover(n);
    float diffuse = max(cosSun, 0.0) * sunVis;

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
    dayLit += vec3(1.0, 0.95, 0.85) * glint * water * (1.0 - cover) * sunVis * 0.5;

    // Night side: city lights, dimmed under cloud cover.
    vec3 nightSide = nightLights * vec3(1.0, 0.86, 0.66) * 0.85 * (1.0 - cover * 0.85);
    nightSide += vec3(0.55, 0.65, 0.85) * cover * 0.004; // hint of moonlit cloud

    vec3 color = mix(nightSide, dayLit, dayT) * uBrightness;

    // Display chrome, not physics: a ring on the viewer's home point, so
    // "which continent am I looking at" always has an answer. Drawn over
    // clouds and night alike, exposure-tracked so it reads in both, and
    // sized by the CPU to stay a few pixels at any zoom. Off at 0.
    if (uHomeMark > 0.0) {
      float ang = acos(clamp(dot(n, uHomeDir), -1.0, 1.0));
      float aa = max(fwidth(ang) * 1.2, uHomeMark * 0.16);
      float ring = 1.0 - smoothstep(aa, aa * 2.0, abs(ang - uHomeMark));
      float core = 1.0 - smoothstep(0.0, uHomeMark * 0.4, ang);
      float m = clamp(ring + core * 0.7, 0.0, 1.0);
      // Kept decisively blue: pushed to white by the tone curve it read as
      // cloud or snow, which is the confusion the marker exists to cut.
      color = mix(color, vec3(0.30, 0.58, 1.15) * max(uBrightness, 0.35), m);
    }

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
    uSunPosBody: { value: new THREE.Vector3(23481, 0, 0) },
    uMoonPosBody: { value: new THREE.Vector3(60, 0, 0) },
    uViewDirBody: { value: new THREE.Vector3(1, 0, 0) },
    uViewDistBody: { value: 60.0 }, // viewer distance in globe radii
    uBrightness: { value: 1.0 },
    uHomeDir: { value: new THREE.Vector3(1, 0, 0) },
    uHomeMark: { value: 0 },
    uWarp: { value: new THREE.Matrix4() },
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
    uWarp: uniforms.uWarp, // shared: the shell must squash with the globe
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
  let homeVec = null;   // unit body-frame vector of the viewer's home, or null
  let lastDiscPx = 40;  // drawn disc width, kept for marker sizing

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
      lastDiscPx = discPx; // the home marker sizes itself off the drawn disc
      if (cloudWidth >= CLOUD_W_DEEP || discPx <= cloudWidth / 2) return;
      cloudWidth = CLOUD_W_DEEP;
      if (!cloudFetchInFlight) refreshClouds();
    },
    /**
     * Viewer's home point for the display marker (see FRAG — chrome, not
     * physics). Geographic degrees; pass null to hide the marker.
     */
    setHome(latDeg, lonDeg) {
      if (latDeg == null) {
        homeVec = null;
        uniforms.uHomeMark.value = 0;
        return;
      }
      const lat = latDeg * Math.PI / 180;
      const lon = lonDeg * Math.PI / 180;
      homeVec = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
      uniforms.uHomeDir.value.set(homeVec[0], homeVec[1], homeVec[2]);
    },
    update(state, camera) {
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
      // Eclipse-shadow geometry, Earth body frame in Earth radii (see FRAG).
      uniforms.uSunPosBody.value.set(...e.sunPosBody);
      uniforms.uMoonPosBody.value.set(...e.moonPosBody);

      // Home marker: hold the ring at ~7 screen px, but never let it claim
      // more than ~28% of the drawn disc's radius — at ×1 a fixed pixel size
      // would cover half the planet, and a marker that covers stops marking.
      // The 0.02 rad floor (~127 km) keeps deep zooms ringing the metro area.
      if (homeVec) {
        const rPx = Math.min(7, 0.14 * lastDiscPx);
        uniforms.uHomeMark.value =
          Math.max(0.02, Math.asin(Math.min(1, 2 * rPx / Math.max(lastDiscPx, 8))));
      }

      // Take the projection's radial stretch back out of the magnified disc.
      const cm = camera.matrixWorld.elements;
      const d = e.sceneDir;
      const cosPhi = -(d[0] * cm[8] + d[1] * cm[9] + d[2] * cm[10]); // −Z is forward
      const sr = d[0] * cm[0] + d[1] * cm[1] + d[2] * cm[2];         // camera right
      const su = d[0] * cm[4] + d[1] * cm[5] + d[2] * cm[6];         // camera up
      const rho = e.angRadiusDeg * displayScale * Math.PI / 180;
      setWarp(uniforms.uWarp.value, discSquash(cosPhi, rho, displayScale), cosPhi, sr, su, camera);
    },
    setBrightness(v) {
      uniforms.uBrightness.value = v;
    },
    setScale(s) {
      displayScale = s;
    },
  };
}
