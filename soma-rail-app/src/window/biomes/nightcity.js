// "Nightcity": a city seen from an elevated railway at dusk and at night.
//
// The line runs on a low embankment through the inner city: a second track and the overhead line
// beside us, signals, cabinets, a palisade fence or brick parapet, now and then a platform, and the
// backs of sheds below the bank. Beyond: a street grid of terraces, flats and shops with lit
// windows, rows of street lamps with pools of light on the road, parked cars, a river in places;
// then the mass of the city rising block by block to towers, and a skyline far off with red
// aircraft lamps under an orange glow. Over it all, the sky's traffic: airliners strung out on
// approach, single ones crossing high up, a helicopter with its searchlight, an airship now and
// then, searchlight beams from downtown (see "The sky over the city").
//
// How light works (see sparkPatch.js): there are no lights in the renderer. Every splat is
// multiplied by the time-of-day tint (about 0.2 at night) except colours with a channel >= 0.97,
// which keep full brightness. So surfaces get ordinary daytime colours and go dark by themselves,
// and everything that glows is KIND.LIGHT with its brightest channel pinned at 1.0 (never shaded
// or jittered: that would land it in the forbidden 0.8..0.97 band). Ground "lit" by a lamp is
// faked with faint, wide light discs over it. Lamps, pools and glows are switched on with the
// hour the chunk was built at (ctx.hour), and the share of lit windows follows it too.
//
// Layout: one pure function of the world seed. Streets parallel to the line sit at fixed
// distances (`rows`), cross streets at world-x positions (`crossX`); blocks between them hold
// buildings whose design comes from world hashes of (row, plot), so a building cut by a chunk
// border is drawn identically on both sides. Only the ground fill uses the chunk's own rng.
//
// Surreal dials (all 0 at level 0):
//   scale     towers of impossible height that thin out upward into the sky (mid and far)
//   topology  blocks of city floating over the mid band; a second city hanging upside down from the sky;
//             airliners descending a corkscrew that stands in the sky
//   logic     the same corner shop and sign repeating along the first street, each copy slightly
//             wrong; window lights that form slow waves across the facades; the airship comes as
//             three in line, each copy a little more wrong
import { hashInts, makeRng, noise1, noise2 } from '../rng.js';
import {
  KIND, makeOut, worldSeed, worldRng, worldHash, cellsAround, groundY, fillGround, detail, shade, jitter,
  mul3, mix3, smooth, clamp, lerp, broadleaf, blob, stick, overheadLine, quatPitch, quatXTo, strut,
} from './kit.js';

const PAL = {
  ground: [0.15, 0.15, 0.16],
  foliage: [0.13, 0.2, 0.11],
  ballast: [0.38, 0.35, 0.32],
};

// The rail shelf (both tracks) sits at this height; beyond SHELF the bank falls to street level.
const SHELF_Y = -0.3;
const SHELF = 7.4;
const CUTTING = 6;              // street level below rail: an inner-city viaduct / embankment
const TRACK2 = 3.6;             // centre of the second track
const MAST_D = 6.3;

// ---------------------------------------------------------------------------------------------
// Light colours. Brightest channel always 1.0.
// ---------------------------------------------------------------------------------------------
const WARM = [[1.0, 0.78, 0.48], [1.0, 0.72, 0.42], [1.0, 0.84, 0.6], [1.0, 0.66, 0.36], [1.0, 0.8, 0.55]];
const COOL = [[0.82, 0.9, 1.0], [0.9, 0.94, 1.0], [0.62, 0.72, 1.0]];
const SODIUM = [1.0, 0.62, 0.26];
const LED = [0.86, 0.92, 1.0];
const NEON = [[1.0, 0.16, 0.55], [0.18, 0.86, 1.0], [1.0, 0.32, 0.12], [0.45, 1.0, 0.4], [0.72, 0.3, 1.0], [1.0, 0.9, 0.2]];
const RED = [1.0, 0.07, 0.04];
const SIG = { red: [1.0, 0.1, 0.06], green: [0.2, 1.0, 0.55], amber: [1.0, 0.6, 0.1] };

function winColor(u) {
  if (u < 0.72) return WARM[Math.floor(u / 0.72 * WARM.length)];
  return COOL[Math.floor((u - 0.72) / 0.28 * COOL.length) % COOL.length];
}

// Building materials (daytime colours; they darken with the tint at night).
const BRICK = [[0.46, 0.27, 0.2], [0.52, 0.32, 0.24], [0.4, 0.25, 0.2], [0.56, 0.44, 0.34], [0.36, 0.3, 0.27]];
const RENDER = [[0.62, 0.6, 0.55], [0.55, 0.54, 0.52], [0.68, 0.64, 0.56], [0.48, 0.5, 0.52]];
const CONCRETE = [[0.5, 0.5, 0.49], [0.42, 0.43, 0.45], [0.56, 0.55, 0.52], [0.36, 0.38, 0.41], [0.3, 0.33, 0.37]];
const SLATE = [0.24, 0.25, 0.28];
const CAR = [[0.12, 0.12, 0.13], [0.5, 0.5, 0.52], [0.36, 0.1, 0.08], [0.1, 0.16, 0.3], [0.62, 0.62, 0.6], [0.2, 0.22, 0.22]];

// ---------------------------------------------------------------------------------------------
// Time of day
// ---------------------------------------------------------------------------------------------
function hourOf(ctx) { const h = ctx.hour != null ? ctx.hour : 22; return Math.round((((h % 24) + 24) % 24) * 2) / 2; }
// Share of windows lit: few at dusk, most around 22:00, fewer after one in the morning.
const LIT_CURVE = [[0, 0.5], [1, 0.38], [2, 0.26], [4, 0.12], [6, 0.12], [8, 0.05], [16, 0.04], [18, 0.12], [20, 0.26], [21, 0.45], [22, 0.6], [23, 0.58], [24, 0.5]];
function litFrac(h) {
  for (let i = 1; i < LIT_CURVE.length; i++) {
    const [h1, v1] = LIT_CURVE[i];
    if (h <= h1) { const [h0, v0] = LIT_CURVE[i - 1]; return lerp(v0, v1, (h - h0) / (h1 - h0)); }
  }
  return 0.5;
}
// 1 at night, 0 by day: street lamps, signs and the sky glow follow it.
function nightness(h) { return h >= 12 ? smooth(17.5, 19.5, h) : 1 - smooth(5.5, 7.5, h); }

// Per-chunk light state, read by every helper through `out.L`.
function lightState(ctx, out) {
  const h = hourOf(ctx);
  out.L = { hour: h, lit: litFrac(h), night: nightness(h), lamps: nightness(h) > 0.35, signs: nightness(h) > 0.2 };
  return out.L;
}

// Emit a light-source splat (always KIND.LIGHT; colour passed straight through).
function light(out, x, y, d, sx, sy, sz, c, o) {
  return out(x, y, -d, sx, sy, sz, c[0], c[1], c[2], o, 0, 0, 0, 1, KIND.LIGHT);
}
// A glowing point with a soft halo; the core grows with distance so far lamps stay visible.
function glowPoint(out, x, y, d, c, r, halo = 0.16, hk = 4.5) {
  light(out, x, y, d, r, r, r, c, 1);
  if (halo > 0) light(out, x, y, d + 0.05, r * hk, r * hk, r * 2, c, halo);
}
// A faint pool of light lying on the ground (the road under a lamp, the pavement by a shop).
function pool(out, x, y, d, R, c, o) {
  light(out, x, y + 0.06, d, R, R * 0.02, R * 0.8, c, o);
}

// ---------------------------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------------------------
const CW = 96;              // cross-street spacing, metres of world x
const layouts = new Map();
function layout(ctx) {
  const ws = worldSeed(ctx);
  let L = layouts.get(ws);
  if (L) return L;
  const r = makeRng(hashInts(ws, 901));
  // Streets parallel to the line. Row k is the block between street k and street k + 1.
  const rows = [];
  let D = 40;                 // the first street runs just beyond the trackside band
  while (D < 3600) {
    const w = D < 300 ? 8 + 3 * r() : 12 + 0.004 * D;
    rows.push({ D, w, art: D > 120 && r() < (D < 300 ? 0.25 : 0.32), led: r() < 0.35, trees: r() < (rows.length ? 0.3 : 0.12) });
    D += D < 300 ? 44 + 30 * r() : (60 + 0.05 * D) * (0.7 + 0.6 * r());
  }
  L = { ws, rows, Ds: rows.map((q) => q.D) };
  layouts.set(ws, L);
  if (layouts.size > 8) layouts.delete(layouts.keys().next().value);
  return L;
}
function rowAt(L, d) {
  const Ds = L.Ds;
  if (d < Ds[0]) return -1;
  let lo = 0, hi = Ds.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (Ds[m] <= d) lo = m; else hi = m - 1; }
  return lo;
}
// Cross street j: its world x, and whether it runs through row k (avenues, every third, always do).
function crossX(L, j) { return (j + 0.32 * ((hashInts(L.ws, 31, j) & 1023) / 1023 - 0.5)) * CW; }
function crossIn(L, k, j) { return j % 3 === 0 || (hashInts(L.ws, 33, k, j) & 255) > 64; }
function crossW(j) { return j % 3 === 0 ? 14 : 9; }
// The river: in some stretches of world x it takes the place of a few rows, around 240..400 m out.
const RIVER = [236, 398];
function riverAt(L, wx) { return noise1(wx / 5200, L.ws + 5) > 0.63; }
function inRiver(L, wx, d) { return d > RIVER[0] && d < RIVER[1] && riverAt(L, wx); }
function downtown(L, wx) { return smooth(0.5, 0.85, noise1(wx / 6500, L.ws + 9)); }

// What the ground is at a world point: road, pavement, yard, garden, water.
function groundColor(L, wx, d, rng) {
  if (inRiver(L, wx, d)) return jitter([0.06, 0.08, 0.1], rng, 0.1);
  const k = rowAt(L, d);
  let c;
  if (k < 0) c = [0.27, 0.26, 0.24];
  else {
    const q = L.rows[k];
    const dd = d - q.D;
    const next = k + 1 < L.rows.length ? L.rows[k + 1].D : 1e9;
    const j = Math.round(wx / CW);
    const xs = Math.abs(wx - crossX(L, j));
    const cw = crossW(j);
    if (dd < q.w / 2 || next - d < L.rows[Math.min(k + 1, L.rows.length - 1)].w / 2) c = [0.17, 0.17, 0.18];   // carriageway
    else if (dd < q.w / 2 + 3 || next - d < 5) c = [0.37, 0.36, 0.34];                                            // pavement
    else if (xs < cw / 2 && crossIn(L, k, j)) c = [0.18, 0.18, 0.19];
    else if (xs < cw / 2 + 3 && crossIn(L, k, j)) c = [0.37, 0.36, 0.34];
    else {
      // block interior: yards and gardens
      const g = noise2(wx / 40, d / 40, L.ws + 3);
      c = g > 0.6 && d < 1500 ? [0.15, 0.22, 0.12] : [0.3, 0.29, 0.27];
    }
  }
  if (d > 600) c = mix3(c, [0.25, 0.25, 0.25], smooth(600, 2500, d) * 0.6);
  return jitter(c, rng, 0.08);
}

// ---------------------------------------------------------------------------------------------
// Props (candidates for the kit)
// ---------------------------------------------------------------------------------------------

// A box building with a grid of windows, some lit, front facing the track.
//   x, d: centre of the footprint; the front face is at d - dep/2.
//   o: { w, dep, h, id (world-hash integer), wall, glass, lit (0..1 share of lit windows), floorH,
//        bayW, roofH (pitched roof, 0 = flat), ends (draw side walls), shop ({ neon, color }),
//        pattern(gx, gy, nx, ny) -> bool|null (overrides the lit test), k (detail factor),
//        y (base height), kind, lightKind }
// Far away the window grid is merged into cells several windows wide so the lights stay readable.
export function* cityBlock(ctx, out, x, d, o) {
  const w = o.w, dep = o.dep, h = o.h, id = o.id | 0;
  const L = out.L || lightState(ctx, out);
  const r = makeRng(hashInts(id, 7));
  const kind = o.kind != null ? o.kind : KIND.BUILDING;
  const fh = o.floorH || 3.1, bw = o.bayW || 2.7;
  const s = Math.max(o.minS || 0.14, detail(out, d, o.k || 1.1));
  const base = o.y != null ? o.y : Math.min(groundY(ctx, x - w / 2, d - dep / 2), groundY(ctx, x + w / 2, d - dep / 2)) - 0.3;
  const H = h + 0.3;
  const df = d - dep / 2;
  const wall = jitter(o.wall, r, 0.06);
  const front = shade(wall, 0, 0, 1, 0.66, 0.4);
  const glass = o.glass || [0.11, 0.12, 0.14];
  const lit = o.lit != null ? o.lit : L.lit;
  // o.fade: the building thins out as it rises (the impossible towers vanishing into the sky)
  const fadeAt = o.fade ? (yy) => 1 - smooth(0.3, 1, (yy - base) / H) : () => 1;
  // walls: a jittered grid of flat splats, coarser on the sides
  const p = s * 1.6;
  const wallFace = function* (x0, d0, U, alongX, col, pk) {
    const pp = p * pk;
    const nu = Math.max(1, Math.round(U / pp)), nv = Math.max(1, Math.round(H / pp));
    const su = (U / nu) * 0.64, sv = (H / nv) * 0.64;
    for (let i = 0; i < nu; i++) {
      const a = (i + 0.5 + (r() - 0.5) * 0.25) / nu;
      for (let j = 0; j < nv; j++) {
        const b = (j + 0.5 + (r() - 0.5) * 0.25) / nv;
        const c = mul3(col, 0.92 + 0.12 * b + 0.06 * (r() - 0.5));
        const yy = base + b * H;
        const f = fadeAt(yy);
        if (f < 0.03) continue;
        if (alongX) out(x0 + a * U, yy, -d0, su, sv, s * 0.1, c[0], c[1], c[2], f, 0, 0, 0, 1, kind);
        else out(x0, yy, -(d0 + a * U), s * 0.1, sv, su, c[0], c[1], c[2], f, 0, 0, 0, 1, kind);
        if (out.due()) yield;
      }
    }
  };
  yield* wallFace(x - w / 2, df, w, true, front, 1);
  if (o.ends !== false) {
    yield* wallFace(x - w / 2, df, dep, false, shade(wall, -1, 0, 0.3, 0.6, 0.4), 1.4);
    yield* wallFace(x + w / 2, df, dep, false, shade(wall, 1, 0, 0.3, 0.6, 0.4), 1.4);
  }
  // a flat roof is only drawn where the eye (2.6 m above rail level) can look down on it
  if (!(o.roofH > 0) && base + H < 2.4) {
    const roofC = shade(o.roofColor || [0.34, 0.34, 0.35], 0, 1, 0.2, 0.6, 0.4);
    const pr = p * 1.3;
    const nu = Math.max(1, Math.round(w / pr)), nv = Math.max(1, Math.round(dep / pr));
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const c = mul3(roofC, 0.9 + 0.15 * r());
        out(x - w / 2 + (i + 0.5) * w / nu, base + H, -(df + (j + 0.5) * dep / nv), w / nu * 0.64, s * 0.1, dep / nv * 0.64, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
        if (out.due()) yield;
      }
    }
  }
  // pitched roof: the front slope, seen from below as a dark band above the eaves
  if (o.roofH > 0) {
    const rh = o.roofH, pitch = Math.atan2(rh, dep / 2), sl = Math.hypot(rh, dep / 2);
    const q = quatPitch(-(Math.PI / 2 - pitch));
    const roofC = shade(o.roof || SLATE, 0, Math.cos(pitch), Math.sin(pitch), 0.6, 0.45);
    const nu = Math.max(1, Math.round((w + 0.6) / p)), nv = Math.max(1, Math.round(sl / p));
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const a = (i + 0.5) / nu, b = (j + 0.5) / nv;
        const c = mul3(roofC, 0.92 + 0.12 * r());
        out.q(x - w / 2 - 0.3 + a * (w + 0.6), base + H + b * rh, -(df - 0.2 + b * dep / 2), (w + 0.6) / nu * 0.64, sl / nv * 0.64, s * 0.1, c, 1, q, kind);
        if (out.due()) yield;
      }
    }
    // chimney stacks on the party walls
    if (o.party) {
      for (let px = x - w / 2 + o.party; px < x + w / 2 - 1; px += o.party) {
        const cc = shade(wall, 0, 0.2, 1, 0.6, 0.4);
        const cs = Math.max(0.3, s);
        for (let t = 0; t < 3; t++) out(px, base + H + rh * 0.75 + t * 0.4, -(df + dep * 0.36), cs, 0.28, cs, cc[0], cc[1], cc[2], 1, 0, 0, 0, 1, kind);
      }
    }
  }
  // windows
  const shopH = o.shop ? 4.2 : 0.9;
  const nf = Math.max(1, Math.floor((h - shopH) / fh + 0.25)), nb = Math.max(1, Math.floor(w / bw));
  const agX = Math.max(1, Math.ceil((s * 1.3) / bw)), agY = Math.max(1, Math.ceil((s * 1.3) / fh));
  const nx = Math.ceil(nb / agX), ny = Math.ceil(nf / agY);
  const cw = w / nx, ch = (nf * fh) / ny;
  const single = agX === 1 && agY === 1;
  const wrx = single ? Math.min(0.3, cw * 0.14) : cw * 0.24, wry = single ? Math.min(0.3, fh * 0.1) : ch * 0.22;
  const zf = df - 0.06;
  const winFace = function* (side) {
    // side 0: front; -1/+1: the side walls (fewer, dimmer windows)
    const U = side ? dep : w;
    const n = side ? Math.max(1, Math.floor(dep / (bw * agX))) : nx;
    const cu = U / n;
    for (let gx = 0; gx < n; gx++) {
      for (let gy = 0; gy < ny; gy++) {
        const hh = hashInts(id, side + 5, gx, gy);
        const u = (hh & 65535) / 65536, u2 = (hh >>> 16) / 65536;
        let on = o.pattern && (id % 3) === 0 ? o.pattern(gx, gy, n, ny, side) : null;   // one building in three
        if (on == null) on = u < lit * (side ? 0.7 : 1);
        const yy = base + shopH + (gy + 0.5) * ch;
        const along = (gx + 0.5) * cu;
        if (on) {
          const c = winColor(u2);
          const op = (single ? 0.75 + 0.25 * u2 : 0.8) * fadeAt(yy);
          // near windows are two panes stacked, so they read as upright rectangles, not dots
          if (side === 0 && single) { light(out, x - w / 2 + along, yy - wry * 1.1, zf, wrx, wry, 0.05, c, op); light(out, x - w / 2 + along, yy + wry * 1.1, zf, wrx, wry, 0.05, c, op); }
          else if (side === 0) light(out, x - w / 2 + along, yy, zf, wrx, wry, 0.05, c, op);
          else light(out, x + side * (w / 2 + 0.06), yy, df + along, 0.05, wry, wrx, c, op * 0.85);
        } else if (single && side === 0 && o.dark !== false) {
          out(x - w / 2 + along, yy, -zf, wrx, wry * 2, 0.05, glass[0], glass[1], glass[2], 1, 0, 0, 0, 1, kind);
        }
        if (out.due()) yield;
      }
    }
  };
  yield* winFace(0);
  if (o.ends !== false && o.sideWindows !== false) { yield* winFace(-1); yield* winFace(1); }
  if (o.shop) yield* shopFront(ctx, out, x, df, base, w, id, o.shop);
}

// A shop front on the ground floor: a lit display window, a fascia sign (neon at night) and a pool
// of light on the pavement. df = front face distance, base = ground height there.
export function* shopFront(ctx, out, x, df, base, w, id, shop) {
  const L = out.L || lightState(ctx, out);
  const r = makeRng(hashInts(id, 41));
  const open = r() < 0.75;
  const glassC = [0.16, 0.18, 0.2];
  const sw = w * (0.55 + 0.3 * r());
  const n = Math.max(2, Math.round(sw / 1.6));
  const sc = shop.window || (r() < 0.6 ? [1.0, 0.9, 0.74] : [0.88, 0.94, 1.0]);
  for (let i = 0; i < n; i++) {
    const px = x - sw / 2 + (i + 0.5) * sw / n;
    if (L.signs && open) light(out, px, base + 1.6, df - 0.08, sw / n * 0.55, 0.85, 0.05, sc, 0.85);
    else out(px, base + 1.6, -(df - 0.08), sw / n * 0.55, 0.85, 0.05, glassC[0], glassC[1], glassC[2], 1, 0, 0, 0, 1, KIND.BUILDING);
  }
  if (L.signs && open) pool(out, x, base + 0.3, df - 2.5, Math.max(2.5, sw * 0.4), sc, 0.12);
  // the fascia: a band of colour, glowing neon letters at night
  const nc = shop.color || NEON[Math.floor(r() * NEON.length)];
  const fw = Math.min(w * 0.8, sw * (0.7 + 0.3 * r()));
  const ny = base + 3.4;
  const ln = Math.max(3, Math.round(fw / 0.45));
  const lit = L.signs && shop.neon !== false;
  for (let i = 0; i < ln; i++) {
    if (shop.gaps && shop.gaps(i, ln)) continue;
    const px = x - fw / 2 + (i + 0.5) * fw / ln;
    const wob = 0.12 * Math.sin(i * 2.1 + id);
    if (lit) light(out, px, ny + wob, df - 0.12, fw / ln * 0.7, 0.22, 0.05, nc, 0.95);   // overlapping, so the letters read as a line of neon, not beads
    else out(px, ny, -(df - 0.12), fw / ln * 0.55, 0.3, 0.05, nc[0] * 0.6, nc[1] * 0.6, nc[2] * 0.6, 1, 0, 0, 0, 1, KIND.BUILDING);
  }
  if (lit) light(out, x, ny, df - 0.2, fw * 0.6, 0.9, 0.3, nc, 0.12);    // the glow on the wall round it
  if (out.due()) yield;
}

// A street lamp: pole, head, halo and the pool it throws on the road. tx/td: direction to the road.
export function* streetLamp(ctx, out, x, d, o = {}) {
  const L = out.L || lightState(ctx, out);
  const H = o.h || 8, c = o.color || SODIUM;
  const y0 = o.y != null ? o.y : groundY(ctx, x, d);
  const near = d < 320;
  if (near) yield* stick(ctx, out, x, y0, d, H, Math.max(0.07, detail(out, d, 0.5)), { color: [0.3, 0.31, 0.32], kind: KIND.OTHER, n: Math.max(2, Math.round(H / Math.max(0.6, detail(out, d, 1.5)))) });
  const hx = x + (o.dx || 0), hd = d + (o.dd || 0);
  if (!L.lamps) { out(hx, y0 + H, -hd, 0.35, 0.12, 0.2, 0.3, 0.3, 0.3, 1, 0, 0, 0, 1, KIND.OTHER); return; }
  const rc = Math.max(0.16, 0.0016 * d / Math.sqrt(Math.min(1, out.density)));
  // far lamps drop their halo at small budgets (the core alone still reads as a dot)
  glowPoint(out, hx, y0 + H - 0.1, hd, c, rc, near ? 0.15 : out.density < 0.5 ? 0 : 0.11, near ? 6 : 4);
  if (o.pool !== false) {
    const R = o.R || H * 0.85;
    pool(out, hx, y0, hd, R, c, 0.16);
    pool(out, hx, y0, hd, R * 0.45, c, 0.2);
  }
  if (out.due()) yield;
}

// A car: a dark body and cabin; `lights` 1 shows head and tail lights (traffic), 0 none (parked).
export function* car(ctx, out, x, d, color, dir = 1, lights = 0) {
  const y = groundY(ctx, x, d);
  const c = shade(color, 0, 0.5, 1, 0.6, 0.45);
  out(x, y + 0.6, -d, 2.0, 0.42, 0.85, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
  out(x - dir * 0.25, y + 1.18, -d, 1.15, 0.3, 0.72, 0.1, 0.11, 0.13, 1, 0, 0, 0, 1, KIND.OTHER);
  if (lights) {
    glowPoint(out, x + dir * 2.05, y + 0.72, d - 0.6, [1.0, 0.95, 0.82], 0.13, 0.3, 5);
    glowPoint(out, x - dir * 2.05, y + 0.78, d - 0.6, RED, 0.11, 0.25, 4);
  }
  if (out.due()) yield;
}

// A tower crane: lattice mast, jib along the track, red lamps at the top and the jib tip.
// Built of thin kit struts with members on every face (as pinewood's pylon): it used to be a stack
// of round blobs with a row of fat beads for the jib, a yellow fuzz from either side.
export function* crane(ctx, out, x, d, H, jib, rng) {
  const L = out.L || lightState(ctx, out);
  const y0 = groundY(ctx, x, d);
  const col = [0.62, 0.5, 0.2], dark = [0.3, 0.29, 0.27];
  const r = Math.max(0.07, 0.0005 * d), rb = r * 0.7;
  const a = 0.9;                                  // half-width of the mast
  const z = -d, K = KIND.OTHER;
  const seg = (len) => Math.max(1, Math.round(len / 8));
  const lace = d < 1400;                          // bracing only where it can be told apart
  const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [cx, cz] of cs) strut(out, x + cx * a, y0 - 0.3, z + cz * a, x + cx * a, y0 + H, z + cz * a, r, col, seg(H), 1, K);
  if (lace) {
    const st = 3.2;
    for (let f = 0; f < 4; f++) {
      const [ax, az] = cs[f], [bx, bz] = cs[(f + 1) % 4];
      for (let y = 0, k = 0; y + st <= H; y += st, k++) {
        const [px, pz, qx, qz] = k & 1 ? [ax, az, bx, bz] : [bx, bz, ax, az];
        strut(out, x + px * a, y0 + y, z + pz * a, x + qx * a, y0 + y + st, z + qz * a, rb, col, 1, 1, K);
      }
    }
  }
  if (out.due()) yield;
  // the jib along the line and the counter-jib behind: a triangular truss, two bottom chords and a
  // top chord, laced on each face; the cab and the counterweight; the A-frame and its ties
  const dir = rng() < 0.5 ? -1 : 1;
  const yj = y0 + H, back = jib * 0.28, th = 1.8;
  const X = (t) => x + dir * t;
  for (const sz of [-0.8, 0.8]) strut(out, X(-back), yj, z + sz, X(jib), yj, z + sz, r, col, seg(jib + back), 1, K);
  strut(out, X(-back), yj + th, z, X(jib), yj + 0.4, z, r, col, seg(jib + back), 1, K);
  if (lace) {
    const st = 3;
    for (let t = -back, k = 0; t + st <= jib; t += st, k++) {
      const h0 = th - (th - 0.4) * Math.max(0, t) / jib, h1 = th - (th - 0.4) * Math.max(0, t + st) / jib;
      for (const sz of [-0.8, 0.8]) strut(out, X(t + (k & 1 ? 0 : st)), yj, z + sz, X(t + (k & 1 ? st : 0)), yj + (k & 1 ? h1 : h0), z, rb, col, 1, 1, K);
      strut(out, X(t), yj, z - 0.8, X(t + st), yj, z + 0.8, rb, col, 1, 1, K);
    }
  }
  const cab = Math.max(1.1, r * 2);
  out(X(1.6), yj - 1.2, z, cab, 1.1, 1.0, col[0] * 0.8, col[1] * 0.8, col[2] * 0.8, 1, 0, 0, 0, 1, K);
  out(X(-back + 2.5), yj - 0.6, z, 2.2, 1.4, 1.2, dark[0], dark[1], dark[2], 1, 0, 0, 0, 1, K);
  for (const sz of [-0.6, 0.6]) strut(out, x, yj, z + sz, x, yj + 6, z, r, col, 1, 1, K);
  strut(out, x, yj + 6, z, X(jib * 0.65), yj + th * 0.5, z, rb, dark, 2, 1, K);
  strut(out, x, yj + 6, z, X(-back), yj + th, z, rb, dark, 1, 1, K);
  if (L.lamps || L.night > 0.1) {
    const rc = Math.max(0.3, 0.0022 * d);
    glowPoint(out, x, y0 + H + 6.5, d, RED, rc, 0.2);
    glowPoint(out, x + dir * jib, y0 + H, d, RED, rc, 0.2);
  }
  if (out.due()) yield;
}

// ---------------------------------------------------------------------------------------------
// Trackside
// ---------------------------------------------------------------------------------------------
function platformAt(ctx, wx) {
  const P = 1300, i = Math.floor(wx / P);
  const r = worldRng(ctx, 501, i);
  if (r() > 0.5) return null;
  const a = i * P + 200 + r() * 700, len = 150 + 60 * r();
  return wx >= a && wx < a + len ? { a, len, i } : null;
}
// Height of the trackside ground (rail level is 0): the ballast shelf, the bank, then the street.
function tsY(ctx, x, d, plat) {
  const top = plat ? 12.5 : SHELF;
  if (d <= top) return SHELF_Y;
  const g = groundY(ctx, x, d);
  return d < top + 3.4 ? lerp(SHELF_Y, g, smooth(top, top + 3.4, d)) : g;
}

function* trackside(ctx, emit) {
  const out = makeOut(ctx, emit, { zMargin: 1, detailK: 1.2 });
  const Ls = lightState(ctx, out);
  out.limit = ctx.count * 0.72;
  const N = ctx.count;
  const k = 1 / Math.min(1, Math.sqrt(out.density));
  const stretch = (wx, s, salt) => ctx.terrain.stretch(wx, s, salt);

  // overhead line: masts beyond the second track, the second track's wires above it
  // (the masts stand on the bank, so they are tall; the wires that reach the frame are the
  // field-side feeders just beyond them; the contact wires over the tracks are above the window)
  yield* overheadLine(ctx, out, ctx.beatMetres || 56, { d: MAST_D, height: 11, wires: [{ y: 5.4, sag: 0.5, dz: 0.25 }, { y: 4.8, sag: 0.35, dz: 0.25 }] });

  // second track: two rails (continuous, catching a little light) and sleepers
  const rStep = 0.4 * k;
  for (let x = rStep / 2; x < ctx.length; x += rStep) {
    for (const rd of [TRACK2 - 0.72, TRACK2 + 0.72]) out(x, SHELF_Y + 0.42, -rd, rStep * 0.66, 0.05, 0.05, 0.52, 0.5, 0.48, 1, 0, 0, 0, 1, KIND.OTHER);
    if (out.due()) yield;
  }
  for (const { i, x } of cellsAround(ctx, 0.7 * Math.max(1, k * 0.7), 0)) {
    out(x, SHELF_Y + 0.28, -TRACK2, 0.14, 0.05, 0.6, 0.28, 0.26, 0.24, 1, 0, 0, 0, 1, KIND.OTHER);
    if (out.due()) yield;
  }
  // cable trough along the cess
  for (let x = rStep / 2; x < ctx.length; x += rStep) {
    out(x, SHELF_Y + 0.12, -5.7, rStep * 0.66, 0.1, 0.22, 0.5, 0.49, 0.46, 1, 0, 0, 0, 1, KIND.OTHER);
    if (out.due()) yield;
  }

  // signals: a post with a head and one lit aspect, red / green / amber by hash
  for (const { i, wx0 } of cellsAround(ctx, 260, 2)) {
    const r = worldRng(ctx, 511, i);
    if (r() > 0.55) continue;
    const x = wx0 + r() * 260 - ctx.x0, d = 6.4 + r() * 0.5;
    yield* stick(ctx, out, x, SHELF_Y, d, 4.4, 0.09, { color: [0.3, 0.3, 0.3], kind: KIND.OTHER, n: 10 });
    out(x, SHELF_Y + 4.9, -d, 0.32, 0.6, 0.18, 0.08, 0.08, 0.08, 1, 0, 0, 0, 1, KIND.OTHER);
    const u = r(), asp = u < 0.45 ? SIG.green : u < 0.75 ? SIG.red : SIG.amber;
    const ay = SHELF_Y + 4.9 + (asp === SIG.green ? -0.3 : asp === SIG.red ? 0.3 : 0);
    glowPoint(out, x, ay, d - 0.2, asp, 0.09, 0.3, 6);
    // a dwarf signal at the foot of some
    if (r() < 0.4) glowPoint(out, x + 3, SHELF_Y + 0.5, 6.2, r() < 0.5 ? SIG.red : [1.0, 0.95, 0.85], 0.05, 0.25, 5);
  }
  // lineside cabinets and relay boxes
  for (const { i, wx0 } of cellsAround(ctx, 22, 2)) {
    const r = worldRng(ctx, 513, i);
    if (r() > 0.3) continue;
    const x = wx0 + r() * 22 - ctx.x0, d = 6.5 + r() * 0.5, w = 0.5 + 0.7 * r(), h = 0.8 + 0.6 * r();
    const c = r() < 0.6 ? [0.32, 0.38, 0.32] : [0.5, 0.5, 0.48];
    for (let t = 0; t < 3; t++) out(x, SHELF_Y + h * (t + 0.5) / 3, -d, w, h / 5, 0.3, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
  }

  // platforms: a raised deck beside the second track, lamps on posts, a shelter
  const P = 1300;
  for (let wxp = Math.floor(ctx.x0 / P) - 1; wxp <= Math.floor((ctx.x0 + ctx.length) / P); wxp++) {
    const pr = worldRng(ctx, 501, wxp);
    if (pr() > 0.5) continue;
    const a = wxp * P + 200 + pr() * 700, len = 150 + 60 * pr();
    if (a > ctx.x0 + ctx.length || a + len < ctx.x0) continue;
    const xa = Math.max(0, a - ctx.x0), xb = Math.min(ctx.length, a + len - ctx.x0);
    const ps = 0.5 * k;
    // the edge (with its white line) and the deck
    for (let x = xa + ps / 2; x < xb; x += ps) {
      out(x, 0.55, -5.0, ps * 0.66, 0.4, 0.06, 0.42, 0.4, 0.37, 1, 0, 0, 0, 1, KIND.OTHER);
      out(x, 0.92, -5.15, ps * 0.66, 0.03, 0.12, 0.76, 0.76, 0.7, 1, 0, 0, 0, 1, KIND.OTHER);
      if (out.due()) yield;
    }
    const nD = Math.round((xb - xa) * 7.3 / (0.9 * k * 0.9 * k));
    const prng = ctx.rng;
    for (let i = 0; i < nD; i++) {
      const x = xa + prng() * (xb - xa), d = 5.25 + prng() * 7.3;
      const c = jitter([0.4, 0.39, 0.37], prng, 0.06);
      out(x, 0.9, -d, 0.75 * k, 0.03, 0.75 * k, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.OTHER);
      if (out.due()) yield;
    }
    // lamps every 12 m of world x, with pools on the deck
    for (let wl = Math.ceil(a / 12) * 12; wl < a + len; wl += 12) {
      const x = wl - ctx.x0;
      if (x < -3 || x > ctx.length + 3) continue;
      yield* stick(ctx, out, x, 0.9, 9.5, 4, 0.06, { color: [0.3, 0.32, 0.34], kind: KIND.OTHER, n: 6 });
      if (Ls.lamps) {
        light(out, x, 4.85, 9.2, 0.28, 0.05, 0.08, LED, 1);
        light(out, x, 4.8, 9.25, 0.45, 0.35, 0.3, LED, 0.08);
        pool(out, x, 0.9, 8.3, 3.2, LED, 0.14);
      }
    }
    // a shelter: back wall, roof and a lit advertising panel
    const sx = a + len * (0.3 + 0.3 * pr()) - ctx.x0;
    for (let t = -4; t <= 4; t += 0.5) {
      for (let y = 1.2; y < 3.3; y += 0.5) out(sx + t, y, -11.8, 0.32, 0.32, 0.05, 0.3, 0.33, 0.36, 0.6, 0, 0, 0, 1, KIND.OTHER);
      out(sx + t, 3.5, -10.8, 0.32, 0.06, 1.2, 0.25, 0.26, 0.27, 1, 0, 0, 0, 1, KIND.OTHER);
    }
    if (Ls.signs) light(out, sx + 2.5, 2.0, 11.6, 0.6, 0.8, 0.05, [0.9, 0.95, 1.0], 0.9);
    // the platform's back wall / fence at the deck edge
    for (let x = xa + ps / 2; x < xb; x += ps) {
      for (const y of [1.4, 2.0]) out(x, y, -12.6, ps * 0.66, 0.3, 0.05, 0.3, 0.3, 0.3, 1, 0, 0, 0, 1, KIND.FENCE);
      if (out.due()) yield;
    }
  }

  // the boundary at the top of the bank, by stretch: a low brick parapet (graffiti in places), a
  // steel palisade, or an open post-and-rail fence that leaves the view down into the street
  {
    const fd = SHELF + 0.15;
    const style = (wx) => { const v = stretch(wx, 420, 61); return v > 0.58 ? 'brick' : v > 0.36 ? 'palisade' : 'rail'; };
    const step = 0.16 * k;
    const GC = [[0.6, 0.22, 0.4], [0.2, 0.42, 0.6], [0.66, 0.52, 0.18], [0.28, 0.5, 0.3], [0.7, 0.7, 0.66], [0.48, 0.25, 0.55], [0.12, 0.12, 0.13]];
    for (let x = step / 2; x < ctx.length; x += step) {
      const wx = ctx.x0 + x;
      if (platformAt(ctx, wx)) continue;
      const st = style(wx);
      if (st === 'brick') {
        if (Math.floor(wx / step) % 3) continue;
        const panel = Math.floor(wx / 5);
        let c = jitter(BRICK[1], ctx.rng, 0.08);
        if (worldHash(ctx, 521, panel) < 0.3 && stretch(wx, 160, 63) > 0.4) c = GC[Math.floor(worldHash(ctx, 523, panel, Math.floor(wx / 1.3)) * GC.length)];
        out(x, SHELF_Y + 0.45, -fd, step * 2, 0.42, 0.15, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.FENCE);
        out(x, SHELF_Y + 0.92, -fd, step * 2, 0.06, 0.22, 0.48, 0.47, 0.44, 1, 0, 0, 0, 1, KIND.FENCE);
      } else if (st === 'palisade') {
        // pales every 0.25 m: thin uprights that read as a grey veil under blur
        if (Math.floor(wx / 0.25) === Math.floor((wx - step) / 0.25)) continue;
        out(x, SHELF_Y + 0.8, -fd, 0.035, 0.75, 0.03, 0.3, 0.34, 0.32, 1, 0, 0, 0, 1, KIND.FENCE);
      } else {
        // posts every 2.5 m
        if (Math.floor(wx / 2.5) === Math.floor((wx - step) / 2.5)) continue;
        out(x, SHELF_Y + 0.55, -fd, 0.05, 0.55, 0.05, 0.36, 0.35, 0.33, 1, 0, 0, 0, 1, KIND.FENCE);
      }
      if (out.due()) yield;
    }
    // the horizontal rails of palisade and post-and-rail
    for (let x = rStep / 2; x < ctx.length; x += rStep) {
      const wx = ctx.x0 + x;
      if (platformAt(ctx, wx) || style(wx) === 'brick') continue;
      for (const y of style(wx) === 'palisade' ? [0.35, 1.35] : [0.5, 1.05]) out(x, SHELF_Y + y, -(fd + 0.05), rStep * 0.66, 0.035, 0.03, 0.32, 0.33, 0.31, 1, 0, 0, 0, 1, KIND.FENCE);
      if (out.due()) yield;
    }
  }

  // backs of low industrial units below the bank, with the odd security light and lit window
  for (const { i, wx0 } of cellsAround(ctx, 46, 30)) {
    const r = worldRng(ctx, 531, i);
    if (r() < 0.45) continue;
    const w = 24 + 18 * r(), dep = 10 + 6 * r(), h = 3.8 + 3 * r();
    const x = wx0 + 23 - ctx.x0, d = 15.5 + dep / 2 + r() * 4;
    const id = hashInts(L0(ctx).ws, 531, i);
    yield* cityBlock(ctx, out, x, d, { w, dep, h, id, wall: CONCRETE[Math.floor(r() * CONCRETE.length)], lit: Ls.lit * 0.25, floorH: h * 0.5, bayW: 6, k: 1.3, dark: false, sideWindows: false });
    if (Ls.lamps && r() < 0.7) {
      const lx = x + (r() - 0.5) * w * 0.7, ly = groundY(ctx, x, d) + h * 0.75;
      glowPoint(out, lx, ly, d - dep / 2 - 0.3, r() < 0.5 ? [1.0, 0.86, 0.64] : SODIUM, 0.12, 0.25, 6);
      light(out, lx, ly - 1.6, d - dep / 2 - 0.2, 2.6, 2.2, 0.1, [1.0, 0.82, 0.58], 0.1);
      pool(out, lx, groundY(ctx, lx, d - dep / 2 - 3), d - dep / 2 - 3, 4.5, [1.0, 0.82, 0.58], 0.12);
    }
  }
  // buddleia and sycamore on the bank, dark masses
  for (const { i, wx0 } of cellsAround(ctx, 18, 6)) {
    const r = worldRng(ctx, 541, i);
    if (r() > 0.22 * smooth(0.45, 0.8, stretch(wx0, 300, 65))) continue;
    const x = wx0 + r() * 18 - ctx.x0, d = SHELF + 3 + r() * 6;
    if (platformAt(ctx, wx0)) continue;
    yield* broadleaf(ctx, out, x, d, { height: 4 + 4 * r(), y: tsY(ctx, x, d, null) - 0.2, rng: r, color: [0.14, 0.2, 0.11], n: Math.round(80 * out.density) + 12 });
  }

  // ground: ballast shelf (both tracks), the bank, then the yard / street at the foot
  out.limit = Infinity;
  const rest = out.left();
  const shelfN = Math.round(rest * 0.22), bankN = Math.round(rest * 0.16);
  {
    const rng = ctx.rng;
    const area = ctx.length * (SHELF - 2.5);
    const rr = Math.sqrt((3.5 * area) / (Math.PI * shelfN));
    for (let i = 0; i < shelfN; i++) {
      const x = rng() * ctx.length, d = 2.5 + rng() * (SHELF - 2.5);
      const c = jitter(d > 5.0 && d < 6.4 ? [0.36, 0.33, 0.29] : PAL.ballast, rng, 0.22);
      out(x, SHELF_Y + (d < 5 ? 0.12 : 0), -d, rr, rr * 0.15, rr, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      if (out.due()) yield;
    }
  }
  {
    // the bank face from the shelf edge down to street level (behind a platform it starts later)
    const rng = ctx.rng;
    const area = ctx.length * 4.5;
    const rr = Math.sqrt((3.5 * area) / (Math.PI * bankN));
    for (let i = 0; i < bankN; i++) {
      const x = rng() * ctx.length;
      const plat = platformAt(ctx, ctx.x0 + x);
      const top = plat ? 12.5 : SHELF;
      const d = top + rng() * 4.5;
      const y = tsY(ctx, x, d, plat);
      const c = jitter(mix3([0.16, 0.22, 0.12], [0.34, 0.31, 0.27], noise2((ctx.x0 + x) / 6, d, 11)), rng, 0.2);
      out(x, y, -d, rr, rr * 0.5, rr, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.GROUND);
      if (out.due()) yield;
    }
  }
  const L = L0(ctx);
  yield* fillGround(ctx, out, {
    dNear: SHELF + 4, dFar: ctx.zFar + 1, power: 1.2, cover: 4, slope: false,
    color: (wx, d, rng) => (d < 31 ? jitter([0.28, 0.27, 0.25], rng, 0.15) : groundColor(L, wx, d, rng)),
  });
}
function L0(ctx) { return layout(ctx); }

// ---------------------------------------------------------------------------------------------
// Streets and blocks, shared by near and mid
// ---------------------------------------------------------------------------------------------

// Lamps along parallel street k (alternating sides) and the cross streets running away (avenues
// lit all the way, side streets in the near band only). Pools only where they can be seen.
function* streetLights(ctx, out, L, dLo, dHi, far) {
  const Ls = out.L;
  for (let k = 0; k < L.rows.length; k++) {
    const q = L.rows[k];
    if (q.D < dLo - 10) continue;
    if (q.D >= dHi) break;
    if (far && !q.art) continue;
    const sp = far ? (out.density < 0.4 ? 88 : 44) : k === 0 ? 22 : 30;    // the street right below the line gets more
    const c = q.led ? LED : SODIUM;
    for (const { i, wx0 } of cellsAround(ctx, sp, 2)) {
      const side = i & 1 ? 1 : -1;
      const d = q.D + side * (q.w / 2 + 0.8);
      if (d < dLo || d >= dHi) continue;
      if (inRiver(L, wx0, d)) continue;
      yield* streetLamp(ctx, out, wx0 - ctx.x0, d, { color: c, dd: -side * 1.2, pool: !far, h: far ? 10 : 8 });
    }
  }
  // cross streets: lamps every 30 m going away from the line
  const ja = Math.floor((ctx.x0 - 20) / CW), jb = Math.floor((ctx.x0 + ctx.length + 20) / CW) + 1;
  for (let j = ja; j <= jb; j++) {
    const avenue = j % 3 === 0;
    if (far && !avenue) continue;
    const cx = crossX(L, j);
    const x = cx - ctx.x0;
    if (x < -15 || x > ctx.length + 15) continue;
    const sp = far ? (out.density < 0.4 ? 100 : 50) : 32;
    const c = avenue ? SODIUM : (hashInts(L.ws, 35, j) & 1 ? LED : SODIUM);
    for (let t = Math.ceil(dLo / sp); t * sp < dHi; t++) {
      const d = t * sp;
      const k = rowAt(L, d);
      if (k < 0 || !crossIn(L, k, j) || inRiver(L, cx, d)) continue;
      const side = t & 1 ? 1 : -1;
      yield* streetLamp(ctx, out, x + side * (crossW(j) / 2 + 0.6), d, { color: c, dx: -side * 1.2, pool: !far, h: far ? 10 : 7.5 });
    }
  }
}

// One block (row k, between cross streets j and j+1) in the near band: terraces, flats, shops,
// a floodlit yard or a small park, by world hash. Heights grow with distance.
function* nearBlock(ctx, out, L, k, j, opts) {
  const q = L.rows[k], qn = L.rows[k + 1];
  if (!qn) return;
  const xa = crossX(L, j) + (crossIn(L, k, j) ? crossW(j) / 2 + 3 : 0);
  const xb = crossX(L, j + 1) - (crossIn(L, k, j + 1) ? crossW(j + 1) / 2 + 3 : 0);
  const da = q.D + q.w / 2 + 3, db = qn.D - qn.w / 2 - 3;
  if (xb < ctx.x0 - 60 || xa > ctx.x0 + ctx.length + 60) return;
  const r = worldRng(ctx, 601, k, j);
  const bid = hashInts(L.ws, 601, k, j);
  const u = r();
  const dm = (da + db) / 2;
  const Ls = out.L;
  if (inRiver(L, (xa + xb) / 2, dm) || inRiver(L, (xa + xb) / 2, da)) return;
  const grow = smooth(40, 300, da);
  // the first rows stay low (terraces, yards, sheds) so the eye on the viaduct sees over them
  const type = u < 0.55 - 0.4 * grow ? 'terrace' : u < 0.78 ? 'flats' : u < 0.9 ? 'shops' : u < 0.96 ? 'yard' : 'park';
  if (type === 'terrace') {
    // a row of narrow two- and three-storey houses under one roof, front gardens, chimneys
    const hw = 5 + 1.2 * r(), storeys = r() < 0.7 ? 2 : 3;
    const h = storeys * 2.9 + 0.4, dep = 8 + 2 * r();
    const wall = BRICK[Math.floor(r() * BRICK.length)];
    const n = Math.max(1, Math.floor((xb - xa) / hw));
    const W = n * hw;
    yield* cityBlock(ctx, out, xa + W / 2 - ctx.x0, da + 2 + dep / 2, { w: W, dep, h, id: bid, wall, roofH: 2.6, party: hw, bayW: hw / 2, floorH: 2.9, k: opts.k });
    // the back row facing the next street
    if (db - da > 30 && db < ctx.zFar) yield* cityBlock(ctx, out, xa + W / 2 - ctx.x0, db - dep / 2, { w: W, dep, h, id: bid + 1, wall: BRICK[Math.floor(r() * BRICK.length)], roofH: 2.6, party: hw, bayW: hw / 2, floorH: 2.9, k: opts.k * 1.2 });
  } else if (type === 'flats' || type === 'shops') {
    // plots of 14..34 m along the street, flats or shops-with-flats, rising with distance
    let x = xa;
    let p = 0;
    while (x < xb - 8) {
      const pr = makeRng(hashInts(bid, 3, p));
      const w = Math.min(xb - x, 14 + 20 * pr());
      const storeys = Math.round(2 + 1.6 * pr() + grow * (3 + 5 * pr()));
      const h = storeys * 3.1 + (type === 'shops' ? 1.2 : 0);
      const dep = 10 + 8 * pr();
      const mat = pr() < 0.5 ? BRICK : pr() < 0.6 ? RENDER : CONCRETE;
      const shop = type === 'shops' || pr() < 0.12 ? { color: NEON[Math.floor(pr() * NEON.length)] } : null;
      yield* cityBlock(ctx, out, x + w / 2 - ctx.x0, da + 1 + dep / 2, { w: w - 0.6, dep, h, id: hashInts(bid, 5, p), wall: mat[Math.floor(pr() * mat.length)], shop, k: opts.k, pattern: opts.pattern });
      if (db - da > 34 && db < ctx.zFar && pr() < 0.7) {     // the back row beyond the band belongs to nobody
        const h2 = Math.round(storeys * (0.8 + 0.6 * pr())) * 3.1;
        yield* cityBlock(ctx, out, x + w / 2 - ctx.x0, db - dep / 2, { w: w - 0.6, dep, h: h2, id: hashInts(bid, 7, p), wall: mat[Math.floor(pr() * mat.length)], k: opts.k * 1.3, pattern: opts.pattern });
      }
      x += w; p++;
      if (out.n > opts.cap) return;
    }
  } else if (type === 'yard') {
    // a builders' or bus yard: a shed, floodlights on tall poles, light on the ground
    const w = Math.min(36, xb - xa - 4), dep = 16;
    if (w > 10) yield* cityBlock(ctx, out, xb - w / 2 - 2 - ctx.x0, db - dep / 2, { w, dep, h: 7 + 3 * r(), id: bid, wall: CONCRETE[Math.floor(r() * CONCRETE.length)], lit: 0.1, floorH: 4, bayW: 6, k: opts.k * 1.2, sideWindows: false });
    const nl = 2 + Math.floor(r() * 3);
    for (let t = 0; t < nl; t++) {
      const lx = lerp(xa + 6, xb - 6, (t + 0.5) / nl) - ctx.x0, ld = lerp(da + 4, db - 4, r() * 0.5);
      const y0 = groundY(ctx, lx, ld);
      yield* stick(ctx, out, lx, y0, ld, 14, 0.15, { color: [0.35, 0.35, 0.36], kind: KIND.OTHER, n: 10 });
      if (Ls.lamps) {
        for (const ox of [-0.5, 0.5]) light(out, lx + ox, y0 + 14.2, ld - 0.3, 0.25, 0.18, 0.1, [0.95, 0.97, 1.0], 1);
        light(out, lx, y0 + 14.2, ld - 0.4, 2.2, 1.4, 0.6, [0.95, 0.97, 1.0], 0.18);
        pool(out, lx, y0, ld - 6, 14, [0.95, 0.97, 1.0], 0.12);
        pool(out, lx, y0, ld - 5, 6, [0.95, 0.97, 1.0], 0.14);
      }
    }
    // parked vans and lorries
    for (let t = 0; t < 5; t++) if (r() < 0.6) yield* car(ctx, out, lerp(xa + 5, xb - 5, r()) - ctx.x0, lerp(da + 3, db - 20, r()), r() < 0.5 ? [0.62, 0.62, 0.6] : [0.3, 0.32, 0.36], 1, 0);
  } else {
    // a small park: dark trees, a few path lamps
    const nT = Math.round((xb - xa) * (db - da) / 260);
    for (let t = 0; t < nT; t++) {
      const tx = lerp(xa, xb, r()) - ctx.x0, td = lerp(da, db, r());
      yield* broadleaf(ctx, out, tx, td, { height: 10 + 8 * r(), rng: r, color: [0.12, 0.19, 0.1] });
    }
    for (let t = 0; t < 4; t++) yield* streetLamp(ctx, out, lerp(xa, xb, r()) - ctx.x0, lerp(da, db, r()), { h: 4, color: r() < 0.5 ? LED : [1.0, 0.85, 0.6], R: 4 });
  }
}

// Parked cars along the kerbs of street k, and some traffic with lights on the busier streets.
function* streetCars(ctx, out, L, dLo, dHi) {
  for (let k = 0; k < L.rows.length; k++) {
    const q = L.rows[k];
    if (q.D < dLo) continue;
    if (q.D >= dHi) break;
    for (const { i, wx0 } of cellsAround(ctx, 6.2, 3)) {
      const h = hashInts(L.ws, 611, k, i);
      const u = (h & 1023) / 1024;
      if (inRiver(L, wx0, q.D)) continue;
      const j = Math.round(wx0 / CW);
      if (Math.abs(wx0 - crossX(L, j)) < crossW(j) / 2 + 4) continue;
      const col = CAR[(h >>> 10) % CAR.length];
      if (u < 0.5) yield* car(ctx, out, wx0 - ctx.x0, q.D + q.w / 2 - 1.1, col, 1, 0);             // parked, far kerb
      else if (u < 0.85) yield* car(ctx, out, wx0 - ctx.x0, q.D - q.w / 2 + 1.1, col, -1, 0);       // parked, near kerb
      else if (u < (q.art ? 0.97 : 0.9) && out.L.lamps) yield* car(ctx, out, wx0 - ctx.x0, q.D + ((h >>> 20) & 1 ? 1.6 : -1.6), col, (h >>> 20) & 1 ? 1 : -1, 1);
    }
  }
}

// Street trees along a few streets.
function* streetTrees(ctx, out, L, dLo, dHi) {
  for (let k = 0; k < L.rows.length; k++) {
    const q = L.rows[k];
    if (q.D < dLo) continue;
    if (q.D >= dHi) break;
    if (!q.trees) continue;
    for (const { i, wx0 } of cellsAround(ctx, 13, 8)) {
      const r = worldRng(ctx, 621, k, i);
      if (r() < 0.25 || inRiver(L, wx0, q.D)) continue;
      const j = Math.round(wx0 / CW);
      if (Math.abs(wx0 - crossX(L, j)) < crossW(j) / 2 + 3) continue;
      yield* broadleaf(ctx, out, wx0 - ctx.x0, q.D + q.w / 2 + 1.5, { height: 6 + 5 * r(), rng: r, color: [0.13, 0.2, 0.11] });
    }
  }
}

// The river: water in the ground fill; here the embankment lamps and their reflections, drawn as
// thin upright streaks just in front of the near bank so they cover the water band on screen.
function* riverLights(ctx, out, L, near) {
  const Ls = out.L;
  for (const { i, wx0 } of cellsAround(ctx, 26, 4)) {
    if (!riverAt(L, wx0)) continue;
    const r = worldRng(ctx, 631, i);
    const x = wx0 + r() * 26 - ctx.x0;
    if (near) {
      // near-bank lamps on the embankment
      const d = RIVER[0] - 3;
      if ((i & 1) === 0) yield* streetLamp(ctx, out, x, d, { color: SODIUM, pool: true, h: 7 });
      if (!Ls.lamps && Ls.lit < 0.1) continue;
      // streaks: what the far bank's lights look like in the water
      const yw = groundY(ctx, x, RIVER[0] + 4);
      const eye = 2.6 - yw;
      const span = eye * (1 - (RIVER[0] + 4) / RIVER[1]);
      const ns = 2 + Math.floor(r() * 3);
      for (let s = 0; s < ns; s++) {
        const c = r() < 0.5 ? SODIUM : winColor(r());
        const sx = x + (r() - 0.5) * 20;
        const len = span * (0.4 + 0.6 * r());
        light(out, sx, yw + 0.03 + len * 0.5, RIVER[0] + 4, 0.25 + 0.4 * r(), len * 0.5, 0.05, c, 0.18 + 0.3 * r());
      }
    } else {
      // far-bank lamps along the quay
      const d = RIVER[1] + 4;
      if ((i & 1) === 0) yield* streetLamp(ctx, out, x, d, { color: SODIUM, pool: false, h: 8 });
    }
    if (out.due()) yield;
  }
}

function* near(ctx, emit) {
  // lamps and pools are a fixed cost, so small budgets coarsen the buildings a little more
  const out = makeOut(ctx, emit, { detailK: ctx.count < 0.5 * 57000 ? 1.75 : 1.5 });
  const Ls = lightState(ctx, out);
  const L = layout(ctx);
  const dz = ctx.dials || {};
  const cap = ctx.count * 0.7;
  out.limit = ctx.count * 0.78;
  const pattern = Ls.night > 0.3 ? windowPattern(ctx, dz.logic || 0) : null;   // a pattern of lights needs the dark
  yield* streetLights(ctx, out, L, ctx.zNear, ctx.zFar, false);
  yield* riverLights(ctx, out, L, true);
  yield* streetCars(ctx, out, L, ctx.zNear, ctx.zFar);
  yield* repeatingShop(ctx, out, L, dz.logic || 0);
  // blocks, nearest rows first (they matter most); trees after
  const ja = Math.floor((ctx.x0 - 60) / CW) - 1, jb = Math.floor((ctx.x0 + ctx.length + 60) / CW) + 1;
  for (let k = 0; k + 1 < L.rows.length && L.rows[k].D < ctx.zFar; k++) {
    for (let j = ja; j <= jb; j++) {
      if (out.n > cap) break;
      if ((dz.logic || 0) > 0 && k === 0 && repeatingStretch(ctx, (crossX(L, j) + crossX(L, j + 1)) / 2, dz.logic)) continue;
      yield* nearBlock(ctx, out, L, k, j, { k: 1.0, cap, pattern });
    }
  }
  yield* streetTrees(ctx, out, L, ctx.zNear, ctx.zFar);
  out.limit = Infinity;
  yield* fillGround(ctx, out, { power: 1.4, cover: 3.4, slope: false, color: (wx, d, rng) => groundColor(L, wx, d, rng) });
}

// ---------------------------------------------------------------------------------------------
// Mid: the mass of the city
// ---------------------------------------------------------------------------------------------
function* midBuildings(ctx, out, L, cap, pattern, dz) {
  for (let k = 0; k + 1 < L.rows.length; k++) {
    const q = L.rows[k], qn = L.rows[k + 1];
    if (q.D < ctx.zNear) continue;          // a row starting in the near band is the near band's
    if (q.D >= ctx.zFar) break;
    const da = q.D + q.w / 2 + 3, db = qn.D - qn.w / 2 - 3;
    if (db - da < 12) continue;
    const P = Math.round(32 + 0.022 * q.D);
    for (const { i, wx0 } of cellsAround(ctx, P, 40)) {
      const r = worldRng(ctx, 701, k, i);
      // at small budgets, fewer buildings rather than every building in too few splats
      if (r() < 0.12 + 0.3 * (1 - Math.min(1, out.density * 2))) continue;
      const cx = wx0 + P / 2;
      const ja = Math.round(cx / (3 * CW)) * 3;
      if (Math.abs(cx - crossX(L, ja)) < crossW(ja) / 2 + P * 0.35) continue;     // keep the avenues open
      const dt = downtown(L, cx);
      const fd = smooth(300, 2800, q.D);
      let storeys = 5 + 7 * fd + 6 * r() * (0.5 + fd);
      if (r() < 0.06 + 0.25 * dt) storeys *= 1.8 + 1.6 * r() * (0.4 + dt);        // towers, mostly downtown
      if ((dz.scale || 0) > 0 && r() < 0.02 * dz.scale) storeys *= 6;              // impossibly tall
      const h = storeys * 3.2;
      const w = P * (0.55 + 0.4 * r()), dep = Math.min(db - da, 14 + 30 * r());
      const d = da + dep / 2 + r() * Math.max(0, (db - da) - dep) * 0.3;
      if (d < ctx.zNear - 10 || d > ctx.zFar + 50) continue;
      if (inRiver(L, cx, d - dep / 2) || inRiver(L, cx, d + dep / 2)) continue;
      const mat = r() < 0.35 ? BRICK : CONCRETE;
      const id = hashInts(L.ws, 701, k, i);
      const tall = h > 70;
      yield* cityBlock(ctx, out, cx - ctx.x0, d, {
        w, dep, h, id, wall: mat[Math.floor(r() * mat.length)], k: 1.0, minS: 0.4, bayW: tall ? 3 : 2.8, floorH: 3.2,
        lit: out.L.lit * (tall ? 0.75 : 1), pattern, dark: false, kind: h > 600 ? KIND.SURREAL : KIND.BUILDING,
        fade: h > 600,
      });
      const x = cx - ctx.x0, top = groundY(ctx, x, d) + h;
      // red aircraft warning lamps on the tall ones; signs on a few roofs
      if (tall && (out.L.night > 0.1)) glowPoint(out, x, top + 1.5, d - dep / 2, RED, Math.max(0.5, 0.0024 * d), 0.22);
      if (!tall && r() < 0.07 && out.L.signs) {
        const nc = NEON[Math.floor(r() * NEON.length)];
        const sw = w * (0.4 + 0.4 * r()), ns = Math.max(3, Math.round(sw / Math.max(0.8, 0.004 * d)));
        for (let s = 0; s < ns; s++) light(out, x - sw / 2 + (s + 0.5) * sw / ns, top + 2.2, d - dep / 2, sw / ns * 0.45, Math.max(0.7, 0.002 * d), 0.1, nc, 0.95);
        light(out, x, top + 2.2, d - dep / 2 + 0.2, sw * 0.6, Math.max(2, 0.006 * d), 0.5, nc, 0.12);
      }
      if (out.due()) yield;
      if (out.n > cap) return;
    }
  }
}

function* mid(ctx, emit) {
  const out = makeOut(ctx, emit, { detailK: 2.6 });
  const Ls = lightState(ctx, out);
  const L = layout(ctx);
  const dz = ctx.dials || {};
  const cap = ctx.count * 0.7;
  out.limit = ctx.count * 0.78;
  const pattern = Ls.night > 0.3 ? windowPattern(ctx, dz.logic || 0) : null;   // a pattern of lights needs the dark
  yield* skyOver(ctx, out, dz);        // first: a few dozen splats that must never be squeezed out
  yield* streetLights(ctx, out, L, ctx.zNear, ctx.zFar, true);
  yield* riverLights(ctx, out, L, false);
  // cranes over building sites
  for (const { i, wx0 } of cellsAround(ctx, 420, 60)) {
    const r = worldRng(ctx, 711, i);
    if (r() > 0.4) continue;
    const d = 400 + r() * 2200;
    yield* crane(ctx, out, wx0 + r() * 420 - ctx.x0, d, 45 + 35 * r(), 40 + 30 * r(), r);
  }
  yield* midBuildings(ctx, out, L, cap, pattern, dz);
  if ((dz.topology || 0) > 0) yield* floatingBlocks(ctx, out, L, dz.topology);
  out.limit = Infinity;
  yield* fillGround(ctx, out, { power: 1.2, cover: 3, maxR: 0.05, color: (wx, d, rng) => groundColor(L, wx, d, rng) });
}

// ---------------------------------------------------------------------------------------------
// Far: the skyline, the carpet of lights, hills dotted with lights, and the glow over it all
// ---------------------------------------------------------------------------------------------
const FCELL = 9000;
function skylineIn(ctx, i) {
  const r = worldRng(ctx, 801, i);
  if (r() > 0.85) return null;
  return { cx: (i + 0.2 + 0.6 * r()) * FCELL, cd: 4600 + r() * 3000, R: 900 + 900 * r(), n: 14 + Math.floor(r() * 24), seed: hashInts(worldSeed(ctx), 801, i) };
}

// A far tower: dark body as a few splats, sparse window lights, a red lamp on top.
function* farTower(ctx, out, x, d, w, h, id, opts = {}) {
  const r = makeRng(id);
  const y0 = groundY(ctx, x, d) - 2;
  const s = Math.max(4, 0.0042 * d / Math.sqrt(Math.min(1, out.density)));
  const col = shade(CONCRETE[Math.floor(r() * CONCRETE.length)], 0, 0, 1, 0.6, 0.45);
  const kind = opts.kind != null ? opts.kind : KIND.BUILDING;
  const nx = Math.max(1, Math.round(w / (s * 1.5))), ny = Math.max(1, Math.round(h / (s * 1.5)));
  const fade = opts.fade ? (t) => 1 - smooth(0.25, 1, t) : () => 1;
  for (let j = 0; j < ny; j++) {
    const t = (j + 0.5) / ny;
    const f = fade(t);
    if (f <= 0.02) break;
    for (let i = 0; i < nx; i++) {
      out(x - w / 2 + (i + 0.5) * w / nx, y0 + t * h, -d, w / nx * 0.7, h / ny * 0.7, s * 0.3, col[0], col[1], col[2], f, 0, 0, 0, 1, kind);
    }
    if (out.due()) yield;
  }
  // window lights: a grid of cells, each about 0.003 d across, lit at a fraction of the night share
  const L = out.L;
  const cs = Math.max(6, 0.004 * d);
  const cx = Math.max(1, Math.round(w / cs)), cy = Math.max(1, Math.round(h / cs));
  const lit = L.lit * (opts.litK || 0.55);
  for (let j = 0; j < cy; j++) {
    const t = (j + 0.5) / cy, f = fade(t);
    if (f <= 0.02) break;
    for (let i = 0; i < cx; i++) {
      const hh = hashInts(id, i, j);
      const u = (hh & 65535) / 65536;
      let on = opts.pattern && (id % 3) === 0 ? opts.pattern(i, j, cx, cy, 0) : null;
      if (on == null) on = u < lit;
      if (!on) continue;
      light(out, x - w / 2 + (i + 0.5) * w / cx, y0 + t * h, d - 1, cs * 0.26, cs * 0.24, 1, winColor((hh >>> 16) / 65536), 0.85 * f);
    }
    if (out.due()) yield;
  }
  if (L.night > 0.1 && !opts.fade) glowPoint(out, x, y0 + h + 3, d - 2, RED, Math.max(3, 0.0028 * d), 0.25, 4);
}

function* far(ctx, emit) {
  const out = makeOut(ctx, emit);
  const Ls = lightState(ctx, out);
  const L = layout(ctx);
  const dz = ctx.dials || {};
  const ws = worldSeed(ctx);
  const pattern = Ls.night > 0.3 ? windowPattern(ctx, dz.logic || 0) : null;   // a pattern of lights needs the dark
  out.limit = ctx.count * 0.75;
  yield* skyOver(ctx, out, dz);        // first: a few dozen splats that must never be squeezed out
  // the skyline: clusters of towers
  for (let i = Math.floor((ctx.x0 - 3000) / FCELL); i <= Math.floor((ctx.x0 + ctx.length + 3000) / FCELL); i++) {
    const sk = skylineIn(ctx, i);
    if (!sk) continue;
    const r = makeRng(sk.seed);
    for (let t = 0; t < sk.n; t++) {
      const a = r.gauss() * 0.5, b = r.gauss() * 0.35;
      const wx = sk.cx + a * sk.R, d = clamp(sk.cd + b * sk.R, 3200, 13000);
      const core = Math.exp(-(a * a + b * b) * 2);
      const h = (60 + 240 * core * (0.4 + 0.6 * r())) * (0.7 + 0.6 * r());
      const w = 30 + 35 * r();
      yield* farTower(ctx, out, wx - ctx.x0, d, w, h, hashInts(sk.seed, t), { pattern });
    }
    // the glow over downtown, at night only
    if (Ls.night > 0.5) {
      for (let g = 0; g < 4; g++) {
        const gx = sk.cx + (r() - 0.5) * sk.R - ctx.x0, gd = sk.cd + (r() - 0.5) * 600;
        light(out, gx, groundY(ctx, gx, gd) + 150 + 250 * r(), gd, sk.R * 0.9, 320, 200, [1.0, 0.58, 0.32], 0.045 * Ls.night);
      }
    }
  }
  // the carpet: low blocks as dark lumps and clusters of window lights, thinning with distance
  const cs = 260;
  const carpetN = Math.round(ctx.count * 0.3);
  const rng = ctx.rng;
  for (let n = 0; n < carpetN; n++) {
    // world-hashed points so the carpet does not shimmer across chunk seams
    const gx = Math.floor(rng() * (ctx.length / cs + 2)) + Math.floor(ctx.x0 / cs) - 1;
    const sub = Math.floor(rng() * 4096);
    const h = hashInts(ws, 811, gx, sub);
    const wx = gx * cs + ((h & 1023) / 1024) * cs;
    const u = ((h >>> 10) & 4095) / 4096;
    const d = ctx.zNear * Math.pow(ctx.zFar / ctx.zNear, Math.pow(u, 1.3));
    const x = wx - ctx.x0;
    if (x < 0 || x >= ctx.length) continue;
    const urban = clamp(1.25 - smooth(5000, 11000, d) + 0.5 * (noise2(wx / 3000, d / 3000, ws + 21) - 0.5), 0, 1);
    if (((h >>> 22) & 1023) / 1024 > urban) continue;
    const y = groundY(ctx, x, d);
    const c = winColor(((h >>> 3) & 255) / 256);
    const sodium = (h & 7) < 3;
    if (Ls.lit > 0.08 || Ls.lamps) {
      const rr = (0.0016 + 0.0012 * (((h >>> 14) & 255) / 256)) * d;
      light(out, x, y + 4 + 30 * (((h >>> 5) & 63) / 64) * (1 - smooth(4000, 9000, d)), d, rr, rr * 0.8, rr, sodium ? SODIUM : c, 0.55 + 0.4 * u);
    } else {
      const g = shade(CONCRETE[(h >>> 4) % CONCRETE.length], 0, 0, 1, 0.6, 0.4);
      out(x, y + 10, -d, 0.004 * d, 0.002 * d, 0.004 * d, g[0], g[1], g[2], 1, 0, 0, 0, 1, KIND.BUILDING);
    }
    if (out.due()) yield;
  }
  // a low horizon glow along the whole city at night
  if (Ls.night > 0.5) {
    for (const { i, wx0 } of cellsAround(ctx, 1500, 800)) {
      const r = worldRng(ctx, 821, i);
      const d = 7000 + r() * 4000;
      light(out, wx0 + 750 - ctx.x0, groundY(ctx, wx0 + 750 - ctx.x0, d) + 60, d, 1400, 140, 400, [1.0, 0.6, 0.34], 0.035 * Ls.night);
    }
  }
  if ((dz.scale || 0) > 0) yield* impossibleTowers(ctx, out, dz.scale, pattern);
  if ((dz.topology || 0) > 0) yield* hangingCity(ctx, out, dz.topology);
  out.limit = Infinity;
  yield* fillGround(ctx, out, {
    power: 1.0, cover: 2.6, maxR: 0.03,
    color: (wx, d, rng) => jitter(mix3([0.2, 0.2, 0.2], [0.18, 0.2, 0.15], smooth(6000, 11000, d)), rng, 0.1),
  });
}

// ---------------------------------------------------------------------------------------------
// The sky over the city: airliners, a helicopter, an airship, searchlights
// ---------------------------------------------------------------------------------------------
// Nothing up here moves or blinks by itself (a light has no motion class to spare: on a light,
// those numbers mean traffic). A craft hangs where it is and drifts back as the train goes by,
// slowly, which is how a distant aircraft looks from a train; its lights twinkle with the treble
// and swell with the beat like every other light.
//
// Places are chosen in the frame, not in the air: (y - eye) / d is a thing's height on screen, the
// same for the whole pass. The towers reach about 0.17 and the window frame cuts in at about 0.42,
// so craft keep between 0.18 and 0.39 (a true three-degree approach would be lost behind the
// skyline). The helicopter and the airship keep under 0.28, below where the overhead line's
// wires swing.
// Sizes come from distance as the lamps' do: a light's core never much under a pixel, a wingspan
// never under about 0.009 d, so far off a plane is a few pixels of white, red and green that stay
// apart. The lights are on at every hour; searchlight beams, the helicopter's cone and the glow
// inside the airship wait for the night.
//
// One schedule, a pure function of the world seed (skyTraffic), says what is where; each band
// draws the craft whose centre lies in it, before anything that the splat limit could cut.
// How full the sky gets is set there, in metres of line: a far thing stays in view for some
// 1.7 d of travel, so the far cells are long and hold one thing each.
const EYE = 2.6;
const NAV_RED = [1.0, 0.1, 0.06], NAV_GREEN = [0.12, 1.0, 0.42], NAV_WHITE = [0.94, 0.97, 1.0];
const LANDING = [1.0, 0.97, 0.9], CABIN = [1.0, 0.86, 0.62], BEAM = [0.84, 0.92, 1.0];
const SKY_FAR = 12000;      // one approach line, or up to two high airliners and a low one, per cell
const SKY_LOW = 4500;       // at most one helicopter or airship per cell

function skyTraffic(ctx, a, b, dz) {
  const ws = worldSeed(ctx), res = [];
  const topo = (dz && dz.topology) || 0, logic = (dz && dz.logic) || 0;
  // Far cells. Half hold a line of airliners on approach: three to five on one straight line in
  // space (so they stay in line on screen all the way past), coming down towards the line, the
  // leader low, near and large over the mid city, each one behind it higher and smaller. The other
  // half hold none, one or two single airliners, high up, crossing, and most of them one more low
  // and near over the mid city: side on, with its row of cabin windows, or coming in alone. (A visit
  // to the city lasts one piece of music, some 7 km of line: this is what brings a near airliner
  // to more than half of them.)
  for (let i = Math.floor((a - 7000) / SKY_FAR); i <= Math.floor((b + 7000) / SKY_FAR); i++) {
    const r = makeRng(hashInts(ws, 941, i));
    if (r() < 0.5) {
      const dir = r() < 0.5 ? -1 : 1, n = 3 + Math.floor(r() * 2.6);
      const d0 = 750 + 700 * r(), d1 = 8000 + 2500 * r();
      const y0 = EYE + d0 * (0.18 + 0.04 * r()), y1 = EYE + d1 * (0.33 + 0.06 * r());
      const x0 = (i + 0.3 + 0.4 * r()) * SKY_FAR, dX = dir * (3000 + 2500 * r());
      const hl = Math.hypot(dX, d1 - d0);
      const h = [-dX / hl, 0, (d1 - d0) / hl];          // level, nose down the line of approach
      for (let k = 0; k < n; k++) {
        const d = d0 * Math.pow(d1 / d0, k / (n - 1)), t = (d - d0) / (d1 - d0);
        res.push({ type: 'liner', x: x0 + dX * t, y: y0 + (y1 - y0) * t, d, h, landing: true, group: 'approach', id: hashInts(ws, 943, i, k) });
      }
    } else {
      for (let s = 0; s < 2; s++) {
        const p = r(), fx = r(), fd = r(), fr = r(), fa = r(), dir = r() < 0.5 ? -1 : 1;
        if (p > 0.6) continue;
        const d = 4200 + 7300 * fd, ang = (fa - 0.5) * 0.6;
        res.push({ type: 'liner', x: (i + (s + 0.15 + 0.7 * fx) / 2) * SKY_FAR, y: EYE + d * (0.25 + 0.13 * fr), d, h: [dir * Math.cos(ang), 0, Math.sin(ang)], landing: false, group: 'single', id: hashInts(ws, 945, i, s) });
      }
      const p = r(), fx = r(), fd = r(), fr = r(), fa = r(), dir = r() < 0.5 ? -1 : 1, landing = r() < 0.4;
      if (p < 0.7) {
        const d = 750 + 750 * fd, ang = landing ? 0.9 + 0.4 * fa : (fa - 0.5) * 0.5;      // the nose's swing from the line of the track towards it
        res.push({ type: 'liner', x: (i + 0.2 + 0.6 * fx) * SKY_FAR, y: EYE + d * (0.19 + 0.07 * fr), d, h: [dir * Math.cos(ang), 0, Math.sin(ang)], landing, group: 'low', id: hashInts(ws, 945, i, 2) });
      }
    }
  }
  // Low cells: a helicopter over the towers of the mid city (nine cells in twenty), or an airship
  // further back (one in five).
  for (let i = Math.floor((a - 900) / SKY_LOW); i <= Math.floor((b + 900) / SKY_LOW); i++) {
    const r = makeRng(hashInts(ws, 947, i));
    const u = r(), x = (i + 0.2 + 0.6 * r()) * SKY_LOW, dir = r() < 0.5 ? -1 : 1, id = hashInts(ws, 949, i);
    if (u < 0.45) {
      const d = 420 + 600 * r();
      res.push({ type: 'heli', x, y: EYE + d * (0.2 + 0.08 * r()), d, dir, yaw: 0.2 + 0.4 * r(), id });
    } else if (u < 0.65) {
      const d = 900 + 900 * r(), y = EYE + d * (0.2 + 0.06 * r()), len = Math.max(120, 0.11 * d);
      res.push({ type: 'blimp', x, y, d, dir, len, id });
      // logic: the same airship twice more behind it, each copy a little more wrong
      if (logic > 0) for (let k = 1; k <= 2; k++) res.push({ type: 'blimp', x: x - dir * k * len * 1.3, y: y + k * len * 0.07, d, dir, len: len * (1 - 0.17 * k), id, wrong: k, surreal: true });
    }
  }
  // Searchlights: three or four beams fanned out from a roof in front of one skyline in three.
  for (let i = Math.floor((a - 2500) / FCELL); i <= Math.floor((b + 2500) / FCELL); i++) {
    const sk = skylineIn(ctx, i);
    if (!sk) continue;
    const r = makeRng(hashInts(ws, 951, i));
    if (r() > 0.36) continue;
    res.push({ type: 'beams', x: sk.cx + (r() - 0.5) * sk.R * 0.5, d: sk.cd - 250 - 300 * r(), n: 3 + Math.floor(r() * 1.6), id: hashInts(ws, 953, i) });
  }
  // topology: a holding stack you can see, ten airliners nose to tail down a corkscrew
  if (topo > 0) {
    for (let i = Math.floor((a - 2500) / 15000); i <= Math.floor((b + 2500) / 15000); i++) {
      const r = makeRng(hashInts(ws, 959, i));
      if (r() > 0.4 * topo) continue;
      const cx = (i + 0.2 + 0.6 * r()) * 15000, cd = 6200 + 2300 * r(), R = 650 + 350 * r(), th0 = r() * 6.283, sense = r() < 0.5 ? -1 : 1;
      for (let k = 0; k < 10; k++) {
        const th = th0 + sense * k * 1.05, d = cd + R * Math.sin(th);
        // heading: down the corkscrew, the way of falling k
        res.push({ type: 'liner', x: cx + R * Math.cos(th), y: EYE + d * (0.19 + 0.2 * k / 9), d, h: [sense * Math.sin(th), 0, sense * Math.cos(th)], landing: true, surreal: true, group: 'stack', id: hashInts(ws, 961, i, k) });
      }
    }
  }
  return res.filter((c) => c.x >= a && c.x < b);
}

// Everything in the sky that this chunk's band owns.
function* skyOver(ctx, out, dz) {
  const m = 2800;         // the widest thing (a searchlight beam leaning over) reaches this far along the line
  for (const c of skyTraffic(ctx, ctx.x0 - m, ctx.x0 + ctx.length + m, dz)) {
    if (c.d < ctx.zNear || c.d >= ctx.zFar) continue;
    if (c.type === 'liner') airliner(ctx, out, c);
    else if (c.type === 'heli') helicopter(ctx, out, c);
    else if (c.type === 'blimp') blimp(ctx, out, c);
    else searchlights(ctx, out, c);
    if (out.due()) yield;
  }
  if (globalThis.__nightcitySky) globalThis.__nightcitySky(ctx, out.n);    // for scripts: how many splats the sky took
}

// A craft's lamp at p ([x, y, z]). By day it is still lit, but small and without its halo.
function glowAt(out, p, c, r, halo, hk) {
  const day = out.L && out.L.night < 0.3;
  glowPoint(out, p[0], p[1], -p[2], c, day ? r * 0.7 : r, day ? 0 : halo, hk);
}
// A beam of light from a to b ([x, y, z]), r0 wide at a and r1 at b, fading from o0 to o1: a few
// long, soft light splats that overlap by half, so it is one shaft and not a row of them.
function beam(out, a, b, r0, r1, o0, o1, c, n) {
  for (let i = 0; i < n; i++) {
    const t0 = (i - 0.3) / n, t1 = (i + 1.3) / n, t = (i + 0.5) / n;
    strut(out, lerp(a[0], b[0], t0), lerp(a[1], b[1], t0), lerp(a[2], b[2], t0), lerp(a[0], b[0], t1), lerp(a[1], b[1], t1), lerp(a[2], b[2], t1),
      r0 + (r1 - r0) * t, c, 1, o0 + (o1 - o0) * t * (2 - t), KIND.LIGHT);
  }
}

// An airliner. At night it is its lights: red on the port wingtip and green on the starboard
// (which is on which side of the frame follows from the heading), white at the tail, a red beacon
// on the roof, and, coming in to land towards the line, the white landing lights that outshine
// the rest. The body is drawn too, pale and plain: it goes nearly black with the night tint and
// shows against the glow over the city. c: { x (world), y, d, h (unit heading [x, y, z]), landing, len }
function airliner(ctx, out, c) {
  const d = c.d, x = c.x - ctx.x0, y = c.y, z = -d, [hx, hy, hz] = c.h;
  const L = c.len || Math.max(62, 0.009 * d), span = L * 0.94;      // half as large again as life, and never a speck
  if (x < -L || x > ctx.length + L) return;
  const hl = Math.hypot(hx, hz) || 1, rx = -hz / hl, rz = hx / hl;   // the starboard side
  // a point f metres ahead of the middle, s to starboard, u up
  const P = (f, s, u) => [x + hx * f + rx * s, y + hy * f + u, z + hz * f + rz * s];
  const S = (p, q, r, col, n, kind) => strut(out, p[0], p[1], p[2], q[0], q[1], q[2], r, col, n, 1, kind);
  const kind = c.surreal ? KIND.SURREAL : KIND.OTHER;
  const body = [0.62, 0.64, 0.68], under = [0.42, 0.44, 0.48];
  const rf = Math.max(L * 0.03, 0.0005 * d), rw = Math.max(L * 0.011, 0.0004 * d);
  const big = L / d > 0.02;                 // enough pixels for more than a few lights
  S(P(-L * 0.5, 0, 0), P(L * 0.5, 0, 0), rf, body, big ? 6 : 3, kind);
  for (const s of [-1, 1]) {
    S(P(L * 0.08, s * rf * 0.5, -rf * 0.4), P(-L * 0.14, s * span / 2, rf * 0.2), rw, under, big ? 4 : 2, kind);
    if (!big) continue;
    S(P(-L * 0.42, 0, rf * 0.3), P(-L * 0.5, s * span * 0.19, rf * 0.3), rw * 0.8, under, 2, kind);       // tailplane
    S(P(L * 0.1, s * span * 0.17, -rf * 1.25), P(-L * 0.0, s * span * 0.17, -rf * 1.25), rf * 0.5, under, 1, kind);   // engine
  }
  if (big) S(P(-L * 0.38, 0, rf * 0.6), P(-L * 0.5, 0, rf * 0.6 + L * 0.13), rw * 1.2, body, 2, kind);   // fin
  // Lights get smaller in the frame with distance, but slowly (about 2 px across the core at 1 km,
  // 1.3 px at 10 km; the landing lights 4.5 px and 2 px): a line of approach then reads as depth.
  const km = d / 1000;
  const rn = Math.max(L * 0.014, 0.0017 * d * Math.pow(km, -0.19));
  glowAt(out, P(-L * 0.14, -span / 2, rf * 0.2), NAV_RED, rn, 0.2, 4);
  glowAt(out, P(-L * 0.14, span / 2, rf * 0.2), NAV_GREEN, rn, 0.2, 4);
  if (hz < 0.6) glowAt(out, P(-L * 0.52, 0, rf * 0.5), NAV_WHITE, rn * 0.9, 0.18, 4);       // head on, the tail light is out of sight
  if (big || !c.landing) glowAt(out, P(L * 0.12, 0, rf * 1.5), NAV_RED, rn * 0.7, 0.15, 3);
  if (c.landing && hz > 0.2) {
    // (well forward, so that the dark body never stands between them and the window)
    const rl = Math.max(L * 0.03, 0.0039 * d * Math.pow(km, -0.35));
    if (big) {
      for (const s of [-1, 1]) glowAt(out, P(L * 0.2, s * span * 0.13, -rf * 0.6), LANDING, rl, 0.24, 4.5);
      glowAt(out, P(L * 0.5, 0, -rf * 1.5), LANDING, rl * 0.6, 0.22, 4);                     // the nose leg
    } else glowAt(out, P(L * 0.54, 0, -rf), LANDING, rl * 1.1, 0.3, 6);
  }
  // the cabin: a line of lit windows down each side
  if (big) {
    const rc = Math.max(L * 0.005, 0.0007 * d);
    for (const s of [-1, 1]) {
      const a = P(-L * 0.34, s * rf * 0.95, rf * 0.25), b = P(L * 0.37, s * rf * 0.95, rf * 0.25);
      strut(out, a[0], a[1], a[2], b[0], b[1], b[2], rc, CABIN, 8, 0.85, KIND.LIGHT);
    }
  }
}

// A helicopter low over the towers, three quarters on, its searchlight slanting down to the roofs.
// Drawn large (never under 24 m long, and 4% of its distance): cabin, tail boom and fin, rotor
// mast and four still blades, skids; one side light, the tail light, a beacon under the belly.
// c: { x (world), y, d, dir (+1 nose towards +x), yaw (how far the nose swings towards the line) }
function helicopter(ctx, out, c) {
  const d = c.d, x = c.x - ctx.x0, y = c.y, z = -d;
  const len = Math.max(24, 0.04 * d), u = len / 11.5;
  if (x < -len * 8 || x > ctx.length + len * 8) return;
  const fx = c.dir * Math.cos(c.yaw), fz = Math.sin(c.yaw), rx = -fz, rz = fx;
  const P = (f, s, v) => [x + (fx * f + rx * s) * u, y + v * u, z + (fz * f + rz * s) * u];
  const S = (p, q, r, col, n) => strut(out, p[0], p[1], p[2], q[0], q[1], q[2], r, col, n, 1, KIND.OTHER);
  const thin = (k) => Math.max(k * u, 0.0004 * d);
  const hull = [0.74, 0.74, 0.7], dark = [0.16, 0.17, 0.2];     // a pale hull: the night tint leaves it just lighter than the sky
  const q = quatXTo(fx, 0, fz);
  const E = (p, sx, sy, sz, col) => out(p[0], p[1], p[2], sx * u, sy * u, sz * u, col[0], col[1], col[2], 1, q[0], q[1], q[2], q[3], KIND.OTHER);
  E(P(1.4, 0, 0), 1.9, 1.0, 1.0, hull);                            // cabin
  E(P(3.0, 0, -0.25), 0.9, 0.7, 0.8, dark);                        // the glazed nose
  E(P(0.6, 0, 1.05), 1.5, 0.5, 0.7, hull);                         // engine cowling
  S(P(-0.4, 0, 0.45), P(-7.4, 0, 0.9), thin(0.26), hull, 3);       // tail boom
  S(P(-7.1, 0, 0.6), P(-7.9, 0, 2.7), thin(0.24), hull, 1);        // fin
  S(P(-8.5, -0.35, 1.3), P(-7.3, -0.35, 2.7), thin(0.07), dark, 1);  // tail rotor
  S(P(-8.5, -0.35, 2.7), P(-7.3, -0.35, 1.3), thin(0.07), dark, 1);
  S(P(1.0, 0, 1.4), P(1.0, 0, 2.3), thin(0.2), dark, 1);           // mast
  for (const a of [0.5, 0.5 + Math.PI / 2]) {
    const bx = Math.cos(a) * 5.6, bs = Math.sin(a) * 5.6;
    S(P(1.0 - bx, -bs, 2.35), P(1.0 + bx, bs, 2.35), thin(0.09), dark, 4);
  }
  for (const s of [-1, 1]) {
    S(P(-0.6, s * 1.15, -1.75), P(3.2, s * 1.15, -1.75), thin(0.09), dark, 2);   // skid
    for (const f of [0.2, 2.4]) S(P(f, s * 0.7, -0.9), P(f, s * 1.15, -1.75), thin(0.07), dark, 1);
  }
  const rn = Math.max(0.3 * u, 0.0013 * d);
  glowAt(out, P(1.6, -1.45, 0.1), NAV_RED, rn, 0.2, 4);            // port; the hull hides whichever is on the far side
  glowAt(out, P(1.6, 1.45, 0.1), NAV_GREEN, rn, 0.2, 4);
  glowAt(out, P(-8.0, 0, 1.0), NAV_WHITE, rn * 0.9, 0.18, 4);
  glowAt(out, P(-1.2, 0, -1.25), NAV_RED, rn * 0.8, 0.18, 3);
  // the searchlight, and its cone down to the roofs ahead of it (by night)
  const lampP = P(2.5, 0, -1.4);
  const L = out.L || lightState(ctx, out);
  glowAt(out, lampP, BEAM, Math.max(0.4 * u, 0.0019 * d), L.night > 0.3 ? 0.3 : 0.12, 5);
  if (L.night > 0.3) {
    const hr = makeRng(c.id), roof = groundY(ctx, x, d) + 18 + 14 * hr();
    const H = lampP[1] - roof, lean = 0.3 + 0.35 * hr();
    const foot = [lampP[0] + c.dir * H * lean, roof, lampP[2] + H * 0.12];
    const len2 = Math.hypot(H * lean, H), R1 = 0.085 * len2;
    beam(out, lampP, foot, 0.4 * u, R1, 0.26, 0.07, BEAM, 6);
    light(out, foot[0], roof + 0.5, -foot[2], R1 * 1.9, R1 * 0.22, R1 * 1.5, BEAM, 0.3);      // where it lands
    light(out, foot[0], roof + 0.5, -foot[2], R1 * 0.8, R1 * 0.12, R1 * 0.7, BEAM, 0.45);
  }
}

// An airship broadside on: a silver envelope lit from inside, tail fins, a gondola with lit
// windows, and on its flank a lit sign of two lines.
// c: { x (world), y, d, dir, len, wrong (level 1: 1, 2 = a copy gone wrong) }
function blimp(ctx, out, c) {
  const d = c.d, x = c.x - ctx.x0, y = c.y, z = -d, Lb = c.len, R = Lb * 0.15, dir = c.dir;
  if (x < -Lb || x > ctx.length + Lb) return;
  const r = makeRng(c.id), wrong = c.wrong || 0, up = wrong === 2 ? -1 : 1;   // the third copy hangs upside down
  const night = (out.L || lightState(ctx, out)).night > 0.3;
  const kind = c.surreal ? KIND.SURREAL : KIND.OTHER;
  const P = (f, s, v) => [x + dir * f * Lb, y + up * v * R, z + s * R];      // f along (nose +0.5), s towards the line, v up, in radii
  const silver = [0.62, 0.64, 0.69], shadow = [0.36, 0.38, 0.43];
  const n = 8, prof = (t) => Math.sin(Math.PI * Math.pow(t, 0.8));            // fullest two fifths back from the nose
  const sign = NEON[(Math.floor(r() * NEON.length) + wrong * 2) % NEON.length], sign2 = r() < 0.5 ? [1.0, 0.95, 0.85] : NEON[(Math.floor(r() * NEON.length) + wrong) % NEON.length];
  const pale = mix3(sign, [1, 1, 1], 0.72), pm = Math.max(pale[0], pale[1], pale[2]), wash = [pale[0] / pm, pale[1] / pm, pale[2] / pm];   // brightest channel at 1: a light
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, rr = R * prof(t), f = 0.5 - t;
    out(x + dir * f * Lb, y, z, Lb / n * 0.78, rr * 0.78, rr * 0.78, silver[0], silver[1], silver[2], 1, 0, 0, 0, 1, kind);
    // lit from inside by night, as a show airship is: brightest amidships
    if (night) light(out, x + dir * f * Lb, y - up * rr * 0.05, d - rr * 0.4, Lb / n * 0.74, rr * 0.64, rr * 0.3, wash, i >= 1 && i <= 5 ? 0.3 : 0.18);
  }
  // fins: top, bottom and one each side
  for (const [s, v] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const a = P(-0.36, s * 0.25, v * 0.25), b = P(-0.49, s * 1.2, v * 1.2);
    strut(out, a[0], a[1], a[2], b[0], b[1], b[2], Math.max(R * 0.14, 0.0005 * d), shadow, 2, 1, kind);
  }
  // gondola and its windows
  const g = P(0.06, 0, -1.1);
  out(g[0], g[1], g[2], Lb * 0.075, R * 0.17, R * 0.2, 0.2, 0.2, 0.23, 1, 0, 0, 0, 1, kind);
  const wa = P(0.0, 0.22, -1.08), wb = P(0.125, 0.22, -1.08);
  strut(out, wa[0], wa[1], wa[2], wb[0], wb[1], wb[2], Math.max(R * 0.05, 0.0007 * d), CABIN, 4, 0.9, KIND.LIGHT);
  // the sign: two lines of lit letters lying on the curve of the flank
  const rows = [[0.36, sign, 11], [-0.2, sign2, 9]];
  for (let j = 0; j < rows.length; j++) {
    const [v, col, m] = rows[j];
    const s = Math.sqrt(1 - v * v) * 0.93, a = -0.19 + 0.03 * j, w = 0.4 - 0.06 * j, hh = R * 0.2;
    for (let i = 0; i < m; i++) {
      if (((hashInts(c.id, 7, j, i) & 7) < 1 + wrong * 2) && i > 0 && i < m - 1) continue;      // gaps between words (more of them on a wrong copy)
      const p = P(a + (i + 0.5) * w / m, s, v);
      light(out, p[0], p[1], -p[2], Lb * w / m * 0.36, hh, R * 0.04, col, 0.95);
    }
  }
  // white at the nose, red on the top fin and under the gondola
  const rn = Math.max(R * 0.05, 0.0013 * d);
  glowAt(out, P(0.51, 0, 0), NAV_WHITE, rn, 0.2, 4);
  glowAt(out, P(-0.5, 0, 1.3), NAV_RED, rn, 0.2, 4);
  glowAt(out, P(0.06, 0, -1.4), NAV_RED, rn * 0.8, 0.18, 3);
}

// Searchlights from a downtown roof: a fan of narrow beams leaning different ways and tilted in
// depth, so that they close and open like scissors as the train goes by (they cannot sweep). Each
// runs up to about four fifths of the way to the top of the window and fades out. By night only.
// c: { x (world), d, n, id }
function searchlights(ctx, out, c) {
  const L = out.L || lightState(ctx, out);
  if (L.night < 0.5) return;
  const r = makeRng(c.id), d0 = c.d, x = c.x - ctx.x0, y0 = groundY(ctx, x, d0) + 90 + 60 * r();
  const r0 = Math.max(8, 0.002 * d0);
  for (let b = 0; b < c.n; b++) {
    const lx = (b - (c.n - 1) / 2) * 0.34 + (r() - 0.5) * 0.3, lz = (r() - 0.5) * 0.7, top = 0.3 + 0.1 * r();
    const vl = Math.hypot(lx, 1, lz), vx = lx / vl, vy = 1 / vl, vz = lz / vl;
    const len = (EYE + top * d0 - y0) / (vy + top * vz);      // reaches the height `top` in the frame
    const bx = x + (b - (c.n - 1) / 2) * 18;
    beam(out, [bx, y0, -d0], [bx + vx * len, y0 + vy * len, -d0 + vz * len], r0, r0 * 3.2, 0.3, 0.015, BEAM, 8);
    glowPoint(out, bx, y0, d0, BEAM, r0 * 1.5, 0.2, 4);
  }
}

// ---------------------------------------------------------------------------------------------
// Level 1
// ---------------------------------------------------------------------------------------------

// Logic: on one building in three (by its world id), window lights form a slow diagonal band
// across the facade instead of the hour-based random scatter. Returns a pattern(gx, gy, nx, ny) for cityBlock / farTower, or null.
function windowPattern(ctx, logic) {
  if (logic <= 0) return null;
  const ws = worldSeed(ctx);
  return (gx, gy, nx, ny) => {
    // a diagonal band of light sweeping across each facade; the band width follows logic
    const v = Math.sin((gx / Math.max(1, nx)) * Math.PI * 2 + (gy / Math.max(1, ny)) * Math.PI * 3);
    return v > 1 - 1.4 * logic;
  };
}

// Logic: the same corner shop and sign repeating along the first street every 72 m, each copy
// a little more wrong (the sign's colour drifting, letters dropping out, the building leaning taller).
function repeatingStretch(ctx, wx, logic) {      // wx: WORLD x, so both callers and every chunk agree
  return noise1(wx / 3000, worldSeed(ctx) + 123) < 0.3 + logic;
}
function* repeatingShop(ctx, out, L, logic) {
  if (logic <= 0) return;
  const P = 72;
  const q = L.rows[0], qn = L.rows[1];
  for (const { i, wx0 } of cellsAround(ctx, P, 40)) {
    if (!repeatingStretch(ctx, wx0 + P / 2, logic)) continue;
    const wrong = (((i % 7) + 7) % 7) / 6;
    const d = q.D + q.w / 2 + 3 + 7;
    const hue = NEON[0], to = NEON[1];
    const c = [1.0, lerp(hue[1], to[1], wrong) * 0.7, lerp(hue[2], to[2], wrong)];
    const id = hashInts(worldSeed(ctx), 999);     // the same design every time
    yield* cityBlock(ctx, out, wx0 + P / 2 - ctx.x0, d, {
      w: 18, dep: 14, h: 12.4 + 3.1 * Math.round(wrong * 3 * logic * 3), id, wall: BRICK[2], k: 1,
      shop: { color: c, gaps: (s, n) => ((s * 7 + i * 3) % 11) / 11 < wrong * 0.4, window: [1.0, 0.9, 0.74] },
    });
    // the same parked car outside, every time
    yield* car(ctx, out, wx0 + P / 2 - 4 - ctx.x0, q.D + q.w / 2 - 1.1, CAR[2], 1, 0);
  }
}

// Topology: blocks of city broken off and floating over the mid band, lit windows and all.
function* floatingBlocks(ctx, out, L, topo) {
  for (const { i, wx0 } of cellsAround(ctx, 900, 200)) {
    const r = worldRng(ctx, 901, i);
    if (r() > 0.75 * topo) continue;
    const d = 700 + r() * 1800, x = wx0 + r() * 900 - ctx.x0;
    const y = groundY(ctx, x, d) + 90 + 220 * r() * topo;
    const R = 40 + 40 * r();
    // the broken underside: earth, pipes and concrete tapering down
    yield* blob(ctx, out, x, y - R * 0.35, d, R, R * 0.45, R * 0.6, { n: Math.round(160 * Math.sqrt(out.density)) + 20, color: [0.3, 0.27, 0.24], rng: r, kind: KIND.SURREAL, inner: 0.3, amb: 0.55 });
    const nb = 2 + Math.floor(r() * 4);
    for (let b = 0; b < nb; b++) {
      const bx = x + (r() - 0.5) * R * 1.2, bw = 14 + 14 * r(), bh = (4 + 10 * r()) * 3.2;
      yield* cityBlock(ctx, out, bx, d - R * 0.2, { w: bw, dep: 14, h: bh, id: hashInts(worldSeed(ctx), 903, i, b), y, wall: CONCRETE[b % CONCRETE.length], k: 1, minS: 0.4, kind: KIND.SURREAL, dark: false });
    }
    if (out.L.lamps) light(out, x, y - R * 0.5, d - R * 0.5, R * 0.8, R * 0.3, 2, [1.0, 0.62, 0.3], 0.05);
  }
}

// Scale: towers of impossible height on the skyline, thinning out into the sky as they rise.
function* impossibleTowers(ctx, out, scale, pattern) {
  for (const { i, wx0 } of cellsAround(ctx, 6000, 400)) {
    const r = worldRng(ctx, 911, i);
    if (r() > 0.75 * scale) continue;
    const d = 4500 + r() * 4500, x = wx0 + r() * 6000 - ctx.x0;
    const h = (2500 + 4000 * r()) * scale;
    yield* farTower(ctx, out, x, d, 110 + 110 * r(), h, hashInts(worldSeed(ctx), 911, i), { kind: KIND.SURREAL, fade: true, pattern, litK: 0.5 });
  }
}

// Topology: a second city hanging upside down from the sky, its towers pointing at ours.
function* hangingCity(ctx, out, topo) {
  const ws = worldSeed(ctx);
  for (const { i, wx0 } of cellsAround(ctx, 14000, 3000)) {
    const r = worldRng(ctx, 921, i);
    if (r() > 0.9 * topo) continue;
    const cx = wx0 + r() * 14000, cd = 7000 + r() * 4000, R = 3000 + 2500 * r();
    const ceil = 2600 + 800 * r();       // the hanging city's ground, high above ours
    const n = 30 + Math.floor(50 * r());
    for (let t = 0; t < n; t++) {
      const a = r.gauss() * 0.5, d = clamp(cd + r.gauss() * 0.3 * R, 3500, 13500);
      const x = cx + a * R - ctx.x0;
      const h = (80 + 400 * r() * Math.exp(-a * a * 2)) * (0.6 + 0.4 * topo);
      const w = 40 + 60 * r();
      const id = hashInts(ws, 923, i, t);
      const tr = makeRng(id);
      const s = Math.max(5, 0.0045 * d / Math.sqrt(Math.min(1, out.density)));
      const ny = Math.max(1, Math.round(h / (s * 1.5)));
      const col = shade(CONCRETE[t % CONCRETE.length], 0, -1, 0.5, 0.5, 0.3);
      for (let j = 0; j < ny; j++) {
        const yy = ceil - (j + 0.5) / ny * h;
        out(x, yy, -d, w * 0.5, h / ny * 0.7, s * 0.3, col[0], col[1], col[2], 0.9, 0, 0, 0, 1, KIND.SURREAL);
        if (tr() < out.L.lit * 0.8 + 0.1 * out.L.night) light(out, x + (tr() - 0.5) * w * 0.7, yy, d - 2, s * 0.35, s * 0.3, 1, winColor(tr()), 0.85);
        if (out.due()) yield;
      }
      if (out.L.night > 0.1 && tr() < 0.25) glowPoint(out, x, ceil - h - 4, d - 3, RED, Math.max(3, 0.0025 * d), 0.15, 3);
    }
    // the underside of its ground: a faint dark ceiling with a scatter of street lights
    const m = Math.round(110 * Math.sqrt(out.density));
    for (let t = 0; t < m; t++) {
      const x = cx + (r() - 0.5) * 2.4 * R - ctx.x0, d = clamp(cd + (r() - 0.5) * 1.2 * R, 3500, 13500);
      if (out.L.lamps) light(out, x, ceil + 5, d, 0.0025 * d, 0.0012 * d, 0.0025 * d, r() < 0.6 ? SODIUM : winColor(r()), 0.5);
      else out(x, ceil + 10, -d, 0.012 * d, 0.003 * d, 0.012 * d, 0.3, 0.3, 0.32, 0.8, 0, 0, 0, 1, KIND.SURREAL);
      if (out.due()) yield;
    }
  }
}

export const nightcityBiome = {
  name: 'nightcity',
  palette: PAL,
  // Flat: the city reads through what rises. The line runs on a 6 m viaduct-embankment, so the eye is
  // above the street: it sees the lamp pools, and over the terrace roofs to the city behind.
  terrain: { cutting: CUTTING, roll: 2, rollScale: 500, rise: 0.012, hills: 25, hillScale: 2500, mountains: 250, mountainScale: 9000, mountainStart: 6000 },
  hazeDist: 6500,
  hours: [20, 2],
  generators: { trackside, near, mid, far },
};

// For scripts that look things up: pass { terrain } for a world (see scripts/pass-strip.mjs).
export const _debug = {
  layout, rowAt, crossX, crossIn, crossW, riverAt,
  // everything in the sky whose world x lies in [a, b): { type, x, y, d, ... } (see skyTraffic)
  sky: (ctx, a, b, dials) => skyTraffic(ctx, a, b, dials || ctx.dials),
  // tower cranes whose world x lies in [a, b): { x, d, H }
  cranes(ctx, a, b) {
    const res = [];
    for (let i = Math.floor(a / 420); i < b / 420; i++) {
      const r = worldRng(ctx, 711, i);
      if (r() > 0.4) continue;
      const d = 400 + r() * 2200;
      res.push({ x: i * 420 + r() * 420, d, H: 45 + 35 * r() });
    }
    return res;
  },
  // the near band's blocks: { k, j, type, xa, xb, da, db }
  blocks(ctx, a, b) {
    const L = layout(ctx), res = [];
    for (let k = 0; k + 1 < L.rows.length && L.rows[k].D < 300; k++) {
      for (let j = Math.floor(a / CW); j < b / CW; j++) {
        const q = L.rows[k], qn = L.rows[k + 1];
        const r = worldRng(ctx, 601, k, j), u = r();
        const da = q.D + q.w / 2 + 3, db = qn.D - qn.w / 2 - 3, grow = smooth(40, 300, da);
        const type = u < 0.55 - 0.4 * grow ? 'terrace' : u < 0.78 ? 'flats' : u < 0.9 ? 'shops' : u < 0.96 ? 'yard' : 'park';
        res.push({ k, j, type, xa: crossX(L, j), xb: crossX(L, j + 1), da, db });
      }
    }
    return res;
  },
};
