// Terrain shared by every band, so the ground lines up from the trackside out to the mountains.
// height(x, dist) is metres above rail level at `x` metres along the track, `dist` metres out.
import { fbm2, noise1 } from './rng.js';

// Shape parameters a biome can override.
export const DEFAULT_TERRAIN = {
  cutting: 1.2,     // how far the ground near the track sits below rail level (embankment), metres
  roll: 14,         // height of rolling ground in the near and mid field, metres
  rollScale: 420,   // horizontal size of the rolling, metres
  rise: 0.035,      // overall upward slope with distance (lets the mid band show above the near band)
  hills: 160,       // height of mid-band hills, metres
  hillScale: 2600,
  mountains: 1500,  // height of far-band mountains, metres
  mountainScale: 9000,
  mountainStart: 3500,
};

export function makeTerrain(seed, shape = {}) {
  const t = { ...DEFAULT_TERRAIN, ...shape };
  const height = (x, dist) => {
    // Embankment: the first few metres drop from the ballast to the surrounding ground.
    const bank = -t.cutting * Math.min(1, Math.max(0, (dist - 2) / 6));
    const nearFade = Math.min(1, Math.max(0, (dist - 8) / 60));
    const roll = (fbm2(x / t.rollScale, dist / t.rollScale, seed, 3) - 0.5) * 2 * t.roll * nearFade;
    const rise = t.rise * Math.max(0, dist - 20);
    const hillFade = Math.min(1, Math.max(0, (dist - 250) / 900));
    const hills = fbm2(x / t.hillScale, dist / t.hillScale, seed + 7, 4) * t.hills * hillFade;
    const mFade = Math.min(1, Math.max(0, (dist - t.mountainStart) / 4000));
    const ridge = 1 - Math.abs(2 * fbm2(x / t.mountainScale, dist / t.mountainScale, seed + 13, 5) - 1);
    const mountains = ridge * ridge * t.mountains * mFade;
    return bank + roll + rise + hills + mountains;
  };
  // A slow 0..1 value along the track, for things that vary by stretch (woodland density, field colour).
  const stretch = (x, scale = 900, salt = 0) => noise1(x / scale, seed + 31 + salt);
  return { height, stretch, shape: t };
}
