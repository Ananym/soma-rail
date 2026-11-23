// "Monsoon": northern Vietnam in the rains, seen from a train. The one scenery whose whole
// character is the weather: it is always raining, harder and softer by turns, under a low grey sky.
//
// Two kinds of country take turns along the line (slow world noise, `v` below):
//   the plain   the line runs on an embankment some six to eight metres above a delta of flooded
//               paddies cut by dykes (lotus ponds in some stretches, family tombs out in the
//               fields), the road on its own dyke beside it, villages of narrow pastel tube houses
//               along the road, hamlets in rings of palms and bamboo out among the fields, a brick
//               kiln smoking, a swollen brown river a few hundred metres out with sampans and a
//               ferry, and wooded hills behind with terraced lower slopes, their tops in the cloud;
//   the valley  the line runs high on a hillside, the road on a shelf below it; beyond the shelf
//               the ground drops to a valley floor and a brown river, and the far side climbs in
//               curved terraces (Mu Cang Chai, Sa Pa) to forest, then mountains lost in cloud,
//               white threads of water running down them. Stilt houses stand among the terraces.
// The road keeps the same distance from the line all the way, so the mopeds on it can ride
// (MOVE.RIDE); its level eases down into the valley stretches over a kilometre or so.
//
// What makes it read as rain (more than any one thing):
//   - rain falling everywhere in the trackside and near bands (MOVE.FALL streaks), emitted first so
//     no budget squeezes it out, in sheets that come and go along the line (X.rain) but never stop;
//     grey veils of rain hanging from the cloud far off;
//   - wet light: sky.overcast, a short haze, saturated wet greens, dark wet earth and asphalt with
//     puddles, and bright things against it: ponchos, conical hats, lit shop signs, headlamps;
//   - water everywhere: paddies that mirror the grey sky with dark dykes between, puddles, the
//     brown river, streams off the hills, rings where the drops strike the nearest water;
//   - cloud lying on the hills (cloudCap) and mist drifting low in the valleys (lowMist), VAPOUR.
//
// Structure (as alps.js): one pure layout of WORLD x and distance, hashed from the world seed and
// cached per world. This file's own height function (heightAt) is handed to the kit through a copy
// of ctx (local()), so every band stands on the same ground. Everything that depends on x alone is
// tabulated per metre in blocks (xAt); the smooth hills and the terrace mask are tabulated in tiles
// (makeTable) and the terraces are cut exactly on top of them (terraceCut), so steps never smear.
// The terraces are drawn twice over: the ground fill paints treads, bunds and risers, and
// terraceLines draws each riser's top along its contour as a dark bund and a line of water or rice,
// so they read as steps from a kilometre off. (xAt returns a shared object that the site functions
// also move: copy what you need from it before calling anything that may lay out a site.)
//
// The beat: buildings, trees and lights answer it (beatKinds); people and animals flash
// (MOVE.FLASH), boats and parked mopeds are rigid (MOVE.STILL), whatever rides the road rides.
//
// Surreal dials (all 0 at level 0, so level 0 shows none of this):
//   scale     giant lotus standing in the paddies and ponds
//   topology  terraces stepping on up off the hilltops into the cloud, like a stair
//   logic     paper lanterns drifting lit in the mist
//   matter    lotus petals falling with the rain
// (Rain falling upward was considered, but the shader's FALL only runs downward.)
import { hashInts, hashString, makeRng, noise1, noise2, fbm2 } from '../rng.js';
import { makeTerrain } from '../terrain.js';
import {
  KIND, MOVE, makeOut, worldSeed, worldRng, cellsAround, detail, shade, jitter, mul3, mix3, smooth,
  clamp, lerp, quatYaw, quatMul, quatXTo, rotY, SUN, strut, blob, treeSplats, flightCell, flyBody, flyWing, Q_ID,
  rideCell, FLY_CELL, broadleaf as kitBroadleaf,
} from './kit.js';

const PAL = {
  ground: [0.3, 0.42, 0.2],       // wet paddy green: also the backdrop below the horizon
  foliage: [0.1, 0.22, 0.09],
  rock: [0.46, 0.46, 0.44],
  ballast: [0.34, 0.33, 0.31],
};

// Colours, for flat grey light: natural surfaces stay <= 0.8 per channel.
const C = {
  ballast: [0.3, 0.29, 0.28],
  sleeper: [0.24, 0.22, 0.2],
  cess: [0.3, 0.27, 0.2],
  bank: [0.24, 0.4, 0.13],
  bankDark: [0.16, 0.28, 0.1],
  grass: [0.27, 0.45, 0.14],
  grassWet: [0.2, 0.38, 0.12],
  water: [0.6, 0.64, 0.66],        // a flooded paddy: the grey sky in it
  waterDark: [0.46, 0.5, 0.52],
  waterMud: [0.44, 0.4, 0.32],
  young: [0.46, 0.66, 0.2],        // rows of rice just set out
  rice: [0.36, 0.58, 0.14],
  riceDeep: [0.22, 0.44, 0.1],
  mud: [0.32, 0.26, 0.19],
  dyke: [0.2, 0.3, 0.11],
  dykeTop: [0.28, 0.36, 0.15],
  road: [0.2, 0.2, 0.21],          // wet asphalt
  roadWet: [0.42, 0.44, 0.46],     // its sheen and puddles
  roadEdge: [0.36, 0.34, 0.3],
  verge: [0.3, 0.27, 0.19],
  river: [0.47, 0.37, 0.25],       // brown, swollen
  riverPale: [0.56, 0.47, 0.35],
  riverBank: [0.34, 0.28, 0.2],
  riser: [0.15, 0.27, 0.09],       // the grassy wall of a terrace
  riserDark: [0.09, 0.17, 0.06],
  lip: [0.1, 0.14, 0.07],          // the bund along the edge of a terrace
  forest: [0.08, 0.19, 0.08],
  forestLit: [0.16, 0.32, 0.11],
  forestMass: [0.05, 0.12, 0.05],
  scrub: [0.2, 0.34, 0.12],
  rock: [0.46, 0.46, 0.44],
  rockDark: [0.26, 0.27, 0.27],
  yard: [0.4, 0.38, 0.34],
  earth: [0.36, 0.27, 0.18],
  stream: [0.74, 0.76, 0.76],
  mist: [0.78, 0.79, 0.8],
  cloud: [0.74, 0.75, 0.77],
  rain: [0.72, 0.75, 0.79],
};

const TERRAIN = { cutting: 1.0 };   // unused: the land comes from heightAt() through local()
const CAMY = 2.6;

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
const STL = MOVE.STILL, FL = MOVE.FLASH, KO = KIND.OTHER;   // STL: rigid things (boats, parked mopeds): nothing on the beat
function hourOf(ctx) { const h = ctx.hour != null ? ctx.hour : 12; return ((h % 24) + 24) % 24; }
// Under the cloud the lights come on early: from late afternoon until well after dawn.
function lightsOn(ctx) { const h = hourOf(ctx); return h > 15.5 || h < 7.2; }
// For scripts that look for things: globalThis.__monsoonLog = [] collects { what, wx, d }.
function note(what, wx, d) { const log = globalThis.__monsoonLog; if (log) log.push({ what, wx: Math.round(wx), d: Math.round(d) }); }
const inX = (ctx, wx, m = 0) => wx >= ctx.x0 - m && wx < ctx.x0 + ctx.length + m;
const pick = (list, r) => list[Math.min(list.length - 1, Math.floor(r() * list.length))];

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
// A thin straight member from a to b (splat space), r thick, with a kind and a motion class.
function bar(out, ax, ay, az, bx, by, bz, r, c, n = 2, kind = KO, move = 0, o = 1) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1e-6;
  const q = quatXTo(dx / len, dy / len, dz / len), sl = (len / n) * 0.5;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    out(ax + dx * t, ay + dy * t, az + dz * t, Math.max(sl, r), r, r, c[0], c[1], c[2], o, q[0], q[1], q[2], q[3], kind, move);
  }
}
// How thick a thin thing must be drawn at distance d to stay a line.
const thin = (d, k = 1) => Math.max(0.035, 0.0006 * d) * k;
// Tone for a vertical face with outward normal (nx, nz) in splat space. Under cloud the light is
// flat, so the faces differ less than in sun, but enough that the corners read in motion.
function faceTone(c, nx, nz) {
  const k = 0.7 + 0.18 * Math.max(0, nz) + 0.22 * Math.max(0, -nx) - 0.1 * Math.max(0, nx) - 0.12 * Math.max(0, -nz);
  return [c[0] * k, c[1] * k, c[2] * k];
}
// Flat light: a little brighter on top, no sun.
function soft(c, ny, k = 1) { const f = (0.82 + 0.16 * ny) * k; return [c[0] * f, c[1] * f, c[2] * f]; }
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
  W.base = makeTable((wx, d) => smoothH(W, wx, d), 200, 0.022, 0.02, 96);
  W.mask = makeTable((wx, d) => maskRaw(W, wx, d), 200, 0.022, 0.02, 96);
  W.H = (wx, d) => heightAt(W, wx, d);
  W.terr = { height: W.H, stretch: ctx.terrain.stretch, shape: ctx.terrain.shape };
  worlds.set(ws, W);
  if (worlds.size > 6) worlds.delete(worlds.keys().next().value);
  return W;
}
// A copy of ctx standing on this country; every kit call must get this one.
function local(ctx) { const W = world(ctx); return [{ ...ctx, terrain: W.terr }, W]; }
function cache(W, type, i, make) {
  const key = type * 1048576 + i;
  let v = W.misc.get(key);
  if (v === undefined) { v = make(); if (W.misc.size > 60000) W.misc.clear(); W.misc.set(key, v); }
  return v;
}
// Tiles of a smooth function of (wx, d): rows at log-spaced distances, columns about two per cent
// of the distance apart, made on first use and interpolated bilinearly (after alps.js).
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
const ST = { VILLAGE: 1, PADDY: 2, MISC: 3, STILT: 4, PAGODA: 5, STATION: 6, MARKET: 7, LIFE: 8, BOAT: 9, FERRY: 10, STREAM: 11, POLE: 12, RIDER: 13, CLUMP: 14, VEIL: 15, LOTUS: 16, LANTERN: 17, STAIR: 18, HERD: 19, DUCKS: 20, WALK: 21, TREE: 22 };

// --- everything that depends on world x alone, tabulated per metre in blocks of 256 m ---
//   v    0..1: plain (0) or valley (1)             fy   the level of the plain (and of the shelf)
//   rd   the road's centre line                    rdY  the road's level (on its dyke, or its shelf)
//   dA   where the shelf ends (valley)             dB   where the drop reaches the valley floor
//   vf   the valley floor's level                  ft   where the far side begins to climb
//   rc   the river's centre line                   rw   its width (along d)
//   wl   the river's surface level                 rain 0..1: how hard it is raining here
//   fl   the floor's level beyond the shelf (plain: fy, valley: vf, between: between)
const XB = 256, XF = 14;
function rawX(W, wx, a, o) {
  const ws = W.ws;
  const v = smooth(0.4, 0.6, noise1(wx / 3400, ws + 11));
  // (in the valley the road's shelf lies further below the line, so the eye looks down into it)
  const rdY = -5.4 - 4.4 * v + 0.9 * (noise1(wx / 2600, ws + 12) - 0.5);
  const fy = rdY - 0.9;
  const rd = 37 + 4 * (noise1(wx / 7000, ws + 13) - 0.5);
  const dA = rd + 7;
  const dB = dA + 50 + 34 * noise1(wx / 1300, ws + 14);
  const vf = fy - (28 + 16 * noise1(wx / 2100, ws + 15));
  const fl = lerp(fy, vf, v);
  const ftV = Math.max(dB + 160, 300) + 110 * noise1(wx / 1700, ws + 16);
  const ftP = 520 + 760 * noise1(wx / 2900, ws + 17) + 150 * noise1(wx / 700, ws + 18);
  const ft = lerp(ftP, ftV, v);
  const rcP = 190 + 170 * noise1(wx / 1900, ws + 19) + 50 * noise1(wx / 450, ws + 20);
  const rwP = 52 + 34 * noise1(wx / 800, ws + 21), rwV = Math.min(70, (ft - dB) * 0.4);
  const rcV = ft - 18 - rwV / 2 - 12 * noise1(wx / 600, ws + 23);
  const rw = lerp(rwP, rwV, v);
  let rc = lerp(rcP, rcV, v);
  rc = clamp(rc, dA + 30 + rw / 2 + (1 - v) * 40, ft - 20 - rw / 2);
  a[o] = v; a[o + 1] = fy; a[o + 2] = rd; a[o + 3] = rdY; a[o + 4] = dA; a[o + 5] = dB; a[o + 6] = vf;
  a[o + 7] = ft; a[o + 8] = rc; a[o + 9] = rw; a[o + 10] = fl - 1.6;
  a[o + 11] = 0.34 + 0.66 * smooth(0.22, 0.78, noise1(wx / 1150, ws + 22));
  a[o + 12] = fl;
  a[o + 13] = stationAmt(W, wx);
}
// How far a station's shelf reaches here (0..1): it is cut into the top of the bank.
function stationAmt(W, wx) {
  const i = Math.floor(wx / STACELL);
  let m = 0;
  for (const j of [i - 1, i, i + 1]) { const s = station(W, j); if (s) m = Math.max(m, smooth(s.x0 - 60, s.x0 - 10, wx) * smooth(s.x0 + s.len + 60, s.x0 + s.len + 10, wx)); }
  return m;
}
const X = { v: 0, fy: 0, rd: 0, rdY: 0, dA: 0, dB: 0, vf: 0, ft: 0, rc: 0, rw: 0, wl: 0, rain: 0, fl: 0, hs: 0 };
let XW = null, XWX = NaN;
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
  const f = wx - b * XB, i = Math.min(XB - 1, Math.floor(f)), t = f - i, o = i * XF, p = o + XF;
  X.v = a[o] + (a[p] - a[o]) * t;
  X.fy = a[o + 1] + (a[p + 1] - a[o + 1]) * t;
  X.rd = a[o + 2] + (a[p + 2] - a[o + 2]) * t;
  X.rdY = a[o + 3] + (a[p + 3] - a[o + 3]) * t;
  X.dA = a[o + 4] + (a[p + 4] - a[o + 4]) * t;
  X.dB = a[o + 5] + (a[p + 5] - a[o + 5]) * t;
  X.vf = a[o + 6] + (a[p + 6] - a[o + 6]) * t;
  X.ft = a[o + 7] + (a[p + 7] - a[o + 7]) * t;
  X.rc = a[o + 8] + (a[p + 8] - a[o + 8]) * t;
  X.rw = a[o + 9] + (a[p + 9] - a[o + 9]) * t;
  X.wl = a[o + 10] + (a[p + 10] - a[o + 10]) * t;
  X.rain = a[o + 11] + (a[p + 11] - a[o + 11]) * t;
  X.fl = a[o + 12] + (a[p + 12] - a[o + 12]) * t;
  X.hs = a[o + 13] + (a[p + 13] - a[o + 13]) * t;
  return X;
}
// The values of xAt() at a world x, copied (xAt returns a reused object).
function xCopy(W, wx) { const x = xAt(W, wx); return { ...x }; }

// ---------------------------------------------------------------------------------------------
// The height function
// ---------------------------------------------------------------------------------------------
// The far side above its foot (s = distance beyond the foot): wooded hills that climb steeply, in
// rounded domes and spurs, eased so that no summit stands taller than the window can show (the
// cloud takes the tops anyway).
function wallH(W, wx, d, s) {
  const ws = W.ws;
  const k = 0.3 + 0.14 * noise2(wx / 1300, d / 2400, ws + 51);
  let h = k * s * (0.3 + 0.7 * s / (s + 260));
  // domes and saddles along the range (the terraced lower slopes keep an even climb), and the
  // spurs and gullies of the lower slopes
  h *= lerp(1, 0.45 + 1.1 * fbm2(wx / 1500, d / 1100, ws + 52, 3), smooth(150, 900, s));
  // spurs and gullies running down the slope: they bend the terraces' contours into curves
  h += (noise2(wx / 260, d / 520, ws + 55) - 0.5) * 2 * Math.min(75, 0.36 * s) + (noise2(wx / 120, d / 260, ws + 58) - 0.5) * 2 * Math.min(22, 0.12 * s) + (noise2(wx / 85, d / 70, ws + 56) - 0.5) * 3 * smooth(0, 150, s);
  // limestone knolls standing out of the forest here and there
  const kn = noise2(wx / 520, d / 520, ws + 57);
  if (kn > 0.62) h += (kn - 0.62) * (kn - 0.62) * 2600 * smooth(150, 700, s);
  h = Math.max(h, 0);
  const lim = 0.3 * d, knee = 0.75 * lim;
  if (h > knee) h = knee + (lim - knee) * Math.tanh((h - knee) / (lim - knee));
  return h;
}
// The smooth land: bank, plain (or shelf and drop), floor and the far side.
function smoothH(W, wx, d) {
  const x = xAt(W, wx);
  if (d < 4.6) return d < 2.5 ? 0 : -0.3 * smooth(2.5, 4.6, d);
  const fy = x.fy, sh = x.hs * 16, bEnd = 5 + 1.6 * -fy + sh;
  if (d < 4.6 + sh) return -0.3;
  if (d < bEnd) {
    const t = (d - 4.6 - sh) / (bEnd - 4.6 - sh);
    return -0.3 + (fy + 0.3) * (1 - (1 - t) * (1 - t) * (1 - 0.5 * t)) + (noise2(wx / 9, d / 5, W.ws + 42) - 0.5) * 0.4 * t * (1 - t) * 4;
  }
  let h = fy + (noise2(wx / 61, d / 47, W.ws + 41) - 0.5) * 0.3;
  // the road on its dyke (plain) or its shelf (valley)
  const ad = Math.abs(d - x.rd);
  if (ad < 6) h = lerp(h, x.rdY, smooth(6, 4, ad));
  // the drop from the shelf to the valley floor
  if (x.v > 0 && d > x.dA) h += (x.vf - fy) * x.v * smooth(0, 1, Math.min(1, (d - x.dA) / (x.dB - x.dA)));
  const s = d - x.ft;
  if (s > 0) h += wallH(W, wx, d, s);
  return h;
}
// How much of the land here is cut into terraces (0..1), before the cut: the drop below the shelf
// in the valley, and the lower slopes of the far side where the noise allows (more in the valley).
function maskRaw(W, wx, d) {
  const x = xAt(W, wx);
  let m = 0;
  if (x.v > 0.05 && d > x.dA + 2 && d < x.dB + 2) m = x.v * smooth(x.dA + 2, x.dA + 8, d);
  const s = d - x.ft;
  if (s > 0) {
    const tn = noise2(wx / 760, d / 520, W.ws + 31) + 0.3 * x.v - 0.08;
    m = Math.max(m, smooth(0, 40, s) * smooth(0.36, 0.5, tn));
  }
  return m;
}
// The terraces: the height above the floor cut into steps S high, each a level tread and a steep
// grassed riser (RW of the run). TA holds what the last call found, for paint().
const RW = 0.32;
const TA = { m: 0, i: 0, f: 0, S: 1, rel: 0 };
function stepOf(d) { return 2.4 + 0.0085 * Math.min(d, 1400); }
function terraceCut(h, fl, d, m) {
  TA.m = m;
  if (m <= 0.02) { TA.rel = h - fl; return h; }
  const S = stepOf(d), q = (h - fl) / S, i = Math.floor(q), f = q - i;
  TA.i = i; TA.f = f; TA.S = S; TA.rel = h - fl;
  const ht = fl + S * (i + smooth(1 - RW, 1, f));
  return h + (ht - h) * smooth(0.02, 0.35, m);
}
// The full height: the smooth land (direct near the line, from the tables beyond), the terraces,
// the river's channel and, on the plain, the dykes between the paddies.
let HW = null, HX = NaN, HD = NaN, HV = 0;
function heightAt(W, wx, d) {
  if (wx === HX && d === HD && W === HW) return HV;
  let h, m;
  if (d < 215) { h = smoothH(W, wx, d); m = d > 20 ? maskRaw(W, wx, d) : 0; } else { h = W.base(wx, d); m = d < 2600 ? W.mask(wx, d) : 0; }
  const x = xAt(W, wx);
  // (the terraces climb no higher than about 200 m above the floor: above them, forest)
  if (m > 0) m *= 1 - smooth(170, 240, h - x.fl);
  h = terraceCut(h, x.fl, d, m);
  const ad = Math.abs(d - x.rc), hw = x.rw * 0.5;
  if (ad < hw + 7) h = lerp(h, x.wl, smooth(hw + 7, hw + 0.5, ad));
  HW = W; HX = wx; HD = d; HV = h;
  return h;
}

// ---------------------------------------------------------------------------------------------
// The paddy grid on the flat ground: rows parallel to the line that widen with distance, cut into
// fields along it; between them dykes, a little raised. A field is flooded (the sky in it), set out
// in young rice, grown green, or just ploughed (brown water).
// ---------------------------------------------------------------------------------------------
const PT = { WATER: 0, YOUNG: 1, RICE: 2, MUD: 3, POND: 4 };
const PG = { j: 0, k: 0, fu: 0, fv: 0, dyke: false, t: 0, tone: 1 };
function rowOf(d) { return Math.log(8 + 0.11 * d) / 0.11; }
function paddyAt(W, wx, d) {
  const g = rowOf(d) * 0.62, j = Math.floor(g), fv = g - j;
  const rw = (8 + 0.11 * d) / 0.62;                // the row's width in metres here
  const len = 28 + 0.16 * d + 22 * worldHashF(W, 3, j);
  const u = (wx + 977 * worldHashF(W, 4, j)) / len, k = Math.floor(u), fu = u - k;
  const dw = 0.35 + 0.0035 * d;                    // half the width of a dyke
  PG.j = j; PG.k = k; PG.fu = fu; PG.fv = fv;
  PG.dyke = fv * rw < dw || (1 - fv) * rw < dw || fu * len < dw || (1 - fu) * len < dw;
  const hsh = worldHashF(W, 5, j * 7919 + k);
  // (stretches where many of the fields are lotus ponds)
  const pond = 0.04 + 0.26 * smooth(0.58, 0.75, noise1(wx / 1300, W.ws + 7));
  PG.t = hsh < pond ? PT.POND : hsh < 0.5 ? PT.WATER : hsh < 0.78 ? PT.YOUNG : hsh < 0.9 ? PT.RICE : PT.MUD;
  PG.tone = 0.92 + 0.16 * worldHashF(W, 6, j * 131 + k);
  return PG;
}
function worldHashF(W, salt, i) { return hashInts(W.ws, salt, i | 0) / 4294967296; }

// ---------------------------------------------------------------------------------------------
// What covers the ground at a point, and its colour (a reused object: never hold it).
// ---------------------------------------------------------------------------------------------
const T = { BALLAST: 0, BANK: 1, PADDY: 2, DYKE: 3, ROAD: 4, VERGE: 5, RIVER: 6, RBANK: 7, TREAD: 8, LIP: 9, RISER: 10, FOREST: 11, SCRUB: 12, ROCK: 13, YARD: 14, WATER: 15 };
const PA = { t: 0, c: [0, 0, 0], f: 0, wet: 0 };
function setc(c, a, k = 1) { c[0] = a[0] * k; c[1] = a[1] * k; c[2] = a[2] * k; }
function mixc(c, a, b, t) { c[0] = a[0] + (b[0] - a[0]) * t; c[1] = a[1] + (b[1] - a[1]) * t; c[2] = a[2] + (b[2] - a[2]) * t; }
// Is this point inside a village's built ground? (filled in by the sites below; 0 = no)
function yardAt(W, wx, d) { return villageYard(W, wx, d); }
function paint(W, wx, d, y, nx, ny, nz, rng) {
  heightAt(W, wx, d);              // (leaves the terrace in TA; first, since it may fill a table and move X)
  const yd = d > 30 ? yardAt(W, wx, d) : 0;   // (also before X is read: the village sites move it)
  const x = xAt(W, wx), c = PA.c;
  PA.wet = 0; PA.f = 0;
  const j = rng() - 0.5;
  if (d < 4.6) { PA.t = T.BALLAST; setc(c, d < 2.6 ? C.sleeper : C.ballast, 1 + j * 0.3); return PA; }
  const bEnd = 5 + 1.6 * -x.fy + x.hs * 16;
  if (x.hs > 0.5 && d < 4.6 + x.hs * 16) { PA.t = T.YARD; setc(c, C.yard, 1 + j * 0.2); return PA; }
  const ar = Math.abs(d - x.rc), hw = x.rw * 0.5;
  if (ar < hw) {
    PA.t = T.RIVER; PA.wet = 1;
    // brown, swollen water: paler in long streaks where it runs fastest, darker by the banks
    const st = noise2(wx / 70, d / 9, W.ws + 71), edge = smooth(hw, hw * 0.6, ar);
    mixc(c, C.river, C.riverPale, smooth(0.55, 0.8, st) * edge);
    const k = (0.9 + 0.1 * edge) * (1 + j * 0.05);
    c[0] *= k; c[1] *= k; c[2] *= k;
    return PA;
  }
  if (ar < hw + 7) { PA.t = T.RBANK; mixc(c, C.riverBank, C.grassWet, smooth(hw + 1, hw + 7, ar)); const k = 1 + j * 0.2; c[0] *= k; c[1] *= k; c[2] *= k; return PA; }
  if (d < bEnd) { PA.t = T.BANK; mixc(c, C.bank, C.bankDark, rng() * 0.6); return PA; }
  const ad = Math.abs(d - x.rd);
  if (ad < 3.3) {
    PA.t = T.ROAD; PA.wet = 1;
    // wet asphalt: dark, with a sheen and puddles that hold the sky
    const pud = noise2(wx / 7, d / 2.2, W.ws + 73);
    if (pud > 0.66) mixc(c, C.road, C.roadWet, smooth(0.66, 0.74, pud)); else setc(c, C.road, 1 + j * 0.1 + 0.25 * smooth(2.4, 3.3, ad));
    return PA;
  }
  if (ad < 6) { PA.t = T.VERGE; mixc(c, C.verge, C.grassWet, smooth(3.6, 6, ad) * (0.5 + rng() * 0.5)); return PA; }
  if (yd) { PA.t = T.YARD; mixc(c, C.yard, C.earth, rng() * 0.5); if (yd > 1) setc(c, C.grassWet); return PA; }
  // terraces
  if (TA.m > 0.25 && d > 230) {
    // (far off the contour lines carry the steps: under them the fill is one even, dark green, so
    // it adds no speckle of its own)
    PA.t = T.RISER; PA.f = 0.9;
    mixc(c, C.riser, C.rice, 0.45 + 0.1 * rng());
    return PA;
  }
  if (TA.m > 0.25) {
    const f = TA.f;
    PA.f = f;
    if (f < 0.07) { PA.t = T.LIP; setc(c, C.lip, 0.9 + 0.2 * rng()); return PA; }
    if (f < 1 - RW) {
      PA.t = T.TREAD;
      const st = treadState(W, wx, d, TA.i, x.v);
      if (st === 0) { PA.wet = 1; mixc(c, C.water, C.waterDark, smooth(0.05, 0.6, f) * 0.4); }
      else if (st === 1) { PA.wet = 0.5; mixc(c, C.water, C.young, d < 120 && rng() < 0.5 ? 0.9 : 0.55); }
      else setc(c, rng() < 0.2 ? C.riceDeep : C.rice, 0.95 + 0.1 * rng());
      // (far off a fill splat spans several steps: there the lines carry the treads, over a riser green)
      if (d > 260) { PA.wet = 0; mixc(c, c, C.riser, smooth(260, 600, d) * 0.6); }
      return PA;
    }
    PA.t = T.RISER;
    mixc(c, C.riser, C.riserDark, smooth(1 - RW, 1, f) * 0.7 + 0.3 * rng());
    return PA;
  }
  const s = d - x.ft;
  if (s > -10 && TA.rel > 3) {
    // the far side: forest, scrub on the steeper open ground, limestone where it is steepest
    const fo = noise2(wx / 400, d / 300, W.ws + 81) + 0.2 * smooth(20, 120, TA.rel);
    if (ny < 0.55 && noise2(wx / 150, d / 120, W.ws + 82) > 0.68) { PA.t = T.ROCK; mixc(c, C.rock, C.rockDark, rng() * 0.7); if (rng() < 0.35) setc(c, C.forest, 1.2); return PA; }
    if (fo > 0.42) { PA.t = T.FOREST; PA.f = fo; setc(c, C.forest); return PA; }
    PA.t = T.SCRUB; mixc(c, C.scrub, C.grass, rng() * 0.5);
    return PA;
  }
  if (x.v > 0.3 && d > x.dA && d < x.dB) { PA.t = T.SCRUB; mixc(c, C.grassWet, C.scrub, rng()); return PA; }
  if (x.v > 0.55 && d < x.rd) {
    // the bank below the line in the valley: grass, kitchen gardens in rows, bare wet earth
    const g = noise2(wx / 40, d / 12, W.ws + 75);
    PA.t = T.BANK;
    if (g > 0.6) { const row = Math.sin(d * 2.2) > 0; setc(c, row ? C.grass : C.earth, 0.85 + 0.2 * rng()); }
    else mixc(c, C.bank, C.grassWet, rng());
    return PA;
  }
  // the paddies of the plain (and of the valley floor)
  const p = paddyAt(W, wx, d);
  if (p.dyke) { PA.t = T.DYKE; mixc(c, C.dyke, C.dykeTop, rng()); return PA; }
  PA.t = T.PADDY;
  const tn = p.tone;
  switch (p.t) {
    case PT.WATER: PA.wet = 1; mixc(c, C.water, C.waterDark, 0.25 * rng() + 0.25 * smooth(0, 1, p.fv)); break;
    case PT.YOUNG: PA.wet = 0.5;
      // rows of young rice in the water: near the line, green and water by turns
      mixc(c, C.water, C.young, rng() < 0.45 ? 0.75 * tn : 0.25);
      break;
    case PT.RICE: setc(c, rng() < 0.3 ? C.riceDeep : C.rice, tn); break;
    case PT.MUD: PA.wet = 1; mixc(c, C.waterMud, C.mud, rng() * 0.5); break;
    default: PA.wet = 1; mixc(c, C.waterDark, C.dyke, 0.25 * rng()); break;
  }
  return PA;
}

// What grows on tread i of the terraces at this point: 0 flooded, 1 young rice in water, 2 green rice.
function treadState(W, wx, d, i, v) {
  const cell = Math.floor((wx + 53 * i) / (220 + 0.25 * d));
  const hsh = worldHashF(W, 9, i * 4099 + cell), wetter = 0.4 + 0.25 * v;
  return hsh < wetter ? 0 : hsh < wetter + 0.2 ? 1 : 2;
}
// The terraces drawn as lines along their contours, so that they read as steps from any distance.
// Columns stand on a world grid (the same in every chunk and band); in each, a march outward over
// the slope finds where each step's riser tops out (the contour rel = S*i). The same step in
// neighbouring columns is joined by long thin splats laid along the contour, overlapping: a dark
// bund, and below it a band of the tread's tone (flooded and grey, young rice, deep green), the
// tone changing only in long runs along the contour. A segment belongs to the chunk and band its
// middle falls in, so the lines run on unbroken across every border.
function terraceCrossings(W, wx, dMax) {
  const X0 = xAt(W, wx);
  const ft = X0.ft, v = X0.v, fl = X0.fl, rcEdge = X0.rc + X0.rw * 0.5 + 6;
  const res = new Map();
  let d = Math.max(ft + 4, rcEdge), pq = NaN, pd = d;
  while (d < dMax) {
    heightAt(W, wx, d);
    const S = stepOf(d);
    if (TA.rel > 235) break;
    if (TA.m >= 0.5) {
      const q = TA.rel / S;
      if (pq === pq && Math.floor(q) > Math.floor(pq)) {
        const i = Math.floor(q), t = clamp((i - pq) / Math.max(1e-6, q - pq), 0, 1);
        if (!res.has(i)) res.set(i, pd + (d - pd) * t);
      }
      pq = q;
    } else pq = NaN;
    pd = d;
    d += S * 0.45;
  }
  return { res, fl, v };
}
function* terraceLines(ctx, out, W, dLo, dHi, step) {
  const L = ctx.length, k0 = Math.floor((ctx.x0 - step) / step), k1 = Math.ceil((ctx.x0 + L) / step);
  let prev = null, pwx = 0;
  const n0 = out.n;
  for (let k = k0; k <= k1; k++) {
    const wx = k * step, cur = terraceCrossings(W, wx, dHi + 40);
    if (prev) {
      const xm = (wx + pwx) / 2 - ctx.x0;
      if (xm >= 0 && xm < L) {
        for (const [i, db] of cur.res) {
          const da = prev.res.get(i);
          if (da === undefined || Math.abs(db - da) > step * 4) continue;   // (a fold: not this contour)
          const dm = (da + db) / 2;
          if (dm < dLo || dm >= dHi) continue;
          const Sa = stepOf(da), Sb = stepOf(db), ya = prev.fl + Sa * i, yb = cur.fl + Sb * i;
          const ax = pwx - ctx.x0, bx = wx - ctx.x0;
          const dx = bx - ax, dy = yb - ya, dz = -(db - da), len = Math.hypot(dx, dy, dz);
          const q = quatXTo(dx / len, dy / len, dz / len), S = (Sa + Sb) / 2, ym = (ya + yb) / 2;
          const sx = len * 0.62;
          // the band of the tread's tone, filling most of the step below the bund
          const st = treadState(W, (wx + pwx) / 2, dm + S, i, cur.v);
          const below = ym < CAMY - 1;
          let c = st === 0 ? (below ? C.water : mix3(C.water, C.young, 0.35)) : st === 1 ? mix3(C.water, C.young, below ? 0.55 : 0.8) : (i % 3 === 0 ? C.riceDeep : C.rice);
          const fade = smooth(1300, 2200, dm);
          if (fade > 0) c = mix3(c, C.riser, 0.35 * fade);
          // (it lies on the riser's face, the part of each step a window below it sees: from the
          // riser's foot, RW of the way back to the step below, up to the bund)
          const ga = da - (prev.res.get(i - 1) ?? da - S / 0.35), gb = db - (cur.res.get(i - 1) ?? db - S / 0.35);
          const run = clamp((ga + gb) / 2, S * 0.8, S * 8) * RW;
          const sb = Math.max(0.35, 0.0012 * dm, 0.48 * S);
          out(ax + dx / 2, ym - S * 0.5, -(dm - run * 0.5 - 0.3), sx, sb, Math.max(0.3, run * 0.45), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND);
          // the bund along the top of the riser (merging into the bands far off, in the haze)
          if (dm < 1600) {
            const sy = Math.max(0.25, 0.0009 * dm, 0.09 * S);
            out(ax + dx / 2, ym + sy * 0.2, -dm, sx, sy, Math.max(0.2, sy), C.lip[0], C.lip[1], C.lip[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND);
          }
        }
        if (out.due()) yield;
      }
    }
    prev = cur; pwx = wx;
  }
  note('terrace lines', ctx.x0, out.n - n0);
}

// ---------------------------------------------------------------------------------------------
// The ground fill. The splats are spread by how much of the window each part of the band fills
// (after alps.js and himalaya.js): per strip of the chunk, distance bins weighted by the angle the
// ground climbs through in each, seen from the window, with a floor so no part is left thin.
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
      const d = db[b] + rng() * (db[b + 1] - db[b]);
      const x = (k + rng()) * SL, wx = ctx.x0 + x;
      const dens = (nk * (w[b] / sw)) / ((db[b + 1] - db[b]) * SL);
      let r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
      const e = Math.max(0.5, r * 0.6);
      const yx = W.H(wx + e, d), yd = W.H(wx, d + e), y = W.H(wx, d);
      const hx = (yx - y) / e, hd = (yd - y) / e;
      const il = 1 / Math.hypot(hx, 1, hd);
      const nx = -hx * il, ny = il, nz = hd * il;
      const p = paint(W, wx, d, y, nx, ny, nz, rng);
      const t = p.t;
      if (t === T.FOREST) { emitForest(out, W, x, wx, y, d, r, p.f, rng, far); if (out.due()) yield; continue; }
      if (t === T.TREAD || t === T.LIP || (t === T.RISER && hd < 0)) {
        // a terrace's tread lies level (normals taken across a step would tilt it up the hill)
        const c = p.c, th = p.wet >= 1 ? 0.04 : 0.14;
        out(x, y + (p.wet >= 1 ? 0.03 : 0.12), -d, r * 1.25, r * th, r * 0.75, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
        if (out.due()) yield;
        continue;
      }
      if (t === T.RISER && d > 230) {
        // the underlay of a far terraced slope: lying in the slope, a little below the lines
        const c = soft(p.c, 0.4), qw = 1 + ny, ql = Math.hypot(nz, nx, qw);
        out(x, y - 0.6 * stepOf(d), -d, r * 1.1, r * 0.1, r * Math.min(1.6, 1 / ny), c[0], c[1], c[2], 1, nz / ql, 0, -nx / ql, qw / ql, KIND.GROUND);
        if (out.due()) yield;
        continue;
      }
      if (t === T.RISER) {
        // a riser: a short grassy wall facing down the hill (toward the line), no taller than the step
        const c = soft(p.c, 0.2), S = TA.S;
        out(x, y, -d, r * 1.2, Math.min(r * 0.9, S * 0.42), Math.max(0.04, r * 0.2), c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
        if (out.due()) yield;
        continue;
      }
      const c = t === T.PADDY || t === T.RIVER || t === T.TREAD || t === T.ROAD ? p.c : soft(p.c, ny);
      if (p.wet >= 1) {
        // water lies level whatever the ground's slope: a flat disc, a little longer along the line
        out(x, y + 0.02, -d, r * 1.3, r * 0.04, r * 0.8, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      } else {
        const ph = Math.atan2(nx, nz) * 0.5, cy = Math.cos(ph), sy = Math.sin(ph);
        const qw = 1 + ny, ql = Math.hypot(nz, nx, qw), ux = nz / ql, uz = -nx / ql, uw = qw / ql;
        QG[0] = ux * cy - uz * sy; QG[1] = uw * sy; QG[2] = uz * cy + ux * sy; QG[3] = uw * cy;
        let el = clamp(1 / ny, 1, opts.far2 ? 1.7 : 6), ew = 1;
        const a = 0.85 + 0.3 * rng();
        if (opts.far2) {
          if (el > 1.15) { const yUp = W.H(wx, d + r * 1.3); if (yUp < y + r * 0.25) { r *= 0.6; el = 1; } }
        } else if (el > 1.5) { ew = Math.pow(el, 0.3); el = Math.pow(el, 0.7); }
        let lift = 0.03, thick = 0.12;
        if ((t === T.RICE || t === T.BANK || t === T.DYKE || t === T.SCRUB) && d < 120) { thick = 0.25; lift = 0.05 + r * 0.25 * rng(); }
        out(x, y + lift, -d, r * a * ew, r * thick, r * (2 - a) * el, c[0], c[1], c[2], 1, QG[0], QG[1], QG[2], QG[3], KIND.GROUND);
      }
      if (out.due()) yield;
    }
  }
}
// One ground sample in forest: nearby, a dark splat between the floor and the canopy; far off,
// where a splat is the size of a tree, a rounded crown: dark below, the top a wetter, lighter green.
function emitForest(out, W, x, wx, y, d, r, f, rng, far) {
  const u = rng();
  const H = (far ? 18 : 12 + 8 * noise2(wx / 160, d / 160, W.ws + 403)) * smooth(0.4, 0.5, f + 0.02);
  if (!far) {
    const v = Math.pow(u, 0.7), k = (0.6 + 0.7 * v) * (0.8 + 0.4 * rng());
    const w = Math.max(r * 1.2, 1.6);
    out(x, y + H * (0.08 + 0.6 * v), -d, w, Math.max(w, H * 0.12), w, C.forestMass[0] * k, C.forestMass[1] * k, C.forestMass[2] * k, 1, 0, 0, 0, 1, KIND.HEDGE);
    return;
  }
  const hh = Math.max(H, r * 1.3) * (0.8 + 0.4 * rng());
  const w = Math.max(r * 0.9, hh * 0.32);
  if (u < 0.55) {
    const k = 0.6 + 0.5 * rng();
    out(x, y + hh * 0.35, -d, w, hh * 0.4, w, C.forest[0] * k, C.forest[1] * k, C.forest[2] * k, 1, 0, 0, 0, 1, KIND.HEDGE);
  } else {
    const k = 0.65 + 0.45 * rng(), c = mix3(C.forest, C.forestLit, rng());
    out(x + (rng() - 0.5) * w, y + hh * 0.7, -d, w * 0.85, w * 0.6, w * 0.85, c[0] * k, c[1] * k, c[2] * k, 1, 0, 0, 0, 1, KIND.HEDGE);
  }
}
// The trackside's ground: plain samples by plan area (the band lies mostly below the window).
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
    const pp = paint(W, wx, d, y, nx, ny, nz, rng);
    const c = pp.wet >= 1 ? pp.c : soft(pp.c, ny);
    const nzc = nz < 0 ? 0 : nz, qw = 1 + ny, ql = Math.hypot(nzc, nx, qw);
    const ax = 0.8 + 0.5 * rng();
    const tall = pp.t === T.BANK || pp.t === T.DYKE || pp.t === T.VERGE ? 1 : 0;
    const away = nz < 0 ? Math.min(0.5, -nz * 1.6) : 0;
    if (pp.wet >= 1) out(x, y + 0.02, -d, r * ax, r * 0.04, r * (1.8 - ax), c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    else out(x, y + 0.03 + tall * r * 0.5 * rng(), -d, r * ax, r * (0.12 + 0.3 * tall + away), r * (1.8 - ax), c[0], c[1], c[2], 1, nzc / ql, 0, -nx / ql, qw / ql, KIND.GROUND);
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
// Buildings. All stand square to the line, their fronts toward it (local +z), on a base level y.
// Splat sizes come from distance and budget (bs()); every face a passing train sees has splats.
// ---------------------------------------------------------------------------------------------
const PASTEL = [[0.8, 0.72, 0.4], [0.78, 0.58, 0.6], [0.52, 0.68, 0.76], [0.58, 0.74, 0.58], [0.8, 0.76, 0.64], [0.78, 0.54, 0.34], [0.64, 0.62, 0.76], [0.79, 0.79, 0.75], [0.8, 0.66, 0.5], [0.46, 0.7, 0.66]];
const SHUTTER = [[0.14, 0.36, 0.24], [0.16, 0.3, 0.52], [0.42, 0.26, 0.14], [0.5, 0.52, 0.54], [0.6, 0.16, 0.12]];
const CONC = [0.5, 0.49, 0.46], CONC_D = [0.34, 0.34, 0.33];
const TILE = [0.56, 0.24, 0.14], TILE_OLD = [0.3, 0.28, 0.26];
const TIN = [[0.26, 0.4, 0.56], [0.56, 0.22, 0.16], [0.44, 0.38, 0.32], [0.6, 0.6, 0.58], [0.24, 0.46, 0.4]];
const SIGNS = [[1, 0.14, 0.1], [0.1, 0.4, 1], [1, 0.82, 0.1], [0.08, 0.78, 0.98], [1, 0.3, 0.62], [0.2, 1, 0.4]];
const LIT = [1, 0.78, 0.45], LIT_COOL = [0.82, 0.92, 1];
const TIMBER = [0.3, 0.2, 0.13], THATCH = [0.42, 0.37, 0.28], PALMTHATCH = [0.36, 0.33, 0.24];
const bs = (out, d, k = 1.5) => Math.max(0.18, detail(out, d, k));
// A rectangle in a vertical plane facing +z (front) or along z (an end), or level (a roof or slab).
//   front(x0, y0, z, w, h): x0..x0+w, y0..y0+h at depth z      end(x, y0, z0, dep, h): z0 back to z0+dep
function* front(out, x0, y0, z, w, h, s, col, kind, rng, move = 0) { yield* panel(out, [x0, y0, z], [1, 0, 0], [0, 1, 0], w, h, s, col, kind, rng, 0.12, move); }
function* endWall(out, x, y0, z0, dep, h, s, col, kind, rng) { yield* panel(out, [x, y0, z0], [0, 0, 1], [0, 1, 0], dep, h, s, col, kind, rng); }
function* slab(out, x0, y, z0, w, dep, s, col, kind, rng) { yield* panel(out, [x0, y, z0], [1, 0, 0], [0, 0, 1], w, dep, s, col, kind, rng); }
// A pitched roof: two slopes from the eaves (front at z = zf, back at zf - dep) up to a ridge along
// x, with gable triangles at the ends in wallCol. `curl` turns the four corners up (pagodas, dinh).
function* gableRoof(out, x0, y, zf, w, dep, rh, ov, s, col, wallCol, kind, rng, curl = 0) {
  const half = dep / 2 + ov, sl = Math.hypot(half, rh), cz = zf - dep / 2;
  const nz = half / sl, ny = rh / sl;
  const cf = soft(col, 0.8), cb = mul3(col, 0.72);
  // front slope: from the front eave (y - ov*rh/half... a little below the wall top) up to the ridge
  yield* panel(out, [x0 - ov, y - ov * rh / half, zf + ov], [1, 0, 0], [0, ny, -nz], w + 2 * ov, sl, s, () => jitter(cf, rng, 0.06), kind, rng);
  yield* panel(out, [x0 - ov, y - ov * rh / half, zf - dep - ov], [1, 0, 0], [0, ny, nz], w + 2 * ov, sl, s, () => jitter(cb, rng, 0.06), kind, rng);
  if (wallCol) {
    for (const ex of [x0, x0 + w]) {
      const c = faceTone(wallCol, ex === x0 ? -1 : 1, 0);
      yield* panel(out, [ex, y, zf - dep], [0, 0, 1], [0, 1, 0], dep, rh, s, (a, b) => (Math.abs(a - 0.5) * 2 > 1 - b ? null : c), kind, rng);
    }
  }
  if (curl > 0) {
    const cc = mul3(col, 0.8), r = Math.max(0.08, s * 0.5);
    for (const ex of [x0 - ov, x0 + w + ov]) for (const ez of [zf + ov, zf - dep - ov]) {
      const sx = ex < x0 ? -1 : 1, sz = ez > cz ? 1 : -1;
      bar(out, ex, y - ov * rh / half, ez, ex + sx * curl * 0.5, y - ov * rh / half + curl, ez + sz * curl * 0.3, r, cc, 2, kind);
    }
    // the ridge's ends rise too
    for (const ex of [x0 - ov * 0.5, x0 + w + ov * 0.5]) bar(out, ex, y + rh, cz, ex + (ex < x0 ? -1 : 1) * curl * 0.6, y + rh + curl * 1.1, cz, r * 1.2, cc, 2, kind);
  }
}
// A board of light: a lit shop sign with rows of pale letters on it (always lit: a light).
function* sign(out, x0, y0, z, w, h, col, rng) {
  const s = Math.min(h * 0.45, Math.max(0.08, w / 14));
  const ph = rng() * 3;
  yield* panel(out, [x0, y0, z], [1, 0, 0], [0, 1, 0], w, h, s, (a, b) => {
    const lt = b > 0.3 && b < 0.72 && Math.sin((a * w) * 5.3 + ph) > -0.2 && a > 0.08 && a < 0.92;
    return lt ? [1, 0.98, 0.9] : col;
  }, KIND.LIGHT, rng, 0.2);
}

// A tube house: narrow, deep and tall, a pastel front with a balcony on every floor above the
// first, shutters, an open shopfront below with a lit sign over it; the side walls bare grey
// concrete streaked by the rain; on the flat roof a steel water tank and now and then a little
// pitched roof of red tiles. hs: { wx, d (front), y (base), w, dep, n (floors), col, sh, sg, seed }
function* tubeHouse(ctx, out, hs, night) {
  const r = makeRng(hs.seed), K = KIND.BUILDING;
  const x0 = hs.wx - ctx.x0 - hs.w / 2, zf = -hs.d, y0 = hs.y, w = hs.w, dep = hs.dep, FH = 3.3, H = hs.n * FH + 0.7;
  const s = bs(out, hs.d, hs.d > 200 ? 1.2 : 1.6);
  const wall = hs.col, wf = faceTone(wall, 0, 1), sh = hs.sh;
  const fine = hs.d < 200;
  const lit = night ? (k) => hashInts(hs.seed, k) % 9 < 4 : () => false;
  // supports under the floor where the ground falls away behind (a house on a hillside shelf)
  const gb = groundUnder(ctx, x0 + w / 2, hs.d + dep * 0.7);
  if (gb < y0 - 1.5) for (const px of [x0 + 0.4, x0 + w - 0.4]) for (const pz of [0.45, 0.85]) bar(out, px, gb, zf - dep * pz, px, y0, zf - dep * pz, Math.max(0.18, s * 0.6), CONC_D, 3, K);
  const winAt = (fl, ax, fy) => Math.abs(ax - w / 2) < w * 0.3 && fy > 0.35 && fy < 2.55;
  yield* front(out, x0, y0, zf, w, H, s, (a, b) => {
    const yy = b * H, fl = Math.floor(yy / FH), fy = yy - fl * FH, ax = a * w;
    if (yy > H - 0.7) return mul3(wf, 0.92);
    if (fl === 0) {
      if (ax > 0.35 && ax < w - 0.35 && fy < 2.7) return night && fine ? null : fy > 2.2 ? [0.42, 0.42, 0.42] : [0.1, 0.09, 0.08];
      return wf;
    }
    if (fl < hs.n && winAt(fl, ax, fy)) {
      if (lit(fl) && fine) return null;
      return Math.abs(ax - w / 2) > w * 0.17 ? soft(sh, 0.5) : [0.13, 0.14, 0.16];
    }
    // a dark band of rain streaks below each balcony
    return mul3(wf, fy < 0.5 && fl > 0 ? 0.82 : 1);
  }, K, r);
  if (fine) {
    // lit openings (lights: drawn separately, the wall left open for them)
    if (night) yield* front(out, x0 + 0.35, y0, zf + 0.02, w - 0.7, 2.2, s, () => LIT, KIND.LIGHT, r);
    for (let fl = 1; fl < hs.n; fl++) if (night && lit(fl)) yield* front(out, x0 + w * 0.2, y0 + fl * FH + 0.35, zf + 0.02, w * 0.6, 2.2, s, () => (fl % 2 ? LIT : LIT_COOL), KIND.LIGHT, r);
    // the sign over the shopfront
    if (hs.sg) yield* sign(out, x0 + 0.2, y0 + 2.75, zf + 0.12, w - 0.4, 0.5, hs.sg, r);
    // balconies: a slab and a railing on every floor above the first
    const rail = mul3(wall, 0.75), bd = 0.9;
    for (let fl = 1; fl < hs.n; fl++) {
      const by = y0 + fl * FH;
      const nb = Math.max(2, Math.ceil(w / (s * 2.2)));
      for (let k = 0; k < nb; k++) out(x0 + (k + 0.5) * w / nb, by, zf + bd * 0.5, w / nb * 0.6, 0.12, bd * 0.5, wf[0] * 0.8, wf[1] * 0.8, wf[2] * 0.8, 1, 0, 0, 0, 1, K);
      const ry = by + 1.0, tr = Math.max(0.05, thin(hs.d) * 0.8);
      bar(out, x0 + 0.1, ry, zf + bd, x0 + w - 0.1, ry, zf + bd, tr, rail, Math.max(2, Math.round(w / 1.2)), K);
      for (const ex of [x0 + 0.1, x0 + w - 0.1]) { bar(out, ex, by, zf + bd, ex, ry, zf + bd, tr, rail, 1, K); bar(out, ex, ry, zf + bd, ex, ry, zf, tr, rail, 1, K); }
      // pot plants and washing on some balconies
      if (r() < 0.4) out(x0 + 0.6 + r() * (w - 1.2), by + 0.45, zf + bd * 0.7, 0.32, 0.3, 0.25, 0.16, 0.4, 0.12, 1, 0, 0, 0, 1, KIND.TREE);
      if (r() < 0.3) { const c = pick(SHUTTER, r); out(x0 + w * (0.3 + 0.4 * r()), ry - 0.35, zf + bd * 0.8, 0.35, 0.3, 0.04, c[0] + 0.1, c[1] + 0.1, c[2] + 0.1, 1, 0, 0, 0, 1, KO, MOVE.FLAG); }
    }
    if (out.due()) yield;
  }
  // the side walls: bare concrete, streaked
  // (bare render and brick where the neighbour has not built yet, dark with damp toward the top)
  const cw = faceTone(CONC, -1, 0), ce = faceTone(CONC, 1, 0), streak = r() * 9, brick = r() < 0.5;
  const sideCol = (base) => (a, b) => {
    if (brick && Math.sin(a * 4.1 + streak) + Math.sin(b * 5.3 + streak * 2) > 1.1) return mul3(faceTone([0.52, 0.3, 0.22], base === cw ? -1 : 1, 0), 0.9 + 0.1 * Math.sin(b * 60));
    return mul3(base, (0.8 + 0.16 * Math.sin(a * 23 + streak)) * (1 - 0.25 * b * b));
  };
  const lh = hs.lh || 0, rh = hs.rh || 0;
  if (H - lh > 0.3) yield* endWall(out, x0, y0 + lh, zf - dep, dep, H - lh, s * 1.6, sideCol(cw), K, r);
  if (H - rh > 0.3) yield* endWall(out, x0 + w, y0 + rh, zf - dep, dep, H - rh, s * 1.6, sideCol(ce), K, r);
  // the roof: flat, a parapet, a water tank, sometimes a little tiled roof
  yield* slab(out, x0, y0 + H, zf - dep, w, dep, s * 2, () => jitter(CONC_D, r, 0.08), K, r);
  if (r() < 0.65) { const tx = x0 + 0.8 + r() * (w - 1.6); out(tx, y0 + H + 0.75, zf - dep * 0.4, 0.75, 0.45, 0.45, 0.66, 0.68, 0.7, 1, 0, 0, 0, 1, K); out(tx, y0 + H + 0.3, zf - dep * 0.4, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 1, 0, 0, 0, 1, K); }
  if (hs.hat) yield* gableRoof(out, x0 + 0.4, y0 + H, zf - 0.6, w - 0.8, Math.min(5, dep * 0.4), 1.6, 0.3, s, TILE, wall, K, r);
}
// What the ground's height is under a chunk-local point (for supports).
function groundUnder(ctx, x, d) { return ctx.terrain.height(ctx.x0 + x, d); }

// A single-storey shop with a tin roof sloping to the front, an awning of tarpaulin on poles over
// the road edge, plastic stools and crates out front, a lit sign. hs as tubeHouse.
function* tinShop(ctx, out, hs, night) {
  const r = makeRng(hs.seed), K = KIND.BUILDING;
  const x0 = hs.wx - ctx.x0 - hs.w / 2, zf = -hs.d, y0 = hs.y, w = hs.w, dep = hs.dep, H = 3.1;
  const s = bs(out, hs.d, 1.6), wf = faceTone(hs.col, 0, 1);
  yield* front(out, x0, y0, zf, w, H, s, (a, b) => {
    const ax = a * w, yy = b * H;
    if (ax > 0.5 && ax < w - 0.5 && yy < 2.5) return night ? null : [0.1, 0.09, 0.08];
    return wf;
  }, K, r);
  if (night) yield* front(out, x0 + 0.5, y0, zf + 0.02, w - 1, 2.5, s, () => LIT, KIND.LIGHT, r);
  if (!hs.lh) yield* endWall(out, x0, y0, zf - dep, dep, H, s * 1.4, () => faceTone(hs.col, -1, 0), K, r);
  if (!hs.rh) yield* endWall(out, x0 + w, y0, zf - dep, dep, H, s * 1.4, () => faceTone(hs.col, 1, 0), K, r);
  // the tin roof: a single pitch, falling to the front, ribbed
  const tin = hs.tin, rise = 1.0, sl = Math.hypot(dep + 0.6, rise);
  yield* panel(out, [x0 - 0.3, y0 + H, zf + 0.5], [1, 0, 0], [0, rise / sl, -(dep + 0.6) / sl], w + 0.6, sl, s, (a) => mul3(soft(tin, 0.8), 0.86 + 0.14 * (Math.sin(a * w * 9) > 0 ? 1 : 0)), K, r);
  if (hs.sg) yield* sign(out, x0 + 0.3, y0 + H - 0.55, zf + 0.15, w - 0.6, 0.5, hs.sg, r);
  // the awning: a tarpaulin sloping down toward the road on two poles; its hem flutters
  const aw = pick([[0.16, 0.36, 0.7], [0.8, 0.42, 0.1], [0.72, 0.14, 0.12], [0.2, 0.5, 0.3]], r), ad = 2.6 + r() * 1.2;
  const al = Math.hypot(ad, 0.7);
  yield* panel(out, [x0, y0 + 2.6, zf], [1, 0, 0], [0, -0.7 / al, ad / al], w, al, s, () => soft(aw, 0.6), KO, r, 0.1);
  for (let k = 0; k < Math.max(2, Math.round(w / 1.5)); k++) out(x0 + (k + 0.5) * w / Math.max(2, Math.round(w / 1.5)), y0 + 1.75, zf + ad, w / Math.max(2, Math.round(w / 1.5)) * 0.55, 0.16, 0.05, aw[0], aw[1], aw[2], 1, 0, 0, 0, 1, KO, MOVE.FLAG);
  for (const ex of [x0 + 0.15, x0 + w - 0.15]) bar(out, ex, y0, zf + ad, ex, y0 + 1.9, zf + ad, Math.max(0.05, thin(hs.d)), [0.4, 0.4, 0.4], 2, K);
  // stools and crates
  const nst = 2 + Math.floor(r() * 4);
  for (let k = 0; k < nst; k++) { const c = pick([[0.72, 0.1, 0.1], [0.12, 0.3, 0.68], [0.14, 0.5, 0.24]], r); out(x0 + 0.5 + r() * (w - 1), y0 + 0.25, zf + 0.6 + r() * (ad - 0.8), 0.2, 0.22, 0.2, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.BUILDING, MOVE.STILL); }
  if (out.due()) yield;
}

// An older house of one storey: ochre walls, a porch under a red tiled roof whose ridge runs along
// the line, wooden doors. hs: { wx, d, y, w, dep, col, seed, roof }
function* tiledHouse(ctx, out, hs, night) {
  const r = makeRng(hs.seed), K = KIND.BUILDING;
  const x0 = hs.wx - ctx.x0 - hs.w / 2, zf = -hs.d, y0 = hs.y, w = hs.w, dep = hs.dep, H = 3.2;
  const s = bs(out, hs.d, hs.d > 250 ? 1.1 : 1.5), wf = faceTone(hs.col, 0, 1), roof = hs.roof || TILE;
  const doors = Math.max(1, Math.round(w / 3.2));
  yield* front(out, x0, y0, zf, w, H, s, (a, b) => {
    const fx = a * doors - Math.floor(a * doors), yy = b * H;
    if (fx > 0.3 && fx < 0.7 && yy < 2.3) return night && hs.d < 250 && fx > 0.4 ? null : [0.3, 0.18, 0.1];
    return mul3(wf, yy > H - 0.5 ? 0.8 : 1);
  }, K, r);
  if (night && hs.d < 250) for (let k = 0; k < doors; k++) yield* front(out, x0 + (k + 0.4) * w / doors, y0 + 0.1, zf + 0.02, 0.2 * w / doors, 2.0, s, () => LIT, KIND.LIGHT, r);
  yield* endWall(out, x0, y0, zf - dep, dep, H, s * 1.2, () => faceTone(hs.col, -1, 0), K, r);
  yield* endWall(out, x0 + w, y0, zf - dep, dep, H, s * 1.2, () => faceTone(hs.col, 1, 0), K, r);
  yield* gableRoof(out, x0, y0 + H, zf, w, dep, dep * 0.42, 0.7, s, roof, hs.col, K, r, hs.curl || 0);
}

// A stilt house of the hill peoples: a timber room raised on posts, a steep roof of palm thatch
// hipped down over it, a ladder to the door. hs: { wx, d, y, w, dep, seed }
function* stiltHouse(ctx, out, hs, night) {
  const r = makeRng(hs.seed), K = KIND.BUILDING;
  const x0 = hs.wx - ctx.x0 - hs.w / 2, zf = -hs.d, w = hs.w, dep = hs.dep;
  // (drawn half as large again as life: they stand 300 m and more out)
  const s = bs(out, hs.d, 1.2), lift = 3.0, y1 = hs.y + lift, H = 3.3;
  const post = [0.2, 0.15, 0.1], pr = Math.max(0.12, thin(hs.d));
  for (let k = 0; k <= 3; k++) for (const pz of [0, 1]) {
    const px = x0 + k * w / 3, z = zf - pz * dep;
    bar(out, px, groundUnder(ctx, px, -z) - 0.3, z, px, y1, z, pr, post, 2, K);
  }
  yield* slab(out, x0 - 0.3, y1, zf - dep, w + 0.6, dep + 0.6, s, () => mul3(TIMBER, 0.8), K, r);
  const wfc = faceTone(TIMBER, 0, 1);
  yield* front(out, x0, y1, zf, w, H, s, (a, b) => (Math.abs(a - 0.5) < 0.08 && b < 0.85 ? (night ? null : [0.08, 0.06, 0.05]) : jitter(wfc, r, 0.08)), K, r);
  if (night) yield* front(out, x0 + w * 0.42, y1, zf + 0.02, w * 0.16, H * 0.85, s, () => LIT, KIND.LIGHT, r);
  yield* endWall(out, x0, y1, zf - dep, dep, H, s, () => faceTone(TIMBER, -1, 0), K, r);
  yield* endWall(out, x0 + w, y1, zf - dep, dep, H, s, () => faceTone(TIMBER, 1, 0), K, r);
  // the roof: steep, the thatch hanging low over the walls, hipped at both ends
  const rh = dep * 0.8, ov = 0.9, yr = y1 + H - 0.4;
  yield* gableRoof(out, x0 + 0.6, yr, zf, w - 1.2, dep, rh, ov, s, PALMTHATCH, null, K, r);
  for (const sg of [-1, 1]) {
    const ex = sg < 0 ? x0 + 0.6 : x0 + w - 0.6, sl = Math.hypot(1.6, rh);
    yield* panel(out, [ex + sg * 1.6, yr - ov * rh / (dep / 2 + ov), zf - dep - ov], [0, 0, 1], [-sg * 1.6 / sl, rh / sl, 0], dep + 2 * ov, sl, s, (a, b) => (Math.abs(a - 0.5) * 2 > 1 - b * 0.9 ? null : mul3(PALMTHATCH, sg < 0 ? 0.92 : 0.66)), K, r);
  }
  // the ladder (a loose, rigid thing: MOVE.STILL)
  bar(out, x0 + w * 0.5 - 0.3, hs.y, zf + 1.2, x0 + w * 0.5 - 0.3, y1, zf + 0.05, Math.max(0.05, thin(hs.d) * 0.7), post, 2, K, MOVE.STILL);
  bar(out, x0 + w * 0.5 + 0.3, hs.y, zf + 1.2, x0 + w * 0.5 + 0.3, y1, zf + 0.05, Math.max(0.05, thin(hs.d) * 0.7), post, 2, K, MOVE.STILL);
  if (out.due()) yield;
}

// A pagoda: a temple hall of ochre walls and red columns under a double roof of dark tiles whose
// corners curl up, and beside it a tiered tower. p: { wx, d, y, seed, tower }
function* pagoda(ctx, out, p, night) {
  const r = makeRng(p.seed), K = KIND.BUILDING;
  const x = p.wx - ctx.x0, zf = -p.d, y0 = p.y;
  const s = bs(out, p.d, 1.3), wall = [0.8, 0.64, 0.28], w = 13, dep = 8;
  yield* front(out, x - w / 2, y0, zf, w, 3.6, s, (a, b) => {
    const fx = a * 5 - Math.floor(a * 5);
    if (fx < 0.1) return [0.6, 0.12, 0.08];       // red columns
    if (fx > 0.3 && fx < 0.7 && b < 0.75) return night && p.d < 250 ? [0.42, 0.22, 0.08] : [0.36, 0.12, 0.07];
    return faceTone(wall, 0, 1);
  }, K, r);
  yield* endWall(out, x - w / 2, y0, zf - dep, dep, 3.6, s, () => faceTone(wall, -1, 0), K, r);
  yield* endWall(out, x + w / 2, y0, zf - dep, dep, 3.6, s, () => faceTone(wall, 1, 0), K, r);
  yield* gableRoof(out, x - w / 2, y0 + 3.6, zf, w, dep, 2.0, 1.2, s, TILE_OLD, null, K, r, 1.0);
  yield* front(out, x - w / 2 + 2, y0 + 4.6, zf - 2.2, w - 4, 1.4, s, () => faceTone(wall, 0, 1), K, r);
  yield* gableRoof(out, x - w / 2 + 2, y0 + 6.0, zf - 2.2, w - 4, dep - 4.4, 2.2, 0.8, s, TILE_OLD, wall, K, r, 0.9);
  if (night && p.d < 300) for (const ex of [-3, 3]) out(x + ex, y0 + 3.0, zf + 1.2, 0.3, 0.38, 0.3, 1, 0.3, 0.12, 1, 0, 0, 0, 1, KIND.LIGHT);
  if (p.tower) {
    // the tower: storeys narrowing upward, each with its own curling eaves
    const tx = x + w / 2 + 5, tz = zf - 1.5;
    let tw = 4.2, ty = y0;
    for (let k = 0; k < p.tower; k++) {
      const th = k === 0 ? 3.2 : 2.3;
      yield* front(out, tx - tw / 2, ty, tz, tw, th, s, () => faceTone(wall, 0, 1), K, r);
      yield* endWall(out, tx - tw / 2, ty, tz - tw, tw, th, s, () => faceTone(wall, -1, 0), K, r);
      yield* endWall(out, tx + tw / 2, ty, tz - tw, tw, th, s, () => faceTone(wall, 1, 0), K, r);
      yield* gableRoof(out, tx - tw / 2, ty + th, tz, tw, tw, 0.9, 0.7, s, TILE_OLD, null, K, r, 0.6);
      ty += th + 0.7; tw *= 0.8;
    }
    bar(out, tx, ty, tz - tw / 2, tx, ty + 1.6, tz - tw / 2, Math.max(0.08, thin(p.d)), [0.6, 0.5, 0.2], 2, K);
  }
}

// A communal house (dinh): a long low hall of timber columns under a vast roof of old tiles, the
// ridge's ends curling up like dragons' tails.
function* dinh(ctx, out, p, night) {
  const r = makeRng(p.seed), K = KIND.BUILDING;
  const x = p.wx - ctx.x0, zf = -p.d, y0 = p.y, w = 18, dep = 11, s = bs(out, p.d, 1.3);
  yield* front(out, x - w / 2, y0, zf, w, 2.8, s, (a) => (a * 7 - Math.floor(a * 7) < 0.12 ? [0.36, 0.2, 0.12] : night && p.d < 250 ? [0.3, 0.18, 0.08] : [0.12, 0.08, 0.06]), K, r);
  yield* endWall(out, x - w / 2, y0, zf - dep, dep, 2.8, s, () => faceTone(TIMBER, -1, 0), K, r);
  yield* endWall(out, x + w / 2, y0, zf - dep, dep, 2.8, s, () => faceTone(TIMBER, 1, 0), K, r);
  yield* gableRoof(out, x - w / 2, y0 + 2.8, zf, w, dep, 5.2, 1.6, s, TILE_OLD, TIMBER, K, r, 1.4);
  // a stone yard with a pair of pillars before it
  for (const ex of [-4, 4]) { bar(out, x + ex, y0, zf + 7, x + ex, y0 + 4.5, zf + 7, Math.max(0.3, s), [0.72, 0.7, 0.62], 3, K); out(x + ex, y0 + 4.9, zf + 7, 0.45, 0.4, 0.45, 0.66, 0.6, 0.42, 1, 0, 0, 0, 1, K); }
}

// The village gate (cong lang) where a lane leaves the road: two square pillars, a lintel with a
// red board of yellow letters, a small tiled roof with curling corners.
function* gate(ctx, out, g) {
  const r = makeRng(g.seed), K = KIND.BUILDING;
  const x = g.wx - ctx.x0, z = -g.d, y0 = g.y, s = bs(out, g.d, 1.2), col = [0.78, 0.74, 0.6];
  for (const ex of [-2.6, 2.6]) {
    yield* front(out, x + ex - 0.45, y0, z, 0.9, 5.2, s, () => faceTone(col, 0, 1), K, r);
    yield* endWall(out, x + ex - 0.45, y0, z - 0.9, 0.9, 5.2, s, () => faceTone(col, -1, 0), K, r);
    yield* endWall(out, x + ex + 0.45, y0, z - 0.9, 0.9, 5.2, s, () => faceTone(col, 1, 0), K, r);
    out(x + ex, y0 + 5.55, z - 0.45, 0.6, 0.35, 0.6, 0.7, 0.64, 0.46, 1, 0, 0, 0, 1, K);
  }
  yield* front(out, x - 2.2, y0 + 3.6, z + 0.05, 4.4, 1.3, s, (a, b) => (b > 0.3 && b < 0.7 && a > 0.1 && a < 0.9 && Math.sin(a * 31) > -0.3 ? [0.8, 0.7, 0.12] : [0.66, 0.1, 0.08]), K, r);
  yield* gableRoof(out, x - 2.2, y0 + 4.9, z, 4.4, 1.2, 0.7, 0.4, s, TILE_OLD, null, K, r, 0.5);
}

// The flag of Vietnam on a pole: red with a yellow star, fluttering (MOVE.FLAG).
function flagVN(out, x, y, z, k = 1) {
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) out(x + (0.35 + i * 0.6) * k, y - (0.3 + j * 0.6) * k, z, 0.38 * k, 0.36 * k, 0.04, 0.76, 0.08, 0.06, 1, 0, 0, 0, 1, KO, MOVE.FLAG);
  out(x + 0.95 * k, y - 0.6 * k, z + 0.03, 0.2 * k, 0.2 * k, 0.03, 0.8, 0.72, 0.08, 1, 0, 0, 0, 1, KO, MOVE.FLAG);
}

// A concrete power pole, leaning a little, its cross-arm and insulators; tops (for the wires) are
// returned. pl: { wx, d, y, lean: [dx, dz], h, seed }
function polePoints(ctx, pl) {
  const x = pl.wx - ctx.x0, top = [x + pl.lean[0] * pl.h, pl.y + pl.h, -pl.d + pl.lean[1] * pl.h];
  return { x, top };
}
function pole(ctx, out, pl, night) {
  const { x, top } = polePoints(ctx, pl), r = Math.max(0.12, thin(pl.d) * 1.2), c = [0.56, 0.55, 0.52];
  bar(out, x, pl.y - 0.3, -pl.d, top[0], top[1], top[2], r, c, 5, KIND.MAST);
  bar(out, top[0] - 1.1, top[1] - 0.5, top[2], top[0] + 1.1, top[1] - 0.5, top[2], r * 0.7, [0.4, 0.38, 0.36], 2, KIND.MAST);
  // a transformer drum on some, and a tangle of cables at the foot
  if (pl.tx) out(top[0], top[1] - 2.2, top[2] + 0.4, 0.45, 0.6, 0.45, 0.42, 0.44, 0.44, 1, 0, 0, 0, 1, KIND.MAST);
  // a street lamp on its arm over the road, lit from late afternoon
  if (pl.lamp) {
    const ly = top[1] - 1.4, lz = top[2] + 1.6;
    bar(out, top[0], ly + 0.3, top[2], top[0], ly, lz, r * 0.5, [0.36, 0.36, 0.36], 1, KIND.MAST);
    if (night) { out(top[0], ly - 0.1, lz, 0.16, 0.1, 0.16, 1, 0.84, 0.52, 1, 0, 0, 0, 1, KIND.LIGHT); out(top[0], ly - 0.2, lz, 0.9, 0.7, 0.9, 1, 0.8, 0.5, 0.15, 0, 0, 0, 1, KIND.LIGHT); }
  }
}
// Wires from one pole's top to the next, sagging (several, as the lines along a Vietnamese road).
function poleWires(ctx, out, a, b, d, n = 4) {
  const A = polePoints(ctx, a).top, Bp = polePoints(ctx, b).top, r = Math.max(0.018, 0.0006 * d), c = [0.12, 0.12, 0.12];
  const segs = 8;
  for (let k = 0; k < n; k++) {
    const off = (k - (n - 1) / 2) * 0.55, drop = k === n - 1 ? 1.2 : 0.5, sag = 0.6 + 0.35 * k;
    let px = A[0] + off, py = A[1] - drop, pz = A[2];
    for (let i = 1; i <= segs; i++) {
      const t = i / segs, qx = A[0] + (Bp[0] - A[0]) * t + off, qz = A[2] + (Bp[2] - A[2]) * t;
      const qy = A[1] - drop + (Bp[1] - A[1]) * t - sag * 4 * t * (1 - t);
      bar(out, px, py, pz, qx, qy, qz, r, c, 1, KIND.WIRE);
      px = qx; py = qy; pz = qz;
    }
  }
}

// A village church of the delta: a tall pastel facade with a gothic bell tower and spire over the
// door, the nave behind under a long roof (the Red River plain has many). p: { wx, d, y, seed, col }
function* church(ctx, out, p, night) {
  const r = makeRng(p.seed), K = KIND.BUILDING, x = p.wx - ctx.x0, zf = -p.d, y0 = p.y;
  const s = bs(out, p.d, 1.2), col = p.col, w = 12, dep = 26, H = 9;
  // the nave, side on to the line, its gable end with the tower facing the way the train comes
  yield* front(out, x - dep / 2, y0, zf, dep, H, s, (a, b) => (a * 6 - Math.floor(a * 6) > 0.4 && a * 6 - Math.floor(a * 6) < 0.6 && b > 0.25 && b < 0.8 ? (night && p.d < 300 ? null : [0.2, 0.22, 0.28]) : faceTone(col, 0, 1)), K, r);
  if (night && p.d < 300) for (let k = 0; k < 6; k++) yield* front(out, x - dep / 2 + (k + 0.4) * dep / 6, y0 + H * 0.25, zf + 0.03, dep / 30, H * 0.55, s, () => [1, 0.72, 0.4], KIND.LIGHT, r);
  yield* endWall(out, x + dep / 2, y0, zf - w, w, H, s, () => faceTone(col, 1, 0), K, r);
  yield* gableRoof(out, x - dep / 2, y0 + H, zf, dep, w, 5, 0.6, s, [0.42, 0.24, 0.18], null, K, r);
  // the tower at the west end, square, then the belfry, then the spire with its cross
  const tx = x - dep / 2 - 3, tw = 6, th = 22;
  yield* front(out, tx - tw / 2, y0, zf + 0.5, tw, th, s, (a, b) => (Math.abs(a - 0.5) < 0.14 && ((b > 0.05 && b < 0.3) || (b > 0.72 && b < 0.88)) ? [0.16, 0.14, 0.14] : Math.abs(a - 0.5) < 0.12 && b > 0.5 && b < 0.6 ? [0.78, 0.78, 0.74] : faceTone(col, 0, 1)), K, r);
  yield* endWall(out, tx - tw / 2, y0, zf + 0.5 - tw, tw, th, s, () => faceTone(col, -1, 0), K, r);
  yield* endWall(out, tx + tw / 2, y0, zf + 0.5 - tw, tw, th, s, () => faceTone(col, 1, 0), K, r);
  const sh = 11, sc = [0.3, 0.32, 0.36];
  for (let k = 0; k < 14; k++) {
    const f = (k + 0.5) / 14, R = (tw / 2) * (1 - f) * 0.95, yy = y0 + th + f * sh;
    for (let j = 0; j < 6; j++) {
      const a = (j / 6) * Math.PI * 1.6 - Math.PI * 0.8 + Math.PI / 2, c = shade(sc, Math.cos(a), 0.4, Math.sin(a), 0.7, 0.3);
      out(tx + Math.cos(a) * R, yy, zf + 0.5 - tw / 2 + Math.sin(a) * R, Math.max(s * 0.7, R * 0.5), sh / 14 * 0.7, Math.max(s * 0.7, R * 0.5), c[0], c[1], c[2], 1, 0, 0, 0, 1, K);
    }
  }
  const ct = y0 + th + sh;
  bar(out, tx, ct, zf + 0.5 - tw / 2, tx, ct + 2.2, zf + 0.5 - tw / 2, Math.max(0.1, thin(p.d)), [0.7, 0.66, 0.5], 2, K);
  bar(out, tx - 0.7, ct + 1.5, zf + 0.5 - tw / 2, tx + 0.7, ct + 1.5, zf + 0.5 - tw / 2, Math.max(0.1, thin(p.d)), [0.7, 0.66, 0.5], 2, K);
}
// A brick kiln: a squat kiln of dark red brick, a tall square chimney, smoke leaning off it.
function* kiln(ctx, out, k) {
  const r = makeRng(k.seed), K = KIND.BUILDING, x = k.wx - ctx.x0, zf = -k.d, y0 = k.y, s = bs(out, k.d, 1.2);
  const brick = [0.5, 0.28, 0.2];
  yield* front(out, x - 9, y0, zf, 18, 4, s, () => jitter(faceTone(brick, 0, 1), r, 0.1), K, r);
  yield* endWall(out, x - 9, y0, zf - 10, 10, 4, s, () => faceTone(brick, -1, 0), K, r);
  yield* endWall(out, x + 9, y0, zf - 10, 10, 4, s, () => faceTone(brick, 1, 0), K, r);
  yield* gableRoof(out, x - 9, y0 + 4, zf, 18, 10, 2.2, 0.5, s, [0.36, 0.34, 0.3], null, K, r);
  const cx = x + 5, ch = 20 + 6 * r();
  yield* front(out, cx - 0.9, y0, zf - 4, 1.8, ch, s, (a, b) => faceTone(brick, 0, 1).map((v) => v * (0.92 + 0.1 * b)), K, r);
  yield* endWall(out, cx - 0.9, y0, zf - 5.8, 1.8, ch, s, () => faceTone(brick, -1, 0), K, r);
  yield* endWall(out, cx + 0.9, y0, zf - 5.8, 1.8, ch, s, () => faceTone(brick, 1, 0), K, r);
  // smoke: grey puffs leaning downwind, spreading as they go
  for (let j = 0; j < 9; j++) {
    const t = j / 8, sz = 1.5 + 6 * t;
    out(cx + t * 26, y0 + ch + 2 + t * 10, zf - 5 + t * 3, sz, sz * 0.7, sz, 0.5 + 0.2 * t, 0.5 + 0.2 * t, 0.52 + 0.2 * t, 0.55 - 0.35 * t, 0, 0, 0, 1, KO, MOVE.VAPOUR);
  }
  // stacks of bricks drying under thatch beside it
  for (let j = 0; j < 3; j++) out(x - 14 - j * 5, y0 + 0.8, zf - 2, 2, 0.8, 1.2, brick[0] * 1.1, brick[1] * 1.1, brick[2] * 1.1, 1, 0, 0, 0, 1, K, MOVE.STILL);
}
const KILNCELL = 2300;
function kilnAt(W, i) {
  return cache(W, ST.MARKET, i, () => {
    const r = makeRng(hashInts(W.ws, 171, i));
    const wx = (i + 0.2 + 0.6 * r()) * KILNCELL, x = xCopy(W, wx);
    if (x.v > 0.4 || r() > 0.75) return null;
    const d = x.rd + 60 + r() * Math.max(10, Math.min(300, x.rc - x.rw / 2 - x.rd - 90));
    return { wx, d, y: x.fy + 0.2, seed: hashInts(W.ws, 172, i) };
  });
}
function* kilns(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, KILNCELL, 60)) {
    const k = kilnAt(W, i);
    if (k && k.d >= dLo && k.d < dHi && inX(ctx, k.wx, 30)) { note('kiln', k.wx, k.d); yield* kiln(ctx, out, k); }
  }
}
// Lotus in the ponds among the paddies: big round pads crowding the water, pink flowers standing
// above them on their stems (drawn large: they stand 40 m and more out).
const LOTCELL = 26;
function* lotusPonds(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, LOTCELL, 10)) {
    const r = worldRng(ctx, 181, i);
    for (let t = 0; t < 4; t++) {
      const wx = wx0 + LOTCELL * r(), x = xAt(W, wx), d = x.rd + 8 + Math.pow(r(), 1.4) * 170;
      if (d < dLo || d >= dHi || !inX(ctx, wx, 8)) continue;
      if (!openGround(W, wx, d)) continue;
      const p = paddyAt(W, wx, d);
      if (p.dyke || p.t !== PT.POND) continue;
      const y = W.H(wx, d) + 0.08, k = 1.6 * farK(d), lx = wx - ctx.x0;
      const n = 18 + Math.floor(r() * 14);
      for (let j = 0; j < n; j++) {
        const px = lx + (r() - 0.5) * 9, pd = d + (r() - 0.5) * 5, pr = (0.35 + 0.3 * r()) * k;
        const c = mix3([0.22, 0.44, 0.16], [0.36, 0.52, 0.22], r());
        out(px, y + 0.15 + 0.35 * r(), -pd, pr, pr * 0.12, pr * 0.8, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.TREE);
      }
      const nf = 3 + Math.floor(r() * 7);
      for (let j = 0; j < nf; j++) {
        const px = lx + (r() - 0.5) * 8, pd = d + (r() - 0.5) * 4, hh = (0.8 + 0.5 * r()) * k;
        bar(out, px, y, -pd, px, y + hh, -pd, Math.max(0.03, thin(d) * 0.6), [0.26, 0.4, 0.16], 1, KIND.TREE);
        out(px, y + hh + 0.1 * k, -pd, 0.16 * k, 0.2 * k, 0.16 * k, 0.8, 0.44, 0.6, 1, 0, 0, 0, 1, KIND.TREE);
        out(px, y + hh + 0.22 * k, -pd, 0.08 * k, 0.1 * k, 0.08 * k, 0.8, 0.62, 0.72, 1, 0, 0, 0, 1, KIND.TREE);
      }
      if (out.due()) yield;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Plants: bamboo, banana, areca and coconut palms, and the dark, wet broadleaf trees of the
// villages (longan, jackfruit, banyan). function* (ctx, out, x, d, opts) with chunk-local x; opts
// { rng, y, height, n }. All KIND.TREE, so they answer the beat (beatKinds).
// ---------------------------------------------------------------------------------------------
const LEAF = { bamboo: [0.26, 0.42, 0.14], bambooLit: [0.4, 0.54, 0.2], culm: [0.38, 0.46, 0.2], banana: [0.3, 0.5, 0.14], palm: [0.2, 0.36, 0.12], tree: [0.1, 0.24, 0.09], treeLit: [0.2, 0.36, 0.12], bark: [0.22, 0.18, 0.14] };
// Bamboo: culms arching out of a dense clump, feathery sprays hanging from them (after karst.js).
function* bamboo(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 9, Wd = opts.width || H * 0.5;
  const y0 = opts.y != null ? opts.y : groundUnder(ctx, x, d) - 0.1;
  const kind = KIND.TREE;
  const n = Math.max(6, Math.round(opts.n || treeSplats(out, d, Wd + H * 0.4) * 1.4));
  const culms = clamp(Math.round(10 + H * 1.4 * rng()), 6, 26);
  const fine = Math.max(0.06, detail(out, d, 0.9));
  const nCore = Math.round(n * 0.06);
  yield* blob(ctx, out, x, y0 + H * 0.45, d, Wd * 0.2, H * 0.3, Wd * 0.16, { n: nCore, color: mul3(LEAF.bamboo, 0.5), rng, kind, inner: 0.6, amb: 0.5, clump: 0.8 });
  const per = Math.max(2, Math.floor((n - nCore) / culms));
  for (let cI = 0; cI < culms; cI++) {
    const ang = rng() * Math.PI * 2, br = Wd * 0.16 * Math.sqrt(rng());
    const bx = x + Math.cos(ang) * br, bd = d + Math.sin(ang) * br * 0.7;
    let ox = Math.cos(ang) * 1.3, oz = Math.sin(ang) * 0.6;
    const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
    const lean = 0.1 + 0.25 * rng(), arch = 0.45 + 0.6 * rng();
    const h = H * (0.65 + 0.35 * rng());
    const P = (s) => [bx + ox * h * (lean * s + arch * 0.45 * Math.pow(s, 2.4)), y0 + h * (s - 0.16 * arch * s * s * s), bd + oz * h * (lean * s + arch * 0.45 * Math.pow(s, 2.4))];
    const nStem = Math.max(1, Math.round(per * 0.14)), cr = Math.max(0.035, fine * 0.4);
    for (let k = 0; k < nStem; k++) {
      const s = (k + 0.5) / nStem * 0.8;
      const [px, py, pd] = P(s), [qx, qy, qd] = P(s + 0.02);
      const qq = quatXTo(qx - px, qy - py, -(qd - pd));
      const c = mul3(LEAF.culm, 0.8 + 0.3 * s);
      out(px, py, -pd, Math.max((h * 0.8 / nStem) * 0.6, cr), cr, cr, c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], kind);
    }
    for (let k = nStem; k < per; k++) {
      const s = 0.35 + 0.65 * Math.pow(rng(), 0.55);
      const [px, py, pd] = P(s);
      const sp = h * (0.07 + 0.15 * s);
      const lx = px + ox * rng() * sp + (rng() - 0.5) * sp, ly = py - (0.2 + rng()) * sp, lz = pd + (rng() - 0.5) * 1.2 * sp;
      let c = mix3(LEAF.bamboo, LEAF.bambooLit, smooth(0.5, 1, s) * 0.6 * rng());
      c = jitter(soft(c, 0.5), rng, 0.12);
      const lw = Math.max(fine * 0.8, 0.09), ll = Math.max(lw * lerp(2.6, 1.3, smooth(15, 50, d)), 0.3);
      const qq = quatXTo(ox * 0.6 + (rng() - 0.5), -0.6 - rng() * 0.5, -oz * 0.6 + (rng() - 0.5));
      out(lx, ly, -lz, ll, lw, lw, c[0], c[1], c[2], 0.92, qq[0], qq[1], qq[2], qq[3], kind);
      if (out.due()) yield;
    }
  }
}
// A banana plant: a pale pseudostem and a fan of long, broad, arching leaves, some torn by the
// wind into strips; now and then a hanging bunch and its purple flower.
function* bananaPlant(ctx, out, x, d, opts = {}) {
  const r = opts.rng || ctx.rng, kind = KIND.TREE;
  const y0 = opts.y != null ? opts.y : groundUnder(ctx, x, d) - 0.1;
  const H = opts.height || 3.2 + 1.8 * r();
  const s = Math.max(0.05, detail(out, d, 1.0));
  const st = y0 + H * 0.55;
  strut(out, x, y0, -d, x, st, -d, Math.max(0.13, s * 0.5), [0.34, 0.4, 0.18], 2, 1, kind);
  const nl = 6 + Math.floor(r() * 4);
  for (let k = 0; k < nl; k++) {
    const az = (k / nl) * Math.PI * 2 + r() * 0.6;
    const L = H * (0.6 + 0.25 * r());
    const old = r() < 0.15;
    const rise = old ? 0.45 : 1.0, droop = old ? 1.05 : 0.8;
    const ca = Math.cos(az), sa = Math.sin(az);
    const ns = clamp(Math.round(L / Math.max(0.4, s * 2.2)), 2, 5);
    const P = (f) => [x + ca * L * f, st + L * (rise * f - droop * f * f), d + sa * L * f * 0.9];
    const col = old ? [0.42, 0.38, 0.16] : jitter(mix3(LEAF.banana, [0.38, 0.6, 0.16], r()), r, 0.1);
    const torn = r() < 0.5;
    for (let i = 0; i < ns; i++) {
      const f0 = i / ns, f1 = (i + 1) / ns, fm = (f0 + f1) / 2;
      const a = P(f0), b = P(f1), m = P(fm);
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = -(b[2] - a[2]);
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      const bw = L * 0.2 * (0.45 + Math.sin(Math.PI * (0.15 + 0.8 * fm)));
      for (const sg of [-1, 1]) {
        if (torn && fm > 0.4 && r() < 0.35) continue;
        let vx = -sa * sg, vy = -0.35, vz = -ca * sg;
        const dt = vx * tx + vy * ty + vz * tz; vx -= dt * tx; vy -= dt * ty; vz -= dt * tz;
        const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
        const q = quatBasis(tx, ty, tz, vx, vy, vz);
        const c = soft(col, 0.6);
        const hw = Math.max(bw * 0.5, s * 0.4) * (torn && fm > 0.5 ? 0.7 : 1);
        out(m[0] + vx * hw, m[1] + vy * hw, -m[2] + vz * hw, Math.max(tl * 0.62, s * 0.5), hw, Math.max(0.02, s * 0.08), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind);
      }
    }
    if (out.due()) yield;
  }
  if (r() < 0.35) { out(x + 0.3, st - 0.2, -(d - 0.2), 0.2, 0.4, 0.2, 0.3, 0.42, 0.14, 1, 0, 0, 0, 1, kind); out(x + 0.35, st - 0.8, -(d - 0.2), 0.12, 0.2, 0.12, 0.42, 0.14, 0.24, 1, 0, 0, 0, 1, kind); }
}
// A palm: a thin ringed trunk, straight (areca) or leaning and curved (coconut), and a crown of
// feathery fronds arching out and down. kind 'areca' (slim, tall, small crown) or 'coconut'.
function* palm(ctx, out, x, d, opts = {}) {
  const r = opts.rng || ctx.rng, kind = KIND.TREE, areca = opts.areca;
  const y0 = opts.y != null ? opts.y : groundUnder(ctx, x, d) - 0.1;
  const H = opts.height || (areca ? 10 + 5 * r() : 9 + 6 * r());
  const s = Math.max(0.05, detail(out, d, 1.0));
  const lean = areca ? 0.03 * (r() - 0.5) : 0.12 + 0.12 * r(), la = r() * Math.PI * 2;
  const lx = Math.cos(la) * lean, lz = Math.sin(la) * lean * 0.6;
  const P = (t) => [x + lx * H * t * t, y0 + H * t, d + lz * H * t * t];
  const tr = Math.max(areca ? 0.09 : 0.15, 0.0008 * d), tc = areca ? [0.5, 0.5, 0.44] : [0.36, 0.3, 0.24];
  let a = P(0);
  for (let i = 1; i <= 4; i++) { const b = P(i / 4); strut(out, a[0], a[1], -a[2], b[0], b[1], -b[2], tr, tc, 2, 1, kind); a = b; }
  const top = P(1);
  const nf = areca ? 7 + Math.floor(r() * 3) : 10 + Math.floor(r() * 4), F = areca ? 2.2 + r() : 3.6 + r();
  out(top[0], top[1] - 0.2, -top[2], 0.35, 0.45, 0.35, 0.2, 0.3, 0.1, 1, 0, 0, 0, 1, kind);
  if (areca) out(top[0], top[1] - 0.9, -top[2], 0.16, 0.6, 0.16, 0.3, 0.42, 0.16, 1, 0, 0, 0, 1, kind);   // the green crownshaft
  for (let k = 0; k < nf; k++) {
    const az = (k / nf) * Math.PI * 2 + r() * 0.5, ca = Math.cos(az), sa = Math.sin(az);
    const up = areca ? 0.9 : 0.55 + 0.4 * r();
    const Q = (f) => [top[0] + ca * F * f, top[1] + F * (up * f - 0.95 * f * f), top[2] + sa * F * f * 0.9];
    const ns = 3;
    for (let i = 0; i < ns; i++) {
      const p0 = Q(i / ns), p1 = Q((i + 1) / ns), pm = Q((i + 0.5) / ns);
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = -(p1[2] - p0[2]), l = Math.hypot(dx, dy, dz) || 1;
      const q = quatBasis(dx / l, dy / l, dz / l, -sa, 0.2, -ca);
      const c = soft(jitter(LEAF.palm, r, 0.15), 0.6), hw = Math.max(F * 0.1 * (1 - 0.4 * i / ns), s * 0.5);
      out(pm[0], pm[1], -pm[2], Math.max(l * 0.6, s), hw, Math.max(0.02, s * 0.1), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind);
    }
  }
  if (!areca && r() < 0.6) for (let k = 0; k < 3; k++) out(top[0] + (r() - 0.5) * 0.6, top[1] - 0.5, -(top[2] - 0.2), 0.17, 0.17, 0.17, 0.32, 0.36, 0.12, 1, 0, 0, 0, 1, kind);
  if (out.due()) yield;
}
// A broadleaf village tree: dark wet crown in lumps over a short trunk (kit broadleaf, own greens).
function* villageTree(ctx, out, x, d, opts = {}) {
  const r = opts.rng || ctx.rng, H = opts.height || 8 + 6 * r();
  yield* kitBroadleaf(ctx, out, x, d, { height: H, crown: H * (0.7 + 0.3 * r()), color: mix3(LEAF.tree, LEAF.treeLit, r() * 0.6), trunk: LEAF.bark, rng: r, n: opts.n, y: opts.y });
}
// A far tree: one soft lump on a dark foot (mid band, where a tree is a few pixels).
function farTree(out, x, y, d, H, r, c = LEAF.tree) {
  const w = H * (0.35 + 0.15 * r()), k = 0.7 + 0.5 * r();
  out(x, y + H * 0.35, -d, w * 0.6, H * 0.36, w * 0.6, c[0] * 0.6 * k, c[1] * 0.6 * k, c[2] * 0.6 * k, 1, 0, 0, 0, 1, KIND.TREE);
  out(x, y + H * 0.66, -d, w, H * 0.3, w, c[0] * 1.1 * k, c[1] * 1.1 * k, c[2] * 1.1 * k, 1, 0, 0, 0, 1, KIND.TREE);
}
// One plant of a kind ('bamboo' | 'banana' | 'areca' | 'coconut' | 'tree'), at distance d; far off
// (beyond 260 m) every kind is a far tree of its shape.
function* plant(ctx, out, kindName, x, d, y, r, scale = 1) {
  if (d > 260) {
    const H = (kindName === 'banana' ? 4 : kindName === 'areca' ? 12 : kindName === 'coconut' ? 12 : 10) * scale;
    farTree(out, x, y, d, H, r, kindName === 'bamboo' ? LEAF.bamboo : kindName === 'banana' ? LEAF.banana : kindName === 'tree' ? LEAF.tree : LEAF.palm);
    return;
  }
  if (kindName === 'bamboo') yield* bamboo(ctx, out, x, d, { rng: r, y, height: (8 + 5 * r()) * scale });
  else if (kindName === 'banana') yield* bananaPlant(ctx, out, x, d, { rng: r, y });
  else if (kindName === 'areca') yield* palm(ctx, out, x, d, { rng: r, y, areca: true });
  else if (kindName === 'coconut') yield* palm(ctx, out, x, d, { rng: r, y });
  else yield* villageTree(ctx, out, x, d, { rng: r, y, height: (7 + 6 * r()) * scale });
}

// ---------------------------------------------------------------------------------------------
// Sites: villages along the road, hamlets among the paddies, tombs in the fields, stilt houses on
// the terraces, the station, power poles, plants along the road and the dykes. Each is a pure
// function of its world cell, cached per world; every band draws what falls inside it.
// ---------------------------------------------------------------------------------------------
// --- villages: a street of tube houses and shops facing the road (and the line) across it, a
// market under tarpaulins, a gate where a lane leaves the road, a pagoda or a communal house, and
// behind them trees, palms and bamboo ---
const VCELL = 1500;
function village(W, i) {
  return cache(W, ST.VILLAGE, i, () => {
    const r = makeRng(hashInts(W.ws, 101, i));
    if (r() > 0.8) return null;
    const cx = (i + 0.25 + 0.5 * r()) * VCELL, half = 100 + 140 * r();
    const v0 = xAt(W, cx).v;
    const houses = [], plants = [];
    const marketAt = r() < 0.6 ? cx + (r() - 0.5) * half : NaN;
    const gateAt = r() < 0.75 ? cx + (r() - 0.5) * half * 1.4 : NaN;
    const templeAt = r() < 0.7 ? cx + (r() - 0.5) * half * 1.6 : NaN;
    let wx = cx - half, k = 0;
    while (wx < cx + half) {
      if (Math.abs(wx - marketAt) < 21) { wx = marketAt + 21; continue; }
      if (Math.abs(wx - gateAt) < 6) { wx = gateAt + 6; continue; }
      if (Math.abs(wx - templeAt) < 16) { wx = templeAt + 16; continue; }
      if (r() < 0.09) {
        const x = xAt(W, wx + 3);
        plants.push({ wx: wx + 3, d: x.rd + 8 + r() * 5, k: pick(['banana', 'areca', 'tree', 'banana'], r), seed: hashInts(W.ws, 104, i, k++) });
        wx += 6 + r() * 5;
        continue;
      }
      const tube = r() < 0.74, w = tube ? 4 + 2.2 * r() : 6.5 + 4 * r(), xc = wx + w / 2, x = xAt(W, xc);
      houses.push({ type: tube ? 'tube' : 'shop', wx: xc, d: x.rd + 4.7 + r() * 1.2, y: x.rdY + 0.05, w, dep: tube ? 9 + 4 * r() : 6 + 2 * r(), n: tube ? 2 + Math.floor(r() * 3.6) : 1,
        col: pick(PASTEL, r), sh: pick(SHUTTER, r), sg: r() < 0.55 ? pick(SIGNS, r) : null, tin: pick(TIN, r), hat: r() < 0.3, seed: hashInts(W.ws, 103, i, k++) });
      wx += w + (r() < 0.18 ? 1 + 2.5 * r() : 0.12);
    }
    // which part of each end wall shows: what stands above a neighbour built wall to wall with it
    const hOf = (h) => (h.type === 'tube' ? h.n * 3.3 + 0.7 : 3.1);
    for (let j = 0; j < houses.length; j++) {
      const h = houses[j], a = houses[j - 1], b = houses[j + 1];
      h.lh = a && h.wx - h.w / 2 - (a.wx + a.w / 2) < 0.5 ? Math.min(hOf(a), hOf(h)) : 0;
      h.rh = b && b.wx - b.w / 2 - (h.wx + h.w / 2) < 0.5 ? Math.min(hOf(b), hOf(h)) : 0;
    }
    // behind the street (on the plain): palms, bamboo and trees standing over the roofs
    if (v0 < 0.55) {
      const nb = Math.round(half / 9);
      for (let j = 0; j < nb; j++) {
        const pw = cx + (r() * 2 - 1) * half, x = xAt(W, pw);
        plants.push({ wx: pw, d: x.rd + 24 + r() * 45, k: pick(['areca', 'areca', 'bamboo', 'tree', 'coconut', 'banana'], r), seed: hashInts(W.ws, 104, i, k++) });
      }
    }
    // on the near side of the road: kitchen gardens, bananas, a shed or two
    const nn = Math.round(half / 22);
    for (let j = 0; j < nn; j++) {
      const pw = cx + (r() * 2 - 1) * half, x = xAt(W, pw);
      plants.push({ wx: pw, d: 17 + (x.rd - 22) * r(), k: r() < 0.7 ? 'banana' : 'areca', seed: hashInts(W.ws, 104, i, k++) });
    }
    const xm = xAt(W, marketAt);
    const market = marketAt === marketAt ? { wx: marketAt, d: xm.rd + 4.5, y: xm.rdY + 0.05, seed: hashInts(W.ws, 105, i) } : null;
    const xg = xAt(W, gateAt);
    const gt = gateAt === gateAt ? { wx: gateAt, d: xg.rd + 6, y: xg.rdY + 0.05, seed: hashInts(W.ws, 106, i) } : null;
    const xt = xAt(W, templeAt);
    const temple = templeAt === templeAt ? { wx: templeAt, d: xt.rd + 9, y: xt.rdY + 0.05, seed: hashInts(W.ws, 107, i), kind: v0 < 0.4 && r() < 0.2 ? 'church' : r() < 0.4 ? 'dinh' : 'pagoda', tower: r() < 0.5 ? 3 + Math.floor(r() * 2) : 0, col: [0.78, 0.74, 0.62] } : null;
    return { cx, half, houses, plants, market, gate: gt, temple, rd0: xAt(W, cx).rd };
  });
}
function villagesNear(W, wx, m = 0) {
  const res = [];
  for (let i = Math.floor((wx - 400 - m) / VCELL); i <= Math.floor((wx + 400 + m) / VCELL); i++) { const v = village(W, i); if (v && Math.abs(wx - v.cx) < v.half + 25 + m) res.push(v); }
  return res;
}
// --- hamlets: clusters of houses in a ring of palms, bananas and bamboo, out among the paddies
// of the plain (the islands of dark trees a delta is dotted with) ---
const HCELL = 480;
function hamlet(W, i) {
  return cache(W, ST.MISC, i, () => {
    const r = makeRng(hashInts(W.ws, 111, i));
    const cx = (i + 0.2 + 0.6 * r()) * HCELL, x = xCopy(W, cx);
    if (x.v > 0.45 || r() > 0.85) return null;
    const lo = x.rd + 40, hi = Math.min(x.ft - 60, x.rc - x.rw / 2 - 40 > lo + 40 && r() < 0.6 ? x.rc - x.rw / 2 - 40 : x.ft - 60);
    if (hi < lo + 20) return null;
    const dc = lo + (hi - lo) * r(), R = 30 + 45 * r() + dc * 0.06;
    const houses = [], plants = [];
    const nh = 2 + Math.floor(r() * 6);
    for (let j = 0; j < nh; j++) {
      const a = r() * Math.PI * 2, rr = R * 0.55 * Math.sqrt(r());
      const wx = cx + Math.cos(a) * rr, d = dc + Math.sin(a) * rr * 0.7, tube = r() < 0.45;
      houses.push({ type: tube ? 'tube' : 'tiled', wx, d, y: x.fy + 0.3, w: tube ? 4.5 + 1.5 * r() : 8 + 5 * r(), dep: tube ? 10 + 4 * r() : 6 + 2 * r(), n: 2 + Math.floor(r() * 2), col: pick(PASTEL, r), sh: pick(SHUTTER, r), sg: null, hat: r() < 0.5, roof: r() < 0.7 ? TILE : TILE_OLD, seed: hashInts(W.ws, 112, i, j) });
    }
    const np = Math.round(10 + R * 0.4);
    for (let j = 0; j < np; j++) {
      const a = r() * Math.PI * 2, rr = R * (0.45 + 0.6 * Math.sqrt(r()));
      plants.push({ wx: cx + Math.cos(a) * rr, d: dc + Math.sin(a) * rr * 0.75, k: pick(['areca', 'bamboo', 'tree', 'tree', 'banana', 'coconut', 'bamboo'], r), seed: hashInts(W.ws, 113, i, j) });
    }
    const tk = r() < 0.4 ? pick(['church', 'church', 'pagoda', 'dinh'], r) : null;
    const temple = tk ? { wx: cx + (r() - 0.5) * R, d: dc + R * 0.2, y: x.fy + 0.3, seed: hashInts(W.ws, 114, i), kind: tk, tower: r() < 0.4 ? 3 : 0, col: pick([[0.8, 0.76, 0.6], [0.78, 0.7, 0.42], [0.76, 0.6, 0.56], [0.7, 0.72, 0.74]], r) } : null;
    return { cx, dc, R, houses, plants, temple };
  });
}
function hamletsNear(W, wx, m = 0) {
  const res = [];
  for (let i = Math.floor((wx - 300 - m) / HCELL); i <= Math.floor((wx + 300 + m) / HCELL); i++) { const h = hamlet(W, i); if (h && Math.abs(wx - h.cx) < h.R * 1.3 + m) res.push(h); }
  return res;
}
// The ground of the villages: 1 beaten earth and concrete (the street's frontage), 2 gardens.
function villageYard(W, wx, d) {
  const x = xAt(W, wx), rd = x.rd, v = x.v;   // (copied: village() below moves X)
  if (d > rd + 3.4 && d < rd + 75) {
    for (const vl of villagesNear(W, wx)) {
      if (Math.abs(wx - vl.cx) < vl.half + 4) return d < rd + 21 ? 1 : v < 0.55 ? 2 : 0;
    }
  }
  if (d > rd + 30 && d < 1500 && v < 0.5) {
    for (const h of hamletsNear(W, wx)) { const dx = (wx - h.cx) / h.R, dz = (d - h.dc) / (h.R * 0.75); if (dx * dx + dz * dz < 1.1) return dx * dx + dz * dz < 0.35 ? 1 : 2; }
  }
  return 0;
}
// --- family tombs out in the paddies: pastel and grey, on a low mound ---
const TOMBCELL = 280;
function tombs(W, i) {
  return cache(W, ST.LOTUS, i, () => {
    const r = makeRng(hashInts(W.ws, 121, i));
    const wx = (i + r()) * TOMBCELL, x = xCopy(W, wx);
    if (x.v > 0.4 || r() > 0.4) return null;
    const d = x.rd + 25 + r() * Math.min(260, x.rc - x.rw / 2 - x.rd - 40);
    if (villageYard(W, wx, d)) return null;
    const n = 1 + Math.floor(r() * 4), list = [];
    for (let j = 0; j < n; j++) list.push({ dx: (j - (n - 1) / 2) * 2.2 + (r() - 0.5) * 0.6, dz: (r() - 0.5) * 1.5, h: 1.1 + 0.9 * r(), col: r() < 0.5 ? [0.66, 0.66, 0.62] : pick(PASTEL, r) });
    return { wx, d, y: x.fy, list };
  });
}
// --- stilt houses among the terraces of the valley's far side, in twos and threes ---
const STCELL = 340;
function stilts(W, i) {
  return cache(W, ST.STILT, i, () => {
    const r = makeRng(hashInts(W.ws, 131, i));
    const wx = (i + r()) * STCELL, x = xCopy(W, wx);
    if (x.v < 0.45 || r() > 0.75) return null;
    const d = x.ft + 40 + r() * 420;
    const n = 1 + Math.floor(r() * 3), list = [];
    for (let j = 0; j < n; j++) {
      const hx = wx + (j - (n - 1) / 2) * (22 + 8 * r()), hd = d + (r() - 0.5) * 20;
      list.push({ wx: hx, d: hd, y: W.H(hx, hd), w: (8 + 4 * r()) * 1.5, dep: (6 + 1.5 * r()) * 1.5, seed: hashInts(W.ws, 132, i, j), plant: pick(['banana', 'areca', 'tree', 'bamboo'], r) });
    }
    return { wx, d, list };
  });
}
// --- the station: a low platform, a station house in yellow with a red tiled roof, the flag ---
const STACELL = 5200;
function station(W, i) {
  return cache(W, ST.STATION, i, () => {
    const r = makeRng(hashInts(W.ws, 141, i));
    if (r() > 0.65) return null;
    const wx = (i + 0.3 + 0.4 * r()) * STACELL;
    // (only on the plain: the valley's bank is too steep to cut a shelf for it; v is asked of the
    // raw noise, since the x table itself asks for the stations)
    if (smooth(0.4, 0.6, noise1(wx / 3400, W.ws + 11)) > 0.2) return null;
    return { wx, len: 120, x0: wx - 60, seed: hashInts(W.ws, 142, i), name: Math.floor(r() * 1000) };
  });
}
function stationNear(W, wx) { const i = Math.floor(wx / STACELL); for (const j of [i - 1, i, i + 1]) { const s = station(W, j); if (s && wx > s.x0 - 80 && wx < s.x0 + s.len + 80) return s; } return null; }
// --- power poles on the far side of the road, every 30-40 m (a gap now and then) ---
const POLECELL = 36;
function poleAt(W, i) {
  return cache(W, ST.POLE, i, () => {
    const r = makeRng(hashInts(W.ws, 151, i));
    const wx = (i + 0.3 * r()) * POLECELL, x = xAt(W, wx);
    if (r() < 0.06 || noise1(wx / 1900, W.ws + 152) < 0.38) return null;   // (stretches without a line)
    return { wx, d: x.rd + 3.9, y: x.rdY, h: 7.5 + r() * 1.2, lean: [(r() - 0.5) * 0.08, (r() - 0.5) * 0.08], tx: r() < 0.12, lamp: r() < 0.45 };
  });
}
// --- plants along the road (outside the villages) and on the dykes and river banks ---
const PLCELL = 22;
function roadPlant(W, i) {
  return cache(W, ST.CLUMP, i, () => {
    const r = makeRng(hashInts(W.ws, 161, i));
    const wx = (i + r()) * PLCELL;
    if (villagesNear(W, wx).length) return null;
    const x = xAt(W, wx);
    const u = r();
    let d, k;
    if (u < 0.22) { d = x.rd + 6 + r() * 6; k = pick(['banana', 'bamboo', 'banana', 'areca', 'banana', 'tree'], r); }
    else if (u < 0.34) { d = 16 + r() * (x.rd - 22); k = pick(['banana', 'banana', 'tree'], r); }
    else if (u < 0.44 && x.v < 0.5) { const rb = x.rc - x.rw / 2 - 5 - r() * 10; d = rb; k = pick(['bamboo', 'bamboo', 'banana', 'tree', 'coconut'], r); }
    else if (u < 0.5 && x.v > 0.5) { d = x.rc + x.rw / 2 + 5 + r() * 10; k = pick(['bamboo', 'banana', 'tree'], r); }
    else return null;
    return { wx, d, k, seed: hashInts(W.ws, 162, i) };
  });
}

// ---------------------------------------------------------------------------------------------
// Drawing the sites (each band draws what stands inside it)
// ---------------------------------------------------------------------------------------------
function templeOf(t) { return t.kind === 'church' ? church : t.kind === 'dinh' ? dinh : pagoda; }
function* drawHouse(ctx, out, h, night) {
  if (h.type === 'tube') yield* tubeHouse(ctx, out, h, night);
  else if (h.type === 'shop') yield* tinShop(ctx, out, h, night);
  else yield* tiledHouse(ctx, out, h, night);
}
function* drawPlant(ctx, out, p, W) {
  const r = makeRng(p.seed);
  yield* plant(ctx, out, p.k, p.wx - ctx.x0, p.d, W.H(p.wx, p.d) - 0.1, r, p.d < 70 ? 0.7 : 1);   // (smaller by the road: the view goes past them)
}
function* villages(ctx, out, W, dLo, dHi, night) {
  const L = ctx.length;
  for (let i = Math.floor((ctx.x0 - 400) / VCELL); i <= Math.floor((ctx.x0 + L + 400) / VCELL); i++) {
    const v = village(W, i);
    if (!v || v.cx + v.half + 40 < ctx.x0 || v.cx - v.half - 40 > ctx.x0 + L) continue;
    note('village', v.cx, v.rd0);
    if (v.temple && v.temple.d >= dLo && v.temple.d < dHi && inX(ctx, v.temple.wx, 30)) { note(v.temple.kind, v.temple.wx, v.temple.d); yield* templeOf(v.temple)(ctx, out, v.temple, night); }
    if (v.gate && v.gate.d >= dLo && v.gate.d < dHi && inX(ctx, v.gate.wx, 6)) { note('gate', v.gate.wx, v.gate.d); yield* gate(ctx, out, v.gate); }
    if (v.market && v.market.d >= dLo && v.market.d < dHi && inX(ctx, v.market.wx, 24)) { note('market', v.market.wx, v.market.d); yield* market(ctx, out, W, v.market, night); }
    for (const h of v.houses) if (h.d >= dLo && h.d < dHi && inX(ctx, h.wx, h.w)) yield* drawHouse(ctx, out, h, night);
    for (const p of v.plants) if (p.d >= dLo && p.d < dHi && inX(ctx, p.wx, 8)) yield* drawPlant(ctx, out, p, W);
  }
}
function* hamlets(ctx, out, W, dLo, dHi, night) {
  const L = ctx.length;
  for (let i = Math.floor((ctx.x0 - 300) / HCELL); i <= Math.floor((ctx.x0 + L + 300) / HCELL); i++) {
    const h = hamlet(W, i);
    if (!h || h.cx + h.R + 20 < ctx.x0 || h.cx - h.R - 20 > ctx.x0 + L) continue;
    if (h.dc + h.R < dLo || h.dc - h.R > dHi) continue;
    note('hamlet', h.cx, h.dc);
    for (const p of h.plants) if (p.d >= dLo && p.d < dHi && inX(ctx, p.wx, 8)) yield* drawPlant(ctx, out, p, W);
    for (const hs of h.houses) if (hs.d >= dLo && hs.d < dHi && inX(ctx, hs.wx, hs.w)) yield* drawHouse(ctx, out, hs, night);
    if (h.temple && h.temple.d >= dLo && h.temple.d < dHi && inX(ctx, h.temple.wx, 30)) { note(h.temple.kind, h.temple.wx, h.temple.d); yield* templeOf(h.temple)(ctx, out, h.temple, night); }
  }
}
function* tombsDraw(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, TOMBCELL, 10)) {
    const t = tombs(W, i);
    if (!t || t.d < dLo || t.d >= dHi || !inX(ctx, t.wx, 8)) continue;
    const x = t.wx - ctx.x0, s = bs(out, t.d, 1.2), rr = makeRng(hashInts(W.ws, 122, i));
    out(x, t.y + 0.1, -t.d, t.list.length * 1.4 + 1, 0.4, 2.2, 0.26, 0.34, 0.14, 1, 0, 0, 0, 1, KIND.GROUND);
    for (const g of t.list) {
      const gx = x + g.dx, gz = -(t.d + g.dz);
      yield* front(out, gx - 0.6, t.y + 0.2, gz + 0.6, 1.2, g.h, s, () => faceTone(g.col, 0, 1), KIND.BUILDING, rr);
      yield* endWall(out, gx - 0.6, t.y + 0.2, gz - 0.6, 1.2, g.h, s, () => faceTone(g.col, -1, 0), KIND.BUILDING, rr);
      yield* endWall(out, gx + 0.6, t.y + 0.2, gz - 0.6, 1.2, g.h, s, () => faceTone(g.col, 1, 0), KIND.BUILDING, rr);
      out(gx, t.y + 0.25 + g.h, gz, 0.85, 0.22, 0.85, g.col[0] * 0.8, g.col[1] * 0.8, g.col[2] * 0.8, 1, 0, 0, 0, 1, KIND.BUILDING);
      out(gx, t.y + 0.55 + g.h, gz, 0.3, 0.2, 0.3, g.col[0] * 0.9, g.col[1] * 0.9, g.col[2] * 0.9, 1, 0, 0, 0, 1, KIND.BUILDING);
    }
  }
}
function* stiltsDraw(ctx, out, W, dLo, dHi, night) {
  for (const { i } of cellsAround(ctx, STCELL, 40)) {
    const g = stilts(W, i);
    if (!g) continue;
    for (const h of g.list) {
      if (h.d < dLo || h.d >= dHi || !inX(ctx, h.wx, 10)) continue;
      note('stilt', h.wx, h.d);
      yield* stiltHouse(ctx, out, h, night);
      const r = makeRng(h.seed ^ 77);
      yield* plant(ctx, out, h.plant, h.wx - ctx.x0 + (r() < 0.5 ? -1 : 1) * (h.w * 0.5 + 3), h.d + 3, W.H(h.wx, h.d + 3), r);
    }
  }
}
function* polesDraw(ctx, out, W, dLo, dHi, night) {
  let prev = null;
  for (const { i } of cellsAround(ctx, POLECELL, POLECELL * 1.5)) {
    const p = poleAt(W, i);
    if (p && p.d >= dLo && p.d < dHi) {
      if (inX(ctx, p.wx, 2)) pole(ctx, out, p, night);
      if (prev && p.wx - prev.wx < POLECELL * 2.5) poleWires(ctx, out, prev, p, p.d, 3);
    }
    prev = p || prev;
    if (out.due()) yield;
  }
}
function* roadPlants(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, PLCELL, 8)) {
    const p = roadPlant(W, i);
    if (p && p.d >= dLo && p.d < dHi && inX(ctx, p.wx, 8)) yield* drawPlant(ctx, out, p, W);
  }
}
// The market: stalls under tarpaulins of every colour on bamboo poles, the produce heaped on
// trays (greens, fruit, chillies), sellers in conical hats squatting among them.
function* market(ctx, out, W, m, night) {
  const r = makeRng(m.seed), x = m.wx - ctx.x0, s = bs(out, m.d, 1.3);
  const TARPS = [[0.14, 0.34, 0.68], [0.8, 0.42, 0.08], [0.72, 0.12, 0.1], [0.18, 0.5, 0.3], [0.78, 0.7, 0.14], [0.5, 0.52, 0.56]];
  const GOODS = [[0.3, 0.56, 0.14], [0.8, 0.52, 0.06], [0.76, 0.12, 0.08], [0.7, 0.66, 0.2], [0.52, 0.22, 0.34], [0.8, 0.76, 0.6]];
  for (let k = 0; k < 7; k++) {
    const tx = x - 17 + k * 5.6 + (r() - 0.5), td = m.d + 1.5 + r() * 9, tw = 4 + r() * 1.5, tdp = 3.2 + r(), th = 2.4 + 0.4 * r();
    const c = pick(TARPS, r), y = m.y;
    const tilt = 0.5, sl = Math.hypot(tdp, tilt);
    yield* panel(out, [tx - tw / 2, y + th + tilt, -(td + tdp)], [1, 0, 0], [0, -tilt / sl, tdp / sl], tw, sl, s, () => soft(c, 0.7), KO, r, 0.1);
    for (let j = 0; j < 3; j++) out(tx - tw / 2 + (j + 0.5) * tw / 3, y + th - 0.1, -td + 0.05, tw / 6, 0.14, 0.04, c[0] * 0.9, c[1] * 0.9, c[2] * 0.9, 1, 0, 0, 0, 1, KO, MOVE.FLAG);
    for (const ex of [tx - tw / 2 + 0.2, tx + tw / 2 - 0.2]) bar(out, ex, y, -td, ex, y + th, -td, Math.max(0.05, thin(m.d)), [0.5, 0.44, 0.28], 2, KIND.BUILDING, MOVE.STILL);
    // the trays of produce and a seller
    for (let j = 0; j < 3; j++) { const g = pick(GOODS, r); out(tx - 1.2 + j * 1.2, y + 0.55, -(td + 1.2), 0.5, 0.22, 0.45, g[0], g[1], g[2], 1, 0, 0, 0, 1, KIND.BUILDING, MOVE.STILL); }
    if (r() < 0.8) personAt(out, tx + (r() - 0.5) * 2, y, td + 2.2, r() < 0.5 ? 0 : Math.PI, r, { pose: r() < 0.5 ? 'squat' : 'stand', hat: true });
    if (night && r() < 0.7) out(tx, y + th - 0.3, -(td + 1), 0.12, 0.12, 0.12, 1, 0.86, 0.6, 1, 0, 0, 0, 1, KIND.LIGHT);
    if (out.due()) yield;
  }
}
// The station: a low platform (under 1 m, by the line), the station house beyond it, lamps, a
// name board and the flag. Drawn by the trackside band.
function* stationDraw(ctx, out, W, st, night) {
  const r = makeRng(st.seed), x0 = st.x0 - ctx.x0;
  // the platform's edge and top (within 6 m: kept below 1 m)
  for (let u = 0; u < st.len; u += 0.8) {
    if (!inX(ctx, st.x0 + u, 1)) continue;
    out(x0 + u, 0.45, -3.3, 0.5, 0.42, 0.12, 0.6, 0.58, 0.52, 1, 0, 0, 0, 1, KIND.BUILDING);
    out(x0 + u, 0.88, -3.35, 0.5, 0.04, 0.12, 0.8, 0.7, 0.12, 1, 0, 0, 0, 1, KIND.BUILDING);   // the yellow line
    for (let dz = 3.9; dz < 7.5; dz += 0.9) out(x0 + u, 0.88, -dz, 0.55, 0.05, 0.55, 0.5, 0.49, 0.46, 1, 0, 0, 0, 1, KIND.BUILDING);
  }
  const hs = { wx: st.wx, d: 13, y: -0.4, w: 18, dep: 5, col: [0.8, 0.66, 0.26], seed: st.seed, roof: TILE };
  if (inX(ctx, st.wx, 20)) {
    yield* tiledHouse(ctx, out, hs, night);
    // the name board on its posts, white with dark letters
    const bx = st.wx - ctx.x0 - 18;
    for (const ex of [-1.6, 1.6]) bar(out, bx + ex, -0.3, -8.2, bx + ex, 3.2, -8.2, 0.07, [0.3, 0.3, 0.3], 2, KIND.MAST);
    yield* front(out, bx - 2, 2.4, -8.15, 4, 1.0, 0.12, (a, b) => (b > 0.3 && b < 0.7 && a > 0.1 && a < 0.9 && Math.sin(a * 37 + st.name) > -0.2 ? [0.1, 0.16, 0.4] : [0.78, 0.78, 0.76]), KIND.BUILDING, r);
    // the flag
    const fx = st.wx - ctx.x0 + 13;
    bar(out, fx, -0.3, -19, fx, 7.2, -19, 0.08, [0.6, 0.6, 0.6], 4, KIND.MAST);
    flagVN(out, fx, 7.0, -19, 1.3);
  }
  for (let u = 10; u < st.len; u += 20) {
    const lx = x0 + u;
    if (!inX(ctx, st.x0 + u, 1)) continue;
    bar(out, lx, 0.88, -7, lx, 4.6, -7, 0.06, [0.3, 0.32, 0.32], 2, KIND.MAST);
    out(lx, 4.6, -7, 0.18, 0.12, 0.18, 1, 0.92, 0.7, 1, 0, 0, 0, 1, KIND.LIGHT);
  }
}

// ---------------------------------------------------------------------------------------------
// People, animals, boats and machines. Drawn larger than life (people 1.8 times, more beyond 60 m)
// so that they read from a moving train; a fixed handful of shaped splats each, whatever the
// budget; limbs, poles and cords are bars sized from distance. Each figure is built in its own
// frame: u along its heading, h up, v to its left, in life-size metres times the frame's scale.
// People and animals flash on the beat (MOVE.FLASH); boats and parked machines do nothing on the beat (MOVE.STILL);
// whatever rides the road is carried along it (MOVE.RIDE). (After karst.js.)
// ---------------------------------------------------------------------------------------------
const PK = 1.8, BK = 1.8;
const farK = (d) => 1 + 0.5 * smooth(50, 170, d);
const CLOTH = [[0.16, 0.22, 0.42], [0.76, 0.75, 0.7], [0.62, 0.2, 0.16], [0.3, 0.45, 0.62], [0.42, 0.4, 0.28], [0.12, 0.12, 0.14], [0.7, 0.42, 0.46], [0.3, 0.36, 0.22]];
const PONCHO = [[0.8, 0.12, 0.1], [0.14, 0.34, 0.76], [0.8, 0.7, 0.08], [0.16, 0.56, 0.26], [0.78, 0.34, 0.56], [0.44, 0.22, 0.62], [0.8, 0.44, 0.08], [0.1, 0.56, 0.66]];
const UMBRELLA = [[0.8, 0.1, 0.12], [0.12, 0.3, 0.7], [0.8, 0.66, 0.1], [0.14, 0.14, 0.16], [0.7, 0.3, 0.6], [0.16, 0.5, 0.3]];
const SKIN = [[0.62, 0.46, 0.34], [0.54, 0.39, 0.28], [0.68, 0.52, 0.4]];
const STRAW = [0.78, 0.7, 0.46], WOOD = [0.36, 0.28, 0.2], WICKER = [0.6, 0.5, 0.3];
// x is chunk-local; yaw 0 faces +x (the way the train runs), pi/2 faces away from the line.
function frame(x, y, d, yaw, k, move = FL) {
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  return { x, y, d, yaw, k, ca, sa, move, thin: Math.max(0.035, 0.0007 * d), P: (u, h, v = 0) => [x + (u * ca - v * sa) * k, y + h * k, -(d + (u * sa + v * ca) * k)] };
}
function sub(f, u, v, k = f.k, turn = 0, h = 0) { return frame(f.x + (u * f.ca - v * f.sa) * f.k, f.y + h * f.k, f.d + (u * f.sa + v * f.ca) * f.k, f.yaw + turn, k, f.move); }
// An ellipsoid: ru along the heading (tilted up by `pitch`), rh up, rv across.
function ell(out, f, u, h, v, ru, rh, rv, c, pitch = 0, kind = KO) {
  const p = f.P(u, h, v), cp = Math.cos(pitch), q = quatXTo(f.ca * cp, Math.sin(pitch), -f.sa * cp);
  out(p[0], p[1], p[2], ru * f.k, rh * f.k, rv * f.k, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind, f.move);
}
// A limb, pole or cord from a to b (points from f.P), r thick in life-size metres.
function lim(out, f, a, b, r, c, n = 2) { bar(out, a[0], a[1], a[2], b[0], b[1], b[2], Math.max(r * f.k, f.thin), c, n, KO, f.move); }
function ripple(out, x, y, d, rx, rz, c = [0.7, 0.72, 0.74], op = 0.6) { out(x, y + 0.03, -d, rx, 0.025, rz, c[0], c[1], c[2], op, 0, 0, 0, 1, KIND.GROUND); }
// A conical hat (non la): pale straw, a broad low cone.
function nonLa(out, f, u, h, hd = 1) {
  ell(out, f, u, h + 0.04, 0, 0.29 * hd, 0.045, 0.29 * hd, STRAW);
  ell(out, f, u, h + 0.12, 0, 0.15 * hd, 0.075, 0.15 * hd, mul3(STRAW, 0.92));
}

// A person. o: { pose: 'stand' | 'walk' | 'bent' (planting) | 'squat' | 'sit', arms: 'down' |
// 'swing' | 'fwd' | 'up' | 'pole' | 'umbrella', hat (non la; default yes for adults), wade (metres
// of leg under water, not drawn), shirt, child, poncho (a colour: a raincoat over everything),
// umbrella (a colour) }
function person(out, f, r, o = {}) {
  const pose = o.pose || 'stand', wade = o.wade || 0;
  const shirt = o.shirt || pick(CLOTH, r), trous = r() < 0.7 ? [0.13, 0.14, 0.18] : [0.3, 0.3, 0.34], skin = pick(SKIN, r);
  const hat = o.hat != null ? o.hat : !o.child && !o.umbrella, hd = o.child ? 1.25 : 1;
  const L = (a, b, c, rr = 0.065) => lim(out, f, a, b, rr, c);
  const pc = o.poncho;
  if (pose === 'bent') {
    for (const v of [-0.1, 0.1]) L(f.P(0, 0.84, v), f.P(0.03, wade, v * 1.15), trous);
    ell(out, f, 0.26, 0.94, 0, 0.31, 0.17, 0.18, pc || shirt, 0.3);
    if (pc) ell(out, f, 0.2, 0.8, 0, 0.42, 0.22, 0.26, pc, 0.2);
    for (const v of [-0.16, 0.16]) L(f.P(0.47, 0.98, v), f.P(0.62, Math.max(wade, 0.05) + 0.1, v * 0.7), mul3(pc || shirt, 0.88), 0.045);
    ell(out, f, 0.66, 0.99, 0, 0.105 * hd, 0.105 * hd, 0.105 * hd, skin);
    if (hat) { ell(out, f, 0.73, 1.07, 0, 0.055, 0.3, 0.3, STRAW, 0.75); ell(out, f, 0.79, 1.13, 0, 0.1, 0.14, 0.14, mul3(STRAW, 0.9), 0.75); }
    return;
  }
  let hip = 0.86;
  if (pose === 'squat') { ell(out, f, 0.1, 0.3, 0, 0.22, 0.15, 0.19, trous); hip = 0.34; }
  else if (pose === 'sit') {
    hip = o.seat != null ? o.seat : 0.45;
    for (const v of [-0.1, 0.1]) { L(f.P(0, hip, v), f.P(0.4, hip - 0.02, v), trous); L(f.P(0.4, hip - 0.02, v), f.P(0.46, Math.max(0, hip - 0.45), v), trous); }
  } else {
    const st = pose === 'walk' ? 0.2 : 0.02;
    L(f.P(0, hip, -0.09), f.P(st, wade, -0.1), trous);
    L(f.P(0, hip, 0.09), f.P(-st, wade, 0.1), mul3(trous, 0.8));
  }
  ell(out, f, 0, hip + 0.3, 0, 0.16, 0.29, 0.19, shirt);
  const sy = hip + 0.55, hy = hip + 0.72 + 0.02 * hd, arms = o.arms || (o.umbrella ? 'umbrella' : pose === 'walk' ? 'swing' : 'down'), sleeve = mul3(pc || shirt, 0.88);
  for (const sg of [-1, 1]) {
    let b;
    if (arms === 'fwd') b = f.P(0.42, sy - 0.38, sg * 0.14);
    else if (arms === 'up') b = f.P(0.1, sy + 0.42, sg * 0.3);
    else if (arms === 'umbrella' && sg > 0) b = f.P(0.16, sy + 0.12, 0.05);
    else if (arms === 'swing') b = f.P(sg * 0.17, sy - 0.47, sg * 0.23);
    else if (arms === 'pole' && sg > 0) b = f.P(0.3, sy + 0.04, 0.08);
    else b = f.P(0.04, sy - 0.48, sg * 0.24);
    L(f.P(0, sy, sg * 0.2), b, sleeve, 0.045);
  }
  if (pc) {
    // a plastic poncho: a bright tent from the shoulders to below the knees, a hood
    ell(out, f, 0.02, hip + 0.15, 0, 0.3, 0.5, 0.3, pc);
    ell(out, f, 0, hip + 0.52, 0, 0.22, 0.2, 0.25, mul3(pc, 0.94));
  }
  ell(out, f, 0.02, hy, 0, 0.105 * hd, 0.11 * hd, 0.105 * hd, skin);
  if (pc && !hat) ell(out, f, -0.02, hy + 0.04, 0, 0.13, 0.12, 0.13, mul3(pc, 0.9));
  else if (hat) nonLa(out, f, 0.02, hy + 0.06);
  else ell(out, f, -0.01, hy + 0.07 * hd, 0, 0.11 * hd, 0.07 * hd, 0.11 * hd, [0.08, 0.07, 0.07]);
  if (o.umbrella) {
    // the umbrella over the head: a shallow dome on a shaft
    const sb = f.P(0.12, sy + 0.12, 0.05), st = f.P(0.1, hy + 0.55, 0.05);
    lim(out, f, sb, st, 0.02, [0.2, 0.2, 0.2], 1);
    const ub = o.ub || 1;
    ell(out, f, 0.08, hy + 0.5, 0, 0.62 * ub, 0.13 * Math.sqrt(ub), 0.62 * ub, mul3(o.umbrella, 0.8));
    ell(out, f, 0.08, hy + 0.5 + 0.12 * Math.sqrt(ub), 0, 0.4 * ub, 0.12 * Math.sqrt(ub), 0.4 * ub, o.umbrella);
    lim(out, f, f.P(0.08, hy + 0.62 + 0.2 * Math.sqrt(ub), 0), f.P(0.08, hy + 0.8 + 0.2 * Math.sqrt(ub), 0), 0.02, [0.2, 0.2, 0.2], 1);
  }
}
// A person in chunk-local x at distance d, standing on y, facing yaw, at the usual scale.
function personAt(out, x, y, d, yaw, r, o = {}) { person(out, frame(x, y, d, yaw, PK * farK(d) * (o.child ? 0.62 : 1)), r, o); }
// A carrying pole across the shoulder with a basket hanging from each end (use arms: 'pole').
function shoulderPole(out, f, r) {
  const LOADS = [[0.3, 0.5, 0.2], [0.74, 0.64, 0.32], [0.64, 0.2, 0.14], [0.7, 0.7, 0.66], [0.76, 0.46, 0.12]];
  const load = pick(LOADS, r);
  lim(out, f, f.P(-1.0, 1.45, 0.06), f.P(1.0, 1.45, 0.06), 0.022, [0.5, 0.42, 0.26], 3);
  for (const e of [-1, 1]) {
    for (const s of [-0.15, 0.15]) lim(out, f, f.P(e, 1.45, 0.06), f.P(e + s, 0.86, 0.06), 0.012, [0.3, 0.27, 0.2], 1);
    ell(out, f, e, 0.7, 0.06, 0.21, 0.15, 0.21, WICKER);
    ell(out, f, e, 0.88, 0.06, 0.17, 0.1, 0.17, load);
  }
}
// A water buffalo: slate grey, deep bellied, head low and forward, crescent horns swept back.
// o: { pose: 'stand' | 'graze' | 'wallow', wade, egret }
function buffalo(out, f, r, o = {}) {
  const pose = o.pose || 'stand', wade = o.wade || 0;
  const base = jitter(o.wet ? [0.16, 0.16, 0.17] : [0.22, 0.21, 0.21], r, 0.12), hi = [base[0] * 1.5 + 0.04, base[1] * 1.5 + 0.04, base[2] * 1.5 + 0.05], lo = mul3(base, 0.72);
  const horns = (u, h, bu, bh) => {
    const nu = -bh, nh = bu;
    for (const sg of [-1, 1]) {
      const pt = (t, s, v) => f.P(u + bu * t + nu * s, h + bh * t + nh * s, sg * v);
      const a = pt(0, 0, 0.1), b = pt(0.22, 0.07, 0.42), c = pt(0.55, 0.12, 0.52), e = pt(0.8, 0.13, 0.38);
      lim(out, f, a, b, 0.05, [0.5, 0.48, 0.42], 1); lim(out, f, b, c, 0.042, [0.56, 0.54, 0.47], 1); lim(out, f, c, e, 0.032, [0.6, 0.58, 0.5], 1);
    }
  };
  if (pose === 'wallow') {
    ell(out, f, -0.15, 0.5, 0, 0.62, 0.34, 0.33, base);
    ell(out, f, -0.2, 0.84, 0, 0.46, 0.07, 0.2, hi);
    ell(out, f, 0.72, 0.62, 0, 0.3, 0.2, 0.18, base, 0.4);
    ell(out, f, 1.05, 0.8, 0, 0.26, 0.14, 0.15, base, 0.2);
    ell(out, f, 1.3, 0.84, 0, 0.1, 0.085, 0.1, lo);
    horns(0.92, 0.95, -0.93, 0.36);
    if (o.egret) egret(out, sub(f, -0.35, 0, 1.7 * f.k / BK, 0, 0.9));
    return;
  }
  const graze = pose === 'graze';
  if (wade < 0.7) for (const [u, v, c] of [[0.6, -0.2, lo], [-0.52, -0.2, lo], [0.5, 0.2, base], [-0.62, 0.2, base]]) lim(out, f, f.P(u, 0.75, v), f.P(u + 0.03, wade, v), 0.085, c);
  ell(out, f, -0.55, 1.0, 0, 0.4, 0.3, 0.27, base);
  ell(out, f, 0.0, 0.93, 0, 0.5, 0.33, 0.3, base);
  ell(out, f, 0.52, 1.05, 0, 0.33, 0.31, 0.27, base);
  ell(out, f, -0.05, 1.27, 0, 0.62, 0.07, 0.2, hi);
  const hu = graze ? 1.14 : 1.32, hh = graze ? 0.42 : 0.98;
  ell(out, f, graze ? 0.9 : 0.98, graze ? 0.78 : 1.03, 0, 0.3, 0.17, 0.16, base, graze ? -0.9 : -0.12);
  ell(out, f, hu, hh, 0, 0.25, 0.13, 0.14, base, graze ? -1.0 : -0.25);
  ell(out, f, hu + (graze ? 0.06 : 0.2), hh - (graze ? 0.22 : 0.07), 0, 0.1, 0.09, 0.1, lo);
  if (graze) horns(hu - 0.12, hh + 0.2, -0.45, 0.9); else horns(hu - 0.17, hh + 0.13, -0.93, 0.36);
  lim(out, f, f.P(-0.93, 1.1, 0), f.P(-1.04, 0.55, 0), 0.035, base, 2);
  if (o.egret) egret(out, sub(f, -0.3, 0, 1.7 * f.k / BK, 0, 1.3));
}
function egret(out, f) {
  const w = [0.8, 0.8, 0.77];
  for (const v of [-0.04, 0.04]) lim(out, f, f.P(0, 0.5, v), f.P(0.02, 0, v), 0.012, [0.14, 0.14, 0.12], 1);
  ell(out, f, -0.03, 0.6, 0, 0.21, 0.1, 0.1, w, 0.45);
  lim(out, f, f.P(0.12, 0.68, 0), f.P(0.2, 0.95, 0), 0.03, w, 1);
  ell(out, f, 0.21, 1.0, 0, 0.055, 0.045, 0.045, w);
  lim(out, f, f.P(0.24, 1.0, 0), f.P(0.4, 0.96, 0), 0.014, [0.78, 0.6, 0.16], 1);
}
// A duck on the water (frame scale about 2): white, brown or mottled, an orange bill.
function duck(out, f, c) {
  ell(out, f, 0, 0.11, 0, 0.2, 0.1, 0.13, c);
  ell(out, f, -0.16, 0.16, 0, 0.07, 0.06, 0.08, mul3(c, 0.9), 0.5);
  ell(out, f, 0.19, 0.27, 0, 0.065, 0.065, 0.065, c);
  ell(out, f, 0.28, 0.25, 0, 0.05, 0.022, 0.035, [0.78, 0.5, 0.12]);
}

// A moped and its rider in a poncho that covers rider and handlebars, sometimes a passenger behind
// (a second poncho) or a child in front, a load strapped behind; the headlamp always lit in the
// rain. f.move is MOVE.RIDE on the road (or STILL when parked).
function moped(out, f, r, o = {}) {
  const pc = o.poncho || pick(PONCHO, r), body = pick([[0.7, 0.7, 0.68], [0.12, 0.12, 0.14], [0.6, 0.12, 0.1], [0.2, 0.3, 0.5], [0.74, 0.62, 0.3]], r);
  const tyre = [0.07, 0.07, 0.07];
  ell(out, f, -0.62, 0.3, 0, 0.3, 0.3, 0.06, tyre);
  ell(out, f, 0.58, 0.3, 0, 0.29, 0.29, 0.06, tyre);
  ell(out, f, -0.35, 0.58, 0, 0.42, 0.22, 0.2, body);                  // the body under the seat
  ell(out, f, 0.1, 0.36, 0, 0.32, 0.08, 0.17, mul3(body, 0.6));         // the footboard
  ell(out, f, 0.45, 0.78, 0, 0.1, 0.36, 0.2, body, 0.2);               // the leg shield
  lim(out, f, f.P(0.52, 0.5, 0), f.P(0.62, 0.3, 0), 0.04, [0.3, 0.3, 0.3], 1);
  lim(out, f, f.P(0.52, 1.12, -0.32), f.P(0.52, 1.12, 0.32), 0.03, [0.15, 0.15, 0.15], 1);   // handlebars
  // the lamps (lights)
  const hp = f.P(0.62, 0.95, 0), tp = f.P(-0.95, 0.66, 0);
  if (!o.parked) out(hp[0], hp[1], hp[2], 0.1 * f.k, 0.08 * f.k, 0.1 * f.k, 1, 0.95, 0.78, 1, 0, 0, 0, 1, KIND.LIGHT, f.move);
  if (!o.parked) out(tp[0], tp[1], tp[2], 0.06 * f.k, 0.05 * f.k, 0.08 * f.k, 1, 0.12, 0.08, 1, 0, 0, 0, 1, KIND.LIGHT, f.move);
  if (o.parked) { ell(out, f, -0.3, 0.86, 0, 0.36, 0.08, 0.16, [0.12, 0.1, 0.1]); return; }   // the seat, nobody on it
  // the rider: legs down to the footboard, then the poncho over everything to the handlebars
  const trous = [0.14, 0.14, 0.18], skin = pick(SKIN, r);
  for (const v of [-0.13, 0.13]) { lim(out, f, f.P(-0.25, 0.86, v), f.P(0.12, 0.72, v * 1.2), 0.07, trous); lim(out, f, f.P(0.12, 0.72, v * 1.2), f.P(0.16, 0.4, v * 1.2), 0.06, trous); }
  // the poncho: a tent from the shoulders, stretched forward over the handlebars and falling
  // behind over the seat, the rider's shape inside it
  ell(out, f, -0.18, 1.3, 0, 0.17, 0.3, 0.2, mul3(pc, 0.85));                 // the body within
  ell(out, f, 0.22, 1.24, 0, 0.46, 0.06, 0.36, pc, -0.55);                    // the front, to the bars
  ell(out, f, -0.48, 1.12, 0, 0.42, 0.06, 0.34, mul3(pc, 0.92), 0.85);        // the back, over the seat
  ell(out, f, -0.1, 0.86, 0, 0.5, 0.18, 0.4, mul3(pc, 0.95));                 // the hem round the knees
  ell(out, f, -0.16, 1.5, 0, 0.16, 0.12, 0.22, pc);                           // the shoulders
  ell(out, f, -0.16, 1.7, 0, 0.11, 0.12, 0.11, skin);
  if (r() < 0.55) ell(out, f, -0.18, 1.79, 0, 0.14, 0.1, 0.14, pick([[0.8, 0.76, 0.7], [0.12, 0.3, 0.7], [0.7, 0.12, 0.1], [0.14, 0.14, 0.14]], r));   // helmet
  else ell(out, f, -0.2, 1.75, 0, 0.14, 0.12, 0.14, mul3(pc, 0.86));                                                                                   // the hood
  if (o.pillion) {
    const p2 = pick(PONCHO, r);
    ell(out, f, -0.66, 1.2, 0, 0.16, 0.3, 0.2, p2);
    ell(out, f, -0.82, 1.05, 0, 0.32, 0.06, 0.32, mul3(p2, 0.92), 1.0);
    ell(out, f, -0.66, 0.88, 0, 0.36, 0.16, 0.36, mul3(p2, 0.95));
    ell(out, f, -0.64, 1.66, 0, 0.11, 0.12, 0.11, skin);
    if (r() < 0.5) nonLa(out, f, -0.6, 1.76);
    else ell(out, f, -0.62, 1.79, 0, 0.14, 0.1, 0.14, mul3(p2, 0.86));
  } else if (o.load) {
    const c = pick([[0.3, 0.5, 0.2], [0.74, 0.64, 0.32], [0.7, 0.7, 0.66], [0.2, 0.4, 0.66]], r);
    ell(out, f, -0.82, 0.96, 0, 0.32, 0.26, 0.38, c);
    ell(out, f, -0.82, 1.3, 0, 0.26, 0.14, 0.32, mul3(c, 0.88));
  }
}
// A box on wheels heading along the line: a small truck (a blue cab, a load under a green tarp),
// or a bus (cream with a band, dark windows, lit within when it is dark). Lamps lit.
function vehicle(out, f, r, type, night) {
  const tyre = [0.07, 0.07, 0.07], K = KO;
  if (type === 'bus') {
    const col = pick([[0.78, 0.76, 0.7], [0.8, 0.62, 0.12], [0.2, 0.46, 0.66]], r), band = pick([[0.62, 0.14, 0.12], [0.16, 0.3, 0.56], [0.2, 0.5, 0.3]], r);
    for (const u of [-3.2, 2.6]) for (const v of [-1.05, 1.05]) ell(out, f, u, 0.5, v, 0.5, 0.5, 0.15, tyre);
    for (let k = 0; k < 5; k++) ell(out, f, -4 + k * 2, 1.45, 0, 1.15, 0.85, 1.15, col, 0, K);
    for (let k = 0; k < 5; k++) ell(out, f, -4 + k * 2, 2.55, 0, 1.1, 0.42, 1.12, night ? [0.2, 0.18, 0.14] : [0.14, 0.15, 0.17], 0, K);
    if (night) for (let k = 0; k < 5; k++) { const p = f.P(-4 + k * 2, 2.55, 1.16); out(p[0], p[1], p[2], 0.7 * f.k, 0.3 * f.k, 0.05, 1, 0.86, 0.6, 1, 0, 0, 0, 1, KIND.LIGHT, f.move); }
    for (let k = 0; k < 5; k++) ell(out, f, -4 + k * 2, 3.15, 0, 1.15, 0.2, 1.15, col, 0, K);
    for (let k = 0; k < 5; k++) ell(out, f, -4 + k * 2, 1.85, 1.17, 1.0, 0.12, 0.05, band, 0, K);
    for (const v of [-0.8, 0.8]) { const p = f.P(5.05, 1.2, v); out(p[0], p[1], p[2], 0.14 * f.k, 0.12 * f.k, 0.14 * f.k, 1, 0.95, 0.8, 1, 0, 0, 0, 1, KIND.LIGHT, f.move); }
    return;
  }
  const cab = pick([[0.16, 0.3, 0.62], [0.76, 0.74, 0.7], [0.12, 0.42, 0.3]], r), tarp = pick([[0.2, 0.42, 0.22], [0.16, 0.3, 0.6], [0.66, 0.2, 0.14]], r);
  for (const u of [-1.4, 1.5]) for (const v of [-0.8, 0.8]) ell(out, f, u, 0.42, v, 0.42, 0.42, 0.13, tyre);
  ell(out, f, 1.75, 1.35, 0, 0.62, 0.72, 0.85, cab, 0, K);
  ell(out, f, 1.85, 1.6, 0, 0.4, 0.3, 0.8, [0.12, 0.13, 0.15], 0, K);
  ell(out, f, -0.7, 1.5, 0, 1.75, 0.8, 0.92, tarp, 0, K);
  ell(out, f, -0.7, 0.75, 0, 1.75, 0.12, 0.85, [0.2, 0.2, 0.2], 0, K);
  for (const v of [-0.6, 0.6]) { const p = f.P(2.4, 1.0, v); out(p[0], p[1], p[2], 0.12 * f.k, 0.1 * f.k, 0.12 * f.k, 1, 0.95, 0.8, 1, 0, 0, 0, 1, KIND.LIGHT, f.move); }
}
// A sampan: a narrow dark hull with a raised bow and stern, a curved cane hood amidships, the
// rower standing at the stern in a conical hat; or a fisherman casting a net.
function sampan(out, f, r, night) {
  const hull = [0.2, 0.15, 0.1], len = 3.4;
  ell(out, f, 0, 0.2, 0, len, 0.22, 0.55, hull);
  ell(out, f, len * 0.92, 0.42, 0, 0.5, 0.2, 0.28, hull, 0.5);
  ell(out, f, -len * 0.92, 0.36, 0, 0.45, 0.16, 0.26, hull, -0.4);
  ell(out, f, 0, 0.4, 0, len * 0.9, 0.05, 0.5, [0.34, 0.27, 0.18]);
  if (r() < 0.6) ell(out, f, 0.2, 0.85, 0, 0.9, 0.48, 0.58, [0.44, 0.36, 0.22]);
  const pf = sub(f, -len * 0.7, 0, f.k, 0, 0.3);
  pf.move = FL;
  person(out, pf, r, { arms: 'pole', hat: true, poncho: r() < 0.3 ? pick(PONCHO, r) : null });
  lim(out, f, f.P(-len * 0.7 + 0.25, 1.4 + 0.3, 0.1), f.P(-len * 1.5, -0.4, 0.3), 0.03, [0.46, 0.4, 0.26], 4);   // the oar
  if (night) { const p = f.P(len * 0.5, 1.2, 0); out(p[0], p[1], p[2], 0.1, 0.1, 0.1, 1, 0.76, 0.42, 1, 0, 0, 0, 1, KIND.LIGHT, MOVE.BEAT); }   // (the lamp is a light: it keeps the beat)
}
// The ferry: a flat steel deck with rails, a small wheelhouse at one end, mopeds and people
// standing in ponchos for the crossing.
function ferry(out, f, r, night) {
  const deck = [0.3, 0.32, 0.34], len = 7;
  ell(out, f, 0, 0.35, 0, len, 0.35, 2.2, [0.2, 0.22, 0.24]);
  ell(out, f, 0, 0.72, 0, len * 0.97, 0.06, 2.1, deck);
  for (const v of [-2.1, 2.1]) lim(out, f, f.P(-len * 0.95, 1.6, v), f.P(len * 0.95, 1.6, v), 0.04, [0.5, 0.5, 0.48], 4);
  ell(out, f, -len * 0.8, 2.0, 0, 0.9, 1.2, 1.2, [0.76, 0.74, 0.68]);
  ell(out, f, -len * 0.8, 3.25, 0, 1.1, 0.15, 1.4, [0.2, 0.4, 0.6]);
  const m = 2 + Math.floor(r() * 3);
  const fl = (g) => { g.move = FL; return g; };   // (the people aboard flash, as people do)
  for (let k = 0; k < m; k++) moped(out, fl(sub(f, -len * 0.35 + k * 2.3, (k % 2 ? 0.9 : -0.9), f.k, 0, 0.75)), r, { pillion: r() < 0.3 });
  for (let k = 0; k < 3; k++) person(out, fl(sub(f, len * 0.55 + k * 0.8, (r() - 0.5) * 2.6, f.k, Math.PI / 2 * (r() - 0.5), 0.75)), r, { poncho: r() < 0.6 ? pick(PONCHO, r) : null, umbrella: r() < 0.3 ? pick(UMBRELLA, r) : null });
  if (night) { const p = f.P(-len * 0.8, 2.6, 1.22); out(p[0], p[1], p[2], 0.4 * f.k, 0.25 * f.k, 0.05, 1, 0.85, 0.55, 1, 0, 0, 0, 1, KIND.LIGHT, MOVE.BEAT); }   // (the lamp is a light: it keeps the beat)
}

// ---------------------------------------------------------------------------------------------
// Life, placed from world cells where the line can see it.
// ---------------------------------------------------------------------------------------------
// The road: mopeds in ponchos (alone, in twos and threes), now and then a small truck or a bus.
// Each rides in its own ride cell (kit rideCell), keeping right: with the train on the near lane.
function* roadTraffic(ctx, out, W, dLo, dHi, night) {
  for (const { i, wx0 } of cellsAround(ctx, FLY_CELL, 14)) {
    const rc = rideCell(wx0 + FLY_CELL / 2);
    const r = worldRng(ctx, 201, i);
    const u = r();
    if (u > 0.5) continue;
    const x = xAt(W, rc.wx), lane = x.rd - 1.7 * rc.dir, yaw = rc.dir > 0 ? 0 : Math.PI;
    if (lane < dLo || lane >= dHi) continue;
    const y = x.rdY + 0.02;
    if (u < 0.05) {
      const type = r() < 0.4 ? 'bus' : 'truck';
      note(type, rc.wx, lane);
      vehicle(out, frame(rc.wx - ctx.x0, y, lane - rc.dir * 0.3, yaw, 1.3, MOVE.RIDE), r, type, night);
    } else {
      const n = u < 0.32 ? 1 : u < 0.44 ? 2 : 3;
      for (let k = 0; k < n; k++) {
        const ox = (k - (n - 1) / 2) * 3.6 + (r() - 0.5) * 1.2, od = (r() - 0.5) * 1.4;
        note('moped', rc.wx + ox, lane + od);
        moped(out, frame(rc.wx + ox - ctx.x0, y, lane + od, yaw, 1.75 * farK(lane), MOVE.RIDE), r, { pillion: r() < 0.3, load: r() < 0.3 });
      }
    }
    if (out.due()) yield;
  }
}
// Mopeds parked on the frontage of a village street, in front of the shops (rigid: nothing on the beat).
function* parked(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, 9, 4)) {
    const r = worldRng(ctx, 211, i);
    if (r() > 0.4) continue;
    const wx = wx0 + 9 * r(), x = xAt(W, wx), d = x.rd + 3.8, y = x.rdY + 0.02, rd = x.rd;   // (copied: villageYard moves X)
    if (d < dLo || d >= dHi || !villageYard(W, wx, rd + 6)) continue;
    moped(out, frame(wx - ctx.x0, y, d, Math.PI / 2 + (r() - 0.5) * 0.4, 1.75, STL), r, { parked: true });
  }
  if (out.due()) yield;
}
// The distance of the dyke between paddy rows j-1 and j (the inverse of rowOf).
function dykeD(j) { return (Math.exp(0.11 * (j / 0.62)) - 8) / 0.11; }
// May a person stand here, seen from the line: not on the road, in a village yard, in the river.
function openGround(W, wx, d) {
  const x = xAt(W, wx);
  if (Math.abs(d - x.rd) < 6 || Math.abs(d - x.rc) < x.rw / 2 + 4 || d > x.ft - 10) return false;
  if (x.v > 0.3 && d > x.dA - 2 && d < x.dB + 5) return false;
  return !villageYard(W, wx, d);
}
// Life among the paddies and on the road's verges: planters bent double in a line across a flooded
// field, a farmer ploughing behind a buffalo, a buffalo led along a dyke, buffalo wallowing, ducks
// herded across the water by a man with a long pole, egrets, people walking in ponchos or under
// umbrellas, children going home from school under one umbrella, a carrier with a shoulder pole.
const LIFECELL = 55;
function* life(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, LIFECELL, 30)) {
    const r = worldRng(ctx, 221, i);
    const x0 = xAt(W, wx0 + LIFECELL / 2);
    const v = x0.v, u = r();
    let wx = wx0 + LIFECELL * (0.2 + 0.6 * r());
    const x = xCopy(W, wx);
    // on the road's verges (the near verge mostly, so that nothing on the road hides them)
    if (u < 0.3) {
      const near = r() < 0.75, d = near ? x.rd - 4.3 : x.rd + 4.4;
      if (d < dLo || d >= dHi || !inX(ctx, wx, 6)) continue;
      const y = W.H(wx, d), yaw = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.3, lx = wx - ctx.x0;
      const w = r();
      if (w < 0.3) {
        // children from school under one umbrella: white shirts, blue trousers, red scarves
        note('kids', wx, d);
        const n = 2 + Math.floor(r() * 2), um = pick(UMBRELLA, r);
        for (let k = 0; k < n; k++) person(out, frame(lx + (k - (n - 1) / 2) * 0.9, y, d + (r() - 0.5) * 0.5, yaw, PK * 0.68 * farK(d)), r, { pose: 'walk', child: true, shirt: [0.78, 0.78, 0.76], hat: false, umbrella: k === 0 ? um : null, ub: 1.8 });
      } else if (w < 0.55) {
        note('walker', wx, d);
        personAt(out, lx, y, d, yaw, r, { pose: 'walk', umbrella: r() < 0.5 ? pick(UMBRELLA, r) : null, poncho: r() < 0.5 ? pick(PONCHO, r) : null, hat: r() < 0.5 });
        if (r() < 0.5) personAt(out, lx + 1.6, y, d + 0.4, yaw, r, { pose: 'walk', poncho: pick(PONCHO, r), hat: false });
      } else if (w < 0.75) {
        note('lead', wx, d);
        // a buffalo led along the verge on a rope
        const fb = frame(lx, y, d + (near ? -0.3 : 0.3), yaw, BK * farK(d));
        buffalo(out, fb, r, { wet: true, egret: r() < 0.2 });
        const pp = fb.P(2.6, 0, 0.2);
        const fp = frame(pp[0], y, -pp[2], yaw, PK * farK(d));
        person(out, fp, r, { pose: 'walk', arms: 'fwd', poncho: r() < 0.5 ? pick(PONCHO, r) : null, hat: true });
        lim(out, fb, fb.P(1.42, 0.92, 0), fp.P(0.38, 1.2, 0.1), 0.012, [0.3, 0.26, 0.2], 3);
      } else {
        note('carrier', wx, d);
        person(out, frame(lx, y, d, yaw, PK * farK(d)), r, { pose: 'walk', arms: 'pole', hat: true });
        shoulderPole(out, frame(lx, y, d, yaw, PK * farK(d)), r);
      }
      if (out.due()) yield;
      continue;
    }
    // out in the paddies of the plain (or the valley floor where it can be seen)
    if (u > 0.85) continue;
    let d;
    if (v < 0.4) d = x.rd + 10 + Math.pow(r(), 1.3) * Math.min(190, x.rc - x.rw / 2 - x.rd - 20);
    else if (v > 0.6) d = Math.max(x.dB + 10, (2.6 - x.vf) / 0.19 + 10) + r() * 60;
    else continue;
    if (d < dLo || d >= dHi || !inX(ctx, wx, 12) || !openGround(W, wx, d)) continue;
    const p = paddyAt(W, wx, d), pt = p.dyke ? -1 : p.t;
    const lx = wx - ctx.x0, y = W.H(wx, d), kk = farK(d), pk = PK * kk, bk = BK * kk;
    const side = () => (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.5;
    const w = r();
    if ((pt === PT.WATER || pt === PT.YOUNG) && w < 0.42) {
      note('planters', wx, d);
      const n = 3 + Math.floor(r() * 4), face = r() < 0.4 ? -Math.PI / 2 : r() < 0.5 ? 0 : Math.PI;
      for (let k = 0; k < n; k++) {
        const px = lx + (k - (n - 1) / 2) * 2.2 + (r() - 0.5) * 0.6, pd = d + (r() - 0.5) * 1.6;
        const f = frame(px, y - 0.2 * pk, pd, face + (r() - 0.5) * 0.7, pk), up = r() < 0.2;
        person(out, f, r, { pose: up ? 'stand' : 'bent', wade: 0.2, poncho: r() < 0.35 ? pick(PONCHO, r) : null });
        ripple(out, px, y, pd, 0.9 * pk, 0.45);
        for (let j = 1; j <= 4; j++) for (const vv of [-0.35, 0.35]) { const q = f.P(0.75 + j * 0.42, 0, vv); out(q[0], y + 0.16, q[2], 0.07 * pk, 0.15, 0.07 * pk, 0.34, 0.56, 0.18, 1, 0, 0, 0, 1, KIND.GROUND); }
      }
      // the bundles of seedlings waiting on the dyke
      for (let k = 0; k < 4; k++) out(lx + (r() - 0.5) * 8, y + 0.2, -(d + 3 + r() * 2), 0.35, 0.25, 0.35, 0.3, 0.52, 0.16, 1, 0, 0, 0, 1, KIND.TREE);
    } else if ((pt === PT.WATER || pt === PT.MUD) && w < 0.62) {
      note('plough', wx, d);
      const wade = 0.22, yaw = side();
      const fb = frame(lx, y - wade * bk, d, yaw, bk);
      buffalo(out, fb, r, { wade, wet: true });
      lim(out, fb, fb.P(0.62, 1.4, -0.3), fb.P(0.62, 1.4, 0.3), 0.04, WOOD, 1);
      for (const vv of [-0.3, 0.3]) lim(out, fb, fb.P(0.62, 1.36, vv), fb.P(-1.5, 0.55 + wade, 0), 0.014, [0.3, 0.27, 0.2], 3);
      lim(out, fb, fb.P(-1.5, 0.55 + wade, 0), fb.P(-2.1, wade + 0.06, 0), 0.05, WOOD, 2);
      lim(out, fb, fb.P(-2.1, wade + 0.06, 0), fb.P(-2.45, 1.02 + wade, 0), 0.035, WOOD, 2);
      const pp = fb.P(-2.85, 0, 0);
      person(out, frame(pp[0], y - wade * pk, -pp[2], yaw, pk), r, { pose: 'walk', arms: 'fwd', wade, poncho: r() < 0.5 ? pick(PONCHO, r) : null });
      for (let j = 0; j < 4; j++) { const q = fb.P(-3.9 - j * 1.5, 0, 0); out(q[0], y + 0.05, q[2], 1.3 * bk, 0.03, 0.5 * bk, 0.42, 0.38, 0.3, 0.85, 0, 0, 0, 1, KIND.GROUND); }
      const ne = Math.floor(r() * 3.5);
      for (let j = 0; j < ne; j++) { const q = fb.P(-4.2 - 1.6 * j - r(), 0, (r() - 0.5) * 2.2); egret(out, frame(q[0], y - 0.1, -q[2], side(), 2 * kk)); }
    } else if ((pt === PT.WATER || pt === PT.POND) && w < 0.8) {
      note('ducks', wx, d);
      // a flock of ducks spread across the water, the herder on the dyke with his long pole
      const n = 14 + Math.floor(r() * 22), dir = side();
      for (let k = 0; k < n; k++) {
        const a = r() * Math.PI * 2, rr = 5 * Math.sqrt(r());
        const c = r() < 0.55 ? [0.78, 0.77, 0.72] : r() < 0.6 ? [0.46, 0.36, 0.24] : [0.3, 0.26, 0.2];
        duck(out, frame(lx + Math.cos(a) * rr * 1.6, y, d + Math.sin(a) * rr * 0.6, dir + (r() - 0.5) * 0.8, 2.9 * kk), c);
      }
      const hd = Math.max(dLo, d - 7);
      const fp = frame(lx - 4, W.H(wx - 4, hd), hd, dir, pk);
      person(out, fp, r, { arms: 'pole', hat: true, poncho: r() < 0.4 ? pick(PONCHO, r) : null });
      lim(out, fp, fp.P(0.3, 1.4, 0.1), fp.P(3.2, 2.6, 0.3), 0.025, [0.5, 0.44, 0.26], 4);
      out(fp.P(3.2, 2.6, 0.3)[0], fp.P(3.2, 2.6, 0.3)[1], fp.P(3.2, 2.6, 0.3)[2], 0.3, 0.2, 0.03, 0.78, 0.2, 0.12, 1, 0, 0, 0, 1, KO, MOVE.FLAG);
    } else if (w < 0.9) {
      note('buffalo', wx, d);
      const n = 1 + Math.floor(r() * 3), wet = pt === PT.POND || pt === PT.WATER;
      for (let k = 0; k < n; k++) buffalo(out, frame(lx + (k - (n - 1) / 2) * 4.5, y - (wet ? 0.3 : 0), d + (r() - 0.5) * 3, side(), bk), r, { pose: wet ? 'wallow' : r() < 0.6 ? 'graze' : 'stand', wet: true, egret: r() < 0.3 });
    } else {
      note('egrets', wx, d);
      const n = 3 + Math.floor(r() * 6);
      for (let k = 0; k < n; k++) egret(out, frame(lx + (r() - 0.5) * 14, y - 0.1, d + (r() - 0.5) * 6, side(), 2.2 * kk));
    }
    if (out.due()) yield;
  }
}
// On the river: sampans rowed or fishing, the ferry crossing where a lane comes down to it, rafts
// of water hyacinth riding the brown flood.
const BOATCELL = 150, FERRYCELL = 1400;
function* riverLife(ctx, out, W, dLo, dHi, night) {
  for (const { i, wx0 } of cellsAround(ctx, BOATCELL, 20)) {
    const r = worldRng(ctx, 231, i);
    const wx = wx0 + BOATCELL * r(), x = xAt(W, wx);
    // hyacinth
    const nh = 3 + Math.floor(r() * 6);
    for (let k = 0; k < nh; k++) {
      const hx = wx + (r() - 0.5) * 120, hd = x.rc + (r() - 0.5) * x.rw * 0.85;
      if (hd < dLo || hd >= dHi || !inX(ctx, hx)) continue;
      const s = 0.8 + 2 * r();
      out(hx - ctx.x0, x.wl + 0.15, -hd, s * 1.4, 0.25, s * 0.7, 0.2, 0.4, 0.12, 1, 0, 0, 0, 1, KIND.GROUND);
      if (r() < 0.3) out(hx - ctx.x0, x.wl + 0.35, -hd, 0.25, 0.15, 0.25, 0.5, 0.4, 0.66, 1, 0, 0, 0, 1, KIND.GROUND);
    }
    if (r() > 0.55) continue;
    const d = x.rc + (r() - 0.5) * x.rw * 0.6;
    if (d < dLo || d >= dHi || !inX(ctx, wx, 10)) continue;
    note('sampan', wx, d);
    const f = frame(wx - ctx.x0, x.wl, d, (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.4, PK * farK(d) * 1.4, STL);
    ripple(out, wx - ctx.x0, x.wl, d, 6 * f.k, 0.8 * f.k);
    sampan(out, f, r, night);
    if (out.due()) yield;
  }
  for (const { i, wx0 } of cellsAround(ctx, FERRYCELL, 40)) {
    const r = worldRng(ctx, 241, i);
    if (r() > 0.7) continue;
    const wx = wx0 + FERRYCELL * (0.3 + 0.4 * r()), x = xAt(W, wx), d = x.rc - x.rw * 0.12;
    if (d < dLo || d >= dHi || !inX(ctx, wx, 25)) continue;
    note('ferry', wx, d);
    const f = frame(wx - ctx.x0, x.wl, d, r() < 0.5 ? 0 : Math.PI, 2.25 * farK(d), STL);
    ripple(out, wx - ctx.x0, x.wl, d, 14 * f.k, 2.5 * f.k);
    ferry(out, f, r, night);
    // the landing on the near bank: a ramp of concrete down to the water
    const bd = x.rc - x.rw / 2;
    for (let k = 0; k < 6; k++) { const dd = bd - 3 + k * 1.5; if (dd >= dLo && dd < dHi) out(wx - ctx.x0, W.H(wx, dd) + 0.1, -dd, 3, 0.15, 0.9, 0.5, 0.49, 0.46, 1, 0, 0, 0, 1, KIND.GROUND); }
    if (out.due()) yield;
  }
}
// Life on the terraces of the valley's far side: a few figures bent at the planting on a tread,
// and buffalo on the bunds (drawn large: they stand 250 m and more out).
const TLCELL = 120;
function* terraceLife(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, TLCELL, 20)) {
    const r = worldRng(ctx, 251, i);
    const wx = wx0 + TLCELL * r(), x = xAt(W, wx);
    if (x.v < 0.5 || r() > 0.5) continue;
    let d = x.ft + 20 + r() * 220;
    if (d < dLo || d >= dHi || !inX(ctx, wx, 8)) continue;
    heightAt(W, wx, d);
    if (TA.m < 0.5 || TA.f > 1 - RW - 0.05) continue;
    const y = W.H(wx, d), k = PK * 2.6, lx = wx - ctx.x0;
    note('terrace-folk', wx, d);
    if (r() < 0.6) {
      const n = 2 + Math.floor(r() * 3);
      for (let j = 0; j < n; j++) person(out, frame(lx + (j - (n - 1) / 2) * 3, y - 0.3, d + (r() - 0.5) * 2, -Math.PI / 2 + (r() - 0.5), k), r, { pose: r() < 0.7 ? 'bent' : 'stand', wade: 0.15, shirt: pick([[0.2, 0.22, 0.5], [0.12, 0.12, 0.14], [0.6, 0.2, 0.3]], r) });
    } else buffalo(out, frame(lx, y, d, (r() < 0.5 ? 0 : Math.PI), BK * 2.4), r, { pose: 'graze', wet: true });
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// By the line: concrete telegraph posts with their wires, kilometre stones, puddles in the cess.
// ---------------------------------------------------------------------------------------------
const TGCELL = 52;
function* lineside(ctx, out, W) {
  const d = 8.2, c = [0.5, 0.5, 0.47];
  const tops = [];
  for (const { i } of cellsAround(ctx, TGCELL, TGCELL)) {
    const r = makeRng(hashInts(W.ws, 301, i));
    const wx = i * TGCELL + 3 * r(), x = wx - ctx.x0, y0 = W.H(wx, d) - 0.2, h = 6.4 + 0.4 * r();
    const lean = (r() - 0.5) * 0.06;
    const top = [x + lean * h, y0 + h, -d];
    tops.push(top);
    if (x < -2 || x > ctx.length + 2) continue;
    bar(out, x, y0, -d, top[0], top[1], top[2], 0.11, c, 4, KIND.MAST);
    for (const k of [0, 1]) bar(out, top[0], top[1] - 0.4 - k * 0.7, -d - 0.7, top[0], top[1] - 0.4 - k * 0.7, -d + 0.7, 0.05, [0.3, 0.28, 0.26], 2, KIND.MAST);
    if (r() < 0.25) { out(x, 0.35, -5.6, 0.14, 0.35, 0.1, 0.76, 0.76, 0.72, 1, 0, 0, 0, 1, KIND.FENCE); out(x, 0.72, -5.6, 0.14, 0.04, 0.1, 0.7, 0.12, 0.1, 1, 0, 0, 0, 1, KIND.FENCE); }
  }
  for (let k = 1; k < tops.length; k++) {
    const A = tops[k - 1], Bp = tops[k];
    for (const [dy, dx] of [[-0.4, -0.55], [-0.4, 0.55]]) {
      let px = A[0], py = A[1] + dy, pz = A[2] + dx;
      for (let s = 1; s <= 8; s++) {
        const t = s / 8, qx = A[0] + (Bp[0] - A[0]) * t, qy = A[1] + dy + (Bp[1] - A[1]) * t - 0.7 * 4 * t * (1 - t);
        bar(out, px, py, pz, qx, qy, pz, 0.012, [0.12, 0.12, 0.12], 1, KIND.WIRE);
        px = qx; py = qy;
      }
    }
  }
  if (out.due()) yield;
}
// Puddles in the cess and on the bank's foot: pale sky in the dark ballast and grass.
function* puddles(ctx, out, W, n) {
  const r = ctx.rng;
  for (let i = 0; i < n; i++) {
    const x = r() * ctx.length, d = 4.4 + r() * 5, wx = ctx.x0 + x;
    if (noise2(wx / 6, d / 2, W.ws + 311) < 0.62) continue;
    const s = 0.4 + 1.2 * r();
    out(x, W.H(wx, d) + 0.04, -d, s * 1.6, 0.03, s * 0.6, 0.56, 0.6, 0.62, 1, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
}
// White threads of water running off the hills after the rain: down the slope from high up,
// crossing the terraces in little falls, to the foot.
const STREAMCELL = 420;
function* streams(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, STREAMCELL, 120)) {
    const r = makeRng(hashInts(W.ws, 321, i));
    if (r() > 0.75) continue;
    let wx = (i + r()) * STREAMCELL;
    const x0 = xAt(W, wx), ft = x0.ft;
    let d = ft + 160 + r() * 500;
    const dEnd = ft + 5;
    if (d < dLo - 60 || dEnd > dHi) continue;
    note('stream', wx, d);
    const wig = r() * 100;
    while (d > dEnd) {
      const step = Math.max(2, d * 0.008);
      const nd = d - step, nwx = wx + (noise1(nd / 40 + wig, W.ws + 322) - 0.5) * step * 1.6;
      if (nd >= dLo && nd < dHi && inX(ctx, nwx, 2)) {
        const y0 = W.H(wx, d) + 0.3, y1 = W.H(nwx, nd) + 0.3, w = Math.max(0.5, 0.0014 * d);
        bar(out, wx - ctx.x0, y0, -d, nwx - ctx.x0, y1, -nd, w, C.stream, 1, KIND.GROUND);
        if (y0 - y1 > 2) out((wx + nwx) / 2 - ctx.x0, (y0 + y1) / 2, -(d + nd) / 2, w * 2.5, (y0 - y1) * 0.3, w * 2, C.mist[0], C.mist[1], C.mist[2], 0.35, 0, 0, 0, 1, KO, MOVE.VAPOUR);
      }
      wx = nwx; d = nd;
      if (out.due()) yield;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Level 1 (all 0 at level 0, so level 0 shows none of this)
//   scale     giant lotus standing in the paddies and the ponds, pink cups the height of houses
//   topology  terraces stepping on up off the tops of the hills into the cloud, like a stair
//   logic     paper lanterns drifting in the mist over the fields, lit
//   matter    lotus petals falling with the rain
// (Rain falling upward was asked for, but the shader's fall only runs downward, so it is not drawn.)
// ---------------------------------------------------------------------------------------------
const LOTUSCELL = 260;
function* giantLotus(ctx, out, W, dLo, dHi, amount) {
  for (const { i } of cellsAround(ctx, LOTUSCELL, 40)) {
    const r = makeRng(hashInts(W.ws, 401, i));
    if (r() > 0.55 * amount) continue;
    const wx = (i + r()) * LOTUSCELL, x = xAt(W, wx);
    const d = x.v < 0.5 ? x.rd + 25 + r() * 180 : x.ft + 20 + r() * 200;
    if (d < dLo || d >= dHi || !inX(ctx, wx, 20)) continue;
    note('lotus', wx, d);
    const y0 = W.H(wx, d), H = (16 + 16 * r()) * (0.6 + 0.5 * amount), lx = wx - ctx.x0;
    const K = KIND.SURREAL, stem = [0.24, 0.42, 0.14];
    const sw = (r() - 0.5) * 0.15;
    bar(out, lx, y0, -d, lx + sw * H, y0 + H, -d, Math.max(0.25, H * 0.02), stem, 6, K);
    // a great pad, tilted a little, on its own stem
    const pr = H * 0.55, px = lx - H * 0.3, py = y0 + H * 0.3;
    bar(out, lx, y0, -d, px, py, -(d - 1), Math.max(0.2, H * 0.015), stem, 3, K);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2, c = shade([0.22, 0.44, 0.16], 0, 1, 0.2, 0.7, 0.3);
      out(px + Math.cos(a) * pr * 0.55, py + Math.sin(a) * pr * 0.04, -(d + Math.sin(a) * pr * 0.55), pr * 0.4, pr * 0.05, pr * 0.4, c[0], c[1], c[2], 1, 0, 0, 0, 1, K);
    }
    // the flower: petals cupped outward round a yellow seed head
    const fx = lx + sw * H, fy = y0 + H, pl = H * 0.26, np = 14;
    for (let k = 0; k < np; k++) {
      const a = (k / np) * Math.PI * 2 + r() * 0.2, outer = k % 2 ? 0.75 : 1;
      const ox = Math.cos(a), oz = Math.sin(a), tilt = outer > 0.9 ? 0.75 : 0.45;
      const cx = fx + ox * pl * 0.55 * outer, cy = fy + pl * 0.55, cz = -(d + oz * pl * 0.55 * outer);
      const q = quatBasis(ox * Math.sin(tilt), Math.cos(tilt), -oz * Math.sin(tilt), -oz, 0, -ox);
      const c = mix3([0.8, 0.42, 0.58], [0.8, 0.74, 0.76], 0.3 + 0.3 * (1 - outer));
      out(cx, cy, cz, pl * 0.32, pl * 0.62, Math.max(0.05, pl * 0.06), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], K);
    }
    out(fx, fy + pl * 0.45, -d, pl * 0.3, pl * 0.18, pl * 0.3, 0.8, 0.7, 0.2, 1, 0, 0, 0, 1, K);
    if (out.due()) yield;
  }
}
// Stairs: tread on tread rising off a hilltop and on into the cloud, each a level slab of water or
// young rice with a dark riser below it, set back a little each time.
const STAIRCELL = 2200;
function* stairTerraces(ctx, out, W, dLo, dHi, amount) {
  for (const { i } of cellsAround(ctx, STAIRCELL, 300)) {
    const r = makeRng(hashInts(W.ws, 411, i));
    if (r() > 0.8 * amount + 0.2) continue;
    const wx = (i + 0.3 + 0.4 * r()) * STAIRCELL, x = xCopy(W, wx);
    let d = x.ft + 250 + r() * 500;
    let y = W.H(wx, d);
    const top = cloudBase(W, wx) + 120, n = Math.max(6, Math.ceil((top - y) / 9));
    const w0 = 50 + 40 * r(), s = Math.max(1.2, detail(out, d, 1.2));
    note('stair', wx, d);
    for (let k = 0; k < n; k++) {
      const S = 7 + 2 * r(), dep = 14 + 6 * r(), w = w0 * (1 - 0.5 * k / n);
      y += S; d += dep * 0.6;
      if (d < dLo || d >= dHi) continue;
      const lx = wx - ctx.x0 + Math.sin(k * 0.7) * 12, water = k % 3 !== 1;
      yield* panel(out, [lx - w / 2, y - S, -d], [1, 0, 0], [0, 1, 0], w, S, s, (a, b) => jitter(b > 0.8 ? C.young : mix3(C.riser, C.rice, 0.5 * b), r, 0.1), KIND.SURREAL, r);
      yield* panel(out, [lx - w / 2, y, -(d + dep)], [1, 0, 0], [0, 0, 1], w, dep, s, () => (water ? jitter(C.water, r, 0.04) : jitter(C.young, r, 0.08)), KIND.SURREAL, r);
      out(lx, y + 0.3, -d, w / 2, 0.4, 0.4, C.lip[0], C.lip[1], C.lip[2], 1, 0, 0, 0, 1, KIND.SURREAL);
      // the cloud gathering round the higher steps
      if (y > cloudBase(W, wx) - 40 && k % 2 === 0) mistPuffs(out, lx + (r() - 0.5) * w, y + 4, d + dep * 0.5, w * 0.6, 10, C.cloud, 0.45, r);
    }
  }
}
// Paper lanterns drifting in the mist: a glowing core in a red or yellow paper body.
function* lanterns(ctx, out, W, dLo, dHi, amount, cell) {
  const g0 = Math.floor(ctx.x0 / cell) - 1, g1 = Math.floor((ctx.x0 + ctx.length) / cell) + 1;
  for (let gx = g0; gx <= g1; gx++) {
    const r = makeRng(hashInts(W.ws, 421, gx, cell));
    const n = Math.round((1 + r() * 3) * amount * 2);
    for (let k = 0; k < n; k++) {
      const wx = (gx + r()) * cell, d = dLo + (dHi - dLo) * Math.pow(r(), 0.8);
      if (!inX(ctx, wx)) { r(); r(); continue; }
      const y = W.H(wx, d) + 10 + r() * (25 + d * 0.12), s = Math.max(0.7, 0.0065 * d), red = r() < 0.6;
      out(wx - ctx.x0, y, -d, s, s * 1.3, s, red ? 0.78 : 0.8, red ? 0.16 : 0.62, red ? 0.1 : 0.16, 1, 0, 0, 0, 1, KIND.SURREAL, MOVE.VAPOUR);
      out(wx - ctx.x0, y, -(d - s * 0.5), s * 0.6, s * 0.8, s * 0.6, 1, red ? 0.62 : 0.86, red ? 0.36 : 0.5, 1, 0, 0, 0, 1, KIND.LIGHT, MOVE.VAPOUR);
      out(wx - ctx.x0, y, -(d - s), s * 2.6, s * 2.6, s, 1, red ? 0.5 : 0.8, red ? 0.3 : 0.45, 0.16, 0, 0, 0, 1, KIND.LIGHT, MOVE.VAPOUR);   // its glow in the mist
      out(wx - ctx.x0, y - s * 1.4, -d, s * 0.25, s * 0.35, s * 0.25, 0.6, 0.5, 0.3, 1, 0, 0, 0, 1, KIND.SURREAL, MOVE.VAPOUR);
    }
    if (out.due()) yield;
  }
}
// Lotus petals falling with the rain: round pink flakes (a round FALL splat drifts like snow).
function* petals(ctx, out, W, dLo, dHi, n) {
  const r = ctx.rng;
  for (let i = 0; i < n; i++) {
    const x = r() * ctx.length, d = dLo + (dHi - dLo) * Math.pow(r(), 1.4), s = Math.max(0.07, 0.0026 * d);
    out(x, -3.4 + 16 * r(), -d, s, s, s * 0.4, 0.8, 0.5 + 0.15 * r(), 0.62, 0.9, 0, 0, 0, 1, KIND.SURREAL, MOVE.FALL);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// The weather
// ---------------------------------------------------------------------------------------------
// Rain: thin pale streaks falling through a 16 m slab of air (kit MOVE.FALL), each at its own
// distance, `per` of the band's count at full strength. The amount follows rain(wx): sheets of
// heavier rain come and go along the line, but it never stops.
const NORAIN = typeof process !== 'undefined' && process.env && process.env.MONSOON_NORAIN;   // (for looking at the land in previews)
function* rain(ctx, out, W, dLo, dHi, per, pw = 1.6) {
  const rng = ctx.rng, L = ctx.length;
  const n = NORAIN ? 0 : Math.round(per * ctx.count);
  for (let i = 0; i < n; i++) {
    const x = rng() * L, wx = ctx.x0 + x;
    const amt = xAt(W, wx).rain;
    const u = rng(), d = dLo + (dHi - dLo) * Math.pow(rng(), pw);
    if (u > amt) continue;
    // short, fine drops (finer still beyond 25 m): long streaks, smeared by the train's speed, hid the land
    const w = Math.max(0.01, 0.0009 * d - 0.0004 * Math.max(0, d - 25)), h = Math.max(w * 3.2, 0.14 + 0.006 * d);
    const k = 0.92 + 0.16 * rng();
    out(x, -3.4 + 16 * rng(), -d, w, h, w, C.rain[0] * k, C.rain[1] * k, C.rain[2] * k, (0.34 + 0.18 * amt) * (1 - 0.78 * smooth(18, 100, d)), 0, 0, 0, 1, KO, MOVE.FALL);
    if (out.due()) yield;
  }
}
// Rings and splashes on the nearest water: pale flat dots where the drops strike.
function* rainRings(ctx, out, W, dLo, dHi, n) {
  const rng = ctx.rng, L = ctx.length;
  for (let i = 0; i < n; i++) {
    const x = rng() * L, wx = ctx.x0 + x, d = dLo + (dHi - dLo) * Math.pow(rng(), 1.5);
    const y = W.H(wx, d);
    const p = paint(W, wx, d, y, 0, 1, 0, rng);
    if (p.wet < 0.5) continue;
    const r = 0.1 + 0.0035 * d;
    out(x, y + 0.05, -d, r, r * 0.12, r * 0.6, 0.76, 0.78, 0.8, 0.55, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
}
// Mist as a few rounded puffs (no wider than about six times their height) rather than one long
// smear: the shader billows a vapour splat by an amount in proportion to its size (after karst.js).
function mistPuffs(out, x, y, d, sx, sy, c, op, r) {
  const k = Math.max(1, Math.ceil(sx / (6 * sy)));
  const px = (sx / k) * 1.4;
  for (let i = 0; i < k; i++) {
    const f = k === 1 ? 0 : ((i + 0.5) / k) * 2 - 1;
    out(x + f * sx * 0.8, y + sy * 0.3 * (r() - 0.5), -(d + (r() - 0.5) * px * 0.5), px, sy * (0.85 + 0.3 * r()), px * 0.5, c[0], c[1], c[2], op * 0.85, 0, 0, 0, 1, KO, MOVE.VAPOUR);
  }
}

// The cloud's underside: the level above which the hills are lost (it rises and falls along the line).
function cloudBase(W, wx) { const x = xAt(W, wx); return x.fl + 165 + 140 * noise1(wx / 2300, W.ws + 91); }
// Cloud lying on the hills: wherever the land rises into the cloud's underside, puffs hug it, so
// the hilltops are lost; and below the base, here and there, a streamer caught on a slope. Cells
// grow with distance (log-spaced rows) so a far chunk needs no more puffs than a near one.
function* cloudCap(ctx, out, W, dLo, dHi, cell0, frac, op0 = 0.75) {
  const cap = out.n + frac * ctx.count, L = ctx.length, K = 1 + cell0 / Math.max(dLo, 1);
  for (let gk = 0, d0 = dLo; d0 < dHi; gk++) {
    const cell = cell0 * (d0 / dLo), d1 = d0 * K;
    const g0 = Math.floor((ctx.x0 - cell) / cell), g1 = Math.floor((ctx.x0 + L + cell) / cell);
    for (let gx = g0; gx <= g1; gx++) {
      const r = worldRng(ctx, 811, gx, Math.round(d0), Math.round(cell));
      const wx = (gx + r()) * cell, d = d0 + r() * (d1 - d0);
      if (!inX(ctx, wx, cell)) continue;
      const h = W.H(wx, d), cb = cloudBase(W, wx);
      const sx = cell * (0.7 + 0.6 * r()), sy = sx * (0.28 + 0.14 * r());
      let y, op;
      if (h > cb - sy * 0.2) {
        y = Math.max(cb + sy * 0.4, h - sy * 0.1) + sy * 0.4 * r();
        op = op0 * (0.55 + 0.45 * smooth(cb, cb + 150, h));
      } else if (h > cb - 100 && r() < 0.12) {
        // a streamer caught on the slope below the base
        y = h + sy * (0.5 + r());
        op = op0 * 0.35;
      } else continue;
      const c = mul3(C.cloud, 0.95 + 0.08 * r());
      mistPuffs(out, wx - ctx.x0, y, d, sx, sy, c, op, r);
      if (out.n >= cap) return;
      if (out.due()) yield;
    }
    d0 = d1;
  }
}
// Low mist drifting over the valley floor, the river and the paddies, and in bands across the
// terraces: thin, wide, close to the ground, in patches that come and go along the line.
function* lowMist(ctx, out, W, dLo, dHi, cell, frac, op0 = 0.4) {
  const cap = out.n + frac * ctx.count, L = ctx.length;
  const g0 = Math.floor((ctx.x0 - cell * 2) / cell), g1 = Math.floor((ctx.x0 + L + cell * 2) / cell);
  for (let gk = Math.floor(dLo / cell); gk * cell < dHi; gk++) {
    for (let gx = g0; gx <= g1; gx++) {
      const r = worldRng(ctx, 821, gx, gk, cell);
      const wx = (gx + r()) * cell, d = (gk + r()) * cell;
      if (d < dLo || d >= dHi) continue;
      const x = xAt(W, wx);
      const onRiver = Math.abs(d - x.rc) < x.rw;
      const amt = (smooth(0.5, 0.75, noise1(wx / 700, W.ws + 92)) * 0.4 + 0.12 * x.v) * (d > 150 && !onRiver ? x.v : 1) + (onRiver ? 0.22 : 0);
      if (r() > amt) continue;
      const h = W.H(wx, d);
      const sx = cell * (0.7 + 0.8 * r()), sy = Math.max(1.5, sx * (0.07 + 0.06 * r()));
      const c = mul3(C.mist, 0.96 + 0.06 * r());
      mistPuffs(out, wx - ctx.x0, h + sy * (0.6 + 1.6 * r()), d, sx, sy, c, op0 * (0.5 + 0.5 * r()), r);
      if (out.n >= cap) return;
      if (out.due()) yield;
    }
  }
}
// Veils of rain hanging from the cloud far off: a cluster of tall faint streaks from the cloud's
// underside to the ground, greying what is behind (left still: they are far enough not to move).
function* rainVeils(ctx, out, W, dLo, dHi, frac) {
  const cap = out.n + frac * ctx.count, L = ctx.length, cell = 700;
  for (let gx = Math.floor((ctx.x0 - 400) / cell); gx * cell < ctx.x0 + L + 400; gx++) {
    const r = worldRng(ctx, 831, gx);
    if (r() > 0.6) continue;
    const wx = (gx + r()) * cell, d = 500 + 1800 * r();
    if (d < dLo || d >= dHi) continue;
    const top = cloudBase(W, wx) + 30, wide = 90 + 160 * r(), n = 26 + Math.floor(r() * 20);
    for (let i = 0; i < n; i++) {
      const xx = wx + (r() - 0.5) * wide, dd = d + (r() - 0.5) * 120;
      const g = W.H(xx, dd), hgt = Math.max(20, top - g);
      const sx = 4 + 6 * r();
      out(xx - ctx.x0, g + hgt * 0.5, -dd, sx, hgt * 0.5, sx, C.rain[0] * 0.92, C.rain[1] * 0.92, C.rain[2] * 0.92, 0.1 + 0.08 * r(), 0, 0, 0, 1, KO);
      if (out.n >= cap) return;
    }
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------------------------
const SPLIT_TN = 28.6, SPLIT_NM = 290;
function* trackside(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 1, detailK: 1.2 });
  // the rain first, so that no budget ever squeezes it out
  yield* rain(ctx, out, W, 6.5, ctx.zFar + 1, 0.08, 1.2);
  const night = lightsOn(ctx), dz = ctx.dials || {};
  if ((dz.matter || 0) > 0) yield* petals(ctx, out, W, 6.5, ctx.zFar, Math.round(ctx.count * 0.012 * dz.matter));
  out.limit = out.n + ctx.count * 0.4;
  yield* lineside(ctx, out, W);
  const st = stationNear(W, ctx.x0 + ctx.length / 2);
  if (st) { note('station', st.wx, 10); yield* stationDraw(ctx, out, W, st, night); }
  yield* villages(ctx, out, W, ctx.zNear, SPLIT_TN, night);
  yield* roadPlants(ctx, out, W, 8, SPLIT_TN);
  yield* puddles(ctx, out, W, Math.round(ctx.count * 0.01));
  out.limit = Infinity;
  const rest = out.left();
  yield* fillStrip(ctx, out, W, Math.round(rest * 0.06), 2.5, 4.5, (wx, d, rng) => jitter(d < 2.7 ? C.sleeper : C.ballast, rng, 0.25), 0, 0.12);
  yield* fillPlain(ctx, out, W, { n: Math.round(rest * 0.22), dNear: 4.4, dFar: 13, power: 1.0, cover: 4.4 });
  yield* fillPlain(ctx, out, W, { dNear: 13, power: 0.6, cover: 3.6 });
}

function* near(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.1 });
  yield* rain(ctx, out, W, SPLIT_TN, 115, 0.028, 1.9);
  yield* rainRings(ctx, out, W, SPLIT_TN, 90, Math.round(ctx.count * 0.015));
  const night = lightsOn(ctx), lo = SPLIT_TN, hi = SPLIT_NM, dz = ctx.dials || {};
  // level 1 first, so the band's prop budget never squeezes it out
  if ((dz.scale || 0) > 0) yield* giantLotus(ctx, out, W, lo, hi, dz.scale);
  if ((dz.logic || 0) > 0) yield* lanterns(ctx, out, W, 60, hi, dz.logic, 80);
  if ((dz.matter || 0) > 0) yield* petals(ctx, out, W, lo, 120, Math.round(ctx.count * 0.006 * dz.matter));
  // the living things first (a few splats each, at any budget), then what is built, then plants
  out.limit = out.n + ctx.count * (0.5 + 0.1 * clamp(1 - out.density, 0, 1));
  yield* roadTraffic(ctx, out, W, lo, hi, night);
  yield* life(ctx, out, W, lo, hi);
  yield* riverLife(ctx, out, W, lo, hi, night);
  yield* terraceLife(ctx, out, W, lo, hi);
  yield* parked(ctx, out, W, lo, hi);
  yield* villages(ctx, out, W, lo, hi, night);
  yield* hamlets(ctx, out, W, lo, hi, night);
  yield* stiltsDraw(ctx, out, W, lo, hi, night);
  yield* tombsDraw(ctx, out, W, lo, hi);
  yield* kilns(ctx, out, W, lo, hi);
  yield* lotusPonds(ctx, out, W, lo, 200);
  yield* polesDraw(ctx, out, W, lo, hi, night);
  yield* roadPlants(ctx, out, W, lo, hi);
  yield* streams(ctx, out, W, lo, hi);
  note('near props %', ctx.x0, 100 * out.n / ctx.count);
  out.limit = Infinity;
  yield* lowMist(ctx, out, W, 70, ctx.zFar, 30, 0.03, 0.26);
  yield* terraceLines(ctx, out, W, ctx.zNear, ctx.zFar, 3);
  yield* fillView(ctx, out, W, { cover: 3.4, strips: 4, maxR: 0.03 });
}

// What the nearer ground hides along a column: the highest elevation tangent it reaches.
function occlBefore(W, list) {
  return (wx) => { let a = -9; for (const dd of list) a = Math.max(a, (W.H(wx, dd) - CAMY) / dd); return a - 0.02; };
}
function* mid(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.6 });
  const night = lightsOn(ctx), lo = SPLIT_NM, hi = ctx.zFar, dz = ctx.dials || {};
  out.limit = ctx.count * 0.3;
  if ((dz.scale || 0) > 0) yield* giantLotus(ctx, out, W, lo, hi, dz.scale);
  if ((dz.topology || 0) > 0) yield* stairTerraces(ctx, out, W, lo, hi, dz.topology);
  if ((dz.logic || 0) > 0) yield* lanterns(ctx, out, W, lo, 1500, dz.logic, 400);
  yield* streams(ctx, out, W, lo, hi);
  yield* terraceLife(ctx, out, W, lo, hi);
  yield* riverLife(ctx, out, W, lo, hi, night);
  yield* hamlets(ctx, out, W, lo, hi, night);
  yield* stiltsDraw(ctx, out, W, lo, hi, night);
  yield* kilns(ctx, out, W, lo, hi);
  note('mid props %', ctx.x0, 100 * out.n / ctx.count);
  out.limit = Infinity;
  yield* cloudCap(ctx, out, W, ctx.zNear, ctx.zFar, 110, 0.12, 0.8);
  yield* lowMist(ctx, out, W, ctx.zNear, 1400, 90, 0.03, 0.3);
  yield* rainVeils(ctx, out, W, ctx.zNear, ctx.zFar, 0.04);
  yield* terraceLines(ctx, out, W, ctx.zNear, ctx.zFar, 8 / Math.sqrt(Math.max(0.25, Math.min(1, out.density))));
  yield* fillView(ctx, out, W, { cover: 3.3, strips: 10, far: true });
}

function* far(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 600 });
  yield* cloudCap(ctx, out, W, ctx.zNear, ctx.zFar, 500, 0.2, 0.85);
  yield* fillView(ctx, out, W, { cover: 2.3, strips: 30, far: true, far2: true, minR: 0.001, maxR: 0.02, floor: 0.08, occl: occlBefore(W, [900, 1300, 1800, 2300, 2900]) });
}

export const monsoonBiome = {
  name: 'monsoon',
  palette: PAL,
  terrain: TERRAIN,
  // short: the far hills grey out within a kilometre or two, the mountains are shapes in the cloud
  hazeDist: 1700,
  gold: 0.25,   // dusk under cloud: a little warmth, no golden hour
  horizon: 0.08,
  shares: { trackside: 0.17, near: 0.46, mid: 0.28, far: 0.09 },
  // day and dusk under cloud; never night (the rain needs light to be seen)
  slots: { dawn: 0.12, day: 0.5, dusk: 0.38, night: 0 },
  // Buildings, trees and lights answer the beat; people and animals flash (MOVE.FLASH); boats and
  // vehicles tag their own splats MOVE.STILL. The land, the forest mass and the water stay still.
  beatKinds: [KIND.BUILDING, KIND.TREE, KIND.LIGHT],
  sky: { overcast: 1 },
  generators: { trackside, near, mid, far },
};

// ---------------------------------------------------------------------------------------------
// For scripts that inspect the layout, e.g.
//   const { _debug } = await import('./src/window/biomes/monsoon.js');
//   _debug.layout('7', 0, 20000)
// ---------------------------------------------------------------------------------------------
function at(seedStr) {
  const terrain = makeTerrain(hashString(String(seedStr)), TERRAIN);
  return world({ terrain });
}
function layout(seedStr, x0, x1, step = 250) {
  const W = at(seedStr), res = [];
  for (let wx = x0; wx <= x1; wx += step) { const x = xCopy(W, wx); res.push({ wx, v: +x.v.toFixed(2), rc: Math.round(x.rc), rw: Math.round(x.rw), ft: Math.round(x.ft), vf: Math.round(x.vf), rain: +x.rain.toFixed(2) }); }
  return res;
}
export const _debug = { world, at, layout, xAt, heightAt, paint, kilnAt, hamlet, village, station };
