import * as THREE from 'three';

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
// Placeholder scene content (replaced by real terrain/sky in later tasks).
// ---------------------------------------------------------------------------
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(5000, 96),
  new THREE.MeshStandardMaterial({ color: 0x5a5a5a, roughness: 1.0, metalness: 0.0 }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

const sunLight = new THREE.DirectionalLight(0xfff5ec, 2.0);
sunLight.position.set(1000, 800, -400);
scene.add(sunLight);
scene.add(new THREE.AmbientLight(0xffffff, 0.02));

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

  applyLook();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();
