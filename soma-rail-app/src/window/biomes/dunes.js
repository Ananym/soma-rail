// "Dunes": a railway across a sand sea -- the Sahara, the Rub' al Khali, the Taklamakan in spirit.
// Where "saltflat" is flat, pale and empty, this biome is about SAND and SHAPE: great dunes with
// knife-edge crests, one flank glowing and the other in shadow, wind ripples rushing past, dark
// gravel between the dunes, and now and then the green shock of an oasis with its mud-brick village.
//
// Structure (as downs.js and pinewood.js): one pure layout of WORLD x and distance, cached per world
// seed and read by every band:
//   - a dune field: four families of asymmetric ridges (trackside drifts, near dunes, the mid sand
//     sea, far ranks), each a set of world-hashed ridge segments with a gentle windward slope, a
//     sharp brink and a steep slip face, on top of the shared terrain;
//   - oases, dry wadis, black gravel plateaus (hamada) and, in some stretches, a far rock range
//     (jebel), which flatten, cut or replace the sand where they are.
// `surface()` gives height, slope and material at any world point, so the ground fill of every
// band draws the dunes, and props stand on the dunes rather than on the bare terrain. Only the
// ground fill uses the chunk's own rng; everything that must line up uses world hashes.
//
// Light: sand is shaded with its own sun direction (lower and more from the left than kit SUN, a
// late-morning desert sun) through a steep ramp between a cool shadow sand and a warm lit sand, so
// every dune has a glowing flank and a dark one and the brink between them is a crisp line.
// The dune evaluation reports which side of the brink a point is on and the slope is taken on that
// side only, so the crest is never smeared by a disc straddling it.
//
// Surreal dials (all 0 at level 0, so level 0 shows none of this):
//   scale     a dune of impossible height whose crest curls over like a breaking wave; a perfect
//             sphere of stone resting on the sand
//   topology  dunes hanging upside down from the sky; a ribbon of sand rising off a crest; a mirage
//             band at the horizon with an oasis floating in it upside down
//   logic     the same date palm (and the same caravan) repeating along the line, each a little wrong
import { hashInts, makeRng, noise1, noise2, fbm2 } from '../rng.js';
import {
  KIND, makeOut, worldSeed, worldRng, worldHash, cellsAround, stick, blob, wires, lamp, detail, treeSplats,
  jitter, mul3, mix3, shade, smooth, clamp, lerp, quatYaw, quatRoll, quatPitch, quatMul, quatUpTo, norm3, rotY, Q_ID, SUN,
} from './kit.js';
import { telegraphPole } from './saltflat.js';

const PAL = {
  ground: [0.64, 0.48, 0.33],      // mid sand: also the backdrop below the horizon
  foliage: [0.22, 0.3, 0.12],
  scrub: [0.42, 0.38, 0.24],
  rock: [0.3, 0.24, 0.21],
  ballast: [0.42, 0.38, 0.33],
};

// Colours. Natural surfaces stay <= 0.8 per channel.
const C = {
  sandLit: [0.8, 0.65, 0.44],
  sandMid: [0.67, 0.51, 0.34],
  sandShadow: [0.45, 0.33, 0.29],     // cooler: the blue of the sky in the shadow
  sandDeep: [0.33, 0.24, 0.23],
  sandFar: [0.76, 0.6, 0.5],        // far ranks: paler, pinker
  gravel: [0.4, 0.33, 0.27],
  clay: [0.5, 0.42, 0.33],
  hamada: [0.2, 0.17, 0.15],
  wadi: [0.46, 0.4, 0.33],
  ballast: [0.42, 0.38, 0.33],
  sleeper: [0.36, 0.33, 0.3],
  rockDark: [0.22, 0.18, 0.16],
  rock: [0.36, 0.28, 0.23],
  jebel: [[0.3, 0.21, 0.22], [0.25, 0.18, 0.2], [0.34, 0.24, 0.23], [0.22, 0.16, 0.19], [0.37, 0.26, 0.24]],
  palm: [0.17, 0.26, 0.1],
  palmLight: [0.3, 0.38, 0.15],
  palmDead: [0.42, 0.33, 0.2],
  trunk: [0.34, 0.26, 0.19],
  field: [[0.24, 0.46, 0.1], [0.3, 0.52, 0.12], [0.2, 0.4, 0.09], [0.36, 0.5, 0.14]],
  grove: [0.2, 0.24, 0.1],
  pool: [0.16, 0.3, 0.32],
  poolSky: [0.5, 0.6, 0.66],
  tamarisk: [0.35, 0.37, 0.28],
  acacia: [0.27, 0.29, 0.16],
  tussock: [0.56, 0.5, 0.3],
  thorn: [0.4, 0.39, 0.27],
  mud: [[0.66, 0.5, 0.34], [0.72, 0.6, 0.44], [0.6, 0.44, 0.3], [0.74, 0.66, 0.52], [0.56, 0.42, 0.3]],
  tent: [0.16, 0.12, 0.1],
  camel: [0.24, 0.18, 0.13],
  concrete: [0.62, 0.6, 0.55],
};

// Direction toward the sun for the sand: from the left, toward the camera, lower than kit SUN, so a
// right-facing slip face falls into shadow while flat sand stays bright.
const SSUN = norm3(-0.72, 0.5, 0.36);

const dials = (ctx) => ctx.dials || {};
const isNight = (ctx) => ctx.hour != null && (ctx.hour < 6.5 || ctx.hour > 19.5);

// ---------------------------------------------------------------------------------------------
// The dune field
// ---------------------------------------------------------------------------------------------
// A family is a world-wide set of ridges perpendicular to its wind. In the ground plane (wx, d) the
// downwind direction is (cos a, sin a); u runs downwind, v along the crests. Ridge k occupies
// u in [k lam, (k+1) lam) (shifted by a sinuous offset w(v)), and is cut along v into segments, each
// a dune of its own height tapering to nothing at both ends, its brink swept downwind at the ends
// (barchan horns). Profile across a dune, p metres downwind of the brink:
//   windward  -Lw < p <= 0:  h = H (1 - (-p/Lw)^1.6)   (long, gentle, convex)
//   slip face  0 < p < Ls:   h = H (1 - p/Ls)^1.1     (about 33 degrees)
// Families: trackside drifts, near dunes, the mid sand sea, far ranks.
const FAMS = [
  { lam: 30, Hmax: 0.9, segL: [12, 40], sinu: 5, sinL: 18, horn: 0.5, p: 0.4, WL: 8, SL: 5, dA: [6.5, 12], dB: [80, 160], a: [-0.2, 0.5], salt: 11 },
  { lam: 190, Hmax: 22, segL: [70, 300], sinu: 30, sinL: 140, horn: 1.4, p: 0.72, WL: 5, SL: 1.7, dA: [24, 100], dB: [420, 800], a: [-0.35, 0.45], salt: 12 },
  { lam: 1900, Hmax: 260, segL: [800, 3000], sinu: 340, sinL: 1000, horn: 0.9, p: 0.85, WL: 4.2, SL: 1.7, dA: [260, 900], dB: [5000, 8000], a: [-0.3, 0.3], salt: 13 },
  { lam: 2800, Hmax: 340, segL: [2000, 7000], sinu: 600, sinL: 2400, horn: 0.6, p: 0.9, WL: 4, SL: 1.7, dA: [3000, 6000], dB: [1e9, 1e9], a: [-0.2, 0.5], salt: 14 },
];

const worlds = new Map();
function world(ctx) {
  const ws = worldSeed(ctx);
  let W = worlds.get(ws);
  if (W) return W;
  const r = makeRng(hashInts(ws, 901));
  const fams = FAMS.map((F) => {
    const a = lerp(F.a[0], F.a[1], r());
    return { ...F, ca: Math.cos(a), sa: Math.sin(a), ang: a, seed: hashInts(ws, 910, F.salt) };
  });
  W = { ws, T: ctx.terrain, fams, oases: new Map(), wadis: new Map(), stars: new Map() };
  worlds.set(ws, W);
  if (worlds.size > 6) worlds.delete(worlds.keys().next().value);
  return W;
}

// Slow envelope along the line: some stretches are open sand sea, others gravel plain (reg) with
// scattered dunes. 0..1.
function seaAt(W, wx) { return smooth(0.22, 0.62, noise1(wx / 7000, W.ws + 21)); }

// Evaluate one family. With `lk` null, find the ridge, segment and side at (wx, d) and record them
// in LK; with `lk` given, evaluate that same ridge, segment and side (for slopes taken on one side
// of the brink). Returns the dune height (before masks).
const LK = { k: 0, j: 0, side: 0, H: 0, p: 0, Lw: 1 };
function famH(W, F, wx, d, lk) {
  const u = wx * F.ca + d * F.sa, v = -wx * F.sa + d * F.ca;
  const wv = F.sinu * (2 * noise1(v / F.sinL, F.seed) - 1) + 0.35 * F.sinu * (2 * noise1(v / (F.sinL * 0.27), F.seed + 1) - 1);
  const uu = (u + wv) / F.lam;
  const k = lk ? lk.k : Math.floor(uu);
  const hk = hashInts(F.seed, 3, k);
  const segL = F.segL[0] + (F.segL[1] - F.segL[0]) * ((hk & 1023) / 1023);
  const off = ((hk >>> 10) & 1023) / 1023;
  const tv = v / segL + off;
  const j = lk ? lk.j : Math.floor(tv);
  const t = clamp(tv - j, 0, 1);
  const hj = hashInts(F.seed, 5, k, j);
  const pres = (hj & 1023) / 1023;
  if (pres > F.p) { if (!lk) { LK.k = k; LK.j = j; LK.side = 0; LK.H = 0; } return 0; }
  const size = 0.35 + 0.65 * Math.pow(((hj >>> 10) & 1023) / 1023, 0.6);
  const Hs = Math.min(F.Hmax * size * F.env, segL * 0.2);
  const taper = famTaper(t, segL, Hs);
  const H = Hs * taper;
  // brink position inside the ridge: a little jitter per ridge, horns swept downwind at the ends
  const sc = 0.72 + 0.08 * (((hk >>> 20) & 1023) / 1023 - 0.5);
  const p = (uu - k - sc) * F.lam - hornShift(F, Hs, H, t, sc);
  // In the open sand sea the windward slope reaches back to the dune upwind (no flats between); out
  // on the gravel plains the dunes stand apart with their natural slope.
  const Lw = Math.max(0.3, F.WL * H, sc * F.lam * F.fill * (0.4 + 0.6 * taper)), Ls = Math.max(0.1, F.SL * H);
  const side = lk ? lk.side : (p > 0 ? 1 : -1);
  let h;
  if (side < 0) h = p <= -Lw ? 0 : H * (1 - Math.pow(Math.min(1, Math.max(0, -p) / Lw), 1.6));
  else h = p >= Ls ? 0 : H * Math.pow(1 - Math.max(0, p) / Ls, 1.1);
  if (!lk) { LK.k = k; LK.j = j; LK.side = side; LK.H = H; LK.p = p; LK.Lw = Lw; }
  return h;
}
// How far the brink is swept downwind at t along the crest (barchan horns), never so far that the
// slip face would run past the end of its ridge's period.
function hornShift(F, Hs, H, t, sc) {
  return Math.min(F.horn * Hs * (2 * t - 1) * (2 * t - 1) * 1.6, Math.max(0, (0.97 - sc) * F.lam - F.SL * H));
}
// Height profile along a crest (t 0..1 over the segment): the ends ramp down over at least 2.5
// dune heights with zero slope at the tips, so no face along the crest is steeper than ~31 degrees.
function famTaper(t, segL, Hs) {
  const r = clamp((2.5 * Hs) / segL, 0.18, 0.5);
  return smooth(0, r, t) * smooth(1, 1 - r, t);
}
// Family amplitude at distance d (0 near the track, so the first metres stay low and open).
function famEnv(W, F, fi, wx, d) {
  let e = smooth(F.dA[0], F.dA[1], d) * (1 - smooth(F.dB[0], F.dB[1], d));
  if (e <= 0) return 0;
  const sea = seaAt(W, wx);
  F.fill = fi === 0 ? 0 : fi === 3 ? 0.9 : sea * 0.95;
  if (fi === 1) e *= 0.3 + 0.7 * sea;
  else if (fi === 2) e *= 0.55 + 0.45 * sea;
  else if (fi === 0) e *= 0.6 + 0.4 * (1 - sea);
  return e;
}

// --- Oases: one chance per 3400 m world cell; an irregular ellipse with an abrupt edge ---------
const OC = 3400;
function oasisIn(W, i) {
  if (W.oases.has(i)) return W.oases.get(i);
  const r = makeRng(hashInts(W.ws, 931, i));
  let o = null;
  const rich = noise1(i * OC / 15000, W.ws + 932);
  if (r() < 0.22 + 0.4 * rich) {
    const cx = (i + 0.2 + 0.6 * r()) * OC;
    const dc = 85 + 1300 * Math.pow(r(), 1.5);
    const Rx = 110 + 240 * r() + 0.08 * dc, Rd = Rx * (0.42 + 0.2 * r());
    o = {
      i, cx, dc, Rx, Rd, salt: hashInts(W.ws, 933, i) & 0xffff,
      pool: r() < 0.65, poolU: (r() - 0.5) * 0.6, poolV: (r() - 0.5) * 0.5,
      village: r() < 0.8, vSide: r() < 0.5 ? -1 : 1, tower: r() < 0.55, seed: hashInts(W.ws, 934, i),
    };
  }
  if (W.oases.size > 4000) W.oases.clear();
  W.oases.set(i, o);
  return o;
}
// Normalised radius inside an oasis (1 at the edge of the green), with a ragged rim.
function oasisRho(o, wx, d) {
  const ux = (wx - o.cx) / o.Rx, uy = (d - o.dc) / o.Rd;
  const r0 = Math.hypot(ux, uy);
  if (r0 > 2.2) return r0;
  const a = Math.atan2(uy, ux);
  const rim = 0.86 + 0.26 * noise1(a * 2.2 + 10, o.salt) + 0.08 * noise1(a * 9 + 3, o.salt + 1);
  return r0 / rim;
}
// The nearest oasis at a point and its normalised radius.
const OAS = { o: null, rho: 9 };
function oasisAt(W, wx, d) {
  OAS.o = null; OAS.rho = 9;
  const i = Math.floor(wx / OC);
  for (let k = i - 1; k <= i + 1; k++) {
    const o = oasisIn(W, k);
    if (!o) continue;
    const rho = oasisRho(o, wx, d);
    if (rho < OAS.rho) { OAS.rho = rho; OAS.o = o; }
  }
  return OAS;
}

// --- Wadis: dry riverbeds running away from the line, one chance per 2600 m ------------------------
const WC = 2600;
function wadiIn(W, i) {
  if (W.wadis.has(i)) return W.wadis.get(i);
  const r = makeRng(hashInts(W.ws, 941, i));
  let w = null;
  if (r() < 0.5) {
    w = { i, x0: (i + 0.15 + 0.7 * r()) * WC, slope: (r() - 0.5) * 0.9, d1: 900 + 5000 * r(), salt: hashInts(W.ws, 942, i) & 0xffff, green: 0.3 + 0.7 * r() };
  }
  if (W.wadis.size > 4000) W.wadis.clear();
  W.wadis.set(i, w);
  return w;
}
function wadiX(w, d) { return w.x0 + w.slope * d + (50 + 0.05 * d) * (2 * noise1(d / (160 + 0.1 * d), w.salt) - 1); }
function wadiW(w, d) { return 4 + 0.012 * d; }
// Distance (in wadi half-widths) from the nearest wadi bed.
const WAD = { w: null, q: 99 };
function wadiAt(W, wx, d) {
  WAD.w = null; WAD.q = 99;
  const i = Math.floor(wx / WC);
  for (let k = i - 2; k <= i + 2; k++) {
    const w = wadiIn(W, k);
    if (!w || d > w.d1) continue;
    const q = Math.abs(wx - wadiX(w, d)) / wadiW(w, d);
    if (q < WAD.q) { WAD.q = q; WAD.w = w; }
  }
  return WAD;
}

// --- Hamada: low plateaus of black gravel breaking the sand in the mid band -----------------------
function hamadaNoise(W, wx, d) { return noise2(wx / 2600, d / 1500, W.ws + 951) * 0.8 + noise2(wx / 600, d / 400, W.ws + 952) * 0.2; }
// the sand thins well before the plateau's edge
function hamadaSoft(W, wx, d) { return smooth(0.5, 0.665, hamadaNoise(W, wx, d)) * smooth(320, 700, d) * (1 - smooth(2800, 4200, d)); }
function hamadaAt(W, wx, d) {
  if (d < 320 || d > 4200) return 0;
  const n = noise2(wx / 2600, d / 1500, W.ws + 951) * 0.8 + noise2(wx / 600, d / 400, W.ws + 952) * 0.2;
  return smooth(0.64, 0.665, n) * smooth(320, 700, d) * (1 - smooth(2800, 4200, d));
}

// --- Jebel: a carved rock range far off, in some stretches ---------------------------------------
function jebelGate(W, wx) { return smooth(0.6, 0.76, noise1(wx / 15000, W.ws + 961)); }
function jebelH(W, wx, d) {
  if (d < 5200) return 0;
  const g = jebelGate(W, wx);
  if (g <= 0) return 0;
  const ramp = smooth(5200, 7800, d);
  const n1 = 1 - Math.abs(2 * fbm2(wx / 2600, d / 2200, W.ws + 962, 3) - 1);       // main ridges and peaks
  const n2 = 1 - Math.abs(2 * fbm2(wx / 600, d / 1900, W.ws + 963, 2) - 1);        // spurs and gullies down the faces
  const n3 = noise2(wx / 190, d / 700, W.ws + 964);
  return g * ramp * (n1 * n1 * 620 + n2 * n2 * 200 + n3 * 50 - 110);
}

// --- The surface ------------------------------------------------------------------------------
// Total height at a world point. If `lock` is given (the result of a previous plain call), the
// dominant dune family is evaluated on the same ridge and side of the brink.
const SURF = { p: 0, H: 0, y: 0, base: 0, dune: 0, fam: -1, side: 0, oasis: 0, oas: null, wadi: 0, wad: null, ham: 0, jeb: 0, lk: { k: 0, j: 0, side: 0 } };
function heightAt(W, wx, d, lockFam = -1, lock = null) {
  const base = W.T.height(wx, d);
  let best = 0, bf = -1, sum = 0;
  for (let fi = 0; fi < 4; fi++) {
    const F = W.fams[fi];
    const env = famEnv(W, F, fi, wx, d);
    if (env <= 0) continue;
    F.env = env;
    const h = fi === lockFam ? famH(W, F, wx, d, lock) : famH(W, F, wx, d, null);
    if (fi === 0) { sum += h; continue; }        // drifts add to whatever is there
    if (h > best) {
      best = h; bf = fi;
      if (lockFam < 0) { SURF.lk.k = LK.k; SURF.lk.j = LK.j; SURF.lk.side = LK.side; SURF.p = LK.p; SURF.H = LK.H; }
    }
  }
  if (lockFam < 0) { SURF.fam = bf; SURF.side = bf >= 0 ? SURF.lk.side : 0; }
  // masks: oases and wadis flatten the sand; hamada replaces it with a low black plateau
  let dune = best + sum;
  const oa = d > 40 ? oasisAt(W, wx, d) : null;
  let oas = 0, wadi = 0, ham = 0;
  // (the sand is cleared over at least three dune heights, so no mask cuts a cliff into a dune)
  if (oa && oa.o) { oas = 1 - smooth(0.93, 1.0, oa.rho); dune *= smooth(0, 3 * dune + 0.5 * oa.o.Rd, (oa.rho - 1.02) * oa.o.Rd); }
  const wa = wadiAt(W, wx, d);
  if (wa.w) { wadi = 1 - smooth(0.55, 1.0, wa.q); const ww = wadiW(wa.w, d); dune *= smooth(0, 3 * dune + 2 * ww, (wa.q - 1) * ww); }
  ham = hamadaAt(W, wx, d);
  if (d > 320 && d < 4200) dune *= 1 - 0.9 * hamadaSoft(W, wx, d);
  const jeb = jebelH(W, wx, d);
  SURF.base = base; SURF.dune = dune; SURF.oasis = oas; SURF.oas = oa ? oa.o : null; SURF.wadi = wadi; SURF.wad = wa.w;
  SURF.ham = ham; SURF.jeb = jeb;
  const y = base + dune - 1.2 * wadi * smooth(10, 30, d) + 16 * ham + Math.max(0, jeb) - 0.6 * oas;
  SURF.y = y;
  return y;
}
// Full surface sample: height, slope (taken on the sampled side of any brink) and materials.
const S = { p: 0, H: 0, y: 0, gx: 0, gd: 0, n: [0, 1, 0], dune: 0, fam: -1, side: 0, oasis: 0, oas: null, wadi: 0, wad: null, ham: 0, jeb: 0, base: 0 };
function surface(W, wx, d, e = 0.5) {
  const y = heightAt(W, wx, d);
  S.y = y; S.dune = SURF.dune; S.fam = SURF.fam; S.side = SURF.side; S.oasis = SURF.oasis; S.oas = SURF.oas;
  S.wadi = SURF.wadi; S.wad = SURF.wad; S.ham = SURF.ham; S.jeb = SURF.jeb; S.base = SURF.base; S.p = SURF.p; S.H = SURF.H;
  const lf = SURF.fam, lk = { k: SURF.lk.k, j: SURF.lk.j, side: SURF.lk.side };
  // slope: step toward the side the point is on, so the difference never crosses the brink
  const y1 = heightAt(W, wx + e, d, lf, lk), y2 = heightAt(W, wx, d + e, lf, lk);
  S.gx = (y1 - y) / e; S.gd = (y2 - y) / e;
  S.n = norm3(-S.gx, 1, S.gd);
  return S;
}
// Height only (for standing props on the sand).
function surfY(W, wx, d) { return heightAt(W, wx, d); }

// ---------------------------------------------------------------------------------------------
// Ground colour
// ---------------------------------------------------------------------------------------------
// Sand: a steep ramp from cool shadow to warm light by the sand sun. `slip` faces always stay dark.
function sandLight(n, side) {
  const l = n[0] * SSUN[0] + n[1] * SSUN[1] + n[2] * SSUN[2];
  let t = clamp((l - 0.16) / 0.52, 0, 1);
  if (side > 0) t = Math.min(t, 0.3 + 0.4 * clamp(n[2] * 2, 0, 1));
  return t;
}
function sandColor(t) {
  if (t < 0.45) return mix3(C.sandDeep, C.sandShadow, t / 0.45);
  if (t < 0.72) return mix3(C.sandShadow, C.sandMid, smooth(0, 1, (t - 0.45) / 0.27));
  return mix3(C.sandMid, C.sandLit, (t - 0.72) / 0.28);
}
function groundColor(W, s, wx, d, rng, opts = {}) {
  const n = s.n;
  const t = sandLight(n, s.fam > 0 ? s.side : 0);
  let c = sandColor(t);
  // sand sheet mottling and wind streaks
  const m = noise2(wx / 90, d / 60, W.ws + 971);
  c = mul3(c, 0.94 + 0.1 * m);
  // interdune flats: gravel or cracked clay where the sand runs out, darker and greyer
  const cover = clamp(s.dune / (0.5 + 0.004 * d), 0, 1);
  const sheet = noise2(wx / 380, d / 260, W.ws + 972);
  const bare = (1 - cover) * smooth(0.42, 0.62, sheet) * smooth(14, 40, d) * (1 - 0.7 * smooth(400, 1500, d));
  if (bare > 0) {
    const clayish = noise2(wx / 160, d / 120, W.ws + 973);
    let g = mix3(C.gravel, C.clay, smooth(0.4, 0.7, clayish));
    const speck = noise2(wx / 3.1, d / 2.3, W.ws + 974);
    g = mul3(g, 0.85 + 0.25 * speck);
    g = shade(g, n[0], n[1], n[2], 0.55, 0.5);
    c = mix3(c, g, bare * 0.92);
  }
  // wadi bed: pale-grey gravel and silt, a thread of darker green-grey at the edges
  if (s.wadi > 0) c = mix3(c, mul3(C.wadi, 0.9 + 0.2 * noise2(wx / 5, d / 9, W.ws + 975)), s.wadi * 0.9);
  // hamada: black gravel plateau
  if (s.ham > 0) {
    const hc = mul3(C.hamada, 0.85 + 0.35 * noise2(wx / 40, d / 40, W.ws + 976));
    c = mix3(c, shade(hc, n[0], n[1], n[2], 0.6, 0.6), smooth(0.2, 0.8, s.ham));
  }
  // the jebel: violet-brown rock, carved by the slope; sand banked at its foot
  if (s.jeb > 5) {
    const bi = Math.floor((s.y + 60 * noise1(wx / 2500, W.ws + 977)) / 70);
    let rc = C.jebel[((bi % 5) + 5) % 5];
    const l = Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]);
    const l2 = Math.max(0, n[0] * SSUN[0] + n[1] * SSUN[1] + n[2] * SSUN[2]);
    rc = mul3(rc, 0.35 + 0.55 * l2 + 0.25 * l);
    const banked = smooth(120, 30, s.jeb) * smooth(0.25, 0.05, 1 - n[1]);
    c = mix3(rc, c, banked);
  }
  // oasis: palm-grove floor, irrigated plots and the pool
  if (s.oasis > 0 && s.oas) c = mix3(c, oasisFloor(W, s.oas, wx, d), s.oasis);
  // distance: far ranks paler and pinker
  if (d > 700) c = mix3(c, mul3(C.sandFar, 0.6 + 0.5 * t), smooth(700, 9000, d) * 0.45);
  return jitter(c, rng, opts.jit != null ? opts.jit : 0.04);
}

// The ground inside an oasis: plots in a grid aligned with the line, a pool, the grove floor.
function oasisFloor(W, o, wx, d) {
  // pool
  if (o.pool) {
    const px = o.cx + o.poolU * o.Rx, pd = o.dc + o.poolV * o.Rd;
    const pr = Math.hypot((wx - px) / (o.Rx * 0.22), (d - pd) / (o.Rd * 0.3));
    if (pr < 1) return mix3(C.pool, C.poolSky, 0.25 + 0.35 * smooth(0.5, 1, pr) + 0.2 * smooth(200, 1200, d));
    if (pr < 1.12) return [0.36, 0.3, 0.2];
  }
  const ps = 14 + 0.02 * d;                 // plot size
  const gi = Math.floor((wx + o.salt) / ps), gj = Math.floor(d / (ps * 0.8));
  const h = hashInts(o.salt, gi, gj);
  const fu = (wx + o.salt) / ps - gi, fv = d / (ps * 0.8) - gj;
  const bund = fu < 0.08 || fv < 0.1;
  if ((h & 255) < 120 && !bund) return C.field[(h >>> 8) & 3];
  return mix3(C.grove, [0.36, 0.3, 0.2], bund ? 0.6 : 0.25 * ((h >>> 12) & 3));
}

// Crest lines: a thin row of lit splats along the brink of every dune of family `fi` in the band,
// so the knife edge between the glowing flank and the shadowed one stays crisp at any budget.
// Walks each ridge along its crest coordinate v and solves for the brink, all in world terms.
function* crestLines(ctx, out, W, fi, dLo, dHi, n) {
  const F = W.fams[fi];
  const M = 40 + 0.05 * dHi;
  const xs = [ctx.x0 - M, ctx.x0 + ctx.length + M], ds = [dLo, dHi];
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const wx of xs) for (const d of ds) {
    const u = wx * F.ca + d * F.sa, v = -wx * F.sa + d * F.ca;
    umin = Math.min(umin, u); umax = Math.max(umax, u); vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
  }
  umin -= F.sinu * 1.4 + F.lam; umax += F.sinu * 1.4 + F.lam;
  const k0 = Math.floor(umin / F.lam), k1 = Math.floor(umax / F.lam);
  // spacing along the crest: about one splat per (budget-scaled) detail length at mid-band depth
  const dm = Math.sqrt(dLo * dHi);
  const ridges = Math.max(1, k1 - k0 + 1);
  const span = vmax - vmin;
  const dv = Math.max(detail(out, dm, 1.2), (span * ridges) / Math.max(50, n));
  const tg = (v) => F.sinu * (2 * noise1(v / F.sinL, F.seed) - 1) + 0.35 * F.sinu * (2 * noise1(v / (F.sinL * 0.27), F.seed + 1) - 1);
  for (let k = k0; k <= k1; k++) {
    const hk = hashInts(F.seed, 3, k);
    const segL = F.segL[0] + (F.segL[1] - F.segL[0]) * ((hk & 1023) / 1023);
    const off = ((hk >>> 10) & 1023) / 1023;
    const sc = 0.72 + 0.08 * (((hk >>> 20) & 1023) / 1023 - 0.5);
    let lastJ = null, pres = false, size = 0;
    for (let v = vmin + dv * 0.5; v < vmax; v += dv) {
      const tv = v / segL + off, j = Math.floor(tv), t = tv - j;
      if (j !== lastJ) {
        lastJ = j;
        const hj = hashInts(F.seed, 5, k, j);
        pres = (hj & 1023) / 1023 <= F.p;
        size = 0.35 + 0.65 * Math.pow(((hj >>> 10) & 1023) / 1023, 0.6);
      }
      if (!pres || t < 0.04 || t > 0.96) continue;
      // brink: p = 0  ->  u = (k + sc) lam - w(v) + horn sweep (iterate once for the envelope)
      let wx = 0, d = 0, Hs = Math.min(F.Hmax * size, segL * 0.2), H = Hs * famTaper(t, segL, Hs);
      for (let it = 0; it < 3; it++) {
        const u = (k + sc) * F.lam - tg(v) + hornShift(F, Hs, H, t, sc);
        wx = u * F.ca - v * F.sa; d = u * F.sa + v * F.ca;
        const env = famEnv(W, F, fi, wx, d);
        Hs = Math.min(F.Hmax * size * env, segL * 0.2);
        H = Hs * famTaper(t, segL, Hs);
      }
      if (d < dLo || d >= dHi || wx < ctx.x0 - 2 || wx > ctx.x0 + ctx.length + 2) continue;
      if (H < 0.6 + 0.004 * d) continue;
      const y = heightAt(W, wx + F.ca * 0.05, d + F.sa * 0.05);
      if (SURF.fam !== fi || SURF.dune < H * 0.75) continue;      // buried in a bigger dune or masked
      // direction of the crest in the ground plane (along v, bent by the sinuosity)
      const dudv = -(tg(v + 1) - tg(v - 1)) / 2;
      let ex = dudv * F.ca - F.sa, ed = dudv * F.sa + F.ca;
      const el = Math.hypot(ex, ed); ex /= el; ed /= el;
      const q = quatYaw(Math.atan2(ed, ex));
      const w = Math.max(0.05, detail(out, d, 0.55));
      let c = mix3(C.sandLit, [0.8, 0.7, 0.52], 0.25);
      if (d > 700) c = mix3(c, C.sandFar, smooth(700, 9000, d) * 0.45);
      c = jitter(c, ctx.rng, 0.03);
      out(wx - ctx.x0, y + w * 0.3, -d, dv * 0.75, w * 0.35, w, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND);
      if (out.due()) yield;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Ground fill: discs on the surface, aligned to the slope, shaded by side of the brink
// ---------------------------------------------------------------------------------------------
//   opts: n, dNear, dFar, power, cover, minR, maxR (fractions of d), color(s, wx, d, rng) override
function* fillSand(ctx, out, W, opts = {}) {
  out.limit = Infinity;
  const n = Math.floor(opts.n != null ? opts.n : out.left());
  if (n <= 0) return;
  const rng = ctx.rng;
  const dn = opts.dNear != null ? opts.dNear : ctx.zNear, df = opts.dFar != null ? opts.dFar : ctx.zFar;
  const p = opts.power != null ? opts.power : 1.4, cover = opts.cover || 3.2;
  const minR = opts.minR || 0.0015, maxR = opts.maxR || 0.05;
  const L = ctx.length;
  const a1 = 1 - p;
  const A = Math.pow(dn, a1), B = Math.pow(df, a1);
  const Z = Math.abs(a1) < 1e-6 ? Math.log(df / dn) : (B - A) / a1;
  const sample = (u) => (Math.abs(a1) < 1e-6 ? dn * Math.pow(df / dn, u) : Math.pow(A + u * (B - A), 1 / a1));
  const start = out.n;
  for (let i = 0; i < n * 1.5 && out.n - start < n; i++) {
    const u = ((i % n) + rng()) / n;
    const d = sample(u);
    const x = rng() * L, wx = ctx.x0 + x;
    const dens = (n * Math.pow(d, -p) / Z) / L;
    const r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
    const s = surface(W, wx, d, Math.max(0.25, Math.min(r * 0.5, 0.004 * d + 0.2)));
    const nn = s.n;
    // a tilted disc on the slip face just below the brink would stick up above the crest as a dark
    // fringe: leave the top of the slip face to the windward discs reaching over it
    const rr = r / Math.sqrt(Math.max(0.35, nn[1]));
    const slip = s.side > 0 && s.fam > 0 && s.dune > 0.5;
    if (slip && s.p < rr * 1.1) continue;
    const c = opts.color ? opts.color(s, wx, d, rng) : groundColor(W, s, wx, d, rng);
    const q = quatUpTo(nn[0], nn[1], nn[2]);
    const ax = slip ? 1 : 0.8 + 0.5 * rng();
    out.q(x, s.y + (opts.lift || 0), -d, rr * ax, rr * 0.1, rr * (1.8 - ax), c, 1, q, KIND.GROUND);
    if (out.due()) yield;
  }
}


// A ctx whose terrain is the sand surface, for kit emitters that stand things on the ground.
const sandCtxs = new WeakMap();
function sandCtx(ctx, W) {
  let c = sandCtxs.get(ctx);
  if (!c) { c = { ...ctx, terrain: { ...ctx.terrain, height: (wx, d) => heightAt(W, wx, d) } }; sandCtxs.set(ctx, c); }
  return c;
}
const gy = (ctx, x, d) => ctx.terrain.height(ctx.x0 + x, d);

// Rotation taking +x onto the unit vector v (for splats laid along a curve).
function quatXTo(vx, vy, vz) {
  const w = 1 + vx;
  if (w < 1e-6) return [0, 0, 1, 0];
  const l = Math.hypot(vz, vy, w);
  return [0, -vz / l, vy / l, w / l];
}
// Tone of a vertical face by its outward normal (nx, nz) in splat space: the sun-side end wall
// (facing -x) brightest, the front a step down, the far end wall clearly darker, so the corners
// read from either side as the train passes.
function wallTone(nx, nz) { return 0.6 + 0.4 * Math.max(0, -nx) + 0.25 * Math.max(0, nz) - 0.04 * Math.max(0, nx); }
const SHADE_TINT = [0.84, 0.88, 1.0];    // shaded faces lean cool

// A flat rectangle of splats: origin o, unit vectors e (along U) and f (along V), splat size s.
// colorAt(u, v) returns a colour (an array with .light set marks a light source) or null for a hole.
function* panel(out, o, e, f, U, V, s, colorAt, q, kind, rng, opacity = 1) {
  const nu = Math.max(1, Math.round(U / (s * 1.5))), nv = Math.max(1, Math.round(V / (s * 1.5)));
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = (i + 0.5 + (rng() - 0.5) * 0.25) / nu, b = (j + 0.5 + (rng() - 0.5) * 0.25) / nv;
      const c = colorAt(a * U, b * V);
      if (!c) continue;
      out.q(o[0] + e[0] * a * U + f[0] * b * V, o[1] + e[1] * a * U + f[1] * b * V, o[2] + e[2] * a * U + f[2] * b * V,
        (U / nu) * 0.62, (V / nv) * 0.62, Math.max(0.02, s * 0.12), c, opacity, q, c.light ? KIND.LIGHT : kind);
      if (out.due()) yield;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Props (the exported ones are kit candidates)
// ---------------------------------------------------------------------------------------------

// A date palm: a tall, slightly curved trunk ringed by old leaf bases and a crown of long arching
// fronds, the old ones drooping, now and then a skirt of dead fronds and bunches of dates.
//   opts: { height, y, rng, n (splats), lean, leanA, fronds, kind, wrong (0..1, the logic dial) }
export function* datePalm(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 11;
  const y0 = opts.y != null ? opts.y : gy(ctx, x, d) - 0.2;
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const wrong = opts.wrong || 0;
  const r = Math.max(0.04, detail(out, d, 1.25));
  const n = Math.max(6, Math.round(opts.n || palmSplats(out, d, H)));
  const la = opts.leanA != null ? opts.leanA : rng() * Math.PI * 2;
  const lean = (opts.lean != null ? opts.lean : 0.03 + 0.09 * rng()) + wrong * 0.25;
  const lx = Math.cos(la) * lean, ld = Math.sin(la) * lean * 0.7;
  const P = (t) => { const o = H * (0.35 * t + 0.65 * t * t); return [x + lx * o, y0 + H * t, d + ld * o]; };
  // trunk
  const rt = 0.18 + 0.012 * H;
  const nt = clamp(Math.round(n * 0.22), 2, Math.round(H / (rt * 1.3)));
  const seg = H / nt;
  for (let i = 0; i < nt; i++) {
    const t = (i + 0.5) / nt, [px, py, pd] = P(t);
    const ring = (Math.floor(t * H / 0.5) % 2) ? 0.86 : 1.06;
    const c = mul3(jitter(C.trunk, rng, 0.06), (0.8 + 0.3 * t) * (seg < 1 ? ring : 1));
    out(px, py, -pd, rt * (1.05 - 0.2 * t), seg * 0.62, rt, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    if (seg < rt * 4) {       // close up: a shaded right half
      const cs = mul3(c, 0.62);
      out(px + rt * 0.45, py, -(pd - 0.05), rt * 0.55, seg * 0.62, rt * 0.6, cs[0], cs[1], cs[2], 1, 0, 0, 0, 1, kind);
    }
  }
  if (out.due()) yield;
  // crown
  const [tx, ty, td] = P(1);
  const nf = clamp(Math.round(Math.sqrt(n - nt) * 1.25), 5, opts.fronds || 22);
  const per = Math.max(2, Math.round((n - nt) / nf));
  const green = wrong ? mix3(C.palm, [0.1, 0.22, 0.34], wrong) : C.palm;
  // the crown's dark core, so the fronds radiate from a mass, not a point
  const core = mul3(green, 0.55);
  out(tx, ty - 0.2, -td, 0.75, 0.6, 0.75, core[0], core[1], core[2], 1, 0, 0, 0, 1, kind);
  for (let i = 0; i < nf; i++) {
    const az = (i + 0.4 * rng()) / nf * Math.PI * 2 + wrong * 1.3;
    const rank = rng();
    const e = lerp(1.05, -0.55, rank);                 // upright young fronds .. drooping old ones
    const Lf = clamp(H * (0.28 + 0.08 * rng()), 2.2, 4.6) * (1 + wrong * 0.3);
    const g = 0.08 + 0.1 * rng() + 0.06 * rank;
    const dead = rank > 0.85 && rng() < 0.6;
    const base = dead ? C.palmDead : mix3(green, C.palmLight, clamp(0.6 - rank * 0.7 + 0.3 * Math.cos(az + 0.6), 0, 1));
    const ca = Math.cos(az), sa = Math.sin(az);
    for (let k = 0; k < per; k++) {
      const s = (k + 0.7) / per;
      const L = Lf * s;
      let hz = L * Math.cos(e), vt = L * Math.sin(e) - g * L * L;
      let tH = Math.cos(e), tV = Math.sin(e) - 2 * g * L;
      if (dead) { hz = 0.5 * L; vt = -L * 0.9; tH = 0.5; tV = -0.9; }
      const tl = Math.hypot(tH, tV);
      const q = quatXTo(ca * tH / tl, tV / tl, -sa * tH / tl);
      const wd = (0.32 * (1 - 0.55 * s) + r * 0.3) * (dead ? 0.6 : 1);
      const lit = 0.72 + 0.32 * clamp(-ca * 0.5 + 0.5 * (tV / tl < 0 ? 0.3 : 1) + sa * 0.2, 0, 1);
      const c = jitter(mul3(base, lit), rng, 0.08);
      out(tx + ca * hz, ty + vt, -(td + sa * hz * 0.8), Math.max(Lf / per * 0.75, r * 0.7), wd * 0.45, wd, c[0], c[1], c[2], 0.97, q[0], q[1], q[2], q[3], kind);
    }
    if (out.due()) yield;
  }
  // bunches of dates under the crown
  if (per >= 4 && rng() < 0.45) {
    for (let b = 0; b < 3; b++) {
      const az = rng() * Math.PI * 2;
      out(tx + Math.cos(az) * 0.7, ty - 0.7, -(td + Math.sin(az) * 0.5), 0.22, 0.32, 0.22, 0.56, 0.3, 0.12, 1, 0, 0, 0, 1, kind);
    }
  }
}
export function palmSplats(out, d, H) {
  const r = Math.max(0.04, detail(out, d, 1.25));
  return clamp(Math.round((H * H * 0.55) / (r * r * 2)), 7, 320 * Math.max(0.35, out.density));
}

// A flat-roofed mud-brick house. Front, both end walls and a parapet are drawn, each in its own
// tone (sun-side end brightest, front a step down, far end dark and cool), with a dark band under
// the roof edge, small dark window openings, a door and the ends of the roof beams, so its corners
// read from either side in motion. At night some windows glow.
//   opts: { w (along the track), depth, h, wall, yaw, rng, s, y, windows (true/false/'slits'),
//           door (true/false/'gate'), parapet (m), beams, lit (0..1 share of lit windows), kind }
export function* mudHouse(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const w = opts.w || 8, dep = opts.depth || 6, h = opts.h || 3.6;
  const yaw = opts.yaw || 0, q = quatYaw(yaw);
  const wall = opts.wall || C.mud[0];
  const s = opts.s || Math.max(0.1, detail(out, d, 1.0));
  const kind = opts.kind != null ? opts.kind : KIND.BUILDING;
  const par = opts.parapet != null ? opts.parapet : 0.45;
  const lit = opts.lit || 0;
  let base = opts.y;
  if (base == null) {
    base = Infinity;
    for (const [cx, cd] of [[-w / 2, -dep / 2], [w / 2, -dep / 2], [-w / 2, dep / 2], [w / 2, dep / 2], [0, 0]]) {
      const [rx, rz] = rotY(cx, cd, yaw);
      base = Math.min(base, gy(ctx, x + rx, d - rz));
    }
    base -= 0.3;
  }
  const [ex, ez] = rotY(1, 0, yaw), [fx, fz] = rotY(0, 1, yaw);
  const P = (lx, ly, lz) => [x + ex * lx + fx * lz, base + ly, -d + ez * lx + fz * lz];
  const H = h + 0.3;              // wall height above the (lowered) base
  const top = H + par;
  const wj = 0.95 + 0.1 * rng();
  // window and door layout along a face of length U: openings every ~2.6 m, at sill height
  const openings = (U, front) => {
    const list = [];
    if (opts.windows === false) return list;
    const slit = opts.windows === 'slits';
    const floors = h > 5.5 && !slit ? 2 : 1;
    const cols = Math.max(1, Math.floor(U / 2.6));
    for (let fl = 0; fl < floors; fl++) {
      for (let c = 0; c < cols; c++) {
        if (rng() < 0.3 && cols > 1) continue;
        const u = (c + 0.5) / cols * U + (rng() - 0.5) * 0.4;
        const y = slit ? H * (0.55 + 0.3 * rng()) : 0.3 + 1.5 + fl * 2.7;
        if (y + 0.6 > H - 0.4) continue;
        list.push({ u, y, w: slit ? 0.22 : 0.55, h: slit ? 0.7 : 0.6, light: rng() < lit });
      }
    }
    if (front && opts.door !== false) list.push({ u: U * (0.2 + 0.6 * rng()), y: 0.3, w: opts.door === 'gate' ? 1.6 : 0.9, h: opts.door === 'gate' ? 2.0 : 1.9, door: true });
    return list;
  };
  const win = [0.1, 0.08, 0.07], doorC = [0.2, 0.13, 0.09];
  const glow = jitter([1.0, 0.72, 0.38], rng, 0.05); glow[0] = 1.0; glow.light = true;
  const face = function* (o, e, nrm, U, open, qf) {
    const tone = wallTone(nrm[0], nrm[2]);
    let col = mul3(wall, tone * wj);
    if (nrm[0] > 0.3) col = [col[0] * SHADE_TINT[0], col[1] * SHADE_TINT[1], col[2] * SHADE_TINT[2]];
    const under = mul3(col, 0.55), parC = mul3(col, 1.04);
    yield* panel(out, o, e, [0, 1, 0], U, top, s, (u, y) => {
      if (y > H) return parC;                                     // parapet
      if (y > H - 0.32) return under;                             // shadow under the roof edge
      for (const op of open) {
        if (Math.abs(u - op.u) < op.w / 2 && y > op.y && y < op.y + op.h) return op.door ? doorC : op.light ? glow : win;
      }
      // plaster worn off in patches, darker at the foot
      const k = (y < 0.6 ? 0.86 : 1) * (0.94 + 0.12 * noise2(u * 0.7, y * 0.9, 77));
      return mul3(col, k);
    }, qf, kind, rng);
  };
  const qs = quatMul(q, quatYaw(Math.PI / 2));
  // front (toward the camera), then the two end walls
  yield* face(P(-w / 2, 0, dep / 2), [ex, 0, ez], [fx, 0, fz], w, openings(w, true), q);
  if (dep > 1) {
    yield* face(P(-w / 2, 0, -dep / 2), [fx, 0, fz], [-ex, 0, -ez], dep, openings(dep, false), qs);
    yield* face(P(w / 2, 0, dep / 2), [-fx, 0, -fz], [ex, 0, ez], dep, openings(dep, false), qs);
  }
  // the roof slab's edge, lit from above, and the ends of the roof beams under it
  const edge = mul3(wall, 1.08);
  const ne = Math.max(2, Math.round(w / (s * 1.5)));
  for (let i = 0; i < ne; i++) {
    const [px, py, pz] = P(-w / 2 + (i + 0.5) * w / ne, H + 0.02, dep / 2 + 0.06);
    out(px, py, pz, w / ne * 0.62, 0.09, 0.08, edge[0], edge[1], edge[2], 1, q[0], q[1], q[2], q[3], kind);
  }
  if (opts.beams !== false && s < 0.3) {
    for (let u = 0.4; u < w - 0.2; u += 0.7) {
      const [px, py, pz] = P(-w / 2 + u, H - 0.45, dep / 2 + 0.12);
      out(px, py, pz, 0.07, 0.07, 0.14, 0.16, 0.11, 0.08, 1, q[0], q[1], q[2], q[3], kind);
    }
  }
  // flat roof (seen only from above, but it closes the box where the ground falls away)
  if (dep > 1) {
    const roofC = mul3(wall, 0.9);
    yield* panel(out, P(-w / 2, H, dep / 2), [ex, 0, ez], [-fx, 0, -fz], w, dep, s * 1.6, () => roofC, quatMul(q, quatPitch(-Math.PI / 2)), kind, rng);
  }
  if (out.due()) yield;
}

// A slender mud-brick tower (a minaret or a watchtower) with a small lantern on top.
export function* mudTower(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const h = opts.h || 14, w = opts.w || 3;
  const y = opts.y != null ? opts.y : gy(ctx, x, d) - 0.3;
  const wall = opts.wall || C.mud[1];
  yield* mudHouse(ctx, out, x, d, { w, depth: w, h, wall, rng, y, windows: 'slits', door: false, parapet: 0.5, beams: false, lit: opts.lit, s: opts.s, kind: opts.kind });
  yield* mudHouse(ctx, out, x, d, { w: w * 0.62, depth: w * 0.62, h: 2.0, wall: mul3(wall, 1.03), rng, y: y + h + 0.6, windows: false, door: false, parapet: 0.2, beams: false, s: opts.s, kind: opts.kind });
}

// A walled compound: a mud wall round a yard with a gateway, houses inside along the back wall.
function* compound(ctx, out, x, d, rng, opts = {}) {
  const w = 22 + 14 * rng(), dep = 16 + 10 * rng();
  const wall = mul3(C.mud[Math.floor(rng() * C.mud.length)], 0.97);
  const y = Math.min(gy(ctx, x - w / 2, d), gy(ctx, x + w / 2, d), gy(ctx, x, d + dep)) - 0.3;
  const nh = 1 + Math.floor(rng() * 3);
  for (let k = 0; k < nh; k++) {
    yield* mudHouse(ctx, out, x - w / 2 + (k + 0.5) * w / nh, d + dep * 0.75, { w: w / nh - 1.5, depth: 5, h: 3.4 + 2.5 * rng(), wall: C.mud[Math.floor(rng() * C.mud.length)], rng, y, lit: opts.lit, s: opts.s });
  }
  yield* mudHouse(ctx, out, x, d, { w, depth: 0.6, h: 2.5, wall, rng, y, windows: false, door: 'gate', parapet: 0.12, beams: false, s: opts.s });
  for (const sg of [-1, 1]) yield* mudHouse(ctx, out, x + sg * (w / 2 - 0.3), d + dep / 2, { w: 0.6, depth: dep, h: 2.5, wall, rng, y, windows: false, door: false, parapet: 0.12, beams: false, s: opts.s });
}

// A camel, walking: body, hump, long legs, the neck curving forward and down to the head.
// dir +1 faces +x. Seen as a small dark silhouette.
function* camel(ctx, out, x, y0, d, dir, rng, col = C.camel, kind = KIND.OTHER) {
  const s = Math.max(0.12, detail(out, d, 1));
  const c = jitter(col, rng, 0.1), cs = mul3(c, 0.75);
  const E = (px, py, rx, ry, rz, cc) => out(x + dir * px, y0 + py, -d, rx, ry, rz, cc[0], cc[1], cc[2], 1, 0, 0, 0, 1, kind);
  E(0, 1.75, 0.8, 0.42, 0.4, c);          // body
  E(-0.05, 2.15, 0.38, 0.32, 0.3, c);     // hump
  const ph = rng();
  for (const [lx, sw] of [[-0.55, ph], [0.55, 1 - ph]]) {
    for (let t = 0; t < 3; t++) E(lx + (sw - 0.5) * 0.3 * (t / 2), 1.3 - t * 0.45, 0.07, 0.26, 0.07, t ? cs : c);
  }
  for (let t = 0; t < 4; t++) E(0.85 + t * 0.2, 1.95 + 0.12 * t - 0.03 * t * t, 0.16, 0.16, 0.13, c);
  E(1.65, 2.05, 0.24, 0.12, 0.12, c);
  if (s < 0.25 && rng() < 0.35) E(-0.05, 2.65, 0.15, 0.3, 0.15, [0.12, 0.13, 0.2]);   // a rider in indigo
  if (out.due()) yield;
}

// A black goat-hair tent: low, dark and wide, its roof sagging between the poles, the front open.
function* tent(ctx, out, x, d, rng, night) {
  const w = 8 + 5 * rng(), dep = 4 + 1.5 * rng(), H = 1.7 + 0.5 * rng();
  const y0 = gy(ctx, x, d);
  const s = Math.max(0.12, detail(out, d, 1.1));
  const nu = Math.max(3, Math.round(w / (s * 1.4))), nv = Math.max(2, Math.round(dep / (s * 1.4)));
  const poles = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const u = (i + 0.5) / nu, v = (j + 0.5) / nv;
      const ridge = 1 - 0.28 * Math.pow(Math.abs(Math.sin(u * poles * Math.PI)), 0.6);     // sags between poles
      const fall = 1 - Math.pow(Math.abs(v - 0.5) * 2, 1.6) * 0.6;
      const y = y0 + H * ridge * fall;
      const c = jitter(mul3(C.tent, 0.85 + 0.35 * (1 - v) + 0.15 * (1 - u)), rng, 0.1);
      out(x - w / 2 + u * w, y, -(d - dep / 2 + v * dep), w / nu * 0.65, 0.08, dep / nv * 0.65, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.BUILDING);
    }
    if (out.due()) yield;
  }
  // the open front: dark interior under the front edge, a side curtain at each end
  const nf = Math.max(3, Math.round(w / (s * 1.5)));
  for (let i = 0; i < nf; i++) {
    const u = (i + 0.5) / nf;
    const ridge = 1 - 0.28 * Math.pow(Math.abs(Math.sin(u * poles * Math.PI)), 0.6);
    const hh = H * ridge * 0.4;
    out(x - w / 2 + u * w, y0 + hh * 0.55, -(d - dep / 2 + 0.3), w / nf * 0.62, hh * 0.55, 0.1, 0.06, 0.05, 0.05, 1, 0, 0, 0, 1, KIND.BUILDING);
  }
  for (const sg of [-1, 1]) out(x + sg * w / 2, y0 + H * 0.3, -d, 0.12, H * 0.3, dep * 0.45, 0.13, 0.1, 0.09, 1, 0, 0, 0, 1, KIND.BUILDING);
  // at night, a fire in front of the tent
  if (night) {
    const fx = x + (rng() - 0.5) * w * 0.6, fd = d - dep / 2 - 3 - 2 * rng();
    const fy = gy(ctx, fx, fd);
    out(fx, fy + 0.25, -fd, 0.22, 0.3, 0.22, 1.0, 0.55, 0.18, 1, 0, 0, 0, 1, KIND.LIGHT);
    out(fx, fy + 0.5, -fd, 0.12, 0.22, 0.12, 1.0, 0.82, 0.45, 1, 0, 0, 0, 1, KIND.LIGHT);
    out(fx, fy + 0.4, -(fd + 0.1), 1.6, 1.1, 0.6, 1.0, 0.5, 0.2, 0.16, 0, 0, 0, 1, KIND.LIGHT);
    out(fx, fy + 0.05, -fd, 2.4, 0.05, 2.0, 1.0, 0.55, 0.25, 0.22, 0, 0, 0, 1, KIND.LIGHT);   // light on the sand
  }
}

// A well: a low stone ring, a pulley frame of two posts and a beam with a wheel, a trough.
function* well(ctx, out, x, d, rng) {
  const y0 = gy(ctx, x, d);
  const stoneC = [0.52, 0.45, 0.38];
  for (let a = 0; a < 14; a++) {
    const th = (a / 14) * Math.PI * 2, c = shade(stoneC, Math.cos(th), 0.3, Math.sin(th), 0.6, 0.5);
    out(x + Math.cos(th) * 0.9, y0 + 0.4, -(d - Math.sin(th) * 0.9), 0.3, 0.42, 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.BUILDING);
  }
  out(x, y0 + 0.78, -d, 0.6, 0.06, 0.6, 0.08, 0.07, 0.06, 1, 0, 0, 0, 1, KIND.BUILDING);
  const wood = [0.32, 0.24, 0.17];
  for (const sg of [-1, 1]) yield* stick(ctx, out, x + sg * 1.1, y0, d, 2.9, 0.09, { color: wood, kind: KIND.BUILDING, n: 8, lean: [-sg * 0.04, 0] });
  for (let t = -1.2; t <= 1.2; t += 0.2) out(x + t, y0 + 2.85, -d, 0.12, 0.08, 0.08, wood[0], wood[1], wood[2], 1, 0, 0, 0, 1, KIND.BUILDING);
  for (let a = 0; a < 10; a++) { const th = a / 10 * Math.PI * 2; out(x + Math.cos(th) * 0.32, y0 + 2.55 + Math.sin(th) * 0.32, -(d - 0.1), 0.06, 0.06, 0.04, 0.22, 0.17, 0.12, 1, 0, 0, 0, 1, KIND.BUILDING); }
  for (let t = 0; t < 5; t++) out(x, y0 + 0.9 + t * 0.35, -(d - 0.1), 0.012, 0.18, 0.012, 0.3, 0.26, 0.2, 1, 0, 0, 0, 1, KIND.BUILDING);
  for (let t = 0; t < 6; t++) out(x + 1.6 + t * 0.35, y0 + 0.25, -(d - 0.4), 0.2, 0.2, 0.3, 0.46, 0.4, 0.34, 1, 0, 0, 0, 1, KIND.BUILDING);
}

// An acacia: a thin forked trunk under a flat, wide umbrella crown.
function* acacia(ctx, out, x, d, rng, scale = 1) {
  const H = (4 + 3 * rng()) * scale, Wc = H * (1.1 + 0.4 * rng());
  const y0 = gy(ctx, x, d) - 0.1;
  const n = Math.max(4, Math.round(treeSplats(out, d, Wc) * 0.5));
  if (n > 8) {
    yield* stick(ctx, out, x, y0, d, H * 0.8, 0.1 + 0.02 * H, { color: [0.26, 0.2, 0.16], kind: KIND.TREE, n: 5, lean: [0.12, 0] });
    yield* stick(ctx, out, x, y0 + H * 0.3, d, H * 0.55, 0.07 + 0.01 * H, { color: [0.26, 0.2, 0.16], kind: KIND.TREE, n: 4, lean: [-0.3, 0.05] });
  }
  yield* blob(ctx, out, x, y0 + H * 0.9, d, Wc / 2, H * 0.12, Wc * 0.38, { n, color: jitter(C.acacia, rng, 0.1), rng, kind: KIND.TREE, inner: 0.35, clump: 0.6 });
}
// A tamarisk: a rounded, feathery grey-green tree.
function* tamarisk(ctx, out, x, d, rng, scale = 1) {
  const H = (3 + 3 * rng()) * scale, Wc = H * 1.1;
  const y0 = gy(ctx, x, d) - 0.1;
  const n = Math.max(4, Math.round(treeSplats(out, d, Wc) * 0.6));
  yield* blob(ctx, out, x, y0 + H * 0.55, d, Wc / 2, H * 0.48, Wc * 0.4, { n, color: jitter(C.tamarisk, rng, 0.1), rng, kind: KIND.TREE, inner: 0.45, clump: 0.7 });
}
// Dry grass tussock: a small pale clump of spiky blades with its shadow.
function tussock(out, x, y0, d, rng, size = 1) {
  const c0 = jitter(C.tussock, rng, 0.12);
  const nb = d < 15 ? 6 : d < 60 ? 3 : 1;
  const w = 0.35 * size;
  out(x + w * 0.5, y0 + 0.02, -(d + 0.05), w * 1.1, 0.01, w * 0.6, 0.36, 0.26, 0.2, 0.6, 0, 0, 0, 1, KIND.GROUND);
  for (let b = 0; b < nb; b++) {
    const a = (rng() - 0.5) * 1.4;
    const hb = (0.3 + 0.3 * rng()) * size;
    const q = quatRoll(a);
    const c = mul3(c0, 0.75 + 0.4 * rng());
    out(x + Math.sin(-a) * hb * 0.5 + (rng() - 0.5) * w, y0 + hb * 0.5, -(d + (rng() - 0.5) * w * 0.5), nb > 1 ? 0.03 + 0.02 * size : w * 0.6, hb * 0.5, 0.03, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.HEDGE);
  }
}
// A camel-thorn bush: low, dense, grey-green, with a dark shadow.
function* thornBush(ctx, out, x, d, rng, size = 1) {
  const y0 = gy(ctx, x, d);
  const w = (0.8 + 0.8 * rng()) * size, h = (0.35 + 0.3 * rng()) * size;
  out(x + w * 0.45, y0 + 0.02, -(d + 0.1), w * 0.8, 0.01, w * 0.45, 0.3, 0.22, 0.17, 0.7, 0, 0, 0, 1, KIND.GROUND);
  // a low dome of small grey-green twigs, so it reads as scrub rather than a soft ball
  const n = d < 15 ? 26 : d < 60 ? 8 : 3;
  yield* blob(ctx, out, x, y0 + h * 0.4, d, w / 2, h * 0.6, w * 0.4, { n, color: jitter(C.thorn, rng, 0.12), rng, kind: KIND.HEDGE, inner: 0.5, clump: 0.8, size: n > 10 ? Math.max(0.05, w * 0.09) : undefined });
}
// A stone, half sunk in the sand, with its shadow.
function stone(out, x, y0, d, r, rng, col) {
  const c = jitter(col || C.rockDark, rng, 0.2);
  const cs = mul3(c, 0.6);
  out(x + r * 0.5, y0 + 0.01, -(d + r * 0.2), r * 1.1, 0.01, r * 0.6, 0.36, 0.26, 0.2, 0.6, 0, 0, 0, 1, KIND.GROUND);
  out(x, y0 + r * 0.35, -d, r, r * 0.6, r * 0.8, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.ROCK);
  if (r > 0.12) out(x + r * 0.4, y0 + r * 0.3, -(d - r * 0.2), r * 0.6, r * 0.45, r * 0.5, cs[0], cs[1], cs[2], 1, 0, 0, 0, 1, KIND.ROCK);
}
// A dark rock outcrop: a low, jagged ridge of black rock breaking out of the sand, drawn as a
// curtain facing the line with a second, offset curtain behind for depth. Faces turned toward the
// sun (left) are lit, the others dark; the top edge is a crisp, broken skyline.
export function* outcrop(ctx, out, x, d, R, rng) {
  const s = Math.max(0.3, detail(out, d, 1.2));
  const w = R * (2 + 1.5 * rng()), h = R * (0.35 + 0.35 * rng());
  const salt = Math.floor(rng() * 1e4);
  const prof = (u) => {
    const e = Math.max(0, 1 - Math.pow(Math.abs(2 * u / w), 2.2));
    const j = 0.65 + 0.35 * noise1(u / (R * 0.35) + 3, salt) + 0.15 * (noise1(u / (R * 0.08) + 7, salt + 1) - 0.5);
    return h * Math.pow(e, 0.6) * j;
  };
  for (const [dz, k] of [[R * 0.25, 0.85], [0, 1]]) {
    const nu = Math.max(4, Math.round(w / s));
    for (let i = 0; i < nu; i++) {
      const u = -w / 2 + (i + 0.5) * w / nu;
      const H = prof(u) * k;
      if (H < s * 0.5) continue;
      const g = (prof(u + s) - prof(u - s)) / (2 * s);
      const lit = clamp(0.5 - g * 1.2, 0.08, 1);
      const y0 = gy(ctx, x + u, d + dz) - 0.5;
      const nv = Math.max(1, Math.round(H / s));
      for (let j = 0; j < nv; j++) {
        const y = (j + 0.5) * H / nv;
        const band = 0.85 + 0.25 * noise1((y + 0.3 * u) / (s * 2.5) + salt, salt + 2);
        const c = mul3(C.rockDark, (0.55 + 0.9 * lit) * band * (0.75 + 0.35 * y / H));
        out(x + u, y0 + y, -(d + dz), w / nu * 0.62, H / nv * 0.62, s * 0.4, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.ROCK);
      }
      // the lit top edge
      const ct = mul3(C.rock, 0.8 + 0.5 * lit);
      out(x + u, y0 + H - s * 0.2, -(d + dz), w / nu * 0.62, s * 0.25, s * 0.5, ct[0], ct[1], ct[2], 1, 0, 0, 0, 1, KIND.ROCK);
      if (out.due()) yield;
    }
  }
}
// A small stone hut half buried by a dune: walls up to the drift.
function* buriedHut(ctx, out, x, d, rng) {
  const y0 = gy(ctx, x, d);
  const sink = 0.8 + 0.8 * rng();
  yield* mudHouse(ctx, out, x, d, { w: 5 + 2 * rng(), depth: 4, h: 2.6, wall: [0.5, 0.44, 0.38], rng, y: y0 - sink, parapet: 0.2, beams: false, door: false });
  // the drift banked against the windward end
  const s = Math.max(0.15, detail(out, d, 1.2));
  for (let i = 0; i < 40; i++) {
    const u = rng(), v = rng();
    const px = x - 2 - u * 4, pd = d + (v - 0.5) * 5;
    const hh = (1 - u) * (2.6 - sink + 0.8) * (1 - Math.abs(v - 0.5));
    const c = jitter(mix3(C.sandMid, C.sandLit, 0.6), rng, 0.05);
    out(px, y0 + hh * 0.6, -pd, s * 2.5, s * 0.6, s * 2, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
  }
  if (out.due()) yield;
}

// Profile of a lone dune (a barchan): t 0..1 along the crest, p metres downwind of the brink.
function loneDuneH(H, p, t) {
  const Ht = H * Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.55);
  const pp = p - 0.4 * H * (2 * t - 1) * (2 * t - 1);
  if (pp <= 0) return pp <= -5 * Ht ? 0 : Ht * (1 - Math.pow(Math.min(1, -pp / (5 * Ht + 1e-6)), 1.6));
  return pp >= 1.7 * Ht ? 0 : Ht * Math.pow(1 - pp / (1.7 * Ht + 1e-6), 1.1);
}
// One asymmetric dune as a prop (for places the dune field does not reach, and for level 1): a
// long windward slope, a crisp brink and a dark slip face, built from slope-aligned discs.
//   x, d: middle of the brink; opts: { H, ang (downwind azimuth in the ground plane, 0 = +x),
//   width (along the crest), n, y, flip (hang it upside down from y), kind, rng, tint, tintAmt }
export function* dune(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.H || 20, ang = opts.ang || 0, Wd = opts.width || H * 8;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const Lw = 5 * H, Ls = 1.7 * H;
  const flip = !!opts.flip;
  const y0 = opts.y != null ? opts.y : gy(ctx, x, d);
  const n = Math.max(20, Math.round(opts.n || 400));
  const r = Math.sqrt(Wd * (Lw + Ls) * 0.6 * 3 / (Math.PI * n));
  let made = 0;
  for (let i = 0; i < n * 3 && made < n; i++) {
    const t = rng(), p = -Lw + rng() * (Lw + Ls);
    const h = loneDuneH(H, p, t);
    if (h < H * 0.02) continue;
    const pb = p - 0.4 * H * (2 * t - 1) * (2 * t - 1);
    const side = pb > 0 ? 1 : -1;
    if (side > 0 && pb < r * 0.8) continue;           // keep the brink crisp
    const v = (t - 0.5) * Wd;
    const wx = x + p * ca - v * sa, dd = d + p * sa + v * ca;
    const e = r * 0.3;
    const gu = (loneDuneH(H, p + side * e, t) - h) / (side * e), gv = (loneDuneH(H, p, t + e / Wd) - h) / e;
    const gx = gu * ca - gv * sa, gd = gu * sa + gv * ca;
    let nn = norm3(-gx, 1, gd);
    let c = sandColor(sandLight(nn, side));
    if (opts.tintAmt) c = mix3(c, opts.tint, opts.tintAmt);
    c = jitter(c, rng, 0.04);
    let y = y0 + h;
    if (flip) { y = y0 - h; nn = [nn[0], -nn[1], nn[2]]; }
    const q = quatUpTo(nn[0], Math.abs(nn[1]), nn[2]);
    out.q(wx, y, -dd, r, r * 0.1, r * 0.9, c, 1, q, opts.kind != null ? opts.kind : KIND.GROUND);
    made++;
    if (out.due()) yield;
  }
}

// A star dune: a pyramid of sand with several arms radiating from a high central peak, each arm a
// sharp-crested ridge with a lit and a shadowed flank.
//   opts: { H, arms, len (arm length, default 3.4 H), rot, n, rng, seed, kind, y, tint, tintAmt }
function starShape(H, arms, len, rot, seed) {
  const r = makeRng(seed);
  const A = [];
  for (let a = 0; a < arms; a++) {
    const th = rot + (a + 0.3 * (r() - 0.5)) / arms * Math.PI * 2;
    A.push({ c: Math.cos(th), s: Math.sin(th), L: len * (0.6 + 0.6 * r()), bend: (r() - 0.5) * 0.5 });
  }
  return { H, A };
}
// Height of a star dune at ground offset (u, v) from its peak; records the arm and flank.
const STAR = { side: 0, arm: -1 };
function starH(sh, u, v, lockArm = -1, lockSide = 0) {
  let best = 0, bs = 0, ba = -1;
  for (let a = 0; a < sh.A.length; a++) {
    if (lockArm >= 0 && a !== lockArm) continue;
    const A = sh.A[a];
    const along = u * A.c + v * A.s;
    if (along < 0) continue;
    const across = -u * A.s + v * A.c - A.bend * along * along / A.L;     // arms curve a little
    const f = along / A.L;
    if (f > 1) continue;
    const crest = sh.H * Math.pow(1 - f, 1.4);
    const side = lockSide || (across > 0 ? 1 : -1);
    const wdt = crest * (side > 0 ? 1.6 : 3.2);    // one steep flank, one gentle
    const q = Math.abs(across) / Math.max(1e-3, wdt);
    const hh = q >= 1 ? 0 : crest * Math.pow(1 - q, 1.25);
    if (hh > best) { best = hh; bs = side; ba = a; }
  }
  if (lockArm < 0) {
    const rr = Math.hypot(u, v) / (sh.H * 2.2);
    const peak = rr < 1 ? sh.H * Math.pow(1 - rr, 1.5) : 0;
    if (peak > best) { best = peak; bs = 0; ba = -1; }
  }
  STAR.side = bs; STAR.arm = ba;
  return best;
}
export function* starDune(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.H || 150, arms = opts.arms || 4, len = opts.len || H * 3.4, rot = opts.rot || 0;
  const sh = starShape(H, arms, len, rot, opts.seed || 1);
  const y0 = opts.y != null ? opts.y : gy(ctx, x, d) - 2;
  const n = Math.max(30, Math.round(opts.n || 1500));
  const R = len * 1.2;
  const r = Math.sqrt(R * R * 0.5 * 3 / (Math.PI * n));
  let made = 0;
  for (let i = 0; i < n * 4 && made < n; i++) {
    const u = (rng() * 2 - 1) * R, v = (rng() * 2 - 1) * R;
    const h = starH(sh, u, v);
    if (h < H * 0.03) continue;
    const arm = STAR.arm, side = STAR.side;
    const e = Math.max(1, r * 0.3);
    const hx = (starH(sh, u + e, v, arm, side) - h) / e, hd = (starH(sh, u, v + e, arm, side) - h) / e;
    const nn = norm3(-hx, 1, hd);
    let c = sandColor(sandLight(nn, 0));
    if (opts.tintAmt) c = mix3(c, opts.tint, opts.tintAmt);
    c = jitter(c, rng, 0.04);
    const q = quatUpTo(nn[0], nn[1], nn[2]);
    out.q(x + u, y0 + h, -(d + v), r, r * 0.1, r * 0.9, c, 1, q, opts.kind != null ? opts.kind : KIND.GROUND);
    made++;
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Railway furniture and trackside texture
// ---------------------------------------------------------------------------------------------

// The pole line: a telegraph pole every beat of world x, one cross-arm, two sagging wires.
const POLE_D = 9.2, POLE_H = 6.6;
function* poleLine(ctx, out, W) {
  const beat = ctx.beatMetres || 56;
  const first = Math.ceil(ctx.x0 / beat), last = Math.floor((ctx.x0 + ctx.length) / beat);
  // poles stand on the bare terrain (drifted sand may bury their feet), so the wires can hang
  // from a constant height
  const base = -ctx.terrain.shape.cutting - 0.3;
  for (let k = first; k <= last; k++) {
    const h = hashInts(W.ws, 801, k) / 4294967296;
    yield* telegraphPole(ctx, out, k * beat - ctx.x0, POLE_D, {
      height: POLE_H, lean: (h - 0.5) * 0.05, tilt: (h > 0.9 ? 0.4 : 0.06) * (h - 0.5), arms: 1, rng: worldRng(ctx, 802, k), color: [0.34, 0.27, 0.2],
    });
  }
  const y = base + POLE_H - 0.45 + 0.14 + 0.08;
  yield* wires(ctx, out, beat, [-0.6, 0.6].map((dd) => ({ d: POLE_D + dd, y, sag: 0.85, r: 0.014, color: [0.15, 0.13, 0.12] })), { step: 0.4 / Math.min(1, Math.sqrt(out.density)) });
}

// Sand fences: rows of dry palm fronds stuck upright in the sand, parallel to the line, in
// stretches. Close-set, so under motion blur they become continuous ochre bands.
const FENCES = [{ d: 13.5, salt: 821, gate: 0.52 }, { d: 20.5, salt: 822, gate: 0.62 }, { d: 27.5, salt: 823, gate: 0.72 }];
function* sandFences(ctx, out, W) {
  const dens = Math.min(1, Math.sqrt(out.density));
  for (const F of FENCES) {
    const step = 0.16 / dens;
    for (let x = step / 2; x < ctx.length; x += step) {
      const wx = ctx.x0 + x;
      if (noise1(wx / 1100, W.ws + F.salt) < F.gate) continue;
      const broken = noise1(wx / 23, W.ws + F.salt + 1);
      if (broken < 0.12) continue;                                 // gaps where the fence has gone
      const hh = hashInts(W.ws, F.salt, Math.floor(wx / step)) / 4294967296;
      const dd = F.d + 0.25 * Math.sin(wx / 40) + (hh - 0.5) * 0.12;
      const y0 = heightAt(W, wx, dd) - 0.15;
      const H = (1.05 + 0.35 * noise1(wx / 6, W.ws + F.salt + 2) + 0.15 * hh) * (broken < 0.25 ? 0.6 : 1);
      const lean = (hh - 0.5) * 0.25 + 0.08;
      const q = quatRoll(-lean);
      const c = mul3([0.44, 0.34, 0.22], 0.78 + 0.35 * hh);
      out(x + lean * H * 0.5, y0 + H * 0.5, -dd, 0.035, H * 0.5, 0.03, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.FENCE);
      // the frond's leafy top, ragged
      if (hh > 0.35) out(x + lean * H, y0 + H * (0.92 + 0.1 * hh), -dd, 0.09 + 0.06 * hh, 0.12, 0.04, c[0] * 0.9, c[1] * 0.88, c[2] * 0.8, 1, q[0], q[1], q[2], q[3], KIND.FENCE);
      // sand banked against the windward foot of the fence
      if (hh < 0.5) {
        const s = jitter(mix3(C.sandMid, C.sandLit, 0.7), ctx.rng, 0.04);
        out(x, y0 + 0.18, -(dd + 0.3), step * 2.2, 0.16, 0.55, s[0], s[1], s[2], 1, 0, 0, 0, 1, KIND.GROUND);
      }
      if (out.due()) yield;
    }
  }
}

// Wind ripples: close-set slanted lines in the sand, each a lit crest with a shadowed lee. Placed
// by snapping random points onto world-fixed ripple lines, so they continue across chunk borders.
function* ripples(ctx, out, W, dLo, dHi, n) {
  const rng = ctx.rng;
  const g = 0.45 + 0.35 * (W.fams[0].ang + 0.2);              // crest slant from the drift wind
  const cg = Math.cos(g), sg = Math.sin(g);
  const nx = -sg, nd = cg;                                     // normal to the ripple crests
  const q = quatYaw(g);
  const L = ctx.length;
  for (let i = 0; i < n; i++) {
    const d = dLo * Math.pow(dHi / dLo, Math.pow(rng(), 1.15));
    const x = rng() * L, wx = ctx.x0 + x;
    const sp = 0.42 + 0.028 * d;
    const wob = 0.8 * noise2(wx / 6, d / 6, W.ws + 831);
    const ph = (wx * nx + d * nd) / sp + wob;
    const k = Math.round(ph);
    const off = (k - ph) * sp;
    const px = wx + nx * off, pd = d + nd * off;
    if (pd < dLo) continue;
    const s = surface(W, px, pd, 0.3);
    if (s.oasis > 0.2 || s.wadi > 0.3 || s.ham > 0.3) continue;
    const cover = clamp(s.dune / (0.5 + 0.004 * pd), 0, 1);
    const bare = (1 - cover) * smooth(0.42, 0.62, noise2(px / 380, pd / 260, W.ws + 972)) * smooth(14, 40, pd);
    if (bare > 0.4) continue;
    const base = groundColor(W, s, px, pd, rng, { jit: 0.02 });
    const len = (0.6 + 0.9 * rng()) * (0.6 + 0.04 * pd);
    const wid = 0.03 + 0.0045 * pd;
    const lift = 0.012 + 0.0022 * pd;
    const xx = px - ctx.x0;
    const qq = quatMul(quatUpTo(s.n[0], s.n[1], s.n[2]), q);
    // the shadowed lee of the ripple, then its lit crest just upwind
    const dk = mul3(base, 0.7), lt = mul3(base, 1.13);
    out(xx, s.y + lift, -pd, len, 0.006, wid, dk[0], dk[1], dk[2], 0.9, qq[0], qq[1], qq[2], qq[3], KIND.GROUND);
    out(xx - nx * sp * 0.3, s.y + lift * 1.1, -(pd - nd * sp * 0.3), len * 0.9, 0.006, wid * 1.3, lt[0], lt[1], lt[2], 0.75, qq[0], qq[1], qq[2], qq[3], KIND.GROUND);
    if (out.due()) yield;
  }
}

// Stones, tussocks and camel-thorn beside the line, from world cells so they line up at seams.
function* trackScatter(ctx, out, W, dLo, dHi) {
  const cell = 1.6;
  for (const { i, wx0 } of cellsAround(ctx, cell, 1)) {
    const r = worldRng(ctx, 841, i);
    const stony = 0.15 + 0.6 * smooth(0.3, 0.75, noise1(wx0 / 240, W.ws + 842));
    const grassy = smooth(0.45, 0.8, noise1(wx0 / 330, W.ws + 843));
    for (let k = 0; k < 3; k++) {
      const u = r(), wx = wx0 + r() * cell, d = dLo + (dHi - dLo) * Math.pow(r(), 1.3), sz = r();
      const x = wx - ctx.x0;
      if (u < stony * 0.8) {
        const s = surface(W, wx, d, 0.3);
        if (s.oasis > 0.3) continue;
        stone(out, x, s.y, d, (0.05 + 0.22 * sz * sz) * (1 + d / 40), r, sz < 0.5 ? C.rockDark : C.rock);
      } else if (u < stony * 0.8 + 0.3 * grassy) {
        tussock(out, x, heightAt(W, wx, d), d, r, 0.8 + 1.4 * sz);
      } else if (u > 0.992) {
        yield* thornBush(sandCtx(ctx, W), out, x, Math.max(d, 7.5), r, 0.8 + 0.8 * sz);
      }
    }
    if (out.due()) yield;
  }
}

// Kilometre posts: a white concrete post with a black band and a number plate, every 1000 m.
function* kmPosts(ctx, out) {
  for (const { i, x } of cellsAround(ctx, 1000, 0)) {
    if (x < -2 || x > ctx.length + 2) continue;
    const d = 7.2, y0 = gy(ctx, x, d);
    for (let t = 0.05; t < 1.1; t += 0.14) {
      const c = t > 0.75 && t < 0.88 ? [0.1, 0.1, 0.1] : [0.74, 0.72, 0.68];
      out(x, y0 + t, -d, 0.1, 0.09, 0.08, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
      out(x + 0.06, y0 + t, -(d - 0.02), 0.05, 0.09, 0.07, c[0] * 0.7, c[1] * 0.7, c[2] * 0.7, 1, 0, 0, 0, 1, KIND.OTHER);
    }
    out(x, y0 + 0.5, -(d - 0.09), 0.08, 0.12, 0.01, 0.12, 0.12, 0.12, 1, 0, 0, 0, 1, KIND.OTHER);
    void i;
    if (out.due()) yield;
  }
}

// A concrete box culvert where a wadi passes under the line: low headwall and splayed wings, the
// dark mouth below, the dry bed of gravel and stones running away from the line.
function* culverts(ctx, out, W) {
  const i0 = Math.floor((ctx.x0 - 30) / WC), i1 = Math.floor((ctx.x0 + ctx.length + 30) / WC);
  for (let i = i0 - 1; i <= i1 + 1; i++) {
    const w = wadiIn(W, i);
    if (!w) continue;
    const xc = wadiX(w, 4.8) - ctx.x0;
    if (xc < -15 || xc > ctx.length + 15) continue;
    const r = worldRng(ctx, 851, i);
    const half = 3.2;
    const top = 0.45;
    const conc = C.concrete;
    // headwall face and coping
    for (let u = -half - 0.8; u <= half + 0.8; u += 0.22) {
      for (let y = -1.6; y < top; y += 0.22) {
        const mouth = Math.abs(u) < half - 0.4 && y < top - 0.45;
        const c = mouth ? [0.06, 0.05, 0.05] : mul3(conc, 0.85 + 0.1 * (hashInts(i, Math.round(u * 9), Math.round(y * 9)) & 255) / 255);
        out(xc + u, y, -4.9, 0.14, 0.14, 0.05, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
      }
      out(xc + u, top + 0.06, -4.95, 0.14, 0.07, 0.18, conc[0] * 1.05, conc[1] * 1.05, conc[2] * 1.05, 1, 0, 0, 0, 1, KIND.OTHER);
      if (out.due()) yield;
    }
    // splayed wing walls, the sun-side one lit, the other in shade
    for (const sg of [-1, 1]) {
      for (let t = 0; t < 1; t += 0.08) {
        const wxl = xc + sg * (half + 0.8 + t * 2.4), dd = 4.95 + t * 2.6;
        const hgt = top - t * 1.1;
        const c = mul3(conc, sg < 0 ? 1.0 : 0.62);
        for (let y = -1.2; y < hgt; y += 0.25) out(wxl, y, -dd, 0.14, 0.15, 0.2, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
      }
    }
    // stones in the bed
    for (let k = 0; k < 60; k++) {
      const d = 6 + 24 * r(), xb = wadiX(w, d) - ctx.x0 + (r() - 0.5) * wadiW(w, d) * 1.4;
      stone(out, xb, heightAt(W, xb + ctx.x0, d), d, 0.08 + 0.25 * r() * r(), r, r() < 0.5 ? C.rock : [0.5, 0.45, 0.4]);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Oases, villages and the rare things of the near band
// ---------------------------------------------------------------------------------------------
function villageOf(o) {
  if (!o.village) return null;
  return { x: o.cx + o.vSide * o.Rx * 0.42, d: o.dc - o.Rd * 0.38, R: 26 + 0.14 * o.Rx };
}
function inVillage(v, wx, d) { return v && Math.hypot((wx - v.x) / v.R, (d - v.d) / (v.R * 0.75)) < 1; }
function inPool(o, wx, d) {
  if (!o.pool) return false;
  return Math.hypot((wx - o.cx - o.poolU * o.Rx) / (o.Rx * 0.22), (d - o.dc - o.poolV * o.Rd) / (o.Rd * 0.3)) < 1.25;
}

// Palms, the village, its compound and tower for every oasis reaching into [dLo, dHi).
//   lod: 0 near (full palms, front rows in detail), 1 mid (cheap palms, block houses)
function* oases(ctx, out, W, dLo, dHi, lod, cap) {
  const sc = sandCtx(ctx, W);
  const lit = isNight(ctx) ? 0.35 : 0;
  const i0 = Math.floor((ctx.x0 - 600) / OC), i1 = Math.floor((ctx.x0 + ctx.length + 600) / OC);
  for (let i = i0; i <= i1; i++) {
    const o = oasisIn(W, i);
    if (!o) continue;
    if (o.cx + o.Rx * 1.4 < ctx.x0 - 20 || o.cx - o.Rx * 1.4 > ctx.x0 + ctx.length + 20) continue;
    if (o.dc - o.Rd * 1.4 > dHi || o.dc + o.Rd * 1.4 < dLo) continue;
    const v = villageOf(o);
    // the village: houses on a world-aligned jittered grid, then a compound and a tower
    if (v) {
      const sp = 12.5;
      const gx0 = Math.floor((Math.max(v.x - v.R, ctx.x0 - 15)) / sp), gx1 = Math.floor((Math.min(v.x + v.R, ctx.x0 + ctx.length + 15)) / sp);
      const gd0 = Math.floor((v.d - v.R) / sp), gd1 = Math.floor((v.d + v.R) / sp);
      for (let gd = gd1; gd >= gd0; gd--) {          // back rows first does not matter for splats, but keeps the cap fair
        for (let gx = gx0; gx <= gx1; gx++) {
          const hr = worldRng(ctx, 861, gx, gd);
          const wx = (gx + 0.2 + 0.6 * hr()) * sp, d = (gd + 0.2 + 0.6 * hr()) * sp;
          if (!inVillage(v, wx, d) || inPool(o, wx, d) || hr() < 0.18) continue;
          if (d < dLo || d >= dHi) continue;
          const tall = hr() < 0.25;
          yield* mudHouse(sc, out, wx - ctx.x0, d, {
            w: 6 + 5 * hr(), depth: 5 + 3 * hr(), h: tall ? 5.6 + 1.5 * hr() : 3 + 1.4 * hr(),
            wall: jitter(C.mud[Math.floor(hr() * C.mud.length)], hr, 0.04), yaw: (hr() - 0.5) * 0.12, rng: hr, lit,
          });
          if (out.n > cap) return;
        }
      }
      const cr = worldRng(ctx, 862, i);
      const cxw = v.x - o.vSide * v.R * 0.95, cd = v.d + v.R * 0.15;
      if (cd >= dLo && cd < dHi && cxw > ctx.x0 - 40 && cxw < ctx.x0 + ctx.length + 40) yield* compound(sc, out, cxw - ctx.x0, cd, cr, { lit });
      if (o.tower) {
        const tx = v.x + (cr() - 0.5) * v.R * 0.6, td = v.d + v.R * 0.5;
        if (td >= dLo && td < dHi) yield* mudTower(sc, out, tx - ctx.x0, td, { h: 14 + 8 * cr(), w: 2.8 + cr(), wall: C.mud[3], rng: cr, lit });
      }
    }
    // the palm grove: a jittered world grid inside the oasis, outside the village and the pool
    const sp = lod ? 10 : 7.5;
    const gx0 = Math.floor(Math.max(o.cx - o.Rx * 1.3, ctx.x0 - 8) / sp), gx1 = Math.floor(Math.min(o.cx + o.Rx * 1.3, ctx.x0 + ctx.length + 8) / sp);
    const gd0 = Math.floor(Math.max(o.dc - o.Rd * 1.3, dLo) / sp), gd1 = Math.floor(Math.min(o.dc + o.Rd * 1.3, dHi) / sp);
    for (let gd = gd0; gd <= gd1; gd++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const pr = worldRng(ctx, 871, gx, gd);
        const wx = (gx + 0.1 + 0.8 * pr()) * sp, d = (gd + 0.1 + 0.8 * pr()) * sp;
        if (d < dLo || d >= dHi) continue;
        const rho = oasisRho(o, wx, d);
        if (rho > 0.97 || inVillage(v, wx, d) || inPool(o, wx, d)) continue;
        if (pr() < 0.12) continue;
        const H = 9 + 9 * pr();
        // the front rows of the grove get full detail; behind them, cheaper palms
        const front = oasisRho(o, wx, d - 16) > 0.97;
        let n = palmSplats(out, d, H);
        if (!lod && !front) n = Math.max(8, n * 0.35);
        yield* datePalm(sc, out, wx - ctx.x0, d, { height: H, rng: pr, n });
        if (out.n > cap) return;
      }
    }
  }
}

// Interdune trees and tussocks (in the hollows), and the green thread along the wadis.
function* hollows(ctx, out, W, dLo, dHi, cap, wadiOnly = false) {
  const sc = sandCtx(ctx, W);
  const cell = 30;
  if (!wadiOnly) for (const { i, wx0 } of cellsAround(ctx, cell, 6)) {
    const r = worldRng(ctx, 881, i);
    for (let k = 0; k < 8; k++) {
      const wx = wx0 + r() * cell, d = dLo + (dHi - dLo) * Math.pow(r(), 1.4), u = r(), sz = r();
      const s = surface(W, wx, d, 0.5);
      if (s.oasis > 0.1 || s.dune > 1.2 || s.ham > 0.3) continue;
      const x = wx - ctx.x0;
      const green = s.wadi > 0 ? 0.6 : 0.08;
      if (u < green * 0.3) yield* (sz < 0.5 ? acacia(sc, out, x, d, r, 0.9 + 0.5 * sz) : tamarisk(sc, out, x, d, r, 0.8 + 0.5 * sz));
      else if (u < 0.45) tussock(out, x, s.y, d, r, 1 + 1.5 * sz + d / 80);
      else if (u < 0.5 + green) yield* thornBush(sc, out, x, d, r, 1 + sz + d / 120);
    }
    if (out.due()) yield;
    if (out.n > cap) return;
  }
  // wadis: a line of tamarisk and acacia along each bed
  const i0 = Math.floor((ctx.x0 - 300) / WC), i1 = Math.floor((ctx.x0 + ctx.length + 300) / WC);
  for (let i = i0 - 1; i <= i1 + 1; i++) {
    const w = wadiIn(W, i);
    if (!w) continue;
    const step = 9 + 0.02 * dLo;
    for (let d = Math.max(dLo, 30); d < Math.min(dHi, w.d1); d += step) {
      const r = worldRng(ctx, 883, i, Math.floor(d / step));
      if (r() > w.green * 0.8) continue;
      const wx = wadiX(w, d) + (r() - 0.5) * wadiW(w, d) * 2.2;
      if (wx < ctx.x0 - 10 || wx > ctx.x0 + ctx.length + 10) continue;
      yield* (r() < 0.4 ? acacia(sc, out, wx - ctx.x0, d, r, 1 + 0.4 * r()) : tamarisk(sc, out, wx - ctx.x0, d, r, 1 + 0.4 * r()));
      if (out.n > cap) return;
    }
  }
}

// The rare things: a well, a caravan crossing a crest, a tent, a half-buried hut. One chance per
// 700 m of world x; positions chosen from the dune field so camels walk the crest and tents
// stand in a hollow.
function* rareNear(ctx, out, W, dLo, dHi) {
  const sc = sandCtx(ctx, W);
  const night = isNight(ctx);
  for (const { i, wx0 } of cellsAround(ctx, 700, 80)) {
    const r = worldRng(ctx, 891, i);
    if (r() > 0.6) continue;
    const type = r();
    // candidate spots: the highest for a caravan, the lowest for the rest
    let best = null, bv = type < 0.3 ? -1 : 1e9;
    for (let k = 0; k < 14; k++) {
      const wx = wx0 + 100 + r() * 500, d = 60 + 200 * r();
      const s = surface(W, wx, d, 0.5);
      if (s.oasis > 0 || s.wadi > 0.2) continue;
      const v = s.dune;
      if (type < 0.3 ? v > bv : v < bv) { bv = v; best = [wx, d, s.fam]; }
    }
    if (!best) continue;
    const [wx, d] = best;
    if (d < dLo || d >= dHi) continue;
    const x = wx - ctx.x0;
    if (type < 0.3) {
      if (bv < 3) continue;
      yield* caravan(ctx, out, W, wx, d, r, 5 + Math.floor(r() * 5));
    } else if (type < 0.55) yield* tent(sc, out, x, d, r, night);
    else if (type < 0.8) yield* well(sc, out, x, d, r);
    else yield* buriedHut(sc, out, x, d, r);
  }
}
// A caravan of camels in single file along the crest of a near dune.
function* caravan(ctx, out, W, wx, d, r, n, opts = {}) {
  const F = W.fams[1];
  const cx = -F.sa, cd = F.ca;                   // along the crests
  const dir = cx >= 0 ? 1 : -1;
  for (let c = 0; c < n; c++) {
    let px = wx - dir * cx * c * 3.6, pd = d - dir * cd * c * 3.6;
    // keep to the top: step toward the higher neighbour a few times
    for (let it = 0; it < 3; it++) {
      const h0 = heightAt(W, px, pd), h1 = heightAt(W, px + F.ca * 2, pd + F.sa * 2), h2 = heightAt(W, px - F.ca * 2, pd - F.sa * 2);
      if (h1 > h0 && h1 >= h2) { px += F.ca * 2; pd += F.sa * 2; } else if (h2 > h0) { px -= F.ca * 2; pd -= F.sa * 2; } else break;
    }
    const y = heightAt(W, px, pd) - 0.15;
    yield* camel(ctx, out, px - ctx.x0, y, pd, dir * (opts.flipOne === c ? -1 : 1), r, opts.color, opts.kind);
  }
}

// ---------------------------------------------------------------------------------------------
// Mid-band objects: star dunes, outcrops
// ---------------------------------------------------------------------------------------------
const STC = 5200;
function starIn(W, i) {
  if (W.stars.has(i)) return W.stars.get(i);
  const r = makeRng(hashInts(W.ws, 951, i));
  let s = null;
  if (r() < 0.42) s = { x: (i + 0.2 + 0.6 * r()) * STC, d: 1200 + 1500 * r(), H: 120 + 110 * r(), arms: 3 + Math.floor(r() * 3), rot: r() * 6.28, seed: hashInts(W.ws, 952, i) };
  if (W.stars.size > 2000) W.stars.clear();
  W.stars.set(i, s);
  return s;
}
function* starDunes(ctx, out, W) {
  const i0 = Math.floor((ctx.x0 - 1500) / STC), i1 = Math.floor((ctx.x0 + ctx.length + 1500) / STC);
  for (let i = i0; i <= i1; i++) {
    const s = starIn(W, i);
    if (!s) continue;
    if (s.x + s.H * 4.5 < ctx.x0 || s.x - s.H * 4.5 > ctx.x0 + ctx.length) continue;
    const y = W.T.height(s.x, s.d) - 3;
    yield* starDune(ctx, out, s.x - ctx.x0, s.d, { H: s.H, arms: s.arms, rot: s.rot, seed: s.seed, y, rng: worldRng(ctx, 953, i, ctx.index), n: Math.round(2600 * out.density) });
  }
}
function* outcrops(ctx, out, W, dLo, dHi) {
  for (const { i, wx0 } of cellsAround(ctx, 450, 80)) {
    const r = worldRng(ctx, 961, i);
    const wx = wx0 + r() * 450, d = dLo + (dHi - dLo) * Math.pow(r(), 1.5);
    const ham = hamadaAt(W, wx, d);
    if (r() > 0.12 + 0.8 * ham) continue;
    const s = surface(W, wx, d, 2);
    if (s.oasis > 0 || s.dune > 8) continue;
    yield* outcrop(sandCtx(ctx, W), out, wx - ctx.x0, d, 12 + 30 * r(), r);
  }
}

// ---------------------------------------------------------------------------------------------
// Level 1
// ---------------------------------------------------------------------------------------------

// An `out` that mirrors everything about a horizontal plane at y = ym (for things hanging upside
// down): positions flip and so do the splats' orientations.
function mirrorOut(out, ym, kind = KIND.SURREAL) {
  const m = (x, y, z, sx, sy, sz, r, g, b, o = 1, qx = 0, qy = 0, qz = 0, qw = 1) => out(x, 2 * ym - y, z, sx, sy, sz, r, g, b, o, -qx, qy, -qz, qw, kind);
  m.q = (x, y, z, sx, sy, sz, c, o, q, k) => m(x, y, z, sx, sy, sz, c[0], c[1], c[2], o, q ? q[0] : 0, q ? q[1] : 0, q ? q[2] : 0, q ? q[3] : 1, k);
  m.due = out.due; m.left = out.left; m.density = out.density; m.detailK = out.detailK; m.ctx = out.ctx;
  Object.defineProperty(m, 'n', { get: () => out.n });
  return m;
}

// Scale: a dune of impossible height whose crest curls over toward the line like a breaking wave.
// Its cross-section is a fixed path (s toward the camera, y up, in units of its height): the
// concave face in the lip's shadow, the dark barrel, the underside of the lip, the lit lip and
// crest, then the back slope. The path is swept along x, the curl peeling smaller toward one end.
const WAVE = [
  // s, y, light (0 deep shadow .. 1 full sun)
  [0.75, 0.0, 0.45], [0.42, 0.22, 0.32], [0.18, 0.42, 0.12], [0.06, 0.58, 0.03], [0.12, 0.74, 0.04],
  [0.32, 0.8, 0.1], [0.5, 0.72, 0.3], [0.58, 0.58, 0.72], [0.63, 0.7, 0.88], [0.56, 0.84, 0.96],
  [0.3, 0.97, 1.0], [0.0, 1.0, 0.95], [-0.6, 0.72, 0.8],
];
const WAVE_LEN = (() => { let L = 0; for (let i = 1; i < WAVE.length; i++) L += Math.hypot(WAVE[i][0] - WAVE[i - 1][0], WAVE[i][1] - WAVE[i - 1][1]); return L; })();
function wavePoint(a) {
  let acc = 0;
  for (let i = 1; i < WAVE.length; i++) {
    const A = WAVE[i - 1], B = WAVE[i], l = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (acc + l >= a * WAVE_LEN || i === WAVE.length - 1) {
      const t = clamp((a * WAVE_LEN - acc) / l, 0, 1);
      return [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)];
    }
    acc += l;
  }
  return WAVE[WAVE.length - 1];
}
function* waveDune(ctx, out, W, amount) {
  const cell = 9000;
  for (const { i, wx0 } of cellsAround(ctx, cell, 2500)) {
    const r = worldRng(ctx, 971, i);
    if (r() > 0.75 * amount) continue;
    const cx = wx0 + 2000 + r() * (cell - 4000), d0 = 1900 + 700 * r();
    const H = (380 + 300 * r()) * (0.6 + 0.4 * amount), len = 2400 + 1200 * r();
    const peel = r() < 0.5 ? 1 : -1;
    const th = peel * (0.3 + 0.25 * r());            // the crest runs a little across the view
    const ct = Math.cos(th), st = Math.sin(th);
    const xa = Math.max(cx - len / 2 * ct - H, ctx.x0 - 5), xb = Math.min(cx + len / 2 * ct + H, ctx.x0 + ctx.length + 5);
    if (xb <= xa) continue;
    const rr = worldRng(ctx, 972, i, ctx.index);
    const n = Math.round(7 * out.density * amount * (xb - xa));
    const sz = Math.max(3, Math.sqrt((xb - xa) * H * WAVE_LEN / n) * 0.75);
    const base = W.T.height(cx, d0) - 4;
    for (let k = 0; k < n; k++) {
      const along = (xa + rr() * (xb - xa) - cx) / ct;
      const f = along / len + 0.5;
      if (f < 0 || f > 1) { rr(); continue; }
      const taper = smooth(0, 0.18, f) * smooth(1, 0.82, f);
      const curl = 0.45 + 0.55 * smooth(0, 1, peel > 0 ? f : 1 - f);       // the curl peels along it
      const Hh = H * taper;
      let sv, yv, light, o = 1, ss = sz;
      if (rr() < 0.12) {
        // sand pouring off the lip into the hollow, pale and thin
        const fall = rr();
        sv = 0.58 + 0.06 * (rr() - 0.5) - 0.1 * fall; yv = 0.6 - 0.32 * fall; light = 0.95; o = 0.35 * (1 - fall) * curl; ss = sz * 1.4;
      } else {
        const [s0, y0, l0] = wavePoint(rr());
        // blend the curl toward a plain steep dune where it has not yet broken
        sv = lerp(Math.min(s0, 0.6 - 0.6 * y0), s0, curl); yv = y0;
        light = lerp(Math.max(l0, 0.55), l0, curl);
      }
      let c = sandColor(clamp(light + 0.06 * (rr() - 0.5), 0, 1));
      c = mix3(c, C.sandFar, 0.2);
      const wx = cx + along * ct + sv * Hh * st, dd = d0 + along * st - sv * Hh * ct;
      out(wx - ctx.x0, base + yv * Hh, -dd, ss, ss * 0.8, ss * 0.5, c[0], c[1], c[2], o, 0, 0, 0, 1, KIND.SURREAL);
      if (out.due()) yield;
    }
  }
}
// Scale: a perfect sphere of dark stone resting on the sand, and its shadow.
function* stoneSphere(ctx, out, W, amount) {
  for (const { i, wx0 } of cellsAround(ctx, 2600, 40)) {
    const r = worldRng(ctx, 975, i);
    if (r() > 0.55 * amount) continue;
    const wx = wx0 + r() * 2600, d = 90 + 160 * r(), R = 7 + 9 * r() * amount;
    const x = wx - ctx.x0;
    if (x < -R - 5 || x > ctx.length + R + 5) continue;
    const y0 = heightAt(W, wx, d) - R * 0.12;
    const rr = worldRng(ctx, 976, i);
    const n = Math.round(900 * Math.sqrt(out.density));
    const s = Math.sqrt(4 * Math.PI * R * R / n) * 0.8;
    const col = [0.2, 0.17, 0.17];
    for (let k = 0; k < n; k++) {
      let ux = rr() * 2 - 1, uy = rr() * 2 - 1, uz = rr() * 2 - 1;
      const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
      if (uz < 0) uz = -uz;
      const lt = Math.max(0, ux * SUN[0] + uy * SUN[1] + uz * SUN[2]);
      const spec = Math.pow(lt, 18) * 0.5;
      const c = [col[0] * (0.45 + 0.9 * lt) + spec, col[1] * (0.45 + 0.9 * lt) + spec, col[2] * (0.5 + 0.9 * lt) + spec];
      out(x + ux * R, y0 + R + uy * R, -(d - uz * R), s, s, s * 0.4, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.SURREAL);
      if (out.due()) yield;
    }
    for (let k = 0; k < 30; k++) {
      const a = rr() * Math.PI * 2, rd = Math.sqrt(rr()) * R * 1.3;
      const px = wx + R * 0.7 + Math.cos(a) * rd * 1.3, pd = d + R * 0.3 + Math.sin(a) * rd * 0.8;
      out(px - ctx.x0, heightAt(W, px, pd) + 0.15, -pd, R * 0.35, 0.05, R * 0.3, 0.36, 0.26, 0.22, 0.8, 0, 0, 0, 1, KIND.SURREAL);
    }
  }
}
// Topology: dunes hanging upside down from the sky, far off.
function* skyDunes(ctx, out, W, amount) {
  for (const { i, wx0 } of cellsAround(ctx, 6500, 2500)) {
    const r = worldRng(ctx, 981, i);
    if (r() > 0.7 * amount) continue;
    const wx = wx0 + r() * 6500, d = 3600 + 2500 * r(), H = 260 + 220 * r();
    const y = W.T.height(wx, d) + 520 + 500 * r() * amount;
    yield* dune(ctx, out, wx - ctx.x0, d, { H, ang: (r() - 0.5) * 0.6, width: H * 9, y, flip: true, kind: KIND.SURREAL, rng: worldRng(ctx, 982, i, ctx.index), n: Math.round(1100 * out.density), tint: [0.7, 0.66, 0.72], tintAmt: 0.25 });
  }
}
// Topology: a ribbon of sand streaming off a crest and rising into the sky in a slow spiral.
function* sandRibbon(ctx, out, W, amount) {
  for (const { i, wx0 } of cellsAround(ctx, 5000, 700)) {
    const r = worldRng(ctx, 985, i);
    if (r() > 0.6 * amount) continue;
    // start on the highest point among a few candidates in the mid sand sea
    let bx = 0, bd = 0, by = -1e9;
    for (let k = 0; k < 10; k++) {
      const wx = wx0 + 500 + r() * 4000, d = 700 + 1300 * r();
      const y = heightAt(W, wx, d);
      if (y > by) { by = y; bx = wx; bd = d; }
    }
    const H = 500 + 500 * amount, n = Math.round(1800 * out.density * amount);
    const rr = worldRng(ctx, 986, i, ctx.index);
    for (let k = 0; k < n; k++) {
      const t = rr();
      const a = t * 4.2;
      const px = bx + 260 * t * t * 3 + Math.sin(a) * 120 * t, pd = bd + Math.cos(a) * 90 * t;
      const py = by + H * Math.pow(t, 0.8);
      const w = 25 + 110 * t;
      const x = px - ctx.x0 + (rr() - 0.5) * w;
      const c = mul3(mix3(C.sandLit, C.sandFar, 0.3 + 0.4 * t), 0.8 + 0.3 * rr());
      out(x, py + (rr() - 0.5) * w * 0.3, -pd, 6 + 14 * t, 3 + 6 * t, 6 + 10 * t, c[0], c[1], c[2], 0.6 - 0.3 * t, 0, 0, 0, 1, KIND.SURREAL);
      if (out.due()) yield;
    }
  }
}
// Topology: a mirage band low on the horizon, pale and sky-coloured, with an oasis floating in it
// upside down.
function* mirage(ctx, out, W, amount) {
  const gate = smooth(0.3, 0.5, noise1(ctx.x0 / 9000, W.ws + 991)) * amount;
  if (gate <= 0) return;
  const rng = ctx.rng;
  const n = Math.round(2200 * out.density * gate);
  for (let k = 0; k < n; k++) {
    const d = 5500 + 5000 * rng(), x = rng() * ctx.length;
    const y = W.T.height(ctx.x0 + x, d) + 20 + 70 * rng() * rng();
    const c = mix3([0.66, 0.72, 0.8], [0.78, 0.72, 0.62], rng() * 0.4);
    out(x, y, -d, 60 + 80 * rng(), 4 + 10 * rng(), 40, c[0], c[1], c[2], 0.5, 0, 0, 0, 1, KIND.SURREAL);
    if (out.due()) yield;
  }
  // the floating oasis: palms upside down in the band, with a line of green
  for (const { i, wx0 } of cellsAround(ctx, 4000, 300)) {
    const r = worldRng(ctx, 992, i);
    if (r() > 0.7 * gate) continue;
    const wx = wx0 + r() * 4000, d = 6500 + 2500 * r();
    const ym = W.T.height(wx, d) + 95;
    const mo = mirrorOut(out, ym);
    const np = 6 + Math.floor(r() * 8);
    for (let p = 0; p < np; p++) {
      const px = wx + (r() - 0.5) * 380;
      yield* datePalm(ctx, mo, px - ctx.x0, d + (r() - 0.5) * 80, { height: 34 + 20 * r(), y: ym - 1, rng: r, n: 14, kind: KIND.SURREAL });
    }
    for (let k = 0; k < 40; k++) {
      const px = wx + (r() - 0.5) * 460;
      out(px - ctx.x0, ym + 2 + r() * 4, -(d + (r() - 0.5) * 60), 20, 4, 20, 0.2, 0.38, 0.14, 0.9, 0, 0, 0, 1, KIND.SURREAL);
    }
  }
}
// Logic: the same palm repeating along the line at the same distance, each copy a little more
// wrong (leaning, its crown turning, its green drifting to blue).
function* repeatingPalm(ctx, out, W, logic) {
  const P = 380;
  for (const { i, wx0 } of cellsAround(ctx, P, 20)) {
    if (noise1(wx0 / 3000, W.ws + 995) > 0.25 + logic * 1.6) continue;
    const wrong = (((i % 5) + 5) % 5) / 4;
    const d = 58;
    yield* datePalm(sandCtx(ctx, W), out, wx0 + P * 0.5 - ctx.x0, d, { height: 13 + 2 * wrong, rng: worldRng(ctx, 996), leanA: 0.4, lean: 0.05, wrong: wrong * Math.min(1, logic * 2.5), kind: KIND.SURREAL, n: palmSplats(out, d, 13) });
  }
}
// Logic: the same caravan crossing the same way every 900 m, one camel turned the wrong way.
function* repeatingCaravan(ctx, out, W, logic) {
  const P = 900;
  for (const { i, wx0 } of cellsAround(ctx, P, 40)) {
    if (noise1(wx0 / 4200, W.ws + 997) > 0.2 + logic * 1.5) continue;
    const r = worldRng(ctx, 998);
    const n = 7;
    const flip = ((i % 7) + 7) % 7;
    yield* caravan(ctx, out, W, wx0 + P * 0.5, 120, r, n, { flipOne: flip, kind: KIND.SURREAL });
  }
}

// ---------------------------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------------------------
function* trackside(ctx, emit) {
  const out = makeOut(ctx, emit, { zMargin: 1, detailK: 1.2 });
  const W = world(ctx);
  const N = ctx.count;
  // world-aligned lines first, so a cap never cuts one at a chunk border. At small budgets props
  // and ripples get a smaller share, so the sand stays opaque under motion blur.
  const dk = Math.min(1, out.density);
  out.limit = N * (0.3 + 0.2 * dk);
  yield* poleLine(ctx, out, W);
  yield* sandFences(ctx, out, W);
  yield* kmPosts(ctx, out);
  yield* culverts(ctx, out, W);
  yield* trackScatter(ctx, out, W, 6, 30);
  // trees by the line only where a wadi brings water
  yield* hollows(ctx, out, W, 12, 30, N * 0.55, true);
  out.limit = N * (0.4 + 0.3 * dk);
  yield* ripples(ctx, out, W, 5.6, 30, Math.round(N * 0.11 * dk));
  // ground: ballast and cess (below the window), then the sand
  const rest = out.left();
  yield* fillSand(ctx, out, W, {
    n: Math.round(rest * 0.03), dNear: 2.5, dFar: 4.4, power: 0, cover: 3.5,
    color: (s, wx, d, rng) => (d > 3.4 + 1.2 * smooth(0.45, 0.8, noise1(wx / 5, W.ws + 5)) ? jitter(C.sandMid, rng, 0.08) : jitter(C.ballast, rng, 0.25)),
  });
  yield* fillSand(ctx, out, W, {
    n: Math.round(rest * 0.06), dNear: 4.4, dFar: 5.8, power: 0, cover: 4,
    color: (s, wx, d, rng) => jitter(mix3([0.56, 0.46, 0.35], C.sandMid, noise2(wx / 2, d, W.ws + 6)), rng, 0.12),
  });
  yield* fillSand(ctx, out, W, { dNear: 5.6, dFar: ctx.zFar + 1, power: 1.25, cover: 5, maxR: 0.035 });
}

function* near(ctx, emit) {
  const out = makeOut(ctx, emit, { detailK: 1.2 });
  const W = world(ctx);
  const N = ctx.count;
  const dz = dials(ctx);
  out.limit = N * 0.62;
  yield* oases(ctx, out, W, ctx.zNear, ctx.zFar, 0, N * 0.45);
  yield* rareNear(ctx, out, W, ctx.zNear, ctx.zFar);
  if ((dz.logic || 0) > 0) { yield* repeatingPalm(ctx, out, W, dz.logic); yield* repeatingCaravan(ctx, out, W, dz.logic); }
  if ((dz.scale || 0) > 0) yield* stoneSphere(ctx, out, W, dz.scale);
  yield* hollows(ctx, out, W, ctx.zNear, ctx.zFar, N * 0.58);
  out.limit = N * 0.72;
  yield* crestLines(ctx, out, W, 1, ctx.zNear, ctx.zFar, N * 0.04);
  yield* ripples(ctx, out, W, ctx.zNear, 75, Math.round(N * 0.06));
  yield* fillSand(ctx, out, W, { power: 1.45, cover: 3.2, maxR: 0.03 });
}

function* mid(ctx, emit) {
  const out = makeOut(ctx, emit, { detailK: 1.6 });
  const W = world(ctx);
  const N = ctx.count;
  const dz = dials(ctx);
  out.limit = N * 0.6;
  yield* starDunes(ctx, out, W);
  yield* oases(ctx, out, W, ctx.zNear, ctx.zFar, 1, N * 0.45);
  yield* outcrops(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* hollows(ctx, out, W, ctx.zNear, 1400, N * 0.5);
  if ((dz.scale || 0) > 0) yield* waveDune(ctx, out, W, dz.scale);
  if ((dz.topology || 0) > 0) yield* sandRibbon(ctx, out, W, dz.topology);
  out.limit = N * 0.72;
  yield* crestLines(ctx, out, W, 1, ctx.zNear, 900, N * 0.03);
  yield* crestLines(ctx, out, W, 2, ctx.zNear, ctx.zFar, N * 0.06);
  yield* fillSand(ctx, out, W, { power: 1.25, cover: 3.0, maxR: 0.03 });
}

function* far(ctx, emit) {
  const out = makeOut(ctx, emit);
  const W = world(ctx);
  const N = ctx.count;
  const dz = dials(ctx);
  out.limit = N * 0.5;
  if ((dz.topology || 0) > 0) { yield* skyDunes(ctx, out, W, dz.topology); yield* mirage(ctx, out, W, dz.topology); }
  out.limit = N * 0.62;
  yield* crestLines(ctx, out, W, 2, ctx.zNear, 8000, N * 0.04);
  yield* crestLines(ctx, out, W, 3, ctx.zNear, ctx.zFar, N * 0.05);
  yield* fillSand(ctx, out, W, { power: 1.0, cover: 2.6, maxR: 0.03 });
}

export const dunesBiome = {
  name: 'dunes',
  palette: PAL,
  // Gentle base terrain: the dune field carries the relief. The rock range far off is drawn by the
  // biome (jebelH) so it can be gated to some stretches and carved.
  terrain: { cutting: 0.8, roll: 4, rollScale: 260, rise: 0.02, hills: 70, hillScale: 1800, mountains: 0, mountainScale: 9000, mountainStart: 7000 },
  hazeDist: 9000,
  generators: { trackside, near, mid, far },
};

export const _debug = { world, surface, heightAt, oasisIn, wadiIn, starIn, OC, WC };
