// "Winter": a winter wonderland. Deep, soft snow country under a low sun: rolling snowfields with
// drifts, snow-laden spruce and fir, bare silver birches, frosted hedges, a frozen river and frozen
// lakes, low forested hills and a far range of white mountains. Log cabins and farmsteads with
// snow-heaped roofs and warm windows, a village with a church spire and a decorated tree in the
// square, a skating pond, sleighs on the lane, children sledging, a ski hill with a chair lift, deer
// at the forest edge, snowmen, wooden bridges over frozen brooks, a small halt with a lit lamp.
//
// Structure (as karst.js and himalaya.js): one pure layout of WORLD x and distance, hashed from the
// world seed and cached per world: the sites (lakes, the river, ponds, hills, villages, farms, ...)
// and the forest field. The height function adds the sites' basins and hills to the shared terrain
// and every band stands on it through local(ctx), so nothing jumps at a chunk seam or a band border.
// Only the ground fill and the falling snow use the chunk's own rng.
//
// Snow is at most [0.8, 0.8, 0.8]: its form is blue-grey shade lit from the surface normal against
// SUN (snowTone below), so a few degrees of slope swing it from warm white to blue.
//
// Light: every window, lamp and string of lights is a real light (a channel >= 0.97, KIND.LIGHT) and
// is lit at every hour (the clock runs on after a chunk is built), with faint pools on the snow.
// No light hangs by itself: by night the tint takes everything that is not a light down to a fifth,
// so each lamp is fixed to something that still reads then, and lights it by hand (the wall under a
// station lamp, the snow under a lantern, the wall round a far window). A lamp on a dark post over
// the skyline is a light floating in the sky; so is a station the brow of its own hill hides.
//
// The beat: buildings and lights (beatKinds, so the decorated tree's bulbs too); the sleigh, its
// bells and the sledges are rigid and tag their own splats with MOVE.STILL (nothing on the beat); the
// sleigh's lantern is a light and keeps the beat. People and animals (skaters,
// skiers, sledgers, riders on the lift, deer, reindeer, horses) are MOVE.FLASH: they brighten on the
// beat and keep their size. Roof snow is not BUILDING (it would clip to white on every beat). Smoke
// billows (MOVE.VAPOUR), scarves and pennants flutter (MOVE.FLAG), and the snow falls (MOVE.FALL).
//
// Surreal dials (all 0 at level 0, so level 0 shows none of this):
//   scale     firs as tall as towers; enormous ice snowflakes hanging still in the air (lit after dark)
//   topology  cabins floating above their own snow-holes; reindeer walking through the air
//   logic     the village church's spire repeating along the line, each copy a little more wrong
import { hashInts, hashString, makeRng, noise1, noise2, fbm2 } from '../rng.js';
import { makeTerrain } from '../terrain.js';
import {
  KIND, MOVE, makeOut, worldSeed, worldRng, cellsAround, detail, shade, jitter, mul3, mix3, smooth,
  clamp, lerp, norm3, quatYaw, quatPitch, quatRoll, quatMul, quatAxis, quatUpTo, quatXTo, rotY, SUN, strut,
} from './kit.js';

const PAL = {
  ground: [0.66, 0.68, 0.72],     // snow in soft light: also the backdrop below the horizon
  foliage: [0.07, 0.12, 0.09],
  rock: [0.36, 0.37, 0.4],
  ballast: [0.36, 0.34, 0.32],
};

// Colours. Natural surfaces stay <= 0.8 per channel.
const C = {
  snowLit: [0.8, 0.79, 0.77],
  snowMid: [0.66, 0.69, 0.74],
  snowShade: [0.44, 0.52, 0.66],
  snowDeep: [0.3, 0.37, 0.52],
  iceDark: [0.15, 0.21, 0.27],
  iceMid: [0.3, 0.39, 0.47],
  iceLight: [0.5, 0.58, 0.65],
  iceScratch: [0.62, 0.67, 0.72],
  lane: [0.62, 0.62, 0.62],
  rut: [0.42, 0.4, 0.39],
  yard: [0.6, 0.61, 0.63],
  ballast: [0.3, 0.29, 0.28],
  sleeper: [0.22, 0.18, 0.15],
  spruce: [0.055, 0.1, 0.075],
  spruceTip: [0.1, 0.17, 0.11],
  mass: [0.04, 0.07, 0.055],
  bark: [0.2, 0.16, 0.13],
  birch: [0.72, 0.71, 0.68],
  twig: [0.3, 0.26, 0.26],
  hedge: [0.2, 0.15, 0.13],
  reed: [0.62, 0.52, 0.34],
  rock: [0.3, 0.31, 0.35],
  rockDark: [0.18, 0.19, 0.23],
  farForest: [0.1, 0.13, 0.12],
  log: [0.36, 0.22, 0.13],
  logDark: [0.24, 0.15, 0.1],
  roofDark: [0.2, 0.17, 0.16],
  stone: [0.46, 0.45, 0.44],
  smoke: [0.6, 0.6, 0.62],
  coat: [[0.62, 0.1, 0.08], [0.1, 0.2, 0.48], [0.12, 0.36, 0.2], [0.7, 0.52, 0.1], [0.42, 0.12, 0.36], [0.16, 0.15, 0.17], [0.72, 0.3, 0.08]],
  skin: [0.72, 0.52, 0.4],
};
// Lights (a channel >= 0.97: they ignore the time-of-day tint). Never jitter or shade these.
const LIT = [1.0, 0.72, 0.36];         // a lit window
const LIT2 = [1.0, 0.82, 0.5];
const LAMP = [1.0, 0.84, 0.56];
const BULBS = [[1.0, 0.2, 0.12], [0.2, 1.0, 0.3], [0.25, 0.45, 1.0], [1.0, 0.8, 0.15], [1.0, 0.35, 0.8], [1.0, 0.98, 0.9]];

const TERRAIN = { cutting: 0.7, roll: 6, rollScale: 330, rise: 0.02, hills: 150, hillScale: 2100, mountains: 2300, mountainScale: 8500, mountainStart: 4300 };

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
const SX = SUN[0], SY = SUN[1], SZ = SUN[2];
// Snow lit from its surface normal: warm white facing the sun, blue-grey turned away from it.
// Flat ground (n . SUN ~ 0.8) sits just below full light, so a few degrees of slope swing the tone.
function snowTone(nx, ny, nz, k = 1, res) {
  const l = nx * SX + ny * SY + nz * SZ;
  const t = smooth(0.55, 0.9, l);
  const a = t > 0.5 ? C.snowMid : C.snowDeep, b = t > 0.5 ? C.snowLit : C.snowShade, f = t > 0.5 ? (t - 0.5) * 2 : t * 2;
  const c = res || [0, 0, 0];
  c[0] = a[0] + (b[0] - a[0]) * f; c[1] = a[1] + (b[1] - a[1]) * f; c[2] = a[2] + (b[2] - a[2]) * f;
  if (k !== 1) { c[0] = C.snowShade[0] + (c[0] - C.snowShade[0]) * k; c[1] = C.snowShade[1] + (c[1] - C.snowShade[1]) * k; c[2] = C.snowShade[2] + (c[2] - C.snowShade[2]) * k; }
  return c;
}
function hourOf(ctx) { const h = ctx.hour != null ? ctx.hour : 12; return ((h % 24) + 24) % 24; }
// 0 by day, 1 in the dark: only for cosmetic extras (pools, halos); the lights themselves are always on.
function darkness(ctx) { const h = hourOf(ctx); return h >= 12 ? smooth(15.5, 17.5, h) : 1 - smooth(8, 10, h); }
const inD = (d, lo, hi) => d >= lo && d < hi;
const inX = (ctx, wx, m = 0) => wx >= ctx.x0 - m && wx < ctx.x0 + ctx.length + m;

// Rotation whose columns are the unit vectors X, Y, Z (local x -> X, y -> Y, z -> Z), as [x, y, z, w].
function quatBasis(m00, m10, m20, m01, m11, m21, m02, m12, m22) {
  const tr = m00 + m11 + m22;
  if (tr > 0) { const s = 0.5 / Math.sqrt(tr + 1); return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s]; }
  if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11); return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

// An emitter that tags every splat with a motion class (kit strut() and out.q() cannot).
function moveOut(out, move) {
  const key = 'mv' + move;
  if (out[key]) return out[key];
  const b = (x, y, z, sx, sy, sz, r, g, bb, o = 1, qx = 0, qy = 0, qz = 0, qw = 1, k = KIND.OTHER) => out(x, y, z, sx, sy, sz, r, g, bb, o, qx, qy, qz, qw, k, move);
  b.due = out.due; b.density = out.density; b.detailK = out.detailK; b.ctx = out.ctx; b.left = out.left;
  b.q = (x, y, z, sx, sy, sz, c, o, q, kind) => b(x, y, z, sx, sy, sz, c[0], c[1], c[2], o, q ? q[0] : 0, q ? q[1] : 0, q ? q[2] : 0, q ? q[3] : 1, kind);
  out[key] = b;
  return b;
}
// A thin straight member from a to b (x, y, z in splat space), r thick, with a kind and a motion class.
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
function L(out, x, y, d, sx, sy, sz, c, o = 1, move = 0) { return out(x, y, -d, sx, sy, sz, c[0], c[1], c[2], o, 0, 0, 0, 1, KIND.LIGHT, move); }
// A point light: a bright core, a faint halo; the core grows with distance so far lamps stay visible.
function glow(out, x, y, d, c, r, halo = 0.14, hk = 4, move = 0) {
  L(out, x, y, d, r, r, r, c, 1, move);
  if (halo > 0) L(out, x, y, d + 0.05, r * hk, r * hk, r * hk * 0.6, c, halo, move);
}
// A pool of light lying on the snow, cut into strips across the line of sight (splats sort by centre).
function pool(out, x, y, d, rx, rz, c, o, move = 0) {
  const k = Math.max(1, Math.round(rz / 1.6)), sz = rz / k;
  for (let i = 0; i < k; i++) L(out, x, y + 0.06, d - rz + (2 * i + 1) * sz, rx, Math.max(0.02, rx * 0.01), sz * 1.25, c, o, move);
}

// ---------------------------------------------------------------------------------------------
// World layout (pure functions of world x and distance; cached per world seed)
// ---------------------------------------------------------------------------------------------
const worlds = new Map();
function world(ctx) {
  const ws = worldSeed(ctx);
  let W = worlds.get(ws);
  if (W) return W;
  const base = ctx.terrain.height;
  W = { ws, misc: new Map(), far: [] };
  W.base = makeTable(base, 2.2, 0.015, 0.03, 250);
  W.H = (wx, d) => heightAt(W, wx, d);
  W.terr = { height: W.H, stretch: ctx.terrain.stretch, shape: ctx.terrain.shape };
  worlds.set(ws, W);
  if (worlds.size > 6) worlds.delete(worlds.keys().next().value);
  return W;
}
// The shared terrain is a dozen octaves of value noise and is asked for three or four times for every
// ground splat, so it is tabulated per world: rows at log-spaced distances (1.5% apart), columns a
// few per cent of the distance apart, in tiles of 16 x 32 cells made on first use and interpolated
// bilinearly. Its finest relief is 80 m across; the drifts and the sites are added exactly on top.
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
// A copy of ctx standing on the winter terrain; every kit call must get this one.
function local(ctx) { const W = world(ctx); return [{ ...ctx, terrain: W.terr }, W]; }
function cache(W, type, i, make) {
  const key = type * 1048576 + i;
  let v = W.misc.get(key);
  if (v === undefined) { v = make(); if (W.misc.size > 60000) W.misc.clear(); W.misc.set(key, v); }
  return v;
}
const ST = { LAKE: 1, POND: 2, SLED: 3, SKI: 4, VILLAGE: 5, FARM: 6, BROOK: 7, HALT: 8, DEER: 9, SLEIGH: 10, SNOWMAN: 11, HEDGE: 12, MISC: 13, HERD: 14 };

// --- the frozen river: a broad band in stretches; elsewhere it swings far off ---
function riverN(W, wx) {
  const off = smooth(0.5, 0.32, noise1(wx / 5200, W.ws + 601));
  return 95 + 120 * noise1(wx / 1500, W.ws + 602) + 2600 * off * off;
}
function riverW(W, wx) { return 20 + 22 * noise1(wx / 900, W.ws + 603); }
// --- the lane parallel to the line, in stretches ---
function laneOn(W, wx) { return noise1(wx / 2300, W.ws + 611) > 0.38; }
function laneD(W, wx) { return 40 + 26 * noise1(wx / 1300, W.ws + 612); }

// --- the ski hill: a big hill rising away from the line, a piste down it and a chair lift ---
const KCELL = 4300;
function skiHill(W, i) {
  return cache(W, ST.SKI, i, () => {
    const r = makeRng(hashInts(W.ws, 701, i));
    if (r() > 0.55) return null;
    const cx = (i + 0.3 + 0.4 * r()) * KCELL, dc = 430 + 90 * r();
    const s = { i, cx, dc, rx: 300 + 60 * r(), rd: 260, Hh: 105 + 40 * r(), seed: hashInts(W.ws, 702, i) };
    // the lift: from the foot (in the near band) straight up the face to near the top
    s.ld0 = 175 + 25 * r(); s.ld1 = dc - 35;
    s.lx0 = cx + (r() - 0.5) * 120; s.lx1 = s.lx0 + (r() < 0.5 ? -1 : 1) * (60 + 80 * r());
    s.pisteW = 45 + 25 * r();
    // never on the river: the foot of the lift stands beyond its far bank
    let rf = 0;
    for (let x = cx - s.rx; x <= cx + s.rx; x += 40) { const rn = riverN(W, x); if (rn < dc) rf = Math.max(rf, rn + riverW(W, x)); }
    s.ld0 = Math.max(s.ld0, rf + 45);
    if (s.ld0 > s.ld1 - 130) return null;
    s.px = (s.lx0 + s.lx1) / 2 + (r() < 0.5 ? -1 : 1) * (s.pisteW * 0.5 + 25);
    // the valley station (bx, bd) stands at the foot of the hill, on the lift's own line carried on
    // down: on the river's far bank where the hill rises from it, otherwise low on the face
    let bd = Math.min(s.ld0, 150);
    for (let k = 0; k < 3; k++) {
      const bx = s.lx0 + (s.lx1 - s.lx0) * (bd - s.ld0) / (s.ld1 - s.ld0);
      const rn = riverN(W, bx);
      if (rn < s.dc) bd = Math.min(s.ld0, rn + riverW(W, bx) + 16);
    }
    s.bd = bd; s.bx = s.lx0 + (s.lx1 - s.lx0) * (bd - s.ld0) / (s.ld1 - s.ld0);
    return s;
  });
}
function skiAt(W, wx) {
  const i = Math.floor(wx / KCELL);
  for (let k = i - 1; k <= i + 1; k++) { const s = skiHill(W, k); if (s && Math.abs(wx - s.cx) < s.rx * 1.6) return s; }
  return null;
}
function skiBump(s, wx, d) {
  const u = (wx - s.cx) / s.rx, v = (d - s.dc) / s.rd;
  const e = u * u + v * v;
  return e < 2.6 ? s.Hh * Math.exp(-1.6 * e) : 0;
}
// the piste: a cleared strip from the top down the face toward the line
function pisteC(s, d) { return lerp(s.px + (s.lx0 - s.lx1) * 0.3, s.px, clamp((d - s.ld0 + 20) / (s.dc - s.ld0), 0, 1)); }
function pisteU(s, wx, d) {
  const t = clamp((d - s.ld0 + 20) / (s.dc - s.ld0), 0, 1);
  return Math.abs(wx - pisteC(s, d)) / (s.pisteW * (0.7 + 0.5 * (1 - t)) * 0.5);
}
function onPiste(s, wx, d) { return d > s.ld0 - 30 && d < s.dc + 10 && pisteU(s, wx, d) < 1; }
// The ground cleared for the lift: a swathe from the valley station to the top one (wider round the
// two stations, where the huts stand), and the whole strip between the lift and the piste, so the
// two share one open ski field. A lift in a swathe of its own was hidden by the trees in front of
// it from everywhere but straight up the swathe.
function onLiftLine(W, s, wx, d) {
  const td = liftGeom(W, s).td;
  if (d < s.bd - 16 || d > td + 16) return false;
  const xl = lerp(s.lx0, s.lx1, (d - s.ld0) / (s.ld1 - s.ld0));
  if (Math.abs(wx - xl) < (d < s.bd + 12 || d > td - 12 ? 24 : 9)) return true;
  return d > s.ld0 - 30 && (wx - xl) * (wx - pisteC(s, d)) < 0;
}

// --- villages: a church, a square with a decorated tree, houses round it ---
const VCELL = 2900;
function village(W, i) {
  return cache(W, ST.VILLAGE, i, () => {
    const r = makeRng(hashInts(W.ws, 801, i));
    if (r() > 0.6) return null;
    const cx = (i + 0.2 + 0.6 * r()) * VCELL;
    let dc = 150 + 160 * r();
    const R = 80 + 40 * r(), Rd = 55 + 20 * r();
    const sk = skiAt(W, cx);
    if (sk && Math.abs(cx - sk.cx) < sk.rx + R) return null;
    const rn = riverN(W, cx), rw = riverW(W, cx);
    if (dc + Rd > rn - 15 && dc - Rd < rn + rw + 15) dc = rn - 15 - Rd > 70 + Rd * 0.5 ? rn - 15 - Rd : rn + rw + Rd + 20;
    dc = Math.max(dc, 70 + Rd);
    const v = { i, cx, dc, R, Rd, seed: hashInts(W.ws, 802, i), houses: [], trees: [] };
    // the square in the middle, the church behind it
    v.sq = { wx: cx + (r() - 0.5) * 20, d: dc - Rd * 0.25 };
    v.church = { wx: v.sq.wx + (r() - 0.5) * 30, d: v.sq.d + 32 + 10 * r(), yaw: (r() - 0.5) * 0.2, spire: 26 + 10 * r(), seed: hashInts(W.ws, 803, i) };
    for (let a = -R; a <= R; a += 17) {
      for (let b = -Rd; b <= Rd; b += 16) {
        const pr = makeRng(hashInts(v.seed, Math.round(a), Math.round(b)));
        if ((a / R) ** 2 + (b / Rd) ** 2 > 1) continue;
        const wx = cx + a + (pr() - 0.5) * 6, d = dc + b + (pr() - 0.5) * 5;
        if (Math.hypot(wx - v.sq.wx, (d - v.sq.d) * 1.3) < 26) continue;
        if (Math.abs(wx - v.church.wx) < 22 && Math.abs(d - v.church.d) < 18) continue;
        const u = pr();
        if (u < 0.62) v.houses.push(houseSpec(pr, wx, d, hashInts(v.seed, 7, Math.round(a), Math.round(b)), false));
        else if (u < 0.85) v.trees.push({ wx, d, seed: hashInts(v.seed, 9, Math.round(a), Math.round(b)), birch: pr() < 0.4 });
      }
    }
    return v;
  });
}
function houseSpec(pr, wx, d, seed, cabin) {
  const kindR = pr();
  const wall = cabin || kindR < 0.4 ? 'log' : kindR < 0.62 ? 'red' : kindR < 0.78 ? 'ochre' : kindR < 0.9 ? 'white' : 'blue';
  return {
    wx, d, seed, wall,
    w: cabin ? 7 + 3 * pr() : 9 + 4 * pr(), dep: cabin ? 5.5 + 1.5 * pr() : 7 + 2 * pr(),
    h: cabin ? 3 + 0.5 * pr() : pr() < 0.6 ? 5.6 : 3.4, pitch: 0.62 + 0.2 * pr(),
    yaw: (pr() - 0.5) * 0.3 + (pr() < 0.25 ? (pr() < 0.5 ? 1 : -1) * Math.PI / 2 : 0),
    smoke: pr() < 0.7, snowman: pr() < 0.18,
  };
}
function villageAt(W, wx, d, m = 0) {
  const i = Math.floor(wx / VCELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const v = village(W, k);
    if (v && ((wx - v.cx) / (v.R + m)) ** 2 + ((d - v.dc) / (v.Rd + m)) ** 2 < 1) return v;
  }
  return null;
}

// --- frozen lakes: basins several metres below the land, so the ice is seen at an angle ---
const LCELL = 1200;
function lake(W, i) {
  return cache(W, ST.LAKE, i, () => {
    const r = makeRng(hashInts(W.ws, 501, i));
    if (r() > 0.5) return null;
    const cx = (i + 0.25 + 0.5 * r()) * LCELL;
    const rx = 60 + 130 * r(), rd = 28 + 55 * r();
    const dc = 75 + rd + Math.pow(r(), 1.5) * 520;
    if (villageAt(W, cx, dc, rx * 0.8)) return null;
    const sk = skiAt(W, cx);
    if (sk && Math.abs(cx - sk.cx) < sk.rx + rx) return null;
    const rn = riverN(W, cx);
    if (dc + rd > rn - 25 && dc - rd < rn + riverW(W, cx) + 25) return null;
    const level = W.base(cx, dc) - (3.5 + 3 * r());
    return { i, cx, dc, rx, rd, level, salt: hashInts(W.ws, 502, i) & 0xffff, seed: hashInts(W.ws, 503, i) };
  });
}
function lakeE(lk, wx, d) {
  const u = (wx - lk.cx) / lk.rx, v = (d - lk.dc) / lk.rd;
  const a = Math.atan2(v, u);
  const k = 0.82 + 0.3 * noise1(a * 1.6 + 7, lk.salt);
  return Math.hypot(u, v) / k;
}
function lakesNear(W, wx) {
  const i = Math.floor(wx / LCELL), res = W._lk || (W._lk = []);
  res.length = 0;
  for (let k = i - 1; k <= i + 1; k++) { const lk = lake(W, k); if (lk && Math.abs(wx - lk.cx) < lk.rx * 1.6) res.push(lk); }
  return res;
}

// --- the skating pond: small, near, swept clear ---
const PCELL = 1500;
function pond(W, i) {
  return cache(W, ST.POND, i, () => {
    const r = makeRng(hashInts(W.ws, 511, i));
    if (r() > 0.6) return null;
    const cx = (i + 0.25 + 0.5 * r()) * PCELL;
    const rx = 24 + 10 * r(), rd = 16 + 5 * r();
    let dc = 52 + rd + 20 * r();
    if (laneOn(W, cx) && Math.abs(dc - laneD(W, cx)) < rd + 10) dc = laneD(W, cx) + rd + 12;
    if (villageAt(W, cx, dc, 40) || skiAt(W, cx)) return null;
    for (const lk of lakesNear(W, cx)) if (Math.abs(cx - lk.cx) < lk.rx + rx + 30) return null;
    const rn = riverN(W, cx);
    if (dc + rd > rn - 25 && dc - rd < rn + riverW(W, cx) + 25) return null;
    return { i, cx, dc, rx, rd, level: W.base(cx, dc) - 3.6, seed: hashInts(W.ws, 512, i) };
  });
}
function pondNear(W, wx) {
  const i = Math.floor(wx / PCELL);
  for (let k = i - 1; k <= i + 1; k++) { const p = pond(W, k); if (p && Math.abs(wx - p.cx) < p.rx * 1.5) return p; }
  return null;
}

// --- the sledging hill: a rounded hill rising away from the line ---
const SHCELL = 1900;
function sledHill(W, i) {
  return cache(W, ST.SLED, i, () => {
    const r = makeRng(hashInts(W.ws, 521, i));
    if (r() > 0.55) return null;
    const cx = (i + 0.25 + 0.5 * r()) * SHCELL;
    const dc = 112 + 15 * r(), rx = 75 + 25 * r(), rd = 55, Hh = 18 + 7 * r();
    if (villageAt(W, cx, dc, 60) || skiAt(W, cx)) return null;
    const pd = pondNear(W, cx);
    if (pd && Math.abs(cx - pd.cx) < rx + pd.rx) return null;
    for (const lk of lakesNear(W, cx)) if (Math.abs(cx - lk.cx) < lk.rx + rx + 20) return null;
    const rn = riverN(W, cx);
    if (rn < dc + rd * 0.6 && rn + riverW(W, cx) > dc - rd * 1.6) return null;
    return { i, cx, dc, rx, rd, Hh, seed: hashInts(W.ws, 522, i) };
  });
}
function sledNear(W, wx) {
  const i = Math.floor(wx / SHCELL);
  for (let k = i - 1; k <= i + 1; k++) { const s = sledHill(W, k); if (s && Math.abs(wx - s.cx) < s.rx * 1.7) return s; }
  return null;
}
function sledBump(s, wx, d) {
  const u = (wx - s.cx) / s.rx, v = (d - s.dc) / s.rd, e = u * u + v * v;
  return e < 3 ? s.Hh * Math.exp(-1.4 * e) : 0;
}

// --- frozen brooks running away from the line, crossed by the lane on a wooden bridge ---
const BCELL = 1700;
function brook(W, i) {
  return cache(W, ST.BROOK, i, () => {
    const r = makeRng(hashInts(W.ws, 531, i));
    if (r() > 0.5) return null;
    const x0 = (i + 0.2 + 0.6 * r()) * BCELL;
    if (villageAt(W, x0, 120, 30) || skiAt(W, x0) || sledNear(W, x0) || pondNear(W, x0)) return null;
    return { i, x0, slope: (r() - 0.5) * 0.4, w: 3 + 2.5 * r(), seed: hashInts(W.ws, 532, i), dEnd: Math.min(riverN(W, x0), 600) };
  });
}
function brookX(b, d) { return b.x0 + b.slope * d + 5 * Math.sin(d / 21 + b.i); }
function brookAt(W, wx, d) {
  if (d < 20 || d > 620) return null;
  const i = Math.floor(wx / BCELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const b = brook(W, k);
    if (b && d < b.dEnd + 4 && Math.abs(wx - brookX(b, d)) < b.w * 0.5 + 4) return b;
  }
  return null;
}

// --- farmsteads and cabins ---
const FCELL = 520;
function farm(W, i) {
  return cache(W, ST.FARM, i, () => {
    const r = makeRng(hashInts(W.ws, 541, i));
    if (r() > 0.62) return null;
    const cx = (i + 0.2 + 0.6 * r()) * FCELL;
    let dc = 48 + Math.pow(r(), 1.3) * 230;
    if (laneOn(W, cx) && Math.abs(dc - laneD(W, cx)) < 14) dc = laneD(W, cx) + 16;
    if (villageAt(W, cx, dc, 40) || skiAt(W, cx)) return null;
    const pd = pondNear(W, cx);
    if (pd && Math.abs(cx - pd.cx) < pd.rx + 20 && Math.abs(dc - pd.dc) < pd.rd + 20) return null;
    const sh = sledNear(W, cx);
    if (sh && Math.abs(cx - sh.cx) < sh.rx * 1.3) return null;
    for (const lk of lakesNear(W, cx)) if (lakeE(lk, cx, dc) < 1.5) return null;
    const rn = riverN(W, cx);
    if (dc > rn - 25 && dc < rn + riverW(W, cx) + 25) return null;
    const bk = brookAt(W, cx, dc);
    if (bk) return null;
    const f = { i, cx, dc, seed: hashInts(W.ws, 542, i), bldgs: [] };
    const nb = r() < 0.45 ? 1 : 2 + (r() < 0.3 ? 1 : 0);
    const yaw0 = (r() - 0.5) * 0.35;
    for (let k = 0; k < nb; k++) {
      const pr = makeRng(hashInts(f.seed, k));
      const bx = cx + (k === 0 ? 0 : (k === 1 ? 1 : -1) * (13 + 5 * pr())), bd = dc + (k === 0 ? 0 : 6 + 8 * pr());
      const hs = houseSpec(pr, bx, bd, hashInts(f.seed, 11, k), k === 0 || r() < 0.5);
      hs.yaw = k === 0 ? yaw0 : yaw0 + (pr() < 0.5 ? Math.PI / 2 : 0);
      if (k > 0 && pr() < 0.5) { hs.barn = true; hs.w = 11 + 4 * pr(); hs.dep = 8; hs.h = 4.2; hs.smoke = false; hs.wall = 'red'; }
      f.bldgs.push(hs);
    }
    f.snowman = r() < 0.5 ? { wx: cx + (r() < 0.5 ? -1 : 1) * (9 + 4 * r()), d: dc - 9 - 4 * r() } : null;
    f.fence = r() < 0.55;
    f.woodpile = r() < 0.6;
    return f;
  });
}

// --- the halt: a short platform with a lamp and a wooden shelter ---
const HCELL = 3100;
function halt(W, i) {
  return cache(W, ST.HALT, i, () => {
    const r = makeRng(hashInts(W.ws, 551, i));
    if (r() > 0.45) return null;
    return { i, x0: (i + 0.1 + 0.6 * r()) * HCELL, len: 60 + 30 * r(), seed: hashInts(W.ws, 552, i) };
  });
}

// --- forest: a field of world noise, thicker further out and on the hills ---
function forestVal(W, wx, d) {
  return 0.72 * noise2(wx / 520, d / 380, W.ws + 401) + 0.28 * noise2(wx / 140, d / 110, W.ws + 402);
}
function forestThr(d) { return 0.55 - 0.12 * smooth(250, 1600, d) + 0.35 * smooth(110, 35, d); }
function canopyH(W, wx, d) { return 14 + 8 * noise2(wx / 240, d / 240, W.ws + 403); }

// ---------------------------------------------------------------------------------------------
// The sites near a world x, indexed in 32 m bins: the height and surface functions are asked for
// every ground splat several times, and one map read here replaces a score of cell lookups.
// Each bin holds every site that can touch any x inside it; the callers make the exact tests.
// ---------------------------------------------------------------------------------------------
const BIN = 32;
function binAt(W, wx) {
  const b = Math.floor(wx / BIN);
  return cache(W, ST.MISC, b, () => {
    const xa = b * BIN, xb = xa + BIN;
    const B = { lakes: [], pond: null, sled: null, ski: null, villages: [], brooks: [] };
    for (let i = Math.floor(xa / LCELL) - 1; i <= Math.floor(xb / LCELL) + 1; i++) { const lk = lake(W, i); if (lk && xb > lk.cx - lk.rx * 1.6 && xa < lk.cx + lk.rx * 1.6) B.lakes.push(lk); }
    for (let i = Math.floor(xa / PCELL) - 1; i <= Math.floor(xb / PCELL) + 1; i++) { const p = pond(W, i); if (p && xb > p.cx - p.rx * 1.5 && xa < p.cx + p.rx * 1.5) B.pond = p; }
    for (let i = Math.floor(xa / SHCELL) - 1; i <= Math.floor(xb / SHCELL) + 1; i++) { const sh = sledHill(W, i); if (sh && xb > sh.cx - sh.rx * 1.7 && xa < sh.cx + sh.rx * 1.7) B.sled = sh; }
    for (let i = Math.floor(xa / KCELL) - 1; i <= Math.floor(xb / KCELL) + 1; i++) { const sk = skiHill(W, i); if (sk && xb > sk.cx - sk.rx * 1.6 && xa < sk.cx + sk.rx * 1.6) B.ski = sk; }
    for (let i = Math.floor(xa / VCELL) - 1; i <= Math.floor(xb / VCELL) + 1; i++) { const v = village(W, i); if (v && xb > v.cx - v.R && xa < v.cx + v.R) B.villages.push(v); }
    for (let i = Math.floor(xa / BCELL) - 1; i <= Math.floor(xb / BCELL) + 1; i++) {
      const bk = brook(W, i);
      if (!bk) continue;
      const m = bk.w * 0.5 + 10, xs = [brookX(bk, 20), brookX(bk, 620)];
      if (xb > Math.min(...xs) - m && xa < Math.max(...xs) + m) B.brooks.push(bk);
    }
    return B;
  });
}
function brookIn(B, wx, d, m) {
  if (d < 20 || d > 620) return null;
  for (const b of B.brooks) if (d < b.dEnd + 4 && Math.abs(wx - brookX(b, d)) < b.w * 0.5 + m) return b;
  return null;
}
function villageIn(B, wx, d) {
  for (const v of B.villages) if (((wx - v.cx) / v.R) ** 2 + ((d - v.dc) / v.Rd) ** 2 < 1) return v;
  return null;
}

// ---------------------------------------------------------------------------------------------
// The height function: the shared terrain, gentle drifts, and the sites' basins and hills
// ---------------------------------------------------------------------------------------------
function heightAt(W, wx, d) {
  let h = W.base(wx, d);
  // the plough's bank of snow along the line
  if (d < 9) h += 0.65 * Math.exp(-((d - 4.8) ** 2) / 1.4);
  else {
    // drifts: long soft swells with sharper crests, lying along the wind (along the line)
    const k = smooth(6, 16, d) * (1 - smooth(450, 1000, d));
    if (k > 0) {
      if (d < 60) h += 0.5 * (noise2(wx / 3.5 + d / 14, d / 11, W.ws + 33) - 0.5) * k * smooth(60, 30, d);
      // (the swells run away from the line, so their flanks face along it: one lit, one blue)
      const a = noise2(wx / 19 + d / 90, d / 70, W.ws + 31), b = noise2(wx / 75, d / 150, W.ws + 32);
      h += k * smooth(8, 45, d) * (2.4 * a * a * a + 3 * (b - 0.5));
    }
  }
  if (d > 1460) return h;
  const B = binAt(W, wx);
  // the river: ice lying flat across, several metres down
  const rn = riverN(W, wx);
  if (rn < 1400) {
    const rw = riverW(W, wx), rc = rn + rw / 2, ad = Math.abs(d - rc);
    if (ad < rw / 2 + 14) {
      const lvl = W.base(wx, rc) - 3.4;
      const t = smooth(rw / 2 + 14, rw / 2, ad);
      h = lerp(h, lvl, t);
    }
  }
  for (const lk of B.lakes) {
    if (d > lk.dc + lk.rd * 1.6) continue;
    const e = lakeE(lk, wx, d);
    let t = e < 1.25 ? smooth(1.25, 0.97, e) : 0;
    // a near lake lies at the foot of a broad dip falling from the line, so its ice is seen
    if (lk.dc < 320 && d < lk.dc) t = Math.max(t, 0.8 * dipFront(wx, d, lk.cx, lk.rx, lk.dc, lk.rd));
    if (t > 0) h = lerp(h, lk.level, t);
  }
  const p = B.pond;
  if (p && d < 140) {
    const e = Math.hypot((wx - p.cx) / p.rx, (d - p.dc) / p.rd);
    const t = Math.max(e < 1.4 ? smooth(1.4, 1.0, e) : 0, d < p.dc ? 0.8 * dipFront(wx, d, p.cx, p.rx, p.dc, p.rd) : 0);
    if (t > 0) h = lerp(h, p.level, t);
  }
  if (B.brooks.length) {
    const b = brookIn(B, wx, d, 4);
    if (b) { const u = Math.abs(wx - brookX(b, d)) / (b.w * 0.5 + 4); h -= 1.4 * smooth(1, 0.45, u); }
  }
  // the hills rise from nothing near the line (and the ski hill only beyond the river)
  if (B.sled && d > 12 && d < 300) h += sledBump(B.sled, wx, d) * smooth(12, 45, d);
  if (B.ski && d > 20 && d < 1100) {
    let k = smooth(20, 90, d);
    if (rn < B.ski.dc) { const rf = rn + riverW(W, wx); k *= smooth(rf + 2, rf + 50, d); }
    if (k > 0) h += skiBump(B.ski, wx, d) * k;
  }
  return h;
}

// The broad dip in front of a pond or a near lake: 0 at the line, rising to 1 at the water's edge,
// fading out to either side of it and toward its middle (so it meets the basin without a step).
function dipFront(wx, d, cx, rx, dc, rd) {
  const u = Math.abs(wx - cx) / rx;
  if (u > 1.7) return 0;
  return smooth(1.7, 0.9, u) * smooth(10, dc - rd * 1.3, d) * smooth(dc, dc - rd * 0.8, d);
}
// What covers the ground at a world point. Returns a reused object.
const T = { SNOW: 0, ICE: 1, POND: 2, LANE: 3, FOREST: 4, YARD: 5, PISTE: 6, BROOK: 7, BANK: 8 };
const SURF = { t: 0, y: 0, ice: 0, lk: null, f: 0 };
function surface(W, wx, d) {
  const S = SURF;
  S.y = W.H(wx, d); S.lk = null; S.ice = 0; S.f = 0;
  const rn = riverN(W, wx);
  if (rn < 1400) {
    const rw = riverW(W, wx);
    if (d > rn && d < rn + rw) { S.t = T.ICE; S.ice = 1; return S; }
    if (d > rn - 9 && d < rn + rw + 9) { S.t = T.BANK; return S; }
  }
  if (d < 1460) {
    const B = binAt(W, wx);
    for (const lk of B.lakes) {
      if (Math.abs(d - lk.dc) > lk.rd * 1.3) continue;
      const e = lakeE(lk, wx, d);
      if (e < 1.0) { S.t = T.ICE; S.lk = lk; S.ice = 2; return S; }
      if (e < 1.18) { S.t = T.BANK; return S; }
    }
    const p = B.pond;
    if (p && d < 140) {
      const e = Math.hypot((wx - p.cx) / p.rx, (d - p.dc) / p.rd);
      if (e < 1.0) { S.t = T.POND; S.lk = p; return S; }
      if (e < 1.35) { S.t = T.BANK; return S; }
    }
    if (d > 20 && laneOn(W, wx) && Math.abs(d - laneD(W, wx)) < 2.6) { S.t = T.LANE; S.y += 0.05; return S; }
    if (B.brooks.length) {
      const b = brookIn(B, wx, d, 0);
      if (b) { S.t = T.BROOK; return S; }
    }
    const sk = B.ski;
    if (sk && d > 60 && d < 1100 && (onPiste(sk, wx, d) || onLiftLine(W, sk, wx, d))) { S.t = T.PISTE; return S; }
    if (d > 60 && d < 500 && B.villages.length && villageIn(B, wx, d)) { S.t = T.YARD; return S; }
    const sh = B.sled;
    if (sh && d > 30 && d < 300 && Math.abs(wx - sh.cx) < sh.rx * 0.9 && d < sh.dc + 10) { S.t = T.SNOW; S.f = -1; return S; }
  }
  const f = forestVal(W, wx, d) - forestThr(d);
  S.f = f;
  S.t = f > 0 ? T.FOREST : T.SNOW;
  return S;
}

// ---------------------------------------------------------------------------------------------
// Ground colour
// ---------------------------------------------------------------------------------------------
function iceColor(W, s, wx, d, rng) {
  // dark ice swept clear in patches and lanes, snow lying elsewhere; long pale streaks of wind-polish
  const sw = noise2(wx / 38, d / 14, W.ws + 451) + 0.25 * noise2(wx / 9, d / 4, W.ws + 452);
  const clear = smooth(0.62, 0.78, sw);
  let c = mix3(C.iceMid, C.iceDark, 0.5 + 0.5 * noise2(wx / 90, d / 30, W.ws + 453));
  const st = noise2(wx / 55, d / (1.2 + 0.012 * d), W.ws + 454);
  c = mix3(c, C.iceLight, smooth(0.72, 0.9, st) * 0.7);
  const snow = jitter(mix3(C.snowMid, C.snowLit, 0.4 + 0.5 * noise2(wx / 12, d / 6, W.ws + 455)), rng, 0.03);
  return mix3(snow, jitter(c, rng, 0.05), clear);
}
function pondColor(W, p, wx, d, rng) {
  // swept clean: dark ice scored with pale rings by the skates, a bank of swept snow round the edge
  const e = Math.hypot((wx - p.cx) / p.rx, (d - p.dc) / p.rd);
  if (e > 0.9) return jitter(mix3(C.snowMid, C.snowLit, 0.5), rng, 0.04);
  let c = mix3(C.iceDark, C.iceMid, 0.3 + 0.4 * noise2(wx / 9, d / 5, W.ws + 461));
  const ring = Math.abs(Math.sin(e * 22 + noise1(Math.atan2(d - p.dc, wx - p.cx) * 3, W.ws + 462) * 2));
  c = mix3(c, C.iceScratch, smooth(0.8, 0.98, ring) * 0.55);
  return jitter(c, rng, 0.04);
}
// Snow on open ground: its tone from the surface normal, a little cooler and greyer far off.
const SC = [0, 0, 0];
function snowColor(W, wx, d, nn, rng) {
  const c = snowTone(nn[0], nn[1], nn[2], 1, SC);
  // faint wind-ripples and the odd patch of older, greyer snow
  const k = (0.95 + 0.07 * noise2(wx / 25, d / 9, W.ws + 471)) * (1 + 0.025 * (rng() * 2 - 1));
  c[0] *= k; c[1] *= k; c[2] *= k;
  return c;
}

// ---------------------------------------------------------------------------------------------
// The surface fill: snow, ice and forest mass in one pass, one splat per sample, so the band is
// always covered and the count lands on ctx.count.
//   opts: n, dNear, dFar, power, cover, minR, maxR, mass, tuft
// ---------------------------------------------------------------------------------------------
function* fillSurface(ctx, out, W, opts = {}) {
  out.limit = Infinity;
  const n = Math.floor(opts.n != null ? opts.n : out.left());
  if (n <= 0) return;
  const rng = ctx.rng;
  const dn = opts.dNear != null ? opts.dNear : ctx.zNear, df = opts.dFar != null ? opts.dFar : ctx.zFar;
  const xa = opts.x0 || 0, Lx = (opts.x1 != null ? opts.x1 : ctx.length) - xa;
  const p = opts.power != null ? opts.power : 1.5, cover = opts.cover || 3;
  const minR = opts.minR || 0.0015, maxR = opts.maxR || 0.08;
  const a1 = 1 - p;
  const A = Math.abs(a1) < 1e-6 ? 0 : Math.pow(dn, a1), B = Math.abs(a1) < 1e-6 ? 0 : Math.pow(df, a1);
  const Z = Math.abs(a1) < 1e-6 ? Math.log(df / dn) : (B - A) / a1;
  const sample = (u) => (Math.abs(a1) < 1e-6 ? dn * Math.pow(df / dn, u) : Math.pow(A + u * (B - A), 1 / a1));
  const nn = [0, 1, 0];
  for (let i = 0; i < n; i++) {
    const d = sample((i + rng()) / n);
    const x = xa + rng() * Lx, wx = ctx.x0 + x;
    const dens = (n * Math.pow(d, -p) / Z) / Lx;
    let r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
    const s = surface(W, wx, d);
    const ax = 0.8 + 0.5 * rng();
    const u = rng();
    if (s.t === T.ICE || s.t === T.POND) {
      const c = s.t === T.POND ? pondColor(W, s.lk, wx, d, rng) : iceColor(W, s, wx, d, rng);
      out(x, s.y, -d, r * 1.4 * ax, r * 0.05, r * 0.7, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    } else if (s.t === T.FOREST && opts.mass && s.f > 0.05) {
      // forest mass: a dark splat between the floor and the canopy; the upper ones carry snow
      const H = canopyH(W, wx, d) * (opts.hk || 1);
      const v = Math.pow(u, 0.6);
      let c;
      const snowy = rng() < 0.04 + 0.14 * v;
      if (snowy) {
        // a shelf of snow on the boughs: wide and flat
        const c = mul3(snowTone(-0.2 * rng(), 0.9, 0.3 * rng()), 0.7 + 0.25 * v);
        out(x, s.y + H * (0.15 + 0.8 * v), -d, r * 0.6 * ax, Math.max(r * 0.2, H * 0.03), r * 0.6, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.TREE);
        if (out.due()) yield;
        continue;
      }
      c = jitter(mix3(C.mass, C.spruce, 0.3 + 0.7 * v), rng, 0.2);
      if (v > 0.82) out(x, s.y + H * (0.72 + 0.2 * v), -d, r * 0.35 * ax, H * 0.16, r * 0.35, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.TREE);
      else out(x, s.y + H * (0.12 + 0.7 * v), -d, r * 0.85 * ax, Math.max(r * 0.7, H * 0.2 * (1 - 0.4 * v)), r * 0.85, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.TREE);
    } else {
      // slope from two more height samples, a disc's width apart
      const e = Math.max(0.7, r * 0.8);
      const hx = (W.H(wx + e, d) - s.y) / e, hd = (W.H(wx, d + e) - s.y) / e;
      const l = 1 / Math.hypot(hx, 1, hd);
      nn[0] = -hx * l; nn[1] = l; nn[2] = hd * l;
      let c;
      if (s.t === T.LANE) c = laneColor(W, wx, d, rng);
      else if (s.t === T.YARD) c = mul3(snowColor(W, wx, d, nn, rng), 0.88 + 0.08 * noise2(wx / 4, d / 3, W.ws + 481));
      else if (s.t === T.PISTE) c = mul3(snowColor(W, wx, d, nn, rng), 0.97 + 0.05 * Math.sin(wx * 0.9));
      else if (s.t === T.BROOK) c = mix3(C.iceMid, C.snowShade, 0.5 + 0.5 * noise2(wx / 3, d / 6, W.ws + 482));
      else c = snowColor(W, wx, d, nn, rng);
      // the snow at the foot of a forest (and under its thin edge) lies in its shade
      if ((s.t === T.SNOW || s.t === T.FOREST) && s.f > -0.07 && d > 40) c = mix3(c, C.snowShade, 0.55 * smooth(-0.07, 0.05, s.f));
      if (opts.hook) c = opts.hook(s, wx, d, c);
      const tuft = opts.tuft && d < opts.tuft ? 1 - d / opts.tuft : 0;
      // the disc lies in the slope (quatUpTo, inlined)
      // (on ground falling away from the line a disc in the slope is seen edge-on and lets the sky
      // through: there it stays level and grows thicker instead)
      const away = nn[2] < 0 ? Math.min(0.4, -nn[2] * 2.5) : 0;
      // a face turned toward the line (a hillside) shows far more of itself than level ground does at
      // that distance, so its discs grow to keep it opaque
      if (nn[2] > 0.03) r = Math.min(r * (1 + 0.8 * nn[2]), maxR * d);
      const nz = nn[2] < 0 ? 0 : nn[2], qw = 1 + nn[1], ql = Math.hypot(nz, nn[0], qw);
      out(x, s.y + 0.02 + tuft * r * 0.3 * u, -d, r * ax, r * (0.12 + 0.2 * tuft + away), r * (1.8 - ax), c[0], c[1], c[2], 1, nz / ql, 0, -nn[0] / ql, qw / ql, KIND.GROUND);
    }
    if (out.due()) yield;
  }
}
function laneColor(W, wx, d, rng) {
  const ld = laneD(W, wx), off = d - ld;
  const rut = Math.abs(Math.abs(off) - 0.9) < 0.28 ? 1 : 0;
  return jitter(rut ? mix3(C.rut, C.lane, 0.4 * noise1(wx / 3, W.ws + 491)) : C.lane, rng, 0.04);
}

// Dense ground strip for the trackside (lift raises it into a rough cover).
function* fillStrip(ctx, out, W, n, dn, df, color, lift = 0, round = 0.12) {
  const rng = ctx.rng;
  const area = ctx.length * (df - dn);
  const r = Math.sqrt((4 * area) / (Math.PI * Math.max(1, n)));
  for (let i = 0; i < n; i++) {
    const x = rng() * ctx.length, d = dn + rng() * (df - dn);
    const wx = ctx.x0 + x;
    const c = color(wx, d, rng);
    const y = W.H(wx, d);
    out(x, y + lift * rng() + 0.02, -d, r * (0.8 + 0.5 * rng()), r * round, r * 0.6, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Trees. All share the kit's shape: function* (ctx, out, x, d, opts) with opts { height, width,
// y (base), n (splats), rng, kind }. With a small n each draws a cheap distant version.
// ---------------------------------------------------------------------------------------------
export function treeN(out, d, H, Wd) {
  const r = Math.max(0.03, 0.0032 * d * out.detailK / Math.sqrt(out.density)) * 1.2;
  return clamp(Math.round((H * Wd * 0.6) / (r * r * 1.5)), 1, 900 * Math.min(2, out.density));
}
// A snow-laden spruce or fir: drooping tiers of dark boughs, each carrying a pad of snow on its upper
// side (white where it faces the sun, blue-grey where it does not), a dark core so no sky shows
// through, a short trunk below the skirt and a snow-capped leader.
export function* fir(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 14, Wd = opts.width || H * (0.34 + 0.08 * rng());
  const y0 = opts.y != null ? opts.y : ctx.terrain.height(ctx.x0 + x, d) - 0.15;
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const snowK = opts.snow != null ? opts.snow : 0.75;
  const n = Math.max(1, Math.round(opts.n || treeN(out, d, H, Wd)));
  const col = C.spruce, tip = C.spruceTip;
  if (n <= 6) {
    // far: two dark cones and a shelf or two of snow
    const parts = [[0.32, 0.25, 0.22], [0.66, 0.14, 0.17], [0.9, 0.05, 0.08]];
    for (let k = 0; k < Math.min(3, n); k++) {
      const [fy, fw, fh] = parts[k];
      const c = jitter(mul3(col, 0.9 + 0.3 * k), rng, 0.1);
      out(x, y0 + H * fy, -d, Wd * fw * 2, H * fh, Wd * fw * 2, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
    for (let k = 3; k < n; k++) {
      const fy = 0.25 + 0.17 * (k - 3), c = snowTone(-0.3, 0.9, 0.3, 0.9);
      out(x, y0 + H * fy + 0.1 * H, -(d - Wd * 0.1), Wd * (0.5 - fy * 0.4), H * 0.03, Wd * 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
    return;
  }
  const cb = H * (0.04 + 0.08 * rng());
  const span = H - cb;
  const T = clamp(Math.round(Math.sqrt(n) * 0.7), 3, Math.max(3, Math.round(span / 0.6)));
  const tierJ = [];
  for (let k = 0; k < T; k++) tierJ.push(0.8 + 0.4 * rng());
  const s0 = Math.sqrt((H * Wd * 0.5) / n);
  const trunkN = n >= 30 ? Math.max(2, Math.round(n * 0.02)) : 0;
  if (trunkN) {
    const tr = Math.max(0.07, H * 0.014), th = cb + H * 0.1;
    for (let i = 0; i < trunkN; i++) {
      const t = (i + 0.5) / trunkN * th;
      out(x, y0 + t, -d, tr, th / trunkN * 0.65, tr, C.bark[0], C.bark[1], C.bark[2], 1, 0, 0, 0, 1, kind);
    }
  }
  const coreN = Math.max(1, Math.round(n * 0.07));
  for (let i = 0; i < coreN; i++) {
    const t = 1 - Math.sqrt(rng());
    const R = Wd * 0.5 * (1 - t);
    const c = jitter(mul3(col, 0.5), rng, 0.1);
    const ss = Math.max(s0 * 1.4, R * 0.5);
    out(x, y0 + cb + span * t * 0.95, -(d - R * 0.15), ss, Math.max(ss, span / T * 0.6), ss * 0.8, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
  }
  const bn = n - trunkN - coreN - 3;
  const tierH = span / T;
  for (let i = 0; i < bn; i++) {
    const tt = 1 - Math.sqrt(rng());
    const k = Math.min(T - 1, Math.floor(tt * T));
    const tTop = (k + 1) / T;
    const yk = y0 + cb + span * Math.min(0.97, tTop);
    const Rk = Wd * 0.5 * Math.pow(1 - (k + 0.3) / T, 0.95) * tierJ[k] + 0.12;
    let a = rng() * Math.PI * 2;
    if (Math.sin(a) < -0.2 && rng() < 0.6) a = -a;
    const ca = Math.cos(a), sa = Math.sin(a);
    const f = 0.3 + 0.7 * Math.pow(rng(), 0.55);
    const rr = Rk * f;
    const droop = 0.25 + 0.45 * (1 - tTop) + 0.2 * rng();
    const by = yk - droop * rr - tierH * 0.3 * rng();
    const len = Math.min(Rk * 0.55, Math.max(s0 * 1.5, rr * 0.42));
    const th = Math.max(s0 * 0.45, len * 0.3);
    const px = x + ca * rr, pd = d - sa * rr;
    // snow lies on most boughs, more on the upper tiers and the outer half
    if (rng() < snowK * (0.55 + 0.35 * tTop) * (0.5 + 0.6 * f)) {
      const qs = quatXTo(ca, -droop * 0.45, sa);
      const c = snowTone(ca * 0.35, 0.9, sa * 0.35 + 0.15);
      out(px, by + th * 0.75, -pd, len * 0.92, th * 0.55, th * 0.95, c[0], c[1], c[2], 1, qs[0], qs[1], qs[2], qs[3], kind);
    } else {
      const lit = Math.max(0, ca * SX + 0.45 * SY + sa * SZ);
      let c = mix3(col, tip, f * f * (0.25 + 0.75 * lit));
      c = jitter(mul3(c, (0.55 + 0.5 * f) * (0.75 + 0.45 * lit)), rng, 0.1);
      const q = quatXTo(ca, -droop, sa);
      out(px, by, -pd, len, th, th * 0.85, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind);
    }
    if (out.due()) yield;
  }
  // the leader with its cap of snow
  const lc = mul3(tip, 0.9), lw = Math.max(0.05, s0 * 0.35);
  out(x, y0 + H - tierH * 0.4, -d, lw, tierH * 0.5, lw, lc[0], lc[1], lc[2], 1, 0, 0, 0, 1, kind);
  out(x, y0 + H - tierH * 1.2, -d, lw * 1.2, tierH * 0.5, lw * 1.2, lc[0], lc[1], lc[2], 1, 0, 0, 0, 1, kind);
  const sc = snowTone(-0.2, 0.95, 0.2);
  out(x, y0 + H - tierH * 0.9, -d, lw * 2.2, tierH * 0.18, lw * 2.2, sc[0], sc[1], sc[2], 1, 0, 0, 0, 1, kind);
  if (out.due()) yield;
}

// A bare silver birch: a slender white trunk with black marks, a few limbs rising from it, and a
// fine purple-brown haze of twigs (a crown of thin, mostly upright strokes), frosted here and there.
export function* birchBare(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 11, Wc = opts.width || H * (0.42 + 0.14 * rng());
  const y0 = opts.y != null ? opts.y : ctx.terrain.height(ctx.x0 + x, d) - 0.1;
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const n = Math.max(2, Math.round(opts.n || treeN(out, d, H, Wc) * 0.45));
  const lean = (rng() - 0.5) * 0.08;
  const tr = Math.max(thin(d, 0.9), H * 0.014);
  if (n <= 6) {
    // far: the trunk from the snow up into the crown, grey enough to show against snow (a white one
    // did not, and left the crown hanging in the air as a dark puff), and a few puffs of twigs on it
    const fr = Math.max(tr, 0.0008 * d);
    out(x + lean * H * 0.3, y0 + H * 0.36, -d, fr, H * 0.36, fr, 0.44, 0.42, 0.4, 1, 0, 0, 0, 1, kind);
    for (let k = 1; k < n; k++) out(x + lean * H * 0.7 + (rng() - 0.5) * Wc * 0.3, y0 + H * (0.6 + 0.1 * (k % 3)), -d, Wc * 0.24, H * 0.22, Wc * 0.2, C.twig[0], C.twig[1], C.twig[2], 0.42, 0, 0, 0, 1, kind);
    return;
  }
  // trunk: white, black marks, the shaded right side greyer; struts so it stays a line
  // (a tree with few splats to its name spends fewer of them on the trunk, so some are left for twigs)
  const segs = clamp(Math.round(H / 0.6), 4, Math.max(4, Math.min(24, Math.round(n * 0.3))));
  const th = H * 0.8;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs * th, t1 = (i + 1) / segs * th;
    const mark = rng() < 0.3 || t0 < 0.5;
    const c = mark ? [0.12, 0.11, 0.1] : mul3(C.birch, 0.9 + 0.1 * rng());
    bar(out, x + lean * t0, y0 + t0, -d, x + lean * t1, y0 + t1, -d, tr * (1.1 - 0.5 * t0 / th), c, 1, kind);
  }
  // limbs
  const limbs = 3 + Math.floor(rng() * 3);
  const ends = [];
  for (let k = 0; k < limbs; k++) {
    const t = H * (0.4 + 0.35 * rng());
    const a = (k / limbs) * Math.PI * 2 + rng(), out_ = Wc * (0.25 + 0.2 * rng());
    const bx = x + lean * t, by = y0 + t;
    const ex = bx + Math.cos(a) * out_, ez = d - Math.sin(a) * out_ * 0.7, ey = by + H * (0.2 + 0.15 * rng());
    bar(out, bx, by, -d, ex, ey, -ez, tr * 0.55, mul3(C.birch, 0.8), 2, kind);
    ends.push([ex, ey, ez]);
  }
  // the twig haze: thin strokes in a vase over the limbs, drooping at the edges
  const tw = n - segs - limbs * 2;
  const cy = y0 + H * 0.68, rx = Wc * 0.5, ry = H * 0.3;
  // (a stroke is never wider than a spray of twigs could be: with only a handful of splats left for
  // the crown each used to grow to metres across, and the tree was a grey smear standing in the snow)
  const ss = Math.max(thin(d, 0.8), Math.min(Math.sqrt((rx * ry * 3) / Math.max(1, tw)) * 0.5, Wc * 0.045 + 0.0008 * d));
  for (let i = 0; i < tw; i++) {
    let ux = rng() * 2 - 1, uy = rng() * 2 - 1, uz = rng() * 2 - 1;
    const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    if (uz < -0.3 && rng() < 0.6) uz = -uz;
    const rad = 0.3 + 0.7 * Math.pow(rng(), 0.6);
    const px = x + lean * H * 0.7 + ux * rx * rad, py = cy + uy * ry * rad, pd = d - uz * rx * 0.7 * rad;
    const frost = rng() < 0.18;
    const c = frost ? snowTone(-0.2, 0.8, 0.3, 0.8) : jitter(mul3(C.twig, 0.8 + 0.4 * (uy * 0.5 + 0.5)), rng, 0.15);
    const droop = Math.abs(ux) > 0.6 && uy < 0.2;
    const q = quatXTo(ux * 0.3, droop ? -1 : 1, uz * 0.2);
    const len = ss * (1.6 + 1.4 * rng());
    out(px, py, -pd, len, ss * 0.45, ss * 0.45, c[0], c[1], c[2], frost ? 0.8 : 0.6, q[0], q[1], q[2], q[3], kind);
    if (out.due()) yield;
  }
}

// A long shadow on the snow, cast by a low sun from the left: a blue-grey stripe running to the
// right of the thing that casts it (and a little away), cut into short pieces along its length.
function shadowStripe(out, W, ctx, wx, d, len, wid, o = 0.42) {
  const k = Math.max(2, Math.round(len / Math.max(wid * 1.2, 1.5)));
  const dx = 0.92, dd = 0.38;
  for (let i = 0; i < k; i++) {
    const t = (i + 0.5) / k;
    const sx = wx + dx * len * t, sd = d + dd * len * t;
    const w = wid * (1 - 0.35 * t);
    const y = W.H(sx, sd) + 0.05;
    out(sx - ctx.x0, y, -sd, len / k * 0.62, 0.02, w * 0.5, C.snowDeep[0], C.snowDeep[1], C.snowDeep[2], o * (1 - 0.4 * t), 0, Math.sin(0.195), 0, Math.cos(0.195), KIND.GROUND);
  }
}

// Placing trees with a shared budget: collect them first, then give each a share of the splats in
// proportion to its size on screen, capped at full detail.
function* drawPlan(ctx, out, plan, budget) {
  let sw = 0;
  for (const t of plan) sw += t.w;
  plan.sort((a, b) => a.nMax / a.w - b.nMax / b.w || a.d - b.d || a.x - b.x);
  let B = budget, wLeft = sw;
  for (const t of plan) {
    const share = wLeft > 0 ? (B * t.w) / wLeft : 0;
    t.n = Math.max(1, Math.min(t.nMax, Math.round(share)));
    B -= t.n; wLeft -= t.w;
  }
  for (const t of plan) {
    yield* t.fn(ctx, out, t.x, t.d, { ...t.opts, n: t.n });
    if (out.due()) yield;
  }
}
function planTree(ctx, out, wx, d, rng, opts) {
  const isB = opts.birch && rng() < opts.birch;
  let H, Wd;
  if (isB) { H = (opts.H || 12) * (0.6 + 0.35 * rng()); Wd = H * 0.5; } else { H = (opts.H || 14) * (0.75 + 0.4 * rng()); Wd = H * (0.32 + 0.1 * rng()); }
  if (opts.young) H *= opts.young;
  const nMax = Math.max(1, Math.round(treeN(out, d, H, Wd) * (opts.detail || 1) * (isB ? 0.5 : 1)));
  return { fn: isB ? birchBare : fir, x: wx - ctx.x0, d, w: (H * Wd) / (d * d), nMax, opts: { rng, height: H, width: Wd, y: opts.y, kind: opts.kind } };
}
const isForest = (W, wx, d) => surface(W, wx, d).t === T.FOREST;
// The forest seen from outside: trees on a world grid; those at an edge facing the camera at full
// detail, the row behind at reduced detail, a few inside as cheap spires that break the canopy line.
function forestPlan(ctx, out, W, plan, dLo, dHi, sp, opts = {}) {
  const g0 = Math.floor((ctx.x0 - 8) / sp), g1 = Math.floor((ctx.x0 + ctx.length + 8) / sp);
  const k0 = Math.floor(dLo / sp), k1 = Math.floor(dHi / sp);
  for (let gk = k0; gk <= k1; gk++) {
    for (let gx = g0; gx <= g1; gx++) {
      const r = worldRng(ctx, 901, gx, gk);
      const wx = (gx + r()) * sp, d = (gk + r()) * sp;
      if (d < dLo || d >= dHi) continue;
      const s = surface(W, wx, d);
      if (s.t !== T.FOREST) continue;
      const y = s.y - 0.15, Hc = canopyH(W, wx, d);
      if (!isForest(W, wx, d - sp * 1.2)) {
        plan.push(planTree(ctx, out, wx, d, r, { H: Hc, birch: 0.15, y, detail: opts.detail }));
        if (r() < (opts.under != null ? opts.under : 0.5)) plan.push(planTree(ctx, out, wx + (r() - 0.5) * sp, d - sp * (0.3 + 0.4 * r()), r, { H: Hc, birch: 0.3, young: 0.2 + 0.3 * r(), y, detail: opts.detail }));
        continue;
      }
      if (!isForest(W, wx, d - sp * 2.6) || !isForest(W, wx - sp * 1.5, d) || !isForest(W, wx + sp * 1.5, d)) { plan.push(planTree(ctx, out, wx, d, r, { H: Hc, y, detail: 0.35 * (opts.detail || 1) })); continue; }
      if (r() < (opts.inner != null ? opts.inner : 0.1)) {
        const t = planTree(ctx, out, wx, d, r, { H: Hc * 1.1, y });
        t.nMax = Math.min(t.nMax, 6);
        plan.push(t);
      }
    }
  }
}
// Lone trees and small groups out on the snowfields, with their long shadows.
function fieldTrees(ctx, out, W, plan, dLo, dHi, cell) {
  for (const { i, wx0 } of cellsAround(ctx, cell, 14)) {
    const r = worldRng(ctx, 911, i, cell);
    const grove = smooth(0.4, 0.8, noise1(wx0 / 700, W.ws + 912));
    if (r() > 0.25 + 0.5 * grove) continue;
    const m = 1 + Math.floor(r() * (1 + 4 * grove));
    const cx = wx0 + r() * cell, cd = dLo + r() * (dHi - dLo);
    const birch = r() < 0.55 ? 0.85 : 0.2;
    for (let k = 0; k < m; k++) {
      const wx = cx + (r() - 0.5) * 14 * Math.sqrt(m), d = cd + (r() - 0.5) * 10 * Math.sqrt(m);
      if (!inD(d, dLo, dHi)) continue;
      const s = surface(W, wx, d);
      if (s.t !== T.SNOW) continue;
      const t = planTree(ctx, out, wx, d, r, { H: 13, birch, y: s.y - 0.15 });
      plan.push(t);
      if (inX(ctx, wx, t.opts.height * 2.4)) shadowStripe(out, W, ctx, wx, d, t.opts.height * 2.4, t.opts.width * 0.8);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------------------------
// Fill a parallelogram with splats on a jittered grid. o = corner, u/v = unit edge directions
// (splat space), lu/lv = edge lengths; colorAt(a, b) -> [r,g,b] or null (skip: an opening).
function* panel(out, o, u, v, lu, lv, s, colorAt, q, kind, rng, thick = 0.12, move = 0) {
  const nu = Math.max(1, Math.round(lu / (s * 1.4))), nv = Math.max(1, Math.round(lv / (s * 1.4)));
  const su = (lu / nu) * 0.64, sv = (lv / nv) * 0.64;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = (i + 0.5 + (rng() - 0.5) * 0.25) / nu, b = (j + 0.5 + (rng() - 0.5) * 0.25) / nv;
      const c = colorAt(a, b);
      if (!c) continue;
      out(o[0] + u[0] * a * lu + v[0] * b * lv, o[1] + u[1] * a * lu + v[1] * b * lv, o[2] + u[2] * a * lu + v[2] * b * lv, su, sv, s * thick, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind, move);
      if (out.due()) yield;
    }
  }
}
// Tone for a vertical face with outward normal (nx, nz) in splat space: the camera-facing front,
// the sunlit (-x) end and the shaded (+x) end come out clearly different, so corners read in motion.
function faceTone(c, nx, nz) {
  const k = 0.62 + 0.24 * Math.max(0, nz) + 0.4 * Math.max(0, -nx) - 0.08 * Math.max(0, nx) - 0.12 * Math.max(0, -nz);
  const cool = Math.max(0, nx) + Math.max(0, -nz);
  return [c[0] * k * (1 - 0.06 * cool), c[1] * k * (1 - 0.01 * cool), c[2] * k * (1 + 0.1 * cool)];
}
const WALLS = { log: [0.38, 0.23, 0.13], red: [0.52, 0.12, 0.08], ochre: [0.64, 0.46, 0.17], white: [0.74, 0.72, 0.68], blue: [0.24, 0.34, 0.47] };
const ICE = [0.64, 0.72, 0.8];

// A building with a snow-heaped pitched roof: log cabin, painted wooden house, barn. Front faces the
// line (rotated by yaw); every face a passing train sees has splats (the back wall and back roof
// slope too when it stands turned). Warm lit windows (lights) with frames, a door, icicles along
// the eaves, a drift banked against the walls, a stone chimney with smoke.
//   hs: { wx, d, w, dep, h, pitch, yaw, wall, barn, smoke, seed }   o: { s, k (scale), lift, kind, dark }
function* building(ctx, out, W, hs, o = {}) {
  const rng = makeRng(hs.seed);
  const k = o.k || 1;
  const w = hs.w * k, dep = hs.dep * k, h = hs.h * k;
  const pitch = hs.pitch, rh = (dep / 2) * Math.tan(pitch);
  const yaw = hs.yaw, d = hs.d, x = hs.wx - ctx.x0;
  const s = o.s || Math.max(0.1, detail(out, d, 1.05));
  const kind = o.kind != null ? o.kind : KIND.BUILDING;
  const roofKind = o.kind != null ? o.kind : KIND.OTHER;
  let base = Infinity;
  for (const [cx, cd] of [[-w / 2, -dep / 2], [w / 2, -dep / 2], [-w / 2, dep / 2], [w / 2, dep / 2], [0, 0]]) {
    const [rx, rz] = rotY(cx, cd, yaw);
    base = Math.min(base, W.H(hs.wx + rx, d - rz));
  }
  base += -0.3 + (o.lift || 0);
  const q = quatYaw(yaw), qs = quatMul(q, quatYaw(Math.PI / 2));
  const [ex, ez] = rotY(1, 0, yaw), [fx, fz] = rotY(0, 1, yaw);
  const P = (lx, ly, lz) => [x + ex * lx + fx * lz, base + ly, -d + ez * lx + fz * lz];
  const near = d < 110, mid = d < 260;
  const wall = WALLS[hs.wall] || WALLS.log;
  const isLog = hs.wall === 'log';
  const frame = hs.wall === 'white' ? [0.14, 0.24, 0.2] : [0.74, 0.73, 0.7];
  const hh = h + 0.3;
  // openings: windows (lit) and the door, in local (lx, ly) on the front; one window on each end
  const rows = h > 4.5 ? 2 : 1, cols = Math.max(1, Math.floor(w / 2.7));
  const wins = [];
  const doorCol = hs.barn ? -1 : Math.floor(rng() * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lx = -w / 2 + (c + 0.5) * w / cols, ly = r === 0 ? 1.55 * k : h - 1.3 * k;
      if (r === 0 && c === doorCol) continue;
      if (hs.barn && rng() < 0.7) continue;
      wins.push([lx, ly]);
    }
  }
  const WW = 0.46 * k, WH = 0.56 * k;
  const doorX = doorCol >= 0 ? -w / 2 + (doorCol + 0.5) * w / cols : 0, DW = hs.barn ? 1.7 * k : 0.55 * k, DH = hs.barn ? 3.2 * k : 1.05 * k;
  const inOpen = (lx, ly) => {
    if (Math.abs(lx - doorX) < DW && ly < DH * 2 && (doorCol >= 0 || hs.barn)) return 2;
    for (const [wx_, wy] of wins) if (Math.abs(lx - wx_) < WW && Math.abs(ly - wy) < WH) return 1;
    return 0;
  };
  const stripe = (ly) => (isLog ? (Math.floor(ly / (0.3 * k)) % 2 ? 0.82 : 1.04) : 0.97 + 0.05 * Math.sin(ly * 9));
  const wj = 0.94 + 0.12 * rng();
  // the walls
  const toneF = faceTone(mul3(wall, wj), fx, fz), toneB = faceTone(mul3(wall, wj), -fx, -fz);
  yield* panel(out, P(-w / 2, 0, dep / 2), [ex, 0, ez], [0, 1, 0], w, hh, s, (a, b) => {
    const lx = -w / 2 + a * w, ly = b * hh;
    if (inOpen(lx, ly)) return null;
    return mul3(toneF, stripe(ly) * (b > 0.92 ? 0.7 : 1));
  }, q, kind, rng);
  for (const sg of [-1, 1]) {
    const tone = faceTone(mul3(wall, wj), sg * ex, sg * ez);
    const ends = dep >= 5 && !hs.barn;
    yield* panel(out, P(sg * w / 2, 0, dep / 2), [-fx, 0, -fz], [0, 1, 0], dep, hh + rh, s, (a, b) => {
      const yy = b * (hh + rh);
      if (yy > hh && Math.abs(a - 0.5) * 2 > 1 - (yy - hh) / rh) return null;
      if (ends && Math.abs(a - 0.5) * dep < WW && Math.abs(yy - h * 0.55) < WH) return null;
      return mul3(tone, stripe(yy) * (0.92 + 0.12 * b));
    }, qs, kind, rng);
    if (ends) yield* windowAt(ctx, out, P(sg * w / 2 + sg * 0.04, h * 0.55, 0), qs, sg * ex, sg * ez, WW, WH, frame, d, o.dark, W);
  }
  const turned = Math.cos(yaw) < 0.8;
  if (turned) {
    yield* panel(out, P(-w / 2, 0, -dep / 2), [ex, 0, ez], [0, 1, 0], w, hh, s, (a, b) => mul3(toneB, stripe(b * hh)), q, kind, rng);
  }
  // corner log ends on a cabin: short stubs proud of each corner
  if (isLog && near) {
    for (const [cx_, cz_] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      for (let ly = 0.15 * k; ly < hh; ly += 0.3 * k) {
        const [px, py, pz] = P(cx_ * (w / 2 + 0.12), ly, cz_ * (dep / 2 + 0.12));
        const c = mul3(C.log, 1.1);
        out(px, py, pz, 0.16 * k, 0.13 * k, 0.16 * k, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
      }
    }
  }
  // windows and door on the front
  for (const [lx, ly] of wins) yield* windowAt(ctx, out, P(lx, ly, dep / 2 + 0.04), q, fx, fz, WW, WH, frame, d, o.dark, W);
  if (doorCol >= 0 || hs.barn) {
    const dc = hs.barn ? [0.3, 0.07, 0.05] : [0.22, 0.13, 0.08];
    yield* panel(out, P(doorX - DW, 0, dep / 2 + 0.03), [ex, 0, ez], [0, 1, 0], DW * 2, DH * 2, Math.min(s, 0.3), () => faceTone(dc, fx, fz), q, kind, rng);
    if (hs.barn && near) {
      const bc = [0.74, 0.72, 0.68], r_ = thin(d, 1.2);
      const a1 = P(doorX - DW, 0.1, dep / 2 + 0.07), b1 = P(doorX + DW, DH * 2 - 0.1, dep / 2 + 0.07);
      const a2 = P(doorX - DW, DH * 2 - 0.1, dep / 2 + 0.07), b2 = P(doorX + DW, 0.1, dep / 2 + 0.07);
      bar(out, a1[0], a1[1], a1[2], b1[0], b1[1], b1[2], r_, bc, 4, kind);
      bar(out, a2[0], a2[1], a2[2], b2[0], b2[1], b2[2], r_, bc, 4, kind);
    }
    if (!hs.barn) {
      // a lamp over the door, and the light it throws on the snow
      const [lx_, ly_, lz_] = P(doorX + DW + 0.3, DH * 2 + 0.25, dep / 2 + 0.25);
      glow(out, lx_, ly_, -lz_, LAMP, Math.max(0.07, 0.001 * d), 0.16, 4);
      const dk = o.dark != null ? o.dark : darkness(ctx);
      if (dk > 0.2) { const [px, , pz] = P(doorX, 0, dep / 2 + 2.6); pool(out, px, W.H(px + ctx.x0, -pz), -pz, 2.6 * k, 2.2 * k, LAMP, 0.1 * dk); }
    }
  }
  // the roof: thick snow on both slopes (the back one only shows on a turned building)
  const ov = 0.45 * k, ovx = 0.4 * k;
  const slopeLen = Math.hypot(rh, dep / 2) + ov;
  const nR = [fx * Math.sin(pitch), Math.cos(pitch), fz * Math.sin(pitch)];
  const roofC = snowTone(nR[0], nR[1], nR[2]);
  const qr = quatMul(q, quatPitch(-(Math.PI / 2 - pitch)));
  const eaveY = hh - ov * Math.tan(pitch);
  yield* panel(out, P(-w / 2 - ovx, eaveY, dep / 2 + ov), [ex, 0, ez], [-fx * Math.cos(pitch), Math.sin(pitch), -fz * Math.cos(pitch)], w + 2 * ovx, slopeLen, s,
    (a, b) => jitter(mul3(roofC, 0.96 + 0.06 * b), rng, 0.03), qr, roofKind, rng, 0.45);
  if (turned) {
    const qrB = quatMul(q, quatPitch(Math.PI / 2 - pitch));
    const cB = snowTone(-nR[0], nR[1], -nR[2]);
    yield* panel(out, P(-w / 2 - ovx, eaveY, -dep / 2 - ov), [ex, 0, ez], [fx * Math.cos(pitch), Math.sin(pitch), fz * Math.cos(pitch)], w + 2 * ovx, slopeLen, s,
      () => jitter(cB, rng, 0.03), qrB, roofKind, rng, 0.45);
  }
  // the eaves: a rounded lip of snow hanging over a dark fascia, icicles below it
  const lipN = Math.max(2, Math.round((w + 2 * ovx) / Math.max(0.35, s * 1.3)));
  const lipC = snowTone(fx * 0.7, 0.5, fz * 0.7), fas = C.roofDark;
  for (const side of turned ? [1, -1] : [1]) {
    for (let i = 0; i < lipN; i++) {
      const lx = -w / 2 - ovx + (i + 0.5) / lipN * (w + 2 * ovx);
      const [px, py, pz] = P(lx, eaveY + 0.05, side * (dep / 2 + ov + 0.05));
      const sl = (w + 2 * ovx) / lipN * 0.7;
      out(px, py, pz, sl, 0.24 * k, 0.26 * k, lipC[0], lipC[1], lipC[2], 1, q[0], q[1], q[2], q[3], roofKind);
      const [fx_, fy_, fz_] = P(lx, eaveY - 0.22 * k, side * (dep / 2 + ov - 0.05));
      out(fx_, fy_, fz_, sl, 0.09 * k, 0.06, fas[0], fas[1], fas[2], 1, q[0], q[1], q[2], q[3], kind);
      if (mid && rng() < 0.55) {
        const il = (0.2 + 0.7 * rng() * rng()) * k;
        const ir = thin(d, 0.8);
        const [ix, iy, iz] = P(lx + (rng() - 0.5) * 0.2, eaveY - 0.25 * k - il * 0.5, side * (dep / 2 + ov));
        out(ix, iy, iz, ir, il * 0.5, ir, ICE[0], ICE[1], ICE[2], 0.9, 0, 0, 0, 1, roofKind);
      }
    }
    if (out.due()) yield;
  }
  // the gable edges: a dark barge board under the snow's cut edge, both ends
  for (const sg of [-1, 1]) {
    for (const sz of [1, -1]) {
      const a = P(sg * (w / 2 + ovx), eaveY - 0.1, sz * (dep / 2 + ov)), b = P(sg * (w / 2 + ovx), hh + rh + 0.05, 0);
      bar(out, a[0], a[1], a[2], b[0], b[1], b[2], Math.max(0.07 * k, thin(d)), fas, Math.max(2, Math.round(slopeLen / 0.8)), kind);
      const a2 = P(sg * (w / 2 + ovx), eaveY + 0.2, sz * (dep / 2 + ov)), b2 = P(sg * (w / 2 + ovx), hh + rh + 0.3, 0);
      bar(out, a2[0], a2[1], a2[2], b2[0], b2[1], b2[2], Math.max(0.16 * k, thin(d)), snowTone(sg * ex * 0.6, 0.6, sg * ez * 0.6 + 0.3), Math.max(2, Math.round(slopeLen / 0.6)), roofKind);
    }
  }
  // the ridge: a rounded crest of snow
  const rn = Math.max(2, Math.round((w + 2 * ovx) / Math.max(0.4, s * 1.4)));
  const rc = snowTone(0, 1, 0.2);
  for (let i = 0; i < rn; i++) {
    const [px, py, pz] = P(-w / 2 - ovx + (i + 0.5) / rn * (w + 2 * ovx), hh + rh + 0.12, 0);
    out(px, py, pz, (w + 2 * ovx) / rn * 0.7, 0.22 * k, 0.3 * k, rc[0], rc[1], rc[2], 1, q[0], q[1], q[2], q[3], roofKind);
  }
  // a drift banked against the front wall
  if (mid && !o.lift) {
    const dn = Math.max(2, Math.round(w / Math.max(0.5, s * 1.5)));
    const dc_ = snowTone(fx * 0.6, 0.75, fz * 0.6);
    for (let i = 0; i < dn; i++) {
      const lx = -w / 2 + (i + 0.5) / dn * w;
      if (Math.abs(lx - doorX) < DW + 0.2 && doorCol >= 0) continue;
      const [px, py, pz] = P(lx, 0.3, dep / 2 + 0.35);
      out(px, py + 0.12 * rng(), pz, w / dn * 0.75, 0.42 * k, 0.5 * k, dc_[0], dc_[1], dc_[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND);
    }
  }
  // chimney and smoke
  if (!hs.barn && w > 5) {
    const cx_ = (rng() < 0.5 ? -1 : 1) * w * 0.25;
    const cy0 = hh + rh * 0.45;
    const sc = Math.max(0.28 * k, s * 0.8);
    const stone = mul3(C.stone, 0.9);
    for (let j = 0; j < 4; j++) {
      for (const dx of [-0.25, 0.25]) {
        const [px, py, pz] = P(cx_ + dx * k, cy0 + j * 0.35 * k, -0.2);
        const c = faceTone(stone, dx < 0 ? -ex : ex, 0.5);
        out(px, py, pz, sc * 0.8, 0.22 * k, sc * 0.9, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind);
      }
    }
    const [tx, ty, tz] = P(cx_, cy0 + 4 * 0.35 * k + 0.05, -0.2);
    out(tx, ty, tz, 0.48 * k, 0.12 * k, 0.4 * k, rc[0], rc[1], rc[2], 1, q[0], q[1], q[2], q[3], roofKind);
    if (hs.smoke) smoke(out, tx, ty + 0.4, -tz, makeRng(hashInts(hs.seed, 5)), k);
  }
  if (out.due()) yield;
}
// A lit window: a frame, four lit panes, a soft glow by night. c0 = centre (splat space), q its
// facing, (nx, nz) the outward normal.
function* windowAt(ctx, out, c0, q, nx, nz, WW, WH, frame, d, dark, W) {
  const [px, py, pz] = c0;
  const fr = faceTone(frame, nx, nz);
  out(px, py, pz, WW * 1.08, WH * 1.08, 0.05, fr[0], fr[1], fr[2], 1, q[0], q[1], q[2], q[3], KIND.BUILDING);
  const lc = (hashInts(Math.round(px * 7), Math.round(pz * 7)) & 3) === 0 ? LIT2 : LIT;
  const ox = nx * 0.04, oz = nz * 0.04;
  if (d < 140) {
    const ax = WW * 0.42, ay = WH * 0.42;
    // panes: (u along the wall = (-nz, nx) in x-z)
    for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const ux = -nz * u * ax * 1.12, uz = nx * u * ax * 1.12;
      out(px + ox + ux, py + v * ay * 1.12, pz + oz + uz, ax * 0.92, ay * 0.92, 0.04, lc[0], lc[1], lc[2], 1, q[0], q[1], q[2], q[3], KIND.LIGHT);
    }
  } else out(px + ox, py, pz + oz, WW * 0.8, WH * 0.8, 0.04, lc[0], lc[1], lc[2], 1, q[0], q[1], q[2], q[3], KIND.LIGHT);
  const dk = dark != null ? dark : darkness(ctx);
  if (dk > 0.2) {
    // the wall round the window, lit by it: stronger and wider far off, where the lit wall is all
    // that shows there is a house round the light
    const fk = smooth(120, 240, d);
    out(px + ox * 3, py, pz + oz * 3, WW * (2.6 + 1.2 * fk), WH * (2.4 + 0.4 * fk), 0.1, lc[0], lc[1], lc[2], (0.07 + 0.1 * fk) * dk, q[0], q[1], q[2], q[3], KIND.LIGHT);
    // its light on the snow below: a warm patch in front of the wall
    const gx = px + nx * 2.2, gz = pz + nz * 2.2;
    if (W) pool(out, gx, W.H(gx + ctx.x0, -gz), -gz, 1.6, 1.4, lc, 0.08 * dk);
  }
  if (out.due()) yield;
}
// Smoke from a chimney, rising and spreading as it drifts (MOVE.VAPOUR). (x, y, d) in chunk x.
function smoke(out, x, y, d, r, k = 1) {
  const n = 5 + Math.floor(r() * 3), drift = 0.5 + 0.6 * r();
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), s = (0.35 + 1.5 * f) * k;
    const c = mix3([0.56, 0.56, 0.58], [0.7, 0.71, 0.73], f);
    out(x + drift * f * f * 7 * k, y + f * 8 * k, -(d + 0.3 * f), s, s * 0.8, s * 0.7, c[0], c[1], c[2], 0.32 - 0.2 * f, 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
  }
}

// A village church: a white nave with a steep snowy roof, and a square tower carrying a tall spire
// (slate dark, streaked with snow), a clock face, a gilt ball and cross; lit, tall windows.
function* church(ctx, out, W, ch, o = {}) {
  const rng = makeRng(ch.seed);
  const k = o.k || 1, kind = o.kind != null ? o.kind : KIND.BUILDING;
  const yaw = ch.yaw;
  const nave = { wx: ch.wx + 4 * k, d: ch.d, w: 16, dep: 9, h: 7, pitch: 0.95, yaw, wall: 'white', seed: hashInts(ch.seed, 1), smoke: false, church: true };
  if (!o.noNave) yield* building(ctx, out, W, nave, { k, kind: o.kind, dark: o.dark });
  // the tower at the west (-x) end
  const [tx, tz] = rotY(-(8 + 2.9) * k + 4 * k, 0, yaw);
  const twx = ch.wx + tx, td = ch.d - tz;
  const tw = 5.6 * k, th = (o.towerH || 17) * k;
  const s = Math.max(0.12, detail(out, td, 1.05));
  const base = (o.y != null ? o.y : W.H(twx, td)) - 0.4;
  const q = quatYaw(yaw), qs = quatMul(q, quatYaw(Math.PI / 2));
  const [ex, ez] = rotY(1, 0, yaw), [fx, fz] = rotY(0, 1, yaw);
  const x = twx - ctx.x0;
  const P = (lx, ly, lz) => [x + ex * lx + fx * lz, base + ly, -td + ez * lx + fz * lz];
  const white = WALLS.white;
  const slot = (a, b) => Math.abs(a - 0.5) < 0.1 && b > 0.78 && b < 0.9;
  for (const [o_, u_, nx, nz, qq] of [
    [P(-tw / 2, 0, tw / 2), [ex, 0, ez], fx, fz, q],
    [P(-tw / 2, 0, tw / 2), [-fx, 0, -fz], -ex, -ez, qs],
    [P(tw / 2, 0, tw / 2), [-fx, 0, -fz], ex, ez, qs],
  ]) {
    const tone = faceTone(white, nx, nz);
    yield* panel(out, o_, u_, [0, 1, 0], tw, th, s, (a, b) => (slot(a, b) ? [0.08, 0.08, 0.1] : mul3(tone, 0.95 + 0.06 * b)), qq, kind, rng);
  }
  // a cornice of snow round the top of the tower
  const cc = snowTone(0, 1, 0.3);
  for (let i = 0; i < 6; i++) {
    const [px, py, pz] = P(-tw / 2 + (i + 0.5) * tw / 6, th + 0.1, tw / 2 + 0.1);
    out(px, py, pz, tw / 6 * 0.75, 0.2 * k, 0.3 * k, cc[0], cc[1], cc[2], 1, q[0], q[1], q[2], q[3], KIND.OTHER);
  }
  // the clock
  {
    const [px, py, pz] = P(0, th * 0.66, tw / 2 + 0.06);
    out(px, py, pz, 0.85 * k, 0.85 * k, 0.04, 0.78, 0.76, 0.7, 1, q[0], q[1], q[2], q[3], kind);
    const a = P(0, th * 0.66, tw / 2 + 0.1), b = P(0, th * 0.66 + 0.6 * k, tw / 2 + 0.1), c2 = P(0.45 * k, th * 0.66 - 0.1 * k, tw / 2 + 0.1);
    bar(out, a[0], a[1], a[2], b[0], b[1], b[2], thin(td, 0.8), [0.08, 0.08, 0.08], 1, kind);
    bar(out, a[0], a[1], a[2], c2[0], c2[1], c2[2], thin(td, 0.8), [0.08, 0.08, 0.08], 1, kind);
  }
  // the spire: rings of overlapping splats round an octagonal cone, snow lying on the lit side
  const sh = (o.spireH || ch.spire) * k, sr = tw * 0.52;
  const slate = [0.17, 0.2, 0.24];
  const rings = Math.max(4, Math.round(sh / (s * 1.3)));
  for (let i = 0; i < rings; i++) {
    const t = (i + 0.5) / rings, r = sr * (1 - t) + 0.04;
    const cols = Math.max(3, Math.round((2.3 * 2 * r) / (s * 1.25)));
    for (let j = 0; j < cols; j++) {
      const a = ((j + 0.5) / cols * 2 - 1) * 2.3;
      const sa = Math.sin(a), ca = Math.cos(a);
      const lx = sa * r, lz = ca * r;
      const nX = ex * sa + fx * ca, nZ = ez * sa + fz * ca;
      const snowy = noise2(a * 2.5, t * 9, ch.seed & 0xffff) > 0.62 - 0.25 * Math.max(0, -nX);
      const c = snowy ? snowTone(nX * 0.9, 0.45, nZ * 0.9) : shade(slate, nX, 0.25, nZ, 0.55, 0.6);
      const [px, py, pz] = P(lx, th + t * sh, lz);
      const ss = Math.max(0.06, Math.min(s * 0.85, r * 0.6 + 0.05));
      // (snow is not BUILDING: it would clip to white on the beat)
      out(px, py, pz, ss, sh / rings * 0.75, ss * 0.6, c[0], c[1], c[2], 1, 0, 0, 0, 1, snowy && kind === KIND.BUILDING ? KIND.OTHER : kind);
    }
    if (out.due()) yield;
  }
  // ball and cross
  const [bx, by, bz] = P(0, th + sh + 0.25 * k, 0);
  out(bx, by, bz, 0.22 * k, 0.22 * k, 0.22 * k, 0.78, 0.6, 0.2, 1, 0, 0, 0, 1, kind);
  bar(out, bx, by, bz, bx, by + 1.8 * k, bz, Math.max(0.06 * k, thin(td)), [0.7, 0.55, 0.2], 2, kind);
  bar(out, bx - ex * 0.6 * k, by + 1.25 * k, bz - ez * 0.6 * k, bx + ex * 0.6 * k, by + 1.25 * k, bz + ez * 0.6 * k, Math.max(0.06 * k, thin(td)), [0.7, 0.55, 0.2], 2, kind);
}

// The decorated tree on the square: a big fir hung with coloured lights, a star on top. The lights
// are real lights; the star swells on the beat with them.
function* xmasTree(ctx, out, W, wx, d, rng, o = {}) {
  const H = (o.H || 13), Wd = H * 0.42;
  const y = W.H(wx, d) - 0.2;
  const x = wx - ctx.x0;
  yield* fir(ctx, out, x, d, { rng, height: H, width: Wd, y, snow: 0.4, n: Math.min(2400, Math.round(treeN(out, d, H, Wd) * 1.4)) });
  const nb = Math.round(clamp(140 * Math.sqrt(out.density), 40, 220));
  const br = Math.max(0.07, 0.0011 * d);
  for (let i = 0; i < nb; i++) {
    const t = 0.08 + 0.86 * Math.pow(rng(), 0.8);
    const a = (rng() * 2 - 1) * 2.0;
    const r = Wd * 0.5 * (1 - t) * 1.02 + 0.1;
    const c = BULBS[i % BULBS.length];
    glow(out, x + Math.sin(a) * r, y + H * 0.04 + t * H * 0.94, d - Math.cos(a) * r, c, br, out.density > 0.4 ? 0.1 : 0, 3);
    if (out.due()) yield;
  }
  glow(out, x, y + H + 0.5, d - 0.2, [1, 0.86, 0.35], Math.max(0.32, 0.003 * d), 0.25, 3.5);
}
// A string of lights hung between two points (splat-space x, y and distance d): bulbs on a sagging
// cord, colours in turn.
function lightString(out, a, b, sag, d, rng, warm = false, move = 0) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const n = Math.max(3, Math.round(len / 0.9));
  const br = Math.max(0.05, 0.0009 * d);
  const off = Math.floor(rng() * 6);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = lerp(a[0], b[0], t), py = lerp(a[1], b[1], t) - sag * 4 * t * (1 - t), pd = lerp(a[2], b[2], t);
    const c = warm ? LAMP : BULBS[(i + off) % BULBS.length];
    L(out, px, py, pd, br, br, br, c, 1, move);
  }
}

// A village: the church, the square with its tree and strings of lights, houses round about,
// trees among them, street lamps along its front, a snowman or two.
function* villages(ctx, out, W, dLo, dHi, opts = {}) {
  const i0 = Math.floor((ctx.x0 - 250) / VCELL), i1 = Math.floor((ctx.x0 + ctx.length + 250) / VCELL);
  const plan = opts.plan;
  for (let i = i0; i <= i1; i++) {
    const v = village(W, i);
    if (!v || v.dc + v.Rd < dLo - 40 || v.dc - v.Rd > dHi + 40) continue;
    for (const hs of v.houses) {
      if (!inD(hs.d, dLo, dHi) || !inX(ctx, hs.wx, 20)) continue;
      yield* building(ctx, out, W, hs, { s: Math.max(0.12, detail(out, hs.d, 1.05 * (opts.coarse || 1))) });
      if (hs.snowman && opts.small) {
        const r = makeRng(hashInts(hs.seed, 21));
        const sx = hs.wx + (r() - 0.5) * hs.w, sd = hs.d - hs.dep / 2 - 4 - 3 * r();
        if (inD(sd, dLo, dHi)) yield* snowman(ctx, out, W, sx, sd, r);
      }
    }
    if (plan) for (const t of v.trees) {
      if (!inD(t.d, dLo, dHi) || !inX(ctx, t.wx, 15)) continue;
      const r = makeRng(t.seed);
      plan.push(planTree(ctx, out, t.wx, t.d, r, { H: t.birch ? 12 : 13, birch: t.birch ? 1 : 0, y: W.H(t.wx, t.d) - 0.15 }));
    }
    const ch = v.church;
    if (inD(ch.d, dLo, dHi) && inX(ctx, ch.wx, 40)) yield* church(ctx, out, W, ch, {});
    const sq = v.sq;
    if (inD(sq.d, dLo, dHi) && inX(ctx, sq.wx, 30)) {
      const r = makeRng(hashInts(v.seed, 31));
      yield* xmasTree(ctx, out, W, sq.wx, sq.d, r, { H: 12 + 3 * r() });
      // poles round the square, strings of lights from the tree top out to them, and between them
      const np = 5, R = 15;
      const ty = W.H(sq.wx, sq.d) + 11;
      let prev = null;
      for (let p = 0; p <= np; p++) {
        const a = Math.PI * (0.05 + 0.9 * p / np);
        const pwx = sq.wx - Math.cos(a) * R, pd = sq.d - Math.sin(a) * R * 0.8;
        const py = W.H(pwx, pd);
        const px = pwx - ctx.x0;
        bar(out, px, py - 0.2, -pd, px, py + 5.2, -pd, thin(pd, 1.3), [0.16, 0.15, 0.15], 3, KIND.OTHER);
        const top = [px, py + 5.2, pd];
        lightString(out, [sq.wx - ctx.x0, ty, sq.d], top, 0.6, sq.d, r);
        if (prev) lightString(out, prev, top, 0.5, pd, r);
        prev = top;
      }
    }
    // street lamps along the front of the village
    const ld = v.dc - v.Rd - 6;
    if (inD(ld, dLo, dHi)) {
      const dk = darkness(ctx);
      for (let s_ = -v.R; s_ <= v.R; s_ += 24) {
        const wx = v.cx + s_;
        if (!inX(ctx, wx, 1)) continue;
        yield* streetLamp(ctx, out, W, wx, ld, dk);
      }
    }
  }
}
function* streetLamp(ctx, out, W, wx, d, dk, H = 4.6) {
  const y = W.H(wx, d), x = wx - ctx.x0;
  bar(out, x, y - 0.2, -d, x, y + H, -d, thin(d, 1.4), [0.14, 0.14, 0.15], 3, KIND.OTHER);
  const sc = snowTone(0, 1, 0.3);
  out(x, y + H + 0.42, -d, 0.26, 0.08, 0.26, sc[0], sc[1], sc[2], 1, 0, 0, 0, 1, KIND.OTHER);
  out(x, y + H + 0.32, -d, 0.22, 0.06, 0.22, 0.1, 0.1, 0.1, 1, 0, 0, 0, 1, KIND.OTHER);
  glow(out, x, y + H + 0.05, d, LAMP, Math.max(0.11, 0.0013 * d), 0.16, 4.5, MOVE.CHASE);
  if (dk > 0.2) { pool(out, x, y, d, 5, 4, LAMP, 0.12 * dk, MOVE.CHASE); pool(out, x, y, d, 2.2, 1.8, LAMP, 0.16 * dk, MOVE.CHASE); }
  if (out.due()) yield;
}

// A farmstead: a log cabin, maybe a barn or a second house, a woodpile, a split-rail fence, a
// snowman in the yard.
function* farms(ctx, out, W, dLo, dHi, opts = {}) {
  const i0 = Math.floor((ctx.x0 - 60) / FCELL), i1 = Math.floor((ctx.x0 + ctx.length + 60) / FCELL);
  const lift = opts.lift || 0;
  for (let i = i0; i <= i1; i++) {
    const f = farm(W, i);
    if (!f || !inD(f.dc, dLo, dHi) || !inX(ctx, f.cx, 40)) continue;
    const r = makeRng(hashInts(f.seed, 3));
    const fl = lift ? floatLift(W, f, lift) : 0;
    for (const hs of f.bldgs) {
      if (fl > 0) yield* snowHole(ctx, out, W, hs);
      yield* building(ctx, out, W, hs, { lift: fl, kind: fl > 0 ? KIND.SURREAL : undefined });
      if (fl > 0) yield* hangingIce(ctx, out, W, hs, fl);
    }
    if (opts.small) {
      const h0 = f.bldgs[0];
      if (f.woodpile && !fl) yield* woodpile(ctx, out, W, h0, r);
      if (f.snowman) yield* snowman(ctx, out, W, f.snowman.wx, f.snowman.d, r);
      if (f.fence) yield* railFence(ctx, out, W, f.cx - 22, f.cx + 22, f.dc - 13, r);
    }
  }
}
// A woodpile against the end of a building: split logs, their pale cut ends showing, snow on top.
function* woodpile(ctx, out, W, hs, r) {
  const [ox, oz] = rotY(-(hs.w / 2 + 0.9), hs.dep * 0.1, hs.yaw);
  const wx = hs.wx + ox, d = hs.d - oz;
  const y = W.H(wx, d), x = wx - ctx.x0;
  const q = quatYaw(hs.yaw + Math.PI / 2);
  const [ex, ez] = rotY(1, 0, hs.yaw + Math.PI / 2);
  for (let row = 0; row < 4; row++) {
    for (let k = 0; k < 6; k++) {
      const u = (k - 2.5) * 0.36 + (row % 2) * 0.18;
      const c = r() < 0.5 ? [0.6, 0.48, 0.32] : [0.52, 0.4, 0.27];
      out(x + ex * u, y + 0.2 + row * 0.33, -(d - ez * u) , 0.17, 0.16, 0.55, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.OTHER);
    }
  }
  const sc = snowTone(0, 1, 0.3);
  out(x, y + 1.55, -d, 0.45, 0.16, 1.2, sc[0], sc[1], sc[2], 1, q[0], q[1], q[2], q[3], KIND.OTHER);
  out(x - ex * 0.6, y + 1.5, -(d - ez * 0.6), 0.5, 0.14, 1.1, sc[0], sc[1], sc[2], 1, q[0], q[1], q[2], q[3], KIND.OTHER);
  if (out.due()) yield;
}
// A split-rail fence parallel to the line: posts, two rails, snow along the top rail.
function* railFence(ctx, out, W, wa, wb, d, r) {
  const pc = [0.3, 0.24, 0.18], sc = snowTone(0, 1, 0.4);
  const pr = thin(d, 1.6);
  let prev = null;
  for (let wx = wa; wx <= wb + 0.01; wx += 3.2) {
    const y = W.H(wx, d), x = wx - ctx.x0;
    bar(out, x, y - 0.2, -d, x, y + 1.25, -d, pr, pc, 2, KIND.FENCE);
    out(x, y + 1.3, -d, pr * 1.4, 0.06, pr * 1.4, sc[0], sc[1], sc[2], 1, 0, 0, 0, 1, KIND.FENCE);
    if (prev) {
      for (const h of [0.55, 1.05]) bar(out, prev[0], prev[1] + h, -d, x, y + h, -d, pr * 0.8, mul3(pc, 1.15), 2, KIND.FENCE);
      bar(out, prev[0], prev[1] + 1.12, -d, x, y + 1.12, -d, pr * 0.75, sc, 2, KIND.FENCE);
    }
    prev = [x, y];
  }
  if (out.due()) yield;
}

// ---------------------------------------------------------------------------------------------
// Figures: people, snowmen, animals. A handful of shaped, oriented splats each, drawn about 1.3
// times life size so they read in one still at 50-100 m. Each part is placed in the figure's own
// frame (u forward, h up, v to its left) and turned by its heading (yaw in the x-d plane).
// ---------------------------------------------------------------------------------------------
const FIG = 1.3;
function frameOf(ctx, wx, y, d, yaw, k) {
  const ca = Math.cos(yaw), sa = Math.sin(yaw), x0 = wx - ctx.x0;
  const pt = [0, 0, 0];
  const P = (u, h, v) => { pt[0] = x0 + (u * ca - v * sa) * k; pt[1] = y + h * k; pt[2] = -(d + (u * sa + v * ca) * k); return pt; };
  return P;
}
// A person. o: { yaw, k, coat, hat, pose: 'stand'|'skate'|'ski'|'sit'|'walk'|'pull', ph (0..1, the
// stride), scarf, kid, kind }
function* person(ctx, out0, wx, y, d, o) {
  const out = moveOut(out0, MOVE.FLASH);
  const k = (o.k || FIG) * (o.kid ? 0.74 : 1), kind = o.kind != null ? o.kind : KIND.OTHER;
  const P = frameOf(ctx, wx, y, d, o.yaw, k);
  const q = quatYaw(o.yaw);
  const coat = o.coat, legC = o.legs || [0.1, 0.1, 0.13], hat = o.hat || C.coat[(o.coatI + 2) % C.coat.length];
  const lr = Math.max(0.07 * k, thin(d)), ar = Math.max(0.055 * k, thin(d, 0.8));
  const pose = o.pose || 'stand', ph = o.ph || 0;
  let pv = null;
  const PP = (u, h, v) => { pv = P(u, h, v); return pv; };
  const seg = (a, b, r, c) => { const A = [...PP(a[0], a[1], a[2])], B = PP(b[0], b[1], b[2]); bar(out, A[0], A[1], A[2], B[0], B[1], B[2], r, c, 1, kind, MOVE.FLASH); };
  const Ep = (u, h, v, rx, ry, rz, c, qq = q) => { PP(u, h, v); out(pv[0], pv[1], pv[2], rx * k, ry * k, rz * k, c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], kind); };
  // the lean of the body and where the hips are
  let lean = 0, hipH = 0.92, sit = false;
  if (pose === 'skate') lean = 0.45; else if (pose === 'ski') { lean = 0.35; hipH = 0.72; } else if (pose === 'sit') { sit = true; hipH = 0.3; } else if (pose === 'pull') lean = 0.3;
  const sw = Math.sin(ph * Math.PI * 2);
  // legs
  if (sit) {
    seg([0, hipH, 0.1], [0.42, hipH + 0.05, 0.1], lr, legC);
    seg([0, hipH, -0.1], [0.42, hipH + 0.05, -0.1], lr, legC);
  } else if (pose === 'skate') {
    // one leg pushing back and out, the other under the body
    seg([0, hipH, 0.08], [0.05, 0.05, 0.1], lr, legC);
    seg([0, hipH, -0.08], [-0.45, 0.12, -0.32 * (sw > 0 ? 1 : -1) - 0.1], lr, legC);
    Ep(0.08, 0.03, 0.1, 0.17, 0.035, 0.05, [0.7, 0.7, 0.72]);
  } else if (pose === 'ski') {
    for (const v of [0.13, -0.13]) { seg([0, hipH, v], [0.25, 0.4, v], lr, legC); seg([0.25, 0.4, v], [0.05, 0.06, v], lr, legC); }
    // skis and poles
    const sc = o.skiC || [0.7, 0.14, 0.1];
    for (const v of [0.14, -0.14]) seg([-0.75, 0.03, v], [0.95, 0.03, v * 1.1], Math.max(0.035 * k, thin(d, 0.7)), sc);
    for (const v of [0.3, -0.3]) seg([0.35, 1.0, v], [-0.35, 0.02, v * 1.3], Math.max(0.025 * k, thin(d, 0.6)), [0.2, 0.2, 0.22]);
  } else {
    const st = pose === 'walk' || pose === 'pull' ? 0.25 * sw : 0;
    seg([0, hipH, 0.1], [st, 0.04, 0.12], lr, legC);
    seg([0, hipH, -0.1], [-st, 0.04, -0.12], lr, legC);
  }
  // the body: coat, a little lean forward; the coat flares over the hips
  const qb = quatMul(q, quatRoll(-lean));
  const bh = hipH + 0.32, bu = Math.sin(lean) * 0.3;
  Ep(bu, bh, 0, 0.19, 0.33, 0.18, coat, qb);
  Ep(bu * 0.3, hipH + 0.02, 0, 0.21, 0.14, 0.2, mul3(coat, 0.85), qb);
  const nu = Math.sin(lean) * 0.62, nh = hipH + 0.66 * Math.cos(lean) * 0.95;
  // arms
  if (pose === 'skate') {
    seg([nu - 0.05, nh - 0.05, 0.2], [nu - 0.35 + 0.2 * sw, nh - 0.35, 0.45], ar, coat);
    seg([nu - 0.05, nh - 0.05, -0.2], [nu + 0.2 - 0.2 * sw, nh - 0.4, -0.42], ar, coat);
  } else if (pose === 'ski') {
    seg([nu - 0.05, nh - 0.05, 0.2], [0.38, 1.0, 0.3], ar, coat);
    seg([nu - 0.05, nh - 0.05, -0.2], [0.38, 1.0, -0.3], ar, coat);
  } else if (pose === 'sit') {
    seg([nu, nh - 0.05, 0.2], [0.38, hipH + 0.35, 0.24], ar, coat);
    seg([nu, nh - 0.05, -0.2], [0.38, hipH + 0.35, -0.24], ar, coat);
  } else if (pose === 'pull') {
    seg([nu, nh - 0.05, 0.2], [nu - 0.45, nh - 0.5, 0.22], ar, coat);
    seg([nu, nh - 0.05, -0.2], [nu - 0.2, nh - 0.6, -0.25], ar, coat);
  } else {
    seg([nu, nh - 0.05, 0.21], [nu + 0.15 * sw, hipH + 0.05, 0.27], ar, coat);
    seg([nu, nh - 0.05, -0.21], [nu - 0.15 * sw, hipH + 0.05, -0.27], ar, coat);
  }
  // head, hat with a bobble, a scarf whose ends flutter
  const hu = nu + 0.04, hhd = nh + 0.2;
  Ep(hu, hhd, 0, 0.11, 0.12, 0.11, C.skin);
  Ep(hu - 0.01, hhd + 0.1, 0, 0.12, 0.07, 0.12, hat);
  Ep(hu - 0.02, hhd + 0.2, 0, 0.055, 0.055, 0.055, [0.78, 0.77, 0.74]);
  if (o.scarf) {
    const sc = o.scarf;
    Ep(nu, nh - 0.02, 0, 0.13, 0.05, 0.13, sc);
    PP(nu - 0.2, nh - 0.08, 0.06);
    out0(pv[0], pv[1], pv[2], 0.16 * k, 0.045 * k, 0.04 * k, sc[0], sc[1], sc[2], 1, q[0], q[1], q[2], q[3], kind, MOVE.FLAG);
  }
  if (out0.due()) yield;
}
// A snowman: three balls of snow (each shaded round: lit cap, blue shade under), a black hat, a
// carrot nose, coal eyes and buttons, stick arms, a red scarf, and its shadow.
function* snowman(ctx, out, W, wx, d, r, k = FIG) {
  const y = W.H(wx, d) - 0.1, x = wx - ctx.x0;
  const kind = KIND.OTHER;
  const balls = [[0.55, 0.5], [0.4, 1.3], [0.28, 1.9]];
  for (const [rr0, h] of balls) {
    const rr = rr0 * k, cy = y + h * k;
    const n = 9;
    for (let i = 0; i < n; i++) {
      // a ring of lumps round the ball, each lit from its own normal, and a core
      const a = (i / n) * Math.PI * 2, nxl = Math.cos(a) * 0.75, nyl = Math.sin(a) * 0.75, nzl = 0.6;
      const c = snowTone(nxl, nyl, nzl);
      out(x + nxl * rr * 0.55, cy + nyl * rr * 0.55, -(d - nzl * rr * 0.5), rr * 0.55, rr * 0.55, rr * 0.45, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
    const c0 = snowTone(0, 0.6, 0.8);
    out(x, cy, -d, rr * 0.92, rr * 0.92, rr * 0.92, c0[0] * 0.95, c0[1] * 0.95, c0[2] * 0.95, 1, 0, 0, 0, 1, kind);
    const ct = snowTone(-0.3, 0.9, 0.3);
    out(x - rr * 0.15, cy + rr * 0.45, -(d - rr * 0.35), rr * 0.5, rr * 0.35, rr * 0.45, ct[0], ct[1], ct[2], 1, 0, 0, 0, 1, kind);
  }
  const hy = y + 1.9 * k;
  // hat
  out(x, hy + 0.3 * k, -d, 0.3 * k, 0.04 * k, 0.3 * k, 0.08, 0.08, 0.09, 1, 0, 0, 0, 1, kind);
  out(x, hy + 0.48 * k, -d, 0.19 * k, 0.18 * k, 0.19 * k, 0.07, 0.07, 0.08, 1, 0, 0, 0, 1, kind);
  // nose, eyes, buttons
  const nq = quatXTo(0.25, -0.05, 1);
  out(x + 0.06 * k, hy, -(d - 0.3 * k), 0.17 * k, 0.04 * k, 0.04 * k, 0.8, 0.4, 0.08, 1, nq[0], nq[1], nq[2], nq[3], kind);
  for (const s of [-1, 1]) out(x + s * 0.1 * k, hy + 0.09 * k, -(d - 0.24 * k), 0.035 * k, 0.035 * k, 0.03 * k, 0.05, 0.05, 0.05, 1, 0, 0, 0, 1, kind);
  for (const h of [1.15, 1.32, 1.5]) out(x, y + h * k, -(d - 0.38 * k), 0.04 * k, 0.04 * k, 0.03 * k, 0.05, 0.05, 0.05, 1, 0, 0, 0, 1, kind);
  // scarf
  const sc = [0.7, 0.1, 0.08];
  out(x, y + 1.68 * k, -(d - 0.05 * k), 0.3 * k, 0.07 * k, 0.3 * k, sc[0], sc[1], sc[2], 1, 0, 0, 0, 1, kind);
  out(x + 0.18 * k, y + 1.5 * k, -(d - 0.28 * k), 0.06 * k, 0.18 * k, 0.03 * k, sc[0], sc[1], sc[2], 1, 0, 0, 0, 1, kind, MOVE.FLAG);
  // stick arms
  const ac = [0.24, 0.17, 0.11], ar = Math.max(0.03 * k, thin(d, 0.8));
  bar(out, x - 0.35 * k, y + 1.4 * k, -d, x - 0.95 * k, y + 1.75 * k, -d, ar, ac, 2, kind);
  bar(out, x - 0.8 * k, y + 1.65 * k, -d, x - 0.95 * k, y + 1.95 * k, -d, ar * 0.8, ac, 1, kind);
  bar(out, x + 0.35 * k, y + 1.4 * k, -d, x + 0.9 * k, y + 1.55 * k, -(d + 0.1), ar, ac, 2, kind);
  shadowStripe(out, W, ctx, wx + 0.4, d, 4.5, 0.9, 0.35);
  if (out.due()) yield;
}
// A four-legged animal. o: { type: 'horse'|'reindeer'|'deer'|'elk', yaw, k, graze, ph (stride),
// col, harness, kind }. Every splat brightens on the beat (MOVE.FLASH).
function* beast(ctx, out0, wx, y, d, o) {
  const out = moveOut(out0, MOVE.FLASH);
  const k = (o.k || FIG), kind = o.kind != null ? o.kind : KIND.OTHER;
  const P = frameOf(ctx, wx, y, d, o.yaw, k);
  const q = quatYaw(o.yaw);
  const t = o.type;
  // body proportions (metres at life size): body length, height of the back, leg length
  const S = t === 'horse' ? { bl: 0.85, bh: 1.35, br: 0.36, nl: 0.75, hl: 0.3 }
    : t === 'elk' ? { bl: 0.95, bh: 1.65, br: 0.4, nl: 0.55, hl: 0.34 }
      : t === 'reindeer' ? { bl: 0.62, bh: 1.05, br: 0.3, nl: 0.45, hl: 0.22 } : { bl: 0.64, bh: 1.1, br: 0.28, nl: 0.5, hl: 0.22 };
  const col = o.col, dark = mul3(col, 0.6), pale = o.pale || mix3(col, [0.76, 0.74, 0.7], 0.6);
  let pv;
  const PP = (u, h, v) => { pv = P(u, h, v); return pv; };
  const E = (u, h, v, rx, ry, rz, c, qq = q) => { PP(u, h, v); out(pv[0], pv[1], pv[2], rx * k, ry * k, rz * k, c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], kind); };
  const seg = (a, b, r, c) => { const A = [...PP(a[0], a[1], a[2])], B = PP(b[0], b[1], b[2]); bar(out, A[0], A[1], A[2], B[0], B[1], B[2], r, c, 1, kind, MOVE.FLASH); };
  const lr = Math.max((t === 'horse' || t === 'elk' ? 0.075 : 0.05) * k, thin(d));
  const ph = o.ph || 0;
  const legTop = S.bh - S.br * 0.6;
  // legs: a stride for walkers, a knee in each
  for (const [u, v, f] of [[S.bl * 0.7, 0.14, 0], [S.bl * 0.7, -0.14, 0.5], [-S.bl * 0.75, 0.14, 0.5], [-S.bl * 0.75, -0.14, 0]]) {
    const sw = o.walk ? 0.18 * Math.sin((ph + f) * Math.PI * 2) : 0;
    const kneeU = u + sw * 0.5 + (u > 0 ? 0.02 : -0.06), kneeH = legTop * 0.48;
    seg([u, legTop, v], [kneeU, kneeH, v], lr * 1.15, col);
    seg([kneeU, kneeH, v], [u + sw, 0.03, v], lr, t === 'horse' ? dark : mix3(col, [0.1, 0.09, 0.08], 0.4));
  }
  // body: barrel, chest, hindquarters; a pale belly or rump where the animal has one
  E(0, S.bh - S.br * 0.15, 0, S.bl * 0.62, S.br * 0.85, S.br * 0.8, col);
  E(S.bl * 0.55, S.bh - S.br * 0.05, 0, S.br * 0.95, S.br * 0.95, S.br * 0.82, col);
  E(-S.bl * 0.6, S.bh - S.br * 0.1, 0, S.br * 0.95, S.br * 0.9, S.br * 0.85, col);
  E(0, S.bh + S.br * 0.55, 0, S.bl * 0.7, S.br * 0.18, S.br * 0.5, mix3(col, [0.8, 0.78, 0.74], 0.25));   // lit line of the back
  if (t !== 'horse') E(-S.bl * 0.82, S.bh - S.br * 0.05, 0, S.br * 0.5, S.br * 0.6, S.br * 0.75, pale);
  if (t === 'reindeer') E(S.bl * 0.6, S.bh - S.br * 0.35, 0, S.br * 0.6, S.br * 0.75, S.br * 0.7, pale);
  // neck and head: raised, or lowered to the snow
  const g = o.graze;
  const nA = g ? -0.75 : (t === 'horse' ? 0.95 : 0.85);
  const nx0 = S.bl * 0.7, ny0 = S.bh + S.br * 0.2;
  const nx1 = nx0 + Math.cos(nA) * S.nl, ny1 = ny0 + Math.sin(nA) * S.nl;
  const qn = quatMul(q, quatRoll(nA));
  E((nx0 + nx1) / 2, (ny0 + ny1) / 2, 0, S.nl * 0.6, S.br * 0.42, S.br * 0.38, t === 'reindeer' ? pale : col, qn);
  if (t === 'horse') E((nx0 + nx1) / 2 - 0.08, (ny0 + ny1) / 2 + 0.16, 0, S.nl * 0.55, 0.07, 0.06, [0.12, 0.08, 0.06], qn);   // mane
  const hA = g ? -1.35 : -0.55;
  const qh = quatMul(q, quatRoll(hA));
  const hx = nx1 + Math.cos(hA) * S.hl * 0.6, hy = ny1 + Math.sin(hA) * S.hl * 0.6;
  E(hx, hy, 0, S.hl, S.hl * 0.42, S.hl * 0.4, t === 'elk' ? dark : col, qh);
  E(hx + Math.cos(hA) * S.hl * 0.85, hy + Math.sin(hA) * S.hl * 0.85, 0, S.hl * 0.3, S.hl * 0.28, S.hl * 0.3, dark, qh);
  // ears
  for (const v of [-1, 1]) E(nx1 - 0.02, ny1 + 0.1, v * 0.09, 0.04, 0.09, 0.03, col);
  // antlers: up and back from the poll, branching (struts)
  if (o.antlers) {
    const ar = Math.max(0.03 * k, thin(d, 0.7)), ac = t === 'elk' ? [0.5, 0.44, 0.34] : [0.42, 0.34, 0.26];
    const big = t === 'elk' ? 0.9 : t === 'reindeer' ? 1.05 : 0.85;
    for (const v of [-1, 1]) {
      const a = [nx1, ny1 + 0.08, v * 0.06], b = [nx1 - 0.18 * big, ny1 + 0.45 * big, v * 0.3 * big], c = [nx1 - 0.05 * big, ny1 + 0.85 * big, v * 0.38 * big];
      if (t === 'elk') {
        // the broad palm: a flattened, pale plate on each side
        seg(a, [nx1 - 0.05, ny1 + 0.2, v * 0.35], ar, ac);
        E(nx1 - 0.1, ny1 + 0.32, v * 0.55, 0.28, 0.16, 0.05, ac, quatMul(q, quatAxis(1, 0, 0, v * 0.5)));
      } else {
        seg(a, b, ar, ac); seg(b, c, ar * 0.9, ac);
        seg(b, [nx1 + 0.12 * big, ny1 + 0.6 * big, v * 0.32 * big], ar * 0.8, ac);
        seg(c, [nx1 + 0.08 * big, ny1 + 0.95 * big, v * 0.33 * big], ar * 0.7, ac);
        if (t === 'reindeer') seg(a, [nx1 + 0.22, ny1 + 0.3, v * 0.08], ar * 0.8, ac);   // the brow tine
      }
    }
  }
  // tail
  if (t === 'horse') seg([-S.bl * 0.95, S.bh, 0], [-S.bl * 1.1, S.bh - 0.75, 0], lr * 1.6, [0.1, 0.07, 0.05]);
  else E(-S.bl * 0.95, S.bh + 0.02, 0, 0.07, 0.1, 0.06, pale);
  // harness: a collar and a saddle band (red for a horse in a sleigh), with bells
  if (o.harness) {
    const hc = [0.55, 0.08, 0.06];
    E(S.bl * 0.62, S.bh + 0.05, 0, 0.1, S.br * 1.05, S.br * 0.95, hc);
    E(-S.bl * 0.05, S.bh - S.br * 0.1, 0, 0.09, S.br * 1.0, S.br * 0.92, hc);
    for (const v of [-1, 1]) for (const u of [-0.2, 0.2]) {
      PP(u, S.bh - S.br * 0.6, v * S.br * 0.9);
      out0(pv[0], pv[1], pv[2], 0.06 * k, 0.06 * k, 0.06 * k, 0.8, 0.62, 0.18, 1, 0, 0, 0, 1, kind, MOVE.STILL);   // bells: rigid things, nothing on the beat
    }
  }
  if (out0.due()) yield;
}
const ANIMAL_COL = { horse: [[0.26, 0.15, 0.09], [0.18, 0.12, 0.09], [0.62, 0.6, 0.57], [0.4, 0.27, 0.15]], reindeer: [[0.4, 0.33, 0.26], [0.36, 0.31, 0.27], [0.46, 0.4, 0.33]], deer: [[0.4, 0.26, 0.15], [0.36, 0.24, 0.15]], elk: [[0.18, 0.14, 0.11], [0.22, 0.17, 0.13]] };

// A sleigh drawn by a pair of horses or a team of reindeer, on the lane. A red body curling up at
// the front, gilt runners, a driver and passengers under a rug, reins, bells, a lantern.
function* sleigh(ctx, out0, W, wx, d, r, o = {}) {
  const out = moveOut(out0, MOVE.STILL);
  const dir = r() < 0.5 ? 1 : -1, yaw = dir > 0 ? 0 : Math.PI;
  const y = W.H(wx, d) + 0.03;
  const k = FIG;
  const P = frameOf(ctx, wx, y, d, yaw, k);
  const q = quatYaw(yaw);
  const body = [0.6, 0.08, 0.07], gilt = [0.78, 0.6, 0.2];
  let pv;
  const PP = (u, h, v) => { pv = P(u, h, v); return pv; };
  const E = (u, h, v, rx, ry, rz, c, qq = q) => { PP(u, h, v); out(pv[0], pv[1], pv[2], rx * k, ry * k, rz * k, c[0], c[1], c[2], 1, qq[0], qq[1], qq[2], qq[3], KIND.OTHER); };
  const seg = (a, b, rr, c, n = 2) => { const A = [...PP(a[0], a[1], a[2])], B = PP(b[0], b[1], b[2]); bar(out, A[0], A[1], A[2], B[0], B[1], B[2], rr, c, n, KIND.OTHER, MOVE.STILL); };
  const rr = Math.max(0.04 * k, thin(d));
  // runners curling up at the front
  for (const v of [0.5, -0.5]) {
    seg([-1.1, 0.06, v], [0.9, 0.06, v], rr, gilt, 3);
    seg([0.9, 0.06, v], [1.3, 0.45, v], rr, gilt);
    seg([1.3, 0.45, v], [1.15, 0.85, v], rr, gilt);
    for (const u of [-0.7, 0.4]) seg([u, 0.06, v], [u, 0.42, v * 0.9], rr, [0.15, 0.1, 0.08]);
  }
  // the body: a boat-shaped box, the dash curling up in front, a high seat back behind
  const bc = (nx, nz) => faceTone(body, nx, nz);
  for (const v of [0.48, -0.48]) E(-0.15, 0.62, v, 1.0, 0.22, 0.05, bc(0, v > 0 ? 1 : -1));
  E(-0.15, 0.46, 0, 1.0, 0.06, 0.5, mul3(body, 0.7));
  E(0.85, 0.78, 0, 0.12, 0.38, 0.5, bc(1, 0), quatMul(q, quatRoll(-0.5)));
  E(-1.1, 0.95, 0, 0.1, 0.55, 0.5, bc(-1, 0));
  E(-0.2, 0.86, 0, 1.0, 0.035, 0.035, gilt);   // gilt trim along the sides
  // driver at the front, passengers behind under a tartan rug
  const coats = [C.coat[5], C.coat[(Math.floor(r() * 7))], C.coat[(Math.floor(r() * 7))]];
  yield* person(ctx, out0, wx + dir * 0.25 * k, y + 0.38 * k, d, { yaw, k, coat: coats[0], hat: [0.08, 0.08, 0.09], pose: 'sit', kind: KIND.OTHER });
  const np = 1 + Math.floor(r() * 2);
  for (let i = 0; i < np; i++) yield* person(ctx, out0, wx - dir * 0.6 * k, y + 0.38 * k, d + (np === 2 ? (i - 0.5) * 0.45 * k : 0), { yaw, k: k * 0.95, coat: coats[1 + i], coatI: i * 3, pose: 'sit', scarf: [0.75, 0.75, 0.72], kind: KIND.OTHER });
  E(-0.55, 0.85, 0, 0.45, 0.12, 0.5, [0.4, 0.12, 0.1]);
  // the team: a pair of horses, or two or four reindeer in pairs
  const team = o.team || (r() < 0.55 ? 'horse' : 'reindeer');
  const pairs = team === 'horse' ? 1 : 1 + (r() < 0.5 ? 1 : 0);
  const cols = ANIMAL_COL[team];
  const ph = r();
  for (let p = 0; p < pairs; p++) {
    for (const v of [0.45, -0.45]) {
      const u = 2.6 + p * (team === 'horse' ? 2.6 : 2.0);
      const [ax, , az] = P(u, 0, v);
      yield* beast(ctx, out0, ax + ctx.x0, y, -az, { type: team, yaw, k, col: cols[Math.floor(r() * cols.length)], antlers: team === 'reindeer', harness: true, walk: true, ph: ph + p * 0.3 + (v > 0 ? 0.25 : 0) });
    }
  }
  // shafts or traces and the reins
  const rc = [0.12, 0.08, 0.06];
  seg([0.9, 0.5, 0.3], [2.6 + 0.6, 1.2, 0.3], rr * 0.9, rc, 3);
  seg([0.9, 0.5, -0.3], [2.6 + 0.6, 1.2, -0.3], rr * 0.9, rc, 3);
  seg([0.6, 1.3, 0.1], [2.6 + 0.9, 1.75, 0.35], rr * 0.6, rc, 3);
  seg([0.6, 1.3, -0.1], [2.6 + 0.9, 1.75, -0.35], rr * 0.6, rc, 3);
  // the lantern on a post at the dash
  const [lx, ly, lz] = PP(1.0, 1.75, 0.5);
  seg([1.0, 0.8, 0.5], [1.0, 1.65, 0.5], rr * 0.8, [0.1, 0.1, 0.1]);
  glow(out0, lx, ly, -lz, LAMP, Math.max(0.09, 0.0012 * d), 0.18, 4, MOVE.BEAT);
  // (in the dark the lantern lights the snow beside the sleigh: a lamp on something, not a spark over the lane)
  const dk = darkness(ctx);
  if (dk > 0.2) pool(out0, lx, y, -lz, 3.2, 2.2, LAMP, 0.13 * dk);
  if (out0.due()) yield;
}

// The skating pond: skaters circling on the swept ice, a bench, lamps round the edge with a string
// of lights, a brazier's glow.
function* pondProps(ctx, out, W, p, dLo, dHi) {
  const r = makeRng(p.seed);
  const dk = darkness(ctx);
  const n = 6 + Math.floor(r() * 8);
  const y = p.level + 0.02;
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, e = 0.25 + 0.6 * Math.sqrt(r());
    const wx = p.cx + Math.cos(a) * p.rx * e, d = p.dc + Math.sin(a) * p.rd * e;
    if (!inD(d, dLo, dHi) || !inX(ctx, wx, 3)) { r(); r(); r(); r(); continue; }
    // skating round the pond (anticlockwise seen from above), a few the other way or standing
    const ccw = r() < 0.8 ? 1 : -1;
    const tang = Math.atan2(Math.cos(a) * p.rd, -Math.sin(a) * p.rx) * ccw;
    const yaw = -tang;
    const ci = Math.floor(r() * C.coat.length);
    const kid = r() < 0.3;
    yield* person(ctx, out, wx, y, d, { yaw, coat: C.coat[ci], coatI: ci, pose: r() < 0.82 ? 'skate' : 'stand', ph: r(), scarf: C.coat[(ci + 3) % C.coat.length], kid });
  }
  // lamps on posts round the far side, a string of lights between them
  const lamps = [];
  for (let j = 0; j < 4; j++) {
    const a = Math.PI * (0.15 + 0.7 * j / 3);
    const wx = p.cx - Math.cos(a) * p.rx * 1.15, d = p.dc + Math.sin(a) * p.rd * 1.2;
    lamps.push([wx, d]);
    if (inD(d, dLo, dHi) && inX(ctx, wx, 1)) yield* streetLamp(ctx, out, W, wx, d, dk, 4);
    // the lamps light the ice and the skaters on it
    const id = p.dc + (d - p.dc) * 0.55, ix = p.cx + (wx - p.cx) * 0.6;
    if (dk > 0.2 && inD(id, dLo, dHi) && inX(ctx, ix, 2)) pool(out, ix - ctx.x0, p.level + 0.04, id, p.rx * 0.4, p.rd * 0.45, LAMP, 0.1 * dk, MOVE.CHASE);
  }
  for (let j = 0; j + 1 < lamps.length; j++) {
    const [ax, ad] = lamps[j], [bx, bd] = lamps[j + 1];
    if (!inD((ad + bd) / 2, dLo, dHi) || !inX(ctx, (ax + bx) / 2, 10)) continue;
    lightString(out, [ax - ctx.x0, W.H(ax, ad) + 3.8, ad], [bx - ctx.x0, W.H(bx, bd) + 3.8, bd], 0.5, ad, r, false, MOVE.CHASE);
  }
  // a bench on the near bank
  const bx = p.cx + (r() - 0.5) * p.rx, bd = p.dc - p.rd * 1.2;
  if (inD(bd, dLo, dHi) && inX(ctx, bx, 2)) {
    const by = W.H(bx, bd), x = bx - ctx.x0;
    const wc = [0.32, 0.2, 0.12], sc = snowTone(0, 1, 0.3);
    out(x, by + 0.55, -bd, 1.0, 0.06, 0.25, wc[0], wc[1], wc[2], 1, 0, 0, 0, 1, KIND.OTHER);
    out(x, by + 0.63, -bd, 0.95, 0.05, 0.22, sc[0], sc[1], sc[2], 1, 0, 0, 0, 1, KIND.OTHER);
    out(x, by + 0.9, -(bd + 0.25), 1.0, 0.2, 0.04, wc[0], wc[1], wc[2], 1, 0, 0, 0, 1, KIND.OTHER);
    for (const u of [-0.85, 0.85]) bar(out, x + u, by - 0.1, -bd, x + u, by + 0.55, -bd, thin(bd, 1.2), [0.12, 0.12, 0.12], 1, KIND.OTHER);
  }
  if (out.due()) yield;
}

// Children sledging down the face of the hill, others towing their sledges back up, tracks in the
// snow; a parent or two at the foot.
function* sledProps(ctx, out, W, s, dLo, dHi) {
  const r = makeRng(s.seed);
  const n = 7 + Math.floor(r() * 6);
  for (let i = 0; i < n; i++) {
    const wx = s.cx + (r() - 0.5) * s.rx * 1.1, d = s.dc - s.rd * (0.3 + 1.05 * r());
    const ci = Math.floor(r() * C.coat.length), down = r() < 0.6, ph = r(), yawJ = (r() - 0.5) * 0.5;
    if (!inD(d, dLo, dHi) || !inX(ctx, wx, 6)) continue;
    const y = W.H(wx, d);
    // the slope here runs down toward the line (-d): a sledge comes down heading toward the camera
    const yaw = -Math.PI / 2 + yawJ;
    if (down) {
      yield* sledge(ctx, out, W, wx, d, yaw, ci);
      yield* person(ctx, out, wx, y + 0.3, d, { yaw, coat: C.coat[ci], coatI: ci, pose: 'sit', kid: true, scarf: C.coat[(ci + 2) % 7] });
      // the track behind it, up the slope
      const tc = C.snowShade;
      for (let t = 1; t < 8; t++) {
        const td = d + t * 1.6, twx = wx - Math.sin(yawJ) * t * 1.6;
        if (!inX(ctx, twx, 0)) continue;
        for (const v of [-0.3, 0.3]) out(twx - ctx.x0 + v, W.H(twx, td) + 0.03, -td, 0.06, 0.02, 0.9, tc[0], tc[1], tc[2], 0.7, 0, 0, 0, 1, KIND.GROUND);
      }
    } else {
      const yu = Math.PI / 2 + yawJ;
      yield* person(ctx, out, wx, y, d, { yaw: yu, coat: C.coat[ci], coatI: ci, pose: 'pull', ph, kid: true, scarf: C.coat[(ci + 4) % 7] });
      const [bx, , bz] = frameOf(ctx, wx, y, d, yu, FIG)(-1.4, 0, 0);
      yield* sledge(ctx, out, W, bx + ctx.x0, -bz, yu, ci);
    }
  }
  // grown-ups at the foot
  for (let i = 0; i < 2; i++) {
    const wx = s.cx + (r() - 0.5) * s.rx, d = s.dc - s.rd * 1.45;
    const ci = Math.floor(r() * C.coat.length), yaw = Math.PI / 2 + (r() - 0.5);
    if (inD(d, dLo, dHi) && inX(ctx, wx, 2)) yield* person(ctx, out, wx, W.H(wx, d), d, { yaw, coat: C.coat[ci], coatI: ci, pose: 'stand', scarf: C.coat[(ci + 1) % 7] });
  }
}
function* sledge(ctx, out0, W, wx, d, yaw, ci) {
  const out = moveOut(out0, MOVE.STILL);
  const y = W.H(wx, d);
  const P = frameOf(ctx, wx, y, d, yaw, FIG);
  const q = quatYaw(yaw);
  const wc = ci % 2 ? [0.5, 0.32, 0.18] : [0.62, 0.12, 0.08];
  let pv = P(0, 0.22, 0);
  out(pv[0], pv[1], pv[2], 0.5 * FIG, 0.04 * FIG, 0.2 * FIG, wc[0], wc[1], wc[2], 1, q[0], q[1], q[2], q[3], KIND.OTHER);
  for (const v of [0.18, -0.18]) {
    const a = [...P(-0.5, 0.04, v)], b = [...P(0.45, 0.04, v)], c = P(0.6, 0.25, v);
    bar(out, a[0], a[1], a[2], b[0], b[1], b[2], thin(d, 0.9), [0.2, 0.18, 0.16], 2, KIND.OTHER, MOVE.STILL);
    bar(out, b[0], b[1], b[2], c[0], c[1], c[2], thin(d, 0.9), [0.2, 0.18, 0.16], 1, KIND.OTHER, MOVE.STILL);
  }
  if (out0.due()) yield;
}

// The chair lift up the ski hill, built the way pinewood.js builds its pylons: every member a
// strut lying along the member and sized from distance, never a row of round blobs.
//   the line   from the valley station at the foot (s.bx, s.bd) straight up the face toward
//              (s.lx1, s.ld1), ending at the top station just short of the brow (liftGeom().td); a
//              tower every 40 m or so, closer up the river bank where the hill rises from one, and
//              a last one a few metres below the top station
//   a tower    a steel column on a footing, a cross-arm with a sheave train under each cable, a king
//              post and two stays over the arm, snow lying along it
//   a station  a bull wheel (rim and spokes) on a mast with two back-stays, beside a hut with lit
//              windows; the lamp hangs under the hut's eaves and lights its wall, the snow and the
//              wheel, so in the dark the light has a hut round it
//   the cables two, sagging between the tower heads, one strut for each step of the curve
//   a chair    a hanger, a hoop, a seat and a back rest; riders going up (they answer the beat)
// Each piece is drawn by the band its own distance falls in.
const LIFT_G = 2.7;                 // each cable runs this far to the side of the centre line
const STEEL = [0.36, 0.37, 0.4], STEEL_DARK = [0.15, 0.15, 0.17], CABLE = [0.1, 0.1, 0.11];
const liftSag = (a, b) => 0.03 * Math.hypot(b.wx - a.wx, b.d - a.d);
function liftGeom(W, s) {
  if (s.geom) return s.geom;
  const ux0 = s.lx1 - s.bx, ud0 = s.ld1 - s.bd, ul = Math.hypot(ux0, ud0);
  // The top station stands just short of the brow: the last ground the train can see on the way up
  // the line. Past it the hill hides the snow a hut stands on, and all that showed of a station up
  // there was its lamp, hanging over the skyline.
  let td = s.ld1, best = -1;
  const sight = (d) => (W.H(s.bx + ux0 * (d - s.bd) / ud0, d) - 2.6) / d;
  for (let d = s.ld0 + 60; d <= s.ld1; d += 4) best = Math.max(best, sight(d));
  for (let d = s.ld0 + 60; d <= s.ld1; d += 4) if (sight(d) >= best - 0.0025) { td = d; break; }
  // towers: closer together up the river bank (to its brow, where the old line began), then every
  // 40 m or so, and a last one a few metres short of the top station
  const bank = s.ld0 - s.bd > 26, stops = [s.bd];
  if (bank) stops.push(s.ld0);
  stops.push(td - 17, td);
  const pts = [];
  for (let k = 0; k + 1 < stops.length; k++) {
    const a = stops[k], b = stops[k + 1], n = k + 2 === stops.length ? 1 : Math.max(1, Math.round((b - a) / (bank && k === 0 ? 24 : 40)));
    for (let j = k === 0 ? 0 : 1; j <= n; j++) {
      const d = lerp(a, b, j / n), wx = s.bx + ux0 * (d - s.bd) / ud0;
      pts.push({ wx, d, y: W.H(wx, d), station: false, H: 0, s: 0 });
    }
  }
  pts[0].station = pts[pts.length - 1].station = true;
  pts.forEach((p, i) => { p.H = p.station ? 5.4 : 12.5 + 1.5 * Math.sin(i * 1.7); });
  // towers grow until a chair clears the snow all along each span (less is asked close to a station)
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], sag = liftSag(a, b);
      let lack = 0;
      for (let j = 1; j < 8; j++) {
        const t = j / 8, need = Math.min(7.5, a.station ? 4.6 + 14 * t : 9, b.station ? 4.6 + 14 * (1 - t) : 9);
        lack = Math.max(lack, W.H(lerp(a.wx, b.wx, t), lerp(a.d, b.d, t)) + need - (lerp(a.y + a.H, b.y + b.H, t) - sag * 4 * t * (1 - t)));
      }
      if (lack > 0) {
        if (!a.station) a.H = Math.min(26, a.H + lack * (b.station ? 1.6 : 1));
        if (!b.station) b.H = Math.min(26, b.H + lack * (a.station ? 1.6 : 1));
      }
    }
  }
  let len = 0;
  for (let i = 1; i < pts.length; i++) { len += Math.hypot(pts[i].wx - pts[i - 1].wx, pts[i].d - pts[i - 1].d, pts[i].y + pts[i].H - pts[i - 1].y - pts[i - 1].H); pts[i].s = len; }
  // (ux, ud) along the line, uphill; (ax, ad) across it, in x and distance
  return (s.geom = { pts, td, ux: ux0 / ul, ud: ud0 / ul, ax: -ud0 / ul, ad: ux0 / ul, len });
}
// The point of the cable on side sg (+1 the way up, -1 the way down) a share t along span i: world x, y, distance.
function cableAt(G, i, t, sg) {
  const a = G.pts[i], b = G.pts[i + 1];
  return [lerp(a.wx, b.wx, t) + sg * G.ax * LIFT_G, lerp(a.y + a.H, b.y + b.H, t) - liftSag(a, b) * 4 * t * (1 - t), lerp(a.d, b.d, t) + sg * G.ad * LIFT_G];
}
function liftTower(ctx, out, G, p, slope) {
  const x = p.wx - ctx.x0, d = p.d, top = p.y + p.H;
  const r = Math.max(0.17, 0.0011 * d), A = LIFT_G + 0.45;
  // q across the line, w along it (rising with the cable), h above the cross-arm
  const pt = (q, h, w) => [x + G.ax * q + G.ux * w, top + h + slope * w, -(d + G.ad * q + G.ud * w)];
  const S = (a, b, rr, c, n, kind = KIND.MAST) => strut(out, a[0], a[1], a[2], b[0], b[1], b[2], rr, c, n, 1, kind);
  out(x, p.y + 0.1, -d, r * 2.4, 0.4, r * 2.4, 0.46, 0.46, 0.45, 1, 0, 0, 0, 1, KIND.MAST);
  S([x, p.y - 0.5, -d], [x, top, -d], r, STEEL, Math.max(3, Math.round(p.H / 2.4)));
  S(pt(-A, 0, 0), pt(A, 0, 0), r * 0.8, STEEL, 4);
  S(pt(0, 0, 0), pt(0, 2.0, 0), r * 0.6, STEEL, 1);
  for (const sg of [-1, 1]) {
    S(pt(0, 2.0, 0), pt(sg * A, 0.1, 0), r * 0.5, mul3(STEEL, sg < 0 ? 1.1 : 0.9), 2);
    S(pt(sg * LIFT_G, -0.32, -1.9), pt(sg * LIFT_G, -0.32, 1.9), r * 0.7, STEEL_DARK, 2);
  }
  const sc = snowTone(0, 1, 0.3);
  S(pt(-A, r * 0.8 + 0.06, 0), pt(A, r * 0.8 + 0.06, 0), r * 0.5, sc, 3, KIND.OTHER);
}
// The base height building() gives a house (its lowest corner), so things fixed to its walls match.
function houseBase(W, hs, w, dep) {
  let base = Infinity;
  for (const [cx, cd] of [[-w / 2, -dep / 2], [w / 2, -dep / 2], [-w / 2, dep / 2], [w / 2, dep / 2], [0, 0]]) {
    const [rx, rz] = rotY(cx, cd, hs.yaw);
    base = Math.min(base, W.H(hs.wx + rx, hs.d - rz));
  }
  return base - 0.3;
}
function* liftStation(ctx, out, W, s, G, p, top) {
  const x = p.wx - ctx.x0, d = p.d, hy = p.y + p.H;
  const r = Math.max(0.17, 0.0011 * d), rw = Math.max(0.08, 0.0007 * d);
  const dk = darkness(ctx), back = top ? 1 : -1;
  const wheel = [0.62, 0.25, 0.1];
  const pt = (q, w, y) => [x + G.ax * q + G.ux * w, y, -(d + G.ad * q + G.ud * w)];
  const S = (a, b, rr, c, n, o = 1, kind = KIND.MAST) => strut(out, a[0], a[1], a[2], b[0], b[1], b[2], rr, c, n, o, kind);
  // the bull wheel the cable turns round: a level rim and two spokes
  const N = 12, rim = [];
  for (let j = 0; j <= N; j++) { const a = (j / N) * Math.PI * 2; rim.push(pt(Math.cos(a) * LIFT_G, Math.sin(a) * LIFT_G, hy)); }
  for (let j = 0; j < N; j++) S(rim[j], rim[j + 1], rw, wheel, 1);
  S(pt(-LIFT_G, 0, hy), pt(LIFT_G, 0, hy), rw * 0.8, wheel, 2);
  S(pt(0, -LIFT_G, hy), pt(0, LIFT_G, hy), rw * 0.8, wheel, 2);
  // its mast, and two back-stays down to the snow behind it
  const mTop = pt(0, 0, hy + 1.1);
  S(pt(0, 0, p.y - 0.5), mTop, r * 1.1, STEEL, 3);
  for (const q of [-1.7, 1.7]) {
    const wb = back * 5.5;
    S(mTop, pt(q, wb, W.H(p.wx + G.ax * q + G.ux * wb, d + G.ad * q + G.ud * wb) - 0.3), r * 0.65, STEEL, 3);
  }
  const sc = snowTone(0, 1, 0.3);
  S(pt(-0.9, 0, hy + 1.1 + r), pt(0.9, 0, hy + 1.1 + r), r * 0.7, sc, 1, 1, KIND.OTHER);
  // the hut: level with the wheel on the piste's side of it, where the ground is open. It stands on
  // a stone footing, its floor at the height of the ground under its middle: on a face this steep a
  // hut standing on its lowest corner has the snow in front of it up to its eaves
  const side = pisteC(s, d) > p.wx ? -1 : 1, kb = top ? 1.35 : 1.15;     // (the wheel is on the hut's `side` end)
  const hs = { wx: p.wx - side * 12, d: d + back, w: 8.5, dep: 5.5, h: 3.3, pitch: 0.55, yaw: 0.08 * side, wall: top ? 'log' : 'red', smoke: top, seed: hashInts(s.seed, 61, top ? 1 : 0) };
  const w = hs.w * kb, dep = hs.dep * kb, h = hs.h * kb, low = houseBase(W, hs, w, dep);
  const up = clamp(W.H(hs.wx, hs.d) - 0.3 - low, 0, 3.2), base = low + up;
  const sB = Math.max(0.12, Math.min(detail(out, hs.d, 1.05), 0.0022 * hs.d));
  yield* building(ctx, out, W, hs, { k: kb, s: sB, lift: up });
  const [ex, ez] = rotY(1, 0, hs.yaw), [fx, fz] = rotY(0, 1, hs.yaw), q = quatYaw(hs.yaw), qs = quatMul(q, quatYaw(Math.PI / 2));
  const P = (lx, ly, lz) => [hs.wx - ctx.x0 + ex * lx + fx * lz, base + ly, -hs.d + ez * lx + fz * lz];
  if (up > 0.3) {
    const fr = makeRng(hashInts(hs.seed, 63)), stone = mul3(C.stone, 0.85), fh = up + 0.8;
    yield* panel(out, P(-w / 2, -fh, dep / 2), [ex, 0, ez], [0, 1, 0], w, fh, sB, () => jitter(faceTone(stone, fx, fz), fr, 0.06), q, KIND.BUILDING, fr);
    for (const sg of [-1, 1]) yield* panel(out, P(sg * w / 2, -fh, dep / 2), [-fx, 0, -fz], [0, 1, 0], dep, fh, sB, () => jitter(faceTone(stone, sg * ex, sg * ez), fr, 0.06), qs, KIND.BUILDING, fr);
  }
  // the station lamp: under the eaves at the corner next to the wheel, lighting the wall below it,
  // the snow in front and (faintly) the wheel and its mast
  const lxL = side * (w / 2 - 1.0 * kb);
  const lp = P(lxL, h + 0.05, dep / 2 + 0.4);
  glow(out, lp[0], lp[1], -lp[2], LAMP, Math.max(0.11, 0.0013 * d), 0.15, 3.2);
  if (dk > 0.15) {
    const wp = P(lxL * 0.8, h * 0.5, dep / 2 + 0.1);
    out(wp[0], wp[1], wp[2], 2.8 * kb, h * 0.52, 0.05, LAMP[0], LAMP[1], LAMP[2], 0.34 * dk, q[0], q[1], q[2], q[3], KIND.LIGHT);
    const gp = P(lxL, -up, dep / 2 + 3 * kb);
    pool(out, gp[0], W.H(gp[0] + ctx.x0, -gp[2]), -gp[2], 4 * kb, 2.6 * kb, LAMP, 0.13 * dk);
    S(pt(0, 0, p.y + 0.5), mTop, r * 1.15, LAMP, 2, 0.2 * dk, KIND.LIGHT);
    for (let j = 0; j < N; j += 1) S(rim[j], rim[j + 1], rw * 1.1, LAMP, 1, 0.22 * dk, KIND.LIGHT);
  }
  if (out.due()) yield;
}
// One chair hanging from the cable at (x, y, distance d): sg +1 on the way up (with riders), -1 coming down.
function liftChair(out, x, y, d, G, sg, hr) {
  const k = 1.3 + 0.4 * smooth(250, 480, d);
  const r = Math.max(0.045, 0.0006 * d), fc = [0.16, 0.17, 0.2], seat = [0.2, 0.23, 0.32];
  const hw = 1.05 * k, dir = sg;                 // riders face the way the chair travels
  // q across the line, h below the cable, w along the line (uphill)
  const pt = (q, h, w) => [x + G.ax * q + G.ux * w, y - h, -(d + G.ad * q + G.ud * w)];
  const S = (a, b, rr, c, n) => strut(out, a[0], a[1], a[2], b[0], b[1], b[2], rr, c, n, 1, KIND.OTHER);
  S(pt(0, 0, 0), pt(0, 1.25 * k, 0), r, fc, 1);
  S(pt(-hw, 1.25 * k, 0), pt(hw, 1.25 * k, 0), r, fc, 2);
  for (const q of [-hw, hw]) S(pt(q, 1.25 * k, 0), pt(q, 2.85 * k, 0), r, fc, 2);
  S(pt(-hw, 2.85 * k, 0), pt(hw, 2.85 * k, 0), r * 1.7, seat, 2);
  S(pt(-hw, 2.3 * k, -dir * 0.15 * k), pt(hw, 2.3 * k, -dir * 0.15 * k), r * 1.3, seat, 2);
  if (sg < 0 || hr % 100 >= 65) return;
  const n = 1 + (hr % 3);
  const B = (a, b, rr, c) => bar(out, a[0], a[1], a[2], b[0], b[1], b[2], rr, c, 1, KIND.OTHER, MOVE.FLASH);
  for (let j = 0; j < n; j++) {
    const q = (j - (n - 1) / 2) * 0.66 * k, ci = (hr + j * 3) % 7, coat = C.coat[ci], hat = C.coat[(ci + 2) % 7];
    B(pt(q, 2.8 * k, 0), pt(q, 2.05 * k, 0), Math.max(0.2 * k, thin(d, 1.2)), coat);
    const hp = pt(q, 1.86 * k, 0), hrad = Math.max(0.12 * k, thin(d, 0.9));
    out(hp[0], hp[1], hp[2], hrad, hrad, hrad, hat[0], hat[1], hat[2], 1, 0, 0, 0, 1, KIND.OTHER, MOVE.FLASH);
    B(pt(q, 2.8 * k, dir * 0.1 * k), pt(q, 3.35 * k, dir * 0.45 * k), Math.max(0.09 * k, thin(d)), [0.1, 0.1, 0.13]);
    B(pt(q, 3.45 * k, -dir * 0.35 * k), pt(q, 3.35 * k, dir * 1.2 * k), Math.max(0.04 * k, thin(d, 0.7)), C.coat[(ci + 3) % 7]);
  }
}
function* skiProps(ctx, out, W, s, dLo, dHi, plan) {
  const r = makeRng(s.seed);
  const G = liftGeom(W, s), pts = G.pts;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!inD(p.d, dLo, dHi) || !inX(ctx, p.wx, 30)) continue;
    if (p.station) yield* liftStation(ctx, out, W, s, G, p, i > 0);
    else {
      const a = pts[i - 1], b = pts[i + 1];
      liftTower(ctx, out, G, p, (b.y + b.H - a.y - a.H) / Math.hypot(b.wx - a.wx, b.d - a.d));
    }
    if (out.due()) yield;
  }
  // the two cables: each piece runs from one point of the sagging curve to the next and takes its
  // thickness from its own distance
  for (const sg of [-1, 1]) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.max(a.d, b.d) < dLo - 4 || Math.min(a.d, b.d) >= dHi + 4 || !inX(ctx, (a.wx + b.wx) / 2, 50)) continue;
      const steps = Math.ceil((b.s - a.s) / Math.max(1.4, 0.007 * Math.min(a.d, b.d)));
      let P0 = cableAt(G, i, 0, sg);
      for (let j = 1; j <= steps; j++) {
        const P1 = cableAt(G, i, j / steps, sg), dm = (P0[2] + P1[2]) / 2;
        if (inD(dm, dLo, dHi)) strut(out, P0[0] - ctx.x0, P0[1], -P0[2], P1[0] - ctx.x0, P1[1], -P1[2], Math.max(0.04, 0.0007 * dm), CABLE, 1, 1, KIND.WIRE);
        P0 = P1;
      }
      if (out.due()) yield;
    }
    // chairs every 19 m of cable, those coming down half a step out of phase
    const SP = 19;
    let i = 0;
    for (let c = sg > 0 ? 8 : 8 + SP / 2; c < G.len - 6; c += SP) {
      while (i + 2 < pts.length && pts[i + 1].s <= c) i++;
      if (Math.min(c - pts[i].s, pts[i + 1].s - c) < 2.4) continue;   // not on a tower's sheaves
      const C0 = cableAt(G, i, (c - pts[i].s) / (pts[i + 1].s - pts[i].s), sg);
      if (!inD(C0[2], dLo, dHi) || !inX(ctx, C0[0], 4)) continue;
      liftChair(out, C0[0] - ctx.x0, C0[1], C0[2], G, sg, hashInts(s.seed, 71, Math.round(c * 2), sg + 1) & 1023);
      if (out.due()) yield;
    }
  }
  // skiers on the piste: swinging down in arcs, some standing at the edge
  const ns = 10 + Math.floor(r() * 8);
  for (let i = 0; i < ns; i++) {
    const d = s.ld0 + (s.dc - 20 - s.ld0) * Math.pow(r(), 0.8);
    const t = clamp((d - s.ld0 + 20) / (s.dc - s.ld0), 0, 1);
    const pc = lerp(s.px + (s.lx0 - s.lx1) * 0.3, s.px, t);
    const wx = pc + (r() - 0.5) * s.pisteW * 0.7;
    const ci = Math.floor(r() * C.coat.length), turn = (r() - 0.5) * 1.4, stand = r() < 0.2;
    if (!inD(d, dLo, dHi) || !inX(ctx, wx, 3)) continue;
    yield* person(ctx, out, wx, W.H(wx, d), d, { yaw: -Math.PI / 2 + turn, coat: C.coat[ci], coatI: ci, pose: stand ? 'stand' : 'ski', scarf: null, skiC: C.coat[(ci + 3) % 7] });
  }
  // the piste's edge: a line of firs down each side (they also frame it from afar)
  if (plan) {
    for (let d = s.ld0; d < s.dc; d += 9) {
      const t = clamp((d - s.ld0 + 20) / (s.dc - s.ld0), 0, 1);
      const pc = lerp(s.px + (s.lx0 - s.lx1) * 0.3, s.px, t), hw = s.pisteW * (0.7 + 0.5 * (1 - t)) * 0.5;
      for (const sg of [-1, 1]) {
        const tr = makeRng(hashInts(s.seed, 81, Math.round(d), sg));
        const wx = pc + sg * (hw + 3 + 4 * tr()), dd = d + (tr() - 0.5) * 6;
        if (!inD(dd, dLo, dHi) || !inX(ctx, wx, 8) || onLiftLine(W, s, wx, dd)) continue;
        plan.push(planTree(ctx, out, wx, dd, tr, { H: 13, birch: 0.1, y: W.H(wx, dd) - 0.15 }));
      }
    }
  }
}

// Deer or elk at the edge of a forest: a small group grazing on the snow in front of the trees.
const DCELL = 700;
function deerGroup(W, i) {
  return cache(W, ST.DEER, i, () => {
    const r = makeRng(hashInts(W.ws, 561, i));
    if (r() > 0.5) return null;
    const wx = (i + 0.2 + 0.6 * r()) * DCELL;
    // walk out from the line until the forest begins, and stand a little in front of it
    let d = 0;
    for (let dd = 50; dd < 170; dd += 4) { if (surface(W, wx, dd).t === T.FOREST) { d = dd; break; } }
    if (!d) return null;
    const dc = d - 6 - 10 * r();
    const s = surface(W, wx, dc);
    if (s.t !== T.SNOW) return null;
    const type = r() < 0.25 ? 'elk' : r() < 0.4 ? 'reindeer' : 'deer';
    return { i, wx, d: dc, type, n: type === 'elk' ? 1 + Math.floor(r() * 2) : 3 + Math.floor(r() * 5), seed: hashInts(W.ws, 562, i) };
  });
}
function* deer(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 40) / DCELL), i1 = Math.floor((ctx.x0 + ctx.length + 40) / DCELL);
  for (let i = i0; i <= i1; i++) {
    const g = deerGroup(W, i);
    if (!g) continue;
    const r = makeRng(g.seed), cols = ANIMAL_COL[g.type];
    for (let k = 0; k < g.n; k++) {
      const wx = g.wx + (r() - 0.5) * 9 * Math.sqrt(g.n), d = g.d + (r() - 0.5) * 7;
      const yaw = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 1.2, graze = r() < 0.5, ant = r() < (g.type === 'deer' ? 0.35 : 0.7), col = cols[Math.floor(r() * cols.length)];
      if (!inD(d, dLo, dHi) || !inX(ctx, wx, 3)) continue;
      const y = W.H(wx, d) - 0.05;
      yield* beast(ctx, out, wx, y, d, { type: g.type, yaw, col, graze, antlers: ant, ph: r() });
      shadowStripe(out, W, ctx, wx + 0.5, d, 5, 1.1, 0.3);
    }
  }
}

// A reindeer herd crossing open snow: fifteen to thirty-five animals strung out along the way they
// are going (the train's way or against it, the whole herd alike), most walking, some stopped to
// dig for lichen, calves among them, the antlers a thicket against the white.
const RHCELL = 1500;
function reindeerHerd(W, i) {
  return cache(W, ST.HERD, i, () => {
    const r = makeRng(hashInts(W.ws, 565, i));
    if (r() > 0.6) return null;
    const wx = (i + 0.15 + 0.7 * r()) * RHCELL, d = 58 + 70 * r();
    if (surface(W, wx, d).t !== T.SNOW) return null;
    const n = 15 + Math.floor(r() * 21), dir = r() < 0.5 ? 0 : Math.PI, len = 26 + 1.6 * n, slant = (r() - 0.5) * 0.5;
    const list = [];
    for (let k = 0; k < n; k++) {
      // a long, loose column, densest at the front
      const u = Math.pow(r(), 1.4) - 0.35, v = (r() - 0.5) * (9 + 0.25 * n) * (1 - 0.5 * Math.abs(u));
      const ax = wx + (dir ? -1 : 1) * u * len, ad = d + v + slant * u * len;
      const calf = r() < 0.2;
      list.push({ wx: ax, d: ad, yaw: dir + (r() - 0.5) * 0.5, k: FIG * (calf ? 0.62 : 0.9 + 0.2 * r()), graze: r() < 0.3, ant: !calf && r() < 0.85, col: Math.floor(r() * 3), ph: r() });
    }
    return { i, wx, d, n, list };
  });
}
function* herds(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 120) / RHCELL), i1 = Math.floor((ctx.x0 + ctx.length + 120) / RHCELL);
  for (let i = i0; i <= i1; i++) {
    const g = reindeerHerd(W, i);
    if (!g) continue;
    for (const a of g.list) {
      if (!inD(a.d, dLo, dHi) || !inX(ctx, a.wx, 3)) continue;
      if (surface(W, a.wx, a.d).t !== T.SNOW) continue;       // not on the ice, the lane or in the trees
      yield* beast(ctx, out, a.wx, W.H(a.wx, a.d) - 0.05, a.d, { type: 'reindeer', yaw: a.yaw, k: a.k, col: ANIMAL_COL.reindeer[a.col], graze: a.graze, antlers: a.ant, walk: !a.graze, ph: a.ph });
      shadowStripe(out, W, ctx, a.wx + 0.5, a.d, 5, 1.1, 0.3);
    }
  }
}

// Sleighs on the lane (where there is one).
const SLCELL = 800;
function* sleighs(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, SLCELL, 20)) {
    const r = worldRng(ctx, 571, i);
    if (r() > 0.55) continue;
    const wx = wx0 + 0.1 * SLCELL + 0.8 * SLCELL * r();
    if (!laneOn(W, wx) || !inX(ctx, wx, 14)) continue;
    const d = laneD(W, wx) + (r() - 0.5) * 0.8;
    if (!inD(d, dLo, dHi)) continue;
    yield* sleigh(ctx, out, W, wx, d, r);
  }
}

// The lane's furniture: snow poles with red tips along its far side, now and then a mailbox.
function* laneProps(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, 25, 1)) {
    if (!laneOn(W, wx0)) continue;
    const d = laneD(W, wx0) + 3.4;
    if (!inD(d, dLo, dHi) || !inX(ctx, wx0, 0)) continue;
    const y = W.H(wx0, d), x = wx0 - ctx.x0;
    const pr = Math.max(0.035, thin(d, 0.9));
    bar(out, x, y - 0.1, -d, x, y + 1.3, -d, pr, [0.2, 0.18, 0.16], 2, KIND.FENCE);
    bar(out, x, y + 1.3, -d, x, y + 1.75, -d, pr, [0.75, 0.12, 0.08], 1, KIND.FENCE);
    if (out.due()) yield;
    void i;
  }
}

// A wooden bridge carrying the lane over a frozen brook: a plank deck with snow on it, posts and
// rails both sides (snow along the top rails), the brook's banks under it.
function* bridges(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 30) / BCELL), i1 = Math.floor((ctx.x0 + ctx.length + 30) / BCELL);
  for (let i = i0; i <= i1; i++) {
    const b = brook(W, i);
    if (!b) continue;
    const r = makeRng(b.seed);
    // reeds along the banks
    for (let d = Math.max(dLo, 22); d < Math.min(dHi, b.dEnd); d += 3 + 4 * r()) {
      if (r() < 0.5) continue;
      const sg = r() < 0.5 ? -1 : 1, wx = brookX(b, d) + sg * (b.w * 0.5 + 0.8);
      if (inX(ctx, wx, 0)) yield* reeds(ctx, out, W, wx, d, r);
    }
    if (!laneOn(W, b.x0)) continue;
    const ld = laneD(W, b.x0), bx = brookX(b, ld);
    if (!inX(ctx, bx, 12)) continue;
    for (const rail of [-1, 1]) {
      const rd = ld + rail * 2.2;
      if (!inD(rd, dLo, dHi)) continue;
      const span = b.w + 5, y0 = W.H(bx - span / 2, ld) + 0.25, y1 = W.H(bx + span / 2, ld) + 0.25;
      const wc = [0.34, 0.24, 0.15], sc = snowTone(0, 1, 0.3);
      // deck (drawn with the near rail)
      if (rail < 0) {
        for (let u = -span / 2; u < span / 2; u += 0.5) {
          const x = bx + u - ctx.x0, yy = lerp(y0, y1, (u + span / 2) / span) + 0.35 * Math.cos(u / span * Math.PI);
          out(x, yy, -ld, 0.3, 0.12, 2.3, wc[0] * 0.8, wc[1] * 0.8, wc[2] * 0.8, 1, 0, 0, 0, 1, KIND.OTHER);
          out(x, yy + 0.12, -ld, 0.3, 0.06, 2.0, sc[0], sc[1], sc[2], 1, 0, 0, 0, 1, KIND.OTHER);
          out(x, yy - 0.12, -(ld - 2.25), 0.3, 0.2, 0.06, wc[0] * 0.7, wc[1] * 0.7, wc[2] * 0.7, 1, 0, 0, 0, 1, KIND.OTHER);
        }
      }
      let prev = null;
      for (let u = -span / 2; u <= span / 2 + 0.01; u += span / 4) {
        const x = bx + u - ctx.x0, yy = lerp(y0, y1, (u + span / 2) / span) + 0.35 * Math.cos(u / span * Math.PI);
        const pr = Math.max(0.07, thin(rd, 1.3));
        bar(out, x, yy - 0.8, -rd, x, yy + 1.1, -rd, pr, wc, 2, KIND.FENCE);
        if (prev) {
          bar(out, prev[0], prev[1] + 1.0, -rd, x, yy + 1.0, -rd, pr * 0.85, wc, 3, KIND.FENCE);
          bar(out, prev[0], prev[1] + 0.5, -rd, x, yy + 0.5, -rd, pr * 0.7, wc, 3, KIND.FENCE);
          bar(out, prev[0], prev[1] + 1.1, -rd, x, yy + 1.1, -rd, pr * 0.8, sc, 3, KIND.FENCE);
        }
        prev = [x, yy];
      }
    }
    if (out.due()) yield;
  }
}
// A clump of reeds: pale, thin stalks with a cap of snow here and there.
function* reeds(ctx, out, W, wx, d, r) {
  const y = W.H(wx, d), x = wx - ctx.x0;
  const n = 6 + Math.floor(r() * 6), rr = Math.max(0.025, thin(d, 0.6));
  for (let i = 0; i < n; i++) {
    const ox = (r() - 0.5) * 1.2, od = (r() - 0.5) * 0.8, h = 1.2 + 1.0 * r(), lx = (r() - 0.5) * 0.4;
    const c = mul3(C.reed, 0.8 + 0.3 * r());
    bar(out, x + ox, y, -(d + od), x + ox + lx, y + h, -(d + od), rr, c, 2, KIND.HEDGE);
    if (r() < 0.4) out(x + ox + lx, y + h, -(d + od), rr * 2, 0.12, rr * 2, 0.42, 0.32, 0.2, 1, 0, 0, 0, 1, KIND.HEDGE);
  }
  if (out.due()) yield;
}
// Reeds along the near shores of the lakes and the river.
function* shoreReeds(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, 9, 0)) {
    const r = worldRng(ctx, 581, i);
    if (r() > 0.45) continue;
    const wx = wx0 + 9 * r();
    const rn = riverN(W, wx);
    let d = -1;
    if (rn < 1400 && r() < 0.6) d = rn - 3 - 4 * r();
    else for (const lk of lakesNear(W, wx)) {
      // the near shore of the lake at this x
      const u = (wx - lk.cx) / lk.rx;
      if (Math.abs(u) < 0.9) { d = lk.dc - lk.rd * Math.sqrt(1 - u * u) * 0.95 - 2 * r(); break; }
    }
    if (d < 0 || !inD(d, dLo, dHi)) continue;
    yield* reeds(ctx, out, W, wx, d, r);
  }
}

// Frosted hedgerows along some of the field boundaries parallel to the line: dark, twiggy, white on
// top; a drift lying in their lee.
const HROWS = [];
for (let D = 95, k = 0; D < 300; k++) { HROWS.push(D); D += 45 + 40 * ((k * 0.618) % 1); }
function* hedges(ctx, out, W, dLo, dHi) {
  for (let k = 0; k < HROWS.length; k++) {
    const D0 = HROWS[k];
    if (!inD(D0, dLo, dHi)) continue;
    const st = Math.max(0.3, detail(out, D0, 0.9));
    const r = ctx.rng;
    for (let x = st / 2; x < ctx.length; x += st) {
      const wx = ctx.x0 + x;
      if (noise1(wx / 340, W.ws + 590 + k) < 0.66) continue;
      const d = D0 + 6 * (noise1(wx / 200, W.ws + 600 + k) - 0.5);
      if (laneOn(W, wx) && Math.abs(d - laneD(W, wx)) < 10) continue;
      const B = binAt(W, wx);
      if (B.ski || B.sled || B.pond || B.villages.length) continue;
      const s = surface(W, wx, d);
      if (s.t !== T.SNOW) continue;
      const h = 0.8 + 0.9 * noise1(wx / 9, W.ws + 610 + k);
      // twiggy strokes, mostly upright, frosted at the top
      for (let j = 0; j < 3; j++) {
        const v = (j + r()) / 3;
        const top = v > 0.75;
        const c = top ? snowTone(-0.2, 0.9, 0.35, 0.95) : jitter(mul3(C.hedge, 0.75 + 0.4 * v), r, 0.15);
        const q = quatXTo((r() - 0.5) * 0.6, 1, (r() - 0.5) * 0.4);
        out(x + (r() - 0.5) * st, s.y + h * v * 0.85 + 0.1, -(d + (r() - 0.5) * 0.6), top ? Math.max(0.15, st * 0.5) : h * 0.3, top ? 0.1 : Math.max(0.06, st * 0.3), top ? Math.max(0.15, st * 0.5) : Math.max(0.06, st * 0.3), c[0], c[1], c[2], top ? 1 : 0.85, top ? 0 : q[0], top ? 0 : q[1], top ? 0 : q[2], top ? 1 : q[3], KIND.HEDGE);
      }
      if (out.due()) yield;
    }
  }
}

// Falling snow: round splats scattered evenly through the 16 m slab of air (3.4 m below rail level
// to 12.6 m above), each at its own distance. How much falls varies by stretch (a world-x noise per
// flake): none, a few big slow flakes, or steady snow.
function snowAmt(W, wx) {
  const v = noise1(wx / 2600, W.ws + 991);
  return v < 0.38 ? 0 : v < 0.6 ? 1 : 2;
}
function* snowfall(ctx, out0, W, dLo, dHi, per) {
  const out = moveOut(out0, MOVE.FALL);
  const rng = ctx.rng;
  const n = Math.round(per * ctx.count);
  for (let i = 0; i < n; i++) {
    const x = rng() * ctx.length, wx = ctx.x0 + x;
    const d = dLo + (dHi - dLo) * rng(), y = -3.4 + 16 * rng(), u = rng();
    const amt = snowAmt(W, wx);
    if (amt === 0) continue;
    if (amt === 1 && u > 0.22) continue;
    const big = amt === 1;
    const rr = big ? Math.max(0.026, 0.0009 * d) : Math.max(0.013, 0.0006 * d);
    const c = 0.72 + 0.08 * u;
    out(x, y, -d, rr, rr, rr, c, c, Math.min(0.8, c + 0.03), big ? 0.95 : 0.85, 0, 0, 0, 1, KIND.OTHER);
    if (out0.due()) yield;
  }
}

// The telegraph line along the railway: wooden poles every beat, a cross-arm with white insulators
// carrying three wires, snow along the arm.
function* telegraph(ctx, out, W, D) {
  const beat = ctx.beatMetres || 56;
  const first = Math.ceil(ctx.x0 / beat), last = Math.floor((ctx.x0 + ctx.length) / beat);
  const pc = [0.26, 0.2, 0.15], sc = snowTone(0, 1, 0.3);
  const top = 7.2;
  for (let k = first; k <= last; k++) {
    const x = k * beat - ctx.x0;
    const y0 = W.H(k * beat, D) - 0.3;
    bar(out, x, y0, -D, x, y0 + top + 0.4, -D, 0.11, pc, 10, KIND.MAST);
    bar(out, x - 0.9, y0 + top, -D, x + 0.9, y0 + top, -D, 0.07, pc, 3, KIND.MAST);
    out(x, y0 + top + 0.1, -D, 0.9, 0.05, 0.08, sc[0], sc[1], sc[2], 1, 0, 0, 0, 1, KIND.MAST);
    for (const u of [-0.75, 0, 0.75]) out(x + u, y0 + top + (u === 0 ? 0.45 : 0.12), -D, 0.05, 0.09, 0.05, 0.75, 0.74, 0.7, 1, 0, 0, 0, 1, KIND.MAST);
    if (out.due()) yield;
  }
  // the wires, sagging between the poles (phase 0 at world x = 0, so they meet across chunks)
  const step = 0.4;
  for (const [u, dy] of [[-0.75, 0.2], [0, 0.53], [0.75, 0.2]]) {
    for (let x = step / 2; x < ctx.length; x += step) {
      const wx = ctx.x0 + x;
      const f = wx / beat - Math.floor(wx / beat);
      const ka = Math.floor(wx / beat) * beat, kb = ka + beat;
      const ya = W.H(ka, D) - 0.3, yb = W.H(kb, D) - 0.3;
      const y = lerp(ya, yb, f) + top + dy - 0.8 * 4 * f * (1 - f);
      const sl = (yb - ya) / beat - 0.8 * 4 * (1 - 2 * f) / beat;
      const q = quatRoll(Math.atan(sl));
      out(x + u * 0, y, -(D + u * 0.02), step * 0.65, 0.014, 0.014, 0.12, 0.12, 0.12, 1, q[0], q[1], q[2], q[3], KIND.WIRE);
      if (out.due()) yield;
    }
  }
}

// The halt: a low platform with snow on it, lamps on posts beyond 6 m (lit, with their pools), a
// small wooden shelter with a lit window, a nameboard.
function* haltProps(ctx, out, W) {
  const i0 = Math.floor((ctx.x0 - 200) / HCELL), i1 = Math.floor((ctx.x0 + ctx.length) / HCELL);
  const dk = darkness(ctx);
  for (let i = i0; i <= i1; i++) {
    const h = halt(W, i);
    if (!h) continue;
    const a = Math.max(0, h.x0 - ctx.x0), b = Math.min(ctx.length, h.x0 + h.len - ctx.x0);
    if (b > a) {
      const st = 0.4;
      for (let x = a + st / 2; x < b; x += st) {
        out(x, 0.3, -2.75, st * 0.7, 0.3, 0.1, 0.42, 0.41, 0.4, 1, 0, 0, 0, 1, KIND.OTHER);
        for (let d = 2.9; d < 6.4; d += 0.45) {
          const c = d < 3.4 ? [0.7, 0.6, 0.2] : jitter(mix3(C.snowMid, C.snowLit, 0.5), ctx.rng, 0.03);
          out(x, 0.6, -d, st * 0.7, 0.05, 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
        }
        if (out.due()) yield;
      }
      for (let wx = Math.ceil(h.x0 / 18) * 18; wx < h.x0 + h.len; wx += 18) {
        const x = wx - ctx.x0;
        if (x < 0 || x >= ctx.length) continue;
        bar(out, x, 0.6, -6.5, x, 4.4, -6.5, 0.07, [0.16, 0.16, 0.17], 5, KIND.MAST);
        bar(out, x, 4.4, -6.5, x, 4.4, -6.1, 0.05, [0.16, 0.16, 0.17], 1, KIND.MAST);
        glow(out, x, 4.25, 6.15, LAMP, 0.1, 0.2, 4, MOVE.CHASE);
        if (dk > 0.2) { pool(out, x, 0.62, 4.6, 3.5, 1.6, LAMP, 0.18 * dk, MOVE.CHASE); pool(out, x, W.H(wx, 8.5), 8.5, 4, 2.2, LAMP, 0.12 * dk, MOVE.CHASE); }
      }
    }
    // shelter and nameboard (beyond 6 m)
    const sx = h.x0 + h.len * 0.55;
    if (inX(ctx, sx, 12)) {
      const hs = { wx: sx, d: 9.5, w: 5, dep: 3.4, h: 2.6, pitch: 0.55, yaw: 0, wall: 'red', smoke: false, seed: hashInts(h.seed, 3) };
      yield* building(ctx, out, W, hs, { s: 0.12 });
      const nx = h.x0 + h.len * 0.25 - ctx.x0;
      if (nx > -3 && nx < ctx.length + 3) {
        for (const u of [-1.3, 1.3]) bar(out, nx + u, 0.4, -6.6, nx + u, 2.6, -6.6, 0.06, [0.16, 0.16, 0.17], 2, KIND.MAST);
        out(nx, 2.35, -6.65, 1.6, 0.32, 0.05, 0.12, 0.2, 0.42, 1, 0, 0, 0, 1, KIND.OTHER);
        out(nx, 2.35, -6.6, 1.25, 0.08, 0.04, 0.78, 0.78, 0.76, 1, 0, 0, 0, 1, KIND.OTHER);
        const sc = snowTone(0, 1, 0.3);
        out(nx, 2.72, -6.65, 1.6, 0.06, 0.08, sc[0], sc[1], sc[2], 1, 0, 0, 0, 1, KIND.OTHER);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Site loops shared by the bands (each draws what falls in its own distance range)
// ---------------------------------------------------------------------------------------------
function* ponds(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 60) / PCELL), i1 = Math.floor((ctx.x0 + ctx.length + 60) / PCELL);
  for (let i = i0; i <= i1; i++) { const p = pond(W, i); if (p && inX(ctx, p.cx, p.rx * 1.3)) yield* pondProps(ctx, out, W, p, dLo, dHi); }
}
function* sledHills(ctx, out, W, dLo, dHi) {
  const i0 = Math.floor((ctx.x0 - 120) / SHCELL), i1 = Math.floor((ctx.x0 + ctx.length + 120) / SHCELL);
  for (let i = i0; i <= i1; i++) { const s = sledHill(W, i); if (s && inX(ctx, s.cx, s.rx)) yield* sledProps(ctx, out, W, s, dLo, dHi); }
}
function* skiHills(ctx, out, W, dLo, dHi, plan) {
  const i0 = Math.floor((ctx.x0 - 400) / KCELL), i1 = Math.floor((ctx.x0 + ctx.length + 400) / KCELL);
  for (let i = i0; i <= i1; i++) { const s = skiHill(W, i); if (s && inX(ctx, s.cx, s.rx)) yield* skiProps(ctx, out, W, s, dLo, dHi, plan); }
}

// ---------------------------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------------------------
function* trackside(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 1, detailK: 1.2 });
  out.limit = ctx.count * 0.5;
  yield* telegraph(ctx, out, W, 8.6);
  yield* haltProps(ctx, out, W);
  // a slatted snow fence in stretches, with the drift it gathers
  if (noise1(ctx.x0 / 1500, W.ws + 1201) > 0.7) yield* snowFence(ctx, out, W, 12.5);
  // young firs and birches near the line, in stretches (they streak past)
  const plan = [];
  for (const { i, wx0 } of cellsAround(ctx, 3, 3)) {
    const dense = smooth(0.45, 0.75, noise1(wx0 / 300, W.ws + 1202));
    const r = worldRng(ctx, 1203, i);
    if (r() > 0.04 + 0.55 * dense) continue;
    const wx = wx0 + 3 * r(), d = 11 + Math.pow(r(), 1.2) * 18;
    const s = surface(W, wx, d);
    if (s.t !== T.SNOW && s.t !== T.FOREST) continue;
    const H = 1.5 + Math.min(6, (d - 9) * 0.35 * (0.4 + r()));
    plan.push(planTree(ctx, out, wx, d, r, { H, birch: 0.3, y: s.y - 0.1 }));
  }
  yield* sleighs(ctx, out, W, 20, ctx.zFar);
  yield* farms(ctx, out, W, ctx.zNear, ctx.zFar, { small: true });
  yield* drawPlan(ctx, out, plan, Math.max(0, out.limit - out.n));
  yield* snowfall(ctx, out, W, 6, ctx.zFar, 0.035);
  out.limit = Infinity;
  const rest = out.left();
  // ballast dusted with snow, the plough's bank, then the snowfield
  yield* fillStrip(ctx, out, W, Math.round(rest * 0.06), 2.5, 3.9, (wx, d, rng) => (rng() < 0.35 ? jitter(C.snowMid, rng, 0.06) : jitter(C.ballast, rng, 0.25)), 0, 0.12);
  yield* fillSurface(ctx, out, W, { dNear: 3.9, power: 1.2, cover: 5, tuft: 20 });
}
// A slatted snow fence at distance D: posts, rails and close vertical slats, a drift behind it.
function* snowFence(ctx, out, W, D) {
  const pc = [0.3, 0.22, 0.15];
  for (const { x } of cellsAround(ctx, 2.4, 0)) {
    if (x < 0 || x >= ctx.length) continue;
    // (never in front of the things worth seeing)
    const B = binAt(W, ctx.x0 + x);
    if (B.pond || B.sled || B.ski || B.villages.length || farm(W, Math.floor((ctx.x0 + x) / FCELL))) continue;
    const y = W.H(ctx.x0 + x, D);
    // (low: it must not hide the things 40-100 m out)
    bar(out, x, y - 0.2, -D, x, y + 1.25, -D, 0.07, pc, 2, KIND.FENCE);
    for (let s = 0.4; s < 2.4; s += 0.4) {
      const sx = x + s;
      if (sx >= ctx.length) break;
      const sy = W.H(ctx.x0 + sx, D);
      out(sx, sy + 0.6, -D, 0.05, 0.45, 0.02, pc[0] * 1.15, pc[1] * 1.15, pc[2] * 1.15, 1, 0, 0, 0, 1, KIND.FENCE);
    }
    const sc = snowTone(0, 0.9, 0.4);
    out(x + 1.2, y + 0.2, -(D + 1.2), 1.4, 0.35, 1.6, sc[0], sc[1], sc[2], 1, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
}

function* near(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.1 });
  const dz = ctx.dials || {};
  const lo = ctx.zNear, hi = ctx.zFar;
  out.limit = ctx.count * 0.62;
  const plan = [];
  yield* farms(ctx, out, W, lo, hi, { small: true, lift: dz.topology || 0 });
  yield* villages(ctx, out, W, lo, hi, { small: true, plan });
  yield* ponds(ctx, out, W, lo, hi);
  yield* sledHills(ctx, out, W, lo, hi);
  yield* skiHills(ctx, out, W, lo, hi, plan);
  yield* deer(ctx, out, W, lo, hi);
  yield* herds(ctx, out, W, lo, hi);
  yield* sleighs(ctx, out, W, lo, hi);
  yield* laneProps(ctx, out, W, lo, hi);
  yield* bridges(ctx, out, W, lo, hi);
  yield* shoreReeds(ctx, out, W, lo, hi);
  yield* hedges(ctx, out, W, lo, hi);
  if ((dz.scale || 0) > 0) {
    yield* giantFirs(ctx, out, W, 90, hi, 700, dz.scale);
    // the flakes are few (a few hundred splats each) and hang where nothing else is: they are
    // drawn whatever the props have used, so a busy village chunk at a low count keeps them
    const lim = out.limit;
    out.limit = Infinity;
    yield* bigFlakes(ctx, out, W, 60, hi, 260, dz.scale);
    out.limit = lim;
  }
  if ((dz.logic || 0) > 0) yield* repeatingSpire(ctx, out, W, lo, hi, dz.logic);
  if ((dz.topology || 0) > 0) yield* skyHerd(ctx, out, W, lo, hi, dz.topology);
  yield* snowfall(ctx, out, W, lo, hi, 0.022);
  fieldTrees(ctx, out, W, plan, lo + 5, hi, 70);
  forestPlan(ctx, out, W, plan, lo, hi, 5.5, { inner: 0.3 });
  yield* drawPlan(ctx, out, plan, Math.max(0, out.limit - out.n));
  // the face of a ski hill turned toward the line shows far more of itself than level ground: an
  // extra cover of snow over it, so the forest behind never shows through
  for (const { i } of cellsAround(ctx, KCELL, KCELL)) {
    const sk = skiHill(W, i);
    if (!sk) continue;
    const a = clamp(sk.cx - sk.rx * 1.3 - ctx.x0, 0, ctx.length), b = clamp(sk.cx + sk.rx * 1.3 - ctx.x0, 0, ctx.length);
    if (b - a < 1) continue;
    out.limit = Infinity;
    yield* fillSurface(ctx, out, W, { n: Math.round(0.14 * ctx.count * (b - a) / ctx.length), dNear: 120, dFar: hi, x0: a, x1: b, power: 1.0, cover: 3, mass: true });
  }
  yield* fillSurface(ctx, out, W, { power: 1.5, cover: 3.2, mass: true });
}

function* mid(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.6 });
  const dz = ctx.dials || {};
  const lo = ctx.zNear, hi = ctx.zFar;
  out.limit = ctx.count * 0.55;
  const plan = [];
  yield* villages(ctx, out, W, lo, hi, { coarse: 1.3, plan });
  yield* farms(ctx, out, W, lo, hi, { lift: dz.topology || 0 });
  yield* skiHills(ctx, out, W, lo, hi, plan);
  if ((dz.scale || 0) > 0) yield* giantFirs(ctx, out, W, lo, 1800, 1500, dz.scale);
  if ((dz.logic || 0) > 0) yield* repeatingSpire(ctx, out, W, lo, hi, dz.logic);
  if ((dz.topology || 0) > 0) yield* skyHerd(ctx, out, W, lo, hi, dz.topology);
  forestPlan(ctx, out, W, plan, lo, 1200, 11, { inner: 0.15, detail: 0.6 });
  for (const t of plan) t.nMax = Math.min(t.nMax, 6);
  yield* drawPlan(ctx, out, plan, Math.max(0, out.limit - out.n));
  yield* fillSurface(ctx, out, W, { power: 1.2, cover: 3, maxR: 0.05, mass: true });
}

// ---------------------------------------------------------------------------------------------
// Level 1
// ---------------------------------------------------------------------------------------------
// Scale: firs as tall as towers among the ordinary ones.
function* giantFirs(ctx, out, W, dLo, dHi, cell, amount) {
  for (const { i, wx0 } of cellsAround(ctx, cell, 80)) {
    const r = worldRng(ctx, 1301, i, cell);
    if (r() > 0.6 * amount) continue;
    const wx = wx0 + r() * cell, d = dLo + r() * (dHi - dLo);
    const s = surface(W, wx, d);
    if (s.t === T.ICE || s.t === T.POND || s.t === T.LANE) continue;
    const H = (d * 0.22 + 55) * (1 + 1.2 * r()) * amount;
    yield* fir(ctx, out, wx - ctx.x0, d, { rng: r, height: H, width: H * 0.3, y: s.y - 1, n: Math.round(clamp(700 * Math.sqrt(out.density) * (200 / d), 60, 1400)), kind: KIND.SURREAL });
  }
}
// Scale: enormous snowflakes hanging still in the air, drawn like a crystal and not a lantern: crisp
// thin arms (struts sized from the flake and its distance) with clear side branches, a small
// hexagonal plate at the heart, and no halo (a halo is what made them read as floating lights).
//   designs   stellar dendrite (branches that shorten toward the tip, twigs on the longest),
//             sectored plate (a hexagon with ridges, an inner hexagon and short branched tips),
//             fern (many short branches close together), simple star (a plate and bare arms
//             ending in small spades)
//   pose      each flake hangs in a plane facing the track, turned only a little (yaw and tilt up
//             to about 15 degrees). A plane parallel to the window keeps its true shape in the
//             frame wherever along the pass it stands, so the star does not thin or squash from
//             the left of the frame to the right; crossed planes would show as bars seen edge on.
//   light     by day pale blue-white ice (natural colour, under the light threshold) with a darker
//             blue rim just behind each line, so it reads on the sky and on snowy hills alike, and
//             only a pin of light at the heart. From the first hint of evening the arms are a
//             cool, not-quite-white light (only the blue channel at the threshold), so the shape
//             still shows as lines and not as one bright blur; the heart is a small white light.
//   motion    every splat is MOVE.SOLID: the dreamlike "matter" scatter would otherwise shake a
//             tilted flake into specks (its splats sit at different distances). The light ones
//             still swell a little on the beat, as every light does.
//   sizes     most 80 to 150 px across on a 1080p screen (7 to 39 m across, 60 to 300 m out), one
//             in seven a giant 70 to 110 m out, 230 to 350 px (up to a third of the window's
//             height); about 2 a kilometre at the dreamlike level.
const FLAKE_DESIGNS = ['dendrite', 'plate', 'fern', 'star'];
function* bigFlakes(ctx, out0, W, dLo, dHi, cell, amount) {
  const out = moveOut(out0, MOVE.SOLID);
  // lit from the first hint of evening (about 15.7 h): the clock runs on at the dreamlike level
  // (hours in a chunk's life), and ice built by day would go dark after nightfall
  const lit = darkness(ctx) > 0.05;
  // colours: arms, the heart plate's outline and fill, the heart's pin of light
  const armC = lit ? [0.6, 0.78, 0.98] : [0.74, 0.79, 0.8];
  const twigC = lit ? [0.52, 0.7, 0.97] : [0.68, 0.75, 0.79];
  const plateC = lit ? [0.4, 0.56, 0.97] : [0.55, 0.65, 0.76];
  const heartC = [0.9, 0.96, 1.0];
  const rimC = [0.26, 0.4, 0.62];
  const kArm = lit ? KIND.LIGHT : KIND.SURREAL;
  const tanTop = Math.tan(22 * Math.PI / 180);
  for (const { i, wx0 } of cellsAround(ctx, cell, 20)) {
    const r = worldRng(ctx, 1311, i);
    if (r() > 0.72 * amount) continue;
    const wx = wx0 + r() * cell;
    const giant = r() < 0.15;
    const d = giant ? 70 + 40 * r() : dLo + r() * (dHi - dLo);
    // sized by how big it looks: most 80 to 150 pixels across on a 1080p screen, a giant 230 to 350
    const R = d * (giant ? 0.1 + 0.05 * r() : 0.035 + 0.03 * Math.pow(r(), 1.5));
    // the centre 12 to 18 degrees above the eye (over most of the trees), the top tip inside the
    // frame, the bottom tip clear of the ground
    const e = Math.tan((12 + 6 * r()) * Math.PI / 180);
    const y = Math.max(2.6 + d * Math.min(e, tanTop - R / d), W.H(wx, d) + R + 4);
    const design = FLAKE_DESIGNS[Math.floor(r() * 4)];
    const yaw = (r() - 0.5) * 0.5, tilt = (r() - 0.5) * 0.5, spin = r() * Math.PI / 3;
    if (!inX(ctx, wx, R)) continue;   // every chunk it reaches draws its own part (out drops the rest)
    if (globalThis.__winterFlakes) globalThis.__winterFlakes.push({ wx: Math.round(wx), d: Math.round(d), y: Math.round(y), R: +R.toFixed(1), design, top: +((y + R - 2.6) / d).toFixed(3) });
    const x = wx - ctx.x0;
    // the flake's plane: e1 across, e2 up (yaw about the vertical, then tilt about e1)
    const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
    const e1x = cy, e1z = -sy, e2x = st * sy, e2y = ct, e2z = st * cy;
    const P = (u, v) => [x + u * e1x + v * e2x, y + v * e2y, -d + u * e1z + v * e2z];
    const w = Math.max(R * 0.02, thin(d, 1.0));          // half-thickness of an arm
    const pieces = (len) => Math.max(1, Math.ceil(len / (R * 0.1)));
    // the plane's normal (toward the track) and, at every hour, a darker blue rim just behind each
    // line, so the pale ice reads against snowy hills as well as against the sky
    const nx = -e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y;
    const back = w * 1.5;
    const S = (u0, v0, u1, v1, rr, c, kind = kArm, o = 1) => {
      const A = P(u0, v0), B = P(u1, v1), n = pieces(Math.hypot(u1 - u0, v1 - v0));
      bar(out, A[0] - nx * back, A[1] - ny * back, A[2] - nz * back, B[0] - nx * back, B[1] - ny * back, B[2] - nz * back, rr * 1.7, rimC, n, KIND.SURREAL, MOVE.SOLID, o * 0.85);
      bar(out, A[0], A[1], A[2], B[0], B[1], B[2], rr, c, n, kind, MOVE.SOLID, o);
    };
    const hex = (rad, rr, c, kind = kArm) => {
      for (let k = 0; k < 6; k++) {
        const a0 = spin + k * Math.PI / 3, a1 = a0 + Math.PI / 3;
        S(Math.cos(a0) * rad, Math.sin(a0) * rad, Math.cos(a1) * rad, Math.sin(a1) * rad, rr, c, kind);
      }
    };
    const B60 = Math.PI / 3;
    // the heart: a small hexagonal plate (a flat fill in the flake's plane, its rim a hexagon)
    const pr = R * (design === 'star' ? 0.22 : design === 'plate' ? 0.16 : 0.13);
    const c0 = P(0, 0);
    {
      const q = quatBasis(e1x, 0, e1z, e2x, e2y, e2z, nx, ny, nz);
      const fr = pr * 0.62, pk = lit ? KIND.LIGHT : KIND.SURREAL;
      out(c0[0], c0[1], c0[2], fr, fr, w * 0.5, plateC[0], plateC[1], plateC[2], lit ? 0.55 : 0.7, q[0], q[1], q[2], q[3], pk);
      for (let k = 0; k < 6; k++) {
        const a = spin + (k + 0.5) * B60, p = P(Math.cos(a) * pr * 0.5, Math.sin(a) * pr * 0.5);
        out(p[0], p[1], p[2], fr * 0.6, fr * 0.6, w * 0.5, plateC[0], plateC[1], plateC[2], lit ? 0.45 : 0.6, q[0], q[1], q[2], q[3], pk);
      }
    }
    hex(pr, w * 0.8, armC);
    L(out, c0[0], c0[1], -c0[2], Math.max(R * 0.028, thin(d, 1.3)), Math.max(R * 0.028, thin(d, 1.3)), w, heartC, 1, MOVE.SOLID);
    // the arms and their branches
    for (let k = 0; k < 6; k++) {
      const a = spin + k * B60;
      const ca = Math.cos(a), sa = Math.sin(a);
      const along = (t) => [ca * R * t, sa * R * t];
      const branch = (t, len, rr, c, twig = 0) => {
        for (const sg of [-1, 1]) {
          const [bu, bv] = along(t), b = a + sg * B60;
          const eu = bu + Math.cos(b) * len, ev = bv + Math.sin(b) * len;
          S(bu, bv, eu, ev, rr, c);
          if (twig > 0) {   // a twig off the middle of the branch, parallel to the arm
            const mu = bu + Math.cos(b) * len * 0.5, mv = bv + Math.sin(b) * len * 0.5;
            S(mu, mv, mu + ca * twig, mv + sa * twig, rr * 0.85, c);
          }
        }
      };
      if (design === 'dendrite') {
        const [tu, tv] = along(1);
        S(ca * pr, sa * pr, tu, tv, w, armC);
        branch(0.34, R * 0.3, w * 0.8, armC, R * 0.1);
        branch(0.52, R * 0.25, w * 0.8, armC, R * 0.07);
        branch(0.68, R * 0.17, w * 0.75, twigC);
        branch(0.82, R * 0.1, w * 0.7, twigC);
      } else if (design === 'fern') {
        const [tu, tv] = along(1);
        S(ca * pr, sa * pr, tu, tv, w, armC);
        for (let j = 0; j < 6; j++) {
          const t = 0.26 + j * 0.12;
          branch(t, R * (0.24 - 0.17 * (t - 0.26) / 0.6), w * 0.7, twigC);
        }
      } else if (design === 'plate') {
        // the plate: a hexagon whose corners lie on the arms, ridges from heart to corner, an
        // inner hexagon; past each corner a short tip with one pair of branches
        const hr = R * 0.58;
        const [cu, cv] = along(0.58), [tu, tv] = along(1);
        S(ca * pr, sa * pr, cu, cv, w * 0.9, armC);
        S(cu, cv, tu, tv, w, armC);
        const a1 = a + B60;
        S(cu, cv, Math.cos(a1) * hr, Math.sin(a1) * hr, w * 0.9, armC);
        const ir = R * 0.36;
        S(ca * ir, sa * ir, Math.cos(a1) * ir, Math.sin(a1) * ir, w * 0.6, twigC);
        branch(0.8, R * 0.13, w * 0.7, armC);
      } else {
        // simple star: bare arms from the plate, each ending in a small spade (a diamond)
        const [tu, tv] = along(0.86);
        S(ca * pr, sa * pr, tu, tv, w * 1.15, armC);
        const sp = R * 0.08;
        const pu = -sa, pv = ca;       // across the arm
        const m1 = along(0.86), m2 = along(1.0), mm = along(0.93);
        S(m1[0], m1[1], mm[0] + pu * sp, mm[1] + pv * sp, w * 0.8, armC);
        S(m1[0], m1[1], mm[0] - pu * sp, mm[1] - pv * sp, w * 0.8, armC);
        S(mm[0] + pu * sp, mm[1] + pv * sp, m2[0], m2[1], w * 0.8, armC);
        S(mm[0] - pu * sp, mm[1] - pv * sp, m2[0], m2[1], w * 0.8, armC);
        branch(0.55, R * 0.12, w * 0.75, twigC);
      }
    }
    if (out.due()) yield;
  }
}
// Topology: cabins floating a few metres above their own snow-holes.
function floatLift(W, f, amount) {
  const h = (hashInts(f.seed, 91) & 1023) / 1023;
  return h < 0.7 ? (8 + 10 * h) * amount : 0;
}
function* snowHole(ctx, out, W, hs) {
  const r = makeRng(hashInts(hs.seed, 93));
  const n = 40, R = Math.max(hs.w, hs.dep) * 0.62;
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, e = Math.sqrt(r());
    const wx = hs.wx + Math.cos(a) * R * e, d = hs.d + Math.sin(a) * R * 0.75 * e;
    const c = e < 0.75 ? mix3(C.snowDeep, [0.14, 0.17, 0.27], 0.5 * (1 - e)) : C.snowShade;
    out(wx - ctx.x0, W.H(wx, d) + 0.05 + (e > 0.8 ? 0.3 : 0), -d, R * 0.22, 0.06, R * 0.18, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.SURREAL);
  }
  if (out.due()) yield;
}
function* hangingIce(ctx, out, W, hs, lift) {
  // the clod of snow the cabin carried up with it, tapering below, and icicles hanging from it
  const r = makeRng(hashInts(hs.seed, 95));
  const y0 = W.H(hs.wx, hs.d) - 0.3 + lift, R = Math.max(hs.w, hs.dep) * 0.55;
  for (let i = 0; i < 70; i++) {
    const f = Math.pow(r(), 0.8), a = r() * Math.PI * 2, rr = R * (1 - f) * (0.8 + 0.3 * r());
    const wx = hs.wx + Math.cos(a) * rr, d = hs.d + Math.sin(a) * rr * 0.7;
    const c = snowTone(Math.cos(a) * 0.6, -0.4, Math.sin(a) * 0.6 + 0.3);
    out(wx - ctx.x0, y0 - f * R * 0.9, -d, R * 0.2, R * 0.16, R * 0.15, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.SURREAL);
  }
  for (let i = 0; i < 18; i++) {
    const a = r() * Math.PI * 2, rr = R * 0.8 * Math.sqrt(r());
    const wx = hs.wx + Math.cos(a) * rr, d = hs.d + Math.sin(a) * rr * 0.7, l = 0.6 + 1.6 * r();
    out(wx - ctx.x0, y0 - R * 0.3 - l * 0.5, -d, thin(d), l * 0.5, thin(d), ICE[0], ICE[1], ICE[2], 0.9, 0, 0, 0, 1, KIND.SURREAL);
  }
  if (out.due()) yield;
}
// Topology: a herd of reindeer walking through the air above the forest, in stretches.
function* skyHerd(ctx, out, W, dLo, dHi, amount) {
  const cell = 1100;
  for (const { i, wx0 } of cellsAround(ctx, cell, 60)) {
    const r = worldRng(ctx, 1321, i);
    if (r() > 0.55 * amount) continue;
    const d = 160 + 300 * r(), cx = wx0 + cell * r(), dir = r() < 0.5 ? 0 : Math.PI;
    const n = 6 + Math.floor(r() * 8), alt = 28 + 30 * r();
    const k = FIG * (1 + d / 200);
    for (let j = 0; j < n; j++) {
      const wx = cx + (j - n / 2) * 4.2 * k + (r() - 0.5) * 2 * k, dd = d + (r() - 0.5) * 8, yy = W.H(cx, d) + alt + 3 * Math.sin(j * 0.9) + (r() - 0.5) * 2;
      const ph = r(), col = ANIMAL_COL.reindeer[Math.floor(r() * 3)];
      if (!inD(dd, dLo, dHi) || !inX(ctx, wx, 4 * k)) continue;
      yield* beast(ctx, out, wx, yy, dd, { type: 'reindeer', yaw: dir + (r() - 0.5) * 0.2, k, col, antlers: true, walk: true, ph, kind: KIND.SURREAL });
    }
  }
}
// Logic: the village church's spire, repeated along the line on its own, each copy more wrong.
function* repeatingSpire(ctx, out, W, dLo, dHi, logic) {
  const Pc = 560;
  for (const { i, wx0 } of cellsAround(ctx, Pc, 30)) {
    if (noise1(wx0 / 4200, W.ws + 1331) > 0.3 + logic) continue;
    const wrong = ((((i % 5) + 5) % 5) / 4) * logic * 2.5;
    const d = 240 + 30 * Math.sin(i * 1.3);
    if (!inD(d, dLo, dHi)) continue;
    const wx = wx0 + Pc * 0.5;
    if (!inX(ctx, wx, 20)) continue;
    const ch = { wx, d, yaw: 0.1 * wrong, spire: 30, seed: hashInts(W.ws, 1332) };
    yield* church(ctx, out, W, ch, { noNave: true, kind: KIND.SURREAL, towerH: 17 + 6 * wrong, spireH: 30 * (1 + 0.6 * wrong) });
  }
}

// Far: the white range. Dark forest below a ragged tree line, then snow on everything, broken by
// rock ribs on the steep faces; gullies hold the snow, ribs cast blue shade. The far band adds a
// sculpted relief of its own above the forest, ramping in from zero so it meets the mid band.
function farRelief(W, wx, d, h, up) {
  const ramp = smooth(3600, 5000, d);
  if (ramp <= 0) return 0;
  const n1 = 1 - Math.abs(2 * fbm2(wx / 1700, d / 1400, W.ws + 691, 3) - 1);
  const n2 = 1 - Math.abs(2 * fbm2(wx / 520, d / 1700, W.ws + 692, 2) - 1);
  const n3 = noise2(wx / 170, d / 600, W.ws + 690);
  const alt = smooth(300, 1200, h);
  let e = (n1 * n1 * 320 + n2 * n2 * 210 + n3 * 50 - 210) * alt * ramp;
  if (up > 0) e += up * 3200 * Math.pow(n1, 8) * smooth(0.62, 0.85, noise1(wx / 7000, W.ws + 689)) * smooth(5500, 9000, d) * alt;
  return e;
}
function* far(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 600 });
  const dz = ctx.dials || {};
  const up = dz.scale || 0;
  out.limit = Infinity;
  const n = out.left();
  const rng = ctx.rng;
  const dn = ctx.zNear, df = ctx.zFar, Lx = ctx.length;
  const Z = Math.log(df / dn);
  // the range (terrain and its sculpted relief) tabulated per world and per level of the scale dial
  const Hs = W.far[up] || (W.far[up] = makeTable((wx, d) => { const h = W.H(wx, d); return h + farRelief(W, wx, d, h, up); }, 2400, 0.01, 0.008, 128));
  // most of the far ground hides behind the mid band's hills: spend the splats on what rises above
  const OX = 100, M = 800, occ = [];
  for (let wx = ctx.x0 - M; wx <= ctx.x0 + Lx + M; wx += OX) {
    let a = -1;
    for (const dd of [350, 500, 700, 1000, 1400, 1900, 2500, 3000]) a = Math.max(a, (W.H(wx, dd) + 12 - 2.6) / dd);
    occ.push(a);
  }
  const occMin = occ.map((_, k) => { let m = Infinity; for (let j = Math.max(0, k - 7); j <= Math.min(occ.length - 1, k + 7); j++) m = Math.min(m, occ[j]); return m; });
  const hidden = (x, d, y) => (y - 2.6) / d < occMin[Math.round((x + M) / OX)] - 0.006;
  let vis = 0;
  for (let k = 0; k < 300; k++) {
    const d = dn * Math.pow(df / dn, rng()), x = rng() * Lx;
    if (!hidden(x, d, Hs(ctx.x0 + x, d))) vis++;
  }
  const fv = clamp(vis / 300, 0.15, 1);
  for (let i = 0; i < n; i++) {
    let d = 0, x = 0, wx = 0, y = 0;
    for (let t = 0; t < 6; t++) {
      d = t === 0 ? dn * Math.pow(df / dn, (i + rng()) / n) : dn * Math.pow(df / dn, rng());
      x = rng() * Lx; wx = ctx.x0 + x;
      y = Hs(wx, d);
      if (!hidden(x, d, y)) break;
    }
    const dens = (n / d / Z) / Lx / fv;
    let r = clamp(Math.sqrt(2.6 / (Math.PI * dens)), 0.0012 * d, 0.03 * d);
    const h0 = up > 0 ? W.H(wx, d) : y;
    if (up > 0 && y - h0 > 300) r = Math.min(0.05 * d, r * 2);
    const e = Math.max(40, r);
    const hx = (Hs(wx + e, d) - y) / e, hd = (Hs(wx, d + e) - y) / e;
    const nn = norm3(-hx, 1, hd);
    const slope = 1 - nn[1];
    const tl = y > 1000 ? 0 : 650 + 250 * noise2(wx / 2000, d / 2000, W.ws + 693) + 80 * (noise2(wx / 300, d / 300, W.ws + 694) - 0.5);
    const fur = 1 - Math.abs(2 * fbm2(wx / 520, d / 1700, W.ws + 692, 2) - 1);
    const furrow = smooth(0.45, 0.2, fur);
    let c;
    if (y < tl && slope < 0.5) {
      // snowy forest on the lower slopes: dark trees with snow between them
      c = mix3(C.farForest, snowTone(nn[0], nn[1], nn[2]), 0.32 + 0.25 * noise2(wx / 300, d / 300, W.ws + 697));
    } else {
      // snow, except where the face is too steep to hold it (rock ribs), lit from the normal
      const rocky = smooth(0.42, 0.62, slope + 0.25 * smooth(0.55, 0.85, fur) - 0.3 * furrow);
      c = mix3(snowTone(nn[0], nn[1], nn[2]), shade(mix3(C.rock, C.rockDark, noise2(wx / 200, d / 150, W.ws + 698)), nn[0], nn[1], nn[2], 0.45, 0.6), rocky);
    }
    c = jitter(c, rng, 0.03);
    const q = quatUpTo(nn[0], nn[1], nn[2]);
    const ax = 0.8 + 0.5 * rng();
    out(x, y, -d, r * ax, r * 0.15, r * (1.8 - ax), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], up > 0 && y - h0 > 300 ? KIND.SURREAL : KIND.GROUND);
    if (out.due()) yield;
  }
}

export const winterBiome = {
  name: 'winter',
  palette: PAL,
  terrain: TERRAIN,
  hazeDist: 7000,
  gold: 0.3,   // dusk on snow is rose and blue, not tan
  shares: { trackside: 0.14, near: 0.42, mid: 0.28, far: 0.16 },
  // low light suits it best: dawn and dusk most of the time, night often, plain day least
  slots: { dawn: 0.28, day: 0.2, dusk: 0.32, night: 0.2 },
  sky: { stars: 1.3, deep: 0.9, milkyWay: 0.8, clear: 0.6 },
  beatKinds: [KIND.BUILDING, KIND.LIGHT],
  generators: { trackside, near, mid, far },
};

// ---------------------------------------------------------------------------------------------
// For scripts that inspect the layout, e.g.
//   const { _debug } = await import('./src/window/biomes/winter.js');
//   _debug.layout('7', 0, 20000)   -> { villages, farms, ponds, lakes, sledHills, skiHills, ... }
// Each entry has world x (wx) and distance (d); jump=<wx> in the previewer centres it.
// ---------------------------------------------------------------------------------------------
function at(seedStr) {
  const terrain = makeTerrain(hashString(String(seedStr)), TERRAIN);
  const W = world({ terrain });
  return { W, ctx: { terrain: W.terr, x0: 0, length: 1 } };
}
function layout(seedStr, x0, x1) {
  const { W, ctx } = at(seedStr);
  const list = (cell, fn, map) => { const res = []; for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) { const o = fn(W, i); if (o) res.push(map(o)); } return res; };
  const R = Math.round;
  return {
    villages: list(VCELL, village, (v) => ({ wx: R(v.cx), d: R(v.dc), houses: v.houses.length, square: { wx: R(v.sq.wx), d: R(v.sq.d) }, church: { wx: R(v.church.wx), d: R(v.church.d) } })),
    farms: list(FCELL, farm, (f) => ({ wx: R(f.cx), d: R(f.dc), bldgs: f.bldgs.length, snowman: !!f.snowman })),
    ponds: list(PCELL, pond, (p) => ({ wx: R(p.cx), d: R(p.dc) })),
    lakes: list(LCELL, lake, (l) => ({ wx: R(l.cx), d: R(l.dc), rx: R(l.rx), rd: R(l.rd) })),
    sledHills: list(SHCELL, sledHill, (s) => ({ wx: R(s.cx), d: R(s.dc) })),
    skiHills: list(KCELL, skiHill, (s) => ({ wx: R(s.cx), d: R(s.dc), liftBase: { wx: R(s.bx), d: R(s.bd) }, liftTop: { wx: R(liftGeom(W, s).pts.at(-1).wx), d: R(liftGeom(W, s).pts.at(-1).d) }, towers: liftGeom(W, s).pts.length - 2 })),
    brooks: list(BCELL, brook, (b) => ({ wx: R(b.x0), d: R(laneD(W, b.x0)), lane: laneOn(W, b.x0) })),
    halts: list(HCELL, halt, (h) => ({ wx: R(h.x0 + h.len / 2), d: 6 })),
    deer: list(DCELL, deerGroup, (g) => ({ wx: R(g.wx), d: R(g.d), type: g.type, n: g.n })),
    herds: list(RHCELL, reindeerHerd, (g) => ({ wx: R(g.wx), d: R(g.d), n: g.n })),
    sleighs: list(SLCELL, (W2, i) => {
      const r = worldRng(ctx, 571, i);
      if (r() > 0.55) return null;
      const wx = i * SLCELL + 0.1 * SLCELL + 0.8 * SLCELL * r();
      return laneOn(W2, wx) ? { wx, d: laneD(W2, wx) } : null;
    }, (o) => ({ wx: R(o.wx), d: R(o.d) })),
  };
}
export const _debug = { world, at, layout, surface, riverN, riverW, village, farm, pond, lake, sledHill, skiHill, brook, halt, liftGeom };
