# Moonist — project notes

A real-time simulator of the sky seen from the lunar near side. Read `README.md` for what the
product is and `PRD.md` for the requirements and the decision log.

## Non-negotiables

- **The astronomy is checked, not asserted.** Any change to `src/astro/` must keep
  `npm test` green. Those tests compare against JPL Horizons vectors for an observer on the
  lunar surface; if a test fails, the code is wrong, not the fixture. New astronomical
  behaviour needs a new external cross-check (Horizons, Fourmilab, or astronomy-engine's own
  independent search functions), not a self-consistent assertion.
- **Physical correctness beats familiarity.** A black daytime sky, an Earth that never moves,
  a surface that is nearly invisible during lunar night with a dark Earth — these are correct.
  Do not "fix" them.
- **Where display choices override physics, say so in a comment.** The exposure model and the
  constant-brightness sky objects are deliberate camera-like compromises; they are marked.

## Conventions that bite

- **Scene frame**: +X east, +Y up, +Z south. Azimuth is measured from north through east
  (Horizons convention). Altitude is above the horizon.
- **Selenographic coordinates** are Mean-Earth/polar-axis frame, east-positive — the same
  frame LROC coordinates and Horizons' lunar topocentric output use.
- **astronomy-engine gotchas**: `RotationAxis().ra` is in *sidereal hours* (multiply by 15),
  `.spin` is unnormalised degrees, `SiderealTime()` returns hours. `GeoVector`'s third
  argument (aberration) is required.
- **Earth orientation** must come from GMST/GAST + `Rotation_EQD_EQJ`, not from
  `RotationAxis(Body.Earth)` — the IAU cartographic Earth model is ~0.65° off in spin, which
  puts the wrong meridian at the centre of the disc.
- **Equirectangular textures** here have 180°W at the left edge, Greenwich at the centre
  (verified by landmark sampling). `u = lon/2π + 0.5`.
- **LOLA encoding**: `elevation_m = raw_uint16 * 0.5 - 10000`, relative to a 1737.4 km sphere.

## Layout

```
src/astro/     ephemeris core, pure math, no renderer imports (must stay node-testable)
src/scene/     one module per rendered thing; each owns its material and update()
src/ui/        all chrome; talks to the app only through the `view` API in main.js
src/sim/       simulation clock
scripts/       one-off data extraction (terrain patches from NASA LOLA)
tests/         node:test suites; fixtures/horizons.json is ground truth
public/        textures, star catalogs, generated terrain patches
```

`window.moonist` exposes `lookAt/look/state/site/setSite/clock` — the UI uses it, and so do
automated browser checks. Keep it stable.

## Regenerating terrain

`node scripts/make-terrain.mjs` re-extracts every site's patch from NASA's 530 MB LOLA map
using HTTP range requests (~14 MB per site, ~12 s total). Run it after editing `src/sites.js`.
Note that geotiff.js cannot be used against that host from here — it opens parallel sockets
that hit an unreachable IPv6 route, which is why the script parses the TIFF itself over curl.

## Attribution is a licence obligation

The Earth textures are CC BY 4.0 and the cloud data requires the line "Contains modified
EUMETSAT data". Credits must stay reachable in the shipped UI, not only in the README.
