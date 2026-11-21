// Biomes: each one supplies a palette, terrain shape and one splat generator per depth band.
//
// A generator is a JS generator function:   function* (ctx, emit)
//   emit(x, y, z, sx, sy, sz, r, g, b, opacity, qx, qy, qz, qw)
//     x        metres along the track, relative to the chunk start (0 .. ctx.length)
//     y        metres above rail level (the camera sits at CAMERA_HEIGHT)
//     z        negative distance from the track (-ctx.zNear .. -ctx.zFar)
//     sx,sy,sz splat radii (one standard deviation) in metres, before rotation
//     r,g,b    0..1; opacity 0..1; the quaternion is optional (defaults to no rotation)
//   It must `yield` every few hundred splats so the engine can spread the work over frames.
//
// ctx = { rng, x0, length, zNear, zFar, count, terrain, palette, dials, level, beatMetres, index }
//   terrain.height(worldX, dist) gives ground height; use ctx.x0 + x for worldX.
//   count is the target number of splats for the chunk; stay within about 10% of it.
// palette.ground (or palette.underlay) is also used for the backdrop drawn below the horizon, behind the splats.
import { placeholderBiome } from './placeholder.js';

export const BIOMES = {
  placeholder: placeholderBiome,
};

export const DEFAULT_BIOME = 'placeholder';

export function getBiome(name) { return BIOMES[name] || BIOMES[DEFAULT_BIOME]; }
