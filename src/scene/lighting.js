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

      // How much light the scene is actually taking, which is not the same as
      // the Sun being up: at grazing incidence the ground receives sin(alt) of
      // its noon illuminance, so the first few degrees of a lunar dawn are
      // genuinely dim and a camera stays open through them. Keying exposure to
      // this instead of to sunrise itself is what lets the stars survive a
      // sunrise, which is correct — there is no air here to put them out.
      const dayLoad = sunUp * THREE.MathUtils.smoothstep(
        Math.sin(Math.max(state.sun.alt, 0) * Math.PI / 180), 0, 0.1,
      );

      sunLight.intensity = 3.4 * sunUp;
      sunLight.position.set(
        state.sun.sceneDir[0] * 2000,
        state.sun.sceneDir[1] * 2000,
        state.sun.sceneDir[2] * 2000,
      );
      sunLight.target.position.set(0, 0, 0);

      // Earthshine: a full Earth lights the ground ~40x brighter than full
      // moonlight on Earth. With the night exposure open, the landscape should
      // be dimly but clearly visible — it is one of the signature sights here.
      earthLight.intensity = 0.15 * earthGlow;
      earthLight.position.set(
        state.earth.sceneDir[0] * 2000,
        state.earth.sceneDir[1] * 2000,
        state.earth.sceneDir[2] * 2000,
      );
      earthLight.target.position.set(0, 0, 0);

      bounce.intensity = 0.02 * sunUp + 0.008 * earthGlow;

      // Exposure: ~0.9 in daylight; at night it opens up so earthshine-lit
      // regolith reads as deep twilight. With a dark Earth overhead there is
      // genuinely nothing to see on the ground and the frame is stars on black.
      const NIGHT_BASE = 3.0;
      const nightExposure = NIGHT_BASE + 5.5 * earthGlow;
      const targetExposure = 0.9 * dayLoad + (1 - dayLoad) * nightExposure;
      const k = 1 - Math.exp(-(dtReal ?? 0.016) / 0.6);
      current.exposure += (targetExposure - current.exposure) * k;
      renderer.toneMappingExposure = current.exposure;

      const E = current.exposure;
      // Sunlit ground floods the camera, so the stars go with it — the reason
      // the Apollo surface photographs have empty black skies.
      const daylightWash = 1 - 0.94 * dayLoad;
      // ...but the earthshine half of that ramp exists only so the ground stays
      // visible as the Earth waxes, and the sky has no business riding it: a
      // fuller Earth does not make the Milky Way brighter. Divide that part of
      // the exposure back out so sky brightness depends on the Sun alone.
      const skyHold = (0.9 * dayLoad + (1 - dayLoad) * NIGHT_BASE) / E;
      return {
        // Stars, planets and the Milky Way are scene-linear and tone-mapped:
        // they wash out under a sunlit surface and hold steady through the
        // night whatever the Earth is doing.
        starDim: daylightWash * skyHold,
        // The Earth IS exposure-compensated. Its true brightness against the
        // earthshine-lit ground is a ratio of order a million to one; holding
        // its appearance steady is a deliberate camera-like compromise so the
        // hero object stays readable instead of clipping to a white disc.
        earthBrightness: (1.35 + 0.25 * (1 - dayLoad)) / E,
        // The 2D label layer composites outside tone mapping entirely, so it
        // takes a plain 0..1 factor.
        uiDim: 0.3 + 0.7 * daylightWash,
      };
    },
  };
}
