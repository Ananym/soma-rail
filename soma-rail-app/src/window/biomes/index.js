// Biomes: each one supplies a palette, terrain shape and one splat generator per depth band.
//
// A biome is { name, palette, terrain, hazeDist, hours?, generators: { trackside, near, mid, far } }
//   terrain   overrides for DEFAULT_TERRAIN in terrain.js
//   hazeDist  metres at which haze reaches 63% (the far band needs height and contrast to survive it)
//   hours     optional [from, to] time of day the biome prefers
//
// A generator is a JS generator function:   function* (ctx, emit)
//   emit(x, y, z, sx, sy, sz, r, g, b, opacity, qx, qy, qz, qw, kind)
//     x        metres along the track, relative to the chunk start (0 .. ctx.length); world x = ctx.x0 + x
//     y        metres above rail level (the camera sits at CAMERA_HEIGHT = 2.6)
//     z        negative distance from the track (-ctx.zNear .. -ctx.zFar)
//     sx,sy,sz splat radii (one standard deviation) in metres, before rotation
//     r,g,b    0..1; natural surfaces keep every channel <= 0.8, a channel >= 0.97 marks a light
//              source that ignores the time-of-day tint; opacity 0..1
//     quaternion optional (defaults to no rotation)
//     kind     optional tag from kit.js KIND (mast, wire, tree, ...); the engine ignores it,
//              scripts/check-biomes.mjs uses it
//   It must `yield` at least every ~500 splats so the engine can spread the work over frames, and
//   emit within about 10% of ctx.count splats.
//
// ctx = { rng, x0, length, zNear, zFar, count, index, layer, terrain, palette, dials, level, beatMetres, seed, hour }
//   rng is per chunk (seed, layer, index); anything that must line up across chunk borders has to be
//   placed from world x with world hashes instead (kit.js worldRng / cellsAround).
//   terrain.height(worldX, dist) gives ground height; use ctx.x0 + x for worldX.
//   dials = { scale, topology, matter, time, logic }, each 0..1 (all 0 at level 0).
//   beatMetres: overhead-line masts stand every beatMetres of world x.
//   seed is the world seed and hour the time of day (0..24) when the chunk was built.
// palette.ground (or palette.underlay), an [r, g, b], also colours the backdrop the engine draws
// below the horizon behind the splats.
// kit.js holds the shared props (ground fill, trees, hedges, buildings, masts, wires, fences, ...).
import { placeholderBiome } from './placeholder.js';
import { downsBiome } from './downs.js';
import { saltflatBiome } from './saltflat.js';
import { nightcityBiome } from './nightcity.js';
import { pinewoodBiome } from './pinewood.js';

export const BIOMES = {
  downs: downsBiome,
  pinewood: pinewoodBiome,
  saltflat: saltflatBiome,
  nightcity: nightcityBiome,
  placeholder: placeholderBiome,
};

export const DEFAULT_BIOME = 'downs';

export function getBiome(name) { return BIOMES[name] || BIOMES[DEFAULT_BIOME]; }
