// Patches Spark's default splat vertex shader with the camera effects this view needs.
//
// Spark does not export its default shader, so we read it from a SparkRenderer's material and
// insert a few lines at known anchors. The anchors are checked: if a Spark upgrade moves them,
// buildVertexShader() returns null and the engine runs unpatched (no blur or haze) and says so.
// Written against @sparkjsdev/spark 2.4.0; keep that version pinned in package.json.

export const PATCH_UNIFORMS = () => ({
  uMotionMetres: { value: 0 },      // speed * shutter, metres of smear along the track
  uBlurKeep: { value: 0.6 },        // 0 = energy-conserving blur (thin layers fade), 1 = keep opacity
  uHazeColor: { value: null },      // THREE.Color, set by the engine
  uHazeDist: { value: 2500 },       // metres at which haze reaches 63%
  uLightTint: { value: null },      // THREE.Color multiplied into every splat
  uDissolve: { value: 0 },          // 0..1, scatters splats ("matter" dial)
  uBreath: { value: 0 },            // small scale pulse from the music
});

const EDITS = [
  {
    anchor: 'uniform float focalAdjustment;',
    insert: `
uniform float uMotionMetres;
uniform float uBlurKeep;
uniform vec3 uHazeColor;
uniform float uHazeDist;
uniform vec3 uLightTint;
uniform float uDissolve;
uniform float uBreath;`,
  },
  {
    // scatter and breathe, before the splat is moved into view space
    anchor: 'rgba.rgb = max(rgba.rgb, vec3(0.0));',
    insert: `
    if (uDissolve > 0.0) {
        vec3 hsh = fract(sin(vec3(float(splatIndex)) * vec3(12.9898, 78.233, 37.719)) * 43758.5453) - 0.5;
        center += hsh * uDissolve * (0.05 * length(center) + 0.3);
    }
    scales *= 1.0 + uBreath;`,
  },
  {
    // light and haze: tint, then mix toward the horizon colour with distance
    anchor: 'vRgba = rgba;',
    insert: `
    {
        // Colours with a channel near 1.0 are treated as light sources (lamps, lit windows):
        // they ignore the time-of-day tint. Natural surfaces should keep every channel below 0.8.
        float glow = smoothstep(0.86, 0.98, max(rgba.r, max(rgba.g, rgba.b)));
        float hz = 1.0 - exp(viewCenter.z / max(uHazeDist, 1.0));
        vRgba.rgb = mix(rgba.rgb * mix(uLightTint, vec3(1.0), glow), uHazeColor, hz * (1.0 - 0.5 * glow));
    }`,
  },
  {
    // motion blur: a sideways-translating camera smears each splat horizontally by
    // focal * metres / depth pixels; a box of that length has variance L^2 / 12.
    anchor: 'float det = a * d - b * b;',
    insert: `
    float adjNoMotion = sqrt(max(0.0, detOrig / det));
    {
        float mpx = focal.x * uMotionMetres / max(-viewCenter.z, 0.05);
        a += mpx * mpx / 12.0;
        det = a * d - b * b;
    }`,
  },
  {
    anchor: 'float blurAdjust = sqrt(max(0.0, detOrig / det));',
    insert: `
    blurAdjust = mix(blurAdjust, adjNoMotion, uBlurKeep);`,
  },
];

export function buildVertexShader(defaultShader) {
  let src = defaultShader;
  for (const { anchor, insert } of EDITS) {
    const first = src.indexOf(anchor);
    if (first < 0 || src.indexOf(anchor, first + anchor.length) >= 0) return null;
    src = src.replace(anchor, anchor + insert);
  }
  return src;
}
