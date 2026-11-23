// "Motorway": the English countryside at night, with a motorway running alongside the railway.
//
// The line runs on a five-metre embankment, so the eye looks down a little on the land: dark
// fields, hedgerows and hedgerow trees as low silhouettes, and 60 to 280 m out a dual three-lane
// motorway drifting nearer and farther, on a low bank or in a shallow cutting, now and then
// swinging away behind a belt of trees. It is unlit between junctions and lit around them, so the
// view runs dark stretch, lit stretch: tall columns every 40 m with sodium or LED heads and the
// pools they throw on the tarmac. Traffic is long-exposure light: white trails along the
// carriageway nearer the line (coming towards us), red along the other, in bunches. Gantries,
// blue signs, marker posts, overbridges, junctions with slip roads and lit roundabouts, a service
// area now and then, a lorry with its hazards on the hard shoulder.
// Beyond: farms with a lit window and a yard light, villages as clusters of warm points with a
// floodlit church, a line of pylons, a distant A-road; and on the low horizon, sparse landmarks
// each with its own light: a town and its low glow, a floodlit cathedral, a TV mast with red
// lights, cooling towers with a lit plume, a hilltop monument, a wind farm, an airport.
//
// The land is kept LOW (gentle terrain, no tall things near the window but lamp columns and
// gantries) so the upper half of the picture belongs to the sky, which the sky shader draws.
//
// How light works (see nightcity.js): ordinary splats are multiplied by the time-of-day tint (about
// a fifth at night). Lights are KIND.LIGHT with their brightest channel pinned at 1.0 and dimmed only
// by opacity; lit surfaces (pools on the road, floodlit stone, lit canopies) are faint light splats.
// Lights switch on with the hour the chunk was built at (ctx.hour); by day the same geometry stands
// unlit.
//
// Structure (as karst.js): one pure layout of WORLD x, hashed from the world seed and cached per
// terrain: the motorway's course (distance and level along x), junctions, service areas, lit
// stretches, overbridges, gantries, farms, villages and far landmarks. Every band reads from it,
// draws only the parts whose distance falls inside it, and clips at ctx.zNear/ctx.zFar for things
// that run across bands. Only the ground fill uses the chunk's own rng.
//
// Surreal dials (all 0 at level 0, so level 0 shows none of this):
//   scale     lamp columns far too tall, bending over like flowers; a cathedral the size of a mountain
//   topology  light trails that leave the carriageway and loop through the air; the motorway doubled,
//             a second one of light running above it; lamps that carry on past the end of a lit
//             stretch, climbing in a line into the sky
//   matter    lamps in impossible colours, by stretch
//   logic     the same gantry repeating every few metres
import { hashInts, hashString, makeRng, noise1, noise2 } from '../rng.js';
import { makeTerrain } from '../terrain.js';
import {
  KIND, MOVE, makeOut, worldSeed, worldRng, worldHash, cellsAround, groundY, detail, jitter, mul3, mix3, smooth,
  clamp, lerp, quatXTo, strut, hedge, broadleaf, house, overheadLine, fence, blob, bush, treeSplats,
} from './kit.js';
import { downsLayout } from './downs.js';

const PAL = {
  ground: [0.19, 0.25, 0.13],
  foliage: [0.13, 0.2, 0.1],
  hedge: [0.11, 0.18, 0.08],
  scrub: [0.16, 0.22, 0.11],
  rock: [0.5, 0.5, 0.48],
  ballast: [0.4, 0.38, 0.35],
};
// Low land: the railway on a 5 m bank, gentle rolls, low hills far off. The horizon stays flat.
const TERRAIN = { cutting: 7, roll: 2.2, rollScale: 650, rise: 0.006, hills: 9, hillScale: 2600, mountains: 130, mountainScale: 9000, mountainStart: 3500 };

// ---------------------------------------------------------------------------------------------
// Light colours: brightest channel always 1.0, never shaded or jittered
// ---------------------------------------------------------------------------------------------
const SODIUM = [1.0, 0.62, 0.22];
const LED = [0.9, 0.95, 1.0];
const HEAD = [1.0, 0.95, 0.82];
const HEAD2 = [1.0, 0.9, 0.66];
const TAIL = [1.0, 0.09, 0.05];
const AMBER = [1.0, 0.58, 0.1];
const RED = [1.0, 0.07, 0.04];
const SIG_GREEN = [0.2, 1.0, 0.55];
const WHITE = [1.0, 0.98, 0.94];
const WARM = [[1.0, 0.78, 0.48], [1.0, 0.72, 0.42], [1.0, 0.84, 0.6], [1.0, 0.66, 0.36]];
const FLOOD = [1.0, 0.86, 0.64];
const CANOPY = [0.94, 0.97, 1.0];
const SIGN = [0.28, 0.48, 1.0];
const BRAND = [[0.2, 1.0, 0.45], [1.0, 0.18, 0.12], [1.0, 0.85, 0.1], [0.25, 0.5, 1.0]];
const WEIRD = [[1.0, 0.2, 0.75], [0.25, 1.0, 0.78], [0.62, 0.32, 1.0], [0.45, 1.0, 0.25]];

// Natural colours (daytime; the tint darkens them at night)
const C = {
  tarmac: [0.2, 0.2, 0.21],
  shoulder: [0.24, 0.24, 0.24],
  reserve: [0.42, 0.41, 0.39],
  verge: [0.2, 0.27, 0.13],
  bank: [0.17, 0.24, 0.12],
  steel: [0.46, 0.47, 0.48],
  column: [0.42, 0.43, 0.44],
  pond: [0.46, 0.52, 0.62],
  stone: [0.56, 0.53, 0.46],
  concrete: [0.52, 0.52, 0.5],
};
const WALLS = [[0.5, 0.3, 0.22], [0.55, 0.34, 0.25], [0.45, 0.43, 0.4], [0.5, 0.46, 0.38]];
const ROOFS = [[0.25, 0.26, 0.29], [0.42, 0.24, 0.17], [0.38, 0.22, 0.16]];

// ---------------------------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------------------------
function hourOf(ctx) { const h = ctx.hour != null ? ctx.hour : 23; return ((h % 24) + 24) % 24; }
function nightness(h) { return h >= 12 ? smooth(17.5, 19.5, h) : 1 - smooth(5.5, 7.5, h); }
const LIT_CURVE = [[0, 0.32], [1, 0.24], [2, 0.16], [3, 0.12], [5, 0.12], [6, 0.15], [8, 0.04], [17, 0.04], [19, 0.25], [21, 0.42], [22, 0.45], [23, 0.4], [24, 0.32]];
function litFrac(h) {
  for (let i = 1; i < LIT_CURVE.length; i++) {
    const [h1, v1] = LIT_CURVE[i];
    if (h <= h1) { const [h0, v0] = LIT_CURVE[i - 1]; return lerp(v0, v1, (h - h0) / (h1 - h0)); }
  }
  return 0.3;
}
// traffic through the night: busy in the evening, thin in the small hours
function trafficAt(h) { return h >= 12 ? 1 : h < 1 ? 0.85 : h < 4 ? 0.55 : 0.75; }
function lightState(ctx) {
  const h = hourOf(ctx), n = nightness(h);
  return { hour: h, night: n, on: n > 0.35, lit: litFrac(h), traffic: trafficAt(h) };
}

// ---------------------------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------------------------
function L(out, x, y, d, sx, sy, sz, c, o) { return out(x, y, -d, sx, sy, sz, c[0], c[1], c[2], o, 0, 0, 0, 1, KIND.LIGHT); }
// A point light: a small bright core and at most a slightly larger faint halo.
function point(out, x, y, d, c, r, halo = 0.12, hk = 3.2) {
  L(out, x, y, d, r, r, r, c, 1);
  if (halo > 0) L(out, x, y, d + 0.05, r * hk, r * hk, r * hk * 0.6, c, halo);
}
// A pool of light lying on the ground: rx along the track, rz across.
// It is cut into strips across the line of sight: splats are sorted by their centres, so one big
// disc would be covered by every ground splat in front of its centre.
function pool(out, x, y, d, rx, rz, c, o) {
  const k = Math.max(1, Math.round(rz / 1.6)), sz = rz / k;
  for (let i = 0; i < k; i++) L(out, x, y + 0.08, d - rz + (2 * i + 1) * sz, rx, Math.max(0.02, rx * 0.01), sz * 1.25, c, o);
}
function nat(out, x, y, d, sx, sy, sz, c, o = 1, kind = KIND.OTHER, move = 0) { return out(x, y, -d, sx, sy, sz, c[0], c[1], c[2], o, 0, 0, 0, 1, kind, move); }
// A rigid movable thing (a vehicle, a fuel pump): MOVE.STILL, so nothing on the beat.
function natS(out, x, y, d, sx, sy, sz, c, o = 1) { return nat(out, x, y, d, sx, sy, sz, c, o, KIND.OTHER, MOVE.STILL); }
// A box lying along x: centre of its base (x, y, d), length L, height H, width Wd across, splat size
// s. The camera-facing side, both ends and the top, in three tones so the corners read.
function vbox(out, x, y, d, L, H, Wd, c, s, move = 0) {
  const nu = Math.max(1, Math.round(L / (s * 1.4))), nv = Math.max(1, Math.round(H / (s * 1.4))), nw = Math.max(1, Math.round(Wd / (s * 1.4)));
  const su = L / nu * 0.66, sv = H / nv * 0.66, sw = Wd / nw * 0.66;
  for (let i = 0; i < nu; i++) {
    const px = x - L / 2 + (i + 0.5) * L / nu;
    for (let j = 0; j < nv; j++) nat(out, px, y + (j + 0.5) * H / nv, d - Wd / 2, su, sv, 0.05, mul3(c, 0.85), 1, KIND.OTHER, move);
    for (let k = 0; k < nw; k++) nat(out, px, y + H, d - Wd / 2 + (k + 0.5) * Wd / nw, su, 0.05, sw, mul3(c, 1.05), 1, KIND.OTHER, move);
  }
  for (const e of [-1, 1]) for (let j = 0; j < nv; j++) for (let k = 0; k < nw; k++) nat(out, x + e * L / 2, y + (j + 0.5) * H / nv, d - Wd / 2 + (k + 0.5) * Wd / nw, 0.05, sv, sw, mul3(c, e < 0 ? 1 : 0.6), 1, KIND.OTHER, move);
}
// A thin straight member between two points given as (x, y, d).
function bar(out, ax, ay, ad, bx, by, bd, r, c, n = 2, kind = KIND.OTHER, o = 1) { strut(out, ax, ay, -ad, bx, by, -bd, r, c, n, o, kind); }
// Same, but a light (a lit edge, a trail segment).
function lbar(out, ax, ay, ad, bx, by, bd, r, c, n, o) { strut(out, ax, ay, -ad, bx, by, -bd, r, c, n, o, KIND.LIGHT); }
const thin = (d, k = 1) => Math.max(0.05, 0.0005 * d) * k;
const inBand = (ctx, d) => d >= ctx.zNear && d < ctx.zFar;

// Faces of a box as grids of flat splats. colorAt(a, b) -> null (skip), [r,g,b] natural, or
// { c, o } for a light (o = opacity). Front faces the camera (+z, at distance d0); sides face -x/+x.
function* frontFace(out, x0, y0, d0, U, V, s, colorAt, kind = KIND.BUILDING) {
  const nu = Math.max(1, Math.round(U / (s * 1.5))), nv = Math.max(1, Math.round(V / (s * 1.5)));
  const su = (U / nu) * 0.62, sv = (V / nv) * 0.62;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = (i + 0.5) / nu, b = (j + 0.5) / nv;
      const c = colorAt(a, b);
      if (!c) continue;
      if (c.c) out(x0 + a * U, y0 + b * V, -d0, su, sv, s * 0.1, c.c[0], c.c[1], c.c[2], c.o, 0, 0, 0, 1, KIND.LIGHT);
      else out(x0 + a * U, y0 + b * V, -d0, su, sv, s * 0.1, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
    if (out.due()) yield;
  }
}
function* sideFace(out, x0, y0, d0, U, V, s, colorAt, kind = KIND.BUILDING) {
  // U runs away from the camera (increasing distance from d0)
  const nu = Math.max(1, Math.round(U / (s * 1.5))), nv = Math.max(1, Math.round(V / (s * 1.5)));
  const su = (U / nu) * 0.62, sv = (V / nv) * 0.62;
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = (i + 0.5) / nu, b = (j + 0.5) / nv;
      const c = colorAt(a, b);
      if (!c) continue;
      if (c.c) out(x0, y0 + b * V, -(d0 + a * U), s * 0.1, sv, su, c.c[0], c.c[1], c.c[2], c.o, 0, 0, 0, 1, KIND.LIGHT);
      else out(x0, y0 + b * V, -(d0 + a * U), s * 0.1, sv, su, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// World layout (pure functions of world x; cached per terrain)
// ---------------------------------------------------------------------------------------------
const worlds = new WeakMap();
function world(ctx) {
  let W = worlds.get(ctx.terrain);
  if (W) return W;
  const ws = worldSeed(ctx);
  const terr = ctx.terrain;
  W = {
    ws, terr, H: (wx, d) => terr.height(wx, d) + hengeRise(W, wx, d), F: downsLayout.layout(ctx), henges: new Map(),
    j: new Map(), s: new Map(), ls: new Map(), ob: new Map(), farms: new Map(), ponds: new Map(), vil: new Map(), lm: new Map(), hs: new Map(),
  };
  worlds.set(ctx.terrain, W);
  return W;
}
function cache(map, key, make) {
  let v = map.get(key);
  if (v === undefined) { v = make(); if (map.size > 20000) map.clear(); map.set(key, v); }
  return v;
}

// Junctions: at most one per JCELL of world x. The motorway sits in a cutting under a bridge that
// carries a road between two roundabouts, one each side; slip roads curve up to them. The far
// roundabout sends a lit road straight away from the line. On one side of the junction the
// motorway bends away from the railway, so the lamps there recede.
const JCELL = 3400;
const J_OFF = 38, J_RING = 16, J_REACH = 32, J_OUT = J_OFF + J_RING + 5;   // roundabout centre offset, ring radius, slip reach, out road start
function junction(W, i) {
  return cache(W.j, i, () => {
    const r = makeRng(hashInts(W.ws, 21, i));
    if (r() > 0.62) return null;
    const jx = (i + 0.3 + 0.4 * r()) * JCELL;
    return {
      i, jx, D: 92 + 8 * r(), bend: r() < 0.5 ? -1 : 1, bendAmp: r() < 0.55 ? 120 + 40 * r() : 0,
      lit0: jx - 760 - 420 * r(), lit1: jx + 760 + 420 * r(), central: r() < 0.55, led: r() < 0.45,
      outSlope: (r() - 0.5) * 0.3, outLen: 1400 + 1200 * r(), seed: hashInts(W.ws, 22, i),
    };
  });
}
function junctionNear(W, wx, within) {
  const i = Math.floor(wx / JCELL);
  for (let k = i - 1; k <= i + 1; k++) { const j = junction(W, k); if (j && Math.abs(wx - j.jx) < within) return j; }
  return null;
}
// Service areas: rare, beyond the far carriageway, away from junctions.
const SCELL = 11000;
function service(W, i) {
  return cache(W.s, i, () => {
    const r = makeRng(hashInts(W.ws, 31, i));
    if (r() > 0.5) return null;
    const sx = (i + 0.2 + 0.6 * r()) * SCELL;
    if (junctionNear(W, sx, 2500)) return null;
    return { i, sx, D: 98, lit0: sx - 600, lit1: sx + 600, central: r() < 0.5, led: r() < 0.7, brand: Math.floor(r() * BRAND.length), seed: hashInts(W.ws, 32, i) };
  });
}
function serviceNear(W, wx, within) {
  const i = Math.floor(wx / SCELL);
  for (let k = i - 1; k <= i + 1; k++) { const s = service(W, k); if (s && Math.abs(wx - s.sx) < within) return s; }
  return null;
}
// Lit stretches that are not junctions: an older stretch past a town, sodium more often.
const LCELL = 4300;
function oldLit(W, i) {
  return cache(W.ls, i, () => {
    const r = makeRng(hashInts(W.ws, 41, i));
    if (r() > 0.3) return null;
    const c = (i + 0.2 + 0.6 * r()) * LCELL, half = 280 + 380 * r();
    return { lit0: c - half, lit1: c + half, central: r() < 0.5, led: r() < 0.3, key: hashInts(W.ws, 42, i) };
  });
}
// Every lit stretch overlapping [xa, xb]: { lit0, lit1, central, led, key }.
function stretchesNear(W, xa, xb) {
  const res = [];
  for (let i = Math.floor((xa - 1300) / JCELL); i <= Math.floor((xb + 1300) / JCELL); i++) {
    const j = junction(W, i);
    if (j && j.lit1 > xa && j.lit0 < xb) res.push({ lit0: j.lit0, lit1: j.lit1, central: j.central, led: j.led, key: j.seed });
  }
  for (let i = Math.floor((xa - 700) / SCELL); i <= Math.floor((xb + 700) / SCELL); i++) {
    const s = service(W, i);
    if (s && s.lit1 > xa && s.lit0 < xb) res.push({ lit0: s.lit0, lit1: s.lit1, central: s.central, led: s.led, key: s.seed });
  }
  for (let i = Math.floor((xa - 700) / LCELL); i <= Math.floor((xb + 700) / LCELL); i++) {
    const o = oldLit(W, i);
    if (o && o.lit1 > xa && o.lit0 < xb) res.push(o);
  }
  return res;
}
function litIn(list, wx) { for (const s of list) if (wx >= s.lit0 && wx < s.lit1) return s; return null; }

// Lane overbridges (unlit, or with a lamp at each end), away from junctions and services.
const OCELL = 2300;
function overbridge(W, i) {
  return cache(W.ob, i, () => {
    const r = makeRng(hashInts(W.ws, 51, i));
    if (r() > 0.38) return null;
    const bx = (i + 0.2 + 0.6 * r()) * OCELL;
    if (junctionNear(W, bx, 1100) || serviceNear(W, bx, 1100)) return null;
    return { bx, lamps: r() < 0.5, w: 7 };
  });
}

// The motorway's course: centreline distance RD and level RE (metres above or below the land)
// at world x. Module-level scratch values avoid allocating per call.
let RD = 0, RE = 0, RY = 0, RS = 0, RYS = 0;
function roadDe(W, wx) {
  const ws = W.ws;
  const base = 50 + 56 * (0.7 * noise1(wx / 2100, ws + 11) + 0.3 * noise1(wx / 650, ws + 12));
  const away = smooth(0.78, 0.9, noise1(wx / 6400, ws + 13));
  let D = lerp(base, 232 + 40 * noise1(wx / 1300, ws + 14), away);
  let e = 1.6 * (2 * noise1(wx / 950, ws + 15) - 1) - 0.8;
  e = lerp(e, -2.4, away);
  const j = junctionNear(W, wx, 1900);
  if (j) {
    const a = wx - j.jx, aa = Math.abs(a);
    let Dj = j.D;
    if ((a < 0 ? -1 : 1) === j.bend) Dj += j.bendAmp * smooth(420, 1050, aa);
    const w = 1 - smooth(1100, 1700, aa);
    D = lerp(D, Dj, w);
    e = lerp(lerp(e, 0.5, w), -4.6, 1 - smooth(300, 640, aa));
  }
  const s = serviceNear(W, wx, 1300);
  if (s) { const w = 1 - smooth(750, 1300, Math.abs(wx - s.sx)); D = lerp(D, s.D, w); e = lerp(e, 0.3, w); }
  RD = D; RE = e;
}
// A table of the course over a chunk (2 m steps), so per-splat lookups are cheap.
function roadTable(ctx, W, margin) {
  const step = 2, a = ctx.x0 - margin;
  const n = Math.ceil((ctx.length + 2 * margin) / step) + 2;
  const Dv = new Float32Array(n), Yv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const wx = a + i * step;
    roadDe(W, wx);
    Dv[i] = RD; Yv[i] = W.H(wx, RD) + RE;
  }
  return { W, a, step, n, Dv, Yv };
}
// Sets RD, RY (road level), RS (dD/dx) and RYS (dY/dx) at world x.
function rAt(R, wx) {
  let f = (wx - R.a) / R.step;
  if (f < 0 || f > R.n - 1.001) {
    roadDe(R.W, wx); RY = R.W.H(wx, RD) + RE;
    roadDe(R.W, wx + 2); const D2 = RD, Y2 = R.W.H(wx + 2, RD) + RE;
    roadDe(R.W, wx); RS = (D2 - RD) / 2; RYS = (Y2 - RY) / 2;
    return;
  }
  const i = Math.floor(f), t = f - i;
  const d0 = R.Dv[i], d1 = R.Dv[i + 1], y0 = R.Yv[i], y1 = R.Yv[i + 1];
  RD = d0 + (d1 - d0) * t; RY = y0 + (y1 - y0) * t;
  RS = (d1 - d0) / R.step; RYS = (y1 - y0) / R.step;
}

// Cross-section offsets from the centreline (negative = towards the railway).
const RES = 1.5, LANE = 3.65, EDGE = 12.45, SHOULDER = 15.8, VERGE = 19.5;
const LANES = [RES + LANE * 0.5, RES + LANE * 1.5, RES + LANE * 2.5];

// Slip roads at a junction or service area: from the carriageway edge to a point `reach` out,
// over `len` metres of x, starting `start` from the centre x. side: -1/+1 in x; c: -1/+1 across.
function slipU(cx, wx, start, len) { return 1 - (Math.abs(wx - cx) - start) / len; }
function slipO(c, u, reach) { return c * (17 + (reach - 17) * smooth(0, 1, u)); }

// Surface at a world point (near the motorway): sets SY (height) and ST (type) for the ground fill.
const S = { FIELD: 0, ROAD: 1, RES: 2, VERGE: 3, BANK: 4, SLIP: 5, ISLAND: 6, PARK: 7, OUT: 8 };
let SY = 0, ST = 0, SK = 0;   // height, type, slope (for disc thickness)
function surf(W, R, wx, d, T) {
  ST = S.FIELD; SY = T; SK = 0;
  if (!R) return;
  rAt(R, wx);
  const o = d - RD, a = o < 0 ? -o : o;
  if (a < VERGE) { SY = RY; ST = a < RES ? S.RES : a < SHOULDER ? S.ROAD : S.VERGE; }
  else {
    const w = 4 + 1.8 * Math.abs(RY - T);
    if (a < VERGE + w) { SY = lerp(RY, T, smooth(VERGE, VERGE + w, a)); ST = S.BANK; SK = 1.5 * Math.abs(RY - T) / w; }
  }
  // junction: slips, roundabouts, the out road
  const j = R.j;
  if (j && Math.abs(wx - j.jx) < 480) {
    const c = o < 0 ? -1 : 1;
    const dc = j.D + c * J_OFF;
    const rr = Math.hypot(wx - j.jx, d - dc);
    if (rr < J_RING + 7) {
      const Tc = c < 0 ? j.Tn : j.Tf;
      SY = Tc; ST = rr < J_RING - 4.5 ? S.ISLAND : rr < J_RING + 4.5 ? S.SLIP : S.VERGE;
      if (rr < J_RING - 4.5) SY = Tc + 0.3;
      // where the ring comes close to the cutting, a steep bank down to the carriageway
      const lip = J_OFF - J_RING + 10;
      if (a < lip) { SY = lerp(RY, SY, smooth(VERGE - 2, lip, a)); ST = a < VERGE - 2 ? S.VERGE : S.BANK; SK = 1.5 * Math.abs(Tc - RY) / (lip - VERGE + 2); }
      return;
    }
    const u = slipU(j.jx, wx, J_RING, 380);
    if (u > 0 && u <= 1) {
      const os = slipO(c, u, J_REACH);
      const sy = lerp(RY, c < 0 ? j.Tn : j.Tf, smooth(0.15, 0.85, u));
      if (Math.abs(o - os) < 4.2 && a > SHOULDER - 0.5) { SY = sy; ST = S.SLIP; return; }
      // the bank between the carriageway and a slip climbing out of the cutting
      const inner = Math.abs(os) - 4.2;
      if (a > VERGE && a < inner && inner - VERGE > 1) {
        SY = lerp(RY, sy, smooth(VERGE, inner, a)); ST = S.BANK; SK = 1.5 * Math.abs(sy - RY) / (inner - VERGE);
      }
    }
    // the crossing road over the bridge
    if (Math.abs(wx - j.jx) < 4.5 && a < J_OFF - J_RING) { ST = S.SLIP; SY = Math.max(SY, j.deck - 0.2); }
  }
  if (j && d > j.D + J_OUT && Math.abs(wx - outX(j, d)) < 4.5) { ST = S.OUT; SY = T; }
  const s = R.s;
  if (s && o > 0) {
    if (Math.abs(wx - s.sx) < 175 && o > 30 && o < 190) { ST = S.PARK; SY = s.Tp; return; }
    const u = slipU(s.sx, wx, 170, 360);
    if (u > 0 && u <= 1) {
      const os = slipO(1, u, 40);
      if (Math.abs(o - os) < 4.2 && a > SHOULDER - 0.5) { SY = lerp(RY, s.Tp, smooth(0.1, 0.9, u)); ST = S.SLIP; }
    }
  }
}
// The road leaving the far roundabout, straight away from the line with a gentle wander.
function outX(j, d) { const dd = d - (j.D + J_OUT); return j.jx + j.outSlope * dd + 22 * Math.sin(dd / 260); }

// Everything the near band needs for a chunk: road table, the junction and service in reach.
function chunkRoad(ctx, W, margin) {
  const R = roadTable(ctx, W, margin);
  const mid = ctx.x0 + ctx.length / 2;
  const j = junctionNear(W, mid, ctx.length / 2 + 2000);
  if (j) {
    const T = (d) => W.H(j.jx, d);
    j.Tn = T(j.D - J_OFF); j.Tf = T(j.D + J_OFF);
    roadDe(W, j.jx); j.Y = W.H(j.jx, RD) + RE;
    j.deck = Math.max(j.Tn, j.Tf, j.Y + 5.6) + 0.4;
  }
  R.j = j;
  const s = serviceNear(W, mid, ctx.length / 2 + 1300);
  if (s) s.Tp = W.H(s.sx, s.D + 100);
  R.s = s;
  R.lit = stretchesNear(W, ctx.x0 - 1200, ctx.x0 + ctx.length + 1200);
  return R;
}
// Is this point clear of the motorway, its junctions and services (for hedges, farms, trees)?
function clearOfRoad(W, R, wx, d, m = 34) {
  rAt(R, wx);
  if (Math.abs(d - RD) < m) return false;
  const j = R.j;
  if (j && Math.abs(wx - j.jx) < 520 && d > j.D - J_OFF - 35 && d < j.D + J_OFF + 35) return false;
  if (j && d > j.D + 70 && Math.abs(wx - outX(j, d)) < 14) return false;
  const s = R.s;
  if (s && Math.abs(wx - s.sx) < 560 && d > s.D && d < s.D + 205) return false;
  return true;
}

// Stonehenge (near band, rare): the stones on a swell of open downland beyond the road, as they
// stand above the A303 on the way west. Unlit: dark shapes against the night sky, their tops and
// one edge catching the moon. About one in three or four visits to this country passes it.
const HGCELL = 18000, HG_D = 162, HG_RISE = 10.5, HG_K = 1.7;   // HG_K: drawn half as large again, as figures are
function henge(W, i) {
  return cache(W.henges, i, () => {
    const r = makeRng(hashInts(W.ws, 71, i));
    if (r() > 0.75) return null;
    // somewhere in the cell where the road passes in front of it, clear of junctions and services
    for (let k = 0; k < 14; k++) {
      const hx = (i + 0.1 + 0.8 * r()) * HGCELL;
      roadDe(W, hx);
      if (RD > 80 || junctionNear(W, hx, 1300) || serviceNear(W, hx, 1500)) continue;
      return { hx, hd: HG_D, turn: r() * Math.PI * 2, seed: hashInts(W.ws, 72, i) };
    }
    return null;
  });
}
function hengeNear(W, wx) {
  const i0 = Math.floor(wx / HGCELL);
  for (let i = i0 - 1; i <= i0 + 1; i++) { const h = henge(W, i); if (h && Math.abs(h.hx - wx) < 420) return h; }
  return null;
}
// The swell it stands on, added to the land (so fields, fill and everything else follow it).
function hengeRise(W, wx, d) {
  if (d < 86 || d > 300) return 0;
  const h = hengeNear(W, wx);
  if (!h) return 0;
  const u = (wx - h.hx) / 150, v = (d - h.hd) / (d < h.hd ? 36 : 70);
  const q = u * u + v * v;
  return q > 6 ? 0 : HG_RISE * Math.exp(-q);
}
// One stone: a slab w wide (along `yaw`), h tall, t thick, leaning a little; a dark body with a
// thin pale rim along its top and its moonward edge (the moon hangs in the sky beyond).
function hengeStone(out, x, y, d, yaw, w, h, t, r, lean = 0) {
  const n = Math.max(2, Math.round(h / (w * 0.75)));
  const cy = Math.cos(yaw), sy = Math.sin(yaw), q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const body = jitter([0.4, 0.4, 0.38], r, 0.12);
  for (let k = 0; k < n; k++) {
    const f = (k + 0.5) / n, wob = (r() - 0.5) * 0.12 * w, ww = w * (0.94 + 0.12 * r() - 0.1 * f);
    out(x + (wob + lean * f * h) * cy, y + f * h, -(d + (wob + lean * f * h) * sy), ww / 3.1, (h / n) * 0.62, t / 3.1, body[0], body[1], body[2], 1, q[0], q[1], q[2], q[3], KIND.ROCK);
  }
  // the rim: a little light on the top, and down the edge nearer the moon (to the left, beyond)
  // (a colour just short of a light's: the shader lets it keep about two fifths of its brightness at night)
  const rim = [0.86, 0.88, 0.905], rr = Math.max(0.09, 0.0006 * d);
  out(x + lean * h * cy, y + h + 0.02, -(d + lean * h * sy + 0.1), w / 3.4, rr, t / 3.6, rim[0], rim[1], rim[2], 0.7, q[0], q[1], q[2], q[3], KIND.LIGHT);
  const ex = -Math.sign(cy || 1) * (w / 2 - 0.1);
  out(x + ex * cy + lean * 0.75 * h * cy, y + 0.72 * h, -(d + ex * sy + 0.12), rr, h * 0.16, rr, rim[0], rim[1], rim[2], 0.45, 0, 0, 0, 1, KIND.LIGHT);
}
// A lintel lying across two uprights, from a to b (each [x, d]) at height y.
function hengeLintel(out, a, b, y, w, th, r) {
  const dx = b[0] - a[0], dd = b[1] - a[1], len = Math.hypot(dx, dd), yaw = Math.atan2(-(-dd), dx);
  const q = [0, Math.sin(-Math.atan2(dd, dx) / 2), 0, Math.cos(-Math.atan2(dd, dx) / 2)];
  const body = jitter([0.38, 0.38, 0.36], r, 0.1), mx = (a[0] + b[0]) / 2, md = (a[1] + b[1]) / 2;
  for (const f of [-0.25, 0.25]) out(mx + dx * f, y + th / 2, -(md + dd * f), (len + w * 0.5) / 4.6, th / 2.6, w / 3.0, body[0], body[1], body[2], 1, q[0], q[1], q[2], q[3], KIND.ROCK);
  out(mx, y + th + 0.02, -(md + 0.1), (len + w * 0.4) / 3.2, Math.max(0.09, 0.0006 * md), w / 4, 0.86, 0.88, 0.905, 0.7, q[0], q[1], q[2], q[3], KIND.LIGHT);
  void yaw;
}
function* stonehenge(ctx, out, W) {
  const i0 = Math.floor((ctx.x0 - 200) / HGCELL), i1 = Math.floor((ctx.x0 + ctx.length + 200) / HGCELL);
  for (let i = i0; i <= i1; i++) {
    const g = henge(W, i);
    if (!g || g.hx < ctx.x0 - 120 || g.hx > ctx.x0 + ctx.length + 120) continue;
    const r = makeRng(g.seed), K = HG_K, cx = g.hx - ctx.x0, cd = g.hd, t0 = g.turn;
    const at = (rad, a) => [cx + rad * K * Math.cos(a + t0), cd + rad * K * Math.sin(a + t0)];
    const yAt = (p) => W.H(ctx.x0 + p[0], p[1]) - 0.15;
    const tang = (a) => -(a + t0) + Math.PI / 2;        // yaw that lays a slab's width along the circle
    // the sarsen circle: thirty places 16.4 m out; a run of seven still carries its lintels, ten
    // more stand alone, the rest are gaps or lie fallen
    const STAND = [0, 1, 2, 3, 4, 5, 6, 9, 10, 13, 16, 19, 21, 22, 26, 27, 28];
    const A = (k) => (k / 30) * Math.PI * 2;
    for (const k of STAND) {
      const p = at(16.4, A(k));
      hengeStone(out, p[0], yAt(p), p[1], tang(A(k)), 2.1 * K, (4.1 + (k > 6 ? (r() - 0.5) * 0.9 : 0)) * K, 1.1 * K, r, k > 6 ? (r() - 0.5) * 0.06 : 0);
    }
    for (let k = 0; k < 6; k++) { const a = at(16.4, A(k)), b = at(16.4, A(k + 1)); hengeLintel(out, a, b, Math.max(yAt(a), yAt(b)) + 4.1 * K, 1.0 * K, 0.8 * K, r); }
    for (const k of [7, 12, 17, 24]) {        // fallen sarsens
      const p = at(15 + 3 * r(), A(k) + 0.1);
      out(p[0], yAt(p) + 0.5 * K, -p[1], 1.9 * K, 0.4 * K, 0.8 * K, 0.36, 0.36, 0.34, 1, 0, Math.sin(r() * 1.5), 0, Math.cos(r() * 1.5), KIND.ROCK);
    }
    // the horseshoe of five great trilithons inside, open the way the axis runs: three stand whole,
    // one has fallen, and of the tallest a single upright is left
    const TRI = [[0.96, 6.1, true], [2.18, 6.6, true], [-0.96, 6.1, true], [-2.18, 6.6, false], [Math.PI, 7.3, null]];
    for (const [a, h, whole] of TRI) {
      const ya = tang(a), da = 0.2;
      const p1 = at(7.6, a - da), p2 = at(7.6, a + da);
      if (whole === true) {
        hengeStone(out, p1[0], yAt(p1), p1[1], ya, 2.3 * K, h * K, 1.3 * K, r);
        hengeStone(out, p2[0], yAt(p2), p2[1], ya, 2.3 * K, h * K, 1.3 * K, r);
        hengeLintel(out, p1, p2, Math.max(yAt(p1), yAt(p2)) + h * K, 1.2 * K, 1.0 * K, r);
      } else if (whole === null) {
        hengeStone(out, p1[0], yAt(p1), p1[1], ya, 2.4 * K, h * K, 1.3 * K, r, 0.03);
        out(p2[0], yAt(p2) + 0.6 * K, -p2[1], 2.6 * K, 0.5 * K, 1.0 * K, 0.36, 0.36, 0.34, 1, 0, 0.3, 0, 0.95, KIND.ROCK);
      } else {
        for (const p of [p1, p2]) out(p[0], yAt(p) + 0.5 * K, -p[1], 2.4 * K, 0.45 * K, 0.9 * K, 0.36, 0.36, 0.34, 1, 0, Math.sin(r()), 0, Math.cos(r()), KIND.ROCK);
      }
    }
    // the low bluestones, a broken ring between the two
    for (let k = 0; k < 16; k++) {
      if (r() < 0.35) continue;
      const a = (k / 16) * Math.PI * 2 + 0.1, p = at(11.7, a);
      hengeStone(out, p[0], yAt(p), p[1], tang(a), 0.9 * K, (1.3 + 0.7 * r()) * K, 0.6 * K, r, (r() - 0.5) * 0.12);
    }
    // the Heel Stone, alone and leaning, out along the axis
    // (kept on the crown of the down, to one side: never out on the slope towards the road)
    let hp = at(27, 0);
    if (hp[1] < cd - 8 * K) hp = [hp[0] + (hp[0] < cx ? -14 : 14) * K, cd + 4 * K];
    hengeStone(out, hp[0], yAt(hp), hp[1], tang(0) + 0.6, 2.4 * K, 4.7 * K, 1.6 * K, r, 0.1);
    if (out.due()) yield;
  }
}

// Farms (near band): a house with lit windows, a barn with a yard light, a car at the gate.
const FMCELL = 620;
function farm(W, i) {
  return cache(W.farms, i, () => {
    const r = makeRng(hashInts(W.ws, 61, i));
    if (r() > 0.5) return null;
    const fx = (i + 0.15 + 0.7 * r()) * FMCELL, fd = 58 + 225 * r();
    roadDe(W, fx);
    if (Math.abs(fd - RD) < 60) return null;
    const j = junctionNear(W, fx, 700);
    if (j && fd < j.D + 140) return null;
    if (hengeNear(W, fx)) return null;       // the stones stand on open downland
    const s = serviceNear(W, fx, 800);
    if (s && fd > s.D - 20) return null;
    return { fx, fd, seed: hashInts(W.ws, 62, i), car: r() < 0.35, yard: r() < 0.7, windows: 1 + Math.floor(r() * 3) };
  });
}
const PCELL = 900;
function pond(W, i) {
  return cache(W.ponds, i, () => {
    const r = makeRng(hashInts(W.ws, 63, i));
    if (r() > 0.35) return null;
    const px = (i + 0.2 + 0.6 * r()) * PCELL, pd = 45 + 240 * r();
    roadDe(W, px);
    if (Math.abs(pd - RD) < 50) return null;
    if (junctionNear(W, px, 600) || serviceNear(W, px, 700)) return null;
    return { px, pd, rx: 8 + 12 * r(), rz: 5 + 7 * r() };
  });
}
// Lorry or recovery truck on the hard shoulder of the near carriageway.
const HCELL = 1900;
function shoulderStop(W, i) {
  return cache(W.hs, i, () => {
    const r = makeRng(hashInts(W.ws, 65, i));
    if (r() > 0.28) return null;
    const hx = (i + 0.2 + 0.6 * r()) * HCELL;
    if (junctionNear(W, hx, 600) || serviceNear(W, hx, 700)) return null;
    return { hx, kind: r() < 0.55 ? 'lorry' : 'recovery', seed: hashInts(W.ws, 66, i) };
  });
}

// Villages (mid band): houses round a street, warm windows, a few street lamps, often a church.
const VCELL = 2100;
function village(W, i) {
  return cache(W.vil, i, () => {
    const r = makeRng(hashInts(W.ws, 71, i));
    if (r() > 0.55) return null;
    const cx = (i + 0.2 + 0.6 * r()) * VCELL, dc = 420 * Math.pow(6, r());   // 420 m .. 2.5 km
    return { cx, dc, R: 60 + 0.05 * dc + 70 * r(), n: 10 + Math.floor(r() * 26), church: r() < 0.6, flood: r() < 0.75, spire: r() < 0.4, seed: hashInts(W.ws, 72, i), led: r() < 0.3 };
  });
}

// Far landmarks: at most one per LMCELL of world x, so most views hold one or two.
const LMCELL = 7600;
const LM_KINDS = [['town', 0.22], ['cathedral', 0.14], ['mast', 0.14], ['power', 0.12], ['monument', 0.12], ['windfarm', 0.13], ['airport', 0.13]];
function landmark(W, i) {
  return cache(W.lm, i, () => {
    const r = makeRng(hashInts(W.ws, 81, i));
    if (r() > 0.68) return null;
    let u = r(), kind = 'town';
    for (const [k, p] of LM_KINDS) { if (u < p) { kind = k; break; } u -= p; }
    const x = (i + 0.2 + 0.6 * r()) * LMCELL;
    const lm = { i, kind, x, seed: hashInts(W.ws, 82, i), giant: r() };
    if (kind === 'town') { lm.d = 5200 + 5800 * r(); lm.R = 900 + 900 * r(); }
    else if (kind === 'cathedral') { lm.d = 4200 + 3800 * r(); lm.R = 600 + 400 * r(); }
    else if (kind === 'mast') { lm.d = 4000 + 6000 * r(); lm.h = 230 + 100 * r(); }
    else if (kind === 'power') { lm.d = 6000 + 5500 * r(); lm.n = 4 + Math.floor(r() * 5); }
    else if (kind === 'windfarm') { lm.d = 3600 + 4400 * r(); lm.n = 7 + Math.floor(r() * 9); }
    else if (kind === 'airport') { lm.d = 5200 + 4500 * r(); lm.ang = 0.35 + 0.6 * r() * (r() < 0.5 ? -1 : 1); }
    else {
      // a hilltop monument: the highest of a few samples
      let best = -1e9;
      for (let k = 0; k < 9; k++) {
        const wx = x + (r() - 0.5) * 2400, d = 3300 + 2600 * r();
        const h = W.H(wx, d) - 0.006 * d;
        if (h > best) { best = h; lm.x = wx; lm.d = d; }
      }
      lm.obelisk = r() < 0.5;
    }
    return lm;
  });
}
function landmarksNear(W, xa, xb) {
  const res = [];
  for (let i = Math.floor((xa - 4000) / LMCELL); i <= Math.floor((xb + 4000) / LMCELL); i++) { const lm = landmark(W, i); if (lm) res.push(lm); }
  return res;
}

// ---------------------------------------------------------------------------------------------
// Motorway pieces (near band)
// ---------------------------------------------------------------------------------------------

// The lamp colour of a stretch (and the impossible colours of the matter dial).
function stretchColor(st, dz) {
  if ((dz.matter || 0) > 0 && (st.key & 1023) / 1024 < dz.matter * 0.7) return WEIRD[(st.key >>> 10) % WEIRD.length];
  return st.led ? LED : SODIUM;
}
function tallStretch(st, dz) { return (dz.scale || 0) > 0 && ((st.key >>> 12) & 1023) / 1024 < dz.scale * 0.6; }

// Lamp columns every 40 m of world x through lit stretches: central twin-arm columns or staggered
// verge columns, the heads, their halos and the pools on the road.
const LSP = 40;
function* motorwayLamps(ctx, out, W, R, Ls, dz) {
  for (const { i, wx0 } of cellsAround(ctx, LSP, 8)) {
    const st = litIn(R.lit, wx0);
    if (!st) continue;
    if (R.j && Math.abs(wx0 - R.j.jx) < 8) continue;     // the bridge stands there
    rAt(R, wx0);
    const D = RD, Y = RY, x = wx0 - ctx.x0;
    const col = stretchColor(st, dz);
    const tall = tallStretch(st, dz);
    // columns: [o of the column, [o of each head]]
    const spec = st.central ? [0, [-2.6, 2.6]] : (i & 1 ? [-18.4, [-15.6]] : [18.4, [15.6]]);
    const dCol = D + spec[0];
    if (!inBand(ctx, dCol)) continue;
    const r = thin(dCol, 1.5);
    const H = 12;
    if (tall) {
      // a stem far too tall, bending over like a flower, the heads hanging from the tip
      const Ht = H + 34 * dz.scale * (0.6 + 0.4 * worldHash(ctx, 101, i));
      const dir = i & 1 ? 1 : -1;
      let px = x, py = Y, seg = Ht / 9;
      for (let k = 0; k < 9; k++) {
        const th = Math.pow((k + 0.5) / 9, 1.7) * 2.4;
        const nx = px + dir * Math.sin(th) * seg, ny = py + Math.cos(th) * seg;
        bar(out, px, py, dCol, nx, ny, dCol, r, C.column, 2, KIND.SURREAL);
        px = nx; py = ny;
      }
      for (const oh of spec[1]) {
        if (Ls.on) { point(out, px, py - 0.4, D + oh, col, Math.max(0.16, 0.0017 * D), 0.12); pool(out, px, Y, D + oh, 12, 8, col, 0.12); }
      }
      if (out.due()) yield;
      continue;
    }
    bar(out, x, Y - 0.3, dCol, x, Y + H, dCol, r, C.column, 4);
    for (const oh of spec[1]) {
      const dh = D + oh;
      bar(out, x, Y + H - 0.1, dCol, x, Y + H + 0.25, dh, r * 0.7, C.column, 2);
      if (Ls.on) {
        point(out, x, Y + H + 0.05, dh, col, Math.max(0.15, 0.0017 * dh), 0.11, 3.4);
        pool(out, x, Y, dh, 8, 8, col, 0.22);
        pool(out, x, Y, dh, 3.6, 3.6, col, 0.32);
      } else nat(out, x, Y + H + 0.1, dh, 0.35, 0.1, 0.2, [0.3, 0.3, 0.32]);
    }
    if (out.due()) yield;
  }
}

// Topology: past the end of a lit stretch the lamps carry on without their columns, climbing in a
// line into the sky.
function* climbingLamps(ctx, out, W, R, Ls, dz) {
  if (!((dz.topology || 0) > 0) || !Ls.on) return;
  for (const st of R.lit) {
    if (((st.key >>> 4) & 1023) / 1024 > dz.topology * 0.9) continue;
    const col = stretchColor(st, dz);
    for (const end of [-1, 1]) {
      const base = end > 0 ? Math.floor(st.lit1 / LSP) * LSP : Math.ceil(st.lit0 / LSP) * LSP;
      for (let k = 1; k <= 28; k++) {
        const wx = base + end * k * LSP;
        const x = wx - ctx.x0;
        if (x < -2 || x > ctx.length + 2) continue;
        if (litIn(R.lit, wx)) break;
        rAt(R, wx);
        const d = RD + 2.6 * end + k * 2.2;
        if (!inBand(ctx, d)) continue;
        const y = RY + 12 + 0.9 * Math.pow(k, 1.75) * dz.topology;
        point(out, x, y, d, col, Math.max(0.18, 0.0017 * d), 0.12);
      }
    }
    if (out.due()) yield;
  }
}

// Light trails: long-exposure traffic as thin ribbons of light over each lane, in bunches.
// Near carriageway (towards the railway, traffic coming towards us): white; far: red.
function trailI(ws, wx, lane, Ls) {
  const flow = (0.55 + 0.45 * noise1(wx / 2600, ws + 60)) * Ls.traffic;
  const bunch = smooth(0.24, 0.56, noise1((wx + lane * 713) / 150, ws + 61 + lane));
  if (bunch <= 0) return 0;
  return flow * bunch * (0.5 + 0.5 * noise1(wx / 19 + lane * 5.3, ws + 62));
}
function* trails(ctx, out, W, R, Ls, dz) {
  if (!Ls.on) return;
  const ws = W.ws;
  const st = 1.2 / Math.min(1, Math.sqrt(out.density));
  const topo = dz.topology || 0;
  const loopy = (wx) => topo > 0 && noise1(wx / 1700, ws + 80) > 1 - 0.5 * topo;
  const doubled = (wx) => topo > 0 && noise1(wx / 2300, ws + 81) > 1 - 0.38 * topo;
  const m = topo > 0 ? 70 : 0;
  const first = Math.ceil((ctx.x0 - m) / st), last = Math.floor((ctx.x0 + ctx.length + m) / st);
  for (let g = first; g <= last; g++) {
    const wx = g * st;
    const inside = wx >= ctx.x0 && wx < ctx.x0 + ctx.length;
    rAt(R, wx);
    const D = RD, Y = RY;
    const q = quatXTo(1, RYS, -RS);
    for (let lane = 0; lane < 6; lane++) {
      const c = lane < 3 ? -1 : 1, k = lane % 3;
      // Every lane position gets a splat: vehicles run along the line (kit.js MOVE.TRAFFIC), and a
      // gap would swallow them. The bunching only shows as a long-exposure ribbon when motion is off.
      const I = trailI(ws, wx, lane, Ls);
      const d = D + c * (LANES[k] + 0.3 * (noise1(wx / 41, ws + 63 + lane) - 0.5));
      const col = c < 0 ? (k === 1 ? HEAD2 : HEAD) : TAIL;
      const y = Y + (c < 0 ? 0.62 : 0.78);
      const r = Math.max(0.06, 0.0007 * d) * (0.7 + 0.6 * I);
      const op = I < 0.04 ? 0.04 : Math.min(1, 0.45 + 0.7 * I);
      if (k === 1 && loopy(wx)) {
        // topology: this lane leaves the road and loops through the air (a prolate trochoid)
        const env = smooth(0, 0.25, noise1(wx / 1700, ws + 80) - (1 - 0.5 * topo));
        const A = 16 * topo * env, P = 110;
        const ph = (wx / P) * Math.PI * 2;
        const lx = wx - 1.9 * A * Math.sin(ph) - ctx.x0, ly = y + A * (1 - Math.cos(ph));
        const tx = 1 - 1.9 * A * Math.cos(ph) * (Math.PI * 2 / P), ty = A * Math.sin(ph) * (Math.PI * 2 / P);
        const tl = Math.hypot(tx, ty) || 1;
        const ql = quatXTo(tx / tl, ty / tl, 0);
        if (inBand(ctx, d)) out(lx, ly, -d, st * 0.75 * tl, r, r, col[0], col[1], col[2], op, ql[0], ql[1], ql[2], ql[3], KIND.LIGHT, MOVE.TRAFFIC_0 + k);
        continue;
      }
      if (!inside || !inBand(ctx, d)) continue;
      out(wx - ctx.x0, y, -d, st * 0.72, r, r, col[0], col[1], col[2], op, q[0], q[1], q[2], q[3], KIND.LIGHT, MOVE.TRAFFIC_0 + k);
      // (lorries are drawn by the shader, as longer vehicles with amber markers, in this lane)
      if (doubled(wx)) {
        // topology: a second motorway of light running above the first
        const lift = 24 + 8 * topo;
        out(wx - ctx.x0, y + lift, -d, st * 0.72, r, r, col[0], col[1], col[2], op, q[0], q[1], q[2], q[3], KIND.LIGHT, MOVE.TRAFFIC_0 + k);
      }
    }
    if (inside && doubled(wx) && (g % 3 === 0)) {
      const lift = 24 + 8 * topo;
      for (const c of [-1, 1]) {
        const d = D + c * 0.7;
        if (inBand(ctx, d)) out(wx - ctx.x0, Y + lift + 0.7, -d, st * 2.1, 0.06, 0.06, SODIUM[0], SODIUM[1], SODIUM[2], 0.35, q[0], q[1], q[2], q[3], KIND.LIGHT);
      }
    }
    if (out.due()) yield;
  }
}

// The central barrier, the hard-shoulder edge and the marker posts. In lit stretches the steel
// catches the lamps: drawn as faint light that swells under each lamp.
function* furniture(ctx, out, W, R, Ls, dz) {
  const st = 0.8 / Math.min(1, Math.sqrt(out.density));
  for (let g = Math.ceil(ctx.x0 / st); g * st < ctx.x0 + ctx.length; g++) {
    const wx = g * st;
    rAt(R, wx);
    const D = RD, Y = RY, x = wx - ctx.x0;
    if (!inBand(ctx, D)) continue;
    if (R.j && Math.abs(wx - R.j.jx) < 4) continue;
    const lit = Ls.on ? litIn(R.lit, wx) : null;
    const sx = st * 0.7, r = thin(D, 1.2);
    if (lit) {
      const col = stretchColor(lit, dz);
      const u = wx / LSP - Math.floor(wx / LSP);
      const near = Math.cos(u * Math.PI * 2) * 0.5 + 0.5;
      L(out, x, Y + 0.65, D, sx, r * 2.2, r, col, 0.16 + 0.4 * near * near);
    } else nat(out, x, Y + 0.65, D, sx, r * 2.2, r, C.steel);
    // hard-shoulder edge line and the verge kerb, a little lighter than the tarmac
    nat(out, x, Y + 0.03, D - EDGE, sx, 0.02, 0.1, [0.62, 0.62, 0.6], 1, KIND.GROUND);
    nat(out, x, Y + 0.03, D + EDGE, sx, 0.02, 0.1, [0.62, 0.62, 0.6], 1, KIND.GROUND);
    if (out.due()) yield;
  }
  // marker posts every 100 m on both verges, with a reflector catching the traffic
  for (const { wx0 } of cellsAround(ctx, 100, 0)) {
    rAt(R, wx0);
    for (const c of [-1, 1]) {
      const d = RD + c * 18.8, x = wx0 - ctx.x0;
      if (!inBand(ctx, d)) continue;
      nat(out, x, RY + 0.5, d, 0.07, 0.5, 0.07, [0.74, 0.74, 0.72]);
      if (Ls.on) L(out, x, RY + 0.85, d - 0.1, Math.max(0.07, 0.0008 * d), Math.max(0.07, 0.0008 * d), 0.04, c < 0 ? WHITE : AMBER, 0.55);
    }
  }
}

// A sign gantry spanning both carriageways at world x: lattice legs, a truss beam, blue direction
// signs and lane signals (amber lamps) facing the traffic on each side.
function* gantry(ctx, out, R, wx, Ls, rng, kind = KIND.OTHER) {
  rAt(R, wx);
  const D = RD, Y = RY, x = wx - ctx.x0;
  if (!inBand(ctx, D)) return;
  const r = thin(D, 1.6), rb = r * 0.6, steel = C.steel;
  const top = Y + 10.4, bot = Y + 9.4;
  for (const o of [-18.6, -0.7, 0.7, 18.6]) {
    for (const ex of [-0.35, 0.35]) bar(out, x + ex, Y - 0.2, D + o, x + ex, top, D + o, r, steel, 5, kind);
    for (let y = Y + 1; y < top - 1; y += 2.2) bar(out, x - 0.35, y, D + o, x + 0.35, y + 1.8, D + o, rb, steel, 1, kind);
  }
  bar(out, x, top, D - 18.6, x, top, D + 18.6, r, steel, 16, kind);
  bar(out, x, bot, D - 18.6, x, bot, D + 18.6, r, steel, 16, kind);
  for (let o = -18.6, s = 0; o < 18.6 - 0.1; o += 2.48, s++) bar(out, x, s & 1 ? top : bot, D + o, x, s & 1 ? bot : top, D + o + 2.48, rb, steel, 1, kind);
  if (out.due()) yield;
  // what hangs from it, for each carriageway: signs face the traffic (+x for the near side)
  for (const c of [-1, 1]) {
    const fx = x + c * -0.5;          // near carriageway traffic comes from +x: faces at +x
    const back = x - c * -0.05;
    const type = rng() < 0.5 ? 'sign' : 'signals';
    if (type === 'sign') {
      const o0 = c * 2.2, o1 = c * 13.2, y0 = Y + 5.3, h = 3.9;
      const da = D + Math.min(o0, o1), U = Math.abs(o1 - o0);
      const s = Math.max(0.3, detail(out, D, 1.2));
      const nu = Math.max(2, Math.round(U / (s * 1.4))), nv = Math.max(2, Math.round(h / (s * 1.4)));
      for (let a = 0; a < nu; a++) {
        for (let b = 0; b < nv; b++) {
          const dd = da + (a + 0.5) * U / nu, yy = y0 + (b + 0.5) * h / nv;
          const su = U / nu * 0.62, sv = h / nv * 0.62;
          out(back, yy, -dd, 0.04, sv, su, 0.3, 0.31, 0.32, 1, 0, 0, 0, 1, kind);
          const edge = a === 0 || b === 0 || a === nu - 1 || b === nv - 1;
          // the legend: a few rows of white, the rest dim blue in the lamps and headlights
          const legend = !edge && (b === nv - 2 || b === Math.floor(nv / 2)) && ((a * 7 + b * 3) % 5) < 3;
          if (Ls.on) L(out, fx, yy, dd, 0.04, sv, su, edge || legend ? WHITE : SIGN, edge ? 0.35 : legend ? 0.5 : 0.3);
          else out(fx, yy, -dd, 0.04, sv, su, edge || legend ? 0.75 : 0.1, edge || legend ? 0.75 : 0.22, edge || legend ? 0.75 : 0.55, 1, 0, 0, 0, 1, kind);
        }
        if (out.due()) yield;
      }
      // hangers from the beam
      for (const o of [o0 + c * 1, o1 - c * 1]) bar(out, x, y0 + h, D + o, x, bot, D + o, rb, steel, 1, kind);
    } else {
      // a signal over each lane: a dark box with four amber lamps at its corners (or a red ring)
      const mode = rng();
      for (const lo of LANES) {
        const dd = D + c * lo, yc = Y + 8.2;
        out(x - c * 0.22, yc, -dd, 0.28, 0.8, 0.8, 0.08, 0.08, 0.09, 1, 0, 0, 0, 1, kind);     // a box, not a plate
        out(fx, yc, -dd, 0.04, 0.75, 0.75, 0.05, 0.05, 0.06, 1, 0, 0, 0, 1, kind);
        bar(out, x, yc + 0.8, dd, x, bot, dd, rb, steel, 1, kind);
        if (!Ls.on) continue;
        const pr = Math.max(0.07, 0.0009 * dd);
        if (mode < 0.55) {
          for (const [a, b] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) L(out, fx + c * -0.04, yc + b, dd + a, 0.04, pr, pr, AMBER, 1);
        } else if (mode < 0.8) {
          for (let t = 0; t < 10; t++) { const a = t / 10 * Math.PI * 2; L(out, fx + c * -0.04, yc + 0.6 * Math.sin(a), dd + 0.6 * Math.cos(a), 0.04, pr * 0.8, pr * 0.8, RED, 1); }
          L(out, fx + c * -0.04, yc, dd - 0.15, 0.04, 0.25, 0.08, WHITE, 0.8);
          L(out, fx + c * -0.04, yc, dd + 0.18, 0.04, 0.25, 0.1, WHITE, 0.8);
        }
      }
    }
  }
  if (out.due()) yield;
}
// Gantries: candidates every 500 m of world x, more often in lit stretches; one before each
// junction on each carriageway. Logic: in some stretches the same gantry repeats every 14 m.
function* gantries(ctx, out, W, R, Ls, dz) {
  for (const { i, wx0 } of cellsAround(ctx, 500, 4)) {
    const gx = wx0 + 250;
    const h = worldHash(ctx, 111, i);
    const lit = litIn(R.lit, gx);
    if (R.j && Math.abs(gx - R.j.jx) < 700) continue;
    if (h > (lit ? 0.6 : 0.2)) continue;
    yield* gantry(ctx, out, R, gx, Ls, worldRng(ctx, 112, i));
  }
  if ((dz.logic || 0) > 0) {
    for (const { i, wx0 } of cellsAround(ctx, 14, 2)) {
      if (noise1(wx0 / 2600, W.ws + 113) > 0.12 + 0.6 * dz.logic) continue;
      yield* gantry(ctx, out, R, wx0, Ls, worldRng(ctx, 114), KIND.SURREAL);
      if (out.n > out.limit) return;
    }
  }
}

// Blue advance direction signs on posts on the verge before a junction.
function* junctionSigns(ctx, out, R, Ls) {
  const j = R.j;
  if (!j) return;
  for (const [ox, c] of [[850, -1], [1650, -1], [-850, 1], [-1650, 1]]) {
    const wx = j.jx + ox, x = wx - ctx.x0;
    if (x < -3 || x > ctx.length + 3) continue;
    rAt(R, wx);
    const d0 = RD + c * 20, Y = RY;
    if (!inBand(ctx, d0)) continue;
    const fx = x + c * -0.08;
    for (const o of [0.6, 4.4]) bar(out, x, Y - 0.2, d0 + c * o, x, Y + 2.6, d0 + c * o, thin(d0, 1.3), C.steel, 2);
    const s = 0.45;
    for (let a = 0; a < 5 / s; a++) {
      for (let b = 0; b < 3.2 / s; b++) {
        const dd = d0 + c * (a + 0.5) * s, yy = Y + 2.4 + (b + 0.5) * s;
        out(x - c * -0.05, yy, -dd, 0.04, s * 0.6, s * 0.6, 0.3, 0.31, 0.32, 1, 0, 0, 0, 1, KIND.OTHER);
        const legend = (b === 2 || b === 4) && a > 1 && a < 9 && (a + b) % 3;
        if (Ls.on) L(out, fx, yy, dd, 0.04, s * 0.6, s * 0.6, legend ? WHITE : SIGN, legend ? 0.45 : 0.24);
        else out(fx, yy, -dd, 0.04, s * 0.6, s * 0.6, legend ? 0.75 : 0.1, legend ? 0.75 : 0.22, legend ? 0.75 : 0.55, 1, 0, 0, 0, 1, KIND.OTHER);
      }
    }
    if (out.due()) yield;
  }
}

// A bridge across the motorway at world x: a deck on three piers, parapets, ramps down to the land
// at each end. The piers catch the traffic's light.
function* bridge(ctx, out, R, bx, deckY, w, Ls, lamps, ramps, hs = 26) {
  rAt(R, bx);
  const D = RD, Y = RY, x = bx - ctx.x0;
  const s = Math.max(0.5, detail(out, D, 1.4));
  const dark = [0.36, 0.35, 0.33];
  // deck: the two faces along x and the underside, from -26 to +26 across
  const span = 2 * hs, da = D - hs;
  const nu = Math.round(span / (s * 1.3));
  for (let a = 0; a < nu; a++) {
    const dd = da + (a + 0.5) * span / nu;
    if (!inBand(ctx, dd)) continue;
    for (const ex of [-w / 2, w / 2]) {
      for (let b = 0; b < 3; b++) out(x + ex, deckY - 1.1 + b * 0.55, -dd, 0.08, 0.32, span / nu * 0.62, dark[0] * (ex < 0 ? 1 : 0.7), dark[1] * (ex < 0 ? 1 : 0.7), dark[2] * (ex < 0 ? 1 : 0.7), 1, 0, 0, 0, 1, KIND.BUILDING);
      out(x + ex, deckY + 0.55, -dd, 0.12, 0.45, span / nu * 0.62, 0.45, 0.44, 0.42, 1, 0, 0, 0, 1, KIND.BUILDING);   // parapet
    }
    for (let b = 0; b < Math.max(1, Math.round(w / (s * 1.3))); b++) out(x - w / 2 + (b + 0.5) * w / Math.max(1, Math.round(w / (s * 1.3))), deckY - 1.2, -dd, w / Math.max(1, Math.round(w / (s * 1.3))) * 0.62, 0.08, span / nu * 0.62, 0.22, 0.22, 0.21, 1, 0, 0, 0, 1, KIND.BUILDING);
    if (out.due()) yield;
  }
  // piers, lit on their lower faces by the traffic passing beside them
  for (const o of [-17.6, 0, 17.6]) {
    const dd = D + o;
    if (!inBand(ctx, dd)) continue;
    for (const ex of [-w / 2 + 1, w / 2 - 1]) bar(out, x + ex, Y - 0.3, dd, x + ex, deckY - 1.2, dd, 0.45, [0.48, 0.47, 0.44], 4, KIND.BUILDING);
    if (Ls.on) {
      const c = o < 0 ? HEAD : o > 0 ? TAIL : HEAD2;
      L(out, x, Y + 1.4, dd + (o <= 0 ? -0.5 : 0.5) * 0 - 0.5, w / 2, 1.2, 0.3, c, o === 0 ? 0.12 : 0.18);
    }
  }
  // ramps up from the land on either side
  if (ramps) {
    for (const c of [-1, 1]) {
      for (let k = 0; k < 18; k++) {
        const o = hs + (k + 0.5) * 2.4, dd = D + c * o;
        if (!inBand(ctx, dd)) continue;
        const T = R.W.H(bx, dd);
        const yy = lerp(deckY, T, (k + 0.5) / 18);
        for (let b = -2; b <= 2; b++) out(x + b * w * 0.3, (yy + T) / 2, -dd, w * 0.25, Math.max(0.3, (yy - T) / 2 + 0.2), 1.6, 0.2, 0.26, 0.13, 1, 0, 0, 0, 1, KIND.GROUND);
      }
    }
  }
  if (lamps && Ls.on) {
    for (const o of [-hs + 4, hs - 4]) {
      const dd = D + o;
      if (!inBand(ctx, dd)) continue;
      bar(out, x - w / 2 - 0.3, deckY, dd, x - w / 2 - 0.3, deckY + 6, dd, thin(dd, 1.3), C.column, 2);
      point(out, x - w / 2 + 0.5, deckY + 6, dd, SODIUM, Math.max(0.14, 0.0017 * dd), 0.12);
      pool(out, x, deckY + 0.1, dd, 5, 5, SODIUM, 0.15);
    }
  }
}
function* overbridges(ctx, out, W, R, Ls) {
  for (let i = Math.floor((ctx.x0 - 40) / OCELL); i <= Math.floor((ctx.x0 + ctx.length + 40) / OCELL); i++) {
    const b = overbridge(W, i);
    if (!b || b.bx < ctx.x0 - 40 || b.bx > ctx.x0 + ctx.length + 40) continue;
    rAt(R, b.bx);
    const deck = Math.max(RY + 6.4, W.H(b.bx, RD - 26), W.H(b.bx, RD + 26));
    yield* bridge(ctx, out, R, b.bx, deck, b.w, Ls, b.lamps, true);
  }
}

// A lamp column standing on the ground with its head reaching dd metres across.
function* sideLamp(ctx, out, x, y, d, col, Ls, H = 10, reach = 0) {
  if (!inBand(ctx, d)) return;
  bar(out, x, y - 0.3, d, x, y + H, d, thin(d, 1.4), C.column, 3);
  if (Ls.on) {
    point(out, x, y + H, d - reach, col, Math.max(0.15, 0.0017 * d), 0.11);
    pool(out, x, y, d - reach, 9, 7, col, 0.12);
    pool(out, x, y, d - reach, 4, 3.2, col, 0.15);
  }
  if (out.due()) yield;
}

// Ribbons of trail light along a ground path (slip roads, roundabout ring, the out road).
//   path(t) -> [wx, d, y]; len in metres; colours: [col, offset across] pairs
function* pathTrails(ctx, out, W, path, len, lanes, Ls, salt, k = 1) {
  if (!Ls.on) return;
  const step = 1.6 / Math.min(1, Math.sqrt(out.density)) * k;
  const n = Math.ceil(len / step);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const [wx, d, y] = path(t);
    const [wx2, d2, y2] = path(Math.min(1, t + 0.5 / n));
    const [wx1, d1, y1] = path(Math.max(0, t - 0.5 / n));
    const dx = wx2 - wx1, dd = d2 - d1, dy = y2 - y1;
    const l = Math.hypot(dx, dd, dy) || 1;
    const q = quatXTo(dx / l, dy / l, -dd / l);
    const nx = -dd / l, nd = dx / l;          // across the path
    for (let k2 = 0; k2 < lanes.length; k2++) {
      const [col, off, h] = lanes[k2];
      const I = trailI(W.ws, t * len * 3.1 + salt * 977, k2 + 7, Ls) * 1.2;
      if (I < 0.05) continue;
      const pd = d + nd * off;
      if (!inBand(ctx, pd)) continue;
      const r = Math.max(0.05, 0.0006 * pd) * (0.6 + 0.8 * Math.min(1, I));
      out(wx + nx * off - ctx.x0, y + h, -pd, l * 0.75, r, r, col[0], col[1], col[2], Math.min(1, 0.3 + 0.7 * I), q[0], q[1], q[2], q[3], KIND.LIGHT);
    }
    if (out.due()) yield;
  }
}

// The junction: the bridge, two roundabouts ringed by lamps, four slip roads with their lamps and
// trails, and the lit road leaving the far roundabout (continued by the mid band).
function* junctionNearBand(ctx, out, W, R, Ls, dz) {
  const j = R.j;
  if (!j) return;
  const x = j.jx - ctx.x0;
  if (x < -560 || x > ctx.length + 560) return;
  const st = { led: j.led, key: j.seed };
  const col = stretchColor(st, dz);
  yield* bridge(ctx, out, R, j.jx, j.deck, 10, Ls, true, false, J_OFF - J_RING + 1);
  // slips
  for (const sx of [-1, 1]) {
    for (const c of [-1, 1]) {
      const Tr = c < 0 ? j.Tn : j.Tf;
      const path = (t) => {
        const wx = j.jx + sx * (J_RING + 380 * (1 - t));
        rAt(R, wx);
        return [wx, RD + slipO(c, t, J_REACH), lerp(RY, Tr, smooth(0.15, 0.85, t))];
      };
      // traffic on a slip: leaving (white towards us on the near side) and joining
      const leaving = (c < 0) === (sx > 0);
      yield* pathTrails(ctx, out, W, path, 390, [[c < 0 ? HEAD : TAIL, 0, c < 0 ? 0.62 : 0.78]], Ls, j.i * 8 + sx + 2 * c + (leaving ? 3 : 0));
      for (let k = 1; k < 10; k++) {
        const [wx, d, y] = path(k / 10);
        yield* sideLamp(ctx, out, wx - ctx.x0, y, d + c * 6, col, Ls, 10, c * 4.5);
      }
    }
  }
  // roundabouts
  for (const c of [-1, 1]) {
    const dc = j.D + c * J_OFF, Tc = c < 0 ? j.Tn : j.Tf;
    const ring = (t) => { const a = t * Math.PI * 2; return [j.jx + J_RING * Math.cos(a), dc + J_RING * Math.sin(a), Tc]; };
    yield* pathTrails(ctx, out, W, ring, J_RING * 6.3, [[HEAD, -2, 0.62], [TAIL, 2, 0.78]], Ls, j.i * 8 + 50 + c);
    for (let k = 0; k < 10; k++) {
      const a = (k + 0.25) / 10 * Math.PI * 2;
      const wx = j.jx + (J_RING + 6.5) * Math.cos(a), d = dc + (J_RING + 6.5) * Math.sin(a);
      yield* sideLamp(ctx, out, wx - ctx.x0, Tc, d, col, Ls, 10, 4.5 * Math.sin(a));
    }
    // the island: a low mound with a few shrubs
    const r = makeRng(hashInts(j.seed, 5, c));
    for (let k = 0; k < 6; k++) {
      const a = r() * Math.PI * 2, rr = (J_RING - 7) * Math.sqrt(r());
      const d = dc + rr * Math.sin(a);
      if (inBand(ctx, d)) yield* bush(ctx, out, x + rr * Math.cos(a), d, 3 + 3 * r(), 1.5 + r(), { rng: r, color: PAL.scrub });
    }
  }
  // the road leaving the far roundabout: lamps either side for 640 m, trails all the way
  yield* outRoad(ctx, out, W, j, Ls, col);
}
function* outRoad(ctx, out, W, j, Ls, col) {
  const d0 = j.D + J_OUT, d1 = j.D + J_OUT + j.outLen;
  const a = Math.max(d0, ctx.zNear), b = Math.min(d1, ctx.zFar);
  if (b <= a) return;
  const path = (t) => { const d = lerp(a, b, t); return [outX(j, d), d, W.H(outX(j, d), d)]; };
  const fade = ctx.layer === 'mid' ? 2.2 : 1;
  yield* pathTrails(ctx, out, W, path, b - a, [[HEAD, -1.8, 0.62], [TAIL, 1.8, 0.78]], Ls, j.i * 8 + 90, fade);
  for (let d = Math.ceil(a / 40) * 40; d < Math.min(b, d0 + 640); d += 40) {
    const side = (d / 40) & 1 ? 1 : -1;
    const wx = outX(j, d) + side * 6;
    yield* sideLamp(ctx, out, wx - ctx.x0, W.H(wx, d), d, col, Ls, 10, 0);
  }
  if (ctx.layer === 'near') {
    yield* strip2(ctx, out, W, (t) => { const d = lerp(a, b, t); return [outX(j, d), d]; }, b - a, 7, C.tarmac);
  }
}
// A flat road strip on my own ground (the kit's strip() would sit on the bare terrain).
function* strip2(ctx, out, W, path, len, width, color) {
  const rng = ctx.rng;
  const s = Math.max(width * 0.3, detail(out, path(0.5)[1], 1.6));
  const n = Math.round(len * width / (s * s * 1.4));
  for (let i = 0; i < n; i++) {
    const [wx, d] = path((i + rng()) / n);
    const dd = d + (rng() - 0.5) * width * 0.6;
    const c = jitter(color, rng, 0.06);
    out(wx + (rng() - 0.5) * width * 0.4 - ctx.x0, W.H(wx, dd) + 0.04, -dd, s, s * 0.08, s, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
}

// A service area beyond the far carriageway: a lit fuel canopy, a price totem, the main building
// with its glass front lit, floodlit car and lorry parks.
function* serviceArea(ctx, out, W, R, Ls, dz) {
  const s = R.s;
  if (!s) return;
  const x = s.sx - ctx.x0;
  if (x < -600 || x > ctx.length + 600) return;
  const r = makeRng(s.seed);
  const D = s.D, Tp = s.Tp;
  const brand = BRAND[s.brand];
  const col = s.led ? LED : SODIUM;
  // slip roads
  for (const sx of [-1, 1]) {
    const path = (t) => { const wx = s.sx + sx * (170 + 360 * (1 - t)); rAt(R, wx); return [wx, RD + slipO(1, t, 40), lerp(RY, Tp, smooth(0.1, 0.9, t))]; };
    yield* pathTrails(ctx, out, W, path, 370, [[TAIL, 0, 0.78]], Ls, s.i * 5 + sx);
    for (let k = 1; k < 9; k++) { const [wx, d, y] = path(k / 9); yield* sideLamp(ctx, out, wx - ctx.x0, y, d + 6, col, Ls, 10, 4.5); }
  }
  // the fuel canopy: posts, a roof whose underside glows, a band of brand colour round its edge
  {
    const cx = x - 95, cd = D + 62, cw = 38, cdp = 18, ch = Tp + 5.4;
    if (inBand(ctx, cd)) {
      for (const ox of [-14, 0, 14]) for (const od of [-5, 5]) bar(out, cx + ox, Tp, cd + od, cx + ox, ch, cd + od, 0.18, [0.6, 0.6, 0.6], 3);
      const sc = 1.4;
      for (let a = 0; a < cw / sc; a++) {
        for (let b = 0; b < cdp / sc; b++) {
          const px = cx - cw / 2 + (a + 0.5) * sc, pd = cd - cdp / 2 + (b + 0.5) * sc;
          if (Ls.on) L(out, px, ch - 0.05, pd, sc * 0.62, 0.05, sc * 0.62, CANOPY, 0.85);
          else nat(out, px, ch - 0.05, pd, sc * 0.62, 0.05, sc * 0.62, [0.7, 0.7, 0.7]);
          nat(out, px, ch + 0.5, pd, sc * 0.62, 0.05, sc * 0.62, [0.5, 0.5, 0.5]);
        }
        if (out.due()) yield;
      }
      // fascia: front and both ends
      for (let a = 0; a < cw / 0.9; a++) {
        const px = cx - cw / 2 + (a + 0.5) * 0.9;
        if (Ls.on) L(out, px, ch + 0.25, cd - cdp / 2 - 0.05, 0.56, 0.42, 0.06, brand, 0.95);
        else nat(out, px, ch + 0.25, cd - cdp / 2 - 0.05, 0.56, 0.42, 0.06, mul3(brand, 0.7));
      }
      for (const ex of [-1, 1]) for (let b = 0; b < cdp / 0.9; b++) {
        const pd = cd - cdp / 2 + (b + 0.5) * 0.9;
        if (Ls.on) L(out, cx + ex * cw / 2, ch + 0.25, pd, 0.06, 0.42, 0.56, brand, 0.95);
        else nat(out, cx + ex * cw / 2, ch + 0.25, pd, 0.06, 0.42, 0.56, mul3(brand, 0.7));
      }
      // pumps and the forecourt lit beneath
      for (const ox of [-10, 0, 10]) for (const od of [-3, 3]) natS(out, cx + ox, Tp + 0.9, cd + od, 0.5, 0.9, 0.35, [0.7, 0.7, 0.68]);
      if (Ls.on) { pool(out, cx, Tp, cd - 2, 26, 16, CANOPY, 0.2); pool(out, cx, Tp, cd - 2, 16, 9, CANOPY, 0.22); }
      if (out.due()) yield;
    }
  }
  // the price totem by the slip road
  {
    const tx = x - 170, td = D + 34, th = 9;
    if (inBand(ctx, td)) {
      for (let y = 0.25; y < th; y += 0.5) nat(out, tx, Tp + y, td + 0.3, 1.0, 0.3, 0.25, [0.3, 0.3, 0.32]);
      if (Ls.on) {
        for (let y = th - 2.2; y < th - 0.1; y += 0.42) L(out, tx, Tp + y, td, 0.95, 0.26, 0.06, brand, 0.95);
        for (let row = 0; row < 4; row++) {
          for (let dg = 0; dg < 4; dg++) {
            const y = Tp + th - 3.2 - row * 1.25;
            L(out, tx - 0.6 + dg * 0.32, y, td - 0.06, 0.1, 0.32, 0.05, row & 1 ? [0.2, 1.0, 0.3] : [1.0, 0.18, 0.1], 0.95);
          }
          L(out, tx + 0.55, Tp + th - 3.2 - row * 1.25, td - 0.06, 0.3, 0.3, 0.05, WHITE, 0.5);
        }
        pool(out, tx, Tp, td - 2, 4, 3, WHITE, 0.12);
      }
      if (out.due()) yield;
    }
  }
  // the main building: low, long, a glass front lit warm and a sign on the roof
  {
    const bx = x + 25, bd = D + 135, bw = 76, bdp = 26, bh = 8;
    if (inBand(ctx, bd)) {
      const sb = Math.max(0.6, detail(out, bd, 1.3));
      const wall = [0.46, 0.44, 0.42];
      yield* frontFace(out, bx - bw / 2, Tp - 0.2, bd - bdp / 2, bw, bh, sb, (a, b) => {
        if (b < 0.62 && b > 0.06 && (a * 19) % 1 > 0.1) return Ls.on ? { c: (a * 7) % 1 < 0.5 ? WARM[2] : WARM[0], o: 0.82 } : [0.12, 0.13, 0.15];
        return wall;
      });
      yield* sideFace(out, bx - bw / 2, Tp - 0.2, bd - bdp / 2, bdp, bh, sb * 1.4, () => mul3(wall, 1.1));
      yield* sideFace(out, bx + bw / 2, Tp - 0.2, bd - bdp / 2, bdp, bh, sb * 1.4, () => mul3(wall, 0.7));
      for (let a = 0; a < bw / sb / 1.5; a++) {
        for (let b = 0; b < bdp / sb / 2; b++) nat(out, bx - bw / 2 + (a + 0.5) * sb * 1.5, Tp + bh, bd - bdp / 2 + (b + 0.5) * sb * 2, sb, 0.1, sb * 1.3, [0.32, 0.32, 0.33]);
        if (out.due()) yield;
      }
      if (Ls.on) {
        for (let a = 0; a < 16; a++) L(out, bx - 12 + a * 1.6, Tp + bh + 1.2, bd - bdp / 2, 0.75, 0.6, 0.08, brand, 0.9);
        pool(out, bx, Tp, bd - bdp / 2 - 8, 40, 9, WARM[2], 0.1);
      }
    }
  }
  // car park and lorry park: tall floodlights with pools, rows of dark parked vehicles
  for (let k = 0; k < 8; k++) {
    const fx = x - 140 + k * 40, fd = D + 92 + (k & 1) * 4;
    if (!inBand(ctx, fd)) continue;
    bar(out, fx, Tp - 0.2, fd, fx, Tp + 15, fd, thin(fd, 1.8), C.column, 4);
    if (Ls.on) {
      for (const o of [-0.6, 0.6]) L(out, fx + o, Tp + 15, fd - 0.3, 0.3, 0.16, 0.12, LED, 1);
      L(out, fx, Tp + 15, fd - 0.2, 1, 0.6, 0.4, LED, 0.1);
      pool(out, fx, Tp, fd - 4, 20, 14, LED, 0.1);
      pool(out, fx, Tp, fd - 4, 9, 6, LED, 0.14);
    }
    if (out.due()) yield;
  }
  for (let k = 0; k < 40; k++) {
    const px = x - 60 + (k % 20) * 5.2 + r() * 0.6, pd = D + 100 + Math.floor(k / 20) * 14;
    if (r() < 0.35 || !inBand(ctx, pd)) continue;
    const cc = [[0.1, 0.1, 0.11], [0.5, 0.5, 0.52], [0.35, 0.1, 0.08], [0.1, 0.14, 0.28], [0.6, 0.6, 0.58]][Math.floor(r() * 5)];
    natS(out, px, Tp + 0.65, pd, 0.9, 0.42, 2.0, cc);
    natS(out, px, Tp + 1.2, pd + 0.2, 0.7, 0.3, 1.1, [0.1, 0.11, 0.13]);
    if (out.due()) yield;
  }
  for (let k = 0; k < 8; k++) {
    const lx = x + 95 + (k % 4) * 18, ld = D + 70 + Math.floor(k / 4) * 30;
    if (r() < 0.25 || !inBand(ctx, ld)) continue;
    yield* lorry(ctx, out, lx, Tp, ld, r, Ls, r() < 0.5 ? 'parked' : 'markers');
  }
}

// A lorry standing along x (cab towards -x): white or dark box trailer, cab, marker lights.
//   mode 'hazard': amber flashers lit (on the hard shoulder); 'markers': side markers; 'parked': cab light only
function* lorry(ctx, out, x, y, d, r, Ls, mode) {
  const len = 13.6, cabL = 2.4;
  const box = r() < 0.6 ? [0.72, 0.72, 0.7] : r() < 0.5 ? [0.3, 0.34, 0.4] : [0.5, 0.2, 0.15];
  const s = 0.9;
  // trailer: the side facing the camera, the far-side ends, the roof
  for (let a = 0; a < len / s; a++) {
    for (let b = 0; b < 3; b++) natS(out, x + 1 + (a + 0.5) * s, y + 1.3 + b * 0.95, d - 1.25, s * 0.62, 0.6, 0.06, mul3(box, b === 2 ? 1 : 0.92));
    natS(out, x + 1 + (a + 0.5) * s, y + 4.05, d, s * 0.62, 0.06, 1.25, mul3(box, 1.05));
  }
  for (const ex of [1, 1 + len]) for (let b = 0; b < 3; b++) natS(out, x + ex, y + 1.3 + b * 0.95, d, 0.06, 0.6, 1.2, mul3(box, 0.8));
  // cab
  for (let b = 0; b < 3; b++) natS(out, x - cabL / 2 + 0.5, y + 0.9 + b * 0.85, d - 1.2, cabL * 0.55, 0.5, 0.06, [0.22, 0.24, 0.3]);
  natS(out, x - cabL + 0.6, y + 1.8, d, 0.06, 1.0, 1.2, [0.2, 0.22, 0.27]);
  // wheels
  for (const wx of [x - 0.5, x + 9, x + 10.4, x + 11.8]) natS(out, wx, y + 0.5, d - 1.2, 0.5, 0.5, 0.15, [0.06, 0.06, 0.06]);
  if (!Ls.on) return;
  L(out, x - 0.6, y + 2.2, d - 1.26, 0.5, 0.3, 0.04, WARM[0], 0.5);     // a light on in the cab
  if (mode === 'parked') return;
  for (let a = 0; a < 5; a++) L(out, x + 2 + a * 3, y + 0.95, d - 1.3, 0.07, 0.07, 0.07, AMBER, 1);
  if (mode === 'hazard') {
    for (const [px, pd] of [[x - cabL + 0.5, d - 1.1], [x + 1 + len, d - 1.1]]) point(out, px, y + 1.1, pd - 0.1, AMBER, 0.16, 0.25, 3);
    for (const pd of [d - 0.9, d + 0.9]) point(out, x + 1 + len + 0.05, y + 1.1, pd, RED, 0.1, 0.2, 3);
  }
  if (out.due()) yield;
}
// A recovery truck behind a broken-down car on the hard shoulder: an amber beacon bar on the cab.
function* recovery(ctx, out, x, y, d, r, Ls) {
  const s = 0.7;
  // the car
  natS(out, x, y + 0.6, d, 2.0, 0.42, 0.85, [0.35, 0.1, 0.08]);
  natS(out, x - 0.25, y + 1.15, d, 1.1, 0.3, 0.7, [0.1, 0.11, 0.13]);
  // the truck behind it (towards +x: traffic comes from there): a cab and a flat bed as boxes with
  // their sides, ends and tops (it was a few plates facing the line, a yellow blob from the side)
  const tx = x + 8;
  vbox(out, tx + 3, y + 0.9, d, 8, 0.5, 2.3, [0.62, 0.6, 0.5], s, MOVE.STILL);
  vbox(out, tx - 2.4, y + 0.7, d, 2.2, 2.1, 2.3, [0.7, 0.62, 0.2], s * 0.7, MOVE.STILL);
  for (const wx of [tx - 2.2, tx + 4.5]) natS(out, wx, y + 0.5, d - 1.2, 0.5, 0.5, 0.15, [0.06, 0.06, 0.06]);
  if (!Ls.on) return;
  for (const o of [-0.5, 0, 0.5]) point(out, tx - 2.4, y + 3.1, d + o, AMBER, 0.13, 0.22, 3.5);
  for (const px of [x - 2, x + 2]) point(out, px, y + 0.7, d - 0.9, AMBER, 0.08, 0.2, 3);
  point(out, tx + 3, y + 0.8, d - 0.9, RED, 0.08, 0.15, 3);
  pool(out, tx - 2.4, y, d, 7, 5, AMBER, 0.08);
  if (out.due()) yield;
}
function* shoulderStops(ctx, out, W, R, Ls) {
  for (let i = Math.floor((ctx.x0 - 30) / HCELL); i <= Math.floor((ctx.x0 + ctx.length + 30) / HCELL); i++) {
    const h = shoulderStop(W, i);
    if (!h || h.hx < ctx.x0 - 30 || h.hx > ctx.x0 + ctx.length + 30) continue;
    rAt(R, h.hx);
    const d = RD - 14.2;
    if (!inBand(ctx, d)) continue;
    const r = makeRng(h.seed);
    if (h.kind === 'lorry') yield* lorry(ctx, out, h.hx - ctx.x0, RY, d, r, Ls, 'hazard');
    else yield* recovery(ctx, out, h.hx - ctx.x0, RY, d, r, Ls);
  }
}

// ---------------------------------------------------------------------------------------------
// The countryside
// ---------------------------------------------------------------------------------------------

// A farm: the house (front lit windows, a lit window in the gable), a barn and a yard light,
// a car with its lights on at the gate, a tree behind.
function* farmstead(ctx, out, W, f, Ls) {
  const r = makeRng(f.seed);
  const x = f.fx - ctx.x0, d = f.fd;
  const w = 9 + 3 * r(), dep = 6.5 + r(), h = 5.6;
  const y = Math.min(groundY(ctx, x - w / 2, d - dep / 2), groundY(ctx, x + w / 2, d - dep / 2), groundY(ctx, x, d + dep / 2)) - 0.3;
  const wall = WALLS[Math.floor(r() * WALLS.length)], roof = ROOFS[Math.floor(r() * ROOFS.length)];
  yield* house(ctx, out, x, d, { w, depth: dep, h, wall, roof, windows: false, rng: r, y });
  const front = d - dep / 2 - 0.08;
  const base = y + 0.4;
  // windows: two floors, three bays; some lit (warm), the rest dark glass
  const bays = [-w * 0.3, 0, w * 0.3];
  let lit = 0;
  for (let fl = 0; fl < 2; fl++) {
    for (let b = 0; b < 3; b++) {
      const wy = base + (fl ? 3.7 : 1.4);
      const on = Ls.on && (((b * 5 + fl * 3 + (f.seed & 7)) % 6) < f.windows);
      if (on) { lit++; L(out, x + bays[b], wy, front, 0.42, 0.5, 0.05, WARM[Math.floor(r() * WARM.length)], 0.9); }
      else nat(out, x + bays[b], wy, front, 0.42, 0.5, 0.05, [0.08, 0.09, 0.1], 1, KIND.BUILDING);
    }
  }
  if (Ls.on && r() < 0.6) L(out, x - w / 2 - 0.08, base + 4.6, d, 0.05, 0.42, 0.34, WARM[0], 0.85);
  if (Ls.on) pool(out, x, y + 0.3, front - 3, 4.5, 2.5, WARM[1], 0.08);
  // the barn
  const bx = x + (r() < 0.5 ? -1 : 1) * (17 + 5 * r()), bd = d + 6 + 8 * r(), bw = 18, bdp = 10;
  const by = Math.min(groundY(ctx, bx - bw / 2, bd - bdp / 2), groundY(ctx, bx + bw / 2, bd - bdp / 2)) - 0.3;
  yield* house(ctx, out, bx, bd, { w: bw, depth: bdp, h: 5, roofH: 2.6, wall: r() < 0.6 ? [0.17, 0.15, 0.13] : [0.36, 0.34, 0.31], roof: [0.42, 0.43, 0.42], windows: false, chimney: false, rng: r, y: by });
  if (f.yard) {
    const lx = bx - bw * 0.25, ly = by + 4.6, ld = bd - bdp / 2 - 0.25;
    const c = r() < 0.5 ? LED : SODIUM;
    if (Ls.on) {
      point(out, lx, ly, ld, c, 0.12, 0.2, 3);
      L(out, lx, ly - 1.6, ld + 0.15, 3.2, 2.0, 0.08, c, 0.12);          // the lit wall round it
      pool(out, lx, by + 0.3, ld - 5, 9, 6, c, 0.14);
      pool(out, lx, by + 0.3, ld - 3, 4, 3, c, 0.16);
    } else nat(out, lx, ly, ld, 0.25, 0.15, 0.2, [0.3, 0.3, 0.3]);
  }
  // a car at the gate, its headlights on, light on the lane ahead of it
  if (f.car) {
    const cx = x + (r() < 0.5 ? -1 : 1) * (w / 2 + 9), cd = front - 9, dir = r() < 0.5 ? -1 : 1;
    const cy = groundY(ctx, cx, cd);
    natS(out, cx, cy + 0.6, cd, 2.0, 0.42, 0.85, [0.2, 0.22, 0.24]);
    natS(out, cx - dir * 0.25, cy + 1.15, cd, 1.1, 0.3, 0.7, [0.1, 0.11, 0.13]);
    if (Ls.on) {
      for (const o of [-0.65, 0.65]) point(out, cx + dir * 2.05, cy + 0.68, cd + o, HEAD, 0.08, 0.3, 4);
      for (const o of [-0.65, 0.65]) point(out, cx - dir * 2.05, cy + 0.75, cd + o, RED, 0.06, 0.2, 3);
      pool(out, cx + dir * 9, cy, cd, 7, 2.2, HEAD, 0.14);
      L(out, cx + dir * 6, cy + 0.6, cd, 4, 0.4, 1.0, HEAD, 0.05);
    }
  }
  // a tree behind the house
  yield* broadleaf(ctx, out, x + (r() - 0.5) * 12, d + 9 + r() * 5, { height: 7 + 1.5 * r(), rng: r, color: PAL.foliage });
}
function* farms(ctx, out, W, Ls) {
  for (let i = Math.floor((ctx.x0 - 50) / FMCELL); i <= Math.floor((ctx.x0 + ctx.length + 50) / FMCELL); i++) {
    const f = farm(W, i);
    if (!f || !inBand(ctx, f.fd)) continue;
    if (f.fx < ctx.x0 - 50 || f.fx > ctx.x0 + ctx.length + 50) continue;
    yield* farmstead(ctx, out, W, f, Ls);
  }
}
function* ponds(ctx, out, W) {
  for (let i = Math.floor((ctx.x0 - 30) / PCELL); i <= Math.floor((ctx.x0 + ctx.length + 30) / PCELL); i++) {
    const p = pond(W, i);
    if (!p || !inBand(ctx, p.pd)) continue;
    const x = p.px - ctx.x0;
    if (x < -40 || x > ctx.length + 40) continue;
    const r = makeRng(hashInts(W.ws, 64, i));
    const y = W.H(p.px, p.pd) - 0.15;
    const s = Math.max(0.5, detail(out, p.pd, 1.2));
    const n = Math.round(Math.PI * p.rx * p.rz / (s * s * 1.5));
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r());
      const c = jitter(C.pond, r, 0.06);
      out(x + Math.cos(a) * rr * p.rx, y, -(p.pd + Math.sin(a) * rr * p.rz), s * 1.3, 0.03, s, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      if (out.due()) yield;
    }
    // reeds round the far edge
    for (let k = 0; k < 6; k++) { const a = Math.PI * (0.1 + 0.8 * r()); yield* bush(ctx, out, x + Math.cos(a) * p.rx, p.pd + Math.sin(a) * p.rz, 2 + 2 * r(), 1.2, { rng: r, color: [0.22, 0.26, 0.12] }); }
  }
}

// Hedges on the downs field grid, kept clear of the motorway; hedgerow trees thin and low.
function* hedges(ctx, out, W, R, dLo, dHi, opts = {}) {
  const F = W.F, P = 40;
  const rows = F.rows;
  for (let k = 1; k < rows.length; k++) {
    const q = rows[k];
    if (q.D + q.amp < dLo) continue;
    if (q.D - q.amp > dHi + 50) break;
    for (const { i, wx0 } of cellsAround(ctx, P, 2)) {
      const present = noise1(wx0 / 380, W.ws + k * 29 + 3);
      if (present < 0.3) continue;
      const d = downsLayout.edgeD(F, k, wx0 + P / 2);
      if (d < dLo || d >= dHi) continue;
      if (R && d < 340 && !clearOfRoad(W, R, wx0 + P / 2, d, 30)) continue;
      const rng = worldRng(ctx, 7, k, i);
      const path = (t) => { const wx = wx0 + t * P; return [wx - ctx.x0, downsLayout.edgeD(F, k, wx)]; };
      yield* hedge(ctx, out, path, P, { rng, height: 1.6 + 1.4 * noise1(wx0 / 900, W.ws + k), width: 2, gaps: present < 0.42 ? 0.6 : 0.15, wobbleSalt: k * 7, color: PAL.hedge, minR: opts.minR });
      if (opts.trees !== false && d > (opts.treeFrom || 90)) {
        const pT = 0.12 + 0.25 * noise1(wx0 / 1400, W.ws + 17);
        if (rng() < pT) {
          const wx = wx0 + rng() * P, dd = downsLayout.edgeD(F, k, wx) + (rng() - 0.5) * 2;
          yield* broadleaf(ctx, out, wx - ctx.x0, dd, { height: 6 + 2.5 * rng(), rng, color: PAL.foliage });
        }
      }
      if (out.n > out.limit) return;
    }
  }
}
// Where the motorway swings away, a belt of trees on its near side hides it.
function* shelterBelt(ctx, out, W, R) {
  for (const { i, wx0 } of cellsAround(ctx, 9, 6)) {
    roadDe(W, wx0);
    const away = smooth(0.78, 0.9, noise1(wx0 / 6400, W.ws + 13));
    if (away < 0.35) continue;
    rAt(R, wx0);
    const r = worldRng(ctx, 121, i);
    const d = RD - 34 - 6 * r();
    if (!inBand(ctx, d) || r() > away) continue;
    yield* broadleaf(ctx, out, wx0 + r() * 9 - ctx.x0, d, { height: 8 + 2 * r(), crown: 9 + 3 * r(), rng: r, color: PAL.foliage });
    if (out.n > out.limit) return;
  }
}
// Copses: downs wood fields, as trees (near) beyond the road only.
function* woods(ctx, out, W, R, dLo, dHi, sp) {
  const F = W.F;
  for (let gd = Math.floor(dLo / sp); gd * sp < dHi; gd++) {
    for (let gx = Math.floor((ctx.x0 - 10) / sp); gx * sp < ctx.x0 + ctx.length + 10; gx++) {
      const tr = worldRng(ctx, 13, gx, gd);
      const wx = (gx + tr()) * sp, d = (gd + tr()) * sp;
      if (d < Math.max(dLo, 150) || d >= dHi) continue;
      const f = downsLayout.fieldAt(F, wx, d);
      if (!f.wood) continue;
      if (R && d < 340 && !clearOfRoad(W, R, wx, d, 40)) continue;
      yield* broadleaf(ctx, out, wx - ctx.x0, d, { height: 6.5 + 2 * tr(), crown: sp * 1.5, rng: tr, color: PAL.foliage, n: Math.max(3, Math.round(treeSplats(out, d, sp * 1.5) * 0.5)) });
      if (out.n > out.limit) return;
    }
  }
}

// Field colour from the downs field grid (dark at night anyway), headlands a little greener.
function fieldColor(W, wx, d, rng) {
  const f = downsLayout.fieldAt(W.F, wx, d);
  let c = f.wood ? [0.1, 0.15, 0.08] : f.color;
  const m = noise2(wx / 31, d / 31, W.ws + 3);
  c = mul3(c, 0.5 + 0.25 * m);
  if (d > 1500) c = mix3(c, [0.22, 0.28, 0.17], smooth(1500, 6000, d) * 0.6);
  return jitter(c, rng, 0.05);
}
function surfColor(W, wx, d, rng) {
  switch (ST) {
    case S.ROAD: case S.SLIP: case S.OUT: return jitter(C.tarmac, rng, 0.05);
    case S.RES: return jitter(C.reserve, rng, 0.06);
    case S.VERGE: return jitter(C.verge, rng, 0.1);
    case S.BANK: return jitter(C.bank, rng, 0.12);
    case S.ISLAND: return jitter([0.2, 0.3, 0.14], rng, 0.1);
    case S.PARK: return jitter([0.24, 0.24, 0.25], rng, 0.05);
    default: return fieldColor(W, wx, d, rng);
  }
}
// Ground discs over a range of distances on the motorway-aware surface.
function* fillLand(ctx, out, W, R, opts) {
  const n = Math.floor(opts.n != null ? opts.n : out.left());
  if (n <= 0) return;
  const rng = ctx.rng;
  const dn = opts.dNear, df = opts.dFar;
  const p = opts.power, cover = opts.cover || 3;
  const minR = opts.minR || 0.0015, maxR = opts.maxR || 0.08;
  const Lx = ctx.length;
  const a1 = 1 - p, logD = Math.abs(a1) < 1e-6;
  const A = logD ? 0 : Math.pow(dn, a1), B = logD ? 0 : Math.pow(df, a1);
  const Z = logD ? Math.log(df / dn) : (B - A) / a1;
  for (let i = 0; i < n; i++) {
    const u = (i + rng()) / n;
    const d = logD ? dn * Math.pow(df / dn, u) : Math.pow(A + u * (B - A), 1 / a1);
    const x = rng() * Lx;
    const dens = (n * Math.pow(d, -p) / Z) / Lx;
    const r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
    const wx = ctx.x0 + x;
    const T = W.H(wx, d);
    if (R && d < 345) surf(W, R, wx, d, T); else { ST = S.FIELD; SY = T; SK = 0; }
    const c = opts.color ? opts.color(wx, d, rng, SY) : surfColor(W, wx, d, rng);
    const road = ST !== S.FIELD && ST !== S.BANK;
    const rr = road ? Math.min(r, 2.2) : r;
    const ax = 0.8 + 0.5 * rng();
    out(x, SY, -d, rr * ax, rr * (road ? 0.04 : d > 2500 ? 0.05 : Math.max(0.12, 0.9 * SK)), rr * (1.8 - ax) * (road ? 0.7 : 1), c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------------------------
const SHELF = 4.4, SHELF_Y = -0.35, FOOT = 11;
function tsY(ctx, x, d) { return d <= SHELF ? SHELF_Y : lerp(SHELF_Y, groundY(ctx, x, d), smooth(SHELF, FOOT, d)); }

function* trackside(ctx, emit) {
  const out = makeOut(ctx, emit, { zMargin: 1, detailK: 1.2 });
  const W = world(ctx);
  const Ls = lightState(ctx);
  out.limit = ctx.count * 0.5;

  yield* overheadLine(ctx, out, ctx.beatMetres || 56, { d: 3.7 });
  // cable trough on the cess: continuous along x, so it reads under blur
  const tStep = 0.45 / Math.min(1, Math.sqrt(out.density));
  for (let x = tStep / 2; x < ctx.length; x += tStep) {
    out(x, SHELF_Y + 0.12, -4.25, tStep * 0.68, 0.1, 0.2, 0.52, 0.51, 0.48, 1, 0, 0, 0, 1, KIND.OTHER);
    if (out.due()) yield;
  }
  // signals: a post with a head and one lit aspect, red or green; a relay cabinet now and then
  for (const { i, wx0 } of cellsAround(ctx, 700, 2)) {
    const r = worldRng(ctx, 201, i);
    if (r() > 0.55) continue;
    const x = wx0 + r() * 700 - ctx.x0, d = 6.5;
    const y0 = tsY(ctx, x, d);
    strut(out, x, y0, -d, x, SHELF_Y + 4.2, -d, 0.08, [0.3, 0.3, 0.3], 8, 1, KIND.MAST);
    out(x, SHELF_Y + 4.5, -d, 0.3, 0.55, 0.16, 0.06, 0.06, 0.06, 1, 0, 0, 0, 1, KIND.MAST);
    const green = r() < 0.55;
    point(out, x, SHELF_Y + 4.5 + (green ? -0.25 : 0.25), d - 0.18, green ? SIG_GREEN : RED, 0.07, 0.14, 2.2);
    if (out.due()) yield;
  }
  for (const { i, wx0 } of cellsAround(ctx, 160, 2)) {
    const r = worldRng(ctx, 203, i);
    if (r() > 0.35) continue;
    const x = wx0 + r() * 160 - ctx.x0, d = 5.0, w = 0.7 + 0.5 * r(), h = 1.1 + 0.3 * r();
    for (let t = 0; t < 3; t++) out(x, SHELF_Y + h * (t + 0.5) / 3, -d, w, h / 5, 0.35, 0.3, 0.36, 0.3, 1, 0, 0, 0, 1, KIND.OTHER);
    if (Ls.on && r() < 0.6) point(out, x + w * 0.6, SHELF_Y + h * 0.75, d - 0.4, r() < 0.5 ? WHITE : AMBER, 0.035, 0.15, 2.5);
  }
  // the boundary fence at the foot of the bank, brambles along it in stretches
  yield* fence(ctx, out, FOOT + 0.6, { spacing: 2.7 });
  for (const { i, wx0 } of cellsAround(ctx, 8, 4)) {
    if (ctx.terrain.stretch(wx0, 260, 43) < 0.5) continue;
    const r = worldRng(ctx, 205, i);
    if (r() < 0.5) yield* bush(ctx, out, wx0 + r() * 8 - ctx.x0, FOOT + 1.5 + r() * 2, 3 + 3 * r(), 0.6 + 0.9 * r(), { rng: r, color: PAL.scrub });
  }
  yield* hedges(ctx, out, W, null, FOOT + 3, ctx.zFar, { trees: false });

  // ground: ballast on the shelf, the bank, then the field at its foot
  out.limit = Infinity;
  const rest = out.left();
  const rng = ctx.rng;
  {
    const n = Math.round(rest * 0.07), area = ctx.length * (SHELF - 2.5), rr = Math.sqrt((3.5 * area) / (Math.PI * n));
    for (let i = 0; i < n; i++) {
      const x = rng() * ctx.length, d = 2.5 + rng() * (SHELF - 2.5);
      const c = jitter(PAL.ballast, rng, 0.22);
      out(x, SHELF_Y, -d, rr, rr * 0.15, rr, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      if (out.due()) yield;
    }
  }
  {
    const n = Math.round(rest * 0.3), area = ctx.length * (FOOT + 1 - SHELF), rr = Math.sqrt((3.5 * area) / (Math.PI * n));
    for (let i = 0; i < n; i++) {
      const x = rng() * ctx.length, d = SHELF + rng() * (FOOT + 1 - SHELF);
      const c = jitter(mix3([0.17, 0.24, 0.11], [0.3, 0.3, 0.2], noise2((ctx.x0 + x) / 5, d, W.ws + 9)), rng, 0.2);
      out(x, tsY(ctx, x, d), -d, rr, rr * 0.4, rr, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      if (out.due()) yield;
    }
  }
  yield* fillLand(ctx, out, W, chunkRoad(ctx, W, 40), { dNear: FOOT, dFar: ctx.zFar + 1, power: 1.2, cover: 4 });
}

function* near(ctx, emit) {
  const out = makeOut(ctx, emit, { detailK: 1.25 });
  const W = world(ctx);
  const Ls = lightState(ctx);
  const dz = ctx.dials || {};
  const R = chunkRoad(ctx, W, 600);
  out.limit = ctx.count * 0.5;
  // lights and the road first: they are what the view is about
  yield* motorwayLamps(ctx, out, W, R, Ls, dz);
  yield* trails(ctx, out, W, R, Ls, dz);
  yield* climbingLamps(ctx, out, W, R, Ls, dz);
  yield* junctionNearBand(ctx, out, W, R, Ls, dz);
  yield* serviceArea(ctx, out, W, R, Ls, dz);
  yield* furniture(ctx, out, W, R, Ls, dz);
  yield* gantries(ctx, out, W, R, Ls, dz);
  yield* junctionSigns(ctx, out, R, Ls);
  yield* overbridges(ctx, out, W, R, Ls);
  yield* shoulderStops(ctx, out, W, R, Ls);
  yield* stonehenge(ctx, out, W);
  out.limit = ctx.count * 0.62;
  yield* farms(ctx, out, W, Ls);
  yield* ponds(ctx, out, W);
  yield* shelterBelt(ctx, out, W, R);
  yield* hedges(ctx, out, W, R, ctx.zNear, ctx.zFar, { treeFrom: 100 });
  yield* woods(ctx, out, W, R, ctx.zNear, ctx.zFar, 9);
  out.limit = Infinity;
  yield* fillLand(ctx, out, W, R, { dNear: ctx.zNear, dFar: ctx.zFar, power: 1.45, cover: 3.2 });
}

// ---------------------------------------------------------------------------------------------
// Mid band
// ---------------------------------------------------------------------------------------------

// A floodlit church: nave and west tower (or spire), pale warm stone lit from below.
function* floodChurch(ctx, out, x, d, opts) {
  const { y, s, flood, spire, k = 1, kind = KIND.BUILDING } = opts;
  const lit = (b, side) => (flood ? { c: FLOOD, o: clamp((0.95 - 0.6 * b) * side, 0.12, 1) } : null);
  const stone = C.stone;
  // tower
  const tw = 6 * k, th = 20 * k, tx = x - 9 * k;
  yield* frontFace(out, tx - tw / 2, y, d - tw / 2, tw, th, s, (a, b) => (flood ? lit(b, 1) : mul3(stone, 0.8)), kind);
  yield* sideFace(out, tx - tw / 2, y, d - tw / 2, tw, th, s, (a, b) => (flood ? lit(b, 0.75) : stone), kind);
  yield* sideFace(out, tx + tw / 2, y, d - tw / 2, tw, th, s, (a, b) => (flood ? lit(b, 0.55) : mul3(stone, 0.6)), kind);
  // belfry louvres: dark slits
  for (const o of [-0.25, 0.25]) out(tx + o * tw, y + th * 0.8, -(d - tw / 2 - 0.1), Math.max(0.3, tw * 0.08), th * 0.07, 0.1, 0.05, 0.05, 0.05, 1, 0, 0, 0, 1, kind);
  if (spire) {
    const sh = 18 * k, n = Math.max(4, Math.round(sh / (s * 1.2)));
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, wd = tw * 0.5 * (1 - f);
      const c = flood ? { c: FLOOD, o: clamp(0.55 - 0.45 * f, 0.08, 1) } : null;
      for (const o of [-0.5, 0, 0.5]) {
        if (c) out(tx + o * wd, y + th + f * sh, -(d - tw / 4 * (1 - f)), Math.max(s * 0.4, wd * 0.4), sh / n * 0.62, s * 0.2, c.c[0], c.c[1], c.c[2], c.o, 0, 0, 0, 1, KIND.LIGHT);
        else out(tx + o * wd, y + th + f * sh, -(d - tw / 4 * (1 - f)), Math.max(s * 0.4, wd * 0.4), sh / n * 0.62, s * 0.2, 0.36, 0.37, 0.39, 1, 0, 0, 0, 1, kind);
      }
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const px = tx - tw / 2 + (i + 0.5) * tw / 4;
      if (flood && (i === 0 || i === 3)) out(px, y + th + 1.2 * k, -(d - tw / 2), tw / 10, 1.2 * k, 0.2, FLOOD[0], FLOOD[1], FLOOD[2], 0.6, 0, 0, 0, 1, KIND.LIGHT);
      else out(px, y + th + 0.5 * k, -(d - tw / 2), tw / 10, 0.5 * k, 0.2, 0.35, 0.33, 0.29, 1, 0, 0, 0, 1, kind);
    }
  }
  // nave: lit lower walls, dark roof; a couple of coloured windows glowing faintly
  const nw = 18 * k, nh = 8 * k, nd = 8 * k;
  yield* frontFace(out, tx + tw / 2, y, d - nd / 2, nw, nh, s * 1.2, (a, b) => {
    if (b > 0.3 && b < 0.7 && (a * 5) % 1 > 0.4 && (a * 5) % 1 < 0.6) return [0.06, 0.06, 0.07];
    return flood ? lit(b, 0.7) : mul3(stone, 0.8);
  }, kind);
  yield* sideFace(out, tx + tw / 2 + nw, y, d - nd / 2, nd, nh, s * 1.4, () => mul3(stone, 0.6), kind);
  const rs = s * 1.3;
  for (let a = 0; a < nw / rs; a++) for (let b = 0; b < 3; b++) out(tx + tw / 2 + (a + 0.5) * rs, y + nh + b * nh * 0.18, -(d - nd / 2 + b * nd * 0.2), rs * 0.62, nh * 0.1, nd * 0.13, 0.26, 0.26, 0.28, 1, 0, 0, 0, 1, kind);
  if (out.due()) yield;
}

// A village: house silhouettes, warm windows, street lamps, often a floodlit church.
function* villages(ctx, out, W, Ls, dz) {
  for (let i = Math.floor((ctx.x0 - 300) / VCELL); i <= Math.floor((ctx.x0 + ctx.length + 300) / VCELL); i++) {
    const v = village(W, i);
    if (!v) continue;
    if (v.dc + v.R < ctx.zNear || v.dc - v.R >= ctx.zFar) continue;
    if (v.cx + v.R * 1.5 < ctx.x0 || v.cx - v.R * 1.5 > ctx.x0 + ctx.length) continue;
    const r = makeRng(v.seed);
    const s = Math.max(1, detail(out, v.dc, 1.3));
    const lampC = v.led ? LED : SODIUM;
    for (let k = 0; k < v.n; k++) {
      const wx = v.cx + r.gauss() * v.R * 0.45, d = v.dc + r.gauss() * v.R * 0.25;
      const w = 7 + 5 * r(), h = 5 + 2 * r(), lit = r() < Ls.lit * 1.6;
      const u = r();
      if (!inBand(ctx, d)) continue;
      const x = wx - ctx.x0, y = W.H(wx, d) - 0.3;
      const wall = WALLS[Math.floor(u * WALLS.length)];
      // the house as a few flat splats: wall and roof
      const nx = Math.max(1, Math.round(w / (s * 1.5)));
      for (let a = 0; a < nx; a++) {
        out(x - w / 2 + (a + 0.5) * w / nx, y + h / 2, -d, w / nx * 0.65, h / 2 * 0.9, 0.3, wall[0] * 0.8, wall[1] * 0.8, wall[2] * 0.8, 1, 0, 0, 0, 1, KIND.BUILDING);
        out(x - w / 2 + (a + 0.5) * w / nx, y + h + 1.2, -(d + 1.5), w / nx * 0.7, 1.4, 1.5, 0.22, 0.22, 0.24, 1, 0, 0, 0, 1, KIND.BUILDING);
      }
      // both end walls, so the house is a box and not a card when it stands off to one side
      for (const e of [-1, 1]) out(x + e * w / 2, y + h / 2, -(d + 2.2), 0.3, h / 2 * 0.9, 2.2, wall[0] * (e < 0 ? 0.9 : 0.55), wall[1] * (e < 0 ? 0.9 : 0.55), wall[2] * (e < 0 ? 0.9 : 0.6), 1, 0, 0, 0, 1, KIND.BUILDING);
      if (Ls.on && lit) {
        const nwin = 1 + (u * 7 & 1);
        for (let t = 0; t < nwin; t++) {
          const c = WARM[(k + t) % WARM.length];
          const ws = Math.max(0.5, 0.0011 * d);
          L(out, x + (t ? 1 : -1) * w * 0.22, y + (t ? 4 : 1.6), d - 0.4, ws, ws * 1.1, 0.1, c, 0.85);
        }
      }
      if (out.due()) yield;
    }
    // street lamps along the main street (parallel to the line) and down the lane through it
    if (Ls.on) {
      const nl = Math.round(v.R / 22);
      for (let k = -nl; k <= nl; k++) {
        const wx = v.cx + k * 30, d = v.dc - 4;
        if (!inBand(ctx, d)) continue;
        const x = wx - ctx.x0, y = W.H(wx, d);
        point(out, x, y + 6, d, lampC, Math.max(0.3, 0.0017 * d), d < 900 ? 0.1 : 0);
        if (d < 900) pool(out, x, y, d, 8, 5, lampC, 0.1);
      }
      for (let k = 1; k < nl; k++) {
        const d = v.dc + k * 26;
        if (!inBand(ctx, d)) continue;
        const wx = v.cx + 8, x = wx - ctx.x0;
        point(out, x, W.H(wx, d) + 6, d, lampC, Math.max(0.3, 0.0017 * d), 0);
      }
    }
    if (v.church && inBand(ctx, v.dc + 18)) {
      const wx = v.cx + 20, d = v.dc + 18;
      const sc = Math.max(0.6, detail(out, d, 1.4));
      yield* floodChurch(ctx, out, wx - ctx.x0, d, { y: W.H(wx, d) - 0.4, s: sc, flood: v.flood && Ls.on, spire: v.spire });
      if (v.flood && Ls.on) for (const o of [-6, 6]) point(out, wx - 9 + o - ctx.x0, W.H(wx, d) + 0.5, d - 14, FLOOD, Math.max(0.25, 0.0012 * d), 0);
    }
    // a few trees round the village, dark
    for (let k = 0; k < 8; k++) {
      const wx = v.cx + (r() - 0.5) * v.R * 2.4, d = v.dc + 10 + r() * v.R * 0.6;
      if (!inBand(ctx, d)) continue;
      yield* broadleaf(ctx, out, wx - ctx.x0, d, { height: 7 + 2 * r(), rng: r, color: PAL.foliage, n: Math.max(4, Math.round(treeSplats(out, d, 10) * 0.4)) });
    }
  }
}

// Isolated farm and cottage lights scattered over the dark land (mid and far): a window or a yard light.
function* scatterLights(ctx, out, W, Ls, cell, p, salt) {
  if (!Ls.on) return;
  const ws = W.ws;
  for (let gd = Math.floor(ctx.zNear / cell); gd * cell < ctx.zFar; gd++) {
    for (let gx = Math.floor(ctx.x0 / cell); gx * cell < ctx.x0 + ctx.length; gx++) {
      const h = hashInts(ws, salt, gx, gd);
      if ((h & 1023) / 1024 > p) continue;
      const wx = (gx + ((h >>> 10) & 255) / 256) * cell, d = (gd + ((h >>> 18) & 255) / 256) * cell;
      if (!inBand(ctx, d) || wx < ctx.x0 || wx >= ctx.x0 + ctx.length) continue;
      const u = (h >>> 26) / 64;
      const c = u < 0.3 ? SODIUM : u < 0.45 ? LED : WARM[(h >>> 3) & 3];
      const rr = Math.max(0.35, 0.0011 * d) * (u < 0.45 ? 1.1 : 0.85);
      L(out, wx - ctx.x0, W.H(wx, d) + 3, d, rr, rr, rr, c, 0.75 + 0.25 * u);
      if (u < 0.12) L(out, wx - ctx.x0 + 0.004 * d, W.H(wx, d) + 2, d, rr * 0.8, rr * 0.8, rr, WARM[0], 0.8);
    }
    if (out.due()) yield;
  }
}

// A lattice pylon (silhouette only), 46 m, three cross-arms; returns the conductor attachment points.
const PY_LEV = [0, 8, 15, 21, 26, 30, 34, 38, 42, 46];
const pyHalf = (y) => (y < 30 ? 4.2 - 3.2 * (y / 30) : 1.0 - 0.45 * ((y - 30) / 16));
function* pylon(ctx, out, x, d, y0, px, pd) {
  // px, pd: unit direction across the line (the cross-arms run along it)
  const steel = [0.44, 0.45, 0.45];
  const r = Math.max(0.12, 0.00045 * d), rb = r * 0.6;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const at = (c, y) => [x + c[0] * pyHalf(y), y0 + y, d + c[1] * pyHalf(y)];
  for (const c of corners) bar(out, ...at(c, -0.3), ...at(c, 30), r, steel, 4, KIND.MAST);
  for (const c of corners) bar(out, ...at(c, 30), ...at(c, 46), r * 0.85, steel, 2, KIND.MAST);
  if (d < 1400) {
    const a = corners[0], b = corners[1];
    for (let i = 0; i + 1 < PY_LEV.length; i++) bar(out, ...at(i & 1 ? a : b, PY_LEV[i]), ...at(i & 1 ? b : a, PY_LEV[i + 1]), rb, steel, 2, KIND.MAST);
  }
  for (const [ay, hl] of [[31, 8.5], [37, 9.5], [43, 7.5]]) bar(out, x - px * hl, y0 + ay, d - pd * hl, x + px * hl, y0 + ay, d + pd * hl, r * 0.8, steel, 4, KIND.MAST);
  bar(out, x, y0 + 46, d, x, y0 + 49, d, r * 0.6, steel, 1, KIND.MAST);
  if (out.due()) yield;
}
const PLCELL = 7000;
function pylonLine(W, i) {
  return cache(W.lm, 'p' + i, () => {
    const r = makeRng(hashInts(W.ws, 91, i));
    if (r() > 0.6) return null;
    return { wx0: (i + 0.2 + 0.6 * r()) * PLCELL, slope: (r() - 0.5) * 1.6 };
  });
}
function* pylons(ctx, out, W) {
  const SP = 330;
  for (let i = Math.floor((ctx.x0 - 3000) / PLCELL); i <= Math.floor((ctx.x0 + ctx.length + 3000) / PLCELL); i++) {
    const pl = pylonLine(W, i);
    if (!pl) continue;
    const len = Math.hypot(pl.slope, 1);
    const ux = pl.slope / len, ud = 1 / len;       // along the line
    const px = ud, pd = -ux;                         // across it
    const P = [];
    for (let k = 0; k < 12; k++) { const d = 330 + k * SP; const wx = pl.wx0 + pl.slope * (d - 330); P.push({ wx, d, y: W.H(wx, d) }); }
    for (let k = 0; k < P.length; k++) {
      const p = P[k];
      if (inBand(ctx, p.d) && p.wx > ctx.x0 - 20 && p.wx < ctx.x0 + ctx.length + 20) yield* pylon(ctx, out, p.wx - ctx.x0, p.d, p.y, px, pd);
      if (k + 1 >= P.length) break;
      const p2 = P[k + 1];
      if (p2.d < ctx.zNear || p.d >= ctx.zFar) continue;
      for (const [ay, hl] of [[31, 8.5], [37, 9.5], [43, 7.5]]) {
        for (const sgn of [-1, 1]) {
          const ya = p.y + ay - 3, yb = p2.y + ay - 3;
          const steps = Math.ceil(SP * len / Math.max(1.5, 0.005 * p.d));
          const rr = Math.max(0.04, 0.0005 * p.d);
          for (let s = 0; s < steps; s++) {
            const t = (s + 0.5) / steps;
            const d = lerp(p.d, p2.d, t) + sgn * pd * hl;
            if (!inBand(ctx, d)) continue;
            const wx = lerp(p.wx, p2.wx, t) + sgn * px * hl;
            const x = wx - ctx.x0;
            if (x < 0 || x >= ctx.length) continue;
            const y = lerp(ya, yb, t) - 11 * 4 * t * (1 - t);
            const q = quatXTo(ux, (yb - ya) / (SP * len) - 11 * 4 * (1 - 2 * t) / (SP * len), -ud);
            out(x, y, -d, SP * len / steps * 0.6, rr, rr, 0.2, 0.2, 0.2, 0.9, q[0], q[1], q[2], q[3], KIND.WIRE);
          }
          if (out.due()) yield;
        }
      }
    }
  }
}

// A distant A-road across the mid band: a faint string of trail light.
function aRoadD(W, wx) { return 1250 + 1200 * noise1(wx / 4200, W.ws + 71); }
function* aRoad(ctx, out, W, Ls) {
  if (!Ls.on) return;
  const st = 4 / Math.min(1, Math.sqrt(out.density));
  for (let g = Math.ceil(ctx.x0 / st); g * st < ctx.x0 + ctx.length; g++) {
    const wx = g * st;
    const D = aRoadD(W, wx), D2 = aRoadD(W, wx + st);
    const y = W.H(wx, D);
    for (const [c, off, h, lane] of [[HEAD, -2.5, 0.7, 11], [TAIL, 2.5, 0.85, 12]]) {
      const I = trailI(W.ws, wx * 1.7, lane, Ls);
      if (I < 0.08) continue;
      const d = D + off;
      if (!inBand(ctx, d)) continue;
      const r = Math.max(0.3, 0.0009 * d) * (0.6 + 0.6 * I);
      const q = quatXTo(1, 0, -(D2 - D) / st);
      out(wx - ctx.x0, y + h, -d, st * 0.75, r, r, c[0], c[1], c[2], Math.min(1, 0.25 + 0.7 * I), q[0], q[1], q[2], q[3], KIND.LIGHT);
    }
    if (out.due()) yield;
  }
}

// Woods as dark low clumps (mid and far): silhouettes against the sky.
function* clumps(ctx, out, W, S, n, budget, minD = 0) {
  for (const { i, wx0 } of cellsAround(ctx, S, 10)) {
    for (let gd = Math.floor(ctx.zNear / S); gd * S < ctx.zFar; gd++) {
      const d = (gd + 0.5) * S;
      const w = noise2(wx0 / 2200, d / 2200, W.ws + 201);
      if (w < 0.56 || d < minD) continue;
      const r = worldRng(ctx, 33, i, gd);
      const wx = wx0 + r() * S, dd = d + (r() - 0.5) * S;
      if (!inBand(ctx, dd)) continue;
      const sz = S * (0.3 + 0.4 * r());
      const ht = Math.min(sz * 0.25, 5 + 3 * r());
      yield* blob(ctx, out, wx - ctx.x0, W.H(wx, dd) + ht * 0.6, dd, sz, ht, sz * 0.6, { n, color: [0.1, 0.16, 0.09], rng: r, kind: KIND.TREE, inner: 0.2, amb: 0.65 });
      if (out.n > budget) return;
    }
  }
}

function* mid(ctx, emit) {
  const out = makeOut(ctx, emit, { detailK: 1.9 });
  const W = world(ctx);
  const Ls = lightState(ctx);
  const dz = ctx.dials || {};
  out.limit = ctx.count * 0.62;
  // the out road from a junction carries on into the mid band
  for (let i = Math.floor((ctx.x0 - 1200) / JCELL); i <= Math.floor((ctx.x0 + ctx.length + 1200) / JCELL); i++) {
    const j = junction(W, i);
    if (!j) continue;
    const st = { led: j.led, key: j.seed };
    yield* outRoad(ctx, out, W, j, Ls, stretchColor(st, dz));
  }
  yield* aRoad(ctx, out, W, Ls);
  yield* villages(ctx, out, W, Ls, dz);
  yield* scatterLights(ctx, out, W, Ls, 420, 0.22, 301);
  yield* landmarks(ctx, out, W, Ls, dz);
  yield* pylons(ctx, out, W);
  yield* hedges(ctx, out, W, null, ctx.zNear, 1300, { trees: true, treeFrom: 300, minR: 0.5 });
  yield* clumps(ctx, out, W, 150, Math.max(3, Math.round(14 * Math.sqrt(out.density))), ctx.count * 0.6);
  out.limit = Infinity;
  // the motorway's far bank, where it reaches past 300 m
  const R = chunkRoad(ctx, W, 50);
  yield* fillLand(ctx, out, W, R, { dNear: ctx.zNear, dFar: ctx.zFar, power: 1.25, cover: 3, maxR: 0.05 });
}

// ---------------------------------------------------------------------------------------------
// Landmarks (mid and far): each element is drawn by the band its distance falls in
// ---------------------------------------------------------------------------------------------
const farR = (d, k = 1) => Math.max(0.6, 0.0014 * d) * k;

function* town(ctx, out, W, lm, Ls, cx, cd, R, n0) {
  const r = makeRng(hashInts(lm.seed, 3));
  const n = Math.round(n0 * Math.sqrt(Math.min(1.5, out.density)));
  for (let k = 0; k < n; k++) {
    const a = r.gauss() * 0.45, b = r.gauss() * 0.28;
    const wx = cx + a * R, d = cd + b * R;
    const u = r(), u2 = r();
    if (!inBand(ctx, d)) continue;
    const x = wx - ctx.x0;
    if (x < 0 || x >= ctx.length) continue;
    const core = Math.exp(-(a * a + b * b) * 3);
    const y = W.H(wx, d) + 4 + 18 * u2 * core;
    if (!Ls.on) { if (u < 0.3) out(x, y, -d, 0.004 * d, 0.002 * d, 0.004 * d, 0.4, 0.4, 0.4, 1, 0, 0, 0, 1, KIND.BUILDING); continue; }
    const c = u < 0.5 ? SODIUM : u < 0.72 ? WARM[(k & 3)] : LED;
    L(out, x, y, d, farR(d, 0.7 + 0.5 * u2), farR(d, 0.6 + 0.4 * u2), farR(d), c, 0.55 + 0.45 * u2);
    if (out.due()) yield;
  }
  // a couple of taller buildings with red lights; the glow dome kept low on the horizon
  if (Ls.on) {
    for (let k = 0; k < 2; k++) {
      const wx = cx + (r() - 0.5) * R * 0.4, d = cd + (r() - 0.5) * R * 0.2;
      if (!inBand(ctx, d)) continue;
      point(out, wx - ctx.x0, W.H(wx, d) + 45 + 30 * r(), d, RED, farR(d, 0.8), 0);
    }
    if (inBand(ctx, cd)) {
      const y = W.H(cx, cd);
      L(out, cx - ctx.x0, y + 30, cd + 300, R * 0.85, 70, 400, [1.0, 0.6, 0.32], 0.05 * Ls.night);
      L(out, cx - ctx.x0, y + 15, cd + 300, R * 0.5, 45, 300, [1.0, 0.62, 0.34], 0.05 * Ls.night);
    }
  }
}

function* cathedral(ctx, out, W, lm, Ls, dz) {
  const giant = (dz.scale || 0) > 0 && lm.giant < 0.4 + 0.5 * dz.scale;
  const k = giant ? 1 + 11 * dz.scale : 1;
  const d = lm.d, x = lm.x - ctx.x0;
  // a small city round it
  yield* town(ctx, out, W, lm, Ls, lm.x - 250, d + 250, lm.R, 320);
  if (!inBand(ctx, d)) return;
  if (x < -1500 * k || x > ctx.length + 1500 * k) return;
  const y = W.H(lm.x, d) - 1;
  const s = Math.max(1.2, 0.0016 * d / Math.sqrt(Math.min(1, out.density)));
  const on = Ls.on;
  const lit = (b, side) => (on ? { c: FLOOD, o: clamp((1 - 0.4 * b) * side, 0.15, 1) } : null);
  const kind = giant ? KIND.SURREAL : KIND.BUILDING;
  const stone = C.stone;
  // nave and choir: long walls with buttressed bays, dark roof
  const nl = 170 * k, nh = 30 * k, nd = 36 * k, x0 = x - nl / 2;
  yield* frontFace(out, x0, y, d - nd / 2, nl, nh, s, (a, b) => ((a * 14) % 1 < 0.15 ? (on ? { c: FLOOD, o: 0.35 } : mul3(stone, 0.6)) : (on ? lit(b, 0.8) : mul3(stone, 0.8))), kind);
  for (let a = 0; a < nl / (s * 1.5); a++) for (let b = 0; b < 3; b++) out(x0 + (a + 0.5) * s * 1.5, y + nh + b * 6 * k, -(d - nd / 2 + 5 * k * b), s, 3 * k, 4 * k, 0.22, 0.22, 0.24, 1, 0, 0, 0, 1, kind);
  yield* sideFace(out, x0 + nl, y, d - nd / 2, nd, nh, s * 1.3, (a, b) => (on ? lit(b, 0.5) : mul3(stone, 0.6)), kind);
  // west front: two towers
  for (const o of [-11, 11]) {
    const tw = 15 * k, th = 82 * k, tx = x0 + o * k - 4 * k;
    yield* frontFace(out, tx - tw / 2, y, d - nd / 2 - 2, tw, th, s, (a, b) => (on ? lit(b, 1) : mul3(stone, 0.85)), kind);
    // (and the sides, so the towers keep their depth from either end of the window)
    yield* sideFace(out, tx - tw / 2, y, d - nd / 2 - 2, tw, th, s * 1.3, (a, b) => (on ? lit(b, 0.8) : stone), kind);
    yield* sideFace(out, tx + tw / 2, y, d - nd / 2 - 2, tw, th, s * 1.3, (a, b) => (on ? lit(b, 0.55) : mul3(stone, 0.6)), kind);
    for (const ex of [-0.45, 0.45]) {
      if (on) L(out, tx + ex * tw, y + th + 4 * k, d - nd / 2 - 2, s * 0.6, 4 * k, s * 0.3, FLOOD, 0.55);
      else out(tx + ex * tw, y + th + 4 * k, -(d - nd / 2 - 2), s * 0.6, 4 * k, s * 0.3, 0.5, 0.48, 0.42, 1, 0, 0, 0, 1, kind);
    }
  }
  // central tower and spire
  {
    const tw = 20 * k, th = 100 * k, tx = x + 14 * k;
    yield* frontFace(out, tx - tw / 2, y, d - 3, tw, th, s, (a, b) => (on ? lit(b, 0.95) : mul3(stone, 0.85)), kind);
    yield* sideFace(out, tx + tw / 2, y, d - 3, tw, th, s * 1.3, (a, b) => (on ? lit(b, 0.55) : mul3(stone, 0.6)), kind);
    yield* sideFace(out, tx - tw / 2, y, d - 3, tw, th, s * 1.3, (a, b) => (on ? lit(b, 0.8) : stone), kind);
    const sh = 68 * k, n = Math.max(5, Math.round(sh / s));
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, wd = tw * 0.45 * (1 - f);
      if (on) L(out, tx, y + th + f * sh, d - 3, Math.max(s * 0.4, wd), sh / n * 0.6, s * 0.3, FLOOD, clamp(0.7 - 0.5 * f, 0.15, 1));
      else out(tx, y + th + f * sh, -(d - 3), Math.max(s * 0.4, wd), sh / n * 0.6, s * 0.3, 0.42, 0.42, 0.42, 1, 0, 0, 0, 1, kind);
    }
    if (on) point(out, tx, y + th + sh + 3 * k, d - 3, RED, farR(d, 0.8), 0);
  }
  if (out.due()) yield;
}

function* mast(ctx, out, W, lm, Ls) {
  const d = lm.d, x = lm.x - ctx.x0;
  if (!inBand(ctx, d) || x < -20 || x > ctx.length + 20) return;
  const y = W.H(lm.x, d), h = lm.h;
  const r = Math.max(1.2, 0.0004 * d);
  bar(out, x, y, d, x, y + h, d, r, [0.5, 0.5, 0.5], 14, KIND.MAST);
  for (const [a, b] of [[-1, 0], [1, 0], [0, 1]]) bar(out, x, y + h * 0.66, d, x + a * h * 0.45, y, d + b * h * 0.45, r * 0.4, [0.4, 0.4, 0.4], 8, KIND.WIRE, 0.5);
  // aircraft warning lights burn day and night
  for (let k = 1; k <= 6; k++) point(out, x, y + h * k / 6, d, RED, farR(d, k === 6 ? 1.3 : 1), 0);
  void Ls;
  if (out.due()) yield;
}

function* power(ctx, out, W, lm, Ls) {
  const r = makeRng(hashInts(lm.seed, 7));
  const on = Ls.on;
  const s = Math.max(2, 0.0018 * lm.d / Math.sqrt(Math.min(1, out.density)));
  for (let k = 0; k < lm.n; k++) {
    const wx = lm.x + (k % 4) * 130 + (k >= 4 ? 65 : 0) - 200, d = lm.d + (k >= 4 ? 140 : 0);
    if (!inBand(ctx, d)) continue;
    const x = wx - ctx.x0, y = W.H(wx, d) - 2;
    if (x < -150 || x > ctx.length + 150) continue;
    const H = 112, rings = Math.max(6, Math.round(H / (s * 1.6)));
    // the shell runs well round the sides (a half cylinder lost its far flank as soon as the tower
    // stood off to one side of the window)
    const A0 = -0.35 * Math.PI, A1 = 1.35 * Math.PI;
    for (let i = 0; i < rings; i++) {
      const f = (i + 0.5) / rings;
      const rad = f < 0.78 ? lerp(46, 29, Math.pow(f / 0.78, 0.8)) : lerp(29, 32, (f - 0.78) / 0.22);
      const nA = Math.max(6, Math.round((A1 - A0) * rad / (s * 1.6)));
      for (let a = 0; a < nA; a++) {
        const th = A0 + (a + 0.5) / nA * (A1 - A0);
        const px = x + Math.cos(th) * rad, pd = d - Math.sin(th) * rad;
        const lit = on && f < 0.35;
        if (lit) L(out, px, y + f * H, pd, s * 0.8, H / rings * 0.62, s * 0.4, SODIUM, 0.35 * (1 - f / 0.35));
        else out(px, y + f * H, -pd, s * 0.8, H / rings * 0.62, s * 0.4, 0.46 * (0.7 + 0.3 * Math.sin(th) - 0.12 * Math.cos(th)), 0.46 * (0.7 + 0.3 * Math.sin(th) - 0.12 * Math.cos(th)), 0.44 * (0.85 + 0.15 * Math.sin(th)), 1, 0, 0, 0, 1, KIND.BUILDING);
      }
      if (out.due()) yield;
    }
    if (on) for (const o of [-25, 25]) point(out, x + o, y + H + 1, d - 10, RED, farR(d), 0);
    // the plume: rising and drifting, lit orange from below at night, white by day
    if (k % 3 === 0) {
      const drift = 0.6 + 0.4 * r();
      for (let i = 0; i < 12; i++) {
        const f = i / 11;
        const py = y + H + 20 + f * 260, px = x + f * f * 220 * drift, rad = 30 + 90 * f;
        if (on) out(px, py, -(d + 5), rad, rad * 0.8, rad * 0.6, 1.0, 0.72, 0.5, 0.08 * (1 - 0.6 * f), 0, 0, 0, 1, KIND.LIGHT, MOVE.VAPOUR);
        else out(px, py, -(d + 5), rad, rad * 0.8, rad * 0.6, 0.75, 0.75, 0.75, 0.35 * (1 - 0.5 * f), 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
      }
    }
  }
  // the chimney with stacked red lights, and the site's sodium lights
  const cxw = lm.x + 320, cd = lm.d + 60;
  if (inBand(ctx, cd) && cxw - ctx.x0 > -20 && cxw - ctx.x0 < ctx.length + 20) {
    const y = W.H(cxw, cd);
    bar(out, cxw - ctx.x0, y, cd, cxw - ctx.x0, y + 198, cd, 4, [0.45, 0.45, 0.44], 12, KIND.BUILDING);
    if (on) for (const f of [0.33, 0.66, 1]) point(out, cxw - ctx.x0, y + 198 * f, cd - 5, RED, farR(cd), 0);
  }
  if (on) {
    for (let k = 0; k < 50; k++) {
      const wx = lm.x - 300 + r() * 800, d = lm.d - 80 + r() * 260;
      if (!inBand(ctx, d)) continue;
      const x = wx - ctx.x0;
      if (x < 0 || x >= ctx.length) continue;
      L(out, x, W.H(wx, d) + 5 + 25 * r(), d, farR(d, 0.8), farR(d, 0.8), farR(d), r() < 0.7 ? SODIUM : LED, 0.85);
    }
  }
}

function* monument(ctx, out, W, lm, Ls) {
  const d = lm.d, x = lm.x - ctx.x0;
  if (!inBand(ctx, d) || x < -40 || x > ctx.length + 40) return;
  const y = W.H(lm.x, d) - 1;
  const on = Ls.on;
  const s = Math.max(1, 0.0012 * d);
  if (lm.obelisk) {
    const H = 70, n = Math.round(H / (s * 1.2));
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n, w = lerp(5.5, 2.6, f);
      if (on) L(out, x, y + f * H, d, w, H / n * 0.62, w * 0.6, FLOOD, clamp(0.95 - 0.5 * f, 0.2, 1));
      else out(x, y + f * H, -d, w, H / n * 0.62, w * 0.6, 0.62, 0.6, 0.55, 1, 0, 0, 0, 1, KIND.BUILDING);
    }
    if (on) L(out, x, y + H + 2, d, 1.6, 2.2, 1.0, FLOOD, 0.45);
  } else {
    // a folly tower with a battlemented top
    yield* frontFace(out, x - 7, y, d - 7, 14, 36, s, (a, b) => (on ? { c: FLOOD, o: clamp(0.95 - 0.5 * b, 0.2, 1) } : [0.5, 0.48, 0.42]));
    yield* sideFace(out, x + 7, y, d - 7, 14, 36, s * 1.3, (a, b) => (on ? { c: FLOOD, o: clamp(0.55 - 0.3 * b, 0.12, 1) } : [0.35, 0.33, 0.3]));
    yield* sideFace(out, x - 7, y, d - 7, 14, 36, s * 1.3, (a, b) => (on ? { c: FLOOD, o: clamp(0.75 - 0.4 * b, 0.12, 1) } : [0.48, 0.46, 0.4]));
    for (let i = 0; i < 4; i++) if (i === 0 || i === 3) { if (on) L(out, x - 7 + (i + 0.5) * 3.5, y + 38, d - 7, 1.1, 2, 0.4, FLOOD, 0.6); }
  }
  // the floodlights at its foot
  if (on) for (const o of [-14, 14]) L(out, x + o, y + 1, d - 12, farR(d, 0.6), farR(d, 0.6), farR(d, 0.6), FLOOD, 0.8);
  if (out.due()) yield;
}

function* windfarm(ctx, out, W, lm, Ls) {
  const r = makeRng(hashInts(lm.seed, 9));
  for (let k = 0; k < lm.n; k++) {
    const wx = lm.x + (r() - 0.5) * 2600, d = lm.d + (r() - 0.5) * 1400;
    const rot = r() * Math.PI * 2;
    if (!inBand(ctx, d)) continue;
    const x = wx - ctx.x0;
    if (x < -60 || x > ctx.length + 60) continue;
    const y = W.H(wx, d) - 1, H = 85, B = 45;
    const rr = Math.max(0.9, 0.00045 * d);
    const col = [0.7, 0.71, 0.72];
    bar(out, x, y, d, x, y + H, d, rr * 1.6, col, 8, KIND.MAST);
    out(x, y + H, -(d - 2), 4, 2, 3, col[0], col[1], col[2], 1, 0, 0, 0, 1, KIND.MAST);
    for (let b = 0; b < 3; b++) {
      const a = rot + b * Math.PI * 2 / 3;
      bar(out, x, y + H, d - 4, x + Math.cos(a) * B, y + H + Math.sin(a) * B, d - 4, rr, col, 5, KIND.MAST);
    }
    if (Ls.on) point(out, x, y + H + 3, d - 3, RED, farR(d, 1.1), 0);
    if (out.due()) yield;
  }
}

function* airport(ctx, out, W, lm, Ls) {
  if (!Ls.on) return;
  const ux = Math.cos(lm.ang), ud = Math.sin(lm.ang);
  const px = -ud, pd = ux;
  const len = 2800, half = 30;
  const put = (along, across, c, k = 1, o = 1, lift = 1) => {
    const wx = lm.x + ux * along + px * across, d = lm.d + ud * along + pd * across;
    if (!inBand(ctx, d)) return;
    const x = wx - ctx.x0;
    if (x < 0 || x >= ctx.length) return;
    L(out, x, W.H(wx, d) + lift, d, farR(d, 0.7 * k), farR(d, 0.6 * k), farR(d, 0.7 * k), c, o);
  };
  // runway edge lights, white, every 60 m; threshold green, end red
  for (let a = -len / 2; a <= len / 2; a += 60) { put(a, -half, WHITE, 0.8, 0.85); put(a, half, WHITE, 0.8, 0.85); }
  for (let t = -half; t <= half; t += 10) { put(-len / 2, t, SIG_GREEN, 0.9, 1); put(len / 2, t, RED, 0.9, 1); }
  // approach lights: a line of bright white beyond the threshold, with crossbars
  for (let a = 30; a <= 900; a += 30) put(-len / 2 - a, 0, WHITE, 1.2, 1, 2);
  for (let a = 150; a <= 900; a += 150) for (let t = -4; t <= 4; t++) if (t) put(-len / 2 - a, t * 6, WHITE, 0.9, 0.9, 2);
  // apron and terminal: a cluster of sodium and white
  const r = makeRng(hashInts(lm.seed, 11));
  for (let k = 0; k < 60; k++) put((r() - 0.5) * 900, -half - 250 - r() * 250, r() < 0.6 ? SODIUM : LED, 1, 0.8, 4 + 15 * r());
  // the beacon on its tower
  put(300, -half - 420, WHITE, 1.6, 1, 30);
  put(300, -half - 420, SIG_GREEN, 1.4, 1, 33);
  if (out.due()) yield;
}

function* landmarks(ctx, out, W, Ls, dz) {
  for (const lm of landmarksNear(W, ctx.x0, ctx.x0 + ctx.length)) {
    if (lm.kind === 'town') yield* town(ctx, out, W, lm, Ls, lm.x, lm.d, lm.R, 700);
    else if (lm.kind === 'cathedral') yield* cathedral(ctx, out, W, lm, Ls, dz);
    else if (lm.kind === 'mast') yield* mast(ctx, out, W, lm, Ls);
    else if (lm.kind === 'power') yield* power(ctx, out, W, lm, Ls);
    else if (lm.kind === 'monument') yield* monument(ctx, out, W, lm, Ls);
    else if (lm.kind === 'windfarm') yield* windfarm(ctx, out, W, lm, Ls);
    else if (lm.kind === 'airport') yield* airport(ctx, out, W, lm, Ls);
  }
}

function* far(ctx, emit) {
  const out = makeOut(ctx, emit, { zMargin: 500 });
  const W = world(ctx);
  const Ls = lightState(ctx);
  const dz = ctx.dials || {};
  out.limit = ctx.count * 0.6;
  yield* landmarks(ctx, out, W, Ls, dz);
  yield* scatterLights(ctx, out, W, Ls, 900, 0.2, 311);
  yield* clumps(ctx, out, W, 260, Math.max(2, Math.round(5 * Math.sqrt(out.density))), ctx.count * 0.5);
  out.limit = Infinity;
  yield* fillLand(ctx, out, W, null, { dNear: ctx.zNear, dFar: ctx.zFar, power: 1.0, cover: 2.6, maxR: 0.03 });
}

export const motorwayBiome = {
  name: 'motorway',
  palette: PAL,
  terrain: TERRAIN,
  // clear night air: far lights survive the haze (lights get half the haze in the shader)
  hazeDist: 8000,
  hours: [21.5, 3.5],
  holdHours: true,   // its lights are baked into the scenery: never let the clock run on into day
  // the night sky is the other half of this biome: more and fainter stars, the Milky Way, few
  // clouds, and a horizon lowered in the frame so the sky has most of the window
  sky: { stars: 1.25, deep: 1, milkyWay: 1, clear: 0.8, constellations: 1 },
  horizon: 0.3,
  generators: { trackside, near, mid, far },
};

// ---------------------------------------------------------------------------------------------
// For scripts: where things are, for a seed string. Distances are metres of world x (= jump).
//   const w = _debug.at('7');  w.junctions(0, 20000) ...
// ---------------------------------------------------------------------------------------------
export const _debug = {
  at(seedStr) {
    const terrain = makeTerrain(hashString(String(seedStr)), TERRAIN);
    const W = world({ terrain });
    const range = (cell, fn, a, b, m = 1) => { const res = []; for (let i = Math.floor(a / cell) - m; i <= Math.floor(b / cell) + m; i++) { const v = fn(W, i); if (v) res.push(v); } return res; };
    return {
      W,
      road(wx) { roadDe(W, wx); return { D: RD, level: RE, y: W.H(wx, RD) + RE }; },
      junctions: (a, b) => range(JCELL, junction, a, b).map((j) => ({ x: j.jx, D: j.D, lit: [j.lit0, j.lit1], led: j.led, central: j.central })),
      services: (a, b) => range(SCELL, service, a, b).map((s) => ({ x: s.sx, lit: [s.lit0, s.lit1] })),
      litStretches: (a, b) => stretchesNear(W, a, b).map((s) => ({ from: s.lit0, to: s.lit1, led: s.led, central: s.central })).sort((p, q) => p.from - q.from),
      gantries(a, b) {
        const res = [], ctx = { terrain };
        const lit = stretchesNear(W, a - 600, b + 600);
        for (let i = Math.floor(a / 500); i <= Math.floor(b / 500); i++) {
          const gx = i * 500 + 250;
          const jn = junctionNear(W, gx, 700);
          if (jn) continue;
          if (worldHash(ctx, 111, i) <= (litIn(lit, gx) ? 0.6 : 0.2)) res.push({ x: gx, lit: !!litIn(lit, gx) });
        }
        return res;
      },
      overbridges: (a, b) => range(OCELL, overbridge, a, b).map((o) => ({ x: o.bx, lamps: o.lamps })),
      henges: (a, b) => range(HGCELL, henge, a, b).map((h) => ({ x: Math.round(h.hx), d: h.hd })),
      farms: (a, b) => range(FMCELL, farm, a, b).map((f) => ({ x: f.fx, d: f.fd, car: f.car, yard: f.yard })),
      shoulder: (a, b) => range(HCELL, shoulderStop, a, b).map((h) => ({ x: h.hx, kind: h.kind })),
      villages: (a, b) => range(VCELL, village, a, b).map((v) => ({ x: v.cx, d: v.dc, church: v.church, flood: v.flood, spire: v.spire })),
      landmarks: (a, b) => range(LMCELL, landmark, a, b).map((l) => ({ kind: l.kind, x: l.x, d: l.d })),
      pylonLines: (a, b) => range(PLCELL, pylonLine, a, b),
    };
  },
};
