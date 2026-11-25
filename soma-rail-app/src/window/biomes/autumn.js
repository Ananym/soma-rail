// "Autumn": a lake in the Canadian Shield in the first week of October, seen from a train running
// along its shore. Three things are the subject, in this order: the trees in full colour, the
// curving shore of the lake, and the lake's reflections.
//
// THE HEIGHT. The line runs on a bench high on the lake's flank: the water (LV) lies EYE = 30 m
// below the eye, the same all along (the rail stays at y = 0, the lake one level plane), so the
// lake is seen from above as a shape: its bays, points, islands and narrows, the far shore swinging
// in and out. The frame's bottom edge looks 25 degrees down, so water nearer than about 70 m is never
// seen (WATER_SEEN); everything meant to be seen on the water stands beyond it, and the fills keep
// only a thin scatter of what lies below the frame (seenKeep, for an upright window's taller view).
//
// THE LAKE. This file's own height function (heightAt) stands on a plan of WORLD x tabulated per
// metre in blocks (xAt, after alps.js): the near shore nd(x), the far shore fd(x), and what lies
// between the line and the water, by stretches chosen by slow world noise (stretchW, profileAt):
// a sheer granite cliff from the cess to a talus foot (nothing between the eye and the whole lake);
// where a cove runs in, a stone viaduct over its mouth, the water straight below the parapet; a
// steep wooded slope, the crowns rising toward the eye but kept under the far shore's sightline, so
// the lake shows over the canopy; a shelf, the rock stepping down to a bench some 10 m over the
// water where the cottages, the deer and the bears stand; and, shorter and rarer, the close woods,
// the line inland on a wooded bench at rail level, the lake only in flashes. (Over five seeds:
// slope 32%, shelf 29%, cliff 20%, viaduct 8%, woods 12%.) The cess edge carries a parapet, a
// fence on a granite lip, or a timber rail (trackEdge). The far shore swings between a narrows
// (240 m) and a long reach (to 1.5 km), bays open and close along it, a side valley coming down to
// each, and wooded points reach out from it (a rounded headland, a parabola in plan, joined to the
// shore by a soft minimum). Islands stand in the water in world cells, a shoal round each: bare
// granite domes with a few windswept white pines, and now and then a bigger wooded one.
//
// THE HILLS. Behind the far shore three rolling ridges overlap (farHills): the first rising
// straight from the shore, 50 to 190 m, its slope and its reflection framing the lake; the second
// 150 to 300 m; the third 250 to 420 m, three to five kilometres back and pale in the haze. Their
// crests wander, their heights roll with a few summits standing up, side valleys cut the first
// where a bay runs in, and a bare granite face or a bald summit shows here and there.
//
// THE MOUNTAINS. Behind the hills, from about 6 km to the far band's limit (mountains, tabulated on
// a 50 m grid), three families of ranges with ridgelines running obliquely to the line, summits
// mostly 1,700 to 2,100 m over the lake: dark conifer forest on the lower slopes, grey rock and
// scree above the tree line, the first snow on the summits and down the gullies, blue and violet
// with distance; each face lit or shaded by the sun, the steep faces drawn as strokes down the fall
// line. They stand over the hills' skyline at nine places in ten along the line, and reflect in the
// lake wherever their image falls on water. They keep still on the beat.
//
// THE FOREST ACROSS THE WATER (crowns). The far shore, the points, the islands and the hills are
// crowns, not a painted mass: on a world grid, each row as wide as a crown that stays about six
// pixels across, each crown a rounded dome a little taller than wide with a lit cap over a shaded
// body, its own colour, a dark gap round it; a conifer a narrow cone with a lit side. The front rank
// at the water is whole trees with pale birch trunks; the waterline (waterline()) is one thin pale
// line of rock or beach with the dark bank behind it, both mirrored so the reflection starts at the
// trees' feet. Behind a nearer skyline nothing is drawn. Every tree across the water answers the beat
// with its colour (colourGroup): red, orange, gold, dark.
//
// THE LIFE OF THE LAKE. Boats (rowing boats, canoes, kayaks, skiffs with an angler, sailing dinghies,
// pontoon boats), boats at moorings, marker buoys, rafts of ducks, loons, geese on the water, a moose
// or a deer swimming, deadheads and drowned snags, lily beds, granite islets with a pine, cottages
// with docks and people on them, campsites and landing beaches on the far shore (waterThings, boats,
// wildlife, cottages): about 21 to 23 things to the kilometre within 300 m of the line, five to seven
// in an open view.
//
// THE COLOUR. Autumn first: maples about half the forest (scarlet, flame, crimson, gold), birch
// and aspen a third (clear yellow, a few still green-gold), oak russet, tamarack smoky gold by the
// water, and the conifers about a tenth, dark spires and small stands, and on the ridge tops. The
// ground is autumnal too: straw grass, crimson blueberry barrens on the rock, bronze bracken, a
// floor of fallen leaves.
//
// THE REFLECTIONS. A still Shield lake is a mirror, so the water is drawn as one: everything that
// stands beyond the near shore (the far shore's forest and its ground, the hills, the islands,
// trees, cabins, docks, boats, people and animals standing in the water) is drawn a second time,
// mirrored in the water plane (mirrorOut: y' = LV - 1.05 (y - LV), the same x and distance, so the
// image is right from every point of the pass), a little darker and greyer, drawn out downward by
// the ripple (taller, never wider), and
// tagged MOVE.STILL (a reflection never swells on the beat). The water surface itself is a veil
// over that mirror world: splats are drawn back to front, so an opaque surface would hide it. The
// veil's opacity follows Fresnel's law for the angle the eye looks down at it, bent toward the
// mirror (fresnel): almost clear at the far shore, denser toward the train, and opaque in the
// shallows, where the stones and sand of the bed show through (by the bed's depth, at every shore
// and round the islands). What shows through the veil where nothing is
// reflected is the engine's underlay (palette.underlay), which runs from the haze colour at the
// horizon to a deeper blue below it: the reflected sky. Wind lanes (long bands of ruffled water)
// are opaque and pale and break the mirror, in breezy stretches; calm stretches are pure mirror.
//
// THE TREES, THE BEAT AND THE BIRDS. See the header of the tree section (and treeGroup: every tree
// and plant near enough answers the beat in one of four groups, a kind's trees split between two
// groups half a cycle apart, so neighbours swell in turn); the close woods carry an understory at
// the eye. Geese fly in skeins low over the lake with a steady wing beat, within 84 m of the line
// (they are carried at about 0.7 of the train's speed, so in view for some fourteen seconds at
// 100 km/h, and their chunk must outlast them); the bald eagle soars at
// the eye's height over the water, beating its wings slowly now and then.
import { hashInts, hashString, makeRng, noise1, noise2, fbm2 } from '../rng.js';
import { makeTerrain } from '../terrain.js';
import {
  KIND, MOVE, makeOut, worldSeed, worldRng, cellsAround, detail, shade, jitter, mul3, mix3, smooth,
  clamp, lerp, quatYaw, quatRoll, quatMul, quatXTo, quatAxis, rotY, norm3, strut, SUN, Q_ID,
  flightCell, flyBody, flyWing, FLY_CELL, FLIGHT, grove, lamp, blob, floatingIsland,
} from './kit.js';

const PAL = {
  ground: [0.2, 0.16, 0.1],
  // what the engine draws below the horizon behind the splats: here the reflected sky, seen through
  // the water's veil (it runs from the haze colour at the horizon to this a little way below it)
  underlay: [0.36, 0.48, 0.62],
  foliage: [0.5, 0.2, 0.06],
  rock: [0.5, 0.45, 0.42],
  ballast: [0.42, 0.4, 0.37],
};

// Colours. Natural surfaces stay <= 0.8 per channel.
const C = {
  ballast: [0.42, 0.4, 0.37],
  cess: [0.36, 0.32, 0.26],
  riprap: [0.46, 0.44, 0.41],
  granite: [0.52, 0.45, 0.42],       // the Shield's pink-grey rock
  graniteDark: [0.3, 0.27, 0.26],
  lichen: [0.5, 0.47, 0.4],           // grey-buff rock lichen
  moss: [0.3, 0.26, 0.12],            // moss gone rusty and dry
  grass: [0.56, 0.44, 0.22],          // October grass: straw
  grassGold: [0.66, 0.5, 0.2],
  floor: [0.32, 0.17, 0.08],          // leaf litter and needles under the trees
  litter: [0.6, 0.24, 0.06],          // fresh fallen maple leaves
  barren: [0.5, 0.1, 0.08],           // blueberry barrens on the rock, gone crimson
  bracken: [0.6, 0.38, 0.14],         // bracken gone to bronze
  sand: [0.6, 0.54, 0.42],
  waterBody: [0.05, 0.065, 0.06],     // looking down into the lake: dark, tea-coloured
  ruffle: [0.47, 0.54, 0.61],         // a wind lane: ruffled water, reflecting the sky's glare
  bedStone: [0.33, 0.28, 0.22],
  bedSand: [0.42, 0.36, 0.25],
  mist: [0.76, 0.77, 0.78],
  mass: [0.05, 0.08, 0.055],
};

const CAMY = 2.6;
const EYE = 30;                  // the eye's height above the water: the line runs high on the lake's flank
const LV = CAMY - EYE;           // the water level, metres relative to the rail
const STILL = MOVE.STILL, FLASH = MOVE.FLASH;
// The camera looks level with a vertical field of 50 degrees, so the frame's bottom edge looks
// 25 degrees down (tan 0.466). A point (d, y) is in the picture only if it lies above that ray:
// water nearer than about 2.15 EYE is never seen. inFrame(d, y, m) asks that with a margin m.
const DOWN = Math.tan(25 * Math.PI / 180);
const inFrame = (d, y, m = 0.92) => CAMY - y < DOWN * m * d;
const WATER_SEEN = (CAMY - LV) / (DOWN * 0.92);   // the nearest water in view, about 70 m

function hourOf(ctx) { const h = ctx.hour != null ? ctx.hour : 12; return ((h % 24) + 24) % 24; }
function lightsOn(ctx) { const h = hourOf(ctx); return h > 18.6 || h < 6.9; }
const inD = (d, lo, hi) => d >= lo && d < hi;
const inX = (ctx, wx, m = 0) => wx >= ctx.x0 - m && wx < ctx.x0 + ctx.length + m;
function softMin(a, b, k) { const m = Math.min(a, b); return m - k * Math.log1p(Math.exp(-Math.abs(a - b) / k)); }
function note(kind, wx, d, extra) { const log = globalThis.__autumnLog; if (log) log.push({ kind, wx: Math.round(wx), d: Math.round(d), ...(extra || {}) }); }

// ---------------------------------------------------------------------------------------------
// World layout (pure functions of world x and distance; cached per world seed)
// ---------------------------------------------------------------------------------------------
const worlds = new Map();
function world(ctx) {
  const ws = worldSeed(ctx);
  let W = worlds.get(ws);
  if (W) return W;
  W = { ws, misc: new Map(), xb: new Map() };
  W.H = (wx, d) => heightAt(W, wx, d);
  W.terr = { height: W.H, stretch: ctx.terrain.stretch, shape: ctx.terrain.shape };
  worlds.set(ws, W);
  if (worlds.size > 6) worlds.delete(worlds.keys().next().value);
  return W;
}
// A copy of ctx standing on the lake's ground; every kit call must get this one.
function local(ctx) { const W = world(ctx); return [{ ...ctx, terrain: W.terr }, W]; }
function cache(W, type, i, make) {
  const key = type * 1048576 + i;
  let v = W.misc.get(key);
  if (v === undefined) { v = make(); if (W.misc.size > 60000) W.misc.clear(); W.misc.set(key, v); }
  return v;
}
const ST = { POINT: 1, ISLE: 2, CABIN: 3, DOCK: 4, BOAT: 5, WILD: 6, BIRD: 7, TOWER: 8, STATION: 9, STORE: 10, LODGE: 11, RAFT: 12, PLANE: 13, GEESE: 14, LOON: 15, HERON: 16, EAGLE: 17, DREAM: 18, FLOCK: 19 };

// --- the line's stretches and the near shore ---
// The line runs on a bench EYE - CAMY above the water, the same height all along; what lies between
// it and the water changes by stretches, chosen by slow noise m:
//   woods  (low m) the line inland on a wooded bench at rail level, the land falling to the lake
//          beyond the trees: the lake only in flashes between the trunks
//   slope  a steep wooded slope: the crowns rise from below toward eye level, the lake over them
//   shelf  the rock steps down to a bench some 10 m above the water, 45 to 100 m out, where the
//          cottages, the deer and the lookouts stand, then down again to the water
//   cliff  (high m) the rock falls sheer from the cess to a talus foot in the water: nothing
//          between the eye and the whole lake; and where a cove runs in, a high stone viaduct
//          carries the line over its mouth, the water straight below
// Each kind has its own profile; the weights blend them over a hundred metres or so.
const SW = { woods: 0, slope: 0, shelf: 0, cliff: 0, via: 0 };
function stretchW(W, wx, o = SW) {
  const m = noise1(wx / 1700, W.ws + 11);
  const woods = smooth(0.22, 0.16, m), cliffish = smooth(0.66, 0.72, m);
  const shelf = smooth(0.43, 0.49, m) * (1 - cliffish);
  o.woods = woods; o.shelf = shelf;
  o.slope = Math.max(0, 1 - woods - shelf - cliffish);
  o.via = cliffish * smooth(0.6, 0.68, noise1(wx / 560, W.ws + 17));
  o.cliff = cliffish - o.via;
  return o;
}
// The profile's measures at a point of the line: the rim (where the cess ends and the land falls),
// each kind's shore distance, the shelf's bench (its height and how far out it runs), the woods'
// edge (where the bench at rail level ends and the land drops to the lake).
const NP = { rim: 0, talus: 0, ndC: 0, ndS: 0, yb: 0, bs: 0, be: 0, ndH: 0, edge: 0, ndW: 0 };
function profileAt(W, wx, o = NP) {
  o.rim = 6.2 + 1.6 * noise1(wx / 90, W.ws + 12);
  o.talus = LV + 4 + 4 * noise1(wx / 120, W.ws + 13);
  o.ndC = o.rim + 12 + 12 * noise1(wx / 150, W.ws + 14);
  o.ndS = 6 + (EYE / 0.6) * (0.8 + 0.45 * noise1(wx / 420, W.ws + 15));
  o.yb = LV + 8 + 6 * noise1(wx / 380, W.ws + 16);
  o.bs = o.rim + 11 + 6 * noise1(wx / 130, W.ws + 18);
  o.be = Math.max(o.bs + 25, 40 + 36 * noise1(wx / 520, W.ws + 19));
  o.ndH = o.be + 7 + 8 * noise1(wx / 110, W.ws + 20);
  o.edge = 55 + 65 * noise1(wx / 700, W.ws + 24);
  o.ndW = o.edge + 34 + 10 * noise1(wx / 160, W.ws + 25);
  return o;
}
const VIA_ND = 5.8;
function nearRaw(W, wx) {
  const w = stretchW(W, wx), p = profileAt(W, wx);
  return w.woods * p.ndW + w.slope * p.ndS + w.shelf * p.ndH + w.cliff * p.ndC + w.via * VIA_ND;
}
// --- the far shore: a narrows or a long reach, bays, and points ---
// (pulled in from the grazing view's: seen from above, a lake's plan reads within half a kilometre
// or so, and the far shore's hills stand over it)
function bayAt(W, wx) { return smooth(0.64, 0.8, noise1(wx / 820, W.ws + 66)); }
function farBase(W, wx) {
  const reach = smooth(0.2, 0.86, noise1(wx / 5200, W.ws + 21));
  let f = 240 + 1250 * Math.pow(reach, 1.5);
  f *= 1 + 0.3 * (noise1(wx / 640, W.ws + 22) - 0.5) + 0.12 * (noise1(wx / 205, W.ws + 23) - 0.5);
  f += 320 * bayAt(W, wx);          // a bay running in, where a side valley comes down to the lake
  return clamp(Math.max(f, nearRaw(W, wx) + 170), 0, 2100);
}
const PTCELL = 1100;
function pointOf(W, i) {
  return cache(W, ST.POINT, i, () => {
    const r = makeRng(hashInts(W.ws, 31, i));
    if (r() > 0.62) return null;
    const px = (i + 0.2 + 0.6 * r()) * PTCELL, fb = farBase(W, px), nd = nearRaw(W, px);
    const tip = Math.max(nd + 90, fb * (0.62 - 0.4 * r()));
    if (fb - tip < 40) return null;
    const pw = clamp(40 + 0.22 * (fb - tip) + 70 * r(), 50, 260);   // half its width at the base
    return { i, px, tip, fb, pw, salt: hashInts(W.ws, 32, i) & 0xffff };
  });
}
function farRaw(W, wx) {
  let f = farBase(W, wx);
  const i0 = Math.floor(wx / PTCELL);
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const p = pointOf(W, i);
    if (!p) continue;
    const t = Math.abs(wx - p.px) / p.pw;
    if (t >= 1.6) continue;
    const e = p.tip + (p.fb - p.tip) * t * t * (1 + 0.12 * (noise1(wx / 23, p.salt) - 0.5));
    f = softMin(f, e, 18);
  }
  return f;
}
// Everything that depends on world x alone, tabulated per metre in blocks of 256 m.
// (cw: the viaduct's weight, inl: the close woods', cl: the cliff's, sh: the shelf's, sl: the
// slope's; then the profile's measures, as profileAt)
// (and the hills' measures that depend on x alone, as farHills uses them: tabulated, as the profile
// is, because a far splat asks for three heights or more)
const XFIELDS = ['nd', 'fd', 'fb', 'cw', 'inl', 'wind', 'leaf', 'cl', 'sh', 'sl', 'rim', 'talus', 'ndC', 'ndS', 'yb', 'bs', 'be', 'ndH', 'edge', 'ndW', 'bay', 'face', 'c1', 'A1', 'c2', 'A2', 'c3', 'A3', 'bank'];
const XB = 256, XF = XFIELDS.length;
const XR = new Float64Array(XF);
function xRaw(W, wx) {
  XR[0] = nearRaw(W, wx);
  XR[1] = farRaw(W, wx);
  XR[2] = farBase(W, wx);
  const w = stretchW(W, wx), p = profileAt(W, wx);
  XR[3] = w.via; XR[4] = w.woods;
  XR[5] = smooth(0.45, 0.7, noise1(wx / 1900, W.ws + 41));      // wind: 0 a mirror calm, 1 breezy
  XR[6] = smooth(0.25, 0.75, noise1(wx / 1300, W.ws + 42));     // how thick the leaves fall
  XR[7] = w.cliff; XR[8] = w.shelf; XR[9] = w.slope;
  XR[10] = p.rim; XR[11] = p.talus; XR[12] = p.ndC; XR[13] = p.ndS; XR[14] = p.yb; XR[15] = p.bs; XR[16] = p.be; XR[17] = p.ndH; XR[18] = p.edge; XR[19] = p.ndW;
  const bay = bayAt(W, wx), sd = W.ws;
  XR[20] = bay;
  XR[21] = smooth(0.72, 0.82, noise1(wx / 430, sd + 68));                 // a granite face on the first ridge
  XR[22] = 300 + 220 * noise1(wx / 900, sd + 60);
  XR[23] = (50 + 105 * noise1(wx / 640, sd + 61) + 60 * Math.pow(noise1(wx / 250, sd + 67), 3)) * (1 - 0.82 * bay);
  XR[24] = 1300 + 700 * noise1(wx / 1500, sd + 62);
  XR[25] = (140 + 140 * noise1(wx / 1150, sd + 63) + 70 * Math.pow(noise1(wx / 430, sd + 69), 3)) * (1 - 0.35 * bay);
  XR[26] = 3300 + 1800 * noise1(wx / 2600, sd + 64);
  XR[27] = 240 + 150 * noise1(wx / 2000, sd + 65) + 80 * Math.pow(noise1(wx / 700, sd + 70), 3);
  XR[28] = 1.2 + 3 * noise1(wx / 170, sd + 64);                             // the far shore's bank
  return XR;
}
const newX = () => Object.fromEntries(XFIELDS.map((f) => [f, 0]));
const X = newX();
function xAt(W, wx, o = X) {
  const b = Math.floor(wx / XB);
  let t = W.lb === b ? W.lt : W.xb.get(b);
  if (!t) {
    t = new Float32Array((XB + 1) * XF);
    for (let k = 0; k <= XB; k++) { const v = xRaw(W, b * XB + k); for (let f = 0; f < XF; f++) t[k * XF + f] = v[f]; }
    if (W.xb.size > 3000) W.xb.clear();
    W.xb.set(b, t);
  }
  W.lb = b; W.lt = t;
  const u = wx - b * XB, k = Math.min(XB - 1, Math.floor(u)), a = u - k, i = k * XF, j = i + XF;
  // (field by field, written out: the hottest few lines of the biome)
  o.nd = t[i + 0] + (t[j + 0] - t[i + 0]) * a;
  o.fd = t[i + 1] + (t[j + 1] - t[i + 1]) * a;
  o.fb = t[i + 2] + (t[j + 2] - t[i + 2]) * a;
  o.cw = t[i + 3] + (t[j + 3] - t[i + 3]) * a;
  o.inl = t[i + 4] + (t[j + 4] - t[i + 4]) * a;
  o.wind = t[i + 5] + (t[j + 5] - t[i + 5]) * a;
  o.leaf = t[i + 6] + (t[j + 6] - t[i + 6]) * a;
  o.cl = t[i + 7] + (t[j + 7] - t[i + 7]) * a;
  o.sh = t[i + 8] + (t[j + 8] - t[i + 8]) * a;
  o.sl = t[i + 9] + (t[j + 9] - t[i + 9]) * a;
  o.rim = t[i + 10] + (t[j + 10] - t[i + 10]) * a;
  o.talus = t[i + 11] + (t[j + 11] - t[i + 11]) * a;
  o.ndC = t[i + 12] + (t[j + 12] - t[i + 12]) * a;
  o.ndS = t[i + 13] + (t[j + 13] - t[i + 13]) * a;
  o.yb = t[i + 14] + (t[j + 14] - t[i + 14]) * a;
  o.bs = t[i + 15] + (t[j + 15] - t[i + 15]) * a;
  o.be = t[i + 16] + (t[j + 16] - t[i + 16]) * a;
  o.ndH = t[i + 17] + (t[j + 17] - t[i + 17]) * a;
  o.edge = t[i + 18] + (t[j + 18] - t[i + 18]) * a;
  o.ndW = t[i + 19] + (t[j + 19] - t[i + 19]) * a;
  o.bay = t[i + 20] + (t[j + 20] - t[i + 20]) * a;
  o.face = t[i + 21] + (t[j + 21] - t[i + 21]) * a;
  o.c1 = t[i + 22] + (t[j + 22] - t[i + 22]) * a;
  o.A1 = t[i + 23] + (t[j + 23] - t[i + 23]) * a;
  o.c2 = t[i + 24] + (t[j + 24] - t[i + 24]) * a;
  o.A2 = t[i + 25] + (t[j + 25] - t[i + 25]) * a;
  o.c3 = t[i + 26] + (t[j + 26] - t[i + 26]) * a;
  o.A3 = t[i + 27] + (t[j + 27] - t[i + 27]) * a;
  o.bank = t[i + 28] + (t[j + 28] - t[i + 28]) * a;
  return o;
}
const XT = newX();   // a second one, for lookups made while X is in use
const XH = newX();   // heightAt's own

// --- islands: granite domes with a few pines, and now and then a bigger wooded one ---
const ICELL = 470;
function islandOf(W, i) {
  return cache(W, ST.ISLE, i, () => {
    const r = makeRng(hashInts(W.ws, 51, i));
    if (r() > 0.6) return null;
    const wx = (i + 0.15 + 0.7 * r()) * ICELL;
    const x = xAt(W, wx, { ...XT });
    const wooded = r() < 0.3;
    let rx = wooded ? 45 + 95 * r() : 9 + 30 * r();
    let rd = rx * (0.45 + 0.35 * r());
    const lo = x.nd + 30 + rd, hi = x.fd - 30 - rd;
    if (hi - lo < 10) return null;
    const d = lo + (hi - lo) * Math.pow(r(), 1.5);
    // keep it out from the shore everywhere along its length
    for (const u of [-1, -0.5, 0.5, 1]) { const xx = xAt(W, wx + u * rx, { ...XT }); if (d - rd < xx.nd + 22 || d + rd > xx.fd - 22) return null; }
    const top = wooded ? 4 + 6 * r() : 2 + 4.5 * r();
    const isle = { i, wx, d, rx, rd, top, wooded, salt: hashInts(W.ws, 52, i) & 0xffff, seed: hashInts(W.ws, 53, i), cot: null };
    // a cottage on the bigger islands: the cabin on the near side of the middle, its dock reaching
    // out toward the line
    if (rx > 17 && d < 480 && r() < 0.45) {
      const log = r() < 0.5, paint = PAINT[Math.floor(r() * PAINT.length)], big = 1.3;
      const cw = (7 + 2 * r()) * big, cdp = 6 * big;
      const d0 = d - rd * 0.72, len = 8 + 8 * r();
      isle.cot = {
        cx: wx + (r() - 0.5) * rx * 0.3, cd: d - rd * 0.12, w: cw, dep: cdp, h: 3.2 * big, log, wall: log ? LOG_WALLS[Math.floor(r() * 3)] : paint[0], trim: log ? [0.7, 0.68, 0.62] : paint[1],
        roof: ROOFS[Math.floor(r() * ROOFS.length)], dx: wx + (r() - 0.5) * rx * 0.4, d0, d1: d0 - len, chairs: [CHAIR_COLS[Math.floor(r() * 6)], CHAIR_COLS[Math.floor(r() * 6)]], porch: r() < 0.7,
      };
      if (isle.cot.d1 - 4 < x.nd + 6) isle.cot = null;
    }
    return isle;
  });
}
function isleK(s, ux, uy) { return 0.82 + 0.32 * noise2(ux * 1.6 + 5, uy * 1.6 + 5, s.salt); }
const ISL = { s: null, rr: 0 };
function islandAt(W, wx, d) {
  const i0 = Math.floor(wx / ICELL);
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const s = islandOf(W, i);
    if (!s || Math.abs(wx - s.wx) > s.rx * 1.25 || Math.abs(d - s.d) > s.rd * 1.25) continue;
    const ux = (wx - s.wx) / s.rx, uy = (d - s.d) / s.rd, rr = Math.hypot(ux, uy);
    const k = rr > 1e-6 ? isleK(s, ux / rr, uy / rr) : 1;
    if (rr < k) { ISL.s = s; ISL.rr = rr / k; return ISL; }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// The ground's height
// ---------------------------------------------------------------------------------------------
// The hills behind the far shore: three rolling ridges, overlapping. The first rises straight from
// the shore (its slope and its reflection frame the lake), 50 to 190 m; the second, a kilometre or
// two back, 150 to 300 m; the third, three to five kilometres back, 250 to 420 m, paler in the haze.
// Each ridge's crest wanders in and out and its height rolls along it, with a few summits standing
// up; where a bay runs in, a side valley cuts the first ridge. Here and there a bare granite face on
// the first ridge's front, steep, and bare domes on the summits. t: metres behind the far shore's
// base line. HILL keeps what surface() needs to know about the last point asked (rock, and how high
// it stands on its ridge, for the conifers that hold the ridge tops).
const HILL = { rock: 0, top: 0 };
function ridge(t, c, w, front) {
  // rising over `front` metres to the crest at c, falling away behind over about w
  return t < c ? smooth(c - front, c, t) : Math.exp(-((t - c) / w) * ((t - c) / w));
}
function smax(a, b, k) { const h = clamp(0.5 + 0.5 * (a - b) / k, 0, 1); return b + (a - b) * h + k * h * (1 - h); }
// (x: the table at wx, xAt: the ridges' crests c1..c3 and heights A1..A3, and the face, by world x)
function farHills(W, wx, t, x) {
  const s = W.ws;
  const face = x.face, c1 = x.c1, A1 = x.A1, c2 = x.c2, A2 = x.A2, c3 = x.c3, A3 = x.A3;
  const h1 = A1 * ridge(t, c1, 520, c1 * (1 - 0.55 * face) + 20);
  const h2 = A2 * ridge(t, c2, 900, 900);
  const h3 = A3 * ridge(t, c3, 2600, 2200);
  let H = smax(smax(h1, h2, 30), h3, 40);
  // the canopy's own rolling and the knobs of the Shield, scaled with the hill
  H += (8 + 0.06 * H) * (fbm2(wx / 170, t / 150, s + 71, 2) - 0.5);
  H = Math.max(0, H);
  const top = H / Math.max(30, Math.max(A1 * (t < c1 + 400 ? 1 : 0), A2, A3));
  HILL.top = clamp(top, 0, 1);
  // rock: the first ridge's front where it stands steep, and the highest knobs
  HILL.rock = face * smooth(0.45, 0.75, noise2(wx / 70, t / 60, s + 73)) * smooth(0.15, 0.3, h1 / Math.max(1, A1)) * smooth(0.95, 0.75, h1 / Math.max(1, A1)) * (t < c1 ? 1 : 0)
    + smooth(0.88, 1, top) * smooth(0.6, 0.75, noise2(wx / 300, t / 260, s + 72));
  return H;
}
// The mountains behind the hills, from about 6 km to the far band's limit: three families of ranges
// whose ridgelines run obliquely to the line (ridged noise in turned, stretched coordinates: long
// crests with summits, shoulders and cols along them, not a row of cones), peaks 900 to 2,100 m
// over the lake, the nearest range lower. d: distance from the line.
const RANGES = [[0.38, 2700, 950, 1450, 301], [-0.52, 2300, 820, 1280, 311], [0.12, 4300, 1400, 1080, 321]];
// (tabulated on a 50 m grid in tiles of 800 m, per world, and read bilinearly: at 6 km and more a
// splat is tens of metres across, and the far band asks for three heights per splat or more)
const MG = 50, MT = 16;
function mountains(W, wx, d) {
  if (d < 5000) return 0;
  const gx = wx / MG, gd = d / MG, tx = Math.floor(gx / MT), td = Math.floor(gd / MT);
  const key = tx * 4096 + td;
  let t = W.mt && W.mt.get(key);
  if (!t) {
    if (!W.mt) W.mt = new Map();
    t = new Float32Array((MT + 1) * (MT + 1));
    for (let i = 0; i <= MT; i++) for (let j = 0; j <= MT; j++) t[i * (MT + 1) + j] = mountainsRaw(W, (tx * MT + i) * MG, Math.max(5000, (td * MT + j) * MG));
    if (W.mt.size > 4000) W.mt.clear();
    W.mt.set(key, t);
  }
  const u = gx - tx * MT, v = gd - td * MT, i = Math.min(MT - 1, Math.floor(u)), j = Math.min(MT - 1, Math.floor(v)), a = u - i, b = v - j, k = i * (MT + 1) + j;
  return (t[k] * (1 - b) + t[k + 1] * b) * (1 - a) + (t[k + MT + 1] * (1 - b) + t[k + MT + 2] * b) * a;
}
function mountainsRaw(W, wx, d) {
  if (d < 5000) return 0;
  const env = smooth(5000, 7600, d) * (0.75 + 0.25 * smooth(7000, 10000, d));
  let h = 0;
  for (const [a, su, sv, amp, sd] of RANGES) {
    const ca = Math.cos(a), sa = Math.sin(a), u = (wx * ca + d * sa) / su, v = (-wx * sa + d * ca) / sv;
    const rg = 1 - Math.abs(2 * fbm2(u, v, W.ws + sd, 3) - 1);
    h = smax(h, amp * rg * rg * rg * (0.5 + 0.9 * noise2(u * 0.3, v * 0.3, W.ws + sd + 1)), 50);
  }
  return env * (300 + h);
}
function heightAt(W, wx, d) {
  const x = xAt(W, wx, XH);
  if (d < x.nd) {
    // the near land: ballast and cess at rail level, then each stretch's fall to the water
    const cess = -0.12 * Math.max(0, d - 2.4) - 0.05;
    if (d < 5.4) return cess;
    const rough = 0.6 * (noise2(wx / 7, d / 5, W.ws + 63) - 0.5);
    let y = 0, w = 0;
    if (x.cl > 0.001) {
      // the cliff: the rim, a sheer face to the talus, the talus to the water
      const yc = d < x.rim ? cess : d < x.rim + 3 ? lerp(cess, x.talus, smooth(x.rim, x.rim + 3, d)) : lerp(x.talus, LV - 0.4, clamp((d - x.rim - 3) / Math.max(1, x.ndC - x.rim - 3), 0, 1.3));
      y += x.cl * yc; w += x.cl;
    }
    if (x.sl > 0.001) {
      // the wooded slope: rounding over at the top, then steep and even
      const s = clamp((d - 5.4) / Math.max(1, x.ndS - 5.4), 0, 1.3);
      const knob = 3 * smooth(0.7, 0.9, noise2(wx / 90, d / 30, W.ws + 65)) * Math.sin(Math.PI * Math.min(1, s));
      y += x.sl * (cess + (LV - 0.4 - cess) * Math.pow(s, 0.85) + knob + 2 * rough * Math.min(1, s)); w += x.sl;
    }
    if (x.sh > 0.001) {
      // the shelf: a step down from the rim to the bench, the bench falling gently, a step to the water
      let yh;
      if (d < x.rim) yh = cess;
      else if (d < x.bs) yh = lerp(cess, x.yb, smooth(x.rim, x.bs, d));
      else if (d < x.be) yh = x.yb - 3 * (d - x.bs) / (x.be - x.bs) + 1.6 * (noise2(wx / 40, d / 25, W.ws + 66) - 0.5) + rough;
      else yh = lerp(x.yb - 3, LV - 0.4, smooth(x.be, x.ndH + 2, d));
      y += x.sh * yh; w += x.sh;
    }
    if (x.inl > 0.001) {
      // the close woods: a bench at rail level, a knoll here and there, then the fall to the lake
      const knoll = 2.2 * smooth(0.68, 0.85, noise2(wx / 160, d / 60, W.ws + 67));
      const yw = d < x.edge ? cess * 0.3 - 0.02 * (d - 5.4) + knoll * smooth(8, 20, d) + rough : lerp(-0.02 * (x.edge - 5.4), LV - 0.4, smooth(x.edge, x.ndW + 3, d));
      y += x.inl * yw; w += x.inl;
    }
    if (x.cw > 0.001) { y += x.cw * (LV - 3); w += x.cw; }       // under the viaduct: the water
    y /= Math.max(1e-6, w);
    return Math.max(y, LV + 0.12 * Math.min(1, x.nd - d));
  }
  const isl = d < x.fd ? islandAt(W, wx, d) : null;
  if (isl) {
    const s = isl.s, f = 1 - isl.rr * isl.rr;
    return LV - 0.3 + (s.top + 0.3) * Math.pow(f, s.wooded ? 0.5 : 0.75) * (0.85 + 0.3 * noise2(wx / 9, d / 7, s.salt));
  }
  if (d < x.fd) {
    // the lake bed, shelving from both shores, and rising in a shoal round each island
    const q = Math.min(d - x.nd, x.fd - d);
    let y = LV - 0.25 - Math.min(6, 0.09 * q);
    const sh = shoalAt(W, wx, d);
    if (sh < 1.6) y = Math.max(y, LV - 0.3 - 3.5 * (sh - 1));
    return y;
  }
  const t = d - x.fd, tb = d - x.fb;
  const bank = x.bank * smooth(0, 26, t);
  return LV + 0.15 + bank + farHills(W, wx, tb + 30, x) * smooth(-60, 40, tb) + 0.01 * Math.max(0, tb) + (d > 5000 ? mountains(W, wx, d) : 0);
}
// How far out from an island a point of open water lies, in island radii (1 at its shore; large
// when no island is near).
function shoalAt(W, wx, d) {
  const i0 = Math.floor(wx / ICELL);
  let best = 9;
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const s = islandOf(W, i);
    if (!s || Math.abs(wx - s.wx) > s.rx * 1.8 || Math.abs(d - s.d) > s.rd * 1.8) continue;
    best = Math.min(best, Math.hypot((wx - s.wx) / s.rx, (d - s.d) / s.rd));
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// What covers the ground
// ---------------------------------------------------------------------------------------------
const T = { BALLAST: 0, CESS: 1, RIPRAP: 2, ROCK: 3, GRASS: 4, WOODS: 5, BEACH: 6, WATER: 7, SHORE: 8, FOREST: 9, ISLE_ROCK: 10, ISLE_WOOD: 11 };
const SURF = { t: 0, y: 0, h: 0, nd: 0, fd: 0, isl: null, rr: 0, far: false };
// The near land's woods (the screen of trees in the inland stretches; scattered trees elsewhere).
function glade(W, wx) { return smooth(0.66, 0.76, noise1(wx / 170, W.ws + 79)); }
// (the woods are thick in the close-woods stretch and on the slope, in stands on the shelf's bench)
function woodsVal(W, wx, d, x) {
  return -0.9 * glade(W, wx) * x.inl + noise2(wx / 70, d / 45, W.ws + 71) * 0.7 + 0.3 * noise1(wx / 23, W.ws + 72) + 0.75 * x.inl + 0.55 * x.sl - 0.25 * x.sh - 0.4 + 0.2 * smooth(9, 16, d) - 0.5 * smooth(x.nd - 6, x.nd - 2, d);
}
function surface(W, wx, d) {
  const s = SURF;
  const x = xAt(W, wx);
  s.nd = x.nd; s.fd = x.fd; s.isl = null; s.far = false;
  const h = heightAt(W, wx, d);
  s.h = h; s.y = h;
  if (d < x.nd) {
    if (d < 3.6) { s.t = T.BALLAST; return s; }
    if (d < 5.4) { s.t = T.CESS; return s; }
    if (x.cw > 0.5) { s.t = T.RIPRAP; return s; }
    const edge = x.nd - d;
    if (edge < 2 + 3 * noise1(wx / 31, W.ws + 73)) { s.t = noise1(wx / 140, W.ws + 74) > 0.62 && x.sh > 0.5 ? T.BEACH : T.ROCK; return s; }
    if (d > 12 && (inClearing(W, wx, d) || landmarkClear(W, wx, d))) { s.t = T.GRASS; return s; }
    // the cliff: bare rock from the rim down
    if (x.cl > 0.5) { s.t = d < x.rim ? T.GRASS : T.ROCK; return s; }
    // the shelf: rock at its steps, the bench a barren of rock, blueberry and straw grass with
    // stands of trees on it
    if (x.sh > 0.5 && (d < x.bs + 2 || d > x.be)) { s.t = d < x.rim ? T.GRASS : T.ROCK; return s; }
    if ((d > 9 || (x.inl > 0.5 && d < x.edge)) && woodsVal(W, wx, d, x) > (x.inl > 0.5 && d < 12 ? -9 : 0.5)) { s.t = T.WOODS; return s; }
    const rock = noise2(wx / 23, d / 17, W.ws + 75) + 0.3 * (1 - x.inl);
    s.t = rock > 0.78 ? T.ROCK : T.GRASS;
    return s;
  }
  if (d < x.fd) {
    const isl = islandAt(W, wx, d);
    if (isl) {
      s.isl = isl.s; s.rr = isl.rr; s.far = true;
      const c = isl.s.cot;
      s.t = isl.s.wooded && isl.rr < 0.9 && !(c && Math.abs(wx - c.cx) < c.w / 2 + 7 && Math.abs(d - c.cd) < c.dep / 2 + 9) ? T.ISLE_WOOD : T.ISLE_ROCK;
      return s;
    }
    s.t = T.WATER; s.y = LV;
    return s;
  }
  s.far = true;
  const t = d - x.fd;
  if (t < 0.4 + 6 * Math.pow(noise1(wx / 47, W.ws + 76), 2.5)) { s.t = noise1(wx / 260, W.ws + 77) > 0.75 ? T.BEACH : T.SHORE; return s; }
  // bare rock: the granite faces and the bald summits (HILL was set by the heightAt above)
  if (t > 30 && HILL.rock > 0.5 + 0.3 * noise2(wx / 60, d / 50, W.ws + 78)) { s.t = T.ROCK; return s; }
  if (t < 40 && (inClearing(W, wx, d) || campClear(W, wx, d))) { s.t = T.GRASS; return s; }
  s.t = T.FOREST;
  return s;
}
const isTree = (t) => t === T.FOREST || t === T.ISLE_WOOD || t === T.WOODS;

// ---------------------------------------------------------------------------------------------
// The species and their colours. Drifts and patches by slow world noise: a hillside of maple, a
// point of dark spruce, a bay ringed with birch; tamarack by the water, oak on dry knolls.
// ---------------------------------------------------------------------------------------------
const SP = { MAPLE: 0, RMAPLE: 1, BIRCH: 2, ASPEN: 3, TAMARACK: 4, OAK: 5, SPRUCE: 6, FIR: 7, PINE: 8 };
// The beat groups (kit grove(): on each beat one or two of four groups swell, and groups two apart
// are never on together, one of them on four beats in five). Each kind owns a pair of groups half a
// cycle apart, and a tree takes one or the other by its place, so of two neighbours of a kind one
// swells while the other rests: maples and oak on 0 and 2; birch, aspen, tamarack and the conifers
// on 1 and 3 (the two halves about equal on screen in the close woods).
const GROUP_BASE = [0, 0, 1, 1, 1, 0, 1, 1, 1];
const treeGroup = (sp, alt) => GROUP_BASE[sp] + 2 * (alt & 1);
// crown colours: [top, lower] (a maple is often red at the crown and orange below)
const CROWN = [
  [[[0.74, 0.1, 0.04], [0.8, 0.36, 0.04]], [[0.8, 0.22, 0.03], [0.8, 0.5, 0.06]], [[0.62, 0.06, 0.05], [0.76, 0.2, 0.04]], [[0.8, 0.52, 0.05], [0.78, 0.62, 0.1]]],   // sugar maple: scarlet over flame, orange over gold, crimson, gold
  [[[0.58, 0.04, 0.05], [0.7, 0.08, 0.05]], [[0.68, 0.06, 0.07], [0.74, 0.16, 0.05]]],                                                                               // red maple: crimson
  [[[0.78, 0.64, 0.12], [0.72, 0.54, 0.08]], [[0.8, 0.7, 0.2], [0.74, 0.6, 0.12]], [[0.8, 0.72, 0.16], [0.7, 0.62, 0.1]], [[0.6, 0.62, 0.18], [0.48, 0.52, 0.14]]],                                                                                  // birch: clear yellow
  [[[0.8, 0.66, 0.1], [0.76, 0.56, 0.06]], [[0.74, 0.6, 0.14], [0.62, 0.56, 0.12]], [[0.52, 0.58, 0.14], [0.4, 0.48, 0.12]]],                                                                                 // aspen: gold, a few still greenish
  [[[0.64, 0.5, 0.16], [0.55, 0.42, 0.13]], [[0.7, 0.56, 0.2], [0.58, 0.45, 0.15]]],                                                                                 // tamarack: smoky gold
  [[[0.46, 0.2, 0.07], [0.38, 0.17, 0.07]], [[0.52, 0.32, 0.11], [0.42, 0.24, 0.09]], [[0.56, 0.24, 0.06], [0.44, 0.2, 0.06]], [[0.3, 0.36, 0.12], [0.24, 0.3, 0.1]]],                                                                               // oak: russet and bronze
  [[[0.07, 0.12, 0.08], [0.04, 0.075, 0.05]]],                                                                                                                       // spruce: near-black green
  [[[0.06, 0.12, 0.09], [0.035, 0.07, 0.05]]],                                                                                                                       // balsam fir
  [[[0.09, 0.15, 0.11], [0.05, 0.09, 0.065]]],                                                                                                                       // white pine
];
const MX = [0, 0, 0, 0, 0];
// Shares of maples, birch and aspen, tamarack, oak and conifers at a point.
// Two scales: drifts a few hundred metres across (a maple hillside) and patches of some tens of
// metres within them (a clump of birch); the shares are sharpened so a patch is mostly one kind.
// Maples carry the forest (about half of it), birch and aspen the next quarter; the conifers are the
// accent, about an eighth: dark spires in ones and twos among the colour, small stands, a dark point
// here and there, and (dark > 0, from the hills) the ridge tops.
function mixAt(W, wx, d, nearWater = 0, dark = 0) {
  const n1 = noise2(wx / 700, d / 480, W.ws + 81), n2 = noise2(wx / 520, d / 400, W.ws + 82), n3 = noise2(wx / 430, d / 330, W.ws + 83);
  const n4 = noise2(wx / 1300, d / 900, W.ws + 84);
  const p1 = noise2(wx / 95, d / 70, W.ws + 85), p2 = noise2(wx / 80, d / 60, W.ws + 86), p3 = noise2(wx / 110, d / 80, W.ws + 87);
  MX[0] = 0.5 + 0.9 * smooth(0.35, 0.7, n1) * (0.4 + p1);                        // maple hillsides
  MX[1] = 0.6 + 1.0 * smooth(0.4, 0.72, n2) * (0.3 + p2);                        // birch and aspen
  MX[2] = 0.08 + 1.1 * nearWater * smooth(0.3, 0.6, n3) * (0.3 + p3);             // tamarack by the water
  MX[3] = 0.3 + 0.7 * smooth(0.55, 0.85, n3) * (0.3 + p1);                        // oak
  MX[4] = 0.47 + 0.8 * smooth(0.6, 0.85, n4) * (0.4 + p3) + 0.45 * smooth(0.7, 0.9, p2 * 0.5 + n3 * 0.5) + 0.7 * dark;   // spruce, fir and pine
  for (let k = 0; k < 5; k++) { const v = MX[k] * MX[k]; MX[k] = v * v; }
  return MX;
}
function pickSpecies(W, wx, d, u, nearWater = 0, u2 = 0.5, dark = 0) {
  const m = mixAt(W, wx, d, nearWater, dark);
  let sum = 0;
  for (let k = 0; k < 5; k++) sum += m[k];
  let a = u * sum;
  if ((a -= m[0]) < 0) return u2 < 0.7 ? SP.MAPLE : SP.RMAPLE;
  if ((a -= m[1]) < 0) return u2 < 0.6 ? SP.BIRCH : SP.ASPEN;
  if ((a -= m[2]) < 0) return SP.TAMARACK;
  if ((a -= m[3]) < 0) return SP.OAK;
  return u2 < 0.45 ? SP.SPRUCE : u2 < 0.75 ? SP.FIR : SP.PINE;
}
function crownOf(sp, u) { const list = CROWN[sp]; return list[Math.floor(u * list.length) % list.length]; }

// ---------------------------------------------------------------------------------------------
// Reflections. mirrorOut(out, move) wraps an out: every splat goes out as it is (with `move` as
// its motion class unless it carries one) and, if it stands above the water, a second time
// mirrored in the water plane: the same x and distance, y' = LV - 1.05 (y - LV), its turn mirrored
// (a reflection in a horizontal plane takes a quaternion (x, y, z, w) to (-x, y, -z, w)), a little
// wider, darker and greyer, and MOVE.STILL. Lights stay lights (a lit window's reflection glows on
// the dark water at dusk), only fainter.
// ---------------------------------------------------------------------------------------------
const mirrors = new WeakMap();
function emitMirror(out, x, y, z, sx, sy, sz, r, g, b, o, qx, qy, qz, qw, kind) {
  const h = y - LV;
  if (h <= -0.05) return;
  const yy = LV - 1.05 * h;
  if (Math.max(r, g, b) >= 0.97 && kind === KIND.LIGHT) {
    out(x, yy, z, sx * 1.05, sy * 1.3, sz, r, g, b, o * 0.6, -qx, qy, -qz, qw, KIND.LIGHT, STILL);
    return;
  }
  // (the dreamlike level: in some stretches the reflection shows another season, see dreamSeason)
  if (out.season) [r, g, b] = out.season(x, r, g, b);
  const l = 0.3 * r + 0.55 * g + 0.15 * b;
  const k = 0.8;
  out(x, yy, z, sx * 1.04, sy * 1.22, sz * 1.04, (r + (l - r) * 0.2) * k, (g + (l - g) * 0.2) * k, (b + (l - b) * 0.2) * k * 1.04, o, -qx, qy, -qz, qw, kind === KIND.SURREAL ? KIND.SURREAL : KIND.OTHER, STILL);
}
function mirrorOut(out, move = 0) {
  let byMove = mirrors.get(out);
  if (!byMove) { byMove = new Map(); mirrors.set(out, byMove); }
  let m = byMove.get(move);
  if (m) return m;
  m = (x, y, z, sx, sy, sz, r, g, b, o = 1, qx = 0, qy = 0, qz = 0, qw = 1, kind = KIND.OTHER, mv = 0) => {
    // (what is wholly under the water is not drawn: a moose's legs, a post's foot)
    if (y + 0.5 * Math.min(sx, sy, sz) < LV - 0.05 && y < LV - 0.12) return false;
    const kept = out(x, y, z, sx, sy, sz, r, g, b, o, qx, qy, qz, qw, kind, mv || move);
    if (kept) emitMirror(out, x, y, z, sx, sy, sz, r, g, b, o, qx, qy, qz, qw, kind);
    return kept;
  };
  wrapLike(m, out);
  byMove.set(move, m);
  return m;
}
// An out that tags every splat with one motion class (as pinewood.js): MOVE.STILL for rigid
// things, grove(g) for a kind of tree. Cached per out and class.
const moveOuts = new WeakMap();
function withMove(out, move) {
  let byMove = moveOuts.get(out);
  if (!byMove) { byMove = new Map(); moveOuts.set(out, byMove); }
  let m = byMove.get(move);
  if (m) return m;
  m = (x, y, z, sx, sy, sz, r, g, b, o = 1, qx = 0, qy = 0, qz = 0, qw = 1, kind = KIND.OTHER, mv = 0) => out(x, y, z, sx, sy, sz, r, g, b, o, qx, qy, qz, qw, kind, mv || move);
  wrapLike(m, out);
  byMove.set(move, m);
  return m;
}
function wrapLike(m, out) {
  m.q = (x, y, z, sx, sy, sz, c, o, q, k) => m(x, y, z, sx, sy, sz, c[0], c[1], c[2], o, q ? q[0] : 0, q ? q[1] : 0, q ? q[2] : 0, q ? q[3] : 1, k);
  m.due = out.due; m.left = out.left; m.density = out.density; m.detailK = out.detailK; m.ctx = out.ctx;
  Object.defineProperty(m, 'n', { get: () => out.n });
  Object.defineProperty(m, 'limit', { get: () => out.limit, set: (v) => { out.limit = v; } });
}
// An out for a thing at (wx, d): mirrored if it stands beyond the near shore, plain otherwise.
function outFor(W, out, wx, d, move = 0) {
  const x = xAt(W, wx, XT);
  return d > x.nd + 1 ? mirrorOut(out, move) : move ? withMove(out, move) : out;
}

// ---------------------------------------------------------------------------------------------
// Surface colours
// ---------------------------------------------------------------------------------------------
// Reflectance of still water for a ray looking down at the angle whose tangent is EYE / d (Schlick),
// bent toward the mirror: from the line's height physics gives a tenth at 70 m and under a half at
// 200 m, which leaves the near half of the lake a black sheet; the picture wants the far shore's
// image strong from about 100 m out. (A picture, not a simulation.)
function fresnel(d) {
  const s = EYE / Math.hypot(EYE, d), m = 1 - s, m2 = m * m;
  const R = 0.02 + 0.98 * m2 * m2 * m;
  return 0.2 + 0.8 * Math.pow(R, 0.6);
}
// Of a sample about to be drawn at (d, y): the share to keep, by whether the frame can see it
// (what lies under the frame's bottom edge is kept thinly, for an upright window's taller view).
const seenKeep = (d, y) => (CAMY - y < 0.6 * d ? 1 : 0.1);
function groundColor(W, s, wx, d, rng) {
  const m = noise2(wx / 9, d / 9, W.ws + 91);
  let c;
  switch (s.t) {
    case T.BALLAST: c = C.ballast; break;
    case T.CESS: c = mix3(C.cess, C.ballast, m * 0.5); break;
    case T.RIPRAP: c = mix3(C.riprap, C.graniteDark, smooth(0.3, 0.8, noise2(wx / 1.6, d / 1.3, W.ws + 92))); break;
    case T.ROCK: case T.SHORE: case T.ISLE_ROCK: {
      // pink-grey granite in rounded slabs: grey-green lichen in blotches, dark joints between
      // the slabs, darker hollows
      const crack = noise2(wx / 2.1, d / 1.7, W.ws + 93), slab = noise2(wx / 7, d / 5, W.ws + 89);
      c = mix3(C.granite, C.graniteDark, smooth(0.5, 0.85, crack) * 0.85);
      c = mix3(c, C.lichen, smooth(0.45, 0.75, noise2(wx / 4, d / 3, W.ws + 94)) * 0.75);
      const joint = Math.abs(Math.sin(wx / 6.3 + 4 * slab)) < 0.12 || Math.abs(Math.sin(d / 4.1 + 3 * slab)) < 0.1;
      if (joint) c = mul3(c, 0.5);
      c = mul3(c, 0.8 + 0.35 * slab);
      if (s.t === T.SHORE || s.t === T.ISLE_ROCK) c = mix3(c, C.moss, smooth(0.6, 0.9, m) * 0.4);
      // the blueberry barrens: crimson patches over the rock, and bronze bracken in the hollows
      const bar = noise2(wx / 16, d / 12, W.ws + 88);
      if (s.h > LV + 1.2) c = mix3(c, bar > 0.5 ? C.barren : C.bracken, smooth(0.58, 0.75, Math.abs(bar - 0.5) * 2 + 0.3 * m) * 0.85);
      // the dark wet band just above the water
      if (s.h < LV + 0.5) c = mul3(c, 0.6);
      break;
    }
    case T.BEACH: c = mix3(C.sand, C.bedStone, m * 0.4); break;
    case T.GRASS: {
      const a = noise2(wx / 13, d / 9, W.ws + 95);
      c = mix3(C.grass, C.grassGold, a);
      c = mix3(c, C.litter, smooth(0.65, 0.85, noise2(wx / 5, d / 4, W.ws + 96)) * 0.5);
      break;
    }
    default: {
      // under the trees: leaf litter, red and orange under the maples, browner under the rest
      const mx = mixAt(W, wx, d, 0);
      const maple = mx[0] / (mx[0] + mx[1] + mx[3] + mx[4] + 0.02);
      c = mix3(C.floor, C.litter, clamp((0.35 + maple) * (0.5 + m), 0, 1));
      // gold birch leaves and bronze bracken in drifts
      c = mix3(c, C.grassGold, smooth(0.62, 0.8, noise2(wx / 6, d / 5, W.ws + 98)) * 0.6);
      c = mix3(c, C.bracken, smooth(0.7, 0.9, noise2(wx / 7, d / 6, W.ws + 97)) * 0.5);
    }
  }
  return jitter(mul3(c, 0.85 + 0.3 * m), rng, 0.08);
}
// The colour of the forest seen as a mass (the far shore and the islands): one splat between the
// floor and the canopy top, its colour that of a species drawn from the drifts at the point, a
// crown's top lit, its lower part darker.
function massColor(W, wx, d, v, rng, dark = 0) {
  const sp = pickSpecies(W, wx, d, rng(), 0.6, rng(), dark);
  const cr = crownOf(sp, rng());
  let c = mix3(cr[1], cr[0], v);
  c = mul3(c, (0.34 + 0.72 * v * v) * (0.8 + 0.35 * rng()));
  return { c, sp };
}

// ---------------------------------------------------------------------------------------------
// The surface fill: ground, the water's veil and the forest mass in one pass, one splat per sample
// (and a mirrored one for land beyond the near shore), so the band is covered and the count lands.
// Distances follow d^-power; water samples are thinned with distance (water seen at a graze fills
// little of the window) and drawn larger in proportion, so the land keeps the splats.
//   opts: n, dNear, dFar, power, cover, minR, maxR, mass (draw the forest mass), mirror (share of
//   the land samples beyond the near shore that are mirrored), wKeep(d) (share of water samples kept)
// ---------------------------------------------------------------------------------------------
function* fillLake(ctx, out, W, opts = {}) {
  out.limit = Infinity;
  const n = Math.floor(opts.n != null ? opts.n : out.left());
  if (n <= 0) return;
  const rng = ctx.rng, L = ctx.length;
  const dn = opts.dNear != null ? opts.dNear : ctx.zNear, df = opts.dFar != null ? opts.dFar : ctx.zFar;
  const p = opts.power != null ? opts.power : 1.5, cover = opts.cover || 3;
  const minR = opts.minR || 0.0015, maxR = opts.maxR || 0.08;
  const pm = opts.mirror != null ? opts.mirror : 0.6;
  const wKeep = opts.wKeep || (() => 1);
  const a1 = 1 - p;
  const A = Math.pow(dn, a1), B = Math.pow(df, a1), Z = (B - A) / a1;
  const sample = (u) => Math.pow(A + u * (B - A), 1 / a1);
  // opts.occlude: what stands behind a nearer skyline (the back of a ridge, the land behind a point)
  // is mostly not drawn. Per column of 40 m, the highest elevation seen so far going out.
  const hidden = opts.occlude ? skyline(ctx, W, dn, df) : null;
  // a sample: distance, x, and its surface; water samples are kept by wKeep (up to two re-draws)
  // (and every sample is kept by whether it can be seen: the land below the rim mostly cannot)
  const pick = (r, u0) => {
    let d = 0, x = 0, s = null, k = 1;
    for (let t = 0; t < 5; t++) {
      d = sample(t === 0 ? u0 : r()); x = r() * L;
      s = surface(W, ctx.x0 + x, d);
      const top = s.y + (isTree(s.t) ? 14 : 0.5);
      const sk = seenKeep(d, top) * (hidden && hidden(x, d, top) ? 0.06 : 1);
      k = s.t === T.WATER ? wKeep(d) : 1;
      // (bare rock on the hills across the lake is the crowns' rock lumps, and the far shore's strip
      // of rock and beach is waterline()'s: not here, where far off a splat is tens of metres wide)
      if (opts.mass && s.far && !s.isl && ((s.t === T.ROCK && d > s.fd + 25) || ((s.t === T.SHORE || s.t === T.BEACH) && d > 250))) k = 0.02;
      if (t === 4 || r() < k * sk) break;
    }
    return [d, x, s, s.t === T.WATER ? k : 1];
  };
  // a probe of the same draw finds how many splats a sample costs here (mirrors add one)
  const pr = makeRng(hashInts(W.ws, 97, ctx.index, Math.round(dn)));
  let cost = 0;
  const NP = 128;
  for (let k = 0; k < NP; k++) {
    const [d, x, s] = pick(pr, pr());
    cost += 1 + (s.far && s.t !== T.WATER && mirrorable(s, d) ? pm : 0);
    void x;
  }
  const nS = Math.max(1, Math.round(n / (cost / NP)));
  const mass = !!opts.mass;
  // (the probe's estimate is close; the loop runs on, or stops early, to land on the count)
  const target = out.n + n;
  for (let i = 0; out.n < target && i < nS * 3; i++) {
    const [d, x, s, keep] = pick(rng, golden(i, nS, rng));
    const wx = ctx.x0 + x;
    const dens = (nS * Math.pow(d, -p) / Z) / L;
    let r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
    const ax = 0.8 + 0.5 * rng();
    if (s.t === T.WATER) {
      r /= Math.sqrt(keep);
      waterSplat(out, W, x, wx, d, r, ax, s, rng, cover);
    } else {
      const mir = s.far && mirrorable(s, d) && rng() < pm;
      const o = mir ? mirrorFill : null;
      if (mass && isTree(s.t) && s.far) {
        // under the crowns (see crowns()): the dark of the forest's depths, which shows in the gaps
        // between them, a little of each crown's colour in it; upright, never stretched sideways
        const H = canopyH(W, wx, d, s);
        const mc = massColor(W, wx, d, 0.3, rng, 0);
        const c = jitter(mul3(mc.c, 0.42), rng, 0.08);
        // (low: it must never stand up over the crowns of the row behind it, up the slope)
        const sy = Math.min(H * 0.16, r * 0.5), yy = s.y + sy + H * 0.25 * rng(), sx = r * 0.75;
        out(x, yy, -d, sx, sy, sx, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.TREE, STILL);
        if (o) emitMirror(out, x, yy, -d, sx / Math.sqrt(pm), sy, sx, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.TREE);
      } else {
        let c = groundColor(W, s, wx, d, rng);
        const e = Math.max(0.6, r);
        const hz = (W.H(wx, d + e) - s.h) / e, hx = (W.H(wx + e, d) - s.h) / e;
        c = mul3(c, clamp(0.92 + 0.45 * hz - 0.25 * hx, 0.55, 1.25));
        const steep = clamp(Math.hypot(hz, hx), 0, 3);
        const lift = s.t === T.GRASS && d < 30 ? 0.05 + r * 0.3 * rng() : 0.02;
        // (across the lake, upright and round: a flat wide splat there reads as a sideways smear)
        const far = d > 250, sy = r * (far ? 0.55 : 0.12 + 0.3 * Math.min(1, steep)), sx = far ? r * 0.7 : r * ax;
        out(x, s.y + lift, -d, sx, sy, far ? r * 0.7 : r * (1.8 - ax), c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
        if (o) emitMirror(out, x, s.y + lift, -d, sx / Math.sqrt(pm), sy, far ? r * 0.7 : r * (1.8 - ax), c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      }
    }
    if (out.due()) yield;
  }
}
const mirrorFill = true;
// What stands behind a nearer skyline: per column of 40 m, the highest elevation seen so far going
// out (sampled every 6% of distance). hidden(x, d, y): whether a point at (chunk x, d, y) is behind.
function skyline(ctx, W, dn, df) {
  const OX = 40, ds = [];
  for (let dd = dn; dd < df; dd *= 1.06) ds.push(dd);
  const cols = [];
  for (let c = 0; c * OX <= ctx.length + OX; c++) {
    const wx = ctx.x0 + c * OX, run = new Float32Array(ds.length);
    let m = -1;
    for (let k = 0; k < ds.length; k++) {
      const h = W.H(wx, ds[k]);
      run[k] = m;
      m = Math.max(m, ((h > LV + 0.5 ? h + 5 : LV) - CAMY) / ds[k]);
    }
    cols.push(run);
  }
  const lk = Math.log(1.06);
  return (x, d, y) => {
    const run = cols[clamp(Math.round(x / OX), 0, cols.length - 1)];
    const k = clamp(Math.floor(Math.log(d / dn) / lk) - 1, 0, run.length - 1);
    return (y - CAMY) / d < run[k] - 0.003;
  };
}

// The far waterline, and every island's: one crisp thin line at the water (pale granite, a strip of
// beach) and behind it the bank, up into the canopy: the dark under the front rank's crowns where
// the forest comes down to the water, the rock where the shore is bare; and both mirrored, so the
// reflection starts at the feet of what it reflects. (Without it the far water's clear veil shows
// the underlay's sky colour between the shore and its image: the pale band the owner saw.) One
// piece every few metres of shore, a little wider than the step so the line is unbroken.
function* waterline(ctx, out, W, dLo, dHi) {
  const x0 = ctx.x0, L = ctx.length, o = withMove(out, STILL);
  const piece = (wx, d, lr) => {
    const x = wx - x0, st = Math.max(1.2, d * 0.006);
    const back = surface(W, wx, d + 4), tree = isTree(back.t);
    const H = tree ? canopyH(W, wx, d + 6, back) : 0;
    // (a bank only as tall as the dark under the crowns: a few metres, more where the trees are near)
    const top = tree ? back.y + clamp(H * 0.4, 2, 2 + 2400 / d) : clamp(back.y + 0.3, LV + 0.6, LV + 2.6);
    const m = noise1(wx / 23, W.ws + 991);
    const pale = m > 0.72 ? C.sand : mix3(C.granite, C.graniteDark, 0.15 + 0.4 * noise1(wx / 7, W.ws + 992));
    const bank = tree ? mix3([0.05, 0.04, 0.035], C.floor, 0.25 * m) : mul3(mix3(C.granite, C.graniteDark, 0.6 + 0.3 * m), 0.62);
    const b0 = LV + 0.1, by = (b0 + top) / 2, bh = Math.max(0.3, (top - b0) * 0.3), sx = st * 0.75;
    o(x, by, -(d + 1.5), sx, bh, sx, bank[0], bank[1], bank[2], 1, 0, 0, 0, 1, KIND.GROUND);
    emitMirror(out, x, by, -(d + 1.5), sx, bh, sx, bank[0], bank[1], bank[2], 1, 0, 0, 0, 1, KIND.GROUND);
    const lh = Math.max(0.14, 0.0008 * d);
    o(x, LV + lh * 1.1, -d, sx, lh, sx * 0.6, pale[0], pale[1], pale[2], 1, 0, 0, 0, 1, KIND.GROUND);
    emitMirror(out, x, LV + lh * 1.1, -d, sx, lh, sx * 0.6, pale[0] * lr, pale[1] * lr, pale[2] * lr, 1, 0, 0, 0, 1, KIND.GROUND);
  };
  // the far shore
  for (let wx = x0; wx < x0 + L;) {
    const x = xAt(W, wx, XT), d = x.fd, st = Math.max(1.2, d * 0.006);
    if (d >= dLo && d < dHi && CAMY - LV < 0.6 * d) piece(wx, d, 0.85);
    wx += st;
    if (out.due()) yield;
  }
  // the islands' near sides
  for (const { i } of cellsAround(ctx, ICELL, 160)) {
    const isl = islandOf(W, i);
    if (!isl || isl.d < dLo - isl.rd || isl.d > dHi + isl.rd) continue;
    const per = Math.PI * (isl.rx + isl.rd), st = Math.max(1.2, isl.d * 0.006), n = Math.ceil(per / st);
    for (let k = 0; k <= n; k++) {
      const a = Math.PI * (1 + k / n), ux = Math.cos(a), uy = Math.sin(a), kk = isleK(isl, ux, uy) * 0.995;
      const wx = isl.wx + ux * isl.rx * kk, d = isl.d + uy * isl.rd * kk;
      if (wx < x0 || wx >= x0 + L || d < dLo || d >= dHi) continue;
      piece(wx, d, 0.85);
      if (out.due()) yield;
    }
  }
}
// ---------------------------------------------------------------------------------------------
// THE FOREST ACROSS THE WATER, AS CROWNS. Every tree beyond the near shore (the far shore, the
// points, the islands, the hills) that the bands do not draw as a whole tree is a crown on a world
// grid: rows of cells stepping out from the line, each row's cells as wide as a crown at that
// distance is to stay at least about 6 px across on a 1080p screen (a real crown, 6.5 m, out to a
// kilometre; beyond, a lump of a few crowns the same few pixels wide). Each crown is drawn as a
// crown: a rounded dome a little taller than wide, standing on its own with a dark gap round it,
// its own colour (one tree scarlet, the next gold), lit on top and on the sun's side and shaded
// below and on the other. By its size on the screen P: under 6 px one upright splat; then a shaded
// body under a lit cap; from 14 px a shaded side lump; from 28 px a lit side lump and a second cap.
// A conifer is a narrow dark cone (two stacked tapering splats and a lit sliver), never a ball on a
// stick. The front rank (nothing of the forest in front of it) also gets the dark shadow under its
// canopy and, for birch and aspen, a pale trunk. Nothing is stretched sideways. Behind a nearer
// skyline nothing is drawn. Every crown answers the beat in the group of its colour (colourGroup).
// ---------------------------------------------------------------------------------------------
// Beat groups by colour, for everything across the water: red and crimson 0, gold and yellow 2 (the
// two that stand side by side most often, about a sixth of all neighbours: groups two apart are
// never on together), orange, russet and deep gold 1, the dark conifers 3.
function colourGroup(c, sp) {
  if (sp >= SP.SPRUCE) return 3;
  const r = c[0], g = c[1], b = c[2], mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = Math.max(1e-6, mx - mn);
  if (mx < 0.14) return 3;
  const hue = mx === r ? 60 * (((g - b) / dd + 6) % 6) : mx === g ? 60 * ((b - r) / dd + 2) : 60 * ((r - g) / dd + 4);
  return hue < 12 || hue > 330 ? 0 : hue < 46 ? 1 : 2;
}
const CROWN_MIN = 6.5;
function crownSpacing(d, kd, min = CROWN_MIN) { return Math.max(min, d * kd); }
function* crowns(ctx, out, W, dLo, dHi, opts = {}) {
  const kd = (opts.kd || 0.0062) / Math.sqrt(Math.max(0.25, Math.min(2, out.density)));
  const maxN = opts.max != null ? opts.max : Infinity;
  const hidden = skyline(ctx, W, Math.max(30, dLo * 0.5), dHi);
  const x0 = ctx.x0, x1 = ctx.x0 + ctx.length;
  // pass 1: the cells, and which hold a crown that can be seen
  const list = [];
  let est = 0;
  for (let d0 = dLo, j = 0; d0 < dHi; j++) {
    const s = crownSpacing(d0, kd, opts.min), ds = s * 0.82;
    const row = Math.round(d0 * 10);
    for (let cx = Math.floor((x0 - s) / s); cx * s < x1 + s; cx++) {
      const r = makeRng(hashInts(W.ws, 141 + 0, row, cx));
      const wx = (cx + 0.5 + 0.55 * (r() - 0.5) + (j % 2) * 0.5) * s;
      if (wx < x0 || wx >= x1) continue;
      const d = d0 + ds * (0.5 + 0.5 * (r() - 0.5));
      const sf = surface(W, wx, d);
      if (!sf.far) continue;
      // bare rock on the hills (a granite face, a bald summit): a rock lump in the same cell
      if (sf.t === T.ROCK && d > sf.fd + 25) {
        if (hidden(wx - x0, d, sf.y + 2)) continue;
        list.push([wx, d, sf.y, 0, s * (0.8 + 0.2 * r()), 1158 * s / d, -1, r(), r(), r(), 0, sf.nd, sf.fd, s, false]);
        est += 1 + (mirrorable({ y: sf.y, nd: sf.nd }, d) ? 1 : 0);
        continue;
      }
      if (!isTree(sf.t)) continue;
      if (opts.skip && opts.skip(wx, d, sf)) continue;
      const H = canopyH(W, wx, d, sf) * (0.85 + 0.3 * r());
      const y = sf.y - 0.2;
      if (!(CAMY - (y + H) < 0.6 * d) || hidden(wx - x0, d, y + H)) continue;
      const w = s * (0.78 + 0.22 * r());
      const P = 1158 * w / d;
      const n = P < 6 ? 1 : P < 40 ? 2 : P < 70 ? 3 : 5;
      const mir = mirrorable({ y, nd: sf.nd }, d);
      // (the front rank: water, or bare shore down to the water, in front of it)
      const fr = surface(W, wx, d - s * 1.05), front = fr.t === T.WATER || ((fr.t === T.SHORE || fr.t === T.BEACH || fr.t === T.ISLE_ROCK) && surface(W, wx, d - s * 2.1).t === T.WATER);
      list.push([wx, d, y, H, w, P, n, r(), r(), r(), sf.isl ? 1 : 0, sf.nd, d > sf.fd ? sf.fd : -1, s, front]);
      if (front) est += 1;
      est += n + (mir ? 1 : 0);
    }
    d0 += ds;
  }
  // (should the crowns ask for more than their share, every crown keeps its place and a few drop,
  // evenly, by a hash: a thinner forest, not a bare far end)
  const keep = est > maxN ? maxN / est : 1;
  note('crowns', ctx.x0, dLo, { est, keep: +keep.toFixed(2), n: list.length });
  const sun = SUN;
  for (const [wx, d, y, H, w, P, n, u1, u2, u3, isl, nd, fd, s, front] of list) {
    if (keep < 1 && u3 > keep) continue;
    const x = wx - x0;
    if (n < 0) {
      // a rock lump: granite lit by its slope, barrens and lichen on it
      const e = Math.max(6, s);
      const hz = (W.H(wx, d + e) - y) / e, hx = (W.H(wx + e, d) - y) / e;
      const nz = noise2(wx / 40, d / 30, W.ws + 993);
      let c = mix3(C.granite, C.graniteDark, 0.2 + 0.5 * u1);
      c = mix3(c, nz > 0.6 ? C.barren : C.lichen, smooth(0.45, 0.8, Math.abs(nz - 0.5) * 2) * 0.5);
      c = mul3(c, clamp(0.95 + 0.45 * hz - 0.35 * hx, 0.55, 1.25));
      const sx = w * 0.32, sy = w * 0.24;
      out(x, y + sy * 0.8, -d, sx, sy, sx, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.ROCK, STILL);
      if (mirrorable({ y, nd }, d)) emitMirror(out, x, y + sy * 0.8, -d, sx, sy, sx, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.ROCK);
      if (out.due()) yield;
      continue;
    }
    const rr = makeRng(hashInts(W.ws, 143, Math.round(wx * 4), Math.round(d * 4)));
    const sp = pickSpecies(W, wx, d, u1, fd >= 0 ? smooth(60, 10, d - fd) : 0.4, u2, !isl && fd >= 0 ? 0.45 * smooth(0.8, 1, HILL.top) : 0);
    const cr = crownOf(sp, rr());
    // the slope it stands on: a hillside facing the sun is lit
    const e = Math.max(6, s);
    const hz = (W.H(wx, d + e) - y) / e, hx = (W.H(wx + e, d) - y) / e;
    const lit = clamp(0.92 + 0.35 * hz - 0.3 * hx, 0.65, 1.2) * (0.86 + 0.28 * rr());
    const top = mul3(cr[0], lit), low = mul3(cr[1], lit * 0.72);
    const conifer = sp >= SP.SPRUCE || sp === SP.TAMARACK;
    const mv = grove(colourGroup(cr[0], sp));
    const mir = mirrorable({ y, nd }, d);
    const z = -d;
    // (the reflection: one softer splat for the whole crown, its first one, drawn out a little)
    let first = true;
    const put = (px, py, sx, sy, c) => {
      const cc = [Math.min(0.8, c[0]), Math.min(0.8, c[1]), Math.min(0.8, c[2])];
      out(px, py, z, sx, sy, sx * 0.9, cc[0], cc[1], cc[2], 1, 0, 0, 0, 1, KIND.TREE, mv);
      if (mir && first) emitMirror(out, px, py, z, sx * 1.12, sy * 1.15, sx, cc[0], cc[1], cc[2], 1, 0, 0, 0, 1, KIND.TREE);
      first = false;
    };
    const sl = -0.09 * w;                 // (the lit side: toward the sun, -x)
    if (conifer) {
      // a narrow cone standing a little over the canopy round it, from its middle up
      const tp = y + H * (sp === SP.TAMARACK ? 1 : 1.1), hk = Math.min(H * 0.7, w * 2.1), wc = w * 0.7;
      const dk = sp === SP.TAMARACK ? low : mix3(low, top, 0.5), lt = sp === SP.TAMARACK ? top : mix3(top, [0.3, 0.36, 0.26], 0.25);
      if (n === 1) put(x, tp - hk * 0.45, wc * 0.24, hk * 0.32, mix3(dk, lt, 0.3));
      else {
        put(x, tp - hk * 0.6, wc * 0.27, hk * 0.24, dk);
        put(x + sl * 0.4, tp - hk * 0.25, wc * 0.14, hk * 0.2, lt);
        if (n >= 3) put(x + sl, tp - hk * 0.5, wc * 0.09, hk * 0.18, mul3(lt, 1.12));
      }
    } else {
      const hc = w * 1.25, cy = y + H - hc * 0.5;
      // (narrow enough to leave the dark between crowns, and room for the beat's swell)
      if (n === 1) put(x, cy, w * 0.25, hc * 0.29, mix3(low, top, 0.55));
      else {
        put(x, cy - hc * 0.06, w * 0.24, hc * 0.27, low);
        put(x + sl, cy + hc * 0.2, w * 0.17, hc * 0.14, top);
        if (n >= 3) put(x - sl * 2, cy - hc * 0.1, w * 0.15, hc * 0.16, mul3(low, 0.78));
        if (n >= 5) {
          put(x + sl * 2.2, cy + hc * 0.02, w * 0.14, hc * 0.14, mix3(top, low, 0.3));
          put(x - sl * 1.2, cy + hc * 0.26, w * 0.12, hc * 0.1, mul3(top, 1.08));
        }
      }
    }
    // the front rank: a birch's or an aspen's pale trunk under its crown (the bank under the front
    // rank, the waterline and their reflection are drawn by waterline())
    if (front || (fd >= 0 && d - s * 1.1 < fd)) {
      if ((sp === SP.BIRCH || sp === SP.ASPEN) && P >= 9 && u3 < 0.5) {
        // (short, just under the crown: a long pale stick under a ball reads as a lollipop)
        const tw = Math.max(0.0008 * d, w * 0.03), bc = sp === SP.BIRCH ? BIRCH_BARK : ASPEN_BARK;
        out(x + w * 0.05, y + H - w * 1.25 - H * 0.07, z, tw, H * 0.08, tw, bc[0], bc[1], bc[2], 1, 0, 0, 0, 1, KIND.TREE, mv);
      }
    }
    void sun;
    if (out.due()) yield;
  }
}
// The i-th of n stratified draws in 0..1, visited in golden-ratio order: any first part of the run
// covers the whole range evenly, so a fill that stops short of its estimate thins evenly instead
// of leaving its far end bare.
function golden(i, n, rng) { const k = Math.floor(((i * 0.6180339887498949) % 1) * n); return (k + rng()) / n; }
// Whether land at this point can be seen mirrored from the train: something at height h above the
// water at distance d reflects off the water d * EYE / (EYE + h) out, which must lie beyond the
// near shore.
function mirrorable(s, d) {
  const h = s.y - LV + 18;    // (allowing for the trees standing on it)
  return d * EYE / (EYE + Math.max(0, h)) > s.nd * 0.8;
}
function canopyH(W, wx, d, s) {
  const base = 15 + 8 * noise2(wx / 240, d / 240, W.ws + 98);
  return s.isl ? base * (0.75 + 0.25 * (1 - s.rr)) : base * smooth(0, 14, d - s.fd + 6);
}
// One splat of the water's surface: the veil over the mirror world, a wind lane, or near the near
// shore an opaque splat of shallows (the stones of the bottom with the sky's glare on them).
function waterSplat(out, W, x, wx, d, r, ax, s, rng, cover) {
  const R = fresnel(d);
  // how deep the bed lies here (s.h: the bed's height), the shallows' reach wandering
  const depth = LV - s.h, shallow = 0.9 + 0.8 * noise1(wx / 37, W.ws + 99);
  // (only near, where the eye looks down into them: across the lake a strip of shallows is a thin
  // pale line along the foot of the far shore, over the start of its reflection)
  if (depth < shallow && d < WATER_SEEN + 50) {
    // looking down through clear shallow water to stones and sand, the sky's glare on top
    const st = noise2(wx / 1.4, d / 1.2, W.ws + 100);
    let bed = mix3(C.bedSand, C.bedStone, smooth(0.3, 0.7, st));
    bed = mix3(bed, C.waterBody, smooth(0.2, shallow, depth) * 0.85);
    const c = jitter(mix3(bed, PAL.underlay, R * 0.35), rng, 0.06);
    out(x, LV, -d, r * 1.2 * ax, r * 0.05, r * 0.8, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    return;
  }
  const x0 = xAt(W, wx, XT);
  // wind lanes: long bands of ruffled water, constant along d, long in x; only where it is breezy
  // (broad soft bands, each fading out along its length)
  const st = noise2(wx / 240, d / (4 + 0.05 * d), W.ws + 101);
  const lane = smooth(0.72, 0.92, st) * smooth(0.45, 0.75, noise2(wx / 75, d / 40, W.ws + 102)) * smooth(45, 90, d) * x0.wind;
  // the veil: Fresnel's law, spread over the splats that overlap at a point (about twice the cover).
  // Seen at a graze a flat splat looks taller than the water it covers (its own thickness), so far
  // off more of them overlap on the screen than on the water: the opacity is divided by that, or
  // the far water turns into an opaque dark band. (The renderer's own widening of splats under a
  // pixel already lowers their opacity to match: Spark's blurAdjust.)
  const sn = EYE / d;
  let a = clamp(-Math.log(Math.max(0.02, R)) / (2 * cover) * (0.7 * sn / Math.hypot(0.012, 0.7 * sn)), 0.016, 1);
  a = lerp(a, 0.34, lane);
  const c = jitter(lane > 0.05 ? mix3(C.waterBody, C.ruffle, Math.min(1, lane * 1.3)) : C.waterBody, rng, 0.05);
  out(x, LV, -d, r * 1.4 * ax, r * 0.012, r * 0.7, c[0], c[1], c[2], a, 0, 0, 0, 1, KIND.GROUND);
}

// ---------------------------------------------------------------------------------------------
// THE TREES. Eight kinds, each with the kit's shape: function* (ctx, out, x, d, opts), opts
// { height, width, y (base), n (splats), rng, kind, crown ([top, lower] colours) }. With n <= 4
// each draws a cheap distant version, so a far shore of thousands stays in budget.
//   maple (sugar and red): a broad rounded crown billowing in lumps on a short trunk, red at the
//     top and orange below, or crimson, or gold; oak the same build, flatter and more ragged, russet
//   birch and aspen: white trunks with dark marks, airy yellow crowns (after pinewood.js)
//   tamarack: a slender open cone in smoky gold (pinewood's spruce, lit and thinned)
//   spruce and balsam fir: near-black green spires (pinewood's spruce)
//   white pine: the Shield's tall pine, a bare trunk and flat dark layers of foliage swept by the
//     west wind to one side (after pinewood's Scots pine)
// On the beat (kit grove()), in four groups. On this side of the water, maples and oak on groups 0
// and 2, the rest on 1 and 3, each tree taking one of its kind's pair by its place (treeGroup), so
// beside a swelling tree its neighbour rests. Across the water every tree and crown, at any
// distance, answers with its colour (colourGroup: red 0, orange 1, gold 2, dark 3): the two rules
// meet at the near shore, where nothing grows, so there is no seam. Reflections keep still.
// ---------------------------------------------------------------------------------------------
const GROVE_FAR = 600;
function treeSplats(out, d, H, Wd) {
  const r = Math.max(0.03, 0.0032 * d * out.detailK / Math.sqrt(out.density)) * 1.25;
  return clamp(Math.round((H * Wd * 0.6) / (r * r * 1.5)), 1, 700 * Math.min(2, out.density));
}
const baseY = (ctx, x, d, opts) => (opts.y != null ? opts.y : ctx.terrain.height(ctx.x0 + x, d) - 0.15);
const BARK = [0.2, 0.17, 0.14], BARK_PINE = [0.24, 0.2, 0.17], BIRCH_BARK = [0.72, 0.71, 0.66], ASPEN_BARK = [0.6, 0.63, 0.55];

// A broadleaf tree near the window (within NEAR_D): out of focus if built like a distant one, as a
// volume of round blobs sized to close the gaps (at 12 m a 0.6 m blob is a 30 px smear). Here the
// crown is surface, not volume: each lump of it only the shell the window sees, built of leaf
// sprays sized from distance (a spray at 10 to 25 m a clear shape: three times longer than wide,
// thin, tilted every way), lit on top and shaded beneath, an eighth of them set deeper and darker
// so the crown's depths show through the gaps, and real gaps between them where the limbs and the
// sky show. The trunk and the limbs are struts; a birch's or an aspen's carries its dark marks.
// The sprays' number follows the crown's area; given fewer (a lower budget), they grow to cover.
const NEAR_D = 45;
const sprayLen = (d, birchy) => clamp(0.019 * d, 0.15, 1.0) * (birchy ? 0.8 : 1);
function crownLumps(rng, x, y0, d, H, Wc, cb, kind) {
  // the lumps: [cx, cy, cd, rx, ry, rz, f (0 low .. 1 high)]
  const L = [];
  if (kind === 'birch' || kind === 'aspen') {
    const K = 4 + Math.floor(rng() * 3), lean = (rng() - 0.5) * 0.08;
    for (let k = 0; k < K; k++) {
      const f = (k + 0.5) / K, cy = y0 + cb + (H - cb) * (0.15 + 0.75 * f);
      const w = Wc * 0.5 * (1 - 0.6 * f * f) * (0.8 + 0.4 * rng());
      L.push([x + lean * (cy - y0) + (rng() - 0.5) * w * 0.4, cy, d + (rng() - 0.5) * w * 0.3, w, w * 0.75, w * 0.6, f]);
    }
    return L;
  }
  const oak = kind === 'oak', cy = y0 + cb + (H - cb) * 0.5, ry = (H - cb) * 0.5, rx = Wc * 0.5;
  const K = oak ? 10 : 8;
  for (let k = 0; k < K; k++) {
    let ux, uy, uz;
    if (k === 0) { ux = (rng() - 0.5) * 0.2; uy = 0.55; uz = 0; }
    else { const a = (k / K) * Math.PI * 2 + rng() * 0.8; uy = (oak ? 0.1 : -0.05) + (rng() - 0.5) * 0.7; ux = Math.cos(a) * (0.62 + 0.15 * rng()); uz = Math.sin(a) * 0.5; }
    const lr = (oak ? 0.4 : 0.46) + 0.12 * rng();
    L.push([x + ux * rx, cy + uy * ry, d - uz * rx, lr * rx, lr * ry * (oak ? 0.8 : 0.95), lr * rx * 0.85, clamp(0.5 + uy * 0.9, 0, 1)]);
  }
  return L;
}
// The splats a near broadleaf wants for its crown at full detail (and its trunk and limbs).
function nearCount(H, Wd, d, birchy) {
  const L = sprayLen(d, birchy), area = 0.8 * H * Wd * (birchy ? 0.7 : 0.75);
  return Math.round((birchy ? 1.2 : 1.5) * area / (2.4 * L * L) * 1.12) + 30;
}
function* nearBroadleaf(ctx, out, x, d, opts, kind) {
  const rng = opts.rng || ctx.rng, birchy = kind === 'birch' || kind === 'aspen';
  const H = opts.height, Wc = opts.width, y0 = baseY(ctx, x, d, opts);
  const tk = opts.kind != null ? opts.kind : KIND.TREE;
  const [top, low] = opts.crown || CROWN[SP.MAPLE][0];
  const n = Math.max(40, Math.round(opts.n || nearCount(H, Wc, d, birchy)));
  const cb = H * (birchy ? (kind === 'aspen' ? 0.4 : 0.3) + 0.12 * rng() + (opts.tall ? 0.12 : 0) : (opts.tall ? 0.46 : kind === 'oak' ? 0.3 : 0.24) * (0.85 + 0.3 * rng()));
  const lumps = crownLumps(rng, x, y0, d, H, Wc, cb, kind);
  // trunk and limbs, struts sized from distance
  const tr = Math.max(birchy ? 0.07 : 0.12, H * (birchy ? 0.014 : 0.025), 0.0007 * d);
  const bark = birchy ? (kind === 'aspen' ? ASPEN_BARK : BIRCH_BARK) : BARK;
  const th = birchy ? H * 0.86 : cb * 1.1;
  const segs = Math.max(3, Math.round(th / Math.max(0.35, tr * 2.5)));
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs, c = mul3(bark, (birchy ? 0.92 : 0.75) + 0.3 * t0);
    bar(out, [x, y0 + th * t0, -d], [x, y0 + th * t1, -d], tr * (1.15 - 0.35 * t0), c, 1, tk);
  }
  if (birchy) {
    // the dark marks of the bark, laid on the trunk's near side
    const nm = Math.round(th / 0.45);
    for (let i = 0; i < nm; i++) {
      const yy = y0 + 0.2 + rng() * (th - 0.3), w = tr * (0.7 + 0.6 * rng());
      out(x + (rng() - 0.5) * tr * 0.6, yy, -(d - tr * 0.85), w, Math.max(0.025, tr * 0.28), tr * 0.2, 0.11, 0.1, 0.09, 1, 0, 0, 0, 1, tk);
    }
  }
  const fork = [x, y0 + (birchy ? cb * 0.9 : cb), -d];
  for (const l of lumps) {
    if (!birchy || rng() < 0.6) bar(out, fork, [l[0], l[1] - l[4] * 0.2, -(l[2] - l[5] * 0.25)], tr * (birchy ? 0.4 : 0.55), mul3(bark, 0.8), 3, tk);
    if (out.due()) yield;
  }
  // the sprays: on the shells of the lumps, the side the window sees (and the tops seen from above)
  const used = segs + lumps.length * 3 + (birchy ? Math.round(th / 0.45) : 0);
  const ns = Math.max(20, n - used);
  const full = Math.max(1, nearCount(H, Wc, d, birchy) - 30);
  const Ls = sprayLen(d, birchy) * Math.sqrt(Math.max(1, full / ns));
  let area = 0;
  for (const l of lumps) area += l[3] * l[4];
  const cy0 = lumps.reduce((s, l) => s + l[1], 0) / lumps.length;
  const vy = clamp((CAMY - cy0) / Math.max(4, d), -0.6, 1.5), vl = Math.hypot(vy, 1), Vy = vy / vl, Vz = 1 / vl;
  for (const l of lumps) {
    const [lx, ly, ld, lrx, lry, lrz, f] = l;
    const m = Math.max(3, Math.round(ns * (l[3] * l[4]) / area));
    let lc = mix3(low, top, f * f * (3 - 2 * f));
    if (rng() < 0.3) lc = mix3(lc, rng() < 0.5 ? top : low, 0.45);
    for (let i = 0; i < m; i++) {
      let ux = rng() * 2 - 1, uy = rng() * 2 - 1, uz = rng() * 2 - 1;
      const ll = Math.hypot(ux, uy, uz) || 1; ux /= ll; uy /= ll; uz /= ll;
      const dv = uy * Vy + uz * Vz;
      if (dv < -0.15) { uy -= 2 * dv * Vy; uz -= 2 * dv * Vz; }       // turned to the side the window sees
      const deep = rng() < 0.13, rad = deep ? 0.45 + 0.25 * rng() : 0.84 + 0.18 * rng();
      // a tangent to the shell, and the spray along it, turned about itself at random
      let tx = -uy, ty = ux, tz = rng() - 0.5;
      const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
      const q = quatMul(quatXTo(tx, ty, tz), quatAxis(1, 0, 0, rng() * Math.PI));
      let c = shade(lc, ux * 0.8 + (lx - x) / Math.max(1, Wc) * 0.4, uy, uz, 0.5, 0.62);
      c = mul3(c, (deep ? 0.42 : 0.78 + 0.32 * rng()) * (uy < -0.25 ? 0.72 : 1));
      c = jitter(c, rng, 0.07);
      const s = Ls * (0.7 + 0.6 * rng());
      out(lx + ux * lrx * rad, ly + uy * lry * rad, -(ld - uz * lrz * rad), s, s * 0.42, s * 0.16, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], tk);
      if (out.due()) yield;
    }
  }
}
// Maple (and oak): a short trunk forking into a few limbs, and a crown of overlapping lumps on a
// dome, each lump shaded from its own surface, the colour running from the crown's top colour to
// its lower one, a lump here and there shifted toward its neighbour colour.
function* maple(ctx, out, x, d, opts = {}) {
  if (d < NEAR_D && opts.height && opts.width && (opts.n || 0) >= 40) { yield* nearBroadleaf(ctx, out, x, d, opts, opts.oak ? 'oak' : 'maple'); return; }
  const rng = opts.rng || ctx.rng;
  const oak = !!opts.oak;
  const H = opts.height || 15, Wc = opts.width || H * (oak ? 0.85 : 0.78) * (opts.tall ? 0.75 : 1);
  const y0 = baseY(ctx, x, d, opts);
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const [top, low] = opts.crown || CROWN[SP.MAPLE][0];
  const n = Math.max(1, Math.round(opts.n || treeSplats(out, d, H, Wc)));
  const cb = H * (opts.tall ? 0.46 : oak ? 0.3 : 0.24) * (0.85 + 0.3 * rng());
  const cy = y0 + cb + (H - cb) * 0.5, ry = (H - cb) * 0.5, rx = Wc * 0.5;
  const tr = Math.max(0.12, H * 0.025, 0.0006 * d);
  if (n <= 4) {
    out(x, y0 + cb * 0.5, -d, tr, cb * 0.55, tr, BARK[0], BARK[1], BARK[2], 1, 0, 0, 0, 1, kind);
    const m = Math.max(1, n - 1);
    for (let k = 0; k < m; k++) {
      const f = m === 1 ? 0.5 : k / (m - 1);
      const c = jitter(shade(mix3(low, top, f), 0, 0.6 + 0.4 * f, 0.5, 0.62, 0.45), rng, 0.08);
      out(x + (k - (m - 1) / 2) * rx * 0.5, cy - ry * 0.25 + f * ry * 0.5, -d, rx * (m === 1 ? 0.95 : 0.65), ry * (m === 1 ? 0.9 : 0.62), rx * 0.7, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
    return;
  }
  // trunk and limbs
  const trunkN = clamp(Math.round(n * 0.05), 2, 12);
  for (let i = 0; i < trunkN; i++) {
    const t = (i + 0.5) / trunkN * cb * 1.15;
    const c = mul3(BARK, 0.75 + 0.35 * t / cb);
    out(x, y0 + t, -d, tr * (1.15 - 0.3 * t / cb), cb * 1.15 / trunkN * 0.7, tr, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
  }
  if (n > 60) for (const sg of [-1, 1]) strut(out, x, y0 + cb, -d, x + sg * rx * 0.45, cy + ry * 0.1, -(d + (rng() - 0.5) * rx * 0.4), tr * 0.55, mul3(BARK, 0.8), 3, 1, kind);
  // the crown's lumps: one on top, a ring round the middle, a few hanging lower at the edge
  const crownN = n - trunkN - (n > 60 ? 6 : 0);
  const K = clamp(Math.floor(crownN / 10), 3, oak ? 11 : 9);
  const lumps = [];
  for (let k = 0; k < K; k++) {
    let ux, uy, uz;
    if (k === 0) { ux = (rng() - 0.5) * 0.2; uy = 0.55; uz = 0; }
    else {
      const a = (k / K) * Math.PI * 2 + rng() * 0.8;
      uy = (oak ? 0.1 : -0.05) + (rng() - 0.5) * 0.7;
      ux = Math.cos(a) * (0.62 + 0.15 * rng()); uz = Math.sin(a) * 0.5;
    }
    const lr = (oak ? 0.36 : 0.42) + 0.12 * rng();
    // a lump's colour: by its height in the crown, a few shifted toward the other colour
    const f = clamp(0.5 + uy * 0.9, 0, 1);
    let lc = mix3(low, top, f * f * (3 - 2 * f));
    if (rng() < 0.3) lc = mix3(lc, rng() < 0.5 ? top : low, 0.5);
    lumps.push([x + ux * rx, cy + uy * ry, d - uz * rx, lr * rx, lr * ry * (oak ? 0.8 : 0.95), lc]);
  }
  const per = Math.max(1, Math.round(crownN / K));
  const ss = Math.sqrt((rx * ry * 4.4) / Math.max(1, crownN)) * 0.95;
  // a dark core, so the sky never shows through the crown from the side
  const coreC = mul3(mix3(low, top, 0.4), 0.38);
  out(x, cy - ry * 0.05, -d, rx * 0.72, ry * 0.68, rx * 0.55, coreC[0], coreC[1], coreC[2], 1, 0, 0, 0, 1, kind);
  for (const [lx, ly, ld, lrx, lry, lc] of lumps) {
    for (let i = 0; i < per; i++) {
      let ux = rng() * 2 - 1, uy = rng() * 2 - 1, uz = rng() * 2 - 1;
      const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
      if (uz < -0.3 && rng() < 0.7) uz = -uz;
      const rad = Math.pow(rng(), 0.35);
      // shaded from the lump's surface and from where the lump sits on the crown (its top lit)
      let c = shade(lc, ux * 0.7 + (lx - x) / rx * 0.3, uy * 0.7 + (ly - cy) / ry * 0.4, uz, 0.5, 0.62);
      c = mul3(c, (0.62 + 0.42 * rad) * (0.92 + 0.16 * rng()));
      c = jitter(c, rng, 0.08);
      const s = ss * (0.65 + 0.6 * rng());
      out(lx + ux * lrx * rad, ly + uy * lry * rad, -(ld - uz * lrx * 0.8 * rad), s, s * 0.85, s, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
      if (out.due()) yield;
    }
  }
}
const oak = (ctx, out, x, d, opts = {}) => maple(ctx, out, x, d, { ...opts, oak: true });

// Norway spruce (pinewood.js), here spruce, balsam fir and, lit gold and thinned, the tamarack.
function* spruce(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const larch = !!opts.larch;
  const H = opts.height || 16, Wd = opts.width || H * (larch ? 0.3 : 0.24 + 0.06 * rng());
  const y0 = baseY(ctx, x, d, opts);
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const cr = opts.crown || CROWN[SP.SPRUCE][0];
  const col = cr[1], tip = cr[0];
  const n = Math.max(1, Math.round(opts.n || treeSplats(out, d, H, Wd)));
  const lean = (rng() - 0.5) * 0.03;
  if (n <= 4) {
    const parts = [[0.3, 0.24, 0.19, 0.85], [0.62, 0.13, 0.15, 1], [0.86, 0.05, 0.08, 1.2], [0.1, 0.2, 0.09, 0.7]];
    for (let k = 0; k < Math.min(n, 4); k++) {
      const [fy, fw, fh, b] = n === 1 ? [0.42, 0.21, 0.36, 1] : parts[k];
      const c = jitter(mul3(mix3(col, tip, (b - 0.7) * 0.8), b), rng, 0.1);
      out(x + lean * H * fy, y0 + H * fy, -d, Wd * fw, H * fh, Wd * fw, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
    return;
  }
  const cb = H * (larch ? 0.12 + 0.12 * rng() : 0.03 + 0.08 * rng()) + (opts.tall ? H * 0.25 : 0);
  const span = H - cb;
  const Tn = clamp(Math.round(Math.sqrt(n) * 0.8), 3, Math.max(3, Math.round(span / 0.55)));
  const tierJ = [], tierS = [];
  for (let k = 0; k < Tn; k++) { tierJ.push(0.8 + 0.4 * rng()); tierS.push(0.85 + 0.3 * rng()); }
  // (near the window the boughs are sized from distance, as a broadleaf's sprays: thin strokes)
  const s0 = d < NEAR_D ? Math.min(Math.sqrt((H * Wd * 0.5) / n), sprayLen(d, false) * 0.55) : Math.sqrt((H * Wd * 0.5) / n);
  const trunkN = n >= 30 ? Math.max(2, Math.round(n * (larch ? 0.05 : 0.025))) : 0;
  if (trunkN) {
    const tr = Math.max(0.06, H * 0.012, 0.0005 * d), th = cb + H * (larch ? 0.5 : 0.12);
    for (let i = 0; i < trunkN; i++) {
      const t = (i + 0.5) / trunkN * th;
      const c = mul3(larch ? [0.3, 0.22, 0.16] : [0.24, 0.2, 0.16], 0.7 + 0.3 * t / th);
      out(x + lean * t, y0 + t, -d, tr, th / trunkN * 0.65, tr, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    }
  }
  // a dark core (a tamarack's is thinner and lighter: the sky shows through it a little)
  const coreN = Math.max(1, Math.round(n * (larch ? 0.05 : n < 120 ? 0.14 : 0.08)));
  for (let i = 0; i < coreN; i++) {
    const t = 1 - Math.sqrt(rng());
    const R = Wd * 0.5 * (1 - t);
    const c = jitter(mul3(col, larch ? 0.6 : 0.45), rng, 0.1);
    const ss = Math.max(s0 * 1.4, R * (larch ? 0.3 : 0.45));
    out(x + lean * span * t, y0 + cb + span * t * 0.95, -(d - R * 0.15), ss, Math.max(ss, span / Tn * 0.6), ss * 0.8, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
  }
  const bn = n - trunkN - coreN - 2;
  const tierH = span / Tn;
  for (let i = 0; i < bn; i++) {
    const tt = 1 - Math.sqrt(rng());
    const k = Math.min(Tn - 1, Math.floor(tt * Tn));
    const tTop = (k + 1) / Tn;
    const yk = y0 + cb + span * Math.min(0.97, tTop);
    const Rk = Wd * 0.5 * Math.pow(1 - (k + 0.35) / Tn, 0.95) * tierJ[k] + 0.1;
    let a = rng() * Math.PI * 2;
    if (Math.sin(a) < -0.2 && rng() < 0.65) a = -a;
    const ca = Math.cos(a), sa = Math.sin(a);
    const f = 0.3 + 0.7 * Math.pow(rng(), 0.55);
    const rr = Rk * f;
    const droop = (larch ? 0.15 : 0.3) + 0.55 * (1 - tTop) + 0.25 * rng();
    const by = yk - droop * rr - tierH * 0.25 * rng();
    const q = quatXTo(ca, -droop, sa);
    let len = Math.min(Rk * 0.55, Math.max(s0 * 1.5, rr * 0.4));
    let th = Math.max(s0 * (n < 120 ? 0.62 : 0.45), len * 0.28);
    if (d < NEAR_D) { len = Math.min(len, sprayLen(d, false) * 1.8); th = Math.min(th, len * 0.22); }   // (near: a bough a clear stroke)
    const lit = Math.max(0, ca * SUN[0] + 0.45 * SUN[1] + sa * SUN[2]);
    let c = mix3(col, tip, f * f * (0.25 + 0.75 * lit) + (larch ? 0.25 : 0));
    c = mul3(c, (0.55 + 0.5 * f) * (0.72 + 0.5 * lit) * tierS[k]);
    c = jitter(c, rng, 0.1);
    out(x + lean * (by - y0) + ca * rr, by, -(d - sa * rr), len, th, th * 0.85, c[0], c[1], c[2], larch ? 0.9 : 1, q[0], q[1], q[2], q[3], kind);
    if (out.due()) yield;
  }
  const lc = mul3(tip, 0.9);
  for (let i = 0; i < 2; i++) out(x + lean * H, y0 + H - tierH * (0.3 + i * 0.6), -d, Math.max(0.05, s0 * 0.35), tierH * 0.45, Math.max(0.05, s0 * 0.35), lc[0], lc[1], lc[2], 1, 0, 0, 0, 1, kind);
  if (out.due()) yield;
}
const tamarack = (ctx, out, x, d, opts = {}) => spruce(ctx, out, x, d, { ...opts, larch: true });

// White pine: a tall straight trunk and flat, dark, layered sprays of foliage standing out to one
// side (the east, +x: the west wind's lean), the top flattened.
function* whitePine(ctx, out, x, d, opts = {}) {
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 22, Wc = opts.width || H * (0.42 + 0.14 * rng());
  const y0 = baseY(ctx, x, d, opts);
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const cr = opts.crown || CROWN[SP.PINE][0];
  const col = cr[1], hi = cr[0];
  const n = Math.max(1, Math.round(opts.n || treeSplats(out, d, H, Wc * 0.8)));
  const cb = H * (opts.open ? 0.2 + 0.15 * rng() : 0.4 + 0.15 * rng());
  const lean = (rng() - 0.3) * 0.05, sweep = opts.sweep != null ? opts.sweep : 0.25 + 0.35 * rng();
  const tx = (t) => x + lean * t;
  const tr = Math.max(0.07, H * 0.014, 0.0005 * d);
  // (a pine across the lake given only a few dozen splats would build as a trunk under a few dark
  // blobs, a lollipop: it is a cone instead)
  if (n <= 4 || (d > 120 && n < 80) || (d > 150 && n < 300)) {
    // far off: a narrow dark cone standing in the canopy, a lighter side toward the sun; its trunk
    // short and low (a bare stick under a ball reads as a lollipop)
    const c = shade(col, 0, 1, 0.3, 0.62, 0.45), lt = mix3(hi, [0.3, 0.36, 0.26], 0.3), cw = Math.min(Wc, H * 0.3);
    out(tx(H * 0.2), y0 + H * 0.2, -d, tr, H * 0.12, tr, BARK_PINE[0] * 0.7, BARK_PINE[1] * 0.7, BARK_PINE[2] * 0.7, 1, 0, 0, 0, 1, kind);
    out(tx(H * 0.5), y0 + H * 0.5, -d, cw * 0.3, H * 0.22, cw * 0.26, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    if (n >= 3) out(tx(H * 0.8), y0 + H * 0.8, -d, cw * 0.16, H * 0.14, cw * 0.14, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
    if (n >= 4) out(tx(H * 0.6) - cw * 0.1, y0 + H * 0.6, -d, cw * 0.1, H * 0.14, cw * 0.1, lt[0], lt[1], lt[2], 1, 0, 0, 0, 1, kind);
    return;
  }
  const trunkN = clamp(Math.round(n * 0.12), 3, 50);
  for (let i = 0; i < trunkN; i++) {
    const t = (i + 0.5) / trunkN * H * 0.94, f = t / H;
    const c = mul3(BARK_PINE, 0.7 + 0.35 * f);
    out(tx(t), y0 + t, -d, tr * (1.2 - 0.6 * f), H * 0.94 / trunkN * 0.7, tr, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
  }
  // layers: sprays at uneven intervals up the upper trunk, each a branch reaching out mostly to
  // the east with two or three clumps of needles along it, the outer ones smaller and lower
  const crownN = n - trunkN;
  const Knom = 4 + Math.floor(rng() * 3);
  const K = clamp(Math.min(Knom, Math.floor(crownN / 10)), 1, Knom);
  const per = Math.max(3, Math.round(crownN / K));
  let fy = 0;
  for (let k = 0; k < K; k++) {
    fy = K === 1 ? 0.6 : clamp(k / (K - 1) + (rng() - 0.5) * 0.18 / K, 0, 1);
    const ly = y0 + cb + (H - cb) * (0.06 + 0.86 * fy);
    const reach = Wc * 0.5 * (1 - 0.5 * fy) * (0.7 + 0.6 * rng());
    const side = rng() < 0.62 + 0.3 * sweep ? 1 : -1;
    const ax = tx(ly - y0), adz = (rng() - 0.5) * 0.8;
    if (k > 0 && k < K - 1 && rng() < 0.18) continue;          // a gap where a limb has gone
    const J = per >= 24 ? 4 : per >= 14 ? 3 : per >= 7 ? 2 : 1;
    const ex = ax + side * reach * (1 + 0.3 * sweep), ey = ly + (rng() - 0.3) * 1.2, ed = d + adz * reach;
    if (n > 70) strut(out, ax, ly - 0.4, -d, ex, ey, -ed, Math.max(0.04, tr * 0.45), mul3(BARK_PINE, 0.55), 2, 1, kind);
    for (let j = 0; j < J; j++) {
      const t = J === 1 ? 0.55 : 0.2 + 0.8 * j / (J - 1);
      // the branch dips and turns up again at its end, where the needles hang in plumes
      const cx = lerp(ax, ex, t), cyy = lerp(ly, ey, t) - 0.9 * Math.sin(Math.PI * t) + (rng() - 0.5) * 0.5, cd = lerp(d, ed, t) + (rng() - 0.5) * reach * 0.3;
      const lrx = reach * (0.34 - 0.08 * t) * (J === 1 ? 1.6 : 1) * (0.8 + 0.4 * rng()), lry = Math.max(0.4, lrx * (0.45 + 0.25 * rng()));
      const m = Math.round(per / J);
      const ss = Math.sqrt((lrx * lry * 3.6) / Math.max(1, m));
      for (let i = 0; i < m; i++) {
        let ux = rng() * 2 - 1, uy = rng() * 2 - 1, uz = rng() * 2 - 1;
        const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
        if (uz < -0.3 && rng() < 0.7) uz = -uz;
        const rad = Math.pow(rng(), 0.4);
        let c = shade(mix3(col, hi, 0.25 + 0.5 * Math.max(0, uy)), ux, uy * 1.4, uz, 0.5, 0.7);
        c = mul3(c, 0.6 + 0.4 * rad);
        c = jitter(c, rng, 0.12);
        const near = d < NEAR_D, s = (near ? Math.min(ss, sprayLen(d, false)) : ss) * (0.6 + 0.6 * rng());
        if (i === 0 && m >= 6) { const cc = mul3(col, 0.5); out(cx, cyy, -cd, lrx * (near ? 0.4 : 0.6), lry * (near ? 0.4 : 0.6), lrx * 0.45, cc[0], cc[1], cc[2], 1, 0, 0, 0, 1, kind); continue; }
        // (near the window a plume of needles is a long flat stroke, swept along the branch)
        if (near) out(cx + ux * lrx * rad, cyy + uy * lry * rad, -(cd - uz * lrx * 0.6 * rad), s * 1.9, s * 0.42, s * 0.9, c[0], c[1], c[2], 1, 0, 0, Math.sin((rng() - 0.5) * 0.25), Math.cos((rng() - 0.5) * 0.25), kind);
        else out(cx + ux * lrx * rad, cyy + uy * lry * rad, -(cd - uz * lrx * 0.6 * rad), s * 1.25, s * 0.8, s, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
        if (out.due()) yield;
      }
    }
  }
}

// Birch and aspen (pinewood.js's birch): a slender pale trunk with dark marks and an airy crown.
function* birch(ctx, out, x, d, opts = {}) {
  if (d < NEAR_D && opts.height && opts.width && (opts.n || 0) >= 40) { yield* nearBroadleaf(ctx, out, x, d, opts, opts.aspen ? 'aspen' : 'birch'); return; }
  const rng = opts.rng || ctx.rng;
  const aspen = !!opts.aspen;
  const H = opts.height || 14, Wc = opts.width || H * (aspen ? 0.3 + 0.08 * rng() : 0.4 + 0.12 * rng());
  const y0 = baseY(ctx, x, d, opts);
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const cr = opts.crown || CROWN[SP.BIRCH][0];
  const leaf = mix3(cr[0], cr[1], 0.4);
  const bark = aspen ? ASPEN_BARK : BIRCH_BARK;
  const n = Math.max(1, Math.round(opts.n || treeSplats(out, d, H, Wc) * 0.8));
  const lean = (rng() - 0.5) * 0.08;
  const tr = Math.max(0.05, H * 0.012, 0.0005 * d);
  const cb = H * ((aspen ? 0.4 + 0.12 * rng() : 0.3 + 0.12 * rng()) + (opts.tall ? 0.12 : 0));
  if (n <= 4) {
    out(x + lean * cb * 0.5, y0 + cb * 0.5, -d, tr * 1.2, cb * 0.45, tr, bark[0] * 0.85, bark[1] * 0.85, bark[2] * 0.85, 1, 0, 0, 0, 1, kind);
    // (a rounded crown, a little taller than wide, its shaded body under a lit cap: not a candle)
    const c = shade(leaf, -0.2, 0.8, 0.4, 0.62, 0.45), cw = Math.max(Wc, (H - cb) * 0.55);
    out(x + lean * H * 0.7, y0 + cb + (H - cb) * 0.45, -d, cw * 0.3, (H - cb) * 0.27, cw * 0.26, c[0] * 0.8, c[1] * 0.8, c[2] * 0.8, 1, 0, 0, 0, 1, kind);
    if (n >= 3) out(x + lean * H * 0.8 - cw * 0.06, y0 + cb + (H - cb) * 0.66, -d, cw * 0.2, (H - cb) * 0.15, cw * 0.18, Math.min(0.8, c[0] * 1.08), Math.min(0.8, c[1] * 1.08), Math.min(0.8, c[2] * 1.08), 1, 0, 0, 0, 1, kind);
    return;
  }
  const trunkN = clamp(Math.round(n * 0.12), 3, 40);
  const th = H * 0.85;
  for (let i = 0; i < trunkN; i++) {
    const t = (i + 0.5) / trunkN * th;
    const mark = rng() < (aspen ? 0.15 : 0.28) || t < 0.6;
    const c = mark ? [0.12, 0.11, 0.1] : mul3(bark, 0.9 + 0.1 * rng());
    out(x + lean * t, y0 + t, -d, tr * (1.1 - 0.5 * t / th), th / trunkN * 0.62, tr, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
  }
  const crownN = n - trunkN;
  const K = 3 + Math.floor(rng() * 3);
  for (let k = 0; k < K; k++) {
    const f = (k + 0.5) / K;
    const cy = y0 + cb + (H - cb) * (0.15 + 0.75 * f);
    const w = Wc * 0.5 * (1 - 0.6 * f * f) * (0.8 + 0.4 * rng());
    const cx = x + lean * (cy - y0) + (rng() - 0.5) * w * 0.4;
    const m = Math.round(crownN / K);
    const ss = Math.sqrt((w * w * 3) / Math.max(1, m)) * 0.7;
    const per = m >= 24 ? 4 : 1;
    const core = m >= 8;
    const lc = mix3(cr[1], cr[0], f);
    if (core) {
      const cc = mul3(shade(lc, 0, 0.3, 0.6, 0.55, 0.6), 0.6);
      out(cx, cy - w * 0.1, -d, w * 0.42, w * 0.36, w * 0.3, cc[0], cc[1], cc[2], 1, 0, 0, 0, 1, kind);
    }
    for (let i = 0; i < m; i += per) {
      let ux = rng() * 2 - 1, uy = rng() * 2 - 1, uz = rng() * 2 - 1;
      const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
      if (uz < -0.3 && rng() < 0.7) uz = -uz;
      const rad = 0.35 + 0.65 * Math.pow(rng(), 0.5);
      const len = per > 1 ? w * (0.25 + 0.3 * rng()) * (0.7 + 0.6 * Math.abs(ux)) : 0;
      let c = shade(lc, ux, uy, uz, 0.55, 0.6);
      c = mul3(c, 0.62 + 0.45 * rad);
      const px = cx + ux * w * rad, py = cy + uy * w * 0.75 * rad, pd = d - uz * w * 0.6 * rad;
      for (let j = 0; j < per; j++) {
        const cc = jitter(mul3(c, 1 - 0.12 * j), rng, 0.12);
        const s = ss * (0.6 + 0.5 * rng());
        if (core && i === 0) continue;
        out(px + ux * j * len * 0.08, py - j * len / per, -pd, s * 0.85, per > 1 ? Math.max(s, len / per * 0.85) : s, s * 0.75, cc[0], cc[1], cc[2], 0.92, 0, 0, 0, 1, kind);
      }
      if (out.due()) yield;
    }
  }
}
const aspen = (ctx, out, x, d, opts = {}) => birch(ctx, out, x, d, { ...opts, aspen: true });

// Each species: its builder, height range and crown width (as a share of the height).
const KINDS = [
  { fn: maple, h: [12, 19], w: 0.8 },        // sugar maple
  { fn: maple, h: [12, 18], w: 0.74 },       // red maple
  { fn: birch, h: [11, 17], w: 0.45 },
  { fn: aspen, h: [13, 20], w: 0.34 },
  { fn: tamarack, h: [11, 18], w: 0.3 },
  { fn: oak, h: [12, 18], w: 0.85 },
  { fn: spruce, h: [13, 21], w: 0.27 },
  { fn: spruce, h: [11, 17], w: 0.23 },      // balsam fir: narrower, shorter
  { fn: whitePine, h: [19, 28], w: 0.5 },
];
// A tree of species sp at (wx, d) standing at y: a plan entry. refl: drawn with its reflection.
// opts: hk (height scale), hmax (a cap on the height), alt (0 or 1: which of its kind's two beat
// groups the tree takes; from a hash of its place when not given), refl, detail, cap, open, tall.
let crownSel = null;
function planTree(ctx, out, sp, wx, d, y, r, opts = {}) {
  const K = KINDS[sp];
  let H = (K.h[0] + (K.h[1] - K.h[0]) * r()) * (opts.hk || 1);
  if (opts.hmax != null) H = Math.min(H, opts.hmax);
  const Wd = H * K.w * (0.85 + 0.3 * r()) * (opts.wk || 1);
  // (a broadleaf near the window is built of sprays whose number follows its crown's area: see
  // nearBroadleaf; everything else as treeSplats allows)
  const near = d < NEAR_D && (opts.detail || 1) >= 1;
  const broad = sp <= SP.OAK && sp !== SP.TAMARACK;
  const nMax = near ? Math.round(nearCount(H, opts.tall ? Wd * 0.75 : Wd, d, sp === SP.BIRCH || sp === SP.ASPEN) * (broad ? 1 : sp === SP.PINE ? 0.8 : 1.1)) : Math.max(1, Math.round(treeSplats(out, d, H, Wd) * (opts.detail || 1)));
  const alt = opts.alt != null ? opts.alt : hashInts(Math.round(wx * 2), Math.round(d * 2), 977) & 1;
  return {
    fn: K.fn, sp, x: wx - ctx.x0, d, w: (H * Wd) / (d * d), nMax: opts.cap ? Math.min(opts.cap, nMax) : nMax, refl: !!opts.refl,
    // (a tree across the water answers with its colour, as the crowns round it; one on the near side
    // with its neighbours alternating)
    group: opts.refl ? colourGroup(crownSel = crownOf(sp, r()), sp) : treeGroup(sp, alt),
    opts: { rng: r, height: H, width: opts.tall ? Wd * 0.75 : Wd, y, kind: opts.kind, crown: opts.refl ? crownSel : crownOf(sp, r()), open: opts.open, tall: opts.tall },
    across: !!opts.refl,
  };
}
// Share a budget between the plan's trees in proportion to their size on screen, capped at full
// detail; a tree drawn with its reflection costs twice its splats.
function* drawPlan(ctx, out, plan, budget) {
  let sw = 0;
  for (const t of plan) sw += t.w;
  plan.sort((a, b) => a.nMax / a.w - b.nMax / b.w || a.d - b.d || a.x - b.x);
  let B = budget, wLeft = sw;
  for (const t of plan) {
    const k = t.refl ? 2 : 1;
    const share = wLeft > 0 ? (B * t.w) / wLeft : 0;
    t.n = Math.max(1, Math.min(t.nMax, Math.round(share / k)));
    B -= t.n * k; wLeft -= t.w;
  }
  plan.sort((a, b) => a.d - b.d || a.x - b.x);
  for (const t of plan) {
    const mv = t.move != null ? t.move : t.d > GROVE_FAR && !t.across ? STILL : grove(t.group);
    const o = t.refl ? mirrorOut(out, mv) : withMove(out, mv);
    const n0 = out.n;
    yield* t.fn(ctx, o, t.x, t.d, { ...t.opts, n: t.n });
    if (t.d < 40) note('tree', ctx.x0 + t.x, t.d, { sp: t.sp, n: out.n - n0, plan: t.n, nMax: t.nMax, H: Math.round(t.opts.height) });
    if (out.due()) yield;
    if (out.n > out.limit) break;
  }
}
// The forest seen from outside, across the water: trees on a world grid; those at an edge facing
// the camera (water or bare shore in front) are planned at full detail, the row behind at less,
// and a few inside as cheap spires that break the canopy line. The fill's forest mass does the rest.
function forestPlan(ctx, out, W, plan, dLo, dHi, sp, opts = {}) {
  const g0 = Math.floor((ctx.x0 - 10) / sp), g1 = Math.floor((ctx.x0 + ctx.length + 10) / sp);
  const k0 = Math.floor(dLo / sp), k1 = Math.floor(dHi / sp);
  const forestAt = (wx, d) => { const s = surface(W, wx, d); return isTree(s.t) && s.far; };
  for (let gk = k0; gk <= k1; gk++) {
    for (let gx = g0; gx <= g1; gx++) {
      const r = worldRng(ctx, 501, gx, gk);
      const wx = (gx + r()) * sp, d = (gk + r()) * sp;
      if (d < dLo || d >= dHi) continue;
      const s = surface(W, wx, d);
      if (!s.far) continue;
      const y = s.y - 0.15;
      if (!isTree(s.t)) {
        // a lone pine or birch on the bare rock of the shore and the islands
        if ((s.t === T.SHORE || s.t === T.ROCK) && r() < 0.06) {
          const spx = r() < 0.6 ? SP.PINE : r() < 0.5 ? SP.BIRCH : SP.SPRUCE;
          plan.push(planTree(ctx, out, spx, wx, d, y, r, { refl: true, hk: 0.75, detail: opts.detail, open: true, cap: opts.cap }));
        }
        continue;
      }
      const nearW = smooth(60, 10, d - s.fd);
      let spc = pickSpecies(W, wx, d, r(), nearW, r());
      // now and then a white pine standing high over the rest, dark against the colour
      const tall = r() < 0.07;
      if (tall) spc = SP.PINE;
      if (!forestAt(wx, d - sp * 1.2)) { plan.push(planTree(ctx, out, spc, wx, d, y, r, { refl: true, detail: opts.detail, cap: opts.cap, hk: tall ? 1.15 : 1 })); continue; }
      if (opts.frontOnly) continue;            // (behind the front rank: the crown field, crowns())
      if (!forestAt(wx, d - sp * 2.6) || !forestAt(wx - sp * 1.5, d) || !forestAt(wx + sp * 1.5, d)) { plan.push(planTree(ctx, out, spc, wx, d, y, r, { refl: true, detail: 0.4 * (opts.detail || 1), cap: opts.cap })); continue; }
      if (r() < (opts.inner != null ? opts.inner : 0.1)) {
        const t = planTree(ctx, out, spc, wx, d, y, r, { hk: 1.1, refl: false });
        t.nMax = Math.min(t.nMax, 3);
        plan.push(t);
      }
    }
  }
}
// The woods on the near side of the water: every tree drawn, spaced so the lake shows between the
// trunks; and single trees on the shelf and in the open by the line.
// The trees below the line (on the slope and the shelf) stand no higher than a sightline a little
// under the far shore's, so the lake shows over their tops: near the rim only saplings, further down
// full trees whose crowns are seen from above. In the close woods, at rail level, they stand full
// height with their crowns low, and an understory of young maples, birch and hazel at 1 to 6 m.
// Beat groups: every tree takes one of its kind's two groups by the parity of its planting cell, so
// two neighbours of a kind never swell together.
function woodsPlan(ctx, out, W, plan, dLo, dHi, sp, keep = 0.5) {
  const g0 = Math.floor((ctx.x0 - 8) / sp), g1 = Math.floor((ctx.x0 + ctx.length + 8) / sp);
  for (let gk = Math.floor(dLo / sp); gk <= Math.floor(dHi / sp); gk++) {
    for (let gx = g0; gx <= g1; gx++) {
      const r = worldRng(ctx, 511, gx, gk);
      const wx = (gx + r()) * sp, d = (gk + r()) * sp;
      if (d < dLo || d >= dHi || d < 7) continue;
      // (each tree planned by the one chunk it stands in: a chunk drops splats far outside itself)
      if (wx < ctx.x0 || wx >= ctx.x0 + ctx.length) continue;
      const s = surface(W, wx, d);
      if (s.far || s.t === T.WATER) continue;
      const alt = (gx + gk) & 1;
      const u = r();
      const x = xAt(W, wx, XT), close = x.inl > 0.5 && d < x.edge;
      if (s.t === T.WOODS) { if (u > keep * (close ? 1.25 * smooth(10, 16, d) * (d > 22 ? 0.5 : 1) : smooth(8, 13, d))) continue; }
      else if (s.t === T.GRASS) { if (u > (x.sh > 0.5 ? 0.12 : 0.04)) continue; }
      else if (s.t === T.ROCK) { if (u > 0.03) continue; }
      else continue;
      const y = s.y - 0.15;
      if (close) {
        // the close woods: a mixed autumn wood, tree by tree
        const spc = woodsSpecies(r(), r());
        plan.push(planTree(ctx, out, spc, wx, d, y, r, { hk: 0.85 + 0.15 * smooth(15, 40, d), alt }));
        // the understory: a sapling or a young maple in colour in front of it
        if (r() < 0.7) {
          const ux = wx + (r() - 0.5) * sp * 0.8, ud = d - sp * (0.25 + 0.3 * r());
          if (ud > 6.5) {
            const us = r() < 0.55 ? (r() < 0.65 ? SP.MAPLE : SP.RMAPLE) : r() < 0.6 ? SP.BIRCH : SP.OAK;
            plan.push(planTree(ctx, out, us, ux, ud, W.H(ux, ud) - 0.1, r, { hk: 0.2 + 0.2 * r(), wk: 1.4, alt: 1 - alt }));
          }
        }
        continue;
      }
      // below the line: a height under the sightline
      const hmax = y < -3 ? CAMY - (r() < 0.1 ? 0.14 : 0.28) * d - y : 99;
      if (hmax < 3) continue;
      const nearW = smooth(40, 5, s.nd - d);
      const spc = pickSpecies(W, wx, d, r(), nearW, r());
      plan.push(planTree(ctx, out, spc, wx, d, y, r, { hk: s.t === T.WOODS ? 1 : 0.8, hmax, wk: hmax < 8 ? 1.3 : 1, alt }));
    }
  }
}
// The close woods' kinds, tree by tree (a few patches of one kind, never a block).
function woodsSpecies(u, v) {
  if (u < 0.27) return SP.MAPLE;
  if (u < 0.41) return SP.RMAPLE;
  if (u < 0.5) return SP.OAK;
  if (u < 0.7) return SP.BIRCH;
  if (u < 0.81) return SP.ASPEN;
  if (u < 0.85) return SP.TAMARACK;
  return v < 0.5 ? SP.PINE : v < 0.8 ? SP.SPRUCE : SP.FIR;
}

// ---------------------------------------------------------------------------------------------
// The ground's detail: granite boulders on the shelf, the shores and the islands; the low shrubs
// that turn first (blueberry crimson, staghorn sumac scarlet), dark juniper on the rock, bracken
// gone to bronze under the woods, and tufts of straw grass by the line.
// ---------------------------------------------------------------------------------------------
const SHRUB = {
  blueberry: [[0.56, 0.08, 0.08], [0.46, 0.06, 0.1]],
  sumac: [[0.74, 0.12, 0.04], [0.78, 0.3, 0.05]],
  juniper: [[0.08, 0.14, 0.1], [0.12, 0.17, 0.12]],
  bracken: [[0.56, 0.36, 0.14], [0.5, 0.3, 0.12]],
  hazel: [[0.8, 0.64, 0.1], [0.76, 0.54, 0.08]],             // hazel and striped maple: clear yellow
  sapling: [[0.76, 0.2, 0.05], [0.8, 0.42, 0.06], [0.62, 0.08, 0.06]],   // young maples: scarlet, flame, crimson
};
function* boulder(ctx, out, wx, d, y, r, rng) {
  const n = Math.max(3, Math.round(treeSplats(out, d, r * 1.3, r * 2) * 0.5));
  const col = mix3(C.granite, mix3(C.graniteDark, C.lichen, rng()), 0.25 + 0.4 * rng());
  yield* blob(ctx, out, wx - ctx.x0, y + r * 0.2, d, r, r * 0.55, r * 0.85, { n, color: col, rng, kind: KIND.ROCK, inner: 0.3, amb: 0.55, clump: 0.3 });
}
// Within 40 m a shrub has form: bracken is a ring of arching fronds, each a chain of thin leafy
// strokes drooping at its tip; a bush is a few thin stems fanning up from the ground with sprays of
// leaves along their upper parts, gaps between, lit on top. Sprays are sized from distance (as the
// near trees'), so a bush near the line is a few dozen clear shapes and not a soft cushion.
function* formShrub(out, x, y, d, w, h, cs, type, rng, cap) {
  const L = clamp(0.022 * d, 0.07, 0.6), K = KIND.HEDGE;
  if (type === 'bracken') {
    const nf = 5 + Math.floor(rng() * 5);
    for (let f = 0; f < nf; f++) {
      const a = (f / nf) * Math.PI * 2 + rng() * 0.6, reach = w * (0.35 + 0.2 * rng()), up = h * (0.8 + 0.4 * rng());
      const c0 = jitter(cs[Math.floor(rng() * cs.length)], rng, 0.08);
      let px = x, py = y + 0.02, pz = -d;
      const seg = 4;
      for (let k = 1; k <= seg; k++) {
        const t = k / seg, rr = reach * t, hh = up * Math.sin(Math.PI * 0.78 * t) * (1.1 - 0.25 * t);
        const nx = x + Math.cos(a) * rr, ny = y + hh, nz = -(d + Math.sin(a) * rr * 0.8);
        const dx = nx - px, dy = ny - py, dz = nz - pz, l = Math.hypot(dx, dy, dz) || 1e-6;
        const q = quatXTo(dx / l, dy / l, dz / l), c = mul3(c0, 0.7 + 0.4 * t);
        out((px + nx) / 2, (py + ny) / 2, (pz + nz) / 2, l * 0.55, Math.max(0.03, w * 0.07 * (1.2 - 0.6 * t)), 0.02, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], K);
        px = nx; py = ny; pz = nz;
      }
    }
    return;
  }
  const area = 0.7 * w * h, n = Math.max(8, Math.min(cap, Math.round(1.3 * area / (2.4 * L * L))));
  const ns = 3 + Math.floor(rng() * 4), tips = [];
  const sc = mul3(type === 'sapling' ? BARK : [0.32, 0.26, 0.2], 1.1);
  for (let k = 0; k < ns; k++) {
    // (nothing of it nearer the track than 6.1 m: only trees, masts and wires stand tall within 6 m)
    const a = rng() * Math.PI * 2, tip = [x + Math.cos(a) * w * (0.2 + 0.25 * rng()), y + h * (0.75 + 0.25 * rng()), Math.min(-6.1, -(d + Math.sin(a) * w * 0.3))];
    bar(out, [x + (rng() - 0.5) * 0.15, y, -d], tip, Math.max(0.018, 0.0006 * d), sc, 2, K);
    tips.push(tip);
  }
  const Ls = L * Math.sqrt(Math.max(1, (1.3 * area / (2.4 * L * L)) / n));
  for (let i = 0; i < n; i++) {
    // along a stem's upper part, out from it, the window's side favoured
    const tp = tips[i % ns], t = 0.35 + 0.65 * Math.sqrt(rng());
    let ux = rng() * 2 - 1, uy = rng() * 1.6 - 0.5, uz = Math.abs(rng() * 2 - 1) * 0.9;
    const ll = Math.hypot(ux, uy, uz) || 1; ux /= ll; uy /= ll; uz /= ll;
    const off = w * (0.12 + 0.2 * rng());
    const px = x + (tp[0] - x) * t + ux * off, py = y + (tp[1] - y) * t + uy * off * 0.8, pz = Math.min(-6.1, -d + (tp[2] + d) * t + uz * off * 0.6);
    const q = quatMul(quatXTo(-uy + 0.3 * (rng() - 0.5), ux, rng() - 0.5), quatAxis(1, 0, 0, rng() * Math.PI));
    let c = shade(cs[Math.floor(rng() * cs.length)], ux, uy, uz, 0.5, 0.62);
    c = jitter(mul3(c, (0.75 + 0.35 * t) * (uy < -0.2 ? 0.75 : 1)), rng, 0.07);
    const s = Ls * (0.7 + 0.6 * rng());
    out(px, py, pz, s, s * 0.45, s * 0.16, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], K);
  }
}
function* shrub(ctx, out, wx, d, y, w, h, type, rng, cap = Infinity) {
  const cs = SHRUB[type];
  if (d < 40) { yield* formShrub(out, wx - ctx.x0, y, d, w, h, cs, type, rng, Math.min(cap, 400)); if (out.due()) yield; return; }
  const n = Math.max(3, Math.min(cap, Math.round(treeSplats(out, d, h, w) * 0.6)));
  yield* blob(ctx, out, wx - ctx.x0, y + h * 0.35, d, w / 2, h * 0.6, w * 0.4, { n, color: jitter(cs[Math.floor(rng() * cs.length)], rng, 0.1), rng, kind: KIND.HEDGE, inner: 0.4, clump: 0.6 });
}
function* groundDetail(ctx, out, W, dLo, dHi, cell, per) {
  const k = Math.max(1, Math.round(per * Math.min(1.6, out.density)));
  for (const { i, wx0 } of cellsAround(ctx, cell, 3)) {
    for (let j = 0; j < k; j++) {
      const r = worldRng(ctx, 601, i, Math.round(dLo), j);
      const wx = wx0 + r() * cell, d = dLo + Math.pow(r(), 1.3) * (dHi - dLo);
      const u = r(), v = r();
      if (!inX(ctx, wx, 2) || d < 6.5) continue;
      const s = surface(W, wx, d);
      const t = s.t, y = s.y;
      const o = s.far ? mirrorOut(out, STILL) : withMove(out, STILL);
      if (t === T.ROCK || t === T.SHORE || t === T.ISLE_ROCK || t === T.RIPRAP) {
        if (u < 0.35) yield* boulder(ctx, o, wx, d, y, (t === T.RIPRAP ? 0.35 : 0.4) + 1.3 * v * v, r);
        else if (u < 0.55 && t !== T.RIPRAP) yield* shrub(ctx, mirrorIf(out, s, wx, d, 0.35 + 0.3 * v), wx, d, y, 1.2 + 1.5 * v, 0.35 + 0.3 * v, 'blueberry', r);
        else if (u < 0.68 && t !== T.RIPRAP) yield* shrub(ctx, mirrorIf(out, s, wx, d, 0.6 + 0.6 * v), wx, d, y, 1 + 1.4 * v, 0.6 + 0.6 * v, 'juniper', r);
      } else if (t === T.GRASS) {
        if (u < 0.18) yield* shrub(ctx, mirrorIf(out, s, wx, d, 1.2 + 1.6 * v), wx, d, y, 1.4 + 1.8 * v, 1.2 + 1.6 * v, 'sumac', r);
        else if (u < 0.32) yield* shrub(ctx, mirrorIf(out, s, wx, d, 0.3 + 0.2 * v), wx, d, y, 1 + v, 0.3 + 0.2 * v, 'blueberry', r);
        else if (u < 0.4) yield* boulder(ctx, o, wx, d, y, 0.4 + v, r);
        else if (d < 40) {
          // tufts of grass, gone to straw
          const c = jitter(mix3(C.grass, C.grassGold, v), r, 0.12), hh = 0.25 + 0.3 * v;
          for (let q = 0; q < 3; q++) out(wx - ctx.x0 + (r() - 0.5) * 0.5, y + hh * 0.5, -(d + (r() - 0.5) * 0.3), 0.07 + 0.003 * d, hh * 0.5, 0.06, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.HEDGE);
        }
      } else if (t === T.WOODS || t === T.FOREST || t === T.ISLE_WOOD) {
        const close = t === T.WOODS && xAt(W, wx, XT).inl > 0.5;
        if (close && u < 0.5) {
          // (the close woods' understory is drawn by understory(), with form)
        } else if (u < (close ? 0.75 : 0.3)) yield* shrub(ctx, mirrorIf(out, s, wx, d, 0.5 + 0.5 * v), wx, d, y, 1.2 + 1.2 * v, 0.5 + 0.5 * v, 'bracken', r);
        else if (u < (close ? 0.8 : 0.38)) yield* boulder(ctx, o, wx, d, y, 0.5 + v, r);
      }
      if (out.due()) yield;
    }
  }
}
// A plant's out: in a beat group by its place (near and middle distance only; its reflection still),
// mirrored if it stands beyond the near shore.
const plantMove = (wx, d) => (d < GROVE_FAR ? grove(hashInts(Math.round(wx), Math.round(d), 979) & 3) : STILL);
// The close woods' understory at the eye, on its own 3 m grid out to 30 m: hazel and striped maple
// in clear yellow, young maples scarlet and crimson, 1.2 to 4 m high, the beat groups alternating
// cell by cell (so the floor of the frame answers the beat, half of it at a time).
function* understory(ctx, out, W, dLo, dHi, maxN = Infinity) {
  const sp = 3, n0 = out.n;
  for (let gk = Math.floor(dLo / sp); gk * sp < dHi; gk++) {
    for (let gx = Math.floor((ctx.x0 - 3) / sp); gx * sp < ctx.x0 + ctx.length + 3; gx++) {
      const wx0 = gx * sp;
      if (xAt(W, wx0, XT).inl < 0.5) continue;
      const r = worldRng(ctx, 621, gx, gk);
      if (r() > 0.8) continue;
      const wx = wx0 + r() * sp, d = (gk + r()) * sp;
      if (d < Math.max(8, dLo) || d >= dHi || !inX(ctx, wx, 1)) continue;
      const s = surface(W, wx, d);
      if (s.t !== T.WOODS && s.t !== T.GRASS) continue;
      if (out.n - n0 > maxN) return;           // (the ground's fill keeps the rest)
      const v = r(), g = ((gx + gk) & 1) * 2 + (r() < 0.5 ? 1 : 0);
      // (the nearest kept low, so the eye looks over them into the wood; taller further in)
      const hTop = Math.min(4, 1.4 + 0.15 * (d - 8));
      const h = hTop * (0.55 + 0.45 * v);
      yield* shrub(ctx, withMove(out, h >= 1 ? grove(g) : STILL), wx, d, s.y, 1.4 + 1.6 * v + 0.4 * h, h, r() < 0.45 ? 'hazel' : 'sapling', r, Math.round((d < 16 ? 260 : 140) * Math.min(1.5, out.density)));
    }
  }
}
// (plants under a metre keep still: on its beat a grove hops a third of a metre, which would lift a
// blueberry or a clump of bracken clear of the ground)
const mirrorIf = (out, s, wx, d, h = 2) => { const mv = wx != null && h >= 1 ? plantMove(wx, d) : STILL; return s.far ? mirrorOut(out, mv) : withMove(out, mv); };
// The islands' rock: boulders, juniper and blueberry scattered over the granite, and their pines
// (a rocky island's few white pines and a spruce are placed here, not by the forest grid).
function* islandDetail(ctx, out, W, dLo, dHi, plan) {
  for (const { i } of cellsAround(ctx, ICELL, 150)) {
    const s = islandOf(W, i);
    if (!s || s.d < dLo || s.d >= dHi || !inX(ctx, s.wx, s.rx + 10)) continue;
    const r = makeRng(s.seed);
    const area = s.rx * s.rd;
    const nb = Math.round(clamp(area / 40, 3, 40) * Math.min(1.5, out.density) * (s.d < 400 ? 1 : 0.4));
    const o = mirrorOut(out, STILL);
    for (let k = 0; k < nb; k++) {
      // (each piece its own rng: a chunk that skips one must not shift the next)
      const r = makeRng(hashInts(s.seed, 200 + k));
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 0.92;
      const wx = s.wx + Math.cos(a) * rr * s.rx, d = s.d + Math.sin(a) * rr * s.rd;
      const u = r(), v = r();
      const isl = islandAt(W, wx, d);
      if (!isl || !inX(ctx, wx, 3)) continue;
      const y = W.H(wx, d);
      if (u < 0.45) yield* boulder(ctx, o, wx, d, y, 0.4 + 1.4 * v * v, r);
      else if (u < 0.7) yield* shrub(ctx, o, wx, d, y, 1.2 + 1.5 * v, 0.6 + 0.6 * v, 'juniper', r);
      else yield* shrub(ctx, o, wx, d, y, 1.2 + 1.5 * v, 0.3 + 0.3 * v, 'blueberry', r);
    }
    const c = s.cot;
    if (c) {
      const cr = makeRng(hashInts(s.seed, 9));
      const base = Math.min(W.H(c.cx - c.w / 2, c.cd), W.H(c.cx + c.w / 2, c.cd), W.H(c.cx, c.cd - c.dep / 2)) - 0.3;
      yield* cabin(ctx, mirrorOut(out), c.cx - ctx.x0, c.cd, base, { mirrored: true, w: c.w, dep: c.dep, h: c.h, yaw: (cr() - 0.5) * 0.3, log: c.log, wall: c.wall, roof: c.roof, trim: c.trim, porch: c.porch, chimney: true, chimneySide: cr() < 0.5 ? -1 : 1, smoke: true, lit: lightsOn(ctx), rng: cr });
      const od = mirrorOut(out, STILL);
      yield* dock(ctx, od, c.dx - ctx.x0, c.d0, c.d1, true, cr);
      for (let k = 0; k < 2; k++) chair(od, c.dx - ctx.x0 + (k ? 1.2 : -1.2), LV + 0.6, c.d1 + 1.6, (k ? -0.25 : 0.25), c.chairs[k]);
      if (cr() < 0.6) yield* canoe(od, c.dx - ctx.x0 - 6, W.H(c.dx - 6, c.d0 + 2) + 0.05, c.d0 + 2, { yaw: 0.3, len: 5.2, col: [0.66, 0.1, 0.07], flip: true }, cr);
      note('islandCottage', c.cx, c.cd);
    }
    if (!s.wooded && plan) {
      const r = makeRng(hashInts(s.seed, 7));
      const np = 1 + Math.floor(r() * Math.min(6, 1 + s.rx / 6));
      for (let k = 0; k < np; k++) {
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * 0.55;
        const wx = s.wx + Math.cos(a) * rr * s.rx, d = s.d + Math.sin(a) * rr * s.rd;
        const spc = r() < 0.72 ? SP.PINE : r() < 0.5 ? SP.SPRUCE : SP.BIRCH;
        plan.push(planTree(ctx, out, spc, wx, d, W.H(wx, d) - 0.2, r, { refl: true, hk: 0.7 + 0.3 * r(), open: true }));
      }
    }
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Buildings and the things on the shore. Every face is tiled with small splats lying in it (never
// one big splat: it would show a halo instead of an edge), and every building has all four walls
// and both roof slopes, since the train sees it from the left, square on and from the right.
// ---------------------------------------------------------------------------------------------
// A flat rectangle from corner o along u (length U) and v (length V), tiled at about s; colorAt(a, b)
// gives the colour at (a, b) in 0..1 (null leaves a hole). n is the face's normal for the turn.
function* panel(out, o, u, v, U, V, s, colorAt, kind, rng, move = 0, thick = 0.1) {
  const nu = Math.max(1, Math.round(U / (s * 1.5))), nv = Math.max(1, Math.round(V / (s * 1.5)));
  const q = quatBasis(u, v);
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = (i + 0.5 + (rng() - 0.5) * 0.25) / nu, b = (j + 0.5 + (rng() - 0.5) * 0.25) / nv;
      const c = colorAt(a, b);
      if (!c) continue;
      out(o[0] + u[0] * a * U + v[0] * b * V, o[1] + u[1] * a * U + v[1] * b * V, o[2] + u[2] * a * U + v[2] * b * V, (U / nu) * 0.62, (V / nv) * 0.62, Math.min(thick, s * 0.3), c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind, move);
      if (out.due()) yield;
    }
  }
}
// The rotation taking x to the unit vector u and y to v (u and v at right angles).
function quatBasis(u, v) {
  const lu = Math.hypot(u[0], u[1], u[2]) || 1, ux = u[0] / lu, uy = u[1] / lu, uz = u[2] / lu;
  let vx = v[0], vy = v[1], vz = v[2];
  const dp = vx * ux + vy * uy + vz * uz;
  vx -= dp * ux; vy -= dp * uy; vz -= dp * uz;
  const lv = Math.hypot(vx, vy, vz) || 1; vx /= lv; vy /= lv; vz /= lv;
  const wx = uy * vz - uz * vy, wy = uz * vx - ux * vz, wz = ux * vy - uy * vx;
  const m00 = ux, m11 = vy, m22 = wz, tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; w = 0.25 * S; x = (vz - wy) / S; y = (wx - uz) / S; z = (uy - vx) / S; }
  else if (m00 > m11 && m00 > m22) { const S = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (vz - wy) / S; x = 0.25 * S; y = (vx + uy) / S; z = (wx + uz) / S; }
  else if (m11 > m22) { const S = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (wx - uz) / S; x = (vx + uy) / S; y = 0.25 * S; z = (wy + vz) / S; }
  else { const S = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (uy - vx) / S; x = (wx + uz) / S; y = (wy + vz) / S; z = 0.25 * S; }
  return [x, y, z, w];
}
// A thin straight member with a motion class (kit strut() has none). a, b: [x, y, z] splat space.
function bar(out, a, b, r, c, n, kind = KIND.OTHER, move = 0, o = 1) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], len = Math.hypot(dx, dy, dz) || 1e-6;
  const q = quatXTo(dx / len, dy / len, dz / len), sl = Math.max((len / n) * 0.5, r);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    out(a[0] + dx * t, a[1] + dy * t, a[2] + dz * t, sl, r, r, c[0], c[1], c[2], o, q[0], q[1], q[2], q[3], kind, move);
  }
}
const thin = (d, k = 1) => Math.max(0.04, 0.0006 * d) * k;
const limbR = (r, d) => Math.max(r, 0.0007 * d);
const LIT = [1, 0.78, 0.44];

// A local frame at (x, base, d) turned by yaw: P(lx, ly, lz) -> splat space; lx along the front,
// lz out of the front (toward the train when yaw is 0), ly up.
function frame(x, base, d, yaw) {
  const ex = Math.cos(yaw), ez = -Math.sin(yaw), fx = Math.sin(yaw), fz = Math.cos(yaw);
  const P = (lx, ly, lz) => [x + ex * lx + fx * lz, base + ly, -d + ez * lx + fz * lz];
  return { P, e: [ex, 0, ez], f: [fx, 0, fz], up: [0, 1, 0], yaw };
}
// Faces toned by which way they look, so both corners read as a train passes (as kit house()).
// Splats for buildings grow at low budgets (a building stays whole, coarser).
function lowK(out) { return Math.max(1, 1 / Math.sqrt(Math.max(0.05, out.density))); }
function faceK(nx, nz) { return clamp(0.62 + 0.22 * nz - 0.16 * nx + 0.08, 0.45, 1.05); }

// A cabin: log walls (round logs, dark chinking between) or painted clapboard (red, green or white,
// with white trim at the corners and round the windows); a pitched roof with eaves; a stone chimney
// at one gable end with a thread of smoke; a porch along the front; lit windows after dusk.
//   o: { w, dep, h, yaw, log, wall, roof, trim, porch, chimney, lit, rng, kind, smoke }
function* cabin(ctx, out, x, d, base, o) {
  const rng = o.rng, kind = o.kind != null ? o.kind : KIND.BUILDING;
  const w = o.w, dep = o.dep, h = o.h, rh = dep * 0.42, yaw = o.yaw || 0;
  const F = frame(x, base, d, yaw), P = F.P, e = F.e, f = F.f, up = F.up;
  const s = Math.max(0.13 * lowK(out), detail(out, d, 1.0));
  // A building is drawn whole or not at all (after monsoon.js built()): if what it would cost
  // (twice, when it is mirrored) would run past the band's limit, it is left out.
  const sl0 = Math.hypot(rh, dep / 2) + 0.5;
  const cost = (2 * w * h + 2 * dep * (h + rh / 2) + 2 * (w + 0.9) * sl0 + (o.porch ? 2 * w * 2.4 : 0)) / Math.pow(1.5 * s, 2) + (o.chimney ? 2 * (h + rh) / (s * 1.2) + 10 : 0) + 30;
  if (out.n + cost * (o.mirrored ? 2 : 1) > out.limit) return;
  const lit = o.lit;
  const winC = [0.08, 0.09, 0.1];
  const wallAt = (U, V, nx, nz, wins, gable) => (a, b) => {
    const yy = b * V, xx = a * U;
    if (gable && yy > h && Math.abs(a - 0.5) * 2 > 1 - (yy - h) / rh) return null;
    const k = faceK(nx, nz);
    // windows: a row at sill height, framed in trim
    if (wins) {
      for (const wc of wins) {
        const dx = Math.abs(xx - wc), inW = dx < 0.55 && yy > 1.05 && yy < 2.15;
        if (inW) return dx < 0.42 && yy > 1.15 && yy < 2.05 ? mul3(winC, k) : mul3(o.trim, k);
      }
    }
    if (!o.log && (a < 0.035 || a > 0.965)) return mul3(o.trim, k);         // corner boards
    let c = o.wall;
    if (o.log) { const band = (yy / 0.3) % 1; c = band < 0.18 ? mul3(c, 0.45) : mul3(c, 0.8 + 0.35 * Math.sin(band * Math.PI)); }
    else { const band = (yy / 0.22) % 1; c = mul3(c, band < 0.15 ? 0.8 : 1); }
    return mul3(c, k * (b * V > h - 0.3 && !gable ? 0.8 : 1));
  };
  const fw = [w * 0.25, w * 0.72];
  // front and back walls, then the gable ends
  yield* panel(out, P(-w / 2, 0, dep / 2), e, up, w, h, s, wallAt(w, h, f[0], f[2], fw, false), kind, rng);
  yield* panel(out, P(w / 2, 0, -dep / 2), mul3(e, -1), up, w, h, s, wallAt(w, h, -f[0], -f[2], [w * 0.5], false), kind, rng);
  yield* panel(out, P(-w / 2, 0, -dep / 2), f, up, dep, h + rh, s, wallAt(dep, h + rh, -e[0], -e[2], [dep * 0.5], true), kind, rng);
  yield* panel(out, P(w / 2, 0, dep / 2), mul3(f, -1), up, dep, h + rh, s, wallAt(dep, h + rh, e[0], e[2], null, true), kind, rng);
  // the door, dark, on the front
  yield* panel(out, P(-w * 0.02 - 0.5, 0, dep / 2 + 0.04), e, up, 1, 2.1, s * 0.7, () => mul3(o.log ? [0.18, 0.12, 0.08] : o.trim, 0.7), kind, rng);
  // roof: both slopes with an overhang, a darker ridge
  const pitch = Math.atan2(rh, dep / 2), sl = Math.hypot(rh, dep / 2) + 0.5, ov = 0.45;
  for (const sg of [1, -1]) {
    const v = [-sg * f[0] * Math.cos(pitch), Math.sin(pitch), -sg * f[2] * Math.cos(pitch)];
    const o0 = P(-w / 2 - ov, h - 0.35 * Math.sin(pitch), sg * (dep / 2 + 0.5 * Math.cos(pitch)));
    const k = sg > 0 ? 1 : 0.78;
    yield* panel(out, o0, e, v, w + 2 * ov, sl, s, (a, b) => jitter(mul3(o.roof, k * (b > 0.93 ? 0.75 : 0.95 + 0.1 * a)), rng, 0.05), kind, rng);
  }
  // the porch: a deck along the front on posts, with a shed roof
  if (o.porch) {
    const pd = 2.2;
    yield* panel(out, P(-w / 2, 0.35, dep / 2), e, f, w, pd, s, () => jitter([0.4, 0.33, 0.25], rng, 0.08), kind, rng);
    for (const px of [-w / 2 + 0.2, -w / 6, w / 6, w / 2 - 0.2]) bar(out, P(px, 0.3, dep / 2 + pd - 0.15), P(px, h - 0.4, dep / 2 + pd - 0.15), thin(d, 1.1), o.log ? [0.3, 0.22, 0.14] : o.trim, 3, kind);
    const v = [f[0] * 0.97, -0.24, f[2] * 0.97];
    yield* panel(out, P(-w / 2 - 0.2, h - 0.25, dep / 2 - 0.1), e, v, w + 0.4, pd + 0.4, s, () => jitter(mul3(o.roof, 0.9), rng, 0.05), kind, rng);
  }
  // the chimney: fieldstone up the outside of one gable end and over the ridge, smoke from it
  if (o.chimney) {
    const cs = Math.max(0.22, s * 0.9), side = o.chimneySide || 1;
    const cx = side * (w / 2 + 0.35), top = h + rh + 1.1;
    for (let yy = 0.2; yy < top; yy += cs * 1.3) {
      for (const dz of [-0.35, 0.35]) {
        const c = jitter(mix3([0.46, 0.44, 0.42], [0.36, 0.3, 0.26], rng()), rng, 0.1);
        const p = P(cx, yy, dz);
        out(p[0], p[1], p[2], cs, cs * 0.8, cs, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
      }
    }
    if (o.smoke) yield* smoke(out, P(cx, top + 0.3, 0), d, rng, o.smokeK || 1);
  }
  if (lit) {
    // lit windows: lights (they ignore the dusk's tint), on the front, back and one end, each a
    // few panes of light laid in the wall, and a faint glow round them
    const panes = [[fw[0], dep / 2 + 0.07, e, f], [fw[1], dep / 2 + 0.07, e, f], [w * 0.5, -dep / 2 - 0.07, e, mul3(f, -1)]];
    for (const [px, pz, u, nrm] of panes) {
      if (rng() < 0.25) continue;
      const q = quatBasis(u, up);
      for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2) {
        const p = P(px - w / 2 + a * 0.18, 1.6 + b * 0.22, pz);
        out(p[0], p[1], p[2], 0.2, 0.24, 0.04, LIT[0], LIT[1], LIT[2], 1, q[0], q[1], q[2], q[3], KIND.LIGHT);
      }
      const p = P(px - w / 2, 1.6, pz + 0.25 * Math.sign(pz));
      out(p[0], p[1], p[2], 1.1, 0.9, 0.3, LIT[0], LIT[1], LIT[2], 0.12, 0, 0, 0, 1, KIND.LIGHT);
      void nrm;
    }
  }
  if (out.due()) yield;
}
// A thread of smoke from a chimney: soft pale splats rising and drifting east, billowing (VAPOUR).
function* smoke(out, p, d, rng, k = 1) {
  const n = 9;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, rr = (0.35 + 1.4 * t) * k;
    const c = mix3([0.62, 0.6, 0.58], [0.74, 0.74, 0.74], t);
    out(p[0] + t * t * 6 * k, p[1] + t * 9 * k, p[2], rr, rr * 0.8, rr, c[0], c[1], c[2], 0.5 * (1 - 0.7 * t), 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
  }
  if (out.due()) yield;
}
// A wooden dock on posts from (x, d0) out to (x, d1) (d1 < d0 reaches toward the train), 2 m wide,
// at the water: grey weathered planks across it, the posts in pairs, and a wider platform at the end.
function* dock(ctx, out, x, d0, d1, end, rng) {
  const y = LV + 0.55, dir = Math.sign(d1 - d0), len = Math.abs(d1 - d0);
  const wood = [0.46, 0.42, 0.36], post = [0.24, 0.2, 0.16];
  const pr = Math.max(0.12, detail(out, Math.min(d0, d1), 1.0) * 0.6);
  for (let t = 0.25; t < len; t += 0.5) {
    const d = d0 + dir * t, c = jitter(mul3(wood, 0.9 + 0.2 * rng()), rng, 0.08);
    out(x, y, -d, 1.05, 0.07, 0.32, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
    if (out.due()) yield;
  }
  for (let t = 0.3; t <= len + 0.01; t += 2.4) for (const sx of [-0.9, 0.9]) bar(out, [x + sx, y + 0.05, -(d0 + dir * t)], [x + sx, LV - 0.3, -(d0 + dir * t)], Math.max(pr, 0.09), post, 2);
  if (end) {
    // the platform at the end: 5 m across
    for (let a = -2.5; a <= 2.5; a += 0.5) for (let b = 0.25; b < 3.2; b += 0.5) {
      const c = jitter(mul3(wood, 0.9 + 0.2 * rng()), rng, 0.08);
      out(x + a, y, -(d1 - dir * 3.2 + dir * b), 0.32, 0.07, 0.32, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
    }
    for (const sx of [-2.4, 2.4]) for (const b of [0.2, 3.1]) bar(out, [x + sx, y, -(d1 - dir * 3.2 + dir * b)], [x + sx, LV - 0.3, -(d1 - dir * 3.2 + dir * b)], Math.max(pr, 0.09), post, 2);
  }
  if (out.due()) yield;
}
// A Muskoka chair, drawn 1.6 times life size: the wide flat arms, a seat sloping back, and a tall
// back of fanned slats leaning well back. yaw: the way it faces (0: toward the train).
const CHAIR_COLS = [[0.72, 0.12, 0.08], [0.8, 0.62, 0.1], [0.16, 0.42, 0.24], [0.2, 0.36, 0.62], [0.76, 0.75, 0.7], [0.78, 0.4, 0.08]];
function chair(out, x, y, d, yaw, col, k = 1.6) {
  const F = frame(x, y, d, yaw), P = F.P, s = k;
  const c = col, cd = mul3(col, 0.7);
  const r = Math.max(0.04 * s, 0.0007 * d);
  for (const sx of [-0.33, 0.33]) {
    bar(out, P(sx * s, 0, 0.3 * s), P(sx * s, 0.6 * s, 0.3 * s), r, cd, 2);          // front legs
    bar(out, P(sx * s, 0, -0.45 * s), P(sx * s, 0.36 * s, -0.1 * s), r, cd, 2);       // back legs
    bar(out, P(sx * s * 1.15, 0.6 * s, 0.38 * s), P(sx * s * 1.1, 0.6 * s, -0.32 * s), r * 1.6, c, 3);   // the wide arms
  }
  // the seat: slats sloping down toward the back
  for (let i = 0; i < 4; i++) { const t = i / 3; bar(out, P(-0.3 * s, (0.38 - 0.1 * t) * s, (0.25 - 0.45 * t) * s), P(0.3 * s, (0.38 - 0.1 * t) * s, (0.25 - 0.45 * t) * s), r * 1.3, c, 2); }
  // the back: five slats, fanned, leaning back
  for (let i = 0; i < 5; i++) {
    const u = (i - 2) / 2;
    bar(out, P(u * 0.2 * s, 0.3 * s, -0.25 * s), P(u * 0.28 * s, 1.05 * s, -0.62 * s + Math.abs(u) * 0.05 * s), r * 1.4, mul3(c, 0.92), 3);
  }
}
// A boathouse at the waterline, its doors to the water: a timber box half out over the lake on
// piles, a room above, a pitched roof, two dark door openings at the water. It faces along f.
function* boathouse(ctx, out, x, d, yaw, rng, wall, roof, trim) {
  const w = 7.5, dep = 9, h = 5.2, kind = KIND.BUILDING;
  const base = LV - 0.2;
  const F = frame(x, base, d, yaw), P = F.P, e = F.e, f = F.f, up = F.up;
  const s = Math.max(0.13 * lowK(out), detail(out, d, 1.0)), rh = 2.6;
  if (out.n + 2 * (2 * w * h + 2 * dep * (h + rh / 2) + 2 * dep * 4.6) / Math.pow(1.5 * s, 2) > out.limit) return;
  const doors = (a, b, U, V, nx, nz) => {
    const xx = a * U, yy = b * V, k = faceK(nx, nz);
    if (yy < 2.6 && (Math.abs(xx - U * 0.28) < 1.25 || Math.abs(xx - U * 0.72) < 1.25)) return yy < 2.45 ? [0.04, 0.045, 0.05] : mul3(trim, k);
    if (yy > 3.3 && yy < 4.4 && Math.abs(xx - U * 0.5) < 0.6) return Math.abs(xx - U * 0.5) < 0.45 && yy > 3.4 && yy < 4.3 ? [0.08, 0.09, 0.1] : mul3(trim, k);
    if (a < 0.03 || a > 0.97) return mul3(trim, k);
    return mul3(wall, k * ((yy / 0.22) % 1 < 0.15 ? 0.82 : 1));
  };
  yield* panel(out, P(-w / 2, 0, dep / 2), e, up, w, h, s, (a, b) => doors(a, b, w, h, f[0], f[2]), kind, rng);
  yield* panel(out, P(w / 2, 0, -dep / 2), mul3(e, -1), up, w, h, s, (a, b) => mul3(wall, faceK(-f[0], -f[2]) * (a < 0.03 || a > 0.97 ? 1 : 0.95)), kind, rng);
  for (const sg of [-1, 1]) {
    const o0 = sg < 0 ? P(-w / 2, 0, -dep / 2) : P(w / 2, 0, dep / 2), u = sg < 0 ? f : mul3(f, -1);
    yield* panel(out, o0, u, up, dep, h + rh, s, (a, b) => {
      const yy = b * (h + rh);
      if (yy > h && Math.abs(a - 0.5) * 2 > 1 - (yy - h) / rh) return null;
      return mul3(wall, faceK(sg * e[0], sg * e[2]) * ((yy / 0.22) % 1 < 0.15 ? 0.82 : 1));
    }, kind, rng);
  }
  const pitch = Math.atan2(rh, w / 2), sl = Math.hypot(rh, w / 2) + 0.4;
  // the ridge runs out over the water (along f): the slopes fall to the sides
  for (const sg of [1, -1]) {
    const v = [-sg * e[0] * Math.cos(pitch), Math.sin(pitch), -sg * e[2] * Math.cos(pitch)];
    const o0 = P(sg * (w / 2 + 0.35), h - 0.3, -dep / 2 - 0.4);
    yield* panel(out, o0, f, v, dep + 0.8, sl, s, () => jitter(mul3(roof, sg > 0 ? 1 : 0.8), rng, 0.05), kind, rng);
  }
  for (const a of [-w / 2, w / 2]) for (const b of [dep / 2, dep / 2 - 3]) bar(out, P(a, 0.2, b), P(a, -0.6, b), Math.max(0.12, s * 0.6), [0.2, 0.17, 0.14], 2, kind);
}
// A canoe: a slim hull built of rows of splats along its gunwales and keel, so its shape holds from
// the side and from the ends; upturned (on a beach) or afloat. o: { yaw, len, col, flip }
function* canoe(out, x, y, d, o, rng, kind = KIND.OTHER, move = STILL) {
  const L = o.len || 5.2, B = 0.85, H = 0.38, yaw = o.yaw || 0, col = o.col;
  const F = frame(x, y, d, yaw), P = F.P;
  const nL = Math.max(6, Math.round(L / Math.max(0.16, 0.002 * d)));
  const flip = o.flip ? -1 : 1;
  for (let i = 0; i < nL; i++) {
    const t = (i + 0.5) / nL, u = (t - 0.5) * L, wq = Math.sqrt(Math.max(0, 1 - Math.pow(2 * t - 1, 2)));
    const rise = 0.25 * Math.pow(2 * t - 1, 4);           // the ends sweep up
    const r = Math.max(0.07, 0.11 * wq + 0.04, 0.0006 * d);
    for (const [vv, hh, k] of [[1, 1, 1], [-1, 1, 0.75], [0.55, 0.45, 0.9], [-0.55, 0.45, 0.68], [0, 0, 0.6]]) {
      const c = mul3(col, k * (0.9 + 0.15 * rng()));
      const p = P(u, (hh * H + rise * hh) * flip + (flip < 0 ? H : 0), vv * B * 0.5 * wq);
      out(p[0], p[1], p[2], L / nL * 0.75, r, r * 1.1, c[0], c[1], c[2], 1, 0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2), kind, move);
    }
    if (out.due()) yield;
  }
  if (!o.flip) {
    // the thwarts and the seats, pale wood across the hull
    for (const u of [-0.32, 0, 0.32]) bar(out, P(u * L, H * 0.7, -B * 0.45), P(u * L, H * 0.7, B * 0.45), Math.max(0.04, 0.0006 * d), [0.6, 0.5, 0.34], 2, kind, move);
  }
}
// A diving raft: a square of planks on drums, a ladder, moored off a point.
function* raft(ctx, out, x, d, rng) {
  const y = LV + 0.45, wood = [0.58, 0.52, 0.42];
  for (let a = -1.75; a <= 1.75; a += 0.5) for (let b = -1.75; b <= 1.75; b += 0.5) {
    const c = jitter(mul3(wood, 0.9 + 0.2 * rng()), rng, 0.06);
    out(x + a, y, -(d + b), 0.32, 0.08, 0.32, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
  }
  for (const sx of [-1.75, 1.75]) for (const b of [-1.2, 0, 1.2]) out(x + sx, y - 0.25, -(d + b), 0.08, 0.25, 0.5, wood[0] * 0.8, wood[1] * 0.8, wood[2] * 0.8, 1, 0, 0, 0, 1, KIND.OTHER);   // the skirt boards
  for (const sx of [-0.35, 0.35]) bar(out, [x + sx, y + 0.9, -(d - 1.8)], [x + sx, LV - 0.3, -(d - 1.9)], 0.04, [0.7, 0.7, 0.68], 3);
  for (let k = 0; k < 3; k++) bar(out, [x - 0.35, y - 0.15 + k * 0.35, -(d - 1.85)], [x + 0.35, y - 0.15 + k * 0.35, -(d - 1.85)], 0.03, [0.7, 0.7, 0.68], 1);
  if (out.due()) yield;
}
// A float plane moored at a dock: a high-winged bush plane (yellow, red or white with a stripe) on
// two floats. It faces along the line (dir), 9.5 m long, a 14.6 m wing; drawn life size.
const PLANE_COLS = [[[0.8, 0.62, 0.08], [0.6, 0.1, 0.06]], [[0.62, 0.1, 0.07], [0.76, 0.75, 0.7]], [[0.76, 0.75, 0.7], [0.15, 0.25, 0.5]]];
function* floatPlane(ctx, out, x, d, dir, rng) {
  const [body, stripe] = PLANE_COLS[Math.floor(rng() * PLANE_COLS.length)];
  const y0 = LV, s = Math.max(0.12 * lowK(out), detail(out, d, 0.9));
  if (out.n + 2 * (14.6 * 1.8 + 8) / Math.pow(1.5 * s, 2) + 400 > out.limit) return;
  const X = (u) => x + dir * u;
  // the floats: long, pale, slim, upswept at the bow
  for (const sz of [-1.4, 1.4]) {
    for (let u = -3.6; u <= 3.8; u += Math.max(0.3, s * 1.2)) {
      const t = (u + 3.6) / 7.4, r = 0.32 * Math.sqrt(Math.max(0.05, 1 - Math.pow(2 * t - 1, 6)));
      out(X(u), y0 + 0.3 + (t > 0.85 ? (t - 0.85) * 1.5 : 0), -(d + sz), Math.max(0.3, s * 1.2) * 0.7, r, r, 0.7, 0.7, 0.68, 1, 0, 0, 0, 1, KIND.OTHER);
    }
    for (const u of [-0.6, 1.6]) bar(out, [X(u), y0 + 0.5, -(d + sz)], [X(u * 0.8), y0 + 1.6, -(d + sz * 0.35)], thin(d), [0.3, 0.3, 0.32], 2);
  }
  // the fuselage: deep at the cabin, tapering to the tail
  for (let u = -4.6; u <= 3.2; u += Math.max(0.25, s)) {
    const t = (u + 4.6) / 7.8, rr = 0.25 + 0.55 * Math.sin(Math.min(1, t * 1.6) * Math.PI / 2) * (t > 0.85 ? 0.8 : 1);
    const yy = y0 + 2.1 + (1 - t) * 0.5;
    for (const [dz, k] of [[0.45, 1], [-0.45, 0.75], [0, 0.9]]) {
      const c = mul3(Math.abs(yy - (y0 + 2.2)) < 0.15 && t > 0.2 ? stripe : body, k);
      out(X(u), yy + (dz === 0 ? rr * 0.6 : 0), -(d + dz * rr), Math.max(0.25, s) * 0.8, rr * 0.75, rr * 0.5, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
    }
  }
  // the cabin windows, the engine cowl, the propeller
  out(X(2.0), y0 + 2.75, -(d - 0.55), 0.8, 0.28, 0.05, 0.12, 0.15, 0.2, 1, 0, 0, 0, 1, KIND.OTHER);
  out(X(3.4), y0 + 2.15, -d, 0.45, 0.55, 0.55, 0.15, 0.15, 0.16, 1, 0, 0, 0, 1, KIND.OTHER);
  bar(out, [X(3.75), y0 + 1.15, -d], [X(3.75), y0 + 3.15, -d], thin(d), [0.2, 0.2, 0.2], 3);
  // the wing on top, tiled, with its struts; the tail fin and tailplane
  yield* panel(out, [X(1.4) - dir * 0.8, y0 + 3.05, -(d - 7.3)], [0, 0, -1], [dir, 0, 0], 14.6, 1.8, s, (a, b) => (b < 0.12 ? mul3(stripe, 0.9) : mul3(body, 0.95)), KIND.OTHER, rng, 0, 0.08);
  for (const sz of [-1, 1]) bar(out, [X(1.0), y0 + 1.9, -(d + sz * 0.5)], [X(1.2), y0 + 3.0, -(d + sz * 2.8)], thin(d), [0.3, 0.3, 0.32], 2);
  yield* panel(out, [X(-4.6), y0 + 2.4, -d], [dir, 0, 0], [0, 1, 0], 1.6, 1.6, s, (a, b) => (b < 1 - a * 0.6 ? body : null), KIND.OTHER, rng, 0, 0.06);
  yield* panel(out, [X(-4.4), y0 + 2.45, -(d - 2.2)], [0, 0, -1], [dir, 0, 0], 4.4, 1.0, s, () => body, KIND.OTHER, rng, 0, 0.06);
}

// --- cottages: a cabin by the water with its dock, chairs, a boathouse, a canoe, a raft, a plane ---
const SCELL = 440;
const LOG_WALLS = [[0.4, 0.27, 0.16], [0.33, 0.22, 0.13], [0.46, 0.33, 0.2]];
const PAINT = [[[0.5, 0.12, 0.08], [0.74, 0.73, 0.68]], [[0.16, 0.3, 0.2], [0.74, 0.73, 0.68]], [[0.74, 0.73, 0.68], [0.16, 0.28, 0.2]], [[0.62, 0.48, 0.26], [0.36, 0.14, 0.1]], [[0.24, 0.32, 0.42], [0.74, 0.73, 0.68]]];
const ROOFS = [[0.16, 0.2, 0.16], [0.36, 0.12, 0.09], [0.24, 0.24, 0.25], [0.3, 0.26, 0.2]];
function siteOf(W, i) {
  return cache(W, ST.CABIN, i, () => {
    const r = makeRng(hashInts(W.ws, 71, i));
    if (r() > 0.62) return null;
    const wx = (i + 0.2 + 0.6 * r()) * SCELL;
    const x = xAt(W, wx, { ...XT });
    const nearOK = x.sh > 0.8 && x.be - x.bs > 24, farOK = x.fd < 620;
    if (!nearOK && !farOK) return null;
    const near = nearOK && (!farOK || r() < 0.6);
    // the shore along the site's width: the cabin stands back from its nearest point, the dock
    // reaches out from its furthest
    let sdIn = near ? Infinity : -Infinity, sdOut = near ? -Infinity : Infinity;
    for (let u = -16; u <= 16; u += 4) {
      const xx = xAt(W, wx + u, { ...XT });
      const sd = near ? xx.nd : xx.fd;
      if (near) { sdIn = Math.min(sdIn, sd); sdOut = Math.max(sdOut, sd); } else { sdIn = Math.max(sdIn, sd); sdOut = Math.min(sdOut, sd); }
    }
    const log = r() < 0.5;
    const paint = PAINT[Math.floor(r() * PAINT.length)];
    // (drawn larger than life, as everything here that is meant to be seen: a cottage across a
    // narrows is 300 m off)
    const big = near ? 1.15 : 1.4;
    const w = (7 + 3 * r()) * big, dep = (6 + 1.6 * r()) * big, h = (3 + 0.5 * r()) * big;
    const s = {
      i, wx, near, log, w, dep, h,
      wall: log ? LOG_WALLS[Math.floor(r() * LOG_WALLS.length)] : paint[0], trim: log ? [0.7, 0.68, 0.62] : paint[1],
      roof: ROOFS[Math.floor(r() * ROOFS.length)],
      cd: near ? Math.min(sdIn - 8, x.be - 2) - dep / 2 : sdIn + 7 + dep / 2, cx: wx - 4 - 3 * r(),
      dx: wx + 3 + 2 * r(), d0: near ? sdOut - 1.5 : sdOut + 1.5, len: 10 + 9 * r(), end: r() < 0.65,
      chairs: r() < 0.8 ? [CHAIR_COLS[Math.floor(r() * CHAIR_COLS.length)], CHAIR_COLS[Math.floor(r() * CHAIR_COLS.length)]] : null,
      boathouse: r() < 0.3, plane: r() < 0.22, canoe: r() < 0.5, raft: r() < 0.3, porch: r() < 0.6,
      yaw: (near ? Math.PI : 0) + (r() - 0.5) * 0.35, seed: hashInts(W.ws, 72, i),
    };
    if (near && (s.cd < 40 || !inFrame(s.cd - dep / 2, x.yb))) return null;
    s.d1 = s.d0 + (near ? 1 : -1) * s.len;
    // keep the dock's far end in open water
    if (!openWater(W, s.dx, s.d1 + (near ? 4 : -4))) return null;
    return s;
  });
}
function sitesAround(W, wx, m) {
  const res = [];
  for (let i = Math.floor((wx - m) / SCELL); i <= Math.floor((wx + m) / SCELL); i++) { const s = siteOf(W, i); if (s) res.push(s); }
  return res;
}
// Whether (wx, d) is in a cottage's clearing (no trees there: grass and the yard).
function inClearing(W, wx, d) {
  const i0 = Math.floor(wx / SCELL);
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const s = siteOf(W, i);
    // (on the near side the clearing runs back toward the line, so the trees do not hide the cabin)
    if (s && Math.abs(wx - s.cx) < s.w / 2 + 9 && d - s.cd < s.dep / 2 + 8 && s.cd - d < s.dep / 2 + (s.near ? 30 : 8)) return true;
  }
  return false;
}
// Whether (wx, d) is in a campsite's or a landing beach's clearing on the far shore.
function campClear(W, wx, d) {
  const i0 = Math.floor(wx / WCELL);
  for (let i = i0 - 1; i <= i0 + 1; i++) {
    const t = waterThingOf(W, i);
    if (t && (t.kind === 'camp' || t.kind === 'beach') && Math.abs(wx - t.wx) < 14 && d - t.d < 10 && t.d - d < 8) return true;
  }
  return false;
}
// Open water at a point (no island), without asking surface(), which asks for the clearings.
function openWater(W, wx, d) { const x = xAt(W, wx, { ...XT }); return d > x.nd + 1 && d < x.fd - 1 && !islandAt(W, wx, d); }
function* cottages(ctx, out, W, dLo, dHi, night) {
  for (const s of sitesAround(W, ctx.x0 + ctx.length / 2, ctx.length / 2 + 40)) {
    let r = makeRng(s.seed);
    const oc = s.near ? withMove(out, 0) : mirrorOut(out);
    if (inD(s.cd, dLo, dHi) && inX(ctx, s.cx, 12)) {
      const base = Math.min(W.H(s.cx - s.w / 2, s.cd), W.H(s.cx + s.w / 2, s.cd), W.H(s.cx, s.cd - s.dep / 2), W.H(s.cx, s.cd + s.dep / 2)) - 0.3;
      yield* cabin(ctx, oc, s.cx - ctx.x0, s.cd, base, { mirrored: !s.near, w: s.w, dep: s.dep, h: s.h, yaw: s.yaw, log: s.log, wall: s.wall, roof: s.roof, trim: s.trim, porch: s.porch, chimney: true, chimneySide: r() < 0.5 ? -1 : 1, smoke: true, lit: night, rng: r });
      note('cabin', s.cx, s.cd, { near: s.near });
    }
    r = makeRng(hashInts(s.seed, 300));
    const dm = (s.d0 + s.d1) / 2;
    const od = mirrorOut(out, STILL);
    if (inD(dm, dLo, dHi) && inX(ctx, s.dx, 4)) {
      yield* dock(ctx, od, s.dx - ctx.x0, s.d0, s.d1, s.end, r);
      if (s.chairs) {
        const cd = s.d1 - (s.near ? 1.6 : -1.6);
        for (let k = 0; k < 2; k++) chair(od, s.dx - ctx.x0 + (k ? 1.2 : -1.2) * (s.end ? 1 : 0.4), LV + 0.6, cd, (s.near ? Math.PI : 0) + (k ? -0.25 : 0.25), s.chairs[k]);
      }
      // someone on the dock: standing at its end looking out, or fishing off it
      if (r() < 0.6) {
        const pk = boatK(s.d1) / 1.25, pd = s.d1 - (s.near ? 0.6 : -0.6);
        person(scaleOut(mirrorOut(out), s.dx - ctx.x0 + 1.8, LV + 0.6, -pd, pk), s.dx - ctx.x0 + 1.8, LV + 0.6, pd, r, { pose: 'stand', hat: r() < 0.5, arms: r() < 0.5 ? [[0.3, 0.05, 0.2], [0.25, 0, 0.1]] : null });
        note('dockPerson', s.dx, s.d1);
      }
      note('dock', s.dx, s.d1, { chairs: !!s.chairs });
    }
    if (s.boathouse) {
      r = makeRng(hashInts(s.seed, 301));
      const bx = s.dx + 13, bd = s.d0 + (s.near ? 2 : -2);
      if (inD(bd, dLo, dHi) && inX(ctx, bx, 10)) yield* boathouse(ctx, mirrorOut(out), bx - ctx.x0, bd, s.near ? Math.PI : 0, r, s.log ? s.wall : PAINT[0][0], s.roof, s.trim);
    }
    if (s.canoe) {
      r = makeRng(hashInts(s.seed, 302));
      const bx = s.dx - 8, bd = s.d0 + (s.near ? -1 : 1);
      if (inD(bd, dLo, dHi) && inX(ctx, bx, 4)) yield* canoe(mirrorOut(out, STILL), bx - ctx.x0, W.H(bx, bd) + 0.05, bd, { yaw: 0.4, len: 5.2, col: [[0.66, 0.1, 0.07], [0.18, 0.36, 0.22], [0.56, 0.56, 0.55]][Math.floor(r() * 3)], flip: true }, r);
    }
    if (s.raft) {
      r = makeRng(hashInts(s.seed, 303));
      const rd = s.d1 + (s.near ? 22 : -22), rx = s.dx + 6;
      if (inD(rd, dLo, dHi) && inX(ctx, rx, 3) && openWater(W, rx, rd)) yield* raft(ctx, mirrorOut(out, STILL), rx - ctx.x0, rd, r);
    }
    if (s.plane) {
      r = makeRng(hashInts(s.seed, 304));
      const px = s.dx + (s.end ? 7.5 : 5.5), pd = s.d1 + (s.near ? -4 : 4);
      if (inD(pd, dLo, dHi) && inX(ctx, px, 12) && openWater(W, px, pd)) { yield* floatPlane(ctx, mirrorOut(out, STILL), px - ctx.x0, pd, r() < 0.5 ? 1 : -1, r); note('plane', px, pd); }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// People and boats. People are drawn 1.6 times life size and tagged MOVE.FLASH (they brighten on
// the beat, never swell); boats are rigid, MOVE.STILL. Everything on the water goes out through
// mirrorOut, so each has its reflection under it.
// ---------------------------------------------------------------------------------------------
const CLOTH = [[0.68, 0.12, 0.08], [0.2, 0.3, 0.5], [0.78, 0.5, 0.08], [0.2, 0.36, 0.24], [0.12, 0.12, 0.14], [0.56, 0.5, 0.4], [0.72, 0.72, 0.68]];
const SKIN = [[0.6, 0.44, 0.34], [0.5, 0.36, 0.26], [0.36, 0.24, 0.16]];
const PK = 1.6;
// A person: o.pose 'sit' (in a boat: from the hips up), 'stand'; o.arms: [[ex, ey, ez], [..]]
// the hands, in metres from the shoulders' middle (life size, before scaling); o.vest: an orange
// life jacket over the clothes; o.hat: a toque.
function person(out, x, y0, d, r, o = {}) {
  const k = PK * (o.k || 1), z = -d, mv = FLASH, K = KIND.OTHER;
  const cl = o.cloth || CLOTH[Math.floor(r() * CLOTH.length)], sk = SKIN[Math.floor(r() * SKIN.length)];
  const lr = limbR(0.06 * k, d);
  const sit = o.pose !== 'stand';
  const hip = y0 + (sit ? 0.1 : 0.9) * k;
  if (!sit) {
    bar(out, [x - 0.08 * k, hip, z], [x - 0.11 * k, y0 + 0.03, z], lr * 1.3, mul3(cl, 0.45), 2, K, mv);
    bar(out, [x + 0.08 * k, hip, z], [x + 0.11 * k, y0 + 0.03, z], lr * 1.3, mul3(cl, 0.4), 2, K, mv);
  }
  const ty = hip + 0.3 * k, tc = o.vest ? [0.8, 0.36, 0.06] : cl;
  out(x, ty, z, 0.19 * k, 0.27 * k, 0.13 * k, tc[0], tc[1], tc[2], 1, 0, 0, 0, 1, K, mv);
  const sh = hip + 0.52 * k, hy = hip + 0.72 * k;
  out(x, hy, z, 0.1 * k, 0.11 * k, 0.1 * k, sk[0], sk[1], sk[2], 1, 0, 0, 0, 1, K, mv);
  if (o.hat) { const hc = o.hatC || [0.66, 0.1, 0.08]; out(x, hy + 0.08 * k, z, 0.105 * k, 0.07 * k, 0.105 * k, hc[0], hc[1], hc[2], 1, 0, 0, 0, 1, K, mv); }
  const arms = o.arms || [[-0.2, -0.45, 0], [0.2, -0.45, 0]];
  arms.forEach(([ex, ey, ez], i) => {
    const sx = (i ? 1 : -1) * 0.17 * k;
    const hand = [x + ex * k, sh + ey * k, z - ez * k];
    const elbow = [(x + sx + hand[0]) / 2, (sh + hand[1]) / 2 - 0.08 * k, (z + hand[2]) / 2];
    bar(out, [x + sx, sh, z], elbow, lr, mul3(cl, 0.85), 1, K, mv);
    bar(out, elbow, hand, lr * 0.9, mul3(cl, 0.85), 1, K, mv);
  });
  return [x, sh, z];
}
// A wake: two pale lines on the water spreading back from the bow, and a short trail behind.
function wake(out, x, d, dir, len, k = 1) {
  const c = C.ruffle;
  for (let i = 1; i <= 7; i++) {
    const t = i / 7, back = t * len, spread = t * len * 0.36;
    for (const sg of [-1, 1]) out(x - dir * back, LV + 0.02, -(d + sg * spread), 0.9 * k, 0.02, 0.18 * k * (1 + t), c[0], c[1], c[2], 0.75 * (1 - 0.7 * t), 0, 0, 0, 1, KIND.GROUND);
  }
}
// A hull: rows of splats along the gunwales, the sides and the keel, the ends swept up (canoe),
// blunt at the stern (a rowboat, a skiff). L long, B beam, H deep; dir: which way the bow points.
function hull(out, x, d, dir, L, B, H, col, inside, stern, r) {
  const n = Math.max(7, Math.round(L / Math.max(0.15, 0.0022 * d)));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, u = (t - 0.5) * L;
    const bow = t > 0.5 ? 2 * t - 1 : 0, aft = t < 0.5 ? 1 - 2 * t : 0;
    const wq = stern ? Math.sqrt(Math.max(0, 1 - Math.pow(bow, 2.2))) * (1 - 0.25 * aft * aft) : Math.sqrt(Math.max(0, 1 - Math.pow(2 * t - 1, 2)));
    const rise = stern ? 0.12 * bow * bow : 0.3 * Math.pow(2 * t - 1, 4);
    const rr = Math.max(0.06, 0.1 * wq + 0.035, 0.0006 * d);
    for (const [vv, hh, kk] of [[1, 1, 1], [-1, 1, 0.72], [0.6, 0.45, 0.9], [-0.6, 0.45, 0.65], [0, 0.05, 0.5]]) {
      const c = mul3(col, kk * (0.92 + 0.12 * r()));
      out(x + dir * u, LV + hh * H + rise * hh - 0.05, -(d + vv * B * 0.5 * wq), L / n * 0.75, rr, rr * 1.1, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER, STILL);
    }
    if (inside && i % 2 === 0) { const c = inside; out(x + dir * u, LV + H * 0.55, -d, L / n * 1.4, 0.04, B * 0.38 * wq, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER, STILL); }
  }
}
// A paddle or an oar from the hands down into the water, the blade at its end.
function paddle(out, a, b, d, bladeC, shaft = [0.55, 0.42, 0.26]) {
  bar(out, a, b, limbR(0.035, d), shaft, 3, KIND.OTHER, STILL);
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz) || 1;
  const p = [b[0] + dx / l * 0.3, b[1] + dy / l * 0.3, b[2] + dz / l * 0.3];
  bar(out, b, p, limbR(0.09, d), bladeC, 1, KIND.OTHER, STILL);
}
const BOATCELL = 125;
function boatOf(W, i) {
  return cache(W, ST.BOAT, i, () => {
    const r = makeRng(hashInts(W.ws, 81, i));
    if (r() > 0.75) return null;
    const wx = (i + 0.2 + 0.6 * r()) * BOATCELL;
    const x = xAt(W, wx, { ...XT });
    const u = r();
    const type = u < 0.24 ? 'row' : u < 0.48 ? 'canoe' : u < 0.64 ? 'skiff' : u < 0.76 ? 'kayak' : u < 0.9 ? 'sail' : 'pontoon';
    const lo = Math.max(x.nd + 18, WATER_SEEN + 6), hi = Math.min(x.fd - 25, 240);
    if (hi - lo < 10) return null;
    const d = lo + (hi - lo) * Math.pow(r(), 1.4);
    for (const dx of [-5, 0, 5]) for (const dd of [-4, 4]) if (!openWater(W, wx + dx, d + dd)) return null;
    return { i, wx, d, type, dir: r() < 0.5 ? 1 : -1, moving: type !== 'skiff' && type !== 'pontoon' && r() < 0.7, seed: hashInts(W.ws, 82, i) };
  });
}
// An out that scales everything about (cx, cy, cz): a thing drawn at life size comes out S times
// larger. Scaled about the water level it still floats, and it commutes with the mirror.
function scaleOut(out, cx, cy, cz, S) {
  const m = (x, y, z, sx, sy, sz, r, g, b, o = 1, qx = 0, qy = 0, qz = 0, qw = 1, kind = KIND.OTHER, mv = 0) => out(cx + (x - cx) * S, cy + (y - cy) * S, cz + (z - cz) * S, sx * S, sy * S, sz * S, r, g, b, o, qx, qy, qz, qw, kind, mv);
  wrapLike(m, out);
  return m;
}
const boatK = (d) => 1.6 + 0.9 * smooth(70, 230, d);
// The lived-in lake: small things on the water and its far shore, one to a world cell of 62 m,
// mostly 70 to 250 m out where they read (drawn larger than life, as the boats), every one with its
// reflection. Rigid things STILL, animals and people FLASH.
//   buoy      a red or white marker buoy with a band (the channel past a point)
//   ducks     a raft of mallards and black ducks, six to twelve
//   snag      a deadhead or a drowned tree: a grey trunk leaning out of the water, a stub of root
//   lily      a lily bed off the shore: broad pads, green and yellowing, a few white flowers
//   islet     a granite islet just breaking the water, with a white pine or two
//   swimmer   a moose or a deer swimming across, only its head and back showing, its V wake
//   moored    a boat at a mooring, nobody in it
//   camp      on the far shore: a tent, a fire with its smoke, a canoe pulled up, someone at it
//   beach     on the far shore: two or three canoes turned over on a strip of sand
const WCELL = 62;
const WKINDS = ['buoy', 'ducks', 'snag', 'lily', 'islet', 'swimmer', 'moored', 'camp', 'beach'];
function waterThingOf(W, i) {
  return cache(W, ST.FLOCK * 4 + 1, i, () => {
    const r = makeRng(hashInts(W.ws, 211, i));
    if (r() > 0.78) return null;
    const wx = (i + 0.2 + 0.6 * r()) * WCELL, x = xAt(W, wx, { ...XT });
    const u = r();
    const kind = u < 0.12 ? 'buoy' : u < 0.27 ? 'ducks' : u < 0.39 ? 'snag' : u < 0.51 ? 'lily' : u < 0.6 ? 'islet' : u < 0.67 ? 'swimmer' : u < 0.79 ? 'moored' : u < 0.9 ? 'camp' : 'beach';
    if (kind === 'camp' || kind === 'beach') {
      // on the far shore, near enough to read
      const d = x.fd + (kind === 'camp' ? 5 + 3 * r() : 2);
      if (x.fd > 285 || x.fd < 90 || d > 296) return null;
      // (heightAt, not surface(): surface asks campClear, which asks this)
      if (W.H(wx, d) > LV + 6) return null;
      return { kind, wx, d, seed: hashInts(W.ws, 212, i) };
    }
    const lo = Math.max(x.nd + 14, WATER_SEEN + 4), hi = Math.min(x.fd - (kind === 'lily' || kind === 'snag' ? 8 : 20), kind === 'buoy' || kind === 'swimmer' ? 220 : 260);
    if (hi - lo < 8) return null;
    // (lilies and snags keep to the shallows of the far shore and the islands' lee; the rest anywhere)
    const d = kind === 'lily' || kind === 'snag' ? hi - 6 * r() : lo + (hi - lo) * Math.pow(r(), 1.3);
    for (const dx of [-4, 0, 4]) if (!openWater(W, wx + dx, d)) return null;
    return { kind, wx, d, dir: r() < 0.5 ? 1 : -1, seed: hashInts(W.ws, 212, i) };
  });
}
function* waterThings(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, WCELL, 30)) {
    const t = waterThingOf(W, i);
    if (!t || !inD(t.d, dLo, dHi) || !inX(ctx, t.wx, 12)) continue;
    const r = makeRng(t.seed), x = t.wx - ctx.x0, d = t.d, z = -d, K = boatK(d) / 1.25;
    const o = scaleOut(mirrorOut(out, STILL), x, LV, z, K), of = scaleOut(mirrorOut(out, FLASH), x, LV, z, K);
    if (t.kind === 'buoy') {
      const c = r() < 0.6 ? [0.72, 0.12, 0.08] : [0.76, 0.75, 0.72], band = c[0] > 0.7 && c[1] < 0.3 ? [0.76, 0.75, 0.72] : [0.72, 0.12, 0.08];
      for (let k = 0; k < 5; k++) { const cc = k === 2 ? band : c, w = 0.32 * (1 - k * 0.12); o(x, LV + 0.15 + k * 0.28, z, w, 0.16, w, cc[0], cc[1], cc[2], 1, 0, 0, 0, 1, KIND.OTHER); }
    } else if (t.kind === 'ducks') {
      const n = 6 + Math.floor(r() * 7);
      for (let m = 0; m < n; m++) {
        const px = x + (r() - 0.5) * 7, pd = d + (r() - 0.5) * 4, dr = t.dir, male = r() < 0.5;
        const body = male ? [0.44, 0.4, 0.36] : [0.36, 0.27, 0.18];
        of(px, LV + 0.1, -pd, 0.3, 0.1, 0.13, body[0], body[1], body[2], 1, 0, 0, 0, 1, KIND.OTHER);
        const hc = male ? [0.06, 0.24, 0.12] : [0.32, 0.24, 0.16];
        of(px + dr * 0.27, LV + 0.24, -pd, 0.08, 0.07, 0.07, hc[0], hc[1], hc[2], 1, 0, 0, 0, 1, KIND.OTHER);
        of(px - dr * 0.22, LV + 0.15, -pd, 0.08, 0.05, 0.08, 0.12, 0.1, 0.09, 1, 0, 0, 0, 1, KIND.OTHER);
      }
    } else if (t.kind === 'snag') {
      // a dead trunk leaning out of the water, silver-grey, a branch or two, the root plate dark
      const grey = [0.5, 0.48, 0.44], lean = 0.5 + 0.5 * r(), L = 4 + 3 * r(), a = [x, LV - 0.2, z], b = [x + t.dir * L * lean, LV + L * 0.8, z + (r() - 0.5) * 2];
      bar(o, a, b, Math.max(0.14, 0.0012 * d), grey, 5, KIND.OTHER);
      bar(o, [lerp(a[0], b[0], 0.6), lerp(a[1], b[1], 0.6), z], [lerp(a[0], b[0], 0.6) - t.dir * 1.2, lerp(a[1], b[1], 0.6) + 1.4, z], Math.max(0.07, 0.0008 * d), grey, 3, KIND.OTHER);
      for (let k = 0; k < 3; k++) o(x + (r() - 0.5) * 1.4, LV + 0.12, z + (r() - 0.5), 0.5, 0.18, 0.4, 0.16, 0.13, 0.1, 1, 0, 0, 0, 1, KIND.OTHER);
    } else if (t.kind === 'lily') {
      // (pads drawn large: seen from 30 m up at this distance a real one would be under a pixel)
      const n = 26 + Math.floor(r() * 20), R = 6 + 5 * r();
      for (let m = 0; m < n; m++) {
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * R, pr = 0.5 + 0.35 * r();
        const c = jitter(r() < 0.3 ? [0.46, 0.4, 0.12] : [0.12, 0.24, 0.08], r, 0.08);
        o(x + Math.cos(a) * rr, LV + 0.03, -(d + Math.sin(a) * rr * 0.6), pr, 0.03, pr * 0.85, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
        if (r() < 0.12) o(x + Math.cos(a) * rr + 0.2, LV + 0.15, -(d + Math.sin(a) * rr * 0.6), 0.16, 0.1, 0.16, 0.78, 0.77, 0.74, 1, 0, 0, 0, 1, KIND.OTHER);
      }
    } else if (t.kind === 'islet') {
      // a granite hump just breaking the water, and a white pine or two leaning with the west wind
      const R = 3 + 3 * r();
      for (let k = 0; k < 40; k++) {
        const a = r() * Math.PI * 2, rr = Math.sqrt(r()), c = mix3(C.granite, C.graniteDark, 0.2 + 0.5 * r());
        const h = 1.6 * (1 - rr * rr) * (0.7 + 0.5 * r());
        o(x + Math.cos(a) * rr * R, LV + h * 0.6, -(d + Math.sin(a) * rr * R * 0.7), R * 0.24, Math.max(0.3, h * 0.45), R * 0.22, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.ROCK);
      }
      const np = 1 + Math.floor(r() * 2);
      for (let k = 0; k < np; k++) yield* whitePine(ctx, mirrorOut(out, grove(3)), x + (r() - 0.5) * R, d + (r() - 0.5) * R * 0.4, { rng: r, height: 10 + 6 * r(), y: LV + 1, open: true, n: 120 });
    } else if (t.kind === 'swimmer') {
      // a moose (or a deer) swimming: the head and the hump of the back, its V wake
      const moose = r() < 0.6, k = wildK(d) * (moose ? 1 : 0.8), F = beastFrame(mirrorOut(out), x, LV, z, t.dir > 0 ? 0 : Math.PI, k);
      const col = moose ? [0.3, 0.2, 0.13] : [0.44, 0.34, 0.24];
      F.E(0, 0.05, 0, 0.5, 0.14, 0.2, col);
      F.E(0.62, 0.22, 0, moose ? 0.24 : 0.14, moose ? 0.16 : 0.1, 0.12, mul3(col, 0.9), -0.3);
      F.E(0.48, 0.12, 0, 0.12, 0.12, 0.1, col);
      for (const sg of [-1, 1]) F.S([0.6, 0.32, sg * 0.06], [0.55, 0.45, sg * 0.14], 0.04, col);
      wake(out, x - t.dir * 0.5 * k, d, t.dir, 9 * k / 2, 0.7);
    } else if (t.kind === 'moored') {
      // a boat at its mooring, nobody aboard, swung to the breeze
      const c = [[0.46, 0.28, 0.14], [0.6, 0.62, 0.62], [0.66, 0.1, 0.07], [0.2, 0.38, 0.26]][Math.floor(r() * 4)];
      hull(o, x, d, t.dir, 4.4, 1.5, 0.55, c, [0.52, 0.42, 0.3], true, r);
      o(x + t.dir * 3.2, LV + 0.15, z, 0.22, 0.18, 0.22, 0.76, 0.75, 0.72, 1, 0, 0, 0, 1, KIND.OTHER);
    } else if (t.kind === 'camp') {
      // a campsite: a tent, the fire and its smoke, a canoe pulled up, someone sitting at the fire
      const y = W.H(t.wx, d), tc = [[0.78, 0.44, 0.08], [0.2, 0.4, 0.26], [0.72, 0.16, 0.1]][Math.floor(r() * 3)];
      for (let k = 0; k < 7; k++) {
        const f = k / 6, w = 1.4 * (1 - f) + 0.1;
        for (const sg of [-1, 1]) o(x + 3 + sg * w * 0.5, y + 0.15 + f * 1.4, -(d + 1.5), w * 0.35, 0.16, 1.1, tc[0] * (sg > 0 ? 0.75 : 1), tc[1] * (sg > 0 ? 0.75 : 1), tc[2] * (sg > 0 ? 0.75 : 1), 1, 0, 0, 0, 1, KIND.OTHER);
      }
      for (let k = 0; k < 5; k++) o(x + (r() - 0.5) * 0.6, y + 0.12, z + (r() - 0.5) * 0.6, 0.15, 0.1, 0.15, 0.3, 0.26, 0.24, 1, 0, 0, 0, 1, KIND.ROCK);
      o(x, y + 0.3, z, 0.18, 0.22, 0.18, 1, 0.55, 0.16, 1, 0, 0, 0, 1, KIND.LIGHT);
      yield* smoke(withMove(out, MOVE.VAPOUR), [x, y + 0.6, z], d, r, 0.7);
      yield* canoe(o, x - 4, y + 0.05, d - 2, { yaw: 0.25, len: 5.2, col: [0.66, 0.1, 0.07], flip: true }, r);
      person(of, x + 1.2, y, d, r, { pose: 'sit', hat: r() < 0.5 });
    } else {
      // canoes turned over on a strip of sand
      const y = W.H(t.wx, d), cols = [[0.66, 0.1, 0.07], [0.2, 0.36, 0.22], [0.8, 0.62, 0.08], [0.56, 0.56, 0.55]];
      for (let k = 0; k < 6; k++) o(x + (k - 2.5) * 2.2, y + 0.04, -(d + 1.5), 1.6, 0.06, 1.4, C.sand[0], C.sand[1], C.sand[2], 1, 0, 0, 0, 1, KIND.GROUND);
      const n = 2 + Math.floor(r() * 2);
      for (let k = 0; k < n; k++) yield* canoe(o, x + (k - (n - 1) / 2) * 2.4, y + 0.05, d + 1 + 0.6 * k, { yaw: 0.2 * (r() - 0.5), len: 5.2, col: cols[Math.floor(r() * 4)], flip: true }, r);
    }
    note(t.kind, t.wx, d);
    if (out.due()) yield;
  }
}
function* boats(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, BOATCELL, 20)) {
    const b = boatOf(W, i);
    if (!b || !inD(b.d, dLo, dHi) || !inX(ctx, b.wx, 14)) continue;
    const x = b.wx - ctx.x0, d = b.d, dir = b.dir;
    const r = makeRng(b.seed), o = scaleOut(mirrorOut(out), x, LV, -d, boatK(d) / 1.25);
    const z = -d;
    if (b.moving) wake(out, x - dir * 2.5 * boatK(d), d, dir, (b.type === 'kayak' ? 9 : 14) * boatK(d) / 1.4, b.type === 'row' ? 0.8 : 1);
    if (b.type === 'row') {
      // a wooden rowboat: one rowing (facing the stern, the oars out to the sides), one sitting aft
      const col = r() < 0.5 ? [0.46, 0.28, 0.14] : r() < 0.5 ? [0.2, 0.38, 0.26] : [0.7, 0.69, 0.64];
      hull(o, x, d, dir, 4.6, 1.5, 0.55, col, [0.52, 0.4, 0.26], true, r);
      const sw = r() < 0.5 ? 1 : -1;            // the stroke: oars forward or back
      const hx = -dir * 0.1;
      person(o, x + dir * 0.2, LV + 0.25, d, r, { hat: r() < 0.5, arms: [[hx - dir * 0.1 * sw, -0.15, 0.25], [hx - dir * 0.1 * sw, -0.15, -0.25]] });
      for (const sg of [-1, 1]) {
        const a = [x + dir * 0.2 - dir * 0.3 * sw, LV + 0.25 + 0.95 * PK - 0.15 * PK, z + sg * 0.3 * PK];
        paddle(o, a, [x + dir * (0.2 + 0.8 * sw), LV + 0.05, z + sg * 2.4], d, [0.55, 0.42, 0.26]);
      }
      person(o, x - dir * 1.4, LV + 0.25, d, r, { vest: r() < 0.5, hat: r() < 0.6, arms: [[0.15, -0.35, 0.15], [-0.15, -0.35, 0.15]] });
      note('rowboat', b.wx, d);
    } else if (b.type === 'canoe') {
      // a red canoe, two paddling on opposite sides, the blades in the water
      const col = r() < 0.65 ? [0.66, 0.1, 0.07] : r() < 0.5 ? [0.2, 0.36, 0.22] : [0.56, 0.56, 0.55];
      hull(o, x, d, dir, 5.2, 0.9, 0.4, col, [0.58, 0.48, 0.32], false, r);
      for (const [u, sg] of [[1.6, 1], [-1.6, -1]]) {
        const px = x + dir * u;
        person(o, px, LV + 0.15, d, r, { vest: r() < 0.6, hat: r() < 0.4, arms: [[dir * 0.15, 0.25, -sg * 0.1], [dir * 0.25, -0.3, -sg * 0.35]] });
        paddle(o, [px + dir * 0.15 * PK, LV + 0.15 + 1.12 * PK, z + sg * 0.1 * PK], [px - dir * 0.3, LV - 0.1, z - sg * 0.75], d, mul3(col, 0.6));
      }
      note('canoe', b.wx, d);
    } else if (b.type === 'skiff') {
      // an aluminium skiff at anchor, its outboard tilted up, someone fishing with a long rod
      hull(o, x, d, dir, 4.8, 1.6, 0.6, [0.6, 0.62, 0.62], [0.42, 0.44, 0.45], true, r);
      o(x - dir * 2.5, LV + 0.8, z, 0.25, 0.35, 0.2, 0.12, 0.12, 0.13, 1, 0, 0, 0, 1, KIND.OTHER, STILL);
      const stand = r() < 0.4;
      const [px, py, pz] = person(o, x - dir * 0.6, LV + 0.25, d, r, { pose: stand ? 'stand' : 'sit', hat: true, hatC: [0.2, 0.3, 0.18], cloth: [0.62, 0.12, 0.08], arms: [[dir * 0.35, 0.05, 0.1], [dir * 0.3, -0.05, -0.05]] });
      const hand = [px + dir * 0.35 * PK, py + 0.02 * PK, pz];
      const tip = [hand[0] + dir * 4.2, hand[1] + 2.4, pz - 0.4];
      bar(o, hand, tip, limbR(0.025, d), [0.18, 0.16, 0.14], 4, KIND.OTHER, STILL);
      bar(o, tip, [tip[0] + dir * 1.2, LV + 0.02, pz - 0.6], limbR(0.008, d), [0.62, 0.62, 0.6], 4, KIND.OTHER, STILL, 0.6);
      if (r() < 0.6) person(o, x + dir * 1.2, LV + 0.25, d, r, { vest: true, arms: [[0.1, -0.35, 0.2], [-0.1, -0.35, 0.2]] });
      note('skiff', b.wx, d);
    } else if (b.type === 'sail') {
      // a small sailing dinghy: a white hull, a mast, a white or red triangle of sail heeled a little
      // to the breeze, one sitting aft at the tiller
      const hc = r() < 0.6 ? [0.74, 0.73, 0.7] : [0.2, 0.32, 0.5], sc = r() < 0.7 ? [0.78, 0.77, 0.74] : [0.72, 0.16, 0.1];
      hull(o, x, d, dir, 4.3, 1.5, 0.5, hc, [0.6, 0.55, 0.45], true, r);
      const heel = 0.12 * dir, mx = x + dir * 0.6, top = [mx + heel * 6, LV + 6.6, z], foot = [mx, LV + 0.5, z];
      bar(o, foot, top, limbR(0.05, d), [0.7, 0.7, 0.68], 5, KIND.OTHER, STILL);
      bar(o, [mx, LV + 1.1, z], [mx - dir * 2.4, LV + 1.0, z], limbR(0.04, d), [0.6, 0.6, 0.58], 3, KIND.OTHER, STILL);
      // the sail: a triangle from the mast to the boom's end, tiled in rows
      for (let k = 0; k < 9; k++) {
        const t = (k + 0.5) / 9, yy = LV + 1.2 + 5.2 * t, w = 2.3 * (1 - t);
        const cx = mx + heel * (yy - LV) - dir * w * 0.5;
        o(cx, yy, z - 0.05, w * 0.55, 0.35, 0.04, sc[0] * (0.92 + 0.08 * t), sc[1] * (0.92 + 0.08 * t), sc[2] * (0.92 + 0.08 * t), 1, 0, 0, 0, 1, KIND.OTHER, STILL);
      }
      person(o, x - dir * 1.4, LV + 0.25, d, r, { vest: true, hat: r() < 0.5, arms: [[-dir * 0.3, -0.2, 0.1], [0.1, -0.35, 0.1]] });
      note('sail', b.wx, d);
    } else if (b.type === 'pontoon') {
      // a pontoon boat: a flat deck on two pale floats, a rail round it, a canopy, people aboard
      for (const sz of [-1, 1]) for (let u = -2.6; u <= 2.6; u += 0.5) o(x + dir * u, LV + 0.25, z + sz * 0.9, 0.3, 0.22, 0.25, 0.72, 0.72, 0.7, 1, 0, 0, 0, 1, KIND.OTHER, STILL);
      for (let u = -2.8; u <= 2.8; u += 0.55) for (const v of [-0.7, 0, 0.7]) o(x + dir * u, LV + 0.55, z + v, 0.32, 0.06, 0.4, 0.42, 0.36, 0.3, 1, 0, 0, 0, 1, KIND.OTHER, STILL);
      for (const v of [-1, 1]) bar(o, [x - 2.8, LV + 1.4, z + v], [x + 2.8, LV + 1.4, z + v], limbR(0.035, d), [0.7, 0.7, 0.7], 5, KIND.OTHER, STILL);
      const cc = [[0.2, 0.3, 0.5], [0.6, 0.12, 0.08], [0.18, 0.36, 0.22]][Math.floor(r() * 3)];
      for (let u = -1.4; u <= 1.4; u += 0.55) for (const v of [-0.7, 0, 0.7]) o(x + dir * u, LV + 2.7, z + v, 0.32, 0.05, 0.4, cc[0], cc[1], cc[2], 1, 0, 0, 0, 1, KIND.OTHER, STILL);
      for (const u of [-1.2, 0.2, 1.4]) if (r() < 0.8) person(o, x + dir * u, LV + 0.6, d, r, { pose: r() < 0.5 ? 'stand' : 'sit', hat: r() < 0.4 });
      note('pontoon', b.wx, d);
    } else {
      // a kayak: slim and bright, one paddler with a double blade
      const col = [[0.8, 0.62, 0.08], [0.8, 0.3, 0.06], [0.14, 0.4, 0.5]][Math.floor(r() * 3)];
      hull(o, x, d, dir, 4.2, 0.62, 0.3, col, null, false, r);
      const [px, py, pz] = person(o, x, LV + 0.1, d, r, { vest: r() < 0.5, arms: [[0.05, 0.1, 0.3], [-0.05, -0.05, -0.3]] });
      const tilt = r() < 0.5 ? 1 : -1;
      const a = [px, py + 0.1 * PK + tilt * 0.6, pz - 1.3], bb = [px, py + 0.1 * PK - tilt * 0.6, pz + 1.3];
      bar(o, a, bb, limbR(0.035, d), [0.15, 0.15, 0.16], 4, KIND.OTHER, STILL);
      for (const p of [a, bb]) o(p[0], p[1], p[2], 0.1, 0.2, 0.16, col[0] * 0.7, col[1] * 0.7, col[2] * 0.7, 1, 0, 0, 0, 1, KIND.OTHER, STILL);
      note('kayak', b.wx, d);
    }
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Wildlife (after pinewood.js): a moose knee-deep in a bay, feeding; a black bear on the shore;
// white-tailed deer drinking; a beaver lodge with a beaver swimming (its V wake); loons; Canada
// geese on the water; a great blue heron in the shallows. Drawn 1.6 to 2.4 times life size, in the
// open, and where they stand in or on the water, mirrored. Every splat of them is MOVE.FLASH.
// ---------------------------------------------------------------------------------------------
const wildK = (d) => 2 + 0.9 * smooth(60, 220, d);
function beastFrame(out, x, y, z, yaw, k, kind = KIND.OTHER) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), qy = quatYaw(yaw), d = -z;
  const F = {
    k, d, near: cy >= 0 ? 1 : -1,
    P: (u, h, v) => [x + (cy * u + sy * v) * k, y + h * k, z + (-sy * u + cy * v) * k],
    E(u, h, v, ru, rh, rv, c, pitch = 0, tilt = 0) {
      let q = qy;
      if (pitch) q = quatMul(q, quatRoll(pitch));
      if (tilt) q = quatMul(q, quatAxis(1, 0, 0, tilt));
      const p = F.P(u, h, v);
      out(p[0], p[1], p[2], ru * k, rh * k, rv * k, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], kind, FLASH);
    },
    S(a, b, r, c, n = 1) { bar(out, F.P(a[0], a[1], a[2]), F.P(b[0], b[1], b[2]), limbR(r * k, d), c, n, kind, FLASH); },
    sub(u, h, v, turn) { const p = F.P(u, h, v); return beastFrame(out, p[0], p[1], p[2], yaw + turn, k, kind); },
  };
  return F;
}
function legs(F, fu, hu, top, v, rr, st, c, cLow, foot = 0.02) {
  for (const [u, sg, sw] of [[fu, 1, st], [fu, -1, -st], [hu, 1, -st], [hu, -1, st]]) {
    const hind = u < 0, k = sg === F.near ? 1 : 0.7;
    const ku = u + sw * 0.45 + (hind ? -0.1 : 0.035) * top, kh = top * (hind ? 0.54 : 0.5);
    F.S([u, top, sg * v], [ku, kh, sg * v], rr * 1.35, mul3(c, k), 2);
    F.S([ku, kh, sg * v], [u + sw - (hind ? 0.03 : 0) * top, foot, sg * v], rr, mul3(cLow || c, k), 2);
  }
}
const rot2 = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; };
// A white-tailed deer: grey-brown in its autumn coat, white throat and belly, the white flag of the
// tail; a buck with antlers sweeping forward. a.pose 'drink' (head down to the water), 'alert'.
function drawDeer(out, x, y, z, a, r) {
  const k = a.k * (a.buck ? 1.1 : a.fawn ? 0.65 : 1);
  const F = beastFrame(out, x, y, z, a.yaw, k);
  const col = jitter(a.fawn ? [0.5, 0.36, 0.22] : [0.44, 0.34, 0.24], r, 0.08);
  const dark = mul3(col, 0.55), white = [0.76, 0.74, 0.68];
  const down = a.pose === 'drink';
  legs(F, 0.38, -0.4, 0.78, 0.09, 0.03, 0.02, col, dark);
  F.E(0, 0.82, 0, 0.32, 0.06, 0.11, white);
  F.E(0, 0.94, 0, 0.4, 0.16, 0.14, col);
  F.E(0.34, 0.96, 0, 0.19, 0.21, 0.15, col);
  F.E(-0.36, 0.98, 0, 0.2, 0.2, 0.15, col);
  F.E(-0.6, 1.06, 0, 0.05, 0.13, 0.1, white, -0.5);            // the tail, white beneath
  const n0 = [0.46, 1.04], n1 = down ? [0.8, 0.42] : [0.66, 1.5];
  const np = Math.atan2(n1[1] - n0[1], n1[0] - n0[0]), nl = Math.hypot(n1[0] - n0[0], n1[1] - n0[1]);
  F.E((n0[0] + n1[0]) / 2, (n0[1] + n1[1]) / 2, 0, nl * 0.6, 0.1, 0.09, col, np);
  const hp = down ? -1.2 : -0.3;
  const Hd = F.sub(n1[0] + 0.02, n1[1] + (down ? -0.02 : 0.05), 0, down ? 0 : a.look || 0);
  const ax = Math.cos(hp), ay = Math.sin(hp);
  Hd.E(ax * 0.1, ay * 0.1, 0, 0.14, 0.075, 0.07, col, hp);
  Hd.E(ax * 0.24, ay * 0.24 - 0.01, 0, 0.06, 0.045, 0.04, white, hp);
  Hd.E(ax * 0.3, ay * 0.3 - 0.01, 0, 0.03, 0.03, 0.03, [0.06, 0.05, 0.05]);
  for (const sg of [-1, 1]) Hd.S(rot2([-0.02, 0.05, sg * 0.05], hp + 0.3), rot2([-0.06, 0.18, sg * 0.17], hp + 0.3), 0.04, sg === Hd.near ? col : dark);
  if (a.buck) {
    const bone = [0.62, 0.56, 0.44], t = hp + 0.3;
    for (const sg of [-1, 1]) {
      const A = rot2([-0.03, 0.07, sg * 0.05], t), B = rot2([-0.12, 0.3, sg * 0.2], t), Cc = rot2([0.12, 0.42, sg * 0.18], t);
      const c = sg === Hd.near ? bone : mul3(bone, 0.78);
      Hd.S(A, B, 0.02, c, 2); Hd.S(B, Cc, 0.018, c, 2);
      Hd.S(rot2([-0.06, 0.33, sg * 0.19], t), rot2([-0.02, 0.48, sg * 0.18], t), 0.015, c, 1);
      Hd.S(rot2([0.03, 0.38, sg * 0.19], t), rot2([0.06, 0.52, sg * 0.17], t), 0.015, c, 1);
    }
  }
}
// A moose: tall pale legs under a deep dark body, the hump at the shoulder, a long drooping face
// and the bell; the bull's palms. a.pose 'feed' (head to the water) or 'stand'.
function drawMoose(out, x, y, z, a, r) {
  const k = a.k * (a.calf ? 0.6 : a.bull ? 1.06 : 1);
  const F = beastFrame(out, x, y, z, a.yaw, k, a.kind);
  const col = jitter(a.calf ? [0.44, 0.3, 0.18] : [0.33, 0.22, 0.14], r, 0.08), dark = mul3(col, 0.55);
  const sock = a.calf ? mul3(col, 0.8) : [0.5, 0.46, 0.4], lit = mix3(col, [0.56, 0.45, 0.33], 0.55);
  legs(F, 0.52, -0.6, 1.25, 0.14, 0.05, 0.03, mix3(col, sock, 0.3), sock);
  F.E(0, 1.48, 0, 0.5, 0.32, 0.25, col);
  F.E(0.42, 1.58, 0, 0.32, 0.42, 0.27, col);
  F.E(-0.5, 1.46, 0, 0.3, 0.34, 0.26, col);
  F.E(0.4, 1.96, 0, 0.24, 0.1, 0.16, lit);
  F.E(-0.12, 1.78, 0, 0.4, 0.05, 0.13, lit);
  const feed = a.pose === 'feed';
  const n0 = [0.7, 1.7], n1 = feed ? [1.08, 1.12] : [1.1, 1.74];
  const np = Math.atan2(n1[1] - n0[1], n1[0] - n0[0]), nl = Math.hypot(n1[0] - n0[0], n1[1] - n0[1]);
  F.E((n0[0] + n1[0]) / 2, (n0[1] + n1[1]) / 2, 0, nl * 0.62, 0.2, 0.15, col, np);
  const hp = feed ? -1.15 : -0.6, ax = Math.cos(hp), ay = Math.sin(hp);
  const Hd = F.sub(n1[0] + 0.03, n1[1] + 0.03, 0, feed ? 0 : a.look || 0);
  Hd.E(ax * 0.22, ay * 0.22, 0, 0.34, 0.15, 0.12, col, hp);
  Hd.E(ax * 0.54, ay * 0.54, 0, 0.16, 0.14, 0.11, dark, hp);
  if (!a.calf) Hd.E(ax * 0.12 + 0.02, ay * 0.12 - 0.25, 0, 0.045, 0.13, 0.04, dark);
  for (const sg of [-1, 1]) Hd.S(rot2([-0.04, 0.08, sg * 0.07], hp + 0.5), rot2([-0.14, 0.26, sg * 0.2], hp + 0.5), 0.045, sg === Hd.near ? col : dark);
  if (a.bull) {
    const bone = [0.6, 0.53, 0.4], t = hp + 0.6;
    for (const sg of [-1, 1]) {
      const c = sg === Hd.near ? bone : mul3(bone, 0.78);
      const pc = rot2([-0.06, 0.34, sg * 0.46], t);
      Hd.S(rot2([-0.02, 0.1, sg * 0.06], t), rot2([-0.05, 0.24, sg * 0.24], t), 0.04, c, 1);
      Hd.E(pc[0], pc[1], pc[2], 0.3, 0.045, 0.26, c, t, -sg * 0.75);
      for (const u0 of [-0.3, -0.1, 0.1]) Hd.S(rot2([u0, 0.46, sg * 0.62], t), rot2([u0 + 0.03, 0.6, sg * 0.72], t), 0.03, c, 1);
      Hd.S(rot2([0.02, 0.14, sg * 0.14], t), rot2([0.26, 0.24, sg * 0.28], t), 0.03, c, 1);
    }
  }
}
// A black bear: a great black barrel on short legs, the brown muzzle, round ears. a.pose 'walk',
// 'stand' (looking round), 'fish' (head down at the water's edge).
function drawBear(out, x, y, z, a, r) {
  const k = a.k * (a.cub ? 0.5 : 1);
  const F = beastFrame(out, x, y, z, a.yaw, k);
  const col = jitter([0.07, 0.065, 0.065], r, 0.1), lit = [0.17, 0.16, 0.16], tan = [0.46, 0.34, 0.22];
  const head = (Hd, hp) => {
    const ax = Math.cos(hp), ay = Math.sin(hp);
    Hd.E(ax * 0.14, ay * 0.14, 0, 0.19, 0.16, 0.16, col, hp);
    Hd.E(ax * 0.33 + ay * 0.05, ay * 0.33 - ax * 0.05, 0, 0.12, 0.075, 0.07, tan, hp);
    Hd.E(ax * 0.44 + ay * 0.05, ay * 0.44 - ax * 0.05, 0, 0.035, 0.035, 0.035, [0.03, 0.03, 0.03]);
    for (const sg of [-1, 1]) { const e = rot2([0.03, 0.18, sg * 0.13], hp); Hd.E(e[0], e[1], e[2], 0.055, 0.06, 0.04, lit); }
  };
  legs(F, 0.46, -0.48, 0.55, 0.16, 0.09, a.pose === 'walk' ? 0.12 : 0.03, col, col, 0.06);
  F.E(0, 0.82, 0, 0.52, 0.28, 0.25, col);
  F.E(-0.44, 0.86, 0, 0.3, 0.3, 0.26, col);
  F.E(0.36, 0.9, 0, 0.28, 0.27, 0.25, col);
  F.E(-0.1, 1.08, 0, 0.42, 0.06, 0.15, lit);
  head(F.sub(0.74, a.pose === 'fish' ? 0.6 : 0.84, 0, a.pose === 'stand' ? a.look || 0 : 0), a.pose === 'fish' ? -0.8 : a.pose === 'walk' ? -0.3 : -0.1);
}
// A common loon riding low on the water: black head with a green sheen, a dagger bill, the white
// necklace, the back chequered black and white, the white breast at the waterline.
function loon(out, x, d, dir, k, r) {
  const F = beastFrame(out, x, LV, -d, dir > 0 ? 0 : Math.PI, k), blk = [0.05, 0.06, 0.06], wht = [0.76, 0.76, 0.74];
  F.E(0, 0.1, 0, 0.42, 0.12, 0.16, blk);
  F.E(0.06, 0.04, 0, 0.36, 0.06, 0.15, wht);
  for (let i = 0; i < 9; i++) F.E(-0.25 + 0.06 * i, 0.19, (i % 2 ? 1 : -1) * 0.06, 0.025, 0.02, 0.025, wht);
  F.S([0.3, 0.15, 0], [0.38, 0.36, 0], 0.05, blk, 1);
  F.E(0.33, 0.27, 0, 0.055, 0.02, 0.055, wht);
  F.E(0.42, 0.38, 0, 0.1, 0.07, 0.065, [0.04, 0.07, 0.06]);
  F.S([0.5, 0.37, 0], [0.62, 0.35, 0], 0.018, [0.08, 0.08, 0.08], 1);
  void r;
}
// A Canada goose on the water: brown-grey body, pale breast, black neck and head with the white
// chin strap.
function goose(out, x, d, yaw, k, r) {
  const F = beastFrame(out, x, LV, -d, yaw, k), body = jitter([0.38, 0.33, 0.27], r, 0.06), blk = [0.05, 0.05, 0.05];
  F.E(0, 0.14, 0, 0.42, 0.15, 0.18, body);
  F.E(0.16, 0.12, 0, 0.2, 0.1, 0.15, [0.62, 0.58, 0.5]);
  F.E(-0.38, 0.2, 0, 0.1, 0.06, 0.08, [0.1, 0.09, 0.08]);
  const up = r() < 0.7;
  F.S([0.28, 0.2, 0], up ? [0.38, 0.6, 0] : [0.5, 0.12, 0], 0.05, blk, 2);
  const h = up ? [0.42, 0.64] : [0.56, 0.08];
  F.E(h[0], h[1], 0, 0.08, 0.05, 0.05, blk);
  F.E(h[0] - 0.01, h[1] - 0.02, 0, 0.04, 0.035, 0.055, [0.78, 0.77, 0.74]);
  F.S([h[0] + 0.06, h[1], 0], [h[0] + 0.14, h[1] - 0.02, 0], 0.02, blk, 1);
}
// A great blue heron standing in the shallows: grey-blue, long yellow legs, the neck folded in an S,
// a dagger bill, the black stripe over the eye.
function heron(out, x, y, d, yaw, k, r) {
  const F = beastFrame(out, x, y, -d, yaw, k), gb = jitter([0.42, 0.46, 0.52], r, 0.05), pale = [0.7, 0.7, 0.68], leg = [0.5, 0.44, 0.28];
  for (const sg of [-1, 1]) F.S([0, 0.75, sg * 0.06], [0.02 * sg, 0, sg * 0.07], 0.02, sg === F.near ? leg : mul3(leg, 0.7), 3);
  F.E(-0.05, 0.92, 0, 0.3, 0.14, 0.13, gb, 0.35);
  F.E(-0.3, 0.82, 0, 0.16, 0.06, 0.1, mul3(gb, 0.7), 0.5);
  F.S([0.15, 1.0, 0], [0.24, 1.22, 0], 0.045, pale, 2);
  F.S([0.24, 1.22, 0], [0.14, 1.42, 0], 0.04, pale, 2);
  F.S([0.14, 1.42, 0], [0.22, 1.55, 0], 0.038, pale, 1);
  F.E(0.24, 1.58, 0, 0.08, 0.05, 0.05, [0.74, 0.74, 0.72]);
  F.E(0.22, 1.62, 0, 0.07, 0.015, 0.052, [0.06, 0.06, 0.07]);
  F.S([0.3, 1.58, 0], [0.46, 1.55, 0], 0.02, [0.72, 0.56, 0.16], 1);
}
// A beaver lodge: a dome of peeled sticks and mud standing out of the water near the shore, and the
// beaver swimming nearby, only its head and back showing, its V wake spreading behind.
function* lodge(ctx, out, x, d, k, r) {
  const R = 2.2 * k, H = 1.5 * k;
  const n = Math.max(20, Math.round(treeSplats(out, d, H, R * 2) * 0.8));
  const mud = [0.2, 0.15, 0.1], stick = [0.4, 0.33, 0.24];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2, t = Math.sqrt(r());
    const px = x + Math.cos(a) * R * t, pd = d + Math.sin(a) * R * 0.8 * t, py = LV + H * Math.sqrt(Math.max(0, 1 - t * t)) - 0.1;
    if (i % 3 === 0) {
      const b = r() * Math.PI, l = 0.6 + 0.8 * r();
      bar(out, [px - Math.cos(b) * l, py, -(pd - Math.sin(b) * l * 0.5)], [px + Math.cos(b) * l, py + (r() - 0.5) * 0.4, -(pd + Math.sin(b) * l * 0.5)], Math.max(0.05, 0.0006 * d), mul3(stick, 0.8 + 0.4 * r()), 2, KIND.OTHER, STILL);
    } else {
      const c = jitter(mix3(mud, stick, r() * 0.5), r, 0.1), ss = R * 0.22;
      out(px, py, -pd, ss, ss * 0.7, ss, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER, STILL);
    }
    if (out.due()) yield;
  }
}
function beaver(out, x, d, dir, k) {
  const F = beastFrame(out, x, LV, -d, dir > 0 ? 0 : Math.PI, k), brn = [0.26, 0.17, 0.1];
  F.E(0, 0.03, 0, 0.42, 0.09, 0.18, brn);
  F.E(0.4, 0.1, 0, 0.13, 0.1, 0.12, brn);
  F.E(0.5, 0.09, 0, 0.05, 0.04, 0.05, [0.06, 0.05, 0.05]);
  wake(out, x + dir * 0.4 * k, d, dir, 7 * k / 2, 0.6);
}

const WILD = {
  moose: { cell: 2300, p: 0.8 }, bear: { cell: 2900, p: 0.65 }, deer: { cell: 1500, p: 0.7 }, lodge: { cell: 2100, p: 0.6 },
  loons: { cell: 380, p: 0.7 }, geese: { cell: 700, p: 0.6 }, heron: { cell: 900, p: 0.6 },
};
function wildOf(W, kind, i) {
  const ki = Object.keys(WILD).indexOf(kind);
  return cache(W, ST.WILD * 16 + ki, i, () => {
    const Wd = WILD[kind], r = makeRng(hashInts(W.ws, 91 + ki, i));
    if (r() > Wd.p) return null;
    for (let t = 0; t < 10; t++) {
      const wx = (i + 0.15 + 0.7 * r()) * Wd.cell, x = xAt(W, wx, { ...XT });
      const u = r(), v = r();
      if (kind === 'moose') {
        // in the shallows of the near shore, or of the far shore across a narrows
        const far = x.fd < 300 && u < 0.5;
        const d = far ? x.fd - 9 - 6 * v : Math.max(x.nd + 9 + 14 * v, WATER_SEEN + 6 + 45 * r());
        if (d > 295 || !openWater(W, wx, d) || !openWater(W, wx + 5, d) || !openWater(W, wx - 5, d)) continue;
        return { kind, wx, d, n: r() < 0.3 ? 2 : 1, seed: hashInts(W.ws, 99, ki, i) };
      }
      if (kind === 'bear' || kind === 'deer') {
        // on the open shore: the near shore's rock (the line on the shelf or inland), or the far
        // shore across a narrows; drinking at the water's edge
        const far = x.fd < 292 && (u < 0.55 || x.sh < 0.8);
        const d = far ? x.fd + 1.5 : x.be - 4 - 8 * v;
        if (d < 40 || d > 295 || (!far && !(CAMY - (x.yb + 1.5) < 0.34 * d))) continue;     // (seen over the rim and its lip)
        if (!far && x.sh < 0.8) continue;
        // in the open, with nothing standing between it and the line
        if (!far) {
          let open = true;
          for (let dd = 12; open && dd < d; dd += 5) for (const dx of [-6, 0, 6]) { const sf = surface(W, wx + dx, dd); if (sf.t === T.WOODS) { open = false; break; } }
          if (!open) continue;
        }
        return { kind, wx, d, far, n: kind === 'deer' ? 1 + Math.floor(r() * 3) : 1, seed: hashInts(W.ws, 99, ki, i) };
      }
      if (kind === 'lodge') {
        const d = Math.max(x.nd + 6 + 8 * v, WATER_SEEN + 6);
        if (d > 230 || !openWater(W, wx, d)) continue;
        return { kind, wx, d, seed: hashInts(W.ws, 99, ki, i) };
      }
      if (kind === 'heron') {
        // in the shallows, or out on a rock where the near shore is too close
        const d = Math.max(x.nd + 2.5 + 3 * v, WATER_SEEN + 6 + 30 * r());
        if (d > 200 || !openWater(W, wx, d)) continue;
        return { kind, wx, d, rock: d > x.nd + 7, seed: hashInts(W.ws, 99, ki, i) };
      }
      // loons and geese: out on open water
      const lo = Math.max(x.nd + 20, WATER_SEEN + 6), hi = Math.min(x.fd - 30, 260);
      if (hi - lo < 10) continue;
      const d = lo + (hi - lo) * v;
      if (!openWater(W, wx, d) || !openWater(W, wx + 8, d) || !openWater(W, wx - 8, d)) continue;
      return { kind, wx, d, n: kind === 'loons' ? 1 + Math.floor(r() * 2) : 4 + Math.floor(r() * 7), seed: hashInts(W.ws, 99, ki, i) };
    }
    return null;
  });
}
function* wildlife(ctx, out, W, dLo, dHi) {
  for (const kind in WILD) {
    for (const { i } of cellsAround(ctx, WILD[kind].cell, 25)) {
      const g = wildOf(W, kind, i);
      if (!g || !inD(g.d, dLo, dHi) || !inX(ctx, g.wx, 16)) continue;
      const r = makeRng(g.seed), x = g.wx - ctx.x0, d = g.d, k = wildK(d);
      const o = mirrorOut(out);
      if (kind === 'moose') {
        for (let m = 0; m < g.n; m++) {
          const yaw = (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.6;
          drawMoose(o, x + m * 4.5 * k, LV - 0.75 * k, -(d + m * 2), { k: k * (m ? 0.95 : 1), yaw, bull: m === 0 && r() < 0.6, calf: m > 0 && r() < 0.5, pose: r() < 0.65 ? 'feed' : 'stand', look: -0.6 }, r);
          wake(out, x + m * 4.5 * k, d + m * 2, 1, 1.5 * k, 0.5);
        }
      } else if (kind === 'bear') {
        const yaw = (r() < 0.5 ? 0 : Math.PI) + (g.far ? 0.3 : -0.3);
        const y = W.H(g.wx, d);
        drawBear(g.far ? o : out, x, y - 0.05, -d, { k: k * 0.95, yaw, pose: ['walk', 'stand', 'fish'][Math.floor(r() * 3)], look: -0.7 }, r);
        if (r() < 0.35) drawBear(g.far ? o : out, x - Math.cos(yaw) * 2.6 * k, W.H(g.wx - 2.6 * k, d) - 0.05, -(d + 0.6), { k: k * 0.95, yaw, pose: 'walk', cub: true }, r);
      } else if (kind === 'deer') {
        for (let m = 0; m < g.n; m++) {
          const wx = g.wx + m * 2.8 * k, y = W.H(wx, d);
          drawDeer(g.far ? o : out, x + m * 2.8 * k, y - 0.03, -(d + (g.far ? -1 : 1) * 0.6 * m), { k, yaw: g.far ? -Math.PI / 2 + (r() - 0.5) * 0.8 : Math.PI / 2 + (r() - 0.5) * 0.8, buck: m === 0 && r() < 0.4, fawn: m > 0 && r() < 0.4, pose: r() < 0.6 ? 'drink' : 'alert', look: -0.8 }, r);
        }
      } else if (kind === 'lodge') {
        yield* lodge(ctx, o, x, d, 1.4, r);
        const bd = d + 6 + 10 * r(), bx = x + (r() - 0.5) * 20;
        if (openWater(W, bx + ctx.x0, bd)) beaver(o, bx, bd, r() < 0.5 ? 1 : -1, k);
      } else if (kind === 'heron') {
        if (g.rock) yield* boulder(ctx, mirrorOut(out, STILL), g.wx, d, LV - 0.5, 1.1, r);
        heron(o, x, g.rock ? LV + 0.25 : LV - 0.25, d, (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.5, k * 1.05, r);
      } else if (kind === 'loons') {
        for (let m = 0; m < g.n; m++) loon(o, x + m * 3.5 * k, d + m * 1.5, r() < 0.5 ? 1 : -1, k * 1.1, r);
      } else {
        for (let m = 0; m < g.n; m++) goose(o, x + (r() - 0.5) * 9 * k, d + (r() - 0.5) * 6, (r() - 0.5) * 1.2 + (r() < 0.5 ? 0 : Math.PI), k, r);
      }
      note(kind, g.wx, d);
      if (out.due()) yield;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Birds on the wing (MOVE.FLY through kit flightCell / flyBody / flyWing): Canada geese passing
// over in a V, and a bald eagle soaring alone over the water with still wings (after pinewood.js).
// They keep within 120 m of the line, as the flight class needs.
// ---------------------------------------------------------------------------------------------
// One goose in flight, drawn 2.5 times life size, every piece FLIGHT.STEADY (the shader beats the
// wings without a break, a wave running down the skein, and bobs the bird): the long black neck
// stretched forward with the white chin strap, the pale breast, and the wings drawn high in a
// clear stroke over the back (the beat carries each piece down by 1.7 times its height over the
// body, so the tips sweep from well above the back to well below the belly).
const STEADY = FLIGHT.STEADY;
function flyingGoose(out, x, y, z, dir, k) {
  const d = -z, body = [0.4, 0.34, 0.28], blk = [0.05, 0.05, 0.05], r = Math.max(0.0008 * d, 0.06), K = KIND.OTHER;
  flyBody(out, x, y, z, 0.44 * k, 0.13 * k, body, Q_ID, K, STEADY);
  flyBody(out, x + dir * 0.12 * k, y - 0.05 * k, z, 0.26 * k, 0.08 * k, [0.62, 0.58, 0.5], Q_ID, K, STEADY);
  flyBody(out, x + dir * 0.56 * k, y + 0.04 * k, z, 0.3 * k, Math.max(r, 0.05 * k), blk, Q_ID, K, STEADY);
  flyBody(out, x + dir * 0.86 * k, y + 0.06 * k, z, 0.1 * k, 0.065 * k, blk, Q_ID, K, STEADY);
  flyBody(out, x + dir * 0.84 * k, y + 0.03 * k, z, 0.05 * k, 0.03 * k, [0.76, 0.75, 0.72], Q_ID, K, STEADY);
  flyBody(out, x - dir * 0.46 * k, y, z, 0.11 * k, 0.06 * k, [0.08, 0.07, 0.07], Q_ID, K, STEADY);
  for (const sg of [-1, 1]) {
    const c1 = sg > 0 ? body : mul3(body, 0.8);
    flyWing(out, x, y + 0.06 * k, z, x - dir * 0.06 * k, y + 0.4 * k, z + sg * 0.65 * k, Math.max(r, 0.1 * k), c1, 2, y, K, STEADY);
    flyWing(out, x - dir * 0.06 * k, y + 0.4 * k, z + sg * 0.65 * k, x - dir * 0.24 * k, y + 0.62 * k, z + sg * 1.3 * k, Math.max(r, 0.07 * k), mul3(c1, 0.55), 2, y, K, STEADY);
  }
}
// Skeins of geese and pairs. One skein to one flight cell (all of it within 9 m of the cell's
// middle, and within 84 m of the track). Most fly low over the lake, 54 to 80 m out and below the eye, so the water, the far
// shore, an island or the hills move behind them; a few high against the sky; now and then a pair
// skimming the water.
const GEESECELL = 1150;
function skeinOf(W, i) {
  return cache(W, ST.GEESE, i, () => {
    const r = makeRng(hashInts(W.ws, 141, i));
    if (r() > 0.6) return null;
    let fc = flightCell((i + 0.3 + 0.4 * r()) * GEESECELL);
    // (most fly the train's way, so they stay in the window for seconds; a quarter whip past against it)
    if (fc.dir < 0 && r() < 0.7) fc = flightCell(fc.wx + FLY_CELL);
    const kind = r();
    const pair = kind < 0.25, high = kind > 0.82;
    // (a steady flier is carried at about 0.7 of the train's speed, so a skein going the train's way
    // stays in view a long while: all of it must keep within 84 m of the track, the arms included,
    // or its chunk is gone before it has left the window)
    const d = 54 + 16 * r();
    const y = pair ? LV + 3 + 4 * r() : high ? 18 + 14 * r() : -16 + 18 * r();
    const n = pair ? 2 : 7 + Math.floor(r() * 3);
    return { fc, pair, high, d, y, n, seed: hashInts(W.ws, 142, i) };
  });
}
function* skeins(ctx, out, W, dLo, dHi) {
  for (const { i } of cellsAround(ctx, GEESECELL, 60)) {
    const sk = skeinOf(W, i);
    if (!sk) continue;
    const { fc, pair, d, y, n } = sk, k = 2.5, r = makeRng(sk.seed);
    if (!inD(d, dLo, dHi)) continue;
    // the V: the leader ahead, the two arms trailing back from it, one arm out toward the far
    // shore and one in toward the line, so from above and to the side the window sees a chevron
    // pointing the way they fly
    for (let m = 0; m < n; m++) {
      const arm = m === 0 ? 0 : (m % 2 ? 1 : -1), rank = Math.ceil(m / 2);
      const bx = fc.wx + fc.dir * (pair ? 1.5 - 3 * m : 4.5 - rank * 2.2);
      const by = y + (pair ? 0.3 * m : arm * rank * 0.35) + (r() - 0.5) * 0.3;
      const bd = d + (pair ? 1.2 * m : arm * rank * 2.4);
      if (!inX(ctx, bx, 0)) continue;
      flyingGoose(out, bx - ctx.x0, by, -bd, fc.dir, k);
    }
    note('skein', fc.wx, d, { n, y: Math.round(y) });
    if (out.due()) yield;
  }
}
// The bald eagle (pinewood's sea eagle, with a white head and tail on a dark brown bird), facing
// the train, nose up, wings spread across the frame, hanging over the lake at or below the eye so
// the water and the far shore stand behind it. FLIGHT.SOAR: it glides with its wings as drawn, and
// every twelve seconds or so makes two slow, deep beats; each wing piece is given a lift in
// proportion to how far out along the wing it lies (EAGLE.lift metres per metre of half span, none
// for the body and tail), and the shader swings it from a third of that above where it is drawn to
// a little more than all of it below.
const EAGLE = {
  S: 2.6, lift: 0.42,
  wing: [[0.06, 0.2, -0.34, 0], [0.48, 0.24, -0.37, 0.05], [0.88, 0.2, -0.22, 0.1]],
  arm: [[0.17, 0.12, 0.08], [0.14, 0.1, 0.07], [0.1, 0.08, 0.06]], hand: [[0.15, 0.11, 0.08], [0.11, 0.08, 0.06], [0.08, 0.06, 0.05]],
  fingers: [7, 0.32, 0.02, [0.06, 0.05, 0.045]],
  tail: [0.3, 0.07, 0.15, 0.4, [0.78, 0.77, 0.74]],
  body: [0.36, 0.13, [0.15, 0.11, 0.08]], head: [0.46, 0.1, [0.78, 0.77, 0.74]], bill: [0.6, 0.05, [0.8, 0.64, 0.15]],
};
function drawEagle(out, x, y, z, b) {
  const R = EAGLE, S = R.S * (0.92 + 0.18 * smooth(50, 110, -z)), dir = b.dir, d = -z, K = KIND.OTHER, minR = 0.0008 * d;
  const yaw = b.yaw, pitch = b.pitch, bank = b.bank;
  const sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch), sb = Math.sin(bank), cb = Math.cos(bank);
  const F0 = [dir * cy, 0, -sy], A0 = [dir * sy, 0, cy];
  const Fv = [F0[0] * cp, sp, F0[2] * cp], U1 = [-F0[0] * sp, cp, -F0[2] * sp];
  const A = [A0[0] * cb + U1[0] * sb, U1[1] * sb, A0[2] * cb + U1[2] * sb], U = [U1[0] * cb - A0[0] * sb, U1[1] * cb, U1[2] * cb - A0[2] * sb];
  const P = (u, s, w) => [x + (u * Fv[0] + s * A[0] + w * U[0]) * S, y + (u * Fv[1] + s * A[1] + w * U[1]) * S, z + (u * Fv[2] + s * A[2] + w * U[2]) * S];
  const SOAR = FLIGHT.SOAR;
  const piece = (a, e, r, col, n, wing = true) => {
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const pa = P(lerp(a[0], e[0], t0), lerp(a[1], e[1], t0), lerp(a[2], e[2], t0));
      const pb = P(lerp(a[0], e[0], t1), lerp(a[1], e[1], t1), lerp(a[2], e[2], t1));
      // the lift: metres out from the body along the span, at the piece's middle
      const span = Math.abs(lerp(a[1], e[1], (t0 + t1) / 2)) * S;
      const lift = wing ? Math.max(0.02, R.lift * span) : 0.02;
      flyWing(out, pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], Math.max(r, minR), col, 1, (pa[1] + pb[1]) / 2 - lift, K, SOAR);
    }
  };
  const bodyC = (p, sx, sy2, c) => flyBody(out, p[0], p[1], p[2], Math.max(sx, minR), Math.max(sy2, minR), c, Q_ID, K, SOAR);
  for (const sg of [1, -1]) {
    const shd = sg > 0 ? 1 : 0.82, pts = R.wing;
    for (let j = 0; j + 1 < pts.length; j++) {
      const Ap = pts[j], Bp = pts[j + 1], chord = (Ap[1] - Ap[2] + Bp[1] - Bp[2]) / 2, r = chord / 8 * 1.35 * S;
      for (let k = 0; k < 4; k++) {
        const f = (k + 0.5) / 4, ua = lerp(Ap[1], Ap[2], f), ub = lerp(Bp[1], Bp[2], f);
        const col = (j === 0 ? R.arm : R.hand)[Math.min(2, Math.max(0, k - (k > 1 ? 1 : 0)))];
        const n = Math.max(1, Math.ceil(Math.hypot(Bp[0] - Ap[0], ub - ua) * S / (1.6 * r)));
        piece([ua, sg * Ap[0], Ap[3]], [ub, sg * Bp[0], Bp[3]], r, mul3(col, shd), n);
      }
    }
    const Hh = pts[pts.length - 1], [nf, fl, sweep, fc] = R.fingers, mid = (Hh[1] + Hh[2]) / 2, rf = (Hh[1] - Hh[2]) / (2 * nf) * 1.2 * S;
    for (let q = 0; q < nf; q++) {
      const f = (q + 0.5) / nf, ub = lerp(Hh[1], Hh[2], f), len = fl * (1 - 0.45 * Math.pow(Math.abs(2 * f - 1.3) / 1.3, 1.5));
      piece([ub, sg * (Hh[0] - 0.04), Hh[3]], [ub + (ub - mid) * 0.7 - sweep, sg * (Hh[0] + len), Hh[3] + 0.04], rf, mul3(fc, shd), 2);
    }
  }
  const [tl, tw0, tw1, wedge, tc] = R.tail, u0 = -R.body[0] * 0.75, rt = tw1 / 3.2 * S;
  for (const f of [-1, -0.5, 0, 0.5, 1]) piece([u0, f * tw0, 0], [u0 - tl * (1 + wedge * 0.35 * (1 - Math.abs(f))), f * tw1, 0], rt, tc, 2, false);
  const [bl, br, bc] = R.body, [hu, hr, hc] = R.head, [bu, bR, bcol] = R.bill;
  bodyC(P(0, 0, 0), bl * S, br * S, bc);
  bodyC(P(hu * 0.7, 0, 0.02), hr * 1.4 * S, br * 0.9 * S, mix3(bc, hc, 0.6));
  bodyC(P(hu, 0, 0.03), hr * 1.25 * S, hr * S, hc);
  bodyC(P(bu, 0, 0.01), bR * 1.6 * S, bR * S, bcol);
}
const EAGLECELL = 4200;
function eagleOf(W, i) {
  return cache(W, ST.EAGLE, i, () => {
    const r = makeRng(hashInts(W.ws, 151, i));
    if (r() > 0.85) return null;
    for (let t = 0; t < 8; t++) {
      let fc = flightCell((i + 0.32 + 0.36 * r()) * EAGLECELL);
      if (fc.dir < 0) fc = flightCell(fc.wx + FLY_CELL);
      const m = ((fc.wx % 200) + 200) % 200;
      if (m < 16 || m > 184) continue;                     // the whole bird inside one near-band chunk
      const x = xAt(W, fc.wx, { ...XT });
      // out over the water, within the flight class's 120 m, and at or a little below the eye, so
      // the lake and the far shore stand behind it and it is seen whole
      const d = Math.max(x.nd + 20, 70) + 40 * r();
      if (d > 116 || d > x.fd - 25) continue;
      const y = CAMY - 1 - 6 * r();
      return { wx: fc.wx, d, y, dir: fc.dir, yaw: -Math.PI / 2 + (r() - 0.5) * 0.6, pitch: 0.3 + 0.1 * r(), bank: (r() - 0.5) * 0.4 };
    }
    return null;
  });
}
function* eagles(ctx, out, W) {
  for (const { i } of cellsAround(ctx, EAGLECELL, 40)) {
    const b = eagleOf(W, i);
    if (!b) continue;
    const x = b.wx - ctx.x0;
    if (x < -20 || x > ctx.length + 20) continue;
    drawEagle(out, x, b.y, -b.d, b);
    note('eagle', b.wx, b.d, { y: Math.round(b.y) });
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Leaves. Falling: maple leaves drifting down among the nearer trees (MOVE.FALL with a round
// splat: the shader's slow swaying fall through a 16 m column), only where trees stand close, and
// thicker in some stretches (X.leaf). Floating: a scatter of colour on the dark water by the near
// shore, thickest in calm coves; and lily pads, green and yellowing, in the calm shallows.
// ---------------------------------------------------------------------------------------------
const LEAF_COLS = [[0.72, 0.1, 0.05], [0.8, 0.32, 0.04], [0.8, 0.56, 0.07], [0.62, 0.06, 0.06], [0.5, 0.26, 0.08], [0.78, 0.66, 0.14]];
// The floor of the close woods in the first 15 m: fallen leaves you can make out, flat leaf-sized
// splats lying every way on the ground in scarlet, gold and russet over the darker litter (the fill
// under them gives only a wash at this range). STILL: the floor does not answer the beat.
function* leafFloor(ctx, out, W, n) {
  const r = makeRng(hashInts(W.ws, 731, ctx.index)), o = withMove(out, STILL);
  for (let i = 0; i < n; i++) {
    const x = r() * ctx.length, wx = ctx.x0 + x, d = 5.6 + 10 * Math.pow(r(), 1.4);
    const xx = xAt(W, wx, XT);
    if (xx.inl < 0.5) continue;
    const y = W.H(wx, d);
    const L = clamp(0.02 * d, 0.12, 0.3) * (0.7 + 0.6 * r());
    const c = jitter(r() < 0.75 ? LEAF_COLS[Math.floor(r() * LEAF_COLS.length)] : mix3(C.floor, C.bracken, r()), r, 0.08);
    const a = r() * Math.PI, ca = Math.cos(a / 2), sa = Math.sin(a / 2);
    o(x, y + 0.03, -d, L, 0.012, L * 0.6, c[0] * 0.92, c[1] * 0.92, c[2] * 0.92, 1, 0, sa, 0, ca, KIND.GROUND);
    if (out.due()) yield;
  }
}
function* fallingLeaves(ctx, out, W, dLo, dHi, cell, per) {
  for (const { i, wx0 } of cellsAround(ctx, cell, 0)) {
    const x0 = xAt(W, wx0 + cell / 2, XT);
    const amt = 0.15 + 0.85 * x0.leaf;
    const r = worldRng(ctx, 701, i, Math.round(dLo));
    const k = Math.round(per * amt * Math.min(1.5, out.density) + r());
    for (let j = 0; j < k; j++) {
      const wx = wx0 + r() * cell, d = dLo + Math.pow(r(), 1.6) * (dHi - dLo), y = -3.4 + 16 * r(), c = LEAF_COLS[Math.floor(r() * LEAF_COLS.length)];
      // only under and beside the trees that shed them
      const s = surface(W, wx, d + 3);
      if (!isTree(s.t) && !isTree(surface(W, wx, d + 10).t)) continue;
      const lr = Math.max(0.06, 0.0013 * d);
      out(wx - ctx.x0, y, -d, lr, lr, lr, c[0], c[1], c[2], 0.95, 0, 0, 0, 1, KIND.OTHER, MOVE.FALL);
    }
    if (out.due()) yield;
  }
}
function* floating(ctx, out, W, dLo, dHi, cell) {
  for (const { i, wx0 } of cellsAround(ctx, cell, 0)) {
    const x = xAt(W, wx0 + cell / 2, XT);
    const nd = x.nd, calm = 1 - x.wind;
    const lo = Math.max(dLo, nd + 0.5), hi = Math.min(dHi, nd + 28);
    if (hi <= lo) continue;
    const r = worldRng(ctx, 711, i, Math.round(dLo));
    const k = Math.round((10 * (0.3 + 0.7 * x.leaf) * (0.4 + 0.6 * calm)) * Math.min(1.5, out.density) * (hi - lo) / 28);
    for (let j = 0; j < k; j++) {
      const wx = wx0 + r() * cell, d = lo + Math.pow(r(), 1.8) * (hi - lo);
      if (!openWater(W, wx, d)) continue;
      const c = jitter(LEAF_COLS[Math.floor(r() * LEAF_COLS.length)], r, 0.1), lr = Math.max(0.07, 0.0016 * d);
      out(wx - ctx.x0, LV + 0.02, -d, lr * 1.2, 0.01, lr, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    }
    // lily pads in the calm shallows: clusters of flat green discs
    if (calm > 0.55 && r() < 0.5) {
      const cx = wx0 + r() * cell, cd = Math.max(lo, nd + 2 + 8 * r());
      if (cd < hi && openWater(W, cx, cd)) {
        const m = 6 + Math.floor(r() * 10);
        for (let j = 0; j < m; j++) {
          const px = cx + (r() - 0.5) * 5, pd = cd + (r() - 0.5) * 3, pr = 0.28 + 0.15 * r();
          const c = jitter(r() < 0.25 ? [0.42, 0.38, 0.12] : [0.12, 0.22, 0.08], r, 0.1);
          out(px - ctx.x0, LV + 0.02, -pd, pr, 0.015, pr * 0.9, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
        }
      }
    }
    if (out.due()) yield;
  }
}
// Mist lying on the water in the early morning, in stretches: big faint pale splats that billow
// (MOVE.VAPOUR), thicker toward the far shore; a little in the evening too.
function* mist(ctx, out, W, dLo, dHi, cell, size) {
  const h = hourOf(ctx), morning = smooth(10.5, 8, h) * smooth(5, 6, h), evening = 0.35 * smooth(18, 19.5, h);
  const amt0 = Math.max(morning, evening);
  if (amt0 <= 0.02) return;
  const g0 = Math.floor((ctx.x0 - size) / cell), g1 = Math.floor((ctx.x0 + ctx.length + size) / cell);
  for (let gk = Math.floor(dLo / cell); gk * cell < dHi; gk++) {
    for (let gx = g0; gx <= g1; gx++) {
      const r = worldRng(ctx, 721, gx, gk, cell);
      const wx = (gx + r()) * cell, d = (gk + r()) * cell;
      if (d < dLo || d >= dHi) continue;
      const amt = amt0 * smooth(0.3, 0.6, noise1(wx / 2200, W.ws + 722)) * (0.4 + 0.6 * noise2(wx / 700, d / 500, W.ws + 723));
      if (amt < 0.22 || !openWater(W, wx, d)) continue;
      const sx = size * (0.8 + 0.8 * r()), sy = size * (0.06 + 0.04 * r());
      const c = jitter(C.mist, r, 0.03);
      out(wx - ctx.x0, LV + sy * 1.2, -d, sx, sy, sx * 0.5, c[0], c[1], c[2], (0.05 + 0.08 * r()) * Math.min(1, amt * 1.5), 0, 0, 0, 1, KIND.OTHER, MOVE.VAPOUR);
      if (out.due()) yield;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Landmarks along the line: a flag-stop station (a small wooden station painted in the railway's
// red with cream trim, a gravel platform, a name board, a bench and someone waiting); a general
// store with a gas pump where a gravel road crosses the line; a fire tower on a far hill.
// ---------------------------------------------------------------------------------------------
const STACELL = 6100, STORECELL = 6700, TOWERCELL = 5300;
function stationOf(W, i) {
  return cache(W, ST.STATION, i, () => {
    const r = makeRng(hashInts(W.ws, 161, i));
    if (r() > 0.7) return null;
    for (let t = 0; t < 6; t++) {
      const wx = (i + 0.2 + 0.6 * r()) * STACELL;
      let ok = true;
      for (let u = -40; u <= 40; u += 10) { const x = xAt(W, wx + u, { ...XT }); if (x.inl < 0.85 || x.edge < 30) ok = false; }
      if (ok) return { wx, seed: hashInts(W.ws, 162, i) };
    }
    return null;
  });
}
function storeOf(W, i) {
  return cache(W, ST.STORE, i, () => {
    const r = makeRng(hashInts(W.ws, 171, i));
    if (r() > 0.6) return null;
    for (let t = 0; t < 6; t++) {
      const wx = (i + 0.2 + 0.6 * r()) * STORECELL;
      let ok = true;
      for (let u = -30; u <= 40; u += 10) { const x = xAt(W, wx + u, { ...XT }); if (x.inl < 0.7 || x.edge < 42) ok = false; }
      if (ok) return { wx, seed: hashInts(W.ws, 172, i), paint: r() < 0.5 };
    }
    return null;
  });
}
// The clearings the landmarks stand in (no woods there).
function landmarkClear(W, wx, d) {
  const si = stationOf(W, Math.floor(wx / STACELL));
  if (si && Math.abs(wx - si.wx) < 22 && d < 22) return true;
  const so = storeOf(W, Math.floor(wx / STORECELL));
  if (so && wx > so.wx - 8 && wx < so.wx + 34 && d < 40) return true;
  return false;
}
function* station(ctx, out, W, s, night) {
  const r = makeRng(s.seed), x = s.wx - ctx.x0, d = 11.5;
  if (x < -40 || x > ctx.length + 40) return;
  // the platform: low gravel with a timber edge, 70 m long
  for (let u = -35; u < 35; u += 0.7) for (let dd = 3.3; dd < 6.2; dd += 0.7) {
    const c = jitter(dd < 3.6 ? [0.5, 0.42, 0.3] : [0.46, 0.43, 0.38], r, 0.1);
    out(x + u, 0.12, -dd, 0.45, 0.06, 0.45, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
  }
  const base = Math.min(W.H(s.wx - 5, d), W.H(s.wx + 5, d)) - 0.2;
  yield* cabin(ctx, out, x, d, base, { w: 10, dep: 5.2, h: 3.6, yaw: 0, log: false, wall: [0.45, 0.15, 0.09], trim: [0.74, 0.68, 0.52], roof: [0.22, 0.22, 0.24], porch: false, chimney: true, chimneySide: 1, smoke: night || r() < 0.5, smokeK: 0.8, lit: night, rng: r });
  // the name board on posts at the platform's end, white with a dark border
  for (const sx of [-1.5, 1.5]) strut(out, x - 20 + sx, 0.1, -6.8, x - 20 + sx, 2.6, -6.8, 0.06, [0.25, 0.22, 0.2], 3, 1, KIND.MAST);
  yield* panel(out, [x - 22, 2.2, -6.75], [1, 0, 0], [0, 1, 0], 4, 0.8, 0.12, (a, b) => (a < 0.04 || a > 0.96 || b < 0.1 || b > 0.9 ? [0.12, 0.12, 0.13] : (Math.abs(b - 0.5) < 0.16 && ((a * 9) % 1) < 0.6 && a > 0.12 && a < 0.88) ? [0.14, 0.14, 0.15] : [0.76, 0.75, 0.72]), KIND.MAST, r);
  // a bench and someone waiting, a bag at their feet
  bar(out, [x - 6.5, 0.6, -6.6], [x - 4.5, 0.6, -6.6], 0.08, [0.4, 0.3, 0.2], 3);
  person(out, x - 3.2, 0.12, 6.6, r, { pose: 'stand', hat: r() < 0.5, k: 1 / 1.3 * 1.15, arms: [[-0.2, -0.45, 0], [0.22, -0.5, 0]] });
  out(x - 2.7, 0.35, -6.5, 0.3, 0.22, 0.15, 0.3, 0.2, 0.12, 1, 0, 0, 0, 1, KIND.OTHER, STILL);
  if (night) for (const u of [-25, 0, 25]) {
    strut(out, x + u, 0, -6.2, x + u, 4.2, -6.2, 0.06, [0.2, 0.2, 0.2], 3, 1, KIND.MAST);
    yield* lamp(ctx, out, x + u, 4.3, 6.1, [1, 0.84, 0.56], { size: 0.13 });
  }
  note('station', s.wx, d);
}
function* store(ctx, out, W, s, night) {
  const r = makeRng(s.seed), x = s.wx - ctx.x0;
  if (x < -40 || x > ctx.length + 60) return;
  // the road on from the trackside's part of it (storeRoad), toward the store
  for (let dd = 31; dd < 42; dd += 0.8) for (let u = -3; u <= 3; u += 0.8) {
    const c = jitter([0.52, 0.47, 0.38], r, 0.1);
    out(x + u + (r() - 0.5) * 0.3, W.H(s.wx + u, dd) + 0.05, -dd, 0.55, 0.05, 0.55, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
  }
  // the store: a false front over a porch, a sign, big windows; the gas pump in front
  const sx = s.wx + 16, sd = 27, base = Math.min(W.H(sx - 6, sd), W.H(sx + 6, sd)) - 0.2;
  const wall = s.paint ? [0.74, 0.73, 0.68] : [0.5, 0.14, 0.09], trim = s.paint ? [0.45, 0.14, 0.09] : [0.74, 0.73, 0.68];
  const n0 = out.n;
  yield* cabin(ctx, out, sx - ctx.x0, sd, base, { w: 12, dep: 9, h: 4.4, yaw: 0, log: false, wall, trim, roof: [0.3, 0.3, 0.31], porch: true, chimney: true, chimneySide: -1, smoke: night, lit: night, rng: r });
  if (out.n === n0) return;            // (no room for it at this budget: none of it)
  const sg = s.paint ? [0.5, 0.12, 0.08] : [0.74, 0.73, 0.68];
  yield* panel(out, [sx - ctx.x0 - 6.1, base + 4.2, -(sd - 4.65)], [1, 0, 0], [0, 1, 0], 12.2, 2.6, 0.18, (a, b) => (b > 0.25 && b < 0.75 && a > 0.08 && a < 0.92 ? ((a * 14) % 1 < 0.55 && Math.abs(b - 0.5) < 0.14 ? [0.1, 0.1, 0.1] : sg) : wall), KIND.BUILDING, r);
  const px = sx - ctx.x0 - 3, pd = sd - 9;
  const py = W.H(sx - 3, pd);
  for (let k = 0; k < 6; k++) out(px, py + 0.2 + k * 0.32, -pd, 0.34, 0.2, 0.26, 0.66, 0.1, 0.07, 1, 0, 0, 0, 1, KIND.OTHER, STILL);
  out(px, py + 2.25, -pd, 0.26, 0.26, 0.26, 0.78, 0.77, 0.74, 1, 0, 0, 0, 1, KIND.OTHER, STILL);
  if (night) yield* lamp(ctx, out, px, py + 2.25, pd - 0.1, [1, 0.95, 0.85], { size: 0.2, chase: false });
  // a pickup parked by the store
  const tx = sx - ctx.x0 + 9, td = sd - 8, ty = W.H(sx + 9, td), tc = [[0.2, 0.3, 0.5], [0.5, 0.12, 0.08], [0.6, 0.6, 0.58]][Math.floor(r() * 3)];
  for (let u = -2.4; u <= 2.4; u += 0.4) {
    const cab = u > -0.2 && u < 1.2;
    out(tx + u, ty + 0.75, -td, 0.3, 0.35, 0.95, tc[0], tc[1], tc[2], 1, 0, 0, 0, 1, KIND.OTHER, STILL);
    if (cab) out(tx + u, ty + 1.5, -td, 0.3, 0.38, 0.85, u > 0.8 ? 0.1 : tc[0] * 0.9, u > 0.8 ? 0.12 : tc[1] * 0.9, u > 0.8 ? 0.14 : tc[2] * 0.9, 1, 0, 0, 0, 1, KIND.OTHER, STILL);
  }
  for (const u of [-1.6, 1.6]) out(tx + u, ty + 0.38, -(td - 0.95), 0.38, 0.38, 0.15, 0.08, 0.08, 0.08, 1, 0, 0, 0, 1, KIND.OTHER, STILL);
  note('store', sx, sd);
}
function towerOf(W, i) {
  return cache(W, ST.TOWER, i, () => {
    const r = makeRng(hashInts(W.ws, 181, i));
    if (r() > 0.8) return null;
    let best = null;
    for (let t = 0; t < 8; t++) {
      const wx = (i + 0.15 + 0.7 * r()) * TOWERCELL, x = xAt(W, wx, { ...XT });
      const d = x.fd + 250 + 900 * r();
      if (d > 2800) continue;
      const h = heightAt(W, wx, d);
      if (!best || h > best.h) best = { wx, d, h };
    }
    return best && best.h > LV + 25 ? best : null;
  });
}
// The fire tower: four steel legs braced in panels, stairs, the glazed cab with its pyramid roof;
// drawn 2.2 times life size, its cab roof red, so it reads from a kilometre or two.
function* fireTower(ctx, out, t) {
  const x = t.wx - ctx.x0, d = t.d, y0 = t.h - 0.5, K = 2.2, H = 24 * K, B = 3 * K, top = 1.4 * K;
  const r = Math.max(0.08, 0.0007 * d), steel = [0.5, 0.5, 0.5];
  const half = (y) => lerp(B, top, y / H);
  const P = (sx, sz, y) => [x + sx * half(y), y0 + y, -(d + sz * half(y))];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) strut(out, ...P(sx, sz, 0), ...P(sx, sz, H), r, steel, 8, 1, KIND.BUILDING);
  for (let k = 0; k < 6; k++) {
    const ya = H * k / 6, yb = H * (k + 1) / 6;
    strut(out, ...P(-1, -1, ya), ...P(1, -1, yb), r * 0.7, steel, 3, 1, KIND.BUILDING);
    strut(out, ...P(1, -1, ya), ...P(-1, -1, yb), r * 0.7, steel, 3, 1, KIND.BUILDING);
    strut(out, ...P(-1, -1, yb), ...P(1, -1, yb), r * 0.7, steel, 2, 1, KIND.BUILDING);
  }
  // the cab: a box of windows on the top, a pyramid roof
  const cw = 2.2 * K, cy = y0 + H;
  for (let a = -1; a <= 1; a += 0.25) for (let b = 0; b <= 1; b += 0.34) {
    const c = b > 0.2 && b < 0.85 && Math.abs(a) < 0.9 ? [0.14, 0.16, 0.2] : [0.6, 0.6, 0.58];
    out(x + a * cw, cy + b * 2.4 * K, -(d - cw), 0.3 * K, 0.42 * K, 0.1, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.BUILDING);
    out(x - cw, cy + b * 2.4 * K, -(d + a * cw), 0.1, 0.42 * K, 0.3 * K, c[0] * 1.1, c[1] * 1.1, c[2] * 1.1, 1, 0, 0, 0, 1, KIND.BUILDING);
    out(x + cw, cy + b * 2.4 * K, -(d + a * cw), 0.1, 0.42 * K, 0.3 * K, c[0] * 0.7, c[1] * 0.7, c[2] * 0.7, 1, 0, 0, 0, 1, KIND.BUILDING);
  }
  for (let k = 0; k < 5; k++) { const f = k / 5, w = cw * 1.2 * (1 - f); out(x, cy + 2.5 * K + f * 1.6 * K, -d, w, 0.35 * K, w, 0.55, 0.12, 0.08, 1, 0, 0, 0, 1, KIND.BUILDING); }
  note('fireTower', t.wx, d);
  if (out.due()) yield;
}
function* landmarks(ctx, out, W, band, night) {
  if (band === 'trackside' || band === 'near') {
    for (const { i } of cellsAround(ctx, STACELL, 60)) { const s = stationOf(W, i); if (s && band === 'trackside') yield* station(ctx, out, W, s, night); }
    for (const { i } of cellsAround(ctx, STORECELL, 70)) {
      const s = storeOf(W, i);
      if (!s) continue;
      // (the store stands 27 m out: the near band draws it, the trackside the road and crossbuck)
      if (band === 'trackside') yield* storeRoad(ctx, out, W, s);
      else yield* store(ctx, out, W, s, night);
    }
  }
  if (band === 'mid') for (const { i } of cellsAround(ctx, TOWERCELL, 20)) { const t = towerOf(W, i); if (t && inX(ctx, t.wx, 10) && inD(t.d, ctx.zNear, ctx.zFar)) yield* fireTower(ctx, mirrorOut(out), t); }
}
function* storeRoad(ctx, out, W, s) {
  const r = makeRng(hashInts(s.seed, 3)), x = s.wx - ctx.x0;
  if (x < -10 || x > ctx.length + 10) return;
  for (let dd = 2.5; dd < 31; dd += 0.8) for (let u = -3; u <= 3; u += 0.8) {
    const c = jitter([0.52, 0.47, 0.38], r, 0.1);
    out(x + u + (r() - 0.5) * 0.3, W.H(s.wx + u, dd) + 0.05, -dd, 0.55, 0.05, 0.55, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
  }
  strut(out, x - 4.2, -0.2, -5.4, x - 4.2, 3.4, -5.4, 0.07, [0.7, 0.7, 0.68], 4, 1, KIND.MAST);
  for (const a of [0.6, -0.6]) {
    const ca = Math.cos(a), sa = Math.sin(a);
    strut(out, x - 4.2 - ca * 0.75, 2.9 - sa * 0.75, -5.35, x - 4.2 + ca * 0.75, 2.9 + sa * 0.75, -5.35, 0.1, [0.76, 0.75, 0.72], 4, 1, KIND.MAST);
  }
}

// ---------------------------------------------------------------------------------------------
// The dreamlike level (all of it gated on ctx.dials, so level 0 shows none of it):
//   logic     in some stretches the lake reflects another season: under the scarlet and gold
//             hangs a summer's green, or a winter's white (dreamSeason)
//   topology  a granite island with its pines hanging in the air, its reflection still lying on
//             the water below as if it rested there (floatingIsles; MOVE.SOLID, so it is not
//             scattered against the sky)
//   scale     a moose of impossible size wading by the far shore, mirrored (giantMoose)
// ---------------------------------------------------------------------------------------------
function dreamSeason(ctx, out, W) {
  const lg = (ctx.dials && ctx.dials.logic) || 0;
  if (lg <= 0) return;
  const k = Math.min(1, lg * 3);
  out.season = (x, r, g, b) => {
    const wx = ctx.x0 + x, n = noise1(wx / 2300, W.ws + 801);
    const a = k * (smooth(0.62, 0.72, n) + smooth(0.38, 0.28, n));
    if (a <= 0 || !(r > 0.15 && r > b * 1.6 && g < r * 1.05)) return [r, g, b];
    // a crown's warm colour turned to the season's: summer green, or snow
    const to = n > 0.5 ? [r * 0.25 + 0.04, Math.max(r, g) * 0.55 + 0.04, b * 0.5 + 0.03] : mix3([0.72, 0.74, 0.76], [r, g, b], 0.15);
    return mix3([r, g, b], to, a);
  };
}
// A recording out: keeps every splat so a thing can be drawn twice, shifted and mirrored.
function recorder(out) {
  const rec = [];
  const m = (...a) => { rec.push(a); return true; };
  wrapLike(m, out);
  m.rec = rec;
  return m;
}
function* floatingIsles(ctx, out, W, dLo, dHi, amount) {
  const cell = 1700;
  for (const { i } of cellsAround(ctx, cell, 90)) {
    const r = makeRng(hashInts(W.ws, 811, i));
    if (r() > 0.75 * amount) continue;
    const wx = (i + 0.2 + 0.6 * r()) * cell, x = xAt(W, wx, { ...XT });
    const d = clamp(x.nd + 70 + 200 * r(), 90, Math.min(x.fd - 60, 420));
    if (!inD(d, dLo, dHi) || !openWater(W, wx, d) || !inX(ctx, wx, 60)) continue;
    const R = 11 + 8 * r(), Y = 18 + 26 * amount * r();
    // the island at rest (its top 3 m above the water), recorded once
    const rec = recorder(out);
    const rr = makeRng(hashInts(W.ws, 812, i));
    const xl = wx - ctx.x0;
    yield* floatingIsland(ctx, rec, xl, LV + 2.6, d, R, { rng: rr, n: Math.round(1100 * Math.sqrt(out.density)), trees: 0, top: [0.34, 0.36, 0.26], earth: C.graniteDark, chalk: C.granite });
    const np = 2 + Math.floor(rr() * 3);
    for (let k = 0; k < np; k++) yield* whitePine(ctx, rec, xl + (rr() - 0.5) * R, d + (rr() - 0.5) * R * 0.5, { rng: rr, height: 15 + 7 * rr(), y: LV + 2.6, open: true, n: Math.round(220 * Math.sqrt(out.density)) });
    note('floatingIsle', wx, d, { Y: Math.round(Y) });
    // drawn up in the air, and mirrored where it would lie
    for (const a of rec.rec) {
      const [px, py, pz, sx, sy, sz, cr, cg, cb, o = 1, qx = 0, qy = 0, qz = 0, qw = 1] = a;
      out(px, py + Y, pz, sx, sy, sz, cr, cg, cb, o, qx, qy, qz, qw, KIND.SURREAL, MOVE.SOLID);
      emitMirror(out, px, py, pz, sx, sy, sz, cr, cg, cb, o, qx, qy, qz, qw, KIND.SURREAL);
      if (out.due()) yield;
    }
  }
}
function* giantMoose(ctx, out, W, dLo, dHi, amount) {
  const cell = 3100;
  for (const { i } of cellsAround(ctx, cell, 300)) {
    const r = makeRng(hashInts(W.ws, 821, i));
    if (r() > 0.95 * amount) continue;
    let wx = 0, d = 0, ok = false;
    for (let t = 0; t < 8 && !ok; t++) {
      wx = (i + 0.15 + 0.7 * r()) * cell;
      const x = xAt(W, wx, { ...XT });
      d = clamp(x.fd - 60, 360, 1700);
      ok = x.fd > 420 && x.inl < 0.25 && openWater(W, wx, d) && openWater(W, wx - 40, d) && openWater(W, wx + 40, d);
    }
    if (!ok || !inD(d, dLo, dHi)) continue;
    const k = (24 + 12 * r()) * amount;
    drawMoose(mirrorOut(out), wx - ctx.x0, LV - 0.7 * k, -d, { k, yaw: (r() < 0.5 ? 0 : Math.PI) + 0.3, bull: true, pose: r() < 0.5 ? 'feed' : 'stand', look: -0.5, kind: KIND.SURREAL }, r);
    note('giantMoose', wx, d, { k: Math.round(k) });
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Railway furniture: telegraph poles along the line, with their crossarms and wires
// ---------------------------------------------------------------------------------------------
function poleD(W, wx) { const x = xAt(W, wx, XT); void x; return 4.8; }
function* telegraph(ctx, out, W) {
  const sp = ctx.beatMetres || 56;
  const pc = [0.3, 0.25, 0.2], ac = [0.26, 0.21, 0.17], ins = [0.2, 0.32, 0.3];
  const first = Math.floor(ctx.x0 / sp) - 1, last = Math.ceil((ctx.x0 + ctx.length) / sp) + 1;
  const tops = [];
  for (let k = first; k <= last; k++) {
    const wx = k * sp, d = poleD(W, wx), x = wx - ctx.x0, y0 = W.H(wx, d) - 0.3;
    const H = 8.2 + 0.5 * (worldRng(ctx, 111, k)() - 0.5);
    tops.push([x, y0 + H, d]);
    if (x < -2 || x > ctx.length + 2) continue;
    strut(out, x, y0, -d, x, y0 + H, -d, 0.12, pc, 6, 1, KIND.MAST);
    for (const ay of [H - 0.45, H - 1.25]) {
      strut(out, x, y0 + ay, -(d - 1), x, y0 + ay, -(d + 1), 0.06, ac, 3, 1, KIND.MAST);
      for (const dz of [-0.85, -0.3, 0.3, 0.85]) out(x, y0 + ay + 0.12, -(d + dz), 0.045, 0.07, 0.045, ins[0], ins[1], ins[2], 1, 0, 0, 0, 1, KIND.MAST);
    }
  }
  // wires: sagging between the poles, on the crossarms' insulators
  for (let k = 0; k + 1 < tops.length; k++) {
    const a = tops[k], b = tops[k + 1];
    for (const [dy, dz] of [[-0.33, -0.85], [-0.33, 0.85], [-1.13, -0.3], [-1.13, 0.3]]) {
      const steps = 14;
      let pa = [a[0], a[1] + dy, -(a[2] + dz)];
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const pb = [lerp(a[0], b[0], t), lerp(a[1], b[1], t) + dy - 0.55 * 4 * t * (1 - t), -(lerp(a[2], b[2], t) + dz)];
        const mxp = (pa[0] + pb[0]) / 2;
        if (mxp >= 0 && mxp < ctx.length) strut(out, pa[0], pa[1], pa[2], pb[0], pb[1], pb[2], 0.011, [0.16, 0.15, 0.14], 1, 1, KIND.WIRE);
        pa = pb;
      }
    }
    if (out.due()) yield;
  }
}

// The edge of the cess, where the land falls away: on the viaduct a stone parapet with its coping
// (1 m high, granite blocks in courses); at the cliff's and the shelf's rim a granite lip and a
// post-and-wire fence; at the slope's top a timber guard rail on posts; in the woods nothing. All
// of it under 1.6 m, at about 5.6 m from the track, and still on the beat.
function* trackEdge(ctx, out, W) {
  const rng = makeRng(hashInts(W.ws, 131, ctx.index));
  const o = withMove(out, STILL);
  const de = 5.65, blk = 0.45;
  for (let u = blk / 2; u < ctx.length; u += blk) {
    const wx = ctx.x0 + u, x = xAt(W, wx, XT);
    const y0 = -0.12 * (de - 2.4) - 0.05;
    if (x.cw > 0.5) {
      // the parapet: three courses of blocks, offset, and a paler coping slab on top
      for (let k = 0; k < 3; k++) {
        const c = jitter(mul3(C.granite, 0.78 + 0.12 * k + 0.12 * rng()), rng, 0.05);
        const off = (k % 2) * blk * 0.5;
        o(u + off - blk / 4, y0 + 0.16 + k * 0.28, -de, blk * 0.46, 0.13, 0.24, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.ROCK);
      }
      const cc = jitter(mix3(C.granite, [0.7, 0.68, 0.64], 0.5), rng, 0.04);
      o(u, y0 + 0.98, -de, blk * 0.55, 0.07, 0.32, cc[0], cc[1], cc[2], 1, 0, 0, 0, 1, KIND.ROCK);
    } else if (x.cl > 0.5 || x.sh > 0.5) {
      // the lip: low granite slabs along the rim
      if (rng() < 0.6) {
        const c = jitter(mix3(C.granite, C.graniteDark, rng() * 0.5), rng, 0.06);
        o(u, y0 + 0.08, -(de + 0.4), blk * 0.7, 0.14, 0.35, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.ROCK);
      }
    }
    if (out.due()) yield;
  }
  // posts every 2.5 m of world x (fence and guard rail), and their wires or rails
  const sp = 2.5;
  for (let i = Math.floor(ctx.x0 / sp); i * sp < ctx.x0 + ctx.length; i++) {
    const wx = i * sp, u = wx - ctx.x0;
    if (u < 0) continue;
    const x = xAt(W, wx, XT), y0 = -0.12 * (de - 2.4) - 0.05;
    const fenced = x.cl > 0.5 || x.sh > 0.5, railed = x.sl > 0.5 && !fenced;
    if (!fenced && !railed) continue;
    const pc = railed ? [0.36, 0.28, 0.2] : [0.3, 0.27, 0.24];
    bar(o, [u, y0, -de], [u, y0 + 1.1, -de], railed ? 0.07 : 0.045, pc, 3, KIND.FENCE);
    const next = xAt(W, wx + sp, XT);
    if (!(next.cl > 0.5 || next.sh > 0.5 || next.sl > 0.5)) continue;
    for (const fy of railed ? [0.55, 1.0] : [0.45, 0.8, 1.05]) bar(o, [u, y0 + fy, -de], [u + sp, y0 + fy, -de], railed ? 0.055 : 0.01, railed ? [0.42, 0.34, 0.24] : [0.34, 0.34, 0.32], railed ? 3 : 4, KIND.FENCE);
    if (out.due()) yield;
  }
}
// Simple dense ground strip for the trackside (ballast, cess).
function* fillStrip(ctx, out, W, n, dn, df, color, lift = 0, round = 0.12) {
  const rng = ctx.rng;
  const area = ctx.length * (df - dn);
  const r = Math.sqrt((4 * area) / (Math.PI * Math.max(1, n)));
  for (let i = 0; i < n; i++) {
    const x = rng() * ctx.length, d = dn + rng() * (df - dn);
    const c = color(ctx.x0 + x, d, rng);
    const y = W.H(ctx.x0 + x, d);
    out(x, y + lift * rng() + 0.02, -d, r * (0.8 + 0.5 * rng()), r * round, r * 0.6, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------------------------
function* trackside(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 1 });
  dreamSeason(ctx, out, W);
  // (in the close woods the trees that fill the frame take most of the band: the ground under them
  // is mostly hidden by them and by the understory)
  out.limit = ctx.count * (xAt(W, ctx.x0 + ctx.length / 2, XT).inl > 0.5 ? 0.7 : 0.5);
  yield* telegraph(ctx, out, W);
  yield* trackEdge(ctx, out, W);
  const night = lightsOn(ctx);
  yield* cottages(ctx, out, W, 0, 24, night);
  yield* landmarks(ctx, out, W, 'trackside', night);
  yield* fallingLeaves(ctx, out, W, 6.2, ctx.zFar + 2, 3, 7);
  yield* floating(ctx, out, W, 5, ctx.zFar, 6);
  yield* groundDetail(ctx, out, W, 6.5, ctx.zFar, 4, 3);
  const plan = [];
  woodsPlan(ctx, out, W, plan, 8.5, ctx.zFar, 5, 0.42);
  forestPlan(ctx, out, W, plan, 8.5, ctx.zFar, 4.2);
  yield* drawPlan(ctx, out, plan, Math.max(0, out.limit - out.n));
  out.limit = Infinity;
  yield* understory(ctx, out, W, 6.5, ctx.zFar, 0.4 * out.left());
  if (xAt(W, ctx.x0 + ctx.length / 2, XT).inl > 0.2) yield* leafFloor(ctx, out, W, Math.round(0.55 * out.left()));
  const rest = out.left();
  yield* fillStrip(ctx, out, W, Math.round(rest * 0.06), 2.5, 3.6, (wx, d, rng) => jitter(C.ballast, rng, 0.25), 0, 0.15);
  yield* fillLake(ctx, out, W, { dNear: 3.6, power: 1.2, cover: 4, mirror: 0.8 });
}

function* near(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.1 });
  const dz = ctx.dials || {};
  dreamSeason(ctx, out, W);
  out.limit = ctx.count * 0.58;
  if ((dz.topology || 0) > 0) yield* floatingIsles(ctx, out, W, ctx.zNear, ctx.zFar, dz.topology);
  const night = lightsOn(ctx);
  yield* cottages(ctx, out, W, 24, ctx.zFar, night);
  yield* landmarks(ctx, out, W, 'near', night);
  yield* boats(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* waterThings(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* wildlife(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* skeins(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* eagles(ctx, out, W);
  yield* fallingLeaves(ctx, out, W, ctx.zNear, 75, 5, 8);
  yield* floating(ctx, out, W, ctx.zNear, 90, 10);
  yield* mist(ctx, out, W, 40, ctx.zFar, 40, 26);
  yield* groundDetail(ctx, out, W, ctx.zNear, 160, 8, 3);
  const plan = [];
  yield* islandDetail(ctx, out, W, ctx.zNear, ctx.zFar, plan);
  woodsPlan(ctx, out, W, plan, ctx.zNear, ctx.zFar, 6.5, 0.5);
  forestPlan(ctx, out, W, plan, ctx.zNear, ctx.zFar, 6.5, { frontOnly: true });
  yield* drawPlan(ctx, out, plan, Math.max(0, out.limit - out.n));
  // the forest across the water behind its front rank (which the plan drew as whole trees)
  const front = (wx, d) => { const f = surface(W, wx, d - 7.8); return !(isTree(f.t) && f.far); };
  out.limit = Infinity;              // (the crowns keep to their own max)
  yield* waterline(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* crowns(ctx, out, W, 60, ctx.zFar, { max: 0.3 * ctx.count, skip: front });
  yield* understory(ctx, out, W, ctx.zNear, 60, 0.12 * out.left());
  yield* fillLake(ctx, out, W, { power: 1.55, cover: 3.2, mass: true, mirror: 0.75, wKeep: (d) => clamp(230 / d, 0.45, 1) });
}

function* mid(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { detailK: 1.6 });
  const dz = ctx.dials || {};
  dreamSeason(ctx, out, W);
  out.limit = ctx.count * 0.42;
  if ((dz.topology || 0) > 0) yield* floatingIsles(ctx, out, W, ctx.zNear, ctx.zFar, dz.topology);
  if ((dz.scale || 0) > 0) yield* giantMoose(ctx, out, W, ctx.zNear, ctx.zFar, dz.scale);
  yield* cottages(ctx, out, W, ctx.zNear, ctx.zFar, lightsOn(ctx));
  yield* landmarks(ctx, out, W, 'mid', lightsOn(ctx));
  yield* mist(ctx, out, W, ctx.zNear, 2000, 160, 110);
  const plan = [];
  yield* islandDetail(ctx, out, W, ctx.zNear, ctx.zFar, plan);
  yield* drawPlan(ctx, out, plan, Math.max(0, out.limit - out.n));
  out.limit = Infinity;              // (the crowns keep to their own max)
  yield* waterline(ctx, out, W, ctx.zNear, ctx.zFar);
  yield* crowns(ctx, out, W, ctx.zNear, ctx.zFar, { max: 0.6 * ctx.count, kd: 0.0125, min: 9 });
  yield* fillLake(ctx, out, W, { power: 1.25, cover: 3, maxR: 0.05, mass: true, mirror: 0.7, occlude: true, wKeep: (d) => clamp(1000 / d, 0.35, 1) });
}

function* far(ctx0, emit) {
  const [ctx, W] = local(ctx0);
  const out = makeOut(ctx, emit, { zMargin: 600 });
  dreamSeason(ctx, out, W);
  yield* farFill(ctx, out, W);
}

// The far band: the hills beyond the lake, in autumn colour, and their reflection where the lake
// reaches far enough out to show it. Most of the far ground hides behind the mid band's hills and
// forest; the splats go to what rises above that (after pinewood.js).
function* farFill(ctx, out, W) {
  out.limit = Infinity;
  const n = out.left();
  const rng = ctx.rng, dn = ctx.zNear, df = ctx.zFar, L = ctx.length;
  const Z = Math.log(df / dn);
  const OX = 100, M = 900, occ = [], reach = [];
  for (let wx = ctx.x0 - M; wx <= ctx.x0 + L + M; wx += OX) {
    let a = -1;
    // (the mid band's ridges, and the far hills in front of the mountains)
    for (const dd of [400, 700, 1000, 1400, 1900, 2500, 2950, 3500, 4200, 5000]) a = Math.max(a, (W.H(wx, dd) + 8 - CAMY) / dd);
    occ.push(a);
    reach.push(xAt(W, wx, XT).fd);
  }
  const occMin = occ.map((_, k) => { let m = Infinity; for (let j = Math.max(0, k - 7); j <= Math.min(occ.length - 1, k + 7); j++) m = Math.min(m, occ[j]); return m; });
  const col = (x) => clamp(Math.round((x + M) / OX), 0, occ.length - 1);
  // (what lies nearer than a column's own skyline sample cannot be hidden by it)
  const hidden = (x, d, y) => d > 3600 && (y - CAMY) / d < occMin[col(x)] - 0.004;
  let vis = 0;
  for (let k = 0; k < 300; k++) {
    const d = dn * Math.pow(df / dn, rng()), x = rng() * L;
    if (!hidden(x, d, W.H(ctx.x0 + x, d))) vis++;
  }
  const fv = clamp(vis / 300, 0.15, 1);
  // mirrored where the lake in front is long (the reach): each such sample costs two splats
  let mirN = 0;
  // (a hill at distance D, h above the water, shows in the lake if its image, D EYE / (EYE + h) out,
  // falls inside the far shore: with the eye high, the near ridges reflect even in a short lake)
  for (const f of reach) if (f > 300) mirN++;
  const pm = 0.55 * mirN / reach.length;
  const mirrored = (x, d, y) => d * EYE / (EYE + Math.max(0, y + 6 - LV)) < reach[col(x)] - 15;
  const n0 = out.n;
  const nS = Math.round((n - (out.n - n0)) / (1 + pm));
  const target = out.n + (n - (out.n - n0));
  for (let i = 0; out.n < target && i < nS * 3; i++) {
    let d = 0, x = 0, wx = 0, y = 0;
    for (let t = 0; t < 6; t++) {
      d = dn * Math.pow(df / dn, t === 0 ? golden(i, nS, rng) : rng());
      x = rng() * L; wx = ctx.x0 + x;
      y = W.H(wx, d);
      if (!hidden(x, d, y)) break;
    }
    const dens = (nS / d / Z) / L / fv;
    const r = clamp(Math.sqrt(2.6 / (Math.PI * dens)), 0.0012 * d, 0.014 * d);
    // (the slope over a face's width: on the mountains a lit face and a shaded one, not a mottle)
    const e = d > 5000 ? Math.max(160, r * 1.4) : Math.max(40, r), dark = smooth(0.7, 1, HILL.top);
    const hx = (W.H(wx + e, d) - y) / e, hd = (W.H(wx, d + e) - y) / e;
    const nn = norm3(-hx, 1, hd);
    const el = y - LV, v = rng(), mtn = d > 5000 ? smooth(5000, 7000, d) : 0;
    let c;
    if (el < 260 + 140 * noise2(wx / 900, d / 800, W.ws + 122) || mtn <= 0) {
      // autumn forest seen from kilometres off: lumps of crowns in rust, gold and dark spruce,
      // bare rock on the highest knobs (and only at the mountains' foot)
      const mc = massColor(W, wx, d, 0.5 + 0.4 * v, rng, dark);
      c = mix3(mc.c, [0.24, 0.14, 0.08], 0.12);
      if (y > LV + 170 && noise2(wx / 700, d / 600, W.ws + 121) > 0.65) c = mix3(c, C.granite, 0.5);
    } else {
      // the mountains: dark conifer forest on the lower slopes, grey rock and scree above the tree
      // line, the first snow on the summits and down the gullies
      const tl = 620 + 180 * noise2(wx / 1500, d / 1300, W.ws + 123), sn = 1650 + 180 * noise2(wx / 1100, d / 1000, W.ws + 124);
      const gully = smooth(0.55, 0.8, noise2(wx / 260, d / 420, W.ws + 125)) * smooth(0.25, 0.6, Math.hypot(hx, hd));
      if (el < tl) c = mix3([0.05, 0.08, 0.07], [0.1, 0.12, 0.09], v);
      else c = mix3([0.34, 0.35, 0.42], [0.5, 0.48, 0.5], noise2(wx / 300, d / 300, W.ws + 126));
      if (el > tl - 120 && el < tl + 80) c = mix3(c, [0.22, 0.23, 0.24], 0.5);   // (the broken edge of the trees)
      const snow = el > sn || (el > sn - 300 && gully > 0.62);
      if (snow) c = mix3(c, [0.8, 0.8, 0.8], 0.9);
      c = mix3(c, snow ? [0.62, 0.66, 0.8] : [0.2, 0.22, 0.38], 0.22 * mtn);   // (blue and violet with distance)
    }
    // lit side and shaded side: the sun on each face, so the form reads (the haze lifts the shade)
    const lam = nn[0] * SUN[0] + nn[1] * SUN[1] + nn[2] * SUN[2];
    c = mul3(c, mtn > 0 ? 0.26 + 1.1 * Math.max(0, lam) : 1);
    if (mtn <= 0) c = shade(c, nn[0], nn[1], nn[2], 0.55, 0.6);
    c = jitter(c, rng, 0.05);
    c = [Math.min(0.8, c[0]), Math.min(0.8, c[1]), Math.min(0.8, c[2])];
    // (upright and round: a lump of crowns, or of rock; never stretched sideways)
    // (a fill samples by plan area: a steep face, seen nearly square on, gets few samples for its
    // area on the screen, so each stands as tall as the face rises over it)
    const steep = Math.min(1.6, Math.hypot(hx, hd));
    let sx = r * (0.78 + 0.2 * steep), sy = r * ((mtn > 0 ? 0.5 : 0.6) + 0.55 * steep), q = Q_ID;
    let ox = 0, oy = mtn > 0 ? 2 : 6, oz = 0;
    if (mtn > 0 && steep > 0.25) {
      // a mountain face: a stroke laid down the fall line (gullies, scree, the grain of the rock),
      // hanging from its sample point down the slope, so none stands up over the ridgeline
      const fl = norm3(hx, hx * hx + hd * hd, -hd);
      q = quatXTo(fl[0], fl[1], fl[2]);
      sx = r * (0.75 + 0.45 * steep); sy = r * 0.42;
      ox = -fl[0] * sx * 0.7; oy = -fl[1] * sx * 0.7; oz = -fl[2] * sx * 0.7;
    }
    out(x + ox, y + oy, -d + oz, sx, sy, sy, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND);
    if (mirrored(x, d, y) && rng() < 0.55) emitMirror(out, x, y + 6, -d, sx, sy, sy, c[0], c[1], c[2], 1, q[0], q[1], q[2], q[3], KIND.GROUND);
    if (out.due()) yield;
  }
}

export const autumnBiome = {
  name: 'autumn',
  palette: PAL,
  terrain: { cutting: 0.4 },
  hazeDist: 9000,
  gold: 0.9,
  // the water and what stands round it are the picture: the trackside is mostly water and rock
  shares: { trackside: 0.1, near: 0.28, mid: 0.43, far: 0.19 },
  // morning, late afternoon and dusk, the low warm sun of October
  slots: { dawn: 0.32, day: 0.38, dusk: 0.3, night: 0 },
  beatKinds: [KIND.BUILDING, KIND.LIGHT],
  sky: { clear: 0.7, stars: 1.1, deep: 0.5 },
  generators: { trackside, near, mid, far },
};

// ---------------------------------------------------------------------------------------------
// For scripts that inspect the layout: _debug.layout('7', 0, 20000)
// ---------------------------------------------------------------------------------------------
function at(seedStr) {
  const terrain = makeTerrain(hashString(String(seedStr)), autumnBiome.terrain);
  return world({ terrain });
}
function layout(seedStr, x0, x1) {
  const W = at(seedStr);
  const R = Math.round;
  const list = (cell, fn, map) => { const res = []; for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) { const o = fn(W, i); if (o) res.push(...[].concat(map(o))); } return res; };
  const shore = [];
  for (let wx = x0; wx <= x1; wx += 250) { const x = xAt(W, wx, { ...XT }); shore.push({ wx, nd: R(x.nd), fd: R(x.fd), viaduct: +x.cw.toFixed(2), woods: +x.inl.toFixed(2), cliff: +x.cl.toFixed(2), shelf: +x.sh.toFixed(2), slope: +x.sl.toFixed(2), wind: +x.wind.toFixed(2) }); }
  return {
    shore,
    points: list(PTCELL, pointOf, (p) => ({ wx: R(p.px), tip: R(p.tip), base: R(p.fb) })),
    islands: list(ICELL, islandOf, (s) => ({ wx: R(s.wx), d: R(s.d), rx: R(s.rx), wooded: s.wooded })),
    islandCottages: list(ICELL, islandOf, (s) => (s.cot ? { wx: R(s.cot.cx), d: R(s.cot.cd), dock: R(s.cot.d1) } : [])),
    stations: list(STACELL, stationOf, (t) => ({ wx: R(t.wx) })),
    stores: list(STORECELL, storeOf, (t) => ({ wx: R(t.wx) })),
    towers: list(TOWERCELL, towerOf, (t) => ({ wx: R(t.wx), d: R(t.d), h: R(t.h) })),
    eagles: list(EAGLECELL, eagleOf, (b) => ({ wx: R(b.wx), d: R(b.d), y: R(b.y) })),
    skeins: list(GEESECELL, skeinOf, (k) => ({ wx: k.fc.wx, dir: k.fc.dir, d: R(k.d), y: R(k.y), n: k.n, pair: k.pair, high: k.high })),
    wild: Object.keys(WILD).flatMap((k) => list(WILD[k].cell, (W2, i) => wildOf(W2, k, i), (g) => ({ kind: k, wx: R(g.wx), d: R(g.d), n: g.n }))),
    boats: list(BOATCELL, boatOf, (b) => ({ wx: R(b.wx), d: R(b.d), type: b.type, moving: b.moving })),
    water: list(WCELL, waterThingOf, (t) => ({ kind: t.kind, wx: R(t.wx), d: R(t.d) })),
    cottages: list(SCELL, siteOf, (s) => ({ wx: R(s.cx), d: R(s.cd), near: s.near, dock: R(s.d1), boathouse: s.boathouse, plane: s.plane, raft: s.raft, canoe: s.canoe })),
  };
}
export const _debug = { world, at, layout, xAt, heightAt, surface, T, stretchW, EYE, LV, pickSpecies };
