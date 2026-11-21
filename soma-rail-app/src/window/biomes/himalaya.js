// "Himalaya": a cold, high Himalayan valley. The railway runs along one side of the valley; the
// ground falls away from the line to a wide stony bed with a braided grey-blue glacial river, and
// the far side of the valley rises facing the window: terraced barley fields and walled plots low
// down, villages of flat-roofed whitewashed and stone houses stepped up the slope in tiers, a
// monastery (gompa) on a spur now and then, juniper scrub and scree above, then rock and snow.
// Beyond it stands the great range: huge snow-and-rock peaks with glaciers and cloud banners.
// Near the line: yaks grazing in loose herds, blue sheep on rocky outcrops, chortens, mani walls,
// tall prayer-flag poles and prayer-flag bunting everywhere, and suspension footbridges across
// the river hung with flags.
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
//   scale     needle peaks far taller and thinner than any real mountain; a giant yak standing on
//             the facing ridge; strings of prayer flags the size of houses crossing the valley
//   topology  the top tier of a village and the monastery hall floating clear of the slope above
//             their places, and strings of flags rising from the monasteries into the sky to the
//             summits and running peak to peak
//   logic     the same chorten repeating along the line, each copy a little more wrong
import { hashInts, hashString, makeRng } from '../rng.js';
import { makeTerrain } from '../terrain.js';
import {
  KIND, MOVE, makeOut, worldSeed, worldRng, cellsAround, detail, shade, jitter, mul3, mix3, smooth,
  clamp, lerp, norm3, quatYaw, quatUpTo, quatMul, quatAxis, quatPitch, overheadLine, blob, strut, house,
  rotY, SUN,
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
  scree: [0.52, 0.5, 0.47],
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
};
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
// Terrain: the valley
//   0 .. 7 m      ballast and a narrow shelf
//   7 .. bn       the near slope, falling (concave, so all of it is in view) to the valley floor
//   bn .. bf      the stony bed of the river, 110-240 m wide, bn 175-405 m out
//   bf .. +2.6 km the facing slope rising to a ridge 500-1000 m above the line
//   3.4 .. 14 km  the great range, summits 2000-4500 m above the line
// ---------------------------------------------------------------------------------------------
const VAL = { bn: 0, bf: 0, fy: 0 };
function valleyAt(ws, wx) {
  const bn = 290 + 85 * (2 * noise1(wx / 2300, ws + 11) - 1) + 30 * (2 * noise1(wx / 640, ws + 12) - 1);
  VAL.bn = bn;
  VAL.bf = bn + 110 + 130 * noise1(wx / 1700, ws + 13);
  VAL.fy = -58 - 18 * noise1(wx / 4100, ws + 14);
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

function ridgeS(ws, wx) { return 2450 + 350 * noise1(wx / 5200, ws + 31); }
function faceRise(ws, wx, s) {
  const S = ridgeS(ws, wx);
  const A = 740 + 210 * (2 * noise1(wx / 3400, ws + 32) - 1) + 100 * (2 * noise1(wx / 1200, ws + 33) - 1);
  const t = s / S;
  const base = t < 1 ? A * Math.pow(t, 1.55) : A - 0.35 * (s - S);
  const ss = smooth(0, 300, s);
  const b = Math.max(0, base);
  // spurs running down toward the camera, gullies between them, and roughness
  const spur = sq(ridge(noise2(wx / 700, s / 2400, ws + 34)));
  let y = base + (spur - 0.35) * (30 + 0.26 * b) * ss;
  y += (ridge(noise2(wx / 230, s / 900, ws + 35)) - 0.5) * (8 + 0.09 * b) * ss;
  y += (noise2(wx / 80, s / 80, ws + 36) - 0.5) * (2 + 0.012 * b) * ss;
  return y;
}
function spurAt(ws, wx, s) { return sq(ridge(noise2(wx / 700, s / 2400, ws + 34))); }

// The great range: a broad massif with a crest line far off, ridged peaks and a few giants.
const GCELLX = 8000;
function rangeP(ws, wx, d) { return ridge(fbm2(wx / 2600, d / 2300, ws + 42, 4)); }
function rangeY(ws, wx, d) {
  const r = smooth(3400, 7000, d);
  if (r <= 0) return -1e9;
  const dc = 9000 + 1600 * (2 * noise1(wx / 12000, ws + 41) - 1);
  const hump = Math.exp(-sq((d - dc) / 3000));
  const P = rangeP(ws, wx, d);
  const P2 = sq(ridge(noise2(wx / 800, d / 1000, ws + 43)));
  let y = (700 + 1500 * hump) * (0.3 + 0.85 * Math.pow(P, 2.2)) + 300 * P2 * hump;
  const gi = Math.floor(wx / GCELLX);
  for (let k = gi - 1; k <= gi + 1; k++) {
    const g = giant(ws, k);
    if (!g) continue;
    const rr = Math.hypot(wx - g.wx, (d - g.d) * 0.9);
    if (rr >= g.R) continue;
    y += g.H * Math.pow(1 - rr / g.R, 1.7) * (0.7 + 0.5 * P);
  }
  y *= r * 1.3;
  const cap = 0.4 * d;
  if (y > cap) y = cap + (y - cap) * 0.4;
  return y - 200 * (1 - r);
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
    const dc = 9000 + 1600 * (2 * noise1(wx / 12000, ws + 41) - 1);
    g = { k, wx, d: dc + (r() - 0.5) * 2400, H: 900 + 900 * r(), R: 2600 + 1400 * r(), banner: r() < 0.7, seed: hashInts(ws, 52, k) };
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
  if (d < bn) return nearY(ws, wx, d, bn, fy);
  const bed = fy + 0.5 * noise2(wx / 40, d / 25, ws + 23) - 0.25;
  if (d < bf) return bed;
  let y = bed + faceRise(ws, wx, d - bf);
  if (d > 3400) y = smax(y, rangeY(ws, wx, d), 140);
  return y;
}

// ---------------------------------------------------------------------------------------------
// World layout, cached per world seed
// ---------------------------------------------------------------------------------------------
const worlds = new Map();
function world(ctx) {
  const ws = worldSeed(ctx);
  let W = worlds.get(ws);
  if (W) return W;
  const H = (wx, d) => heightAt(ws, wx, d);
  W = { ws, H, misc: new Map() };
  W.terr = { height: H, stretch: ctx.terrain.stretch, shape: ctx.terrain.shape };
  worlds.set(ws, W);
  if (worlds.size > 6) worlds.delete(worlds.keys().next().value);
  return W;
}
// A copy of ctx standing on the valley terrain; every kit call must get this one.
function local(ctx) { const W = world(ctx); return [{ ...ctx, terrain: W.terr }, W]; }
function cache(W, key, make) {
  let v = W.misc.get(key);
  if (v === undefined) { v = make(); if (W.misc.size > 30000) W.misc.clear(); W.misc.set(key, v); }
  return v;
}
const bfAt = (W, wx) => valleyAt(W.ws, wx).bf;
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
const VCELL = 2300;
function village(W, i) { return cache(W, 'v' + i, () => makeVillage(W, i)); }
function makeVillage(W, i) {
  const seed = hashInts(W.ws, 801, i), r = makeRng(seed);
  if (r() > 0.78) return null;
  const cx = (i + 0.2 + 0.6 * r()) * VCELL;
  const sc = 70 + 620 * Math.pow(r(), 1.5);
  const R = 70 + 90 * r();
  const nT = 3 + Math.floor(r() * 4), sp = 26 + 14 * r();
  const v = { i, cx, sc, R, seed, houses: [], trees: [], chortens: [], poles: [], strings: [], tiers: nT, sLo: sc - sp * nT / 2 - 20, sHi: sc + sp * nT / 2 + 15 };
  v.dc = bfAt(W, cx) + sc;
  v.floatTier = nT - 1;
  v.floatR = r();
  for (let t = 0; t < nT; t++) {
    const s = sc - sp * (nT - 1) / 2 + t * sp;
    const Rt = R * (1 - 0.16 * Math.abs(t - (nT - 1) / 2)) * (0.8 + 0.3 * r());
    let x = cx - Rt + r() * 8;
    while (x < cx + Rt) {
      const w = 9 + 6 * r();
      if (r() < 0.18) { x += 12 + 18 * r(); continue; }
      const hx = x + w / 2, hs = s + (r() - 0.5) * 7;
      const d = bfAt(W, hx) + hs;
      v.houses.push({
        wx: hx, d, w, dep: 8 + 3 * r(), h: r() < 0.6 ? 6.6 + 1.2 * r() : 4.4 + r(), yaw: (r() - 0.5) * 0.16,
        wall: HOUSE_WALLS[Math.floor(r() * HOUSE_WALLS.length)], tier: t, seed: hashInts(seed, 3, v.houses.length),
      });
      x += w + (r() < 0.6 ? 0.2 : 2 + 6 * r());
    }
  }
  // bare poplars along the lowest tier, a chorten at each end, flag poles above
  for (let k = 0; k < 4 + Math.floor(r() * 6); k++) {
    const wx = cx + (r() - 0.5) * 2.2 * R, s = v.sLo - 6 - 25 * r();
    v.trees.push({ wx, d: bfAt(W, wx) + s, h: 10 + 6 * r(), seed: hashInts(seed, 5, k) });
  }
  for (const side of [-1, 1]) {
    if (r() < 0.25) continue;
    const wx = cx + side * (R + 10 + 20 * r()), s = sc + (r() - 0.6) * 40;
    v.chortens.push({ wx, d: bfAt(W, wx) + s, H: 5 + 3 * r(), seed: hashInts(seed, 7, side) });
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
      if (c !== a && dd > 20 && dd < 90) { b = c; break; }
    }
    if (b) v.strings.push({ a: [a.wx, topY(a) + 1.5, a.d], b: [b.wx, topY(b) + 1.5, b.d], sag: 0.05, seed: hashInts(seed, 9, k), fw: 0.5 });
  }
  const px = cx + (r() - 0.5) * R, ps = v.sHi + 25 + 30 * r();
  const pd = bfAt(W, px) + ps, py = W.H(px, pd);
  v.poles.push({ wx: px, d: pd, h: 10, seed: hashInts(seed, 11) });
  for (let k = 0; k < 5 && hs.length; k++) {
    const a = hs[Math.floor(r() * hs.length)];
    v.strings.push({ a: [px, py + 9.5, pd], b: [a.wx, topY(a), a.d], sag: 0.04, seed: hashInts(seed, 13, k), fw: 0.5 });
  }
  return v;
}

// --- monasteries on spurs ---
const MCELL = 4700;
function gompa(W, i) { return cache(W, 'g' + i, () => makeGompa(W, i)); }
function makeGompa(W, i) {
  const seed = hashInts(W.ws, 851, i), r = makeRng(seed);
  if (r() > 0.72) return null;
  const s = 420 + 900 * r();
  // on a spur: the best of a few candidates along the cell
  let best = -1, bx = 0;
  for (let k = 0; k < 9; k++) {
    const wx = (i + 0.15 + 0.7 * k / 8) * MCELL;
    const sp = spurAt(W.ws, wx, s) + 0.15 * r();
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
  g.main = { wx: bx, d, w: 24 + 10 * r(), dep: 14 + 4 * r(), h: 12 + 4 * r(), yaw, seed: hashInts(seed, 1), wall: r() < 0.8 ? C.white : [0.74, 0.58, 0.3] };
  g.halls = [];
  for (const side of [-1, 1]) {
    if (r() < 0.35) continue;
    const wx = bx + side * (g.main.w / 2 + 9 + 4 * r()), hd = d + 2 + 6 * r();
    const red = r() < 0.35;
    g.halls.push({ wx, d: hd, w: 12 + 6 * r(), dep: 10 + 3 * r(), h: 8 + 3 * r(), yaw: yaw + (r() - 0.5) * 0.1, wall: red ? [0.5, 0.13, 0.1] : C.white, band: !red, seed: hashInts(seed, 2, side) });
  }
  // monks' houses stepping down the spur
  for (let k = 0; k < 8 + Math.floor(r() * 12); k++) {
    const wx = bx + (r() - 0.5) * 140, hs = s - 25 - 110 * Math.pow(r(), 0.8);
    g.houses.push({ wx, d: bfAt(W, wx) + hs, w: 6 + 4 * r(), dep: 6 + 2 * r(), h: 4.5 + 2 * r(), yaw: yaw + (r() - 0.5) * 0.2, wall: r() < 0.85 ? C.white : HOUSE_WALLS[4], seed: hashInts(seed, 3, k) });
  }
  for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
    const wx = bx + (r() < 0.5 ? -1 : 1) * (g.main.w / 2 + 25 + 40 * r()), cs = s - 10 - 40 * r();
    g.chortens.push({ wx, d: bfAt(W, wx) + cs, H: 7 + 4 * r(), seed: hashInts(seed, 4, k) });
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
function hamlet(W, i) { return cache(W, 'h' + i, () => makeHamlet(W, i)); }
function makeHamlet(W, i) {
  const seed = hashInts(W.ws, 871, i), r = makeRng(seed);
  if (r() > 0.55) return null;
  const wx = (i + 0.2 + 0.6 * r()) * HCELL;
  const bn = bnAt(W, wx);
  const d = 75 + (Math.min(bn - 50, 230) - 75) * r();
  if (d < 70) return null;
  const h = { i, wx, d, seed, houses: [], walls: [], trees: [], chortens: [], poles: [], strings: [], mani: null };
  const n = 2 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const hx = wx + (k - (n - 1) / 2) * (14 + 8 * r()), hd = d + (r() - 0.5) * 24;
    h.houses.push({ wx: hx, d: hd, w: 8 + 4 * r(), dep: 7 + 3 * r(), h: r() < 0.5 ? 6.5 : 4.6, yaw: (r() - 0.5) * 0.9, wall: HOUSE_WALLS[Math.floor(r() * HOUSE_WALLS.length)], seed: hashInts(seed, 1, k), roofFlag: r() < 0.8 });
  }
  // walled plots below the houses
  for (let k = 0; k < 2 + Math.floor(r() * 3); k++) {
    const px = wx + (r() - 0.5) * 90, pd = d - 22 - 25 * r(), pw = 18 + 20 * r(), pdp = 10 + 12 * r();
    if (pd - pdp / 2 < 35) continue;
    h.walls.push([px - pw / 2, pd - pdp / 2, px + pw / 2, pd - pdp / 2], [px + pw / 2, pd - pdp / 2, px + pw / 2, pd + pdp / 2], [px - pw / 2, pd - pdp / 2, px - pw / 2, pd + pdp / 2]);
    if (r() < 0.6) h.walls.push([px - pw / 2, pd + pdp / 2, px + pw / 2, pd + pdp / 2]);
  }
  for (let k = 0; k < 2 + Math.floor(r() * 4); k++) {
    const tx = wx + (r() - 0.5) * 80, td = d + (r() - 0.7) * 30;
    h.trees.push({ wx: tx, d: Math.max(45, td), h: 9 + 6 * r(), seed: hashInts(seed, 2, k), willow: r() < 0.35 });
  }
  const cx = wx + (r() < 0.5 ? -1 : 1) * (35 + 20 * r());
  h.chortens.push({ wx: cx, d: d - 10 + 10 * r(), H: 4.5 + 2 * r(), seed: hashInts(seed, 3) });
  const pole = { wx: wx + (r() - 0.5) * 30, d: d + 18 + 8 * r(), h: 9 + 3 * r(), seed: hashInts(seed, 4), banner: true };
  h.poles.push(pole);
  const py = W.H(pole.wx, pole.d) + pole.h - 0.4;
  for (const hz of h.houses) {
    if (r() < 0.25) continue;
    h.strings.push({ a: [pole.wx, py, pole.d], b: [hz.wx, W.H(hz.wx, hz.d) + hz.h + 0.8, hz.d], sag: 0.07, seed: hashInts(seed, 5, Math.round(hz.wx)) });
  }
  const cc = h.chortens[0];
  h.strings.push({ a: [cc.wx, W.H(cc.wx, cc.d) + cc.H * 0.95, cc.d], b: [pole.wx, py - 1, pole.d], sag: 0.08, seed: hashInts(seed, 6) });
  if (r() < 0.6) { const mx = wx + (r() - 0.5) * 60; h.mani = { wx: mx, d: d - 30 - 10 * r(), len: 10 + 20 * r(), seed: hashInts(seed, 7) }; }
  return h;
}

// --- flag sites near the line: a chorten with flags, a cluster of tall poles, a "tent" of strings ---
const FCELL = 640;
function flagSite(W, i) { return cache(W, 'f' + i, () => makeFlagSite(W, i)); }
function makeFlagSite(W, i) {
  const seed = hashInts(W.ws, 881, i), r = makeRng(seed);
  if (r() > 0.6) return null;
  const wx = (i + 0.2 + 0.6 * r()) * FCELL;
  const bn = bnAt(W, wx);
  const d = 45 + (Math.min(bn - 20, 230) - 45) * Math.pow(r(), 1.2);
  const hm = hamlet(W, Math.floor(wx / HCELL));
  if (hm && Math.abs(hm.wx - wx) < 110 && Math.abs(hm.d - d) < 60) return null;
  const f = { i, wx, d, seed, chortens: [], poles: [], strings: [], mani: null, cairns: [] };
  const kind = r();
  const gy = (x, dd) => W.H(x, dd);
  if (kind < 0.45) {
    // a chorten with strings from its spire to stakes round about, and a few poles
    const H = 5 + 3 * r();
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

// --- yak herds ---
const YCELL = 420;
function herd(W, i) { return cache(W, 'y' + i, () => makeHerd(W, i)); }
function makeHerd(W, i) {
  const seed = hashInts(W.ws, 891, i), r = makeRng(seed);
  if (r() > 0.5) return null;
  const wx = (i + 0.2 + 0.6 * r()) * YCELL;
  const v = valleyAt(W.ws, wx);
  // close enough to be animals and not dots, yet far enough to clear the blur and the bottom edge
  // of the window (the ground falls away steeply here): mostly 52-100 m out
  const d = 52 + (Math.min(v.bf - 30, 170) - 52) * Math.pow(r(), 1.8);
  const n = 3 + Math.floor(r() * 9);
  const hd = { i, wx, d, seed, yaks: [] };
  const flow = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.6;
  for (let k = 0; k < n; k++) {
    const yx = wx + (r() - 0.5) * (14 + 4 * n), yd = Math.max(47, d + (r() - 0.5) * (8 + 1.6 * n));
    const yv = valleyAt(W.ws, yx);
    if (yd > yv.bn && yd < yv.bf && channelAt(W, yx, (yd - yv.bn) / (yv.bf - yv.bn), yv.bf - yv.bn)) continue;
    hd.yaks.push({
      wx: yx, d: yd, yaw: flow + (r() - 0.5) * 1.6, k: 1.3 + 0.35 * r(), col: YAKS[Math.floor(r() * YAKS.length)],
      graze: r() < 0.7, tassel: r() < 0.3, blanket: r() < 0.15, white: r() < 0.2, seed: hashInts(seed, 1, k),
    });
  }
  return hd;
}

// --- blue sheep on rocky outcrops ---
const SCELL = 560;
function sheepGroup(W, i) { return cache(W, 's' + i, () => makeSheep(W, i)); }
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
    g.sheep.push({ wx: x, d: dd, y, yaw: (r() - 0.5) * 2 * Math.PI, look: r() < 0.4, k: 1.4 + 0.3 * r(), seed: hashInts(seed, 2, k) });
  }
  return g;
}

// --- suspension footbridges across the main channel ---
const BCELL = 2700;
function bridge(W, i) { return cache(W, 'b' + i, () => makeBridge(W, i)); }
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
function ridgeString(W, i) { return cache(W, 'r' + i, () => makeRidgeString(W, i)); }
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

// --- frozen side streams running down the facing slope ---
const STCELL = 1100;
function stream(W, i) {
  return cache(W, 't' + i, () => {
    const r = makeRng(hashInts(W.ws, 931, i));
    if (r() > 0.55) return null;
    return { i, x0: (i + 0.2 + 0.6 * r()) * STCELL, slope: (r() - 0.5) * 0.25, s1: 900 + 1300 * r(), seed: hashInts(W.ws, 932, i) };
  });
}
function streamX(st, s) { return st.x0 + st.slope * s + 18 * Math.sin(s / 70 + st.i) + 9 * Math.sin(s / 23 + 2 * st.i); }

// --- mist: patchy, in stretches ---
function mistAmt(W, wx) { return smooth(0.5, 0.78, noise1(wx / 3100, W.ws + 701)); }

// Village or gompa ground at a facing-slope point (yards and terraced fields round about).
function nearSettlement(W, wx, s) {
  const i = Math.floor(wx / VCELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const v = village(W, k);
    if (!v) continue;
    const ex = (wx - v.cx) / v.R, es = (s - (v.sLo + v.sHi) / 2) / ((v.sHi - v.sLo) / 2 + 8);
    const e = ex * ex + es * es;
    if (e < 1) return 2;
    if (Math.abs(wx - v.cx) < v.R * 2.6 && s > v.sLo - 260 && s < v.sHi + 40) return 1;
  }
  const j = Math.floor(wx / MCELL);
  for (let k = j - 1; k <= j + 1; k++) {
    const g = gompa(W, k);
    if (!g) continue;
    if (Math.abs(wx - g.wx) < g.main.w * 0.8 + 20 && Math.abs(s - g.s) < 30) return 2;
    if (Math.abs(wx - g.wx) < 220 && s > g.s - 300 && s < g.s - 60) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------------------------
const T = { NEAR: 0, BED: 1, CHANNEL: 2, FACE: 3 };
const SURF = { t: 0, y: 0, s: 0, bn: 0, bf: 0, fy: 0, u: 0, ch: null };
function surface(W, wx, d) {
  const S = SURF;
  const v = valleyAt(W.ws, wx);
  const bn = v.bn, bf = v.bf, fy = v.fy;
  S.bn = bn; S.bf = bf; S.fy = fy; S.ch = null;
  S.y = W.H(wx, d);
  if (d < bn) { S.t = T.NEAR; return S; }
  if (d < bf) {
    S.u = (d - bn) / (bf - bn);
    const ch = channelAt(W, wx, S.u, bf - bn);
    if (ch) { S.t = T.CHANNEL; S.ch = ch; S.y = fy - 0.3; return S; }
    S.t = T.BED; return S;
  }
  S.t = T.FACE; S.s = d - bf; S.terr = 0; return S;
}

function snowLine(W, wx, d) { return 540 + 130 * noise2(wx / 1800, d / 1500, W.ws + 81) + 60 * (noise2(wx / 260, d / 260, W.ws + 82) - 0.5); }

function surfColor(W, S, wx, d, rng, nn) {
  let c;
  const lit = Math.max(0, nn[0] * SUN[0] + nn[1] * SUN[1] + nn[2] * SUN[2]);
  switch (S.t) {
    case T.CHANNEL: {
      const ice = S.ch.f > 0.72 && noise1(wx / 60, W.ws + 91) > 0.5;
      c = ice ? C.ice : mix3(C.water, C.waterDeep, (1 - S.ch.f) * (S.ch.k === 0 ? 0.6 : 0.2));
      c = mix3(c, [0.62, 0.68, 0.72], smooth(0.75, 0.9, noise2(wx / 25, d / 4, W.ws + 92)) * 0.5);
      return jitter(c, rng, 0.03);
    }
    case T.BED: {
      c = mix3(C.bed, C.bedDark, noise2(wx / 9, d / 6, W.ws + 93));
      if (noise2(wx / 70, d / 30, W.ws + 94) > 0.72) c = mix3(c, C.grassDry, 0.5);
      if (noise2(wx / 20, d / 9, W.ws + 99) > 0.82) c = C.snow;
      return jitter(c, rng, 0.1);
    }
    case T.NEAR: {
      const n1 = noise2(wx / 30, d / 25, W.ws + 95), n2 = noise2(wx / 8, d / 6, W.ws + 96);
      c = mix3(C.grass, C.grassDry, smooth(0.3, 0.7, n1));
      if (n2 > 0.7) c = mix3(c, C.grassDark, 0.6);
      if (noise2(wx / 14, d / 11, W.ws + 97) > 0.78) c = C.stone;
      if (noise2(wx / 13, d / 10, W.ws + 98) > 0.84) c = C.snow;       // old snow lying in hollows
      break;
    }
    default: {
      const y = S.y, s = S.s;
      const slope = 1 - nn[1];
      const n1 = noise2(wx / 120, d / 160, W.ws + 101);
      c = mix3(C.grass, C.grassDry, smooth(0.25, 0.75, n1));
      if (y > 60) c = mix3(c, mix3(C.grassDry, C.scree, 0.6), smooth(60, 240, y));
      // juniper scrub in a band above the fields
      if (y > 40 && y < 330 && noise2(wx / 70, d / 30, W.ws + 102) * 0.7 + 0.3 * noise2(wx / 13, d / 9, W.ws + 112) > 0.7 - 0.05 * smooth(80, 200, y)) c = C.juniper;
      // scree fans and rock higher up and on steep ground
      const rk = smooth(230, 400, y + 120 * (noise2(wx / 300, d / 400, W.ws + 103) - 0.5)) + smooth(0.45, 0.7, slope);
      if (rk > 0) c = mix3(c, noise2(wx / 60, d / 90, W.ws + 104) > 0.5 ? C.rock : C.scree, clamp(rk, 0, 1));
      // villages, and terraced fields round them and in stretches of the lower slope
      if (s < 1500 && y < 170) {
        const st = nearSettlement(W, wx, s);
        if (st === 2) c = mix3(C.yard, C.grassDry, noise2(wx / 7, d / 7, W.ws + 109) * 0.6);
        else if (s > 25 && (st === 1 || noise1(wx / 1500, W.ws + 105) > 0.66) && y < 150) {
          const step = 7;
          const f = (y + 1000 + 3 * noise1(wx / 90, W.ws + 110)) / step, row = Math.floor(f), fr = f - row;
          const len = 45 + 40 * hh(row, 0, W.ws + 107);
          const field = hh(row, Math.floor(wx / len), W.ws + 106);
          if (fr < 0.22) c = C.riser;
          else c = field < 0.45 ? C.barley : field < 0.55 ? C.barleyGreen : field < 0.8 ? C.plough : C.grass;
          S.terr = 1;
        }
      }
      // snow: patchy below the line, lying longer in gullies, solid above
      const gully = ridge(noise2(wx / 230, s / 900, W.ws + 35));
      const sn = smooth(-60, 60, y - snowLine(W, wx, d) + 140 * (gully - 0.5) + 80 * (noise2(wx / 70, d / 70, W.ws + 108) - 0.5) - 260 * Math.max(0, slope - 0.5));
      if (sn > 0) {
        const snc = mix3(C.snowShade, C.snow, clamp(lit * 1.25, 0, 1));
        return jitter(mix3(shade(c, nn[0], nn[1], nn[2], 0.55, 0.6), snc, sn), rng, 0.03);
      }
      break;
    }
  }
  c = shade(c, nn[0], nn[1], nn[2], 0.55, 0.6);
  return jitter(c, rng, 0.07);
}

// ---------------------------------------------------------------------------------------------
// Ground fill (one splat per sample; lands the count on ctx.count)
// ---------------------------------------------------------------------------------------------
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
  const A = Math.abs(a1) < 1e-6 ? 0 : Math.pow(dn, a1), B = Math.abs(a1) < 1e-6 ? 0 : Math.pow(df, a1);
  const Z = Math.abs(a1) < 1e-6 ? Math.log(df / dn) : (B - A) / a1;
  const sample = (u) => (Math.abs(a1) < 1e-6 ? dn * Math.pow(df / dn, u) : Math.pow(A + u * (B - A), 1 / a1));
  for (let i = 0; i < n; i++) {
    const d = sample((i + rng()) / n);
    const x = rng() * L, wx = ctx.x0 + x;
    const dens = (n * Math.pow(d, -p) / Z) / L;
    const r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
    const S = surface(W, wx, d);
    const y = S.y;
    const e = Math.max(0.5, r);
    const nn = norm3(-(W.H(wx + e, d) - y) / e, 1, (W.H(wx, d + e) - y) / e);
    const c = surfColor(W, S, wx, d, rng, nn);
    const q = quatUpTo(nn[0], nn[1], nn[2]);
    const ax = 0.8 + 0.5 * rng();
    const water = S.t === T.CHANNEL;
    const tuft = opts.tuft && S.t === T.NEAR ? Math.max(0, 1 - d / opts.tuft) : 0;
    if (S.t === T.FACE && S.terr) { out(x, y + 0.03, -d, r * 1.9, r * 0.12, r * 0.45, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND); if (out.due()) yield; continue; }
    out(x, y + 0.03 + tuft * r * 0.3 * rng(), -d, r * ax * (water ? 1.4 : 1), r * (water ? 0.05 : 0.14 + 0.25 * tuft), r * (1.8 - ax) * (water ? 0.7 : 1), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND);
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
  const fw0 = st.fw || 0.34;
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
function* yak(ctx, out, wx, y, d, o) {
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
  if (out.due()) yield;
}

// A blue sheep (bharal): slate grey-brown, white belly and leg fronts, black chest and flank
// line, thick horns curving out and back.
function* bharal(ctx, out, wx, y, d, o) {
  const k = o.k || 1, kind = KIND.OTHER;
  const ca = Math.cos(o.yaw), sa = Math.sin(o.yaw);
  const x0 = wx - ctx.x0;
  const pt = [0, 0, 0];
  const P = (u, h, v) => { pt[0] = x0 + (u * ca - v * sa) * k; pt[1] = y + h * k; pt[2] = -(d + (u * sa + v * ca) * k); return pt; };
  const q = quatYaw(o.yaw);
  const E = (u, h, v, rx, ry, rz, c, qq = q) => { P(u, h, v); out(pt[0], pt[1], pt[2], rx * k, ry * k, rz * k, c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], kind); };
  const coat = [0.44, 0.4, 0.35], coatHi = [0.55, 0.5, 0.43], belly = [0.74, 0.72, 0.67], black = [0.08, 0.07, 0.07];
  const lr = Math.max(0.045, 0.00055 * d) / k;
  for (const [u, v, c] of [[0.24, 0.08, black], [0.24, -0.08, belly], [-0.24, 0.08, coat], [-0.24, -0.08, belly]]) {
    const a = [...P(u, 0.62, v)], b = P(u, 0.02, v);
    strut(out, a[0], a[1], a[2], b[0], b[1], b[2], lr * k, c, 2, 1, kind);
  }
  E(0, 0.8, 0, 0.36, 0.19, 0.16, coat);
  E(-0.05, 0.94, 0, 0.3, 0.07, 0.12, coatHi);
  E(0, 0.65, 0, 0.28, 0.06, 0.13, belly);
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
  yield* stoneWall(ctx, out, W, ax, m.d, bx, m.d, 1.3, m.seed & 0xffff);
  const step = Math.max(0.3, detail(out, m.d, 1.1));
  for (let x = ax + step / 2; x < bx; x += step) {
    const lx = x - ctx.x0;
    if (lx < -1 || lx > ctx.length + 1) continue;
    const r = hh(Math.round(x * 10), m.seed & 0xffff, 5);
    const c = r < 0.6 ? [0.66, 0.64, 0.6] : r < 0.75 ? [0.62, 0.26, 0.18] : r < 0.88 ? [0.28, 0.38, 0.55] : [0.7, 0.6, 0.3];
    out(lx, W.H(x, m.d) + 1.38, -m.d, step * 0.6, 0.12, 0.45, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
    if (out.due()) yield;
  }
}

// A bare poplar (narrow, upward-sweeping twigs) or a pollarded willow, as in the village lanes.
function* bareTree(ctx, out, W, t, kind = KIND.TREE) {
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
    const r = (c.small ? 0.3 : 0.55) * (1 - k * 0.18);
    const col = jitter(mix3(C.stone, C.stoneDark, hh(k, c.seed | 0, 9) * 0.6), () => hh(k, c.seed | 0, 10), 0.1);
    out(x, yy + r * 0.6, -c.d, r, r * 0.65, r * 0.9, col[0], col[1], col[2], 1, 0, 0, 0, 1, kind);
    yy += r * 1.05;
  }
  if (!c.small) {
    out(x, yy + 0.2, -c.d, 0.12, 0.12, 0.12, 0.76, 0.76, 0.74, 1, 0, 0, 0, 1, kind);
  }
}

function sizeS(out, d, k = 1) { return detail(out, d, k); }

// ---------------------------------------------------------------------------------------------
// Placed things, drawn by every band they fall in
// ---------------------------------------------------------------------------------------------
function houseOf(ctx, out, W, hz, opts = {}) {
  const rng = makeRng(hz.seed);
  const lift = opts.lift || 0;
  const y = (opts.y != null ? opts.y : minGround(W, hz)) - 0.4 + lift;
  return flatHouse(ctx, out, hz.wx - ctx.x0, hz.d, {
    w: hz.w, dep: hz.dep, h: hz.h + 0.4, yaw: hz.yaw, wall: hz.wall, y, s: sizeS(out, hz.d, opts.k || 1), rng, band: hz.band,
    lit: opts.lit, flag: hz.roofFlag && hz.d < 260, kind: opts.kind, salt: hz.seed & 0xffff,
  });
}
function minGround(W, hz) {
  let m = Infinity;
  const [ex, ez] = rotY(1, 0, hz.yaw || 0), [fx, fz] = rotY(0, 1, hz.yaw || 0);
  for (const [a, b] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) {
    const lx = a * hz.w, lz = b * hz.dep;
    m = Math.min(m, W.H(hz.wx + ex * lx + fx * lz, hz.d - (ez * lx + fz * lz)));
  }
  return m;
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
    for (const hz of v.houses) {
      if (!inD(hz.d, dLo, dHi) || !inX(ctx, hz.wx, 20)) continue;
      const fl = floating && hz.tier === v.floatTier;
      yield* houseOf(ctx, out, W, hz, { lit, lift: fl ? lift : 0, kind: fl ? KIND.SURREAL : KIND.BUILDING });
    }
    if (floating) yield* floatingRoot(ctx, out, W, v, lift, dLo, dHi);
    for (const t of v.trees) if (t.d < 300 && inD(t.d, dLo, dHi) && inX(ctx, t.wx, 10)) yield* bareTree(ctx, out, W, t);
    for (const c of v.chortens) if (inD(c.d, dLo, dHi) && inX(ctx, c.wx, 10)) yield* drawChorten(ctx, out, W, c);
    for (const p of v.poles) if (inD(p.d, dLo, dHi) && inX(ctx, p.wx, 5)) yield* flagPole(ctx, out, W, { ...p, banner: true });
    for (const s of v.strings) yield* flagString(ctx, out, s, dLo, dHi);
  }
}
// The rock torn out under a floating tier: an inverted cone of rock and earth below the houses.
function* floatingRoot(ctx, out, W, v, lift, dLo, dHi) {
  const tierH = v.houses.filter((h) => h.tier === v.floatTier);
  if (!tierH.length) return;
  let xa = Infinity, xb = -Infinity, dm = 0;
  for (const h of tierH) { xa = Math.min(xa, h.wx - h.w / 2); xb = Math.max(xb, h.wx + h.w / 2); dm += h.d; }
  dm /= tierH.length;
  if (!inD(dm, dLo, dHi)) return;
  const cx = (xa + xb) / 2, R = (xb - xa) / 2 + 6;
  if (!inX(ctx, cx, R + 10)) return;
  const r = makeRng(v.seed ^ 0x77);
  // a shallow wedge of the field with earth and rock beneath it, never a bulk big enough to
  // outweigh the houses it carries
  const top = W.H(cx, dm) + lift - 0.5, depth = R * 0.4 + lift * 0.08;
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
    const m = g.main;
    if (inD(m.d, dLo, dHi) && inX(ctx, m.wx, m.w)) {
      const rng = makeRng(m.seed);
      const y = minGround(W, m) - 0.5 + lift;
      const s = sizeS(out, m.d, 0.8);
      yield* flatHouse(ctx, out, m.wx - ctx.x0, m.d, { w: m.w, dep: m.dep, h: m.h, yaw: m.yaw, wall: m.wall, y, s, rng, band: true, lit, kind, salt: m.seed & 0xffff });
      // the gilded roof pavilion and the gold victory banners on the roof corners
      yield* house(ctx, out, m.wx - ctx.x0, m.d + 1, { w: Math.min(9, m.w * 0.3), depth: 6, h: 2.8, roofH: 2.2, wall: C.maroon, roof: C.gold, windows: false, chimney: false, rng, y: y + m.h, yaw: m.yaw, s, kind });
      const gr = Math.max(0.35, 0.0011 * m.d);
      const [ex, ez] = rotY(1, 0, m.yaw), [fx, fz] = rotY(0, 1, m.yaw);
      for (const a of [-0.46, 0.46]) {
        for (const b of [0.42]) {
          const px = m.wx - ctx.x0 + ex * a * m.w + fx * b * m.dep, pz = -m.d + ez * a * m.w + fz * b * m.dep;
          strut(out, px, y + m.h, pz, px, y + m.h + 2.4, pz, gr, C.gold, 2, 1, kind);
        }
      }
      if (floatG) yield* floatingRoot(ctx, out, W, { houses: [{ ...m, tier: 0 }], floatTier: 0, seed: m.seed }, lift, dLo, dHi);
    }
    for (const h of g.halls) if (inD(h.d, dLo, dHi) && inX(ctx, h.wx, h.w)) yield* houseOf(ctx, out, W, h, { lit, k: 0.9, lift, kind });
    for (const h of g.houses) if (inD(h.d, dLo, dHi) && inX(ctx, h.wx, 15)) yield* houseOf(ctx, out, W, h, { lit });
    for (const c of g.chortens) if (inD(c.d, dLo, dHi) && inX(ctx, c.wx, 10)) yield* drawChorten(ctx, out, W, c);
    for (const p of g.poles) if (inD(p.d, dLo, dHi) && inX(ctx, p.wx, 5)) yield* flagPole(ctx, out, W, p);
    for (const s of g.strings) {
      if (!floatG) { yield* flagString(ctx, out, s, dLo, dHi); continue; }
      yield* flagString(ctx, out, { ...s, a: [s.a[0], s.a[1] + lift, s.a[2]] }, dLo, dHi, KIND.SURREAL);
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
    for (const hz of h.houses) if (inD(hz.d, dLo, dHi) && inX(ctx, hz.wx, 15)) yield* houseOf(ctx, out, W, hz, { lit });
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
      const n = Math.round(clamp(treeSplats2(out, b.d, b.rx * 2) * 3, 8, 1200));
      yield* blob(ctx, out, b.wx - ctx.x0, b.y, b.d, b.rx, b.ry, b.rz, { n, color: mix3(C.rock, C.stone, 0.4 * rng()), rng, kind: KIND.ROCK, inner: 0.5, amb: 0.45, clump: 0.9 });
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
    yield* flagString(ctx, out, { a: [a[0], deck, a[2]], b: [bb[0], deck, bb[2]], sag: 1.2 / span, seed: b.seed ^ 5, fw: 0.001, cord: C.wood, noFlags: true }, dLo, dHi, KIND.BUILDING);
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
        strut(out, hx - ctx.x0, top, -hd, hx - ctx.x0, bot, -hd, Math.max(0.025, 0.0003 * hd), C.cord, 1, 0.8, KIND.WIRE);
      }
    }
    for (const s of b.strings) yield* flagString(ctx, out, s, dLo, dHi);
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
        yield* blob(ctx, out, wx - ctx.x0, y + rad * 0.25, d, rad, rad * 0.6, rad * 0.85, { n: Math.round(clamp(treeSplats2(out, d, rad * 2) * 0.6, 4, 120)), color: mix3(C.rock, C.stone, sz), rng: r, kind: KIND.ROCK, inner: 0.25, amb: 0.5, clump: 0.2 });
      } else if (u < 0.7 && S.t === T.NEAR) {
        const w = 1 + 1.6 * sz;
        yield* blob(ctx, out, wx - ctx.x0, y + 0.25, d, w * 0.5, 0.4 + 0.2 * sz, w * 0.4, { n: Math.round(clamp(treeSplats2(out, d, w) * 0.8, 4, 80)), color: C.juniper, rng: r, kind: KIND.TREE, inner: 0.4, amb: 0.55 });
      } else if (u < 0.74 && S.t === T.NEAR) {
        yield* cairn(ctx, out, W, { wx, d, seed: i * 3 + k });
      }
    }
    if (out.due()) yield;
  }
}

// Frozen side streams: thin white-blue lines running down the gullies of the facing slope.
function* streams(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 120) / STCELL), i1 = Math.floor((ctx.x0 + ctx.length + 120) / STCELL);
  for (let i = i0; i <= i1; i++) {
    const st = stream(W, i);
    if (!st) continue;
    const step = 14;
    let prev = null;
    for (let s = 20; s < st.s1; s += step) {
      const wx = streamX(st, s), d = bfAt(W, wx) + s;
      const y = W.H(wx, d) + 0.3;
      const cur = [wx, y, d];
      if (prev && inD((prev[2] + d) / 2, dLo, dHi) && inX(ctx, wx, 20)) {
        const r = Math.max(1.1, 0.0014 * d);
        const c = hh(Math.round(s), i, 3) < 0.7 ? C.ice : [0.6, 0.68, 0.74];
        strut(out, prev[0] - ctx.x0, prev[1], -prev[2], wx - ctx.x0, y, -d, r, c, 1, 1, KIND.GROUND);
      }
      prev = cur;
    }
    // at the foot the stream fans out over the bed
    if (out.due()) yield;
  }
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
      const v = valleyAt(W.ws, wx);
      let y;
      if (d > v.bn - 60 && d < v.bf + 300) y = v.fy + 4 + 22 * r();
      else if (d > v.bf + 500 && r() < 0.35) y = W.H(wx, d) + 10 + 30 * r();
      else continue;
      const high = y > v.fy + 40;
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
// Level 1
// ---------------------------------------------------------------------------------------------
// Scale: a giant yak standing on the facing ridge.
const GYCELL = 6500;
function* giantYaks(ctx, out, W, dLo, dHi, amount) {
  for (const { i, wx0 } of cellsAround(ctx, GYCELL, 400)) {
    const r = worldRng(ctx, 1401, i);
    if (r() > 0.7 * amount) continue;
    const wx = wx0 + GYCELL * (0.2 + 0.6 * r());
    const s = ridgeS(W.ws, wx) * (0.84 + 0.06 * r());
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
    const ay = W.H(ax, d) + 2.2, by = W.H(ax + len, d) + 2.2;
    for (const [px, py] of [[ax, ay], [ax + len, by]]) if (inX(ctx, px, 1)) strut(out, px - ctx.x0, py - 2.3, -d, px - ctx.x0, py, -d, 0.06, C.pole, 2, 1, KIND.OTHER);
    yield* flagString(ctx, out, { a: [ax, ay, d], b: [ax + len, by, d], sag: 0.03, seed: hashInts(W.ws, 1503, i), fw: 0.3 }, ctx.zNear, ctx.zFar);
  }
  // boulders and snow on the slope
  for (const { i, wx0 } of cellsAround(ctx, 9, 2)) {
    const r = worldRng(ctx, 1504, i);
    if (r() > 0.3) continue;
    const wx = wx0 + 9 * r(), d = 10 + 18 * r(), rad = 0.3 + 0.8 * r() * r();
    yield* blob(ctx, out, wx - ctx.x0, W.H(wx, d) + rad * 0.2, d, rad, rad * 0.6, rad * 0.8, { n: 14, color: mix3(C.rock, C.stone, r()), rng: r, kind: KIND.ROCK, inner: 0.25, amb: 0.5, clump: 0.2 });
  }
  out.limit = Infinity;
  const rest = out.left();
  yield* fillStrip(ctx, out, W, Math.round(rest * 0.06), 2.5, 4.2, (wx, d, rng) => jitter(C.ballast, rng, 0.25), 0, 0.12);
  yield* fillStrip(ctx, out, W, Math.round(rest * 0.06), 4.2, 7, (wx, d, rng) => jitter(rng() < 0.15 ? C.snow : C.shelf, rng, 0.2), 0, 0.12);
  yield* fillSurface(ctx, out, W, { dNear: 7, power: 1.2, cover: 4.2, tuft: 30 });
}

function* near(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.1 });
  const dz = ctx.dials || {};
  out.limit = ctx.count * 0.62;
  const lo = ctx.zNear, hi = ctx.zFar;
  yield* bridges(ctx, out, W, lo, hi);
  yield* hamlets(ctx, out, W, lo, hi);
  yield* flagSites(ctx, out, W, lo, hi);
  yield* herds(ctx, out, W, lo, hi);
  yield* sheepGroups(ctx, out, W, lo, hi);
  yield* scatter(ctx, out, W, lo, hi);
  if ((dz.logic || 0) > 0) yield* repeatingChorten(ctx, out, W, dz.logic);
  if ((dz.scale || 0) > 0) yield* giantStrings(ctx, out, W, lo, hi, dz.scale);
  yield* mist(ctx, out, W, 120, hi, 50, 35, 0.12);
  yield* fillSurface(ctx, out, W, { power: 1.5, cover: 3.2, tuft: 90 });
}

function* mid(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.6 });
  const dz = ctx.dials || {};
  out.limit = ctx.count * 0.6;
  const lo = ctx.zNear, hi = ctx.zFar;
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
  if ((dz.scale || 0) > 0) { yield* giantYaks(ctx, out, W, lo, hi, dz.scale); yield* giantStrings(ctx, out, W, lo, hi, dz.scale); }
  if ((dz.topology || 0) > 0) yield* skyStrings(ctx, out, W, lo, hi, dz.topology);
  yield* mist(ctx, out, W, lo, hi, 150, 110, 0.2);
  yield* fillSurface(ctx, out, W, { power: 1.15, cover: 3.2, maxR: 0.05 });
}

function* far(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 600 });
  const dz = ctx.dials || {};
  const lo = ctx.zNear, hi = ctx.zFar;
  yield* banners(ctx, out, W, lo, hi);
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
  return up * 4200 * Math.pow(P, 10) * st * smooth(5000, 8000, d);
}

function* farRange(ctx, out, W, up) {
  out.limit = Infinity;
  const n = out.left();
  const rng = ctx.rng;
  const dn = ctx.zNear, df = ctx.zFar, L = ctx.length;
  const Z = Math.log(df / dn);
  const Hs = up > 0 ? (wx, d) => W.H(wx, d) + needle(W, wx, d, up) : W.H;
  // Most of the far ground hides behind the facing ridge: find, along x, the highest angle the
  // ridge reaches (conservatively: the lowest such angle a little either way) and spend the splats
  // on what rises above it.
  const OX = 100, M = 900, occ = [];
  for (let wx = ctx.x0 - M; wx <= ctx.x0 + L + M; wx += OX) {
    let a = -1;
    for (const dd of [700, 1200, 1700, 2200, 2600, 3000]) a = Math.max(a, (W.H(wx, dd) - 2.6) / dd);
    occ.push(a);
  }
  const occMin = occ.map((_, k) => { let m = Infinity; for (let j = Math.max(0, k - 8); j <= Math.min(occ.length - 1, k + 8); j++) m = Math.min(m, occ[j]); return m; });
  const hidden = (x, d, y) => (y - 2.6) / d < occMin[Math.round((x + M) / OX)] - 0.012;
  let vis = 0;
  for (let k = 0; k < 300; k++) {
    const d = dn * Math.pow(df / dn, rng()), x = rng() * L;
    if (!hidden(x, d, Hs(ctx.x0 + x, d))) vis++;
  }
  const fv = clamp(vis / 300, 0.15, 1);
  for (let i = 0; i < n; i++) {
    let d = 0, x = 0, wx = 0, y = 0;
    for (let t = 0; t < 6; t++) {
      d = t === 0 ? dn * Math.pow(df / dn, (i + rng()) / n) : dn * Math.pow(df / dn, rng());
      x = rng() * L; wx = ctx.x0 + x;
      y = Hs(wx, d);
      if (!hidden(x, d, y)) break;
    }
    const dens = (n / d / Z) / L / fv;
    let r = clamp(Math.sqrt(2.6 / (Math.PI * dens)), 0.0012 * d, 0.03 * d);
    const ex = up > 0 ? needle(W, wx, d, up) : 0;
    if (ex > 300) r = Math.min(0.05 * d, r * (1 + Math.min(2, ex / 1200)));
    const e = Math.max(40, r);
    const hx = (Hs(wx + e, d) - y) / e, hd = (Hs(wx, d + e) - y) / e;
    const nn = norm3(-hx, 1, hd);
    const slope = 1 - nn[1];
    const lit = Math.max(0, nn[0] * SUN[0] + nn[1] * SUN[1] + nn[2] * SUN[2]);
    const sl = 1350 + 300 * noise2(wx / 2500, d / 2500, W.ws + 111) + 200 * (noise2(wx / 250, d / 200, W.ws + 112) - 0.5);
    let c;
    if (y < 700) c = mix3(C.grassDry, C.scree, smooth(200, 700, y));
    else c = mix3(C.rock, C.rockDark, noise2(wx / 200, d / 150, W.ws + 113));
    const fur = ridge(fbm2(wx / 520, d / 1700, W.ws + 114, 2));
    const furrow = smooth(0.45, 0.2, fur);
    c = mul3(c, 1 - 0.3 * furrow);
    // glaciers: the gentler hollows between the ridges at middle heights, grey-white with dark
    // moraine stripes running down them
    const glac = smooth(0.3, 0.1, slope) * smooth(800, 1100, y) * smooth(0.5, 0.25, fur) * (1 - smooth(sl - 100, sl + 200, y));
    const snowy = smooth(sl - 60, sl + 60, y + 380 * furrow - 200 * smooth(0.5, 0.8, fur) - 700 * Math.max(0, slope - 0.55));
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
    const q = quatUpTo(nn[0], nn[1], nn[2]);
    const ax = 0.8 + 0.5 * rng();
    out(x, y, -d, r * ax, r * 0.15, r * (1.8 - ax), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], ex > 50 ? KIND.SURREAL : KIND.GROUND);
    if (out.due()) yield;
  }
}

export const himalayaBiome = {
  name: 'himalaya',
  palette: PAL,
  // the shape numbers are unused: the valley comes from heightAt() through local()
  terrain: TERRAIN,
  hazeDist: 12000,
  sky: { stars: 1.3, deep: 0.8, milkyWay: 0.8, clear: 0.4 },   // thin, clear air: a rich sky on the rare night here
  generators: { trackside, near, mid, far },
};

// ---------------------------------------------------------------------------------------------
// For scripts that inspect the layout, e.g.
//   const { _debug } = await import('./src/window/biomes/himalaya.js');
//   _debug.layout('7', 0, 20000)   -> { villages, gompas, hamlets, flagSites, herds, sheep, bridges, ridgeStrings }
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
  };
}
export const _debug = { world, at, layout, valleyAt, heightAt, surface, village, gompa, hamlet, flagSite, herd, sheepGroup, bridge };
