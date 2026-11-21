// The depth bands of the world. Distances are metres from the track; the camera looks out at
// right angles to it. Each band is built in chunks along the track, and bands further away use
// longer chunks because far more track length is in view at once.
export const CAMERA_HEIGHT = 2.6;   // eye height above rail level, metres

export const LAYERS = [
  { name: 'trackside', zNear: 2.5, zFar: 30, chunkLen: 100, share: 0.18 },
  { name: 'near', zNear: 30, zFar: 300, chunkLen: 200, share: 0.40 },
  { name: 'mid', zNear: 300, zFar: 3000, chunkLen: 1500, share: 0.27 },
  { name: 'far', zNear: 3000, zFar: 14000, chunkLen: 8000, share: 0.15 },
];

// Half-width of track visible at a given distance, for a camera with this horizontal half-angle.
export function halfWidthAt(dist, tanHalfHfov) { return dist * tanHalfHfov; }

// Which chunk indices a layer needs for the camera at `travelled` metres.
// `lead` is extra distance generated ahead (the train moves toward +x).
export function neededChunks(layer, travelled, tanHalfHfov, lead) {
  const hw = halfWidthAt(layer.zFar, tanHalfHfov) * 1.08;
  const first = Math.floor((travelled - hw) / layer.chunkLen);
  const last = Math.floor((travelled + hw + lead) / layer.chunkLen);
  return { first, last };
}

// How many chunks of a layer are alive at once, on average; used to split the splat budget.
export function expectedActive(layer, tanHalfHfov, lead) {
  return (2 * halfWidthAt(layer.zFar, tanHalfHfov) * 1.08 + lead) / layer.chunkLen + 1;
}
