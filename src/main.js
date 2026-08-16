import * as THREE from 'three';
import { skyState } from './astro/engine.js';
import { mulMV } from './astro/vec.js';
import { clock } from './sim/clock.js';
import { SITES } from './sites.js';
import { createStarfield, starNameMagCut } from './scene/starfield.js';
import { createPlanets } from './scene/planets.js';
import { createLabelLayer } from './scene/labels2d.js';

// Scene coordinate convention (local horizon frame at the observer):
//   +X = East, +Y = Up (zenith), -Z = North  (so +Z = South)
// Azimuth is measured from North, positive toward East.

const app = document.getElementById('app');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); // vacuum: pitch black

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 2e6);
camera.position.set(0, 1.7, 0); // eye height above the regolith

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
// Interim keyboard controls (replaced by real UI in the controls task):
// time-lapse speeds, sky-layer toggles.
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
const site = SITES[0]; // Apollo 11 until the location picker task

// Placeholder ground (replaced by real LOLA terrain in the terrain task).
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(5000, 96),
  new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 1.0, metalness: 0.0 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

// Interim lighting driven by the real Sun position (full rig lands with the
// sun-and-lighting task).
const sunLight = new THREE.DirectionalLight(0xfff5ec, 0);
scene.add(sunLight);
const fillLight = new THREE.AmbientLight(0xdfe8ff, 0.08);
scene.add(fillLight);

let starfield = null;
let planets = null;
const labelLayer = createLabelLayer(app);

const ready = (async () => {
  starfield = await createStarfield(renderer.getPixelRatio());
  planets = createPlanets(renderer.getPixelRatio());
  scene.add(starfield.group);
  scene.add(planets.group);
})();
ready.catch((err) => console.error('sky init failed:', err));

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
  const sunUp = THREE.MathUtils.smoothstep(state.sun.alt, -0.5, 1.5);
  const skyDim = 1 - 0.9 * sunUp;
  const heightPx = renderer.domElement.clientHeight;

  const labelItems = [];
  if (starfield) {
    starfield.setOrientation(state.eqjToScene);
    starfield.updateApparentSizes(look.fov, heightPx);
    starfield.setDim(skyDim);

    const m = state.eqjToScene;
    if (toggles.starNames) {
      const cut = starNameMagCut(look.fov);
      for (const s of starfield.namedStars) {
        if (s.mag > cut) break; // sorted brightest-first
        labelItems.push({
          id: s.id,
          dir: mulMV(m, s.vEqj),
          text: s.name,
          cls: 'star',
          priority: 100 + s.mag * 10,
        });
      }
    }
    if (toggles.constellations) {
      for (const c of starfield.constellations) {
        labelItems.push({
          id: c.id,
          dir: mulMV(m, c.anchorEqj),
          text: c.name,
          cls: 'const',
          priority: 300 + c.rank * 30,
        });
      }
    }
  }
  if (planets) {
    planets.update(state.planets);
    planets.updateApparentSizes(look.fov, heightPx);
    planets.setDim(skyDim);
    const zoom = THREE.MathUtils.clamp(
      heightPx / (2 * Math.tan(look.fov * Math.PI / 360)) / 565, 0.85, 4.0,
    );
    for (const p of state.planets) {
      if (p.alt < -0.5) continue;
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
  labelLayer.setDim(Math.pow(skyDim, 0.7));
  labelLayer.render(camera, labelItems, dt * 1000);

  sunLight.intensity = 3.0 * sunUp;
  sunLight.position.set(
    state.sun.sceneDir[0] * 2000,
    state.sun.sceneDir[1] * 2000,
    state.sun.sceneDir[2] * 2000,
  );

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
