// "Tropics": a railway along a tropical shore and through its jungle.
//
// The line follows the coast. In some stretches the sea is on the window's side: a white coral-sand
// beach a few tens of metres out with leaning coconut palms, then the lagoon (turquoise over sand,
// dark over coral heads), the white line of surf on the reef a few hundred metres out, deep blue
// beyond to a clean horizon, palm-topped islets and a far volcanic island. In others the shore swings
// away behind the jungle and the window looks inland: rainforest in layers, clearings with stilt
// houses, banana and pineapple plantations, a brown river with a rope bridge, waterfalls from
// forested cliffs, green volcanic hills and a tall cone with a plume far off. Afternoon showers pass
// over some stretches.
//
// Structure (as karst.js and himalaya.js): one pure layout of WORLD x and distance, cached per world
// seed and read by every band, so nothing jumps at a chunk seam or band border:
//   - coastT(wx): 0 inland .. 1 coast, from slow world noise; the shore lies 40-100 m out on the
//     coast and recedes smoothly to 5 km inland, so the coast curves away like a bay between them;
//   - the reef, headland points, islets and volcanic cones, all from world hashes;
//   - inland: the forest edge, fields, villages, the river, waterfall cliffs;
//   - showers: rain(wx), slow world noise.
// The biome's own height function (heightAt) is wrapped into a ctx copy (local()), so every kit call
// stands things on the beach, the hills and the cones. x-only quantities are tabulated once per chunk
// (xTable) on a world-x grid, so the fill reads them with one lookup and both chunks at a seam agree.
//
// The beat: palms (KIND.TREE) and buildings (KIND.BUILDING) swell on the beat; jungle crowns are
// KIND.HEDGE and stay still; boats, people, animals and birds are tagged MOVE.BEAT by hand. Washing,
// pennants, hammocks and drying nets flutter (MOVE.FLAG); spray, smoke and the volcano's plume billow
// (MOVE.VAPOUR); rain falls (MOVE.FALL).
//
// Surreal dials (gated on scale / topology / logic, all 0 at level 0, so level 0 shows none of this):
//   scale     coconut palms as tall as radio masts; flowers the size of houses on the canopy
//   topology  islets floating clear of the sea on roots of rock; boats sailing a few metres up in the
//             air; a waterfall pouring out of a cloud
//   logic     a school of huge fish swimming through the air behind the trees
import { hashInts, hashString, makeRng, noise1, noise2 } from '../rng.js';
import { makeTerrain } from '../terrain.js';
import {
  KIND, MOVE, makeOut, worldSeed, cellsAround, detail, shade, jitter, mul3, mix3, smooth, clamp, lerp, norm3,
  quatYaw, quatPitch, quatMul, quatXTo, strut, lamp, blob, treeSplats, wires, flightCell, flyBody, flyWing, Q_ID,
} from './kit.js';

// ---------------------------------------------------------------------------------------------
// Palette and constants
// ---------------------------------------------------------------------------------------------
const PAL = {
  ground: [0.3, 0.42, 0.34],        // backdrop below the horizon: between jungle green and sea
  foliage: [0.12, 0.26, 0.08],
  rock: [0.3, 0.28, 0.26],
  ballast: [0.46, 0.43, 0.38],
};

const C = {
  sand: [0.8, 0.77, 0.67],          // white coral sand (lit)
  sandBack: [0.76, 0.7, 0.56],
  wetSand: [0.58, 0.55, 0.47],
  wrack: [0.36, 0.3, 0.2],          // the line of seaweed and husks at high water
  shallow: [0.5, 0.8, 0.72],
  turq: [0.14, 0.62, 0.62],
  coral: [0.1, 0.3, 0.34],
  sandPatch: [0.44, 0.76, 0.7],
  reefFlat: [0.3, 0.66, 0.62],
  deep: [0.05, 0.22, 0.42],
  deepFar: [0.09, 0.27, 0.46],
  foam: [0.8, 0.8, 0.79],
  glint: [0.8, 0.8, 0.76],
  grass: [0.3, 0.46, 0.14],
  grassDry: [0.44, 0.48, 0.22],
  scrub: [0.18, 0.34, 0.1],
  soil: [0.42, 0.28, 0.18],         // red-brown laterite
  floor: [0.12, 0.17, 0.07],
  river: [0.44, 0.36, 0.24],
  riverLight: [0.56, 0.48, 0.34],
  bank: [0.34, 0.3, 0.18],
  // jungle
  j: [[0.07, 0.17, 0.06], [0.12, 0.27, 0.07], [0.2, 0.36, 0.09], [0.1, 0.22, 0.1], [0.27, 0.4, 0.11], [0.05, 0.14, 0.07]],
  under: [0.04, 0.09, 0.04],
  trunk: [0.42, 0.38, 0.32],
  bark: [0.3, 0.26, 0.21],
  flowers: [[0.78, 0.16, 0.08], [0.8, 0.42, 0.06], [0.8, 0.62, 0.1], [0.66, 0.16, 0.32]],
  // palms
  frond: [0.2, 0.36, 0.09],
  frondLit: [0.38, 0.52, 0.14],
  frondDead: [0.52, 0.42, 0.22],
  palmTrunk: [0.5, 0.45, 0.37],
  coconut: [0.32, 0.36, 0.1],
  banana: [0.3, 0.5, 0.12],
  // buildings
  thatch: [0.52, 0.42, 0.25],
  thatchDark: [0.36, 0.28, 0.16],
  tin: [0.5, 0.52, 0.54],
  rust: [0.48, 0.3, 0.18],
  plank: [0.42, 0.3, 0.2],
  bamboo: [0.62, 0.54, 0.36],
  post: [0.3, 0.23, 0.16],
  volcRock: [0.26, 0.23, 0.22],
  ash: [0.42, 0.38, 0.35],
};
const WALLS = [[0.62, 0.54, 0.36], [0.42, 0.3, 0.2], [0.3, 0.52, 0.56], [0.72, 0.66, 0.52], [0.66, 0.4, 0.3], [0.5, 0.58, 0.34]];
const WARM = [1.0, 0.76, 0.42];                       // lamplight: a light source (>= 0.97)
const LANTERNS = [[1.0, 0.32, 0.14], [1.0, 0.72, 0.2], [1.0, 0.5, 0.5], [0.4, 0.75, 1.0], [0.55, 1.0, 0.45]];

const SEA = -3.4;                                     // sea level: the line runs on a low embankment
const TERRAIN = { cutting: 1.2, roll: 2, rollScale: 300, rise: 0, hills: 120, hillScale: 2000, mountains: 0, mountainScale: 9000, mountainStart: 9000 };
const OFF = 0;    // a still splat
const B = MOVE.BEAT;

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------
function hourOf(ctx) { const h = ctx.hour != null ? ctx.hour : 12; return ((h % 24) + 24) % 24; }
// Lights are on from just before the dusk slot until just after the dawn one.
function lightsOn(ctx) { const h = hourOf(ctx); return h > 18.8 || h < 6.9; }
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

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
function ell(out, x, y, z, a, b, c, ux, uy, uz, col, kind, move = OFF, o = 1) {
  const q = Math.abs(uy) > 0.98 * Math.hypot(ux, uy, uz) ? quatBasis(ux, uy, uz, 1, 0, 0) : quatBasis(ux, uy, uz, 0, 1, 0);
  out(x, y, z, a, b, c, col[0], col[1], col[2], o, q[0], q[1], q[2], q[3], kind, move);
}
// A thin straight member with a motion class (kit strut() has none). z is splat space (negative).
function strutM(out, ax, ay, az, bx, by, bz, r, c, n, kind, move = OFF, o = 1) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1e-6;
  const q = quatXTo(dx / len, dy / len, dz / len), sl = (len / n) * 0.5;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    out(ax + dx * t, ay + dy * t, az + dz * t, Math.max(sl, r), r, r, c[0], c[1], c[2], o, q[0], q[1], q[2], q[3], kind, move);
  }
}
// Thickness for a limb, pole or rope at distance d: never much thinner than a pixel at 1080p.
const limb = (r, d) => Math.max(r, 0.0007 * d);
// Segments for a strut of length len whose splats are r thick: enough that the pieces overlap.
const segs = (len, r, cap = 12) => clamp(Math.ceil(len / Math.max(r * 6, 0.25)), 1, cap);
// Tone for a vertical face with outward normal (nx, nz) in splat space: the sunlit (-x) end, the
// camera-facing front and the shaded (+x) end come out clearly different, so corners read in motion.
function faceTone(c, nx, nz) {
  const k = 0.6 + 0.26 * Math.max(0, nz) + 0.4 * Math.max(0, -nx) - 0.06 * Math.max(0, nx) - 0.12 * Math.max(0, -nz);
  return [c[0] * k, c[1] * k * (1 + 0.02 * Math.max(0, nx)), c[2] * k * (1 + 0.06 * Math.max(0, nx))];
}
// Fill a parallelogram with splats on a jittered grid. o = corner, u/v = unit edge directions,
// lu/lv = edge lengths; colorAt(a, b) -> [r,g,b] (with .light for a lamp) or null for a hole.
function* panel(out, o, u, v, lu, lv, s, colorAt, kind, rng, thick = 0.12, move = OFF) {
  const nu = Math.max(1, Math.round(lu / (s * 1.4))), nv = Math.max(1, Math.round(lv / (s * 1.4)));
  const su = (lu / nu) * 0.64, sv = (lv / nv) * 0.64;
  const q = quatBasis(u[0], u[1], u[2], v[0], v[1], v[2]);
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = (i + 0.5 + (rng() - 0.5) * 0.25) / nu, b = (j + 0.5 + (rng() - 0.5) * 0.25) / nv;
      const c = colorAt(a, b);
      if (!c) continue;
      out(o[0] + u[0] * a * lu + v[0] * b * lv, o[1] + u[1] * a * lu + v[1] * b * lv, o[2] + u[2] * a * lu + v[2] * b * lv,
        su, sv, Math.max(0.02, s * thick), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], c.light ? KIND.LIGHT : kind, move);
      if (out.due()) yield;
    }
  }
}
const lit = (c) => { const l = [c[0], c[1], c[2]]; l.light = true; return l; };
// An out that tags every splat with a motion class.
function withMove(out, move) {
  const m = (x, y, z, sx, sy, sz, r, g, b, o = 1, qx = 0, qy = 0, qz = 0, qw = 1, kind = KIND.OTHER, mv) => out(x, y, z, sx, sy, sz, r, g, b, o, qx, qy, qz, qw, kind, mv != null && mv !== 0 ? mv : move);
  m.q = (x, y, z, sx, sy, sz, c, o, q, k) => m(x, y, z, sx, sy, sz, c[0], c[1], c[2], o, q ? q[0] : 0, q ? q[1] : 0, q ? q[2] : 0, q ? q[3] : 1, k);
  m.due = out.due; m.left = out.left; m.density = out.density; m.detailK = out.detailK; m.ctx = out.ctx;
  Object.defineProperty(m, 'n', { get: () => out.n });
  Object.defineProperty(m, 'limit', { get: () => out.limit, set: (v) => { out.limit = v; } });
  return m;
}

// ---------------------------------------------------------------------------------------------
// World layout (pure functions of world x and distance; cached per world seed)
// ---------------------------------------------------------------------------------------------
const worlds = new Map();
function world(ctx) {
  const ws = worldSeed(ctx);
  let W = worlds.get(ws);
  if (W) return W;
  W = { ws, misc: {}, xm: { wx: NaN, v: null } };
  W.H = (wx, d) => heightAt(W, wx, d);
  W.terr = { height: W.H, stretch: ctx.terrain.stretch, shape: ctx.terrain.shape };
  worlds.set(ws, W);
  if (worlds.size > 6) worlds.delete(worlds.keys().next().value);
  return W;
}
const locals = new WeakMap();
// A copy of ctx standing on this biome's terrain; every kit call must get this one.
function local(ctx) {
  let l = locals.get(ctx);
  if (!l) { const W = world(ctx); l = [{ ...ctx, terrain: W.terr }, W]; locals.set(ctx, l); }
  return l;
}
function cache(W, type, i, make) {
  const m = W.misc[type] || (W.misc[type] = new Map());
  let v = m.get(i);
  if (v === undefined) { v = make(); if (m.size > 20000) m.clear(); m.set(i, v); }
  return v;
}

// --- stretches along the line ---
// 1 where the sea is on the window's side, 0 inland; the change takes the best part of a kilometre.
function coastT(W, wx) { return smooth(0.4, 0.6, noise1(wx / 5200, W.ws + 11)); }
// Showers: 0 dry .. 1 heavy rain.
function rainAt(W, wx) { return smooth(0.72, 0.86, noise1(wx / 2700, W.ws + 15)); }
// Headland points jutting out to sea, one chance per 2400 m: a lighthouse stands on most.
const PCELL = 2400;
function pointSite(W, i) {
  return cache(W, 'p', i, () => {
    const r = makeRng(hashInts(W.ws, 101, i));
    if (r() > 0.5) return null;
    return { i, wx: (i + 0.25 + 0.5 * r()) * PCELL, P: 150 + 180 * r(), w: 55 + 40 * r(), light: r() < 0.8, seed: hashInts(W.ws, 102, i) };
  });
}
function pointBump(W, wx) {
  const i = Math.floor(wx / PCELL);
  let b = 0;
  for (let k = i - 1; k <= i + 1; k++) {
    const p = pointSite(W, k);
    if (p) { const t = (wx - p.wx) / p.w; if (t * t < 9) b = Math.max(b, p.P * Math.exp(-t * t)); }
  }
  return b;
}
// The x-only layout at a world x: one object, recomputed only when x changes.
// coast, shore (distance of the waterline), beach (width of the dry beach), reef (the surf line),
// rain, edge (where the forest starts inland), river (near bank, 0 for none) and riverW, field kind.
function xinfo(W, wx, o = {}) {
  const c = coastT(W, wx);
  o.coast = c;
  const near = 40 + 46 * noise1(wx / 620, W.ws + 12) + 14 * noise1(wx / 150, W.ws + 13);
  const inl = 1 - c;
  o.shore = near + pointBump(W, wx) * c + inl * inl * 5200;
  // on the coast the beach runs from a few metres off the line to the water, with patches of scrub
  o.beach = lerp(30 + 22 * noise1(wx / 380, W.ws + 14), o.shore - 9 - 16 * smooth(0.55, 0.8, noise1(wx / 240, W.ws + 23)), c * c);
  o.reef = o.shore + 250 + 260 * noise1(wx / 800, W.ws + 16);
  o.rain = rainAt(W, wx);
  // inland: the forest edge comes and goes; open fields, villages and the river lie in front of it
  let edge = 26 + 170 * smooth(0.42, 0.78, noise1(wx / 560, W.ws + 17)) + 14 * noise1(wx / 80, W.ws + 18);
  // a village clears the forest back round itself; a meadow opens up to the foot of a waterfall
  edge = Math.max(edge, clearingAt(W, wx), fallsOpening(W, wx));
  const rv = inl * smooth(0.48, 0.6, noise1(wx / 2900, W.ws + 19));
  o.river = 0; o.riverW = 0;
  if (rv > 0.5) {
    o.riverW = 22 + 22 * noise1(wx / 900, W.ws + 20);
    o.river = Math.max(32, edge * 0.55) + 30 * noise1(wx / 450, W.ws + 21);
    edge = Math.max(edge, o.river + o.riverW + 8);
  }
  // on the coast the forest gives way to a belt of palms behind the beach
  const fEnd = o.shore - o.beach - 45;
  o.edge = edge;
  o.forest = fEnd > edge ? 1 : 0;
  o.fEnd = fEnd;
  // what the open ground in front of the forest is: 0 pasture, 1 bananas, 2 pineapples, 3 grass
  const fk = noise1(wx / 1300, W.ws + 22);
  o.field = fk < 0.3 ? 0 : fk < 0.5 ? 1 : fk < 0.68 ? 2 : 3;
  return o;
}
function xAt(W, wx) {
  const m = W.xm;
  if (m.wx !== wx) { m.wx = wx; m.v = xinfo(W, wx, m.v || {}); }
  return m.v;
}

// A per-chunk table of the x-only layout on a world-x grid (step metres), linearly interpolated.
const XF = ['coast', 'shore', 'beach', 'reef', 'rain', 'edge', 'river', 'riverW', 'forest', 'fEnd', 'field'];
function xTable(W, x0, len, step) {
  const i0 = Math.floor(x0 / step) - 2, i1 = Math.ceil((x0 + len) / step) + 2;
  const n = i1 - i0 + 1;
  const T = { i0, step, n };
  for (const f of XF) T[f] = new Float32Array(n);
  const o = {};
  for (let k = 0; k < n; k++) { xinfo(W, (i0 + k) * step, o); for (const f of XF) T[f][k] = o[f]; }
  return T;
}
// Interpolated value of field f at world x.
function xv(T, f, wx) {
  const u = wx / T.step - T.i0, k = Math.max(0, Math.min(T.n - 2, Math.floor(u))), t = u - k;
  const a = T[f]; return a[k] + (a[k + 1] - a[k]) * t;
}

// --- volcanic cones (far; islands where the sea is, peaks where the land is) ---
const VCELL = 15000;
function cone(W, i) {
  return cache(W, 'v', i, () => {
    const r = makeRng(hashInts(W.ws, 201, i));
    if (r() > 0.85) return null;
    const Hc = 700 + 1300 * r();
    return { i, wx: (i + 0.2 + 0.6 * r()) * VCELL, d: 6500 + 5000 * r(), Hc, R: Hc * (2.3 + 0.9 * r()), plume: r() < 0.75, salt: Math.floor(r() * 9999), seed: hashInts(W.ws, 202, i) };
  });
}
function coneH(W, wx, d) {
  if (d < 3000) return -1e9;
  const i = Math.floor(wx / VCELL);
  let y = -1e9;
  for (let k = i - 1; k <= i + 1; k++) {
    const v = cone(W, k);
    if (!v) continue;
    const dx = wx - v.wx, dd = (d - v.d) * 0.85;
    const rr2 = (dx * dx + dd * dd) / (v.R * v.R);
    if (rr2 >= 1) continue;
    const rr = Math.sqrt(rr2);
    const a = Math.atan2(dd, dx);
    // concave flanks, gullies running down them, a crater at the top
    let h = v.Hc * Math.pow(1 - rr, 1.6) * (1 + 0.12 * (noise2(a * 5, rr * 4, v.salt) - 0.5) * rr);
    if (rr < 0.06) h -= v.Hc * 0.06 * (1 - rr / 0.06);
    y = Math.max(y, SEA - 20 + h);
  }
  return y;
}
// --- islets: a sand cay with a few palms, in the lagoon and beyond the reef ---
const ICELL = 700;
function islet(W, i) {
  return cache(W, 'i', i, () => {
    const r = makeRng(hashInts(W.ws, 211, i));
    if (r() > 0.5) return null;
    const wx = (i + 0.2 + 0.6 * r()) * ICELL;
    const x = xinfo(W, wx);
    const d = x.shore + 260 + 2600 * Math.pow(r(), 1.6);
    if (x.coast < 0.5 || Math.abs(d - x.reef) < 60) return null;
    const R = 16 + 50 * r();
    return { i, wx, d, R, h: 1.2 + 1.8 * r(), palms: 2 + Math.floor(r() * (R / 8)), seed: hashInts(W.ws, 212, i) };
  });
}
function isletAt(W, wx, d) {
  if (d < 250) return null;
  const i = Math.floor(wx / ICELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const s = islet(W, k);
    if (!s) continue;
    const dx = (wx - s.wx) / s.R, dd = (d - s.d) / (s.R * 0.8);
    if (dx * dx + dd * dd < 1) return s;
  }
  return null;
}
function isletH(s, wx, d) { const dx = (wx - s.wx) / s.R, dd = (d - s.d) / (s.R * 0.8); return SEA - 0.4 + (s.h + 0.4) * (1 - (dx * dx + dd * dd)); }

// The ground height at a world point, given the x-only layout there.
function heightX(W, wx, d, c, shore) {
  const bank = -(1.1 + 0.6 * c) * clamp((d - 2) / 6, 0, 1);
  const nf = clamp((d - 12) / 100, 0, 1);
  let y = bank;
  if (nf > 0) y += (noise2(wx / 260, d / 260, W.ws + 31) - 0.5) * 5 * nf;
  const hf = clamp((d - 220) / 1300, 0, 1);
  if (hf > 0) y += (noise2(wx / 2300, d / 1900, W.ws + 32) * 0.62 + noise2(wx / 780, d / 700, W.ws + 33) * 0.38) * 300 * hf * hf - 40 * hf;
  // the beach and the sea bed
  const u = shore - d;
  if (u < 600) {
    const beach = u > 0 ? SEA + 0.25 + 0.024 * u + 0.00035 * u * u : Math.max(SEA - 8, SEA + 0.25 + 0.03 * u);
    y = smin(y, beach, 1.5);
  }
  y = Math.max(y, coneH(W, wx, d));
  if (c < 0.3 && d > 230 && d < 2300) y += plateauH(W, wx, d);
  if (u < -150) { const s = isletAt(W, wx, d); if (s) y = Math.max(y, isletH(s, wx, d)); }
  return y;
}
function heightAt(W, wx, d) { const x = xAt(W, wx); return heightX(W, wx, d, x.coast, x.shore); }

// --- inland sites: villages of stilt houses, waterfall cliffs, rope bridges ---
const HCELL = 1100;
function clearing(W, i) {
  return cache(W, 'k', i, () => {
    const r = makeRng(hashInts(W.ws, 300, i));
    if (r() > 0.6) return null;
    return { cx: (i + 0.25 + 0.5 * r()) * HCELL, R: 45 + 45 * r(), depth: 95 + 70 * r() };
  });
}
function clearingAt(W, wx) {
  const i = Math.floor(wx / HCELL);
  let e = 0;
  for (let k = i - 1; k <= i + 1; k++) {
    const c = clearing(W, k);
    if (!c) continue;
    const t = (wx - c.cx) / (c.R + 30);
    if (t * t < 1) e = Math.max(e, c.depth * Math.sqrt(1 - t * t));
  }
  return e;
}
function village(W, i) {
  return cache(W, 'h', i, () => {
    const cl = clearing(W, i);
    if (!cl) return null;
    const r = makeRng(hashInts(W.ws, 301, i));
    const cx = cl.cx;
    const x = xinfo(W, cx);
    if (x.coast > 0.35 || x.edge < 85) return null;
    const room = (x.river ? x.river - 6 : x.edge - 10);
    if (room < 60) return null;
    const R = cl.R;
    const houses = [];
    const nh = 2 + Math.floor(r() * 5);
    for (let k = 0; k < nh; k++) {
      const wx = cx + (k / Math.max(1, nh - 1) - 0.5) * 2 * R + (r() - 0.5) * 12;
      const d = 42 + (room - 52) * r();
      houses.push({ wx, d, w: 6 + 3 * r(), dep: 5 + 2 * r(), tin: r() < 0.4, wall: WALLS[Math.floor(r() * WALLS.length)], yaw: (r() - 0.5) * 0.5 + (r() < 0.2 ? Math.PI / 2 : 0), stilt: 1.4 + 1.2 * r(), wash: r() < 0.55, seed: hashInts(W.ws, 302, i, k) });
    }
    const stall = r() < 0.6 ? { wx: cx + (r() - 0.5) * R, d: 36 + 10 * r(), seed: hashInts(W.ws, 303, i) } : null;
    return { i, cx, R, houses, stall, seed: hashInts(W.ws, 304, i) };
  });
}
const FCELL = 2600;
function falls(W, i) {
  return cache(W, 'f', i, () => {
    const r = makeRng(hashInts(W.ws, 311, i));
    if (r() > 0.6) return null;
    const wx = (i + 0.2 + 0.6 * r()) * FCELL;
    if (coastT(W, wx) > 0.15 || coastT(W, wx - 300) > 0.3 || coastT(W, wx + 300) > 0.3) return null;
    return { i, wx, d: 230 + 200 * r(), w: 100 + 80 * r(), h: 60 + 50 * r(), seed: hashInts(W.ws, 312, i) };
  });
}
// The forested plateau behind a waterfall's cliff, so the cliff is the edge of high ground.
function plateauH(W, wx, d) {
  const i = Math.floor(wx / FCELL);
  let h = 0;
  for (let k = i - 1; k <= i + 1; k++) {
    const f = falls(W, k);
    if (!f) continue;
    const a = 2 * (wx - f.wx) / f.w;
    if (a * a > 2.9) continue;
    const dFace = f.d + 0.18 * f.w * (1 - Math.min(1, a * a)) + 0.14 * f.h;
    if (d < dFace) continue;
    h = Math.max(h, f.h * (1 - 0.15 * a * a) * (1 - 0.92 * smooth(0.85, 1.7, Math.abs(a))) * smooth(dFace, dFace + 30, d) * (1 - smooth(f.d + 500, f.d + 1600, d)));
  }
  return h;
}
function fallsOpening(W, wx) {
  const i = Math.floor(wx / FCELL);
  let e = 0;
  for (let k = i - 1; k <= i + 1; k++) {
    const f = falls(W, k);
    if (!f) continue;
    const t = (wx - f.wx) / (f.w * 1.6);
    if (t * t < 1) e = Math.max(e, (f.d - 25) * Math.pow(1 - t * t, 0.35));
  }
  return e;
}
const BCELL = 900;
function ropeBridge(W, i) {
  return cache(W, 'b', i, () => {
    const r = makeRng(hashInts(W.ws, 321, i));
    if (r() > 0.55) return null;
    const wx = (i + 0.2 + 0.6 * r()) * BCELL;
    const x = xinfo(W, wx);
    if (!x.river) return null;
    return { wx, a: x.river - 4, b: x.river + x.riverW + 4, seed: hashInts(W.ws, 322, i) };
  });
}
// --- coast sites: jetties with overwater bungalows, beach bars, piers with a ferry ---
const JCELL = 1500;
function coastSite(W, i) {
  return cache(W, 'c', i, () => {
    const r = makeRng(hashInts(W.ws, 331, i));
    const wx = (i + 0.2 + 0.6 * r()) * JCELL;
    const x = xinfo(W, wx);
    if (x.coast < 0.7 || pointBump(W, wx) > 10) return null;
    const u = r();
    const kind = u < 0.42 ? 'resort' : u < 0.62 ? 'pier' : u < 0.9 ? 'bar' : null;
    if (!kind) return null;
    const s = { i, wx, kind, shore: x.shore, seed: hashInts(W.ws, 332, i) };
    if (kind === 'resort') {
      s.len = 70 + 90 * r();
      s.bungalows = [];
      for (let t = 26; t < s.len; t += 17 + 6 * r()) for (const sg of [-1, 1]) if (r() < 0.85) s.bungalows.push({ off: t, side: sg, seed: hashInts(s.seed, t | 0, sg) });
      s.bar = { wx: wx + (r() < 0.5 ? -1 : 1) * (30 + 20 * r()) };
    } else if (kind === 'pier') s.len = 140 + 110 * r();
    else s.bar = { wx };
    return s;
  });
}

// ---------------------------------------------------------------------------------------------
// The surface: what covers the ground at a world point, and its colour
// ---------------------------------------------------------------------------------------------
const T = { SAND: 0, WET: 1, WATER: 2, GRASS: 3, FOREST: 4, FIELD: 5, RIVER: 6, BANK: 7, ISLET: 8, CONE: 9, SCRUB: 10 };
const S = { t: 0, y: 0, u: 0 };
function surfaceT(W, X, wx, d) {
  const shore = xv(X, 'shore', wx), c = xv(X, 'coast', wx);
  const y = heightX(W, wx, d, c, shore);
  S.y = y; S.c = c;
  const u = shore - d;
  S.u = u;
  if (u < 0) {
    if (y > SEA + 0.05) { S.t = d > 3000 && y > SEA + 8 ? T.CONE : T.ISLET; return S; }
    S.t = T.WATER; S.y = SEA; return S;
  }
  if (u < 3) { S.t = T.WET; return S; }
  const beach = xv(X, 'beach', wx);
  if (u < beach) { S.t = T.SAND; return S; }
  if (d > 3000 && y > 60) { S.t = T.CONE; return S; }
  const rn = xv(X, 'river', wx);
  if (rn > 0) {
    const rw = xv(X, 'riverW', wx);
    if (d > rn && d < rn + rw) { S.t = T.RIVER; S.y = y - 0.9; return S; }
    if (d > rn - 5 && d < rn + rw + 5) { S.t = T.BANK; return S; }
  }
  if (u < beach + 45) { S.t = T.SCRUB; return S; }     // the palm belt behind the beach
  const edge = xv(X, 'edge', wx);
  if (d > edge && d < xv(X, 'fEnd', wx)) { S.t = T.FOREST; return S; }
  if (d > 8 && d < edge && c < 0.5) { S.t = T.FIELD; S.f = Math.round(xv(X, 'field', wx)); return S; }
  S.t = T.GRASS;
  return S;
}

// Cloud shadows drifting over land and sea: a slow darkening, 0.7..1.
function cloudShade(W, wx, d, k = 0.3) { return 1 - k * smooth(0.55, 0.75, noise2(wx / 640, d / 520, W.ws + 41)); }

function waterColor(W, X, wx, d, u, rng) {
  const reef = xv(X, 'reef', wx);
  const out = -u;                                   // metres out from the waterline
  let c;
  if (d < reef - 18) {
    // the lagoon: pale over the sand at the shore, turquoise further out, dark over coral heads
    c = mix3(C.shallow, C.turq, smooth(2, 110, out));
    // coral heads and sand patches: blotches some tens of metres across (seen this flat, finer
    // patterns turn into stripes)
    const cs = 24 + 0.06 * d;
    const coral = noise2(wx / (cs * 1.6), d / cs, W.ws + 42);
    c = mix3(c, C.coral, smooth(0.62, 0.78, coral) * smooth(25, 90, out) * 0.6);
    const sp = noise2(wx / (cs * 2.5), d / (cs * 1.2), W.ws + 43);
    c = mix3(c, C.sandPatch, smooth(0.6, 0.78, sp) * 0.5);
  } else if (d < reef + 25) {
    c = mix3(C.reefFlat, C.coral, 0.4 * noise2(wx / 9, d / 5, W.ws + 44));
  } else {
    c = mix3(C.deep, C.deepFar, smooth(reef, reef + 4000, d));
    c = mix3(c, [0.1, 0.34, 0.46], 0.4 * smooth(80, 0, d - reef - 25));     // the reef's outer slope
  }
  // wave lines: crests along the line, their spacing growing with distance (even on screen), broken
  const ph = 34 * Math.log(d) + 3 * noise1(wx / (25 + 0.15 * d), W.ws + 45);
  const w = Math.sin(ph);
  if (w > 0.6) {
    const brk = noise1(wx / (9 + 0.06 * d), W.ws + 46 + (ph / 6.283 | 0));
    c = mix3(c, [0.62, 0.78, 0.8], (w - 0.6) * 1.6 * smooth(0.35, 0.6, brk) * smooth(2500, 400, d) * 0.55);
  }
  c = mul3(c, cloudShade(W, wx, d));
  return jitter(c, rng, 0.03);
}

function landColor(W, X, s, wx, d, rng) {
  let c;
  switch (s.t) {
    case T.WET: c = mix3(C.wetSand, C.shallow, smooth(1.5, 0, s.u) * 0.4); break;
    case T.SAND: {
      const beach = xv(X, 'beach', wx);
      c = mix3(C.sand, C.sandBack, smooth(beach * 0.5, beach, s.u));
      // the wrack line at high water
      const wl = 7 + 2 * noise1(wx / 30, W.ws + 51);
      if (Math.abs(s.u - wl) < 0.5 + 0.004 * d) c = mix3(c, C.wrack, 0.5 * noise1(wx / 3, W.ws + 52) + 0.2);
      c = mul3(c, 0.95 + 0.08 * noise2(wx / 4, d / 3, W.ws + 53));
      break;
    }
    case T.SCRUB: {
      // dune grass and creepers over the sand: tufty, never a flat wash of green
      const g = smooth(0.35, 0.65, noise2(wx / 9, d / 6, W.ws + 54)) * (0.55 + 0.45 * noise2(wx / 1.3, d / 1.1, W.ws + 67));
      c = mix3(C.sandBack, rng() < 0.3 ? C.scrub : [0.42, 0.46, 0.22], g);
      break;
    }
    case T.ISLET: c = s.y > SEA + 0.4 ? C.sand : mix3(C.shallow, C.sand, 0.5); break;
    case T.CONE: {
      const h = s.y - SEA;
      c = mix3(C.j[1], C.j[3], noise2(wx / 400, d / 300, W.ws + 55));
      c = mix3(c, C.ash, smooth(700, 1100, h + 200 * noise1(wx / 300, W.ws + 56)));
      c = mix3(c, C.volcRock, smooth(1200, 1700, h));
      break;
    }
    case T.RIVER: {
      c = mix3(C.river, C.riverLight, smooth(0.7, 0.9, noise2(wx / 60, d / 3, W.ws + 57)) * 0.6);
      break;
    }
    case T.BANK: c = mix3(C.bank, C.grass, noise2(wx / 5, d / 3, W.ws + 58) * 0.6); break;
    case T.FOREST: c = C.floor; break;
    case T.FIELD: c = fieldColor(W, s.f, wx, d); break;
    default: c = mul3(mix3(C.grass, C.grassDry, noise2(wx / 13, d / 9, W.ws + 59) * 0.7), 0.85 + 0.25 * noise2(wx / 2.5, d / 2, W.ws + 60));
  }
  return jitter(mul3(c, cloudShade(W, wx, d, 0.16)), rng, 0.06);
}
function fieldColor(W, f, wx, d) {
  if (f === 2) {
    // pineapples: grey-green rows running away from the line on red soil
    const row = Math.sin(wx * 4.4 + 2 * noise1(d / 40, W.ws + 61)) > -0.25;
    return row ? [0.3, 0.4, 0.24] : C.soil;
  }
  if (f === 1) return mix3([0.24, 0.38, 0.1], C.soil, 0.35 * noise2(wx / 3, d / 3, W.ws + 62));
  if (f === 0) return mul3(mix3(C.grass, [0.38, 0.5, 0.16], noise2(wx / 20, d / 14, W.ws + 63)), 0.82 + 0.3 * noise2(wx / 2.2, d / 1.8, W.ws + 65));
  return mul3(mix3(C.grass, C.grassDry, noise2(wx / 9, d / 7, W.ws + 64)), 0.82 + 0.3 * noise2(wx / 2.2, d / 1.8, W.ws + 66));
}

// The canopy over the forest seen from outside: rounded crowns in many greens, lit from the left,
// with a dark volume under them so the forest has a body. Returns the crown-top colour; s.ch the height.
function canopyAt(W, wx, d, s) {
  const cs = 9 + 0.004 * d;                          // crown size grows a little with distance
  const a = noise2(wx / cs, d / cs, W.ws + 71), b = noise2((wx + cs * 0.35) / cs, d / cs, W.ws + 71);
  const g = noise2(wx / (cs * 4), d / (cs * 4), W.ws + 72);
  const k = Math.floor(g * 5.99);
  let c = C.j[k];
  // lit (-x) flank of each crown, the shaded flank and the dark gaps between crowns
  const lightK = 0.75 + 1.4 * (b - a) + 0.35 * a;
  c = mul3(c, clamp(lightK, 0.6, 1.35) * (0.7 + 0.45 * smooth(0.15, 0.6, a)));
  s.ch = 18 + 12 * a + 10 * g;
  return c;
}

// ---------------------------------------------------------------------------------------------
// Fills
// ---------------------------------------------------------------------------------------------
// The surface fill of a band: one splat per sample (or a canopy splat over the forest), sized from
// the local density so it is opaque at any budget, landing exactly on the band's count.
//   opts: n, dNear, dFar, power, cover, minR, maxR, canopyFrom (d beyond which forest is canopy),
//         grey (0..1 rain greying), glint (share of extra glints on the water)
function* fillSurf(ctx, out, W, X, opts = {}) {
  out.limit = Infinity;
  const n = Math.floor(opts.n != null ? opts.n : out.left());
  if (n <= 0) return;
  const rng = ctx.rng;
  const dn = opts.dNear != null ? opts.dNear : ctx.zNear, df = opts.dFar != null ? opts.dFar : ctx.zFar;
  const L = ctx.length;
  const p = opts.power != null ? opts.power : 1.5, cover = opts.cover || 3;
  const minR = opts.minR || 0.0015, maxR = opts.maxR || 0.08;
  const a1 = 1 - p;
  const A = Math.pow(dn, a1), Bp = Math.pow(df, a1);
  const Z = (Bp - A) / a1;
  const canopyFrom = opts.canopyFrom != null ? opts.canopyFrom : 1e9;
  const edgeBack = opts.edgeBack || 0;        // the edge rows of tree props stand in front of the filled canopy
  const greyK = opts.rainGrey || 0;
  const GREY = [0.52, 0.56, 0.58];
  for (let i = 0; i < n; i++) {
    const d = Math.pow(A + ((i + rng()) / n) * (Bp - A), 1 / a1);
    const x = rng() * L, wx = ctx.x0 + x;
    const dens = (n * Math.pow(d, -p) / Z) / L;
    const r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
    const s = surfaceT(W, X, wx, d);
    const ax = 0.8 + 0.5 * rng();
    let c, y = s.y, sx = r * ax, sy = r * 0.1, sz = r * (1.8 - ax), kind = KIND.GROUND;
    if (s.t === T.WATER) {
      c = waterColor(W, X, wx, d, s.u, rng);
      sx = r * 1.4 * ax; sy = r * 0.04; sz = r * 0.75;
      if (opts.glint && rng() < opts.glint) {
        // a glint of sun on a wave: small, bright, in patches
        const gz = noise2(wx / 300, d / 260, W.ws + 47);
        if (gz > 0.55) out(x, SEA + 0.05, -d, r * 0.5, r * 0.04, r * 0.12, C.glint[0], C.glint[1], C.glint[2], 0.9, 0, 0, 0, 1, KIND.GROUND);
      }
    } else if (s.t === T.FOREST && d > canopyFrom && d > xv(X, 'edge', wx) + edgeBack && d < xv(X, 'fEnd', wx) - 10) {
      c = canopyAt(W, wx, d, s);
      kind = KIND.HEDGE;
      if (rng() < 0.3) {
        // the dark body under the crowns: a tall stroke from the forest floor up to the canopy, so
        // where the forest ends or thins it is a wall and never a scatter of floating dots
        c = mul3(C.j[(wx * 0.37 + d * 0.21) & 3 ? 5 : 0], 0.55 + 0.3 * rng());
        y = s.y + s.ch * 0.42;
        sx = r * 1.5; sy = Math.max(s.ch * 0.28, r * 0.5); sz = r * 0.9;
      } else {
        y = s.y + s.ch - r * 0.35;
        sy = r * 0.75;
      }
    } else {
      c = landColor(W, X, s, wx, d, rng);
      // the banana plantation's leaf canopy, far off (near the line the plants themselves stand there)
      if (s.t === T.FIELD && s.f === 1) { y += 2.2 * smooth(110, 160, d); sy = r * 0.3; }
    }
    if (greyK > 0) { const g = xv(X, 'rain', wx); if (g > 0) c = mix3(c, GREY, greyK * g); }
    out(x, y, -d, sx, sy, sz, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    if (out.due()) yield;
  }
}

// A dense strip along the track (ballast, cess) for the trackside band.
function* fillStrip(ctx, out, n, dn, df, color, yAt, lift = 0) {
  const rng = ctx.rng, L = ctx.length;
  const r = Math.sqrt((4 * L * (df - dn)) / (Math.PI * Math.max(1, n)));
  for (let i = 0; i < n; i++) {
    const x = rng() * L, d = dn + rng() * (df - dn);
    const c = color(ctx.x0 + x, d, rng);
    out(x, yAt(ctx.x0 + x, d) + lift * rng() + 0.02, -d, r * (0.8 + 0.5 * rng()), r * 0.12, r * 0.6, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Props. Positions are chunk-local x, height y and distance d (z = -d); each takes its own rng.
// ---------------------------------------------------------------------------------------------

// A bilinear patch of splats through four corners (splat space [x, y, z]): roofs, hulls, cliff
// faces. Splats tile it on a jittered grid, each about 0.64 of its cell, so neighbours overlap.
// colorAt(a, b) -> [r,g,b] (with .light for a lamp) or null for a hole.
function* patch(out, p00, p10, p01, p11, s, colorAt, kind, rng, thick = 0.12, move = OFF) {
  const D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const lu = Math.max(D(p00, p10), D(p01, p11)), lv = Math.max(D(p00, p01), D(p10, p11));
  const nu = Math.max(1, Math.round(lu / (s * 1.4))), nv = Math.max(1, Math.round(lv / (s * 1.4)));
  const P = (a, b, k) => (1 - a) * (1 - b) * p00[k] + a * (1 - b) * p10[k] + (1 - a) * b * p01[k] + a * b * p11[k];
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = (i + 0.5 + (rng() - 0.5) * 0.2) / nu, b = (j + 0.5 + (rng() - 0.5) * 0.2) / nv;
      const c = colorAt(a, b);
      if (!c) continue;
      const ha = 0.5 / nu, hb = 0.5 / nv;
      const ux = P(a + ha, b, 0) - P(a - ha, b, 0), uy = P(a + ha, b, 1) - P(a - ha, b, 1), uz = P(a + ha, b, 2) - P(a - ha, b, 2);
      const vx = P(a, b + hb, 0) - P(a, b - hb, 0), vy = P(a, b + hb, 1) - P(a, b - hb, 1), vz = P(a, b + hb, 2) - P(a, b - hb, 2);
      const lU = Math.hypot(ux, uy, uz), lV = Math.hypot(vx, vy, vz);
      const q = lU > 1e-5 ? quatBasis(ux, uy, uz, vx, vy, vz) : quatBasis(vx, vy, vz, 1, 0, 0);
      out(P(a, b, 0), P(a, b, 1), P(a, b, 2), Math.max(lU * 0.66, s * 0.3), Math.max(lV * 0.66, s * 0.3), Math.max(0.02, s * thick),
        c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], c.light ? KIND.LIGHT : kind, move);
      if (out.due()) yield;
    }
  }
}

// --- Coconut palm ---------------------------------------------------------------------------------
// p = { x (chunk-local), y (base), d, H, lx, ld (lean per metre of height, in x and distance), seed }.
// The trunk curves: it leans out from the base and turns upward toward the crown.
function palmP(p, t) { const o = p.H * (1.4 * t - 0.4 * t * t); return [p.x + p.lx * o, p.y + p.H * t, p.d + p.ld * o]; }
// The crown: a dark core and 10-18 long fronds, each a rib (struts) with two drooping vanes of
// leaflets (flat splats either side of the rib, hanging down in a V), young fronds up, old ones
// drooping, now and then a dead one hanging brown; coconuts under it. Seen from any side the fronds
// stand out in 3D, so the crown keeps its shape across a pass.
function* coconutPalm(ctx, out, p, opts = {}) {
  const r = makeRng(p.seed);
  const d = p.d, H = p.H, kind = opts.kind != null ? opts.kind : KIND.TREE;
  const s = Math.max(0.035, detail(out, d, 1.0));
  const far = s > 0.7;
  const fk = opts.frondK || 1;
  if (out.n + (far ? 40 : 300) > out.limit) return;          // whole or not at all
  // trunk: a chain of struts, ringed, its lit (-x) side pale and its far side shaded
  const nT = clamp(Math.round(H / Math.max(0.9, s * 5)), 3, 14);
  const rt0 = Math.max(0.19 * (opts.thick || 1), s * 0.45), rt1 = Math.max(0.13 * (opts.thick || 1), s * 0.4);
  let a = palmP(p, 0);
  for (let i = 0; i < nT; i++) {
    const t = (i + 1) / nT, b = palmP(p, t), rr = lerp(rt0, rt1, t);
    const ring = (i & 1) ? 0.9 : 1.04;
    const c = mul3(C.palmTrunk, (0.78 + 0.28 * t) * ring);
    strut(out, a[0], a[1], -a[2], b[0], b[1], -b[2], rr, c, 1, 1, kind);
    if (!far) { const cs = mul3(c, 0.62); strut(out, a[0] + rr * 0.45, a[1], -(a[2] - rr * 0.2), b[0] + rr * 0.45, b[1], -(b[2] - rr * 0.2), rr * 0.6, cs, 1, 1, kind); }
    a = b;
  }
  if (out.due()) yield;
  const [tx, ty, td] = palmP(p, 1);
  // the crown's dark core, so the fronds radiate from a mass and not a point
  const core = mul3(C.frond, 0.42);
  out(tx, ty - 0.1, -td, Math.max(0.75, s), Math.max(0.55, s * 0.8), Math.max(0.75, s), core[0], core[1], core[2], 1, 0, 0, 0, 1, kind);
  out(tx, ty - 0.55, -td, 0.5, 0.45, 0.5, C.thatchDark[0], C.thatchDark[1], C.thatchDark[2], 1, 0, 0, 0, 1, kind);
  let nf = far ? 7 : d < 150 ? 13 + Math.floor(r() * 5) : 10;
  nf = Math.max(6, Math.round(nf * Math.min(1, 0.55 + 0.45 * out.density)));
  void nf;
  for (let f = 0; f < nf; f++) {
    const az = (f + 0.45 * r()) / nf * Math.PI * 2;
    const rank = r();
    const dead = rank > 0.9 && r() < 0.5;
    const e = dead ? -1.25 : lerp(0.95, -0.45, rank);
    const Lf = (3.4 + 1.6 * r()) * Math.pow(H / 12, 0.3) * fk * (dead ? 0.75 : 1);
    const g = dead ? 0.01 : (0.05 + 0.05 * r() + 0.06 * rank) / fk;
    const ca = Math.cos(az), sa = Math.sin(az);
    const ns = far ? 1 : clamp(Math.round(Lf / Math.max(0.5, s * 2.6)), 2, 7);
    const base = dead ? C.frondDead : mix3(C.frond, C.frondLit, clamp(0.55 - rank * 0.6 + 0.35 * (-ca) + 0.2 * r(), 0, 1));
    const ptAt = (L) => [tx + ca * L * Math.cos(e), ty + L * Math.sin(e) - g * L * L, td + sa * L * Math.cos(e)];
    for (let k = 0; k < ns; k++) {
      const L0 = Lf * k / ns, L1 = Lf * (k + 1) / ns, Lm = (L0 + L1) / 2;
      const p0 = ptAt(L0), p1 = ptAt(L1), pm = ptAt(Lm);
      const tH = Math.cos(e), tV = Math.sin(e) - 2 * g * Lm;
      const tl = Math.hypot(tH, tV);
      const t3 = [ca * tH / tl, tV / tl, -sa * tH / tl];          // splat space (z = -d)
      const lc = jitter(mul3(base, 0.85 + 0.25 * (1 - k / ns)), r, 0.06);
      // the rib
      strut(out, p0[0], p0[1], -p0[2], p1[0], p1[1], -p1[2], limb(far ? s * 0.4 : 0.04, d), mul3(lc, 0.8), 1, 1, kind);
      // the two vanes of leaflets, hanging down from the rib
      const sk = (k + 0.5) / ns;
      const lw = (0.95 - 0.5 * sk) * fk;
      const hang = dead ? 0.2 : 0.55 + 0.35 * sk;
      for (const sg of [-1, 1]) {
        // across the rib, horizontal, then turned down by `hang`
        let vx = -sa * sg * Math.cos(hang), vy = -Math.sin(hang), vz = -ca * sg * Math.cos(hang);
        const dt = vx * t3[0] + vy * t3[1] + vz * t3[2];
        vx -= dt * t3[0]; vy -= dt * t3[1]; vz -= dt * t3[2];
        const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
        const q = quatBasis(t3[0], t3[1], t3[2], vx, vy, vz);
        const up = vy > -0.5 ? 1 : 0.8;                          // the upper face of the vane catches the light
        const cc = mul3(lc, up * (sg > 0 ? 0.92 : 1.05));
        const hl = Math.max((Lf / ns) * 0.62, s * 0.5), hw = Math.max(lw * 0.5, s * 0.35);
        out(pm[0] + vx * hw, pm[1] + vy * hw, -pm[2] + vz * hw, hl, hw, Math.max(0.025, s * 0.1), cc[0], cc[1], cc[2], 1, q[0], q[1], q[2], q[3], kind);
      }
    }
    if (out.due()) yield;
  }
  if (!far && r() < 0.85) {
    const nc = 3 + Math.floor(r() * 5);
    for (let k = 0; k < nc; k++) {
      const az = r() * Math.PI * 2;
      const c = r() < 0.6 ? C.coconut : [0.45, 0.33, 0.16];
      out(tx + Math.cos(az) * 0.42, ty - 0.45 - 0.25 * r(), -(td + Math.sin(az) * 0.42), 0.16, 0.18, 0.16, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
  }
}
// A palm descriptor from a world rng: leaning out toward the sea (away from the line) and sideways.
function palmDesc(r, x, y, d, seaward = 1, Hs = 1) {
  const H = (9 + 7 * r()) * Hs;
  const la = (r() - 0.5) * 2.2;
  const lean = (0.12 + 0.28 * r()) * (Hs > 1.5 ? 0.3 : 1);
  return { x, y, d, H, lx: Math.sin(la) * lean, ld: Math.abs(Math.cos(la)) * lean * seaward, seed: Math.floor(r() * 4294967295) };
}

// --- Jungle --------------------------------------------------------------------------------------
// A rainforest tree: a pale trunk and a crown of overlapping leaf masses round a dark solid core, so
// it is a mass from every side, not a cloud of loose splats. `flower` paints most of it in blossom.
//   o: { H, W, rng, col, kind, flower, n }
function* jungleTree(ctx, out, x, y0, d, o) {
  const r = o.rng, H = o.H, Wc = o.W, kind = o.kind != null ? o.kind : KIND.HEDGE;
  const rs = detail(out, d, 1.5);
  const n = o.n || clamp(Math.round((Wc * Wc * 0.9) / (rs * rs)), 24, (o.cap || 300) * out.density + 24);
  // a tree is drawn whole or not at all: one cut off by the band's prop budget would leave its core
  if (out.n + n * 1.05 > out.limit) return;
  const cy = y0 + H - Wc * 0.36;
  if (n > 40) {
    const tr = Math.max(0.2, H * 0.016);
    strut(out, x, y0, -d, x + (r() - 0.5) * 1.5, cy - Wc * 0.1, -d, tr, mul3(C.trunk, 0.8 + 0.2 * r()), segs(cy - y0, tr, 6), 1, kind);
  }
  // the core: few, large, dark, well inside the outline
  const core = mul3(o.col, 0.72);
  yield* blob(ctx, out, x, cy, d, Wc * 0.22, Wc * 0.18, Wc * 0.2, { n: Math.max(3, Math.round(n * 0.1)), size: Math.max(Wc * 0.14, rs), color: core, rng: r, kind, inner: 0.2, amb: 0.7, clump: 0 });
  const lumps = n < 30 ? 1 : 3 + Math.floor(r() * 3);
  const nl = Math.round(n * 0.9 / lumps);
  for (let i = 0; i < lumps; i++) {
    const a = (i / lumps) * Math.PI * 2 + r();
    const off = lumps === 1 ? 0 : Wc * 0.24;
    const lx = x + Math.cos(a) * off, ld = d + Math.sin(a) * off * 0.5, ly = cy + (i === 0 ? Wc * 0.12 : (r() - 0.45) * Wc * 0.2);
    const lr = Wc * (lumps === 1 ? 0.5 : 0.3 + 0.08 * r());
    let col = jitter(o.col, r, 0.12);
    if (o.flower && r() < 0.8) col = mix3(col, o.flower, 0.75);
    yield* blob(ctx, out, lx, ly, ld, lr, lr * 0.78, lr * 0.9, { n: nl, color: col, rng: r, kind, inner: 0.35, amb: 0.62, clump: 0.35 });
  }
}
// An emergent giant: a tall pale trunk with buttress roots and a few limbs, holding a wide, flat
// umbrella crown above the canopy.
function* giantTree(ctx, out, x, y0, d, r) {
  const H = 42 + 14 * r(), Wc = 22 + 10 * r(), kind = KIND.HEDGE;
  const tr = Math.max(0.6, H * 0.02), top = y0 + H - 6;
  const tc = mul3(C.trunk, 1.05);
  strut(out, x, y0, -d, x, top, -d, tr, tc, segs(top - y0, tr, 8), 1, kind);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + r();
    strut(out, x + Math.cos(a) * 3.2, y0, -(d + Math.sin(a) * 2.4), x, y0 + 5, -d, tr * 0.55, mul3(tc, 0.75), 3, 1, kind);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + r();
    strut(out, x, top - 4, -d, x + Math.cos(a) * Wc * 0.35, top + 2, -(d + Math.sin(a) * Wc * 0.2), tr * 0.5, tc, 4, 1, kind);
  }
  if (out.due()) yield;
  const rs = detail(out, d, 1.5);
  const n = clamp(Math.round((Wc * Wc * 1.2) / (rs * rs)), 30, 500 * out.density + 30);
  const col = C.j[Math.floor(r() * 6)];
  yield* blob(ctx, out, x, top + 3, d, Wc * 0.36, 3.2, Wc * 0.3, { n: Math.round(n * 0.12), size: Math.max(Wc * 0.1, rs), color: mul3(col, 0.45), rng: r, kind, inner: 0.2, clump: 0 });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + r();
    yield* blob(ctx, out, x + Math.cos(a) * Wc * 0.25, top + 4 + r() * 2, d + Math.sin(a) * Wc * 0.15, Wc * 0.3, 3.5, Wc * 0.26, { n: Math.round(n * 0.22), color: jitter(col, r, 0.12), rng: r, kind, inner: 0.45, clump: 0.6 });
  }
}
// A banana plant: a green pseudostem and a fan of big, ragged leaves, each a blade of flat splats
// either side of a curving midrib, rising and then drooping, some torn into strips, the old ones
// yellowing.
function* bananaPlant(ctx, out, x, y0, d, r, opts = {}) {
  const H = (opts.H || 3.2 + 1.6 * r()), kind = opts.kind != null ? opts.kind : KIND.HEDGE;
  const s = Math.max(0.04, detail(out, d, 1.0));
  const st = y0 + H * 0.55;
  strut(out, x, y0, -d, x, st, -d, Math.max(0.13, s * 0.5), [0.32, 0.38, 0.16], 2, 1, kind);
  const nl = 6 + Math.floor(r() * 4);
  for (let k = 0; k < nl; k++) {
    const az = (k / nl) * Math.PI * 2 + r() * 0.6;
    const L = H * (0.6 + 0.25 * r());
    const old = r() < 0.12;
    const rise = old ? 0.45 : 1.0, droop = old ? 1.05 : 0.8;
    const ca = Math.cos(az), sa = Math.sin(az);
    const ns = clamp(Math.round(L / Math.max(0.4, s * 2.2)), 2, 5);
    const P = (f) => [x + ca * L * f, st + L * (rise * f - droop * f * f), d + sa * L * f * 0.9];
    const col = old ? mix3(C.banana, [0.46, 0.42, 0.16], 0.5) : jitter(mix3(C.banana, [0.36, 0.58, 0.14], r()), r, 0.1);
    const torn = r() < 0.5;
    for (let i = 0; i < ns; i++) {
      const f0 = i / ns, f1 = (i + 1) / ns, fm = (f0 + f1) / 2;
      const a = P(f0), b = P(f1), m = P(fm);
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = -(b[2] - a[2]);
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      const bw = L * 0.2 * (0.45 + Math.sin(Math.PI * (0.15 + 0.8 * fm)));
      for (const sg of [-1, 1]) {
        if (torn && fm > 0.4 && r() < 0.35) continue;          // torn away in strips
        let vx = -sa * sg, vy = -0.35, vz = -ca * sg;
        const dt = vx * tx + vy * ty + vz * tz; vx -= dt * tx; vy -= dt * ty; vz -= dt * tz;
        const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
        const q = quatBasis(tx, ty, tz, vx, vy, vz);
        const c = shade(col, vx * 0.3, 0.8, -vz * 0.3 + 0.3, 0.62, 0.5);
        const hw = Math.max(bw * 0.5, s * 0.4) * (torn && fm > 0.5 ? 0.7 : 1);
        out(m[0] + vx * hw, m[1] + vy * hw, -m[2] + vz * hw, Math.max(tl * 0.62, s * 0.5), hw, Math.max(0.02, s * 0.08), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind);
      }
    }
    if (out.due()) yield;
  }
}
// A tree fern: a dark, slender trunk and a crown of arching, finely divided fronds.
function* treeFern(ctx, out, x, y0, d, r) {
  const H = 3 + 3.5 * r(), kind = KIND.HEDGE;
  const p = { x, y: y0, d, H, lx: (r() - 0.5) * 0.15, ld: (r() - 0.5) * 0.1, seed: Math.floor(r() * 4294967295) };
  const top = palmP(p, 1);
  strut(out, x, y0, -d, top[0], top[1], -top[2], 0.14, [0.18, 0.13, 0.09], 3, 1, kind);
  const s = Math.max(0.04, detail(out, d, 1.0));
  const nf = 9 + Math.floor(r() * 5);
  out(top[0], top[1], -top[2], 0.35, 0.25, 0.35, 0.12, 0.2, 0.06, 1, 0, 0, 0, 1, kind);
  for (let f = 0; f < nf; f++) {
    const az = (f + 0.4 * r()) / nf * Math.PI * 2, e = 0.5 - 0.6 * r(), L = 2 + 0.9 * r(), g = 0.12 + 0.06 * r();
    const ca = Math.cos(az), sa = Math.sin(az);
    const ns = clamp(Math.round(L / Math.max(0.35, s * 2.4)), 2, 5);
    const pt = (l) => [top[0] + ca * l * Math.cos(e), top[1] + l * Math.sin(e) - g * l * l, top[2] + sa * l * Math.cos(e)];
    for (let k = 0; k < ns; k++) {
      const l0 = L * k / ns, l1 = L * (k + 1) / ns, a = pt(l0), b = pt(l1), m = pt((l0 + l1) / 2);
      let tx = b[0] - a[0], ty = b[1] - a[1], tz = -(b[2] - a[2]);
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      const q = quatBasis(tx, ty, tz, -sa, 0.25, -ca);
      const c = jitter(mix3([0.2, 0.42, 0.1], [0.32, 0.52, 0.14], r()), r, 0.08);
      const hw = Math.max(0.42 * (1 - 0.6 * k / ns), s * 0.4);
      out(m[0], m[1], -m[2], Math.max(tl * 0.62, s * 0.5), hw, 0.03, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind);
    }
    if (out.due()) yield;
  }
}
// A liana hanging in a loop from a crown down toward the forest floor.
function liana(out, x, yTop, d, len, r) {
  const sw = (r() - 0.5) * 4, n = 6, rr = limb(0.05, d);
  let px = x, py = yTop;
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const nx = x + sw * Math.sin(Math.PI * t), ny = yTop - len * t + 1.2 * Math.sin(Math.PI * t * 2) * (1 - t);
    strut(out, px, py, -d + 0.2, nx, ny, -d + 0.2, rr, [0.2, 0.2, 0.09], 1, 1, KIND.HEDGE);
    px = nx; py = ny;
  }
}

// --- Buildings -----------------------------------------------------------------------------------
// A hut standing on a floor at yf: four walls with windows and a door, under a palm-thatch or tin
// roof, gabled (both slopes and both gable triangles) or hipped (four slopes). Every face a passing
// train sees is drawn, the front, the sunlit end and the shaded end in clearly different tones.
//   o: { w, dep, h, roof: 'gable'|'hip', tin, wall, yaw, lit (0..1), seed, s, kind, rng }
function* hut(ctx, out, x, yf, d, o) {
  const r = o.rng, w = o.w, dep = o.dep, h = o.h || 2.6;
  const yaw = o.yaw || 0, kind = o.kind != null ? o.kind : KIND.BUILDING;
  const s = o.s || Math.max(0.1, detail(out, d, 1.0));
  const ex = Math.cos(yaw), ez = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
  const Pt = (lx, ly, lz) => [x + ex * lx + fx * lz, yf + ly, -d + ez * lx + fz * lz];
  const wall = o.wall || C.bamboo, litShare = o.lit || 0;
  const lightOf = (i) => litShare > 0 && ((hashInts(o.seed || 1, i) & 1023) / 1023) < litShare;
  const win = [0.08, 0.07, 0.06], door = [0.16, 0.11, 0.08];
  const glow = lit(WARM);
  // walls: front, back, the two ends
  const faces = [
    [Pt(-w / 2, 0, dep / 2), [ex, 0, ez], w, [fx, fz], 0],
    [Pt(-w / 2, 0, -dep / 2), [ex, 0, ez], w, [-fx, -fz], 1],
    [Pt(-w / 2, 0, -dep / 2), [fx, 0, fz], dep, [-ex, -ez], 2],
    [Pt(w / 2, 0, -dep / 2), [fx, 0, fz], dep, [ex, ez], 3],
  ];
  for (const [o0, u, len, nrm, fi] of (o.noWalls ? [] : faces)) {
    const tone = faceTone(wall, nrm[0], nrm[1]);
    const nw = fi < 2 ? Math.max(1, Math.floor(len / 2.6)) : 1;
    yield* panel(out, o0, u, [0, 1, 0], len, h, s, (a, b) => {
      const y = b * h;
      if (y > h - 0.3) return mul3(tone, 0.55);                      // shadow under the eaves
      const f = a * nw, ix = f - Math.floor(f), col = Math.floor(f);
      if (fi === 0 && col === Math.floor(nw / 2) && ix > 0.3 && ix < 0.7 && y < 2.0) return door;
      if (ix > 0.3 && ix < 0.7 && y > 0.9 && y < 1.7) return lightOf(fi * 8 + col) ? glow : win;
      // woven or planked: faint horizontal courses
      return mul3(tone, 0.93 + 0.1 * ((Math.floor(y / 0.35) & 1)));
    }, kind, r);
  }
  // the roof
  const ov = 0.6, top = h + (o.roof === 'hip' ? dep * 0.62 : dep * 0.5);
  const rc = o.tin ? (o.rust ? C.rust : C.tin) : C.thatch;
  const tex = (a, b, nY) => {
    let c = shade(rc, 0, nY, 0.4, 0.6, 0.5);
    if (o.tin) c = mul3(c, 0.9 + 0.14 * ((Math.floor(a * w * 3) & 1)) * (1 - 0.3 * noise2(a * 6, b * 3, 9)));
    else c = mul3(c, 0.82 + 0.25 * noise2(a * w * 1.2, b * 7, o.seed & 255) - 0.12 * ((Math.floor(b * 7) & 1)));
    return b < 0.08 ? mul3(c, 0.7) : c;                                   // the shadowed eave edge
  };
  const E = [Pt(-w / 2 - ov, h - 0.15, dep / 2 + ov), Pt(w / 2 + ov, h - 0.15, dep / 2 + ov), Pt(-w / 2 - ov, h - 0.15, -dep / 2 - ov), Pt(w / 2 + ov, h - 0.15, -dep / 2 - ov)];
  if (o.roof === 'hip') {
    const rl = Math.max(0, (w - dep) / 2);
    const A = Pt(-rl, top, 0), Bq = Pt(rl, top, 0);
    yield* patch(out, E[0], E[1], A, Bq, s, (a, b) => tex(a, b, 0.75), kind, r);
    yield* patch(out, E[2], E[3], A, Bq, s, (a, b) => mul3(tex(a, b, 0.75), 0.82), kind, r);
    yield* patch(out, E[0], E[2], A, A, s, (a, b) => mul3(tex(a, b, 0.75), 1.08), kind, r);
    yield* patch(out, E[1], E[3], Bq, Bq, s, (a, b) => mul3(tex(a, b, 0.75), 0.7), kind, r);
  } else {
    const A = Pt(-w / 2 - ov, top, 0), Bq = Pt(w / 2 + ov, top, 0);
    yield* patch(out, E[0], E[1], A, Bq, s, (a, b) => tex(a, b, 0.7), kind, r);
    yield* patch(out, E[2], E[3], A, Bq, s, (a, b) => mul3(tex(a, b, 0.7), 0.8), kind, r);
    // the gable triangles at both ends
    for (const sg of [-1, 1]) {
      const tone = faceTone(o.tin ? wall : C.thatchDark, sg * ex, sg * ez);
      yield* patch(out, Pt(sg * w / 2, h, dep / 2), Pt(sg * w / 2, h, -dep / 2), Pt(sg * w / 2, top - 0.2, 0), Pt(sg * w / 2, top - 0.2, 0), s, () => tone, kind, r);
    }
    // the ridge
    strut(out, A[0], A[1] + 0.05, A[2], Bq[0], Bq[1] + 0.05, Bq[2], Math.max(0.1, s * 0.5), mul3(rc, 0.55), segs(w, s * 0.5, 8), 1, kind);
  }
}
// A stilt house in a clearing: posts, a floor a man's height up, a ladder, the hut, and often a line
// of washing in front of it. By night its windows glow.
function* stiltHouse(ctx, out, W, hs, x, d, night) {
  const r = makeRng(hs.seed);
  const s = Math.max(0.1, detail(out, d, 1.0));
  const y0 = W.H(hs.wx, d) - 0.2;
  const yf = y0 + hs.stilt;
  const yaw = hs.yaw, ex = Math.cos(yaw), ez = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
  const pr = limb(0.09, d), pc = C.post;
  for (const lx of [-0.5, 0, 0.5]) for (const lz of [-0.5, 0.5]) {
    const px = x + ex * lx * hs.w + fx * lz * hs.dep, pz = -d + ez * lx * hs.w + fz * lz * hs.dep;
    strut(out, px, y0, pz, px, yf, pz, pr, pc, 2, 1, KIND.BUILDING);
  }
  // the floor: a dark band of joists round the edge
  const ft = faceTone(C.plank, fx, fz);
  yield* panel(out, [x - ex * (hs.w / 2 + 0.3) + fx * (hs.dep / 2 + 0.3), yf - 0.3, -d + -ez * (hs.w / 2 + 0.3) + fz * (hs.dep / 2 + 0.3)], [ex, 0, ez], [0, 1, 0], hs.w + 0.6, 0.3, s, () => mul3(ft, 0.7), KIND.BUILDING, r);
  yield* hut(ctx, out, x, yf, d, { w: hs.w, dep: hs.dep, h: 2.5, roof: 'gable', tin: hs.tin, rust: hs.tin && r() < 0.5, wall: hs.wall, yaw, lit: night ? 0.7 : 0, seed: hs.seed, s, rng: r });
  // the ladder up to the door
  const lx0 = x + fx * (hs.dep / 2 + 1.1), lz0 = -d + fz * (hs.dep / 2 + 1.1);
  for (const sg of [-0.35, 0.35]) strut(out, lx0 + ex * sg, y0, lz0 + ez * sg, lx0 + ex * sg - fx * 1.0, yf, lz0 + ez * sg - fz * 1.0, limb(0.05, d), C.post, 2, 1, KIND.BUILDING);
  for (let k = 1; k < 4; k++) { const t = k / 4; strut(out, lx0 - ex * 0.35 - fx * t, y0 + t * hs.stilt, lz0 - ez * 0.35 - fz * t, lx0 + ex * 0.35 - fx * t, y0 + t * hs.stilt, lz0 + ez * 0.35 - fz * t, limb(0.04, d), C.post, 1, 1, KIND.BUILDING); }
  if (night) yield* lamp(ctx, out, x + fx * (hs.dep / 2 + 0.2), yf + 2.2, d - fz * (hs.dep / 2 + 0.2), WARM, { size: 0.12, halo: 1 });
  if (hs.wash) yield* washing(out, x - ex * hs.w * 0.2, d - hs.dep / 2 - 4.5, W.H(hs.wx, d - hs.dep / 2 - 4.5), r);
}
// A line of washing on two posts: shirts, sarongs and towels that flutter (MOVE.FLAG).
function* washing(out, x, d, y0, r) {
  const span = 4 + 2 * r(), top = y0 + 1.9;
  strut(out, x - span / 2, y0, -d, x - span / 2, top + 0.1, -d, limb(0.05, d), C.post, 2, 1, KIND.OTHER);
  strut(out, x + span / 2, y0, -d, x + span / 2, top + 0.1, -d, limb(0.05, d), C.post, 2, 1, KIND.OTHER);
  strut(out, x - span / 2, top, -d, x + span / 2, top - 0.1, -d, limb(0.015, d), [0.25, 0.23, 0.2], 3, 1, KIND.OTHER);
  const n = 3 + Math.floor(r() * 4);
  const cols = [[0.78, 0.76, 0.72], [0.75, 0.2, 0.15], [0.2, 0.35, 0.65], [0.78, 0.62, 0.12], [0.3, 0.55, 0.35], [0.7, 0.35, 0.55]];
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n - 0.5 + (r() - 0.5) * 0.1, c = cols[Math.floor(r() * cols.length)];
    const hh = 0.35 + 0.45 * r(), ww = 0.25 + 0.2 * r();
    out(x + u * span, top - 0.05 - hh, -d, ww, hh, 0.03, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER, MOVE.FLAG);
  }
  if (out.due()) yield;
}
// An overwater bungalow: a thatched, hipped hut on a deck on stilts over the lagoon, with a ladder
// down into the water and, by night, lit windows and a lamp on the deck.
function* bungalow(ctx, out, x, d, r, night, side) {
  const s = Math.max(0.1, detail(out, d, 1.0));
  const yf = SEA + 2.1, w = 5.5 + 1.5 * r(), dep = 5 + r();
  const pr = limb(0.1, d);
  for (const lx of [-0.55, 0, 0.55]) for (const lz of [-0.55, 0.55]) strut(out, x + lx * (w + 2), SEA - 0.6, -(d - lz * (dep + 2)), x + lx * (w + 2), yf, -(d - lz * (dep + 2)), pr, C.post, 2, 1, KIND.BUILDING);
  // the deck: planks seen edge on, a broad veranda on the side facing the jetty
  yield* panel(out, [x - (w + 2) / 2, yf - 0.25, -(d - (dep + 2) / 2)], [1, 0, 0], [0, 1, 0], w + 2, 0.3, s, () => mul3(C.plank, 0.75), KIND.BUILDING, r);
  yield* panel(out, [x - (w + 2) / 2, yf, -(d - (dep + 2) / 2)], [1, 0, 0], [0, 0, -1], w + 2, dep + 2, s * 1.3, () => C.plank, KIND.BUILDING, r);
  yield* hut(ctx, out, x, yf, d, { w, dep, h: 2.6, roof: 'hip', wall: r() < 0.5 ? C.bamboo : WALLS[3], lit: night ? 0.8 : 0, seed: Math.floor(r() * 1e6), s, rng: r });
  if (night) yield* lamp(ctx, out, x + side * (w / 2 + 0.6), yf + 1.6, d - dep / 2 - 0.6, WARM, { size: 0.12, halo: 1 });
}
// A jetty running out from the beach with bungalows either side of it: boards on paired piles,
// a hand rope, lamps by night. Each band draws the pieces whose centres lie in it.
function* resort(ctx, out, W, site, dLo, dHi, night) {
  const x = site.wx - ctx.x0;
  if (x < -40 || x > ctx.length + 40) return;
  const r = makeRng(site.seed);
  const d0 = site.shore - 8, d1 = site.shore + site.len, yd = SEA + 2.0;
  const step = 3;
  for (let dd = d0; dd < d1; dd += step) {
    const dm = dd + step / 2;
    if (dm < dLo || dm >= dHi) continue;
    const s = Math.max(0.1, detail(out, dm, 1.0));
    const nb = Math.max(2, Math.round(step / (s * 1.3)));
    for (let k = 0; k < nb; k++) {
      const dk = dd + (k + 0.5) * step / nb;
      const yk = Math.max(yd, W.H(site.wx, dk) + 0.3);
      const c = jitter(C.plank, r, 0.08);
      out(x, yk, -dk, 1.15, 0.08, step / nb * 0.66, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.BUILDING);
      out(x - 1.15, yk - 0.18, -dk, 0.06, 0.18, step / nb * 0.66, c[0] * 0.6, c[1] * 0.6, c[2] * 0.6, 1, 0, 0, 0, 1, KIND.BUILDING);
    }
    if (Math.round(dd / step) % 2 === 0) for (const sg of [-1, 1]) {
      strut(out, x + sg * 1.05, SEA - 0.6, -dd, x + sg * 1.05, yd + 0.9, -dd, limb(0.08, dm), C.post, 2, 1, KIND.BUILDING);
      strut(out, x + sg * 1.05, yd + 0.85, -dd, x + sg * 1.05, yd + 0.85, -(dd + step * 2), limb(0.025, dm), [0.45, 0.38, 0.26], 2, 1, KIND.BUILDING);
    }
    if (night && Math.round(dd / step) % 5 === 0) yield* lamp(ctx, out, x - 1.05, yd + 1.2, dd, WARM, { size: 0.1, halo: 1 });
    if (out.due()) yield;
  }
  for (const b of site.bungalows) {
    const bd = site.shore + b.off;
    if (bd < dLo || bd >= dHi) continue;
    const br = makeRng(b.seed);
    const bx = x + b.side * 9;
    yield* bungalow(ctx, out, bx, bd, br, night, -b.side);
    // a short boardwalk from the jetty to its deck
    const s = Math.max(0.1, detail(out, bd, 1.0));
    yield* panel(out, [Math.min(x, bx) + 1.1, yd, -(bd + 0.9)], [1, 0, 0], [0, 0, 1], 9 - 4.4, 1.8, s, () => C.plank, KIND.BUILDING, br);
  }
}
// A beach bar: an open pavilion of posts under a big hipped thatch, a counter, stools, a string of
// paper lanterns round the eaves (lit by night) and a few people.
function* beachBar(ctx, out, W, x, d, r, night) {
  const s = Math.max(0.1, detail(out, d, 1.0));
  const y0 = W.H(ctx.x0 + x, d) - 0.1;
  const w = 8 + 3 * r(), dep = 6 + r(), h = 2.7;
  const pr = limb(0.1, d);
  for (const lx of [-0.5, 0, 0.5]) for (const lz of [-0.5, 0.5]) strut(out, x + lx * w, y0, -(d - lz * dep), x + lx * w, y0 + h, -(d - lz * dep), pr, C.post, 2, 1, KIND.BUILDING);
  yield* hut(ctx, out, x, y0, d, { w, dep, h, roof: 'hip', wall: C.bamboo, s, rng: r, seed: 7, kind: KIND.BUILDING, noWalls: true });
  // the counter, open behind
  const ct = faceTone(C.bamboo, 0, 1);
  yield* panel(out, [x - w * 0.35, y0, -(d - dep * 0.2)], [1, 0, 0], [0, 1, 0], w * 0.7, 1.15, s, (a, b) => (b > 0.85 ? mul3(C.plank, 1.1) : mul3(ct, 0.9 + 0.12 * ((Math.floor(a * 18) & 1)))), KIND.BUILDING, r);
  for (const sg of [-1, 1]) yield* panel(out, [x + sg * w * 0.35, y0, -(d - dep * 0.2)], [0, 0, -1], [0, 1, 0], dep * 0.5, 1.15, s, () => faceTone(C.bamboo, sg, 0), KIND.BUILDING, r);
  for (let k = 0; k < 4; k++) {
    const sx = x - w * 0.3 + k * w * 0.2;
    strut(out, sx, y0, -(d - dep * 0.2 - 0.9), sx, y0 + 0.75, -(d - dep * 0.2 - 0.9), limb(0.04, d), [0.25, 0.2, 0.15], 1, 1, KIND.BUILDING);
    out(sx, y0 + 0.78, -(d - dep * 0.2 - 0.9), 0.22, 0.05, 0.22, 0.6, 0.25, 0.15, 1, 0, 0, 0, 1, KIND.BUILDING);
  }
  // inside: bottles on a shelf, and a warm light by night
  if (night) yield* lamp(ctx, out, x, y0 + h - 0.4, d, WARM, { size: 0.16, halo: 1.6 });
  // the lanterns: a string sagging between the front posts
  const nlz = 7 + Math.floor(r() * 4);
  for (let k = 0; k < nlz; k++) {
    const u = (k + 0.5) / nlz, lx = x - w / 2 - 0.3 + u * (w + 0.6), ly = y0 + h - 0.35 - 0.35 * 4 * u * (1 - u);
    const lc = LANTERNS[(k + Math.floor(r() * 2)) % LANTERNS.length];
    if (night) {
      out(lx, ly, -(d - dep / 2 - 0.7), 0.17, 0.2, 0.17, lc[0], lc[1], lc[2], 1, 0, 0, 0, 1, KIND.LIGHT, B);
      out(lx, ly, -(d - dep / 2 - 0.65), 0.55, 0.55, 0.3, lc[0], lc[1], lc[2], 0.16, 0, 0, 0, 1, KIND.LIGHT, B);
    } else out(lx, ly, -(d - dep / 2 - 0.7), 0.17, 0.2, 0.17, lc[0] * 0.75, lc[1] * 0.75, lc[2] * 0.75, 1, 0, 0, 0, 1, KIND.OTHER, B);
  }
  strut(out, x - w / 2 - 0.3, y0 + h - 0.35, -(d - dep / 2 - 0.7), x + w / 2 + 0.3, y0 + h - 0.35, -(d - dep / 2 - 0.7), 0.015, [0.2, 0.18, 0.15], 4, 1, KIND.OTHER);
  // a few people at the counter and on the sand
  const np = 2 + Math.floor(r() * 3);
  for (let k = 0; k < np; k++) yield* person(out, x + (r() - 0.5) * w, y0, d - dep * 0.2 - 1.4 - r() * 3, r, {});
  if (out.due()) yield;
}
// A lighthouse on a rocky point: a white tower banded red, a dark gallery, the lantern room (lit by
// night) under a red cap, a keeper's hut, rocks round its foot. Drawn round its whole girth.
function* lighthouse(ctx, out, W, x, d, r, night) {
  const s = Math.max(0.12, detail(out, d, 1.0));
  const y0 = W.H(ctx.x0 + x, d) - 0.5;
  const H = 18 + 8 * r(), R0 = 2.4, R1 = 1.6;
  const rows = Math.max(6, Math.round(H / (s * 1.4))), cols = Math.max(8, Math.round(2 * Math.PI * R0 / (s * 1.4)));
  for (let i = 0; i < rows; i++) {
    const t = (i + 0.5) / rows, rr = lerp(R0, R1, t), y = y0 + t * H;
    const band = Math.floor(t * 5) % 2 === 1;
    for (let j = 0; j < cols; j++) {
      const a = (j + 0.5) / cols * Math.PI * 2, nx = Math.sin(a), nz = Math.cos(a);
      let c = band ? [0.72, 0.16, 0.12] : [0.8, 0.79, 0.76];
      c = shade(c, nx, 0.1, nz, 0.5, 0.6);
      const q = quatYaw(a);
      out(x + nx * rr, y, -d + nz * rr, Math.PI * rr / cols * 1.3, H / rows * 0.66, 0.08, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.BUILDING);
    }
    if (out.due()) yield;
  }
  // gallery, lantern room, cap
  const gy = y0 + H;
  for (let j = 0; j < 14; j++) {
    const a = (j + 0.5) / 14 * Math.PI * 2;
    out(x + Math.sin(a) * 2.3, gy + 0.1, -d + Math.cos(a) * 2.3, 0.6, 0.12, 0.15, 0.12, 0.12, 0.13, 1, 0, 0, 0, 1, KIND.BUILDING);
    const g = night ? [1, 0.92, 0.65] : [0.62, 0.66, 0.6];
    out(x + Math.sin(a) * 1.25, gy + 1.1, -d + Math.cos(a) * 1.25, 0.32, 0.8, 0.32, g[0], g[1], g[2], 1, 0, 0, 0, 1, night ? KIND.LIGHT : KIND.BUILDING);
    out(x + Math.sin(a) * 1.1, gy + 2.3, -d + Math.cos(a) * 1.1, 0.5, 0.35, 0.5, 0.62, 0.12, 0.1, 1, 0, 0, 0, 1, KIND.BUILDING);
  }
  if (night) {
    out(x, gy + 1.1, -d + 1.5, 2.6, 1.6, 1.0, 1, 0.92, 0.6, 0.22, 0, 0, 0, 1, KIND.LIGHT);
    out(x, gy + 1.1, -d + 1.6, 7, 4, 2, 1, 0.9, 0.6, 0.08, 0, 0, 0, 1, KIND.LIGHT);
  }
  yield* hut(ctx, out, x + 6, y0 + 0.4, d + 2, { w: 5, dep: 4, h: 2.6, roof: 'gable', tin: true, wall: [0.8, 0.78, 0.74], rng: r, s, seed: 3, lit: night ? 0.9 : 0 });
  for (let k = 0; k < 9; k++) {
    const a = r() * Math.PI * 2, rr = 4 + 5 * r(), R = 1.2 + 1.6 * r();
    yield* blob(ctx, out, x + Math.cos(a) * rr, y0 + R * 0.3, d + Math.sin(a) * rr * 0.6, R, R * 0.6, R * 0.8, { n: Math.max(4, Math.round(R * R * 4 / (s * s))), color: C.volcRock, rng: r, kind: KIND.ROCK, inner: 0.3, amb: 0.55 });
  }
}
// A pier on piles with lamp posts, and a white inter-island ferry moored at its end.
function* pier(ctx, out, W, site, dLo, dHi, night) {
  const x = site.wx - ctx.x0;
  if (x < -60 || x > ctx.length + 60) return;
  const r = makeRng(site.seed);
  const d0 = site.shore - 6, d1 = site.shore + site.len, yd = SEA + 2.4;
  const step = 4;
  for (let dd = d0; dd < d1; dd += step) {
    const dm = dd + step / 2;
    if (dm < dLo || dm >= dHi) continue;
    const s = Math.max(0.12, detail(out, dm, 1.0));
    const nb = Math.max(2, Math.round(step / (s * 1.3)));
    for (let k = 0; k < nb; k++) {
      const dk = dd + (k + 0.5) * step / nb;
      const yk = Math.max(yd, W.H(site.wx, dk) + 0.3);
      out(x, yk, -dk, 1.7, 0.12, step / nb * 0.66, 0.55, 0.52, 0.46, 1, 0, 0, 0, 1, KIND.BUILDING);
      out(x - 1.7, yk - 0.3, -dk, 0.08, 0.3, step / nb * 0.66, 0.3, 0.29, 0.26, 1, 0, 0, 0, 1, KIND.BUILDING);
    }
    for (const sg of [-1, 1]) strut(out, x + sg * 1.5, SEA - 0.8, -dd, x + sg * 1.5, yd, -dd, limb(0.16, dm), [0.36, 0.34, 0.3], 2, 1, KIND.BUILDING);
    if (Math.round(dd / step) % 5 === 0) {
      strut(out, x + 1.5, yd, -dd, x + 1.5, yd + 4.2, -dd, limb(0.06, dm), [0.3, 0.3, 0.3], 2, 1, KIND.BUILDING);
      if (night) yield* lamp(ctx, out, x + 1.5, yd + 4.3, dd, WARM, { size: 0.12, halo: 1 });
    }
    if (out.due()) yield;
  }
  const fd = d1 + 7;
  if (fd >= dLo && fd < dHi) yield* ferry(ctx, out, x + 8, fd, r, night);
}
function* ferry(ctx, out, x, d, r, night) {
  const s = Math.max(0.12, detail(out, d, 1.0));
  const L = 30 + 10 * r(), Bm = 7;
  const hullC = [0.8, 0.79, 0.76], stripe = [[0.15, 0.3, 0.6], [0.7, 0.15, 0.12], [0.15, 0.45, 0.35]][Math.floor(r() * 3)];
  const K = KIND.BUILDING;
  // the hull: both long sides and the stern; a pointed bow at +x
  const hy0 = SEA - 0.3, hy1 = SEA + 2.6;
  for (const sg of [1, -1]) {
    const zc = -d + sg * Bm / 2;
    yield* patch(out, [x - L / 2, hy0, zc], [x + L / 2 - 4, hy0, zc], [x - L / 2, hy1, zc], [x + L / 2 - 4, hy1, zc], s, (a, b) => {
      const c = b > 0.55 && b < 0.72 ? stripe : b < 0.2 ? [0.3, 0.12, 0.1] : hullC;
      return faceTone(c, 0, sg);
    }, K, r);
    yield* patch(out, [x + L / 2 - 4, hy0, zc], [x + L / 2 + 2, hy0, -d], [x + L / 2 - 4, hy1, zc], [x + L / 2 + 3, hy1 + 0.4, -d], s, (a, b) => faceTone(b > 0.55 && b < 0.72 ? stripe : hullC, 0.7, sg * 0.7), K, r);
  }
  yield* patch(out, [x - L / 2, hy0, -d + Bm / 2], [x - L / 2, hy0, -d - Bm / 2], [x - L / 2, hy1, -d + Bm / 2], [x - L / 2, hy1, -d - Bm / 2], s, () => faceTone(hullC, -1, 0), K, r);
  // two decks of cabins with rows of windows, lit by night
  const glow = lit(WARM);
  for (let k = 0; k < 2; k++) {
    const l = L * (0.7 - 0.2 * k), y = hy1 + k * 2.4, xc = x - L * 0.08;
    for (const [o, u, len, nx, nz] of [[[xc - l / 2, y, -d + Bm * 0.42], [1, 0, 0], l, 0, 1], [[xc - l / 2, y, -d - Bm * 0.42], [1, 0, 0], l, 0, -1], [[xc - l / 2, y, -d - Bm * 0.42], [0, 0, 1], Bm * 0.84, -1, 0], [[xc + l / 2, y, -d - Bm * 0.42], [0, 0, 1], Bm * 0.84, 1, 0]]) {
      yield* panel(out, o, u, [0, 1, 0], len, 2.3, s, (a, b) => {
        const f = a * len / 1.6, ix = f - Math.floor(f);
        if (b > 0.4 && b < 0.75 && ix > 0.2 && ix < 0.8) return night && (hashInts(k, Math.floor(f), nz + 3) & 3) ? glow : [0.12, 0.16, 0.2];
        return faceTone(hullC, nx, nz);
      }, K, r);
    }
  }
  // funnel and mast
  yield* blob(ctx, out, x - L * 0.25, hy1 + 5.8, d, 0.9, 1.4, 0.9, { n: 14, color: stripe, rng: r, kind: K, inner: 0.2, clump: 0 });
  strut(out, x + L * 0.15, hy1 + 4.8, -d, x + L * 0.15, hy1 + 9, -d, limb(0.06, d), [0.3, 0.3, 0.3], 3, 1, K);
  if (night) {
    yield* lamp(ctx, out, x + L * 0.15, hy1 + 9.1, d, [1, 0.95, 0.85], { size: 0.14, halo: 1 });
    yield* lamp(ctx, out, x + L / 2 + 1, hy1 + 1, d - 1, [0.3, 1, 0.4], { size: 0.12, halo: 0.6 });
  }
}

// --- Boats ---------------------------------------------------------------------------------------
// An outrigger canoe: a slim dark hull, a float on booms to one side, sometimes a crab-claw sail and
// a paddler. A handful of shaped splats tagged MOVE.BEAT. y is the water (or sand) level.
function* canoe(ctx, out, x, y, d, r, opts = {}) {
  const K = opts.kind != null ? opts.kind : KIND.OTHER, mv = opts.move != null ? opts.move : B;
  const dir = r() < 0.5 ? -1 : 1, L = 5.5 + 2.5 * r();
  const hull = [[0.22, 0.16, 0.11], [0.15, 0.3, 0.55], [0.7, 0.2, 0.14], [0.75, 0.72, 0.62]][Math.floor(r() * 4)];
  const side = r() < 0.5 ? -1 : 1;
  ell(out, x, y + 0.22, -d, L / 2, 0.22, 0.3, 1, 0.02 * dir, 0, hull, K, mv);
  ell(out, x + dir * L * 0.45, y + 0.38, -d, L * 0.08, 0.14, 0.18, dir, 0.6, 0, hull, K, mv);              // the raised prow
  ell(out, x - dir * L * 0.45, y + 0.34, -d, L * 0.07, 0.12, 0.16, -dir, 0.5, 0, hull, K, mv);
  ell(out, x, y + 0.16, -(d + side * 1.8), L * 0.33, 0.1, 0.12, 1, 0, 0, [0.5, 0.42, 0.3], K, mv);         // the float
  for (const u of [-0.2, 0.2]) strutM(out, x + u * L, y + 0.4, -d, x + u * L, y + 0.25, -(d + side * 1.8), limb(0.04, d), [0.45, 0.38, 0.26], 2, K, mv);
  if (opts.paddler !== false && r() < 0.75) yield* person(out, x - dir * L * 0.15, y + 0.1, d, r, { sit: true, kind: K, move: mv });
  if (opts.sail || r() < 0.3) {
    // the crab-claw sail: two spars from the foot of the mast spreading up and back, the sail between
    const sc = [[0.78, 0.72, 0.6], [0.72, 0.3, 0.16], [0.75, 0.6, 0.2]][Math.floor(r() * 3)];
    const fx = x + dir * L * 0.1, h = 4.2 + r();
    strutM(out, fx, y + 0.4, -d, fx - dir * 1.2, y + h, -d, limb(0.04, d), [0.4, 0.33, 0.22], 3, K, mv);
    strutM(out, fx, y + 0.4, -d, fx - dir * 3.0, y + h * 0.55, -d, limb(0.04, d), [0.4, 0.33, 0.22], 3, K, mv);
    yield* patch(out, [fx, y + 0.6, -d], [fx - dir * 1.15, y + h - 0.2, -d], [fx, y + 0.6, -d], [fx - dir * 2.8, y + h * 0.58, -d], Math.max(0.2, detail(out, d, 1.0)), (a, b) => faceTone(sc, 0, 1), K, r, 0.12, mv === B ? B : mv);
  }
  if (out.due()) yield;
}
// A fishing boat: a painted plank hull with an upswept bow, a small cabin, a mast and now and then a
// sail; a lamp on the mast by night.
function* fishingBoat(ctx, out, x, y, d, r, night, opts = {}) {
  const K = opts.kind != null ? opts.kind : KIND.OTHER, mv = opts.move != null ? opts.move : B;
  const dir = r() < 0.5 ? -1 : 1, L = 8 + 4 * r(), Bm = 2.4;
  const body = [[0.2, 0.42, 0.62], [0.75, 0.74, 0.7], [0.62, 0.18, 0.12], [0.2, 0.5, 0.4]][Math.floor(r() * 4)];
  const trim = [[0.78, 0.62, 0.12], [0.75, 0.74, 0.7], [0.2, 0.3, 0.55]][Math.floor(r() * 3)];
  // the hull's two sides: a dark boot top at the waterline, the painted body, a pale gunwale, rising
  // to the bow; then the bow and transom ends
  const hs = Math.max(0.2, detail(out, d, 1.0));
  for (const sg of [1, -1]) {
    const zc = -d + sg * Bm / 2;
    yield* patch(out, [x - dir * L / 2, y - 0.1, zc], [x + dir * (L / 2 - 1.2), y - 0.1, zc], [x - dir * L / 2, y + 1.1, zc], [x + dir * (L / 2 - 1.2), y + 1.35, zc], hs, (a, b) => {
      const c = b < 0.2 ? [0.12, 0.1, 0.1] : b > 0.8 ? trim : body;
      return faceTone(c, 0, sg);
    }, K, r, 0.12, mv);
    yield* patch(out, [x + dir * (L / 2 - 1.2), y - 0.1, zc], [x + dir * (L / 2 + 0.6), y + 0.3, -d], [x + dir * (L / 2 - 1.2), y + 1.35, zc], [x + dir * (L / 2 + 1.0), y + 1.9, -d], hs, (a, b) => faceTone(b < 0.2 ? [0.12, 0.1, 0.1] : b > 0.8 ? trim : body, 0.6 * dir, sg * 0.8), K, r, 0.12, mv);
  }
  yield* patch(out, [x - dir * L / 2, y - 0.1, -d + Bm / 2], [x - dir * L / 2, y - 0.1, -d - Bm / 2], [x - dir * L / 2, y + 1.1, -d + Bm / 2], [x - dir * L / 2, y + 1.1, -d - Bm / 2], hs, () => faceTone(body, -dir, 0), K, r, 0.12, mv);
  if (y < SEA + 0.5) out(x, y + 0.02, -d, L * 0.6, 0.03, Bm, 0.72, 0.8, 0.78, 0.7, 0, 0, 0, 1, KIND.GROUND);   // the ripple round it (not under a boat in the air)
  // the cabin
  const cx = x - dir * L * 0.15;
  for (const [ox, oz, nx, nz, a, b] of [[0, 0.9, 0, 1, 1.2, 0.05], [0, -0.9, 0, -1, 1.2, 0.05], [-1.2, 0, -1, 0, 0.05, 0.9], [1.2, 0, 1, 0, 0.05, 0.9]]) {
    const c = faceTone([0.78, 0.76, 0.7], nx, nz);
    out(cx + ox, y + 1.7, -d + oz, a + 0.05, 0.7, b + 0.05, c[0], c[1], c[2], 1, 0, 0, 0, 1, K, mv);
  }
  out(cx, y + 2.45, -d, 1.4, 0.1, 1.05, trim[0], trim[1], trim[2], 1, 0, 0, 0, 1, K, mv);
  out(cx + 0.6 * dir, y + 1.85, -d + 0.96, 0.3, 0.22, 0.03, 0.12, 0.15, 0.2, 1, 0, 0, 0, 1, K, mv);
  const mx = x + dir * L * 0.2, mh = 6 + 2 * r();
  strutM(out, mx, y + 1, -d, mx, y + mh, -d, limb(0.06, d), [0.35, 0.3, 0.24], 4, K, mv);
  if (opts.sail || r() < 0.4) {
    const sc = [[0.78, 0.74, 0.64], [0.66, 0.3, 0.14], [0.7, 0.55, 0.3]][Math.floor(r() * 3)];
    yield* patch(out, [mx - dir * 0.2, y + 1.8, -d], [mx - dir * L * 0.45, y + 1.6, -d], [mx - dir * 0.2, y + mh - 0.3, -d], [mx - dir * L * 0.35, y + mh * 0.75, -d], Math.max(0.25, detail(out, d, 1.0)), () => faceTone(sc, 0, 1), K, r, 0.12, mv);
  }
  if (night) {
    out(mx, y + mh * 0.7, -d, 0.12, 0.12, 0.12, 1, 0.9, 0.62, 1, 0, 0, 0, 1, KIND.LIGHT, B);
    out(mx, y + mh * 0.7, -(d - 0.1), 0.5, 0.5, 0.3, 1, 0.9, 0.62, 0.16, 0, 0, 0, 1, KIND.LIGHT, B);
  }
  if (r() < 0.7) yield* person(out, x + dir * L * 0.25, y + 0.9, d, r, { kind: K, move: mv });
  if (out.due()) yield;
}

// --- People and animals (about 1.3 times life size, so they read from 50-100 m) ---------------------
const CLOTH = [[0.78, 0.76, 0.7], [0.72, 0.2, 0.14], [0.2, 0.32, 0.6], [0.78, 0.6, 0.14], [0.25, 0.5, 0.35], [0.62, 0.3, 0.5], [0.12, 0.12, 0.14]];
const SKIN = [[0.42, 0.28, 0.18], [0.32, 0.2, 0.13], [0.5, 0.35, 0.24]];
// A person standing (or sitting): legs, a torso, arms and a head; opts: { h, arms ('up', 'cast',
// 'carry'), sit, hat, kind, move, cloth }. Legs and arms are struts, the rest shaped splats.
function* person(out, x, y0, d, r, opts = {}) {
  const K = opts.kind != null ? opts.kind : KIND.OTHER, mv = opts.move != null ? opts.move : B;
  const hgt = (opts.h || 1.65 + 0.15 * r()) * 1.3, z = -d;
  const cl = opts.cloth || CLOTH[Math.floor(r() * CLOTH.length)], sk = SKIN[Math.floor(r() * SKIN.length)];
  const lr = limb(0.07 * hgt / 1.7, d);
  const hip = opts.sit ? y0 + 0.25 * hgt : y0 + 0.5 * hgt;
  if (!opts.sit) {
    const sp = 0.1 * hgt;
    strutM(out, x - sp * 0.5, hip, z, x - sp, y0 + 0.02, z, lr * 1.2, mul3(cl, 0.55), 2, K, mv);
    strutM(out, x + sp * 0.5, hip, z, x + sp, y0 + 0.02, z, lr * 1.2, mul3(cl, 0.5), 2, K, mv);
  } else ell(out, x, y0 + 0.1 * hgt, z, 0.28 * hgt, 0.07 * hgt, 0.12 * hgt, 1, 0, 0, mul3(cl, 0.55), K, mv);
  const ty = hip + 0.17 * hgt;
  ell(out, x, ty, z, 0.17 * hgt, 0.13 * hgt, 0.09 * hgt, 0, 1, 0, cl, K, mv);
  const hy = hip + 0.43 * hgt;
  ell(out, x, hy, z, 0.065 * hgt, 0.07 * hgt, 0.065 * hgt, 0, 1, 0, sk, K, mv);
  if (opts.hat) ell(out, x, hy + 0.05 * hgt, z, 0.16 * hgt, 0.025 * hgt, 0.16 * hgt, 1, 0, 0, [0.74, 0.64, 0.42], K, mv);
  const sh = hip + 0.31 * hgt, ar = lr;
  const arms = opts.arms;
  for (const sg of [-1, 1]) {
    let ex, ey;
    if (arms === 'up') { ex = x + sg * 0.22 * hgt; ey = sh + 0.38 * hgt; }
    else if (arms === 'cast') { ex = x + 0.4 * hgt; ey = sh + (sg > 0 ? 0.15 : 0.05) * hgt; }
    else if (arms === 'carry') { ex = x + sg * 0.05 * hgt; ey = sh + 0.32 * hgt; }
    else { ex = x + sg * 0.12 * hgt; ey = sh - 0.34 * hgt; }
    strutM(out, x + sg * 0.1 * hgt, sh, z, ex, ey, z + 0.05, ar, sk, 2, K, mv);
  }
  if (out.due()) yield;
}
// Children playing in the shallows: up to the knees in the lagoon, arms up, splashing.
function* children(ctx, out, x, d, r) {
  const n = 2 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const cx = x + (r() - 0.5) * 7, cd = d + (r() - 0.5) * 4;
    yield* person(out, cx, SEA - 0.35, cd, r, { h: 1.0 + 0.3 * r(), arms: r() < 0.6 ? 'up' : null });
    for (let j = 0; j < 3; j++) out(cx + (r() - 0.5) * 1.2, SEA + 0.2 + 0.4 * r(), -(cd - 0.3), 0.18 + 0.15 * r(), 0.25 + 0.2 * r(), 0.12, 0.8, 0.8, 0.8, 0.8, 0, 0, 0, 1, KIND.OTHER, B);
    out(cx, SEA + 0.03, -cd, 0.9, 0.04, 0.6, 0.72, 0.8, 0.78, 0.8, 0, 0, 0, 1, KIND.GROUND);      // the ripple ring
  }
  if (r() < 0.6) out(x + (r() - 0.5) * 4, SEA + 1.2 + r(), -d, 0.2, 0.2, 0.2, 0.78, 0.6, 0.12, 1, 0, 0, 0, 1, KIND.OTHER, B);   // a ball in the air
}
// A fisherman knee-deep in the lagoon casting a round net: the net opens in the air in front of him
// as a ring of weighted edge with lines running back to his hands.
function* netCaster(ctx, out, x, d, r) {
  const y0 = SEA - 0.45, dir = r() < 0.5 ? -1 : 1;
  yield* person(out, x, y0, d, r, { arms: 'cast', hat: r() < 0.5, cloth: [0.2, 0.3, 0.5] });
  const hx = x + dir * 0.65, hy = y0 + 1.9;
  const cx = x + dir * 3.2, cy = SEA + 1.3 + 0.8 * r(), R = 1.7 + 0.5 * r();
  const nc = 12, nr = limb(0.02, d), col = [0.3, 0.28, 0.22];
  for (let k = 0; k < nc; k++) {
    const a0 = (k / nc) * Math.PI * 2, a1 = ((k + 1) / nc) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * R, cy + Math.sin(a0) * R * 0.25, -(d + Math.sin(a0) * R * 0.9)];
    const p1 = [cx + Math.cos(a1) * R, cy + Math.sin(a1) * R * 0.25, -(d + Math.sin(a1) * R * 0.9)];
    strutM(out, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], nr * 1.6, col, 1, KIND.OTHER, B);
    if (k % 2 === 0) strutM(out, hx, hy, -d, p0[0], p0[1], p0[2], nr, col, 2, KIND.OTHER, B, 0.7);
  }
  out(x, SEA + 0.03, -d, 1.1, 0.04, 0.8, 0.72, 0.8, 0.78, 0.8, 0, 0, 0, 1, KIND.GROUND);
}
// Nets hung to dry on a line between poles at the back of the beach: strands draped in a sag,
// fluttering in the breeze, floats along the top.
function* dryingNets(ctx, out, W, x, d, r) {
  const y0 = W.H(ctx.x0 + x, d) - 0.1, span = 8 + 6 * r(), np = 3;
  const col = [[0.2, 0.36, 0.42], [0.42, 0.3, 0.2], [0.3, 0.42, 0.24]][Math.floor(r() * 3)];
  for (let k = 0; k < np; k++) strut(out, x - span / 2 + k * span / (np - 1), y0, -d, x - span / 2 + k * span / (np - 1), y0 + 2.6, -d, limb(0.06, d), C.post, 2, 1, KIND.OTHER);
  // the net hangs in separate folds (thin strands with gaps between), never as a sheet
  const ns = Math.round(span / 0.6);
  strut(out, x - span / 2, y0 + 2.45, -d, x + span / 2, y0 + 2.45, -d, limb(0.02, d), [0.25, 0.22, 0.18], 4, 1, KIND.OTHER);
  for (let k = 0; k < ns; k++) {
    const u = (k + 0.5) / ns, xx = x - span / 2 + u * span;
    const top = y0 + 2.45, len = 1.3 + 0.6 * r(), sw = (r() - 0.5) * 0.3;
    strutM(out, xx, top, -d, xx + sw, top - len, -(d + 0.05), limb(0.05, d), mul3(col, 0.8 + 0.3 * r()), 3, KIND.OTHER, MOVE.FLAG);
    if (k % 2 === 0) out(xx, top, -(d - 0.05), 0.09, 0.09, 0.09, 0.78, 0.55, 0.12, 1, 0, 0, 0, 1, KIND.OTHER);
  }
  if (out.due()) yield;
}
// A hammock slung between two palm trunks: a sagging cloth in stripes on short ropes.
function* hammock(out, a, b, d, r) {
  const n = 7, sag = 0.7;
  const cols = [[0.72, 0.2, 0.14], [0.78, 0.62, 0.14], [0.2, 0.42, 0.6], [0.75, 0.74, 0.7]];
  const c0 = cols[Math.floor(r() * 4)], c1 = cols[Math.floor(r() * 4)];
  strutM(out, a[0], a[1], -a[2], lerp(a[0], b[0], 0.15), a[1] - sag * 0.6, -lerp(a[2], b[2], 0.15), limb(0.02, d), [0.3, 0.28, 0.22], 2, KIND.OTHER);
  strutM(out, b[0], b[1], -b[2], lerp(a[0], b[0], 0.85), b[1] - sag * 0.6, -lerp(a[2], b[2], 0.85), limb(0.02, d), [0.3, 0.28, 0.22], 2, KIND.OTHER);
  const L = Math.hypot(b[0] - a[0], b[2] - a[2]) * 0.7;
  for (let k = 0; k < n; k++) {
    const t = 0.15 + 0.7 * (k + 0.5) / n;
    const px = lerp(a[0], b[0], t), pz = lerp(a[2], b[2], t), py = lerp(a[1], b[1], t) - sag * (0.6 + 1.6 * t * (1 - t));
    const c = k % 2 ? c0 : c1;
    out(px, py, -pz, L / n * 0.7, 0.08, 0.45, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER, MOVE.FLAG);
  }
  if (out.due()) yield;
}
// A frigatebird soaring (black, long angled wings, forked tail) or a pelican flying low (heavy body,
// broad wings, long pale bill). They fly (MOVE.FLY): `dir` is the way their flight cell goes, from
// kit flightCell(), and their wings are drawn up, to be flapped by the shader.
function* seabird(out, x, y, d, r, type, dir) {
  const K = KIND.OTHER, z = -d, S = 1.3, qd = Q_ID;
  if (type === 'frigate') {
    const c = [0.08, 0.08, 0.09];
    flyBody(out, x, y, z, 0.45 * S, 0.1 * S, c, qd, K);
    for (const sg of [-1, 1]) {
      const ix = x - dir * 0.1, iz = z + sg * 0.75 * S, ox = x - dir * 0.6 * S, oz = z + sg * 1.6 * S;
      flyWing(out, x, y, z, ix, y + 0.3 * S, iz, limb(0.08, d), c, 2, y, K);
      flyWing(out, ix, y + 0.3 * S, iz, ox, y + 0.12 * S, oz, limb(0.06, d), c, 2, y, K);
      flyBody(out, x - dir * 0.7 * S, y - 0.02, z + sg * 0.09, 0.3 * S, limb(0.025, d), c, qd, K);   // the forked tail
    }
    flyBody(out, x + dir * 0.45 * S, y + 0.02, z, 0.15 * S, 0.05, [0.5, 0.48, 0.46], qd, K);
  } else {
    const c = [0.6, 0.58, 0.54], w = [0.4, 0.38, 0.35];
    flyBody(out, x, y, z, 0.55 * S, 0.22 * S, c, qd, K);
    flyBody(out, x + dir * 0.55 * S, y + 0.1 * S, z, 0.14 * S, 0.12 * S, [0.72, 0.7, 0.62], qd, K);
    flyBody(out, x + dir * 0.95 * S, y + 0.02 * S, z, 0.36 * S, 0.06 * S, [0.75, 0.6, 0.28], qd, K);
    for (const sg of [-1, 1]) {
      flyWing(out, x, y + 0.05, z, x - dir * 0.1, y + 0.4 * S, z + sg * 1.2 * S, limb(0.14, d), w, 2, y + 0.05, K);
      flyWing(out, x - dir * 0.1, y + 0.4 * S, z + sg * 1.2 * S, x - dir * 0.3, y + 0.55 * S, z + sg * 2.1 * S, limb(0.1, d), mul3(w, 0.6), 2, y + 0.05, K);
    }
  }
  void r;
}
// A water buffalo: a heavy dark body on four legs, head low, swept-back horns.
function* buffalo(out, x, y0, d, r, wet) {
  const K = KIND.OTHER, S = 1.3, dir = r() < 0.5 ? -1 : 1, z = -d;
  const c = jitter([0.16, 0.15, 0.15], r, 0.1), cs = mul3(c, 0.7);
  const X = (u) => x + dir * u * S;
  for (const [lx, side] of [[0.75, -1], [-0.7, -1], [0.75, 1], [-0.7, 1]]) {
    if (wet) break;
    strutM(out, X(lx), y0 + 0.85 * S, z + side * 0.25, X(lx + 0.05), y0 + 0.02, z + side * 0.25, limb(0.09, d), side < 0 ? cs : c, 2, K, B);
  }
  ell(out, X(0), y0 + 1.05 * S, z, 1.15 * S, 0.5 * S, 0.5 * S, dir, 0.04, 0, c, K, B);
  ell(out, X(0.4), y0 + 1.35 * S, z, 0.5 * S, 0.3 * S, 0.42 * S, 1, 0, 0, mul3(c, 1.1), K, B);    // the withers
  ell(out, X(1.35), y0 + 0.85 * S, z, 0.32 * S, 0.2 * S, 0.22 * S, dir, -0.5, 0, c, K, B);
  for (const sg of [-1, 1]) {
    strutM(out, X(1.25), y0 + 1.05 * S, z + sg * 0.15, X(1.0), y0 + 1.2 * S, z + sg * 0.7 * S, limb(0.06, d), [0.5, 0.46, 0.38], 2, K, B);
    strutM(out, X(1.0), y0 + 1.2 * S, z + sg * 0.7 * S, X(0.85), y0 + 1.45 * S, z + sg * 0.45 * S, limb(0.05, d), [0.5, 0.46, 0.38], 1, K, B);
  }
  strutM(out, X(-1.1), y0 + 1.2 * S, z, X(-1.25), y0 + 0.5 * S, z, limb(0.03, d), cs, 1, K, B);
  if (wet) out(x, y0 + 0.5, z, 1.8, 0.05, 0.8, 0.5, 0.42, 0.3, 0.8, 0, 0, 0, 1, KIND.GROUND);
  if (r() < 0.3) ell(out, X(-0.2), y0 + 1.7 * S, z, 0.18, 0.13, 0.11, 1, 0.2, 0, [0.78, 0.78, 0.74], K, B);   // an egret on its back
  if (out.due()) yield;
}
// A macaque sitting, hunched, with a long curling tail.
function monkey(out, x, y0, d, r) {
  const K = KIND.OTHER, S = 1.3, dir = r() < 0.5 ? -1 : 1, z = -d;
  const c = jitter([0.42, 0.34, 0.24], r, 0.1), f = [0.55, 0.42, 0.34];
  ell(out, x, y0 + 0.28 * S, z, 0.24 * S, 0.17 * S, 0.15 * S, dir * 0.5, 1, 0, c, K, B);
  ell(out, x + dir * 0.08 * S, y0 + 0.55 * S, z, 0.1 * S, 0.1 * S, 0.1 * S, 0, 1, 0, c, K, B);
  ell(out, x + dir * 0.15 * S, y0 + 0.53 * S, z + 0.03, 0.05 * S, 0.06 * S, 0.04, 0, 1, 0, f, K, B);
  strutM(out, x - dir * 0.15 * S, y0 + 0.12 * S, z, x - dir * 0.55 * S, y0 + 0.08 * S, z, limb(0.025, d), c, 2, K, B);
  strutM(out, x - dir * 0.55 * S, y0 + 0.08 * S, z, x - dir * 0.7 * S, y0 + 0.4 * S, z, limb(0.025, d), c, 2, K, B);
  strutM(out, x + dir * 0.1 * S, y0 + 0.35 * S, z, x + dir * 0.2 * S, y0 + 0.05, z, limb(0.03, d), c, 1, K, B);
}
// A parrot (macaw) in flight: bright body, long tail, wings up (the shader flaps them). MOVE.FLY.
function parrot(out, x, y, d, r, dir) {
  const K = KIND.OTHER, S = 1.3, z = -d;
  const pal = [[[0.75, 0.1, 0.06], [0.15, 0.3, 0.7]], [[0.2, 0.55, 0.12], [0.75, 0.55, 0.06]], [[0.15, 0.35, 0.72], [0.8, 0.62, 0.1]]][Math.floor(r() * 3)];
  flyBody(out, x, y, z, 0.25 * S, 0.08 * S, pal[0], Q_ID, K);
  flyBody(out, x - dir * 0.5 * S, y - 0.06, z, 0.3 * S, limb(0.04, d), pal[0], Q_ID, K);       // the long tail
  for (const sg of [-1, 1]) flyWing(out, x, y, z, x - dir * 0.15 * S, y + 0.4 * S, z + sg * 0.55 * S, limb(0.07, d), pal[1], 2, y, K);
}
// A market stall: a table of fruit under a striped awning on four poles, a vendor and a customer.
function* marketStall(ctx, out, W, x, d, r) {
  const s = Math.max(0.1, detail(out, d, 1.0));
  const y0 = W.H(ctx.x0 + x, d) - 0.05, w = 3.2 + r(), dep = 2;
  const aw = [[0.72, 0.16, 0.12], [0.2, 0.42, 0.62], [0.75, 0.6, 0.12], [0.3, 0.5, 0.3]][Math.floor(r() * 4)];
  for (const [lx, lz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) strut(out, x + lx * w, y0, -(d + lz * dep), x + lx * w, y0 + 2.4 + (lz < 0 ? 0.3 : 0), -(d + lz * dep), limb(0.05, d), C.post, 2, 1, KIND.BUILDING);
  yield* patch(out, [x - w / 2 - 0.2, y0 + 2.25, -(d - dep / 2 - 0.4)], [x + w / 2 + 0.2, y0 + 2.25, -(d - dep / 2 - 0.4)], [x - w / 2 - 0.2, y0 + 2.75, -(d + dep / 2)], [x + w / 2 + 0.2, y0 + 2.75, -(d + dep / 2)], s, (a) => ((Math.floor(a * 7) & 1) ? aw : [0.78, 0.76, 0.7]), KIND.BUILDING, r);
  yield* panel(out, [x - w / 2, y0, -(d - dep * 0.3)], [1, 0, 0], [0, 1, 0], w, 0.85, s, () => faceTone(C.plank, 0, 1), KIND.BUILDING, r);
  const fruit = [[0.78, 0.55, 0.08], [0.75, 0.3, 0.06], [0.3, 0.5, 0.1], [0.7, 0.62, 0.12], [0.55, 0.15, 0.2]];
  for (let k = 0; k < 8; k++) {
    const c = fruit[Math.floor(r() * fruit.length)];
    out(x - w * 0.42 + k * w * 0.12, y0 + 0.95, -(d - dep * 0.2 + (r() - 0.5) * 0.6), 0.22, 0.14, 0.22, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.BUILDING);
  }
  yield* person(out, x + (r() - 0.5) * w * 0.6, y0, d + 0.6, r, { hat: r() < 0.5 });
  yield* person(out, x + (r() - 0.5) * w, y0, d - dep - 1.0, r, { arms: 'carry' });
}
// Smoke from a cooking fire, rising and spreading (MOVE.VAPOUR).
function smoke(out, x, y, d, r, k = 1) {
  const n = 5 + Math.floor(r() * 3), drift = 0.5 + 0.5 * r();
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1), s = (0.4 + 1.6 * f) * k;
    const c = mix3([0.6, 0.6, 0.6], [0.74, 0.75, 0.76], f);
    out(x + drift * f * f * 6 * k, y + 0.4 + f * 8 * k, -(d + 0.3 * f), s, s * 0.8, s * 0.7, c[0], c[1], c[2], 0.32 - 0.2 * f, 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
  }
}
// A fire on the beach (or in a yard): a few flames that are lights, embers, smoke, people round it.
function* fire(ctx, out, x, y, d, r, night) {
  for (let k = 0; k < 5; k++) out(x + (r() - 0.5) * 0.8, y + 0.1, -(d + (r() - 0.5) * 0.6), 0.35, 0.08, 0.06, 0.25, 0.18, 0.12, 1, 0, 0, 0, 1, KIND.OTHER);
  if (night) {
    for (let k = 0; k < 4; k++) out(x + (r() - 0.5) * 0.5, y + 0.3 + 0.35 * r(), -d, 0.14 + 0.1 * r(), 0.3 + 0.2 * r(), 0.14, 1, 0.45 + 0.3 * r(), 0.12, 1, 0, 0, 0, 1, KIND.LIGHT, B);
    out(x, y + 0.6, -(d - 0.1), 1.6, 1.3, 0.8, 1, 0.55, 0.2, 0.16, 0, 0, 0, 1, KIND.LIGHT);
  }
  smoke(out, x, y + 0.5, d, r, 0.7);
  for (let k = 0; k < 2 + Math.floor(r() * 3); k++) {
    const a = (k / 4) * Math.PI * 2 + r();
    yield* person(out, x + Math.cos(a) * 1.8, y, d + Math.sin(a) * 1.4, r, { sit: true });
  }
}

// --- Water furniture ------------------------------------------------------------------------------
// The surf on the reef: a broken line of white standing proud of the water (a flat strip parallel to
// the track would be thinner than a pixel), the pale wash behind it, spray (MOVE.VAPOUR).
function* surfLine(ctx, out, W, X, dLo, dHi) {
  const L = ctx.length;
  let x = 0;
  while (x < L) {
    const wx = ctx.x0 + x;
    const rf = xv(X, 'reef', wx), c = xv(X, 'coast', wx);
    const st = Math.max(0.8, detail(out, rf, 1.6) * 1.4);
    if (rf >= dLo && rf < dHi && c > 0.3) {
      const brk = noise1(wx / (25 + 0.02 * rf), W.ws + 81);
      if (brk > 0.3) {
        const k = smooth(0.3, 0.55, brk), h = 0.35 + 0.6 * k;
        const dd = rf + 4 * (noise1(wx / 60, W.ws + 82) - 0.5);
        const cc = mul3(C.foam, 0.92 + 0.08 * noise1(wx / 7, W.ws + 83));
        out(x, SEA + h * 0.6, -dd, st * 0.75, h * 0.6, Math.max(0.5, st * 0.4), cc[0], cc[1], cc[2], 1, 0, 0, 0, 1, KIND.GROUND);
        out(x, SEA + 0.05, -(dd - 6 - 3 * k), st * 0.75, 0.05, 4 + 3 * k, 0.5, 0.74, 0.72, 0.9, 0, 0, 0, 1, KIND.GROUND);
        if (brk > 0.7 && ((wx / st) | 0) % 7 === 0) out(x, SEA + h + 0.6, -(dd + 1), 1.6 + rf * 0.002, 0.9, 1.2, 0.8, 0.8, 0.8, 0.35, 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
      }
    }
    x += st;
    if (out.due()) yield;
  }
}
// The waterline: a thin line of foam where small waves break on the sand, standing a little proud.
function* shoreLine(ctx, out, W, X, dLo, dHi) {
  const L = ctx.length;
  let x = 0;
  while (x < L) {
    const wx = ctx.x0 + x, sd = xv(X, 'shore', wx);
    const st = Math.max(0.35, detail(out, sd, 1.4));
    if (sd >= dLo && sd < dHi) {
      const k = noise1(wx / 6, W.ws + 84);
      out(x, SEA + 0.08 + 0.1 * k, -(sd + 0.6), st * 0.8, 0.07 + 0.08 * k, 0.5, 0.8, 0.8, 0.78, 1, 0, 0, 0, 1, KIND.GROUND);
      if (k > 0.55) out(x, SEA + 0.2, -(sd + 3 + 4 * k), st * 0.8, 0.12, 0.25, 0.68, 0.84, 0.8, 0.9, 0, 0, 0, 1, KIND.GROUND);
    }
    x += st;
    if (out.due()) yield;
  }
}
// Rain: thin streaks falling through a 16 m slab of air (kit MOVE.FALL), each at its own distance.
function* rain(ctx, out, X, dLo, dHi, per) {
  const rng = ctx.rng, L = ctx.length;
  let amt = 0;
  for (let k = 0; k <= 8; k++) amt += xv(X, 'rain', ctx.x0 + L * k / 8) / 9;
  if (amt < 0.02) return;
  const n = Math.round(per * amt * out.density);
  for (let i = 0; i < n; i++) {
    const x = rng() * L;
    if (rng() > xv(X, 'rain', ctx.x0 + x)) continue;
    const d = dLo + (dHi - dLo) * Math.pow(rng(), 1.6);
    const w = Math.max(0.008, 0.0009 * d), h = Math.max(w * 3, 0.25 + 0.012 * d);
    out(x, -3.4 + 16 * rng(), -d, w, h, w, 0.72, 0.75, 0.78, 0.32, 0, 0, 0, 1, KIND.OTHER, MOVE.FALL);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Placement: world cells, shared by the bands (each draws what its centre puts in the band)
// ---------------------------------------------------------------------------------------------
// Coconut palms along the shore: clumps of one to three per 9 m of beach, leaning out over the sand
// toward the water, and groves behind the beach where the coast turns away. Now and then a hammock
// is slung between two of them.
const PALMCELL = 9;
function palmCell(W, i) {
  return cache(W, 'pm', i, () => {
    const r = makeRng(hashInts(W.ws, 401, i));
    const wx0 = i * PALMCELL;
    const x = xinfo(W, wx0 + PALMCELL / 2);
    if (x.coast < 0.2 || r() > 0.72) return null;
    const dB = x.shore - 2, dA = Math.max(26, x.shore - x.beach * 0.5 - 60 * (1 - x.coast) - 12);
    if (dB < dA + 2) return null;
    const n = 1 + (r() < 0.45 ? 1 : 0) + (r() < 0.15 ? 1 : 0);
    const palms = [];
    for (let k = 0; k < n; k++) {
      const wx = wx0 + r() * PALMCELL, d = dA + (dB - dA) * Math.pow(r(), 0.6);
      palms.push({ wx, d, ...palmDesc(r, 0, 0, d) });
    }
    let hm = null;
    if (n >= 2 && r() < 0.4) {
      const a = palms[0], b = palms[1], dx = Math.abs(a.wx - b.wx), dd = Math.abs(a.d - b.d);
      if (dx > 3 && dx < 8 && dd < 3) hm = { a: 0, b: 1, seed: hashInts(W.ws, 402, i) };
    }
    return { palms, hm };
  });
}
function* palms(ctx, out, W, dLo, dHi, opts = {}) {
  for (const { i } of cellsAround(ctx, PALMCELL, 12)) {
    const c = palmCell(W, i);
    if (!c) continue;
    const descs = [];
    for (const p of c.palms) {
      if (p.d < dLo || p.d >= dHi) { descs.push(null); continue; }
      const q = { ...p, x: p.wx - ctx.x0, y: W.H(p.wx, p.d) - 0.25 };
      descs.push(q);
      yield* coconutPalm(ctx, out, q);
    }
    if (c.hm && descs[c.hm.a] && descs[c.hm.b]) {
      const a = palmP(descs[c.hm.a], 0.12), b = palmP(descs[c.hm.b], 0.12);
      yield* hammock(out, a, b, (a[2] + b[2]) / 2, makeRng(c.hm.seed));
    }
  }
}

// Things on the beach and in the lagoon, one world cell at a time.
function* beachLife(ctx, out, W, X, dLo, dHi, night) {
  for (const { i, wx0 } of cellsAround(ctx, 50, 10)) {
    const r = makeRng(hashInts(W.ws, 411, i));
    const wx = wx0 + 50 * r(), x = wx - ctx.x0;
    if (x < -15 || x > ctx.length + 15) continue;
    const sd = xv(X, 'shore', Math.min(ctx.x0 + ctx.length, Math.max(ctx.x0, wx))), c = xv(X, 'coast', Math.min(ctx.x0 + ctx.length, Math.max(ctx.x0, wx)));
    if (c < 0.6) continue;
    const u = r();
    if (u < 0.28) {
      const d = Math.max(30, sd - 4 - 14 * r());
      if (d >= dLo && d < dHi && d < sd - 2) yield* canoe(ctx, out, x, W.H(wx, d) + 0.05, d, r, { paddler: false });
    } else if (u < 0.4) {
      const d = Math.max(34, sd - 10 - 14 * r());
      if (d >= dLo && d < dHi && d < sd - 3) yield* fire(ctx, out, x, W.H(wx, d), d, r, night);
    } else if (u < 0.52) {
      const d = Math.max(34, sd - 12 - 12 * r());
      if (d >= dLo && d < dHi && d < sd - 3) yield* dryingNets(ctx, out, W, x, d, r);
    } else if (u < 0.75) {
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) {
        const d = Math.max(30, sd - 2 - 9 * r());
        if (d >= dLo && d < dHi) yield* person(out, x + k * 1.6, W.H(wx, d), d, r, { hat: r() < 0.3 });
      }
    }
  }
  // children in the shallows, fishermen casting nets
  for (const { i, wx0 } of cellsAround(ctx, 110, 10)) {
    const r = makeRng(hashInts(W.ws, 412, i));
    const wx = wx0 + 110 * r(), x = wx - ctx.x0;
    if (x < -10 || x > ctx.length + 10) continue;
    const cw = Math.min(ctx.x0 + ctx.length, Math.max(ctx.x0, wx));
    if (xv(X, 'coast', cw) < 0.7) continue;
    const sd = xv(X, 'shore', cw);
    const u = r();
    if (u < 0.35) { const d = sd + 3 + 6 * r(); if (d >= dLo && d < dHi) yield* children(ctx, out, x, d, r); }
    else if (u < 0.65) { const d = sd + 6 + 10 * r(); if (d >= dLo && d < dHi) yield* netCaster(ctx, out, x, d, r); }
  }
  // boats in the lagoon, at anchor or under way
  for (const { i, wx0 } of cellsAround(ctx, 45, 10)) {
    const r = makeRng(hashInts(W.ws, 413, i));
    if (r() > 0.32) continue;
    const wx = wx0 + 45 * r(), x = wx - ctx.x0;
    if (x < -8 || x > ctx.length + 8) continue;
    const cw = Math.min(ctx.x0 + ctx.length, Math.max(ctx.x0, wx));
    if (xv(X, 'coast', cw) < 0.6) continue;
    const sd = xv(X, 'shore', cw), rf = xv(X, 'reef', cw);
    const d = sd + 14 + (Math.min(rf - 30, 290) - sd - 14) * r();
    if (d < dLo || d >= dHi || d > rf - 25) continue;
    const air = airLift(ctx, W, wx, d);
    if (r() < 0.55) yield* canoe(ctx, out, x, SEA + air, d, r, air ? { kind: KIND.SURREAL } : {});
    else yield* fishingBoat(ctx, out, x, SEA + air, d, r, night, air ? { kind: KIND.SURREAL } : {});
  }
  // birds: frigatebirds soaring high, pelicans in a line low over the water
  for (const { i, wx0 } of cellsAround(ctx, 130, 40)) {
    const r = makeRng(hashInts(W.ws, 414, i));
    if (r() > 0.5) continue;
    const fc = flightCell(wx0 + 130 * r());                 // each flock in its own flight cell
    const wx = fc.wx, x = wx - ctx.x0;
    if (x < -40 || x > ctx.length + 40) continue;
    const cw = Math.min(ctx.x0 + ctx.length, Math.max(ctx.x0, wx));
    if (xv(X, 'coast', cw) < 0.5) continue;
    const sd = xv(X, 'shore', cw);
    if (r() < 0.5) {
      const n = 1 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) { const d = 60 + 110 * r(); if (d >= dLo && d < dHi) yield* seabird(out, x + (r() - 0.5) * 18, 20 + 30 * r(), d, r, 'frigate', fc.dir); }
    } else {
      const n = 3 + Math.floor(r() * 4), d = Math.min(150, sd + 20 + 120 * r()), y = SEA + 3 + 3 * r();
      // a line astern, the leader in front
      if (d >= dLo && d < dHi) for (let k = 0; k < n; k++) yield* seabird(out, x + fc.dir * (8 - k * 3.1), y + 0.3 * k, d + k * 0.8, r, 'pelican', fc.dir);
    }
  }
}
// Jetties, piers and beach bars; lighthouses on the points.
function* coastSites(ctx, out, W, X, dLo, dHi, night) {
  for (const { i } of cellsAround(ctx, JCELL, 300)) {
    const s = coastSite(W, i);
    if (!s) continue;
    if (s.kind === 'resort') yield* resort(ctx, out, W, s, dLo, dHi, night);
    if (s.kind === 'pier') yield* pier(ctx, out, W, s, dLo, dHi, night);
    if (s.bar) {
      const x = s.bar.wx - ctx.x0;
      if (x > -12 && x < ctx.length + 12) {
        const sd = xinfo(W, s.bar.wx).shore, d = Math.max(32, sd - 20);
        if (d >= dLo && d < dHi && d < sd - 5) yield* beachBar(ctx, out, W, x, d, makeRng(hashInts(s.seed, 5)), night);
      }
    }
  }
  for (const { i } of cellsAround(ctx, PCELL, 100)) {
    const p = pointSite(W, i);
    if (!p || !p.light) continue;
    const x = p.wx - ctx.x0;
    if (x < -20 || x > ctx.length + 20) continue;
    const xi = xinfo(W, p.wx);
    if (xi.coast < 0.7) continue;
    const d = xi.shore - 22;
    if (d >= dLo && d < dHi) yield* lighthouse(ctx, out, W, x, d, makeRng(p.seed), night);
  }
}
// Islets: a cay of white sand with a fringe of shallow water, and palms.
function* islets(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, ICELL, 80)) {
    const s = islet(W, i);
    if (!s || s.d < dLo || s.d >= dHi) continue;
    const r = makeRng(s.seed);
    for (let k = 0; k < s.palms; k++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * s.R * 0.55;
      const wx = s.wx + Math.cos(a) * rr, d = s.d + Math.sin(a) * rr * 0.8;
      const p = palmDesc(r, wx - ctx.x0, isletH(s, wx, d) - 0.2, d, 1);
      p.ld = (r() - 0.5) * 0.4;
      if (p.x > -15 && p.x < ctx.length + 15) yield* coconutPalm(ctx, out, p);
    }
    // bushes on the crown of the cay
    const bs = detail(out, s.d, 1.2);
    yield* blob(ctx, out, s.wx - ctx.x0, SEA + s.h + 1.2, s.d, s.R * 0.45, 1.8, s.R * 0.3, { n: clamp(Math.round(s.R * 6 / (bs * bs)), 8, 300), color: C.scrub, rng: r, kind: KIND.HEDGE, inner: 0.4 });
  }
}
// Boats far out beyond the reef: sails and fishing boats.
function* farBoats(ctx, out, W, X, dLo, dHi, night) {
  for (const { i, wx0 } of cellsAround(ctx, 220, 20)) {
    const r = makeRng(hashInts(W.ws, 415, i));
    if (r() > 0.5) continue;
    const wx = wx0 + 220 * r(), x = wx - ctx.x0;
    if (x < -10 || x > ctx.length + 10) continue;
    const cw = Math.min(ctx.x0 + ctx.length, Math.max(ctx.x0, wx));
    if (xv(X, 'coast', cw) < 0.6) continue;
    const d = xv(X, 'reef', cw) + 60 + 1800 * r();
    if (d < dLo || d >= dHi) continue;
    const air = airLift(ctx, W, wx, d);
    if (r() < 0.5) yield* canoe(ctx, out, x, SEA + air, d, r, { sail: true, ...(air ? { kind: KIND.SURREAL } : {}) });
    else yield* fishingBoat(ctx, out, x, SEA + air, d, r, night, { sail: true, ...(air ? { kind: KIND.SURREAL } : {}) });
  }
}

// --- inland ---
// The forest edge: a front row of rounded crowns in many greens down to the ground, a second row
// behind, now and then a giant standing above them, tree ferns, banana plants and dark shrubs in
// front, lianas hanging from the crowns, flowering trees in red and orange.
const ECELL = 7;
function* forestEdge(ctx, out, W, X, dLo, dHi) {
  const scale = (ctx.dials && ctx.dials.scale) || 0;
  for (const { i, wx0 } of cellsAround(ctx, ECELL, 10)) {
    const r = makeRng(hashInts(W.ws, 421, i));
    const wx = wx0 + ECELL * r(), x = wx - ctx.x0;
    if (x < -10 || x > ctx.length + 10) { continue; }
    const cw = Math.min(ctx.x0 + ctx.length, Math.max(ctx.x0, wx));
    if (xv(X, 'forest', cw) < 0.5) continue;
    const edge = xv(X, 'edge', cw);
    const fEnd = xv(X, 'fEnd', cw);
    const ground = (d) => W.H(wx, d) - 0.3;
    const list = [];
    list.push(['tree', edge + 3 + 4 * r(), 15 + 12 * r(), 9 + 6 * r()]);
    if (r() < 0.75) list.push(['tree', edge + 12 + 6 * r(), 20 + 14 * r(), 11 + 6 * r()]);
    if (r() < 0.04) list.push(['giant', edge + 16 + 22 * r()]);
    if (r() < 0.35) list.push(['fern', edge - 1 + 3 * r()]);
    if (r() < 0.3) list.push(['banana', edge - 3 + 2 * r()]);
    list.push(['shrub', edge - 1 + 2 * r()]);
    if (r() < 0.6) list.push(['shrub', edge + 1 + 3 * r()]);
    const lia = r() < 0.3, fl = r() < 0.08 ? C.flowers[Math.floor(r() * 4)] : null, col = C.j[Math.floor(r() * 6)];
    for (const [t, d, H, Wc] of list) {
      if (d < dLo || d >= dHi || d > fEnd) continue;
      const tr = makeRng(hashInts(W.ws, 422, i, Math.round(d)));
      if (t === 'tree' && scale > 0 && d < edge + 10 && (hashInts(W.ws, 423, i) & 1023) / 1023 < 0.3 * scale) {
        const fr = makeRng(hashInts(W.ws, 424, i));
        const R = 5.5 + 4 * fr();
        bigFlower(out, x, ground(d) + H - 1 + R * 0.35, d - Wc * 0.25, R, fr);
      }
      if (t === 'tree') {
        yield* jungleTree(ctx, out, x, ground(d), d, { H, W: Wc, rng: tr, col, flower: fl, cap: d < edge + 8 ? 300 : 200 });
        if (lia && Wc < 13) liana(out, x + (tr() - 0.5) * Wc * 0.5, ground(d) + H * 0.62, d - Wc * 0.3, H * 0.55, tr);
      } else if (t === 'giant') yield* giantTree(ctx, out, x, ground(d), d, tr);
      else if (t === 'fern') yield* treeFern(ctx, out, x, ground(d), d, tr);
      else if (t === 'banana') yield* bananaPlant(ctx, out, x, ground(d), d, tr);
      else {
        const sw = 5 + 4 * tr(), sh = 3 + 3 * tr();
        const bs = detail(out, d, 1.4);
        yield* blob(ctx, out, x, ground(d) + sh * 0.45, d, sw / 2, sh * 0.6, sw * 0.35, { n: clamp(Math.round(sw * sh * 1.6 / (bs * bs)), 6, 160), color: mul3(C.j[Math.floor(tr() * 6)], 0.75), rng: tr, kind: KIND.HEDGE, inner: 0.5, amb: 0.5 });
      }
    }
  }
}
// The open ground in front of the forest: banana plantations, pasture with buffalo, lone trees.
function* fields(ctx, out, W, X, dLo, dHi) {
  // banana plantations: plants on a grid, near the line
  const G = 5.5;
  for (const { i, wx0 } of cellsAround(ctx, G, 4)) {
    const cw = Math.min(ctx.x0 + ctx.length, Math.max(ctx.x0, wx0 + G / 2));
    if (Math.round(xv(X, 'field', cw)) !== 1 || xv(X, 'coast', cw) > 0.5) continue;
    const edge = xv(X, 'edge', cw), rn = xv(X, 'river', cw);
    const dMax = Math.min(rn > 0 ? rn - 4 : edge - 5, 95);
    for (let j = Math.ceil(Math.max(dLo, 11) / G); j * G < Math.min(dHi, dMax); j++) {
      const r = makeRng(hashInts(W.ws, 431, i, j));
      if (r() < 0.12) continue;
      const wx = wx0 + G * (0.3 + 0.4 * r()), d = j * G + G * (0.3 + 0.4 * r());
      if (d < dLo || d >= dHi || (dHi <= 30 && d > 27)) continue;
      if (villageAt(W, wx, d)) continue;
      yield* bananaPlant(ctx, out, wx - ctx.x0, W.H(wx, d) - 0.1, d, r, { H: 3.4 + 1.4 * r() });
    }
  }
  // pasture: buffalo grazing; lone trees and palms on the open ground
  for (const { i, wx0 } of cellsAround(ctx, 80, 10)) {
    const r = makeRng(hashInts(W.ws, 432, i));
    const wx = wx0 + 80 * r(), x = wx - ctx.x0;
    if (x < -10 || x > ctx.length + 10) continue;
    const cw = Math.min(ctx.x0 + ctx.length, Math.max(ctx.x0, wx));
    if (xv(X, 'coast', cw) > 0.4) continue;
    const f = Math.round(xv(X, 'field', cw)), edge = xv(X, 'edge', cw), rn = xv(X, 'river', cw);
    const open = rn > 0 ? rn - 6 : edge - 8;
    if (open < 50) continue;
    const d = 40 + (Math.min(open, 140) - 40) * r();
    if (d < dLo || d >= dHi || villageAt(W, wx, d)) continue;
    if (f === 0 && r() < 0.7) {
      const n = 1 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) yield* buffalo(out, x + (r() - 0.5) * 14, W.H(wx, d) - 0.05, d + (r() - 0.5) * 8, r, false);
    } else if (f !== 1 && r() < 0.5) {
      const tr = makeRng(hashInts(W.ws, 433, i));
      if (tr() < 0.4) yield* coconutPalm(ctx, out, palmDesc(tr, x, W.H(wx, d) - 0.2, d, 0.3));
      else yield* jungleTree(ctx, out, x, W.H(wx, d) - 0.3, d, { H: 12 + 8 * tr(), W: 10 + 6 * tr(), rng: tr, col: C.j[Math.floor(tr() * 6)], flower: tr() < 0.3 ? C.flowers[Math.floor(tr() * 4)] : null });
    } else if (f === 2 && r() < 0.6) yield* person(out, x, W.H(wx, d), d, r, { hat: true, arms: 'carry' });
  }
}
function villageAt(W, wx, d) {
  const i = Math.floor(wx / HCELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const v = village(W, k);
    if (!v) continue;
    for (const h of v.houses) if (Math.abs(wx - h.wx) < h.w * 0.8 + 3 && Math.abs(d - h.d) < h.dep * 0.8 + 6) return v;
  }
  return null;
}
function* villages(ctx, out, W, dLo, dHi, night) {
  for (const { i } of cellsAround(ctx, HCELL, 150)) {
    const v = village(W, i);
    if (!v) continue;
    for (const hs of v.houses) {
      if (hs.d < dLo || hs.d >= dHi) continue;
      const x = hs.wx - ctx.x0;
      if (x < -15 || x > ctx.length + 15) continue;
      yield* stiltHouse(ctx, out, W, hs, x, hs.d, night);
      const r = makeRng(hashInts(hs.seed, 9));
      if (r() < 0.3) smoke(out, x + hs.w * 0.3, W.H(hs.wx, hs.d) + hs.stilt + 4.5, hs.d, r);
      if (r() < 0.35) { const n = 2 + Math.floor(r() * 3); for (let k = 0; k < n; k++) monkey(out, x + (r() - 0.5) * hs.w, W.H(hs.wx, hs.d) + hs.stilt + 0.1, hs.d - hs.dep / 2 - 0.8, r); }
      if (r() < 0.4) yield* person(out, x + hs.w * 0.7, W.H(hs.wx, hs.d - hs.dep), hs.d - hs.dep, r, { arms: r() < 0.3 ? 'carry' : null });
      if (r() < 0.25) yield* fire(ctx, out, x - hs.w, W.H(hs.wx, hs.d - 5), hs.d - 5, r, night);
    }
    if (v.stall && v.stall.d >= dLo && v.stall.d < dHi) {
      const x = v.stall.wx - ctx.x0;
      if (x > -10 && x < ctx.length + 10) {
        const r = makeRng(v.stall.seed);
        yield* marketStall(ctx, out, W, x, v.stall.d, r);
        if (night) yield* lamp(ctx, out, x, W.H(v.stall.wx, v.stall.d) + 2.1, v.stall.d - 0.6, WARM, { size: 0.12, halo: 1.2 });
      }
    }
  }
}
// A big cat walking along the forest edge: a tiger (orange, striped, white beneath) or, now and
// then, a black panther. Long body, low head, a long tail curling up at the tip. Tagged MOVE.BEAT.
function bigCat(out, x, y0, d, r) {
  const K = KIND.OTHER, S = 1.75, dir = r() < 0.5 ? -1 : 1, z = -d, black = r() < 0.2;
  const c = black ? [0.07, 0.07, 0.08] : jitter([0.74, 0.4, 0.09], r, 0.08), dark = black ? [0.04, 0.04, 0.05] : [0.1, 0.07, 0.05];
  const pale = black ? [0.12, 0.12, 0.13] : [0.76, 0.72, 0.62], shade = mul3(c, 0.72);
  const X = (u) => x + dir * u * S, lr = limb(0.055 * S, d);
  // legs, mid-stride: the far pair a little darker
  for (const [lx, fx, side] of [[0.62, 0.74, -1], [-0.6, -0.76, -1], [0.56, 0.4, 1], [-0.66, -0.5, 1]]) {
    strutM(out, X(lx), y0 + 0.62 * S, z + side * 0.13 * S, X((lx + fx) / 2 + 0.03), y0 + 0.32 * S, z + side * 0.13 * S, lr * 1.25, side < 0 ? shade : c, 2, K, B);
    strutM(out, X((lx + fx) / 2 + 0.03), y0 + 0.32 * S, z + side * 0.13 * S, X(fx), y0 + 0.03, z + side * 0.13 * S, lr, side < 0 ? shade : c, 2, K, B);
  }
  // belly first (pale), then the body over it, the shoulders and the haunch
  if (!black) ell(out, X(0), y0 + 0.6 * S, z + 0.02, 0.48 * S, 0.1 * S, 0.14 * S, dir, 0, 0, pale, K, B);
  ell(out, X(0), y0 + 0.74 * S, z, 0.5 * S, 0.17 * S, 0.17 * S, dir, 0.03, 0, c, K, B);
  ell(out, X(0.5), y0 + 0.78 * S, z, 0.24 * S, 0.2 * S, 0.18 * S, dir, 0.1, 0, c, K, B);
  ell(out, X(-0.52), y0 + 0.76 * S, z, 0.24 * S, 0.19 * S, 0.18 * S, dir, -0.1, 0, c, K, B);
  // stripes: thin dark bands round the body, closer on the haunch
  if (!black) for (const u of [0.62, 0.42, 0.24, 0.07, -0.1, -0.27, -0.42, -0.56, -0.68]) {
    ell(out, X(u + (r() - 0.5) * 0.04), y0 + 0.78 * S, z + 0.03, 0.022 * S, 0.17 * S * (0.75 + 0.3 * r()), 0.17 * S, dir, (r() - 0.5) * 0.5, 0, dark, K, B);
  }
  // neck and head, carried low and forward; white muzzle and cheeks, dark ears
  ell(out, X(0.82), y0 + 0.78 * S, z, 0.2 * S, 0.13 * S, 0.13 * S, dir, -0.05, 0, c, K, B);
  ell(out, X(1.06), y0 + 0.76 * S, z, 0.15 * S, 0.13 * S, 0.13 * S, dir, 0, 0, c, K, B);
  ell(out, X(1.18), y0 + 0.71 * S, z + 0.02, 0.07 * S, 0.06 * S, 0.09 * S, dir, 0, 0, pale, K, B);
  for (const sg of [-1, 1]) ell(out, X(1.0), y0 + 0.9 * S, z + sg * 0.09 * S, 0.035 * S, 0.045 * S, 0.035 * S, 0, 1, 0, dark, K, B);
  if (!black) for (const u of [0.92, 1.02]) ell(out, X(u), y0 + 0.82 * S, z + 0.03, 0.016 * S, 0.08 * S, 0.12 * S, dir, 0.3, 0, dark, K, B);
  // the tail: down behind the hocks, then curling up, dark towards the tip
  strutM(out, X(-0.74), y0 + 0.74 * S, z, X(-1.08), y0 + 0.36 * S, z, lr * 0.9, c, 3, K, B);
  strutM(out, X(-1.08), y0 + 0.36 * S, z, X(-1.38), y0 + 0.3 * S, z, lr * 0.8, c, 2, K, B);
  strutM(out, X(-1.38), y0 + 0.3 * S, z, X(-1.52), y0 + 0.5 * S, z, lr * 0.8, dark, 2, K, B);
}
// A crocodile: basking on the bank (belly down, legs splayed, sometimes gaping) or lying in the
// river with only its back, head and eyes above the water. Tagged MOVE.BEAT.
function crocodile(out, x, y0, d, r, afloat) {
  const K = KIND.OTHER, S = 1.9, dir = r() < 0.5 ? -1 : 1, z = -d, bend = (r() - 0.5) * 0.5;
  const c = jitter([0.3, 0.37, 0.17], r, 0.1), dark = mul3(c, 0.68), pale = [0.66, 0.64, 0.42];
  const X = (u) => x + dir * u * S, Z = (u) => z + bend * u * u * 0.25 * S, lr = limb(0.05 * S, d);
  // the back's height above the ground or the water (well clear of it: the flat discs of the
  // surface are sorted with these splats and would otherwise lie over the body)
  const h = afloat ? 0.2 * S : 0.3 * S;
  if (!afloat) {
    ell(out, X(0), y0 + 0.1 * S, Z(0), 0.62 * S, 0.06 * S, 0.2 * S, dir, 0, 0, pale, K, B);          // the pale flank low down
    for (const [u, sg] of [[0.5, 1], [0.5, -1], [-0.55, 1], [-0.55, -1]]) strutM(out, X(u), y0 + 0.12 * S, Z(u), X(u + 0.12), y0 + 0.02, Z(u) + sg * 0.42 * S, lr, c, 2, K, B);
  }
  ell(out, X(0), y0 + h, Z(0) + 0.3, 0.66 * S, afloat ? 0.14 * S : 0.18 * S, 0.24 * S, dir, 0, 0, c, K, B);
  ell(out, X(0), y0 + h * 0.6, Z(0) + 0.16 * S, 0.6 * S, 0.05 * S, 0.06 * S, dir, 0, 0, pale, K, B);        // the pale edge of the flank towards us
  // the tail, tapering, a third of the animal; the ridge of scutes along the back
  strutM(out, X(-0.9), y0 + h * 0.9, Z(-0.9) + 0.3, X(-1.75), y0 + h * 0.6, Z(-1.75) + 0.3, Math.max(0.12 * S, lr), c, 4, K, B);
  strutM(out, X(-1.75), y0 + h * 0.6, Z(-1.75) + 0.3, X(-2.45), y0 + h * 0.35, Z(-2.45) + 0.3, Math.max(0.06 * S, lr), dark, 3, K, B);
  for (let u = -0.55; u <= 0.6; u += 0.23) ell(out, X(u), y0 + h + (afloat ? 0.12 : 0.16) * S, Z(u) + 0.3, 0.07 * S, 0.035 * S, 0.06 * S, dir, 0, 0, dark, K, B);
  // the head: broad at the back, a long snout, eyes and nostrils standing proud
  const gape = !afloat && r() < 0.4 ? 0.2 : 0;
  ell(out, X(1.02), y0 + h * 0.95, Z(1.02) + 0.3, 0.26 * S, 0.12 * S, 0.19 * S, dir, 0, 0, c, K, B);
  if (gape) {
    ell(out, X(1.5), y0 + h * 0.55, Z(1.5), 0.3 * S, 0.035 * S, 0.1 * S, dir, 0, 0, pale, K, B);           // the lower jaw and the pale mouth
    ell(out, X(1.46), y0 + h * 0.95 + gape * 0.5 * S, Z(1.46), 0.3 * S, 0.045 * S, 0.1 * S, dir, gape * 1.4, 0, c, K, B);
  } else { ell(out, X(1.5), y0 + h * 0.85, Z(1.5) + 0.3, 0.32 * S, 0.08 * S, 0.12 * S, dir, 0, 0, c, K, B); ell(out, X(1.5), y0 + h * 0.55, Z(1.5) + 0.07 * S, 0.3 * S, 0.025 * S, 0.03 * S, dir, 0, 0, pale, K, B); }
  for (const sg of [-1, 1]) ell(out, X(1.0), y0 + h + 0.1 * S, Z(1.0) + sg * 0.09 * S, 0.045 * S, 0.04 * S, 0.04 * S, 1, 0, 0, dark, K, B);
  if (afloat) out(x, y0 + 0.01, z + 0.25, 2.6 * S, 0.02, 0.5 * S, 0.5, 0.46, 0.34, 0.5, 0, 0, 0, 1, KIND.GROUND);   // the water parting round it
}
// The rarer animals: a big cat at the forest edge now and then, crocodiles on and in the river.
function* rareAnimals(ctx, out, W, X, dLo, dHi) {
  const log = globalThis.__tropicsLog;                     // for scripts that look for them
  for (const { i, wx0 } of cellsAround(ctx, 1100, 10)) {
    const r = makeRng(hashInts(W.ws, 461, i));
    if (r() > 0.4) continue;
    const wx = wx0 + 1100 * r(), x = wx - ctx.x0;
    if (x < 0 || x >= ctx.length) continue;
    if (xv(X, 'coast', wx) > 0.45) continue;
    const d = xv(X, 'edge', wx) - 4 - 5 * r();
    if (d < 34 || d > 130 || d < dLo || d >= dHi) continue;
    const rn = xv(X, 'river', wx);
    if (rn && d > rn - 3 && d < rn + xv(X, 'riverW', wx) + 3) continue;      // not in the river
    bigCat(out, x, W.H(wx, d) - 0.03, d, r);
    if (log) log.push({ kind: 'cat', wx: Math.round(wx), d: Math.round(d) });
  }
  for (const { i, wx0 } of cellsAround(ctx, 90, 6)) {
    const r = makeRng(hashInts(W.ws, 462, i));
    if (r() > 0.3) continue;
    const wx = wx0 + 90 * r(), x = wx - ctx.x0;
    if (x < 0 || x >= ctx.length) continue;
    const rn = xv(X, 'river', wx);
    if (!rn) continue;
    const rw = xv(X, 'riverW', wx), n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const afloat = r() < 0.5, cx = x + (r() - 0.5) * 14;
      const d = afloat ? rn + rw * (0.12 + 0.45 * r()) : rn - 1.6 - 1.6 * r();
      if (d < dLo || d >= dHi || d < 31) continue;
      crocodile(out, cx, afloat ? W.H(ctx.x0 + cx, d) - 0.9 + 0.03 : W.H(ctx.x0 + cx, d) - 0.02, d, r, afloat);
      if (log) log.push({ kind: afloat ? 'croc in the river' : 'croc on the bank', wx: Math.round(ctx.x0 + cx), d: Math.round(d) });
    }
    if (out.due()) yield;
  }
}
// Animals at the forest edge and in the air: troops of monkeys, parrots flying across the clearings.
function* wildlife(ctx, out, W, X, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, 150, 30)) {
    const r = makeRng(hashInts(W.ws, 441, i));
    const wx = wx0 + 150 * r(), x = wx - ctx.x0;
    if (x < -30 || x > ctx.length + 30) continue;
    const cw = Math.min(ctx.x0 + ctx.length, Math.max(ctx.x0, wx));
    if (xv(X, 'coast', cw) > 0.45) continue;
    const edge = xv(X, 'edge', cw);
    if (r() < 0.4) {
      const d = edge - 3 - 3 * r();
      if (d >= dLo && d < dHi && d > 30) { const n = 3 + Math.floor(r() * 4); for (let k = 0; k < n; k++) monkey(out, x + (r() - 0.5) * 12, W.H(wx, d) - 0.05, d + (r() - 0.5) * 3, r); }
    }
    if (r() < 0.45) {
      // in the open, well clear of the forest wall, whose crowns would swallow them
      const d = 33 + Math.max(0, Math.min(edge, 150) - 45) * r();
      if (edge >= 45 && d >= dLo && d < dHi) { const n = 2 + Math.floor(r() * 4), y = W.H(wx, d) + 7 + 9 * r(); const fc = flightCell(wx); for (let k = 0; k < n; k++) parrot(out, fc.wx - ctx.x0 + fc.dir * (4 - k * 1.8 - r()), y + (r() - 0.5) * 1.5, d + (r() - 0.5) * 3, r, fc.dir); }
    }
    if (out.due()) yield;
  }
}
// The river: reeds and bushes on its banks, rope bridges over it, buffalo wallowing.
function* riverSide(ctx, out, W, X, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, 14, 6)) {
    const r = makeRng(hashInts(W.ws, 451, i));
    const wx = wx0 + 14 * r(), x = wx - ctx.x0;
    if (x < -6 || x > ctx.length + 6) continue;
    const cw = Math.min(ctx.x0 + ctx.length, Math.max(ctx.x0, wx));
    const rn = xv(X, 'river', cw);
    if (!rn) continue;
    const d = rn - 3.5 + r();
    if (d >= dLo && d < dHi && r() < 0.6) {
      const bs = detail(out, d, 1.4), w = 3 + 3 * r(), h = 1.4 + 1.6 * r();
      yield* blob(ctx, out, x, W.H(wx, d) + h * 0.4, d, w / 2, h * 0.6, w * 0.3, { n: clamp(Math.round(w * h * 1.6 / (bs * bs)), 6, 120), color: mix3(C.j[2], C.grassDry, 0.3 * r()), rng: r, kind: KIND.HEDGE, inner: 0.4 });
    }
    if (r() < 0.04) {
      const rw = xv(X, 'riverW', cw), bd = rn + rw * (0.2 + 0.5 * r());
      if (bd >= dLo && bd < dHi) yield* buffalo(out, x, W.H(wx, bd) - 0.9 - 0.4, bd, r, true);
    }
  }
  for (const { i } of cellsAround(ctx, BCELL, 40)) {
    const b = ropeBridge(W, i);
    if (!b) continue;
    const dm = (b.a + b.b) / 2;
    if (dm < dLo || dm >= dHi) continue;
    const x = b.wx - ctx.x0;
    if (x < -10 || x > ctx.length + 10) continue;
    yield* bridge(ctx, out, W, x, b, makeRng(b.seed));
  }
}
// A rope bridge across the river: posts on each bank, a sagging deck of slats laid edge to edge,
// hand ropes above it and the hangers between them.
function* bridge(ctx, out, W, x, b, r) {
  const wx = ctx.x0 + x, ya = W.H(wx, b.a) + 0.3, yb = W.H(wx, b.b) + 0.3;
  const span = b.b - b.a, sag = span * 0.07, half = 0.65;
  const pc = C.post, rc = [0.4, 0.34, 0.24];
  const deckY = (t) => lerp(ya, yb, t) - sag * 4 * t * (1 - t);
  for (const [dd, y] of [[b.a, ya], [b.b, yb]]) for (const sg of [-1, 1]) strut(out, x + sg * half, y - 0.4, -dd, x + sg * half, y + 1.5, -dd, limb(0.1, dd), pc, 2, 1, KIND.BUILDING);
  const n = Math.max(8, Math.round(span / 0.55));
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n, dd = lerp(b.a, b.b, t), y = deckY(t);
    const c = jitter(C.plank, r, 0.1);
    out(x, y, -dd, half, 0.05, span / n * 0.5, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.BUILDING);
  }
  for (const sg of [-1, 1]) {
    let prev = null;
    for (let k = 0; k <= 10; k++) {
      const t = k / 10, dd = lerp(b.a, b.b, t), y = deckY(t) + 1.1 + sag * 0.4 * 4 * t * (1 - t);
      const p = [x + sg * half, y, -dd];
      if (prev) strut(out, prev[0], prev[1], prev[2], p[0], p[1], p[2], limb(0.03, dd), rc, 1, 1, KIND.BUILDING);
      if (k > 0 && k < 10) strut(out, p[0], p[1], p[2], p[0], deckY(t), p[2], limb(0.015, dd), rc, 1, 1, KIND.BUILDING);
      prev = p;
    }
  }
  if (r() < 0.6) yield* person(out, x, deckY(0.4), lerp(b.a, b.b, 0.4), r, { arms: 'carry' });
  if (out.due()) yield;
}
// A waterfall pouring from the lip of a forested cliff into a pool: a concave face of dark wet rock
// streaked with moss, ledges of green, crowns along the top; the fall a column of white; spray
// billowing at its foot (MOVE.VAPOUR).
function* waterfall(ctx, out, W, f, r, fromCloud = false) {
  const x = f.wx - ctx.x0, d = f.d, Wd = f.w, Hh = f.h;
  const y0 = W.H(f.wx, d) - 1;
  const s = Math.max(0.3, detail(out, d, 1.3));
  const salt = Math.floor(r() * 9999);
  const AM = 1.7;                                      // the face spans |a| < 1; forested shoulders beyond
  const hAt = (a) => Hh * (1 - 0.15 * a * a) * (1 - smooth(0.85, AM, Math.abs(a)) * 0.92);
  const P = (a, t) => [x + a * Wd / 2, y0 + t * hAt(a), -(d + (1 - Math.min(1, a * a)) * Wd * 0.18 + t * hAt(a) * 0.14)];
  if (!fromCloud) {
    const nu = Math.max(6, Math.round(Wd * AM * 1.2 / (s * 1.3))), nv = Math.max(3, Math.round(Hh / (s * 1.3)));
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = (((i + 0.5 + (r() - 0.5) * 0.3) / nu) * 2 - 1) * AM, t = (j + 0.5 + (r() - 0.5) * 0.3) / nv;
        const p = P(a, t), aa = Math.abs(a);
        const slope = smooth(0.8, 1.3, aa);              // 0 on the cliff, 1 on the wooded shoulders
        let c = mix3(C.volcRock, [0.2, 0.2, 0.19], noise1(a * 9, salt));
        // dark wet streaks down the face, moss in patches, green ledges across it
        c = mul3(c, 0.75 + 0.45 * noise1(a * 22, salt + 4));
        const moss = noise2(a * 6, t * 3, salt + 1);
        if (moss > 0.58 || Math.abs(Math.sin(t * 11 + a * 2)) < 0.1 || t > 0.93) c = mix3(c, C.j[1 + (j % 3)], 0.85);
        if (slope > 0) c = mix3(c, mul3(C.j[(i + j) % 6], 0.9 + 0.3 * noise2(a * 5, t * 4, salt + 5)), slope);
        const nx = -Math.sign(a) * (0.3 + 0.6 * slope), ny = 0.1 + 0.6 * slope, nz = 0.6;
        c = shade(mul3(c, 0.9 + 0.2 * noise2(a * 14, t * 8, salt + 2)), nx, ny, nz, 0.5, 0.6);
        const q = quatBasis(1, 0, -a * 0.4, 0, 1, -0.14 - 0.5 * slope);
        out(p[0], p[1], p[2], Wd * AM / nu * 0.8, hAt(a) / nv * 0.72 + s * 0.3, s * 0.2, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], slope > 0.5 ? KIND.HEDGE : KIND.ROCK);
        if (out.due()) yield;
      }
    }
    // the forest on the plateau above, standing back from the lip; a mass of crowns along it
    const nTop = Math.max(4, Math.round(Wd * 1.4 / 13));
    for (let k = 0; k < nTop; k++) {
      const a = ((k + 0.5) / nTop * 2 - 1) * 1.3, p = P(a, 1);
      const tr = makeRng(hashInts(salt, k));
      yield* jungleTree(ctx, out, p[0], p[1] - 3, -p[2] + 5 + 6 * tr(), { H: 15 + 8 * tr(), W: 13 + 6 * tr(), rng: tr, col: C.j[Math.floor(tr() * 6)] });
    }
    const top = P(0, 1);
    yield* blob(ctx, out, x, top[1] + 8, -top[2] + 45, Wd * 0.75, 9, 35, { n: clamp(Math.round(Wd * 60 / (s * s)), 40, 900), color: C.j[3], rng: r, kind: KIND.HEDGE, inner: 0.4, clump: 0.4 });
  }
  // the fall: a column of white, broken and widening as it drops, just in front of the face
  const top = fromCloud ? f.top : P(0, 1)[1] + 0.8;
  const fall = top - y0;
  const nf = Math.max(8, Math.round(fall / (s * 1.1)));
  for (let k = 0; k < nf; k++) {
    const t = (k + 0.5) / nf, w = (fromCloud ? 3 : 2.6) + 3 * t;
    const fz = fromCloud ? -d : P(0, 1 - t)[2] + 2.5;
    for (const u of [-0.5, 0, 0.5]) {
      const c = mul3(C.foam, 0.86 + 0.14 * noise1(t * 20 + u * 3, salt + 3));
      out(x + u * w, top - t * fall, fz + 0.05 * u, w * 0.45, Math.max(fall / nf * 0.8, s), 0.3, c[0], c[1], c[2], 0.94, 0, 0, 0, 1, fromCloud ? KIND.SURREAL : KIND.OTHER);
    }
    if (out.due()) yield;
  }
  // the pool and the spray
  const bz = fromCloud ? -d : P(0, 0)[2] + 3;
  for (let k = 0; k < 8; k++) {
    const a = r() * Math.PI * 2, rr = 3 + 8 * r(), sp = 3 + 5 * r();
    out(x + Math.cos(a) * rr, y0 + 1 + sp * 0.5, bz + 2 + Math.sin(a) * 2, sp, sp * 0.7, sp * 0.6, 0.8, 0.8, 0.8, 0.32, 0, 0, 0, 1, fromCloud ? KIND.SURREAL : KIND.OTHER, MOVE.VAPOUR);
  }
  out(x, y0 + 0.9, bz + 4, Wd * 0.2, 0.1, 7, 0.5, 0.6, 0.56, 1, 0, 0, 0, 1, fromCloud ? KIND.SURREAL : KIND.GROUND);
}
function* waterfalls(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, FCELL, 120)) {
    const f = falls(W, i);
    if (!f || f.d < dLo || f.d >= dHi) continue;
    if (f.wx < ctx.x0 - f.w || f.wx > ctx.x0 + ctx.length + f.w) continue;
    yield* waterfall(ctx, out, W, f, makeRng(f.seed));
  }
}
// Giants standing above the canopy further off.
function* giants(ctx, out, W, X, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, 120, 20)) {
    const r = makeRng(hashInts(W.ws, 461, i));
    if (r() > 0.35) continue;
    const wx = wx0 + 120 * r(), x = wx - ctx.x0;
    if (x < -15 || x > ctx.length + 15) continue;
    const cw = Math.min(ctx.x0 + ctx.length, Math.max(ctx.x0, wx));
    const d = dLo + (dHi - dLo) * Math.pow(r(), 1.5);
    if (xv(X, 'forest', cw) < 0.5 || d < xv(X, 'edge', cw) + 30 || d > xv(X, 'fEnd', cw) - 30) continue;
    yield* giantTree(ctx, out, x, W.H(wx, d), d, r);
  }
}
// The volcano's plume: puffs rising from the crater and leaning off downwind (MOVE.VAPOUR).
function* plumes(ctx, out, W, rainK) {
  for (const { i } of cellsAround(ctx, VCELL, 4000)) {
    const v = cone(W, i);
    if (!v || !v.plume) continue;
    const x = v.wx - ctx.x0;
    if (x < -3000 || x > ctx.length + 3000) continue;
    const r = makeRng(v.seed);
    const top = SEA - 20 + v.Hc * 0.94, n = 14;
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1), sz = 60 + 260 * f;
      const c = mix3([0.62, 0.6, 0.58], [0.78, 0.78, 0.78], f);
      const px = x + 900 * f * f + (r() - 0.5) * 80, py = top + 40 + 700 * f + (r() - 0.5) * 60;
      if (px < 0 || px >= ctx.length) continue;
      out(px, py, -(v.d + 100 * f), sz, sz * 0.7, sz * 0.6, c[0], c[1], c[2], 0.55 - 0.3 * f, 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
    }
    void rainK;
  }
}

// ---------------------------------------------------------------------------------------------
// Level 1 (all gated on the scale, topology and logic dials, which are 0 at level 0)
// ---------------------------------------------------------------------------------------------
// Topology: boats sailing through the air a few metres up. Returns the lift for a boat at (wx, d).
function airLift(ctx, W, wx, d) {
  const t = (ctx.dials && ctx.dials.topology) || 0;
  if (t <= 0) return 0;
  const h = (hashInts(W.ws, 471, Math.floor(wx), Math.floor(d)) & 1023) / 1023;
  return h < 0.5 * t ? 3 + 7 * h / (0.5 * t) : 0;
}
// Scale: coconut palms as tall as radio masts, standing on sand cays out in the lagoon, or rising
// out of the forest inland: far enough off that the whole height is in the window.
function* tallPalms(ctx, out, W, dLo, dHi, amount) {
  for (const { i, wx0 } of cellsAround(ctx, 160, 40)) {
    const r = makeRng(hashInts(W.ws, 481, i));
    if (r() > 0.5 * amount) continue;
    const wx = wx0 + 160 * r(), x = wx - ctx.x0;
    if (x < -40 || x > ctx.length + 40) continue;
    const xi = xinfo(W, wx);
    const sea = xi.coast > 0.5;
    const d = sea ? xi.shore + 160 + 500 * r() : Math.max(xi.edge + 60, 220) + 400 * r();
    if (d < dLo || d >= dHi || (!sea && d > xi.fEnd)) continue;
    const y = sea ? SEA + 0.6 : W.H(wx, d) - 0.3;
    if (sea) {
      // the cay it stands on
      const sz = detail(out, d, 1.2);
      for (let k = 0; k < 14; k++) { const a = r() * Math.PI * 2, rr = 9 * Math.sqrt(r()); out(x + Math.cos(a) * rr, SEA + 0.4, -(d + Math.sin(a) * rr * 0.7), Math.max(3, sz), 0.4, Math.max(2, sz), C.sand[0], C.sand[1], C.sand[2], 1, 0, 0, 0, 1, KIND.SURREAL); }
    }
    const p = palmDesc(r, x, y, d, 1, 8 + 3 * r());
    p.ld = (r() - 0.5) * 0.1;
    yield* coconutPalm(ctx, out, p, { kind: KIND.SURREAL, frondK: 4.5, thick: 4.5 });
  }
}
// Scale: flowers the size of houses opening on top of the forest-edge crowns: five broad petals,
// each a pair of shaped splats, round a gold heart with stamens.
function bigFlower(out, x, y, d, R, r) {
  const col = [[0.8, 0.12, 0.2], [0.8, 0.4, 0.62], [0.8, 0.62, 0.08], [0.8, 0.26, 0.05], [0.6, 0.28, 0.78]][Math.floor(r() * 5)];
  const inner = r() < 0.5 ? [0.8, 0.78, 0.7] : [0.8, 0.7, 0.2];
  // the flower faces up and toward the window (axis n, splat space); petals lie in its plane
  const tilt = 1.0 + 0.3 * r(), rot = r() * 6.28;
  const nx = 0, ny = Math.cos(tilt), nz = Math.sin(tilt);
  const e1 = [1, 0, 0], e2 = [0, -nz, ny];             // two unit vectors in the flower's plane
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rot, ca = Math.cos(a), sa = Math.sin(a);
    const ux = e1[0] * ca + e2[0] * sa, uy = e1[1] * ca + e2[1] * sa + 0.15, uz = e1[2] * ca + e2[2] * sa;
    const bx = ny * uz - nz * uy, by = nz * ux - nx * uz, bz = nx * uy - ny * ux;   // n x u: across the petal
    const q = quatBasis(ux, uy, uz, bx, by, bz);
    const c = mul3(col, 0.9 + 0.15 * ca);
    for (const [f, k2, cc] of [[0.55, 1, c], [0.24, 0.5, inner]]) {
      out(x + ux * R * f, y + uy * R * f, -d + uz * R * f, R * 0.55 * k2, R * 0.42 * k2, 0.15, cc[0], cc[1], cc[2], 1, q[0], q[1], q[2], q[3], KIND.SURREAL);
    }
  }
  ell(out, x, y + R * 0.15, -d, R * 0.16, R * 0.16, R * 0.16, 0, 1, 0, [0.8, 0.66, 0.12], KIND.SURREAL);
  for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; strutM(out, x, y + R * 0.15, -d, x + Math.cos(a) * R * 0.25, y + R * 0.55, -(d + Math.sin(a) * R * 0.2), Math.max(0.1, R * 0.015), [0.78, 0.7, 0.3], 2, KIND.SURREAL); }
}
// Topology: islets floating clear of the sea, sand on top, a root of dark volcanic rock below.
function* floatingIslets(ctx, out, W, X, dLo, dHi, amount) {
  for (const { i, wx0 } of cellsAround(ctx, 600, 100)) {
    const r = makeRng(hashInts(W.ws, 483, i));
    if (r() > 0.55 * amount) continue;
    const wx = wx0 + 600 * r(), x = wx - ctx.x0;
    if (x < -100 || x > ctx.length + 100) continue;
    const xi = xinfo(W, wx);
    const d = Math.max(xi.shore + 120, 260 + 900 * r());
    if (d < dLo || d >= dHi) continue;
    const R = 14 + 22 * r(), y = (xi.coast > 0.5 ? SEA : W.H(wx, d) + 20) + 22 + 50 * r();
    const s = Math.max(0.3, detail(out, d, 1.2));
    const n = clamp(Math.round(R * R * 6 / (s * s)), 60, 2500 * out.density + 60);
    // the sand top (seen from below: its rim) and the root
    for (let k = 0; k < n; k++) {
      const top = k < n * 0.35;
      const a = r() * Math.PI * 2;
      if (top) {
        const rr = R * (0.85 + 0.15 * r());
        const c = jitter(mix3(C.sand, C.sandBack, r()), r, 0.05);
        out(x + Math.cos(a) * rr, y - r() * 1.2, -(d + Math.sin(a) * rr * 0.8), s * 1.2, s * 0.6, s, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.SURREAL);
      } else {
        const f = Math.pow(r(), 0.8), rr = R * Math.pow(1 - f, 1.2) * (0.9 + 0.15 * r());
        // layered rock: bands of pale tuff and dark basalt, a green fringe of creepers at the rim
        let c = mix3(C.volcRock, [0.5, 0.44, 0.36], 0.5 + 0.5 * Math.sin(f * 22 + Math.sin(a * 3) * 1.5));
        if (f < 0.12 && r() < 0.6) c = C.j[2];
        c = shade(c, Math.cos(a), 0.1, Math.sin(a), 0.62, 0.45);
        out(x + Math.cos(a) * rr, y - 1.5 - f * R * 1.6, -(d - Math.abs(Math.sin(a)) * rr * 0.8), s * 1.3, s * 1.1, s, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.SURREAL);
      }
      if (out.due()) yield;
    }
    // a lagoon-blue rim of shallows on top, and palms
    for (let k = 0; k < 2 + Math.floor(R / 9); k++) {
      const a = r() * Math.PI * 2, rr = r() * R * 0.5;
      const p = palmDesc(r, x + Math.cos(a) * rr, y - 0.3, d + Math.sin(a) * rr * 0.7, 1);
      p.ld = (r() - 0.5) * 0.3;
      yield* coconutPalm(ctx, out, p, { kind: KIND.SURREAL });
    }
  }
}
// Topology: a waterfall pouring out of a cloud into the forest or the lagoon.
function* cloudFalls(ctx, out, W, dLo, dHi, amount) {
  for (const { i, wx0 } of cellsAround(ctx, 1800, 200)) {
    const r = makeRng(hashInts(W.ws, 484, i));
    if (r() > 0.6 * amount) continue;
    const wx = wx0 + 1800 * r(), x = wx - ctx.x0;
    if (x < -60 || x > ctx.length + 60) continue;
    const d = 320 + 500 * r();
    if (d < dLo || d >= dHi) continue;
    const top = 110 + 60 * r();
    // the cloud: a heap of white puffs, billowing
    for (let k = 0; k < 22; k++) {
      const a = r() * Math.PI * 2, rr = 30 * Math.sqrt(r()), sz = 14 + 16 * r();
      const c = shade([0.8, 0.8, 0.8], Math.cos(a) * 0.3, 0.7, 0.5, 0.75, 0.3);
      out(x + Math.cos(a) * rr * 1.4, top + 8 + Math.sin(a) * rr * 0.4 + 10 * r(), -(d + (r() - 0.5) * 20), sz, sz * 0.7, sz * 0.7, c[0], c[1], c[2], 0.85, 0, 0, 0, 1, KIND.SURREAL, MOVE.VAPOUR);
    }
    yield* waterfall(ctx, out, W, { wx, d, w: 40, h: 0, top }, r, true);
  }
}
// Logic: a school of huge fish swimming through the air behind the trees.
function* skyFish(ctx, out, W, X, dLo, dHi, amount) {
  for (const { i, wx0 } of cellsAround(ctx, 900, 200)) {
    const r = makeRng(hashInts(W.ws, 485, i));
    if (r() > 0.7 * amount + 0.2) continue;
    const wx = wx0 + 900 * r(), x = wx - ctx.x0;
    if (x < -150 || x > ctx.length + 150) continue;
    const d0 = 200 + 250 * r(), dir = r() < 0.5 ? -1 : 1;
    const y0 = Math.max(0, W.H(wx, d0)) + 80 + 40 * r();             // above the treeline, so the window sees them
    const n = 6 + Math.floor(r() * 7);
    for (let k = 0; k < n; k++) {
      // (every random value is drawn before the band test, so near and mid agree on each fish)
      const fx = x + (r() - 0.5) * 160, fd = d0 + (r() - 0.5) * 70, fy = y0 + (r() - 0.5) * 25;
      const L = 12 + 10 * r(), Hf = L * 0.22;
      if (fd < dLo || fd >= dHi) continue;
      const back = [0.24, 0.36, 0.48], belly = [0.75, 0.76, 0.74];
      const z = -fd, X0 = (u) => fx + dir * u;
      ell(out, X0(0), fy + Hf * 0.15, z, L * 0.5, Hf * 0.5, Hf * 0.35, dir, 0.02, 0, back, KIND.SURREAL);
      ell(out, X0(0.05 * L), fy - Hf * 0.2, z + 0.1, L * 0.42, Hf * 0.32, Hf * 0.3, dir, 0, 0, belly, KIND.SURREAL);
      ell(out, X0(-0.55 * L), fy + Hf * 0.35, z, L * 0.14, Hf * 0.45, 0.1, -dir, 1.2, 0, back, KIND.SURREAL);    // the tail fin
      ell(out, X0(-0.55 * L), fy - Hf * 0.2, z, L * 0.14, Hf * 0.45, 0.1, -dir, -1.2, 0, back, KIND.SURREAL);
      ell(out, X0(-0.05 * L), fy + Hf * 0.62, z, L * 0.12, Hf * 0.3, 0.08, -dir, 0.8, 0, back, KIND.SURREAL);   // the dorsal fin
      ell(out, X0(0.38 * L), fy + Hf * 0.18, z + Hf * 0.3, 0.25, 0.25, 0.1, 0, 1, 0, [0.06, 0.06, 0.07], KIND.SURREAL);
      for (let j = 0; j < 3; j++) ell(out, X0((0.2 - j * 0.2) * L), fy - Hf * 0.02, z + Hf * 0.34, L * 0.08, Hf * 0.05, 0.05, dir, 0, 0, [0.5, 0.66, 0.7], KIND.SURREAL);
    }
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------------------------
// Old wooden telegraph poles beside the line, every beat of world x, with two wires.
function* poles(ctx, out) {
  const beat = ctx.beatMetres || 56, PD = 5.4;
  const first = Math.ceil(ctx.x0 / beat), last = Math.floor((ctx.x0 + ctx.length) / beat);
  for (let k = first; k <= last; k++) {
    const x = k * beat - ctx.x0, y0 = groundYd(ctx, x, PD) - 0.2;
    strut(out, x, y0, -PD, x, y0 + 7.4, -PD, 0.11, [0.32, 0.26, 0.2], 6, 1, KIND.MAST);
    strut(out, x - 0.7, y0 + 7.0, -PD, x + 0.7, y0 + 7.0, -PD, 0.06, [0.3, 0.24, 0.18], 3, 1, KIND.MAST);
    for (const u of [-0.55, 0.55]) out(x + u, y0 + 7.15, -PD, 0.05, 0.1, 0.05, 0.6, 0.62, 0.6, 1, 0, 0, 0, 1, KIND.MAST);
  }
  yield* wires(ctx, out, beat, [{ d: PD, y: groundYd(ctx, 0, PD) + 6.95, sag: 0.5, r: 0.012 }, { d: PD + 0.02, y: groundYd(ctx, 0, PD) + 6.95, sag: 0.55, r: 0.012 }].map((w, j) => ({ ...w, d: PD + j * 0.01 })));
}
const groundYd = (ctx, x, d) => ctx.terrain.height(ctx.x0 + x, d);

function* trackside(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 1.4, detailK: 1.2 });
  const X = xTable(W, ctx.x0, ctx.length, 1);
  const night = lightsOn(ctx);
  out.limit = ctx.count * 0.5;
  yield* poles(ctx, out);
  yield* rain(ctx, out, X, 6, 30, 5000);
  // the forest edge and what stands in front of it, where it comes close
  yield* forestEdge(ctx, out, W, X, 8, 29);
  yield* fields(ctx, out, W, X, 8, 29);
  // low things on the beach and the verge (blur-friendly: lying along the line or low and round)
  for (const { i, wx0 } of cellsAround(ctx, 8, 2)) {
    const r = makeRng(hashInts(W.ws, 491, i));
    const wx = wx0 + 8 * r(), x = wx - ctx.x0;
    if (x < 0 || x >= ctx.length) continue;
    const c = xv(X, 'coast', wx), sd = xv(X, 'shore', wx);
    const d = 9 + 19 * r();
    const u = r();
    if (c > 0.5 && d < sd - 3) {
      if (u < 0.08) yield* canoe(ctx, out, x, W.H(wx, d) + 0.05, d, r, { paddler: false });
      else if (u < 0.16) { const L = 2 + 3 * r(), y = W.H(wx, d) + 0.15; strut(out, x - L / 2, y, -d, x + L / 2, y + 0.1, -(d + (r() - 0.5)), 0.16, [0.5, 0.44, 0.36], 3, 1, KIND.OTHER); }
      else if (u < 0.4 && d < sd - xv(X, 'beach', wx) + 6) {
        const bs = detail(out, d, 1.3), w = 2 + 3 * r(), h = 0.7 + 0.7 * r();
        yield* blob(ctx, out, x, W.H(wx, d) + h * 0.35, d, w / 2, h * 0.6, w * 0.35, { n: clamp(Math.round(w * h * 1.8 / (bs * bs)), 8, 200), color: mix3(C.scrub, [0.3, 0.42, 0.12], r()), rng: r, kind: KIND.HEDGE, inner: 0.4 });
      } else if (u < 0.5) for (let k = 0; k < 3; k++) out(x + (r() - 0.5) * 2, W.H(wx, d) + 0.12, -(d + r()), 0.14, 0.12, 0.14, 0.4, 0.3, 0.16, 1, 0, 0, 0, 1, KIND.OTHER);   // husks
    } else if (c < 0.5) {
      const edge = xv(X, 'edge', wx);
      if (d > edge - 2) continue;
      if (u < 0.3) {
        // ferns and broad-leaved plants on the verge
        const bs = detail(out, d, 1.3), w = 1.5 + 2 * r(), h = 0.8 + 1.0 * r();
        yield* blob(ctx, out, x, W.H(wx, d) + h * 0.35, d, w / 2, h * 0.6, w * 0.35, { n: clamp(Math.round(w * h * 1.8 / (bs * bs)), 8, 160), color: mix3(C.j[2], C.j[4], r()), rng: r, kind: KIND.HEDGE, inner: 0.4 });
      } else if (u < 0.38 && d > 12 && Math.round(xv(X, 'field', wx)) !== 1) yield* bananaPlant(ctx, out, x, W.H(wx, d) - 0.1, d, r);
    }
    if (out.n > out.limit) break;
  }
  if ((ctx.dials.topology || 0) > 0) { /* floating things stand further out */ }
  // ground: ballast, then the beach, the verge and the fields
  out.limit = Infinity;
  const n0 = out.left();
  yield* fillStrip(ctx, out, Math.round(n0 * 0.06), 2.5, 4.3, (wx, d, rng) => jitter(PAL.ballast, rng, 0.25), W.H);
  yield* fillSurf(ctx, out, W, X, { dNear: 4.3, power: 1.1, cover: 4.2 });
}

function* near(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.1 });
  const X = xTable(W, ctx.x0, ctx.length, 1);
  const night = lightsOn(ctx), dz = ctx.dials || {};
  const lo = ctx.zNear, hi = ctx.zFar;
  out.limit = ctx.count * 0.62;
  // level 1 first, so the band's prop budget never squeezes it out
  if ((dz.scale || 0) > 0) yield* tallPalms(ctx, out, W, lo, hi, dz.scale);
  if ((dz.logic || 0) > 0) yield* skyFish(ctx, out, W, X, lo, hi, dz.logic);
  // the coast
  yield* coastSites(ctx, out, W, X, lo, hi, night);
  yield* palms(ctx, out, W, lo, hi);
  yield* beachLife(ctx, out, W, X, lo, hi, night);
  yield* surfLine(ctx, out, W, X, lo, hi);
  yield* shoreLine(ctx, out, W, X, lo, hi);
  // inland
  yield* villages(ctx, out, W, lo, hi, night);
  yield* forestEdge(ctx, out, W, X, 29, hi);
  yield* fields(ctx, out, W, X, 29, hi);
  yield* riverSide(ctx, out, W, X, lo, hi);
  yield* wildlife(ctx, out, W, X, lo, hi);
  yield* rareAnimals(ctx, out, W, X, lo, hi);
  // level 1
  if ((dz.scale || 0) > 0) yield* tallPalms(ctx, out, W, lo, hi, dz.scale);
  if ((dz.logic || 0) > 0) yield* skyFish(ctx, out, W, X, lo, hi, dz.logic);
  out.limit = ctx.count * 0.97;
  yield* rain(ctx, out, X, 30, 160, 2500);
  yield* fillSurf(ctx, out, W, X, { power: 1.5, cover: 3.2, canopyFrom: 0, edgeBack: 14, glint: 0.02 });
}

function* mid(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.5, zMargin: 200 });
  const X = xTable(W, ctx.x0, ctx.length, 4);
  const night = lightsOn(ctx), dz = ctx.dials || {};
  const lo = ctx.zNear, hi = ctx.zFar;
  out.limit = ctx.count * 0.55;
  if ((dz.topology || 0) > 0) { yield* floatingIslets(ctx, out, W, X, lo, hi, dz.topology); yield* cloudFalls(ctx, out, W, lo, hi, dz.topology); }
  if ((dz.scale || 0) > 0) yield* tallPalms(ctx, out, W, lo, hi, dz.scale);
  if ((dz.logic || 0) > 0) yield* skyFish(ctx, out, W, X, lo, hi, dz.logic);
  yield* coastSites(ctx, out, W, X, lo, hi, night);
  yield* islets(ctx, out, W, lo, hi);
  yield* palms(ctx, out, W, lo, hi);
  yield* farBoats(ctx, out, W, X, lo, hi, night);
  yield* surfLine(ctx, out, W, X, lo, hi);
  yield* waterfalls(ctx, out, W, 200, hi);     // (all of them: the cliffs stand 230 m out and more)
  yield* giants(ctx, out, W, X, lo, 1400);
  out.limit = Infinity;
  yield* fillSurf(ctx, out, W, X, { power: 1.25, cover: 3, maxR: 0.05, canopyFrom: 0, glint: 0.03, rainGrey: 0.35 });
}

function* far(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 600 });
  const X = xTable(W, ctx.x0, ctx.length, 16);
  out.limit = ctx.count * 0.1;
  yield* plumes(ctx, out, W);
  out.limit = Infinity;
  yield* fillSurf(ctx, out, W, X, { power: 1.05, cover: 2.8, minR: 0.0012, maxR: 0.03, canopyFrom: 0, glint: 0.04, rainGrey: 0.55 });
}

export const tropicsBiome = {
  name: 'tropics',
  palette: PAL,
  // the shape numbers are unused: the shore, hills and cones come from heightAt() through local()
  terrain: TERRAIN,
  hazeDist: 8000,
  // dawn and dusk come round often here: the lanterns, fires and lit windows are part of it
  slots: { dawn: 0.3, day: 0.38, dusk: 0.32 },
  // the trackside is mostly beach or verge below the window; the sea and the forest need the rest
  shares: { trackside: 0.15, near: 0.43, mid: 0.26, far: 0.16 },
  // palms (KIND.TREE) and buildings answer the beat; the jungle (KIND.HEDGE) and the land stay
  // still; boats, people, animals and birds are tagged MOVE.BEAT by hand. Lights always do.
  beatKinds: [KIND.TREE, KIND.BUILDING],
  sky: { stars: 1.15, deep: 0.4, milkyWay: 0.5 },
  generators: { trackside, near, mid, far },
};

// ---------------------------------------------------------------------------------------------
// For scripts that inspect the layout, e.g.
//   const { _debug } = await import('./src/window/biomes/tropics.js');
//   _debug.layout('7', 0, 20000)
// Each entry has world x (wx) and, where it has one, distance (d); jump=<wx> in the previewer centres it.
// ---------------------------------------------------------------------------------------------
function at(seedStr) {
  const terrain = makeTerrain(hashString(String(seedStr)), TERRAIN);
  return world({ terrain });
}
function layout(seedStr, x0, x1) {
  const W = at(seedStr);
  const list = (cell, fn, map) => { const res = []; for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) { const o = fn(W, i); if (o) res.push(...[].concat(map(o))); } return res; };
  // stretches: runs of coast / inland / mixed and of showers, sampled every 50 m
  const runs = (f) => {
    const res = []; let cur = null;
    for (let wx = x0; wx <= x1; wx += 50) {
      const v = f(wx);
      if (!cur || cur.kind !== v) { if (cur) res.push(cur); cur = { kind: v, from: wx, to: wx }; } else cur.to = wx;
    }
    if (cur) res.push(cur);
    return res.filter((r) => r.kind);
  };
  return {
    stretches: runs((wx) => { const c = coastT(W, wx); return c > 0.8 ? 'coast' : c < 0.2 ? 'inland' : 'turning'; }),
    showers: runs((wx) => (rainAt(W, wx) > 0.3 ? 'shower' : null)),
    points: list(PCELL, pointSite, (p) => ({ wx: Math.round(p.wx), d: Math.round(xinfo(W, p.wx).shore), lighthouse: p.light && coastT(W, p.wx) > 0.7 })),
    coastSites: list(JCELL, coastSite, (s) => ({ wx: Math.round(s.wx), d: Math.round(s.shore), kind: s.kind, len: Math.round(s.len || 0), bungalows: s.bungalows ? s.bungalows.length : 0 })),
    islets: list(ICELL, islet, (s) => ({ wx: Math.round(s.wx), d: Math.round(s.d), R: Math.round(s.R) })),
    cones: list(VCELL, cone, (v) => ({ wx: Math.round(v.wx), d: Math.round(v.d), H: Math.round(v.Hc) })),
    villages: list(HCELL, village, (v) => ({ wx: Math.round(v.cx), houses: v.houses.map((h) => ({ wx: Math.round(h.wx), d: Math.round(h.d) })), stall: v.stall ? { wx: Math.round(v.stall.wx), d: Math.round(v.stall.d) } : null })),
    falls: list(FCELL, falls, (f) => ({ wx: Math.round(f.wx), d: Math.round(f.d), h: Math.round(f.h) })),
    bridges: list(BCELL, ropeBridge, (b) => ({ wx: Math.round(b.wx), d: Math.round((b.a + b.b) / 2) })),
    palms: list(PALMCELL, palmCell, (c) => c.palms.map((p) => ({ wx: Math.round(p.wx), d: Math.round(p.d), H: Math.round(p.H) }))).slice(0, 60),
    boats: lagoonBoats(W, x0, x1).slice(0, 60),
  };
}
// The lagoon boats (beachLife's third loop, replayed without drawing).
function lagoonBoats(W, x0, x1) {
  const res = [];
  for (let i = Math.floor(x0 / 45); i <= Math.floor(x1 / 45); i++) {
    const r = makeRng(hashInts(W.ws, 413, i));
    if (r() > 0.32) continue;
    const wx = i * 45 + 45 * r(), xi = xinfo(W, wx);
    if (xi.coast < 0.6) continue;
    const d = xi.shore + 14 + (Math.min(xi.reef - 30, 290) - xi.shore - 14) * r();
    if (d > xi.reef - 25) continue;
    res.push({ wx: Math.round(wx), d: Math.round(d), kind: r() < 0.55 ? 'canoe' : 'fishing boat' });
  }
  return res;
}
export const _debug = { world, at, layout, xinfo, heightAt, coastT, rainAt };
