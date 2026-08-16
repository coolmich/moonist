import * as THREE from 'three';

// Scene lighting + camera-exposure model.
//
// Physically, full sunlight on the Moon is ~130,000 lux and full earthshine
// only ~0.1 lux — a raw ratio no display can show. Like a camera (or the
// human eye), we adapt: exposure rises through the lunar night so the
// earthshine-lit regolith becomes visible, and stars wash out when the
// sunlit surface dominates the frame.

export function createLighting(scene, renderer) {
  const sunLight = new THREE.DirectionalLight(0xfff6ec, 0);
  sunLight.castShadow = true;
  // The shadow map covers the near field only (~0.15 m per texel), where
  // crater rims and rocks cast the shadows that sell the surface. Beyond it,
  // shading comes from surface normals alone.
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -150;
  sunLight.shadow.camera.right = 150;
  sunLight.shadow.camera.top = 150;
  sunLight.shadow.camera.bottom = -150;
  sunLight.shadow.camera.near = 1500;
  sunLight.shadow.camera.far = 2600;
  sunLight.shadow.bias = -0.0006;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const earthLight = new THREE.DirectionalLight(0xa9c2e8, 0);
  scene.add(earthLight);
  scene.add(earthLight.target);

  // Faint bounce light off the surrounding terrain.
  const bounce = new THREE.AmbientLight(0xfff0e0, 0);
  scene.add(bounce);

  const current = { exposure: 1 };

  return {
    /**
     * Returns { starDim, earthBrightness } for the sky modules.
     * dtReal = wall-clock seconds since last frame (smoothing).
     */
    update(state, dtReal) {
      // During a total eclipse the surface goes dark even at local noon.
      const open = 1 - state.eclipseFraction;
      const sunUp = THREE.MathUtils.smoothstep(state.sun.alt, -0.5, 1.5) * open;
      const earthUp = THREE.MathUtils.smoothstep(state.earth.alt, -1, 2);
      const earthGlow = earthUp * state.earth.illumFraction;

      sunLight.intensity = 3.4 * sunUp;
      sunLight.position.set(
        state.sun.sceneDir[0] * 2000,
        state.sun.sceneDir[1] * 2000,
        state.sun.sceneDir[2] * 2000,
      );
      sunLight.target.position.set(0, 0, 0);

      earthLight.intensity = 0.042 * earthGlow;
      earthLight.position.set(
        state.earth.sceneDir[0] * 2000,
        state.earth.sceneDir[1] * 2000,
        state.earth.sceneDir[2] * 2000,
      );
      earthLight.target.position.set(0, 0, 0);

      bounce.intensity = 0.02 * sunUp + 0.003 * earthGlow;

      // Exposure: day ≈ 0.9; at night it opens up so earthshine-lit regolith
      // reads as deep twilight. With a dark Earth overhead there is genuinely
      // nothing to see on the ground, and the frame is stars over black.
      const targetExposure = 0.9 * sunUp + (1 - sunUp) * (3 + 7 * earthGlow);
      const k = 1 - Math.exp(-(dtReal ?? 0.016) / 0.6);
      current.exposure += (targetExposure - current.exposure) * k;
      renderer.toneMappingExposure = current.exposure;

      // Sky objects are self-luminous relative to the ground: their display
      // brightness is held constant against the exposure ramp (otherwise the
      // sunlit Earth would clip to a white blob all lunar night, which is
      // what a real camera does but not what a sky simulator should show).
      // These divide by exposure because the renderer multiplies it back in.
      const E = current.exposure;
      const daylightWash = 1 - 0.94 * sunUp;
      return {
        // Camera exposed for sunlit ground can barely register stars.
        starDim: daylightWash / E,
        // The Earth is sunlit regolith's brighter cousin (albedo ~0.3 vs
        // ~0.09), so it is lit at the same intensity as the directional light.
        earthBrightness: (3.6 + 1.2 * (1 - sunUp)) / E,
        // The 2D label layer composites outside tone mapping, so it takes the
        // plain 0..1 factor with no exposure division.
        uiDim: 0.25 + 0.75 * daylightWash,
      };
    },
  };
}
