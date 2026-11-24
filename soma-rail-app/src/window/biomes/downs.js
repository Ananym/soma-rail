// "Downs": rolling English farmland seen from a southern main line. Fields in greens and straw
// behind hedgerows with oaks, copses, farmsteads and the odd village with a church tower, a lane or
// two, and the railway's own edge: ballast, cable trough, a fenced verge and overhead-line masts.
// Far off, the chalk downs and a line of low blue hills.
//
// Everything that has to line up between chunks or bands (field boundaries, hedges, lanes,
// villages, masts) comes from one pure layout of WORLD x and distance, `fieldAt()` and friends,
// hashed from the world seed. Only the ground fill uses the chunk's own rng.
//
// Arable fields carry a crop (pickCrop): ripe wheat and barley, green barley and oilseed rape in
// flower stand as plants in the trackside and near bands (cropPlants: stalks and ears, rape's
// stems, leaves and flowers, then sheaves and drifts further out), every piece swaying with the
// music's tempo (MOVE.SWAY), in drill rows with tramlines as gaps; beyond, the crop is a colour
// with wind swathes. Stubble, mown grass and plough lie flat in stripes and furrows. Cut fields have round bales (straw, or wrapped black and green), stacks of them and rows
// of small squares (fieldBales). About one site a kilometre or two has a machine at work or parked
// (makeSite, machines): a tractor with a baler, a trailer of bales, a plough or a sprayer, or
// parked by a gate; now and then a combine opening up a wheat field. Machines and bales keep
// still on the beat (MOVE.STILL), drivers brighten (MOVE.FLASH), standing crops sway (MOVE.SWAY).
//
// Surreal dials (all 0 at level 0, so level 0 shows none of this):
//   scale     giant trees and a monolith in the far band
//   topology  floating islands of downland in the mid and far sky
//   logic     the same farmstead repeating along the line, each time slightly wrong
import { hashInts, hashString, makeRng, noise1, noise2 } from '../rng.js';
import { makeTerrain } from '../terrain.js';
import {
  KIND, makeOut, worldSeed, worldRng, worldHash, cellsAround, groundY, fillGround, strip, blob, broadleaf, conifer,
  bush, hedge, house, treeSplats, church, overheadLine, fence, floatingIsland, monolith, stick, jitter, mul3, mix3, shade, smooth, clamp, lerp, MOVE,
  detail, quatXTo, quatYaw, quatAxis, quatMul, swayBlob, swayStrut,
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
  for (let k = 1; k < rows.length; k++) rows[k].lane = (hashInts(ws, 91, k) & 255) <= 30 && rows[k].D >= 25;   // as lanes()
  L = { ws, rows, Ds: rows.map((q) => q.D), info: new Map(), villages: new Map(), sites: new Map(), terrain: ctx.terrain };
  layouts.set(ws, L);
  if (layouts.size > 8) layouts.delete(layouts.keys().next().value);
  return L;
}
function edgeD(L, k, wx) {
  const q = L.rows[k];
  return q.amp ? q.D + q.amp * (2 * noise1(wx / q.wl, L.ws + k * 13) - 1) : q.D;
}
// Width of the grass headland inside a field's front edge: wider where a lane runs along it.
function frontHw(L, k, wx, d) {
  const hw = 2.5 + 0.004 * d;
  return L.rows[k].lane && noise1(Math.floor(wx / 60) * 60 / 1200, L.ws + k * 5) >= 0.35 ? hw + 5 : hw;
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
    f.arable = true;
  } else {
    f.color = jitter(PASTURE[Math.floor(r() * PASTURE.length)], r, 0.05);
    f.stripe = r() < 0.3 ? 0.05 : 0;
    f.oaks = r() < 0.45 ? 1 + Math.floor(r() * 2.2) : 0;
    f.flock = r() < 0.3 ? (r() < 0.75 ? 1 : 2) : 0;      // 1 sheep, 2 cattle
  }
  f.farm = !f.wood && k >= 1 && r() < 0.06;
  if (f.arable) pickCrop(L, f, k, j, cx, arable);
  L.info.set(key, f);
  if (L.info.size > 20000) L.info.clear();
  return f;
}
function fieldAt(L, wx, d) { const k = rowAt(L, wx, d); return fieldInfo(L, k, colAt(L, k, wx, d)); }

// ---------------------------------------------------------------------------------------------
// Crops. An arable field may stand in a crop with a real height (wheat about 0.9 m, rape 1.4 m),
// drawn as plants (cropPlants, below) inside the grassy headland, so the near edge of a field is
// simply where the plants start, with the ground in front. The season drifts slowly along the line: ripe wheat, stubble and bales in summer stretches, rape
// in flower and green barley in spring ones, never wholly one or the other.
// ---------------------------------------------------------------------------------------------
const C = { WHEAT: 1, BARLEY: 2, GREEN: 3, RAPE: 4, STUBBLE: 5, CUT: 6, PLOUGH: 7 };
const CROP = {
  [C.WHEAT]: { c: [0.7, 0.55, 0.25], lite: [0.79, 0.67, 0.36], stem: [0.43, 0.35, 0.16], h: 0.9, wall: true, soil: [0.44, 0.36, 0.22], ear: [0.74, 0.58, 0.26] },
  [C.BARLEY]: { c: [0.73, 0.63, 0.37], lite: [0.8, 0.73, 0.5], stem: [0.48, 0.42, 0.24], h: 0.78, wall: true, soil: [0.46, 0.39, 0.25], ear: [0.78, 0.7, 0.44] },
  [C.GREEN]: { c: [0.33, 0.48, 0.18], lite: [0.5, 0.6, 0.32], stem: [0.2, 0.3, 0.11], h: 0.72, wall: true, soil: [0.3, 0.3, 0.18], ear: [0.42, 0.56, 0.24] },
  [C.RAPE]: { c: [0.8, 0.69, 0.07], lite: [0.8, 0.75, 0.2], stem: [0.21, 0.31, 0.1], h: 1.4, wall: true, soil: [0.22, 0.32, 0.11], ear: [0.8, 0.7, 0.08] },
  [C.STUBBLE]: { c: [0.72, 0.64, 0.42], h: 0.09 },
  [C.CUT]: { c: [0.44, 0.53, 0.25], h: 0.05 },
  [C.PLOUGH]: { c: [0.37, 0.27, 0.18], h: 0.12 },
};
function pickCrop(L, f, k, j, cx, arable) {
  const r = makeRng(hashInts(L.ws, 72, k, j));      // its own stream: woods, flocks and farms stay put
  const summer = smooth(0.3, 0.7, noise1(cx / 7000, L.ws + 303));
  const tall = 0.3 + 0.45 * smooth(0.35, 0.75, arable);    // standing crops gather in the arable stretches
  const u = r(), sum = r() < 0.15 + 0.7 * summer;
  if (u < tall) f.crop = sum ? (r() < 0.65 ? C.WHEAT : C.BARLEY) : (r() < 0.55 ? C.RAPE : C.GREEN);
  else if (u < tall + 0.4) f.crop = sum ? (r() < 0.55 ? C.STUBBLE : r() < 0.55 ? C.CUT : C.PLOUGH) : (r() < 0.5 ? C.PLOUGH : C.CUT);
  else return;                                         // the flat colours above: hay meadow, young crop
  f.color = jitter(CROP[f.crop].c, r, 0.04);
  f.stripe = 0;
  f.phase = r() * 24;
  // bales on cut fields: 1 round straw, 2 wrapped silage, 3 rows of small squares
  if ((f.crop === C.STUBBLE || f.crop === C.CUT) && r() < 0.8) f.bales = f.crop === C.CUT ? (r() < 0.75 ? 2 : 1) : (r() < 0.3 ? 3 : 1);
}
// The top of a crop at a world point: its colour, and its height above the ground in G.lift
// (G.flat is the canopy splats' thickness as a share of their radius).
const G = { lift: 0, flat: 0.12 };
function cropSurface(L, f, wx, d, rng) {
  const s = CROP[f.crop];
  let c = f.color, lift = s.h, flat = 0.14;
  const u = f.dir ? wx : d, v = f.dir ? d : wx + 0.3 * d;          // along and across the drill rows
  const fine = smooth(260, 45, d);
  const p = ((v + f.phase) % 24 + 24) % 24;
  if (s.wall) {
    // wind over the crop: broad paler swathes where the ears lean over, and a gently waving top
    const w = noise2((wx + 0.6 * d) / 24, (d - 0.4 * wx) / 8, L.ws + 21);
    lift *= 0.88 + 0.24 * w;
    c = mix3(c, s.lite, smooth(0.45, 0.85, w) * 0.65);
    if (f.crop === C.RAPE) {
      // a bumpy top of yellow heads, the green of the plants showing between them
      lift += (noise2(wx / 2.6, d / 2.6, L.ws + 23) - 0.5) * 0.5 + (rng() - 0.5) * 0.25 * fine;
      if (rng() < (0.08 + 0.2 * fine) * smooth(700, 250, d)) c = mix3(s.stem, s.c, 0.25);
      flat = 0.45;
    } else {
      // combed: fine streaks along the drill rows
      c = mul3(c, 1 + 0.13 * fine * (2 * noise2(u / 16, v / 0.8, L.ws + 25) - 1));
      flat = 0.3;
    }
    // tramlines every 24 m: a pair of wheel tracks where the crop is thin and the soil shows
    if (p < 2.6) {
      const k = smooth(700, 250, d);      // far off, a disc is wider than the tramline: leave it out
      if (p < 0.7 || p > 1.9) { lift *= 0.2; c = mix3(c, s.stem, 0.75 * k); }
      else { lift *= 0.85; c = mul3(c, 1 - 0.1 * k); }
    }
  } else if (f.crop === C.STUBBLE) {
    // pale stripes the combine's width apart, and the straw left in rows
    const q = ((v + f.phase) % 7.5 + 7.5) % 7.5;
    c = mul3(c, (q < 3.75 ? 1.06 : 0.92) * (q > 6.6 ? 1.12 : 1));
    if (q > 6.6) lift = 0.16;
    flat = 0.25;
  } else if (f.crop === C.CUT) {
    const q = ((v + f.phase) % 6 + 6) % 6;              // mowing stripes and the raked rows
    c = mul3(c, q < 3 ? 1.1 : 0.9);
    if (q > 5.2) { c = mix3(c, [0.6, 0.6, 0.34], 0.5); lift = 0.12; }
  } else if (f.crop === C.PLOUGH) {
    // furrows: turned ridges in light and shade, a broader unevenness beyond
    const sw = Math.sin((v / 1.1) * Math.PI * 2);
    c = mul3(c, 1 + 0.2 * sw * fine + 0.1 * (noise2(wx / 40, d / 40, L.ws + 27) - 0.5));
    lift = 0.1 + 0.09 * sw * fine;
    flat = 0.3;
  }
  G.lift = lift * smooth(320, 200, d);
  G.flat = flat;
  return c;
}

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
// It also leaves the height of a standing crop there in G.lift (0 elsewhere). `cuts` lists the
// strips a combine has already cut in this chunk (see cutsFor).
function groundColor(ctx, L, wx, d, rng, y, cuts, plants) {
  const k = rowAt(L, wx, d), j = colAt(L, k, wx, d);
  let f = fieldInfo(L, k, j);
  G.lift = 0; G.flat = 0.12;
  const front = d - edgeD(L, k, wx);
  // headland: a band of rough grass inside each boundary
  const edge = Math.min(front, k + 1 < L.rows.length ? edgeD(L, k + 1, wx) - d : 1e9,
    Math.abs(wx - colEdge(L, k, j, d)), Math.abs(colEdge(L, k, j + 1, d) - wx));
  const hw = 2.5 + 0.004 * d;
  const vil = d < 1800 && nearVillage(L, wx, d);
  let c = f.color;
  const fhw = f.crop ? frontHw(L, k, wx, d) : hw;
  if (f.crop && edge >= hw && front >= fhw && !vil) {
    if (cuts && f.crop <= C.BARLEY) for (const q of cuts) if (q.k === k && q.j === j && front < fhw + cutDepth(q, wx)) { f = q.stub; break; }
    c = cropSurface(L, f, wx, d, rng);
    // where the plants stand (cropPlants), the ground under them is soil with a tint of the crop;
    // further out, as the plants thin, the ground carries more of the crop's colour
    if (plants && CROP[f.crop].wall) { G.lift = 0; G.flat = 0.12; c = mix3(CROP[f.crop].soil, c, 0.45 + 0.45 * smooth(140, 300, d)); }
  } else if (f.stripe) {
    const coord = f.dir ? d : wx + 0.3 * d;
    const s = Math.sin((coord / f.period) * Math.PI * 2) > 0 ? 1 : -1;
    c = mul3(c, 1 + f.stripe * s * smooth(900, 150, d));
  }
  const m = noise2(wx / 31, d / 31, L.ws + 3) * 0.6 + noise2(wx / 7, d / 7, L.ws + 4) * 0.4;
  c = mul3(c, f.crop ? 0.92 + 0.16 * m : 0.86 + 0.26 * m);
  if (edge < hw && !f.wood) c = mix3(c, [0.28, 0.38, 0.17], 0.6 * (1 - edge / hw));
  else if (front < fhw) c = mix3(c, [0.28, 0.38, 0.17], 0.75);      // the verge of a lane along the field
  if (d > 600) {
    // far: chalk downland tops read paler, valley floors greener
    const hgt = (y != null ? y : ctx.terrain.height(wx, d)) - 0.025 * d;
    c = mix3(c, [0.42, 0.5, 0.28], smooth(60, 160, hgt) * 0.5);
  }
  if (vil) c = mix3(c, [0.27, 0.36, 0.17], 0.5);
  return jitter(c, rng, 0.05);
}

// The ground fill of the trackside and near bands: kit fillGround, but each disc stands at the
// height of what lies on the ground where it lands (groundColor's G.lift: stubble, raked rows,
// furrows) and takes its thickness. Under standing crops it is the soil the plants stand in.
function* fieldFill(ctx, out, L, opts) {
  out.limit = Infinity;
  const n = Math.floor(opts.n != null ? opts.n : out.left());
  if (n <= 0) return;
  const rng = ctx.rng, cuts = opts.cuts;
  const dn = opts.dNear != null ? opts.dNear : ctx.zNear, df = opts.dFar != null ? opts.dFar : ctx.zFar;
  const p = opts.power, cover = opts.cover, minR = 0.0015, maxR = opts.maxR || 0.08, Lx = ctx.length;
  const a1 = 1 - p, A = Math.pow(dn, a1), B = Math.pow(df, a1), Z = (B - A) / a1;
  for (let i = 0; i < n; i++) {
    const u = (i + rng()) / n;
    const d = Math.pow(A + u * (B - A), 1 / a1);
    const x = rng() * Lx;
    const dens = (n * Math.pow(d, -p) / Z) / Lx;
    const r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
    const wx = ctx.x0 + x;
    const y = ctx.terrain.height(wx, d);
    const c = groundColor(ctx, L, wx, d, rng, y, cuts, true);
    const ax = 0.8 + 0.5 * rng();
    out(x, y + G.lift, -d, r * ax, r * G.flat, r * (1.8 - ax), c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Standing crops as plants. In the trackside and near bands wheat, barley and rape are drawn as
// plants standing in their soil, every piece swaying (kit swayBlob / swayStrut, MOVE.SWAY: a lean
// along the line once for every two beats of the music, as a wave running across the field). By
// the line single plants: stalks with ears (gold nodding ears for wheat, drooping pale heads with
// long awns for ripe barley, green upright ones for unripe barley), rape with green stems, leaves
// and clusters of yellow flowers; they stand in the drill rows and leave the tramlines as gaps.
// Further out, sheaves (a body of stalks with a few ears on top), then drifts (a tussock of the
// crop with its colour on top), sized so nothing is smaller than about a pixel and a half. The
// mid band takes the crop's colour only.
// ---------------------------------------------------------------------------------------------
const PLANT_PX = 0.00075;            // the smallest piece's radius per metre of distance (~1.6 px across)
// The field at (wx, d) if it is standing crop there: not its headland or a lane's verge, not in a
// village, not what a combine has cut, not a tramline's wheel track. Otherwise null.
function standing(L, wx, d, cuts) {
  const k = rowAt(L, wx, d), j = colAt(L, k, wx, d), f = fieldInfo(L, k, j);
  if (!f.crop || !CROP[f.crop].wall) return null;
  const hw = 2.5 + 0.004 * d, front = d - edgeD(L, k, wx), fhw = frontHw(L, k, wx, d);
  if (front < fhw || (k + 1 < L.rows.length && edgeD(L, k + 1, wx) - d < hw)) return null;
  if (wx - colEdge(L, k, j, d) < hw || colEdge(L, k, j + 1, d) - wx < hw) return null;
  if (cuts) for (const q of cuts) if (q.k === k && q.j === j && front < fhw + cutDepth(q, wx)) return null;
  const v = f.dir ? d : wx + 0.3 * d, p = ((v + f.phase) % 24 + 24) % 24;
  if (p < 0.7 || (p > 1.9 && p < 2.6)) return null;
  if (d < 1800 && nearVillage(L, wx, d)) return null;
  return f;
}
// Where the crop is in this chunk: cells 8 m along the line, deepening with distance, kept if any
// corner or the middle lies in a standing crop field, each weighted by its area times d^-p (so the
// plants are spread by how much of the window each part fills). Flat [x, d, depth, cumulative].
function cropCells(ctx, L, dLo, dHi, p) {
  const cells = [], CX = 8;
  let tot = 0, all = 0;
  for (let d = dLo; d < dHi;) {
    const cd = Math.min(dHi - d, Math.max(2.5, 0.08 * d)), w = CX * cd * Math.pow(d + cd / 2, -p);
    for (let x = 0; x < ctx.length; x += CX) {
      all += w;
      const wx = ctx.x0 + x;
      let hit = false;
      for (let c = 0; c < 5 && !hit; c++) {
        const f = fieldAt(L, wx + (c === 0 ? 0.5 : c & 1) * CX, d + (c === 0 ? 0.5 : (c >> 1) & 1) * cd);
        hit = !!f.crop && !!CROP[f.crop].wall;
      }
      if (hit) { tot += w; cells.push(x, d, cd, tot); }
    }
    d += cd;
  }
  return { cells, tot, all };
}
// One clump of crop at chunk-local x, distance d. lod 0: single plants; 1: a sheaf; 2: a drift.
// big > 1 at low budgets: fewer, larger pieces.
function cropClump(ctx, out, L, f, x, d, rng, lod, big) {
  const s = CROP[f.crop], wx = ctx.x0 + x, y0 = ctx.terrain.height(wx, d), z = -d;
  const px = Math.max(0.012, PLANT_PX * d);
  const c = cropSurface(L, f, wx, d, rng);           // the crop's colour here: wind swathes, comb
  const k = 0.88 + 0.22 * rng();
  const ear = mul3(mix3(s.ear, c, 0.5), k), stem = mul3(mix3(s.stem, c, 0.35), k);
  const H0 = s.h * (0.88 + 0.24 * rng()) * (0.92 + 0.16 * noise2(wx / 9, d / 9, L.ws + 29));
  const rape = f.crop === C.RAPE, K = KIND.OTHER;
  if (lod === 2) {
    // a drift: a tussock of the crop, its stalk colour below and the ears' colour on top
    const w = Math.max(0.5, 0.0045 * d) * big * (0.8 + 0.4 * rng());
    swayBlob(out, x, y0 + H0 * 0.42, z, w, H0 * 0.42, stem, y0, K);
    swayBlob(out, x + (rng() - 0.5) * w * 0.4, y0 + H0 * 0.88, z + 0.2 * w, w * 0.92, Math.max(H0 * 0.17, px * 1.2), ear, y0, K);
    return;
  }
  if (lod === 1) {
    // a sheaf: a body of stalks with a few ears or flower heads on top
    const w = Math.max(0.35, 0.007 * d) * big;
    swayBlob(out, x, y0 + H0 * 0.4, z, w * 0.5, H0 * 0.4, stem, y0, K);
    const n = rape ? 3 : 4;
    for (let i = 0; i < n; i++) {
      const hx = x + (rng() - 0.5) * w, hz = z + (rng() - 0.3) * w * 0.6, hy = y0 + H0 * (0.86 + 0.14 * rng());
      const r = Math.max(px * 1.15, rape ? 0.09 : 0.05) * big;
      swayBlob(out, hx, hy, hz, r * (rape ? 1.3 : 1), rape ? r * 0.9 : Math.max(r * 1.5, 0.09), ear, y0, K);
    }
    return;
  }
  // single plants, by the line: a few to a clump, along the drill row
  const m = rape ? 2 : 3;
  const ux = f.dir ? 1 : 0.95, uz = f.dir ? 0 : -0.29;       // along the row, in splat space (x, z)
  const sr = Math.max(0.012, px * 0.6) * big;
  for (let i = 0; i < m; i++) {
    const a = (i - (m - 1) / 2) * (rape ? 0.4 : 0.13) + (rng() - 0.5) * 0.06;
    const bx = x + ux * a, bz = z + uz * a - (rng() - 0.5) * 0.05;
    const H = H0 * (0.9 + 0.2 * rng()), lean = (rng() - 0.5) * 0.12 * H;
    const tx = bx + lean, ty = y0 + H;
    if (rape) {
      swayStrut(out, bx, y0, bz, tx, ty - 0.08, bz, Math.max(sr, 0.018), stem, 3, y0, K);
      for (const sg of [-1, 1]) {
        const ly = y0 + H * (sg < 0 ? 0.35 : 0.58);
        swayBlob(out, bx + sg * 0.16 + lean * 0.4, ly, bz + 0.02, Math.max(px * 1.2, 0.17) * big, Math.max(px, 0.07), stem, y0, K);
      }
      // the flowering top branches into a crowded spray of yellow heads
      for (let h = 0; h < 5; h++) {
        const r = Math.max(px * 1.2, 0.07) * big, a2 = (h / 5) * Math.PI * 2 + rng();
        swayBlob(out, tx + Math.cos(a2) * 0.16, ty - 0.12 * rng(), bz + Math.sin(a2) * 0.1, r, r * 0.8, h === 4 ? mix3(ear, stem, 0.4) : ear, y0, K);
      }
      continue;
    }
    swayStrut(out, bx, y0, bz, tx, ty - 0.05, bz, sr, stem, 2, y0, K);
    const er = Math.max(px * 1.1, 0.03) * big;
    if (f.crop === C.WHEAT) {
      // a heavy ear, nodding over
      swayBlob(out, tx + 0.03, ty - 0.02, bz, er * 1.15, Math.max(er, 0.075) * big, ear, y0, K);
    } else if (f.crop === C.BARLEY) {
      // ripe barley hangs its head, its long awns trailing
      swayBlob(out, tx + 0.07, ty - 0.07, bz, er * 1.2, Math.max(er, 0.085) * big, ear, y0, K);
      swayStrut(out, tx + 0.08, ty - 0.12, bz, tx + 0.22, ty - 0.24, bz, sr * 0.8, mul3(ear, 0.97), 1, y0, K);
    } else {
      // green barley: upright ears with their awns standing up
      swayBlob(out, tx, ty, bz, er, Math.max(er, 0.06) * big, ear, y0, K);
      swayStrut(out, tx, ty + 0.05, bz, tx + 0.02, ty + 0.18, bz, sr * 0.7, mul3(ear, 1.1), 1, y0, K);
    }
  }
}
// The plants of the band's standing crops, spending up to `share` of its count where the chunk is
// all crop (less where it has less), and never so much that the ground fill gets under `keep` of it.
function* cropPlants(ctx, out, L, dLo, dHi, opts) {
  const p = opts.power, rng = ctx.rng;
  const { cells, tot, all } = cropCells(ctx, L, dLo, dHi, p);
  if (!tot) return;
  const want = ctx.count * opts.share * Math.min(1, (tot / all) / 0.45);
  const budget = Math.max(0, Math.min(want, ctx.count * (1 - opts.keep) - out.n));
  const stop = out.n + budget;
  // keep clear of a sprayer working in the crop
  const clear = [];
  for (const s of sitesAround(ctx, L, 30)) if (s.kind === 'sprayer') clear.push(s);
  const rel = Math.max(0.3, out.density), big = clamp(Math.pow(rel, -0.3), 1, 1.35);
  const lod0 = opts.lod0 * Math.sqrt(Math.min(1, rel)), lod1 = opts.lod1 * Math.sqrt(Math.min(1, rel));
  const n4 = cells.length / 4;
  for (let i = 0; i < budget * 2 && out.n < stop; i++) {
    // a cell by weight, then a point in it
    const u = rng() * tot;
    let lo = 0, hi = n4 - 1;
    while (lo < hi) { const mI = (lo + hi) >> 1; if (cells[mI * 4 + 3] < u) lo = mI + 1; else hi = mI; }
    let x = cells[lo * 4] + rng() * 8, d = cells[lo * 4 + 1] + rng() * cells[lo * 4 + 2];
    if (x < 0 || x >= ctx.length) continue;
    let wx = ctx.x0 + x;
    const lod = d < lod0 ? 0 : d < lod1 ? 1 : 2;
    const f0 = fieldAt(L, wx, d);
    if (!f0.crop || !CROP[f0.crop].wall) continue;
    if (lod === 0) {
      // onto the drill row (0.5 m apart, wider than life so the rows read from the train)
      if (f0.dir) d = Math.round((d + f0.phase) / 0.5) * 0.5 - f0.phase;
      else { wx = Math.round((wx + 0.3 * d) / 0.5) * 0.5 - 0.3 * d; x = wx - ctx.x0; }
    }
    if (clear.length && clear.some((s) => Math.abs(wx - s.wx) < 9 && Math.abs(d - s.d) < 3.2)) continue;
    const f = standing(L, wx, d, opts.cuts);
    if (!f) continue;
    cropClump(ctx, out, L, f, x, d, rng, lod, big);
    if (out.due()) yield;
  }
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
          // An animal: body, head (down to graze, or up), four legs where they can be seen. Drawn
          // a third over life size so a flock reads from the train, and it answers the beat.
          const sheep = f.flock === 1, B = MOVE.FLASH, S = 1.35;
          const c = sheep ? [0.74, 0.72, 0.64] : rng() < 0.5 ? [0.12, 0.1, 0.09] : [0.38, 0.24, 0.15];
          const bl = (sheep ? 0.55 : 1.0) * S, bh = (sheep ? 0.36 : 0.58) * S, leg = (sheep ? 0.36 : 0.68) * S;
          const dir = rng() < 0.5 ? -1 : 1, grazing = rng() < 0.6;
          const hc = sheep ? [0.16, 0.14, 0.13] : [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8];
          out(x, y + leg + bh * 0.85, -d, bl, bh, bh * 0.9, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER, B);
          out(x + dir * bl * 1.1, y + leg + (grazing ? -0.15 * leg : bh * 1.5), -d, bh * 0.55, bh * 0.45, bh * 0.42, hc[0], hc[1], hc[2], 1, 0, 0, 0, 1, KIND.OTHER, B);
          if (!sheep && rng() < 0.4) out(x - dir * bl * 0.2, y + leg + bh * 0.95, -(d - bh * 0.5), bl * 0.45, bh * 0.6, bh * 0.4, 0.76, 0.75, 0.72, 1, 0, 0, 0, 1, KIND.OTHER, B);   // a white flank
          if (d < 260) {
            const lr = Math.max(sheep ? 0.05 : 0.08, 0.0012 * d);
            for (const lx of [-0.62, 0.62]) for (const lz of [-0.45, 0.45])
              out(x + lx * bl, y + leg * 0.5, -(d + lz * bh), lr, leg * 0.55, lr, hc[0] * 0.8, hc[1] * 0.8, hc[2] * 0.8, 1, 0, 0, 0, 1, KIND.OTHER, B);
          }
        }
        if (out.due()) yield;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Farm machinery and bales. They do not answer the beat (MOVE.STILL, which also keeps the raised
// rule off them): a swell lifts each splat by its own size, so a rigid thing built from big and
// small pieces (a bale's flat ends and its thin rim) came apart into spikes on every beat. The
// only person, a tractor driver, brightens (MOVE.FLASH). No face is one big splat: a splat still
// shows at twice its scale, so a disc the size of a bale's end or a wheel stood out past the rim
// as a halo square on and as a tall prong edge-on. Faces are tiled inside their outline (discFace).
// ---------------------------------------------------------------------------------------------

// Tone of a face from its normal in splat space, as kit house() does it: tops lit, the front a
// little darker, the approach (-x) end in sun, the far end and the back in shade.
function faceTone(c, nx, ny, nz) {
  const side = 0.74 + 0.08 * nz - 0.13 * nx;
  const k = ny >= 0 ? lerp(side, 1.02, ny * ny) : lerp(side, 0.45, ny * ny);
  return [c[0] * k, c[1] * k, c[2] * k];
}

// A frame for building a machine in its own metres: local x forward, y up, z to its left, turned by
// yaw and scaled by S about a point on the ground. Every splat is MOVE.STILL unless told otherwise.
// Splats are gathered, not emitted: `yield* flush(out, R)` sends them, yielding as it goes.
function rig(ctx, out0, wx, d, yaw, S, base) {
  const buf = [];
  const out = (...a) => { buf.push(a); };
  const X = wx - ctx.x0, Z = -d, Y = base != null ? base : ctx.terrain.height(wx, d);
  const cs = Math.cos(yaw), sn = Math.sin(yaw), qy = quatYaw(yaw);
  const s = Math.max(0.12, detail(out0, d, 1.2)) / S;      // splat spacing, in local metres
  const R = {
    S, s, yaw, X, Y, Z, buf,
    // world (splat space) position of a local point
    pos(lx, ly, lz) { return [X + S * (cs * lx + sn * lz), Y + S * ly, Z + S * (-sn * lx + cs * lz)]; },
    // a splat in local coordinates; q is an extra local rotation
    p(lx, ly, lz, sx, sy, sz, c, q, move = MOVE.STILL, o = 1) {
      const qq = q ? quatMul(qy, q) : qy;
      out(X + S * (cs * lx + sn * lz), Y + S * ly, Z + S * (-sn * lx + cs * lz), S * sx, S * sy, S * sz, c[0], c[1], c[2], o, qq[0], qq[1], qq[2], qq[3], KIND.OTHER, move);
    },
    // colour of a face whose local normal is (nx, ny, nz)
    tone(c, nx, ny, nz) { return faceTone(c, cs * nx + sn * nz, ny, -sn * nx + cs * nz); },
    // a box as its faces (no bottom), splats overlapping at the frame's spacing
    box(x0, x1, y0, y1, z0, z1, c, opts = {}) {
      if (z1 < z0) [z0, z1] = [z1, z0];
      const sp = opts.s || s;
      const face = (ox, oy, oz, ux, uy, uz, U, vx, vy, vz, V, nx, ny, nz, col) => {
        const nu = Math.max(1, Math.round(U / (sp * 1.5))), nv = Math.max(1, Math.round(V / (sp * 1.5)));
        const cc = R.tone(col, nx, ny, nz);
        const hu = (U / nu) * 0.62, hv = (V / nv) * 0.62;
        for (let a = 0; a < nu; a++) for (let b = 0; b < nv; b++) {
          const ta = (a + 0.5) / nu * U, tb = (b + 0.5) / nv * V;
          // sizes along the face's own axes: x, y, z of the local frame
          const sx = Math.abs(ux) * hu + Math.abs(vx) * hv + Math.abs(nx) * 0.03;
          const sy = Math.abs(uy) * hu + Math.abs(vy) * hv + Math.abs(ny) * 0.03;
          const sz = Math.abs(uz) * hu + Math.abs(vz) * hv + Math.abs(nz) * 0.03;
          R.p(ox + ux * ta + vx * tb, oy + uy * ta + vy * tb, oz + uz * ta + vz * tb, sx, sy, sz, cc, null, opts.move, opts.o);
        }
      };
      const W = x1 - x0, H = y1 - y0, D = z1 - z0, top = opts.top || c;
      face(x0, y1, z0, 1, 0, 0, W, 0, 0, 1, D, 0, 1, 0, top);
      face(x0, y0, z1, 1, 0, 0, W, 0, 1, 0, H, 0, 0, 1, c);
      face(x0, y0, z0, 1, 0, 0, W, 0, 1, 0, H, 0, 0, -1, c);
      face(x1, y0, z0, 0, 0, 1, D, 0, 1, 0, H, 1, 0, 0, opts.front || c);
      face(x0, y0, z0, 0, 0, 1, D, 0, 1, 0, H, -1, 0, 0, opts.back || c);
    },
    // a thin straight member between two local points (kit strut, with the frame's motion class)
    bar(ax, ay, az, bx, by, bz, r, c, n, move = MOVE.STILL) {
      const [px, py, pz] = R.pos(ax, ay, az), [qx, qy2, qz] = R.pos(bx, by, bz);
      const dx = qx - px, dy = qy2 - py, dz = qz - pz, len = Math.hypot(dx, dy, dz) || 1e-6;
      const q = quatXTo(dx / len, dy / len, dz / len);
      n = n || Math.max(1, Math.round(len / (r * 6)));
      const sl = (len / n) * 0.5;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        out(px + dx * t, py + dy * t, pz + dz * t, sl, r, r, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.OTHER, move);
      }
    },
    // a wheel on an axle along local z: tyre with a lumpy tread, and a hub on both faces
    wheel(lx, ly, lz, rad, w, hub) {
      const tyre = [0.07, 0.07, 0.07];
      const n = Math.max(10, Math.round((2 * Math.PI * rad) / (s * 1.3)));
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        const q = quatAxis(0, 0, 1, t);
        R.p(lx - Math.sin(t) * rad * 0.9, ly + Math.cos(t) * rad * 0.9, lz, (Math.PI * rad / n) * 0.75, rad * 0.14, w * 0.5, R.tone(tyre, -Math.sin(t), Math.cos(t), 0), q);
      }
      // each face tiled in rings that stay inside the tyre (see discFace): a dark sidewall, the hub
      // and its cap. One disc the size of the wheel reached twice its radius: a dark halo square
      // on and a tall line through the wheel edge-on.
      for (const sg of [-1, 1]) {
        const at = (x, y, z, sx, sy, c, q) => R.p(x, y, z, sx, sy, 0.03, c, q);
        const zf = lz + sg * w * 0.45;
        discFace(rad * 0.84, 2, (u, v) => [lx + u, ly + v, zf], null, (i) => R.tone(i < 2 ? hub : [0.09, 0.09, 0.09], 0, 0, sg), at);
        R.p(lx, ly, lz + sg * w * 0.53, rad * 0.08, rad * 0.08, 0.03, [0.2, 0.2, 0.2]);
      }
    },
  };
  return R;
}

// A flat round face (a bale's end, a wheel's side) tiled in rings of small splats, in the plane
// whose normal is local z, so that no splat reaches past radius `rad`. A splat's scale is one
// standard deviation and it still shows at twice that, so the outermost centres sit 2 sigma in
// from the rim and neighbouring rings are no more than 1.4 sigma apart. `m` rings round a centre
// splat; colour(i) gives ring i's colour (0 is the centre). P(u, v) places a point of the face
// (u, v in its plane) in the frame, `rot` is the face's own turn (a quaternion or null), and
// at(x, y, z, sx, sy, c, q) emits one splat (sx along the ring, sy across it).
function discFace(rad, m, P, rot, colour, at) {
  const step = rad / (m + 1.43), sr = step / 1.4;
  at(...P(0, 0), sr, sr, colour(0), rot);
  for (let i = 1; i <= m; i++) {
    const r = i * step, n = Math.max(6, Math.round((2 * Math.PI * r) / (sr * 1.3)));
    const st = Math.min(sr * 1.15, ((2 * Math.PI * r) / n) / 1.3);
    const c = colour(i);
    for (let k = 0; k < n; k++) {
      const t = ((k + (i % 2) * 0.5) / n) * Math.PI * 2;
      const q = quatAxis(0, 0, 1, t);
      at(...P(-Math.sin(t) * r, Math.cos(t) * r), st, sr, c, rot ? quatMul(rot, q) : q);
    }
  }
}

function* flush(out, ...rigs) {
  for (const R of rigs) for (const a of R.buf) { out(...a); if (out.due()) yield; }
}

const TRACTOR = [
  { body: [0.6, 0.1, 0.07], hub: [0.56, 0.56, 0.54], roof: [0.72, 0.72, 0.7] },     // red
  { body: [0.12, 0.35, 0.11], hub: [0.78, 0.62, 0.09], roof: [0.12, 0.35, 0.11] },  // green and yellow
  { body: [0.09, 0.2, 0.5], hub: [0.7, 0.7, 0.68], roof: [0.72, 0.72, 0.7] },        // blue
];
const GLASS = [0.13, 0.17, 0.2];

// A tractor, 1.6 times life size: big rear wheels, small front ones, bonnet, cab with its glass
// and a driver, exhaust stack. Local x = 0 is the rear axle; the hitch is at x = -1.3.
function tractor(R, liv, driver = true) {
  const { body, hub, roof } = liv;
  const dark = [0.12, 0.12, 0.12];
  R.wheel(0, 0.9, 0.95, 0.9, 0.55, hub); R.wheel(0, 0.9, -0.95, 0.9, 0.55, hub);
  R.wheel(2.55, 0.55, 0.85, 0.55, 0.38, hub); R.wheel(2.55, 0.55, -0.85, 0.55, 0.38, hub);
  R.box(-0.5, 0.9, 0.6, 1.25, -0.55, 0.55, dark);                         // transmission under the cab
  R.box(0.9, 3.45, 0.75, 1.65, -0.45, 0.45, body, { front: mul3(body, 0.8) });   // bonnet
  R.box(3.25, 3.5, 0.8, 1.45, -0.4, 0.4, [0.16, 0.16, 0.16]);              // grille
  // mudguards over the rear wheels
  for (const sg of [-1, 1]) R.box(-0.85, 0.85, 1.8, 1.92, sg * 0.67, sg * 1.25 + (sg < 0 ? 0 : 0), body, {});
  // cab: glass all round between corner posts, a roof
  const cx0 = -0.75, cx1 = 0.85, cy0 = 1.3, cy1 = 2.85, cz = 0.7;
  R.box(cx0, cx1, cy0, cy1, -cz, cz, GLASS, { top: GLASS, o: 0.8 });
  for (const px of [cx0, cx1]) for (const pz of [-cz, cz]) R.bar(px, cy0, pz, px, cy1, pz, 0.06, body);
  R.box(cx0 - 0.08, cx1 + 0.12, cy1, cy1 + 0.16, -cz - 0.08, cz + 0.08, roof);
  R.box(cx0, cx1, cy0, cy0 + 0.35, -cz - 0.02, cz + 0.02, body);          // cab skirt
  if (driver) {
    R.p(0, 1.75, 0, 0.22, 0.3, 0.2, [0.2, 0.28, 0.44], null, MOVE.FLASH);
    R.p(0, 2.2, 0, 0.12, 0.14, 0.12, [0.66, 0.5, 0.4], null, MOVE.FLASH);
  }
  R.bar(1.05, 1.6, 0.32, 1.05, 3.05, 0.32, 0.07, [0.18, 0.18, 0.18]);    // exhaust
  R.bar(-0.6, 0.8, 0, -1.3, 0.6, 0, 0.07, dark);                          // drawbar and hitch
}

// A round bale lying on its curved side, axis along local z (or a frame turned by yaw):
// the curved face as a ring of pieces, flat ends with the spiral of the roll in rings.
// R.S is 1.5 for bales on their own (1.5 m across, drawn half again as big).
const BALE = {
  straw: { side: [0.72, 0.6, 0.34], end: [0.76, 0.66, 0.4], ring: [0.6, 0.48, 0.26] },
  hay: { side: [0.58, 0.55, 0.3], end: [0.64, 0.6, 0.36], ring: [0.48, 0.45, 0.24] },
  black: { side: [0.06, 0.06, 0.07], end: [0.08, 0.08, 0.09], ring: [0.2, 0.2, 0.22] },
  green: { side: [0.46, 0.58, 0.4], end: [0.5, 0.62, 0.44], ring: [0.62, 0.7, 0.56] },
};
function roundBale(R, lx, ly, lz, kind, ax = 0) {
  // ax turns the bale about the vertical inside the frame (radians)
  const b = BALE[kind], rad = 0.75, hw = 0.6;
  const ca = Math.cos(ax), sa = Math.sin(ax), qa = quatYaw(ax);
  const P = (x, y, z) => [lx + ca * x + sa * z, ly + y, lz - sa * x + ca * z];
  // Nothing may reach past the bale's outline: a splat still shows at twice its scale, so pieces
  // are inset by two of their own sizes from every edge. The ends were once single discs nearly
  // the bale's radius: they reached twice as far, and wherever a bale was seen edge-on (its axis
  // across the view) each end stood up out of it as a thin vertical prong.
  const n = Math.max(10, Math.round((2 * Math.PI * rad) / (R.s * 1.4)));
  const na = Math.max(1, Math.round((2 * hw) / (R.s * 1.6)));
  const dz = (2 * hw) / (na + 1.86), sz = dz / 1.4;          // centres along the axis, inset 2 sz from each end
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2, nx = -Math.sin(t), ny = Math.cos(t);
    const q = quatMul(qa, quatAxis(0, 0, 1, t));
    const c = R.tone(b.side, ca * nx, ny, -sa * nx);
    for (let a = 0; a < na; a++) {
      const [x, y, z] = P(nx * rad * 0.92, ny * rad * 0.92, (a - (na - 1) / 2) * dz);
      R.p(x, y, z, (Math.PI * rad / n) * 1.25, rad * 0.12, sz, c, q);
    }
  }
  if (kind === 'black' || kind === 'green') {
    // a sheen on the wrap, in three pieces along the top that stop short of the ends
    const sheen = mix3(b.side, [0.8, 0.8, 0.8], 0.35);
    for (let a = -1; a <= 1; a++) {
      const [x, y, z] = P(0, rad * 0.75, a * hw * 0.4);
      R.p(x, y + 0.02, z, rad * 0.3, 0.05, hw * 0.28, sheen, qa);
    }
  }
  // the flat ends: rings of small splats (the roll's spiral as bands of the end and ring colours),
  // as many rings as the frame's spacing allows, the outermost reaching the rim and no further
  const m = clamp(Math.round(rad / (R.s * 1.6)), 1, 3);
  for (const sg of [-1, 1]) {
    const cEnd = R.tone(b.end, sa * sg, 0, ca * sg), cRing = R.tone(b.ring, sa * sg, 0, ca * sg);
    discFace(rad * 0.98, m, (u, v) => P(u, v, sg * hw), qa, (i) => (i === 0 || (m - i) % 2 === 1 ? cRing : cEnd),
      (x, y, z, sx, sy, c, q) => R.p(x, y, z, sx, sy, 0.03, c, q));
  }
}
// A small square bale (0.9 x 0.45 x 0.35 m; fieldBales draws them 2.3 times life size, or they
// are specks beside the round ones), long axis along local x.
function squareBale(R, lx, lz, ax) {
  // sides a darker gold than the stubble, a pale top, and its shadow on the stubble behind it
  const ca = Math.cos(ax), sa = Math.sin(ax), qa = quatYaw(ax), c = [0.62, 0.5, 0.26], top = [0.8, 0.72, 0.45];
  // (pieces sized so that twice their scale, where a splat still shows, ends at the bale's edges)
  R.p(lx - 0.1, 0.02, lz - 0.3, 0.55, 0.02, 0.25, [0.3, 0.26, 0.16], qa);
  for (let i = -1.5; i <= 1.5; i++) {
    const x = lx + ca * i * 0.22, z = lz - sa * i * 0.22;
    R.p(x, 0.18, z, 0.12, 0.09, 0.12, R.tone(c, 0, 0, 1), qa);
    R.p(x, 0.34, z, 0.12, 0.025, 0.11, R.tone(top, 0, 1, 0), qa);
  }
}

// Behind a tractor (local x < -1.3, the hitch): a round baler, a trailer of bales, a plough or a sprayer.
function baler(R, liv) {
  const col = liv.body;
  R.bar(-1.3, 0.6, 0, -2.6, 0.7, 0, 0.08, [0.15, 0.15, 0.15]);
  R.box(-5.1, -2.6, 0.55, 2.6, -1.2, 1.2, col, { top: mul3(col, 1.05) });
  R.box(-2.9, -2.4, 0.15, 0.6, -1.1, 1.1, [0.15, 0.15, 0.15]);            // pickup
  R.wheel(-3.9, 0.45, 1.35, 0.45, 0.35, liv.hub); R.wheel(-3.9, 0.45, -1.35, 0.45, 0.35, liv.hub);
  R.box(-5.2, -4.9, 0.7, 2.4, -1.15, 1.15, [0.6, 0.58, 0.55]);             // tailgate
}
function baleTrailer(R, liv, kind) {
  const deck = liv === TRACTOR[0] ? [0.5, 0.1, 0.07] : [0.4, 0.4, 0.39];
  R.bar(-1.3, 0.6, 0, -2.4, 1.0, 0, 0.08, [0.15, 0.15, 0.15]);
  R.box(-9.4, -2.4, 0.95, 1.2, -1.25, 1.25, deck);
  R.wheel(-5.4, 0.45, 1.0, 0.45, 0.35, [0.5, 0.5, 0.5]); R.wheel(-5.4, 0.45, -1.0, 0.45, 0.35, [0.5, 0.5, 0.5]);
  R.wheel(-6.4, 0.45, 1.0, 0.45, 0.35, [0.5, 0.5, 0.5]); R.wheel(-6.4, 0.45, -1.0, 0.45, 0.35, [0.5, 0.5, 0.5]);
  // bales lying across the deck, two layers (the trailer frame is life size, so bales are 1.5 m)
  for (let i = 0; i < 4; i++) roundBale(R, -3.3 - i * 1.6, 1.95, 0, kind);
  for (let i = 0; i < 3; i++) roundBale(R, -4.1 - i * 1.6, 3.3, 0, kind);
}
function plough(R) {
  const frame = [0.1, 0.22, 0.5], steel = [0.62, 0.62, 0.6];
  R.box(-1.6, -1.2, 0.4, 1.6, -0.5, 0.5, frame);                          // headstock
  R.bar(-1.4, 0.9, 0, -5.8, 0.9, -1.9, 0.12, frame);                      // beam, out to the unploughed side
  for (let i = 0; i < 4; i++) {
    const t = (i + 0.5) / 4, x = lerp(-1.9, -5.6, t), z = lerp(-0.2, -1.8, t);
    R.bar(x, 0.9, z, x - 0.2, 0.1, z, 0.06, frame);
    R.bar(x, 0.9, z, x - 0.2, 1.7, z, 0.06, frame);
    // mouldboard in the soil and its twin turned up, each two pieces sized so they end at its edges
    const ux = Math.cos(0.6) * 0.2, uz = -Math.sin(0.6) * 0.2;
    for (const y of [0.25, 1.55]) for (const sg of [-1, 1]) {
      R.p(x - 0.35 + sg * ux, y, z + 0.2 + sg * uz, 0.2, 0.15, 0.04, R.tone(steel, 0, 0, 1), quatYaw(0.6));
    }
  }
  R.wheel(-5.9, 0.4, -1.7, 0.4, 0.25, [0.5, 0.5, 0.5]);
}
function sprayer(R, liv) {
  const tank = [0.74, 0.74, 0.7], boom = [0.55, 0.55, 0.52];
  R.box(-2.4, -1.3, 0.6, 2.0, -0.9, 0.9, tank, { top: tank });            // tank on the linkage
  R.box(-2.6, -2.3, 0.5, 1.6, -1.0, 1.0, [0.2, 0.2, 0.2]);
  const L = 9, y = 1.0;
  for (const sg of [-1, 1]) {
    R.bar(-2.6, y, 0, -2.6, y, sg * L, 0.05, boom);
    R.bar(-2.6, y + 0.45, sg * 0.8, -2.6, y, sg * L, 0.04, boom);
    for (let i = 1; i <= 4; i++) R.bar(-2.6, y, sg * i * L / 5, -2.6, y + 0.45 * (1 - (i * L / 5 - 0.8) / (L - 0.8)), sg * i * L / 5, 0.035, boom, 1);
  }
}
// A five-bar gate of galvanised steel, across local x from 0 to 3.6 (life size frame).
function gate(R) {
  const g = [0.6, 0.6, 0.58], post = [0.32, 0.26, 0.2];
  R.bar(-0.15, 0, 0, -0.15, 1.5, 0, 0.09, post, 3, 0); R.bar(3.75, 0, 0, 3.75, 1.5, 0, 0.09, post, 3, 0);
  for (let i = 0; i < 5; i++) { const y = 0.25 + i * 0.27; R.bar(0, y, 0, 3.6, y, 0, 0.035, g, 6, 0); }
  R.bar(0, 0.25, 0, 0, 1.33, 0, 0.04, g, 2, 0); R.bar(3.6, 0.25, 0, 3.6, 1.33, 0, 0.04, g, 2, 0);
  R.bar(0, 0.25, 0, 3.6, 1.33, 0, 0.035, g, 6, 0);
  // a few metres of post-and-rail fence either side, so the gate stands in a boundary
  const wood = [0.36, 0.3, 0.22];
  for (const [a, b] of [[-9, -0.15], [3.75, 12.5]]) {
    for (let x = a; x <= b + 0.01; x += (b - a) / 4) R.bar(x, 0, 0, x, 1.25, 0, 0.07, wood, 2, 0);
    R.bar(a, 0.6, 0, b, 0.6, 0, 0.045, wood, 8, 0); R.bar(a, 1.1, 0, b, 1.1, 0, 0.045, wood, 8, 0);
  }
}

const COMBINE = [
  { body: [0.48, 0.62, 0.14], trim: [0.74, 0.74, 0.7], reel: [0.48, 0.62, 0.14], hub: [0.74, 0.74, 0.7] },   // lime and white
  { body: [0.12, 0.35, 0.11], trim: [0.78, 0.62, 0.09], reel: [0.78, 0.62, 0.09], hub: [0.78, 0.62, 0.09] }, // green and yellow
  { body: [0.6, 0.1, 0.07], trim: [0.2, 0.2, 0.2], reel: [0.6, 0.1, 0.07], hub: [0.56, 0.56, 0.54] },      // red
];
// A combine harvester, drawn 1.3 times life size: header and reel in front, the body with its
// grain tank and cab, big drive wheels at the front, small steering wheels behind, the unloading
// auger folded along its side and a cloud of chaff behind. Local x = 0 at the front axle.
function combine(R, liv, rng) {
  const { body, trim, reel } = liv;
  R.wheel(0, 0.85, 1.45, 0.85, 0.65, liv.hub); R.wheel(0, 0.85, -1.45, 0.85, 0.65, liv.hub);
  R.wheel(-4.2, 0.55, 1.25, 0.55, 0.4, liv.hub); R.wheel(-4.2, 0.55, -1.25, 0.55, 0.4, liv.hub);
  R.box(-5.4, 0.8, 0.7, 3.3, -1.1, 1.1, body, { back: mul3(trim, 0.7) });
  R.box(-3.2, 0.2, 3.3, 4.1, -1.45, 1.45, body, { top: mul3(trim, 0.9) });      // grain tank
  R.box(-5.6, -5.3, 0.6, 2.2, -1.0, 1.0, [0.15, 0.15, 0.15]);                  // straw spreader
  R.box(0.8, 2.6, 0.6, 1.7, -0.7, 0.7, body);                                   // feeder house
  // header across the front, low in the crop, and the reel over it
  R.box(2.6, 4.0, 0.25, 1.15, -3.75, 3.75, trim === COMBINE[2].trim ? [0.6, 0.1, 0.07] : trim);
  R.box(3.6, 4.15, 0.15, 0.4, -3.75, 3.75, [0.25, 0.25, 0.25]);                // cutter bar
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2, x = 3.9 + 0.55 * Math.cos(t), y = 1.65 + 0.55 * Math.sin(t);
    R.bar(x, y, -3.6, x, y, 3.6, 0.07, reel, 12);
  }
  R.bar(3.9, 1.65, -3.6, 3.9, 1.65, 3.6, 0.14, mul3(reel, 0.7), 12);              // the reel's shaft
  for (const sg of [-1, 1]) {
    // the reel's end: spokes from the shaft to each bat (a disc there reached twice the reel's size)
    for (let i = 0; i < 6; i++) {
      const t = (i / 6) * Math.PI * 2;
      R.bar(3.9, 1.65, sg * 3.6, 3.9 + 0.55 * Math.cos(t), 1.65 + 0.55 * Math.sin(t), sg * 3.6, 0.05, reel, 2);
    }
    R.bar(3.0, 1.1, sg * 3.6, 3.9, 1.65, sg * 3.6, 0.06, trim === COMBINE[2].trim ? body : trim, 2);
  }
  // cab at the front of the roof
  R.box(0.1, 1.9, 3.0, 4.3, -0.85, 0.85, GLASS, { o: 0.8, top: GLASS });
  R.box(0.0, 2.0, 4.3, 4.45, -0.95, 0.95, trim);
  R.p(0.9, 3.5, 0, 0.22, 0.3, 0.2, [0.2, 0.28, 0.44], null, MOVE.FLASH);
  R.p(0.9, 3.95, 0, 0.12, 0.14, 0.12, [0.66, 0.5, 0.4], null, MOVE.FLASH);
  R.bar(-5.0, 3.6, -1.35, 1.0, 4.0, -1.6, 0.17, body);                         // unloading auger, folded
  R.bar(-3.8, 4.1, 0.6, -3.8, 5.0, 0.6, 0.09, [0.15, 0.15, 0.15], 3);         // exhaust
  // chaff and dust behind
  for (let i = 0; i < 14; i++) {
    R.p(-6.5 - rng() * 6, 0.8 + rng() * 2.5, (rng() - 0.5) * 4, 1 + rng() * 1.2, 0.7 + rng() * 0.6, 1 + rng(), [0.66, 0.6, 0.45], null, MOVE.VAPOUR, 0.22);
  }
}

// Where the machines are: at most one site per 1000 m world cell, in a field it suits, at 40 to
// 140 m out and only where the hedges in front leave it in sight. Cached per world.
const SITE = 1000;
function siteIn(L, i) {
  if (L.sites.has(i)) return L.sites.get(i);
  const v = makeSite(L, i);
  if (L.sites.size > 2000) L.sites.clear();
  L.sites.set(i, v);
  return v;
}
// Is a point h metres above the ground at (wx, d) in sight over the row hedges in front of it?
function inSight(L, wx, d, h) {
  const T = L.terrain, yt = T.height(wx, d) + h;
  for (let k = 1; k < L.rows.length && L.rows[k].D - L.rows[k].amp < d; k++) {
    const dh = edgeD(L, k, wx);
    if (dh >= d - 1) break;
    const wx0 = Math.floor(wx / 40) * 40;
    if (noise1(wx0 / 380, L.ws + k * 29 + 3) < 0.3) continue;                 // no hedge here (rowHedges)
    const top = T.height(wx, dh) + 1.8 + 1.6 * noise1(wx0 / 900, L.ws + k) + 0.8;    // a hedge's leaves reach above its height
    if (top > 2.6 + (yt - 2.6) * dh / d) return false;
  }
  // and over the standing crops in front of it (down to the hubs of a tractor's rear wheels)
  const yc = yt + Math.max(0, 1.5 - h);
  for (let dd = 9; dd < d - 6; dd += 4) {
    const f = fieldAt(L, wx, dd);
    if (f.crop && CROP[f.crop].wall && T.height(wx, dd) + CROP[f.crop].h * 1.2 + 0.4 > 2.6 + (yc - 2.6) * dd / d) return false;
  }
  return true;
}
function makeSite(L, i) {
  const r = makeRng(hashInts(L.ws, 401, i));
  if (r() < 0.1) return null;
  for (let t = 0; t < 24; t++) {
    let wx = (i + 0.15 + 0.7 * r()) * SITE, d = 40 + 95 * r();      // the middle of the cell: sites stay 300 m apart
    const pick = r(), turn = r(), side = r() < 0.5 ? 1 : -1, liv = Math.floor(r() * 3);
    const k = rowAt(L, wx, d), j = colAt(L, k, wx, d), f = fieldInfo(L, k, j);
    if (f.wood || k + 1 >= L.rows.length || inVillage(L, wx, d)) continue;
    const xa = colEdge(L, k, j, d) + 14, xb = colEdge(L, k, j + 1, d) - 14;
    if (xb - xa < 24) continue;
    wx = clamp(wx, xa, xb);
    const e1 = edgeD(L, k + 1, wx), hw = 2.5 + 0.004 * d, e0 = edgeD(L, k, wx) + frontHw(L, k, wx, d) - hw;
    let kind = null, yaw = side < 0 ? Math.PI : 0, cut = null;
    const crop = f.crop || 0;
    if ((crop === C.WHEAT && pick < 0.4) || (crop === C.BARLEY && pick < 0.2)) {
      // a combine opening up the field: two passes cut all along the front, a third behind it
      const W = 7.5 * 1.3, all = W * (1 + Math.floor(turn * 2));
      d = e0 + hw + all + W / 2;
      if (d + W > e1 - hw) continue;
      kind = 'combine';
      const xh = wx + side * 4.3 * 1.3;
      cut = { k, j, dir: side, xh, all, pass: all + W, stub: { crop: C.STUBBLE, color: jitter(CROP[C.STUBBLE].c, r, 0.03), dir: true, phase: d - e0 } };
    } else if (crop && CROP[crop].wall && f.dir && pick < 0.6) {
      // a sprayer along a tramline (the lines run along the track in this field)
      const p0 = Math.round((d + f.phase - 1.3) / 24) * 24 - f.phase + 1.3;
      if (p0 < e0 + hw + 12 || p0 > e1 - hw - 4) continue;
      d = p0; kind = 'sprayer';
    } else if (crop === C.STUBBLE || crop === C.CUT) {
      kind = pick < 0.5 ? 'baler' : 'trailer';
      d = clamp(d, e0 + hw + 8, e1 - hw - 6);
      yaw += (turn - 0.5) * 0.8;
    } else if (crop === C.PLOUGH) {
      kind = 'plough';
      d = clamp(d, e0 + hw + 8, e1 - hw - 6);
      yaw += (turn - 0.5) * 0.3;
    } else if (pick < 0.5 && !(crop && CROP[crop].wall)) {
      // parked by the gate at the front of the field, sometimes with a trailer of bales
      kind = turn < 0.5 ? 'gate' : 'gate+trailer';
      d = e0 + 5;
      yaw += (turn - 0.5) * 0.5;
    } else continue;
    if (d < 36 || d > 160 || !inSight(L, wx, d, 1.0)) continue;
    return { i, wx, d, k, j, kind, yaw, liv, cut, seed: hashInts(L.ws, 403, i) };
  }
  return null;
}
function* sitesAround(ctx, L, margin = 60) {
  const a = Math.floor((ctx.x0 - margin - SITE) / SITE), b = Math.floor((ctx.x0 + ctx.length + margin) / SITE);
  for (let i = a; i <= b; i++) {
    const s = siteIn(L, i);
    if (s && s.wx > ctx.x0 - margin && s.wx < ctx.x0 + ctx.length + margin) yield s;
  }
}
// The strips combines have cut, for the fill and the crop walls of this chunk.
function cutsFor(ctx, L) {
  const res = [];
  for (const s of sitesAround(ctx, L, 400)) if (s.cut) res.push(s.cut);
  return res;
}
function cutDepth(q, wx) { return (wx - q.xh) * q.dir < 0 ? q.pass : q.all; }

function* machines(ctx, out, L, dLo, dHi) {
  for (const s of sitesAround(ctx, L, 40)) {
    if (s.d < dLo || s.d >= dHi) continue;
    const rng = makeRng(s.seed);
    if (s.kind === 'combine') {
      const R = rig(ctx, out, s.wx, s.d, s.yaw, 1.3);
      combine(R, COMBINE[s.liv], rng);
      yield* flush(out, R);
    } else {
      const liv = TRACTOR[s.liv];
      const f = fieldInfo(L, s.k, s.j);
      const R = rig(ctx, out, s.wx, s.d, s.yaw, 1.6);
      tractor(R, liv);
      if (s.kind === 'baler') {
        baler(R, liv);
        roundBale(R, -6.6, 0.75, 0, f.bales === 2 ? 'black' : 'straw');       // just let out of the tailgate
      } else if (s.kind === 'trailer' || s.kind === 'gate+trailer') {
        baleTrailer(R, liv, f.bales === 2 ? (rng() < 0.5 ? 'black' : 'green') : 'straw');
      } else if (s.kind === 'plough') plough(R);
      else if (s.kind === 'sprayer') sprayer(R, liv);
      if (s.kind.startsWith('gate')) {
        // the gate stands open in the gap at the front of the field
        const e = edgeD(L, s.k, s.wx + 8);
        const Gt = rig(ctx, out, s.wx + 8, e, 0.25, 1.3);
        gate(Gt);
        yield* flush(out, Gt);
      }
      yield* flush(out, R);
    }
  }
}
// A bale stack stands inside the field's front edge where it can be seen from the line, or else
// inside its back edge (behind the field, so in sight over the bales and stubble); null for neither.
function stackD(L, k, wx) {
  const e = edgeD(L, k, wx) + 4.2;
  if (e >= 30 && inSight(L, wx, e, 1.0)) return e;
  const b = edgeD(L, k + 1, wx) - 4.2;
  return b >= 30 && b < 200 && inSight(L, wx, b, 1.0) ? b : null;
}

// Bales on cut fields: rows of round bales where the baler dropped them, a stack of them by the
// front hedge, or rows of small square bales. All placed from the field's world hash.
function* fieldBales(ctx, out, L, dLo, dHi) {
  const x0 = ctx.x0 - 3, x1 = ctx.x0 + ctx.length + 3;
  for (let k = 0; k + 1 < L.rows.length; k++) {
    const q = L.rows[k], q1 = L.rows[k + 1];
    if (q.D - q.amp > Math.min(dHi, 330)) break;
    if (q1.D + q1.amp < dLo) continue;
    const a = Math.floor((x0 - 60) / q.W) - 1, b = Math.floor((x1 + 60) / q.W) + 1;
    for (let j = a; j <= b; j++) {
      const f = fieldInfo(L, k, j);
      if (!f.bales) continue;
      const dMid = (q.D + q1.D) / 2;
      const xl = colEdge(L, k, j, dMid), xr = colEdge(L, k, j + 1, dMid);
      if (xr < x0 - 20 || xl > x1 + 20) continue;
      if (inVillage(L, (xl + xr) / 2, dMid)) continue;
      const r = worldRng(ctx, 77, k, j);
      const inside = (wx, d, m) => d > 15 && rowAt(L, wx, d) === k && colAt(L, k, wx, d) === j &&
        d - edgeD(L, k, wx) > m + frontHw(L, k, wx, d) - 2.5 && edgeD(L, k + 1, wx) - d > m && wx - colEdge(L, k, j, d) > m && colEdge(L, k, j + 1, d) - wx > m;
      const kind = f.bales === 2 ? (r() < 0.6 ? 'black' : 'green') : f.crop === C.CUT ? 'hay' : 'straw';
      const busy = [];
      for (const s of sitesAround(ctx, L, 80)) if (s.k === k && s.j === j) busy.push(s);
      const want = (wx, d) => d >= dLo && d < dHi && wx >= x0 && wx < x1 && !busy.some((s) => Math.abs(wx - s.wx) < 22 && Math.abs(d - s.d) < 9);
      if (f.bales === 3) {
        // small square bales in rows along the track, every 6 to 9 m
        for (let d = q.D + 8 + r() * 6; d < Math.min(q1.D - 4, 160); d += 9 + r() * 6) {
          for (let wx = xl + 4 + r() * 6; wx < xr - 4; wx += 7 + r() * 4) {
            const ax = (r() - 0.5) * 0.5, dd = d + (r() - 0.5) * 1.5;
            if (!want(wx, dd) || !inside(wx, dd, 5)) continue;
            const R = rig(ctx, out, wx, dd, 0, 2.3);
            squareBale(R, 0, 0, ax);
            yield* flush(out, R);
          }
          if (out.due()) yield;
        }
        continue;
      }
      // a stack by the front (or back) edge, end-on to the line: a pyramid of 4-3-2-1 or 3-2-1
      if (r() < 0.55) {
        const n = r() < 0.5 ? 3 : 4, sx = lerp(xl + 12, xr - 12 - n * 2.25, r());
        const e = stackD(L, k, sx);
        if (e != null && e >= dLo && e < dHi && inside(sx, e, 2) && sx < x1 + 10 && sx + n * 2.25 > x0 - 10) {
          const R = rig(ctx, out, sx, e, 0, 1.5, ctx.terrain.height(sx, e));
          for (let row = 0; row < n; row++) for (let c = 0; c < n - row; c++) roundBale(R, (c + row * 0.5) * 1.5, 0.75 + row * 1.28, 0, kind === 'green' ? 'black' : kind);
          yield* flush(out, R);
        }
      }
      // rows where the baler dropped them
      const rowGap = 14 + 8 * r();
      for (let d = q.D + 10 + r() * 8; d < Math.min(q1.D - 5, 320); d += rowGap) {
        for (let wx = xl + 6 + r() * 20; wx < xr - 6; wx += 14 + 26 * r()) {
          const dd = d + (r() - 0.5) * 4, ax = r() * Math.PI;
          if (!want(wx, dd) || !inside(wx, dd, 4)) continue;
          const R = rig(ctx, out, wx, dd, ax, 1.5);
          roundBale(R, 0, 0.75, 0, kind);
          yield* flush(out, R);
        }
        if (out.due()) yield;
      }
    }
  }
}

// House, barn and a shed, with a tree. `wrong` > 0 nudges it for the repeating (logic) version.
function* farmstead(ctx, out, x, d, rng, scale = 1, wrong = 0) {
  const yaw = (rng() - 0.5) * 0.5 + (rng() < 0.25 ? (rng() < 0.5 ? 1 : -1) * Math.PI / 2 : 0);
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
      const yaw = spots[si][2] + (hr() < 0.2 ? (hr() < 0.5 ? 1 : -1) * Math.PI / 2 : 0);
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

  yield* fieldBales(ctx, out, L, 6.7, ctx.zFar);

  // standing crops as plants (the ground fill under them is their soil)
  const cuts = cutsFor(ctx, L);
  out.limit = Infinity;
  yield* cropPlants(ctx, out, L, 8, ctx.zFar, { cuts, power: 0.8, share: 0.6, keep: 0.25, lod0: 60, lod1: 120 });

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
  yield* fieldFill(ctx, out, L, { dNear: 6.7, dFar: ctx.zFar + 1, power: 1.5, cover: 4.5, cuts });
}

function* near(ctx, emit) {
  const out = makeOut(ctx, emit, { detailK: 1.2 });
  const L = layout(ctx);
  const cap = ctx.count * 0.62;
  out.limit = ctx.count * 0.8;
  const dz = ctx.dials || {};
  // machines and bales first: they are what this farmland is looked at for
  const cuts = cutsFor(ctx, L);
  yield* machines(ctx, out, L, ctx.zNear, ctx.zFar);
  yield* fieldBales(ctx, out, L, ctx.zNear, ctx.zFar);
  yield* rowHedges(ctx, out, L, ctx.zNear, ctx.zFar, { capAt: cap });
  yield* colHedges(ctx, out, L, ctx.zNear, ctx.zFar, 20, { capAt: cap });
  yield* lanes(ctx, out, L, ctx.zNear, ctx.zFar);
  yield* villages(ctx, out, L, ctx.zNear, ctx.zFar, { capAt: cap });
  yield* repeatingFarm(ctx, out, dz.logic || 0);
  if (out.n < cap) yield* fieldContents(ctx, out, L, ctx.zNear, ctx.zFar, 25, { woodSpacing: 8, capAt: cap });
  // standing crops as plants, out of what the ground fill would otherwise take
  out.limit = Infinity;
  yield* cropPlants(ctx, out, L, ctx.zNear, ctx.zFar, { cuts, power: 1.3, share: 0.6, keep: 0.22, lod0: 45, lod1: 110 });
  yield* fieldFill(ctx, out, L, { power: 1.5, cover: 3.2, cuts });
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

// For scripts that look for things to inspect (scripts/pass-strip.mjs needs a world x and a distance):
//   const { _debug } = await import('./src/window/biomes/downs.js');
//   _debug.layout('7', 0, 20000, 3000) -> { woods, oaks, farms, villages, flocks }
// Positions are exact for oaks, farmsteads and village churches (the same rng draws as the
// generators); woods and flocks are given by field.
export const _debug = {
  layout(seedStr, x0, x1, dMax = 3000) {
    const terrain = makeTerrain(hashString(String(seedStr)), downsBiome.terrain);
    const ctx = { terrain };
    const L = layout(ctx);
    const res = { woods: [], oaks: [], farms: [], villages: [], flocks: [], machines: [], crops: [] };
    for (let k = 0; k + 1 < L.rows.length && L.rows[k].D < dMax; k++) {
      const q = L.rows[k];
      for (let j = Math.floor(x0 / q.W) - 1; j <= Math.floor(x1 / q.W) + 1; j++) {
        const f = fieldInfo(L, k, j);
        const dMid = (q.D + L.rows[k + 1].D) / 2;
        const xl = colEdge(L, k, j, dMid), xr = colEdge(L, k, j + 1, dMid);
        if (xr < x0 || xl > x1) continue;
        if (f.crop) {
          const e = { crop: Object.keys(C).find((n) => C[n] === f.crop), x0: Math.round(xl), x1: Math.round(xr), d0: Math.round(q.D), d1: Math.round(L.rows[k + 1].D), bales: f.bales || 0 };
          if (f.bales && f.bales !== 3) {        // the same draws as fieldBales
            const r = worldRng(ctx, 77, k, j);
            if (f.bales === 2) r();
            if (r() < 0.55) { const n = r() < 0.5 ? 3 : 4, sx = lerp(xl + 12, xr - 12 - n * 2.25, r()); if (stackD(L, k, sx) != null) e.stack = { x: Math.round(sx + n * 1.1), d: Math.round(stackD(L, k, sx)), n }; }
          }
          res.crops.push(e);
        }
        if (f.wood) { res.woods.push({ x0: Math.round(xl), x1: Math.round(xr), d0: Math.round(q.D), d1: Math.round(L.rows[k + 1].D) }); continue; }
        if (dMid < 1800 && inVillage(L, (xl + xr) / 2, dMid)) continue;
        const rng = worldRng(ctx, 11, k, j);
        for (let t = 0; t < f.oaks; t++) {
          const d = lerp(q.D, L.rows[k + 1].D, 0.25 + 0.5 * rng()), wx = lerp(xl, xr, 0.15 + 0.7 * rng());
          rng(); rng();     // height and crown
          if (k > 0) res.oaks.push({ x: Math.round(wx), d: Math.round(d) });
        }
        if (f.farm) { const d = q.D + 14 + 10 * rng(), wx = lerp(xl, xr, 0.2 + 0.6 * rng()); res.farms.push({ x: Math.round(wx), d: Math.round(d) }); }
        if (f.flock) res.flocks.push({ x: Math.round((xl + xr) / 2), d: Math.round(dMid), sheep: f.flock === 1 });
      }
    }
    for (let i = Math.floor(x0 / VCELL) - 1; i <= Math.floor(x1 / VCELL) + 1; i++) {
      const v = villageIn(L, i);
      if (v && v.cx >= x0 && v.cx <= x1 && v.dc < dMax) res.villages.push({ church: { x: Math.round(v.cx), d: Math.round(v.dc + 14) }, R: Math.round(v.R), spire: v.spire });
    }
    for (let i = Math.floor(x0 / SITE) - 1; i <= Math.floor(x1 / SITE) + 1; i++) {
      const s = siteIn(L, i);
      if (s && s.wx >= x0 && s.wx <= x1) res.machines.push({ kind: s.kind, x: Math.round(s.wx), d: Math.round(s.d) });
    }
    return res;
  },
};
