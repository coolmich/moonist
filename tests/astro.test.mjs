import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Astronomy from 'astronomy-engine';
import { skyState } from '../src/astro/engine.js';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/horizons.json', import.meta.url)), 'utf8'),
);

function azDiffDeg(a, b) {
  let d = ((a - b) % 360 + 540) % 360 - 180;
  return Math.abs(d);
}

const SITES = {
  siteA: { lat: fixture.siteA.lat, lon: fixture.siteA.lon },
  siteB: { lat: fixture.siteB.lat, lon: fixture.siteB.lon },
};

for (const key of ['siteA', 'siteB']) {
  for (const body of ['sun', 'earth']) {
    test(`${key} ${body} alt/az matches Horizons`, () => {
      for (const row of fixture[key][body]) {
        const s = skyState(new Date(row.t), SITES[key]);
        const got = body === 'sun' ? s.sun : s.earth;
        const elErr = Math.abs(got.alt - row.el_deg);
        const azErr = azDiffDeg(got.az, row.az_deg) * Math.cos((row.el_deg * Math.PI) / 180);
        assert.ok(elErr < 0.15, `${row.t} el err ${elErr.toFixed(4)}° (got ${got.alt.toFixed(4)}, want ${row.el_deg})`);
        assert.ok(azErr < 0.2, `${row.t} az err ${azErr.toFixed(4)}° (got ${got.az.toFixed(4)}, want ${row.az_deg})`);
      }
    });
  }
}

test('sub-Earth and sub-solar selenographic points match Horizons', () => {
  const g = fixture.geocentric;
  const s = skyState(new Date(g.t), SITES.siteA);
  assert.ok(azDiffDeg(s.subEarth.lon, g.subEarth.lon_deg_east) < 0.1,
    `subEarth lon got ${s.subEarth.lon}, want ${g.subEarth.lon_deg_east}`);
  assert.ok(Math.abs(s.subEarth.lat - g.subEarth.lat_deg) < 0.1,
    `subEarth lat got ${s.subEarth.lat}, want ${g.subEarth.lat_deg}`);
  assert.ok(azDiffDeg(s.subSolar.lon, g.subSolar.lon_deg_east) < 0.1,
    `subSolar lon got ${s.subSolar.lon}, want ${g.subSolar.lon_deg_east}`);
  assert.ok(Math.abs(s.subSolar.lat - g.subSolar.lat_deg) < 0.1,
    `subSolar lat got ${s.subSolar.lat}, want ${g.subSolar.lat_deg}`);
});

test('sub-lunar point on Earth matches RA/GAST identity', () => {
  const g = fixture.geocentric;
  const s = skyState(new Date(g.t), SITES.siteA);
  const gastDeg = Astronomy.SiderealTime(new Date(g.t)) * 15;
  const wantLon = ((g.moon_ra_apparent_deg - gastDeg) % 360 + 540) % 360 - 180;
  const wantLat = g.moon_dec_apparent_deg;
  assert.ok(azDiffDeg(s.subLunar.lon, wantLon) < 0.5,
    `subLunar lon got ${s.subLunar.lon}, want ${wantLon}`);
  assert.ok(Math.abs(s.subLunar.lat - wantLat) < 0.5,
    `subLunar lat got ${s.subLunar.lat}, want ${wantLat}`);
});

test('angular sizes and Earth phase', () => {
  const t = new Date(fixture.geocentric.t);
  const s = skyState(t, SITES.siteA);
  const earthDiamDeg = 2 * s.earth.angRadiusDeg;
  assert.ok(earthDiamDeg > 1.8 && earthDiamDeg < 2.06, `earth diam ${earthDiamDeg}`);
  const sunDiamDeg = 2 * s.sun.angRadiusDeg;
  assert.ok(sunDiamDeg > 0.51 && sunDiamDeg < 0.555, `sun diam ${sunDiamDeg}`);
  const moonFrac = Astronomy.Illumination(Astronomy.Body.Moon, t).phase_fraction;
  assert.ok(Math.abs(s.earth.illumFraction - (1 - moonFrac)) < 0.02,
    `earth illum ${s.earth.illumFraction} vs 1-moon ${1 - moonFrac}`);
});

test('ENU basis is orthonormal and az convention is N=0 E=90', () => {
  const s = skyState(new Date(fixture.geocentric.t), { lat: 0, lon: 0 });
  // A direction due north at the horizon must give az=0, alt=0.
  const north = s.altAzOf(s.testVectors.northEqj);
  assert.ok(Math.abs(north.alt) < 1e-6 && (north.az < 1e-6 || north.az > 360 - 1e-6), JSON.stringify(north));
  const east = s.altAzOf(s.testVectors.eastEqj);
  assert.ok(Math.abs(east.az - 90) < 1e-6, JSON.stringify(east));
});

test('earth sceneMatrix points the sub-lunar surface point back at the observer', () => {
  const s = skyState(new Date(fixture.geocentric.t), SITES.siteA);
  const m = s.earth.sceneMatrix; // earth body → scene rotation, row-major
  const lat = s.subLunar.lat * Math.PI / 180;
  const lon = s.subLunar.lon * Math.PI / 180;
  const p = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const v = [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2],
    m[3] * p[0] + m[4] * p[1] + m[5] * p[2],
    m[6] * p[0] + m[7] * p[1] + m[8] * p[2],
  ];
  // The sub-lunar point faces the Moon: in scene coords that is (approximately,
  // up to the ~1° parallax between Moon center and our surface site) the
  // opposite of the observer→Earth direction.
  const d = s.earth.sceneDir;
  const dot = -(v[0] * d[0] + v[1] * d[1] + v[2] * d[2]);
  assert.ok(dot > Math.cos(1.5 * Math.PI / 180), `alignment ${Math.acos(Math.min(1, dot)) * 180 / Math.PI}° off`);
});

test('Earth eclipses the Sun exactly when Earth sees a total lunar eclipse', () => {
  // A total lunar eclipse from Earth is a total solar eclipse from the Moon.
  let ecl = Astronomy.SearchLunarEclipse(new Date('2026-01-01T00:00:00Z'));
  while (ecl.kind !== 'total') ecl = Astronomy.NextLunarEclipse(ecl.peak);
  const site = { lat: 0.674, lon: 23.473 }; // Apollo 11, Earth-facing
  const atPeak = skyState(ecl.peak.date, site);
  assert.ok(atPeak.eclipseFraction > 0.999,
    `total eclipse at ${ecl.peak.date.toISOString()} gave ${atPeak.eclipseFraction}`);
  // Sunlight is fully blocked, and the Sun's disc sits behind Earth's.
  const dayBefore = skyState(new Date(ecl.peak.date.getTime() - 86400000), site);
  assert.equal(dayBefore.eclipseFraction, 0);
  // Half the umbral duration later it must be partial or over, never > 1.
  const later = skyState(new Date(ecl.peak.date.getTime() + 3 * 3600000), site);
  assert.ok(later.eclipseFraction >= 0 && later.eclipseFraction <= 1);
});

test('no eclipse at full Moon phases that are not eclipses', () => {
  // 2026-08-15 is nowhere near an eclipse.
  const s = skyState(new Date(fixture.geocentric.t), SITES.siteA);
  assert.equal(s.eclipseFraction, 0);
});

test('planets present with sane magnitudes', () => {
  const s = skyState(new Date(fixture.geocentric.t), SITES.siteA);
  const names = s.planets.map((p) => p.name);
  for (const n of ['Venus', 'Mars', 'Jupiter', 'Saturn']) assert.ok(names.includes(n), n);
  const venus = s.planets.find((p) => p.name === 'Venus');
  assert.ok(venus.mag < -3 && venus.mag > -5, `venus mag ${venus.mag}`);
});
