import * as THREE from 'three';

// Scene lighting + camera-exposure model.
//
// Physically, full sunlight on the Moon is ~130,000 lux and full earthshine
// only ~0.1 lux — a raw ratio no display can show. Like a camera (or the
// human eye), we adapt: exposure rises through the lunar night so the
// earthshine-lit regolith becomes visible, and stars wash out when the
// sunlit surface dominates the frame.

export function createLighting(scene, renderer) {
  // The Sun is the white point here. On Earth the light we call "sunlight" is
  // already reddened by kilometres of air; in vacuum there is nothing to redden
  // it, so tinting the lamp warm was importing an atmosphere the scene does not
  // have. Measured 2026-08-18: the old 0xfff6ec lamp times the regolith tint
  // put the sunlit ground at linear B/R 0.79 against 1.00 in real surface
  // photography -- the entire beige cast, in two constants. The soil keeps its
  // own mild red slope (terrain.js), which is where the colour is actually
  // measured to live.
  const sunLight = new THREE.DirectionalLight(0xffffff, 0);
  sunLight.castShadow = true;
  // The shadow map covers the near field only, where crater rims and rocks cast
  // the shadows that sell the surface; beyond it, shading comes from surface
  // normals alone. At +/-150 m one texel was 0.15 m and a 30 cm block threw a
  // two-texel smudge; +/-60 m puts a texel at 0.06 m, which is what makes the
  // block field read as blocks.
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -60;
  sunLight.shadow.camera.right = 60;
  sunLight.shadow.camera.top = 60;
  sunLight.shadow.camera.bottom = -60;
  // three.js adds shadowBias to a depth NORMALISED over near..far, so the same
  // constant means whatever that span happens to be. Over the old 1100 m span,
  // bias -0.0006 was a 0.66 m depth offset: every block shorter than two thirds
  // of a metre was declared lit and its shadow vanished, which is most of the
  // block field. Keep the span just wide enough for the +/-60 m box and its
  // relief, and set the offset in metres that the span makes it mean.
  //
  // Measured after the change: it moves 0.06% of ground pixels and adds no
  // acne. It is kept because the old value was wrong by 0.66 m and would bite
  // the moment blocks or the shadow box change, not because it is visible --
  // at a high Sun a sub-metre block's shadow is a few pixels long whatever the
  // bias does, and at a low Sun the depth gap was already clearing 0.66 m.
  sunLight.shadow.camera.near = 1900;
  sunLight.shadow.camera.far = 2100;
  sunLight.shadow.bias = -0.0001;        // 200 m span -> 2 cm
  // Offset along the surface normal, in world units and independent of the
  // span; this is what actually holds acne off at grazing sun.
  sunLight.shadow.normalBias = 0.04;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const earthLight = new THREE.DirectionalLight(0xa9c2e8, 0);
  scene.add(earthLight);
  scene.add(earthLight.target);

  // Faint bounce light off the surrounding terrain.
  const bounce = new THREE.AmbientLight(0xfffaf4, 0);
  scene.add(bounce);

  const current = { exposure: 1 };

  return {
    /**
     * Returns { starDim, earthBrightness, uiDim } for the sky modules.
     * dtReal = wall-clock seconds since last frame (smoothing).
     */
    update(state, dtReal) {
      // During a total eclipse the surface goes dark even at local noon.
      const open = 1 - state.eclipseFraction;
      const sunUp = THREE.MathUtils.smoothstep(state.sun.alt, -0.5, 1.5) * open;
      const earthUp = THREE.MathUtils.smoothstep(state.earth.alt, -1, 2);
      const earthGlow = earthUp * state.earth.illumFraction;

      // How hard the Sun is lighting the ground, which is not the same as the
      // Sun being up: at grazing incidence it delivers sin(alt) of its noon
      // illuminance, so a lunar dawn is genuinely dim and comes on gradually.
      // This drives the ground's exposure, and nothing else.
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
      // Nothing on the Moon can dim a star. There is no air to scatter sunlight
      // into the line of sight, so the sky is exactly as bright at noon as at
      // midnight: the same stars, the same Milky Way, over a sunlit landscape.
      // Only a camera metering that landscape would lose them — sunlit regolith
      // is 24 stops brighter than the Milky Way's band — and no display has
      // 24 stops, so this one shows both and marks the daylight with a small
      // deliberate dip rather than pretending the sky went out.
      const daylightDim = 1 - 0.3 * dayLoad;
      // Stars get a lift once the Sun is down. A marked display choice: the sky
      // does not actually brighten at night (that is the whole point of the
      // skyHold below), so this is the camera opening up on the point sources
      // the way a night exposure does, and it is why the day level is left
      // exactly where it was -- the gain is 1 at full daylight by construction.
      // It rides the same dayLoad ramp as the ground's exposure, so it comes in
      // over the first few degrees of sunset rather than snapping on.
      const NIGHT_STAR_GAIN = 1.8;
      const starGain = 1 + (NIGHT_STAR_GAIN - 1) * (1 - dayLoad);
      // The exposure ramp exists for the ground: it opens through the night so
      // earthshine-lit regolith stays visible, and closes under the Sun. The sky
      // has no business riding either half of it — a fuller Earth cannot
      // brighten the Milky Way — so divide it back out and let the sky hold.
      const skyHold = NIGHT_BASE / E;
      return {
        // Stars and planets keep a steady brightness through the whole lunar
        // day, dipping while the Sun is up and lifting once it sets.
        starDim: daylightDim * skyHold * starGain,
        // The Milky Way does NOT take the night lift. Measured 2026-08-18
        // against reference imagery, our band already sits brighter than the
        // target (mean 26.5 against 23.8) while carrying less structure; the
        // gap there is contrast, not level, and raising it would flatten the
        // band further. Points get the lift, the band holds.
        bandDim: daylightDim * skyHold,
        // The Earth IS exposure-compensated. Its true brightness against the
        // earthshine-lit ground is a ratio of order a million to one; holding
        // its appearance steady is a deliberate camera-like compromise so the
        // hero object stays readable instead of clipping to a white disc.
        earthBrightness: (1.35 + 0.25 * (1 - dayLoad)) / E,
        // The 2D label layer composites outside tone mapping entirely, so it
        // takes a plain 0..1 factor.
        uiDim: 0.3 + 0.7 * daylightDim,
      };
    },
  };
}
