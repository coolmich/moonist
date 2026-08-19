import * as THREE from 'three';

// Rocks: the scattered blocks that give the surface its scale.
//
// The ground mesh cannot carry them. It is a polar grid whose cell grows as
// ~0.035 * distance (MESH_CELL), so a 1 m block at 30 m spans about one quad:
// the height-field boulders in terrain-shape.js are sampled away into soft
// lumps long before they can cast a silhouette. Anything that must read AS a
// rock — hard edge against the sky, its own cast shadow, a black side facing
// away from the Sun — has to be real geometry, so it lives here instead.
//
// The observer never translates (only the look direction changes), so the
// whole field is placed once per site and never restreamed.

// Cumulative size-frequency of lunar blocks: N(>R) ~ R^-alpha. Counts from
// LROC NAC imagery put alpha near 2.5-3 across mare and highland sites
// (Bart & Melosh 2010; Li & Wu 2018 agree within that spread); 2.7 sits
// mid-range. The field is built as octave size classes, each with its own
// jittered grid sized to that class's number density -- the same cascade the
// crater field in terrain-shape.js uses, and the reason a metre-scale block
// stays rare without making the small ones vanish.
const ALPHA = 2.7;
// Number of blocks per square metre larger than R_REF. This is the one number
// that sets how rocky a site reads; block counts on mare surfaces span orders
// of magnitude between smooth plains and fresh-ejecta fields, so the `abundance`
// argument exists to make it a per-site dial. No site in sites.js sets
// `rockAbundance` yet, so every site currently runs at this constant; tuning it
// per site needs measured block counts, not taste.
const N_REF = 0.22;
const R_REF = 0.1;            // m, the size the density is quoted for
const CLASSES = 5;            // octave size classes from R_REF up (0.1 .. 1.6 m)
const FIELD_R = 260;          // m, beyond which even a big block is a few pixels

// A block is only worth drawing while it still covers something on screen.
// 0.0015 rad is about 1.5 px at the default 65 degree field, so this drops the
// pebbles that would otherwise pile up near the horizon as aliasing noise
// rather than as ground.
const MIN_ANG = 0.0015;

// Blocks are ejecta, so they crowd around fresh craters: the surface's own
// `rim` weight (already used to brighten fresh rims in the albedo) scales the
// local density, which is why the field clusters instead of dusting evenly.
const RIM_BOOST = 2.6;

const SHAPES = 4;
const SEG = 1;                // icosahedron subdivision: 80 triangles a block

function hash(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * One blocky shape: an icosahedron whose vertices are pushed in and out in
 * angular patches, then squashed. Real blocks are fracture-bounded rather than
 * round, so the displacement is deliberately low-frequency — a couple of large
 * faces per rock, not a noisy potato.
 */
function makeShape(variant) {
  const geom = new THREE.IcosahedronGeometry(1, SEG);
  const pos = geom.attributes.position;
  const v = new THREE.Vector3();
  // Three random cutting planes per shape; a vertex outside one gets pulled in,
  // which reads as a flat fracture face.
  const planes = [];
  for (let i = 0; i < 3; i++) {
    const a = hash(variant, i, 11) * Math.PI * 2;
    const b = (hash(variant, i, 23) - 0.5) * Math.PI;
    planes.push({
      n: new THREE.Vector3(Math.cos(a) * Math.cos(b), Math.sin(b), Math.sin(a) * Math.cos(b)),
      d: 0.62 + 0.26 * hash(variant, i, 37),
    });
  }
  const squash = 0.62 + 0.26 * hash(variant, 0, 51); // blocks sit wider than tall
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.normalize();
    for (const p of planes) {
      const t = v.dot(p.n);
      if (t > p.d) v.addScaledVector(p.n, -(t - p.d) * 0.85);
    }
    v.y *= squash;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geom.computeVertexNormals();
  return geom;
}

/**
 * Scatter a block field over the site.
 * @param {object} surface  from createSurface(): surfaceAt(x, z) -> { y, rim }
 * @param {number} seed     site seed, so a site is reproducible
 * @param {number} abundance site multiplier on block density (1 = default)
 * @param {number} groundAlbedo the site's normal albedo, for the rock's own level
 */
export function createRocks(surface, seed, abundance = 1, groundAlbedo = 0.09) {
  // The ground mesh uses site.albedo * 2.2 as its diffuse level; rock sits
  // about 1.45x its own soil in Apollo pan frames.
  const rock = Math.min(groundAlbedo * 2.2 * 1.45, 1);
  const per = Array.from({ length: SHAPES }, () => []);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const t = new THREE.Vector3();
  const s = new THREE.Vector3();

  for (let c = 0; c < CLASSES; c++) {
    const R = R_REF * Math.pow(2, c);
    // Blocks in this octave: N(>R) - N(>2R) per square metre, from the law.
    const n = N_REF * abundance
      * (Math.pow(R / R_REF, -ALPHA) - Math.pow(2 * R / R_REF, -ALPHA));
    if (n <= 0) continue;
    // One candidate per cell. The grid is sized for the *rim* density, and the
    // keep test below thins it back to the base rate away from fresh rims --
    // a cell can only ever hold one block, so the clustering has to come out
    // of a denser grid rather than a higher per-cell chance.
    const cell = 1 / Math.sqrt(n * RIM_BOOST);
    // Nothing in this class can be seen past here, so do not place it.
    const maxR = Math.min(FIELD_R, 2 * R / MIN_ANG);
    const half = Math.ceil(maxR / cell);
    const sc = seed + c * 7919;
    for (let ix = -half; ix <= half; ix++) {
      for (let iy = -half; iy <= half; iy++) {
        // Jitter inside the cell so the grid never shows through as rows.
        const x = (ix + hash(ix, iy, sc + 1)) * cell;
        const z = (iy + hash(ix, iy, sc + 2)) * cell;
        const dist = Math.hypot(x, z);
        if (dist > maxR || dist < 1.2) continue;  // keep the eye's own spot clear

        const surf = surface.surfaceAt(x, z);
        // Ejecta crowds fresh rims; elsewhere the class thins to its base rate.
        const keep = (1 + (RIM_BOOST - 1) * Math.min(surf.rim, 1)) / RIM_BOOST;
        if (hash(ix, iy, sc) > keep) continue;

        // Spread within the octave so the class does not read as one size.
        const rad = R * (0.72 + 0.7 * hash(ix, iy, sc + 3));
        // Blocks sit partly buried in the regolith they were thrown onto.
        const bury = 0.22 + 0.3 * hash(ix, iy, sc + 4);
        t.set(x, surf.y - rad * bury, z);
        e.set(
          (hash(ix, iy, sc + 5) - 0.5) * 0.7,
          hash(ix, iy, sc + 6) * Math.PI * 2,
          (hash(ix, iy, sc + 7) - 0.5) * 0.7,
        );
        q.setFromEuler(e);
        s.set(
          rad * (0.85 + 0.3 * hash(ix, iy, sc + 8)),
          rad,
          rad * (0.85 + 0.3 * hash(ix, iy, sc + 9)),
        );
        m.compose(t, q, s);
        const variant = Math.floor(hash(ix, iy, sc + 10) * SHAPES) % SHAPES;
        per[variant].push(m.clone());
      }
    }
  }

  const group = new THREE.Group();
  const geoms = [];
  const mats = [];
  for (let v = 0; v < SHAPES; v++) {
    const list = per[v];
    if (!list.length) continue;
    const geom = makeShape(v);
    // Blocks are brighter than the mature regolith around them: soil darkens
    // as space weathering builds up rims of agglutinate glass, so exposed rock
    // reads a step lighter in every Apollo surface frame. Quoted relative to
    // the ground's own albedo so it tracks a dark mare and a bright highland
    // site alike.
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(rock, rock * 0.985, rock * 0.96),
      roughness: 1.0,
      metalness: 0.0,
      flatShading: true,
    });
    const inst = new THREE.InstancedMesh(geom, mat, list.length);
    for (let i = 0; i < list.length; i++) inst.setMatrixAt(i, list[i]);
    inst.instanceMatrix.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    // The field is baked around the observer and never moves, so three.js can
    // skip the per-frame bounds test that would otherwise cull it wrongly at
    // narrow FOV.
    inst.frustumCulled = false;
    group.add(inst);
    geoms.push(geom);
    mats.push(mat);
  }

  return {
    group,
    count: per.reduce((n, l) => n + l.length, 0),
    dispose() {
      for (const g of geoms) g.dispose();
      for (const mm of mats) mm.dispose();
    },
  };
}
