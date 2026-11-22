// Proves src/window/rng.js still returns exactly what it always has:  node scripts/check-rng.mjs
//
// Every biome's layout is a pure function of these hashes, so one changed value rearranges every
// world. This file keeps the ORIGINAL implementation (rest-argument hashInts, noise built on it)
// as the reference and compares it with the module, value for value (Object.is, so -0 and NaN
// count), over a few hundred thousand random inputs:
//   - hashInts with 0 to 8 arguments, called directly and through a spread
//   - noise1, noise2, fbm2 with and without a seed, and fbm2 with 0 to 8 octaves
//   - makeRng: the raw stream and range / int / pick / gauss
// Inputs cover small, negative, full 32-bit and larger-than-32-bit integers, fractions, and the
// odd values a caller could pass (-0, NaN, Infinity, undefined). The loops are long enough that
// the comparison runs in the engine's optimised code as well as its interpreter.
// Exits non-zero on any difference. Do not "fix" the reference below to make this pass.
import { hashInts, noise1, noise2, fbm2, makeRng } from '../src/window/rng.js';

// ---- reference: rng.js as first written -------------------------------------------------------
function oldHashInts(...ints) {
  let h = 0x9e3779b9;
  for (const n of ints) {
    h ^= (n | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
  }
  return h >>> 0;
}
function oldMakeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * next());
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.gauss = () => (next() + next() + next() + next() - 2) * 1.732;
  return next;
}
function oldFade(t) { return t * t * (3 - 2 * t); }
function oldNoise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const a = oldHashInts(i, seed) / 4294967296, b = oldHashInts(i + 1, seed) / 4294967296;
  return a + (b - a) * oldFade(f);
}
function oldNoise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const h = (i, j) => oldHashInts(i, j, seed) / 4294967296;
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  const u = oldFade(fx), v = oldFade(fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function oldFbm2(x, y, seed = 0, octaves = 4) {
  let amp = 0.5, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) { sum += amp * oldNoise2(x, y, seed + o * 101); norm += amp; x *= 2.03; y *= 2.03; amp *= 0.5; }
  return sum / norm;
}

// ---- inputs: a private generator, so this file does not lean on the code under test -----------
let s0 = 0x1234abcd, s1 = 0x9e3779b9;
function u32() {                                  // xorshift64 in two halves
  let a = s0, b = s1;
  s0 = b;
  a ^= a << 23; a ^= a >>> 17; a ^= b ^ (b >>> 26);
  s1 = a;
  return (a + b) >>> 0;
}
const unit = () => u32() / 4294967296;
const EDGE_INTS = [
  0, -0, 1, -1, 2, -2, 255, 256, 65535, 65536, 0x7fffffff, 0x80000000, -0x80000000, -0x80000001,
  0xffffffff, 0x100000000, 0x100000001, -0xffffffff, 2 ** 40, -(2 ** 40), 2 ** 53 - 1, -(2 ** 53 - 1),
  2 ** 53, 2 ** 60, 1e21, -1e21, 0.5, -0.5, 1.5, -1.5, 2147483647.9, -2147483648.9, 4294967295.5,
  NaN, Infinity, -Infinity, undefined,
];
function anInt() {
  const k = u32() % 10;
  if (k === 0) return EDGE_INTS[u32() % EDGE_INTS.length];
  if (k <= 3) return (u32() % 2001) - 1000;                             // small, either sign
  if (k <= 5) return u32() | 0;                                         // any int32
  if (k === 6) return u32();                                            // any uint32
  if (k === 7) return (u32() - 0x80000000) * (u32() % 0x200000);        // large, up to 2^52, either sign
  if (k === 8) return u32() + (u32() % 2000);                           // a world seed plus a salt, past 2^32
  return (unit() - 0.5) * 2 ** (u32() % 40);                            // not an integer at all
}
const EDGE_COORDS = [0, -0, 1, -1, 0.5, -0.5, 1 - 2 ** -53, -(2 ** -1074), 2 ** 31 - 0.5, -(2 ** 31) - 0.5, 2 ** 32, 1e15, -1e15, 2 ** 53, 1e300, NaN, Infinity, -Infinity];
function aCoord() {
  const k = u32() % 12;
  if (k === 0) return EDGE_COORDS[u32() % EDGE_COORDS.length];
  if (k === 1) return (u32() % 2001) - 1000;                            // exactly on a lattice point
  if (k <= 5) return (unit() - 0.5) * 200;                              // what terrain and biomes use
  if (k <= 8) return (unit() - 0.5) * 2e5;
  if (k <= 10) return (unit() - 0.5) * 2 ** 33;                         // across the 32-bit wrap
  return (unit() - 0.5) * 2 ** (u32() % 70);
}

let checks = 0, failures = 0;
const show = (v) => (Object.is(v, -0) ? '-0' : String(v));
function same(what, got, want, args) {
  checks++;
  if (Object.is(got, want)) return;
  failures++;
  if (failures <= 40) console.log(`FAIL ${what}(${args.map(show).join(', ')}): got ${show(got)}, was ${show(want)}`);
}

// ---- hashInts --------------------------------------------------------------------------------
for (let n = 0; n <= 8; n++) {
  for (let k = 0; k < 40000; k++) {
    const v = [];
    for (let i = 0; i < n; i++) v.push(anInt());
    const want = oldHashInts(...v);
    same('hashInts', hashInts(...v), want, v);              // through a spread, as kit.js calls it
    let got;                                                // and directly, as everything else does
    switch (n) {
      case 0: got = hashInts(); break;
      case 1: got = hashInts(v[0]); break;
      case 2: got = hashInts(v[0], v[1]); break;
      case 3: got = hashInts(v[0], v[1], v[2]); break;
      case 4: got = hashInts(v[0], v[1], v[2], v[3]); break;
      case 5: got = hashInts(v[0], v[1], v[2], v[3], v[4]); break;
      case 6: got = hashInts(v[0], v[1], v[2], v[3], v[4], v[5]); break;
      case 7: got = hashInts(v[0], v[1], v[2], v[3], v[4], v[5], v[6]); break;
      default: got = hashInts(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7]);
    }
    same('hashInts', got, want, v);
  }
}
// every edge value in every position of a one-, two- and three-argument call
for (const a of EDGE_INTS) {
  same('hashInts', hashInts(a), oldHashInts(a), [a]);
  for (const b of EDGE_INTS) {
    same('hashInts', hashInts(a, b), oldHashInts(a, b), [a, b]);
    for (const c of EDGE_INTS) same('hashInts', hashInts(a, b, c), oldHashInts(a, b, c), [a, b, c]);
  }
}

// ---- noise1, noise2, fbm2 --------------------------------------------------------------------
for (let k = 0; k < 150000; k++) {
  const x = aCoord(), seed = anInt();
  same('noise1', noise1(x, seed), oldNoise1(x, seed), [x, seed]);
  if (k % 4 === 0) same('noise1', noise1(x), oldNoise1(x), [x]);
}
for (let k = 0; k < 200000; k++) {
  const x = aCoord(), y = aCoord(), seed = anInt();
  same('noise2', noise2(x, y, seed), oldNoise2(x, y, seed), [x, y, seed]);
  if (k % 4 === 0) same('noise2', noise2(x, y), oldNoise2(x, y), [x, y]);
}
for (let k = 0; k < 60000; k++) {
  const x = aCoord(), y = aCoord(), seed = anInt(), oct = u32() % 9;
  same('fbm2', fbm2(x, y, seed), oldFbm2(x, y, seed), [x, y, seed]);
  same('fbm2', fbm2(x, y, seed, oct), oldFbm2(x, y, seed, oct), [x, y, seed, oct]);
  if (k % 4 === 0) same('fbm2', fbm2(x, y), oldFbm2(x, y), [x, y]);
}

// ---- makeRng ---------------------------------------------------------------------------------
const LIST = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
for (let k = 0; k < 60; k++) {
  const seed = k < EDGE_INTS.length ? EDGE_INTS[k] : anInt();
  const a = makeRng(seed), b = oldMakeRng(seed);
  for (let i = 0; i < 2000; i++) same('makeRng', a(), b(), [seed]);
  for (let i = 0; i < 500; i++) {
    const lo = (unit() - 0.5) * 100, hi = lo + unit() * 100;
    same('makeRng.range', a.range(lo, hi), b.range(lo, hi), [seed, lo, hi]);
    same('makeRng.int', a.int(-3, 12), b.int(-3, 12), [seed]);
    same('makeRng.pick', a.pick(LIST), b.pick(LIST), [seed]);
    same('makeRng.gauss', a.gauss(), b.gauss(), [seed]);
  }
  same('makeRng', a(), b(), [seed]);                        // still in step after the helpers
}
// the way engine.js seeds a chunk: makeRng(hashInts(seed, layer, index))
for (let k = 0; k < 2000; k++) {
  const seed = u32(), layer = u32() % 2000, index = (u32() % 400) - 200;
  const a = makeRng(hashInts(seed, layer, index)), b = oldMakeRng(oldHashInts(seed, layer, index));
  for (let i = 0; i < 50; i++) same('makeRng(hashInts)', a(), b(), [seed, layer, index]);
}

console.log(`${checks} comparisons, ${failures} failures`);
process.exit(failures ? 1 : 0);
