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

  return {
    group,
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
      glare.scale.setScalar(discR * 9 * open);
      disc.material.color.setScalar(60 * Math.max(open, 0.0));
      group.visible = s.alt > -1.2 && open > 0.001;
    },
  };
}
