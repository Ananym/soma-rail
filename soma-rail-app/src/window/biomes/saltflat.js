// "Salt flat": a desert railway across vast pale flats. Salt pan and dry lake bed, cracked crust,
// sparse scrub, far mesas and buttes, an enormous sky. Emptiness is the point, so the biome spends
// its splats on three things: a strong ground texture rushing past up close (crust polygons, cracks,
// wind streaks, tyre tracks), a clear rhythm from the telegraph-pole line, and a few crisp, tall
// silhouettes at great distance (mesas, buttes and a layered blue-violet range).
//
// Everything that has to line up between chunks or bands (cracks, roads, fences, pole lines, pools,
// mesas, landmarks) is a pure function of WORLD x and distance, hashed from the world seed, as in
// downs.js. Only the ground fill uses the chunk's own rng.
//
// Surreal dials (all 0 at level 0, so level 0 shows none of this):
//   scale     a monolith and mesas of impossible height
//   topology  mesas floating above the flat with their scree hanging beneath; the flat turning into
//             a perfect pale mirror band toward the horizon
//   logic     the same water tower repeating along the line, each time slightly wrong
import { hashInts, noise1, noise2 } from '../rng.js';
import {
  KIND, makeOut, worldSeed, worldRng, worldHash, cellsAround, groundY, fillGround, blob, stick, wires, rock,
  house, monolith, lamp, detail, jitter, mul3, mix3, shade, smooth, clamp, lerp, quatYaw, quatRoll, quatUpTo, norm3,
  strut, quatXTo,
} from './kit.js';

const PAL = {
  ground: [0.74, 0.7, 0.62],
  foliage: [0.36, 0.39, 0.26],
  scrub: [0.42, 0.44, 0.32],
  rock: [0.5, 0.4, 0.32],
  hedge: [0.4, 0.4, 0.3],
  ballast: [0.46, 0.44, 0.41],
};

const SALT = [0.74, 0.72, 0.66];        // pale crust
const DUST = [0.68, 0.62, 0.52];        // warmer dusty patches
const CRACK = [0.45, 0.4, 0.34];
const POOL = [0.68, 0.76, 0.8];        // shallow pools: lighter and bluer than the ground
const MIRROR = [0.7, 0.78, 0.86];
// strata of the mesas: ochre, rust, cream, buff, brick, pale, umber
const STRATA = [
  [0.72, 0.52, 0.3], [0.6, 0.34, 0.22], [0.76, 0.7, 0.54], [0.68, 0.56, 0.4],
  [0.52, 0.28, 0.2], [0.74, 0.66, 0.52], [0.42, 0.29, 0.21],
];
const SKY_LOW = [0.7, 0.76, 0.84];

// ---------------------------------------------------------------------------------------------
// Ground colour: one pure function of world position, shared by all four bands
// ---------------------------------------------------------------------------------------------

// Jittered-grid Voronoi cells of size S: the crust polygons. Feature point of cell (i, j).
function feat(wsd, salt, S, i, j) {
  const h = hashInts(wsd, salt, i, j);
  return [(i + 0.14 + 0.72 * ((h & 1023) / 1023)) * S, (j + 0.14 + 0.72 * (((h >>> 10) & 1023) / 1023)) * S, h];
}
const VOUT = [0, 0];
// Half the gap between nearest and second nearest feature point (about the distance to a crack) and
// a hash of the nearest cell.
function vor(wsd, salt, S, wx, d) {
  const ci = Math.floor(wx / S), cj = Math.floor(d / S);
  let d1 = 1e9, d2 = 1e9, id = 0;
  for (let j = cj - 1; j <= cj + 1; j++) {
    for (let i = ci - 1; i <= ci + 1; i++) {
      const f = feat(wsd, salt, S, i, j);
      const dd = Math.hypot(wx - f[0], d - f[1]);
      if (dd < d1) { d2 = d1; d1 = dd; id = f[2]; } else if (dd < d2) d2 = dd;
    }
  }
  VOUT[0] = (d2 - d1) * 0.5; VOUT[1] = id;
  return VOUT;
}

// Polygon size by distance: small crust near the line, bigger cells further out (they are only
// readable out to about 100 times their size's perspective compression).
function tier(d) { return d < 42 ? 0 : d < 170 ? 1 : d < 520 ? 2 : 3; }
const TIER_S = [3.2, 12, 45, 170];

function poolNoise(wsd, wx, d) {
  // pools are long in x and shallow in depth near the line, so they read as patches, not a band
  const sd = 30 + 0.25 * d;
  return noise2(wx / (110 + 0.45 * d), d / sd, wsd + 9) * 0.75 + noise2(wx / 60, d / (12 + 0.1 * d), wsd + 12) * 0.25;
}
function poolAmount(wsd, wx, d) {
  if (d < 14) return 0;
  const gate = smooth(0.4, 0.58, noise1(wx / 1900, wsd + 10));
  const m = poolNoise(wsd, wx, d);
  return gate * smooth(0.6, 0.67, m);
}

// Wet crust around the pools, a darker rim. 0..1
function poolRim(wsd, wx, d) {
  if (d < 14) return 0;
  const gate = smooth(0.4, 0.58, noise1(wx / 1900, wsd + 10));
  const m = poolNoise(wsd, wx, d);
  return gate * smooth(0.5, 0.6, m) * (1 - smooth(0.6, 0.68, m));
}

function flatColor(ctx, wx, d, rng, o = {}) {
  const wsd = worldSeed(ctx);
  const t = tier(d), S = TIER_S[t];
  const pa = noise2(wx / 260, d / 260, wsd + 5);
  const pb = noise2(wx / 40, d / 40, wsd + 6);
  // wind-drawn streaks along the track: pale and dark bands, long in x
  const st = noise2(wx / (60 + 0.2 * d), d / (2.5 + 0.02 * d), wsd + 8);
  let c = mix3(SALT, DUST, smooth(0.45, 0.8, pa) * 0.6);
  let k = (0.9 + 0.2 * pb) * (0.94 + 0.12 * st);
  // crust polygons: tone per cell, a pale raised rim, a dark crack
  if (!o.noCells) {
    const v = vor(wsd, 900 + t, S, wx, d);
    const e = v[0] / S, cellTone = ((v[1] >>> 20) & 255) / 255 - 0.5;
    const amp = t === 0 ? 0.2 : t === 1 ? 0.16 : 0.12;
    k *= 1 + amp * cellTone;
    if (e < 0.02) k *= 0.7; else if (e < 0.05) k *= 0.85; else if (e < 0.1) k *= 1.04;
  }
  c = mul3(c, k);
  // pools
  const pool = poolAmount(wsd, wx, d);
  const rim = poolRim(wsd, wx, d);
  if (rim > 0) c = mix3(c, [0.5, 0.47, 0.42], 0.55 * rim);
  if (pool > 0) c = mix3(c, mix3(POOL, SKY_LOW, smooth(100, 1500, d) * 0.6), pool * 0.92);
  // dry washes: darker thin lines winding across the mid ground
  if (d > 250 && d < 3200) {
    const u = d / 150 + 1.8 * noise1(wx / 800, wsd + 21);
    const f = Math.abs(u - Math.floor(u) - 0.5);
    if (f > 0.465 && noise2(wx / 900, d / 400, wsd + 22) > 0.5) c = mul3(c, 0.8);
  }
  // tyre tracks and wheel ruts beside the line
  if (d < 32) {
    for (let q = 0; q < 2; q++) {
      const dc = (q === 0 ? 10.6 : 12.0) + 0.7 * (noise1(wx / 55, wsd + 30) - 0.5);
      if (Math.abs(d - dc) < 0.22) c = mul3(c, 0.78);
    }
  }
  // level 1: the flat becomes a perfect mirror band toward the horizon
  const topo = (ctx.dials && ctx.dials.topology) || 0;
  if (topo > 0 && d > 300) {
    const m = topo * smooth(300, 1300, d) * (0.6 + 0.4 * noise1(wx / 3000, wsd + 40));
    c = mix3(c, mix3(MIRROR, [0.82, 0.84, 0.86], smooth(1200, 6000, d) * 0.7), clamp(m * 1.7, 0, 0.94));
  }
  // far ground merges toward blue-violet
  if (d > 3000) c = mix3(c, [0.5, 0.46, 0.56], smooth(3000, 9000, d) * 0.6);
  return jitter(c, rng, o.jit != null ? o.jit : 0.03);
}

// Lift (metres) that lets a thin mark on the ground show over the flat discs of the fill: marks are
// depth-sorted with the ground, and a mark at height h shows where the ground about d*h/3.4 further
// out shows, so it needs h >~ 3.4 r / d to clear discs of radius r (about 0.02 d at most).
const lift = (d) => clamp(0.05 + 0.02 * d * 0.6, 0.06, 0.6);

// ---------------------------------------------------------------------------------------------
// Cracks: the edges of the same Voronoi cells that tint the ground, drawn as thin dark lines
// ---------------------------------------------------------------------------------------------
function* cracks(ctx, out, o) {
  const { S, salt, dLo, dHi } = o;
  const wsd = worldSeed(ctx);
  const cache = new Map();
  const F = (i, j) => { const key = i * 131072 + j; let f = cache.get(key); if (!f) { f = feat(wsd, salt, S, i, j); cache.set(key, f); } return f; };
  const margin = S * 1.2;
  const i0 = Math.floor((ctx.x0 - margin) / S), i1 = Math.floor((ctx.x0 + ctx.length + margin) / S);
  const j0 = Math.max(0, Math.floor(dLo / S) - 1), j1 = Math.floor(dHi / S) + 1;
  const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const dens = Math.min(1, Math.sqrt(out.density));
  const stepK = o.stepK || 1;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const A = F(i, j);
      for (const [di, dj] of dirs) {
        const B = F(i + di, j + dj);
        const mx = (A[0] + B[0]) / 2, md = (A[1] + B[1]) / 2;
        if (md < dLo - S || md > dHi + S || out.n >= out.limit) continue;
        const ax = A[0] - B[0], ad = A[1] - B[1], L = Math.hypot(ax, ad) || 1;
        const ex = -ad / L, ed = ax / L;                    // unit vector along the bisector
        const q = quatYaw(Math.atan2(ed, ex));
        const ds = Math.max(0.07, 0.0045 * md * stepK) / dens;
        const wid = Math.max(0.035, 0.0035 * md);
        for (let t = -S * 0.95; t <= S * 0.95; t += ds) {
          const px = mx + ex * t, pd = md + ed * t;
          if (pd < dLo || pd > dHi || px < ctx.x0 - 1 || px > ctx.x0 + ctx.length + 1) continue;
          const dA = Math.hypot(px - A[0], pd - A[1]);
          const ci = Math.floor(px / S), cj = Math.floor(pd / S);
          let ok = true;
          for (let jj = cj - 1; jj <= cj + 1 && ok; jj++) {
            for (let ii = ci - 1; ii <= ci + 1; ii++) {
              if ((ii === i && jj === j) || (ii === i + di && jj === j + dj)) continue;
              const C = F(ii, jj);
              if (Math.hypot(px - C[0], pd - C[1]) < dA - 0.01) { ok = false; break; }
            }
          }
          if (!ok) continue;
          // pools hide the cracks
          if (poolAmount(wsd, px, pd) > 0.3) continue;
          const h = hashInts(wsd, salt, Math.floor(px * 3), Math.floor(pd * 3)) / 4294967296;
          const c = mul3(CRACK, 0.85 + 0.3 * h);
          const x = px - ctx.x0;
          out(x, groundY(ctx, x, pd) + lift(pd), -pd, ds * 0.8, 0.006, wid * 0.5, c[0], c[1], c[2], 0.9, q[0], q[1], q[2], q[3], KIND.GROUND);
        }
        if (out.due()) yield;
      }
    }
    yield;
  }
}

// Long thin marks along x: wind streaks and tyre tracks. Continuous along the line, so they stay
// crisp under motion blur. Tyre tracks are world-placed lines of splats.
function* tyreTracks(ctx, out) {
  const wsd = worldSeed(ctx);
  const dens = Math.min(1, Math.sqrt(out.density));
  const step = 0.3 / dens;
  for (let q = 0; q < 2; q++) {
    for (let x = step / 2; x < ctx.length; x += step) {
      const wx = ctx.x0 + x;
      const dc = (q === 0 ? 10.6 : 12.0) + 0.7 * (noise1(wx / 55, wsd + 30) - 0.5);
      const ang = Math.atan2(0.7 * (noise1((wx + 1) / 55, wsd + 30) - noise1(wx / 55, wsd + 30)), 1);
      const qq = quatYaw(ang);
      const broken = noise1(wx / 25, wsd + 31) < 0.12 ? 0.4 : 1;
      const c = mul3([0.5, 0.44, 0.36], 0.9 + 0.2 * noise1(wx * 1.7, wsd + 32));
      out(x, groundY(ctx, x, dc) + lift(dc), -dc, step * 0.8, 0.008, 0.11, c[0], c[1], c[2], 0.85 * broken, qq[0], qq[1], qq[2], qq[3], KIND.GROUND);
    }
    if (out.due()) yield;
  }
}

function* streaks(ctx, out, n) {
  const rng = ctx.rng;
  for (let i = 0; i < n; i++) {
    const d = 7.5 * Math.pow(ctx.zFar / 7.5, rng() ** 1.3);
    const x = rng() * ctx.length, wx = ctx.x0 + x;
    const len = (1.2 + 5 * rng()) * (0.5 + d / 25);
    const wid = (0.1 + 0.3 * rng()) * (0.4 + d / 16);
    const pale = rng() < 0.5;
    const c = mul3(flatColor(ctx, wx, d, rng, { noCells: true }), pale ? 1.08 : 0.88);
    out(x, groundY(ctx, x, d) + lift(d) * 0.7, -d, len * 0.5, 0.006, wid * 0.5, c[0], c[1], c[2], 0.65, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Small props
// ---------------------------------------------------------------------------------------------
const SHRUBS = [[0.4, 0.4, 0.28], [0.5, 0.49, 0.39], [0.52, 0.46, 0.34], [0.36, 0.37, 0.26], [0.58, 0.55, 0.46], [0.46, 0.4, 0.3]];

// A low dry bush with a shadow on the ground (shadows fall away from the sun: +x and back).
function* shrub(ctx, out, x, d, w, h, rng, nSp, col) {
  const y0 = groundY(ctx, x, d);
  const sh = mul3(flatColor(ctx, ctx.x0 + x, d, rng, { noCells: true }), 0.7);
  out(x + w * 0.4, y0 + lift(d) * 0.5, -(d + w * 0.15), w * 0.75, 0.005, w * 0.5, sh[0], sh[1], sh[2], 0.7, 0, 0, 0, 1, KIND.GROUND);
  for (let i = 0; i < nSp; i++) {
    const a = rng() * 6.28, rr = nSp > 1 ? Math.sqrt(rng()) * w * 0.3 : 0;
    const c = shade(jitter(col, rng, 0.1), 0, 0.8, 0.5, 0.6, 0.5);
    const s = nSp > 1 ? w * 0.36 : w * 0.5;
    out(x + Math.cos(a) * rr, y0 + h * (0.35 + 0.3 * rng()) * (nSp > 1 ? 1 : 0.8), -(d + Math.sin(a) * rr * 0.6), s, h * 0.42, s * 0.85, c[0], c[1], c[2], 0.97, 0, 0, 0, 1, KIND.HEDGE);
  }
  if (out.due()) yield;
}

function* tumbleweed(ctx, out, x, d, r, rng) {
  const y0 = groundY(ctx, x, d);
  yield* blob(ctx, out, x, y0 + r * 0.9, d, r, r * 0.9, r, { n: Math.max(4, Math.round(10 * Math.sqrt(out.density))), color: [0.6, 0.5, 0.34], rng, kind: KIND.OTHER, inner: 0.5, clump: 0.7, size: Math.max(r * 0.4, 0.05) });
}

// A telegraph pole: weathered timber, a lean, one or two cross-arms with glass insulators.
// Tagged MAST so the trackside rule (nothing but masts, wires and trees above 1.6 m near the line)
// holds. x, d chunk-local. opts: { height, lean, arms, rng }
export function* telegraphPole(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 7;
  const lean = opts.lean || 0;
  const y0 = groundY(ctx, x, d) - 0.3;
  const col = opts.color || [0.4, 0.32, 0.24];
  const r0 = 0.16;
  const n = Math.max(6, Math.round(H / 0.35));
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n * H, r = r0 * (1 - 0.3 * t / H);
    const c = jitter(mul3(col, 0.85 + 0.2 * (t / H)), rng, 0.08);
    out(x + lean * t, y0 + t, -d, r, H / n * 0.62, r, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.MAST);
  }
  const arms = opts.arms != null ? opts.arms : 2;
  for (let a = 0; a < arms; a++) {
    const ay = y0 + H - 0.45 - a * 0.85, ax = x + lean * (ay - y0);
    const tilt = opts.tilt || 0;
    for (let dd = -0.8; dd <= 0.81; dd += 0.2) {
      const c = mul3(col, 0.9);
      out(ax, ay + tilt * dd, -(d + dd), 0.06, 0.06, 0.12, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.MAST);
    }
    for (const dd of [-0.6, 0.6]) out(ax, ay + 0.14 + tilt * dd, -(d + dd), 0.05, 0.09, 0.05, 0.6, 0.72, 0.68, 1, 0, 0, 0, 1, KIND.MAST);
  }
  if (out.due()) yield;
}

// The old pole line beside the track: one pole every beat of world x, 2 cross-arms, 4 wires.
function* poleLine(ctx, out, d, o = {}) {
  const beat = ctx.beatMetres || 56;
  const wsd = worldSeed(ctx);
  const H = o.height || 7.2;
  const first = Math.ceil(ctx.x0 / beat), last = Math.floor((ctx.x0 + ctx.length) / beat);
  for (let k = first; k <= last; k++) {
    const h = hashInts(wsd, 71, k) / 4294967296;
    // each pole has its own character: a lean, a crooked arm, now and then a missing arm
    yield* telegraphPole(ctx, out, k * beat - ctx.x0, d, {
      height: H * (0.96 + 0.08 * h), lean: (h - 0.5) * 0.07, tilt: ((hashInts(wsd, 72, k) & 255) / 255 - 0.5) * (h > 0.85 ? 0.7 : 0.1),
      arms: h < 0.1 ? 1 : 2, rng: worldRng(ctx, 73, k),
    });
  }
  const ys = [H - 0.45, H - 1.3];
  const list = [];
  for (const y of ys) for (const dd of [-0.6, 0.6]) list.push({ d: d + dd, y: y + 0.2, sag: 0.9 + (y === ys[0] ? 0 : 0.05), r: 0.013, color: [0.16, 0.15, 0.14] });
  yield* wires(ctx, out, beat, list, { step: 0.4 / Math.min(1, Math.sqrt(out.density)) });
}

// Plain concrete mile marker and rusted sign on a post. Heights stay under 1.6 m within 6 m.
function* mileMarker(ctx, out, x, d) {
  const y0 = groundY(ctx, x, d);
  for (let t = 0.1; t < 1.0; t += 0.18) out(x, y0 + t, -d, 0.12, 0.11, 0.1, 0.66, 0.64, 0.58, 1, 0, 0, 0, 1, KIND.OTHER);
  out(x, y0 + 1.0, -(d - 0.1), 0.16, 0.13, 0.04, 0.3, 0.28, 0.26, 1, 0, 0, 0, 1, KIND.OTHER);
}
function* rustSign(ctx, out, x, d, rng) {
  const y0 = groundY(ctx, x, d);
  yield* stick(ctx, out, x, y0 - 0.1, d, 2.3, 0.05, { color: [0.32, 0.28, 0.24], kind: KIND.OTHER });
  const c = jitter([0.52, 0.3, 0.17], rng, 0.1);
  out(x, y0 + 2.0, -(d - 0.06), 0.5, 0.35, 0.03, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
  out(x - 0.1, y0 + 1.95, -(d - 0.1), 0.3, 0.1, 0.02, 0.62, 0.58, 0.48, 0.9, 0, 0, 0, 1, KIND.OTHER);
}
// Stack of bleached sleepers
function* sleeperStack(ctx, out, x, d, rng) {
  const y0 = groundY(ctx, x, d);
  const rows = 5 + Math.floor(rng() * 3);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 3; c++) {
      const col = jitter([0.54, 0.49, 0.41], rng, 0.1);
      out(x + (c - 1) * 0.9, y0 + 0.14 + r * 0.16, -d, 0.5, 0.075, 0.13, col[0], col[1], col[2], 1, 0, 0, 0, 1, KIND.OTHER);
      out(x + (c - 1) * 0.9, y0 + 0.14 + r * 0.16, -(d - 0.12), 0.5, 0.075, 0.03, col[0] * 0.8, col[1] * 0.8, col[2] * 0.8, 1, 0, 0, 0, 1, KIND.OTHER);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Landmarks of the near band: water tower, windmill, shack, car, siding
// ---------------------------------------------------------------------------------------------

// A body of revolution seen from the camera side only: radius profile r(t), t 0..1 up its height.
function* lathe(ctx, out, x, y0, d, H, rad, col, o = {}) {
  const rng = o.rng || ctx.rng;
  const p = Math.max(0.12, detail(out, d, o.k || 1.6));
  const Rm = Math.max(rad(0), rad(0.5), rad(1));
  // o.full draws it all the way round, for things the train passes close enough to see behind
  const turn = o.full ? 2 * Math.PI : Math.PI;
  const nh = clamp(Math.round(H / p), 3, 60), na = clamp(Math.round(turn * Rm / p), o.full ? 8 : 4, o.full ? 64 : 40);
  for (let j = 0; j < nh; j++) {
    const t = (j + 0.5) / nh, R = rad(t);
    if (R < 0.02) continue;
    const ribs = o.ribs ? (Math.floor(t * H / 0.55) % 2 ? 0.93 : 1.04) : 1;
    for (let i = 0; i < na; i++) {
      const a = ((i + 0.5) / na - 0.5) * turn;
      const c = jitter(mul3(shade(col, Math.sin(a), 0.1, Math.cos(a), 0.55, 0.55), ribs), rng, 0.07);
      const arc = turn * R / na;
      out(x + R * Math.sin(a), y0 + t * H, -(d - R * Math.cos(a)), Math.max(arc, 0.05) * 0.75, H / nh * 0.62, Math.max(arc, 0.05) * 0.75, c[0], c[1], c[2], 1, 0, 0, 0, 1, o.kind != null ? o.kind : KIND.BUILDING);
    }
    if (out.due()) yield;
  }
}

// The two tall things on the flat are open frames, so both are drawn the way the pinewood pylon is:
// every member a thin strut lying along the member, its thickness taken from the distance, with
// bracing on all four faces. (Stacked round blobs and rows of beads turned to fuzz on a real GPU.)
const frameR = (d, k = 1) => Math.max(0.055, 0.00065 * d) * k;

// Water tower: a wooden tank with iron hoops and a conical roof on four splayed, cross-braced legs,
// with a ladder and a spout. wrong (0..1) makes it a little off: used by the logic dial's repeats.
export function* waterTower(ctx, out, x, d, rng, wrong = 0, scale = 1) {
  const y0 = groundY(ctx, x, d) - 0.2;
  const legH = (8.5 + 2.2 * wrong) * scale, R = (2.5 + 0.35 * wrong) * scale, TH = 3.6 * scale;
  const wood = [0.36, 0.28, 0.21];
  const tankCol = mix3([0.55, 0.42, 0.32], [0.42, 0.55, 0.62], wrong * 0.7);
  const r = frameR(d, 1.25 * scale);
  const tone = (k) => mul3(wood, k);
  // corners: sx, sd (-1 = towards the track), light. A very wrong tower stands on three legs.
  const C = [[-1, -1, 1.12], [1, -1, 0.92], [1, 1, 0.7], [-1, 1, 0.88]].slice(0, wrong > 0.85 ? 3 : 4);
  const foot = 2.7 * scale, top = 1.9 * scale;
  const at = (c, t) => { const hw = foot + (top - foot) * t; return [x + c[0] * hw + wrong * 0.035 * t * legH, y0 + t * legH, -(d + c[1] * hw)]; };
  for (const c of C) strut(out, ...at(c, 0), ...at(c, 1), r, tone(c[2]), 7, 1, KIND.BUILDING);
  const tiers = [0.04, 0.37, 0.69, 0.98];
  for (let f = 0; f < C.length; f++) {
    const a = C[f], b = C[(f + 1) % C.length], k = (a[2] + b[2]) * 0.47;
    for (let i = 0; i + 1 < tiers.length; i++) {
      strut(out, ...at(a, tiers[i + 1]), ...at(b, tiers[i + 1]), r * 0.75, tone(k), 3, 1, KIND.BUILDING);
      strut(out, ...at(a, tiers[i]), ...at(b, tiers[i + 1]), r * 0.55, tone(k * 0.95), 4, 1, KIND.BUILDING);
      strut(out, ...at(b, tiers[i]), ...at(a, tiers[i + 1]), r * 0.55, tone(k * 0.95), 4, 1, KIND.BUILDING);
    }
  }
  if (out.due()) yield;
  const ty = y0 + legH + wrong * 1.4;    // the wrong one floats a little above its legs
  // the deck the tank sits on, the tank all the way round, its hoops, the roof and a finial
  out(x, ty - 0.12, -d, R * 0.62, 0.09 * scale, R * 0.62, wood[0] * 0.7, wood[1] * 0.7, wood[2] * 0.7, 1, 0, 0, 0, 1, KIND.BUILDING);
  yield* lathe(ctx, out, x, ty, d, TH, () => R, tankCol, { rng, ribs: true, full: true, k: 1.2 });
  for (const f of [0.14, 0.5, 0.86]) {
    const n = 18;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * 2 * Math.PI, a1 = ((i + 1) / n) * 2 * Math.PI, Rh = R * 1.015;
      strut(out, x + Rh * Math.sin(a0), ty + f * TH, -(d - Rh * Math.cos(a0)), x + Rh * Math.sin(a1), ty + f * TH, -(d - Rh * Math.cos(a1)), r * 0.5, [0.2, 0.17, 0.15], 1, 1, KIND.BUILDING);
    }
  }
  yield* lathe(ctx, out, x, ty + TH, d, 1.5 * scale, (t) => R * (1 - t) * 1.08, mul3(tankCol, 0.72), { rng, full: true, k: 1.2 });
  strut(out, x, ty + TH + 1.4 * scale, -d, x, ty + TH + 2.3 * scale, -d, r * 0.6, [0.2, 0.17, 0.15], 1, 1, KIND.BUILDING);
  // ladder up the near left leg, and the spout hanging out towards the track
  const la = at(C[0], 0), lb = at(C[0], 1);
  for (const o of [-0.22, 0.22]) strut(out, la[0] + o - 0.5, la[1], la[2] + 0.25, lb[0] + o - 0.3, ty + 0.4, lb[2] + 0.25, r * 0.4, tone(1.15), 6, 1, KIND.BUILDING);
  strut(out, x + R * 0.5, ty + 0.3, -(d - R), x + R * 0.9, ty - 2.2 * scale, -(d - R - 2.4 * scale), r * 0.9, [0.24, 0.2, 0.17], 3, 1, KIND.BUILDING);
  if (out.due()) yield;
}

// Windmill pump: a braced steel lattice tower, a many-bladed wheel inside two rims turned a little
// away from the window so it reads as a wheel, a tail boom with its vane, and a stock tank.
function* windmill(ctx, out, x, d, rng) {
  const y0 = groundY(ctx, x, d) - 0.1;
  const H = 10 + 2 * rng();
  const steel = [0.33, 0.3, 0.28];
  const r = frameR(d);
  const tone = (k) => mul3(steel, k);
  const C = [[-1, -1, 1.12], [1, -1, 0.92], [1, 1, 0.7], [-1, 1, 0.88]];
  const foot = 1.35, top = 0.2;
  const at = (c, t) => { const hw = foot + (top - foot) * t; return [x + c[0] * hw, y0 + t * H, -(d + c[1] * hw)]; };
  for (const c of C) strut(out, ...at(c, 0), ...at(c, 1), r, tone(c[2]), 8, 1, KIND.BUILDING);
  const tiers = [0.03, 0.27, 0.48, 0.66, 0.82, 0.96];
  for (let f = 0; f < 4; f++) {
    const a = C[f], b = C[(f + 1) % 4], k = (a[2] + b[2]) * 0.47;
    for (let i = 0; i + 1 < tiers.length; i++) {
      strut(out, ...at(a, tiers[i + 1]), ...at(b, tiers[i + 1]), r * 0.6, tone(k), 2, 1, KIND.BUILDING);
      if ((i + f) % 2) strut(out, ...at(a, tiers[i]), ...at(b, tiers[i + 1]), r * 0.5, tone(k), 3, 1, KIND.BUILDING);
      else strut(out, ...at(b, tiers[i]), ...at(a, tiers[i + 1]), r * 0.5, tone(k), 3, 1, KIND.BUILDING);
    }
  }
  if (out.due()) yield;
  // The wheel faces the wind, which here blows from ahead and a little towards the window: axis n.
  const R = 2.1, hy = y0 + H + 0.35;
  const n = [0.78, 0, 0.62], u = [0.62, 0, -0.78];          // axis, and the level direction in the wheel's plane
  const cx = x + n[0] * 0.55, cz = -d + n[2] * 0.55;
  const P = (th, rho) => [cx + u[0] * rho * Math.cos(th), hy + rho * Math.sin(th), cz + u[2] * rho * Math.cos(th)];
  const blades = 16;
  for (let b = 0; b < blades; b++) {
    const th = (b / blades) * Math.PI * 2 + 0.2;
    const c = jitter([0.6, 0.58, 0.54], rng, 0.1);
    strut(out, ...P(th, 0.42), ...P(th, R * 0.97), Math.max(r * 1.5, 0.11), c, 2, 1, KIND.BUILDING);   // a sail: wider than a rod
  }
  for (const [rho, k] of [[R, 0.6], [R * 0.45, 0.5]]) {
    const seg = rho > 1 ? 24 : 14;
    for (let i = 0; i < seg; i++) strut(out, ...P((i / seg) * 2 * Math.PI, rho), ...P(((i + 1) / seg) * 2 * Math.PI, rho), r * k, tone(1.2), 1, 1, KIND.BUILDING);
  }
  out(cx, hy, cz, 0.16, 0.16, 0.16, steel[0] * 0.8, steel[1] * 0.8, steel[2] * 0.8, 1, 0, 0, 0, 1, KIND.BUILDING);   // hub
  // tail boom downwind of the tower head, and the vane: a flat sheet in the plane of boom and sky
  const tb = [x - n[0] * 3.1, hy, -d - n[2] * 3.1];
  strut(out, x, hy, -d, tb[0], tb[1], tb[2], r * 0.8, tone(1), 3, 1, KIND.BUILDING);
  const q = quatXTo(-n[0], 0, -n[2]);
  out(tb[0], hy + 0.05, tb[2], 0.42, 0.36, 0.035, 0.6, 0.47, 0.33, 1, q[0], q[1], q[2], q[3], KIND.BUILDING);
  // the pump rod down the middle, the pipe to the stock tank and the tank itself
  strut(out, x, y0 + 0.2, -d, x, hy, -d, r * 0.45, tone(0.8), 4, 1, KIND.BUILDING);
  strut(out, x + 0.6, y0 + 0.5, -(d + 0.4), x + 3.6, y0 + 0.9, -(d + 1.6), r * 0.7, tone(0.9), 2, 1, KIND.BUILDING);
  yield* lathe(ctx, out, x + 4.6, y0, d + 2, 1.3, () => 1.5, [0.5, 0.4, 0.32], { rng, ribs: true, full: true, k: 1.2 });
}

function* shack(ctx, out, x, d, rng, night) {
  const wall = jitter([0.5, 0.44, 0.36], rng, 0.08);
  yield* house(ctx, out, x, d, { w: 6.5, depth: 4.5, h: 2.7, roofH: 0.8, wall, roof: [0.46, 0.34, 0.28], windows: true, chimney: false, windowColor: [0.16, 0.15, 0.14], rng, yaw: (rng() - 0.5) * 0.3 });
  yield* house(ctx, out, x + 8.5, d + 3, { w: 3.4, depth: 2.6, h: 2.1, roofH: 0.4, wall: mul3(wall, 0.9), roof: [0.5, 0.5, 0.48], windows: false, chimney: false, rng });
  if (night) yield* lamp(ctx, out, x - 1.2, groundY(ctx, x, d) + 1.5, d - 2.3, [1, 0.82, 0.5], { size: 0.1 });
}

function* oldCar(ctx, out, x, d, rng) {
  const y0 = groundY(ctx, x, d);
  const body = jitter([0.5, 0.3, 0.2], rng, 0.1);
  const n = Math.max(6, Math.round(24 * Math.sqrt(out.density)));
  yield* blob(ctx, out, x, y0 + 0.65, d, 2.3, 0.42, 0.9, { n, color: body, rng, kind: KIND.OTHER, inner: 0.3, clump: 0.2 });
  yield* blob(ctx, out, x - 0.2, y0 + 1.2, d, 1.15, 0.38, 0.8, { n: Math.round(n * 0.6), color: mul3(body, 0.9), rng, kind: KIND.OTHER, inner: 0.3, clump: 0.2 });
  for (const wx of [-1.4, 1.5]) out(x + wx, y0 + 0.32, -(d - 0.75), 0.34, 0.34, 0.1, 0.12, 0.11, 0.1, 1, 0, 0, 0, 1, KIND.OTHER);
}

// Siding: a spur with a few box wagons beyond the cess.
function* siding(ctx, out, x, d, len, rng) {
  const y0 = groundY(ctx, x, d);
  const step = 0.4 / Math.min(1, Math.sqrt(out.density));
  for (let u = 0; u < len; u += step) {
    for (const dd of [-0.75, 0.75]) out(x + u, y0 + 0.14, -(d + dd), step * 0.7, 0.05, 0.04, 0.3, 0.27, 0.25, 1, 0, 0, 0, 1, KIND.OTHER);
    out(x + u, y0 + 0.06, -d, step * 0.7, 0.04, 1.2, 0.42, 0.37, 0.32, 1, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
  let cx = 6;
  while (cx < len - 12) {
    if (rng() < 0.75) {
      const wall = [[0.5, 0.26, 0.2], [0.46, 0.4, 0.34], [0.42, 0.3, 0.22], [0.56, 0.5, 0.4]][Math.floor(rng() * 4)];
      yield* house(ctx, out, x + cx + 6, d + 0.1, { w: 12, depth: 2.9, h: 3.1, roofH: 0.35, wall: jitter(wall, rng, 0.06), roof: [0.36, 0.33, 0.3], windows: false, chimney: false, rng, y: y0 + 0.5 });
    }
    cx += 13.5;
  }
}

// ---------------------------------------------------------------------------------------------
// Mesas, buttes, domes and ranges
// ---------------------------------------------------------------------------------------------

// A flat-topped mesa standing on the terrain: stacked horizontal strata bands, an irregular
// outline, shaded cliff faces and a scree skirt. Built from the camera-facing front face plus the
// two ends (seen as the train passes). With float:true it hangs in the air with its scree tapering
// to a point beneath (level 1).
//   x, d  chunk-local centre of the front face base; opts: { w, h, dep, rng, seed, pitch (splat
//   spacing), maxN, tint, tintAmt, float, lift, skirt (scree fraction of h), kind }
export function* mesa(ctx, out, x, d, o = {}) {
  const rng = o.rng || ctx.rng;
  const w = o.w || 200, h = o.h || 80, dep = o.dep || w * 0.5;
  const sd = o.seed != null ? o.seed : Math.floor(rng() * 1e6);
  const flo = !!o.float;
  const hs = h * (o.skirt != null ? o.skirt : (flo ? 0.5 : 0.3));
  let p = o.pitch || Math.max(detail(out, d, 2.3), 0.3);
  const area = (w + hs * 1.7) * h + dep * h * 0.7;
  if (flo) p *= 0.75;
  p = Math.max(p, Math.sqrt(area / (o.maxN || 6000 * out.density)));
  const y0 = groundY(ctx, x, d) + (flo ? (o.lift || 100) : -0.3 * Math.min(1, h / 40));
  const kind = o.kind != null ? o.kind : KIND.ROCK;
  const tint = o.tint, tintAmt = o.tintAmt || 0;
  // strata: bands from the cliff base to the top
  const bands = [];
  {
    let yy = hs, bi = Math.floor(rng() * STRATA.length);
    while (yy < h) {
      const th = Math.max(p * 1.5, (h - hs) * (0.05 + 0.1 * rng()));
      bi = (bi + 1 + Math.floor(rng() * (STRATA.length - 1))) % STRATA.length;
      bands.push({ y0: yy, y1: Math.min(h, yy + th), c: jitter(STRATA[bi], rng, 0.05), ledge: rng() < 0.4, inset: (rng() - 0.55) * 0.09 });
      yy += th;
    }
    if (!bands.length) bands.push({ y0: hs, y1: h, c: STRATA[0], ledge: false });
  }
  const bandAt = (y) => { for (const b of bands) if (y < b.y1) return b; return bands[bands.length - 1]; };
  const halfW = (y) => {
    if (y < hs) {
      const f = (hs - y) / hs;
      return flo ? (w / 2) * Math.pow(1 - f, 0.85) : w / 2 + Math.min((hs - y) * 1.7, w * 0.9 + 12);
    }
    const wob = 1 + 0.07 * (noise1(y / Math.max(p * 3, h * 0.12) + 1, sd) - 0.5) * 2;
    const b = bandAt(y);
    const notch = 1 - 0.05 * Math.max(0, noise1(y / Math.max(p * 1.5, h * 0.05) + 9, sd + 4) - 0.55) * 4;
    return (w / 2) * wob * notch * (1 + b.inset) * (b.ledge ? 1.025 : 1) * (1 - 0.04 * Math.pow((y - hs) / Math.max(1, h - hs), 3));
  };
  const top = (u) => h * (1 - 0.045 * noise1((x + u) / Math.max(p * 4, w * 0.12) + 5, sd + 1)) - 0.002 * h;
  const colorAt = (y, u, side) => {
    const b = bandAt(y);
    let c;
    if (y < hs) {
      const base = bands[0].c;
      c = flo ? mul3(mix3(base, [0.5, 0.38, 0.3], 0.5), 0.8 - 0.2 * (1 - y / hs)) : mix3(base, [0.72, 0.64, 0.52], 0.55);
      c = jitter(c, rng, 0.12);
    } else {
      c = b.c;
      const gully = 0.8 + 0.3 * noise1((x + u) / (w * 0.03 + p * 1.5) + 3, sd + 3);
      c = mul3(c, gully);
      const rel = (y - b.y0) / Math.max(1e-3, b.y1 - b.y0);
      if (rel < 0.22) c = mul3(c, 0.78);                 // shadow under the harder cap band
      if (y > h * 0.95) c = mul3(c, 1.06);
      c = jitter(c, rng, 0.05);
    }
    c = side ? shade(c, side, 0.05, 0.12, 0.5, 0.6) : shade(c, 0, y < hs ? 0.5 : 0.05, 1, 0.62, 0.42);
    if (tintAmt) c = mix3(c, tint, tintAmt);
    return c;
  };
  const ny = Math.max(3, Math.ceil(h / p));
  const rowH = h / ny;
  const zs = (y) => (y < hs && !flo ? -(hs - y) * 0.9 : 0);          // scree comes toward the camera
  // front face
  for (let j = 0; j < ny; j++) {
    const y = (j + 0.5) * rowH;
    const hw = halfW(y);
    const nu = Math.max(1, Math.round(2 * hw / p));
    for (let i = 0; i < nu; i++) {
      const u = -hw + (i + 0.5 + (rng() - 0.5) * 0.4) * 2 * hw / nu;
      const ht = top(u);
      if (y > ht) continue;
      const c = colorAt(y, u, 0);
      out(x + u, y0 + y, -(d + zs(y) + (rng() - 0.5) * p * 0.4), 2 * hw / nu * 0.62, rowH * 0.62, p * 0.25, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
    if (out.due()) yield;
  }
  // a crisp crest: one row of splats on the outline itself
  {
    const nu = Math.max(2, Math.round(w / p));
    for (let i = 0; i < nu; i++) {
      const u = -w / 2 + (i + 0.5) * w / nu;
      const ht = top(u);
      const c = colorAt(ht - rowH * 0.3, u, 0);
      out(x + u, y0 + ht - rowH * 0.25, -d, w / nu * 0.62, rowH * 0.5, p * 0.25, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
  }
  // the two ends, seen at an angle as the train passes
  const pd = p * 1.7;
  const nt = Math.max(1, Math.round(dep / pd));
  for (const side of [-1, 1]) {
    for (let j = 0; j < ny; j++) {
      const y = (j + 0.5) * rowH;
      const hw = halfW(y);
      if (y > top(side * hw)) continue;
      for (let t = 0; t < nt; t++) {
        const c = colorAt(y, side * hw, side);
        out(x + side * hw * (1 - 0.0 * t), y0 + y, -(d + (t + 0.5) * dep / nt), p * 0.2, rowH * 0.62, dep / nt * 0.62, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
      }
      if (out.due()) yield;
    }
  }
}

// A low dune or alluvial fan: a flat dome of discs shaded by slope, with ripples.
function* dome(ctx, out, x, d, rx, ry, rz, rng, col, n) {
  const y0 = groundY(ctx, x, d);
  const s = Math.max(Math.sqrt(Math.PI * rx * rz / n) * 0.95, 0.4);
  for (let i = 0; i < n; i++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 0.98;
    const hh = ry * Math.pow(1 - r * r, 0.75);
    const dh = -1.5 * ry * r * Math.pow(1 - r * r + 1e-3, -0.25);
    const hx = dh * Math.cos(a) / rx, hd = dh * Math.sin(a) / rz;
    const nn = norm3(-hx, 1, hd);
    const q = quatUpTo(nn[0], nn[1], nn[2]);
    const rip = 0.94 + 0.1 * Math.sin((x + Math.cos(a) * r * rx) / 7 + Math.sin(d / 40));
    let c = mul3(shade(col, nn[0], nn[1], nn[2], 0.62, 0.5), rip);
    c = jitter(c, rng, 0.05);
    out.q(x + Math.cos(a) * r * rx, y0 + hh, -(d + Math.sin(a) * r * rz), s, s * 0.35, s * 0.9, c, 1, q, KIND.GROUND);
    if (out.due()) yield;
  }
}

// A far range: a vertical curtain of splats at distance d whose top edge is a world-x profile with
// ridged crests, strata bands by height and facets shaded by the profile slope. Gaps in the
// envelope leave long stretches of empty horizon.
//   o: { d, H (max height m), l1 (feature length), lenv (group length), gapLo, gapHi, salt, n, cols }
function* rangeWall(ctx, out, o) {
  const wsd = worldSeed(ctx);
  const prof = (wx) => {
    const n1 = noise1(wx / o.l1, wsd + o.salt), n2 = noise1(wx / (o.l1 * 0.23), wsd + o.salt + 1), n3 = noise1(wx / (o.l1 * 0.06), wsd + o.salt + 2);
    const rid = 1 - Math.abs(2 * (n1 * 0.55 + n2 * 0.3 + n3 * 0.15) - 1);
    const env = smooth(o.gapLo, o.gapHi, noise1(wx / o.lenv, wsd + o.salt + 7));
    return o.H * env * (0.12 + 0.88 * Math.pow(rid, 1.5));
  };
  const d = o.d;
  const rng = worldRng(ctx, 500, o.salt, ctx.index);        // chunk-local jitter only; the shape is world-hashed
  // columns across the chunk (plus a margin), pitch from the budget
  const colsN = Math.max(8, Math.round(Math.sqrt(o.n * ctx.length / (o.H * 0.6 + 1))));
  const dx = (ctx.length + 20) / colsN;
  const band = o.H * 0.06;
  for (let i = 0; i < colsN; i++) {
    // world-aligned columns: the same wx grid in every chunk
    const wx = (Math.floor((ctx.x0 - 10) / dx) + i) * dx + dx * 0.5;
    const H = prof(wx);
    if (H < 8) continue;
    const g = (prof(wx + dx) - prof(wx - dx)) / (2 * dx);
    const nrows = Math.max(2, Math.round(H / (o.H / (o.n / colsN))));
    const rowH = H / nrows;
    for (let j = 0; j < nrows; j++) {
      const y = (j + 0.5) * rowH;
      const bi = Math.floor((y + 40 * noise1(wx / 3000, wsd + o.salt + 9)) / band);
      const warm = smooth(0.35, 0, y / o.H);
      let c = mix3(o.cols[((bi % o.cols.length) + o.cols.length) % o.cols.length], [0.5, 0.36, 0.38], warm * 0.5);
      c = mul3(c, 0.88 + 0.24 * (hashInts(wsd, o.salt, bi) / 4294967296));
      c = shade(c, -clamp(g * 1.4, -1, 1), 0.15, 1, 0.55, 0.55);
      c = jitter(c, rng, 0.06);
      const x = wx - ctx.x0;
      out(x, y, -d, dx * 0.7, rowH * 0.62, d * 0.01, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.ROCK);
    }
    // crisp crest splat
    const c = shade(o.cols[0], -clamp(g * 1.4, -1, 1), 0.3, 1, 0.55, 0.55);
    out(wx - ctx.x0, H - 0.1 * rowH, -d, dx * 0.7, rowH * 0.5, d * 0.01, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.ROCK);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Roads and fences: lines in world space that cross every band
// ---------------------------------------------------------------------------------------------
const RCELL = 7200;
function roadIn(ctx, i) {
  const wsd = worldSeed(ctx);
  const h = (k) => hashInts(wsd, 600, i, k) / 4294967296;
  if (h(0) > 0.62) return null;
  const sx = i * RCELL + h(1) * 1200, len = 3200 + 3200 * h(2);
  const slope = (0.012 + 0.07 * h(3)) * (h(4) < 0.55 ? 1 : -1);
  const d0 = slope > 0 ? 50 + 110 * h(5) : 160 + 700 * h(5);
  return { i, sx, ex: sx + len, slope, d0, fence: h(6) < 0.6, fence2: h(7) < 0.25, id: h(8) };
}
const roadD = (r, wx) => r.d0 + r.slope * (wx - r.sx);

function* roads(ctx, out, dLo, dHi) {
  const a = Math.floor((ctx.x0 - 100) / RCELL), b = Math.floor((ctx.x0 + ctx.length + 100) / RCELL);
  for (let i = a - 1; i <= b; i++) {
    const r = roadIn(ctx, i);
    if (!r || r.ex < ctx.x0 - 100 || r.sx > ctx.x0 + ctx.length + 100) continue;
    const q = quatYaw(Math.atan2(r.slope, 1));
    for (let wx = Math.max(r.sx, ctx.x0 - 3) ; wx < Math.min(r.ex, ctx.x0 + ctx.length + 3); ) {
      const d = roadD(r, wx);
      const wid = 2.2 + 1.4 * smooth(0, 1, 0);       // half-width of the dirt road
      const step = clamp(0.0035 * d, 0.5, 40) / Math.min(1, Math.sqrt(out.density));
      if (d >= dLo && d < dHi && d > 36) {
        const x = wx - ctx.x0;
        const y = groundY(ctx, x, d);
        const k = 0.93 + 0.12 * noise1(wx / 7, 17);
        const c = mul3([0.66, 0.55, 0.42], k);
        const hw = Math.max(wid, 0.003 * d);
        out(x, y + lift(d) * 0.5, -d, step * 0.75, 0.008, hw, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND);
        // wheel ruts
        for (const off of [-0.45, 0.45]) {
          const cr = mul3(c, 0.78);
          out(x, y + lift(d) * 0.8, -(d + off * hw * 0.6), step * 0.75, 0.008, hw * 0.1, cr[0], cr[1], cr[2], 0.9, q[0], q[1], q[2], q[3], KIND.GROUND);
        }
      }
      wx += step;
      if (out.due()) yield;
    }
  }
}

// A post-and-wire fence beside each road, posts every 4.6 m of world x, converging with it.
function* roadFences(ctx, out, dLo, dHi) {
  const a = Math.floor((ctx.x0 - 100) / RCELL), b = Math.floor((ctx.x0 + ctx.length + 100) / RCELL);
  const P = 4.6;
  for (let i = a - 1; i <= b; i++) {
    const r = roadIn(ctx, i);
    if (!r || (!r.fence && !r.fence2)) continue;
    const sides = r.fence2 ? [5.0, -5.0] : [5.0];
    for (const off of sides) {
      const k0 = Math.ceil(Math.max(r.sx, ctx.x0 - 5) / P), k1 = Math.floor(Math.min(r.ex, ctx.x0 + ctx.length + 5) / P);
      for (let k = k0; k <= k1; k++) {
        const wx = k * P, d = roadD(r, wx) + off;
        if (d < Math.max(dLo, 34) || d >= dHi) continue;
        const x = wx - ctx.x0, y0 = groundY(ctx, x, d);
        const pr = Math.max(0.05, 0.0012 * d), hgt = 1.2;
        const lean = (hashInts(worldSeed(ctx), 81, k) & 255) / 255 - 0.5;
        for (let t = 0.1; t < hgt; t += Math.max(0.22, pr * 3)) out(x + lean * 0.1 * t, y0 + t, -d, pr, Math.max(0.12, pr * 1.5), pr, 0.34, 0.28, 0.22, 1, 0, 0, 0, 1, KIND.FENCE);
        // wire strands to the next post
        const d2 = roadD(r, wx + P) + off;
        for (const fy of [0.45, 0.8, 1.15]) {
          const wr = Math.max(0.012, 0.0008 * d);
          const nseg = Math.max(2, Math.round(P / (0.5 + 0.004 * d)));
          for (let s = 0; s < nseg; s++) {
            const f = (s + 0.5) / nseg;
            const dd = lerp(d, d2, f), xx = x + f * P;
            out(xx, groundY(ctx, xx, dd) + fy - 0.04 * Math.sin(f * Math.PI), -dd, P / nseg * 0.62, wr, wr, 0.4, 0.38, 0.34, 0.85, 0, 0, 0, 1, KIND.FENCE);
          }
        }
        if (out.due()) yield;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------------------------
const dials = (ctx) => ctx.dials || {};
const night = (ctx) => ctx.hour != null && (ctx.hour >= 19.5 || ctx.hour < 5.5);

function* trackside(ctx, emit) {
  const out = makeOut(ctx, emit, { zMargin: 1, detailK: 1.2 });
  const N = ctx.count;
  const wsd = worldSeed(ctx);
  out.limit = N * 0.6;
  // the pole line: rhythm. Posts at exactly k * beatMetres of world x with wires sagging between.
  yield* poleLine(ctx, out, 13.0);
  // tyre tracks and the cracked crust
  yield* tyreTracks(ctx, out);
  // mile markers, sleepers, signs
  for (const { i, wx0 } of cellsAround(ctx, 1609, 5)) {
    const x = wx0 + 805 - ctx.x0;
    if (x > -5 && x < ctx.length + 5) yield* mileMarker(ctx, out, x, 8.2);
  }
  for (const { i, wx0 } of cellsAround(ctx, 90, 6)) {
    const r = worldRng(ctx, 21, i);
    if (r() < 0.2) yield* sleeperStack(ctx, out, wx0 + r() * 90 - ctx.x0, 9 + 7 * r(), r);
    else if (r() < 0.06) yield* rustSign(ctx, out, wx0 + r() * 90 - ctx.x0, 8.5 + 2 * r(), r);
  }
  // scrub and tumbleweed, in stretches
  for (const { i, wx0 } of cellsAround(ctx, 8, 4)) {
    const dens = smooth(0.35, 0.75, noise1(wx0 / 320, wsd + 43));
    const r = worldRng(ctx, 17, i);
    if (r() > 0.1 + 0.6 * dens) continue;
    const d = 8 + 22 * Math.pow(r(), 1.4), wx = wx0 + r() * 8;
    if (r() < 0.12) yield* tumbleweed(ctx, out, wx - ctx.x0, d, 0.4 + 0.3 * r(), r);
    else yield* shrub(ctx, out, wx - ctx.x0, d, 0.9 + 1.3 * r(), 0.5 + 0.6 * r(), r, 6, SHRUBS[Math.floor(r() * SHRUBS.length)]);
  }
  // crust cracks
  out.limit = N * 0.75;
  yield* cracks(ctx, out, { S: TIER_S[0], salt: 900, dLo: 6.5, dHi: 30 + 1 });
  out.limit = N * 0.85;
  yield* streaks(ctx, out, Math.round(N * 0.09));
  // ground: ballast and cess (mostly below the window), then the flat
  const rest = out.left();
  yield* fillGround(ctx, out, {
    n: Math.round(rest * 0.03), dNear: 2.5, dFar: 4.4, power: 0, cover: 3.5, slope: false,
    color: (wx, d, rng) => (d < 3.4 ? jitter(PAL.ballast, rng, 0.25) : jitter([0.42, 0.38, 0.32], rng, 0.2)),
  });
  yield* fillGround(ctx, out, {
    n: Math.round(rest * 0.07), dNear: 4.6, dFar: 7.4, power: 0, cover: 4, slope: false, flat: 0.4,
    color: (wx, d, rng) => jitter(mix3([0.55, 0.5, 0.42], [0.62, 0.56, 0.46], noise2(wx / 3, d, wsd)), rng, 0.15),
  });
  yield* fillGround(ctx, out, {
    dNear: 7.2, dFar: ctx.zFar + 1, power: 1.3, cover: 4.5, slope: false, maxR: 0.025,
    color: (wx, d, rng) => flatColor(ctx, wx, d, rng),
  });
}

function* near(ctx, emit) {
  const out = makeOut(ctx, emit, { detailK: 1.2 });
  const N = ctx.count;
  const dz = dials(ctx);
  const wsd = worldSeed(ctx);
  out.limit = N * 0.7;
  // roads and fences
  yield* roads(ctx, out, ctx.zNear, ctx.zFar);
  yield* roadFences(ctx, out, ctx.zNear, ctx.zFar);
  // landmarks: one chance per 800 m of world x
  for (const { i, wx0 } of cellsAround(ctx, 800, 60)) {
    const r = worldRng(ctx, 31, i);
    const present = r(), type = r(), dd = r(), xx = r();
    if (present > 0.5 * (0.3 + smooth(0.2, 0.6, noise1(wx0 / 5000, wsd + 51)) * 1.4)) continue;
    const wx = wx0 + 100 + xx * 600, x = wx - ctx.x0;
    if (type < 0.2) yield* waterTower(ctx, out, x, 55 + 95 * dd, r);
    else if (type < 0.4) yield* windmill(ctx, out, x, 48 + 90 * dd, r);
    else if (type < 0.58) yield* shack(ctx, out, x, 60 + 150 * dd, r, night(ctx));
    else if (type < 0.74) yield* oldCar(ctx, out, x, 45 + 130 * dd, r);
    else if (type < 0.84) yield* siding(ctx, out, x, 33.5, 70 + 90 * dd, r);
    else yield* rock(ctx, out, x, 50 + 200 * dd, 1.5 + 2.5 * r(), { rng: r, color: jitter([0.48, 0.38, 0.3], r, 0.12) });
  }
  // level 1 (logic): the same water tower again and again, a little more wrong each time
  if (dz.logic > 0) {
    const P = 520;
    for (const { i, wx0 } of cellsAround(ctx, P, 20)) {
      if (noise1(wx0 / 3000, wsd + 123) > 0.2 + dz.logic * 1.5) continue;
      const wrong = (((i % 5) + 5) % 5) / 4;
      yield* waterTower(ctx, out, wx0 + P * 0.5 - ctx.x0, 78, worldRng(ctx, 778), wrong * Math.min(1, dz.logic * 2.5), 1 + 0.06 * wrong);
    }
  }
  // isolated rocks
  for (const { i, wx0 } of cellsAround(ctx, 70, 6)) {
    const r = worldRng(ctx, 33, i);
    if (r() > 0.28) continue;
    const d = 35 * Math.pow(8.5, r());
    const x = wx0 + r() * 70 - ctx.x0;
    yield* rock(ctx, out, x, d, 0.5 + 1.4 * r(), { rng: r, color: jitter([0.5, 0.4, 0.32], r, 0.15), n: Math.max(3, Math.round(8 * Math.sqrt(out.density))) });
  }
  // crust cracks: two tiers, thinning outward
  out.limit = N * 0.7 + N * 0.12;
  yield* cracks(ctx, out, { S: TIER_S[1], salt: 901, dLo: 30, dHi: 175, stepK: 1.2 });
  out.limit = N * 0.7 + N * 0.18;
  yield* cracks(ctx, out, { S: TIER_S[2], salt: 902, dLo: 150, dHi: 330, stepK: 1.5 });
  // scrub: creosote and sage, thinning with distance (density falls as d^-0.6), clustered by world noise
  const nS = Math.round(N * 0.07);
  const rng = ctx.rng;
  out.limit = N * 0.88;
  const A = Math.pow(ctx.zNear, 0.4), B = Math.pow(ctx.zFar, 0.4);
  for (let k = 0; k < nS; k++) {
    const d = Math.pow(A + rng() * (B - A), 1 / 0.4);
    const x = rng() * ctx.length, wx = ctx.x0 + x;
    const cl = noise2(wx / 150, d / 150, wsd + 61);
    if (rng() > 0.25 + 1.5 * cl * cl) continue;
    const sz = 0.7 + 1.5 * rng();
    yield* shrub(ctx, out, x, d, sz, 0.35 + 0.5 * rng(), rng, d < 90 ? 6 : d < 170 ? 3 : 1, SHRUBS[Math.floor(rng() * SHRUBS.length)]);
  }
  yield* fillGround(ctx, out, { power: 1.4, cover: 3.2, slope: false, maxR: 0.03, color: (wx, d, rng) => flatColor(ctx, wx, d, rng) });
}

function* mid(ctx, emit) {
  const out = makeOut(ctx, emit, { detailK: 1.5 });
  const N = ctx.count;
  const dz = dials(ctx);
  const wsd = worldSeed(ctx);
  out.limit = N * 0.78;
  yield* roads(ctx, out, ctx.zNear, ctx.zFar);
  // buttes and mesas in groups: cells of 1100 m of x, gated by a slow world noise so there are gaps
  const CELL = 1100;
  for (const { i, wx0 } of cellsAround(ctx, CELL, 450)) {
    const r = worldRng(ctx, 91, i);
    const present = r(), cx = r(), cd = r(), kind = r();
    const sparse = noise1(wx0 / 5200, wsd + 95);
    if (present > 0.12 + 0.75 * smooth(0.3, 0.6, sparse)) continue;
    const d = 380 * Math.pow(7.2, cd), wx = wx0 + cx * CELL;
    const gseed = Math.floor(r() * 1e6);
    const scaleK = d / 1500;
    // a main mesa
    const w = (120 + 260 * r()) * (0.5 + scaleK), h = (45 + 95 * r() * r()+ 30 * r()) * (0.7 + 0.7 * scaleK);
    if (dz.topology > 0 && r() < dz.topology * 0.6) {
      // floating mesa: lifted well above the flat, scree hanging below
      yield* mesa(ctx, out, wx - ctx.x0, d, { w: w * 0.7, h: h * 1.1, rng: r, seed: gseed, float: true, lift: 110 + 260 * r() * dz.topology, kind: KIND.SURREAL, tint: SKY_LOW, tintAmt: 0.1 * smooth(300, 3000, d) });
    } else {
      yield* mesa(ctx, out, wx - ctx.x0, d, { w, h, rng: r, seed: gseed, tint: [0.62, 0.56, 0.62], tintAmt: 0.25 * smooth(500, 3000, d) });
    }
    // satellites: buttes and a spire or two
    const nb = Math.floor(r() * 4);
    for (let b = 0; b < nb; b++) {
      const bw = 30 + 70 * r(), bh = h * (0.5 + 0.8 * r());
      yield* mesa(ctx, out, wx + (r() - 0.5) * 1000 - ctx.x0, d * (0.85 + 0.3 * r()), { w: bw, h: bh, dep: bw, rng: r, seed: Math.floor(r() * 1e6), skirt: 0.35, tint: [0.62, 0.56, 0.62], tintAmt: 0.25 * smooth(500, 3000, d) });
    }
    void kind;
  }
  // level 1 (scale): a needle of impossible height
  if (dz.scale > 0) {
    for (const { i, wx0 } of cellsAround(ctx, 6000, 200)) {
      const r = worldRng(ctx, 97, i);
      if (r() > 0.55 * dz.scale) continue;
      yield* mesa(ctx, out, wx0 + r() * 6000 - ctx.x0, 1100 + 1200 * r(), { w: 90 + 60 * r(), h: 600 + 900 * dz.scale * r(), rng: r, seed: Math.floor(r() * 1e6), kind: KIND.SURREAL, maxN: 1400 * out.density, skirt: 0.2, tint: [0.62, 0.56, 0.62], tintAmt: 0.2 });
    }
  }
  // dunes and alluvial fans at the edge of the flat
  for (const { i, wx0 } of cellsAround(ctx, 600, 300)) {
    const r = worldRng(ctx, 93, i);
    if (r() > 0.5) continue;
    const d = 330 * Math.pow(6, r() * r()), wx = wx0 + r() * 600;
    const rx = 80 + 220 * r(), ry = 3 + 7 * r(), rz = 50 + 140 * r();
    const dune = mix3([0.7, 0.6, 0.45], [0.74, 0.7, 0.6], r());
    yield* dome(ctx, out, wx - ctx.x0, d, rx, ry, rz, r, dune, Math.max(20, Math.round(160 * Math.sqrt(out.density))));
  }
  // the highway: a pale line with its own pole line, at a world-fixed distance that wanders
  {
    const step = 22 / Math.min(1, Math.sqrt(out.density));
    const hd = (wx) => 1250 + 380 * Math.sin(wx / 9000 + wsd % 7) + 120 * noise1(wx / 1500, wsd + 77);
    for (let x = step / 2; x < ctx.length; x += step) {
      const d = hd(ctx.x0 + x);
      const y = groundY(ctx, x, d);
      out(x, y + lift(d) * 0.2, -d, step * 0.7, 0.01, 4, 0.48, 0.47, 0.45, 1, 0, 0, 0, 1, KIND.GROUND);
    }
    const P = 70;
    for (const { i, x } of cellsAround(ctx, P, 0)) {
      const wx = i * P, d = hd(wx) + 14;
      yield* stick(ctx, out, x, groundY(ctx, x, d), d, 9, 0.35, { color: [0.36, 0.3, 0.24], kind: KIND.OTHER, n: 3 });
      out(x, groundY(ctx, x, d) + 8.6, -d, 0.2, 0.18, 1.2, 0.34, 0.28, 0.22, 1, 0, 0, 0, 1, KIND.OTHER);
    }
  }
  // scrub speckle on the flat: dark specks that give the mid ground texture
  out.limit = N * 0.86;
  const rng = ctx.rng;
  for (let k = 0; k < N * 0.06; k++) {
    const d = 320 + 2400 * Math.pow(rng(), 1.8), x = rng() * ctx.length;
    const cl = noise2((ctx.x0 + x) / 400, d / 400, wsd + 66);
    if (rng() > 0.2 + 1.3 * cl * cl) continue;
    const s = 0.003 * d * (0.6 + 0.8 * rng());
    const c = mul3(flatColor(ctx, ctx.x0 + x, d, rng, { noCells: true }), 0.62 + 0.15 * rng());
    out(x, groundY(ctx, x, d) + lift(d) * 0.3, -d, s * 1.6, s * 0.3, s, c[0], c[1], c[2], 0.9, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
  yield* fillGround(ctx, out, { power: 1.3, cover: 3, maxR: 0.03, slope: false, color: (wx, d, rng) => flatColor(ctx, wx, d, rng) });
}

function* far(ctx, emit) {
  const out = makeOut(ctx, emit);
  const N = ctx.count;
  const dz = dials(ctx);
  const wsd = worldSeed(ctx);
  out.limit = N * 0.85;
  const VIO = [[0.36, 0.34, 0.5], [0.42, 0.38, 0.52], [0.32, 0.31, 0.46], [0.46, 0.4, 0.5], [0.38, 0.36, 0.52]];
  // the range: layered curtains, near ones lower and darker, far ones taller and paler
  const layers = [
    { d: 5400, H: 460, l1: 2200, lenv: 6500, gapLo: 0.42, gapHi: 0.6, salt: 3010, w: 0.2, cols: VIO },
    { d: 7600, H: 820, l1: 3000, lenv: 8000, gapLo: 0.4, gapHi: 0.58, salt: 3020, w: 0.3, cols: VIO.map((c) => mix3(c, [0.5, 0.48, 0.62], 0.2)) },
    { d: 10400, H: 1250, l1: 4200, lenv: 9500, gapLo: 0.4, gapHi: 0.56, salt: 3030, w: 0.28, cols: VIO.map((c) => mix3(c, [0.52, 0.52, 0.68], 0.35)) },
    { d: 13000, H: 1700, l1: 5600, lenv: 11000, gapLo: 0.42, gapHi: 0.58, salt: 3040, w: 0.22, cols: VIO.map((c) => mix3(c, [0.56, 0.58, 0.74], 0.5)) },
  ];
  for (const L of layers) {
    // the further layers are drawn with their own budget share, scaled by this chunk's length share
    yield* rangeWall(ctx, out, { ...L, n: Math.max(60, N * 0.6 * L.w) });
  }
  // big mesas: flat tops, strata, long gaps between groups
  for (const { i, wx0 } of cellsAround(ctx, 4800, 1800)) {
    const r = worldRng(ctx, 111, i);
    const present = r(), cx = r(), cd = r();
    if (present > 0.12 + 0.7 * smooth(0.3, 0.62, noise1(wx0 / 14000, wsd + 112))) continue;
    const d = 3600 + 4800 * cd, wx = wx0 + cx * 4800;
    const w = 900 + 2400 * r(), h = 240 + 460 * r();
    const tintAmt = 0.4;
    if (dz.topology > 0 && r() < dz.topology * 0.5) {
      yield* mesa(ctx, out, wx - ctx.x0, d, { w: w * 0.6, h: h * 0.8, rng: r, seed: Math.floor(r() * 1e6), float: true, lift: 500 + 900 * r() * dz.topology, kind: KIND.SURREAL, maxN: 900 * out.density, tint: [0.5, 0.48, 0.64], tintAmt });
    } else {
      yield* mesa(ctx, out, wx - ctx.x0, d, { w, h, rng: r, seed: Math.floor(r() * 1e6), maxN: 1100 * out.density, tint: [0.46, 0.42, 0.6], tintAmt });
    }
    const nb = Math.floor(r() * 3);
    for (let b = 0; b < nb; b++) yield* mesa(ctx, out, wx + (r() - 0.5) * 3000 - ctx.x0, d * (0.9 + 0.2 * r()), { w: 160 + 360 * r(), h: h * (0.5 + 0.5 * r()), rng: r, seed: Math.floor(r() * 1e6), skirt: 0.35, maxN: 400 * out.density, tint: [0.46, 0.42, 0.6], tintAmt });
  }
  if (dz.scale > 0) {
    // a monolith on the skyline and a mesa of impossible height
    for (const { i, wx0 } of cellsAround(ctx, 11000, 500)) {
      const r = worldRng(ctx, 121, i);
      if (r() > 0.7 * dz.scale) continue;
      yield* monolith(ctx, out, wx0 + 1500 + r() * 8000 - ctx.x0, 4200 + r() * 3500, { w: 160 + 80 * r(), h: 1100 + 1400 * r() * dz.scale, color: [0.3, 0.22, 0.24], rng: r, n: Math.round(420 * Math.sqrt(out.density)) });
    }
    for (const { i, wx0 } of cellsAround(ctx, 16000, 2500)) {
      const r = worldRng(ctx, 123, i);
      if (r() > 0.5 * dz.scale) continue;
      yield* mesa(ctx, out, wx0 + 2000 + r() * 12000 - ctx.x0, 6000 + 4000 * r(), { w: 1400 + 900 * r(), h: 1700 + 1800 * dz.scale * r(), rng: r, seed: Math.floor(r() * 1e6), kind: KIND.SURREAL, maxN: 1300 * out.density, skirt: 0.2, tint: [0.46, 0.42, 0.6], tintAmt: 0.4 });
    }
  }
  // the ground out here: the pale flat and, past 5 km, the foothills the terrain raises
  yield* fillGround(ctx, out, {
    power: 1.0, cover: 2.6, maxR: 0.03, slope: false,
    color: (wx, d, rng, x, y) => {
      let c = flatColor(ctx, wx, d, rng, { noCells: true });
      if (y > 20) {
        // foothills: strata by height, blue-violet
        const bi = Math.floor(y / 45);
        const base = VIO[((bi % VIO.length) + VIO.length) % VIO.length];
        c = mix3(c, mul3(base, 0.9 + 0.2 * (hashInts(wsd, 3, bi) / 4294967296)), smooth(20, 90, y));
      }
      return c;
    },
  });
}

export const saltflatBiome = {
  name: 'saltflat',
  palette: PAL,
  // Nearly flat everywhere: the mid and far bands read only through objects that rise (mesas,
  // buttes, dunes, poles) and the range; the terrain's own relief starts far away.
  terrain: { cutting: 0.8, roll: 1.2, rollScale: 900, rise: 0.004, hills: 30, hillScale: 4000, mountains: 1400, mountainScale: 9000, mountainStart: 5000 },
  hazeDist: 10500,
  generators: { trackside, near, mid, far },
};
