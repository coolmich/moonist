# Moonist — project notes

A real-time simulator of the sky seen from the lunar near side. Read `README.md` for what the
product is and `PRD.md` for the requirements and the decision log.

## Non-negotiables

- **The astronomy is checked, not asserted.** Any change to `src/astro/` must keep
  `npm test` green. Those tests compare against JPL Horizons vectors for an observer on the
  lunar surface; if a test fails, the code is wrong, not the fixture. New astronomical
  behaviour needs a new external cross-check (Horizons, Fourmilab, or astronomy-engine's own
  independent search functions), not a self-consistent assertion.
- **Physical correctness beats familiarity.** A black daytime sky *still full of stars*, an
  Earth that never moves, a surface that is nearly invisible during lunar night with a dark
  Earth — these are correct. Do not "fix" them. In particular nothing here dims a star: with
  no air to scatter sunlight, the sky at noon holds what it holds at midnight, and the sky's
  brightness is deliberately held independent of the exposure ramp (`NIGHT_BASE / E` in
  `lighting.js`), which exists only so the ground stays visible.
- **Where display choices override physics, say so in a comment.** The exposure model and the
  constant-brightness sky objects are deliberate camera-like compromises; they are marked.

## Two rules that were learned the hard way

- **Custom shaders must tone-map themselves.** three.js injects the tone-mapping
  and colour-space *helpers* into a `ShaderMaterial` but not the calls. Any new
  sky shader needs `#include <tonemapping_fragment>` and
  `#include <colorspace_fragment>` at the end of `main()`, or it silently
  bypasses exposure and renders in the wrong colour space. See the radiometry
  section of `PRD.md` for which objects are exposure-compensated and which are not.
- **Procedural terrain must not out-rank the real data.** Anything that raises
  relief near the observer can build a false horizon that hides the real one.
  `npm test` pins the rendered skyline against the LOLA-only skyline; if that
  test fails, the landscape is being invented, not textured.
- **Procedural detail must be band-limited to whatever carries it**, or the
  carrier's own grid is what reaches the screen. Craters finer than the polar
  mesh's local cell (`MESH_CELL * distance`) get sampled once per quad and march
  in rows; noise octaves finer than the pixel footprint (`fwidth`) alias into a
  lattice, and the slope has to be differenced over that footprint rather than a
  fixed step. Use gradient noise, never value noise: value noise puts its
  extrema exactly on the lattice, so any sharpening of it draws the grid.

## Conventions that bite

- **Scene frame**: +X east, +Y up, +Z south. Azimuth is measured from north through east
  (Horizons convention). Altitude is above the horizon.
- **Sky directions must be projected from the camera, not the origin.** The eye stands
  `groundY + 1.7` above the scene origin, so projecting `dir * R` puts a label ~0.1° off —
  nothing at 65° FOV, a visible offset between a disc and the label beside it at 4°.
- **New chrome joins two lists or it misbehaves**: the node list in `panelRects()` (or sky
  labels slide under it), and — only if it must survive Hide — the `#hud.immersive`
  exception selector. Everything else fades. The survivors are the warped-time chip and the
  error toast. `EARTH ×N` used to survive too and no longer does (2026-08-18, user asked
  three times): Hide has to mean hide, and the magnifier is the user's own deliberate act
  that the dial re-states the instant chrome returns. Warped time keeps its exception
  because the clock can run away on its own; the magnifier never moves unless somebody
  moves it.
- **Every Earth mesh must carry `uWarp`.** The magnified disc is de-stretched by a
  clip-space squash applied in the Earth's vertex shader (`gl_Position = uWarp * ...`), which
  is what keeps it round off-axis; a new material on that group without the uniform renders
  an ellipse next to a circle. It is identity at ×1 by construction, so the physical path is
  untouched. `discSquash()` is exported because the label clearance and the off-screen chip
  have to shrink with the disc — anything else that measures the drawn limb needs it too.
- **The disc's image lives at the true viewpoint; its mesh at the drawn one.** The
  magnified mesh is geometrically a closer Earth, so every Earth material carries both
  viewer distances and converts between the viewpoints with `capRemapDir` — the globe's
  picture forward (drawn → true), anything standing on the picture (the beacon) inverse.
  A new material that samples or anchors on the disc without the remap is wrong only
  under magnification, which is exactly when nobody checks. Identity at ×1 by
  construction; JS twin `capRemap` is exported and pinned by `tests/magnifier.test.mjs`.
- **Equirect UV derivatives come from the direction, not from `atan2`.** Differentiate the
  direction and chain-rule it (`src/scene/earth.js`); `atan2` jumps at the antimeridian and
  the obvious folded stand-in kinks at ±90°, which over-sharpens the mip in a band there.
- **A fragment normal perturbation is added in VIEW space.** At
  `#include <normal_fragment_begin>` three has just written `normal = normalize(vNormal)`,
  and `vNormal` went through `normalMatrix` — so a slope differenced along world X and Z
  (`vWorldPos`) must be rotated with `mat3(viewMatrix)` before the add, never added raw.
  Use `viewMatrix`, not `normalMatrix`: three declares `normalMatrix` only in the *vertex*
  prefix. Added raw, the relief is lit from a direction that turns with the camera — exact
  at due north, exactly negated at due south, where craters render convex and disagree with
  both the shadow map and the mesh cascade's own craters. The bug hid for as long as the
  only carrier was isotropic grain (a rotated gradient field is statistically identical);
  micro-craters have recognisable shape, which is what made it visible (2026-08-19).
  Measured: with the same ground point sampled across ±28° of heading, view-dependence
  fell from 14.7% to 5.1% (the remainder is mip and AA).
- **Selenographic coordinates** are Mean-Earth/polar-axis frame, east-positive — the same
  frame LROC coordinates and Horizons' lunar topocentric output use.
- **astronomy-engine gotchas**: `RotationAxis().ra` is in *sidereal hours* (multiply by 15),
  `.spin` is unnormalised degrees, `SiderealTime()` returns hours. `GeoVector`'s third
  argument (aberration) is required. For planet poles use `RotationAxis().north` (an EQJ
  vector) directly and skip the ra/dec pitfalls. Horizons' sub-observer/sub-solar latitudes
  are planeto*detic*; a pole-vector dot product gives planeto*centric* — convert with the
  body's flattening before comparing (1.9° apart for Saturn even at B = −10°).
- **Earth orientation** must come from GMST/GAST + `Rotation_EQD_EQJ`, not from
  `RotationAxis(Body.Earth)` — the IAU cartographic Earth model is ~0.65° off in spin, which
  puts the wrong meridian at the centre of the disc.
- **Equirectangular textures** here have 180°W at the left edge, Greenwich at the centre
  (verified by landmark sampling). `u = lon/2π + 0.5`. Anything stamped into or measured on
  one must use the sky metric — plate carrée stretches features by 1/cos(lat), and a
  circular star-subtraction disc left a 0.94-radiance streak at Dec −86°.
- **The sky texture uses the same convention with RA for longitude**: `u = RA/2π + 0.5`,
  north at the top row. NASA's source map is stored rotated 180° from that, so
  `make-milkyway.mjs` mirrors and flips it — and asserts the result before writing, because
  a mirrored sky still looks like a sky. `npm test` pins it against the IAU galactic frame.
- **LOLA encoding**: `elevation_m = raw_uint16 * 0.5 - 10000`, relative to a 1737.4 km sphere.
- **Runtime asset URLs go through `assetUrl()`** (`src/assetUrl.js`), never a bare
  `'/textures/...'` string — the site deploys to a GitHub Pages subpath
  (https://coolmich.github.io/moonist/, auto-deployed from main by
  `.github/workflows/deploy.yml`), where root-absolute paths 404. The helper also keeps
  scene modules importable by node tests, where Vite's env object does not exist.

## Layout

```
src/astro/     ephemeris core, pure math, no renderer imports (must stay node-testable)
src/scene/     one module per rendered thing; each owns its material and update()
               (rocks.js is the one exception: geometry only, owned by terrain.js)
src/ui/        all chrome; talks to the app only through the `view` API in main.js
src/sim/       simulation clock
scripts/       one-off data extraction (terrain patches from NASA LOLA)
tests/         node:test suites; fixtures/horizons.json is ground truth
public/        textures, star catalogs, generated terrain patches
```

`window.moonist` exposes `lookAt/look/state/site/setSite/clock` plus
`earthScale/setEarthScale/earthScaleMax` (the Earth display magnifier, ×1–×20 — scales only
the drawn disc, never anything physical) and `home/setHome/setHomeOn/homeReturnHours` (the
viewer's home beacon on the Earth — a display light shaft, never physics) — the UI uses it, and so
do automated browser checks. Keep it stable.

- **Ground detail is a three-stage handoff, and each stage must stop where the next
  begins.** The height-field crater cascade (`terrain-shape.js`) can only carry features
  larger than the polar mesh's cell, `MESH_CELL * distance`; below that the fragment
  micro-craters in `terrain.js` take over, fading in exactly as the mesh loses a size class;
  below the *pixel* footprint (`fwidth`) even those cannot be shaded as relief, so what
  survives is contrast, carried as albedo mottling. Widen any stage without narrowing its
  neighbour and you get the same crater drawn twice; leave a gap and the ground goes glassy,
  which is what it did before 2026-08-18.
- **Rocks are geometry, never height field.** `src/scene/rocks.js` instances ~20k blocks
  because the ground mesh cannot represent them: at `MESH_CELL` a 1 m block 30 m away spans
  about one quad, so the height-field `boulders()` still in `terrain-shape.js` can only ever
  be a soft lump — it was left in place and the two now overlap inside ~36 m, which is the
  one known redundancy here. Sizes follow the measured lunar block size-frequency law
  (N(>R) ~ R^-2.7) as octave classes; density is a single constant (`N_REF`) scaled by an
  optional `site.rockAbundance`, which **no site currently sets** — every site takes the
  `?? 1` default, so the dial is a hook, not a tuned per-site value. Blocks cluster onto
  fresh crater rims via the surface's own
  `rim` weight. `npm test` pins that a block never clears the LOLA skyline by more than its
  own angular size — a block breaking the horizon is real (flat mare, 2.4 km horizon), a
  block breaking it by more than it subtends is invented relief.
- **The Sun is the white point; colour lives in the regolith.** There is no air to redden
  the light, so the lamp is neutral `0xffffff`. A warm lamp (`0xfff6ec`) times the soil tint
  put the sunlit ground at linear B/R 0.79 where real surface photography measures 1.02 —
  the whole beige cast, in two constants. If the ground ever looks tan again, check the lamp
  before touching the albedo.
- **The Milky Way's colour is a marked display choice with a measured cause.** The band is
  near-grey on screen because chroma dies in the pipeline: NASA source 0.194 mean
  saturation, our 8-bit encode 0.168, the shipped webp 0.099 (measured 2026-08-18 — webp
  chroma subsampling at quality 68 costs 41%). `SATURATION` in `milkyway.js` stretches chroma
  about luminance, so it moves no light around the sky and the per-cell luminance fixture is
  untouched by construction. Regenerating the texture at higher quality was measured and
  rejected: q95 recovers the colour but costs 10.7 MB against 2.0.

## Regenerating data

`node scripts/make-terrain.mjs` re-extracts every site's patch from NASA's 530 MB LOLA map
using HTTP range requests (~14 MB per site, ~12 s total). Run it after editing `src/sites.js`.
Note that geotiff.js cannot be used against that host from here — it opens parallel sockets
that hit an unreachable IPv6 route, which is why the script parses the TIFF itself over curl.

`node scripts/make-deepstars.mjs` rebuilds the Tycho-2 deep star layer
(`public/data/deepstars.bin`, stars to V 10) from VizieR TAP (~20 MB, cached in the temp
dir) and rewrites `tests/fixtures/deepstars-meta.json` with the file's SHA-256.

`node --max-old-space-size=8192 scripts/make-milkyway.mjs` rebuilds the sky texture from the
130 MB Deep Star Maps EXR (cached in the temp dir after the first run; ~3 min, most of it
subtracting the 354k drawn stars). Run it **after** make-deepstars: it reads
`deepstars.bin` to know what to subtract. It also rewrites
`tests/fixtures/milkyway-grid.json`, which carries the shipped file's SHA-256 — so
re-encoding the texture without rerunning the script fails the tests, by design. It needs
`cwebp` on the PATH.

## Attribution is a licence obligation

The Earth textures are CC BY 4.0 and the cloud data requires the line "Contains modified
EUMETSAT data". The Milky Way map is NASA/Goddard SVS with Gaia DR2 from ESA/Gaia/DPAC. The
deep star layer is the Tycho-2 catalogue (Høg et al. 2000, ESA Hipparcos mission).
Credits must stay reachable in the shipped UI, not only in the README.
