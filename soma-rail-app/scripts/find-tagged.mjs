// Where do splats of one motion class land? Prints the busiest spots (world x, distance from the
// track) so a screenshot can be aimed at them with jump=<x>.
//   node scripts/find-tagged.mjs <biome> <class number, see kit.js MOVE> [seed] [level] [layer]
import { BIOMES } from '../src/window/biomes/index.js';
import { LAYERS, expectedActive, shareOf } from '../src/window/layers.js';
import { makeTerrain } from '../src/window/terrain.js';
import { hashInts, hashString, makeRng } from '../src/window/rng.js';
import { LEVELS } from '../src/window/director.js';

const [name = 'downs', cls = '8', seedStr = '7', level = '0', layerName = 'near'] = process.argv.slice(2);
const biome = BIOMES[name], layer = LAYERS.find((l) => l.name === layerName), want = Number(cls);
const seed = hashString(seedStr), terrain = makeTerrain(seed, biome.terrain);
const count = Math.max(200, Math.round((600000 * shareOf(layer, biome)) / expectedActive(layer, Math.tan((50 * Math.PI) / 360) * (16 / 9), 1.3)));
const spots = new Map();
for (let index = 0; index < Math.ceil(20000 / layer.chunkLen); index++) {
  const ctx = {
    rng: makeRng(hashInts(seed, layer.name.length * 131 + layer.name.charCodeAt(0), index)), x0: index * layer.chunkLen, length: layer.chunkLen,
    zNear: layer.zNear, zFar: layer.zFar, count, index, terrain, palette: biome.palette, dials: { ...LEVELS[Number(level)] }, level: Number(level), beatMetres: 56, layer: layer.name, seed, hour: 12,
  };
  const emit = (x, y, z, sx, sy, sz, r, g, b, o, qx, qy, qz, qw, kind, move = 0) => {
    if (move !== want) return;
    const key = `${Math.round((ctx.x0 + x) / 30) * 30}:${Math.round(-z / 15) * 15}`;
    spots.set(key, (spots.get(key) || 0) + 1);
  };
  for (const _ of (biome.generators[layer.name] || biome.generators.near)(ctx, emit)) { /* run to the end */ }
}
const top = [...spots].sort((a, b) => b[1] - a[1]).slice(0, 14);
if (!top.length) console.log(`no class ${want} splats in the ${layerName} band of ${name} over 20 km`);
for (const [key, n] of top) { const [x, d] = key.split(':'); console.log(`x ${x}  d ${d}  ${n} splats`); }
