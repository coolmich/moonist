// Astronomy core: everything about where things are in the sky as seen from a
// point on the lunar surface. Pure math — no rendering dependencies.
//
// Frames:
//   EQJ    = J2000 mean equator (ICRF), the inertial frame astronomy-engine uses.
//   body   = Moon (or Earth) body-fixed frame per the IAU WGCCRE model,
//            via Astronomy.RotationAxis: v_eqj = Rz(ra+90°)·Rx(90°−dec)·Rz(W)·v_body.
//            For the Moon this is the Mean-Earth/polar-axis frame, matching both
//            JPL Horizons lunar topocentric output and selenographic coordinates.
//   scene  = local horizon frame at the observer: +X East, +Y Up, +Z South.
//            Azimuth: N=0°, E=90° (Horizons convention). Altitude above horizon.

import * as Astronomy from 'astronomy-engine';
import {
  DEG, add, sub, scale, dot, length, normalize, negate,
  mulMV, mulMM, transpose, rotZ, rotX,
} from './vec.js';

const AU_KM = Astronomy.KM_PER_AU;
const MOON_RADIUS_KM = 1737.4;
const EARTH_RADIUS_KM = 6371.0;
const SUN_RADIUS_KM = 695700;
export const SYNODIC_DAYS = 29.530589;

// Equatorial radii, IAU 2015 working group values — the same figure Horizons
// quotes an apparent angular diameter against (for Saturn, the globe, not the
// rings). A planet is not a point: Jupiter runs to 50 arcsec, which is what
// lets it resolve into a disc once the view is zoomed past about a degree.
const PLANET_BODIES = ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
const PLANET_RADIUS_KM = {
  Mercury: 2440.53,
  Venus: 6051.8,
  Mars: 3396.19,
  Jupiter: 71492,
  Saturn: 60268,
};

function wrap360(d) { return ((d % 360) + 360) % 360; }
function wrap180(d) { const w = wrap360(d); return w > 180 ? w - 360 : w; }

function bodyToEqjMatrix(axis) {
  // axis.ra is in sidereal hours; axis.spin (W) in unnormalized degrees.
  return mulMM(rotZ(axis.ra * 15 + 90), mulMM(rotX(90 - axis.dec), rotZ(wrap360(axis.spin))));
}

function latLonToUnit(latDeg, lonDeg) {
  const phi = latDeg * DEG, lam = lonDeg * DEG;
  return [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
}

function unitToLatLon(v) {
  return { lat: Math.asin(v[2]) / DEG, lon: wrap180(Math.atan2(v[1], v[0]) / DEG) };
}

function vecOf(v) { return [v.x, v.y, v.z]; }

/** Fraction of a disc of radius rs hidden by a disc of radius ro, centers sep apart. */
function discOverlapFraction(sep, rs, ro) {
  if (sep >= rs + ro) return 0;
  if (sep <= ro - rs) return 1;
  if (sep <= rs - ro) return (ro * ro) / (rs * rs);
  const a = (sep * sep + rs * rs - ro * ro) / (2 * sep * rs);
  const b = (sep * sep + ro * ro - rs * rs) / (2 * sep * ro);
  const clamp1 = (x) => Math.max(-1, Math.min(1, x));
  const area =
    rs * rs * (Math.acos(clamp1(a)) - clamp1(a) * Math.sqrt(1 - clamp1(a) ** 2)) +
    ro * ro * (Math.acos(clamp1(b)) - clamp1(b) * Math.sqrt(1 - clamp1(b) ** 2));
  return area / (Math.PI * rs * rs);
}

/**
 * The next sunrise or sunset at a site, found by searching the real Sun
 * altitude rather than assuming the Sun crosses the horizon at local 06:00 —
 * which is close to true near the equator but drifts at high latitude, and
 * can be a whole lunar cycle out near the poles.
 * Returns { kind: 'sunrise' | 'sunset', date, days } or null if none found.
 */
export function nextSunEvent(date, site, maxDays = 32) {
  const t0 = date.getTime();
  const step = 0.2 * 86400000;
  let prevT = t0;
  let prevUp = skyState(date, site).sun.alt > 0;
  for (let t = t0 + step; t <= t0 + maxDays * 86400000; t += step) {
    const up = skyState(new Date(t), site).sun.alt > 0;
    if (up !== prevUp) {
      let lo = prevT, hi = t;
      for (let i = 0; i < 26; i++) {
        const mid = (lo + hi) / 2;
        if ((skyState(new Date(mid), site).sun.alt > 0) === prevUp) lo = mid;
        else hi = mid;
      }
      const when = new Date((lo + hi) / 2);
      return {
        kind: up ? 'sunrise' : 'sunset',
        date: when,
        days: (when.getTime() - t0) / 86400000,
      };
    }
    prevUp = up;
    prevT = t;
  }
  return null;
}

/**
 * Compute the full sky state for a UTC date and a selenographic site
 * {lat, lon} (degrees, east-positive, Mean-Earth frame).
 */
export function skyState(date, site) {
  const time = Astronomy.MakeTime(date);

  // --- Moon orientation and observer position -----------------------------
  const moonM = bodyToEqjMatrix(Astronomy.RotationAxis(Astronomy.Body.Moon, time));
  const moonPosKm = scale(vecOf(Astronomy.GeoVector(Astronomy.Body.Moon, time, false)), AU_KM);
  const upBody = latLonToUnit(site.lat, site.lon);
  const obsEqjKm = add(moonPosKm, mulMV(moonM, scale(upBody, MOON_RADIUS_KM)));

  // --- Local horizon basis (in EQJ) ----------------------------------------
  const phi = site.lat * DEG, lam = site.lon * DEG;
  const up = mulMV(moonM, upBody);
  const east = mulMV(moonM, [-Math.sin(lam), Math.cos(lam), 0]);
  const north = mulMV(moonM, [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)]);

  function altAzOf(vEqj) {
    const d = normalize(vEqj);
    return {
      alt: Math.asin(Math.max(-1, Math.min(1, dot(d, up)))) / DEG,
      az: wrap360(Math.atan2(dot(d, east), dot(d, north)) / DEG),
    };
  }

  function sceneDirOf(vEqj) {
    const d = normalize(vEqj);
    return [dot(d, east), dot(d, up), -dot(d, north)];
  }

  // Rows of the EQJ→scene rotation.
  const eqjToScene = [east[0], east[1], east[2], up[0], up[1], up[2], -north[0], -north[1], -north[2]];

  // --- Earth ----------------------------------------------------------------
  const earthVec = negate(obsEqjKm); // Earth center sits at the geocentric origin
  const earthDistKm = length(earthVec);
  const sunGeoKm = scale(vecOf(Astronomy.GeoVector(Astronomy.Body.Sun, time, false)), AU_KM);
  // Phase angle at Earth between Sun and observer → illuminated fraction seen by us.
  const earthIllum = (1 + dot(normalize(sunGeoKm), normalize(obsEqjKm))) / 2;

  // Earth body→EQJ: spin by true sidereal time in the equator-of-date frame,
  // then precession+nutation back to J2000. (The IAU cartographic model in
  // RotationAxis(Earth) is ~0.6° off in spin — visible as a wrong sub-lunar
  // meridian in tests, so use the exact path.)
  const gastDeg = Astronomy.SiderealTime(time) * 15;
  const eqdToEqj = Astronomy.Rotation_EQD_EQJ(time);
  const spinZ = rotZ(gastDeg);
  const earthCols = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => {
    const d = mulMV(spinZ, e);
    const v = Astronomy.RotateVector(eqdToEqj, new Astronomy.Vector(d[0], d[1], d[2], time));
    return [v.x, v.y, v.z];
  });
  const earthM = [
    earthCols[0][0], earthCols[1][0], earthCols[2][0],
    earthCols[0][1], earthCols[1][1], earthCols[2][1],
    earthCols[0][2], earthCols[1][2], earthCols[2][2],
  ];
  const subLunar = unitToLatLon(mulMV(transpose(earthM), normalize(moonPosKm)));

  // --- Sun -------------------------------------------------------------------
  const sunVec = sub(sunGeoKm, obsEqjKm);
  const sunDistKm = length(sunVec);

  // --- Selenographic sub-points ----------------------------------------------
  const moonMT = transpose(moonM);
  const subEarth = unitToLatLon(mulMV(moonMT, normalize(negate(moonPosKm))));
  const subSolar = unitToLatLon(mulMV(moonMT, normalize(sub(sunGeoKm, moonPosKm))));

  // Local solar time on the Moon: 12h when the Sun crosses the meridian.
  const solarHourDeg = wrap360(site.lon - subSolar.lon + 180);
  const localSolarHours = solarHourDeg / 15;

  // Solar eclipse seen from the Moon = lunar eclipse seen from Earth: the
  // fraction of the Sun's disc hidden behind the Earth.
  const sunAngR = Math.asin(SUN_RADIUS_KM / sunDistKm);
  const earthAngR = Math.asin(EARTH_RADIUS_KM / earthDistKm);
  const sep = Math.acos(Math.max(-1, Math.min(1, dot(normalize(sunVec), normalize(earthVec)))));
  const eclipseFraction = discOverlapFraction(sep, sunAngR, earthAngR);

  // --- Planets ----------------------------------------------------------------
  const planets = PLANET_BODIES.map((name) => {
    const geo = scale(vecOf(Astronomy.GeoVector(Astronomy.Body[name], time, false)), AU_KM);
    const v = sub(geo, obsEqjKm);
    const distKm = length(v);
    // Phase angle is measured at the planet, between the Sun and this observer.
    // Taking it from the Moon's surface rather than from Earth's centre matters
    // least for Jupiter and most for Venus, which can come within 0.3 AU.
    const toSun = sub(sunVec, v);          // planet → Sun
    const toObs = negate(v);               // planet → observer
    const cosPhase = Math.max(-1, Math.min(1, dot(normalize(toSun), normalize(toObs))));
    // Spin-axis geometry. RotationAxis gives the IAU north pole in EQJ; its
    // dot products with the observer and Sun directions are the planetocentric
    // sub-observer and sub-solar latitudes. For Saturn the sub-observer
    // latitude is the ring opening angle, and matching signs on the pair mean
    // the sunlit face of the rings is the one turned toward us.
    const pole = normalize(vecOf(Astronomy.RotationAxis(Astronomy.Body[name], time).north));
    const sinLat = (d) => Math.max(-1, Math.min(1, dot(pole, normalize(d))));
    return {
      name,
      ...altAzOf(v),
      sceneDir: sceneDirOf(v),
      mag: Astronomy.Illumination(Astronomy.Body[name], time).mag,
      distKm,
      angRadiusDeg: Math.asin(PLANET_RADIUS_KM[name] / distKm) / DEG,
      phaseAngleDeg: Math.acos(cosPhase) / DEG,
      illumFraction: (1 + cosPhase) / 2,
      poleSceneDir: sceneDirOf(pole),
      subObsLatDeg: Math.asin(sinLat(toObs)) / DEG,
      subSunLatDeg: Math.asin(sinLat(toSun)) / DEG,
    };
  });

  return {
    time,
    site,
    sun: {
      ...altAzOf(sunVec),
      sceneDir: sceneDirOf(sunVec),
      distKm: sunDistKm,
      angRadiusDeg: Math.asin(SUN_RADIUS_KM / sunDistKm) / DEG,
    },
    earth: {
      ...altAzOf(earthVec),
      sceneDir: sceneDirOf(earthVec),
      distKm: earthDistKm,
      angRadiusDeg: Math.asin(EARTH_RADIUS_KM / earthDistKm) / DEG,
      illumFraction: earthIllum,
      // Earth body→scene rotation, for orienting the rendered globe.
      sceneMatrix: mulMM(eqjToScene, earthM),
    },
    planets,
    subEarth,
    subSolar,
    subLunar,
    localSolarHours,
    eclipseFraction,
    eqjToScene,
    altAzOf,
    sceneDirOf,
    testVectors: { northEqj: north, eastEqj: east },
  };
}
