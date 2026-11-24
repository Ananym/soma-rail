// "Himalaya": a high, narrow Himalayan valley in late spring. The railway runs along one side of
// it; the ground falls away from the line to a stony bed with a braided grey-blue glacial river,
// and a few hundred metres beyond it a mountain wall rises over the window: spurs coming down to
// the valley floor with gullies and couloirs between them, cliff bands, scree fans, side valleys
// with a glacier snout or a torrent, villages of flat-roofed whitewashed and stone houses on
// terraced benches low down, a monastery (gompa) perched on a spur now and then, snow lying in the
// gullies and on the ledges above. Behind and between its summits stands the great range: huge
// snow-and-rock peaks with glaciers and cloud banners.
// Near the line: yaks grazing in loose herds, blue sheep on rocky outcrops, chortens, mani walls,
// tall prayer-flag poles and prayer-flag bunting everywhere, and suspension footbridges across
// the river hung with flags.
//
// What grows (see "Land cover"): the valley changes along the line between high bare stretches
// (frost grass, tussocks, juniper, old snow in the hollows, bare poplars) and lower lush ones, which
// are most of it: fir and blue pine forest on the shaded flanks and gullies of the lower wall up to
// a ragged tree line, birch along the river, a belt of rhododendron in flower above the trees,
// stands of tall firs and birches on the near slope, terraced barley, buckwheat and mustard in
// walled plots stepping down to the river and on the fans across it, poplars and willows in leaf
// about the houses, flowers by the line.
// Scale: the valley was found sparse because its human things were true to size and far away. They
// are now built larger than life (village houses 1.6 times, monasteries 1.5, hamlet houses 1.4,
// yaks 1.8 to 2.3, people 1.6) and nearer; shrines stand 31-40 m from the line every kilometre or
// so, and a footpath with people on it runs the whole way along the near slope.
//
// Structure (as karst.js): one pure layout of WORLD x and distance, hashed from the world seed and
// cached per world: the valley profile, villages, monasteries, hamlets, flag sites, herds, blue
// sheep, bridges and the giant peaks. Every band reads from it and draws what falls inside it, so
// nothing jumps at a chunk seam or a band border. Strings of flags and bridges cross band borders
// and are drawn piecewise (each band draws the segments whose distance lies in the band).
//
// Terrain: the shared terrain.js cannot fall to a river and rise again, so this file has its own
// height function and hands it to the kit through a copy of ctx (local() below): every kit call
// gets that copy, so props stand on the valley.
//
// Surreal dials (all 0 at level 0, so level 0 shows none of this):
//   scale     needle peaks far taller and thinner than any real mountain; a giant yak standing on a
//             spur of the wall; strings of prayer flags the size of houses crossing the valley
//   topology  the top tier of a village and the monastery hall floating clear of the slope above
//             their places, and strings of flags rising from the monasteries into the sky to the
//             summits and running peak to peak
//   logic     the same chorten repeating along the line, each copy a little more wrong
import { hashInts, hashString, makeRng } from '../rng.js';
import { makeTerrain } from '../terrain.js';
import {
  KIND, MOVE, makeOut, worldSeed, worldRng, cellsAround, detail, shade, jitter, mul3, mix3, smooth,
  clamp, lerp, norm3, quatXTo, quatYaw, quatUpTo, quatMul, quatAxis, quatPitch, overheadLine, blob, strut, house,
  rotY, SUN,
  facetRock,
} from './kit.js';

const PAL = {
  ground: [0.5, 0.44, 0.32],     // frost-dry grass: also the backdrop below the horizon
  foliage: [0.14, 0.2, 0.13],
  rock: [0.4, 0.38, 0.36],
  ballast: [0.42, 0.41, 0.4],
};

// Colours. Natural surfaces stay <= 0.8 per channel (kit.js caps them anyway).
const C = {
  ballast: [0.42, 0.41, 0.4],
  shelf: [0.46, 0.41, 0.34],
  grass: [0.62, 0.55, 0.35],        // frost-yellow grass
  grassDry: [0.5, 0.42, 0.28],
  grassDark: [0.36, 0.32, 0.22],
  stone: [0.52, 0.5, 0.47],
  stoneDark: [0.34, 0.33, 0.32],
  wallStone: [0.5, 0.46, 0.4],
  bed: [0.57, 0.56, 0.53],
  bedDark: [0.43, 0.43, 0.42],
  water: [0.44, 0.56, 0.62],
  waterDeep: [0.3, 0.42, 0.5],
  ice: [0.72, 0.77, 0.8],
  snow: [0.8, 0.8, 0.8],
  snowShade: [0.5, 0.56, 0.68],
  rock: [0.4, 0.37, 0.35],
  rockDark: [0.24, 0.23, 0.23],
  rockPale: [0.6, 0.56, 0.5],
  rockWarm: [0.5, 0.39, 0.3],
  scree: [0.52, 0.5, 0.47],
  screeDark: [0.38, 0.36, 0.34],
  screeWarm: [0.58, 0.48, 0.38],
  juniper: [0.13, 0.19, 0.12],
  barley: [0.68, 0.58, 0.32],
  barleyGreen: [0.4, 0.48, 0.2],
  plough: [0.42, 0.33, 0.24],
  riser: [0.34, 0.31, 0.27],
  yard: [0.52, 0.46, 0.37],
  mist: [0.78, 0.79, 0.8],
  white: [0.79, 0.78, 0.74],        // whitewash
  maroon: [0.42, 0.1, 0.08],        // the dark red band of a gompa
  parapet: [0.24, 0.14, 0.1],       // brushwood edging of a flat roof
  roof: [0.46, 0.41, 0.34],         // beaten earth roof
  window: [0.07, 0.06, 0.06],
  gold: [0.8, 0.62, 0.2],
  ochre: [0.72, 0.56, 0.28],
  wood: [0.42, 0.34, 0.25],
  bark: [0.42, 0.38, 0.32],
  pole: [0.46, 0.39, 0.3],
  cord: [0.3, 0.28, 0.25],
  horn: [0.78, 0.74, 0.64],
  // what grows (the lower, lusher stretches)
  turf: [0.36, 0.47, 0.19], turfGold: [0.52, 0.52, 0.22], turfDark: [0.22, 0.32, 0.14],
  alp: [0.38, 0.46, 0.2], alpGold: [0.55, 0.5, 0.24],
  forest: [0.085, 0.15, 0.1], forestLit: [0.13, 0.21, 0.11], birchWood: [0.3, 0.4, 0.15],
  fir: [0.075, 0.15, 0.1], pine: [0.15, 0.24, 0.19], birch: [0.31, 0.43, 0.16], birchBark: [0.72, 0.7, 0.64],
  poplar: [0.3, 0.44, 0.15], willow: [0.38, 0.47, 0.2], rhodo: [0.09, 0.2, 0.1],
};
// Rhododendron in flower: crimson, rose, pale pink, magenta, white.
const BLOOM = [[0.78, 0.1, 0.17], [0.8, 0.3, 0.46], [0.8, 0.56, 0.66], [0.62, 0.12, 0.4], [0.8, 0.78, 0.74]];
// Crops, field by field: green barley, ripe barley, buckwheat in flower, mustard, potatoes, plough.
// (mostly greens and golds: with more than a plot in ten of pink or yellow the valley turned into a
// bulb farm)
const CROPS = [[0.35, 0.47, 0.2], [0.45, 0.52, 0.24], [0.62, 0.54, 0.3], [0.68, 0.57, 0.55], [0.68, 0.62, 0.22], [0.22, 0.35, 0.17], [0.42, 0.33, 0.24]];
const cropOf = (u) => CROPS[u < 0.32 ? 0 : u < 0.56 ? 1 : u < 0.73 ? 2 : u < 0.78 ? 3 : u < 0.82 ? 4 : u < 0.92 ? 5 : 6];
// Alpine flowers by the line, in drifts of one or two colours.
const FLOWERS = [[0.8, 0.72, 0.14], [0.5, 0.3, 0.72], [0.8, 0.4, 0.56], [0.8, 0.8, 0.76], [0.24, 0.4, 0.78]];
// Prayer flags: blue, white, red, green, yellow, always in that order. Saturated, capped at 0.8.
const FLAGS = [[0.1, 0.28, 0.72], [0.8, 0.8, 0.78], [0.76, 0.12, 0.09], [0.08, 0.52, 0.24], [0.8, 0.66, 0.08]];
const YAKS = [[0.085, 0.072, 0.064], [0.1, 0.08, 0.07], [0.19, 0.12, 0.075], [0.075, 0.065, 0.06], [0.28, 0.25, 0.23]];
const HOUSE_WALLS = [C.white, C.white, [0.77, 0.76, 0.71], [0.74, 0.72, 0.67], [0.5, 0.46, 0.4], [0.56, 0.5, 0.42]];
const LIT = [1.0, 0.78, 0.46];

const TERRAIN = { cutting: 1.0 };

// ---------------------------------------------------------------------------------------------
// Fast value noise (rng.js hashes with rest arguments, which allocate; this biome calls it a lot)
// ---------------------------------------------------------------------------------------------
function hh(ix, iy, s) {
  let h = Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise1(x, s = 0) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const a = hh(i, 0, s);
  return a + (hh(i + 1, 0, s) - a) * u;
}
function noise2(x, y, s = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const a = hh(ix, iy, s), b = hh(ix + 1, iy, s), c = hh(ix, iy + 1, s), d = hh(ix + 1, iy + 1, s);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm2(x, y, s = 0, oct = 4) {
  let amp = 0.5, sum = 0, norm = 0;
  for (let o = 0; o < oct; o++) { sum += amp * noise2(x, y, s + o * 101); norm += amp; x *= 2.03; y *= 2.03; amp *= 0.5; }
  return sum / norm;
}
const sq = (v) => v * v;
const ridge = (v) => 1 - Math.abs(2 * v - 1);

// ---------------------------------------------------------------------------------------------
// Terrain: a narrow valley under a mountain wall
//   0 .. 7 m      ballast and a narrow shelf
//   7 .. bn       the near slope, falling (concave, so all of it is in view) to the valley floor,
//                 bn 145-225 m out
//   bn .. bf      the stony bed of the river, bf = bn + 60-120 m: the wall never reaches it
//   bf .. foot    the valley floor: moraine ridges, the aprons of fans and talus under the wall
//   foot ..       the facing wall. Its spurs come forward almost to the river; the gullies between
//                 them cut back 300 m further (WALL.D1 + WALL.D2). From the foot it climbs
//                 900-1600 m in 1.6-2.2 km, gently at first (fans, terraces, villages), then at
//                 30-45 degrees with cliff bands, to a crest of summits and cols 2.0-2.8 km out.
//                 Side valleys cut into it now and then, with a glacier snout or a torrent.
//   2.6 .. 14 km  the great range, standing behind and above the crest (summits 2000-4500 m)
//
// The spurs are made by moving the wall toward the camera (a ridged function of x shifts the
// distance up the wall), not by adding height: so a spur's flanks face along the line, where the
// sun (from the -x side) lights one and leaves the other in shade, and spur noses stand hundreds
// of metres nearer than the gully heads beside them, which is what slides past in motion.
// heightAt() leaves what it found (spur, rib, side valley, cliff band, ...) in WL for the
// surfacing, so colour never has to recompute the noise.
// ---------------------------------------------------------------------------------------------
// Everything about the valley that depends on x alone and changes slowly (over 600 m or more) is
// kept on an 8 m grid per world and interpolated: the height function is called three times for
// every ground splat, and these nine noises were half its cost.
const VAL = { bn: 0, bf: 0, fy: 0, head: 0, A0: 0, S: 0, cm: 0, mz: 0, dm: 0, lu: 0, fm: 0, wd: 0 };
const CG = 8, CN = 8192, CP = 12;
const colCaches = new Map();
let colWs = NaN, colTag = null, colVal = null;
function colSlot(ws, k) {
  const i = ((k % CN) + CN) % CN;
  if (colTag[i] !== k) {
    const wx = k * CG, o = i * CP;
    const bn = 185 + 30 * (2 * noise1(wx / 2300, ws + 11) - 1) + 12 * (2 * noise1(wx / 640, ws + 12) - 1);
    const bf = bn + 45 + 50 * noise1(wx / 1700, ws + 13);
    colVal[o] = bn; colVal[o + 1] = bf; colVal[o + 2] = -32 - 11 * noise1(wx / 4100, ws + 14);
    colVal[o + 3] = bf + WALL.D1 + WALL.D2 + WALL.BAY * noise1(wx / 1500, ws + 48);   // the gully-head line
    colVal[o + 4] = crestA(ws, wx); colVal[o + 5] = crestS(ws, wx);
    colVal[o + 6] = noise1(wx / 1100, ws + 37); colVal[o + 7] = noise1(wx / 1300, ws + 38); colVal[o + 8] = noise1(wx / 600, ws + 39);
    // what grows (see "Land cover"): lu 0 a high bare stretch .. 1 a lower, wooded and farmed one
    // (barer where the snow falls); fm the farmed stretches within it, wd the wooded ones
    const lu = 0.1 + 0.9 * smooth(0.14, 0.4, noise1(wx / 5200, ws + 2001)) * (1 - 0.7 * smooth(0.56, 0.75, noise1(wx / 2700, ws + 1711)));
    colVal[o + 9] = lu; colVal[o + 10] = smooth(0.4, 0.58, noise1(wx / 1900, ws + 2002)) * Math.sqrt(lu); colVal[o + 11] = smooth(0.36, 0.56, noise1(wx / 800, ws + 2003)) * lu;
    colTag[i] = k;
  }
  return i * CP;
}
function valleyAt(ws, wx) {
  if (ws !== colWs) {
    let c = colCaches.get(ws);
    if (!c) { c = { tag: new Float64Array(CN).fill(NaN), val: new Float64Array(CN * CP) }; colCaches.set(ws, c); if (colCaches.size > 6) colCaches.delete(colCaches.keys().next().value); }
    colWs = ws; colTag = c.tag; colVal = c.val;
  }
  const g = wx / CG, k = Math.floor(g), t = g - k;
  const a = colSlot(ws, k), b = colSlot(ws, k + 1), V = colVal;
  VAL.bn = V[a] + (V[b] - V[a]) * t; VAL.bf = V[a + 1] + (V[b + 1] - V[a + 1]) * t; VAL.fy = V[a + 2] + (V[b + 2] - V[a + 2]) * t;
  VAL.head = V[a + 3] + (V[b + 3] - V[a + 3]) * t; VAL.A0 = V[a + 4] + (V[b + 4] - V[a + 4]) * t; VAL.S = V[a + 5] + (V[b + 5] - V[a + 5]) * t;
  VAL.cm = V[a + 6] + (V[b + 6] - V[a + 6]) * t; VAL.mz = V[a + 7] + (V[b + 7] - V[a + 7]) * t; VAL.dm = V[a + 8] + (V[b + 8] - V[a + 8]) * t;
  VAL.lu = V[a + 9] + (V[b + 9] - V[a + 9]) * t; VAL.fm = V[a + 10] + (V[b + 10] - V[a + 10]) * t; VAL.wd = V[a + 11] + (V[b + 11] - V[a + 11]) * t;
  return VAL;
}

const E0 = 15, P0 = 0.7, E0P = Math.pow(E0, P0);
function nearY(ws, wx, d, bn, fy) {
  const bank = -1.0 * clamp((d - 2) / 5, 0, 1);
  if (d <= 7) return bank;
  const g = (Math.pow(d - 7 + E0, P0) - E0P) / (Math.pow(bn - 7 + E0, P0) - E0P);
  let y = bank + (fy + 1.0) * Math.min(1, g);
  y += Math.min(3, 0.02 * (d - 7)) * (2 * noise2(wx / 45, d / 70, ws + 21) - 1);
  y += Math.min(5, 0.025 * (d - 7)) * (ridge(noise2(wx / 130, d / 420, ws + 22)) - 0.5);
  return y;
}

// The wall. D1/L1: the big spurs and gullies; D2/L2: ribs and couloirs on them.
const WALL = { D1: 290, D2: 70, L1: 540, L2: 170, APRON: 150, BAY: 70 };
// the gully-head line: the wall's foot where it lies furthest back, itself bowed into bays
// (v must be valleyAt(ws, wx) for the same x)
const headLine = (ws, wx, v) => v.head;
const WL = { cou: 1, face: 0, se: 0, sp: 0, rib: 0, base: 0, A: 0, S: 0, sv: 0, svG: 0, svI: 0, cliff: 0, mor: 0, fan: 0, tongue: 0 };
const crestA = (ws, wx) => 1120 + 260 * (2 * noise1(wx / 3600, ws + 32) - 1) + 110 * (2 * noise1(wx / 1300, ws + 33) - 1);
const crestS = (ws, wx) => 2250 + 300 * (2 * noise1(wx / 5200, ws + 31) - 1);
const warp1 = (ws, s) => 210 * (noise1(s / 640, ws + 40) - 0.5) + 0.12 * s;
// spur (0 in a gully crease, broad and rounded on the spurs) and rib, at x and raw height s0 >= 0
// (the W forms take warp1(ws, s0) already worked out)
const spurW = (ws, wx, w1) => Math.pow(Math.abs(2 * noise1((wx + w1) / WALL.L1, ws + 34) - 1), 0.6);
const ribW = (ws, wx, s0, w1) => Math.pow(Math.abs(2 * noise1((wx + 0.6 * w1 + 35 * noise1(s0 / 260, ws + 44)) / WALL.L2, ws + 35) - 1), 0.6);
function spurOf(ws, wx, s0) { return spurW(ws, wx, warp1(ws, s0)); }
function ribOf(ws, wx, s0) { return ribW(ws, wx, s0, warp1(ws, s0)); }
// The wall's profile: height above the floor at distance se up it (0..S), crest height A.
// A glacial trough: from a gentle toe the wall steepens to over 40 degrees and climbs 0.42 A in the
// first 0.3 S, rounds over onto a shoulder, then rises again ever more steeply to the summits.
function profile(se, S, A) {
  if (se <= 0) return 0;
  const Tw = 0.3 * S, Th = 0.42 * A;
  if (se < Tw) { const u = se / Tw; return Th * (0.55 * u * u * (3 - 2 * u) + 0.45 * u); }
  if (se < S) { const v = (se - Tw) / (S - Tw); return Th + (A - Th) * v * (0.25 + 0.75 * v); }
  return A - 0.6 * (se - S);
}
// Side valleys: one per 2400 m cell at most, cutting back into the wall from its foot.
const SVC = 2400;
const SVM = new Map();
function sideValley(ws, i) {
  const key = ws * 131 + i;
  let sv = SVM.get(key);
  if (sv !== undefined) return sv;
  sv = null;
  if (hh(i, 1, ws + 301) <= 0.5) {
    const glacier = hh(i, 5, ws + 301) < 0.55 ? 1 : 0;
    sv = {
      xc: (i + 0.25 + 0.5 * hh(i, 2, ws + 301)) * SVC, w: 150 + 130 * hh(i, 3, ws + 301), deep: 0.62 + 0.25 * hh(i, 4, ws + 301),
      glacier, snout: 380 + 520 * hh(i, 6, ws + 301), fl: glacier ? 0.35 : 0.05, dir: hh(i, 7, ws + 301) < 0.5 ? -1 : 1,
    };
  }
  if (SVM.size > 4000) SVM.clear();
  SVM.set(key, sv);
  return sv;
}
const svAxis = (sv, i, s) => sv.xc + sv.dir * 0.2 * s + 45 * Math.sin(s / 260 + i);

function wallY(ws, wx, d, v) {
  const B = headLine(ws, wx, v);
  const s0 = d - B, s0c = s0 > 0 ? s0 : 0;
  const w1 = warp1(ws, s0c);
  let sp = spurW(ws, wx, w1), rib = ribW(ws, wx, s0c, w1);
  // the spurs bulge and dip along their length (buttresses, notches), never enough to fold back
  let knob = s0 > 0 ? 1 + 0.36 * (noise2((wx + w1) / (WALL.L1 * 0.45), s0c / 380, ws + 49) - 0.5) * smooth(0, 150, s0) : 1;
  // a village stands on a bench: under it the spurs and gullies are smoothed away and (below)
  // the slope eased and cut into terraces
  let vk = 0, vs = null;
  const vi = Math.floor(wx / VCELL);
  for (let i = vi - 1; i <= vi + 1; i++) {
    const site = villageSite(ws, i);
    if (!site) continue;
    const ex = Math.abs(wx - site.cx) / (site.R * 1.7);
    if (ex >= 1) continue;
    const s = d - (B - site.foot), lo = site.sLo - 110, hi = site.sHi + 45;
    if (s <= lo || s >= hi) continue;
    const k = smooth(1, 0.55, ex) * smooth(lo, lo + 70, s) * smooth(hi, hi - 40, s);
    if (k > vk) { vk = k; vs = site; }
  }
  if (vk > 0) { sp += (vs.sp - sp) * vk; rib += (vs.rib - rib) * vk; knob += (1 - knob) * vk; }
  const se = s0 + WALL.D1 * sp * knob + WALL.D2 * rib;     // distance up the wall from its foot
  const W = WL;
  W.face = 1; W.sp = sp; W.rib = rib; W.se = se;
  W.sv = 0; W.svG = 0; W.cliff = 0; W.mor = 0; W.fan = 0; W.tongue = 0;
  const S = v.S;
  const A = v.A0 * (0.84 + 0.26 * sp) * (0.94 + 0.1 * rib);
  W.A = A; W.S = S;
  let base = profile(se, S, A);
  // the apron: fans and talus at the foot, deeper in the gullies
  const fanA = 10 + 34 * (1 - sp) * (1 - sp);
  base += fanA * smooth(-WALL.APRON, 60, se);
  W.fan = (1 - sp) * smooth(-WALL.APRON, -20, se) * smooth(220, 0, se);
  // side valleys: a U (glacier) or V (torrent) cut from the foot back through the crest
  const ci = Math.floor(wx / SVC);
  for (let i = ci - 1; i <= ci + 1; i++) {
    const sv = sideValley(ws, i);
    if (!sv) continue;
    const ss = se > 0 ? se : 0;
    const w = sv.w * (0.6 + 0.4 * smooth(0, 500, ss));
    const dx = Math.abs(wx - svAxis(sv, i, ss)) / w;
    if (dx >= 1) continue;
    const k = (1 - smooth(sv.fl, 1, dx)) * smooth(0, 160, ss) * smooth(S + 700, S, ss);
    if (k <= 0) continue;
    const floor = 0.24 * profile(ss, S, A) + fanA;
    let cut = base + (floor - base) * sv.deep * k;
    if (sv.glacier) {
      // the glacier's tongue: a low convex ice surface ending in a snout
      const core = 1 - smooth(0.15, 0.75, dx / Math.max(0.3, sv.fl + 0.35));
      const tg = core * smooth(sv.snout - 30, sv.snout + 70, ss);
      cut += tg * (22 + 0.02 * ss);
      W.tongue = tg;
    }
    base = cut;
    W.sv = Math.max(W.sv, k); W.svG = sv.glacier; W.svI = i;
  }
  // the village bench: the slope eased about the village's middle and cut into terraces (fields
  // and house platforms, 4.5 m a step)
  W.terr = 0;
  if (vk > 0) {
    const Hv = profile(vs.sc, S, A) + fanA * smooth(-WALL.APRON, 60, vs.sc);
    base = Hv + (base - Hv) * (1 - 0.4 * vk);
    const f = base / 4.5, fl = Math.floor(f), fr = f - fl;
    base += (4.5 * (fl + smooth(0.7, 1, fr)) - base) * 0.92 * vk;
    W.terr = vk;
  }
  // cliff bands: the slope stepped into steep risers and gentler ledges, in stretches
  const cm = smooth(0.35, 0.62, v.cm) * smooth(110, 300, base) * (1 - vk);
  if (cm > 0) {
    const step = 85, f = base / step, fl = Math.floor(f), fr = f - fl;
    const q = step * (fl + smooth(0.6, 1, fr));
    base += (q - base) * 0.6 * cm;
    W.cliff = cm * smooth(0.6, 0.72, fr) * smooth(1, 0.9, fr);
  }
  // lateral moraine ridges on the floor in front of the wall
  const mz = v.mz;
  if (mz > 0.45) {
    const dm = v.bf + 35 + 110 * v.dm;
    const t = 1 - Math.abs(d - dm) / 32;
    if (t > 0) { const m = smooth(0.45, 0.65, mz) * 13 * Math.pow(t, 1.4); if (m > base) { W.mor = m; base = m; } }
  }
  // crags and roughness, growing with height (rough ground under a village is mostly cut away)
  const rk = 1 - 0.85 * W.terr;
  // couloirs: narrow V gullies 50-70 m apart scoring the faces down the fall line
  const cou = Math.sqrt(Math.abs(2 * noise1((wx + 0.4 * w1 + 25 * noise1(d / 140, ws + 47)) / 62, ws + 45) - 1));
  W.cou = cou;
  const rough = ((noise2(wx / 52, d / 52, ws + 36) - 0.5) * (3 + 0.04 * base) + (ridge(noise2(wx / 31, d / 26, ws + 46)) - 0.55) * (0.6 + 0.025 * base) + (cou - 0.6) * 0.07 * base) * rk;
  W.base = base;
  return base + rough;
}
// Behind the crest, cheaply (the far band's ground): the back of the wall falling away.
function wallBack(ws, wx, d, v) {
  const B = headLine(ws, wx, v);
  const se = d - B + 0.7 * WALL.D1 + 0.6 * WALL.D2;
  return v.A0 - 0.6 * (se - v.S);
}

// The great range: a broad massif behind the wall, ridged peaks and a few giants.
const GCELLX = 8000;
function rangeY(ws, wx, d) {
  const r = smooth(2500, 4300, d);
  if (r <= 0) return -1e9;
  const dc = 5300 + 1100 * (2 * noise1(wx / 12000, ws + 41) - 1);
  const hump = Math.exp(-sq((d - dc) / 2700));
  const P = ridge(fbm2(wx / 2100, d / 1900, ws + 42, 3));
  let y = (600 + 1350 * hump) * (0.28 + 0.92 * Math.pow(P, 2.2));
  const gi = Math.floor(wx / GCELLX);
  for (let k = gi - 1; k <= gi + 1; k++) {
    const g = giant(ws, k);
    if (!g) continue;
    const rr = Math.hypot(wx - g.wx, (d - g.d) * 0.9);
    if (rr >= g.R) continue;
    y += g.H * Math.pow(1 - rr / g.R, 1.7) * (0.7 + 0.5 * P);
  }
  y *= r * 1.2;
  const cap = 0.62 * d;
  if (y > cap) y = cap + (y - cap) * 0.4;
  return y - 300 * (1 - r);
}
const giantCache = new Map();
function giant(ws, k) {
  const key = ws * 7 + k;
  let g = giantCache.get(key);
  if (g !== undefined) return g;
  const r = makeRng(hashInts(ws, 51, k));
  g = null;
  if (r() < 0.65) {
    const wx = (k + 0.2 + 0.6 * r()) * GCELLX;
    const dc = 5300 + 1100 * (2 * noise1(wx / 12000, ws + 41) - 1);
    g = { k, wx, d: Math.max(4300, dc + (r() - 0.5) * 2000), H: 1000 + 900 * r(), R: 2300 + 1200 * r(), banner: r() < 0.7, seed: hashInts(ws, 52, k) };
  }
  if (giantCache.size > 4000) giantCache.clear();
  giantCache.set(key, g);
  return g;
}
function smax(a, b, k) {
  const h = clamp(0.5 + 0.5 * (b - a) / k, 0, 1);
  return a + (b - a) * h + k * h * (1 - h);
}

function heightAt(ws, wx, d) {
  const v = valleyAt(ws, wx);
  const bn = v.bn, bf = v.bf, fy = v.fy;
  WL.face = 0;
  if (d < bn) return nearY(ws, wx, d, bn, fy);
  const bed = fy + 0.5 * noise2(wx / 40, d / 25, ws + 23) - 0.25;
  if (d < bf) return bed;
  // far behind the crest only the cheap back of the wall and the range remain
  if (d > bf + WALL.D1 + WALL.D2 + WALL.BAY + 2900) return bed + smax(wallBack(ws, wx, d, v), rangeY(ws, wx, d), 160);
  let y = bed + wallY(ws, wx, d, v);
  if (d > 2500) y = smax(y, bed + rangeY(ws, wx, d), 160);
  return y;
}
// The foot of the wall at x (where the floor ends), and the raw height s measured from it.
function footAt(ws, wx) { const v = valleyAt(ws, wx); return headLine(ws, wx, v) - WALL.D1 * spurOf(ws, wx, 0) - WALL.D2 * ribOf(ws, wx, 0); }

// ---------------------------------------------------------------------------------------------
// World layout, cached per world seed
// ---------------------------------------------------------------------------------------------
const worlds = new Map();
function world(ctx) {
  const ws = worldSeed(ctx);
  let W = worlds.get(ws);
  if (W) return W;
  const H = (wx, d) => heightAt(ws, wx, d);
  W = { ws, H, misc: {} };
  W.terr = { height: H, stretch: ctx.terrain.stretch, shape: ctx.terrain.shape };
  worlds.set(ws, W);
  if (worlds.size > 6) worlds.delete(worlds.keys().next().value);
  return W;
}
// A copy of ctx standing on the valley terrain; every kit call must get this one.
function local(ctx) { const W = world(ctx); return [{ ...ctx, terrain: W.terr }, W]; }
function cache(W, type, i, make) {
  const m = W.misc[type] || (W.misc[type] = new Map());
  let v = m.get(i);
  if (v === undefined) { v = make(); if (m.size > 5000) m.clear(); m.set(i, v); }
  return v;
}
const bfAt = (W, wx) => footAt(W.ws, wx);          // the foot of the wall: things "on the facing slope" stand at bfAt + s
const bnAt = (W, wx) => valleyAt(W.ws, wx).bn;

// --- the river: braided channels across the bed (u: 0 near bank .. 1 far bank) ---
function channelCentre(W, wx, k) { return 0.12 + 0.76 * noise1(wx / (380 + 140 * k), W.ws + 60 + k); }
function channelHW(W, wx, k) {
  const on = k === 0 ? 1 : smooth(0.35, 0.55, noise1(wx / (500 + 170 * k), W.ws + 70 + k));
  return (k === 0 ? 16 + 10 * noise1(wx / 300, W.ws + 66) : 2.5 + 3 * noise1(wx / 200, W.ws + 67 + k)) * on;
}
const CH = { k: 0, f: 0 };
function channelAt(W, wx, u, bw) {
  for (let k = 0; k < 4; k++) {
    const hw = channelHW(W, wx, k);
    if (hw <= 0) continue;
    const dist = Math.abs(u - channelCentre(W, wx, k)) * bw;
    if (dist < hw) { CH.k = k; CH.f = dist / hw; return CH; }
  }
  return null;
}
// distance of the main channel's centre line at wx
function mainChannelD(W, wx) { const v = valleyAt(W.ws, wx); return v.bn + (v.bf - v.bn) * channelCentre(W, wx, 0); }

// --- villages on the facing slope: tiers of houses stepped up the mountainside ---
const VCELL = 2300, VK = 1.6;
function village(W, i) { return cache(W, 'v', i, () => makeVillage(W, i)); }
// Where a village stands, from hashes alone (the height function reads it to cut the terraces, so it
// must not touch the terrain itself).
const VSITE = new Map();
function villageSite(ws, i) {
  const key = ws * 131 + i;
  let v = VSITE.get(key);
  if (v !== undefined) return v;
  v = null;
  if (hh(i, 1, ws + 801) < 0.78) {
    // (VK: the villages are built larger than life, houses, lanes and terraces alike, and low on
    // the wall, since at 450-700 m a true-sized house is a dozen pixels)
    const sc = 20 + 150 * Math.pow(hh(i, 3, ws + 801), 1.2);
    const nT = 3 + Math.floor(hh(i, 5, ws + 801) * 4), sp = (18 + 10 * hh(i, 6, ws + 801)) * VK;
    v = { cx: (i + 0.2 + 0.6 * hh(i, 2, ws + 801)) * VCELL, sc, R: (70 + 90 * hh(i, 4, ws + 801)) * 1.35, nT, tsp: sp, sLo: sc - sp * nT / 2 - 20, sHi: sc + sp * nT / 2 + 15 };
    // the bench's spur and rib values (taken at its middle) and its foot behind the head line
    v.sp = spurOf(ws, v.cx, 0); v.rib = ribOf(ws, v.cx, 0);
    v.foot = WALL.D1 * v.sp + WALL.D2 * v.rib;
  }
  if (VSITE.size > 4000) VSITE.clear();
  VSITE.set(key, v);
  return v;
}
function makeVillage(W, i) {
  const site = villageSite(W.ws, i);
  if (!site) return null;
  const seed = hashInts(W.ws, 801, i), r = makeRng(seed);
  const { cx, sc, R, nT } = site, sp = site.tsp;
  // the village stands on its bench, whose foot runs parallel to the head line
  const vFoot = (x) => headLine(W.ws, x, valleyAt(W.ws, x)) - site.foot;
  const v = { i, cx, sc, R, seed, houses: [], trees: [], chortens: [], poles: [], strings: [], tiers: nT, sLo: site.sLo, sHi: site.sHi };
  v.dc = vFoot(cx) + sc;
  v.floatTier = nT - 1;
  v.floatR = r();
  for (let t = 0; t < nT; t++) {
    const s = sc - sp * (nT - 1) / 2 + t * sp;
    const Rt = R * (1 - 0.16 * Math.abs(t - (nT - 1) / 2)) * (0.8 + 0.3 * r());
    let x = cx - Rt + r() * 8;
    while (x < cx + Rt) {
      const w = (9 + 6 * r()) * VK;
      if (r() < 0.18) { x += (12 + 18 * r()) * VK; continue; }
      const hx = x + w / 2, hs = s + (r() - 0.5) * 7 * VK;
      const d = vFoot(hx) + hs;
      v.houses.push({
        wx: hx, d, w, dep: (8 + 3 * r()) * 1.5, h: (r() < 0.6 ? 6.6 + 1.2 * r() : 4.4 + r()) * VK, yaw: (r() - 0.5) * 0.16,
        wall: HOUSE_WALLS[Math.floor(r() * HOUSE_WALLS.length)], tier: t, seed: hashInts(seed, 3, v.houses.length),
      });
      x += w + (r() < 0.6 ? 0.2 : 2 + 6 * r()) * VK;
    }
  }
  // bare poplars along the lowest tier, a chorten at each end, flag poles above
  for (let k = 0; k < 8 + Math.floor(r() * 8); k++) {
    const wx = cx + (r() - 0.5) * 2.2 * R, s = v.sLo - 6 - 25 * r();
    v.trees.push({ wx, d: Math.max(vFoot(wx) + s, valleyAt(W.ws, wx).bf + 10), h: 15 + 9 * r(), seed: hashInts(seed, 5, k), willow: k % 4 === 3 });
  }
  for (const side of [-1, 1]) {
    if (r() < 0.25) continue;
    const wx = cx + side * (R + 10 + 20 * r()), s = sc + (r() - 0.6) * 40;
    v.chortens.push({ wx, d: vFoot(wx) + s, H: (5 + 3 * r()) * VK, seed: hashInts(seed, 7, side) });
  }
  // strings between roofs, and from a high pole above the village down to the roofs
  const hs = v.houses;
  const topY = (hz) => W.H(hz.wx, hz.d) + hz.h + 0.6;
  for (let k = 0; k < 6 + Math.floor(r() * 5) && hs.length > 3; k++) {
    const a = hs[Math.floor(r() * hs.length)];
    let b = null;
    for (let tr = 0; tr < 6; tr++) {
      const c = hs[Math.floor(r() * hs.length)];
      const dd = Math.hypot(c.wx - a.wx, c.d - a.d);
      if (c !== a && dd > 30 && dd < 140) { b = c; break; }
    }
    if (b) v.strings.push({ a: [a.wx, topY(a) + 1.5, a.d], b: [b.wx, topY(b) + 1.5, b.d], sag: 0.05, seed: hashInts(seed, 9, k), fw: 0.5 });
  }
  const px = cx + (r() - 0.5) * R, ps = v.sHi + 25 + 30 * r();
  const pd = vFoot(px) + ps, py = W.H(px, pd);
  v.poles.push({ wx: px, d: pd, h: 16, seed: hashInts(seed, 11) });
  for (let k = 0; k < 5 && hs.length; k++) {
    const a = hs[Math.floor(r() * hs.length)];
    v.strings.push({ a: [px, py + 15.5, pd], b: [a.wx, topY(a), a.d], sag: 0.04, seed: hashInts(seed, 13, k), fw: 0.5 });
  }
  return v;
}

// --- monasteries on spurs ---
const MCELL = 4700;
function gompa(W, i) { return cache(W, 'g', i, () => makeGompa(W, i)); }
function makeGompa(W, i) {
  const seed = hashInts(W.ws, 851, i), r = makeRng(seed);
  if (r() > 0.72) return null;
  const s = 170 + 330 * r();
  // on a spur: the best of a few candidates along the cell
  let best = -1, bx = 0;
  for (let k = 0; k < 9; k++) {
    const wx = (i + 0.15 + 0.7 * k / 8) * MCELL;
    const sp = spurOf(W.ws, wx, s) + 0.15 * r();
    if (sp > best) { best = sp; bx = wx; }
  }
  // keep clear of villages
  for (let k = Math.floor(bx / VCELL) - 1; k <= Math.floor(bx / VCELL) + 1; k++) {
    const v = village(W, k);
    if (v && Math.abs(v.cx - bx) < v.R + 160 && Math.abs(v.sc - s) < 260) return null;
  }
  const d = bfAt(W, bx) + s;
  const g = { i, wx: bx, s, d, seed, y: W.H(bx, d), houses: [], chortens: [], poles: [], strings: [] };
  const yaw = (r() - 0.5) * 0.2;
  g.main = { wx: bx, d, w: (24 + 10 * r()) * 1.5, dep: (14 + 4 * r()) * 1.4, h: (12 + 4 * r()) * 1.5, yaw, seed: hashInts(seed, 1), wall: r() < 0.8 ? C.white : [0.74, 0.58, 0.3] };
  g.halls = [];
  for (const side of [-1, 1]) {
    if (r() < 0.35) continue;
    const wx = bx + side * (g.main.w / 2 + 9 + 4 * r()), hd = d + 2 + 6 * r();
    const red = r() < 0.35;
    g.halls.push({ wx, d: hd, w: (12 + 6 * r()) * 1.5, dep: (10 + 3 * r()) * 1.4, h: (8 + 3 * r()) * 1.5, yaw: yaw + (r() - 0.5) * 0.1, wall: red ? [0.5, 0.13, 0.1] : C.white, band: !red, seed: hashInts(seed, 2, side) });
  }
  // monks' houses stepping down the spur
  for (let k = 0; k < 8 + Math.floor(r() * 12); k++) {
    const wx = bx + (r() - 0.5) * 200, hs = s - 36 - 150 * Math.pow(r(), 0.8);
    g.houses.push({ wx, d: bfAt(W, wx) + hs, w: (6 + 4 * r()) * 1.5, dep: (6 + 2 * r()) * 1.4, h: (4.5 + 2 * r()) * 1.5, yaw: yaw + (r() - 0.5) * 0.2, wall: r() < 0.85 ? C.white : HOUSE_WALLS[4], seed: hashInts(seed, 3, k) });
  }
  for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
    const wx = bx + (r() < 0.5 ? -1 : 1) * (g.main.w / 2 + 25 + 40 * r()), cs = s - 10 - 40 * r();
    g.chortens.push({ wx, d: bfAt(W, wx) + cs, H: 10 + 6 * r(), seed: hashInts(seed, 4, k) });
  }
  // the long strings of flags from the roof down to poles on the slope below and to the sides
  const ry = g.y + g.main.h + 1.2;
  for (let k = 0; k < 4 + Math.floor(r() * 4); k++) {
    const ang = (r() - 0.5) * 2.6;
    const L = 70 + 150 * r();
    const wx = bx + Math.sin(ang) * L, ps = s - Math.cos(ang) * L * 0.75 - 15;
    const pd = bfAt(W, wx) + ps;
    const ph = 6 + 5 * r();
    g.poles.push({ wx, d: pd, h: ph, seed: hashInts(seed, 5, k) });
    const sx = bx + (r() - 0.5) * g.main.w;
    g.strings.push({ a: [sx, ry, d + g.main.dep * 0.3], b: [wx, W.H(wx, pd) + ph - 0.3, pd], sag: 0.035, seed: hashInts(seed, 6, k), fw: 0.6 });
  }
  // a cluster of tall poles behind
  for (let k = 0; k < 3 + Math.floor(r() * 4); k++) {
    const wx = bx + (r() - 0.5) * 40, pd = d + g.main.dep / 2 + 10 + 15 * r();
    g.poles.push({ wx, d: pd, h: 9 + 5 * r(), seed: hashInts(seed, 8, k), banner: true });
  }
  return g;
}

// --- hamlets on the near slope: a few houses, walled plots, poplars, a chorten ---
const HCELL = 1500;
function hamlet(W, i) { return cache(W, 'h', i, () => makeHamlet(W, i)); }
function makeHamlet(W, i) {
  const seed = hashInts(W.ws, 871, i), r = makeRng(seed);
  const u0 = r();
  const wx = (i + 0.2 + 0.6 * r()) * HCELL;
  // (most cells hold one where the valley is farmed)
  if (u0 > 0.55 + 0.4 * valleyAt(W.ws, wx).fm) return null;
  const bn = bnAt(W, wx);
  // near enough to read: 62-150 m out, the houses built half as big again as life
  const d = 62 + (Math.min(bn - 58, 150) - 62) * r();
  if (d < 58) return null;
  const h = { i, wx, d, seed, houses: [], walls: [], trees: [], chortens: [], poles: [], strings: [], mani: null };
  const n = 3 + Math.floor(r() * 5);
  for (let k = 0; k < n; k++) {
    const hx = wx + (k - (n - 1) / 2) * (19 + 10 * r()), hd = d + (r() - 0.5) * 30;
    h.houses.push({ wx: hx, d: hd, w: 11 + 5 * r(), dep: 9 + 4 * r(), h: r() < 0.6 ? 9.2 : 6.4, yaw: (r() - 0.5) * 0.9, wall: HOUSE_WALLS[Math.floor(r() * HOUSE_WALLS.length)], seed: hashInts(seed, 1, k), roofFlag: r() < 0.8 });
  }
  // walled plots below the houses
  for (let k = 0; k < 2 + Math.floor(r() * 3); k++) {
    const px = wx + (r() - 0.5) * 130, pd = d - 26 - 25 * r(), pw = 18 + 20 * r(), pdp = 10 + 12 * r();
    if (pd - pdp / 2 < 35) continue;
    h.walls.push([px - pw / 2, pd - pdp / 2, px + pw / 2, pd - pdp / 2], [px + pw / 2, pd - pdp / 2, px + pw / 2, pd + pdp / 2], [px - pw / 2, pd - pdp / 2, px - pw / 2, pd + pdp / 2]);
    if (r() < 0.6) h.walls.push([px - pw / 2, pd + pdp / 2, px + pw / 2, pd + pdp / 2]);
  }
  // poplars and willows behind and between the houses (never in front of them), tall enough to
  // stand over the roofs
  for (let k = 0; k < 4 + Math.floor(r() * 5); k++) {
    const tx = wx + (r() - 0.5) * (40 + 22 * n), td = d + 9 + 24 * r();
    h.trees.push({ wx: tx, d: Math.max(45, td), h: 13 + 9 * r(), seed: hashInts(seed, 2, k), willow: r() < 0.35 });
  }
  const cx = wx + (r() < 0.5 ? -1 : 1) * (12 * n + 16 + 20 * r());
  h.chortens.push({ wx: cx, d: d - 10 + 10 * r(), H: 6.5 + 3 * r(), seed: hashInts(seed, 3) });
  const pole = { wx: wx + (r() - 0.5) * 30, d: d + 20 + 8 * r(), h: 13 + 4 * r(), seed: hashInts(seed, 4), banner: true };
  h.poles.push(pole);
  const py = W.H(pole.wx, pole.d) + pole.h - 0.4;
  for (const hz of h.houses) {
    if (r() < 0.25) continue;
    h.strings.push({ a: [pole.wx, py, pole.d], b: [hz.wx, W.H(hz.wx, hz.d) + hz.h + 0.8, hz.d], sag: 0.07, seed: hashInts(seed, 5, Math.round(hz.wx)) });
  }
  const cc = h.chortens[0];
  h.strings.push({ a: [cc.wx, W.H(cc.wx, cc.d) + cc.H * 0.95, cc.d], b: [pole.wx, py - 1, pole.d], sag: 0.08, seed: hashInts(seed, 6) });
  if (r() < 0.6) { const mx = wx + (r() - 0.5) * 60; h.mani = { wx: mx, d: Math.max(36, d - 32 - 10 * r()), len: 16 + 26 * r(), h: 1.9, seed: hashInts(seed, 7) }; }
  return h;
}

// --- flag sites near the line: a chorten with flags, a cluster of tall poles, a "tent" of strings ---
const FCELL = 640;
function flagSite(W, i) { return cache(W, 'f', i, () => makeFlagSite(W, i)); }
function makeFlagSite(W, i) {
  const seed = hashInts(W.ws, 881, i), r = makeRng(seed);
  if (r() > 0.6) return null;
  const wx = (i + 0.2 + 0.6 * r()) * FCELL;
  const bn = bnAt(W, wx);
  const d = 45 + (Math.min(bn - 20, 230) - 45) * Math.pow(r(), 1.2);
  const hm = hamlet(W, Math.floor(wx / HCELL));
  if (hm && Math.abs(hm.wx - wx) < 135 && Math.abs(hm.d - d) < 66) return null;
  const f = { i, wx, d, seed, chortens: [], poles: [], strings: [], mani: null, cairns: [] };
  const kind = r();
  const gy = (x, dd) => W.H(x, dd);
  if (kind < 0.45) {
    // a chorten with strings from its spire to stakes round about, and a few poles
    const H = 7 + 4 * r();
    f.chortens.push({ wx, d, H, seed: hashInts(seed, 1) });
    const top = [wx, gy(wx, d) + H * 0.97, d];
    const n = 3 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r();
      const L = 14 + 14 * r();
      const ex = wx + Math.cos(a) * L, ed = Math.max(32, d + Math.sin(a) * L * 0.8);
      const ph = 2.5 + 2 * r();
      f.poles.push({ wx: ex, d: ed, h: ph, seed: hashInts(seed, 2, k) });
      f.strings.push({ a: top, b: [ex, gy(ex, ed) + ph, ed], sag: 0.06, seed: hashInts(seed, 3, k) });
    }
  } else if (kind < 0.8) {
    // a cluster of darchog (tall vertical flags) with a tent of strings from the tallest
    const n = 3 + Math.floor(r() * 6);
    let top = null;
    for (let k = 0; k < n; k++) {
      const px = wx + (r() - 0.5) * 14, pd = Math.max(36, d + (r() - 0.5) * 10), ph = 7 + 6 * r();
      f.poles.push({ wx: px, d: pd, h: ph, seed: hashInts(seed, 4, k), banner: true });
      if (!top || ph > top[3]) top = [px, gy(px, pd) + ph - 0.3, pd, ph];
    }
    const m = 5 + Math.floor(r() * 6);
    for (let k = 0; k < m; k++) {
      const a = (k / m) * Math.PI * 2 + r() * 0.5;
      const L = 16 + 14 * r();
      const ex = top[0] + Math.cos(a) * L, ed = Math.max(32, top[2] + Math.sin(a) * L * 0.8);
      f.strings.push({ a: top.slice(0, 3), b: [ex, gy(ex, ed) + 0.4, ed], sag: 0.03, seed: hashInts(seed, 5, k) });
      f.cairns.push({ wx: ex, d: ed, seed: hashInts(seed, 6, k), small: true });
    }
  } else {
    // two poles with a long string between, a mani wall below, cairns
    const L = 35 + 40 * r(), a = (r() - 0.5) * 1.2;
    const ex = wx + Math.cos(a) * L, ed = Math.max(34, d + Math.sin(a) * L);
    f.poles.push({ wx, d, h: 6 + 3 * r(), seed: hashInts(seed, 7) }, { wx: ex, d: ed, h: 6 + 3 * r(), seed: hashInts(seed, 8) });
    const [p, q] = f.poles;
    f.strings.push({ a: [p.wx, gy(p.wx, p.d) + p.h - 0.3, p.d], b: [q.wx, gy(q.wx, q.d) + q.h - 0.3, q.d], sag: 0.06, seed: hashInts(seed, 9) });
    f.strings.push({ a: [p.wx, gy(p.wx, p.d) + p.h - 1.5, p.d], b: [q.wx, gy(q.wx, q.d) + q.h - 1.5, q.d], sag: 0.08, seed: hashInts(seed, 10) });
    for (let k = 0; k < 3; k++) f.cairns.push({ wx: wx + (r() - 0.5) * 40, d: Math.max(34, d + (r() - 0.5) * 20), seed: hashInts(seed, 11, k) });
  }
  if (r() < 0.45) f.mani = { wx: wx + (r() - 0.5) * 40, d: Math.max(36, d - 8 - 10 * r()), len: 8 + 22 * r(), seed: hashInts(seed, 12) };
  return f;
}

// --- shrines close by the line: a big chorten with flags, a long mani wall, or a row of three
// chortens, 31-40 m out, so that something made by hand passes near the window every kilometre
// or so (the villages and monasteries are far off; these are the human things at arm's length) ---
const LSCELL = 620;
function lineShrine(W, i) { return cache(W, 'ls', i, () => makeLineShrine(W, i)); }
function makeLineShrine(W, i) {
  const seed = hashInts(W.ws, 2201, i), r = makeRng(seed);
  if (r() > 0.72) return null;
  const wx = (i + 0.15 + 0.7 * r()) * LSCELL, d = 31 + 8 * r(), u = r();
  const s = { i, wx, d, seed, chortens: [], poles: [], strings: [], mani: null };
  const gy = (x, dd) => W.H(x, dd);
  if (u < 0.4) {
    const H = 7.5 + 2.5 * r(), cd = d + 3;
    s.chortens.push({ wx, d: cd, H, seed: hashInts(seed, 1) });
    const top = [wx, gy(wx, cd) + H * 0.97, cd];
    for (const sg of [-1, 1]) {
      const ex = wx + sg * (15 + 9 * r()), ed = d + 6 * r(), ph = 3.6 + 1.6 * r();
      s.poles.push({ wx: ex, d: ed, h: ph, seed: hashInts(seed, 2, sg) });
      s.strings.push({ a: top, b: [ex, gy(ex, ed) + ph, ed], sag: 0.06, seed: hashInts(seed, 3, sg), fw: 0.44 });
    }
  } else if (u < 0.75) {
    const len = 24 + 22 * r();
    s.mani = { wx, d: d + 1, len, h: 2.1, seed: hashInts(seed, 4) };
    const ends = [];
    for (const sg of [-1, 1]) {
      const px = wx + sg * (len / 2 + 2.5), ph = 7 + 3 * r();
      s.poles.push({ wx: px, d: d + 1, h: ph, seed: hashInts(seed, 5, sg), banner: true });
      ends.push([px, gy(px, d + 1) + ph - 0.4, d + 1]);
    }
    s.strings.push({ a: ends[0], b: ends[1], sag: 0.07, seed: hashInts(seed, 6), fw: 0.44 });
    if (r() < 0.6) s.chortens.push({ wx: wx + (r() < 0.5 ? -1 : 1) * (len / 2 + 8), d: d + 3, H: 4.6 + 1.4 * r(), seed: hashInts(seed, 7) });
  } else {
    // the three protectors: an ochre, a white and a blue-black chorten in a row
    const tones = [[0.72, 0.5, 0.22], C.white, [0.2, 0.24, 0.32]];
    for (let k = 0; k < 3; k++) s.chortens.push({ wx: wx + (k - 1) * 6.4, d: d + 2, H: 5 + 0.6 * r(), seed: hashInts(seed, 8, k), white: tones[k] });
    const px = wx + 14, ph = 9 + 2 * r();
    s.poles.push({ wx: px, d: d + 3, h: ph, seed: hashInts(seed, 9), banner: true });
  }
  return s;
}
function* lineShrines(ctx, out, W, dLo, dHi) {
  for (let i = Math.floor((ctx.x0 - 60) / LSCELL); i <= Math.floor((ctx.x0 + ctx.length + 60) / LSCELL); i++) {
    const s = lineShrine(W, i);
    if (!s || !inX(ctx, s.wx, 60)) continue;
    for (const c of s.chortens) if (inD(c.d, dLo, dHi) && inX(ctx, c.wx, 8)) yield* drawChorten(ctx, out, W, c, { white: c.white });
    for (const p of s.poles) if (inD(p.d, dLo, dHi) && inX(ctx, p.wx, 5)) yield* flagPole(ctx, out, W, p);
    for (const st of s.strings) yield* flagString(ctx, out, st, dLo, dHi);
    if (s.mani && inD(s.mani.d, dLo, dHi) && inX(ctx, s.mani.wx, s.mani.len)) yield* maniWall(ctx, out, W, s.mani);
  }
}

// --- yak herds ---
const YCELL = 420;
function herd(W, i) { return cache(W, 'y', i, () => makeHerd(W, i)); }
function makeHerd(W, i) {
  const seed = hashInts(W.ws, 891, i), r = makeRng(seed);
  if (r() > 0.5) return null;
  const wx = (i + 0.2 + 0.6 * r()) * YCELL;
  const v = valleyAt(W.ws, wx);
  // close enough to be animals and not dots, yet far enough to clear the blur and the bottom edge
  // of the window (the ground falls away steeply here): mostly 52-100 m out
  const d = 50 + (Math.min(v.bf - 30, 150) - 50) * Math.pow(r(), 2.2);
  const n = 3 + Math.floor(r() * 9);
  const hd = { i, wx, d, seed, yaks: [] };
  const flow = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.6;
  for (let k = 0; k < n; k++) {
    const yx = wx + (r() - 0.5) * (19 + 5.5 * n), yd = Math.max(47, d + (r() - 0.5) * (10 + 2 * n));
    const yv = valleyAt(W.ws, yx);
    if (yd > yv.bn && yd < yv.bf && channelAt(W, yx, (yd - yv.bn) / (yv.bf - yv.bn), yv.bf - yv.bn)) continue;
    hd.yaks.push({
      wx: yx, d: yd, yaw: flow + (r() - 0.5) * 1.6, k: 1.8 + 0.5 * r(), col: YAKS[Math.floor(r() * YAKS.length)],
      graze: r() < 0.7, tassel: r() < 0.3, blanket: r() < 0.15, white: r() < 0.2, seed: hashInts(seed, 1, k),
    });
  }
  return hd;
}

// --- blue sheep on rocky outcrops ---
const SCELL = 560;
function sheepGroup(W, i) { return cache(W, 's', i, () => makeSheep(W, i)); }
function makeSheep(W, i) {
  const seed = hashInts(W.ws, 901, i), r = makeRng(seed);
  if (r() > 0.5) return null;
  const wx = (i + 0.2 + 0.6 * r()) * SCELL;
  const bn = bnAt(W, wx);
  const d = 50 + (Math.min(bn - 25, 240) - 50) * r();
  const g = { i, wx, d, seed, blocks: [], sheep: [] };
  const nb = 2 + Math.floor(r() * 4);
  for (let k = 0; k < nb; k++) {
    const bx = wx + (r() - 0.5) * 26, bd = d + (r() - 0.3) * 10;
    const rx = 2 + 2.5 * r(), ry = 1.5 + 2.5 * r(), rz = 1.6 + 1.6 * r();
    const y = W.H(bx, bd) + ry * 0.45;
    g.blocks.push({ wx: bx, d: bd, rx, ry, rz, y, seed: hashInts(seed, 1, k) });
  }
  const n = 3 + Math.floor(r() * 6);
  for (let k = 0; k < n; k++) {
    let x, dd, y;
    if (r() < 0.65) {
      const b = g.blocks[Math.floor(r() * nb)];
      x = b.wx + (r() - 0.5) * b.rx * 0.9; dd = b.d + (r() - 0.5) * b.rz * 0.5;
      y = b.y + b.ry * 0.82 * Math.sqrt(Math.max(0, 1 - sq((x - b.wx) / b.rx)));
    } else {
      x = wx + (r() - 0.5) * 30; dd = d + (r() - 0.5) * 12; y = W.H(x, dd);
    }
    g.sheep.push({ wx: x, d: dd, y, yaw: (r() - 0.5) * 2 * Math.PI, look: r() < 0.4, k: 1.9 + 0.4 * r(), seed: hashInts(seed, 2, k) });
  }
  return g;
}

// --- suspension footbridges across the main channel ---
const BCELL = 2700;
function bridge(W, i) { return cache(W, 'b', i, () => makeBridge(W, i)); }
function makeBridge(W, i) {
  const seed = hashInts(W.ws, 911, i), r = makeRng(seed);
  if (r() > 0.75) return null;
  // where the main channel runs closest to the line within the cell
  let wx = 0, dc = Infinity;
  for (let k = 0; k < 10; k++) {
    const x = (i + 0.1 + 0.8 * k / 9) * BCELL, dd = mainChannelD(W, x);
    if (dd < dc) { dc = dd; wx = x; }
  }
  if (dc > 420) return null;
  const hw = channelHW(W, wx, 0);
  const th = (r() < 0.5 ? -1 : 1) * (0.55 + 0.4 * r());          // skewed, so it is not seen end-on
  const half = (hw + 9) / Math.cos(th);
  const ux = Math.sin(th), ud = Math.cos(th);
  const a = [wx - ux * half, 0, dc - ud * half], b = [wx + ux * half, 0, dc + ud * half];
  const fy = valleyAt(W.ws, wx).fy;
  a[1] = W.H(a[0], a[2]); b[1] = W.H(b[0], b[2]);
  const deckY = Math.max(a[1], b[1], fy) + 2.2;
  const br = { i, wx, d: dc, seed, a, b, ux, ud, deckY, tower: 4.2, strings: [] };
  // anchor strings from tower tops to the ground behind, hung with flags
  for (const [p, sgn] of [[a, -1], [b, 1]]) {
    for (const side of [-1, 1]) {
      const tx = p[0] + side * ud * 1.1, td = p[2] - side * ux * 1.1;
      const ex = tx + sgn * ux * 9 + side * ud * 5, ed = td + sgn * ud * 9 - side * ux * 5;
      br.strings.push({ a: [tx, deckY + br.tower, td], b: [ex, W.H(ex, ed) + 0.3, ed], sag: 0.04, seed: hashInts(seed, 3, sgn, side) });
    }
  }
  return br;
}

// --- long strings of flags across gullies on the facing slope ---
const RCELL = 1900;
function ridgeString(W, i) { return cache(W, 'r', i, () => makeRidgeString(W, i)); }
function makeRidgeString(W, i) {
  const seed = hashInts(W.ws, 921, i), r = makeRng(seed);
  if (r() > 0.6) return null;
  // across a gully: from one spur to the next, on tall poles, clear of the ground all the way
  for (let tr = 0; tr < 5; tr++) {
    const ax = (i + 0.1 + 0.6 * r()) * RCELL, s = 200 + 800 * r();
    const bx = ax + 120 + 240 * r(), sb = s + (r() - 0.5) * 80;
    const ad = bfAt(W, ax) + s, bd = bfAt(W, bx) + sb;
    const ay = W.H(ax, ad) + 11, by = W.H(bx, bd) + 11;
    const L = Math.hypot(bx - ax, by - ay, bd - ad), sag = 0.03;
    let ok = true;
    for (let k = 1; k < 10 && ok; k++) {
      const t = k / 10, x = lerp(ax, bx, t), dd = lerp(ad, bd, t);
      if (W.H(x, dd) + 2 > lerp(ay, by, t) - 4 * sag * L * t * (1 - t)) ok = false;
    }
    if (ok) return { a: [ax, ay, ad], b: [bx, by, bd], sag, seed, fw: 0.7, poles: [{ wx: ax, d: ad, h: 11.3, seed: seed ^ 1 }, { wx: bx, d: bd, h: 11.3, seed: seed ^ 2 }] };
  }
  return null;
}

// --- streams down the gullies of the wall, and torrents down the side valleys ---
// A main gully is where the spur noise crosses 0.5 between two lattice points (the crease of
// spurOf); its line up the wall is known in closed form, so a stream can run exactly down it.
function invSmooth(v) { return 0.5 - Math.sin(Math.asin(clamp(1 - 2 * v, -1, 1)) / 3); }
function stream(W, i) {
  return cache(W, 't', i, () => {
    const ws = W.ws;
    const a = hh(i, 0, ws + 34), b = hh(i + 1, 0, ws + 34);
    if ((a - 0.5) * (b - 0.5) >= 0 || hh(i, 9, ws + 931) > 0.6) return null;
    const xg = (i + invSmooth((0.5 - a) / (b - a))) * WALL.L1;
    const s1 = 350 + 1100 * hh(i, 10, ws + 931);
    const pts = [];
    for (let s0 = s1; s0 > -(WALL.D2 + WALL.APRON); s0 -= 14) {
      const wx = xg - warp1(ws, Math.max(0, s0));
      const v = valleyAt(ws, wx), d = headLine(ws, wx, v) + s0;
      pts.push([wx, W.H(wx, d) + 0.3, d]);
    }
    return { pts, frozen: hh(i, 11, ws + 931) < 0.6 * (1 - valleyAt(ws, xg).lu), w: 1, seed: hashInts(ws, 932, i) };
  });
}
// distance at which the wall's se reaches `se` at x (a few steps of a fixed-point search)
function dAtSe(W, wx, se) {
  let d = footAt(W.ws, wx) + se;
  for (let k = 0; k < 4; k++) { W.H(wx, d); if (!WL.face) break; d += se - WL.se; }
  return d;
}
function torrent(W, j) {
  return cache(W, 'q', j, () => {
    const sv = sideValley(W.ws, j);
    if (!sv) return null;
    const svc = { ...sv };
    const S = crestS(W.ws, svc.xc);
    const top = svc.glacier ? svc.snout - 20 : 0.7 * S;
    const pts = [];
    for (let ss = top; ss > -WALL.APRON; ss -= 16) {
      const wx = svAxis(svc, j, Math.max(0, ss)), d = dAtSe(W, wx, ss);
      pts.push([wx, W.H(wx, d) + 0.4, d]);
    }
    return { pts, frozen: false, w: 1.8, seed: hashInts(W.ws, 933, j) };
  });
}
function* drawStream(ctx, out, st, dLo, dHi) {
  const p = st.pts;
  for (let k = 1; k < p.length; k++) {
    const a = p[k - 1], b = p[k], dm = (a[2] + b[2]) / 2;
    if (!inD(dm, dLo, dHi) || !inX(ctx, b[0], 20)) continue;
    const r = Math.max(1.1, 0.0014 * dm) * st.w;
    // the colour drifts slowly along the stream (a colour per segment made it a dashed line)
    const u = noise1(k / 5, st.seed & 0xffff);
    const c = st.frozen ? mix3(C.ice, [0.6, 0.68, 0.74], u) : mix3([0.76, 0.79, 0.8], [0.58, 0.66, 0.7], u);
    // overlapping splats laid along the segment (two per segment, each longer than its spacing),
    // stood a little proud of the face toward the camera so the big ground discs do not swallow them
    const off = Math.max(1.2, 0.004 * dm);
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = a[2] - b[2], len = Math.hypot(dx, dy, dz) || 1e-6;
    const q = quatXTo(dx / len, dy / len, dz / len);
    for (let j = 0; j < 2; j++) {
      const t = (j + 0.5) / 2;
      out(a[0] + dx * t - ctx.x0, a[1] + dy * t + off * 0.4, -(a[2] - dz * t) + off, len * 0.42, r, r * 0.6, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND);
    }
    if (out.due()) yield;
  }
}

// --- mist: patchy, in stretches ---
function mistAmt(W, wx) { return smooth(0.5, 0.78, noise1(wx / 3100, W.ws + 701)); }


// ---------------------------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------------------------
const T = { NEAR: 0, BED: 1, CHANNEL: 2, FACE: 3, FLOOR: 4 };
const SURF = { t: 0, y: 0, bn: 0, bf: 0, fy: 0, u: 0, ch: null, terr: 0, vterr: 0, se: 0, sp: 1, rib: 1, sv: 0, svG: 0, cliff: 0, fan: 0, tongue: 0, mor: 0, base: 0, lu: 0, fm: 0, wd: 0, cou: 1 };
function surface(W, wx, d) {
  const S = SURF;
  const v = valleyAt(W.ws, wx);
  const bn = v.bn, bf = v.bf, fy = v.fy;
  S.bn = bn; S.bf = bf; S.fy = fy; S.ch = null; S.terr = 0;
  S.lu = v.lu; S.fm = v.fm; S.wd = v.wd;
  S.y = W.H(wx, d);
  if (d < bn) { S.t = T.NEAR; return S; }
  if (d < bf) {
    S.u = (d - bn) / (bf - bn);
    const ch = channelAt(W, wx, S.u, bf - bn);
    if (ch) { S.t = T.CHANNEL; S.ch = ch; S.y = fy - 0.3; return S; }
    S.t = T.BED; return S;
  }
  S.se = WL.se; S.sp = WL.sp; S.rib = WL.rib; S.sv = WL.sv; S.svG = WL.svG; S.cliff = WL.cliff;
  S.fan = WL.fan; S.tongue = WL.tongue; S.mor = WL.mor; S.base = WL.base; S.vterr = WL.terr; S.cou = WL.cou;
  S.t = WL.se < -0.55 * WALL.APRON && WL.mor < 1 ? T.FLOOR : T.FACE;
  return S;
}

// (low enough that the upper third of the wall seen from the window is under snow: this is a cold place)
function snowLine(W, wx, d) { return 100 + 150 * noise2(wx / 1800, d / 1500, W.ws + 81) + 70 * (noise2(wx / 160, d / 160, W.ws + 82) - 0.5); }

// ---------------------------------------------------------------------------------------------
// Land cover: what grows where. One answer, read by the ground colour and by the things that
// stand on the ground (the trees are planted where the ground is painted forest), so the two
// never disagree. The shapes follow the mountain: forest clothes the shaded flanks of the spurs
// and the gully bottoms up to a ragged tree line, a belt of rhododendron and juniper scrub lies
// above it, fields are whole walled plots on the gentle ground, a riverine wood follows the far
// bank. valleyAt().lu (0 a high bare stretch .. 1 a lower lush one) scales all of it.
// ---------------------------------------------------------------------------------------------
const FC = { forest: 0, birch: 0, scrub: 0, bloom: -1, top: 0 };
// On the facing wall and its apron. S from surface(), nn the ground normal there.
function faceCover(W, S, wx, nn) {
  const F = FC;
  F.forest = 0; F.birch = 0; F.scrub = 0; F.bloom = -1;
  const L = S.lu;
  const top = 50 + 130 * L * (0.6 + 0.8 * noise1(wx / 900, W.ws + 2011));    // the tree line, above the valley floor
  F.top = top;
  if (L < 0.04) return F;
  const h = S.y - S.fy, ny = nn[1];
  if (h > top + 170 || ny < 0.5 || S.tongue > 0.2 || S.mor > 1) return F;
  const crease = Math.max(smooth(0.32, 0.02, S.rib), smooth(0.38, 0.02, S.sp));
  const shadeSide = smooth(0.05, 0.3, nn[0]);
  const open = smooth(0.5, 0.62, ny) * (1 - S.cliff) * (1 - S.vterr);
  const pat = 0.42 * shadeSide + 0.3 * crease + 0.85 * noise2(wx / 210, S.y / 110, W.ws + 2012) + 0.25 * L;
  // (on the high stretches only a thin scatter of stunted trees, not a wood)
  F.forest = smooth(0.66, 0.8, pat) * smooth(top + 25, top - 35, h) * open * smooth(0.05, 0.3, L);
  if (F.forest > 0) F.birch = noise2(wx / 130, S.y / 60, W.ws + 2015) + 0.3 * crease - 0.002 * h > 0.56 ? 1 : 0;
  // the scrub belt: above the trees, and in the gaps between them
  const sc = Math.min(1, 1.6 * L) * smooth(top + 160, top + 50, h) * open * smooth(0.46, 0.6, noise2(wx / 95, S.y / 48, W.ws + 2013) + 0.2 * shadeSide);
  F.scrub = sc * (1 - F.forest);
  if (F.scrub > 0.3 && noise2(wx / 34, S.y / 20, W.ws + 2014) > 0.55) F.bloom = bloomAt(W, wx);
  return F;
}
// A terraced plot on a fan or on the apron under the wall (4 m a step, by the contour)? h: height
// above the valley floor, ny: the ground normal's y. Asked by the ground colour and the tree planter.
function fanFieldAt(W, S, wx, h, ny, rng) {
  if (!(S.fm > 0.33 && h < 95 && ny > 0.9 && S.cliff <= 0 && S.vterr < 0.25 && S.mor <= 1 && S.tongue <= 0.2)) return null;
  const f = S.base / 4, row = Math.floor(f);
  return fieldAt(W, S, wx, row + 900, f - row, 2044, rng);
}
// The colour the rhododendrons of a stretch mostly flower in (it drifts along the valley).
function bloomAt(W, wx) { return Math.floor(hh(Math.floor(wx / 340 + noise1(wx / 90, W.ws + 2016)), 1, W.ws + 2017) * 4); }
// The riverine wood on the flat floor beyond the river (0..1).
function floorWood(W, S, wx, d) {
  if (S.lu < 0.04) return 0;
  return smooth(0.05, 0.3, S.lu) * smooth(0.52, 0.66, noise2(wx / 170, d / 80, W.ws + 2041) + 0.3 * smooth(70, 8, d - S.bf));
}
// Fields: whole plots, never a blurred patch. row/col name the plot; the test is made per plot, so
// the edge of the farmed ground is the edge of a field. Returns the plot's colour, a wall or riser
// colour on its border, or null where the ground is not farmed.
function fieldAt(W, S, wx, row, fr, lenSalt, rng) {
  const len = 18 + 22 * hh(row, 0, W.ws + lenSalt);
  const fx = wx / len + hh(row, 1, W.ws + lenSalt), col = Math.floor(fx);
  if (S.fm < 0.5 + 0.6 * (hh(row, col, W.ws + 2034) - 0.5)) return null;
  if (fr > 0.84 || (fx - col) * len < 1.4) return mix3(C.riser, C.wallStone, 0.5 * rng());
  const c = cropOf(hh(row, col, W.ws + 2035));
  // the drill rows, faintly
  return mul3(c, 0.92 + 0.16 * noise1(wx / 2.2, row));
}

// Colour of the ground at a point, lit from its normal nn. Every texture here belongs to the
// mountain: rock in beds that follow the contours, scree streaked down the fall line, snow lying in
// the gullies and on ledges above a ragged line, grass and juniper only on the gentle low ground.
function surfColor(W, S, wx, d, rng, nn) {
  let c;
  const lit = Math.max(0, nn[0] * SUN[0] + nn[1] * SUN[1] + nn[2] * SUN[2]);
  // a glacial lake on the floor: the ground under it is water too, so the big ground discs of the
  // mid band, which sort in front of the lake's own splats, do not speckle it with grass
  if (d > S.bf && d < S.bf + 260) {
    const li = Math.floor(wx / LKCELL), f = wx / LKCELL - li;
    // (a lake lies within 400 m of its cell's middle stretch; look next door only near the ends)
    for (let i = f < 0.2 ? li - 1 : li; i <= (f > 0.8 ? li + 1 : li); i++) {
      const L = lake(W, i);
      if (L && Math.hypot((wx - L.wx) / L.rx, (d - L.d) / L.rz) < 0.97) return jitter([0.14, 0.52, 0.57], rng, 0.03);
    }
  }
  switch (S.t) {
    case T.CHANNEL: {
      const ice = S.ch.f > 0.72 && noise1(wx / 60, W.ws + 91) > 0.5 + 0.6 * S.lu;
      c = ice ? C.ice : mix3(C.water, C.waterDeep, (1 - S.ch.f) * (S.ch.k === 0 ? 0.6 : 0.2));
      c = mix3(c, [0.62, 0.68, 0.72], smooth(0.75, 0.9, noise2(wx / 25, d / 4, W.ws + 92)) * 0.5);
      return jitter(c, rng, 0.03);
    }
    case T.BED: {
      // gravel bars: long tongues of pale shingle between darker wet gravel, drawn out along the flow
      c = mix3(C.bed, C.bedDark, noise2(wx / 9, d / 6, W.ws + 93));
      c = mix3(c, [0.66, 0.65, 0.62], 0.6 * smooth(0.5, 0.68, noise2(wx / 110, d / 14, W.ws + 2061)));
      if (noise2(wx / 70, d / 30, W.ws + 94) > 0.72) c = mix3(c, mix3(C.grassDry, C.turf, S.lu), 0.5 + 0.3 * S.lu);
      if (S.lu < 0.4 && noise2(wx / 20, d / 9, W.ws + 99) > 0.88 + 0.3 * S.lu) c = mix3(c, C.snow, 0.7);
      return jitter(c, rng, 0.1);
    }
    case T.NEAR: {
      const L = S.lu;
      const n1 = noise2(wx / 30, d / 25, W.ws + 95), n2 = noise2(wx / 8, d / 6, W.ws + 96);
      c = mix3(C.grass, C.grassDry, smooth(0.3, 0.7, n1));
      if (L > 0.04) c = mix3(c, mix3(C.turf, C.turfGold, smooth(0.3, 0.75, noise2(wx / 80, d / 40, W.ws + 2031))), 0.92 * L);
      if (n2 > 0.7) c = mix3(c, mix3(C.grassDark, C.turfDark, L), 0.6);
      // terraced fields stepping down to the river: a row to every 3.4 m of fall, so the rows
      // follow the contours, each cut along its length into plots
      let field = null;
      if (S.fm > 0.33 && d > 24) {
        const f = (S.y - S.fy) / 3.4, row = Math.floor(f);
        field = fieldAt(W, S, wx, row, f - row, 2033, rng);
      }
      if (field) c = field;
      else {
        // old snow only on the high bare stretches, and lying in the hollows of the ground itself
        // (the same noise that dents the slope), never scattered
        if (L < 0.45 && noise2(wx / 45, d / 70, W.ws + 21) < 0.27 - 0.3 * L && noise2(wx / 13, d / 10, W.ws + 98) > 0.35) c = C.snow;
        // alpine flowers in drifts near the line
        if (L > 0.12 && d < 70) {
          const fl = noise2(wx / 24, d / 9, W.ws + 2036);
          if (fl > 0.56 && rng() < 0.55 * Math.min(1, 2 * L) * smooth(70, 30, d)) {
            const k = Math.floor(wx / 130), two = rng() < 0.3 ? 1 : 0;
            c = FLOWERS[Math.floor(hh(k, two, W.ws + 2037) * FLOWERS.length)];
          }
        }
      }
      break;
    }
    case T.FLOOR: {
      // the valley floor between the river and the wall: frost grass, stones, juniper, old snow
      const L = S.lu;
      const n1 = noise2(wx / 40, d / 30, W.ws + 131);
      c = mix3(C.grass, C.grassDry, smooth(0.3, 0.7, n1));
      if (L > 0.04) c = mix3(c, mix3(C.turf, C.turfGold, smooth(0.3, 0.75, noise2(wx / 110, d / 45, W.ws + 2031))), 0.92 * L);
      // strip fields on the flat ground beyond the river, in rows parallel to it
      let field = null;
      if (S.fm > 0.33) {
        const f = (d - S.bf) / 21, row = Math.floor(f);
        field = fieldAt(W, S, wx, row + 500, 1 - (f - row), 2043, rng);
      }
      if (field) { c = field; S.terr = 1; }
      else {
        const fw = floorWood(W, S, wx, d);
        if (fw > 0) c = mix3(c, mix3(C.birchWood, C.forest, noise2(wx / 60, d / 40, W.ws + 2042)), 0.85 * fw);
        if (L < 0.4) {
          // stones washed out over the floor in fans below the gullies; old snow only up high
          if (noise2(wx / 90, d / 22, W.ws + 132) > 0.7 + 0.5 * L) c = mix3(C.bed, C.stone, 0.5);
          if (noise2(wx / 12, d / 9, W.ws + 134) > 0.9 + 0.2 * L) c = mix3(c, C.snow, 0.7);
        }
      }
      break;
    }
    default: {
      const y = S.y, h = y - S.fy, ny = nn[1];
      const steep = smooth(0.8, 0.56, ny);                           // ~37 to ~56 degrees
      const crease = Math.max(smooth(0.32, 0.02, S.rib), 0.8 * smooth(0.3, 0.02, S.cou) * smooth(60, 200, S.base));   // the bottom line of a couloir
      const big = smooth(0.38, 0.02, S.sp);                         // the bottom of a main gully
      const wRock = clamp(steep + 1.3 * S.cliff + 0.6 * smooth(0.6, 0.95, S.rib) * smooth(160, 420, h) + smooth(260, 650, h) * 0.5, 0, 1);
      const wScree = clamp(1.6 * S.fan + smooth(0.93, 0.8, ny) + smooth(180, 420, h), 0, 1);
      // scree: streaked down the fall line; the formation changes along the valley, grey in
      // places, warm ochre-brown in others
      const streak = noise2(wx / (3.5 + 0.004 * d), y / (40 + 0.04 * d), W.ws + 121);
      const form = smooth(0.3, 0.72, noise2(wx / 1700, y / 700, W.ws + 124));
      // (the edge of the fields ragged, field by field, not the outline of the bench)
      // fields on the fans and the apron under the wall, where the valley is farmed: terraces by
      // the contour (4 m a step), whole plots
      const fanField = fanFieldAt(W, S, wx, h, ny, rng);
      if (h < 260 && S.vterr > 0.25 + 0.6 * (hh(Math.floor(S.base / 4.5), Math.floor(wx / 45), W.ws + 108) - 0.5) * smooth(0.9, 0.3, S.vterr)) {
        // a village bench: terraces cut into the ground, risers at the top 30% of each 4.5 m step
        const f = S.base / 4.5, row = Math.floor(f), fr = f - row;
        const len = 40 + 40 * hh(row, 0, W.ws + 107);
        const field = hh(row, Math.floor(wx / len), W.ws + 106);
        c = fr > 0.7 ? C.riser : field < 0.5 ? C.barley : field < 0.62 ? mix3(C.barley, C.barleyGreen, 0.6) : field < 0.85 ? C.grassDry : mix3(C.plough, C.grassDry, 0.4);
        // (green barley, buckwheat and mustard among the ripe plots where the valley is lush)
        if (fr <= 0.7 && S.lu > 0.3 && hh(row, Math.floor(wx / len), W.ws + 2045) < 0.75 * S.lu) c = cropOf(field);
        S.terr = 1;
      } else if (fanField) {
        c = fanField;
        S.terr = 1;
      } else {
        const F = faceCover(W, S, wx, nn);
        // (grass holds the scree on the lower slopes of a lush stretch)
        const alp = S.lu * smooth(F.top + 240, F.top + 40, h);
        const wS = wScree * (1 - 0.5 * alp);
        c = wS > 0 ? mix3(mix3(C.scree, C.screeWarm, form), C.screeDark, smooth(0.25, 0.8, streak)) : C.scree;
        if (wS < 1) {
          // the low ground: frost grass, and juniper scrub on the shaded (+x facing) flanks of the
          // spurs and in the gully bottoms, so it draws the relief instead of spotting it
          const lowN = smooth(0.25, 0.75, noise2(wx / 90, d / 70, W.ws + 101));
          let low = mix3(C.grass, C.grassDry, lowN);
          if (alp > 0) low = mix3(low, mix3(C.alp, C.alpGold, lowN), 0.9 * alp);
          const shadeSide = smooth(0.08, 0.3, nn[0]) + 0.4 * Math.max(crease, big);
          if (h < 360 && ny > 0.62 && shadeSide * smooth(360, 200, h) + 0.25 * (noise2(wx / 14, y / 10, W.ws + 112) - 0.5) > 0.55) low = mix3(C.juniper, C.grassDark, 0.3 * noise2(wx / 9, y / 7, W.ws + 113));
          c = mix3(low, c, wS);
        }
        // forest floor under the trees, the scrub belt above them (rhododendron in flower in patches)
        if (F.forest > 0) c = mix3(c, F.birch ? mix3(C.birchWood, C.forestLit, 0.4 * streak) : mix3(C.forest, C.forestLit, 0.5 * streak), Math.min(1, 1.15 * F.forest));
        else if (F.scrub > 0) c = mix3(c, F.bloom >= 0 && rng() < 0.3 ? mix3(BLOOM[F.bloom], BLOOM[2], 0.35) : mix3(C.rhodo, C.juniper, streak), 0.85 * F.scrub);
        if (wRock > 0) {
          // rock in beds following the contours, some pale, some dark
          const bedN = noise1((y + 30 * noise2(wx / 320, d / 320, W.ws + 122)) / 13, W.ws + 120);
          let rock = mix3(C.rock, C.rockDark, 0.2 + 0.55 * bedN);
          rock = mix3(rock, mix3(C.rockWarm, C.rockDark, 0.4 * bedN), 0.75 * form);
          if (bedN < 0.22) rock = mix3(rock, C.rockPale, 0.7);
          c = mix3(c, rock, wRock);
        }
      }
      if (S.mor > 1) c = mix3(mix3(C.scree, C.stoneDark, 0.3 + 0.4 * streak), mix3(C.alp, C.turfDark, streak), 0.85 * S.lu);
      // a glacier's tongue: grey-white ice with dark moraine stripes running down it
      if (S.tongue > 0.25) {
        const stripe = noise1(wx / 22, W.ws + 140) > 0.78;
        c = mix3(c, stripe ? [0.33, 0.32, 0.31] : mix3(C.ice, C.snow, 0.3 * streak), smooth(0.25, 0.6, S.tongue));
      }
      // gully lines and the foot of cliffs lie in shadow
      const ao = 1 - 0.38 * crease * smooth(0, 80, S.se) - 0.22 * big * smooth(0, 120, S.se) - 0.1 * S.cliff;
      // snow: patchy below the line, lying lower in the gullies and on ledges, solid above, but not
      // on steep rock or the crests of the ribs
      const gullyK = Math.max(crease, big) * smooth(220, 420, h);
      const sn = h < 60 ? 0 : smooth(-40, 40, h - snowLine(W, wx, d) - 90 * S.lu + 300 * gullyK + 160 * smooth(0.8, 0.93, ny) - 120 * smooth(0.66, 0.45, ny) - 160 * S.cliff - 170 * smooth(0.7, 1, S.rib) * steep);
      c = mul3(shade(c, nn[0], nn[1], nn[2], 0.4, 0.75), ao);
      if (sn > 0) {
        const snc = mul3(mix3(C.snowShade, C.snow, clamp(lit * 1.35 - 0.15, 0, 1)), 0.75 + 0.25 * ao);
        c = mix3(c, snc, sn);
      }
      return jitter(c, rng, 0.05);
    }
  }
  c = shade(c, nn[0], nn[1], nn[2], 0.55, 0.6);
  return jitter(c, rng, 0.07);
}

// ---------------------------------------------------------------------------------------------
// Ground fill (one splat per sample; lands the count on ctx.count)
// ---------------------------------------------------------------------------------------------
// The splats are spread by how much of the window each part of the band fills, not by its plan
// area: per strip of the chunk, a table of 40 distance bins weighted by the angle the ground
// climbs through in each (seen from the line, out to the top of the window), with a floor so no
// part is ever left thin. A wall facing the window gets most of them; ground hidden behind the crest
// or above the window gets few. Each splat lies on the surface (oriented by its normal) and is
// stretched down the fall line by the steepness, so it covers the slope it stands on: rock and scree
// come out as streaks down the slope, terraces as lines along the contours.
const CAMY = 2.6, TAN_TOP = 0.62, TAN_BOT = -0.62;
function* fillSurface(ctx, out, W, opts = {}) {
  out.limit = Infinity;
  const n = Math.floor(opts.n != null ? opts.n : out.left());
  if (n <= 0) return;
  const rng = ctx.rng, L = ctx.length;
  const dn = opts.dNear != null ? opts.dNear : ctx.zNear, df = opts.dFar != null ? opts.dFar : ctx.zFar;
  const NS = opts.strips || 6, NB = 40, cover = opts.cover || 3.2;
  const minR = opts.minR || 0.0015, maxR = opts.maxR || 0.035, floorK = opts.floor != null ? opts.floor : 0.4;
  const db = new Float64Array(NB + 1);
  for (let b = 0; b <= NB; b++) db[b] = dn * Math.pow(df / dn, b / NB);
  const SL = L / NS;
  const tabs = [], tot = new Float64Array(NS);
  let all = 0;
  for (let k = 0; k < NS; k++) {
    const w = new Float64Array(NB);
    for (const fx of [0.25, 0.75]) {
      const wx = ctx.x0 + (k + fx) * SL;
      // (no culling behind nearer ground along the column: the train sees past a spur obliquely)
      let e0 = clamp((W.H(wx, db[0]) - CAMY) / db[0], TAN_BOT, TAN_TOP);
      for (let b = 0; b < NB; b++) {
        const e1 = clamp((W.H(wx, db[b + 1]) - CAMY) / db[b + 1], TAN_BOT, TAN_TOP);
        if (e1 > e0) w[b] += (e1 - e0) * 2 / (db[b] + db[b + 1]);
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
  // strips that see little still get a share
  let all2 = 0;
  for (let k = 0; k < NS; k++) { tot[k] = Math.max(tot[k], 0.35 * all / NS); all2 += tot[k]; }
  let done = 0;
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
      const r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
      const e = Math.max(0.5, r * 0.7);
      // neighbours first: the centre call leaves its findings in WL for surface()
      const hxp = W.H(wx + e, d), hdp = W.H(wx, d + e);
      const S = surface(W, wx, d);
      const y = S.y;
      const nn = norm3(-(hxp - y) / e, 1, (hdp - y) / e);
      const c = surfColor(W, S, wx, d, rng, nn);
      yield* emitGround(ctx, out, S, x, y, d, r, c, nn, rng, opts.tuft);
    }
  }
}
const QG = [0, 0, 0, 1];
function* emitGround(ctx, out, S, x, y, d, r, c, nn, rng, tuftD) {
  const ny = nn[1];
  if (S.t === T.FACE || S.t === T.FLOOR) {
    // tilt the splat onto the surface with its local z down the fall line
    const ph = Math.atan2(nn[0], nn[2]) * 0.5, cy = Math.cos(ph), sy = Math.sin(ph);
    const u = quatUpTo(nn[0], nn[1], nn[2]);
    QG[0] = u[0] * cy - u[2] * sy; QG[1] = u[3] * sy + u[1] * cy; QG[2] = u[2] * cy + u[0] * sy; QG[3] = u[3] * cy - u[1] * sy;
    const el = clamp(1 / ny, 1, 2.0);
    if (S.terr) out(x, y + 0.05, -d, r * 2.5, r * 0.08, r * 0.34 * el, c[0], c[1], c[2], 1, QG[0], QG[1], QG[2], QG[3], KIND.GROUND);
    else {
      const a = 0.85 + 0.3 * rng(), k = ny < 0.9 ? 1.15 : 1;
      out(x, y + 0.04, -d, r * a, r * 0.12, r * (2 - a) * k * el, c[0], c[1], c[2], 1, QG[0], QG[1], QG[2], QG[3], KIND.GROUND);
    }
  } else {
    const q = quatUpTo(nn[0], nn[1], nn[2]);
    const ax = 0.8 + 0.5 * rng();
    const water = S.t === T.CHANNEL;
    const tuft = tuftD && S.t === T.NEAR ? Math.max(0, 1 - d / tuftD) : 0;
    out(x, y + 0.03 + tuft * r * 0.3 * rng(), -d, r * ax * (water ? 1.4 : 1), r * (water ? 0.05 : 0.14 + 0.25 * tuft), r * (1.8 - ax) * (water ? 0.7 : 1), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND);
  }
  if (out.due()) yield;
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
  const a1 = 1 - p;
  const A = Math.pow(dn, a1), B = Math.pow(df, a1), Z = (B - A) / a1;
  for (let i = 0; i < n; i++) {
    const d = Math.pow(A + ((i + rng()) / n) * (B - A), 1 / a1);
    const x = rng() * L, wx = ctx.x0 + x;
    const dens = (n * Math.pow(d, -p) / Z) / L;
    const r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
    const e = Math.max(0.5, r);
    const hxp = W.H(wx + e, d), hdp = W.H(wx, d + e);
    const S = surface(W, wx, d);
    const nn = norm3(-(hxp - S.y) / e, 1, (hdp - S.y) / e);
    const c = surfColor(W, S, wx, d, rng, nn);
    yield* emitGround(ctx, out, S, x, S.y, d, r, c, nn, rng, opts.tuft);
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
// Props
// ---------------------------------------------------------------------------------------------
function hourOf(ctx) { const h = ctx.hour != null ? ctx.hour : 12; return ((h % 24) + 24) % 24; }
function litShare(ctx) { const h = hourOf(ctx); if (h > 6.5 && h < 19.5) return 0; return h > 0.5 && h < 5 ? 0.06 : 0.25; }

// Tone for a vertical face with outward normal (nx, nz) in splat space: the camera-facing front,
// the sunlit (-x) end and the shaded (+x) end come out clearly different (as karst.js).
function faceTone(c, nx, nz) {
  const k = 0.6 + 0.26 * Math.max(0, nz) + 0.42 * Math.max(0, -nx) - 0.06 * Math.max(0, nx) - 0.12 * Math.max(0, -nz);
  const cool = Math.max(0, nx) + 0.5 * Math.max(0, -nz);
  return [c[0] * k * (1 - 0.05 * cool), c[1] * k * (1 - 0.01 * cool), c[2] * k * (1 + 0.07 * cool)];
}
// Fill a rectangle with splats on a jittered grid: o = corner (splat space), u/v unit edges,
// colorAt(a, b) -> [r,g,b] | null | { c, light }. thin: 'z' (an upright face) or 'y' (a roof).
function* quad(out, o, u, v, lu, lv, s, colorAt, q, kind, rng, thin = 'z') {
  const nu = Math.max(1, Math.round(lu / (s * 1.5))), nv = Math.max(1, Math.round(lv / (s * 1.5)));
  const su = (lu / nu) * 0.62, sv = (lv / nv) * 0.62, st = Math.max(0.03, s * 0.12);
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = (i + 0.5 + (rng() - 0.5) * 0.3) / nu, b = (j + 0.5 + (rng() - 0.5) * 0.3) / nv;
      let c = colorAt(a, b);
      if (!c) continue;
      let k = kind;
      if (c.light) { k = KIND.LIGHT; c = c.c; }
      const px = o[0] + u[0] * a * lu + v[0] * b * lv, py = o[1] + u[1] * a * lu + v[1] * b * lv, pz = o[2] + u[2] * a * lu + v[2] * b * lv;
      if (thin === 'z') out(px, py, pz, su, sv, st, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], k);
      else out(px, py, pz, su, st, sv, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], k);
      if (out.due()) yield;
    }
  }
}

// An upright box with all four walls and a top: centre (x chunk-local, d), base y, yaw.
// faces(f, a, b) colours a point: f 0 front, 1 back, 2 west end, 3 east end, 4 top; a along the
// face, b up it (0..1). Every face is drawn, so it reads from in front, the side and behind.
function* box(out, x, y, d, w, dep, h, yaw, s, faces, kind, rng) {
  const [ex, ez] = rotY(1, 0, yaw), [fx, fz] = rotY(0, 1, yaw);
  const P = (lx, ly, lz) => [x + ex * lx + fx * lz, y + ly, -d + ez * lx + fz * lz];
  const q = quatYaw(yaw), qs = quatMul(q, quatYaw(Math.PI / 2));
  yield* quad(out, P(-w / 2, 0, dep / 2), [ex, 0, ez], [0, 1, 0], w, h, s, (a, b) => faces(0, a, b, fx, fz), q, kind, rng);
  yield* quad(out, P(w / 2, 0, -dep / 2), [-ex, 0, -ez], [0, 1, 0], w, h, s, (a, b) => faces(1, a, b, -fx, -fz), q, kind, rng);
  yield* quad(out, P(-w / 2, 0, -dep / 2), [fx, 0, fz], [0, 1, 0], dep, h, s, (a, b) => faces(2, a, b, -ex, -ez), qs, kind, rng);
  yield* quad(out, P(w / 2, 0, dep / 2), [-fx, 0, -fz], [0, 1, 0], dep, h, s, (a, b) => faces(3, a, b, ex, ez), qs, kind, rng);
  yield* quad(out, P(-w / 2, h, -dep / 2), [ex, 0, ez], [fx, 0, fz], w, dep, s, (a, b) => faces(4, a, b, 0, 0), q, kind, rng, 'y');
}

// A flat-roofed Himalayan house: battered stone or whitewashed walls, dark trapezoid windows with
// black frames, a dark band of brushwood along the parapet and a flat earth roof. Gompa halls use
// opts.band (a dark red upper band). opts: { w, dep, h, yaw, wall, y, s, kind, rng, band, lit, flag }
function* flatHouse(ctx, out, x, d, opts) {
  const rng = opts.rng;
  const w = opts.w, dep = opts.dep, h = opts.h, yaw = opts.yaw || 0;
  const wall = opts.wall || C.white, kind = opts.kind != null ? opts.kind : KIND.BUILDING;
  // at low budgets far houses get coarser (fewer, larger splats), so the band keeps its share
  const s = clamp(opts.s, 0.1, Math.min(w, h) / clamp(5 * Math.sqrt(out.density), 2.5, 5));
  const y = opts.y;
  const coarse = s > 0.9;
  const para = coarse ? 0.5 : Math.max(0.45, Math.min(s * 0.5, h * 0.1));
  const storeys = Math.max(1, Math.round(h / 3.1));
  const cols = Math.max(1, Math.round(w / 2.8));
  const band = opts.band ? 0.8 : 2;
  const lit = opts.lit || 0;
  const salt = opts.salt || 0;
  const wj = 0.94 + 0.12 * rng();
  const fineWin = s < 0.55;
  const faces = (f, a, b, nx, nz) => {
    if (f === 4) {
      const edge = Math.min(a, 1 - a) * w < 0.6 || Math.min(b, 1 - b) * dep < 0.6;
      return jitter(edge ? C.parapet : C.roof, rng, 0.06);
    }
    const yy = b * h;
    if (yy > h - para) return faceTone(C.parapet, nx, nz);
    const len = f < 2 ? w : dep;
    const ncol = f < 2 ? cols : Math.max(1, Math.round(dep / 3.2));
    let c = wall;
    if (b > band) c = C.maroon;
    // windows: in rows by storey, narrower at the top (trapezoid), with black frames
    if (f !== 1 || storeys > 1) {
      const fs = (yy - 0.3) / (h - 0.6) * storeys, iy = fs - Math.floor(fs);
      const fc = a * ncol, ix = fc - Math.floor(fc);
      const taper = 0.12 + 0.04 * iy;
      const inWin = iy > 0.35 && iy < 0.8 && Math.abs(ix - 0.5) < taper && yy > 0.9 && (f < 2 || Math.floor(fc) % 2 === 0);
      if (inWin && coarse) {
        if (Math.floor(fc) % 2 === 1 || f > 1 || Math.floor(fs) < storeys - 1) return mul3(faceTone(c, nx, nz), wj);
        return mix3(faceTone(c, nx, nz), C.window, 0.75);
      }
      if (inWin) {
        const ci = Math.floor(fs) * 31 + Math.floor(fc) + f * 7;
        if (lit && hh(ci, salt, 977) < lit) return { c: LIT, light: true };
        return C.window;
      }
      if (fineWin && iy > 0.3 && iy < 0.85 && Math.abs(ix - 0.5) < taper + 0.07 && yy > 0.9 && (f < 2 || Math.floor(fc) % 2 === 0)) return faceTone(mul3(C.window, 1.8), nx, nz);
    }
    void len;
    return mul3(faceTone(c, nx, nz), wj * (0.95 + 0.08 * b));
  };
  yield* box(out, x, y, d, w, dep, h, yaw, s, faces, kind, rng);
  // a little prayer flag on a stick at one roof corner
  if (opts.flag) {
    const [ex, ez] = rotY(1, 0, yaw), [fx, fz] = rotY(0, 1, yaw);
    const sgn = rng() < 0.5 ? -1 : 1;
    const px = x + ex * sgn * (w / 2 - 0.4) + fx * (dep / 2 - 0.4), pz = -d + ez * sgn * (w / 2 - 0.4) + fz * (dep / 2 - 0.4);
    const r = Math.max(0.05, 0.0006 * d);
    strut(out, px, y + h, pz, px, y + h + 2.4, pz, r, C.pole, 2, 1, KIND.OTHER);
    const fwid = Math.max(0.35, 0.0025 * d);
    for (let k = 0; k < 3; k++) {
      const c = FLAGS[(k + Math.floor(rng() * 5)) % 5];
      out(px + 0.05, y + h + 2.2 - k * fwid * 0.9, pz + 0.05, fwid * 0.5, fwid * 0.42, fwid * 0.15, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
    }
  }
}

// A chorten (white stupa): a stepped square base, a white dome, a painted harmika and a tapering
// ochre spire of rings with a gold finial. H = total height. opts: { y, s, kind, rng, lean, gold }
function* chorten(ctx, out, x, d, H, opts) {
  const rng = opts.rng, kind = opts.kind != null ? opts.kind : KIND.BUILDING;
  const s = clamp(opts.s, 0.06, H / 8);
  const y0 = opts.y;
  const yaw = opts.yaw || 0;
  const white = opts.white || C.white;
  const flat = (col) => (f, a, b, nx, nz) => (f === 4 ? mul3(col, 0.95) : faceTone(col, nx, nz));
  const b1 = 0.72 * H, h1 = 0.17 * H, b2 = 0.56 * H, h2 = 0.12 * H;
  yield* box(out, x, y0 - 0.2, d, b1, b1, h1 + 0.2, yaw, s, flat(white), kind, rng);
  yield* box(out, x, y0 + h1, d, b2, b2, h2, yaw, s, flat(white), kind, rng);
  // dome
  const R = 0.24 * H, cy = y0 + h1 + h2, Hd = 0.24 * H;
  const nd = Math.max(8, Math.round((Math.PI * R * Hd * 1.6) / (s * s * 1.4)));
  const ss = Math.sqrt((Math.PI * R * Hd * 2) / nd) * 0.8;
  for (let i = 0; i < nd; i++) {
    const a = (rng() * 2 - 1) * 1.9, ph = Math.asin(Math.pow(rng(), 0.8));
    const nx = Math.sin(a) * Math.cos(ph), ny = Math.sin(ph), nz = Math.cos(a) * Math.cos(ph);
    const c = jitter(shade(white, nx, ny, nz, 0.6, 0.5), rng, 0.03);
    out(x + nx * R, cy + ny * Hd * 1.05, -(d - nz * R), ss, ss * 0.8, ss * 0.6, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    if (out.due()) yield;
  }
  // harmika
  const hy = cy + Hd * 0.95, hw = 0.16 * H;
  yield* box(out, x, hy, d, hw, hw, 0.09 * H, yaw, s, (f, a, b, nx, nz) => (f === 4 ? C.ochre : faceTone(b > 0.5 ? C.ochre : white, nx, nz)), kind, rng);
  // spire: rings tapering upward, then the finial
  const sy0 = hy + 0.09 * H, sh = 0.3 * H * (opts.spire || 1);
  const lean = opts.lean || 0;
  const nr = Math.max(4, Math.round(sh / Math.max(0.12, s * 0.8)));
  const spireC = opts.gold ? mix3(C.ochre, C.gold, opts.gold) : C.ochre;
  for (let k = 0; k < nr; k++) {
    const t = (k + 0.5) / nr, rr = 0.075 * H * (1 - 0.6 * t);
    const c = shade(k % 2 ? spireC : mul3(spireC, 0.85), 0, 0.3, 1, 0.65, 0.4);
    out(x + lean * t * sh, sy0 + t * sh, -d, rr, sh / nr * 0.55, rr, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
  }
  const fr = Math.max(0.12 * H / 6, 0.0012 * d);
  out(x + lean * sh, sy0 + sh + fr, -d, fr, fr * 1.3, fr, C.gold[0], C.gold[1], C.gold[2], 1, 0, 0, 0, 1, kind);
  if (out.due()) yield;
}

// A string of prayer flags along a sagging cord from a to b (world [wx, y, d]). The cord is a chain
// of thin struts; each flag a small flattened splat hanging just below it, blue, white, red,
// green, yellow in order along the string. Flags grow with distance so a string stays a line of
// coloured dots far off, and turn roughly toward the camera (they flutter), so a string running
// away from the line does not go edge-on. Only the parts whose distance lies in [dLo, dHi) are
// drawn: each band draws its own piece of a string that crosses a border.
function* flagString(ctx, out, st, dLo, dHi, kind = KIND.OTHER) {
  const [ax, ay, ad] = st.a, [bx, by, bd] = st.b;
  if (Math.max(ad, bd) < dLo || Math.min(ad, bd) >= dHi) return;
  if (Math.max(ax, bx) < ctx.x0 - 30 || Math.min(ax, bx) > ctx.x0 + ctx.length + 30) return;
  const L = Math.hypot(bx - ax, by - ay, bd - ad);
  if (L < 1) return;
  const sagH = st.sag * L;
  const x0 = ctx.x0;
  const P = (t, o) => { o[0] = ax + (bx - ax) * t; o[1] = ay + (by - ay) * t - 4 * sagH * t * (1 - t); o[2] = ad + (bd - ad) * t; return o; };
  const p0 = [0, 0, 0], p1 = [0, 0, 0];
  const dmid = (ad + bd) / 2;
  const nseg = clamp(Math.ceil(L / Math.max(0.6, 0.012 * Math.min(ad, bd))), 2, 600);
  const cordC = st.cord || C.cord;
  for (let k = 0; k < nseg; k++) {
    P(k / nseg, p0); P((k + 1) / nseg, p1);
    const dm = (p0[2] + p1[2]) / 2;
    if (dm < dLo || dm >= dHi) continue;
    const xm = (p0[0] + p1[0]) / 2 - x0;
    if (xm < -2 || xm > ctx.length + 2) continue;
    strut(out, p0[0] - x0, p0[1], -p0[2], p1[0] - x0, p1[1], -p1[2], Math.max(0.035, 0.0005 * dm), cordC, 1, 1, KIND.WIRE);
    if (out.due()) yield;
  }
  if (st.noFlags) return;
  const fw0 = st.fw || 0.46;
  const spacing = Math.max(fw0, 0.0024 * dmid) * 1.3 / (dmid > 300 ? Math.min(1, Math.sqrt(out.density)) : 1);
  const N = clamp(Math.floor(L / spacing), 2, 900);
  const seed = st.seed | 0;
  const fade = st.fade != null ? st.fade : 0.15 + 0.4 * hh(seed, 1, 5);
  const off = Math.floor(hh(seed, 2, 5) * 5);
  for (let i = 0; i < N; i++) {
    P((i + 0.5) / N, p0);
    const d = p0[2];
    if (d < dLo || d >= dHi) continue;
    const x = p0[0] - x0;
    if (x < -1 || x > ctx.length + 1) continue;
    const fw = Math.max(fw0, 0.0024 * d) * (st.scale || 1), fh = fw * 1.15;
    const r1 = hh(seed, i, 11), r2 = hh(seed, i, 12);
    let c = FLAGS[(i + off) % 5];
    c = mix3(c, [0.72, 0.7, 0.64], fade * r2);
    const yaw = (r1 - 0.5) * 1.1, roll = (r2 - 0.5) * 0.35;
    const q = quatMul(quatYaw(yaw), quatAxis(0, 0, 1, roll));
    const k = 0.85 + 0.25 * r1;
    out(x, p0[1] - fh * 0.55, -d, fw * 0.48, fh * 0.5, fw * 0.12, c[0] * k, c[1] * k, c[2] * k, 1, q[0], q[1], q[2], q[3], kind, MOVE.FLAG);
    if (d < 90) out(x + 0.02, p0[1] - fh * 0.85, -(d - 0.02), fw * 0.44, fh * 0.22, fw * 0.1, c[0] * k * 0.82, c[1] * k * 0.82, c[2] * k * 0.82, 1, q[0], q[1], q[2], q[3], kind, MOVE.FLAG);
    if (out.due()) yield;
  }
}

// A pole, and for a darchog a long single-colour banner down its upper half and a dark yak-tail
// tuft at the top. opts: { banner, kind }
function* flagPole(ctx, out, W, p, kind = KIND.OTHER) {
  const x = p.wx - ctx.x0, y = W.H(p.wx, p.d) - 0.2, d = p.d;
  const r = Math.max(0.07, 0.0006 * d);
  strut(out, x, y, -d, x, y + p.h, -d, r, C.pole, Math.max(2, Math.round(p.h / 1.5)), 1, kind);
  const tf = Math.min(r * 2.2, 0.3);
  out(x, y + p.h + 0.15, -d, tf, tf * 1.2, tf, 0.12, 0.1, 0.09, 1, 0, 0, 0, 1, kind);
  if (p.banner) {
    const c = FLAGS[Math.floor(hh(p.seed | 0, 3, 7) * 5)];
    const bw = Math.max(0.7, 0.003 * d), bl = p.h * 0.62, n = Math.max(3, Math.round(bl / Math.max(0.35, bw * 0.6)));
    const flap = (hh(p.seed | 0, 4, 7) - 0.5) * 0.8;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const yy = y + p.h - 0.3 - t * bl;
      const sh = 0.88 + 0.2 * Math.sin(k * 1.7 + p.seed);
      const q = quatYaw(flap + 0.2 * Math.sin(k * 0.9));
      out(x + bw * 0.55 + 0.05 * Math.sin(k), yy, -d, bw * 0.5, bl / n * 0.6, bw * 0.1, c[0] * sh, c[1] * sh, c[2] * sh, 1, q[0], q[1], q[2], q[3], kind, MOVE.FLAG);
    }
  }
  if (out.due()) yield;
}

// A yak: a dark, shaggy, humped body, the long hair hanging in a skirt to the knees, the head
// lowered to graze or raised, pale horns, short legs, a bushy tail; some with red tassels at the
// ears or a saddle blanket. Built from a handful of shaped splats so it reads at 40-150 m.
//   o: { yaw (heading in the x-d plane), k (scale), col, graze, tassel, blanket, white, lod, kind }
// Animals have no KIND of their own: they answer the beat through MOVE.FLASH on every splat
// (they brighten, they do not swell). Floating houses go through beatOut (MOVE.BEAT).
function moveOut(out, key, move) {
  if (out[key]) return out[key];
  const b = (x, y, z, sx, sy, sz, r, g, bb, o, qx, qy, qz, qw, k) => out(x, y, z, sx, sy, sz, r, g, bb, o, qx, qy, qz, qw, k, move);
  b.due = out.due; b.density = out.density; b.detailK = out.detailK; b.ctx = out.ctx;
  b.q = (x, y, z, sx, sy, sz, c, o, q, kind) => b(x, y, z, sx, sy, sz, c[0], c[1], c[2], o, q ? q[0] : 0, q ? q[1] : 0, q ? q[2] : 0, q ? q[3] : 1, kind);
  out[key] = b;
  return b;
}
function beatOut(out) { return moveOut(out, 'beatOut', MOVE.BEAT); }
function flashOut(out) { return moveOut(out, 'flashOut', MOVE.FLASH); }
function* yak(ctx, out, wx, y, d, o) {
  out = flashOut(out);
  const k = o.k || 1, kind = o.kind != null ? o.kind : KIND.OTHER;
  const ca = Math.cos(o.yaw), sa = Math.sin(o.yaw);
  const x0 = wx - ctx.x0;
  const pt = [0, 0, 0];
  const P = (u, h, v) => { pt[0] = x0 + (u * ca - v * sa) * k; pt[1] = y + h * k; pt[2] = -(d + (u * sa + v * ca) * k); return pt; };
  const q = quatYaw(o.yaw);
  const base = o.col;
  const hi = [base[0] * 1.7 + 0.05, base[1] * 1.6 + 0.04, base[2] * 1.5 + 0.03];
  const lo = mul3(base, 0.7);
  const E = (u, h, v, rx, ry, rz, c, qq = q) => { P(u, h, v); out(pt[0], pt[1], pt[2], rx * k, ry * k, rz * k, c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], kind); };
  const graze = o.graze;
  // radii are one standard deviation: a splat shows to about twice its radius
  const hx = 1.12, hy = graze ? 0.5 : 1.06;
  if (o.lod) {
    E(0, 1.0, 0, 0.62, 0.34, 0.28, base);
    E(0.5, 1.35, 0, 0.26, 0.18, 0.2, hi);
    E(hx, hy, 0, 0.2, 0.14, 0.14, base);
    if (out.due()) yield;
    return;
  }
  // legs, short and dark below the fringe of hair
  const legC = mul3(base, 0.85), lr = Math.max(0.085 * k, 0.0009 * d);
  for (const [u, v] of [[0.6, 0.18], [0.6, -0.18], [-0.55, 0.18], [-0.55, -0.18]]) {
    const pa = [...P(u, 0.72, v)], pb = P(u + 0.02, 0.02, v);
    strut(out, pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], lr, legC, 2, 1, kind);
  }
  // the long hair hanging along the flanks and belly
  E(0.05, 0.7, 0, 0.6, 0.1, 0.22, lo);
  E(0.1, 0.66, 0.2, 0.5, 0.1, 0.05, lo);
  E(0.1, 0.66, -0.2, 0.5, 0.1, 0.05, lo);
  // the body: a long barrel, the hump over the shoulders, a lit line along the back
  E(-0.42, 0.98, 0, 0.42, 0.27, 0.25, base);
  E(0.1, 1.0, 0, 0.45, 0.3, 0.26, base);
  E(0.5, 1.18, 0, 0.3, 0.28, 0.25, base);
  E(0.45, 1.44, 0, 0.25, 0.13, 0.18, hi);
  E(-0.15, 1.24, 0, 0.5, 0.08, 0.17, hi);
  // neck and head, lowered to graze or raised
  const qh = quatMul(q, quatAxis(0, 0, 1, graze ? -0.7 : -0.15));
  E(0.88, graze ? 0.82 : 1.1, 0, 0.21, 0.18, 0.17, base, qh);
  E(hx, hy, 0, 0.19, 0.12, 0.12, base, qh);
  if (o.white) E(hx + 0.08, hy, 0, 0.1, 0.08, 0.1, [0.72, 0.7, 0.66], qh);
  // horns: out and up from the poll, pale
  const hr = Math.max(0.05 * k, 0.0008 * d);
  for (const v of [-1, 1]) {
    const pa = [...P(hx - 0.05, hy + 0.1, v * 0.08)], pb = [...P(hx, hy + 0.2, v * 0.27)], pc = P(hx - 0.05, hy + 0.38, v * 0.3);
    strut(out, pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], hr, C.horn, 1, 1, kind);
    strut(out, pb[0], pb[1], pb[2], pc[0], pc[1], pc[2], hr * 0.85, C.horn, 1, 1, kind);
    if (o.tassel) E(hx - 0.08, hy + 0.02, v * 0.16, 0.07, 0.07, 0.07, [0.76, 0.1, 0.08]);
  }
  // tail, hanging, with a bushy tuft (pale on some)
  {
    const pa = [...P(-0.84, 1.1, 0)], pb = P(-0.92, 0.58, 0);
    strut(out, pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], Math.max(0.06 * k, 0.0007 * d), base, 1, 1, kind);
    E(-0.92, 0.48, 0, 0.08, 0.13, 0.08, o.white ? [0.7, 0.68, 0.64] : lo);
  }
  if (o.blanket) {
    const bc = [0.62, 0.14, 0.1], bc2 = [0.15, 0.26, 0.55];
    E(0.05, 1.3, 0, 0.3, 0.05, 0.27, bc);
    E(0.05, 1.08, 0.27, 0.28, 0.16, 0.03, bc2);
    E(0.05, 1.08, -0.27, 0.28, 0.16, 0.03, bc2);
  }
  if (o.white) E(-0.3, 1.0, 0.25, 0.22, 0.17, 0.05, [0.7, 0.68, 0.64]);
  if (o.load) {
    // a pack yak: two sacks slung either side and a bundle lashed on top
    for (const v of [1, -1]) E(-0.05, 1.08, 0.34 * v, 0.36, 0.21, 0.08, o.load);
    E(-0.05, 1.42, 0, 0.36, 0.13, 0.3, [0.7, 0.66, 0.58]);
  }
  if (out.due()) yield;
}

// A blue sheep (bharal): slate grey-brown, white belly and leg fronts, black chest and flank
// line, thick horns curving out and back.
function* bharal(ctx, out, wx, y, d, o) {
  out = flashOut(out);
  const k = o.k || 1, kind = KIND.OTHER;
  const ca = Math.cos(o.yaw), sa = Math.sin(o.yaw);
  const x0 = wx - ctx.x0;
  const pt = [0, 0, 0];
  const P = (u, h, v) => { pt[0] = x0 + (u * ca - v * sa) * k; pt[1] = y + h * k; pt[2] = -(d + (u * sa + v * ca) * k); return pt; };
  const q = quatYaw(o.yaw);
  const E = (u, h, v, rx, ry, rz, c, qq = q) => { P(u, h, v); out(pt[0], pt[1], pt[2], rx * k, ry * k, rz * k, c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], kind); };
  // (the coat is a warm slate-brown, apart from the grey rock it stands on; the legs dark with only
  // a pale stripe, since pale legs under a body the colour of the rock read as a little table)
  const coat = [0.52, 0.43, 0.33], coatHi = [0.64, 0.54, 0.41], belly = [0.74, 0.72, 0.67], black = [0.08, 0.07, 0.07];
  const lr = Math.max(0.045, 0.00055 * d) / k;
  for (const [u, v, c] of [[0.24, 0.08, black], [0.24, -0.08, black], [-0.24, 0.08, mul3(coat, 0.7)], [-0.24, -0.08, mul3(coat, 0.7)]]) {
    const a = [...P(u, 0.62, v)], b = P(u, 0.02, v);
    strut(out, a[0], a[1], a[2], b[0], b[1], b[2], lr * k, c, 2, 1, kind);
  }
  E(0, 0.8, 0, 0.36, 0.19, 0.16, coat);
  E(-0.05, 0.94, 0, 0.3, 0.07, 0.12, coatHi);
  E(0, 0.66, 0, 0.22, 0.045, 0.1, belly);
  E(0.02, 0.7, 0.15, 0.28, 0.03, 0.02, black);
  E(0.3, 0.72, 0, 0.09, 0.13, 0.09, black);
  const look = o.look ? 0.9 : 0;
  const qh = quatMul(q, quatYaw(look));
  const hx = 0.5, hy = 1.06;
  E(0.4, 0.93, 0, 0.09, 0.13, 0.08, coat, qh);
  const hc = [0.45, 0.41, 0.36];
  const lx = Math.cos(look) * 0.14, lv = -Math.sin(look) * 0.14;
  E(hx + lx * 0.3, hy, lv * 0.3, 0.1, 0.06, 0.06, hc, qh);
  for (const v of [-1, 1]) {
    const a = [...P(hx - 0.04, hy + 0.06, v * 0.05)], b = [...P(hx - 0.16, hy + 0.17, v * 0.18)], c = P(hx - 0.28, hy + 0.08, v * 0.22);
    const hr = Math.max(0.04, 0.0006 * d);
    strut(out, a[0], a[1], a[2], b[0], b[1], b[2], hr, [0.36, 0.34, 0.3], 1, 1, kind);
    strut(out, b[0], b[1], b[2], c[0], c[1], c[2], hr * 0.8, [0.36, 0.34, 0.3], 1, 1, kind);
  }
  E(-0.34, 0.84, 0, 0.05, 0.07, 0.04, black);
  if (out.due()) yield;
}

// A low dry-stone wall from (ax, ad) to (bx, bd), world x and distance.
function* stoneWall(ctx, out, W, ax, ad, bx, bd, h, salt, kind = KIND.OTHER) {
  const L = Math.hypot(bx - ax, bd - ad);
  if (L < 0.5) return;
  const dm = (ad + bd) / 2;
  const step = Math.max(0.32, detail(out, dm, 1.3));
  const n = Math.max(2, Math.round(L / step));
  const q = quatYaw(Math.atan2(bd - ad, bx - ax));
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n, wx = lerp(ax, bx, t), d = lerp(ad, bd, t);
    const x = wx - ctx.x0;
    if (x < -1 || x > ctx.length + 1) continue;
    const y = W.H(wx, d);
    const r = hh(k, salt, 3), r2 = hh(k, salt, 4);
    const c = jitter(mix3(C.wallStone, C.stoneDark, r * 0.6), () => r2, 0.12);
    out(x, y + h * 0.45, -d, step * 0.66, h * 0.5, 0.32, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind);
    if (h > 0.8 && step < 0.9) { const c2 = mul3(c, 1.15); out(x, y + h * 0.9, -d, step * 0.6, h * 0.14, 0.3, c2[0], c2[1], c2[2], 1, q[0], q[1], q[2], q[3], kind); }
    if (out.due()) yield;
  }
}

// A mani wall: a long low wall of stones, its top heaped with pale carved and painted mani stones.
function* maniWall(ctx, out, W, m) {
  const ax = m.wx - m.len / 2, bx = m.wx + m.len / 2;
  const mh = m.h || 1.3;
  yield* stoneWall(ctx, out, W, ax, m.d, bx, m.d, mh, m.seed & 0xffff);
  const step = Math.max(0.3, detail(out, m.d, 1.1));
  for (let x = ax + step / 2; x < bx; x += step) {
    const lx = x - ctx.x0;
    if (lx < -1 || lx > ctx.length + 1) continue;
    const r = hh(Math.round(x * 10), m.seed & 0xffff, 5);
    const c = r < 0.6 ? [0.66, 0.64, 0.6] : r < 0.75 ? [0.62, 0.26, 0.18] : r < 0.88 ? [0.28, 0.38, 0.55] : [0.7, 0.6, 0.3];
    out(lx, W.H(x, m.d) + mh + 0.08, -m.d, step * 0.6, 0.12 * mh / 1.3, 0.45, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
    if (out.due()) yield;
  }
}

// A bare poplar (narrow, upward-sweeping twigs) or a pollarded willow, as in the village lanes.
function* bareTree(ctx, out, W, t, kind = KIND.TREE) {
  if (valleyAt(W.ws, t.wx).lu > 0.14) { yield* leafTree(ctx, out, W, t, kind); return; }
  const x = t.wx - ctx.x0, d = t.d, y = W.H(t.wx, d) - 0.2;
  const r = makeRng(t.seed);
  if (d > 300) {
    // far off a bare poplar is a narrow grey-brown column of twigs
    const H = t.h, cw = t.willow ? H * 0.3 : H * 0.12;
    out(x, y + H * 0.55, -d, cw, H * 0.4, cw, 0.46, 0.41, 0.34, 0.8, 0, 0, 0, 1, kind);
    return;
  }
  const H = t.h, trunkH = t.willow ? H * 0.42 : H * 0.3;
  const tr = Math.max(0.16, 0.0007 * d);
  strut(out, x, y, -d, x, y + trunkH, -d, tr, C.bark, 3, 1, kind);
  const nb = t.willow ? 14 : 18;
  const br = Math.max(0.05, 0.00055 * d);
  for (let k = 0; k < nb; k++) {
    const a = r() * Math.PI * 2;
    const spread = t.willow ? 0.45 + 0.35 * r() : 0.12 + 0.12 * r();
    const len = (H - trunkH) * (0.6 + 0.4 * r());
    const by = y + trunkH * (0.7 + 0.3 * r());
    const tx = x + Math.cos(a) * spread * len, tz = -(d + Math.sin(a) * spread * len * 0.7), ty = by + len * Math.sqrt(1 - spread * spread * 0.5);
    strut(out, x, by, -d, tx, ty, tz, br, mul3(C.bark, 0.9 + 0.25 * r()), 2, 1, kind);
  }
  // the fine twigs: a faint haze in the crown so it has mass
  const cw = t.willow ? (H - trunkH) * 0.5 : (H - trunkH) * 0.22;
  for (let k = 0; k < 10; k++) {
    const f = r();
    const c = mul3([0.48, 0.43, 0.36], 0.9 + 0.2 * r());
    out(x + (r() - 0.5) * cw * 1.4, y + trunkH + (H - trunkH) * (0.2 + 0.7 * f), -(d + (r() - 0.5) * cw), cw * (0.5 + 0.3 * r()), (H - trunkH) * 0.18, cw * 0.5, c[0], c[1], c[2], 0.28, 0, 0, 0, 1, kind);
  }
  if (out.due()) yield;
}

// A cairn: stones heaped smaller toward the top, sometimes with a flag stick.
function* cairn(ctx, out, W, c, kind = KIND.OTHER) {
  const x = c.wx - ctx.x0, y = W.H(c.wx, c.d);
  const n = c.small ? 2 : 4;
  let yy = y;
  for (let k = 0; k < n; k++) {
    const r = (c.small ? 0.42 : 0.55) * (1 - k * 0.18);
    const col = jitter(mix3(C.stone, C.stoneDark, hh(k, c.seed | 0, 9) * 0.6), () => hh(k, c.seed | 0, 10), 0.1);
    // each stone a small kit facetRock() (they were single soft splats reaching twice their size)
    facetRock(out, x, yy, c.d, r * 1.1, r * 1.15, r * 0.9, { color: col, rng: makeRng(hashInts(c.seed | 0, 77, k)), kind, n: 50, sink: r * 0.1, cracks: 0, seat: k === 0 });
    yy += r * 1.05;
  }
  if (!c.small) {
    out(x, yy + 0.02, -c.d, 0.12, 0.12, 0.12, 0.76, 0.76, 0.74, 1, 0, 0, 0, 1, kind);   // (down on the top stone, which is now no taller than it looks)
  }
}

function sizeS(out, d, k = 1) { return detail(out, d, k); }

// ---------------------------------------------------------------------------------------------
// Placed things, drawn by every band they fall in
// ---------------------------------------------------------------------------------------------
// A house on a slope stands on a masonry base built out from the hillside: never more than a third
// of it is sunk into the ground behind, and the base shows below its front as a stone wall.
function* houseOf(ctx, out, W, hz, opts = {}) {
  const rng = makeRng(hz.seed);
  const lift = opts.lift || 0;
  const lo = opts.y != null ? opts.y : minGround(W, hz);
  const hi = opts.y != null ? lo : GR.max;
  const y = Math.max(lo, hi - 0.33 * hz.h) - 0.4 + lift;
  const s = sizeS(out, hz.d, opts.k || 1);
  if (y - lift > lo + 0.8) yield* plinth(out, hz.wx - ctx.x0, hz.d, hz.w, hz.dep, hz.yaw || 0, lo - 0.6 + lift, y + 0.2, s, opts.kind, rng);
  yield* flatHouse(ctx, out, hz.wx - ctx.x0, hz.d, {
    w: hz.w, dep: hz.dep, h: hz.h + 0.4, yaw: hz.yaw, wall: hz.wall, y, s, rng, band: hz.band,
    lit: opts.lit, flag: hz.roofFlag && hz.d < 260, kind: opts.kind, salt: hz.seed & 0xffff,
  });
}
// The lowest ground under a footprint (GR.max holds the highest, from the same call).
const GR = { max: 0 };
function minGround(W, hz) {
  let m = Infinity, M = -Infinity;
  const [ex, ez] = rotY(1, 0, hz.yaw || 0), [fx, fz] = rotY(0, 1, hz.yaw || 0);
  for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
    const lx = a * hz.w, lz = b * hz.dep;
    const y = W.H(hz.wx + ex * lx + fx * lz, hz.d - (ez * lx + fz * lz));
    if (y < m) m = y;
    if (y > M) M = y;
  }
  GR.max = M;
  return m;
}
// The dry-stone base of a building on a slope: a box of rough stone from y0 up to y1.
function* plinth(out, x, d, w, dep, yaw, y0, y1, s, kind, rng) {
  const tone = mix3(C.wallStone, C.stoneDark, 0.25);
  yield* box(out, x, y0, d, w + 0.6, dep + 0.6, y1 - y0, yaw, Math.max(s, 0.25), (f, a, b, nx, nz) => (f === 4 ? C.roof : jitter(faceTone(tone, nx, nz), rng, 0.08)), kind != null ? kind : KIND.BUILDING, rng);
}
const inX = (ctx, wx, m) => wx > ctx.x0 - m && wx < ctx.x0 + ctx.length + m;
const inD = (d, dLo, dHi) => d >= dLo && d < dHi;

function* drawChorten(ctx, out, W, c, opts = {}) {
  const rng = makeRng(c.seed);
  yield* chorten(ctx, out, c.wx - ctx.x0, c.d, c.H, { y: W.H(c.wx, c.d) + (opts.lift || 0), s: sizeS(out, c.d, 0.8), rng, kind: opts.kind, lean: opts.lean, spire: opts.spire, gold: opts.gold, white: opts.white });
}

function* villages(ctx, out, W, dLo, dHi, opts = {}) {
  const lit = litShare(ctx);
  const topo = opts.topo || 0;
  const i0 = Math.floor((ctx.x0 - 400) / VCELL), i1 = Math.floor((ctx.x0 + ctx.length + 400) / VCELL);
  for (let i = i0; i <= i1; i++) {
    const v = village(W, i);
    if (!v || !inX(ctx, v.cx, v.R + 300)) continue;
    // level 1: the top tier lifted clear of the slope
    const floating = topo > 0 && v.floatR < 0.75 * topo;
    const lift = floating ? 45 + 70 * v.floatR / Math.max(0.01, topo) : 0;
    // on the steep wall a tier lifted straight up would only lie against the slope above it: it
    // drifts out over the valley as well, so the sky or the wall shows under it
    const fwd = floating ? Math.min(150, lift * 1.2) : 0;
    for (const hz of v.houses) {
      const fl = floating && hz.tier === v.floatTier;
      if (!inD(hz.d - (fl ? fwd : 0), dLo, dHi) || !inX(ctx, hz.wx, 20)) continue;
      if (fl) yield* houseOf(ctx, beatOut(out), W, { ...hz, d: hz.d - fwd }, { lit, y: minGround(W, hz), lift, kind: KIND.SURREAL });
      else yield* houseOf(ctx, out, W, hz, { lit, kind: KIND.BUILDING, k: out.density > 1.2 ? 0.7 : 1 });
    }
    yield* terraceLines(ctx, out, W, v, dLo, dHi);
    if (floating) yield* floatingRoot(ctx, out, W, v, lift, dLo, dHi, fwd);
    for (const t of v.trees) if (inD(t.d, dLo, dHi) && inX(ctx, t.wx, 10)) yield* bareTree(ctx, out, W, t);
    for (const c of v.chortens) if (inD(c.d, dLo, dHi) && inX(ctx, c.wx, 10)) yield* drawChorten(ctx, out, W, c);
    for (const p of v.poles) if (inD(p.d, dLo, dHi) && inX(ctx, p.wx, 5)) yield* flagPole(ctx, out, W, { ...p, banner: true });
    for (const s of v.strings) yield* flagString(ctx, out, s, dLo, dHi);
  }
}
// The terrace risers of a village bench, traced along the contours as fine dark lines over the
// ground fill (which at this range is too coarse to keep a 4.5 m step crisp). Each riser is followed
// across the bench from one end to the other: at each step along x, a couple of Newton steps in
// distance find where the bench reaches the riser's height (starting from the last point).
function* terraceLines(ctx, out, W, v, dLo, dHi) {
  const site = villageSite(W.ws, v.i);
  const x0 = v.cx - site.R * 1.5, x1 = v.cx + site.R * 1.5;
  if (x1 < ctx.x0 - 5 || x0 > ctx.x0 + ctx.length + 5) return;
  const foot = (wx) => headLine(W.ws, wx, valleyAt(W.ws, wx)) - site.foot;
  const sLo = site.sLo - 75, sHi = site.sHi + 25;
  const dm = foot(v.cx) + (sLo + sHi) / 2;
  if (!inD(dm, dLo, dHi)) return;
  W.H(v.cx, foot(v.cx) + sLo); const bLo = WL.base;
  W.H(v.cx, foot(v.cx) + sHi); const bHi = WL.base;
  const r = Math.max(0.35, detail(out, dm, 0.45));
  const step = r * 2.2;
  const xa = Math.max(x0, ctx.x0 - 2), xb = Math.min(x1, ctx.x0 + ctx.length + 2);
  for (let k = Math.ceil(bLo / 4.5); k * 4.5 < bHi; k++) {
    const target = (k - 0.12) * 4.5;     // the middle of the riser below tread k
    let d = foot(xa) + sLo + (sHi - sLo) * (target - bLo) / Math.max(1, bHi - bLo);
    for (let wx = xa; wx < xb; wx += step) {
      let y = 0, ok = true;
      for (let it = 0; it < 3; it++) {
        y = W.H(wx, d);
        const b0 = WL.base;
        W.H(wx, d + 2);
        const g = (WL.base - b0) / 2;
        if (!(g > 0.02)) { ok = false; break; }
        d += clamp((target - b0) / g, -25, 25);
      }
      if (!ok) { d = foot(wx) + sLo + (sHi - sLo) * (target - bLo) / Math.max(1, bHi - bLo); continue; }
      y = W.H(wx, d);
      if (WL.terr < 0.4 || Math.abs(WL.base - target) > 1.2) continue;
      const e = 1.5, nn = norm3(-(W.H(wx + e, d) - y) / e, 1, (W.H(wx, d + e) - y) / e);
      const u = hh(Math.round(wx), k, 977);
      const c = mul3(shade(mix3(C.riser, C.stoneDark, 0.35 * u), nn[0], nn[1], nn[2], 0.45, 0.6), 0.75);
      yield* emitGround(ctx, out, TQ, wx - ctx.x0, y + 0.15, d, r, c, nn, HALF, 0);
    }
  }
}
const TQ = { t: T.FACE, terr: 1 }, HALF = () => 0.5;

// The rock torn out under a floating tier: an inverted cone of rock and earth below the houses.
function* floatingRoot(ctx, out, W, v, lift, dLo, dHi, fwd = 0) {
  const tierH = v.houses.filter((h) => h.tier === v.floatTier);
  if (!tierH.length) return;
  let xa = Infinity, xb = -Infinity, dm = 0;
  for (const h of tierH) { xa = Math.min(xa, h.wx - h.w / 2); xb = Math.max(xb, h.wx + h.w / 2); dm += h.d; }
  dm /= tierH.length;
  const dg = dm;          // where the tier was torn from (its height comes from there)
  dm -= fwd;
  if (!inD(dm, dLo, dHi)) return;
  const cx = (xa + xb) / 2, R = (xb - xa) / 2 + 6;
  if (!inX(ctx, cx, R + 10)) return;
  const r = makeRng(v.seed ^ 0x77);
  // a shallow wedge of the field with earth and rock beneath it, never a bulk big enough to
  // outweigh the houses it carries
  const top = W.H(cx, dg) + lift - 0.5, depth = R * 0.4 + lift * 0.08;
  const n = Math.round(clamp(60000 * out.density * R * depth / (dm * dm), 40, 2500));
  const s = Math.sqrt(2.4 * R * depth / n);
  for (let k = 0; k < n; k++) {
    const f = Math.pow(r(), 0.8), a = (r() - 0.5) * Math.PI * 1.3;
    const rr = R * Math.pow(1 - f, 1.1) * (0.85 + 0.25 * r());
    const nx = Math.sin(a), nz = Math.cos(a);
    let c = f < 0.22 ? mix3(C.yard, C.grassDry, r()) : mix3(mix3(C.rock, C.grassDry, 0.35), [0.5, 0.42, 0.33], 0.6 * r());
    if (f > 0.22 && noise2(a * 3, f * 9, v.seed & 0xffff) > 0.62) c = mix3(c, C.stone, 0.6);
    c = jitter(mul3(shade(c, nx * 0.7, 0.1, nz, 0.7, 0.4), 1 - 0.12 * f), r, 0.1);
    out(cx + nx * rr - ctx.x0, top - f * depth, -(dm - nz * rr * 0.4), s, s * 0.8, s * 0.6, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.SURREAL);
    if (out.due()) yield;
  }
}

function* gompas(ctx, out, W, dLo, dHi, opts = {}) {
  const lit = litShare(ctx);
  const topo = opts.topo || 0;
  const i0 = Math.floor((ctx.x0 - 500) / MCELL), i1 = Math.floor((ctx.x0 + ctx.length + 500) / MCELL);
  for (let i = i0; i <= i1; i++) {
    const g = gompa(W, i);
    if (!g || !inX(ctx, g.wx, 400)) continue;
    const floatG = topo > 0 && hh(g.i, 1, W.ws + 5) < 0.7 * topo;
    const lift = floatG ? 70 + 60 * topo : 0;
    const kind = floatG ? KIND.SURREAL : KIND.BUILDING;
    const fwd = floatG ? Math.min(150, lift * 1.1) : 0;     // out over the valley, clear of the wall
    const m0 = g.main, m = floatG ? { ...m0, d: m0.d - fwd } : m0;
    if (inD(m.d, dLo, dHi) && inX(ctx, m.wx, m.w)) {
      const rng = makeRng(m.seed);
      const g0 = minGround(W, m0), y = Math.max(g0, GR.max - 0.3 * m.h) - 0.5 + lift;
      const s = sizeS(out, m.d, 0.8);
      if (y - lift > g0 + 0.8) yield* plinth(floatG ? beatOut(out) : out, m.wx - ctx.x0, m.d, m.w, m.dep, m.yaw, g0 - 0.6 + lift, y + 0.2, s, kind, rng);
      yield* flatHouse(ctx, floatG ? beatOut(out) : out, m.wx - ctx.x0, m.d, { w: m.w, dep: m.dep, h: m.h, yaw: m.yaw, wall: m.wall, y, s, rng, band: true, lit, kind, salt: m.seed & 0xffff });
      // the gilded roof pavilion and the gold victory banners on the roof corners
      yield* house(ctx, out, m.wx - ctx.x0, m.d + 1, { w: Math.min(13.5, m.w * 0.3), depth: 9, h: 4.2, roofH: 3.3, wall: C.maroon, roof: C.gold, windows: false, chimney: false, rng, y: y + m.h, yaw: m.yaw, s, kind });
      const gr = Math.max(0.35, 0.0011 * m.d);
      const [ex, ez] = rotY(1, 0, m.yaw), [fx, fz] = rotY(0, 1, m.yaw);
      for (const a of [-0.46, 0.46]) {
        for (const b of [0.42]) {
          const px = m.wx - ctx.x0 + ex * a * m.w + fx * b * m.dep, pz = -m.d + ez * a * m.w + fz * b * m.dep;
          strut(out, px, y + m.h, pz, px, y + m.h + 2.4, pz, gr, C.gold, 2, 1, kind);
        }
      }
      if (floatG) yield* floatingRoot(ctx, out, W, { houses: [{ ...m0, tier: 0 }], floatTier: 0, seed: m.seed }, lift, dLo, dHi, fwd);
    }
    for (const h of g.halls) {
      if (!inD(h.d - fwd, dLo, dHi) || !inX(ctx, h.wx, h.w)) continue;
      if (floatG) yield* houseOf(ctx, beatOut(out), W, { ...h, d: h.d - fwd }, { lit, k: 0.9, y: minGround(W, h), lift, kind });
      else yield* houseOf(ctx, out, W, h, { lit, k: 0.9, kind });
    }
    for (const h of g.houses) if (inD(h.d, dLo, dHi) && inX(ctx, h.wx, 15)) yield* houseOf(ctx, out, W, h, { lit });
    for (const c of g.chortens) if (inD(c.d, dLo, dHi) && inX(ctx, c.wx, 10)) yield* drawChorten(ctx, out, W, c);
    for (const p of g.poles) if (inD(p.d, dLo, dHi) && inX(ctx, p.wx, 5)) yield* flagPole(ctx, out, W, p);
    for (const s of g.strings) {
      if (!floatG) { yield* flagString(ctx, out, s, dLo, dHi); continue; }
      yield* flagString(ctx, out, { ...s, a: [s.a[0], s.a[1] + lift, s.a[2] - fwd] }, dLo, dHi, KIND.SURREAL);
    }
  }
}

function* hamlets(ctx, out, W, dLo, dHi) {
  const lit = litShare(ctx);
  const i0 = Math.floor((ctx.x0 - 150) / HCELL), i1 = Math.floor((ctx.x0 + ctx.length + 150) / HCELL);
  for (let i = i0; i <= i1; i++) {
    const h = hamlet(W, i);
    if (!h || !inX(ctx, h.wx, 140)) continue;
    for (const w of h.walls) if (inD((w[1] + w[3]) / 2, dLo, dHi)) yield* stoneWall(ctx, out, W, w[0], w[1], w[2], w[3], 1.1, Math.round(w[0] * 7) & 0xffff);
    // (k: at the default budget and above the larger houses are drawn a little coarser, so a
    // hamlet costs what it did and leaves the chunk's count for what grows round it; below that
    // they are coarse already, and any coarser would lose their windows)
    for (const hz of h.houses) if (inD(hz.d, dLo, dHi) && inX(ctx, hz.wx, 15)) yield* houseOf(ctx, out, W, hz, { lit, k: out.density > 0.6 ? 1.25 : 1 });
    for (const t of h.trees) if (inD(t.d, dLo, dHi) && inX(ctx, t.wx, 10)) yield* bareTree(ctx, out, W, t);
    for (const c of h.chortens) if (inD(c.d, dLo, dHi) && inX(ctx, c.wx, 8)) yield* drawChorten(ctx, out, W, c);
    for (const p of h.poles) if (inD(p.d, dLo, dHi) && inX(ctx, p.wx, 5)) yield* flagPole(ctx, out, W, p);
    for (const s of h.strings) yield* flagString(ctx, out, s, dLo, dHi);
    if (h.mani && inD(h.mani.d, dLo, dHi) && inX(ctx, h.mani.wx, h.mani.len)) yield* maniWall(ctx, out, W, h.mani);
  }
}

function* flagSites(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 80) / FCELL), i1 = Math.floor((ctx.x0 + ctx.length + 80) / FCELL);
  for (let i = i0; i <= i1; i++) {
    const f = flagSite(W, i);
    if (!f || !inX(ctx, f.wx, 80)) continue;
    for (const c of f.chortens) if (inD(c.d, dLo, dHi) && inX(ctx, c.wx, 8)) yield* drawChorten(ctx, out, W, c);
    for (const p of f.poles) if (inD(p.d, dLo, dHi) && inX(ctx, p.wx, 5)) yield* flagPole(ctx, out, W, p);
    for (const c of f.cairns) if (inD(c.d, dLo, dHi) && inX(ctx, c.wx, 2)) yield* cairn(ctx, out, W, c);
    for (const s of f.strings) yield* flagString(ctx, out, s, dLo, dHi);
    if (f.mani && inD(f.mani.d, dLo, dHi) && inX(ctx, f.mani.wx, f.mani.len)) yield* maniWall(ctx, out, W, f.mani);
  }
}

function* herds(ctx, out, W, dLo, dHi, lod = 0) {
  const i0 = Math.floor((ctx.x0 - 80) / YCELL), i1 = Math.floor((ctx.x0 + ctx.length + 80) / YCELL);
  for (let i = i0; i <= i1; i++) {
    const h = herd(W, i);
    if (!h || !inX(ctx, h.wx, 70)) continue;
    for (const y of h.yaks) {
      if (!inD(y.d, dLo, dHi) || !inX(ctx, y.wx, 4)) continue;
      yield* yak(ctx, out, y.wx, W.H(y.wx, y.d) - 0.05, y.d, { ...y, lod });
    }
  }
}

function* sheepGroups(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 60) / SCELL), i1 = Math.floor((ctx.x0 + ctx.length + 60) / SCELL);
  for (let i = i0; i <= i1; i++) {
    const g = sheepGroup(W, i);
    if (!g || !inX(ctx, g.wx, 40) || !inD(g.d, dLo, dHi)) continue;
    for (const b of g.blocks) {
      const rng = makeRng(b.seed);
      // a block of rock, kit facetRock(): hard facets (it was a blob(), soft and woolly as the sheep on
      // it); its top where the blob's was, so the sheep still stand on it
      facetRock(out, b.wx - ctx.x0, b.y - b.ry * 0.45, b.d, b.rx, b.ry * 1.5, b.rz, { color: mix3(C.rock, C.stone, 0.4 * rng()), rng, sink: b.ry * 0.3, lichen: 0.3, slab: 0.6, n: 120 });
      if (out.due()) yield;
    }
    for (const s of g.sheep) yield* bharal(ctx, out, s.wx, s.y, s.d, s);
  }
}
function treeSplats2(out, d, w) { const r = detail(out, d, 1.4); return (w * w * 1.6) / (r * r * 2.2); }

// The footbridge: stone towers at each end, a sagging plank deck on its cables, two hand cables
// hung thick with prayer flags, and anchor strings from the tower tops. Drawn piecewise by band.
function* bridges(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 200) / BCELL), i1 = Math.floor((ctx.x0 + ctx.length + 200) / BCELL);
  for (let i = i0; i <= i1; i++) {
    const b = bridge(W, i);
    if (!b || !inX(ctx, b.wx, 120)) continue;
    const { a, ux, ud } = b;
    const bb = b.b;
    const deck = b.deckY;
    // towers: two stone pillars at each end, either side of the deck
    for (const p of [a, bb]) {
      for (const side of [-1, 1]) {
        const tx = p[0] + side * ud * 1.1, td = p[2] - side * ux * 1.1;
        if (!inD(td, dLo, dHi) || !inX(ctx, tx, 3)) continue;
        const g = W.H(tx, td) - 0.3;
        const r = Math.max(0.35, 0.0012 * td);
        strut(out, tx - ctx.x0, g, -td, tx - ctx.x0, deck + b.tower, -td, r, C.wallStone, 4, 1, KIND.BUILDING);
        out(tx - ctx.x0, deck + b.tower + 0.2, -td, r * 1.3, 0.25, r * 1.3, C.white[0], C.white[1], C.white[2], 1, 0, 0, 0, 1, KIND.BUILDING);
      }
      // a ramp of stones up to the deck
      for (let k = 0; k < 4; k++) {
        const t = k / 4, px = p[0] - (p === a ? -1 : 1) * ux * 3 * (1 - t), pd = p[2] - (p === a ? -1 : 1) * ud * 3 * (1 - t);
        if (!inD(pd, dLo, dHi) || !inX(ctx, px, 2)) continue;
        out(px - ctx.x0, lerp(W.H(px, pd), deck, t) - 0.3, -pd, 1.0, 0.45, 1.0, C.wallStone[0], C.wallStone[1], C.wallStone[2], 1, 0, 0, 0, 1, KIND.BUILDING);
      }
    }
    // the deck: a sagging plank walk, and the two hand cables with flags along them
    const span = Math.hypot(bb[0] - a[0], bb[2] - a[2]);
    // (it was a single cord, which from the window read as one more cable: now a plank walk 1.4 m
    // wide, laid as overlapping boards along the sag, with a dark edge each side)
    yield* bridgeDeck(ctx, out, a, bb, deck, 1.2, b.seed, dLo, dHi);
    for (const side of [-1, 1]) {
      const sa = [a[0] + side * ud * 1.1, deck + b.tower, a[2] - side * ux * 1.1], sb = [bb[0] + side * ud * 1.1, deck + b.tower, bb[2] - side * ux * 1.1];
      yield* flagString(ctx, out, { a: sa, b: sb, sag: (b.tower - 0.8) / span, seed: b.seed ^ (side + 9), fw: 0.4, fade: 0.1 }, dLo, dHi);
      // a second, older string a little lower
      yield* flagString(ctx, out, { a: [sa[0], sa[1] - 0.6, sa[2]], b: [sb[0], sb[1] - 0.6, sb[2]], sag: (b.tower - 1.2) / span, seed: b.seed ^ (side + 19), fw: 0.36, fade: 0.5 }, dLo, dHi);
      // hangers from the hand cable down to the deck
      const nh = Math.max(3, Math.round(span / 5));
      for (let k = 1; k < nh; k++) {
        const t = k / nh;
        const hx = lerp(sa[0], sb[0], t), hd = lerp(sa[2], sb[2], t);
        if (!inD(hd, dLo, dHi) || !inX(ctx, hx, 1)) continue;
        const top = lerp(sa[1], sb[1], t) - 4 * (b.tower - 0.8) * t * (1 - t);
        const bot = deck - 4 * 1.2 * t * (1 - t);
        strut(out, hx - ctx.x0, top, -hd, hx - ctx.x0, bot, -hd, Math.max(0.035, 0.0005 * hd), C.cord, 2, 1, KIND.WIRE);
      }
    }
    for (const s of b.strings) yield* flagString(ctx, out, s, dLo, dHi);
    if (out.due()) yield;
  }
}

function* bridgeDeck(ctx, out, a, b, y0, sagH, seed, dLo, dHi) {
  const dx = b[0] - a[0], dd = b[2] - a[2], span = Math.hypot(dx, dd);
  const ux = dx / span, ud = dd / span;
  const step = Math.max(0.6, 0.0035 * Math.min(a[2], b[2]));
  const n = Math.ceil(span / step);
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n, wx = a[0] + dx * t, d = a[2] + dd * t;
    if (!inD(d, dLo, dHi) || !inX(ctx, wx, 2)) continue;
    const y = y0 - 4 * sagH * t * (1 - t), slope = -4 * sagH * (1 - 2 * t) / span;
    const ql = Math.hypot(1, slope), q = quatXTo(ux / ql, slope / ql, -ud / ql);
    const u = hh(k, seed & 0xffff, 31), c = mix3([0.5, 0.4, 0.29], [0.38, 0.3, 0.22], u);
    out(wx - ctx.x0, y, -d, step * 0.75, 0.09, 0.62, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.BUILDING);
    // the edge boards / mesh, a little darker, so the deck has sides when seen from below
    for (const sg of [1, -1]) out(wx - ctx.x0 - sg * ud * 0.66, y + 0.18, -(d + sg * ux * 0.66), step * 0.75, 0.2, 0.05, c[0] * 0.6, c[1] * 0.6, c[2] * 0.6, 1, q[0], q[1], q[2], q[3], KIND.BUILDING);
    if (out.due()) yield;
  }
}

// Boulders, junipers, cairns and old snow scattered over the near slope.
function* scatter(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, 36, 3)) {
    for (let k = 0; k < 3; k++) {
      const r = worldRng(ctx, 961, i, k);
      const wx = wx0 + r() * 36, d = dLo + Math.pow(r(), 1.3) * (dHi - dLo), u = r(), sz = r();
      if (!inX(ctx, wx, 3)) continue;
      const S = surface(W, wx, d);
      if (S.t === T.CHANNEL) continue;
      const y = S.y;
      if (u < 0.35) {
        const rad = 0.5 + 1.8 * sz * sz;
        facetRock(out, wx - ctx.x0, y, d, rad, rad * 0.85, rad * 0.85, { color: mix3(C.rock, C.stone, sz), rng: r, lichen: 0.3, n: 80 });   // (was a soft blob())
        if (out.due()) yield;
      } else if (u < 0.7 && S.t === T.NEAR) {
        const w = 1 + 1.6 * sz;
        yield* blob(ctx, out, wx - ctx.x0, y + 0.25, d, w * 0.5, 0.4 + 0.2 * sz, w * 0.4, { n: Math.round(clamp(treeSplats2(out, d, w) * 0.8, 4, 80)), color: C.juniper, rng: r, kind: KIND.HEDGE, inner: 0.4, amb: 0.55 });
      } else if (u < 0.74 && S.t === T.NEAR) {
        yield* cairn(ctx, out, W, { wx, d, seed: i * 3 + k });
      }
    }
    if (out.due()) yield;
  }
}

// Streams down the gullies (frozen or running) and the torrents of the side valleys.
function* streams(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 500) / WALL.L1) - 1, i1 = Math.floor((ctx.x0 + ctx.length + 500) / WALL.L1);
  for (let i = i0; i <= i1; i++) { const st = stream(W, i); if (st) yield* drawStream(ctx, out, st, dLo, dHi); }
  const j0 = Math.floor((ctx.x0 - 900) / SVC), j1 = Math.floor((ctx.x0 + ctx.length + 900) / SVC);
  for (let j = j0; j <= j1; j++) { const st = torrent(W, j); if (st) yield* drawStream(ctx, out, st, dLo, dHi); }
}

// Mist lying in the valley: big faint pale splats over the bed and the foot of the slope, and a
// bank of cloud part way up the facing slope, in stretches. Never a uniform veil.
function* mist(ctx, out, W, dLo, dHi, cell, size, op) {
  const g0 = Math.floor((ctx.x0 - size * 2) / cell), g1 = Math.floor((ctx.x0 + ctx.length + size * 2) / cell);
  for (let gk = Math.floor(dLo / cell); gk * cell < dHi; gk++) {
    for (let gx = g0; gx <= g1; gx++) {
      const r = worldRng(ctx, 971, gx, gk, cell);
      const wx = (gx + r()) * cell, d = (gk + r()) * cell;
      if (!inD(d, dLo, dHi)) continue;
      const a = mistAmt(W, wx);
      if (a <= 0.05 || r() > a) continue;
      const v = valleyAt(W.ws, wx), bn = v.bn, bf = v.bf, fy = v.fy;
      const g = W.H(wx, d);
      let y;
      // low over the floor and in the bays between the spurs, or a bank part way up the wall
      if (d > bn - 60 && d < bf + 330 && g < fy + 14) y = Math.max(fy, g) + 4 + 22 * r();
      else if (d > bf + 600 && r() < 0.35) y = g + 10 + 30 * r();
      else continue;
      const high = y > fy + 40;
      const sx = size * (0.7 + 0.9 * r()) * (high ? 0.6 : 1), sy = size * (0.08 + 0.07 * r()) * (high ? 0.6 : 1);
      const c = jitter(C.mist, r, 0.02);
      out(wx - ctx.x0, y, -d, sx, sy, sx * 0.45, c[0], c[1], c[2], op * (0.5 + 0.5 * r()) * a * (high ? 0.6 : 1), 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
      if (out.due()) yield;
    }
  }
}

// Cloud banners: streamers of cloud blown off the summits of the giant peaks.
function giantSummit(W, g) {
  if (g.summit) return g.summit;
  let best = [g.wx, -1e9, g.d];
  for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) {
    const wx = g.wx + a * 220, d = g.d + b * 260, y = W.H(wx, d);
    if (y > best[1]) best = [wx, y, d];
  }
  g.summit = best;
  return best;
}
function* banners(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 8000) / GCELLX), i1 = Math.floor((ctx.x0 + ctx.length + 8000) / GCELLX);
  for (let i = i0; i <= i1; i++) {
    const g = giant(W.ws, i);
    if (!g || !g.banner) continue;
    const [sx, sy, sd] = giantSummit(W, g);
    if (!inD(sd, dLo, dHi)) continue;
    const r = makeRng(g.seed);
    const n = 14 + Math.floor(r() * 10), len = 700 + 1300 * r();
    for (let k = 0; k < n; k++) {
      const t = Math.pow((k + r()) / n, 0.9);
      const x = sx + 150 + t * len - ctx.x0;
      if (x < -900 || x > ctx.length + 900) continue;
      const w = 60 + 260 * t * (0.6 + 0.6 * r());
      const c = jitter(C.snow, r, 0.02);
      out(x - 100, sy - 30 - t * 160 * (0.5 + r()) + (r() - 0.5) * 60, -(sd + (r() - 0.5) * 200), w, 25 + 50 * t * r(), w * 0.5, c[0], c[1], c[2], (0.55 - 0.4 * t) * (0.6 + 0.4 * r()), 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
    }
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Life in the valley: travellers, camps, lodges, orchards, shrines, birds, ice, lakes, ruins, snow
// ---------------------------------------------------------------------------------------------
// Each kind has its own world cell size, and a slow regional mood decides which kinds a stretch
// favours: herding country (caravans, nomad camps, lodges on the trail), farming country (orchards,
// fields, prayer-wheel walls, monks, a school) and wild country (birds, icefalls, glacial lakes,
// snowfall). So one stretch has a caravan passing a lodge, the next black tents and horses, the
// next an orchard in blossom by a hamlet, and the next vultures circling under an icefall.
function mood(W, wx) {
  const a = noise1(wx / 4700, W.ws + 1701), b = noise1(wx / 3300, W.ws + 1702), c = noise1(wx / 5900, W.ws + 1703);
  const s = a + b + c + 1e-6;
  return { herd: 0.25 + 1.5 * a / s, farm: 0.25 + 1.5 * b / s, wild: 0.25 + 1.5 * c / s };
}
// Somewhere a new thing on the near slope may stand: on the slope (not the river bed) and clear of
// the hamlets and flag sites already there.
function nearFree(W, wx, d, rad) {
  if (d > bnAt(W, wx) - 18 || d < 42) return false;
  const h = hamlet(W, Math.floor(wx / HCELL));
  if (h && Math.abs(h.wx - wx) < 100 + rad && Math.abs(h.d - d) < 46 + rad * 0.5) return false;
  for (let i = Math.floor(wx / FCELL) - 1; i <= Math.floor(wx / FCELL) + 1; i++) {
    const f = flagSite(W, i);
    if (f && Math.abs(f.wx - wx) < 35 + rad && Math.abs(f.d - d) < 30 + rad * 0.5) return false;
  }
  return true;
}
// The new kinds keep out of each other's way by a fixed order of precedence (lodge, camp, school,
// prayer-wheel wall, monks' path, caravan path): each asks only about the kinds before it, so the
// answer never depends on which chunk asked first.
const RANKED = [
  (W, i) => { const o = lodge(W, i); return o && { wx: o.wx, d: o.d, r: 28 }; },
  (W, i) => { const o = camp(W, i); return o && { wx: o.wx, d: o.d, r: 48 }; },
  (W, i) => { const o = school(W, i); return o && { wx: o.wx, d: o.d, r: 28 }; },
  (W, i) => { const o = wheelWall(W, i); return o && { wx: o.wx, d: o.d, r: o.len / 2 + 10 }; },
];
const RCELLS = [1700, 2100, 3100, 1400];
function* claimsBefore(W, rank, x0, x1) {
  for (let k = 0; k < Math.min(rank, RANKED.length); k++) {
    for (let i = Math.floor((x0 - 60) / RCELLS[k]); i <= Math.floor((x1 + 60) / RCELLS[k]); i++) { const c = RANKED[k](W, i); if (c) yield c; }
  }
}
function taken(W, rank, wx, d, rad) {
  for (const c of claimsBefore(W, rank, wx - rad, wx + rad)) if (Math.abs(c.wx - wx) < c.r + rad && Math.abs(c.d - d) < (c.r + rad) * 0.7) return true;
  return false;
}
function pathTaken(W, rank, p) {
  for (const c of claimsBefore(W, rank, p.xa, p.xb)) if (c.wx > p.xa - c.r && c.wx < p.xb + c.r && Math.abs(pathD(p, clamp(c.wx, p.xa, p.xb)) - c.d) < c.r * 0.7 + 6) return true;
  if (rank > 4) {
    for (let i = Math.floor((p.xa - 200) / MKCELL); i <= Math.floor((p.xb + 200) / MKCELL); i++) {
      const m = monkLine(W, i);
      if (m && m.path.xb > p.xa && m.path.xa < p.xb && Math.abs(m.d - p.d0) < 30) return true;
    }
  }
  return false;
}

// Rotation whose local x, y, z axes are u, v and u x v (u, v unit and at right angles).
function quatBasis(ux, uy, uz, vx, vy, vz) {
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const m00 = ux, m01 = vx, m02 = nx, m10 = uy, m11 = vy, m12 = ny, m20 = uz, m21 = vz, m22 = nz;
  const t = m00 + m11 + m22;
  if (t > 0) { const s = Math.sqrt(t + 1) * 2; return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]; }
  if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2; return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}
// A flat panel from corner o along u (lu metres) and toward p (the far end of the second edge).
function* panel(out, o, u, p, lu, s, colorAt, kind, rng) {
  const vx = p[0] - o[0], vy = p[1] - o[1], vz = p[2] - o[2], lv = Math.hypot(vx, vy, vz) || 1e-6;
  const v = [vx / lv, vy / lv, vz / lv];
  yield* quad(out, o, u, v, lu, lv, s, colorAt, quatBasis(u[0], u[1], u[2], v[0], v[1], v[2]), kind, rng);
}
// Smoke from a chimney, a tent or a fire: a few pale puffs rising and spreading, billowing in the
// shader (MOVE.VAPOUR; drawn through the plain out, never beatOut, which would replace the motion).
function smoke(out, x, y, d, seed, n = 7, rise = 9, k = 1) {
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, s = (0.45 + 2.2 * t) * k;
    const drift = 3.5 * t * t * k + (hh(i, seed, 1) - 0.5) * s * 0.6;
    const g = 0.6 + 0.12 * hh(i, seed, 2);
    out(x + drift, y + rise * t * k, -(d + (hh(i, seed, 3) - 0.5) * s * 0.4), s, s * 0.75, s * 0.7, g, g, g * 1.02, 0.42 * (1 - 0.55 * t), 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
  }
}

// --- people and pack animals -----------------------------------------------------------------
// A person, about 1.3 times life size like the yaks, from a dozen shaped splats: legs and arms as
// struts, a torso, a head with hair or a hat, and what they carry. A still picks out the roles:
//   role 'porter'  bent under a tall wicker doko with a tarpaulin bundle on top
//        'trekker' a bright jacket, a rucksack and two walking poles
//        'monk'    a maroon robe to the ankles, a shawl over one shoulder, a shaven head
//        'herder'  a long dark chuba with a sash; 'child' as herder but small and bright
//   o: { yaw (heading), ph (stride phase 0..1), role, col (jacket), k, hat }
const SKIN = [0.42, 0.28, 0.2], HAIR = [0.06, 0.05, 0.05];
const JACKETS = [[0.72, 0.16, 0.1], [0.12, 0.3, 0.62], [0.78, 0.48, 0.08], [0.1, 0.45, 0.32], [0.55, 0.12, 0.38], [0.2, 0.22, 0.26]];
function* person(ctx, out, wx, y, d, o) {
  out = flashOut(out);
  const role = o.role || 'herder';
  const k = (o.k || 1.6) * (role === 'child' ? 0.66 : 1);
  const ca = Math.cos(o.yaw), sa = Math.sin(o.yaw), x0 = wx - ctx.x0;
  const pt = [0, 0, 0];
  const P = (u, h, v) => { pt[0] = x0 + (u * ca - v * sa) * k; pt[1] = y + h * k; pt[2] = -(d + (u * sa + v * ca) * k); return pt; };
  const q = quatYaw(o.yaw);
  // (no radius under 0.0006 d: smaller splats fall below a pixel and the GPU dims them away)
  const fl = 0.0006 * d;
  const E = (u, h, v, rx, ry, rz, c, qq = q) => { P(u, h, v); out(pt[0], pt[1], pt[2], Math.max(rx * k, fl), Math.max(ry * k, fl), Math.max(rz * k, fl), c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], KIND.OTHER); };
  const S = (a, b, r, c) => { const pa = [...P(a[0], a[1], a[2])], pb = P(b[0], b[1], b[2]); strut(out, pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], r, c, 1, 1, KIND.OTHER); };
  const lr = Math.max(0.065 * k, 0.0008 * d);
  const sw = Math.sin((o.ph || 0) * Math.PI * 2) * 0.24;
  const lean = role === 'porter' ? 0.16 : role === 'trekker' ? 0.05 : 0;
  const robe = role === 'monk';
  const coat = o.col || (robe ? [0.46, 0.08, 0.07] : role === 'herder' ? [0.2, 0.15, 0.12] : role === 'porter' ? [0.3, 0.27, 0.24] : JACKETS[0]);
  const trousers = role === 'trekker' ? [0.16, 0.16, 0.18] : [0.2, 0.17, 0.15];
  // legs (a monk's robe hides them to the ankle)
  if (!robe) {
    for (const s of [1, -1]) S([0, 0.9, 0.09 * s], [s * sw, 0.04, 0.1 * s], lr, trousers);
    for (const s of [1, -1]) E(s * sw + 0.05, 0.04, 0.1 * s, 0.07, 0.035, 0.045, [0.1, 0.08, 0.07]);
  } else {
    // (radii are standard deviations: a splat shows to about twice its radius, so every part is
    // drawn at about half its extent, or the body swallows the head)
    E(0, 0.5, 0, 0.13, 0.3, 0.15, mul3(coat, 0.9));
    E(0, 0.86, 0, 0.12, 0.14, 0.14, mul3(coat, 0.95));
    for (const s of [1, -1]) E(s * sw * 0.5 + 0.05, 0.04, 0.09 * s, 0.07, 0.035, 0.045, [0.12, 0.08, 0.06]);
  }
  // the long coat of a herder hangs below the knee
  if (role === 'herder' || role === 'child') E(0, 0.74, 0, 0.12, 0.2, 0.14, mul3(coat, 0.85));
  // torso, with a sash or the monk's shawl
  E(lean * 0.4, 1.18, 0, 0.1, 0.17, 0.13, coat);
  if (robe) { E(lean * 0.4 + 0.04, 1.24, 0.05, 0.06, 0.08, 0.06, [0.74, 0.56, 0.1]); E(lean * 0.4, 1.24, -0.05, 0.11, 0.15, 0.12, coat); }
  if (role === 'herder') E(0.02, 0.98, 0, 0.11, 0.03, 0.14, [0.7, 0.3, 0.12]);
  // arms
  const sh = 1.43;
  if (role === 'trekker') {
    for (const s of [1, -1]) {
      const hand = [0.24 + s * sw * 0.4, 1.0, 0.27 * s];
      S([lean * 0.5, sh, 0.21 * s], hand, lr * 0.85, coat);
      S(hand, [0.5 + s * sw * 0.6, 0.02, 0.34 * s], Math.max(0.03 * k, 0.0005 * d), [0.62, 0.62, 0.64]);
    }
  } else if (role === 'porter') {
    // hands up at the tumpline on the forehead
    for (const s of [1, -1]) S([lean * 0.6, sh, 0.2 * s], [lean + 0.18, 1.55, 0.12 * s], lr * 0.85, coat);
  } else {
    for (const s of [1, -1]) S([lean * 0.5, sh, 0.21 * s], [-s * sw * 0.7 + 0.02, 0.98, 0.25 * s], lr * 0.85, robe ? coat : mul3(coat, 0.9));
  }
  // head: face toward the heading, hair or hat on top
  E(lean + 0.03, 1.58, 0, 0.075, 0.085, 0.075, SKIN);
  if (robe) E(lean + 0.01, 1.63, 0, 0.07, 0.04, 0.07, mul3(SKIN, 0.8));
  else if (o.hat) E(lean, 1.66, 0, 0.1, 0.04, 0.1, o.hat);
  else E(lean - 0.01, 1.64, 0, 0.077, 0.045, 0.077, HAIR);
  if (role === 'porter') {
    // the doko: a tall wicker basket on the back, the load lashed under a blue tarpaulin
    E(lean * 0.5 - 0.24, 1.22, 0, 0.13, 0.24, 0.16, [0.55, 0.42, 0.24]);
    E(lean * 0.5 - 0.26, 1.56, 0, 0.15, 0.11, 0.18, o.load || [0.14, 0.32, 0.62]);
  } else if (role === 'trekker') {
    E(-0.18, 1.25, 0, 0.07, 0.15, 0.11, o.pack || [0.62, 0.36, 0.08]);
  }
  if (out.due()) yield;
}
// A horse or a pack mule: a deep body, a long neck and head, slim legs, a tail. Mules carry two
// side packs and a load on top; a horse may stand tethered with its head down to graze.
const HORSES = [[0.3, 0.18, 0.1], [0.16, 0.11, 0.09], [0.48, 0.46, 0.42], [0.5, 0.38, 0.24], [0.24, 0.2, 0.17]];
function* horse(ctx, out, wx, y, d, o) {
  out = flashOut(out);
  const k = o.k || 1.6, ca = Math.cos(o.yaw), sa = Math.sin(o.yaw), x0 = wx - ctx.x0;
  const pt = [0, 0, 0];
  const P = (u, h, v) => { pt[0] = x0 + (u * ca - v * sa) * k; pt[1] = y + h * k; pt[2] = -(d + (u * sa + v * ca) * k); return pt; };
  const q = quatYaw(o.yaw);
  // (no radius under 0.0006 d: smaller splats fall below a pixel and the GPU dims them away)
  const fl = 0.0006 * d;
  const E = (u, h, v, rx, ry, rz, c, qq = q) => { P(u, h, v); out(pt[0], pt[1], pt[2], Math.max(rx * k, fl), Math.max(ry * k, fl), Math.max(rz * k, fl), c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], KIND.OTHER); };
  const S = (a, b, r, c) => { const pa = [...P(a[0], a[1], a[2])], pb = P(b[0], b[1], b[2]); strut(out, pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], r, c, 2, 1, KIND.OTHER); };
  const c = o.col, hi = mul3(c, 1.35), lo = mul3(c, 0.7);
  const lr = Math.max(0.06 * k, 0.0008 * d), sw = Math.sin((o.ph || 0) * Math.PI * 2) * 0.16;
  for (const [u, v, s] of [[0.48, 0.13, 1], [0.48, -0.13, -1], [-0.46, 0.13, -1], [-0.46, -0.13, 1]]) S([u, 0.98, v], [u + s * sw, 0.03, v], lr, lo);
  E(0, 1.18, 0, 0.58, 0.27, 0.24, c);
  E(0.44, 1.2, 0, 0.24, 0.27, 0.22, c);
  E(-0.44, 1.24, 0, 0.26, 0.27, 0.23, c);
  E(-0.05, 1.42, 0, 0.5, 0.06, 0.16, hi);
  const graze = o.graze;
  const qn = quatMul(q, quatAxis(0, 0, 1, graze ? -0.75 : 0.95)), qd = quatMul(q, quatAxis(0, 0, 1, graze ? -1.2 : -0.55));
  if (graze) { E(0.72, 1.0, 0, 0.3, 0.1, 0.11, c, qn); E(0.96, 0.62, 0, 0.22, 0.085, 0.095, c, qd); }
  else { E(0.72, 1.55, 0, 0.27, 0.1, 0.11, c, qn); E(0.95, 1.74, 0, 0.23, 0.085, 0.095, c, qd); E(0.82, 1.92, 0, 0.04, 0.08, 0.06, lo); }
  E(graze ? 0.62 : 0.66, graze ? 1.2 : 1.66, 0, 0.2, 0.05, 0.04, mul3(c, 0.45), qn);   // the mane
  S([-0.66, 1.34, 0], [-0.78, 0.62, 0], Math.max(0.07 * k, 0.0009 * d), mul3(c, 0.5));
  if (o.pack) {
    const pc = o.pack;
    for (const v of [1, -1]) E(0, 1.18, 0.34 * v, 0.36, 0.2, 0.08, pc);
    E(0, 1.5, 0, 0.36, 0.13, 0.3, o.load || [0.7, 0.66, 0.58]);
    E(0.42, 1.38, 0, 0.06, 0.12, 0.27, [0.6, 0.12, 0.08]);    // a red tassel collar
  } else if (o.saddle) {
    E(-0.02, 1.48, 0, 0.26, 0.07, 0.27, o.saddle);
  }
  if (out.due()) yield;
}

// A worn path across the near slope: d = d0 + A sin((wx - x0) / P + ph), from xa to xb.
const pathD = (p, wx) => (p.fn ? p.fn(wx) : p.d0 + p.A * Math.sin((wx - p.xa) / p.P + p.ph));
function* drawPath(ctx, out, W, p, dLo, dHi) {
  const xa = Math.max(p.xa, ctx.x0 - 1), xb = Math.min(p.xb, ctx.x0 + ctx.length + 1);
  if (xb <= xa) return;
  const dm = pathD(p, (xa + xb) / 2);
  if (!inD(dm, dLo - 40, dHi + 40)) return;
  const s = Math.max(0.45, detail(out, dm, 0.9)), st = s * 1.2;
  // (on a grid of world x, so the two chunks either side of a border meet without a gap or a double)
  for (let wx = (Math.floor(xa / st) + 0.5) * st; wx < xb; wx += st) {
    if (wx < xa) continue;
    const d = pathD(p, wx);
    if (!inD(d, dLo, dHi)) continue;
    for (const off of [-0.45, 0.45]) {
      const dd = d + off * p.w, y = W.H(wx, dd);
      const e = 1.2, nn = norm3(-(W.H(wx + e, dd) - y) / e, 1, (W.H(wx, dd + e) - y) / e);
      const u = hh(Math.round(wx * 3), Math.round(off * 10), p.seed & 0xffff);
      const c = shade(p.pale ? mix3([0.78, 0.74, 0.66], [0.68, 0.62, 0.52], u) : mix3([0.67, 0.64, 0.59], [0.55, 0.51, 0.45], u), nn[0], nn[1], nn[2], 0.55, 0.6);
      const qq = quatUpTo(nn[0], nn[1], nn[2]);
      out(wx - ctx.x0, y + 0.2, -dd, s * 1.1, s * 0.1, Math.max(s * 0.8, p.w * 0.35), c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], KIND.GROUND);
    }
    if (out.due()) yield;
  }
}
// File of walkers along a path: positions, ground heights and headings fixed in the layout.
function fileAlong(W, p, lead, dir, list) {
  let x = lead;
  for (const m of list) {
    x -= dir * m.gap;
    const d = pathD(p, x), dd = (pathD(p, x + dir) - d);
    m.wx = x; m.d = d; m.y = W.H(x, d) - 0.05; m.yaw = Math.atan2(dd, dir);
  }
  return list;
}
function* drawWalkers(ctx, out, list, dLo, dHi) {
  for (const m of list) {
    if (!inD(m.d, dLo, dHi) || !inX(ctx, m.wx, 3)) continue;
    if (m.type === 'mule' || m.type === 'horse') yield* horse(ctx, out, m.wx, m.y, m.d, m);
    else if (m.type === 'yak') yield* yak(ctx, out, m.wx, m.y, m.d, m);
    else yield* person(ctx, out, m.wx, m.y, m.d, m);
  }
}

// --- caravans: mules or yaks in single file on a trail, porters, trekkers ---
const CVCELL = 1150;
function caravan(W, i) { return cache(W, 'cv', i, () => makeCaravan(W, i)); }
function makeCaravan(W, i) {
  const seed = hashInts(W.ws, 1601, i), r = makeRng(seed);
  const wx = (i + 0.2 + 0.6 * r()) * CVCELL;
  if (r() > 0.42 * mood(W, wx).herd) return null;
  const bn = bnAt(W, wx);
  const d0 = 50 + (Math.min(bn - 30, 170) - 50) * Math.pow(r(), 1.3);
  if (!nearFree(W, wx, d0, 40)) return null;
  const p = { xa: wx - 170, xb: wx + 170, d0, A: 4 + 10 * r(), P: 40 + 50 * r(), ph: r() * 6.3, w: 1.6, seed };
  if (pathTaken(W, 5, p)) return null;
  const dir = r() < 0.5 ? 1 : -1;
  const kind = r() < 0.55 ? 'mule' : r() < 0.7 ? 'none' : 'yak';
  const list = [];
  const ph = () => r();
  list.push({ role: 'herder', gap: 0, ph: ph(), hat: r() < 0.5 ? [0.3, 0.24, 0.16] : null, col: [0.2, 0.15, 0.12] });
  const na = kind === 'none' ? 0 : 4 + Math.floor(r() * 6);
  const packs = [[0.55, 0.42, 0.26], [0.2, 0.3, 0.55], [0.6, 0.2, 0.12], [0.45, 0.45, 0.4]];
  for (let k = 0; k < na; k++) {
    if (kind === 'mule') list.push({ type: 'mule', gap: 4.1, ph: ph(), col: HORSES[Math.floor(r() * HORSES.length)], pack: packs[Math.floor(r() * packs.length)] });
    else list.push({ type: 'yak', gap: 4.8, ph: ph(), k: 1.7 + 0.25 * r(), col: YAKS[Math.floor(r() * YAKS.length)], graze: false, tassel: r() < 0.6, load: packs[Math.floor(r() * packs.length)], white: r() < 0.2, seed: hashInts(seed, 3, k) });
    if (k === Math.floor(na / 2) && r() < 0.7) list.push({ role: 'herder', gap: 2.9, ph: ph(), col: [0.25, 0.18, 0.14] });
  }
  const np = kind === 'none' ? 3 + Math.floor(r() * 4) : Math.floor(r() * 3);
  for (let k = 0; k < np; k++) list.push({ role: 'porter', gap: 2.9, ph: ph(), load: r() < 0.6 ? [0.14, 0.32, 0.62] : [0.62, 0.2, 0.12] });
  const nt = 1 + Math.floor(r() * 3);
  for (let k = 0; k < nt; k++) list.push({ role: 'trekker', gap: 3.6, ph: ph(), col: JACKETS[Math.floor(r() * 5)], pack: JACKETS[Math.floor(r() * JACKETS.length)], hat: r() < 0.4 ? [0.75, 0.7, 0.6] : null });
  const len = list.reduce((a, m) => a + m.gap, 0);
  const lead = wx + dir * len / 2;
  return { i, wx, d: d0, seed, path: p, walkers: fileAlong(W, p, lead, dir, list), kind };
}
function* caravans(ctx, out, W, dLo, dHi) {
  for (let i = Math.floor((ctx.x0 - 200) / CVCELL); i <= Math.floor((ctx.x0 + ctx.length + 200) / CVCELL); i++) {
    const c = caravan(W, i);
    if (!c || !inX(ctx, c.wx, 190)) continue;
    yield* drawPath(ctx, out, W, c.path, dLo, dHi);
    yield* drawWalkers(ctx, out, c.walkers, dLo, dHi);
  }
}

// --- a file of monks in maroon walking to a chorten, through a kani gate ---
const MKCELL = 1900;
function monkLine(W, i) { return cache(W, 'mk', i, () => makeMonks(W, i)); }
function makeMonks(W, i) {
  const seed = hashInts(W.ws, 1611, i), r = makeRng(seed);
  const wx = (i + 0.2 + 0.6 * r()) * MKCELL;
  if (r() > 0.7 * mood(W, wx).farm) return null;
  const bn = bnAt(W, wx);
  const d0 = 55 + (Math.min(bn - 30, 160) - 55) * r();
  if (!nearFree(W, wx, d0, 45)) return null;
  const p = { xa: wx - 130, xb: wx + 130, d0, A: 3 + 6 * r(), P: 50 + 40 * r(), ph: r() * 6.3, w: 1.4, seed };
  if (pathTaken(W, 4, p)) return null;
  const dir = r() < 0.5 ? 1 : -1;
  const n = 5 + Math.floor(r() * 8);
  const list = [];
  for (let k = 0; k < n; k++) list.push({ role: 'monk', gap: k ? 2.4 + 0.6 * r() : 0, ph: r(), hat: null });
  // the head of the line: a senior monk under a yellow crested hat, now and then
  if (r() < 0.5) list[0].hat = [0.8, 0.62, 0.1];
  const len = list.reduce((a, m) => a + m.gap, 0);
  const lead = wx + dir * (len / 2 - 15);
  const walkers = fileAlong(W, p, lead, dir, list);
  // ahead of them, a kani gate astride the path and a chorten beyond it
  const gx = lead + dir * 22, cx = lead + dir * 55;
  const gd = pathD(p, gx), cd = pathD(p, cx) + 7;
  const gate = { wx: gx, d: gd, yaw: Math.atan2(pathD(p, gx + 1) - gd, 1), seed: hashInts(seed, 7) };
  return { i, wx, d: d0, seed, path: p, walkers, gate, chorten: { wx: cx, d: cd, H: 6 + 2 * r(), seed: hashInts(seed, 8) } };
}
function* monkLines(ctx, out, W, dLo, dHi) {
  for (let i = Math.floor((ctx.x0 - 200) / MKCELL); i <= Math.floor((ctx.x0 + ctx.length + 200) / MKCELL); i++) {
    const m = monkLine(W, i);
    if (!m || !inX(ctx, m.wx, 190)) continue;
    yield* drawPath(ctx, out, W, m.path, dLo, dHi);
    yield* drawWalkers(ctx, out, m.walkers, dLo, dHi);
    if (inD(m.gate.d, dLo, dHi) && inX(ctx, m.gate.wx, 8)) yield* kaniGate(ctx, out, W, m.gate);
    if (inD(m.chorten.d, dLo, dHi) && inX(ctx, m.chorten.wx, 8)) yield* drawChorten(ctx, out, W, m.chorten);
  }
}

// --- the kani gate: a gateway chorten the path walks through ---
// Two thick whitewashed piers under a deep lintel with a painted band, a small chorten on top.
// The path runs along local x through the passage, so the passage faces along the track.
function* kaniGate(ctx, out, W, g) {
  const rng = makeRng(g.seed);
  const yaw = g.yaw + Math.PI / 2;      // the passage runs along the path
  const pw = 3.2, pier = 2.1, dep = 5.2, ph = 4.3, lh = 1.9;
  const [ex, ez] = rotY(1, 0, yaw);
  let lo = Infinity, hi = -Infinity;
  for (const a of [-1, 1]) for (const b of [-1, 1]) { const yy = W.H(g.wx + ex * a * 4 + b * 2.5, g.d - ez * a * 4); lo = Math.min(lo, yy); hi = Math.max(hi, yy); }
  const y = Math.max(lo, hi - 0.8) - 0.2;
  const x = g.wx - ctx.x0, s = clamp(sizeS(out, g.d, 0.7), 0.1, 0.5);
  const white = C.white;
  const pierF = (f, a, b, nx, nz) => (f === 4 ? mul3(white, 0.9) : faceTone(white, nx, nz));
  for (const sgn of [-1, 1]) {
    const o = sgn * (pw / 2 + pier / 2);
    yield* box(out, x + ex * o, y, g.d - ez * o, pier, dep, ph, yaw, s, pierF, KIND.BUILDING, rng);
  }
  if (y > lo + 0.3) yield* plinth(out, x, g.d, pw + 2 * pier, dep, yaw, lo - 0.4, y + 0.1, s, KIND.BUILDING, rng);
  const lw = pw + 2 * pier + 0.4;
  yield* box(out, x, y + ph, g.d, lw, dep + 0.4, lh, yaw, s, (f, a, b, nx, nz) => {
    if (f === 4) return mul3(white, 0.9);
    if (b > 0.72) return faceTone(C.maroon, nx, nz);
    if (b > 0.55) return faceTone(hh(Math.floor(a * 9), f, 3) < 0.5 ? [0.72, 0.56, 0.22] : [0.2, 0.36, 0.6], nx, nz);
    return faceTone(white, nx, nz);
  }, KIND.BUILDING, rng);
  // the dark of the passage, seen through the gate
  yield* box(out, x, y, g.d, pw * 0.98, dep * 0.96, ph * 0.98, yaw, s, (f) => (f === 4 ? null : [0.1, 0.09, 0.08]), KIND.BUILDING, rng);
  yield* chorten(ctx, out, x, g.d, 5.3, { y: y + ph + lh, s: clamp(s, 0.06, 0.45), rng, kind: KIND.BUILDING, yaw });
}
// Kani gates on their own, at the entrance to a hamlet.
function* hamletGates(ctx, out, W, h, dLo, dHi) {
  if (!h.gate || !inD(h.gate.d, dLo, dHi) || !inX(ctx, h.gate.wx, 8)) return;
  yield* kaniGate(ctx, out, W, h.gate);
}

// --- a row of prayer wheels along a roofed wall ---
const PWCELL = 1400;
function wheelWall(W, i) { return cache(W, 'pw', i, () => makeWheelWall(W, i)); }
function makeWheelWall(W, i) {
  const seed = hashInts(W.ws, 1621, i), r = makeRng(seed);
  const wx = (i + 0.2 + 0.6 * r()) * PWCELL;
  if (r() > 0.4 * mood(W, wx).farm) return null;
  const bn = bnAt(W, wx);
  const d = 48 + (Math.min(bn - 25, 150) - 48) * Math.pow(r(), 1.4);
  if (!nearFree(W, wx, d, 25)) return null;
  const len = 14 + 14 * r(), yaw = (r() - 0.5) * 0.5;
  if (taken(W, 3, wx, d, len / 2 + 10)) return null;
  const pw = { i, wx, d, len, yaw, seed, people: [] };
  // pilgrims turning the wheels as they walk along
  const np = Math.floor(r() * 3);
  for (let k = 0; k < np; k++) {
    const t = (r() - 0.5) * 0.8 * len, [ox, oz] = rotY(t, 2.1, yaw);
    const px = wx + ox, pd = d - oz;
    pw.people.push({ role: 'herder', wx: px, d: pd, y: W.H(px, pd), yaw: yaw + (r() < 0.5 ? 0 : Math.PI), ph: r(), col: r() < 0.5 ? [0.22, 0.17, 0.14] : [0.36, 0.1, 0.08], hat: r() < 0.5 ? [0.55, 0.5, 0.42] : null });
  }
  if (r() < 0.55) {
    const [ox, oz] = rotY(-(len / 2 + 7), 0, yaw);
    pw.gate = { wx: wx + ox, d: d - oz, yaw, seed: hashInts(seed, 4) };
  }
  return pw;
}
function* wheelWalls(ctx, out, W, dLo, dHi) {
  for (let i = Math.floor((ctx.x0 - 60) / PWCELL); i <= Math.floor((ctx.x0 + ctx.length + 60) / PWCELL); i++) {
    const p = wheelWall(W, i);
    if (!p || !inX(ctx, p.wx, p.len / 2 + 20)) continue;
    if (inD(p.d, dLo, dHi)) yield* drawWheelWall(ctx, out, W, p);
    for (const m of p.people) if (inD(m.d, dLo, dHi) && inX(ctx, m.wx, 2)) yield* person(ctx, out, m.wx, m.y, m.d, m);
    if (p.gate && inD(p.gate.d, dLo, dHi) && inX(ctx, p.gate.wx, 8)) yield* kaniGate(ctx, out, W, p.gate);
  }
}
function* drawWheelWall(ctx, out, W, p) {
  const rng = makeRng(p.seed);
  const [ex, ez] = rotY(1, 0, p.yaw), [fx, fz] = rotY(0, 1, p.yaw);
  let lo = Infinity, hi = -Infinity;
  for (const a of [-0.5, 0, 0.5]) for (const b of [-1, 1.2]) { const yy = W.H(p.wx + ex * a * p.len + fx * b, p.d - (ez * a * p.len + fz * b)); lo = Math.min(lo, yy); hi = Math.max(hi, yy); }
  const y = Math.max(lo, hi - 0.6);
  const x = p.wx - ctx.x0, s = clamp(sizeS(out, p.d, 0.7), 0.1, 0.45);
  const at = (lu, lz) => [x + ex * lu + fx * lz, -p.d + ez * lu + fz * lz];
  if (y > lo + 0.3) yield* plinth(out, x, p.d, p.len + 1, 3.2, p.yaw, lo - 0.4, y + 0.05, s, KIND.BUILDING, rng);
  // the back wall, whitewashed, with a maroon band under the roof
  const [bx, bz] = at(0, -0.9);
  // (the front face is in deep shadow behind the wheels, so the drums stand out against it)
  yield* box(out, bx, y, -bz, p.len, 0.7, 3.3, p.yaw, s, (f, a, b, nx, nz) => (f === 4 ? C.parapet : f === 0 && b > 0.22 && b < 0.78 ? [0.16, 0.1, 0.08] : faceTone(b > 0.8 ? C.maroon : C.white, nx, nz)), KIND.BUILDING, rng);
  // the roof: a deep eave over the wheels on a row of posts
  const [rx, rz] = at(0, -0.3);
  yield* box(out, rx, y + 3.3, -rz, p.len + 0.8, 1.9, 0.36, p.yaw, s, (f, a, b, nx, nz) => (f === 4 ? jitter([0.3, 0.2, 0.15], rng, 0.08) : faceTone(f === 0 ? [0.72, 0.56, 0.22] : C.parapet, nx, nz)), KIND.BUILDING, rng);
  const pr = Math.max(0.06, 0.0005 * p.d);
  for (let t = -p.len / 2; t <= p.len / 2 + 0.01; t += p.len / Math.max(2, Math.round(p.len / 4.5))) {
    const [px, pz] = at(t, 0.6);
    strut(out, px, y, pz, px, y + 3.3, pz, pr, [0.3, 0.14, 0.1], 2, 1, KIND.BUILDING);
  }
  // the wheels: upright drums in copper, gold and red, side by side on their spindles
  const wr = Math.max(0.33, 0.0022 * p.d), step = wr * 2.7;
  const nw = Math.floor((p.len - 0.8) / step);
  for (let k = 0; k < nw; k++) {
    const t = -((nw - 1) / 2) * step + k * step;
    const [wxx, wz] = at(t, -0.15);
    const u = hh(k, p.seed & 0xffff, 21);
    const c = u < 0.45 ? [0.72, 0.46, 0.22] : u < 0.85 ? [0.8, 0.64, 0.22] : [0.66, 0.16, 0.1];
    const cs = shade(c, 0, 0.3, 1, 0.7, 0.5);
    out(wxx, y + 1.65, wz, wr, wr * 1.5, wr, cs[0], cs[1], cs[2], 1, 0, 0, 0, 1, KIND.BUILDING);
    // a painted band round the middle and the dark cap
    out(wxx, y + 1.65, wz + wr * 0.15, wr * 1.03, wr * 0.28, wr * 1.03, 0.62, 0.14, 0.1, 1, 0, 0, 0, 1, KIND.BUILDING);
    out(wxx, y + 1.65 + wr * 1.25, wz, wr * 0.9, wr * 0.25, wr * 0.9, 0.2, 0.12, 0.08, 1, 0, 0, 0, 1, KIND.BUILDING);
    if (out.due()) yield;
  }
}

// --- the trekkers' lodge: a two-storey tea house under a blue tin roof, a walled terrace in front
// with trekkers at it, firewood stacked against the end wall, smoke from the stove pipe ---
const LDCELL = 1700;
function lodge(W, i) { return cache(W, 'ld', i, () => makeLodge(W, i)); }
function makeLodge(W, i) {
  const seed = hashInts(W.ws, 1631, i), r = makeRng(seed);
  const wx = (i + 0.2 + 0.6 * r()) * LDCELL;
  if (r() > 0.75 * mood(W, wx).herd) return null;
  const bn = bnAt(W, wx);
  const d = 60 + (Math.min(bn - 30, 190) - 60) * r();
  if (!nearFree(W, wx, d, 30)) return null;
  const L = { i, wx, d, seed, w: 11 + 5 * r(), dep: 8 + 2 * r(), h: 5.6 + 1.2 * r(), yaw: (r() - 0.5) * 0.3, roof: r() < 0.75 ? [0.14, 0.34, 0.6] : [0.12, 0.46, 0.46], people: [] };
  L.base = minGround(W, L); L.top = GR.max;
  const nt = 1 + Math.floor(r() * 3);
  for (let k = 0; k < nt; k++) {
    const [ox, oz] = rotY((r() - 0.5) * L.w * 0.7, L.dep / 2 + 2 + 2 * r(), L.yaw);
    L.people.push({ role: 'trekker', wx: wx + ox, d: d - oz, yaw: r() * 6.3, ph: 0, col: JACKETS[Math.floor(r() * 5)], pack: JACKETS[Math.floor(r() * JACKETS.length)] });
  }
  return L;
}
function* lodges(ctx, out, W, dLo, dHi) {
  for (let i = Math.floor((ctx.x0 - 60) / LDCELL); i <= Math.floor((ctx.x0 + ctx.length + 60) / LDCELL); i++) {
    const L = lodge(W, i);
    if (!L || !inX(ctx, L.wx, 30) || !inD(L.d, dLo, dHi)) continue;
    yield* drawLodge(ctx, out, W, L);
  }
}
function* drawLodge(ctx, out, W, L) {
  const rng = makeRng(L.seed);
  const x = L.wx - ctx.x0, s = sizeS(out, L.d, 0.8);
  const y = Math.max(L.base, L.top - 0.33 * L.h) - 0.3;
  const [ex, ez] = rotY(1, 0, L.yaw), [fx, fz] = rotY(0, 1, L.yaw);
  const P = (lx, ly, lz) => [x + ex * lx + fx * lz, y + ly, -L.d + ez * lx + fz * lz];
  // the terrace: a stone platform built out in front, its top beaten earth
  const T = 5;
  const [tx, tz] = rotY(0, L.dep / 2 + T / 2, L.yaw);
  const tlo = Math.min(L.base, W.H(L.wx + tx, L.d - tz) - 0.3);
  yield* box(out, x + tx, tlo - 0.4, L.d - tz, L.w + 2, T, y - tlo + 0.4, L.yaw, Math.max(0.25, s), (f, a, b, nx, nz) => (f === 4 ? jitter(C.yard, rng, 0.06) : jitter(faceTone(mix3(C.wallStone, C.stoneDark, 0.25), nx, nz), rng, 0.08)), KIND.BUILDING, rng);
  if (y > L.base + 0.8) yield* plinth(out, x, L.d, L.w, L.dep, L.yaw, L.base - 0.6, y + 0.2, s, KIND.BUILDING, rng);
  yield* flatHouse(ctx, out, x, L.d, { w: L.w, dep: L.dep, h: L.h, yaw: L.yaw, wall: C.white, y, s, rng, lit: litShare(ctx), salt: L.seed & 0xffff });
  // the low-pitched tin roof, front and back slopes and the gable ends
  const rh = 1.6, ov = 0.45, top = L.h;
  const roofC = (nz) => (a, b) => jitter(shade(L.roof, 0, 0.9, nz, 0.62, 0.45), rng, 0.04);
  yield* panel(out, P(-L.w / 2 - ov, top, L.dep / 2 + ov), [ex, 0, ez], P(-L.w / 2 - ov, top + rh, 0), L.w + 2 * ov, s, roofC(0.6), KIND.BUILDING, rng);
  yield* panel(out, P(L.w / 2 + ov, top, -L.dep / 2 - ov), [-ex, 0, -ez], P(L.w / 2 + ov, top + rh, 0), L.w + 2 * ov, s, roofC(-0.4), KIND.BUILDING, rng);
  for (const sg of [-1, 1]) {
    yield* panel(out, P(sg * L.w / 2, top, -L.dep / 2), [fx, 0, fz], P(sg * L.w / 2, top + rh, -L.dep / 2), L.dep, s, (a, b) => {
      if (b > 1 - Math.abs(a - 0.5) * 2) return null;
      return faceTone(L.roof, sg * ex, sg * ez);
    }, KIND.BUILDING, rng);
  }
  // the stove pipe and its smoke
  const cp = P(L.w * 0.3, top + rh * 0.6, -L.dep * 0.15);
  strut(out, cp[0], cp[1], cp[2], cp[0], cp[1] + 2.2, cp[2], Math.max(0.12, 0.0008 * L.d), [0.2, 0.2, 0.21], 2, 1, KIND.BUILDING);
  smoke(out, cp[0], cp[1] + 2.4, -cp[2], L.seed & 0xffff, 7, 8, 1);
  // firewood stacked against the sunny end wall: log ends in rows
  const fwp = P(-L.w / 2 - 0.8, 0, 0);
  yield* box(out, fwp[0], y, -fwp[2], 1.4, L.dep * 0.75, 1.9, L.yaw, clamp(s, 0.1, 0.3), (f, a, b, nx, nz) => {
    if (f === 4) return jitter([0.36, 0.28, 0.2], rng, 0.1);
    const u = hh(Math.floor(a * 14), Math.floor(b * 6) + f * 7, 77);
    return faceTone(u < 0.5 ? [0.64, 0.5, 0.32] : u < 0.8 ? [0.46, 0.34, 0.22] : [0.3, 0.22, 0.15], nx, nz);
  }, KIND.BUILDING, rng);
  // a short string of flags from the roof to a pole by the terrace
  const pp = P(L.w / 2 + 1.5, 0, L.dep / 2 + T);
  const pwx = pp[0] + ctx.x0, pd = -pp[2];
  yield* flagPole(ctx, out, W, { wx: pwx, d: pd, h: 7, seed: L.seed ^ 3 });
  const ra = P(-L.w * 0.3, top + rh, 0);
  yield* flagString(ctx, out, { a: [ra[0] + ctx.x0, ra[1], -ra[2]], b: [pwx, W.H(pwx, pd) + 6.6, pd], sag: 0.05, seed: L.seed ^ 9, fw: 0.4 }, ctx.zNear, ctx.zFar);
  for (const m of L.people) yield* person(ctx, out, m.wx, y + 0.05, m.d, m);
}

// --- a nomad camp: black yak-hair tents, a fire, horses on a tether line, a few yaks ---
const NCCELL = 2100;
function camp(W, i) { return cache(W, 'nc', i, () => makeCamp(W, i)); }
function makeCamp(W, i) {
  const seed = hashInts(W.ws, 1641, i), r = makeRng(seed);
  const wx = (i + 0.2 + 0.6 * r()) * NCCELL;
  if (r() > 0.8 * mood(W, wx).herd) return null;
  const bn = bnAt(W, wx);
  const d = 60 + (Math.min(bn - 30, 200) - 60) * r();
  if (!nearFree(W, wx, d, 45) || taken(W, 1, wx, d, 48)) return null;
  const c = { i, wx, d, seed, tents: [], horses: [], yaks: [], people: [] };
  const nt = 1 + Math.floor(r() * 3);
  for (let k = 0; k < nt; k++) {
    const tx = wx + (k - (nt - 1) / 2) * (17 + 6 * r()), td = d + (r() - 0.5) * 10;
    c.tents.push({ wx: tx, d: td, w: 9.5 + 3.5 * r(), dep: 7 + 2 * r(), h: 3.3 + 0.7 * r(), yaw: (r() - 0.5) * 0.6, seed: hashInts(seed, 1, k) });
  }
  c.fire = { wx: wx + (r() - 0.5) * 10, d: d - 7 - 3 * r() };
  c.fire.y = W.H(c.fire.wx, c.fire.d);
  // a tether line between two stakes with horses tied along it
  const lx = wx + (r() < 0.5 ? -1 : 1) * (18 + 8 * r()), ld = d - 4 + 6 * r(), ll = 8 + 6 * r();
  c.line = { a: [lx - ll / 2, ld], b: [lx + ll / 2, ld] };
  const nh = 2 + Math.floor(r() * 3);
  for (let k = 0; k < nh; k++) {
    const hx = lx - ll / 2 + (k + 0.5) * ll / nh, hd = ld - 1.2;
    c.horses.push({ type: 'horse', wx: hx, d: hd, y: W.H(hx, hd), yaw: -Math.PI / 2 + (r() - 0.5) * 0.7, col: HORSES[Math.floor(r() * HORSES.length)], graze: r() < 0.4, saddle: r() < 0.5 ? [0.6, 0.14, 0.1] : null, ph: 0.25 });
  }
  const ny = Math.floor(r() * 5);
  for (let k = 0; k < ny; k++) {
    const yx = wx + (r() - 0.5) * 50, yd = d + 10 + 10 * r();
    c.yaks.push({ wx: yx, d: yd, yaw: r() * 6.3, k: 1.7 + 0.4 * r(), col: YAKS[Math.floor(r() * YAKS.length)], graze: r() < 0.7, tassel: r() < 0.3, white: r() < 0.25, seed: hashInts(seed, 4, k) });
  }
  const np = 1 + Math.floor(r() * 3);
  for (let k = 0; k < np; k++) {
    const px = c.fire.wx + (r() - 0.5) * 6, pd = c.fire.d + (r() - 0.5) * 4;
    c.people.push({ role: r() < 0.25 ? 'child' : 'herder', wx: px, d: pd, y: W.H(px, pd), yaw: r() * 6.3, ph: 0.25, col: r() < 0.5 ? [0.22, 0.16, 0.12] : [0.3, 0.12, 0.1], hat: r() < 0.4 ? [0.5, 0.36, 0.2] : null });
  }
  return c;
}
function* camps(ctx, out, W, dLo, dHi) {
  for (let i = Math.floor((ctx.x0 - 100) / NCCELL); i <= Math.floor((ctx.x0 + ctx.length + 100) / NCCELL); i++) {
    const c = camp(W, i);
    if (!c || !inX(ctx, c.wx, 80)) continue;
    for (const t of c.tents) if (inD(t.d, dLo, dHi) && inX(ctx, t.wx, 10)) yield* blackTent(ctx, out, W, t);
    if (inD(c.fire.d, dLo, dHi) && inX(ctx, c.fire.wx, 2)) {
      const fx = c.fire.wx - ctx.x0, fy = c.fire.y;
      for (let k = 0; k < 6; k++) { const a = k / 6 * 6.28; out(fx + Math.cos(a) * 0.7, fy + 0.15, -(c.fire.d + Math.sin(a) * 0.7), 0.22, 0.16, 0.2, 0.3, 0.29, 0.27, 1, 0, 0, 0, 1, KIND.OTHER); }
      out(fx, fy + 0.35, -c.fire.d, 0.3, 0.3, 0.3, 1.0, 0.56, 0.18, 1, 0, 0, 0, 1, KIND.LIGHT);
      out(fx, fy + 0.6, -c.fire.d, 0.18, 0.32, 0.18, 1.0, 0.78, 0.35, 1, 0, 0, 0, 1, KIND.LIGHT);
      smoke(out, fx, fy + 1.4, c.fire.d, c.seed & 0xffff, 7, 9, 0.9);
    }
    const [a, b] = [c.line.a, c.line.b];
    if (inD(a[1], dLo, dHi) && inX(ctx, a[0], 15)) {
      const ya = W.H(a[0], a[1]), yb = W.H(b[0], b[1]);
      const pr = Math.max(0.06, 0.0006 * a[1]);
      strut(out, a[0] - ctx.x0, ya, -a[1], a[0] - ctx.x0, ya + 1.2, -a[1], pr, C.pole, 1, 1, KIND.OTHER);
      strut(out, b[0] - ctx.x0, yb, -b[1], b[0] - ctx.x0, yb + 1.2, -b[1], pr, C.pole, 1, 1, KIND.OTHER);
      strut(out, a[0] - ctx.x0, ya + 1.1, -a[1], b[0] - ctx.x0, yb + 1.1, -b[1], Math.max(0.03, 0.0005 * a[1]), C.cord, 4, 1, KIND.WIRE);
    }
    for (const h of c.horses) if (inD(h.d, dLo, dHi) && inX(ctx, h.wx, 3)) yield* horse(ctx, out, h.wx, h.y, h.d, h);
    for (const y of c.yaks) if (inD(y.d, dLo, dHi) && inX(ctx, y.wx, 4)) yield* yak(ctx, out, y.wx, W.H(y.wx, y.d) - 0.05, y.d, y);
    for (const m of c.people) if (inD(m.d, dLo, dHi) && inX(ctx, m.wx, 2)) yield* person(ctx, out, m.wx, m.y, m.d, m);
  }
}
// A black tent of woven yak hair: a ridge along its length, the two long slopes pegged out low with
// a short wall of cloth beneath, end walls closing it, a smoke gap along the ridge and guy ropes
// out to stakes. The weave shows as darker and lighter bands; a white cloth trims the eaves.
function* blackTent(ctx, out, W, t) {
  const rng = makeRng(t.seed);
  const [ex, ez] = rotY(1, 0, t.yaw), [fx, fz] = rotY(0, 1, t.yaw);
  let lo = Infinity;
  for (const a of [-0.5, 0.5]) for (const b of [-0.5, 0.5]) lo = Math.min(lo, W.H(t.wx + ex * a * t.w + fx * b * t.dep, t.d - (ez * a * t.w + fz * b * t.dep)));
  const x = t.wx - ctx.x0, y = lo - 0.15;
  const P = (lx, ly, lz) => [x + ex * lx + fx * lz, y + ly, -t.d + ez * lx + fz * lz];
  const s = clamp(sizeS(out, t.d, 0.6), 0.08, 0.4);
  const eave = 0.8, H = t.h;
  const cloth = (nz, k) => (a, b) => {
    const band = hh(Math.floor(a * t.w / 0.9), 3, t.seed & 0xffff) < 0.3 ? 1.6 : 1;
    return jitter(mul3(shade([0.11, 0.095, 0.085], 0, 0.7, nz, 0.62, 0.5), band * k), rng, 0.08);
  };
  for (const sg of [1, -1]) {
    const o = P(-sg * t.w / 2, eave, sg * t.dep / 2), u = [sg * ex, 0, sg * ez];
    yield* panel(out, o, u, P(-sg * t.w / 2, H, sg * 0.25), t.w, s, cloth(0.6 * sg, sg > 0 ? 1 : 0.8), KIND.BUILDING, rng);
    yield* panel(out, P(-sg * t.w / 2, 0, sg * t.dep / 2), u, P(-sg * t.w / 2, eave, sg * t.dep / 2), t.w, s, (a, b) => (b > 0.8 ? [0.72, 0.7, 0.64] : cloth(sg, 0.9)(a, b)), KIND.BUILDING, rng);
    // the end walls
    yield* panel(out, P(sg * t.w / 2, 0, -t.dep / 2), [fx, 0, fz], P(sg * t.w / 2, H, -t.dep / 2), t.dep, s, (a, b) => {
      const top = eave / H + (1 - eave / H) * (1 - Math.abs(a - 0.5) * 2);
      if (b > top) return null;
      return jitter(faceTone([0.12, 0.1, 0.09], sg * ex, sg * ez), rng, 0.08);
    }, KIND.BUILDING, rng);
  }
  // the ridge poles standing up through the smoke gap, and the smoke
  const pr = Math.max(0.05, 0.0006 * t.d);
  for (const a of [-0.3, 0.3]) { const p = P(a * t.w, 0, 0); strut(out, p[0], H * 0.7 + y, p[2], p[0], y + H + 0.9, p[2], pr, C.pole, 2, 1, KIND.BUILDING); }
  const sp = P(0, H + 0.3, 0);
  smoke(out, sp[0], sp[1], -sp[2], t.seed & 0xffff, 6, 8, 0.8);
  // guy ropes out to stakes
  const gr = Math.max(0.03, 0.0005 * t.d);
  for (const sg of [1, -1]) for (const a of [-0.4, 0, 0.4]) {
    const p = P(a * t.w, (eave + H) / 2, sg * t.dep / 4), q2 = P(a * t.w * 1.15, 0, sg * (t.dep / 2 + 2.4));
    q2[1] = W.H(q2[0] + ctx.x0, -q2[2]);
    strut(out, p[0], p[1], p[2], q2[0], q2[1], q2[2], gr, [0.26, 0.22, 0.18], 2, 1, KIND.WIRE);
  }
}

// --- hamlet extras: an apricot orchard in blossom, a walled potato field, a school ---
function* blossomTree(ctx, out, W, t) {
  const x = t.wx - ctx.x0, y = t.y - 0.2, rng = makeRng(t.seed);
  const tr = Math.max(0.14, 0.0008 * t.d);
  strut(out, x, y, -t.d, x + 0.2, y + t.h * 0.45, -t.d, tr, [0.3, 0.24, 0.2], 2, 1, KIND.TREE);
  const R = t.h * 0.3;
  // a few dark limbs fanning up into the crown, so it is a tree in flower and not a pink cloud
  const br = Math.max(0.06, 0.0006 * t.d);
  for (let k = 0; k < 4; k++) {
    const a = k / 4 * 6.28 + rng(), sp = R * (0.6 + 0.3 * rng());
    strut(out, x + 0.2, y + t.h * 0.42, -t.d, x + Math.cos(a) * sp, y + t.h * (0.7 + 0.15 * rng()), -(t.d + Math.sin(a) * sp * 0.6), br, [0.26, 0.2, 0.17], 2, 1, KIND.TREE);
  }
  const n = Math.round(clamp(treeSplats2(out, t.d, R * 2) * 1.3, 18, 260));
  const lumps = 4;
  for (let k = 0; k < lumps; k++) {
    const a = k / lumps * 6.28 + rng();
    const c = t.white ? [0.8, 0.78, 0.76] : [0.8, 0.6 + 0.08 * rng(), 0.68];
    yield* blob(ctx, out, x + Math.cos(a) * R * 0.5, y + t.h * 0.68 + (rng() - 0.4) * R * 0.4, t.d + Math.sin(a) * R * 0.4, R * 0.6, R * 0.5, R * 0.6, { n: Math.round(n / lumps), color: c, rng, kind: KIND.TREE, inner: 0.45, amb: 0.62, clump: 0.85 });
  }
}
function* potatoField(ctx, out, W, f) {
  // rows of earthed-up green ridges inside a dry-stone wall
  yield* stoneWall(ctx, out, W, f.x0, f.d0, f.x1, f.d0, 0.9, f.seed & 0xffff);
  yield* stoneWall(ctx, out, W, f.x0, f.d1, f.x1, f.d1, 0.9, (f.seed >> 3) & 0xffff);
  yield* stoneWall(ctx, out, W, f.x0, f.d0, f.x0, f.d1, 0.9, (f.seed >> 5) & 0xffff);
  yield* stoneWall(ctx, out, W, f.x1, f.d0, f.x1, f.d1, 0.9, (f.seed >> 7) & 0xffff);
  const dm = (f.d0 + f.d1) / 2, s = Math.max(0.35, detail(out, dm, 0.8));
  const rows = Math.max(3, Math.round((f.d1 - f.d0) / Math.max(1.0, s * 1.6)));
  const xa = Math.max(f.x0 + 0.6, ctx.x0), xb = Math.min(f.x1 - 0.6, ctx.x0 + ctx.length);
  for (let j = 0; j < rows; j++) {
    const d = f.d0 + (j + 0.5) * (f.d1 - f.d0) / rows;
    const st = s * 1.3;
    for (let wx = (Math.floor(xa / st) + 0.5) * st; wx < xb; wx += st) {
      if (wx < xa) continue;
      const y = W.H(wx, d), u = hh(Math.round(wx * 2), j, f.seed & 0xffff);
      const c = f.bare ? mix3([0.42, 0.32, 0.22], [0.34, 0.26, 0.19], u) : mix3([0.24, 0.42, 0.16], [0.32, 0.48, 0.2], u);
      out(wx - ctx.x0, y + 0.45, -d, s * 1.0, 0.3, Math.max(0.3, (f.d1 - f.d0) / rows * 0.32), c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      out(wx - ctx.x0, y + 0.05, -(d - (f.d1 - f.d0) / rows * 0.5), s * 1.0, 0.08, Math.max(0.22, (f.d1 - f.d0) / rows * 0.25), 0.3, 0.24, 0.18, 1, 0, 0, 0, 1, KIND.GROUND);
      if (out.due()) yield;
    }
  }
}
function hamletExtras(W, h) {
  if (h.extras) return h.extras;
  const r = makeRng(h.seed ^ 0x6a11), m = mood(W, h.wx);
  const e = { orchard: [], field: null, gate: null };
  const side = r() < 0.5 ? -1 : 1;
  if (r() < 0.45 + 0.35 * m.farm) {
    const ox = h.wx + side * (14 * h.houses.length + 20 + 25 * r()), od = h.d - 6 + 14 * r();
    const nt = 5 + Math.floor(r() * 8), white = r() < 0.3;
    for (let k = 0; k < nt; k++) {
      const tx = ox + ((k % 4) - 1.5) * 7 + (r() - 0.5) * 2, td = Math.max(45, od + (Math.floor(k / 4) - 1) * 7 + (r() - 0.5) * 2);
      e.orchard.push({ wx: tx, d: td, y: W.H(tx, td), h: 5.5 + 2.5 * r(), white: white || r() < 0.2, seed: hashInts(h.seed, 31, k) });
    }
  }
  if (r() < 0.55) {
    // beside the hamlet, on the gate's side and a little further down the slope than the houses
    const fw = 18 + 14 * r(), fdp = 10 + 8 * r();
    const fx = h.wx - side * (14 * h.houses.length + 10 + fw / 2 + 20 * r()), fd = Math.min(h.d + 16 + 10 * r(), bnAt(W, h.wx) - 20 - fdp / 2);
    const hit = (ax, ad, bx, bd) => Math.max(ax, bx) > fx - fw / 2 - 3 && Math.min(ax, bx) < fx + fw / 2 + 3 && Math.max(ad, bd) > fd - fdp / 2 - 3 && Math.min(ad, bd) < fd + fdp / 2 + 3;
    const clash = (h.mani && hit(h.mani.wx - h.mani.len / 2, h.mani.d, h.mani.wx + h.mani.len / 2, h.mani.d)) || h.walls.some((w) => hit(w[0], w[1], w[2], w[3]));
    if (!clash && fd - fdp / 2 > 42) e.field = { x0: fx - fw / 2, x1: fx + fw / 2, d0: fd - fdp / 2, d1: fd + fdp / 2, seed: hashInts(h.seed, 32), bare: r() < 0.3 };
  }
  if (r() < 0.4) {
    const gx = h.wx - side * (14 * h.houses.length + 30 + 15 * r()), gd = h.d - 12 + 6 * r();
    if (gd > 45) e.gate = { wx: gx, d: gd, yaw: (r() - 0.5) * 0.4, seed: hashInts(h.seed, 33) };
  }
  h.extras = e;
  return e;
}
function* hamletAdds(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 150) / HCELL), i1 = Math.floor((ctx.x0 + ctx.length + 150) / HCELL);
  for (let i = i0; i <= i1; i++) {
    const h = hamlet(W, i);
    if (!h || !inX(ctx, h.wx, 140)) continue;
    const e = hamletExtras(W, h);
    for (const t of e.orchard) if (inD(t.d, dLo, dHi) && inX(ctx, t.wx, 5)) yield* blossomTree(ctx, out, W, t);
    if (e.field && inD((e.field.d0 + e.field.d1) / 2, dLo, dHi) && e.field.x1 > ctx.x0 - 2 && e.field.x0 < ctx.x0 + ctx.length + 2) yield* potatoField(ctx, out, W, e.field);
    if (e.gate) yield* hamletGates(ctx, out, W, e, dLo, dHi);
  }
}
// A village school: a long single-storey building painted ochre, a walled yard in front with
// children in it in their maroon and blue, a flag pole.
const SHCELL = 3100;
function school(W, i) { return cache(W, 'sh', i, () => makeSchool(W, i)); }
function makeSchool(W, i) {
  const seed = hashInts(W.ws, 1651, i), r = makeRng(seed);
  const wx = (i + 0.2 + 0.6 * r()) * SHCELL;
  if (r() > 0.45 * mood(W, wx).farm) return null;
  const bn = bnAt(W, wx);
  const d = 65 + (Math.min(bn - 30, 170) - 65) * r();
  if (!nearFree(W, wx, d, 30)) return null;
  if (taken(W, 2, wx, d, 28)) return null;
  const sc = { i, wx, d, seed, w: 18 + 6 * r(), dep: 7, h: 4.2, yaw: (r() - 0.5) * 0.2, kids: [] };
  sc.base = minGround(W, sc); sc.top = GR.max;
  const n = 6 + Math.floor(r() * 10);
  for (let k = 0; k < n; k++) {
    const kx = wx + (r() - 0.5) * sc.w * 0.9, kd = d - sc.dep / 2 - 2 - 9 * r();
    sc.kids.push({ role: 'child', wx: kx, d: kd, y: W.H(kx, kd), yaw: r() * 6.3, ph: r(), col: r() < 0.5 ? [0.46, 0.1, 0.1] : [0.14, 0.24, 0.52], hat: null });
  }
  sc.kids.push({ role: 'herder', wx, d: d - sc.dep / 2 - 3, y: W.H(wx, d - sc.dep / 2 - 3), yaw: -Math.PI / 2, ph: 0.25, col: [0.2, 0.2, 0.3] });
  return sc;
}
function* schools(ctx, out, W, dLo, dHi) {
  for (let i = Math.floor((ctx.x0 - 60) / SHCELL); i <= Math.floor((ctx.x0 + ctx.length + 60) / SHCELL); i++) {
    const sc = school(W, i);
    if (!sc || !inX(ctx, sc.wx, 40)) continue;
    if (inD(sc.d, dLo, dHi) && inX(ctx, sc.wx, sc.w)) {
      const rng = makeRng(sc.seed);
      const y = Math.max(sc.base, sc.top - 1.4) - 0.3, s = sizeS(out, sc.d, 0.8);
      if (y > sc.base + 0.6) yield* plinth(out, sc.wx - ctx.x0, sc.d, sc.w, sc.dep, sc.yaw, sc.base - 0.6, y + 0.2, s, KIND.BUILDING, rng);
      yield* flatHouse(ctx, out, sc.wx - ctx.x0, sc.d, { w: sc.w, dep: sc.dep, h: sc.h, yaw: sc.yaw, wall: [0.74, 0.6, 0.3], y, s, rng, lit: litShare(ctx), salt: sc.seed & 0xffff });
      // the yard wall
      const yd = sc.d - sc.dep / 2 - 12;
      yield* stoneWall(ctx, out, W, sc.wx - sc.w / 2 - 2, yd, sc.wx + sc.w / 2 + 2, yd, 0.7, sc.seed & 0xffff);
      yield* flagPole(ctx, out, W, { wx: sc.wx + sc.w / 2 + 3, d: sc.d - sc.dep / 2 - 4, h: 8, seed: sc.seed, banner: true });
    }
    for (const m of sc.kids) if (inD(m.d, dLo, dHi) && inX(ctx, m.wx, 2)) yield* person(ctx, out, m.wx, m.y, m.d, m);
  }
}

// --- big birds: lammergeiers and griffon vultures circling on the updraughts ---
// A bird is a body, two long wings with a little dihedral and the bird banked into its turn, a
// wedge or fan tail and a head, about 1.3 times life size (a 3.5 m span). Wings are given some
// thickness so a bird seen almost edge-on is still a line with a body, not nothing.
const BDCELL = 900;
function birdFlock(W, i) { return cache(W, 'bd', i, () => makeBirds(W, i)); }
function makeBirds(W, i) {
  const seed = hashInts(W.ws, 1661, i), r = makeRng(seed);
  const wx = (i + 0.2 + 0.6 * r()) * BDCELL;
  if (r() > 0.4 * mood(W, wx).wild) return null;
  const d = 110 + 170 * r();
  const g = Math.max(W.H(wx, d), valleyAt(W.ws, wx).fy);
  const cy = Math.max(g + 25, 10) + 30 * r();
  const R = 14 + 22 * r(), n = 2 + Math.floor(r() * 4), sp = r() < 0.5 ? 1 : -1;
  const birds = [];
  for (let k = 0; k < n; k++) {
    const a = r() * 6.28;
    birds.push({ wx: wx + Math.cos(a) * R, d: d + Math.sin(a) * R * 0.7, y: cy + (r() - 0.5) * 14, yaw: a + sp * Math.PI / 2, bank: sp * (0.25 + 0.2 * r()), lam: r() < 0.4, flap: r() < 0.2 });
  }
  return { i, wx, d, y: cy, seed, birds };
}
function* bird(ctx, out, b) {
  out = flashOut(out);
  const k = 1.3, x0 = b.wx - ctx.x0;
  const q = quatMul(quatYaw(b.yaw), quatAxis(1, 0, 0, b.bank));
  // local frame: x forward, y up, z the span
  const R = (u, h, v) => {
    const t = [2 * (q[1] * v - q[2] * h), 2 * (q[2] * u - q[0] * v), 2 * (q[0] * h - q[1] * u)];
    return [u + q[3] * t[0] + (q[1] * t[2] - q[2] * t[1]), h + q[3] * t[1] + (q[2] * t[0] - q[0] * t[2]), v + q[3] * t[2] + (q[0] * t[1] - q[1] * t[0])];
  };
  const E = (u, h, v, rx, ry, rz, c, qq = q) => {
    const p = R(u * k, h * k, v * k);
    const fl = 0.0006 * b.d;
    out(x0 + p[0], b.y + p[1], -b.d + p[2], Math.max(rx * k, fl), Math.max(ry * k, fl), Math.max(rz * k, fl), c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], KIND.OTHER);
  };
  const wing = b.lam ? [0.2, 0.19, 0.18] : [0.34, 0.26, 0.18], wingD = b.lam ? [0.12, 0.11, 0.11] : [0.16, 0.12, 0.09];
  const body = b.lam ? [0.6, 0.42, 0.24] : [0.6, 0.52, 0.4];
  const th = Math.max(0.07, 0.0006 * b.d / k);
  const up = b.flap ? 0.45 : 0.12;
  for (const s of [1, -1]) {
    const qw = quatMul(q, quatAxis(1, 0, 0, -s * up));
    E(-0.02, 0.05 + up * 0.35, s * 0.62, 0.3, th, 0.58, s > 0 ? wing : mul3(wing, 0.9), qw);
    E(-0.12, 0.05 + up * 0.85, s * 1.3, 0.24, th * 0.9, 0.36, wingD, qw);
  }
  E(0, 0, 0, 0.42, 0.13, 0.14, body);
  E(0.48, 0.03, 0, 0.12, 0.09, 0.09, b.lam ? [0.66, 0.55, 0.42] : [0.72, 0.68, 0.6]);
  E(-0.6, 0, 0, 0.3, th * 0.8, b.lam ? 0.13 : 0.18, wingD);
  if (out.due()) yield;
}
function* birds(ctx, out, W, dLo, dHi) {
  for (let i = Math.floor((ctx.x0 - 60) / BDCELL); i <= Math.floor((ctx.x0 + ctx.length + 60) / BDCELL); i++) {
    const f = birdFlock(W, i);
    if (!f || !inX(ctx, f.wx, 60)) continue;
    for (const b of f.birds) if (inD(b.d, dLo, dHi) && inX(ctx, b.wx, 3)) yield* bird(ctx, out, b);
  }
}

// --- icefalls: frozen waterfalls hanging down cliff steps on the wall ---
// Traced down the fall line from a point high on a steep face: a curtain of pale blue-white ice
// fluted into columns, darker blue in the grooves, wider and bulging at the foot where it spreads.
const ICCELL = 1700;
function icefall(W, i) { return cache(W, 'ic', i, () => makeIcefall(W, i)); }
function makeIcefall(W, i) {
  const seed = hashInts(W.ws, 1671, i), r = makeRng(seed);
  const x0 = (i + 0.2 + 0.6 * r()) * ICCELL;
  if (r() > 0.55 * mood(W, x0).wild) return null;
  const s = 160 + 500 * r();
  // the steepest of a few spots along the cell at that height up the wall
  let best = null;
  for (let k = 0; k < 7; k++) {
    const wx = x0 + (k - 3) * 40, d = bfAt(W, wx) + s;
    const y = W.H(wx, d), y2 = W.H(wx, d - 8);
    const g = (y - y2) / 8;
    if (WL.sv > 0.2) continue;
    if (!best || g > best.g) best = { wx, d, y, g };
  }
  if (!best || best.g < 0.9) return null;
  const H = 50 + 90 * r(), w = 16 + 18 * r();
  // trace down: the falling ice clings to the face, so step down in distance until it has dropped H
  const pts = [];
  let d = best.d, y = best.y;
  for (let k = 0; k < 200 && best.y - y < H; k++) { pts.push([d, y]); d -= 2.5; y = W.H(best.wx, d); if (d < bfAt(W, best.wx) - 20) break; }
  if (pts.length < 6) return null;
  return { i, wx: best.wx, d: best.d, y: best.y, H: best.y - y, w, pts, seed };
}
function* icefalls(ctx, out, W, dLo, dHi) {
  for (let i = Math.floor((ctx.x0 - 60) / ICCELL); i <= Math.floor((ctx.x0 + ctx.length + 60) / ICCELL); i++) {
    const f = icefall(W, i);
    if (!f || !inX(ctx, f.wx, f.w + 5)) continue;
    const dm = f.pts[f.pts.length >> 1][0];
    if (!inD(dm, dLo, dHi)) continue;
    const s = Math.max(1.0, 0.0024 * dm);
    const np = f.pts.length, cols = Math.max(3, Math.round(f.w / (s * 1.2)));
    const stepK = Math.max(1, Math.round(s * 1.1 / 2.5));
    for (let k = 0; k < np; k += stepK) {
      const [d, y] = f.pts[k], t = k / (np - 1);
      const wid = f.w * (0.75 + 0.4 * t * t + 0.9 * smooth(0.75, 1, t));
      // the face's normal here (down the fall line it leans back toward the camera)
      const [d2, y2] = f.pts[Math.min(np - 1, k + 1)];
      const nn = norm3(0, d - d2, y - y2 + 1e-3);
      const qq = quatUpTo(0, nn[1], nn[2]);
      const seg = Math.hypot(d - d2, y - y2) * stepK;
      for (let c = 0; c < cols; c++) {
        const a = (c + 0.5) / cols - 0.5;
        const fl = hh(c, f.seed & 0xffff, 5), groove = (c % 2) ? 0.78 : 1;
        if (Math.abs(a) > 0.42 && hh(c, k, f.seed & 0xffff) < 0.4 + 0.5 * (1 - t)) continue;   // ragged edges
        const col = mul3(mix3([0.78, 0.8, 0.8], [0.52, 0.66, 0.76], fl * 0.5 + (1 - groove)), groove);
        const cs = shade(col, 0, nn[1], nn[2], 0.75, 0.3);
        const wx = f.wx + a * wid, gy = W.H(wx, d), off = Math.max(2, 0.006 * d);
        out(wx - ctx.x0, Math.max(gy, y) + off * 0.5, -(d - off), wid / cols * 0.75, s * 0.18, Math.max(s, seg * 0.75), cs[0], cs[1], cs[2], 1, qq[0], qq[1], qq[2], qq[3], KIND.GROUND);
      }
      if (out.due()) yield;
    }
  }
}

// --- hanging glaciers on the great peaks (far band): icefalls hundreds of metres wide ---
// From below a giant's summit, down its face toward the window: blue-grey ice broken by dark
// transverse crevasse bands, which sets it apart from the white snow round it.
// Placed per 2600 m cell on whichever peak of the range stands highest in the window there, and
// only where enough of it shows above the crest of the wall.
const HGCELL = 2600;
function hangingIce(W, i) {
  return cache(W, 'hg', i, () => {
    const r = makeRng(hashInts(W.ws, 1721, i));
    if (r() > 0.7) return null;
    const x = (i + 0.2 + 0.6 * r()) * HGCELL;
    let occ = -1;
    for (const dd of [500, 800, 1150, 1550, 2000, 2450, 2900]) occ = Math.max(occ, (W.H(x, dd) - 2.6) / dd);
    let best = -1, bd = 0;
    for (let d = 3200; d <= 8000; d += 160) { const e = (W.H(x, d) - 2.6) / d; if (e > best) { best = e; bd = d; } }
    if (best < occ + 0.05) return null;
    const w = 240 + 260 * r(), drop = 450 + 450 * r();
    let d = bd - 80, y = W.H(x, d);
    // (the tops can stand above the window: start where the face comes into view)
    while ((y - 2.6) / d > 0.42 && d > 3400) { d -= 40; y = W.H(x, d); }
    const y0 = y, pts = [];
    for (let k = 0; k < 120 && y0 - y < drop && d > 3300 && (y - 2.6) / d > occ + 0.015; k++) { pts.push([d, y]); d -= 40; y = W.H(x, d); }
    if (pts.length < 6 || (y0 - y) / (pts.length * 40) < 0.3) return null;
    return { wx: x, w, pts, seed: hashInts(W.ws, 1722, i) };
  });
}
function* hangingGlaciers(ctx, out, W, dLo, dHi) {
  for (let i = Math.floor((ctx.x0 - 600) / HGCELL); i <= Math.floor((ctx.x0 + ctx.length + 600) / HGCELL); i++) {
    {
      const f = hangingIce(W, i);
      if (!f || !inX(ctx, f.wx, f.w)) continue;
      const np = f.pts.length;
      for (let k = 0; k < np; k++) {
        const [d, y] = f.pts[k], t = k / (np - 1);
        if (!inD(d, dLo, dHi)) continue;
        const s = Math.max(12, 0.0026 * d), off = 0.012 * d;
        const [d2, y2] = f.pts[Math.min(np - 1, k + 1)];
        const nn = norm3(0, Math.max(1, d - d2), y - y2 + 1e-3);
        const qq = quatUpTo(0, nn[1], nn[2]);
        const seg = Math.hypot(d - d2, y - y2);
        // a tongue: narrow where it pours from the basin, broad below, rounded at the snout, and
        // wandering a little from side to side
        const wid = f.w * (0.3 + 0.7 * Math.sqrt(Math.sin(Math.PI * Math.min(1, 0.15 + t * 0.95))));
        const cx = f.wx + 0.12 * f.w * Math.sin(t * 5 + (f.seed & 7));
        const cols = Math.max(3, Math.round(wid / (s * 1.3)));
        const crev = hh(k, f.seed & 0xffff, 3) < 0.28;
        for (let c = 0; c < cols; c++) {
          const a = (c + 0.5) / cols - 0.5;
          if (Math.abs(a) > 0.36 && hh(c, k, f.seed & 0xffff) < 0.55) continue;   // ragged edges
          const wx = cx + a * wid + (hh(c, k, 9) - 0.5) * s * 0.6;
          let col = crev ? [0.36, 0.42, 0.5] : mix3([0.6, 0.69, 0.77], [0.72, 0.76, 0.8], hh(c, k, f.seed & 0xffff));
          col = shade(col, 0, nn[1], nn[2], 0.7, 0.35);
          const edge = Math.abs(a) > 0.3 ? 0.6 : 1;
          out(wx - ctx.x0, y + off * 0.4, -(d - off), wid / cols * 0.8, s * 0.2, Math.max(s, seg * 0.8), col[0], col[1], col[2], edge, qq[0], qq[1], qq[2], qq[3], KIND.GROUND);
        }
        if (out.due()) yield;
      }
    }
  }
}

// --- turquoise glacial lakes on the valley floor, held behind a moraine ---
const LKCELL = 2900;
function lake(W, i) { return cache(W, 'lk', i, () => makeLake(W, i)); }
function makeLake(W, i) {
  const seed = hashInts(W.ws, 1681, i), r = makeRng(seed);
  const x0 = (i + 0.2 + 0.6 * r()) * LKCELL;
  if (r() > 0.6 * mood(W, x0).wild) return null;
  // where the floor between the river and the wall is widest (a gully mouth)
  let best = null;
  for (let k = 0; k < 9; k++) {
    const wx = x0 + (k - 4) * 60, v = valleyAt(W.ws, wx), bf = v.bf, foot = footAt(W.ws, wx);
    if (!best || foot - bf > best.room) best = { wx, bf, room: foot - bf };
  }
  if (best.room < 150) return null;
  const rz = Math.min(45, (best.room - 70) / 2) * (0.7 + 0.3 * r()), rx = rz * (1.4 + 0.8 * r());
  const d = best.bf + 35 + rz;
  // the water level: just above the highest ground inside the inner two thirds, so it lies flat
  let lvl = -Infinity;
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
    if (a * a / 4 + b * b / 4 > 1) continue;
    lvl = Math.max(lvl, W.H(best.wx + a * rx * 0.33, d + b * rz * 0.33));
  }
  if (lvl > valleyAt(W.ws, best.wx).fy + 30) return null;
  return { i, wx: best.wx, d, rx, rz, y: lvl + 0.4, seed };
}
function* lakes(ctx, out, W, dLo, dHi) {
  for (let i = Math.floor((ctx.x0 - 300) / LKCELL); i <= Math.floor((ctx.x0 + ctx.length + 300) / LKCELL); i++) {
    const L = lake(W, i);
    if (!L || !inX(ctx, L.wx, L.rx + 10) || L.d + L.rz < dLo || L.d - L.rz * 1.3 >= dHi) continue;
    // (sizes and grid from the lake alone, never from the band: it straddles the near-mid border)
    const s = Math.max(0.9, 0.0035 * L.d);
    const sz = s * 0.55;     // seen at a low angle: the step in distance can be coarser than along x
    const sd = s * 2.2;
    for (let dd = -L.rz + sd * 0.5; dd <= L.rz; dd += sd) {
      const d = L.d + dd;
      if (!inD(d, dLo, dHi)) continue;
      const half = L.rx * Math.sqrt(Math.max(0, 1 - (dd / L.rz) ** 2)) * (0.92 + 0.08 * Math.sin(dd * 0.3 + L.seed));
      const xa = Math.max(L.wx - half, ctx.x0 - 1), xb = Math.min(L.wx + half, ctx.x0 + ctx.length + 1);
      const st = s * 1.25;
      for (let wx = (Math.floor(xa / st) + 0.5) * st; wx < xb; wx += st) {
        if (wx < xa) continue;
        const e = Math.hypot((wx - L.wx) / L.rx, dd / L.rz);
        const c0 = e > 0.86 ? [0.42, 0.66, 0.64] : mix3([0.12, 0.5, 0.56], [0.2, 0.6, 0.62], e);
        const c = mul3(mix3(c0, [0.6, 0.72, 0.76], smooth(0.8, 0.95, noise2(wx / 30, d / 6, L.seed & 0xffff)) * 0.4), 0.97 + 0.06 * hh(Math.round(wx), Math.round(d), 7));
        out(wx - ctx.x0, L.y, -d, s * 0.9, 0.04, sd * 0.62 + sz * 0.2, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
        if (out.due()) yield;
      }
    }
    // the moraine dam along the near shore, and a few boulders round the rest
    const nb = Math.round(clamp(L.rx * 2 / Math.max(2, s * 2.2), 6, 120));
    for (let k = 0; k < nb; k++) {
      const h1 = hh(k, L.seed & 0xffff, 41), h2 = hh(k, L.seed & 0xffff, 42), h3 = hh(k, L.seed & 0xffff, 43);
      const a = Math.PI + (k + h1) / nb * Math.PI;     // the near half
      const bx = L.wx + Math.cos(a) * L.rx * 1.04, bd = L.d + Math.sin(a) * L.rz * 1.08;
      if (!inD(bd, dLo, dHi) || !inX(ctx, bx, 3)) continue;
      const rr = Math.max(1.2, s * 1.3) * (0.7 + 0.6 * h2);
      const by = Math.max(W.H(bx, bd), L.y - 0.5);
      const c = mix3(C.scree, C.stoneDark, h3 * 0.6);
      // a boulder of the moraine: kit facetRock() (it was one soft splat), kept cheap: there are many
      facetRock(out, bx - ctx.x0, by, bd, rr * 1.4, rr * 0.9, rr, { color: c, rng: makeRng(hashInts(L.seed, 44, k)), n: 40, cracks: 0, seat: false });
      if (out.due()) yield;
    }
  }
}

// --- a ruined fort (dzong) on a spur: broken walls round a court, crumbling towers ---
const FTCELL = 5300;
function fort(W, i) { return cache(W, 'ft', i, () => makeFort(W, i)); }
function makeFort(W, i) {
  const seed = hashInts(W.ws, 1691, i), r = makeRng(seed);
  if (r() > 0.6) return null;
  const s = 110 + 260 * r();
  let best = -1, bx = 0;
  for (let k = 0; k < 9; k++) {
    const wx = (i + 0.15 + 0.7 * k / 8) * FTCELL, sp = spurOf(W.ws, wx, s);
    if (sp > best) { best = sp; bx = wx; }
  }
  for (let k = Math.floor(bx / VCELL) - 1; k <= Math.floor(bx / VCELL) + 1; k++) { const v = village(W, k); if (v && Math.abs(v.cx - bx) < v.R + 220) return null; }
  for (let k = Math.floor(bx / MCELL) - 1; k <= Math.floor(bx / MCELL) + 1; k++) { const g = gompa(W, k); if (g && Math.abs(g.wx - bx) < 260) return null; }
  const d = bfAt(W, bx) + s;
  const f = { i, wx: bx, d, seed, yaw: (r() - 0.5) * 0.3, w: 60 + 30 * r(), dep: 34 + 14 * r(), parts: [] };
  // the curtain walls and the towers at the corners (one gone), and a tall keep
  const [ex, ez] = rotY(1, 0, f.yaw), [fx, fz] = rotY(0, 1, f.yaw);
  const at = (lx, lz) => [bx + ex * lx + fx * lz, d - (ez * lx + fz * lz)];
  const walls = [[0, f.dep / 2, f.w, 3, 0], [0, -f.dep / 2, f.w, 3, 0], [-f.w / 2, 0, 3, f.dep, 0], [f.w / 2, 0, 3, f.dep, 0]];
  for (const [lx, lz, w, dep] of walls) { const [px, pd] = at(lx, lz); f.parts.push({ wx: px, d: pd, w, dep, h: 9 + 5 * r(), rag: 0.55, seed: hashInts(seed, 1, f.parts.length) }); }
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    if (r() < 0.2) continue;
    const [px, pd] = at(a * f.w / 2, b * f.dep / 2);
    f.parts.push({ wx: px, d: pd, w: 9, dep: 9, h: 16 + 8 * r(), rag: 0.3, seed: hashInts(seed, 2, f.parts.length) });
  }
  const [kx, kd] = at((r() - 0.5) * f.w * 0.4, -f.dep * 0.15);
  f.parts.push({ wx: kx, d: kd, w: 16, dep: 13, h: 26 + 8 * r(), rag: 0.25, seed: hashInts(seed, 3) });
  for (const p of f.parts) { p.base = minGround(W, { ...p, yaw: f.yaw }); p.top = GR.max; }
  return f;
}
function* forts(ctx, out, W, dLo, dHi) {
  for (let i = Math.floor((ctx.x0 - 200) / FTCELL); i <= Math.floor((ctx.x0 + ctx.length + 200) / FTCELL); i++) {
    const f = fort(W, i);
    if (!f || !inX(ctx, f.wx, f.w + 20)) continue;
    const earth = [0.58, 0.49, 0.38];
    for (const p of f.parts) {
      if (!inD(p.d, dLo, dHi) || !inX(ctx, p.wx, p.w + 2)) continue;
      const rng = makeRng(p.seed), s = sizeS(out, p.d, 0.75);
      const sunk = p.top - p.base, y = p.base - 0.5, H = p.h + sunk;
      // the top broken off along its length in steps and notches
      // (steps of 9 m or more: finer notches break up into loose splats at this range)
      const rag = (f2, a) => 1 - p.rag * (hh(Math.floor(a * Math.max(p.w, p.dep) / Math.max(9, s * 8)), f2 & 1, p.seed & 0xffff) ** 1.5);
      yield* box(out, p.wx - ctx.x0, y, p.d, p.w, p.dep, H, f.yaw, s, (fc, a, b, nx, nz) => {
        if (fc === 4) return null;
        if (b > rag(fc, a)) return null;
        const yy = b * H;
        // holes: windows and slots, and pale patches where the plaster survives
        // a few big dark openings (windows and breaches) on the towers and keep only
        const ncol = Math.max(1, Math.round(Math.max(p.w, p.dep) / 6));
        if (p.rag < 0.5 && yy > sunk + 4 && (Math.floor(yy / 6) % 2) === 1 && Math.abs((a * ncol) % 1 - 0.5) < 0.2 && hh(Math.floor(a * ncol), Math.floor(yy / 6), (p.seed >> 4) & 0xffff) < 0.6) return [0.12, 0.1, 0.09];
        const pl = noise2(a * 2, b * 1.5, p.seed & 0xffff) > 0.62 ? mix3(earth, C.white, 0.45) : earth;
        return jitter(faceTone(mix3(pl, C.stoneDark, 0.3 * (1 - b)), nx, nz), rng, 0.07);
      }, KIND.BUILDING, rng);
      // rubble heaped at the foot
      const nr = 4 + Math.round(p.w / 4);
      for (let k = 0; k < nr; k++) {
        const ox = (rng() - 0.5) * p.w * 1.1, oz = p.dep / 2 + 1 + 2 * rng();
        const [rx2, rz2] = rotY(ox, oz, f.yaw);
        const gx = p.wx + rx2, gd = p.d - rz2;
        const rr = Math.max(1.0, s * 1.4) * (0.8 + 0.8 * rng());
        const c = jitter(mix3(earth, C.stoneDark, 0.4), rng, 0.1);
        out(gx - ctx.x0, W.H(gx, gd) + rr * 0.3, -gd, rr * 1.3, rr * 0.6, rr, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.BUILDING);
      }
      if (out.due()) yield;
    }
  }
}

// --- snowfall: in some stretches a light fall of small flakes drifts past the window ---
// Round splats tagged MOVE.FALL, scattered evenly through the slab of air the shader wraps them in
// (3.4 m below rail level to 12.6 m above), each at its own distance. Few and small.
function snowAmt(W, wx) { return smooth(0.56, 0.75, noise1(wx / 2700, W.ws + 1711)) * (0.5 + 0.5 * mood(W, wx).wild) * (1 - 0.85 * valleyAt(W.ws, wx).lu); }
function* snowfall(ctx, out, W, dLo, dHi, perM2) {
  const xm = ctx.x0 + ctx.length / 2;
  const a = Math.max(snowAmt(W, ctx.x0), snowAmt(W, xm), snowAmt(W, ctx.x0 + ctx.length));
  if (a <= 0.01) return;
  const rng = ctx.rng;
  const n = Math.round(perM2 * a * ctx.length * (dHi - dLo) * Math.sqrt(out.density));
  for (let i = 0; i < n; i++) {
    const x = rng() * ctx.length, d = dLo + rng() * (dHi - dLo), y = -3.4 + 16 * rng();
    if (rng() > snowAmt(W, ctx.x0 + x) / a) continue;
    const r = Math.max(0.04, 0.0018 * d) * (0.7 + 0.6 * rng());
    out(x, y, -d, r, r, r, 0.8, 0.8, 0.8, 0.85, 0, 0, 0, 1, KIND.OTHER, MOVE.FALL);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Level 1
// ---------------------------------------------------------------------------------------------
// Scale: a giant yak standing on a spur of the wall, a few hundred metres up.
const GYCELL = 6500;
function* giantYaks(ctx, out, W, dLo, dHi, amount) {
  for (const { i, wx0 } of cellsAround(ctx, GYCELL, 400)) {
    const r = worldRng(ctx, 1401, i);
    if (r() > 0.7 * amount) continue;
    const wx = wx0 + GYCELL * (0.2 + 0.6 * r());
    const s = 300 + 260 * r();
    const d = bfAt(W, wx) + s;
    if (!inD(d, dLo, dHi)) continue;
    const k = 85 + 50 * r();
    yield* yak(ctx, out, wx, W.H(wx, d) - 2, d, { yaw: r() < 0.5 ? 0.15 : Math.PI - 0.15, k, col: YAKS[Math.floor(r() * 3)], graze: r() < 0.4, tassel: true, blanket: r() < 0.5, white: false, kind: KIND.SURREAL });
  }
}
// Scale: strings of flags the size of houses, crossing the valley from a pole near the line to
// the facing slope. Drawn piecewise by the near and mid bands.
const GSCELL = 2600;
function* giantStrings(ctx, out, W, dLo, dHi, amount) {
  for (const { i, wx0 } of cellsAround(ctx, GSCELL, 900)) {
    const r = worldRng(ctx, 1411, i);
    if (r() > 0.75 * amount) continue;
    const ax = wx0 + GSCELL * r(), ad = 70 + 60 * r();
    const bx = ax + (r() - 0.5) * 900, bd = bfAt(W, bx) + 150 + 250 * r();
    const A = [ax, W.H(ax, ad) + 26, ad], B = [bx, W.H(bx, bd) + 40, bd];
    if (inD(ad, dLo, dHi)) yield* flagPole(ctx, out, W, { wx: ax, d: ad, h: 27, seed: i }, KIND.SURREAL);
    if (inD(bd, dLo, dHi)) yield* flagPole(ctx, out, W, { wx: bx, d: bd, h: 41, seed: i + 1 }, KIND.SURREAL);
    yield* flagString(ctx, out, { a: A, b: B, sag: 0.03, seed: hashInts(W.ws, 1412, i), fw: 5, scale: 1 }, dLo, dHi, KIND.SURREAL);
  }
}
// Topology: strings of flags rising from the monasteries into the sky to the summits, and running
// from summit to summit. Drawn piecewise by the mid and far bands.
function* skyStrings(ctx, out, W, dLo, dHi, amount) {
  const i0 = Math.floor((ctx.x0 - 14000) / MCELL), i1 = Math.floor((ctx.x0 + ctx.length + 14000) / MCELL);
  for (let i = i0; i <= i1; i++) {
    const g = gompa(W, i);
    if (!g || hh(i, 3, W.ws + 7) > 0.8 * amount) continue;
    const gi = Math.round(g.wx / GCELLX);
    let best = null;
    for (let k = gi - 1; k <= gi + 1; k++) { const gg = giant(W.ws, k); if (gg && (!best || Math.abs(gg.wx - g.wx) < Math.abs(best.wx - g.wx))) best = gg; }
    if (!best) continue;
    const s = giantSummit(W, best);
    yield* flagString(ctx, out, { a: [g.wx, g.y + g.main.h + 3, g.d], b: [s[0], s[1] + 20, s[2]], sag: 0.012, seed: hashInts(W.ws, 1421, i), fw: 0.8, fade: 0 }, dLo, dHi, KIND.SURREAL);
  }
  const j0 = Math.floor((ctx.x0 - 26000) / GCELLX), j1 = Math.floor((ctx.x0 + ctx.length + 26000) / GCELLX);
  for (let j = j0; j <= j1; j++) {
    const g1 = giant(W.ws, j);
    if (!g1 || hh(j, 4, W.ws + 7) > 0.8 * amount) continue;
    let g2 = null;
    for (let k = j + 1; k <= j + 2 && !g2; k++) g2 = giant(W.ws, k);
    if (!g2) continue;
    const s1 = giantSummit(W, g1), s2 = giantSummit(W, g2);
    yield* flagString(ctx, out, { a: [s1[0], s1[1] + 20, s1[2]], b: [s2[0], s2[1] + 20, s2[2]], sag: 0.05, seed: hashInts(W.ws, 1422, j), fw: 1, fade: 0 }, dLo, dHi, KIND.SURREAL);
  }
}
// Logic: the same chorten by the line every 330 m in repeating stretches, each copy more wrong
// (a taller spire, a growing lean, the white drifting gold).
function* repeatingChorten(ctx, out, W, logic) {
  const Pc = 330;
  for (const { i, wx0 } of cellsAround(ctx, Pc, 20)) {
    if (noise1(wx0 / 4200, W.ws + 1431) > 0.3 + logic) continue;
    const wrong = ((((i % 5) + 5) % 5) / 4) * logic * 2.5;
    const wx = wx0 + Pc * 0.5, d = 72;
    if (!inX(ctx, wx, 8)) continue;
    const rng = worldRng(ctx, 1432);
    yield* chorten(ctx, out, wx - ctx.x0, d, 6.5 * (1 + 0.3 * wrong), { y: W.H(wx, d), s: sizeS(out, d, 0.8), rng, kind: KIND.SURREAL, lean: wrong * 0.5, spire: 1 + wrong * 1.2, gold: Math.min(1, wrong), white: mix3(C.white, [0.78, 0.66, 0.5], Math.min(1, wrong * 0.6)) });
  }
}

// ---------------------------------------------------------------------------------------------
// Vegetation: firs and blue pines, birches, poplars and willows in leaf, rhododendron and juniper
// ---------------------------------------------------------------------------------------------
// A fir or a blue pine: a straight trunk and whorls of drooping boughs narrowing to a point, every
// whorl lit on its sunward (-x) side and dark on the other, so it holds from any side.
//   t: { wx, d, y, h, w, col, seed }; lod 0 near (whorls of five boughs), 1 middle distance (three),
//   2 far (a spindle of two or three splats)
function* fir(ctx, out, t, lod, kind = KIND.TREE) {
  const x = t.wx - ctx.x0, d = t.d, y = t.y - 0.3, H = t.h, Wd = t.w, c = t.col;
  if (lod >= 2) {
    const k = 0.9 + 0.25 * hh(t.seed | 0, 1, 5);
    out(x, y + H * 0.36, -d, Wd * 0.46, H * 0.3, Wd * 0.46, c[0] * 0.85 * k, c[1] * 0.85 * k, c[2] * 0.85 * k, 1, 0, 0, 0, 1, kind);
    out(x - Wd * 0.06, y + H * 0.7, -d, Wd * 0.25, H * 0.26, Wd * 0.25, c[0] * 1.1 * k, c[1] * 1.1 * k, c[2] * 1.1 * k, 1, 0, 0, 0, 1, kind);
    if (d < 800) out(x - Wd * 0.22, y + H * 0.42, -(d - Wd * 0.2), Wd * 0.22, H * 0.24, Wd * 0.2, c[0] * 1.7 * k + 0.02, c[1] * 1.55 * k + 0.02, c[2] * 1.3 * k, 1, 0, 0, 0, 1, kind);
    return;
  }
  const r = makeRng(t.seed);
  const tr = Math.max(0.15, H * 0.011, 0.0007 * d);
  strut(out, x, y, -d, x, y + H * 0.34, -d, tr, [0.25, 0.2, 0.16], 2, 1, kind);
  const tiers = t.tiers || (lod ? clamp(Math.round(H / 5), 3, 5) : clamp(Math.round((H / 2.8) * Math.min(1, Math.sqrt(out.density) + 0.15)), 4, 10));
  const lobes = lod ? 3 : 5;
  for (let i = 0; i < tiers; i++) {
    const f = (i + 0.5) / tiers;
    const th = (H * 0.84) / tiers, ty = y + H * 0.15 + H * 0.84 * f, tw = Wd * 0.5 * (1 - 0.88 * f) + 0.12;
    const up = 0.78 + 0.34 * f;
    out(x, ty, -d, tw * 0.6, th * 0.52, tw * 0.6, c[0] * 0.6 * up, c[1] * 0.6 * up, c[2] * 0.6 * up, 1, 0, 0, 0, 1, kind);
    const a0 = r() * 6.28;
    for (let j = 0; j < lobes; j++) {
      // (at middle distance: one bough to the sun, one to the camera, one to the shade)
      const a = lod ? [Math.PI, Math.PI / 2, 0][j] + (r() - 0.5) * 0.7 : a0 + (j * 6.28) / lobes;
      const ca = Math.cos(a), sa = Math.sin(a);
      const lk = up * (1.08 + 0.95 * Math.max(0, -ca) - 0.2 * Math.max(0, ca) + 0.22 * Math.max(0, sa)) * (0.88 + 0.24 * r());
      out(x + ca * tw * 0.58, ty - th * 0.2, -d + sa * tw * 0.58, tw * 0.42, th * 0.3, tw * 0.42, c[0] * lk + 0.012 * Math.max(0, -ca), c[1] * lk + 0.012 * Math.max(0, -ca), c[2] * lk, 1, 0, 0, 0, 1, kind);
    }
    if (out.due()) yield;
  }
  out(x, y + H * 1.0, -d, Math.max(0.1, tr * 0.7), H * 0.045, Math.max(0.1, tr * 0.7), c[0] * 1.2, c[1] * 1.2, c[2] * 1.2, 1, 0, 0, 0, 1, kind);
}
// A birch: a tall white stem and a light, fresh-green crown.
function* birch(ctx, out, t, lod, kind = KIND.TREE) {
  const x = t.wx - ctx.x0, d = t.d, y = t.y - 0.2, H = t.h, cw = t.w, c = t.col || C.birch;
  const tr = Math.max(0.13, H * 0.014, 0.0007 * d);
  if (lod >= 2) {
    strut(out, x, y, -d, x, y + H * 0.6, -d, tr, C.birchBark, 1, 1, kind);
    const k = 0.9 + 0.25 * hh(t.seed | 0, 1, 5);
    out(x, y + H * 0.68, -d, cw * 0.34, H * 0.25, cw * 0.34, c[0] * 0.8 * k, c[1] * 0.8 * k, c[2] * 0.8 * k, 1, 0, 0, 0, 1, kind);
    out(x - cw * 0.16, y + H * 0.76, -(d - cw * 0.15), cw * 0.2, H * 0.16, cw * 0.2, c[0] * 1.12 * k, c[1] * 1.1 * k, c[2] * k, 1, 0, 0, 0, 1, kind);
    return;
  }
  const r = makeRng(t.seed);
  // the stem leans a little; pale, with dark bands
  const lx = (r() - 0.5) * 0.1 * H, top = H * 0.78;
  strut(out, x, y, -d, x + lx, y + top, -d, tr, C.birchBark, lod ? 3 : 5, 1, kind);
  if (!lod) for (let k = 0; k < 3; k++) { const f = 0.12 + 0.5 * r(); out(x + lx * f, y + top * f, -d + tr * 0.5, tr * 1.05, tr * 0.5, tr * 0.6, 0.17, 0.15, 0.13, 1, 0, 0, 0, 1, kind); }
  // the crown: an open, ragged oval of small lumps hung about the upper stem (a ball of big ones
  // made a lollipop)
  const lumps = t.tiers ? 3 : lod ? 5 : 10, n = t.tiers ? 3 : lod ? 5 : Math.round(clamp(treeSplats2(out, d, cw) * 0.14, 7, 12));
  for (let k = 0; k < lumps; k++) {
    const a = k * 2.4 + r(), f = (k + 0.3 + 0.6 * r()) / lumps;
    const bulge = Math.sin(Math.PI * (0.12 + 0.8 * f)), rr = cw * (lod ? 0.17 + 0.1 * r() : 0.13 + 0.09 * r()) * (0.7 + 0.5 * bulge);
    const off = cw * 0.3 * bulge * (0.5 + 0.6 * r());
    yield* blob(ctx, out, x + lx * (0.5 + 0.5 * f) + Math.cos(a) * off, y + H * (0.4 + 0.58 * f) - rr * 0.2, d + Math.sin(a) * off * 0.8, rr, rr * 1.05, rr, { n, color: jitter(c, r, 0.16), rng: r, kind, inner: 0.35, amb: 0.6, clump: 0.8 });
  }
}
// A poplar in leaf (a tall narrow column) or a willow (a round, drooping crown): the trees of the
// village lanes where the valley is lush enough for leaves.
function* leafTree(ctx, out, W, t, kind = KIND.TREE) {
  const x = t.wx - ctx.x0, d = t.d, y = W.H(t.wx, d) - 0.2, H = t.h;
  const c = t.willow ? C.willow : C.poplar;
  if (d > 300) {
    // (a stem, a dark body and a lit flank: two pale soft splats alone read as a green smudge)
    const cw = Math.max(t.willow ? H * 0.3 : H * 0.13, 0.0013 * d), k = 0.9 + 0.2 * hh(t.seed | 0, 2, 5);
    strut(out, x, y, -d, x, y + H * 0.4, -d, Math.max(0.18, 0.0007 * d), C.bark, 1, 1, kind);
    out(x, y + H * 0.6, -d, cw, H * (t.willow ? 0.26 : 0.36), cw, c[0] * 0.66 * k, c[1] * 0.7 * k, c[2] * 0.66 * k, 1, 0, 0, 0, 1, kind);
    out(x - cw * 0.4, y + H * 0.64, -(d - cw * 0.3), cw * 0.5, H * (t.willow ? 0.17 : 0.26), cw * 0.5, c[0] * 1.05 * k, c[1] * 1.05 * k, c[2] * 0.95 * k, 1, 0, 0, 0, 1, kind);
    return;
  }
  const r = makeRng(t.seed);
  const tr = Math.max(0.16, 0.0007 * d);
  strut(out, x, y, -d, x, y + H * 0.35, -d, tr, C.bark, 2, 1, kind);
  if (t.willow) {
    const R = H * 0.34, n = Math.round(clamp(treeSplats2(out, d, R * 2) * 0.25, 8, 22));
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * 6.28 + r();
      yield* blob(ctx, out, x + Math.cos(a) * R * 0.45, y + H * 0.62 + (r() - 0.5) * R * 0.3, d + Math.sin(a) * R * 0.35, R * 0.62, R * 0.7, R * 0.6, { n, color: jitter(c, r, 0.1), rng: r, kind, inner: 0.35, amb: 0.64, clump: 0.7 });
    }
    return;
  }
  const cw = H * 0.11 + 0.5, n = Math.round(clamp(treeSplats2(out, d, cw * 2) * 0.5, 6, 16));
  for (let k = 0; k < 4; k++) {
    const f = (k + 0.5) / 4, rw = cw * (0.75 + 0.5 * Math.sin(Math.PI * (0.15 + 0.75 * f)));
    yield* blob(ctx, out, x + (r() - 0.5) * 0.4, y + H * (0.2 + 0.74 * f), d, rw, H * 0.15, rw, { n, color: jitter(c, r, 0.1), rng: r, kind, inner: 0.35, amb: 0.64, clump: 0.6 });
  }
}
// A rhododendron: a dark, glossy, rounded bush, with trusses of flowers over its top and the side
// toward the window when in bloom. b: { wx, d, w, h, bloom (index into BLOOM, or -1), seed }
function* rhodo(ctx, out, W, b, kind = KIND.HEDGE) {
  const x = b.wx - ctx.x0, y = W.H(b.wx, b.d), r = makeRng(b.seed);
  const n = Math.round(clamp(treeSplats2(out, b.d, b.w) * 0.45, 5, 24));
  yield* blob(ctx, out, x, y + b.h * 0.4, b.d, b.w / 2, b.h * 0.58, b.w * 0.42, { n, color: b.col || C.rhodo, rng: r, kind, inner: 0.4, amb: 0.55, clump: 0.6 });
  if (b.bloom < 0) return;
  const bc = BLOOM[b.bloom], m = Math.round(clamp(n * 1.1, 7, 22)), s0 = Math.max(0.2, b.w * 0.095, 0.0026 * b.d);
  for (let k = 0; k < m; k++) {
    let ux = r() * 2 - 1, uy = 0.1 + 0.9 * r(), uz = r() * 1.7 - 0.6;
    const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    const sz = s0 * (0.8 + 0.5 * r()), kk = (0.78 + 0.3 * uy) * (0.9 + 0.2 * r());
    out(x + ux * b.w * 0.5, y + b.h * 0.4 + uy * b.h * 0.6, -(b.d - uz * b.w * 0.42), sz, sz * 0.8, sz, bc[0] * kk, bc[1] * kk, bc[2] * kk, 1, 0, 0, 0, 1, kind);
  }
}

// Would something tall at (wx, d), rad metres across, stand in front of (or on top of) one of the
// things a viewer is meant to see on the near slope? Trees stand behind or beside the hamlets,
// herds, shrines, camps and paths, never between them and the window. low: a bush, which only has
// to keep off them.
function veiled(W, wx, d, rad, low = false) {
  const B = (cd, m) => (low ? Math.abs(d - cd) < m * 0.5 : d < cd + m);
  for (let i = Math.floor((wx - 220) / HCELL); i <= Math.floor((wx + 220) / HCELL); i++) { const h = hamlet(W, i); if (h && Math.abs(h.wx - wx) < 95 + rad && B(h.d, 34)) return true; }
  for (let i = Math.floor((wx - 90) / FCELL); i <= Math.floor((wx + 90) / FCELL); i++) { const f = flagSite(W, i); if (f && Math.abs(f.wx - wx) < 42 + rad && B(f.d, 22)) return true; }
  for (let i = Math.floor((wx - 90) / YCELL); i <= Math.floor((wx + 90) / YCELL); i++) { const g = herd(W, i); if (g && Math.abs(g.wx - wx) < 36 + rad && B(g.d, 20)) return true; }
  for (let i = Math.floor((wx - 70) / SCELL); i <= Math.floor((wx + 70) / SCELL); i++) { const g = sheepGroup(W, i); if (g && Math.abs(g.wx - wx) < 24 + rad && B(g.d, 16)) return true; }
  for (const c of claimsBefore(W, 4, wx - rad, wx + rad)) if (Math.abs(c.wx - wx) < c.r + rad + 8 && B(c.d, c.r * 0.6 + 12)) return true;
  for (let i = Math.floor((wx - 200) / CVCELL); i <= Math.floor((wx + 200) / CVCELL); i++) { const c = caravan(W, i); if (c && wx > c.path.xa - rad && wx < c.path.xb + rad && B(pathD(c.path, clamp(wx, c.path.xa, c.path.xb)), low ? 10 : 14)) return true; }
  for (let i = Math.floor((wx - 300) / MKCELL); i <= Math.floor((wx + 300) / MKCELL); i++) {
    const m = monkLine(W, i);
    if (!m) continue;
    if (wx > m.path.xa - rad && wx < m.path.xb + rad && B(pathD(m.path, clamp(wx, m.path.xa, m.path.xb)), low ? 10 : 14)) return true;
    if (Math.abs(m.gate.wx - wx) < 14 + rad && B(m.gate.d, 16)) return true;
    if (Math.abs(m.chorten.wx - wx) < 14 + rad && B(m.chorten.d, 16)) return true;
  }
  for (let i = Math.floor((wx - 60) / LSCELL); i <= Math.floor((wx + 60) / LSCELL); i++) { const s = lineShrine(W, i); if (s && Math.abs(s.wx - wx) < 30 + rad && B(s.d, 22)) return true; }
  for (let i = Math.floor((wx - 60) / TWCELL); i <= Math.floor((wx + 60) / TWCELL); i++) { const p = trailParty(W, i); if (p && Math.abs(p.wx - wx) < 26 + rad && B(p.d, 14)) return true; }
  if (!low) for (let i = Math.floor((wx - 60) / BCELL); i <= Math.floor((wx + 60) / BCELL); i++) { const b = bridge(W, i); if (b && Math.abs(b.wx - wx) < 50 + rad) return true; }
  return false;
}

// --- the valley trail: a worn footpath along the near slope the whole way, with people on it:
// monks, a herder with a child and a pack yak, porters, trekkers, a led horse ---
function trailD(W, wx) {
  const bn = valleyAt(W.ws, wx).bn;
  return Math.min(bn - 32, 50 + 34 * noise1(wx / 620, W.ws + 2301) + 7 * (noise1(wx / 85, W.ws + 2302) - 0.5));
}
function trailPath(W) { return W.trail || (W.trail = { xa: -1e12, xb: 1e12, fn: (wx) => trailD(W, wx), w: 2.3, pale: true, seed: 2303 }); }
const TWCELL = 380;
function trailParty(W, i) { return cache(W, 'tw', i, () => makeTrailParty(W, i)); }
function makeTrailParty(W, i) {
  const seed = hashInts(W.ws, 2311, i), r = makeRng(seed);
  if (r() > 0.62) return null;
  const wx = (i + 0.15 + 0.7 * r()) * TWCELL, d = trailD(W, wx);
  const dir = r() < 0.5 ? 1 : -1, u = r();
  // not through the middle of a hamlet, a camp, a lodge yard or a school
  const h = hamlet(W, Math.floor(wx / HCELL));
  if (h && Math.abs(h.wx - wx) < 100 && Math.abs(h.d - d) < 28) return null;
  if (taken(W, 4, wx, d, 22) || !nearFree(W, wx, d, 16)) return null;
  for (let k = Math.floor((wx - 60) / SCELL); k <= Math.floor((wx + 60) / SCELL); k++) { const g = sheepGroup(W, k); if (g && Math.abs(g.wx - wx) < 34 && Math.abs(g.d - d) < 16) return null; }
  const list = [];
  const packs = [[0.55, 0.42, 0.26], [0.2, 0.3, 0.55], [0.6, 0.2, 0.12]];
  if (u < 0.24) {
    const n = 2 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) list.push({ role: 'monk', gap: k ? 2.5 + 0.6 * r() : 0, ph: r(), hat: null });
  } else if (u < 0.46) {
    list.push({ role: 'herder', gap: 0, ph: r(), hat: r() < 0.5 ? [0.3, 0.24, 0.16] : null, col: [0.2, 0.15, 0.12] });
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) list.push({ type: 'yak', gap: 4.9, ph: r(), k: 1.7 + 0.25 * r(), col: YAKS[Math.floor(r() * YAKS.length)], graze: false, tassel: r() < 0.6, load: packs[Math.floor(r() * packs.length)], white: r() < 0.2 });
    list.push({ role: 'child', gap: 3.2, ph: r(), col: r() < 0.5 ? [0.46, 0.1, 0.1] : [0.14, 0.24, 0.52], hat: null });
  } else if (u < 0.66) {
    const n = 2 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) list.push({ role: 'porter', gap: k ? 3 : 0, ph: r(), load: r() < 0.6 ? [0.14, 0.32, 0.62] : [0.62, 0.2, 0.12] });
  } else if (u < 0.84) {
    const n = 2 + Math.floor(r() * 2);
    for (let k = 0; k < n; k++) list.push({ role: 'trekker', gap: k ? 3.6 : 0, ph: r(), col: JACKETS[Math.floor(r() * 5)], pack: JACKETS[Math.floor(r() * JACKETS.length)], hat: r() < 0.4 ? [0.75, 0.7, 0.6] : null });
    list.push({ role: 'porter', gap: 3.2, ph: r(), load: [0.14, 0.32, 0.62] });
  } else {
    list.push({ role: 'herder', gap: 0, ph: r(), hat: [0.3, 0.24, 0.16], col: [0.25, 0.18, 0.14] });
    list.push({ type: 'horse', gap: 3.6, ph: r(), col: HORSES[Math.floor(r() * HORSES.length)], saddle: [0.62, 0.14, 0.1] });
    if (r() < 0.5) list.push({ type: 'mule', gap: 4.2, ph: r(), col: HORSES[Math.floor(r() * HORSES.length)], pack: packs[Math.floor(r() * packs.length)] });
  }
  const len = list.reduce((a, m) => a + m.gap, 0);
  return { i, wx, d, seed, walkers: fileAlong(W, trailPath(W), wx + dir * len / 2, dir, list) };
}
function* trail(ctx, out, W, dLo, dHi) {
  yield* drawPath(ctx, out, W, trailPath(W), dLo, dHi);
  for (let i = Math.floor((ctx.x0 - 40) / TWCELL); i <= Math.floor((ctx.x0 + ctx.length + 40) / TWCELL); i++) {
    const p = trailParty(W, i);
    if (p) yield* drawWalkers(ctx, out, p.walkers, dLo, dHi);
  }
}

// --- grass tussocks and alpine flowers: the grain of the open ground near the line, in drifts.
// A tussock is a dark foot and a pale tuft; a flower clump a green foot and a bright head (the
// colour of the stretch, with a second mixed in). Thinned by world hash at low budgets.
function* tussocks(ctx, out, W, dLo, dHi) {
  const CS = 3.1, dA = Math.max(dLo, 9), dB = Math.min(dHi, 105);
  if (dB <= dA) return;
  const keep = 0.55 * clamp(out.density, 0.25, 1);
  for (let gd = Math.floor(dA / CS); gd * CS < dB; gd++) {
    for (let gx = Math.floor(ctx.x0 / CS); gx * CS < ctx.x0 + ctx.length; gx++) {
      if (hh(gx, gd, W.ws + 2401) > keep) continue;
      const wx = (gx + hh(gx, gd, W.ws + 2402)) * CS, d = (gd + hh(gx, gd, W.ws + 2403)) * CS;
      if (d < dA || d >= dB || wx < ctx.x0 || wx >= ctx.x0 + ctx.length) continue;
      if (noise2(wx / 38, d / 26, W.ws + 2404) < 0.42) continue;
      const v = valleyAt(W.ws, wx), lu = v.lu;
      if (d > v.bn - 2 || v.fm > 0.35) continue;
      const y = W.H(wx, d), x = wx - ctx.x0;
      const sz = (0.3 + 0.3 * hh(gx, gd, 2405)) * Math.max(1, d / 42), u2 = hh(gx, gd, W.ws + 2406), k = 0.85 + 0.3 * hh(gx, gd, 2407);
      if (lu > 0.12 && d < 80 && u2 < 0.36 * Math.min(1, 2 * lu)) {
        const c = FLOWERS[Math.floor(hh(Math.floor(wx / 130), u2 < 0.1 ? 1 : 0, W.ws + 2037) * FLOWERS.length)];
        out(x, y + sz * 0.25, -d, sz * 0.9, sz * 0.3, sz * 0.8, 0.2 * k, 0.32 * k, 0.13 * k, 1, 0, 0, 0, 1, KIND.GROUND);
        out(x, y + sz * 0.6, -d + sz * 0.1, sz * 0.75, sz * 0.3, sz * 0.65, c[0] * k, c[1] * k, c[2] * k, 1, 0, 0, 0, 1, KIND.GROUND);
      } else {
        const tip = mix3([0.6, 0.52, 0.31], [0.44, 0.5, 0.23], lu), foot = mix3([0.33, 0.28, 0.18], [0.2, 0.28, 0.13], lu);
        out(x, y + sz * 0.3, -d, sz * 0.85, sz * 0.38, sz * 0.7, foot[0] * k, foot[1] * k, foot[2] * k, 1, 0, 0, 0, 1, KIND.GROUND);
        out(x - sz * 0.1, y + sz * 0.85, -d + sz * 0.05, sz * 0.4, sz * 0.55, sz * 0.4, tip[0] * k, tip[1] * k, tip[2] * k, 1, 0, 0, 0, 1, KIND.GROUND);
      }
    }
    if (out.due()) yield;
  }
}

// --- stands of trees on the near slope: firs and blue pines, birches toward the river ---
const WSCELL = 52;
function stand(W, i) { return cache(W, 'ws', i, () => makeStand(W, i)); }
function makeStand(W, i) {
  const seed = hashInts(W.ws, 2101, i), r = makeRng(seed);
  const wx = (i + r()) * WSCELL;
  const v = valleyAt(W.ws, wx), wd = v.wd, lu = v.lu, bn = v.bn;
  // in the wooded stretches most cells hold a stand; elsewhere a lone clump now and then
  if (r() > (wd > 0.05 ? 0.2 + 0.75 * wd : 0.14 * lu)) return null;
  const n = 3 + Math.floor(r() * (4 + 8 * wd)), rx = 8 + 13 * r(), rd = 5 + 8 * r();
  let d = 0;
  for (let tr = 0; tr < 3 && !d; tr++) { const c = 46 + (bn - 66) * Math.pow(r(), 1.25); if (!veiled(W, wx, c - rd, rx)) d = c; }
  if (!d) return null;
  const u = r(), river = d > 0.78 * bn;
  const kind = u < (river ? 0.55 : 0.2) ? 'birch' : u < 0.82 ? 'fir' : 'pine';
  const st = { i, wx, d, kind, trees: [], bushes: [] };
  for (let k = 0; k < n; k++) {
    const a = r() * 6.28, q = Math.sqrt(r());
    const tx = wx + Math.cos(a) * rx * q, td = Math.max(37, d + Math.sin(a) * rd * q);
    const mixB = kind !== 'birch' && r() < 0.15, far = d > 78 || k < 5;
    const isB = kind === 'birch' || mixB;
    const h = isB ? 10 + 7 * r() : (kind === 'pine' ? 15 : 17) + 13 * r() * (0.6 + 0.4 * q);
    const w = isB ? h * (0.4 + 0.12 * r()) : h * (kind === 'pine' ? 0.4 : 0.32) * (0.85 + 0.3 * r());
    const col = isB ? jitter(C.birch, r, 0.12) : jitter(kind === 'pine' ? C.pine : C.fir, r, 0.14);
    if (td > bn - 4 || !far) continue;
    st.trees.push({ wx: tx, d: td, y: W.H(tx, td), h, w, birch: isB, col, seed: hashInts(seed, 1, k) });
  }
  // rhododendrons round the skirts of the stand, mostly on the side toward the line
  if (lu > 0.15) {
    const bl = r() < 0.75 ? bloomAt(W, wx) : Math.floor(r() * BLOOM.length);
    const nb = 2 + Math.floor(r() * 5);
    for (let k = 0; k < nb; k++) {
      const a = Math.PI * 1.5 + (r() - 0.5) * 3.6;
      const bx = wx + Math.cos(a) * rx * (1 + 0.4 * r()), bd = Math.max(32, d + Math.sin(a) * rd * (1 + 0.5 * r()));
      st.bushes.push({ wx: bx, d: bd, w: 2.6 + 2.6 * r(), h: 1.8 + 1.6 * r(), bloom: r() < 0.8 ? bl : -1, seed: hashInts(seed, 2, k) });
    }
  }
  return st;
}
function* nearWoods(ctx, out, W, dLo, dHi) {
  for (let i = Math.floor((ctx.x0 - 40) / WSCELL); i <= Math.floor((ctx.x0 + ctx.length + 40) / WSCELL); i++) {
    const st = stand(W, i);
    if (!st) continue;
    for (const t of st.trees) {
      if (!inD(t.d, dLo, dHi) || !inX(ctx, t.wx, t.w)) continue;
      const lod = t.d > 150 ? 1 : 0;
      if (t.birch) yield* birch(ctx, out, t, lod); else yield* fir(ctx, out, t, lod);
    }
    for (const b of st.bushes) if (inD(b.d, dLo, dHi) && inX(ctx, b.wx, b.w)) yield* rhodo(ctx, out, W, b);
  }
}

// --- drifts of rhododendron and juniper scrub over the near slope ---
const SBCELL = 26;
function drift(W, i) { return cache(W, 'sb', i, () => makeDrift(W, i)); }
function makeDrift(W, i) {
  const seed = hashInts(W.ws, 2111, i), r = makeRng(seed);
  const wx = (i + r()) * SBCELL;
  const v = valleyAt(W.ws, wx), lu = v.lu, bn = v.bn, fm = v.fm;
  // (even a bare stretch has its juniper; the farmed ground is kept for the fields)
  if (r() > (0.22 + 0.6 * lu) * (1 - 0.7 * fm)) return null;
  const d = 31 + (bn - 44) * Math.pow(r(), 1.5);
  const sx = 3 + 8 * r(), sd = 2 + 4 * r();
  if (veiled(W, wx, d, sx, true)) return null;
  const rh = r() < 0.2 + 0.7 * lu;
  const bl = r() < 0.75 ? bloomAt(W, wx) : Math.floor(r() * BLOOM.length), inBloom = r() < 0.85;
  const n = 2 + Math.floor(r() * 6);
  const bushes = [];
  for (let k = 0; k < n; k++) {
    const bx = wx + (r() * 2 - 1) * sx, bd = Math.max(30.5, d + (r() * 2 - 1) * sd);
    const w = r(), h = r(), fl = r();
    if (bd > bn - 3) continue;
    if (rh) bushes.push({ wx: bx, d: bd, w: 2.2 + 2.6 * w, h: 1.5 + 1.7 * h, bloom: inBloom && fl < 0.9 ? bl : -1, seed: hashInts(seed, 1, k) });
    else bushes.push({ wx: bx, d: bd, w: 2 + 2.4 * w, h: 0.8 + 0.8 * h, bloom: -1, col: C.juniper, seed: hashInts(seed, 1, k) });
  }
  return { wx, d, bushes };
}
function* drifts(ctx, out, W, dLo, dHi) {
  for (let i = Math.floor((ctx.x0 - 20) / SBCELL); i <= Math.floor((ctx.x0 + ctx.length + 20) / SBCELL); i++) {
    const dr = drift(W, i);
    if (!dr) continue;
    for (const b of dr.bushes) if (inD(b.d, dLo, dHi) && inX(ctx, b.wx, b.w)) yield* rhodo(ctx, out, W, b);
  }
}

// --- the woods beyond the river: the riverine wood on the floor, the forest on the lower wall up
// to the tree line, rhododendron and juniper in the scrub belt above. Planted cell by cell where
// faceCover() and floorWood() say the ground is wooded (the same answer the ground colour reads).
// The cells grow with distance (a far tree stands for a clump); at low budgets a share of the
// cells, chosen by world hash, is left empty and the rest drawn a little broader.
const FWROWS = (() => { const a = []; let d = 205; while (d < 1300) { const cs = Math.max(10, 0.027 * d); a.push([d, cs]); d += cs; } return a; })();
function inLake(W, wx, d) {
  const li = Math.floor(wx / LKCELL);
  for (let i = li - 1; i <= li + 1; i++) { const L = lake(W, i); if (L && Math.hypot((wx - L.wx) / L.rx, (d - L.d) / L.rz) < 1.1) return true; }
  return false;
}
const NNV = [0, 1, 0];
function* farWoods(ctx, out, W, dLo, dHi) {
  // (the same share of the cells in both bands at any budget: out.density is counted against a
  // different nominal count in each, 0.845 and 1.652 at the default 600k)
  const keep = clamp(out.density / (ctx.layer === 'mid' ? 1.652 : 0.845), 0.2, 1), broad = Math.pow(keep, -0.35);
  // the foot of the wall along the chunk, so cells far above the tree line are skipped unseen
  const FT = 40, f0 = Math.floor(ctx.x0 / FT), foot = [];
  for (let k = 0; k <= Math.ceil(ctx.length / FT) + 1; k++) foot.push(footAt(W.ws, (f0 + k) * FT));
  for (let ri = 0; ri < FWROWS.length; ri++) {
    const d0 = FWROWS[ri][0], cs = FWROWS[ri][1];
    if (d0 + cs <= dLo || d0 >= dHi) continue;
    const k0 = Math.floor((ctx.x0 - 8) / cs), k1 = Math.floor((ctx.x0 + ctx.length + 8) / cs);
    for (let k = k0; k <= k1; k++) {
      if (out.due()) yield;
      if (hh(k, ri, W.ws + 2051) > keep) continue;
      const wx = (k + hh(k, ri, W.ws + 2052)) * cs, d = d0 + hh(k, ri, W.ws + 2053) * cs;
      if (d < dLo || d >= dHi || !inX(ctx, wx, 8)) continue;
      const v = valleyAt(W.ws, wx);
      if (v.lu < 0.04 || d < v.bf + 3) continue;
      if (d > foot[clamp(Math.floor(wx / FT) - f0, 0, foot.length - 1)] + 560) continue;
      const e = Math.max(2, 0.008 * d);
      const hxp = W.H(wx + e, d), hdp = W.H(wx, d + e);
      const S = surface(W, wx, d);
      const y = S.y, u = hh(k, ri, W.ws + 2054), u2 = hh(k, ri, W.ws + 2055);
      const seed = (k * 7349 + ri * 131) | 0;
      // whorled trees out to 300 m, spindles beyond 420 m, and between the two a mixture thinning
      // with distance, so no line shows where the near band hands over to the middle one. All of
      // them a mass (KIND.HEDGE): a whole wood swelling on the beat would be the mountain moving.
      const lod = d < 300 || hh(k, ri, W.ws + 2056) < (420 - d) / 120 ? 1 : 2;
      const tiers = d < 300 ? 0 : 3;
      const kind = KIND.HEDGE;
      if (S.t === T.FLOOR) {
        const f = (d - S.bf) / 21, row = Math.floor(f);
        if (S.fm > 0.33 && fieldAt(W, S, wx, row + 500, 0.5, 2043, HALF)) {
          // a poplar or a willow on a field wall now and then
          if (u < 0.05 && !inLake(W, wx, d)) yield* leafTree(ctx, out, W, { wx, d, h: 11 + 7 * u2, willow: u2 < 0.4, seed }, kind);
          continue;
        }
        const fw = floorWood(W, S, wx, d);
        if (u > fw * 0.9 || inLake(W, wx, d)) continue;
        const h = (10 + 9 * u2) * broad;
        if (u2 < 0.62) yield* birch(ctx, out, { wx, d, y, h, w: Math.max(h * 0.45, cs * 0.7), seed, tiers }, lod, kind);
        else yield* fir(ctx, out, { wx, d, y, h: h * 1.5, w: Math.max(h * 0.5, cs * 0.75), col: u2 < 0.8 ? C.pine : C.fir, seed, tiers }, lod, kind);
        continue;
      }
      if (S.t !== T.FACE) continue;
      const nx = -(hxp - y) / e, nz = (hdp - y) / e, nl = Math.hypot(nx, 1, nz);
      NNV[0] = nx / nl; NNV[1] = 1 / nl; NNV[2] = nz / nl;
      if (S.vterr > 0.25) continue;
      if (fanFieldAt(W, S, wx, y - S.fy, NNV[1], HALF)) {
        if (u < 0.04) yield* leafTree(ctx, out, W, { wx, d, h: 11 + 7 * u2, willow: u2 < 0.4, seed }, kind);
        continue;
      }
      const F = faceCover(W, S, wx, NNV);
      if (F.forest > 0 && u < F.forest) {
        const h = (13 + 12 * u2) * broad * (1 - 0.3 * smooth(F.top - 60, F.top + 20, y - S.fy));   // smaller toward the tree line
        if (F.birch) yield* birch(ctx, out, { wx, d, y, h: h * 0.75, w: Math.max(h * 0.4, cs * 0.75), col: u2 < 0.25 ? C.turfGold : C.birch, seed, tiers }, lod, kind);
        else yield* fir(ctx, out, { wx, d, y, h, w: Math.max(h * 0.36, cs * 0.62), col: mul3(u2 < 0.3 ? C.pine : C.fir, 0.9 + 0.3 * hh(k, ri, 77)), seed, tiers }, lod, kind);
      } else if (F.scrub > 0.3 && u < 0.7 * F.scrub) {
        // a rhododendron (in flower where the ground is painted so) or a juniper: one dark lump,
        // and the flowers as one or two bright ones on its top and near side
        const w = Math.max(3, cs * 0.5) * broad, hgt = w * 0.5;
        const dk = F.bloom >= 0 ? C.rhodo : C.juniper;
        out(wx - ctx.x0, y + hgt * 0.5, -d, w * 0.5, hgt * 0.5, w * 0.4, dk[0], dk[1], dk[2], 1, 0, 0, 0, 1, KIND.HEDGE);
        if (F.bloom >= 0) {
          const bc = BLOOM[u2 < 0.8 ? F.bloom : Math.floor(u2 * 97) % BLOOM.length], kk = 0.82 + 0.25 * u2;
          out(wx - ctx.x0 - w * 0.12, y + hgt * 0.95, -(d - w * 0.15), w * 0.34, hgt * 0.3, w * 0.3, bc[0] * kk, bc[1] * kk, bc[2] * kk, 1, 0, 0, 0, 1, KIND.HEDGE);
          if (d < 600) out(wx - ctx.x0 + w * 0.2, y + hgt * 0.7, -(d - w * 0.3), w * 0.22, hgt * 0.22, w * 0.2, bc[0] * kk * 0.85, bc[1] * kk * 0.85, bc[2] * kk * 0.85, 1, 0, 0, 0, 1, KIND.HEDGE);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------------------------
function* trackside(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 1, detailK: 1.2 });
  out.limit = ctx.count * 0.5;
  yield* overheadLine(ctx, out, ctx.beatMetres || 56, { d: 3.7 });
  // a low dry-stone wall along the top of the slope, in stretches
  if (noise1(ctx.x0 / 900, W.ws + 1501) > 0.35) yield* stoneWall(ctx, out, W, ctx.x0 - 1, 8.2, ctx.x0 + ctx.length + 1, 8.2, 0.9, ctx.index & 0xffff);
  // a line of small flags close by, on short poles, now and then
  for (const { i, wx0 } of cellsAround(ctx, 140, 60)) {
    const r = worldRng(ctx, 1502, i);
    if (r() > 0.3) continue;
    const ax = wx0 + 140 * r(), len = 25 + 35 * r(), d = 13 + 9 * r();
    // (the slope falls away fast here: flags hung 2 m up sat level with the dry-stone wall at 8 m and
    // were veiled by it, so the poles are tall enough to lift the line clear above it)
    // (tested at the string's own world x, so both chunks it crosses agree)
    const walled = noise1(Math.floor(ax / 100) * 100 / 900, W.ws + 1501) > 0.35 || noise1(Math.floor((ax + len) / 100) * 100 / 900, W.ws + 1501) > 0.35;
    const lift = walled ? 3.4 : 2.2;
    const ay = W.H(ax, d) + lift, by = W.H(ax + len, d) + lift;
    for (const [px, py] of [[ax, ay], [ax + len, by]]) if (inX(ctx, px, 1)) strut(out, px - ctx.x0, py - lift - 0.1, -d, px - ctx.x0, py, -d, 0.06, C.pole, 3, 1, KIND.OTHER);
    yield* flagString(ctx, out, { a: [ax, ay, d], b: [ax + len, by, d], sag: 0.03, seed: hashInts(W.ws, 1503, i), fw: 0.3 }, ctx.zNear, ctx.zFar);
  }
  // boulders and snow on the slope
  for (const { i, wx0 } of cellsAround(ctx, 9, 2)) {
    const r = worldRng(ctx, 1504, i);
    if (r() > 0.3) continue;
    const wx = wx0 + 9 * r(), d = 10 + 18 * r(), rad = 0.3 + 0.8 * r() * r();
    const col = mix3(C.rock, C.stone, r());
    facetRock(out, wx - ctx.x0, W.H(wx, d), d, rad, rad * 0.8, rad * 0.8, { color: col, rng: r, n: 60, cracks: 0 });   // (was a soft blob(); few splats: the blur takes the detail here)
    if (out.due()) yield;
  }
  // dwarf rhododendron and juniper close by the line (low, round, blur-friendly), tussocks and flowers
  for (const { i, wx0 } of cellsAround(ctx, 11, 3)) {
    const r = worldRng(ctx, 1505, i);
    const wx = wx0 + 11 * r(), lu = valleyAt(W.ws, wx).lu;
    if (r() > 0.14 + 0.4 * lu) continue;
    const d = 10 + 17 * r(), w = 1.3 + 1.5 * r(), h = 0.6 + 0.6 * r();
    const rh = r() < 0.15 + 0.75 * lu, fl = r();
    if (!inX(ctx, wx, w)) continue;
    yield* rhodo(ctx, out, W, { wx, d, w, h, bloom: rh && fl < 0.8 ? bloomAt(W, wx) : -1, col: rh ? null : C.juniper, seed: hashInts(W.ws, 1506, i) });
  }
  yield* tussocks(ctx, out, W, 9, ctx.zFar);
  yield* snowfall(ctx, out, W, 6.5, ctx.zFar, 0.04);
  out.limit = Infinity;
  const rest = out.left();
  yield* fillStrip(ctx, out, W, Math.round(rest * 0.06), 2.5, 4.2, (wx, d, rng) => jitter(C.ballast, rng, 0.25), 0, 0.12);
  yield* fillStrip(ctx, out, W, Math.round(rest * 0.06), 4.2, 7, (wx, d, rng) => jitter(rng() < 0.15 ? C.snow : C.shelf, rng, 0.2), 0, 0.12);
  yield* fillPlain(ctx, out, W, { dNear: 7, power: 1.2, cover: 4.2, tuft: 30 });
}

function* near(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.1 });
  const dz = ctx.dials || {};
  out.limit = ctx.count * 0.62;
  const lo = ctx.zNear, hi = ctx.zFar;
  yield* bridges(ctx, out, W, lo, hi);
  yield* villages(ctx, out, W, lo, hi, { topo: dz.topology || 0 });
  yield* gompas(ctx, out, W, lo, hi, { topo: dz.topology || 0 });
  yield* hamlets(ctx, out, W, lo, hi);
  yield* flagSites(ctx, out, W, lo, hi);
  yield* lineShrines(ctx, out, W, lo, hi);
  yield* trail(ctx, out, W, lo, hi);
  yield* herds(ctx, out, W, lo, hi);
  yield* sheepGroups(ctx, out, W, lo, hi);
  yield* caravans(ctx, out, W, lo, hi);
  yield* monkLines(ctx, out, W, lo, hi);
  yield* camps(ctx, out, W, lo, hi);
  yield* lodges(ctx, out, W, lo, hi);
  yield* wheelWalls(ctx, out, W, lo, hi);
  yield* schools(ctx, out, W, lo, hi);
  yield* hamletAdds(ctx, out, W, lo, hi);
  yield* birds(ctx, out, W, lo, hi);
  yield* lakes(ctx, out, W, lo, hi);
  yield* forts(ctx, out, W, lo, hi);
  yield* snowfall(ctx, out, W, lo, Math.min(hi, 140), 0.018);
  // what grows: with a cap of its own, so that it never squeezes the ground fill
  const vegFrom = out.n;
  out.limit = Math.min(ctx.count * 0.62, out.n + ctx.count * 0.3);
  yield* nearWoods(ctx, out, W, lo, hi);
  yield* drifts(ctx, out, W, lo, hi);
  yield* farWoods(ctx, out, W, lo, hi);
  yield* tussocks(ctx, out, W, lo, hi);
  if (globalThis.__himLog) { const L = globalThis.__himLog; L.veg = Math.max(L.veg || 0, (out.n - vegFrom) / ctx.count); if (out.n >= out.limit) L.capped = (L.capped || 0) + 1; }
  out.limit = ctx.count * 0.62;
  yield* scatter(ctx, out, W, lo, hi);
  if ((dz.logic || 0) > 0) yield* repeatingChorten(ctx, out, W, dz.logic);
  if ((dz.scale || 0) > 0) yield* giantStrings(ctx, out, W, lo, hi, dz.scale);
  yield* mist(ctx, out, W, 120, hi, 50, 35, 0.12);
  yield* fillSurface(ctx, out, W, { cover: 3.4, tuft: 90, strips: 4 });
}

function* mid(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.6 });
  const dz = ctx.dials || {};
  const lo = ctx.zNear, hi = ctx.zFar;
  // the forest first, with a cap of its own: it is most of what stands on the wall, and a village
  // placed before it must not push its upper rows out of a small budget
  out.limit = ctx.count * 0.22;
  yield* farWoods(ctx, out, W, lo, hi);
  if (globalThis.__himLog && out.n >= out.limit) globalThis.__himLog.cappedMid = (globalThis.__himLog.cappedMid || 0) + 1;
  out.limit = ctx.count * 0.6;
  yield* villages(ctx, out, W, lo, hi, { topo: dz.topology || 0 });
  yield* gompas(ctx, out, W, lo, hi, { topo: dz.topology || 0 });
  for (let i = Math.floor((ctx.x0 - 700) / RCELL); i <= Math.floor((ctx.x0 + ctx.length + 300) / RCELL); i++) {
    const rs = ridgeString(W, i);
    if (!rs) continue;
    for (const p of rs.poles) if (inD(p.d, lo, hi) && inX(ctx, p.wx, 5)) yield* flagPole(ctx, out, W, p);
    yield* flagString(ctx, out, rs, lo, hi);
  }
  yield* bridges(ctx, out, W, lo, hi);
  yield* herds(ctx, out, W, lo, hi, 1);
  yield* streams(ctx, out, W, lo, hi);
  yield* icefalls(ctx, out, W, lo, hi);
  yield* lakes(ctx, out, W, lo, hi);
  yield* forts(ctx, out, W, lo, hi);
  if ((dz.scale || 0) > 0) { yield* giantYaks(ctx, out, W, lo, hi, dz.scale); yield* giantStrings(ctx, out, W, lo, hi, dz.scale); }
  if ((dz.topology || 0) > 0) yield* skyStrings(ctx, out, W, lo, hi, dz.topology);
  if (globalThis.__himLog && out.n >= out.limit) globalThis.__himLog.fullMid = (globalThis.__himLog.fullMid || 0) + 1;
  yield* mist(ctx, out, W, lo, hi, 150, 110, 0.2);
  yield* fillSurface(ctx, out, W, { cover: 3.4, strips: 8 });
}

function* far(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 600 });
  const dz = ctx.dials || {};
  const lo = ctx.zNear, hi = ctx.zFar;
  yield* banners(ctx, out, W, lo, hi);
  yield* hangingGlaciers(ctx, out, W, lo, hi);
  if ((dz.scale || 0) > 0) yield* giantYaks(ctx, out, W, lo, hi, dz.scale);
  if ((dz.topology || 0) > 0) yield* skyStrings(ctx, out, W, lo, hi, dz.topology);
  yield* farRange(ctx, out, W, dz.scale || 0);
}

// Level 1 (scale): needles: in some stretches the peaks keep going up, far taller and thinner
// than any real mountain. Far band only (nothing else stands on that ground).
function needle(W, wx, d, up) {
  if (up <= 0) return 0;
  const st = smooth(0.6, 0.8, noise1(wx / 7000, W.ws + 1441));
  if (st <= 0) return 0;
  const P = ridge(fbm2(wx / 900, d / 900, W.ws + 1442, 3));
  return up * 4200 * Math.pow(P, 10) * st * smooth(4000, 6500, d);
}

function* farRange(ctx, out, W, up) {
  out.limit = Infinity;
  const n = out.left();
  const rng = ctx.rng;
  const dn = ctx.zNear, df = ctx.zFar, L = ctx.length;
  const Hs = up > 0 ? (wx, d) => W.H(wx, d) + needle(W, wx, d, up) : W.H;
  // Most of the far ground hides behind the wall's crest or rises above the window: find, along x,
  // the highest angle the wall reaches (conservatively: the lowest such angle a little either way,
  // since the line of sight slants as the train moves), then weigh the far ground as fillSurface
  // does, by the angle it climbs through between that and the top of the window, per 200 m strip
  // and 40 distance bins. The splats go where the range shows.
  const OX = 100, M = 900, occ = [];
  for (let wx = ctx.x0 - M; wx <= ctx.x0 + L + M; wx += OX) {
    let a = -1;
    for (const dd of [500, 800, 1150, 1550, 2000, 2450, 2900]) a = Math.max(a, (W.H(wx, dd) - 2.6) / dd);
    occ.push(a);
  }
  const occMin = (x) => { const k0 = Math.round((x + M) / OX); let m = Infinity; for (let j = Math.max(0, k0 - 8); j <= Math.min(occ.length - 1, k0 + 8); j++) m = Math.min(m, occ[j]); return m; };
  const NS = Math.max(4, Math.round(L / 200)), SL = L / NS, NB = 40;
  const db = new Float64Array(NB + 1);
  for (let b = 0; b <= NB; b++) db[b] = dn * Math.pow(df / dn, b / NB);
  const tabs = [], tot = new Float64Array(NS);
  let all = 0;
  for (let k = 0; k < NS; k++) {
    const w = new Float64Array(NB);
    const xm = (k + 0.5) * SL, om = occMin(xm) - 0.015;
    for (const fx of [0.25, 0.75]) {
      const wx = ctx.x0 + (k + fx) * SL;
      let emax = om, e0 = clamp((Hs(wx, db[0]) - 2.6) / db[0], -1, TAN_TOP);
      for (let b = 0; b < NB; b++) {
        const e1 = clamp((Hs(wx, db[b + 1]) - 2.6) / db[b + 1], -1, TAN_TOP);
        const lo = Math.max(e0, emax);
        if (e1 > lo) w[b] += (e1 - lo) * 2 / (db[b] + db[b + 1]);
        if (e1 > emax) emax = e1;
        e0 = e1;
      }
    }
    let sum = 0;
    for (let b = 0; b < NB; b++) sum += w[b];
    tabs.push(w); tot[k] = sum; all += sum;
  }
  // a thin floor everywhere, so a strip the estimate calls hidden is still ground, never a hole
  const flr = (0.12 * all) / (NS * NB) + 1e-9;
  all = 0;
  for (let k = 0; k < NS; k++) { let sum = 0; for (let b = 0; b < NB; b++) { tabs[k][b] += flr; sum += tabs[k][b]; } tot[k] = sum; all += sum; }
  let k = 0, b = 0, acc = 0, kb = tabs[0][0] / all;
  for (let i = 0; i < n; i++) {
    const u = (i + rng()) / n;
    while (u > acc + kb && (k < NS - 1 || b < NB - 1)) { acc += kb; if (++b === NB) { b = 0; k++; } kb = tabs[k][b] / all; }
    const d = db[b] + rng() * (db[b + 1] - db[b]);
    const x = (k + rng()) * SL, wx = ctx.x0 + x;
    const y = Hs(wx, d);
    const dens = (n * kb) / ((db[b + 1] - db[b]) * SL);
    let r = clamp(Math.sqrt(2.6 / (Math.PI * dens)), 0.0012 * d, 0.02 * d);
    const ex = up > 0 ? needle(W, wx, d, up) : 0;
    if (ex > 300) r = Math.min(0.05 * d, r * (1 + Math.min(2, ex / 1200)));
    const e = Math.max(40, r * 0.7);
    const hx = (Hs(wx + e, d) - y) / e, hd = (Hs(wx, d + e) - y) / e;
    const nn = norm3(-hx, 1, hd);
    const slope = 1 - nn[1];
    const lit = Math.max(0, nn[0] * SUN[0] + nn[1] * SUN[1] + nn[2] * SUN[2]);
    const sl = 700 + 250 * noise2(wx / 2500, d / 2500, W.ws + 111) + 200 * (noise2(wx / 250, d / 200, W.ws + 112) - 0.5);
    let c;
    if (y < 500) c = mix3(C.grassDry, C.scree, smooth(200, 500, y));
    else c = mix3(C.rock, C.rockDark, noise2(wx / 200, d / 150, W.ws + 113));
    const fur = ridge(fbm2(wx / 520, d / 1700, W.ws + 114, 2));
    const furrow = smooth(0.45, 0.2, fur);
    c = mul3(c, 1 - 0.3 * furrow);
    // glaciers: the gentler hollows between the ridges at middle heights, grey-white with dark
    // moraine stripes running down them
    const glac = smooth(0.3, 0.1, slope) * smooth(500, 750, y) * smooth(0.5, 0.25, fur) * (1 - smooth(sl - 100, sl + 200, y));
    const snowy = smooth(sl - 60, sl + 60, y + 380 * furrow - 150 * smooth(0.5, 0.8, fur) - 500 * Math.max(0, slope - 0.68));
    if (snowy > 0) {
      const snc = mix3(C.snowShade, C.snow, clamp(lit * 1.3, 0, 1));
      c = mix3(shade(c, nn[0], nn[1], nn[2], 0.35, 0.9), snc, snowy);
    } else c = shade(c, nn[0], nn[1], nn[2], 0.35, 0.9);
    if (glac > 0.05) {
      const mor = noise2(wx / 120, d / 900, W.ws + 115) > 0.78;
      const gc = mor ? [0.3, 0.29, 0.28] : shade(mix3([0.62, 0.68, 0.74], C.snow, 0.4), nn[0], nn[1], nn[2], 0.6, 0.45);
      c = mix3(c, gc, clamp(glac, 0, 1));
    }
    c = jitter(c, rng, 0.04);
    // on the surface, a little longer down the fall line on steep faces
    const ph = Math.atan2(nn[0], nn[2]) * 0.5, cy = Math.cos(ph), sy = Math.sin(ph);
    const uq = quatUpTo(nn[0], nn[1], nn[2]);
    const el = clamp(1 / nn[1], 1, 1.6), ax = 0.85 + 0.3 * rng();
    out(x, y, -d, r * ax, r * 0.15, r * (2 - ax) * el, c[0], c[1], c[2], 1, uq[0] * cy - uq[2] * sy, uq[3] * sy + uq[1] * cy, uq[2] * cy + uq[0] * sy, uq[3] * cy - uq[1] * sy, ex > 50 ? KIND.SURREAL : KIND.GROUND);
    if (out.due()) yield;
  }
}

export const himalayaBiome = {
  name: 'himalaya',
  palette: PAL,
  // the shape numbers are unused: the valley comes from heightAt() through local()
  terrain: TERRAIN,
  hazeDist: 12000,
  gold: 0.6,
  // The trackside lies almost wholly below the window here, while the wall (mid) and the range (far)
  // fill it: the budget goes where the picture is.
  shares: { trackside: 0.06, near: 0.32, mid: 0.42, far: 0.2 },
  // Only the things a viewer picks out answer the beat (houses, gompas, chortens, bridge towers,
  // poplars and willows, lit windows; the yaks, sheep, horses, people and birds tag their own splats with MOVE.FLASH),
  // never the mountains.
  beatKinds: [KIND.BUILDING, KIND.TREE, KIND.LIGHT],
  sky: { stars: 1.3, deep: 0.8, milkyWay: 0.8, clear: 0.4 },   // thin, clear air: a rich sky on the rare night here
  generators: { trackside, near, mid, far },
};

// ---------------------------------------------------------------------------------------------
// For scripts that inspect the layout, e.g.
//   const { _debug } = await import('./src/window/biomes/himalaya.js');
//   _debug.layout('7', 0, 20000)   -> { villages, gompas, hamlets, flagSites, herds, sheep, bridges, ridgeStrings, giants, sideValleys }
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
  return {
    villages: list(VCELL, village, (v) => ({ wx: Math.round(v.cx), d: Math.round(v.dc), houses: v.houses.length, R: Math.round(v.R) })),
    gompas: list(MCELL, gompa, (g) => ({ wx: Math.round(g.wx), d: Math.round(g.d), strings: g.strings.length })),
    hamlets: list(HCELL, hamlet, (h) => ({ wx: Math.round(h.wx), d: Math.round(h.d), houses: h.houses.length })),
    flagSites: list(FCELL, flagSite, (f) => ({ wx: Math.round(f.wx), d: Math.round(f.d), chorten: f.chortens.length, poles: f.poles.length, strings: f.strings.length })),
    herds: list(YCELL, herd, (h) => ({ wx: Math.round(h.wx), d: Math.round(h.d), yaks: h.yaks.length })),
    sheep: list(SCELL, sheepGroup, (g) => ({ wx: Math.round(g.wx), d: Math.round(g.d), n: g.sheep.length })),
    bridges: list(BCELL, bridge, (b) => ({ wx: Math.round(b.wx), d: Math.round(b.d), span: Math.round(Math.hypot(b.b[0] - b.a[0], b.b[2] - b.a[2])) })),
    ridgeStrings: list(RCELL, ridgeString, (s) => ({ wx: Math.round((s.a[0] + s.b[0]) / 2), d: Math.round((s.a[2] + s.b[2]) / 2) })),
    giants: list(GCELLX, (W2, i) => giant(W2.ws, i), (g) => ({ wx: Math.round(g.wx), d: Math.round(g.d) })),
    sideValleys: list(SVC, (W2, i) => sideValley(W2.ws, i), (sv) => ({ wx: Math.round(sv.xc), glacier: !!sv.glacier, d: Math.round(footAt(W.ws, sv.xc)) })),
    caravans: list(CVCELL, caravan, (c) => ({ wx: Math.round(c.wx), d: Math.round(c.d), kind: c.kind, n: c.walkers.length })),
    monks: list(MKCELL, monkLine, (m) => ({ wx: Math.round(m.wx), d: Math.round(m.d), n: m.walkers.length, gate: [Math.round(m.gate.wx), Math.round(m.gate.d)] })),
    wheelWalls: list(PWCELL, wheelWall, (p) => ({ wx: Math.round(p.wx), d: Math.round(p.d), len: Math.round(p.len), gate: p.gate ? [Math.round(p.gate.wx), Math.round(p.gate.d)] : null })),
    lodges: list(LDCELL, lodge, (l) => ({ wx: Math.round(l.wx), d: Math.round(l.d) })),
    camps: list(NCCELL, camp, (c) => ({ wx: Math.round(c.wx), d: Math.round(c.d), tents: c.tents.length, horses: c.horses.length })),
    schools: list(SHCELL, school, (s) => ({ wx: Math.round(s.wx), d: Math.round(s.d), kids: s.kids.length })),
    orchards: list(HCELL, hamlet, (h) => { const e = hamletExtras(W, h); return { wx: Math.round(h.wx), d: Math.round(h.d), orchard: e.orchard.length ? [Math.round(e.orchard[0].wx), Math.round(e.orchard[0].d)] : null, field: e.field ? [Math.round((e.field.x0 + e.field.x1) / 2), Math.round((e.field.d0 + e.field.d1) / 2)] : null, gate: e.gate ? [Math.round(e.gate.wx), Math.round(e.gate.d)] : null }; }),
    birds: list(BDCELL, birdFlock, (b) => ({ wx: Math.round(b.wx), d: Math.round(b.d), y: Math.round(b.y), n: b.birds.length })),
    icefalls: list(ICCELL, icefall, (f) => ({ wx: Math.round(f.wx), d: Math.round(f.pts[f.pts.length >> 1][0]), y: Math.round(f.pts[f.pts.length >> 1][1]), H: Math.round(f.H) })),
    hangingGlaciers: list(HGCELL, hangingIce, (f) => ({ wx: Math.round(f.wx), d: Math.round(f.pts[f.pts.length >> 1][0]), y: Math.round(f.pts[f.pts.length >> 1][1]), w: Math.round(f.w) })),
    lakes: list(LKCELL, lake, (l) => ({ wx: Math.round(l.wx), d: Math.round(l.d), y: Math.round(l.y), rx: Math.round(l.rx) })),
    forts: list(FTCELL, fort, (f) => ({ wx: Math.round(f.wx), d: Math.round(f.d), y: Math.round(f.parts[0].base) })),
    snow: (() => { const res = []; let on = false; for (let x = x0; x <= x1; x += 100) { const a = snowAmt(W, x) > 0.05; if (a !== on) { res.push(Math.round(x)); on = a; } } return res; })(),
  };
}
export const _debug = { stand, drift, lineShrine, trailParty, trailD, world, at, layout, valleyAt, heightAt, footAt, WL, surface, village, gompa, hamlet, flagSite, herd, sheepGroup, bridge, caravan, monkLine, wheelWall, lodge, camp, school, birdFlock, icefall, lake, fort, snowAmt, hamletExtras, hangingIce };
