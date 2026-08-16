// Candidate observer sites — all near side, coordinates in the Mean-Earth
// frame (east-positive), LROC/IAU-verified. earthAlt/earthAz are mean values;
// the real Earth wanders ±7-8° around them with libration.

export const SITES = [
  {
    id: 'apollo11',
    name: 'Apollo 11 — Tranquility Base',
    lat: 0.67416,
    lon: 23.47314,
    albedo: 0.085,
    style: 'mare',
    earthAlt: 66,
    blurb: 'The first human landing site. Earth hangs high in the west over a dead-flat dark plain — magnificent desolation.',
  },
  {
    id: 'apollo15',
    name: 'Apollo 15 — Hadley / Apennines',
    lat: 26.13239,
    lon: 3.6333,
    albedo: 0.09,
    style: 'mountain',
    earthAlt: 64,
    blurb: 'A mare bay at the foot of the Apennine front. Mons Hadley (4.5 km) rises to the northeast; Earth stands high in the south.',
  },
  {
    id: 'apollo17',
    name: 'Apollo 17 — Taurus-Littrow',
    lat: 20.1911,
    lon: 30.7723,
    albedo: 0.09,
    style: 'valley',
    earthAlt: 54,
    blurb: 'The last footsteps: a dark valley boxed in by 2-km bright massifs. Earth stands mid-sky to the southwest.',
  },
  {
    id: 'change3',
    name: "Chang'e 3 — Mare Imbrium",
    lat: 44.1214,
    lon: -19.5117,
    albedo: 0.08,
    style: 'mare',
    earthAlt: 43,
    blurb: "China's first lunar landing, on young Imbrium basalt. Earth sits at mid-altitude toward the south-southeast.",
  },
  {
    // On the eastern crater floor: the central peak stands clear to the west
    // and the terraced walls ring the horizon. The crater centre itself is the
    // peak summit — standing there you would be on a mountainside.
    id: 'tycho',
    name: 'Tycho — crater floor',
    lat: -43.3,
    lon: -10.55,
    albedo: 0.18,
    style: 'highland',
    earthAlt: 45,
    blurb: 'Inside the brightest young crater on the Moon: the 2-km central peak stands to the west and terraced walls ring the horizon. Earth hangs to the north-northeast.',
  },
  {
    id: 'grimaldi',
    name: 'Grimaldi — western limb',
    lat: -5.38,
    lon: -68.36,
    albedo: 0.07,
    style: 'mare',
    earthAlt: 21,
    blurb: 'A dark basin floor near the limb. Earth hovers barely 20° above the eastern horizon — the low-Earth showcase.',
  },
];
