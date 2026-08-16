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

## Checkpoints

- 2026-08-15: Tasks 1-2 built. Scaffold (Vite+Three, drag-look camera, FOV zoom) passing build; astro core passing 10/10 Horizons-verified tests. Research fleet verified all external sources (8/8).
- 2026-08-15 (later): Task 3 shipped after 3 dogfood rounds + UX critique. Constellation geometry ±0.14° vs real sky; label architecture rebuilt screen-space after critique; star hierarchy rebuilt; p95 10.2ms. Open: east/west drift direction needs task-7 compass to verify; Sun disc is task 5.
