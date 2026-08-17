import * as THREE from 'three';
import { skyState, nextSunEvent, angSepDeg } from './astro/engine.js';
import { mulMV } from './astro/vec.js';
import { clock } from './sim/clock.js';
import { SITES } from './sites.js';
import { createMilkyWay } from './scene/milkyway.js';
import { createStarfield, starNameMagCut } from './scene/starfield.js';
import { createPlanets } from './scene/planets.js';
import { createLabelLayer } from './scene/labels2d.js';
import { createEarth, discSquash } from './scene/earth.js';
import { createSun } from './scene/sun.js';
import { createTerrain, EYE } from './scene/terrain.js';
import { createLighting } from './scene/lighting.js';
import { createUI } from './ui/ui.js';

// Scene coordinate convention (local horizon frame at the observer):
//   +X = East, +Y = Up (zenith), -Z = North  (so +Z = South)
// Azimuth is measured from North, positive toward East.

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); // vacuum: pitch black

// near = 0.5: nothing is closer than the ~1.7 m eye height, and a larger near
// plane keeps depth precision sane out to the 900 km star dome so the Earth
// occludes stars and the terrain occludes the sky without z-fighting.
const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.5, 2e6);
camera.position.set(0, EYE, 0);

// ---------------------------------------------------------------------------
// Look controls: drag the sky (the grabbed point tracks the cursor exactly),
// wheel zooms FOV with easing.
// ---------------------------------------------------------------------------
const look = {
  az: 0,          // radians, 0 = North, +east
  alt: 0.12,      // radians above horizon
  fov: 65,        // degrees, rendered value (eased toward fovTarget)
  fovTarget: 65,
  vAz: 0,         // inertial velocity (rad/s)
  vAlt: 0,
  dragging: false,
  lastX: 0,
  lastY: 0,
  lastT: 0,
};

const ALT_MIN = -Math.PI / 2 + 0.001;
const ALT_MAX = Math.PI / 2 - 0.001;
// Zooming in has to reach far enough for a planet to stop being a point:
// Jupiter is ~45 arcsec, so it only becomes a disc worth the name below about
// a degree of field. At 0.2° Venus and Jupiter reach ~45 px and Saturn's ring
// span ~60 px — decisively past the ~16 px wide-field glare blob, which is
// what makes the zoom feel like magnification instead of a constant dot.
const FOV_MIN = 0.2;
const FOV_MAX = 100;

function applyLook() {
  const dir = new THREE.Vector3(
    Math.sin(look.az) * Math.cos(look.alt),
    Math.sin(look.alt),
    -Math.cos(look.az) * Math.cos(look.alt),
  );
  camera.lookAt(dir.add(camera.position));
  if (camera.fov !== look.fov) {
    camera.fov = look.fov;
    camera.updateProjectionMatrix();
  }
  camera.updateMatrixWorld();
}
applyLook();

// Camera-space angular position of a client pixel relative to screen center,
// using the exact perspective mapping (θ = atan(px / focal)). Differences of
// these angles give drag deltas that track the grabbed point 1:1 and stay
// well-behaved at the zenith/nadir clamps (a world-ray formulation degenerates
// there and wedges the camera — found by dogfooding).
function pixelAngles(clientX, clientY) {
  const el = renderer.domElement;
  const f = el.clientHeight / (2 * Math.tan(THREE.MathUtils.degToRad(look.fov) / 2));
  return {
    x: Math.atan((clientX - el.clientWidth / 2) / f),
    y: Math.atan((el.clientHeight / 2 - clientY) / f),
  };
}

const canvas = renderer.domElement;

canvas.addEventListener('pointerdown', (e) => {
  look.dragging = true;
  look.vAz = 0;
  look.vAlt = 0;
  look.lastX = e.clientX;
  look.lastY = e.clientY;
  look.lastT = performance.now();
  look.downX = e.clientX;
  look.downY = e.clientY;
  look.downT = look.lastT;
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!look.dragging) return;
  const now = performance.now();
  const dt = Math.max((now - look.lastT) / 1000, 1e-3);

  const prev = pixelAngles(look.lastX, look.lastY);
  const cur = pixelAngles(e.clientX, e.clientY);
  // Horizontal screen angle → azimuth, compensated so a point at the view
  // altitude tracks the cursor; capped near the poles.
  const dAz = (prev.x - cur.x) / Math.max(Math.cos(look.alt), 0.15);
  const dAlt = prev.y - cur.y;

  look.az += dAz;
  look.alt = THREE.MathUtils.clamp(look.alt + dAlt, ALT_MIN, ALT_MAX);
  // Smooth the fling velocity across recent moves.
  look.vAz = 0.65 * (dAz / dt) + 0.35 * look.vAz;
  look.vAlt = 0.65 * (dAlt / dt) + 0.35 * look.vAlt;
  look.lastX = e.clientX;
  look.lastY = e.clientY;
  look.lastT = now;
  applyLook();
});

function endDrag() {
  look.dragging = false;
  canvas.classList.remove('dragging');
  // Pause-then-release must not fling: only keep velocity from a live gesture.
  if (performance.now() - look.lastT > 90) {
    look.vAz = 0;
    look.vAlt = 0;
  }
}
canvas.addEventListener('pointerup', (e) => {
  endDrag();
  // A clean tap on the sky — short, still, no drag — brings hidden chrome
  // back. It only ever reveals, so the gate is deliberately loose: this is
  // the sole exit for a pointer-only user staring at zero UI, and a tight
  // window would read as a frozen page.
  if (ui?.hidden
      && performance.now() - look.downT < 600
      && Math.hypot(e.clientX - look.downX, e.clientY - look.downY) < 10) {
    ui.setChromeHidden(false);
  }
});
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  look.fovTarget = THREE.MathUtils.clamp(
    look.fovTarget * Math.exp(e.deltaY * 0.0012),
    FOV_MIN,
    FOV_MAX,
  );
}, { passive: false });

// ---------------------------------------------------------------------------
// Interim keyboard controls (the real UI lands with the controls task).
// ---------------------------------------------------------------------------
const CARDINALS = [
  ['N', 0], ['NE', 45], ['E', 90], ['SE', 135],
  ['S', 180], ['SW', 225], ['W', 270], ['NW', 315],
];
const SPEEDS = { Digit1: 1, Digit2: 60, Digit3: 3600, Digit4: 86400, Digit5: 604800 };
const SPEED_NAMES = { 1: 'Real time', 60: '1 min/s', 3600: '1 hr/s', 86400: '1 day/s', 604800: '1 wk/s' };
const LAYER_NAMES = { milkyWay: 'Milky Way', constellations: 'Constellations', starNames: 'Star names' };
const toggles = { milkyWay: true, constellations: true, starNames: true };

function toggleLayer(key) {
  toggles[key] = !toggles[key];
  if (key === 'constellations') starfield?.showConstellations(toggles.constellations);
  if (key === 'milkyWay') milkyway?.setVisible(toggles.milkyWay);
  return toggles[key];
}

const LOOK_KEYS = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract',
]);
const keysDown = new Set();

window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (ui?.modalOpen) return; // dialogs own the keyboard while open
  if (LOOK_KEYS.has(e.code)) {
    keysDown.add(e.code);
    e.preventDefault();
    return;
  }
  // Auto-repeat must not reach the toggles: a held H would strobe the whole
  // interface and leave its final state to release timing.
  if (e.repeat) return;
  // Hotkeys keep working while the chrome is hidden; the OSD chip confirms
  // the invisible action rather than dragging the panels back on screen.
  const confirm = (text) => { if (ui?.hidden) ui.osd(text); };
  if (SPEEDS[e.code]) {
    clock.setSpeed(SPEEDS[e.code]);
    confirm(SPEED_NAMES[SPEEDS[e.code]]);
  }
  if (e.code === 'Digit0') {
    clock.resetToRealTime();
    confirm('Back to now');
  }
  if (e.code === 'KeyH') ui?.toggleChrome();
  if (e.code === 'KeyD') {
    ui?.setChromeHidden(false); // the drawer is chrome; reveal before opening
    ui?.toggleDetails();
  }
  for (const [code, key] of [['KeyM', 'milkyWay'], ['KeyC', 'constellations'], ['KeyN', 'starNames']]) {
    if (e.code === code) {
      const on = toggleLayer(key);
      ui?.syncToggle(key, on);
      confirm(`${LAYER_NAMES[key]} ${on ? 'on' : 'off'}`);
    }
  }
  if (e.code === 'KeyE' && latestState) {
    view.lookAt(latestState.earth.az, latestState.earth.alt, undefined, true);
  }
});
window.addEventListener('keyup', (e) => keysDown.delete(e.code));
window.addEventListener('blur', () => keysDown.clear());

// ---------------------------------------------------------------------------
// Scene content
// ---------------------------------------------------------------------------
// Default to Grimaldi: near the western limb the Earth hangs only ~20° up, so
// the opening view holds the ground, the horizon and the Earth all at once —
// the whole idea of the place in one frame. A returning visitor gets the site
// they last stood at.
let site = (() => {
  try {
    const saved = localStorage.getItem('moonist.site');
    const found = saved && SITES.find((s) => s.id === saved);
    if (found) return found;
  } catch { /* private mode */ }
  return SITES.find((s) => s.id === 'grimaldi');
})();

// Earth display magnification (1 = its real angular size). A pure display
// choice, clamped and stored here so every consumer — the mesh, the label
// clearance, the label occluder — agrees on one value. ×10 keeps the whole disc
// above the skyline even at Grimaldi, where the Earth hangs lowest (~21°).
const EARTH_SCALE_MAX = 10;
let earthScale = (() => {
  try {
    const v = parseFloat(localStorage.getItem('moonist.earthScale'));
    if (v >= 1 && v <= EARTH_SCALE_MAX) return v;
  } catch { /* private mode */ }
  return 1;
})();

// The viewer's home point on the Earth — a display marker, never physics.
// Filled from the browser's geolocation the first time the user asks for it,
// then remembered; the marker toggle is remembered separately.
let home = (() => {
  try {
    const v = JSON.parse(localStorage.getItem('moonist.home'));
    if (Number.isFinite(v?.lat) && Number.isFinite(v?.lon)) return v;
  } catch { /* private mode or unset */ }
  return null;
})();
let homeOn = (() => {
  try { return localStorage.getItem('moonist.homeOn') === '1'; } catch { return false; }
})();

let milkyway = null;
let starfield = null;
let planets = null;
let earth = null;
let sun = null;
let terrain = null;
let ui = null;
const labelLayer = createLabelLayer(app);
const lighting = createLighting(scene, renderer);

// Site changes are async (fetch + mesh build) and can be fired faster than
// they resolve, so a generation counter makes the last request win and the
// ground can never disagree with the sky: `site` only changes at the moment
// its own terrain is swapped in.
let siteGen = 0;
async function setSite(next) {
  const gen = ++siteGen;
  const built = await createTerrain(next);
  if (gen !== siteGen) {
    built.dispose();
    return false;
  }
  if (terrain) {
    scene.remove(terrain.group);
    terrain.dispose();
  }
  terrain = built;
  site = next;
  camera.position.y = terrain.groundY + EYE;
  scene.add(terrain.group);
  try { localStorage.setItem('moonist.site', next.id); } catch { /* private mode */ }
  return true;
}

async function boot() {
  const [sf, e] = await Promise.all([
    createStarfield(renderer.getPixelRatio()),
    createEarth(renderer),
    setSite(site),
  ]);
  starfield = sf;
  earth = e;
  if (homeOn && home) earth.setHome(home.lat, home.lon);
  milkyway = createMilkyWay(renderer);
  // The layer keys work before boot finishes, so adopt whatever state they left.
  milkyway.setVisible(toggles.milkyWay);
  planets = createPlanets(renderer.getPixelRatio());
  sun = createSun();
  scene.add(milkyway.group);
  scene.add(starfield.group);
  scene.add(planets.group);
  scene.add(earth.group);
  scene.add(sun.group);

  ui = createUI({
    hud: document.getElementById('hud'),
    view,
    clock,
    toggles,
    onToggle: toggleLayer,
    onSiteChange: aimAfterSiteChange,
  });
  aimAtEarth(45);
  ui.setLoading(false);
}

// Open looking at the Earth: it is the one thing that never moves here, and it
// orients you instantly. Sit it above the horizon rather than centred so the
// ground is in frame too.
function aimAtEarth(fov) {
  const s = skyState(clock.now(), site);
  view.lookAt(s.earth.az, Math.max(s.earth.alt - 7, 3), fov);
}

// A new site puts the Earth somewhere else entirely, so re-aim rather than
// leaving the camera pointed at empty sky.
async function aimAfterSiteChange(next) {
  const applied = await setSite(next);
  if (applied) aimAtEarth();
  return applied;
}

boot().catch((err) => {
  console.error('scene init failed:', err);
  const boot2 = document.getElementById('boot');
  const step = document.getElementById('boot-step');
  const retry = document.getElementById('boot-retry');
  if (boot2 && step && retry) {
    boot2.classList.add('failed');
    step.textContent = `Could not load the Moon: ${err.message}`;
    retry.onclick = () => window.location.reload();
  }
});

// View API: used by the UI to swing the camera onto a target (the Earth
// indicator, the Sun), and by automated checks to aim precisely.
let latestState = null;
let slew = null;
let sunEventCache = null;
const view = {
  /** Aim the camera. `smooth` slews over ~0.5 s instead of cutting. */
  lookAt(azDeg, altDeg, fovDeg, smooth = false) {
    if (!Number.isFinite(azDeg) || !Number.isFinite(altDeg)) return;
    // Keep the accumulated drag angle bounded, or the shortest-way modulo
    // below misbehaves after a few full turns of dragging.
    look.az = ((look.az % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const target = THREE.MathUtils.degToRad(azDeg);
    // Take the shortest way round.
    const d = ((target - look.az) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    const az = look.az + d;
    const alt = THREE.MathUtils.clamp(THREE.MathUtils.degToRad(altDeg), ALT_MIN, ALT_MAX);
    look.vAz = 0;
    look.vAlt = 0;
    if (fovDeg) look.fovTarget = THREE.MathUtils.clamp(fovDeg, FOV_MIN, FOV_MAX);
    if (smooth) {
      slew = { az, alt };
    } else {
      slew = null;
      look.az = az;
      look.alt = alt;
      applyLook();
    }
  },
  /** Earth altitude right now as seen from another site — for the picker. */
  earthAltAt(otherSite) {
    return skyState(clock.now(), otherSite).earth.alt;
  },
  /** Next sunrise/sunset here, cached — the search costs ~200 ephemeris steps.
   *  The event's absolute time never changes, so the cache only invalidates
   *  when the clock passes it, jumps backward, or the site changes. */
  nextSunEvent() {
    const now = clock.now().getTime();
    if (!sunEventCache || sunEventCache.site !== site.id
        || now >= sunEventCache.at || now < sunEventCache.from - 1000) {
      const ev = nextSunEvent(new Date(now), site);
      sunEventCache = ev
        ? { site: site.id, from: now, at: ev.date.getTime(), kind: ev.kind }
        : { site: site.id, from: now, at: Infinity, kind: null };
    }
    return sunEventCache.kind
      ? { kind: sunEventCache.kind, days: (sunEventCache.at - now) / 86400000 }
      : null;
  },
  get look() {
    const az = ((THREE.MathUtils.radToDeg(look.az) % 360) + 360) % 360;
    return { az, alt: THREE.MathUtils.radToDeg(look.alt), fov: look.fov };
  },
  /** Project a scene-frame direction to client pixels for HUD indicators.
   *  angRadiusDeg widens the on-screen test for an extended disc: it counts
   *  as visible while any part of it is, not just its centre — a magnified
   *  Earth must not be flagged "off screen" with half its disc in frame. */
  projectDir(dir, angRadiusDeg = 0) {
    const e = camera.matrixWorld.elements;
    const behind = dir[0] * -e[8] + dir[1] * -e[9] + dir[2] * -e[10] < 0;
    const v = new THREE.Vector3(dir[0], dir[1], dir[2])
      .multiplyScalar(1000).add(camera.position).project(camera);
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    let rPx = 0;
    if (angRadiusDeg) {
      // The disc's reach back toward the screen centre is f·(tan φ −
      // tan(φ−θ)), not f·tan θ — the same tan convexity the label clearance
      // accounts for. With the on-axis form a ×10 disc sliding off a wide
      // frame still had a ~185 px slab on screen when the chip fired.
      const theta = THREE.MathUtils.degToRad(angRadiusDeg);
      const cosPhi = THREE.MathUtils.clamp(
        dir[0] * -e[8] + dir[1] * -e[9] + dir[2] * -e[10], -1, 1,
      );
      const phi = Math.min(Math.acos(cosPhi), 1.35);
      const f = window.innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(look.fov) / 2));
      // A radius is only ever passed for the Earth, and the magnifier squashes
      // its drawn reach back along this same screen radius.
      rPx = f * (Math.tan(phi) - Math.tan(phi - theta)) * discSquash(cosPhi, theta, earthScale);
    }
    const pad = 60 - rPx;
    return {
      x, y, behind,
      onScreen: !behind && x > pad && x < window.innerWidth - pad && y > pad && y < window.innerHeight - pad,
    };
  },
  /** Earth display magnification, 1 = real. Persisted per user. */
  get earthScale() {
    return earthScale;
  },
  get earthScaleMax() {
    return EARTH_SCALE_MAX;
  },
  setEarthScale(v) {
    if (!Number.isFinite(v)) return earthScale;
    earthScale = THREE.MathUtils.clamp(v, 1, EARTH_SCALE_MAX);
    try { localStorage.setItem('moonist.earthScale', String(earthScale)); } catch { /* private mode */ }
    return earthScale;
  },
  get state() {
    return latestState;
  },
  /** Viewer's home on the Earth (display marker): {lat, lon} or null. */
  get home() {
    return home;
  },
  get homeOn() {
    return homeOn && !!home;
  },
  setHome(latDeg, lonDeg) {
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return;
    home = { lat: latDeg, lon: lonDeg };
    try { localStorage.setItem('moonist.home', JSON.stringify(home)); } catch { /* private mode */ }
    if (homeOn) earth?.setHome(home.lat, home.lon);
  },
  setHomeOn(on) {
    homeOn = !!on;
    try { localStorage.setItem('moonist.homeOn', homeOn ? '1' : '0'); } catch { /* private mode */ }
    if (homeOn && home) earth?.setHome(home.lat, home.lon);
    else earth?.setHome(null);
    return homeOn && !!home;
  },
  /** Hours until home next faces the Moon: 0 = facing now, null = not
   *  within a day. Costs up to ~26 ephemeris steps — call sparingly. */
  homeReturnHours() {
    if (!home) return null;
    const t0 = clock.now().getTime();
    for (let h = 0; h <= 26; h++) {
      const s = skyState(new Date(t0 + h * 3600e3), site);
      if (angSepDeg(s.subLunar.lat, s.subLunar.lon, home.lat, home.lon) < 88) return h;
    }
    return null;
  },
  get site() {
    return site;
  },
  setSite,
  clock,
};
window.moonist = view;

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let lastFrameT = performance.now();

function frame() {
  // The loop must never die: a throw here (an ephemeris that cannot converge
  // at an absurd epoch, a transient GL error) would otherwise freeze the app
  // permanently with no way back short of a reload.
  try {
    renderFrame();
  } catch (err) {
    console.error('frame failed:', err);
    if (ui) ui.showError('Could not compute the sky for that moment — jumped back to now.');
    clock.resetToRealTime();
  }
  requestAnimationFrame(frame);
}

function renderFrame() {
  const now = performance.now();
  const dt = Math.min((now - lastFrameT) / 1000, 0.1);
  lastFrameT = now;

  if (slew) {
    // Eased swing onto a target (clicking the Earth chip, pressing E).
    const k = 1 - Math.exp(-dt / 0.16);
    look.az += (slew.az - look.az) * k;
    look.alt += (slew.alt - look.alt) * k;
    if (Math.abs(slew.az - look.az) < 1e-4 && Math.abs(slew.alt - look.alt) < 1e-4) {
      look.az = slew.az;
      look.alt = slew.alt;
      slew = null;
    }
  } else if (!look.dragging && (Math.abs(look.vAz) > 1e-4 || Math.abs(look.vAlt) > 1e-4)) {
    const decay = Math.exp(-dt / 0.3);
    look.az += look.vAz * dt;
    look.alt = THREE.MathUtils.clamp(look.alt + look.vAlt * dt, ALT_MIN, ALT_MAX);
    look.vAz *= decay;
    look.vAlt *= decay;
    if (look.alt === ALT_MIN || look.alt === ALT_MAX) look.vAlt = 0;
  }

  // Keyboard look, for anyone not driving a mouse.
  if (keysDown.size) {
    const rate = THREE.MathUtils.degToRad(look.fov) * 0.55 * dt;
    if (keysDown.has('ArrowLeft')) look.az -= rate;
    if (keysDown.has('ArrowRight')) look.az += rate;
    if (keysDown.has('ArrowUp')) look.alt = THREE.MathUtils.clamp(look.alt + rate, ALT_MIN, ALT_MAX);
    if (keysDown.has('ArrowDown')) look.alt = THREE.MathUtils.clamp(look.alt - rate, ALT_MIN, ALT_MAX);
    if (keysDown.has('Equal') || keysDown.has('NumpadAdd')) {
      look.fovTarget = THREE.MathUtils.clamp(look.fovTarget * Math.exp(-1.6 * dt), FOV_MIN, FOV_MAX);
    }
    if (keysDown.has('Minus') || keysDown.has('NumpadSubtract')) {
      look.fovTarget = THREE.MathUtils.clamp(look.fovTarget * Math.exp(1.6 * dt), FOV_MIN, FOV_MAX);
    }
    if (keysDown.size) slew = null;
  }

  // Eased FOV zoom (snap when close so it settles quickly).
  const fovDelta = look.fovTarget - look.fov;
  if (Math.abs(fovDelta) > 0.05) {
    look.fov += fovDelta * (1 - Math.exp(-dt / 0.11));
  } else {
    look.fov = look.fovTarget;
  }
  applyLook(); // camera matrices must be current before label projection

  const state = skyState(clock.now(), site);
  latestState = state;
  const { starDim, earthBrightness, uiDim } = lighting.update(state, dt);
  const heightPx = renderer.domElement.clientHeight;

  // Sky labels are hidden behind the terrain skyline (a 4.5 km massif must
  // occlude the names of everything behind it, whole-label, never sliced).
  const horizonAlt = terrain
    ? (dir) => terrain.horizonAlt(Math.atan2(dir[0], -dir[2]))
    : () => 0;
  // A label is drawn only if its anchor clears the skyline and is not hidden
  // behind the Earth's or the Sun's disc.
  const occluders = [];
  if (state.earth.alt > -3) {
    // The occluder matches the disc as drawn, magnification included.
    occluders.push({ dir: state.earth.sceneDir, cosR: Math.cos(THREE.MathUtils.degToRad(state.earth.angRadiusDeg * earthScale)) });
  }
  if (state.sun.alt > -3) {
    occluders.push({ dir: state.sun.sceneDir, cosR: Math.cos(THREE.MathUtils.degToRad(state.sun.angRadiusDeg)) });
  }
  const aboveSkyline = (dir) => {
    const h = Math.hypot(dir[0], dir[2]);
    if (Math.atan2(dir[1], h) <= horizonAlt(dir) + 0.004) return false;
    for (const o of occluders) {
      const d = dir[0] * o.dir[0] + dir[1] * o.dir[1] + dir[2] * o.dir[2];
      if (d > o.cosR) return false;
    }
    return true;
  };

  if (milkyway) {
    milkyway.setOrientation(state.eqjToScene);
    milkyway.setDim(starDim);
  }

  const labelItems = [];
  if (starfield) {
    starfield.setOrientation(state.eqjToScene);
    starfield.updateApparentSizes(look.fov, heightPx);
    starfield.setDim(starDim);

    const m = state.eqjToScene;
    if (toggles.starNames) {
      const cut = starNameMagCut(look.fov);
      for (const s of starfield.namedStars) {
        if (s.mag > cut) break; // sorted brightest-first
        const dir = mulMV(m, s.vEqj);
        if (!aboveSkyline(dir)) continue;
        labelItems.push({ id: s.id, dir, text: s.name, cls: 'star', priority: 100 + s.mag * 10 });
      }
    }
    if (toggles.constellations) {
      for (const c of starfield.constellations) {
        const dir = mulMV(m, c.anchorEqj);
        if (!aboveSkyline(dir)) continue;
        labelItems.push({ id: c.id, dir, text: c.name, cls: 'const', priority: 300 + c.rank * 30 });
      }
    }
  }
  if (planets) {
    planets.update(state.planets);
    const cm = camera.matrixWorld.elements;
    planets.setScreenDirs(
      state.sun.sceneDir,
      [cm[0], cm[1], cm[2]],   // camera right
      [cm[4], cm[5], cm[6]],   // camera up
    );
    planets.updateApparentSizes(look.fov, heightPx);
    planets.setDim(starDim);
    for (const p of state.planets) {
      if (!aboveSkyline(p.sceneDir)) continue;
      const sizeCss = planets.sizePxOf(p.name);
      labelItems.push({
        id: p.name,
        dir: p.sceneDir,
        text: p.name,
        cls: 'planet',
        priority: p.mag,
        clearPx: sizeCss / 2 + 5,
      });
    }
  }
  if (earth) {
    earth.setScale(earthScale);
    earth.update(state, camera);
    earth.setBrightness(earthBrightness);
    const fPx = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(look.fov) / 2));
    const theta = THREE.MathUtils.degToRad(state.earth.angRadiusDeg * earthScale);
    // How wide the disc is actually being drawn: past half the cloud map's
    // width, the texels are what the eye is looking at and the finer map
    // earns its download.
    earth.requestDetail(2 * fPx * Math.tan(theta));
    // Label the hero object whenever it is actually in view. (It is its own
    // occluder, so test the skyline directly rather than via aboveSkyline.)
    const eh = Math.hypot(state.earth.sceneDir[0], state.earth.sceneDir[2]);
    if (Math.atan2(state.earth.sceneDir[1], eh) > horizonAlt(state.earth.sceneDir)) {
      // Clearance radius that still encloses the disc off-axis, so the label
      // never lands on the Earth. The projection of a sphere seen at angle phi
      // from the view axis stretches outward to f·(tan(phi+theta) − tan(phi));
      // with a magnified disc (theta up to 9.5°) the on-axis f·tan(theta)
      // slices through the limb once the Earth sits off-centre.
      const ed = state.earth.sceneDir;
      const cosPhi = Math.sin(look.az) * Math.cos(look.alt) * ed[0]
        + Math.sin(look.alt) * ed[1]
        - Math.cos(look.az) * Math.cos(look.alt) * ed[2];
      // Clamp so tan stays sane when the disc is far off-axis (the label is
      // culled off screen there anyway).
      const phi = Math.min(Math.acos(THREE.MathUtils.clamp(cosPhi, -1, 1)), 1.35 - theta);
      // ...less whatever the magnifier squashes back out of that reach, or the
      // label stands off a disc edge that is no longer there.
      const squash = discSquash(Math.cos(phi), theta, earthScale);
      labelItems.push({
        id: 'earth',
        dir: state.earth.sceneDir,
        text: 'Earth',
        cls: 'planet',
        priority: -20,
        clearPx: Math.max(fPx * (Math.tan(phi + theta) - Math.tan(phi)) * squash + 7, 9),
      });
    }
  }
  if (sun) sun.update(state);
  if (terrain) terrain.setSunDir(state.sun.sceneDir);

  // Cardinal marks ride on the local skyline so they read as part of the view.
  if (terrain) {
    for (const [name, az] of CARDINALS) {
      const a = az * Math.PI / 180;
      const alt = terrain.horizonAlt(a) + 0.012;
      const ch = Math.cos(alt);
      labelItems.push({
        id: `cmp-${name}`,
        dir: [Math.sin(a) * ch, Math.sin(alt), -Math.cos(a) * ch],
        text: name,
        cls: 'compass',
        priority: name.length === 1 ? -200 : -150,
        tick: true,
      });
    }
  }

  labelLayer.setDim(uiDim);
  labelLayer.render(camera, labelItems, dt * 1000, ui ? ui.panelRects() : null);
  if (ui) ui.update(state, earth ? earth.cloudStatus : 'loading…');

  renderer.render(scene, camera);
}
frame();
