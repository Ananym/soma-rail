// "Downs": rolling English farmland seen from a southern main line. Fields in greens and straw
// behind hedgerows with oaks, copses, farmsteads and the odd village with a church tower, a lane or
// two, and the railway's own edge: ballast, cable trough, a fenced verge and overhead-line masts.
// Far off, the chalk downs and a line of low blue hills.
//
// Everything that has to line up between chunks or bands (field boundaries, hedges, lanes,
// villages, masts) comes from one pure layout of WORLD x and distance, `fieldAt()` and friends,
// hashed from the world seed. Only the ground fill uses the chunk's own rng.
//
// Surreal dials (all 0 at level 0, so level 0 shows none of this):
//   scale     giant trees and a monolith in the far band
//   topology  floating islands of downland in the mid and far sky
//   logic     the same farmstead repeating along the line, each time slightly wrong
import { hashInts, makeRng, noise1, noise2 } from '../rng.js';
import {
  KIND, makeOut, worldSeed, worldRng, worldHash, cellsAround, groundY, fillGround, strip, blob, broadleaf, conifer,
  bush, hedge, house, treeSplats, church, overheadLine, fence, floatingIsland, monolith, stick, jitter, mul3, mix3, shade, smooth, clamp, lerp,
} from './kit.js';

const PAL = {
  ground: [0.3, 0.44, 0.18],
  foliage: [0.19, 0.3, 0.12],
  hedge: [0.15, 0.24, 0.1],
  scrub: [0.22, 0.3, 0.13],
  rock: [0.62, 0.6, 0.55],
  ballast: [0.42, 0.39, 0.35],
};

// Field crops: base colour and whether it is striped (mowing lines, tramlines, stubble rows).
const PASTURE = [[0.3, 0.44, 0.18], [0.27, 0.41, 0.16], [0.34, 0.47, 0.2], [0.25, 0.37, 0.15], [0.32, 0.43, 0.2]];
const ARABLE = [
  { c: [0.66, 0.56, 0.3], stripe: 0.06 },   // ripe wheat
  { c: [0.72, 0.64, 0.4], stripe: 0.05 },   // barley
  { c: [0.68, 0.62, 0.44], stripe: 0.12 },  // stubble
  { c: [0.37, 0.48, 0.21], stripe: 0.08 },  // young crop with tramlines
  { c: [0.44, 0.48, 0.24], stripe: 0.04 },  // hay meadow
  { c: [0.4, 0.3, 0.21], stripe: 0.1 },     // plough (rare)
];
const TREE_GREENS = [[0.19, 0.3, 0.12], [0.24, 0.35, 0.15], [0.2, 0.31, 0.13], [0.17, 0.27, 0.12], [0.26, 0.36, 0.17]];
const WALLS = [[0.55, 0.32, 0.24], [0.6, 0.38, 0.28], [0.5, 0.49, 0.45], [0.74, 0.71, 0.62], [0.68, 0.6, 0.48]];
const ROOFS = [[0.25, 0.26, 0.29], [0.45, 0.24, 0.17], [0.4, 0.22, 0.16], [0.42, 0.36, 0.24]];

// ---------------------------------------------------------------------------------------------
// Layout: rows of fields parallel to the track, cut into fields by boundaries that run away from it.
// Row edge k sits at distance D[k] wobbling along x; edge 0 is the railway fence.
// ---------------------------------------------------------------------------------------------
const layouts = new Map();
function layout(ctx) {
  const ws = worldSeed(ctx);
  let L = layouts.get(ws);
  if (L) return L;
  const r = makeRng(hashInts(ws, 501));
  const rows = [{ D: 6.8, gap: 0, amp: 0, wl: 1, W: 120 }];
  let D = 6.8 + 14 + r() * 30;
  while (D < 16000) {
    const gap = (34 + 0.15 * D) * (0.55 + 0.9 * r());
    rows.push({ D, gap, amp: 0, wl: 250 + 400 * r(), W: (110 + 0.14 * D) * (0.6 + 0.8 * r()) });
    D += gap;
  }
  for (let k = 1; k < rows.length; k++) {
    const before = rows[k].D - rows[k - 1].D, after = k + 1 < rows.length ? rows[k + 1].D - rows[k].D : before;
    rows[k].amp = Math.min(0.28 * Math.min(before, after), k === 1 ? rows[k].D - 12 : 1e9);
    rows[k].mid = rows[k].D + 0.5 * after;
  }
  rows[0].mid = (rows[0].D + rows[1].D) / 2;
  rows[0].W = rows[1].W;
  L = { ws, rows, Ds: rows.map((q) => q.D), info: new Map(), villages: new Map() };
  layouts.set(ws, L);
  if (layouts.size > 8) layouts.delete(layouts.keys().next().value);
  return L;
}
function edgeD(L, k, wx) {
  const q = L.rows[k];
  return q.amp ? q.D + q.amp * (2 * noise1(wx / q.wl, L.ws + k * 13) - 1) : q.D;
}
function rowAt(L, wx, d) {
  const Ds = L.Ds;
  let lo = 0, hi = Ds.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (Ds[m] <= d) lo = m; else hi = m - 1; }
  let k = lo;
  while (k + 1 < Ds.length && edgeD(L, k + 1, wx) <= d) k++;
  while (k > 0 && edgeD(L, k, wx) > d) k--;
  return k;
}
function colEdge(L, k, j, d) {
  const q = L.rows[k];
  const h = hashInts(L.ws, 61, k, j);
  const jit = ((h & 1023) / 1023 - 0.5) * 0.5, skew = (((h >>> 10) & 1023) / 1023 - 0.5) * 0.7;
  return (j + jit) * q.W + skew * (d - q.mid);
}
function colAt(L, k, wx, d) {
  let j = Math.floor(wx / L.rows[k].W);
  while (colEdge(L, k, j, d) > wx) j--;
  while (colEdge(L, k, j + 1, d) <= wx) j++;
  return j;
}
// What a field is. Arable or pasture follows a slow stretch value, woods cluster.
function fieldInfo(L, k, j) {
  const key = k * 4194304 + j;
  let f = L.info.get(key);
  if (f) return f;
  const r = makeRng(hashInts(L.ws, 71, k, j));
  const cx = (j + 0.5) * L.rows[k].W;
  const arable = noise1(cx / 2600, L.ws + 77);
  const woody = noise1(cx / 1900, L.ws + 91);
  const pWood = k === 0 ? 0 : 0.03 + 0.22 * smooth(0.5, 0.85, woody);
  const u = r();
  f = { k, j, wood: false, stripe: 0, dir: r() < 0.5, period: 6 + 10 * r(), oaks: 0, farm: false, flock: 0 };
  if (u < pWood) { f.wood = true; f.color = [0.14, 0.2, 0.1]; }
  else if (r() < 0.25 + 0.6 * arable) {
    const a = ARABLE[Math.floor(Math.pow(r(), 1.3) * ARABLE.length)];
    f.color = jitter(a.c, r, 0.06); f.stripe = a.stripe;
    if (r() < 0.025) { f.color = [0.7, 0.64, 0.2]; f.stripe = 0.03; }     // oilseed rape, now and then
  } else {
    f.color = jitter(PASTURE[Math.floor(r() * PASTURE.length)], r, 0.05);
    f.stripe = r() < 0.3 ? 0.05 : 0;
    f.oaks = r() < 0.45 ? 1 + Math.floor(r() * 2.2) : 0;
    f.flock = r() < 0.3 ? (r() < 0.75 ? 1 : 2) : 0;      // 1 sheep, 2 cattle
  }
  f.farm = !f.wood && k >= 1 && r() < 0.06;
  L.info.set(key, f);
  if (L.info.size > 20000) L.info.clear();
  return f;
}
function fieldAt(L, wx, d) { const k = rowAt(L, wx, d); return fieldInfo(L, k, colAt(L, k, wx, d)); }

// Villages: at most one per 1600 m world cell, centred on a church, in a slow "settled" stretch.
const VCELL = 1600;
function villageIn(L, i) {
  if (L.villages.has(i)) return L.villages.get(i);
  const v = makeVillage(L, i);
  if (L.villages.size > 2000) L.villages.clear();
  L.villages.set(i, v);
  return v;
}
function makeVillage(L, i) {
  const h = hashInts(L.ws, 81, i);
  const cx = (i + 0.25 + 0.5 * ((h & 4095) / 4095)) * VCELL;
  if (noise1(cx / 3000, L.ws + 55) < 0.62) return null;
  const r = makeRng(h);
  const dc = 90 * Math.pow(18, r());                // 90 m .. 1.6 km from the line
  return { i, cx, dc, R: 70 + 0.08 * dc + 60 * r(), spire: r() < 0.3, seed: h };
}
// Inside the built-up part of a village (tighter than nearVillage, which also tints the gardens).
function inVillage(L, wx, d) {
  const v = nearVillage(L, wx, d);
  return !!v && Math.abs(wx - v.cx) < v.R + 10 && Math.abs(d - v.dc) < Math.max(30, v.R * 0.7);
}
function nearVillage(L, wx, d) {
  const i = Math.floor(wx / VCELL);
  for (let k = i - 1; k <= i + 1; k++) {
    const v = villageIn(L, k);
    if (v && Math.abs(wx - v.cx) < v.R * 1.3 && Math.abs(d - v.dc) < v.R * 0.7) return v;
  }
  return null;
}

// Colour of the ground at a world point: the field, with stripes, mottling and a grassy headland.
function groundColor(ctx, L, wx, d, rng, y) {
  const k = rowAt(L, wx, d), j = colAt(L, k, wx, d);
  const f = fieldInfo(L, k, j);
  let c = f.color;
  const near = smooth(900, 150, d);
  if (f.stripe) {
    const coord = f.dir ? d : wx + 0.3 * d;
    const s = Math.sin((coord / f.period) * Math.PI * 2) > 0 ? 1 : -1;
    c = mul3(c, 1 + f.stripe * s * near);
  }
  const m = noise2(wx / 31, d / 31, L.ws + 3) * 0.6 + noise2(wx / 7, d / 7, L.ws + 4) * 0.4;
  c = mul3(c, 0.86 + 0.26 * m);
  // headland: a band of rough grass inside each boundary
  const edge = Math.min(d - edgeD(L, k, wx), k + 1 < L.rows.length ? edgeD(L, k + 1, wx) - d : 1e9,
    Math.abs(wx - colEdge(L, k, j, d)), Math.abs(colEdge(L, k, j + 1, d) - wx));
  const hw = 2.5 + 0.004 * d;
  if (edge < hw && !f.wood) c = mix3(c, [0.28, 0.38, 0.17], 0.6 * (1 - edge / hw));
  if (d > 600) {
    // far: chalk downland tops read paler, valley floors greener
    const hgt = (y != null ? y : ctx.terrain.height(wx, d)) - 0.025 * d;
    c = mix3(c, [0.42, 0.5, 0.28], smooth(60, 160, hgt) * 0.5);
  }
  if (d < 1800 && nearVillage(L, wx, d)) c = mix3(c, [0.27, 0.36, 0.17], 0.5);
  return jitter(c, rng, 0.05);
}

// ---------------------------------------------------------------------------------------------
// Objects shared by the near and mid bands (and trackside for hedges near the line)
// ---------------------------------------------------------------------------------------------

// Hedges along row edges, in 40 m world pieces so a hedge cut by a chunk border lines up.
function* rowHedges(ctx, out, L, dLo, dHi, opts = {}) {
  const P = 40;
  for (let k = 1; k < L.rows.length; k++) {
    const q = L.rows[k];
    if (q.D + q.amp < dLo || q.D - q.amp >= dHi) continue;
    if (q.D - q.amp > dHi + 50) break;
    for (const { i, wx0 } of cellsAround(ctx, P, 2)) {
      const present = noise1(wx0 / 380, L.ws + k * 29 + 3);
      if (present < 0.3) continue;
      const d = edgeD(L, k, wx0 + P / 2);
      if (d < dLo || d >= dHi) continue;
      if (d < 1800 && inVillage(L, wx0 + P / 2, d)) continue;     // no field hedges through the houses
      const rng = worldRng(ctx, 7, k, i);
      const path = (t) => { const wx = wx0 + t * P; return [wx - ctx.x0, edgeD(L, k, wx)]; };
      yield* hedge(ctx, out, path, P, { rng, height: 1.8 + 1.6 * noise1(wx0 / 900, L.ws + k), width: 2, gaps: present < 0.42 ? 0.6 : 0.15, wobbleSalt: k * 7, color: PAL.hedge });
      // hedgerow trees
      if (opts.trees !== false && !opts.noTrees) {
        const pT = 0.25 + 0.4 * noise1(wx0 / 1400, L.ws + 17);
        for (let t = 0; t < 2; t++) {
          const roll = rng();
          const wx = wx0 + rng() * P, dd = edgeD(L, k, wx) + (rng() - 0.5) * 2;
          // fewer big trees right by the line, so they frame the view instead of walling it off
          if (roll > pT * 0.75 * smooth(15, 120, dd)) continue;
          if (opts.treeFrom && dd < opts.treeFrom) continue;
          yield* fieldTree(ctx, out, wx - ctx.x0, dd, rng, 1);
        }
      }
      if (opts.capAt && out.n > opts.capAt) return;
    }
  }
}
// Hedges along field boundaries running away from the track.
function* colHedges(ctx, out, L, dLo, dHi, margin, opts = {}) {
  for (let k = 1; k + 1 < L.rows.length; k++) {
    const q = L.rows[k], d0 = q.D, d1 = L.rows[k + 1].D;
    if (d1 < dLo) continue;
    if (d0 >= dHi) break;
    const a = Math.floor((ctx.x0 - margin) / q.W) - 1, b = Math.floor((ctx.x0 + ctx.length + margin) / q.W) + 1;
    for (let j = a; j <= b; j++) {
      const h = hashInts(L.ws, 63, k, j);
      if ((h & 255) < 90) continue;                 // about a third of boundaries have no hedge
      const da = Math.max(d0, dLo), db = Math.min(d1, dHi);
      if (db <= da) continue;
      const xm = colEdge(L, k, j, (da + db) / 2);
      if (xm < ctx.x0 - margin || xm > ctx.x0 + ctx.length + margin) continue;
      if ((da + db) / 2 < 1800 && inVillage(L, xm, (da + db) / 2)) continue;
      const rng = worldRng(ctx, 9, k, j, Math.floor(da));
      const path = (t) => { const d = lerp(da, db, t); return [colEdge(L, k, j, d) - ctx.x0, d]; };
      yield* hedge(ctx, out, path, db - da, { rng, height: 2 + 1.5 * ((h >>> 8 & 255) / 255), width: 2, gaps: 0.2, wobbleSalt: 300 + j, color: PAL.hedge });
      const nT = Math.floor((db - da) / 30);
      for (let t = 0; t < nT; t++) {
        if (rng() > 0.4) continue;
        const d = lerp(da, db, rng());
        yield* fieldTree(ctx, out, colEdge(L, k, j, d) - ctx.x0, d, rng, 1);
      }
      if (opts.capAt && out.n > opts.capAt) return;
    }
  }
}
function* fieldTree(ctx, out, x, d, rng, size = 1) {
  const H = (9 + 9 * rng()) * size;
  const kind = rng();
  if (kind < 0.07) yield* conifer(ctx, out, x, d, { height: H * 0.9, rng, color: [0.1, 0.17, 0.11] });
  else yield* broadleaf(ctx, out, x, d, { height: H, crown: H * (0.7 + 0.3 * rng()), rng, color: TREE_GREENS[Math.floor(rng() * TREE_GREENS.length)] });
}

// Per-field contents: woods, field oaks, farmsteads, flocks. Anchors decide the band.
function* fieldContents(ctx, out, L, dLo, dHi, margin, opts = {}) {
  const spacing = opts.woodSpacing || 8;
  for (let k = 0; k + 1 < L.rows.length; k++) {
    const q = L.rows[k], d0 = q.D - q.amp, d1 = L.rows[k + 1].D + L.rows[k + 1].amp;
    if (d1 < dLo) continue;
    if (d0 >= dHi) break;
    const a = Math.floor((ctx.x0 - margin) / q.W) - 1, b = Math.floor((ctx.x0 + ctx.length + margin) / q.W) + 1;
    for (let j = a; j <= b; j++) {
      const f = fieldInfo(L, k, j);
      const rng = worldRng(ctx, 11, k, j);
      const dMid = (q.D + L.rows[k + 1].D) / 2;
      const xl = colEdge(L, k, j, dMid), xr = colEdge(L, k, j + 1, dMid);
      if (xr < ctx.x0 - margin || xl > ctx.x0 + ctx.length + margin) continue;
      if (f.wood) {
        // a copse: trees on a world-aligned jittered grid inside the field, denser at the front
        const gx0 = Math.floor(Math.max(xl - 40, ctx.x0 - margin) / spacing), gx1 = Math.floor(Math.min(xr + 40, ctx.x0 + ctx.length + margin) / spacing);
        const gd0 = Math.floor(Math.max(d0, dLo) / spacing), gd1 = Math.floor(Math.min(d1, dHi) / spacing);
        for (let gd = gd0; gd <= gd1; gd++) {
          for (let gx = gx0; gx <= gx1; gx++) {
            const tr = worldRng(ctx, 13, gx, gd);
            const wx = (gx + tr()) * spacing, d = (gd + tr()) * spacing;
            if (d < dLo || d >= dHi) continue;
            const fk = rowAt(L, wx, d);
            if (fk !== k || colAt(L, k, wx, d) !== j) continue;
            if (d < 1800 && inVillage(L, wx, d)) continue;
            // trees at the wood's edge get full detail; the canopy behind, and far woods, get less
            const front = d - edgeD(L, k, wx) < spacing * 1.5;
            const H = 11 + 10 * tr();
            const col = TREE_GREENS[Math.floor(tr() * TREE_GREENS.length)];
            if (tr() < 0.12) yield* conifer(ctx, out, wx - ctx.x0, d, { height: H, rng: tr, color: [0.1, 0.17, 0.11] });
            else yield* broadleaf(ctx, out, wx - ctx.x0, d, { height: H, crown: spacing * 1.5, rng: tr, color: mul3(col, 0.9), n: Math.max(3, Math.round(treeSplats(out, d, spacing * 1.5) * (front ? 1 : 0.25) * Math.min(1, 800 / d))) });
          }
          if (opts.capAt && out.n > opts.capAt) return;
        }
        continue;
      }
      if (dMid < 1800 && inVillage(L, (xl + xr) / 2, dMid)) continue;   // village plots: no oaks, farms or flocks
      // isolated field oaks
      for (let t = 0; t < f.oaks; t++) {
        const d = lerp(q.D, L.rows[k + 1].D, 0.25 + 0.5 * rng()), wx = lerp(xl, xr, 0.15 + 0.7 * rng());
        if (d < dLo || d >= dHi || k === 0) continue;
        yield* broadleaf(ctx, out, wx - ctx.x0, d, { height: 12 + 8 * rng(), crown: 13 + 6 * rng(), rng, color: TREE_GREENS[t % TREE_GREENS.length], squash: 0.75 });
      }
      // a farmstead set back from the front edge of the field
      if (f.farm) {
        const d = q.D + 14 + 10 * rng(), wx = lerp(xl, xr, 0.2 + 0.6 * rng());
        if (d >= dLo && d < dHi && !opts.noFarms) yield* farmstead(ctx, out, wx - ctx.x0, d, rng, 1);
      }
      // sheep or cattle, near enough to see
      if (f.flock && dHi <= 3000) {
        const n = f.flock === 1 ? 8 + Math.floor(rng() * 18) : 5 + Math.floor(rng() * 8);
        const fx = lerp(xl, xr, 0.2 + 0.6 * rng()), fd = lerp(q.D, L.rows[k + 1].D, 0.3 + 0.4 * rng());
        if (fd < 25 || fd > 700) continue;
        for (let s = 0; s < n; s++) {
          const wx = fx + rng.gauss() * 14, d = fd + rng.gauss() * 6;
          if (d < dLo || d >= dHi) continue;
          const x = wx - ctx.x0, y = groundY(ctx, x, d);
          const sheep = f.flock === 1;
          const c = sheep ? [0.74, 0.72, 0.64] : rng() < 0.5 ? [0.12, 0.1, 0.09] : [0.38, 0.24, 0.15];
          const bl = sheep ? 0.55 : 1.0, bh = sheep ? 0.35 : 0.6;
          out(x, y + bh * 1.3, -d, bl, bh, bh * 0.9, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
          out(x + (rng() < 0.5 ? -1 : 1) * bl * 1.1, y + bh * 1.5, -d, bh * 0.5, bh * 0.45, bh * 0.45, c[0] * 0.5, c[1] * 0.5, c[2] * 0.5, 1, 0, 0, 0, 1, KIND.OTHER);
        }
        if (out.due()) yield;
      }
    }
  }
}

// House, barn and a shed, with a tree. `wrong` > 0 nudges it for the repeating (logic) version.
function* farmstead(ctx, out, x, d, rng, scale = 1, wrong = 0) {
  const yaw = (rng() - 0.5) * 0.5 + (rng() < 0.25 ? Math.PI / 2 : 0);
  const wall = WALLS[Math.floor(rng() * WALLS.length)];
  const roof = ROOFS[Math.floor(rng() * ROOFS.length)];
  yield* house(ctx, out, x, d, { w: 10 * scale, depth: 7 * scale, h: 6 * scale, wall, roof: wrong ? mix3(roof, [0.2, 0.3, 0.45], wrong) : roof, yaw, rng });
  const bx = x + (rng() < 0.5 ? -1 : 1) * (16 + 6 * rng()) * scale, bd = d + (4 + 10 * rng()) * scale;
  const barnWall = rng() < 0.6 ? [0.17, 0.15, 0.13] : [0.5, 0.48, 0.44];
  yield* house(ctx, out, bx, bd, { w: 20 * scale, depth: 10 * scale, h: 5 * scale, roofH: 3 * scale, wall: barnWall, roof: rng() < 0.5 ? [0.42, 0.43, 0.42] : [0.4, 0.22, 0.16], windows: false, chimney: false, yaw: yaw + (wrong ? wrong * 0.6 : 0), rng });
  if (rng() < 0.6) yield* house(ctx, out, x - (bx - x) * 0.6, d + 12 * scale, { w: 8 * scale, depth: 6 * scale, h: 3.5 * scale, roofH: 1.5, wall: [0.45, 0.42, 0.38], roof: [0.36, 0.36, 0.36], windows: false, chimney: false, yaw, rng });
  yield* broadleaf(ctx, out, x + (rng() - 0.5) * 10, d + 10 + rng() * 6, { height: 13 + 5 * rng(), rng });
}

// A village: houses along a street parallel to the line and one running away from it, round a church.
function* villages(ctx, out, L, dLo, dHi, opts = {}) {
  const lo = Math.floor((ctx.x0 - 400) / VCELL), hi = Math.floor((ctx.x0 + ctx.length + 400) / VCELL);
  for (let i = lo; i <= hi; i++) {
    const v = villageIn(L, i);
    if (!v) continue;
    if (v.dc + v.R < dLo || v.dc - v.R > dHi) continue;
    const vr = makeRng(v.seed);
    // church
    if (v.dc >= dLo && v.dc < dHi) {
      yield* church(ctx, out, v.cx - ctx.x0, v.dc + 14, { rng: vr, spire: v.spire ? 16 : 0, h: 18 + 6 * vr(), yaw: 0 });
      for (let t = 0; t < 3; t++) yield* broadleaf(ctx, out, v.cx - ctx.x0 + (vr() - 0.5) * 40, v.dc + 22 + vr() * 15, { height: 14 + 6 * vr(), rng: vr });
      if (opts.lanes !== false) yield* strip(ctx, out, (t) => [v.cx - v.R + 2 * v.R * t - ctx.x0, v.dc - 6], 2 * v.R, { width: 4, color: [0.42, 0.41, 0.38], rng: vr });
    }
    // houses both sides of the street (parallel to the line, at dc - 6) and along a lane running
    // away from the line through the centre; [world x, distance, yaw]
    const spots = [];
    for (let s = -v.R; s <= v.R; s += 15) { spots.push([v.cx + s, v.dc + 2, 0]); spots.push([v.cx + s + 7, v.dc - 15, 0]); }
    for (let s = 24; s < v.R * 0.7; s += 15) { spots.push([v.cx + 11, v.dc + s, Math.PI / 2]); spots.push([v.cx - 11, v.dc + s + 7, Math.PI / 2]); }
    for (let si = 0; si < spots.length; si++) {
      const hr = makeRng(hashInts(v.seed, si));
      // irregular plots: nudge each house off the street line and turn some gable-on
      const wx = spots[si][0] + (hr() - 0.5) * 6, dd = spots[si][1] + (hr() - 0.5) * 5;
      const yaw = spots[si][2] + (hr() < 0.2 ? Math.PI / 2 : 0);
      if (hr() < 0.3) continue;
      if (Math.abs(wx - v.cx) < 20 && Math.abs(dd - v.dc - 14) < 12) continue;   // the churchyard
      if (dd < dLo || dd >= dHi) continue;
      yield* house(ctx, out, wx - ctx.x0, dd, { w: 7 + 4 * hr(), depth: 6 + 2 * hr(), h: 5 + 1.8 * hr(), wall: WALLS[Math.floor(hr() * WALLS.length)], roof: ROOFS[Math.floor(hr() * ROOFS.length)], yaw: yaw + (hr() - 0.5) * 0.15, rng: hr });
      if (hr() < 0.35) yield* broadleaf(ctx, out, wx - ctx.x0 + (hr() - 0.5) * 12, dd + 9, { height: 8 + 6 * hr(), rng: hr });
      if (opts.capAt && out.n > opts.capAt) return;
    }
  }
}

// Lanes: a few row edges carry a lane alongside the hedge; drawn in 60 m world pieces.
function* lanes(ctx, out, L, dLo, dHi) {
  const P = 60;
  for (let k = 1; k < L.rows.length; k++) {
    const q = L.rows[k];
    if (q.D > dHi + 60) break;
    if ((hashInts(L.ws, 91, k) & 255) > 30 || q.D < 25) continue;
    for (const { i, wx0 } of cellsAround(ctx, P, 0)) {
      if (noise1(wx0 / 1200, L.ws + k * 5) < 0.35) continue;
      const d = edgeD(L, k, wx0) + 4;
      if (d < dLo || d >= dHi) continue;
      yield* strip(ctx, out, (t) => { const wx = wx0 + t * P; return [wx - ctx.x0, edgeD(L, k, wx) + 4]; }, P, { width: 4, color: [0.44, 0.43, 0.4], rng: worldRng(ctx, 93, k, i) });
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------------------------

function* trackside(ctx, emit) {
  const out = makeOut(ctx, emit, { zMargin: 1, detailK: 1.2 });
  out.limit = ctx.count * 0.6;
  const L = layout(ctx);
  const N = ctx.count;
  const stretch = (wx, s, salt) => ctx.terrain.stretch(wx, s, salt);

  // overhead line: masts every beat of world x, two field-side wires swooping between them
  yield* overheadLine(ctx, out, ctx.beatMetres || 56, { d: 3.7 });

  // concrete cable trough along the cess: continuous along x, so it stays crisp under blur
  const tStep = 0.45 / Math.min(1, Math.sqrt(out.density));
  for (let x = tStep / 2; x < ctx.length; x += tStep) {
    const y = groundY(ctx, x, 4.5) + 0.12;
    out(x, y, -4.5, tStep * 0.68, 0.1, 0.22, 0.58, 0.57, 0.53, 1, 0, 0, 0, 1, KIND.OTHER);
    out(x, y - 0.05, -4.32, tStep * 0.68, 0.09, 0.02, 0.46, 0.45, 0.42, 1, 0, 0, 0, 1, KIND.OTHER);
    if (out.due()) yield;
  }

  // the boundary: post-and-wire fence, or in places a laid hawthorn hedge just beyond it
  yield* fence(ctx, out, 6.6, { spacing: 2.7 });
  for (const { i, wx0 } of cellsAround(ctx, 30, 2)) {
    if (stretch(wx0, 700, 41) < 0.68) continue;
    yield* hedge(ctx, out, (t) => [wx0 + 30 * t - ctx.x0, 7.6], 30, { rng: worldRng(ctx, 15, i), height: 1.4, width: 1.2, color: [0.17, 0.26, 0.11], gaps: 0.1, wobbleSalt: 5 });
  }

  // lineside scrub and saplings: brambles near the fence, trees further back, in stretches
  for (const { i, wx0 } of cellsAround(ctx, 7, 4)) {
    const scrub = stretch(wx0, 260, 43);
    if (scrub < 0.45) continue;
    const r = worldRng(ctx, 17, i);
    // brambles and blackthorn in low, wide clumps hugging the fence; a run of them reads as scrub
    if (r() < scrub) {
      const n = 1 + Math.floor(r() * 3);
      for (let b = 0; b < n; b++) yield* bush(ctx, out, wx0 + r() * 7 - ctx.x0, 7.2 + r() * 2.5, 3 + 3 * r(), 0.6 + 0.9 * r(), { rng: r, color: jitter(PAL.scrub, r, 0.15) });
    }
  }
  for (const { i, wx0 } of cellsAround(ctx, 16, 8)) {
    const wood = stretch(wx0, 500, 47);
    const r = worldRng(ctx, 19, i);
    if (r() > 0.04 + 0.4 * smooth(0.55, 0.8, wood)) continue;
    const d = 12 + r() * 16;
    const fk = rowAt(L, wx0, d);
    if (fk > 0 && fieldInfo(L, fk, colAt(L, fk, wx0, d)).farm) continue;
    yield* fieldTree(ctx, out, wx0 + r() * 16 - ctx.x0, d, r, 0.8 + 0.3 * r());
  }

  // field hedges that come close to the line
  yield* rowHedges(ctx, out, L, 8, ctx.zFar, { treeFrom: 9 });

  // ground: ballast and cess (mostly below the window), a tufty verge, then the field
  const rest = out.left();
  const ballast = PAL.ballast;
  yield* fillGround(ctx, out, {
    n: Math.round(rest * 0.03), dNear: 2.5, dFar: 4.4, power: 0, cover: 3.5, slope: false,
    color: (wx, d, rng) => (d < 3.4 ? jitter(ballast, rng, 0.25) : jitter([0.36, 0.32, 0.26], rng, 0.2)),
  });
  yield* fillGround(ctx, out, {
    n: Math.round(rest * 0.07), dNear: 4.6, dFar: 6.9, power: 0, cover: 4, slope: false, flat: 0.4,
    color: (wx, d, rng) => jitter(mix3([0.28, 0.38, 0.16], [0.46, 0.44, 0.26], noise2(wx / 3, d, L.ws) * 0.7), rng, 0.15),
  });
  yield* fillGround(ctx, out, {
    dNear: 6.7, dFar: ctx.zFar + 1, power: 1.5, cover: 4.5, slope: false,
    color: (wx, d, rng) => groundColor(ctx, L, wx, d, rng),
  });
}

function* near(ctx, emit) {
  const out = makeOut(ctx, emit, { detailK: 1.2 });
  const L = layout(ctx);
  const cap = ctx.count * 0.62;
  out.limit = ctx.count * 0.8;
  const dz = ctx.dials || {};
  yield* rowHedges(ctx, out, L, ctx.zNear, ctx.zFar, { capAt: cap });
  yield* colHedges(ctx, out, L, ctx.zNear, ctx.zFar, 20, { capAt: cap });
  yield* lanes(ctx, out, L, ctx.zNear, ctx.zFar);
  yield* villages(ctx, out, L, ctx.zNear, ctx.zFar, { capAt: cap });
  yield* repeatingFarm(ctx, out, dz.logic || 0);
  if (out.n < cap) yield* fieldContents(ctx, out, L, ctx.zNear, ctx.zFar, 25, { woodSpacing: 8, capAt: cap });
  yield* fillGround(ctx, out, { power: 1.5, cover: 3.2, slope: false, color: (wx, d, rng, x, y) => groundColor(ctx, L, wx, d, rng, y) });
}

// Logic dial: the same farmstead (same design, same distance) every 560 m of world x along
// "repeating" stretches, each copy a little more wrong (roof drifting blue, barn turning, growing).
function* repeatingFarm(ctx, out, logic) {
  if (logic <= 0) return;
  const P = 560;
  for (const { i, wx0 } of cellsAround(ctx, P, 40)) {
    if (noise1(wx0 / 4000, worldSeed(ctx) + 123) > 0.25 + logic) continue;
    const d = 62;
    const wrong = ((i % 5) + 5) % 5 / 4;
    const rng = worldRng(ctx, 777);          // the same design every time
    yield* farmstead(ctx, out, wx0 + P * 0.5 - ctx.x0, d, rng, 1 + 0.12 * wrong, wrong * logic * 2);
  }
}

function* mid(ctx, emit) {
  const out = makeOut(ctx, emit, { detailK: 1.9 });
  const L = layout(ctx);
  const cap = ctx.count * 0.72;
  out.limit = ctx.count * 0.8;
  const dz = ctx.dials || {};
  yield* rowHedges(ctx, out, L, ctx.zNear, ctx.zFar, { capAt: cap });
  yield* colHedges(ctx, out, L, ctx.zNear, 1400, 30, { capAt: cap });
  yield* villages(ctx, out, L, ctx.zNear, ctx.zFar, { capAt: cap, lanes: false });
  // at small budgets, fewer and bigger trees rather than the same trees in ever fewer splats
  const sp = 15 / Math.pow(Math.min(1, out.density), 0.4);
  if (out.n < cap) yield* fieldContents(ctx, out, L, ctx.zNear, ctx.zFar, 30, { woodSpacing: sp, capAt: cap, noFarms: false });
  // chalk downland: beech clumps on the higher ground
  for (const { i, wx0 } of cellsAround(ctx, 260, 20)) {
    const r = worldRng(ctx, 31, i);
    const d = 900 + r() * 2000, wx = wx0 + r() * 260;
    const hgt = ctx.terrain.height(wx, d) - 0.025 * d;
    if (hgt < 70 || r() < 0.5) continue;
    const nT = 4 + Math.floor(r() * 8);
    for (let t = 0; t < nT; t++) yield* broadleaf(ctx, out, wx - ctx.x0 + r.gauss() * 14, d + r.gauss() * 8, { height: 20 + 6 * r(), crown: 16, rng: r, color: [0.16, 0.26, 0.12] });
  }
  if ((dz.topology || 0) > 0) yield* islands(ctx, out, 1300, 900, 2600, 140, 420, 60, 150, dz.topology, 1);
  if ((dz.scale || 0) > 0) yield* giants(ctx, out, 2200, 1200, 2700, 0.35, 140, 260, dz.scale, 2);
  yield* fillGround(ctx, out, { power: 1.2, cover: 3, maxR: 0.05, color: (wx, d, rng, x, y) => groundColor(ctx, L, wx, d, rng, y) });
}

// Far: the downs and low hills, darker woods on their flanks, and the surreal big things.
function* far(ctx, emit) {
  const out = makeOut(ctx, emit);
  const L = layout(ctx);
  const dz = ctx.dials || {};
  const ws = worldSeed(ctx);
  // woods as dark clumps on slopes, from a world grid
  const S = 240;
  const budget = ctx.count * 0.25;
  out.limit = ctx.count * 0.6;
  for (const { i, wx0 } of cellsAround(ctx, S, 10)) {
    for (let gd = Math.floor(ctx.zNear / S); gd * S < ctx.zFar; gd++) {
      const d = (gd + 0.5) * S;
      const w = noise2(wx0 / 2200, d / 2200, ws + 201);
      if (w < 0.58) continue;
      const r = worldRng(ctx, 33, i, gd);
      const wx = wx0 + r() * S, dd = d + (r() - 0.5) * S;
      const sz = 50 + 70 * r();
      const y = ctx.terrain.height(wx, dd);
      yield* blob(ctx, out, wx - ctx.x0, y + sz * 0.2, dd, sz, sz * 0.35, sz * 0.8, { n: Math.max(2, Math.round(6 * Math.sqrt(out.density))), color: [0.11, 0.18, 0.1], rng: r, kind: KIND.TREE, inner: 0.2, amb: 0.65 });
      if (out.n > budget) break;
    }
    if (out.n > budget) break;
  }
  if ((dz.topology || 0) > 0) yield* islands(ctx, out, 6000, 3800, 9000, 250, 1200, 200, 450, dz.topology, 3);
  if ((dz.scale || 0) > 0) {
    yield* giants(ctx, out, 7000, 3500, 7000, 0.45, 450, 950, dz.scale, 4);
    // a monolith on the skyline now and then
    for (const { i, wx0 } of cellsAround(ctx, 11000, 400)) {
      const r = worldRng(ctx, 51, i);
      if (r() > 0.6 * dz.scale) continue;
      yield* monolith(ctx, out, wx0 + 2000 + r() * 7000 - ctx.x0, 3800 + r() * 2500, { w: 140 + 80 * r(), h: 700 + 600 * r() * dz.scale, rng: r, n: Math.round(300 * Math.sqrt(out.density)) });
    }
  }
  yield* fillGround(ctx, out, {
    power: 1.0, cover: 2.6, maxR: 0.03,
    color: (wx, d, rng, x, y) => {
      let c = groundColor(ctx, L, wx, d, rng, y);
      const w = noise2(wx / 2200, d / 2200, ws + 201);
      c = mix3(c, [0.13, 0.2, 0.12], smooth(0.5, 0.62, w) * 0.8);    // woodland under the clumps
      return mix3(c, [0.24, 0.32, 0.2], smooth(3000, 9000, d) * 0.5);  // lose field detail with distance
    },
  });
}

// Floating islands (topology): one chance per world cell, hanging well above the ground.
function* islands(ctx, out, cell, dLo, dHi, hLo, hHi, rLo, rHi, amount, salt) {
  for (const { i, wx0 } of cellsAround(ctx, cell, rHi * 1.3)) {
    const r = worldRng(ctx, 41, salt, i);
    if (r() > 0.7 * amount) continue;
    const d = dLo + r() * (dHi - dLo), wx = wx0 + r() * cell;
    const rad = rLo + r() * (rHi - rLo);
    const y = ctx.terrain.height(wx, d) + hLo + r() * (hHi - hLo) * amount;
    yield* floatingIsland(ctx, out, wx - ctx.x0, y, d, rad, {
      rng: r, n: Math.round(420 * Math.sqrt(out.density)), trees: 1 + Math.floor(r() * 3),
      top: jitter([0.34, 0.48, 0.2], r, 0.08), treeColor: [0.18, 0.29, 0.12],
    });
  }
}

// Impossibly large oaks (scale): ordinary trees grown to hill size.
function* giants(ctx, out, cell, dLo, dHi, p, hLo, hHi, amount, salt) {
  for (const { i, wx0 } of cellsAround(ctx, cell, hHi * 0.6)) {
    const r = worldRng(ctx, 43, salt, i);
    if (r() > p * amount * 1.25) continue;
    const d = dLo + r() * (dHi - dLo), wx = wx0 + r() * cell;
    const H = hLo + r() * (hHi - hLo) * amount;
    yield* broadleaf(ctx, out, wx - ctx.x0, d, { height: H, crown: H * 0.85, rng: r, n: Math.round(320 * Math.sqrt(out.density)), color: [0.12, 0.2, 0.09], kind: KIND.SURREAL });
  }
}

export const downsBiome = {
  name: 'downs',
  palette: PAL,
  // Gentle near rolls (the near field never rises past the eye), chalk hills in the mid band and
  // a line of low hills far off that clears them. See the scan in the report for the numbers.
  terrain: { cutting: 1.0, roll: 5, rollScale: 600, rise: 0.025, hills: 90, hillScale: 2000, mountains: 1100, mountainScale: 8000, mountainStart: 4000 },
  hazeDist: 6500,
  generators: { trackside, near, mid, far },
};

// exported for the check script and for other biomes that want English field patterns
export const downsLayout = { layout, fieldAt, rowAt, colAt, edgeD, colEdge, fieldInfo };
