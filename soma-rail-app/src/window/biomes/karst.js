// "Karst": southern China's tower-karst country in the spirit of Guilin, Yangshuo and the Li River.
// Steep limestone towers rise abruptly from a flat green valley floor of flooded rice paddies, a
// broad slow river, bamboo, and villages of grey-tiled, white-walled houses. Quiet, misty, layered.
//
// Structure (as downs.js and pinewood.js): one pure layout of WORLD x and distance -- the paddy
// grid, the river course, lanes, streams, villages, tower sites, terraced hills, pagoda mounds and
// the mist field -- hashed from the world seed and cached per terrain. Every band reads from it, so
// nothing jumps at a chunk seam or a band border. Only the ground fill uses the chunk's own rng.
//
// The towers are PROPS standing on a flat terrain (karstTower below). Each tower's shape and colour
// is a pure function of its site hash, and its splat count depends only on its size, distance, the
// budget density and how crowded the world is around it (never on where the chunk borders fall),
// so a tower cut by a chunk border is generated identically by both chunks and the halves meet.
//
// The beat: the towers and hills stay still (beatKinds below); houses, pagodas, temples, trees,
// boats, people, buffalo and village lanterns answer it. Mist and kitchen smoke billow
// (MOVE.VAPOUR), washing and boat pennants flutter (MOVE.FLAG).
//
// The country is worked and lived in (see "People and working animals"): buffalo ploughing,
// wallowing, grazing, led and ridden; planters bent in rows; people on the bunds with carrying
// poles; bicycles and carts on the lane; anglers and washing on the river bank; cormorant rafts;
// neighbours, children and markets in the villages. All of them are placed first in the near band,
// from sites hashed out of the world (lifeSites), and the trees and bamboo keep clear of them.
// Not all of the valley floor is paddy: landUse() turns stretches of a kilometre or two into
// rough pasture, lotus and fish ponds, orchards or bamboo woods (zoneProps draws what stands on
// them). And the middle distance has things to look at (landmarks): a pagoda on a hill, a temple
// on a tower's flank, a pavilion on a crag, a village at a tower's foot, a walled ridge; and now
// and then an old stone bridge over the river.
//
// Surreal dials (all 0 at level 0, so level 0 shows none of this):
//   scale     towers of impossible height and thinness rising into the sky
//   topology  towers floating clear of the valley with roots of rock and trailing vegetation
//             (a river running level through the air was tried and removed: from the train it
//             read as a flat grey slab, not as water)
//   logic     the same pagoda on the same mound repeating along the line, each copy slightly wrong
import { hashInts, makeRng, noise1, noise2 } from '../rng.js';
import {
  KIND, MOVE, makeOut, worldSeed, worldRng, cellsAround, groundY, detail, shade, jitter, mul3, mix3, smooth,
  clamp, lerp, norm3, quatYaw, quatPitch, quatMul, quatUpTo, overheadLine, lamp, blob, stick, treeSplats,
} from './kit.js';

const PAL = {
  ground: [0.33, 0.45, 0.24],     // soft paddy green: also the backdrop below the horizon
  foliage: [0.12, 0.2, 0.09],
  rock: [0.62, 0.61, 0.57],
  ballast: [0.44, 0.42, 0.39],
};

// Colours. Natural surfaces stay <= 0.8 per channel (kit.js caps them anyway).
const C = {
  rock: [0.64, 0.63, 0.59],         // grey-white limestone
  rockWarm: [0.62, 0.55, 0.45],     // iron-stained patches
  streak: [0.3, 0.31, 0.3],         // water streaks running down the faces
  cave: [0.1, 0.09, 0.08],

  veg: [0.1, 0.18, 0.08],           // the dark green that clings to every ledge
  vegLit: [0.18, 0.3, 0.12],
  paddyWater: [0.57, 0.63, 0.64],   // flooded paddy: lighter than the land, a little sky in it
  paddyMuddy: [0.52, 0.53, 0.46],
  youngRice: [0.38, 0.54, 0.22],
  rice: [0.3, 0.46, 0.16],
  mud: [0.4, 0.34, 0.26],
  bund: [0.27, 0.36, 0.15],
  bundLit: [0.34, 0.44, 0.19],
  vegRow: [0.2, 0.38, 0.13],
  soil: [0.42, 0.34, 0.25],
  pond: [0.35, 0.44, 0.41],
  river: [0.6, 0.66, 0.68],
  riverDeep: [0.48, 0.55, 0.56],
  riverRefl: [0.17, 0.23, 0.18],
  riverStreak: [0.7, 0.73, 0.74],
  gravel: [0.6, 0.58, 0.53],
  bank: [0.26, 0.35, 0.15],
  yard: [0.47, 0.45, 0.4],
  lane: [0.56, 0.55, 0.51],
  mist: [0.76, 0.78, 0.79],
  bambooLeaf: [0.3, 0.45, 0.17],
  bambooLit: [0.43, 0.56, 0.22],
  bambooCulm: [0.42, 0.5, 0.22],
  camphor: [0.1, 0.19, 0.08],
  banana: [0.4, 0.55, 0.18],
  tile: [0.25, 0.26, 0.28],         // dark grey roof tiles
  ridge: [0.12, 0.12, 0.13],
  concrete: [0.58, 0.57, 0.53],
  farMount: [0.16, 0.23, 0.2],
};
const WALLS = [[0.78, 0.77, 0.72], [0.76, 0.75, 0.71], [0.74, 0.73, 0.69], [0.52, 0.51, 0.49], [0.56, 0.5, 0.42]];
const CONCRETE_WALLS = [[0.78, 0.78, 0.75], [0.72, 0.72, 0.7], [0.76, 0.68, 0.62], [0.74, 0.72, 0.62], [0.55, 0.55, 0.53]];
const LIT = [1.0, 0.78, 0.46];       // a lit window: a light source (>= 0.97), ignores the tint
const LAMP = [1.0, 0.84, 0.56];

const TERRAIN = { cutting: 2.2, roll: 0.4, rollScale: 700, rise: 0.0, hills: 8, hillScale: 3500, mountains: 380, mountainScale: 9000, mountainStart: 6000 };

// Surface types
const T = { PADDY: 0, RIVER: 1, GRAVEL: 2, BANK: 3, VILLAGE: 4, LANE: 5, STREAM: 6 };
// Paddy kinds
const P = { WATER: 0, YOUNG: 1, RICE: 2, MUD: 3, VEG: 4, POND: 5, PASTURE: 6, LOTUS: 7, ORCHARD: 8, WOOD: 9 };

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

// Rotation taking +x to the unit vector v: an elongated splat lying along v.
function quatXTo(vx, vy, vz) {
  const l0 = Math.hypot(vx, vy, vz) || 1; vx /= l0; vy /= l0; vz /= l0;
  if (vx < 0) { vx = -vx; vy = -vy; vz = -vz; }
  const w = 1 + vx, l = Math.hypot(vz, vy, w);
  return [0, -vz / l, vy / l, w / l];
}
function hourOf(ctx) { const h = ctx.hour != null ? ctx.hour : 12; return ((h % 24) + 24) % 24; }
function isNight(ctx) { const h = hourOf(ctx); return h < 6.5 || h > 19.5; }
// Share of windows lit: some in the evening and before dawn, few in the small hours, none by day.
function litShare(ctx) { if (!isNight(ctx)) return 0; const h = hourOf(ctx); return h > 0.5 && h < 5 ? 0.1 : 0.34; }

// Fill a parallelogram with splats on a jittered grid. o = corner, u/v = unit edge directions,
// lu/lv = edge lengths; colorAt(a, b) -> [r,g,b] or null (skip) or { c, light } for a lit window.
function* panel(out, o, u, v, lu, lv, s, colorAt, q, kind, rng, thick = 0.12) {
  const nu = Math.max(1, Math.round(lu / (s * 1.5))), nv = Math.max(1, Math.round(lv / (s * 1.5)));
  const su = (lu / nu) * 0.62, sv = (lv / nv) * 0.62;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = (i + 0.5 + (rng() - 0.5) * 0.3) / nu, b = (j + 0.5 + (rng() - 0.5) * 0.3) / nv;
      let c = colorAt(a, b);
      if (!c) continue;
      let k = kind;
      if (c.light) { k = KIND.LIGHT; c = c.c; }
      out.q(o[0] + u[0] * a * lu + v[0] * b * lv, o[1] + u[1] * a * lu + v[1] * b * lv, o[2] + u[2] * a * lu + v[2] * b * lv, su, sv, s * thick, c, 1, q, k);
      if (out.due()) yield;
    }
  }
}
// Tone for a vertical face with outward normal (nx, nz) in splat space: the camera-facing front,
// the sunlit (-x) end and the shaded (+x) end come out clearly different, so corners read in motion.
function faceTone(c, nx, nz) {
  const k = 0.6 + 0.26 * Math.max(0, nz) + 0.42 * Math.max(0, -nx) - 0.06 * Math.max(0, nx);
  const cool = Math.max(0, nx);
  return [c[0] * k * (1 - 0.05 * cool), c[1] * k * (1 - 0.01 * cool), c[2] * k * (1 + 0.06 * cool)];
}

// ---------------------------------------------------------------------------------------------
// World layout (pure functions of world x and distance; cached per terrain)
// ---------------------------------------------------------------------------------------------
const worlds = new WeakMap();
function world(ctx) {
  let W = worlds.get(ctx.terrain);
  if (W) return W;
  const ws = worldSeed(ctx);
  const terr = ctx.terrain;
  W = { ws, H: (wx, d) => terr.height(wx, d), panels: new Map(), sites: new Map(), villages: new Map(), cover: new Map(), misc: new Map() };
  // paddy rows parallel to the track, cut into panels by bunds running away from it
  const r = makeRng(hashInts(ws, 501));
  const rows = [];
  let D = 10;
  while (D < 16000) {
    const gap = (9 + 0.13 * D) * (0.6 + 0.8 * r());
    rows.push({ D, gap, W: (14 + 0.22 * D) * (0.6 + 0.8 * r()), wl: 150 + 300 * r() });
    D += gap;
  }
  W.rows = rows; W.Ds = rows.map((q) => q.D);
  // tower ranks: rows of cells, at most one tower group per cell, distinct distances so the far
  // ranks layer up as separate silhouettes
  const tr = makeRng(hashInts(ws, 502));
  const ranks = [];
  let d = 380;
  while (d < 14500) {
    const step = 230 + 0.07 * d;
    ranks.push({ d0: d, dc: d + step / 2, step, cw: step * 1.2, off: tr() * step * 1.2 });
    d += step;
  }
  W.ranks = ranks;
  worlds.set(ctx.terrain, W);
  return W;
}
function cache(map, key, make) {
  let v = map.get(key);
  if (v === undefined) { v = make(); if (map.size > 30000) map.clear(); map.set(key, v); }
  return v;
}

// --- paddy grid ---
function edgeD(W, k, wx) {
  const q = W.rows[k];
  return k === 0 ? q.D : q.D + q.gap * 0.08 * (2 * noise1(wx / q.wl, W.ws + k * 13) - 1);
}
function rowAt(W, wx, d) {
  const Ds = W.Ds;
  let lo = 0, hi = Ds.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (Ds[m] <= d) lo = m; else hi = m - 1; }
  let k = lo;
  while (k + 1 < Ds.length && edgeD(W, k + 1, wx) <= d) k++;
  while (k > 0 && edgeD(W, k, wx) > d) k--;
  return k;
}
function colEdge(W, k, j, d) {
  const q = W.rows[k];
  const h = hashInts(W.ws, 511, k, j);
  const jit = ((h & 1023) / 1023 - 0.5) * 0.5, skew = (((h >>> 10) & 1023) / 1023 - 0.5) * 0.35;
  return (j + jit) * q.W + skew * (d - q.D);
}
function colAt(W, k, wx, d) {
  let j = Math.floor(wx / W.rows[k].W);
  while (colEdge(W, k, j, d) > wx) j--;
  while (colEdge(W, k, j + 1, d) <= wx) j++;
  return j;
}
// What a paddy panel holds. The season drifts slowly along the line: stretches of open water,
// stretches of young green rice; dry vegetable fields cluster near villages.
function panelInfo(W, k, j) {
  return cache(W.panels, k * 4194304 + j, () => {
    const r = makeRng(hashInts(W.ws, 521, k, j));
    const q = W.rows[k];
    const cx = (j + 0.5) * q.W;
    const season = noise1(cx / 3200, W.ws + 522);
    const dry = noise1(cx / 1400, W.ws + 523);
    const u = r();
    let t;
    if (k >= 2 && q.D < 900 && u < 0.035) t = P.POND;
    else if (u < 0.09) t = P.MUD;
    else if (u < 0.09 + 0.22 * smooth(0.3, 0.8, dry)) t = P.VEG;
    else {
      const g = r();
      t = g < 0.55 - 0.45 * season ? P.WATER : g < 0.85 - 0.2 * season ? P.YOUNG : P.RICE;
    }
    const info = { t, tone: 0.92 + 0.16 * r(), green: 0.3 + 0.4 * r(), dir: r() < 0.55, period: 1.4 + 1.2 * r(), muddy: r() < 0.25 ? 0.3 + 0.5 * r() : 0, buffalo: t === P.WATER && r() < 0.07 };
    // Not all of it is paddy: in stretches the valley floor is rough pasture, lotus and fish
    // ponds, orchards or bamboo woods (landUse), and the fields round a village are vegetables.
    // (decided from a hash of its own, after the draws above, so the paddies stay as they were)
    const lu = landUse(W, cx), h = (hashInts(W.ws, 1603, k, j) & 4095) / 4095;
    if (lu.s > 0 && q.D < 600 && h < lu.s * 0.92) {
      const g = h / (lu.s * 0.92);
      if (lu.kind === P.WOOD) info.t = q.D >= 36 ? (q.D < 420 && g < 0.62 ? P.WOOD : q.D < 420 ? P.PASTURE : t) : g < 0.3 ? P.VEG : g < 0.75 ? P.PASTURE : t;
      else if (lu.kind === P.ORCHARD) info.t = q.D >= 28 ? (q.D < 300 ? P.ORCHARD : t) : P.VEG;
      else if (lu.kind === P.LOTUS) info.t = g < 0.45 ? P.LOTUS : g < 0.7 && k >= 2 ? P.POND : P.WATER;
      else info.t = P.PASTURE;
    } else if ((t === P.WATER || t === P.YOUNG || t === P.RICE) && h > 0.4 && q.D < 400 && nearVillage(W, cx, q.D + q.gap / 2)) info.t = P.VEG;
    return info;
  });
}
// The kind of country a stretch of the line runs through: paddies for rather more than half of
// it, and between them, a kilometre or two at a time, pasture, ponds, orchards or woods.
const LU = { kind: 0, s: 0 };
function landUse(W, wx) {
  const a = noise1(wx / 2400, W.ws + 1601);
  LU.s = smooth(0.17, 0.27, Math.abs(a - 0.5));
  if (LU.s > 0) { const b = noise1(wx / 1900, W.ws + 1602); LU.kind = a > 0.5 ? (b > 0.5 ? P.PASTURE : P.LOTUS) : b > 0.5 ? P.ORCHARD : P.WOOD; }
  return LU;
}

// --- river: a broad band in stretches; elsewhere it swings far off across the valley ---
function riverN(W, wx) {
  const off = smooth(0.47, 0.3, noise1(wx / 4600, W.ws + 601));
  return 40 + 75 * noise1(wx / 1500, W.ws + 602) + 2800 * off * off;
}
function riverW(W, wx) { return 55 + 60 * noise1(wx / 1100, W.ws + 603); }

// --- lane parallel to the line, raised a little between the paddies, in stretches ---
function laneD(W, wx) { return 34 + 62 * noise1(wx / 1300, W.ws + 611); }
function laneOn(W, wx) {
  if (noise1(wx / 2600, W.ws + 612) < 0.36) return false;
  const ld = laneD(W, wx), rn = riverN(W, wx);
  return !(ld > rn - 14 && ld < rn + riverW(W, wx) + 14);
}

// --- streams: run away from the line to the river, now and then, crossed by the lane on a bridge ---
const SCELL = 1300;
function stream(W, i) {
  return cache(W.misc, 's' + i, () => {
    const r = makeRng(hashInts(W.ws, 621, i));
    if (r() > 0.45) return null;
    return { i, x0: (i + 0.2 + 0.6 * r()) * SCELL, slope: (r() - 0.5) * 0.5, w: 2.5 + 2 * r(), seed: hashInts(W.ws, 622, i) };
  });
}
function streamX(s, d) { return s.x0 + s.slope * d + 6 * Math.sin(d / 23 + s.i); }
function streamAt(W, wx, d) {
  if (d > 700) return null;
  const i = Math.floor(wx / SCELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const s = stream(W, k);
    if (s && Math.abs(wx - streamX(s, d)) < s.w / 2 && d < riverN(W, s.x0) + 5) return s;
  }
  return null;
}

// --- villages: clusters of houses among trees, at most one per 900 m world cell ---
const VCELL = 900;
function village(W, i) { return cache(W.villages, i, () => makeVillage(W, i)); }
function makeVillage(W, i) {
  const h = hashInts(W.ws, 801, i), r = makeRng(h);
  const cx = (i + 0.15 + 0.7 * r()) * VCELL;
  if (noise1(cx / 2600, W.ws + 802) < 0.36 || r() < 0.2) return null;
  let dc = 30 * Math.pow(40, r());
  const R = 42 + 0.04 * dc + 45 * r(), Rd = Math.max(24, R * (0.45 + 0.2 * r()));
  const rn = riverN(W, cx), rf = rn + riverW(W, cx);
  if (dc + Rd > rn - 10 && dc - Rd < rf + 10) dc = rn - 10 - Rd > 24 + Rd * 0.5 ? rn - 10 - Rd : rf + Rd + 18;    // this side of the river if there is room, else across it
  dc = Math.max(dc, 22 + Rd);
  const v = { i, cx, dc, R, Rd, seed: h, houses: [], trees: [] };
  const gx = 15, gd = 14;
  for (let a = -R; a <= R; a += gx) {
    for (let b = -Rd; b <= Rd; b += gd) {
      const pr = makeRng(hashInts(h, Math.round(a), Math.round(b)));
      const e = (a / R) ** 2 + (b / Rd) ** 2;
      if (e > 1) continue;
      const wx = cx + a + (pr() - 0.5) * 5, d = dc + b + (pr() - 0.5) * 4;
      if (d < 16) continue;
      const u = pr();
      if (u < 0.66 * (1 - 0.35 * e)) {
        const concrete = pr() < 0.24 + 0.16 * (1 - e);
        v.houses.push({
          wx, d, concrete,
          w: concrete ? 8 + 3 * pr() : 9 + 5 * pr(), dep: concrete ? 9 + 2 * pr() : 7 + 2 * pr(),
          storeys: concrete ? 3 + (pr() < 0.4 ? 1 : 0) : pr() < 0.75 ? 2 : 1,
          yaw: (pr() - 0.5) * 0.14 + (pr() < 0.12 ? (pr() < 0.5 ? 1 : -1) * Math.PI / 2 : 0),   // some stand end-on, either way
          wall: concrete ? CONCRETE_WALLS[Math.floor(pr() * CONCRETE_WALLS.length)] : WALLS[Math.floor(pr() * WALLS.length)],
          court: !concrete && pr() < 0.3, seed: hashInts(h, 7, Math.round(a), Math.round(b)),
        });
      } else if (u < 0.86) v.trees.push({ wx, d, type: pr() < 0.22 ? 'banyan' : 'camphor', seed: hashInts(h, 9, Math.round(a), Math.round(b)) });
      else v.trees.push({ wx, d, type: 'bamboo', seed: hashInts(h, 11, Math.round(a), Math.round(b)) });
    }
  }
  // the village tree: a big banyan at one end of the village, level with its middle, so that it
  // frames the houses and never stands between them and the window; and bamboo along the back
  v.trees.push({ wx: cx + (r() < 0.5 ? -1 : 1) * (R + 9 + 6 * r()), d: Math.max(38, dc + (r() - 0.5) * Rd), type: 'banyan', big: true, seed: hashInts(h, 13) });
  for (let k = 0; k < 4; k++) v.trees.push({ wx: cx + (r() - 0.5) * 1.6 * R, d: dc + Rd * (0.8 + 0.3 * r()), type: 'bamboo', seed: hashInts(h, 15, k) });
  return v;
}
function nearVillage(W, wx, d) {
  const i = Math.floor(wx / VCELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const v = village(W, k);
    if (v && ((wx - v.cx) / (v.R + 55)) ** 2 + ((d - v.dc) / (v.Rd + 40)) ** 2 < 1) return true;
  }
  return false;
}
function villageAt(W, wx, d) {
  const i = Math.floor(wx / VCELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const v = village(W, k);
    if (v && ((wx - v.cx) / v.R) ** 2 + ((d - v.dc) / v.Rd) ** 2 < 1) return v;
  }
  return null;
}

// --- tower sites: one group (a tower, or a tight cluster of two or three) per rank cell ---
function towerGroup(W, k, j) {
  return cache(W.sites, k * 100000 + j, () => {
    const rk = W.ranks[k];
    const r = makeRng(hashInts(W.ws, 901, k, j));
    const wx = rk.off + (j + 0.2 + 0.6 * r()) * rk.cw;
    const jit = rk.dc < 3000 ? 0.32 : 0.18;
    const d = rk.dc + (r() - 0.5) * 2 * jit * rk.step;
    const karst = noise2(wx / 2400, d / 2000, W.ws + 902);
    const open = noise1(wx / 3800, W.ws + 903);
    let p = 0.06 + 0.66 * smooth(0.28, 0.66, karst);
    if (d < 1400) p *= 0.22 + 0.78 * smooth(0.3, 0.7, open);     // open valley stretches near the line
    if (r() > p) return null;
    let H = (90 + 220 * Math.pow(r(), 1.3)) * (1 + d / 5000);
    if (d < 900) H = Math.min(H, 0.45 * d + 40);                   // only a few loom past the frame top
    let R = H * (0.2 + 0.17 * r());
    R = Math.min(R, 0.34 * rk.cw);
    const rn = riverN(W, wx);
    if (d - R < rn + riverW(W, wx) + 15 && d + R > rn - 15) return null;
    const v = villageAt(W, wx, d - R * 0.8) || villageAt(W, wx, d);
    if (v) return null;
    const list = [{ wx, d, H, R, seed: hashInts(W.ws, 905, k, j, 0) }];
    if (r() < 0.38) {
      const m = 1 + (r() < 0.4 ? 1 : 0);
      for (let t = 0; t < m; t++) {
        const s = r() < 0.5 ? -1 : 1;
        const Hm = H * (0.5 + 0.45 * r()), Rm = Math.min(R, Hm * (0.22 + 0.15 * r()));
        list.push({ wx: wx + s * (R + Rm) * (0.7 + 0.25 * r()) * (t + 1), d: d + (r() - 0.4) * R * 0.8, H: Hm, R: Rm, seed: hashInts(W.ws, 905, k, j, t + 1) });
      }
    }
    return list;
  });
}
// All towers whose centre lies in [dLo, dHi) and might reach world x [xa, xb].
function towersIn(W, xa, xb, dLo, dHi) {
  const res = [];
  for (let k = 0; k < W.ranks.length; k++) {
    const rk = W.ranks[k];
    if (rk.d0 + rk.step < dLo - 1) continue;
    if (rk.d0 > dHi + 1) break;
    const m = rk.cw * 1.6;
    const j0 = Math.floor((xa - m - rk.off) / rk.cw), j1 = Math.floor((xb + m - rk.off) / rk.cw);
    for (let j = j0; j <= j1; j++) {
      const g = towerGroup(W, k, j);
      if (!g) continue;
      for (const t of g) if (t.d >= dLo && t.d < dHi && t.wx + t.R * 1.4 >= xa && t.wx - t.R * 1.4 <= xb) res.push(t);
    }
  }
  return res;
}
// How strongly towers stand behind the river at world x (for the dark reflection band). 0..1.
function towerCover(W, wx) {
  const key = Math.floor(wx / 6);
  return cache(W.cover, key, () => {
    let best = 0;
    for (const t of towersIn(W, wx - 300, wx + 300, 300, 2200)) {
      const dx = Math.abs(wx - t.wx) / (t.R * 0.9);
      if (dx < 1) best = Math.max(best, (1 - dx * dx) * clamp(t.H / t.d * 3, 0.3, 1));
    }
    return best;
  });
}

// --- terraced hills, pagoda mounds ---
const HCELL = 2300;
function terraceSite(W, i) {
  return cache(W.misc, 'h' + i, () => {
    const r = makeRng(hashInts(W.ws, 931, i));
    if (r() > 0.62 || noise1(i * HCELL / 5000, W.ws + 932) < 0.3) return null;
    const near = r() < 0.35;
    const wx = (i + 0.2 + 0.6 * r()) * HCELL;
    const d = near ? 150 + 70 * r() : 460 + 700 * r();
    const R = near ? 55 + 25 * r() : 120 + 130 * r();
    const Hh = near ? 22 + 14 * r() : 34 + 45 * r();
    const rn = riverN(W, wx);
    if (d - R * 0.6 < rn + riverW(W, wx) + 10 && d + R * 0.6 > rn - 10) return null;
    if (villageAt(W, wx, d)) return null;
    return { wx, d, R, Rd: R * (0.5 + 0.2 * r()), Hh, seed: hashInts(W.ws, 933, i), tea: (hashInts(W.ws, 934, i) & 3) < 2 };
  });
}
const MCELL = 3400;
function moundSite(W, i) {
  return cache(W.misc, 'm' + i, () => {
    const r = makeRng(hashInts(W.ws, 941, i));
    if (r() > 0.45) return null;
    const wx = (i + 0.2 + 0.6 * r()) * MCELL, d = 420 + 1100 * r();
    const rn = riverN(W, wx);
    if (d < rn + riverW(W, wx) + 60 && d > rn - 60) return null;
    if (villageAt(W, wx, d)) return null;
    return { wx, d, R: 45 + 35 * r(), Hm: 14 + 16 * r(), pagoda: r() < 0.6, seed: hashInts(W.ws, 942, i) };
  });
}

// --- mist: slow world noise, strongest over the river and in low stretches ---
function mistAmt(W, wx, d) {
  const band = smooth(0.32, 0.68, noise1(wx / 2800, W.ws + 701));
  const local = 0.45 + 0.55 * noise2(wx / 700, d / 600, W.ws + 702);
  return band * local;
}

// What covers the ground at a world point. Returns a reused object.
const SURF = { t: 0, y: 0, k: 0, j: 0, info: null, edge: 0, v: null, s: null };
function surface(W, wx, d) {
  const S = SURF;
  const h = W.H(wx, d);
  S.y = h; S.info = null; S.v = null; S.s = null;
  const rn = riverN(W, wx);
  if (d > rn - 7 && d < rn + 260) {
    const rf = rn + riverW(W, wx);
    if (d >= rn && d <= rf) {
      // gravel bars on the inner edges, in places
      const gb = 14 * smooth(0.6, 0.85, noise1(wx / 320, W.ws + 604));
      const gf = 9 * smooth(0.65, 0.9, noise1(wx / 280, W.ws + 605));
      S.t = d - rn < gb || rf - d < gf ? T.GRAVEL : T.RIVER;
      S.y = h - (S.t === T.RIVER ? 0.7 : 0.4);
      S.edge = Math.min(d - rn, rf - d);
      return S;
    }
    if (d < rn || d < rf + 7) { S.t = T.BANK; return S; }
  }
  if (d > 20 && laneOn(W, wx) && Math.abs(d - laneD(W, wx)) < 2.2) { S.t = T.LANE; S.y = h + 0.35; return S; }
  if (d > 10) {
    const st = streamAt(W, wx, d);
    if (st) { S.t = T.STREAM; S.s = st; S.y = h - 0.5; return S; }
  }
  const v = d > 14 && d < 2000 ? villageAt(W, wx, d) : null;
  if (v) { S.t = T.VILLAGE; S.v = v; return S; }
  const k = rowAt(W, wx, d), j = colAt(W, k, wx, d);
  S.t = T.PADDY; S.k = k; S.j = j; S.info = panelInfo(W, k, j);
  // distance to the nearest bund
  const q = W.rows[k];
  S.edge = Math.min(d - edgeD(W, k, wx), k + 1 < W.rows.length ? edgeD(W, k + 1, wx) - d : 1e9,
    Math.abs(wx - colEdge(W, k, j, d)), Math.abs(colEdge(W, k, j + 1, d) - wx));
  S.farEdge = k + 1 < W.rows.length ? edgeD(W, k + 1, wx) - d : 1e9;
  if (S.info.t === P.WATER || S.info.t === P.YOUNG || S.info.t === P.POND || S.info.t === P.LOTUS) S.y = h + 0.05;
  void q;
  return S;
}

// Colour of the surface at a world point (rng: the fill's own rng for per-splat variation).
function surfColor(W, s, wx, d, rng) {
  let c;
  switch (s.t) {
    case T.RIVER: c = riverColor(W, s, wx, d, rng); break;
    case T.GRAVEL: c = jitter(mix3(C.gravel, [0.5, 0.49, 0.45], noise2(wx / 6, d / 3, W.ws + 606)), rng, 0.08); break;
    case T.BANK: c = jitter(mix3(C.bank, [0.4, 0.38, 0.3], 0.3 * noise2(wx / 9, d / 4, W.ws + 607)), rng, 0.12); break;
    case T.LANE: c = jitter(C.lane, rng, 0.05); break;
    case T.STREAM: c = jitter(mix3(C.paddyWater, [0.3, 0.35, 0.3], 0.4), rng, 0.06); break;
    case T.VILLAGE: {
      const g = noise2(wx / 11, d / 9, W.ws + 811);
      c = g > 0.58 ? mix3(C.vegRow, C.soil, smooth(0.3, 0.7, noise2(wx / 2, d / 2, W.ws + 812))) : g < 0.3 ? [0.27, 0.36, 0.17] : C.yard;
      c = jitter(c, rng, 0.08);
      break;
    }
    default: c = paddyColor(W, s, wx, d, rng);
  }
  return c;
}
function paddyColor(W, s, wx, d, rng) {
  const f = s.info;
  const bw = 0.35 + 0.0025 * d;
  if (s.edge < bw) return jitter(rng() < 0.5 ? C.bund : C.bundLit, rng, 0.1);
  let c;
  switch (f.t) {
    case P.WATER:
    case P.POND: {
      c = f.t === P.POND ? C.pond : mix3(C.paddyWater, C.paddyMuddy, f.muddy);
      // the bund beyond reflects as a darker line along the far edge of the water
      if (s.farEdge < bw * 3 + 0.6) c = mix3(c, C.bund, 0.45);
      c = mul3(c, f.tone);
      break;
    }
    case P.YOUNG:
      // young rice: a fine green haze over the water
      c = rng() < f.green + 0.15 ? jitter(C.youngRice, rng, 0.12) : mul3(C.paddyWater, f.tone * 0.97);
      break;
    case P.RICE: c = mul3(C.rice, f.tone * (0.92 + 0.16 * noise2(wx / 3, d / 3, W.ws + 524))); break;
    case P.MUD: c = mix3(C.mud, [0.33, 0.3, 0.24], noise2(wx / 4, d / 3, W.ws + 525)); break;
    case P.PASTURE: {
      // rough grazing: sour green and ochre in patches, darker tussocks
      c = mix3([0.3, 0.4, 0.15], [0.45, 0.44, 0.22], smooth(0.4, 0.75, noise2(wx / 9, d / 5, W.ws + 1611)));
      if (noise2(wx / 2.2, d / 1.6, W.ws + 1612) > 0.68) c = mul3(c, 0.74);
      c = mul3(c, f.tone);
      break;
    }
    case P.LOTUS:
      // lotus: the water all but hidden under the big leaves
      c = rng() < 0.74 ? jitter(mix3([0.2, 0.4, 0.2], [0.32, 0.5, 0.25], noise2(wx / 3, d / 2, W.ws + 1613)), rng, 0.1) : mul3([0.3, 0.37, 0.35], f.tone);
      break;
    case P.ORCHARD: c = mul3(mix3([0.27, 0.39, 0.15], [0.19, 0.29, 0.11], smooth(0.45, 0.7, noise2(wx / 4, d / 3, W.ws + 1614))), f.tone); break;
    case P.WOOD: c = mul3(mix3([0.14, 0.22, 0.09], [0.22, 0.28, 0.13], noise2(wx / 5, d / 4, W.ws + 1615)), f.tone); break;
    default: {
      // dry field of vegetables in tidy rows
      const coord = f.dir ? wx : d * 2.2;
      c = Math.sin((coord / f.period) * Math.PI * 2) > -0.1 ? C.vegRow : C.soil;
      c = mul3(c, f.tone);
    }
  }
  return jitter(c, rng, 0.05);
}
function riverColor(W, s, wx, d, rng) {
  const rn = riverN(W, wx), rf = rn + riverW(W, wx);
  const u = (d - rn) / (rf - rn);                    // 0 near bank .. 1 far bank
  // pale sky water, deeper toward the middle
  let c = mix3(C.river, C.riverDeep, 0.35 * Math.sin(Math.PI * u));
  // the reflection of the far bank's trees and of the towers behind it, near the far bank
  const cover = towerCover(W, wx);
  const bandW = 0.22 + 0.06 * noise1(wx / 40, W.ws + 608) + 0.3 * cover;
  const refl = smooth(1 - bandW - 0.05, 1 - bandW + 0.08, u);
  const rc = mix3(C.riverRefl, [0.4, 0.42, 0.4], 0.35 * cover * smooth(1, 0.6, u));
  c = mix3(c, rc, refl * 0.85);
  // pale wind lanes, long in x
  const st = noise2(wx / 70, d / (1.1 + 0.01 * d), W.ws + 609);
  c = mix3(c, C.riverStreak, smooth(0.78, 0.92, st) * (1 - 0.7 * refl) * 0.7);
  return jitter(c, rng, 0.02);
}

// ---------------------------------------------------------------------------------------------
// The surface fill: one splat per sample, so the band is covered and the count lands on ctx.count.
//   opts: n, dNear, dFar, power, cover, minR, maxR, tuft (d below which open ground is tufty)
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
    const s = surface(W, wx, d);
    let c = surfColor(W, s, wx, d, rng);
    if (opts.hook) c = opts.hook(s, wx, d, c);
    const ax = 0.8 + 0.5 * rng();
    const water = s.t === T.RIVER || s.t === T.STREAM || (s.t === T.PADDY && (s.info.t === P.WATER || s.info.t === P.POND));
    if (water) out(x, s.y, -d, r * 1.4 * ax, r * 0.05, r * 0.7, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    else {
      const crop = s.t !== T.PADDY ? 0 : s.info.t === P.RICE || s.info.t === P.VEG ? 0.25 : s.info.t === P.LOTUS ? 0.4 : s.info.t === P.PASTURE ? 0.1 : 0;
      const tuft = opts.tuft && d < opts.tuft && (s.t === T.BANK || s.t === T.PADDY) ? 1 - d / opts.tuft : 0;
      out(x, s.y + 0.03 + crop + tuft * r * 0.4 * rng(), -d, r * ax, r * (0.12 + 0.3 * tuft), r * (1.8 - ax), c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    }
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Props (kit candidates): karstTower, bamboo, banana, broadCrown, tiledHouse, concreteHouse,
// terraceHill, pagoda, pavilion, archBridge. All share the kit's shape: function* (ctx, out, x, d, opts).
// ---------------------------------------------------------------------------------------------

// A limestone tower: a solid of steep, near-vertical grey-white cliffs streaked darker by water,
// a cap of dark growth over the rounded top and shoulders, green ledges crossing the cliffs, growth
// hanging down the gullies, a skirt of trees at the foot and now and then a cave mouth. One to
// three lobes (double summits, shoulders), a superellipse profile with a flared foot, lean and a
// lumpy outline make every tower different.
//
// How it is drawn, so that it reads as a crisp solid at any distance and budget:
// - The visible surface (+-130 degrees round from the camera side) is tiled on a jittered grid of
//   flat discs lying in the true (bumpy, stepped) surface, each about 0.72 of its cell, so
//   neighbours overlap into an opaque skin with no see-through gaps. Where the surface turns away
//   at the outline the discs are seen edge on, and the outline is as thin as a disc is thick: a
//   clean edge, never a halo. Splat count, not splat size, is what the budget changes.
// - Behind the skin, a card of larger splats inset well inside the outline (the opaque core).
// - Towers take their splats by their size on screen (towerSplats, the same K in mid and far), so
//   their grain does not change at 3000 m; the valley floor behind is a thin strip on screen and
//   gets what is left.
// - Colour comes from coherent features laid out in the tower's own metres (cap, ledges, gullies,
//   vertical streaks), never finer than the grid, and is lit from the surface normal against SUN,
//   so every tower has a lit (-x) side and a shaded (+x) side.
// Shape and colour are pure functions of opts.rng and n, so a tower split by a chunk border is
// generated identically by both chunks and the halves meet.
//   opts: { height, radius, rng, n, y (base), kind, mist (0..1: mist wrapping the foot), green (0..1),
//           thin (0..1: level-1 needles), fadeTop (metres: fade into the sky above this),
//           aerial (0..1: bake some aerial perspective in), move (motion class for every splat) }
const AERIAL = [0.6, 0.67, 0.74];
const PROF_N = 64;
export function* karstTower(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 180, R = opts.radius || H * 0.35;
  const y0 = opts.y != null ? opts.y : groundY(ctx, x, d) - 1;
  const kind = opts.kind != null ? opts.kind : KIND.ROCK;
  const n = Math.max(6, Math.round(opts.n || 400));
  // --- shape (the draw order of rng() here is part of the tower's identity) ---
  // three families: rounded domes, tapering sugarloaves, sheer columns
  const fam = rng();
  const p = fam < 0.45 ? 3 + 2 * rng() : fam < 0.7 ? 2.0 + 0.8 * rng() : 6 + 5 * rng();
  const q = fam < 0.45 ? 1.6 + 0.6 * rng() : fam < 0.7 ? 1.2 + 0.3 * rng() : 2 + rng();
  const taper = fam < 0.45 ? 0.08 + 0.22 * rng() : fam < 0.7 ? 0.18 + 0.2 * rng() : 0.05 * rng();
  const leanX = (rng() - 0.5) * 0.22, leanD = (rng() - 0.5) * 0.12;
  const bulge = (rng() - 0.35) * 0.2;
  const salt = Math.floor(rng() * 60000);
  const ph1 = rng() * 6.28, ph2 = rng() * 6.28, a1 = 0.04 + 0.08 * rng(), a2 = 0.03 + 0.06 * rng();
  const lobes = [{ ox: 0, oz: 0, h: 1, r: 1 }];
  if (rng() < 0.5) {
    const m = rng() < 0.35 ? 2 : 1;
    for (let k = 0; k < m; k++) lobes.push({ ox: (rng() - 0.5) * 1.2 * R, oz: (rng() - 0.3) * 0.5 * R, h: 0.55 + 0.38 * rng(), r: 0.42 + 0.3 * rng() });
  }
  const green = opts.green != null ? opts.green : 0.5 + 0.45 * rng();
  const warm = rng() * 0.7;
  const caves = [];
  const nc = rng() < 0.55 ? 1 + (rng() < 0.3 ? 1 : 0) : 0;
  for (let k = 0; k < nc; k++) caves.push({ a: (rng() - 0.5) * 1.4, t: 0.06 + 0.3 * rng(), w: (0.05 + 0.07 * rng()) * Math.min(1, 40 / R), h: (0.025 + 0.04 * rng()) * Math.min(1, 120 / H) });
  const ledges = [];
  const nl = 1 + Math.floor(rng() * 3);
  for (let k = 0; k < nl; k++) ledges.push({ t: 0.22 + 0.55 * rng(), w: 0.012 + 0.022 * rng(), ph: rng() * 6.28, s: salt + 40 + k, k: rng() < 0.7 ? 0.03 + 0.08 * rng() : 0 });
  const capThr = 0.5 - 0.3 * (green - 0.5);           // how gentle a slope must be to be clothed
  const gullyThr = 0.7 - 0.12 * green;                  // share of the cliffs cut by hanging gullies
  const mist = opts.mist || 0, fadeTop = opts.fadeTop || 0, thin = opts.thin || 0;
  const aerial = opts.aerial || 0, move = opts.move || 0;
  // --- the profile, tabulated once: radius (fraction of the lobe radius) at height fraction t ---
  const prof = new Float32Array(PROF_N + 1);
  for (let i = 0; i <= PROF_N; i++) {
    const t = Math.min(i / PROF_N, 0.9995);
    const base = Math.pow(Math.max(0, 1 - Math.pow(t, p)), 1 / q);
    prof[i] = base * (1 + 0.32 * Math.exp(-t / 0.06)) * (1 + bulge * Math.sin(Math.PI * t)) * (1 - taper * t) * (1 - thin * 0.4 * t);
  }
  const prAt = (t) => { const f = clamp(t, 0, 1) * PROF_N, i = Math.min(PROF_N - 1, Math.floor(f)), u = f - i; return prof[i] + (prof[i + 1] - prof[i]) * u; };
  // outline bulges, notches and overhangs: around (metres of arc) and up (metres)
  // (the cliffs step back above most ledges, so the outline has shoulders and the ledge tops face up)
  let fineU = 1, fineH = 1;
  const stepAt = (tt) => { let k = 1; for (const L of ledges) if (L.k) k *= 1 + L.k * smooth(L.t + 0.025, L.t - 0.015, tt); return k; };
  const radAt = (a, tt, Rl, Hl) => {
    const u = a * Rl, h = tt * Hl;
    let k = 1 + a1 * Math.cos(a + ph1) + a2 * Math.cos(2 * a + ph2)
      + 0.28 * (noise2(u / (Rl * 0.45 + 4), h / (Hl * 0.16 + 3), salt) - 0.5)
      + 0.1 * (noise2(u / fineU, h / fineH, salt + 15) - 0.5);
    return Rl * prAt(tt) * k * stepAt(tt);
  };
  const slack = a1 + a2 + 0.2;                          // how far inside the profile the outline can dip
  // --- grid spacing from the visible surface area of all lobes ---
  const AMAX = 2.3;                                     // the camera-facing part, +-130 degrees
  let area = 0;
  for (const l of lobes) {
    const Hl = H * l.h, Rl = R * l.r;
    let A = 0, S = 0;
    l.cum = new Float32Array(PROF_N + 1);
    for (let i = 1; i <= PROF_N; i++) {
      const dr = (prof[i] - prof[i - 1]) * Rl, dh = Hl / PROF_N;
      const ds = Math.hypot(dr, dh);
      S += ds; l.cum[i] = S;
      A += 2 * (AMAX + (Math.PI - AMAX) * smooth(0.25, 0.8, -dr / ds)) * Rl * 0.5 * (prof[i] + prof[i - 1]) * ds;
    }
    l.S = S; l.A = A; area += A;
  }
  const nSurf = n * 0.92;
  const sp = Math.sqrt(area / nSurf);                  // cell size in metres
  // features are laid out in metres, never finer than a few cells (finer detail would only speckle)
  const fs = Math.max(sp * 2.2, R * 0.05);
  const capS = Math.max(fs * 1.5, R * 0.3), gullyS = Math.max(fs, R * 0.16), streakS = Math.max(fs * 0.8, R * 0.05);
  const ledgeS = Math.max(fs * 1.5, R * 0.35), toneS = Math.max(fs * 2, R * 0.6), facetS = Math.max(fs * 1.6, R * 0.22);
  // Is (px, h, pd) inside another lobe (so hidden: skip it)?
  const inside = (li, px, h, pd) => {
    for (let k = 0; k < lobes.length; k++) {
      if (k === li) continue;
      const m = lobes[k], Hm = H * m.h, tm = h / Hm;
      if (tm >= 0.97) continue;
      const mx = x + m.ox + leanX * Hm * tm * tm, md = d + m.oz + leanD * Hm * tm * tm;
      const rr = R * m.r * prAt(tm) * (1 - slack) - sp;
      if (rr > 0 && (px - mx) ** 2 + (pd - md) ** 2 < rr * rr) return true;
    }
    return false;
  };
  const coreC = shade(mix3(mix3(C.rock, C.veg, 0.5), C.streak, 0.35), 0, 0.2, 1, 0.5, 0.4);
  for (let li = 0; li < lobes.length; li++) {
    const l = lobes[li], Hl = H * l.h, Rl = R * l.r;
    // the fine bumps of the outline: never finer than three cells, or they would only make it ragged
    fineU = Math.max(Rl * 0.14, 3 * sp); fineH = Math.max(Hl * 0.06, 3 * sp);
    const rows = Math.max(2, Math.round(l.S / sp));
    const dv = l.S / rows;
    let seg = 0;
    for (let rI = 0; rI < rows; rI++) {
      // height fraction of this row: equal steps of arc length up the profile
      const sTarget = (rI + 0.5) * dv;
      while (seg < PROF_N - 1 && l.cum[seg + 1] < sTarget) seg++;
      const t0 = (seg + (sTarget - l.cum[seg]) / Math.max(1e-6, l.cum[seg + 1] - l.cum[seg])) / PROF_N;
      const prRow = prAt(t0), radRow = Rl * prRow;
      // the top is seen from below, so its outline lies beyond the summit: where the surface turns
      // to face the sky the row goes further round, to the full circle on a flat top
      const slopeRow = (prAt(t0 + 0.01) - prAt(t0 - 0.01)) / 0.02 * Rl / Hl;
      const am = AMAX + (Math.PI - AMAX) * smooth(0.25, 0.8, -slopeRow / Math.hypot(slopeRow, 1));
      const cols = Math.max(1, Math.round(2 * am * radRow / sp));
      const du = 2 * am * Math.max(radRow, sp * 0.3) / cols;
      for (let cI = 0; cI < cols; cI++) {
        const tt = clamp(t0 + (rng() - 0.5) * 0.25 * dv / Hl, 0, 0.995);
        const a = ((cI + 0.5 + (rng() - 0.5) * 0.25) / cols * 2 - 1) * am;
        const pr = prAt(tt), h = tt * Hl;
        const drdh = (prAt(tt + 0.01) - prAt(tt - 0.01)) / 0.02 * Rl / Hl;
        const u = a * Rl;                                 // metres round the lobe
        const sa = Math.sin(a), ca = Math.cos(a);
        // the surface and its true normal (from the bumps and steps too), so the discs lie in it and
        // still tile it where it bulges, and the light picks out every shoulder and ledge
        const da_ = am / cols, dt_ = Math.max(0.003, 0.5 * dv / (Hl * Math.hypot(drdh, 1)));
        let rad = radAt(a, tt, Rl, Hl);
        const ra = (radAt(a + da_, tt, Rl, Hl) - rad) / da_;
        const rh = (radAt(a, Math.min(0.999, tt + dt_), Rl, Hl) - rad) / (dt_ * Hl);
        const PA = ra * sa + rad * ca, PB = ra * ca - rad * sa;          // d/da of the surface point: (PA, 0, PB)
        let nx = -PB, ny = PB * rh * sa - PA * rh * ca, nz = PA;
        const nl0 = Math.hypot(nx, ny, nz) || 1; nx /= nl0; ny /= nl0; nz /= nl0;
        const pal = Math.hypot(PA, PB) || 1;
        // the slope that decides where growth settles: the profile and its steps, not every bump
        // (the bumps would scatter the cap into speckles)
        const rhC = (stepAt(Math.min(0.999, tt + dt_)) * prAt(tt + dt_) - stepAt(tt) * pr) * Rl / (dt_ * Hl);
        const nyC = -rhC / Math.hypot(1, rhC);
        // what covers it: the cap and shoulders, hanging gullies, ledges, the skirt at the foot
        const g = noise1(u / gullyS, salt + 2);
        const gully = smooth(gullyThr - 0.06, gullyThr + 0.02, g);
        const drip = 0.25 + 0.7 * noise1(u / (gullyS * 0.8), salt + 3);
        // Where growth clings: each rule gives a signed margin (> 0 inside, in units of its own soft
        // edge) and the strongest wins, so the masses have clean but anti-aliased borders.
        // the cap over the gentle top and shoulders, its lower edge ragged
        let m = Math.max((nyC + 0.35 * (noise2(u / capS, h / capS, salt + 1) - 0.5) - capThr) / 0.06, (tt - 0.96) / 0.01);
        // growth hanging down the gullies from the cap
        m = Math.max(m, Math.min((gully - 0.5) / 0.25, (tt - 1 + drip * (0.4 + 0.6 * green)) / 0.025));
        // clumps clinging to the cliffs: masses drawn out up and down, more of them higher up
        m = Math.max(m, (noise2(u / (gullyS * 1.3), h / (Hl * 0.22), salt + 4) + 0.18 * (tt - 0.5) - 0.74 + 0.3 * (green - 0.5)) / 0.035);
        let ledgeV = 0;
        for (const L of ledges) {
          const lt = L.t + 0.02 * Math.sin(a * 2.3 + L.ph);
          const on = (noise1(u / ledgeS, L.s) - 0.38) / 0.04;
          const lo = lt - L.w * (0.6 + 2.5 * gully), hi = lt + L.w;
          m = Math.max(m, Math.min(on, (tt - lo) / 0.006, (hi - tt) / 0.006));
          if (on > 0 && tt < lo && tt > lo - 0.18) ledgeV = Math.max(ledgeV, 0.45 * (1 - (lo - tt) / 0.18) * Math.min(1, on));
        }
        // the skirt of trees at the foot
        m = Math.max(m, (0.045 + 0.06 * noise1(u / fs, salt + 5) - tt) / 0.008);
        if (thin) m = Math.max(m, (noise2(u / fs, h / (fs * 3), salt + 6) - 0.7 + 0.1 * thin) / 0.05);
        const vw = smooth(-1, 1, m), veg = vw > 0.5;
        // gullies are cut back into the rock (notches in the outline); growth stands a little proud
        rad *= 1 - 0.025 * smooth(gullyThr - 0.2, gullyThr + 0.1, g);
        rad += vw * sp * 0.25 * noise2(u / (sp * 2), h / (sp * 2), salt + 7);
        const cx = x + l.ox + leanX * Hl * tt * tt, cd = d + l.oz + leanD * Hl * tt * tt;
        const px = cx + sa * rad, pd = cd - ca * rad;
        if (lobes.length > 1 && inside(li, px, h, pd)) continue;
        // Light: the cliffs break into vertical facets, each a flat face turned a little its own way,
        // so they catch the sun or fall into shade facet by facet; the rounded cap stays smooth.
        const fa = u / facetS + 0.7 * noise1(h / (Hl * 0.3), salt + 14);
        const aN = Math.atan2(nx, nz) - (1 - vw) * 0.7 * (fa - Math.round(fa)) * facetS / Rl;
        const nh = Math.hypot(nx, nz), lx = Math.sin(aN) * nh, lz = Math.cos(aN) * nh;
        const tone = 0.9 + 0.2 * noise2(u / toneS, h / toneS, salt + 8);
        let c;
        let cv_ = null;
        if (vw > 0) {
          cv_ = mix3(C.veg, C.vegLit, 0.15 + 0.5 * noise2(u / fs, h / fs, salt + 9));
          cv_ = shade(mul3(cv_, tone), nx, ny, nz, 0.42, 0.62);
        }
        if (vw < 1) {
          c = mix3(C.rock, C.rockWarm, warm * smooth(0.55, 0.8, noise1(u / (streakS * 3), salt + 10)));
          // dark water streaks running down the cliffs, heaviest below the growth that feeds them
          const st = noise1(u / streakS, salt + 11) * (0.6 + 0.4 * noise1(h / (Hl * 0.3) + u / streakS, salt + 12));
          c = mix3(c, C.streak, clamp(smooth(0.4, 0.7, st) * 0.8 + ledgeV + 0.3 * smooth(0.45, 0.62, g) * (tt > 1 - drip - 0.15 ? 1 : 0.4), 0, 0.85));
          c = mul3(c, tone * (1 - 0.18 * smooth(gullyThr - 0.15, gullyThr, g)));   // shadow at the gully's lip
          c = shade(c, lx, ny, lz, 0.34, 0.82);
          // a cave mouth: a dark opening under an overhang, its rim in shadow
          for (const cv of caves) {
            if (li !== 0) break;
            const da = (a - cv.a) / cv.w, dt = (tt - cv.t) / cv.h, e = da * da + dt * dt;
            if (e < 1.6) { c = mix3(c, C.cave, 0.85 * smooth(1.6, 0.8, e)); break; }
          }
          if (cv_) c = mix3(c, cv_, vw);
        } else c = cv_;
        c = jitter(c, rng, 0.03);
        let o = 1;
        if (mist > 0) {
          const mt = mist * Hl * (0.18 + 0.12 * noise1(u / capS, salt + 13));
          if (h < mt) c = mix3(c, C.mist, 0.8 * mist * smooth(mt, 0, h));
        }
        if (aerial > 0) c = mix3(c, AERIAL, aerial);
        if (fadeTop && y0 + h > fadeTop) { const f = smooth(fadeTop, fadeTop + H * 0.3, y0 + h); c = mix3(c, [0.72, 0.76, 0.8], f); o = 1 - 0.7 * f; }
        // the disc: in the surface, about 0.72 of its cell, thin along the normal

        const vl = Math.hypot(drdh, 1);
        const Tx = PA / pal, Tz = PB / pal;               // round the tower
        const Zx = -Tz * ny, Zy = Tz * nx - Tx * nz, Zz = Tx * ny;   // Z = T x N: up the surface
        const qq = quatBasis(Tx, 0, Tz, nx, ny, nz, Zx, Zy, Zz);
        // the disc spans its cell as laid on the true surface (longer up a step, wider round a bulge);
        // near a pointed top the cell is wider than the tower, so keep the disc inside the outline
        const cap_ = rad * 1.1 + 0.1 * sp;
        const sx = Math.min(0.72 * Math.max(pal, 0.3 * sp) * (2 * am / cols), cap_, du * 1.6);
        const sz = Math.min(0.72 * (dv / vl) * Math.hypot(1, rh), dv * 2.2, cap_), sy = Math.min(sx, sz) * (veg ? 0.3 : 0.16);
        out(px, y0 + h, -pd, sx, sy, sz, c[0], c[1], c[2], o, qq[0], qq[1], qq[2], qq[3], kind, move);
        if (out.due()) yield;
      }
      // the opaque core: a card of larger splats on the lobe's axis, facing the window, inset well
      // inside the narrowest the outline gets, so sky never shows through and nothing pokes out
      if (rI % 2 === 0 && !fadeTop) {
        const sc = sp * 1.8;
        const hc = t0 * Hl, syc = Math.min(sc * 0.75, dv * 1.4);
        // (inset from above as well: under a dome the card must stop well below the top)
        const cw = Math.min(radRow, Rl * prAt(t0 + 2.5 * syc / Hl)) * (1 - slack) * 0.8 - sc * 1.2;
        if (cw > 0 && hc > sc) {
          const cx = x + l.ox + leanX * Hl * t0 * t0, cd = d + l.oz + leanD * Hl * t0 * t0;
          const nC = Math.max(1, Math.round(2 * cw / sc));
          const c = aerial > 0 ? mix3(coreC, AERIAL, aerial) : coreC;
          for (let k = 0; k < nC; k++) {
            const ox = nC === 1 ? 0 : (k / (nC - 1) * 2 - 1) * cw;
            out(cx + ox, y0 + hc, -cd, sc * 0.75, syc, sc * 0.12, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind, move);
          }
        }
      }
    }
  }
}
// Rotation whose columns are the unit vectors X, Y, Z (local x -> X, y -> Y, z -> Z), as [x, y, z, w].
function quatBasis(m00, m10, m20, m01, m11, m21, m02, m12, m22) {
  const tr = m00 + m11 + m22;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]; }
  if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11); return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}
// Splats a tower of this size at this distance gets: by its size on screen only (never by what else
// is in the chunk), so both chunks that share a tower draw it identically.
const TOWER_K = 150000;
function towerSplats(out, t, K) { return Math.round(clamp(K * out.density * (t.R * t.H) / (t.d * t.d), 8, 14000 * out.density)); }

// Bamboo clump: many thin culms leaning out from the clump and arching over at the top, with
// feathery, light-green foliage hanging from the upper half. Lighter and finer than the trees.
//   opts: { height, width, rng, n, y, kind, culms, color }
export function* bamboo(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 9, Wd = opts.width || H * 0.5;
  const y0 = opts.y != null ? opts.y : groundY(ctx, x, d) - 0.1;
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const n = Math.max(6, Math.round(opts.n || treeSplats(out, d, Wd + H * 0.4) * 1.5));
  const culms = opts.culms || clamp(Math.round(12 + H * 1.6 * rng()), 6, 32);
  const leaf = opts.color || C.bambooLeaf;
  const fine = Math.max(0.06, detail(out, d, 0.9));
  // the clump's dense, shaded interior first, so the feathery sprays read against foliage, not sky
  const nCore = Math.round(n * 0.05);
  yield* blob(ctx, out, x, y0 + H * 0.45, d, Wd * 0.18, H * 0.28, Wd * 0.15, { n: nCore, color: mul3(leaf, 0.55), rng, kind, inner: 0.6, amb: 0.5, clump: 0.8 });
  const per = Math.max(2, Math.floor((n - nCore) / culms));
  for (let cI = 0; cI < culms; cI++) {
    const ang = rng() * Math.PI * 2, br = Wd * 0.16 * Math.sqrt(rng());
    const bx = x + Math.cos(ang) * br, bd = d + Math.sin(ang) * br * 0.7;
    // lean outward from the clump, favouring the sides (the arch reads best across the window)
    let ox = Math.cos(ang) * 1.3, oz = Math.sin(ang) * 0.6;
    const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
    const lean = 0.1 + 0.25 * rng(), arch = 0.45 + 0.6 * rng();
    const h = H * (0.65 + 0.35 * rng());
    const P = (s) => [bx + ox * h * (lean * s + arch * 0.45 * Math.pow(s, 2.4)), y0 + h * (s - 0.16 * arch * s * s * s), bd + oz * h * (lean * s + arch * 0.45 * Math.pow(s, 2.4))];
    const nStem = Math.max(1, Math.round(per * 0.14));
    const cr = Math.max(0.035, fine * 0.4);
    for (let k = 0; k < nStem; k++) {
      const s = (k + 0.5) / nStem * 0.8;
      const [px, py, pd] = P(s), [qx, qy, qd] = P(s + 0.02);
      const qq = quatXTo(qx - px, qy - py, -(qd - pd));
      const len = (h * 0.8 / nStem) * 0.6;
      const c = mul3(C.bambooCulm, 0.8 + 0.3 * s);
      out(px, py, -pd, Math.max(len, cr), cr, cr, c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], kind);
    }
    const nLeaf = per - nStem;
    for (let k = 0; k < nLeaf; k++) {
      const s = 0.35 + 0.65 * Math.pow(rng(), 0.55);
      const [px, py, pd] = P(s);
      // sprays spread wider toward the tip and droop
      const sp = h * (0.07 + 0.15 * s);
      // the spray hangs below and outside the arching culm: feathery plumes, not a ball
      const dx = ox * rng() * sp + (rng() - 0.5) * sp, dy = -(0.2 + rng()) * sp, dz = (rng() - 0.5) * 1.2 * sp;
      const lx = px + dx, ly = py + dy, lz = pd + dz;
      const nx = (lx - bx) / (h * 0.4), nz = -(lz - bd) / (h * 0.4) + 0.4, ny = 0.6;
      let c = mix3(leaf, C.bambooLit, smooth(0.5, 1, s) * 0.6 * rng());
      c = shade(c, nx, ny, nz, 0.62, 0.45);
      c = jitter(c, rng, 0.12);
      const lw = Math.max(fine * 0.8, 0.09), ll = Math.max(lw * lerp(2.6, 1.3, smooth(15, 50, d)), 0.3);
      const qq = quatXTo(ox * 0.6 + (rng() - 0.5), -0.6 - rng() * 0.5, -oz * 0.6 + (rng() - 0.5));
      out(lx, ly, -lz, ll, lw, lw, c[0], c[1], c[2], 0.92, qq[0], qq[1], qq[2], qq[3], kind);
      if (out.due()) yield;
    }
  }
}

// Banana plant: a short pseudostem with a fan of long, broad, drooping leaves.
//   opts: { height, rng, y, kind, n }
export function* banana(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 3;
  const y0 = opts.y != null ? opts.y : groundY(ctx, x, d) - 0.1;
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  yield* stick(ctx, out, x, y0, d, H * 0.7, 0.13, { color: [0.3, 0.34, 0.16], kind, n: 4 });
  const leaves = 6 + Math.floor(rng() * 4);
  const seg = opts.n ? Math.max(2, Math.round(opts.n / leaves)) : 5;
  for (let k = 0; k < leaves; k++) {
    const az = (k / leaves) * Math.PI * 2 + rng();
    const L = H * (0.55 + 0.35 * rng());
    const ux = Math.cos(az), uz = Math.sin(az);
    const torn = rng() < 0.3;
    for (let s = 0; s < seg; s++) {
      const f = (s + 0.5) / seg;
      // up and out, then drooping
      const px = x + ux * L * f, pd = d - uz * L * f * 0.8, py = y0 + H * 0.7 + L * (0.7 * f - 0.95 * f * f);
      const dir = [ux, 0.7 - 1.9 * f, uz];
      const qq = quatXTo(dir[0], dir[1], dir[2]);
      let c = torn && f > 0.5 ? [0.4, 0.4, 0.2] : mix3(C.banana, [0.3, 0.42, 0.13], rng() * 0.5);
      c = shade(c, ux * 0.3, 0.8, uz * 0.5 + 0.3, 0.6, 0.45);
      out(px, py, -pd, L / seg * 0.75, 0.04, 0.22 * (1 - 0.4 * Math.abs(f - 0.5)), c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], kind);
    }
    if (out.due()) yield;
  }
}

// A broad, dark-crowned tree: camphor (domed) or banyan (wide, low, several trunks).
//   opts: { height, crown (width), rng, n, y, kind, banyan, color }
export function* broadCrown(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 12, Wc = opts.crown || H * 1.1;
  const y0 = opts.y != null ? opts.y : groundY(ctx, x, d) - 0.2;
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const n = Math.max(4, Math.round(opts.n || treeSplats(out, d, Wc) * 0.9));
  const col = opts.color || C.camphor;
  const trunks = opts.banyan ? 2 + Math.floor(rng() * 3) : 1;
  if (n >= 12) {
    for (let t = 0; t < trunks; t++) {
      const tx = x + (trunks > 1 ? (rng() - 0.5) * Wc * 0.45 : 0);
      yield* stick(ctx, out, tx, y0, d, H * 0.45, Math.max(0.15, H * 0.03), { color: [0.2, 0.18, 0.15], kind, n: 3 });
    }
  }
  const lumps = n < 20 ? 1 : 4 + Math.floor(rng() * 3);
  const crownY = y0 + H * (opts.banyan ? 0.68 : 0.62);
  for (let i = 0; i < lumps; i++) {
    const f = lumps === 1 ? 0 : (i / (lumps - 1) - 0.5);
    const lx = x + f * Wc * 0.62 + (rng() - 0.5) * Wc * 0.1, lz = d + (rng() - 0.5) * Wc * 0.25;
    const ly = crownY + (rng() - 0.3) * H * 0.14 - Math.abs(f) * H * 0.22;
    const lr = Wc * (lumps === 1 ? 0.5 : 0.3 + 0.07 * rng());
    yield* blob(ctx, out, lx, ly, lz, lr, Math.min(lr * (opts.banyan ? 0.62 : 0.85), H * 0.32), lr, { n: Math.round(n / lumps), color: jitter(col, rng, 0.1), rng, kind, inner: 0.45, amb: 0.55 });
  }
}

// A village house of grey brick or white plaster under a dark grey tiled roof with a gentle curve,
// a dark ridge with slightly raised ends, and a dark line under the eaves. Both end walls and both
// roof pitches are drawn, and the front, the sunlit end and the shaded end get clearly different
// tones, so the corners read from either side as the train passes.
//   opts: { w (along the ridge), depth, storeys, wall, roof, yaw, rng, s, y, lit (0..1), court }
export function* tiledHouse(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const w = opts.w || 10, dep = opts.depth || 7.5, st = opts.storeys || 2;
  const h = st * 2.9 + 0.3, rh = opts.roofH || dep * 0.27;
  const yaw = opts.yaw || 0, q = quatYaw(yaw);
  const wall = opts.wall || WALLS[0], roof = opts.roof || C.tile;
  const s = opts.s || Math.max(0.14, detail(out, d, 1.05));
  const kind = opts.kind != null ? opts.kind : KIND.BUILDING;
  const lit = opts.lit || 0;
  const base = (opts.y != null ? opts.y : groundY(ctx, x, d)) - 0.3;
  const ex = Math.cos(yaw), ez = -Math.sin(yaw);       // along the front
  const fx = Math.sin(yaw), fz = Math.cos(yaw);        // out of the front, toward the camera at yaw 0
  const Pt = (lx, ly, lz) => [x + ex * lx + fx * lz, base + ly, -d + ez * lx + fz * lz];
  const hh = h + 0.3;
  const win = [0.12, 0.11, 0.1], door = [0.2, 0.14, 0.1];
  const lightOf = (i, j) => lit > 0 && ((hashInts(opts.seed || 1, i, j) & 1023) / 1023) < lit;
  // front (and back, cheap and dark, for when the camera sees round)
  const front = faceTone(wall, fx, fz);
  const cols = Math.max(2, Math.floor(w / 2.6));
  yield* panel(out, Pt(-w / 2, 0, dep / 2), [ex, 0, ez], [0, 1, 0], w, hh, s, (a, b) => {
    const y = b * hh;
    if (y > hh - 0.45) return mul3(front, 0.5);                    // shadow under the eaves
    if (y < 0.5) return mul3(front, 0.72);                          // plinth
    const fs = (y - 0.3) / 2.9, iy = fs - Math.floor(fs), row = Math.floor(fs);
    const fxx = a * cols, ix = fxx - Math.floor(fxx), col = Math.floor(fxx);
    if (row === 0 && col === Math.floor(cols / 2) && ix > 0.25 && ix < 0.75 && iy > 0.08 && iy < 0.78) return door;
    if (ix > 0.34 && ix < 0.66 && iy > 0.35 && iy < 0.72) return lightOf(row, col) ? { c: LIT, light: true } : win;
    return jitter(front, rng, 0.03);
  }, q, kind, rng);
  // A house standing end-on to the line shows its back to a train coming from one side: without a
  // back wall the train would look into an open box until it had passed.
  if (Math.cos(yaw) < 0.78) {
    const back = faceTone(wall, -fx, -fz);
    yield* panel(out, Pt(-w / 2, 0, -dep / 2), [ex, 0, ez], [0, 1, 0], w, hh, s, (a, b) => {
      const y = b * hh;
      if (y > hh - 0.45) return mul3(back, 0.5);
      if (y < 0.5) return mul3(back, 0.72);
      return jitter(back, rng, 0.03);
    }, q, kind, rng);
  }
  // end walls with the gable triangle
  const qs = quatMul(q, quatYaw(Math.PI / 2));
  for (const sg of [-1, 1]) {
    const tone = faceTone(wall, sg * ex, sg * ez);
    yield* panel(out, Pt(sg * w / 2, 0, dep / 2), [-fx, 0, -fz], [0, 1, 0], dep, hh + rh, s, (a, b) => {
      const y = b * (hh + rh);
      if (y > hh && Math.abs(a - 0.5) * 2 > 1 - (y - hh) / rh) return null;
      if (y > hh - 0.4 && y < hh + 0.1) return mul3(tone, 0.55);
      if (y < 0.5) return mul3(tone, 0.72);
      if (st > 1 && Math.abs(a - 0.5) < 0.08 && y > 3.6 && y < 4.6) return lightOf(9 + sg, 0) ? { c: LIT, light: true } : win;
      return jitter(tone, rng, 0.03);
    }, qs, kind, rng);
  }
  // the roof: front pitch (toward the camera) and back pitch, concave, eave corners lifting a little
  const ov = 0.45, pitch = Math.atan2(rh, dep / 2);
  const slope = Math.hypot(rh, dep / 2) + ov;
  for (const side of [1, -1]) {
    const qr = quatMul(q, quatPitch(side * -(Math.PI / 2 - pitch)));
    const nrm = [fx * side * Math.sin(pitch), Math.cos(pitch), fz * side * Math.sin(pitch)];
    const rc = shade(roof, nrm[0], nrm[1], nrm[2], 0.62, 0.45);
    const nu = Math.max(1, Math.round((w + 2 * ov) / (s * 1.5))), nv = Math.max(1, Math.round(slope / (s * 1.5)));
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = (i + 0.5) / nu, b = (j + 0.5) / nv;
        const lx = -w / 2 - ov + a * (w + 2 * ov);
        const lz = side * (dep / 2 + ov) * (1 - b);
        const ly = hh - 0.15 + rh * Math.pow(b, 1.35) * ((dep / 2 + ov) / (dep / 2)) + 0.3 * Math.pow(Math.abs(2 * a - 1), 6) * (1 - b);
        const c = jitter(b < 1 / nv + 0.01 ? mul3(rc, 0.7) : rc, rng, 0.05);
        const [px, py, pz] = Pt(lx, ly, lz);
        out.q(px, py, pz, (w + 2 * ov) / nu * 0.62, slope / nv * 0.62, s * 0.12, c, 1, qr, kind);
      }
      if (out.due()) yield;
    }
  }
  // ridge: a dark line along the top, its ends turned up; dark eave edge at the front
  const rs = Math.max(0.12, s * 0.6);
  const nr = Math.max(2, Math.round((w + 2 * ov) / (rs * 1.4)));
  for (let i = 0; i < nr; i++) {
    const a = (i + 0.5) / nr, lx = -w / 2 - ov + a * (w + 2 * ov);
    const up = 0.45 * Math.pow(Math.abs(2 * a - 1), 8);
    const [px, py, pz] = Pt(lx, hh + rh + 0.1 + up, 0);
    out.q(px, py, pz, (w + 2 * ov) / nr * 0.7, rs * 1.1, rs, C.ridge, 1, q, kind);
    const [ex2, ey2, ez2] = Pt(lx, hh - 0.12, dep / 2 + ov);
    out.q(ex2, ey2, ez2, (w + 2 * ov) / nr * 0.7, rs * 0.7, rs * 0.7, C.ridge, 1, q, kind);
  }
  // verges: dark edges of the roof over each gable
  const nvg = Math.max(2, Math.round(slope / (rs * 1.4)));
  for (const sg of [-1, 1]) {
    for (const side of [1, -1]) {
      for (let j = 0; j < nvg; j++) {
        const b = (j + 0.5) / nvg;
        const [px, py, pz] = Pt(sg * (w / 2 + ov), hh - 0.1 + rh * Math.pow(b, 1.35), side * (dep / 2 + ov) * (1 - b));
        out(px, py, pz, rs * 0.8, rs * 0.8, slope / nvg * 0.7, C.ridge[0], C.ridge[1], C.ridge[2], 1, q[0], q[1], q[2], q[3], kind);
      }
    }
  }
  if (out.due()) yield;
  // a courtyard wall in front, with a tiled cap and a gate gap
  if (opts.court) {
    const cw = w + 4, cd = dep / 2 + 3.5, ch = 2.1;
    const ct = faceTone(WALLS[3], fx, fz);
    yield* panel(out, Pt(-cw / 2, 0, cd), [ex, 0, ez], [0, 1, 0], cw, ch, s, (a, b) => {
      if (Math.abs(a - 0.6) < 0.08 && b < 0.92) return null;
      return b > 0.85 ? mul3(roof, 0.7) : jitter(ct, rng, 0.04);
    }, q, kind, rng);
    for (const sg of [-1, 1]) {
      const tone = faceTone(WALLS[3], sg * ex, sg * ez);
      yield* panel(out, Pt(sg * cw / 2, 0, cd), [-fx, 0, -fz], [0, 1, 0], cd - dep / 2, ch, s, (a, b) => (b > 0.85 ? mul3(roof, 0.7) : jitter(tone, rng, 0.04)), qs, kind, rng);
    }
  }
}

// A newer house of three or four storeys in plain concrete or white and pale tiles, with a flat
// roof and parapet, slab lines at each floor, a grid of windows, and often a stair head on the roof.
//   opts: { w, depth, storeys, wall, yaw, rng, s, y, lit, seed }
export function* concreteHouse(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const w = opts.w || 9, dep = opts.depth || 10, st = opts.storeys || 3;
  const fh = 3.1, h = st * fh + 0.9;
  const yaw = opts.yaw || 0, q = quatYaw(yaw), qs = quatMul(q, quatYaw(Math.PI / 2));
  const wall = opts.wall || CONCRETE_WALLS[0];
  const s = opts.s || Math.max(0.14, detail(out, d, 1.05));
  const kind = opts.kind != null ? opts.kind : KIND.BUILDING;
  const lit = opts.lit || 0;
  const base = (opts.y != null ? opts.y : groundY(ctx, x, d)) - 0.3;
  const ex = Math.cos(yaw), ez = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
  const Pt = (lx, ly, lz) => [x + ex * lx + fx * lz, base + ly, -d + ez * lx + fz * lz];
  const glass = rng() < 0.4 ? [0.22, 0.28, 0.34] : [0.13, 0.13, 0.14];
  const bare = rng() < 0.3;                         // an unfinished top floor in bare concrete
  const shop = rng() < 0.35;
  const cols = Math.max(2, Math.floor(w / 2.8));
  const lightOf = (i, j) => lit > 0 && ((hashInts(opts.seed || 2, i, j) & 1023) / 1023) < lit;
  const face = (tone, wn, sg) => (a, b) => {
    const y = b * h;
    let c = tone;
    if (bare && y > (st - 1) * fh + 0.3 && y < st * fh + 0.3) c = mul3(C.concrete, tone[0] / wall[0]);
    if (y > h - 0.9) return jitter(mul3(c, 1.02), rng, 0.02);                 // parapet
    const fl = (y - 0.3) / fh, iy = fl - Math.floor(fl), row = Math.floor(fl);
    if (iy < 0.07 || iy > 0.97) return mul3(c, 0.55);                         // floor slab shadow lines
    if (wn) {
      const fxx = a * wn, ix = fxx - Math.floor(fxx), col = Math.floor(fxx);
      if (row === 0 && shop && sg === 0) return iy < 0.8 ? [0.42, 0.42, 0.41] : c;   // roller-shutter shop front
      if (ix > 0.22 && ix < 0.78 && iy > 0.3 && iy < 0.78) return lightOf(row + sg * 10, col) ? { c: LIT, light: true } : glass;
    }
    return jitter(c, rng, 0.03);
  };
  yield* panel(out, Pt(-w / 2, 0, dep / 2), [ex, 0, ez], [0, 1, 0], w, h, s, face(faceTone(wall, fx, fz), cols, 0), q, kind, rng);
  // (and the back, for a house standing end-on to the line: see tiledHouse)
  if (Math.cos(yaw) < 0.78) yield* panel(out, Pt(-w / 2, 0, -dep / 2), [ex, 0, ez], [0, 1, 0], w, h, s, face(faceTone(wall, -fx, -fz), cols, 0), q, kind, rng);
  for (const sg of [-1, 1]) {
    yield* panel(out, Pt(sg * w / 2, 0, dep / 2), [-fx, 0, -fz], [0, 1, 0], dep, h, s, face(faceTone(wall, sg * ex, sg * ez), 2, sg), qs, kind, rng);
  }
  // parapet top edge and a stair head on the roof
  const top = shade(wall, 0, 1, 0.3, 0.5, 0.3);
  yield* panel(out, Pt(-w / 2, h, dep / 2), [ex, 0, ez], [-fx, 0, -fz], w, 0.3, s, () => mul3(top, 0.8), q, kind, rng);
  if (rng() < 0.6) {
    const sx = (rng() < 0.5 ? -1 : 1) * (w / 2 - 2);
    for (const [u, nx, nz, len] of [[0, fx, fz, 3], [1, ex, ez, 3], [-1, -ex, -ez, 3]]) {
      const tone = faceTone(wall, nx, nz);
      if (u === 0) yield* panel(out, Pt(sx - 1.5, h, 1.5), [ex, 0, ez], [0, 1, 0], len, 2.5, s, () => jitter(tone, rng, 0.03), q, kind, rng);
      else yield* panel(out, Pt(sx + u * 1.5, h, 1.5), [-fx, 0, -fz], [0, 1, 0], len, 2.5, s, () => jitter(tone, rng, 0.03), qs, kind, rng);
    }
  }
}

// Rice terraces stepping up a low hill: contour-following narrow panels with dark risers, each
// panel's lip a pale line of water or a green line of rice. Wooded or bamboo-capped on top.
//   opts: { radius (in x), radiusD (in d), height, rng, n, y, kind }
export function* terraceHill(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const R = opts.radius || 150, Rd = opts.radiusD || R * 0.6, Hh = opts.height || 40;
  const y0 = opts.y != null ? opts.y : groundY(ctx, x, d) - 0.3;
  const kind = opts.kind != null ? opts.kind : KIND.GROUND;
  const n = Math.max(40, Math.round(opts.n || 2000));
  const step = 2.2 + 0.8 * rng();
  const levels = Math.max(3, Math.floor(Hh / step));
  const salt = Math.floor(rng() * 60000);
  // the hillside's own folds: spurs and hollows that every contour follows, so the terraces curve
  const lump = (a, hk) => 1 + 0.12 * Math.sin(a * 2 + salt) + 0.08 * Math.sin(a * 5 + salt * 0.7) + 0.1 * (noise2(a * 2.2, hk / 9, salt) - 0.5);
  const eAt = (hk) => Math.sqrt(Math.max(0, 1 - Math.pow(hk / Hh, 1.25)));
  let tot = 0;
  for (let k = 0; k < levels; k++) tot += eAt(k * step);
  const AM = 1.9;
  for (let k = 0; k < levels; k++) {
    const hk = k * step, e = eAt(hk), e2 = eAt(hk + step);
    const m = Math.max(3, Math.round(n * 0.85 * e / tot / 2));    // each sample: a riser and a lip
    // (opts.tea: a tea garden, each terrace a clipped dark hedge of bushes over a line of red soil)
    const tea = !!opts.tea, water = !tea && (hashInts(salt, k) & 3) !== 0;
    const lipC = tea ? [0.15, 0.33, 0.12] : water ? C.paddyWater : C.youngRice;
    const ringL = 2 * AM * R * e;
    const sx = Math.max(0.3, ringL / m * 0.75);
    for (let i = 0; i < m; i++) {
      const a = (i + rng()) / m * 2 * AM - AM;
      const lu = lump(a, hk);
      const px = x + Math.sin(a) * R * e * lu, pd = d - Math.cos(a) * Rd * e * lu;
      const nx = Math.sin(a), nz = Math.cos(a);
      const qq = quatYaw(a);
      // the riser: a grassy, shaded bank
      const cr = jitter(shade(tea ? mix3([0.12, 0.24, 0.09], [0.44, 0.3, 0.2], rng() < 0.3 ? 0.8 : 0) : mix3([0.18, 0.26, 0.1], [0.3, 0.28, 0.2], rng() * 0.4), nx, 0.15, nz, 0.5, 0.6), rng, 0.08);
      out.q(px, y0 + hk + step * 0.5, -pd, sx, step * 0.5, Math.max(0.2, sx * 0.2), cr, 1, qq, kind);
      // the lip of the panel above it (and a little of the panel surface behind)
      const c = jitter(shade(lipC, nx * 0.2, 1, nz * 0.2, 0.75, 0.3), rng, 0.05);
      const pw = (e - e2) * Rd * lu;
      out.q(px - Math.sin(a) * pw * 0.3, y0 + hk + step * 0.98, -(pd + Math.cos(a) * pw * 0.3), sx, Math.max(0.12, step * (tea ? 0.2 : 0.07)), Math.max(0.3, pw * 0.5), c, 1, qq, kind);
      if (out.due()) yield;
    }
  }
  // trees on the crown
  const top = y0 + levels * step;
  // the wooded crown: splats no bigger than fine detail, so its top is a clean line of tree tops
  // (a hill's crown is a mass, not a tree: KIND.HEDGE keeps it still on the beat)
  const crx = R * eAt(levels * step) * 0.8 + 6, crz = Rd * 0.3 + 4, cs = Math.max(0.3, detail(out, d, 0.9));
  const nT = Math.round(clamp(2.5 * (crx * 5 + 5 * crz + crx * crz) / (cs * cs) * 0.5, 24, 1500 * out.density + 24));
  yield* blob(ctx, out, x, top + Math.max(2, Hh - levels * step) * 0.5 + 3, d, crx, 5, crz, { n: nT, size: cs, color: C.camphor, rng, kind: KIND.HEDGE, inner: 0.3 });

}

// A pagoda: a slender, tapering tower of 5-7 tiers, each with a small dark eave turned up at the
// corners, and a finial. Pale plastered body with dark openings. `wrong` (0..1) for the logic dial.
//   opts: { height, tiers, rng, y, kind, s, lean, color }
export function* pagoda(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 30, tiers = opts.tiers || 6;
  const y0 = opts.y != null ? opts.y : groundY(ctx, x, d);
  const kind = opts.kind != null ? opts.kind : KIND.BUILDING;
  const s = opts.s || Math.max(0.12, detail(out, d, 1.0));
  const body = opts.color || [0.66, 0.63, 0.56];
  const lean = opts.lean || 0;
  const B = H * 0.13;                     // base half-width
  const bodyH = H * 0.86;
  let y = y0;
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers;
    const hw = B * (1 - 0.5 * f), th = (bodyH / tiers) * (1.15 - 0.3 * f);
    const cx = x + lean * (y - y0);
    // octagonal body: the faces seen from anywhere along the line (it was only the camera-facing
    // half, so the tower lost its far flank whenever it stood off to one side of the window)
    const nu = Math.max(4, Math.round((hw * 4.6) / (s * 1.4))), nv = Math.max(2, Math.round(th / (s * 1.4)));
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = ((i + 0.5) / nu - 0.5) * 5.0;
        const b = (j + 0.5) / nv;
        const nx = Math.sin(a), nz = Math.cos(a);
        let c = faceTone(body, nx, nz);
        if (Math.abs(a) < 0.25 && b > 0.3 && b < 0.75) c = [0.12, 0.11, 0.1];     // arched opening
        out(cx + nx * hw, y + b * th, -(d - nz * hw), Math.max(s, hw * 1.2 / nu), th / nv * 0.62, s * 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
      }
    }
    // the eave: a dark flared ring, turned up at its corners
    const ew = hw * 1.75, ey = y + th;
    const ne = Math.max(8, Math.round((ew * 5) / (s * 1.2)));
    for (let i = 0; i < ne; i++) {
      const a = ((i + 0.5) / ne - 0.5) * 5.0;
      const corner = Math.pow(Math.abs(Math.cos(a * 4 / 2)), 10);
      const c = shade(C.tile, Math.sin(a) * 0.4, 0.8, Math.cos(a) * 0.6, 0.55, 0.4);
      out(cx + Math.sin(a) * ew, ey - th * 0.05 + corner * th * 0.22, -(d - Math.cos(a) * ew), Math.max(s, ew * 5 / ne * 0.6), Math.max(0.1, th * 0.08), Math.max(s, ew * 0.25), c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
    y += th * 1.04;
    if (out.due()) yield;
  }
  // finial
  yield* stick(ctx, out, x + lean * (y - y0), y, d, H - (y - y0) + 1, Math.max(0.12, B * 0.12), { color: [0.22, 0.2, 0.18], kind, n: 4 });
}

// A small open pavilion: four dark posts under a dark tiled roof with upturned corners.
//   opts: { size, rng, y, kind, s }
export function* pavilion(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const S = opts.size || 5;
  const y0 = opts.y != null ? opts.y : groundY(ctx, x, d);
  const kind = opts.kind != null ? opts.kind : KIND.BUILDING;
  const s = opts.s || Math.max(0.1, detail(out, d, 1.0));
  for (const [px, pz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) yield* stick(ctx, out, x + px * S * 0.4, y0, d + pz * S * 0.4, S * 0.6, Math.max(0.12, s * 0.5), { color: [0.32, 0.17, 0.12], kind, n: 3 });
  const n = Math.max(8, Math.round((S * S * 3) / (s * s * 2)));
  for (let i = 0; i < n; i++) {
    const u = rng() * 2 - 1, v = rng() * 2 - 1;
    const m = Math.max(Math.abs(u), Math.abs(v));
    const corner = Math.pow(Math.min(Math.abs(u), Math.abs(v)) * (m > 0.85 ? 1 : 0), 2);
    const py = y0 + S * 0.6 + (1 - m) * S * 0.4 + corner * S * 0.15;
    const c = shade(C.tile, u * 0.3, 0.8, -v * 0.3 + 0.3, 0.6, 0.4);
    out(x + u * S * 0.7, py, -(d + v * S * 0.7), Math.max(s, S * 0.15), Math.max(0.1, s * 0.4), Math.max(s, S * 0.15), c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    if (out.due()) yield;
  }
}

// A small arched stone bridge carrying a lane over a stream; the arch's face looks at the camera.
//   opts: { span, rng, y, kind, s }
export function* archBridge(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const span = opts.span || 6, Wd = 3.2;
  const y0 = opts.y != null ? opts.y : groundY(ctx, x, d) - 0.4;
  const kind = opts.kind != null ? opts.kind : KIND.BUILDING;
  const s = opts.s || Math.max(0.1, detail(out, d, 1.0));
  const rise = span * 0.42, len = span + 6;
  const stone = [0.55, 0.54, 0.5];
  const deck = (u) => y0 + rise + 0.6 - 0.9 * Math.pow(Math.abs(u) / (len / 2), 2) * (rise);      // a humped deck
  const nu = Math.max(4, Math.round(len / (s * 1.3))), nv = Math.max(3, Math.round((rise + 1) / (s * 1.3)));
  for (const fz of [Wd / 2, -Wd / 2]) {
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const u = ((i + 0.5) / nu - 0.5) * len;
        const top = deck(u), yy = y0 + ((j + 0.5) / nv) * (top - y0);
        // the arch opening: a semicircle of radius span/2
        const ar = (u * u) / ((span / 2) ** 2) + ((yy - y0) ** 2) / (rise * rise);
        if (ar < 1) { if (ar > 0.8 && fz > 0) { const c = mul3(stone, 0.5); out(x + u, yy, -(d - fz), s, s, s * 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind); } continue; }
        let c = faceTone(stone, 0, fz > 0 ? 1 : -1);
        c = jitter(mul3(c, 0.9 + 0.15 * noise2(u, yy * 2, 77)), rng, 0.06);
        out(x + u, yy, -(d - fz), len / nu * 0.62, (top - y0) / nv * 0.62, s * 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
      }
      if (out.due()) yield;
    }
  }
  // the arch's soffit spanning between the two faces (seen through the opening from either side:
  // without it the arch was two cut-out cards with nothing between them), and both ends
  const na = Math.max(6, Math.round(Math.PI * span / 2 / (s * 1.3)));
  for (let i = 0; i < na; i++) {
    const a = (i + 0.5) / na * Math.PI, u = Math.cos(a) * span / 2, yy = y0 + Math.sin(a) * rise;
    const c = mul3(stone, 0.32 + 0.12 * Math.sin(a));
    out(x + u, yy, -d, Math.max(s, span / 2 * Math.PI / na * 0.62), Math.max(s, rise * Math.PI / na * 0.5), Wd / 2, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
  }
  for (const sg of [-1, 1]) {
    const c = faceTone(stone, sg, 0), h = deck(sg * len / 2) - y0;
    for (let j = 0; j < Math.max(1, Math.round(h / (s * 1.3))); j++) out(x + sg * len / 2, y0 + (j + 0.5) * h / Math.max(1, Math.round(h / (s * 1.3))), -d, s * 0.3, Math.max(s, h / Math.max(1, Math.round(h / (s * 1.3))) * 0.62), Wd / 2, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
  }
  // the shadowed underside seen through the arch, and the parapet top
  for (let i = 0; i < nu; i++) {
    const u = ((i + 0.5) / nu - 0.5) * len;
    const c = shade(stone, 0, 1, 0.2, 0.6, 0.4);
    out(x + u, deck(u) + 0.35, -(d - Wd / 2), len / nu * 0.6, 0.3, 0.2, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
  }
}

// ---------------------------------------------------------------------------------------------
// People and working animals. Drawn larger than life (people 1.5 times, buffalo 1.6 times, and
// larger again beyond 90 m) so that they read from a moving train; a fixed handful of shaped
// splats each, whatever the budget; limbs, poles, cords and horns are struts sized from distance.
// Every splat is tagged MOVE.BEAT. Each figure is built in its own frame: u along its heading,
// h up, v to its left, in life-size metres times the frame's scale.
// ---------------------------------------------------------------------------------------------
const BEAT = MOVE.BEAT, KO = KIND.OTHER;
const PK = 1.5, BK = 1.6;
const farK = (d) => 1 + 0.45 * smooth(45, 170, d);
const CLOTH = [[0.16, 0.22, 0.42], [0.76, 0.75, 0.7], [0.66, 0.22, 0.18], [0.3, 0.45, 0.62], [0.46, 0.43, 0.28], [0.11, 0.11, 0.13], [0.72, 0.42, 0.46], [0.74, 0.6, 0.2]];
const KIDS = [[0.72, 0.2, 0.16], [0.76, 0.66, 0.2], [0.78, 0.78, 0.74], [0.25, 0.42, 0.7], [0.74, 0.4, 0.5]];
const SKIN = [[0.6, 0.44, 0.33], [0.52, 0.37, 0.27], [0.66, 0.5, 0.38]];
const STRAW = [0.77, 0.68, 0.43], WICKER = [0.6, 0.5, 0.3], WOOD = [0.36, 0.28, 0.2];
const LOADS = [[0.3, 0.5, 0.2], [0.74, 0.64, 0.32], [0.64, 0.2, 0.14], [0.7, 0.7, 0.66], [0.76, 0.46, 0.12]];
const pick = (list, r) => list[Math.min(list.length - 1, Math.floor(r() * list.length))];
// for scripts that look for them (as tropics.js does)
function note(ctx, what, wx, d) { const log = globalThis.__karstLog; if (log && wx >= ctx.x0 && wx < ctx.x0 + ctx.length) log.push({ what, wx, d }); }

// x is chunk-local; yaw 0 faces +x (the way the train runs), pi/2 faces away from the line.
function frame(x, y, d, yaw, k) {
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  return { x, y, d, yaw, k, ca, sa, thin: Math.max(0.035, 0.0007 * d), P: (u, h, v = 0) => [x + (u * ca - v * sa) * k, y + h * k, -(d + (u * sa + v * ca) * k)] };
}
// A frame standing at (u, v) of frame f, h above its base, turned by `turn`, at scale k.
function sub(f, u, v, k = f.k, turn = 0, h = 0) { return frame(f.x + (u * f.ca - v * f.sa) * f.k, f.y + h * f.k, f.d + (u * f.sa + v * f.ca) * f.k, f.yaw + turn, k); }
// An ellipsoid: ru along the heading (tilted up by `pitch`), rh up, rv across.
function ell(out, f, u, h, v, ru, rh, rv, c, pitch = 0, move = BEAT, kind = KO) {
  const p = f.P(u, h, v), cp = Math.cos(pitch), q = quatXTo(f.ca * cp, Math.sin(pitch), -f.sa * cp);
  out(p[0], p[1], p[2], ru * f.k, rh * f.k, rv * f.k, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind, move);
}
// A limb, pole or cord from a to b (points from f.P), r thick in life-size metres.
function lim(out, f, a, b, r, c, n = 2, move = BEAT) { strutM(out, a[0], a[1], a[2], b[0], b[1], b[2], Math.max(r * f.k, f.thin), c, n, KO, move); }
function ripple(out, x, y, d, rx, rz, c = [0.7, 0.73, 0.73], op = 0.6) { out(x, y + 0.03, -d, rx, 0.025, rz, c[0], c[1], c[2], op, 0, 0, 0, 1, KIND.GROUND); }

// A person. o: { pose: 'stand' | 'walk' | 'bent' (planting, double) | 'squat' | 'sit', arms: 'down' |
// 'swing' | 'fwd' | 'up' | 'low' | 'pole', hat (a conical straw hat; default yes for adults), wade
// (metres of leg under water or crop, not drawn), seat (sitting height), shirt, child }
function person(out, f, r, o = {}) {
  const pose = o.pose || 'stand', wade = o.wade || 0;
  const shirt = o.shirt || pick(o.child ? KIDS : CLOTH, r), trous = r() < 0.7 ? [0.13, 0.14, 0.18] : [0.3, 0.3, 0.34], skin = pick(SKIN, r);
  const hat = o.hat != null ? o.hat : !o.child, hd = o.child ? 1.25 : 1;
  const L = (a, b, c, rr = 0.065) => lim(out, f, a, b, rr, c);
  if (pose === 'bent') {
    for (const v of [-0.1, 0.1]) L(f.P(0, 0.84, v), f.P(0.03, wade, v * 1.15), trous);
    ell(out, f, 0.26, 0.94, 0, 0.31, 0.17, 0.18, shirt, 0.3);
    for (const v of [-0.16, 0.16]) L(f.P(0.47, 0.98, v), f.P(0.62, Math.max(wade, 0.05) + 0.1, v * 0.7), mul3(shirt, 0.88), 0.045);
    ell(out, f, 0.66, 0.99, 0, 0.105 * hd, 0.105 * hd, 0.105 * hd, skin);
    if (hat) { ell(out, f, 0.73, 1.07, 0, 0.055, 0.3, 0.3, STRAW, 0.75); ell(out, f, 0.79, 1.13, 0, 0.1, 0.14, 0.14, mul3(STRAW, 0.9), 0.75); }
    else ell(out, f, 0.68, 1.05, 0, 0.11, 0.08, 0.11, [0.08, 0.07, 0.07]);
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
  const sy = hip + 0.55, hy = hip + 0.72 + 0.02 * hd, arms = o.arms || (pose === 'walk' ? 'swing' : 'down'), sleeve = mul3(shirt, 0.88);
  for (const sg of [-1, 1]) {
    let b;
    if (arms === 'fwd') b = f.P(0.42, sy - 0.38, sg * 0.14);
    else if (arms === 'up') b = f.P(0.1, sy + 0.42, sg * 0.3);
    else if (arms === 'low') b = f.P(0.42, sy - 0.62, sg * 0.1);
    else if (arms === 'swing') b = f.P(sg * 0.17, sy - 0.47, sg * 0.23);
    else if (arms === 'pole' && sg > 0) b = f.P(0.3, sy + 0.04, 0.08);
    else b = f.P(0.04, sy - 0.48, sg * 0.24);
    L(f.P(0, sy, sg * 0.2), b, sleeve, 0.045);
  }
  ell(out, f, 0.02, hy, 0, 0.105 * hd, 0.11 * hd, 0.105 * hd, skin);
  if (hat) { ell(out, f, 0.02, hy + 0.12, 0, 0.3, 0.05, 0.3, STRAW); ell(out, f, 0.02, hy + 0.2, 0, 0.14, 0.08, 0.14, mul3(STRAW, 0.9)); }
  else ell(out, f, -0.01, hy + 0.07 * hd, 0, 0.11 * hd, 0.07 * hd, 0.11 * hd, [0.08, 0.07, 0.07]);
}
// A carrying pole across the shoulder with a basket hanging from each end (use arms: 'pole').
function shoulderPole(out, f, r, load = pick(LOADS, r)) {
  lim(out, f, f.P(-1.0, 1.45, 0.06), f.P(1.0, 1.45, 0.06), 0.022, [0.5, 0.42, 0.26], 3);
  for (const e of [-1, 1]) {
    for (const s of [-0.15, 0.15]) lim(out, f, f.P(e, 1.45, 0.06), f.P(e + s, 0.86, 0.06), 0.012, [0.3, 0.27, 0.2], 1);
    ell(out, f, e, 0.7, 0.06, 0.21, 0.15, 0.21, WICKER);
    ell(out, f, e, 0.88, 0.06, 0.17, 0.1, 0.17, load);
  }
}

// A water buffalo: a heavy slate-grey body with a deep belly, the head carried low and forward,
// and the great crescent horns swept back over the neck. o: { pose: 'stand' | 'graze' | 'wallow'
// (only the back, the head and the horns above the water), wade, egret, col }
function buffalo(out, f, r, o = {}) {
  const pose = o.pose || 'stand', wade = o.wade || 0;
  const base = o.col || jitter([0.22, 0.21, 0.21], r, 0.12), hi = [base[0] * 1.5 + 0.04, base[1] * 1.5 + 0.04, base[2] * 1.5 + 0.05], lo = mul3(base, 0.72);
  const horns = (u, h, bu, bh) => {       // from the poll, sweeping out and back along (bu, bh)
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
  ell(out, f, -1.04, 0.46, 0, 0.07, 0.11, 0.07, lo);
  if (o.egret) egret(out, sub(f, -0.3, 0, 1.7 * f.k / BK, 0, 1.3));
}
// A white egret (frame scale about 1.7).
function egret(out, f) {
  const w = [0.8, 0.8, 0.77];
  for (const v of [-0.04, 0.04]) lim(out, f, f.P(0, 0.5, v), f.P(0.02, 0, v), 0.012, [0.14, 0.14, 0.12], 1);
  ell(out, f, -0.03, 0.6, 0, 0.21, 0.1, 0.1, w, 0.45);
  lim(out, f, f.P(0.12, 0.68, 0), f.P(0.2, 0.95, 0), 0.03, w, 1);
  ell(out, f, 0.21, 1.0, 0, 0.055, 0.045, 0.045, w);
  lim(out, f, f.P(0.24, 1.0, 0), f.P(0.4, 0.96, 0), 0.014, [0.78, 0.6, 0.16], 1);
}
// A duck on the water (frame scale about 1.8).
function duck(out, f, c) {
  ell(out, f, 0, 0.11, 0, 0.2, 0.1, 0.13, c);
  ell(out, f, 0.19, 0.27, 0, 0.065, 0.065, 0.065, c);
  ell(out, f, 0.28, 0.25, 0, 0.05, 0.022, 0.035, [0.78, 0.5, 0.12]);
}
// A fishing cormorant, upright, hooked bill; `spread` holds its wings out to dry.
function cormorant(out, f, spread) {
  const c = [0.07, 0.07, 0.08];
  ell(out, f, 0, 0.32, 0, 0.21, 0.1, 0.1, c, 1.15);
  lim(out, f, f.P(0.07, 0.5, 0), f.P(0.1, 0.74, 0), 0.035, c, 1);
  ell(out, f, 0.13, 0.77, 0, 0.06, 0.05, 0.05, c);
  lim(out, f, f.P(0.15, 0.77, 0), f.P(0.31, 0.8, 0), 0.016, [0.62, 0.55, 0.3], 1);
  if (spread) for (const sg of [-1, 1]) ell(out, f, -0.02, 0.44, sg * 0.3, 0.05, 0.14, 0.26, c);
}
// A spoked wheel in the figure's own plane, v off its centre line.
function wheel(out, f, u, h, v, R, c, spokes = 3) {
  let a = f.P(u + R, h, v);
  for (let i = 1; i <= 8; i++) { const t = (i / 8) * 2 * Math.PI, b = f.P(u + R * Math.cos(t), h + R * Math.sin(t), v); lim(out, f, a, b, 0.05, c, 1); a = b; }
  for (let i = 0; i < spokes; i++) { const t = (i * Math.PI) / spokes + 0.3; lim(out, f, f.P(u - R * Math.cos(t), h - R * Math.sin(t), v), f.P(u + R * Math.cos(t), h + R * Math.sin(t), v), 0.025, c, 2); }
}
// A cyclist; `load` straps a bundle on the rack; at night the lamp is lit.
function* cyclist(ctx, out, f, r, load, night) {
  const fc = [0.12, 0.12, 0.13];
  wheel(out, f, -0.52, 0.34, 0, 0.34, fc); wheel(out, f, 0.52, 0.34, 0, 0.34, fc);
  for (const [a, b] of [[[-0.52, 0.34], [-0.18, 0.9]], [[-0.18, 0.9], [0.36, 0.86]], [[0.36, 0.86], [0.52, 0.34]], [[-0.18, 0.9], [0.02, 0.32]], [[0.02, 0.32], [0.36, 0.86]], [[-0.52, 0.34], [0.02, 0.32]], [[0.36, 0.86], [0.34, 1.06]]]) lim(out, f, f.P(a[0], a[1], 0), f.P(b[0], b[1], 0), 0.02, fc, 1);
  const shirt = pick(CLOTH, r), trous = [0.14, 0.14, 0.18], skin = pick(SKIN, r);
  lim(out, f, f.P(-0.18, 0.98, 0.09), f.P(0.14, 0.7, 0.1), 0.065, trous); lim(out, f, f.P(0.14, 0.7, 0.1), f.P(0.04, 0.22, 0.1), 0.06, trous);
  lim(out, f, f.P(-0.18, 0.98, -0.09), f.P(0.1, 0.78, -0.1), 0.065, mul3(trous, 0.8)); lim(out, f, f.P(0.1, 0.78, -0.1), f.P(-0.02, 0.44, -0.1), 0.06, mul3(trous, 0.8));
  ell(out, f, -0.1, 1.28, 0, 0.3, 0.17, 0.19, shirt, 1.25);
  for (const sg of [-1, 1]) lim(out, f, f.P(-0.02, 1.5, sg * 0.2), f.P(0.34, 1.08, sg * 0.2), 0.045, mul3(shirt, 0.88));
  ell(out, f, 0.04, 1.68, 0, 0.105, 0.11, 0.105, skin);
  if (r() < 0.75) { ell(out, f, 0.04, 1.8, 0, 0.3, 0.05, 0.3, STRAW); ell(out, f, 0.04, 1.88, 0, 0.14, 0.08, 0.14, mul3(STRAW, 0.9)); }
  else ell(out, f, 0.02, 1.76, 0, 0.11, 0.07, 0.11, [0.08, 0.07, 0.07]);
  if (load) { const c = pick(LOADS, r); ell(out, f, -0.62, 1.08, 0, 0.26, 0.22, 0.3, c); ell(out, f, -0.6, 1.4, 0, 0.2, 0.14, 0.24, mul3(c, 0.85)); }
  if (night) { const p = f.P(0.5, 0.95, 0); yield* lamp(ctx, out, p[0], p[1], -p[2], [1, 0.9, 0.62], { size: 0.1, halo: 1 }); }
}
// A two-wheeled cart: a flat bed between spoked wheels, shafts forward, a load on it. The bed is
// at u 0, the shafts run forward to u = `reach` at height `sh`.
function cart(out, f, r, R, reach, sh, load) {
  for (const v of [-0.62, 0.62]) wheel(out, f, 0, R, v, R, v < 0 ? [0.2, 0.16, 0.12] : [0.3, 0.24, 0.17], 2);
  ell(out, f, -0.1, R + 0.12, 0, 0.95, 0.07, 0.5, WOOD);
  for (const v of [-0.42, 0.42]) lim(out, f, f.P(0.6, R + 0.12, v), f.P(reach, sh, v), 0.03, WOOD, 2);
  if (load) {
    const c = pick([[0.68, 0.56, 0.26], [0.3, 0.48, 0.2], [0.68, 0.66, 0.6], [0.5, 0.36, 0.22]], r);
    ell(out, f, -0.3, R + 0.45, 0, 0.6, 0.26, 0.42, c);
    ell(out, f, -0.35, R + 0.8, 0, 0.42, 0.2, 0.32, mul3(c, 1.08));
  }
}
// A dog trotting.
function dog(out, f, r) {
  const c = pick([[0.6, 0.45, 0.25], [0.2, 0.18, 0.16], [0.72, 0.7, 0.64]], r);
  for (const [u, v] of [[0.26, 0.07], [0.3, -0.07], [-0.26, 0.07], [-0.3, -0.07]]) lim(out, f, f.P(u, 0.34, v), f.P(u + 0.03, 0, v), 0.035, c, 1);
  ell(out, f, 0, 0.42, 0, 0.33, 0.14, 0.13, c);
  ell(out, f, 0.42, 0.55, 0, 0.14, 0.11, 0.1, c);
  lim(out, f, f.P(-0.33, 0.48, 0), f.P(-0.5, 0.72, 0), 0.03, c, 1);
}

// --- scenes in the paddies ---
function* paddyScene(ctx, out, s, r) {
  const x = s.wx - ctx.x0, kk = farK(s.d), pk = PK * kk, bk = BK * kk, t = s.pt;
  const wet = t === P.WATER || t === P.YOUNG || t === P.POND || t === P.LOTUS;
  const u = r();
  let what;
  if (t === P.WATER) what = u < 0.32 ? 'plough' : u < 0.6 ? 'plant' : u < 0.77 ? 'wallow' : u < 0.88 ? 'ducks' : 'herd';
  else if (t === P.YOUNG) what = u < 0.55 ? 'plant' : u < 0.82 ? 'weed' : 'herd';
  else if (t === P.RICE) what = 'weed';
  else if (t === P.MUD) what = u < 0.65 ? 'plough' : 'herd';
  else if (t === P.POND) what = u < 0.5 ? 'ducks' : 'wallow';
  else if (t === P.PASTURE) what = u < 0.82 ? 'herd' : 'carry';
  else if (t === P.LOTUS) what = 'lotus';
  else if (t === P.ORCHARD) what = 'pick';
  else what = u < 0.65 ? 'veg' : 'carry';
  if (what === 'plough' && s.hw < 6.5) what = wet ? 'wallow' : 'herd';
  note(ctx, what, s.wx, s.d);
  const side = () => (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.5;       // broadside to the window, more or less
  if (what === 'plough') {
    // a buffalo drawing a wooden plough through the flooded field, the farmer wading behind;
    // churned mud trails behind them, and egrets follow for what the plough turns up
    const wade = wet ? 0.22 : 0, yaw = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.25;
    const fb = frame(x + (r() - 0.5) * Math.max(0, s.hw - 6), s.y - wade * bk, s.d, yaw, bk);
    buffalo(out, fb, r, { wade });
    lim(out, fb, fb.P(0.62, 1.4, -0.3), fb.P(0.62, 1.4, 0.3), 0.04, WOOD, 1);                 // the yoke
    for (const v of [-0.3, 0.3]) lim(out, fb, fb.P(0.62, 1.36, v), fb.P(-1.5, 0.55 + wade, 0), 0.014, [0.3, 0.27, 0.2], 3);   // traces
    lim(out, fb, fb.P(-1.5, 0.55 + wade, 0), fb.P(-2.1, wade + 0.06, 0), 0.05, WOOD, 2);      // beam and share
    lim(out, fb, fb.P(-2.1, wade + 0.06, 0), fb.P(-2.45, 1.02 + wade, 0), 0.035, WOOD, 2);    // the handle
    const pp = fb.P(-2.85, 0, 0);
    person(out, frame(pp[0], s.y - wade * pk, -pp[2], yaw, pk), r, { pose: 'walk', arms: 'fwd', wade });
    const mud = wet ? [0.44, 0.42, 0.34] : [0.3, 0.25, 0.19];
    for (let j = 0; j < 4; j++) { const p = fb.P(-3.9 - j * 1.5, 0, 0); out(p[0], s.y + 0.05, p[2], 1.3 * bk, 0.03, 0.5 * bk, mud[0], mud[1], mud[2], 0.85, 0, 0, 0, 1, KIND.GROUND); }
    if (wet) { const p = fb.P(-0.6, 0, 0); ripple(out, p[0], s.y, -p[2], 2.6 * bk, 0.5 * bk); }
    const ne = Math.floor(r() * 3.5);
    for (let j = 0; j < ne; j++) { const p = fb.P(-4.2 - 1.6 * j - r(), 0, (r() - 0.5) * 2.2); egret(out, frame(p[0], s.y - (wet ? 0.1 : 0), -p[2], side(), 1.7 * kk)); }
  } else if (what === 'plant' || what === 'weed') {
    // a line of planters bent double, shin-deep, conical hats down; one now and then straightens up.
    // In front of each, the short bright rows just set
    const plant = what === 'plant', wade = plant ? 0.2 : 0.24, top = plant ? s.y : s.y + 0.2;
    const n = plant ? clamp(Math.round(s.hw / 1.3), 2, 6) : 1 + Math.floor(r() * 3), gap = Math.min(2.6, (2 * s.hw) / n);
    const face = r() < 0.4 ? -Math.PI / 2 : r() < 0.5 ? 0 : Math.PI;
    for (let i = 0; i < n; i++) {
      const px = x + (i - (n - 1) / 2) * gap * (plant ? 1 : 1.6) + (r() - 0.5) * 0.6, pd = s.d + (r() - 0.5) * (plant ? 1.6 : 4);
      const f = frame(px, top - wade * pk, pd, face + (r() - 0.5) * 0.7, pk), up = r() < (plant ? 0.22 : 0.45);
      person(out, f, r, { pose: up ? 'stand' : 'bent', wade });
      if (plant) {
        if (up) ell(out, f, 0.1, 0.92, 0.3, 0.1, 0.17, 0.1, [0.36, 0.56, 0.2]);
        ripple(out, px, s.y, pd, 0.9 * pk, 0.45);
        for (let j = 1; j <= 4; j++) for (const v of [-0.35, 0.35]) { const p = f.P(0.75 + j * 0.42, 0, v); out(p[0], s.y + 0.16, p[2], 0.07 * pk, 0.15, 0.07 * pk, 0.34, 0.56, 0.18, 1, 0, 0, 0, 1, KIND.GROUND); }
      }
    }
    if (!plant && r() < 0.3) {
      // a scarecrow: crossed poles, a ragged shirt and a straw hat
      const f = frame(x + s.hw * 0.6, s.y, s.d + 1.5, 0.3, pk);
      lim(out, f, f.P(0, 0, 0), f.P(0, 1.75, 0), 0.03, WOOD, 3); lim(out, f, f.P(-0.6, 1.4, 0), f.P(0.6, 1.4, 0), 0.03, WOOD, 2);
      const c = pick(CLOTH, r), p = f.P(0, 1.15, 0);
      out(p[0], p[1], p[2], 0.34 * pk, 0.3 * pk, 0.05, c[0], c[1], c[2], 1, 0, 0, 0, 1, KO, MOVE.FLAG);
      ell(out, f, 0, 1.78, 0, 0.3, 0.05, 0.3, STRAW); ell(out, f, 0, 1.86, 0, 0.14, 0.08, 0.14, mul3(STRAW, 0.9));
    }
  } else if (what === 'wallow' || what === 'herd') {
    // buffalo lying in the water with only back, head and horns showing; or standing about
    const n = t === P.PASTURE ? 2 + Math.floor(r() * 3.6) : what === 'herd' ? 1 + Math.floor(r() * 2.4) : 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const bx = x + (i - (n - 1) / 2) * 5.4 * kk + (r() - 0.5) * 1.5, bd = s.d + (i % 2 ? 1 : -1) * (0.8 + 2.2 * r());
      if (Math.abs(bx - x) > s.hw + 2) continue;
      const lie = what === 'wallow' && (i === 0 || r() < 0.7);
      if (lie) { buffalo(out, frame(bx, s.y - 0.02, bd, side(), bk), r, { pose: 'wallow', egret: r() < 0.3 }); ripple(out, bx, s.y, bd, 2.3 * bk, 0.55 * bk); }
      else {
        const wade = wet ? 0.28 : 0, calf = what === 'herd' && i === n - 1 && n > 1 && r() < 0.6, k = calf ? bk * 0.62 : bk;
        buffalo(out, frame(bx, s.y - wade * k, bd, side(), k), r, { wade, pose: wet || r() < 0.4 ? 'stand' : 'graze', egret: !calf && r() < 0.35 });
        if (wet) ripple(out, bx, s.y, bd, 1.9 * k, 0.5 * k);
      }
    }
    if (what === 'herd' && r() < 0.5) {
      // the herd child, sitting on the grass or standing in the water with a switch
      const f = frame(x + (n * 2.3 + 1.5) * kk * (r() < 0.5 ? -1 : 1), s.y - (wet ? 0.15 * pk * 0.66 : 0), s.d + 1, side(), pk * 0.66);
      person(out, f, r, { child: true, hat: r() < 0.5, pose: wet ? 'stand' : 'sit', seat: 0.12, wade: wet ? 0.15 : 0 });
    }
  } else if (what === 'ducks') {
    // a flock of ducks dabbling, and the duck herd wading after them with a long cane
    const n = 6 + Math.floor(r() * 6), dir = r() < 0.5 ? 0 : Math.PI, dk = 1.8 * kk, len = Math.min(s.hw, 7);
    for (let i = 0; i < n; i++) {
      const dx = x + (r() * 2 - 1) * len, dd = s.d + (r() - 0.5) * 3.5;
      duck(out, frame(dx, s.y, dd, dir + (r() - 0.5) * 1.2, dk), r() < 0.75 ? [0.8, 0.8, 0.76] : [0.42, 0.33, 0.22]);
    }
    ripple(out, x, s.y, s.d, len * 0.9, 1.6);
    if (r() < 0.65) {
      const f = frame(x - Math.cos(dir) * (len + 2.2), s.y - 0.2 * pk, s.d + 0.8, dir, pk);
      person(out, f, r, { pose: 'stand', arms: 'fwd', wade: 0.2 });
      lim(out, f, f.P(0.2, 0.9, 0.14), f.P(3.4, 1.9, 0.14), 0.014, [0.55, 0.5, 0.3], 4);
    }
  } else if (what === 'lotus') {
    // gathering lotus: waist-deep among the leaves, a wooden tub floating alongside
    const n = 1 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const f = frame(x + (i - (n - 1) / 2) * 4.5, s.y - 0.45 * pk, s.d + (r() - 0.5) * 2, side(), pk);
      person(out, f, r, { pose: r() < 0.5 ? 'bent' : 'stand', wade: 0.5, arms: 'low' });
      ell(out, f, -0.9, 0.62, 0.3, 0.45, 0.16, 0.36, WOOD); ell(out, f, -0.9, 0.8, 0.3, 0.34, 0.1, 0.27, r() < 0.5 ? [0.74, 0.44, 0.54] : [0.34, 0.52, 0.24]);
    }
    if (r() < 0.5) egret(out, frame(x + 5 + 2 * r(), s.y + 0.2, s.d + 1, side(), 1.7 * kk));
  } else if (what === 'pick') {
    // picking fruit: a ladder against a tree, baskets filling on the grass
    const f = frame(x, s.y, s.d, side(), pk);
    lim(out, f, f.P(0.5, 0, -0.22), f.P(1.0, 2.6, -0.22), 0.025, WOOD, 3); lim(out, f, f.P(0.5, 0, 0.22), f.P(1.0, 2.6, 0.22), 0.025, WOOD, 3);
    for (const h of [0.5, 1.0, 1.5, 2.0]) lim(out, f, f.P(0.5 + h * 0.19, h, -0.22), f.P(0.5 + h * 0.19, h, 0.22), 0.018, WOOD, 1);
    person(out, sub(f, 0.55, 0, pk, 0, 0.75), r, { arms: 'up', hat: r() < 0.6 });
    const g = frame(x - 2.4 * kk, s.y, s.d - 0.6, side(), pk);
    person(out, g, r, { pose: r() < 0.5 ? 'squat' : 'stand', arms: 'low' });
    for (const v of [-0.6, 0.5]) { ell(out, g, 0.8, 0.22, v, 0.26, 0.18, 0.26, WICKER); ell(out, g, 0.8, 0.42, v, 0.21, 0.11, 0.21, [0.8, 0.46, 0.1]); }
  } else if (what === 'veg') {
    // hoeing the vegetable rows; someone squats picking into a basket
    const f = frame(x - 1.5, s.y, s.d, side(), pk);
    person(out, f, r, { pose: 'stand', arms: 'fwd' });
    lim(out, f, f.P(0.3, 1.2, 0), f.P(1.15, 0.1, 0), 0.02, WOOD, 3);
    ell(out, f, 1.17, 0.1, 0, 0.05, 0.1, 0.12, [0.3, 0.3, 0.32]);
    if (r() < 0.7) {
      const g = frame(x + 2.2, s.y, s.d + (r() - 0.5) * 3, side(), pk);
      person(out, g, r, { pose: 'squat', arms: 'low' });
      ell(out, g, 0.75, 0.2, 0.2, 0.24, 0.17, 0.24, WICKER); ell(out, g, 0.75, 0.38, 0.2, 0.19, 0.1, 0.19, pick(LOADS, r));
    }
  } else {
    const f = frame(x, s.y, s.d, side(), pk);
    person(out, f, r, { pose: 'walk', arms: 'pole' }); shoulderPole(out, f, r);
  }
  if (out.due()) yield;
}

// --- on the bunds: people and animals walking the raised paths between the fields ---
function* bundScene(ctx, out, s, r) {
  const x = s.wx - ctx.x0, kk = farK(s.d), pk = PK * kk, bk = BK * kk;
  const yaw = r() < 0.5 ? 0 : Math.PI, u = r();
  const what = u < 0.3 ? 'pole' : u < 0.52 ? 'lead' : u < 0.68 ? 'ride' : u < 0.82 ? 'hoe' : 'graze';
  note(ctx, 'bund-' + what, s.wx, s.d);
  if (what === 'pole') {
    const n = r() < 0.4 ? 2 : 1;
    for (let i = 0; i < n; i++) { const f = frame(x + i * 3.4 * pk * Math.cos(yaw), s.y, s.d, yaw, pk); person(out, f, r, { pose: 'walk', arms: 'pole' }); shoulderPole(out, f, r); }
  } else if (what === 'lead') {
    // a child leading a buffalo home by a rope through its nose
    const fb = frame(x, s.y, s.d, yaw, bk);
    buffalo(out, fb, r, { egret: r() < 0.25 });
    const fc = sub(fb, 2.7, 0.1, pk * 0.68);
    person(out, fc, r, { child: true, pose: 'walk', hat: r() < 0.6 });
    lim(out, fb, fb.P(1.5, 0.92, 0), fc.P(-0.17, 0.92, -0.23), 0.012, [0.34, 0.3, 0.22], 2);
  } else if (what === 'ride') {
    // a child riding home on the buffalo's back
    const fb = frame(x, s.y, s.d, yaw, bk);
    buffalo(out, fb, r);
    person(out, sub(fb, -0.1, 0, pk * 0.66, 0, 1.22), r, { child: true, pose: 'sit', seat: 0.08, arms: 'fwd', hat: r() < 0.6 });
  } else if (what === 'hoe') {
    const f = frame(x, s.y, s.d, yaw, pk);
    person(out, f, r, { pose: 'walk', arms: 'pole' });
    lim(out, f, f.P(0.32, 1.42, 0.1), f.P(-0.75, 1.95, 0.1), 0.02, WOOD, 3); ell(out, f, -0.78, 1.9, 0.1, 0.05, 0.12, 0.1, [0.3, 0.3, 0.32]);
    if (r() < 0.6) dog(out, sub(f, -1.6, 0, pk), r);
    if (r() < 0.5) person(out, sub(f, 1.7, 0, pk * 0.64), r, { child: true, pose: 'walk' });
  } else {
    buffalo(out, frame(x, s.y, s.d, yaw + (r() - 0.5) * 0.4, bk), r, { pose: 'graze', egret: r() < 0.5 });
    if (r() < 0.6) person(out, frame(x - Math.cos(yaw) * 3.4 * kk, s.y, s.d, yaw + Math.PI, pk * 0.66), r, { child: true, pose: 'sit', seat: 0.1, hat: r() < 0.5 });
    if (r() < 0.5) egret(out, frame(x + Math.cos(yaw) * 3.6 * kk, s.y, s.d - 0.5, yaw, 1.7 * kk));
  }
  if (out.due()) yield;
}

// --- on the lane: bicycles, carts, people going to and from the fields ---
function* laneScene(ctx, out, s, r, night) {
  const x = s.wx - ctx.x0, kk = farK(s.d), pk = PK * kk, bk = BK * kk;
  const yaw = r() < 0.5 ? 0 : Math.PI, u = r();
  const what = night ? 'cycle' : u < 0.34 ? 'cycle' : u < 0.54 ? 'handcart' : u < 0.74 ? 'oxcart' : 'walk';
  note(ctx, 'lane-' + what, s.wx, s.d);
  if (what === 'cycle') {
    const n = !night && r() < 0.35 ? 2 : 1;
    for (let i = 0; i < n; i++) yield* cyclist(ctx, out, frame(x - i * 4.2 * pk * Math.cos(yaw), s.y, s.d + i * 0.4, yaw, pk), r, r() < 0.45, night);
  } else if (what === 'handcart') {
    // two people with a loaded handcart: one in the shafts, one pushing
    const f = frame(x, s.y, s.d, yaw, pk);
    cart(out, f, r, 0.42, 1.9, 0.92, true);
    person(out, sub(f, 2.0, 0), r, { pose: 'walk', arms: 'down' });
    person(out, sub(f, -1.6, 0), r, { pose: 'walk', arms: 'fwd' });
  } else if (what === 'oxcart') {
    // a buffalo cart: big wheels, a heaped load, the driver sitting up front
    const fb = frame(x, s.y, s.d, yaw, bk), fc = sub(fb, -2.9, 0);
    buffalo(out, fb, r);
    lim(out, fb, fb.P(0.62, 1.4, -0.34), fb.P(0.62, 1.4, 0.34), 0.04, WOOD, 1);
    cart(out, fc, r, 0.62, 3.5, 1.36, true);
    person(out, sub(fc, 0.72, 0, pk, 0, 0.74), r, { pose: 'sit', seat: 0.06, arms: 'fwd' });
  } else {
    const n = 1 + Math.floor(r() * 2.5), kids = r() < 0.4;
    for (let i = 0; i < n; i++) {
      const f = frame(x - i * 2.1 * pk * Math.cos(yaw) * (kids ? 0.6 : 1), s.y, s.d + (r() - 0.5) * 0.8, yaw, kids ? pk * 0.66 : pk);
      if (kids) { person(out, f, r, { child: true, pose: 'walk' }); ell(out, f, -0.2, 1.1, 0, 0.1, 0.16, 0.16, pick(CLOTH, r)); }       // a satchel
      else if (r() < 0.6) { person(out, f, r, { pose: 'walk', arms: 'pole' }); shoulderPole(out, f, r); }
      else person(out, f, r, { pose: 'walk' });
    }
    if (r() < 0.3) dog(out, frame(x + 2.6 * pk * Math.cos(yaw), s.y, s.d - 0.5, yaw, pk), r);
  }
  if (out.due()) yield;
}

// --- on the river bank: anglers, washing at the water's edge, a buffalo brought down to drink ---
function* bankScene(ctx, out, s, r, night) {
  const x = s.wx - ctx.x0, kk = farK(s.d), pk = PK * kk, bk = BK * kk, wy = s.y - 0.7;
  const u = r(), what = night ? 'fish' : u < 0.48 ? 'fish' : u < 0.78 ? 'wash' : 'drink';
  note(ctx, 'bank-' + what, s.wx, s.d);
  if (what === 'fish') {
    const n = !night && r() < 0.4 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const sg = r() < 0.5 ? -1 : 1, yaw = Math.PI / 2 + sg * (0.7 + 0.5 * r());
      const sit = r() < 0.5, f = frame(x + (i - (n - 1) / 2) * 5.5, s.y, s.d + 0.3, yaw, pk);
      person(out, f, r, { pose: sit ? 'sit' : 'stand', seat: 0.32, arms: 'fwd' });
      const hy = sit ? 0.5 : 1.05, tip = f.P(3.5, hy + 1.5, 0);
      lim(out, f, f.P(0.42, hy, 0), tip, 0.014, [0.5, 0.45, 0.28], 4);
      strutM(out, tip[0], tip[1], tip[2], tip[0], wy + 0.1, tip[2] - 0.5, f.thin * 0.7, [0.7, 0.7, 0.68], 2, KO, BEAT);
      out(tip[0], wy + 0.14, tip[2] - 0.5, 0.09 * kk, 0.09 * kk, 0.09 * kk, 0.78, 0.16, 0.1, 1, 0, 0, 0, 1, KO, BEAT);
      ell(out, f, -0.2, 0.2, -0.5, 0.2, 0.18, 0.2, WICKER);
      if (night) { const p = f.P(0.3, 0.45, 0.5); yield* lamp(ctx, out, p[0], p[1], -p[2], [1, 0.66, 0.32], { size: 0.12, halo: 1 }); }
    }
  } else if (what === 'wash') {
    // washing clothes at the water's edge: squatting on the stones, bright cloth in the water
    const n = 2 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const sg = r() < 0.5 ? -1 : 1, f = frame(x + (i - (n - 1) / 2) * 2.7, s.y - 0.25, s.d + 1.0, Math.PI / 2 + sg * (0.5 + 0.6 * r()), pk);
      person(out, f, r, { pose: 'squat', arms: 'low', hat: r() < 0.5 });
      const c = pick([[0.76, 0.76, 0.72], [0.66, 0.2, 0.16], [0.24, 0.36, 0.64], [0.76, 0.62, 0.2]], r);
      ell(out, f, 0.62, 0.12, 0, 0.26, 0.07, 0.2, c);
      out(f.x, s.y - 0.3, -(s.d + 1.2), 1.1, 0.12, 0.7, 0.6, 0.59, 0.55, 1, 0, 0, 0, 1, KIND.GROUND);     // the stone they squat on
      ell(out, f, -0.5, 0.22, sg * 0.5, 0.24, 0.17, 0.24, WICKER); ell(out, f, -0.5, 0.42, sg * 0.5, 0.2, 0.12, 0.2, pick([[0.74, 0.74, 0.7], [0.3, 0.4, 0.6], [0.64, 0.24, 0.2]], r));
    }
    ripple(out, x, wy, s.d + 3.2, n * 1.6, 0.8);
    if (r() < 0.5) { const f = frame(x + (n * 1.4 + 2) * (r() < 0.5 ? -1 : 1), s.y, s.d - 0.6, r() < 0.5 ? 0 : Math.PI, pk); person(out, f, r, { pose: 'walk', arms: 'pole' }); shoulderPole(out, f, r, [0.7, 0.7, 0.66]); }
  } else {
    const bd = s.d + 4.2, yaw = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.5;
    buffalo(out, frame(x, wy - 0.3 * bk, bd, yaw, bk), r, { wade: 0.3, egret: r() < 0.3 });
    ripple(out, x, wy, bd, 2.2 * bk, 0.6 * bk);
    if (r() < 0.5) { buffalo(out, frame(x + 5 * kk, wy - 0.02, bd + 1.5, yaw + 0.3, bk), r, { pose: 'wallow' }); ripple(out, x + 5 * kk, wy, bd + 1.5, 2.2 * bk, 0.6 * bk); }
    person(out, frame(x - 3.6 * kk, s.y, s.d - 0.3, 0.4, pk * 0.68), r, { child: true, pose: 'sit', seat: 0.1, hat: r() < 0.6 });
  }
  if (out.due()) yield;
}

// --- in the villages: neighbours talking, children and dogs, the old men under the banyan,
// chores in the yard, and now and then a market under coloured awnings ---
const villK = (d) => lerp(1.45, 2.0, smooth(50, 200, d));
function* villageScene(ctx, out, s, r) {
  const x = s.wx - ctx.x0, pk = villK(s.d);
  note(ctx, 'village-' + s.what, s.wx, s.d);
  if (s.what === 'market') {
    const n = 3 + Math.floor(r() * 2), sp = 4.4 * pk / 1.3;
    for (let i = 0; i < n; i++) {
      const sx = x + (i - (n - 1) / 2) * sp, ks = pk / 1.3;
      const [ca, cb] = pick([[[0.7, 0.2, 0.15], [0.76, 0.75, 0.7]], [[0.2, 0.36, 0.62], [0.76, 0.75, 0.7]], [[0.76, 0.6, 0.18], [0.76, 0.6, 0.18]], [[0.22, 0.45, 0.4], [0.22, 0.45, 0.4]], [[0.7, 0.2, 0.15], [0.7, 0.2, 0.15]]], r);
      const pr = Math.max(0.05, 0.0006 * s.d);
      for (const [px, pz, ph] of [[-1.6, -1.1, 2.2], [1.6, -1.1, 2.2], [-1.6, 1.1, 3.0], [1.6, 1.1, 3.0]]) strutM(out, sx + px * ks, s.y, -(s.d + pz * ks), sx + px * ks, s.y + ph * ks, -(s.d + pz * ks), pr, [0.4, 0.34, 0.24], 2, KO, BEAT);
      const q = quatPitch(0.34);
      for (let j = 0; j < 4; j++) { const c = j % 2 ? cb : ca; out(sx + (j - 1.5) * 0.92 * ks, s.y + 2.62 * ks, -s.d, 0.52 * ks, 0.05, 1.0 * ks, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KO, BEAT); }
      out(sx, s.y + 0.85 * ks, -(s.d + 0.2 * ks), 1.3 * ks, 0.07 * ks, 0.45 * ks, 0.4, 0.32, 0.22, 1, 0, 0, 0, 1, KO, BEAT);     // the table
      for (let j = 0; j < 4; j++) { const c = pick(LOADS, r); out(sx + (j - 1.5) * 0.62 * ks, s.y + 1.06 * ks, -(s.d + 0.1 * ks), 0.26 * ks, 0.17 * ks, 0.26 * ks, c[0], c[1], c[2], 1, 0, 0, 0, 1, KO, BEAT); }
      person(out, frame(sx + (r() - 0.5) * ks, s.y, s.d + 1.0 * ks, -Math.PI / 2 + (r() - 0.5), pk), r, { hat: r() < 0.4 });       // the seller
      const nb = Math.floor(r() * 2.6);
      for (let j = 0; j < nb; j++) {
        const f = frame(sx + (r() - 0.5) * 2.6 * ks, s.y, s.d - (1.5 + 1.6 * r()) * ks, Math.PI / 2 + (r() - 0.5) * 1.6, pk);
        if (r() < 0.25) { person(out, f, r, { pose: 'stand', arms: 'pole' }); shoulderPole(out, f, r); }
        else person(out, f, r, { hat: r() < 0.5, child: false, arms: r() < 0.3 ? 'fwd' : 'down' });
      }
    }
    // a squatting seller with baskets at each end, and a child or a dog about
    for (const e of [-1, 1]) { const f = frame(x + e * (n / 2 * sp + 1.6), s.y, s.d - 0.5, Math.PI / 2 - e * 1.2, pk); person(out, f, r, { pose: 'squat', arms: 'low' }); for (const v of [-0.5, 0.5]) { ell(out, f, 0.7, 0.2, v, 0.24, 0.17, 0.24, WICKER); ell(out, f, 0.7, 0.4, v, 0.2, 0.11, 0.2, pick(LOADS, r)); } }
    if (r() < 0.6) dog(out, frame(x + (r() - 0.5) * n * sp, s.y, s.d - 3.6, r() * 6.3, pk), r);
  } else if (s.what === 'talk') {
    const n = 2 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI + r(), f = frame(x + Math.cos(a) * 1.1 * pk, s.y, s.d + Math.sin(a) * 0.7 * pk, a + Math.PI, pk);
      if (i === 0 && r() < 0.5) { person(out, f, r, { arms: 'pole' }); shoulderPole(out, f, r); } else person(out, f, r, { hat: r() < 0.45, arms: r() < 0.3 ? 'fwd' : 'down' });
    }
    if (r() < 0.5) person(out, frame(x + 2.2 * pk, s.y, s.d - 0.6, r() * 6.3, pk * 0.64), r, { child: true });
  } else if (s.what === 'kids') {
    // children running after a ball, a dog after the children
    const n = 3 + Math.floor(r() * 2), yaw = r() < 0.5 ? 0 : Math.PI;
    for (let i = 0; i < n; i++) person(out, frame(x + (i - n / 2) * 1.9 * pk + r(), s.y, s.d + (r() - 0.5) * 2.5, yaw + (r() - 0.5) * 0.8, pk * (0.58 + 0.12 * r())), r, { child: true, pose: 'walk', arms: r() < 0.5 ? 'up' : 'swing' });
    out(x + Math.cos(yaw) * (n * 1.1 + 1.5) * pk, s.y + (0.5 + r()) * pk, -s.d, 0.17 * pk, 0.17 * pk, 0.17 * pk, 0.74, 0.16, 0.1, 1, 0, 0, 0, 1, KO, BEAT);
    dog(out, frame(x - Math.cos(yaw) * (n * 1.0 + 1.2) * pk, s.y, s.d + 0.6, yaw, pk), r);
  } else if (s.what === 'elders') {
    // the old men at a low table, on stools
    const n = 2 + Math.floor(r() * 2);
    out(x, s.y + 0.5 * pk, -s.d, 0.42 * pk, 0.05 * pk, 0.42 * pk, 0.42, 0.32, 0.2, 1, 0, 0, 0, 1, KO, BEAT);
    strutM(out, x, s.y, -s.d, x, s.y + 0.5 * pk, -s.d, Math.max(0.05, 0.0006 * s.d), WOOD, 1, KO, BEAT);
    for (let i = 0; i < n; i++) {
      const a = [Math.PI, 0, -Math.PI / 2][i] + (r() - 0.5) * 0.5, f = frame(x - Math.cos(a) * 1.05 * pk, s.y, s.d - Math.sin(a) * 0.9 * pk, a, pk);
      person(out, f, r, { pose: 'sit', seat: 0.42, arms: 'fwd', hat: r() < 0.3, shirt: pick([[0.3, 0.42, 0.62], [0.74, 0.73, 0.68], [0.72, 0.72, 0.68], [0.6, 0.56, 0.44]], r) });
    }
    if (r() < 0.6) person(out, frame(x + 2.4 * pk, s.y, s.d + 0.4, Math.PI + (r() - 0.5), pk), r, { hat: false });
  } else {
    // chores: sweeping the yard, water from the well on a pole, hens underfoot
    const f = frame(x, s.y, s.d, (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.6, pk);
    person(out, f, r, { arms: 'fwd', hat: r() < 0.5 });
    lim(out, f, f.P(0.36, 1.25, 0), f.P(1.0, 0.12, 0), 0.02, [0.5, 0.42, 0.26], 3); ell(out, f, 1.05, 0.12, 0, 0.1, 0.12, 0.2, STRAW);
    if (r() < 0.6) { const g = frame(x + (3 + 2 * r()) * pk * (r() < 0.5 ? -1 : 1), s.y, s.d + 0.8, r() < 0.5 ? 0 : Math.PI, pk); person(out, g, r, { pose: 'walk', arms: 'pole' }); shoulderPole(out, g, r, [0.5, 0.52, 0.55]); }
    const nh = 3 + Math.floor(r() * 4);
    for (let i = 0; i < nh; i++) {
      const g = frame(x + (r() - 0.5) * 7 * pk, s.y, s.d - 0.8 + (r() - 0.5) * 2.4, r() * 6.3, pk * 1.5), c = pick([[0.56, 0.3, 0.14], [0.76, 0.74, 0.68], [0.16, 0.14, 0.13]], r);
      ell(out, g, 0, 0.17, 0, 0.13, 0.1, 0.09, c); ell(out, g, 0.12, 0.3, 0, 0.05, 0.05, 0.05, c); ell(out, g, 0.13, 0.36, 0, 0.03, 0.025, 0.02, [0.74, 0.14, 0.1]);
    }
  }
  if (out.due()) yield;
}
// Places in a village where people can be seen from the line: in front of every house and clear
// of the trees, 33 m out or more. Cached on the village.
function villageSpots(W, v) {
  if (v.spots) return v.spots;
  const r = makeRng(hashInts(v.seed, 51)), spots = [];
  const want = clamp(2 + Math.floor(v.houses.length / 8), 2, 6);
  const clear = (wx, d, m = 0) => {
    if (d < 33.5 || d > 235) return false;
    for (const h of v.houses) { const hw = Math.max(h.w, h.dep) / 2; if (Math.abs(wx - h.wx) < hw + 2.2 + m && d > h.d - hw - (h.court ? 7 : 2.2)) return false; }
    for (const t of v.trees) if (t.d < d + 2.5 && Math.abs(wx - t.wx) < (t.type === 'banyan' ? 8 : 5.5) + m) return false;
    const sf = surface(W, wx, d);
    return sf.t === T.VILLAGE || sf.t === T.LANE;
  };
  const add = (wx, d, what) => {
    for (const s of spots) if (Math.abs(s.wx - wx) < 10 && Math.abs(s.d - d) < 7) return false;
    spots.push({ kind: 'village', wx, d, y: W.H(wx, d), what, half: what === 'market' ? 12 : 5, seed: hashInts(v.seed, 53, spots.length) });
    return true;
  };
  // a market along the front of the village, where there is room for one
  if (r() < 0.45) for (let k = 0; k < 8; k++) {
    const a = (r() - 0.5) * 1.1 * v.R, d = v.dc - v.Rd * Math.sqrt(1 - (a / v.R) ** 2) * 0.88;
    if (clear(v.cx + a, d, 7)) { add(v.cx + a, d, 'market'); break; }
  }
  // the old men under the village banyan
  const big = v.trees.find((t) => t.big);
  if (big && r() < 0.7) { const wx = big.wx + (r() - 0.5) * 3, d = big.d - 4.5; let ok = d >= 33.5 && d < 235; for (const h of v.houses) { const hw = Math.max(h.w, h.dep) / 2; if (Math.abs(wx - h.wx) < hw + 2.2 && d > h.d - hw - 2.2) ok = false; } if (ok) add(wx, d, 'elders'); }
  for (let k = 0; k < 70 && spots.length < want; k++) {
    const a = (r() * 2 - 1) * 0.95 * v.R, e = Math.sqrt(1 - (a / v.R) ** 2), d = v.dc + v.Rd * e * (-0.93 + 1.2 * r() * r());
    const what = pick(['talk', 'kids', 'chores', 'talk', 'elders', 'kids', 'chores'], r);
    if (clear(v.cx + a, d)) add(v.cx + a, d, what);
  }
  v.spots = spots;
  return spots;
}

// A rick of rice straw built round a pole.
function hayrick(out, x, y, d, k) {
  for (const [h, rr, sh] of [[0.8, 1.45, 0.74], [1.8, 1.4, 0.88], [2.8, 1.05, 1.0], [3.55, 0.6, 1.06]]) out(x, y + h * k, -d, rr * k * 0.62, 0.62 * k, rr * k * 0.62, 0.72 * sh, 0.6 * sh, 0.3 * sh, 1, 0, 0, 0, 1, KIND.BUILDING);
  strutM(out, x, y + 3.6 * k, -d, x, y + 4.7 * k, -d, Math.max(0.06, 0.0006 * d), [0.3, 0.25, 0.18], 1, KIND.BUILDING, 0);
}
// An orchard tree: a short trunk, a round glossy crown lit from the left, fruit showing near to.
function fruitTree(out, x, y, d, h) {
  const u = (n) => ((h >>> n) & 15) / 15;
  const H = 3.6 + 1.2 * u(4), R = 1.15 + 0.4 * u(12), g = [0.13 + 0.04 * u(20), 0.29 + 0.07 * u(20), 0.1];
  strutM(out, x, y - 0.1, -d, x, y + H * 0.5, -d, Math.max(0.1, 0.0008 * d), [0.26, 0.21, 0.16], 1, KIND.TREE, 0);
  const cy = y + H * 0.64;
  out(x, cy - R * 0.1, -d, R, R * 0.8, R * 0.9, g[0], g[1], g[2], 1, 0, 0, 0, 1, KIND.TREE);
  if (d > 170) return;
  out(x - R * 0.4, cy + R * 0.35, -(d - R * 0.3), R * 0.6, R * 0.5, R * 0.6, g[0] * 1.7, g[1] * 1.5, g[2] * 1.5, 1, 0, 0, 0, 1, KIND.TREE);
  out(x + R * 0.45, cy + R * 0.1, -(d - R * 0.2), R * 0.55, R * 0.5, R * 0.55, g[0] * 1.25, g[1] * 1.2, g[2] * 1.2, 1, 0, 0, 0, 1, KIND.TREE);
  if (d > 115) return;
  const fc = (h & 3) === 0 ? [0.74, 0.7, 0.26] : [0.8, 0.46, 0.1];
  for (let k = 0; k < 4; k++) out(x + (u(k * 4 + 2) - 0.5) * R * 2.2, cy + (u(k * 4 + 9) - 0.55) * R * 1.5, -(d - R * 0.95), 0.17, 0.17, 0.17, fc[0], fc[1], fc[2], 1, 0, 0, 0, 1, KIND.TREE);
}
// What stands on the ground that is not paddy: the orchard trees in their rows, the bamboo and
// broad trees along the edge of a wood and the dark canopy behind them, the leaves and flowers of
// the lotus, a lift net over a fish pond. Everything from world hashes, panel by panel.
function* zoneProps(ctx, out, W, dLo, dHi, sites) {
  const xa = ctx.x0 - 16, xb = ctx.x0 + ctx.length + 16;
  for (let k = 1; k + 1 < W.rows.length; k++) {
    const q = W.rows[k];
    if (q.D > Math.min(dHi, 430)) break;
    if (W.rows[k + 1].D < dLo) continue;
    const dm0 = q.D + q.gap / 2;
    for (let j = Math.floor(xa / q.W) - 1, j1 = Math.floor(xb / q.W) + 1; j <= j1; j++) {
      const f = panelInfo(W, k, j);
      if (f.t !== P.POND && f.t < P.LOTUS) continue;
      const xl = colEdge(W, k, j, dm0), xr = colEdge(W, k, j + 1, dm0);
      if (xr < xa || xl > xb) continue;
      const cx = (xl + xr) / 2, d0 = edgeD(W, k, cx), d1 = edgeD(W, k + 1, cx);
      const inPanel = (wx, d, m) => { const s = surface(W, wx, d); return s.t === T.PADDY && s.k === k && s.j === j && s.edge > m; };
      if (f.t === P.ORCHARD) {
        const sp = 6.5;
        if (out.n + ((xr - xl) * (d1 - d0) / (sp * sp)) * 8 > out.limit) continue;
        for (let gd = Math.ceil((d0 - 3) / sp) * sp; gd < d1 + 3; gd += sp) {
          if (gd < dLo || gd >= dHi) continue;
          for (let gx = Math.ceil(Math.max(xl - 5, xa) / sp) * sp; gx < Math.min(xr + 5, xb); gx += sp) {
            const h = hashInts(W.ws, 1632, Math.round(gx / sp), Math.round(gd / sp));
            const tx = gx + ((h & 255) / 255 - 0.5) * 1.6, td = gd + (((h >>> 8) & 255) / 255 - 0.5) * 1.6;
            if ((h >>> 16) % 11 === 0 || !inPanel(tx, td, 1.3)) continue;
            let gap = false;
            for (const s of sites) if (Math.abs(tx - s.wx) < s.half + 2 && td > s.d - 9 && td < s.d + 2) gap = true;
            if (!gap) fruitTree(out, tx - ctx.x0, SURF.y, td, h);
          }
          if (out.due()) yield;
        }
      } else if (f.t === P.WOOD) {
        const front = k < 2 || panelInfo(W, k - 1, j0of(W, k - 1, cx, d0 - 2)).t !== P.WOOD;
        if (front && d0 < 85) {
          // the edge of the wood: a rank of bamboo and broad trees drawn whole, a second rank behind
          for (let gx = Math.ceil(Math.max(xl, xa) / 8) * 8; gx < Math.min(xr, xb); gx += 8) {
            for (let rank = 0; rank < 2; rank++) {
              const tr = makeRng(hashInts(W.ws, 1633, k, Math.round(gx / 8), rank));
              const tx = gx + (tr() - 0.5) * 5 + rank * 4, td = d0 + 3 + rank * 7 + tr() * 3;
              if (td < dLo || td >= dHi || !inPanel(tx, td, 1.5) || hides(sites, tx, td, 7)) continue;
              const y = SURF.y - 0.2, nk = rank ? 0.16 : lerp(0.42, 0.28, smooth(45, 120, td));
              if (out.n + treeSplats(out, td, 12) * 1.5 * nk > out.limit) continue;      // whole or not at all
              note(ctx, 'wood-tree', tx, td);
              if (tr() < 0.6) yield* bamboo(ctx, out, tx - ctx.x0, td, { rng: tr, height: 10 + 6 * tr(), width: 6 + 5 * tr(), y, n: Math.round(treeSplats(out, td, 11) * 1.5 * nk) });
              else yield* broadCrown(ctx, out, tx - ctx.x0, td, { rng: tr, height: 11 + 7 * tr(), crown: 10 + 7 * tr(), y, n: Math.round(treeSplats(out, td, 13) * nk) });
            }
          }
        }
        // the canopy behind: dark groves, lighter where bamboo stands among the trees
        const dm = (d0 + d1) / 2, dep = (d1 - d0) / 2;
        if (dm >= dLo && dm < dHi) for (let gx = Math.ceil(Math.max(xl, xa) / 24) * 24; gx < Math.min(xr, xb); gx += 24) {
          const tr = makeRng(hashInts(W.ws, 1634, k, Math.round(gx / 24)));
          if (!inPanel(gx, dm, 0) || hides(sites, gx, dm, 12)) continue;
          const gs = detail(out, dm, 1.0), gh = 5.5 + 2.5 * tr(), gn = Math.round(clamp(14 * gh * 3 / (gs * gs), 16, 260));
          if (out.n + gn > out.limit) continue;
          note(ctx, 'wood-grove', gx, dm);
          yield* blob(ctx, out, gx - ctx.x0 + (tr() - 0.5) * 6, SURF.y + gh * 1.05, dm + (front ? 4 : 0), 15, gh, Math.max(4, dep * 0.75), { n: gn, color: tr() < 0.35 ? C.bambooLeaf : C.camphor, rng: tr, kind: KIND.HEDGE, inner: 0.3, amb: 0.55 });
        }
      } else if (f.t === P.LOTUS) {
        if (d0 > 135 || d1 < dLo) continue;
        const r = makeRng(hashInts(W.ws, 1635, k, j));
        const n = Math.min(150, Math.round((xr - xl) * (d1 - d0) / 3));
        if (out.n + n * 1.2 > out.limit) continue;
        for (let i = 0; i < n; i++) {
          const wx = xl + r() * (xr - xl), d = d0 + r() * (d1 - d0), R = 0.45 + 0.35 * r(), up = 0.3 + 0.6 * r(), fl = r(), tl = r() - 0.5;
          const c = jitter([0.22, 0.45, 0.22], r, 0.16), qq = quatUpTo(tl * 0.5, 1, 0.35);
          if (wx < xa || wx > xb || d < dLo || !inPanel(wx, d, 0.8)) continue;
          out(wx - ctx.x0, SURF.y + up, -d, R, 0.05, R * 0.85, c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], KIND.GROUND);
          if (fl < 0.2) out(wx - ctx.x0 + 0.3, SURF.y + up + 0.45, -d, 0.2, 0.25, 0.2, fl < 0.05 ? 0.78 : 0.76, fl < 0.05 ? 0.76 : 0.42, fl < 0.05 ? 0.72 : 0.54, 1, 0, 0, 0, 1, KO, BEAT);
        }
      } else {
        // a fish pond: now and then a square lift net hung from four bowed canes on a long pole
        const r = makeRng(hashInts(W.ws, 1636, k, j));
        const bd = d0 + 1, wx = cx + (r() - 0.5) * 4;
        if (r() > 0.22 || bd < dLo || bd > 140 || bd >= dHi || xr - xl < 12 || d1 - d0 < 9 || !inPanel(wx, bd + 5, 2)) continue;
        const x = wx - ctx.x0, y = SURF.y, pr = Math.max(0.05, 0.0006 * bd), cane = [0.52, 0.47, 0.28];
        const hx = x + 0.6, hy = y + 6.2, hz = -(bd + 5);
        strutM(out, x - 0.4, y + 0.3, -bd, hx, hy, hz, pr * 1.3, cane, 5, KO, BEAT);
        const cs = [[-2.7, -2.4], [2.7, -2.4], [2.7, 2.4], [-2.7, 2.4]].map(([a, b]) => [hx + a, y + 1.3, hz - b]);
        for (const c of cs) { strutM(out, hx, hy, hz, (hx + c[0]) / 2 + (c[0] - hx) * 0.25, hy - 1.3, (hz + c[2]) / 2, pr, cane, 2, KO, BEAT); strutM(out, (hx + c[0]) / 2 + (c[0] - hx) * 0.25, hy - 1.3, (hz + c[2]) / 2, c[0], c[1], c[2], pr, cane, 2, KO, BEAT); }
        for (let i = 0; i < 4; i++) { const a = cs[i], b = cs[(i + 1) % 4]; strutM(out, a[0], a[1], a[2], (a[0] + b[0]) / 2, a[1] - 0.5, (a[2] + b[2]) / 2, pr * 0.8, [0.62, 0.62, 0.56], 2, KO, BEAT); strutM(out, (a[0] + b[0]) / 2, a[1] - 0.5, (a[2] + b[2]) / 2, b[0], b[1], b[2], pr * 0.8, [0.62, 0.62, 0.56], 2, KO, BEAT); }
        for (const [i, m] of [[0, 2], [1, 3]]) strutM(out, cs[i][0], cs[i][1], cs[i][2], cs[m][0], cs[m][1] - 0.2, cs[m][2], pr * 0.7, [0.62, 0.62, 0.56], 3, KO, BEAT);
        person(out, frame(x - 1.3, y + 0.3, bd - 0.2, 0.4, PK * farK(bd)), r, { arms: 'fwd' });
        note(ctx, 'liftnet', wx, bd);
      }
      if (out.due()) yield;
    }
  }
}
// The column of row k that holds world x at distance d.
function j0of(W, k, wx, d) { return colAt(W, k, wx, d); }

// ---------------------------------------------------------------------------------------------
// Things to see in the distance: a pagoda on a wooded hill, a temple with its gate on the flank
// of a tower, a pavilion or a slim pagoda on a crag, a white-walled village at a tower's foot,
// an old wall with watch towers along a ridge. Built well over life size, in proportion to their
// distance, so that they read through the haze at 400 to 2500 m. At most one to a 1300 m cell of
// the line, hashed from the world; drawn whole, before the towers take their share of the band.
// ---------------------------------------------------------------------------------------------
const LMCELL = 1300;
const STONE = [0.6, 0.58, 0.53];
function landmark(W, i) {
  return cache(W.misc, 'L' + i, () => {
    const r = makeRng(hashInts(W.ws, 1701, i));
    if (r() > 0.85) return null;
    const x0 = i * LMCELL, u = r(), seed = hashInts(W.ws, 1702, i);
    let what = u < 0.2 ? 'temple' : u < 0.38 ? 'crag' : u < 0.56 ? 'hamlet' : u < 0.78 ? 'wall' : 'pagoda';
    if (what === 'temple' || what === 'crag' || what === 'hamlet') {
      // these belong to a tower: the most prominent one of this cell that suits
      let best = null, bs = 0;
      for (const t of towersIn(W, x0, x0 + LMCELL, 420, what === 'hamlet' ? 1700 : 2500)) {
        if (t.wx < x0 || t.wx >= x0 + LMCELL || t.R < 40) continue;
        if (what === 'crag' && (t.H > 0.36 * t.d || t.d < 600)) continue;      // its top must be in the frame
        const sc = (t.R * t.H) / (t.d * t.d);
        if (sc > bs) { bs = sc; best = t; }
      }
      if (best) return { what, t: best, wx: best.wx, d: best.d, seed };
      what = 'pagoda';
    }
    // a hill of its own on the valley floor, clear of the river, the villages and the towers
    for (let k = 0; k < 8; k++) {
      const wx = x0 + (0.15 + 0.7 * r()) * LMCELL, d = 460 + 1500 * Math.pow(r(), 1.5);
      const rn = riverN(W, wx);
      if (d > rn - 150 && d < rn + riverW(W, wx) + 150) continue;
      if (villageAt(W, wx, d) || villageAt(W, wx, d - 120)) continue;
      let hit = false;
      for (const t of towersIn(W, wx - 600, wx + 600, d - 700, d + 400)) if (Math.abs(t.wx - wx) < t.R * 1.3 + (what === 'wall' ? 140 : 110) && t.d - t.R * 1.3 < d + 130) hit = true;
      if (!hit) return { what, wx, d, seed };
    }
    return null;
  });
}
// The summit of a tower (the lean is replayed from the first draws of karstTower).
function towerTop(W, t) {
  const r = makeRng(t.seed);
  r(); r(); r(); r();
  const lx = (r() - 0.5) * 0.22, ld = (r() - 0.5) * 0.12;
  return { wx: t.wx + lx * t.H, d: t.d + ld * t.H, y: W.H(t.wx, t.d) - 1.5 + t.H };
}

// A hall in the Chinese manner: a stone plinth, red or ochre walls with dark bays between the
// columns, and a great tiled roof, hipped, hollow in the slope, its eaves swept up at the corners.
// Drawn for the distance, from the front and both ends, in splats of size s.
//   o: { w, dep, h (wall height), roofH, wall, tile, s, kind, open (a pavilion: columns and no walls),
//        double (a second, smaller storey with its own roof) }
function* hall(ctx, out, x, y, d, o) {
  const w = o.w, dep = o.dep || w * 0.5, h = o.h || w * 0.3, rh = o.roofH || w * 0.32, s = o.s, kind = o.kind != null ? o.kind : KIND.BUILDING;
  const wall = o.wall || [0.62, 0.2, 0.14], tile = o.tile || C.tile, over = 0.2 * w, zf = -(d - dep / 2);
  const nu = Math.max(3, Math.round(w / (s * 1.5))), nv = Math.max(2, Math.round(h / (s * 1.5))), bays = Math.max(3, Math.round(w / (h * 0.9))) | 1;
  for (let i = 0; i < nu; i++) out(x + ((i + 0.5) / nu - 0.5) * w * 1.1, y + h * 0.05, zf + 0.3 * s, (w * 1.1 / nu) * 0.62, h * 0.07, s * 0.4, STONE[0], STONE[1], STONE[2], 1, 0, 0, 0, 1, kind);
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = (i + 0.5) / nu, b = (j + 0.5) / nv, ph = Math.abs(((a * bays) % 1) - 0.5);
      const c = (o.open ? ph < 0.36 : ph < 0.3 && b < 0.72) ? [0.1, 0.08, 0.07] : faceTone(wall, 0, 1);
      out(x + (a - 0.5) * w, y + h * (0.1 + 0.9 * b), zf, (w / nu) * 0.62, (h * 0.9 / nv) * 0.62, s * 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
  }
  const nd = Math.max(2, Math.round(dep / (s * 1.5)));
  for (const sg of [-1, 1]) {
    const c = o.open ? [0.14, 0.1, 0.09] : faceTone(wall, sg, 0);
    for (let i = 0; i < nd; i++) for (let j = 0; j < nv; j++) out(x + sg * w / 2, y + h * (0.1 + 0.9 * (j + 0.5) / nv), -(d - dep / 2 + (i + 0.5) / nd * dep), s * 0.3, (h * 0.9 / nv) * 0.62, (dep / nd) * 0.62, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
  }
  if (out.due()) yield;
  // the roof
  const run = dep / 2 + over, ey = y + h - over * 0.22, rise = rh + over * 0.22, slope = Math.hypot(rise, run);
  const mu = Math.max(5, Math.round((w + 2 * over) / (s * 1.35))), mv = Math.max(2, Math.round(slope / (s * 1.35)));
  const qf = quatPitch(Math.atan2(rise, run)), ridge = w * 0.3;
  const eave = (u, t) => (1 - t) * (1 - t) * Math.pow(Math.abs(u), 3) * rh * 0.5 - Math.sin(Math.PI * t) * rh * 0.1;
  for (let i = 0; i < mu; i++) {
    for (let j = 0; j < mv; j++) {
      const u = ((i + 0.5) / mu) * 2 - 1, t = (j + 0.5) / mv, half = lerp(w / 2 + over, ridge, t);
      const c = shade(tile, u * 0.3, 0.7, 0.6, 0.6, 0.55);
      out.q(x + u * half, ey + t * rise + eave(u, t), -(d - run * (1 - t)), (half / mu) * 1.3, s * 0.3, (slope / mv) * 0.62, c, 1, qf, kind);
    }
  }
  const md = Math.max(2, Math.round((2 * run) / (s * 1.6))), se = Math.hypot(rise, w / 2 + over - ridge), te = Math.atan2(rise, w / 2 + over - ridge);
  for (const sg of [-1, 1]) {
    const qe = quatUpTo(sg * Math.sin(te), Math.cos(te), 0), c = shade(tile, sg * 0.75, 0.6, 0.1, 0.55, 0.6);
    for (let i = 0; i < md; i++) for (let j = 0; j < mv; j++) {
      const v = ((i + 0.5) / md) * 2 - 1, t = (j + 0.5) / mv;
      out.q(x + sg * lerp(w / 2 + over, ridge, t), ey + t * rise + eave(v, t), -(d + v * run * (1 - t)), (se / mv) * 0.62, s * 0.3, (run * (1 - t) / md) * 1.3 + s * 0.2, c, 1, qe, kind);
    }
  }
  // the ridge, its ends turned up, and the dark line of the eaves with their upswept corners
  const lr = Math.max(s * 0.4, rh * 0.07);
  strutM(out, x - ridge, ey + rise, -d, x + ridge, ey + rise, -d, lr, C.ridge, Math.max(2, Math.round(mu / 2)), kind, 0);
  for (const sg of [-1, 1]) strutM(out, x + sg * ridge * 0.86, ey + rise, -d, x + sg * ridge * 1.12, ey + rise + rh * 0.2, -d, lr, C.ridge, 1, kind, 0);
  const ne = Math.max(6, Math.round(mu * 0.8)), fz = -(d - run);
  for (let i = 0; i < ne; i++) {
    const u0 = (i / ne) * 2 - 1, u1 = ((i + 1) / ne) * 2 - 1, hw = w / 2 + over;
    strutM(out, x + u0 * hw, ey + eave(u0, 0), fz, x + u1 * hw, ey + eave(u1, 0), fz, lr * 0.8, [0.14, 0.14, 0.15], 1, kind, 0);
  }
  if (out.due()) yield;
  if (o.double) yield* hall(ctx, out, x, y + h + rise * 0.42, d, { ...o, double: false, w: w * 0.6, dep: dep * 0.6, h: h * 0.5, roofH: rh * 0.85 });
}
// A village house for the distance: white wall, grey roof, both gables.
function farHouse(out, x, y, d, w, h, s, wall, kind) {
  const nu = Math.max(2, Math.round(w / (s * 1.6))), dep = w * 0.6, rh = h * 0.62, q = quatPitch(Math.atan2(rh, dep / 2));
  for (let i = 0; i < nu; i++) {
    const cx = x + ((i + 0.5) / nu - 0.5) * w, c = mul3(wall, 1.02), dark = (i * 7 + nu) % 3 === 0;
    out(cx, y + h * 0.5, -(d - dep / 2), (w / nu) * 0.62, h * 0.5, s * 0.3, c[0] * (dark ? 0.82 : 1), c[1] * (dark ? 0.82 : 1), c[2] * (dark ? 0.82 : 1), 1, 0, 0, 0, 1, kind);
    const t = shade(C.tile, 0, 0.75, 0.6, 0.6, 0.55);
    out.q(cx * 1 + (cx - x) * 0.12, y + h + rh * 0.45, -(d - dep * 0.3), (w * 1.12 / nu) * 0.66, s * 0.3, dep * 0.42, t, 1, q, kind);
  }
  for (const sg of [-1, 1]) { const c = faceTone(wall, sg, 0); out(x + sg * w / 2, y + h * 0.6, -d, s * 0.3, h * 0.6, dep * 0.45, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind); }
  strutM(out, x - w * 0.56, y + h + rh * 0.95, -d, x + w * 0.56, y + h + rh * 0.95, -d, Math.max(s * 0.3, h * 0.05), C.ridge, 2, kind, 0);
}
function* landmarks(ctx, out, W, dLo, dHi) {
  const lim = out.limit;
  out.limit = Infinity;
  for (let i = Math.floor((ctx.x0 - 700) / LMCELL), i1 = Math.floor((ctx.x0 + ctx.length + 700) / LMCELL); i <= i1; i++) {
    const m = landmark(W, i);
    if (!m || m.d < dLo || m.d >= dHi) continue;
    const r = makeRng(m.seed), d = m.d, sc = clamp(d / 450, 1, 3.4), yb = W.H(m.wx, d) - 1, s = Math.max(0.3, detail(out, d, 0.42));
    note(ctx, 'far-' + m.what, m.wx, d);
    if (m.what === 'pagoda') {
      // (terracotta or whitewash, to stand out from the grey limestone behind)
      const Hp = Math.min(125, 44 * Math.pow(sc, 0.95));
      yield* moundWith(ctx, out, W, m.wx, d, 50 * Math.sqrt(sc) + 15 * r(), (20 + 8 * r()) * Math.pow(sc, 0.7), r, 'pagoda', 0, KIND.HEDGE, Hp, r() < 0.6 ? [0.7, 0.38, 0.25] : [0.8, 0.78, 0.7]);
    } else if (m.what === 'temple') {
      // on a wooded shoulder part-way up the tower: a terrace wall, the great hall with a hall
      // either side, and the gate lower down with the stair climbing to it
      const t = m.t, S = clamp(0.05 * t.d, 30, 90), a = (r() - 0.5) * 0.7, up = Math.max(S * 0.9, (0.16 + 0.12 * r()) * t.H);
      const x = t.wx + Math.sin(a) * t.R * 0.85 - ctx.x0, td = t.d - Math.cos(a) * t.R * 0.9 - S * 0.5, y0 = W.H(t.wx, t.d) - 1, ty = y0 + up;
      const ns = Math.round(clamp((S * 3.2 * up) / (s * s * 9), 40, 500));
      yield* blob(ctx, out, x, y0 + up * 0.48, td + S * 0.2, S * 1.7, up * 0.56, S * 0.9, { n: ns, color: C.veg, rng: r, kind: KIND.HEDGE, inner: 0.3, amb: 0.55 });
      const wn = Math.max(6, Math.round((S * 2.6) / (s * 1.5)));
      for (let k = 0; k < wn; k++) for (let j = 0; j < 2; j++) { const c = mul3(STONE, 0.78 + 0.2 * j + 0.08 * r()); out(x + ((k + 0.5) / wn - 0.5) * S * 2.6, ty - S * (0.2 - 0.12 * j), -(td - S * 0.62), (S * 2.6 / wn) * 0.62, S * 0.075, s * 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.BUILDING); }
      const wall = r() < 0.6 ? [0.64, 0.2, 0.14] : [0.74, 0.56, 0.22], tile = r() < 0.35 ? [0.62, 0.5, 0.16] : C.tile;
      yield* hall(ctx, out, x, ty, td, { w: S, dep: S * 0.5, h: S * 0.26, roofH: S * 0.3, wall, tile, s, double: true });
      for (const sg of [-1, 1]) yield* hall(ctx, out, x + sg * S * 0.98, ty, td - S * 0.12, { w: S * 0.5, dep: S * 0.34, h: S * 0.2, roofH: S * 0.2, wall, tile, s });
      // the gate, lower down, and the stair
      const gx = x + (r() - 0.5) * S * 0.6, gy = ty - Math.min(up * 0.55, S * 0.75), gd = td - S * 1.05, pr = Math.max(s * 0.35, S * 0.02);
      yield* hall(ctx, out, gx, gy, gd, { w: S * 0.42, dep: S * 0.16, h: S * 0.24, roofH: S * 0.16, wall, tile, s, open: true });
      strutM(out, gx, gy + S * 0.02, -gd, x, ty - S * 0.1, -(td - S * 0.6), pr, [0.7, 0.68, 0.62], 4, KIND.BUILDING, 0);
      strutM(out, gx, gy, -gd, gx + (r() - 0.5) * S, y0 + 1, -(gd - S * 0.5), pr, [0.7, 0.68, 0.62], 4, KIND.BUILDING, 0);
      // dark cypresses beside the halls
      for (const sg of [-1.55, 1.5, -0.55]) out(x + sg * S, ty + S * 0.32, -(td - S * 0.3), S * 0.09, S * 0.3, S * 0.09, 0.07, 0.15, 0.08, 1, 0, 0, 0, 1, KIND.HEDGE);
    } else if (m.what === 'crag') {
      // on the very top of a tower
      const tp = towerTop(W, m.t), S = clamp(0.024 * tp.d, 14, 50), x = tp.wx - ctx.x0, y = tp.y - m.t.H * 0.03;
      yield* blob(ctx, out, x, y, tp.d, S * 0.9, S * 0.22, S * 0.6, { n: Math.round(clamp((S * S) / (s * s * 5), 12, 120)), color: C.veg, rng: r, kind: KIND.HEDGE, inner: 0.3, amb: 0.6 });
      if (r() < 0.5) yield* hall(ctx, out, x, y + S * 0.1, tp.d, { w: S, dep: S * 0.7, h: S * 0.36, roofH: S * 0.34, wall: [0.5, 0.16, 0.12], s, open: true, double: r() < 0.5 });
      else yield* pagoda(ctx, out, x, tp.d, { rng: r, height: S * 2.3, tiers: 5, y: y + S * 0.1, s, color: r() < 0.5 ? [0.7, 0.38, 0.25] : [0.8, 0.78, 0.7] });
    } else if (m.what === 'hamlet') {
      // a village on the rising ground at the foot of a tower: white walls and grey roofs in
      // ranks one above another among dark trees, the ancestral hall in the middle
      const t = m.t, hs = clamp(t.d / 260, 1.8, 4.2), hw = 10.5 * hs, hh = 5.4 * hs, rise = 0.045 * t.H, y0 = W.H(t.wx, t.d) - 0.5 + rise;
      const cx = t.wx + (r() - 0.5) * t.R * 0.7, d0 = t.d - t.R * 1.45 - hw * 1.9;
      const sf = surface(W, cx, d0);
      if (sf.t === T.RIVER || sf.t === T.GRAVEL || d0 < dLo + 20) continue;
      const rows = 3, per = 4 + Math.floor(r() * 3), sh = Math.max(s, hw / 7);
      // (on a green rise, so that it stands clear of the mist on the valley floor)
      yield* blob(ctx, out, cx - ctx.x0, y0 - rise * 0.55, d0 + hw * 0.8, per * hw * 1.0, rise * 0.75, hw * 1.8, { n: Math.round(clamp((per * hw * rise * 4) / (s * s * 16), 20, 300)), color: [0.2, 0.31, 0.13], rng: r, kind: KIND.HEDGE, inner: 0.3, amb: 0.6 });
      yield* blob(ctx, out, cx - ctx.x0, y0 + hh * 1.5, d0 + hw * 2.4, per * hw * 0.8, hh * 1.6, hw, { n: Math.round(clamp((per * hw * hh * 5) / (s * s * 16), 30, 400)), color: C.camphor, rng: r, kind: KIND.HEDGE, inner: 0.3, amb: 0.55 });
      for (let j = rows - 1; j >= 0; j--) {
        for (let k = 0; k < per + (j % 2); k++) {
          const hx = cx + (k - (per - 1 + (j % 2)) / 2) * hw * 1.32 + (r() - 0.5) * hw * 0.3 - ctx.x0, hd = d0 + j * hw * 0.85 + (r() - 0.5) * 3, hy = y0 + j * hh * 0.62;
          const big = j === 0 && k === Math.floor(per / 2), u = r();
          if (!big && u < 0.14) { out(hx, hy + hh * 0.9, -hd, hw * 0.42, hh * 0.9, hw * 0.4, 0.09, 0.17, 0.08, 1, 0, 0, 0, 1, KIND.HEDGE); continue; }
          if (big) yield* hall(ctx, out, hx, hy, hd - hw * 0.3, { w: hw * 1.5, dep: hw * 0.8, h: hh * 0.9, roofH: hh * 0.75, wall: [0.74, 0.72, 0.66], s });
          else farHouse(out, hx, hy, hd, hw * (0.8 + 0.3 * r()), hh * (u < 0.5 ? 1.25 : 0.85), sh, WALLS[Math.floor(r() * 3)], KIND.BUILDING);
        }
        if (out.due()) yield;
      }
    } else {
      // a ridge with an old wall running along its crest from watch tower to watch tower
      const Lh = Math.min(520, (210 + 160 * r()) * Math.sqrt(sc)), Hr = Math.min(135, (34 + 26 * r()) * Math.pow(sc, 0.8)), Rd = Hr * 0.9, salt = Math.floor(r() * 9999);
      const hAt = (u) => Hr * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), 2.3)), 0.85) * (0.78 + 0.3 * noise1(u * 2.1 + 5, salt));
      const nb = 16;
      for (let k = 0; k < nb; k++) {
        const u = ((k + 0.5) / nb) * 2 - 1, hk = hAt(u);
        if (hk < 3) continue;
        const gn = Math.round(clamp(((Lh / nb) * 3 * hk * 3) / (s * s * 14), 14, 220));
        yield* blob(ctx, out, m.wx + u * Lh - ctx.x0, yb + hk * 0.42, d + Rd * 0.3, (Lh / nb) * 1.5, hk * 0.6, Rd * 0.5, { n: gn, color: k % 3 ? C.camphor : C.veg, rng: r, kind: KIND.HEDGE, inner: 0.3, amb: 0.55 });
      }
      const wh = clamp(0.011 * d, 5, 20), nw = 44, wz = -(d - Rd * 0.12);
      const py = (u) => yb + hAt(u) * 0.97 + wh * 0.2;
      for (let k = 0; k < nw; k++) {
        const u0 = (k / nw) * 1.7 - 0.85, u1 = ((k + 1) / nw) * 1.7 - 0.85, xa = m.wx + u0 * Lh - ctx.x0, xb = m.wx + u1 * Lh - ctx.x0, ya = py(u0), yc = py(u1);
        const q = quatXTo(xb - xa, yc - ya, 0), c = mul3(STONE, 0.9 + 0.12 * ((k * 5) % 3) / 2);
        out((xa + xb) / 2, (ya + yc) / 2, wz, Math.hypot(xb - xa, yc - ya) * 0.6, wh * 0.5, s * 0.3, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.BUILDING);
        if (k % 2 === 0) out((xa + xb) / 2, (ya + yc) / 2 + wh * 0.62, wz, Math.hypot(xb - xa, yc - ya) * 0.28, wh * 0.16, s * 0.3, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.BUILDING);
      }
      const tw = clamp(0.019 * d, 9, 36);
      for (const u of [-0.62, 0.02 + (r() - 0.5) * 0.3, 0.6]) {
        const tx = m.wx + u * Lh - ctx.x0, ty = py(u) - wh * 0.4, th = tw * (u > -0.3 && u < 0.3 ? 1.5 : 1.05), nt = Math.max(2, Math.round(tw / (s * 1.5))), nh = Math.max(2, Math.round(th / (s * 1.5)));
        for (let a = 0; a < nt; a++) for (let b = 0; b < nh; b++) { const c = mul3(faceTone(STONE, 0, 1), b === 0 ? 0.85 : 1); out(tx + ((a + 0.5) / nt - 0.5) * tw, ty + ((b + 0.5) / nh) * th, wz + tw * 0.35, (tw / nt) * 0.62, (th / nh) * 0.62, s * 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.BUILDING); }
        for (const sg of [-1, 1]) { const c = faceTone(STONE, sg, 0); for (let b = 0; b < nh; b++) out(tx + sg * tw / 2, ty + ((b + 0.5) / nh) * th, wz, s * 0.3, (th / nh) * 0.62, tw * 0.35, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.BUILDING); }
        out(tx, ty + th * 0.55, wz + tw * 0.36, tw * 0.12, th * 0.12, s * 0.3, 0.1, 0.09, 0.08, 1, 0, 0, 0, 1, KIND.BUILDING);
        yield* hall(ctx, out, tx, ty + th, d - Rd * 0.12, { w: tw * 1.15, dep: tw * 0.8, h: tw * 0.34, roofH: tw * 0.36, wall: [0.5, 0.16, 0.12], s, open: true });
      }
    }
    if (out.due()) yield;
  }
  out.limit = lim;
}

// An old stone bridge of many arches over the river, here and there where the river runs near
// the line: humped, askew to the line so that its flank shows, with people crossing.
const BRCELL = 2700;
function riverBridge(W, i) {
  return cache(W.misc, 'B' + i, () => {
    const r = makeRng(hashInts(W.ws, 1751, i));
    if (r() > 0.75) return null;
    const wx = (i + 0.2 + 0.6 * r()) * BRCELL, rn = riverN(W, wx), rw = riverW(W, wx);
    if (rn < 42 || rn + rw > 245 || villageAt(W, wx, rn - 25) || villageAt(W, wx, rn + rw + 25)) return null;
    return { wx, d0: rn - 10, d1: rn + rw + 10, skew: (r() < 0.5 ? -1 : 1) * (0.7 + 0.35 * r()), seed: hashInts(W.ws, 1752, i) };
  });
}
function* bridge(ctx, out, W, b) {
  const r = makeRng(b.seed), dm = (b.d0 + b.d1) / 2, hy = Math.hypot(1, b.skew), L = (b.d1 - b.d0) * hy;
  const ux = b.skew / hy, ud = 1 / hy, px = ud, pd = -ux;            // along the bridge, and across it
  const wy = W.H(b.wx, dm) - 0.7, yb = W.H(b.wx, b.d0), nA = Math.max(3, Math.round(L / 23)), span = L / nA, HW = 2.4;
  const s = Math.max(0.3, detail(out, dm, 1.1)), q = quatXTo(ux, 0, -ud);
  const at = (t, off) => [b.wx - ctx.x0 + (t - 0.5) * L * ux + off * px, dm + (t - 0.5) * L * ud + off * pd];
  const deck = (t) => yb + 1.0 + 7.2 * (1 - (2 * t - 1) ** 2), stone = mul3(STONE, 0.86);
  const inArch = (t, y) => {
    const k = Math.min(nA - 1, Math.floor(t * nA)), tc = (k + 0.5) / nA, a = span * 0.39, ar = Math.min(a * 1.1, deck(tc) - wy - 1.3);
    return ar > 1 && ((t - tc) * L / a) ** 2 + ((y - wy) / ar) ** 2 < 1 ? ar : 0;
  };
  note(ctx, 'bridge', b.wx, dm);
  const nu = Math.max(8, Math.round(L / (s * 1.4)));
  for (const sg of [-1, 1]) {
    const tone = faceTone(stone, sg * px, -sg * pd);
    for (let i = 0; i < nu; i++) {
      const t = (i + 0.5) / nu, top = deck(t) + 1.0, nv = Math.max(2, Math.round((top - wy) / (s * 1.4))), [x, d] = at(t, sg * HW);
      for (let j = 0; j < nv; j++) {
        const y = wy + ((j + 0.5) / nv) * (top - wy);
        if (inArch(t, y)) continue;
        const c = mul3(tone, (y > top - 1.2 ? 1.08 : 0.86 + 0.16 * noise2(t * L / 3, y / 1.5, 91)) * (0.96 + 0.08 * r()));
        out(x, y, -d, (L / nu) * 0.62, ((top - wy) / nv) * 0.62, s * 0.3, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.BUILDING);
      }
      if (out.due()) yield;
    }
  }
  // the vault of each arch, in shadow, and the roadway
  for (let k = 0; k < nA; k++) {
    const tc = (k + 0.5) / nA, a = span * 0.39, ar = Math.min(a * 1.1, deck(tc) - wy - 1.3), na = Math.max(5, Math.round((Math.PI * a) / (s * 1.6)));
    if (ar <= 1) continue;
    for (let i = 0; i < na; i++) {
      const an = ((i + 0.5) / na) * Math.PI, [x, d] = at(tc + (Math.cos(an) * a) / L, 0), c = mul3(STONE, 0.3 + 0.14 * Math.sin(an));
      out(x, wy + Math.sin(an) * ar, -d, Math.max(s, (Math.PI * a) / na * 0.6), Math.max(s, (Math.PI * ar) / na * 0.45), HW, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.BUILDING);
    }
  }
  for (let i = 0; i < nu; i += 2) { const t = (i + 1) / nu, [x, d] = at(t, 0); out(x, deck(t), -d, (L / nu) * 1.3, 0.12, HW, 0.5, 0.49, 0.45, 1, q[0], q[1], q[2], q[3], KIND.BUILDING); }
  if (!isNight(ctx)) {
    const n = 1 + Math.floor(r() * 3), yaw = Math.atan2(ud, ux) + (r() < 0.5 ? 0 : Math.PI);
    for (let i = 0; i < n; i++) {
      const t = 0.3 + 0.4 * r(), [x, d] = at(t, (r() - 0.5) * 2), f = frame(x, deck(t) + 0.1, d, yaw, PK * farK(d));
      if (r() < 0.6) { person(out, f, r, { pose: 'walk', arms: 'pole' }); shoulderPole(out, f, r); } else person(out, f, r, { pose: 'walk' });
    }
  }
}

// Where the people and animals of a chunk stand: every site is hashed from the world (a paddy
// panel, a stretch of bund, lane or bank, a village), so both chunks that share one agree. The
// trees and bamboo placed afterwards keep clear of them (hides()).
function lifeSites(ctx, W) {
  const M = 45, xa = ctx.x0 - M, xb = ctx.x0 + ctx.length + M, sites = [];
  const busy = (wx) => 0.55 + 0.9 * noise1(wx / 800, W.ws + 1500);
  // the paddies: more to a panel where the strip between the line and the river is narrow
  for (let k = 0; k + 1 < W.rows.length; k++) {
    const q = W.rows[k];
    if (q.D > 215) break;
    if (W.rows[k + 1].D < 30) continue;
    const dm0 = q.D + q.gap / 2;
    for (let j = Math.floor(xa / q.W) - 1, j1 = Math.floor(xb / q.W) + 1; j <= j1; j++) {
      const xl = colEdge(W, k, j, dm0), xr = colEdge(W, k, j + 1, dm0), cx = (xl + xr) / 2;
      if (cx < xa || cx >= xb) continue;
      const r = makeRng(hashInts(W.ws, 1501, k, j));
      const d0 = edgeD(W, k, cx), d1 = edgeD(W, k + 1, cx), d = Math.max(34, lerp(d0, d1, 0.35 + 0.3 * r()));
      if (d > d1 - 2.2 || d > 215) continue;
      const rn = riverN(W, cx), rf = rn + riverW(W, cx);
      let p;
      if (d < rn - 9) { if (d > 135) continue; p = 0.065 * Math.pow(100 / clamp(Math.min(rn - 9, 135) - 32, 12, 100), 0.8); }
      else if (d > rf + 9) p = 0.05;
      else continue;
      if (r() > p * busy(cx) * (panelInfo(W, k, j).t === P.PASTURE ? 1.8 : 1)) continue;
      const s = surface(W, cx, d);
      if (s.t !== T.PADDY || s.k !== k || s.j !== j || s.info.t === P.WOOD) continue;
      const hw = (xr - xl) / 2 - 1.2;
      if (hw < 2.5) continue;
      sites.push({ kind: 'paddy', wx: cx, d, y: s.y, pt: s.info.t, hw, half: Math.min(hw, 9), seed: hashInts(W.ws, 1502, k, j) });
    }
  }
  // the bunds between the rows, which run along the line and show whoever walks them broadside
  for (let k = 1; k < W.rows.length; k++) {
    const q = W.rows[k];
    if (q.D < 33) continue;
    if (q.D > 132) break;
    for (let i = Math.floor(xa / 90), i1 = Math.floor(xb / 90); i <= i1; i++) {
      const r = makeRng(hashInts(W.ws, 1511, k, i)), wx = (i + r()) * 90;
      if (wx < xa || wx >= xb || r() > 0.075 * busy(wx)) continue;
      const d = edgeD(W, k, wx);
      if (d < 34 || d > riverN(W, wx) - 9) continue;
      if (surface(W, wx, d - 1.5).t !== T.PADDY || surface(W, wx, d + 1.5).t !== T.PADDY || surface(W, wx - 4, d + 1.5).t !== T.PADDY || surface(W, wx + 4, d - 1.5).t !== T.PADDY) continue;
      sites.push({ kind: 'bund', wx, d, y: W.H(wx, d) + 0.32 + 0.0024 * d, half: 6, seed: hashInts(W.ws, 1512, k, i) });
    }
  }
  // the lane
  for (let i = Math.floor(xa / 70), i1 = Math.floor(xb / 70); i <= i1; i++) {
    const r = makeRng(hashInts(W.ws, 1521, i)), wx = (i + 0.1 + 0.8 * r()) * 70;
    if (wx < xa || wx >= xb || r() > 0.55) continue;
    if (!laneOn(W, wx) || !laneOn(W, wx - 8) || !laneOn(W, wx + 8)) continue;
    const ld = laneD(W, wx);
    if (ld < 35 || villageAt(W, wx, ld) || streamAt(W, wx - 5, ld) || streamAt(W, wx + 5, ld)) continue;
    sites.push({ kind: 'lane', wx, d: ld - 1.0, y: W.H(wx, ld) + 0.42, half: 7, seed: hashInts(W.ws, 1522, i) });
  }
  // a bridge over the river
  for (let i = Math.floor((xa - 60) / BRCELL), i1 = Math.floor((xb + 60) / BRCELL); i <= i1; i++) {
    const b = riverBridge(W, i);
    if (b && b.wx > xa - 60 && b.wx < xb + 60) sites.push({ kind: 'bridge', wx: b.wx - b.skew * (b.d1 - b.d0) / 2, far: b.wx + b.skew * (b.d1 - b.d0) / 2, d: b.d0, half: 12, b });
    if (b && b.wx > xa - 60 && b.wx < xb + 60) sites.push({ kind: 'clear', wx: b.wx, d: b.d1, deep: b.d1, half: Math.abs(b.skew) * (b.d1 - b.d0) / 2 + 8 });
  }
  // the near bank of the river
  for (let i = Math.floor(xa / 75), i1 = Math.floor(xb / 75); i <= i1; i++) {
    const r = makeRng(hashInts(W.ws, 1531, i)), wx = (i + r()) * 75;
    if (wx < xa || wx >= xb) continue;
    const rn = riverN(W, wx);
    if (rn < 37 || rn > 175 || r() > (rn < 60 ? 0.9 : 0.5) * busy(wx) || streamAt(W, wx, rn - 3) || sites.some((s) => s.kind === 'bridge' && Math.abs(wx - s.wx) < 20)) continue;
    sites.push({ kind: 'bank', wx, d: rn - 1.7, y: W.H(wx, rn - 1.7), half: 6, seed: hashInts(W.ws, 1532, i) });
  }
  // the villages
  for (let i = Math.floor(xa / VCELL) - 1, i1 = Math.floor(xb / VCELL) + 1; i <= i1; i++) {
    const v = village(W, i);
    if (!v || v.dc - v.Rd > 240) continue;
    for (const s of villageSpots(W, v)) if (s.wx >= xa && s.wx < xb) sites.push(s);
  }
  return sites;
}
// Would a tree w wide at (wx, d) stand in front of somebody?
function hides(sites, wx, d, w) {
  for (const s of sites) if (Math.abs(wx - s.wx) < w + s.half && d > s.d - (s.deep || 26) && d < s.d + 4) return true;
  return false;
}
function* life(ctx, out, W, sites) {
  const night = isNight(ctx);
  for (const s of sites) {
    if (s.kind === 'bridge') { yield* bridge(ctx, out, W, s.b); continue; }
    if (s.kind === 'clear') continue;
    if (s.wx < ctx.x0 - s.half - 12 || s.wx > ctx.x0 + ctx.length + s.half + 12) continue;
    const r = makeRng(s.seed);
    if (s.kind === 'lane') yield* laneScene(ctx, out, s, r, night);
    else if (s.kind === 'bank') yield* bankScene(ctx, out, s, r, night);
    else if (night) continue;
    else if (s.kind === 'paddy') yield* paddyScene(ctx, out, s, r);
    else if (s.kind === 'bund') yield* bundScene(ctx, out, s, r);
    else yield* villageScene(ctx, out, s, r);
  }
}
// An `out` that keeps nothing: runs an emitter for its random draws only.
function muteOut(out) {
  const m = () => false;
  m.n = 0; m.limit = Infinity; m.ctx = out.ctx; m.density = out.density; m.detailK = out.detailK; m.due = () => false; m.left = () => 0; m.q = () => false;
  return m;
}

// A thin straight member from a to b with a motion class (kit.js strut() has none).
function strutM(out, ax, ay, az, bx, by, bz, r, c, n, kind, move) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1e-6;
  const q = quatXTo(dx, dy, dz), sl = (len / n) * 0.45;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    out(ax + dx * t, ay + dy * t, az + dz * t, sl, r, r, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind, move);
  }
}

// A boat on the river, a handful of splats so the beat can pick it out (MOVE.BEAT): a bamboo raft
// poled by a fisherman in a conical straw hat with his cormorants, or a long-tail boat under an
// arched cane canopy flying a pennant (MOVE.FLAG). x is chunk-local, y the water level.
function* boat(ctx, out, x, y, d, r, night) {
  const B = MOVE.BEAT, K = KIND.OTHER, dir = r() < 0.5 ? -1 : 1;
  const len = 7 + 3 * r();
  // the wake and ripple, left still
  out(x, y + 0.03, -(d - 0.6), len * 0.75, 0.03, 0.5, 0.68, 0.71, 0.72, 0.55, 0, 0, 0, 1, KIND.GROUND);
  if (r() < 0.55) {
    // raft: long bamboo poles side by side, the bow turned up; the fisherman standing with his
    // pole, his cormorants perched along the bow (drawn larger than life, as all the people are)
    const kk = farK(d), f = frame(x, y + 0.14, d, dir > 0 ? 0 : Math.PI, PK * kk), hl = (len / 2 + 1) / PK;
    for (const v of [-0.42, -0.21, 0, 0.21, 0.42]) {
      const c = mul3([0.56, 0.5, 0.32], 0.85 + 0.3 * r());
      lim(out, f, f.P(-hl, 0.02, v), f.P(hl, 0.02, v), 0.07, c, 4);
      lim(out, f, f.P(hl, 0.02, v), f.P(hl + 0.75, 0.42, v), 0.06, c, 1);
    }
    const fp = sub(f, -hl * 0.45, 0, f.k, 0, 0.08);
    person(out, fp, r, { arms: 'fwd', shirt: pick([[0.14, 0.16, 0.24], [0.2, 0.3, 0.5], [0.4, 0.36, 0.3]], r) });
    lim(out, fp, fp.P(0.1, 2.6, 0.3), fp.P(1.1, -0.5, 0.75), 0.02, [0.46, 0.42, 0.26], 5);       // the pole
    ell(out, f, -hl * 0.05, 0.3, 0.1, 0.27, 0.22, 0.27, WICKER);                                     // the fish basket
    const nc = 2 + Math.floor(r() * 3);
    for (let k = 0; k < nc; k++) cormorant(out, sub(f, hl * (0.3 + 0.22 * k), (k % 2 ? 0.25 : -0.2), 1.7 * kk, r() < 0.3 ? Math.PI : 0, 0.08), k === nc - 1 && r() < 0.6);
    if (night) yield* lamp(ctx, out, x + dir * len * 0.45, y + 1.6, d, [1, 0.62, 0.3], { size: 0.12, halo: 1 });
  } else {
    // long-tail boat: dark hull, an arched canopy of cane matting, a pennant at the stern
    const hc = [0.16, 0.14, 0.12];
    out(x, y + 0.3, -d, len / 2, 0.28, 0.75, hc[0], hc[1], hc[2], 1, 0, 0, 0, 1, K, B);
    out(x + dir * len * 0.45, y + 0.55, -d, len * 0.08, 0.2, 0.45, hc[0], hc[1], hc[2], 1, 0, 0, 0, 1, K, B);   // the raised bow
    const cl = len * (0.3 + 0.15 * r());
    for (let k = 0; k < 3; k++) {
      const u = (k / 2 - 0.5) * cl;
      const c = shade([0.4, 0.32, 0.2], 0, 0.6, 0.8, 0.6, 0.45);
      out(x + u, y + 1.15, -d, cl / 5, 0.45, 0.8, c[0], c[1], c[2], 1, 0, 0, 0, 1, K, B);
    }
    out(x + dir * cl * 0.55, y + 1.15, -(d - 0.75), 0.25, 0.3, 0.05, 0.05, 0.05, 0.05, 1, 0, 0, 0, 1, K, B);   // the open end, dark inside
    const sx = x - dir * len * 0.46;
    strutM(out, sx, y + 0.5, -d, sx, y + 2.6, -d, 0.035, [0.3, 0.28, 0.24], 3, K, B);
    out(sx - dir * 0.4, y + 2.45, -d, 0.38, 0.14, 0.03, 0.74, 0.12, 0.09, 1, 0, 0, 0, 1, K, MOVE.FLAG);
    person(out, frame(sx + dir * 0.9, y + 0.55, d, dir > 0 ? 0 : Math.PI, PK * farK(d)), r, { pose: 'sit', seat: 0.1, arms: 'fwd' });
    if (night) yield* lamp(ctx, out, x, y + 1.7, d - 0.8, [1, 0.8, 0.5], { size: 0.1, halo: 1 });
  }
  if (out.due()) yield;
}

// Mist as a few rounded puffs (no wider than about six times their height) rather than one long
// smear: the shader billows a vapour splat by an amount in proportion to its size.
function mistPuffs(out, x, y, d, sx, sy, c, op, r) {
  const k = Math.max(1, Math.ceil(sx / (6 * sy)));
  const px = (sx / k) * 1.4;
  for (let i = 0; i < k; i++) {
    const f = k === 1 ? 0 : ((i + 0.5) / k) * 2 - 1;
    out(x + f * sx * 0.8, y + sy * 0.3 * (r() - 0.5), -(d + (r() - 0.5) * px * 0.5), px, sy * (0.85 + 0.3 * r()), px * 0.5, c[0], c[1], c[2], op * 0.85, 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
  }
}

// A string of red lanterns across the front of a house, or a line of washing: small things the
// beat and the wind pick out. By night the lanterns are lit.
function* frontLine(ctx, out, W, hs, d, night) {
  const r = makeRng(hashInts(hs.seed, 31));
  const span = Math.max(hs.w, hs.dep) + 1.5, xa = hs.wx - span / 2;
  const yb = W.H(hs.wx, d), washing = r() < 0.4;
  const top = yb + (washing ? 2.1 : 3.4);
  const pc = [0.32, 0.28, 0.22];
  for (const px of [xa, xa + span]) strutM(out, px - ctx.x0, yb - 0.2, -d, px - ctx.x0, top + 0.15, -d, Math.max(0.05, 0.0005 * d), pc, 3, KIND.OTHER, 0);
  const sag = 0.35;
  const n = Math.max(3, Math.round(span / (washing ? 1.1 : 1.35)));
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n, lx = xa + u * span - ctx.x0, ly = top - sag * 4 * u * (1 - u);
    // the cord: a sagging chain of struts sized from distance (it was beads of a 12 mm cord, under
    // a pixel wide, with gaps between them)
    { const u0 = k / n, u1 = (k + 1) / n;
      strutM(out, xa + u0 * span - ctx.x0, top - sag * 4 * u0 * (1 - u0), -d, xa + u1 * span - ctx.x0, top - sag * 4 * u1 * (1 - u1), -d, Math.max(0.025, 0.0005 * d), [0.2, 0.18, 0.16], 1, KIND.OTHER, 0); }
    if (washing) {
      if (r() < 0.25) continue;
      const c = [[0.72, 0.72, 0.7], [0.2, 0.3, 0.55], [0.62, 0.2, 0.16], [0.55, 0.52, 0.35], [0.3, 0.42, 0.3]][Math.floor(r() * 5)];
      const hgt = 0.35 + 0.4 * r();
      out(lx, ly - hgt, -d, 0.3 + 0.12 * r(), hgt, 0.03, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER, MOVE.FLAG);
    } else {
      const c = night ? [1, 0.3, 0.14] : [0.78, 0.13, 0.08];
      const kd = night ? KIND.LIGHT : KIND.OTHER;
      out(lx, ly - 0.42, -d, 0.21, 0.27, 0.21, c[0], c[1], c[2], 1, 0, 0, 0, 1, kd, MOVE.BEAT);
      out(lx, ly - 0.75, -d, 0.03, 0.09, 0.03, 0.72, 0.55, 0.2, 1, 0, 0, 0, 1, KIND.OTHER, MOVE.BEAT);   // tassel
      if (night) out(lx, ly - 0.42, -(d + 0.05), 0.7, 0.7, 0.3, c[0], c[1], c[2], 0.14, 0, 0, 0, 1, KIND.LIGHT, MOVE.BEAT);
    }
  }
  if (out.due()) yield;
}

// Smoke from a kitchen fire, rising from the roof and spreading as it goes (MOVE.VAPOUR).
function* smoke(ctx, out, x, y, d, r) {
  const n = 5 + Math.floor(r() * 3), drift = 0.4 + 0.5 * r();
  for (let k = 0; k < n; k++) {
    const f = k / (n - 1), s = 0.45 + 1.6 * f;
    const c = mix3([0.62, 0.62, 0.62], [0.74, 0.75, 0.76], f);
    out(x + drift * f * f * 6, y + 0.4 + f * 9, -(d + 0.3 * f), s, s * 0.8, s * 0.7, c[0], c[1], c[2], 0.3 - 0.2 * f, 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
  }
  if (out.due()) yield;
}

// ---------------------------------------------------------------------------------------------
// Placed things, shared by the bands (each draws what its centre puts in the band)
// ---------------------------------------------------------------------------------------------
function treeOf(ctx, out, t, d, y, rng, k = 1, nk = 1) {
  if (t.type === 'bamboo') return bamboo(ctx, out, t.wx - ctx.x0, d, { rng, height: (8 + 5 * rng()) * k, width: (5 + 5 * rng()) * k, y, n: Math.round(treeSplats(out, d, 10 * k) * 1.1 * nk) });
  if (t.type === 'banyan') { const H = (t.big ? 13 : 10) + 4 * rng(), Wc = H * (1.5 + 0.6 * rng()); return broadCrown(ctx, out, t.wx - ctx.x0, d, { rng, height: H, crown: Wc, banyan: true, y, n: Math.round(treeSplats(out, d, Wc) * 0.9 * nk) }); }
  const H = 9 + 6 * rng(), Wc = H * (1.0 + 0.35 * rng());
  return broadCrown(ctx, out, t.wx - ctx.x0, d, { rng, height: H, crown: Wc, y, n: Math.round(treeSplats(out, d, Wc) * 0.9 * nk) });
}

// Splats a house costs at splat size s (its walls, both roof pitches, the court wall), and what a
// village tree costs: for the village budget below.
function houseCost(hs, s) {
  const h = hs.concrete ? hs.storeys * 3.1 + 0.9 : hs.storeys * 2.9 + 0.6;
  const area = 2 * (hs.w + hs.dep) * h + hs.w * hs.dep * 1.3 + (hs.court ? (hs.w + 11) * 2.1 : 0);
  return area / (s * s * 2.25) + 60;
}
const houseS = (out, d, k) => Math.max(0.14, detail(out, d, 1.05 * k));
// A big village close to the line wants more splats than the band has: its houses used to be cut
// off part-way when the band ran out (half a house, or none, and nothing drawn after them). Each
// village gets a fixed share of the band and coarsens its houses (and thins its trees) to fit it.
// The factor depends only on the village, the band and the budget, never on the chunk, so a house
// cut by a chunk border is drawn the same by both chunks.
function villageCoarse(out, v, dLo, dHi, k, room) {
  const key = `${dLo}|${dHi}|${k}|${room}`;
  const memo = v.coarse || (v.coarse = new Map());
  let f = memo.get(key);
  if (f != null) return f;
  let cost = 0;
  for (const hs of v.houses) if (hs.d >= dLo && hs.d < dHi) cost += houseCost(hs, houseS(out, hs.d, k));
  for (const t of v.trees) if (t.d >= dLo && t.d < dHi) cost += treeSplats(out, t.d, t.type === 'banyan' ? 18 : 12) * 1.1;
  f = cost > room ? Math.sqrt(cost / room) : 1;
  memo.set(key, f);
  return f;
}

function* villages(ctx, out, W, dLo, dHi, opts = {}) {
  const lit = litShare(ctx);
  const i0 = Math.floor((ctx.x0 - 250) / VCELL), i1 = Math.floor((ctx.x0 + ctx.length + 250) / VCELL);
  const k = opts.coarse || 1;
  const room = (opts.room || 0.35) * ctx.count;
  for (let i = i0; i <= i1; i++) {
    const v = village(W, i);
    if (!v || v.dc + v.Rd < dLo - 30 || v.dc - v.Rd > dHi + 30) continue;
    const f = villageCoarse(out, v, dLo, dHi, k, room);
    for (const hs of v.houses) {
      if (hs.d < dLo || hs.d >= dHi) continue;
      if (hs.wx < ctx.x0 - 20 || hs.wx > ctx.x0 + ctx.length + 20) continue;
      const s = houseS(out, hs.d, k) * f;
      // all or nothing: a house the band has no room left for is left out whole, never cut short
      if (out.n + houseCost(hs, s) > out.limit) continue;
      const rng = makeRng(hs.seed);
      const y = W.H(hs.wx, hs.d);
      if (hs.concrete) yield* concreteHouse(ctx, out, hs.wx - ctx.x0, hs.d, { w: hs.w, depth: hs.dep, storeys: hs.storeys, wall: hs.wall, yaw: hs.yaw, rng, s, y, lit, seed: hs.seed });
      else yield* tiledHouse(ctx, out, hs.wx - ctx.x0, hs.d, { w: hs.w, depth: hs.dep, storeys: hs.storeys, wall: hs.wall, yaw: hs.yaw, rng, s, y, lit, court: hs.court && hs.d < 400, seed: hs.seed });
      if (opts.small && hs.d < 320) {
        // a string of lanterns or a line of washing in front of some houses, smoke from some kitchens
        const u = (hashInts(hs.seed, 33) & 1023) / 1023;
        const fd = hs.d - Math.max(hs.w, hs.dep) / 2 - (hs.court ? 5 : 1.8);
        if (u < 0.3 && fd >= dLo && fd < dHi && fd > 20) yield* frontLine(ctx, out, W, hs, fd, lit > 0);

        if (!hs.concrete && u > 0.78) yield* smoke(ctx, out, hs.wx - ctx.x0 + hs.w * 0.25, y + hs.storeys * 2.9 + 0.6 + hs.dep * 0.27, hs.d, makeRng(hashInts(hs.seed, 35)));
      }
    }
    if (opts.small) {
      // rice-straw ricks on the dry ground in front of the village
      const hr = makeRng(hashInts(v.seed, 61)), nh = 3 + Math.floor(hr() * 4);
      for (let q = 0; q < nh; q++) {
        const a = (hr() * 2 - 1) * 1.1 * v.R, wx = v.cx + a, d = v.dc - v.Rd * Math.sqrt(Math.max(0, 1 - (a / (1.15 * v.R)) ** 2)) - 4 - 9 * hr(), kk = 1.2 + 0.3 * hr();
        if (d < 31 || d < dLo || d >= dHi || wx < ctx.x0 - 4 || wx > ctx.x0 + ctx.length + 4) continue;
        const sf = surface(W, wx, d);
        if (sf.t !== T.PADDY || sf.info.t === P.WATER || sf.info.t === P.YOUNG || sf.info.t === P.POND || sf.info.t === P.LOTUS) continue;
        note(ctx, 'rick', wx, d);
        hayrick(out, wx - ctx.x0, sf.y, d, kk);
      }
    }
    for (const t of v.trees) {
      if (t.d < dLo || t.d >= dHi) continue;
      if (t.wx < ctx.x0 - 30 || t.wx > ctx.x0 + ctx.length + 30) continue;
      if (out.n + treeSplats(out, t.d, t.type === 'banyan' ? 36 : 20) / (f * f) > out.limit) continue;    // whole or not at all
      const rng = makeRng(t.seed);
      yield* treeOf(ctx, out, t, t.d, W.H(t.wx, t.d) - 0.2, rng, 1, 1 / (f * f));
    }
    // lamps along the village lane at night
    if (lit > 0 && opts.lamps !== false) {
      const ld = v.dc - v.Rd * 0.35;
      if (ld >= dLo && ld < dHi) {
        for (let s = -v.R; s <= v.R; s += 28) {
          const wx = v.cx + s;
          const lr = makeRng(hashInts(v.seed, 21, Math.round(s)));
          if (lr() > 0.6 || wx < ctx.x0 - 2 || wx >= ctx.x0 + ctx.length + 2) continue;
          const y = W.H(wx, ld);
          strutM(out, wx - ctx.x0, y - 0.2, -ld, wx - ctx.x0, y + 5.5, -ld, Math.max(0.08, 0.0005 * ld), [0.3, 0.3, 0.3], 3, KIND.OTHER, 0);   // a strut, not round beads
          yield* lamp(ctx, out, wx - ctx.x0, y + 5.6, ld - 0.3, LAMP, { size: Math.max(0.15, detail(out, ld, 0.6)), halo: 1 });
        }
      }
    }
  }
}

// The lane: a pale concrete strip raised a little between the paddies, with a darker bank on its
// camera side, trees and utility poles along it.
function* laneProps(ctx, out, W, dLo, dHi, sites = []) {
  const Pc = 30;
  for (const { i, wx0 } of cellsAround(ctx, Pc, 2)) {
    if (!laneOn(W, wx0 + Pc / 2)) continue;
    const r = worldRng(ctx, 613, i);
    const d0 = laneD(W, wx0 + Pc / 2);
    if (d0 < dLo || d0 >= dHi) continue;
    // the bank on the camera side: a darker raised line (lines parallel to the track need height)
    const st = Math.max(0.6, detail(out, d0, 1.6));
    for (let x = wx0 + st / 2; x < wx0 + Pc; x += st) {
      const ld = laneD(W, x), y = W.H(x, ld);
      const c = jitter(C.bank, r, 0.1);
      out(x - ctx.x0, y + 0.18, -(ld - 2.4), st * 0.7, 0.22, 0.4, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      const cl = jitter(C.lane, r, 0.04);
      out(x - ctx.x0, y + 0.38, -(ld - 1.4), st * 0.7, 0.06, 1.0, cl[0], cl[1], cl[2], 1, 0, 0, 0, 1, KIND.GROUND);
    }
    // trees along the lane, and a utility pole now and then
    if (r() < 0.55) {
      const wx = wx0 + r() * Pc, ld = laneD(W, wx) + 3.5 + r() * 2;
      if (!villageAt(W, wx, ld) && !hides(sites, wx, ld, 8)) yield* broadCrown(ctx, out, wx - ctx.x0, ld, { rng: r, height: 9 + 6 * r(), crown: 9 + 6 * r(), y: W.H(wx, ld) - 0.2 });
    }
    if ((i & 1) === 0) {
      const wx = wx0 + 3, ld = laneD(W, wx) + 2.8, y = W.H(wx, ld);
      // the pole and its cross-arm as struts sized from distance (they were stacked round blobs)
      const pr = Math.max(0.12, 0.0005 * ld);
      strutM(out, wx - ctx.x0, y - 0.2, -ld, wx - ctx.x0, y + 9, -ld, pr, [0.55, 0.54, 0.5], 4, KIND.OTHER, 0);
      strutM(out, wx - ctx.x0 - 0.9, y + 8.6, -ld, wx - ctx.x0 + 0.9, y + 8.6, -ld, pr * 0.6, [0.3, 0.3, 0.3], 2, KIND.OTHER, 0);
    }
    if (out.due()) yield;
  }
}

// Raised bunds: low grassy ridges along the paddy row edges (parallel to the track), and along
// the panel edges running away from it near the line. Explicit, because a flat strip parallel to
// the track is far less than a pixel tall from rail level.
function* bunds(ctx, out, W, dLo, dHi) {
  const Pc = 20;
  for (let k = 1; k < W.rows.length; k++) {
    const q = W.rows[k];
    if (q.D < dLo - 2) continue;
    if (q.D > dHi) break;
    const st = Math.max(0.5, detail(out, q.D, 2.2));
    for (const { wx0 } of cellsAround(ctx, Pc, 0)) {
      for (let x = wx0 + st / 2; x < wx0 + Pc; x += st) {
        const d = edgeD(W, k, x);
        if (d < dLo || d >= dHi) continue;
        const s = surface(W, x, d + 0.5);
        if (s.t !== T.PADDY) continue;
        const bh = 0.22 + 0.0015 * d;
        const c = jitter(s.info.t === P.VEG ? C.soil : C.bundLit, ctx.rng, 0.12);
        out(x - ctx.x0, s.y + bh, -d, st * 0.75, bh, Math.max(0.3, st * 0.25), c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      }
      if (out.due()) yield;
    }
  }
  // cross bunds near the line
  const dMax = Math.min(dHi, 170);
  for (let k = 0; k + 1 < W.rows.length; k++) {
    const q = W.rows[k], d0 = Math.max(q.D, dLo), d1 = Math.min(W.rows[k + 1].D, dMax);
    if (q.D > dMax) break;
    if (d1 <= d0) continue;
    const j0 = Math.floor(ctx.x0 / q.W) - 1, j1 = Math.floor((ctx.x0 + ctx.length) / q.W) + 1;
    const st = Math.max(0.35, detail(out, (d0 + d1) / 2, 1.6));
    for (let j = j0; j <= j1; j++) {
      for (let d = d0 + st / 2; d < d1; d += st) {
        const wx = colEdge(W, k, j, d);
        if (wx < ctx.x0 || wx >= ctx.x0 + ctx.length) break;
        const s = surface(W, wx + 0.3, d);
        if (s.t !== T.PADDY) continue;
        const c = jitter(C.bund, ctx.rng, 0.12);
        out(wx - ctx.x0, s.y + 0.2, -d, 0.35, 0.2, st * 0.7, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      }
      if (out.due()) yield;
    }
  }
}

// River furniture: bamboo along the banks, rafts and small boats as thin dark strokes.
function* riverProps(ctx, out, W, dLo, dHi, sites = []) {
  const Pc = 13;
  for (const { i, wx0 } of cellsAround(ctx, Pc, 6)) {
    const wx = wx0 + Pc / 2;
    const rn = riverN(W, wx), rf = rn + riverW(W, wx);
    if (rn > dHi + 20 || rf < dLo - 20) continue;
    const r = worldRng(ctx, 631, i);
    // bamboo groves along both banks, in stretches
    const grove = noise1(wx / 600, W.ws + 632);
    for (const [bd, side] of [[rn - 4, 0], [rf + 5, 1]]) {
      if (bd < dLo || bd >= dHi) { r(); r(); r(); continue; }
      if (r() > 0.25 + 0.7 * smooth(0.35, 0.7, grove) * (side ? 1 : 0.6)) { r(); r(); continue; }
      const bx = wx0 + r() * Pc;
      // a clump that would hide somebody on the bank is left out (drawn to nothing, so the draws stay the same)
      // (and the near bank is kept clear in front of the whole of a bridge)
      const o = sites.some((s) => (s.kind === 'bridge' ? (side === 0 ? bx > Math.min(s.wx, s.far) - 16 && bx < Math.max(s.wx, s.far) + 16 : Math.abs(bx - s.far) < 12) : s.what === 'market' ? s.d > bd && Math.abs(bx - s.wx) < 17 : side === 0 && s.kind === 'bank' && Math.abs(bx - s.wx) < 11)) ? muteOut(out) : out;
      yield* bamboo(ctx, o, bx - ctx.x0, bd + r() * 6, { rng: r, height: 9 + 6 * r(), width: 6 + 6 * r(), y: W.H(bx, bd) - 0.2 });
    }
    // reeds along the water's edge, in stretches: tall pale stems with tan plumes
    const reed = noise1(wx / 420, W.ws + 1621);
    if (reed > 0.5 && rn - 1 >= dLo && rn + 3 < dHi && !sites.some((s) => (s.kind === 'bridge' ? wx > Math.min(s.wx, s.far) - 18 && wx < Math.max(s.wx, s.far) + 18 : s.kind === 'bank' && Math.abs(wx - s.wx) < 14))) {
      const rr = worldRng(ctx, 1622, i), nr = 5 + Math.floor(5 * smooth(0.5, 0.8, reed));
      for (let k = 0; k < nr; k++) {
        const bx = wx0 + Pc * (0.5 + (rr() - 0.5) * rr() * 1.6), bd = riverN(W, bx) + (rr() - 0.45) * 3.6, hgt = 1.6 + 1.8 * rr(), y = W.H(bx, bd) - 0.6;
        for (let m = 0; m < 3; m++) {
          const lx = (rr() - 0.5) * 1.3, c = jitter(mix3([0.3, 0.42, 0.17], [0.44, 0.5, 0.22], rr()), rr, 0.12), q = quatXTo(lx * 0.5, 1, (rr() - 0.5) * 0.3);
          out(bx - ctx.x0 + lx, y + hgt * 0.45, -bd, hgt * 0.45, 0.2, 0.2, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.HEDGE);
        }
        if (rr() < 0.45) out(bx - ctx.x0 + (rr() - 0.5) * 0.6, y + hgt * 0.95, -bd, 0.16, 0.3, 0.16, 0.6, 0.54, 0.36, 1, 0, 0, 0, 1, KIND.HEDGE);
      }
    }
    // a raft or a boat (a separate world rng, so the bamboo above stays where it was)
    const rb = worldRng(ctx, 634, i);
    if (rb() < 0.1) {
      const bx = wx0 + rb() * Pc, bd = lerp(rn, rf, 0.15 + 0.7 * rb());
      if (bd >= dLo && bd < dHi) note(ctx, 'boat', bx, bd);
      if (bd >= dLo && bd < dHi && bx >= ctx.x0 - 6 && bx < ctx.x0 + ctx.length + 6) yield* boat(ctx, out, bx - ctx.x0, W.H(bx, bd) - 0.7, bd, rb, isNight(ctx));
    }
    if (out.due()) yield;
  }
}

// Streams and their bridges where the lane crosses; buffalo in the flooded panels.
function* streamProps(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 100) / SCELL), i1 = Math.floor((ctx.x0 + ctx.length + 100) / SCELL);
  for (let i = i0; i <= i1; i++) {
    const s = stream(W, i);
    if (!s) continue;
    const r = makeRng(s.seed);
    // banks: low grass ridges both sides
    const dTop = Math.min(dHi, riverN(W, s.x0), 700);
    for (let d = Math.max(dLo, 10); d < dTop; d += Math.max(0.6, detail(out, d, 2))) {
      for (const sg of [-1, 1]) {
        const wx = streamX(s, d) + sg * (s.w / 2 + 0.5);
        if (wx < ctx.x0 || wx >= ctx.x0 + ctx.length) continue;
        const c = jitter(C.bank, r, 0.12);
        out(wx - ctx.x0, W.H(wx, d) + 0.3, -d, 0.6, 0.35, Math.max(0.4, detail(out, d, 2)), c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      }
      if (out.due()) yield;
    }
    const ld = laneD(W, streamX(s, 60));
    const bx = streamX(s, ld);
    if (laneOn(W, bx) && ld >= dLo && ld < dHi && bx > ctx.x0 - 15 && bx < ctx.x0 + ctx.length + 15) {
      yield* archBridge(ctx, out, bx - ctx.x0, ld, { rng: r, span: s.w + 2.5, y: W.H(bx, ld) - 0.6 });
    }
  }
  // buffalo scattered over the valley floor, out to the far side of the river: lying in the
  // flooded panels, grazing the dry ones
  for (const { i, wx0 } of cellsAround(ctx, 60, 14)) {
    const r = worldRng(ctx, 641, i);
    if (r() > 0.3) continue;
    const wx = wx0 + r() * 60, d = 40 + r() * 220;
    if (d < dLo || d >= dHi) continue;
    const s = surface(W, wx, d);
    if (s.t !== T.PADDY && s.t !== T.BANK) continue;
    const wet = s.t === T.PADDY && (s.info.t === P.WATER || s.info.t === P.YOUNG || s.info.t === P.POND || s.info.t === P.LOTUS);
    const n = 1 + Math.floor(r() * 3), bk = BK * farK(d), sy = s.y;
    note(ctx, wet ? 'buffalo-wet' : 'buffalo-dry', wx, d);
    for (let k = 0; k < n; k++) {
      const bx = wx - ctx.x0 + k * 4.8 * farK(d), bd = d + (r() - 0.5) * 4, yaw = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.6;
      if (wet && r() < 0.6) { buffalo(out, frame(bx, sy - 0.02, bd, yaw, bk), r, { pose: 'wallow', egret: r() < 0.25 }); ripple(out, bx, sy, bd, 2.3 * bk, 0.55 * bk); }
      else { const wade = wet ? 0.28 : 0; buffalo(out, frame(bx, sy - wade * bk, bd, yaw, bk), r, { wade, pose: wet || r() < 0.35 ? 'stand' : 'graze', egret: r() < 0.3 }); if (wet) ripple(out, bx, sy, bd, 1.9 * bk, 0.5 * bk); }
    }
    if (out.due()) yield;
  }
}

// Mist: wide, pale, low splats lying across the valley floor and round the feet of the towers, in
// stretches that come and go with a slow world noise. Never a uniform veil.
function* mistBands(ctx, out, W, dLo, dHi, cell, size, hMax, op) {
  const g0 = Math.floor((ctx.x0 - size * 2) / cell), g1 = Math.floor((ctx.x0 + ctx.length + size * 2) / cell);
  for (let gk = Math.floor(dLo / cell); gk * cell < dHi; gk++) {
    for (let gx = g0; gx <= g1; gx++) {
      const r = worldRng(ctx, 711, gx, gk, cell);
      const wx = (gx + r()) * cell, d = (gk + r()) * cell;
      if (d < dLo || d >= dHi) continue;
      let a = mistAmt(W, wx, d);
      const rn = riverN(W, wx);
      if (d > rn - 20 && d < rn + riverW(W, wx) + 30) a = Math.min(1, a * 1.5 + 0.15);
      if (r() > a * 1.4) continue;
      const sx = size * (0.9 + 1.0 * r()), sy = hMax * (0.25 + 0.3 * r());
      const c = jitter(C.mist, r, 0.02);
      mistPuffs(out, wx - ctx.x0, W.H(wx, d) + sy * (0.6 + 0.9 * r()), d, sx, sy, c, op * (0.5 + 0.5 * r()) * Math.min(1, a * 1.5), r);
      if (out.due()) yield;
    }
  }
}

// Towers whose centres are in [dLo, dHi): drawn with splat counts from their size on screen, then
// mist wrapped round their feet (centres just in front of the foot, so they sort in front).
function* towers(ctx, out, W, dLo, dHi, K, opts = {}) {
  const L = ctx.length;
  const list = towersIn(W, ctx.x0 - 10, ctx.x0 + L + 10, dLo, dHi);
  // Each tower's count depends only on its own size and distance, and on how crowded the world is
  // within half a chunk length either side of it (never on where the chunk borders fall), so both
  // chunks that share a tower draw it with the same splats and the halves meet. (`wide` reaches far
  // enough for a tower whose centre lies outside the chunk; counts stay local, not on the cached site.)
  const room = (opts.share || 0.75) * ctx.count;
  const wide = towersIn(W, ctx.x0 - L * 0.5 - 900, ctx.x0 + L * 1.5 + 900, dLo, dHi);
  const nOf = new Map();
  for (const t of wide) nOf.set(t, towerSplats(out, t, K));
  const draw = [];
  let est = 0;
  for (const t of list) {
    let crowd = 0;
    for (const u of wide) if (Math.abs(u.wx - t.wx) < L * 0.5) crowd += nOf.get(u);
    const n = Math.max(6, Math.round(nOf.get(t) * (crowd > room ? room / crowd : 1)));
    draw.push([t, n]);
    const a = Math.max(t.wx - t.R * 1.3, ctx.x0), b = Math.min(t.wx + t.R * 1.3, ctx.x0 + L);
    est += n * clamp((b - a) / (t.R * 2.6), 0, 1);
  }
  // a last resort for a freakishly crowded chunk (it would then show a faint seam)
  const roomLeft = 0.97 * ctx.count - out.n;
  const k = est > roomLeft ? roomLeft / est : 1;
  const lim = out.limit;
  out.limit = Infinity;
  for (const [t, n0] of draw) {
    const r = makeRng(t.seed);
    const m = mistAmt(W, t.wx, t.d);
    const y = W.H(t.wx, t.d) - 1.5;
    // a little aerial perspective baked into the far ranks, so each rank is paler than the last
    const aerial = 0.22 * smooth(2500, 12000, t.d);
    yield* karstTower(ctx, out, t.wx - ctx.x0, t.d, { height: t.H, radius: t.R, rng: r, n: k < 1 ? Math.max(6, Math.round(n0 * k)) : n0, y, mist: m, aerial });
    if (opts.mist !== false && m > 0.2) {
      const mr = makeRng(t.seed ^ 0x5bd1);
      const nm = 1 + Math.floor(mr() * 3);
      for (let k = 0; k < nm; k++) {
        const sx = t.R * (1.5 + 1.3 * mr()), sy = t.H * (0.025 + 0.025 * mr());
        const c = jitter(C.mist, mr, 0.02);
        const mx = t.wx + (mr() - 0.5) * t.R * 1.5 - ctx.x0, my = y + sy * (0.5 + 0.7 * mr());
        mistPuffs(out, mx, my, t.d - t.R * (0.9 + 0.3 * mr()), sx, sy, c, Math.min(0.5, 0.12 + 0.4 * m) * (0.6 + 0.4 * mr()), mr);
      }
    }
  }
  out.limit = lim;
}

function* terraces(ctx, out, W, dLo, dHi, K) {
  const i0 = Math.floor((ctx.x0 - 300) / HCELL), i1 = Math.floor((ctx.x0 + ctx.length + 300) / HCELL);
  for (let i = i0; i <= i1; i++) {
    const t = terraceSite(W, i);
    if (!t || t.d < dLo || t.d >= dHi) continue;
    const r = makeRng(t.seed);
    const n = Math.round(clamp(K * out.density * t.R * t.Hh / (t.d * t.d), 60, 9000 * out.density));
    // drawn whole even when the band is short (a hill cut off part-way is a loose cloud of strips)
    const lim = out.limit;
    out.limit = Infinity;
    yield* terraceHill(ctx, out, t.wx - ctx.x0, t.d, { radius: t.R, radiusD: t.Rd, height: t.Hh, rng: r, n, y: W.H(t.wx, t.d) - 0.4, tea: t.tea });
    out.limit = lim;
  }
}

// A low wooded mound with a pagoda or a pavilion on it.
function* mounds(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 200) / MCELL), i1 = Math.floor((ctx.x0 + ctx.length + 200) / MCELL);
  for (let i = i0; i <= i1; i++) {
    const m = moundSite(W, i);
    if (!m || m.d < dLo || m.d >= dHi) continue;
    const lim = out.limit;
    out.limit = Infinity;       // rare and small: always drawn whole
    yield* moundWith(ctx, out, W, m.wx, m.d, m.R, m.Hm, makeRng(m.seed), m.pagoda ? 'pagoda' : 'pavilion', 0, KIND.HEDGE);
    out.limit = lim;
  }
}
function* moundWith(ctx, out, W, wx, d, R, Hm, r, what, wrong, kind, Hp = 0, body) {
  const y = W.H(wx, d) - 1;
  // enough splats that the wooded dome has a clean top edge, not a soft cloud
  const n = Math.max(60, Math.round(treeSplats(out, d, R * 1.4) * 2.2));
  yield* blob(ctx, out, wx - ctx.x0, y + Hm * 0.45, d, R, Hm * 0.6, R * 0.6, { n, color: C.camphor, rng: r, kind, inner: 0.3, amb: 0.55 });
  if (what === 'pagoda') {
    const tiers = 5 + Math.floor(r() * 3) + Math.round(wrong * 3);
    yield* pagoda(ctx, out, wx - ctx.x0, d, { rng: r, height: Hp || (26 + 12 * r()) * (1 + wrong * 0.4), s: Hp ? Math.max(0.3, detail(out, d, 0.5)) : undefined, tiers, y: y + Hm * 0.95, lean: wrong * 0.06, color: wrong ? mix3([0.66, 0.63, 0.56], [0.6, 0.5, 0.52], wrong) : body, kind: kind === KIND.SURREAL ? KIND.SURREAL : KIND.BUILDING });
  } else {
    yield* pavilion(ctx, out, wx - ctx.x0, d, { rng: r, size: 6 + 2 * r(), y: y + Hm * 0.95, kind: kind === KIND.SURREAL ? KIND.SURREAL : KIND.BUILDING });
  }
}

// Lineside: platforms and level crossings now and then.
const PFCELL = 2900, LXCELL = 1700;
function platform(W, i) {
  return cache(W.misc, 'p' + i, () => {
    const r = makeRng(hashInts(W.ws, 951, i));
    if (r() > 0.32) return null;
    return { x0: (i + 0.1 + 0.5 * r()) * PFCELL, len: 90 + 50 * r(), seed: hashInts(W.ws, 952, i) };
  });
}
function crossing(W, i) {
  return cache(W.misc, 'x' + i, () => {
    const r = makeRng(hashInts(W.ws, 961, i));
    const wx = (i + 0.2 + 0.6 * r()) * LXCELL;
    if (r() > 0.4 || !laneOn(W, wx)) return null;
    const pf = platform(W, Math.floor(wx / PFCELL));
    if (pf && wx > pf.x0 - 30 && wx < pf.x0 + pf.len + 30) return null;
    return { wx, seed: hashInts(W.ws, 962, i) };
  });
}
// The crossing lane running out from the line to the parallel lane.
function* crossingLanes(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 10) / LXCELL), i1 = Math.floor((ctx.x0 + ctx.length + 10) / LXCELL);
  for (let i = i0; i <= i1; i++) {
    const c = crossing(W, i);
    if (!c) continue;
    const r = makeRng(c.seed);
    const dEnd = Math.min(dHi, laneD(W, c.wx));
    const st = 0.5;
    for (let d = Math.max(dLo, 2.6); d < dEnd; d += st * Math.max(1, d / 20)) {
      const sd = st * Math.max(1, d / 20);
      for (let u = -2.4; u <= 2.4; u += 0.8) {
        const wx = c.wx + u;
        if (wx < ctx.x0 || wx >= ctx.x0 + ctx.length) continue;
        const y = d < 8 ? Math.max(W.H(wx, d), -0.2 - (d - 3) * 0.25) : W.H(wx, d) + 0.3;
        const col = jitter(C.lane, r, 0.05);
        out(wx - ctx.x0, y + 0.04, -d, 0.55, 0.05, sd * 0.7, col[0], col[1], col[2], 1, 0, 0, 0, 1, KIND.GROUND);
      }
      if (out.due()) yield;
    }
    // barrier posts with raised striped booms, beyond 6 m
    if (dLo < 7) {
      for (const u of [-3.3, 3.3]) {
        const wx = c.wx + u;
        if (wx < ctx.x0 || wx >= ctx.x0 + ctx.length) continue;
        const y = W.H(wx, 6.8);
        yield* stick(ctx, out, wx - ctx.x0, y, 6.8, 1.3, 0.12, { color: [0.6, 0.6, 0.58], kind: KIND.OTHER, n: 3 });
        for (let k = 0; k < 8; k++) {
          const c2 = k % 2 ? [0.72, 0.72, 0.7] : [0.62, 0.12, 0.1];
          out(wx - ctx.x0, y + 1.5 + k * 0.5, -6.8, 0.06, 0.25, 0.06, c2[0], c2[1], c2[2], 1, 0, 0, 0, 1, KIND.OTHER);
        }
        if (isNight(ctx)) yield* lamp(ctx, out, wx - ctx.x0, y + 1.25, 6.6, [1, 0.25, 0.15], { size: 0.06, halo: 0.6 });
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------------------------
function* trackside(ctx, emit) {
  const out = makeOut(ctx, emit, { zMargin: 1, detailK: 1.2 });
  const W = world(ctx);
  const N = ctx.count;
  out.limit = N * 0.55;

  // overhead line: masts every beat of world x, the field-side wires between them
  yield* overheadLine(ctx, out, ctx.beatMetres || 56, { d: 3.7 });

  // concrete cable trough along the cess: continuous along x, so it stays crisp under blur
  const tStep = 0.45 / Math.min(1, Math.sqrt(out.density));
  for (let x = tStep / 2; x < ctx.length; x += tStep) {
    const y = Math.max(groundY(ctx, x, 4.5), -0.6) + 0.12;
    out(x, y, -4.5, tStep * 0.68, 0.1, 0.22, 0.6, 0.59, 0.55, 1, 0, 0, 0, 1, KIND.OTHER);
    out(x, y - 0.05, -4.32, tStep * 0.68, 0.09, 0.02, 0.47, 0.46, 0.43, 1, 0, 0, 0, 1, KIND.OTHER);
    if (out.due()) yield;
  }

  // platform now and then: a low concrete slab with a yellow line, lamp posts and a shelter beyond
  const lit = isNight(ctx);
  const i0 = Math.floor((ctx.x0 - 200) / PFCELL), i1 = Math.floor((ctx.x0 + ctx.length) / PFCELL);
  const onPlatform = (wx) => { const pf = platform(W, Math.floor(wx / PFCELL)); return pf && wx >= pf.x0 && wx < pf.x0 + pf.len ? pf : null; };
  for (let i = i0; i <= i1; i++) {
    const pf = platform(W, i);
    if (!pf) continue;
    const a = Math.max(0, pf.x0 - ctx.x0), b = Math.min(ctx.length, pf.x0 + pf.len - ctx.x0);
    if (b <= a) continue;
    const st = 0.4;
    for (let x = a + st / 2; x < b; x += st) {
      out(x, 0.3, -2.75, st * 0.7, 0.3, 0.1, 0.5, 0.49, 0.46, 1, 0, 0, 0, 1, KIND.OTHER);           // face
      for (let d = 2.9; d < 6.2; d += 0.45) {
        const c = d < 3.5 && d > 3.25 ? [0.7, 0.6, 0.2] : jitter([0.56, 0.55, 0.52], ctx.rng, 0.04);
        out(x, 0.58, -d, st * 0.7, 0.04, 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
      }
      if (out.due()) yield;
    }
    for (let wx = Math.ceil(pf.x0 / 20) * 20; wx < pf.x0 + pf.len; wx += 20) {
      const x = wx - ctx.x0;
      if (x < 0 || x >= ctx.length) continue;
      yield* stick(ctx, out, x, 0.6, 6.4, 4.6, 0.07, { color: [0.4, 0.42, 0.42], kind: KIND.OTHER, n: 6 });
      if (lit) yield* lamp(ctx, out, x, 5.2, 6.4, LAMP, { size: 0.09 });
      else out(x, 5.2, -6.4, 0.25, 0.08, 0.12, 0.35, 0.36, 0.36, 1, 0, 0, 0, 1, KIND.OTHER);
    }
    const sx = pf.x0 + pf.len * 0.5 - ctx.x0;
    if (sx > -20 && sx < ctx.length + 20) {
      // shelter: posts and a flat canopy
      for (let u = -6; u <= 6; u += 4) yield* stick(ctx, out, sx + u, 0.6, 7.6, 2.6, 0.08, { color: [0.36, 0.38, 0.4], kind: KIND.OTHER, n: 4 });
      for (let u = -7; u <= 7; u += 0.5) for (let dd = 6.8; dd < 9.2; dd += 0.6) out(sx + u, 3.3, -dd, 0.35, 0.08, 0.4, 0.42, 0.44, 0.46, 1, 0, 0, 0, 1, KIND.OTHER);
    }
  }

  // the boundary: a green wire-mesh fence on concrete posts (beyond 6 m)
  const FD = 7.4;
  for (const { i, x } of cellsAround(ctx, 2.5, 0)) {
    if (x < 0 || x >= ctx.length) continue;
    const y0 = groundY(ctx, x, FD);
    for (let t = 0.1; t < 1.9; t += 0.25) out(x, y0 + t, -FD, 0.06, 0.15, 0.06, 0.55, 0.55, 0.52, 1, 0, 0, 0, 1, KIND.FENCE);
    void i;
    if (out.due()) yield;
  }
  const mStep = 0.3 / Math.min(1, Math.sqrt(out.density));
  for (let x = mStep / 2; x < ctx.length; x += mStep) {
    const y0 = groundY(ctx, x, FD);
    for (let t = 0.25; t < 1.85; t += 0.4) out(x, y0 + t, -FD - 0.02, mStep * 0.7, 0.2, 0.02, 0.18, 0.32, 0.2, 0.45, 0, 0, 0, 1, KIND.FENCE);
    out(x, y0 + 1.82, -FD - 0.02, mStep * 0.7, 0.025, 0.025, 0.16, 0.26, 0.17, 1, 0, 0, 0, 1, KIND.FENCE);
    if (out.due()) yield;
  }

  // the irrigation ditch at the foot of the bank: concrete lips and dark water
  const dStep = 0.4 / Math.min(1, Math.sqrt(out.density));
  for (let x = dStep / 2; x < ctx.length; x += dStep) {
    const wx = ctx.x0 + x;
    const st = streamAt(W, wx, 9);
    if (st) continue;
    const y = groundY(ctx, x, 9.3);
    out(x, y + 0.05, -8.6, dStep * 0.7, 0.08, 0.14, 0.58, 0.57, 0.53, 1, 0, 0, 0, 1, KIND.OTHER);
    const wc = jitter([0.3, 0.36, 0.34], ctx.rng, 0.06);
    out(x, y - 0.2, -9.3, dStep * 0.7, 0.03, 0.55, wc[0], wc[1], wc[2], 1, 0, 0, 0, 1, KIND.GROUND);
    out(x, y + 0.05, -10.0, dStep * 0.7, 0.08, 0.14, 0.52, 0.51, 0.48, 1, 0, 0, 0, 1, KIND.OTHER);
    if (out.due()) yield;
  }

  // vegetable plots, banana plants and bamboo close to the line, in stretches
  const plotOn = (wx) => noise1(wx / 450, W.ws + 1001) > 0.68;
  for (const { i, wx0 } of cellsAround(ctx, 6, 4)) {
    const r = worldRng(ctx, 1002, i);
    const wx = wx0 + r() * 6;
    if (onPlatform(wx) && r() < 2) { r(); }
    if (plotOn(wx) && r() < 0.45) {
      const d = 11 + r() * 14;
      const s = surface(W, wx, d);
      if (s.t === T.PADDY) yield* banana(ctx, out, wx - ctx.x0, d, { rng: r, height: 2.4 + 1.6 * r(), y: s.y - 0.1 });
    }
  }
  for (const { i, wx0 } of cellsAround(ctx, 11, 9)) {
    const r = worldRng(ctx, 1003, i);
    const dense = smooth(0.45, 0.8, noise1(wx0 / 380, W.ws + 1004));
    if (r() > 0.02 + 0.55 * dense * dense) continue;
    const wx = wx0 + r() * 14, d = 11.5 + Math.pow(r(), 1.3) * 17;
    const s = surface(W, wx, d);
    if (s.t === T.RIVER || s.t === T.LANE || s.t === T.STREAM || s.t === T.VILLAGE) continue;
    if (plotOn(wx) && d < 25) continue;
    yield* bamboo(ctx, out, wx - ctx.x0, d, { rng: r, height: 7 + 6 * r(), width: 4 + 4 * r(), y: s.y - 0.1, n: Math.round(clamp(2000 * out.density * (12 / d), 300, 3000 * out.density)) });
    if (out.n > out.limit) break;
  }
  yield* crossingLanes(ctx, out, W, 2.5, ctx.zFar);
  yield* villages(ctx, out, W, ctx.zNear + 8, ctx.zFar, { lamps: false });
  yield* bunds(ctx, out, W, 11, ctx.zFar);

  // ground: ballast, cess, the grassy bank down to the ditch, then the plots and the paddies
  out.limit = Infinity;
  const rest = out.left();
  yield* fillStrip(ctx, out, Math.round(rest * 0.05), 2.5, 4.2, (wx, d, rng) => jitter(PAL.ballast, rng, 0.25), 0, 0.12);
  yield* fillStrip(ctx, out, Math.round(rest * 0.035), 4.2, 5.4, (wx, d, rng) => jitter([0.4, 0.37, 0.31], rng, 0.18), 0, 0.12);
  yield* fillStrip(ctx, out, Math.round(rest * 0.12), 5.4, 8.6, (wx, d, rng) => {
    const a = noise2(wx / 2.5, d / 1.5, W.ws + 1005);
    return jitter(a < 0.4 ? [0.27, 0.38, 0.14] : a < 0.75 ? [0.33, 0.44, 0.18] : [0.42, 0.42, 0.24], rng, 0.15);
  }, 0.25, 0.45);
  yield* fillSurface(ctx, out, W, {
    dNear: 10, power: 1.2, cover: 4.2, tuft: 30,
    hook: (s, wx, d, c) => {
      if (d < 26 && plotOn(wx) && s.t === T.PADDY) {
        // kitchen plots by the line: leafy rows on dark soil
        // rows run along the line, so they read as lines under motion blur
        const row = Math.sin(d * 3.1 + 2 * noise1(wx / 9, W.ws + 1006)) > -0.2;
        return row ? jitter(mul3(C.vegRow, 1.1), ctx.rng, 0.15) : jitter(mix3(C.soil, C.vegRow, 0.3), ctx.rng, 0.1);
      }
      return c;
    },
  });
}

// Dense ground strip for the trackside layers (lift raises it into tufts).
function* fillStrip(ctx, out, n, dn, df, color, lift = 0, round = 0.12) {
  const rng = ctx.rng;
  const area = ctx.length * (df - dn);
  const r = Math.sqrt((4 * area) / (Math.PI * Math.max(1, n)));
  for (let i = 0; i < n; i++) {
    const x = rng() * ctx.length, d = dn + rng() * (df - dn);
    const c = color(ctx.x0 + x, d, rng);
    const y = ctx.terrain.height(ctx.x0 + x, d);
    out(x, y + lift * rng() + 0.02, -d, r * (0.8 + 0.5 * rng()), r * round, r * 0.6, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
}

function* near(ctx, emit) {
  const out = makeOut(ctx, emit, { detailK: 1.15 });
  const W = world(ctx);
  const dz = ctx.dials || {};
  out.limit = ctx.count * 0.58;
  // the people and the working animals first, so that no budget is too small for them
  const sites = lifeSites(ctx, W);
  yield* life(ctx, out, W, sites);
  yield* bunds(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* laneProps(ctx, out, W, ctx.zNear, ctx.zFar, sites);
  yield* crossingLanes(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* streamProps(ctx, out, W, ctx.zNear, ctx.zFar);
  // the river's boats and bamboo and the terraced hills before the villages, so a big village
  // never leaves them out
  yield* riverProps(ctx, out, W, ctx.zNear, ctx.zFar, sites);
  yield* terraces(ctx, out, W, ctx.zNear, ctx.zFar, 40000);
  yield* villages(ctx, out, W, ctx.zNear, ctx.zFar, { small: true });
  // the orchards, woods and lotus after the villages, each panel whole or not at all, so that
  // they never take a village's houses
  yield* zoneProps(ctx, out, W, 26, ctx.zFar, sites);
  // scattered field trees and bamboo clumps by the paddies
  for (const { i, wx0 } of cellsAround(ctx, 45, 12)) {
    const r = worldRng(ctx, 1101, i);
    if (r() > 0.3) continue;
    const wx = wx0 + r() * 45, d = 40 + r() * 250;
    const s = surface(W, wx, d);
    if (s.t !== T.PADDY && s.t !== T.BANK) continue;
    if (hides(sites, wx, d, 9)) continue;                                // not in front of somebody
    if (out.n + treeSplats(out, d, 14) * 1.3 > out.limit) continue;      // whole or not at all
    if (r() < 0.45) yield* bamboo(ctx, out, wx - ctx.x0, d, { rng: r, height: 8 + 5 * r(), width: 5 + 5 * r(), y: s.y - 0.2 });
    else yield* broadCrown(ctx, out, wx - ctx.x0, d, { rng: r, height: 9 + 7 * r(), crown: 10 + 8 * r(), y: s.y - 0.2 });
  }
  if ((dz.logic || 0) > 0) { /* the repeating pagoda stands in the mid band */ }
  yield* mistBands(ctx, out, W, 45, ctx.zFar, 55, 35, 5, 0.22);
  yield* fillSurface(ctx, out, W, { power: 1.5, cover: 3.2 });
}

function* mid(ctx, emit) {
  const out = makeOut(ctx, emit, { detailK: 1.7, zMargin: 260 });
  const W = world(ctx);
  const dz = ctx.dials || {};
  out.limit = ctx.count * 0.9;
  // level 1's floating and impossibly tall towers first, drawn whole: the ordinary towers below
  // make room for them (towers() fits itself to what is left). Drawn after, they used to be cut
  // off part-way in crowded chunks, leaving a loose scatter of rock in the sky.
  out.limit = Infinity;
  if ((dz.topology || 0) > 0) yield* floatingTowers(ctx, out, W, 1700, 800, 2600, dz.topology, 1);
  if ((dz.scale || 0) > 0) yield* needles(ctx, out, W, 2100, 900, 2800, dz.scale, 1);
  // the landmarks: whole, and the towers below fit themselves to what is left
  yield* landmarks(ctx, out, W, ctx.zNear, ctx.zFar);
  out.limit = ctx.count * 0.9;
  // the towers take most of the band: the valley floor from 300 m out is a thin strip on screen.
  // (the same K in the far band, so towers keep their grain across 3000 m)
  yield* towers(ctx, out, W, ctx.zNear, ctx.zFar, TOWER_K, { share: 0.8 });
  yield* mounds(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* terraces(ctx, out, W, ctx.zNear, ctx.zFar, 30000);
  yield* villages(ctx, out, W, ctx.zNear, ctx.zFar, { coarse: 1.3 });
  yield* zoneProps(ctx, out, W, ctx.zNear, ctx.zFar, []);
  // groves of dark trees and bamboo standing on the valley floor between the towers
  for (const { i, wx0 } of cellsAround(ctx, 90, 30)) {
    const r = worldRng(ctx, 1201, i);
    for (let k = 0; k < 2; k++) {
      if (r() > 0.5) { r(); r(); continue; }
      const wx = wx0 + r() * 90, d = 300 + Math.pow(r(), 1.6) * 1700;
      const s = surface(W, wx, d);
      if (s.t === T.RIVER || s.t === T.GRAVEL) continue;
      const Wd = 20 + 40 * r(), gh = 6 + 3 * r();
      // enough splats, each no bigger than fine detail here, that the grove's top is a clean line
      const gs = detail(out, d, 0.9);
      const gn = Math.round(clamp(Wd * gh * 3 / (gs * gs), 24, 600));
      const gc = r() < 0.3 ? C.bambooLeaf : C.camphor;
      // all or nothing: a grove cut off part-way by the band's limit is a thin scatter of dots
      if (out.n + gn > out.limit) continue;
      yield* blob(ctx, out, wx - ctx.x0, s.y + 6, d, Wd, gh, Wd * 0.3, { n: gn, color: gc, rng: r, kind: KIND.HEDGE, inner: 0.3, amb: 0.55 });

    }
  }
  if ((dz.logic || 0) > 0) yield* repeatingPagoda(ctx, out, W, dz.logic);
  yield* mistBands(ctx, out, W, ctx.zNear, 2400, 160, 130, 26, 0.3);
  yield* fillSurface(ctx, out, W, { power: 1.2, cover: 3, maxR: 0.05 });
}

// Far: rank upon rank of towers fading into the haze, mist lying between the ranks, and the low
// dark hills beyond. Base colours stay dark and contrasty; the shader's haze does the paling.
function* far(ctx, emit) {
  const out = makeOut(ctx, emit, { zMargin: 600 });
  const W = world(ctx);
  const dz = ctx.dials || {};
  // (level 1's surreal towers first and whole, as in mid)
  out.limit = Infinity;
  if ((dz.topology || 0) > 0) yield* floatingTowers(ctx, out, W, 5000, 3500, 8000, dz.topology, 3);
  if ((dz.scale || 0) > 0) yield* needles(ctx, out, W, 5200, 3500, 9000, dz.scale, 2);
  out.limit = ctx.count * 0.88;
  yield* towers(ctx, out, W, ctx.zNear, ctx.zFar, TOWER_K, { share: 0.82 });
  yield* mistBands(ctx, out, W, ctx.zNear, 9000, 700, 650, 70, 0.22);
  out.limit = Infinity;
  const ws = W.ws;
  yield* fillSurfaceFar(ctx, out, W, ws);
}
function* fillSurfaceFar(ctx, out, W, ws) {
  const n = out.left();
  const rng = ctx.rng, L = ctx.length, dn = ctx.zNear, df = ctx.zFar;
  const Z = Math.log(df / dn);
  for (let i = 0; i < n; i++) {
    const d = dn * Math.pow(df / dn, (i + rng()) / n);
    const x = rng() * L, wx = ctx.x0 + x;
    const dens = (n / d / Z) / L;
    const r = clamp(Math.sqrt(2.8 / (Math.PI * dens)), 0.0012 * d, 0.03 * d);
    const y = W.H(wx, d);
    const e = Math.max(30, r);
    const hx = (W.H(wx + e, d) - y) / e, hd = (W.H(wx, d + e) - y) / e;
    const nn = norm3(-hx, 1, hd);
    // the valley floor green; the far hills dark wooded blue-green
    let c = mix3(PAL.ground, [0.24, 0.34, 0.2], noise2(wx / 900, d / 900, ws + 1301));
    c = mix3(c, C.farMount, smooth(15, 90, y));
    c = shade(c, nn[0], nn[1], nn[2], 0.45, 0.7);
    c = jitter(c, rng, 0.05);
    const q = quatUpTo(nn[0], nn[1], nn[2]);
    out(x, y, -d, r * 1.2, r * 0.15, r * 0.7, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Level 1
// ---------------------------------------------------------------------------------------------

// Scale: towers of impossible height and thinness, their tops dissolving into the sky.
function* needles(ctx, out, W, cell, dLo, dHi, amount, salt) {
  for (const { i, wx0 } of cellsAround(ctx, cell, 200)) {
    const r = worldRng(ctx, 1401, salt, i);
    if (r() > 0.6 * amount) continue;
    const wx = wx0 + r() * cell, d = dLo + r() * (dHi - dLo);
    const H = (d * 0.55 + 400) * (1 + 1.2 * r()) * amount, R = 25 + 0.02 * d + 30 * r();
    const y = W.H(wx, d) - 2;
    const n = Math.round(clamp(110000 * out.density * R * H / (d * d), 60, 6000 * out.density));
    yield* karstTower(ctx, out, wx - ctx.x0, d, { height: H, radius: R, rng: r, n, y, kind: KIND.SURREAL, thin: 1, green: 0.55, fadeTop: y + H * 0.55, mist: mistAmt(W, wx, d) });
  }
}

// Topology: towers floating clear of the valley with roots of rock and trailing vegetation.
function* floatingTowers(ctx, out, W, cell, dLo, dHi, amount, salt) {
  for (const { i, wx0 } of cellsAround(ctx, cell, 300)) {
    const r = worldRng(ctx, 1411, salt, i);
    if (r() > 0.6 * amount) continue;
    const wx = wx0 + r() * cell, d = dLo + r() * (dHi - dLo);
    const H = 70 + 110 * r() * (1 + d / 6000), R = H * (0.3 + 0.15 * r());
    const lift = (60 + 0.12 * d + 200 * r()) * amount;
    const y = W.H(wx, d) + lift;
    const n = Math.round(clamp(80000 * out.density * R * H / (d * d), 40, 6000 * out.density));
    yield* karstTower(ctx, out, wx - ctx.x0, d, { height: H, radius: R, rng: r, n, y, kind: KIND.SURREAL, green: 0.7 });
    // the root: an inverted cone of rock tapering below, with vegetation trailing from its rim
    const rootH = R * (1.2 + 0.8 * r());
    const nr = Math.round(n * 0.4);
    const salt2 = Math.floor(r() * 9999);
    for (let k = 0; k < nr; k++) {
      const f = Math.pow(r(), 0.8), a = (r() * 2 - 1) * 2.2;
      const rr = R * 1.15 * Math.pow(1 - f, 1.3) * (0.9 + 0.2 * noise1(a * 3, salt2));
      const nx = Math.sin(a), nz = Math.cos(a);
      let c = mix3(C.rock, [0.42, 0.38, 0.33], 0.4 + 0.4 * f);
      c = shade(mix3(c, C.streak, smooth(0.5, 0.8, noise2(a * 4, f * 6, salt2))), nx, -0.5, nz, 0.4, 0.35);
      const s = Math.max(R * 0.08, Math.sqrt(4.4 * R * rootH / nr) * 0.9);
      out(wx + nx * rr - ctx.x0, y - f * rootH, -(d - nz * rr), s, s * 0.8, s * 0.5, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.SURREAL);
      if (out.due()) yield;
    }
    const nv = Math.round(n * 0.12);
    for (let k = 0; k < nv; k++) {
      const a = (r() * 2 - 1) * 2, len = R * (0.2 + 0.8 * r());
      const rr = R * 1.1;
      const c = jitter(mix3(C.veg, C.vegLit, r()), r, 0.1);
      out(wx + Math.sin(a) * rr - ctx.x0, y - len * 0.5, -(d - Math.cos(a) * rr), Math.max(0.8, R * 0.03), len * 0.5, Math.max(0.8, R * 0.03), c[0], c[1], c[2], 0.9, 0, 0, 0, 1, KIND.SURREAL);
      if (out.due()) yield;
    }
  }
}

// Logic: the same pagoda on the same mound every 640 m in repeating stretches, each copy a little
// more wrong (another tier, a growing lean, the plaster drifting rose).
function* repeatingPagoda(ctx, out, W, logic) {
  const Pc = 640;
  for (const { i, wx0 } of cellsAround(ctx, Pc, 80)) {
    if (noise1(wx0 / 4200, W.ws + 1431) > 0.3 + logic) continue;
    const wrong = ((((i % 5) + 5) % 5) / 4) * logic * 2;
    const d = 340;
    const lim = out.limit;
    out.limit = Infinity;       // drawn whole, as mounds() does
    yield* moundWith(ctx, out, W, wx0 + Pc * 0.5, d, 50, 16, worldRng(ctx, 1432), 'pagoda', wrong, KIND.SURREAL);
    out.limit = lim;
  }
}

export const karstBiome = {
  name: 'karst',
  palette: PAL,
  // A flat valley floor below an embankment, with relief only far off: the towers are props.
  terrain: TERRAIN,
  hazeDist: 5000,
  // a little less to the trackside (mostly ground under motion blur), more to the towers
  shares: { trackside: 0.15, near: 0.39, mid: 0.27, far: 0.19 },
  // The towers and hills are the scenery, so they stay still on the beat. What answers it: houses,
  // pagodas and pavilions (BUILDING), trees and bamboo clumps (TREE; hill crowns, groves and mounds
  // are HEDGE), and, tagged MOVE.BEAT by hand, the people and animals (in the fields, on the
  // bunds, the lane, the river bank and the rafts, in the villages), market awnings, lotus flowers
  // and the lanterns strung in the villages. Lights always do.
  beatKinds: [KIND.BUILDING, KIND.TREE],


  generators: { trackside, near, mid, far },
};

// for scripts that inspect the layout
export const _debug = { world, surface, towersIn, riverN, riverW, village, terraceSite, moundSite, stream, streamX, laneD, laneOn, landUse: (W, wx) => ({ ...landUse(W, wx) }), landmark, riverBridge };
