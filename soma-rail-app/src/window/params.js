// Tuning knobs for the generated view, all settable from the URL so the look can be tuned on a real GPU
// without rebuilding. Example: ?level=1&budget=900000&kmh=120&shutter=0.02
const NUM = {
  level: 0,          // surreal level: 0 = plausible, 1 = dreamlike
  budget: 600000,    // total splats across all bands
  kmh: 100,          // cruising speed with no distraction
  shutter: 1 / 50,   // seconds; motion blur length = speed * shutter
  blurKeep: 0.6,     // 0..1: how much opacity a splat keeps when smeared (0 = energy conserving, thins out)
  fov: 50,           // vertical field of view, degrees
  scale: 1,          // resolution scale cap (the engine lowers it further to hold frame rate)
  slice: 5,          // ms of chunk generation allowed per frame
  sortMs: 0,         // least time between splat sorts, ms (0 = every frame). Depth order barely changes for
                     // this camera, so a value such as 100 may cut per-frame stalls; untested on a real GPU
  hour: -1,          // fixed time of day 0..24, or -1 to let it run
  audio: -1,         // music analysis: 1 on, 0 off, -1 automatic (off in Safari and on iOS, see audioWanted)
  frame: 1,          // 0 hides the window frame
  kit: 1,            // 0 leaves out the photo pieces (code-made scenery only)
  gold: 1,           // strength of the warm grade on the land when the sun is low (0 = off)
  beat: 1,           // strength of the swell on each beat (0 = off, 2 = double)
  sparkle: 1,        // strength of the treble shimmer (0 = off)
  debug: 0,          // 1 shows a stats readout
  preserve: 0,       // 1 keeps the drawing buffer readable (screenshot scripts only; slower)
};
const STR = { seed: '', biome: '', slot: '' };   // slot: dawn | day | dusk | night

export function readParams(search = (typeof location !== 'undefined' ? location.search : '')) {
  const q = new URLSearchParams(search);
  const p = { ...NUM, ...STR };
  for (const k of Object.keys(NUM)) {
    if (q.has(k)) { const v = Number(q.get(k)); if (Number.isFinite(v)) p[k] = v; }
  }
  for (const k of Object.keys(STR)) if (q.has(k)) p[k] = q.get(k);
  p.levelFixed = q.has('level');   // an explicit level in the URL overrides the channel's
  p.level = Math.max(0, Math.min(1, Math.round(p.level)));
  p.budget = Math.max(20000, Math.min(4000000, Math.round(p.budget)));
  return p;
}

// Should the radio be routed through Web Audio for analysis? Once it is, the listener hears it only
// through that audio context. That is proven in Chromium; WebKit has a long-standing bug with
// analysing live streams, and it is untested there, so in Safari and on iOS (where every browser is
// WebKit) analysis stays off unless the URL asks for it with audio=1.
export function audioWanted(params, nav = (typeof navigator !== 'undefined' ? navigator : null)) {
  if (params.audio === 0) return false;
  if (params.audio === 1) return true;
  if (!nav) return false;
  const ua = nav.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  const safari = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\/|OPR\/|Android/.test(ua);
  return !(ios || safari);
}
