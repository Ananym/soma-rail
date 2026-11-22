// Checks every registered biome's generators without a browser:  node scripts/check-biomes.mjs [-v]
//
// For each biome, band, a few chunk indices, seeds, surreal levels and budgets it runs the generator
// the way engine.js does (same ctx fields, same rng seeding) and asserts:
//   - deterministic: the same (seed, layer, index) gives identical splats
//   - splat count within 10% of ctx.count, and a yield at least every 1000 splats
//   - all numbers finite; x within [-5, length + 5]; distance within the band (small margin)
//   - no opaque splat nearer than 2.3 m; colours within 0..1, and nothing between 0.8 and 0.97
//     (natural colours stay <= 0.8, lights are >= 0.97)
//   - trackside: within 6 m of the track, nothing but masts, wires and trees (kit.js KIND tags)
//     rises above 1.6 m
//   - level 0 emits nothing tagged KIND.SURREAL (the dials are all 0 there)
// Exits non-zero on any failure. The ctx construction mirrors engine.js startChunk(); keep in step.
import { BIOMES } from '../src/window/biomes/index.js';
import { LAYERS, expectedActive, shareOf } from '../src/window/layers.js';
import { makeTerrain } from '../src/window/terrain.js';
import { hashInts, hashString, makeRng } from '../src/window/rng.js';
import { LEVELS } from '../src/window/director.js';
import { KIND } from '../src/window/biomes/kit.js';

const verbose = process.argv.includes('-v');
const LEAD = 60;                                            // engine.js
const TAN_H = Math.tan((50 * Math.PI) / 360) * (16 / 9);    // 50° vertical FOV at 16:9
const countFor = (layer, budget, biome) => Math.max(200, Math.round((budget * shareOf(layer, biome)) / expectedActive(layer, TAN_H, LEAD)));

const ALLOWED_HIGH = new Set([KIND.MAST, KIND.WIRE, KIND.TREE]);
const SEEDS = ['7', 'downs-check'];
const INDICES = [-1, 0, 3, 41];
const BUDGETS = [150000, 600000, 2400000];

function run(biome, layer, seedStr, level, index, budget, beatMetres = 56, hour = 12) {
  const seed = hashString(seedStr);
  const terrain = makeTerrain(seed, biome.terrain);
  const splats = [];
  let since = 0, maxSince = 0;
  const emit = (x, y, z, sx, sy, sz, r, g, b, opacity = 1, qx = 0, qy = 0, qz = 0, qw = 1, kind = -1) => {
    splats.push([x, y, z, sx, sy, sz, r, g, b, opacity, qx, qy, qz, qw, kind]);
    since++;
  };
  const ctx = {
    rng: makeRng(hashInts(seed, layer.name.length * 131 + layer.name.charCodeAt(0), index)),
    x0: index * layer.chunkLen, length: layer.chunkLen, zNear: layer.zNear, zFar: layer.zFar,
    count: countFor(layer, budget, biome), index, terrain, palette: biome.palette, dials: { ...LEVELS[level] },
    level, beatMetres, layer: layer.name, seed, hour,
  };
  const gen = (biome.generators[layer.name] || biome.generators.near)(ctx, emit);
  const t0 = performance.now();
  for (;;) {
    const r = gen.next();
    maxSince = Math.max(maxSince, since); since = 0;
    if (r.done) break;
  }
  return { splats, ctx, maxSince, ms: performance.now() - t0 };
}

let failures = 0, runs = 0;
const fail = (what, msg) => { failures++; if (failures <= 60) console.log(`FAIL ${what}: ${msg}`); };

// A biome's backdrop (see engine.js): the right number of splats, finite values, natural colours
// capped, regular yields, and the same splats every time.
function runBackdrop(biome, seedStr, level, budget) {
  const B = biome.backdrop, seed = hashString(seedStr), splats = [];
  let since = 0, maxSince = 0;
  const emit = (...a) => { splats.push(a); since++; };
  const ctx = {
    rng: makeRng(hashInts(seed, 7717)), x0: B.x0, length: B.length, zNear: B.zNear, zFar: B.zFar, count: Math.max(200, Math.round(budget * (B.share || 0.1))), index: 0,
    terrain: makeTerrain(seed, biome.terrain), palette: biome.palette, dials: { ...LEVELS[level] }, level, beatMetres: 56, layer: 'backdrop', seed, hour: 12,
  };
  const gen = B.generate(ctx, emit);
  for (;;) { const r = gen.next(); maxSince = Math.max(maxSince, since); since = 0; if (r.done) break; }
  return { splats, ctx, maxSince };
}
function checkBackdrop(name, biome) {
  for (const seedStr of SEEDS) for (const level of [0, 1]) for (const budget of BUDGETS) {
    runs++;
    const what = `${name} backdrop seed=${seedStr} level=${level} budget=${budget}`;
    const a = runBackdrop(biome, seedStr, level, budget), n = a.splats.length, want = a.ctx.count;
    if (n < want * 0.8 || n > want * 1.2) fail(what, `${n} splats for a count of ${want}`);
    if (a.maxSince > 1500) fail(what, `${a.maxSince} splats without a yield`);
    for (const sp of a.splats) {
      if (!sp.slice(0, 10).every(Number.isFinite)) { fail(what, 'a value is not finite'); break; }
      if (sp[14] !== KIND.LIGHT && Math.max(sp[6], sp[7], sp[8]) > 0.8001) { fail(what, 'a natural colour above 0.8'); break; }
    }
    const b = runBackdrop(biome, seedStr, level, budget).splats;
    if (b.length !== n || b.some((sp, i) => sp[0] !== a.splats[i][0] || sp[1] !== a.splats[i][1])) fail(what, 'not the same twice');
    for (const t of [0, 5000, 90000]) { const p = biome.backdrop.pose(t, a.ctx.seed, 0.83); if (!Number.isFinite(p.x) || !Number.isFinite(p.yaw)) fail(what, 'pose not finite'); }
  }
}

for (const [name, biome] of Object.entries(BIOMES)) {
  if (biome.backdrop) checkBackdrop(name, biome);
  const timing = {};
  for (const layer of LAYERS) {
    for (const seedStr of SEEDS) {
      for (const level of [0, 1]) {
        for (const index of INDICES) {
          for (const budget of BUDGETS) {
            // keep it quick: every combination at the default budget, the extremes on fewer chunks
            if (budget !== 600000 && index !== 0 && index !== -1) continue;
            const what = `${name}/${layer.name} seed=${seedStr} level=${level} index=${index} budget=${budget}`;
            // one odd mast spacing per combination set, as the music would give
            const beat = index === 3 ? 47.3 : 56;
            // day on most chunks, night on two, so lit windows and lamps are exercised as well
            const hour = index === 41 ? 22 : index === -1 ? 1 : 12;
            const a = run(biome, layer, seedStr, level, index, budget, beat, hour);
            runs++;
            const { splats, ctx, maxSince, ms } = a;
            (timing[layer.name] ||= []).push(ms / Math.max(1, splats.length) * 1000);
            const n = splats.length;
            if (Math.abs(n - ctx.count) > 0.1 * ctx.count) fail(what, `count ${n} vs target ${ctx.count}`);
            if (maxSince > 1000) fail(what, `${maxSince} splats between yields`);
            const m = 0.05 * layer.zFar;
            let bad = 0;
            for (const s of splats) {
              const [x, y, z, sx, sy, sz, r, g, b, o] = s;
              const d = -z;
              const problem =
                !s.slice(0, 14).every(Number.isFinite) ? 'non-finite value'
                : x < -5 || x > ctx.length + 5 ? `x ${x.toFixed(2)} outside chunk`
                : d < layer.zNear - m || d > layer.zFar + m ? `distance ${d.toFixed(1)} outside band`
                : o >= 0.5 && d < 2.3 ? `opaque splat at ${d.toFixed(2)} m`
                : [r, g, b, o].some((v) => v < 0 || v > 1) ? `colour/opacity out of 0..1 (${r}, ${g}, ${b}, ${o})`
                : Math.max(r, g, b) > 0.8 + 1e-6 && Math.max(r, g, b) < 0.97 ? `colour ${Math.max(r, g, b).toFixed(3)} between natural and light`
                : sx <= 0 || sy <= 0 || sz <= 0 ? 'non-positive scale'
                : level === 0 && s[14] === KIND.SURREAL ? 'surreal splat at level 0'
                : layer.name === 'trackside' && d < 6 && y > 1.6 && !ALLOWED_HIGH.has(s[14]) ? `kind ${s[14]} at y=${y.toFixed(2)} d=${d.toFixed(2)} (only masts, wires, trees may rise above 1.6 m within 6 m)`
                : null;
              if (problem) { if (bad++ < 3) fail(what, problem); }
            }
            // determinism (at the default budget only, to keep the run short)
            if (budget === 600000) {
              const b2 = run(biome, layer, seedStr, level, index, budget, beat, hour).splats;
              if (b2.length !== n || b2.some((s, i) => s.some((v, j) => v !== splats[i][j]))) fail(what, 'not deterministic');
            }
            if (verbose) {
              const kinds = {};
              for (const s of splats) kinds[s[14]] = (kinds[s[14]] || 0) + 1;
              console.log(`${what}: ${n}/${ctx.count} splats, ${ms.toFixed(0)} ms, max ${maxSince}/yield, kinds ${JSON.stringify(kinds)}`);
            }
          }
        }
      }
    }
  }
  const t = Object.entries(timing).map(([k, v]) => `${k} ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)} µs/splat`).join(', ');
  console.log(`${name}: checked (${t})`);
}
console.log(`${runs} runs, ${failures} failures`);
process.exit(failures ? 1 : 0);
