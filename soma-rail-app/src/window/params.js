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
  fps: 0,            // frame-rate cap (30, 60, 120...); 0 = the listener's setting in the overlay (default 60)
  hour: -1,          // fixed time of day 0..24, or -1 to let it run
  horizon: -1,       // how far the horizon sits below mid-frame, 0..0.6 of the half-height; -1 = the biome's own
  audio: -1,         // music analysis: 1 on, 0 off, -1 automatic (off in Safari and on iOS, see audioWanted)
  frame: 1,          // 0 hides the window frame
  kit: 1,            // 0 leaves out the photo pieces (code-made scenery only)
  gold: 1,           // strength of the warm grade on the land when the sun is low (0 = off)
  beat: 1,           // strength of the swell on each beat (0 = off, 2 = double)
  sparkle: 1,        // strength of the treble shimmer (0 = off)
  move: 1,           // strength of the moving things (flags, traffic, vapour); 0 = everything still
  beatPin: -1,       // pins the beat pulse at this value 0..1 (screenshot scripts); -1 lets the music drive it
  // Music signals (director.js "Music signals"). A strength of 0 switches that part off, leaving
  // the picture exactly as it was before the part existed; the pins hold a signal for stills.
  split: 1,          // kicks move big things and hats small ones (0: one pulse moves everything, as before)
  mid: 1,            // vocals and melody warm the lights and strengthen the gusts (0: off)
  weather: 1,        // loudness thins or fills the rain, the snow and the traffic (0: always full, as before)
  events: 1,         // drops and breakdowns set off events (0: none)
  chase: 1,          // lamps chase at the tempo (0: they rest, as before)
  mastLock: 1,       // the train trims its speed a few per cent so masts pass on the beat (0: it never does, as before)
  bigPin: -1,        // pins the big things' pulse 0..1 (-1: follows beatPin, else the music)
  smallPin: -1,      // pins the small things' pulse 0..1 (-1: follows beatPin, else the music)
  midPin: -1,        // pins the mid-band lift 0..1
  weatherPin: -1,    // pins the weather 0..1 (1 = full)
  chasePin: -1,      // pins the beat clock (beats, any number) and switches the chase on
  eventT: -1,        // with fire=<kind>: holds that event at this many seconds after it began
  beatSeq: -1,       // pins the beat counter (screenshot scripts): which chorus groups answer; -1 lets it count
  moveT: -1,         // pins the motion clock at this many seconds (screenshot scripts); -1 lets it run
  tags: 0,           // 1 paints each motion class a flat colour and dims the rest (to check the tagging)
  touch: -1,         // touch-screen behaviour: 1 on, 0 off, -1 automatic (on where the main pointer is a finger)
  debug: 0,          // 1 shows a stats readout
  preserve: 0,       // 1 keeps the drawing buffer readable (screenshot scripts only; slower)
};
const STR = { seed: '', biome: '', slot: '', fire: '' };   // fire: raise a music event once the view is running (drop | breakdown, or a kind events.js knows)   // slot: dawn | day | dusk | night

export function readParams(search = (typeof location !== 'undefined' ? location.search : '')) {
  const q = new URLSearchParams(search);
  const p = { ...NUM, ...STR };
  for (const k of Object.keys(NUM)) {
    if (q.has(k)) { const v = Number(q.get(k)); if (Number.isFinite(v)) p[k] = v; }
  }
  for (const k of Object.keys(STR)) if (q.has(k)) p[k] = q.get(k);
  p.levelFixed = q.has('level');   // an explicit level in the URL overrides the channel's
  p.budgetGiven = q.has('budget'); // otherwise the overlay's setting decides (300k on a touch screen, 600k elsewhere)
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
