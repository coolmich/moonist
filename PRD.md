# Moonist — PRD & Plan

A realistic simulator of standing on the near side of the Moon and looking at the sky. Ground-level first-person view: real lunar terrain underfoot, the Earth hanging near-stationary in the sky showing its true current face with live clouds and a real day/night terminator, the Sun crossing the sky over the true ~29.5-day synodic period, and a real-time, astronomically correct star field with constellations.

## Product requirements (from the original request, 2026-08-15)

1. Real moon surface views from the ground.
2. Real spatial relationships between Moon, Sun, Earth (Earth near-stationary in the lunar sky, wandering only by libration).
3. Correct side of Earth facing the Moon, with Earth day/night from the Sun's true position.
4. Real-time cloud map on the Earth.
5. Realistic lunar day/night (~29.5 Earth days synodic; ~14.75 days of daylight).
6. User picks an origin location from candidate sites (all near-side).
7. Real-time constellations and major stars as backdrop.

## Architecture decisions

- **Stack**: Vite + Three.js + astronomy-engine (all local, no backend). Chosen over raw WebGL (equal result, more code), Stellarium-web-engine embed (poor customization for Earth-clouds/terrain), Babylon (no advantage), CesiumJS (Earth-centric, wrong fit), native Swift/Metal (distribution friction).
- **Ephemeris**: astronomy-engine v2.1.19 (MIT, ±1 arcmin). Moon orientation via `RotationAxis` (IAU WGCCRE Mean-Earth frame, full E1..E13 series — verified in source). Earth orientation via GAST + `Rotation_EQD_EQJ` (the IAU cartographic Earth model was measured 0.65° off in spin — do not use it).
- **Ground truth**: JPL Horizons test vectors (observer on lunar surface, `CENTER='coord@301'`) in `tests/fixtures/horizons.json`; `npm test` must stay green within 0.15° of Horizons.
- **Frames**: scene = local horizon frame, +X East, +Y Up, +Z South; azimuth N=0/E=90 (Horizons convention). Selenographic coords are Mean-Earth frame, east-positive — same as Horizons and LROC.
- **Live clouds**: `https://clouds.matteason.co.uk/images/{4096x2048,8192x4096}/clouds-alpha.png` (CORS `*` verified; EUMETSAT-derived; updates every 3 h; CC0 with required line "Contains modified EUMETSAT data"). The 4k (7 MB) loads always; the 8k (24 MB) is fetched only once the disc is drawn wider than half the 4k map, past which the texels are what the eye is looking at. Bundled fallback at `public/textures/clouds-fallback.png`.
- **Earth textures**: Solar System Scope 8K day/night + 2K specular (CC BY 4.0), landmark-verified equirectangular, 180°W at left edge.
- **Milky Way**: NASA SVS *Deep Star Maps 2020* (`starmap_2020_8k.exr`, svs.gsfc.nasa.gov/4851)
  — a render of 1.7 billion catalogued stars (Hipparcos-2 < mag 8, Tycho-2 to 11.5, Gaia DR2
  beyond), linear-light EXR, plate carrée in ICRF/J2000. Chosen over the ESO GigaGalaxy Zoom
  panorama (a genuine photographic mosaic, and its 800 Mpx original is not freely
  redistributable) and over the ESA Gaia flux map (CC BY-SA share-alike, galactic frame): the
  user's requirement was explicitly "not some photo concating", and a catalogue render is
  literally not a photograph. Credit NASA/Goddard SVS; Gaia DR2 ESA/Gaia/DPAC.
- **Stars**: d3-celestial `stars.6.json` (5044 stars to mag 6, XHIP/Hipparcos, BSD-3); coordinates are GeoJSON [lon,lat] deg where lon = RA mapped to −180..180. Constellation lines + localized names from same source. `starnames.min.json` = 493 named stars (trimmed at build time from starnames.json).
- **Terrain**: NASA CGI Moon Kit LOLA displacement (`ldem_16_uint.tif`, 16 ppd, uint16 half-meters, elev_m = raw·0.5 − 10000) → per-site patches preprocessed by a node script → real distant relief; procedural regolith detail near-field. LROC color map for albedo tinting.
- **Candidate sites** (ME-frame coords, LROC/IAU-verified): Apollo 11 (0.674, 23.473), Apollo 15 (26.132, 3.633), Apollo 17 (20.191, 30.772), Chang'e 3 (44.121, −19.512), Tycho (−43.30, −11.22), Grimaldi (−5.38, −68.36; Earth low at ~21° — the showcase "Earth on the horizon" site).

## Verification approach

- Astronomy: `npm test` (node:test) against Horizons fixtures — Sun/Earth topocentric alt/az at 2 sites × 3 epochs, selenographic sub-Earth/sub-solar points, sub-lunar point on Earth, angular sizes, Earth phase complement, Earth render-orientation matrix.
- Rendering/UX: headed-browser dogfood agent per task (/dev Step E); screenshots as evidence.

## Product decisions log

- Labels are screen-space (2D canvas layer), not world-space sprites: uniform size, collision declutter by priority (planets → stars by mag → constellations by rank), 160ms fades, dark halos, altitude culling, whole-box viewport insetting. Three visual tiers: constellations UPPERCASE cool-gray, star names neutral, planets warm. Planets and the Earth carry no drawn circle — the enclosing radius survives only as the clearance that keeps their label off the disc (`clearPx`).
- Star rendering: size 13·0.74^mag css px (zoom-scaled), intensity 10^(−0.25(mag−3)), B-V→temperature→RGB tint with 1.7-power saturation, 4-point diffraction spikes only below mag 1. No twinkle (vacuum).
- Duplicate traditional star names (Atik on ο and ζ Per) deduped to the brighter bearer; α Cen pair keeps one label.
- Camera: drag deltas in camera space (atan px/focal), az compensated by cos(alt) capped 0.15; fling velocity EMA with stationary-release zeroing; eased FOV zoom τ≈110ms. Zenith/nadir "deadness" when dragging horizontally at the pole is inherent alt-az behavior (Stellarium identical) — accepted.
- Keyboard: 1/2/3/4/5 speeds (1x..1wk/s), 0=now, C=constellations, N=star names (UI buttons come with the controls task).

## Product decisions (later rounds)

- **Default site is Grimaldi, not Apollo 11.** From the limb the Earth sits ~21° up, so the
  opening frame holds ground, horizon and Earth together — the whole premise in one image.
  Apollo 11 is one click away and is the flattest, most iconic surface.
- **Opening camera** aims at the Earth's azimuth, 7° below it, at 45° FOV.
- **Readout speaks in Earth days**: "Sunrise in 9.8 Earth days" rather than only a local clock,
  because a lunar hour is 1.23 Earth days and the clock alone misleads.
- **Terrain resolution**: 64 ppd LOLA (~475 m/px) fetched by range request, not the 16 ppd map
  — at 16 ppd Mons Hadley measured 3.0 km instead of its true ~4.5 km.
- **Radiometry**: terrain vertex colour is the site's real albedo scaled once (×2.2); the Earth
  is lit at the same intensity constant as the directional sunlight, so ocean/desert/cloud
  contrast comes out physically rather than by hand-tuning. Opposition surge peaks at ~1.4×.
  The cloud layer is anchored the same way: coverage and reflectance are chosen so the whole
  planet reflects 0.306 of the light falling on it — the Earth's measured Bond albedo — which
  is what keeps the disc off the shoulder of the tone curve where contrast dies.
- **Exposure** ramps from 0.9 in daylight to 3–10 at night depending on earthshine. Sky objects
  divide by exposure so they hold constant apparent brightness; the 2D label layer composites
  outside tone mapping and therefore must NOT be exposure-compensated (this was a real bug).
- **Compass marks** ride the terrain skyline (not a fixed 0° horizon) and keep full brightness
  in daylight, since they are navigation chrome rather than sky content.
- **Eclipses are modelled, both ways**: `eclipseFraction` from disc-overlap geometry kills
  sunlight and the Sun's glare when Earth covers it, verified against astronomy-engine's
  lunar-eclipse search. In the other direction the Earth shader darkens every surface point
  by the fraction of the Sun the Moon covers as seen from that point (`sunObscuration` in
  the engine is the shader's node-tested twin), so a solar eclipse at home shows here as the
  Moon's shadow crossing the disc — a broad penumbral smudge with a ~66 km umbral core —
  verified against astronomy-engine's global and local solar-eclipse searches (umbra ground
  point for 2026-08-12 and 2024-04-08; city obscuration to better than 0.5%). The shadow is
  geometry, not weather: it is right at any epoch, while the cloud map stays today's. The
  penumbra is drawn neutral — the amber tint DSCOVR photographs (solar limb darkening) is
  not modelled.

## Radiometry (the thing that was wrong, and the rule now)

Custom `ShaderMaterial`s do not get tone mapping or sRGB encoding unless their
fragment shader includes `<tonemapping_fragment>` and `<colorspace_fragment>`;
three.js only injects the *helpers*. Because the sky shaders omitted them, the
JS-side "divide by exposure, the renderer multiplies it back" contract silently
failed and sky brightness ran backwards. The rule now:

- **Nothing here can dim a star, and the sky is drawn that way.** There is no air
  to scatter sunlight into the line of sight, so the sky at lunar noon holds
  exactly what it holds at midnight: same stars, same Milky Way, over a sunlit
  landscape. Only a camera metering that landscape would lose them — sunlit
  regolith measures ~4,900 cd/m² against the Milky Way's ~2.7e-4, a ratio of
  **24 stops** — and no display has 24 stops. Rather than pick one end and
  pretend the other went out, the sky keeps a steady brightness all month and
  takes a small deliberate dip (×0.7) while the Sun is up, as a cue rather than
  as physics. The Apollo surface photographs are empty because their exposure
  was set for the regolith, which is a fact about the film, not about the sky.
- **The sky does not ride the exposure ramp at all.** Exposure climbs through the
  night so earthshine-lit ground stays visible and closes under the Sun; that is
  a device for the *ground*. A fuller Earth cannot brighten the Milky Way, so sky
  objects divide the whole ramp back out (`NIGHT_BASE / E`) and hold.
- **The ground's exposure follows illuminance, not sunrise.** It takes sin(alt)
  of its noon light, so a grazing Sun lights it faintly and lunar dawn comes up
  over the first ~6° of altitude — about half an Earth day — rather than
  snapping on the moment the Sun clears the horizon.
- **The Earth** *is* exposure-compensated (`K / E`). Its real brightness against
  earthshine-lit ground is a ratio of order 10⁶; holding its appearance steady
  is a deliberate camera-like compromise so the hero object stays readable.
- **The 2D label layer** composites outside tone mapping entirely and therefore
  takes a plain 0..1 factor. Never divide it by exposure.

## Terrain rule

Procedural detail may add texture but must not invent landscape. Relief beyond
about a metre per hundred metres of distance starts forming its own horizon,
which hides the real one (2.4 km on flat mare) and buries real mountains. Coarse
features fade in past the observer's own patch of ground so no one ever stands
inside a fabricated crater. `npm test` asserts the rendered skyline tracks the
LOLA skyline to under 1.2° peak and 0.3° mean at every site; a systematic offset
is the signature of an invented landscape.

## Milky Way decisions (2026-08-16)

- **The texture is data, not a picture.** The requirement was "not some photo concating", and
  the source is a catalogue render, so every star cloud and dust lane is where Gaia says it is.
  The build script asserts the band lies on the galactic equator and that the bulge is the
  Sagittarius star cloud rather than the anticentre *before* it writes anything, because a
  mirrored or rotated sky still looks like a sky. `npm test` re-checks the shipped pixels
  against the IAU galactic frame; all three wrong flip/mirror combinations fail it.
- **Linear in, camera out.** The texture carries the source's linear radiance under an sRGB
  transfer curve (scaled x3, which the shader divides out — eight bits of raw linear would put
  the faint sky at code 1-2). Nothing photographic is baked in: the exposure ramp and ACES do
  that work, so the band responds to the lunar day exactly as the stars do.
- **8192x4096 at WebP q68, 5.6 MB.** 4096 was measurably mushy once zoomed past ~40° FOV, and
  8192 costs 4 MB more; the band is the headline of the sky, so it got the pixels. Dither
  turned out to cost only 0.7% of the file, so it stayed — the faint-star grain is what the
  bits actually buy.
- **It loads after the first frame and fades in over 700 ms**, rather than holding up boot for
  5.6 MB the way the Earth textures do.
- **The catalogue's own stars are subtracted from the map.** Left in, each of the 5,044 was a
  core clipped by the gain, added on top of its own sprite by the star layer's additive
  blending: a mag-6 star and a mag-1 star ended up with the same white centre, and at the 4°
  zoom limit they became visible white squares. The build script pulls each one down to the
  local background measured in an annulus around it. Measured after: no residual core above
  0.25 linear (every bright star used to saturate), median residual 1.15x the background.
- **Brightness is a display choice**, marked as such in the code: the star renderer is already
  on a compressed magnitude curve rather than a flux scale (a mag-2 sprite is half a degree
  wide where the real star is arcseconds), so no single constant can be physical for both.
  It is set so the Sagittarius cloud holds its structure at the top of the night exposure ramp
  instead of blowing out, which is where a bright band stops reading as a photograph.

## Dogfood round, 2026-08-16 (all five findings were real)

- **Nothing on the Moon can dim a star, and the code was pretending otherwise.** The wash used
  to take the sky down to 6% the moment the Sun cleared the horizon, which is what an
  atmosphere would do, not a vacuum. The sky now holds its night brightness through the whole
  lunar day and only dips to 70% under the Sun. See the radiometry rule above.
- **Procedural detail must be band-limited to whatever carries it.** The ground's grain was
  differenced over a fixed 3 cm step while its finest octave has a 4 cm wavelength, so what
  reached the screen was the noise lattice, not dust: a grid of identical dimples marching in
  rows. Octaves now fade out as their wavelength approaches the pixel footprint, the slope is
  measured over that footprint, and crater classes finer than the polar mesh's local cell are
  dropped rather than sampled once per quad. The noise itself moved from value to gradient —
  value noise puts its extrema *on* the lattice, so every octave advertises its own grid.
- **Sky labels were projected from the scene origin, not the eye.** A fixed 1 km radius turns
  the camera's 1.7 m eye height into ~0.1° of parallax: invisible at 65° FOV, but a 9 px gap
  between the Earth's disc and its identification ring at 4°. Measured 9.3 px before, 0.9 after.
- **The equirect antimeridian fix had a kink.** Differentiating `atan(y, |x|)` as a stand-in
  for longitude is continuous but folds at x = 0, where its derivative cancels and the mip
  selection over-sharpens — a band of aliasing that sat still while the Earth turned through
  it. Both spheres now differentiate the direction and apply the chain rule, which is exact.
  Measured column sharpness at the right limb: 1.59x the disc mean before, 0.57x after.
- **The Milky Way was too bright**, for the two reasons above it: it rode the earthshine ramp,
  and it carried the catalogue's stars as clipped white cores.
- **The atmosphere was painted across the disc instead of around it.** Shading the shell from
  its own normal put a ring 11% brighter than the surface at 0.91 of the radius, on the
  sunlit side only — a bright arc inside the limb that read as an artefact, because it is
  one. The depth buffer cannot fix it here: at 200,000 units with near 0.5 and far 2e6, the
  globe and a shell 6,600 units behind it are ~1e-7 apart in NDC depth, so back-face culling
  by depth does nothing. The shader now computes each sight line's impact parameter and
  lights only the rays that miss the surface and graze the air, which from this distance is
  the one- or two-pixel arc it should be. Radial profile after the fix matches an
  atmosphere-free control to within a per cent everywhere inside 0.98 R.

## Planets are discs, not dots (2026-08-17)

Reported from dogfooding: planets never changed size no matter how far you zoomed. True, and
worse than it looked — the sprite was `clamp(11·0.76^mag·zoom, 1.8, 16)`, and every planet
brighter than about mag 1 sat on that 16 px ceiling from 45° FOV inward, so Venus, Jupiter,
Mercury, Mars and Saturn were all *the same size as each other* as well as at every zoom.

The deeper cause was that a planet had no angular size in the model at all. It does now:
`PLANET_RADIUS_KM` (IAU 2015 equatorial radii) with the distance from the observer gives
`angRadiusDeg`, and the Sun–planet–observer angle gives `phaseAngleDeg` and `illumFraction`,
all checked against Horizons from the lunar surface — angular diameter to 0.003%, phase angle
to 0.01°, illuminated fraction to 0.01 points (`tests/fixtures/horizons-planets.json`).

The first fix failed a second dogfooding round (2026-08-17): the glare pinned at a constant
26 px across the whole zoom range, and then dimmed away at a fixed disc-pixel threshold —
collapsing a 26 px blob into a ~5 px disc, so Saturn visibly *shrank* while zooming in. Both
mistakes came from tuning constants instead of stating the law. The law, now enforced by
`tests/planet-sizes.test.mjs` against real ephemeris states: **zooming in never makes a
planet smaller, and the glare only yields to a disc of comparable size.**

- **A planet is drawn as two things**: the glare any bright point makes in a lens, bounded
  both in pixels (26) and on the sky (1.5°, so it cannot become a flying saucer at 100° FOV),
  and the real extent — the disc, or for Saturn the ring span. The handoff between them is
  keyed on the *ratio* of the two sizes, never on a fixed threshold; the glare holds full
  strength until the extent rivals it, then eases to a 20% bloom whose footprint spans the
  disc. (Fading earlier measurably shrank Saturn 22 px → 18 px on screen — the fade window
  starts at 0.55 of the blob because of that measurement.)
- **Saturn has rings** — A/B/C zones and the Cassini division at their true radii (1.24–2.27
  globe radii), foreshortened by the real ring opening angle and rotated to the real pole,
  both from `RotationAxis` and pinned against Horizons' sub-observer/sub-solar latitudes at
  three epochs to <0.1° (`tests/fixtures/horizons-rings.json`, planetodetic→centric
  converted). In 2026 the rings are ~10° open showing the lit south face; date-jump to 2029
  and they open to 26° with the near arm correctly crossing in front of the globe. Ring
  brightness tracks how steeply sunlight strikes the ring plane, floored so a near-crossing
  ring reads as a hairline rather than vanishing (marked display floor). Globe shadow on the
  rings and ring shadow on the globe are not modeled.
- **Jupiter has its two equatorial belts**, banded by true planetocentric latitude from the
  same pole math (illustrative shading, not imagery). From the Moon's eastern horizon the
  belts can run nearly vertical on screen — that is the honest projection, verified against
  the computed pole position angle, not a bug.
- **A resolved disc uses surface brightness, not integrated magnitude.** The point-sprite
  intensity law saturated Jupiter's disc to featureless white; per-pixel disc brightness now
  follows geometric albedo over solar distance squared (Venus:Jupiter:Saturn ≈ 66:1:0.24),
  sqrt-compressed and anchored so Jupiter sits mid-tone at night — a marked display choice,
  since the eye adapts across that 270:1 span and a screen cannot. Venus stays blinding
  white, which is correct.
- **The disc carries its phase.** Venus reaches 66 arcsec as a thin crescent; drawing it round
  once resolved would trade one wrong picture for another. The terminator comes from the true
  phase angle and faces the Sun's actual direction on screen.
- **Zoom reaches 0.2°** (was 4°, then 0.5°), because the deep end must land somewhere worth
  arriving: at 0.2° Venus and Jupiter reach ~45 px, Saturn's ring span ~60 px — decisively
  past the 26 px blob. Measured on-screen profile for Saturn across 65°→0.2°:
  10 → 27 → 23 → 23 → 22 → 22 → 28 → 49 px, monotone within the ±2 px skirt noise.
- Two sign conventions here were settled by measurement, not reasoning, after both plausible
  readings produced a crescent facing the wrong way: the screen direction to the Sun is
  computed in JS from the camera's own axes (projecting two nearby points collapses when the
  Sun is close to the planet, which is exactly when crescents matter), and the terminator's
  softening width is one pixel expressed in disc radii — using the sprite-space radius instead
  smears it across the whole disc and looks like a phase error.

## The deep-zoom sky: stars are points, glow is glow (2026-08-17)

Reported from dogfooding: at deep zoom the background stars go "very low resolution". Right —
the Milky Way texture stores integrated light at 2.6 arcmin per texel, so under magnification
every star living in it bloated into a soft blob, and a 0.2° field holds on average none of
the 5,044 sharp catalogue stars. The rule that fixes it, the same band-limiting rule the
terrain follows: never present structure finer than the data carries — and carry the stars in
data that stays sharp.

- **A deep star layer**: Tycho-2 to V 10 (349,405 stars, 3.5 MB quantized binary built by
  `scripts/make-deepstars.mjs` from VizieR, Johnson V and B−V via the standard BT/VT
  transformations). Drawn as point sprites at every field of view — at 65° they are the
  band's sub-perceptual grain (the airless Moon's naked-eye limit genuinely runs past 6),
  zoomed in they are the sharp stars the texture could never be. Spot-checked against SIMBAD
  (five stars, 3 arcsec / 0.3 mag) and swept against the 5,044 so no star is drawn twice
  (`tests/deepstars.test.mjs`).
- **The texture now carries only the light fainter than V 10.** All 354k drawn stars are
  subtracted in `make-milkyway.mjs`; the residual checks in the fixture cover the 200
  brightest deep stars as well as the 300 brightest catalogue ones. Subtraction must use the
  sky metric: plate carrée stretches a star's image by 1/cos(dec), and a circular disc left a
  0.94-radiance streak at Dec −86°. Side effect: with no point sources left to encode, the
  texture dropped from 5.4 MB to 2.1 MB and nothing clips under the ×3 gain.
- **Band-limited magnification**: the sky shader never shows a texel wider than ~3 px —
  beyond that it walks up the mip chain, so the sub-V10 speckle melts into the smooth glow
  it honestly is instead of posing as bloated stars. Mip filtering conserves the light.
- **Aperture gain**: magnification implies aperture, and aperture brightens point sources
  while extended glow keeps constant surface brightness, so zooming lifts the faint stars
  out of the background — ramping from nothing at 14° FOV to full by 2°. A display
  convention marked in the shader, tied to zoom alone, never to the Sun; through a telescope
  here you can watch stars at lunar noon, which is exactly what a real one on the Moon
  would show.
- What this looks like: at 3° on the Sagittarius star cloud, ~100 sharp graded points over
  the real dust-lane structure; at 1.2°, ~50 points over smooth glow; off the band, a clean
  dark field of points — no fog balls around bright stars (those were the texture's copies
  of the drawn stars, and are gone with the subtraction). 8.2 ms/frame with the full layer.

## The Earth magnifier: one display dial, zero physics (2026-08-17)

**User request**: from the Moon the Earth is genuinely small — under 2° across, only about
four times the Moon's diameter in Earth's sky — and the user wants it artificially big over
the landscape, "so that the person on the moon can clearly see much more details of the
earth", configurable by dragging, without breaking the physics.

- **A magnifying glass held over the Earth alone.** The `EARTH ×1–×10` slider in the bar's
  Sky popover — a sky-display option, so it lives with the sky-display toggles — is
  log-mapped so the low end gets the travel; the left stop is exactly
  ×1. It scales only the drawn mesh. Everything computed *from* the Earth — earthshine on the ground, eclipse
  dimming, phase, orientation, the ephemeris itself — keeps the true angular radius, and the
  readout keeps reporting the real altitude and illumination. The setting persists per user;
  the view API adds `earthScale` / `setEarthScale` / `earthScaleMax` for automated checks.
- **The enlarged image covers what is behind it**, exactly as a magnifier's does: the opaque
  mesh depth-occludes stars, planets and the Sun's sprite, and the label occluder and the
  Earth's ring both use the scaled radius. Near new moon the Sun visibly slides behind a
  magnified Earth while the ground stays sunlit — accepted and commented in `earth.js`: the
  lighting is ephemeris-driven, the disc is a picture.
- **Magnification voids small-angle shortcuts — two review fleets, all findings confirmed
  numerically, fixed, and re-measured.** The physical ones: the atmosphere shader assumed
  parallel sight lines (true with the viewer ~60 globe radii out, false at the ×10 mesh's
  ~6, so the blue halo detached from the limb — it now builds the per-fragment ray from the
  drawn mesh's viewer distance), and that first fix briefly made the ocean glint's position
  a function of the dial — `uViewDistBody` is now two uniforms, true geometry for the
  picture's content, drawn-mesh geometry for the limb-hugging arc. The chrome ones: the
  off-screen Earth pointer tested only the disc centre, then only the on-axis radius — it
  now uses the off-axis penetration f·(tan φ − tan(φ−θ)), the same tan convexity the label
  ring needed for its enclosing radius; the slider originally sat in the dock, whose
  one-row width it pushed to 999 px — wrapping the dock to two rows across laptop widths,
  orphaning Credits, and colliding with the first-run hint — so it moved to the layers
  panel as its own row; keyboard arrows now tick the label visibly (step 0.025, ~6% per
  press); `aria-valuetext` speaks the ×N a sighted user sees instead of the raw log
  fraction; and the slider joined the shared focus-ring rule. Rehousing the control also
  fixed a pre-existing phone-width bug: the ≤560 px media block preceded the base
  `#ui-layers` rule it overrides (equal specificity, source order decides), stretching the
  layer toggles into a 716 px-tall wall.
- **The dial also voided the projection, and that one is fixed too — the round disc.** A
  rectilinear projection draws an off-axis sphere as an ellipse stretched along the screen
  radius by sec φ, with the area up sec³φ: measured 1.308 against a predicted 1.296 at 39.5°
  off-axis, across a sweep from 10° to 50° that tracks sec φ to three decimals. That is
  correct, and it is what a wide lens does. It is also invisible at the Earth's true 1.87° —
  a 21 × 16 px disc at 100° FOV, 5 px of stretch — because the ratio is the same at every
  size and only the absolute pixels show. The dial draws that disc 19° wide, and then the
  same ratio is 50 px of egg in the corner of the frame, which is what the user reported.
  So squash the drawn mesh back in clip space, along the screen radius through the disc
  centre, in the Earth's own vertex shader (`uWarp`, shared by the globe and the shell so
  they cannot part company). Projecting the silhouette cone gives semi-axes
  a_r = cos ρ sin ρ/P and a_t = sin ρ/√P with P = cos²ρ − sin²φ, so an anisotropic scale by
  a_t/a_r = √(1 − (sin φ/cos ρ)²) — which is 1/sec φ in the small-disc limit, as it must be —
  maps the ellipse exactly onto a circle. Done about the projection of the disc centre, that
  point is a fixed point: the Earth does not move, z and w are untouched so depth and
  occlusion are unchanged, and not one star is displaced. Note this is *not* a global
  projection change: it is a per-object correction, the same trick phone cameras use on
  faces at frame edges (Shih et al., SIGGRAPH 2019), and it is available here for free
  because the mask is one sphere whose position and radius are already known exactly.
- **Ramped by 1 − 1/S, not switched on.** At ×1 the ellipse *is* the truth and is left
  exactly alone — `discSquash` returns 1 and the matrix is identity, so the physical path is
  bit-for-bit what it was. 1 − 1/S is the fraction of the drawn radius the dial fabricated,
  so the correction undoes the stretch on the invented part and no more; and since the
  slider is continuous and log-mapped, a step at ×1 would have popped. Residual aspect at
  39.5° off-axis: 1.30 at ×1 (untouched), 1.14 at ×2, 1.07 at ×4, 1.03 at ×10.
- **What that gives up**: the limb no longer marks where an occultation of a star would
  happen. At ×10, where the disc is ten times too big, it did not mark anything anyway — and
  at ×1 the correction is identity, so where the limb is meaningful it is also exact. The
  label clearance and the off-screen chip's penetration both scale by the same factor, so
  they keep hugging the disc as it is actually drawn. One conservatism left alone: the label
  *occluder* is still an angular test at the magnified radius, so it suppresses labels in a
  band up to ~26 px wide outside the squashed limb at ×10 — it errs toward hiding, never
  toward a label landing on the Earth.
- **Accepted, documented, not fixed**: the enlarged mesh is geometrically a *closer* Earth,
  so the visible cap shrinks from 89.0° to 80.5° at ×10 — the outer ~1.4% of the true disc,
  already foreshortened to invisibility at ×1, slips out of frame as the dial rises. A
  shader ray-remap could restore it; not worth the risk to a verified shader. And dragging
  the slider while the Earth is off screen changes only the ×N label — the off-screen Earth
  chip, already visible in exactly that scenario, is the guidance to turn toward it.
- **Honesty rule**: whenever the dial is not ×1, an `EARTH ×N` chip sits top-right in
  chrome that never hides — it survives the Hide mode and every width — so a giant Earth
  on screen always says it is artificial. (The ×N also reads beside the slider itself.)
- Verified on screen: disc chords at ×5 measure 5.08× / 5.00× (H/V) of the ×1 chords at 30°
  FOV; the setting survives a reload; the ring encloses the disc on- and off-axis at ×10;
  the blue limb arc measures 3 px wide exactly at the ×10 limb, sunlit side only; the
  pointer fires only once the whole disc is off frame (near limb ~24 px past the edge at
  65°/×10) and never with a slab visible; the dock stays one row at 880–1024 px and across
  site changes; one arrow press ticks ×1.0 → ×1.1 with matching `aria-valuetext`; zero
  console errors.
- Round disc verified against the analytic silhouette by reading back the framebuffer at
  100° FOV, 1400 × 910, full Earth so no terminator truncates the chord. Disc extents
  radial × tangential, measured against predicted: ×2 37 × 33 (38 × 34), ×4 71 × 67
  (72 × 67), ×10 178 × 170 (176 × 172) — every one within 2 px, where an uncorrected ×10
  disc measures 215 × 164. At 25° off-axis, ×10 gives 146 × 145 against 147 × 145. Measured
  aspect runs ~2% above predicted at ×10, which is the ±1 px the limb threshold costs on
  each edge, not a residue of the projection. 38 tests green.

## Known limits

- The star catalogue is J2000 with no proper motion or aberration: the fastest-
  moving stars sit up to ~140 arcsec (0.04°) from their 2026 positions.
- LOLA at 64 ppd is ~475 m/px, so summits are smoothed — Mons Hadley measures
  ~4.7 km of relief against a true ~4.5 km above the plain, and features between
  roughly 200 m and 500 m fall between the DEM and the procedural cascade.
- The clock is clamped to 1700–2200, the range where the ephemeris is trustworthy.
- The Milky Way map is 2.6 arcmin per pixel; under magnification the shader deliberately
  yields to the smooth glow (see the deep-zoom section above), so below a few degrees of
  field the background between the drawn stars carries no structure finer than ~10 arcmin.
  That is the data's edge, not a bug.
- The drawn stars end at V 10 (Tycho-2's completeness limit is near there). A real telescope
  at the 0.2° floor would show thousands more to mag 13–14; here everything fainter is the
  texture's smooth glow. Every star to V 10 is subtracted from the map, so nothing is drawn
  twice.

## Checkpoints

- 2026-08-15: Tasks 1-2 built. Scaffold (Vite+Three, drag-look camera, FOV zoom) passing build; astro core passing 10/10 Horizons-verified tests. Research fleet verified all external sources (8/8).
- 2026-08-15 (later): Task 3 shipped after 3 dogfood rounds + UX critique. Constellation geometry ±0.14° vs real sky; label architecture rebuilt screen-space after critique; star hierarchy rebuilt; p95 10.2ms. Open: east/west drift direction needs task-7 compass to verify; Sun disc is task 5.
- 2026-08-16: Tasks 4-7 and 9 shipped. A six-agent verification fleet (astronomy,
  acceptance, UX, robustness, performance, code) plus adjudication found 12
  confirmed serious defects; all are fixed. Independent results worth keeping:
  ephemeris agrees with 26 fresh JPL Horizons rows across all six sites and a
  15-year span to **0.0037°**; the sub-lunar point matches Fourmilab to 0.009°;
  the star catalogue matches SIMBAD to 0.19 arcsec; the synodic period measures
  29.507 d with 14.76 d of daylight. After the terrain fix an adjudicator
  re-measured the skyline at 0.12° mean vs LOLA's 0.11° (was 2.75° vs 0.02°) and
  the observer's feet within 0.16 m of the datum (was −14.94 m at Apollo 15).
  Performance in a clean tab: 8.3 ms median, 9.5 ms p95 at Tycho, FOV 100.
  Build output 59 MB → 14 MB.
- 2026-08-16 (final gate): second 7-agent fleet on the fixed build — 7/7
  requirements PASS, all 9 prior defects verified fixed, zero console errors,
  UX 7.5/10. Two confirmed findings fixed: Tycho relocated from the central
  peak (crater centre!) to the eastern floor at (−43.30, −10.55); readout site
  line restored. Polish: earthshine visible at night, planets as capped
  brilliant points, coherent regolith grain, NaN/turn-count lookAt guards,
  clamp announcement, modal keyboard capture, site persistence. User-raised
  verification (2026-08-16): sub-lunar point re-checked against Horizons at two
  epochs (0.01° lon) and Fourmilab visually; cloud liveness proven by 66% pixel
  change in 15 h; readout now shows fetch time and "showing today's weather"
  when time-traveling.
- 2026-08-17: planets rebuilt after a second dogfooding report (Saturn shrank
  while zooming). Real angular sizes, phases, Saturn's rings and Jupiter's
  belts from the IAU poles (Horizons-checked to <0.1° at three epochs), disc
  surface brightness from albedo/d², zoom floor 0.2°. Size law pinned by
  `tests/planet-sizes.test.mjs`; on-screen sizes verified monotone by
  screenshot measurement. 34 tests green.
- 2026-08-17 (later): deep-zoom sky rebuilt after the "background stars go low
  resolution" report — Tycho-2 layer to V 10 (SIMBAD-checked), all drawn stars
  subtracted from the texture in the sky metric, band-limited magnification,
  aperture gain. Texture 5.4 → 2.1 MB; 8.2 ms/frame; 38 tests green.
- 2026-08-17 (Earth magnifier): user-requested display dial — the EARTH ×1–×10
  slider (layers panel) inflates only the drawn disc; every physical quantity
  keeps the true radius. On-screen chords measure 5.08×/5.00× at the ×5
  setting; persists across reload. Two adversarial review fleets confirmed
  twelve findings: small-angle shortcuts the magnification voided (atmosphere
  halo, glint geometry, pointer, ring), a dock-wrap layout regression that
  moved the control to the layers panel, keyboard/aria/focus gaps, and one
  pre-existing phone-width CSS cascade bug. Ten fixed and re-measured, two
  accepted and documented. 38 tests green.
- 2026-08-17 (round disc): user reported the magnified Earth going egg-shaped
  off-centre and asked what the trade-off was. Measured it first: the stretch is
  exactly sec φ (1.308 against 1.296 predicted at 39.5° off-axis), so the
  renderer was right and the projection was the cause — and the ratio is
  identical at every FOV, so capping the field would not have touched it. What
  made it visible was the magnifier: 5 px of stretch on a true-size disc, 50 px
  on a ×10 one. Fixed as a clip-space squash by √(1 − (sin φ/cos ρ)²) along the
  screen radius, in the Earth's vertex shader only, ramped by 1 − 1/S so ×1 is
  identity. Rejected the alternative of a global stereographic projection: it
  would make every disc exactly round and is what Stellarium defaults to, but it
  bows the horizon 67 px on a 1400 px frame at 65° FOV and 25° tilt, which on a
  surface simulator with real LOLA ridgelines reads worse than the egg, and it
  would turn every projection in the app nonlinear. 38 tests green. One
  precision note: "the Earth does not move" is exact for the projected sphere
  centre (the warp's fixed point, what `projectDir` reports); the drawn
  silhouette's own centre sits outboard of it — measured 17.6 px at ×10, 100°
  FOV, 44.9° off-axis, and 0.17 px at ×1 — so nothing may assume the disc is
  centred exactly where `projectDir` answers.
- 2026-08-17 (rings off): user asked for the gold identification circle around
  the planets to go. Removed for every ringed object, the Earth included — one
  code path, and a lone circle left on the Earth would have read as an
  inconsistency. The radius that drove it is kept as `clearPx`, so labels sit
  exactly where they did (verified: Saturn's label unmoved at 2.5° FOV between
  before/after screenshots; the Earth's label still clears the limb at ×10).
  38 tests green, zero console errors.
- 2026-08-17 (local clock): the chrome now speaks the viewer's own timezone
  instead of UTC — readout line, the datetime-local field (display *and*
  parse), and the cloud fetch time. The zone abbreviation is read from
  `Intl.DateTimeFormat` for the *simulated* date, so it tracks DST: the same
  build prints PST in January and PDT in July, and GMT+5:30 in Kolkata.
  Display only — the clock stays epoch ms and the ephemeris never sees a zone
  (verified: Sun 50.9° alt · 81° az and Earth 21.0° alt · 7% lit are identical
  in Kolkata and Los Angeles for 2026-05-04T09:15Z; only the wall clock
  differs). The readout's lunar-solar row was renamed **Lunar time**, since
  "Local time" would now name two different clocks in one panel. Layout: the
  widest label (GMT+5:30) leaves the dock one row at 880/900/1024/1280 px, the
  regression pinned above. Typing an hour that DST skips (02:30 on a
  spring-forward day) resolves forward to 03:30 and the field echoes back what
  it actually used — accepted, and the honest answer.
- 2026-08-17 (cloud clarity): user reported the cloud map as low-contrast and
  low-detail against zoom.earth. It was not the source — the shipped map's own
  filaments and stratocumulus cells are crisp (sd 75 of 255 over the tropical
  Atlantic); the renderer was throwing them away. **Cloud was painted as a
  perfect white reflector at coverage = the stored value**, which made the
  planet return 0.601 of the light falling on it, 1.96× the Earth's measured
  Bond albedo of 0.306. That excess put the whole disc in the shoulder of the
  ACES curve, where its slope is ~0.13 against ~0.89 in the midtones — the
  map's structure arrived at the screen compressed ~7×, as a milky sheet with
  the ocean painted over at 92% opacity. Fix: the one stored number is split
  into coverage `0.92·v^1.5` and reflectance `0.25 + 0.342·v`, the pair solved
  so the planet lands on 0.306 exactly. Thin cirrus and a convective tower now
  differ in brightness, not only in opacity. Measured in the renderer at ×10:
  disc sd 26.6 → 37.3 (+40%), p5–p95 range 85 → 120 levels, nothing clipped.
  The exponent 1.5 is the free parameter in the split (1.0 and 2.0 both also
  hit 0.306, at sd 31 and 46); it was chosen by eye against the source, and
  the reflectance is solved from whatever it is set to, so the total reflected
  light stays right. Also: anisotropy 8 → 16 for the oblique limb, and the 8k
  cloud map on demand (verified real detail, not an upscale: box-downsampling
  it reproduces the 4k to 3.5 levels while its gradient energy is 0.79× the
  4k's, not the 0.5× interpolation gives). Earthshine is unaffected — it comes
  from `illumFraction` in the astro core, never from the render.
- 2026-08-17 (eclipse shadow): user reported the 2026-08-12 eclipse missing
  from the Earth. Correct — only the reverse eclipse (Earth over the Sun) was
  modelled. Added: the Earth shader darkens each surface point by the fraction
  of the Sun the Moon covers as seen from that point; `sunObscuration` in the
  engine is the shader's node-tested twin, pinned against astronomy-engine's
  independent global and local eclipse searches (umbra ground point 2026-08-12
  and 2024-04-08; Reykjavik/Madrid/London obscuration to ≤0.5%). Dogfooded
  against the ephemeris-projected shadow axis (7 px agreement on a 299 px
  disc) and NASA's EPIC photograph of the same eclipse (umbra at r/R 0.90 vs
  0.89). Penumbra drawn neutral; the amber limb-darkening tint is not
  modelled. 43 tests green.
- 2026-08-17 (one-bar chrome): user reported corner-pinned, breakpoint-patched
  chrome and asked for an immersive mode. Rebuilt around three surfaces, from
  a three-design exploration judged adversarially (immersion-first, IA-first,
  phone-first): ONE bar at the bottom (site · five speeds · clock · Sky ·
  Credits · Hide — the speeds never fold at any width; the primary verb stays
  one tap), a one-line STATUS CAPSULE top-left (site · time · speed · next sun
  event; click/D expands the full readout, persisted), and HONESTY CHIPS
  top-right. Clock and Sky open popovers over the bar; below 720 px labels
  compact (Real/1m/1h/1d/1w, time-only clock, short site names) and the bar
  may wrap to two rows — capabilities relocate, never disappear (the old 620px
  query that deleted the date picker on phones is gone). Hide (H) fades all
  chrome; a clean tap on the sky, Esc, or H reveals; Esc never hides; hotkeys
  keep working while hidden with a transient OSD confirmation; the first two
  hides teach the way back. Honesty outranks immersion: `EARTH ×N` shows
  whenever magnified (chrome or no chrome), and a time chip confesses warped
  time while chrome is hidden. Auto-fade (video-player idle hide) was
  considered and rejected for v1: both review judges wounded it — it strands
  cold visitors and fades the sunrise countdown exactly while it is being
  watched. Label avoidance gets empty rects while hidden, so sky labels use
  the whole frame. 43 tests green.
- 2026-08-17 (home marker + picker Moon faces): user reported not being able
  to find themselves on the Earth ("I'm in Seattle... I cannot even recognize
  the continent, especially if there are a lot of clouds") and not knowing
  where the sites sit on the Moon. Two additions. (1) Sky → My location: the
  browser's geolocation, asked once and remembered, drives a home beacon —
  display chrome, never physics. Shipped first as a ring drawn in the Earth
  shader, sized to hold ~7 screen px; rejected by the user the same day
  (invisible against the clouds when small, a distraction covering continents
  when large) and replaced by a beacon: a thin gold shaft of light standing
  perpendicular on the viewer's point (0.5 R long, 0.014 R half-wide, the
  open-world-game "you are here" idiom), cylindrical-billboarded, intensity
  reaching exactly zero at its quad edges — a truncated gaussian drew the
  quad rectangle under additive blending — with a same-width foot dot that
  carries the marker when the shaft is seen end-on, both breathing ~3 s.
  Sized in globe radii by design: a fleck at 65° fov, unmissable below 40°,
  and it rides the EARTH ×N dial like the rest of the disc's image. Two
  rendering traps recorded: the depth buffer cannot separate the beacon from
  the globe at 200k scene units, so the materials carry polygon offset to win
  that tie deterministically (terrain still occludes), and the limb occlusion
  is computed analytically in a float32-stable form (cross-product impact
  parameter, fragment-relative depth) because the naive ray quadratic cancels
  3600-scale terms to order 1 and speckles. The readout's Home row answers the other half of the
  question: "facing the Moon" straight off the sub-lunar point, or "behind
  the Earth · back in ~N h" from an hourly ephemeris search (refreshed once
  a minute, skipped above 1 hr/s where hours pass per second). (2) The site
  picker pins each site on an orthographic near-side albedo disc rendered by
  make-moonface.mjs from the CGI Moon Kit color map — north up, east right,
  the naked-eye frame — landmark-asserted before writing because a mirrored
  Moon still looks like a Moon; pin math node-tested the same way. View API
  gains home/setHome/setHomeOn/homeReturnHours. 48 tests green.
- 2026-08-17 (public deploy + label/layer decisions): live at
  coolmich.github.io/moonist via GitHub Pages, tests gating every push;
  runtime asset URLs resolve through src/assetUrl.js because a Pages project
  site lives under a subpath. Evening tweak round, all user-driven: star
  points raised to 2.7x the original intensity with a 1.6 px sprite floor (a
  +33% first try was imperceptible — cores clip, and visible radius grows
  with the log of intensity), and the Milky Way's marked display constant
  went 1.0 -> 1.5, core re-checked for blow-out at night; cardinal marks dropped to alpha 0.35/weight 500 — navigation
  chrome, not sky; the home beacon blinks over ~8 s to a tenth of peak, at
  half its original brightness. N now clears every name in the sky — stars,
  planets, and the Earth's label — one switch for names, because a de-named
  sky with named planets still reads as an annotated chart (the off-screen
  Earth pointer chip stays: navigation, not a name). The Milky Way toggle and
  the M key are gone: the band is sky content, not chrome — turning it off
  was turning off the sky.
- 2026-08-17 (time controls + magnifier range): the five speeds collapse to
  three — Real, 1s = 1h, 1s = 1d — after user feedback that unit-per-second
  notation meant nothing untried, a minute a second was too slow to see
  anything and a week a second too fast to follow. The labels are an equation
  of screen time to sim time, the tooltips say what you will watch (an hour a
  second: the Earth turns; a day a second: the lunar day and the phases), and
  hotkeys are 1–3. The clock popover keeps its Now button (0). The EARTH
  magnifier range doubles to ×1–×20.
- 2026-08-17 (cursor zoom, two rounds): the wheel first pinned the pixel
  under the mouse exactly (closed-form re-aim through the rectilinear
  projection, 9 px drift over a 36x zoom) — and the user rejected it: with
  the cursor near the edge the exact pin demands tan-scale swings and the
  whole frame rotates and shears. Genre check: Stellarium wheel-zooms at the
  view centre and offers zoom-in-on-SELECTED-object instead (cursor zoom is
  a long-open feature request there). Final design is the compromise: each
  frame of the eased fov step rotates the view centre toward the direction
  under the cursor by the fraction the field shrank (slerp in angle space) —
  in the small-angle limit that holds the pixel like a map, at wide field it
  under-rotates so the pointed-at object drifts gently toward centre as the
  zoom deepens, and zooming back out reverses it. Bounded rotation, no
  shear; measured 59° of smooth sweep for a corner-cursor dive from 100°.
  Cleared by drag/lookAt/keys, which stay centre-anchored.
- 2026-08-17 (idle-translucent chrome): the dock, status capsule and chips
  rest at opacity 0.45 and return to full on hover or keyboard focus
  (focus-within), with the dock held solid while its popover is open. This
  is dimming, not the auto-FADE rejected on 2026-08-17 — nothing vanishes,
  every honesty surface stays readable at all times, and immersive mode's
  full-strength chips out-rank the dim on specificity. Hover-gated
  (@media hover) so touch devices keep solid chrome.
