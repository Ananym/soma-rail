// Small deterministic random helpers. Everything the world generator does goes through these,
// so a chunk is a pure function of (seed, layer, index).
export function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// hashInts(...ints) folds any number of integers into one unsigned 32-bit hash: start from H0 and
// apply mix() once per argument, in order. It takes five named parameters and reads
// arguments.length, where it used to take a rest parameter, so that a call builds no array. Up to
// five arguments take the unrolled path; more take the loop.
// The arithmetic is the layout of every world: changing a single output value rearranges all of
// them. scripts/check-rng.mjs keeps the original rest-argument form and compares.
const H0 = 0x9e3779b9;
function mix(h, n) {
  h ^= (n | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return h ^ (h >>> 15);
}
export function hashInts(a, b, c, d, e) {
  const n = arguments.length;
  let h = H0;
  if (n > 5) {
    for (let i = 0; i < n; i++) h = mix(h, arguments[i]);
    return h >>> 0;
  }
  if (n > 0) {
    h = mix(h, a);
    if (n > 1) {
      h = mix(h, b);
      if (n > 2) {
        h = mix(h, c);
        if (n > 3) {
          h = mix(h, d);
          if (n > 4) h = mix(h, e);
        }
      }
    }
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

// Value noise in 1D and 2D, smooth and cheap; used for terrain. The lattice values are
// hashInts(i, seed) and hashInts(ix, iy, seed) scaled to 0..1, written out as mix() rounds so
// that nothing is allocated; in 2D the round for each column is shared by its two rows.
function fade(t) { return t * t * (3 - 2 * t); }
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const a = (mix(mix(H0, i), seed) >>> 0) / 4294967296, b = (mix(mix(H0, i + 1), seed) >>> 0) / 4294967296;
  return a + (b - a) * fade(f);
}
export function noise2(x, y, seed = 0) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const h0 = mix(H0, ix), h1 = mix(H0, ix + 1);
  const a = (mix(mix(h0, iy), seed) >>> 0) / 4294967296, b = (mix(mix(h1, iy), seed) >>> 0) / 4294967296;
  const c = (mix(mix(h0, iy + 1), seed) >>> 0) / 4294967296, d = (mix(mix(h1, iy + 1), seed) >>> 0) / 4294967296;
  const u = fade(fx), v = fade(fy);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm2(x, y, seed = 0, octaves = 4) {
  let amp = 0.5, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) { sum += amp * noise2(x, y, seed + o * 101); norm += amp; x *= 2.03; y *= 2.03; amp *= 0.5; }
  return sum / norm;
}
