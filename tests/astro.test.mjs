import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as Astronomy from 'astronomy-engine';
import { skyState } from '../src/astro/engine.js';
import { SITES as SITES_ALL } from '../src/sites.js';

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/horizons.json', import.meta.url)), 'utf8'),
);
// Fresh Horizons vectors for the exact coordinates the app ships, so every
// selectable site is guarded — not just two points near two of them.
const siteFixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/horizons-sites.json', import.meta.url)), 'utf8'),
);

function azDiffDeg(a, b) {
  const d = ((a - b) % 360 + 540) % 360 - 180;
  return Math.abs(d);
}

const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

/** Angle between two alt/az directions, in degrees. */
function angularSepDeg(alt1, az1, alt2, az2) {
  const d = Math.PI / 180;
  const c = Math.sin(alt1 * d) * Math.sin(alt2 * d)
    + Math.cos(alt1 * d) * Math.cos(alt2 * d) * Math.cos((az1 - az2) * d);
  return Math.acos(Math.max(-1, Math.min(1, c))) / d;
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

test('every shipped site matches Horizons for the Sun and the Earth', () => {
  let worst = { err: 0 };
  for (const [id, entry] of Object.entries(siteFixture.sites)) {
    const site = SITES_ALL.find((s) => s.id === id);
    assert.ok(site, `fixture site ${id} is no longer shipped`);
    assert.equal(site.lat, entry.lat, `${id} latitude drifted from the fixture`);
    assert.equal(site.lon, entry.lon, `${id} longitude drifted from the fixture`);
    for (const body of ['sun', 'earth']) {
      for (const row of entry[body]) {
        const s = skyState(new Date(`${row.t.replace(/-(\w{3})-/, (m, mo) => `-${MONTHS[mo]}-`)}Z`), site);
        const got = s[body];
        // Great-circle separation between the two directions, so an azimuth
        // error near the zenith cannot hide behind the cosine.
        const err = angularSepDeg(got.alt, got.az, row.el_deg, row.az_deg);
        if (err > worst.err) worst = { err, id, body, t: row.t };
        assert.ok(err < 0.05, `${id} ${body} at ${row.t}: ${err.toFixed(4)}° from Horizons`);
      }
    }
  }
  assert.ok(worst.err < 0.05, `worst ${JSON.stringify(worst)}`);
});

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

test('the local basis is orthonormal, right-handed, and N=0 E=90', () => {
  const s = skyState(new Date(fixture.geocentric.t), { lat: 12, lon: -34 });
  const { northEqj: n, eastEqj: e } = s.testVectors;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const len = (a) => Math.sqrt(dot(a, a));
  // Normality — omitting this once let a scaled basis through unnoticed.
  assert.ok(Math.abs(len(n) - 1) < 1e-12, `|north| = ${len(n)}`);
  assert.ok(Math.abs(len(e) - 1) < 1e-12, `|east| = ${len(e)}`);
  assert.ok(Math.abs(dot(n, e)) < 1e-12, `north·east = ${dot(n, e)}`);
  // Handedness: east × north must point at the zenith, not into the ground.
  const up = [n[1] * e[2] - n[2] * e[1], n[2] * e[0] - n[0] * e[2], n[0] * e[1] - n[1] * e[0]];
  const zenith = s.sceneDirOf(up);
  assert.ok(zenith[1] < -0.999, `east x north points ${JSON.stringify(zenith)}`);
  // And the azimuth convention itself.
  const north = s.altAzOf(n);
  assert.ok(Math.abs(north.alt) < 1e-6 && (north.az < 1e-6 || north.az > 360 - 1e-6), JSON.stringify(north));
  assert.ok(Math.abs(s.altAzOf(e).az - 90) < 1e-6);
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
  // The eclipse ends: totality runs at most ~107 minutes, so six hours out the
  // Sun must be clear of the Earth again.
  const after = skyState(new Date(ecl.peak.date.getTime() + 6 * 3600000), site);
  assert.equal(after.eclipseFraction, 0);
  // ...and partway out it is genuinely partial, not merely "in range".
  let sawPartial = false;
  for (let m = 60; m <= 240; m += 10) {
    const f = skyState(new Date(ecl.peak.date.getTime() + m * 60000), site).eclipseFraction;
    if (f > 0.01 && f < 0.99) sawPartial = true;
  }
  assert.ok(sawPartial, 'never observed a partial phase leaving totality');
});

test('full Moons that are not eclipses stay clear of the Earth', () => {
  // Full Moon is exactly when a lunar eclipse *can* happen, so these are the
  // epochs where a sloppy eclipse test would produce false positives. Most
  // full Moons pass a few degrees above or below the shadow.
  const eclipseTimes = [];
  let ecl = Astronomy.SearchLunarEclipse(new Date('2026-01-01T00:00:00Z'));
  for (let i = 0; i < 8; i++) {
    eclipseTimes.push(ecl.peak.date.getTime());
    ecl = Astronomy.NextLunarEclipse(ecl.peak);
  }
  let checked = 0;
  let t = Astronomy.SearchMoonPhase(180, new Date('2026-01-01T00:00:00Z'), 40);
  for (let i = 0; i < 25; i++) {
    const ms = t.date.getTime();
    const nearEclipse = eclipseTimes.some((e) => Math.abs(e - ms) < 36 * 3600 * 1000);
    if (!nearEclipse) {
      const s = skyState(t.date, SITES.siteA);
      assert.equal(s.eclipseFraction, 0,
        `non-eclipse full Moon ${t.date.toISOString()} reported ${s.eclipseFraction}`);
      // A full Moon from Earth is a new Earth from the Moon — the phase
      // relationship this simulator is built on.
      assert.ok(s.earth.illumFraction < 0.03,
        `Earth is ${(s.earth.illumFraction * 100).toFixed(1)}% lit at full Moon`);
      checked++;
    }
    t = Astronomy.SearchMoonPhase(180, new Date(ms + 20 * 86400000), 40);
  }
  assert.ok(checked >= 12, `only ${checked} non-eclipse full Moons checked`);
});

test('planets present with sane magnitudes', () => {
  const s = skyState(new Date(fixture.geocentric.t), SITES.siteA);
  const names = s.planets.map((p) => p.name);
  for (const n of ['Venus', 'Mars', 'Jupiter', 'Saturn']) assert.ok(names.includes(n), n);
  const venus = s.planets.find((p) => p.name === 'Venus');
  assert.ok(venus.mag < -3 && venus.mag > -5, `venus mag ${venus.mag}`);
});

test('planet discs and phases match JPL Horizons from the lunar surface', () => {
  // A planet is not a point: this is what lets Jupiter resolve into a disc
  // when the view is zoomed in, and what makes Venus a crescent rather than a
  // dot. Ground truth is Horizons' own apparent angular diameter, illuminated
  // fraction and phase angle for an observer standing at Grimaldi.
  const planetFix = JSON.parse(readFileSync(
    fileURLToPath(new URL('./fixtures/horizons-planets.json', import.meta.url)), 'utf8',
  ));
  const site = SITES_ALL.find((s) => s.id === planetFix.site.id);
  assert.ok(site, 'Grimaldi is still a site');
  assert.equal(+site.lat.toFixed(2), planetFix.site.lat);
  assert.equal(+site.lon.toFixed(2), planetFix.site.lon);

  for (const epoch of planetFix.epochs) {
    const s = skyState(new Date(epoch.t), site);
    for (const [name, truth] of Object.entries(epoch.planets)) {
      const p = s.planets.find((x) => x.name === name);
      assert.ok(p, `${name} missing`);
      const angDiam = p.angRadiusDeg * 2 * 3600;
      const relErr = Math.abs(angDiam / truth.angDiamArcsec - 1);
      assert.ok(relErr < 0.002,
        `${name} @ ${epoch.t}: angular diameter ${angDiam.toFixed(3)}" vs Horizons ${truth.angDiamArcsec}" (${(relErr * 100).toFixed(2)}%)`);
      assert.ok(Math.abs(p.phaseAngleDeg - truth.phaseAngleDeg) < 0.05,
        `${name} @ ${epoch.t}: phase angle ${p.phaseAngleDeg.toFixed(3)}° vs ${truth.phaseAngleDeg}°`);
      assert.ok(Math.abs(p.illumFraction * 100 - truth.illumPercent) < 0.1,
        `${name} @ ${epoch.t}: ${(p.illumFraction * 100).toFixed(2)}% lit vs ${truth.illumPercent}%`);
    }
  }
});
