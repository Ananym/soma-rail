// "Pinewood": a northern line through spruce and pine forest, with lakes, bogs and clearings and
// mountains far off -- Scandinavia, the Highlands, the Rockies in spirit. Cool, quiet, deep.
//
// Structure (as downs.js): one pure layout of WORLD x and distance -- lakes, the forest field, bogs,
// clear-cuts, a forest road, a power-line corridor, settlements -- hashed from the world seed and
// queried through `surface()`. Every band fills its ground from it and places its props on it, so
// lake shores, forest edges and roads line up across chunks and across bands. Only the ground fill
// uses the chunk's own rng.
//
// A forest is mostly seen as a WALL at its edge. So the forest is drawn in two parts:
//   - a cheap dark "mass": every ground-fill sample that lands inside the forest emits one tall,
//     dark splat between the forest floor and the canopy top instead of a ground disc;
//   - full trees (spruce, Scots pine, birch) only along the edges that face the camera, plus
//     a cheap spire here and there inside, so the canopy line is serrated.
//
// Surreal dials (all 0 at level 0, so level 0 shows none of this):
//   scale     spruces of impossible height among the others; far mountains that keep going up
//   topology  floating islands of forest; a lake standing upright like a wall
//   logic     the same red cabin and jetty repeating along the line, each time slightly wrong
import { hashInts, makeRng, noise1, noise2, fbm2 } from '../rng.js';
import {
  KIND, makeOut, worldSeed, worldRng, worldHash, cellsAround, stick, blob, house, church,
  overheadLine, fence, lamp, floatingIsland, wires, jitter, mul3, mix3, shade, smooth, clamp, lerp,
  quatYaw, quatRoll, quatUpTo, quatXTo, strut, norm3, Q_ID, SUN,
} from './kit.js';

const PAL = {
  ground: [0.12, 0.13, 0.08],     // dark forest floor: also the backdrop below the horizon
  foliage: [0.08, 0.14, 0.09],
  rock: [0.4, 0.4, 0.39],
  ballast: [0.4, 0.38, 0.35],
};

// Colours. Natural surfaces stay <= 0.8 per channel (kit.js caps them anyway).
const C = {
  floor: [0.12, 0.13, 0.075],        // needles and moss under the trees
  moss: [0.2, 0.25, 0.11],
  heather: [0.27, 0.2, 0.2],
  bilberry: [0.15, 0.22, 0.09],
  grass: [0.31, 0.32, 0.17],
  bogGrass: [0.47, 0.44, 0.3],
  bogMoss: [0.36, 0.35, 0.2],
  sphagnum: [0.42, 0.27, 0.2],
  peat: [0.16, 0.12, 0.08],
  pool: [0.13, 0.15, 0.17],
  gravel: [0.47, 0.44, 0.38],
  clearcut: [0.33, 0.28, 0.18],
  spruce: [0.07, 0.13, 0.085],
  spruceTip: [0.15, 0.24, 0.12],
  pineCrown: [0.085, 0.14, 0.09],
  pineBark: [0.44, 0.28, 0.18],
  barkGrey: [0.24, 0.2, 0.16],
  birchBark: [0.7, 0.69, 0.64],
  birchLeaf: [0.2, 0.28, 0.11],
  mass: [0.05, 0.085, 0.06],
  rock: [0.4, 0.4, 0.39],
  rockDark: [0.24, 0.24, 0.24],
  snow: [0.74, 0.77, 0.8],
  waterSky: [0.5, 0.56, 0.61],
  waterDeep: [0.33, 0.39, 0.44],
  waterRefl: [0.12, 0.16, 0.15],
  waterStreak: [0.64, 0.68, 0.71],
  mist: [0.72, 0.75, 0.77],
};

const TERRAIN = { roll: 22, rollScale: 380, rise: 0.035, hills: 280, hillScale: 2200, mountains: 2200, mountainScale: 8000 };

// Surface types
const T = { GROUND: 0, FOREST: 1, WATER: 2, BOG: 3, ROAD: 4, OPEN: 5, CLEARCUT: 6, YARD: 7, RIPRAP: 8 };

// ---------------------------------------------------------------------------------------------
// World layout (pure functions of world x and distance; cached per world seed)
// ---------------------------------------------------------------------------------------------
const worlds = new Map();
function world(ctx) {
  const ws = worldSeed(ctx);
  let W = worlds.get(ws);
  if (W) return W;
  W = { ws, H: (wx, d) => ctx.terrain.height(wx, d), lakes: [new Map(), new Map()], sites: new Map(), cuts: new Map(), lines: new Map() };
  worlds.set(ws, W);
  if (worlds.size > 6) worlds.delete(worlds.keys().next().value);
  return W;
}

// Lakes come in two families: near lakes (shore 16..240 m out) and mid lakes (300..2400 m).
// A lake is an irregular envelope (an ellipse with a noisy rim) and a constant water level; water
// lies where the terrain inside the envelope is below that level, so the shoreline follows the
// terrain's own contour and is continuous. The level is picked from the heights round the rim so
// most of the rim stands above it; a lake whose basin would hold too little water is dropped.
// Just outside the envelope, ground lower than the water is raised to it (a low dam of shore),
// so there is never a step at the rim.
const LAKE_FAMS = [
  { cell: 650, salt: 11, dMin: 14, dMax: 300, maxLevel: 0.6, p: 0.35 },
  { cell: 2200, salt: 12, dMin: 280, dMax: 1800, maxLevel: 2.2, p: 0.6 },
];
function shoreK(lk, ux, uy) { return 0.8 + 0.38 * noise2(ux * 1.7 + 5, uy * 1.7 + 5, lk.salt); }
function makeLake(W, f, i) {
  const F = LAKE_FAMS[f];
  const r = makeRng(hashInts(W.ws, 300 + F.salt, i));
  const rich = noise1(i * F.cell / 6000, W.ws + F.salt);
  if (r() > F.p + 0.6 * rich) return null;
  const ext = (f === 0 ? 90 + 260 * r() : 300 + 800 * r());
  const rx = Math.min(F.cell * 0.7, (f === 0 ? 90 : 350) + ext * (0.5 + 0.9 * r()));
  const rd = ext / 2;
  // try a few spots in the cell and keep the lowest-lying one (relative to the general rise)
  let cx = 0, dc = 0, best = Infinity;
  for (let k = 0; k < 10; k++) {
    const tx = (i + 0.3 + 0.4 * r()) * F.cell, tn = F.dMin + (F.dMax - F.dMin) * Math.pow(r(), 1.5), td = tn + rd;
    const h = W.H(tx, td) + W.H(tx - rx * 0.4, td) + W.H(tx + rx * 0.4, td);
    if (h < best) { best = h; cx = tx; dc = td; }
  }
  const lk = { f, i, cx, dc, rx, rd, salt: hashInts(W.ws, 301, f, i) & 0xffff, cabin: r(), cabinU: r(), bankH: 0 };
  const hs = [];
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a), s = shoreK(lk, ux, uy);
    hs.push(W.H(cx + ux * rx * s, dc + uy * rd * s));
  }
  hs.sort((a, b) => a - b);
  const inner = [];
  for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) inner.push(W.H(cx + a * rx * 0.3, dc + b * rd * 0.3));
  let level = null;
  for (const q of [0.25, 0.4, 0.55]) {
    const lv = hs[Math.floor(q * hs.length)];
    if (inner.filter((h) => h < lv).length >= 7) { level = lv; break; }
  }
  if (level == null || level > F.maxLevel) return null;
  lk.level = level - 0.15;
  // how high the far shore stands above the water (for the reflection band)
  let far = 0;
  for (let k = -2; k <= 2; k++) far += W.H(cx + k * rx * 0.25, dc + rd * 1.05) - lk.level;
  lk.bankH = clamp(far / 5, 0, 60);
  return lk;
}
function lakeIn(W, f, i) {
  const m = W.lakes[f];
  if (m.has(i)) return m.get(i);
  const lk = makeLake(W, f, i);
  if (m.size > 4000) m.clear();
  m.set(i, lk);
  return lk;
}
// Position of (wx, d) relative to a lake envelope: < 1 inside, 1 at the rim.
function lakeR(lk, wx, d) {
  const ux = (wx - lk.cx) / lk.rx, uy = (d - lk.dc) / lk.rd;
  const rr = Math.hypot(ux, uy);
  if (rr > 1.7) return rr;
  return rr / shoreK(lk, ux / (rr || 1), uy / (rr || 1));
}
// Every lake whose envelope (with margin) may cover world x.
function lakesNear(W, wx) {
  const res = [];
  for (let f = 0; f < 2; f++) {
    const c = LAKE_FAMS[f].cell, i0 = Math.floor(wx / c);
    for (let i = i0 - 1; i <= i0 + 1; i++) {
      const lk = lakeIn(W, f, i);
      if (lk && Math.abs(wx - lk.cx) < lk.rx * 1.6) res.push(lk);
    }
  }
  return res;
}
// The lake at a point (water there), or null.
function waterAt(W, wx, d, h = W.H(wx, d)) {
  for (const lk of lakesNear(W, wx)) {
    if (h < lk.level && Math.abs(d - lk.dc) < lk.rd * 1.6 && lakeR(lk, wx, d) < 1) return lk;
  }
  return null;
}

// The forest field: 0..1, forest where it is above 0.5. Open stretches clear the foreground so the
// view opens across bogs, clearings and lakes; the far ground is forest almost everywhere.
function forestVal(W, wx, d) {
  const base = fbm2(wx / 560, d / 430, W.ws + 401, 3);
  const open = noise1(wx / 1300, W.ws + 402);
  const clear = smooth(0.3, 0.62, open) * smooth(420, 60, d);
  // the railway's own cleared strip: forest starts 16..26 m out
  return base + 0.16 - 0.42 * clear + 0.08 * smooth(600, 2500, d) - 0.6 * smooth(34, 18, d + 10 * noise1(wx / 60, W.ws + 400));
}
// Tree height (canopy top above the ground) of the forest at a point.
function canopyH(W, wx, d) { return 15 + 9 * noise2(wx / 260, d / 260, W.ws + 403); }
// Mix of species: 0 all spruce .. 1 all pine (pine on dry high ground and in stretches).
function pineMix(W, wx, d) { return smooth(0.35, 0.75, noise2(wx / 900, d / 700, W.ws + 404)); }

// Bogs: open, pale and flat, in hollows.
function bogVal(W, wx, d) { return noise2(wx / 640, d / 380, W.ws + 405); }

// A gravel forest road wandering roughly parallel to the line, in stretches.
function roadD(W, wx) { return 45 + 70 * noise1(wx / 800, W.ws + 406) + 40 * noise1(wx / 2900, W.ws + 407); }
function roadOn(W, wx) { return noise1(wx / 2400, W.ws + 408) > 0.5; }

// A transmission line: at most one per 3600 m world cell, a straight line running away from the
// track at an angle, with a 34 m corridor cut through the forest and pylons every 320 m.
const PCELL = 3600;
function powerLine(W, i) {
  if (W.lines.has(i)) return W.lines.get(i);
  const r = makeRng(hashInts(W.ws, 409, i));
  let L = null;
  if (r() < 0.45) L = { i, wx0: (i + 0.2 + 0.6 * r()) * PCELL, slope: (r() < 0.5 ? -1 : 1) * (0.25 + 0.6 * r()), seed: hashInts(W.ws, 410, i) };
  W.lines.set(i, L);
  return L;
}
function linesNear(W, wx, dMax) {
  const res = [], i0 = Math.floor(wx / PCELL), k = Math.ceil(dMax * 0.9 / PCELL) + 1;
  for (let i = i0 - k; i <= i0 + k; i++) { const L = powerLine(W, i); if (L) res.push(L); }
  return res;
}
// Distance (in x) from a point to the power line's centre line.
function lineOff(L, wx, d) { return (wx - (L.wx0 + L.slope * d)) / Math.sqrt(1 + L.slope * L.slope); }

// Clear-cuts: straight-edged felled patches in 380 m world cells (rare near the line).
const CCELL = 380;
function clearcut(W, gx, gd) {
  const key = gx * 100003 + gd;
  if (W.cuts.has(key)) return W.cuts.get(key);
  const r = makeRng(hashInts(W.ws, 411, gx, gd));
  let c = null;
  if (r() < 0.09 && gd >= 1) c = { x0: (gx + 0.1 * r()) * CCELL, x1: (gx + 0.6 + 0.35 * r()) * CCELL, d0: (gd + 0.1 * r()) * CCELL, d1: (gd + 0.55 + 0.4 * r()) * CCELL, age: r() };
  if (W.cuts.size > 20000) W.cuts.clear();
  W.cuts.set(key, c);
  return c;
}
function inClearcut(W, wx, d) {
  const c = clearcut(W, Math.floor(wx / CCELL), Math.floor(d / CCELL));
  return !!c && wx > c.x0 && wx < c.x1 && d > c.d0 && d < c.d1 ? c : null;
}

// Settlements: a rare village (church, houses) or sawmill in the mid distance, and lake cabins.
const SCELL = 5200;
function site(W, i) {
  if (W.sites.has(i)) return W.sites.get(i);
  const r = makeRng(hashInts(W.ws, 412, i));
  let s = null;
  if (r() < 0.4) {
    const cx = (i + 0.2 + 0.6 * r()) * SCELL, dc = 380 + 1300 * Math.pow(r(), 1.3);
    if (W.H(cx, dc) < 0.06 * dc + 40) s = { i, cx, dc, R: 90 + 0.06 * dc, mill: r() < 0.4, seed: hashInts(W.ws, 413, i) };
  }
  if (W.sites.size > 30000) W.sites.clear();
  W.sites.set(i, s);
  return s;
}
function siteAt(W, wx, d) {
  const i0 = Math.floor(wx / SCELL);
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const s = site(W, i);
    if (s && Math.abs(wx - s.cx) < s.R * 1.6 && Math.abs(d - s.dc) < s.R) return s;
  }
  return null;
}

// What covers the ground at a world point, and how high it is. One call per fill sample, so it
// checks the cheap things first.  Returns a reused object { t, y, h, lake, f }.
const SURF = { t: 0, y: 0, h: 0, lake: null, f: 0 };
function surface(W, wx, d, h = W.H(wx, d)) {
  const s = SURF;
  s.h = h; s.y = h; s.lake = null; s.f = 0;
  // water, or the shore raised to the water at the rim
  for (const lk of lakesNear(W, wx)) {
    if (Math.abs(d - lk.dc) > lk.rd * 1.6 || h > lk.level + 0.4) continue;
    const rr = lakeR(lk, wx, d);
    if (rr < 1) {
      if (h < lk.level) {
        // the railway's embankment holds the water back: a stone bank up to 10 m from the track
        if (d < 10) { s.t = T.RIPRAP; s.y = lerp(h, lk.level + 0.3, smooth(5.4, 8.5, d)); return s; }
        s.t = T.WATER; s.y = lk.level; s.lake = lk; return s;
      }
    }
    else if (rr < 1.3) s.y = Math.max(s.y, lerp(lk.level + 0.3, h, (rr - 1) / 0.3));
  }
  if (d < 8.5) s.y = lerp(h, s.y, smooth(5.4, 8.5, d));      // meet the railway's own cess
  if (d < 7) { s.t = T.GROUND; return s; }
  if (d < 400 && roadOn(W, wx) && Math.abs(d - roadD(W, wx)) < 2.6) { s.t = T.ROAD; return s; }
  if (d > 300 && d < 2600 && siteAt(W, wx, d)) { s.t = T.YARD; return s; }
  const f = forestVal(W, wx, d);
  s.f = f;
  if (d > 25) for (const L of linesNear(W, wx, d)) if (Math.abs(lineOff(L, wx, d)) < 17) { s.t = T.OPEN; return s; }
  if (d < 2500 && bogVal(W, wx, d) > 0.77) { s.t = T.BOG; return s; }
  if (f > 0.5) {
    if (d > 200 && inClearcut(W, wx, d)) { s.t = T.CLEARCUT; return s; }
    if (d < 400 && roadOn(W, wx) && Math.abs(d - roadD(W, wx)) < 7) { s.t = T.OPEN; return s; }
    s.t = T.FOREST; return s;
  }
  s.t = T.OPEN;
  return s;
}
// Ground height props should stand on (the water level on a lake).
function surfY(W, wx, d) { return surface(W, wx, d).y; }
function isForest(W, wx, d) { return surface(W, wx, d).t === T.FOREST; }

// ---------------------------------------------------------------------------------------------
// Colours of the surfaces
// ---------------------------------------------------------------------------------------------
function waterColor(W, lk, wx, d, rng) {
  const hc = 2.6 - lk.level;
  // far shore at this x (the envelope's far rim)
  const u = (wx - lk.cx) / lk.rx;
  const dFar = lk.dc + lk.rd * Math.sqrt(Math.max(0, 1 - u * u)) * 0.95;
  // the reflected ray from here meets the far shore at height hRef above the water: below the
  // tree tops it shows the dark forest, above it the sky
  const hRef = hc * Math.max(0, dFar - d) / d;
  // (the reflection is drawn shorter than a mirror would make it: a breath of wind on the water
  // breaks up its lower part, and the lake reads lighter than the forest)
  const wall = (lk.bankH + canopyH(W, wx, dFar)) * 0.45 + 2 * (noise1(wx / 7, lk.salt) - 0.5);
  const refl = smooth(wall + 1.5, wall - 1.5, hRef) * smooth(lk.dc - lk.rd * 1.2, lk.dc, dFar);
  // sky reflection: paler toward grazing angles (far), deeper blue-grey looking down (near)
  const graze = smooth(0.12, 0.01, hc / d);
  let c = mix3(C.waterDeep, C.waterSky, graze);
  c = mix3(c, C.waterRefl, refl * 0.85);
  // a few pale horizontal streaks: wind lanes, constant along d, long in x
  const st = noise2(wx / 90, d / (1.2 + 0.012 * d), lk.salt + 7);
  c = mix3(c, C.waterStreak, smooth(0.8, 0.92, st) * (1 - 0.6 * refl) * 0.7);
  return jitter(c, rng, 0.025);
}

function groundColor(W, s, wx, d, rng) {
  let c;
  const m = noise2(wx / 9, d / 9, W.ws + 31);
  switch (s.t) {
    case T.FOREST: c = mix3(C.floor, C.moss, m * 0.5); break;
    case T.ROAD: c = C.gravel; break;
    case T.RIPRAP: c = mix3(C.rock, C.rockDark, m); break;
    case T.YARD: c = mix3(C.grass, C.gravel, m * 0.6); break;
    case T.CLEARCUT: c = mix3(C.clearcut, C.heather, m * 0.5); break;
    case T.BOG: {
      const pool = noise2(wx / 14, d / 9, W.ws + 33);
      // pools: dark peat water that reflects the sky at a glance
      if (pool > 0.68 && d < 1200) return jitter(mix3(C.pool, C.waterSky, smooth(0.08, 0.01, 2.6 / d) * 0.8), rng, 0.05);
      c = mix3(C.bogGrass, C.bogMoss, m);
      c = mix3(c, C.sphagnum, smooth(0.6, 0.8, noise2(wx / 11, d / 7, W.ws + 36)) * 0.6);
      c = mix3(c, C.peat, smooth(0.55, 0.68, pool) * 0.6);
      break;
    }
    default: {
      // open ground: heather, bilberry and grass in patches; mossier toward the forest edge
      const a = clamp(noise2(wx / 23, d / 17, W.ws + 34) + 0.5 * (noise2(wx / 3.1, d / 2.3, W.ws + 35) - 0.5), 0, 1);
      c = a < 0.4 ? mix3(C.heather, C.bilberry, a / 0.4) : mix3(C.bilberry, C.grass, (a - 0.4) / 0.6);
      c = mix3(c, C.floor, smooth(0.35, 0.5, s.f) * 0.5);
    }
  }
  return jitter(mul3(c, 0.85 + 0.3 * m), rng, 0.08);
}

// ---------------------------------------------------------------------------------------------
// The surface fill: ground, water and forest mass in one pass, one splat per sample, so the band
// is always covered and the count comes out exactly at ctx.count.
//   opts: n, dNear, dFar, power, cover, minR, maxR, mass (draw the forest mass), massFrom (only this
//   far inside the forest), shadeK, colorHook(s, wx, d, c) -> c
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
  const massFrom = opts.massFrom || 0;
  for (let i = 0; i < n; i++) {
    const d = sample((i + rng()) / n);
    const x = rng() * L, wx = ctx.x0 + x;
    const dens = (n * Math.pow(d, -p) / Z) / L;
    const r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
    const s = surface(W, wx, d);
    const u = rng(), ax = 0.8 + 0.5 * rng();
    if (s.t === T.WATER) {
      const c = waterColor(W, s.lake, wx, d, rng);
      // water: flat, long in x so the streaks and the reflection edge read as horizontal
      out(x, s.y, -d, r * 1.4 * ax, r * 0.05, r * 0.7, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    } else if (s.t === T.FOREST && opts.mass && (massFrom <= 0 || isForest(W, wx, d - massFrom))) {
      // forest mass: a dark splat somewhere between the floor and the canopy top; the higher it
      // sits the lighter (sunlit tops), and the top ones are narrow spires
      const H = canopyH(W, wx, d);
      const v = Math.pow(u, 0.6);
      let c = mul3(C.mass, 0.75 + 0.9 * v * v);
      c = mix3(c, mix3(C.spruce, C.pineCrown, pineMix(W, wx, d)), 0.4 * v);
      c = jitter(c, rng, 0.18);
      if (opts.colorHook) c = opts.colorHook(s, wx, d, c, true);
      if (v > 0.82) out(x, s.y + H * (0.72 + 0.2 * v), -d, r * 0.55 * ax, H * 0.17, r * 0.55, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.TREE);
      else out(x, s.y + H * (0.12 + 0.7 * v), -d, r * 1.1 * ax, Math.max(r * 0.8, H * 0.2 * (1 - 0.4 * v)), r * 1.1, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.TREE);
    } else {
      let c = groundColor(W, s, wx, d, rng);
      if (opts.colorHook) c = opts.colorHook(s, wx, d, c, false);
      // cheap slope shading from the height difference toward the camera
      const e = Math.max(0.6, r);
      const hz = (W.H(wx, d + e) - s.h) / e;
      c = mul3(c, clamp(0.9 + 0.5 * hz * (opts.shadeK || 1), 0.55, 1.25));
      // close to the line the open ground is a rough cover of tufts rather than a floor
      const tuft = opts.tuft && d < opts.tuft && s.t !== T.ROAD ? 1 - d / opts.tuft : 0;
      out(x, s.y + 0.02 + tuft * r * 0.5 * u, -d, r * ax, r * (0.15 + 0.35 * tuft), r * (1.8 - ax), c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    }
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Trees (kit candidates). All three share the kit's shape: function* (ctx, out, x, d, opts) with
// opts { height, width, y (base height; default the terrain), n (splats), rng, kind, color }.
// With n <= 4 each draws a cheap distant version, so forests of thousands stay in budget.
// ---------------------------------------------------------------------------------------------

// How many splats a tree of height H and width W at distance d deserves at this budget.
export function coniferSplats(out, d, H, W) {
  const r = Math.max(0.03, 0.0032 * d * out.detailK / Math.sqrt(out.density)) * 1.25;
  return clamp(Math.round((H * W * 0.55) / (r * r * 1.5)), 1, 650 * Math.min(2, out.density));
}
const baseY = (ctx, x, d, opts) => (opts.y != null ? opts.y : ctx.terrain.height(ctx.x0 + x, d) - 0.15);

// Norway spruce: a narrow, tapering spire built from many small elongated splats that hang down
// and outward from the trunk in drooping, slightly irregular tiers; dark inside, lighter at the tips
// and on the sunlit side; the trunk shows only near the ground. A dark core keeps the sky from
// showing through the crown.
export function* spruce(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 16, W = opts.width || H * (0.24 + 0.08 * rng());
  const y0 = baseY(ctx, x, d, opts);
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const col = opts.color || C.spruce, tip = opts.tip || C.spruceTip;
  const n = Math.max(1, Math.round(opts.n || coniferSplats(out, d, H, W)));
  const lean = (rng() - 0.5) * 0.03;
  if (n <= 4) {
    // far: one to four stacked splats making a dark cone with a lighter, sunlit tip
    const parts = [[0.3, 0.24, 0.19, 0.85], [0.62, 0.13, 0.15, 1], [0.86, 0.05, 0.08, 1.25], [0.1, 0.2, 0.09, 0.7]];
    for (let k = 0; k < Math.min(n, 4); k++) {
      const [fy, fw, fh, b] = n === 1 ? [0.42, 0.21, 0.36, 1] : parts[k];
      const c = jitter(mul3(mix3(col, tip, (b - 0.7) * 0.6), b), rng, 0.1);
      out(x + lean * H * fy, y0 + H * fy, -d, W * fw, H * fh, W * fw, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
    return;
  }
  const cb = H * (0.03 + 0.1 * rng());           // lowest branches: spruce skirts nearly to the ground
  const span = H - cb;
  const T = clamp(Math.round(Math.sqrt(n) * 0.8), 3, Math.max(3, Math.round(span / 0.55)));
  const tierJ = [], tierS = [];
  for (let k = 0; k < T; k++) { tierJ.push(0.8 + 0.4 * rng()); tierS.push(0.85 + 0.3 * rng()); }
  const s0 = Math.sqrt((H * W * 0.5) / n);       // typical splat size
  // trunk, seen only below the skirt
  const trunkN = n >= 30 ? Math.max(2, Math.round(n * 0.025)) : 0;
  if (trunkN) {
    const tr = Math.max(0.06, H * 0.012), th = cb + H * 0.12;
    for (let i = 0; i < trunkN; i++) {
      const t = (i + 0.5) / trunkN * th;
      const c = mul3(C.barkGrey, 0.7 + 0.3 * t / th);
      out(x + lean * t, y0 + t, -d, tr, th / trunkN * 0.65, tr, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
  }
  // dark core
  const coreN = Math.max(1, Math.round(n * 0.08));
  for (let i = 0; i < coreN; i++) {
    const t = 1 - Math.sqrt(rng());
    const R = W * 0.5 * (1 - t);
    const c = jitter(mul3(col, 0.45), rng, 0.1);
    const ss = Math.max(s0 * 1.4, R * 0.45);
    out(x + lean * span * t, y0 + cb + span * t * 0.95, -(d - R * 0.15), ss, Math.max(ss, span / T * 0.6), ss * 0.8, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
  }
  // the branches
  const bn = n - trunkN - coreN - 2;
  const tierH = span / T;
  for (let i = 0; i < bn; i++) {
    const tt = 1 - Math.sqrt(rng());                 // more splats low down, where the crown is wide
    const k = Math.min(T - 1, Math.floor(tt * T));
    const tTop = (k + 1) / T;
    const yk = y0 + cb + span * Math.min(0.97, tTop);
    const Rk = W * 0.5 * Math.pow(1 - (k + 0.35) / T, 0.95) * tierJ[k] + 0.1;
    let a = rng() * Math.PI * 2;
    if (Math.sin(a) < -0.2 && rng() < 0.65) a = -a;   // most splats on the camera side
    const ca = Math.cos(a), sa = Math.sin(a);
    const f = 0.3 + 0.7 * Math.pow(rng(), 0.55);    // 0 trunk .. 1 branch tip
    const rr = Rk * f;
    const droop = 0.3 + 0.55 * (1 - tTop) + 0.25 * rng();
    const by = yk - droop * rr - tierH * 0.25 * rng();
    const q = quatXTo(ca, -droop, sa);
    const len = Math.min(Rk * 0.55, Math.max(s0 * 1.5, rr * 0.4));
    const th = Math.max(s0 * 0.45, len * 0.28);
    const lit = Math.max(0, ca * SUN[0] + 0.45 * SUN[1] + sa * SUN[2]);
    let c = mix3(col, tip, f * f * (0.25 + 0.75 * lit));
    c = mul3(c, (0.55 + 0.5 * f) * (0.72 + 0.5 * lit) * tierS[k]);
    c = jitter(c, rng, 0.1);
    out(x + lean * (by - y0) + ca * rr, by, -(d - sa * rr), len, th, th * 0.85, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind);
    if (out.due()) yield;
  }
  // the leader at the very top
  const lc = mul3(tip, 0.9);
  for (let i = 0; i < 2; i++) out(x + lean * H, y0 + H - tierH * (0.3 + i * 0.6), -d, Math.max(0.05, s0 * 0.35), tierH * 0.45, Math.max(0.05, s0 * 0.35), lc[0], lc[1], lc[2], 1, 0, 0, 0, 1, kind);
  if (out.due()) yield;
}

// Scots pine: a tall bare trunk, grey-brown at the foot and orange-brown higher up, carrying a
// flat-topped crown of a few dark, flattened clumps high up. Pines lean and kink a little.
export function* scotsPine(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 18, Wc = opts.width || H * (0.28 + 0.12 * rng());
  const y0 = baseY(ctx, x, d, opts);
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const col = opts.color || C.pineCrown;
  const n = Math.max(1, Math.round(opts.n || coniferSplats(out, d, H, Wc * 0.8)));
  // crown base: high on a forest pine, low on a young or stunted one out on the bog
  const cb = H * (H < 9 || opts.open ? 0.15 + 0.2 * rng() : 0.5 + 0.14 * rng());
  const lx = (rng() - 0.5) * 0.06, lx2 = (rng() - 0.5) * 0.08;   // lean, and a kink higher up
  const tx = (t) => x + lx * t + (t > cb * 0.6 ? lx2 * (t - cb * 0.6) : 0);
  const tr = Math.max(0.05, H * 0.011);
  if (n <= 4) {
    const c = shade(col, 0, 1, 0.3, 0.6, 0.5);
    if (n >= 2) out(tx(cb * 0.5), y0 + cb * 0.5, -d, Math.max(tr, 0.02 * d * 0 + tr), cb * 0.45, tr, C.pineBark[0] * 0.7, C.pineBark[1] * 0.7, C.pineBark[2] * 0.7, 1, 0, 0, 0, 1, kind);
    out(tx(cb), y0 + cb + (H - cb) * 0.55, -d, Wc * 0.36, (H - cb) * 0.28, Wc * 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    if (n >= 3) out(tx(cb) + (rng() - 0.5) * Wc * 0.4, y0 + cb + (H - cb) * 0.25, -d, Wc * 0.2, (H - cb) * 0.16, Wc * 0.2, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 1, 0, 0, 0, 1, kind);
    return;
  }
  // trunk
  const trunkN = clamp(Math.round(n * 0.14), 3, 60);
  const th = cb + (H - cb) * 0.5;
  for (let i = 0; i < trunkN; i++) {
    const t = (i + 0.5) / trunkN * th, f = t / th;
    let c = mix3(C.barkGrey, C.pineBark, smooth(0.3, 0.7, f));
    c = mul3(c, 0.7 + 0.3 * f);
    const r = tr * (1.15 - 0.5 * f);
    out(tx(t), y0 + t, -d, r, th / trunkN * 0.7, r, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    // the sunlit (left) side of the bark is brighter
    if (n > 60 && i % 2 === 0) out(tx(t) - r * 0.45, y0 + t, -(d - r * 0.3), r * 0.5, th / trunkN * 0.7, r * 0.5, c[0] * 1.25, c[1] * 1.2, c[2] * 1.1, 1, 0, 0, 0, 1, kind);
  }
  // crown: flattened clumps spread across the top, each lit on top and dark underneath
  const K = 6 + Math.floor(rng() * 4);
  const crownN = n - trunkN;
  const ctop = tx(H);
  for (let k = 0; k < K; k++) {
    // clumps fill a crown that is widest near its flat top and narrows downward, overlapping
    const vf = k === 0 ? 0.92 : Math.pow(rng(), 0.6);
    const hw = Wc * 0.5 * (0.45 + 0.55 * vf);
    const cxk = ctop + (rng() * 2 - 1) * hw * 0.8;
    const cyk = y0 + cb + (H - cb) * (0.12 + 0.72 * vf);
    const cdk = d + (rng() - 0.5) * hw * 0.8;
    const rx = Wc * (0.16 + 0.1 * rng()), ry = rx * (0.6 + 0.3 * rng());
    const m = Math.round(crownN / K);
    // the bough to this clump
    if (n > 80) {
      const bx0 = tx(cyk - y0 - ry * 2), dx = cxk - bx0, dy = ry * 2;
      const q = quatXTo(...norm3(dx, dy, 0));
      const bc = mul3(C.pineBark, 0.45);
      out((bx0 + cxk) / 2, cyk - ry, -cdk, Math.hypot(dx, dy) / 2, tr * 0.5, tr * 0.5, bc[0], bc[1], bc[2], 1, q[0], q[1], q[2], q[3], kind);
    }
    const ss = Math.sqrt((rx * rx * 2.2) / Math.max(1, m)) * 1.1;
    for (let i = 0; i < m; i++) {
      let ux = rng() * 2 - 1, uy = rng() * 2 - 1, uz = rng() * 2 - 1;
      const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
      if (uz < -0.3 && rng() < 0.7) uz = -uz;
      const rad = Math.pow(rng(), 0.4);
      let c = shade(col, ux, uy * 1.4, uz, 0.5, 0.75);
      c = mul3(c, 0.6 + 0.4 * rad);
      c = jitter(c, rng, 0.12);
      const s = ss * (0.6 + 0.6 * rng());
      out(cxk + ux * rx * rad, cyk + uy * ry * rad, -(cdk - uz * rx * 0.7 * rad), s * 1.2, s * 0.65, s, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
      if (out.due()) yield;
    }
  }
}

// Birch: a slender pale trunk with dark marks and an airy, light-green crown that droops at the
// edges. Young birches (height < 6) are mostly crown.
export function* birch(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 12, Wc = opts.width || H * (0.38 + 0.12 * rng());
  const y0 = baseY(ctx, x, d, opts);
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const leaf = opts.color || C.birchLeaf;
  const n = Math.max(1, Math.round(opts.n || coniferSplats(out, d, H, Wc) * 0.8));
  const lean = (rng() - 0.5) * 0.08;
  const tr = Math.max(0.035, H * 0.011);
  const cb = H * (0.3 + 0.12 * rng());
  if (n <= 4) {
    out(x + lean * cb * 0.5, y0 + cb * 0.5, -d, tr * 1.2, cb * 0.45, tr, C.birchBark[0] * 0.85, C.birchBark[1] * 0.85, C.birchBark[2] * 0.85, 1, 0, 0, 0, 1, kind);
    const c = shade(leaf, -0.2, 0.8, 0.4, 0.6, 0.5);
    for (let k = 0; k < Math.min(3, n - 1) || k < 1; k++) out(x + lean * H * 0.7 + (k - 1) * Wc * 0.15, y0 + cb + (H - cb) * (0.45 + 0.15 * (k % 2)), -d, Wc * 0.3, (H - cb) * 0.3, Wc * 0.25, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    return;
  }
  // trunk: white with black marks, the shaded right side greyer
  const trunkN = clamp(Math.round(n * 0.12), 3, 40);
  const th = H * 0.85;
  for (let i = 0; i < trunkN; i++) {
    const t = (i + 0.5) / trunkN * th;
    const mark = rng() < 0.28 || t < 0.6;
    const c = mark ? [0.12, 0.11, 0.1] : mul3(C.birchBark, 0.9 + 0.1 * rng());
    out(x + lean * t, y0 + t, -d, tr * (1.1 - 0.5 * t / th), th / trunkN * 0.62, tr, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
  }
  // crown: a few loose lumps up the upper trunk, light and airy, drooping outer twigs
  const crownN = n - trunkN;
  const K = 3 + Math.floor(rng() * 3);
  for (let k = 0; k < K; k++) {
    const f = (k + 0.5) / K;
    const cy = y0 + cb + (H - cb) * (0.15 + 0.75 * f);
    const w = Wc * 0.5 * (1 - 0.6 * f * f) * (0.8 + 0.4 * rng());
    const cx = x + lean * (cy - y0) + (rng() - 0.5) * w * 0.4;
    const m = Math.round(crownN / K);
    const ss = Math.sqrt((w * w * 3) / Math.max(1, m)) * 0.7;
    // foliage hangs from the twigs in short strands, so the crown reads as a soft drapery with
    // gaps rather than a ball
    const per = m >= 24 ? 4 : 1;
    for (let i = 0; i < m; i += per) {
      let ux = rng() * 2 - 1, uy = rng() * 2 - 1, uz = rng() * 2 - 1;
      const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
      if (uz < -0.3 && rng() < 0.7) uz = -uz;
      const rad = 0.35 + 0.65 * Math.pow(rng(), 0.5);
      const len = per > 1 ? w * (0.25 + 0.3 * rng()) * (0.7 + 0.6 * Math.abs(ux)) : 0;
      let c = shade(leaf, ux, uy, uz, 0.55, 0.6);
      c = mul3(c, 0.6 + 0.45 * rad);
      const px = cx + ux * w * rad, py = cy + uy * w * 0.75 * rad, pd = d - uz * w * 0.6 * rad;
      for (let j = 0; j < per; j++) {
        const cc = jitter(mul3(c, 1 - 0.12 * j), rng, 0.12);
        const s = ss * (0.6 + 0.5 * rng());
        out(px + ux * j * len * 0.08, py - j * len / per, -pd, s * 0.6, per > 1 ? Math.max(s, len / per * 0.6) : s, s * 0.6, cc[0], cc[1], cc[2], 0.8, 0, 0, 0, 1, kind);
      }
      if (out.due()) yield;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Placing trees with a shared budget: collect them first, then give each a share of the splats in
// proportion to its size on screen, capped at full detail.
// ---------------------------------------------------------------------------------------------
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
    if (out.n > out.limit) break;
  }
}
// One forest tree of the species mix at (wx, d): returns a plan entry.
function forestTree(ctx, out, W, wx, d, rng, opts = {}) {
  const pm = pineMix(W, wx, d);
  const u = rng();
  const Hc = canopyH(W, wx, d) * (opts.hk || 1);
  const y = opts.y != null ? opts.y : surfY(W, wx, d) - 0.15;
  let fn, H, Wd;
  if (opts.birch != null && u < opts.birch) { fn = birch; H = Hc * (0.55 + 0.3 * rng()); Wd = H * 0.45; }
  else if (u < (opts.birch || 0) + pm * 0.85) { fn = scotsPine; H = Hc * (0.95 + 0.25 * rng()); Wd = H * 0.4; }
  else { fn = spruce; H = Hc * (0.8 + 0.35 * rng()); Wd = H * (0.24 + 0.08 * rng()); }
  if (opts.young) H *= opts.young;
  const nMax = Math.round(coniferSplats(out, d, H, Wd) * (opts.detail || 1));
  return { fn, x: wx - ctx.x0, d, w: (H * Wd) / (d * d), nMax: Math.max(1, nMax), opts: { rng, height: H, width: Wd, y, kind: opts.kind, open: !!opts.young } };
}

// The forest seen from outside: trees on a world grid; those at an edge facing the camera are
// planned at full detail, the row behind at reduced detail, and a few inside as cheap spires that
// break the canopy line. The fill's forest mass does the rest.
function forestPlan(ctx, out, W, plan, dLo, dHi, sp, opts = {}) {
  const g0 = Math.floor((ctx.x0 - 8) / sp), g1 = Math.floor((ctx.x0 + ctx.length + 8) / sp);
  const k0 = Math.floor(dLo / sp), k1 = Math.floor(dHi / sp);
  for (let gk = k0; gk <= k1; gk++) {
    for (let gx = g0; gx <= g1; gx++) {
      const r = worldRng(ctx, 501, gx, gk);
      const wx = (gx + r()) * sp, d = (gk + r()) * sp;
      if (d < dLo || d >= dHi) continue;
      const s = surface(W, wx, d);
      if (s.t !== T.FOREST) {
        // scattered trees out in the open: young ones in clearings, stunted pines on the bog
        if ((s.t === T.OPEN || s.t === T.BOG || s.t === T.CLEARCUT) && r() < (s.t === T.BOG ? 0.03 : 0.01 + 0.12 * smooth(0.4, 0.5, s.f))) {
          const t = forestTree(ctx, out, W, wx, d, r, { birch: 0.4, young: s.t === T.BOG ? 0.35 : 0.3 + 0.5 * r(), y: s.y - 0.1, detail: opts.detail });
          plan.push(t);
        }
        continue;
      }
      const y = s.y - 0.15;
      const front = !isForest(W, wx, d - sp * 1.2);
      if (front) {
        plan.push(forestTree(ctx, out, W, wx, d, r, { birch: 0.18 * (1 - pineMix(W, wx, d)), y, detail: opts.detail }));
        // undergrowth along the edge: young spruce and birch, so the foot of the wall is ragged
        if (r() < (opts.under != null ? opts.under : 0.6)) plan.push(forestTree(ctx, out, W, wx + (r() - 0.5) * sp, d - sp * (0.3 + 0.4 * r()), r, { birch: 0.3, young: 0.12 + 0.25 * r(), y, detail: opts.detail }));
        continue;
      }
      const front2 = !isForest(W, wx, d - sp * 2.6) || !isForest(W, wx - sp * 1.5, d) || !isForest(W, wx + sp * 1.5, d);
      if (front2) { plan.push(forestTree(ctx, out, W, wx, d, r, { y, detail: 0.35 * (opts.detail || 1) })); continue; }
      if (r() < (opts.inner != null ? opts.inner : 0.12)) {
        const t = forestTree(ctx, out, W, wx, d, r, { y, hk: 1.1 });
        t.nMax = Math.min(t.nMax, 3);
        plan.push(t);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Railway and ground props
// ---------------------------------------------------------------------------------------------

// Rock cuttings: stretches where grey rock rises beside the line. Kept below 1.6 m within 6 m of
// the track (the checker's rule), then steep up to the cutting's height, with ledges, strata,
// cracks and moss. One per 420 m world cell at most.
const RCELL = 420;
function cutting(W, i) {
  const key = 'c' + i;
  if (W.sites.has(key)) return W.sites.get(key);
  const c = makeCutting(W, i);
  W.sites.set(key, c);
  return c;
}
function makeCutting(W, i) {
  const r = makeRng(hashInts(W.ws, 601, i));
  if (r() > 0.32) return null;
  const len = 70 + 170 * r();
  const x0 = (i + 0.05) * RCELL + r() * (RCELL - len - 40);
  return { x0, x1: x0 + len, h: 3.5 + 4.5 * r(), seed: hashInts(W.ws, 602, i) };
}
function cuttingAt(W, wx) {
  const c = cutting(W, Math.floor(wx / RCELL));
  return c && wx > c.x0 - 10 && wx < c.x1 + 10 ? c : null;
}
// Height of the cutting's face top at world x (0 outside), tapering at the ends.
function cutH(W, c, wx) {
  const e = Math.min(wx - c.x0, c.x1 - wx);
  if (e <= 0) return 0;
  return c.h * smooth(0, 25, e) * (0.75 + 0.45 * noise1(wx / 13, c.seed & 0xffff));
}
// The face profile: height above rail at distance d for a face of top height h.
function faceY(h, d) {
  if (d < 5.4) return -0.6;
  if (d < 6) return lerp(-0.6, 1.45, (d - 5.4) / 0.6);
  return Math.min(h, 1.45 + (d - 6) * 3.2);
}
function* rockCutting(ctx, out, W, c, plan) {
  const rng = makeRng(c.seed ^ (ctx.index * 7919));
  // splat spacing from the budget, coarser if this chunk's stretch of face would take more than
  // about a third of the band's splats
  let area = 0;
  for (let x = 0.5; x < ctx.length; x += 1) { const h = cutH(W, c, ctx.x0 + x); if (h > 0.3) area += h + 1.5; }
  const k = Math.max(1 / Math.sqrt(Math.min(1.5, out.density)), Math.sqrt(area / (0.2 * 0.22 * ctx.count * 0.33)));
  const step = 0.2 * k, vstep = 0.22 * k;
  const salt = c.seed & 0xffff;
  for (let x = step / 2; x < ctx.length; x += step) {
    const wx = ctx.x0 + x, h = cutH(W, c, wx);
    if (h <= 0.3) continue;
    const dTop = 6 + (h - 1.45) / 3.2;
    const nv = Math.max(2, Math.round((h + 1.5) / vstep));
    for (let j = 0; j < nv; j++) {
      const v = (j + rng()) / nv;
      let y = lerp(-0.6, h, v);
      let d = y < 1.45 ? 5.4 + (y + 0.6) / 2.05 * 0.6 : 6 + (y - 1.45) / 3.2;
      const xx = x + (rng() - 0.5) * step;
      const wxx = ctx.x0 + xx;
      // jointed rock: irregular blocks (bedding planes across, joints up and down), each block
      // its own shade and set a little forward or back, dark cracks along the joints
      const by = y / 1.1 + 0.7 * noise1(wxx / 6, salt);
      const bx = wxx / 3.2 + 0.6 * noise1(y / 2, salt + 1) + 0.5 * Math.floor(by);
      const fy = by - Math.floor(by), fx = bx - Math.floor(bx);
      const bh = hashInts(salt, Math.floor(bx), Math.floor(by)) / 4294967296;
      const edge = Math.min(fy, 1 - fy, (Math.min(fx, 1 - fx)) * 1.3);
      d -= (bh - 0.5) * 0.35;
      let col = mix3(C.rock, C.rockDark, bh * 0.8);
      col = mix3(col, [0.46, 0.47, 0.44], smooth(0.75, 0.95, noise2(wxx / 2, y / 2, salt + 2)) * 0.5);  // pale lichen
      col = mix3(col, [0.1, 0.1, 0.1], smooth(0.07, 0.0, edge) * 0.6);                            // cracks
      col = mix3(col, [0.24, 0.3, 0.12], smooth(0.85, 0.97, fy) * smooth(1.5, 3, y) * 0.7 * (bh > 0.4 ? 1 : 0)); // moss on ledges
      col = mix3(col, [0.14, 0.14, 0.13], smooth(0.6, 0.8, noise2(wxx / 2.5, y / 9, salt + 3)) * 0.5);        // wet streaks
      const ny = fy > 0.85 ? 0.8 : 0.3, nz = 0.95;
      col = jitter(shade(col, -0.3 + 0.6 * bh, ny, nz, 0.62, 0.42), rng, 0.08);
      if (d < 6 && y > 1.5) y = 1.5;
      const q = quatUpTo(...norm3(0, ny * 0.5, nz));
      out.q(xx, y, -d, step * 0.75, vstep * 0.2, vstep * 0.7, col, 1, q, KIND.ROCK);
      if (out.due()) yield;
    }
    // heather and moss along the top edge
    if (rng() < 0.8) {
      const col = jitter(rng() < 0.5 ? C.heather : C.bilberry, rng, 0.15);
      out(x, h + 0.2, -(dTop + 0.3 + rng()), step * 1.6, 0.3, 0.6, col[0], col[1], col[2], 1, 0, 0, 0, 1, KIND.HEDGE);
    }
  }
  // young spruce and birch along the rim
  if (plan) {
    for (const { i, wx0 } of cellsAround(ctx, 3, 3)) {
      const r = worldRng(ctx, 603, i);
      const h = cutH(W, c, wx0);
      if (h < 1.5 || r() > 0.55) continue;
      const d = 6 + (h - 1.45) / 3.2 + 1 + 6 * r();
      const H = 2 + 7 * r(), isB = r() < 0.35;
      const Wd = H * (isB ? 0.45 : 0.3);
      plan.push({ fn: isB ? birch : spruce, x: wx0 - ctx.x0, d, w: (H * Wd) / (d * d), nMax: coniferSplats(out, d, H, Wd), opts: { rng: r, height: H, width: Wd, y: h - 0.2 } });
    }
  }
}

// The snow fence: horizontal grey timber boards with gaps on posts, a long screen set back from
// the line (continuous lines survive the motion blur; slats would not).
function* snowFence(ctx, out, W, d) {
  const step = 0.4, P = 3.6;
  for (let x = step / 2; x < ctx.length; x += step) {
    const wx = ctx.x0 + x;
    if (noise1(wx / 140, W.ws + 611) < 0.3 || cuttingAt(W, wx)) continue;    // gaps
    const y0 = ctx.terrain.height(wx, d);
    const k = 0.8 + 0.3 * worldHash(ctx, 612, Math.floor(wx / P));            // boards weather panel by panel
    for (let b = 0; b < 5; b++) {
      const c = mul3([0.32, 0.3, 0.27], k * (0.9 + 0.04 * b));
      out(x, y0 + 0.55 + b * 0.36, -d, step * 0.7, 0.09, 0.03, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.FENCE);
    }
    if (Math.abs(wx / P - Math.round(wx / P)) * P < step / 2) {
      out(x, y0 + 1.1, -(d + 0.1), 0.08, 1.15, 0.08, 0.18, 0.16, 0.13, 1, 0, 0, 0, 1, KIND.FENCE);
      const qs = quatXTo(0, 0.8, -0.6);       // the slanted strut behind each post
      out(x, y0 + 0.9, -(d + 0.9), 0.95, 0.05, 0.05, 0.18, 0.16, 0.13, 1, qs[0], qs[1], qs[2], qs[3], KIND.FENCE);
    }
    if (out.due()) yield;
  }
}

// Log stacks by a siding: a second track and long piles of logs with their pale cut ends facing
// the line. At most one per 1400 m world cell.
const LCELL = 1400;
function siding(W, i) {
  const key = 's' + i;
  if (W.sites.has(key)) return W.sites.get(key);
  const sd = makeSiding(W, i);
  W.sites.set(key, sd);
  return sd;
}
function makeSiding(W, i) {
  const r = makeRng(hashInts(W.ws, 621, i));
  if (r() > 0.42) return null;
  const x0 = (i + 0.1 + 0.4 * r()) * LCELL;
  return { x0, x1: x0 + 220 + 160 * r(), seed: hashInts(W.ws, 622, i) };
}
function sidingAt(W, wx) {
  const s = siding(W, Math.floor(wx / LCELL));
  return s && wx > s.x0 - 30 && wx < s.x1 + 30 ? s : null;
}
function* sidingProps(ctx, out, W, sd) {
  const rng = makeRng(sd.seed ^ ctx.index);
  // the siding's ballast, sleepers and rails at d 6.4..8.2 (rails 1.435 m apart)
  const step = 0.3;
  for (let x = step / 2; x < ctx.length; x += step) {
    const wx = ctx.x0 + x;
    if (wx < sd.x0 - 30 || wx > sd.x1 + 30) continue;
    const y = ctx.terrain.height(wx, 7.3) + 0.15;
    for (let k = 0; k < 3; k++) { const c = jitter(PAL.ballast, rng, 0.2); out(x, y, -(6.5 + 1.6 * rng()), step, 0.06, 0.5, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND); }
    if (Math.floor(wx / 0.65) !== Math.floor((wx - step) / 0.65)) out(x, y + 0.1, -7.3, 0.12, 0.05, 1.25, 0.22, 0.18, 0.15, 1, 0, 0, 0, 1, KIND.OTHER);
    for (const rd of [6.6, 8.0]) out(x, y + 0.2, -rd, step * 0.7, 0.04, 0.035, 0.38, 0.3, 0.24, 1, 0, 0, 0, 1, KIND.OTHER);
    if (out.due()) yield;
  }
  // log piles: several stacks with gaps, ends facing the camera
  const r2 = makeRng(sd.seed);
  let wx = sd.x0 + 10;
  while (wx < sd.x1 - 10) {
    const len = 12 + 30 * r2(), hgt = 1.8 + 1.6 * r2(), dd = 10 + 2.5 * r2();
    const birchy = r2() < 0.3;
    // the logs: rows packed like a honeycomb, each end a pale disc inside a dark bark ring, on a
    // dark backing (the shadow between the logs)
    let row = 0;
    for (let y = 0.16; y < hgt; y += 0.27, row++) {
      for (let px = wx + (row % 2) * 0.16; px < wx + len; px += 0.32) {
        const x = px - ctx.x0;
        if (x < -1 || x > ctx.length + 1) continue;
        const e = Math.min(px - wx, wx + len - px);
        if (y > hgt * smooth(0, 1.5, e) + 0.1) continue;
        const y0 = ctx.terrain.height(px, dd);
        const rr = 0.11 + 0.06 * rng();
        const end = birchy ? [0.7, 0.62, 0.46] : [0.66, 0.52, 0.33];
        const c = jitter(mul3(end, 0.8 + 0.2 * (y / hgt)), rng, 0.12);
        const jx = (rng() - 0.5) * 0.05, jy = (rng() - 0.5) * 0.05;
        if (out.density < 0.5) { out(x + jx, y0 + y + jy, -dd, rr * 0.9, rr * 0.9, 0.04, c[0] * 0.85, c[1] * 0.85, c[2] * 0.85, 1, 0, 0, 0, 1, KIND.OTHER); continue; }
        out(x + jx, y0 + y + jy, -(dd + 0.04), rr * 1.05, rr * 1.05, 0.04, 0.24, 0.16, 0.1, 1, 0, 0, 0, 1, KIND.OTHER);
        out(x + jx, y0 + y + jy, -dd, rr * 0.62, rr * 0.62, 0.03, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
        if (row % 2 === 0) out(x + 0.16, y0 + y + 0.13, -(dd + 0.3), 0.17, 0.15, 0.05, 0.08, 0.065, 0.05, 1, 0, 0, 0, 1, KIND.OTHER);
      }
      if (out.due()) yield;
    }
    wx += len + 6 + 20 * r2();
  }
}

// A boulder: grey, lichen-spotted, half sunk in the ground. Stands on surface().
function* boulder(ctx, out, W, wx, d, r, rng) {
  const y = surfY(W, wx, d) + r * 0.2;
  const n = Math.max(3, Math.round(coniferSplats(out, d, r * 1.4, r * 2) * 0.5));
  const col = mix3(C.rock, [0.5, 0.52, 0.45], 0.3 * rng());
  yield* blob(ctx, out, wx - ctx.x0, y, d, r, r * 0.65, r * 0.85, { n, color: col, rng, kind: KIND.ROCK, inner: 0.3, amb: 0.55, clump: 0.3 });
}

// A cabin: red (falu) or dark timber, white trims, on a stone footing; maybe a jetty out over the
// water and a lit window at night. `wrong` > 0 for the repeating (logic) copy.
const CABIN_WALLS = [[0.45, 0.12, 0.08], [0.5, 0.15, 0.09], [0.4, 0.11, 0.08], [0.2, 0.15, 0.11], [0.52, 0.42, 0.22]];
function* cabin(ctx, out, W, wx, d, rng, opts = {}) {
  const wall = opts.wall || CABIN_WALLS[Math.floor(rng() * CABIN_WALLS.length)];
  const roof = opts.roof || (rng() < 0.6 ? [0.16, 0.15, 0.14] : [0.32, 0.2, 0.15]);
  const w = (6 + 4 * rng()) * (opts.scale || 1), dep = 5 + 2 * rng(), h = 3.2 + 0.8 * rng();
  const yaw = opts.yaw != null ? opts.yaw : (rng() - 0.5) * 0.3;
  const x = wx - ctx.x0;
  const y = (opts.y != null ? opts.y : surfY(W, wx, d)) - 0.3;
  yield* house(ctx, out, x, d, { w, depth: dep, h, roofH: dep * 0.42, wall, roof, yaw, rng, y, windowColor: [0.1, 0.11, 0.12], kind: opts.kind });
  // white corner boards and window frames read from afar on a red house
  const trim = [0.74, 0.73, 0.68];
  const [ex, ez] = [Math.cos(yaw), -Math.sin(yaw)];
  for (const sg of [-1, 1]) for (let t = 0.3; t < h; t += 0.4) out(x + ex * sg * w / 2, y + 0.4 + t, -(d - dep / 2 - 0.05) + ez * sg * w / 2, 0.09, 0.22, 0.05, trim[0], trim[1], trim[2], 1, 0, 0, 0, 1, opts.kind != null ? opts.kind : KIND.BUILDING);
  // a lit window at night
  const hour = ctx.hour;
  if (hour != null && (hour < 6.5 || hour > 19) && (opts.lit || rng() < 0.6)) {
    yield* lamp(ctx, out, x + ex * w * 0.2, y + 0.4 + h * 0.5, d - dep / 2 - 0.1, [1, 0.78, 0.45], { size: 0.35, halo: 0.6 });
  }
}
function* jetty(ctx, out, wx, d0, d1, y, rng) {
  const x = wx - ctx.x0;
  for (let d = d0; d > d1; d -= 0.5) {
    const c = jitter([0.36, 0.3, 0.23], rng, 0.1);
    out(x, y + 0.5, -d, 0.75, 0.06, 0.28, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
    if (Math.round(d * 2) % 4 === 0) for (const sx of [-0.7, 0.7]) out(x + sx, y + 0.1, -d, 0.06, 0.45, 0.06, 0.15, 0.12, 0.1, 1, 0, 0, 0, 1, KIND.OTHER);
  }
  if (out.due()) yield;
}
// Where the far shore of a lake is along world x: walk away from the camera until the terrain
// rises above the water.
function farShore(W, lk, wx) {
  for (let d = lk.dc; d < lk.dc + lk.rd * 1.5; d += 2) if (W.H(wx, d) > lk.level + 0.2) return d;
  return null;
}
function nearShore(W, lk, wx) {
  for (let d = lk.dc; d > lk.dc - lk.rd * 1.5; d -= 2) if (W.H(wx, d) > lk.level + 0.2 || lakeR(lk, wx, d) > 1) return d;
  return null;
}

// Lake furniture in a band: reeds along the shallows, a cabin with a jetty on the far shore.
function* lakeProps(ctx, out, W, dLo, dHi) {
  const seen = new Set();
  for (let x = -60; x < ctx.length + 60; x += 40) for (const lk of lakesNear(W, ctx.x0 + x)) seen.add(lk);
  for (const lk of seen) {
    if (lk.dc + lk.rd < dLo || lk.dc - lk.rd > dHi) continue;
    const rng = makeRng(hashInts(W.ws, 631, lk.f, lk.i, ctx.index));
    // reeds: in the shallows near either shore, in patches along world x
    if (lk.dc < 700) {
      const step = 0.5 + lk.dc * 0.004;
      for (let x = step / 2; x < ctx.length; x += step) {
        const wx = ctx.x0 + x;
        if (Math.abs(wx - lk.cx) > lk.rx * 1.3) continue;
        if (noise1(wx / 25, lk.salt + 3) < 0.45) continue;
        for (const side of [0, 1]) {
          const sd = side ? farShore(W, lk, wx) : nearShore(W, lk, wx);
          if (sd == null || sd < dLo || sd >= dHi || waterAt(W, wx, sd + (side ? -3 : 3)) !== lk) continue;
          const m = side ? 3 : 4;
          for (let k = 0; k < m; k++) {
            const dd = sd + (side ? -1 : 1) * (0.5 + 4 * rng());
            const hh = 1 + 0.8 * rng();
            const c = jitter(rng() < 0.45 ? [0.42, 0.41, 0.24] : [0.26, 0.32, 0.14], rng, 0.15);
            out(x + (rng() - 0.5) * step, lk.level + hh * 0.5, -dd, Math.max(0.05, step * 0.35), hh * 0.5, 0.06, c[0], c[1], c[2], 0.95, 0, 0, 0, 1, KIND.HEDGE);
          }
          if (out.due()) yield;
        }
      }
    }
    // a cabin on the far shore, facing across the water, with a jetty
    if (lk.cabin < 0.55 && lk.dc < 600) {
      const wx = lk.cx + (lk.cabinU - 0.5) * lk.rx * 0.9;
      const sd = farShore(W, lk, wx);
      if (sd != null) {
        const cd = sd + 7;
        const cr = makeRng(hashInts(W.ws, 632, lk.f, lk.i));
        if (cd >= dLo && cd < dHi) {
          yield* cabin(ctx, out, W, wx, cd, cr, {});
          yield* jetty(ctx, out, wx + 3, sd + 1, sd - 12, lk.level, cr);
          yield* birch(ctx, out, wx - ctx.x0 - 7, cd + 2, { rng: cr, height: 11, y: surfY(W, wx - 7, cd + 2) });
        }
      }
    }
  }
}

// Transmission line: lattice pylons along the corridor and three conductors between them.
function* powerLines(ctx, out, W, dLo, dHi) {
  const SP = 320;
  for (const L of linesNear(W, ctx.x0 + ctx.length / 2, dHi)) {
    const P = [];
    for (let k = 0; k * SP < dHi + SP; k++) {
      const d = 60 + k * SP;
      const wx = L.wx0 + L.slope * d;
      P.push({ wx, d, y: ctx.terrain.height(wx, d) });
    }
    for (let k = 0; k < P.length; k++) {
      const p = P[k];
      if (p.d >= dLo && p.d < dHi) yield* pylon(ctx, out, p.wx - ctx.x0, p.d, p.y);
      if (k + 1 >= P.length) break;
      const p2 = P[k + 1];
      if (p2.d < dLo || p.d >= dHi) continue;
      // conductors: catenary between the cross-arm tips, drawn where they fall in this band
      for (const off of [-6, 0, 6]) {
        const ya = p.y + 26 + (off === 0 ? 4 : 0), yb = p2.y + 26 + (off === 0 ? 4 : 0);
        const len = Math.hypot(p2.wx - p.wx, p2.d - p.d);
        const steps = Math.ceil(len / Math.max(1, 0.004 * p.d));
        const r = Math.max(0.03, 0.00055 * p.d);   // thin at any distance: a conductor is a line, not a ribbon
        for (let s = 0; s < steps; s++) {
          const t = (s + 0.5) / steps;
          const d = lerp(p.d, p2.d, t);
          if (d < dLo || d >= dHi) continue;
          const wx = lerp(p.wx, p2.wx, t) + off;
          const x = wx - ctx.x0;
          if (x < 0 || x >= ctx.length) continue;
          const y = lerp(ya, yb, t) - 9 * 4 * t * (1 - t);
          const sl = len / steps * 0.6;
          const q = quatXTo(...norm3(p2.wx - p.wx, 0, -(p2.d - p.d)));
          out(x, y, -d, sl, r, r, 0.2, 0.2, 0.2, 0.9, q[0], q[1], q[2], q[3], KIND.WIRE);
          if (out.due()) yield;
        }
      }
    }
  }
}
// A lattice suspension tower, 30 m: four legs tapering from a 6 m square base to a narrow waist and
// on to the peak, cross-braced on every face, with one cross-arm carrying the outer conductors on
// insulator strings. Every member is a thin splat lying along the member (never a round blob, never
// a translucent panel), and its thickness follows distance at well under a pixel a metre, so the
// tower stays a drawing of a tower: a soft grey shape is what it must not become. Far towers drop
// the bracing they could not resolve anyway.
const PYLON_LEVELS = [0, 5.5, 10.2, 14.2, 17.5, 20, 23, 26, 28.2, 30];
const pylonHalf = (y) => (y < 20 ? 3 - 2.3 * (y / 20) : 0.7 - 0.38 * ((y - 20) / 10));
function* pylon(ctx, out, x, d, y0) {
  const steel = [0.44, 0.45, 0.45];
  const r = Math.max(0.065, 0.00045 * d), rb = r * 0.62;
  const lod = d < 220 ? 2 : d < 1100 ? 1 : 0;
  const tone = (k) => [steel[0] * k, steel[1] * k, steel[2] * k];
  const corners = [[-1, -1, 1.1], [1, -1, 0.92], [1, 1, 0.78], [-1, 1, 0.9]];   // sx, sz (-1 = towards the track), light
  const at = (c, y) => [x + c[0] * pylonHalf(y), y0 + y, -(d + c[1] * pylonHalf(y))];
  for (const c of corners) {
    strut(out, ...at(c, -0.3), ...at(c, 20), r, tone(c[2]), lod === 2 ? 10 : 4);
    strut(out, ...at(c, 20), ...at(c, 30), r * 0.85, tone(c[2]), lod === 2 ? 5 : 2);
  }
  if (lod > 0) {
    // faces: 0 is the one towards the track, then round the tower; the far ones only when close
    const faces = lod === 2 ? [0, 1, 2, 3] : [0];
    for (const f of faces) {
      const a = corners[f], b = corners[(f + 1) % 4], k = f === 0 ? 1 : f === 2 ? 0.7 : 0.85;
      const c = tone(k * 0.95);
      for (let i = 0; i + 1 < PYLON_LEVELS.length; i++) {
        const ya = PYLON_LEVELS[i], yb = PYLON_LEVELS[i + 1];
        if (lod === 2 && i > 0) strut(out, ...at(a, ya), ...at(b, ya), rb, c, 2);
        if (lod === 2 && ya < 20) {
          strut(out, ...at(a, ya), ...at(b, yb), rb, c, 3);
          strut(out, ...at(b, ya), ...at(a, yb), rb, c, 3);
        } else if (i % 2 === 0) strut(out, ...at(a, ya), ...at(b, yb), rb, c, 2);
        else strut(out, ...at(b, ya), ...at(a, yb), rb, c, 2);
      }
    }
    if (out.due()) yield;
  }
  // cross-arm: a level bottom chord through the tower, a top chord from the peak to each tip
  const armY = y0 + 27.4, z = -d, n = lod === 2 ? 6 : 3;
  strut(out, x - 7.2, armY, z, x + 7.2, armY, z, r * 0.85, tone(0.95), n * 2);
  for (const sx of [-1, 1]) {
    strut(out, x + sx * 0.4, y0 + 29.6, z, x + sx * 7.2, armY, z, rb, tone(sx < 0 ? 1.05 : 0.85), n);
    if (lod === 2) strut(out, x + sx * 3.6, armY, z, x + sx * 3.6, y0 + 28.5, z, rb, tone(0.9), 2);
    // the insulator string the conductor hangs from
    if (lod > 0) strut(out, x + sx * 6, armY, z, x + sx * 6, y0 + 26, z, r * 1.25, [0.2, 0.25, 0.24], 2);
  }
  if (out.due()) yield;
}

// Mist: big, faint, pale splats lying low in hollows and over water, in stretches that come and go
// with a slow world noise. Never a uniform veil.
function* mist(ctx, out, W, dLo, dHi, cell, size) {
  const g0 = Math.floor((ctx.x0 - size) / cell), g1 = Math.floor((ctx.x0 + ctx.length + size) / cell);
  for (let gk = Math.floor(dLo / cell); gk * cell < dHi; gk++) {
    for (let gx = g0; gx <= g1; gx++) {
      const r = worldRng(ctx, 641, gx, gk, cell);
      const wx = (gx + r()) * cell, d = (gk + r()) * cell;
      if (d < dLo || d >= dHi) continue;
      const amt = smooth(0.5, 0.75, noise1(wx / 2600, W.ws + 642)) * (0.4 + 0.6 * noise2(wx / 900, d / 900, W.ws + 643));
      if (amt < 0.15) continue;
      const s = surface(W, wx, d);
      // hollows: lower than the ground round about
      const around = (W.H(wx - 3 * size, d) + W.H(wx + 3 * size, d) + W.H(wx, d + 3 * size)) / 3;
      const hollow = s.t === T.WATER ? 1 : s.t === T.BOG ? 0.7 : smooth(0, size * 0.15, around - s.h);
      if (hollow * amt < 0.25 || r() > hollow * amt * 1.5) continue;
      const sx = size * (0.8 + 0.8 * r()), sy = size * (0.1 + 0.06 * r());
      const c = jitter(C.mist, r, 0.03);
      out(wx - ctx.x0, s.y + sy * 0.9, -d, sx, sy, sx * 0.5, c[0], c[1], c[2], (0.08 + 0.1 * r()) * Math.min(1, hollow * amt * 1.6), 0, 0, 0, 1, KIND.OTHER);
      if (out.due()) yield;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------------------------
function* trackside(ctx, emit) {
  const out = makeOut(ctx, emit, { zMargin: 1 });
  const W = world(ctx);
  const N = ctx.count;
  out.limit = N * 0.62;
  const plan = [];

  // overhead line: masts every beat of world x, the field-side wires swooping between them
  yield* overheadLine(ctx, out, ctx.beatMetres || 56, { d: 3.6 });

  // rock cuttings
  const cuts = new Set();
  for (let x = 0; x <= ctx.length; x += 20) { const c = cuttingAt(W, ctx.x0 + x); if (c) cuts.add(c); }
  for (const c of cuts) yield* rockCutting(ctx, out, W, c, plan);
  const inCut = (wx) => { const c = cuttingAt(W, wx); return c && cutH(W, c, wx) > 0.5; };

  // a siding with log stacks
  const sds = new Set();
  for (let x = 0; x <= ctx.length; x += 20) { const s = sidingAt(W, ctx.x0 + x); if (s) sds.add(s); }
  for (const s of sds) yield* sidingProps(ctx, out, W, s);
  const inSiding = (wx) => !!sidingAt(W, wx);

  // the railway boundary: a post-and-wire fence in stretches, a snow fence further out in others
  if (noise1(ctx.x0 / 3000, W.ws + 651) > 0.4) yield* fence(ctx, out, 7.4, { spacing: 3, height: 1.1, strands: 3, postColor: [0.28, 0.24, 0.2] });
  if (noise1(ctx.x0 / 1700, W.ws + 652) > 0.7) yield* snowFence(ctx, out, W, 15);

  // saplings and young trees close to the line: birch and spruce in dense stretches (they streak)
  const sp = 2.2;
  for (const { i, wx0 } of cellsAround(ctx, sp, 3)) {
    const dense = smooth(0.35, 0.7, noise1(wx0 / 320, W.ws + 653));
    const r = worldRng(ctx, 654, i);
    for (let k = 0; k < 3; k++) {
      if (r() > 0.08 + 0.7 * dense) continue;
      const wx = wx0 + r() * sp, d = 6.4 + Math.pow(r(), 1.4) * 15;
      if (inCut(wx) || (inSiding(wx) && d < 15)) continue;
      const s = surface(W, wx, d);
      if (s.t === T.WATER || s.t === T.FOREST || s.t === T.RIPRAP) continue;
      // thickest beside the forest; few out on the bog and the open heath
      if (r() > (s.t === T.BOG ? 0.12 : s.t === T.OPEN ? 0.25 + 0.75 * smooth(0.3, 0.48, s.f) : 1)) continue;
      const H = 1 + Math.min(4.5, (d - 5) * 0.3 * (0.3 + r()));
      const isB = r() < 0.35;
      const Wd = isB ? H * 0.5 : H * 0.36;
      plan.push({ fn: isB ? birch : spruce, x: wx - ctx.x0, d, w: (H * Wd) / (d * d), nMax: coniferSplats(out, d, H, Wd), opts: { rng: r, height: H, width: Wd, y: s.y - 0.1 } });
    }
  }
  // boulders
  for (const { i, wx0 } of cellsAround(ctx, 23, 3)) {
    const r = worldRng(ctx, 655, i);
    if (r() > 0.25) continue;
    const wx = wx0 + r() * 23, d = 8 + r() * 20;
    if (inCut(wx) || inSiding(wx)) continue;
    const s = surface(W, wx, d);
    if (s.t === T.WATER) continue;
    yield* boulder(ctx, out, W, wx, d, 0.4 + 1.2 * r() * r(), r);
  }
  // the forest edge where the forest comes close
  forestPlan(ctx, out, W, plan, 12, ctx.zFar, 4.2, { inner: 0.2, under: 0.25 });
  yield* drawPlan(ctx, out, plan, Math.max(0, out.limit - out.n));

  // ground: ballast, cess, a dark ditch, then the cover (heather, bilberry, grass) and the surface
  out.limit = Infinity;
  const rest = out.left();
  yield* fillGround2(ctx, out, W, Math.round(rest * 0.05), 2.5, 3.6, (wx, d, rng) => jitter(PAL.ballast, rng, 0.28), 0);
  yield* fillGround2(ctx, out, W, Math.round(rest * 0.035), 3.6, 4.5, (wx, d, rng) => jitter([0.3, 0.28, 0.23], rng, 0.2), 0);
  yield* fillGround2(ctx, out, W, Math.round(rest * 0.045), 4.5, 5.6, (wx, d, rng) => {
    const wet = noise2(wx / 4, d * 2, W.ws + 656) > 0.62;
    return wet ? jitter([0.3, 0.33, 0.36], rng, 0.1) : jitter([0.1, 0.1, 0.07], rng, 0.2);
  }, -0.35);
  yield* fillGround2(ctx, out, W, Math.round(rest * 0.1), 5.6, 8, (wx, d, rng) => {
    const a = noise2(wx / 3, d / 2, W.ws + 657);
    return jitter(a < 0.35 ? C.heather : a < 0.7 ? C.bilberry : [0.24, 0.36, 0.12], rng, 0.18);
  }, 0.15, 0.5);
  yield* fillSurface(ctx, out, W, { dNear: 7.5, power: 1.3, cover: 4.5, mass: false, tuft: 30 });
}

// Simple dense ground strip for the trackside layers. lift raises it (tufts), round makes the
// splats thicker so ground cover reads as a texture rather than a floor.
function* fillGround2(ctx, out, W, n, dn, df, color, lift = 0, round = 0.12) {
  const rng = ctx.rng;
  const area = ctx.length * (df - dn);
  const r = Math.sqrt((4 * area) / (Math.PI * Math.max(1, n)));
  for (let i = 0; i < n; i++) {
    const x = rng() * ctx.length, d = dn + rng() * (df - dn);
    const c = color(ctx.x0 + x, d, rng);
    const s = d > 5.5 ? surface(W, ctx.x0 + x, d) : null;
    const y = s ? s.y : ctx.terrain.height(ctx.x0 + x, d);
    out(x, y + lift * rng() + 0.02, -d, r * (0.8 + 0.5 * rng()), r * round, r * 0.6, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
}

function* near(ctx, emit) {
  const out = makeOut(ctx, emit, { detailK: 1.1 });
  const W = world(ctx);
  const dz = ctx.dials || {};
  out.limit = ctx.count * 0.62;
  yield* lakeProps(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* powerLines(ctx, out, W, ctx.zNear, ctx.zFar);
  // boulders in the open and at forest edges
  for (const { i, wx0 } of cellsAround(ctx, 40, 4)) {
    const r = worldRng(ctx, 661, i);
    for (let k = 0; k < 3; k++) {
      const wx = wx0 + r() * 40, d = 30 + r() * 200, rad = 0.6 + 2 * r() * r();
      if (r() > 0.35) continue;
      const s = surface(W, wx, d);
      if (s.t === T.WATER || s.t === T.ROAD || s.t === T.FOREST) continue;
      yield* boulder(ctx, out, W, wx, d, rad, r);
    }
  }
  yield* stumps(ctx, out, W, ctx.zNear, 160);
  if ((dz.logic || 0) > 0) yield* repeatingCabin(ctx, out, W, dz.logic);
  if ((dz.scale || 0) > 0) yield* giantSpruces(ctx, out, W, 80, ctx.zFar, 700, dz.scale);
  yield* mist(ctx, out, W, 40, ctx.zFar, 45, 30);
  const plan = [];
  forestPlan(ctx, out, W, plan, ctx.zNear, ctx.zFar, 5.5, { inner: 0.1 });
  yield* drawPlan(ctx, out, plan, Math.max(0, out.limit - out.n));
  yield* fillSurface(ctx, out, W, { power: 1.5, cover: 3.2, mass: true, massFrom: 5 });
}

// Stumps and slash in clearings and clear-cuts.
function* stumps(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, 9, 1)) {
    const r = worldRng(ctx, 671, i);
    for (let k = 0; k < 6; k++) {
      const wx = wx0 + r() * 9, d = dLo + r() * (dHi - dLo);
      const s = surface(W, wx, d);
      if (!(s.t === T.CLEARCUT || (s.t === T.OPEN && s.f > 0.3))) continue;
      if (r() > (s.t === T.CLEARCUT ? 0.9 : 0.3)) continue;
      const rad = 0.25 + 0.15 * r();
      out(wx - ctx.x0, s.y + 0.3, -d, rad, 0.3, rad, 0.3, 0.24, 0.17, 1, 0, 0, 0, 1, KIND.OTHER);
      out(wx - ctx.x0, s.y + 0.62, -d, rad * 0.9, 0.05, rad * 0.9, 0.62, 0.52, 0.36, 1, 0, 0, 0, 1, KIND.OTHER);
    }
    if (out.due()) yield;
  }
}

function* mid(ctx, emit) {
  const out = makeOut(ctx, emit, { detailK: 1.6 });
  const W = world(ctx);
  const dz = ctx.dials || {};
  out.limit = ctx.count * 0.4;
  yield* powerLines(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* settlements(ctx, out, W);
  yield* lakeProps(ctx, out, W, ctx.zNear, ctx.zFar);
  if ((dz.topology || 0) > 0) { yield* uprightLake(ctx, out, W, dz.topology); yield* forestIslands(ctx, out, W, 2600, 900, 2600, 120, 360, 50, 140, dz.topology, 1); }
  if ((dz.scale || 0) > 0) yield* giantSpruces(ctx, out, W, ctx.zNear, 2000, 1500, dz.scale);
  yield* mist(ctx, out, W, ctx.zNear, 1800, 180, 120);
  // the lit edge of the forest: cheap spires along edges that face the camera
  const plan = [];
  forestPlan(ctx, out, W, plan, ctx.zNear, 1100, 11, { inner: 0.0, detail: 0.6 });
  for (const t of plan) t.nMax = Math.min(t.nMax, 4);
  yield* drawPlan(ctx, out, plan, Math.max(0, out.limit - out.n));
  yield* fillSurface(ctx, out, W, {
    power: 1.2, cover: 3, maxR: 0.05, mass: true,
    // bare rock on the higher ground
    colorHook: (s, wx, d, c, isMass) => {
      if (isMass || s.t === T.WATER) return c;
      const hi = smooth(150, 260, s.h + 60 * noise2(wx / 300, d / 300, W.ws + 681));
      return hi > 0 ? mix3(c, C.rock, hi * 0.7) : c;
    },
  });
}

// A village round a white church, or a sawmill with its yards, in the mid distance.
function* settlements(ctx, out, W) {
  const i0 = Math.floor((ctx.x0 - 300) / SCELL), i1 = Math.floor((ctx.x0 + ctx.length + 300) / SCELL);
  for (let i = i0; i <= i1; i++) {
    const s = site(W, i);
    if (!s || s.dc < ctx.zNear || s.dc >= ctx.zFar) continue;
    const rng = makeRng(s.seed);
    if (s.mill) {
      // long sheds, a chimney and stacks of timber
      yield* house(ctx, out, s.cx - ctx.x0, s.dc, { w: 60, depth: 18, h: 9, roofH: 3, wall: [0.36, 0.35, 0.33], roof: [0.3, 0.3, 0.31], windows: false, chimney: false, rng, y: W.H(s.cx, s.dc) - 0.5 });
      yield* house(ctx, out, s.cx - ctx.x0 + 50, s.dc + 25, { w: 35, depth: 14, h: 7, roofH: 2.5, wall: [0.45, 0.14, 0.09], roof: [0.22, 0.22, 0.22], windows: false, chimney: false, rng, y: W.H(s.cx + 50, s.dc + 25) - 0.5 });
      yield* stick(ctx, out, s.cx - ctx.x0 - 20, W.H(s.cx - 20, s.dc + 10), s.dc + 10, 28, 1.2, { color: [0.4, 0.38, 0.36], kind: KIND.BUILDING });
      for (let k = 0; k < 6; k++) {
        const bx = s.cx - 60 + 120 * rng(), bd = s.dc - 30 - 20 * rng();
        yield* blob(ctx, out, bx - ctx.x0, W.H(bx, bd) + 1.5, bd, 9, 1.6, 4, { n: 20, color: [0.52, 0.42, 0.28], rng, kind: KIND.OTHER, inner: 0.2 });
      }
    } else {
      yield* church(ctx, out, s.cx - ctx.x0, s.dc + 10, { rng, color: [0.74, 0.73, 0.69], roof: [0.2, 0.2, 0.22], spire: 14, h: 15, y: W.H(s.cx, s.dc + 10) });
      for (let k = 0; k < 14; k++) {
        const hx = s.cx + (rng() - 0.5) * s.R * 2.4, hd = s.dc + (rng() - 0.6) * s.R * 1.2;
        if (Math.abs(hx - s.cx) < 25 && Math.abs(hd - s.dc - 10) < 15) continue;
        yield* cabin(ctx, out, W, hx, hd, rng, { scale: 1.3, y: W.H(hx, hd), lit: true });
      }
    }
  }
}

// Far: the mountains. Dark forest up to a tree line, then grey rock, then snow on the summits.
// The terrain's own relief is smooth at this scale, so the far band adds sculpted relief of its own
// (ridged noise: sharp ridges, deep gullies) above the forest, ramping in from zero at 3.6 km so it
// meets the mid band. Shading follows the sculpted surface.
function farRelief(W, wx, d, h, up) {
  const ramp = smooth(3500, 4800, d);
  if (ramp <= 0) return 0;
  const n1 = 1 - Math.abs(2 * fbm2(wx / 1700, d / 1400, W.ws + 691, 3) - 1);     // peaks and main ridges
  // spurs and gullies running down the faces toward the camera (long in d): they catch the sun on
  // their left flanks and shade on the right, which is what makes a face read as carved
  const n2 = 1 - Math.abs(2 * fbm2(wx / 520, d / 1700, W.ws + 692, 2) - 1);
  const n3 = noise2(wx / 170, d / 600, W.ws + 690);
  const alt = smooth(300, 1200, h);
  let e = (n1 * n1 * 300 + n2 * n2 * 200 + n3 * 50 - 200) * alt * ramp;
  // level 1 (scale): in some stretches the peaks keep going up, into needles far taller than any
  // real mountain
  if (up > 0) e += towerPart(W, wx, d, n1, alt, up);
  return e;
}
function towerPart(W, wx, d, n1, alt, up) {
  if (n1 == null) { n1 = 1 - Math.abs(2 * fbm2(wx / 1700, d / 1400, W.ws + 691, 3) - 1); alt = 1; }
  return up * 3800 * Math.pow(n1, 8) * smooth(0.62, 0.85, noise1(wx / 7000, W.ws + 689)) * smooth(5500, 9000, d) * alt;
}
function* far(ctx, emit) {
  const out = makeOut(ctx, emit);
  const W = world(ctx);
  const dz = ctx.dials || {};
  const up = dz.scale || 0;
  if ((dz.topology || 0) > 0) yield* forestIslands(ctx, out, W, 7000, 4000, 9000, 400, 1400, 200, 420, dz.topology, 3);
  out.limit = Infinity;
  const n = out.left();
  const rng = ctx.rng;
  const dn = ctx.zNear, df = ctx.zFar, L = ctx.length;
  const Z = Math.log(df / dn);
  const Hs = (wx, d) => { const h = W.H(wx, d); return h + farRelief(W, wx, d, h, up); };
  // Most of the far ground hides behind the mid band's ridges and forest. Find, along x, the
  // highest angle the mid band reaches (conservatively: the lowest such angle within 700 m either
  // way, since the camera looks along slanted lines), and spend the splats on what rises above it.
  const OX = 100, M = 800, occ = [];
  for (let wx = ctx.x0 - M; wx <= ctx.x0 + L + M; wx += OX) {
    let a = -1;
    for (const dd of [350, 500, 700, 1000, 1400, 1900, 2500, 3000]) a = Math.max(a, (W.H(wx, dd) + 15 - 2.6) / dd);
    occ.push(a);
  }
  const occMin = occ.map((_, k) => { let m = Infinity; for (let j = Math.max(0, k - 7); j <= Math.min(occ.length - 1, k + 7); j++) m = Math.min(m, occ[j]); return m; });
  const hidden = (x, d, y) => (y - 2.6) / d < occMin[Math.round((x + M) / OX)] - 0.006;
  // the visible share sets the splat size, so the visible faces stay covered
  let vis = 0;
  for (let k = 0; k < 300; k++) {
    const d = dn * Math.pow(df / dn, rng()), x = rng() * L, h = W.H(ctx.x0 + x, d);
    if (!hidden(x, d, h + farRelief(W, ctx.x0 + x, d, h, up))) vis++;
  }
  const fv = clamp(vis / 300, 0.15, 1);
  for (let i = 0; i < n; i++) {
    let d = 0, x = 0, wx = 0, h0 = 0, y = 0;
    for (let t = 0; t < 6; t++) {
      d = t === 0 ? dn * Math.pow(df / dn, (i + rng()) / n) : dn * Math.pow(df / dn, rng());
      x = rng() * L; wx = ctx.x0 + x;
      h0 = W.H(wx, d);
      y = h0 + farRelief(W, wx, d, h0, up);
      if (!hidden(x, d, y)) break;
    }
    const dens = (n / d / Z) / L / fv;
    let r = clamp(Math.sqrt(2.6 / (Math.PI * dens)), 0.0012 * d, 0.03 * d);
    if (up > 0 && y - h0 > 300) r = Math.min(0.05 * d, r * (1 + Math.min(2, towerPart(W, wx, d, null, 1, up) / 1200)));   // the towers' huge faces
    const e = Math.max(40, r);
    const hx = (Hs(wx + e, d) - y) / e, hd = (Hs(wx, d + e) - y) / e;
    const nn = norm3(-hx, 1, hd);
    const slope = 1 - nn[1];
    // zones by altitude, with a ragged tree line and snow lying longer in gullies and on gentle slopes
    const tl = 950 + 300 * noise2(wx / 2000, d / 2000, W.ws + 693) + 80 * (noise2(wx / 300, d / 300, W.ws + 694) - 0.5);
    const sl = 1750 + 350 * noise2(wx / 2500, d / 2500, W.ws + 695) + 250 * (noise2(wx / 250, d / 200, W.ws + 696) - 0.5);
    const gully = noise2(wx / 420, d / 300, W.ws + 692);
    let c;
    if (y < tl) {
      c = mix3([0.06, 0.1, 0.07], [0.1, 0.14, 0.09], noise2(wx / 600, d / 600, W.ws + 697));
      if (y < tl - 80 && bogVal(W, wx, d) > 0.8) c = [0.3, 0.3, 0.2];
    } else if (y < tl + 120) c = mix3([0.08, 0.12, 0.08], [0.3, 0.29, 0.22], (y - tl) / 120);
    else c = mix3([0.4, 0.39, 0.37], [0.27, 0.27, 0.28], noise2(wx / 200, d / 150, W.ws + 698));
    // gullies and ribs running down the faces (toward the camera): dark furrows, snow-filled higher up
    const fur = 1 - Math.abs(2 * fbm2(wx / 520, d / 1700, W.ws + 692, 2) - 1);
    const furrow = smooth(0.45, 0.2, fur) * (0.6 + 0.4 * noise2(wx / 90, d / 500, W.ws + 700));
    if (y > tl) c = mul3(c, 1 - 0.35 * furrow);
    const snowy = smooth(sl - 50, sl + 50, y + 150 * (0.5 - Math.abs(gully - 0.5)) + 520 * furrow - 220 * smooth(0.5, 0.8, fur) - 350 * Math.max(0, slope - 0.4));
    if (snowy > 0) c = mix3(c, C.snow, snowy);
    c = shade(c, nn[0], nn[1], nn[2], 0.3, 0.95);
    c = jitter(c, rng, 0.05);
    const q = quatUpTo(nn[0], nn[1], nn[2]);
    const ax = 0.8 + 0.5 * rng();
    out(x, y, -d, r * ax, r * 0.15, r * (1.8 - ax), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Level 1
// ---------------------------------------------------------------------------------------------

// Scale: spruces of impossible height standing among the ordinary ones.
function* giantSpruces(ctx, out, W, dLo, dHi, cell, amount) {
  for (const { i, wx0 } of cellsAround(ctx, cell, 60)) {
    const r = worldRng(ctx, 701, i, cell);
    if (r() > 0.55 * amount) continue;
    const wx = wx0 + r() * cell, d = dLo + r() * (dHi - dLo);
    const s = surface(W, wx, d);
    if (s.t === T.WATER) continue;
    const H = (d * 0.25 + 60) * (1 + 1.5 * r()) * amount;
    yield* spruce(ctx, out, wx - ctx.x0, d, { rng: r, height: H, width: H * 0.22, y: s.y - 1, n: Math.round(500 * Math.sqrt(out.density)), kind: KIND.SURREAL });
  }
}
// Topology: islands of forest floating over the land.
function* forestIslands(ctx, out, W, cell, dLo, dHi, hLo, hHi, rLo, rHi, amount, salt) {
  for (const { i, wx0 } of cellsAround(ctx, cell, rHi * 1.3)) {
    const r = worldRng(ctx, 711, salt, i);
    if (r() > 0.75 * amount) continue;
    const d = dLo + r() * (dHi - dLo), wx = wx0 + r() * cell;
    const rad = rLo + r() * (rHi - rLo);
    const y = W.H(wx, d) + hLo + r() * (hHi - hLo) * amount;
    const n = Math.round(380 * Math.sqrt(out.density));
    yield* floatingIsland(ctx, out, wx - ctx.x0, y, d, rad, { rng: r, n, trees: 0, top: [0.2, 0.28, 0.12], earth: [0.24, 0.2, 0.16], chalk: [0.42, 0.42, 0.4] });
    const nt = 5 + Math.floor(r() * 6);
    for (let t = 0; t < nt; t++) {
      const a = (t / nt) * Math.PI * 2 + r(), rr = Math.sqrt(r()) * rad * 0.75;
      const H = rad * (0.35 + 0.25 * r());
      yield* spruce(ctx, out, wx - ctx.x0 + Math.cos(a) * rr, d + Math.sin(a) * rr * 0.7, { rng: r, height: H, y: y - 0.1, n: Math.round(60 * Math.sqrt(out.density)), kind: KIND.SURREAL });
    }
  }
}
// Topology: a lake standing on its edge like a wall: water turned upright, sky in its upper part,
// the forest reflected along its foot, the wind lanes now vertical.
function* uprightLake(ctx, out, W, amount) {
  const cell = 3200;
  for (const { i, wx0 } of cellsAround(ctx, cell, 400)) {
    const r = worldRng(ctx, 721, i);
    if (r() > 0.6 * amount) continue;
    const wx = wx0 + r() * cell, d = 700 + r() * 1200;
    const w = 220 + 260 * r(), h = 120 + 140 * r() * amount;
    const base = W.H(wx, d) - 4;
    const n = Math.round(1600 * Math.sqrt(out.density));
    const s = Math.sqrt((w * h) / n) * 1.1;
    const salt = i & 0xffff;
    for (let k = 0; k < n; k++) {
      const u = r(), v = r();
      const xx = wx + (u - 0.5) * w * (1 - 0.15 * Math.pow(v, 2) * Math.abs(u - 0.5) * 4);
      const yy = base + v * h;
      const refl = smooth(0.32, 0.22, v + 0.05 * (noise1(xx / 9, salt) - 0.5));
      let c = mix3(C.waterDeep, C.waterSky, v);
      c = mix3(c, C.waterRefl, refl * 0.85);
      c = mix3(c, C.waterStreak, smooth(0.82, 0.92, noise2(xx / (1.5 + 0.012 * d), yy / 60, salt)) * 0.6);
      c = jitter(c, r, 0.03);
      out(xx - ctx.x0, yy, -d, s, s * 1.3, s * 0.08, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.SURREAL);
      if (out.due()) yield;
    }
  }
}
// Logic: the same red cabin by the line every 430 m in repeating stretches, each copy a little more
// wrong (roof drifting blue, turning, growing).
function* repeatingCabin(ctx, out, W, logic) {
  const P = 430;
  for (const { i, wx0 } of cellsAround(ctx, P, 20)) {
    if (noise1(wx0 / 4000, W.ws + 731) > 0.3 + logic) continue;
    const d = 58, wx = wx0 + P * 0.5;
    const s = surface(W, wx, d);
    if (s.t === T.WATER) continue;
    const wrong = (((i % 5) + 5) % 5) / 4;
    const rng = worldRng(ctx, 732);                    // the same design every time
    yield* cabin(ctx, out, W, wx, d, rng, { wall: CABIN_WALLS[0], roof: mix3([0.16, 0.15, 0.14], [0.15, 0.25, 0.45], wrong * logic * 2), yaw: wrong * 0.5 * logic, scale: 1 + 0.15 * wrong, kind: KIND.SURREAL, y: s.y });
    yield* birch(ctx, out, wx - ctx.x0 - 9, d + 3, { rng: worldRng(ctx, 733), height: 11 * (1 + wrong * logic), y: s.y, kind: KIND.SURREAL });
  }
}

export const pinewoodBiome = {
  name: 'pinewood',
  palette: PAL,
  // More relief than the default: rolling near ground with hollows that hold the lakes, forested
  // hill ridges in the mid band, and high mountains far off.
  terrain: TERRAIN,
  hazeDist: 7000,
  generators: { trackside, near, mid, far },
};

// for scripts that inspect the layout
export const _debug = { world, lakeIn, surface, LAKE_FAMS, TN: Object.keys(T) };
