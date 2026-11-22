// The prop and ground kit: small composable splat emitters that biomes build scenery from.
//
// How to use it in a generator:
//
//   function* near(ctx, emit) {
//     const out = makeOut(ctx, emit);                  // counts, clips and paces every splat
//     yield* broadleaf(ctx, out, 40, 120, { height: 14 });
//     yield* fillGround(ctx, out, { color: (wx, d) => [0.3, 0.45, 0.2] });   // the rest of ctx.count
//   }
//
// Conventions shared by every function here:
// - Every emitter is a generator `function* (ctx, out, ...)` and is called with `yield*`. It yields
//   whenever `out` has emitted ~400 splats since the last yield, so callers never have to count.
// - Positions are chunk-local x (0..ctx.length) and `d`, the distance from the track (z = -d).
//   Ground height comes from ctx.terrain via groundY(), so everything stands on the shared terrain.
// - `out` drops splats outside the chunk's x range [0, length) and outside the band (with a small
//   margin), so an object can straddle a chunk border: generate it from a WORLD-hashed rng
//   (worldRng / cellsAround) in both chunks and each chunk keeps its own half. The two halves only
//   line up if both chunks generate the object identically, so never use ctx.rng for those.
// - Natural colours are capped at 0.8 per channel; only KIND.LIGHT splats may go above (lights
//   ignore the time-of-day tint in the shader). Shading is baked: see shade() and SUN.
// - Splat counts scale with the budget: `out.density` is ctx.count relative to the default budget,
//   and `detail(out, d)` gives a splat radius that reads as fine detail at distance d. Pass explicit
//   `n` (splat count) to any emitter to override.
// - The 15th emit argument is a KIND tag. The engine ignores it; scripts/check-biomes.mjs uses it to
//   tell masts, wires and trees from everything else.
//
// Index (details at each function):
//   makeOut(ctx, emit)                       the counting / clipping / pacing emitter every band starts with
//   worldSeed, worldRng, worldHash, cellsAround   world-x hashing so things line up across chunks
//   groundY, groundNormal, detail, shade, jitter  terrain lookups, splat sizing, baked light
//   fillGround(ctx, out, opts)               opaque ground discs over a band, sized from density
//   strip(ctx, out, path, len, opts)         lanes, tracks, paths: a flat strip along a path
//   blob(ctx, out, x, y, d, rx, ry, rz, opts)    shaded ellipsoid cloud: crowns, bushes, rocks
//   stick(ctx, out, x, y, d, h, r, opts)     trunks, posts, poles
//   broadleaf / conifer(ctx, out, x, d, opts)    trees; bush(ctx, out, x, d, w, h, opts)
//   hedge(ctx, out, path, len, opts)         hedgerows and tree lines along any path
//   house(ctx, out, x, d, opts)              box building with pitched roof, windows, chimney
//   tower / church(ctx, out, x, d, opts)     square tower (battlements or spire); nave + tower
//   mast(ctx, out, x, d, opts); wires(ctx, out, span, list); overheadLine(ctx, out, beat, opts)
//   fence(ctx, out, d, opts)                 post-and-wire fence on world-x posts
//   lamp(ctx, out, x, y, d, color, opts)     a light source (ignores the time-of-day tint)
//   rock(ctx, out, x, d, r, opts)
//   strut(out, ax, ay, az, bx, by, bz, r, c, n)   a thin straight member; quatXTo(vx, vy, vz)
//   floatingIsland(ctx, out, x, y, d, r, opts); monolith(ctx, out, x, d, opts)   surreal pieces
import { hashInts, makeRng, noise1, noise2 } from '../rng.js';

// Splats per chunk for each band at the default budget of 600k (see layers.js shares).
export const NOMINAL = { trackside: 49000, near: 57000, mid: 33000, far: 20000 };

// What a splat is, for checks (and possible future per-kind effects).
export const KIND = { GROUND: 0, MAST: 1, WIRE: 2, TREE: 3, BUILDING: 4, HEDGE: 5, FENCE: 6, ROCK: 7, LIGHT: 8, SURREAL: 9, OTHER: 10 };
// Motion classes: an optional 16th emit argument. The shader moves a tagged splat (sparkPatch.js):
//   FLAG      flutters, by an amount in proportion to its own size (flags, banners, pennants)
//   TRAFFIC_n a continuous line of small light splats over lane n (0 = fast lane, 2 = lorries).
//             The shader lights only the splats under a vehicle's lamps, and the vehicles run
//             along the line. A red line runs the train's way, any other colour against it.
//             Must be KIND.LIGHT, about 1.2 m apart, with no gaps (a gap swallows vehicles).
//   VAPOUR    billows slowly (plumes, mist, cloud streamers, smoke)
//   BEAT      does not move, but swells and brightens on each beat of the music. By default
//             everything above eye level answers the beat; a biome that sets beatKinds (a list
//             of KINDs, e.g. [KIND.TREE, KIND.BUILDING]) switches that off and has those kinds,
//             plus anything tagged BEAT by hand, answer it instead. Lights always do.
//   FALL      falls, and comes round again at the top of a 16 m column about the eye's height: a
//             round splat is snow (1.3 m/s, with a sway), a splat at least 2.5 times taller than
//             wide is rain (9 m/s, straight). Scatter them evenly through a slab of air 16 m tall
//             (from 3.4 m below rail level to 12.6 m above), each at its own distance.
// Leave it out and the splat stays still.
export const MOVE = { NONE: 0, FLAG: 1, TRAFFIC_0: 2, TRAFFIC_1: 3, TRAFFIC_2: 4, VAPOUR: 5, BEAT: 6, FALL: 7 };

// Direction toward the sun for baked shading: high, to the left (-x) and on the camera's side
// (+z), so the faces the window sees are lit and tops are brightest.
export const SUN = norm3(-0.4, 0.8, 0.45);

const NAT_MAX = 0.8;   // natural surfaces stay below the shader's light-source threshold

// ---------------------------------------------------------------------------------------------
// Small maths
// ---------------------------------------------------------------------------------------------
export function norm3(x, y, z) { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; }
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, v) => { const t = clamp((v - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
export function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
export function mul3(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }

// Quaternions as [x, y, z, w].
export const Q_ID = [0, 0, 0, 1];
export function quatAxis(ax, ay, az, angle) { const s = Math.sin(angle / 2); return [ax * s, ay * s, az * s, Math.cos(angle / 2)]; }
export const quatYaw = (a) => quatAxis(0, 1, 0, a);     // turn about the vertical
export const quatRoll = (a) => quatAxis(0, 0, 1, a);    // tilt in the x-y plane (wires along x)
export const quatPitch = (a) => quatAxis(1, 0, 0, a);   // tilt in the y-z plane (roof pitches)
export function quatMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
// Rotation taking +y to the unit vector n (for discs lying on sloped ground).
export function quatUpTo(nx, ny, nz) {
  const w = 1 + ny;
  if (w < 1e-6) return [1, 0, 0, 0];
  const l = Math.hypot(nz, nx, w);
  return [nz / l, 0, -nx / l, w / l];
}
// Rotate a vector (x, z) in the ground plane by yaw a (matching quatYaw).
// Rotation taking +x to the unit vector v: an elongated splat lying along v (ellipsoids are
// symmetric, so v and -v are the same splat).
export function quatXTo(vx, vy, vz) {
  if (vx < 0) { vx = -vx; vy = -vy; vz = -vz; }
  const w = 1 + vx, l = Math.hypot(vz, vy, w);
  return [0, -vz / l, vy / l, w / l];
}
// A straight thin member from a to b (chunk-local x, y, z): n elongated splats laid end to end
// along it, r thick. Use it for anything thin and straight: lattice steel, cords, poles, rails,
// gantries, lamp columns. Size r from distance (about 0.0005 * d, with a floor near 0.05 m) so the
// member stays a line at any range; a thin thing drawn as round blobs or as a translucent panel
// turns to fuzz. c is [r, g, b]; kind defaults to KIND.MAST.
export function strut(out, ax, ay, az, bx, by, bz, r, c, n = 2, alpha = 1, kind = KIND.MAST) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz) || 1e-6;
  const q = quatXTo(dx / len, dy / len, dz / len), sl = (len / n) * 0.45;   // short enough that the ends do not spike past the joints
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    out(ax + dx * t, ay + dy * t, az + dz * t, sl, r, r, c[0], c[1], c[2], alpha, q[0], q[1], q[2], q[3], kind);
  }
}
export function rotY(x, z, a) { const c = Math.cos(a), s = Math.sin(a); return [c * x + s * z, -s * x + c * z]; }

// ---------------------------------------------------------------------------------------------
// The output wrapper, seeds and world cells
// ---------------------------------------------------------------------------------------------

// Wraps the engine's emit: clips to the chunk and band, caps colours, counts, and paces yields.
//   out(x, y, z, sx, sy, sz, r, g, b, opacity, qx, qy, qz, qw, kind, move) -> true if kept
//   out.n        splats emitted so far          out.due()   true every ~400 splats (then yield)
//   out.density  ctx.count / default count      out.left()  splats still wanted to reach ctx.count
//   out.limit    splats beyond this are dropped (default Infinity)
// opts.zMargin widens the band clip (default 4% of the far edge) so objects can overhang slightly.
// opts.detailK scales detail() for the whole band: use it to keep props inside the band's budget.
export function makeOut(ctx, emit, opts = {}) {
  const L = ctx.length;
  const m = opts.zMargin != null ? opts.zMargin : 0.04 * ctx.zFar;
  const dLo = Math.max(2.4, ctx.zNear - m), dHi = ctx.zFar + m;
  let since = 0;
  const out = (x, y, z, sx, sy, sz, r, g, b, o = 1, qx = 0, qy = 0, qz = 0, qw = 1, kind = KIND.OTHER, move = 0) => {
    if (out.n >= out.limit || !(x >= 0 && x < L)) return false;
    const d = -z;
    if (!(d >= dLo && d <= dHi)) return false;
    const cap = kind === KIND.LIGHT ? 1 : NAT_MAX;
    emit(x, y, z, sx, sy, sz, clamp(r, 0, cap), clamp(g, 0, cap), clamp(b, 0, cap), clamp(o, 0, 1), qx, qy, qz, qw, kind, move);
    out.n++; since++;
    return true;
  };
  out.n = 0;
  out.limit = Infinity;     // a hard stop: set it while placing props so the ground fill always gets its share
  out.ctx = ctx;
  out.density = ctx.count / (NOMINAL[ctx.layer] || ctx.count);
  out.detailK = opts.detailK || 1;   // > 1 makes every prop coarser (fewer, larger splats) in this band
  out.due = () => { if (since >= 400) { since = 0; return true; } return false; };
  out.left = () => Math.max(0, ctx.count - out.n);
  // Emit with a quaternion given as an array (or null for none).
  out.q = (x, y, z, sx, sy, sz, c, o, q, kind) => out(x, y, z, sx, sy, sz, c[0], c[1], c[2], o, q ? q[0] : 0, q ? q[1] : 0, q ? q[2] : 0, q ? q[3] : 1, kind);
  return out;
}

// Kit emitters accept either an `out` from makeOut() or the engine's raw `emit`; a raw emit is
// wrapped once (cached per emit function, so counting and pacing are shared across calls).
const wrapped = new WeakMap();
export function asOut(ctx, e) {
  if (e && e.due) return e;
  let o = wrapped.get(e);
  if (!o) { o = makeOut(ctx, e); wrapped.set(e, o); }
  return o;
}

// A 32-bit number that depends only on the world seed. ctx carries no seed, but the terrain is
// built from it and terrain.stretch(i, 1, salt) at an integer i is a pure hash of (seed, salt).
const seedCache = new WeakMap();
export function worldSeed(ctx) {
  let s = seedCache.get(ctx.terrain);
  if (s == null) { s = Math.floor(ctx.terrain.stretch(0, 1, 7919) * 4294967296) >>> 0; seedCache.set(ctx.terrain, s); }
  return s;
}
// A deterministic rng for a world thing (a cell, a hedge piece, a building), the same in every chunk.
export function worldRng(ctx, ...ints) { return makeRng(hashInts(worldSeed(ctx), ...ints.map((v) => Math.floor(v)))); }
// A 0..1 hash of world integers.
export function worldHash(ctx, ...ints) { return hashInts(worldSeed(ctx), ...ints.map((v) => Math.floor(v))) / 4294967296; }

// World cells of `size` metres that overlap this chunk widened by `margin` metres.
// Yields { i, wx0, x } where x is the chunk-local start of the cell.
export function* cellsAround(ctx, size, margin = 0) {
  const a = Math.floor((ctx.x0 - margin) / size), b = Math.floor((ctx.x0 + ctx.length + margin) / size);
  for (let i = a; i <= b; i++) yield { i, wx0: i * size, x: i * size - ctx.x0 };
}

// ---------------------------------------------------------------------------------------------
// Ground helpers
// ---------------------------------------------------------------------------------------------
export function groundY(ctx, x, d) { return ctx.terrain.height(ctx.x0 + x, d); }
// Upward unit normal of the terrain at (x, d), in splat space (z = -d).
export function groundNormal(ctx, x, d, e = Math.max(0.5, d * 0.01), h = groundY(ctx, x, d)) {
  const hx = (groundY(ctx, x + e, d) - h) / e, hd = (groundY(ctx, x, d + e) - h) / e;
  return norm3(-hx, 1, hd);
}
// A splat radius that reads as fine detail at distance d (about 3 px at 1080p), adjusted for budget.
export function detail(out, d, k = 1) { return Math.max(0.025, 0.0032 * d * k * out.detailK / Math.sqrt(out.density)); }

// Baked light: brightness for a surface normal, with an ambient floor. Returns colour * factor.
export function shade(c, nx, ny, nz, amb = 0.58, sun = 0.55) {
  const l = Math.max(0, nx * SUN[0] + ny * SUN[1] + nz * SUN[2]);
  const k = amb + sun * l;
  return [c[0] * k, c[1] * k, c[2] * k];
}
// Multiply a colour by 1 ± j at random (natural variation).
export function jitter(c, rng, j = 0.12) { const k = 1 + j * (rng() * 2 - 1); return [c[0] * k, c[1] * k, c[2] * k]; }

// Covers the ground of a band with flat discs, sized from the local density so it stays opaque at
// any budget. Sample density falls as d^-power (screen area falls faster than ground area).
//   opts.n        splat count (default: everything still wanted, out.left())
//   opts.dNear/dFar  distance range (default: the band)    opts.x0/x1  chunk-local x range
//   opts.color(wx, d, rng, x, groundHeight) -> [r,g,b] (unshaded; slope shading is applied here)
//   opts.cover    overlap factor (3 ≈ opaque); opts.power; opts.minR/maxR (as a fraction of d)
//   opts.lift     metres added to the terrain height (e.g. a crop canopy); opts.kind
//   opts.slope    align discs to the terrain slope (true by default; costs two extra height calls)
//   opts.rng      rng to use (default ctx.rng: ground fill is chunk-local and need not match)
export function* fillGround(ctx, out, opts = {}) {
  out = asOut(ctx, out);
  out.limit = Infinity;
  const n = Math.floor(opts.n != null ? opts.n : out.left());
  if (n <= 0) return;
  const rng = opts.rng || ctx.rng;
  const dn = opts.dNear != null ? opts.dNear : ctx.zNear, df = opts.dFar != null ? opts.dFar : ctx.zFar;
  const xa = opts.x0 != null ? opts.x0 : 0, xb = opts.x1 != null ? opts.x1 : ctx.length;
  const p = opts.power != null ? opts.power : 1.5, cover = opts.cover || 3;
  const minR = opts.minR || 0.0015, maxR = opts.maxR || 0.08;
  const slope = opts.slope !== false, lift = opts.lift || 0, kind = opts.kind != null ? opts.kind : KIND.GROUND;
  const flat = opts.flat || 0.12, opacity = opts.opacity || 1;
  const L = xb - xa;
  // inverse CDF of pdf ∝ d^-p on [dn, df]
  const a1 = 1 - p;
  const A = Math.abs(a1) < 1e-6 ? 0 : Math.pow(dn, a1), B = Math.abs(a1) < 1e-6 ? 0 : Math.pow(df, a1);
  const Z = Math.abs(a1) < 1e-6 ? Math.log(df / dn) : (B - A) / a1;
  const sample = (u) => (Math.abs(a1) < 1e-6 ? dn * Math.pow(df / dn, u) : Math.pow(A + u * (B - A), 1 / a1));
  for (let i = 0; i < n; i++) {
    // stratify u a little so thin budgets still spread evenly
    const u = (i + rng()) / n;
    const d = sample(u);
    const x = xa + rng() * L;
    const dens = (n * Math.pow(d, -p) / Z) / L;             // splats per square metre here
    const r = clamp(Math.sqrt(cover / (Math.PI * dens)), minR * d, maxR * d);
    const wx = ctx.x0 + x;
    const y = ctx.terrain.height(wx, d) + lift;
    let c = opts.color ? opts.color(wx, d, rng, x, y - lift) : ctx.palette.ground;
    let q = Q_ID;
    if (slope) {
      const nn = groundNormal(ctx, x, d, Math.max(0.5, r), y - lift);
      q = quatUpTo(nn[0], nn[1], nn[2]);
      c = shade(c, nn[0], nn[1], nn[2], 0.72, 0.36);
    }
    const ax = 0.8 + 0.5 * rng();
    out.q(x, y, -d, r * ax, r * flat, r * (1.8 - ax), c, opacity, q, kind);
    if (out.due()) yield;
  }
}

// A flat strip on the ground along a path (lanes, tracks, streams, chalk paths).
//   path(t) -> [x, d] for t in 0..1 (chunk-local x); len = path length in metres.
export function* strip(ctx, out, path, len, opts = {}) {
  out = asOut(ctx, out);
  const width = opts.width || 3, color = opts.color || [0.5, 0.48, 0.42];
  const rng = opts.rng || ctx.rng;
  const d0 = path(0.5)[1];
  const r = opts.r || Math.max(width * 0.35, detail(out, d0, 1.6));
  const n = Math.max(2, Math.round(opts.n || (len * width) / (r * r * 1.2)));
  for (let i = 0; i < n; i++) {
    const t = (i + rng()) / n;
    const [x, d] = path(t);
    const off = (rng() - 0.5) * width * 0.6;
    const dd = d + off;
    const y = groundY(ctx, x, dd) + (opts.lift || 0.03);
    out.q(x, y, -dd, r, r * 0.08, r, jitter(color, rng, 0.08), 1, null, KIND.GROUND);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Vegetation
// ---------------------------------------------------------------------------------------------

// A cloud of splats over an ellipsoid, shaded from its surface normal: the building block of
// crowns, bushes, hedges and rocks. Only the camera-facing (+z) and upper parts get most splats.
//   opts: { n, color, inner (darkening toward the core, 0..1), opacity, kind, rng, size (splat radius) }
export function* blob(ctx, out, x, y, d, rx, ry, rz, opts = {}) {
  out = asOut(ctx, out);
  const rng = opts.rng || ctx.rng;
  const n = Math.max(1, Math.round(opts.n || 30));
  const c0 = opts.color || ctx.palette.foliage || [0.2, 0.32, 0.14];
  const area = 2 * Math.PI * (rx * ry + ry * rz + rx * rz) / 3 * 1.2;
  // never let one splat be much bigger than the thing it draws (a far tree is 3 splats, not a smear)
  const s = opts.size || Math.min(Math.sqrt(area / n) * 0.75, Math.min(rx, ry, rz) * 0.85);
  const inner = opts.inner != null ? opts.inner : 0.35, kind = opts.kind != null ? opts.kind : KIND.TREE;
  const amb = opts.amb != null ? opts.amb : 0.62;
  const salt = opts.salt != null ? opts.salt : Math.floor(rng() * 1000);
  const clump = opts.clump != null ? opts.clump : 0.5;       // leaf-clump light and shadow, 0..1
  for (let i = 0; i < n; i++) {
    // random direction, biased toward the camera side and the top
    let ux = rng() * 2 - 1, uy = rng() * 2 - 1, uz = rng() * 2 - 1;
    const l = Math.hypot(ux, uy, uz) || 1; ux /= l; uy /= l; uz /= l;
    if (uz < -0.3 && rng() < 0.7) uz = -uz;
    const rad = Math.pow(rng(), 0.35);          // mostly near the surface
    let c = shade(c0, ux, uy, uz, amb, 0.6);
    // clumps: a few lobes of foliage catch the light, the gaps between them are in shade
    const cl = clump ? noise2(ux * 2.3 + 7, uy * 2.3 + uz * 1.7, salt) : 0.5;
    c = mul3(c, ((1 - inner) + inner * rad) * (1 - clump * 0.45 + clump * 0.9 * cl));
    c = jitter(c, rng, 0.12);
    const ss = s * (0.6 + 0.7 * rng());
    out(x + ux * rx * rad, y + uy * ry * rad, -(d - uz * rz * rad), ss, ss * 0.8, ss, c[0], c[1], c[2], opts.opacity || 0.95, 0, 0, 0, 1, kind);
    if (out.due()) yield;
  }
}

// Splats along a vertical (or tilted) stick: trunks, posts, masts, poles.
//   from (x, y, d) up `h` metres, radius `r`; opts: { color, n, lean: [dx, dd] per metre, kind, opacity }
export function* stick(ctx, out, x, y, d, h, r, opts = {}) {
  out = asOut(ctx, out);
  const c = opts.color || [0.22, 0.18, 0.14];
  const seg = Math.max(r * 2.2, opts.seg || h / Math.max(1, opts.n || Math.ceil(h / (r * 4))));
  const n = Math.max(1, Math.ceil(h / seg));
  const [lx, ld] = opts.lean || [0, 0];
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n * h;
    const k = opts.shadeTop ? 0.85 + 0.25 * (t / h) : 1;
    out(x + lx * t, y + t, -(d + ld * t), r, seg * 0.6, r, c[0] * k, c[1] * k, c[2] * k, opts.opacity || 1, 0, 0, 0, 1, kind);
    if (out.due()) yield;
  }
}

// A broadleaf tree (oak, ash, beech): trunk and a crown of several lumps.
//   opts: { height (m, default 12), crown (width, default 0.75*height), color, n (total splats), rng, kind, squash }
export function* broadleaf(ctx, out, x, d, opts = {}) {
  out = asOut(ctx, out);
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 12, W = Math.min(opts.crown || H * 0.75, H * 1.1);   // a crown never wider than the tree is tall
  const y0 = opts.y != null ? opts.y : groundY(ctx, x, d) - 0.2;
  const n = Math.max(4, Math.round(opts.n || treeSplats(out, d, W)));
  const color = opts.color || ctx.palette.foliage || [0.2, 0.32, 0.14];
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const trunkH = H - W * 0.55;
  const trunkR = Math.max(0.12, H * 0.022);
  if (n >= 12) yield* stick(ctx, out, x, y0, d, trunkH, trunkR, { color: opts.trunk || [0.2, 0.17, 0.13], n: Math.max(1, Math.round(n * 0.05)), kind });
  const lumps = n < 20 ? 1 : 3 + Math.floor(rng() * 3);
  const cy = y0 + H - W * 0.5 * (opts.squash || 0.85);
  const leafN = n - (n >= 12 ? Math.max(1, Math.round(n * 0.05)) : 0);
  for (let i = 0; i < lumps; i++) {
    const a = (i / lumps) * Math.PI * 2 + rng();
    const off = lumps === 1 ? 0 : W * 0.22;
    const lx = x + Math.cos(a) * off, lz = d + Math.sin(a) * off * 0.6;
    const ly = cy + (rng() - 0.3) * W * 0.18;
    const lr = W * (lumps === 1 ? 0.5 : 0.36 + 0.08 * rng());
    yield* blob(ctx, out, lx, ly, lz, lr, lr * (opts.squash || 0.85), lr, { n: Math.round(leafN / lumps), color: jitter(color, rng, 0.1), rng, kind, inner: 0.4 });
  }
}

// A conifer: a stack of shrinking, dark, slightly drooping tiers.
//   opts: { height, width, color, n, rng, kind }
export function* conifer(ctx, out, x, d, opts = {}) {
  out = asOut(ctx, out);
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 14, W = opts.width || H * 0.32;
  const y0 = opts.y != null ? opts.y : groundY(ctx, x, d) - 0.2;
  const n = Math.max(4, Math.round(opts.n || treeSplats(out, d, W * 1.4)));
  const color = opts.color || [0.1, 0.2, 0.13];
  const kind = opts.kind != null ? opts.kind : KIND.TREE;
  const tiers = clamp(Math.round(n / 12), 1, 7);
  for (let t = 0; t < tiers; t++) {
    const f = (t + 0.5) / tiers;                     // 0 bottom .. 1 top
    const ty = y0 + H * (0.15 + 0.8 * f);
    const tw = W * (1 - f * 0.85) * 0.5;
    yield* blob(ctx, out, x, ty, d, tw, H / tiers * 0.45, tw, { n: Math.round(n / tiers), color: mul3(color, 0.9 + 0.25 * f), rng, kind, inner: 0.45, amb: 0.55 });
  }
}

// A low bush or bramble clump sitting on the ground. opts: { color, n, rng, kind }
export function* bush(ctx, out, x, d, w, h, opts = {}) {
  out = asOut(ctx, out);
  const y = groundY(ctx, x, d) + h * 0.3;
  const n = opts.n || Math.max(3, Math.round(treeSplats(out, d, w) * 0.6));
  yield* blob(ctx, out, x, y, d, w / 2, h * 0.7, w / 2 * 0.7, { n, color: opts.color || ctx.palette.scrub || [0.2, 0.28, 0.12], rng: opts.rng, kind: opts.kind != null ? opts.kind : KIND.HEDGE, inner: 0.4 });
}

// How many splats a crown of width w at distance d deserves at this budget.
export function treeSplats(out, d, w) {
  const r = detail(out, d, 1.6);
  return clamp(Math.round((w * w * 1.6) / (r * r * 2.2)), 3, 1200 * out.density);
}

// A hedge or tree line following a path on the ground.
//   path(t) -> [x, d] (chunk-local x) for t in 0..1; len = length in metres.
//   opts: { height, width, color, n, rng, gaps (0..1), trees (per 100 m), treeColor, kind, wobbleSalt }
// Height and gaps vary along the WORLD position, so a hedge cut by a chunk border matches up.
export function* hedge(ctx, out, path, len, opts = {}) {
  out = asOut(ctx, out);
  const rng = opts.rng || ctx.rng;
  const H = opts.height || 2.2, Wd = opts.width || 1.8;
  const color = opts.color || ctx.palette.hedge || [0.15, 0.24, 0.1];
  const [pa, pb] = [path(0), path(1)];
  const d0 = path(0.5)[1];
  const r = Math.max(opts.minR || 0.15, detail(out, d0, 1.5));
  // Far away a hedge is thinner than one detail splat: keep splats no taller than the hedge and
  // stretch them along it instead (area preserved), so it stays a line rather than a band.
  const ry = Math.min(r, H * 0.42);
  const rx = Math.min(r * r / ry, r * 3);
  const yawA = Math.atan2(pb[1] - pa[1], pb[0] - pa[0]);     // direction of the path in x-z
  const qh = quatYaw(yawA);
  const n = Math.max(2, Math.round(opts.n || (len * H * 1.4) / (rx * ry * 2.4)));
  const ws = worldSeed(ctx), salt = opts.wobbleSalt || 0;
  const gaps = opts.gaps || 0;
  for (let i = 0; i < n; i++) {
    const t = (i + rng()) / n;
    const [x, d] = path(t);
    const wx = ctx.x0 + x;
    const hv = noise1(wx / 9, ws + salt) * 0.6 + noise1(wx / 37, ws + salt + 1) * 0.6;   // 0..1.2
    if (gaps && noise1(wx / 23, ws + salt + 2) < gaps * 0.6) { rng(); rng(); rng(); continue; }
    const h = H * (0.55 + 0.6 * hv);
    const v = Math.pow(rng(), 0.8);                 // a little denser toward the top, solid to the ground
    const yb = groundY(ctx, x, d);
    const dd = d + (rng() - 0.5) * Wd;
    const ny = v, nz = 0.6 * (1 - v);
    let c = shade(color, 0, ny, nz, 0.52, 0.55);
    c = jitter(mul3(c, 0.75 + 0.3 * v), rng, 0.15);
    const k = 0.8 + 0.5 * rng();
    out(x + (rng() - 0.5) * r, yb + Math.max(h * v, ry * 0.6), -dd, rx * k, ry * k * 0.9, Math.min(rx, Wd) * k, c[0], c[1], c[2], 0.95, qh[0], qh[1], qh[2], qh[3], opts.kind != null ? opts.kind : KIND.HEDGE);
    if (out.due()) yield;
  }
}

// ---------------------------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------------------------

// Fill one flat rectangle of a building with splats on a jittered grid.
// Corner at local (u0, v0) of a face, basis vectors given in world metres.
function* face(out, o, ux, uy, uz, vx, vy, vz, U, V, s, colorAt, q, kind, rng) {
  const nu = Math.max(1, Math.round(U / (s * 1.6))), nv = Math.max(1, Math.round(V / (s * 1.6)));
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = (i + 0.5 + (rng() - 0.5) * 0.3) / nu, b = (j + 0.5 + (rng() - 0.5) * 0.3) / nv;
      const c = colorAt(a, b);
      if (!c) continue;
      const px = o[0] + ux * a * U + vx * b * V, py = o[1] + uy * a * U + vy * b * V, pz = o[2] + uz * a * U + vz * b * V;
      out.q(px, py, pz, (U / nu) * 0.62, (V / nv) * 0.62, s * 0.12, c, 1, q, kind);
      if (out.due()) yield;
    }
  }
}

// A box building with a pitched roof, front facing the track (rotated by yaw).
//   x, d: centre of the footprint. opts: {
//     w (along track), depth, h (eaves height), roofH, wall, roof, yaw, windows (true/false),
//     windowColor, door, chimney, rng, s (splat size), y (base height, default: lowest ground) }
export function* house(ctx, out, x, d, opts = {}) {
  out = asOut(ctx, out);
  const rng = opts.rng || ctx.rng;
  const w = opts.w || 9, dep = opts.depth || 6, h = opts.h || 5.5, rh = opts.roofH != null ? opts.roofH : dep * 0.45;
  const yaw = opts.yaw || 0;
  const wall = opts.wall || [0.55, 0.36, 0.26], roof = opts.roof || [0.3, 0.2, 0.17];
  const s = opts.s || Math.max(0.12, detail(out, d, 1.1));
  const kind = opts.kind != null ? opts.kind : KIND.BUILDING;
  let base = opts.y;
  if (base == null) {
    base = Infinity;
    for (const [cx, cd] of [[-w / 2, -dep / 2], [w / 2, -dep / 2], [-w / 2, dep / 2], [w / 2, dep / 2]]) {
      const [rx, rz] = rotY(cx, cd, yaw);
      base = Math.min(base, groundY(ctx, x + rx, d - rz));
    }
    base -= 0.4;
  }
  const hh = h + 0.4;
  const q = quatYaw(yaw);
  // local frame: u along the front (x), n toward the camera (+z), up = y
  const [ex, ez] = rotY(1, 0, yaw);       // along front
  const [fx, fz] = rotY(0, 1, yaw);       // outward from the front (toward camera when yaw = 0)
  const P = (lx, ly, lz) => [x + ex * lx + fx * lz, base + ly, -d + ez * lx + fz * lz];
  const win = opts.windowColor || [0.12, 0.13, 0.15];
  // The three faces a passing train sees get clearly different tones, so both corners read in
  // motion: first the front with the approach-side (west, -x) end, then the front with the far
  // (east, +x) end. Plain sun shading made the west end almost the same tone as the front, and the
  // building then looked like a flat card until the train had passed it.
  const wallF = mul3(wall, 0.8);
  const wallS = mul3(wall, 0.98);     // west end: in full sun
  const wallS2 = mul3(wall, 0.56);    // east end: in shade
  const rows = Math.max(1, Math.floor(h / 2.7));
  const cols = Math.max(1, Math.floor(w / 2.6));
  const windowAt = (a, b) => {
    if (opts.windows === false) return false;
    const yy = b * hh - 0.4;
    if (yy < 0.6) return false;
    const fy = (yy - 0.6) / (h - 0.6) * rows, fxx = a * cols;
    const ix = fxx - Math.floor(fxx), iy = fy - Math.floor(fy);
    return ix > 0.32 && ix < 0.68 && iy > 0.3 && iy < 0.75;
  };
  const wj = jitter([1, 1, 1], rng, 0.05)[0];
  // front wall
  // (the top of the front wall is darkened: the shadow under the eaves)
  yield* face(out, P(-w / 2, 0, dep / 2), ex, 0, ez, 0, 1, 0, w, hh, s, (a, b) => (windowAt(a, b) ? win : mul3(wallF, wj * (0.95 + 0.1 * b) * (b > 0.9 ? 0.72 : 1))), q, kind, rng);
  // gable ends (sides), with the triangle up to the ridge
  const side = (sgn, col) => {
    const qs = quatMul(q, quatYaw(Math.PI / 2));
    return face(out, P(sgn * w / 2, 0, dep / 2), -fx, 0, -fz, 0, 1, 0, dep, hh + rh, s, (a, b) => {
      const yy = b * (hh + rh);
      if (yy > hh && Math.abs(a - 0.5) * 2 > 1 - (yy - hh) / rh) return null;   // outside the gable triangle
      // one small window high in the gable of a house, so the end wall reads as a wall
      if (opts.windows !== false && dep >= 5 && Math.abs(a - 0.5) < 0.09 && yy > hh * 0.62 && yy < hh * 0.86) return win;
      return mul3(col, wj * (0.92 + 0.12 * b));
    }, qs, kind, rng);
  };
  yield* side(-1, wallS);
  yield* side(1, wallS2);
  // A building turned away from the track shows its back to a train coming from one side. Without a
  // back wall and back roof slope you would look into an open box until the train had passed it.
  const turned = Math.cos(yaw) < 0.78;
  if (turned) {
    const wallB = mul3(wall, 0.68);
    yield* face(out, P(-w / 2, 0, -dep / 2), ex, 0, ez, 0, 1, 0, w, hh, s, (a, b) => (windowAt(a, b) ? win : mul3(wallB, wj * (0.95 + 0.1 * b) * (b > 0.9 ? 0.72 : 1))), q, kind, rng);
  }
  // roof: the front pitch, plus a strip of the back pitch showing above the ridge from below
  const pitch = Math.atan2(rh, dep / 2);
  const slopeLen = Math.hypot(rh, dep / 2) + 0.3;
  const qr = quatMul(q, quatPitch(-(Math.PI / 2 - pitch)));
  const roofF = shade(roof, 0, Math.cos(pitch), Math.sin(pitch), 0.6, 0.5);
  const ov = 0.3;   // eaves overhang
  yield* face(out, P(-w / 2 - ov, hh - 0.1, dep / 2 + 0.25), ex, 0, ez, -fx * Math.cos(pitch), Math.sin(pitch), -fz * Math.cos(pitch), w + 2 * ov, slopeLen, s,
    () => jitter(roofF, rng, 0.07), qr, kind, rng);
  if (turned) {
    const qrB = quatMul(q, quatPitch(Math.PI / 2 - pitch));
    const roofB = mul3(roof, 0.82);
    yield* face(out, P(-w / 2 - ov, hh - 0.1, -dep / 2 - 0.25), ex, 0, ez, fx * Math.cos(pitch), Math.sin(pitch), fz * Math.cos(pitch), w + 2 * ov, slopeLen, s,
      () => jitter(roofB, rng, 0.07), qrB, kind, rng);
  }
  if (opts.chimney !== false && w > 6 && rng() < 0.8) {
    const cxl = (rng() < 0.5 ? -1 : 1) * (w / 2 - 0.8);
    const col = shade(opts.chimneyColor || wall, 0, 0.3, 1, 0.6, 0.5);
    const [px, py, pz] = P(cxl, hh + rh * 0.6, 0);
    const cs = Math.max(0.3, s);
    for (let k = 0; k < 4; k++) out(px, py + k * 0.45, pz, cs, 0.3, cs, col[0], col[1], col[2], 1, q[0], q[1], q[2], q[3], kind);
  }
}

// A square tower (church, castle, folly). opts: { w, h, color, rng, spire (height or 0), battlements, s, yaw }
export function* tower(ctx, out, x, d, opts = {}) {
  out = asOut(ctx, out);
  const rng = opts.rng || ctx.rng;
  const w = opts.w || 5, h = opts.h || 18, col = opts.color || [0.56, 0.53, 0.46];
  const s = opts.s || Math.max(0.12, detail(out, d, 1.1));
  const kind = opts.kind != null ? opts.kind : KIND.BUILDING;
  const base = (opts.y != null ? opts.y : groundY(ctx, x, d)) - 0.4;
  const yaw = opts.yaw || 0, q = quatYaw(yaw);
  const [ex, ez] = rotY(1, 0, yaw), [fx, fz] = rotY(0, 1, yaw);
  const P = (lx, ly, lz) => [x + ex * lx + fx * lz, base + ly, -d + ez * lx + fz * lz];
  // as for house(): three clearly different tones, so both corners read from a passing train
  const front = mul3(col, 0.8), sideL = mul3(col, 0.98), sideR = mul3(col, 0.56);
  const slit = (a, b) => Math.abs(a - 0.5) < 0.08 && ((b > 0.62 && b < 0.72) || (b > 0.82 && b < 0.9));
  yield* face(out, P(-w / 2, 0, w / 2), ex, 0, ez, 0, 1, 0, w, h, s, (a, b) => (slit(a, b) ? [0.1, 0.1, 0.11] : jitter(front, rng, 0.05)), q, kind, rng);
  const qs = quatMul(q, quatYaw(Math.PI / 2));
  yield* face(out, P(-w / 2, 0, w / 2), -fx, 0, -fz, 0, 1, 0, w, h, s, () => jitter(sideL, rng, 0.05), qs, kind, rng);
  yield* face(out, P(w / 2, 0, w / 2), -fx, 0, -fz, 0, 1, 0, w, h, s, () => jitter(sideR, rng, 0.05), qs, kind, rng);
  if (opts.battlements !== false && !opts.spire) {
    for (let i = 0; i < 4; i++) {
      const [px, py, pz] = P(-w / 2 + (i + 0.5) * w / 4, h + 0.5, w / 2);
      out(px, py, pz, w / 10, 0.45, 0.2, front[0], front[1], front[2], 1, q[0], q[1], q[2], q[3], kind);
    }
  }
  if (opts.spire) {
    const sh = opts.spire, sc = opts.spireColor || [0.36, 0.37, 0.39];
    const n = Math.max(6, Math.round(sh / (s * 1.5)) * 3);
    for (let i = 0; i < n; i++) {
      const f = Math.pow(rng(), 0.8), r = (w / 2) * (1 - f) * 0.95;
      const a = (rng() - 0.5) * Math.PI;
      const [px, py, pz] = P(Math.sin(a) * r, h + f * sh, Math.cos(a) * r);
      const c = shade(sc, Math.sin(a), 0.4, Math.cos(a), 0.6, 0.5);
      out(px, py, pz, s * 0.9 * (1 - f * 0.6) + 0.05, s, s * 0.6, c[0], c[1], c[2], 1, 0, 0, 0, 1, kind);
      if (out.due()) yield;
    }
  }
}

// A village church: nave with a steep roof and a west tower. opts as house()/tower() plus { spire }
export function* church(ctx, out, x, d, opts = {}) {
  out = asOut(ctx, out);
  const rng = opts.rng || ctx.rng;
  const stone = opts.color || [0.56, 0.53, 0.46];
  const yaw = opts.yaw || 0;
  const [tx, tz] = rotY(-8.5, 0, yaw);
  yield* house(ctx, out, x + 2, d, { w: 14, depth: 7, h: 6.5, roofH: 4.5, wall: stone, roof: opts.roof || [0.32, 0.31, 0.32], windows: false, chimney: false, rng, yaw, s: opts.s });
  yield* tower(ctx, out, x + tx, d - tz, { w: 5.2, h: opts.h || 17, color: mul3(stone, 0.97), rng, spire: opts.spire || 0, yaw, s: opts.s });
}

// ---------------------------------------------------------------------------------------------
// Railway furniture
// ---------------------------------------------------------------------------------------------

// One overhead-line mast: a steel post on a concrete base, with a short arm toward the track.
//   opts: { height (default 7.5), color, kind }
export function* mast(ctx, out, x, d, opts = {}) {
  out = asOut(ctx, out);
  const H = opts.height || 7.5;
  const col = opts.color || [0.42, 0.44, 0.45];
  const y0 = Math.min(groundY(ctx, x, d), 0.1) - 0.3;
  // concrete foundation
  out(x, y0 + 0.35, -d, 0.32, 0.25, 0.3, 0.5, 0.49, 0.46, 1, 0, 0, 0, 1, KIND.MAST);
  // the post as two flanges of an H section: the camera-facing one lit a little less
  const seg = 0.3;
  for (let t = 0.3; t < H; t += seg) {
    const k = 0.85 + 0.2 * (t / H);
    out(x, y0 + t, -d, 0.11, seg * 0.62, 0.07, col[0] * k, col[1] * k, col[2] * k, 1, 0, 0, 0, 1, KIND.MAST);
    out(x, y0 + t, -(d + 0.16), 0.11, seg * 0.62, 0.05, col[0] * k * 0.8, col[1] * k * 0.8, col[2] * k * 0.8, 1, 0, 0, 0, 1, KIND.MAST);
  }
  // the cantilever arm toward the track (mostly above the window), stopping short of 2.5 m
  const armY = y0 + H - 0.6;
  for (let dd = d - 0.2; dd > 2.6; dd -= 0.35) out(x, armY, -dd, 0.05, 0.05, 0.2, col[0] * 0.8, col[1] * 0.8, col[2] * 0.8, 1, 0, 0, 0, 1, KIND.MAST);
  // insulators where the field-side wires hang
  for (const wy of opts.wireYs || []) out(x, wy + 0.1, -(d + 0.25), 0.05, 0.14, 0.05, 0.55, 0.42, 0.3, 1, 0, 0, 0, 1, KIND.MAST);
  if (out.due()) yield;
}

// Wires hung between supports every `span` metres of WORLD x (phase 0 at world x = 0), so they meet
// up across chunks. Each wire: { d, y (at the supports), sag, r (radius), color }.
export function* wires(ctx, out, span, list, opts = {}) {
  out = asOut(ctx, out);
  const step = opts.step || 0.4;
  for (const w of list) {
    const r = w.r || 0.012, col = w.color || [0.18, 0.17, 0.16];
    for (let x = step / 2; x < ctx.length; x += step) {
      const wx = ctx.x0 + x;
      const u = wx / span - Math.floor(wx / span);
      const y = w.y - w.sag * 4 * u * (1 - u);
      const slope = -w.sag * 4 * (1 - 2 * u) / span;
      const q = quatRoll(Math.atan(slope));
      out(x, y, -w.d, step * 0.65, r, r, col[0], col[1], col[2], w.opacity || 1, q[0], q[1], q[2], q[3], KIND.WIRE);
      if (out.due()) yield;
    }
  }
}

// Overhead line equipment along the chunk: masts every `beat` metres of world x and the field-side
// wires between them. opts: { d (mast distance, default 4.0), wires: [{ y, sag, dz }], height }
export function* overheadLine(ctx, out, beat, opts = {}) {
  out = asOut(ctx, out);
  const d = opts.d || 4.0;
  const ws = opts.wires || [{ y: 4.55, sag: 0.45, dz: 0.25 }, { y: 4.0, sag: 0.3, dz: 0.25 }];
  const first = Math.ceil(ctx.x0 / beat), last = Math.floor((ctx.x0 + ctx.length) / beat);
  for (let k = first; k <= last; k++) yield* mast(ctx, out, k * beat - ctx.x0, d, { height: opts.height, wireYs: ws.map((w) => w.y) });
  yield* wires(ctx, out, beat, ws.map((w) => ({ d: d + (w.dz || 0), y: w.y, sag: w.sag, r: w.r || 0.013 })));
}

// A post-and-wire fence following the terrain at distance d: posts every `spacing` m of world x.
//   opts: { height, strands, postColor, wireColor, lean }
export function* fence(ctx, out, d, opts = {}) {
  out = asOut(ctx, out);
  const spacing = opts.spacing || 2.8, H = opts.height || 1.15, strands = opts.strands || 3;
  const pc = opts.postColor || [0.3, 0.25, 0.19], wc = opts.wireColor || [0.32, 0.32, 0.3];
  for (const { i, x } of cellsAround(ctx, spacing, 0)) {
    const h = worldHash(ctx, 41, i);
    const px = x + (h - 0.5) * 0.3, y0 = groundY(ctx, px, d);
    for (let t = 0.1; t < H; t += 0.22) {
      const k = 0.85 + 0.25 * (t / H);
      out(px, y0 + t, -d, 0.045, 0.13, 0.045, pc[0] * k, pc[1] * k, pc[2] * k, 1, 0, 0, 0, 1, KIND.FENCE);
    }
    if (out.due()) yield;
  }
  const step = 0.35 / Math.min(1, Math.sqrt(out.density));
  for (let s = 0; s < strands; s++) {
    const fy = 0.3 + (H - 0.35) * (s + 0.5) / strands;
    for (let x = step / 2; x < ctx.length; x += step) {
      const y = groundY(ctx, x, d) + fy;
      out(x, y, -d, step * 0.65, 0.008, 0.008, wc[0], wc[1], wc[2], 0.9, 0, 0, 0, 1, KIND.FENCE);
      if (out.due()) yield;
    }
  }
}

// A lamp: a bright core (ignores the time-of-day tint) and a soft halo.
//   color should have a channel >= 0.97 to count as a light. opts: { size, halo (0..1) }
export function* lamp(ctx, out, x, y, d, color = [1, 0.85, 0.55], opts = {}) {
  out = asOut(ctx, out);
  const s = opts.size || 0.08;
  out(x, y, -d, s, s, s, color[0], color[1], color[2], 1, 0, 0, 0, 1, KIND.LIGHT);
  if (opts.halo !== 0) out(x, y, -(d + 0.05), s * 5, s * 5, s * 2, color[0], color[1], color[2], 0.18 * (opts.halo || 1), 0, 0, 0, 1, KIND.LIGHT);
  if (out.due()) yield;
}

// A rock or boulder: a lumpy grey blob half buried. opts: { color, n, rng }
export function* rock(ctx, out, x, d, r, opts = {}) {
  out = asOut(ctx, out);
  const y = groundY(ctx, x, d) + r * 0.25;
  yield* blob(ctx, out, x, y, d, r, r * 0.65, r * 0.9, { n: opts.n || Math.max(3, Math.round(treeSplats(out, d, r * 2) * 0.5)), color: opts.color || ctx.palette.rock || [0.45, 0.44, 0.42], rng: opts.rng, kind: KIND.ROCK, inner: 0.25, amb: 0.55 });
}

// ---------------------------------------------------------------------------------------------
// Surreal pieces (gate them on ctx.dials so level 0 never shows them)
// ---------------------------------------------------------------------------------------------

// A floating island: a grassy, gently domed top over a tapering root of earth and chalk.
//   x, y (height of the top surface), d, r (radius). opts: { n, top, earth, rng, trees (count), treeColor }
export function* floatingIsland(ctx, out, x, y, d, r, opts = {}) {
  out = asOut(ctx, out);
  const rng = opts.rng || ctx.rng;
  const n = Math.max(30, Math.round(opts.n || 600));
  const top = opts.top || [0.34, 0.48, 0.2], earth = opts.earth || [0.34, 0.25, 0.18], chalk = opts.chalk || [0.66, 0.64, 0.57];
  const depth = r * (1.0 + 0.6 * rng());
  // Seen from rail level the top surface is hidden: what reads is a green rim, the trees on top and
  // the underside of earth and chalk. Most splats go there.
  const rimN = Math.round(n * 0.3), rootN = Math.round(n * 0.5), topN = n - rimN - rootN;
  const lump = (a) => 1 + 0.18 * Math.sin(a * 3 + r) + 0.1 * Math.sin(a * 5 + 1.3 * r);
  const sTop = Math.sqrt((Math.PI * r * r) / Math.max(1, topN)) * 0.9;
  for (let i = 0; i < topN; i++) {
    const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * r * lump(a);
    const px = x + Math.cos(a) * rr, pd = d + Math.sin(a) * rr * 0.8;
    const py = y + r * 0.06 * (1 - (rr / r) ** 2);
    const c = jitter(shade(top, 0, 1, 0.2, 0.7, 0.4), rng, 0.12);
    out(px, py, -pd, sTop, sTop * 0.2, sTop, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.SURREAL);
    if (out.due()) yield;
  }
  // the rim: turf and grass hanging over the edge, camera side first
  const sRim = Math.max(r * 0.05, Math.sqrt((2 * Math.PI * r * r * 0.15) / Math.max(1, rimN)));
  for (let i = 0; i < rimN; i++) {
    const a = (rng() < 0.75 ? (rng() - 0.5) * Math.PI * 1.2 + Math.PI / 2 : rng() * Math.PI * 2);
    const rr = r * lump(a) * (0.97 + 0.05 * rng());
    const px = x + Math.cos(a) * rr, pd = d - Math.sin(a) * rr * 0.8;
    const py = y - rng() * r * 0.12;
    const c = jitter(shade(mix3(top, [0.24, 0.34, 0.14], rng()), Math.cos(a) * 0.5, 0.3, Math.sin(a), 0.62, 0.5), rng, 0.12);
    out(px, py, -pd, sRim, sRim * 0.8, sRim * 0.7, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.SURREAL);
    if (out.due()) yield;
  }
  const sRoot = Math.sqrt((Math.PI * r * depth) / Math.max(1, rootN)) * 0.95;
  for (let i = 0; i < rootN; i++) {
    const f = Math.pow(rng(), 0.75);                 // 0 at the rim, 1 at the tip
    const a = (rng() - 0.5) * Math.PI * 1.3 + Math.PI / 2;   // camera-facing half
    const rr = r * lump(a) * Math.pow(1 - f, 0.8) * (0.9 + 0.1 * rng());
    const px = x + Math.cos(a) * rr, pd = d - Math.sin(a) * rr * 0.8;
    const py = y - 0.1 * r - f * depth;
    const band = Math.sin(f * 26 + Math.sin(a * 1.3) * 0.6) > 0.8 ? 1 : 0;   // thin chalk strata
    let c = band ? chalk : earth;
    c = shade(c, Math.cos(a) * 0.6, -0.4, Math.sin(a), 0.6, 0.3);
    c = jitter(mul3(c, 1 - 0.3 * f), rng, 0.1);
    out(px, py, -pd, sRoot, sRoot * 0.7, sRoot * 0.6, c[0], c[1], c[2], 1, 0, 0, 0, 1, KIND.SURREAL);
    if (out.due()) yield;
  }
  const trees = opts.trees != null ? opts.trees : 1 + Math.floor(rng() * 3);
  for (let t = 0; t < trees; t++) {
    const a = rng() * Math.PI * 2, rr = Math.sqrt(rng()) * r * 0.6;
    const th = r * (0.3 + 0.2 * rng());
    yield* broadleaf(ctx, out, x + Math.cos(a) * rr, d + Math.sin(a) * rr * 0.6, { y: y - 0.1, height: th, n: Math.round(n * 0.15), color: opts.treeColor, rng, kind: KIND.SURREAL });
  }
}

// A tall slab standing on the ground: a monolith. opts: { w, h, thick, color, rng, n, yaw }
export function* monolith(ctx, out, x, d, opts = {}) {
  out = asOut(ctx, out);
  const rng = opts.rng || ctx.rng;
  const w = opts.w || 40, h = opts.h || 200, col = opts.color || [0.1, 0.1, 0.11];
  const s = Math.max(Math.sqrt((w * h) / (opts.n || 300)) * 0.8, 0.5);
  const base = groundY(ctx, x, d) - h * 0.05;
  const q = quatYaw(opts.yaw || 0);
  yield* face(out, [x - w / 2, base, -d], 1, 0, 0, 0, 1, 0, w, h * 1.05, s, (a, b) => {
    const c = shade(col, 0, 0.1, 1, 0.75, 0.3);
    return mul3(c, 0.9 + 0.25 * b);
  }, q, KIND.SURREAL, rng);
}
