import * as THREE from 'three';

// The Sun: a hard white disc (no atmosphere = no reddening, ever) plus a
// camera-glare halo sprite. Angular size comes from the ephemeris (~0.53°).

const SUN_DIST = 300000;

function radialTexture(stops, size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [t, c] of stops) g.addColorStop(t, c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createSun() {
  const disc = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture([
      [0, 'rgba(255,255,255,1)'],
      [0.86, 'rgba(255,252,246,1)'],
      [0.92, 'rgba(255,250,240,0.55)'],
      [1, 'rgba(255,248,235,0)'],
    ]),
    color: 0xffffff,
    transparent: true,
    depthWrite: false,
  }));
  disc.material.color.setScalar(60); // HDR-hot so tone mapping clips to white

  const glare = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture([
      [0, 'rgba(255,252,245,0.55)'],
      [0.25, 'rgba(255,250,240,0.16)'],
      [0.6, 'rgba(255,248,238,0.045)'],
      [1, 'rgba(255,246,235,0)'],
    ]),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));

  const group = new THREE.Group();
  group.add(glare);
  group.add(disc);

  let pxPerRad = 700; // refreshed every frame via updateApparentSizes

  return {
    group,
    updateApparentSizes(fovDeg, heightPx) {
      pxPerRad = heightPx / (2 * Math.tan(fovDeg * Math.PI / 360));
    },
    update(state) {
      const s = state.sun;
      group.position.set(
        s.sceneDir[0] * SUN_DIST,
        s.sceneDir[1] * SUN_DIST,
        s.sceneDir[2] * SUN_DIST,
      );
      const discR = SUN_DIST * Math.tan(s.angRadiusDeg * Math.PI / 180) * 2; // sprite is diameter-scaled
      disc.scale.setScalar(discR * 1.12); // slight pad for the soft edge
      // Eclipsed by the Earth: the corona-less disc dims and its glare dies.
      const open = 1 - state.eclipseFraction;
      // Display floor on the bloom, never the disc: stars and planets are
      // magnitude-keyed blobs (starfield.js: 13*0.74^mag*zoom, capped 46 px),
      // so at wide FOV the brightest of them would out-size the Sun's
      // physically scaled glare — inverting the one brightness ranking the
      // sky must never get wrong. Track that law's largest blob (Sirius) and
      // keep the bloom's bright core (~0.3 of the sprite) 1.6x past it, so
      // 1.6/0.3 = 5.3x the blob. Past ~18 deg FOV the physical 9x-disc glare
      // is larger and the floor never engages.
      const zoom = Math.min(Math.max(pxPerRad / 565, 0.85), 4);
      const blobPx = Math.min(20.1 * zoom, 46);
      const glareFloor = (5.3 * blobPx / pxPerRad) * SUN_DIST;
      glare.scale.setScalar(Math.max(discR * 9, glareFloor) * open);
      disc.material.color.setScalar(60 * Math.max(open, 0.0));
      group.visible = s.alt > -1.2 && open > 0.001;
    },
  };
}
