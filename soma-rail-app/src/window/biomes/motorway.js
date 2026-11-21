// An English motorway through farmland at night (stub: the real biome is being written).
import { placeholderBiome } from './placeholder.js';

export const motorwayBiome = {
  ...placeholderBiome,
  name: 'motorway',
  hazeDist: 4500,
  hours: [21.5, 3.5],
  sky: { stars: 1.25, deep: 1, milkyWay: 1, clear: 0.8 },
  horizon: 0.3,
};
