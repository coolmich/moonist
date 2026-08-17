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
- **Live clouds**: `https://clouds.matteason.co.uk/images/4096x2048/clouds-alpha.png` (CORS `*` verified; EUMETSAT-derived; updates every 3 h; CC0 with required line "Contains modified EUMETSAT data"). Bundled fallback at `public/textures/clouds-fallback.png`.
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

- Labels are screen-space (2D canvas layer), not world-space sprites: uniform size, collision declutter by priority (planets → stars by mag → constellations by rank), 160ms fades, dark halos, altitude culling, whole-box viewport insetting. Three visual tiers: constellations UPPERCASE cool-gray, star names neutral, planets warm + identification ring.
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
- **Exposure** ramps from 0.9 in daylight to 3–10 at night depending on earthshine. Sky objects
  divide by exposure so they hold constant apparent brightness; the 2D label layer composites
  outside tone mapping and therefore must NOT be exposure-compensated (this was a real bug).
- **Compass marks** ride the terrain skyline (not a fixed 0° horizon) and keep full brightness
  in daylight, since they are navigation chrome rather than sky content.
- **Eclipses are modelled**: `eclipseFraction` from disc-overlap geometry kills sunlight and the
  Sun's glare when Earth covers it, verified against astronomy-engine's lunar-eclipse search.

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

- **A planet is drawn as two things**: the glare any bright point makes in a lens, bounded
  both in pixels (26) and on the sky (1.5°, so it cannot become a flying saucer at 100° FOV),
  and the real disc, which grows with magnification. Below about 1.5° of field the disc
  overtakes the glare and the glare drops to a 9% bloom around it.
- **The disc carries its phase.** Venus reaches 66 arcsec as a thin crescent; drawing it round
  once resolved would trade one wrong picture for another. The terminator comes from the true
  phase angle and faces the Sun's actual direction on screen.
- **Zoom now reaches 0.5°** (was 4°), because at 4° Jupiter is 2.6 px and nothing could ever
  resolve. At 0.5° Jupiter is ~14 px and Venus up to ~29 px.
- Two sign conventions here were settled by measurement, not reasoning, after both plausible
  readings produced a crescent facing the wrong way: the screen direction to the Sun is
  computed in JS from the camera's own axes (projecting two nearby points collapses when the
  Sun is close to the planet, which is exactly when crescents matter), and the terminator's
  softening width is one pixel expressed in disc radii — using the sprite-space radius instead
  smears it across the whole disc and looks like a phase error.

## Known limits

- The star catalogue is J2000 with no proper motion or aberration: the fastest-
  moving stars sit up to ~140 arcsec (0.04°) from their 2026 positions.
- LOLA at 64 ppd is ~475 m/px, so summits are smoothed — Mons Hadley measures
  ~4.7 km of relief against a true ~4.5 km above the plain, and features between
  roughly 200 m and 500 m fall between the DEM and the procedural cascade.
- The clock is clamped to 1700–2200, the range where the ephemeris is trustworthy.
- The Milky Way map is 2.6 arcmin per pixel, so it is sharp at the default field of view and
  progressively softer as you zoom in; below ~20° FOV it is visibly a smooth glow where a real
  photograph would resolve more stars. The catalogue's own 5,044 stars stay sharp at any zoom.
- The map still contains stars fainter than the catalogue's mag-6 limit, down to Gaia depth.
  Those are the point of it — they are the grain the band is made of — but a texel is 2.6
  arcmin, so at the 0.5° zoom limit it is magnified some 70x and reads as a smooth glow. The
  band is smooth at that scale anyway, but nothing there is sharp.
  The 5,044 stars the app draws itself are subtracted from the map, so nothing is drawn twice.

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
