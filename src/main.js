import * as THREE from 'three';
import { skyState } from './astro/engine.js';
import { mulMV } from './astro/vec.js';
import { clock } from './sim/clock.js';
import { SITES } from './sites.js';
import { createStarfield, starNameMagCut } from './scene/starfield.js';
import { createPlanets } from './scene/planets.js';
import { createLabelLayer } from './scene/labels2d.js';
import { createEarth } from './scene/earth.js';
import { createSun } from './scene/sun.js';
import { createTerrain } from './scene/terrain.js';
import { createLighting } from './scene/lighting.js';

// Scene coordinate convention (local horizon frame at the observer):
//   +X = East, +Y = Up (zenith), -Z = North  (so +Z = South)
// Azimuth is measured from North, positive toward East.

const app = document.getElementById('app');
const EYE_HEIGHT = 1.7;

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
camera.position.set(0, EYE_HEIGHT, 0);

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
const FOV_MIN = 4;
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
canvas.addEventListener('pointerup', endDrag);
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
const SPEEDS = { Digit1: 1, Digit2: 60, Digit3: 3600, Digit4: 86400, Digit5: 604800 };
const toggles = { constellations: true, starNames: true };

window.addEventListener('keydown', (e) => {
  if (SPEEDS[e.code]) clock.setSpeed(SPEEDS[e.code]);
  if (e.code === 'Digit0') clock.resetToRealTime();
  if (e.code === 'KeyC') {
    toggles.constellations = !toggles.constellations;
    starfield?.showConstellations(toggles.constellations);
  }
  if (e.code === 'KeyN') {
    toggles.starNames = !toggles.starNames;
  }
});

// ---------------------------------------------------------------------------
// Scene content
// ---------------------------------------------------------------------------
let site = SITES[0]; // Apollo 11 until the location picker lands

let starfield = null;
let planets = null;
let earth = null;
let sun = null;
let terrain = null;
const labelLayer = createLabelLayer(app);
const lighting = createLighting(scene, renderer);

async function setSite(next) {
  site = next;
  const built = await createTerrain(site);
  if (terrain) {
    scene.remove(terrain.group);
    terrain.group.geometry.dispose();
    terrain.group.material.dispose();
  }
  terrain = built;
  scene.add(terrain.group);
}

const ready = (async () => {
  const [sf, e] = await Promise.all([
    createStarfield(renderer.getPixelRatio()),
    createEarth(renderer),
    setSite(site),
  ]);
  starfield = sf;
  earth = e;
  planets = createPlanets(renderer.getPixelRatio());
  sun = createSun();
  scene.add(starfield.group);
  scene.add(planets.group);
  scene.add(earth.group);
  scene.add(sun.group);
})();
ready.catch((err) => console.error('scene init failed:', err));

// View API: used by the UI to swing the camera onto a target (the Earth
// indicator, the Sun), and by automated checks to aim precisely.
let latestState = null;
const view = {
  lookAt(azDeg, altDeg, fovDeg) {
    const target = THREE.MathUtils.degToRad(azDeg);
    // Take the shortest way round.
    let d = ((target - look.az + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    look.az += d;
    look.alt = THREE.MathUtils.clamp(THREE.MathUtils.degToRad(altDeg), ALT_MIN, ALT_MAX);
    look.vAz = 0;
    look.vAlt = 0;
    if (fovDeg) look.fovTarget = THREE.MathUtils.clamp(fovDeg, FOV_MIN, FOV_MAX);
    applyLook();
  },
  get look() {
    return { az: THREE.MathUtils.radToDeg(look.az), alt: THREE.MathUtils.radToDeg(look.alt), fov: look.fov };
  },
  get state() {
    return latestState;
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
  const now = performance.now();
  const dt = Math.min((now - lastFrameT) / 1000, 0.1);
  lastFrameT = now;

  if (!look.dragging && (Math.abs(look.vAz) > 1e-4 || Math.abs(look.vAlt) > 1e-4)) {
    const decay = Math.exp(-dt / 0.3);
    look.az += look.vAz * dt;
    look.alt = THREE.MathUtils.clamp(look.alt + look.vAlt * dt, ALT_MIN, ALT_MAX);
    look.vAz *= decay;
    look.vAlt *= decay;
    if (look.alt === ALT_MIN || look.alt === ALT_MAX) look.vAlt = 0;
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
  const aboveSkyline = (dir) => {
    const h = Math.hypot(dir[0], dir[2]);
    return Math.atan2(dir[1], h) > horizonAlt(dir) + 0.004;
  };

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
    planets.updateApparentSizes(look.fov, heightPx);
    planets.setDim(starDim);
    const zoom = THREE.MathUtils.clamp(
      heightPx / (2 * Math.tan(look.fov * Math.PI / 360)) / 565, 0.85, 4.0,
    );
    for (const p of state.planets) {
      if (!aboveSkyline(p.sceneDir)) continue;
      const sizeCss = THREE.MathUtils.clamp(13 * Math.pow(0.74, p.mag) * zoom, 1.8, 30);
      labelItems.push({
        id: p.name,
        dir: p.sceneDir,
        text: p.name,
        cls: 'planet',
        priority: p.mag,
        ring: sizeCss / 2 + 5,
      });
    }
  }
  if (earth) {
    earth.update(state);
    earth.setBrightness(earthBrightness);
  }
  if (sun) sun.update(state);
  if (terrain) terrain.setSunDir(state.sun.sceneDir);

  labelLayer.setDim(uiDim);
  labelLayer.render(camera, labelItems, dt * 1000);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
