// "Fuji": Japan from the Tokaido line on a clear day. Flooded rice paddies in a neat grid, villages
// of low houses under grey kawara tiles, a red torii at the foot of steps climbing into cedars, a
// temple with a five-storey pagoda among pines, cherry trees along a river's levees, tea clipped
// into rounded rows round the hills, bamboo, persimmons, an elevated high-speed line on concrete
// piers, utility poles strung with wires, glowing vending machines. And behind it all, one great
// snow-capped cone, far larger than anything else, holding its place for many kilometres while the
// near country races past.
//
// Structure (as karst.js and himalaya.js): one pure layout of WORLD x and distance, hashed from the
// world seed and cached per world: the Fujis, the near hills, lakes, the river, the road, the paddy
// grid, villages, shrines, temples, the viaduct, greenhouses, golf nets, platforms, farmers and
// egrets. Every band reads from it and draws what falls inside it, so nothing jumps at a chunk seam
// or a band border. Only the ground fills use the chunk's own rng.
//
// Terrain: this file has its own height function (heightAt) and hands it to the kit through a copy of
// ctx (local() below), so props stand on the same ground the fills draw. It holds the near hills,
// the lakes, the river's channel and levees, gentle swells in the mid band, foothills in the far band
// and the Fujis themselves.
//
// Fuji: there is one, and it does not scroll past. It is a backdrop that stays with the journey (the
// engine's backdrop mesh), about 11 km out and 3.3-3.6 km high: see theFuji and backdropPose.
// and 16-18 km across at the foot, so it stays in the window for some 20 km of travel and drifts back
// slowly while the country slides past. It is drawn by every far chunk it reaches, piecewise, on a
// lattice anchored to the mountain (rows up its profile spaced by how fast they climb the window,
// columns round it), with jitter hashed from the lattice cell: each lattice point belongs to exactly
// one chunk, so two chunks meet without a seam. The lattice spacing comes only from the band's splat
// count, sized so the heaviest chunk spends about 62% of its budget on the mountain. Lit from its
// surface normal against SUN; snow on the upper cone and down the gullies; cloud belts and cap
// clouds billow (MOVE.VAPOUR). Near hills are kept low in front of a Fuji's best view and rise in
// the stretches between, where they and the cloud hide it.
//
// The beat: the mountain stays still. Every tree swells on it (KIND.TREE: cherries, pines, cedars,
// bamboo, persimmons, broadleaves, roadside, field and shrine trees; the hills' emergent broadleaves
// and the plain's groves are KIND.HEDGE blobs tagged MOVE.BEAT by hand; tea rows and hedges stay
// still). Houses, the pagoda, the torii, lanterns and the viaduct
// (BUILDING) and lights answer it too; the greenhouse tunnels are rigid (MOVE.STILL); people and birds tag their own splats MOVE.FLASH (they brighten
// without swelling); the carts, the portable shrine, the picnic boxes and the angler's bucket are
// rigid and MOVE.STILL (nothing on the beat).
//
// Cyclists ride (MOVE.RIDE, see kit.js rideCell): each stands within a few metres of its 24 m ride
// cell's middle, faces the cell's way and keeps to that way's side of its track (with the train on
// the near side, against it on the far side), so the shader can carry it along the line past the
// country. Only where the way runs straight and level for 72 m each side with nothing on it to
// ride through (rideable(), laneRiders(), roadSlot()); elsewhere a cyclist stands still, and the one
// waiting at the level crossing always does.
//
// People (see "People and animals" and the ...Life functions): the country is lived in. Planting
// teams bent double in rows across the flooded paddies, farmers hoeing the vegetable plots; two farm
// lanes between the paddies (raised tracks along two of the row boundaries) with cyclists,
// schoolchildren under umbrellas, handcarts, kei trucks, dog walkers; picnics on coloured sheets,
// strollers and anglers along the river's near levee under the cherries; at a shrine a maiden
// sweeping, somebody bowing, banners and a festival procession carrying a portable shrine; monks
// before a pagoda; tea pickers on the tea hills; passengers on a platform; a level crossing with
// somebody waiting at its barriers; egrets, herons and cranes in the paddies. All are placed from
// world hashes where the line can see them (openTo), drawn 1.7 to 2.5 times life size (figK; monks and
// tea pickers, who stand furthest out, up to 2.9 times, and the birds 2 to 3 times) because
// a life-size figure 80 m out is a speck, and emitted before each band's limit on props, so they
// appear at every budget. By night some carry paper lanterns or lamps.
//
// Surreal dials (all 0 at level 0, so level 0 shows none of this):
//   scale     a torii vast enough to frame Fuji's summit; the temple pagoda grown to fifty storeys
//   topology  carp streamers the size of airships swimming through the sky; lanterns rising from the
//             villages at dusk
//   logic     a second, smaller Fuji beside the first, and small Fujis ringing the horizon
//   matter    the cherry blossom lifting off the trees in a pale column
import { hashInts, hashString, makeRng, noise1, noise2 } from '../rng.js';
import { makeTerrain } from '../terrain.js';
import {
  KIND, MOVE, makeOut, worldSeed, cellsAround, detail, shade, jitter, mul3, mix3, smooth, clamp, lerp,
  norm3, quatYaw, quatUpTo, quatMul, quatXTo, quatAxis, overheadLine, blob, strut, conifer, treeSplats, SUN, rideCell,
} from './kit.js';
import { bamboo } from './karst.js';

const PAL = {
  ground: [0.3, 0.42, 0.24],      // paddy green: also the backdrop below the horizon
  foliage: [0.13, 0.22, 0.12],
  rock: [0.42, 0.41, 0.4],
  ballast: [0.44, 0.43, 0.41],
};

// Colours. Natural surfaces stay <= 0.8 per channel (kit.js caps them anyway).
const C = {
  ballast: [0.44, 0.43, 0.41],
  cess: [0.42, 0.39, 0.33],
  grass: [0.33, 0.45, 0.19],
  grassDry: [0.45, 0.45, 0.27],
  water: [0.64, 0.7, 0.76],          // flooded paddy: a mirror of the pale sky
  waterDull: [0.55, 0.6, 0.62],
  youngRice: [0.38, 0.56, 0.2],
  rice: [0.28, 0.46, 0.15],
  soil: [0.4, 0.33, 0.25],
  veg: [0.24, 0.42, 0.16],
  bund: [0.3, 0.4, 0.17],
  bundLit: [0.37, 0.47, 0.2],
  road: [0.36, 0.36, 0.37],
  roadLine: [0.78, 0.78, 0.74],
  river: [0.5, 0.6, 0.64],
  riverDeep: [0.4, 0.5, 0.54],
  revet: [0.6, 0.6, 0.57],            // concrete facing of the levees
  path: [0.55, 0.52, 0.46],
  lane: [0.62, 0.59, 0.52],            // the farm tracks between the paddies
  lake: [0.52, 0.62, 0.7],
  lakeDeep: [0.4, 0.52, 0.62],
  sand: [0.55, 0.52, 0.44],
  wood: [0.07, 0.13, 0.07],
  woodLit: [0.14, 0.22, 0.09],
  cedar: [0.08, 0.15, 0.1],
  teaRow: [0.3, 0.5, 0.15],
  teaLit: [0.44, 0.62, 0.2],
  teaPath: [0.25, 0.22, 0.16],
  yard: [0.5, 0.48, 0.44],
  garden: [0.26, 0.38, 0.17],
  gravel: [0.6, 0.58, 0.53],
  // Fuji
  snow: [0.8, 0.8, 0.8],
  snowShade: [0.46, 0.55, 0.72],
  fujiRock: [0.3, 0.25, 0.27],         // the dark red-brown cinder of the upper cone
  fujiRidge: [0.4, 0.34, 0.33],
  fujiForest: [0.1, 0.17, 0.15],
  fujiLow: [0.2, 0.3, 0.2],
  aerial: [0.42, 0.5, 0.64],
  cloud: [0.8, 0.8, 0.8],
  cloudShade: [0.6, 0.63, 0.68],
  // far plain
  farField: [0.28, 0.38, 0.22],
  farField2: [0.36, 0.4, 0.27],
  farTown: [0.48, 0.47, 0.45],
  farHill: [0.12, 0.19, 0.14],
  // built things
  tile: [0.25, 0.27, 0.31],            // kawara: grey, a little blue
  tileDark: [0.14, 0.15, 0.17],
  timber: [0.2, 0.14, 0.1],
  plaster: [0.76, 0.73, 0.65],
  concrete: [0.62, 0.62, 0.6],
  vermilion: [0.78, 0.22, 0.1],
  black: [0.08, 0.07, 0.07],
  stone: [0.55, 0.54, 0.5],
  glass: [0.14, 0.16, 0.19],
  cherry: [0.8, 0.64, 0.7],
  cherryDeep: [0.72, 0.5, 0.58],
  bark: [0.2, 0.16, 0.14],
  persimmon: [0.8, 0.42, 0.08],
  pine: [0.1, 0.18, 0.12],
};
const LIT = [1.0, 0.8, 0.5];         // a lit window: a light source (>= 0.97), ignores the tint
const LAMP = [1.0, 0.86, 0.6];

const TERRAIN = { cutting: 1.2 };   // the shape numbers are unused: the land comes from heightAt()

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
const sq = (v) => v * v;
const h01 = (a, b, c) => hashInts(a, b, c) / 4294967296;
function hourOf(ctx) { const h = ctx.hour != null ? ctx.hour : 12; return ((h % 24) + 24) % 24; }
// lit from the start of the dusk slot until the end of the dawn one
function isNight(ctx) { const h = hourOf(ctx); return h < 6.9 || h > 18.9; }
function litShare(ctx) { if (!isNight(ctx)) return 0; const h = hourOf(ctx); return h > 0.5 && h < 5 ? 0.12 : 0.4; }
function cget(map, key, make) {
  let v = map.get(key);
  if (v === undefined) { v = make(); if (map.size > 20000) map.clear(); map.set(key, v); }
  return v;
}
// Rotation whose columns are the unit vectors X, Y, Z (local x -> X, y -> Y, z -> Z), as [x, y, z, w].
function quatBasis(m00, m10, m20, m01, m11, m21, m02, m12, m22) {
  const tr = m00 + m11 + m22;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]; }
  if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11); return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}
// A rotation taking local x to u and local y to (v made perpendicular to u); local z = u x v.
function quatUV(ux, uy, uz, vx, vy, vz) {
  let l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
  const dt = ux * vx + uy * vy + uz * vz;
  vx -= dt * ux; vy -= dt * uy; vz -= dt * uz;
  l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  return quatBasis(ux, uy, uz, vx, vy, vz, nx, ny, nz);
}
// Tone for a vertical face with outward normal (nx, nz) in splat space: front, sunlit (-x) end and
// shaded (+x) end clearly different, so the corners read in motion.
function faceTone(c, nx, nz) {
  const k = 0.6 + 0.26 * Math.max(0, nz) + 0.42 * Math.max(0, -nx) - 0.06 * Math.max(0, nx) + 0.1 * Math.max(0, -nz);
  return [c[0] * k, c[1] * k, c[2] * k];
}
// An emitter that tags every splat with one motion class: MOVE.FLASH for people and animals (they
// brighten on the beat), MOVE.RIDE for a cyclist and the bicycle under them (carried along the line:
// see rideCell), MOVE.STILL for the carts and the portable shrine drawn with the figures' helpers.
function moveOut(out, move) {
  const cache = out.moveOuts || (out.moveOuts = {});
  if (cache[move]) return cache[move];
  const b = (x, y, z, sx, sy, sz, r, g, bb, o, qx, qy, qz, qw, k) => out(x, y, z, sx, sy, sz, r, g, bb, o, qx, qy, qz, qw, k, move);
  b.due = out.due; b.density = out.density; b.detailK = out.detailK; b.ctx = out.ctx; b.left = out.left;
  b.q = (x, y, z, sx, sy, sz, c, o, q, kind) => b(x, y, z, sx, sy, sz, c[0], c[1], c[2], o, q ? q[0] : 0, q ? q[1] : 0, q ? q[2] : 0, q ? q[3] : 1, kind);
  cache[move] = b;
  return b;
}
// A thin straight member with a motion class (kit.js strut() has none).
// Rotation taking +x along (vx, vy, vz), any length.
function quatDir(vx, vy, vz) { const l = Math.hypot(vx, vy, vz) || 1; return quatXTo(vx / l, vy / l, vz / l); }
function strutM(out, ax, ay, az, bx, by, bz, r, c, n, kind, move, alpha = 1) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1e-6;
  const q = quatXTo(dx / len, dy / len, dz / len), sl = (len / n) * 0.45;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    out(ax + dx * t, ay + dy * t, az + dz * t, Math.max(sl, r), r, r, c[0], c[1], c[2], alpha, q[0], q[1], q[2], q[3], kind, move);
  }
}
const inX = (ctx, wx, m) => wx > ctx.x0 - m && wx < ctx.x0 + ctx.length + m;
const inD = (d, lo, hi) => d >= lo && d < hi;

// ---------------------------------------------------------------------------------------------
// World layout (pure functions of world x and distance, cached per world seed)
// ---------------------------------------------------------------------------------------------
const worlds = new Map();
function world(ctx) {
  const ws = worldSeed(ctx);
  let W = worlds.get(ws);
  if (W) return W;
  W = { ws, fujis: new Map(), hills: new Map(), lakes: new Map(), panels: new Map(), villages: new Map(), misc: new Map(), groups: new Map() };
  W.H = (wx, d) => heightAt(W, wx, d);
  W.terr = { height: W.H, stretch: ctx.terrain.stretch, shape: ctx.terrain.shape };
  // paddy rows parallel to the track, cut into panels along it
  const r = makeRng(hashInts(ws, 501));
  const rows = [];
  let D = 9.5;
  while (D < 3400) {
    const gap = (10 + 0.1 * D) * (0.7 + 0.6 * r());
    rows.push({ D, gap, W: (22 + 0.16 * D) * (0.7 + 0.6 * r()), off: r() * 100 });
    D += gap;
  }
  W.rows = rows; W.Ds = new Float64Array(rows.map((q) => q.D));
  // Farm lanes: two of the row boundaries, one 36-62 m out and one 70-112 m, carry a raised track
  // between the paddies (picked by their own hashes: the row rng above keeps its draws).
  const pick = (want, not) => {
    let b = -1;
    for (let k = 1; k < rows.length; k++) {
      if (rows[k].D < 34 || rows[k].D > 125 || Math.abs(k - not) < 2) continue;
      if (b < 0 || Math.abs(rows[k].D - want) < Math.abs(rows[b].D - want)) b = k;
    }
    return b;
  };
  const la = pick(40 + 20 * h01(ws, 531, 1), -9), lb = pick(80 + 28 * h01(ws, 531, 2), la);
  if (la >= 0) rows[la].lane = true;
  if (lb >= 0) rows[lb].lane = true;
  worlds.set(ws, W);
  if (worlds.size > 6) worlds.delete(worlds.keys().next().value);
  return W;
}
// A copy of ctx standing on this biome's terrain; every kit call must get this one.
function local(ctx) { const W = world(ctx); return [{ ...ctx, terrain: W.terr }, W]; }

// --- Fuji: there is one. It does not stand at a place along the line and scroll past like the rest
// of the country: it is a backdrop that stays with the journey (see the engine's backdrop and the
// biome's export below), drifting slowly across the window and turning a little as the line bends
// round it. Each world (each new stretch of scenery) has its own variant of the one mountain.
const FCELL = 9000;      // spacing of the things that used to stand before a Fuji (the dreamlike torii)
const AM = 2.3;          // the lattice goes this far round the cone each way from the side facing the line
const FUJI_D = 11000;    // its axis stands this far from the line
function theFuji(W) {
  return cget(W.fujis, 'one', () => {
    const r = makeRng(hashInts(W.ws, 3001, 0));
    const H = 3300 + 300 * r();
    return makeCone({
      i: 0, wx: 0, d: FUJI_D, H, R: H * (2.35 + 0.2 * r()),
      p: 1.6 + 0.15 * r(), u0: 0.03 + 0.008 * r(), s: hashInts(W.ws, 3002, 0),
      snow: 0.52 + 0.18 * r(), osawa: (r() - 0.5) * 1.4,
      belt: r() < 0.4, cap: r() < 0.22, bank: r() < 0.16,
    });
  });
}
// Nothing in the scrolling world is a Fuji any more: the lookups below find none.
function fujiSite() { return null; }
function makeCone(c) {
  c.ng = 8.5 + 3 * h01(c.s, 1, 1);           // gullies per radian round the cone
  c.hoei = (h01(c.s, 2, 1) - 0.5) * 2;       // where the side crater sits
  return c;
}
function fujiNear(W, wx) {
  const i0 = Math.floor(wx / FCELL);
  let best = null, bd = Infinity;
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const f = fujiSite(W, i);
    if (f && Math.abs(f.wx - wx) < bd) { bd = Math.abs(f.wx - wx); best = f; }
  }
  return best;
}
// 1 where the country lies open towards the mountain, 0 where low hills rise and hide it for a
// while: slow stretches along the line.
function fujiFront(W, wx) { return smooth(0.36, 0.56, noise1(wx / 7000, W.ws + 3003)); }

// The cone's height at (rho, theta) round its axis. theta = 0 faces the line.
function gullyOf(c, rho, th) {
  const w = 1.4 * noise1(rho / 1700, c.s + 3);
  const a = smooth(0.46, 0.2, noise1(th * c.ng + w, c.s + 2));
  const b = smooth(0.42, 0.2, noise1(th * c.ng * 2.7 + 2 * w + rho / 2600, c.s + 4));
  return Math.max(a, 0.65 * b);
}
let LASTG = 0;          // the gully value coneHeight found last (fujiColor reuses it)
function coneHeight(c, rho, th) {
  const u = rho / c.R;
  if (u >= 1) return 0;
  let h = c.H * Math.pow(1 - (u < c.u0 ? c.u0 : u), c.p);
  if (u < c.u0 * 1.8) h += c.H * 0.008 * (noise1(th * 3.4, c.s + 5) - 0.45) * smooth(c.u0 * 1.8, c.u0 * 0.7, u);   // the crater rim
  const gb = smooth(0.02, 0.09, u) * smooth(0.75, 0.3, u);
  LASTG = gb > 0 || u < 0.85 ? gullyOf(c, rho, th) : 0;
  if (gb > 0) h -= c.H * 0.017 * LASTG * gb;
  // the great ravine down one flank, and the side crater's shoulder on another
  const da = Math.abs(th - c.osawa);
  if (da < 0.1) h -= c.H * 0.035 * smooth(0.1, 0, da) * smooth(0.02, 0.07, u) * smooth(0.5, 0.2, u);
  const dh = Math.abs(th - c.hoei);
  if (dh < 0.35) h += c.H * 0.03 * smooth(0.35, 0, dh) * Math.exp(-sq((u - 0.32) / 0.08));
  return h;
}
// The Fuji under a world point: height and where on the cone. Returns a reused object.
const FZ = { h: 0, f: null, rho: 0, th: 0 };
function fujiAt(W, wx, d) {
  FZ.h = 0; FZ.f = null;
  if (d < 1500) return FZ;
  const i0 = Math.floor(wx / FCELL);
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const f = fujiSite(W, i);
    if (!f) continue;
    const dx = wx - f.wx, dd = f.d - d;
    if (Math.abs(dx) > f.R || Math.abs(dd) > f.R) continue;
    const rho = Math.hypot(dx, dd);
    if (rho >= f.R) continue;
    const th = Math.atan2(dx, dd);
    const h = coneHeight(f, rho, th);
    if (h > FZ.h) { FZ.h = h; FZ.f = f; FZ.rho = rho; FZ.th = th; }
  }
  return FZ;
}

// --- near hills: low wooded hills in stretches, kept low in front of a Fuji's best view ---
const HILLCELL = 520;
function hilliness(W, wx) { return 0.85 * smooth(0.36, 0.72, noise1(wx / 3200, W.ws + 101)); }
function hillSite(W, i) {
  return cget(W.hills, i, () => {
    const r = makeRng(hashInts(W.ws, 1101, i));
    const wx = (i + 0.2 + 0.6 * r()) * HILLCELL;
    if (r() > hilliness(W, wx)) return null;
    const low = fujiFront(W, wx);
    const Hh = (24 + 46 * r()) * (1 - 0.7 * low);
    const rx = 90 + 110 * r();
    const rd = Math.max(55 + 50 * r(), Hh * 1.7);
    let dc = Math.max(140 + 180 * r(), rd + 48);
    if (riverAmt(W, wx) > 0) dc = Math.max(dc, rd + 160);
    if (lakeE(W, wx, dc) < 2.2) return null;
    return { i, wx, dc, rx, rd, Hh, tea: r() < 0.38, shrine: dc < 360 && r() < 0.45, seed: hashInts(W.ws, 1102, i) };
  });
}
const HL = { hh: 0, hill: null };
function hillAt(W, wx, d) {
  HL.hh = 0; HL.hill = null;
  if (d < 40 || d > 760) return HL;
  const i0 = Math.floor(wx / HILLCELL);
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const h = hillSite(W, i);
    if (!h) continue;
    const ex = (wx - h.wx) / h.rx, ed = (d - h.dc) / h.rd;
    const k = 1 - ex * ex - ed * ed;
    if (k <= 0) continue;
    const v = h.Hh * k * k * (3 - 2 * k) * (0.8 + 0.4 * noise2(wx / 70, d / 55, h.seed & 0xffff));
    if (v > HL.hh) { HL.hh = v; HL.hill = h; }
  }
  return HL;
}
// One hill's own height at a world point (no lookups).
function hillBump(h, wx, d) {
  const ex = (wx - h.wx) / h.rx, ed = (d - h.dc) / h.rd, k = 1 - ex * ex - ed * ed;
  return k <= 0 ? 0 : h.Hh * k * k * (3 - 2 * k) * (0.8 + 0.4 * noise2(wx / 70, d / 55, h.seed & 0xffff));
}
// the height fraction on a hill -> how far out (0..1 of its radii) that contour lies
function hillContour(f) { const k = 0.5 - Math.sin(Math.asin(clamp(1 - 2 * f, -1, 1)) / 3); return Math.sqrt(Math.max(0, 1 - k)); }

// --- lakes: a few, mostly where a Fuji stands beyond ---
const LCELL = 8000;
function lakeSite(W, i) {
  return cget(W.lakes, i, () => {
    const r = makeRng(hashInts(W.ws, 1201, i));
    const wx = (i + 0.25 + 0.5 * r()) * LCELL;
    if (r() > 0.12 + 0.7 * fujiFront(W, wx)) return null;
    const rx = 380 + 520 * r(), rd = 120 + 150 * r();
    return { i, wx, dc: Math.max(300 + 350 * r(), rd + 170), rx, rd, seed: hashInts(W.ws, 1202, i) };
  });
}
function lakeE(W, wx, d) {
  if (d < 120 || d > 1400) return 9;
  const i0 = Math.floor(wx / LCELL);
  let e = 9;
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const l = lakeSite(W, i);
    if (!l) continue;
    const ex = (wx - l.wx) / l.rx, ed = (d - l.dc) / l.rd;
    e = Math.min(e, ex * ex + ed * ed);
  }
  return e;
}

// --- the river: parallel to the line in stretches, between concrete-faced levees ---
function riverAmt(W, wx) { return smooth(0.57, 0.63, noise1(wx / 4600, W.ws + 201)); }
function riverN(W, wx) { return 62 + 40 * noise1(wx / 1400, W.ws + 202); }
function riverW(W, wx) { return (13 + 14 * noise1(wx / 900, W.ws + 203)) * riverAmt(W, wx); }

// --- the road: a lane parallel to the line, with its poles and wires ---
function roadOn(W, wx) { return noise1(wx / 2200, W.ws + 301) > 0.34 && riverAmt(W, wx) === 0; }
function roadD(W, wx) { return 22 + 20 * noise1(wx / 1700, W.ws + 302); }

// --- the viaduct of the high-speed line, in the mid distance, in stretches ---
function viaOn(W, wx) { return noise1(wx / 6500, W.ws + 401) > 0.42; }
function viaD(W, wx) { return 560 + 320 * noise1(wx / 5200, W.ws + 402); }

// ---------------------------------------------------------------------------------------------
// Terrain
//   0 .. 8 m      ballast and a small embankment
//   8 .. 700 m    the flat floor of paddies (a metre or so of roll), low hills in stretches, the
//                 river's levees, lakes
//   500 .. 3400   gentle swells
//   3 .. 14 km    foothills in stretches (never on a Fuji), and the Fujis
// ---------------------------------------------------------------------------------------------
// (fl: optionally, the Fujis near the chunk, to spare the lookups; see fujisFor)
function baseAt(W, wx, d, fl) {
  let h = -1.2 * clamp((d - 2) / 6, 0, 1);
  if (d < 8) return h;
  if (d < 3000) h += (noise2(wx / 300, d / 300, W.ws + 11) - 0.5) * 1.6 * clamp((d - 10) / 80, 0, 1) * (1 - smooth(2500, 3000, d));
  if (d > 40 && d < 760) h += hillAt(W, wx, d).hh;
  if (d > 500 && d < 3400) h += 30 * smooth(500, 1500, d) * (1 - smooth(2600, 3400, d)) * sq(noise2(wx / 1500, d / 1300, W.ws + 13));
  if (d > 3200) h += foothill(W, wx, d, fl);
  return h;
}
// The Fujis that can reach a chunk (from the three cells round each end), for the far band's sums.
function fujisFor(W, ctx) {
  const res = [];
  for (let i = Math.floor((ctx.x0 - FCELL) / FCELL); i <= Math.floor((ctx.x0 + ctx.length + FCELL) / FCELL); i++) { const f = fujiSite(W, i); if (f) res.push(f); }
  return res;
}
function nearestIn(fl, wx) { let best = null, bd = Infinity; for (const f of fl) { const v = Math.abs(f.wx - wx); if (v < bd) { bd = v; best = f; } } return best; }
function foothill(W, wx, d, fl) {
  const a = smooth(3200, 5200, d) * (60 + 240 * noise1(wx / 11000, W.ws + 14));
  if (a < 1) return 0;
  const f = fl ? nearestIn(fl, wx) : fujiNear(W, wx);
  let keep = 1;
  if (f) { const rho = Math.hypot(wx - f.wx, d - f.d); keep = smooth(f.R * 0.95, f.R * 1.2, rho); if (keep <= 0) return 0; }
  const n = noise2(wx / 2600, d / 1800, W.ws + 15);
  const rr = 1 - Math.abs(2 * n - 1);
  return a * keep * (0.75 * rr * rr + 0.25 * noise2(wx / 700, d / 600, W.ws + 16));
}
function heightAt(W, wx, d) {
  let h = baseAt(W, wx, d);
  if (d > 1500) h += fujiAt(W, wx, d).h;
  // the river: channel and levees
  if (d > 40 && d < 160) {
    const ra = riverAmt(W, wx);
    if (ra > 0) {
      const rn = riverN(W, wx), rw = riverW(W, wx);
      const s = Math.max(rn - d, d - rn - rw);      // metres outside the channel (< 0 inside)
      if (s < 12) {
        let v;
        if (s < 0) v = -1.8;
        else if (s < 2) v = lerp(-1.2, 2.2, s / 2);
        else if (s < 8) v = 2.2;
        else v = lerp(2.2, 0, (s - 8) / 4);
        h = lerp(h, Math.min(h, -0.5) + v + 0.5, ra);
      }
    }
  }
  // lakes: flat water with a gently rising shore
  if (d > 120 && d < 1400) {
    const e = lakeE(W, wx, d);
    if (e < 1.3) h = lerp(-0.9, h, smooth(1, 1.3, e));
  }
  return h;
}

// --- the paddy grid ---
function rowAt(W, d) {
  const Ds = W.Ds;
  let lo = 0, hi = Ds.length - 1;
  if (d < Ds[0]) return 0;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (Ds[m] <= d) lo = m; else hi = m - 1; }
  return lo;
}
const P = { WATER: 0, YOUNG: 1, RICE: 2, DRY: 3, HOUSE: 4 };
// A farm lane (a row boundary flagged `lane` in world()): how wide it is and how far its top stands
// above the paddies, both growing a little with distance so it stays a line in the window.
const laneW = (D) => 2.6 + 0.012 * D, laneTop = (D) => 0.34 + 0.0026 * D;
function panelInfo(W, k, j) {
  return cget(W.panels, k * 1048576 + (j & 1048575), () => {
    const r = makeRng(hashInts(W.ws, 521, k, j));
    const q = W.rows[k];
    const cx = (j + 0.5) * q.W - q.off;
    const season = noise1(cx / 3600, W.ws + 522);
    const u = r();
    let t;
    if (q.D > 35 && q.D < 330 && u < 0.05 && noise1(cx / 1500, W.ws + 523) > 0.45) t = P.HOUSE;
    else if (u < 0.15) t = P.DRY;
    else { const g = r(); t = g < 0.62 - 0.5 * season ? P.WATER : g < 0.9 - 0.15 * season ? P.YOUNG : P.RICE; }
    return { t, tone: 0.93 + 0.14 * r(), green: 0.35 + 0.4 * r(), period: 1.2 + 1.0 * r(), dir: r() < 0.6, seed: hashInts(W.ws, 524, k, j) };
  });
}

// --- villages: clusters of houses with gardens, at most one per VCELL ---
const VCELL = 1000;
function village(W, i) { return cget(W.villages, i, () => makeVillage(W, i)); }
function makeVillage(W, i) {
  const h = hashInts(W.ws, 801, i), r = makeRng(h);
  const cx = (i + 0.2 + 0.6 * r()) * VCELL;
  if (noise1(cx / 2700, W.ws + 802) < 0.3 || r() < 0.25) return null;
  const dc = 40 + 900 * Math.pow(r(), 1.5);
  const R = 45 + 0.04 * dc + 55 * r(), Rd = Math.max(22, R * (0.38 + 0.2 * r()));
  const dcc = Math.max(dc, Rd + 34);
  if (lakeE(W, cx, dcc) < 2.5) return null;
  const v = { i, cx, dc: dcc, R, Rd, seed: h, houses: [], trees: [] };
  const gx = 16, gd = 14;
  for (let a = -R; a <= R; a += gx) {
    for (let b = -Rd; b <= Rd; b += gd) {
      const pr = makeRng(hashInts(h, Math.round(a), Math.round(b)));
      const e = (a / R) ** 2 + (b / Rd) ** 2;
      if (e > 1) continue;
      const wx = cx + a + (pr() - 0.5) * 5, d = dcc + b + (pr() - 0.5) * 4;
      if (d < 30) continue;
      if (blocked(W, wx, d, 9)) continue;
      const u = pr();
      if (u < 0.62 * (1 - 0.3 * e)) {
        v.houses.push({
          wx, d, w: 9 + 4 * pr(), dep: 7 + 3 * pr(), storeys: pr() < 0.7 ? 2 : 1,
          yaw: (pr() - 0.5) * 0.12 + (pr() < 0.15 ? (pr() < 0.5 ? 1 : -1) * Math.PI / 2 : 0),
          style: Math.floor(pr() * 4), hip: pr() < 0.6, koi: d < 260 && pr() < 0.12,
          seed: hashInts(h, 7, Math.round(a), Math.round(b)),
        });
      } else if (u < 0.84) v.trees.push({ wx, d, type: pr() < 0.4 ? 'persimmon' : pr() < 0.5 ? 'pine' : 'broad', seed: hashInts(h, 9, Math.round(a), Math.round(b)) });
      else v.trees.push({ wx, d, type: 'bamboo', seed: hashInts(h, 11, Math.round(a), Math.round(b)) });
    }
  }
  // bamboo and cedars along the back
  for (let k = 0; k < 5; k++) {
    const wx = cx + (r() - 0.5) * 1.7 * R, d = dcc + Rd * (0.85 + 0.3 * r());
    if (!blocked(W, wx, d, 4)) v.trees.push({ wx, d, type: r() < 0.6 ? 'bamboo' : 'cedar', seed: hashInts(h, 15, k) });
  }
  return v;
}
// Places a house cannot stand: river, levees, road, lake, hillside.
function blocked(W, wx, d, m) {
  if (riverAmt(W, wx) > 0) { const rn = riverN(W, wx); if (d > rn - 14 - m && d < rn + riverW(W, wx) + 14 + m) return true; }
  if (roadOn(W, wx) && Math.abs(d - roadD(W, wx)) < 5 + m) return true;
  if (lakeE(W, wx, d) < 1.35) return true;
  if (d < 760 && hillAt(W, wx, d).hh > 1.5) return true;
  return false;
}
function villageAt(W, wx, d) {
  if (d > 1000) return null;
  const i = Math.floor(wx / VCELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const v = village(W, k);
    if (v && ((wx - v.cx) / (v.R + 8)) ** 2 + ((d - v.dc) / (v.Rd + 8)) ** 2 < 1) return v;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Surfaces (d < 3400): what covers the ground at a world point. Returns a reused object.
// ---------------------------------------------------------------------------------------------
const T = { BANK: 0, ROAD: 1, RIVER: 2, LEVEE: 3, LAKE: 4, SHORE: 5, WOOD: 6, TEA: 7, VILLAGE: 8, PADDY: 9, FUJI: 10 };
const SURF = { t: 0, y: 0, k: 0, j: 0, info: null, edge: 0, farEdge: 0, hh: 0, hill: null, s: 0, v: null };
function surface(W, wx, d) {
  const S = SURF;
  S.y = W.H(wx, d); S.info = null; S.hill = null; S.v = null; S.hh = 0;
  if (d < 9) { S.t = T.BANK; return S; }
  if (d > 40 && d < 160) {
    const ra = riverAmt(W, wx);
    if (ra > 0) {
      const rn = riverN(W, wx), rw = riverW(W, wx);
      const s = Math.max(rn - d, d - rn - rw);
      if (s < 12) { S.s = s; S.t = s < 0 ? T.RIVER : T.LEVEE; if (s < 0) S.y = -1.2; return S; }
    }
  }
  if (d > 120 && d < 1400) {
    const e = lakeE(W, wx, d);
    if (e < 1) { S.t = T.LAKE; S.y = -0.55; S.s = e; return S; }
    if (e < 1.12) { S.t = T.SHORE; return S; }
  }
  if (d > 15 && d < 60 && roadOn(W, wx) && Math.abs(d - roadD(W, wx)) < 2.6) { S.t = T.ROAD; S.s = d - roadD(W, wx); S.y += 0.2; return S; }
  if (d > 40 && d < 760) {
    const hl = hillAt(W, wx, d);
    if (hl.hh > 0.6) {
      S.hh = hl.hh; S.hill = hl.hill;
      S.t = hl.hill.tea && hl.hh > 1.5 && hl.hh < hl.hill.Hh * 0.82 ? T.TEA : T.WOOD;
      return S;
    }
  }
  if (d > 1500) { const fz = fujiAt(W, wx, d); if (fz.h > 4) { S.t = T.FUJI; S.hh = fz.h; return S; } }
  const v = d > 25 && d < 1000 ? villageAt(W, wx, d) : null;
  if (v) { S.t = T.VILLAGE; S.v = v; return S; }
  const k = rowAt(W, d), q = W.rows[k];
  const j = Math.floor((wx + q.off) / q.W);
  S.t = T.PADDY; S.k = k; S.j = j; S.info = panelInfo(W, k, j);
  const x0 = j * q.W - q.off;
  S.farEdge = k + 1 < W.rows.length ? W.rows[k + 1].D - d : 1e9;
  S.edge = Math.min(d - q.D, S.farEdge, wx - x0, x0 + q.W - wx);
  if (S.info.t === P.WATER || S.info.t === P.YOUNG) S.y += 0.05;
  return S;
}
function surfColor(W, S, wx, d, rng) {
  switch (S.t) {
    case T.BANK: return jitter(C.grass, rng, 0.15);
    case T.ROAD: return Math.abs(Math.abs(S.s) - 2.2) < 0.12 ? C.roadLine : jitter(C.road, rng, 0.04);
    case T.RIVER: {
      const st = noise2(wx / 60, d / 2, W.ws + 611);
      return jitter(mix3(mix3(C.river, C.riverDeep, 0.5 * smooth(0, -6, S.s)), [0.66, 0.7, 0.72], smooth(0.75, 0.9, st) * 0.6), rng, 0.02);
    }
    case T.LEVEE: {
      if (S.s < 2) return jitter(C.revet, rng, 0.05);
      if (S.s < 8) return jitter(Math.abs(S.s - 5) < 1.3 ? C.path : C.grass, rng, 0.08);
      return jitter(mix3(C.grass, C.grassDry, 0.3 * noise2(wx / 7, d / 3, W.ws + 612)), rng, 0.1);
    }
    case T.LAKE: {
      const st = noise2(wx / 90, d / (3 + 0.01 * d), W.ws + 613);
      return jitter(mix3(mix3(C.lake, C.lakeDeep, smooth(0.2, 0.9, 1 - S.s)), [0.7, 0.74, 0.77], smooth(0.72, 0.9, st) * 0.6), rng, 0.02);
    }
    case T.SHORE: return jitter(mix3(C.sand, C.grass, smooth(1.03, 1.1, lakeE(W, wx, d))), rng, 0.08);
    case T.WOOD: {
      const cl = noise2(wx / 6, d / 6, W.ws + 614);
      return jitter(mix3(C.wood, C.woodLit, cl), rng, 0.1);
    }
    case T.TEA: return jitter(C.teaPath, rng, 0.1);
    case T.VILLAGE: {
      const g = noise2(wx / 11, d / 9, W.ws + 811);
      return jitter(g > 0.6 ? C.garden : g < 0.28 ? [0.3, 0.4, 0.2] : C.yard, rng, 0.08);
    }
    case T.FUJI: return jitter(mix3(C.fujiLow, C.fujiForest, smooth(5, 120, S.hh)), rng, 0.08);
    default: return paddyColor(W, S, wx, d, rng);
  }
}
function paddyColor(W, S, wx, d, rng) {
  const f = S.info;
  const bw = 0.3 + 0.0025 * d;
  const q = W.rows[S.k];
  if (q.lane && d - q.D < laneW(q.D)) return jitter(C.lane, rng, 0.06);
  if (S.edge < bw) return jitter(rng() < 0.5 ? C.bund : C.bundLit, rng, 0.1);
  let c;
  switch (f.t) {
    case P.WATER: {
      c = mix3(C.water, C.waterDull, 0.3 * noise2(wx / 40, d / 20, W.ws + 525));
      if (S.farEdge < bw * 3 + 0.5) c = mix3(c, C.bund, 0.4);       // the bund beyond, reflected
      c = mul3(c, f.tone);
      break;
    }
    case P.YOUNG: {
      // seedlings in neat rows along the line over the water (lines along x survive the blur)
      const row = d < 80 ? Math.sin(d * 5.2 + f.seed) > 0.1 && rng() < 0.8 : rng() < f.green + 0.1;
      c = row ? jitter(C.youngRice, rng, 0.12) : mul3(C.water, f.tone * 0.96);
      break;
    }
    case P.RICE: c = mul3(C.rice, f.tone * (0.92 + 0.16 * noise2(wx / 3, d / 3, W.ws + 526))); break;
    case P.HOUSE: c = C.gravel; break;
    default: {
      const coord = f.dir ? d * 2.4 : wx;
      c = Math.sin((coord / f.period) * Math.PI * 2) > -0.1 ? C.veg : C.soil;
      c = mul3(c, f.tone);
    }
  }
  return jitter(c, rng, 0.05);
}

// The ground fill: one splat per sample, lying in the surface (so the hills and levees are skinned
// with splats along their slopes, never horizontal smears), the count landing on ctx.count.
//   opts: n, dNear, dFar, power, cover, minR, maxR, tuft (d below which open ground is tufty)
function* fillSurface(ctx, out, W, opts = {}) {
  out.limit = Infinity;
  const n = Math.floor(opts.n != null ? opts.n : out.left());
  if (n <= 0) return;
  const rng = ctx.rng;
  const dn = opts.dNear != null ? opts.dNear : ctx.zNear, df = opts.dFar != null ? opts.dFar : ctx.zFar;
  const L = ctx.length;
  const p = opts.power != null ? opts.power : 1.5, cover = opts.cover || 3;
  const minR = opts.minR || 0.0015, maxR = opts.maxR || 0.08;
  const a1 = 1 - p;
  const A = Math.pow(dn, a1), B = Math.pow(df, a1), Z = (B - A) / a1;
  for (let i = 0; i < n; i++) {
    let d = 0, x = 0, wx = 0, S = null;
    // (a hill's slopes are its skin's, see hillSkin: draw again a few times)
    for (let tr = 0; tr < 4; tr++) {
      d = Math.pow(A + (tr === 0 ? (i + rng()) / n : rng()) * (B - A), 1 / a1);
      x = rng() * L; wx = ctx.x0 + x;
      S = surface(W, wx, d);
      if (!(S.hh > 1.2 && (S.t === T.WOOD || S.t === T.TEA))) break;
    }
    const dens = (n * Math.pow(d, -p) / Z) / L;
    const r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
    let c = surfColor(W, S, wx, d, rng);
    if (opts.hook) c = opts.hook(S, wx, d, c);
    const t = S.t;
    const water = t === T.RIVER || t === T.LAKE || (t === T.PADDY && (S.info.t === P.WATER));
    if (water) { out(x, S.y, -d, r * 1.4, r * 0.05, r * 0.75, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND); }
    else if (t === T.WOOD || t === T.TEA || t === T.LEVEE || t === T.SHORE || t === T.FUJI || (S.hh > 0)) {
      // sloped ground: a disc lying in the surface, shaded from its normal
      const e = Math.max(0.6, r * 0.8), y0 = S.y;
      const hx = (W.H(wx + e, d) - y0) / e, hd = (W.H(wx, d + e) - y0) / e;
      const nn = norm3(-hx, 1, hd);
      let lift = 0;
      if (t === T.WOOD) {
        // the canopy: a lumpy roof of crowns standing on the hill
        lift = canopy(W, wx, d, S.hh);
        c = mul3(c, 0.8 + 0.06 * lift);
      }
      c = shade(c, nn[0], nn[1], nn[2], 0.62, 0.5);
      const q = quatUpTo(nn[0], nn[1], nn[2]);
      const ax = 0.85 + 0.3 * rng();
      out(x, y0 + 0.04 + lift, -d, r * ax, r * 0.14, r * (2 - ax), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND);
    } else {
      const crop = t === T.PADDY && (S.info.t === P.RICE || S.info.t === P.DRY) ? 0.25 : 0;
      const tuft = opts.tuft && d < opts.tuft && (t === T.BANK || t === T.PADDY) ? 1 - d / opts.tuft : 0;
      const ax = 0.8 + 0.5 * rng();
      out(x, S.y + 0.03 + crop + tuft * r * 0.4 * rng(), -d, r * ax, r * (0.12 + 0.3 * tuft), r * (1.8 - ax), c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    }
    if (out.due()) yield;
  }
}

// The woods on a hill: a lumpy roof of crowns standing over it.
function canopy(W, wx, d, hh) { return (4 + 6 * noise2(wx / 8, d / 8, W.ws + 615)) * smooth(0.5, 4, hh); }

// The skin of a hill: a world-anchored grid of discs lying in its surface (on the canopy over its
// woods), spaced from distance so the slopes facing the line are opaque at any budget. The plain
// fill, spread by plan area, would leave a hill that faces the window thin.
function* hillSkin(ctx, out, W, h, dLo, dHi) {
  const sl = clamp((1.3 * h.Hh) / h.rd, 0.25, 1);
  const area = Math.PI * h.rx * h.rd * 0.75;
  let sp = Math.max(0.7, detail(out, h.dc, 2.0));
  sp = Math.max(sp, Math.sqrt(area / sl / (0.6 * ctx.count)));      // never more than 60% of a chunk
  const sd = sp / sl;
  const xa = Math.max(h.wx - h.rx, ctx.x0), xb = Math.min(h.wx + h.rx, ctx.x0 + ctx.length);
  const da = Math.max(h.dc - h.rd, dLo), db = Math.min(h.dc + h.rd * 0.5, dHi);
  if (xb <= xa || db <= da) return;
  const i0 = Math.floor(xa / sp), i1 = Math.floor(xb / sp), j0 = Math.floor(da / sd), j1 = Math.floor(db / sd);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const hs = hashInts(h.seed, i, j);
      const wx = (i + 0.5 + ((hs & 1023) / 1023 - 0.5) * 0.5) * sp, d = (j + 0.5 + (((hs >>> 10) & 1023) / 1023 - 0.5) * 0.5) * sd;
      const x = wx - ctx.x0;
      if (!(x >= 0 && x < ctx.length) || !inD(d, dLo, dHi)) continue;
      const ex = (wx - h.wx) / h.rx, ed = (d - h.dc) / h.rd;
      if (ex * ex + ed * ed > 1) continue;
      const S = surface(W, wx, d);
      if ((S.t !== T.WOOD && S.t !== T.TEA) || S.hill !== h || S.hh < 1.2) continue;
      const wood = S.t === T.WOOD, hh = S.hh, y0 = S.y;
      const e = Math.max(0.8, sp);
      const lift = wood ? canopy(W, wx, d, hh) : 0;
      // (the canopy's rise at the wood's edge is part of the slope the disc must lie in)
      const hx = (W.H(wx + e, d) + (wood ? canopy(W, wx + e, d, hillBump(h, wx + e, d)) : 0) - y0 - lift) / e;
      const hd = (W.H(wx, d + e) + (wood ? canopy(W, wx, d + e, hillBump(h, wx, d + e)) : 0) - y0 - lift) / e;
      const nn = norm3(-hx, 1, hd);
      let c;
      if (wood) {
        const cl = noise2(wx / 5, d / 5, W.ws + 614);
        c = mul3(mix3(C.wood, C.woodLit, cl), 0.8 + 0.06 * lift);
        if (noise2(wx / 23, d / 19, W.ws + 616) > 0.62) c = mix3(c, C.cedar, 0.7);
      } else c = C.teaPath;
      c = jitter(shade(c, nn[0], nn[1], nn[2], 0.55, 0.6), ctx.rng, 0.08);
      const q = quatUpTo(nn[0], nn[1], nn[2]);
      out(x, y0 + 0.05 + lift, -d, sp * 0.78 * Math.sqrt(1 + hx * hx), Math.min(sp, sd) * 0.1, sd * 0.78 * Math.sqrt(1 + hd * hd), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND);
    }
    if (out.due()) yield;
  }
}

// Dense ground strip for the trackside.
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
// Fuji: the cone lattice
// ---------------------------------------------------------------------------------------------
// Rows of the lattice for spacing delta (radians of view): marched down the profile from the summit,
// each step as long as it takes the slope to climb delta in the window (capped on the flat foot).
function coneRows(c, delta) {
  const rho = [], drho = [];
  let r = c.R * c.u0 * 0.5;
  for (let k = 0; k < 4000; k++) {
    const u = r / c.R;
    if (u >= 1) break;
    const hRow = c.H * Math.pow(1 - Math.max(u, c.u0), c.p);
    if (hRow < 18) break;
    const D = c.d - 0.5 * r;
    const hp = u < c.u0 ? 0 : (c.H * c.p * Math.pow(1 - u, c.p - 1)) / c.R;
    const step = Math.min(delta * D / Math.max(hp, 1e-4), 420, Math.max(delta * D * 1.2, Math.min(c.R * c.u0 * 0.9, delta * D * 2.5)));
    rho.push(r); drho.push(step);
    r += step;
  }
  return { rho, drho };
}
// Column step round the cone at row rho, angle th: delta of view at the point's distance.
const colStep = (c, rho, th, delta) => Math.min(0.45, (delta * (c.d - rho * Math.cos(th))) / rho);

// How many lattice points of a group of cones fall in the worst 8 km window, at spacing D0 (cached).
const D0 = 0.006;
function groupLoad(W, key, cones) {
  return cget(W.groups, key, () => {
    let lo = Infinity, hi = -Infinity;
    for (const c of cones) { lo = Math.min(lo, c.wx - c.R); hi = Math.max(hi, c.wx + c.R); }
    const BIN = 250, nb = Math.ceil((hi - lo) / BIN) + 1, bins = new Float64Array(nb);
    for (const c of cones) {
      const { rho, drho } = coneRows(c, D0);
      for (let k = 0; k < rho.length; k++) {
        const rr = rho[k];
        for (const sg of [1, -1]) {
          let th = sg > 0 ? colStep(c, rr, 0, D0) * 0.5 : -colStep(c, rr, 0, D0) * 0.5;
          while (Math.abs(th) < AM) {
            const wx = c.wx + rr * Math.sin(th), d = c.d - rr * Math.cos(th);
            if (d < 14600) bins[Math.floor((wx - lo) / BIN)]++;
            th += sg * colStep(c, rr, th, D0);
          }
        }
      }
    }
    const win = Math.round(8000 / BIN);
    let best = 0, sum = 0;
    for (let b = 0; b < nb; b++) { sum += bins[b]; if (b >= win) sum -= bins[b - win]; best = Math.max(best, sum); }
    return best * D0 * D0;      // lattice points ~ load / delta^2
  });
}
// Is this world point covered by a cone's lattice (so the plain fill should leave it)?
// (the smooth profile is enough here, and much cheaper than the full height)
function inCone(fl, wx, d) {
  if (d < 1500) return false;
  for (const f of fl) {
    const dx = wx - f.wx, dd = f.d - d;
    if (Math.abs(dx) > f.R || Math.abs(dd) > f.R) continue;
    const rho = Math.hypot(dx, dd);
    if (rho >= f.R * 0.97) continue;
    if (f.H * Math.pow(1 - Math.max(rho / f.R, f.u0), f.p) >= 22 && Math.abs(Math.atan2(dx, dd)) < AM) return true;
  }
  return false;
}

// Snow, cinder, forest and the foot, lit from the surface normal against the sun. Pure function.
const FCOL = [0, 0, 0];
function fujiColor(c, h, rho, th, nx, ny, nz, jh, g) {
  const hf = h / c.H;
  const sl = c.snow + 0.05 * (noise1(th * 2.1, c.s + 7) - 0.5) + 0.03 * (noise1(th * 16 + rho / 900, c.s + 12) - 0.5);
  // snow lies longest in the gullies: white fingers running down between dark ridges
  const finger = g * (0.05 + 0.2 * noise1(rho / 500 + th * 5, c.s + 8));
  const bare = (1 - g) * 0.05 * noise1(th * 30 + rho / 220, c.s + 9);
  const sn = smooth(sl - 0.01, sl + 0.01, hf + finger - bare);
  const lit = Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);
  // cinder (ridges a little paler), forest below the tree line, green at the foot
  const tr = (1 - g) * 0.6 + 0.4 * noise1(rho / 250 + th * 9, c.s + 10);
  const tl = 0.58 + 0.05 * (noise1(th * 3.3, c.s + 11) - 0.5);
  const tf = smooth(tl - 0.05, tl + 0.04, hf + 0.03 * g), tlw = smooth(0.01, 0.07, hf);
  const k = 0.36 + 0.9 * lit;
  const aer = 0.2 * (1 - 0.5 * sn) + 0.15 * smooth(0.25, 0.02, hf);
  const ts = smooth(0.12, 0.7, lit);
  const j = (1 + 0.05 * (((jh >>> 20) & 255) / 255 - 0.5));
  for (let i = 0; i < 3; i++) {
    let v = C.fujiRock[i] + (C.fujiRidge[i] - C.fujiRock[i]) * tr;
    v = C.fujiForest[i] + (v - C.fujiForest[i]) * tf;
    v = C.fujiLow[i] + (v - C.fujiLow[i]) * tlw;
    v *= k;
    if (sn > 0) v += (C.snowShade[i] + (C.snow[i] - C.snowShade[i]) * ts - v) * sn;
    v += (C.aerial[i] - v) * aer;
    FCOL[i] = v * j;
  }
  return FCOL;
}

// Draw the cones of a group (a Fuji, and at level 1 its companions), each lattice point in the chunk
// whose x range holds it. y follows the shared terrain, so the foot meets the plain fill.
function* drawCones(ctx, out, W, cones, delta, kind0) {
  const x0 = ctx.x0, L = ctx.length, fl = fujisFor(W, ctx);
  const dMax = ctx.zFar + 590, dMin = ctx.zNear - 40;
  for (let ci = 0; ci < cones.length; ci++) {
    const c = cones[ci], kind = c.surreal ? KIND.SURREAL : kind0;
    if (c.wx + c.R < x0 || c.wx - c.R > x0 + L) continue;
    const { rho, drho } = coneRows(c, delta);
    for (let k = 0; k < rho.length; k++) {
      const rr0 = rho[k], dr = drho[k];
      for (let sg = 1; sg >= -1; sg -= 2) {
        let j = 0;
        let th = sg * colStep(c, rr0, 0, delta) * 0.5;
        while (Math.abs(th) < AM) {
          const dth = colStep(c, rr0, th, delta);
          const thNow = th;
          th += sg * dth;
          j++;
          const xa = c.wx + rr0 * Math.sin(thNow) - x0;
          if (xa < -dr - 60 || xa > L + dr + 60) continue;
          const jh = hashInts(c.s, k, sg * j);
          const rr = rr0 + (((jh & 1023) / 1023) - 0.5) * 0.4 * dr;
          const tt = thNow + ((((jh >>> 10) & 1023) / 1023) - 0.5) * 0.4 * dth;
          const st = Math.sin(tt), ct = Math.cos(tt);
          const wx = c.wx + rr * st, d = c.d - rr * ct;
          const x = wx - x0;
          if (!(x >= 0 && x < L) || d > dMax || d < dMin) continue;
          const h = coneHeight(c, rr, tt), g = LASTG;
          if (h < 16) continue;
          // hidden inside a companion cone?
          let hidden = false;
          for (let o = 0; o < cones.length; o++) {
            if (o === ci) continue;
            const c2 = cones[o], rho2 = Math.hypot(wx - c2.wx, c2.d - d);
            if (rho2 < c2.R && coneHeight(c2, rho2, Math.atan2(wx - c2.wx, c2.d - d)) > h + 15) { hidden = true; break; }
          }
          if (hidden) continue;
          const er = Math.max(4, 0.25 * dr), et = Math.max(0.0005, 0.25 * dth);
          const hr = (coneHeight(c, rr + er, tt) - h) / er, ht = (coneHeight(c, rr, tt + et) - h) / et;
          let nx = -hr * st - (ht * ct) / rr, ny = 1, nz = -hr * ct + (ht * st) / rr;
          const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
          const y = (ctx.flatBase != null ? ctx.flatBase : baseAt(W, wx, d, fl)) + h;
          const col = fujiColor(c, h, rr, tt, nx, ny, nz, jh, g);
          const q = quatUV(ct, 0, -st, nx, ny, nz);       // local x round the cone, y the normal
          const sx = Math.max(0.72 * rr * dth, 1), sz = 0.72 * dr * Math.sqrt(1 + hr * hr);
          // (local z is x cross normal: up and down the slope)
          out(x, y, -d, sx, Math.min(sx, sz) * 0.12, sz, col[0], col[1], col[2], 1, q[0], q[1], q[2], q[3], kind);
          if (out.due()) yield;
        }
      }
    }
  }
}
// quatUV puts local y on the second vector; the disc's thin axis must be the normal, so swap: a
// disc with radii (sx, thin, sz) whose local y is the normal.
// (quatUV(u, n) gives local x = u, local y = n, local z = u x n: exactly that.)

// The cones a Fuji brings: itself, and at level 1 (logic) a smaller twin beside it.
function fujiGroup(W, f, logic) {
  if (!(logic > 0)) return [f];
  return cget(W.misc, 'twin' + f.i, () => {
    const side = h01(f.s, 5, 1) < 0.5 ? -1 : 1;
    const k = 0.5 + 0.08 * h01(f.s, 6, 1);
    const t = makeCone({ ...f, i: f.i + 0.5, wx: f.wx + side * f.R * (0.95 + 0.25 * k), d: f.d + 900, H: f.H * k, R: f.R * k, s: hashInts(f.s, 99), snow: f.snow - 0.06, surreal: true });
    return [f, t];
  });
}
// Small Fujis ringing the horizon at level 1 (logic), clear of the real ones.
const RCELL = 6000;
function ringCone(W, i) {
  return cget(W.misc, 'ring' + i, () => {
    const r = makeRng(hashInts(W.ws, 3101, i));
    const wx = (i + 0.25 + 0.5 * r()) * RCELL;
    const f = fujiNear(W, wx);
    if (r() < 0.35 || (f && Math.abs(f.wx - wx) < f.R + 2600)) return null;
    const H = 700 + 450 * r();
    return makeCone({ i: 1000 + i, wx, d: 12300 + 500 * r(), H, R: H * 2.4, p: 1.6, u0: 0.04, s: hashInts(W.ws, 3102, i), snow: 0.55 + 0.1 * r(), osawa: 9, belt: false, cap: false, bank: false });
  });
}

// Cloud round a Fuji: a belt at its waist, a cap over its summit, or a bank hiding its upper slopes.
// Rounded puffs (no wider than a few times their height) that billow (MOVE.VAPOUR).
function* fujiClouds(ctx, out, W, f, k = 1) {
  if (!f.belt && !f.cap && !f.bank) return;
  const r = makeRng(hashInts(f.s, 77));
  const rhoAt = (hf) => f.R * (1 - Math.pow(hf, 1 / f.p));
  const puff = (wx, y, d, s, op) => {
    const sh = 0.75 + 0.25 * r();
    const c = mix3(C.cloudShade, C.cloud, sh);
    out(wx - ctx.x0, y, -d, s, s * (0.32 + 0.12 * r()), s * 0.7, c[0], c[1], c[2], op, 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
  };
  if (f.belt) {
    const hf = (0.3 + 0.2 * r()) * k, n = 90;
    for (let i = 0; i < n; i++) {
      const th = (i / (n - 1) * 2 - 1) * 1.75 + (r() - 0.5) * 0.05;
      const rr = rhoAt(hf + (r() - 0.5) * 0.04) + 120 + 380 * r();
      const y = f.H * hf * (1 + (r() - 0.5) * 0.12);
      const s = (230 + 260 * r()) * (0.7 + 0.5 * Math.cos(th * 0.6));
      if (r() < 0.82) puff(f.wx + rr * Math.sin(th), y, f.d - rr * Math.cos(th), s, 0.55 + 0.35 * r());
      if (out.due()) yield;
    }
  }
  if (f.cap) {
    // a lens of cloud sitting over the summit
    const cy = f.H * 1.07, cx = f.wx + (r() - 0.5) * 600, Rl = f.R * (0.13 + 0.05 * r());
    for (let i = 0; i < 46; i++) {
      const a = r() * 2 - 1, b = (r() - 0.5) * 1.2;
      const t = 1 - a * a;
      puff(cx + a * Rl, cy + (r() - 0.4) * 140 * t + 40 * (1 - t), f.d + b * Rl * 0.6 * Math.sqrt(t) - 80, 180 + 160 * t * r() + 80, 0.6 + 0.3 * r());
    }
  }
  if (f.bank) {
    for (let i = 0; i < 170; i++) {
      const th = (r() * 2 - 1) * 1.6;
      const hf = 0.22 + 0.5 * Math.pow(r(), 0.8);
      const rr = rhoAt(Math.min(0.95, hf)) + 150 + 500 * r();
      puff(f.wx + rr * Math.sin(th), f.H * hf, f.d - rr * Math.cos(th), 420 + 420 * r(), 0.6 + 0.3 * r());
      if (out.due()) yield;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The far plain: fields, towns and foothills, sampled by distance like karst's fillSurfaceFar,
// leaving the ground a cone's lattice covers.
// ---------------------------------------------------------------------------------------------
function* fillFar(ctx, out, W) {
  out.limit = Infinity;
  const n = out.left();
  const rng = ctx.rng, L = ctx.length, dn = ctx.zNear, df = ctx.zFar;
  const Z = Math.log(df / dn);
  const fl = fujisFor(W, ctx);
  // The terrain and the colour fields, on a grid over the chunk (100 m in x, distance in steps of
  // 2%), interpolated per splat: they change over hundreds of metres, and the sums are dear.
  const GX = 100, NX = Math.ceil(L / GX) + 2, GQ = 1.02, ND = Math.ceil(Math.log((df + 700) / dn) / Math.log(GQ)) + 2;
  const gy = new Float32Array(NX * ND), gc = new Float32Array(NX * ND), gf = new Float32Array(NX * ND), gt = new Float32Array(NX * ND);
  const dOf = (b) => dn * Math.pow(GQ, b);
  for (let a = 0; a < NX; a++) {
    const wx = ctx.x0 + (a - 0.5) * GX;
    for (let b = 0; b < ND; b++) {
      const d = dOf(b);
      let cone = 0;
      for (const f of fl) {
        const dx = wx - f.wx, dd = f.d - d;
        if (Math.abs(dx) >= f.R || Math.abs(dd) >= f.R) continue;
        const rho = Math.hypot(dx, dd);
        if (rho < f.R) cone = Math.max(cone, coneHeight(f, rho, Math.atan2(dx, dd)));
      }
      const k = a * ND + b;
      gy[k] = baseAt(W, wx, d, fl) + cone; gc[k] = cone;
      gf[k] = noise2(wx / 1300, d / 900, W.ws + 1301);
      gt[k] = smooth(0.66, 0.74, noise2(wx / 2300, d / 1500, W.ws + 1302));
    }
    if ((a & 7) === 7) yield;
  }
  const iLogQ = 1 / Math.log(GQ);
  const fld = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    let d = 0, x = 0, wx = 0;
    // (a point on a cone is the lattice's: draw again, and as a last resort at the front of the band)
    let ok = false;
    for (let tr = 0; tr < 8 && !ok; tr++) {
      d = dn * Math.pow(df / dn, tr === 0 ? (i + rng()) / n : rng());
      x = rng() * L; wx = ctx.x0 + x;
      ok = !inCone(fl, wx, d);
    }
    if (!ok) d = dn * (1 + 0.04 * rng());
    const dens = (n / d / Z) / L;
    const r = clamp(Math.sqrt(2.8 / (Math.PI * dens)), 0.0012 * d, 0.03 * d);
    // bilinear lookups, and the slope from the cell's corners
    const fa = x / GX + 0.5, a0 = Math.min(NX - 2, Math.floor(fa)), ua = fa - a0;
    const fb = Math.log(d / dn) * iLogQ, b0 = Math.min(ND - 2, Math.max(0, Math.floor(fb))), ub = fb - b0;
    const k00 = a0 * ND + b0, k10 = k00 + ND, k01 = k00 + 1, k11 = k10 + 1;
    const bil = (g) => (g[k00] * (1 - ua) + g[k10] * ua) * (1 - ub) + (g[k01] * (1 - ua) + g[k11] * ua) * ub;
    const y = bil(gy), cone = bil(gc);
    const dd = dOf(b0 + 1) - dOf(b0);
    const sx = ((gy[k10] - gy[k00]) * (1 - ub) + (gy[k11] - gy[k01]) * ub) / GX;
    const sd = ((gy[k01] - gy[k00]) * (1 - ua) + (gy[k11] - gy[k10]) * ua) / dd;
    let nx = -sx, ny = 1, nz = sd;
    const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
    let c0, c1, c2;
    if (cone > 4) { const t = smooth(4, 200, cone); c0 = lerp(C.fujiLow[0], C.fujiForest[0], t); c1 = lerp(C.fujiLow[1], C.fujiForest[1], t); c2 = lerp(C.fujiLow[2], C.fujiForest[2], t); }
    else {
      const t = bil(gf);
      c0 = lerp(C.farField[0], C.farField2[0], t); c1 = lerp(C.farField[1], C.farField2[1], t); c2 = lerp(C.farField[2], C.farField2[2], t);
      const town = bil(gt);
      if (town > 0 && rng() < town * 0.8) { const k = 0.85 + 0.3 * rng(); c0 = C.farTown[0] * k; c1 = C.farTown[1] * k; c2 = C.farTown[2] * k; }
      const hl = smooth(10, 70, y);
      c0 = lerp(c0, C.farHill[0], hl); c1 = lerp(c1, C.farHill[1], hl); c2 = lerp(c2, C.farHill[2], hl);
    }
    const lit = (0.45 + 0.7 * Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2])) * (0.95 + 0.1 * rng());
    fld[0] = c0 * lit; fld[1] = c1 * lit; fld[2] = c2 * lit;
    // quatUpTo, inline
    const w = 1 + ny, ql = Math.hypot(nz, nx, w);
    out(x, y, -d, r * 1.2, r * 0.15, r * 0.7, fld[0], fld[1], fld[2], 1, nz / ql, 0, -nx / ql, w / ql, KIND.GROUND);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// More layout: shrines (on hills), temples, the golf range, platforms, the mid-distance hamlets
// ---------------------------------------------------------------------------------------------
const TCELL = 4300;
function templeSite(W, i) {
  return cget(W.misc, 't' + i, () => {
    const r = makeRng(hashInts(W.ws, 1401, i));
    if (r() > 0.55) return null;
    const wx = (i + 0.2 + 0.6 * r()) * TCELL, d = 120 + 650 * Math.pow(r(), 1.4);
    if (blocked(W, wx, d, 30) || villageAt(W, wx, d)) return null;
    return { i, wx, d, H: 30 + 6 * r(), side: r() < 0.5 ? -1 : 1, seed: hashInts(W.ws, 1402, i) };
  });
}
function templeAt(W, wx, d) {
  if (d < 90 || d > 900) return null;
  const i0 = Math.floor(wx / TCELL);
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const t = templeSite(W, i);
    if (t && Math.abs(wx - t.wx - t.side * 12) < 48 && Math.abs(d - t.d - 4) < 26) return t;
  }
  return null;
}
const GCELL = 6400;
function golfSite(W, i) {
  return cget(W.misc, 'g' + i, () => {
    const r = makeRng(hashInts(W.ws, 1501, i));
    if (r() > 0.3) return null;
    const wx = (i + 0.2 + 0.5 * r()) * GCELL, d = 150 + 90 * r(), len = 120 + 70 * r(), deep = 70 + 40 * r();
    for (let u = 0; u <= 1; u += 0.25) if (blocked(W, wx + u * len, d, 8) || blocked(W, wx + u * len, d + deep, 8)) return null;
    return { wx, d, len, deep, H: 28 + 10 * r(), seed: hashInts(W.ws, 1502, i) };
  });
}
const PFCELL = 3600;
function platformSite(W, i) {
  return cget(W.misc, 'p' + i, () => {
    const r = makeRng(hashInts(W.ws, 1701, i));
    if (r() > 0.4) return null;
    return { x0: (i + 0.1 + 0.5 * r()) * PFCELL, len: 110 + 60 * r(), seed: hashInts(W.ws, 1702, i) };
  });
}
const HMCELL = 650;
function hamlet(W, i) {
  return cget(W.misc, 'm' + i, () => {
    const r = makeRng(hashInts(W.ws, 1801, i));
    if (r() > 0.5) return null;
    const cx = (i + 0.2 + 0.6 * r()) * HMCELL, dc = 750 + 2000 * r();
    if (lakeE(W, cx, dc) < 2) return null;
    const n = 5 + Math.floor(14 * r()), R = 40 + 60 * r(), houses = [];
    for (let k = 0; k < n; k++) houses.push({ wx: cx + (r() - 0.5) * 2 * R, d: dc + (r() - 0.5) * R, w: 9 + 4 * r(), dep: 7 + 3 * r(), yaw: (r() - 0.5) * 0.2, style: Math.floor(r() * 4), seed: hashInts(W.ws, 1802, i, k) });
    return { cx, dc, R, houses };
  });
}

// ---------------------------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------------------------
// A local frame at (x, base, d) turned by yaw: lz points out of the front (toward the line at yaw 0).
function frame(x, base, d, yaw) {
  const ex = Math.cos(yaw), ez = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
  return {
    ex, ez, fx, fz,
    P: (lx, ly, lz) => [x + ex * lx + fx * lz, base + ly, -d + ez * lx + fz * lz],
    V: (lx, ly, lz) => { const v = [ex * lx + fx * lz, ly, ez * lx + fz * lz]; const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; },
  };
}
// Fill a parallelogram with discs on a jittered grid: o corner, u and v unit edge directions, lu and lv
// their lengths. colorAt(a, b) -> [r,g,b], null (skip) or { c, light } (a lit window).
function* quad(out, o, u, v, lu, lv, s, colorAt, kind, rng, move = 0) {
  const q = quatUV(u[0], u[1], u[2], v[0], v[1], v[2]);
  const nu = Math.max(1, Math.round(lu / (s * 1.45))), nv = Math.max(1, Math.round(lv / (s * 1.45)));
  const su = (lu / nu) * 0.66, sv = (lv / nv) * 0.66, th = Math.min(su, sv) * 0.12;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = (i + 0.5 + (rng() - 0.5) * 0.25) / nu, b = (j + 0.5 + (rng() - 0.5) * 0.25) / nv;
      let c = colorAt(a, b);
      if (!c) continue;
      let k = kind;
      if (c.light) { k = KIND.LIGHT; c = c.c; }
      out(o[0] + u[0] * a * lu + v[0] * b * lv, o[1] + u[1] * a * lu + v[1] * b * lv, o[2] + u[2] * a * lu + v[2] * b * lv, su, sv, th, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], k, move);
    }
    if (out.due()) yield;
  }
}
// A trapezoid (a roof slope, a hip end): width lu0 at the o edge, lu1 (centred) at the far edge.
function* trap(out, o, u, v, lu0, lu1, lv, s, col, kind, rng) {
  const q = quatUV(u[0], u[1], u[2], v[0], v[1], v[2]);
  const nv = Math.max(1, Math.round(lv / (s * 1.45))), sv = (lv / nv) * 0.66;
  for (let j = 0; j < nv; j++) {
    const b = (j + 0.5) / nv, wb = lu0 + (lu1 - lu0) * b, off = (lu0 - wb) / 2;
    const nu = Math.max(1, Math.round(wb / (s * 1.45))), su = (wb / nu) * 0.66;
    for (let i = 0; i < nu; i++) {
      const a = off + ((i + 0.5 + (rng() - 0.5) * 0.2) / nu) * wb;
      const c = jitter(j === 0 ? mul3(col, 0.72) : col, rng, 0.05);
      out(o[0] + u[0] * a + v[0] * b * lv, o[1] + u[1] * a + v[1] * b * lv, o[2] + u[2] * a + v[2] * b * lv, su, sv, Math.min(su, sv) * 0.12, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind);
    }
    if (out.due()) yield;
  }
}
// Shade a roof colour by the slope's normal (u x v, turned to face up).
function roofTone(c, u, v, k = 1) {
  let nx = u[1] * v[2] - u[2] * v[1], ny = u[2] * v[0] - u[0] * v[2], nz = u[0] * v[1] - u[1] * v[0];
  if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
  return mul3(shade(c, nx, ny, nz, 0.55, 0.55), k);
}
// A hipped (yosemune) or gabled (kirizuma) roof over a w x dep box whose walls are hh tall.
function* roof(out, F, w, dep, hh, rh, hip, col, s, kind, rng) {
  const ov = 0.6, W2 = w + 2 * ov, D2 = dep + 2 * ov;
  const Lr = hip ? Math.max(0.6, W2 - D2) : W2;
  const lv = Math.hypot(rh, D2 / 2);
  const uF = F.V(1, 0, 0), vF = F.V(0, rh, -D2 / 2), uB = F.V(-1, 0, 0), vB = F.V(0, rh, D2 / 2);
  yield* trap(out, F.P(-W2 / 2, hh, D2 / 2), uF, vF, W2, Lr, lv, s, roofTone(col, uF, vF), kind, rng);
  yield* trap(out, F.P(W2 / 2, hh, -D2 / 2), uB, vB, W2, Lr, lv, s, roofTone(col, uB, vB, 0.9), kind, rng);
  const rs = Math.max(0.12, s * 0.55), dark = C.tileDark;
  if (hip) {
    const run = (W2 - Lr) / 2, le = Math.hypot(run, rh);
    for (const sg of [-1, 1]) {
      const u = F.V(0, 0, sg), v = F.V(sg * run, rh, 0);
      yield* trap(out, F.P(-sg * W2 / 2, hh, -sg * D2 / 2), u, F.V(-sg * -run, rh, 0), D2, 0, le, s, roofTone(col, u, F.V(sg * run, rh, 0), sg > 0 ? 1.05 : 0.85), kind, rng);
      void v;
      // the hip ridges, dark lines from the eave corners to the ridge ends
      for (const sz of [-1, 1]) {
        const a = F.P(-sg * W2 / 2, hh + 0.08, sz * D2 / 2), b = F.P(-sg * Lr / 2, hh + rh + 0.1, 0);
        strut(out, a[0], a[1], a[2], b[0], b[1], b[2], rs * 0.8, dark, Math.max(2, Math.round(le / (rs * 4))), 1, kind);
      }
    }
  } else {
    // gable verges
    for (const sg of [-1, 1]) for (const sz of [-1, 1]) {
      const a = F.P(sg * W2 / 2, hh, sz * D2 / 2), b = F.P(sg * W2 / 2, hh + rh + 0.05, 0);
      strut(out, a[0], a[1], a[2], b[0], b[1], b[2], rs * 0.8, dark, Math.max(2, Math.round(lv / (rs * 4))), 1, kind);
    }
  }
  // the ridge, its ends raised (onigawara)
  const a = F.P(-Lr / 2 - 0.2, hh + rh + 0.12, 0), b = F.P(Lr / 2 + 0.2, hh + rh + 0.12, 0);
  strut(out, a[0], a[1], a[2], b[0], b[1], b[2], rs * 1.2, dark, Math.max(2, Math.round(Lr / (rs * 4))), 1, kind);
  for (const sg of [-1, 1]) { const e = F.P(sg * (Lr / 2 + 0.1), hh + rh + 0.45, 0); out(e[0], e[1], e[2], rs * 1.2, 0.35, rs * 1.2, dark[0], dark[1], dark[2], 1, 0, 0, 0, 1, kind); }
}

// A Japanese house: walls of dark timber, white plaster or modern siding, sliding windows, a grey
// kawara roof (hipped or gabled), and on two storeys a narrow tiled skirt over the ground floor.
// All four walls and every roof slope are drawn, so it reads from either side of a pass.
//   o: { w, dep, storeys, yaw, style, hip, y, s, rng, lit, seed, roofCol, kind, windows }
const STYLES = [
  { wall: C.timber, upper: C.plaster }, { wall: C.timber, upper: C.timber },
  { wall: [0.72, 0.7, 0.64], upper: [0.72, 0.7, 0.64] }, { wall: [0.52, 0.55, 0.57], upper: [0.52, 0.55, 0.57] },
];
function* jhouse(ctx, out, x, d, o) {
  const rng = o.rng, w = o.w, dep = o.dep, st = o.storeys || 1;
  const h = st * 2.8 + 0.2, hh = h + 0.3, rh = dep * (o.hip ? 0.3 : 0.34);
  const F = frame(x, o.y - 0.3, d, o.yaw || 0);
  const s = o.s, kind = o.kind != null ? o.kind : KIND.BUILDING, lit = o.lit || 0;
  const sty = STYLES[o.style || 0];
  const lightOf = (i, j) => lit > 0 && h01(o.seed | 0, i, j) < lit;
  const wantWin = o.windows !== false;
  const wallAt = (tone, toneU, cols, face) => (a, b) => {
    const y = b * hh;
    if (y > hh - 0.35) return mul3(tone, 0.45);                     // shadow under the eaves
    if (y < 0.4) return mul3(C.stone, 0.7);                          // foundation
    const t = y > 3.0 ? toneU : tone;
    if (st > 1 && Math.abs(y - 3.05) < 0.14) return mul3(t, 0.55);
    if (wantWin && cols > 0) {
      const fl = (y - 0.4) / 2.8, iy = fl - Math.floor(fl), row = Math.floor(fl);
      const fxx = a * cols, ix = fxx - Math.floor(fxx), col = Math.floor(fxx);
      if (ix > 0.18 && ix < 0.82 && iy > 0.22 && iy < 0.78) return lightOf(row + face * 10, col) ? { c: LIT, light: true } : (face === 0 && row === 0 && col === 1 ? mul3(C.timber, 0.8) : C.glass);
    }
    return jitter(t, rng, 0.03);
  };
  const cols = Math.max(2, Math.floor(w / 2.4));
  const X = F.V(1, 0, 0), Y = [0, 1, 0];
  yield* quad(out, F.P(-w / 2, 0, dep / 2), X, Y, w, hh, s, wallAt(faceTone(sty.wall, F.fx, F.fz), faceTone(sty.upper, F.fx, F.fz), cols, 0), kind, rng);
  yield* quad(out, F.P(w / 2, 0, -dep / 2), F.V(-1, 0, 0), Y, w, hh, s, wallAt(faceTone(sty.wall, -F.fx, -F.fz), faceTone(sty.upper, -F.fx, -F.fz), cols, 1), kind, rng);
  for (const sg of [-1, 1]) {
    const tone = faceTone(sty.wall, sg * F.ex, sg * F.ez), toneU = faceTone(sty.upper, sg * F.ex, sg * F.ez);
    const fill = wallAt(tone, toneU, 1, 2 + sg);
    const top = o.hip ? hh : hh + rh;
    yield* quad(out, F.P(sg * w / 2, 0, sg * dep / 2), F.V(0, 0, -sg), Y, dep, top, s, (a, b) => {
      const y = b * top;
      if (y > hh) { if (Math.abs(a - 0.5) * 2 > 1 - (y - hh) / rh) return null; return mul3(toneU, 0.92); }
      return fill(a, y / hh);
    }, kind, rng);
  }
  const rc = o.roofCol || C.tile;
  if (st > 1) {
    // the skirt roof over the ground floor, front and both ends
    const sc = roofTone(rc, X, F.V(0, 0.45, -0.9));
    yield* quad(out, F.P(-w / 2 - 0.3, 2.95, dep / 2 + 0.85), X, F.V(0, 0.45, -0.9), w + 0.6, 1.0, s, () => jitter(sc, rng, 0.05), kind, rng);
    for (const sg of [-1, 1]) {
      const u = F.V(0, 0, -1), v = F.V(-sg * 0.9, 0.45, 0);
      yield* quad(out, F.P(sg * (w / 2 + 0.85), 2.95, dep / 2 + 0.3), u, v, dep + 0.6, 1.0, s, () => jitter(roofTone(rc, u, v), rng, 0.05), kind, rng);
    }
  }
  yield* roof(out, F, w, dep, hh, rh, o.hip, rc, s, kind, rng);
}

// A torii: two vermilion pillars with black feet, the tie beam (nuki) through them, and the black
// top lintel (kasagi) over a vermilion one, its ends swept up. Struts throughout (round, so the gate
// reads from any angle). H is the height to the top of the lintel.
// A thick straight member: like kit strut() but with its pieces overlapping, so a pillar a few
// pixels wide reads as one solid round beam, not a row of beads.
function beam(out, ax, ay, az, bx, by, bz, r, c, n, alpha, kind) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1e-6;
  const q = quatXTo(dx / len, dy / len, dz / len), sl = (len / n) * 0.62;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    out(ax + dx * t, ay + dy * t, az + dz * t, Math.max(sl, r), r, r, c[0], c[1], c[2], alpha, q[0], q[1], q[2], q[3], kind);
  }
}
function* torii(ctx, out, x, y0, d, H, kind = KIND.BUILDING, minR = 0) {
  const span = H * 0.62, r = Math.max(H * 0.04, minR), z = -d;
  const segs = (len, rr) => clamp(Math.ceil(len / (rr * 2.2)), 2, 120);
  const strut = beam;
  for (const sg of [-1, 1]) {
    const xb = x + sg * span * 0.53, xt = x + sg * span * 0.5;
    strut(out, xb, y0 - 0.2, z, xt, y0 + H * 0.84, z, r, C.vermilion, segs(H * 0.84, r), 1, kind);
    strut(out, xb, y0 - 0.2, z, xb, y0 + H * 0.1, z, r * 1.18, C.black, segs(H * 0.12, r), 1, kind);
  }
  strut(out, x - span * 0.66, y0 + H * 0.66, z, x + span * 0.66, y0 + H * 0.66, z, r * 0.62, C.vermilion, segs(span * 1.3, r * 0.62), 1, kind);
  strut(out, x, y0 + H * 0.66, z, x, y0 + H * 0.84, z, r * 0.5, C.vermilion, 2, 1, kind);
  strut(out, x - span * 0.7, y0 + H * 0.85, z, x + span * 0.7, y0 + H * 0.85, z, r * 0.7, C.vermilion, segs(span * 1.4, r * 0.7), 1, kind);
  // the kasagi: straight in the middle, rising toward its ends
  const yk = y0 + H * 0.93, rk = r * 0.78;
  strut(out, x - span * 0.46, yk, z, x + span * 0.46, yk, z, rk, C.black, segs(span * 0.92, rk), 1, kind);
  for (const sg of [-1, 1]) strut(out, x + sg * span * 0.46, yk, z, x + sg * span * 0.86, yk + H * 0.07, z, rk, C.black, segs(span * 0.4, rk), 1, kind);
  if (out.due()) yield;
}

// A stone lantern (toro): plinth, post, platform, fire box (lit by night), wide cap and finial.
function* lantern(ctx, out, x, y0, d, night, k = 1.2) {
  const z = -d, c = C.stone, kb = KIND.BUILDING;
  const t = (u, v) => shade(c, 0, u, v, 0.6, 0.45);
  const e = (yy, rx, ry, col, kind = kb) => out(x, y0 + yy * k, z, rx * k, ry * k, rx * k, col[0], col[1], col[2], 1, 0, 0, 0, 1, kind);
  e(0.12, 0.42, 0.12, t(0.3, 1));
  strut(out, x, y0 + 0.2 * k, z, x, y0 + 1.0 * k, z, 0.13 * k, t(0, 1), 2, 1, kb);
  e(1.05, 0.34, 0.07, t(0.6, 0.8));
  if (night) { e(1.3, 0.2, 0.18, [1, 0.74, 0.4], KIND.LIGHT); out(x, y0 + 1.3 * k, z + 0.05, 0.9, 0.9, 0.3, 1, 0.74, 0.4, 0.14, 0, 0, 0, 1, KIND.LIGHT); }
  else e(1.3, 0.22, 0.19, t(0.1, 1));
  e(1.58, 0.5, 0.1, t(0.8, 0.6));
  e(1.68, 0.3, 0.08, mul3(c, 0.6));
  e(1.84, 0.08, 0.1, t(0.5, 0.8));
}

// A five-storey pagoda: square tiers of vermilion and white under deep dark eaves, each roof a hip
// frustum on all four sides with its underside in shadow, and a bronze spire of nine rings.
//   o: { H, tiers, s, kind, rng }
function* pagoda5(ctx, out, x, d, y0, o) {
  const tiers = o.tiers || 5, H = o.H, s = o.s, kind = o.kind || KIND.BUILDING, rng = o.rng;
  const spire = H * (tiers > 8 ? 0.08 : 0.26), body = H - spire;
  const B0 = Math.min(H * 0.2, 8);
  const tierH = body / (tiers * 1.12 + 0.3);
  const plat = frame(x, y0, d, 0);
  // the stone platform
  for (let k = 0; k < 4; k++) {
    const F = frame(x, y0 - 0.5, d, k * Math.PI / 2);
    yield* quad(out, F.P(-B0 * 0.75, 0, B0 * 0.75), F.V(1, 0, 0), [0, 1, 0], B0 * 1.5, 1.3, s, () => jitter(faceTone(C.stone, F.fx, F.fz), rng, 0.04), kind, rng);
  }
  void plat;
  let y = y0 + 0.8;
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const bw = B0 * (1 - 0.42 * f), bwn = B0 * (1 - 0.42 * (t + 1) / tiers);
    const th = tierH * (t === 0 ? 1.15 : 0.9);
    const ew = bw / 2 + bw * 0.5 * (1 - 0.2 * f), rise = Math.max(0.6, tierH * 0.32);
    for (let k = 0; k < 4; k++) {
      const F = frame(x, y, d, k * Math.PI / 2);
      const tone = faceTone(C.vermilion, F.fx, F.fz), wt = faceTone(C.plaster, F.fx, F.fz);
      yield* quad(out, F.P(-bw / 2, 0, bw / 2), F.V(1, 0, 0), [0, 1, 0], bw, th, s, (a, b) => {
        if (b > 0.72) return wt;                                                     // white band under the eaves
        if (Math.abs(a - 0.5) < 0.17 && b < 0.62) return mul3(C.timber, 0.7);         // the door
        return Math.abs(a - 0.5) > 0.45 ? mul3(tone, 0.8) : tone;
      }, kind, rng);
      // the roof slope on this side, and the shadowed underside of the eave
      const u = F.V(1, 0, 0), v = F.V(0, rise, -(ew - bwn / 2));
      yield* trap(out, F.P(-ew, th, ew), u, v, 2 * ew, bwn, Math.hypot(rise, ew - bwn / 2), s, roofTone(C.tile, u, v), kind, rng);
      yield* trap(out, F.P(-ew, th - 0.08, ew), u, F.V(0, 0, -1), 2 * ew, bw, ew - bw / 2, s, mul3(C.timber, 0.55), kind, rng);
    }
    y += th + rise * 0.8;
  }
  // the spire (sorin) and its rings
  const rs = Math.max(0.14, B0 * 0.035, s * 0.4);
  strut(out, x, y - 0.2, -d, x, y + spire, -d, rs, [0.3, 0.25, 0.18], Math.max(3, Math.round(spire / (rs * 4))), 1, kind);
  for (let k = 0; k < 9; k++) out(x, y + spire * (0.25 + 0.06 * k), -d, rs * 2.6, rs * 0.5, rs * 2.6, 0.34, 0.28, 0.2, 1, 0, 0, 0, 1, kind);
  out(x, y + spire, -d, rs * 1.6, rs * 2, rs * 1.6, 0.4, 0.33, 0.2, 1, 0, 0, 0, 1, kind);
}

// Trees
function* cherry(ctx, out, x, d, y0, rng, k = 1) {
  const H = (6 + 3 * rng()) * k, Wc = H * (1.35 + 0.3 * rng());
  const tr = Math.max(0.18, 0.0006 * d) * k;
  const lean = (rng() - 0.5) * 0.8;
  strut(out, x, y0 - 0.2, -d, x + lean, y0 + H * 0.4, -d, tr, C.bark, 3, 1, KIND.TREE);
  for (const sg of [-1, 1]) strut(out, x + lean, y0 + H * 0.4, -d, x + lean + sg * Wc * 0.28, y0 + H * 0.66, -d - (rng() - 0.5), tr * 0.7, C.bark, 2, 1, KIND.TREE);
  const n = Math.max(6, Math.round(treeSplats(out, d, Wc) * 1.1));
  const lumps = n < 30 ? 1 : 4;
  for (let i = 0; i < lumps; i++) {
    const f = lumps === 1 ? 0 : i / (lumps - 1) - 0.5;
    const lx = x + lean + f * Wc * 0.55, ly = y0 + H * (0.7 - Math.abs(f) * 0.15), ld = d + (rng() - 0.5) * Wc * 0.2;
    const lr = Wc * (lumps === 1 ? 0.5 : 0.32);
    yield* blob(ctx, out, lx, ly, ld, lr, lr * 0.62, lr * 0.85, { n: Math.round(n / lumps), color: mix3(C.cherry, C.cherryDeep, 0.35 * rng()), rng, inner: 0.25, amb: 0.72, clump: 0.55 });
  }
}
function* persimmon(ctx, out, x, d, y0, rng) {
  const H = 5 + 2.5 * rng(), Wc = H * 0.85;
  const tr = Math.max(0.16, 0.0006 * d);
  strut(out, x, y0 - 0.2, -d, x + 0.3, y0 + H * 0.45, -d, tr, C.bark, 3, 1, KIND.TREE);
  const n = Math.max(6, Math.round(treeSplats(out, d, Wc) * 0.8));
  const cy = y0 + H * 0.68;
  yield* blob(ctx, out, x + 0.3, cy, d, Wc * 0.5, H * 0.32, Wc * 0.45, { n, color: [0.2, 0.25, 0.11], rng, inner: 0.35, opacity: 0.9 });
  // the fruit, hanging all over the crown
  const m = 26 + Math.floor(rng() * 20), fr = Math.max(0.13, detail(out, d, 0.45));
  for (let i = 0; i < m; i++) {
    let ux = rng() * 2 - 1, uy = rng() * 2 - 1, uz = rng() * 2 - 1;
    const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    if (uz < 0 && rng() < 0.6) uz = -uz;
    const c = shade(C.persimmon, ux, uy, uz, 0.7, 0.4);
    out(x + 0.3 + ux * Wc * 0.5, cy + uy * H * 0.3, -(d - uz * Wc * 0.45), fr, fr, fr, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.TREE);
  }
}
function* pine(ctx, out, x, d, y0, rng) {
  const H = 6 + 5 * rng(), lean = (rng() - 0.5) * 3;
  const tr = Math.max(0.15, 0.0006 * d);
  strut(out, x, y0 - 0.2, -d, x + lean * 0.5, y0 + H * 0.5, -d, tr, [0.24, 0.18, 0.14], 2, 1, KIND.TREE);
  strut(out, x + lean * 0.5, y0 + H * 0.5, -d, x + lean, y0 + H * 0.85, -d, tr * 0.8, [0.24, 0.18, 0.14], 2, 1, KIND.TREE);
  const pads = 3 + Math.floor(rng() * 3), n = Math.max(4, Math.round(treeSplats(out, d, H * 0.6) * 0.5));
  for (let i = 0; i < pads; i++) {
    const t = 0.45 + 0.55 * (i / (pads - 1 || 1));
    const px = x + lean * t + (rng() - 0.5) * H * 0.5, py = y0 + H * t + 0.3, rr = H * (0.26 - 0.1 * t) + 0.6;
    yield* blob(ctx, out, px, py, d + (rng() - 0.5) * 1.5, rr, rr * 0.3, rr * 0.8, { n: Math.round(n / pads) + 3, color: C.pine, rng, inner: 0.4, amb: 0.55 });
  }
}
function* treeOf(ctx, out, t, d, y, rng) {
  const x = t.wx - ctx.x0;
  switch (t.type) {
    case 'bamboo': yield* bamboo(ctx, out, x, d, { rng, height: 9 + 5 * rng(), width: 5 + 5 * rng(), y }); break;
    case 'persimmon': yield* persimmon(ctx, out, x, d, y, rng); break;
    case 'pine': yield* pine(ctx, out, x, d, y, rng); break;
    case 'cherry': yield* cherry(ctx, out, x, d, y, rng); break;
    case 'cedar': yield* conifer(ctx, out, x, d, { rng, height: 18 + 9 * rng(), width: 4.5 + 2 * rng(), color: C.cedar, y }); break;
    default: {
      const H = 8 + 5 * rng();
      yield* blob(ctx, out, x, y + H * 0.62, d, H * 0.45, H * 0.36, H * 0.4, { n: Math.max(6, treeSplats(out, d, H * 0.9)), color: jitter([0.15, 0.25, 0.11], rng, 0.1), rng, inner: 0.4 });
      if (treeSplats(out, d, H) > 20) strut(out, x, y - 0.2, -d, x, y + H * 0.4, -d, Math.max(0.15, 0.0006 * d), C.bark, 2, 1, KIND.TREE);
    }
  }
}

// Carp streamers (koinobori) on a tall pole: the five-coloured streamer, then a black carp, a red one
// and a blue one, blowing out along the line (MOVE.FLAG). k scales the whole thing.
function* koinobori(ctx, out, x, y0, d, seed, k = 1, kind = KIND.OTHER) {
  const r = makeRng(seed);
  const Hp = (10 + 3 * r()) * k, dir = r() < 0.5 ? 1 : -1, z = -d;
  strut(out, x, y0 - 0.2, z, x, y0 + Hp, z, Math.max(0.1 * k, 0.0005 * d), [0.7, 0.7, 0.68], Math.max(3, Math.round(Hp / 2)), 1, kind);
  out(x, y0 + Hp + 0.2 * k, z, 0.2 * k, 0.2 * k, 0.2 * k, 0.8, 0.64, 0.2, 1, 0, 0, 0, 1, kind);
  const fish = [
    { len: 5.2, c: [0.8, 0.8, 0.78], stripes: true },
    { len: 5.5, c: [0.09, 0.09, 0.12] }, { len: 4.4, c: [0.78, 0.15, 0.1] }, { len: 3.6, c: [0.12, 0.26, 0.64] },
  ];
  let y = y0 + Hp - 0.5 * k;
  for (const f of fish) {
    const L = f.len * k, n = 7, ph = r() * 6;
    const rb = 0.42 * k * (f.len / 5.5);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = x + dir * (0.3 * k + t * L), py = y - 0.12 * L * t * t + 0.12 * k * Math.sin(t * 5 + ph);
      const rr = rb * (f.stripes ? 0.6 : 1 - 0.45 * t);
      let c = f.c;
      if (f.stripes) c = [[0.12, 0.3, 0.7], [0.78, 0.15, 0.1], [0.8, 0.8, 0.78], [0.14, 0.5, 0.2], [0.8, 0.66, 0.1]][i % 5];
      else if (i % 2) c = mul3(c, 0.8);
      out(px, py, z, L / n * 0.72, rr, rr * 0.9, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind, MOVE.FLAG);
    }
    if (!f.stripes) {
      // eyes either side of the head, and the forked tail
      for (const sz of [-1, 1]) out(x + dir * (0.55 * k), y + 0.05 * k, z + sz * rb * 0.85, rb * 0.32, rb * 0.32, rb * 0.12, 0.8, 0.8, 0.78, 1, 0, 0, 0, 1, kind, MOVE.FLAG);
      for (const sy of [-1, 1]) out(x + dir * (0.3 * k + L * 1.02), y - 0.12 * L + sy * rb * 0.45, z, L * 0.08, rb * 0.42, rb * 0.15, f.c[0], f.c[1], f.c[2], 1, 0, 0, 0, 1, kind, MOVE.FLAG);
    }
    y -= 1.35 * k;
  }
  if (out.due()) yield;
}

// A bank of vending machines facing the line: lit display fronts (lights, day and night) over a
// dark dispensing slot, painted bodies on the sides and top.
function* vending(ctx, out, x, y0, d, seed) {
  const r = makeRng(seed), n = 2 + Math.floor(r() * 3), z = -d, kb = KIND.BUILDING;
  const bodies = [[0.72, 0.1, 0.08], [0.1, 0.25, 0.6], [0.76, 0.76, 0.74], [0.14, 0.45, 0.22], [0.76, 0.76, 0.74]];
  const goods = [[1, 0.5, 0.4], [0.55, 0.8, 1], [1, 0.97, 0.7], [1, 0.75, 0.4], [0.6, 1, 0.7]];
  for (let k = 0; k < n; k++) {
    const bx = x + (k - (n - 1) / 2) * 1.08, body = bodies[Math.floor(r() * bodies.length)];
    // the front: display window with rows of goods (all light), slot below
    for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) {
      const lit = j > 0;
      const c = lit ? (r() < 0.55 ? [0.9, 0.97, 1] : goods[Math.floor(r() * goods.length)]) : mul3(body, 0.8);
      out(bx - 0.32 + i * 0.32, y0 + 0.35 + j * 0.42, z + 0.42, 0.17, 0.22, 0.04, c[0], c[1], c[2], 1, 0, 0, 0, 1, lit ? KIND.LIGHT : kb);
    }
    out(bx, y0 + 0.1, z + 0.42, 0.5, 0.14, 0.04, 0.12, 0.12, 0.13, 1, 0, 0, 0, 1, kb);
    // sides, back and top in the body colour
    for (const sx of [-1, 1]) for (let j = 0; j < 4; j++) {
      const c = faceTone(body, sx, 0);
      out(bx + sx * 0.5, y0 + 0.25 + j * 0.45, z, 0.04, 0.26, 0.4, c[0], c[1], c[2], 1, 0, 0, 0, 1, kb);
    }
    for (let j = 0; j < 4; j++) { const c = mul3(body, 0.6); out(bx, y0 + 0.25 + j * 0.45, z - 0.4, 0.5, 0.26, 0.04, c[0], c[1], c[2], 1, 0, 0, 0, 1, kb); }
    const ct = shade(body, 0, 1, 0, 0.6, 0.4);
    out(bx, y0 + 1.9, z, 0.52, 0.05, 0.44, ct[0], ct[1], ct[2], 1, 0, 0, 0, 1, kb);
  }
  if (out.due()) yield;
}

// ---------------------------------------------------------------------------------------------
// People and animals. Each is a dozen or so shaped, oriented splats: ellipsoids for trunk, head, hat
// and load, overlapping beams for limbs (never thinner than the GPU can draw at that distance). They
// are drawn well over life size, the more so the further out they stand (figK: 1.7x at 40 m, 2.2x at
// 100 m, 2.5x from 145 m), because a life-size person 80 m from the window is twenty pixels tall and
// reads as a speck. All of them answer the beat by hand (MOVE.FLASH, through moveOut); a riding
// cyclist is MOVE.RIDE.
//   A figure's own frame: u along its heading, h up, v across. yaw 0 faces along the line (+x),
//   pi/2 faces away from it, -pi/2 faces the train.
// ---------------------------------------------------------------------------------------------
const SHIRTS = [[0.18, 0.26, 0.5], [0.76, 0.75, 0.7], [0.66, 0.24, 0.22], [0.7, 0.4, 0.46], [0.2, 0.42, 0.5], [0.62, 0.5, 0.26]];
const SKIN = [0.68, 0.51, 0.4], HAIR = [0.07, 0.06, 0.06], STRAW = [0.74, 0.64, 0.4], TROUS = [0.13, 0.14, 0.2];
const WOODC = [0.42, 0.33, 0.22], WHITE = [0.78, 0.78, 0.75], INDIGO = [0.14, 0.18, 0.42];
const UMBRELLAS = [[0.78, 0.16, 0.14], [0.8, 0.66, 0.1], [0.2, 0.42, 0.74], [0.78, 0.45, 0.58], [0.76, 0.76, 0.74]];
const KIMONO = [[0.7, 0.36, 0.5], [0.42, 0.3, 0.6], [0.2, 0.45, 0.5], [0.72, 0.5, 0.2], [0.24, 0.3, 0.56]];
const LANTERN = [1, 0.74, 0.4];
function figK(d) { return clamp(1.4 + d / 130, 1.7, 2.5); }
// For scripts that look for the figures: globalThis.__fujiLog(what, worldX, distance), if set.
function logFig(ctx, what, wx, d, extra) { const f = globalThis.__fujiLog; if (f && wx >= ctx.x0 && wx < ctx.x0 + ctx.length) f(what, wx, d, extra); }

function fig(ctx, out, wx, y, d, yaw, k, move = MOVE.FLASH) {
  const B = moveOut(out, move), ca = Math.cos(yaw), sa = Math.sin(yaw), x0 = wx - ctx.x0, kind = KIND.OTHER;
  const rmin = 0.00065 * d, qy = quatYaw(yaw);
  const P = (u, h, v) => [x0 + (u * ca - v * sa) * k, y + h * k, -(d + (u * sa + v * ca) * k)];
  const V = (u, h, v) => [u * ca - v * sa, h, -(u * sa + v * ca)];
  // an ellipsoid with radii along the heading, up and across
  const E = (p, ru, rh, rv, c, q = qy) => B(p[0], p[1], p[2], ru * k, rh * k, rv * k, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind);
  // an ellipsoid whose first axis lies along (du, dh) in the figure's own upright plane: radii along
  // that axis, square to it in the plane, and across
  const T = (p, du, dh, ra, rn, rv, c) => { const a = V(du, dh, 0), n = V(-dh, du, 0); E(p, ra, rn, rv, c, quatUV(a[0], a[1], a[2], n[0], n[1], n[2])); };
  // a limb, pole or rod
  const L = (a, b, r, c, n = 2, alpha = 1) => beam(B, a[0], a[1], a[2], b[0], b[1], b[2], Math.max(r * k, rmin), c, n, alpha, kind);
  return { B, P, V, E, T, L, k, rmin };
}

// A person.
//   o: { yaw, k (scale; default figK(d)), size (a child: 0.7), what (name for the log),
//        pose: 'stand' | 'walk' | 'bent' (planting) | 'stoop' | 'bow' | 'sit' | 'crouch' | 'ride',
//        top, legs (colours), robe (a colour: a long skirt in place of legs), sash,
//        hat: 'kasa' (wide straw hat) | 'cap' (close-fitting: hatC) | 'bald' | none (hair), hatC, longHair,
//        arms: 'down' | 'reach' | 'lap' | 'bar' | 'fwd' | 'up' | 'pray',
//        basket (true, or the colour of what is in it), pack (colour), umbrella (colour),
//        tool: 'hoe' | 'staff' | 'broom' | 'rod' | 'tray', lamp (a paper lantern in the hand, by night) }
function* person(ctx, out, wx, y, d, o = {}) {
  if (!inX(ctx, wx, 6)) return;
  const k = (o.k || figK(d)) * (o.size || 1);
  const move = o.move || MOVE.FLASH;
  const { P, E, T, L } = fig(ctx, out, wx, y, d, o.yaw || 0, k, move);
  logFig(ctx, o.what || 'person', wx, d, o.log);
  const top = o.top || SHIRTS[0], leg = o.legs || TROUS, pose = o.pose || 'stand';
  let hu = 0, hh = 0.9, su = 0.02, sh = 1.47, eu = 0.03, eh = 1.67;      // hip, shoulders, head: along the heading, up
  if (pose === 'sit') { hh = 0.2; su = 0.03; sh = 0.72; eu = 0.05; eh = 0.93; E(P(0.24, 0.15, 0), 0.34, 0.15, 0.28, o.robe || leg); }
  else if (pose === 'crouch') { hh = 0.34; su = 0.22; sh = 0.8; eu = 0.33; eh = 0.98; E(P(0.14, 0.24, 0), 0.25, 0.24, 0.25, o.robe || leg); }
  else if (pose === 'ride') {
    hu = -0.14; hh = 0.98; su = 0.14; sh = 1.5; eu = 0.21; eh = 1.7;
    L(P(hu, hh, -0.1), P(0.2, 0.7, -0.12), 0.08, leg, 1); L(P(0.2, 0.7, -0.12), P(0.14, 0.26, -0.12), 0.07, leg, 1);
    L(P(hu, hh, 0.1), P(0.1, 0.62, 0.12), 0.08, leg, 1); L(P(0.1, 0.62, 0.12), P(-0.04, 0.2, 0.12), 0.07, leg, 1);
  } else {
    if (pose === 'bent') { su = 0.5; sh = 1.13; eu = 0.68; eh = 1.08; }
    else if (pose === 'bow') { su = 0.34; sh = 1.36; eu = 0.5; eh = 1.5; }
    else if (pose === 'stoop') { su = 0.2; sh = 1.4; eu = 0.32; eh = 1.57; }
    const st = pose === 'walk' ? 0.24 : 0.03;
    if (o.robe) T(P(0, 0.46, 0), 0, 1, 0.5, 0.2 + st * 0.3, 0.24, o.robe);
    else {
      // (the legs stop short of the ground and end in shoes: a splat shows well beyond its radius,
      // and legs drawn to the ground reach visibly below it)
      for (const sg of [-1, 1]) {
        L(P(0, hh, sg * 0.1), P(-sg * st * 0.85, 0.14, sg * 0.11), 0.085, leg, 3);
        E(P(-sg * st + 0.04, 0.05, sg * 0.11), 0.12, 0.05, 0.07, o.shoes || HAIR);
      }
    }
  }
  // the trunk, from hips to shoulders
  T(P((hu + su) / 2, (hh + sh) / 2 + 0.02, 0), su - hu, sh - hh, Math.hypot(su - hu, sh - hh) / 2 + 0.1, 0.17, 0.23, top);
  if (o.sash) T(P(hu + (su - hu) * 0.22, hh + (sh - hh) * 0.22, 0), su - hu, sh - hh, 0.07, 0.185, 0.245, o.sash);
  const arms = o.arms || (pose === 'bent' ? 'reach' : pose === 'sit' || pose === 'crouch' ? 'lap' : pose === 'ride' ? 'bar' : 'down');
  for (const sg of [-1, 1]) {
    const a = P(su - 0.02, sh - 0.05, sg * 0.25);
    const b = arms === 'reach' ? P(su + 0.12, Math.max(0.12, sh - 0.95), sg * 0.17)
      : arms === 'lap' ? P(su + 0.3, sh - 0.4, sg * 0.16)
      : arms === 'bar' ? P(0.44, 1.06, sg * 0.2)
      : arms === 'fwd' ? P(su + 0.44, sh - 0.3, sg * 0.2)
      : arms === 'up' ? P(su + 0.16, sh + 0.2, sg * 0.24)
      : arms === 'pray' ? P(su + 0.3, sh - 0.12, sg * 0.05)
      : P(su + 0.07, sh - 0.6, sg * 0.27);
    L(a, b, 0.06, top);
  }
  E(P(eu, eh, 0), 0.13, 0.135, 0.125, SKIN);
  // what is on the head tips forward with it
  const tilt = pose === 'bent' ? 0.6 : pose === 'bow' ? 0.5 : pose === 'stoop' ? 0.2 : 0;
  const hx = Math.sin(tilt), hy = Math.cos(tilt);
  if (o.hat === 'kasa') {
    const hc = o.hatC || STRAW;
    T(P(eu + hx * 0.1, eh + hy * 0.1, 0), hy, -hx, 0.38, 0.055, 0.38, hc);
    T(P(eu + hx * 0.17, eh + hy * 0.17, 0), hy, -hx, 0.18, 0.075, 0.18, mul3(hc, 0.9));
  } else if (o.hat === 'cap') T(P(eu + hx * 0.07, eh + hy * 0.07, 0), hy, -hx, 0.15, 0.085, 0.145, o.hatC || WHITE);
  else if (o.hat !== 'bald') {
    E(P(eu - 0.025, eh + 0.045, 0), 0.13, 0.11, 0.135, HAIR);
    if (o.longHair) E(P(eu - 0.13, eh - 0.22, 0), 0.06, 0.22, 0.11, HAIR);
  }
  if (o.basket) {
    E(P(su - 0.31, sh - 0.3, 0), 0.17, 0.21, 0.2, [0.56, 0.44, 0.24]);
    if (o.basket !== true) E(P(su - 0.31, sh - 0.08, 0), 0.14, 0.06, 0.17, o.basket);
  }
  if (o.pack) E(P(su - 0.23, sh - 0.22, 0), 0.1, 0.2, 0.17, o.pack);
  if (o.umbrella) {
    L(P(su + 0.2, sh - 0.3, 0.2), P(su + 0.12, sh + 0.62, 0.08), 0.022, [0.2, 0.2, 0.2], 2);
    T(P(su + 0.1, sh + 0.68, 0.05), 1, 0.1, 0.58, 0.14, 0.58, o.umbrella);
    T(P(su + 0.1, sh + 0.8, 0.05), 1, 0.1, 0.26, 0.08, 0.26, mul3(o.umbrella, 0.88));
  }
  if (o.tool === 'hoe') { L(P(su + 0.3, sh - 0.45, 0.2), P(su + 0.95, 0.05, 0.26), 0.028, WOODC, 3); E(P(su + 0.98, 0.07, 0.26), 0.1, 0.05, 0.13, [0.3, 0.3, 0.33]); }
  else if (o.tool === 'staff') L(P(su + 0.3, 0, 0.27), P(su + 0.24, sh + 0.1, 0.27), 0.025, WOODC, 3);
  else if (o.tool === 'broom') { L(P(su + 0.2, sh - 0.25, 0.2), P(su + 0.66, 0.24, 0.24), 0.025, [0.5, 0.42, 0.2], 3); E(P(su + 0.72, 0.14, 0.24), 0.12, 0.15, 0.17, [0.58, 0.48, 0.26]); }
  else if (o.tool === 'tray') E(P(su + 0.36, sh - 0.42, 0), 0.25, 0.06, 0.2, C.youngRice);
  else if (o.tool === 'rod') {
    // a long rod up and out over the water, and the line dropping from its tip
    const tip = P(su + 2.3, sh + 1.45, 0.5);
    L(P(su + 0.25, sh - 0.4, 0.15), tip, 0.018, [0.22, 0.18, 0.12], 6);
    L(tip, P(su + 2.9, 0.1, 0.6), 0.008, [0.7, 0.7, 0.7], 3, 0.7);
  }
  if (o.lamp) {
    // (a rider's lamp rides with it; anybody else's is an ordinary light)
    const p = P(su + 0.36, sh - 0.62, 0.24), s = 0.13 * k, lo = move === MOVE.RIDE ? moveOut(out, move) : out;
    lo(p[0], p[1], p[2], s, s * 1.25, s, LANTERN[0], LANTERN[1], LANTERN[2], 1, 0, 0, 0, 1, KIND.LIGHT);
    lo(p[0], p[1], p[2] + 0.05, s * 6, s * 6, s * 2, LANTERN[0], LANTERN[1], LANTERN[2], 0.14, 0, 0, 0, 1, KIND.LIGHT);
  }
  if (out.due()) yield;
}
// The paddy worker of old: a wide straw hat, bent double to plant or standing with a hoe.
function* farmer(ctx, out, wx, y, d, o) {
  yield* person(ctx, out, wx, y, d, { what: 'farmer', yaw: o.yaw, pose: o.bent ? 'bent' : 'stand', top: o.shirt, hat: 'kasa', tool: !o.bent && o.tool ? 'hoe' : null, k: o.k });
}

// A dog on a lead (a shiba: tan, with a curled tail).
function* dog(ctx, out, wx, y, d, yaw, k) {
  if (!inX(ctx, wx, 4)) return;
  const { P, E, L } = fig(ctx, out, wx, y, d, yaw, k), tan = [0.68, 0.44, 0.2], cream = [0.76, 0.7, 0.58];
  E(P(0, 0.44, 0), 0.3, 0.15, 0.14, tan);
  E(P(0.36, 0.6, 0), 0.13, 0.12, 0.11, tan); E(P(0.48, 0.55, 0), 0.07, 0.06, 0.06, cream);
  for (const v of [-0.06, 0.06]) E(P(0.33, 0.73, v), 0.04, 0.06, 0.035, tan);
  E(P(-0.3, 0.64, 0), 0.08, 0.1, 0.07, cream);
  for (const u of [-0.2, 0.2]) for (const v of [-0.07, 0.07]) L(P(u, 0.4, v), P(u + 0.02, 0, v), 0.04, tan, 1);
  if (out.due()) yield;
}

// A bicycle and its rider, seen best from the side: two wheels as rings of struts, a frame, a front
// basket; by night a lamp. o.ride: it is riding, and every splat of it (lamp too) is MOVE.RIDE, so
// it must stand near its ride cell's middle facing the cell's way (see rideCell). Otherwise it
// stands still and flashes with its rider.
function* cyclist(ctx, out, wx, y, d, o) {
  if (!inX(ctx, wx, 6)) return;
  const move = o.ride ? MOVE.RIDE : MOVE.FLASH, lo = o.ride ? moveOut(out, move) : out;
  const k = o.k || figK(d), { P, E, L } = fig(ctx, out, wx, y, d, o.yaw || 0, k, move);
  const tyre = [0.09, 0.09, 0.1], fc = o.frame || [0.6, 0.62, 0.64];
  for (const cu of [-0.54, 0.54]) for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * 6.2832, a1 = ((i + 1) / 8) * 6.2832;
    L(P(cu + 0.34 * Math.cos(a0), 0.36 + 0.34 * Math.sin(a0), 0), P(cu + 0.34 * Math.cos(a1), 0.36 + 0.34 * Math.sin(a1), 0), 0.045, tyre, 1);
  }
  L(P(-0.54, 0.36, 0), P(-0.16, 0.9, 0), 0.03, fc, 2); L(P(-0.16, 0.9, 0), P(0.06, 0.34, 0), 0.03, fc, 2);
  L(P(0.06, 0.34, 0), P(0.42, 0.9, 0), 0.03, fc, 2); L(P(-0.54, 0.36, 0), P(0.06, 0.34, 0), 0.028, fc, 2);
  L(P(0.54, 0.36, 0), P(0.4, 1.06, 0), 0.03, fc, 2); L(P(0.4, 1.06, -0.22), P(0.4, 1.06, 0.22), 0.028, tyre, 1);
  E(P(-0.17, 0.95, 0), 0.12, 0.045, 0.08, tyre);
  if (o.basket !== false) E(P(0.68, 0.88, 0), 0.13, 0.11, 0.16, [0.52, 0.52, 0.5]);
  if (o.night) {
    const p = P(0.72, 0.7, 0);
    lo(p[0], p[1], p[2], 0.1 * k, 0.1 * k, 0.1 * k, 1, 0.97, 0.8, 1, 0, 0, 0, 1, KIND.LIGHT);
    lo(p[0], p[1], p[2] + 0.05, 0.6 * k, 0.6 * k, 0.25 * k, 1, 0.97, 0.8, 0.15, 0, 0, 0, 1, KIND.LIGHT);
  }
  yield* person(ctx, out, wx, y, d, { ...o, k, move, pose: 'ride', basket: false, what: o.what || 'cyclist', log: { ride: !!o.ride, dir: Math.cos(o.yaw || 0) > 0 ? 1 : -1 } });
}

// A two-wheeled handcart (riyaka) and the farmer pulling it: a low bed with a load, rail sides, two
// spoked wheels, the handles running forward to the puller.
function* handcart(ctx, out, wx, y, d, o) {
  if (!inX(ctx, wx, 8)) return;
  // (the cart is a rigid thing: nothing on the beat; the farmer pulling it flashes)
  const k = o.k || figK(d), yaw = o.yaw || 0, { P, E, L } = fig(ctx, out, wx, y, d, yaw, k, MOVE.STILL);
  const steel = [0.36, 0.38, 0.4], tyre = [0.09, 0.09, 0.1];
  E(P(-0.3, 0.64, 0), 0.86, 0.13, 0.47, [0.42, 0.36, 0.28]);
  E(P(-0.3, 1.0, 0), 0.66, 0.27, 0.4, o.load || C.youngRice);
  for (const v of [-0.47, 0.47]) {
    L(P(-1.12, 0.9, v), P(0.52, 0.9, v), 0.028, steel, 3);
    for (const u of [-1.12, 0.52]) L(P(u, 0.6, v), P(u, 0.9, v), 0.028, steel, 1);
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * 6.2832, a1 = ((i + 1) / 8) * 6.2832;
      L(P(-0.3 + 0.37 * Math.cos(a0), 0.38 + 0.37 * Math.sin(a0), v * 1.12), P(-0.3 + 0.37 * Math.cos(a1), 0.38 + 0.37 * Math.sin(a1), v * 1.12), 0.035, tyre, 1);
    }
    L(P(0.52, 0.7, v * 0.7), P(1.5, 0.96, v * 0.7), 0.028, steel, 3);
  }
  L(P(1.5, 0.96, -0.33), P(1.5, 0.96, 0.33), 0.028, steel, 1);
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  yield* person(ctx, out, wx + 1.22 * k * ca, y, d + 1.22 * k * sa, { what: 'handcart', yaw, k, pose: 'walk', top: o.top, hat: 'kasa', arms: 'down' });
}

// A kei truck: the small white pick-up of every Japanese farm. A cab with dark glass, a low bed with
// drop sides and a load, four wheels; all five faces of each box, so it reads from either side.
//   o: { k, yaw (0 = nose along +x), seed, body, load (colour), night }
function* keiTruck(ctx, out, wx, y, d, o) {
  if (!inX(ctx, wx, 9)) return;
  const k = o.k, yaw = o.yaw || 0, rng = makeRng(o.seed), kind = KIND.OTHER;
  const ca = Math.cos(yaw), sa = Math.sin(yaw), x0 = wx - ctx.x0;
  const Pt = (a, h, b) => [x0 + (a * ca - b * sa) * k, y + h * k, -(d + (a * sa + b * ca) * k)];
  const Vt = (a, b) => [a * ca - b * sa, 0, -(a * sa + b * ca)];
  const s = Math.max(0.15 * k, detail(out, d, 0.9));
  const body = o.body || WHITE, glass = [0.13, 0.16, 0.2], dark = [0.1, 0.1, 0.11], UP = [0, 1, 0];
  const qy = quatYaw(yaw);
  logFig(ctx, 'truck', wx, d);
  // a box from a0 to a1 along the truck, h0 to h1 high, hw either side; col(face, a, b) -> colour
  function* box(a0, a1, h0, h1, hw, col) {
    const la = (a1 - a0) * k, lh = (h1 - h0) * k, lw = 2 * hw * k;
    const faces = [[Pt(a0, h0, -hw), Vt(1, 0), la, 0, -1, 0], [Pt(a1, h0, hw), Vt(-1, 0), la, 0, 1, 1], [Pt(a1, h0, -hw), Vt(0, 1), lw, 1, 0, 2], [Pt(a0, h0, hw), Vt(0, -1), lw, -1, 0, 3]];
    for (const [o0, u, lu, na, nb, id] of faces) {
      const n = Vt(na, nb), tone = faceTone(body, n[0], n[2]);
      yield* quad(out, o0, u, UP, lu, lh, s, (a, b) => col(id, a, b, tone), kind, rng);
    }
    const tt = mul3(body, 0.98);
    yield* quad(out, Pt(a0, h1, -hw), Vt(1, 0), Vt(0, 1), la, lw, s, (a, b) => col(4, a, b, tt), kind, rng);
  }
  // wheels and the dark underside
  for (const a of [-1.12, 1.12]) for (const b of [-0.68, 0.68]) { const p = Pt(a, 0.29, b); out(p[0], p[1], p[2], 0.29 * k, 0.29 * k, 0.11 * k, dark[0], dark[1], dark[2], 1, qy[0], qy[1], qy[2], qy[3], kind); }
  { const p = Pt(0, 0.44, 0); out(p[0], p[1], p[2], 1.55 * k, 0.1 * k, 0.6 * k, dark[0], dark[1], dark[2], 1, qy[0], qy[1], qy[2], qy[3], kind); }
  // the bed and its load
  yield* box(-1.68, 0.58, 0.5, 0.95, 0.72, (id, a, b, tone) => (id === 4 ? mul3(body, 0.55) : tone));
  if (o.load) {
    const p = Pt(-0.55, 1.2, 0), c = shade(o.load, 0, 0.7, 0.5, 0.7, 0.4);
    out(p[0], p[1], p[2], 0.95 * k, 0.3 * k, 0.56 * k, c[0], c[1], c[2], 1, qy[0], qy[1], qy[2], qy[3], kind);
    for (const a of [-1.15, -0.55, 0.05]) { const q = Pt(a, 1.3, -0.2); const c2 = jitter(o.load, rng, 0.15); out(q[0], q[1], q[2], 0.3 * k, 0.24 * k, 0.4 * k, c2[0], c2[1], c2[2], 1, qy[0], qy[1], qy[2], qy[3], kind); }
  }
  // the cab: glass round the upper half
  yield* box(0.58, 1.68, 0.5, 1.8, 0.72, (id, a, b, tone) => {
    if (id === 4) return tone;
    if (b > 0.52 && b < 0.9) {
      if (id === 2) return a > 0.1 && a < 0.9 ? glass : tone;                    // windscreen
      if (id === 3) return a > 0.2 && a < 0.8 ? glass : tone;                    // rear window
      return (id === 0 ? a > 0.3 && a < 0.92 : a > 0.08 && a < 0.7) ? glass : tone; // door windows
    }
    if (id === 2 && b < 0.3 && b > 0.12 && Math.abs(a - 0.5) > 0.28) return o.night ? { c: [1, 0.97, 0.82], light: true } : [0.7, 0.7, 0.62];
    return tone;
  });
  if (o.night) for (const b of [-0.6, 0.6]) { const p = Pt(-1.7, 0.7, b); out(p[0], p[1], p[2], 0.09 * k, 0.09 * k, 0.09 * k, 1, 0.1, 0.06, 1, 0, 0, 0, 1, KIND.LIGHT); }
  if (out.due()) yield;
}

// A tall narrow banner on a pole (nobori), fluttering.
function* nobori(ctx, out, wx, y, d, k, c) {
  if (!inX(ctx, wx, 3)) return;
  const x = wx - ctx.x0, z = -d, pr = Math.max(0.035 * k, 0.0006 * d);
  strut(out, x, y - 0.1, z, x, y + 4.3 * k, z, pr, [0.5, 0.42, 0.28], 5, 1, KIND.OTHER);
  strut(out, x, y + 4.2 * k, z, x + 0.62 * k, y + 4.2 * k, z, pr, [0.5, 0.42, 0.28], 1, 1, KIND.OTHER);
  for (let i = 0; i < 6; i++) {
    const cc = i === 1 || i === 4 ? WHITE : c;
    out(x + 0.34 * k, y + (3.9 - i * 0.52) * k, z, 0.27 * k, 0.33 * k, Math.max(0.03, 0.0004 * d), cc[0], cc[1], cc[2], 1, 0, 0, 0, 1, KIND.OTHER, MOVE.FLAG);
  }
  if (out.due()) yield;
}

// A portable shrine (mikoshi) on its two carrying poles, shouldered by six bearers in white coats
// and headbands: black lacquer and gold under a wide roof with a gold bird on top.
function* mikoshi(ctx, out, wx, y, d, yaw, k, night) {
  if (!inX(ctx, wx, 12)) return;
  const { P, E, T, L } = fig(ctx, out, wx, y, d, yaw, k, MOVE.STILL);    // the shrine is rigid, nothing on the beat; its bearers flash
  const gold = [0.8, 0.62, 0.16], lac = [0.09, 0.07, 0.07], red = C.vermilion;
  for (const v of [-0.42, 0.42]) L(P(-2.0, 1.5, v), P(2.0, 1.5, v), 0.05, red, 8);
  E(P(0, 1.68, 0), 0.52, 0.13, 0.52, lac);
  E(P(0, 2.02, 0), 0.36, 0.3, 0.36, gold);
  E(P(0, 2.0, 0), 0.38, 0.08, 0.38, red);
  T(P(0, 2.4, 0), 1, 0, 0.72, 0.12, 0.72, lac);
  E(P(0, 2.52, 0), 0.34, 0.12, 0.34, lac);
  for (const u of [-0.66, 0.66]) for (const v of [-0.66, 0.66]) E(P(u, 2.42, v), 0.1, 0.09, 0.1, gold);
  E(P(0, 2.74, 0), 0.13, 0.15, 0.1, gold);
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  let n = 0;
  for (const u of [-1.6, -0.95, 1.6]) for (const v of [-0.44, 0.44]) {
    const band = (n++ % 2) ? WHITE : [0.2, 0.3, 0.62];
    yield* person(ctx, out, wx + (u * ca - v * sa) * k, y, d + (u * sa + v * ca) * k, { what: 'shrine', yaw, k, pose: 'walk', top: WHITE, legs: SKIN, sash: [0.16, 0.22, 0.5], hat: 'cap', hatC: band, arms: 'up', lamp: night && u > 0 && v < 0 });
  }
}

// A picnic under the blossom: a coloured sheet lying in the ground, people sitting round it, a box
// or two of food, somebody standing; by night a paper lantern on a pole.
const SHEETS = [[0.12, 0.32, 0.7], [0.12, 0.32, 0.7], [0.74, 0.18, 0.16], [0.78, 0.5, 0.58], [0.2, 0.5, 0.3]];
function* picnic(ctx, out, W, wx, d, seed, night) {
  if (!inX(ctx, wx, 12)) return;
  const r = makeRng(seed), k = figK(d) * 1.12, up = 0.34;
  const sw = 3.6 * k, sd = 2.0 * k, sc = SHEETS[Math.floor(r() * SHEETS.length)];
  const yn = W.H(wx, d - sd / 2), yf = W.H(wx, d + sd / 2);
  // the sheet, lying in the slope (and proud of it: the ground's own discs lie in the same plane and
  // would otherwise sort in front of half of it)
  const v = norm3(0, yf - yn, -sd), lv = Math.hypot(yf - yn, sd);
  const tone = shade(sc, 0, v[2] < 0 ? -v[2] : v[2], Math.abs(v[1]), 0.7, 0.4);
  yield* quad(out, [wx - sw / 2 - ctx.x0, yn + up, -(d - sd / 2)], [1, 0, 0], v, sw, lv, Math.max(0.3, detail(out, d, 0.9)), () => jitter(tone, r, 0.04), KIND.OTHER, r);
  const n = 3 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    // (they sit along the far half of the sheet, turned to one another and the line, so the near
    // half shows as the sheet it is)
    const px = wx + ((i + 0.2 + 0.6 * r()) / n - 0.5) * sw * 0.86, pd = d + sd * (0.08 + 0.3 * r()), a = -1.57 + (px < wx ? 0.6 : -0.6);
    const stand = i === 0 && r() < 0.5, kid = !stand && r() < 0.2;
    yield* person(ctx, out, px, W.H(px, pd) + up + 0.04, pd, { what: 'picnic', k, size: kid ? 0.7 : 1, yaw: a + (r() - 0.5) * 0.9, pose: stand ? 'stand' : 'sit', top: SHIRTS[Math.floor(r() * SHIRTS.length)], legs: r() < 0.5 ? TROUS : [0.3, 0.3, 0.36], hat: r() < 0.25 ? 'cap' : null, hatC: r() < 0.5 ? WHITE : [0.7, 0.5, 0.2], longHair: r() < 0.4 });
  }
  // boxes of food and a bottle in the middle
  for (let i = 0; i < 3; i++) {
    const px = wx + (r() - 0.5) * sw * 0.5, pd = d - sd * (0.08 + 0.2 * r()), c = [[0.66, 0.14, 0.12], [0.1, 0.1, 0.1], [0.78, 0.74, 0.5]][i];
    out(px - ctx.x0, W.H(px, pd) + up + 0.14 * k, -pd, 0.2 * k, 0.1 * k, 0.16 * k, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER, MOVE.STILL);
  }
  if (night) {
    const px = wx + sw * 0.55 - ctx.x0, y = W.H(wx + sw * 0.55, d);
    strut(out, px, y, -d, px, y + 2.3 * k, -d, Math.max(0.03 * k, 0.0006 * d), WOODC, 3, 1, KIND.OTHER);
    out(px, y + 2.3 * k, -d, 0.2 * k, 0.26 * k, 0.2 * k, LANTERN[0], LANTERN[1], LANTERN[2], 1, 0, 0, 0, 1, KIND.LIGHT);
    out(px, y + 2.3 * k, -d + 0.05, 1.4 * k, 1.4 * k, 0.5 * k, LANTERN[0], LANTERN[1], LANTERN[2], 0.14, 0, 0, 0, 1, KIND.LIGHT);
  }
  if (out.due()) yield;
}

// Wading birds: egrets (white), now and then a grey heron, and red-crowned cranes (white, with a
// black neck and tail and a red cap). Twice life size and more: a bird is a small thing.
function* egret(ctx, out, wx, y, d, o) {
  if (!inX(ctx, wx, 4)) return;
  const B = moveOut(out, MOVE.FLASH), k = (o.crane ? 2.5 : o.heron ? 2.5 : 2.0) * clamp(0.75 + d / 240, 1, 1.25), kind = KIND.OTHER;
  logFig(ctx, o.crane ? 'crane' : o.heron ? 'heron' : 'bird', wx, d);
  const ca = Math.cos(o.yaw), sa = Math.sin(o.yaw), x0 = wx - ctx.x0;
  const P = (u, h, v) => [x0 + (u * ca - v * sa) * k, y + h * k, -(d + (u * sa + v * ca) * k)];
  const body = o.heron ? [0.5, 0.52, 0.56] : [0.8, 0.8, 0.78], neck = o.crane ? [0.1, 0.1, 0.11] : body;
  const S = (a, b, r, c, n = 1) => beam(B, a[0], a[1], a[2], b[0], b[1], b[2], Math.max(r * k, 0.00065 * d), c, n, 1, kind);
  const tail = P(-0.22, 0.56, 0), chest = P(0.15, 0.72, 0);
  const q = quatDir(chest[0] - tail[0], chest[1] - tail[1], chest[2] - tail[2]);
  const bc = shade(body, 0, 0.6, 0.6, 0.75, 0.35);
  B((tail[0] + chest[0]) / 2, (tail[1] + chest[1]) / 2, (tail[2] + chest[2]) / 2, 0.24 * k, 0.12 * k, 0.12 * k, bc[0], bc[1], bc[2], 1, q[0], q[1], q[2], q[3], kind);
  if (o.crane) B(tail[0], tail[1] - 0.02 * k, tail[2], 0.13 * k, 0.09 * k, 0.09 * k, 0.1, 0.1, 0.11, 1, q[0], q[1], q[2], q[3], kind);
  const n1 = P(0.17, 0.74, 0), n2 = o.hunch ? P(0.12, 0.9, 0) : P(0.24, 1.02, 0), hd = o.hunch ? P(0.2, 0.95, 0) : P(0.2, 1.17, 0);
  S(n1, n2, 0.04, neck, 2); S(n2, hd, 0.035, neck, 1);
  B(hd[0], hd[1], hd[2], 0.065 * k, 0.05 * k, 0.05 * k, body[0], body[1], body[2], 1, 0, 0, 0, 1, kind);
  if (o.crane) { const c = P(0.19, 1.22, 0); B(c[0], c[1], c[2], 0.04 * k, 0.025 * k, 0.04 * k, 0.74, 0.12, 0.1, 1, 0, 0, 0, 1, kind); }
  const bill = P(o.hunch ? 0.4 : 0.38, o.hunch ? 0.92 : 1.14, 0);
  S(hd, bill, 0.018, [0.8, 0.6, 0.15]);
  for (const v of [-0.045, 0.045]) S(P(0, 0.5, v), P(0.02, -0.05, v), 0.02, [0.14, 0.14, 0.12], 2);
  if (out.due()) yield;
}

// ---------------------------------------------------------------------------------------------
// Placed things, shared by the bands (each draws what its own distances hold)
// ---------------------------------------------------------------------------------------------
function* villages(ctx, out, W, dLo, dHi, opts = {}) {
  const lit = litShare(ctx), night = isNight(ctx);
  const i0 = Math.floor((ctx.x0 - 200) / VCELL), i1 = Math.floor((ctx.x0 + ctx.length + 200) / VCELL);
  const k = opts.coarse || 1;
  for (let i = i0; i <= i1; i++) {
    const v = village(W, i);
    if (!v || v.dc + v.Rd < dLo - 30 || v.dc - v.Rd > dHi + 30) continue;
    for (const hs of v.houses) {
      if (!inD(hs.d, dLo, dHi) || !inX(ctx, hs.wx, 15)) continue;
      const rng = makeRng(hs.seed);
      const y = W.H(hs.wx, hs.d);
      const s = Math.max(0.2, detail(out, hs.d, 1.5 * k));
      yield* jhouse(ctx, out, hs.wx - ctx.x0, hs.d, { w: hs.w, dep: hs.dep, storeys: hs.storeys, yaw: hs.yaw, style: hs.style, hip: hs.hip, y, s, rng, lit, seed: hs.seed });
      if (opts.small && hs.koi) yield* koinobori(ctx, out, hs.wx - ctx.x0 + hs.w * 0.5 + 2, y, hs.d - hs.dep / 2 - 2.5, hashInts(hs.seed, 5));
    }
    for (const t of v.trees) {
      if (!inD(t.d, dLo, dHi) || !inX(ctx, t.wx, 15)) continue;
      yield* treeOf(ctx, out, t, t.d, W.H(t.wx, t.d) - 0.1, makeRng(t.seed));
    }
    // lamps along the village lane at night, and rising lanterns at level 1 (topology)
    const ld = v.dc - v.Rd - 4;
    if (night && inD(ld, dLo, dHi) && opts.small) {
      for (let s = -v.R; s <= v.R; s += 30) {
        const wx = v.cx + s;
        if (!inX(ctx, wx, 1) || blocked(W, wx, ld, 0)) continue;
        const y = W.H(wx, ld);
        strut(out, wx - ctx.x0, y, -ld, wx - ctx.x0, y + 5.2, -ld, 0.08, [0.4, 0.4, 0.4], 3, 1, KIND.OTHER);
        out(wx - ctx.x0, y + 5.3, -(ld - 0.4), 0.16, 0.12, 0.16, LAMP[0], LAMP[1], LAMP[2], 1, 0, 0, 0, 1, KIND.LIGHT, MOVE.CHASE);
        out(wx - ctx.x0, y + 5.2, -(ld - 0.45), 0.9, 0.9, 0.4, LAMP[0], LAMP[1], LAMP[2], 0.16, 0, 0, 0, 1, KIND.LIGHT, MOVE.CHASE);
      }
    }
    if ((opts.topo || 0) > 0 && night && v.houses.length > 4) yield* risingLanterns(ctx, out, W, v, dLo, dHi, opts.topo);
  }
}
function* hamlets(ctx, out, W, dLo, dHi) {
  const lit = litShare(ctx);
  const i0 = Math.floor((ctx.x0 - 150) / HMCELL), i1 = Math.floor((ctx.x0 + ctx.length + 150) / HMCELL);
  for (let i = i0; i <= i1; i++) {
    const h = hamlet(W, i);
    if (!h) continue;
    for (const hs of h.houses) {
      if (!inD(hs.d, dLo, dHi) || !inX(ctx, hs.wx, 12) || blocked(W, hs.wx, hs.d, 4)) continue;
      const rng = makeRng(hs.seed);
      yield* jhouse(ctx, out, hs.wx - ctx.x0, hs.d, { w: hs.w, dep: hs.dep, storeys: 2, yaw: hs.yaw, style: hs.style, hip: true, y: W.H(hs.wx, hs.d), s: Math.max(0.5, detail(out, hs.d, 1.6)), rng, lit, seed: hs.seed, windows: lit > 0 });
    }
  }
}

// The road: utility poles every 32 m carrying many wires and now and then a transformer, a street
// lamp by night, vending machines glowing by the verge.
function* roadside(ctx, out, W, dLo, dHi) {
  const night = isNight(ctx), PC = 32;
  for (const { i, wx0 } of cellsAround(ctx, PC, PC + 2)) {
    const wx = wx0 + 3;
    if (!roadOn(W, wx)) continue;
    const pd = roadD(W, wx) + 3.4;
    if (!inD(pd, dLo, dHi)) continue;
    const y = W.H(wx, pd), x = wx - ctx.x0, z = -pd;
    const pr = Math.max(0.15, 0.0006 * pd), cg = [0.6, 0.6, 0.58];
    if (inX(ctx, wx, 3)) {
      strut(out, x, y - 0.3, z, x, y + 11.5, z, pr, cg, 6, 1, KIND.MAST);
      for (const [ay, al] of [[10.6, 1.0], [9.6, 0.8]]) strut(out, x, y + ay, z + al, x, y + ay, z - al, 0.07, [0.35, 0.35, 0.36], 2, 1, KIND.MAST);
      if ((i % 4) === 0) for (const sz of [-1, 1]) out(x + 0.35, y + 8, z + sz * 0.35, 0.28, 0.42, 0.28, 0.5, 0.52, 0.5, 1, 0, 0, 0, 1, KIND.MAST);
      if (night && (i % 3) === 0) {
        strut(out, x, y + 7.5, z, x, y + 7.8, z + 1.4, 0.05, [0.4, 0.4, 0.4], 2, 1, KIND.MAST);
        out(x, y + 7.75, z + 1.45, 0.14, 0.07, 0.14, LAMP[0], LAMP[1], LAMP[2], 1, 0, 0, 0, 1, KIND.LIGHT, MOVE.CHASE);
        out(x, y + 7.6, z + 1.5, 0.8, 0.8, 0.4, LAMP[0], LAMP[1], LAMP[2], 0.15, 0, 0, 0, 1, KIND.LIGHT, MOVE.CHASE);
      }
    }
    // the span to the next pole
    const wn = wx + PC;
    if (roadOn(W, wn)) {
      const pdn = roadD(W, wn) + 3.4, yn = W.H(wn, pdn), xn = wn - ctx.x0;
      const wr = Math.max(0.022, 0.00045 * pd);
      for (const [ay, dz, sag, rr] of [[10.6, 0.8, 0.5, 1], [10.6, 0.25, 0.5, 1], [10.6, -0.6, 0.5, 1], [9.6, 0.6, 0.4, 1], [9.6, -0.5, 0.4, 1], [7.0, 0.15, 0.7, 2.2]]) {
        const NS = 8;
        for (let s = 0; s < NS; s++) {
          const t0 = s / NS, t1 = (s + 1) / NS;
          const ya = lerp(y, yn, t0) + ay - sag * 4 * t0 * (1 - t0), yb = lerp(y, yn, t1) + ay - sag * 4 * t1 * (1 - t1);
          strut(out, lerp(x, xn, t0), ya, -lerp(pd, pdn, t0) + dz, lerp(x, xn, t1), yb, -lerp(pd, pdn, t1) + dz, wr * rr, [0.12, 0.12, 0.12], 1, 1, KIND.WIRE);
        }
      }
    }
    // vending machines by the verge, now and then
    if (h01(W.ws, 1901, i) < 0.07 + 0.25 * (villageAt(W, wx, pd + 30) ? 1 : 0) && inX(ctx, wx + 8, 4)) {
      yield* vending(ctx, out, x + 8, W.H(wx + 8, pd + 1.2), pd + 1.2, hashInts(W.ws, 1902, i));
    }
    if (out.due()) yield;
  }
}

// The river: cherry trees along both levees, their petals falling (MOVE.FALL). At level 1 (matter)
// the blossom lifts off them in pale columns.
function* riverside(ctx, out, W, dLo, dHi, matter) {
  const PC = 9;
  for (const { i, wx0 } of cellsAround(ctx, PC, 12)) {
    const wx = wx0 + PC / 2;
    const ra = riverAmt(W, wx);
    if (ra < 0.6) continue;
    const sakura = noise1(wx / 2600, W.ws + 1903) > 0.3;
    const rn = riverN(W, wx), rw = riverW(W, wx);
    for (const side of [0, 1]) {
      const r = makeRng(hashInts(W.ws, 1904, i, side));
      if (r() > (sakura ? 0.92 : 0.25)) continue;
      const d = side ? rn + rw + 5 : rn - 5, tx = wx0 + r() * PC * 0.5;
      if (!inD(d, dLo, dHi) || !inX(ctx, tx, 12)) continue;
      const y = W.H(tx, d);
      if (sakura) yield* cherry(ctx, out, tx - ctx.x0, d, y, r);
      else yield* treeOf(ctx, out, { wx: tx, type: r() < 0.5 ? 'pine' : 'broad' }, d, y, r);
      if (sakura) {
        // petals: falling through a 16 m slab of air round the tree
        for (let k = 0; k < 7; k++) {
          const px = tx + (r() - 0.5) * 12, pd = d + (r() - 0.5) * 10;
          if (!inX(ctx, px, 0)) { r(); continue; }
          const pr = Math.max(0.07, 0.0011 * pd);
          out(px - ctx.x0, -3.4 + 16 * r(), -pd, pr, pr, pr, 0.8, 0.68, 0.74, 0.9, 0, 0, 0, 1, KIND.OTHER, MOVE.FALL);
        }
        if (matter > 0 && h01(W.ws, 1905, i * 2 + side) < 0.22) {
          // the blossom rising off the tree in a column, spreading a little as it goes
          const m = 22;
          for (let k = 0; k < m; k++) {
            const f = (k + r()) / m, sp = 2.5 + 4 * f;
            const c = mix3(C.cherry, [0.8, 0.76, 0.78], f);
            out(tx - ctx.x0 + (r() - 0.5) * sp, y + 9 + f * 90 * matter, -(d + (r() - 0.5) * sp * 0.6), 0.9 + 1.2 * f, 0.9 + 1.2 * f, 0.8 + f, c[0], c[1], c[2], 0.75 - 0.4 * f, 0, 0, 0, 1, KIND.SURREAL, MOVE.VAPOUR);
          }
        }
      }
    }
    if (out.due()) yield;
  }
}

// Shrines: a torii at the foot of a hill, stone lanterns along the approach, stone steps climbing
// into a grove of cedars, a small hall at the top.
function* shrines(ctx, out, W, dLo, dHi) {
  const night = isNight(ctx);
  const i0 = Math.floor((ctx.x0 - 300) / HILLCELL), i1 = Math.floor((ctx.x0 + ctx.length + 300) / HILLCELL);
  for (let i = i0; i <= i1; i++) {
    const h = hillSite(W, i);
    if (!h || !h.shrine) continue;
    const r = makeRng(hashInts(h.seed, 3));
    const wx = h.wx + (r() - 0.5) * h.rx * 0.3;
    const dFoot = h.dc - h.rd * 0.93, dTop = h.dc - h.rd * 0.22;
    const x = wx - ctx.x0;
    if (!inX(ctx, wx, 40)) continue;
    // the torii and the lanterns in front of it
    const dT = dFoot - 6, yT = W.H(wx, dT);
    if (inD(dT, dLo, dHi)) yield* torii(ctx, out, x, yT, dT, 7.5 + 2 * r());
    for (const dd of [dT - 12, dT - 3, dT + 8]) {
      if (!inD(dd, dLo, dHi)) continue;
      for (const sg of [-1, 1]) yield* lantern(ctx, out, x + sg * 3.4, W.H(wx + sg * 3.4, dd), dd, night);
    }
    // the steps: stone treads and dark risers lying on the slope
    const s = Math.max(0.3, detail(out, (dFoot + dTop) / 2, 1.3));
    for (let dd = dFoot - 4; dd < dTop; dd += s * 1.2) {
      if (!inD(dd, dLo, dHi)) continue;
      const y = W.H(wx, dd), tread = Math.floor(dd / 0.7) % 2 === 0;
      const c = jitter(tread ? C.stone : mul3(C.stone, 0.6), ctx.rng, 0.05);
      for (let u = -1.2; u <= 1.21; u += Math.max(0.6, s * 1.2)) out(x + u, y + 0.25, -dd, Math.max(0.45, s * 0.8), 0.15, s * 0.8, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      if (out.due()) yield;
    }
    // cedars flanking the steps (each from its own hash, so every band and chunk agrees)
    let ci = 0;
    for (let dd = dFoot + 2; dd < dTop + 10; dd += 8, ci++) {
      for (const sg of [-1, 1]) {
        const cr = makeRng(hashInts(h.seed, 5, ci, sg));
        const tx = wx + sg * (4.5 + 2.5 * cr()), td = dd + (cr() - 0.5) * 3;
        if (!inD(td, dLo, dHi) || !inX(ctx, tx, 6)) continue;
        yield* conifer(ctx, out, tx - ctx.x0, td, { rng: cr, height: 20 + 8 * cr(), width: 5 + 2 * cr(), color: C.cedar, y: W.H(tx, td) - 0.2 });
      }
    }
    // the hall
    const dH = dTop + 6;
    if (inD(dH, dLo, dHi)) {
      const y = W.H(wx, dH);
      yield* jhouse(ctx, out, x, dH, { w: 8, dep: 7, storeys: 1, yaw: 0, style: 1, hip: false, y, s: Math.max(0.2, detail(out, dH, 1.5)), rng: makeRng(hashInts(h.seed, 6)), roofCol: h01(h.seed, 7, 1) < 0.5 ? [0.32, 0.5, 0.44] : [0.3, 0.2, 0.15], windows: false, seed: h.seed });
    }
  }
}

// Temples: a five-storey pagoda among pines beside the main hall. At level 1 (scale), a temple in
// the mid band grows its pagoda to fifty storeys.
function* temples(ctx, out, W, dLo, dHi, scale) {
  const i0 = Math.floor((ctx.x0 - 200) / TCELL), i1 = Math.floor((ctx.x0 + ctx.length + 200) / TCELL);
  for (let i = i0; i <= i1; i++) {
    const t = templeSite(W, i);
    if (!t) continue;
    const r = makeRng(t.seed);
    if (inD(t.d, dLo, dHi) && inX(ctx, t.wx, 30)) {
      const y = W.H(t.wx, t.d), s = Math.max(0.2, detail(out, t.d, 1.3));
      const tall = scale > 0 && t.d >= 300;
      yield* pagoda5(ctx, out, t.wx - ctx.x0, t.d, y - 0.3, tall ? { H: 320 * scale + 40, tiers: 50, s: Math.max(s, 1.2), kind: KIND.SURREAL, rng: r } : { H: t.H, tiers: 5, s, rng: r });
    }
    const hx = t.wx + t.side * 26, hd = t.d + 6;
    if (inD(hd, dLo, dHi) && inX(ctx, hx, 20)) {
      yield* jhouse(ctx, out, hx - ctx.x0, hd, { w: 17, dep: 13, storeys: 1, yaw: 0, style: 1, hip: true, y: W.H(hx, hd), s: Math.max(0.22, detail(out, hd, 1.4)), rng: makeRng(hashInts(t.seed, 2)), windows: false, seed: t.seed });
    }
    for (let k = 0; k < 7; k++) {
      const pr = makeRng(hashInts(t.seed, 3, k));
      const px = t.wx + (pr() - 0.5) * 80, pd = t.d - 14 + pr() * 34;
      if (!inD(pd, dLo, dHi) || !inX(ctx, px, 10) || Math.abs(px - t.wx) < 6 || Math.abs(px - hx) < 11) continue;
      yield* pine(ctx, out, px - ctx.x0, pd, W.H(px, pd), pr);
    }
  }
}

// Hills: tea clipped into rounded rows following the contours; cedars and broadleaves standing out
// of the wooded crowns; bamboo on the lower flanks.
function* hills(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 260) / HILLCELL), i1 = Math.floor((ctx.x0 + ctx.length + 260) / HILLCELL);
  for (let i = i0; i <= i1; i++) {
    const h = hillSite(W, i);
    if (!h || h.dc - h.rd > dHi || h.dc + h.rd < dLo) continue;
    if (h.wx + h.rx < ctx.x0 - 5 || h.wx - h.rx > ctx.x0 + ctx.length + 5) continue;
    yield* hillSkin(ctx, out, W, h, dLo, dHi);
    if (h.tea) yield* teaRows(ctx, out, W, h, dLo, dHi);
    // emergent trees on the wooded part (each from its own hash, so every band and chunk agrees)
    const nT = Math.round(h.rx * h.rd / 900);
    for (let k = 0; k < nT; k++) {
      const r = makeRng(hashInts(h.seed, 9, k));
      const a = r() * Math.PI * 2, q = Math.sqrt(r()) * 0.85;
      const tx = h.wx + Math.sin(a) * h.rx * q, td = h.dc - Math.cos(a) * h.rd * q;
      const kind = r();
      if (!inD(td, dLo, dHi) || !inX(ctx, tx, 10)) continue;
      const hl = hillAt(W, tx, td);
      if (h.tea && hl.hh < h.Hh * 0.8) continue;
      const y = W.H(tx, td) + 4;
      if (kind < 0.5) yield* conifer(ctx, out, tx - ctx.x0, td, { rng: r, height: 16 + 8 * r(), width: 4.5 + 2 * r(), color: C.cedar, y });
      else yield* blob(ctx, moveOut(out, MOVE.BEAT), tx - ctx.x0, y + 7, td, 6 + 3 * r(), 4 + 2 * r(), 5, { n: Math.max(6, Math.round(treeSplats(out, td, 12) * 0.8)), color: jitter(C.wood, r, 0.15), rng: r, kind: KIND.HEDGE, inner: 0.35 });
    }
    // bamboo groves at the foot, facing the line
    const nb = Math.round(h.rx / 50);
    for (let k = 0; k < nb; k++) {
      const r = makeRng(hashInts(h.seed, 10, k));
      const a = (r() - 0.5) * 2.2, q = 0.92 + 0.1 * r();
      const tx = h.wx + Math.sin(a) * h.rx * q, td = h.dc - Math.cos(a) * h.rd * q;
      if (!inD(td, dLo, dHi) || !inX(ctx, tx, 10) || r() < 0.35) continue;
      yield* bamboo(ctx, out, tx - ctx.x0, td, { rng: r, height: 10 + 5 * r(), width: 7 + 5 * r(), y: W.H(tx, td) - 0.2 });
    }
  }
}
function* teaRows(ctx, out, W, h, dLo, dHi) {
  const pitch = 2.4, AMt = 2.1;
  const qTop = hillContour(0.8), qBot = hillContour(0.04);
  const nRows = Math.max(2, Math.floor(((qBot - qTop) * h.rd) / pitch));
  const s = Math.max(0.45, detail(out, h.dc, 1.25));
  const ds = s * 1.3;
  for (let k = 0; k < nRows; k++) {
    const q = qBot - ((k + 0.5) / nRows) * (qBot - qTop);
    const arc = ((h.rx + h.rd) / 2) * q * 2 * AMt;
    const m = Math.max(4, Math.round(arc / ds));
    for (let i = 0; i < m; i++) {
      const a = ((i + 0.5) / m * 2 - 1) * AMt;
      const sa = Math.sin(a), ca = Math.cos(a);
      const px = h.wx + sa * h.rx * q, pd = h.dc - ca * h.rd * q;
      if (!inD(pd, dLo, dHi)) continue;
      const x = px - ctx.x0;
      if (!(x >= 0 && x < ctx.length)) continue;
      const y = W.H(px, pd);
      const tx = ca * h.rx, tz = sa * h.rd;          // along the row (splat space: x, z = -d ... d grows with -cos)
      const qq = quatDir(tx, 0, -tz);
      const lit = 0.65 + 0.35 * Math.max(0, ca) + 0.15 * Math.max(0, -sa);
      const c = jitter(mul3(mix3(C.teaRow, C.teaLit, 0.5 + 0.5 * ca), lit), ctx.rng, 0.08);
      out(x, y + 0.55, -pd, ds * 0.8, 0.55, 0.85, c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], KIND.HEDGE);
      if (out.due()) yield;
    }
  }
}

// Greenhouse lots: tunnels of milky plastic running away from the line, side by side, with their
// arched end walls. Rigid: every splat is MOVE.STILL (KIND.BUILDING would swell them on the beat).
function* greenhouses(ctx, out, W, dLo, dHi) {
  for (let k = 0; k < W.rows.length; k++) {
    const q = W.rows[k];
    if (q.D > Math.min(dHi, 340)) break;
    if (q.D + q.gap < dLo || q.D < 35) continue;
    const j0 = Math.floor((ctx.x0 + q.off) / q.W) - 1, j1 = Math.floor((ctx.x0 + ctx.length + q.off) / q.W) + 1;
    for (let j = j0; j <= j1; j++) {
      const info = panelInfo(W, k, j);
      if (info.t !== P.HOUSE) continue;
      const px0 = j * q.W - q.off, n = Math.max(1, Math.floor((q.W - 2) / 6.4));
      const len = q.gap - 2.5, dc = q.D + q.gap / 2;
      if (!inD(dc, dLo, dHi)) continue;
      const r = makeRng(info.seed);
      for (let t = 0; t < n; t++) {
        const cx = px0 + 1 + (t + 0.5) * ((q.W - 2) / n);
        if (!inX(ctx, cx, 4)) continue;
        if (blocked(W, cx, dc, 0)) continue;
        yield* tunnel(ctx, out, cx - ctx.x0, W.H(cx, dc), dc, len, r);
      }
    }
  }
}
function* tunnel(ctx, out, x, y0, dc, len, rng) {
  const ra = 2.7, s = Math.max(0.35, detail(out, dc, 1.35)), kind = KIND.BUILDING;
  const narc = Math.max(4, Math.round((Math.PI * ra) / (s * 1.4))), nl = Math.max(2, Math.round(len / (s * 1.4)));
  const sa = (Math.PI * ra / narc) * 0.7, sl = (len / nl) * 0.7;
  for (let i = 0; i < narc; i++) {
    const ph = ((i + 0.5) / narc) * Math.PI;
    const nx = Math.cos(ph), ny = Math.sin(ph);
    const qq = quatUV(0, 0, 1, -ny, nx, 0);
    for (let j = 0; j < nl; j++) {
      const dd = dc - len / 2 + ((j + 0.5) / nl) * len;
      const rib = Math.abs(((dd / 2.2) % 1 + 1) % 1 - 0.5) < 0.08;
      let c = shade([0.76, 0.78, 0.76], nx, ny, 0.15, 0.6, 0.45);
      if (rib) c = mul3(c, 0.82);
      out(x + nx * ra, y0 + ny * ra * 1.05, -dd, sl, sa, 0.06, c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], kind, MOVE.STILL);
    }
    if (out.due()) yield;
  }
  // the end walls: half discs facing along the tunnel
  for (const sg of [-1, 1]) {
    const dd = dc + sg * len / 2;
    const ne = Math.max(2, Math.round(ra / (s * 1.3)));
    for (let a = 0; a < ne; a++) for (let b = 0; b < ne * 2; b++) {
      const u = ((b + 0.5) / (ne * 2)) * 2 - 1, v = (a + 0.5) / ne;
      if (u * u + v * v > 1) continue;
      const door = Math.abs(u) < 0.25 && v < 0.65;
      const c = door ? [0.35, 0.37, 0.35] : mul3([0.74, 0.76, 0.74], sg < 0 ? 0.95 : 0.72);
      out(x + u * ra, y0 + v * ra * 1.05, -dd, ra / ne * 0.72, ra / ne * 0.72, 0.05, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind, MOVE.STILL);
    }
  }
}

// A golf driving range: tall poles carrying a net of cables, along the front and down both sides.
function* golfNets(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 400) / GCELL), i1 = Math.floor((ctx.x0 + ctx.length + 100) / GCELL);
  for (let i = i0; i <= i1; i++) {
    const g = golfSite(W, i);
    if (!g) continue;
    // the net's planes: front (along x) and two sides (along d)
    const planes = [[g.wx, g.d, g.wx + g.len, g.d], [g.wx, g.d, g.wx, g.d + g.deep], [g.wx + g.len, g.d, g.wx + g.len, g.d + g.deep]];
    for (const [ax, ad, bx, bd] of planes) {
      const L = Math.hypot(bx - ax, bd - ad), np = Math.max(1, Math.round(L / 25));
      for (let p = 0; p <= np; p++) {
        const t = p / np, px = lerp(ax, bx, t), pd = lerp(ad, bd, t);
        if (!inD(pd, dLo, dHi) || !inX(ctx, px, 1)) continue;
        const y = W.H(px, pd);
        strut(out, px - ctx.x0, y - 0.3, -pd, px - ctx.x0, y + g.H, -pd, Math.max(0.28, 0.0007 * pd), [0.32, 0.35, 0.33], Math.max(4, Math.round(g.H / 3)), 1, KIND.MAST);
        if (p === np) continue;
        // the net to the next pole: horizontal cables and vertical ones
        const qx = lerp(ax, bx, (p + 1) / np), qd = lerp(ad, bd, (p + 1) / np), yq = W.H(qx, qd);
        const nr = Math.max(0.05, 0.0005 * pd), nc = [0.2, 0.28, 0.22];
        for (let hy = 3; hy < g.H; hy += 3.5) strut(out, px - ctx.x0, y + hy, -pd, qx - ctx.x0, yq + hy, -qd, nr, nc, 5, 0.6, KIND.WIRE);
        for (let v = 1; v < 6; v++) {
          const tv = v / 6, vx = lerp(px, qx, tv), vd = lerp(pd, qd, tv), vy = lerp(y, yq, tv);
          strut(out, vx - ctx.x0, vy, -vd, vx - ctx.x0, vy + g.H - 0.5, -vd, nr, nc, 4, 0.6, KIND.WIRE);
        }
      }
      if (out.due()) yield;
    }
  }
}

// The high-speed line's viaduct: a box girder on concrete piers every 25 m, with sound walls and
// catenary masts on top. Level with the plain however the ground swells beneath it.
function* viaduct(ctx, out, W, dLo, dHi) {
  const PC = 25, cg = C.concrete;
  for (const { i, wx0 } of cellsAround(ctx, PC, 0)) {
    if (!viaOn(W, wx0) || !viaOn(W, wx0 + PC)) continue;
    const d = viaD(W, wx0), dn = viaD(W, wx0 + PC);
    if (!inD(d, dLo, dHi)) continue;
    const deck = (wx) => 13 + 0.5 * Math.round(Math.max(0, W.H(Math.round(wx / 400) * 400, viaD(W, wx))) / 0.5);
    const yA = deck(wx0), yB = deck(wx0 + PC);
    const s = Math.max(0.8, detail(out, d, 1.2)), x = wx0 - ctx.x0, r = makeRng(hashInts(W.ws, 1951, i));
    // the pier
    const yg = W.H(wx0, d) - 0.5;
    for (const [nx, nz, ox, oz, u, len] of [[0, 1, -1.1, 1.8, [1, 0, 0], 2.2], [-1, 0, -1.1, -1.8, [0, 0, 1], 3.6], [1, 0, 1.1, -1.8, [0, 0, 1], 3.6]]) {
      const c = faceTone(cg, nx, nz);
      yield* quad(out, [x + ox, yg, -d + oz], u, [0, 1, 0], len, yA - yg, s, () => jitter(c, r, 0.04), KIND.OTHER, r);
    }
    // the girder: front face, soffit, back face; sound walls on both edges
    const front = faceTone(cg, 0, 1), soffit = mul3(cg, 0.5), back = faceTone(cg, 0, -1);
    const P = (t, y, off) => [x + t * PC, lerp(yA, yB, t) + y, -(lerp(d, dn, t) - off)];
    const n = Math.max(2, Math.round(PC / (s * 1.4))), su = PC / n * 0.68;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      for (let yy = 0.3; yy < 2.6; yy += Math.max(0.6, s * 1.2)) { const p = P(t, yy, 5.5); out(p[0], p[1], p[2], su, Math.max(0.45, s * 0.66), 0.1, front[0], front[1], front[2], 1, 0, 0, 0, 1, KIND.OTHER); }
      for (let oz = -5; oz <= 5; oz += Math.max(1, s * 1.3)) { const p = P(t, 0, oz); out(p[0], p[1], p[2], su, 0.1, Math.max(0.6, s * 0.7), soffit[0], soffit[1], soffit[2], 1, 0, 0, 0, 1, KIND.OTHER); }
      for (const [off, c] of [[5.5, mul3(front, 1.05)], [-5.5, back]]) {
        for (let yy = 2.8; yy < 4.6; yy += Math.max(0.6, s * 1.2)) { const p = P(t, yy, off); out(p[0], p[1], p[2], su, Math.max(0.45, s * 0.66), 0.1, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER); }
      }
      if (out.due()) yield;
    }
    // a dark line of shadow under the parapet, and the catenary masts every other pier
    if (i % 2 === 0) {
      for (const off of [4.8, -4.8]) {
        const p = P(0, 4.5, off);
        strut(out, p[0], p[1], p[2], p[0], p[1] + 5, p[2], Math.max(0.15, 0.0005 * d), [0.4, 0.42, 0.42], 3, 1, KIND.MAST);
      }
      const a = P(0, 9.3, 4.8), b = P(0, 9.3, -4.8);
      strut(out, a[0], a[1], a[2], b[0], b[1], b[2], Math.max(0.12, 0.0004 * d), [0.4, 0.42, 0.42], 3, 1, KIND.MAST);
    }
  }
}

// Can a figure standing at (wx, d) be seen from the line: nothing tall between it and the track
// (a village, a wooded or tea hill, greenhouses), and not down behind the river's levee?
function openTo(W, wx, d) {
  if (riverAmt(W, wx) > 0.2 && d > riverN(W, wx) - 1) return false;
  // (nor may it stand on a shrine's forecourt, which has its own visitors)
  for (let i = Math.floor(wx / HILLCELL) - 1; i <= Math.floor(wx / HILLCELL) + 1; i++) {
    const h = hillSite(W, i);
    if (!h || !h.shrine) continue;
    const sx = h.wx + (makeRng(hashInts(h.seed, 3))() - 0.5) * h.rx * 0.3, dT = h.dc - h.rd * 0.93 - 6;
    if (Math.abs(wx - sx) < 62 && d > dT - 26 && d < dT + 8) return false;
  }
  for (let dd = 24; dd < d - 4; dd += 8) {
    const S = surface(W, wx, dd);
    if (S.t === T.VILLAGE || ((S.t === T.WOOD || S.t === T.TEA) && S.hh > 2) || (S.t === T.PADDY && S.info.t === P.HOUSE)) return false;
  }
  return true;
}
// The kind of paddy panel at a point (a P value), or -1 where the ground is not paddy.
function paddyAt(W, wx, d) { const S = surface(W, wx, d); return S.t === T.PADDY ? S.info.t : -1; }
// Is distance d on or beside a farm lane (whose own traffic the field workers must keep clear of)?
// m widens the margin either side (trees, whose crowns spread over it).
function onLane(W, d, m = 0) { for (const q of W.rows) { if (q.D > d + 4 + m) break; if (q.lane && d > q.D - 2 - m && d < q.D + laneW(q.D) + 1.5 + m) return true; } return false; }

// --- Riders (MOVE.RIDE: see kit.js rideCell). The shader carries a rider along the line, in view by up
// to about a quarter of its distance (more on the widest screens), so it may only ride where its way
// runs straight, level and clear for RIDE_REACH either side of where it stands.
const RIDE_REACH = 72;
const RIDE_LEVEL = 0.15;      // metres the way may rise or fall over that reach (the shader moves along x only)
// Can a rider standing at (wx, d) be carried along its way? way: 'lane' (D: the lane's row
// boundary), 'road', 'river'. Straight: the lane is drawn all along (paddy on both hands, no yard,
// road, village or hill across it), the road and the river path stay within a few tens of
// centimetres of the same distance.
function rideable(W, way, wx, d, D = 0) {
  const hd = way === 'lane' ? D + 0.6 : d, h0 = W.H(wx, hd);
  const a0 = way === 'road' ? roadD(W, wx) : way === 'river' ? riverN(W, wx) : 0;
  for (let t = -RIDE_REACH; t <= RIDE_REACH; t += 6) {
    const x = wx + t;
    if (way === 'lane') {
      const S = surface(W, x, hd);
      if (S.t !== T.PADDY || S.info.t === P.HOUSE) return false;
      // (nor the road's poles and vending machines, which stand up to 5.6 m beyond its middle)
      if (roadOn(W, x) && Math.abs(roadD(W, x) + 1.5 - (D + laneW(D) / 2)) < laneW(D) / 2 + 5.6) return false;
    } else if (way === 'road') { if (!roadOn(W, x) || Math.abs(roadD(W, x) - a0) > 0.7) return false; }
    else if (riverAmt(W, x) < 0.98 || Math.abs(riverN(W, x) - a0) > 0.5) return false;
    if (Math.abs(W.H(x, hd) - h0) > RIDE_LEVEL) return false;
  }
  // the river path runs under the trees of the near levee (riverside(), every 9 m where there are
  // any): a rider drawn twice life size would ride with its head through their crowns
  if (way === 'river') for (let i = Math.floor((wx - RIDE_REACH - 12) / 9); i <= Math.floor((wx + RIDE_REACH + 12) / 9); i++) if (riversideTree(W, i)) return false;
  return true;
}
// Is there a tree on the near levee in riverside()'s 9 m cell i (as it draws them)?
function riversideTree(W, i) {
  const wx = i * 9 + 4.5;
  if (riverAmt(W, wx) < 0.6) return false;
  return makeRng(hashInts(W.ws, 1904, i, 0))() <= (noise1(wx / 2600, W.ws + 1903) > 0.3 ? 0.92 : 0.25);
}
// What the farm lanes' own ladder (laneLife) puts in its 90 m cell i of lane kq: the first two draws.
const LANE_U = { ride: 0.08, school: 0.15, cart: 0.21, truck: 0.26, walk: 0.31, sit: 0.36 };
function laneSlot(W, kq, i) { const r = makeRng(hashInts(W.ws, 2401, kq, i)); const u = r(); return { u, wx: i * 90 + 8 + 74 * r() }; }
// The cyclists on farm lane kq: at most one (or a pair) in each LRCELL of it, standing on the middle
// of one of the ride cells inside it (so no two share a cell), riding with the train on the near
// half of the track and against it on the far half (walkers keep to the middle). Only where the lane
// runs straight, level and clear for RIDE_REACH both ways: no cart or kei truck (they fill the
// lane), nobody sitting on the near bank on the near side, nobody at all where it stands.
const LRCELL = 240;           // ten ride cells
function laneRider(W, kq, i) {
  return cget(W.misc, 'lr' + kq + ':' + i, () => {
    const q = W.rows[kq], r = makeRng(hashInts(W.ws, 2405, kq, i));
    if (r() > 0.6) return null;
    const lw = laneW(q.D), n = LRCELL / 24;
    for (let tr = 0; tr < 3; tr++) {
      const fc = rideCell((i * n + 1 + Math.floor(r() * (n - 1))) * 24), wx = fc.wx, dir = fc.dir;
      const d = q.D + lw * (dir > 0 ? 0.12 : 0.76);
      if (!rideable(W, 'lane', wx, d, q.D) || !openTo(W, wx, d)) continue;
      let clear = true;
      for (let j = Math.floor((wx - RIDE_REACH - 90) / 90); j <= Math.floor((wx + RIDE_REACH + 8) / 90) && clear; j++) {
        const s = laneSlot(W, kq, j), dx = Math.abs(s.wx - wx);
        if (s.u < LANE_U.ride || s.u >= LANE_U.sit) continue;
        if (dx < 10) clear = false;
        else if (dx < RIDE_REACH + 8 && ((s.u >= LANE_U.school && s.u < LANE_U.truck) || (dir > 0 && s.u >= LANE_U.walk))) clear = false;
      }
      if (clear) return { wx, d, dir, pair: r() < 0.35, seed: hashInts(W.ws, 2406, kq, i) };
    }
    return null;
  });
}
// What the road holds in its 170 m cell i (as roadLife draws it), for the riders' checks.
function roadSlot(W, i) {
  const r = makeRng(hashInts(W.ws, 2411, i));
  if (r() > 0.5) return null;
  const wx = i * 170 + 15 + 140 * r();
  if (!roadOn(W, wx) || !roadOn(W, wx - 12) || !roadOn(W, wx + 12)) return null;
  const dir = r() < 0.5 ? 1 : -1;
  return { wx, dir, truck: r() < 0.65 };
}
// What the river path holds in its 44 m cell i: is it a cyclist (as riverLife draws it)?
function riverCyclist(W, i) {
  const r = makeRng(hashInts(W.ws, 2421, i));
  const wx = i * 44 + 6 + 32 * r(), u = r(), sakura = noise1(wx / 2600, W.ws + 1903) > 0.3;
  if ((sakura && u < 0.3) || u >= (sakura ? 0.58 : 0.14)) return null;
  r();
  return r() >= 0.84 ? wx : null;
}

// Life in the paddies: farmers at work, planting teams bent double in a row across a flooded field,
// somebody hoeing a vegetable plot; egrets, now and then a grey heron or a pair of cranes.
function* paddyLife(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, 90, 40)) {
    const r = makeRng(hashInts(W.ws, 2001, i));
    if (r() < 0.3) {
      const wx = wx0 + 90 * r(), d = 45 + 65 * r();
      if (inD(d, dLo, dHi)) {
        const S = surface(W, wx, d), pt = S.t === T.PADDY ? S.info.t : -1, y = S.y - 0.1;
        if (pt >= 0 && pt !== P.HOUSE && pt !== P.DRY && !onLane(W, d) && openTo(W, wx, d)) {
          const bentAll = r() < 0.7;
          const n = 1 + Math.floor(r() * 3), k = figK(d);
          for (let j = 0; j < n; j++) {
            const px = wx + j * (2.2 + r() * 1.5) * k / 1.3, pd = d + (r() - 0.5) * 3;
            const yaw = (r() - 0.5) * 2.4 + (r() < 0.5 ? Math.PI : 0), bent = r() < 0.85 && bentAll, shirt = SHIRTS[Math.floor(r() * 5)], tool = r() < 0.4;
            yield* farmer(ctx, out, px, y, pd, { yaw, bent, shirt, tool, k });
          }
        }
      }
    }
    const r2 = makeRng(hashInts(W.ws, 2002, i));
    if (r2() < 0.35) {
      const wx = wx0 + 90 * r2(), d = 42 + 75 * r2();
      if (!inD(d, dLo - 10, dHi + 10)) continue;
      const S = surface(W, wx, d);
      if (S.t !== T.PADDY || (S.info.t !== P.WATER && S.info.t !== P.YOUNG) || onLane(W, d)) continue;
      const y = S.y - 0.05, heron = r2() < 0.2;
      const crane = !heron && h01(W.ws, 2006, i) < 0.22;
      const n = heron ? 1 : crane ? 2 : 2 + Math.floor(r2() * 6);
      for (let j = 0; j < n; j++) {
        const px = wx + (r2() - 0.5) * 18, pd = d + (r2() - 0.5) * 8;
        const yaw = r2() * 6.28, hunch = r2() < 0.3;
        if (inD(pd, dLo, dHi) && !onLane(W, pd)) yield* egret(ctx, out, px, y, pd, { yaw: crane ? (yaw < 3.14 ? 0.3 : 2.84) : yaw, heron, crane, hunch: hunch && !crane });
      }
    }
  }
  // planting teams: four to seven in a line along the field, all bent to the water, one standing on
  // the bund with a tray of seedlings
  for (const { i, wx0 } of cellsAround(ctx, 180, 40)) {
    const r = makeRng(hashInts(W.ws, 2003, i));
    if (r() > 0.55) continue;
    let wx = 0, d = 0, ok = false;
    for (let tr = 0; tr < 5 && !ok; tr++) {
      wx = wx0 + 20 + 140 * r(); d = 36 + 50 * r();
      const pt = paddyAt(W, wx, d);
      ok = (pt === P.WATER || pt === P.YOUNG) && paddyAt(W, wx + 6, d) === pt && paddyAt(W, wx - 6, d) === pt && !onLane(W, d) && openTo(W, wx, d);
    }
    if (!ok || !inD(d, dLo, dHi)) continue;
    const k = figK(d), n = 4 + Math.floor(r() * 4), gap = 1.45 * k, face = r() < 0.5 ? 0 : Math.PI;
    const y = W.H(wx, d) - 0.05;
    for (let j = 0; j < n; j++) {
      const px = wx + (j - (n - 1) / 2) * gap + (r() - 0.5) * 0.5, pd = d + (r() - 0.5) * 1.6;
      const up = r() < 0.12;
      yield* person(ctx, out, px, y, pd, { what: 'planting', k, yaw: face + (r() - 0.5) * 0.7, pose: up ? 'stand' : 'bent', top: SHIRTS[Math.floor(r() * SHIRTS.length)], hat: 'kasa', tool: up ? 'tray' : null, arms: up ? 'fwd' : null });
    }
  }
  // vegetable plots and standing rice: somebody hoeing, somebody crouched over a basket
  for (const { i, wx0 } of cellsAround(ctx, 220, 20)) {
    const r = makeRng(hashInts(W.ws, 2004, i));
    if (r() > 0.5) continue;
    let wx = 0, d = 0, ok = false;
    for (let tr = 0; tr < 5 && !ok; tr++) {
      wx = wx0 + 200 * r(); d = 36 + 54 * r();
      const pt = paddyAt(W, wx, d);
      ok = (pt === P.DRY || pt === P.RICE) && !onLane(W, d) && openTo(W, wx, d);
    }
    if (!ok || !inD(d, dLo, dHi)) continue;
    const k = figK(d), y = W.H(wx, d) + 0.1, yaw = r() < 0.5 ? 0.3 : 2.84;
    yield* person(ctx, out, wx, y, d, { what: 'field', k, yaw, pose: 'stoop', top: SHIRTS[Math.floor(r() * SHIRTS.length)], hat: 'kasa', tool: 'hoe', arms: 'fwd' });
    if (r() < 0.6) yield* person(ctx, out, wx + (yaw < 1 ? -1 : 1) * 2.2 * k, y, d + 1, { what: 'field', k, yaw: Math.PI - yaw, pose: 'crouch', top: SHIRTS[Math.floor(r() * SHIRTS.length)], hat: 'cap', hatC: [0.76, 0.6, 0.66], basket: C.veg });
  }
}

// The farm lanes: cyclists, schoolchildren walking home in file under umbrellas, a farmer pulling a
// handcart, a kei truck drawn up with its driver beside it, somebody out with the dog, an old woman
// with a stick, somebody sitting on the bank.
function* laneLife(ctx, out, W, dLo, dHi) {
  const night = isNight(ctx);
  for (let kq = 1; kq < W.rows.length; kq++) {
    const q = W.rows[kq];
    if (q.D > Math.min(dHi, 130)) break;
    if (!q.lane || q.D < dLo + 2) continue;
    const d = q.D + laneW(q.D) * 0.45, top = laneTop(q.D), k = figK(d);
    // the cyclists, riding (see laneRider): a pupil in a white helmet, or somebody in a straw hat
    // with the shopping; now and then two pupils riding together
    for (const { i } of cellsAround(ctx, LRCELL, 12)) {
      const c = laneRider(W, kq, i);
      if (!c || !inX(ctx, c.wx, 12)) continue;
      const r = makeRng(c.seed), yaw = c.dir > 0 ? 0 : Math.PI, kr = figK(c.d), y = W.H(c.wx, q.D + 0.6) + top + 0.05;
      const pupil = c.pair || r() < 0.5, lead = c.pair ? c.wx + c.dir * 1.3 * kr : c.wx;
      yield* cyclist(ctx, out, lead, y, c.d, { what: 'rider-lane', ride: true, k: kr, yaw, night, top: pupil ? WHITE : SHIRTS[Math.floor(r() * SHIRTS.length)], legs: TROUS, hat: pupil ? 'cap' : 'kasa', hatC: WHITE, frame: pupil ? [0.6, 0.62, 0.64] : [0.6, 0.2, 0.18], pack: pupil ? [0.14, 0.14, 0.2] : null });
      if (c.pair) yield* cyclist(ctx, out, c.wx - c.dir * 1.3 * kr, y, c.d + 0.15, { what: 'rider-lane', ride: true, k: kr, yaw, night, top: WHITE, legs: TROUS, hat: 'cap', hatC: WHITE, frame: [0.2, 0.36, 0.6], pack: [0.72, 0.14, 0.14] });
    }
    for (const { i, wx0 } of cellsAround(ctx, 90, 30)) {
      const r = makeRng(hashInts(W.ws, 2401, kq, i));
      const u = r(), wx = wx0 + 8 + 74 * r();
      // (u below LANE_U.ride was a cyclist: they have their own places now, above)
      if (u >= LANE_U.sit || u < LANE_U.ride) continue;
      if (paddyAt(W, wx, d) < 0 || paddyAt(W, wx - 7, d) < 0 || paddyAt(W, wx + 7, d) < 0 || !openTo(W, wx, d)) continue;
      const y = W.H(wx, d) + top + 0.05, dir = r() < 0.5 ? 1 : -1, yaw = dir > 0 ? 0 : Math.PI;
      const shirt = () => SHIRTS[Math.floor(r() * SHIRTS.length)];
      if (u < LANE_U.school) {
        // schoolchildren in file: yellow hats, satchels, umbrellas
        const n = 2 + Math.floor(r() * 3);
        for (let j = 0; j < n; j++) {
          const girl = r() < 0.5, um = r() < 0.7;
          yield* person(ctx, out, wx + (j - (n - 1) / 2) * 1.25 * k, y, d + (r() - 0.5) * 0.8, { what: 'school', k, size: 0.72 + 0.1 * r(), yaw: yaw + (r() - 0.5) * 0.3, pose: 'walk', top: r() < 0.5 ? WHITE : [0.16, 0.18, 0.34], legs: [0.14, 0.15, 0.26], hat: 'cap', hatC: [0.8, 0.7, 0.1], pack: girl ? [0.72, 0.14, 0.14] : [0.1, 0.1, 0.12], umbrella: um ? UMBRELLAS[Math.floor(r() * UMBRELLAS.length)] : null, lamp: night && j === 0 });
        }
      } else if (u < 0.21) {
        yield* handcart(ctx, out, wx, y, d, { k, yaw, top: shirt(), load: [C.youngRice, [0.7, 0.62, 0.36], C.veg][Math.floor(r() * 3)] });
      } else if (u < 0.26) {
        // a kei truck drawn up on the lane, its driver beside it
        const kt = k * 0.82;
        yield* keiTruck(ctx, out, wx, y, d, { k: kt, yaw, seed: hashInts(W.ws, 2402, kq, i), body: r() < 0.75 ? WHITE : [0.5, 0.6, 0.66], load: [C.veg, [0.72, 0.6, 0.2], [0.7, 0.62, 0.36], null][Math.floor(r() * 4)], night: false });
        yield* person(ctx, out, wx + dir * 2.6 * kt + dir * 0.8 * k, y, d - 0.3, { what: 'driver', k, yaw: yaw + Math.PI * 0.85, pose: 'stand', top: shirt(), hat: 'kasa', arms: 'fwd', tool: 'tray' });
      } else if (u < 0.31) {
        // out with the dog, or an old woman bent over her stick
        if (r() < 0.55) {
          yield* person(ctx, out, wx, y, d, { what: 'walker', k, yaw, pose: 'walk', top: shirt(), legs: [0.3, 0.3, 0.36], hat: r() < 0.5 ? 'cap' : null, hatC: WHITE, lamp: night });
          yield* dog(ctx, out, wx + dir * 1.5 * k, y, d - 0.2, yaw, k);
        } else yield* person(ctx, out, wx, y, d, { what: 'walker', k, yaw, pose: 'stoop', robe: [0.3, 0.26, 0.4], top: [0.42, 0.36, 0.5], hat: 'cap', hatC: WHITE, tool: 'staff', arms: 'fwd' });
      } else {
        // resting on the bank, facing the train, with somebody standing by
        yield* person(ctx, out, wx, y - top * 0.3, d - laneW(q.D) * 0.4, { what: 'walker', k, yaw: -1.57 + (r() - 0.5), pose: 'sit', top: shirt(), hat: 'kasa' });
        if (r() < 0.6) yield* person(ctx, out, wx + 1.6 * k, y, d, { what: 'walker', k, yaw: Math.PI + 0.4, pose: 'stand', top: shirt(), hat: 'kasa', tool: 'hoe' });
      }
    }
  }
}

// The road: now and then a kei truck on its way, or a cyclist. (A band draws what stands wholly
// inside it: the caller passes the distances.)
function* roadLife(ctx, out, W, dLo, dHi, scale) {
  const night = isNight(ctx);
  for (const { i, wx0 } of cellsAround(ctx, 170, 12)) {
    const r = makeRng(hashInts(W.ws, 2411, i));
    if (r() > 0.5) continue;
    const wx = wx0 + 15 + 140 * r();
    if (!roadOn(W, wx) || !roadOn(W, wx - 12) || !roadOn(W, wx + 12)) continue;
    const rd = roadD(W, wx);
    if (!inD(rd, dLo, dHi)) continue;
    const dir = r() < 0.5 ? 1 : -1, yaw = dir > 0 ? 0 : Math.PI, y = W.H(wx, rd) + 0.24, k = figK(rd) * scale;
    if (r() < 0.65) yield* keiTruck(ctx, out, wx, y, rd - dir * 1.1, { k: k * 0.85, yaw, seed: hashInts(W.ws, 2412, i), body: r() < 0.7 ? WHITE : [0.5, 0.6, 0.66], load: [C.veg, [0.72, 0.6, 0.2], [0.7, 0.62, 0.36], null][Math.floor(r() * 4)], night });
    else {
      // a cyclist: riding on its own side of the road (with the train on the near side), from the
      // middle of its ride cell, where the road runs straight and level and nothing else stands on
      // that side within reach; otherwise drawn up where it is
      const fc = rideCell(wx), rdc = roadD(W, fc.wx), dc = rdc - fc.dir * 1.5;
      let ride = inD(dc, dLo, dHi) && rideable(W, 'road', fc.wx, dc);
      for (let j = i - 1; j <= i + 1 && ride; j += 2) { const s = roadSlot(W, j); if (s && s.dir === fc.dir && Math.abs(s.wx - fc.wx) < RIDE_REACH + 10) ride = false; }
      const o = { what: 'rider-road', k, night, top: SHIRTS[Math.floor(r() * SHIRTS.length)], hat: 'kasa', frame: [0.6, 0.2, 0.18] };
      if (ride) yield* cyclist(ctx, out, fc.wx, W.H(fc.wx, rdc) + 0.24, dc, { ...o, ride, yaw: fc.dir > 0 ? 0 : Math.PI });
      else yield* cyclist(ctx, out, wx, y, rd - dir * 1.5, { ...o, yaw });
    }
  }
}

// The river under the cherries: picnics on the grass slope of the near levee, people strolling the
// path along its top (a couple, a parent and child, a woman in a kimono with a parasol, somebody
// with a dog, a cyclist), anglers at the water's edge with long rods.
function* riverLife(ctx, out, W, dLo, dHi) {
  const night = isNight(ctx);
  for (const { i, wx0 } of cellsAround(ctx, 44, 16)) {
    const r = makeRng(hashInts(W.ws, 2421, i));
    const wx = wx0 + 6 + 32 * r(), u = r();
    if (riverAmt(W, wx) < 0.98 || riverAmt(W, wx - 8) < 0.98 || riverAmt(W, wx + 8) < 0.98) continue;
    const rn = riverN(W, wx), sakura = noise1(wx / 2600, W.ws + 1903) > 0.3;
    if (!inD(rn - 10, dLo, dHi) || !openTo(W, wx, rn - 12)) continue;
    const shirt = () => SHIRTS[Math.floor(r() * SHIRTS.length)];
    if (sakura && u < 0.3) yield* picnic(ctx, out, W, wx, rn - 10, hashInts(W.ws, 2422, i), night);
    else if (u < (sakura ? 0.58 : 0.14)) {
      // (strollers keep to the middle of the levee top, between the riders' two sides)
      const d = rn - 6.2, k = figK(d), dir = r() < 0.5 ? 1 : -1, yaw = dir > 0 ? 0 : Math.PI, v = r();
      const y = (px) => W.H(px, d) + 0.05;
      if (v < 0.3) {
        // a couple
        yield* person(ctx, out, wx, y(wx), d, { what: 'stroller', k, yaw, pose: 'walk', top: shirt(), legs: TROUS, lamp: night });
        yield* person(ctx, out, wx + dir * 0.4 * k, y(wx), d + 1.1, { what: 'stroller', k, yaw, pose: 'walk', top: shirt(), robe: [0.3, 0.3, 0.4], longHair: true, umbrella: r() < 0.4 ? UMBRELLAS[Math.floor(r() * UMBRELLAS.length)] : null });
      } else if (v < 0.5) {
        // a parent and a child
        yield* person(ctx, out, wx, y(wx), d, { what: 'stroller', k, yaw, pose: 'walk', top: shirt(), legs: [0.3, 0.3, 0.36], longHair: r() < 0.6 });
        yield* person(ctx, out, wx + dir * 1.1 * k, y(wx), d - 0.4, { what: 'stroller', k, size: 0.62, yaw, pose: 'walk', top: [0.8, 0.7, 0.1], legs: TROUS, hat: 'cap', hatC: [0.72, 0.2, 0.2] });
      } else if (v < 0.68) {
        // in a kimono, under a paper parasol
        yield* person(ctx, out, wx, y(wx), d, { what: 'stroller', k, yaw, pose: 'walk', top: KIMONO[Math.floor(r() * KIMONO.length)], robe: KIMONO[Math.floor(r() * KIMONO.length)], sash: [0.76, 0.66, 0.3], longHair: true, umbrella: r() < 0.5 ? [0.78, 0.2, 0.16] : [0.76, 0.7, 0.56] });
      } else if (v < 0.84) {
        yield* person(ctx, out, wx, y(wx), d, { what: 'stroller', k, yaw, pose: 'walk', top: shirt(), legs: [0.3, 0.3, 0.36], hat: 'cap', hatC: WHITE, lamp: night });
        yield* dog(ctx, out, wx + dir * 1.5 * k, y(wx), d - 0.3, yaw, k);
      } else {
        // a cyclist on the levee path: riding from the middle of its ride cell, with the train on the
        // near edge and against it on the far edge, where the river runs straight for the reach,
        // with no trees along the levee and no other cyclist on the path within it (rare: mostly
        // the path runs under cherries or pines); otherwise drawn up where it is
        const fc = rideCell(wx), rnc = riverN(W, fc.wx), dc = rnc - (fc.dir > 0 ? 7.4 : 3.7);
        let ride = inD(dc, dLo, dHi) && rideable(W, 'river', fc.wx, dc) && openTo(W, fc.wx, rnc - 12);
        for (let j = i - 2; j <= i + 2 && ride; j++) { const cx = j === i ? null : riverCyclist(W, j); if (cx != null && Math.abs(cx - wx) < RIDE_REACH + 10) ride = false; }
        const o = { what: 'rider-river', k, night, top: shirt(), hat: r() < 0.5 ? 'cap' : null, hatC: WHITE };
        if (ride) yield* cyclist(ctx, out, fc.wx, W.H(fc.wx, dc) + 0.05, dc, { ...o, ride, k: figK(dc), yaw: fc.dir > 0 ? 0 : Math.PI });
        else yield* cyclist(ctx, out, wx, y(wx), d, { ...o, yaw });
      }
    } else if (u > (sakura ? 0.92 : 0.84)) {
      // an angler on the lip of the levee, the rod out over the river
      const d = rn - 2.4, k = figK(d), side = r() < 0.5 ? 1 : -1;
      yield* person(ctx, out, wx, W.H(wx, d) + 0.05, d, { what: 'angler', k, yaw: side > 0 ? 0.5 : Math.PI - 0.5, pose: r() < 0.3 ? 'sit' : 'stand', top: r() < 0.5 ? [0.72, 0.34, 0.12] : [0.2, 0.36, 0.62], legs: [0.2, 0.2, 0.24], hat: r() < 0.6 ? 'kasa' : 'cap', hatC: r() < 0.5 ? STRAW : WHITE, arms: 'fwd', tool: 'rod' });
      out(wx - side * 0.9 * k - ctx.x0, W.H(wx, d) + 0.28 * k, -d, 0.2 * k, 0.2 * k, 0.2 * k, 0.16, 0.36, 0.66, 1, 0, 0, 0, 1, KIND.OTHER, MOVE.STILL);
    }
  }
}

// A shrine's visitors: a paved approach and forecourt before the torii, banners either side, a
// shrine maiden in white and scarlet sweeping, somebody bowing to the gate, and either a festival
// procession (a banner, the portable shrine on its bearers' shoulders, followers) or a family in
// their best coming to pray.
function* shrineLife(ctx, out, W, dLo, dHi) {
  const night = isNight(ctx);
  const i0 = Math.floor((ctx.x0 - 300) / HILLCELL), i1 = Math.floor((ctx.x0 + ctx.length + 300) / HILLCELL);
  for (let i = i0; i <= i1; i++) {
    const h = hillSite(W, i);
    if (!h || !h.shrine) continue;
    const wx = h.wx + (makeRng(hashInts(h.seed, 3))() - 0.5) * h.rx * 0.3;       // as shrines() places the torii
    const dT = h.dc - h.rd * 0.93 - 6, dP = dT - 9;
    if (!inX(ctx, wx, 60) || !inD(dP, dLo, dHi) || dT > 270) continue;
    const r = makeRng(hashInts(h.seed, 21)), k = figK(dP), x = wx - ctx.x0;
    const yAt = (px, pd) => Math.max(W.H(px, pd), W.H(px, pd + 2)) + 0.16;
    // the approach (along d) and the forecourt path (along the line), pale gravel just proud of the fields
    const gs = Math.max(0.7, detail(out, dP, 2.4));
    for (let dd = dT - 15; dd < dT + 3; dd += gs) {
      for (const u of [-1.3, 1.3]) { const c = jitter(C.gravel, ctx.rng, 0.06); out(x + u, yAt(wx + u, dd) - 0.04, -dd, 1.5, 0.06, gs * 0.75, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND); }
    }
    for (let u = -34; u <= 16; u += gs) {
      const c = jitter(C.gravel, ctx.rng, 0.06);
      out(x + u, yAt(wx + u, dP) - 0.04, -dP, gs * 0.75, 0.06, 1.7, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    }
    if (out.due()) yield;
    for (const sg of [-1, 1]) for (const dd of [dT - 13, dT - 6]) yield* nobori(ctx, out, wx + sg * 5.6, yAt(wx + sg * 5.6, dd), dd, k * 0.9, sg * (dd - dT + 9) > 0 ? C.vermilion : [0.3, 0.2, 0.5]);
    // the maiden, sweeping; somebody bowing to the gate
    yield* person(ctx, out, wx + 3.2 * k, yAt(wx + 3.2 * k, dT - 2.5), dT - 2.5, { what: 'shrine', k, yaw: Math.PI - 0.3, pose: 'stand', top: WHITE, robe: C.vermilion, longHair: true, tool: 'broom', arms: 'fwd' });
    yield* person(ctx, out, wx - 1.2 * k, yAt(wx - 1.2 * k, dT - 5), dT - 5, { what: 'shrine', k, yaw: 0.7, pose: 'bow', top: SHIRTS[Math.floor(r() * SHIRTS.length)], legs: TROUS, arms: 'pray' });
    const yP = (px) => yAt(px, dP);
    if (r() < 0.55) {
      // the procession, coming along the forecourt toward the gate
      const lead = wx - 5 * k;
      yield* person(ctx, out, lead, yP(lead), dP, { what: 'shrine', k, yaw: 0, pose: 'walk', top: WHITE, robe: [0.24, 0.3, 0.56], hat: 'cap', hatC: lacquer, arms: 'fwd', lamp: night });
      yield* nobori(ctx, out, lead + 0.5 * k, yP(lead), dP + 0.2, k * 0.8, [0.42, 0.2, 0.5]);
      const mx = lead - 3.6 * k;
      yield* mikoshi(ctx, out, mx, yP(mx), dP, 0, k, night);
      for (let j = 0; j < 3; j++) {
        const px = mx - (3.3 + j * 1.3) * k, kid = j === 2;
        yield* person(ctx, out, px, yP(px), dP + (j % 2 ? 0.7 : -0.5), { what: 'shrine', k, size: kid ? 0.66 : 1, yaw: 0, pose: 'walk', top: kid ? [0.2, 0.3, 0.62] : WHITE, robe: kid ? null : KIMONO[Math.floor(r() * KIMONO.length)], legs: SKIN, sash: kid ? WHITE : [0.76, 0.66, 0.3], hat: kid ? 'cap' : null, hatC: WHITE, longHair: !kid, lamp: night && j === 0 });
      }
    } else {
      // a family coming to pray, the women in kimono
      for (let j = 0; j < 3; j++) {
        const px = wx - (4 + j * 1.5) * k, kid = j === 1;
        yield* person(ctx, out, px, yP(px), dP + (j % 2 ? 0.6 : -0.4), { what: 'shrine', k, size: kid ? 0.62 : 1, yaw: 0, pose: 'walk', top: j === 2 ? [0.2, 0.2, 0.26] : KIMONO[Math.floor(r() * KIMONO.length)], robe: j === 2 ? null : KIMONO[Math.floor(r() * KIMONO.length)], legs: TROUS, sash: j === 2 ? null : [0.76, 0.66, 0.3], longHair: j !== 2, umbrella: j === 0 ? [0.78, 0.2, 0.16] : null, lamp: night && j === 2 });
      }
    }
  }
}
const lacquer = [0.09, 0.07, 0.07];

// A temple's monks: three in file in black robes and ochre stoles crossing before the pagoda, the
// first under a wide hat with a staff, and one sweeping by the hall.
function* templeLife(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 200) / TCELL), i1 = Math.floor((ctx.x0 + ctx.length + 200) / TCELL);
  for (let i = i0; i <= i1; i++) {
    const t = templeSite(W, i);
    if (!t || t.d > 320) continue;
    const d = t.d - 17;
    if (!inD(d, dLo, dHi) || !inX(ctx, t.wx, 60)) continue;
    const k = figK(d) * 1.15, robe = [0.1, 0.1, 0.12], stole = [0.76, 0.56, 0.14], yaw = t.side > 0 ? 0 : Math.PI;
    for (let j = 0; j < 3; j++) {
      const px = t.wx + t.side * (2 - j * 1.5 * k);
      yield* person(ctx, out, px, W.H(px, d) + 0.05, d, { what: 'monk', k, yaw, pose: 'walk', top: robe, robe, sash: stole, hat: j === 0 ? 'kasa' : 'bald', tool: j === 0 ? 'staff' : null, arms: j === 0 ? 'fwd' : 'pray' });
    }
    const sx = t.wx + t.side * 20;
    yield* person(ctx, out, sx, W.H(sx, d + 4) + 0.05, d + 4, { what: 'monk', k, yaw: t.side > 0 ? Math.PI - 0.4 : 0.4, pose: 'stoop', top: [0.76, 0.5, 0.12], robe: [0.76, 0.5, 0.12], hat: 'bald', tool: 'broom', arms: 'fwd' });
  }
}

// Tea pickers on the tea hills: in twos to fives along a row on the slope facing the line, in indigo
// with red sashes and white headcloths or straw hats, a basket on the back, stooped to the bushes.
// They stand between the rows, so the row in front hides them to the knee.
function* teaLife(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 260) / HILLCELL), i1 = Math.floor((ctx.x0 + ctx.length + 260) / HILLCELL);
  for (let i = i0; i <= i1; i++) {
    const h = hillSite(W, i);
    if (!h || !h.tea || h.dc - h.rd > Math.min(dHi, 300)) continue;
    if (h.wx + h.rx < ctx.x0 - 20 || h.wx - h.rx > ctx.x0 + ctx.length + 20) continue;
    // the bamboo at the foot (as hills() places it): keep clear of those bearings
    const clumps = [], nb = Math.round(h.rx / 50);
    for (let b = 0; b < nb; b++) { const br = makeRng(hashInts(h.seed, 10, b)); const a = (br() - 0.5) * 2.2; br(); if (br() >= 0.35) clumps.push(a); }
    const qTop = hillContour(0.8), qBot = hillContour(0.04);
    const nRows = Math.max(2, Math.floor(((qBot - qTop) * h.rd) / 2.4));
    const r = makeRng(hashInts(h.seed, 31));
    const groups = 2 + Math.floor(r() * 3);
    for (let g = 0; g < groups; g++) {
      const row = 1 + Math.floor(r() * Math.min(nRows - 1, 12)), a0 = (r() - 0.5) * 1.5, n = 2 + Math.floor(r() * 4);
      const q = qBot - (row / nRows) * (qBot - qTop);
      if (row < 5 && clumps.some((c) => Math.abs(c - a0) < 0.3)) continue;
      const dd = h.dc - Math.cos(a0) * h.rd * q, k = figK(dd) * 1.15, da = (1.5 * k) / (((h.rx + h.rd) / 2) * q);
      for (let j = 0; j < n; j++) {
        const a = a0 + (j - (n - 1) / 2) * da, sa = Math.sin(a), ca = Math.cos(a);
        const px = h.wx + sa * h.rx * q, pd = h.dc - ca * h.rd * q;
        const u1 = r(), u2 = r(), u3 = r();
        if (!inD(pd, dLo, dHi) || !inX(ctx, px, 6)) continue;
        const S = surface(W, px, pd);
        if (S.t !== T.TEA) continue;
        // facing along the row, a little uphill
        const yaw = Math.atan2(sa * h.rd, ca * h.rx) + (u1 < 0.5 ? 0 : Math.PI) + 0.5;
        yield* person(ctx, out, px, S.y, pd, { what: 'tea', k, yaw, pose: u2 < 0.75 ? 'stoop' : 'stand', top: INDIGO, robe: [0.12, 0.14, 0.3], sash: [0.72, 0.16, 0.14], hat: u3 < 0.55 ? 'cap' : 'kasa', hatC: u3 < 0.55 ? WHITE : STRAW, basket: C.teaLit, arms: 'fwd' });
      }
    }
  }
}

// A small station's passengers: a handful waiting on the platform under and beside the shelter, life
// size (they are seven metres from the window).
function* platformLife(ctx, out, pf) {
  const r = makeRng(hashInts(pf.seed, 61)), sx = pf.x0 + pf.len * 0.45;
  const n = 4 + Math.floor(r() * 4);
  for (let j = 0; j < n; j++) {
    const wx = sx + (r() - 0.5) * (j < 3 ? 16 : pf.len * 0.7), d = 6.9 + 0.9 * r(), v = r(), yaw = -1.57 + (r() - 0.5) * 1.6;
    const top = SHIRTS[Math.floor(r() * SHIRTS.length)], um = r() < 0.25;
    if (v < 0.25) yield* person(ctx, out, wx, 1.04, d, { what: 'platform', k: 1, size: 0.74, yaw, top: WHITE, legs: [0.14, 0.15, 0.26], hat: 'cap', hatC: [0.8, 0.7, 0.1], pack: r() < 0.5 ? [0.72, 0.14, 0.14] : [0.1, 0.1, 0.12] });
    else if (v < 0.5) yield* person(ctx, out, wx, 1.04, d, { what: 'platform', k: 1, yaw, top: [0.16, 0.17, 0.22], legs: [0.14, 0.15, 0.2] });
    else if (v < 0.75) yield* person(ctx, out, wx, 1.04, d, { what: 'platform', k: 1, yaw, top, robe: [0.3, 0.3, 0.4], longHair: true, umbrella: um && d > 7.2 ? UMBRELLAS[Math.floor(r() * UMBRELLAS.length)] : null });
    else yield* person(ctx, out, wx, 1.04, d, { what: 'platform', k: 1, yaw, pose: 'stoop', top, robe: [0.36, 0.3, 0.3], hat: 'cap', hatC: WHITE, tool: 'staff', arms: 'fwd' });
  }
}

// A level crossing: a lane over the line between striped posts with their saltires and red lamps
// (lit: the train is passing), the striped barriers down, and somebody waiting behind them.
const CXCELL = 2300;
function crossingSite(W, i) {
  return cget(W.misc, 'x' + i, () => {
    const r = makeRng(hashInts(W.ws, 1751, i));
    if (r() > 0.7) return null;
    const wx = (i + 0.15 + 0.7 * r()) * CXCELL;
    for (let j = Math.floor(wx / PFCELL) - 1; j <= Math.floor(wx / PFCELL); j++) { const pf = platformSite(W, j); if (pf && wx > pf.x0 - 30 && wx < pf.x0 + pf.len + 30) return null; }
    return { wx, seed: hashInts(W.ws, 1752, i) };
  });
}
function crossingNear(W, wx, m) {
  const i = Math.floor(wx / CXCELL), c = crossingSite(W, i);
  return c && Math.abs(c.wx - wx) < m ? c : null;
}
function* crossing(ctx, out, W) {
  for (let i = Math.floor((ctx.x0 - 20) / CXCELL); i <= Math.floor((ctx.x0 + ctx.length + 20) / CXCELL); i++) {
    const c = crossingSite(W, i);
    if (!c || !inX(ctx, c.wx, 14)) continue;
    const x = c.wx - ctx.x0, r = makeRng(c.seed), yel = [0.8, 0.66, 0.08], blk = [0.08, 0.08, 0.08];
    const yL = (d) => Math.max(W.H(c.wx, d), d < 9 ? lerp(0.05, -1.1, (d - 4) / 5) : -9) + 0.34;
    // the lane, from the rails out to the fields
    for (let d = 6.2; d < 29.5; d += 0.8) for (const u of [-1.2, 1.2]) { const cc = jitter(C.road, ctx.rng, 0.05); out(x + u, yL(d) - 0.06, -d, 1.3, 0.1, 0.6, cc[0], cc[1], cc[2], 1, 0, 0, 0, 1, KIND.GROUND); }
    if (out.due()) yield;
    for (const sg of [-1, 1]) {
      const px = x + sg * 3.1, pd = 7.2, y0 = yL(pd) - 0.1, z = -pd;
      // the post, striped; the saltire; the two red lamps
      for (let s = 0; s < 8; s++) beam(out, px, y0 + s * 0.47, z, px, y0 + (s + 1) * 0.47, z, 0.07, s % 2 ? blk : yel, 1, 1, KIND.OTHER);
      for (const sl of [-1, 1]) for (let s = 0; s < 4; s++) {
        const t0 = s / 4 - 0.5, t1 = (s + 1) / 4 - 0.5;
        beam(out, px + t0 * 1.5, y0 + 3.45 + sl * t0 * 1.0, z + 0.1, px + t1 * 1.5, y0 + 3.45 + sl * t1 * 1.0, z + 0.1, 0.06, s % 2 ? blk : yel, 1, 1, KIND.OTHER);
      }
      for (const u of [-0.32, 0.32]) {
        out(px + u, y0 + 2.6, z + 0.12, 0.13, 0.13, 0.06, 1, 0.12, 0.06, 1, 0, 0, 0, 1, KIND.LIGHT, MOVE.CHASE);
        out(px + u, y0 + 2.6, z + 0.16, 0.5, 0.5, 0.2, 1, 0.12, 0.06, 0.16, 0, 0, 0, 1, KIND.LIGHT, MOVE.CHASE);
        out(px + u, y0 + 2.6, z + 0.04, 0.2, 0.2, 0.05, 0.08, 0.08, 0.08, 1, 0, 0, 0, 1, KIND.OTHER);
      }
      // the barrier, down across its half of the lane
      for (let s = 0; s < 6; s++) beam(out, px - sg * s * 0.5, y0 + 1.05, z - 0.5, px - sg * (s + 1) * 0.5, y0 + 1.05, z - 0.5, 0.05, s % 2 ? blk : yel, 1, 1, KIND.OTHER);
    }
    // waiting behind the barrier
    const k = 1.15, v = r();
    if (v < 0.4) yield* keiTruck(ctx, out, c.wx - 0.9, yL(14) + 0.05, 14.5, { k: 1.1, yaw: -1.57, seed: hashInts(c.seed, 3), body: WHITE, load: C.veg, night: isNight(ctx) });
    else if (v < 0.7) yield* cyclist(ctx, out, c.wx - 0.8, yL(10.5), 10.8, { what: 'crossing', k, yaw: -1.2, night: isNight(ctx), top: WHITE, hat: 'cap', hatC: WHITE, pack: [0.14, 0.14, 0.2] });
    else { yield* person(ctx, out, c.wx - 1.2, yL(10), 10.2, { what: 'crossing', k, yaw: -1.3, top: SHIRTS[Math.floor(r() * SHIRTS.length)], legs: [0.3, 0.3, 0.36], hat: 'kasa' }); yield* dog(ctx, out, c.wx - 2.3, yL(10), 10.0, -0.6, k); }
    for (let j = 0; j < 2; j++) {
      if (r() < 0.3) continue;
      yield* person(ctx, out, c.wx + 0.6 + j * 0.9, yL(9.6), 9.7 + j * 0.5, { what: 'crossing', k, size: 0.74, yaw: -1.57 + (r() - 0.5) * 0.6, top: WHITE, legs: [0.14, 0.15, 0.26], hat: 'cap', hatC: [0.8, 0.7, 0.1], pack: j ? [0.72, 0.14, 0.14] : [0.1, 0.1, 0.12], umbrella: r() < 0.6 ? UMBRELLAS[Math.floor(r() * UMBRELLAS.length)] : null });
    }
  }
}

// Scattered things in the fields: persimmons and broadleaves by the bunds, bamboo clumps, a carp
// streamer pole by a farmhouse, a lone cherry.
function* fieldTrees(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, 60, 12)) {
    const r = makeRng(hashInts(W.ws, 2101, i));
    if (r() > 0.28) continue;
    const wx = wx0 + 60 * r(), d = dLo + (dHi - dLo) * Math.pow(r(), 1.2);
    if (!inX(ctx, wx, 12) || !inD(d, dLo, dHi)) continue;
    const S = surface(W, wx, d);
    // (not on a farm lane, nor so close that its crown hangs over the riders)
    if ((S.t !== T.PADDY && S.t !== T.BANK) || onLane(W, d, 3)) continue;
    const y = S.y - 0.1, u = r();
    if (u < 0.35) yield* persimmon(ctx, out, wx - ctx.x0, d, y, r);
    else if (u < 0.6) yield* bamboo(ctx, out, wx - ctx.x0, d, { rng: r, height: 8 + 5 * r(), width: 5 + 5 * r(), y });
    else if (u < 0.72) yield* cherry(ctx, out, wx - ctx.x0, d, y, r);
    else yield* treeOf(ctx, out, { wx, type: 'broad' }, d, y, r);
  }
}

// Lake shores: pines and broadleaves round the near shore.
function* lakeShores(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 1000) / LCELL), i1 = Math.floor((ctx.x0 + ctx.length + 1000) / LCELL);
  for (let i = i0; i <= i1; i++) {
    const l = lakeSite(W, i);
    if (!l) continue;
    const n = Math.round((l.rx + l.rd) * 2.2 / 22);
    for (let k = 0; k < n; k++) {
      const r = makeRng(hashInts(l.seed, 4, k));
      const a = (k / n) * Math.PI * 2 + 0.3 * r(), e = 1.14 + 0.08 * r();
      const tx = l.wx + Math.sin(a) * l.rx * e, td = l.dc - Math.cos(a) * l.rd * e;
      const pick = r();
      if (!inD(td, dLo, dHi) || !inX(ctx, tx, 10) || pick < 0.3 || blocked(W, tx, td, -1.3)) continue;
      yield* treeOf(ctx, out, { wx: tx, type: pick < 0.6 ? 'pine' : pick < 0.75 ? 'cherry' : 'broad' }, td, W.H(tx, td) - 0.1, r);
    }
  }
}

// Mid-distance groves of dark cedar and broadleaf on the plain.
function* groves(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, 120, 30)) {
    const r = makeRng(hashInts(W.ws, 2201, i));
    for (let k = 0; k < 2; k++) {
      if (r() > 0.42) { r(); r(); r(); r(); continue; }
      const wx = wx0 + r() * 120, d = dLo + (dHi - dLo) * Math.pow(r(), 1.4);
      const S = surface(W, wx, d);
      if (S.t !== T.PADDY && S.t !== T.FUJI) { r(); continue; }
      const y = S.y, Wd = 15 + 35 * r(), gh = 7 + 5 * r();
      const gs = detail(out, d, 0.9);
      // (a grove is one mass 15 to 50 m across: it keeps still. Swelling, it would heave like a hill;
      // the trees that answer the beat are the ones drawn as trees.)
      yield* blob(ctx, out, wx - ctx.x0, y + gh * 0.8, d, Wd, gh, Wd * 0.35, { n: Math.round(clamp(Wd * gh * 3 / (gs * gs), 24, 500)), color: r() < 0.5 ? C.cedar : C.wood, rng: r, kind: KIND.HEDGE, inner: 0.3, amb: 0.55 });
    }
  }
}

// Raised bunds along the paddy rows (parallel to the line): a flat strip there is far less than a
// pixel tall from rail level, so they are drawn as low ridges.
function* bunds(ctx, out, W, dLo, dHi) {
  const Pc = 20;
  for (let k = 1; k < W.rows.length; k++) {
    const q = W.rows[k];
    if (q.D < dLo - 2) continue;
    if (q.D > dHi) break;
    const st = Math.max(0.5, detail(out, q.D, 2.2)), d = q.D;
    for (const { wx0 } of cellsAround(ctx, Pc, 0)) {
      for (let wx = wx0 + st / 2; wx < wx0 + Pc; wx += st) {
        const S = surface(W, wx, d + 0.6);
        if (S.t !== T.PADDY) continue;
        if (q.lane) {
          // a farm lane: a grass bank with the pale track along its top
          const top = laneTop(d), lw = laneW(d), g = jitter(C.bundLit, ctx.rng, 0.12), c = jitter(C.lane, ctx.rng, 0.05);
          out(wx - ctx.x0, S.y + top * 0.45, -(d + lw * 0.5), st * 0.75, top * 0.5, lw * 0.5, g[0], g[1], g[2], 1, 0, 0, 0, 1, KIND.GROUND);
          out(wx - ctx.x0, S.y + top + 0.03, -(d + lw * 0.42), st * 0.75, 0.05, lw * 0.4, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
          continue;
        }
        const bh = 0.2 + 0.0012 * d;
        const c = jitter(S.info.t === P.DRY ? C.soil : C.bundLit, ctx.rng, 0.12);
        out(wx - ctx.x0, S.y + bh, -d, st * 0.75, bh, Math.max(0.3, st * 0.25), c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      }
      if (out.due()) yield;
    }
  }
}

// The lineside: cable trough, a platform now and then, a post-and-wire fence.
function* lineside(ctx, out, W) {
  const tStep = 0.45 / Math.min(1, Math.sqrt(out.density));
  for (let x = tStep / 2; x < ctx.length; x += tStep) {
    const y = Math.max(W.H(ctx.x0 + x, 4.5), -0.6) + 0.12;
    out(x, y, -4.5, tStep * 0.68, 0.1, 0.22, 0.6, 0.59, 0.55, 1, 0, 0, 0, 1, KIND.OTHER);
    if (out.due()) yield;
  }
  const night = isNight(ctx);
  const i0 = Math.floor((ctx.x0 - 200) / PFCELL), i1 = Math.floor((ctx.x0 + ctx.length) / PFCELL);
  let onPf = null;
  for (let i = i0; i <= i1; i++) {
    const pf = platformSite(W, i);
    if (!pf) continue;
    const a = Math.max(0, pf.x0 - ctx.x0), b = Math.min(ctx.length, pf.x0 + pf.len - ctx.x0);
    if (b <= a) continue;
    onPf = pf;
    yield* platformLife(ctx, out, pf);
    const st = 0.4;
    for (let x = a + st / 2; x < b; x += st) {
      out(x, 0.5, -2.75, st * 0.7, 0.5, 0.1, 0.52, 0.51, 0.48, 1, 0, 0, 0, 1, KIND.OTHER);
      for (let d = 2.9; d < 8.6; d += 0.45) {
        const c = d > 3.3 && d < 3.65 ? [0.78, 0.66, 0.1] : d < 3.05 ? [0.76, 0.76, 0.74] : jitter([0.56, 0.55, 0.52], ctx.rng, 0.04);
        out(x, 1.02, -d, st * 0.7, 0.04, 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
      }
      if (out.due()) yield;
    }
    for (let wx = Math.ceil(pf.x0 / 18) * 18; wx < pf.x0 + pf.len; wx += 18) {
      const x = wx - ctx.x0;
      if (x < 0 || x >= ctx.length) continue;
      strut(out, x, 1.0, -6.6, x, 5.4, -6.6, 0.07, [0.42, 0.44, 0.45], 4, 1, KIND.OTHER);
      if (night) {
        out(x, 5.3, -6.3, 0.5, 0.06, 0.12, 1, 0.97, 0.9, 1, 0, 0, 0, 1, KIND.LIGHT, MOVE.CHASE);
        out(x, 5.2, -6.2, 1.2, 0.8, 0.5, 1, 0.97, 0.9, 0.12, 0, 0, 0, 1, KIND.LIGHT, MOVE.CHASE);
      } else out(x, 5.3, -6.4, 0.5, 0.06, 0.12, 0.7, 0.7, 0.68, 1, 0, 0, 0, 1, KIND.OTHER);
    }
    const sx = pf.x0 + pf.len * 0.45 - ctx.x0;
    if (sx > -20 && sx < ctx.length + 20) {
      // shelter: posts, a flat canopy, a bench; the station name board; vending machines
      for (let u = -9; u <= 9; u += 4.5) strut(out, sx + u, 1.0, -7.4, sx + u, 3.9, -7.4, 0.08, [0.36, 0.38, 0.4], 3, 1, KIND.OTHER);
      for (let u = -10; u <= 10; u += 0.6) for (let dd = 6.6; dd < 8.6; dd += 0.6) out(sx + u, 3.95, -dd, 0.42, 0.07, 0.42, 0.44, 0.46, 0.48, 1, 0, 0, 0, 1, KIND.OTHER);
      for (let u = -5; u <= 5; u += 0.5) out(sx + u, 1.5, -8.0, 0.35, 0.06, 0.25, 0.3, 0.28, 0.24, 1, 0, 0, 0, 1, KIND.OTHER);
      const bx = sx + 16;
      for (const u of [-1, 1]) strut(out, bx + u, 1.0, -6.8, bx + u, 3.1, -6.8, 0.05, [0.4, 0.4, 0.42], 2, 1, KIND.OTHER);
      for (let u = -1.4; u <= 1.41; u += 0.35) for (let v = 0; v < 3; v++) {
        const c = v === 1 ? [0.12, 0.12, 0.14] : [0.78, 0.78, 0.76];
        out(bx + u, 2.55 + v * 0.22, -6.78, 0.24, 0.12, 0.03, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
      }
      yield* vending(ctx, out, sx - 15, 1.0, 7.4, pf.seed);
    }
  }
  // the boundary fence (beyond 6 m), posts as struts, wires between
  if (!onPf) {
    const FD = 7.6;
    for (const { x } of cellsAround(ctx, 2.6, 0)) {
      if (x < 0 || x >= ctx.length || crossingNear(W, ctx.x0 + x, 4.4)) continue;
      const y0 = W.H(ctx.x0 + x, FD);
      strut(out, x, y0 - 0.1, -FD, x, y0 + 1.25, -FD, 0.05, [0.5, 0.5, 0.48], 2, 1, KIND.FENCE);
      if (out.due()) yield;
    }
    const mStep = 0.35 / Math.min(1, Math.sqrt(out.density));
    for (let x = mStep / 2; x < ctx.length; x += mStep) {
      if (crossingNear(W, ctx.x0 + x, 4.2)) continue;
      const y0 = W.H(ctx.x0 + x, FD);
      for (const t of [0.5, 1.1]) out(x, y0 + t, -FD, mStep * 0.66, 0.012, 0.012, 0.3, 0.3, 0.28, 0.9, 0, 0, 0, 1, KIND.FENCE);
      if (out.due()) yield;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Level 1
// ---------------------------------------------------------------------------------------------
// Scale: a torii vast enough to frame Fuji's summit, standing on the plain in front of it.
function* giantTorii(ctx, out, W, dLo, dHi, scale) {
  const d = 2300;
  if (!inD(d, dLo, dHi)) return;
  const i0 = Math.floor((ctx.x0 - 3000) / FCELL), i1 = Math.floor((ctx.x0 + ctx.length + 3000) / FCELL);
  for (let i = i0; i <= i1; i++) {
    const r = makeRng(hashInts(W.ws, 3050, i));
    if (r() > 0.75) continue;
    const wx = (i + 0.2 + 0.6 * r()) * FCELL;
    if (!inX(ctx, wx, 1600)) continue;
    const H = (3450 / FUJI_D) * d * (1.1 + 0.25 * scale);
    yield* torii(ctx, out, wx - ctx.x0, W.H(wx, d) - 2, d, H, KIND.SURREAL, 0);
  }
}
// Topology: carp the size of airships swimming through the sky.
function* skyCarp(ctx, out, W, dLo, dHi, topo) {
  for (const { i, wx0 } of cellsAround(ctx, 1500, 300)) {
    const r = makeRng(hashInts(W.ws, 2301, i));
    if (r() > 0.6 * topo + 0.2) continue;
    const wx = wx0 + 1500 * r(), d = 800 + 1700 * r();
    if (!inD(d, dLo, dHi)) continue;
    const L = 80 + 120 * r(), y = 120 + 260 * r(), dir = r() < 0.5 ? 1 : -1;
    const col = [[0.09, 0.09, 0.12], [0.78, 0.15, 0.1], [0.12, 0.26, 0.64], [0.8, 0.5, 0.1]][Math.floor(r() * 4)];
    const n = 18, ph = r() * 6, rb = L * 0.09;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const px = wx + dir * (t - 0.5) * L, py = y + L * 0.06 * Math.sin(t * 4 + ph);
      const rr = rb * (t < 0.15 ? 0.75 + t : 1 - 0.55 * (t - 0.15));
      const c = k % 3 === 1 ? mul3(col, 0.75) : col;
      out(px - ctx.x0, py, -(d + L * 0.04 * Math.cos(t * 3 + ph)), L / n * 0.75, rr, rr * 0.9, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.SURREAL, MOVE.FLAG);
    }
    const hx = wx - dir * L * 0.45;
    for (const sz of [-1, 1]) out(hx - ctx.x0, y + rb * 0.2, -(d + sz * rb * 0.85), rb * 0.3, rb * 0.3, rb * 0.1, 0.8, 0.8, 0.78, 1, 0, 0, 0, 1, KIND.SURREAL, MOVE.FLAG);
    for (const sy of [-1, 1]) out(wx + dir * L * 0.55 - ctx.x0, y + sy * rb * 0.5, -d, L * 0.07, rb * 0.5, rb * 0.15, col[0], col[1], col[2], 1, 0, 0, 0, 1, KIND.SURREAL, MOVE.FLAG);
    if (out.due()) yield;
  }
}
// Topology, at dusk and by night: paper lanterns rising from a village into the sky.
function* risingLanterns(ctx, out, W, v, dLo, dHi, topo) {
  const r = makeRng(hashInts(v.seed, 41));
  const n = 18 + Math.floor(30 * r() * topo);
  for (let k = 0; k < n; k++) {
    const wx = v.cx + (r() - 0.5) * v.R * 2.4, d = v.dc + (r() - 0.5) * v.Rd * 2;
    const y = 12 + Math.pow(r(), 1.5) * 260;
    if (!inD(d, dLo, dHi) || !inX(ctx, wx, 0)) continue;
    const c = r() < 0.7 ? [1, 0.62, 0.26] : [1, 0.8, 0.45];
    out(wx - ctx.x0, y, -d, 0.45, 0.55, 0.45, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.LIGHT, MOVE.VAPOUR);
    out(wx - ctx.x0, y, -(d + 0.3), 1.8, 1.8, 0.8, c[0], c[1], c[2], 0.13, 0, 0, 0, 1, KIND.LIGHT, MOVE.VAPOUR);
  }
  if (out.due()) yield;
}

// ---------------------------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------------------------
function* trackside(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 1, detailK: 1.2 });
  out.limit = ctx.count * 0.5;
  yield* overheadLine(ctx, out, ctx.beatMetres || 56, { d: 3.7 });
  // the people first (a few hundred splats at most): nothing later may crowd them out
  yield* crossing(ctx, out, W);
  yield* roadLife(ctx, out, W, ctx.zNear, 28.4, 0.75);
  yield* lineside(ctx, out, W);
  yield* bunds(ctx, out, W, 9, ctx.zFar);
  yield* roadside(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* villages(ctx, out, W, 22, ctx.zFar, { small: true });
  out.limit = Infinity;
  const rest = out.left();
  yield* fillStrip(ctx, out, W, Math.round(rest * 0.06), 2.5, 4.2, (wx, d, rng) => jitter(C.ballast, rng, 0.25), 0, 0.12);
  yield* fillStrip(ctx, out, W, Math.round(rest * 0.05), 4.2, 6.2, (wx, d, rng) => jitter(C.cess, rng, 0.18), 0, 0.12);
  yield* fillSurface(ctx, out, W, { dNear: 6.2, power: 1.2, cover: 4.2, tuft: 30 });
}

function* near(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.15 });
  const dz = ctx.dials || {};
  const lo = ctx.zNear, hi = ctx.zFar;
  // the hills first: their skins must never be cut short
  yield* hills(ctx, out, W, lo, hi);
  // the people next, before the limit on props: a few hundred splats, never crowded out
  yield* paddyLife(ctx, out, W, lo, hi);
  yield* laneLife(ctx, out, W, lo, hi);
  yield* roadLife(ctx, out, W, 33, 60, 1);
  yield* riverLife(ctx, out, W, lo, hi);
  yield* shrineLife(ctx, out, W, lo, hi);
  yield* templeLife(ctx, out, W, lo, hi);
  yield* teaLife(ctx, out, W, lo, hi);
  out.limit = Math.min(ctx.count * 0.88, out.n + ctx.count * 0.55);
  yield* bunds(ctx, out, W, lo, 140);
  yield* roadside(ctx, out, W, lo, hi);
  yield* villages(ctx, out, W, lo, hi, { small: true, topo: dz.topology || 0 });
  yield* shrines(ctx, out, W, lo, hi);
  yield* temples(ctx, out, W, lo, hi, dz.scale || 0);
  yield* riverside(ctx, out, W, lo, hi, dz.matter || 0);
  yield* greenhouses(ctx, out, W, lo, hi);
  yield* golfNets(ctx, out, W, lo, hi);
  yield* fieldTrees(ctx, out, W, lo, hi);
  yield* lakeShores(ctx, out, W, lo, hi);
  yield* fillSurface(ctx, out, W, { power: 1.5, cover: 3.2 });
}

function* mid(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.6, zMargin: 120 });
  const dz = ctx.dials || {};
  const lo = ctx.zNear, hi = ctx.zFar;
  yield* hills(ctx, out, W, lo, hi);
  out.limit = Math.min(ctx.count * 0.85, out.n + ctx.count * 0.55);
  yield* viaduct(ctx, out, W, lo, hi);
  yield* villages(ctx, out, W, lo, hi, { coarse: 1.3, topo: dz.topology || 0 });
  yield* shrines(ctx, out, W, lo, hi);
  yield* temples(ctx, out, W, lo, hi, dz.scale || 0);
  yield* golfNets(ctx, out, W, lo, hi);
  yield* lakeShores(ctx, out, W, lo, hi);
  yield* hamlets(ctx, out, W, lo, hi);
  yield* groves(ctx, out, W, lo, hi);
  if ((dz.scale || 0) > 0) yield* giantTorii(ctx, out, W, lo, hi, dz.scale);
  if ((dz.topology || 0) > 0) yield* skyCarp(ctx, out, W, lo, hi, dz.topology);
  yield* fillSurface(ctx, out, W, { power: 1.2, cover: 3, maxR: 0.05 });
}

const FUJI_SHARE = 0.62;
function* far(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 600 });
  const dz = ctx.dials || {};
  out.limit = Infinity;
  const logic = dz.logic || 0;
  if (logic > 0) {
    for (const { i } of cellsAround(ctx, RCELL, 3000)) {
      const c = ringCone(W, i);
      if (!c) continue;
      const load = groupLoad(W, 'r:' + i, [c]);
      yield* drawCones(ctx, out, W, [c], Math.sqrt(load / (0.06 * ctx.count)), KIND.SURREAL);
    }
  }
  yield* fillFar(ctx, out, W);
}

// The one mountain, drawn in its own coordinates (its axis at x = 0, FUJI_D out) for the engine's
// backdrop mesh: the cone (and at level 1 its smaller twin) and its cloud.
const BD = { x0: -16000, length: 32000, zNear: 1500, zFar: 21000, pivot: FUJI_D };
function latticePoints(cones, delta) {
  let n = 0;
  for (const c of cones) {
    const { rho } = coneRows(c, delta);
    for (let k = 0; k < rho.length; k++) for (const sg of [1, -1]) {
      let th = sg * colStep(c, rho[k], 0, delta) * 0.5;
      while (Math.abs(th) < AM) { n++; th += sg * colStep(c, rho[k], th, delta); }
    }
  }
  return n;
}
function* backdrop(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  ctx.flatBase = -1;                       // it stands on a level plain: the real one scrolls beneath it
  const out = makeOut(ctx, emit, { zMargin: 600 });
  out.limit = Infinity;
  const cones = fujiGroup(W, theFuji(W), (ctx.dials || {}).logic || 0);
  // the lattice spacing that spends this mesh's splats on the cones (points go as 1 / spacing^2)
  const delta = D0 * Math.sqrt(latticePoints(cones, D0) / (0.97 * ctx.count));
  yield* drawCones(ctx, out, W, cones, delta, KIND.ROCK);
  for (const c of cones) yield* fujiClouds(ctx, out, W, c);
}
// Where it stands in the window: a slow drift from side to side (at most a seventh of the train's
// own speed, and never out of view, whatever the window's shape) and a slow turn of up to 24
// degrees, as if the line were bending round the mountain. A new stretch of scenery starts it
// somewhere else.
function backdropPose(travelled, seed, tanHalfHfov = 0.83) {
  const a = ((seed >>> 4) % 6283) / 1000, b = ((seed >>> 13) % 6283) / 1000;
  const reach = Math.min(3400, 0.4 * FUJI_D * tanHalfHfov);
  return { x: reach * Math.sin(travelled / 26000 + a), yaw: 0.42 * Math.sin(travelled / 17000 + b) };
}

export const fujiBiome = {
  name: 'fuji',
  palette: PAL,
  terrain: TERRAIN,
  // a clear day: Fuji, 11 km out, keeps about half its contrast
  hazeDist: 16000,
  // the trackside is mostly ground under motion blur
  shares: { trackside: 0.13, near: 0.35, mid: 0.24, far: 0.17 },
  // the mountain itself: one mesh that stays with the journey
  backdrop: { share: 0.11, ...BD, generate: backdrop, pose: backdropPose },
  // Fuji stays still on the beat: trees (KIND.TREE), buildings (houses, pagoda, torii, lanterns,
  // viaduct) and lights answer it, as do the hills' emergent broadleaves and the groves (KIND.HEDGE
  // blobs tagged MOVE.BEAT); tea rows and hedges do not. The greenhouse tunnels, carts, the portable
  // shrine, picnic boxes and the angler's bucket are rigid (MOVE.STILL); people and birds flash on it
  // (MOVE.FLASH) and cyclists ride (MOVE.RIDE)
  beatKinds: [KIND.TREE, KIND.BUILDING, KIND.LIGHT],
  sky: { clear: 0.55 },
  generators: { trackside, near, mid, far },
};

// ---------------------------------------------------------------------------------------------
// For scripts that inspect the layout, e.g.
//   const { _debug } = await import('./src/window/biomes/fuji.js');
//   _debug.layout('7', 0, 80000)   -> { fujis, hills, lakes, villages, ... }
// Each entry has world x (wx) and distance (d); jump=<wx> in the previewer centres it.
// ---------------------------------------------------------------------------------------------
function at(seedStr) {
  const terrain = makeTerrain(hashString(String(seedStr)), TERRAIN);
  const W = world({ terrain });
  return { W, ctx: { terrain: W.terr, x0: 0, length: 1 } };
}
function layout(seedStr, x0, x1) {
  const { W } = at(seedStr);
  const list = (cell, fn, map) => { const res = []; for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) { const o = fn(W, i); if (o) res.push(map(o)); } return res; };
  const r = (v) => Math.round(v);
  return {
    fujis: list(FCELL, fujiSite, (f) => ({ wx: r(f.wx), d: r(f.d), H: r(f.H), R: r(f.R), belt: f.belt, cap: f.cap, bank: f.bank })),
    hills: list(HILLCELL, hillSite, (h) => ({ wx: r(h.wx), d: r(h.dc), H: r(h.Hh), tea: h.tea, shrine: h.shrine })),
    lakes: list(LCELL, lakeSite, (l) => ({ wx: r(l.wx), d: r(l.dc), rx: r(l.rx), rd: r(l.rd) })),
    villages: list(VCELL, village, (v) => ({ wx: r(v.cx), d: r(v.dc), houses: v.houses.length })),
    houses: list(VCELL, village, (v) => v.houses.map((h) => ({ wx: r(h.wx), d: r(h.d), storeys: h.storeys, hip: h.hip, koi: h.koi }))).flat(),
    torii: list(HILLCELL, hillSite, (h) => (h.shrine ? { wx: r(h.wx + (makeRng(hashInts(h.seed, 3))() - 0.5) * h.rx * 0.3), d: r(h.dc - h.rd * 0.93 - 6) } : null)).filter(Boolean),
    temples: list(TCELL, templeSite, (t) => ({ wx: r(t.wx), d: r(t.d), hallWx: r(t.wx + t.side * 26) })),
    golf: list(GCELL, golfSite, (g) => ({ wx: r(g.wx), d: r(g.d), len: r(g.len) })),
    platforms: list(PFCELL, platformSite, (p) => ({ wx: r(p.x0), len: r(p.len) })),
    crossings: list(CXCELL, crossingSite, (c) => ({ wx: r(c.wx) })),
    lanes: W.rows.filter((q) => q.lane).map((q) => r(q.D)),
    hamlets: list(HMCELL, hamlet, (h) => ({ wx: r(h.cx), d: r(h.dc), houses: h.houses.length })),
    river: (() => { const res = []; let on = false, a = 0; for (let x = x0; x <= x1; x += 50) { const v = riverAmt(W, x) > 0.6; if (v && !on) a = x; if (!v && on) res.push({ wx0: a, wx1: x, d: r(riverN(W, a)) }); on = v; } return res; })(),
    viaduct: (() => { const res = []; let on = false, a = 0; for (let x = x0; x <= x1; x += 100) { const v = viaOn(W, x); if (v && !on) a = x; if (!v && on) res.push({ wx0: a, wx1: x, d: r(viaD(W, a)) }); on = v; } return res; })(),
  };
}
export const _debug = { world, at, layout, heightAt, surface, fujiSite, fujiAt, coneHeight, groupLoad, coneRows };
