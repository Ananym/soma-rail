// "Tuscany": the wine country of the Chianti and the Val d'Orcia in late summer, at harvest, seen
// from a train running along a valley side. Its subject is sunshine.
//
// The line runs on a terrace cut into one side of a broad valley, eight to fourteen metres above
// its floor, so the floor lies open below the window (level ground seen from its own height is a
// sliver). Below the window the bank falls to the floor: a patchwork of plots in the warm colours of
// the end of summer: vineyards in parallel rows on wires and posts, the rows of each plot at their
// own angle (many run away from the line, so that passing them they open and close, the flicker of
// a vineyard seen from a train), dusty green over ochre earth or dry grass, with bunches of grapes
// on the nearest rows and roses at the row ends; olive groves on a grid, silver-green crowns over
// gnarled trunks, nets spread below some; wheat stubble with round bales, uncut gold, sunflowers,
// the pale grey-brown ploughed clay of the crete, dry pasture, poppies along the edges, woods of oak
// and umbrella pine. A white road follows the floor at the foot of the bank. Knolls stand on the
// floor with a villa or a stone farmhouse on top and a winding white road lined with cypresses up
// to it. Beyond a small river with poplars the far side of the valley rises in long soft folds,
// the same patchwork striped with rows, to hill towns on their crests (walls, towers, a campanile,
// a dome) and at the horizon the blue ranges, now and then the broad cone of Monte Amiata.
// Buildings: villas of ochre stucco or pale stone with terracotta roofs, a loggia, green shutters, a
// dovecote tower, a walled garden; casali of stone with a barn and a well; a winery with barrels and
// a press in its yard; a roadside chapel; a stone bridge where a stream crosses the road; a small
// village with a piazza and a fountain. Life: the harvest (pickers in sun hats among the rows with
// baskets and crates, a small tractor with a trailer of grapes, crates stacked at the row ends), a
// long table under a pergola, a Vespa and a three-wheeled Ape on the white road, a group of
// cyclists, a shepherd with white sheep and a white Maremma dog, white Chianina cattle, horses,
// pheasants, a hare, wild boar at a wood's edge at dusk, swallows and a hovering kestrel.
//
// Structure (as alps.js): one pure layout of WORLD x and distance, hashed from the world seed and
// cached per world. The valley's shape is this file's own height function (heightAt): what depends
// on x alone (the floor's level, the foot of the bank, the river, the road, the character of the
// stretch) is tabulated per metre of world x in blocks (xAt); the far side is tabulated in tiles
// (makeTable) and the river's bed, the streams' beds and the knolls are added exactly on top. Every
// band stands on it through local(ctx), so nothing jumps at a chunk seam or a band border. A hill
// town's crest lies at the back of the town, so the town climbs the face of its hill toward the
// window and no nearer brow hides it.
//
// The plots: a warped grid of cells, rows of cells log-spaced with distance; each cell takes a crop
// (picked by the character of its stretch), a row angle and pitch, an age. The ground fill snaps
// its splats in a vineyard to the rows or to the alleys between them and stretches them along the
// row, so the stripes hold at every distance (far plots are drawn at a wider pitch than they have);
// nearer than ROWS3D the rows are drawn in three dimensions (canopy, posts, grapes, roses) and the
// fill only gives the alleys. The sites (villas, casali, winery, chapel, village, streams) keep the
// crops off their ground, off a meadow before them and off a strip either side of their avenues,
// so that they and their cypresses are seen.
//
// Budgets in the near band: the dreamlike things, life and sites first (up to 45% of the count),
// then the trees (16% more, shared by size on screen), then the rows (what is left down to 8%,
// drawn coarser to fit: rowCoarse), then the ground fill with the rest (at least a quarter).
// globalThis.__tuscanyLog collects what is drawn where, and 'FULL <stage>' when a stage used up its
// share (nothing should: see scan scripts).
//
// The beat: trees, buildings and lights answer it (beatKinds); vehicles, crates, barrels and bales
// tag their own splats with MOVE.STILL (rigid: nothing on the beat); people and animals flash (MOVE.FLASH), the hovering kestrel
// too (it holds its place over the ground, so it is not carried along); cyclists ride (MOVE.RIDE)
// where the white road runs straight and level for sixty metres either way, and stand still
// (FLASH) elsewhere; swallows fly (MOVE.FLY). The vines, the ground and the hills stay still.
// Not built: dry-stone terraces, and the dreamlike second low sun (a biome cannot draw in the sky).
//
// Surreal dials (all 0 at level 0, so level 0 shows none of this):
//   scale     bunches of grapes the size of houses hanging over the vineyards; cypresses of
//             impossible height along the roads
//   topology  the river runs wine-dark; a hill town floats above its hill
//   logic     the same villa repeated up a cypress avenue that does not end
import { hashInts, hashString, makeRng, noise1, noise2 } from '../rng.js';
import { makeTerrain } from '../terrain.js';
import {
  KIND, MOVE, makeOut, worldSeed, worldRng, cellsAround, detail, shade, jitter, mul3, mix3, smooth,
  clamp, lerp, quatYaw, quatRoll, quatMul, quatXTo, rotY, SUN,
  overheadLine, flightCell, rideCell, flyBody, flyWing, Q_ID, floatingIsland,
} from './kit.js';

const PAL = {
  ground: [0.6, 0.52, 0.32],      // straw and ochre: also the backdrop below the horizon
  foliage: [0.22, 0.3, 0.14],
  rock: [0.62, 0.58, 0.5],
  ballast: [0.46, 0.43, 0.39],
};

// Colours. Natural surfaces stay <= 0.8 per channel: the warmth is in the hue, not the brightness.
const C = {
  ballast: [0.46, 0.43, 0.39],
  cess: [0.56, 0.5, 0.4],
  dryGrass: [0.66, 0.58, 0.34],
  dryGreen: [0.48, 0.48, 0.24],
  greenGrass: [0.36, 0.44, 0.18],
  straw: [0.78, 0.66, 0.38],
  strawDark: [0.62, 0.5, 0.28],
  wheat: [0.8, 0.62, 0.26],
  wheatDark: [0.66, 0.48, 0.2],
  clay: [0.68, 0.62, 0.53],       // the crete: pale grey-brown ploughed clay
  clayDark: [0.5, 0.45, 0.38],
  earth: [0.58, 0.43, 0.28],      // ochre vineyard soil
  earthDark: [0.44, 0.32, 0.21],
  vine: [0.3, 0.38, 0.15],        // dusty vine green
  vineLit: [0.44, 0.5, 0.2],
  vineYellow: [0.56, 0.54, 0.2],
  vineDark: [0.16, 0.22, 0.08],
  olive: [0.42, 0.47, 0.36],      // silver-green
  oliveLit: [0.56, 0.6, 0.48],
  oliveDark: [0.24, 0.29, 0.2],
  oliveBark: [0.36, 0.33, 0.28],
  cypress: [0.06, 0.12, 0.07],
  cypressLit: [0.13, 0.2, 0.1],
  oak: [0.18, 0.26, 0.1],
  oakLit: [0.3, 0.38, 0.14],
  pine: [0.15, 0.23, 0.11],       // umbrella pine
  pineLit: [0.24, 0.33, 0.14],
  poplar: [0.3, 0.38, 0.2],
  woodFloor: [0.1, 0.13, 0.06],
  farWood: [0.15, 0.2, 0.13],
  bark: [0.26, 0.2, 0.15],
  sunflower: [0.8, 0.6, 0.05],
  sunflowerDry: [0.46, 0.34, 0.14],
  sunCentre: [0.26, 0.17, 0.07],
  sunLeaf: [0.28, 0.38, 0.12],
  poppy: [0.8, 0.1, 0.05],
  broom: [0.8, 0.68, 0.1],
  lavender: [0.5, 0.42, 0.68],
  road: [0.8, 0.76, 0.66],        // the strade bianche: white gravel
  roadDark: [0.66, 0.62, 0.53],
  asphalt: [0.36, 0.35, 0.34],
  river: [0.3, 0.38, 0.3],        // a small river in late summer: green and slow
  riverLit: [0.46, 0.54, 0.46],
  gravel: [0.66, 0.62, 0.54],
  wine: [0.3, 0.04, 0.1],
  stucco: [0.78, 0.6, 0.4],       // ochre stucco
  stuccoPale: [0.8, 0.7, 0.54],
  stuccoRose: [0.78, 0.54, 0.42],
  stone: [0.7, 0.64, 0.53],       // pale stone and travertine
  stoneWarm: [0.66, 0.54, 0.4],
  brick: [0.64, 0.38, 0.24],
  roof: [0.68, 0.34, 0.2],        // terracotta
  roofOld: [0.56, 0.32, 0.22],
  shutter: [0.22, 0.34, 0.22],
  shutterBrown: [0.36, 0.24, 0.14],
  win: [0.12, 0.1, 0.09],
  marble: [0.8, 0.78, 0.72],
  skin: [0.72, 0.52, 0.38],
  strawHat: [0.78, 0.68, 0.42],
  grapeBlack: [0.2, 0.08, 0.2],
  grapeRed: [0.34, 0.08, 0.16],
  grapeGold: [0.66, 0.62, 0.22],
  rose: [0.8, 0.22, 0.3],
  roseLeaf: [0.18, 0.28, 0.1],
  crateRed: [0.7, 0.14, 0.1],
  crateGreen: [0.16, 0.42, 0.2],
  crateWood: [0.56, 0.42, 0.26],
  post: [0.42, 0.36, 0.28],
  wire: [0.5, 0.5, 0.48],
  bale: [0.74, 0.62, 0.34],
  baleDark: [0.52, 0.42, 0.22],
};
const LIT = [1.0, 0.76, 0.42];       // a lit window (a light: >= 0.97, ignores the tint)
const LAMP = [1.0, 0.84, 0.56];

// The shape numbers are unused: the valley comes from heightAt() through local().
const TERRAIN = { cutting: 1.0, roll: 6, hills: 120, mountains: 500 };
const CAMY = 2.6;

// ---------------------------------------------------------------------------------------------
// Small helpers (after alps.js)
// ---------------------------------------------------------------------------------------------
const SX = SUN[0], SY = SUN[1], SZ = SUN[2];
const STL = MOVE.STILL, FL = MOVE.FLASH;   // STL: rigid things (vehicles, crates, barrels, bales): nothing on the beat
function hourOf(ctx) { const h = ctx.hour != null ? ctx.hour : 12; return ((h % 24) + 24) % 24; }
// Lights are on from just before the dusk slot until just after the dawn one.
function lightsOn(ctx) { const h = hourOf(ctx); return h > 18.8 || h < 6.9; }
// Boar come out at the ends of the day.
function dusky(ctx) { const h = hourOf(ctx); return h > 18 || h < 7.5; }
// For scripts that look for things: globalThis.__tuscanyLog = [] collects { kind, wx, d } as they are drawn.
function note(kind, wx, d, y) { const log = globalThis.__tuscanyLog; if (log) log.push({ kind, wx: Math.round(wx), d: Math.round(d), y: y != null ? Math.round(y) : undefined }); }
const inD = (d, lo, hi) => d >= lo && d < hi;
const inX = (ctx, wx, m = 0) => wx >= ctx.x0 - m && wx < ctx.x0 + ctx.length + m;

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
// An out() that tags every splat with a motion class (unless one is given).
function withMove(out0, move) {
  const o = (x, y, z, sx, sy, sz, r, g, b, op = 1, qx = 0, qy = 0, qz = 0, qw = 1, kind = KIND.OTHER, mv = 0) => out0(x, y, z, sx, sy, sz, r, g, b, op, qx, qy, qz, qw, kind, mv || move);
  o.due = out0.due; o.density = out0.density; o.detailK = out0.detailK; o.limit = out0.limit;
  return o;
}

// ---------------------------------------------------------------------------------------------
// World layout (pure functions of world x and distance; cached per world seed)
// ---------------------------------------------------------------------------------------------
const worlds = new Map();
function world(ctx) {
  const ws = worldSeed(ctx);
  let W = worlds.get(ws);
  if (W) return W;
  W = { ws, misc: new Map(), plots: new Map(), xb: new Map(), xl: null, xli: NaN };
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
// The far side is asked for three times for every ground splat, so it is tabulated per world:
// rows at log-spaced distances, columns a little over one per cent of the distance apart, in tiles of
// 16 x 32 cells made on first use and interpolated bilinearly (after winter.js and alps.js).
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
const ST = { KNOLL: 1, TOWN: 2, AMIATA: 3, VILLA: 4, CASALE: 5, WINERY: 6, CHAPEL: 7, STREAM: 8, BORGO: 9, FLOCK: 10, HERD: 11, HORSES: 12, HARVEST: 13, TABLE: 14, BOAR: 15, MISC: 16, FARVILLA: 17, HAMLET: 18 };

// --- everything that depends on world x alone, tabulated per metre in blocks of 256 m ---
//   fy  the level of the valley floor at the foot of the bank (below rail level)
//   bk  where the bank meets the floor              rc  the river's centre line   rw  its width
//   rd  the white road's centre line                tb  how steeply the far side rises (a tangent)
//   ch  the character of the stretch: 0 Chianti (vines and woods) .. 1 Val d'Orcia (wheat, clay)
//   ol  0..1: a stretch of olive groves             sl  the road's slope d(rd)/dx
//   sd  how far along x the nearest stream lies (its course is drawn exactly where this is small)
const XB = 256, XF = 10;
function fy0(W, wx) { return -(8.5 + 5 * noise1(wx / 1700, W.ws + 611)); }
function roadC0(W, wx) { return 14 - fy0(W, wx) + 20 + 22 * noise1(wx / 1900, W.ws + 601) + 7 * noise1(wx / 640, W.ws + 602); }
function rawX(W, wx, a, o) {
  const ws = W.ws;
  const fy = fy0(W, wx);
  const bk = 14 + 1.0 * -fy;
  a[o] = fy;
  a[o + 1] = bk;
  a[o + 2] = 250 + 120 * noise1(wx / 2300, ws + 605) + 45 * noise1(wx / 420, ws + 603);
  a[o + 3] = 9 + 7 * noise1(wx / 900, ws + 604);
  a[o + 4] = roadC0(W, wx);
  a[o + 5] = 0.1 + 0.08 * noise1(wx / 2600, ws + 621);
  a[o + 6] = smooth(0.3, 0.7, noise1(wx / 3100, ws + 631) * 0.8 + noise1(wx / 900, ws + 632) * 0.2);
  a[o + 7] = smooth(0.58, 0.78, noise1(wx / 1500, ws + 633));
  a[o + 8] = (roadC0(W, wx + 1) - roadC0(W, wx - 1)) / 2;
  let sd = 999;
  for (let k = Math.floor(wx / STCELL) - 1; k <= Math.floor(wx / STCELL) + 1; k++) { const st = stream(W, k); if (st) sd = Math.min(sd, Math.abs(wx - st.wx)); }
  a[o + 9] = sd;
}
const X = { fy: 0, bk: 0, rc: 0, rw: 0, rd: 0, tb: 0, ch: 0, ol: 0, sl: 0, sd: 0 };
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
  X.fy = a[o] + (a[o + XF] - a[o]) * t;
  X.bk = a[o + 1] + (a[o + XF + 1] - a[o + 1]) * t;
  X.rc = a[o + 2] + (a[o + XF + 2] - a[o + 2]) * t;
  X.rw = a[o + 3] + (a[o + XF + 3] - a[o + 3]) * t;
  X.rd = a[o + 4] + (a[o + XF + 4] - a[o + 4]) * t;
  X.tb = a[o + 5] + (a[o + XF + 5] - a[o + 5]) * t;
  X.ch = a[o + 6] + (a[o + XF + 6] - a[o + 6]) * t;
  X.ol = a[o + 7] + (a[o + XF + 7] - a[o + 7]) * t;
  X.sl = a[o + 8] + (a[o + XF + 8] - a[o + 8]) * t;
  X.sd = a[o + 9] + (a[o + XF + 9] - a[o + 9]) * t;
  return X;
}
// The values of xAt() at a world x, copied (xAt returns a reused object).
// (computed afresh, so that it never disturbs what X holds for a caller further up)
const XRA = new Float64Array(XF);
function xCopy(W, wx) { const a = XRA; rawX(W, wx, a, 0); return { fy: a[0], bk: a[1], rc: a[2], rw: a[3], rd: a[4], tb: a[5], ch: a[6], ol: a[7], sl: a[8], sd: a[9] }; }
// The floor's own level at d (before its small folds): falling gently from the foot of the bank.
const FLOOR_FALL = 0.012;
function floorY(x, d) { return x.fy - FLOOR_FALL * (Math.max(x.bk, Math.min(d, x.rc)) - x.bk); }
const WATER_BELOW = 2.4;

// --- the far side's landmarks: hill towns on crests, and Monte Amiata at the horizon ---
const TCELL = 3400;
function town(W, i) {
  return cache(W, ST.TOWN, i, () => {
    const r = makeRng(hashInts(W.ws, 701, i));
    if (r() > 0.8) return null;
    const wx = (i + 0.2 + 0.6 * r()) * TCELL;
    const x = xCopy(W, wx);
    const d = Math.max(x.rc + 650, 950 + 1150 * r());
    return { i, wx, d, R: 460 + 220 * r(), Hh: 80 + 50 * r(), wide: 130 + 75 * r(), deep: 68 + 32 * r(), seed: hashInts(W.ws, 702, i), dome: r() < 0.5, walls: r() < 0.75, towers: 2 + Math.floor(r() * 6) };
  });
}
function townsNear(W, wx) {
  const i = Math.floor(wx / TCELL), res = [];
  for (let k = i - 1; k <= i + 1; k++) { const t = town(W, k); if (t) res.push(t); }
  return res;
}
// The town whose ground (inside its walls, a little beyond) holds (wx, d), or null.
function townAt(W, wx, d) {
  const i = Math.floor(wx / TCELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const t = town(W, k);
    if (t && ((wx - t.wx) / (t.wide + 22)) ** 2 + ((d - t.d) / (t.deep + 20)) ** 2 < 1) return t;
  }
  return null;
}
const AMCELL = 16000;
function amiata(W, i) {
  return cache(W, ST.AMIATA, i, () => {
    const r = makeRng(hashInts(W.ws, 711, i));
    if (r() > 0.7) return null;
    return { i, wx: (i + 0.2 + 0.6 * r()) * AMCELL, d: 9500 + 2500 * r(), R: 4200 + 1400 * r(), H: 750 + 300 * r() };
  });
}
function amiataH(W, wx, d) {
  if (d < 5000) return 0;
  const i0 = Math.floor(wx / AMCELL);
  let m = 0;
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const a = amiata(W, i);
    if (!a) continue;
    const rr = Math.hypot(wx - a.wx, (d - a.d) * 0.8) / a.R;
    if (rr >= 1) continue;
    const v = a.H * Math.pow(1 - rr, 1.5) * (1 - 0.25 * smooth(0.0, 0.12, 0.12 - rr)) + 25 * (noise2(wx / 700, d / 700, W.ws + 712) - 0.5) * (1 - rr);
    if (v > m) m = v;
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// The height function
// ---------------------------------------------------------------------------------------------
// The far side above the river (s = distance beyond its far bank): it rises with a tangent that
// grows with distance, so it is concave and every fold of it shows; soft folds of a few hundred
// metres to a kilometre, the hill towns' crests, the blue ranges beyond, Amiata.
function farH(W, wx, d, s, x) {
  const ws = W.ws;
  let h = x.tb * s * s / (s + 1100);
  // the long soft folds: wider with distance, and a ridge-like layering far out
  const a1 = noise2(wx / (520 + 0.28 * s), d / (420 + 0.2 * s), ws + 51), a2 = noise2(wx / (190 + 0.1 * s), d / (160 + 0.08 * s), ws + 52);
  // hill towns stand on raised, rounded crests (with the folds smoothed away round them, so that
  // nothing nearer stands up in front of the town)
  let wT = 0, hT = 0;
  if (d > 600 && d < 4200) {
    const i = Math.floor(wx / TCELL);
    for (let k = i - 1; k <= i + 1; k++) {
      const t = town(W, k);
      if (!t) continue;
      // (the crest's top lies at the back of the town, so the town climbs the face of its hill
      // toward the window, row above row, and no nearer brow hides it)
      const q = ((wx - t.wx) / t.R) ** 2 + ((d - t.d - t.deep * 0.9) / (t.R * 0.75)) ** 2;
      if (q < 1) { const top = (1 - q) * (1 - q), w = Math.min(1, top * 1.12); if (w > wT) { wT = w; hT = t.Hh * w; } }
    }
  }
  const A = Math.min(0.05 * s, 150) * (1 - 0.85 * smooth(0, 0.6, wT));
  h += (a1 - 0.45) * 2.2 * A + (a2 - 0.5) * 0.5 * A;
  if (d > 3500) {
    const rg = 1 - Math.abs(2 * noise2(wx / 2400, d / 1500, ws + 53) - 1);
    h += smooth(3500, 6000, d) * (rg * rg - 0.3) * 0.035 * d;
  }
  // (nothing stands taller than a tangent of about 0.2 from the window; a town's crest and Amiata
  // stand on top of that)
  const lim = 0.2 * d, knee = 0.75 * lim;
  if (h > knee) h = knee + (lim - knee) * Math.tanh((h - knee) / (lim - knee));
  return h + hT + amiataH(W, wx, d);
}
// Bank, floor and far side (the smooth part; the river's bed and the knolls are added on top).
function baseH(W, wx, d) {
  const x = xAt(W, wx);
  if (d < 4.6) return d < 2.5 ? 0 : -0.3 * smooth(2.5, 4.6, d);
  const fy = x.fy, bk = x.bk;
  if (d < bk) {
    // the bank: steep at the top, easing out onto the floor
    const t = (d - 4.6) / (bk - 4.6);
    return -0.3 + (fy + 0.3) * (1 - (1 - t) * (1 - t) * (1 - 0.4 * t)) + (noise2(wx / 9, d / 5, W.ws + 42) - 0.5) * 0.6 * t * (1 - t) * 4;
  }
  let h = floorY(x, d) + (noise2(wx / 150, d / 110, W.ws + 41) - 0.5) * 3.4 * smooth(bk, bk + 40, d);
  // the floor dips a little toward the river
  const hw = x.rw * 0.5, rn = x.rc - hw, rf = x.rc + hw;
  if (d < x.rc) h -= 1.4 * smooth(rn - 40, rn, d); else h -= 1.4 * smooth(rf + 40, rf, d);
  if (d > rf) h += farH(W, wx, d, d - rf, x);
  return h;
}
// The knolls on the floor between the road and the river: a villa or a farm on top.
const KNCELL = 760;
function knoll(W, i) {
  return cache(W, ST.KNOLL, i, () => {
    const r = makeRng(hashInts(W.ws, 721, i));
    if (r() > 0.62) return null;
    const wx = (i + 0.25 + 0.5 * r()) * KNCELL;
    const x = xCopy(W, wx);
    const R = 48 + 30 * r();
    const lo = x.rd + 14 + R * 0.8, hi = x.rc - x.rw * 0.5 - 14 - R;
    if (hi < lo) return null;
    const d = lo + (hi - lo) * (0.2 + 0.6 * r());
    if (streamNear(W, wx, R + 10)) return null;
    return { i, wx, d, R, H: 9 + 10 * r(), seed: hashInts(W.ws, 722, i), villa: r() < 0.45 };
  });
}
function knollH(W, wx, d) {
  const i0 = Math.floor(wx / KNCELL);
  let h = 0;
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const k = knoll(W, i);
    if (!k) continue;
    const q = ((wx - k.wx) / k.R) ** 2 + ((d - k.d) / (k.R * 0.8)) ** 2;
    if (q < 1) h += k.H * (1 - q) * (1 - q);
  }
  return h;
}
function heightAt(W, wx, d) {
  let h;
  if (d < 215) h = baseH(W, wx, d);                         // (leaves this x's values in X)
  else h = W.base(wx, d);
  const x = xAt(W, wx);
  if (d > x.bk) {
    // the white road is levelled into the floor
    const ar = Math.abs(d - x.rd);
    if (ar < 9) h = lerp(h, floorY(x, x.rd), smooth(9, 3.5, ar));
    const rc = x.rc, hw = x.rw * 0.5;
    if (x.sd < 60 && d < rc) {
      // a stream's little bed, cut across the floor from the bank to the river
      const st = streamNear(W, wx, 30);
      if (st) { const off = Math.abs(wx - streamX(st, d)); if (off < 6) h -= 1.9 * smooth(6, 1.4, off) * smooth(0, 10, d - X.bk); }
    }
    if (d < rc + 100) h += knollH(W, wx, d);
    const ad = Math.abs(d - rc);
    if (ad < hw + 4) h = lerp(h, floorY(xAt(W, wx), rc) - 1.4 - WATER_BELOW, smooth(hw + 4, hw + 0.3, ad));
  }
  return h;
}

// ---------------------------------------------------------------------------------------------
// The plots: a warped grid of cells. Rows of cells lie at log-spaced distances (a plot is about a
// third as deep as it is far away, and wider than it is deep); each cell takes a crop picked by the
// character of its stretch, and for a crop in rows (vines, olives, stubble, clay, sunflowers) the
// angle and the pitch of its rows.
// ---------------------------------------------------------------------------------------------
const PK = { VINE: 0, OLIVE: 1, STUBBLE: 2, WHEAT: 3, SUN: 4, CLAY: 5, PASTURE: 6, WOOD: 7 };
const PLOT_K = 1.55, LOGK = Math.log(PLOT_K), PLOT_D0 = 16;
function makePlot(W, vi, ui, wxc, dm) {
  const r = makeRng(hashInts(W.ws, 331, vi, ui));
  const x = xCopy(W, wxc), ch = x.ch, ol = x.ol;
  const far = smooth(900, 3000, dm);
  const w = [
    (0.55 * (1 - ch) + 0.14 * ch) * (1 - 0.3 * far),          // vines
    0.1 + 0.42 * ol + 0.05 * (1 - ch),                           // olives
    0.05 + 0.32 * ch,                                            // stubble with bales
    0.02 + 0.1 * ch,                                             // uncut gold
    0.02 + 0.09 * ch,                                            // sunflowers
    0.24 * ch * smooth(60, 200, dm) * (1 - 0.85 * far),         // ploughed clay (none on the far hills)
    0.05 + 0.1 * ch,                                             // dry pasture
    (0.07 + 0.08 * (1 - ch)) * smooth(40, 120, dm) + 0.12 * far, // woods (never by the line)
  ];
  let tot = 0;
  for (const v of w) tot += v;
  let u = r() * tot, t = 0;
  while (t < w.length - 1 && u > w[t]) { u -= w[t]; t++; }
  const p = { t, vi, ui, ang: 0, ca: 1, sa: 0, pitch: 3, ph: r(), share: 0.5, age: 1, grass: r() < 0.45, harvest: false, nets: false, bales: false, tone: 0.88 + 0.24 * r(), seed: hashInts(W.ws, 332, vi, ui), dry: r() < 0.3 };
  const ra = r();
  if (t === PK.VINE) {
    // rows that run away from the line (the flicker), along it, or aslant; young, grown or old
    p.ang = ra < 0.5 ? Math.PI / 2 + (r() - 0.5) * 0.2 : ra < 0.72 ? (r() - 0.5) * 0.12 : (r() < 0.5 ? -1 : 1) * (0.35 + 0.8 * r());
    p.pitch = 2.4 + 0.5 * r();
    const a = r();
    p.age = a < 0.16 ? 0.45 : a < 0.8 ? 1 : 1.15;
    p.share = p.age < 0.6 ? 0.22 : 0.42;
    p.harvest = dm < 170 && p.age > 0.6 && r() < 0.32;
  } else if (t === PK.OLIVE) {
    p.ang = ra < 0.6 ? 0 : (r() - 0.5) * 0.8;
    p.pitch = 6.5 + 2 * r();
    p.nets = r() < 0.3;
    p.age = 0.75 + 0.5 * r();
  } else if (t === PK.STUBBLE) {
    p.ang = ra < 0.5 ? 0 : ra < 0.8 ? Math.PI / 2 : (r() - 0.5) * 1.6;
    p.pitch = 2.6 + 1.6 * r();
    p.bales = r() < 0.75;
  } else if (t === PK.CLAY) {
    p.ang = ra < 0.6 ? (r() - 0.5) * 0.3 : (r() - 0.5) * 2.4;
    p.pitch = 0.9 + 0.5 * r();
  } else if (t === PK.SUN) {
    p.ang = ra < 0.5 ? Math.PI / 2 : 0;
    p.pitch = 0.75;
  }
  p.ca = Math.cos(p.ang); p.sa = Math.sin(p.ang);
  p.cx = wxc; p.cd = dm;
  return p;
}
// The plot a point lies in (a reused lookup: hold the plot object, not PLQ, across calls). PLQ.eu and
// PLQ.ev are how far the point lies inside the plot's edges along x and along d (metres, roughly).
const PLQ = { p: null, eu: 0, ev: 0 };
function plotAt(W, wx, d) {
  const ws = W.ws;
  const n1 = noise2(wx / 110, d / 80, ws + 301), n2 = noise2(wx / 97, d / 71, ws + 302);
  const v = Math.log(Math.max(d, PLOT_D0) / PLOT_D0) / LOGK + 0.5 * (n1 - 0.5);
  const vi = Math.floor(v);
  const dm = PLOT_D0 * Math.pow(PLOT_K, vi + 0.5);
  const cw = clamp(dm * 1.25, 46, 900);
  const off = ((hashInts(ws, 333, vi) >>> 0) % 1000) / 1000;
  const u = wx / cw + 0.5 * (n2 - 0.5) + off;
  const ui = Math.floor(u);
  const key = (vi + 64) * 1e9 + ui;
  let p = W.plots.get(key);
  if (p === undefined) {
    p = makePlot(W, vi, ui, (ui + 0.5 - off) * cw, dm);
    if (W.plots.size > 40000) W.plots.clear();
    W.plots.set(key, p);
  }
  PLQ.p = p;
  const fu = u - ui, fv = v - vi;
  PLQ.eu = Math.min(fu, 1 - fu) * cw;
  PLQ.ev = Math.min(fv, 1 - fv) * dm * (PLOT_K - 1);
  return PLQ;
}

// ---------------------------------------------------------------------------------------------
// What covers the ground at a world point, and its colour. Returns a reused object: never hold it
// across a yield. For a crop in rows it also says how the fill should lay its splats (P.row): the
// rows' direction (ca, sa in x and d), pitch, the share of the ground the rows take, the colours of
// row and gap, and whether a row stands up (vines) or lies flat (furrows, swathes).
// ---------------------------------------------------------------------------------------------
const T = { BALLAST: 0, BANK: 1, ROAD: 2, RIVER: 3, RBANK: 4, FIELD: 5, VINE: 6, OLIVE: 7, WOOD: 8, EDGE: 9, TOWN: 10 };
const PA = { t: 0, c: [0, 0, 0], row: 0, ca: 1, sa: 0, pitch: 1, share: 0.5, rowC: [0, 0, 0], gapC: [0, 0, 0], stand: 0, lift: 0, ph: 0, p: null, f: 0 };
function setc(c, a) { c[0] = a[0]; c[1] = a[1]; c[2] = a[2]; }
function mixc(c, a, b, t) { c[0] = a[0] + (b[0] - a[0]) * t; c[1] = a[1] + (b[1] - a[1]) * t; c[2] = a[2] + (b[2] - a[2]) * t; }
function mulc(c, k) { c[0] *= k; c[1] *= k; c[2] *= k; }
// Dry grass: straw-gold with greener hollows.
function grassColor(W, wx, d, c) {
  const a = noise2(wx / 60, d / 40, W.ws + 341), b = noise2(wx / 7, d / 5, W.ws + 342);
  mixc(c, C.dryGreen, C.dryGrass, clamp(a * 0.8 + b * 0.35, 0, 1));
}
// (the river runs wine-dark at the dreamlike level: set by the fill before each call)
let WINE = 0;
function paint(W, wx, d, y, nx, ny, nz, rng) {
  const P = PA, c = P.c, ws = W.ws;
  const x = xAt(W, wx);
  P.row = 0; P.lift = 0; P.p = null; P.f = 0;
  if (d < 4.4) { P.t = T.BALLAST; setc(c, C.ballast); mulc(c, 0.75 + 0.5 * rng()); return P; }
  if (d < x.bk) {
    // the cess and the bank: dry grass, broom and wild fennel
    P.t = T.BANK;
    grassColor(W, wx, d, c);
    if (d < 6.5) mixc(c, C.cess, c, smooth(4.4, 6.5, d));
    else if (noise2(wx / 6, d / 4, ws + 343) > 0.72) mixc(c, C.broom, c, 0.4);
    mulc(c, 0.85 + 0.3 * rng());
    return P;
  }
  const ar = Math.abs(d - x.rd);
  if (ar < 3.4) {
    P.t = T.ROAD;
    if (ar < 2.2) { setc(c, C.road); mulc(c, 0.9 + 0.12 * rng()); if (Math.abs(ar - 1.1) < 0.25) mulc(c, 0.9); }
    else { mixc(c, C.road, C.dryGrass, smooth(2.2, 3.4, ar)); mulc(c, 0.88 + 0.2 * rng()); }
    return P;
  }
  const ad = Math.abs(d - x.rc), hw = x.rw * 0.5;
  if (ad < hw + 9) {
    if (ad < hw) {
      P.t = T.RIVER;
      const u = (d - (x.rc - hw)) / x.rw;
      mixc(c, C.river, C.riverLit, 0.5 * noise2(wx / 25, u * 3, ws + 351) + 0.3 * smooth(0.15, 0, Math.min(u, 1 - u)));
      if (WINE) mixc(c, C.wine, c, 0.25 * smooth(0.15, 0, Math.min(u, 1 - u)) + 0.1 * noise2(wx / 25, u * 3, ws + 351));
      mulc(c, 0.96 + 0.08 * rng());
      return P;
    }
    // reeds and green grass along the banks (the one green thing at the end of summer)
    P.t = T.RBANK;
    mixc(c, C.greenGrass, C.dryGreen, smooth(hw + 2, hw + 9, ad) * 0.7 + 0.3 * rng());
    if (ad < hw + 1.5) mixc(c, C.gravel, c, 0.5);
    return P;
  }
  const lit = 0.8 + 0.34 * Math.max(0, nx * SX + ny * SY + nz * SZ);
  const sh = siteHit(W, wx, d);
  if (sh.k) {
    P.t = T.FIELD;
    if (sh.k === 3) { P.t = T.ROAD; mixc(c, C.road, C.roadDark, 0.3 * rng()); mulc(c, lit * 0.95); }
    else if (sh.k === 4) { P.t = T.RIVER; mixc(c, C.river, C.riverLit, 0.5 * rng()); }
    else if (sh.k === 6) { P.t = T.RBANK; mixc(c, C.greenGrass, C.dryGreen, 0.5 * rng()); }
    else if (sh.k === 5) { mixc(c, C.stone, C.stoneWarm, 0.4 * rng()); mulc(c, lit * 0.95); }
    else if (sh.k === 8) { grassColor(W, wx, d, c); if (rng() < 0.08) mixc(c, C.poppy, c, 0.3); mulc(c, lit * (0.88 + 0.2 * rng())); }
    else if (sh.k === 2) { mixc(c, [0.3, 0.42, 0.16], C.road, (Math.sin(wx * 0.9) > 0.7 || Math.sin(d * 0.9) > 0.7) ? 0.8 : 0.1 * rng()); mulc(c, lit); }
    else { mixc(c, C.road, C.earth, 0.45 + 0.3 * noise2(wx / 6, d / 5, ws + 381)); grassColor(W, wx, d, P.gapC); mixc(c, c, P.gapC, 0.35 * smooth(0.5, 0.9, noise2(wx / 9, d / 7, ws + 382))); mulc(c, lit * (0.88 + 0.2 * rng())); }
    return P;
  }
  const q = plotAt(W, wx, d), p = q.p;
  P.p = p;
  const edge = Math.min(q.eu, q.ev);
  if (edge < 1.6 + 0.004 * d && p.t !== PK.WOOD) {
    // the grassy edge between plots, with poppies
    P.t = T.EDGE;
    grassColor(W, wx, d, c);
    if (d < 900 && rng() < 0.16 * smooth(900, 200, d)) mixc(c, C.poppy, c, 0.25);
    mulc(c, lit * (0.88 + 0.2 * rng()));
    return P;
  }
  P.t = T.FIELD;
  const k = p.tone;
  switch (p.t) {
    case PK.VINE: {
      // (far off the rows are drawn at a wider pitch than they have, so that a vineyard on a slope
      // a kilometre away still shows as rows)
      P.t = T.VINE; P.row = 1; P.stand = 1; P.ca = p.ca; P.sa = p.sa; P.pitch = p.pitch * clamp(p.cd / 170, 1, 3.5); P.share = p.share; P.ph = p.ph;
      // the canopy: dusty green, lit along its top, yellowing in places; old vines darker
      const yel = smooth(0.55, 0.85, noise2(wx / 70, d / 50, ws + 361));
      mixc(P.rowC, C.vine, C.vineYellow, yel * 0.6);
      if (p.age > 1.1) mixc(P.rowC, P.rowC, C.vineDark, 0.3);
      mulc(P.rowC, k * lit);
      if (p.grass) grassColor(W, wx, d, P.gapC); else mixc(P.gapC, C.earth, C.earthDark, 0.4 * noise2(wx / 9, d / 7, ws + 362));
      mulc(P.gapC, k * lit);
      P.lift = 0.85 * p.age;
      mixc(c, P.gapC, P.rowC, p.share);
      return P;
    }
    case PK.OLIVE: {
      P.t = T.OLIVE; P.ca = p.ca; P.sa = p.sa; P.pitch = p.pitch; P.ph = p.ph;
      if (p.grass) grassColor(W, wx, d, c); else mixc(c, C.earth, C.dryGrass, 0.4 + 0.3 * noise2(wx / 12, d / 9, ws + 363));
      if (p.nets) mixc(c, c, [0.24, 0.36, 0.22], 0.25);
      mulc(c, k * lit);
      return P;
    }
    case PK.STUBBLE: {
      P.row = 1; P.stand = 0; P.ca = p.ca; P.sa = p.sa; P.pitch = p.pitch; P.share = 0.35; P.ph = p.ph;
      mixc(P.gapC, C.straw, C.dryGrass, 0.3 * noise2(wx / 40, d / 30, ws + 364));
      mulc(P.gapC, k * lit);
      mixc(P.rowC, C.strawDark, P.gapC, 0.3); mulc(P.rowC, 0.95);
      mixc(c, P.gapC, P.rowC, 0.35);
      return P;
    }
    case PK.WHEAT: {
      mixc(c, C.wheat, C.wheatDark, 0.5 * noise2(wx / 16, d / 12, ws + 365) + 0.25 * rng());
      mulc(c, k * lit);
      P.lift = 0.6;
      return P;
    }
    case PK.SUN: {
      P.row = 1; P.stand = 1; P.ca = p.ca; P.sa = p.sa; P.pitch = p.pitch; P.share = 0.6; P.ph = p.ph;
      const dry = p.dry ? 0.75 : 0.1 * noise2(wx / 20, d / 20, ws + 366);
      mixc(P.rowC, C.sunflower, C.sunflowerDry, dry);
      // (further off the leaves and the backs of the heads show as much as their faces)
      if (d > 120) mixc(P.rowC, P.rowC, C.sunLeaf, 0.4 * smooth(120, 400, d));
      mixc(P.gapC, C.sunLeaf, C.earthDark, 0.35);
      mulc(P.rowC, k * lit); mulc(P.gapC, k * lit);
      P.lift = 1.5;
      mixc(c, P.gapC, P.rowC, 0.55);
      return P;
    }
    case PK.CLAY: {
      P.row = 1; P.stand = 0; P.ca = p.ca; P.sa = p.sa; P.pitch = p.pitch; P.share = 0.45; P.ph = p.ph;
      const cr = noise2(wx / 30, d / 22, ws + 367);
      mixc(P.gapC, C.clay, C.stoneWarm, 0.25 * cr + 0.3 * smooth(400, 2500, d));
      mulc(P.gapC, k * lit * (1 - 0.12 * smooth(400, 2500, d)));
      mixc(P.rowC, C.clayDark, P.gapC, 0.25);
      mixc(c, P.gapC, P.rowC, 0.45);
      return P;
    }
    case PK.WOOD: {
      P.t = T.WOOD;
      P.f = Math.min(q.eu, q.ev);
      setc(c, C.woodFloor);
      return P;
    }
    default: {
      grassColor(W, wx, d, c);
      mixc(c, c, C.straw, 0.2);
      mulc(c, k * lit * (0.9 + 0.2 * rng()));
      return P;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The ground fill. The splats are spread by how much of the window each part of the band fills
// (after himalaya.js and alps.js): per strip of the chunk, a table of distance bins weighted by the
// angle the ground climbs through in each, seen from the window, with a floor so no part is left
// thin; ground hidden behind nearer ground (occl) gets few. In a crop in rows a splat is snapped to
// a row or to the gap between two and stretched along it, so the stripes hold at any distance.
// ---------------------------------------------------------------------------------------------
const TAN_TOP = 0.5, TAN_BOT = -0.62;
const QG = [0, 0, 0, 1];
function* fillView(ctx, out, W, opts = {}) {
  out.limit = Infinity;
  const n = Math.floor(opts.n != null ? opts.n : out.left());
  if (n <= 0) return;
  const rng = ctx.rng, L = ctx.length;
  const dn = opts.dNear != null ? opts.dNear : ctx.zNear, df = opts.dFar != null ? opts.dFar : ctx.zFar;
  const NS = opts.strips || 6, NB = 40, cover = opts.cover || 3.2;
  const minR = opts.minR || 0.0015, maxR = opts.maxR || 0.04, floorK = opts.floor != null ? opts.floor : 0.4;
  const rows3d = opts.rows3d || 0;      // nearer than this the vines are drawn in 3D: the fill gives the gaps
  const olives3d = opts.olives3d || 0;  // (and the olive trees)
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
      let d = db[b] + rng() * (db[b + 1] - db[b]);
      let x = (k + rng()) * SL;
      const wx = ctx.x0 + x;
      const dens = (nk * (w[b] / sw)) / ((db[b + 1] - db[b]) * SL);
      let r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
      const e = Math.max(0.6, r * 0.7);
      const yx = W.H(wx + e, d), yd = W.H(wx, d + e), y = W.H(wx, d);
      const hx = (yx - y) / e, hd = (yd - y) / e;
      const il = 1 / Math.hypot(hx, 1, hd);
      const nx = -hx * il, ny = il, nz = hd * il;
      WINE = ctx.dials && ctx.dials.topology > 0 ? 1 : 0;
      const p = paint(W, wx, d, y, nx, ny, nz, rng);
      const c = p.c, t = p.t;
      if (t === T.RIVER) {
        out(x, y + 0.02, -d, r * 1.5, r * 0.05, r * 0.75, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      } else if (t === T.WOOD) {
        emitWood(out, W, x, wx, y, d, r, p.f, rng, far);
      } else if (p.row && r < p.pitch * 1.1 && !(p.stand && d < rows3d)) {
        // a crop in rows, resolved: on a row or in a gap, stretched along it
        const tt = (-wx * p.sa + d * p.ca) / p.pitch + p.ph;
        const onRow = rng() < p.share;
        const ts = onRow ? Math.round(tt) : Math.floor(tt) + 0.5 + (rng() - 0.5) * (1 - p.share) * 0.8;
        const sh = (ts - tt) * p.pitch;
        x += -p.sa * sh; d += p.ca * sh;
        const cc = onRow ? p.rowC : p.gapC, jj = 0.9 + 0.2 * rng();
        const wid = onRow ? Math.max(Math.min(r, p.pitch * p.share * 0.5), 0.0006 * d) : Math.max(Math.min(r, p.pitch * (1 - p.share) * 0.5), 0.0006 * d);
        const len = Math.min(r * r / wid, r * 5, 0.06 * d + 2);
        const q = quatXTo(p.ca, 0, -p.sa);
        if (onRow && p.stand) {
          const hgt = Math.max(0.3, p.lift * 0.75);
          out(x, y + p.lift, -d, len, Math.max(hgt, wid * 0.5), wid, cc[0] * jj, cc[1] * jj, cc[2] * jj, 1, q[0], q[1], q[2], q[3], KIND.GROUND);
        } else {
          out(x, y + 0.04, -d, len, Math.max(0.02, wid * 0.15), wid, cc[0] * jj, cc[1] * jj, cc[2] * jj, 1, q[0], q[1], q[2], q[3], KIND.GROUND);
        }
      } else if (p.row && p.stand && d < rows3d) {
        // under the 3D rows: the gaps, darker in the canopy's shade
        const tt = (-wx * p.sa + d * p.ca) / p.pitch + p.ph, f = Math.abs(tt - Math.round(tt));
        const cc = p.gapC, k2 = (0.62 + 0.38 * smooth(0.12, 0.3, f)) * (0.9 + 0.2 * rng());
        out(x, y + 0.03, -d, r * 1.1, r * 0.12, r * 0.9, cc[0] * k2, cc[1] * k2, cc[2] * k2, 1, 0, 0, 0, 1, KIND.GROUND);
      } else {
        // the disc lies in the slope, stretched down the fall line where it is steep
        const ph = Math.atan2(nx, nz) * 0.5, cy = Math.cos(ph), sy = Math.sin(ph);
        const qw = 1 + ny, ql = Math.hypot(nz, nx, qw), ux = nz / ql, uz = -nx / ql, uw = qw / ql;
        QG[0] = ux * cy - uz * sy; QG[1] = uw * sy; QG[2] = uz * cy + ux * sy; QG[3] = uw * cy;
        let el = clamp(1 / ny, 1, opts.far2 ? 1.7 : 6), ew = 1;
        const a = 0.85 + 0.3 * rng();
        if (opts.far2) {
          if (el > 1.15) { const yUp = W.H(wx, d + r * 1.3); if (yUp < y + r * 0.25) { r *= 0.6; el = 1; } }
        } else if (el > 1.5) { ew = Math.pow(el, 0.3); el = Math.pow(el, 0.7); }
        let lift = 0.03 + (p.lift ? p.lift * 0.6 * rng() : 0), thick = 0.12;
        if (p.row && r >= p.pitch * 1.1) { if (rng() < p.share) { c[0] = p.rowC[0]; c[1] = p.rowC[1]; c[2] = p.rowC[2]; if (p.stand) { lift = p.lift; thick = 0.3; } } else { c[0] = p.gapC[0]; c[1] = p.gapC[1]; c[2] = p.gapC[2]; } }
        if (t === T.OLIVE && d >= olives3d) {
          // an olive grove is a grid of silver-green crowns over its ground
          const tu = (wx * p.ca + d * p.sa) / p.pitch + p.ph, tv = (-wx * p.sa + d * p.ca) / p.pitch + p.ph;
          const fu = tu - Math.round(tu), fv = tv - Math.round(tv);
          if (r > p.pitch * 0.5 ? rng() < 0.45 : fu * fu + fv * fv < 0.09) {
            const k3 = 0.8 + 0.3 * rng();
            out(x, y + 2.4, -d, Math.max(r, 2.2), Math.max(r * 0.7, 1.6), Math.max(r * 0.8, 2.0), C.olive[0] * k3, C.olive[1] * k3, C.olive[2] * k3, 1, 0, 0, 0, 1, KIND.GROUND);
            if (out.due()) yield;
            continue;
          }
        }
        if (d > 1800) {
          // far off the hills are wooded and lit by their slope (the dark of them, under the haze,
          // is what makes the ranges blue), so they layer one behind another
          const wf = Math.min(0.85, (0.12 + 0.6 * smooth(1800, 9000, d)) * (0.6 + 0.8 * noise2(wx / 2600, d / 1700, W.ws + 391)));
          const lt = Math.max(0, nx * SX + ny * SY + nz * SZ);
          mixc(c, c, C.farWood, wf);
          mulc(c, 0.55 + 0.6 * lt);
        }
        if (d > 600 && d < 3200 && townAt(W, wx, d)) {
          // under a hill town: its streets and roofs, the discs sunk so they never stand in front of
          // the houses
          mixc(c, C.roof, C.stoneWarm, rng());
          mulc(c, 0.7 + 0.25 * rng());
          lift = -0.4 * r;
        }
        out(x, y + lift, -d, r * a * ew, r * thick, r * (2 - a) * el, c[0], c[1], c[2], 1, QG[0], QG[1], QG[2], QG[3], KIND.GROUND);
      }
      if (out.due()) yield;
    }
  }
}
// One ground sample in a wood: nearby, a dark splat somewhere between the floor and the canopy (the
// trees at the wood's edge are drawn one by one in front of it); far off, where a splat is the size
// of a tree, a rounded crown of oak (or the flat top of an umbrella pine) lit on its sunward side.
function emitWood(out, W, x, wx, y, d, r, f, rng, far) {
  const u = rng();
  const pine = noise2(wx / 300, d / 300, W.ws + 371) > 0.62;
  const H = (pine ? 15 : 12) * smooth(0, 6, f + 1);
  if (!far) {
    const v = Math.pow(u, 0.7);
    const k = (0.6 + 0.7 * v) * (0.8 + 0.4 * rng());
    const w = Math.max(r * 1.2, 1.7);
    out(x, y + H * (0.1 + 0.62 * v), -d, w, Math.max(w, H * 0.12), w, C.oak[0] * 0.55 * k, C.oak[1] * 0.55 * k, C.oak[2] * 0.55 * k, 1, 0, 0, 0, 1, KIND.HEDGE);
    return;
  }
  const base = pine ? C.pine : C.oak, tip = pine ? C.pineLit : C.oakLit;
  const hh = Math.max(H, r * 1.4) * (0.8 + 0.4 * rng());
  if (u < 0.55) {
    const k = 0.55 + 0.5 * rng(), w = Math.max(r * 0.9, hh * 0.3);
    out(x, y + hh * 0.45, -d, w, hh * (pine ? 0.22 : 0.36), w, base[0] * k, base[1] * k, base[2] * k, 1, 0, 0, 0, 1, KIND.HEDGE);
  } else {
    const k = 0.6 + 0.5 * rng(), w = Math.max(r * 0.6, hh * 0.24);
    out(x - w * 0.2, y + hh * (pine ? 0.75 : 0.68), -(d - w * 0.2), w, hh * 0.2, w, tip[0] * k, tip[1] * k, tip[2] * k, 1, 0, 0, 0, 1, KIND.HEDGE);
  }
}
// The trackside's ground: plain samples by plan area.
function* fillPlain(ctx, out, W, opts = {}) {
  out.limit = Infinity;
  const n = Math.floor(opts.n != null ? opts.n : out.left());
  if (n <= 0) return;
  const rng = ctx.rng;
  const dn = opts.dNear != null ? opts.dNear : ctx.zNear, df = opts.dFar != null ? opts.dFar : ctx.zFar;
  const L = ctx.length;
  const p = opts.power != null ? opts.power : 1.5, cover = opts.cover || 3;
  const minR = opts.minR || 0.0015, maxR = opts.maxR || 0.08;
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
    WINE = ctx.dials && ctx.dials.topology > 0 ? 1 : 0;
    const pp = paint(W, wx, d, y, nx, ny, nz, rng);
    const c = pp.c;
    const nzc = nz < 0 ? 0 : nz, qw = 1 + ny, ql = Math.hypot(nzc, nx, qw);
    const ax = 0.8 + 0.5 * rng();
    const tall = pp.t === T.BANK || pp.t === T.EDGE ? 1 : 0;
    const away = nz < 0 ? Math.min(0.5, -nz * 1.6) : 0;
    out(x, y + 0.03 + tall * r * 0.5 * rng(), -d, r * ax, r * (0.12 + 0.3 * tall + away), r * (1.8 - ax), c[0], c[1], c[2], 1, nzc / ql, 0, -nx / ql, qw / ql, KIND.GROUND);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Trees: cypress, olive, umbrella pine, oak, poplar. Each is drawn from an rng of its own (made from
// its world position), so it comes out the same whichever chunk or band draws it.
// ---------------------------------------------------------------------------------------------
function treeN(out, d, H, Wd) {
  const r = Math.max(0.03, 0.0032 * d * out.detailK / Math.sqrt(out.density)) * 1.2;
  return clamp(Math.round((H * Wd * 0.6) / (r * r * 1.5)), 1, 900 * Math.min(2, out.density));
}
// A cypress: a tall near-black spindle, widest a third of the way up and closing to a point, its
// foliage in upright flame-shaped sprays, lit on the sunward side. (A poplar is the same form,
// lighter, wider and looser.)
function* cypress(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const pop = !!opts.poplar;
  const H = opts.height || 16, Wd = opts.width || H * (pop ? 0.15 : 0.115);
  const y0 = opts.y != null ? opts.y : ctx.terrain.height(ctx.x0 + x, d) - 0.2;
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const n = Math.max(1, Math.round(opts.n || treeN(out, d, H, Wd)));
  const col = opts.color || (pop ? C.poplar : C.cypress), lit = pop ? [0.46, 0.52, 0.3] : C.cypressLit;
  // (a flame: full low down, the sides nearly straight, closing to a sharp point)
  const prof = (t) => Wd * 0.5 * (t < 0.25 ? 0.82 + 0.18 * t / 0.25 : Math.pow((1 - t) / 0.75, pop ? 0.45 : 0.75));
  if (n <= 5) {
    const parts = [[0.28, 0.42, 0.28], [0.6, 0.28, 0.2], [0.85, 0.12, 0.12]];
    for (let k = 0; k < Math.min(3, n); k++) {
      const [fy, fw, fh] = parts[k];
      const c = mul3(col, 0.95 + 0.35 * k);
      out(x, y0 + H * fy, -d, Wd * fw * 1.1, H * fh, Wd * fw, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
    return;
  }
  // the trunk's foot, and a dark core so that no sky shows through
  out(x, y0 + 0.3, -d, Math.max(0.12, Wd * 0.08), 0.4, Math.max(0.12, Wd * 0.08), C.bark[0], C.bark[1], C.bark[2], 1, 0, 0, 0, 1, kind);
  const coreN = Math.max(2, Math.round(n * 0.08));
  for (let i = 0; i < coreN; i++) {
    const t = (i + 0.5) / coreN * 0.8;
    const c = mul3(col, 0.6);
    out(x, y0 + 0.4 + t * H, -(d - prof(t) * 0.15), prof(t) * 0.7, Math.min(H / coreN * 0.62, prof(t) * 2.5), prof(t) * 0.6, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
  }
  // the point
  { const c = mul3(mix3(col, lit, 0.3), 0.9); out(x, y0 + 0.4 + H * 0.94, -d, Wd * 0.07, H * 0.07, Wd * 0.07, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind); }
  const s0 = Math.sqrt((H * Wd * 0.8) / n);
  for (let i = coreN; i < n; i++) {
    const t = Math.min(0.985, Math.pow(rng(), 1.12));
    let a = rng() * Math.PI * 2;
    if (Math.sin(a) < -0.25 && rng() < 0.65) a = -a;            // most of them on the side the window sees
    const ca = Math.cos(a), sa = Math.sin(a), R = prof(t) * (0.78 + 0.22 * rng());
    const l = Math.max(0, ca * SX + 0.35 * SY + sa * SZ);
    const f = 0.55 + 0.45 * rng();
    let c = mix3(col, lit, l * f * (pop ? 0.9 : 0.75));
    c = mul3(c, (0.62 + 0.5 * l) * (0.85 + 0.3 * rng()));
    const ss = Math.max(0.04, s0 * (0.7 + 0.5 * rng()) * Math.min(1, prof(t) / (Wd * 0.32) + 0.12));
    out(x + ca * R, y0 + 0.4 + t * H, -(d - sa * R), ss, ss * (pop ? 1.6 : 2.3), ss * 0.85, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    if (out.due()) yield;
  }
}
// An olive: a short gnarled trunk that splits into two or three twisting limbs, under a rounded,
// open crown of several lumps, silver-green, the lit tops paler.
function* oliveTree(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 5, Wc = opts.crown || H * 1.05;
  const y0 = opts.y != null ? opts.y : ctx.terrain.height(ctx.x0 + x, d) - 0.1;
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const n = Math.max(1, Math.round(opts.n || treeN(out, d, H, Wc)));
  if (n <= 4) {
    const c = jitter(C.olive, rng, 0.1);
    out(x, y0 + H * 0.62, -d, Wc * 0.5, H * 0.3, Wc * 0.45, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    if (n > 1) out(x, y0 + H * 0.2, -d, Math.max(0.2, 0.0007 * d), H * 0.2, 0.2, C.oliveBark[0], C.oliveBark[1], C.oliveBark[2], 1, 0, 0, 0, 1, kind);
    return;
  }
  const tr = Math.max(0.16 * H / 5, thin(d, 1.2)), bk = C.oliveBark;
  const fx = (rng() - 0.5) * 0.5, fz = (rng() - 0.5) * 0.4, fork = H * (0.22 + 0.08 * rng());
  bar(out, x, y0 - 0.1, -d, x + fx, y0 + fork, -(d + fz), tr * 1.25, mul3(bk, 0.9), 2, kind);
  const limbs = 2 + (rng() < 0.5 ? 1 : 0), lumps = [];
  for (let j = 0; j < limbs; j++) {
    const a = (j / limbs) * Math.PI * 2 + rng(), r0 = Wc * (0.18 + 0.12 * rng());
    const ex = x + fx + Math.cos(a) * r0, ez = d + fz + Math.sin(a) * r0 * 0.7, ey = y0 + H * (0.5 + 0.1 * rng());
    bar(out, x + fx, y0 + fork, -(d + fz), ex, ey, -ez, tr * 0.8, mul3(bk, 1.05), 2, kind);
    lumps.push([ex, ey, ez]);
  }
  const leafN = n - 2 - 2 * limbs;
  const nl = Math.max(3, lumps.length + 1);
  for (let j = 0; j < nl; j++) {
    const L = lumps[j % lumps.length];
    const lx = j < lumps.length ? L[0] : x + fx + (rng() - 0.5) * Wc * 0.3, lz = j < lumps.length ? L[2] : d + fz;
    const ly = j < lumps.length ? L[1] + H * 0.12 : y0 + H * 0.78;
    const lr = Wc * (0.3 + 0.08 * rng());
    yield* blobT(out, lx, ly, lz, lr, lr * 0.62, lr * 0.85, Math.round(leafN / nl), jitter(C.olive, rng, 0.08), C.oliveLit, rng, kind, 0.4);
  }
}
// An umbrella pine: a tall bare trunk, often leaning, and a broad flat crown at the top.
function* stonePine(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 15, Wc = opts.crown || H * 0.75;
  const y0 = opts.y != null ? opts.y : ctx.terrain.height(ctx.x0 + x, d) - 0.2;
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const n = Math.max(1, Math.round(opts.n || treeN(out, d, H * 0.45, Wc)));
  const lx = (rng() - 0.5) * H * 0.25, lz = (rng() - 0.5) * H * 0.12, ct = H * 0.13;
  if (n <= 4) {
    out(x + lx, y0 + H - ct, -(d + lz), Wc * 0.5, ct, Wc * 0.42, C.pine[0], C.pine[1], C.pine[2], 1, 0, 0, 0, 1, kind);
    if (n > 1) out(x + lx * 0.5, y0 + H * 0.42, -(d + lz * 0.5), Math.max(0.25, 0.0008 * d), H * 0.4, 0.25, 0.36, 0.27, 0.2, 1, 0, 0, 0, 1, kind);
    return;
  }
  const tr = Math.max(0.22, thin(d, 1.3)), bark = [0.42, 0.3, 0.22];
  bar(out, x, y0, -d, x + lx * 0.85, y0 + H - ct * 1.6, -(d + lz * 0.85), tr, bark, 3, kind);
  for (let j = 0; j < 3; j++) {
    const a = j * 2.1 + rng();
    bar(out, x + lx * 0.85, y0 + H - ct * 1.6, -(d + lz * 0.85), x + lx + Math.cos(a) * Wc * 0.28, y0 + H - ct * 1.1, -(d + lz + Math.sin(a) * Wc * 0.2), tr * 0.6, bark, 1, kind);
  }
  const lumps = 3 + Math.floor(rng() * 2), leafN = n - 6;
  for (let j = 0; j < lumps; j++) {
    const a = (j / lumps) * Math.PI * 2 + rng(), o = Wc * 0.22;
    const r1 = Wc * (0.3 + 0.06 * rng());
    yield* blobT(out, x + lx + Math.cos(a) * o, y0 + H - ct * (0.9 + 0.3 * rng()), d + lz + Math.sin(a) * o * 0.7, r1, ct * 0.85, r1 * 0.8, Math.round(leafN / lumps), jitter(C.pine, rng, 0.08), C.pineLit, rng, kind, 0.45);
  }
}
// An oak (or a holm oak): a short trunk under a rounded crown of lumps.
function* oakTree(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 11, Wc = opts.crown || H * 0.85;
  const y0 = opts.y != null ? opts.y : ctx.terrain.height(ctx.x0 + x, d) - 0.2;
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const n = Math.max(1, Math.round(opts.n || treeN(out, d, H, Wc)));
  if (n <= 4) {
    const c = jitter(C.oak, rng, 0.1);
    out(x, y0 + H * 0.6, -d, Wc * 0.5, H * 0.34, Wc * 0.45, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    return;
  }
  const tr = Math.max(0.2, thin(d, 1.2));
  bar(out, x, y0, -d, x, y0 + H * 0.45, -d, tr, C.bark, 2, kind);
  const lumps = n < 30 ? 2 : 3 + Math.floor(rng() * 2);
  for (let j = 0; j < lumps; j++) {
    const a = (j / lumps) * Math.PI * 2 + rng(), o = lumps > 1 ? Wc * 0.2 : 0;
    const r1 = Wc * (lumps > 1 ? 0.36 + 0.08 * rng() : 0.5);
    yield* blobT(out, x + Math.cos(a) * o, y0 + H - Wc * 0.42 + (rng() - 0.3) * Wc * 0.15, d + Math.sin(a) * o * 0.6, r1, r1 * 0.82, r1, Math.round((n - 2) / lumps), jitter(C.oak, rng, 0.1), C.oakLit, rng, kind, 0.42);
  }
}
// A lump of foliage: splats over an ellipsoid, most on the side the window sees and the top, shaded
// from their direction; a dark opaque core so the sky never shows through at the sides of the frame.
function* blobT(out, x, y, d, rx, ry, rz, n, col, litC, rng, kind, inner = 0.4) {
  if (n <= 0) return;
  const rMin = Math.min(rx, ry, rz);
  const area = 2 * Math.PI * (rx * ry + ry * rz + rx * rz) / 3 * 1.2;
  const s = Math.max(Math.min(Math.sqrt(area / n) * 0.75, rMin * 0.85), Math.min(0.0006 * d, rMin));
  if (n >= 16) { const c = mul3(col, 0.5); out(x, y, -d, rx * 0.5, ry * 0.5, rz * 0.45, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind); n--; }
  for (let i = 0; i < n; i++) {
    let ux = rng() * 2 - 1, uy = rng() * 2 - 1, uz = rng() * 2 - 1;
    const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    if (uz < -0.3 && rng() < 0.7) uz = -uz;
    const rad = Math.pow(rng(), 0.35);
    const lt = Math.max(0, ux * SX + uy * SY + uz * SZ);
    let c = mix3(col, litC, lt * lt * 0.8);
    c = mul3(c, (0.62 + 0.5 * lt) * ((1 - inner) + inner * rad) * (0.88 + 0.24 * rng()));
    const ss = s * (0.6 + 0.7 * rng());
    out(x + ux * rx * rad, y + uy * ry * rad, -(d - uz * rz * rad), ss, ss * 0.8, ss, c[0], c[1], c[2], 0.95, 0, 0, 0, 1, kind);
    if (out.due()) yield;
  }
}
const TREE_FN = { cypress, poplar: cypress, olive: oliveTree, pine: stonePine, oak: oakTree };
// Placing trees with a shared budget: collect them first, then give each a share of the splats in
// proportion to its size on screen, capped at full detail (after winter.js and alps.js).
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
    yield* TREE_FN[t.type](ctx, out, t.x, t.d, { ...t.opts, n: t.n });
    if (out.due()) yield;
  }
}
// One tree for the plan. type: 'cypress', 'poplar', 'olive', 'pine', 'oak'; H its height.
function planTree(ctx, out, W, type, wx, d, H, opts = {}) {
  const Wd = type === 'cypress' ? H * 0.13 : type === 'poplar' ? H * 0.2 : type === 'olive' ? H * 1.05 : type === 'pine' ? H * 0.75 : H * 0.85;
  const Hs = type === 'pine' ? H * 0.45 : H;
  const nMax = Math.max(1, Math.round(treeN(out, d, Hs, Wd) * (opts.detail || 1)));
  const y = opts.y != null ? opts.y : W.H(wx, d) - 0.15;
  return { type, x: wx - ctx.x0, d, w: (Hs * Wd) / (d * d), nMax, opts: { rng: makeRng(hashInts(W.ws, 921, Math.round(wx * 8), Math.round(d * 8))), height: H, y, kind: opts.kind, poplar: type === 'poplar', color: opts.color } };
}

// ---------------------------------------------------------------------------------------------
// The plots in view of a chunk, found once per generator call: each with the box (world x and
// distance) it was seen in, so the rows and the trees in it can be laid out without a search.
// ---------------------------------------------------------------------------------------------
function plotsIn(ctx, W, dLo, dHi) {
  const res = new Map();
  const x0 = ctx.x0 - 6, x1 = ctx.x0 + ctx.length + 6;
  for (let d = dLo; d < dHi; d += Math.max(3, d * 0.06)) {
    const st = Math.max(4, d * 0.05);
    for (let wx = x0; wx <= x1; wx += st) {
      const x = xAt(W, wx);
      if (d < x.bk + 1 || Math.abs(d - x.rd) < 4 || Math.abs(d - x.rc) < x.rw * 0.5 + 9) continue;
      const q = plotAt(W, wx, d), p = q.p;
      let e = res.get(p);
      if (!e) { e = { p, xa: wx, xb: wx, da: d, db: d }; res.set(p, e); }
      else { if (wx < e.xa) e.xa = wx; if (wx > e.xb) e.xb = wx; if (d < e.da) e.da = d; if (d > e.db) e.db = d; }
    }
  }
  const list = [];
  for (const e of res.values()) {
    e.xa = Math.max(x0, e.xa - 12); e.xb = Math.min(x1, e.xb + 12);
    e.da = Math.max(dLo, e.da - Math.max(6, e.da * 0.1)); e.db = Math.min(dHi, e.db + Math.max(6, e.db * 0.1));
    list.push(e);
  }
  return list;
}
// Is (wx, d) open crop land in plot p, at least m metres inside its edges, and clear of the road,
// the river, the bank and the sites (farms, villas, avenues)?
function inPlot(W, wx, d, p, m) {
  const x = xAt(W, wx);
  if (d < x.bk + 2 || Math.abs(d - x.rd) < 4.5 || Math.abs(d - x.rc) < x.rw * 0.5 + 9) return false;
  const q = plotAt(W, wx, d);
  if (q.p !== p || Math.min(q.eu, q.ev) < m + 0.004 * d) return false;
  return !siteAt(W, wx, d);
}
// Lay points along the rows of plot e: for each row (its index ti) a world-anchored run of points
// `step` apart, those inside the plot. Yields a reused object { ti, k, wx, d, end, near } where end
// is -1 / +1 at the first / last point of a row (as far as this run sees), else 0, and near is true
// at the end of a row that faces the line.
const RP = { ti: 0, k: 0, wx: 0, d: 0, end: 0, near: false };
function* rowPoints(W, e, step, dLo, dHi, m) {
  const p = e.p, ca = p.ca, sa = p.sa, pitch = p.pitch;
  let tmin = Infinity, tmax = -Infinity;
  for (const [wx, d] of [[e.xa, e.da], [e.xb, e.da], [e.xa, e.db], [e.xb, e.db]]) { const t = (-wx * sa + d * ca) / pitch + p.ph; tmin = Math.min(tmin, t); tmax = Math.max(tmax, t); }
  for (let ti = Math.ceil(tmin); ti <= Math.floor(tmax); ti++) {
    const c0 = (ti - p.ph) * pitch;
    let s0 = -Infinity, s1 = Infinity;
    if (Math.abs(ca) > 1e-4) { const a = (e.xa + c0 * sa) / ca, b = (e.xb + c0 * sa) / ca; s0 = Math.max(s0, Math.min(a, b)); s1 = Math.min(s1, Math.max(a, b)); }
    if (Math.abs(sa) > 1e-4) { const a = (e.da - c0 * ca) / sa, b = (e.db - c0 * ca) / sa; s0 = Math.max(s0, Math.min(a, b)); s1 = Math.min(s1, Math.max(a, b)); }
    if (!(s1 > s0)) continue;
    const k0 = Math.ceil(s0 / step), k1 = Math.floor(s1 / step);
    let prevOk = inPlot(W, -c0 * sa + (k0 - 1) * step * ca, c0 * ca + (k0 - 1) * step * sa, p, m);
    for (let k = k0; k <= k1; k++) {
      const s = k * step, wx = -c0 * sa + s * ca, d = c0 * ca + s * sa;
      const ok = d >= dLo && d < dHi && inPlot(W, wx, d, p, m);
      if (ok) {
        let end = prevOk ? 0 : -1;
        if (end === 0 && !inPlot(W, wx + step * ca, d + step * sa, p, m)) end = 1;
        RP.ti = ti; RP.k = k; RP.wx = wx; RP.d = d; RP.end = end;
        RP.near = end !== 0 && (Math.abs(sa) < 0.25 || (end < 0) === (sa > 0));
        yield RP;
      }
      prevOk = ok;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The crops near the line, in three dimensions
// ---------------------------------------------------------------------------------------------
// Vines: each row a hedge on its wire, from the fruiting wire at knee height to the shoots above
// head height, a dark core and two lit faces laid along the row; posts every five or six metres,
// a stouter post at the row ends and a rose bush at the end facing the line; bunches of grapes
// hanging under the canopy on the nearest rows (black, red, or gold-green in a white-wine plot),
// already picked in the rows behind the pickers of a plot at harvest.
function vineStep(p, dm, out, f = 1) { return clamp(0.0085 * dm * f / Math.sqrt(out.density), 0.3, 4); }
// How coarse the rows of this chunk must be drawn to keep within `budget` splats: 1, 1.5, 2 or 3
// (so neighbouring chunks mostly agree). Estimated from the boxes the plots were seen in.
function rowCoarse(out, plots, dLo, dHi, budget) {
  let est = 0;
  for (const e of plots) {
    const p = e.p;
    if ((p.t !== PK.VINE && p.t !== PK.SUN) || e.da >= dHi || e.db < dLo) continue;
    const dm = PLOT_D0 * Math.pow(PLOT_K, p.vi + 0.5);
    const area = (e.xb - e.xa) * (Math.min(dHi, e.db) - Math.max(dLo, e.da)) * 0.6;
    est += (area / p.pitch) / vineStep(p, dm, out) * (p.t === PK.SUN ? 2.5 : p.age < 0.6 ? 1 : 4.6);
  }
  const f = est / Math.max(1, budget);
  return f <= 1 ? 1 : f <= 1.5 ? 1.5 : f <= 2 ? 2 : f <= 3 ? 3 : f <= 4.5 ? 4.5 : 7;
}
// For scripts: note when a stage of a band has used up its share (what came after it was dropped).
function full(ctx, out, tag) { if (out.n >= out.limit - 2) note('FULL ' + tag, ctx.x0, out.n); }
// The row the pickers have reached (those on one side of it are picked).
function harvestRow(p) { return Math.round((-p.cx * p.sa + p.cd * p.ca) / p.pitch + p.ph) + ((p.seed >>> 4) % 9) - 4; }
function* vineRows(ctx, out, W, plots, dLo, dHi, coarse = 1) {
  const hi = Math.min(dHi, ROWS3D);
  for (const e of plots) {
    const p = e.p;
    if (p.t !== PK.VINE || e.da >= hi || e.db < dLo) continue;
    const dm = PLOT_D0 * Math.pow(PLOT_K, p.vi + 0.5);
    const step = vineStep(p, dm, out, coarse), a = p.age, young = a < 0.6;
    const q = quatXTo(p.ca, 0, -p.sa);
    const nxs = -p.sa, nzs = -p.ca;                         // the row's +n side, in splat space
    const litP = Math.max(0, nxs * SX + nzs * SZ), litM = Math.max(0, -nxs * SX - nzs * SZ);
    const white = (p.seed & 7) < 2, grape = white ? C.grapeGold : (p.seed & 8) ? C.grapeBlack : C.grapeRed;
    const picked = p.harvest ? harvestRow(p) : -1e9;
    const postEvery = Math.max(1, Math.round(5.6 / step));
    const pr = Math.max(0.045, thin(dm, 0.9));
    for (const pt of rowPoints(W, e, step, Math.max(dLo, e.da), hi, 1.4)) {
      const { ti, k, wx, d, end, near } = pt;
      const h = hashInts(p.seed, ti, k) >>> 0;
      const u1 = (h & 1023) / 1024, u2 = ((h >>> 10) & 1023) / 1024, u3 = ((h >>> 20) & 1023) / 1024;
      const y = W.H(wx, d), x = wx - ctx.x0, z = -d;
      const yel = smooth(0.55, 0.85, noise2(wx / 70, d / 50, W.ws + 361));
      let base = mix3(C.vine, C.vineYellow, yel * 0.6 + 0.2 * u3);
      if (a > 1.1) base = mix3(base, C.vineDark, 0.25);
      base = mul3(base, p.tone);
      const len = step * 0.72;
      if (young) {
        // a young vine: a small bush on its stake
        if (k % 2 === 0) {
          const c = mul3(mix3(base, C.vineLit, 0.3), 0.8 + 0.3 * u1);
          out(x, y + 0.45, z, 0.26, 0.24, 0.22, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.HEDGE);
          bar(out, x, y, z, x, y + 1.1, z, Math.max(0.03, thin(d, 0.6)), C.post, 1, KIND.FENCE);
        }
      } else {
        const cd = mul3(base, 0.42);
        out(x, y + 1.18 * a, z, len, 0.4 * a, 0.17, cd[0], cd[1], cd[2], 1, q[0], q[1], q[2], q[3], KIND.HEDGE);
        for (const sg of [1, -1]) {
          const lt = sg > 0 ? litP : litM, off = 0.2 + 0.05 * u2;
          const yy = y + (0.98 + 0.42 * (sg > 0 ? u1 : u2)) * a;
          let c = mix3(base, C.vineLit, lt * 0.75);
          c = mul3(c, (0.66 + 0.45 * lt) * (0.86 + 0.26 * (sg > 0 ? u2 : u1)));
          out(x + nxs * off * sg, yy, z + nzs * off * sg, len * 1.05, 0.3 * a, 0.12, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.HEDGE);
        }
        // the shoots along the top, catching the sun
        const ct = mul3(mix3(base, C.vineLit, 0.55), 0.95 + 0.2 * u3);
        out(x, y + 1.62 * a + 0.08 * u1, z, len * 0.9, 0.14, 0.15, ct[0], ct[1], ct[2], 1, q[0], q[1], q[2], q[3], KIND.HEDGE);
        // grapes on the nearest rows
        if (d < 80 && ti > picked && u3 < 0.75) {
          const sg = u1 < 0.5 ? 1 : -1, gx = x + nxs * 0.24 * sg + (u2 - 0.5) * step * 0.6, gz = z + nzs * 0.24 * sg;
          const lt = sg > 0 ? litP : litM, gc = mul3(grape, 0.75 + 0.5 * lt);
          out(gx, y + 0.72 * a, gz, 0.13, 0.19, 0.13, gc[0], gc[1], gc[2], 1, 0, 0, 0, 1, KIND.OTHER);
          if (d < 55) { const hc = mul3(mix3(grape, [0.7, 0.66, 0.6], 0.3), 0.8 + 0.3 * lt); out(gx - 0.03, y + 0.78 * a, gz + 0.06, 0.06, 0.07, 0.04, hc[0], hc[1], hc[2], 1, 0, 0, 0, 1, KIND.OTHER); }
        }
      }
      // posts, and the stout end posts
      if (end !== 0 || k % postEvery === 0) {
        const tall = end !== 0 ? 2.0 : 1.85;
        bar(out, x, y - 0.1, z, x, y + tall * Math.max(0.8, a), z, end !== 0 ? pr * 1.5 : pr, end !== 0 ? mul3(C.post, 0.85) : C.post, 2, KIND.FENCE);
      }
      if (near && d < 95) {
        // a rose bush at the end of the row (an old warning of mildew, kept for its colour)
        const ox = x - p.ca * step * 0.8 * (end < 0 ? 1 : -1), oz = z + p.sa * step * 0.8 * (end < 0 ? 1 : -1);
        const rc = (h & 3) === 0 ? [0.8, 0.66, 0.7] : (h & 3) === 1 ? [0.8, 0.4, 0.5] : C.rose;
        out(ox, y + 0.55, oz, 0.42, 0.55, 0.38, C.roseLeaf[0], C.roseLeaf[1], C.roseLeaf[2], 1, 0, 0, 0, 1, KIND.HEDGE);
        for (let j = 0; j < 5; j++) {
          const r1 = ((h >>> (j * 5)) & 31) / 32, r2 = ((h >>> (j * 5 + 2)) & 31) / 32;
          out(ox + (r1 - 0.5) * 0.6, y + 0.45 + r2 * 0.75, oz + 0.18, 0.11, 0.1, 0.08, rc[0], rc[1], rc[2], 1, 0, 0, 0, 1, KIND.OTHER);
        }
      }
      if (out.due()) yield;
    }
  }
}
// Sunflowers near the line: heads on their stalks along the rows, facing the morning (here the
// window), a dark disc in each; the leaves below.
function* sunflowers(ctx, out, W, plots, dLo, dHi, coarse = 1) {
  const hi = Math.min(dHi, ROWS3D);
  for (const e of plots) {
    const p = e.p;
    if (p.t !== PK.SUN || e.da >= hi || e.db < dLo) continue;
    const dm = PLOT_D0 * Math.pow(PLOT_K, p.vi + 0.5);
    const step = clamp(0.008 * dm * coarse / Math.sqrt(out.density), 0.32, 2);
    const qh = quatMul(quatRoll(0), [Math.sin(-0.25), 0, 0, Math.cos(-0.25)]);
    for (const pt of rowPoints(W, e, step, Math.max(dLo, e.da), hi, 1)) {
      const { ti, k, wx, d } = pt;
      const h = hashInts(p.seed, ti, k) >>> 0;
      const u1 = (h & 1023) / 1024, u2 = ((h >>> 10) & 1023) / 1024;
      const y = W.H(wx, d) + 1.45 + 0.35 * u1, x = wx - ctx.x0 + (u2 - 0.5) * step * 0.5, z = -d;
      const dry = p.dry ? 0.7 + 0.3 * u2 : 0.1 * u2;
      const hc = mul3(mix3(C.sunflower, C.sunflowerDry, dry), 0.85 + 0.25 * u1);
      const lc = mul3(C.sunLeaf, 0.7 + 0.4 * u2);
      out(x, y - 0.55, z, step * 0.6, 0.42, 0.3, lc[0], lc[1], lc[2], 1, 0, 0, 0, 1, KIND.HEDGE);
      out(x, y, z + 0.05, 0.24, 0.24, 0.06, hc[0], hc[1], hc[2], 1, qh[0], qh[1], qh[2], qh[3], KIND.OTHER);
      if (d < 70) out(x, y - 0.01, z + 0.09, 0.1, 0.1, 0.04, C.sunCentre[0], C.sunCentre[1], C.sunCentre[2], 1, qh[0], qh[1], qh[2], qh[3], KIND.OTHER);
      if (out.due()) yield;
    }
  }
}
// Olive groves: the trees on the grove's grid, for the plan; a net spread under some of them.
function olivesNear(ctx, out, W, plots, plan, dLo, dHi, detailK = 1) {
  for (const e of plots) {
    const p = e.p;
    if (p.t !== PK.OLIVE || e.da >= dHi || e.db < dLo) continue;
    const ca = p.ca, sa = p.sa, pt = p.pitch;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [wx, d] of [[e.xa, e.da], [e.xb, e.da], [e.xa, e.db], [e.xb, e.db]]) {
      const tu = (wx * ca + d * sa) / pt + p.ph, tv = (-wx * sa + d * ca) / pt + p.ph;
      u0 = Math.min(u0, tu); u1 = Math.max(u1, tu); v0 = Math.min(v0, tv); v1 = Math.max(v1, tv);
    }
    for (let a = Math.ceil(u0); a <= Math.floor(u1); a++) {
      for (let b = Math.ceil(v0); b <= Math.floor(v1); b++) {
        const h = hashInts(p.seed, a, b) >>> 0;
        if ((h & 63) < 3) continue;                                  // a gap where a tree was lost
        const j1 = ((h >>> 6) & 255) / 255 - 0.5, j2 = ((h >>> 14) & 255) / 255 - 0.5;
        const A = (a - p.ph) * pt, Bv = (b - p.ph) * pt;
        const wx = A * ca - Bv * sa + j1 * 0.8, d = A * sa + Bv * ca + j2 * 0.8;
        if (d < dLo || d >= dHi || wx < ctx.x0 - 8 || wx >= ctx.x0 + ctx.length + 8 || !inPlot(W, wx, d, p, 2.2)) continue;
        // (none in the strip just before the white road, so that what goes along it can be seen)
        const rdh = xAt(W, wx).rd;
        if (d > rdh - 14 && d < rdh + 3) continue;
        const H = (3.8 + 1.6 * (((h >>> 22) & 255) / 255)) * p.age;
        plan.push(planTree(ctx, out, W, 'olive', wx, d, H, { detail: detailK }));
        if (p.nets && ((h >>> 3) & 3) === 0 && d < 220) {
          const y = W.H(wx, d), x = wx - ctx.x0, nc = (h & 64) ? [0.2, 0.34, 0.2] : [0.62, 0.3, 0.12];
          for (let j = 0; j < 5; j++) { const an = j * 1.26 + j1; out(x + Math.cos(an) * 1.6, y + 0.06, -(d + Math.sin(an) * 1.3), 1.6, 0.03, 1.3, nc[0], nc[1], nc[2], 1, 0, 0, 0, 1, KIND.GROUND); }
        }
      }
    }
  }
}
// Round bales on the stubble, lying along the swathes the baler followed.
function* bales(ctx, out, W, plots, dLo, dHi) {
  for (const e of plots) {
    const p = e.p;
    if (p.t !== PK.STUBBLE || !p.bales || e.da >= dHi || e.db < dLo) continue;
    const dm = PLOT_D0 * Math.pow(PLOT_K, p.vi + 0.5);
    const step = 26 + 0.04 * dm;
    for (const pt of rowPoints(W, e, step, Math.max(dLo, e.da), Math.min(dHi, e.db), 3)) {
      const { ti, k, wx, d } = pt;
      const h = hashInts(p.seed, ti * 7, k) >>> 0;
      if ((h & 7) > 2 || (ti & 1)) continue;
      yield* bale(ctx, out, W, wx + (((h >>> 3) & 255) / 255 - 0.5) * 6, d, p.ca, p.sa, h);
    }
  }
}
function* bale(ctx, out0, W, wx, d, ca, sa, h) {
  const out = withMove(out0, STL), x = wx - ctx.x0, R = 0.95, Wd = 0.75;
  const y = W.H(wx, d) + R * 0.92, z = -d;
  const q = quatXTo(ca, 0, -sa);
  const tone = 0.85 + 0.3 * ((h >>> 12) & 255) / 255;
  const c = mul3(C.bale, tone), cs = mul3(C.baleDark, tone);
  if (d > 380) { out(x, y, z, Wd, R, R, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.OTHER); return; }
  out(x, y, z, Wd * 0.95, R, R, cs[0], cs[1], cs[2], 1, q[0], q[1], q[2], q[3], KIND.OTHER);
  out(x, y + R * 0.35, z + 0.1, Wd * 0.9, R * 0.62, R * 0.7, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.OTHER);
  // the two ends, paler, with the dark eye of the roll
  for (const sg of [1, -1]) {
    const ex = x + ca * Wd * sg, ez = z - sa * Wd * sg, lt = Math.max(0, ca * sg * SX - sa * sg * SZ);
    const ec = mul3(C.straw, (0.7 + 0.4 * lt) * tone);
    out(ex, y, ez, 0.08, R * 0.9, R * 0.9, ec[0], ec[1], ec[2], 1, q[0], q[1], q[2], q[3], KIND.OTHER);
    if (d < 160) out(ex + ca * 0.05 * sg, y, ez - sa * 0.05 * sg, 0.05, R * 0.25, R * 0.25, cs[0] * 0.8, cs[1] * 0.8, cs[2] * 0.8, 1, q[0], q[1], q[2], q[3], KIND.OTHER);
  }
  if (out0.due()) yield;
}
// The edges of the woods: trees on a world grid, those at an edge facing the line at full detail,
// the row behind at less, a few inside to break the canopy line. Oak, and umbrella pines in stands.
function woodEdges(ctx, out, W, plots, plan, dLo, dHi, sp, detailK = 1) {
  for (const e of plots) {
    const p = e.p;
    if (p.t !== PK.WOOD || e.da >= dHi || e.db < dLo) continue;
    const g0 = Math.floor(e.xa / sp), g1 = Math.floor(e.xb / sp), k0 = Math.floor(Math.max(dLo, e.da) / sp), k1 = Math.floor(Math.min(dHi, e.db) / sp);
    const inW = (wx, d) => { const q = plotAt(W, wx, d); return q.p === p && Math.min(q.eu, q.ev) > 1; };
    for (let gk = k0; gk <= k1; gk++) {
      for (let gx = g0; gx <= g1; gx++) {
        const r = worldRng(ctx, 901, gx, gk, sp);
        const wx = (gx + r()) * sp, d = (gk + r()) * sp;
        if (d < dLo || d >= dHi || !inW(wx, d)) continue;
        const pine = noise2(wx / 300, d / 300, W.ws + 371) > 0.62;
        const H = pine ? 13 + 5 * r() : 9 + 5 * r();
        if (!inW(wx, d - sp * 1.2)) { plan.push(planTree(ctx, out, W, pine ? 'pine' : 'oak', wx, d, H, { detail: detailK })); continue; }
        if (!inW(wx, d - sp * 2.4)) { plan.push(planTree(ctx, out, W, pine ? 'pine' : 'oak', wx, d, H * 1.05, { detail: 0.35 * detailK })); continue; }
        if (r() < 0.12) { const t = planTree(ctx, out, W, pine ? 'pine' : 'oak', wx, d, H * 1.1); t.nMax = Math.min(t.nMax, 6); plan.push(t); }
      }
    }
  }
}
// Poplars and willows along the river.
function riverTrees(ctx, out, W, plan, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, 13, 10)) {
    const r = worldRng(ctx, 941, i);
    const x = xAt(W, wx0), stand = noise1(wx0 / 380, W.ws + 942);
    for (const sg of [-1, 1]) {
      if (r() > 0.25 + 0.6 * stand) { r(); r(); continue; }
      const wx = wx0 + r() * 13, xx = xAt(W, wx), d = xx.rc + sg * (xx.rw * 0.5 + 3.5 + 4 * r());
      if (!inD(d, dLo, dHi)) continue;
      const pop = stand > 0.45;
      plan.push(planTree(ctx, out, W, pop ? 'poplar' : 'oak', wx, d, pop ? 19 + 7 * r() : 8 + 4 * r(), { color: pop ? undefined : [0.3, 0.4, 0.2] }));
    }
    void x;
  }
}
// Along the white road: in some stretches a line of cypresses on its far side, in others umbrella
// pines, in others nothing.
function roadTrees(ctx, out, W, plan, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, 11, 8)) {
    const v = noise1(wx0 / 900, W.ws + 951);
    const r = worldRng(ctx, 952, i);
    const x = xAt(W, wx0), d = x.rd + 5 + r() * 0.8;
    if (!inD(d, dLo, dHi) || siteAt(W, wx0, d)) continue;
    if (v > 0.64) plan.push(planTree(ctx, out, W, 'cypress', wx0 + r(), d, 13 + 5 * r()));
    else if (v < 0.2 && i % 2 === 0) plan.push(planTree(ctx, out, W, 'pine', wx0 + r() * 3, d + 1, 13 + 4 * r()));
  }
}
// (the farms, villas, avenues and streams keep the crops off their ground)
function siteAt(W, wx, d) { return siteHit(W, wx, d).k !== 0; }

// ---------------------------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------------------------
// A frame for a building or a figure: local x along its front, y up, z out of its front (toward
// the window at yaw 0), turned by yaw about the vertical. P gives a point in splat space, V a
// direction.
function frame(ctx, wx, base, d, yaw) {
  const [ex, ez] = rotY(1, 0, yaw), [fx, fz] = rotY(0, 1, yaw), x0 = wx - ctx.x0;
  const V = (lx, ly, lz) => [ex * lx + fx * lz, ly, ez * lx + fz * lz];
  const P = (lx, ly, lz) => [x0 + ex * lx + fx * lz, base + ly, -d + ez * lx + fz * lz];
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
const SHUTS = [[0.22, 0.34, 0.22], [0.2, 0.3, 0.26], [0.36, 0.24, 0.14], [0.3, 0.36, 0.3], [0.46, 0.42, 0.3]];
// Walls: windows in rows (a dark opening with its shutters open either side), a door in the middle of
// the front, an arcade (loggia) along the ground floor of a villa, the shadow under the eaves.
//   len: the face's length; h: wall height; fl: storey height; front: is this the front.
function wallPaint(b, len, h, front, tone, lightK, rng) {
  const fl = b.fl || 3.6, cols = Math.max(1, Math.round(len / (b.bay || 3.8))), colW = len / cols;
  const shut = b.shut != null ? SHUTS[b.shut] : null, win = C.win;
  const lc = b.lit ? LIT : null;
  return (a, bb) => {
    const yy = bb * h - 0.3, u = a * len;
    if (yy < 0.45) return mul3(tone, 0.82);                           // the plinth
    if (bb > 0.94) return mul3(tone, 0.7);                            // the shadow under the eaves
    const f = Math.floor(yy / fl), fy = (yy - f * fl) / fl;
    const ci = Math.floor(u / colW), cu = (u - ci * colW) / colW - 0.5;
    if (front && b.loggia && f === 0 && ci >= b.loggia[0] && ci < b.loggia[1]) {
      // an arch: dark under its curve, the pier between
      const ar = Math.abs(cu) / 0.4;
      if (ar < 1 && fy < 0.62 + 0.26 * Math.sqrt(Math.max(0, 1 - ar * ar))) return fy < 0.08 ? mul3(tone, 0.5) : [0.1, 0.08, 0.07];
      return tone;
    }
    if (b.blind) return tone;
    if (front && f === 0 && b.door && Math.abs(u - len / 2) < 0.9 && fy < 0.78) return b.door;
    if (f >= b.floors) return tone;
    const ww = f === 0 ? 0.16 : 0.15;
    if (Math.abs(cu) < ww && fy > 0.28 && fy < 0.8) {
      if (lc && ((Math.floor(u / colW) * 7 + f * 3 + (b.seed & 15)) % 5) < lightK) return null;     // lit (drawn as a light)
      return win;
    }
    if (shut && Math.abs(cu) < ww * 2.05 && fy > 0.26 && fy < 0.82) return shut;
    return tone;
  };
}
// A building: a box under a hipped or gabled roof of terracotta. Every wall and every roof plane is
// drawn, so it holds from any side of a pass.
//   b: { wx, d, w (along its front), dep, h (eaves), yaw, wall, roof, hip, floors, fl, shut, loggia:
//        [from, to] bays, door, seed, blind, pitch, chimney, lit }
function* building(ctx, out, W, b, o = {}) {
  const rng = makeRng(b.seed);
  const base = (b.base != null ? b.base : footing(W, b.wx, b.d, b.w, b.dep, b.yaw)) + (o.lift || 0);
  const f = frame(ctx, b.wx, base, b.d, b.yaw), { P, V } = f;
  const s = o.s || Math.max(0.14, detail(out, b.d, 1.0));
  const w = b.w, dep = b.dep, h = b.h + 0.3, K = o.kind != null ? o.kind : KIND.BUILDING;
  const wall = b.wall;
  const lightK = o.lights ? 2 : 0;
  const bl = { ...b, lit: !!o.lights };
  const faces = [
    [P(-w / 2, 0, dep / 2), V(1, 0, 0), w, V(0, 0, 1), true],
    [P(w / 2, 0, dep / 2), V(0, 0, -1), dep, V(1, 0, 0), false],
    [P(w / 2, 0, -dep / 2), V(-1, 0, 0), w, V(0, 0, -1), false],
    [P(-w / 2, 0, -dep / 2), V(0, 0, 1), dep, V(-1, 0, 0), false],
  ];
  const pitch = b.pitch || 0.4, rise = Math.tan(pitch) * dep / 2;
  const up = [0, 1, 0];
  for (let j = 0; j < 4; j++) {
    if (o.noBack && j === 2) continue;      // (in a packed town the backs are hidden by the next houses)
    const [o0, u, len, n, front] = faces[j];
    const tone = faceTone(wall, n[0], n[2]);
    const gable = !b.hip && (j === 1 || j === 3);
    const wp = wallPaint(bl, len, h, front || (j === 2 && b.backFront), tone, lightK, rng);
    const H2 = gable ? h + rise : h;
    yield* panel(out, o0, u, up, len, H2, s, (a, bb) => {
      const yy = bb * H2;
      if (gable && yy > h) { const half = 1 - (yy - h) / rise; return Math.abs(a - 0.5) * 2 < half ? mul3(tone, 0.95) : null; }
      const c = wp(a, yy / h);
      if (c === null) return LIT_MARK;
      return c;
    }, K, rng, 0.12);
    if (lightK) yield* windowLights(out, o0, u, len, h, bl, front, s);
  }
  // the roof: tiles in rows down the slope, weathered, shaded by the slope's face
  const ov = 0.45, roof = b.roof;
  const sl = Math.hypot(dep / 2 + ov, rise + ov * Math.tan(pitch));
  for (const sg of [1, -1]) {
    const e0 = P(-w / 2 - ov, h - ov * Math.tan(pitch), sg * (dep / 2 + ov)), v = V(0, Math.sin(pitch), -sg * Math.cos(pitch));
    const nrm = V(0, Math.cos(pitch), sg * Math.sin(pitch));
    const lt = Math.max(0, nrm[0] * SX + nrm[1] * SY + nrm[2] * SZ);
    const rc = mul3(roof, 0.62 + 0.5 * lt);
    const L = w + 2 * ov, hipIn = b.hip ? (dep / 2 + ov) : 0;
    yield* panel(out, e0, V(1, 0, 0), [v[0] / Math.hypot(...v), v[1] / Math.hypot(...v), v[2] / Math.hypot(...v)], L, sl, s, (a, bb) => {
      const xl = a * L;
      if (b.hip && (xl < bb * hipIn || xl > L - bb * hipIn)) return null;
      const tile = 0.9 + 0.1 * Math.sin(xl * 4.2) + 0.08 * (noise2(xl / 3, bb * 3, b.seed & 255) - 0.5);
      return mul3(rc, tile * (bb > 0.95 ? 0.86 : 1));
    }, K, rng, 0.14);
  }
  if (b.hip) {
    for (const sg of [1, -1]) {
      const e0 = P(sg * (w / 2 + ov), h - ov * Math.tan(pitch), dep / 2 + ov);
      const v0 = V(-sg * Math.cos(pitch), Math.sin(pitch), 0), vl = Math.hypot(...v0);
      const nrm = V(sg * Math.sin(pitch), Math.cos(pitch), 0);
      const lt = Math.max(0, nrm[0] * SX + nrm[1] * SY + nrm[2] * SZ);
      const rc = mul3(roof, 0.62 + 0.5 * lt);
      const L = dep + 2 * ov;
      yield* panel(out, e0, V(0, 0, -1), [v0[0] / vl, v0[1] / vl, v0[2] / vl], L, sl, s, (a, bb) => {
        const zl = a * L;
        if (zl < bb * L / 2 || zl > L - bb * L / 2) return null;
        return mul3(rc, 0.92 + 0.1 * Math.sin(zl * 4.2));
      }, K, rng, 0.14);
    }
  }
  if (b.chimney && s < 1.2) {
    const p = P(w * 0.25, h + rise * 0.7, 0), cc = faceTone(wall, 0, 1);
    out(p[0], p[1] + 0.5, p[2], 0.35, 0.8, 0.35, cc[0], cc[1], cc[2], 1, 0, 0, 0, 1, K);
    out(p[0], p[1] + 1.35, p[2], 0.45, 0.12, 0.45, roof[0] * 0.8, roof[1] * 0.8, roof[2] * 0.8, 1, 0, 0, 0, 1, K);
  }
}
const LIT_MARK = [0.1, 0.08, 0.07];
// The lit windows of a face at dusk: small lights where wallPaint left a window lit.
function* windowLights(out, o0, u, len, h, b, front, s) {
  const fl = b.fl || 3.6, cols = Math.max(1, Math.round(len / (b.bay || 3.8))), colW = len / cols;
  const nrm = [-u[2], 0, u[0]];                        // outward (the faces turn anticlockwise seen from above)
  for (let f = 0; f < b.floors; f++) {
    for (let ci = 0; ci < cols; ci++) {
      if (((ci * 7 + f * 3 + (b.seed & 15)) % 5) >= 2) continue;
      if (front && b.loggia && f === 0 && ci >= b.loggia[0] && ci < b.loggia[1]) continue;
      const a = (ci + 0.5) * colW, yy = f * fl + fl * 0.54;
      if (yy > h - 0.5) continue;
      const px = o0[0] + u[0] * a + nrm[0] * 0.06, py = o0[1] + yy, pz = o0[2] + u[2] * a + nrm[2] * 0.06;
      const r = Math.max(0.32, s * 0.4);
      out(px, py, pz, r, r * 1.3, 0.05, LIT[0], LIT[1], LIT[2], 0.9, 0, 0, 0, 1, KIND.LIGHT);
    }
  }
  if (out.due()) yield;
}
// A square tower: a dovecote on a farm, a villa's belvedere, a town's tower, a campanile. A pyramid
// roof of tiles (or a flat top with battlements), openings near the top (belfry arches on a
// campanile, the pigeon holes of a dovecote).
//   t: { wx, d, w, h, yaw, wall, roof (null: battlements), bell, holes, seed, base }
function* towerT(ctx, out, W, t, o = {}) {
  const rng = makeRng(t.seed);
  const base = (t.base != null ? t.base : footing(W, t.wx, t.d, t.w, t.w, t.yaw)) + (o.lift || 0);
  const { P, V } = frame(ctx, t.wx, base, t.d, t.yaw);
  const s = o.s || Math.max(0.14, detail(out, t.d, 1.0));
  const w = t.w, h = t.h + 0.3, K = o.kind != null ? o.kind : KIND.BUILDING;
  const up = [0, 1, 0];
  const faces = [[P(-w / 2, 0, w / 2), V(1, 0, 0), V(0, 0, 1)], [P(w / 2, 0, w / 2), V(0, 0, -1), V(1, 0, 0)], [P(w / 2, 0, -w / 2), V(-1, 0, 0), V(0, 0, -1)], [P(-w / 2, 0, -w / 2), V(0, 0, 1), V(-1, 0, 0)]];
  for (const [o0, u, n] of faces) {
    const tone = faceTone(t.wall, n[0], n[2]);
    yield* panel(out, o0, u, up, w, h, s, (a, bb) => {
      const yy = bb * h;
      if (t.bell && yy > h - w * 1.3 && yy < h - w * 0.25 && Math.abs(a - 0.5) < 0.3) {
        const ar = Math.abs(a - 0.5) / 0.3, top = h - w * 0.25 - (1 - Math.sqrt(Math.max(0, 1 - ar * ar))) * w * 0.3;
        return yy < top ? [0.08, 0.07, 0.07] : tone;
      }
      if (t.holes && yy > h - 2.6 && yy < h - 0.8 && Math.sin(a * w * 5) > 0.55) return [0.12, 0.1, 0.09];
      if (t.slits && Math.abs(a - 0.5) < 0.07 && Math.sin(yy * 0.9) > 0.7 && yy > 4) return [0.1, 0.09, 0.08];
      if (yy > h - 0.4) return mul3(tone, 0.75);
      return mul3(tone, 0.94 + 0.08 * bb);
    }, K, rng, 0.12);
  }
  if (t.roof) {
    // a low pyramid of tiles
    const rh = t.roofH || w * 0.45, ov = 0.3;
    for (const [sx_, sz_] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const n = Math.max(3, Math.round((w + 2 * ov) / (s * 1.3)));
      const nrm = V(sx_ * 0.6, 0.8, sz_ * 0.6), lt = Math.max(0, nrm[0] * SX + nrm[1] * SY + nrm[2] * SZ);
      const rc = mul3(t.roof, 0.62 + 0.5 * lt);
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const bb = (j + 0.5) / n, a = (i + 0.5) / n - 0.5;
          if (Math.abs(a) > (1 - bb) * 0.5) continue;
          const hw = w / 2 + ov;
          const lx = sx_ ? sx_ * hw * (1 - bb) : a * 2 * hw, lz = sz_ ? sz_ * hw * (1 - bb) : a * 2 * hw;
          const p = P(lx, h + rh * bb, lz);
          out(p[0], p[1], p[2], s * 0.8, s * 0.5, s * 0.8, rc[0], rc[1], rc[2], 1, 0, 0, 0, 1, K);
        }
        if (out.due()) yield;
      }
    }
  } else {
    // battlements: merlons round the top
    const m = Math.max(2, Math.round(w / 1.4)), tone = faceTone(t.wall, 0, 1);
    for (let i = 0; i < m; i++) {
      for (const [sx_, sz_] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const a = ((i + 0.5) / m - 0.5) * w;
        const p = P(sx_ ? sx_ * w / 2 : a, h + 0.55, sz_ ? sz_ * w / 2 : a);
        out(p[0], p[1], p[2], Math.max(0.3, w / m * 0.32), 0.5, Math.max(0.3, w / m * 0.32), tone[0], tone[1], tone[2], 1, 0, 0, 0, 1, K);
      }
    }
  }
  if (out.due()) yield;
}
// A dome on a drum (a town's duomo): rings of splats round the drum and the dome, the dome in
// terracotta with pale ribs, a lantern on top.
function* domeT(ctx, out, W, dm, o = {}) {
  const base = (dm.base != null ? dm.base : W.H(dm.wx, dm.d) - 0.3) + (o.lift || 0);
  const x0 = dm.wx - ctx.x0, s = o.s || Math.max(0.14, detail(out, dm.d, 1.0)), K = KIND.BUILDING;
  const R = dm.R, hd = dm.drum;
  const ringN = (r) => Math.max(6, Math.round((Math.PI * 1.6 * r) / (s * 1.2)));
  for (let y = 0; y < hd; y += s * 1.3) {
    const n = ringN(R);
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n - 0.5) * Math.PI * 1.6 + Math.PI / 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const c = faceTone(Math.sin(a * 8) > 0.6 && y > hd * 0.3 && y < hd * 0.75 ? [0.2, 0.17, 0.15] : C.marble, ca, sa);
      out(x0 + ca * R, base + y, -(dm.d - sa * R), s * 0.9, s * 0.85, s * 0.3, c[0], c[1], c[2], 1, ...quatYaw(-a + Math.PI / 2), K);
    }
    if (out.due()) yield;
  }
  for (let t = 0; t < 1; t += s * 1.2 / (R * 1.6)) {
    const ph = t * Math.PI / 2, rr = R * Math.cos(ph), yy = base + hd + R * 1.15 * Math.sin(ph);
    const n = ringN(Math.max(rr, s));
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n - 0.5) * Math.PI * 1.6 + Math.PI / 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rib = Math.abs(Math.sin(a * 4)) < 0.12;
      const lt = Math.max(0, ca * Math.cos(ph) * SX + Math.sin(ph) * SY + sa * Math.cos(ph) * SZ);
      const c = mul3(rib ? C.marble : C.roof, 0.6 + 0.5 * lt);
      out(x0 + ca * rr, yy, -(dm.d - sa * rr), s * 0.9, s * 0.8, s * 0.4, c[0], c[1], c[2], 1, 0, 0, 0, 1, K);
    }
    if (out.due()) yield;
  }
  out(x0, base + hd + R * 1.15 + R * 0.25, -dm.d, R * 0.14, R * 0.28, R * 0.14, C.marble[0], C.marble[1], C.marble[2], 1, 0, 0, 0, 1, K);
  if (out.due()) yield;
}
// A low stone wall from a to b (world x, distance): a garden wall, a town's walls.
function* stoneWall(ctx, out, W, ax, ad, bx, bd, h, col, s, kind = KIND.BUILDING, lift = 0) {
  const len = Math.hypot(bx - ax, bd - ad), n = Math.max(1, Math.round(len / (s * 1.4)));
  const ux = (bx - ax) / len, ud = (bd - ad) / len, q = quatXTo(ux, 0, -ud);
  const tone = faceTone(col, ud, ux);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, wx = ax + (bx - ax) * t, d = ad + (bd - ad) * t, y = W.H(wx, d) + lift;
    const c = mul3(tone, 0.9 + 0.15 * ((i * 7) % 5) / 5);
    out(wx - ctx.x0, y + h * 0.45, -d, len / n * 0.62, h * 0.55, Math.max(0.25, s * 0.25), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Sites: villas and farms on the knolls, casali, wineries, chapels, a stream under a stone bridge, a
// village, and on the far side scattered farmhouses with their cypresses and villas at the head of
// long avenues. Each is a pure function of its world cell, cached per world; a site keeps the crops
// off its ground (siteAt) and paints its yard, garden and avenue (siteHit).
// ---------------------------------------------------------------------------------------------
const STUCCOS = [C.stucco, C.stuccoPale, C.stuccoRose, C.stone];
// A winding white road from (x0, d0) up to (x1, d1), lined with cypresses on both sides every
// `gap` metres: the path, and the trees' places along it (laid out once).
function makeAvenue(r, x0, d0, x1, d1, gap, wig) {
  const av = { x0, d0, x1, d1, amp: wig * (r() < 0.5 ? -1 : 1), bends: 1 + Math.floor(r() * 2), trees: [], gap };
  let px = avX(av, 0), pd = d0, acc = gap * 0.5;
  for (let t = 0.004; t <= 1; t += 0.004) {
    const qx = avX(av, t), qd = lerp(d0, d1, t), seg = Math.hypot(qx - px, qd - pd);
    acc += seg;
    if (acc >= gap && t < 0.97) {
      acc -= gap;
      const nx = -(qd - pd) / seg, nd = (qx - px) / seg;
      for (const sg of [-1, 1]) av.trees.push({ wx: qx + nx * 3.6 * sg, d: qd + nd * 3.6 * sg, h: 13 + 5 * r() });
    }
    px = qx; pd = qd;
  }
  return av;
}
function avX(av, t) { return lerp(av.x0, av.x1, t) + av.amp * Math.sin(Math.PI * t * av.bends) * Math.sin(Math.PI * t); }
// How far (wx, d) lies from the middle of avenue av, across it (large if not beside it).
function avOff(av, wx, d) {
  const lo = Math.min(av.d0, av.d1), hi = Math.max(av.d0, av.d1);
  if (d < lo - 2 || d > hi + 2) return 1e9;
  const t = clamp((d - av.d0) / (av.d1 - av.d0), 0, 1), x = avX(av, t);
  const sl = (avX(av, Math.min(1, t + 0.01)) - avX(av, Math.max(0, t - 0.01))) / (0.02 * (av.d1 - av.d0));
  return Math.abs(wx - x) / Math.sqrt(1 + sl * sl);
}
// site: { type, wx, d, rx, rz (half extents of its ground), yaw, seed, ... }
function knollSite(W, i) {
  return cache(W, ST.VILLA, i, () => {
    const k = knoll(W, i);
    if (!k) return null;
    const r = makeRng(k.seed), x = xCopy(W, k.wx);
    const villa = k.villa;
    const s = { type: villa ? 'villa' : 'casale', wx: k.wx + (r() - 0.5) * 8, d: k.d + (r() - 0.5) * 6, yaw: (r() - 0.5) * 0.5, seed: k.seed, knoll: true };
    s.rx = villa ? 34 : 24; s.rz = villa ? 30 : 20;
    // (the avenue leaves the road well to one side, so that it crosses the view aslant)
    const ax = s.wx + (r() < 0.5 ? -1 : 1) * (35 + 35 * r());
    s.av = makeAvenue(r, ax, x.rd + 2.5, s.wx + (r() - 0.5) * 6, s.d - (villa ? 22 : 14), 9 + 2 * r(), 4 + 8 * r());
    fillSite(s, r);
    return s;
  });
}
// A casale on the floor: between the bank and the road if there is room (close to the line), else
// beyond the road.
const FCELL = 560;
function casaleSite(W, i) {
  return cache(W, ST.CASALE, i, () => {
    const r = makeRng(hashInts(W.ws, 741, i));
    if (r() > 0.55) return null;
    const wx = (i + 0.2 + 0.6 * r()) * FCELL, x = xCopy(W, wx);
    const gapA = x.rd - 12 - (x.bk + 10), gapB = x.rc - x.rw * 0.5 - 28 - (x.rd + 22);
    let d;
    if (gapA > 26 && r() < 0.6) d = x.bk + 10 + gapA * (0.35 + 0.3 * r());
    else if (gapB > 30) d = x.rd + 22 + gapB * (0.15 + 0.5 * r());
    else return null;
    if (knollNear(W, wx, d, 60) || borgoNear(W, wx, d, 50) || streamNear(W, wx, 40)) return null;
    const s = { type: 'casale', wx, d, yaw: (r() - 0.5) * 0.6 + (r() < 0.2 ? Math.PI / 2 : 0), seed: hashInts(W.ws, 742, i), rx: 24, rz: 18 };
    if (d > x.rd && r() < 0.5) s.av = makeAvenue(r, wx + (r() - 0.5) * 30, x.rd + 2.5, wx, d - 10, 9.5, 3 + 4 * r());
    fillSite(s, r);
    return s;
  });
}
// A winery by the road: a long low cellar building, a yard with barrels, a press, crates.
const WCELL = 2300;
function winerySite(W, i) {
  return cache(W, ST.WINERY, i, () => {
    const r = makeRng(hashInts(W.ws, 751, i));
    if (r() > 0.62) return null;
    const wx = (i + 0.2 + 0.6 * r()) * WCELL, x = xCopy(W, wx);
    const d = x.rd + 26 + 10 * r();
    if (d > x.rc - x.rw * 0.5 - 30 || knollNear(W, wx, d, 70) || borgoNear(W, wx, d, 60) || streamNear(W, wx, 50)) return null;
    const s = { type: 'winery', wx, d, yaw: (r() - 0.5) * 0.2, seed: hashInts(W.ws, 752, i), rx: 34, rz: 20 };
    fillSite(s, r);
    return s;
  });
}
// A roadside chapel with its two cypresses.
const CHCELL = 1700;
function chapelSite(W, i) {
  return cache(W, ST.CHAPEL, i, () => {
    const r = makeRng(hashInts(W.ws, 761, i));
    if (r() > 0.5) return null;
    const wx = (i + 0.2 + 0.6 * r()) * CHCELL, x = xCopy(W, wx);
    const d = x.rd + (r() < 0.85 ? 9 : -9);
    if (d < x.bk + 6 || knollNear(W, wx, d, 50) || borgoNear(W, wx, d, 40) || streamNear(W, wx, 25)) return null;
    for (let k = -1; k <= 1; k++) { const c = casaleSite(W, Math.floor(wx / FCELL) + k); if (c && Math.abs(c.wx - wx) < 45 && Math.abs(c.d - d) < 30) return null; }
    const s = { type: 'chapel', wx, d, yaw: (d > x.rd ? 0 : Math.PI) + (r() - 0.5) * 0.2, seed: hashInts(W.ws, 762, i), rx: 9, rz: 8 };
    fillSite(s, r);
    return s;
  });
}
// A village: houses round a piazza with a fountain, a church with its campanile.
const VCELL = 5200;
function borgo(W, i) {
  return cache(W, ST.BORGO, i, () => {
    const r = makeRng(hashInts(W.ws, 771, i));
    if (r() > 0.55) return null;
    const wx = (i + 0.25 + 0.5 * r()) * VCELL, x = xCopy(W, wx);
    const R = 75 + 30 * r(), Rd = 38 + 10 * r();
    const d = x.rd + 18 + Rd;
    if (d + Rd > x.rc - x.rw * 0.5 - 15 || knollNear(W, wx, d, R) || streamNear(W, wx, R)) return null;
    const v = { type: 'borgo', wx, d, R, Rd, rx: R, rz: Rd, yaw: 0, seed: hashInts(W.ws, 772, i), houses: [] };
    v.sq = { wx: wx + (r() - 0.5) * 20, d: d - Rd * 0.25, r: 13 + 3 * r() };
    v.church = { wx: v.sq.wx + (r() < 0.5 ? -1 : 1) * (20 + 6 * r()), d: v.sq.d + 16 + 4 * r() };
    for (let a = -R; a <= R; a += 14) {
      for (let b = -Rd; b <= Rd; b += 13) {
        const pr = makeRng(hashInts(v.seed, Math.round(a), Math.round(b)));
        if ((a / R) ** 2 + (b / Rd) ** 2 > 1) continue;
        const hx = wx + a + (pr() - 0.5) * 4, hd = d + b + (pr() - 0.5) * 3;
        if (Math.hypot(hx - v.sq.wx, hd - v.sq.d) < v.sq.r + 6) continue;
        if (Math.abs(hx - v.church.wx) < 16 && Math.abs(hd - v.church.d) < 13) continue;
        if (pr() < 0.78) v.houses.push(houseSpec(pr, hx, hd, hashInts(v.seed, 7, Math.round(a), Math.round(b)), 'village'));
      }
    }
    return v;
  });
}
function borgoNear(W, wx, d, m) {
  const i = Math.floor(wx / VCELL);
  for (let k = i - 1; k <= i + 1; k++) { const v = borgo(W, k); if (v && Math.abs(wx - v.wx) < v.R + m && Math.abs(d - v.d) < v.Rd + m) return v; }
  return null;
}
function knollNear(W, wx, d, m) {
  const i = Math.floor(wx / KNCELL);
  for (let k = i - 1; k <= i + 1; k++) { const n = knoll(W, k); if (n && Math.abs(wx - n.wx) < n.R + m && Math.abs(d - n.d) < n.R + m) return n; }
  return null;
}
// A stream from the bank to the river, crossing the road under a stone bridge. (Its place is a pure
// hash of its cell, so the x table and the height function can ask for it without a loop.)
const STCELL = 2600;
function stream(W, i) {
  return cache(W, ST.STREAM, i, () => {
    const r = makeRng(hashInts(W.ws, 781, i));
    if (r() > 0.5) return null;
    return { i, wx: (i + 0.25 + 0.5 * r()) * STCELL, slope: (r() - 0.5) * 0.4, ph: r() * 6, seed: hashInts(W.ws, 782, i) };
  });
}
function streamX(st, d) { return st.wx + st.slope * (d - 60) + 4 * (Math.sin(d / 21 + st.ph) - Math.sin(60 / 21 + st.ph)); }
function streamNear(W, wx, m) {
  const i = Math.floor(wx / STCELL);
  for (let k = i - 1; k <= i + 1; k++) { const s = stream(W, k); if (s && Math.abs(wx - s.wx) < m + 40) return s; }
  return null;
}
// On the far side: farmhouses scattered over the hills, each with its cypresses, now and then a short
// avenue; and villas at the head of long ones.
const HMCELL = 380, FVCELL = 1500;
function farHouse(W, i) {
  return cache(W, ST.HAMLET, i, () => {
    const r = makeRng(hashInts(W.ws, 791, i));
    if (r() > 0.75) return null;
    const wx = (i + 0.1 + 0.8 * r()) * HMCELL, x = xCopy(W, wx);
    const d0 = x.rc + x.rw * 0.5 + 70;
    const d = d0 * Math.pow(2700 / d0, r());
    for (const t of townsNear(W, wx)) if (((wx - t.wx) / (t.R + 120)) ** 2 + ((d - t.d) / (t.R * 0.75 + 120)) ** 2 < 1) return null;
    const s = { type: 'farhouse', wx, d, yaw: (r() - 0.5) * 1.2, seed: hashInts(W.ws, 792, i), rx: 22, rz: 18 };
    s.b = houseSpec(r, wx, d, s.seed, 'farm');
    s.b.yaw = s.yaw;
    s.cyp = [];
    const nc = 1 + Math.floor(r() * 5);
    for (let k = 0; k < nc; k++) s.cyp.push({ wx: wx + (r() - 0.5) * 40, d: d + (r() - 0.3) * 26, h: 12 + 6 * r() });
    if (r() < 0.35 && d > d0 + 160) s.av = makeAvenue(r, wx + (r() - 0.5) * 60, d - 90 - 90 * r(), wx, d - 10, 10 + 2 * r(), 4 + 10 * r());
    s.barn = r() < 0.5 ? houseSpec(r, wx + (r() < 0.5 ? -1 : 1) * 16, d + 3, hashInts(s.seed, 5), 'barn') : null;
    return s;
  });
}
function farVilla(W, i) {
  return cache(W, ST.FARVILLA, i, () => {
    const r = makeRng(hashInts(W.ws, 795, i));
    if (r() > 0.6) return null;
    const wx = (i + 0.2 + 0.6 * r()) * FVCELL, x = xCopy(W, wx);
    const d = Math.max(x.rc + x.rw * 0.5 + 300, 480 + 1000 * r());
    for (const t of townsNear(W, wx)) if (((wx - t.wx) / (t.R + 200)) ** 2 + ((d - t.d) / (t.R * 0.75 + 200)) ** 2 < 1) return null;
    const s = { type: 'villa', wx, d, yaw: (r() - 0.5) * 0.4, seed: hashInts(W.ws, 796, i), rx: 40, rz: 34, far: true };
    const L = 140 + 160 * r();
    s.av = makeAvenue(r, wx + (r() - 0.5) * 120, Math.max(x.rc + x.rw * 0.5 + 25, d - L), wx, d - 24, 11, 6 + 16 * r());
    fillSite(s, r);
    return s;
  });
}
// A house's form. kind: 'village' (a town house of two or three storeys, stucco or stone), 'farm'
// (a casale), 'barn' (a fienile: brick, open gable), 'villa'.
function houseSpec(r, wx, d, seed, kind) {
  const villa = kind === 'villa', barn = kind === 'barn', vill = kind === 'village';
  const floors = villa ? 3 : barn ? 1 : vill ? 2 + (r() < 0.5 ? 1 : 0) : 2;
  const wall = barn ? (r() < 0.5 ? C.brick : C.stoneWarm) : vill ? STUCCOS[Math.floor(r() * 4)] : villa ? STUCCOS[Math.floor(r() * 3)] : (r() < 0.7 ? C.stone : C.stoneWarm);
  return {
    wx, d, seed, yaw: (r() - 0.5) * 0.3,
    w: villa ? 22 + 6 * r() : barn ? 9 + 3 * r() : vill ? 8 + 5 * r() : 12 + 4 * r(),
    dep: villa ? 13 + 3 * r() : barn ? 7 + 2 * r() : vill ? 8 + 3 * r() : 8 + 2 * r(),
    h: floors * (villa ? 3.9 : 3.3) + 0.6 + (barn ? 2.4 : 0), floors, fl: villa ? 3.9 : 3.3,
    wall: jitter(wall, r, 0.05), roof: jitter(r() < 0.3 ? C.roofOld : C.roof, r, 0.06), hip: villa || (!barn && r() < 0.4), pitch: 0.36 + 0.08 * r(),
    shut: barn ? null : Math.floor(r() * SHUTS.length), door: barn ? [0.12, 0.1, 0.08] : [0.3, 0.2, 0.12], chimney: !barn && r() < 0.7,
    loggia: villa ? [2, 5] : null, bay: villa ? 3.4 : 3.6, blind: barn, kind,
  };
}
// The parts of a villa or a casale, laid out once: the house, a tower or dovecote, a barn, a well,
// a pergola, a walled garden and the cypresses round it.
function fillSite(s, r) {
  const ca = Math.cos(s.yaw), sa = Math.sin(s.yaw);
  const at = (lx, lz) => [s.wx + lx * ca + lz * sa, s.d - (-lx * sa + lz * ca)];
  s.parts = []; s.cyp = s.cyp || []; s.trees = [];
  if (s.type === 'villa') {
    const h = houseSpec(r, s.wx, s.d, hashInts(s.seed, 1), 'villa');
    h.yaw = s.yaw;
    s.parts.push({ k: 'house', b: h });
    const side = r() < 0.5 ? -1 : 1, [tx, td] = at(side * (h.w / 2 - 2.5), -h.dep * 0.1);
    s.parts.push({ k: 'tower', t: { wx: tx, d: td, w: 5.2, h: h.h + 6 + 3 * r(), yaw: s.yaw, wall: h.wall, roof: h.roof, holes: true, seed: hashInts(s.seed, 2) } });
    // the walled garden before it
    const gw = h.w * 0.62 + 4, gd = 13 + 5 * r();
    s.garden = { lx0: -gw, lx1: gw, lz0: h.dep / 2 + 2, lz1: h.dep / 2 + 2 + gd };
    for (let k = 0; k < 4; k++) { const [px, pd] = at((k - 1.5) * gw * 0.5, h.dep / 2 + 2 + gd * 0.5); s.parts.push({ k: 'pot', wx: px, d: pd }); }
    for (const sg of [-1, 1]) for (let k = 0; k < 2; k++) { const [cx, cd] = at(sg * (h.w / 2 + 6 + 7 * k), -2 + 6 * r()); s.cyp.push({ wx: cx, d: cd, h: 15 + 6 * r() }); }
    if (r() < 0.6) { const [px, pd] = at(-side * (h.w / 2 + 10), 4); s.trees.push({ type: 'pine', wx: px, d: pd, h: 15 + 3 * r() }); }
    if (r() < 0.5) { const [hx, hd] = at(side * (gw + 22), h.dep / 2 + 10); s.parts.push({ k: 'horses', wx: hx, d: hd }); s.rx = Math.max(s.rx, gw + 44); }
    s.table = r() < 0.4 ? at(-side * gw * 0.45, h.dep / 2 + 2 + gd + 7) : null;
  } else if (s.type === 'casale') {
    const h = houseSpec(r, s.wx, s.d, hashInts(s.seed, 1), 'farm');
    h.yaw = s.yaw;
    s.parts.push({ k: 'house', b: h });
    const side = r() < 0.5 ? -1 : 1;
    if (r() < 0.7) { const [bx, bd] = at(side * (h.w / 2 + 6.5), 1.5); const bs = houseSpec(r, bx, bd, hashInts(s.seed, 3), 'barn'); bs.yaw = s.yaw + (r() < 0.3 ? Math.PI / 2 : 0); s.parts.push({ k: 'house', b: bs }); }
    if (r() < 0.45) { const [tx, td] = at(-side * (h.w / 2 - 1.8), -1); s.parts.push({ k: 'tower', t: { wx: tx, d: td, w: 3.8, h: h.h + 4, yaw: s.yaw, wall: h.wall, roof: h.roof, holes: true, seed: hashInts(s.seed, 2) } }); }
    { const [wx2, wd] = at(-side * 6, h.dep / 2 + 5); s.parts.push({ k: 'well', wx: wx2, d: wd }); }
    const nc = 2 + Math.floor(r() * 4);
    for (let k = 0; k < nc; k++) { const [cx, cd] = at((r() - 0.5) * 44, -h.dep / 2 - 3 - 8 * r()); s.cyp.push({ wx: cx, d: cd, h: 13 + 6 * r() }); }
    if (r() < 0.7) { const [ox, od] = at(-side * (h.w / 2 + 9), 3); s.trees.push({ type: r() < 0.5 ? 'oak' : 'pine', wx: ox, d: od, h: 10 + 5 * r() }); }
    s.table = r() < 0.5 ? at(side * 3, h.dep / 2 + 10) : null;
    s.tractor = r() < 0.4 ? at(-side * 12, h.dep / 2 + 7) : null;
  } else if (s.type === 'winery') {
    const b1 = houseSpec(r, s.wx, s.d, hashInts(s.seed, 1), 'farm');
    b1.w = 34 + 8 * r(); b1.dep = 13; b1.floors = 1; b1.h = 6.2; b1.fl = 6; b1.hip = false; b1.wall = jitter(r() < 0.5 ? C.stone : C.stucco, r, 0.04); b1.yaw = s.yaw; b1.bay = 5;
    s.parts.push({ k: 'house', b: b1 });
    const [ox, od] = at(-b1.w / 2 - 5, -4), b2 = houseSpec(r, ox, od, hashInts(s.seed, 2), 'farm'); b2.yaw = s.yaw + Math.PI / 2; s.parts.push({ k: 'house', b: b2 });
    s.yard = at(0, b1.dep / 2 + 6);
    for (let k = 0; k < 4; k++) { const [cx, cd] = at(-b1.w / 2 + k * b1.w / 3, -b1.dep / 2 - 4); s.cyp.push({ wx: cx, d: cd, h: 13 + 5 * r() }); }
    s.tractor = at(b1.w / 2 + 3, b1.dep / 2 + 6);
  } else if (s.type === 'chapel') {
    s.parts.push({ k: 'chapel' });
    for (const sg of [-1, 1]) { const [cx, cd] = at(sg * 5.2, -1); s.cyp.push({ wx: cx, d: cd, h: 12 + 4 * r() }); }
  }
}
// Every site whose ground reaches into a stretch of 250 m of world x (cached per world).
const SBUCK = 250;
function sitesIn(W, b) {
  return cache(W, ST.MISC, b, () => {
    const lo = b * SBUCK, hi = lo + SBUCK, res = [];
    const add = (s, ext) => { if (s && s.wx + ext > lo && s.wx - ext < hi) res.push(s); };
    const avExt = (s) => (s.av ? Math.max(Math.abs(s.av.x0 - s.wx), Math.abs(s.av.x1 - s.wx)) + Math.abs(s.av.amp) + 8 : 0);
    const span = (cell, fn, m) => { for (let i = Math.floor((lo - m) / cell); i <= Math.floor((hi + m) / cell); i++) { const s = fn(W, i); if (s) add(s, Math.max(s.rx || 0, avExt(s)) + 10); } };
    span(KNCELL, knollSite, 120); span(FCELL, casaleSite, 80); span(WCELL, winerySite, 60); span(CHCELL, chapelSite, 30);
    span(VCELL, borgo, 140); span(HMCELL, farHouse, 120); span(FVCELL, farVilla, 220);
    for (let i = Math.floor((lo - 120) / STCELL); i <= Math.floor((hi + 120) / STCELL); i++) {
      const s = stream(W, i);
      if (s) res.push(cache(W, ST.STREAM + 40, i, () => { const x = xCopy(W, s.wx); return { type: 'stream', st: s, wx: s.wx, d: x.rd, bk: x.bk, rc: x.rc - x.rw * 0.5, rx: 100, rz: 1e9 }; }));
    }
    return res;
  });
}
// What a site makes of the ground at (wx, d): SH.k = 0 none, 1 yard, 2 garden, 3 avenue, 4 stream,
// 5 piazza, 6 stream bank; SH.s the site.
const SH = { k: 0, s: null };
function siteHit(W, wx, d) {
  SH.k = 0; SH.s = null;
  const list = sitesIn(W, Math.floor(wx / SBUCK));
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.type === 'stream') {
      const st = s.st;
      if (d < s.bk || d > s.rc) continue;
      const off = Math.abs(wx - streamX(st, d));
      if (off < 1.6) { SH.k = 4; SH.s = s; return SH; }
      if (off < 5) { SH.k = 6; SH.s = s; return SH; }
      continue;
    }
    // (the avenue's white road, and a strip of dry grass either side of it kept clear of crops so
    // that the road and its cypresses can be seen)
    if (s.av) { const o = avOff(s.av, wx, d); if (o < 2.2 + 0.001 * d) { SH.k = 3; SH.s = s; return SH; } if (o < 9 && !s.far) { SH.k = 8; SH.s = s; return SH; } }
    const dx = wx - s.wx, dd = d - s.d, front = s.far ? 0 : 22;
    if (Math.abs(dx) > s.rx || dd > s.rz || -dd > s.rz + front) continue;
    if (s.type === 'borgo') {
      if ((dx / s.R) ** 2 + (dd / s.Rd) ** 2 > 1) continue;
      SH.s = s; SH.k = Math.hypot(wx - s.sq.wx, d - s.sq.d) < s.sq.r ? 5 : 1;
      return SH;
    }
    const ca = Math.cos(s.yaw), sa = Math.sin(s.yaw);
    const lx = dx * ca + dd * sa, lz = dx * sa - dd * ca;
    // (and before the house, toward the line, a meadow kept clear so that it is seen from the train)
    if ((lx / s.rx) ** 2 + (lz / s.rz) ** 2 > 1) {
      if (lz > 0 && (lx / s.rx) ** 2 + (lz / (s.rz + front)) ** 2 < 1) { SH.s = s; SH.k = 8; return SH; }
      continue;
    }
    SH.s = s;
    SH.k = s.garden && lx > s.garden.lx0 && lx < s.garden.lx1 && lz > s.garden.lz0 && lz < s.garden.lz1 ? 2 : 1;
    return SH;
  }
  return SH;
}

// ---------------------------------------------------------------------------------------------
// Drawing the sites
// ---------------------------------------------------------------------------------------------
// The sites whose ground reaches into this chunk (each once).
function sitesNear(ctx, W, m = 150) {
  const seen = new Set(), res = [];
  for (let b = Math.floor((ctx.x0 - m) / SBUCK); b <= Math.floor((ctx.x0 + ctx.length + m) / SBUCK); b++) {
    for (const s of sitesIn(W, b)) if (!seen.has(s)) { seen.add(s); res.push(s); }
  }
  return res;
}
// A well: a round stone curb, two posts and a cross-bar with its pulley.
function well(ctx, out, W, wx, d) {
  const y = W.H(wx, d), x = wx - ctx.x0, K = KIND.BUILDING;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, c = faceTone(C.stone, Math.cos(a), Math.sin(a));
    out(x + Math.cos(a) * 0.75, y + 0.45, -(d - Math.sin(a) * 0.75), 0.36, 0.48, 0.2, c[0], c[1], c[2], 1, ...quatYaw(-a + Math.PI / 2), K);
  }
  const t = Math.max(0.05, thin(d));
  bar(out, x - 0.8, y + 0.5, -d, x - 0.8, y + 2.3, -d, t, [0.22, 0.2, 0.18], 2, KIND.FENCE);
  bar(out, x + 0.8, y + 0.5, -d, x + 0.8, y + 2.3, -d, t, [0.22, 0.2, 0.18], 2, KIND.FENCE);
  bar(out, x - 0.9, y + 2.3, -d, x + 0.9, y + 2.3, -d, t, [0.22, 0.2, 0.18], 1, KIND.FENCE);
  out(x, y + 2.15, -d, 0.16, 0.16, 0.06, 0.3, 0.26, 0.2, 1, 0, 0, 0, 1, K);
}
// A lemon tree in a terracotta pot, along a villa's garden.
function lemonPot(ctx, out, W, wx, d) {
  const y = W.H(wx, d), x = wx - ctx.x0;
  out(x, y + 0.4, -d, 0.45, 0.42, 0.42, C.roof[0] * 0.9, C.roof[1] * 0.9, C.roof[2] * 0.9, 1, 0, 0, 0, 1, KIND.OTHER);
  out(x, y + 1.6, -d, 0.75, 0.7, 0.7, 0.16, 0.28, 0.1, 1, 0, 0, 0, 1, KIND.TREE);
  for (let j = 0; j < 4; j++) out(x + (j - 1.5) * 0.3, y + 1.4 + (j % 2) * 0.4, -(d - 0.62), 0.09, 0.09, 0.09, 0.8, 0.7, 0.1, 1, 0, 0, 0, 1, KIND.TREE);
}
// Barrels in a winery's yard: rows of oak casks on their sides, iron hoops; a basket press.
function* barrels(ctx, out0, W, wx, d, yaw, r) {
  const out = withMove(out0, STL), y0 = W.H(wx, d), K = KIND.OTHER;
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const q = quatXTo(-sa, 0, -ca);
  for (let row = 0; row < 2; row++) {
    for (let j = 0; j < 6 - row; j++) {
      const lx = (j - 2.5 + row * 0.5) * 1.15, px = wx + lx * ca - ctx.x0, pd = d - lx * sa;
      const c = jitter([0.46, 0.28, 0.16], r, 0.08);
      const yy = y0 + 0.55 + row * 0.95;
      out(px, yy, -pd, 0.62, 0.5, 0.5, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], K);
      out(px, yy, -(pd - 0.02), 0.08, 0.52, 0.52, 0.16, 0.15, 0.14, 1, q[0], q[1], q[2], q[3], K);
      out(px + 0.01, yy + 0.05, -(pd - 0.55), 0.06, 0.38, 0.36, c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, 1, q[0], q[1], q[2], q[3], K);
    }
  }
  // the press: a slatted basket under a screw and a beam
  const px = wx + 6 * ca - ctx.x0, pd = d - 6 * sa;
  for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; out(px + Math.cos(a) * 0.55, y0 + 0.55, -(pd - Math.sin(a) * 0.55), 0.12, 0.5, 0.12, 0.5, 0.36, 0.22, 1, 0, 0, 0, 1, K); }
  out(px, y0 + 0.1, -pd, 0.9, 0.12, 0.9, 0.3, 0.12, 0.14, 1, 0, 0, 0, 1, K);
  bar(out, px, y0 + 1.1, -pd, px, y0 + 2.0, -pd, 0.07, [0.2, 0.2, 0.2], 1, K);
  bar(out, px - 0.9, y0 + 1.75, -pd, px + 0.9, y0 + 1.75, -pd, 0.07, [0.4, 0.3, 0.2], 1, K);
  if (out0.due()) yield;
}
// Grape crates stacked in a pile: red, green, or the old wooden ones.
function* crates(ctx, out0, W, wx, d, n, r, full = true) {
  const out = withMove(out0, STL), y0 = W.H(wx, d), x0 = wx - ctx.x0, K = KIND.OTHER;
  const col = r() < 0.45 ? C.crateRed : r() < 0.6 ? C.crateGreen : C.crateWood;
  for (let j = 0; j < n; j++) {
    const col_ = j % 3, lay = Math.floor(j / 3);
    const px = x0 + (col_ - 1) * 0.72 + (r() - 0.5) * 0.1, py = y0 + 0.2 + lay * 0.38, pz = -(d + (r() - 0.5) * 0.2);
    const c = jitter(col, r, 0.08);
    out(px, py, pz, 0.34, 0.17, 0.26, c[0], c[1], c[2], 1, 0, 0, 0, 1, K);
    if (full && lay === Math.floor((n - 1) / 3)) out(px, py + 0.15, pz, 0.28, 0.08, 0.2, C.grapeBlack[0], C.grapeBlack[1], C.grapeBlack[2], 1, 0, 0, 0, 1, K);
  }
  if (out0.due()) yield;
}
// A fountain on a piazza: a round stone basin, a column with a small bowl, the water's sheen.
function fountain(ctx, out, W, wx, d) {
  const y = W.H(wx, d), x = wx - ctx.x0, K = KIND.BUILDING;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, c = faceTone(C.marble, Math.cos(a), Math.sin(a));
    out(x + Math.cos(a) * 2.4, y + 0.45, -(d - Math.sin(a) * 2.4), 0.72, 0.42, 0.22, c[0], c[1], c[2], 1, ...quatYaw(-a + Math.PI / 2), K);
  }
  out(x, y + 0.72, -d, 2.2, 0.05, 2.2, 0.42, 0.52, 0.5, 1, 0, 0, 0, 1, KIND.GROUND);
  bar(out, x, y, -d, x, y + 2.6, -d, 0.28, C.marble, 2, K);
  out(x, y + 2.5, -d, 0.8, 0.18, 0.8, C.marble[0] * 0.9, C.marble[1] * 0.9, C.marble[2] * 0.9, 1, 0, 0, 0, 1, K);
  out(x, y + 3.0, -d, 0.16, 0.4, 0.16, 0.7, 0.76, 0.78, 0.7, 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
}
// The stone bridge that carries the white road over the stream: a single arch with its parapets.
function* stoneBridge(ctx, out, W, s) {
  const st = s.st, d0 = s.d, wx = streamX(st, d0), K = KIND.BUILDING;
  const y = floorY(xAt(W, wx), d0), x = wx - ctx.x0, sp = 4.2, rise = 2.1;
  const sz = Math.max(0.16, detail(out, d0, 0.9));
  for (const side of [-1, 1]) {
    const dd = d0 + side * 2.8;
    const tone = side < 0 ? faceTone(C.stoneWarm, 0, 1) : faceTone(C.stoneWarm, 0, -1);
    // the arch face: stone, with the dark of the arch over the water
    for (let u = -sp - 2.5; u <= sp + 2.5; u += sz * 1.2) {
      for (let v = -2.4; v <= 0.9; v += sz * 1.2) {
        const ar = Math.abs(u) / sp, top = -2.4 + rise * Math.sqrt(Math.max(0, 1 - ar * ar)) + 0.3;
        if (ar < 1 && v < top - 0.3) continue;
        const c = ar < 1.12 && v < top + 0.1 ? mul3(tone, 0.8) : tone;
        out(x + u, y + v, -dd, sz * 0.8, sz * 0.8, 0.25, c[0], c[1], c[2], 1, 0, 0, 0, 1, K);
      }
      if (out.due()) yield;
    }
    if (out.due()) yield;
  }
  // under the arch: shadow
  out(x, y - 1.6, -d0, sp * 0.8, 0.9, 2.6, 0.1, 0.1, 0.08, 1, 0, 0, 0, 1, K);
  // the deck: the white road carried over the stream
  for (let u = -sp - 2; u <= sp + 2; u += sz * 1.4) {
    for (let v = -2.4; v <= 2.4; v += sz * 1.4) out(x + u, y + 0.06, -(d0 + v), sz * 0.8, 0.06, sz * 0.8, C.road[0] * 0.92, C.road[1] * 0.92, C.road[2] * 0.92, 1, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
}
// A roadside chapel: a small nave, the front a gable with a round window and a door, a bell gable
// standing over it with its bell in an arch.
function* chapel(ctx, out, W, s, lights) {
  const b = { wx: s.wx, d: s.d, w: 9, dep: 6, h: 5.2, yaw: s.yaw + Math.PI / 2, wall: C.stuccoPale, roof: C.roof, hip: false, floors: 0, fl: 5, shut: null, blind: true, door: null, seed: s.seed, pitch: 0.5 };
  // (turned so its gable faces the road; drawn as a nave)
  yield* building(ctx, out, W, b, { lights: false });
  const base = footing(W, s.wx, s.d, 9, 6, b.yaw);
  const f = frame(ctx, s.wx, base, s.d, s.yaw);
  const sz = Math.max(0.12, detail(out, s.d, 0.8));
  // the front gable (toward the road): a door, an oculus, the bell gable above
  const gd = 4.5 + 0.05;
  for (let u = -2.9; u <= 2.9; u += sz * 1.2) {
    for (let v = 0.1; v < 5.5 + 1.6 * (1 - Math.abs(u) / 3); v += sz * 1.2) {
      let c = faceTone(C.stuccoPale, 0, 1);
      if (Math.abs(u) < 0.75 && v < 2.6) c = [0.24, 0.14, 0.08];
      else if (Math.hypot(u, v - 4.6) < 0.5) c = [0.12, 0.1, 0.09];
      const p = f.P(u, v, gd);
      out(p[0], p[1], p[2], sz * 0.75, sz * 0.75, 0.12, c[0], c[1], c[2], 1, ...quatYaw(s.yaw), KIND.BUILDING);
    }
    if (out.due()) yield;
  }
  for (let u = -1; u <= 1; u += sz * 1.2) {
    for (let v = 6.9; v < 9.0; v += sz * 1.2) {
      const inArch = Math.abs(u) < 0.5 && v > 7.2 && v < 8.2 + 0.3 * Math.sqrt(Math.max(0, 1 - (u / 0.5) ** 2));
      const c = inArch ? null : faceTone(C.stuccoPale, 0, 1);
      if (!c) continue;
      const p = f.P(u, v, gd - 0.1);
      out(p[0], p[1], p[2], sz * 0.75, sz * 0.75, 0.15, c[0], c[1], c[2], 1, ...quatYaw(s.yaw), KIND.BUILDING);
    }
    if (out.due()) yield;
  }
  const pb = f.P(0, 7.7, gd - 0.1);
  out(pb[0], pb[1], pb[2], 0.28, 0.32, 0.25, 0.46, 0.36, 0.16, 1, 0, 0, 0, 1, KIND.BUILDING);
  if (lights) out(pb[0], f.P(0, 2.9, gd + 0.3)[1], f.P(0, 2.9, gd + 0.3)[2], 0.14, 0.14, 0.14, LAMP[0], LAMP[1], LAMP[2], 1, 0, 0, 0, 1, KIND.LIGHT);
}
// A villa's walled garden: a low wall round it, gravel walks, clipped box in beds.
function* garden(ctx, out, W, s) {
  const g = s.garden, ca = Math.cos(s.yaw), sa = Math.sin(s.yaw);
  const at = (lx, lz) => [s.wx + lx * ca + lz * sa, s.d - (-lx * sa + lz * ca)];
  const sz = Math.max(0.16, detail(out, s.d, 1.0));
  const cs = [at(g.lx0, g.lz0), at(g.lx0, g.lz1), at(g.lx1, g.lz1), at(g.lx1, g.lz0)];
  for (let k = 0; k < 3; k++) yield* stoneWall(ctx, out, W, cs[k][0], cs[k][1], cs[k + 1][0], cs[k + 1][1], 1.4, C.stucco, sz);
  // box hedges in four beds
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      const [bx, bd] = at(lerp(g.lx0, g.lx1, (i + 0.5) / 4), lerp(g.lz0, g.lz1, (j + 0.5) / 2));
      const y = W.H(bx, bd), w = (g.lx1 - g.lx0) / 4 * 0.36;
      out(bx - ctx.x0, y + 0.4, -bd, w, 0.45, w * 0.7, 0.12, 0.22, 0.08, 1, ...quatYaw(s.yaw), KIND.HEDGE);
    }
  }
}
// Draw the sites in this band: buildings and their furniture now, their trees into the plan.
//   o: { plan, lights, s (splat size factor), far (cheap) }
function* sites(ctx, out, W, list, dLo, dHi, o = {}) {
  const plan = o.plan, lights = !!o.lights;
  for (const s of list) {
    if (s.type === 'stream') {
      if (inD(s.d, dLo, dHi) && inX(ctx, s.wx, 15)) { note('bridge', s.wx, s.d); yield* stoneBridge(ctx, out, W, s); }
      if (plan) {
        // willows and poplars along it
        for (let d = s.bk + 6; d < s.rc; d += 11) {
          if (!inD(d, dLo, dHi) || Math.abs(d - s.d) < 8) continue;
          const h = hashInts(s.st.seed, Math.round(d)) >>> 0;
          if ((h & 3) === 0) continue;
          const wx = streamX(s.st, d) + ((h & 4) ? 3.5 : -3.5);
          if (inX(ctx, wx, 6)) plan.push(planTree(ctx, out, W, (h & 8) ? 'poplar' : 'oak', wx, d, (h & 8) ? 17 + (h >>> 8) % 6 : 8 + (h >>> 8) % 4, { color: [0.3, 0.4, 0.2] }));
        }
      }
      continue;
    }
    // (at the dreamlike level the cypresses of some avenues grow to an impossible height)
    const tall = o.tall && (s.seed & 3) !== 0 ? 1 + 2.6 * o.tall : 1;
    if (plan && s.av) for (const t of s.av.trees) if (inD(t.d, dLo, dHi) && inX(ctx, t.wx, 4)) plan.push(planTree(ctx, out, W, 'cypress', t.wx, t.d, t.h * tall, { detail: 1.3 }));
    if (plan) {
      for (const t of s.cyp || []) if (inD(t.d, dLo, dHi) && inX(ctx, t.wx, 4)) plan.push(planTree(ctx, out, W, 'cypress', t.wx, t.d, t.h, { detail: 1.2 }));
      for (const t of s.trees || []) if (inD(t.d, dLo, dHi) && inX(ctx, t.wx, 10)) plan.push(planTree(ctx, out, W, t.type, t.wx, t.d, t.h));
    }
    if (!inD(s.d, dLo, dHi) || !inX(ctx, s.wx, (s.rx || 20) + 10)) continue;
    note(s.type, s.wx, s.d);
    const sz = o.s ? { s: Math.max(0.14, detail(out, s.d, o.s)) } : {};
    if (s.type === 'borgo') { yield* borgoDraw(ctx, out, W, s, lights, sz); continue; }
    if (s.type === 'farhouse') {
      yield* building(ctx, out, W, s.b, { lights, ...sz });
      if (s.barn) yield* building(ctx, out, W, s.barn, sz);
      continue;
    }
    if (s.type === 'chapel') { yield* chapel(ctx, out, W, s, lights); continue; }
    for (const p of s.parts) {
      if (p.k === 'house') yield* building(ctx, out, W, p.b, { lights, ...sz });
      else if (p.k === 'tower') yield* towerT(ctx, out, W, p.t, sz);
      else if (o.far) continue;
      else if (p.k === 'well') well(ctx, out, W, p.wx, p.d);
      else if (p.k === 'pot') lemonPot(ctx, out, W, p.wx, p.d);
    }
    if (!o.far && s.garden) yield* garden(ctx, out, W, s);
    if (!o.far && s.type === 'winery') {
      const r = makeRng(hashInts(s.seed, 9));
      yield* barrels(ctx, out, W, s.yard[0], s.yard[1], s.yaw, r);
      for (let k = 0; k < 3; k++) yield* crates(ctx, out, W, s.yard[0] - 8 + k * 2.6, s.yard[1] + 2, 6 + Math.floor(r() * 6), r);
    }
    if (out.due()) yield;
  }
}
// A village: its houses, the church with a campanile, the fountain on the piazza.
function* borgoDraw(ctx, out, W, v, lights, sz) {
  // (the landmarks first: the church and its campanile, the fountain; then the houses, whose backs
  // are hidden by the next ones)
  const r = makeRng(hashInts(v.seed, 3));
  const ch = { wx: v.church.wx, d: v.church.d, w: 11, dep: 22, h: 10, yaw: Math.PI / 2 + (r() - 0.5) * 0.2, wall: C.stone, roof: C.roof, hip: false, floors: 0, fl: 5, shut: null, blind: true, seed: hashInts(v.seed, 4), pitch: 0.42 };
  yield* towerT(ctx, out, W, { wx: ch.wx + 8, d: ch.d + 6, w: 4.8, h: 26 + 6 * r(), yaw: 0, wall: C.stoneWarm, roof: C.roof, roofH: 3.2, bell: true, seed: hashInts(v.seed, 5) }, sz);
  yield* building(ctx, out, W, ch, { ...sz });
  fountain(ctx, out, W, v.sq.wx, v.sq.d);
  if (lights) for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; yield* lampPost(ctx, out, W, v.sq.wx + Math.cos(a) * v.sq.r, v.sq.d + Math.sin(a) * v.sq.r * 0.8); }
  const hs = { s: Math.max(0.2, detail(out, v.d, 1.5)) };
  for (const h of v.houses) if (inX(ctx, h.wx, 12)) yield* building(ctx, out, W, h, { lights, noBack: h.d > v.d - v.Rd * 0.4, ...hs });
}
function* lampPost(ctx, out, W, wx, d) {
  const y = W.H(wx, d), x = wx - ctx.x0;
  bar(out, x, y, -d, x, y + 3.6, -d, Math.max(0.05, thin(d)), [0.12, 0.12, 0.12], 2, KIND.FENCE);
  out(x, y + 3.7, -d, 0.16, 0.2, 0.16, LAMP[0], LAMP[1], LAMP[2], 1, 0, 0, 0, 1, KIND.LIGHT, MOVE.CHASE);
  out(x, y + 3.7, -(d - 0.1), 0.9, 0.9, 0.3, LAMP[0], LAMP[1], LAMP[2], 0.15, 0, 0, 0, 1, KIND.LIGHT, MOVE.CHASE);
  if (out.due()) yield;
}

// ---------------------------------------------------------------------------------------------
// Hill towns: on a raised crest of the far side, houses packed inside walls, a few tall towers
// (San Gimignano), a campanile, a duomo with its dome, cypresses round the walls. Laid out once per
// town; drawn by the mid band at a finer splat than its ground, so that the houses read as houses.
// ---------------------------------------------------------------------------------------------
function townPlan(W, t) {
  if (t.plan) return t.plan;
  const r = makeRng(hashInts(t.seed, 1));
  const P = { houses: [], towers: [], walls: [], cyp: [] };
  const top = W.H(t.wx, t.d);
  const A = t.wide, Bd = t.deep;
  for (let a = -A; a <= A; a += 17.5) {
    for (let b = -Bd; b <= Bd; b += 15.5) {
      const e = (a / A) ** 2 + (b / Bd) ** 2;
      if (e > 1) continue;
      const pr = makeRng(hashInts(t.seed, 11, Math.round(a), Math.round(b)));
      if (pr() < 0.12) continue;
      const hs = houseSpec(pr, t.wx + a + (pr() - 0.5) * 3, t.d + b + (pr() - 0.5) * 3, hashInts(t.seed, 12, Math.round(a), Math.round(b)), 'village');
      // (houses half as big again as life, so that the town reads from a kilometre or two)
      hs.w = 12 + 5 * pr(); hs.dep = 11 + 4 * pr(); hs.fl = 4.2; hs.bay = 4.6;
      hs.floors = 4 + (pr() < 0.4 ? 1 : 0) - (e > 0.6 ? 1 : 0); hs.h = hs.floors * 4.2 + 0.8;
      hs.yaw = (pr() - 0.5) * 0.25; hs.shut = pr() < 0.5 ? 0 : 2;
      P.houses.push(hs);
    }
  }
  // towers: stone, plain, battlemented, standing high out of the roofs
  for (let k = 0; k < t.towers; k++) {
    const a = (r() - 0.5) * A * 1.2, b = (r() - 0.5) * Bd * 1.1;
    P.towers.push({ wx: t.wx + a, d: t.d + b, w: 8 + 2 * r(), h: 46 + 26 * r(), yaw: (r() - 0.5) * 0.2, wall: jitter(C.stoneWarm, r, 0.06), roof: null, slits: true, seed: hashInts(t.seed, 20, k) });
  }
  P.camp = { wx: t.wx + (r() - 0.5) * A * 0.5, d: t.d - Bd * 0.15 + (r() - 0.5) * 10, w: 10, h: 68 + 12 * r(), yaw: 0, wall: C.stone, roof: C.roof, roofH: 8, bell: true, seed: hashInts(t.seed, 21) };
  P.nave = { wx: P.camp.wx + 22, d: P.camp.d + 10, w: 48, dep: 21, h: 26, yaw: (r() - 0.5) * 0.2, wall: C.marble, roof: C.roof, hip: false, floors: 0, fl: 6, blind: true, seed: hashInts(t.seed, 22), pitch: 0.4 };
  if (t.dome) P.dome = { wx: P.nave.wx + 16, d: P.nave.d + 2, R: 14 + 3 * r(), drum: 38 + 8 * r() };
  // the walls round it, with towers at the corners
  if (t.walls) {
    const n = 18;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      P.walls.push([t.wx + Math.cos(a0) * (A + 14), t.d - Math.sin(a0) * (Bd + 12), t.wx + Math.cos(a1) * (A + 14), t.d - Math.sin(a1) * (Bd + 12), k % 3 === 0]);
    }
  }
  for (let k = 0; k < 26; k++) {
    const a = r() * Math.PI * 2, rr = 1.12 + 0.35 * r();
    P.cyp.push({ wx: t.wx + Math.cos(a) * (A + 10) * rr, d: t.d - Math.sin(a) * (Bd + 10) * rr, h: 14 + 6 * r() });
  }
  P.top = top;
  t.plan = P;
  return P;
}
function* towns(ctx, out, W, dLo, dHi, plan, lights, sk, dz = {}) {
  for (let i = Math.floor((ctx.x0 - 800) / TCELL); i <= Math.floor((ctx.x0 + ctx.length + 800) / TCELL); i++) {
    const t = town(W, i);
    if (!t || !inD(t.d, dLo, dHi) || t.wx + t.wide + 80 < ctx.x0 || t.wx - t.wide - 80 > ctx.x0 + ctx.length) continue;
    note('town', t.wx, t.d, W.H(t.wx, t.d));
    const P = townPlan(W, t), s = Math.max(0.5, detail(out, t.d, sk)), lift = townLift(t, dz);
    const o = { s: s * 1.6, lights, noBack: true, lift };
    if (lift) { note('floating town', t.wx, t.d); yield* townUnderside(ctx, out, W, t, lift, s); }
    for (const tw of P.towers) if (inX(ctx, tw.wx, 8)) yield* towerT(ctx, out, W, tw, { s, lift });
    if (inX(ctx, P.camp.wx, 8)) yield* towerT(ctx, out, W, P.camp, { s, lift });
    if (P.dome && inX(ctx, P.dome.wx, 18)) yield* domeT(ctx, out, W, P.dome, { s, lift });
    if (inX(ctx, P.nave.wx, 26)) yield* building(ctx, out, W, P.nave, { s, lift });
    // (at a low budget only every other house shows lit windows: they cost a splat each)
    const oDim = { ...o, lights: false };
    for (const h of P.houses) if (inX(ctx, h.wx, 12)) yield* building(ctx, out, W, h, lights && out.density < 0.8 && (h.seed & 1) ? oDim : o);
    if (P.walls.length) {
      for (const [ax, ad, bx, bd, gate] of P.walls) {
        if (Math.max(ax, bx) < ctx.x0 - 10 || Math.min(ax, bx) > ctx.x0 + ctx.length + 10) continue;
        yield* stoneWall(ctx, out, W, ax, ad, bx, bd, 12, C.stoneWarm, s, KIND.BUILDING, lift);
        if (gate) yield* towerT(ctx, out, W, { wx: ax, d: ad, w: 10, h: 20, yaw: 0, wall: C.stoneWarm, roof: null, seed: hashInts(t.seed, 31, Math.round(ax)) }, { s, lift });
      }
    }
    if (plan) for (const c of P.cyp) if (inX(ctx, c.wx, 4)) { const tr = planTree(ctx, out, W, 'cypress', c.wx, c.d, c.h); tr.nMax = Math.min(tr.nMax, 5); plan.push(tr); }
    if (lights) {
      // street lamps along the walls and in the streets: warm points over the town
      const r = makeRng(hashInts(t.seed, 40));
      for (let k = 0; k < 40; k++) {
        const wx = t.wx + (r() - 0.5) * t.wide * 2, d = t.d + (r() - 0.5) * t.deep * 2;
        if (!inX(ctx, wx, 0)) continue;
        out(wx - ctx.x0, W.H(wx, d) + 5 + lift, -d, 1.4, 1.4, 1.4, LAMP[0], LAMP[1], LAMP[2], 0.8, 0, 0, 0, 1, KIND.LIGHT);
      }
    }
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Figures: animals and people (after alps.js). A handful of shaped, oriented splats each, drawn
// larger than life so they read in one still at 40 to 150 m. Each part is placed in the figure's
// own frame (u forward, h up, v to its left) and turned by its heading. People and animals flash on
// the beat (MOVE.FLASH); the things they ride or work with are rigid (MOVE.STILL); a cyclist rides
// (MOVE.RIDE, the bicycle with it).
// ---------------------------------------------------------------------------------------------
const FIG = 1.6;
function figure(ctx, out0, wx, y, d, yaw, k, kind, move = FL) {
  const ca = Math.cos(yaw), sa = Math.sin(yaw), x0 = wx - ctx.x0, q = quatYaw(yaw);
  const P = (u, h, v) => [x0 + (u * ca - v * sa) * k, y + h * k, -(d + (u * sa + v * ca) * k)];
  const E = (u, h, v, rx, ry, rz, c, qq = q) => { const p = P(u, h, v); out0(p[0], p[1], p[2], rx * k, ry * k, rz * k, c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], kind, move); };
  const seg = (a, b, r, c, n = 1) => { const A = P(a[0], a[1], a[2]), Bp = P(b[0], b[1], b[2]); bar(out0, A[0], A[1], A[2], Bp[0], Bp[1], Bp[2], r, c, n, kind, move); };
  return { P, E, seg, q };
}
const BODY = {
  cow: { bl: 1.15, bh: 1.5, br: 0.5, nl: 0.5, hl: 0.33, leg: 0.095 },     // Chianina: tall, white
  sheep: { bl: 0.5, bh: 0.72, br: 0.34, nl: 0.2, hl: 0.19, leg: 0.045 },
  horse: { bl: 0.95, bh: 1.5, br: 0.36, nl: 0.78, hl: 0.34, leg: 0.065 },
  dog: { bl: 0.42, bh: 0.58, br: 0.2, nl: 0.22, hl: 0.16, leg: 0.05 },
  boar: { bl: 0.58, bh: 0.72, br: 0.32, nl: 0.12, hl: 0.3, leg: 0.05 },
};
// A four-legged animal. o: { type, yaw, k, col, pale, dark, graze, lying, ph, walk, move }
function* beast(ctx, out0, wx, y, d, o) {
  const k = o.k || FIG, kind = KIND.OTHER, t = o.type, S = BODY[t];
  const { E, seg, q } = figure(ctx, out0, wx, y - (o.lying ? (S.bh - S.br * 1.1) * k : 0), d, o.yaw, k, kind, o.move || FL);
  const col = o.col, dark = o.dark || mul3(col, 0.55), pale = o.pale || mix3(col, [0.78, 0.76, 0.7], 0.5);
  const lr = Math.max(S.leg * k, thin(d)) / k;
  const legTop = S.bh - S.br * 0.6;
  const legC = t === 'sheep' ? [0.16, 0.13, 0.12] : t === 'horse' ? mix3(col, [0.1, 0.08, 0.07], 0.45) : t === 'cow' ? mul3(col, 0.9) : mul3(col, 0.8);
  if (o.lying) {
    seg([S.bl * 0.7, legTop, 0.16], [S.bl * 1.0, legTop - 0.12, 0.2], lr * 1.2, legC);
  } else {
    for (const [u, v, f] of [[S.bl * 0.7, 0.16, 0], [S.bl * 0.7, -0.16, 0.5], [-S.bl * 0.75, 0.16, 0.5], [-S.bl * 0.75, -0.16, 0]]) {
      const sw = o.walk ? 0.18 * Math.sin(((o.ph || 0) + f) * Math.PI * 2) : (f - 0.25) * 0.08;
      const kneeU = u + sw * 0.5 + (u > 0 ? 0.02 : -0.06), kneeH = legTop * 0.48;
      const vv = v * S.br / 0.3;
      seg([u, legTop, vv], [kneeU, kneeH, vv], lr * 1.2, v < 0 ? mul3(legC, 0.8) : legC);
      seg([kneeU, kneeH, vv], [u + sw, 0.03, vv], lr, v < 0 ? mul3(legC, 0.7) : legC);
      if (t === 'horse') E(u + sw, 0.05, vv, 0.08, 0.05, 0.07, [0.12, 0.1, 0.08]);
    }
  }
  // body
  const wool = t === 'sheep' ? 1.18 : 1;
  E(0, S.bh - S.br * 0.15, 0, S.bl * 0.64 * wool, S.br * 0.88 * wool, S.br * 0.82 * wool, col);
  E(S.bl * 0.52, S.bh - S.br * 0.05, 0, S.br * 0.95, S.br * 0.95, S.br * 0.84, col);
  E(-S.bl * 0.58, S.bh - S.br * 0.1, 0, S.br * 0.95, S.br * 0.92, S.br * 0.86, col);
  E(0, S.bh + S.br * 0.56 * wool, 0, S.bl * 0.7, S.br * 0.17, S.br * 0.5, mix3(col, [0.8, 0.78, 0.74], 0.3));
  if (t === 'boar') E(S.bl * 0.3, S.bh + S.br * 0.6, 0, S.bl * 0.5, S.br * 0.3, S.br * 0.2, dark);   // the bristled ridge
  // neck and head
  const g = o.graze && !o.lying;
  const nA = g ? -0.85 : t === 'horse' ? 1.0 : t === 'boar' ? -0.35 : t === 'dog' ? 0.75 : t === 'cow' ? 0.3 : 0.6;
  const nx0 = S.bl * 0.7, ny0 = S.bh + S.br * 0.15;
  const nx1 = nx0 + Math.cos(nA) * S.nl, ny1 = ny0 + Math.sin(nA) * S.nl;
  const qn = quatMul(q, quatRoll(nA));
  E((nx0 + nx1) / 2, (ny0 + ny1) / 2, 0, S.nl * 0.62, S.br * (t === 'cow' ? 0.62 : 0.46), S.br * 0.42, col, qn);
  if (t === 'horse') E((nx0 + nx1) / 2 - 0.08, (ny0 + ny1) / 2 + 0.12, 0, S.nl * 0.6, 0.07, 0.06, dark, qn);      // the mane
  const hA = g ? -1.35 : t === 'horse' ? -0.95 : t === 'boar' ? -0.45 : t === 'dog' ? -0.1 : -0.5;
  const qh = quatMul(q, quatRoll(hA));
  const hx = nx1 + Math.cos(hA) * S.hl * 0.6, hy = ny1 + Math.sin(hA) * S.hl * 0.6;
  const headC = t === 'sheep' ? [0.2, 0.17, 0.15] : col;
  E(hx, hy, 0, S.hl, S.hl * 0.46, S.hl * 0.44, headC, qh);
  E(hx + Math.cos(hA) * S.hl * 0.85, hy + Math.sin(hA) * S.hl * 0.85, 0, S.hl * 0.34, S.hl * 0.32, S.hl * 0.36, t === 'cow' || t === 'boar' ? [0.1, 0.08, 0.08] : t === 'sheep' ? headC : dark, qh);
  // ears
  for (const v of [-1, 1]) E(nx1 - 0.02, ny1 + 0.07, v * (t === 'cow' ? 0.2 : 0.1), 0.05, t === 'cow' || t === 'sheep' ? 0.04 : 0.09, t === 'cow' || t === 'sheep' ? 0.11 : 0.04, t === 'sheep' ? headC : col);
  const hr = Math.max(0.03 * k, thin(d, 0.8)) / k;
  if (t === 'cow') for (const v of [-1, 1]) seg([nx1 - 0.02, ny1 + 0.12, v * 0.12], [nx1 + 0.04, ny1 + 0.26, v * 0.26], hr, [0.62, 0.6, 0.5]);
  if (t === 'boar') for (const v of [-1, 1]) E(hx + Math.cos(hA) * S.hl * 0.7, hy + Math.sin(hA) * S.hl * 0.7 + 0.04, v * 0.08, 0.05, 0.02, 0.02, [0.78, 0.76, 0.66], qh);
  // tail
  if (t === 'horse') seg([-S.bl * 0.98, S.bh + 0.04, 0], [-S.bl * 1.15, S.bh - 0.75, 0], lr * 1.6, dark, 2);
  else if (t === 'cow') { seg([-S.bl * 0.98, S.bh + 0.08, 0], [-S.bl * 1.08, S.bh - 0.75, 0], lr * 0.6, col); E(-S.bl * 1.09, S.bh - 0.85, 0, 0.05, 0.1, 0.05, [0.1, 0.08, 0.08]); }
  else if (t === 'dog') seg([-S.bl * 0.95, S.bh + 0.05, 0], [-S.bl * 1.25, S.bh - 0.1, 0], lr * 1.6, col);
  else E(-S.bl * 0.95, S.bh + 0.02, 0, 0.06, 0.09, 0.05, t === 'sheep' ? col : dark);
  if (out0.due()) yield;
}
const SHIRT = [[0.78, 0.76, 0.7], [0.2, 0.32, 0.58], [0.7, 0.18, 0.12], [0.3, 0.44, 0.26], [0.76, 0.6, 0.2], [0.5, 0.3, 0.5], [0.72, 0.44, 0.34], [0.16, 0.16, 0.18]];
// A person. o: { yaw, k, coat, legs, pose: 'stand'|'walk'|'pick'|'carry'|'sit'|'ride'|'staff', ph, hat ('sun' = a
// broad straw hat, or a colour, or null), skirt, basket, kid, move }
function* person(ctx, out0, wx, y, d, o) {
  const k = (o.k || FIG) * (o.kid ? 0.72 : 1), kind = KIND.OTHER;
  const { E, seg, q } = figure(ctx, out0, wx, y, d, o.yaw, k, kind, o.move || FL);
  const coat = o.coat, legC = o.legs || [0.22, 0.2, 0.2];
  const lr = Math.max(0.07 * k, thin(d)) / k, ar = Math.max(0.055 * k, thin(d, 0.8)) / k;
  const pose = o.pose || 'stand', sw = Math.sin((o.ph || 0) * Math.PI * 2);
  let lean = 0, hipH = 0.92;
  if (pose === 'pick') lean = 0.75; else if (pose === 'ride') { lean = 0.55; hipH = 1.0; } else if (pose === 'sit') hipH = 0.5; else if (pose === 'walk' || pose === 'carry') lean = 0.08;
  if (pose === 'sit') { seg([0, hipH, 0.1], [0.42, hipH + 0.02, 0.1], lr, legC); seg([0.42, hipH, 0.1], [0.45, 0.05, 0.1], lr, legC); seg([0, hipH, -0.1], [0.42, hipH + 0.02, -0.1], lr, legC); seg([0.42, hipH, -0.1], [0.45, 0.05, -0.1], lr, legC); }
  else if (pose === 'ride') { seg([0, hipH, 0.1], [0.16, 0.62, 0.12], lr, legC); seg([0.16, 0.62, 0.12], [0.08, 0.3, 0.12], lr, legC); seg([0, hipH, -0.1], [0.22, 0.75, -0.12], lr, legC); seg([0.22, 0.75, -0.12], [0.3, 0.45, -0.12], lr, legC); }
  else if (o.skirt) { E(0.02, hipH * 0.55, 0, 0.26, hipH * 0.5, 0.24, o.skirt); seg([0, 0.4, 0.08], [0.02 + 0.1 * sw, 0.04, 0.1], lr * 0.8, C.skin); seg([0, 0.4, -0.08], [0.02 - 0.1 * sw, 0.04, -0.1], lr * 0.8, C.skin); }
  else {
    const st = pose === 'walk' || pose === 'carry' ? 0.26 * sw : pose === 'pick' ? 0.22 : 0.04;
    seg([0, hipH, 0.1], [st, 0.04, 0.12], lr, legC);
    seg([0, hipH, -0.1], [-st, 0.04, -0.12], lr, legC);
    E(st + 0.05, 0.05, 0.12, 0.11, 0.05, 0.06, [0.2, 0.14, 0.1]);
    E(-st + 0.05, 0.05, -0.12, 0.11, 0.05, 0.06, [0.2, 0.14, 0.1]);
  }
  const qb = quatMul(q, quatRoll(-lean));
  const bh = hipH + 0.3 * Math.cos(lean), bu = Math.sin(lean) * 0.3;
  E(bu, bh, 0, 0.19, 0.33, 0.18, coat, qb);
  E(bu * 0.3, hipH + 0.02, 0, 0.2, 0.13, 0.19, o.skirt || legC, qb);
  const nu = Math.sin(lean) * 0.62, nh = hipH + 0.64 * Math.cos(lean);
  if (pose === 'pick') {
    // bent to the vine, both hands in it, the basket at the feet
    seg([nu, nh - 0.05, 0.2], [nu + 0.35, nh - 0.5, 0.22], ar, coat); seg([nu, nh - 0.05, -0.2], [nu + 0.38, nh - 0.45, -0.18], ar, coat);
    if (o.basket) E(0.5, 0.2, 0.35, 0.24, 0.18, 0.2, o.basket);
  } else if (pose === 'carry') {
    // a crate of grapes on the shoulder
    seg([nu, nh - 0.05, 0.21], [nu + 0.1, nh + 0.25, 0.25], ar, coat); seg([nu, nh - 0.05, -0.21], [nu + 0.2, nh - 0.4, -0.27], ar, coat);
    const cc = o.crate || C.crateRed;
    E(nu + 0.05, nh + 0.35, 0.18, 0.32, 0.15, 0.24, cc);
    E(nu + 0.05, nh + 0.5, 0.18, 0.26, 0.07, 0.18, C.grapeBlack);
  } else if (pose === 'ride') {
    seg([nu, nh - 0.05, 0.2], [nu + 0.42, nh - 0.42, 0.2], ar, coat); seg([nu, nh - 0.05, -0.2], [nu + 0.42, nh - 0.42, -0.2], ar, coat);
  } else if (pose === 'sit') {
    seg([nu, nh - 0.05, 0.2], [nu + 0.38, nh - 0.32, 0.22], ar, coat); seg([nu, nh - 0.05, -0.2], [nu + 0.35, nh - 0.28, -0.22], ar, coat);
  } else if (pose === 'staff') {
    // a shepherd's crook
    seg([nu, nh - 0.05, 0.21], [nu + 0.25, nh - 0.3, 0.3], ar, coat); seg([nu, nh - 0.05, -0.21], [nu - 0.1, hipH + 0.05, -0.27], ar, coat);
    seg([nu + 0.3, nh - 0.32, 0.32], [nu + 0.42, 0.02, 0.34], ar * 0.6, [0.4, 0.3, 0.18], 2);
    seg([nu + 0.3, nh - 0.32, 0.32], [nu + 0.22, nh + 0.5, 0.31], ar * 0.6, [0.4, 0.3, 0.18], 2);
    seg([nu + 0.22, nh + 0.5, 0.31], [nu + 0.32, nh + 0.58, 0.31], ar * 0.6, [0.4, 0.3, 0.18], 1);
  } else {
    seg([nu, nh - 0.05, 0.21], [nu + 0.15 * sw, hipH + 0.05, 0.27], ar, coat);
    seg([nu, nh - 0.05, -0.21], [nu - 0.15 * sw, hipH + 0.05, -0.27], ar, coat);
    if (o.basket) E(nu + 0.15 * sw, hipH - 0.05, 0.32, 0.2, 0.15, 0.17, o.basket);
  }
  const hu = nu + 0.04, hhd = nh + 0.2;
  E(hu, hhd, 0, 0.11, 0.12, 0.11, C.skin);
  if (o.hair) E(hu - 0.03, hhd + 0.05, 0, 0.12, 0.09, 0.12, o.hair);
  if (o.hat === 'sun') { E(hu, hhd + 0.11, 0, 0.27, 0.035, 0.27, C.strawHat); E(hu, hhd + 0.15, 0, 0.12, 0.06, 0.12, mul3(C.strawHat, 0.85)); }
  else if (o.hat) E(hu - 0.01, hhd + 0.09, 0, 0.12, 0.07, 0.12, o.hat);
  if (out0.due()) yield;
}
// A bicycle and its rider (a road bike: drop bars, a bright jersey), heading along yaw. move: RIDE
// for one in a riding group, else FLASH.
function* cyclist(ctx, out0, wx, y, d, yaw, r, move = FL) {
  const k = 1.5;
  const { P, seg } = figure(ctx, out0, wx, y, d, yaw, k, KIND.OTHER, move);
  const tr = Math.max(0.03 * k, thin(d, 0.8)) / k, dk = [0.08, 0.08, 0.09];
  for (const u of [-0.5, 0.5]) for (let j = 0; j < 6; j++) {
    const a0 = j / 6 * Math.PI * 2, a1 = (j + 1) / 6 * Math.PI * 2, R = 0.34;
    seg([u + Math.cos(a0) * R, 0.36 + Math.sin(a0) * R, 0], [u + Math.cos(a1) * R, 0.36 + Math.sin(a1) * R, 0], tr, dk);
  }
  const fc = SHIRT[Math.floor(r() * SHIRT.length)];
  seg([-0.5, 0.36, 0], [-0.1, 0.92, 0], tr, fc); seg([-0.1, 0.92, 0], [0.42, 0.88, 0], tr, fc); seg([0.42, 0.88, 0], [0.5, 0.36, 0], tr, fc); seg([-0.1, 0.92, 0], [0.08, 0.36, 0], tr, fc); seg([0.08, 0.36, 0], [0.42, 0.88, 0], tr, fc);
  const jersey = [[0.8, 0.72, 0.08], [0.12, 0.36, 0.7], [0.7, 0.1, 0.1], [0.1, 0.5, 0.3], [0.76, 0.3, 0.5], [0.1, 0.6, 0.66]][Math.floor(r() * 6)];
  const p = P(-0.12, 0, 0);
  yield* person(ctx, out0, p[0] + ctx.x0, y, -p[2], { yaw, k, coat: jersey, legs: [0.08, 0.08, 0.1], pose: 'ride', hat: [0.78, 0.78, 0.76], move });
}
// A box on wheels heading along yaw. type: 'tractor' (a narrow vineyard tractor, a trailer heaped
// with grapes), 'ape' (the three-wheeled Piaggio truck), 'vespa', 'car' (a small old Fiat).
function* vehicle(ctx, out0, W, wx, d, yaw, type, r, k = 1.35, yAt = null) {
  const y = (yAt != null ? yAt : W.H(wx, d)) + 0.05, rng = r, K_ = KIND.OTHER;
  const out = withMove(out0, STL);
  const s = Math.max(0.1, detail(out0, d, 0.9));
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
  const f0 = frame(ctx, wx, y, d, yaw);
  if (type === 'tractor') {
    const c = r() < 0.5 ? [0.7, 0.12, 0.08] : r() < 0.5 ? [0.2, 0.42, 0.2] : [0.2, 0.3, 0.55];
    yield* box(0.9, 1.7, 1.0, 0.8, 0.7, () => c, c);
    wheels([-0.5], 0.62, 1.3); wheels([1.4], 0.38, 1.1);
    const tr = Math.max(0.04 * k, thin(d));
    for (const [u, v] of [[-0.9, 0.5], [-0.9, -0.5], [0.0, 0.5], [0.0, -0.5]]) { const a = f0.P(u * k, 1.1 * k, v * k), b = f0.P(u * k, 2.3 * k, v * k); bar(out, a[0], a[1], a[2], b[0], b[1], b[2], tr, [0.15, 0.15, 0.16], 2, K_); }
    { const p = f0.P(-0.45 * k, 2.35 * k, 0), q = quatYaw(yaw); out(p[0], p[1], p[2], 0.6 * k, 0.05 * k, 0.65 * k, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3]); }
    const pp = f0.P(-0.5 * k, 0.75 * k, 0);
    yield* person(ctx, out0, pp[0] + ctx.x0, pp[1], -pp[2], { yaw, k: k * 0.95, coat: SHIRT[Math.floor(r() * SHIRT.length)], pose: 'sit', hat: 'sun' });
    // the trailer, heaped with grapes
    yield* box(-3.4, 2.8, 1.5, 0.6, 0.55, () => [0.5, 0.5, 0.52], [0.45, 0.45, 0.47]);
    wheels([-3.4], 0.36, 1.5);
    for (let j = 0; j < 5; j++) { const p = f0.P((-4.5 + j * 0.55) * k, (1.25 + 0.1 * r()) * k, (r() - 0.5) * 0.5 * k); const gc = jitter(C.grapeBlack, r, 0.15); out(p[0], p[1], p[2], 0.5 * k, 0.24 * k, 0.6 * k, gc[0], gc[1], gc[2], 1, 0, 0, 0, 1); }
  } else if (type === 'ape') {
    const c = [[0.26, 0.42, 0.56], [0.6, 0.62, 0.6], [0.3, 0.46, 0.3], [0.7, 0.62, 0.36]][Math.floor(r() * 4)], G = [0.12, 0.14, 0.17];
    yield* box(0.85, 1.1, 1.3, 1.2, 0.35, (a, b) => (b > 0.5 && b < 0.9 ? G : c), c);
    yield* box(-0.8, 2.0, 1.4, 0.4, 0.55, () => mul3(c, 0.9), [0.5, 0.42, 0.3]);
    wheels([1.1], 0.27, 0.1); wheels([-1.2], 0.27, 1.2);
    for (let j = 0; j < 3; j++) { const p = f0.P((-1.4 + j * 0.6) * k, 1.15 * k, 0); const cc = j === 1 ? C.crateGreen : C.crateRed; out(p[0], p[1], p[2], 0.3 * k, 0.17 * k, 0.24 * k, cc[0], cc[1], cc[2], 1, 0, 0, 0, 1); }
  } else if (type === 'vespa') {
    const c = [[0.7, 0.76, 0.7], [0.62, 0.12, 0.1], [0.5, 0.66, 0.74], [0.76, 0.68, 0.4]][Math.floor(r() * 4)];
    const q = quatYaw(yaw);
    for (const [u, h, l, hh, w] of [[-0.35, 0.45, 0.42, 0.22, 0.28], [0.35, 0.45, 0.16, 0.4, 0.2], [0.42, 0.85, 0.06, 0.3, 0.06]]) { const p = f0.P(u * k, h * k, 0); out(p[0], p[1], p[2], l * k, hh * k, w * k, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3]); }
    wheels([-0.55, 0.55], 0.2, 0.05);
    const pp = f0.P(-0.25 * k, 0.15 * k, 0);
    yield* person(ctx, out0, pp[0] + ctx.x0, pp[1], -pp[2], { yaw, k: k * 0.95, coat: SHIRT[Math.floor(r() * SHIRT.length)], pose: 'sit', hat: [0.2, 0.2, 0.22] });
  } else {
    const c = [[0.62, 0.12, 0.1], [0.76, 0.74, 0.66], [0.5, 0.66, 0.72], [0.2, 0.3, 0.5], [0.74, 0.6, 0.2]][Math.floor(r() * 5)], G = [0.12, 0.14, 0.17];
    yield* box(0, 3.2, 1.45, 0.6, 0.25, () => c, c);
    yield* box(-0.2, 1.8, 1.3, 0.55, 0.85, (a, b) => (b < 0.85 ? G : c), c);
    wheels([-1.0, 1.0], 0.28, 1.45);
  }
  if (out0.due()) yield;
}
// A bird on the wing: a swallow (dark, forked tail) in a flock, or a kestrel hovering (not carried
// along: it holds its place over the ground, wings spread, tail fanned, so it flashes like an animal).
function swallow(out, x, y, z, dir, S, d) {
  const c = [0.08, 0.09, 0.14];
  flyBody(out, x, y, z, 0.13 * S, 0.045 * S, c, Q_ID, KIND.OTHER);
  flyBody(out, x + dir * 0.12 * S, y - 0.01, z, 0.05 * S, 0.035 * S, [0.6, 0.24, 0.16], Q_ID, KIND.OTHER);
  for (const sg of [-1, 1]) flyWing(out, x, y, z, x - dir * 0.12 * S, y + 0.2 * S, z + sg * 0.42 * S, limb(0.05 * S, d), c, 2, y, KIND.OTHER);
  flyBody(out, x - dir * 0.2 * S, y, z, 0.1 * S, 0.02 * S, c, Q_ID, KIND.OTHER);
}
function kestrel(ctx, out, x, y, z, d) {
  // facing the window, into the wind: wings spread across the view, the tail fanned below
  const S = 2.4, c = [0.56, 0.32, 0.18], dark = [0.22, 0.15, 0.11], f = FL;
  out(x, y, z, 0.11 * S, 0.17 * S, 0.1 * S, 0.66, 0.5, 0.36, 1, 0, 0, 0, 1, KIND.OTHER, f);
  out(x, y + 0.2 * S, z + 0.02, 0.08 * S, 0.08 * S, 0.08 * S, 0.44, 0.42, 0.46, 1, 0, 0, 0, 1, KIND.OTHER, f);
  out(x, y - 0.27 * S, z, 0.09 * S, 0.14 * S, 0.03 * S, 0.48, 0.42, 0.4, 1, 0, 0, 0, 1, KIND.OTHER, f);
  for (const sg of [-1, 1]) {
    bar(out, x, y + 0.04 * S, z, x + sg * 0.34 * S, y + 0.16 * S, z - 0.05 * S, limb(0.07 * S, d), c, 2, KIND.OTHER, f);
    bar(out, x + sg * 0.34 * S, y + 0.16 * S, z - 0.05 * S, x + sg * 0.7 * S, y + 0.08 * S, z - 0.1 * S, limb(0.05 * S, d), dark, 2, KIND.OTHER, f);
  }
}

// ---------------------------------------------------------------------------------------------
// Life
// ---------------------------------------------------------------------------------------------
// The harvest (vendemmia): in a plot at harvest the pickers work along the rows next to those
// already picked, bent to the vines in their sun hats with baskets at their feet; others carry
// crates out to the row ends, where the full ones stand in stacks; the tractor waits on the
// headland with its trailer filling up.
function* harvest(ctx, out, W, plots, dLo, dHi) {
  for (const e of plots) {
    const p = e.p;
    if (p.t !== PK.VINE || !p.harvest || e.da >= dHi || e.db < dLo) continue;
    const ends = [];
    for (const pt of rowPoints(W, e, 1.0, Math.max(28, e.da), Math.min(dHi + 20, e.db), 1.4)) if (pt.near) ends.push({ ti: pt.ti, wx: pt.wx, d: pt.d, end: pt.end });
    if (!ends.length) continue;
    const picked = harvestRow(p);
    const nx = -p.sa, nd = p.ca;
    for (const en of ends) {
      const k = en.ti - picked;
      const inx = en.end < 0 ? 1 : -1, ix = p.ca * inx, id = p.sa * inx;      // into the row
      const h = hashInts(p.seed, en.ti, 5) >>> 0;
      if (k >= -6 && k <= 7 && k % 3 === 0 && inD(en.d - id * 1.6, dLo, dHi)) {
        const n = 4 + (h % 7);
        note('crates', en.wx, en.d);
        yield* crates(ctx, out, W, en.wx - ix * 1.8, en.d - id * 1.8, n, makeRng(h));
      }
      if (k >= 0 && k <= 5) {
        // one or two pickers in the alley beside this row
        const np = 1 + (h & 1);
        for (let j = 0; j < np; j++) {
          const s = 2.5 + 3.5 * j + ((h >>> (4 + j * 3)) & 7) * 0.9;
          const wx = en.wx + ix * s + nx * p.pitch * 0.5, d = en.d + id * s + nd * p.pitch * 0.5;
          if (!inD(d, dLo, dHi) || !inX(ctx, wx, 2)) continue;
          const face = (h >>> (9 + j)) & 1 ? 1 : -1;
          note('picker', wx, d);
          const shirt = SHIRT[(h >>> (12 + j * 3)) % SHIRT.length];
          yield* person(ctx, out, wx, W.H(wx, d), d, { yaw: Math.atan2(nd * face, nx * face), coat: shirt, pose: 'pick', hat: (h >>> 20) & 3 ? 'sun' : SHIRT[(h >>> 22) % 8], basket: [0.56, 0.42, 0.24], ph: ((h >>> 26) & 15) / 16, skirt: ((h >>> 24) & 3) === 0 ? [0.3, 0.3, 0.42] : null });
        }
      }
      if (k === 6) {
        // someone carrying a full crate out along the alley
        const s = 1 + ((h >>> 6) & 7) * 0.6;
        const wx = en.wx + ix * s + nx * p.pitch * 0.5, d = en.d + id * s + nd * p.pitch * 0.5;
        if (inD(d, dLo, dHi) && inX(ctx, wx, 2)) yield* person(ctx, out, wx, W.H(wx, d), d, { yaw: Math.atan2(-id, -ix), coat: SHIRT[h % 8], pose: 'carry', hat: 'sun', ph: ((h >>> 3) & 15) / 16, crate: (h & 64) ? C.crateGreen : C.crateRed });
      }
      // (one tractor to a plot: at a fixed row's first end, so every chunk that sees it agrees)
      if (k === 2 && (Math.abs(p.sa) >= 0.25 || en.end < 0)) {
        const wx = en.wx - ix * 5.5, d = en.d - id * 5.5;
        if (inD(d, dLo, dHi) && inX(ctx, wx, 6) && !siteAt(W, wx, d)) { note('harvest tractor', wx, d); yield* vehicle(ctx, out, W, wx, d, Math.atan2(nd, nx), 'tractor', makeRng(h)); }
      }
    }
  }
}
// A long table under a pergola of vines: posts and beams, the leaves over them, a white cloth,
// benches, the family at lunch; a string of lights over it at dusk.
function* pergolaTable(ctx, out, W, wx, d, yaw, r, lights) {
  const base = W.H(wx, d), f = frame(ctx, wx, base, d, yaw), K = KIND.OTHER, L = 7.5, Wd = 3.6;
  const tr = Math.max(0.06, thin(d, 1.1));
  for (const u of [-L / 2, 0, L / 2]) for (const v of [-Wd / 2, Wd / 2]) { const a = f.P(u, 0, v), b = f.P(u, 2.7, v); bar(out, a[0], a[1], a[2], b[0], b[1], b[2], tr, [0.36, 0.28, 0.2], 2, KIND.FENCE); }
  for (const v of [-Wd / 2, Wd / 2]) { const a = f.P(-L / 2 - 0.3, 2.75, v), b = f.P(L / 2 + 0.3, 2.75, v); bar(out, a[0], a[1], a[2], b[0], b[1], b[2], tr, [0.36, 0.28, 0.2], 3, KIND.FENCE); }
  // the leaves over it, open in places to the sky
  for (let i = 0; i < 16; i++) {
    const u = (r() - 0.5) * L, v = (r() - 0.5) * Wd, p = f.P(u, 2.85 + 0.2 * r(), v);
    const c = jitter(mix3(C.vine, C.vineLit, r()), r, 0.1);
    out(p[0], p[1], p[2], 0.8, 0.22, 0.6, c[0], c[1], c[2], 0.95, 0, 0, 0, 1, KIND.HEDGE);
  }
  // the table, its white cloth, the benches
  const q = quatYaw(yaw);
  { const p = f.P(0, 0.78, 0); out(p[0], p[1], p[2], L * 0.42, 0.06, 0.55, 0.8, 0.78, 0.72, 1, q[0], q[1], q[2], q[3], K); }
  { const p = f.P(0, 0.55, 0); out(p[0], p[1], p[2], L * 0.4, 0.2, 0.45, 0.7, 0.68, 0.62, 1, q[0], q[1], q[2], q[3], K); }
  for (let j = 0; j < 8; j++) { const p = f.P((j - 3.5) * L * 0.1, 0.92, (r() - 0.5) * 0.4); const c = j % 3 === 0 ? [0.12, 0.24, 0.12] : j % 3 === 1 ? [0.44, 0.06, 0.1] : [0.78, 0.7, 0.4]; out(p[0], p[1], p[2], 0.05, j % 3 === 0 ? 0.14 : 0.06, 0.05, c[0], c[1], c[2], 1, 0, 0, 0, 1, K); }
  for (const sg of [-1, 1]) {
    const n = 4 + Math.floor(r() * 3);
    for (let j = 0; j < n; j++) {
      const u = ((j + 0.5) / n - 0.5) * L * 0.85, p = f.P(u, 0, sg * 0.95);
      const kid = r() < 0.18, shirt = SHIRT[Math.floor(r() * SHIRT.length)];
      yield* person(ctx, out, p[0] + ctx.x0, base, -p[2], { yaw: yaw + (sg > 0 ? -Math.PI / 2 : Math.PI / 2), coat: shirt, pose: 'sit', hat: r() < 0.25 ? 'sun' : null, hair: r() < 0.5 ? [0.16, 0.12, 0.08] : [0.6, 0.58, 0.54], kid, k: FIG * 0.95 });
    }
  }
  if (lights) for (let j = 0; j < 9; j++) { const p = f.P((j - 4) * L * 0.12, 2.5 - 0.15 * Math.sin(j * 0.8), 0); out(p[0], p[1], p[2], 0.1, 0.1, 0.1, LAMP[0], LAMP[1], LAMP[2], 1, 0, 0, 0, 1, KIND.LIGHT, MOVE.CHASE); }
}
// A paddock beside a villa: a post-and-rail fence and horses.
function* paddock(ctx, out, W, wx, d, seed) {
  const r = makeRng(seed), L = 34, D = 20, tr = Math.max(0.06, thin(d, 1.2)), pc = [0.6, 0.56, 0.48];
  const cs = [[wx - L / 2, d - D / 2], [wx + L / 2, d - D / 2], [wx + L / 2, d + D / 2], [wx - L / 2, d + D / 2]];
  for (let k = 0; k < 4; k++) {
    const [ax, ad] = cs[k], [bx, bd] = cs[(k + 1) % 4], n = Math.round(Math.hypot(bx - ax, bd - ad) / 3.4);
    for (let j = 0; j < n; j++) {
      const t0 = j / n, t1 = (j + 1) / n, x0 = lerp(ax, bx, t0), d0 = lerp(ad, bd, t0), x1 = lerp(ax, bx, t1), d1 = lerp(ad, bd, t1);
      const y0 = W.H(x0, d0), y1 = W.H(x1, d1);
      bar(out, x0 - ctx.x0, y0, -d0, x0 - ctx.x0, y0 + 1.4, -d0, tr, pc, 1, KIND.FENCE);
      for (const hh of [0.7, 1.25]) bar(out, x0 - ctx.x0, y0 + hh, -d0, x1 - ctx.x0, y1 + hh, -d1, tr * 0.8, pc, 2, KIND.FENCE);
    }
    if (out.due()) yield;
  }
  const n = 2 + Math.floor(r() * 3);
  const coats = [[0.42, 0.24, 0.12], [0.26, 0.16, 0.1], [0.56, 0.36, 0.2], [0.7, 0.66, 0.6], [0.14, 0.11, 0.1]];
  for (let j = 0; j < n; j++) {
    const hx = wx + (r() - 0.5) * (L - 8), hd = d + (r() - 0.5) * (D - 6), c = coats[Math.floor(r() * coats.length)];
    note('horse', hx, hd);
    yield* beast(ctx, out, hx, W.H(hx, hd), hd, { type: 'horse', yaw: (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.8, k: 1.55, col: c, dark: [0.1, 0.08, 0.07], graze: r() < 0.5 });
  }
}
// Is (wx, d) open ground an animal or a person may stand on (not a road, the river, a site, a wood)?
function openAt(W, wx, d) {
  const x = xAt(W, wx);
  if (d < x.bk + 3 || Math.abs(d - x.rd) < 4 || Math.abs(d - x.rc) < x.rw * 0.5 + 3) return false;
  if (siteAt(W, wx, d)) return false;
  const q = plotAt(W, wx, d);
  return q.p.t !== PK.WOOD && q.p.t !== PK.VINE && q.p.t !== PK.OLIVE && q.p.t !== PK.SUN;
}
// Where a flock, a herd, a hare: a spot on open ground in this cell, or null (a pure function of the cell).
function lifeSpot(W, type, salt, cell, p, i, dA, dB) {
  return cache(W, type, i, () => {
    const r = makeRng(hashInts(W.ws, salt, i));
    if (r() > p) return null;
    for (let tr = 0; tr < 5; tr++) {
      const wx = (i + 0.15 + 0.7 * r()) * cell, d = dA + (dB - dA) * r();
      if (openAt(W, wx, d)) return { i, wx, d, seed: hashInts(W.ws, salt + 1, i) };
    }
    return null;
  });
}
const FLKCELL = 1100, HRDCELL = 1700, GAMECELL = 330, BOARCELL = 900, BIRDCELL = 640, KESCELL = 1300, ROADCELL = 300;
// A shepherd with his flock of white sheep and a white Maremma dog; white Chianina cattle; a hare
// sitting up, a pair of pheasants; wild boar at the edge of a wood at dusk.
function* animals(ctx, out, W, dLo, dHi, dusk) {
  for (const { i } of cellsAround(ctx, FLKCELL, 60)) {
    const g = lifeSpot(W, ST.FLOCK, 801, FLKCELL, 0.62, i, 40, 170);
    if (!g) continue;
    const r = makeRng(g.seed), n = 14 + Math.floor(r() * 18), dir = r() < 0.5 ? 1 : -1;
    for (let j = 0; j < n; j++) {
      const wx = g.wx + (r() - 0.5) * 34, d = g.d + (r() - 0.5) * 16, yaw = (dir > 0 ? 0 : Math.PI) + (r() - 0.5) * 1.6, gz = r() < 0.7;
      if (!inD(d, dLo, dHi) || !inX(ctx, wx, 2) || !openAt(W, wx, d)) continue;
      const wool = jitter([0.76, 0.73, 0.64], r, 0.05);
      yield* beast(ctx, out, wx, W.H(wx, d) - 0.04, d, { type: 'sheep', yaw, k: 1.8, col: wool, graze: gz });
    }
    const sx = g.wx - dir * 20, sd = g.d - 4;
    if (inD(sd, dLo, dHi) && inX(ctx, sx, 2)) {
      note('shepherd', sx, sd);
      yield* person(ctx, out, sx, W.H(sx, sd), sd, { yaw: dir > 0 ? 0 : Math.PI, coat: [0.34, 0.3, 0.22], legs: [0.24, 0.22, 0.2], pose: 'staff', hat: [0.24, 0.2, 0.16] });
      const dx = sx + dir * 4, dd = sd + 3;
      yield* beast(ctx, out, dx, W.H(dx, dd), dd, { type: 'dog', yaw: dir > 0 ? 0.3 : Math.PI - 0.3, k: 2.1, col: [0.78, 0.76, 0.68] });
    }
  }
  for (const { i } of cellsAround(ctx, HRDCELL, 40)) {
    const g = lifeSpot(W, ST.HERD, 811, HRDCELL, 0.5, i, 50, 200);
    if (!g) continue;
    const r = makeRng(g.seed), n = 4 + Math.floor(r() * 5);
    for (let j = 0; j < n; j++) {
      const wx = g.wx + (r() - 0.5) * 30, d = g.d + (r() - 0.5) * 14, yaw = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 1.2;
      if (!inD(d, dLo, dHi) || !inX(ctx, wx, 3) || !openAt(W, wx, d)) continue;
      note('chianina', wx, d);
      yield* beast(ctx, out, wx, W.H(wx, d) - 0.04, d, { type: 'cow', yaw, k: 1.5, col: jitter([0.78, 0.76, 0.7], r, 0.03), dark: [0.5, 0.48, 0.44], graze: r() < 0.6, lying: r() < 0.15 });
    }
  }
  for (const { i } of cellsAround(ctx, GAMECELL, 10)) {
    const g = lifeSpot(W, ST.MISC + 100, 821, GAMECELL, 0.45, i, 34, 95);
    if (!g || !inD(g.d, dLo, dHi) || !inX(ctx, g.wx, 3)) continue;
    const r = makeRng(g.seed);
    if (r() < 0.45) { note('hare', g.wx, g.d); hare(ctx, out, W, g.wx, g.d, r); }
    else { note('pheasants', g.wx, g.d); pheasant(ctx, out, W, g.wx, g.d, r, true); if (r() < 0.7) pheasant(ctx, out, W, g.wx + 2.5, g.d + 1.2, r, false); }
  }
  if (dusk) {
    for (const { i, wx0 } of cellsAround(ctx, BOARCELL, 20)) {
      const r = worldRng(ctx, 831, i);
      if (r() > 0.85) continue;
      const wx = wx0 + r() * BOARCELL;
      // the first wood (or olive grove, or the trees along the river) out from the line, and open
      // ground just before it
      let de = 0;
      const xr = xAt(W, wx), riv = xr.rc - xr.rw * 0.5 - 6;
      for (let d = 60; d < 290; d += 5) { const t = d > riv ? PK.WOOD : plotAt(W, wx, d).p.t; if (t === PK.WOOD || t === PK.OLIVE) { de = d; break; } }
      if (!de) continue;
      let d0 = 0;
      for (let d = de - 5; d > de - 40 && d > 45; d -= 3) if (openAt(W, wx, d)) { d0 = d - 2; break; }
      if (!d0) continue;
      const n = 2 + Math.floor(r() * 5);
      for (let j = 0; j < n; j++) {
        const ax = wx + (r() - 0.5) * 12, ad = d0 + (r() - 0.5) * 4, young = j > 1 && r() < 0.6;
        if (!inD(ad, dLo, dHi) || !inX(ctx, ax, 2) || !openAt(W, ax, ad)) continue;
        note('boar', ax, ad);
        yield* beast(ctx, out, ax, W.H(ax, ad), ad, { type: 'boar', yaw: (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.8, k: young ? 1.3 : 2.0, col: young ? [0.42, 0.32, 0.22] : [0.22, 0.18, 0.15], graze: r() < 0.6 });
      }
    }
  }
}
function hare(ctx, out, W, wx, d, r) {
  const y = W.H(wx, d), x = wx - ctx.x0, k = 3.2, dir = r() < 0.5 ? 1 : -1, c = [0.5, 0.38, 0.24], dk = [0.2, 0.15, 0.1];
  out(x, y + 0.16 * k, -d, 0.22 * k, 0.15 * k, 0.12 * k, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER, FL);
  out(x + dir * 0.18 * k, y + 0.3 * k, -d, 0.08 * k, 0.08 * k, 0.07 * k, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER, FL);
  for (const v of [-0.03, 0.03]) bar(out, x + dir * 0.16 * k, y + 0.36 * k, -(d + v * k), x + dir * 0.1 * k, y + 0.58 * k, -(d + v * 1.6 * k), Math.max(0.025 * k, thin(d, 0.7)), dk, 1, KIND.OTHER, FL);
  out(x - dir * 0.22 * k, y + 0.18 * k, -d, 0.05 * k, 0.05 * k, 0.05 * k, 0.78, 0.76, 0.72, 1, 0, 0, 0, 1, KIND.OTHER, FL);
}
function pheasant(ctx, out, W, wx, d, r, cock) {
  const y = W.H(wx, d), x = wx - ctx.x0, k = 2.5, dir = r() < 0.5 ? 1 : -1;
  const c = cock ? [0.62, 0.3, 0.12] : [0.5, 0.4, 0.28];
  out(x, y + 0.2 * k, -d, 0.17 * k, 0.1 * k, 0.09 * k, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER, FL);
  out(x + dir * 0.15 * k, y + 0.33 * k, -d, 0.05 * k, 0.07 * k, 0.05 * k, cock ? 0.1 : c[0], cock ? 0.3 : c[1], cock ? 0.2 : c[2], 1, 0, 0, 0, 1, KIND.OTHER, FL);
  if (cock) out(x + dir * 0.17 * k, y + 0.34 * k, -(d - 0.03 * k), 0.025 * k, 0.03 * k, 0.02 * k, 0.72, 0.1, 0.08, 1, 0, 0, 0, 1, KIND.OTHER, FL);
  bar(out, x - dir * 0.12 * k, y + 0.22 * k, -d, x - dir * (cock ? 0.55 : 0.35) * k, y + 0.3 * k, -d, Math.max(0.025 * k, thin(d, 0.7)), mul3(c, 0.8), 2, KIND.OTHER, FL);
  for (const v of [-0.03, 0.03]) bar(out, x, y + 0.12 * k, -(d + v * k), x, y, -(d + v * k), Math.max(0.012 * k, thin(d, 0.5)), [0.3, 0.26, 0.2], 1, KIND.OTHER, FL);
}
// Swallows low over the fields, a kestrel hovering.
function* birds(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, BIRDCELL, 30)) {
    const r = worldRng(ctx, 841, i);
    if (r() > 0.6) continue;
    const fc = flightCell(wx0 + r() * BIRDCELL), d = 40 + 70 * r();
    if (!inD(d, dLo, dHi) || !inX(ctx, fc.wx, 12)) continue;
    const y0 = W.H(fc.wx, d) + 5 + 7 * r(), n = 5 + Math.floor(r() * 6);
    note('swallows', fc.wx, d, y0);
    for (let j = 0; j < n; j++) swallow(out, fc.wx - ctx.x0 + (r() - 0.5) * 16, y0 + (r() - 0.5) * 4, -(d + (r() - 0.5) * 8), fc.dir, 2.2, d);
    if (out.due()) yield;
  }
  for (const { i, wx0 } of cellsAround(ctx, KESCELL, 10)) {
    const r = worldRng(ctx, 851, i);
    if (r() > 0.55) continue;
    const wx = wx0 + r() * KESCELL, d = 45 + 60 * r();
    if (!inD(d, dLo, dHi) || !inX(ctx, wx, 2)) continue;
    const y = W.H(wx, d) + 14 + 8 * r();
    note('kestrel', wx, d, y);
    kestrel(ctx, out, wx - ctx.x0, y, -d, d);
  }
}
// On the white road: a three-wheeled Ape with crates, a Vespa, an old Fiat, a tractor with grapes;
// a group of cyclists on road bikes (they ride, where the road runs straight and level enough).
function* roadLife(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, ROADCELL, 24)) {
    const r = worldRng(ctx, 861, i);
    if (r() > 0.7) continue;
    const u = r(), dirn = r() < 0.5 ? 1 : -1;
    if (u < 0.3) {
      // the cyclists
      const fc = rideCell(wx0 + r() * ROADCELL), x = xAt(W, fc.wx), d = x.rd - fc.dir * 1.0;
      if (!inD(d, dLo, dHi) || !inX(ctx, fc.wx, 12)) continue;
      // (they ride only where the road runs straight and level for sixty metres either way)
      const rd0 = x.rd, fy0_ = x.fy, ra = xAt(W, fc.wx + 60), dA = Math.abs(ra.rd - rd0), yA = Math.abs(ra.fy - fy0_), rb = xAt(W, fc.wx - 60);
      const straight = dA < 1.4 && yA < 0.5 && Math.abs(rb.rd - rd0) < 1.4 && Math.abs(rb.fy - fy0_) < 0.5;
      const n = 3 + Math.floor(r() * 4), yaw = fc.dir > 0 ? 0 : Math.PI, yr = floorY(xAt(W, fc.wx), d) + 0.05;
      note(straight ? 'cyclists riding' : 'cyclists', fc.wx, d);
      for (let j = 0; j < n; j++) {
        const ax = fc.wx + fc.dir * (j - (n - 1) / 2) * 2.4, ad = d + ((j % 2) - 0.5) * 0.6;
        yield* cyclist(ctx, out, ax, straight ? yr : W.H(ax, ad) + 0.05, ad, yaw, r, straight ? MOVE.RIDE : FL);
      }
      continue;
    }
    const wx = wx0 + r() * ROADCELL, x = xAt(W, wx), d = x.rd - dirn * 1.1;
    if (!inD(d, dLo, dHi) || !inX(ctx, wx, 12)) continue;
    const yaw = Math.atan(x.sl) + (dirn > 0 ? 0 : Math.PI);
    const type = u < 0.55 ? 'ape' : u < 0.72 ? 'vespa' : u < 0.86 ? 'car' : 'tractor';
    note(type, wx, d);
    yield* vehicle(ctx, out, W, wx, d, yaw, type, r, 1.35, floorY(xAt(W, wx), d));
  }
}
// The life of the sites: the table under the pergola, a tractor in the yard, horses in a paddock,
// people on the village piazza.
function* siteLife(ctx, out, W, list, dLo, dHi, lights) {
  for (const s of list) {
    if (s.type === 'borgo') {
      const r = makeRng(hashInts(s.seed, 61)), n = 5 + Math.floor(r() * 5);
      for (let j = 0; j < n; j++) {
        const a = r() * Math.PI * 2, rr = s.sq.r * (0.3 + 0.6 * r()), wx = s.sq.wx + Math.cos(a) * rr, d = s.sq.d + Math.sin(a) * rr * 0.8;
        if (!inD(d, dLo, dHi) || !inX(ctx, wx, 2)) continue;
        note('piazza', wx, d);
        yield* person(ctx, out, wx, W.H(wx, d), d, { yaw: r() * 6.28, coat: SHIRT[Math.floor(r() * 8)], pose: r() < 0.5 ? 'walk' : 'stand', ph: r(), hat: r() < 0.3 ? 'sun' : null, hair: [0.2, 0.15, 0.1], skirt: r() < 0.35 ? SHIRT[Math.floor(r() * 8)] : null, kid: r() < 0.2 });
      }
      continue;
    }
    if (s.table && inD(s.table[1], dLo, dHi) && inX(ctx, s.table[0], 8)) { note('table', s.table[0], s.table[1]); yield* pergolaTable(ctx, out, W, s.table[0], s.table[1], s.yaw, makeRng(hashInts(s.seed, 62)), lights); }
    if (s.tractor && inD(s.tractor[1], dLo, dHi) && inX(ctx, s.tractor[0], 8)) yield* vehicle(ctx, out, W, s.tractor[0], s.tractor[1], s.yaw + 0.4, s.type === 'winery' ? 'tractor' : 'ape', makeRng(hashInts(s.seed, 63)));
    for (const p of s.parts || []) if (p.k === 'horses' && inD(p.d, dLo, dHi) && inX(ctx, p.wx, 20)) yield* paddock(ctx, out, W, p.wx, p.d, hashInts(s.seed, 64));
  }
}

// ---------------------------------------------------------------------------------------------
// The dreamlike level (all of it gated on ctx.dials, so level 0 shows none of it)
// ---------------------------------------------------------------------------------------------
// scale: bunches of grapes the size of houses, each hanging from a giant cane that arches up out of
// a vineyard, under two of its leaves.
const GBCELL = 460;
function* giantGrapes(ctx, out, W, dLo, dHi, amount) {
  for (const { i, wx0 } of cellsAround(ctx, GBCELL, 40)) {
    const r = worldRng(ctx, 1101, i);
    if (r() > 0.55 * amount + 0.25) continue;
    // (over a vineyard if one lies in this cell, else over whatever crop is there)
    let wx = 0, d = 0, ok = false;
    for (let tr = 0; tr < 5 && !ok; tr++) {
      wx = wx0 + r() * GBCELL; d = 70 + 190 * r();
      ok = plotAt(W, wx, d).p.t === PK.VINE && !siteAt(W, wx, d);
    }
    if (!ok && siteAt(W, wx, d)) continue;
    if (!inD(d, dLo, dHi) || !inX(ctx, wx, 30)) continue;
    const K = KIND.SURREAL, x = wx - ctx.x0, y0 = W.H(wx, d);
    const Hb = (13 + 8 * r()) * (0.6 + 0.5 * amount), Wb = Hb * 0.42, bot = y0 + 2.2;
    const col = r() < 0.75 ? C.grapeBlack : C.grapeGold, gr = Math.max(0.7, Hb * 0.085);
    note('giant grapes', wx, d, Hb);
    // the cane: from the ground beside it, up and over to the top of the bunch
    const side = r() < 0.5 ? -1 : 1, cr = Math.max(0.35, Hb * 0.035), bark = [0.36, 0.26, 0.18];
    let px = x + side * Wb * 1.4, py = y0 - 0.3;
    for (let k = 1; k <= 8; k++) {
      const t = k / 8, a = t * Math.PI * 0.9;
      const qx = x + side * Wb * 1.4 * Math.cos(a * 0.9), qy = y0 + (bot + Hb + 2.5 - y0) * Math.sin(a * 0.6 + 0.3) / Math.sin(0.84);
      bar(out, px, py, -d, qx, qy, -d, cr * (1.2 - 0.5 * t), bark, 2, K);
      px = qx; py = qy;
    }
    bar(out, px, py, -d, x, bot + Hb + 0.5, -d, cr * 0.7, bark, 2, K);
    // two leaves over it
    for (const sg of [-1, 1]) {
      const lx = x + sg * Wb * 0.6, ly = bot + Hb + 1.2, c = mul3(C.vine, 1.1 + 0.15 * sg);
      for (let j = 0; j < 5; j++) { const a = j * 1.26 + 0.3; out(lx + Math.cos(a) * Wb * 0.32, ly + Math.sin(a) * Wb * 0.22, -(d - 0.5), Wb * 0.3, Wb * 0.22, 0.15, c[0], c[1], c[2], 1, ...quatRoll(a), K); }
    }
    // the grapes: round berries over a cone, wide at the shoulders, coming to a point below
    const n = Math.round(clamp(Hb * Wb * 4 / (gr * gr * 3), 40, 320));
    out(x, bot + Hb * 0.55, -d, Wb * 0.34, Hb * 0.36, Wb * 0.32, col[0] * 0.35, col[1] * 0.35, col[2] * 0.35, 1, 0, 0, 0, 1, K);
    for (let j = 0; j < n; j++) {
      // (a bunch: wide shoulders, a lobe to one side, narrowing to its tip)
      const t = Math.pow(r(), 0.75), lobe = 1 + 0.35 * Math.max(0, Math.cos((t - 0.75) * 7)) * (r() < 0.5 ? 1 : 0);
      const Rr = Wb * 0.5 * (0.2 + 0.8 * Math.pow(t, 0.75)) * lobe * (0.8 + 0.2 * r());
      let a = r() * Math.PI * 2;
      if (Math.sin(a) < -0.2 && r() < 0.7) a = -a;
      const ca = Math.cos(a), sa = Math.sin(a), lt = Math.max(0, ca * SX + 0.3 * SY + sa * SZ);
      const c = mul3(col, (0.45 + 0.6 * lt) * (0.85 + 0.3 * r()));
      const px = x + ca * Rr, py = bot + t * Hb, pz = -(d - sa * Rr);
      out(px, py, pz, gr, gr * 1.08, gr, c[0], c[1], c[2], 1, 0, 0, 0, 1, K);
      // the bloom's sheen on the side toward the sun
      const hc = mix3(col, [0.74, 0.7, 0.78], 0.55);
      out(px - gr * 0.35, py + gr * 0.38, pz + gr * 0.7, gr * 0.3, gr * 0.26, gr * 0.12, hc[0], hc[1], hc[2], 1, 0, 0, 0, 1, K);
      if (out.due()) yield;
    }
  }
}
// topology: a hill town floats clear of its hill, the crest's earth and rock hanging under it.
function townLift(t, dz) { return (dz.topology || 0) > 0 && (t.seed & 1) === 0 ? 70 + 60 * dz.topology : 0; }
function* townUnderside(ctx, out, W, t, lift, s) {
  const K = KIND.SURREAL, r = makeRng(hashInts(t.seed, 90));
  const top = W.H(t.wx, t.d) + lift - 2, depth = lift * 0.55, A = t.wide + 18, Bd = t.deep + 16;
  const n = 700;
  for (let i = 0; i < n; i++) {
    const f = Math.pow(r(), 0.7), a = (r() - 0.5) * Math.PI * 1.3 + Math.PI / 2;
    const rr = Math.pow(1 - f, 0.8);
    const wx = t.wx + Math.cos(a) * A * rr, d = t.d - Math.sin(a) * Bd * rr;
    if (!inX(ctx, wx, 0)) continue;
    const band = Math.sin(f * 18 + Math.cos(a * 2)) > 0.7;
    let c = f < 0.06 ? [0.48, 0.44, 0.24] : band ? C.clay : C.stoneWarm;
    c = mul3(c, (0.85 - 0.35 * f) * (0.9 + 0.2 * r()));
    const ss = Math.max(s, 6);
    // (its top follows the town's own ground, which climbs toward the back, so it never stands in
    // front of the houses; the underside hangs from the centre's level)
    const yTop = Math.min(W.H(wx, d) + lift - 3, top);
    out(wx - ctx.x0, f < 0.06 ? yTop : top - f * depth - 2, -d, ss, ss * 0.7, ss * 0.6, c[0], c[1], c[2], 1, 0, 0, 0, 1, K);
    if (out.due()) yield;
  }
}
// logic: the same villa again further up its avenue, and again, each a little higher and more
// turned, the cypresses going on between them.
function* repeatVilla(ctx, out, W, list, dLo, dHi, plan, logic) {
  for (const s of list) {
    if (s.type !== 'villa' || s.far || !s.parts) continue;
    const h = s.parts[0].b, copies = 2 + Math.round(2 * logic);
    for (let k = 1; k <= copies; k++) {
      const d = s.d + 48 * k, wx = s.wx + 14 * Math.sin(k * 1.7);
      if (!inD(d, dLo, dHi) || !inX(ctx, wx, 30)) continue;
      note('villa again', wx, d);
      const b = { ...h, wx, d, yaw: h.yaw + 0.22 * k, base: footing(W, s.wx, s.d, h.w, h.dep, h.yaw) + 17 * k, seed: hashInts(h.seed, k) };
      yield* building(ctx, out, W, b, { kind: KIND.SURREAL });
      if (plan) for (const sg of [-1, 1]) for (const dd of [-26, -13]) {
        const t = planTree(ctx, out, W, 'cypress', wx + sg * 7, d + dd, 15, { y: b.base + 0.3 + 17 * (dd / 48), kind: KIND.SURREAL });
        plan.push(t);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------------------------
// Where one band hands its props to the next: a little short of the border, so that a thing standing
// just inside it is drawn whole by the band beyond (whose clip reaches well back) and not cut off.
const SPLIT_TN = 28.6, SPLIT_NM = 290;
const ROWS3D = 105;
function* trackside(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 1, detailK: 1.2 });
  out.limit = ctx.count * 0.5;
  yield* overheadLine(ctx, out, ctx.beatMetres || 56, { d: 3.7 });
  out.limit = Infinity;
  const rest = out.left();
  yield* fillPlain(ctx, out, W, { n: Math.round(rest * 0.3), dNear: 2.5, dFar: 9, power: 1.0, cover: 4 });
  yield* fillPlain(ctx, out, W, { dNear: 9, power: 0.6, cover: 3.6 });
}

function* near(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.1 });
  const lo = SPLIT_TN, hi = SPLIT_NM;
  const plots = plotsIn(ctx, W, lo, hi), lights = lightsOn(ctx);
  out.limit = ctx.count * 0.45;
  const plan = [], list = sitesNear(ctx, W), dz = ctx.dials || {};
  // the dreamlike level first, so the band's prop budget never squeezes it out
  if ((dz.scale || 0) > 0) yield* giantGrapes(ctx, out, W, lo, hi, dz.scale);
  if ((dz.logic || 0) > 0) yield* repeatVilla(ctx, out, W, list, lo, hi, plan, dz.logic);
  // the living things first, then what is built
  yield* harvest(ctx, out, W, plots, lo, hi);
  yield* animals(ctx, out, W, lo, hi, dusky(ctx));
  yield* birds(ctx, out, W, lo, hi);
  yield* roadLife(ctx, out, W, lo, hi);
  yield* siteLife(ctx, out, W, list, lo, hi, lights);
  note('near life %', ctx.x0, 100 * out.n / ctx.count);
  full(ctx, out, 'near life');
  yield* sites(ctx, out, W, list, lo, hi, { plan, lights, tall: dz.scale || 0 });
  note('near sites %', ctx.x0, 100 * out.n / ctx.count);
  full(ctx, out, 'near sites');
  olivesNear(ctx, out, W, plots, plan, lo, hi);
  woodEdges(ctx, out, W, plots, plan, lo, hi, 8);
  riverTrees(ctx, out, W, plan, lo, hi);
  roadTrees(ctx, out, W, plan, lo, hi);
  out.limit = Math.max(out.limit, out.n) + ctx.count * 0.16;
  yield* drawPlan(ctx, out, plan, Math.max(0, out.limit - out.n - 20));
  note('near trees %', ctx.x0, 100 * out.n / ctx.count);
  full(ctx, out, 'near trees');
  yield* bales(ctx, out, W, plots, lo, hi);
  // (the rows get what is left, down to a floor, drawn coarser to fit it; the fill keeps a quarter)
  const rb = clamp(ctx.count * 0.75 - out.n, ctx.count * 0.08, ctx.count * 0.3), coarse = rowCoarse(out, plots, lo, ROWS3D, rb);
  out.limit = out.n + rb * 1.2;
  yield* sunflowers(ctx, out, W, plots, lo, hi, coarse);
  yield* vineRows(ctx, out, W, plots, lo, hi, coarse);
  note('near rows %', ctx.x0, 100 * out.n / ctx.count);
  full(ctx, out, 'near rows');
  yield* fillView(ctx, out, W, { cover: 3.4, strips: 4, maxR: 0.03, rows3d: ROWS3D, olives3d: SPLIT_NM });
}

// What the nearer ground hides along a column: the highest elevation tangent it reaches.
function occlBefore(W, list) {
  return (wx) => { let a = -9; for (const dd of list) a = Math.max(a, (W.H(wx, dd) - CAMY) / dd); return a - 0.02; };
}
function* mid(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.6 });
  const lo = SPLIT_NM, hi = ctx.zFar, lights = lightsOn(ctx);
  out.limit = ctx.count * 0.4;
  const plots = plotsIn(ctx, W, lo, 700);
  const plan = [];
  const dz = ctx.dials || {};
  out.limit = ctx.count * (lights ? 0.44 : 0.36);     // (lit windows cost a splat each)
  yield* towns(ctx, out, W, lo, hi, plan, lights, 0.42, dz);
  out.limit = Math.max(out.n + ctx.count * 0.08, ctx.count * 0.42);
  note('mid towns %', ctx.x0, 100 * out.n / ctx.count);
  full(ctx, out, 'mid towns');
  const midList = sitesNear(ctx, W, 450);
  if ((dz.logic || 0) > 0) yield* repeatVilla(ctx, out, W, midList, lo, hi, plan, dz.logic);
  yield* sites(ctx, out, W, midList, lo, hi, { plan, lights, s: 0.55, far: true, tall: dz.scale || 0 });
  note('mid sites %', ctx.x0, 100 * out.n / ctx.count);
  full(ctx, out, 'mid sites');
  yield* bales(ctx, out, W, plots, lo, 600);
  woodEdges(ctx, out, W, plots, plan, lo, 700, 14, 0.6);
  riverTrees(ctx, out, W, plan, lo, hi);
  for (const t of plan) t.nMax = Math.min(t.nMax, 8);
  out.limit = Math.max(out.limit, out.n) + ctx.count * 0.1;
  yield* drawPlan(ctx, out, plan, Math.max(0, out.limit - out.n));
  yield* fillView(ctx, out, W, { cover: 3.3, strips: 10, far: true });
}

function* far(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 600 });
  yield* fillView(ctx, out, W, { cover: 2.3, strips: 40, far: true, far2: true, minR: 0.001, maxR: 0.02, floor: 0.08, occl: occlBefore(W, [900, 1300, 1800, 2300, 2900]) });
}

export const tuscanyBiome = {
  name: 'tuscany',
  palette: PAL,
  terrain: TERRAIN,
  hazeDist: 8500,
  // the bank falls away below the window and is mostly out of sight; the floor, the far side and
  // the hill towns are the picture
  shares: { trackside: 0.07, near: 0.45, mid: 0.3, far: 0.18 },
  // a sunlit country: the long day, and more than the usual share of the low gold light at dusk
  slots: { dawn: 0.14, day: 0.48, dusk: 0.38, night: 0 },
  beatKinds: [KIND.TREE, KIND.BUILDING, KIND.LIGHT],
  sky: { stars: 1.1, deep: 0.5, milkyWay: 0.6, clear: 0.9 },
  generators: { trackside, near, mid, far },
};

// ---------------------------------------------------------------------------------------------
// For scripts that inspect the layout, e.g.
//   const { _debug } = await import('./src/window/biomes/tuscany.js');
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
    towns: list(TCELL, town, (t) => ({ wx: R(t.wx), d: R(t.d), top: R(W.H(t.wx, t.d)) })),
    amiata: list(AMCELL, amiata, (a) => ({ wx: R(a.wx), d: R(a.d) })),
    knolls: list(KNCELL, knoll, (k) => ({ wx: R(k.wx), d: R(k.d), villa: k.villa })),
  };
}
export const _debug = { world, at, layout, xAt, heightAt, paint, plotAt };
