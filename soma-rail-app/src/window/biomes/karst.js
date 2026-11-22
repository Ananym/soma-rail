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
// The beat: the towers and hills stay still (beatKinds below); houses, pagodas, trees, boats,
// buffalo and village lanterns answer it. Mist and kitchen smoke billow (MOVE.VAPOUR), washing and
// boat pennants flutter (MOVE.FLAG).
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
const P = { WATER: 0, YOUNG: 1, RICE: 2, MUD: 3, VEG: 4, POND: 5 };

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
    return { t, tone: 0.92 + 0.16 * r(), green: 0.3 + 0.4 * r(), dir: r() < 0.55, period: 1.4 + 1.2 * r(), muddy: r() < 0.25 ? 0.3 + 0.5 * r() : 0, buffalo: t === P.WATER && r() < 0.07 };
  });
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
    if (r() > 0.4 || noise1(i * HCELL / 5000, W.ws + 932) < 0.35) return null;
    const near = r() < 0.35;
    const wx = (i + 0.2 + 0.6 * r()) * HCELL;
    const d = near ? 150 + 70 * r() : 460 + 700 * r();
    const R = near ? 55 + 25 * r() : 120 + 130 * r();
    const Hh = near ? 22 + 14 * r() : 34 + 45 * r();
    const rn = riverN(W, wx);
    if (d - R * 0.6 < rn + riverW(W, wx) + 10 && d + R * 0.6 > rn - 10) return null;
    if (villageAt(W, wx, d)) return null;
    return { wx, d, R, Rd: R * (0.5 + 0.2 * r()), Hh, seed: hashInts(W.ws, 933, i) };
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
  if (S.info.t === P.WATER || S.info.t === P.YOUNG || S.info.t === P.POND) S.y = h + 0.05;
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
      const crop = s.t === T.PADDY && (s.info.t === P.RICE || s.info.t === P.VEG) ? 0.25 : 0;
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
    const water = (hashInts(salt, k) & 3) !== 0;
    const lipC = water ? C.paddyWater : C.youngRice;
    const ringL = 2 * AM * R * e;
    const sx = Math.max(0.3, ringL / m * 0.75);
    for (let i = 0; i < m; i++) {
      const a = (i + rng()) / m * 2 * AM - AM;
      const lu = lump(a, hk);
      const px = x + Math.sin(a) * R * e * lu, pd = d - Math.cos(a) * Rd * e * lu;
      const nx = Math.sin(a), nz = Math.cos(a);
      const qq = quatYaw(a);
      // the riser: a grassy, shaded bank
      const cr = jitter(shade(mix3([0.18, 0.26, 0.1], [0.3, 0.28, 0.2], rng() * 0.4), nx, 0.15, nz, 0.5, 0.6), rng, 0.08);
      out.q(px, y0 + hk + step * 0.5, -pd, sx, step * 0.5, Math.max(0.2, sx * 0.2), cr, 1, qq, kind);
      // the lip of the panel above it (and a little of the panel surface behind)
      const c = jitter(shade(lipC, nx * 0.2, 1, nz * 0.2, 0.75, 0.3), rng, 0.05);
      const pw = (e - e2) * Rd * lu;
      out.q(px - Math.sin(a) * pw * 0.3, y0 + hk + step * 0.98, -(pd + Math.cos(a) * pw * 0.3), sx, Math.max(0.12, step * 0.07), Math.max(0.3, pw * 0.5), c, 1, qq, kind);
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

// A water buffalo standing in a paddy: a dark heavy body, head low, swept-back horns, now and then
// a white egret riding on its back. One of the few things that answer the beat (MOVE.BEAT), so it
// is a handful of splats; the ripple round it in flooded panels does not.
function* buffalo(ctx, out, x, y, d, rng, wet = true) {
  const c = [0.15, 0.14, 0.14], dir = rng() < 0.5 ? -1 : 1, B = MOVE.BEAT, K = KIND.OTHER;
  out(x, y + 0.75, -d, 1.15, 0.5, 0.55, c[0], c[1], c[2], 1, 0, 0, 0, 1, K, B);
  out(x + dir * 1.25, y + 0.7, -d, 0.35, 0.3, 0.28, c[0] * 0.9, c[1] * 0.9, c[2] * 0.9, 1, 0, 0, 0, 1, K, B);
  out(x + dir * 1.15, y + 1.0, -d, 0.45, 0.06, 0.08, 0.3, 0.28, 0.25, 1, 0, 0, 0, 1, K, B);
  if (!wet) for (const lx of [-0.75, 0.75]) out(x + lx, y + 0.25, -d, 0.12, 0.3, 0.12, c[0], c[1], c[2], 1, 0, 0, 0, 1, K, B);
  if (rng() < 0.3) out(x - dir * 0.3, y + 1.32, -d, 0.17, 0.12, 0.1, 0.78, 0.78, 0.74, 1, 0, 0, 0, 1, K, B);   // egret
  if (wet) out(x, y + 0.1, -d, 1.5, 0.04, 0.6, 0.35, 0.38, 0.36, 0.8, 0, 0, 0, 1, KIND.GROUND);      // ripple
  if (out.due()) yield;
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
  const len = 6 + 3 * r();
  // the wake and ripple, left still
  out(x, y + 0.03, -(d - 0.6), len * 0.75, 0.03, 0.5, 0.68, 0.71, 0.72, 0.55, 0, 0, 0, 1, KIND.GROUND);
  if (r() < 0.55) {
    // raft: bamboo poles side by side
    for (const dz of [-0.4, 0, 0.4]) {
      const k = 0.9 + 0.2 * r();
      out(x, y + 0.12, -(d + dz), len / 2, 0.1, 0.2, 0.52 * k, 0.46 * k, 0.3 * k, 1, 0, 0, 0, 1, K, B);
    }
    const fx = x - dir * len * 0.22;
    out(fx, y + 0.95, -d, 0.22, 0.5, 0.18, 0.12, 0.13, 0.17, 1, 0, 0, 0, 1, K, B);          // dark clothes
    out(fx, y + 1.55, -d, 0.12, 0.13, 0.12, 0.42, 0.31, 0.24, 1, 0, 0, 0, 1, K, B);          // head
    out(fx, y + 1.7, -d, 0.45, 0.07, 0.45, 0.74, 0.65, 0.45, 1, 0, 0, 0, 1, K, B);           // straw hat
    strutM(out, fx - dir * 0.4, y + 2.9, -d, fx + dir * 1.6, y - 0.4, -(d - 0.3), 0.045, [0.4, 0.36, 0.24], 5, K, B);   // the pole
    for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
      const bx = x + dir * (len * 0.3 + k * 0.7);
      out(bx, y + 0.5, -d, 0.16, 0.22, 0.14, 0.06, 0.06, 0.07, 1, 0, 0, 0, 1, K, B);        // cormorant
      out(bx + dir * 0.08, y + 0.82, -d, 0.06, 0.12, 0.06, 0.06, 0.06, 0.07, 1, 0, 0, 0, 1, K, B);
    }
    if (night) yield* lamp(ctx, out, x + dir * len * 0.45, y + 1.4, d, [1, 0.62, 0.3], { size: 0.12, halo: 1 });
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
function* laneProps(ctx, out, W, dLo, dHi) {
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
      if (!villageAt(W, wx, ld)) yield* broadCrown(ctx, out, wx - ctx.x0, ld, { rng: r, height: 9 + 6 * r(), crown: 9 + 6 * r(), y: W.H(wx, ld) - 0.2 });
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
function* riverProps(ctx, out, W, dLo, dHi) {
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
      yield* bamboo(ctx, out, bx - ctx.x0, bd + r() * 6, { rng: r, height: 9 + 6 * r(), width: 6 + 6 * r(), y: W.H(bx, bd) - 0.2 });
    }
    // a raft or a boat (a separate world rng, so the bamboo above stays where it was)
    const rb = worldRng(ctx, 634, i);
    if (rb() < 0.09) {
      const bx = wx0 + rb() * Pc, bd = lerp(rn, rf, 0.15 + 0.7 * rb());
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
  // buffalo: wallowing in the flooded panels, grazing the bunds and the dry fields
  for (const { i, wx0 } of cellsAround(ctx, 60, 6)) {
    const r = worldRng(ctx, 641, i);
    if (r() > 0.3) continue;
    const wx = wx0 + r() * 60, d = 40 + r() * 220;
    if (d < dLo || d >= dHi) continue;
    const s = surface(W, wx, d);
    if (s.t !== T.PADDY && s.t !== T.BANK) continue;
    const wet = s.t === T.PADDY && (s.info.t === P.WATER || s.info.t === P.YOUNG || s.info.t === P.POND);
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) yield* buffalo(ctx, out, wx - ctx.x0 + k * 4 * (r() - 0.3), s.y - (wet ? 0.25 : 0.05), d + (r() - 0.5) * 4, r, wet);
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
    yield* terraceHill(ctx, out, t.wx - ctx.x0, t.d, { radius: t.R, radiusD: t.Rd, height: t.Hh, rng: r, n, y: W.H(t.wx, t.d) - 0.4 });
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
function* moundWith(ctx, out, W, wx, d, R, Hm, r, what, wrong, kind) {
  const y = W.H(wx, d) - 1;
  // enough splats that the wooded dome has a clean top edge, not a soft cloud
  const n = Math.max(60, Math.round(treeSplats(out, d, R * 1.4) * 2.2));
  yield* blob(ctx, out, wx - ctx.x0, y + Hm * 0.45, d, R, Hm * 0.6, R * 0.6, { n, color: C.camphor, rng: r, kind, inner: 0.3, amb: 0.55 });
  if (what === 'pagoda') {
    const tiers = 5 + Math.floor(r() * 3) + Math.round(wrong * 3);
    yield* pagoda(ctx, out, wx - ctx.x0, d, { rng: r, height: (26 + 12 * r()) * (1 + wrong * 0.4), tiers, y: y + Hm * 0.95, lean: wrong * 0.06, color: wrong ? mix3([0.66, 0.63, 0.56], [0.6, 0.5, 0.52], wrong) : undefined, kind: kind === KIND.SURREAL ? KIND.SURREAL : KIND.BUILDING });
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
  yield* bunds(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* laneProps(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* crossingLanes(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* streamProps(ctx, out, W, ctx.zNear, ctx.zFar);
  // the river's boats and bamboo and the terraced hills before the villages, so a big village
  // never leaves them out
  yield* riverProps(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* terraces(ctx, out, W, ctx.zNear, ctx.zFar, 40000);
  yield* villages(ctx, out, W, ctx.zNear, ctx.zFar, { small: true });
  // scattered field trees and bamboo clumps by the paddies
  for (const { i, wx0 } of cellsAround(ctx, 45, 12)) {
    const r = worldRng(ctx, 1101, i);
    if (r() > 0.3) continue;
    const wx = wx0 + r() * 45, d = 40 + r() * 250;
    const s = surface(W, wx, d);
    if (s.t !== T.PADDY && s.t !== T.BANK) continue;
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
  out.limit = ctx.count * 0.9;
  // the towers take most of the band: the valley floor from 300 m out is a thin strip on screen.
  // (the same K in the far band, so towers keep their grain across 3000 m)
  yield* towers(ctx, out, W, ctx.zNear, ctx.zFar, TOWER_K, { share: 0.8 });
  yield* mounds(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* terraces(ctx, out, W, ctx.zNear, ctx.zFar, 30000);
  yield* villages(ctx, out, W, ctx.zNear, ctx.zFar, { coarse: 1.3 });
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
  // are HEDGE), and, tagged MOVE.BEAT by hand, boats and fishermen on the river, buffalo in the
  // paddies and the lanterns strung in the villages. Lights always do.
  beatKinds: [KIND.BUILDING, KIND.TREE],


  generators: { trackside, near, mid, far },
};

// for scripts that inspect the layout
export const _debug = { world, surface, towersIn, riverN, riverW, village, terraceSite, moundSite, stream, streamX, laneD, laneOn };
