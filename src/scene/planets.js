import * as THREE from 'three';
import { SKY_RADIUS } from './starfield.js';

// The five naked-eye planets, drawn like bright stars at their true positions
// with magnitude-driven size/brightness (same visual law as the star shader).
// Labels and identification rings are drawn by the screen-space label layer.

const TINTS = {
  Mercury: [1.0, 0.93, 0.82],
  Venus: [1.0, 0.98, 0.9],
  Mars: [1.0, 0.62, 0.42],
  Jupiter: [1.0, 0.92, 0.8],
  Saturn: [1.0, 0.88, 0.68],
};

const VERT = /* glsl */ `
  attribute float aMag;
  attribute vec3 aColor;
  uniform float uZoom;
  uniform float uPixelRatio;
  uniform float uDim;
  varying vec3 vColor;
  varying float vIntensity;
  void main() {
    float sizeCss = clamp(13.0 * pow(0.74, aMag) * uZoom, 1.8, 30.0);
    vIntensity = clamp(0.075 * pow(10.0, -0.25 * (aMag - 2.0)), 0.004, 4.0) * uDim;
    vColor = aColor;
    gl_PointSize = sizeCss * uPixelRatio;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vColor;
  varying float vIntensity;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float g = exp(-dot(p, p) * 18.0);
    if (g < 0.004) discard;
    gl_FragColor = vec4(pow(vColor, vec3(1.4)) * vIntensity * g, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createPlanets(pixelRatio) {
  const names = Object.keys(TINTS);
  const geom = new THREE.BufferGeometry();
  const positions = new Float32Array(names.length * 3);
  const mags = new Float32Array(names.length);
  const colors = new Float32Array(names.length * 3);
  names.forEach((n, i) => colors.set(TINTS[n], i * 3));
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('aMag', new THREE.BufferAttribute(mags, 1));
  geom.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const uniforms = {
    uZoom: { value: 1 },
    uPixelRatio: { value: pixelRatio ?? 1 },
    uDim: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const points = new THREE.Points(geom, mat);
  points.frustumCulled = false;
  points.renderOrder = 2;

  return {
    group: points,
    update(planetStates) {
      for (const p of planetStates) {
        const idx = names.indexOf(p.name);
        if (idx === -1) continue;
        positions.set([
          p.sceneDir[0] * SKY_RADIUS,
          p.sceneDir[1] * SKY_RADIUS,
          p.sceneDir[2] * SKY_RADIUS,
        ], idx * 3);
        mags[idx] = p.mag;
      }
      geom.attributes.position.needsUpdate = true;
      geom.attributes.aMag.needsUpdate = true;
    },
    setDim(v) {
      uniforms.uDim.value = v;
    },
    updateApparentSizes(fovDeg, heightPx) {
      const pxPerRad = heightPx / (2 * Math.tan(fovDeg * Math.PI / 360));
      uniforms.uZoom.value = THREE.MathUtils.clamp(pxPerRad / 565, 0.85, 4.0);
    },
  };
}
