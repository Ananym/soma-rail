// Biomes: each one supplies a palette, terrain shape and one splat generator per depth band.
//
// A biome is { name, palette, terrain, hazeDist, hours?, generators: { trackside, near, mid, far } }
//   terrain   overrides for DEFAULT_TERRAIN in terrain.js
//   hazeDist  metres at which haze reaches 63% (the far band needs height and contrast to survive it)
//   hours     optional [from, to] time of day the biome prefers
//   holdHours optional: true keeps the clock inside `hours` for as long as the biome lasts
//   shares    optional { trackside, near, mid, far } summing to 1: this biome's split of the splat
//             budget between the bands (default 0.18, 0.40, 0.27, 0.15)
//   beatKinds optional list of kit.js KINDs that swell and brighten on the beat. Without it,
//             everything above eye level does, which suits flat country but not a biome whose
//             high ground is the scenery (towers, dunes): there, name the things that should
//             answer the music (trees, buildings, tents, boats). MOVE.BEAT tags single splats.
//   horizon   optional 0..0.6: lowers the horizon in the frame to give the sky more room
//   sky       optional night-sky hint { stars, deep, milkyWay, clear }: brighter stars, a second field
//             of faint ones, the Milky Way, fewer clouds (see sky.js update)
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
//     move     optional 16th argument, a motion class from kit.js MOVE (flag, traffic lane,
//              vapour): the shader moves the splat. Left out, the splat stays still
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
//
// Craft rules, each learned from something that looked wrong on a real GPU:
// - The scene is only ever seen from a train moving along +x, looking sideways (towards -z), and
//   mostly in motion. Judge a prop over a whole pass (from 60 m before it to 60 m after), not in one
//   still: a building turned away from the line needs its back wall and back roof slope, and every
//   face that comes into view needs splats.
// - Thin straight things (poles, cords, lattice steel, gantries, lamp columns, rails) are kit
//   strut()s sized from distance, never stacked round blobs and never a translucent panel standing
//   in for fine detail. Both turn to fuzz.
// - No large flat or featureless shapes floating in view. A dreamlike variation alters objects the
//   viewer can already name (taller, repeated, floating, misplaced); a new slab of colour reads as a
//   rendering fault. Every element should be nameable from a single still.
// - Anything that crosses a chunk or band border is placed from world hashes (worldRng,
//   cellsAround) and drawn piecewise by every band it passes through; ctx.rng is per chunk.
// - Things meant to be looked at stand 40 to 400 m out. Closer than about 30 m the motion blur
//   eats them; keep the trackside band to ground, fences, masts and blur-friendly shapes.
// - At night the land is tinted to about a fifth of its colour, so unlit things go nearly black.
//   Whatever must be seen at night is a light (a channel >= 0.97, KIND.LIGHT) or stands lit beside
//   one, with the lit surface painted bright by hand. See nightcity.js.
// - Generators run on the main thread in slices. Stay near 2 to 3 microseconds a splat
//   (scripts/check-biomes.mjs prints it): no per-splat searches, cache per-chunk layout once.
import { placeholderBiome } from './placeholder.js';
import { downsBiome } from './downs.js';
import { saltflatBiome } from './saltflat.js';
import { nightcityBiome } from './nightcity.js';
import { pinewoodBiome } from './pinewood.js';
import { karstBiome } from './karst.js';
import { dunesBiome } from './dunes.js';
import { himalayaBiome } from './himalaya.js';
import { motorwayBiome } from './motorway.js';

export const BIOMES = {
  downs: downsBiome,
  pinewood: pinewoodBiome,
  saltflat: saltflatBiome,
  nightcity: nightcityBiome,
  karst: karstBiome,
  dunes: dunesBiome,
  himalaya: himalayaBiome,
  motorway: motorwayBiome,
  placeholder: placeholderBiome,
};

export const DEFAULT_BIOME = 'downs';

export function getBiome(name) { return BIOMES[name] || BIOMES[DEFAULT_BIOME]; }
