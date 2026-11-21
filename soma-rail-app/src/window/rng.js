// Small deterministic random helpers. Everything the world generator does goes through these,
// so a chunk is a pure function of (seed, layer, index).
export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function hashInts(...ints) {
  let h = 0x9e3779b9;
  for (const n of ints) {
    h ^= (n | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
    h ^= h >>> 15;
  }
  return h >>> 0;
}

export function makeRng(seed) {
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
  next.gauss = () => { // approx normal, mean 0 sd 1
    return (next() + next() + next() + next() - 2) * 1.732;
  };
  return next;
}

// Value noise in 1D and 2D, smooth and cheap; used for terrain.
function fade(t) { return t * t * (3 - 2 * t); }
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const a = hashInts(i, seed) / 4294967296, b = hashInts(i + 1, seed) / 4294967296;
  return a + (b - a) * fade(f);
}
export function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const h = (i, j) => hashInts(i, j, seed) / 4294967296;
  const a = h(ix, iy), b = h(ix + 1, iy), c = h(ix, iy + 1), d = h(ix + 1, iy + 1);
  const u = fade(fx), v = fade(fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm2(x, y, seed = 0, octaves = 4) {
  let amp = 0.5, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) { sum += amp * noise2(x, y, seed + o * 101); norm += amp; x *= 2.03; y *= 2.03; amp *= 0.5; }
  return sum / norm;
}
