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
import { hashInts, hashString, makeRng, noise1, noise2 } from '../rng.js';
import { makeTerrain } from '../terrain.js';
import {
  KIND, MOVE, makeOut, worldSeed, worldRng, worldHash, cellsAround, groundY, fillGround, blob, stick, wires, rock,
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
// Shape helpers: oriented panels, boxes, tubes, cones, wheels, shaped splats
// ---------------------------------------------------------------------------------------------

// Rotation whose x axis is the unit vector a and whose y axis is b made perpendicular to it.
function quatBasis(ax, ay, az, bx, by, bz) {
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
// Thickness of a limb, pole or wire at distance d: never much under a pixel at 1080p.
const limb = (r, d) => Math.max(r, 0.0007 * d);
// A shaped splat: an ellipsoid with radius a along the direction (ux, uy, uz), b and c across it.
function ell(out, x, y, z, a, b, c, ux, uy, uz, col, kind, o = 1) {
  const ul = Math.hypot(ux, uy, uz) || 1;
  const q = Math.abs(uy / ul) > 0.98 ? quatBasis(ux / ul, uy / ul, uz / ul, 1, 0, 0) : quatBasis(ux / ul, uy / ul, uz / ul, 0, 1, 0);
  out(x, y, z, a, b, c, col[0], col[1], col[2], o, q[0], q[1], q[2], q[3], kind);
}
// An `out` that tags every splat with a motion class (kit.js MOVE): strut() and out.q have no slot.
function withMove(out, move) {
  const m = (x, y, z, sx, sy, sz, r, g, b, o = 1, qx = 0, qy = 0, qz = 0, qw = 1, kind = KIND.OTHER) => out(x, y, z, sx, sy, sz, r, g, b, o, qx, qy, qz, qw, kind, move);
  m.q = (x, y, z, sx, sy, sz, c, o, q, k) => out(x, y, z, sx, sy, sz, c[0], c[1], c[2], o, q ? q[0] : 0, q ? q[1] : 0, q ? q[2] : 0, q ? q[3] : 1, k, move);
  m.due = out.due; m.left = out.left; m.density = out.density; m.detailK = out.detailK; m.ctx = out.ctx;
  Object.defineProperty(m, 'n', { get: () => out.n });
  Object.defineProperty(m, 'limit', { get: () => out.limit, set: (v) => { out.limit = v; } });
  return m;
}
// How the three faces a passing train sees are lit: the west end (-x) in sun, the front a little
// less, the east end in shade (as kit house()), so a box reads as a box from either side.
function wallTone(nx, nz) { return 0.62 + 0.38 * Math.max(0, -nx) + 0.22 * Math.max(0, nz) - 0.06 * Math.max(0, nx); }

// A flat rectangle: corner o (splat space), unit vectors e, f along its sides U and V metres long,
// splats about s apart (overlapping: centres 1.4 radii apart). colorAt(u, v) -> colour or null for
// a hole; a colour with a 4th element true is a light.
function* panel(out, o, e, f, U, V, s, colorAt, kind, rng, opacity = 1) {
  const nu = Math.max(1, Math.round(U / s)), nv = Math.max(1, Math.round(V / s));
  const q = quatBasis(e[0], e[1], e[2], f[0], f[1], f[2]);
  const th = Math.max(0.02, Math.min(U / nu, V / nv) * 0.15);
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = (i + 0.5 + (rng() - 0.5) * 0.2) / nu, b = (j + 0.5 + (rng() - 0.5) * 0.2) / nv;
      const c = colorAt(a * U, b * V);
      if (!c) continue;
      out(o[0] + e[0] * a * U + f[0] * b * V, o[1] + e[1] * a * U + f[1] * b * V, o[2] + e[2] * a * U + f[2] * b * V,
        (U / nu) * 0.72, (V / nv) * 0.72, th, c[0], c[1], c[2], opacity, q[0], q[1], q[2], q[3], c[3] ? KIND.LIGHT : kind);
    }
    if (out.due()) yield;
  }
}
// A closed box standing on the ground: centre of its base (x, yb, d) (chunk-local x), length L
// along the ground direction (ex, ed) (in x and distance), width Wd across, height Hh. Every face
// that can turn towards the line is drawn (the far long side never does), and the top.
//   o: { top (colour, or false), colorAt(face, u, v, col) -> colour (faces: 0 near side, 1 far side,
//        2 back end, 3 front end, 4 top) }
function* box(out, x, yb, d, ex, ed, L, Wd, Hh, col, s, kind, rng, o = {}) {
  const fx = -ed, fd = ex;                       // across, in (x, d): points away from the line when ex > 0
  const P = (a, b, h) => [x + ex * a + fx * b, yb + h, -(d + ed * a + fd * b)];
  const faces = [
    [P(-L / 2, -Wd / 2, 0), [ex, 0, -ed], L, [-fx, fd]],
    [P(-L / 2, Wd / 2, 0), [ex, 0, -ed], L, [fx, -fd]],
    [P(-L / 2, -Wd / 2, 0), [fx, 0, -fd], Wd, [-ex, ed]],
    [P(L / 2, -Wd / 2, 0), [fx, 0, -fd], Wd, [ex, -ed]],
  ];
  for (let k = 0; k < 4; k++) {
    const [org, e, U, nrm] = faces[k];
    if (nrm[1] < -0.35) continue;                 // turned right away from the line: never seen
    const cc = mul3(col, wallTone(nrm[0], nrm[1]));
    yield* panel(out, org, e, [0, 1, 0], U, Hh, s, o.colorAt ? (u, v) => o.colorAt(k, u, v, cc) : () => cc, kind, rng);
  }
  if (o.top !== false) {
    const tc = o.top || mul3(col, 1.08);
    yield* panel(out, P(-L / 2, -Wd / 2, Hh), [ex, 0, -ed], [fx, 0, -fd], L, Wd, s, o.colorAt ? (u, v) => o.colorAt(4, u, v, tc) : () => tc, kind, rng);
  }
}
// The surface of a cylinder from A to B (splat-space points) of radius R, splats about s apart,
// lying on the surface and shaded by its normal; the half turned away from the line is left out.
// o: { caps (draw the end discs), capCol, rib (period in metres of darker bands) }
function* tube(out, A, B, R, col, s, kind, rng, o = {}) {
  const dx = B[0] - A[0], dy = B[1] - A[1], dz = B[2] - A[2], len = Math.hypot(dx, dy, dz) || 1e-6;
  const ax = [dx / len, dy / len, dz / len];
  // u1: across the axis and level (or along x for an upright tube), u2 completes the frame
  let u1 = Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [-ax[2], 0, ax[0]];
  const l1 = Math.hypot(u1[0], u1[1], u1[2]) || 1; u1 = [u1[0] / l1, u1[1] / l1, u1[2] / l1];
  const u2 = [ax[1] * u1[2] - ax[2] * u1[1], ax[2] * u1[0] - ax[0] * u1[2], ax[0] * u1[1] - ax[1] * u1[0]];
  const na = clamp(Math.round((2 * Math.PI * R) / s), 6, 40), nl = Math.max(1, Math.round(len / s));
  const arc = (2 * Math.PI * R) / na;
  for (let j = 0; j < nl; j++) {
    const t = (j + 0.5) / nl;
    const rib = o.rib ? (Math.floor((t * len) / o.rib) % 2 ? 0.9 : 1.03) : 1;
    for (let i = 0; i < na; i++) {
      const a = ((i + 0.5) / na) * 2 * Math.PI;
      const ca = Math.cos(a), sa = Math.sin(a);
      const n = [ca * u1[0] + sa * u2[0], ca * u1[1] + sa * u2[1], ca * u1[2] + sa * u2[2]];
      if (n[2] < -0.6) continue;
      const tg = [-sa * u1[0] + ca * u2[0], -sa * u1[1] + ca * u2[1], -sa * u1[2] + ca * u2[2]];
      const q = quatBasis(ax[0], ax[1], ax[2], tg[0], tg[1], tg[2]);
      const c = jitter(mul3(shade(col, n[0], n[1], n[2], 0.55, 0.55), rib), rng, 0.04);
      out(A[0] + dx * t + n[0] * R, A[1] + dy * t + n[1] * R, A[2] + dz * t + n[2] * R, (len / nl) * 0.72, arc * 0.72, Math.max(0.02, Math.min(arc, len / nl) * 0.15),
        c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind);
    }
    if (out.due()) yield;
  }
  if (o.caps) {
    const cc = o.capCol || mul3(col, 0.8);
    const q = quatBasis(u1[0], u1[1], u1[2], u2[0], u2[1], u2[2]);
    for (const [P, sg] of [[A, -1], [B, 1]]) {
      if (ax[2] * sg < -0.6) continue;
      const c = shade(cc, ax[0] * sg, ax[1] * sg, ax[2] * sg, 0.6, 0.45);
      out(P[0], P[1], P[2], R, R, Math.max(0.03, R * 0.08), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind);
    }
  }
}

// A cone (a salt pile, a sinter mound, a pyramid roof): base centre (x, y0, z), radius R, height H.
function* cone(out, x, y0, z, R, H, col, s, kind, rng, o = {}) {
  const L = Math.hypot(R, H);
  const nh = Math.max(2, Math.round(L / s));
  for (let j = 0; j < nh; j++) {
    const t = (j + 0.5) / nh, r = R * (1 - t), y = y0 + H * t;
    const na = clamp(Math.round((2 * Math.PI * r) / s), 3, 48);
    for (let i = 0; i < na; i++) {
      const a = ((i + 0.5 + (j % 2) * 0.5) / na) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
      const n = [(ca * H) / L, R / L, (sa * H) / L];
      if (n[2] < -0.55) continue;
      const q = quatBasis(-sa, 0, ca, -ca * R / L, H / L, -sa * R / L);
      let c = shade(col, n[0], n[1], n[2], o.amb || 0.58, o.sun || 0.55);
      if (o.foot && t < o.foot) c = mix3(c, o.footCol, 1 - t / o.foot);
      c = jitter(c, rng, 0.04);
      out(x + ca * r, y, z + sa * r, ((2 * Math.PI * r) / na) * 0.72 + s * 0.15, (L / nh) * 0.72, s * 0.12, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind);
    }
    if (out.due()) yield;
  }
}
// A wheel seen from the side: a dark tyre disc with a paler hub, facing along (nx, nz) in x-z.
function wheel(out, x, y, z, R, nx, nz, kind, tyre = [0.1, 0.09, 0.09], hub = [0.42, 0.4, 0.37]) {
  ell(out, x, y, z, R, R, R * 0.28, -nz, 0, nx, tyre, kind);
  ell(out, x + nx * R * 0.15, y, z + nz * R * 0.15, R * 0.45, R * 0.45, R * 0.12, -nz, 0, nx, hub, kind);
}
// A shadow on the salt: a flat dark disc a little above the ground, thrown away from the sun.
function shadowDisc(ctx, out, x, d, rx, rz, rng, k = 0.62, ang = 0) {
  const c = mul3(flatColor(ctx, ctx.x0 + x, d, rng, { noCells: true }), k);
  const q = quatYaw(ang);
  out(x + rx * 0.25, groundY(ctx, x, d) + Math.min(0.25, lift(d) * 0.4), -(d + rz * 0.2), rx, 0.01, rz, c[0], c[1], c[2], 0.8, q[0], q[1], q[2], q[3], KIND.GROUND);
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

// A tumbleweed: a dense ball of twigs, a dark core and a ring of paler splats round it.
function* tumbleweed(ctx, out, x, d, r, rng) {
  const y0 = groundY(ctx, x, d), c = [0.6, 0.5, 0.34];
  out(x, y0 + r * 0.9, -d, r * 0.75, r * 0.68, r * 0.75, c[0] * 0.6, c[1] * 0.6, c[2] * 0.6, 1, 0, 0, 0, 1, KIND.OTHER);
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.283 + rng() * 0.3, e = (rng() - 0.3) * 1.2;
    const ux = Math.cos(a) * Math.cos(e), uy = Math.sin(e), uz = Math.abs(Math.sin(a)) * Math.cos(e);
    const k = jitter(shade(c, ux, uy, uz, 0.6, 0.5), rng, 0.12);
    out(x + ux * r * 0.7, y0 + r * 0.9 + uy * r * 0.65, -(d - uz * r * 0.7), r * 0.42, r * 0.3, r * 0.42, k[0], k[1], k[2], 1, 0, 0, 0, 1, KIND.OTHER);
  }
  shadowDisc(ctx, out, x, d, r * 1.1, r * 0.6, rng, 0.7);
  if (out.due()) yield;
}

// A telegraph pole: weathered timber, a lean, one or two cross-arms with glass insulators.
// Tagged MAST so the trackside rule (nothing but masts, wires and trees above 1.6 m near the line)
// holds. x, d chunk-local. opts: { height, lean, arms, rng, tilt, color }
// The trunk is a bundle of three thin struts rather than one fat one, so its edges stay crisp; the
// arms are struts with the insulators sitting on them (dunes.js hangs its wires from the same
// heights: arm at H - 0.45, insulators 0.14 above it, 0.6 either side).
export function* telegraphPole(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 7;
  const lean = opts.lean || 0;
  const y0 = groundY(ctx, x, d) - 0.3;
  const col = opts.color || [0.4, 0.32, 0.24];
  const c0 = jitter(col, rng, 0.08);
  const top = (dx, dz, k) => [x + lean * H + dx * k, y0 + H, -(d + dz * k)];
  for (const [dx, dz, t] of [[0, 0, 1], [-0.07, 0.03, 1.12], [0.07, -0.02, 0.78]]) {
    strut(out, x + dx, y0, -(d + dz), ...top(dx, dz, 0.7), 0.075, mul3(c0, t), 5, 1, KIND.MAST);
  }
  const arms = opts.arms != null ? opts.arms : 2;
  const tilt = opts.tilt || 0;
  for (let a = 0; a < arms; a++) {
    const ay = y0 + H - 0.45 - a * 0.85, ax = x + lean * (ay - y0);
    const c = mul3(c0, 0.92);
    strut(out, ax, ay - tilt * 0.85, -(d - 0.85), ax, ay + tilt * 0.85, -(d + 0.85), 0.06, c, 4, 1, KIND.MAST);
    strut(out, ax + 0.02, ay - 0.08 - tilt * 0.85, -(d - 0.8), ax + 0.02, ay - 0.08 + tilt * 0.85, -(d + 0.8), 0.045, mul3(c, 0.7), 4, 1, KIND.MAST);
    for (const dd of [-0.6, 0.6]) {
      out(ax, ay + 0.1 + tilt * dd, -(d + dd), 0.045, 0.07, 0.045, 0.5, 0.66, 0.62, 1, 0, 0, 0, 1, KIND.MAST);
      out(ax, ay + 0.17 + tilt * dd, -(d + dd), 0.06, 0.03, 0.06, 0.62, 0.76, 0.7, 1, 0, 0, 0, 1, KIND.MAST);
    }
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

// Concrete mile marker: a white post with a dark band and a number plate, a solid box.
function* mileMarker(ctx, out, x, d) {
  const y0 = groundY(ctx, x, d) - 0.05, s = 0.07, r = makeRng(hashInts(Math.floor((ctx.x0 + x) * 10), 5));
  yield* box(out, x, y0, d, 1, 0, 0.26, 0.22, 1.05, [0.78, 0.77, 0.73], s, KIND.OTHER, r, {
    colorAt: (f, u, v, c) => (v > 0.78 && v < 0.9 ? [0.12, 0.12, 0.12] : c),
  });
  yield* panel(out, [x - 0.17, y0 + 0.42, -(d - 0.12)], [1, 0, 0], [0, 1, 0], 0.34, 0.26, 0.06, (u, v) => (Math.abs(u - 0.17) < 0.06 && v > 0.05 && v < 0.21 ? [0.78, 0.78, 0.76] : [0.16, 0.2, 0.18]), KIND.OTHER, r);
}
// A rusted sign on a post: a board with an edge and a back, so it stays a sign from either side.
function* rustSign(ctx, out, x, d, rng) {
  const y0 = groundY(ctx, x, d);
  strut(out, x, y0 - 0.1, -d, x, y0 + 2.3, -d, 0.045, [0.32, 0.28, 0.24], 3, 1, KIND.OTHER);
  const c = jitter([0.52, 0.3, 0.17], rng, 0.1), W = 1.0, H = 0.7, z = -(d - 0.06);
  yield* panel(out, [x - W / 2, y0 + 1.65, z], [1, 0, 0], [0, 1, 0], W, H, 0.08,
    (u, v) => (u < 0.06 || u > W - 0.06 || v < 0.06 || v > H - 0.06 ? mul3(c, 0.6) : Math.abs(v - 0.38) < 0.07 && u > 0.18 && u < 0.82 ? [0.66, 0.6, 0.5] : jitter(c, rng, 0.08)), KIND.OTHER, rng);
  yield* panel(out, [x - W / 2, y0 + 1.65, z - 0.04], [1, 0, 0], [0, 1, 0], W, H, 0.12, () => mul3(c, 0.55), KIND.OTHER, rng);
}
// Stack of bleached sleepers: each one a 2.6 m strut, laid in crossing courses.
function* sleeperStack(ctx, out, x, d, rng) {
  const y0 = groundY(ctx, x, d);
  const rows = 5 + Math.floor(rng() * 3);
  for (let r = 0; r < rows; r++) {
    const y = y0 + 0.12 + r * 0.2;
    for (let c = 0; c < 4; c++) {
      const col = jitter([0.54, 0.49, 0.41], rng, 0.1);
      if (r % 2 === 0) { const dz = (c - 1.5) * 0.62; strut(out, x - 1.3, y, -(d + dz), x + 1.3, y, -(d + dz), 0.1, col, 3, 1, KIND.OTHER); }
      else { const dx = (c - 1.5) * 0.72; strut(out, x + dx, y, -(d - 1.0), x + dx, y, -(d + 1.0), 0.1, mul3(col, 0.9), 2, 1, KIND.OTHER); }
    }
  }
  if (out.due()) yield;
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

// A wrecked car, abandoned on the flat: rusted, windowless, sunk on its rims.
function* oldCar(ctx, out, x, d, rng) {
  const y0 = groundY(ctx, x, d), s = sOf(out, d, 0.6);
  shadowDisc(ctx, out, x + 0.4, d + 0.4, 2.8, 1.3, rng, 0.62);
  yield* car(out, x, y0, d, rng() < 0.5 ? 1 : -1, rng, s, { wreck: true, col: jitter([0.5, 0.3, 0.2], rng, 0.1), pickup: rng() < 0.35 });
}

// Siding: a spur of rails on sleepers beyond the cess, a few box wagons standing on their bogies.
function* siding(ctx, out, x, d, len, rng) {
  const y0 = groundY(ctx, x, d);
  for (const dd of [-0.72, 0.72]) strut(out, x, y0 + 0.17, -(d + dd), x + len, y0 + 0.17, -(d + dd), 0.05, [0.3, 0.27, 0.25], Math.ceil(len / 6), 1, KIND.OTHER);
  for (let u = 0.4; u < len; u += 1.2) strut(out, x + u, y0 + 0.07, -(d - 1.25), x + u, y0 + 0.07, -(d + 1.25), 0.1, jitter([0.42, 0.37, 0.32], rng, 0.1), 1, 1, KIND.OTHER);
  if (out.due()) yield;
  const s = Math.max(0.3, sOf(out, d, 1.6));      // close to the line and blurred in motion: coarse is enough
  let cx = 6;
  while (cx < len - 12) {
    if (rng() < 0.75) {
      const wall = [[0.5, 0.26, 0.2], [0.46, 0.4, 0.34], [0.42, 0.3, 0.22], [0.56, 0.5, 0.4]][Math.floor(rng() * 4)];
      yield* boxWagon(out, x + cx + 6, y0 + 0.24, d, jitter(wall, rng, 0.06), rng, s);
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
function roadIn(ctx, i) { return roadInWs(worldSeed(ctx), i); }
function roadInWs(wsd, i) {
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
        // the post and three wire strands to the next one, all struts lying along the member
        const pr = Math.max(0.05, 0.0009 * d), hgt = 1.25;
        const lean = (hashInts(worldSeed(ctx), 81, k) & 255) / 255 - 0.5;
        strut(out, x, y0 - 0.05, -d, x + lean * 0.12, y0 + hgt, -d, pr, [0.34, 0.28, 0.22], 2, 1, KIND.FENCE);
        const d2 = roadD(r, wx + P) + off, y2 = groundY(ctx, x + P, d2), wr = Math.max(0.012, 0.0006 * d);
        for (const fy of [0.45, 0.8, 1.15]) strut(out, x, y0 + fy, -d, x + P, y2 + fy, -d2, wr, [0.4, 0.38, 0.34], 2, 0.9, KIND.FENCE);
        if (out.due()) yield;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// People and animals: a handful of shaped splats each, legs as struts, drawn about 1.3 times life
// size so they read at 50 to 100 m. Every one is tagged MOVE.BEAT by the caller (withMove).
// ---------------------------------------------------------------------------------------------
const LIFE = 1.3;
// A local frame on the ground: forward (fx, fd) in (x, distance) and across it, pz > 0 being the
// side away from the line (the far legs). F(px, py, pz) -> splat-space point.
function frame(x, y0, d, fx, fd) {
  let ax = -fd, ad = fx;
  if (ad < 0) { ax = -ax; ad = -ad; }               // across always points away from the line
  const F = (px, py, pz = 0) => [x + fx * px + ax * pz, y0 + py, -(d + fd * px + ad * pz)];
  F.dir = (px, py, pz = 0) => [fx * px + ax * pz, py, -(fd * px + ad * pz)];
  return F;
}
const SHIRTS = [[0.62, 0.16, 0.12], [0.16, 0.3, 0.55], [0.75, 0.72, 0.62], [0.2, 0.42, 0.3], [0.78, 0.55, 0.14], [0.12, 0.12, 0.13], [0.5, 0.2, 0.42]];
const TROUSERS = [[0.18, 0.2, 0.3], [0.42, 0.36, 0.26], [0.14, 0.13, 0.13], [0.3, 0.3, 0.28]];
const SKIN = [[0.62, 0.44, 0.32], [0.45, 0.3, 0.2], [0.7, 0.55, 0.44], [0.32, 0.22, 0.15]];

// A person. o: { pose: 'stand' | 'walk' | 'sit', shirt, legs, skin, hat (colour or null), pack
// (colour), stride 0..1, seat (height of the seat for 'sit') }. (fx, fd) is the way they face.
function person(out, x, y0, d, fx, fd, rng, o = {}) {
  const S = LIFE, F = frame(x, y0, d, fx, fd), kind = KIND.OTHER;
  const shirt = o.shirt || SHIRTS[Math.floor(rng() * SHIRTS.length)], legs = o.legs || TROUSERS[Math.floor(rng() * TROUSERS.length)];
  const skin = o.skin || SKIN[Math.floor(rng() * SKIN.length)];
  const rl = limb(0.075 * S, d), ra = limb(0.055 * S, d);
  const legsD = mul3(legs, 0.75);
  let hip = 0.92 * S;
  if (o.pose === 'sit') {
    hip = (o.seat || 0.45) * S + 0.08 * S;
    for (const side of [-1, 1]) {
      const k = F(0.42 * S, (o.seat || 0.45) * S + 0.05 * S, side * 0.1 * S);
      strut(out, ...F(0, hip, side * 0.1 * S), ...k, rl, side < 0 ? legs : legsD, 1, 1, kind);
      strut(out, ...k, ...F(0.46 * S, 0.02, side * 0.1 * S), rl * 0.9, side < 0 ? legs : legsD, 1, 1, kind);
    }
  } else {
    const st = o.pose === 'walk' ? 0.26 * S * (o.stride != null ? Math.cos(o.stride * 6.283) : 1) : 0.04 * S;
    for (const side of [-1, 1]) {
      const fxo = side * st;
      strut(out, ...F(0, hip, side * 0.09 * S), ...F(fxo, 0.03, side * 0.1 * S), rl, side < 0 ? legs : legsD, 2, 1, kind);
    }
  }
  // torso (a little wider than deep), shoulders, head
  const ty = hip + 0.3 * S;
  ell(out, ...F(o.pose === 'sit' ? -0.04 * S : 0, ty, 0), 0.32 * S, 0.19 * S, 0.12 * S, ...F.dir(0, 1, 0), shirt, kind);
  ell(out, ...F(0, ty + 0.25 * S, 0), 0.2 * S, 0.09 * S, 0.11 * S, ...F.dir(0, 0, 1), mul3(shirt, 1.06), kind);
  // arms: hanging, a little swing when walking
  const sw = o.pose === 'walk' ? 0.18 * S : 0.04 * S;
  for (const side of [-1, 1]) {
    const handX = o.pose === 'sit' ? 0.25 * S : -side * sw;
    strut(out, ...F(0, ty + 0.26 * S, side * 0.22 * S), ...F(handX, ty - 0.28 * S, side * 0.24 * S), ra, side < 0 ? shirt : mul3(shirt, 0.78), 2, 1, kind);
  }
  ell(out, ...F(0.02 * S, ty + 0.48 * S, 0), 0.12 * S, 0.14 * S, 0.12 * S, 0, 1, 0, skin, kind);
  if (o.hat) {
    ell(out, ...F(0.02 * S, ty + 0.6 * S, 0), 0.2 * S, 0.035 * S, 0.2 * S, 1, 0, 0, o.hat, kind);
    ell(out, ...F(0.02 * S, ty + 0.65 * S, 0), 0.11 * S, 0.07 * S, 0.11 * S, 0, 1, 0, o.hat, kind);
  }
  if (o.pack) ell(out, ...F(-0.2 * S, ty + 0.05 * S, 0), 0.24 * S, 0.17 * S, 0.14 * S, ...F.dir(0, 1, 0), o.pack, kind);
}

// Four-legged animals. A spec in metres (before LIFE): body half-length a, body centre height by,
// body radii rb (up) and rw (across), the neck from n0 to n1 (forward, up), head length hl, legs
// thickness lr, colours, and extras.
const BEASTS = {
  horse: { a: 0.78, by: 1.28, rb: 0.34, rw: 0.3, n0: [0.6, 1.45], n1: [1.0, 1.95], hl: 0.34, lr: 0.06, tail: [-0.86, 1.42, -0.98, 0.7], mane: true },
  pronghorn: { a: 0.56, by: 0.95, rb: 0.24, rw: 0.2, n0: [0.46, 1.05], n1: [0.62, 1.42], hl: 0.22, lr: 0.04, tail: null, horns: true, rump: true },
};
const HORSES = [[0.4, 0.23, 0.13], [0.54, 0.3, 0.16], [0.12, 0.1, 0.09], [0.6, 0.58, 0.55], [0.66, 0.5, 0.32]];

function beast(out, x, y0, d, fx, fd, spec, col, rng, o = {}) {
  const S = LIFE, B = spec, F = frame(x, y0, d, fx, fd), kind = KIND.OTHER;
  const cs = mul3(col, 0.68), cl = mul3(col, 1.12), dark = o.dark || mul3(col, 0.45);
  const rl = limb(B.lr * S, d);
  // legs: near pair in the body's colour, far pair in shade; a stride swings them
  const st = o.stride != null ? o.stride : rng();
  const ly = (B.by - B.rb * 0.6) * S;
  for (const [lx, side] of [[0.66, 1], [-0.76, 1], [0.72, -1], [-0.7, -1]]) {
    const sw = (side > 0 ? st - 0.5 : 0.5 - st) * (lx > 0 ? 0.35 : -0.35) * B.a * S;
    const top = F(lx * B.a * S, ly, side * B.rw * 0.55 * S), knee = F(lx * B.a * S + sw * 0.4, ly * 0.45, side * B.rw * 0.55 * S);
    const foot = F(lx * B.a * S + sw, 0.02, side * B.rw * 0.55 * S);
    const lc = side > 0 ? mul3(cs, 0.8) : cs;
    strut(out, ...top, ...knee, rl * 1.3, lc, 1, 1, kind);
    strut(out, ...knee, ...foot, rl, o.socks ? mul3(lc, 0.5) : lc, 1, 1, kind);
  }
  // body
  ell(out, ...F(0, B.by * S, 0), B.a * S, B.rb * S, B.rw * S, ...F.dir(1, 0.03, 0), col, kind);
  ell(out, ...F(0.05 * S, (B.by - B.rb * 0.45) * S, 0.02), B.a * 0.78 * S, B.rb * 0.55 * S, B.rw * 0.92 * S, ...F.dir(1, 0, 0), B.rump ? [0.8, 0.78, 0.72] : cs, kind);   // belly
  ell(out, ...F(B.a * 0.55 * S, (B.by + B.rb * 0.15) * S, 0), B.a * 0.4 * S, B.rb * 0.95 * S, B.rw * 0.95 * S, ...F.dir(1, 0.2, 0), cl, kind);      // shoulders
  if (B.rump) ell(out, ...F(-B.a * 0.92 * S, B.by * S, 0), B.a * 0.16 * S, B.rb * 0.8 * S, B.rw * 0.9 * S, ...F.dir(0, 1, 0), [0.8, 0.79, 0.74], kind);
  // neck and head: up, or down to graze
  const graze = !!o.graze;
  const n1 = graze ? [B.n0[0] + (B.n1[1] - B.n0[1]) * 0.6, 0.35] : B.n1;
  strut(out, ...F(B.n0[0] * S, B.n0[1] * S), ...F(n1[0] * S, n1[1] * S), limb(B.rb * 0.5 * S, d), col, 2, 1, kind);
  if (B.mane) strut(out, ...F((B.n0[0] - 0.05) * S, (B.n0[1] + 0.2) * S), ...F((n1[0] - 0.06) * S, (n1[1] + 0.12) * S), limb(0.06 * S, d), dark, 2, 1, kind);
  const hd = graze ? [0.25, -0.9] : [0.75, -0.55];
  ell(out, ...F((n1[0] + hd[0] * B.hl * 0.6) * S, (n1[1] + hd[1] * B.hl * 0.6) * S), B.hl * S, B.hl * 0.36 * S, B.hl * 0.3 * S, ...F.dir(hd[0], hd[1], 0), cl, kind);
  if (B.horns) for (const side of [-1, 1]) strut(out, ...F((n1[0] - 0.02) * S, (n1[1] + 0.05) * S, side * 0.05 * S), ...F((n1[0] - 0.04) * S, (n1[1] + 0.32) * S, side * 0.06 * S), limb(0.025 * S, d), [0.1, 0.09, 0.08], 1, 1, kind);
  if (B.ears) for (const side of [-1, 1]) strut(out, ...F(n1[0] * S, (n1[1] + 0.04) * S, side * 0.05 * S), ...F((n1[0] - 0.03) * S, (n1[1] + 0.17) * S, side * 0.06 * S), limb(0.025 * S, d), cl, 1, 1, kind);
  if (B.tail) {
    const t = B.tail;
    if (B.brush) ell(out, ...F((t[0] + t[2]) * 0.5 * S, (t[1] + t[3]) * 0.5 * S), Math.hypot(t[2] - t[0], t[3] - t[1]) * 0.55 * S, 0.08 * S, 0.08 * S, ...F.dir(t[2] - t[0], t[3] - t[1], 0), cs, kind);
    else strut(out, ...F(t[0] * S, t[1] * S), ...F(t[2] * S, t[3] * S), limb(0.07 * S, d), dark, 2, 1, kind);
  }
}

// A flamingo: a pink body on one or two long legs, the neck in an S, the head down to feed or up.
function flamingo(out, x, y0, d, fx, fd, rng, o = {}) {
  const S = LIFE, F = frame(x, y0, d, fx, fd), kind = KIND.OTHER;
  const pink = jitter(o.col || [0.8, 0.46, 0.52], rng, 0.08), deep = mul3(pink, 0.78), leg = [0.7, 0.42, 0.44];
  const rl = limb(0.022 * S, d);
  const hip = 0.95 * S;
  strut(out, ...F(0, hip, 0.03), ...F(0.02 * S, 0.02, 0.03), rl, leg, 2, 1, kind);
  if (o.oneLeg) strut(out, ...F(0, hip, -0.03), ...F(0.12 * S, hip * 0.62, -0.03), rl, leg, 1, 1, kind);
  else strut(out, ...F(0, hip, -0.04), ...F(-0.12 * S, 0.02, -0.04), rl, mul3(leg, 0.85), 2, 1, kind);
  ell(out, ...F(0, hip + 0.15 * S, 0), 0.3 * S, 0.14 * S, 0.13 * S, ...F.dir(1, 0.15, 0), pink, kind);
  ell(out, ...F(-0.26 * S, hip + 0.17 * S, 0), 0.12 * S, 0.06 * S, 0.09 * S, ...F.dir(1, -0.3, 0), [0.15, 0.1, 0.1], kind);   // black flight feathers at the tail
  const rn = limb(0.035 * S, d);
  if (o.feed) {
    const a = F(0.24 * S, hip + 0.2 * S), b = F(0.5 * S, hip + 0.45 * S), c = F(0.56 * S, 0.2 * S);
    strut(out, ...a, ...b, rn, pink, 1, 1, kind);
    strut(out, ...b, ...c, rn, pink, 2, 1, kind);
    ell(out, ...F(0.56 * S, 0.12 * S), 0.07 * S, 0.05 * S, 0.04 * S, 0, 1, 0, [0.16, 0.12, 0.12], kind);
  } else {
    const a = F(0.24 * S, hip + 0.2 * S), b = F(0.14 * S, hip + 0.55 * S), c = F(0.2 * S, hip + 0.85 * S);
    strut(out, ...a, ...b, rn, pink, 1, 1, kind);
    strut(out, ...b, ...c, rn, pink, 1, 1, kind);
    ell(out, ...F(0.25 * S, hip + 0.87 * S), 0.07 * S, 0.05 * S, 0.05 * S, ...F.dir(1, 0, 0), deep, kind);
    strut(out, ...F(0.3 * S, hip + 0.87 * S), ...F(0.38 * S, hip + 0.8 * S), limb(0.022 * S, d), [0.14, 0.11, 0.1], 1, 1, kind);
  }
}

// A vulture: perched, a dark hunched body and a small red head; flying, the long broad wings in a
// shallow V with the fingered tips.
function vulture(out, x, y, d, rng, flying, ang = 0) {
  const S = LIFE, kind = KIND.OTHER, z = -d;
  const body = jitter([0.13, 0.11, 0.1], rng, 0.1), head = [0.56, 0.24, 0.2];
  if (!flying) {
    ell(out, x, y + 0.3 * S, z, 0.24 * S, 0.3 * S, 0.2 * S, 0.3, 1, 0, body, kind);
    ell(out, x + 0.12 * S, y + 0.55 * S, z, 0.07 * S, 0.06 * S, 0.06 * S, 1, 0, 0, head, kind);
    ell(out, x - 0.16 * S, y + 0.08 * S, z, 0.14 * S, 0.04 * S, 0.07 * S, 1, -1, 0, body, kind);
    return;
  }
  const ca = Math.cos(ang), sa = Math.sin(ang), span = 0.95 * S, rw = limb(0.11 * S, d);
  ell(out, x, y, z, 0.32 * S, 0.1 * S, 0.11 * S, ca, 0, -sa, body, kind);
  for (const side of [-1, 1]) {
    const wx = -sa * side, wz = -ca * side;                  // across the body
    const tip = [x + wx * span, y + 0.32 * S, z + wz * span];
    strut(out, x, y + 0.03, z, ...tip, rw, mul3(body, 1.25), 2, 1, kind);
    strut(out, ...tip, tip[0] + wx * 0.45 * S + ca * 0.1, tip[1] + 0.12 * S, tip[2] + wz * 0.45 * S - sa * 0.1, rw * 0.7, body, 1, 1, kind);
  }
  ell(out, x + ca * 0.32 * S, y + 0.02, z - sa * 0.32 * S, 0.07 * S, 0.06 * S, 0.06 * S, 1, 0, 0, head, kind);
}

// ---------------------------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------------------------
const PAINT = [[0.55, 0.16, 0.12], [0.2, 0.32, 0.5], [0.72, 0.7, 0.64], [0.3, 0.4, 0.3], [0.66, 0.52, 0.2], [0.16, 0.16, 0.17], [0.5, 0.3, 0.2]];
const RUSTS = [[0.46, 0.26, 0.16], [0.38, 0.22, 0.15], [0.5, 0.3, 0.2], [0.32, 0.21, 0.16]];
const GLASS = [0.16, 0.18, 0.2];

// A car or pickup, side on: a lower body, a glasshouse with dark windows, four wheels.
//   o: { pickup, wreck (rust, no glass, sunk on its rims), col }
function* car(out, x, y0, d, dir, r, s, o = {}) {
  const kind = KIND.OTHER, col = o.col || PAINT[Math.floor(r() * PAINT.length)];
  const L = o.pickup ? 5.2 : 4.6, W = 1.85, sink = o.wreck ? 0.25 : 0;
  const yb = y0 + 0.32 - sink;
  yield* box(out, x, yb, d, 1, 0, L, W, 0.72, col, s, kind, r);
  const cabL = o.pickup ? 2.0 : 2.5, cabX = x - dir * (o.pickup ? 0.5 : 0.25);
  const win = o.wreck ? mul3(col, 0.35) : GLASS;
  yield* box(out, cabX, yb + 0.72, d, 1, 0, cabL, W * 0.9, 0.62, col, s * 0.8, kind, r, {
    colorAt: (f, u, v, c) => (f < 4 && v > 0.08 && v < 0.52 && (f > 1 || (u > 0.12 && u < cabL - 0.12 && Math.abs(u - cabL / 2) > 0.08)) ? win : c),
  });
  if (o.pickup) yield* box(out, x + dir * 1.55, yb + 0.72, d, 1, 0, 1.9, W, 0.3, mul3(col, 0.9), s * 0.8, kind, r, { top: mul3(col, 0.4) });
  for (const wx of [-1.45, 1.45]) for (const side of [-1, 1]) {
    const tyre = o.wreck && side < 0 && wx > 0 ? null : [0.1, 0.09, 0.09];
    if (tyre) wheel(out, x + wx * (L / 4.6), y0 + 0.36 - sink * 0.6, -(d + side * (W / 2 + 0.02)), 0.36, 0, side < 0 ? 1 : -1, kind, tyre, o.wreck ? [0.36, 0.22, 0.15] : [0.5, 0.49, 0.46]);
  }
}

// A small lorry: a cab and a box body. dir: the way it faces along x.
function* truck(out, x, y0, d, dir, r, s, col = [0.72, 0.71, 0.68], cab = PAINT[Math.floor(r() * 3)]) {
  const kind = KIND.OTHER;
  yield* box(out, x - dir * 1.0, y0 + 1.0, d, 1, 0, 5.2, 2.3, 2.5, col, s, kind, r);
  yield* box(out, x + dir * 2.4, y0 + 0.75, d, 1, 0, 1.7, 2.2, 2.0, cab, s, kind, r, {
    colorAt: (f, u, v, c) => (v > 1.0 && v < 1.7 && (f === 3 || f === 2 || (u > 0.3 && u < 1.5)) ? GLASS : c),
  });
  for (const wx of [-2.6, -1.5, 2.3]) for (const side of [-1, 1]) wheel(out, x + dir * wx, y0 + 0.5, -(d + side * 1.1), 0.5, 0, side < 0 ? 1 : -1, kind);
}

// ---------------------------------------------------------------------------------------------
// Places on the flat. Each is drawn from its own rng (makeRng(p.seed)), the same in every chunk.
// x = p.x - ctx.x0 (chunk-local), d = p.d.
// ---------------------------------------------------------------------------------------------
const sOf = (out, d, k = 0.9) => Math.max(0.12, detail(out, d, k));
const lit = (ctx) => ctx.hour != null && (ctx.hour >= 18.4 || ctx.hour < 6);
const SALT_W = [0.8, 0.79, 0.76];

// Salt works: rows of conical salt piles, a conveyor stacker feeding them and a front loader.
function* saltworks(ctx, out, p, r) {
  const x = p.x - ctx.x0, d = p.d, s = sOf(out, d, 0.8);
  const rows = r() < 0.6 ? 2 : 1, n = 4 + Math.floor(r() * 4);
  const R0 = 4.5 + 2 * r(), H0 = 3 + 1.6 * r(), gap = R0 * 2.25;
  for (let row = 0; row < rows; row++) {
    const dd = d + row * (R0 * 2.3 + 3);
    for (let k = 0; k < n; k++) {
      const skip = row === 1 && r() < 0.3, px = x + (k - (n - 1) / 2) * gap + (row ? gap * 0.5 : 0) + (r() - 0.5) * 2;
      const kR = 0.8 + 0.35 * r();
      if (skip) continue;
      const R = R0 * kR, H = H0 * kR;
      shadowDisc(ctx, out, px + R * 0.35, dd + R * 0.25, R * 1.15, R * 0.8, r, 0.66);
      yield* cone(out, px, groundY(ctx, px, dd) - 0.1, -dd, R, H, SALT_W, s, KIND.BUILDING, r, { foot: 0.16, footCol: [0.58, 0.54, 0.47] });
    }
  }
  // the stacker: a truss from a hopper on the ground up over the first pile, on an A-frame
  const steel = [0.52, 0.4, 0.26], rr = limb(0.06, d);
  const end = x - ((n - 1) / 2) * gap, yg = groundY(ctx, end, d);
  const T = [end + 0.6, yg + H0 + 1.5, -d], B = [end - gap * 1.5, yg + 1.1, -(d - 0.5)];
  const at = (t, dy, dz) => [lerp(B[0], T[0], t), lerp(B[1], T[1], t) + dy, lerp(B[2], T[2], t) + dz];
  for (const dz of [-0.45, 0.45]) for (const dy of [0, -0.7]) strut(out, ...at(0, dy, dz), ...at(1, dy, dz), rr, steel, 6, 1, KIND.BUILDING);
  for (let k = 0; k <= 8; k++) {
    const t = k / 8;
    for (const dz of [-0.45, 0.45]) strut(out, ...at(t, 0, dz), ...at(t, -0.7, dz), rr * 0.7, steel, 1, 1, KIND.BUILDING);
    strut(out, ...at(t, 0, -0.45), ...at(t, 0, 0.45), rr * 0.7, steel, 1, 1, KIND.BUILDING);
    if (k < 8) strut(out, ...at(t, 0, 0.45), ...at(t + 1 / 8, -0.7, 0.45), rr * 0.6, steel, 1, 1, KIND.BUILDING);
  }
  strut(out, ...at(0, 0.12, 0), ...at(1, 0.12, 0), limb(0.12, d), [0.24, 0.22, 0.2], 4, 1, KIND.BUILDING);   // the belt
  const leg = at(0.62, -0.7, 0);
  for (const dz of [-1.4, 1.4]) strut(out, leg[0], yg, leg[2] + dz, ...leg, rr * 1.2, steel, 3, 1, KIND.BUILDING);
  yield* box(out, B[0] - 0.5, yg, d - 0.5, 1, 0, 2.2, 2.2, 1.3, [0.46, 0.36, 0.24], s * 0.7, KIND.BUILDING, r);   // hopper
  if (out.due()) yield;
  // a front loader working the piles, its bucket heaped with salt
  const lx = x + ((n - 1) / 2) * gap * (r() < 0.5 ? 1 : 0.2) + 4, ld = d - R0 - 4, dir = r() < 0.5 ? 1 : -1;
  yield* loader(ctx, out, lx, ld, dir, r, s);
}
function* loader(ctx, out, x, d, dir, r, s) {
  const y0 = groundY(ctx, x, d), yel = [0.78, 0.6, 0.12], kind = KIND.BUILDING;
  shadowDisc(ctx, out, x + 0.6, d + 0.6, 3.2, 1.8, r);
  yield* box(out, x - dir * 0.5, y0 + 0.75, d, 1, 0, 4.0, 2.1, 1.25, yel, s * 0.7, kind, r);
  yield* box(out, x - dir * 0.7, y0 + 2.0, d, 1, 0, 1.6, 1.6, 1.5, yel, s * 0.6, kind, r, {
    colorAt: (f, u, v, c) => (f < 4 && v > 0.45 && v < 1.35 && Math.min(u, (f > 1 ? 1.6 : 1.6) - u) > 0.12 ? GLASS : c),
  });
  for (const wx of [-1.5, 1.2]) for (const side of [-1, 1]) wheel(out, x + dir * wx, y0 + 0.78, -(d + side * 1.15), 0.78, 0, side < 0 ? 1 : -1, kind);
  const rr = limb(0.1, d);
  for (const dz of [-0.85, 0.85]) strut(out, x + dir * 0.4, y0 + 2.2, -(d + dz), x + dir * 2.9, y0 + 0.95, -(d + dz), rr, mul3(yel, 0.85), 2, 1, kind);
  yield* box(out, x + dir * 3.3, y0 + 0.15, d, 1, 0, 1.0, 2.6, 0.95, mul3(yel, 0.7), s * 0.6, kind, r);
  ell(out, x + dir * 3.3, y0 + 1.15, -d, 0.55, 0.3, 1.2, 1, 0, 0, SALT_W, kind);
}

// Evaporation ponds: shallow rectangles of brine in pink, rust, turquoise and white, held by low
// earth dykes, and a pump hut. The dykes are what reads from the train; the colour fills between.
const POND_COLS = [[0.8, 0.5, 0.58], [0.74, 0.36, 0.48], [0.66, 0.32, 0.2], [0.24, 0.62, 0.6], [0.36, 0.66, 0.5], [0.8, 0.8, 0.78], [0.76, 0.48, 0.24]];
function* ponds(ctx, out, p, r) {
  const x = p.x - ctx.x0, d0 = p.d;
  const nx = 2 + Math.floor(r() * 3), nd = r() < 0.6 ? 2 : 1;
  const Lx = 42 + 22 * r(), Ld = 14 + 8 * r(), dk = 3;
  const xs = x - (nx * (Lx + dk)) / 2;
  const dens = Math.min(1, Math.sqrt(out.density));
  const earth = [0.6, 0.53, 0.44], earthTop = [0.7, 0.64, 0.54];
  const cols = [];
  for (let k = 0; k < nx * nd; k++) cols.push(POND_COLS[Math.floor(r() * POND_COLS.length)]);
  for (let j = 0; j < nd; j++) {
    for (let i = 0; i < nx; i++) {
      const px0 = xs + i * (Lx + dk) + dk / 2, pd0 = d0 + j * (Ld + dk);
      const col = cols[j * nx + i], dm = pd0 + Ld / 2;
      const sp = Math.max(1.0, 0.016 * dm) / dens;
      const nu = Math.ceil(Lx / (sp * 1.3)), nv = Math.ceil(Ld / (sp * 0.9));
      for (let u = 0; u < nu; u++) {
        const px = px0 + ((u + 0.5) / nu) * Lx;
        if (px < -Lx / nu || px > ctx.length + Lx / nu) { r(); continue; }
        for (let v = 0; v < nv; v++) {
          const pd = pd0 + ((v + 0.5) / nv) * Ld;
          let c = mix3(col, [0.72, 0.78, 0.84], 0.04 + 0.08 * (v / nv));
          c = jitter(c, r, 0.03);
          out(px, groundY(ctx, px, pd) + 0.2, -pd, (Lx / nu) * 0.8, 0.015, (Ld / nv) * 0.85, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
        }
        if (out.due()) yield;
      }
    }
  }
  // dykes: along the line in front of, between and behind the rows, and across between ponds
  const rd = Math.max(0.5, 0.004 * d0), y = (px, pd) => groundY(ctx, px, pd);
  const X0 = xs, X1 = xs + nx * (Lx + dk);
  for (let j = 0; j <= nd; j++) {
    const pd = d0 + j * (Ld + dk) - dk / 2;
    for (let k = 0; k < 4; k++) {
      const a = X0 + (k / 4) * (X1 - X0), b = X0 + ((k + 1) / 4) * (X1 - X0);
      strut(out, a, y(a, pd) + 0.4, -pd, b, y(b, pd) + 0.4, -pd, rd, earth, 4, 1, KIND.GROUND);
      strut(out, a, y(a, pd) + 0.85, -(pd - rd * 0.3), b, y(b, pd) + 0.85, -(pd - rd * 0.3), rd * 0.55, earthTop, 4, 1, KIND.GROUND);
    }
  }
  for (let i = 0; i <= nx; i++) {
    const px = xs + i * (Lx + dk);
    const a = d0 - dk / 2, b = d0 + nd * (Ld + dk) - dk / 2;
    strut(out, px, y(px, a) + 0.3, -a, px, y(px, b) + 0.3, -b, rd, mul3(earth, 0.9), 3, 1, KIND.GROUND);
    strut(out, px, y(px, a) + 0.62, -a, px, y(px, b) + 0.62, -b, rd * 0.55, earthTop, 3, 1, KIND.GROUND);
  }
  if (out.due()) yield;
  // the pump hut at one end, a pipe into the first pond
  const hx = X0 - 7, s = sOf(out, d0, 0.8);
  yield* box(out, hx, y(hx, d0 + 4) - 0.1, d0 + 4, 1, 0, 3.4, 3.0, 2.6, [0.62, 0.6, 0.56], s, KIND.BUILDING, r, { top: [0.4, 0.36, 0.33], colorAt: (f, u, v, c) => (f === 0 && u > 1.3 && u < 2.1 && v < 2.0 ? [0.2, 0.18, 0.16] : c) });
  strut(out, hx + 1.7, y(hx, d0) + 0.5, -(d0 + 4), X0 + 2, y(X0, d0) + 0.5, -(d0 + 4), limb(0.12, d0), [0.3, 0.3, 0.32], 3, 1, KIND.BUILDING);
}

// A graveyard of steam: a dead siding of rusted rails with a locomotive or two, tenders and wagons
// standing where they were left, one wagon tipped over beside the track.
function* locos(ctx, out, p, r) {
  const x = p.x - ctx.x0, d = p.d, y0 = groundY(ctx, x, d), s = sOf(out, d, 1.1);
  const len = 120 + 50 * r(), xa = x - len / 2, rr = limb(0.07, d);
  const rail = [0.3, 0.2, 0.15];
  for (const off of [-0.72, 0.72]) strut(out, xa, y0 + 0.2, -(d + off), xa + len, y0 + 0.2, -(d + off), rr, rail, 10, 1, KIND.OTHER);
  for (let u = 0.8; u < len; u += 1.6) {
    if (r() < 0.12) continue;
    const c = jitter([0.38, 0.33, 0.28], r, 0.1);
    strut(out, xa + u, y0 + 0.09, -(d - 1.25), xa + u, y0 + 0.09, -(d + 1.25), limb(0.12, d), c, 1, 1, KIND.OTHER);
  }
  for (let u = 1; u < len; u += 2.4) {
    const c = jitter([0.44, 0.4, 0.36], r, 0.08), px = xa + u;
    out(px, y0 + Math.min(0.25, lift(d) * 0.4), -d, 1.6, 0.04, 2.0, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
  }
  if (out.due()) yield;
  const yr = y0 + 0.26, dir = r() < 0.5 ? 1 : -1;
  let cx = dir > 0 ? xa + len - 8 : xa + 8;
  const step = (L) => { const c = cx - dir * L / 2; cx -= dir * (L + 1.2); return c; };
  const nLoco = r() < 0.35 ? 2 : 1;
  for (let k = 0; k < nLoco; k++) {
    const col = RUSTS[Math.floor(r() * RUSTS.length)];
    yield* steamLoco(out, step(10.5), yr, d, dir, col, r, s);
    yield* tender(out, step(6), yr, d, col, r, s);
    if (k === 0) cx -= dir * (6 + 10 * r());
  }
  const nw = 2 + Math.floor(r() * 4);
  for (let k = 0; k < nw && Math.abs(cx - x) < len / 2 - 6; k++) {
    const t = r(), col = RUSTS[Math.floor(r() * RUSTS.length)];
    if (t < 0.4) yield* boxWagon(out, step(8.5), yr, d, col, r, s);
    else if (t < 0.7) yield* oreWagon(out, step(7), yr, d, col, r, s);
    else yield* tankWagon(out, step(8), yr, d, col, r, s);
    if (r() < 0.3) cx -= dir * (4 + 8 * r());
  }
  // a wagon tipped onto its side beyond the track
  if (r() < 0.6) {
    const tx = x + (r() - 0.5) * len * 0.6;
    yield* box(out, tx, y0 - 0.1, d + 4.2, 1, 0, 8.5, 2.4, 2.7, RUSTS[Math.floor(r() * RUSTS.length)], s, KIND.OTHER, r, { colorAt: (f, u, v, c) => (f === 4 ? mul3(c, 0.8) : c) });
  }
}
function bogie(out, x, yr, d, k, s) {
  const dark = [0.16, 0.14, 0.13];
  out(x, yr + 0.55, -(d - 1.05), 1.0, 0.24, 0.08, dark[0], dark[1], dark[2], 1, 0, 0, 0, 1, KIND.OTHER);
  for (const wx of [-0.75, 0.75]) for (const side of [-1, 1]) wheel(out, x + wx, yr + 0.45, -(d + side * 0.95), 0.45, 0, side < 0 ? 1 : -1, KIND.OTHER, [0.14, 0.12, 0.11], [0.34, 0.22, 0.15]);
}
function* steamLoco(out, x, yr, d, dir, col, r, s) {
  const kind = KIND.OTHER, dark = [0.13, 0.12, 0.11], z = -d;
  yield* box(out, x, yr + 0.85, d, 1, 0, 10, 2.3, 0.45, dark, s, kind, r);
  for (const wx of [-1.9, -0.3, 1.3]) for (const side of [-1, 1]) wheel(out, x + dir * wx, yr + 0.8, -(d + side * 1.02), 0.8, 0, side < 0 ? 1 : -1, kind, [0.15, 0.12, 0.11], mul3(col, 1.1));
  for (const wx of [3.4]) for (const side of [-1, 1]) wheel(out, x + dir * wx, yr + 0.45, -(d + side * 0.95), 0.45, 0, side < 0 ? 1 : -1, kind);
  strut(out, x - dir * 1.9, yr + 0.7, -(d - 1.12), x + dir * 1.3, yr + 0.7, -(d - 1.12), limb(0.06, d), mul3(col, 1.25), 2, 1, kind);
  const by = yr + 2.25;
  yield* tube(out, [x - dir * 2.3, by, z], [x + dir * 3.4, by, z], 0.85, col, s, kind, r, { rib: 1.4 });
  yield* tube(out, [x + dir * 3.4, by, z], [x + dir * 4.3, by, z], 0.92, dark, s, kind, r, { caps: true, capCol: mul3(dark, 1.4) });
  yield* tube(out, [x + dir * 3.85, by + 0.6, z], [x + dir * 3.85, by + 1.75, z], 0.3, dark, s * 0.6, kind, r);
  ell(out, x + dir * 0.9, by + 0.85, z, 0.45, 0.35, 0.42, 1, 0, 0, mul3(col, 1.1), kind);
  ell(out, x - dir * 0.6, by + 0.8, z, 0.32, 0.28, 0.32, 1, 0, 0, mul3(col, 1.05), kind);
  strut(out, x - dir * 2.3, by - 0.55, -(d - 1.05), x + dir * 3.4, by - 0.55, -(d - 1.05), limb(0.07, d), dark, 3, 1, kind);   // running board
  yield* box(out, x - dir * 3.6, yr + 1.3, d, 1, 0, 2.5, 2.6, 2.5, col, s * 0.8, kind, r, {
    colorAt: (f, u, v, c) => (f < 2 && v > 1.2 && v < 2.1 && u > 0.5 && u < 2.0 ? [0.08, 0.07, 0.07] : c),
  });
  yield* box(out, x - dir * 3.6, yr + 3.8, d, 1, 0, 2.9, 2.9, 0.14, mul3(col, 0.8), s * 0.8, kind, r);
  yield* box(out, x + dir * 4.6, yr + 0.85, d, 1, 0, 0.35, 2.6, 0.6, [0.42, 0.14, 0.1], s * 0.6, kind, r);   // buffer beam
}
function* tender(out, x, yr, d, col, r, s) {
  yield* box(out, x, yr + 1.1, d, 1, 0, 6, 2.5, 2.0, mul3(col, 0.92), s, KIND.OTHER, r, { top: [0.12, 0.11, 0.1] });
  bogie(out, x - 1.6, yr, d); bogie(out, x + 1.6, yr, d);
}
function* boxWagon(out, x, yr, d, col, r, s) {
  yield* box(out, x, yr + 1.15, d, 1, 0, 8.5, 2.6, 2.4, col, s, KIND.OTHER, r, {
    colorAt: (f, u, v, c) => (f === 0 && Math.abs(u - 4.25) < 0.9 && v < 2.2 ? (Math.abs(u - 4.25) < 0.8 ? mul3(c, 0.62) : [0.1, 0.08, 0.07]) : c),
  });
  yield* box(out, x, yr + 3.55, d, 1, 0, 8.6, 2.2, 0.25, mul3(col, 0.8), s, KIND.OTHER, r);
  bogie(out, x - 2.9, yr, d); bogie(out, x + 2.9, yr, d);
}
function* oreWagon(out, x, yr, d, col, r, s) {
  yield* box(out, x, yr + 1.1, d, 1, 0, 7, 2.5, 1.5, col, s, KIND.OTHER, r, { top: [0.12, 0.1, 0.09] });
  bogie(out, x - 2.3, yr, d); bogie(out, x + 2.3, yr, d);
}
function* tankWagon(out, x, yr, d, col, r, s) {
  yield* box(out, x, yr + 0.95, d, 1, 0, 8, 2.2, 0.3, [0.14, 0.13, 0.12], s, KIND.OTHER, r);
  yield* tube(out, [x - 3.6, yr + 2.35, -d], [x + 3.6, yr + 2.35, -d], 1.1, mul3(col, 0.85), s, KIND.OTHER, r, { caps: true });
  ell(out, x, yr + 3.55, -d, 0.45, 0.25, 0.45, 1, 0, 0, col, KIND.OTHER);
  bogie(out, x - 2.6, yr, d); bogie(out, x + 2.6, yr, d);
}

// A neon line between two points: a lit tube and its glow at dusk, painted glass by day.
function neon(out, a, b, rn, col, on) {
  if (on) {
    strut(out, ...a, ...b, rn, col, 2, 1, KIND.LIGHT);
    strut(out, a[0], a[1], a[2] + 0.05, b[0], b[1], b[2] + 0.05, rn * 3.5, col, 2, 0.18, KIND.LIGHT);
  } else strut(out, ...a, ...b, rn, mul3(col, 0.62), 2, 1, KIND.BUILDING);
}

// A roadside motel: a long low block of rooms with doors and windows under a walkway roof, an
// office at one end and a tall sign on a pole, its neon lit at dusk.
function* motel(ctx, out, p, r, on) {
  const x = p.x - ctx.x0, d = p.d, y0 = groundY(ctx, x, d) - 0.1, s = sOf(out, d, 0.8), kind = KIND.BUILDING;
  const units = 6 + Math.floor(r() * 5), uw = 3.6, W = units * uw, dep = 8, H = 3.2;
  const wall = [[0.78, 0.7, 0.56], [0.68, 0.76, 0.72], [0.8, 0.66, 0.6], [0.76, 0.74, 0.68]][Math.floor(r() * 4)];
  const door = [[0.22, 0.5, 0.55], [0.62, 0.2, 0.18], [0.7, 0.55, 0.16]][Math.floor(r() * 3)];
  const litRoom = [];
  for (let k = 0; k < units; k++) litRoom.push(on && r() < 0.55);
  yield* box(out, x, y0, d, 1, 0, W, dep, H, wall, s, kind, r, {
    top: [0.46, 0.44, 0.42],
    colorAt: (f, u, v, c) => {
      if (v > H - 0.45) return mul3(door, 1.1);                                // a painted fascia
      if (f !== 0) return c;
      const k = Math.floor(u / uw), fu = u - k * uw;
      if (fu > 0.5 && fu < 1.4 && v < 2.25) return door;
      if (fu > 1.9 && fu < 3.1 && v > 1.0 && v < 2.1) return litRoom[k] ? [1, 0.8, 0.5, true] : GLASS;
      return c;
    },
  });
  // the walkway roof on posts
  yield* box(out, x, y0 + 2.75, d - dep / 2 - 0.9, 1, 0, W, 1.8, 0.16, mul3(wall, 0.85), s, kind, r);
  for (let k = 0; k <= units; k++) strut(out, x - W / 2 + k * uw, y0, -(d - dep / 2 - 1.7), x - W / 2 + k * uw, y0 + 2.75, -(d - dep / 2 - 1.7), limb(0.07, d), [0.7, 0.68, 0.64], 2, 1, kind);
  if (out.due()) yield;
  const side = r() < 0.5 ? -1 : 1, ox = x + side * (W / 2 + 4);
  yield* box(out, ox, y0, d - 1, 1, 0, 6, 7, 4.2, mul3(wall, 0.95), s, kind, r, {
    top: [0.42, 0.4, 0.38],
    colorAt: (f, u, v, c) => (v > 3.7 ? mul3(door, 1.1) : f === 0 && u > 1 && u < 5 && v > 0.9 && v < 2.8 ? (on ? [1, 0.85, 0.6, true] : GLASS) : c),
  });
  // the sign: two posts and a board, a neon border and an arrow pointing down at the office
  const sx = ox + side * 7, sd = d - dep / 2 - 3, sy = y0 + 8.5 + 2 * r(), rp = limb(0.14, d);
  for (const o of [-1.4, 1.4]) strut(out, sx + o, y0, -sd, sx + o, sy, -sd, rp, [0.52, 0.5, 0.48], 3, 1, kind);
  const board = [[0.72, 0.18, 0.14], [0.16, 0.42, 0.46], [0.78, 0.62, 0.2]][Math.floor(r() * 3)];
  yield* box(out, sx, sy, sd, 1, 0, 4.8, 0.5, 2.6, board, s * 0.7, kind, r);
  const nc = [[1, 0.22, 0.4], [0.3, 1, 0.9], [1, 0.75, 0.2]][Math.floor(r() * 3)], rn = limb(0.06, d) * 1.2;
  const zf = -(sd - 0.3), corners = [[sx - 2.2, sy + 0.25], [sx + 2.2, sy + 0.25], [sx + 2.2, sy + 2.35], [sx - 2.2, sy + 2.35]];
  for (let k = 0; k < 4; k++) neon(out, [corners[k][0], corners[k][1], zf], [corners[(k + 1) % 4][0], corners[(k + 1) % 4][1], zf], rn, nc, on);
  // letters, suggested: five short uprights with bars
  for (let k = 0; k < 5; k++) {
    const lx = sx - 1.6 + k * 0.8;
    neon(out, [lx, sy + 0.8, zf], [lx, sy + 1.8, zf], rn * 0.8, [1, 0.95, 0.85], on);
    neon(out, [lx, sy + 1.8, zf], [lx + 0.45, sy + (k % 2 ? 0.8 : 1.8), zf], rn * 0.8, [1, 0.95, 0.85], on);
  }
  const ar = [[sx - side * 0.5, sy - 0.4], [sx - side * 2.5, sy - 2.2], [sx - side * 4.2, sy - 2.6]];
  for (let k = 0; k < 2; k++) neon(out, [ar[k][0], ar[k][1], zf], [ar[k + 1][0], ar[k + 1][1], zf], rn, nc, on);
  // a car or two parked in front of the rooms
  const nc2 = 1 + Math.floor(r() * 2);
  for (let k = 0; k < nc2; k++) yield* car(out, x - W / 2 + (1 + Math.floor(r() * (units - 1))) * uw, y0 + 0.1, d - dep / 2 - 4.5, r() < 0.5 ? 1 : -1, r, s * 0.7, { pickup: r() < 0.4 });
}

// A filling station: a canopy on four columns over two pumps, a kiosk, a price sign on a pole.
function* station(ctx, out, p, r, on) {
  const x = p.x - ctx.x0, d = p.d, y0 = groundY(ctx, x, d) - 0.05, s = sOf(out, d, 0.8), kind = KIND.BUILDING;
  const brand = [[0.7, 0.14, 0.1], [0.14, 0.32, 0.6], [0.2, 0.5, 0.28], [0.78, 0.55, 0.1]][Math.floor(r() * 4)];
  const L = 12, Wd = 7, ch = 4.8;
  for (const a of [-L / 2 + 1.5, L / 2 - 1.5]) for (const b of [-Wd / 2 + 1.2, Wd / 2 - 1.2]) strut(out, x + a, y0, -(d + b), x + a, y0 + ch, -(d + b), limb(0.16, d), [0.72, 0.72, 0.7], 3, 1, kind);
  yield* box(out, x, y0 + ch, d, 1, 0, L, Wd, 0.8, [0.78, 0.78, 0.76], s, kind, r, {
    top: [0.66, 0.66, 0.64],
    colorAt: (f, u, v, c) => (f < 4 && v > 0.2 && v < 0.6 ? brand : c),
  });
  // lights under the canopy at dusk
  if (on) for (let k = 0; k < 4; k++) out(x - L / 2 + 1.5 + k * (L - 3) / 3, y0 + ch - 0.05, -d, 0.5, 0.05, 0.5, 1, 0.95, 0.85, 1, 0, 0, 0, 1, KIND.LIGHT);
  for (const a of [-2.2, 2.2]) {
    yield* box(out, x + a, y0, d, 1, 0, 0.7, 0.5, 1.7, brand, s * 0.5, kind, r, { top: [0.78, 0.78, 0.76], colorAt: (f, u, v, c) => (v > 1.1 && v < 1.45 ? [0.75, 0.75, 0.72] : c) });
  }
  if (out.due()) yield;
  const kx = x + (r() < 0.5 ? -1 : 1) * (L / 2 + 6);
  yield* box(out, kx, y0, d + 4, 1, 0, 8, 6, 3.4, [0.76, 0.74, 0.68], s, kind, r, {
    top: [0.5, 0.48, 0.46],
    colorAt: (f, u, v, c) => (v > 2.9 ? brand : f === 0 && u > 1 && u < 7 && v > 0.8 && v < 2.5 ? (on ? [1, 0.9, 0.7, true] : GLASS) : c),
  });
  const px = x + (kx > x ? -1 : 1) * (L / 2 + 4), pd = d - Wd / 2 - 2, top = y0 + 9 + 2 * r();
  strut(out, px, y0, -pd, px, top, -pd, limb(0.18, d), [0.5, 0.5, 0.5], 3, 1, kind);
  yield* box(out, px, top - 0.4, pd, 1, 0, 2.8, 0.45, 3.2, brand, s * 0.6, kind, r, {
    colorAt: (f, u, v, c) => (v < 1.9 && v > 0.3 && u > 0.35 && u < 2.45 && f < 2 ? (Math.floor(v / 0.55) % 2 ? (on ? [1, 0.97, 0.85, true] : [0.78, 0.78, 0.74]) : [0.12, 0.12, 0.12]) : c),
  });
  if (r() < 0.7) yield* car(out, x + (r() - 0.5) * 3, y0, d + 1.6, r() < 0.5 ? 1 : -1, r, s * 0.7, { pickup: r() < 0.5 });
}

// A flag on a pole: the cloth flutters (MOVE.FLAG). (x, y) the top of the pole.
function flagOn(out, x, y0, z, H, col, d, ww = 1.0, hh = 0.62) {
  strut(out, x, y0, z, x, y0 + H, z, limb(0.04, d), [0.6, 0.6, 0.58], 2, 1, KIND.OTHER);
  out(x + ww * 0.5, y0 + H - hh * 0.5, z, ww * 0.5, hh * 0.5, 0.03, col[0], col[1], col[2], 1, 0, 0, 0, 1, KIND.OTHER, MOVE.FLAG);
}

// A land-speed record camp: the streamliner on its stand, a support lorry, a canopy, crew, a line
// of timing poles along the course and a line of flags stretching away across the flat.
function* speedcamp(ctx, out, p, r, beat) {
  const x = p.x - ctx.x0, d = p.d, y0 = groundY(ctx, x, d), s = sOf(out, d, 0.7);
  const livery = [[0.78, 0.16, 0.1], [0.14, 0.3, 0.7], [0.8, 0.66, 0.08], [0.78, 0.78, 0.76]][Math.floor(r() * 4)];
  const dir = r() < 0.5 ? 1 : -1;
  // the course: a dark guide line along the flat beyond the camp, timing poles beside it
  const cd = d + 16, cl = 600;
  for (let u = -cl / 2; u < cl / 2; u += 3) {
    const px = x + u;
    if (px < -4 || px > ctx.length + 4) continue;
    out(px, groundY(ctx, px, cd) + 0.12, -cd, 1.9, 0.01, 0.35, 0.16, 0.15, 0.15, 1, 0, 0, 0, 1, KIND.GROUND);
  }
  for (let u = -cl / 2; u <= cl / 2; u += 100) {
    const px = x + u, pd = cd - 3, gy = groundY(ctx, px, pd);
    strut(out, px, gy, -pd, px, gy + 4, -pd, limb(0.06, d), [0.75, 0.74, 0.7], 2, 1, KIND.OTHER);
    out(px, gy + 4.2, -pd, 0.35, 0.3, 0.3, 0.7, 0.14, 0.1, 1, 0, 0, 0, 1, KIND.OTHER);
  }
  // the streamliner: a long slim body tapering to a needle nose and a tail fin
  const L = 10 + 2 * r(), cy = y0 + 0.95, nSeg = 12;
  shadowDisc(ctx, out, x + 0.5, d + 0.5, L * 0.5, 1.0, r, 0.6);
  for (let k = 0; k < nSeg; k++) {
    const t = (k + 0.5) / nSeg, rad = 0.62 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.55) + 0.05;
    const px = x + dir * (t - 0.5) * L;
    const c = shade(livery, 0, 0.35, 0.9, 0.62, 0.5);
    ell(out, px, cy, -d, (L / nSeg) * 0.75, rad * 0.85, rad, 1, 0, 0, c, KIND.OTHER);
    ell(out, px, cy + rad * 0.55, -(d - rad * 0.3), (L / nSeg) * 0.7, rad * 0.25, rad * 0.5, 1, 0, 0, mul3(livery, 1.18), KIND.OTHER);
  }
  ell(out, x + dir * L * 0.05, cy + 0.42, -d, 0.75, 0.3, 0.35, 1, 0.1, 0, [0.1, 0.12, 0.16], KIND.OTHER);        // canopy
  ell(out, x - dir * L * 0.44, cy + 0.95, -d, 0.6, 0.85, 0.06, -dir, 1.4, 0, livery, KIND.OTHER);                 // tail fin
  strut(out, x - dir * L * 0.45, cy - 0.1, -(d - 0.62), x + dir * L * 0.4, cy - 0.1, -(d - 0.62), limb(0.06, d), [0.8, 0.8, 0.78], 3, 1, KIND.OTHER);   // a racing stripe
  for (const wx of [-0.32, 0.3]) wheel(out, x + dir * wx * L, y0 + 0.36, -(d - 0.5), 0.36, 0, 1, KIND.OTHER);
  if (out.due()) yield;
  // support lorry and a canopy with crew under it
  yield* truck(out, x - dir * (L * 0.5 + 9), y0, d + 5, dir, r, s);
  const tx = x + dir * (L * 0.5 + 7), td = d + 3;
  for (const a of [-1.6, 1.6]) for (const b of [-1.6, 1.6]) strut(out, tx + a, y0, -(td + b), tx + a, y0 + 2.5, -(td + b), limb(0.05, d), [0.7, 0.7, 0.7], 2, 1, KIND.OTHER);
  yield* box(out, tx, y0 + 2.5, td, 1, 0, 3.6, 3.6, 0.35, livery, s * 0.6, KIND.OTHER, r);
  const np = 3 + Math.floor(r() * 3);
  for (let k = 0; k < np; k++) {
    const a = r();
    person(beat, x + (r() - 0.5) * L * 1.3, y0, d - 2.2 - 3 * r(), a < 0.5 ? 1 : -1, 0, r, { hat: r() < 0.5 ? [0.75, 0.72, 0.62] : null });
  }
  // the line of flags stretching away from the line
  const fx = x + dir * (L * 0.5 + 22), fc = [[0.8, 0.2, 0.1], [0.78, 0.78, 0.76], [0.1, 0.1, 0.1]];
  for (let k = 0, fd = d - 25; fd < 275; k++, fd += 14) {
    if (fd < 40) continue;
    const gy = groundY(ctx, fx, fd);
    flagOn(out, fx + (r() - 0.5) * 0.6, gy, -fd, 3.4, fc[k % 2 ? 1 : 0], fd);
  }
}

// A herd: pronghorn, wild horses, or a coyote trio; grazing, standing, a few walking.
function* herd(ctx, out, p, r, beat) {
  const x = p.x - ctx.x0, d = p.d, t = r();
  const sp = t < 0.45 ? 'pronghorn' : 'horse';
  const n = 5 + Math.floor(r() * 8);
  const dir = r() < 0.5 ? 1 : -1, spread = sp === 'horse' ? 24 : 18;
  for (let k = 0; k < n; k++) {
    const a = r() * 6.283, rr = Math.sqrt(r());
    const px = x + Math.cos(a) * rr * spread, pd = d + Math.sin(a) * rr * spread * 0.4;
    const turn = (r() - 0.5) * 0.7, fx = Math.cos(turn) * (r() < 0.85 ? dir : -dir), fd = Math.sin(turn);
    const col = sp === 'pronghorn' ? jitter([0.66, 0.46, 0.28], r, 0.07) : jitter(HORSES[Math.floor(r() * HORSES.length)], r, 0.06);
    beast(beat, px, groundY(ctx, px, pd) - 0.03, pd, fx, fd, BEASTS[sp], col, r, { graze: r() < 0.45, socks: sp === 'horse' && r() < 0.3, dark: sp === 'pronghorn' ? [0.2, 0.15, 0.12] : null });
    if (out.due()) yield;
  }
}

// Flamingos standing and feeding in a shallow brine pool.
function* flamingos(ctx, out, p, r, beat) {
  const x = p.x - ctx.x0, d = p.d;
  const Lx = 50 + 40 * r(), Ld = 10 + 6 * r();
  const dens = Math.min(1, Math.sqrt(out.density)), sp = Math.max(0.9, 0.014 * d) / dens;
  const brine = [0.68, 0.7, 0.74], pinkish = [0.76, 0.6, 0.64];
  for (let u = -Lx / 2; u < Lx / 2; u += sp * 1.3) {
    const px = x + u;
    if (px < -2 || px > ctx.length + 2) continue;
    const half = Math.sqrt(Math.max(0, 1 - (2 * u / Lx) ** 2)) * Ld / 2;
    for (let v = -half; v < half; v += sp * 0.9) {
      const pd = d + v, e = Math.abs(v) / Math.max(0.1, half);
      let c = mix3(mix3(brine, pinkish, 0.35 + 0.3 * noise1(px * 0.05, 3)), [0.5, 0.46, 0.42], smooth(0.75, 1, e) * 0.6);
      c = jitter(c, r, 0.03);
      out(px, groundY(ctx, px, pd) + 0.18, -pd, sp * 1.0, 0.015, sp * 0.65, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    }
    if (out.due()) yield;
  }
  const n = 10 + Math.floor(r() * 18), dir = r() < 0.5 ? 1 : -1;
  for (let k = 0; k < n; k++) {
    const u = (r() - 0.5) * Lx * 0.8, half = Math.sqrt(Math.max(0, 1 - (2 * u / Lx) ** 2)) * Ld / 2;
    const px = x + u, pd = d + (r() - 0.5) * half * 1.4;
    const f = r() < 0.8 ? dir : -dir, feed = r() < 0.45;
    flamingo(beat, px, groundY(ctx, px, pd) + 0.15, pd, f, (r() - 0.5) * 0.5, r, { feed, oneLeg: !feed && r() < 0.4 });
    if (out.due()) yield;
  }
}

// A dead tree with vultures in it, more on the posts of a broken fence, and a few circling high.
function* vultures(ctx, out, p, r, beat) {
  const x = p.x - ctx.x0, d = p.d, y0 = groundY(ctx, x, d) - 0.1;
  const wood = [0.42, 0.37, 0.31], H = 6 + 3 * r();
  const perches = [];
  strut(out, x, y0, -d, x + 0.3, y0 + H * 0.55, -d, limb(0.22, d), wood, 3, 1, KIND.TREE);
  const nb = 4 + Math.floor(r() * 3);
  for (let k = 0; k < nb; k++) {
    const by = y0 + H * (0.4 + 0.12 * k), a = r() * 6.283, len = H * (0.35 + 0.25 * r());
    const bx = x + 0.3 * (by - y0) / (H * 0.55), ex = bx + Math.cos(a) * len * 0.8, ey = by + len * (0.45 + 0.4 * r()), ez = -d + Math.sin(a) * len * 0.5;
    strut(out, bx, by, -d, ex, ey, ez, limb(0.12 * (1 - k * 0.1), d), wood, 2, 1, KIND.TREE);
    const mx = lerp(bx, ex, 0.6), my = lerp(by, ey, 0.6), mz = lerp(-d, ez, 0.6);
    strut(out, mx, my, mz, mx + (r() - 0.5) * 1.6, my + 0.8 + r(), mz + (r() - 0.5) * 1.2, limb(0.06, d), wood, 1, 1, KIND.TREE);
    if (r() < 0.6) perches.push([ex * 0.4 + bx * 0.6, ey * 0.4 + by * 0.6 + 0.05, -(ez * 0.4 - d * 0.6)]);
  }
  for (const [px, py, pd] of perches) vulture(beat, px, py, pd, r, false);
  // a broken fence line: posts, a slack top wire, a bird on some posts
  const fd = d - 6, n = 6 + Math.floor(r() * 5), dir = r() < 0.5 ? 1 : -1;
  let prev = null;
  for (let k = 0; k < n; k++) {
    const px = x + dir * (6 + k * 4.2), gy = groundY(ctx, px, fd), lean = (r() - 0.5) * 0.25;
    const top = [px + lean, gy + 1.5, -fd];
    strut(out, px, gy, -fd, ...top, limb(0.07, d), wood, 2, 1, KIND.FENCE);
    if (prev && r() < 0.8) strut(out, prev[0], prev[1] - 0.15, prev[2], top[0], top[1] - 0.15, top[2], limb(0.02, d), [0.3, 0.28, 0.26], 2, 1, KIND.FENCE);
    prev = top;
    if (r() < 0.35) vulture(beat, top[0], top[1], fd, r, false);
  }
  const nc = 3 + Math.floor(r() * 3);
  for (let k = 0; k < nc; k++) vulture(beat, x + (r() - 0.5) * 50, y0 + 22 + 20 * r(), d + (r() - 0.5) * 20, r, true, r() * 6.283);
  if (out.due()) yield;
}

// A columnar cactus: a ribbed trunk and up to four arms, each turning upward.
function cactus(out, x, y0, d, H, rng) {
  const z = -d, R = limb(0.1 + H * 0.035, d), col = jitter([0.3, 0.42, 0.26], rng, 0.08), lit = mul3(col, 1.3), kind = KIND.TREE;
  strut(out, x, y0, z, x, y0 + H, z, R, col, 3, 1, kind);
  strut(out, x - R * 0.45, y0 + H * 0.1, z + R * 0.4, x - R * 0.45, y0 + H * 0.97, z + R * 0.4, R * 0.5, lit, 3, 1, kind);
  ell(out, x, y0 + H, z, R * 1.02, R * 0.8, R * 1.02, 0, 1, 0, col, kind);
  const arms = Math.floor(rng() * 5) - (H < 4 ? 2 : 0);
  for (let k = 0; k < arms; k++) {
    const a = rng() * 6.283, ay = y0 + H * (0.35 + 0.3 * rng()), out1 = 0.6 + 0.6 * rng(), up = H * (0.25 + 0.3 * rng());
    const ca = Math.cos(a), sa = Math.sin(a);
    const ex = x + ca * out1, ez = z + sa * out1 * 0.8;
    strut(out, x, ay, z, ex, ay + 0.3, ez, R * 0.8, col, 1, 1, kind);
    strut(out, ex, ay + 0.15, ez, ex, ay + up, ez, R * 0.8, col, 2, 1, kind);
    ell(out, ex, ay + up, ez, R * 0.8, R * 0.65, R * 0.8, 0, 1, 0, col, kind);
  }
}
// A boulder: a solid ellipsoid surface of splats, shaded by its normal (front and top only).
function* boulder(out, x, y, d, rx, ry, rz, col, s, rng, kind = KIND.ROCK) {
  const area = 2 * Math.PI * (rx * ry + ry * rz + rx * rz) / 3;
  const n = clamp(Math.round((area * 0.7) / (s * s)), 6, 900);
  const sz = Math.sqrt((area * 0.7) / n) * 0.85;
  for (let i = 0; i < n; i++) {
    const u = (i + rng()) / n, ph = i * 2.39996;
    const ny = 1 - 1.45 * u, rr = Math.sqrt(Math.max(0, 1 - ny * ny));
    const nx = Math.cos(ph) * rr, nz = Math.abs(Math.sin(ph) * rr) * (rng() < 0.85 ? 1 : -1);
    if (ny < -0.45) continue;
    const nn = norm3(nx / rx, ny / ry, nz / rz);
    const q = quatUpTo(nn[0], nn[1], nn[2]);
    let c = shade(col, nn[0], nn[1], nn[2], 0.5, 0.6);
    c = jitter(mul3(c, 0.9 + 0.2 * noise2(nx * 3 + x * 0.1, ny * 3, 77)), rng, 0.06);
    out.q(x + nx * rx, y + ny * ry, -(d - nz * rz), sz * 1.1, sz * 0.4, sz * 1.1, c, 1, q, kind);
    if (out.due()) yield;
  }
}

// A rocky island in the salt, crowned with tall columnar cacti, more of them at its foot.
function* cactusIsland(ctx, out, p, r) {
  const x = p.x - ctx.x0, d = p.d, s = sOf(out, d, 1.0) * (p.band === 'mid' ? 1.4 : 1);
  const Wd = (26 + 26 * r()) * (p.band === 'mid' ? 1.6 : 1), Hm = (5 + 7 * r()) * (p.band === 'mid' ? 1.4 : 1);
  const rocks = [];
  const nr = 5 + Math.floor(r() * 4);
  for (let k = 0; k < nr; k++) {
    const u = (k / (nr - 1) - 0.5) * Wd * 0.8 + (r() - 0.5) * 4;
    const h = Hm * (0.45 + 0.55 * Math.cos((u / Wd) * Math.PI) * (0.7 + 0.4 * r()));
    rocks.push({ x: x + u, d: d + (r() - 0.3) * Wd * 0.25, rx: Wd * (0.14 + 0.08 * r()), ry: h, rz: Wd * (0.14 + 0.1 * r()) });
  }
  const col = jitter([0.5, 0.38, 0.3], r, 0.08);
  for (const b of rocks) yield* boulder(out, b.x, groundY(ctx, b.x, b.d) - b.ry * 0.25, b.d, b.rx, b.ry, b.rz, jitter(col, r, 0.08), s, r);
  shadowDisc(ctx, out, x + Wd * 0.2, d + Wd * 0.1, Wd * 0.62, Wd * 0.25, r, 0.6);
  const nc = 9 + Math.floor(r() * 12);
  for (let k = 0; k < nc; k++) {
    const b = rocks[Math.floor(r() * rocks.length)];
    const a = r() * 6.283, rr = Math.sqrt(r()) * 0.75;
    const cx = b.x + Math.cos(a) * rr * b.rx, cd = b.d - Math.abs(Math.sin(a)) * rr * b.rz * 0.5;
    const top = groundY(ctx, b.x, b.d) - b.ry * 0.25 + b.ry * Math.sqrt(Math.max(0, 1 - rr * rr)) - 0.3;
    cactus(out, cx, top, cd, 3.5 + 6 * r(), r);
  }
  for (let k = 0; k < 5; k++) {
    const cx = x + (r() - 0.5) * Wd * 1.5, cd = d - Wd * 0.25 - 4 * r();
    cactus(out, cx, groundY(ctx, cx, cd) - 0.1, cd, 2.5 + 4 * r(), r);
  }
  if (out.due()) yield;
}

// A radio relay mast: a guyed triangular lattice in red and white bands, microwave dishes near the
// top, guy wires to three anchors, a hut at its foot; a red light at the top after dark.
function* relayMast(ctx, out, p, r, on) {
  const x = p.x - ctx.x0, d = p.d, y0 = groundY(ctx, x, d) - 0.2;
  const H = (34 + 16 * r()) * (p.band === 'mid' ? 1.4 : 1), w = 1.0 + H * 0.012, kind = KIND.BUILDING;
  const rr = Math.max(0.05, 0.0006 * d), bands = 7;
  const red = [0.72, 0.2, 0.15], white = [0.78, 0.78, 0.76];
  const legs = [0, 2.094, 4.189].map((a) => [Math.cos(a + 0.3) * w * 0.58, Math.sin(a + 0.3) * w * 0.58]);
  const P = (k, y) => [x + legs[k][0], y0 + y, -(d + legs[k][1])];
  const sec = Math.max(1.5, w * 1.6), ns = Math.ceil(H / sec);
  for (let j = 0; j < ns; j++) {
    const ya = j * sec, yb = Math.min(H, ya + sec), c = Math.floor((ya / H) * bands) % 2 ? white : red;
    for (let k = 0; k < 3; k++) {
      const k2 = (k + 1) % 3, tone = mul3(c, 0.8 + 0.2 * k);
      strut(out, ...P(k, ya), ...P(k, yb), rr, tone, 1, 1, kind);
      strut(out, ...P(k, ya), ...P(k2, yb), rr * 0.6, tone, 1, 1, kind);
      strut(out, ...P(k, yb), ...P(k2, yb), rr * 0.6, tone, 1, 1, kind);
    }
    if (out.due()) yield;
  }
  // guys: from three heights to three anchors on the ground
  const ga = r() * 6.283, gr = H * 0.55;
  for (const gy of [H * 0.35, H * 0.68, H * 0.97]) {
    for (let k = 0; k < 3; k++) {
      const a = ga + k * 2.094, ax = x + Math.cos(a) * gr, ad = d + Math.sin(a) * gr;
      strut(out, ...P(k, gy), ax, groundY(ctx, ax, ad) + 0.2, -ad, Math.max(0.02, 0.0005 * d), [0.32, 0.32, 0.32], 4, 1, kind);
    }
  }
  // dishes and drums near the top
  const nd = 2 + Math.floor(r() * 3);
  for (let k = 0; k < nd; k++) {
    const a = r() * 6.283, dy = y0 + H * (0.78 + 0.18 * r()), R = 0.9 + 0.6 * r();
    const nx = Math.cos(a), nz = Math.sin(a);
    const cx = x + nx * (w * 0.6 + 0.3), cz = -d + nz * (w * 0.6 + 0.3);
    ell(out, cx, dy, cz, R, R, R * 0.3, -nz, 0, nx, [0.74, 0.74, 0.72], kind);
    ell(out, cx - nx * R * 0.3, dy, cz - nz * R * 0.3, R * 0.7, R * 0.7, R * 0.25, -nz, 0, nx, [0.6, 0.6, 0.58], kind);
  }
  strut(out, x, y0 + H, -d, x, y0 + H + 3, -d, rr * 0.8, white, 1, 1, kind);
  if (on) {
    out(x, y0 + H + 3.1, -d, 0.35, 0.35, 0.35, 1, 0.16, 0.1, 1, 0, 0, 0, 1, KIND.LIGHT);
    out(x, y0 + H + 3.1, -d + 0.1, 1.4, 1.4, 0.6, 1, 0.16, 0.1, 0.2, 0, 0, 0, 1, KIND.LIGHT);
  }
  const s = sOf(out, d, 0.8);
  yield* box(out, x + w + 4, y0 + 0.2, d - 3, 1, 0, 4.2, 3.2, 2.7, [0.64, 0.62, 0.58], s, kind, r, { top: [0.5, 0.5, 0.5], colorAt: (f, u, v, c) => (f === 0 && u > 1.6 && u < 2.6 && v < 2.1 ? [0.3, 0.32, 0.34] : c) });
}

// Nodding pump jacks: a skid, the samson post, the walking beam with its horse head, the pitman
// arms and crank weights, and a storage tank.
function* pumpjacks(ctx, out, p, r) {
  const x = p.x - ctx.x0, d = p.d, s = sOf(out, d, 0.8), kind = KIND.BUILDING;
  const col = [[0.22, 0.28, 0.4], [0.7, 0.56, 0.12], [0.52, 0.2, 0.15], [0.3, 0.32, 0.3]][Math.floor(r() * 4)];
  const n = 2 + Math.floor(r() * 3), gap = 26 + 14 * r(), dir = r() < 0.5 ? 1 : -1;
  for (let k = 0; k < n; k++) {
    const px = x + (k - (n - 1) / 2) * gap + (r() - 0.5) * 6, pd = d + (r() - 0.5) * 30, y0 = groundY(ctx, px, pd);
    const rr = limb(0.12, pd), z = -pd, ph = (r() - 0.5) * 0.5;
    shadowDisc(ctx, out, px + 1, pd + 0.5, 4.5, 1.5, r, 0.64);
    yield* box(out, px, y0, pd, 1, 0, 8, 1.6, 0.45, [0.3, 0.3, 0.3], s, kind, r);
    const pv = [px, y0 + 4.6, z];
    for (const dz of [-0.7, 0.7]) {
      strut(out, px - 1.2, y0 + 0.4, z + dz, ...pv, rr, mul3(col, 0.9), 3, 1, kind);
      strut(out, px + 1.0, y0 + 0.4, z + dz, ...pv, rr, mul3(col, 0.8), 3, 1, kind);
    }
    const ca = Math.cos(ph), sa = Math.sin(ph);
    const front = [px + dir * 3.4 * ca, pv[1] - 3.4 * sa * dir * 0 - 3.4 * sa, z], back = [px - dir * 3.0 * ca, pv[1] + 3.0 * sa, z];
    strut(out, ...back, ...front, limb(0.22, pd), col, 4, 1, kind);
    // the horse head: a curved plate at the front end
    for (let k2 = 0; k2 < 4; k2++) {
      const a0 = -0.9 + k2 * 0.45, a1 = a0 + 0.45;
      strut(out, front[0] + dir * 0.6 * Math.cos(a0), front[1] + 1.1 * Math.sin(a0), z, front[0] + dir * 0.6 * Math.cos(a1), front[1] + 1.1 * Math.sin(a1), z, limb(0.2, pd), col, 1, 1, kind);
    }
    strut(out, front[0] + dir * 0.6, front[1] - 1.0, z, px + dir * 3.9, y0 + 0.5, z, limb(0.04, pd), [0.6, 0.6, 0.6], 2, 1, kind);   // the polished rod
    yield* box(out, px + dir * 3.9, y0, pd, 1, 0, 0.6, 0.6, 0.6, [0.3, 0.3, 0.3], s * 0.5, kind, r);   // wellhead
    // pitman arms down to the cranks, the counterweights and the gearbox
    const ck = [px - dir * 2.6, y0 + 1.4, z];
    for (const dz of [-0.6, 0.6]) {
      strut(out, back[0], back[1], z + dz, ck[0] + dir * 0.4, ck[1] + 0.3, z + dz, limb(0.07, pd), mul3(col, 0.9), 2, 1, kind);
      ell(out, ck[0], ck[1], z + dz, 0.9, 0.6, 0.18, 1, 0.4 * dir, 0, [0.2, 0.2, 0.2], kind);
    }
    yield* box(out, ck[0], y0 + 0.4, pd, 1, 0, 1.4, 1.0, 0.9, mul3(col, 0.8), s * 0.5, kind, r);
    if (out.due()) yield;
  }
  // a storage tank and a flow line
  const tx = x + (n / 2) * gap * 0.7 + 10, td = d + 10, ty = groundY(ctx, tx, td);
  yield* tube(out, [tx, ty, -td], [tx, ty + 5, -td], 3, [0.62, 0.6, 0.56], s, kind, r, { rib: 1.2 });
  ell(out, tx, ty + 5, -td, 3, 0.25, 3, 1, 0, 0, [0.54, 0.52, 0.5], kind);
  strut(out, x, groundY(ctx, x, d) + 0.3, -d, tx - 3, ty + 0.3, -td, limb(0.08, d), [0.3, 0.3, 0.32], 4, 1, kind);
}

// A field of hot springs: low sinter mounds stained orange, pools, and plumes of steam.
function* geysers(ctx, out, p, r) {
  const x = p.x - ctx.x0, d = p.d, big = p.band === 'mid' ? 2.2 : 1, s = sOf(out, d, 0.9);
  const n = 3 + Math.floor(r() * 4);
  for (let k = 0; k < n; k++) {
    const vx = x + (r() - 0.5) * 70 * big, vd = d + (r() - 0.5) * 30 * big, y0 = groundY(ctx, vx, vd);
    const R = (3 + 4 * r()) * big, Hm = (0.8 + 1.6 * r()) * big;
    shadowDisc(ctx, out, vx, vd, R * 1.3, R * 0.6, r, 0.85);
    yield* cone(out, vx, y0 - 0.1, -vd, R, Hm, [0.78, 0.74, 0.66], s, KIND.ROCK, r, { foot: 0.6, footCol: [0.7, 0.44, 0.24] });
    ell(out, vx, y0 + Hm + 0.05, -vd, R * 0.3, 0.05, R * 0.3, 1, 0, 0, [0.3, 0.6, 0.62], KIND.ROCK);
    // the plume: rising, widening and thinning, leaning downwind
    const H = (8 + 18 * r()) * big, np = Math.round(clamp(14 + H * 1.5, 16, 70) * Math.min(1, 0.4 + 0.6 * Math.sqrt(out.density)));
    const lean = 0.25 + 0.3 * r();
    for (let i = 0; i < np; i++) {
      const t = Math.pow((i + r()) / np, 0.8), rad = (0.6 + t * H * 0.25) * (0.8 + 0.4 * r());
      const g = 0.8;
      out(vx + lean * H * t * t + (r() - 0.5) * rad, y0 + Hm + t * H, -(vd + (r() - 0.5) * rad), rad, rad * 0.85, rad, g, g, g * 0.99, 0.5 * (1 - t * 0.75), 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
    }
    if (out.due()) yield;
  }
}

// Campers: a travel trailer with a striped awning, two folding chairs, the pickup that pulls it,
// one person sitting out and another standing.
function* camper(ctx, out, p, r, beat) {
  const x = p.x - ctx.x0, d = p.d, y0 = groundY(ctx, x, d), s = sOf(out, d, 0.7), kind = KIND.OTHER;
  const stripe = [[0.2, 0.45, 0.5], [0.62, 0.3, 0.14], [0.45, 0.2, 0.2], [0.2, 0.3, 0.5]][Math.floor(r() * 4)];
  const body = [0.78, 0.76, 0.7], L = 6.5 + r(), W = 2.4, H = 2.4;
  shadowDisc(ctx, out, x + 0.8, d + 0.8, L * 0.6, 1.6, r, 0.6);
  yield* box(out, x, y0 + 0.5, d, 1, 0, L, W, H, body, s, kind, r, {
    colorAt: (f, u, v, c) => {
      if (v > 0.55 && v < 0.85) return stripe;
      if (f === 0 && v > 1.1 && v < 1.8 && ((u > 0.6 && u < 1.8) || (u > L - 2.2 && u < L - 0.7))) return GLASS;
      if (f === 0 && u > 2.6 && u < 3.3 && v < 2.0) return mul3(c, 0.7);
      return c;
    },
  });
  for (const side of [-1, 1]) wheel(out, x, y0 + 0.4, -(d + side * 1.25), 0.4, 0, side < 0 ? 1 : -1, kind);
  strut(out, x + L / 2, y0 + 0.6, -d, x + L / 2 + 1.4, y0 + 0.45, -d, limb(0.05, d), [0.3, 0.3, 0.3], 1, 1, kind);
  // awning: from the roof edge sloping down towards the line, on two poles
  const ad = d - W / 2, aw = 2.6, ax0 = x - L / 2 + 0.6, ax1 = x + L / 2 - 1.6;
  yield* panel(out, [ax0, y0 + 0.5 + H - 0.1, -ad], [1, 0, 0], norm3(0, -0.35, 1), ax1 - ax0, aw, s * 0.8,
    (u) => (Math.floor(u / 0.6) % 2 ? stripe : [0.78, 0.76, 0.7]), kind, r);
  const ey = y0 + 0.5 + H - 0.1 - aw * 0.33, ez = -(ad - aw * 0.94);
  for (const px of [ax0, ax1]) strut(out, px, y0, ez, px, ey, ez, limb(0.035, d), [0.6, 0.6, 0.6], 1, 1, kind);
  // two folding chairs, someone in one of them, someone standing
  const chair = [[0.2, 0.35, 0.6], [0.7, 0.25, 0.15], [0.25, 0.5, 0.3]][Math.floor(r() * 3)];
  for (let k = 0; k < 2; k++) {
    const cx = x - 1.5 + k * 1.6, cd = d - W / 2 - 1.8, cy = groundY(ctx, cx, cd), rr = limb(0.03, d);
    for (const o of [-0.3, 0.3]) {
      strut(out, cx - 0.35, cy, -(cd + o), cx + 0.35, cy + 0.6, -(cd + o), rr, [0.6, 0.6, 0.6], 1, 1, kind);
      strut(out, cx + 0.35, cy, -(cd + o), cx - 0.35, cy + 0.6, -(cd + o), rr, [0.55, 0.55, 0.55], 1, 1, kind);
    }
    out(cx, cy + 0.6, -cd, 0.4, 0.05, 0.38, chair[0], chair[1], chair[2], 1, 0, 0, 0, 1, kind);
    ell(out, cx - 0.36, cy + 1.0, -cd, 0.05, 0.4, 0.36, 0.3, 1, 0, chair, kind);
    if (k === 0) person(beat, cx - 0.1, cy, cd, 1, 0, r, { pose: 'sit', seat: 0.46 });
  }
  person(beat, x + 1.8, groundY(ctx, x + 1.8, d - W / 2 - 3), d - W / 2 - 3, -1, 0.2, r, { hat: r() < 0.6 ? [0.7, 0.6, 0.4] : null });
  yield* car(out, x + L / 2 + 5.5, y0, d + 0.3, 1, r, s * 0.8, { pickup: true });
}

// A jeep on a dirt track, raising a long plume of dust behind it.
function* jeep(ctx, out, p, r) {
  const x = p.x - ctx.x0, d = p.d, y0 = groundY(ctx, x, d), s = sOf(out, d, 0.7), kind = KIND.OTHER;
  const dir = r() < 0.5 ? 1 : -1, ang = (r() - 0.5) * 0.12;
  // the track: two ruts across the flat
  const trk = (u) => d + Math.sin(u * ang * 0.02) * 10 + u * ang;
  for (let u = -300; u < 300; u += 2.5) {
    const px = x + u;
    if (px < -3 || px > ctx.length + 3) continue;
    const pd = trk(u), c = mul3(flatColor(ctx, ctx.x0 + px, pd, r, { noCells: true }), 0.82);
    for (const o of [-0.8, 0.8]) out(px, groundY(ctx, px, pd + o) + Math.min(0.3, lift(pd) * 0.45), -(pd + o), 1.6, 0.01, 0.22, c[0], c[1], c[2], 0.9, 0, 0, 0, 1, KIND.GROUND);
  }
  const col = [[0.34, 0.38, 0.26], [0.7, 0.62, 0.44], [0.55, 0.16, 0.12], [0.75, 0.74, 0.7]][Math.floor(r() * 4)];
  yield* box(out, x, y0 + 0.55, d, 1, 0, 3.8, 1.8, 0.95, col, s * 0.7, kind, r);
  for (const wx of [-1.25, 1.25]) for (const side of [-1, 1]) wheel(out, x + wx, y0 + 0.42, -(d + side * 0.95), 0.42, 0, side < 0 ? 1 : -1, kind);
  const rb = limb(0.04, d);
  for (const dz of [-0.8, 0.8]) {
    strut(out, x + dir * 0.4, y0 + 1.5, -(d + dz), x + dir * 0.55, y0 + 2.2, -(d + dz), rb, [0.2, 0.2, 0.2], 1, 1, kind);       // windscreen frame
    strut(out, x - dir * 0.8, y0 + 1.5, -(d + dz), x - dir * 0.8, y0 + 2.3, -(d + dz), rb, [0.2, 0.2, 0.2], 1, 1, kind);       // roll bar
  }
  strut(out, x + dir * 0.55, y0 + 2.2, -(d - 0.8), x + dir * 0.55, y0 + 2.2, -(d + 0.8), rb, [0.2, 0.2, 0.2], 1, 1, kind);
  strut(out, x - dir * 0.8, y0 + 2.3, -(d - 0.8), x - dir * 0.8, y0 + 2.3, -(d + 0.8), rb, [0.2, 0.2, 0.2], 1, 1, kind);
  ell(out, x + dir * 0.4, y0 + 1.75, -d, 0.09, 0.4, 0.5, 0, 1, 0, GLASS, kind);
  ell(out, x - dir * 0.2, y0 + 1.95, -(d - 0.4), 0.14, 0.16, 0.14, 0, 1, 0, SKIN[Math.floor(r() * SKIN.length)], KIND.OTHER, 1);
  wheel(out, x - dir * 2.0, y0 + 1.1, -d, 0.4, dir, 0, kind);
  // the dust: rolling up behind the wheels, growing and thinning as it falls back
  const np = Math.round(30 + 30 * Math.min(1, out.density));
  const dust = [0.8, 0.76, 0.68];
  for (let i = 0; i < np; i++) {
    const t = Math.pow((i + r()) / np, 1.2), back = 2 + t * 80, rad = 1.0 + t * 7;
    const px = x - dir * back + (r() - 0.5) * rad, pd = trk(-dir * back) + (r() - 0.5) * rad * 0.8;
    out(px, y0 + rad * 0.6 + t * 3, -pd, rad, rad * 0.75, rad, dust[0], dust[1], dust[2], 0.7 * (1 - 0.7 * t), 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
  }
  if (out.due()) yield;
}

// An abandoned airstrip: a graded strip with whitewashed tyre markers, a wind sock, the shell of a
// light aircraft and a tin shed.
function* airstrip(ctx, out, p, r) {
  const x = p.x - ctx.x0, d = p.d, s = sOf(out, d, 0.7), kind = KIND.OTHER;
  const Ls = 700, dw = 26, dens = Math.min(1, Math.sqrt(out.density));
  const sp = Math.max(1.2, 0.02 * d) / dens;
  for (let u = -Ls / 2; u < Ls / 2; u += sp * 1.4) {
    const px = x + u;
    if (px < -sp || px > ctx.length + sp) continue;
    for (let v = 0; v < dw; v += sp) {
      const pd = d + v + sp / 2, c = jitter(mix3(flatColor(ctx, ctx.x0 + px, pd, r, { noCells: true }), [0.62, 0.57, 0.5], 0.55), r, 0.04);
      out(px, groundY(ctx, px, pd) + 0.16, -pd, sp * 1.0, 0.015, sp * 0.7, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    }
    if (out.due()) yield;
  }
  for (let u = -Ls / 2; u <= Ls / 2; u += 50) {
    for (const v of [-0.5, dw + 0.5]) {
      const px = x + u, pd = d + v;
      if (px < -2 || px > ctx.length + 2) continue;
      ell(out, px, groundY(ctx, px, pd) + 0.3, -pd, 0.55, 0.3, 0.55, 1, 0, 0, [0.8, 0.8, 0.78], kind);
    }
  }
  // the wind sock: a pole and a tapering striped sleeve standing out in the wind
  const wx = x + (r() - 0.5) * 200, wd = d - 6, gy = groundY(ctx, wx, wd);
  strut(out, wx, gy, -wd, wx, gy + 6, -wd, limb(0.06, d), [0.6, 0.6, 0.6], 2, 1, kind);
  for (let k = 0; k < 5; k++) {
    const c = k % 2 ? [0.78, 0.78, 0.76] : [0.8, 0.36, 0.1], rad = 0.42 * (1 - k * 0.12);
    out(wx + 0.35 + k * 0.62, gy + 5.75 - k * 0.12, -wd, 0.34, rad, rad, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind, MOVE.FLAG);
  }
  // the aircraft: a high-wing single, nose turned a little toward the line
  const px = x + (r() - 0.5) * 120, pd = d + 6 + 8 * r(), py = groundY(ctx, px, pd);
  const ha = 0.5 + 0.5 * r(), fx = Math.cos(ha), fd = -Math.sin(ha), F = frame(px, py, pd, fx, fd);
  const pc = [0.78, 0.77, 0.74], trim = [[0.6, 0.15, 0.1], [0.15, 0.25, 0.5]][Math.floor(r() * 2)];
  for (let k = 0; k < 8; k++) {
    const t = (k + 0.5) / 8, rad = 0.62 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.25 + t * 0.85)), 0.6) + 0.12;
    ell(out, ...F(3.6 - t * 7.4, 1.2 + (t > 0.6 ? (t - 0.6) * 0.8 : 0)), 0.55, rad, rad * 0.85, ...F.dir(1, t > 0.6 ? -0.15 : 0), k === 1 ? trim : pc, kind);
  }
  ell(out, ...F(1.6, 1.85), 0.7, 0.32, 0.5, ...F.dir(1, 0.2), GLASS, kind);
  // the wing: a thin flat slab across the fuselage, on two struts
  const wq = quatBasis(...F.dir(0, 0, 1), ...F.dir(1, 0, 0));
  for (let k = -5; k <= 5; k++) {
    const P = F(1.2, 2.35, k * 1.0);
    out(P[0], P[1], P[2], 0.62, 0.85, 0.07, pc[0] * 0.95, pc[1] * 0.95, pc[2] * 0.95, 1, wq[0], wq[1], wq[2], wq[3], kind);
  }
  for (const side of [-1, 1]) strut(out, ...F(1.0, 0.9, side * 0.4), ...F(1.1, 2.3, side * 2.6), limb(0.04, d), pc, 1, 1, kind);
  ell(out, ...F(-3.9, 2.1), 0.55, 0.7, 0.06, ...F.dir(1, 0.8), trim, kind);                                         // fin
  ell(out, ...F(-3.8, 1.5), 0.45, 0.06, 1.5, ...F.dir(1, 0), pc, kind);                                              // tailplane
  for (const side of [-1, 1]) wheel(out, ...F(1.4, 0.32, side * 0.9), 0.32, fd, fx, kind);
  // a tin shed at the end of the strip
  const sx = x + (r() < 0.5 ? -1 : 1) * (Ls / 2 - 20), sd = d - 4;
  yield* box(out, sx, groundY(ctx, sx, sd) - 0.1, sd - 4, 1, 0, 10, 8, 3.6, [0.56, 0.54, 0.5], s, KIND.BUILDING, r, {
    top: [0.5, 0.36, 0.28], colorAt: (f, u, v, c) => (f === 0 && u > 2.5 && u < 7.5 && v < 3.2 ? [0.14, 0.13, 0.12] : (Math.floor(u / 0.7) % 2 ? mul3(c, 0.92) : c)),
  });
}

// A boat stranded far from any water, leaning on its keel: hull, wheelhouse, a mast.
function* boat(ctx, out, p, r) {
  const x = p.x - ctx.x0, d = p.d, y0 = groundY(ctx, x, d), s = sOf(out, d, 0.6), kind = KIND.OTHER;
  const L = 10 + 4 * r(), B = 3.2 + 0.6 * r(), Dp = 2.0, dir = r() < 0.5 ? 1 : -1, roll = 0.18 * (r() < 0.5 ? 1 : -1);
  const hull = [[0.2, 0.32, 0.5], [0.62, 0.18, 0.12], [0.74, 0.72, 0.66], [0.22, 0.4, 0.32]][Math.floor(r() * 4)];
  const fz = (z) => z;
  shadowDisc(ctx, out, x + 1, d + 1, L * 0.6, B * 0.7, r, 0.6);
  // hull stations: at each, a section from the keel up to the gunwale on both sides
  const nl = Math.max(6, Math.round(L / s)), cr = Math.cos(roll), sr = Math.sin(roll);
  for (let i = 0; i < nl; i++) {
    const t = (i + 0.5) / nl, bx = x + dir * (t - 0.5) * L;
    const half = (B / 2) * Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.85 + 0.12)), 0.5) * (t > 0.85 ? (1 - t) / 0.15 * 0.6 + 0.4 : 1);
    const keel = 0.2 + 0.7 * Math.pow(Math.abs(t - 0.45), 2);
    const na = Math.max(4, Math.round((half * 2 + Dp * 2) / s));
    for (let j = 0; j < na; j++) {
      const a = ((j + 0.5) / na) * Math.PI - Math.PI / 2;            // -90 (near side) .. +90 (far side)
      const lz = Math.sin(a) * half, ly = (1 - Math.cos(a)) * Dp * 0.9;
      const ry = keel + ly * cr - lz * sr, rz = lz * cr + ly * sr;
      const nz = -Math.sin(a), ny = -Math.cos(a) * 0.4;
      if (nz < -0.5) continue;
      const band = ly > Dp * 1.5 ? mul3(hull, 1.1) : ly < Dp * 0.5 ? [0.5, 0.26, 0.17] : hull;
      const c = jitter(shade(band, 0, ny, nz, 0.58, 0.5), r, 0.05);
      out(bx, y0 + ry, -(d + rz), (L / nl) * 0.75, s * 0.75, s * 0.15, c[0], c[1], c[2], 1, 0, 0, Math.sin(roll / 2) * (a < 0 ? 1 : 1) * 0 + 0, 1, kind);
    }
    if (out.due()) yield;
  }
  // the deck seen at the rail, a wheelhouse aft, a mast and a stay
  const gy = y0 + 0.2 + Dp * 0.9 - 0.1;
  yield* panel(out, [x - L * 0.42, gy, -(d - B * 0.42)], [1, 0, 0], [0, 0, -1], L * 0.84, B * 0.84, s, () => [0.56, 0.5, 0.42], kind, r);   // the deck
  yield* box(out, x - dir * L * 0.25, gy - 0.1, d + 0.3, 1, 0, L * 0.25, B * 0.7, 2.0, [0.74, 0.72, 0.66], s, kind, r, {
    colorAt: (f, u, v, c) => (v > 0.9 && v < 1.6 && (f > 1 || u % 1.1 < 0.7) ? GLASS : c),
  });
  const mx = x + dir * L * 0.12;
  strut(out, mx, gy, -(d + 0.3), mx + sr * 7, gy + 7, -(d + 0.3 + sr * 7), limb(0.08, d), [0.5, 0.42, 0.34], 3, 1, kind);
  strut(out, mx + sr * 7, gy + 7, -(d + 0.3 + sr * 7), x + dir * L * 0.5, gy - 0.3, -d, limb(0.02, d), [0.3, 0.3, 0.3], 3, 1, kind);
  strut(out, mx + sr * 4, gy + 4, -(d + 0.3 + sr * 4), mx - dir * 4, gy + 1.2, -(d + 0.3), limb(0.05, d), [0.5, 0.42, 0.34], 2, 1, kind);   // boom
  void fz;
}

// Hikers in file across the flat, packs on their backs.
function* walkers(ctx, out, p, r, beat) {
  const x = p.x - ctx.x0, d = p.d, dir = r() < 0.5 ? 1 : -1;
  const n = 2 + Math.floor(r() * 3), packs = [[0.6, 0.2, 0.12], [0.2, 0.35, 0.55], [0.7, 0.55, 0.15], [0.3, 0.42, 0.3]];
  for (let k = 0; k < n; k++) {
    const px = x - dir * k * (2.6 + 1.5 * r()), pd = d + (r() - 0.5) * 1.5;
    person(beat, px, groundY(ctx, px, pd), pd, dir, 0, r, { pose: 'walk', stride: r(), pack: packs[Math.floor(r() * packs.length)], hat: r() < 0.6 ? [0.72, 0.66, 0.5] : null });
  }
  if (out.due()) yield;
}

// Tufa towers: knobbly pale columns of a vanished lake, standing on the old shoreline terraces.
function* tufa(ctx, out, p, r) {
  const x = p.x - ctx.x0, d = p.d, big = p.band === 'mid' ? 1.8 : 1, s = sOf(out, d, 1.0);
  const col = [0.7, 0.66, 0.58];
  // the shoreline terraces: two or three low steps along the line behind the towers
  for (let k = 0; k < 3; k++) {
    const td = d + 12 * big + k * 9 * big, len = 260 * big;
    for (let j = 0; j < 6; j++) {
      const a = x - len / 2 + (j / 6) * len, b = a + len / 6;
      strut(out, a, groundY(ctx, a, td) + 0.4 + k * 0.5, -td, b, groundY(ctx, b, td) + 0.4 + k * 0.5, -td, Math.max(0.5, 0.005 * d) * big, mul3(DUST, 0.85 - k * 0.05), 3, 1, KIND.GROUND);
      strut(out, a, groundY(ctx, a, td) + 0.05, -(td - 0.8), b, groundY(ctx, b, td) + 0.05, -(td - 0.8), Math.max(0.4, 0.004 * d) * big, mul3(DUST, 0.62), 3, 1, KIND.GROUND);
    }
  }
  const n = 5 + Math.floor(r() * 8);
  for (let k = 0; k < n; k++) {
    const tx = x + (r() - 0.5) * 70 * big, td = d + (r() - 0.5) * 16 * big, y0 = groundY(ctx, tx, td) - 0.3;
    const H = (3 + 8 * r() * r()) * big, w = (1.2 + 1.4 * r()) * big;
    const lumps = Math.max(2, Math.round(H / (w * 0.9)));
    for (let j = 0; j < lumps; j++) {
      const t = (j + 0.5) / lumps, rw = w * (1 - 0.45 * t) * (0.85 + 0.3 * r());
      yield* boulder(out, tx + (r() - 0.5) * w * 0.4, y0 + t * H, td, rw, (H / lumps) * 0.75, rw * 0.9, jitter(col, r, 0.06), s, r);
    }
  }
}

// A dust devil: a tall twisting column of dust, widening upward and fading out (MOVE.VAPOUR).
function* dustDevil(ctx, out, p, r) {
  const x = p.x - ctx.x0, d = p.d, y0 = groundY(ctx, x, d), H = 35 + 50 * r();
  const dust = [0.74, 0.66, 0.54], np = Math.round(120 * Math.min(1, 0.4 + 0.6 * Math.sqrt(out.density)));
  for (let i = 0; i < np; i++) {
    const t = Math.pow((i + r()) / np, 1.2), y = y0 + t * H, R = 0.8 + t * t * H * 0.12;
    const a = t * 18 + (i % 3) * 2.094 + r() * 0.6, bend = Math.sin(t * 2.5) * H * 0.08;
    const rad = (0.5 + R * 0.35) * (0.8 + 0.4 * r());
    const c = mul3(dust, 0.85 + 0.25 * Math.cos(a));
    out(x + bend + Math.cos(a) * R, y, -(d + Math.sin(a) * R * 0.8), rad, rad * 1.3, rad, c[0], c[1], c[2], 0.42 * (1 - 0.7 * t), 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
  }
  for (let i = 0; i < 16; i++) {
    const a = r() * 6.283, R = 3 + 6 * r();
    out(x + Math.cos(a) * R, y0 + 0.8 + r(), -(d + Math.sin(a) * R * 0.6), 2.5, 1.5, 2.5, dust[0], dust[1], dust[2], 0.3, 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
  }
  if (out.due()) yield;
}

// A solar farm in the mid band: rows of dark panels tilted toward the line, inverter huts.
function* solarFarm(ctx, out, p, r) {
  const x = p.x - ctx.x0, d0 = p.d, rows = 8 + Math.floor(r() * 10), Lx = 260 + 360 * r();
  const tilt = 0.75, slant = 5, pitch = 10;
  const q = quatBasis(1, 0, 0, 0, Math.sin(tilt), -Math.cos(tilt));
  const panelC = [0.13, 0.17, 0.28], sky = [0.36, 0.44, 0.58];
  for (let j = 0; j < rows; j++) {
    const pd = d0 + j * pitch, s = Math.max(0.8, detail(out, pd, 0.9));
    const nu = Math.ceil(Lx / (s * 1.4)), nv = Math.max(2, Math.ceil(slant / (s * 1.3)));
    for (let i = 0; i < nu; i++) {
      const px = x - Lx / 2 + ((i + 0.5) / nu) * Lx;
      if (px < -s * 2 || px > ctx.length + s * 2) continue;
      const g = groundY(ctx, px, pd);
      for (let v = 0; v < nv; v++) {
        const t = (v + 0.5) / nv;
        const c = mix3(panelC, sky, 0.15 + 0.45 * t * t + 0.1 * (i % 7 === 0 ? 1 : 0));
        out(px, g + 0.8 + Math.sin(tilt) * slant * t, -(pd - Math.cos(tilt) * slant * (0.5 - t)), (Lx / nu) * 0.75, (slant / nv) * 0.72, 0.05, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.BUILDING);
      }
      if (out.due()) yield;
    }
  }
  const s = Math.max(0.8, detail(out, d0, 0.9));
  for (let k = 0; k < 3; k++) {
    const hx = x - Lx / 2 + (k + 0.5) * Lx / 3, hd = d0 - 8;
    yield* box(out, hx, groundY(ctx, hx, hd), hd, 1, 0, 6, 3, 3, [0.74, 0.74, 0.72], s, KIND.BUILDING, r);
  }
}

// A lattice pylon of a power line (mid band): four legs drawn in to a waist, bracing on all four
// faces, three cross-arms each side with hanging insulators. Returns the attachment points.
function pylon(out, x, y0, d, H, rng) {
  const kind = KIND.BUILDING, col = [0.56, 0.57, 0.57], rr = Math.max(0.12, 0.0006 * d);
  const foot = H * 0.13, waist = H * 0.035;
  const C = [[-1, -1, 1.1], [1, -1, 0.9], [1, 1, 0.7], [-1, 1, 0.88]];
  const hw = (t) => (t < 0.72 ? foot + (waist - foot) * (t / 0.72) : waist);
  const at = (c, t) => [x + c[0] * hw(t), y0 + t * H, -(d + c[1] * hw(t))];
  for (const c of C) strut(out, ...at(c, 0), ...at(c, 0.72), rr, mul3(col, c[2]), 4, 1, kind);
  for (const c of C) strut(out, ...at(c, 0.72), ...at(c, 1), rr * 0.8, mul3(col, c[2]), 2, 1, kind);
  const tiers = [0, 0.14, 0.27, 0.39, 0.5, 0.6, 0.72, 0.86, 1];
  for (let f = 0; f < 4; f++) {
    const a = C[f], b = C[(f + 1) % 4], k = (a[2] + b[2]) * 0.47;
    for (let i = 0; i + 1 < tiers.length; i++) {
      strut(out, ...at(a, tiers[i + 1]), ...at(b, tiers[i + 1]), rr * 0.6, mul3(col, k), 1, 1, kind);
      strut(out, ...at(a, tiers[i]), ...at(b, tiers[i + 1]), rr * 0.5, mul3(col, k), 1, 1, kind);
      strut(out, ...at(b, tiers[i]), ...at(a, tiers[i + 1]), rr * 0.5, mul3(col, k), 1, 1, kind);
    }
  }
  const pts = [];
  for (const [t, span] of [[0.74, 0.26], [0.86, 0.22], [0.97, 0.18]]) {
    const y = y0 + t * H, sp = span * H;
    for (const side of [-1, 1]) {
      // the arm runs across the line (along d), braced back to the body
      strut(out, x, y, -d, x, y, -(d + side * sp), rr * 0.8, col, 2, 1, kind);
      strut(out, x, y - H * 0.05, -(d + side * waist), x, y, -(d + side * sp), rr * 0.5, col, 1, 1, kind);
      strut(out, x, y, -(d + side * sp), x, y - 2.2, -(d + side * sp), rr * 0.7, [0.46, 0.4, 0.34], 1, 1, kind);
      pts.push([y - 2.2, d + side * sp]);
    }
  }
  strut(out, x, y0 + H, -d, x, y0 + H + H * 0.06, -d, rr * 0.6, col, 1, 1, kind);
  return pts;
}

// A wind turbine (far band): a tapering white tower, the nacelle, three blades facing the line.
function turbine(out, x, y0, d, H, rot) {
  const kind = KIND.BUILDING, w = [0.78, 0.78, 0.77], ws = [0.6, 0.61, 0.63];
  const r0 = Math.max(2.0, 0.0006 * d);
  strut(out, x, y0, -d, x, y0 + H * 0.55, -d, r0 * 1.15, w, 3, 1, kind);
  strut(out, x, y0 + H * 0.55, -d, x, y0 + H, -d, r0 * 0.85, w, 2, 1, kind);
  ell(out, x - 2, y0 + H + 1.5, -d, 6, 2.6, 2.6, 1, 0, 0.3, ws, kind);
  ell(out, x + 3.6, y0 + H + 1.5, -d + 1, 2.2, 2.2, 2.2, 1, 0, 0, w, kind);
  const Lb = H * 0.5;
  for (let k = 0; k < 3; k++) {
    const a = rot + k * 2.094, ca = Math.cos(a), sa = Math.sin(a);
    const hx = x + 3.8, hy = y0 + H + 1.5, hz = -d + 1.5;
    strut(out, hx, hy, hz, hx + ca * Lb * 0.45, hy + sa * Lb * 0.45, hz, r0 * 0.95, w, 2, 1, kind);
    strut(out, hx + ca * Lb * 0.45, hy + sa * Lb * 0.45, hz, hx + ca * Lb, hy + sa * Lb, hz, r0 * 0.6, w, 2, 1, kind);
  }
}

// ---------------------------------------------------------------------------------------------
// Where things stand: one cached list of places per world cell, chosen by stretch
// ---------------------------------------------------------------------------------------------
// The line runs through four kinds of country, each lasting a few kilometres and chosen by a slow
// world noise: salt works and old industry, the roadside, wild country and a speed-record stretch.
// Every near cell (PC metres of line) holds at most one main place and now and then a small one
// (a herd, birds, walkers, a dust devil), so one or two things are in view at a time.
const PC = 760, MC = 3400;
//   kind          works road wild record   dLo   dHi   half-length along x
const NEAR_KINDS = [
  ['saltworks',    3,    0,   0,   0.5,     70,  140,   70],
  ['ponds',        3,    0,   0.4, 0,       33,   40,  130],
  ['pumpjacks',    2,    0.5, 0,   0,       60,  150,   75],
  ['locos',        2,    0.6, 0,   0,       44,   72,   90],
  ['relay',        1.4,  0.6, 0.5, 0,      110,  220,   40],
  ['siding',       1.2,  0.4, 0,   0,     33.5, 33.5,  170],
  ['waterTower',   1,    1.5, 0,   0,       55,  150,   15],
  ['shack',        1,    1.5, 0.5, 0,       60,  200,   20],
  ['geysers',      1,    0,   1.5, 0,       95,  220,   50],
  ['motel',        0,    2.5, 0,   0.5,     70,  130,   45],
  ['station',      0,    2.5, 0,   0.5,     60,  110,   35],
  ['camper',       0,    2,   0.5, 1.5,     50,   95,   15],
  ['jeep',         0,    1.4, 0.5, 1.5,     60,  115,  300],
  ['oldCar',       0.5,  1.5, 0,   1,       45,  150,   10],
  ['windmill',     0.5,  1.5, 1,   0,       48,  130,   12],
  ['walkers',      0,    1,   0.5, 1.5,     50,   85,   10],
  ['vultures',     0,    1,   2,   0,       60,  105,   50],
  ['herd',         0,    0.5, 3,   1,       52,   95,   30],
  ['flamingos',    0.6,  0,   2.5, 0,       55,  100,   45],
  ['cactus',       0,    0,   2.5, 0,      120,  230,   45],
  ['tufa',         0,    0,   2,   0.5,     90,  200,  130],
  ['boat',         0,    0,   1.5, 1,       50,  120,   12],
  ['dustdevil',    0,    0,   1.2, 1,      130,  250,   20],
  ['rock',         0,    0.5, 1,   0,       50,  230,    6],
  ['speedcamp',    0,    0,   0,   3,       70,  120,  300],
  ['airstrip',     0,    0.5, 0,   2.5,     60,   90,  350],
];
const MINOR = ['herd', 'vultures', 'walkers', 'dustdevil', 'rock', 'oldCar', 'jeep', 'camper'];
const MID_KINDS = [
  ['solar',        2,    1.2, 0,   0.6,    340,  650,  330],
  ['relay',        1,    1,   0.6, 0.4,    420, 1000,   60],
  ['cactus',       0,    0,   2,   0.2,    360,  800,   90],
  ['tufa',         0,    0,   1.5, 0.6,    350,  700,  240],
  ['geysers',      1,    0,   1,   0,      380,  800,  110],
  ['dustdevil',    0,    0.3, 0.8, 1,      400,  900,   40],
];
const NEAR_EXT = 360, MID_EXT = 400;

const worlds = new Map();
function world(ctx) {
  const ws = worldSeed(ctx);
  let W = worlds.get(ws);
  if (W) return W;
  W = { ws, near: new Map(), mid: new Map(), raw: new Map() };
  worlds.set(ws, W);
  if (worlds.size > 6) worlds.delete(worlds.keys().next().value);
  return W;
}
// Which country a world x is in: 0 works, 1 roadside, 2 wild, 3 record.
function themeAt(ws, wx) {
  const v = noise1(wx / 9000, ws + 201) * 2.6 + noise1(wx / 2300, ws + 202) * 0.4;
  return Math.floor((v - Math.floor(v)) * 4) % 4;
}
function pick(list, th, u, avoid) {
  let tot = 0;
  for (const k of list) if (k[0] !== avoid) tot += k[1 + th];
  if (tot <= 0) return null;
  let a = u * tot;
  for (const k of list) { if (k[0] === avoid) continue; a -= k[1 + th]; if (a <= 0 && k[1 + th] > 0) return k; }
  return list.find((k) => k[0] !== avoid && k[1 + th] > 0);
}
// The kind a near cell would get before neighbours are considered (so a cell can avoid repeating
// the one before it without a chain of look-ups).
function rawKind(W, i) {
  let k = W.raw.get(i);
  if (k !== undefined) return k;
  const r = makeRng(hashInts(W.ws, 1201, i));
  const th = themeAt(W.ws, i * PC + PC / 2);
  k = pick(NEAR_KINDS, th, r(), null)[0];
  W.raw.set(i, k);
  return k;
}
function roadNear(W, wx, d, margin) {
  for (let i = Math.floor(wx / RCELL) - 1; i <= Math.floor(wx / RCELL); i++) {
    const rd = roadInWs(W.ws, i);
    if (!rd || wx < rd.sx - 30 || wx > rd.ex + 30) continue;
    const dd = roadD(rd, clamp(wx, rd.sx, rd.ex));
    if (Math.abs(dd - d) < margin) return dd;
  }
  return null;
}
function nearPlacesIn(W, i) {
  let P = W.near.get(i);
  if (P) return P;
  P = [];
  const ws = W.ws, r = makeRng(hashInts(ws, 1202, i));
  const wx0 = i * PC, th = themeAt(ws, wx0 + PC / 2);
  const busy = 0.62 + 0.3 * smooth(0.25, 0.7, noise1(wx0 / 6000, ws + 203));
  const present = r(), u = r(), xf = r(), df = r();
  if (present < busy) {
    const prev = rawKind(W, i - 1);
    const K = pick(NEAR_KINDS, th, u, prev) || NEAR_KINDS[0];
    const x = wx0 + 90 + xf * (PC - 180);
    let d = K[5] + df * (K[6] - K[5]);
    // keep clear of a dirt road and its fences
    if (K[0] !== 'siding') {
      const rd = roadNear(W, x, d, 22 + K[7] * 0.1);
      if (rd != null) d = rd + 26 + K[7] * 0.1 <= K[6] + 40 ? rd + 26 + K[7] * 0.1 : Math.max(K[5] * 0.8, rd - 26 - K[7] * 0.1);
    }
    P.push({ kind: K[0], x, d, seed: hashInts(ws, 1203, i), band: 'near', ext: K[7] });
    // now and then a small thing as well, in the other half of the cell
    if (r() < 0.3) {
      const mk = MINOR.filter((k) => k !== K[0]), mn = mk[Math.floor(r() * mk.length)], m = NEAR_KINDS.find((k) => k[0] === mn);
      const mx = xf < 0.5 ? wx0 + PC * (0.62 + 0.3 * r()) : wx0 + PC * (0.08 + 0.3 * r());
      const md = m[5] + r() * (m[6] - m[5]);
      if (roadNear(W, mx, md, 20) == null) P.push({ kind: m[0], x: mx, d: md, seed: hashInts(ws, 1204, i), band: 'near', ext: m[7] });
    }
  }
  if (W.near.size > 4000) W.near.clear();
  W.near.set(i, P);
  return P;
}
function midPlacesIn(W, i) {
  let P = W.mid.get(i);
  if (P) return P;
  P = [];
  const ws = W.ws, r = makeRng(hashInts(ws, 1302, i));
  const wx0 = i * MC, th = themeAt(ws, wx0 + MC / 2);
  if (r() < 0.55) {
    const K = pick(MID_KINDS, th, r(), null);
    if (K) P.push({ kind: K[0], x: wx0 + 400 + r() * (MC - 800), d: K[5] + r() * (K[6] - K[5]), seed: hashInts(ws, 1303, i), band: 'mid', ext: K[7] });
  }
  if (W.mid.size > 2000) W.mid.clear();
  W.mid.set(i, P);
  return P;
}

// Power line (mid band) and wind farm (far band): long stretches, world-placed.
const PYL = 330;
function pylonLine(ws) { const h = hashInts(ws, 1401) / 4294967296; return { d: 520 + 380 * h, H: 36 + 10 * h }; }
const pylonAt = (ws, k) => noise1((k * PYL) / 16000, ws + 1402) > 0.68;
const TURB = 340;
function windFarm(ws) { const h = hashInts(ws, 1501) / 4294967296; return { d: 3600 + 1400 * h, H: 84 + 16 * h }; }
const turbineAt = (ws, k) => noise1((k * TURB) / 21000, ws + 1502) > 0.7 && hashInts(ws, 1503, k) % 5 !== 0;

function* drawPlace(ctx, out, p) {
  const r = makeRng(p.seed), beat = withMove(out, MOVE.BEAT), on = lit(ctx), x = p.x - ctx.x0;
  switch (p.kind) {
    case 'saltworks': yield* saltworks(ctx, out, p, r); break;
    case 'ponds': yield* ponds(ctx, out, p, r); break;
    case 'pumpjacks': yield* pumpjacks(ctx, out, p, r); break;
    case 'locos': yield* locos(ctx, out, p, r); break;
    case 'relay': yield* relayMast(ctx, out, p, r, on); break;
    case 'siding': yield* siding(ctx, out, x, p.d, 70 + 90 * r(), r); break;
    case 'waterTower': yield* waterTower(ctx, out, x, p.d, r); break;
    case 'shack': yield* shack(ctx, out, x, p.d, r, on); break;
    case 'geysers': yield* geysers(ctx, out, p, r); break;
    case 'motel': yield* motel(ctx, out, p, r, on); break;
    case 'station': yield* station(ctx, out, p, r, on); break;
    case 'camper': yield* camper(ctx, out, p, r, beat); break;
    case 'jeep': yield* jeep(ctx, out, p, r); break;
    case 'oldCar': yield* oldCar(ctx, out, x, p.d, r); break;
    case 'windmill': yield* windmill(ctx, out, x, p.d, r); break;
    case 'walkers': yield* walkers(ctx, out, p, r, beat); break;
    case 'vultures': yield* vultures(ctx, out, p, r, beat); break;
    case 'herd': yield* herd(ctx, out, p, r, beat); break;
    case 'flamingos': yield* flamingos(ctx, out, p, r, beat); break;
    case 'cactus': yield* cactusIsland(ctx, out, p, r); break;
    case 'tufa': yield* tufa(ctx, out, p, r); break;
    case 'boat': yield* boat(ctx, out, p, r); break;
    case 'dustdevil': yield* dustDevil(ctx, out, p, r); break;
    case 'rock': { const rr = 1.5 + 2.5 * r(); yield* boulder(out, x, groundY(ctx, x, p.d) + rr * 0.15, p.d, rr * 1.2, rr * 0.7, rr, jitter([0.48, 0.38, 0.3], r, 0.12), sOf(out, p.d, 0.9), r); shadowDisc(ctx, out, x + rr * 0.5, p.d + rr * 0.3, rr * 1.4, rr * 0.7, r); break; }
    case 'speedcamp': yield* speedcamp(ctx, out, p, r, beat); break;
    case 'airstrip': yield* airstrip(ctx, out, p, r); break;
    case 'solar': yield* solarFarm(ctx, out, p, r); break;
    default: break;
  }
}
// Low things on the flat (ponds, herds, the airstrip...) would vanish behind the scrub: the scrub is
// thinned over them and in front of them, so they show from the train.
const CLEAR = { ponds: [-6, 75], airstrip: [-12, 34], flamingos: [-14, 10], herd: [-18, 14], walkers: [-12, 6], camper: [-12, 8], speedcamp: [-16, 24], jeep: [-10, 8], locos: [-10, 9], oldCar: [-8, 4], boat: [-8, 6], saltworks: [-10, 30], station: [-8, 6], motel: [-10, 6], pumpjacks: [-20, 20], vultures: [-10, 4], geysers: [-15, 15], tufa: [-10, 20] };
function clearZones(ctx) {
  const W = world(ctx), Z = [];
  for (const { i } of cellsAround(ctx, PC, NEAR_EXT + PC)) {
    for (const p of nearPlacesIn(W, i)) {
      const c = CLEAR[p.kind];
      if (!c) continue;
      const ex = Math.min(p.ext, 90) + 10;
      if (p.x + ex < ctx.x0 || p.x - ex > ctx.x0 + ctx.length) continue;
      Z.push({ xa: p.x - ex, xb: p.x + ex, da: p.d + c[0], db: p.d + c[1], front: p.d * 0.55 });
    }
  }
  return Z;
}
function cleared(Z, wx, d, rng) {
  for (const z of Z) {
    if (wx < z.xa || wx > z.xb) continue;
    if (d >= z.da && d <= z.db) return true;
    if (d >= z.front && d < z.da && rng() < 0.75) return true;
  }
  return false;
}
function* places(ctx, out, band) {
  const W = world(ctx);
  const [C, ext, fn] = band === 'near' ? [PC, NEAR_EXT, nearPlacesIn] : [MC, MID_EXT, midPlacesIn];
  for (const { i } of cellsAround(ctx, C, ext + C)) {
    for (const p of fn(W, i)) {
      if (p.x + p.ext + 20 < ctx.x0 || p.x - p.ext - 20 > ctx.x0 + ctx.length) continue;
      const n0 = out.n;
      yield* drawPlace(ctx, out, p);
      if (ctx.onPlace) ctx.onPlace(p, out.n - n0, out.n, out.limit);   // for checks: splats per place
    }
  }
}
function* powerLine(ctx, out) {
  const ws = worldSeed(ctx), L = pylonLine(ws);
  const k0 = Math.floor((ctx.x0 - 40) / PYL), k1 = Math.floor((ctx.x0 + ctx.length + 40) / PYL);
  for (let k = k0; k <= k1; k++) {
    if (!pylonAt(ws, k)) continue;
    const x = k * PYL - ctx.x0, y0 = groundY(ctx, x, L.d) - 0.3;
    const pts = pylon(out, x, y0, L.d, L.H, null);
    // conductors to the next pylon, sagging: chains of short struts
    if (pylonAt(ws, k + 1)) {
      const x2 = x + PYL, rr = Math.max(0.1, 0.0005 * L.d), seg = 16;
      for (const [y, dd] of pts) {
        for (let s = 0; s < seg; s++) {
          const a = s / seg, b = (s + 1) / seg, sag = (t) => -9 * 4 * t * (1 - t);
          strut(out, lerp(x, x2, a), y + sag(a), -dd, lerp(x, x2, b), y + sag(b), -dd, rr, [0.3, 0.3, 0.3], 1, 1, KIND.WIRE);
        }
      }
    }
    if (out.due()) yield;
  }
}
function* windTurbines(ctx, out) {
  const ws = worldSeed(ctx), F = windFarm(ws);
  const k0 = Math.floor((ctx.x0 - 60) / TURB), k1 = Math.floor((ctx.x0 + ctx.length + 60) / TURB);
  for (let k = k0; k <= k1; k++) {
    if (!turbineAt(ws, k)) continue;
    const h = hashInts(ws, 1504, k) / 4294967296, wx = k * TURB + (h - 0.5) * 60, d = F.d + (h - 0.5) * 300;
    turbine(out, wx - ctx.x0, groundY(ctx, wx - ctx.x0, d) - 1, d, F.H * (0.95 + 0.1 * h), h * 6.283);
    if (out.due()) yield;
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
  // the places: salt works, motels, herds, wrecks and the rest, one or two at a time (see world())
  yield* places(ctx, out, 'near');
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
    const rr = 0.5 + 1.4 * r();
    yield* boulder(out, x, groundY(ctx, x, d) + rr * 0.15, d, rr, rr * 0.62, rr * 0.9, jitter([0.5, 0.4, 0.32], r, 0.15), Math.max(rr * 0.35, sOf(out, d, 1.1)), r);
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
  const zones = clearZones(ctx);
  for (let k = 0; k < nS; k++) {
    const d = Math.pow(A + rng() * (B - A), 1 / 0.4);
    const x = rng() * ctx.length, wx = ctx.x0 + x;
    const cl = noise2(wx / 150, d / 150, wsd + 61);
    if (rng() > 0.25 + 1.5 * cl * cl) continue;
    if (zones.length && cleared(zones, wx, d, rng)) continue;
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
  // places out on the flat, and the power line striding along it
  yield* places(ctx, out, 'mid');
  yield* powerLine(ctx, out);
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
      // a pole and its cross-arm as struts, thick enough to stay a line at well over a kilometre
      const y0 = groundY(ctx, x, d), pr = 0.0006 * d;
      strut(out, x, y0, -d, x, y0 + 10, -d, pr, [0.34, 0.28, 0.22], 2, 1, KIND.OTHER);
      strut(out, x, y0 + 9.4, -(d - 1.6), x, y0 + 9.4, -(d + 1.6), pr * 0.8, [0.32, 0.26, 0.2], 1, 1, KIND.OTHER);
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

// The monolith of the scale dial, as a slab with sides: kit monolith() is a single card, which
// thins to a sliver at the edge of the frame.
function* slab(ctx, out, x, d, o) {
  const rng = o.rng, w = o.w, h = o.h, t = w * 0.22, col = o.color;
  const s = Math.max(Math.sqrt((w * h) / (o.n || 300)) * 0.8, 0.5);
  const base = groundY(ctx, x, d) - h * 0.05;
  yield* box(out, x, base, d + t / 2, 1, 0, w, t, h * 1.05, col, s, KIND.SURREAL, rng, { top: false, colorAt: (f, u, v, c) => mul3(c, 0.92 + 0.2 * (v / h)) });
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
  // a wind farm on the far flat
  yield* windTurbines(ctx, out);
  if (dz.scale > 0) {
    // a monolith on the skyline and a mesa of impossible height
    for (const { i, wx0 } of cellsAround(ctx, 11000, 500)) {
      const r = worldRng(ctx, 121, i);
      if (r() > 0.7 * dz.scale) continue;
      yield* slab(ctx, out, wx0 + 1500 + r() * 8000 - ctx.x0, 4200 + r() * 3500, { w: 160 + 80 * r(), h: 1100 + 1400 * r() * dz.scale, color: [0.3, 0.22, 0.24], rng: r, n: Math.round(420 * Math.sqrt(out.density)) });
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
  // On the beat the things on the flat answer, not the land: buildings, towers, masts, wagons and
  // works (BUILDING) and the cacti and dead trees (TREE), plus, tagged MOVE.BEAT by hand, the
  // people and animals. The mesas, buttes and ranges (ROCK) and the pole line stay still.
  beatKinds: [KIND.BUILDING, KIND.TREE],
  generators: { trackside, near, mid, far },
};


// layout(seed, x0, x1): where each kind of thing stands between world x0 and x1, as { kind, wx, d }.
// `seed` is the numeric world seed or a string (hashed as the previews do).
function layout(seed, x0, x1) {
  if (typeof seed === 'string') seed = hashString(seed);
  const ctx = { terrain: makeTerrain(seed, saltflatBiome.terrain), seed };
  const W = world(ctx), ws = W.ws, list = [];
  const add = (kind, wx, d) => { if (wx >= x0 && wx < x1) list.push({ kind, wx: Math.round(wx), d: Math.round(d * 10) / 10 }); };
  for (let i = Math.floor(x0 / PC) - 1; i <= Math.floor(x1 / PC) + 1; i++) for (const p of nearPlacesIn(W, i)) add(p.kind, p.x, p.d);
  for (let i = Math.floor(x0 / MC) - 1; i <= Math.floor(x1 / MC) + 1; i++) for (const p of midPlacesIn(W, i)) add(p.kind + ' (mid)', p.x, p.d);
  const pl = pylonLine(ws);
  for (let k = Math.floor(x0 / PYL); k <= x1 / PYL; k++) if (pylonAt(ws, k)) add('pylon', k * PYL, pl.d);
  const wf = windFarm(ws);
  for (let k = Math.floor(x0 / TURB); k <= x1 / TURB; k++) if (turbineAt(ws, k)) { const h = hashInts(ws, 1504, k) / 4294967296; add('turbine', k * TURB + (h - 0.5) * 60, wf.d + (h - 0.5) * 300); }
  for (let i = Math.floor(x0 / 1609); i <= x1 / 1609; i++) add('mileMarker', i * 1609 + 805, 8.2);
  for (let i = Math.floor(x0 / 90); i <= x1 / 90; i++) {
    const r = worldRng(ctx, 21, i);
    if (r() < 0.2) { const wx = i * 90 + r() * 90; add('sleeperStack', wx, 9 + 7 * r()); } else if (r() < 0.06) { const wx = i * 90 + r() * 90; add('rustSign', wx, 8.5 + 2 * r()); }
  }
  for (let i = Math.floor(x0 / 8); i <= x1 / 8; i++) {
    const wx0 = i * 8, dens = smooth(0.35, 0.75, noise1(wx0 / 320, ws + 43)), r = worldRng(ctx, 17, i);
    if (r() > 0.1 + 0.6 * dens) continue;
    const d = 8 + 22 * Math.pow(r(), 1.4), wx = wx0 + r() * 8;
    if (r() < 0.12) add('tumbleweed', wx, d);
  }
  for (let i = Math.floor(x0 / 70); i <= x1 / 70; i++) {
    const r = worldRng(ctx, 33, i);
    if (r() > 0.28) continue;
    const d = 35 * Math.pow(8.5, r()); add('smallRock', i * 70 + r() * 70, d);
  }
  for (let i = Math.floor(x0 / RCELL) - 1; i <= x1 / RCELL; i++) { const rd = roadInWs(ws, i); if (rd) add('road' + (rd.fence || rd.fence2 ? '+fence' : ''), rd.sx, rd.d0); }
  for (let i = Math.floor(x0 / 1100); i <= x1 / 1100; i++) {
    const r = worldRng(ctx, 91, i), present = r(), cx = r(), cd = r();
    if (present > 0.12 + 0.75 * smooth(0.3, 0.6, noise1((i * 1100) / 5200, ws + 95))) continue;
    add('mesa (mid)', i * 1100 + cx * 1100, 380 * Math.pow(7.2, cd));
  }
  for (let i = Math.floor(x0 / 4800); i <= x1 / 4800; i++) {
    const r = worldRng(ctx, 111, i), present = r(), cx = r(), cd = r();
    if (present > 0.12 + 0.7 * smooth(0.3, 0.62, noise1((i * 4800) / 14000, ws + 112))) continue;
    add('mesa (far)', i * 4800 + cx * 4800, 3600 + 4800 * cd);
  }
  for (let i = Math.floor(x0 / 600); i <= x1 / 600; i++) { const r = worldRng(ctx, 93, i); if (r() > 0.5) continue; const d = 330 * Math.pow(6, r() * r()); add('dune', i * 600 + r() * 600, d); }
  for (let i = Math.floor(x0 / 520); i <= x1 / 520; i++) add('logicTower (level 1)', i * 520 + 260, 78);
  return list.sort((a, b) => a.wx - b.wx);
}

export const _debug = { layout, world, nearPlacesIn, midPlacesIn, themeAt };
