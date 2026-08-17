# Moonist

Stand on the near side of the Moon and look up.

Moonist is a real-time simulator of the lunar sky as seen from the ground. The Earth hangs
nearly motionless overhead showing the face it is actually turning toward the Moon right
now, with live cloud cover and a real day/night terminator. The Sun crawls across the sky
over the true 29.5-day synodic cycle. Five thousand real stars, the constellations and the
Milky Way sit behind it all, and the ground underfoot is built from NASA's laser altimetry of
the actual landing sites.

```
npm install
npm run dev      # http://localhost:5173
npm test         # astronomy + terrain assertions
npm run build
```

## What you are looking at

**The Earth barely moves.** The Moon keeps one face toward the Earth, so from any near-side
site the Earth stays at a fixed spot in the sky forever — it never rises and never sets. It
only sways a few degrees a month as libration rocks the Moon back and forth. How high it
hangs tells you where you are: overhead near the centre of the near side, down near the
horizon out by the limb.

**A lunar day is a month long.** Sunrise to sunset is about 14.8 Earth days, and the whole
cycle takes 29.53. The readout gives you the local solar clock and how many Earth days you
are from the next sunrise, because "06:00" means something very different here.

**The stars never go out.** There is no atmosphere to scatter sunlight, so nothing here can
dim a star: at lunar noon the sky holds exactly what it holds at midnight, the Milky Way
included, hanging over a brightly sunlit landscape. The Apollo photographs show empty black
skies because their exposure was set for the regolith — which is 24 stops brighter than the
Milky Way — and no camera or screen has that range. Rather than pick one end, this shows both
and dims the sky slightly while the Sun is up. At night the exposure opens up and the ground
appears again, lit blue-grey by earthshine.

**Earth's phase is the Moon's phase, inverted.** When Earth sees a new Moon, the Moon sees a
full Earth. When the Earth passes directly between the Sun and the Moon — a lunar eclipse for
anyone at home — the Sun goes out here, and the simulator models that too. And when the Moon
passes between the Sun and the Earth — a solar eclipse at home — the near side watches its
own shadow drift across the Earth: a broad dusky penumbra around a tiny dark core, the same
smudge DSCOVR photographs from L1.

## Sites

Six near-side sites, all with coordinates in the Mean-Earth/polar-axis frame:

| Site | Lat, Lon | Earth sits at | Terrain |
|---|---|---|---|
| Apollo 11 — Tranquility Base | 0.67°N, 23.47°E | ~66° up | flat dark mare |
| Apollo 15 — Hadley/Apennines | 26.13°N, 3.63°E | ~64° up | 4.5 km massifs on the skyline |
| Apollo 17 — Taurus-Littrow | 20.19°N, 30.77°E | ~54° up | valley walled by 2 km massifs |
| Chang'e 3 — Mare Imbrium | 44.12°N, 19.51°W | ~43° up | young flat basalt |
| Tycho — crater floor | 43.30°S, 10.55°W | ~45° up | bright highlands, terraced walls |
| Grimaldi — western limb | 5.38°S, 68.36°W | ~21° up | dark basin floor, Earth low |

Grimaldi is the default because it is the one place where the ground, the horizon and the
Earth all fit in a single frame.

## Controls

Drag to look around, wheel to zoom (0.2°–100° field of view — far enough in for Venus to
show its crescent, Jupiter its belts, and Saturn its rings, tilted as they really are on
today's date). The bottom dock holds the site
picker, time-lapse speeds and a date jump. The layers panel (top right) holds the sky
toggles and the `EARTH ×1–×10` slider, which magnifies the Earth's image alone — its face,
phase and light stay real, and everything it is drawn over gets covered exactly as a
magnifier's image would cover it. Keys: `1`–`5` speed, `0` back to now, `M` Milky Way,
`C` constellations, `N` star names, `E` snap to the Earth.

## How it is built

- **Ephemeris** — [astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT). Lunar
  orientation comes from its IAU/WGCCRE rotation model, giving the Mean-Earth frame that
  selenographic coordinates and JPL Horizons both use. Earth's orientation is built from
  Greenwich apparent sidereal time and the EQD→EQJ rotation rather than the IAU cartographic
  model, whose spin term is ~0.65° off.
- **Frames** — the scene is a local horizon frame: +X east, +Y up, +Z south, azimuth measured
  from north through east, matching Horizons' convention.
- **Terrain** — per-site patches sampled from NASA's CGI Moon Kit LOLA map at 64 pixels per
  degree (~475 m), pulled with HTTP range requests by `scripts/make-terrain.mjs`. Real relief
  gives the skyline; a self-similar crater cascade, boulders and regolith noise supply
  everything below LOLA's resolution. The surface uses a backscattering approximation so it
  brightens toward the anti-solar point the way real regolith does.
- **Earth** — a shader sphere textured from body-frame direction, so its orientation is driven
  straight from the ephemeris. Clouds are fetched live and refreshed every three hours, with a
  bundled fallback if the network is unavailable. The dock's magnifier scales only this mesh;
  earthshine, eclipse dimming and the readout all keep the Earth's true angular size.
- **Stars** — 5,044 stars to magnitude 6 with B−V colour, drawn with a magnitude-driven size
  law and diffraction spikes above first magnitude, plus a deep layer of 349,405 Tycho-2
  stars to magnitude 10 that zooming in lifts out of the background — magnification implies
  aperture, and aperture brightens point sources while extended glow keeps constant surface
  brightness. A star is a sharp point at every zoom; only the glow between them is texture.
  Labels live in a screen-space canvas layer with priority-based collision resolution, so
  they never overlap, never get clipped at the frame edge, and never float in front of a
  mountain.
- **Planets** — the five naked-eye planets carry their true angular sizes, phases and spin
  axes from the ephemeris: zoom in and Venus is a crescent, Jupiter shows its belts, and
  Saturn its rings at the real opening angle for the date, checked against JPL Horizons.
  Wide out they are the capped brilliant points a camera would record.
- **The Milky Way** — everything fainter than the stars drawn as points, which is what the
  band actually is. The map is NASA's Deep Star Maps 2020: not a photograph and not a mosaic,
  but a render of 1.7 billion catalogued stars from Hipparcos-2, Tycho-2 and Gaia DR2, so the
  star clouds and the dust lanes are where the catalogue puts them rather than where an
  artist did. `scripts/make-milkyway.mjs` resamples it into the sky convention used here,
  subtracts every star the app draws itself — the 5,044 and the deep layer both — so nothing
  appears twice, and keeps its linear radiometry, so it rides the same exposure curve as the
  stars: washed out at lunar noon, vivid through the two-week night. Under magnification the
  shader never shows a texel wider than a few pixels — past its 2.6-arcmin resolution the
  texture yields to the smooth glow it honestly is, and the sharp stars on top come from the
  catalogues.

## Verification

The astronomy is not trusted, it is checked. `npm test` asserts against JPL Horizons vectors
computed for an observer standing on the lunar surface (`CENTER='coord@301'`): Sun and Earth
altitude/azimuth from two sites at three epochs agree to better than 0.15°, and the
selenographic sub-Earth and sub-solar points to better than 0.1°. Eclipse geometry is checked
against astronomy-engine's independent eclipse searches — the Sun's disappearance behind the
Earth against the lunar-eclipse search, and the Moon's shadow on the Earth against the global
and local solar-eclipse searches, umbra ground point and city-by-city obscuration alike. The terrain tests assert that the
extracted patches really do contain Mons Hadley, the Taurus-Littrow massifs and Tycho's walls
at the right bearings and heights, which is what catches a flipped or transposed elevation
patch. The rendered face of the Earth has been cross-checked against Fourmilab's independent
Earth-from-Moon calculation and agrees to 0.003°.

## Credits and licences

- Ephemeris: **astronomy-engine** by Don Cross — MIT.
- Validation data: **JPL Horizons** (NASA/JPL-Caltech) and **Fourmilab Earth and Moon Viewer**.
- Lunar topography and colour: **NASA's Scientific Visualization Studio**, CGI Moon Kit
  (LRO LOLA and LROC teams; visualiser Ernie Wright).
- Earth day/night/specular maps: **Solar System Scope** — CC BY 4.0, derived from NASA imagery.
- Live cloud cover: **Contains modified EUMETSAT data**, composited by Matt Eason's Live Cloud
  Maps (CC0).
- Star and constellation data: **d3-celestial** by Olaf Frohn — BSD 3-Clause, built on the XHIP
  extended Hipparcos compilation.
- Deep star layer: **Tycho-2 catalogue** (Høg et al. 2000, ESA Hipparcos mission), via CDS
  VizieR (I/259).
- Milky Way: **Deep Star Maps 2020**, NASA/Goddard Space Flight Center Scientific Visualization
  Studio (Ernie Wright). Gaia DR2: **ESA/Gaia/DPAC**.
