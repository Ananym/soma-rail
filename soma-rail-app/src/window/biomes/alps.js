// "Alps": a Swiss alpine valley in high summer, seen from a train running along the valley floor.
//
// The line runs on a terrace along one side of the valley, six to eight metres above its floor (level
// ground seen from its own height is a sliver; from up here the meadows, the river and the road lie
// open). Below the window the bank falls away to the valley floor: hay meadows and pastures thick with wildflowers in drifts that
// change along the journey (gentian, alpenrose, buttercup, arnica, daisies, bellflower, clover,
// poppies, fireweed, monkshood, cow parsley ...), a milky-turquoise glacial river that meanders
// across the floor between gravel bars, and a road that winds with it. Beyond the river the floor
// rises to the foot of the valley side: flowery slope meadows with chalets and hay barns, dark
// spruce and paler larch forest thinning to alpine pasture, in some stretches a band of cliffs
// with waterfalls dropping to the valley, and above it all a wall of big rock-and-snow peaks:
// banded rock faces, snowfields, couloirs, and now and then a glacier tongue in a side valley.
// Chalets of dark timber on stone bases with wide low roofs weighted with stones and flower boxes
// at the windows, a village round a white church, farms with a fountain trough, a branch road
// climbing the slope in hairpins, a post bus, a tractor, cyclists, hikers, a farmer with a scythe,
// hay on racks, a cable car, a small halt. Cows with bells, goats, ibex and chamois on rocks,
// marmots standing up near the line, red deer at the forest edge, an eagle, choughs.
//
// Structure (as winter.js and tropics.js): one pure layout of WORLD x and distance, hashed from the
// world seed and cached per world. The valley's shape is this file's own height function
// (heightAt): everything that depends on x alone (the river's course and width, the road, the level
// of the floor, where the valley side begins, the cliff stretches) is tabulated per metre of world x
// in blocks (xAt); the valley side and the peaks are tabulated in tiles (makeTable) and the river's
// bed and the cliff step are added exactly on top. Every band stands on it through local(ctx), so
// nothing jumps at a chunk seam or a band border. Only the ground fill and the small flowers use
// the chunk's own rng: where they grow, and what kind, comes from world position (patchAt).
//
// The valley side is shaped by its ELEVATION ANGLE from the window (height = distance x a tangent
// that grows with distance), so it is concave like an amphitheatre and every part of it shows: the
// lower slopes never hide the peaks. The ground fill spends its splats by how much of the window
// each part fills (as himalaya.js), so a slope or a cliff facing the line gets most of them.
//
// Flowers are drawn in two layers. The carpet: every ground splat on a meadow is either grass or a
// flower colour, by the patch it lies in, so the colour fields reach out to the slopes (out to a few
// hundred metres only a tint: there the plants carry the colour). The meadow in 3D (meadow()):
// out to 135 m plants stand one by one on their stems among tufts of grass, in the forms of their
// kind (rays round an eye, cups, bells, spires of florets, umbels on rays, thistles, trumpets,
// clover heads, cushions, alpenrose domes), in full by the line and simpler further out, larger
// than life so they read from a moving train; beyond, and up the slope meadows of the mid band,
// drifts: a tussock with heads of its patch's flowers on top, so the middle distance has relief.
// Uncut strips along field borders, the river bank and the road's verges flower richer and taller.
// The plants keep clear of the cattle, the goats, the marmots and the haymakers (clearings).
//
// The beat: buildings and lights (beatKinds); vehicles and the cable car's cabins are rigid and tag their
// own splats with MOVE.STILL (they do nothing on the beat); animals and people with MOVE.FLASH (they brighten, never
// swell). The flower heads answer in colour groups (kit.js chorus(): one group per colour, a few
// groups each beat, see CHORUS_OF). The mountains, the forest, stems and grass stay still. Flags
// and washing flutter (MOVE.FLAG), spray and chimney smoke billow (MOVE.VAPOUR), the eagle and the
// choughs fly (MOVE.FLY).
//
// Surreal dials (all 0 at level 0, so level 0 shows none of this):
//   scale     flowers the size of trees standing in the meadows
//   topology  meadows floating clear of the valley with cows grazing on them; a waterfall that
//             leaves the river and falls upward into a cloud (a river running uphill to it was not
//             drawn: karst.js found that water lifted off the ground reads as a grey slab)
//   logic     the same chalet repeating up the slope, each copy a little more wrong
import { hashInts, hashString, makeRng, noise1, noise2, fbm2 } from '../rng.js';
import { makeTerrain } from '../terrain.js';
import {
  KIND, MOVE, makeOut, worldSeed, worldRng, cellsAround, detail, shade, jitter, mul3, mix3, smooth,
  clamp, lerp, quatYaw, quatRoll, quatMul, quatXTo, rotY, SUN,
  overheadLine, flightCell, flyBody, flyWing, Q_ID, broadleaf, floatingIsland, chorus,
  facetRock,
} from './kit.js';

const PAL = {
  ground: [0.3, 0.46, 0.18],      // meadow green: also the backdrop below the horizon
  foliage: [0.09, 0.19, 0.1],
  rock: [0.5, 0.49, 0.46],
  ballast: [0.4, 0.38, 0.36],
};

// Colours. Natural surfaces stay <= 0.8 per channel.
const C = {
  ballast: [0.4, 0.38, 0.36],
  cess: [0.44, 0.4, 0.33],
  grass: [0.3, 0.5, 0.15],
  grassLush: [0.22, 0.46, 0.13],
  grassPale: [0.44, 0.56, 0.2],
  grassDry: [0.52, 0.55, 0.26],
  pasture: [0.33, 0.5, 0.17],
  mown: [0.58, 0.62, 0.3],
  mownDark: [0.44, 0.54, 0.22],
  hay: [0.7, 0.62, 0.34],
  turf: [0.4, 0.46, 0.2],
  turfHigh: [0.46, 0.44, 0.24],
  earth: [0.36, 0.28, 0.2],
  river: [0.42, 0.7, 0.68],       // glacial milk: turquoise
  riverPale: [0.6, 0.78, 0.74],
  riverDeep: [0.26, 0.56, 0.6],
  foam: [0.8, 0.8, 0.79],
  gravel: [0.66, 0.65, 0.61],
  gravelDark: [0.5, 0.5, 0.48],
  road: [0.4, 0.4, 0.41],
  roadEdge: [0.62, 0.61, 0.57],
  path: [0.62, 0.55, 0.42],
  spruce: [0.06, 0.15, 0.09],
  spruceTip: [0.12, 0.25, 0.12],
  larch: [0.14, 0.26, 0.1],
  larchTip: [0.26, 0.4, 0.14],
  mass: [0.04, 0.09, 0.06],
  floor: [0.1, 0.17, 0.08],
  bark: [0.24, 0.18, 0.13],
  leaf: [0.18, 0.36, 0.12],
  rock: [0.56, 0.54, 0.5],        // pale limestone
  rockDark: [0.32, 0.31, 0.31],
  rockWarm: [0.52, 0.44, 0.35],
  scree: [0.55, 0.54, 0.51],
  snowLit: [0.8, 0.8, 0.79],
  snowMid: [0.7, 0.73, 0.77],
  snowShade: [0.5, 0.57, 0.7],
  snowDeep: [0.36, 0.43, 0.58],
  ice: [0.6, 0.72, 0.78],
  iceBlue: [0.36, 0.56, 0.68],
  moraine: [0.44, 0.43, 0.41],
  timber: [0.3, 0.19, 0.11],      // sun-darkened larch boards
  timberDark: [0.2, 0.13, 0.08],
  timberNew: [0.5, 0.36, 0.2],
  plaster: [0.76, 0.74, 0.68],
  stone: [0.52, 0.5, 0.46],
  shingle: [0.3, 0.27, 0.25],
  skin: [0.72, 0.52, 0.4],
};
const LIT = [1.0, 0.76, 0.42];       // a lit window (a light: >= 0.97, ignores the tint)
const LAMP = [1.0, 0.84, 0.56];

// The shape numbers are unused: the valley comes from heightAt() through local().
const TERRAIN = { cutting: 1.0 };
const CAMY = 2.6;

// ---------------------------------------------------------------------------------------------
// The flowers. c = colour of the head, eye = its centre, form: 'disc' (a flat head on a stem),
// 'bell' (nodding bells down the top of the stem), 'spike' (a tall spire of bloom), 'umbel' (a wide
// flat plate), 'cushion' (low, in mats), 'bush' (alpenrose: a low dark bush covered in bloom),
// 'tuft' (cotton grass). h = height of the plant in metres, r = radius of a head; both are drawn
// larger than life (see meadow()).
// ---------------------------------------------------------------------------------------------
const FL = [
  /* 0 */ { name: 'buttercup', c: [0.8, 0.7, 0.06], eye: [0.62, 0.5, 0.05], form: 'disc', h: 0.5, r: 0.095 },
  /* 1 */ { name: 'arnica', c: [0.8, 0.54, 0.05], eye: [0.56, 0.3, 0.05], form: 'daisy', n: 7, h: 0.55, r: 0.12 },
  /* 2 */ { name: 'ox-eye daisy', c: [0.8, 0.8, 0.77], eye: [0.8, 0.62, 0.06], form: 'daisy', n: 9, h: 0.65, r: 0.13 },
  /* 3 */ { name: 'gentian', c: [0.08, 0.14, 0.72], eye: [0.36, 0.5, 0.8], form: 'trumpet', h: 0.25, r: 0.12 },
  /* 4 */ { name: 'bellflower', c: [0.44, 0.3, 0.78], form: 'bell', h: 0.7, r: 0.09 },
  /* 5 */ { name: 'red clover', c: [0.72, 0.26, 0.46], form: 'clover', h: 0.28, r: 0.11 },
  /* 6 */ { name: 'poppy', c: [0.8, 0.1, 0.05], eye: [0.08, 0.06, 0.08], form: 'poppy', h: 0.7, r: 0.14 },
  /* 7 */ { name: 'alpenrose', c: [0.78, 0.16, 0.34], form: 'bush', h: 0.7, r: 0.34 },
  /* 8 */ { name: 'fireweed', c: [0.76, 0.24, 0.58], form: 'spike', h: 1.5, r: 0.1 },
  /* 9 */ { name: 'monkshood', c: [0.2, 0.14, 0.62], form: 'spike', h: 1.35, r: 0.09 },
  /* 10 */ { name: 'cow parsley', c: [0.8, 0.8, 0.74], form: 'umbel', h: 1.15, r: 0.2 },
  /* 11 */ { name: 'yellow gentian', c: [0.8, 0.68, 0.1], form: 'spike', sub: 'whorl', h: 1.3, r: 0.1 },
  /* 12 */ { name: 'edelweiss', c: [0.78, 0.78, 0.7], eye: [0.7, 0.66, 0.3], form: 'cushion', h: 0.2, r: 0.1 },
  /* 13 */ { name: 'forget-me-not', c: [0.36, 0.58, 0.8], eye: [0.8, 0.74, 0.3], form: 'cushion', h: 0.28, r: 0.08 },
  /* 14 */ { name: 'meadow sage', c: [0.3, 0.2, 0.7], form: 'spike', h: 0.75, r: 0.085 },
  /* 15 */ { name: 'red campion', c: [0.8, 0.2, 0.44], eye: [0.6, 0.12, 0.3], form: 'disc', h: 0.7, r: 0.09 },
  /* 16 */ { name: 'globeflower', c: [0.8, 0.74, 0.16], form: 'globe', h: 0.6, r: 0.11 },
  /* 17 */ { name: 'cotton grass', c: [0.8, 0.8, 0.78], form: 'tuft', h: 0.5, r: 0.08 },
  /* 18 */ { name: 'bistort', c: [0.8, 0.5, 0.62], form: 'spike', h: 0.8, r: 0.06 },
  /* 19 */ { name: 'orange hawkweed', c: [0.8, 0.34, 0.05], eye: [0.6, 0.2, 0.04], form: 'disc', h: 0.45, r: 0.08 },
  /* 20 */ { name: 'orchid', c: [0.66, 0.3, 0.64], form: 'spike', sub: 'orchid', h: 0.65, r: 0.075 },
  /* 21 */ { name: 'thistle', c: [0.58, 0.2, 0.58], form: 'thistle', h: 1.1, r: 0.11 },
  /* 22 */ { name: 'lupin', c: [0.34, 0.3, 0.76], form: 'spike', sub: 'band', h: 1.05, r: 0.1 },
  /* 23 */ { name: 'scabious', c: [0.6, 0.54, 0.8], eye: [0.5, 0.44, 0.72], form: 'disc', h: 0.6, r: 0.1 },
];
// The beat: each colour of flower is one chorus group (kit.js chorus()), and on each beat a few of
// the eight answer together, every head of that colour across the meadow:
//   0 white (daisy, edelweiss, cotton grass)   1 yellow and orange (buttercup, arnica, globeflower,
//   yellow gentian, hawkweed)   2 sky and bell blue (gentian, forget-me-not, bellflower)   3 red
//   (poppy, red clover, campion)   4 pink (alpenrose, fireweed, bistort)   5 purple (orchid, thistle,
//   scabious, sage)   6 blue-violet spikes (monkshood, lupin)   7 white umbels (cow parsley)
const CHORUS_OF = [1, 1, 0, 2, 2, 3, 3, 4, 4, 6, 7, 1, 0, 2, 5, 3, 1, 0, 4, 1, 5, 5, 6, 5];
FL.forEach((f, i) => { f.g = CHORUS_OF[i]; });
// Mixes that grow together: a stretch of the journey takes one, each patch picks from it.
const FMIX = [
  [0, 2, 4, 5, 15, 14, 23],          // the classic hay meadow: yellow, white, violet, pink
  [3, 13, 2, 0, 12, 5, 4],           // blues: gentian and forget-me-not among daisies
  [6, 2, 14, 0, 10, 19, 21],         // poppies, daisies, sage, thistles
  [8, 10, 9, 16, 15, 4, 21],         // tall herbs: fireweed, cow parsley, monkshood, thistle
  [1, 19, 4, 11, 16, 3, 20],         // arnica and hawkweed: oranges and violets, orchids
  [7, 3, 12, 1, 13, 18, 20],         // the alpine turf: alpenrose, gentian, edelweiss
  [18, 17, 16, 13, 22, 9, 2],        // wet meadow by the river: bistort, cotton grass, globeflower, lupin, monkshood
  [15, 5, 18, 2, 4, 6, 20],          // pinks and reds
  [20, 2, 23, 0, 5, 14, 21],         // orchids and scabious among daisies
];
const GRASS_STEM = [0.2, 0.4, 0.12];

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
const SX = SUN[0], SY = SUN[1], SZ = SUN[2];
const STL = MOVE.STILL, FL_ = MOVE.FLASH;   // STL: rigid things (vehicles, cabins), which do nothing on the beat; FL_: people and animals, which only brighten
// Snow lit from its surface normal: warm white facing the sun, blue turned away from it.
function snowTone(nx, ny, nz, res) {
  const l = nx * SX + ny * SY + nz * SZ;
  const t = smooth(0.35, 0.86, l);
  const a = t > 0.5 ? C.snowMid : C.snowDeep, b = t > 0.5 ? C.snowLit : C.snowShade, f = t > 0.5 ? (t - 0.5) * 2 : t * 2;
  const c = res || [0, 0, 0];
  c[0] = a[0] + (b[0] - a[0]) * f; c[1] = a[1] + (b[1] - a[1]) * f; c[2] = a[2] + (b[2] - a[2]) * f;
  return c;
}
function hourOf(ctx) { const h = ctx.hour != null ? ctx.hour : 12; return ((h % 24) + 24) % 24; }
// Lights are on from just before the dusk slot until just after the dawn one.
function lightsOn(ctx) { const h = hourOf(ctx); return h > 18.8 || h < 6.9; }
// For scripts that look for things: globalThis.__alpsLog = [] collects { kind, wx, d } as they are drawn.
function note(kind, wx, d, y) { const log = globalThis.__alpsLog; if (log) log.push({ kind, wx: Math.round(wx), d: Math.round(d), y: y != null ? Math.round(y) : undefined }); }
const inD = (d, lo, hi) => d >= lo && d < hi;
const inX = (ctx, wx, m = 0) => wx >= ctx.x0 - m && wx < ctx.x0 + ctx.length + m;
const ridge = (v) => 1 - Math.abs(2 * v - 1);

// Rotation whose local x axis is the unit vector a and local y axis b (made perpendicular to a).
function quatBasis(ax, ay, az, bx, by, bz) {
  const al = Math.hypot(ax, ay, az) || 1; ax /= al; ay /= al; az /= al;
  const dt = ax * bx + ay * by + az * bz;
  bx -= dt * ax; by -= dt * ay; bz -= dt * az;
  const bl = Math.hypot(bx, by, bz) || 1; bx /= bl; by /= bl; bz /= bl;
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
  const m00 = ax, m10 = ay, m20 = az, m01 = bx, m11 = by, m21 = bz, m02 = cx, m12 = cy, m22 = cz;
  const tr = m00 + m11 + m22;
  if (tr > 0) { const S2 = Math.sqrt(tr + 1) * 2; return [(m21 - m12) / S2, (m02 - m20) / S2, (m10 - m01) / S2, 0.25 * S2]; }
  if (m00 > m11 && m00 > m22) { const S2 = Math.sqrt(1 + m00 - m11 - m22) * 2; return [0.25 * S2, (m01 + m10) / S2, (m02 + m20) / S2, (m21 - m12) / S2]; }
  if (m11 > m22) { const S2 = Math.sqrt(1 + m11 - m00 - m22) * 2; return [(m01 + m10) / S2, 0.25 * S2, (m12 + m21) / S2, (m02 - m20) / S2]; }
  const S2 = Math.sqrt(1 + m22 - m00 - m11) * 2; return [(m02 + m20) / S2, (m12 + m21) / S2, 0.25 * S2, (m10 - m01) / S2];
}
// A shaped splat: an ellipsoid with radius a along the direction (ux, uy, uz) and b, c across it.
function ell(out, x, y, z, a, b, c, ux, uy, uz, col, kind, move = 0, o = 1) {
  const q = Math.abs(uy) > 0.98 * Math.hypot(ux, uy, uz) ? quatBasis(ux, uy, uz, 1, 0, 0) : quatBasis(ux, uy, uz, 0, 1, 0);
  out(x, y, z, a, b, c, col[0], col[1], col[2], o, q[0], q[1], q[2], q[3], kind, move);
}
// A thin straight member from a to b (splat space), r thick, with a kind and a motion class.
function bar(out, ax, ay, az, bx, by, bz, r, c, n = 2, kind = KIND.OTHER, move = 0, o = 1) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1e-6;
  const q = quatXTo(dx / len, dy / len, dz / len), sl = (len / n) * 0.5;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    out(ax + dx * t, ay + dy * t, az + dz * t, Math.max(sl, r), r, r, c[0], c[1], c[2], o, q[0], q[1], q[2], q[3], kind, move);
  }
}
// How thick a thin thing must be drawn at distance d to stay a line.
const thin = (d, k = 1) => Math.max(0.04, 0.0006 * d) * k;
const limb = (r, d) => Math.max(r, 0.0007 * d);
// Tone for a vertical face with outward normal (nx, nz) in splat space: the camera-facing front,
// the sunlit (-x) end and the shaded (+x) end come out clearly different, so corners read in motion.
function faceTone(c, nx, nz) {
  const k = 0.62 + 0.24 * Math.max(0, nz) + 0.4 * Math.max(0, -nx) - 0.08 * Math.max(0, nx) - 0.12 * Math.max(0, -nz);
  const cool = Math.max(0, nx) + Math.max(0, -nz);
  return [c[0] * k * (1 - 0.05 * cool), c[1] * k, c[2] * k * (1 + 0.08 * cool)];
}
// Fill a parallelogram with splats on a jittered grid. o = corner, u/v = unit edge directions
// (splat space), lu/lv = edge lengths; colorAt(a, b) -> [r,g,b], or null for a hole.
function* panel(out, o, u, v, lu, lv, s, colorAt, kind, rng, thick = 0.12, move = 0) {
  const nu = Math.max(1, Math.round(lu / (s * 1.4))), nv = Math.max(1, Math.round(lv / (s * 1.4)));
  const su = (lu / nu) * 0.64, sv = (lv / nv) * 0.64;
  const q = quatBasis(u[0], u[1], u[2], v[0], v[1], v[2]);
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = (i + 0.5 + (rng() - 0.5) * 0.25) / nu, b = (j + 0.5 + (rng() - 0.5) * 0.25) / nv;
      const c = colorAt(a, b);
      if (!c) continue;
      out(o[0] + u[0] * a * lu + v[0] * b * lv, o[1] + u[1] * a * lu + v[1] * b * lv, o[2] + u[2] * a * lu + v[2] * b * lv,
        su, sv, Math.max(0.02, s * thick), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind, move);
      if (out.due()) yield;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// World layout (pure functions of world x and distance; cached per world seed)
// ---------------------------------------------------------------------------------------------
const worlds = new Map();
function world(ctx) {
  const ws = worldSeed(ctx);
  let W = worlds.get(ws);
  if (W) return W;
  W = { ws, misc: new Map(), xb: new Map(), xl: null, xli: NaN };
  W.base = makeTable((wx, d) => baseH(W, wx, d), 200, 0.022, 0.02, 96);
  W.H = (wx, d) => heightAt(W, wx, d);
  W.terr = { height: W.H, stretch: ctx.terrain.stretch, shape: ctx.terrain.shape };
  worlds.set(ws, W);
  if (worlds.size > 6) worlds.delete(worlds.keys().next().value);
  return W;
}
// A copy of ctx standing on the valley; every kit call must get this one.
function local(ctx) { const W = world(ctx); return [{ ...ctx, terrain: W.terr }, W]; }
function cache(W, type, i, make) {
  const key = type * 1048576 + i;
  let v = W.misc.get(key);
  if (v === undefined) { v = make(); if (W.misc.size > 60000) W.misc.clear(); W.misc.set(key, v); }
  return v;
}
// The valley side is asked for three times for every ground splat, so it is tabulated per world:
// rows at log-spaced distances, columns a little over one per cent of the distance apart, in tiles of
// 16 x 32 cells made on first use and interpolated bilinearly (after winter.js).
const TR = 16, TC = 32;
function makeTable(fn, row0, rowStep, colK, colMax) {
  const ROWK = Math.log(1 + rowStep), steps = [];
  const tiles = new Map();
  for (let band = 0; band < 400; band++) {
    const d = row0 * Math.exp(band * TR * ROWK);
    steps.push(Math.max(1, Math.min(colMax, Math.pow(2, Math.round(Math.log2(d * colK))))));
  }
  return (wx, d) => {
    const jf = Math.log(Math.max(d, row0) / row0) / ROWK;
    const j = Math.floor(jf), band = Math.floor(j / TR);
    const cs = steps[band], uf = wx / cs, u = Math.floor(uf), ti = Math.floor(u / TC);
    const key = band * 4194304 + ti;
    let t = tiles.get(key);
    if (t === undefined) {
      t = new Float32Array((TR + 1) * (TC + 1));
      for (let a = 0; a <= TR; a++) {
        const dd = row0 * Math.exp((band * TR + a) * ROWK);
        for (let b = 0; b <= TC; b++) t[a * (TC + 1) + b] = fn((ti * TC + b) * cs, dd);
      }
      if (tiles.size > 6000) tiles.clear();
      tiles.set(key, t);
    }
    const a = j - band * TR, b = u - ti * TC, fa = jf - j, fb = uf - u;
    const i0 = a * (TC + 1) + b;
    const h00 = t[i0], h01 = t[i0 + 1], h10 = t[i0 + TC + 1], h11 = t[i0 + TC + 2];
    return h00 + (h01 - h00) * fb + (h10 - h00) * fa + (h00 - h01 - h10 + h11) * fa * fb;
  };
}
const ST = { PEAK: 1, GLACIER: 2, MIX: 3, VILLAGE: 4, FARM: 5, BARN: 6, HAIRPIN: 7, CABLE: 8, HERD: 9, FALLS: 10, BROOK: 11, HALT: 12, MISC: 13, DEER: 14, ROCKS: 15, GOAT: 16, MARMOT: 17, HAY: 18 };

// --- everything that depends on world x alone, tabulated per metre in blocks of 256 m ---
//   rc  the river's centre line (distance from the track)     rw  its width measured along d
//   fy  the level of the valley floor                         ft  where the valley side begins
//   rd  the road's centre line                                cl  0..1: a stretch with a cliff band
//   sl  the river's slope d(rc)/dx                            hs  0..1: at a halt (the shelf it stands on)
//   nb  > 0 where a branch road, a cable car or a brook may lie at this x (else none does)
const XB = 256, XF = 9;
// The road winds along the foot of the bank, 27 to 53 m out; the river lies beyond it, never closer
// to it than a few metres of bank, and meanders in loops of a hundred to three hundred metres.
// (Both are kept close: from the window, level ground a hundred metres off is a thin sliver.)
function roadC0(W, wx) { return 27 + 14 * noise1(wx / 2300, W.ws + 601) + 12 * noise1(wx / 330, W.ws + 602); }
function riverW0(W, wx) { return 22 + 16 * noise1(wx / 700, W.ws + 604); }
function riverC0(W, wx) { return roadC0(W, wx) + 12 + 0.65 * riverW0(W, wx) + 34 * noise1(wx / 260, W.ws + 605) + 20 * noise1(wx / 95, W.ws + 603); }
function rawX(W, wx, a, o) {
  rawBase(W, wx, a, o);
  a[o + 7] = haltAmt(W, wx);
  a[o + 8] = hairpinNear(W, wx) || cableNear(W, wx) || brookNear(W, wx) ? 1 : 0;
}
// (the part of it the sites themselves are laid out from: they must not ask the table, which asks them)
function rawBase(W, wx, a, o) {
  const ws = W.ws;
  const rc = riverC0(W, wx), sl = (riverC0(W, wx + 1) - riverC0(W, wx - 1)) / 2;
  a[o] = rc;
  a[o + 1] = riverW0(W, wx) * Math.sqrt(1 + sl * sl);      // (a band in d narrows on a bend: widened by the slope)
  a[o + 2] = -(6 + 2.5 * noise1(wx / 1700, ws + 611));
  a[o + 3] = 330 + 220 * noise1(wx / 2100, ws + 621) + 60 * noise1(wx / 500, ws + 622);
  a[o + 4] = roadC0(W, wx);
  a[o + 5] = smooth(0.52, 0.7, noise1(wx / 3300, ws + 631));
  a[o + 6] = sl;
}
const XRA = new Float64Array(7), XR = { rc: 0, rw: 0, fy: 0, ft: 0, rd: 0, cl: 0, sl: 0, hs: 0, nb: 0 };
function xRaw(W, wx) {
  rawBase(W, wx, XRA, 0);
  XR.rc = XRA[0]; XR.rw = XRA[1]; XR.fy = XRA[2]; XR.ft = XRA[3]; XR.rd = XRA[4]; XR.cl = XRA[5]; XR.sl = XRA[6];
  return XR;
}
const X = { rc: 0, rw: 0, fy: 0, ft: 0, rd: 0, cl: 0, sl: 0, hs: 0, nb: 0 };
let XW = null, XWX = NaN;      // whose values X holds, and for which x (asked for again and again by the fill)
function xAt(W, wx) {
  if (wx === XWX && W === XW) return X;
  XW = W; XWX = wx;
  const b = Math.floor(wx / XB);
  let a = W.xl;
  if (W.xli !== b) {
    a = W.xb.get(b);
    if (!a) {
      a = new Float32Array((XB + 1) * XF);
      for (let i = 0; i <= XB; i++) rawX(W, b * XB + i, a, i * XF);
      if (W.xb.size > 600) W.xb.clear();
      W.xb.set(b, a);
    }
    W.xl = a; W.xli = b;
  }
  const f = wx - b * XB, i = Math.min(XB - 1, Math.floor(f)), t = f - i, o = i * XF;
  X.rc = a[o] + (a[o + XF] - a[o]) * t;
  X.rw = a[o + 1] + (a[o + XF + 1] - a[o + 1]) * t;
  X.fy = a[o + 2] + (a[o + XF + 2] - a[o + 2]) * t;
  X.ft = a[o + 3] + (a[o + XF + 3] - a[o + 3]) * t;
  X.rd = a[o + 4] + (a[o + XF + 4] - a[o + 4]) * t;
  X.cl = a[o + 5] + (a[o + XF + 5] - a[o + 5]) * t;
  X.sl = a[o + 6] + (a[o + XF + 6] - a[o + 6]) * t;
  X.hs = a[o + 7] + (a[o + XF + 7] - a[o + 7]) * t;
  X.nb = a[o + 8] + a[o + XF + 8];
  return X;
}
const WATER_BELOW = 1.9;      // the river's surface lies this far below the floor at the bank's foot
function bankEnd(fy) { return 5 + 1.7 * -fy; }

// --- the peaks: horns with three or four aretes, standing along the crest ---
const PKCELL = 2300;
function crestD(W, wx) { return 5200 + 1300 * noise1(wx / 3700, W.ws + 52); }
function peak(W, i) {
  return cache(W, ST.PEAK, i, () => {
    const r = makeRng(hashInts(W.ws, 701, i));
    if (r() > 0.82) return null;
    const wx = (i + 0.15 + 0.7 * r()) * PKCELL;
    return { i, wx, d: crestD(W, wx) - 150 + 350 * r(), H: 380 + 330 * r() * r() + 180 * r(), R: 1600 + 800 * r(), ph: r() * 6.28, k: r() < 0.5 ? 3 : 4, sharp: 1.15 + 0.35 * r() };
  });
}
function peaksH(W, wx, d) {
  if (d < 3200) return 0;
  const i0 = Math.floor(wx / PKCELL);
  let m = 0;
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const p = peak(W, i);
    if (!p) continue;
    const dx = wx - p.wx, dd = (d - p.d) * 0.85;
    const rho = Math.hypot(dx, dd);
    if (rho > p.R * 1.25) continue;
    const th = Math.atan2(dd, dx);
    const re = rho * (1 + 0.24 * Math.cos(p.k * th + p.ph)) / p.R;
    if (re >= 1) continue;
    const v = p.H * Math.pow(1 - re, p.sharp);
    if (v > m) m = v;
  }
  return m;
}
// --- side valleys: a trough cut into the valley side; half of them hold a glacier ---
const GLCELL = 5200;
function sideValley(W, i) {
  return cache(W, ST.GLACIER, i, () => {
    const r = makeRng(hashInts(W.ws, 711, i));
    if (r() > 0.75) return null;
    const wx = (i + 0.2 + 0.6 * r()) * GLCELL;
    return { i, wx, w: 480 + 380 * r(), bend: (r() - 0.5) * 0.3, glacier: r() < 0.7, snout: 2700 + 900 * r(), seed: hashInts(W.ws, 712, i) };
  });
}
const SV = { f: 0, u: 0, g: null };
// How deep in a side valley a point lies: f 0..1 (1 on its axis), u = signed offset / half-width.
function sideAt(W, wx, d) {
  SV.f = 0; SV.g = null;
  const i0 = Math.floor(wx / GLCELL);
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const g = sideValley(W, i);
    if (!g) continue;
    const ax = g.wx + g.bend * (d - 1500) + 120 * Math.sin(d / 900 + g.i);
    const u = (wx - ax) / g.w;
    if (u > -1 && u < 1) { const f = smooth(1, 0.3, Math.abs(u)); if (f > SV.f) { SV.f = f; SV.u = u; SV.g = g; } }
  }
  return SV;
}

// ---------------------------------------------------------------------------------------------
// The height function
// ---------------------------------------------------------------------------------------------
// The valley side above its foot (s = distance beyond the foot): its height is s times an elevation
// tangent that grows with distance, so the side is concave and nothing on it hides what is behind;
// along the crest stand the peaks; beyond the crest it falls away (never seen).
function wallH(W, wx, d, s) {
  const ws = W.ws;
  const k = 0.32 + 0.1 * noise2(wx / 900, d / 2600, ws + 51);
  const crest = crestD(W, wx);
  let se = s, fall = 0;
  if (d > crest) { se = s - (d - crest); fall = (d - crest) * 0.45; }
  let h = k * se * se / (se + 2200);
  // low spurs and hollows on the lower slopes
  h += (noise2(wx / 270, d / 210, ws + 55) - 0.5) * 46 * smooth(0, 500, s) + (noise2(wx / 90, d / 80, ws + 56) - 0.5) * 9 * smooth(0, 200, s);
  const hi = smooth(380, 1300, h);
  if (hi > 0) {
    const r1 = ridge(fbm2(wx / 1500, d / 2000, ws + 53, 2));        // aretes
    const g = noise2(wx / 190, d / 1900, ws + 54);                  // couloirs down the fall line
    h += hi * ((r1 * r1 - 0.3) * 380 + (g - 0.5) * 110);
  }
  h += peaksH(W, wx, d);
  // (the highest summits are eased down so that none stands taller than the window: with the rise of
  // the floor below them and the cliff band, a tangent of about 0.42)
  const lim = 0.35 * d, knee = 0.8 * lim;
  if (h > knee) h = knee + (lim - knee) * Math.tanh((h - knee) / (lim - knee));
  const sv = sideAt(W, wx, d);
  if (sv.f > 0) h *= 1 - 0.42 * sv.f * smooth(150, 700, s);
  return h - fall;
}
// Bank, floor and valley side (the smooth part; the river's bed and the cliffs are added on top).
function baseH(W, wx, d) {
  const x = xAt(W, wx);
  if (d < 4.6) return d < 2.5 ? 0 : -0.3 * smooth(2.5, 4.6, d);
  const fy = x.fy, bEnd = bankEnd(fy), rc = x.rc, ft = x.ft;
  if (d < bEnd) {
    // the bank: steep at the top, easing out onto the floor (at a halt, a shelf is cut into its top)
    const sh = x.hs > 0 ? x.hs * 9.5 : 0, t = Math.max(0, (d - 4.6 - sh) / (bEnd - 4.6 - sh));
    return -0.3 + (fy + 0.3) * (1 - (1 - t) * (1 - t) * (1 - 0.5 * t)) + (noise2(wx / 9, d / 5, W.ws + 42) - 0.5) * 0.5 * t * (1 - t) * 4;
  }
  let h = fy + (noise2(wx / 47, d / 39, W.ws + 41) - 0.5) * 1.6 * smooth(bEnd, bEnd + 25, d);
  h += d < rc ? -1.2 * smooth(bEnd, rc - 8, d) : -1.2 + 0.045 * (d - rc);
  const s = d - ft;
  if (s > 0) h += wallH(W, wx, d, s);
  return h;
}
// The cliff band: how far beyond the foot of the valley side it stands, and the step it adds.
function cliffS(W, wx) { return 250 + 170 * noise1(wx / 420, W.ws + 632) + 40 * noise1(wx / 90, W.ws + 634); }
function cliffH(W, wx, s, cl) {
  const sc = cliffS(W, wx);
  return cl * (120 + 60 * noise1(wx / 800, W.ws + 633)) * smooth(sc, sc + 26, s);
}
function heightAt(W, wx, d) {
  if (d < 215) {
    let h = baseH(W, wx, d);                           // (leaves this x's values in X)
    const ad = Math.abs(d - X.rc), hw = X.rw * 0.5;
    if (ad < hw + 5) h = lerp(h, X.fy - WATER_BELOW, smooth(hw + 5, hw + 0.5, ad));
    return h;
  }
  let h = W.base(wx, d);
  const x = xAt(W, wx);
  const ad = Math.abs(d - x.rc), hw = x.rw * 0.5;
  if (ad < hw + 5) h = lerp(h, x.fy - WATER_BELOW, smooth(hw + 5, hw + 0.5, ad));
  if (x.cl > 0 && d > x.ft) h += cliffH(W, wx, d - x.ft, x.cl);
  return h;
}

// ---------------------------------------------------------------------------------------------
// Sites: villages, farms, barns, the branch road and its hairpins, the cable car, brooks and
// falls, herds and the rest. Each is a pure function of its world cell, cached per world.
// ---------------------------------------------------------------------------------------------
// The values of xAt() at a world x, copied (xAt returns a reused object).
function xCopy(W, wx) { const x = xRaw(W, wx); return { rc: x.rc, rw: x.rw, fy: x.fy, ft: x.ft, rd: x.rd, cl: x.cl, sl: x.sl }; }

// --- the halt: a short platform on a shelf cut into the top of the bank, a wooden station ---
const HCELL = 3300;
function halt(W, i) {
  return cache(W, ST.HALT, i, () => {
    const r = makeRng(hashInts(W.ws, 551, i));
    if (r() > 0.5) return null;
    return { i, x0: (i + 0.15 + 0.6 * r()) * HCELL, len: 70 + 30 * r(), seed: hashInts(W.ws, 552, i) };
  });
}
function haltAmt(W, wx) {
  const i0 = Math.floor(wx / HCELL);
  let a = 0;
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const h = halt(W, i);
    if (h) a = Math.max(a, smooth(h.x0 - 28, h.x0 - 3, wx) * smooth(h.x0 + h.len + 28, h.x0 + h.len + 3, wx));
  }
  return a;
}

// --- chalets ---
const SHUTTERS = [[0.16, 0.36, 0.2], [0.56, 0.12, 0.1], [0.2, 0.3, 0.5], [0.3, 0.2, 0.12]];
const BLOOMS = [[0.8, 0.1, 0.08], [0.8, 0.26, 0.42], [0.8, 0.14, 0.2], [0.78, 0.76, 0.7], [0.8, 0.4, 0.1]];
// type: 'chalet' (a house: stone or plaster ground floor, timber above, balcony, flower boxes),
// 'barn' (a small hay barn: all timber on stone footings, no windows), 'farm' (a big chalet).
function chaletSpec(pr, wx, d, seed, type = 'chalet') {
  const barn = type === 'barn', farm = type === 'farm';
  const turn = pr();
  return {
    wx, d, seed, type,
    w: barn ? 5 + 2 * pr() : farm ? 12 + 3 * pr() : 8.5 + 3 * pr(),          // across the gable front
    dep: barn ? 5 + 2 * pr() : farm ? 11 + 3 * pr() : 8 + 3 * pr(),          // along the ridge
    h: barn ? 2.6 + 0.6 * pr() : farm ? 5.6 + 0.8 * pr() : 4.6 + 1.2 * pr(),
    pitch: 0.36 + 0.12 * pr(),
    // the gable faces the line, or the building stands side on to it
    yaw: (turn < 0.55 ? 0 : turn < 0.78 ? Math.PI / 2 : -Math.PI / 2) + (pr() - 0.5) * 0.4,
    plaster: pr() < 0.45, baseH: barn ? 0.5 : 2.3 + 0.4 * pr(),
    shut: Math.floor(pr() * SHUTTERS.length), bloom: Math.floor(pr() * BLOOMS.length),
    smoke: !barn && pr() < 0.35, flag: !barn && pr() < (farm ? 0.7 : 0.16), newer: pr() < 0.25,
  };
}

// --- villages: chalets round a white church, beyond the river, reached by a covered bridge ---
const VCELL = 3100;
function village(W, i) {
  return cache(W, ST.VILLAGE, i, () => {
    const r = makeRng(hashInts(W.ws, 801, i));
    if (r() > 0.72) return null;
    const cx = (i + 0.2 + 0.6 * r()) * VCELL;
    const x = xCopy(W, cx);
    const R = 80 + 35 * r(), Rd = 44 + 14 * r();
    let far = 0;
    for (let a = -R; a <= R; a += 20) { const xx = xRaw(W, cx + a); far = Math.max(far, xx.rc + xx.rw * 0.5); }
    const dc = far + 22 + Rd;
    const hp = hairpinNear(W, cx);
    if (hp && Math.abs(hp.wx - cx) < R + 60) return null;
    const v = { i, cx, dc, R, Rd, seed: hashInts(W.ws, 802, i), houses: [], trees: [] };
    v.sq = { wx: cx + (r() - 0.5) * 20, d: dc - Rd * 0.3 };
    v.church = { wx: v.sq.wx + (r() - 0.5) * 24, d: v.sq.d + 30 + 8 * r(), yaw: (r() - 0.5) * 0.3, onion: r() < 0.55, spire: 15 + 8 * r(), seed: hashInts(W.ws, 803, i) };
    for (let a = -R; a <= R; a += 19) {
      for (let b = -Rd; b <= Rd; b += 18) {
        const pr = makeRng(hashInts(v.seed, Math.round(a), Math.round(b)));
        if ((a / R) ** 2 + (b / Rd) ** 2 > 1) continue;
        const wx = cx + a + (pr() - 0.5) * 6, d = dc + b + (pr() - 0.5) * 5;
        if (Math.hypot(wx - v.sq.wx, (d - v.sq.d) * 1.3) < 15) continue;
        if (Math.abs(wx - v.church.wx - 2) < 20 && Math.abs(d - v.church.d) < 15) continue;
        const u = pr();
        if (u < 0.6) v.houses.push(chaletSpec(pr, wx, d, hashInts(v.seed, 7, Math.round(a), Math.round(b)), pr() < 0.2 ? 'barn' : 'chalet'));
        else if (u < 0.8) v.trees.push({ wx, d, seed: hashInts(v.seed, 9, Math.round(a), Math.round(b)) });
      }
    }
    // the bridge from the road, at the village's middle
    const bx = v.sq.wx, xb = xCopy(W, bx);
    v.bridge = { wx: bx, a: xb.rc - xb.rw * 0.5 - 3, b: xb.rc + xb.rw * 0.5 + 3, type: 'covered', seed: hashInts(W.ws, 804, i) };
    void x;
    return v;
  });
}
function villageAt(W, wx, d, m = 0) {
  const i = Math.floor(wx / VCELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const v = village(W, k);
    if (v && ((wx - v.cx) / (v.R + m)) ** 2 + ((d - v.dc) / (v.Rd + m)) ** 2 < 1) return v;
  }
  return null;
}

// --- farms: a big chalet and a barn, a fountain trough, a garden, washing, a flag ---
const FCELL = 640;
function farm(W, i) {
  return cache(W, ST.FARM, i, () => {
    const r = makeRng(hashInts(W.ws, 541, i));
    if (r() > 0.6) return null;
    const cx = (i + 0.2 + 0.6 * r()) * FCELL;
    // between the road and the river where there is room for it, else beyond the river
    let gap = 1e9, far = 0, rdMax = 0;
    for (let a = -24; a <= 24; a += 8) { const xx = xRaw(W, cx + a); gap = Math.min(gap, xx.rc - xx.rw * 0.5 - xx.rd); far = Math.max(far, xx.rc + xx.rw * 0.5); rdMax = Math.max(rdMax, xx.rd); }
    const nearSide = gap > 36;
    const dc = nearSide ? rdMax + 15 + (gap - 36) * 0.4 * r() : far + 24 + 45 * r();
    if (villageAt(W, cx, dc, 40)) return null;
    const hp = hairpinNear(W, cx);
    if (hp && Math.abs(hp.wx - cx) < 60) return null;
    const f = { i, cx, dc, nearSide, seed: hashInts(W.ws, 542, i), bldgs: [] };
    const pr = makeRng(hashInts(f.seed, 1));
    const side = r() < 0.5 ? -1 : 1;
    const hs = chaletSpec(pr, cx, dc, hashInts(f.seed, 11), 'farm');
    hs.yaw = (pr() - 0.5) * 0.4 + (pr() < 0.3 ? Math.PI / 2 : 0);
    f.bldgs.push(hs);
    const bs = chaletSpec(pr, cx + side * (16 + 4 * pr()), dc + 3 + 4 * pr(), hashInts(f.seed, 12), 'barn');
    bs.w += 3; bs.dep += 3; bs.h += 0.8;
    f.bldgs.push(bs);
    f.trough = { wx: cx - side * (9 + 3 * r()), d: dc - 7 - 2 * r() };
    f.washing = r() < 0.7 ? { wx: cx - side * (13 + 3 * r()), d: dc + 1 } : null;
    f.garden = { wx: cx + side * 5, d: dc - 9 };
    f.tree = { wx: cx - side * (18 + 5 * r()), d: dc + 5 + 5 * r() };
    return f;
  });
}
function farmNear(W, wx, d, m) {
  const i = Math.floor(wx / FCELL);
  for (let k = i - 1; k <= i + 1; k++) { const f = farm(W, k); if (f && Math.abs(wx - f.cx) < 26 + m && Math.abs(d - f.dc) < 16 + m) return f; }
  return null;
}
function siteNear(W, wx, d, m = 0) { return villageAt(W, wx, d, m) || farmNear(W, wx, d, m); }

// --- the branch road: leaves the valley road, crosses the river on a stone bridge, and climbs
// the valley side in hairpins ---
const HPCELL = 3100;
function hairpin(W, i) {
  return cache(W, ST.HAIRPIN, i, () => {
    const r = makeRng(hashInts(W.ws, 561, i));
    if (r() > 0.75) return null;
    const wx = (i + 0.25 + 0.5 * r()) * HPCELL;
    const x = xCopy(W, wx);
    const L = 120 + 60 * r(), sp = 62 + 22 * r(), n = 9 + Math.floor(r() * 5), side = r() < 0.5 ? -1 : 1;
    // (never where the cliff band stands: a road cannot climb it)
    for (let a = -L - 60; a <= L + 60; a += 30) if (xRaw(W, wx + a).cl > 0) return null;
    const h = { i, wx, L, sp, n, d0: x.ft + 40, xa: wx - side * L, xb: wx + side * L, seed: hashInts(W.ws, 562, i) };
    h.bridge = { wx, a: x.rc - x.rw * 0.5 - 3, b: x.rc + x.rw * 0.5 + 3, type: 'stone', seed: hashInts(W.ws, 563, i) };
    h.rd = x.rd;
    return h;
  });
}
function hairpinNear(W, wx) {
  const i = Math.floor(wx / HPCELL);
  for (let k = i - 1; k <= i + 1; k++) { const h = hairpin(W, k); if (h && Math.abs(wx - h.wx) < h.L + 80) return h; }
  return null;
}
function cableNear(W, wx) {
  const i = Math.floor(wx / CCELL);
  for (let k = i - 1; k <= i + 1; k++) { const c = cable(W, k); if (c && wx > Math.min(c.x0, c.x1) - 40 && wx < Math.max(c.x0, c.x1) + 40) return c; }
  return null;
}
function brookNear(W, wx) {
  const i = Math.floor(wx / BRCELL);
  for (let k = i - 1; k <= i + 1; k++) { const b = brook(W, k); if (b && Math.abs(wx - b.wx) < 190) return b; }
  return null;
}
// The road's world x at distance d: across the floor from the bridge, then to and fro up the slope.
function hairpinX(h, d) {
  if (d < h.d0) return lerp(h.wx, h.xa, smooth(h.bridge.b, h.d0, d));
  const t = (d - h.d0) / h.sp, j = Math.floor(t), f = t - j;
  // (corners eased a little, so the bends are round)
  const e = f < 0.08 ? 0.08 * 0.5 + f * f / 0.16 : f > 0.92 ? 1 - 0.04 - (1 - f) * (1 - f) / 0.16 : f;
  return j % 2 === 0 ? lerp(h.xa, h.xb, e) : lerp(h.xb, h.xa, e);
}
function hairpinEnd(h) { return h.d0 + h.n * h.sp; }
// Is (wx, d) on the open alp the branch road climbs through (or on the road's own strip below it)?
function hairpinClear(W, wx, d) {
  const i = Math.floor(wx / HPCELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const h = hairpin(W, k);
    if (!h || d < h.bridge.b || d > hairpinEnd(h) + 40) continue;
    const m = 34 + 36 * noise2(wx / 60, d / 60, h.seed & 0xffff);
    if (d > h.d0 - 30) { if (Math.abs(wx - h.wx) < h.L + m) return true; } else if (Math.abs(wx - hairpinX(h, d)) < 9) return true;
  }
  return false;
}
// How far (wx, d) lies from the middle of the branch road, across it (large if nowhere near).
function hairpinOff(W, wx, d) {
  const i = Math.floor(wx / HPCELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const h = hairpin(W, k);
    if (!h || Math.abs(wx - h.wx) > h.L + 12 || d < h.rd || d > hairpinEnd(h)) continue;
    if (d < h.bridge.a) return Math.abs(wx - h.wx);
    return Math.abs(wx - hairpinX(h, d)) * (d < h.d0 ? 1 : h.sp / Math.hypot(2 * h.L, h.sp));
  }
  return 1e9;
}

// --- the cable car: a gondola line climbing aslant across the valley side ---
const CCELL = 4300;
function cable(W, i) {
  return cache(W, ST.CABLE, i, () => {
    const r = makeRng(hashInts(W.ws, 571, i));
    if (r() > 0.8) return null;
    // (a few tries at a line clear of the villages, the branch roads and the cliffs)
    let x0, d0, x1, d1, dir, ok = false;
    for (let tr = 0; tr < 6 && !ok; tr++) {
      x0 = (i + 0.2 + 0.6 * r()) * CCELL; dir = r() < 0.5 ? -1 : 1;
      const xa = xCopy(W, x0);
      d0 = xa.rc + xa.rw * 0.5 + 60 + 40 * r();
      x1 = x0 + dir * (800 + 500 * r()); d1 = Math.min(2500, xRaw(W, x1).ft + 900 + 500 * r());
      ok = !(villageAt(W, x0, d0, 60) || hairpinNear(W, x0) || hairpinNear(W, x1) || hairpinNear(W, (x0 + x1) / 2));
      for (let t = 0; t <= 1 && ok; t += 0.125) if (xRaw(W, lerp(x0, x1, t)).cl > 0.25) ok = false;
      // (the valley station stands in the open, with no wood between it and the line)
      for (let k = -20; k <= 120 && ok; k += 20) for (const u of [-40, 0, 40]) if (forestF(W, x0 + u, d0 - k, 4, xa.ft) > 0) ok = false;
    }
    if (!ok) return null;
    const c = { i, x0, d0, x1, d1, dir, seed: hashInts(W.ws, 572, i) };
    // towers along it, about 230 m apart; the stations are the first and the last
    const len = Math.hypot(x1 - x0, d1 - d0), nt = Math.max(3, Math.round(len / 230));
    c.pts = [];
    for (let k = 0; k <= nt; k++) { const t = k / nt; c.pts.push({ wx: lerp(x0, x1, t), d: lerp(d0, d1, t) }); }
    return c;
  });
}
function cableClear(W, wx, d) {
  const i = Math.floor(wx / CCELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const c = cable(W, k);
    if (!c || d < c.d0 - 40 || d > c.d1 + 30) continue;
    // (a wide swathe low down, where the trees stand tall against the line, and round the stations)
    const cx = lerp(c.x0, c.x1, (d - c.d0) / (c.d1 - c.d0));
    if (Math.abs(wx - cx) * (c.d1 - c.d0) / Math.hypot(c.x1 - c.x0, c.d1 - c.d0) < (d < 420 ? 26 : 12) && d > c.d0 - 10 && d < c.d1 + 10) return true;
    if (Math.hypot(wx - c.x0, d - c.d0) < 38 || Math.hypot(wx - c.x1, d - c.d1) < 30) return true;
  }
  return false;
}

// --- brooks: from the valley side across the floor to the river; in a cliff stretch each one
// comes over the cliff as a waterfall ---
const BRCELL = 760;
function brook(W, i) {
  return cache(W, ST.BROOK, i, () => {
    const r = makeRng(hashInts(W.ws, 581, i));
    const wx = (i + 0.2 + 0.6 * r()) * BRCELL;
    const x = xCopy(W, wx);
    if (r() > (x.cl > 0.6 ? 0.85 : 0.35)) return null;
    if (hairpinNear(W, wx)) return null;
    const fall = x.cl > 0.6;
    // df: where it leaves the valley side (the foot of the cliff, where there is one)
    return { i, wx, ft: x.ft, df: x.ft + (fall ? cliffS(W, wx) : 130), slope: (r() - 0.5) * 0.5, w: 2.4 + 1.6 * r(), fall, seed: hashInts(W.ws, 582, i) };
  });
}
// (it passes through its own wx at df)
function brookX(b, d) { return b.wx + b.slope * (d - b.df) + 5 * (Math.sin(d / 19 + b.i) - Math.sin(b.df / 19 + b.i)); }
function brookAt(W, wx, d) {
  const i = Math.floor(wx / BRCELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const b = brook(W, k);
    if (b && d < b.df - 2 && Math.abs(wx - brookX(b, d)) < b.w * 0.5 + 0.0025 * d) return b;
  }
  return null;
}
const ROADPALE = [0.68, 0.65, 0.57];
// Where a brook's fall stands: the distance of the cliff's lip there, and its height.
function fallOf(W, b) {
  return { wx: b.wx, d: b.df, yTop: W.H(b.wx, b.df + 32), yBot: W.H(b.wx, b.df - 6), dTop: b.df + 32 };
}

// --- cattle and the other animals ---
const COWCELL = 300, GOATCELL = 560, ROCKCELL = 780, MARCELL = 230, DEERCELL = 620, BIRDCELL = 1150;
const COATS = [
  { c: [0.44, 0.36, 0.28], pale: [0.66, 0.6, 0.5] },                        // Braunvieh: grey-brown, pale muzzle
  { c: [0.52, 0.47, 0.42], pale: [0.7, 0.66, 0.6] },                        // grey
  { c: [0.5, 0.24, 0.1], pale: [0.78, 0.76, 0.7], pied: true },             // Simmental: red and white
  { c: [0.36, 0.2, 0.1], pale: [0.6, 0.5, 0.38] },                          // dark brown
  { c: [0.5, 0.24, 0.1], pale: [0.78, 0.76, 0.7], pied: true },
];
// Where on the floor a group may stand at this x: 0 between the bank and the road, 1 between the
// road and the river, 2 beyond the river. Returns [dLo, dHi] or null.
function zoneAt(W, wx, z) {
  const x = xAt(W, wx);
  if (z === 0) { const a = bankEnd(x.fy) + 2, b = x.rd - 6; return b - a > 4 ? [a, b] : null; }
  if (z === 1) { const a = x.rd + 6, b = x.rc - x.rw * 0.5 - 5; return b - a > 6 ? [a, b] : null; }
  const a = x.rc + x.rw * 0.5 + 6;
  return [a, Math.min(a + 85, x.ft)];
}
function herd(W, i) {
  return cache(W, ST.HERD, i, () => {
    const r = makeRng(hashInts(W.ws, 591, i));
    if (r() > 0.62) return null;
    const wx = (i + 0.15 + 0.7 * r()) * COWCELL;
    const z = r() < 0.5 ? 1 : r() < 0.6 ? 2 : 0;
    const zn = zoneAt(W, wx, z) || zoneAt(W, wx, 2);
    const d = zn[0] + (zn[1] - zn[0]) * (0.2 + 0.6 * r());
    if (siteNear(W, wx, d, 6)) return null;
    const n = 4 + Math.floor(r() * 7), list = [];
    const breed = Math.floor(r() * COATS.length);
    for (let k = 0; k < n; k++) {
      const ax = wx + (r() - 0.5) * 9 * Math.sqrt(n), ad = d + (r() - 0.5) * Math.min(zn[1] - zn[0], 6 * Math.sqrt(n));
      const lying = r() < 0.18, calf = r() < 0.15;
      list.push({ wx: ax, d: ad, yaw: (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 1.4, graze: r() < 0.6, lying, calf, coat: r() < 0.75 ? breed : Math.floor(r() * COATS.length), ph: r(), seed: hashInts(W.ws, 592, i, k) });
    }
    return { i, wx, d, list };
  });
}
// Where a flock of goats, a colony of marmots or a hayfield with its racks and its mowers is (the
// middle of it; the animals and people are placed round it when they are drawn).
function spot(W, type, salt, cell, p, i, pick) {
  return cache(W, type, i, () => {
    const r = makeRng(hashInts(W.ws, salt, i));
    if (r() > p) return null;
    const wx = (i + r()) * cell;
    const d = pick(wx, r);
    return d == null ? null : { i, wx, d };
  });
}
const goatSpot = (W, i) => spot(W, ST.GOAT, 621, GOATCELL, 0.45, i, (wx, r) => { const zn = zoneAt(W, wx, r() < 0.6 ? 1 : 2) || zoneAt(W, wx, 2); return zn[0] + (zn[1] - zn[0]) * r(); });
const marmotSpot = (W, i) => spot(W, ST.MARMOT, 641, MARCELL, 0.55, i, (wx, r) => { const zn = zoneAt(W, wx, r() < 0.45 ? 0 : 1) || zoneAt(W, wx, 1) || zoneAt(W, wx, 2); return Math.max(zn[0], Math.min(zn[1], 26) + Math.min(14, zn[1] - zn[0]) * r() * 0.6); });
const haySpot = (W, i) => spot(W, ST.HAY, 681, HAYCELL, 0.55, i, (wx, r) => { const zn = zoneAt(W, wx, r() < 0.55 ? 1 : 2) || zoneAt(W, wx, 2); const d = zn[0] + 3 + (Math.min(zn[1], zn[0] + 50) - zn[0] - 3) * r(); return siteNear(W, wx, d, 16) ? null : d; });
// The patches the tall flowers keep clear of, so that what stands there can be seen: where cattle
// graze, goats, marmots, and the mown ground round the hay racks. Each is { wx, d, rx (half-width
// along the line), back (how far beyond it) }; in front of it the clearing reaches as far as a tall
// plant would hide it from the window.
function clearings(ctx, W) {
  const res = [], m = 40;
  const add = (cell, fn, rx, back) => { for (let i = Math.floor((ctx.x0 - m) / cell); i <= Math.floor((ctx.x0 + ctx.length + m) / cell); i++) { const g = fn(W, i); if (g) res.push({ wx: g.wx, d: g.d, rx, back, front: clamp(g.d / 6, 4, 16) }); } };
  add(COWCELL, herd, 17, 8); add(GOATCELL, goatSpot, 10, 5); add(MARCELL, marmotSpot, 6, 3); add(HAYCELL, haySpot, 22, 8);
  return res;
}
function cleared(zones, wx, d) {
  for (const z of zones) if (Math.abs(wx - z.wx) < z.rx && d - z.d < z.back && z.d - d < z.front) return true;
  return false;
}
// May an animal or a person stand here? Not on the road, in the river, on the bank or in a wood.
function openGround(W, wx, d) {
  const x = xAt(W, wx);
  if (d < bankEnd(x.fy) + 1 || Math.abs(d - x.rd) < 4.5 || Math.abs(d - x.rc) < x.rw * 0.5 + 2.5) return false;
  return !isForest(W, wx, d);
}

// --- forest: a field of world noise, thick on the lower slopes, thinning to the tree line ---
function treeLine(W, wx, d) { return 590 + 130 * noise2(wx / 1900, d / 1900, W.ws + 404); }
// > 0 in forest. alt = height above the valley floor.
function forestF(W, wx, d, alt, ft) {
  const v = 0.7 * noise2(wx / 520, d / 430, W.ws + 401) + 0.3 * noise2(wx / 120, d / 100, W.ws + 402);
  const s = d - ft;
  // copses on the floor (never close to the line), the belt on the slopes, nothing above the tree line
  const thr = s < 0 ? 0.66 + 0.4 * smooth(170, 110, d) : 0.66 - 0.36 * smooth(0, 260, s);
  return v - thr - 1.2 * smooth(-140, 60, alt - treeLine(W, wx, d));
}

// ---------------------------------------------------------------------------------------------
// The meadows: what kind of field a point lies in, and which flowers grow in its patch
// ---------------------------------------------------------------------------------------------
const FK = { HAY: 0, PASTURE: 1, MOWN: 2 };
// Fields: warped cells about 120 m x 80 m, each hay meadow, pasture or mown.
function fieldAt(W, wx, d, n1, n2) {
  // (n1, n2: the patch's own warp noise, 0..1, reused here to rag the field's edges)
  const u = wx / 120 + 0.22 * n1, v = d / 80 + 0.26 * n2;
  const h = hashInts(W.ws, 313, Math.floor(u), Math.floor(v)) >>> 0;
  const k = h % 100;
  return k < 56 ? FK.HAY : k < 86 ? FK.PASTURE : FK.MOWN;
}
function mixOf(W, i) {
  return cache(W, ST.MIX, i, () => {
    const h = hashInts(W.ws, 321, i) >>> 0;
    return FMIX[h % FMIX.length];
  });
}
// The patch a point lies in: PT.a and PT.b are its two kinds of flower, PT.da and PT.db how thickly
// each grows (0..1, the share of the ground it colours), PT.k the kind of field, PT.tall how much
// taller than usual it grows (the uncut strips: field borders, river banks, the road's verges).
const PT = { a: 0, b: 0, da: 0, db: 0, k: 0, tall: 1 };
function patchAt(W, wx, d, wet) {
  const ws = W.ws;
  // drifts: irregular patches about 14 m x 9 m; further off, the wide drifts that show from afar
  const wide = smooth(110, 300, d);
  const n1 = noise2(wx / 33, d / 21, ws + 301), n2 = noise2(wx / 29, d / 17, ws + 302);
  const pu = wx / 14 + 1.5 * n1, pv = d / 9 + 1.5 * n2;
  let h = hashInts(ws, 303, Math.floor(pu), Math.floor(pv)) >>> 0;
  if (wide > 0 && (h & 255) < wide * 200) {
    const qu = wx / 85 + 1.2 * noise2(wx / 140, d / 90, ws + 305), qv = d / 46 + 1.2 * noise2(wx / 120, d / 70, ws + 306);
    h = hashInts(ws, 307, Math.floor(qu), Math.floor(qv)) >>> 0;
  }
  const x = xAt(W, wx);
  // the mix changes along the journey, with a ragged border between one stretch and the next; up
  // the valley side it gives way to the alpine turf (alpenrose, gentian, edelweiss)
  const mi = Math.floor(wx / 640 + (n1 - 0.5) * 0.12 + (n2 - 0.5) * 0.1);
  const up = d > x.ft ? smooth(x.ft, x.ft + 380, d) : 0;
  const mix = wet ? FMIX[6] : up > 0 && ((h >>> 4) & 255) < up * 230 ? FMIX[5] : mixOf(W, mi);
  PT.a = mix[(h >>> 8) % mix.length]; PT.b = mix[(h >>> 12) % mix.length];
  let k = fieldAt(W, wx, d, n1, n2);
  // the uncut strips: a few metres along the borders of the fields, the banks of the river and
  // the verges of the road, left to flower tall
  const fu = wx / 120 + 0.22 * n1, fv = d / 80 + 0.26 * n2;
  const eu = Math.min(fu - Math.floor(fu), Math.ceil(fu) - fu) * 120, ev = Math.min(fv - Math.floor(fv), Math.ceil(fv) - fv) * 80;
  let e = d < x.ft ? Math.max(smooth(4.5, 1.5, eu), smooth(3.5, 1.2, ev)) : 0;
  const ar = Math.abs(d - x.rc) - x.rw * 0.5;
  if (ar > 0 && ar < 12) e = Math.max(e, smooth(12, 5, ar));
  const av = Math.abs(d - x.rd);
  if (av > 4 && av < 8) e = Math.max(e, 0.7 * smooth(8, 5.5, av));
  if (e > 0.5) k = FK.HAY;
  PT.k = k;
  PT.tall = 1 + 0.35 * e;
  // how much blooms: rich and poor zones, and less where the cows graze or the hay is cut
  const bloom = (0.55 + 0.9 * noise2(wx / 150, d / 100, ws + 308)) * (1 - 0.45 * smooth(90, 260, d));
  const kk = Math.max(k === FK.HAY ? 1 : k === FK.PASTURE ? 0.42 : 0.12, 1.25 * e);
  PT.da = clamp((0.22 + 0.34 * ((h >>> 16) & 255) / 255) * bloom * kk, 0, 0.6);
  PT.db = clamp((0.07 + 0.16 * ((h >>> 24) & 255) / 255) * bloom * kk, 0, 0.26);
  return PT;
}

// ---------------------------------------------------------------------------------------------
// What covers the ground at a world point, and its colour. Returns a reused object: never hold it
// across a yield.
// ---------------------------------------------------------------------------------------------
const T = { BANK: 0, MEADOW: 1, RIVER: 2, GRAVEL: 3, RBANK: 4, ROAD: 5, FOREST: 6, ROCK: 7, SCREE: 8, TURF: 9, SNOW: 10, ICE: 11, BALLAST: 12 };
const PA = { t: 0, c: [0, 0, 0], fl: -1, f: 0, alt: 0 };
function setc(c, a) { c[0] = a[0]; c[1] = a[1]; c[2] = a[2]; }
function mixc(c, a, b, t) { c[0] = a[0] + (b[0] - a[0]) * t; c[1] = a[1] + (b[1] - a[1]) * t; c[2] = a[2] + (b[2] - a[2]) * t; }
function mulc(c, k) { c[0] *= k; c[1] *= k; c[2] *= k; }
// Grass: lush and yellow-green by turns, lighter where the hay has been cut.
function grassColor(W, wx, d, c, k) {
  const ws = W.ws;
  const a = noise2(wx / 60, d / 40, ws + 331), b = noise2(wx / 7, d / 5, ws + 332);
  mixc(c, C.grassLush, C.grassPale, clamp(a * 0.75 + b * 0.35, 0, 1));
  if (k === FK.MOWN) {
    // swathes: pale stubble and darker lines where the cut grass lies, running along the field
    const sw = Math.sin((d + 6 * noise2(wx / 40, d / 40, ws + 333)) * 1.3);
    mixc(c, sw > 0.3 ? C.mown : C.mownDark, c, 0.25);
  } else if (k === FK.PASTURE) mixc(c, c, C.pasture, 0.5);
}
// rel: the band's splat count against its count at 600k: with fewer plants standing on it, the
// ground keeps more of their colour.
function paint(W, wx, d, y, nx, ny, nz, rng, rel = 1) {
  const P = PA, c = P.c, ws = W.ws;
  const x = xAt(W, wx);
  P.fl = -1; P.f = 0;
  const alt = y - x.fy;
  P.alt = alt;
  if (d < x.ft + 30 && alt < 30) {
    // --- the valley floor ---
    if (d < 4.4) { P.t = T.BALLAST; setc(c, C.ballast); mulc(c, 0.75 + 0.5 * rng()); return P; }
    const ad = Math.abs(d - x.rc), hw = x.rw * 0.5;
    if (ad < hw + 6) {
      if (ad < hw) {
        // gravel bars along the inner edges in places, and islands where the river braids
        const u = (d - (x.rc - hw)) / x.rw;                               // 0 near bank .. 1 far bank
        const gn = 0.34 * smooth(0.5, 0.8, noise1(wx / 150, ws + 606)), gf = 0.3 * smooth(0.55, 0.85, noise1(wx / 130, ws + 607));
        const isle = noise2(wx / 38, u * 3.1, ws + 608) > 0.74 && u > 0.2 && u < 0.8;
        if (u < gn || 1 - u < gf || isle) {
          P.t = T.GRAVEL;
          mixc(c, C.gravel, C.gravelDark, noise2(wx / 3, d / 2, ws + 609));
          mulc(c, 0.9 + 0.2 * rng());
          return P;
        }
        P.t = T.RIVER;
        // milky turquoise, paler in the shallows at the edges and over the riffles, streaked along the flow
        const e = Math.min(u - gn, 1 - gf - u);
        mixc(c, C.river, C.riverDeep, 0.6 * smooth(0.02, 0.3, e) * noise2(wx / 30, u * 2, ws + 610));
        const riff = noise2(wx / 9 - u * 2, u * 7, ws + 612);
        mixc(c, c, C.riverPale, 0.8 * smooth(0.12, 0.0, e) + 0.5 * smooth(0.6, 0.85, riff));
        if (riff > 0.86) mixc(c, c, C.foam, 0.7);
        mulc(c, 0.97 + 0.06 * rng());
        return P;
      }
      P.t = T.RBANK;
      mixc(c, C.gravelDark, C.grassLush, smooth(0, 6, ad - hw) * 0.7 + 0.3 * rng());
      return P;
    }
    const ar = Math.abs(d - x.rd);
    if (ar < 4.2 && d > 30) {
      P.t = T.ROAD;
      if (ar < 2.9) { setc(c, C.road); mulc(c, 0.94 + 0.12 * rng()); if (ar < 0.16 && Math.sin(wx * 0.5) > 0) mixc(c, c, C.roadEdge, 0.8); }
      else { mixc(c, C.roadEdge, C.grassPale, smooth(2.9, 4.2, ar)); mulc(c, 0.9 + 0.2 * rng()); }
      return P;
    }
    if (d > 30 && pathOn(x) && Math.abs(d - pathD(x)) < 0.9 + 0.002 * d) { P.t = T.ROAD; setc(c, C.path); mulc(c, 0.88 + 0.24 * rng()); return P; }
    if (x.nb > 0 && d > 30) {
      if (d > x.rc) {
        const bk = brookAt(W, wx, d);
        if (bk) { P.t = T.RIVER; mixc(c, C.riverPale, C.foam, 0.5 * rng()); return P; }
      }
      const ho = hairpinOff(W, wx, d);
      if (ho < 4.2 && Math.abs(d - x.rc) > x.rw * 0.5) { P.t = T.ROAD; if (ho < 3) { setc(c, ROADPALE); mulc(c, 0.92 + 0.14 * rng()); } else { mixc(c, ROADPALE, C.grassPale, 0.6); mulc(c, 0.9 + 0.2 * rng()); } return P; }
    }
    const bEnd = bankEnd(x.fy);
    if (x.hs > 0.5 && d < 14) { P.t = T.BANK; setc(c, [0.5, 0.48, 0.44]); mulc(c, 0.85 + 0.3 * rng()); return P; }
    if (d < bEnd * 0.42) {
      // the cess and the top of the bank: gravel going over to rough grass
      P.t = T.BANK;
      mixc(c, C.cess, C.grassDry, smooth(4.4, bEnd * 0.42, d));
      mulc(c, 0.85 + 0.3 * rng());
      return P;
    }
  }
  const slope = 1 - ny;
  const s = d - x.ft;
  // --- rock, snow and ice: the steep and the high ---
  if (s > 0) {
    const sv = alt > 250 ? sideAt(W, wx, d) : null;
    const gl = sv && sv.g && sv.g.glacier && d > sv.g.snout ? sv.f * smooth(sv.g.snout, sv.g.snout + 260, d) : 0;
    if (gl > 0.5) {
      // the glacier: blue-white ice crossed by crevasses, grey moraine along its edges
      P.t = T.ICE;
      const cre = Math.sin(d / 13 + 5 * noise2(wx / 130, d / 260, ws + 721) + sv.u * sv.u * 5);
      snowTone(nx, ny, nz, c);
      mixc(c, c, C.ice, 0.45);
      if (cre > 0.72) mixc(c, c, C.iceBlue, 0.75);
      if (gl < 0.72 || Math.abs(Math.abs(sv.u) - 0.3) < 0.035) mixc(c, c, C.moraine, 0.7);
      return P;
    }
    const high = alt > 640;
    const snowLine = high ? 1150 + 260 * noise2(wx / 1700, d / 1500, ws + 81) + 110 * (noise2(wx / 170, d / 170, ws + 82) - 0.5) : 1150;
    const coul = alt > 400 ? noise2(wx / 190, d / 1900, ws + 54) : 0.5;                 // the couloirs hold the snow
    const over = high ? (alt - snowLine) / 520 + 0.5 * (0.5 - coul) + (gl > 0 ? 0.4 : 0) : -1;
    const rocky = slope > 0.26 - 0.1 * smooth(300, 900, alt) + (alt < 260 ? 0.06 : 0);
    const rib = over > 0 ? noise2(wx / 230, d / 800, ws + 92) : 0;     // ribs of rock standing out of the snow
    if (over > 0 && slope < 0.11 + 0.13 * clamp(over, 0, 1.3) - 0.1 * smooth(0.55, 0.8, rib)) {
      P.t = T.SNOW;
      snowTone(nx, ny, nz, c);
      if (slope > 0.22) mulc(c, 0.93 + 0.07 * noise2(wx / 14, y / 30, ws + 83));    // wind-scoured
      return P;
    }
    if (rocky) {
      // banded limestone: pale and dark beds lying nearly level, warm where it weathers, wet
      // streaks down the faces; above the snow line the ledges carry snow
      P.t = T.ROCK;
      const bed = y / Math.max(17, d * 0.011) + 2.2 * noise2(wx / 420, d / 420, ws + 84) + 0.3 * noise2(wx / 40, y / 40, ws + 85);
      const fb = bed - Math.floor(bed);
      const butt = noise2(wx / Math.max(46, d * 0.03), y / 220, ws + 91);            // buttresses and the clefts between
      mixc(c, C.rock, C.rockDark, 0.5 * smooth(0.5, 0.2, fb) + 0.55 * smooth(0.6, 0.3, butt));
      mixc(c, c, C.rockWarm, 0.6 * smooth(0.45, 0.75, noise2(wx / 300, d / 300, ws + 86)));
      const streak = noise2(wx / Math.max(9, d * 0.012), d / 300, ws + 87);
      if (streak > 0.7) mulc(c, 0.66);                                                // dark wet streaks down the face
      // ledges low on the cliffs carry grass and bushes
      if (alt < 520 && fb > 0.9 && noise2(wx / 30, y / 9, ws + 93) > 0.4) mixc(c, C.grassLush, C.spruce, rng());
      const l = Math.max(0, nx * SX + ny * SY + nz * SZ);
      mulc(c, 0.5 + 0.75 * l);
      if (over > -0.5 && fb > 0.86 && slope < 0.7) snowTone(nx * 0.4, 0.9, nz * 0.4, c);
      return P;
    }
    if (alt > treeLine(W, wx, d) + 140 * (coul - 0.2)) {
      const sc = noise2(wx / 120, d / 240, ws + 88) + 0.4 * smooth(0, 420, alt - treeLine(W, wx, d));
      if (sc > 0.72) {
        // scree fans below the faces
        P.t = T.SCREE;
        mixc(c, C.scree, C.rockDark, 0.35 * noise2(wx / 25, d / 60, ws + 89));
        mulc(c, 0.62 + 0.5 * Math.max(0, nx * SX + ny * SY + nz * SZ));
        return P;
      }
      // alpine turf: thin, yellow-green, going brown and stony with height; flowers in mats
      P.t = T.TURF;
      mixc(c, C.turf, C.turfHigh, smooth(0, 380, alt - treeLine(W, wx, d)));
      const pt = patchAt(W, wx, d, false);
      const u = rng();
      if (d < 1700 && u < pt.da * 0.5) { mixc(c, FL[FMIX[5][pt.a % 6]].c, c, 0.3); P.fl = FMIX[5][pt.a % 6]; }
      else mulc(c, 0.86 + 0.28 * noise2(wx / 60, d / 90, ws + 90));
      mulc(c, 0.7 + 0.42 * Math.max(0, nx * SX + ny * SY + nz * SZ));
      return P;
    }
  }
  if (x.nb > 0 && s > 0 && s < 480 && alt < 200) {
    const bk = brookAt(W, wx, d);
    if (bk) { P.t = T.RIVER; mixc(c, C.riverPale, C.foam, 0.5 * rng()); return P; }
  }
  const nb = x.nb;
  // --- forest ---
  if (d > 100) {
    const f = forestF(W, wx, d, alt, x.ft);
    P.f = f;
    if (f > 0 && slope < 0.3) {
      // (the branch road and the cable car run in cleared strips)
      if (nb > 0 && (hairpinClear(W, wx, d) || cableClear(W, wx, d))) P.f = -1;
      else { P.t = T.FOREST; setc(c, C.floor); return P; }
    }
  }
  // --- meadow: grass or a flower, by the patch ---
  P.t = T.MEADOW;
  const wet = d < x.ft && Math.abs(d - x.rc) < x.rw * 0.5 + 16;
  const pt = patchAt(W, wx, d, wet);
  const u = rng();
  if (u < pt.da + pt.db) {
    // a flower's colour, with a little of the grass it stands in (more where one splat is a square metre)
    const fi = u < pt.da ? pt.a : pt.b;
    P.fl = fi;
    grassColor(W, wx, d, c, pt.k);
    // (out to a few hundred metres, where the plants themselves stand on it, the ground only takes
    // their tint: the colour is carried by the flowers, in 3D)
    mixc(c, FL[fi].c, c, 0.32 + 0.43 * smooth(330, 140, d) * clamp(1.8 * rel - 0.8, 0.25, 1));
    mulc(c, 0.8 + 0.3 * rng());
  } else {
    grassColor(W, wx, d, c, pt.k);
    if (P.f > -0.06) mulc(c, 1 - 0.3 * smooth(-0.06, 0, P.f));         // the shade at a wood's edge
    mulc(c, 0.9 + 0.2 * rng());
  }
  if (s > 0) mulc(c, 0.78 + 0.34 * Math.max(0, nx * SX + ny * SY + nz * SZ));
  return P;
}

// ---------------------------------------------------------------------------------------------
// The ground fill. The splats are spread by how much of the window each part of the band fills
// (after himalaya.js): per strip of the chunk, a table of distance bins weighted by the angle the
// ground climbs through in each, seen from the window, with a floor so no part is left thin. A
// slope or a cliff facing the line gets most of them; ground hidden behind nearer ground (occl) gets
// few. One splat per sample, lying in the surface, so the band is covered and the count lands.
// ---------------------------------------------------------------------------------------------
const TAN_TOP = 0.6, TAN_BOT = -0.62;
const QG = [0, 0, 0, 1];
function* fillView(ctx, out, W, opts = {}) {
  out.limit = Infinity;
  const n = Math.floor(opts.n != null ? opts.n : out.left());
  if (n <= 0) return;
  const rng = ctx.rng, L = ctx.length;
  const dn = opts.dNear != null ? opts.dNear : ctx.zNear, df = opts.dFar != null ? opts.dFar : ctx.zFar;
  const NS = opts.strips || 6, NB = 40, cover = opts.cover || 3.2;
  const minR = opts.minR || 0.0015, maxR = opts.maxR || 0.04, floorK = opts.floor != null ? opts.floor : 0.4;
  const rel = relCount(ctx);
  const db = new Float64Array(NB + 1);
  for (let b = 0; b <= NB; b++) db[b] = dn * Math.pow(df / dn, b / NB);
  const SL = L / NS;
  const tabs = [], tot = new Float64Array(NS);
  let all = 0;
  for (let k = 0; k < NS; k++) {
    const w = new Float64Array(NB);
    for (const fx of [0.25, 0.75]) {
      const wx = ctx.x0 + (k + fx) * SL;
      let e0 = clamp((W.H(wx, db[0]) - CAMY) / db[0], TAN_BOT, TAN_TOP);
      // (occl: what nearer bands already hide along this column, a little relaxed since the train
      // sees past a spur obliquely)
      let emax = opts.occl ? opts.occl(wx) : -9;
      for (let b = 0; b < NB; b++) {
        const e1 = clamp((W.H(wx, db[b + 1]) - CAMY) / db[b + 1], TAN_BOT, TAN_TOP);
        const lo = Math.max(e0, emax);
        if (e1 > lo) w[b] += (e1 - lo) * 2 / (db[b] + db[b + 1]);
        if (opts.occl && e1 > emax) emax = e1 - 0.02;
        e0 = e1;
      }
    }
    let sum = 0;
    for (let b = 0; b < NB; b++) sum += w[b];
    const fl = (floorK * sum) / NB + 1e-12;
    sum = 0;
    for (let b = 0; b < NB; b++) { w[b] = Math.max(w[b], fl); sum += w[b]; }
    tabs.push(w); tot[k] = sum; all += sum;
  }
  let all2 = 0;
  for (let k = 0; k < NS; k++) { tot[k] = Math.max(tot[k], 0.35 * all / NS); all2 += tot[k]; }
  let done = 0;
  const far = !!opts.far;
  for (let k = 0; k < NS; k++) {
    const nk = k === NS - 1 ? n - done : Math.round((n * tot[k]) / all2);
    done += nk;
    if (nk <= 0) continue;
    const w = tabs[k];
    let sw = 0;
    for (let b = 0; b < NB; b++) sw += w[b];
    let b = 0, acc = w[0] / sw;
    for (let i = 0; i < nk; i++) {
      const u = (i + rng()) / nk;
      while (u > acc && b < NB - 1) { b++; acc += w[b] / sw; }
      const d = db[b] + rng() * (db[b + 1] - db[b]);
      const x = (k + rng()) * SL, wx = ctx.x0 + x;
      const dens = (nk * (w[b] / sw)) / ((db[b + 1] - db[b]) * SL);
      let r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
      const e = Math.max(0.6, r * 0.7);
      const yx = W.H(wx + e, d), yd = W.H(wx, d + e), y = W.H(wx, d);
      const hx = (yx - y) / e, hd = (yd - y) / e;
      const il = 1 / Math.hypot(hx, 1, hd);
      const nx = -hx * il, ny = il, nz = hd * il;
      const p = paint(W, wx, d, y, nx, ny, nz, rng, rel);
      const c = p.c, t = p.t;
      if (t === T.RIVER) {
        out(x, y + 0.02, -d, r * 1.5, r * 0.05, r * 0.75, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      } else if (t === T.FOREST) {
        emitForest(out, W, x, wx, y, d, r, p.f, rng, far);
      } else {
        // the disc lies in the slope, stretched down the fall line where it is steep (a face shows
        // far more of itself than its plan area)
        const ph = Math.atan2(nx, nz) * 0.5, cy = Math.cos(ph), sy = Math.sin(ph);
        const qw = 1 + ny, ql = Math.hypot(nz, nx, qw), ux = nz / ql, uz = -nx / ql, uw = qw / ql;
        QG[0] = ux * cy - uz * sy; QG[1] = uw * sy; QG[2] = uz * cy + ux * sy; QG[3] = uw * cy;
        let el = clamp(1 / ny, 1, opts.far2 ? 1.7 : 6), ew = 1;
        const a = 0.85 + 0.3 * rng();
        if (opts.far2) {
          // near a crest a disc lying in the face would stand up into the sky: there it is kept small
          if (el > 1.15) { const yUp = W.H(wx, d + r * 1.3); if (yUp < y + r * 0.25) { r *= 0.6; el = 1; } }
        } else if (el > 1.5) { ew = Math.pow(el, 0.3); el = Math.pow(el, 0.7); }
        let lift = 0.03, thick = 0.12;
        if (p.fl >= 0 && d < 260) { lift = 0.12 + 0.3 * rng() * smooth(260, 60, d); thick = 0.3; } else if (t === T.MEADOW && d < 90) { thick = 0.22; lift = 0.05 + r * 0.2 * rng(); }
        out(x, y + lift, -d, r * a * ew, r * thick, r * (2 - a) * el, c[0], c[1], c[2], 1, QG[0], QG[1], QG[2], QG[3], KIND.GROUND);
      }
      if (out.due()) yield;
    }
  }
}
// One ground sample in forest: nearby, a dark splat somewhere between the floor and the canopy
// (the trees at the wood's edge are drawn one by one in front of it); far off, where a splat is the
// size of a tree, either the dark floor or a spire standing on it: spruce dark, larch lighter,
// the sunward side lit.
function emitForest(out, W, x, wx, y, d, r, f, rng, far) {
  const u = rng();
  const larch = noise2(wx / 260, d / 260, W.ws + 405) + 0.3 * (rng() - 0.5) > 0.62;
  const H = (far ? 26 : 17 + 9 * noise2(wx / 200, d / 200, W.ws + 403)) * smooth(0, 0.07, f + 0.02);
  if (!far) {
    // (dark: the trees drawn one by one in front of it and through it carry the light)
    const v = Math.pow(u, 0.7);
    const k = (0.6 + 0.7 * v) * (0.8 + 0.4 * rng());
    const w = Math.max(r * 1.2, 1.7);
    out(x, y + H * (0.06 + 0.62 * v), -d, w, Math.max(w, H * 0.1), w, C.mass[0] * k, C.mass[1] * k, C.mass[2] * k, 1, 0, 0, 0, 1, KIND.HEDGE);
    void larch;
    return;
  }
  if (u < 0.22) {
    const k = 0.8 + 0.4 * rng();
    out(x, y + 1, -d, r * 1.1, r * 0.3, r * 1.3, C.floor[0] * k, C.floor[1] * k, C.floor[2] * k, 1, 0, 0, 0, 1, KIND.GROUND);
    return;
  }
  const base = larch ? C.larch : C.spruce, tip = larch ? C.larchTip : C.spruceTip;
  const hh = Math.max(H, r * 1.6) * (0.8 + 0.4 * rng());
  if (u < 0.62) {
    // the dark body of a tree
    const k = 0.6 + 0.6 * rng(), w = Math.max(r * 0.8, hh * 0.2);
    out(x, y + hh * 0.3, -d, w, hh * 0.36, w, base[0] * k, base[1] * k, base[2] * k, 1, 0, 0, 0, 1, KIND.HEDGE);
  } else {
    // a top: narrower, pointed, catching a little light (never a thin bright streak)
    const k = 0.55 + 0.5 * rng(), w = Math.max(r * 0.5, hh * 0.14);
    out(x, y + hh * 0.62, -d, w, hh * 0.27, w, tip[0] * k, tip[1] * k, tip[2] * k, 1, 0, 0, 0, 1, KIND.HEDGE);
  }
}

// The trackside's ground: plain samples by plan area (the band lies below the window).
function* fillPlain(ctx, out, W, opts = {}) {
  out.limit = Infinity;
  const n = Math.floor(opts.n != null ? opts.n : out.left());
  if (n <= 0) return;
  const rng = ctx.rng;
  const dn = opts.dNear != null ? opts.dNear : ctx.zNear, df = opts.dFar != null ? opts.dFar : ctx.zFar;
  const L = ctx.length;
  const p = opts.power != null ? opts.power : 1.5, cover = opts.cover || 3;
  const minR = opts.minR || 0.0015, maxR = opts.maxR || 0.08;
  const rel = relCount(ctx);
  const a1 = 1 - p;
  const A = Math.pow(dn, a1), Bq = Math.pow(df, a1), Z = (Bq - A) / a1;
  for (let i = 0; i < n; i++) {
    const d = Math.pow(A + ((i + rng()) / n) * (Bq - A), 1 / a1);
    const x = rng() * L, wx = ctx.x0 + x;
    const dens = (n * Math.pow(d, -p) / Z) / L;
    const r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
    const e = Math.max(0.5, r);
    const yx = W.H(wx + e, d), yd = W.H(wx, d + e), y = W.H(wx, d);
    const hx = (yx - y) / e, hd = (yd - y) / e;
    const il = 1 / Math.hypot(hx, 1, hd);
    const nx = -hx * il, ny = il, nz = hd * il;
    const pp = paint(W, wx, d, y, nx, ny, nz, rng, rel);
    const c = pp.c;
    const nzc = nz < 0 ? 0 : nz, qw = 1 + ny, ql = Math.hypot(nzc, nx, qw);
    const ax = 0.8 + 0.5 * rng();
    const tall = pp.t === T.MEADOW || pp.t === T.BANK ? 1 : 0;
    const away = nz < 0 ? Math.min(0.5, -nz * 1.6) : 0;
    out(x, y + 0.03 + tall * r * 0.5 * rng(), -d, r * ax, r * (0.12 + 0.3 * tall + away), r * (1.8 - ax), c[0], c[1], c[2], 1, nzc / ql, 0, -nx / ql, qw / ql, KIND.GROUND);
    if (out.due()) yield;
  }
}
function* fillStrip(ctx, out, W, n, dn, df, color, lift = 0, round = 0.12) {
  const rng = ctx.rng;
  const area = ctx.length * (df - dn);
  const r = Math.sqrt((4 * area) / (Math.PI * Math.max(1, n)));
  for (let i = 0; i < n; i++) {
    const x = rng() * ctx.length, d = dn + rng() * (df - dn);
    const c = color(ctx.x0 + x, d, rng);
    const y = W.H(ctx.x0 + x, d);
    out(x, y + lift * rng() + 0.02, -d, r * (0.8 + 0.5 * rng()), r * round, r * 0.6, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// The meadow in 3D: plants standing in the grass, drawn one by one near the line, in clumps
// further out, and as drifts (a tussock with heads of bloom on its top) in the middle distance.
// Everything is sized from distance so that a head is never under about a pixel and a half across
// (r >= HEADPX * d), and drawn larger than life near the line (K) so that its form reads.
//   lod 0 (out to LOD0 m): the full form of the kind: rays round an eye, cups, bells, spires of
//         florets, umbels on their rays, thistles, trumpets, clover heads, with grass blades round them
//   lod 1 (to the drift line): a stem and one or two head splats, in clumps of a few
//   drift (beyond it): see drift()
// ---------------------------------------------------------------------------------------------
const HEADPX = 0.00072;          // a head's radius per metre of distance: 1.65 px across at 1080p
const LOD0 = 34;
// The band's splat count against what it gets at a 600k budget (the meadow is tuned there).
const REF = { trackside: 28074, near: 64728, mid: 35056, far: 1e9 };
function relCount(ctx) { return clamp(ctx.count / (REF[ctx.layer] || ctx.count), 0.3, 2); }
const LEAF = [0.16, 0.34, 0.1], LEAF_DARK = [0.1, 0.24, 0.08], SEED = [0.6, 0.56, 0.36];
const BUSH = [0.09, 0.2, 0.09], BRACT = [0.24, 0.36, 0.14], BUD = [0.3, 0.42, 0.16], TUFT = [0.4, 0.46, 0.2];
// (these run for every splat of the meadow: nothing in them allocates)
// A splat whose long axis runs along (ux, uy, uz) (any length): petals, blades, rays, leaves, stems.
function dirSplat(out, x, y, z, a, b, c, ux, uy, uz, col, k, move = 0) {
  const il = 1 / (Math.hypot(ux, uy, uz) || 1);
  ux *= il; uy *= il; uz *= il;
  if (ux < 0) { ux = -ux; uy = -uy; uz = -uz; }
  const w = 1 + ux, l = Math.hypot(uz, uy, w);
  out(x, y, z, a, b, c, col[0] * k, col[1] * k, col[2] * k, 1, 0, -uz / l, uy / l, w / l, KIND.OTHER, move);
}
// A stem from (ax, ay, az) to (bx, by, bz), r thick: one long splat.
function stem(out, ax, ay, az, bx, by, bz, r, col = GRASS_STEM) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
  dirSplat(out, (ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5, Math.max(len * 0.5, r), r, r, dx, dy, dz, col, 1);
}
function ball(out, x, y, z, rx, ry, rz, col, k, move = 0) { out(x, y, z, rx, ry, rz, col[0] * k, col[1] * k, col[2] * k, 1, 0, 0, 0, 1, KIND.OTHER, move); }
const LC = [0, 0, 0], GC3 = [0, 0, 0];
function lit(c, f) { LC[0] = Math.min(0.8, c[0] * f); LC[1] = Math.min(0.8, c[1] * f); LC[2] = Math.min(0.8, c[2] * f); return LC; }
// A ring of n petals of half-length pl round (cx, cy, cz), in a plane tipped t radians from level
// toward the window (so a head faces up and toward the train, and still shows as an ellipse from the side).
function rays(out, cx, cy, cz, n, rr, pl, pw, t, col, k, rng, move = 0) {
  const ct = Math.cos(t), st = Math.sin(t), a0 = rng() * 6.28;
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * 6.283, ca = Math.cos(a), sa = Math.sin(a);
    const ux = ca, uy = sa * st, uz = sa * ct;          // (the plane: x, and up-and-toward-the-window)
    dirSplat(out, cx + ux * rr, cy + uy * rr, cz + uz * rr, pl, pw, pw * 0.35, ux, uy, uz, col, k * (0.92 + 0.16 * rng()), move);
  }
}
// One plant of kind F standing at (x, y0, z) (splat space), d metres out. K: times life size for
// the head, Kh for the height. tall: > 1 in the uncut strips.
function plant(out, F, x, y0, z, d, K, Kh, rng, lod, tall) {
  const c = F.c, kc = 0.86 + 0.22 * rng(), hm = chorus(F.g);   // (hm: the heads answer the beat with their colour)
  const h = F.h * Kh * tall * (0.75 + 0.5 * rng());
  const r = Math.max(F.r * K * (0.85 + 0.3 * rng()), HEADPX * d);
  const sr = Math.max(0.011 * K, 0.00045 * d);
  const lx = (rng() - 0.5) * 0.22 * h, lz = (rng() - 0.5) * 0.12 * h;
  const tx = x + lx, ty = y0 + h, tz = z + lz;
  const form = F.form;
  if (form === 'bush') {
    // alpenrose: a low dark-leaved bush covered in clusters of bloom
    // (a dome: seen from the train's height the top shows as much as the front, so the bloom is
    // spread over the whole upper surface, leaves showing dark between)
    const bw = r * (1.0 + 0.6 * rng()), bh = Math.max(h * 0.75, bw * 0.9);
    ball(out, x, y0 + bh * 0.42, z, bw, bh * 0.5, bw * 0.85, BUSH, 0.75 + 0.3 * rng());
    const nb = lod ? 5 : 11;
    for (let b = 0; b < nb; b++) {
      const a = rng() * 6.283, p = 0.25 + 1.1 * rng(), sp_ = Math.sin(p);
      ball(out, x + Math.cos(a) * sp_ * bw * 0.85, y0 + bh * (0.42 + 0.5 * Math.cos(p)), z + Math.sin(a) * sp_ * bw * 0.75, bw * 0.2, bw * 0.17, bw * 0.2, b & 1 ? c : lit(c, 1.15), kc, hm);
    }
    return;
  }
  if (form === 'cushion') {
    // a low mat of small flowers (forget-me-not, edelweiss), its leaves showing between
    const n = lod ? 3 : 6;
    if (!lod) ball(out, x, y0 + h * 0.4, z, r * 3.2, h * 0.4, r * 2.4, LEAF_DARK, 0.9 + 0.2 * rng());
    for (let b = 0; b < n; b++) {
      const ox = (rng() - 0.5) * r * 6, od = (rng() - 0.5) * r * 4;
      ball(out, x + ox, y0 + h * (0.75 + 0.5 * rng()), z + od, r * 1.1, r * 0.75, r * 0.9, c, kc, hm);
      if (F.eye && !lod) ball(out, x + ox, y0 + h * 0.95 + r * 0.35, z + od + r * 0.4, r * 0.32, r * 0.28, r * 0.28, F.eye, 1, hm);
    }
    return;
  }
  if (form === 'trumpet') {
    // gentian: deep blue trumpets standing straight up out of a rosette, low in the turf
    if (!lod) for (let b = 0; b < 3; b++) { const a = rng() * 6.28; dirSplat(out, x + Math.cos(a) * r, y0 + 0.03, z + Math.sin(a) * r, r * 1.2, r * 0.45, r * 0.15, Math.cos(a), 0.15, Math.sin(a), LEAF, 0.9); }
    const n = lod ? 2 : 3 + Math.floor(rng() * 3);
    for (let b = 0; b < n; b++) {
      const ox = (rng() - 0.5) * r * 3.5, od = (rng() - 0.5) * r * 2.5, hh = h * (0.7 + 0.5 * rng());
      ball(out, x + ox, y0 + hh * 0.55, z + od, r * 0.55, hh * 0.5, r * 0.55, c, kc, hm);
      if (!lod) ball(out, x + ox, y0 + hh * 0.98, z + od + r * 0.15, r * 0.6, r * 0.25, r * 0.6, F.eye || lit(c, 1.5), 1, hm);
    }
    return;
  }
  if (form === 'clover') {
    // a round head on a short stalk, trefoil leaves below
    if (!lod) for (let b = 0; b < 3; b++) { const a = rng() * 6.28; ball(out, x + Math.cos(a) * r * 1.3, y0 + h * 0.3, z + Math.sin(a) * r * 1.3, r * 0.8, r * 0.25, r * 0.8, LEAF, 0.85 + 0.25 * rng()); }
    stem(out, x, y0, z, tx, ty, tz, sr);
    ball(out, tx, ty, tz, r, r * 1.1, r, c, kc, hm);
    if (!lod) ball(out, tx - r * 0.2, ty + r * 0.45, tz + r * 0.3, r * 0.55, r * 0.45, r * 0.5, lit(c, 1.25), kc, hm);
    return;
  }
  if (form === 'tuft') {
    // cotton grass: white tufts nodding on fine stems
    stem(out, x, y0, z, tx, ty, tz, sr, TUFT);
    ball(out, tx, ty, tz, r * 0.9, r * 1.2, r * 0.8, c, kc, hm);
    if (!lod) { stem(out, x, y0, z, tx + h * 0.2, ty - h * 0.15, tz, sr, TUFT); ball(out, tx + h * 0.2, ty - h * 0.15, tz, r * 0.8, r, r * 0.7, c, kc, hm); }
    return;
  }
  if (form === 'spike') {
    // a spire of florets up the top of the stem: widest at the foot, narrowing to the buds
    const sub = F.sub;
    const top = sub === 'orchid' ? 0.55 : sub === 'whorl' ? 0.7 : 0.42;
    stem(out, x, y0, z, x + lx * (1 - top), y0 + h * (1 - top), z + lz * (1 - top), sr * 1.25);
    if (sub === 'orchid' && !lod) for (let s = -1; s <= 1; s += 2) dirSplat(out, x + s * r * 1.2, y0 + h * 0.12, z + r * 0.5, h * 0.18, r * 0.6, r * 0.12, s * 0.5, 1, 0.3, LEAF_DARK, 1);
    if (sub === 'whorl') {
      // yellow gentian: whorls of bloom in the axils of broad paired leaves, all the way up
      const n = lod ? 2 : 4;
      for (let b = 0; b < n; b++) {
        const t = 1 - top + top * (b + 0.5) / n, wx_ = x + lx * t, wy = y0 + h * t, wz = z + lz * t, rr = r * (1.35 - 0.5 * b / n);
        if (!lod) for (let s = -1; s <= 1; s += 2) dirSplat(out, wx_ + s * rr * 1.4, wy - rr * 0.7, wz, rr * 1.2, rr * 0.45, rr * 0.2, s, 0.35, 0.2, LEAF, 0.95);
        ball(out, wx_, wy, wz, rr * 1.15, rr * 0.7, rr * 1.05, c, kc * (b & 1 ? 1 : 1.08), hm);
      }
      return;
    }
    const n = lod ? 2 : 7;
    const seg = (h * top) / n;
    for (let b = 0; b < n; b++) {
      const t = 1 - top + top * (b + 0.5) / n, rr = r * (lod ? 1.2 - 0.5 * b : 1.15 - 0.7 * b / n);
      // (sub 'band': lupin, whorls in bands; otherwise open below, darker buds at the tip); near
      // by, the florets stand apart, left and right of the stem by turns
      const f = sub === 'band' ? (b & 1 ? 0.82 : 1.12) : 1.12 - 0.3 * b / n;
      const sx = lod ? 0 : (b & 1 ? 0.45 : -0.45) * rr;
      ball(out, x + lx * t + sx, y0 + h * t, z + lz * t, rr * (lod ? 0.72 : 0.75), lod ? Math.max(seg * 0.75, rr * 1.1) : Math.max(seg * 0.62, rr * 0.7), rr * (lod ? 0.65 : 0.75), lit(c, f), kc, hm);
    }
    return;
  }
  // the rest stand on a single stem
  stem(out, x, y0, z, tx, ty, tz, sr * (form === 'thistle' || form === 'umbel' ? 1.35 : 1));
  if (form === 'umbel') {
    // cow parsley: rays from the top of the stem to a dome of small white umbellets, a second one lower down
    const n = lod ? 2 : 5, R = r * 1.3;
    if (lod) { ball(out, tx, ty, tz, r * 1.3, r * 0.4, r * 1.1, c, kc, hm); ball(out, tx + r * 1.2, ty - h * 0.14, tz + 0.05, r * 0.75, r * 0.3, r * 0.65, c, kc * 0.92, hm); return; }
    // (umbellets small and apart, on rays from below the top, in a shallow dome: the gaps show)
    const a0 = rng() * 6.28, rs = Math.max(sr * 0.45, 0.00045 * d);
    for (let b = 0; b < n; b++) {
      const a = a0 + (b / n) * 6.28, ca = Math.cos(a), sa = Math.sin(a);
      const ex = tx + ca * R, ey = ty + r * 0.15 + r * 0.2 * (b & 1), ez = tz + sa * R * 0.8;
      stem(out, tx, ty - r * 0.9, tz, ex, ey, ez, rs);
      ball(out, ex, ey + r * 0.12, ez, r * 0.42, r * 0.22, r * 0.4, c, kc * (0.95 + 0.1 * rng()), hm);
    }
    stem(out, tx, ty - r * 0.9, tz, tx, ty + r * 0.4, tz, rs);
    ball(out, tx, ty + r * 0.5, tz, r * 0.42, r * 0.24, r * 0.4, c, kc, hm);
    return;
  }
  if (form === 'thistle') {
    // a stout stem, spiny leaves standing out from it, a purple brush over a green bract
    if (!lod) for (let s = -1; s <= 1; s += 2) dirSplat(out, x + lx * 0.4 + s * h * 0.12, y0 + h * (0.35 + 0.15 * s), z + lz * 0.4, h * 0.14, r * 0.55, r * 0.15, s, 0.45, 0.25, LEAF_DARK, 1);
    ball(out, tx, ty - r * 0.35, tz, r * 0.6, r * 0.55, r * 0.6, BRACT, 1);
    ball(out, tx, ty + r * 0.3, tz, r * 0.75, r * 0.6, r * 0.72, c, kc, hm);
    if (!lod) {
      // a second, younger head on a side branch
      const bx = tx + h * 0.2 * (rng() < 0.5 ? -1 : 1), by = ty - h * 0.2;
      stem(out, x + lx * 0.6, y0 + h * 0.6, z + lz * 0.6, bx, by, tz, sr);
      ball(out, bx, by, tz, r * 0.5, r * 0.55, r * 0.5, BRACT, 1);
      ball(out, bx, by + r * 0.35, tz, r * 0.5, r * 0.4, r * 0.5, c, kc * 0.9, hm);
    }
    return;
  }
  if (form === 'bell') {
    // harebells and bellflowers: bells hanging from the arching top of the stem
    const n = lod ? 2 : 3 + Math.floor(rng() * 2), dir = rng() < 0.5 ? -1 : 1;
    for (let b = 0; b < n; b++) {
      const t = 1 - b * 0.18, bx = x + lx * t + dir * r * (0.7 + 0.5 * b) * (b & 1 ? -1 : 1), by = y0 + h * t - r * 0.5;
      if (!lod) stem(out, x + lx * t, y0 + h * t + r * 0.1, z + lz * t, bx, by + r * 0.7, z + lz * t, sr * 0.8);
      ball(out, bx, by, z + lz * t + 0.01, r * 0.62, r, r * 0.62, c, kc, hm);
      if (!lod) ball(out, bx, by - r * 0.75, z + lz * t + r * 0.1, r * 0.5, r * 0.2, r * 0.5, lit(c, 0.75), kc, hm);
    }
    return;
  }
  if (form === 'poppy') {
    // a cup of four scarlet petals round a dark eye, a nodding bud beside it
    if (!lod) {
      // (an open bowl: the petals splay out and up, so from above the window the black eye shows)
      ball(out, tx, ty - r * 0.15, tz, r * 0.45, r * 0.3, r * 0.45, lit(c, 0.7), kc, hm);
      for (let b = 0; b < 4; b++) {
        const a = (b / 4) * 6.28 + 0.4, ux = Math.cos(a), uz = Math.sin(a);
        dirSplat(out, tx + ux * r * 0.6, ty + r * 0.1, tz + uz * r * 0.55, r * 0.58, r * 0.6, r * 0.1, ux * 0.8, 0.55, uz * 0.8, lit(c, b === 1 ? 1.1 : 0.95), kc, hm);
      }
      ball(out, tx, ty + r * 0.42, tz + r * 0.62, r * 0.3, r * 0.16, r * 0.22, F.eye, 1, hm);
      const bx = tx + (rng() < 0.5 ? -1 : 1) * h * 0.25;
      stem(out, x, y0, z, bx, ty - h * 0.12, tz, sr);
      ball(out, bx, ty - h * 0.18, tz, r * 0.3, r * 0.42, r * 0.3, BUD, 1);
    } else {
      ball(out, tx, ty, tz + r * 0.2, r, r * 0.7, r * 0.6, c, kc, hm);
      if (d < 90) ball(out, tx, ty + r * 0.3, tz + r * 0.5, r * 0.32, r * 0.25, r * 0.25, F.eye, 1, hm);
    }
    return;
  }
  if (form === 'daisy') {
    // ox-eye daisy, arnica: a ring of rays round a raised eye, facing up and toward the window
    if (!lod) {
      rays(out, tx, ty, tz, F.n || 8, r * 0.58, r * 0.5, r * 0.16, 0.85, c, kc, rng, hm);
      ball(out, tx, ty + r * 0.12, tz + r * 0.45, r * 0.34, r * 0.24, r * 0.26, F.eye, 1, hm);
    } else {
      out(tx, ty, tz + r * 0.2, r, r * 0.62, r * 0.55, c[0] * kc, c[1] * kc, c[2] * kc, 1, 0, 0, 0, 1, KIND.OTHER, hm);
      if (d < 95) ball(out, tx, ty + r * 0.18, tz + r * 0.5, r * 0.38, r * 0.3, r * 0.3, F.eye, 1, hm);
    }
    return;
  }
  if (form === 'globe') {
    // globeflower: a closed ball of pale gold, lit on top
    ball(out, tx, ty, tz, r * 0.9, r * 0.85, r * 0.9, c, kc, hm);
    if (!lod) ball(out, tx - r * 0.15, ty + r * 0.4, tz + r * 0.25, r * 0.5, r * 0.35, r * 0.45, lit(c, 1.15), kc, hm);
    return;
  }
  // disc: buttercup, campion, hawkweed, scabious: an open head, a bud or a second head on a branch
  if (!lod) {
    rays(out, tx, ty, tz, 5, r * 0.45, r * 0.5, r * 0.32, 0.8, c, kc, rng, hm);
    ball(out, tx, ty + r * 0.1, tz + r * 0.42, r * 0.3, r * 0.22, r * 0.24, F.eye || lit(c, 0.8), 1, hm);
    const s = rng() < 0.5 ? -1 : 1, bx = tx + s * h * 0.22, by = ty - h * 0.15;
    stem(out, x + lx * 0.55, y0 + h * 0.55, z + lz * 0.55, bx, by, tz, sr * 0.8);
    ball(out, bx, by, tz, r * 0.6, r * 0.45, r * 0.55, c, kc * 0.95, hm);
  } else {
    out(tx, ty, tz + r * 0.2, r, r * 0.62, r * 0.55, c[0] * kc, c[1] * kc, c[2] * kc, 1, 0, 0, 0, 1, KIND.OTHER, hm);
    if (F.eye && d < 80) ball(out, tx, ty + r * 0.18, tz + r * 0.5, r * 0.36, r * 0.28, r * 0.28, F.eye, 1, hm);
  }
}
// A tuft of grass: blades leaning out from a point, in the hay meadow some with a pale seed head.
function grassTuft(out, W, wx, x, y0, z, d, K, rng, lod, k, tall) {
  const g = GC3;
  grassColor(W, wx, -z, g, k);
  const hay = k === FK.HAY, n = lod ? 2 : 4;
  const H = (hay ? 0.55 : 0.28) * K * tall * (0.7 + 0.6 * rng());
  const w = Math.max(0.014 * K, HEADPX * 0.7 * d);
  for (let b = 0; b < n; b++) {
    const ux = (rng() - 0.5) * 0.8, uz = (rng() - 0.5) * 0.5, l = H * (0.6 + 0.4 * rng());
    const kk = 0.7 + 0.45 * rng();
    dirSplat(out, x + ux * l * 0.5, y0 + l * 0.5, z + uz * l * 0.5, l * 0.5, w, w * 0.6, ux, 1, uz, g, kk);
    if (hay && b === 0 && rng() < 0.5) dirSplat(out, x + ux * l, y0 + l * 1.02, z + uz * l, l * 0.16, w * 1.6, w * 1.2, ux, 1, uz, SEED, 0.85 + 0.3 * rng());
  }
}
// A drift: what a patch of meadow looks like from a few hundred metres, where single flowers merge:
// a tussock of grass, darker below, with heads of the patch's flowers crowded on its top and the
// tall kinds standing out of it. s = its half-width in metres.
function drift(out, W, wx, x, y0, z, d, s, pt, rng, tall) {
  const g = GC3;
  grassColor(W, wx, d, g, pt.k);
  const ht = s * (0.45 + 0.45 * rng()) * tall;
  ball(out, x, y0 + ht * 0.42, z, s, ht * 0.55, s * 0.7, g, 0.62 + 0.2 * rng());
  const tot = pt.da + pt.db, n = 2 + Math.floor(rng() * (d > 300 ? 2 : 3) + 2.5 * tot);
  const rmin = HEADPX * d * 1.05;
  for (let b = 0; b < n; b++) {
    const F = FL[rng() * tot < pt.da ? pt.a : pt.b], kc = 0.88 + 0.2 * rng();
    const r = Math.max(rmin, F.r * 1.6) * (0.85 + 0.35 * rng());
    const up = F.form === 'spike' || F.form === 'umbel' || F.form === 'thistle';
    const low = F.form === 'cushion' || F.form === 'trumpet' || F.form === 'clover';
    const yy = y0 + ht * (low ? 0.6 + 0.3 * rng() : 0.85 + 0.3 * rng()) + (up ? F.h * tall * 0.6 : 0);
    const c = F.c;
    out(x + (rng() - 0.5) * 1.7 * s, yy, z + (rng() - 0.25) * 0.9 * s, r * (up ? 0.75 : 1.05), r * (up ? 1.8 : 0.8), r * 0.85, c[0] * kc, c[1] * kc, c[2] * kc, 1, 0, 0, 0, 1, KIND.OTHER, chorus(F.g));
  }
}
// The verge mix by the line: poppies, daisies, hawkweed, fireweed, campion.
const VERGE = [6, 2, 19, 8, 6, 15];
// Plants over the strip [dLo, dHi): sampled with density ~ d^-power, single plants and grass tufts
// out to opts.drift metres, drifts beyond. Stops at `budget` splats (or the band's limit).
function* meadow(ctx, out, W, budget, dLo, dHi, opts = {}) {
  const rng = ctx.rng, L = ctx.length;
  const p = opts.power != null ? opts.power : 1.3, a1 = 1 - p;
  const A = Math.pow(dLo, a1), Bq = Math.pow(dHi, a1);
  const stop = Math.min(out.limit, out.n + budget), zones = opts.zones;
  const dD = opts.drift != null ? opts.drift : 1e9, grassP = opts.grass != null ? opts.grass : 0.5;
  // (a low budget draws fewer plants: each is drawn a little larger, and each drift spreads a little
  // wider, to keep the cover; and fewer are drawn in full)
  const rel = relCount(ctx), spread = 1 / Math.sqrt(rel), big = clamp(Math.pow(rel, -0.35), 1, 1.35);
  const lod0 = rel > 0.8 ? LOD0 : 26;
  // what the ground is beyond 95 m (wood, water, road ...), asked once per cell of the chunk (5 m)
  const G = opts.cell || 5, gd0 = Math.max(95, dLo), gn = Math.max(1, Math.ceil((dHi - gd0) / G) + 1);
  const grid = dHi > 95 ? new Int8Array((Math.ceil(L / G) + 1) * gn).fill(-1) : null;
  for (let i = 0; i < budget * 3 && out.n < stop; i++) {
    const x0 = rng() * L, wx0 = ctx.x0 + x0;
    const xx = xAt(W, wx0);
    // (opts.slope: that share of the samples goes evenly up the valley side, which faces the window
    // and fills far more of it than its distance would say)
    const d0 = opts.slope && rng() < opts.slope ? Math.max(dLo, xx.ft - 40) + rng() * (dHi - Math.max(dLo, xx.ft - 40)) : Math.pow(A + rng() * (Bq - A), 1 / a1);
    const rd = xx.rd, rc = xx.rc, hw = xx.rw * 0.5, ft = xx.ft;
    // not on the ballast, the road, the river or the path, nor in a wood, on rock or in a clearing
    if (d0 < 6.2 || Math.abs(d0 - rd) < 4.6 || Math.abs(d0 - rc) < hw + 1.5 || (xx.hs > 0.3 && d0 < 15)) continue;
    if (pathOn(xx) && Math.abs(d0 - pathD(xx)) < 1.4) continue;
    if (xx.nb > 0 && hairpinOff(W, wx0, d0) < 4.5) continue;
    if (zones && cleared(zones, wx0, d0)) continue;
    if (d0 > 95) {
      const gi = Math.floor(x0 / G), gj = Math.floor((d0 - gd0) / G), ci = gi * gn + gj;
      let t = grid[ci];
      if (t < 0) t = grid[ci] = paintType(W, ctx.x0 + (gi + 0.5) * G, gd0 + (gj + 0.5) * G);
      if (t !== T.MEADOW && t !== T.TURF) continue;
    }
    const wet = d0 < ft && Math.abs(d0 - rc) < hw + 16;
    const pt = patchAt(W, wx0, d0, wet);
    const tall = pt.tall, tot = pt.da + pt.db;
    const u0 = rng() * Math.max(0.5, tot + 0.1);
    if (d0 >= dD) {
      // the middle distance: drifts of bloom where the patch flowers, plain tussocks between
      const s = Math.max(0.45, (d0 > 300 ? 0.0044 : 0.0034) * d0) * spread * (0.75 + 0.5 * rng());
      const y0 = W.H(wx0, d0);
      if (u0 < tot * 1.25) drift(out, W, wx0, x0, y0, -d0, d0, s, pt, rng, tall);
      else if (pt.k !== FK.MOWN && rng() < grassP) {
        const g = GC3; grassColor(W, wx0, d0, g, pt.k);
        const ht = s * (0.35 + 0.4 * rng()) * tall;
        ball(out, x0, y0 + ht * 0.4, -d0, s * 0.9, ht * 0.5, s * 0.65, g, 0.7 + 0.3 * rng());
      }
      if (out.due()) yield;
      continue;
    }
    const lod = d0 < lod0 ? 0 : 1;
    const K = clamp(d0 / 25, 1.5, 1.8) * big * (opts.k || 1);
    if (u0 > tot) {
      // grass between the flowers: blades with height, so the turf itself stands up
      if (pt.k !== FK.MOWN && rng() < grassP) grassTuft(out, W, wx0, x0, W.H(wx0, d0), -d0, d0, K, rng, lod, pt.k, tall);
      if (out.due()) yield;
      continue;
    }
    let fi = u0 < pt.da ? pt.a : pt.b;
    if (opts.verge && rng() < opts.verge) fi = VERGE[Math.floor(rng() * VERGE.length)];
    const F = FL[fi];
    const Kh = F.form === 'spike' || F.form === 'umbel' || F.form === 'thistle' ? Math.min(K, 1.1) : K;
    // a clump of a few plants of the kind (more, and spread wider, further out), grass among them
    const m = F.form === 'bush' ? 1 : 1 + Math.floor(rng() * (lod ? 3.6 : 3.2));
    const sp = (lod ? 1.6 : 1.1) * K;
    for (let j = 0; j < m; j++) {
      const x = x0 + (rng() - 0.5) * sp, d = d0 + (rng() - 0.5) * 0.7 * sp;
      plant(out, F, x, W.H(ctx.x0 + x, d), -d, d, K, Kh, rng, lod, tall);
    }
    if (!lod && rng() < 0.3) grassTuft(out, W, wx0, x0 + (rng() - 0.5) * sp, W.H(wx0, d0), -d0, d0, K, rng, lod, pt.k, tall);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Trees. function* (ctx, out, x, d, opts) with opts { height, width, y (base), n (splats), rng,
// kind, larch }. With a small n each draws a cheap distant version.
// ---------------------------------------------------------------------------------------------
function treeN(out, d, H, Wd) {
  const r = Math.max(0.03, 0.0032 * d * out.detailK / Math.sqrt(out.density)) * 1.2;
  return clamp(Math.round((H * Wd * 0.6) / (r * r * 1.5)), 1, 900 * Math.min(2, out.density));
}
// A spruce (dark, dense, drooping tiers to the ground) or a larch (lighter, more open, level
// boughs, a bare length of trunk): a trunk, a dark core so no sky shows through, and boughs laid
// round it tier by tier, lit on the sunward side (after winter.js's fir, without the snow).
function* conifer(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const larch = !!opts.larch;
  const H = opts.height || 16, Wd = opts.width || H * (larch ? 0.36 : 0.3) * (0.9 + 0.25 * rng());
  const y0 = opts.y != null ? opts.y : ctx.terrain.height(ctx.x0 + x, d) - 0.15;
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const n = Math.max(1, Math.round(opts.n || treeN(out, d, H, Wd)));
  const col = larch ? C.larch : C.spruce, tip = larch ? C.larchTip : C.spruceTip;
  if (n <= 6) {
    const parts = [[0.34, 0.24, 0.24], [0.66, 0.14, 0.18], [0.9, 0.05, 0.09]];
    for (let k = 0; k < Math.min(3, n); k++) {
      const [fy, fw, fh] = parts[k];
      const c = jitter(mul3(col, 0.95 + 0.35 * k), rng, 0.12);
      out(x, y0 + H * fy, -d, Wd * fw * 2, H * fh, Wd * fw * 2, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
    for (let k = 3; k < n; k++) {
      const fy = 0.3 + 0.2 * (k - 3), c = mul3(tip, 0.95);
      out(x - Wd * 0.12, y0 + H * fy, -(d - Wd * 0.1), Wd * (0.4 - fy * 0.3), H * 0.1, Wd * 0.25, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
    return;
  }
  const cb = H * (larch ? 0.16 + 0.1 * rng() : 0.04 + 0.07 * rng());
  const span = H - cb;
  const T_ = clamp(Math.round(Math.sqrt(n) * 0.7), 3, Math.max(3, Math.round(span / 0.7)));
  const tierJ = [];
  for (let k = 0; k < T_; k++) tierJ.push(0.8 + 0.4 * rng());
  const s0 = Math.sqrt((H * Wd * 0.5) / n);
  const trunkN = n >= 30 ? Math.max(2, Math.round(n * 0.03)) : 0;
  if (trunkN) {
    const tr = Math.max(0.09, H * 0.016), th = cb + H * 0.12;
    for (let i = 0; i < trunkN; i++) {
      const t = (i + 0.5) / trunkN * th;
      out(x, y0 + t, -d, tr, th / trunkN * 0.65, tr, C.bark[0], C.bark[1], C.bark[2], 1, 0, 0, 0, 1, kind);
    }
  }
  const coreN = Math.max(1, Math.round(n * (larch ? 0.05 : 0.08)));
  for (let i = 0; i < coreN; i++) {
    const t = 1 - Math.sqrt(rng());
    const R = Wd * 0.5 * (1 - t);
    const c = jitter(mul3(col, 0.55), rng, 0.1);
    const ss = Math.max(s0 * 1.4, R * 0.5);
    out(x, y0 + cb + span * t * 0.95, -(d - R * 0.15), ss, Math.max(ss, span / T_ * 0.6), ss * 0.8, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
  }
  const bn = n - trunkN - coreN - 2;
  const tierH = span / T_;
  for (let i = 0; i < bn; i++) {
    const tt = 1 - Math.sqrt(rng());
    const k = Math.min(T_ - 1, Math.floor(tt * T_));
    const tTop = (k + 1) / T_;
    const yk = y0 + cb + span * Math.min(0.97, tTop);
    const Rk = Wd * 0.5 * Math.pow(1 - (k + 0.3) / T_, 0.95) * tierJ[k] + 0.12;
    let a = rng() * Math.PI * 2;
    if (Math.sin(a) < -0.2 && rng() < 0.6) a = -a;
    const ca = Math.cos(a), sa = Math.sin(a);
    const f = 0.3 + 0.7 * Math.pow(rng(), 0.55);
    const rr = Rk * f;
    const droop = larch ? 0.05 + 0.2 * rng() : 0.25 + 0.45 * (1 - tTop) + 0.2 * rng();
    const by = yk - droop * rr - tierH * 0.3 * rng();
    const len = Math.min(Rk * 0.55, Math.max(s0 * 1.5, rr * 0.42));
    const th = Math.max(s0 * 0.45, len * 0.3);
    const lit_ = Math.max(0, ca * SX + 0.45 * SY + sa * SZ);
    let c = mix3(col, tip, f * f * (0.3 + 0.7 * lit_));
    c = jitter(mul3(c, (0.6 + 0.5 * f) * (0.75 + 0.5 * lit_)), rng, 0.1);
    const q = quatXTo(ca, -droop, sa);
    out(x + ca * rr, by, -(d - sa * rr), len, th, th * 0.85, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind);
    if (out.due()) yield;
  }
  const lc = mul3(tip, 0.9), lw = Math.max(0.05, s0 * 0.35);
  out(x, y0 + H - tierH * 0.4, -d, lw, tierH * 0.5, lw, lc[0], lc[1], lc[2], 1, 0, 0, 0, 1, kind);
  out(x, y0 + H - tierH * 1.2, -d, lw * 1.3, tierH * 0.5, lw * 1.3, lc[0], lc[1], lc[2], 1, 0, 0, 0, 1, kind);
  if (out.due()) yield;
}
// A broadleaf by the river or a farm (alder, willow, sycamore): the kit's tree in this biome's greens.
function* leafTree(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 10;
  yield* broadleaf(ctx, out, x, d, { height: H, crown: H * (0.7 + 0.2 * rng()), color: mix3(C.leaf, [0.3, 0.44, 0.14], rng()), n: opts.n, rng, y: opts.y, kind: opts.kind });
}
// Placing trees with a shared budget: collect them first, then give each a share of the splats in
// proportion to its size on screen, capped at full detail (after winter.js).
function* drawPlan(ctx, out, plan, budget) {
  let sw = 0;
  for (const t of plan) sw += t.w;
  plan.sort((a, b) => a.nMax / a.w - b.nMax / b.w || a.d - b.d || a.x - b.x);
  let Bq = budget, wLeft = sw;
  for (const t of plan) {
    const share = wLeft > 0 ? (Bq * t.w) / wLeft : 0;
    t.n = Math.max(1, Math.min(t.nMax, Math.round(share)));
    Bq -= t.n; wLeft -= t.w;
  }
  for (const t of plan) {
    yield* t.fn(ctx, out, t.x, t.d, { ...t.opts, n: t.n });
    if (out.due()) yield;
  }
}
function planTree(ctx, out, W, wx, d, rng, opts = {}) {
  const leaf = opts.leaf && rng() < opts.leaf;
  const larch = !leaf && (opts.larch != null ? rng() < opts.larch : noise2(wx / 260, d / 260, W.ws + 405) + 0.3 * (rng() - 0.5) > 0.66);
  let H = leaf ? (opts.H || 11) * (0.7 + 0.5 * rng()) : (opts.H || 18) * (0.7 + 0.45 * rng());
  if (opts.young) H *= opts.young;
  const Wd = leaf ? H * 0.8 : H * (larch ? 0.36 : 0.3);
  const nMax = Math.max(1, Math.round(treeN(out, d, H, Wd) * (opts.detail || 1) * (leaf ? 0.7 : 1)));
  const y = opts.y != null ? opts.y : W.H(wx, d) - 0.15;
  // (the tree is drawn from an rng of its own, so it comes out the same whichever chunk or band draws it and in whatever order)
  return { fn: leaf ? leafTree : conifer, x: wx - ctx.x0, d, w: (H * Wd) / (d * d), nMax, opts: { rng: makeRng(hashInts(W.ws, 921, Math.round(wx * 8), Math.round(d * 8))), height: H, width: leaf ? undefined : Wd, y, kind: opts.kind, larch } };
}
function isForest(W, wx, d) {
  if (d < 100) return false;
  const x = xAt(W, wx), ft = x.ft, fy = x.fy;
  const y = W.H(wx, d);
  const nb = x.nb;
  if (x.cl > 0 && d > ft) { const sc = cliffS(W, wx), s_ = d - ft; if (s_ > sc - 10 && s_ < sc + 36) return false; }
  if (!(forestF(W, wx, d, y - fy, ft) > 0)) return false;
  return !(nb > 0 && (hairpinClear(W, wx, d) || cableClear(W, wx, d)));
}
// The forest seen from outside: trees on a world grid; those at an edge facing the line at full
// detail, the row behind at reduced detail, a few inside as cheap spires that break the canopy line.
function forestPlan(ctx, out, W, plan, dLo, dHi, sp, opts = {}) {
  const g0 = Math.floor((ctx.x0 - 8) / sp), g1 = Math.floor((ctx.x0 + ctx.length + 8) / sp);
  const k0 = Math.floor(dLo / sp), k1 = Math.floor(dHi / sp);
  for (let gk = k0; gk <= k1; gk++) {
    for (let gx = g0; gx <= g1; gx++) {
      const r = worldRng(ctx, 901, gx, gk);
      const wx = (gx + r()) * sp, d = (gk + r()) * sp;
      if (d < dLo || d >= dHi) continue;
      if (!isForest(W, wx, d)) continue;
      const Hc = 17 + 9 * noise2(wx / 200, d / 200, W.ws + 403);
      if (!isForest(W, wx, d - sp * 1.2)) {
        plan.push(planTree(ctx, out, W, wx, d, r, { H: Hc, detail: opts.detail }));
        if (r() < 0.4) plan.push(planTree(ctx, out, W, wx + (r() - 0.5) * sp, d - sp * (0.3 + 0.4 * r()), r, { H: Hc, young: 0.25 + 0.3 * r(), detail: opts.detail }));
        continue;
      }
      if (!isForest(W, wx, d - sp * 2.6) || !isForest(W, wx - sp * 1.5, d) || !isForest(W, wx + sp * 1.5, d)) { plan.push(planTree(ctx, out, W, wx, d, r, { H: Hc, detail: 0.35 * (opts.detail || 1) })); continue; }
      if (r() < (opts.inner != null ? opts.inner : 0.1)) {
        const t = planTree(ctx, out, W, wx, d, r, { H: Hc * 1.1 });
        t.nMax = Math.min(t.nMax, 6);
        plan.push(t);
      }
    }
  }
}
// Lone trees and small groups on the meadows, and alders and willows along the river.
function fieldTrees(ctx, out, W, plan, dLo, dHi, cell) {
  for (const { i, wx0 } of cellsAround(ctx, cell, 14)) {
    const r = worldRng(ctx, 911, i, cell);
    const grove = smooth(0.4, 0.8, noise1(wx0 / 700, W.ws + 912));
    if (r() > 0.3 + 0.5 * grove) continue;
    const m = 1 + Math.floor(r() * (1 + 3 * grove));
    const cx = wx0 + r() * cell, x = xAt(W, cx), byRiver = r() < 0.45;
    const cd = byRiver ? x.rc + (r() < 0.5 ? -1 : 1) * (x.rw * 0.5 + 5 + 4 * r()) : Math.max(dLo, x.rc + x.rw * 0.5 + 14) + r() * (dHi - x.rc - 30);
    const leaf = byRiver ? 0.9 : 0.3;
    for (let k = 0; k < m; k++) {
      const wx = cx + (r() - 0.5) * 16 * Math.sqrt(m), d = cd + (byRiver ? (r() - 0.5) * 3 : (r() - 0.5) * 12 * Math.sqrt(m));
      if (!inD(d, dLo, dHi)) continue;
      const xx = xAt(W, wx);
      if (Math.abs(d - xx.rc) < xx.rw * 0.5 + 2 || Math.abs(d - xx.rd) < 7 || d < xx.rd) continue;
      if (siteNear(W, wx, d, 14)) continue;
      plan.push(planTree(ctx, out, W, wx, d, r, { H: byRiver ? 9 : 15, leaf }));
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------------------------
// A frame for a building or a figure: local x along its front, y up, z out of its front (toward
// the window at yaw 0), turned by yaw about the vertical and rolled by `roll` about its front
// normal (level 1 only). P gives a point in splat space, V a direction.
function frame(ctx, wx, base, d, yaw, roll = 0) {
  const [ex, ez] = rotY(1, 0, yaw), [fx, fz] = rotY(0, 1, yaw), x0 = wx - ctx.x0;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const V = (lx, ly, lz) => { const ax = lx * cr - ly * sr, ay = lx * sr + ly * cr; return [ex * ax + fx * lz, ay, ez * ax + fz * lz]; };
  const P = (lx, ly, lz) => { const v = V(lx, ly, lz); return [x0 + v[0], base + v[1], -d + v[2]]; };
  return { P, V, ex, ez, fx, fz };
}
// The lowest ground under a footprint (so nothing stands on air on a slope).
function footing(W, wx, d, w, dep, yaw) {
  let base = W.H(wx, d);
  for (const [cx, cd] of [[-w / 2, -dep / 2], [w / 2, -dep / 2], [-w / 2, dep / 2], [w / 2, dep / 2]]) {
    const [rx, rz] = rotY(cx, cd, yaw);
    base = Math.min(base, W.H(wx + rx, d - rz));
  }
  return base - 0.3;
}
// A chalet, a hay barn or a nave. The gable faces local +z (the line, at yaw 0) and the ridge runs
// away from it; every wall and both roof slopes are drawn, so it holds from any side of a pass.
// Ground floor of stone or white plaster, sun-darkened timber above in boards, shuttered windows
// with flower boxes, a balcony across the gable hung with flowers, a wide low roof of grey shingles
// weighted with rows of stones, dark barge boards, a stone chimney.
//   hs: chaletSpec()   o: { k (scale), s (splat size), lift, roll, pitch, kind, night, plain }
function* chalet(ctx, out, W, hs, o = {}) {
  const rng = makeRng(hs.seed);
  const k = o.k || 1;
  const w = hs.w * k, dep = hs.dep * k, h = hs.h * k;
  const pitch = o.pitch != null ? o.pitch : hs.pitch, rh = (w / 2) * Math.tan(pitch);
  const yaw = hs.yaw, d = hs.d;
  const barn = hs.type === 'barn', nave = hs.type === 'nave';
  const area = 2 * (w + dep) * h + w * dep * 1.6;
  // (its share of splats is capped, and the cap follows the budget; whole or not at all: a house cut
  // off part-way by the band's limit is a loose scatter of boards)
  const s = o.s || Math.max(0.1, detail(out, d, 1.05), Math.sqrt(area / ((o.cap || 3200) * clamp(out.density, 0.3, 1))) * 0.72);
  if (out.n + area / (1.96 * s * s) * 1.2 + 80 > out.limit) return;
  const kind = o.kind != null ? o.kind : KIND.BUILDING, kindO = o.kind != null ? o.kind : KIND.OTHER;
  const base = (o.y != null ? o.y : footing(W, hs.wx, d, w, dep, yaw)) + (o.lift || 0);
  const { P, V, ex, ez, fx, fz } = frame(ctx, hs.wx, base, d, yaw, o.roll || 0);
  const fine = d < 130, mid = d < 320;
  const timber = hs.newer ? mix3(C.timber, C.timberNew, 0.6) : C.timber;
  const baseC = nave ? C.plaster : hs.plaster ? C.plaster : C.stone;
  const bH = nave ? h + rh : barn ? 0.5 * k : Math.min(hs.baseH * k, h * 0.55);
  const wj = 0.92 + 0.14 * rng();
  const boards = (ly) => (Math.floor(ly / (0.32 * k)) % 2 ? 0.84 : 1.05);
  const wallC = (tone, ly, top) => (ly < bH ? mul3(faceTone(baseC, tone[0], tone[1]), wj * (nave ? 1 : 0.94 + 0.1 * Math.sin(ly * 7))) : mul3(faceTone(timber, tone[0], tone[1]), wj * boards(ly) * (top ? 0.7 : 1)));
  // gable walls (front and back)
  for (const sg of [1, -1]) {
    const tone = [sg * fx, sg * fz];
    yield* panel(out, P(-w / 2, 0, sg * dep / 2), V(1, 0, 0), V(0, 1, 0), w, h + rh, s, (a, b) => {
      const ly = b * (h + rh);
      if (ly > h && Math.abs(a - 0.5) * 2 > 1 - (ly - h) / rh) return null;
      return wallC(tone, ly, ly > h + rh * 0.55);
    }, kind, rng);
  }
  // side walls under the eaves
  for (const sg of [1, -1]) {
    const tone = [sg * ex, sg * ez];
    yield* panel(out, P(sg * w / 2, 0, dep / 2), V(0, 0, -1), V(0, 1, 0), dep, h, s, (a, b) => wallC(tone, b * h, b > 0.88), kind, rng);
  }
  // openings: windows with shutters and flower boxes, a door
  const night = o.night, glass = [0.1, 0.12, 0.15];
  const shut = SHUTTERS[hs.shut], bloom = BLOOMS[hs.bloom];
  const WW = (nave ? 0.42 : 0.44) * k, WH = (nave ? 1.5 : 0.55) * k;
  const win = function* (lx, ly, lz, nx, nz, ux, uz) {
    // (lx, ly, lz) its centre on the wall; (nx, nz) the wall's outward normal, (ux, uz) along the wall (local)
    const p = P(lx + nx * 0.06, ly, lz + nz * 0.06), u = V(ux, 0, uz), nn = V(nx, 0, nz);
    const q = quatBasis(u[0], u[1], u[2], 0, 1, 0);
    const isLit = night && (hashInts(hs.seed, Math.round(lx * 9), Math.round(ly * 9), Math.round(lz * 9)) & 3) !== 0;
    const fr = faceTone([0.76, 0.75, 0.7], nn[0], nn[2]);
    if (fine) out(p[0], p[1], p[2], WW * 1.2, WH * 1.15, 0.04, fr[0], fr[1], fr[2], 1, q[0], q[1], q[2], q[3], kind);
    if (isLit) out(p[0] + nn[0] * 0.03, p[1], p[2] + nn[2] * 0.03, WW, WH, 0.04, LIT[0], LIT[1], LIT[2], 1, q[0], q[1], q[2], q[3], KIND.LIGHT);
    else out(p[0] + nn[0] * 0.03, p[1], p[2] + nn[2] * 0.03, WW, WH, 0.04, glass[0], glass[1], glass[2], 1, q[0], q[1], q[2], q[3], kind);
    if (nave || !mid) return;
    const sc = faceTone(shut, nn[0], nn[2]);
    for (const sd of [-1, 1]) out(p[0] + u[0] * sd * WW * 1.75, p[1], p[2] + u[2] * sd * WW * 1.75, WW * 0.55, WH * 1.05, 0.04, sc[0], sc[1], sc[2], 1, q[0], q[1], q[2], q[3], kind);
    // the flower box: green hanging down, bloom along the top
    const by = p[1] - WH * 1.25, bn = fine ? 4 : 2;
    out(p[0] + nn[0] * 0.14, by - 0.1 * k, p[2] + nn[2] * 0.14, WW * 1.5, 0.14 * k, 0.12 * k, 0.14, 0.3, 0.1, 1, q[0], q[1], q[2], q[3], kindO);
    for (let i = 0; i < bn; i++) {
      const t = ((i + 0.5) / bn * 2 - 1) * WW * 1.4;
      out(p[0] + u[0] * t + nn[0] * 0.2, by + 0.07 * k, p[2] + u[2] * t + nn[2] * 0.2, WW * 1.5 / bn * 1.05, 0.15 * k, 0.14 * k, bloom[0], bloom[1], bloom[2], 1, q[0], q[1], q[2], q[3], kindO);
    }
    if (out.due()) yield;
  };
  const upY = bH + (h - bH) * 0.52, lowY = bH * 0.55;
  const fcols = Math.max(1, Math.floor(w / (2.7 * k)));
  if (!barn && !o.plain) {
    const doorCol = Math.floor(rng() * fcols);
    for (const sg of [1, -1]) {
      for (let c = 0; c < fcols; c++) {
        const lx = -w / 2 + (c + 0.5) * w / fcols;
        if (!nave) yield* win(lx, upY, sg * dep / 2, 0, sg, 1, 0);
        if (bH > 1.8 * k && !(sg > 0 && c === doorCol) && !nave) yield* win(lx, lowY, sg * dep / 2, 0, sg, 1, 0);
      }
      if (!nave && rh > 1.6 * k) yield* win(0, h + rh * 0.38, sg * dep / 2, 0, sg, 1, 0);
    }
    const scols = Math.max(1, Math.floor(dep / ((nave ? 3.4 : 3) * k)));
    for (const sg of [1, -1]) for (let c = 0; c < scols; c++) {
      const lz = -dep / 2 + (c + 0.5) * dep / scols;
      yield* win(sg * w / 2, nave ? h * 0.55 : upY, lz, sg, 0, 0, 1);
    }
    // the door
    const dx = nave ? 0 : -w / 2 + (doorCol + 0.5) * w / fcols;
    const dp = P(dx, (nave ? 1.5 : 1.0) * k, dep / 2 + 0.05), dq = quatBasis(...V(1, 0, 0), 0, 1, 0), dc = faceTone([0.2, 0.12, 0.07], fx, fz);
    out(dp[0], dp[1], dp[2], (nave ? 0.9 : 0.5) * k, (nave ? 1.5 : 1.0) * k, 0.05, dc[0], dc[1], dc[2], 1, dq[0], dq[1], dq[2], dq[3], kind);
  } else if (barn) {
    const dp = P(0, 1.0 * k, dep / 2 + 0.05), dq = quatBasis(...V(1, 0, 0), 0, 1, 0), dc = faceTone(C.timberDark, fx, fz);
    out(dp[0], dp[1], dp[2], 0.8 * k, 1.0 * k, 0.05, dc[0], dc[1], dc[2], 1, dq[0], dq[1], dq[2], dq[3], kind);
  }
  // the balcony across the gable: a floor, a boarded rail, flowers all along it
  if (!barn && !nave && !o.plain && mid) {
    const by = bH + 0.05, bz = dep / 2 + 1.0 * k, tone = faceTone(mul3(timber, 0.85), fx, fz);
    yield* panel(out, P(-w / 2, by, bz), V(1, 0, 0), V(0, 1, 0), w, 0.95 * k, Math.min(s, 0.45), () => mul3(tone, 0.9 + 0.2 * rng()), kind, rng);
    const fp = P(0, by, dep / 2 + 0.5 * k), q = quatBasis(...V(1, 0, 0), 0, 1, 0);
    out(fp[0], fp[1], fp[2], w / 2, 0.08, 0.55 * k, C.timberDark[0], C.timberDark[1], C.timberDark[2], 1, q[0], q[1], q[2], q[3], kind);
    const bn = Math.max(4, Math.round(w / (fine ? 0.5 : 0.9)));
    for (let i = 0; i < bn; i++) {
      const p = P(-w / 2 + (i + 0.5) * w / bn, by + 1.0 * k, bz + 0.12);
      const c = i % 5 === 3 ? [0.16, 0.34, 0.1] : bloom;
      out(p[0], p[1], p[2], w / bn * 0.62, 0.17 * k, 0.16 * k, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kindO);
      const p2 = P(-w / 2 + (i + 0.5) * w / bn, by + 0.78 * k, bz + 0.16);
      out(p2[0], p2[1], p2[2], w / bn * 0.62, 0.12 * k, 0.1 * k, 0.14, 0.3, 0.1, 1, q[0], q[1], q[2], q[3], kindO);
    }
  }
  // the roof: two slopes from the ridge down past the walls, with a deep overhang at the gables
  const ov = (nave ? 0.4 : 1.0) * k, ovz = (nave ? 0.4 : barn ? 0.8 : 1.3) * k;
  const cp = Math.cos(pitch), sp = Math.sin(pitch), slopeLen = (w / 2 + ov) / cp;
  const roofC = nave ? [0.36, 0.2, 0.15] : hs.newer ? [0.36, 0.3, 0.26] : C.shingle;
  for (const sg of [1, -1]) {
    const nn = V(sg * sp, cp, 0);
    const tone = mul3(roofC, 0.62 + 0.62 * Math.max(0, nn[0] * SX + nn[1] * SY + nn[2] * SZ));
    yield* panel(out, P(sg * (w / 2 + ov), h - ov * Math.tan(pitch), -dep / 2 - ovz), V(0, 0, 1), V(-sg * cp, sp, 0), dep + 2 * ovz, slopeLen, s,
      (a, b) => mul3(tone, (0.9 + 0.2 * rng()) * (Math.floor(b * slopeLen / (0.5 * k)) % 2 ? 0.92 : 1.04)), kind, rng, 0.3);
    // rows of stones holding the shingles down
    if (!nave && mid) {
      const sn = Math.max(2, Math.round((dep + 2 * ovz) / (1.25 * k)));
      for (const row of [0.3, 0.72]) for (let i = 0; i < sn; i++) {
        const lz = -dep / 2 - ovz + (i + 0.5) * (dep + 2 * ovz) / sn, u = (w / 2 + ov) * (1 - row);
        const p = P(sg * u, h - ov * Math.tan(pitch) + (w / 2 + ov - u) * Math.tan(pitch) + 0.2 * k, lz);
        const g = 0.5 + 0.2 * rng();
        out(p[0], p[1], p[2], 0.26 * k, 0.17 * k, 0.24 * k, g, g, g * 0.97, 1, 0, 0, 0, 1, kindO);
      }
    }
    // barge boards along both gable edges
    for (const gz of [1, -1]) {
      const a = P(sg * (w / 2 + ov), h - ov * Math.tan(pitch) - 0.05, gz * (dep / 2 + ovz)), b = P(0, h + rh + 0.02, gz * (dep / 2 + ovz));
      bar(out, a[0], a[1], a[2], b[0], b[1], b[2], Math.max(0.09 * k, thin(d)), C.timberDark, Math.max(2, Math.round(slopeLen / 0.9)), kind);
    }
    if (out.due()) yield;
  }
  // the ridge
  { const a = P(0, h + rh + 0.05, -dep / 2 - ovz), b = P(0, h + rh + 0.05, dep / 2 + ovz); bar(out, a[0], a[1], a[2], b[0], b[1], b[2], Math.max(0.1 * k, thin(d)), mul3(roofC, 0.8), Math.max(2, Math.round(dep / 1.2)), kind); }
  // chimney and smoke
  if (!barn && !nave) {
    const cx_ = (rng() < 0.5 ? -1 : 1) * w * 0.22, cz_ = -dep * 0.15, cy0 = h + rh - Math.abs(cx_) * Math.tan(pitch);
    const st = faceTone(C.stone, 0.2, 0.8);
    for (let j = 0; j < 3; j++) { const p = P(cx_, cy0 + (0.2 + j * 0.42) * k, cz_); out(p[0], p[1], p[2], 0.34 * k, 0.26 * k, 0.34 * k, st[0], st[1], st[2], 1, 0, 0, 0, 1, kind); }
    if (hs.smoke && mid) { const p = P(cx_, cy0 + 1.7 * k, cz_); smoke(out, p[0], p[1], -p[2], makeRng(hashInts(hs.seed, 5)), k); }
  }
  // the flag: red with a white cross, on a pole at a front corner
  if (hs.flag && mid && !o.plain) {
    const px = -w / 2 - 1.6 * k, pz = dep / 2 + 1.5 * k, H = h + rh + 2.5 * k;
    const a = P(px, 0, pz), b = P(px, H, pz);
    bar(out, a[0], a[1], a[2], b[0], b[1], b[2], Math.max(0.05 * k, thin(d)), [0.7, 0.7, 0.68], 4, kindO);
    flag(out, b[0], b[1] - 0.75 * k, b[2], 0.72 * k, kindO);
  }
  if (out.due()) yield;
}
// A square Swiss flag hanging from (x, y, z) to the right of its pole (MOVE.FLAG).
function flag(out, x, y, z, hs_, kind = KIND.OTHER) {
  const R = [0.8, 0.08, 0.06], Wc = [0.8, 0.8, 0.78];
  for (const [u, v] of [[0.5, 0.5], [1.5, 0.5], [0.5, -0.5], [1.5, -0.5]]) out(x + u * hs_, y + v * hs_, z, hs_ * 0.56, hs_ * 0.56, 0.03, R[0], R[1], R[2], 1, 0, 0, 0, 1, kind, MOVE.FLAG);
  out(x + hs_, y, z + 0.03, hs_ * 0.62, hs_ * 0.16, 0.03, Wc[0], Wc[1], Wc[2], 1, 0, 0, 0, 1, kind, MOVE.FLAG);
  out(x + hs_, y, z + 0.03, hs_ * 0.16, hs_ * 0.62, 0.03, Wc[0], Wc[1], Wc[2], 1, 0, 0, 0, 1, kind, MOVE.FLAG);
}
// Smoke from a chimney, rising and spreading as it drifts (MOVE.VAPOUR). (x, y, d) in chunk x.
function smoke(out, x, y, d, r, k = 1) {
  const n = 5 + Math.floor(r() * 3), drift = 0.5 + 0.6 * r();
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), s = (0.35 + 1.5 * f) * k;
    const c = mix3([0.56, 0.56, 0.58], [0.72, 0.72, 0.74], f);
    out(x + drift * f * f * 7 * k, y + f * 8 * k, -(d + 0.3 * f), s, s * 0.8, s * 0.7, c[0], c[1], c[2], 0.3 - 0.2 * f, 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
  }
}
// A village church: a white nave, side on to the line, and a square white tower at its end with a
// clock, belfry openings, and an onion dome of green copper (or a tall needle spire of red
// shingles) carrying a gilt ball and cross.
function* church(ctx, out, W, ch, o = {}) {
  const rng = makeRng(ch.seed);
  const k = o.k || 1, kind = o.kind != null ? o.kind : KIND.BUILDING;
  const yaw = ch.yaw + Math.PI / 2;
  const nave = { wx: ch.wx + 6 * k, d: ch.d, seed: hashInts(ch.seed, 1), type: 'nave', w: 9, dep: 19, h: 7, pitch: 0.92, yaw, plaster: true, baseH: 0, shut: 0, bloom: 0 };
  yield* chalet(ctx, out, W, nave, { k, kind: o.kind, night: o.night, cap: 2600 });
  // the tower at the west end of the nave
  const twx = ch.wx - 6.2 * k, td = ch.d;
  const tw = 5.2 * k, th = (o.towerH || 17) * k;
  const s = Math.max(0.12, detail(out, td, 1.05));
  const base = (o.y != null ? o.y : W.H(twx, td)) - 0.4;
  const { P, V, ex, ez, fx, fz } = frame(ctx, twx, base, td, ch.yaw);
  const slot = (a, b) => Math.abs(a - 0.5) < 0.13 && b > 0.76 && b < 0.9;
  for (const [o_, u_, nx, nz] of [[P(-tw / 2, 0, tw / 2), V(1, 0, 0), fx, fz], [P(-tw / 2, 0, tw / 2), V(0, 0, -1), -ex, -ez], [P(tw / 2, 0, tw / 2), V(0, 0, -1), ex, ez], [P(-tw / 2, 0, -tw / 2), V(1, 0, 0), -fx, -fz]]) {
    const tone = faceTone(C.plaster, nx, nz);
    yield* panel(out, o_, u_, [0, 1, 0], tw, th, s, (a, b) => (slot(a, b) ? [0.08, 0.08, 0.1] : mul3(tone, 0.95 + 0.06 * b)), kind, rng);
  }
  // the clock, on the faces toward the line
  for (const [lx, lz] of [[0, tw / 2 + 0.06], [-tw / 2 - 0.06, 0]]) {
    const p = P(lx, th * 0.62, lz), q = lz ? quatYaw(ch.yaw) : quatYaw(ch.yaw + Math.PI / 2);
    out(p[0], p[1], p[2], 0.95 * k, 0.95 * k, 0.04, 0.12, 0.14, 0.3, 1, q[0], q[1], q[2], q[3], kind);
    out(p[0] + (lz ? fx : -ex) * 0.04, p[1], p[2] + (lz ? fz : -ez) * 0.04, 0.7 * k, 0.7 * k, 0.03, 0.78, 0.76, 0.66, 1, q[0], q[1], q[2], q[3], kind);
  }
  // the dome or the spire: rings of overlapping splats round its profile
  const onion = o.onion != null ? o.onion : ch.onion;
  const sh = (o.spireH || (onion ? 9.5 : ch.spire)) * k, sr = tw * 0.55;
  const col = onion ? [0.3, 0.5, 0.42] : [0.44, 0.2, 0.14];
  const prof = (t) => (onion ? (t < 0.1 ? 0.75 : t < 0.5 ? 0.75 + 0.5 * Math.sin((t - 0.1) / 0.4 * Math.PI * 0.62) : t < 0.72 ? lerp(1.2, 0.3, smooth(0.5, 0.72, t)) : lerp(0.3, 0.02, (t - 0.72) / 0.28)) : (1 - t) * (t < 0.12 ? 1.25 : 1) + 0.02);
  const rings = Math.max(6, Math.round(sh / (s * 1.2)));
  for (let i = 0; i < rings; i++) {
    const t = (i + 0.5) / rings, r = sr * prof(t);
    const cols = Math.max(4, Math.round((2 * Math.PI * r) / (s * 1.25)));
    for (let j = 0; j < cols; j++) {
      const a = (j + 0.5) / cols * Math.PI * 2, sa = Math.sin(a), ca = Math.cos(a);
      const p = P(sa * r, th + t * sh, ca * r), nn = V(sa, 0, ca);
      const c = shade(col, nn[0], 0.3, nn[2], 0.5, 0.65);
      const ss = Math.max(0.07, Math.min(s * 0.85, r * 0.7 + 0.05));
      out(p[0], p[1], p[2], ss, sh / rings * 0.75, ss, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
    if (out.due()) yield;
  }
  const top = P(0, th + sh + 0.2 * k, 0), gold = [0.8, 0.62, 0.18], cr = Math.max(0.07 * k, thin(td));
  out(top[0], top[1], top[2], 0.26 * k, 0.26 * k, 0.26 * k, gold[0], gold[1], gold[2], 1, 0, 0, 0, 1, kind);
  bar(out, top[0], top[1], top[2], top[0], top[1] + 1.9 * k, top[2], cr, gold, 2, kind);
  bar(out, top[0] - ex * 0.6 * k, top[1] + 1.3 * k, top[2] - ez * 0.6 * k, top[0] + ex * 0.6 * k, top[1] + 1.3 * k, top[2] + ez * 0.6 * k, cr, gold, 2, kind);
}
// A fountain: a long stone trough of water with a wooden post and a running spout, a pot of flowers.
function* trough(ctx, out, W, wx, d, k = 1.3) {
  const y = W.H(wx, d), x = wx - ctx.x0;
  const st = [0.5, 0.49, 0.46];
  out(x, y + 0.35 * k, -d, 1.5 * k, 0.36 * k, 0.5 * k, st[0], st[1], st[2], 1, 0, 0, 0, 1, KIND.OTHER);
  out(x, y + 0.36 * k, -(d - 0.42 * k), 1.5 * k, 0.34 * k, 0.08, st[0] * 0.78, st[1] * 0.78, st[2] * 0.78, 1, 0, 0, 0, 1, KIND.OTHER);
  out(x, y + 0.72 * k, -d, 1.3 * k, 0.03, 0.36 * k, C.riverPale[0], C.riverPale[1], C.riverPale[2], 1, 0, 0, 0, 1, KIND.OTHER);
  const px = x - 1.7 * k, tr = Math.max(0.07 * k, thin(d));
  bar(out, px, y, -d, px, y + 1.7 * k, -d, tr * 1.4, C.timber, 3, KIND.OTHER);
  bar(out, px, y + 1.3 * k, -d, px + 0.7 * k, y + 1.25 * k, -d, tr, [0.3, 0.3, 0.32], 1, KIND.OTHER);
  bar(out, px + 0.7 * k, y + 1.25 * k, -d, px + 0.75 * k, y + 0.75 * k, -d, tr * 0.7, C.foam, 1, KIND.OTHER, 0, 0.9);
  out(px, y + 1.9 * k, -d, 0.26 * k, 0.2 * k, 0.26 * k, 0.8, 0.12, 0.1, 1, 0, 0, 0, 1, KIND.OTHER);
  if (out.due()) yield;
}
// Washing on a line between two posts (MOVE.FLAG).
function* washing(ctx, out, W, wx, d, r, k = 1.2) {
  const x = wx - ctx.x0, L = 6 * k, y = W.H(wx, d), tr = thin(d);
  for (const u of [-L / 2, L / 2]) bar(out, x + u, y, -d, x + u, y + 2.1 * k, -d, tr * 1.3, C.timber, 2, KIND.OTHER);
  bar(out, x - L / 2, y + 2.05 * k, -d, x + L / 2, y + 2.05 * k, -d, tr * 0.6, [0.7, 0.7, 0.68], 3, KIND.OTHER);
  const cols = [[0.78, 0.78, 0.74], [0.75, 0.2, 0.15], [0.25, 0.4, 0.7], [0.78, 0.7, 0.3], [0.78, 0.78, 0.76], [0.3, 0.55, 0.4]];
  const n = 5 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const u = -L / 2 + (i + 0.6) * L / (n + 0.2), c = cols[Math.floor(r() * cols.length)], hh = (0.35 + 0.3 * r()) * k;
    out(x + u, y + 2.0 * k - hh, -d, L / n * 0.4, hh, 0.04, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER, MOVE.FLAG);
  }
  if (out.due()) yield;
}
// A bridge over the river at world x = b.wx, from distance b.a to b.b (so it runs away from the
// line; a passing train sees it from each side in turn). 'covered': a wooden covered bridge with
// boarded sides, a shingle roof and a stone pier; 'stone': a stone bridge of two or three arches
// with parapets.
function* bridge(ctx, out, W, b, dLo, dHi) {
  const x = b.wx - ctx.x0, len = b.b - b.a, dm = (b.a + b.b) / 2;
  if (!inX(ctx, b.wx, 8) || dm < dLo || dm >= dHi) return;
  const rng = makeRng(b.seed);
  const yw = W.H(b.wx, dm) + 0.02, yDeck = Math.max(W.H(b.wx, b.a - 1), W.H(b.wx, b.b + 1)) + 0.5;
  const s = Math.max(0.14, detail(out, dm, 1.1));
  const K_ = KIND.BUILDING;
  const hw = 2.5;
  // the deck
  yield* panel(out, [x - hw, yDeck, -b.a + 1], [0, 0, -1], [1, 0, 0], len + 2, 2 * hw, s, () => jitter(b.type === 'stone' ? C.road : [0.4, 0.3, 0.2], rng, 0.08), K_, rng, 0.25);
  if (b.type === 'covered') {
    const wallH_ = 2.6, pitch = 0.6, rh = (hw + 0.6) * Math.tan(pitch);
    for (const sg of [-1, 1]) {
      const tone = faceTone(C.timber, sg, 0);
      // boarded below, open under the eaves, posts between
      yield* panel(out, [x + sg * hw, yDeck, -b.a], [0, 0, -1], [0, 1, 0], len, wallH_, s, (a, bb) => (bb > 0.5 && bb < 0.85 && Math.floor(a * len / 1.6) % 3 !== 0 ? null : mul3(tone, (Math.floor(a * len / 0.35) % 2 ? 0.86 : 1.05))), K_, rng);
      const nx = sg * Math.sin(pitch), ny = Math.cos(pitch);
      const rc_ = mul3(C.shingle, 0.62 + 0.62 * Math.max(0, nx * SX + ny * SY));
      yield* panel(out, [x + sg * (hw + 0.6), yDeck + wallH_ - 0.25, -b.a + 0.8], [0, 0, -1], [-sg * Math.cos(pitch), Math.sin(pitch), 0], len + 1.6, (hw + 0.6) / Math.cos(pitch), s, () => jitter(rc_, rng, 0.08), K_, rng, 0.3);
    }
    // the portals: a gable over a dark opening at each end
    for (const [dd, nz] of [[b.a, 1], [b.b, -1]]) {
      const tone = faceTone(C.timber, 0, nz);
      yield* panel(out, [x - hw, yDeck, -dd], [1, 0, 0], [0, 1, 0], 2 * hw, wallH_ + rh, s, (a, bb) => {
        const ly = bb * (wallH_ + rh);
        if (ly > wallH_ && Math.abs(a - 0.5) * 2 > 1 - (ly - wallH_) / rh) return null;
        return Math.abs(a - 0.5) < 0.36 && ly < wallH_ * 0.9 ? [0.05, 0.04, 0.04] : tone;
      }, K_, rng);
    }
  } else {
    const top = yDeck + 0.9, hgt = top - yw + 0.4, na = len > 26 ? 3 : 2;
    for (const sg of [-1, 1]) {
      const tone = faceTone(C.stone, sg, 0);
      yield* panel(out, [x + sg * hw, yw - 0.4, -b.a], [0, 0, -1], [0, 1, 0], len, hgt, s, (a, bb) => {
        const u = (a * na) % 1, ly = bb * hgt;
        // the arches: half ellipses rising from the water
        const e = ((u - 0.5) / 0.4) ** 2 + (ly / (hgt - 1.5)) ** 2;
        if (e < 1) return null;
        return mul3(tone, (e < 1.25 ? 0.78 : 0.92 + 0.14 * noise2(a * len, ly * 2, 77)) * (bb > 0.93 ? 1.1 : 1));
      }, K_, rng);
    }
    // the shadowed vaults seen through the arches
    yield* panel(out, [x - hw + 0.2, yDeck - 0.5, -b.a], [0, 0, -1], [1, 0, 0], len, 2 * hw - 0.4, Math.max(s, 0.5), () => [0.12, 0.12, 0.12], K_, rng, 0.2);
  }
  // stone abutments, and a pier in the stream under a long span
  const st = faceTone(C.stone, 0, 1);
  for (const dd of len > 22 ? [b.a, dm, b.b] : [b.a, b.b]) out(x, (yw + yDeck) / 2 - 0.2, -dd, hw + 0.2, (yDeck - yw) / 2 + 0.2, 1.1, st[0], st[1], st[2], 1, 0, 0, 0, 1, K_);
  if (out.due()) yield;
}

// The villages, their churches, fountains and bridges.
function* villages(ctx, out, W, dLo, dHi, opts = {}) {
  const night = lightsOn(ctx);
  const i0 = Math.floor((ctx.x0 - 250) / VCELL), i1 = Math.floor((ctx.x0 + ctx.length + 250) / VCELL);
  for (let i = i0; i <= i1; i++) {
    const v = village(W, i);
    if (!v) continue;
    yield* bridge(ctx, out, W, v.bridge, dLo, dHi);
    const ch = v.church;
    if (inD(ch.d, dLo, dHi) && inX(ctx, ch.wx, 40)) yield* church(ctx, out, W, ch, { night });
    for (const hs of v.houses) {
      if (!inD(hs.d, dLo, dHi) || !inX(ctx, hs.wx, 20)) continue;
      yield* chalet(ctx, out, W, hs, { night, cap: opts.cap || 900 });
    }
    if (opts.plan) for (const t of v.trees) {
      if (!inD(t.d, dLo, dHi) || !inX(ctx, t.wx, 15)) continue;
      opts.plan.push(planTree(ctx, out, W, t.wx, t.d, makeRng(t.seed), { H: 12, leaf: 0.7 }));
    }
    if (inD(v.sq.d, dLo, dHi) && inX(ctx, v.sq.wx, 6)) yield* trough(ctx, out, W, v.sq.wx, v.sq.d, 1.6);
  }
}
// The farms.
function* farms(ctx, out, W, dLo, dHi, opts = {}) {
  const night = lightsOn(ctx);
  const i0 = Math.floor((ctx.x0 - 60) / FCELL), i1 = Math.floor((ctx.x0 + ctx.length + 60) / FCELL);
  for (let i = i0; i <= i1; i++) {
    const f = farm(W, i);
    if (!f) continue;
    for (const hs of f.bldgs) if (inD(hs.d, dLo, dHi) && inX(ctx, hs.wx, 22)) yield* chalet(ctx, out, W, hs, { night, cap: opts.cap || 2600 });
    if (inD(f.trough.d, dLo, dHi) && inX(ctx, f.trough.wx, 5)) yield* trough(ctx, out, W, f.trough.wx, f.trough.d);
    if (f.washing && inD(f.washing.d, dLo, dHi) && inX(ctx, f.washing.wx, 6)) yield* washing(ctx, out, W, f.washing.wx, f.washing.d, makeRng(hashInts(f.seed, 4)));
    // the kitchen garden: rows of vegetables and a line of tall flowers along its fence
    const g = f.garden;
    if (inD(g.d, dLo, dHi) && inX(ctx, g.wx, 8)) {
      for (let a = -3.5; a <= 3.5; a += 0.7) for (let b = -2; b <= 2; b += 1) {
        const wx = g.wx + a, d = g.d + b, c = b === -2 ? FL[[6, 8, 2, 11, 4][Math.abs(Math.round(a * 3)) % 5]].c : mul3([0.2, 0.42, 0.14], 0.8 + 0.4 * noise2(a * 3.1, b * 2.7, f.seed & 0xffff));
        out(wx - ctx.x0, W.H(wx, d) + (b === -2 ? 0.9 : 0.3), -d, 0.34, b === -2 ? 0.3 : 0.24, 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
      }
    }
    if (opts.plan && inD(f.tree.d, dLo, dHi) && inX(ctx, f.tree.wx, 15)) opts.plan.push(planTree(ctx, out, W, f.tree.wx, f.tree.d, makeRng(hashInts(f.seed, 6)), { H: 13, leaf: 1 }));
  }
}
// Hay barns scattered on the meadows, and chalets on the lower slopes.
const BNCELL = 190, SLCELL = 320;
function* barns(ctx, out, W, dLo, dHi, opts = {}) {
  for (const { i, wx0 } of cellsAround(ctx, BNCELL, 12)) {
    const r = worldRng(ctx, 601, i);
    if (r() > 0.5) continue;
    const wx = wx0 + r() * BNCELL, x = xCopy(W, wx);
    const d = x.rc + x.rw * 0.5 + 14 + Math.pow(r(), 1.4) * (x.ft + 420 - x.rc);
    const pr = makeRng(hashInts(W.ws, 602, i));
    const hs = chaletSpec(pr, wx, d, hashInts(W.ws, 603, i), 'barn');
    if (!inD(d, dLo, dHi) || !inX(ctx, wx, 10)) continue;
    if (siteNear(W, wx, d, 10) || isForest(W, wx, d) || hairpinClear(W, wx, d) || cableClear(W, wx, d) || brookAt(W, wx, d)) continue;
    if (paintType(W, wx, d) !== T.MEADOW) continue;
    note('barn', wx, d);
    yield* chalet(ctx, out, W, hs, { cap: opts.cap || 500, k: 1 + smooth(250, 900, d) * 0.5 });
  }
  const night = lightsOn(ctx);
  for (const { i, wx0 } of cellsAround(ctx, SLCELL, 16)) {
    const r = worldRng(ctx, 611, i);
    if (r() > 0.55) continue;
    const wx = wx0 + r() * SLCELL, x = xCopy(W, wx);
    const d = x.ft + 20 + 700 * r() * r();
    const pr = makeRng(hashInts(W.ws, 612, i));
    const hs = chaletSpec(pr, wx, d, hashInts(W.ws, 613, i), 'chalet');
    hs.yaw = (pr() - 0.5) * 0.5;                       // the gable looks out over the valley
    if (!inD(d, dLo, dHi) || !inX(ctx, wx, 14)) continue;
    if (siteNear(W, wx, d, 10) || isForest(W, wx, d) || isForest(W, wx, d - 14) || isForest(W, wx, d - 32) || isForest(W, wx - 26, d - 12) || isForest(W, wx + 26, d - 12) || cableClear(W, wx, d) || brookAt(W, wx, d)) continue;
    if (xAt(W, wx).nb > 0 && hairpinOff(W, wx, d) < 14) continue;
    if (paintType(W, wx, d) !== T.MEADOW) continue;
    note('slope chalet', wx, d);
    yield* chalet(ctx, out, W, hs, { night, cap: opts.cap || 600, k: 1 + smooth(300, 1000, d) * 0.6 });
  }
}
// What covers the ground at a point (for placing things; the fill asks paint() itself).
const NORNG = () => 0.99;
function paintType(W, wx, d) {
  const e = 2, y = W.H(wx, d);
  const hx = (W.H(wx + e, d) - y) / e, hd = (W.H(wx, d + e) - y) / e, il = 1 / Math.hypot(hx, 1, hd);
  return paint(W, wx, d, y, -hx * il, il, hd * il, NORNG).t;
}

// ---------------------------------------------------------------------------------------------
// Figures: animals and people. A handful of shaped, oriented splats each, drawn larger than life
// so they read in one still at 40 to 120 m. Each part is placed in the figure's own frame (u
// forward, h up, v to its left) and turned by its heading. Every splat flashes on the beat
// (MOVE.FLASH: brighter, never bigger; a swelling body looked uncanny).
// ---------------------------------------------------------------------------------------------
const FIG = 1.4;
function figure(ctx, out0, wx, y, d, yaw, k, kind) {
  const ca = Math.cos(yaw), sa = Math.sin(yaw), x0 = wx - ctx.x0, q = quatYaw(yaw);
  const P = (u, h, v) => [x0 + (u * ca - v * sa) * k, y + h * k, -(d + (u * sa + v * ca) * k)];
  const E = (u, h, v, rx, ry, rz, c, qq = q) => { const p = P(u, h, v); out0(p[0], p[1], p[2], rx * k, ry * k, rz * k, c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], kind, FL_); };
  const seg = (a, b, r, c, n = 1) => { const A = P(a[0], a[1], a[2]), Bp = P(b[0], b[1], b[2]); bar(out0, A[0], A[1], A[2], Bp[0], Bp[1], Bp[2], r, c, n, kind, FL_); };
  return { P, E, seg, q };
}
const BODY = {
  cow: { bl: 1.0, bh: 1.32, br: 0.43, nl: 0.5, hl: 0.3, leg: 0.085 },
  goat: { bl: 0.52, bh: 0.74, br: 0.23, nl: 0.3, hl: 0.17, leg: 0.045 },
  ibex: { bl: 0.7, bh: 0.95, br: 0.31, nl: 0.36, hl: 0.2, leg: 0.06 },
  chamois: { bl: 0.58, bh: 0.82, br: 0.25, nl: 0.38, hl: 0.17, leg: 0.045 },
  deer: { bl: 0.82, bh: 1.28, br: 0.31, nl: 0.62, hl: 0.24, leg: 0.055 },
};
// A four-legged animal. o: { type: 'cow'|'goat'|'ibex'|'chamois'|'deer', yaw, k, col, pale, pied,
// graze, lying, horns, antlers, bell, ph (stride), kind }
function* beast(ctx, out0, wx, y, d, o) {
  const k = o.k || FIG, kind = o.kind != null ? o.kind : KIND.OTHER;
  const t = o.type, S = BODY[t];
  const { E, seg, q } = figure(ctx, out0, wx, y - (o.lying ? (S.bh - S.br * 1.1) * k : 0), d, o.yaw, k, kind);
  const col = o.col, dark = mul3(col, 0.6), pale = o.pale || mix3(col, [0.76, 0.74, 0.7], 0.6);
  const lr = Math.max(S.leg * k, thin(d)) / k;
  const legTop = S.bh - S.br * 0.6;
  const legC = o.pied ? pale : mix3(col, [0.1, 0.09, 0.08], 0.35);
  if (o.lying) {
    // legs folded under: a knee showing in front, a hock behind
    seg([S.bl * 0.7, legTop, 0.16], [S.bl * 1.0, legTop - 0.12, 0.2], lr * 1.2, legC);
    seg([-S.bl * 0.6, legTop, 0.2], [-S.bl * 0.2, legTop - 0.1, 0.3], lr * 1.3, col);
  } else {
    for (const [u, v, f] of [[S.bl * 0.7, 0.16, 0], [S.bl * 0.7, -0.16, 0.5], [-S.bl * 0.75, 0.16, 0.5], [-S.bl * 0.75, -0.16, 0]]) {
      const sw = o.walk ? 0.18 * Math.sin(((o.ph || 0) + f) * Math.PI * 2) : (f - 0.25) * 0.08;
      const kneeU = u + sw * 0.5 + (u > 0 ? 0.02 : -0.06), kneeH = legTop * 0.48;
      seg([u, legTop, v * S.br / 0.3], [kneeU, kneeH, v * S.br / 0.3], lr * 1.2, v < 0 ? dark : col);
      seg([kneeU, kneeH, v * S.br / 0.3], [u + sw, 0.03, v * S.br / 0.3], lr, v < 0 ? mul3(legC, 0.7) : legC);
    }
  }
  // body: barrel, chest, hindquarters, the lit line of the back
  E(0, S.bh - S.br * 0.15, 0, S.bl * 0.64, S.br * 0.88, S.br * 0.82, col);
  E(S.bl * 0.55, S.bh - S.br * 0.05, 0, S.br * 0.95, S.br * 0.95, S.br * 0.84, col);
  E(-S.bl * 0.6, S.bh - S.br * 0.1, 0, S.br * 0.95, S.br * 0.92, S.br * 0.86, col);
  E(0, S.bh + S.br * 0.56, 0, S.bl * 0.72, S.br * 0.17, S.br * 0.5, mix3(col, [0.8, 0.78, 0.74], 0.25));
  if (t === 'cow') {
    E(0, S.bh - S.br * 0.85, 0, S.bl * 0.5, S.br * 0.3, S.br * 0.6, o.pied ? pale : mul3(col, 0.8));                 // the belly
    if (!o.lying) E(-S.bl * 0.42, S.bh - S.br * 1.15, 0, 0.16, 0.13, 0.15, [0.74, 0.56, 0.5]);                        // the udder
    if (o.pied) {
      // the white of a Simmental: a blaze on the flank and the shoulder, toward either side
      for (const v of [1, -1]) { E(S.bl * 0.3, S.bh - S.br * 0.3, v * S.br * 0.6, S.bl * 0.24, S.br * 0.5, S.br * 0.3, pale); E(-S.bl * 0.5, S.bh - S.br * 0.5, v * S.br * 0.62, S.bl * 0.2, S.br * 0.36, S.br * 0.3, pale); }
    }
  } else if (t === 'chamois' || t === 'deer') E(-S.bl * 0.86, S.bh - S.br * 0.1, 0, S.br * 0.42, S.br * 0.55, S.br * 0.7, pale);
  else if (t === 'ibex') E(0, S.bh - S.br * 0.8, 0, S.bl * 0.5, S.br * 0.26, S.br * 0.55, pale);
  // neck and head: raised, or lowered to the grass
  const g = o.graze && !o.lying;
  const nA = g ? -0.8 : t === 'cow' ? 0.35 : t === 'deer' ? 1.0 : 0.85;
  const nx0 = S.bl * 0.72, ny0 = S.bh + S.br * 0.15;
  const nx1 = nx0 + Math.cos(nA) * S.nl, ny1 = ny0 + Math.sin(nA) * S.nl;
  const qn = quatMul(q, quatRoll(nA));
  E((nx0 + nx1) / 2, (ny0 + ny1) / 2, 0, S.nl * 0.62, S.br * (t === 'cow' ? 0.6 : 0.42), S.br * (t === 'cow' ? 0.5 : 0.38), col, qn);
  const hA = g ? -1.35 : t === 'cow' ? -0.5 : -0.55;
  const qh = quatMul(q, quatRoll(hA));
  const hx = nx1 + Math.cos(hA) * S.hl * 0.6, hy = ny1 + Math.sin(hA) * S.hl * 0.6;
  const headC = o.pied ? pale : t === 'chamois' ? pale : col;
  E(hx, hy, 0, S.hl, S.hl * 0.46, S.hl * 0.44, headC, qh);
  E(hx + Math.cos(hA) * S.hl * 0.85, hy + Math.sin(hA) * S.hl * 0.85, 0, S.hl * 0.34, S.hl * 0.32, S.hl * 0.36, t === 'cow' ? pale : dark, qh);
  if (t === 'chamois') E(hx, hy + 0.02, 0, S.hl * 0.9, S.hl * 0.12, S.hl * 0.46, dark, qh);          // the dark stripe through the eye
  for (const v of [-1, 1]) E(nx1 - 0.04, ny1 + 0.08, v * (t === 'cow' ? 0.2 : 0.09), 0.05, t === 'cow' ? 0.05 : 0.09, t === 'cow' ? 0.1 : 0.03, col);
  // horns and antlers (struts)
  const hr = Math.max(0.03 * k, thin(d, 0.8)) / k;
  if (t === 'cow') for (const v of [-1, 1]) seg([nx1 - 0.02, ny1 + 0.12, v * 0.12], [nx1 + 0.05, ny1 + 0.3, v * 0.24], hr, [0.72, 0.68, 0.56]);
  else if (t === 'goat') { for (const v of [-1, 1]) seg([nx1, ny1 + 0.08, v * 0.04], [nx1 - 0.12, ny1 + 0.3, v * 0.07], hr, [0.5, 0.46, 0.4]); seg([hx + 0.08, hy - 0.08, 0], [hx + 0.06, hy - 0.22, 0], hr, pale); }
  else if (t === 'chamois') for (const v of [-1, 1]) { seg([nx1, ny1 + 0.08, v * 0.04], [nx1 + 0.02, ny1 + 0.32, v * 0.06], hr, [0.1, 0.09, 0.08]); seg([nx1 + 0.02, ny1 + 0.32, v * 0.06], [nx1 - 0.07, ny1 + 0.36, v * 0.07], hr, [0.1, 0.09, 0.08]); }
  else if (t === 'ibex' && o.horns !== false) {
    // the great ridged horns, sweeping up and back in a long curve
    const hc = [0.3, 0.27, 0.22], big = o.horns || 1;
    for (const v of [-1, 1]) {
      let a = [nx1, ny1 + 0.08, v * 0.05];
      for (let j = 1; j <= 4; j++) {
        const an = 1.35 + j * 0.42, R = 0.42 * big;
        const b = [nx1 - 0.05 + (Math.cos(an) - Math.cos(1.35)) * R, ny1 + 0.08 + (Math.sin(an) - Math.sin(1.35)) * R + 0.02 * j, v * (0.05 + 0.045 * j)];
        seg(a, b, hr * (1.7 - 0.25 * j), hc);
        a = b;
      }
    }
  } else if (t === 'deer' && o.antlers) {
    const ac = [0.5, 0.42, 0.3];
    for (const v of [-1, 1]) {
      const a = [nx1, ny1 + 0.08, v * 0.06], b = [nx1 - 0.2, ny1 + 0.5, v * 0.32], c = [nx1 - 0.08, ny1 + 0.95, v * 0.4];
      seg(a, b, hr, ac); seg(b, c, hr * 0.9, ac);
      seg(a, [nx1 + 0.24, ny1 + 0.3, v * 0.1], hr * 0.8, ac);
      seg(b, [nx1 + 0.1, ny1 + 0.66, v * 0.34], hr * 0.8, ac);
      seg(c, [nx1 + 0.1, ny1 + 1.08, v * 0.34], hr * 0.7, ac);
      seg(c, [nx1 - 0.24, ny1 + 1.1, v * 0.44], hr * 0.7, ac);
    }
  }
  // tail
  if (t === 'cow') { seg([-S.bl * 0.98, S.bh + 0.08, 0], [-S.bl * 1.08, S.bh - 0.7, 0], lr * 0.6, col); E(-S.bl * 1.09, S.bh - 0.8, 0, 0.05, 0.1, 0.05, dark); }
  else E(-S.bl * 0.95, S.bh + 0.02, 0, 0.06, 0.09, 0.05, t === 'deer' ? pale : dark);
  // the bell: brass, on a broad strap round the neck
  if (o.bell) {
    E(nx0 + 0.08, ny0 - 0.05, 0, 0.07, S.br * 0.62, S.br * 0.56, [0.2, 0.13, 0.08], qn);
    E(nx0 + 0.16, ny0 - S.br * 0.75, 0, 0.11, 0.13, 0.1, [0.8, 0.62, 0.16]);
  }
  if (out0.due()) yield;
}
// A marmot sitting bolt upright by its burrow: a stout brown body, paler chest, small round head,
// forepaws held up, the mound of thrown-out earth beside it.
function marmot(ctx, out0, W, wx, d, r, k = 2.6) {
  const y = W.H(wx, d), x = wx - ctx.x0, K_ = KIND.OTHER, dir = r() < 0.5 ? -1 : 1;
  const c = jitter([0.48, 0.36, 0.2], r, 0.08), pale = [0.66, 0.54, 0.34], dark = [0.2, 0.15, 0.1];
  out0(x - dir * 0.5 * k, y + 0.05, -(d + 0.3), 0.5 * k, 0.07 * k, 0.4 * k, C.earth[0], C.earth[1], C.earth[2], 1, 0, 0, 0, 1, KIND.GROUND);
  out0(x - dir * 0.5 * k, y + 0.06, -(d + 0.3), 0.16 * k, 0.05 * k, 0.14 * k, 0.1, 0.08, 0.06, 1, 0, 0, 0, 1, KIND.GROUND);
  if (r() < 0.75) {
    out0(x, y + 0.2 * k, -d, 0.17 * k, 0.22 * k, 0.16 * k, c[0], c[1], c[2], 1, 0, 0, 0, 1, K_, FL_);
    out0(x + dir * 0.03 * k, y + 0.4 * k, -d, 0.13 * k, 0.16 * k, 0.12 * k, c[0], c[1], c[2], 1, 0, 0, 0, 1, K_, FL_);
    out0(x + dir * 0.07 * k, y + 0.3 * k, -(d - 0.08 * k), 0.09 * k, 0.17 * k, 0.07 * k, pale[0], pale[1], pale[2], 1, 0, 0, 0, 1, K_, FL_);
    out0(x + dir * 0.06 * k, y + 0.6 * k, -d, 0.09 * k, 0.085 * k, 0.085 * k, c[0], c[1], c[2], 1, 0, 0, 0, 1, K_, FL_);
    out0(x + dir * 0.14 * k, y + 0.58 * k, -d, 0.04 * k, 0.04 * k, 0.045 * k, dark[0], dark[1], dark[2], 1, 0, 0, 0, 1, K_, FL_);
    bar(out0, x + dir * 0.08 * k, y + 0.42 * k, -(d - 0.1 * k), x + dir * 0.19 * k, y + 0.36 * k, -(d - 0.1 * k), 0.03 * k, dark, 1, K_, FL_);
    out0(x - dir * 0.2 * k, y + 0.05 * k, -d, 0.16 * k, 0.045 * k, 0.05 * k, dark[0], dark[1], dark[2], 1, 0, 0, 0, 1, K_, FL_);
  } else {
    // on all fours, low
    out0(x, y + 0.16 * k, -d, 0.3 * k, 0.14 * k, 0.15 * k, c[0], c[1], c[2], 1, 0, 0, 0, 1, K_, FL_);
    out0(x + dir * 0.32 * k, y + 0.2 * k, -d, 0.1 * k, 0.09 * k, 0.09 * k, c[0], c[1], c[2], 1, 0, 0, 0, 1, K_, FL_);
    out0(x - dir * 0.36 * k, y + 0.12 * k, -d, 0.14 * k, 0.045 * k, 0.05 * k, dark[0], dark[1], dark[2], 1, 0, 0, 0, 1, K_, FL_);
  }
}
const COAT_COL = [[0.72, 0.14, 0.1], [0.14, 0.3, 0.62], [0.8, 0.56, 0.08], [0.16, 0.44, 0.24], [0.7, 0.3, 0.52], [0.78, 0.76, 0.7], [0.8, 0.36, 0.08]];
// A person. o: { yaw, k, coat, legs, pose: 'stand'|'walk'|'scythe'|'rake'|'ride'|'sit', ph, pack,
// poles, hat ('sun' = a broad straw hat, or a colour), kid, kind }
function* person(ctx, out0, wx, y, d, o) {
  const k = (o.k || FIG) * (o.kid ? 0.72 : 1), kind = o.kind != null ? o.kind : KIND.OTHER;
  const { P, E, seg, q } = figure(ctx, out0, wx, y, d, o.yaw, k, kind);
  const coat = o.coat, legC = o.legs || [0.22, 0.2, 0.2];
  const lr = Math.max(0.07 * k, thin(d)) / k, ar = Math.max(0.055 * k, thin(d, 0.8)) / k;
  const pose = o.pose || 'stand', sw = Math.sin((o.ph || 0) * Math.PI * 2);
  let lean = 0, hipH = 0.92;
  if (pose === 'scythe' || pose === 'rake') lean = 0.38; else if (pose === 'ride') { lean = 0.5; hipH = 1.0; } else if (pose === 'sit') hipH = 0.55; else if (pose === 'walk') lean = 0.1;
  if (pose === 'sit') { seg([0, hipH, 0.1], [0.42, hipH + 0.02, 0.1], lr, legC); seg([0.42, hipH, 0.1], [0.45, 0.1, 0.1], lr, legC); seg([0, hipH, -0.1], [0.42, hipH + 0.02, -0.1], lr, legC); }
  else if (pose === 'ride') { seg([0, hipH, 0.1], [0.16, 0.62, 0.12], lr, legC); seg([0.16, 0.62, 0.12], [0.08, 0.3, 0.12], lr, legC); seg([0, hipH, -0.1], [0.22, 0.75, -0.12], lr, legC); seg([0.22, 0.75, -0.12], [0.3, 0.45, -0.12], lr, legC); }
  else {
    const st = pose === 'walk' ? 0.26 * sw : pose === 'scythe' ? 0.2 : 0.04;
    seg([0, hipH, 0.1], [st, 0.04, 0.12], lr, legC);
    seg([0, hipH, -0.1], [-st, 0.04, -0.12], lr, legC);
    E(st + 0.05, 0.05, 0.12, 0.11, 0.05, 0.06, [0.2, 0.14, 0.1]);
    E(-st + 0.05, 0.05, -0.12, 0.11, 0.05, 0.06, [0.2, 0.14, 0.1]);
  }
  const qb = quatMul(q, quatRoll(-lean));
  const bh = hipH + 0.3 * Math.cos(lean), bu = Math.sin(lean) * 0.3;
  E(bu, bh, 0, 0.19, 0.33, 0.18, coat, qb);
  E(bu * 0.3, hipH + 0.02, 0, 0.2, 0.13, 0.19, legC, qb);
  const nu = Math.sin(lean) * 0.62, nh = hipH + 0.64 * Math.cos(lean);
  if (o.pack) E(nu * 0.5 - 0.24, bh + 0.05, 0, 0.14, 0.26, 0.17, o.pack, qb);
  if (pose === 'scythe') {
    // both arms out, the long snath across the body, the blade low in the grass
    seg([nu, nh - 0.05, 0.2], [nu + 0.42, nh - 0.42, 0.25], ar, coat); seg([nu, nh - 0.05, -0.2], [nu + 0.3, nh - 0.3, -0.22], ar, coat);
    seg([nu + 0.1, nh - 0.1, -0.3], [nu + 0.75, 0.16, 0.4], ar * 0.7, [0.5, 0.4, 0.26], 2);
    seg([nu + 0.75, 0.16, 0.4], [nu + 1.25, 0.1, -0.15], ar * 0.6, [0.62, 0.63, 0.66], 1);
  } else if (pose === 'rake') {
    seg([nu, nh - 0.05, 0.2], [nu + 0.4, nh - 0.4, 0.2], ar, coat); seg([nu, nh - 0.05, -0.2], [nu + 0.28, nh - 0.2, -0.2], ar, coat);
    seg([nu + 0.05, nh + 0.25, 0], [nu + 1.1, 0.08, 0], ar * 0.7, [0.52, 0.42, 0.28], 2);
    seg([nu + 1.1, 0.1, -0.3], [nu + 1.1, 0.1, 0.3], ar * 0.7, [0.52, 0.42, 0.28], 1);
  } else if (pose === 'ride') {
    seg([nu, nh - 0.05, 0.2], [nu + 0.42, nh - 0.42, 0.2], ar, coat); seg([nu, nh - 0.05, -0.2], [nu + 0.42, nh - 0.42, -0.2], ar, coat);
  } else if (o.poles) {
    seg([nu, nh - 0.05, 0.21], [nu + 0.28 + 0.12 * sw, nh - 0.42, 0.27], ar, coat); seg([nu, nh - 0.05, -0.21], [nu + 0.28 - 0.12 * sw, nh - 0.42, -0.27], ar, coat);
    seg([nu + 0.3 + 0.12 * sw, nh - 0.36, 0.27], [nu + 0.5 + 0.25 * sw, 0.02, 0.3], ar * 0.5, [0.3, 0.3, 0.32]);
    seg([nu + 0.3 - 0.12 * sw, nh - 0.36, -0.27], [nu + 0.5 - 0.25 * sw, 0.02, -0.3], ar * 0.5, [0.3, 0.3, 0.32]);
  } else {
    seg([nu, nh - 0.05, 0.21], [nu + 0.15 * sw, hipH + 0.05, 0.27], ar, coat);
    seg([nu, nh - 0.05, -0.21], [nu - 0.15 * sw, hipH + 0.05, -0.27], ar, coat);
  }
  const hu = nu + 0.04, hhd = nh + 0.2;
  E(hu, hhd, 0, 0.11, 0.12, 0.11, C.skin);
  if (o.hat === 'sun') E(hu, hhd + 0.11, 0, 0.26, 0.04, 0.26, [0.76, 0.68, 0.44]);
  else E(hu - 0.01, hhd + 0.09, 0, 0.12, 0.07, 0.12, o.hat || [0.3, 0.2, 0.12]);
  void P;
  if (out0.due()) yield;
}
// A bicycle and its rider, heading along the road.
function* cyclist(ctx, out0, wx, y, d, yaw, r, k = 1.45) {
  const { P, seg } = figure(ctx, out0, wx, y, d, yaw, k, KIND.OTHER);
  const tr = Math.max(0.03 * k, thin(d, 0.8)) / k, dk = [0.08, 0.08, 0.09];
  // wheels: rings of short struts
  for (const u of [-0.52, 0.52]) for (let j = 0; j < 6; j++) {
    const a0 = j / 6 * Math.PI * 2, a1 = (j + 1) / 6 * Math.PI * 2, R = 0.34;
    seg([u + Math.cos(a0) * R, 0.36 + Math.sin(a0) * R, 0], [u + Math.cos(a1) * R, 0.36 + Math.sin(a1) * R, 0], tr, dk);
  }
  const fc = COAT_COL[Math.floor(r() * COAT_COL.length)];
  seg([-0.52, 0.36, 0], [-0.1, 0.92, 0], tr, fc); seg([-0.1, 0.92, 0], [0.42, 0.88, 0], tr, fc); seg([0.42, 0.88, 0], [0.52, 0.36, 0], tr, fc); seg([-0.1, 0.92, 0], [0.08, 0.36, 0], tr, fc); seg([0.08, 0.36, 0], [0.42, 0.88, 0], tr, fc);
  const ci = Math.floor(r() * COAT_COL.length);
  const p = P(-0.12, 0, 0);
  yield* person(ctx, out0, p[0] + ctx.x0, y, -p[2], { yaw, k, coat: COAT_COL[ci], legs: [0.08, 0.08, 0.1], pose: 'ride', hat: COAT_COL[(ci + 3) % COAT_COL.length] });
}
// A box on wheels heading along yaw: a post bus (yellow, a red band, a white roof), a car, or a
// tractor with a trailer of hay. Sides, ends and top are all drawn; the window sees the top.
function* vehicle(ctx, out0, W, wx, d, yaw, type, r, k = 1.25) {
  const y = W.H(wx, d) + 0.08, rng = r, K_ = KIND.OTHER;
  const out = (x_, y_, z_, sx, sy, sz, cr, cg, cb, o_ = 1, qx = 0, qy = 0, qz = 0, qw = 1, kd = K_, mv = STL) => out0(x_, y_, z_, sx, sy, sz, cr, cg, cb, o_, qx, qy, qz, qw, kd, mv || STL);
  out.due = out0.due;
  const s = Math.max(0.12, detail(out0, d, 1.0));
  const box = function* (u0, L, Wd, H, y0, paintSide, top) {
    const f = frame(ctx, wx, y + y0 * k, d, yaw);
    const { P, V } = f;
    for (const sg of [1, -1]) {
      const tone = [sg * f.fx, sg * f.fz];
      yield* panel(out, P((u0 - L / 2) * k, 0, sg * Wd / 2 * k), V(1, 0, 0), V(0, 1, 0), L * k, H * k, s, (a, b) => faceTone(paintSide(a, b), tone[0], tone[1]), K_, rng, 0.15);
      const t2 = [sg * f.ex, sg * f.ez];
      yield* panel(out, P((u0 + sg * L / 2) * k, 0, Wd / 2 * k), V(0, 0, -1), V(0, 1, 0), Wd * k, H * k, s, (a, b) => faceTone(paintSide(sg > 0 ? 0.97 : 0.03, b, true), t2[0], t2[1]), K_, rng, 0.15);
    }
    yield* panel(out, P((u0 - L / 2) * k, H * k, -Wd / 2 * k), V(1, 0, 0), V(0, 0, 1), L * k, Wd * k, s, () => top, K_, rng, 0.15);
  };
  const wheels = (us, R, Wd) => { const f = frame(ctx, wx, y, d, yaw), q = quatYaw(yaw); for (const u of us) for (const sg of [1, -1]) { const p = f.P(u * k, R * k, sg * (Wd / 2 + 0.02) * k); out(p[0], p[1], p[2], R * k, R * k, 0.12 * k, 0.07, 0.07, 0.08, 1, q[0], q[1], q[2], q[3]); } };
  if (type === 'bus') {
    const Y = [0.8, 0.62, 0.04], G = [0.1, 0.13, 0.17];
    yield* box(0, 11, 2.5, 2.9, 0.35, (a, b, end) => (b > 0.5 && b < 0.84 && (end || (a > 0.03 && a < 0.97 && (a * 9) % 1 > 0.14)) ? G : b < 0.22 && b > 0.1 ? [0.75, 0.1, 0.08] : Y), [0.78, 0.77, 0.72]);
    wheels([-3.6, 3.6], 0.5, 2.5);
  } else if (type === 'car') {
    const c = [[0.7, 0.1, 0.08], [0.12, 0.24, 0.5], [0.62, 0.63, 0.65], [0.1, 0.1, 0.12], [0.78, 0.76, 0.7]][Math.floor(r() * 5)], G = [0.1, 0.13, 0.17];
    yield* box(0, 4.2, 1.8, 0.75, 0.3, () => c, c);
    yield* box(-0.2, 2.2, 1.6, 0.6, 1.05, (a, b) => (b < 0.85 ? G : c), c);
    wheels([-1.3, 1.3], 0.33, 1.8);
  } else {
    const c = r() < 0.5 ? [0.7, 0.1, 0.08] : [0.12, 0.42, 0.16];
    yield* box(0.9, 1.9, 1.1, 0.85, 0.75, () => c, c);                        // the bonnet
    wheels([-0.6], 0.82, 1.7); wheels([1.5], 0.45, 1.5);
    const f = frame(ctx, wx, y, d, yaw), tr = Math.max(0.05 * k, thin(d));
    for (const [u, v] of [[-1.1, 0.6], [-1.1, -0.6], [0.1, 0.6], [0.1, -0.6]]) { const a = f.P(u * k, 1.3 * k, v * k), b = f.P(u * k, 2.55 * k, v * k); bar(out, a[0], a[1], a[2], b[0], b[1], b[2], tr, [0.15, 0.15, 0.16], 2, K_, STL); }
    { const p = f.P(-0.5 * k, 2.6 * k, 0), q = quatYaw(yaw); out(p[0], p[1], p[2], 0.8 * k, 0.06 * k, 0.75 * k, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3]); }
    const pp = f.P(-0.6 * k, 0.85 * k, 0);
    yield* person(ctx, out0, pp[0] + ctx.x0, pp[1], -pp[2], { yaw, k: k * 0.95, coat: [0.24, 0.34, 0.6], pose: 'sit', hat: 'sun' });
    // the trailer, heaped with hay
    yield* box(-4.1, 3.4, 1.9, 0.7, 0.7, () => [0.36, 0.26, 0.16], C.hay);
    wheels([-4.1], 0.42, 1.9);
    for (let j = 0; j < 5; j++) { const p = f.P((-5.3 + j * 0.6 + 0.3 * r()) * k, (1.75 + 0.3 * r()) * k, (r() - 0.5) * 0.6 * k); const hc = jitter(C.hay, r, 0.12); out(p[0], p[1], p[2], 0.75 * k, 0.5 * k, 0.8 * k, hc[0], hc[1], hc[2], 1, 0, 0, 0, 1); }
  }
  if (out0.due()) yield;
}

// ---------------------------------------------------------------------------------------------
// Life on the valley floor
// ---------------------------------------------------------------------------------------------
function* herds(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 40) / COWCELL), i1 = Math.floor((ctx.x0 + ctx.length + 40) / COWCELL);
  for (let i = i0; i <= i1; i++) {
    const g = herd(W, i);
    if (!g) continue;
    for (const a of g.list) {
      if (!inD(a.d, dLo, dHi) || !inX(ctx, a.wx, 3) || !openGround(W, a.wx, a.d) || siteNear(W, a.wx, a.d, 2)) continue;
      const ct = COATS[a.coat];
      yield* beast(ctx, out, a.wx, W.H(a.wx, a.d) - 0.04, a.d, { type: 'cow', yaw: a.yaw, k: FIG * (a.calf ? 0.66 : 1), col: ct.c, pale: ct.pale, pied: ct.pied, graze: a.graze, lying: a.lying, bell: !a.calf, ph: a.ph });
    }
  }
}
// Goats near the barns and on the banks; ibex or chamois on an outcrop of rock; marmots by the
// line; red deer at the edge of a wood.
function* smallStock(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, GOATCELL, 20)) {
    const g = goatSpot(W, i);
    if (!g) continue;
    const r = worldRng(ctx, 622, i), wx = g.wx, d0 = g.d, n = 3 + Math.floor(r() * 4);
    for (let j = 0; j < n; j++) {
      const ax = wx + (r() - 0.5) * 12, ad = d0 + (r() - 0.5) * 6, yaw = r() * Math.PI * 2, wh = r() < 0.5, gz = r() < 0.5, ph = r();
      if (!inD(ad, dLo, dHi) || !inX(ctx, ax, 2) || !openGround(W, ax, ad) || siteNear(W, ax, ad, 2)) continue;
      note('goat', ax, ad);
      yield* beast(ctx, out, ax, W.H(ax, ad) - 0.03, ad, { type: 'goat', yaw, k: 2.0, col: wh ? [0.74, 0.72, 0.66] : [0.4, 0.28, 0.18], pale: [0.76, 0.74, 0.7], graze: gz, bell: true, ph });
    }
  }
}
function outcrop(W, i) {
  return cache(W, ST.ROCKS, i, () => {
    const r = makeRng(hashInts(W.ws, 631, i));
    if (r() > 0.6) return null;
    const wx = (i + 0.2 + 0.6 * r()) * ROCKCELL;
    const zn = zoneAt(W, wx, r() < 0.4 ? 1 : 2) || zoneAt(W, wx, 2);
    const d = zn[0] + 4 + (zn[1] - zn[0] - 4) * r() * 0.8;
    if (siteNear(W, wx, d, 14) || isForest(W, wx, d)) return null;
    return { i, wx, d, R: 4.5 + 3 * r(), H: 3.4 + 2.6 * r(), chamois: r() < 0.35, n: 2 + Math.floor(r() * 2), seed: hashInts(W.ws, 632, i) };
  });
}
function* outcrops(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, ROCKCELL, 30)) {
    const oc = outcrop(W, i);
    if (!oc || !inD(oc.d, dLo, dHi) || !inX(ctx, oc.wx, 16)) continue;
    const r = makeRng(oc.seed), y = W.H(oc.wx, oc.d), x = oc.wx - ctx.x0;
    // a pile of grey blocks, each a kit facetRock(): flat facets with hard edges, one tone a facet,
    // turf on the tops (they were clouds of round splats over ellipsoids, soft-edged and woolly).
    // Each block's top stays where the old lump's was, so the animals still stand on it.
    const lumps = [[0, oc.H * 0.5, 0, oc.R * 0.6, oc.H * 0.55], [-oc.R * 0.55, oc.H * 0.28, 0.6, oc.R * 0.5, oc.H * 0.34], [oc.R * 0.6, oc.H * 0.24, -0.4, oc.R * 0.46, oc.H * 0.3], [oc.R * 0.2, oc.H * 0.16, 1.6, oc.R * 0.5, oc.H * 0.2]];
    for (const [lx, ly, lz, rx, ry] of lumps) {
      const col = mix3(C.rock, C.rockDark, 0.1 + 0.3 * r());
      facetRock(out, x + lx, y, oc.d + lz, rx, (ly + ry) * 1.04, rx * 0.7, { color: col, rng: r, slab: 0.6, sink: 0.25, moss: 0.4, mossColor: C.turf, lichen: 0.35 });
      if (out.due()) yield;
    }
    for (let j = 0; j < 8; j++) { const a = r() * 6.28, c = FL[r() < 0.5 ? 12 : 3].c; out(x + Math.cos(a) * oc.R * 0.9, y + 0.5 + r() * oc.H * 0.3, -(oc.d - Math.abs(Math.sin(a)) * oc.R * 0.6), 0.2, 0.16, 0.16, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER); }
    // the animals standing on it
    const spots = [[0, oc.H * 1.04, 0], [-oc.R * 0.55, oc.H * 0.6, 0.6], [oc.R * 0.6, oc.H * 0.52, -0.4]];
    for (let j = 0; j < oc.n; j++) {
      const [lx, ly, lz] = spots[j], yaw = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.6;
      if (oc.chamois) yield* beast(ctx, out, oc.wx + lx, y + ly, oc.d + lz, { type: 'chamois', yaw, k: 1.8, col: [0.3, 0.2, 0.13], pale: [0.72, 0.66, 0.54] });
      else yield* beast(ctx, out, oc.wx + lx, y + ly, oc.d + lz, { type: 'ibex', yaw, k: 1.8, col: [0.46, 0.36, 0.25], pale: [0.64, 0.56, 0.44], horns: j === 0 ? 1.15 : 0.7 });
    }
  }
}
function* marmots(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, MARCELL, 6)) {
    const g = marmotSpot(W, i);
    if (!g) continue;
    const r = worldRng(ctx, 643, i), wx = g.wx, d0 = g.d, n = 1 + Math.floor(r() * 3);
    for (let j = 0; j < n; j++) {
      const ax = wx + (r() - 0.5) * 7, ad = d0 + (r() - 0.5) * 3, rr = makeRng(hashInts(W.ws, 642, i, j));
      if (!inD(ad, dLo, dHi) || !inX(ctx, ax, 2) || !openGround(W, ax, ad) || siteNear(W, ax, ad, 2)) continue;
      note('marmot', ax, ad);
      marmot(ctx, out, W, ax, ad, rr);
    }
    if (out.due()) yield;
  }
}
function deerGroup(W, i) {
  return cache(W, ST.DEER, i, () => {
    const r = makeRng(hashInts(W.ws, 651, i));
    if (r() > 0.7) return null;
    const wx = (i + 0.2 + 0.6 * r()) * DEERCELL;
    let d = 0;
    for (let dd = 104; dd < 290; dd += 4) { if (isForest(W, wx, dd)) { d = dd; break; } }
    if (!d) return null;
    const dc = d - 7 - 8 * r();
    if (!openGround(W, wx, dc) || siteNear(W, wx, dc, 10)) return null;
    return { i, wx, d: dc, n: 2 + Math.floor(r() * 3), seed: hashInts(W.ws, 652, i) };
  });
}
function* deer(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, DEERCELL, 30)) {
    const g = deerGroup(W, i);
    if (!g) continue;
    const r = makeRng(g.seed);
    for (let j = 0; j < g.n; j++) {
      const wx = g.wx + (r() - 0.5) * 9 * Math.sqrt(g.n), d = g.d + (r() - 0.5) * 6, yaw = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 1.0, gz = r() < 0.4, hue = r();
      if (!inD(d, dLo, dHi) || !inX(ctx, wx, 3)) continue;
      yield* beast(ctx, out, wx, W.H(wx, d) - 0.04, d, { type: 'deer', yaw, k: 2.1, col: mix3([0.5, 0.3, 0.15], [0.42, 0.25, 0.14], hue), pale: [0.72, 0.62, 0.46], graze: gz && j > 0, antlers: j === 0 });
    }
  }
}
// A golden eagle soaring, or a flock of choughs (black, yellow bills), over the meadows near the
// line. They fly (MOVE.FLY): everything in one flight cell goes the same way, wings drawn up.
function* birds(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, BIRDCELL, 30)) {
    const r = worldRng(ctx, 661, i);
    if (r() > 0.7) continue;
    const fc = flightCell(wx0 + r() * BIRDCELL), d = 46 + 62 * r(), eagle = r() < 0.45;
    if (!inD(d, dLo, dHi) || !inX(ctx, fc.wx, 12)) continue;
    const y0 = W.H(fc.wx, d) + (eagle ? 16 + 14 * r() : 9 + 10 * r()), K_ = KIND.OTHER, dir = fc.dir;
    note(eagle ? 'eagle' : 'choughs', fc.wx, d, y0);
    if (eagle) {
      const S = 2.0, x = fc.wx - ctx.x0, z = -d, c = [0.24, 0.17, 0.1], cl = [0.4, 0.3, 0.17];
      flyBody(out, x, y0, z, 0.5 * S, 0.14 * S, c, Q_ID, K_);
      flyBody(out, x + dir * 0.5 * S, y0 + 0.03, z, 0.16 * S, 0.1 * S, [0.6, 0.5, 0.3], Q_ID, K_);          // the golden nape
      flyBody(out, x + dir * 0.7 * S, y0 - 0.02, z, 0.08 * S, 0.04 * S, [0.8, 0.66, 0.2], Q_ID, K_);        // bill
      flyBody(out, x - dir * 0.62 * S, y0 - 0.02, z, 0.26 * S, 0.1 * S, c, Q_ID, K_);                       // tail
      for (const sg of [-1, 1]) {
        flyWing(out, x, y0 + 0.02, z, x - dir * 0.05 * S, y0 + 0.3 * S, z + sg * 0.75 * S, limb(0.17 * S, d), cl, 3, y0, K_);
        flyWing(out, x - dir * 0.05 * S, y0 + 0.3 * S, z + sg * 0.75 * S, x - dir * 0.2 * S, y0 + 0.42 * S, z + sg * 1.6 * S, limb(0.13 * S, d), c, 3, y0, K_);
      }
    } else {
      const n = 6 + Math.floor(r() * 6), S = 1.5;
      for (let j = 0; j < n; j++) {
        const x = fc.wx - ctx.x0 + (r() - 0.5) * 16, y = y0 + (r() - 0.5) * 6, z = -(d + (r() - 0.5) * 8), c = [0.06, 0.06, 0.07];
        flyBody(out, x, y, z, 0.24 * S, 0.08 * S, c, Q_ID, K_);
        flyBody(out, x + dir * 0.28 * S, y, z, 0.07 * S, 0.035 * S, [0.8, 0.66, 0.1], Q_ID, K_);
        for (const sg of [-1, 1]) flyWing(out, x, y, z, x - dir * 0.08 * S, y + 0.28 * S, z + sg * 0.5 * S, limb(0.09 * S, d), c, 2, y, K_);
      }
    }
    if (out.due()) yield;
  }
}
// Hikers on the path along the river bank: two to four in bright jackets, packs on their backs,
// walking with poles. A farmer with a scythe in the hay, another raking, and the hay drying on
// racks in rows.
const HIKECELL = 520, HAYCELL = 430;
function pathD(x) { return x.rc - x.rw * 0.5 - 4.5; }
function pathOn(x) { return pathD(x) - x.rd > 9; }
function* people(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, HIKECELL, 20)) {
    const r = worldRng(ctx, 671, i);
    if (r() > 0.6) continue;
    const wx = wx0 + r() * HIKECELL, n = 2 + Math.floor(r() * 3), dirn = r() < 0.5 ? 1 : -1;
    for (let j = 0; j < n; j++) {
      const ax = wx + dirn * j * (2.2 + r()), on = pathOn(xAt(W, wx)), xx = xAt(W, ax), ad = on ? pathD(xx) : xx.rc + xx.rw * 0.5 + 5;
      const sl = xx.sl, ci = Math.floor(r() * COAT_COL.length), ph = r(), kid = r() < 0.15, sun = r() < 0.4;
      if (!inD(ad, dLo, dHi) || !inX(ctx, ax, 2)) continue;
      note('hiker', ax, ad);
      yield* person(ctx, out, ax, W.H(ax, ad), ad, { yaw: Math.atan(sl) + (dirn > 0 ? 0 : Math.PI), coat: COAT_COL[ci], pose: 'walk', ph, pack: COAT_COL[(ci + 2) % COAT_COL.length], poles: !kid, hat: sun ? 'sun' : COAT_COL[(ci + 4) % COAT_COL.length], kid });
    }
  }
  for (const { i } of cellsAround(ctx, HAYCELL, 40)) {
    const g = haySpot(W, i);
    if (!g) continue;
    const r = worldRng(ctx, 682, i), wx = g.wx, d = g.d;
    // racks: a post with cross-pegs, heaped with hay drying
    const n = 4 + Math.floor(r() * 5), yawRow = (r() - 0.5) * 0.6;
    for (let j = 0; j < n; j++) {
      const ax = wx + (j - n / 2) * 4.2 * Math.cos(yawRow), ad = d + (j - n / 2) * 4.2 * Math.sin(yawRow), hk = 0.85 + 0.3 * r(), j1 = r(), j2 = r(), j3 = r();
      if (!inD(ad, dLo, dHi) || !inX(ctx, ax, 2) || !openGround(W, ax, ad)) continue;
      const y = W.H(ax, ad), x = ax - ctx.x0, k = 1.35 * hk;
      bar(out, x, y, -ad, x, y + 2.3 * k, -ad, Math.max(0.05, thin(ad)), C.timber, 3, KIND.OTHER);
      for (const [h, rr, c, jj] of [[0.7, 0.8, 0.9, j1], [1.3, 0.65, 1.0, j2], [1.8, 0.42, 1.08, j3]]) { const hc = mul3(C.hay, c * (0.92 + 0.14 * jj)); out(x, y + h * k, -ad, rr * k, 0.5 * k, rr * 0.9 * k, hc[0], hc[1], hc[2], 1, 0, 0, 0, 1, KIND.OTHER); }
      out(x + 0.1, y + 0.55 * k, -(ad - 0.5 * k), 0.6 * k, 0.4 * k, 0.3 * k, C.hay[0] * 0.72, C.hay[1] * 0.72, C.hay[2] * 0.66, 1, 0, 0, 0, 1, KIND.OTHER);
    }
    const fx = wx + (r() - 0.5) * 10, fd = d - 4 - 3 * r(), fyaw = r() * Math.PI * 2, two = r() < 0.6, ph = r();
    if (inD(fd, dLo, dHi) && inX(ctx, fx, 3) && openGround(W, fx, fd)) {
      note('farmer', fx, fd);
      yield* person(ctx, out, fx, W.H(fx, fd), fd, { yaw: fyaw, coat: [0.3, 0.42, 0.66], legs: [0.3, 0.26, 0.2], pose: 'scythe', hat: 'sun', ph, k: 1.55 });
      if (two && openGround(W, fx + 5, fd + 2)) yield* person(ctx, out, fx + 5, W.H(fx + 5, fd + 2), fd + 2, { yaw: fyaw + 2, coat: [0.74, 0.3, 0.3], legs: [0.36, 0.3, 0.5], pose: 'rake', hat: 'sun', k: 1.55 });
    }
  }
}
// Along the valley road: white marker posts with black caps, a wooden fence in stretches, and
// what is on the road: the yellow post bus, cars, a tractor with a load of hay, cyclists.
const VEHCELL = 340;
function* roadLife(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, 24, 0)) {
    const xx = xAt(W, wx0), d = xx.rd + 3.6;
    if (!inD(d, dLo, dHi) || wx0 < ctx.x0 || wx0 >= ctx.x0 + ctx.length) continue;
    const x = wx0 - ctx.x0, y = W.H(wx0, d), tr = Math.max(0.07, thin(d, 1.4));
    bar(out, x, y, -d, x, y + 1.25, -d, tr, [0.78, 0.78, 0.75], 2, KIND.FENCE);
    out(x, y + 1.05, -d, tr * 1.1, 0.16, tr * 1.1, 0.08, 0.08, 0.09, 1, 0, 0, 0, 1, KIND.FENCE);
    void i;
  }
  // the fence on the near side of the road: posts and two rails
  for (const { wx0 } of cellsAround(ctx, 3.4, 0)) {
    if (noise1(wx0 / 420, W.ws + 691) < 0.55) continue;
    const xa = xAt(W, wx0), da = xa.rd - 4.3, ya = W.H(wx0, da);
    const xb = xAt(W, wx0 + 3.4), db = xb.rd - 4.3, yb = W.H(wx0 + 3.4, db);
    if (!inD(da, dLo, dHi) || wx0 < ctx.x0 - 3.4 || wx0 >= ctx.x0 + ctx.length) continue;
    const x = wx0 - ctx.x0, tr = Math.max(0.06, thin(da, 1.3)), pc = [0.4, 0.3, 0.2];
    bar(out, x, ya - 0.1, -da, x, ya + 1.2, -da, tr, pc, 2, KIND.FENCE);
    for (const h of [0.5, 1.0]) bar(out, x, ya + h, -da, x + 3.4, yb + h, -db, tr * 0.8, mul3(pc, 1.15), 2, KIND.FENCE);
    if (out.due()) yield;
  }
  for (const { i, wx0 } of cellsAround(ctx, VEHCELL, 20)) {
    const r = worldRng(ctx, 695, i);
    if (r() > 0.6) continue;
    const wx = wx0 + r() * VEHCELL, xx = xAt(W, wx), u = r(), dirn = r() < 0.5 ? 1 : -1;
    const d = xx.rd + dirn * 1.35, yaw = Math.atan((xAt(W, wx + 4).rd - xAt(W, wx - 4).rd) / 8) + (dirn > 0 ? 0 : Math.PI);
    if (!inD(d, dLo, dHi) || !inX(ctx, wx, 12)) continue;
    note(u < 0.25 ? 'bus' : u < 0.5 ? 'tractor' : u < 0.68 ? 'car' : 'cyclists', wx, d);
    if (u < 0.25) yield* vehicle(ctx, out, W, wx, d, yaw, 'bus', r);
    else if (u < 0.5) yield* vehicle(ctx, out, W, wx, d, yaw, 'tractor', r);
    else if (u < 0.68) yield* vehicle(ctx, out, W, wx, d, yaw, 'car', r);
    else { const n = 2 + Math.floor(r() * 3); for (let j = 0; j < n; j++) { const ax = wx + dirn * j * 3.2, ad = xAt(W, ax).rd + dirn * (1.2 + 0.5 * (j % 2)); yield* cyclist(ctx, out, ax, W.H(ax, ad) + 0.05, ad, yaw, r); } }
  }
}
// The branch road: a pale ribbon across the floor from its bridge and to and fro up the slope,
// marker posts at the bends, a post bus somewhere on the climb. Drawn piecewise by every band.
function* hairpins(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, HPCELL, 260)) {
    const h = hairpin(W, i);
    if (!h) continue;
    yield* bridge(ctx, out, W, h.bridge, dLo, dHi);
    // the short link from the valley road to the bridge
    const col = ROADPALE;
    const a0 = Math.max(dLo, h.rd), a1 = Math.min(dHi, hairpinEnd(h));
    if (a1 <= a0 || !inX(ctx, h.wx, h.L + 40)) continue;
    let prev = null;
    for (let d = a0; d <= a1 + 0.01;) {
      const onSlope = d >= h.d0, step = onSlope ? Math.max(1.2, h.sp / Math.max(8, Math.round(2 * h.L / Math.max(7, d * 0.012)))) : 5;
      const wx = d < h.bridge.a ? h.wx : hairpinX(h, d);
      const y = W.H(wx, d) + 0.25 + 0.0014 * d;
      const p = [wx - ctx.x0, y, d];
      if (prev && !(d > h.bridge.a - 1 && d < h.bridge.b + 6)) {
        const dx = p[0] - prev[0], dy = p[1] - prev[1], dd = p[2] - prev[2], len = Math.hypot(dx, dy, dd);
        const q = quatBasis(dx, dy, -dd, 0, 1, 0), hw = Math.max(2.6, 0.0055 * d);
        const mx = (p[0] + prev[0]) / 2, c = jitter(col, ctx.rng, 0.05);
        if (d > 150 && mx >= -len && mx < ctx.length + len) out(mx, (p[1] + prev[1]) / 2, -(p[2] + prev[2]) / 2, len * 0.62, Math.max(0.12, 0.0016 * d), hw, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND);
      }
      prev = p;
      d += step;
      if (out.due()) yield;
    }
    // posts at the bends, and the bus
    for (let j = 0; j <= h.n; j++) {
      const d = h.d0 + j * h.sp, wx = j % 2 === 0 ? h.xa : h.xb, sg = Math.sign(wx - h.wx);
      if (!inD(d, dLo, dHi)) continue;
      for (let m = 0; m < 4; m++) {
        const px = wx + sg * (4 + 0.004 * d), pd = d + (m - 1.5) * 4, y = W.H(px, pd), tr = thin(pd, 1.5);
        if (inX(ctx, px, 1)) bar(out, px - ctx.x0, y, -pd, px - ctx.x0, y + 1.3 + 0.002 * pd, -pd, tr, m % 2 ? [0.75, 0.2, 0.12] : [0.78, 0.78, 0.75], 2, KIND.FENCE);
      }
    }
    const r = makeRng(hashInts(h.seed, 9));
    const bd = h.d0 + (1.5 + Math.floor(r() * 3)) * h.sp + 0.5 * h.sp * 0, bj = Math.floor((bd - h.d0) / h.sp);
    const bdm = h.d0 + (bj + 0.5) * h.sp, bwx = hairpinX(h, bdm);
    if (inD(bdm, dLo, dHi) && inX(ctx, bwx, 16)) {
      const dirn = bj % 2 === 0 ? Math.sign(h.xb - h.xa) : Math.sign(h.xa - h.xb);
      note('hairpin bus', bwx, bdm);
      yield* vehicle(ctx, out, W, bwx, bdm, Math.atan2(h.sp, 2 * h.L * dirn), 'bus', r, 1.25 + bdm / 420);
    }
  }
}
// The cable car: stations at each end, lattice towers with cross-arms, two cables sagging between
// them, and red gondolas hanging from the cables at even spacing. Drawn piecewise by every band.
function* cableCar(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, CCELL, 1400)) {
    const c = cable(W, i);
    if (!c) continue;
    const steel = [0.36, 0.38, 0.4], night = lightsOn(ctx);
    const ux = c.x1 - c.x0, ud = c.d1 - c.d0, ul = Math.hypot(ux, ud), ax = ux / ul, ad = ud / ul, px = -ad, pd = ax;      // along, across
    const heads = [];
    for (let j = 0; j < c.pts.length; j++) {
      const p = c.pts[j], y = W.H(p.wx, p.d), station = j === 0 || j === c.pts.length - 1;
      const Ht = station ? 7 : 19 + 4 * Math.sin(j * 1.9) + 0.004 * p.d;
      heads.push([p.wx, y + Ht, p.d]);
      if (!inD(p.d, dLo, dHi) || !inX(ctx, p.wx, 14)) continue;
      const x = p.wx - ctx.x0;
      if (station) {
        const hs = { wx: p.wx, d: p.d, seed: hashInts(c.seed, 3, j), type: 'chalet', w: 9, dep: 13, h: 6.2, pitch: 0.3, yaw: Math.atan2(ax, -ad) + (j === 0 ? 0 : Math.PI), plaster: true, baseH: 3, shut: 1, bloom: 0, smoke: false, flag: j === 0, newer: true };
        yield* chalet(ctx, out, W, hs, { night, cap: 1500, k: 1 + smooth(300, 1500, p.d) * 0.6 });
        continue;
      }
      // a lattice tower: four legs drawing together, braced on every face, a cross-arm on top
      const tr = Math.max(0.13, thin(p.d, 2.4)), b0 = 2.6 + 0.0012 * p.d, b1 = 0.7, lv = 4;
      const corner = (t, sx, sz) => { const b = lerp(b0, b1, t); return [x + (ax * sx + px * sz) * b, y - 0.3 + t * Ht, -(p.d + (ad * sx + pd * sz) * b)]; };
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) { const a = corner(0, sx, sz), b = corner(1, sx, sz); bar(out, a[0], a[1], a[2], b[0], b[1], b[2], tr, steel, 6, KIND.MAST); }
      for (let l = 0; l < lv; l++) {
        const t0 = l / lv, t1 = (l + 1) / lv;
        const ring = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
        for (let e = 0; e < 4; e++) {
          const [s0x, s0z] = ring[e], [s1x, s1z] = ring[(e + 1) % 4];
          const a = corner(t0, s0x, s0z), b = corner(t1, s1x, s1z), a2 = corner(t1, s0x, s0z), b2 = corner(t1, s1x, s1z);
          bar(out, a[0], a[1], a[2], b[0], b[1], b[2], tr * 0.6, steel, 3, KIND.MAST);
          bar(out, a2[0], a2[1], a2[2], b2[0], b2[1], b2[2], tr * 0.6, steel, 2, KIND.MAST);
        }
      }
      const arm = 3.4 + 0.0014 * p.d;
      bar(out, x - px * arm, y + Ht, -(p.d - pd * arm), x + px * arm, y + Ht, -(p.d + pd * arm), tr, steel, 4, KIND.MAST);
      for (const sg of [-1, 1]) out(x + sg * px * arm * 0.9, y + Ht - 0.3, -(p.d + sg * pd * arm * 0.9), 0.9 + 0.0006 * p.d, 0.22, 0.22, 0.16, 0.16, 0.18, 1, ...quatXTo(ax, 0, -ad), KIND.MAST);
      if (out.due()) yield;
    }
    // the cables and the gondolas
    const K = (dd) => 1.7 + dd / 380;
    for (const sg of [-1, 1]) {
      let along = sg > 0 ? 0 : 48;
      for (let j = 0; j + 1 < heads.length; j++) {
        const a = heads[j], b = heads[j + 1], span = Math.hypot(b[0] - a[0], b[2] - a[2]);
        const arm = (dd) => (3.4 + 0.0014 * dd) * 0.9, sag = span * 0.035;
        const at = (t) => { const dd = lerp(a[2], b[2], t), o = sg * arm(dd); return [lerp(a[0], b[0], t) + px * o, lerp(a[1], b[1], t) - sag * 4 * t * (1 - t) - 0.3, dd + pd * o]; };
        const segs = Math.max(5, Math.round(span / 14));
        for (let s = 0; s < segs; s++) {
          const P0 = at(s / segs), P1 = at((s + 1) / segs), dm = (P0[2] + P1[2]) / 2;
          if (!inD(dm, dLo, dHi) || !inX(ctx, (P0[0] + P1[0]) / 2, 10)) continue;
          bar(out, P0[0] - ctx.x0, P0[1], -P0[2], P1[0] - ctx.x0, P1[1], -P1[2], Math.max(0.05, thin(dm, 1.1)), [0.14, 0.14, 0.15], 3, KIND.WIRE);
        }
        for (; along < span; along += 96) {
          const t = along / span;
          if ((j === 0 && t < 0.12) || (j + 2 === heads.length && t > 0.88)) continue;
          const g = at(t);
          if (!inD(g[2], dLo, dHi) || !inX(ctx, g[0], 6)) continue;
          const k = K(g[2]), x = g[0] - ctx.x0, hang = 2.6 * k, q = quatXTo(ax, 0, -ad);
          bar(out, x, g[1], -g[2], x, g[1] - hang, -g[2], Math.max(0.06 * k, thin(g[2])), [0.2, 0.2, 0.22], 2, KIND.OTHER, STL);
          // the cabin: a box with a band of windows, red below it, a pale roof (every face drawn)
          const red = [0.76, 0.1, 0.08], glass = [0.1, 0.14, 0.2], Lc = 2.5 * k, Hc = 2.0 * k, Wc = 2.0 * k, cy0 = g[1] - hang - Hc;
          const f = frame(ctx, g[0], cy0, g[2], Math.atan2(ad, ax)), gs = Math.max(Hc / 5, detail(out, g[2], 1.2)), gr = makeRng(hashInts(c.seed, j, Math.round(along), sg));
          const side = (a_, b_) => (b_ > 0.45 && b_ < 0.82 && a_ > 0.08 && a_ < 0.92 ? glass : red);
          for (const s2 of [1, -1]) {
            yield* panel(out, f.P(-Lc / 2, 0, s2 * Wc / 2), f.V(1, 0, 0), f.V(0, 1, 0), Lc, Hc, gs, (a_, b_) => faceTone(side(a_, b_), s2 * f.fx, s2 * f.fz), KIND.OTHER, gr, 0.2, STL);
            yield* panel(out, f.P(s2 * Lc / 2, 0, Wc / 2), f.V(0, 0, -1), f.V(0, 1, 0), Wc, Hc, gs, (a_, b_) => faceTone(side(a_, b_), s2 * f.ex, s2 * f.ez), KIND.OTHER, gr, 0.2, STL);
          }
          yield* panel(out, f.P(-Lc / 2, Hc, -Wc / 2), f.V(1, 0, 0), f.V(0, 0, 1), Lc, Wc, gs, () => [0.72, 0.72, 0.7], KIND.OTHER, gr, 0.2, STL);
          void q;
        }
        along -= span;
      }
      if (out.due()) yield;
    }
  }
}
// Waterfalls: where a brook comes over the cliff band, a white column falling to the valley,
// spray billowing at its foot (MOVE.VAPOUR); above the lip, the white thread of the stream.
// The torrents that run down from the glaciers are white threads too.
function* waterfalls(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, BRCELL, 260)) {
    const b = brook(W, i);
    if (!b || !b.fall) continue;
    const f = fallOf(W, b);
    const r = makeRng(b.seed), x = f.wx - ctx.x0;
    if (inD(f.d, dLo, dHi) && inX(ctx, f.wx, 30)) {
      const fall = f.yTop - f.yBot, s = Math.max(0.5, detail(out, f.d, 1.3)), nf = Math.max(8, Math.round(fall / (s * 1.2)));
      const salt = b.seed & 0xffff;
      for (let k = 0; k < nf; k++) {
        const t = (k + 0.5) / nf, w = 2.2 + 0.004 * f.d + (3 + 0.006 * f.d) * t;
        for (const u of [-0.5, 0, 0.5]) {
          const c = mul3(C.foam, 0.84 + 0.16 * noise1(t * 20 + u * 3, salt));
          out(x + u * w + 2 * Math.sin(t * 5 + u), f.yTop - t * fall, -(lerp(f.dTop - 8, f.d - 8, t) + 0.05 * u), w * 0.45, Math.max(fall / nf * 0.8, s), 0.4, c[0], c[1], c[2], 0.93, 0, 0, 0, 1, KIND.OTHER);
        }
        if (out.due()) yield;
      }
      for (let k = 0; k < 9; k++) {
        const a = r() * Math.PI * 2, rr = 4 + 10 * r(), sp = 4 + 6 * r() + 0.004 * f.d;
        out(x + Math.cos(a) * rr, f.yBot + 1 + sp * 0.5, -(f.d - 12 + Math.sin(a) * 3), sp, sp * 0.7, sp * 0.6, 0.8, 0.8, 0.8, 0.3, 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
      }
    }
    // the stream above the lip
    let prev = null;
    for (let d = Math.max(dLo, f.dTop); d < Math.min(dHi, f.dTop + 700); d += 16) {
      const wx = brookX(b, d), p = [wx - ctx.x0, W.H(wx, d) + 0.6, d];
      if (prev && inX(ctx, wx, 20)) bar(out, prev[0], prev[1], -prev[2], p[0], p[1], -p[2], Math.max(0.8, 0.0013 * d), C.foam, 2, KIND.OTHER, 0, 0.9);
      prev = p;
    }
  }
  for (const { i } of cellsAround(ctx, GLCELL, 700)) {
    const g = sideValley(W, i);
    if (!g || !g.glacier) continue;
    let prev = null;
    for (let d = Math.max(dLo, 420); d < Math.min(dHi, g.snout + 60); d += Math.max(14, d * 0.012)) {
      const wx = g.wx + g.bend * (d - 1500) + 120 * Math.sin(d / 900 + g.i) + 18 * Math.sin(d / 70 + g.i);
      if (d < xAt(W, wx).ft + 30) { prev = null; continue; }
      const p = [wx - ctx.x0, W.H(wx, d) + 0.8, d];
      if (prev && inX(ctx, wx, 30)) bar(out, prev[0], prev[1], -prev[2], p[0], p[1], -p[2], Math.max(0.9, 0.0012 * d), C.foam, 2, KIND.OTHER, 0, 0.92);
      prev = p;
      if (out.due()) yield;
    }
  }
}
// The halt: a low platform on its shelf, lamp posts beyond 6 m, a wooden station building with
// flower boxes and a flag, a nameboard, a bench, people waiting.
function* haltProps(ctx, out, W) {
  const night = lightsOn(ctx);
  for (const { i } of cellsAround(ctx, HCELL, 200)) {
    const h = halt(W, i);
    if (!h) continue;
    const a = Math.max(0, h.x0 - ctx.x0), b = Math.min(ctx.length, h.x0 + h.len - ctx.x0);
    if (b > a) {
      const st = 0.4;
      for (let x = a + st / 2; x < b; x += st) {
        out(x, 0.3, -2.75, st * 0.7, 0.3, 0.1, 0.46, 0.45, 0.43, 1, 0, 0, 0, 1, KIND.OTHER);
        for (let d = 2.9; d < 6.4; d += 0.45) {
          const c = d < 3.4 ? [0.78, 0.76, 0.7] : jitter([0.52, 0.5, 0.47], ctx.rng, 0.05);
          out(x, 0.6, -d, st * 0.7, 0.05, 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
        }
        if (out.due()) yield;
      }
      for (let wx = Math.ceil(h.x0 / 18) * 18; wx < h.x0 + h.len; wx += 18) {
        const x = wx - ctx.x0;
        if (x < 0 || x >= ctx.length) continue;
        bar(out, x, 0.6, -6.6, x, 4.3, -6.6, 0.07, [0.16, 0.22, 0.18], 5, KIND.MAST);
        bar(out, x, 4.3, -6.6, x, 4.3, -6.15, 0.05, [0.16, 0.22, 0.18], 1, KIND.MAST);
        if (night) { out(x, 4.15, -6.15, 0.1, 0.1, 0.1, LAMP[0], LAMP[1], LAMP[2], 1, 0, 0, 0, 1, KIND.LIGHT, MOVE.CHASE); out(x, 4.15, -6.2, 0.45, 0.45, 0.3, LAMP[0], LAMP[1], LAMP[2], 0.18, 0, 0, 0, 1, KIND.LIGHT, MOVE.CHASE); }
        else out(x, 4.15, -6.15, 0.14, 0.1, 0.14, 0.7, 0.7, 0.66, 1, 0, 0, 0, 1, KIND.MAST);
        // a tub of flowers at the foot of each post
        out(x, 0.85, -6.9, 0.32, 0.2, 0.3, 0.8, 0.14, 0.1, 1, 0, 0, 0, 1, KIND.OTHER);
        out(x, 0.68, -6.9, 0.3, 0.14, 0.28, 0.3, 0.2, 0.12, 1, 0, 0, 0, 1, KIND.OTHER);
      }
    }
    const sx = h.x0 + h.len * 0.55;
    if (inX(ctx, sx, 14)) {
      const hs = { wx: sx, d: 10.2, seed: hashInts(h.seed, 3), type: 'chalet', w: 5.2, dep: 9, h: 3.3, pitch: 0.34, yaw: Math.PI / 2, plaster: false, baseH: 1.0, shut: 0, bloom: 0, smoke: false, flag: false, newer: false };
      yield* chalet(ctx, out, W, hs, { night, cap: 6000, y: 0.25 });
      const nx = h.x0 + h.len * 0.25 - ctx.x0;
      if (nx > -3 && nx < ctx.length + 3) {
        for (const u of [-1.3, 1.3]) bar(out, nx + u, 0.4, -6.7, nx + u, 2.6, -6.7, 0.06, [0.16, 0.22, 0.18], 2, KIND.MAST);
        out(nx, 2.3, -6.72, 1.6, 0.32, 0.05, 0.12, 0.18, 0.4, 1, 0, 0, 0, 1, KIND.OTHER);
        out(nx, 2.3, -6.68, 1.2, 0.08, 0.04, 0.78, 0.78, 0.76, 1, 0, 0, 0, 1, KIND.OTHER);
      }
      const fpx = sx - 9 - ctx.x0;
      if (fpx > -2 && fpx < ctx.length + 2) { bar(out, fpx, 0.5, -7.2, fpx, 6.6, -7.2, 0.07, [0.72, 0.72, 0.7], 5, KIND.MAST); flag(out, fpx, 5.8, -7.2, 0.6, KIND.MAST); }
    }
    // people waiting (beyond 6 m)
    const r = makeRng(hashInts(h.seed, 5));
    for (let j = 0; j < 4; j++) {
      const wx = h.x0 + h.len * (0.3 + 0.5 * r()), ci = Math.floor(r() * COAT_COL.length), yaw = -Math.PI / 2 + (r() - 0.5), pk = r() < 0.6;
      if (r() < 0.7 && inX(ctx, wx, 1)) yield* person(ctx, out, wx, 0.62, 6.7, { yaw, k: 1.0, coat: COAT_COL[ci], pack: pk ? COAT_COL[(ci + 2) % 7] : null, hat: r() < 0.4 ? 'sun' : COAT_COL[(ci + 3) % 7] });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Level 1
// ---------------------------------------------------------------------------------------------
// Scale: flowers the size of trees standing in the meadows: a stem as thick as a trunk, long
// leaves, and a head in the form of its kind (a daisy's ring of petals round an eye, a poppy's
// bowl, a bellflower's hanging bells, a spire, an umbel).
function* giantFlower(ctx, out, x, y0, d, H, F, r) {
  const K_ = KIND.SURREAL, z = -d;
  const lx = (r() - 0.5) * 0.3 * H, ld = (r() - 0.5) * 0.12 * H, sr = Math.max(H * 0.014, thin(d, 1.5));
  const at = (t) => [x + lx * t * t, y0 + H * t, z - ld * t * t];
  const stemTop = F.form === 'spike' ? 0.55 : 0.93;
  let a = at(0);
  for (let j = 1; j <= 4; j++) { const b = at(stemTop * j / 4); bar(out, a[0], a[1], a[2], b[0], b[1], b[2], sr * (1.3 - 0.12 * j), GRASS_STEM, 2, K_); a = b; }
  for (let j = 0; j < 3; j++) {
    const p = at(0.14 + 0.13 * j), sg = j % 2 ? 1 : -1, ll = H * (0.2 - 0.03 * j);
    ell(out, p[0] + sg * ll * 0.45, p[1] + ll * 0.25, p[2] + 0.2, ll * 0.5, ll * 0.13, ll * 0.06, sg, 0.55, 0.1, mul3(GRASS_STEM, 0.9 + 0.3 * r()), K_);
  }
  const top = at(stemTop), c = F.c, R = H * (0.12 + 0.05 * r());
  if (F.form === 'spike') {
    const n = 12;
    for (let j = 0; j < n; j++) {
      const t = j / (n - 1), p = at(0.52 + 0.46 * t), w = R * 0.55 * (1 - 0.75 * t) + R * 0.05, sg = j % 2 ? 1 : -1, kc = 0.85 + 0.25 * r();
      out(p[0] + sg * w * 0.5, p[1], p[2] + 0.1 * sg, w, H * 0.035, w * 0.8, c[0] * kc, c[1] * kc, c[2] * kc, 1, 0, 0, 0, 1, K_);
    }
  } else if (F.form === 'bell') {
    for (let j = 0; j < 4; j++) {
      const p = at(0.93 - 0.11 * j), sg = j % 2 ? 1 : -1, bx = p[0] + sg * R * 0.75, by = p[1] - R * 0.5;
      bar(out, p[0], p[1], p[2], bx, p[1] + R * 0.1, p[2], sr * 0.5, GRASS_STEM, 1, K_);
      out(bx, by, p[2], R * 0.42, R * 0.55, R * 0.4, c[0], c[1], c[2], 1, 0, 0, 0, 1, K_);
      out(bx, by - R * 0.5, p[2] + 0.05, R * 0.55, R * 0.16, R * 0.5, Math.min(0.8, c[0] * 1.25), Math.min(0.8, c[1] * 1.25), Math.min(0.8, c[2] * 1.15), 1, 0, 0, 0, 1, K_);
    }
  } else if (F.form === 'umbel') {
    for (let j = 0; j < 9; j++) {
      const an = j / 9 * Math.PI * 2, ex = Math.cos(an) * R * 1.1, ez = Math.sin(an) * R * 0.5, ey = R * (0.5 + 0.12 * Math.sin(an * 2));
      bar(out, top[0], top[1], top[2], top[0] + ex, top[1] + ey, top[2] + ez, sr * 0.4, GRASS_STEM, 1, K_);
      out(top[0] + ex, top[1] + ey + R * 0.08, top[2] + ez, R * 0.36, R * 0.1, R * 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, K_);
    }
  } else {
    // a flat head facing up and toward the window: petals in its plane round the eye
    const poppy = F.name === 'poppy', np = poppy ? 5 : 12;
    const tilt = 0.75 + 0.3 * r(), rot = r() * 6.28;
    const ny = Math.cos(tilt), nz = Math.sin(tilt), e1 = [1, 0, 0], e2 = [0, -nz, ny];
    for (let j = 0; j < np; j++) {
      const an = j / np * Math.PI * 2 + rot, ca = Math.cos(an), sa = Math.sin(an);
      const ux = e1[0] * ca, uy = e2[1] * sa + (poppy ? 0.35 : 0.08), uz = e2[2] * sa;
      const bx = ny * uz - nz * uy, by = nz * ux, bz = -ny * ux;
      const q = quatBasis(ux, uy, uz, bx, by, bz), kc = 0.86 + 0.2 * r(), f = poppy ? 0.5 : 0.62;
      out(top[0] + ux * R * f, top[1] + uy * R * f, top[2] + uz * R * f, R * (poppy ? 0.6 : 0.42), R * (poppy ? 0.5 : 0.15), 0.12, c[0] * kc, c[1] * kc, c[2] * kc, 1, q[0], q[1], q[2], q[3], K_);
    }
    const eye = F.eye || [0.8, 0.66, 0.1];
    out(top[0], top[1] + ny * R * 0.08, top[2] + nz * R * 0.08, R * 0.26, R * 0.2, R * 0.22, eye[0], eye[1], eye[2], 1, 0, 0, 0, 1, K_);
  }
}
function* giantFlowers(ctx, out, W, dLo, dHi, amount) {
  for (const { i, wx0 } of cellsAround(ctx, 120, 20)) {
    const r = worldRng(ctx, 1301, i);
    if (r() > 0.85 * amount) continue;
    const n = 1 + Math.floor(r() * 3), cx = wx0 + r() * 120, cd = 36 + Math.pow(r(), 1.9) * 420;
    const fi = [2, 6, 4, 8, 1, 10, 11, 0, 15, 9, 16, 14][Math.floor(r() * 12)];
    for (let j = 0; j < n; j++) {
      const wx = cx + (r() - 0.5) * 16, d = cd + (r() - 0.5) * 12, hk = 0.75 + 0.6 * r();
      if (!inD(d, dLo, dHi) || !inX(ctx, wx, 12)) continue;
      const xx = xAt(W, wx);
      if (Math.abs(d - xx.rd) < 5 || Math.abs(d - xx.rc) < xx.rw * 0.5 + 2 || siteNear(W, wx, d, 6)) continue;
      const H = (10 + 0.075 * d) * hk * (amount / 0.8);
      note('giant flower', wx, d);
      yield* giantFlower(ctx, out, wx - ctx.x0, W.H(wx, d) - 0.3, d, H, FL[fi], makeRng(hashInts(W.ws, 1302, i, j)));
      if (out.due()) yield;
    }
  }
}
// Topology: meadows floating clear of the valley on roots of earth and rock, flowers along their
// rims, cows grazing on them, now and then a hay barn.
function* floatingMeadows(ctx, out, W, dLo, dHi, amount) {
  for (const { i, wx0 } of cellsAround(ctx, 460, 90)) {
    const r = worldRng(ctx, 1311, i);
    if (r() > 0.75 * amount + 0.1) continue;
    const wx = wx0 + r() * 460;
    let d = 80 + 420 * r() * r();
    const R = (11 + 12 * r()) * (1 + d / 320);
    // (whole inside one band)
    if (Math.abs(d - SPLIT_NM) < R * 0.9) d = d < SPLIT_NM ? SPLIT_NM - R * 0.95 : SPLIT_NM + R * 0.95;
    const y = W.H(wx, d) + (10 + 16 * r() + 0.07 * d) * (amount / 0.6) + R * 0.3;
    const nc = 2 + Math.floor(r() * 3), barn = r() < 0.4, breed = Math.floor(r() * COATS.length);
    if (!inD(d, dLo, dHi) || !inX(ctx, wx, R * 1.3)) continue;
    const x = wx - ctx.x0, s = Math.max(0.3, detail(out, d, 1.2));
    note('floating meadow', wx, d, y);
    yield* floatingIsland(ctx, out, x, y, d, R, { n: clamp(Math.round(R * R * 9 / (s * s)), 200, 2600), top: C.grass, earth: C.earth, chalk: C.rock, rng: r, trees: 0 });
    for (let j = 0; j < 44; j++) {
      const a = Math.PI * (0.05 + 0.9 * r()), rr = R * (0.72 + 0.26 * r()), c = FL[FMIX[i & 7][j % 6]].c, fs = Math.max(0.3, R * 0.035);
      out(x + Math.cos(a) * rr, y + fs * (0.6 + r()), -(d - Math.sin(a) * rr * 0.8), fs, fs * 0.8, fs * 0.8, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.SURREAL);
    }
    const k = FIG * (1 + d / 260);
    for (let j = 0; j < nc; j++) {
      const a = Math.PI * (0.2 + 0.6 * (j + 0.5) / nc), rr = R * 0.62, ct = COATS[breed];
      yield* beast(ctx, out, wx + Math.cos(a) * rr, y + 0.1, d - Math.sin(a) * rr * 0.8, { type: 'cow', yaw: (j % 2 ? 0 : Math.PI) + (r() - 0.5) * 0.6, k, col: ct.c, pale: ct.pale, pied: ct.pied, graze: r() < 0.6, bell: true, kind: KIND.SURREAL });
    }
    if (barn) {
      const pr = makeRng(hashInts(W.ws, 1312, i));
      const hs = chaletSpec(pr, wx + R * 0.15, d + R * 0.15, hashInts(W.ws, 1313, i), 'barn');
      yield* chalet(ctx, out, W, hs, { y: y - 0.2, k: 1 + d / 260, kind: KIND.SURREAL, cap: 500 });
    }
  }
}
// Topology: a waterfall that leaves the river and falls upward: a white column, narrow where it
// lifts from the water, widening as it climbs, breaking into spray and a cloud at its head.
function* upFalls(ctx, out, W, dLo, dHi, amount) {
  for (const { i, wx0 } of cellsAround(ctx, 1500, 80)) {
    const r = worldRng(ctx, 1321, i);
    if (r() > 0.9 * amount + 0.1) continue;
    const wx = wx0 + r() * 1500, xx = xAt(W, wx), d = xx.rc, y0 = xx.fy - WATER_BELOW;
    if (!inD(d, dLo, dHi) || !inX(ctx, wx, 40)) continue;
    const x = wx - ctx.x0, Ht = (0.4 + 0.08 * r()) * d + 8, salt = i & 0xffff;
    note('upward fall', wx, d);
    const s = Math.max(0.4, detail(out, d, 1.3)), nf = Math.max(10, Math.round(Ht / (s * 1.3)));
    for (let k = 0; k < nf; k++) {
      const t = (k + 0.5) / nf, w = 2.2 + 6 * t * t + 0.02 * d * t, sway = 2.5 * Math.sin(t * 4 + i) * t;
      for (const u of [-0.5, 0, 0.5]) {
        const c = mix3(C.riverPale, C.foam, smooth(0, 0.25, t) * (0.8 + 0.2 * noise1(t * 20 + u * 3, salt)));
        out(x + u * w + sway, y0 + t * Ht, -(d + 0.05 * u), w * 0.45, Math.max(Ht / nf * 0.8, s), 0.5, c[0], c[1], c[2], 0.93, 0, 0, 0, 1, KIND.SURREAL);
      }
      if (out.due()) yield;
    }
    // the swell of water drawn up at its foot, the spray and the cloud at its head
    out(x, y0 + 0.5, -d, 5, 0.7, 3, C.riverPale[0], C.riverPale[1], C.riverPale[2], 1, 0, 0, 0, 1, KIND.SURREAL);
    for (let k = 0; k < 16; k++) {
      const a = r() * Math.PI * 2, rr = (5 + 0.06 * d) * Math.sqrt(r()), sp = 3 + 4 * r() + 0.02 * d;
      out(x + Math.cos(a) * rr * 1.6 + 2.5 * Math.sin(4 + i), y0 + Ht + sp * 0.3 + Math.sin(a) * rr * 0.4, -(d + (r() - 0.5) * 6), sp, sp * 0.7, sp * 0.6, 0.8, 0.8, 0.8, 0.5, 0, 0, 0, 1, KIND.SURREAL, MOVE.VAPOUR);
    }
  }
}
// Logic: the same chalet repeating up the valley side beyond the river, each copy larger and a
// little more wrong: the roof steeper, the walls leaning, the whole house lifting off the ground.
function* repeatingChalet(ctx, out, W, dLo, dHi, logic) {
  const night = lightsOn(ctx);
  for (const { i, wx0 } of cellsAround(ctx, 1300, 120)) {
    const r = worldRng(ctx, 1331, i);
    if (r() > 0.45 + 1.2 * logic) continue;
    const wx = wx0 + 200 + r() * 900, xx = xCopy(W, wx), drift = (r() - 0.5) * 24, sgn = r() < 0.5 ? -1 : 1;
    const pr = makeRng(hashInts(W.ws, 1332, i));
    const spec = chaletSpec(pr, wx, 0, hashInts(W.ws, 1333, i), 'chalet');
    spec.yaw = (pr() - 0.5) * 0.3; spec.flag = false;
    for (let j = 0; j < 8; j++) {
      const d = xx.rc + xx.rw * 0.5 + 24 + j * (30 + 7 * j), cx = wx + drift * j;
      const wrong = (j / 7) * (0.5 + 1.6 * logic);
      if (!inD(d, dLo, dHi) || !inX(ctx, cx, 30)) continue;
      if (siteNear(W, cx, d, 12)) continue;
      if (j === 0) note('repeating chalet', cx, d);
      const hs = { ...spec, wx: cx, d, yaw: spec.yaw + 0.25 * wrong * sgn };
      yield* chalet(ctx, out, W, hs, { night, k: 1 + 0.2 * j, roll: 0.5 * wrong * sgn * (j % 2 ? 1 : -0.6), pitch: spec.pitch + 0.6 * wrong, lift: 16 * wrong * wrong * j / 7, kind: KIND.SURREAL, cap: 1300 });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------------------------
// Where one band hands its props to the next: a little short of the border, so that a thing standing
// just inside it is drawn whole by the band beyond (whose clip reaches well back) and not cut off.
const SPLIT_TN = 28.6, SPLIT_NM = 290, DRIFT_D = 135;
function* trackside(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 1, detailK: 1.2 });
  const lo = ctx.zNear, hi = SPLIT_TN;
  out.limit = ctx.count * 0.5;
  yield* overheadLine(ctx, out, ctx.beatMetres || 56, { d: 3.7 });
  yield* haltProps(ctx, out, W);
  yield* roadLife(ctx, out, W, lo, hi);
  yield* herds(ctx, out, W, lo, hi);
  yield* marmots(ctx, out, W, lo, hi);
  note('trackside props %', ctx.x0, 100 * out.n / ctx.count);     // (of the 50% they may take)
  out.limit = ctx.count * 0.8;
  // the bank falls away below the window: what shows of this band is the foot of the bank and the
  // first of the meadow, 17 to 30 m out (the bottom of the window looks down to about 19 m), so
  // the flowers and most of the ground go there
  yield* meadow(ctx, out, W, Math.round(ctx.count * 0.45), 16.5, ctx.zFar, { power: 0.3, zones: clearings(ctx, W), verge: 0.25, grass: 0.3 });
  out.limit = Infinity;
  const rest = out.left();
  yield* fillStrip(ctx, out, W, Math.round(rest * 0.05), 2.5, 4.5, (wx, d, rng) => jitter(C.ballast, rng, 0.25), 0, 0.12);
  yield* fillPlain(ctx, out, W, { n: Math.round(rest * 0.2), dNear: 4.4, dFar: 13, power: 1.0, cover: 4.4 });
  yield* fillPlain(ctx, out, W, { dNear: 13, power: 0.6, cover: 3.6 });
}

function* near(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.1 });
  const dz = ctx.dials || {};
  const lo = SPLIT_TN, hi = SPLIT_NM;
  const plan = [];
  // (animals and people cost the same few splats at any budget, so at a low one the props may take a little more of it)
  out.limit = ctx.count * (0.4 + 0.1 * clamp(1 - out.density, 0, 1));
  // level 1 first, so the band's prop budget never squeezes it out
  if ((dz.scale || 0) > 0) yield* giantFlowers(ctx, out, W, lo, hi, dz.scale);
  if ((dz.topology || 0) > 0) { yield* floatingMeadows(ctx, out, W, lo, hi, dz.topology); yield* upFalls(ctx, out, W, lo, hi, dz.topology); }
  if ((dz.logic || 0) > 0) yield* repeatingChalet(ctx, out, W, lo, hi, dz.logic);
  // the living things first, then what is built
  yield* herds(ctx, out, W, lo, hi);
  yield* outcrops(ctx, out, W, lo, hi);
  yield* smallStock(ctx, out, W, lo, hi);
  yield* marmots(ctx, out, W, lo, hi);
  yield* deer(ctx, out, W, lo, hi);
  yield* people(ctx, out, W, lo, hi);
  yield* birds(ctx, out, W, lo, hi);
  yield* roadLife(ctx, out, W, lo, hi);
  yield* hairpins(ctx, out, W, lo, hi);
  yield* cableCar(ctx, out, W, lo, hi);
  yield* farms(ctx, out, W, lo, hi, { plan });
  yield* villages(ctx, out, W, lo, hi, { plan });
  yield* barns(ctx, out, W, lo, hi);
  note('near props %', ctx.x0, 100 * out.n / ctx.count);        // (of the 40% they may take)
  fieldTrees(ctx, out, W, plan, lo + 8, hi, 60);
  forestPlan(ctx, out, W, plan, lo, hi, 6.5, { inner: 0.45 });
  out.limit = Math.max(out.limit, out.n) + ctx.count * 0.12;
  yield* drawPlan(ctx, out, plan, Math.max(0, out.limit - out.n));
  // the meadow in 3D (taken from the ground fill, which used to have two thirds of the band):
  // plants and grass tufts out to DRIFT_D, drifts of bloom beyond it
  const zones = clearings(ctx, W);
  out.limit = Math.min(ctx.count * 0.84, out.n + ctx.count * 0.47);
  yield* meadow(ctx, out, W, Math.round(ctx.count * 0.33), ctx.zNear, DRIFT_D, { power: 1.6, zones, grass: 0.3 });
  yield* meadow(ctx, out, W, Math.round(ctx.count * 0.14), DRIFT_D, ctx.zFar, { power: 1.1, zones, drift: 0, grass: 0.5 });
  yield* fillView(ctx, out, W, { cover: 3.4, strips: 4, maxR: 0.03 });
}

// What the nearer ground hides along a column: the highest elevation tangent it reaches.
function occlBefore(W, list) {
  return (wx) => { let a = -9; for (const dd of list) a = Math.max(a, (W.H(wx, dd) - CAMY) / dd); return a - 0.02; };
}
function* mid(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.6 });
  const dz = ctx.dials || {};
  const lo = SPLIT_NM, hi = ctx.zFar;
  const plan = [];
  out.limit = ctx.count * 0.4;
  if ((dz.scale || 0) > 0) yield* giantFlowers(ctx, out, W, lo, hi, dz.scale);
  if ((dz.topology || 0) > 0) yield* floatingMeadows(ctx, out, W, lo, hi, dz.topology);
  if ((dz.logic || 0) > 0) yield* repeatingChalet(ctx, out, W, lo, hi, dz.logic);
  yield* waterfalls(ctx, out, W, lo, hi);
  yield* hairpins(ctx, out, W, lo, hi);
  yield* cableCar(ctx, out, W, lo, hi);
  yield* villages(ctx, out, W, lo, hi, { plan, cap: 500 });
  yield* farms(ctx, out, W, lo, hi, { plan, cap: 900 });
  yield* barns(ctx, out, W, lo, hi, { cap: 260 });
  note('mid props %', ctx.x0, 100 * out.n / ctx.count);
  forestPlan(ctx, out, W, plan, lo, 1100, 13, { inner: 0.12, detail: 0.6 });
  for (const t of plan) t.nMax = Math.min(t.nMax, 6);
  out.limit = Math.max(out.limit, out.n) + ctx.count * 0.1;
  yield* drawPlan(ctx, out, plan, Math.max(0, out.limit - out.n));
  // drifts of bloom on the floor beyond the near band and up the slope meadows (from the ground fill)
  out.limit = Math.min(ctx.count * 0.72, out.n + ctx.count * 0.18);
  yield* meadow(ctx, out, W, Math.round(ctx.count * 0.18), lo, 1300, { power: 1.3, drift: 0, grass: 0.3, cell: 20, slope: 0.6 });
  yield* fillView(ctx, out, W, { cover: 3.3, strips: 10, far: true });
}

function* far(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 600 });
  out.limit = ctx.count * 0.04;
  yield* waterfalls(ctx, out, W, ctx.zNear, ctx.zFar);
  out.limit = Infinity;
  yield* fillView(ctx, out, W, { cover: 2.3, strips: 40, far: true, far2: true, minR: 0.001, maxR: 0.02, floor: 0.08, occl: occlBefore(W, [900, 1300, 1800, 2300, 2900]) });
}

export const alpsBiome = {
  name: 'alps',
  palette: PAL,
  terrain: TERRAIN,
  hazeDist: 11000,
  gold: 0.55,   // some of the evening's gold, but the snow should not turn to sand
  horizon: 0.1, // a little more sky over the summits (they stand close to the top of the window)
  // the bank below the window is steep and mostly out of sight; the meadows, the valley side and
  // the peaks are the picture
  shares: { trackside: 0.1, near: 0.43, mid: 0.27, far: 0.2 },
  // a daylight country: flowers and snow want sun
  slots: { dawn: 0.22, day: 0.56, dusk: 0.22, night: 0 },
  // Buildings and lights answer the beat; vehicles and cabins tag their own splats with MOVE.STILL,
  // animals and people with MOVE.FLASH, flower heads with a chorus group per colour.
  beatKinds: [KIND.BUILDING, KIND.LIGHT],
  sky: { stars: 1.2, deep: 0.6, milkyWay: 0.6, clear: 0.5 },
  generators: { trackside, near, mid, far },
};

// ---------------------------------------------------------------------------------------------
// For scripts that inspect the layout, e.g.
//   const { _debug } = await import('./src/window/biomes/alps.js');
//   _debug.layout('7', 0, 20000)
// Each entry has world x (wx) and distance (d); jump=<wx> in the previewer centres it.
// ---------------------------------------------------------------------------------------------
function at(seedStr) {
  const terrain = makeTerrain(hashString(String(seedStr)), TERRAIN);
  return world({ terrain });
}
function layout(seedStr, x0, x1) {
  const W = at(seedStr);
  const list = (cell, fn, map) => { const res = []; for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) { const o = fn(W, i); if (o) res.push(...[].concat(map(o))); } return res; };
  const R = Math.round;
  return {
    peaks: list(PKCELL, peak, (p) => ({ wx: R(p.wx), d: R(p.d), top: R(W.H(p.wx, p.d)) })),
    sideValleys: list(GLCELL, sideValley, (g) => ({ wx: R(g.wx), glacier: g.glacier, snout: R(g.snout) })),
    cliffs: (() => { const res = []; let cur = null; for (let wx = x0; wx <= x1; wx += 50) { const on = xAt(W, wx).cl > 0.5; if (on) { if (!cur) { cur = { from: wx, to: wx }; res.push(cur); } else cur.to = wx; } else cur = null; } return res; })(),
    halts: list(HCELL, halt, (h) => ({ wx: R(h.x0 + h.len * 0.55), d: 10 })),
    villages: list(VCELL, village, (v) => ({ wx: R(v.cx), d: R(v.dc), houses: v.houses.length, church: { wx: R(v.church.wx), d: R(v.church.d), onion: v.church.onion }, bridge: { wx: R(v.bridge.wx), d: R((v.bridge.a + v.bridge.b) / 2) } })),
    farms: list(FCELL, farm, (f) => ({ wx: R(f.cx), d: R(f.dc), nearSide: f.nearSide })),
    hairpins: list(HPCELL, hairpin, (h) => ({ wx: R(h.wx), from: R(h.d0), to: R(hairpinEnd(h)), bridge: R((h.bridge.a + h.bridge.b) / 2) })),
    cables: list(CCELL, cable, (c) => ({ from: { wx: R(c.x0), d: R(c.d0) }, to: { wx: R(c.x1), d: R(c.d1) } })),
    falls: list(BRCELL, brook, (b) => (b.fall ? { wx: R(b.wx), d: R(b.df) } : [])),
    herds: list(COWCELL, herd, (g) => ({ wx: R(g.wx), d: R(g.d), n: g.list.length })),
    outcrops: list(ROCKCELL, outcrop, (o) => ({ wx: R(o.wx), d: R(o.d), kind: o.chamois ? 'chamois' : 'ibex', n: o.n })),
    deer: list(DEERCELL, deerGroup, (g) => ({ wx: R(g.wx), d: R(g.d), n: g.n })),
  };
}
export const _debug = { world, at, layout, xAt, heightAt, paint, patchAt, FL, plant, drift, grassTuft };
