<template>
  <div class="window-container" :class="{ hidden: !visible || !ready, still: rate === 0 }">
    <canvas ref="canvasEl"></canvas>
    <!-- The glass and camera, first pass: grain, a faint interior reflection and a vignette. -->
    <div class="grain"></div>
    <div class="reflection"></div>
    <div class="glass"></div>
    <pre v-if="params.debug" class="stats">{{ statsText }}</pre>
  </div>
</template>

<script setup>
// The train window: the view out of the carriage, generated in the browser.
// The heavy renderer (three.js + Spark) is imported only when play() is called, after the Start click.
import { ref, watch, onUnmounted } from 'vue';
import { readParams } from '../window/params';
import { getProfile } from '../window/profiles';

const props = defineProps({
  visible: { type: Boolean, default: false },
  // 0..1 train speed from the distraction mechanic: distraction brakes the train, and the view
  // sharpens as it stops. Nothing fades to black.
  rate: { type: Number, default: 1 },
  audioElement: { type: Object, default: null },
  audioCors: { type: Boolean, default: false },   // true when the stream was loaded with CORS, so it can be analysed
  channel: { type: Object, default: null },
  song: { type: Object, default: null },
  fpsCap: { type: Number, default: 60 },          // frames a second at most (the overlay's setting)
});
// 'state' carries { biome, level, next } for the overlay whenever it changes
const emit = defineEmits(['failed', 'state']);

const params = readParams();
const canvasEl = ref(null);
const ready = ref(false);
const statsText = ref('');

let engine = null;
let statsTimer = null, stateTimer = null;
let lastSongKey = null;
let startChannelId = null;
let tap = null;            // music analysis (window/audio.js), only when the stream was loaded with CORS
let tapElement = null;

// --- music analysis ---------------------------------------------------------------------------
// Once an element is fed into Web Audio it is heard only through that AudioContext, and a context
// that starts outside a user gesture can stay suspended: the radio would go silent. So the module
// is preloaded, and the element is attached synchronously inside the Start click (see play()).
// A later attach (the module was slow, or the element was replaced) first proves with a throwaway
// context that audio is allowed to run; if not, it waits for the listener's next click or key.
let audioModule = null;
let audioFeatures = null;
function preloadAudio() {
  if (!params.audio || !props.audioCors || audioModule) return;
  import('../window/audio.js').then((m) => { audioModule = m; }).catch(() => {});
}
preloadAudio();

// Only an element loaded with CORS may be attached: a non-CORS one would play silence.
function attachable(el) {
  return !!(params.audio && props.audioCors && audioModule && el && el.crossOrigin === 'anonymous' && el !== tapElement);
}
function attachNow() {
  const el = props.audioElement;
  if (!attachable(el)) return false;
  try {
    if (tap) tap.dispose();
    tap = audioModule.createAudioTap();
    if (!tap.attachElement(el)) { tap = null; return false; }
    tapElement = el;
    tap.resume();
    if (engine) engine.setAudioProvider((dt) => (audioFeatures = tap.update(dt)));
    if (typeof window !== 'undefined') window.__trainWindowAudio = () => (tap ? { ...(audioFeatures || {}), context: tap.stats().state } : null);   // for checks and tuning
    return true;
  } catch (err) {
    console.warn('Music analysis unavailable:', err);
    tap = null;
    return false;
  }
}
async function attachLater() {
  if (!attachable(props.audioElement)) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  const probe = new AC();
  try { await probe.resume(); } catch { /* stays suspended */ }
  const allowed = probe.state === 'running';
  probe.close().catch(() => {});
  if (allowed) { attachNow(); return; }
  // Not allowed yet: try again inside the listener's next gesture.
  const retry = () => { window.removeEventListener('pointerdown', retry); window.removeEventListener('keydown', retry); attachNow(); };
  window.addEventListener('pointerdown', retry, { once: true });
  window.addEventListener('keydown', retry, { once: true });
}
function disconnectAudio() {
  if (engine) engine.setAudioProvider(null);
  if (tap) tap.dispose();
  tap = null; tapElement = null; audioFeatures = null;
}

// With ?debug=1 a few keys drive the director, for tuning on a real GPU.
const DEBUG_KEYS = '\n\nkeys: l surreal level   b next biome   t new scenery\n      g next time slot   h +1 hour   [ ] speed -/+ 10 km/h';

// The debug readout: what the director is doing now, and what is about to change.
function readout(s) {
  const hh = Math.floor(s.hour), mm = String(Math.floor((s.hour - hh) * 60)).padStart(2, '0');
  const lines = [`SURREAL LEVEL: ${s.levelName.toUpperCase()} (${s.level})`];
  if (s.next) {
    const what = [];
    if (s.next.levelName !== s.levelName) what.push(`level -> ${s.next.levelName}`);
    if (s.next.biome !== s.biome) what.push(`scenery -> ${s.next.biome}`);
    if (!what.length) what.push('new scenery');
    lines.push(s.next.phase === 'approach' ? `  ${what.join(', ')} at the tunnel ahead` : `  in the tunnel: ${what.join(', ')}`);
  }
  lines.push(`scenery: ${s.biome}   time: ${hh}:${mm} (${s.slot || 'pinned'})   ${s.kmh} km/h${s.idle ? '   IDLE: stopped, drawing 2 frames a second' : ''}`);
  lines.push(`${s.fps} fps   ${Math.round(s.splats / 1000)}k splats   resolution x${s.resScale}   photo pieces ${s.photos}`);
  lines.push(s.audio ? `music: energy ${s.energy}   beat ${'#'.repeat(Math.round(s.beat * 8)).padEnd(8, '.')}   sparkle ${s.sparkle}\n       ${s.bpm ? s.bpm + ' bpm' : 'no tempo lock'}   masts every ${s.mast} m   dissolve ${s.dissolve}` : 'music: not analysed');
  // hitch meter: frames slower than 25 ms in the last 10 s, and the worst recent one with its likely cause
  const w = s.worst;
  lines.push(`hitches (10 s): ${s.hitches}   worst frame: ${w.ms} ms` + (w.ms > 25 ? ` = generate ${w.gen} + render ${w.render} + other ${Math.max(0, w.cpu - w.gen - w.render)} ms on the main thread${w.ms - w.cpu > 8 ? `, ${w.ms - w.cpu} ms elsewhere (GPU or browser)` : ''}${w.note ? '; ' + w.note : ''}` : ''));
  if (!s.patched) lines.push('WARNING: shader patch not applied (no blur or haze)');
  return lines.join('\n');
}
function onDebugKey(e) {
  if (!engine || e.metaKey || e.ctrlKey || e.altKey) return;
  const d = engine.director, s = d.state;
  const seed = (Math.random() * 0xffffffff) >>> 0;
  if (e.key === 't') d.queueTransition({ seed, biome: s.biome, level: s.level });
  else if (e.key === 'b') { const names = engine.biomeNames(); d.queueTransition({ seed, biome: names[(names.indexOf(s.biome) + 1) % names.length], level: s.level }); }
  else if (e.key === 'l') d.queueTransition({ seed: s.seed, biome: s.biome, level: s.level ? 0 : 1 });
  else if (e.key === 'h') s.hour = (s.hour + 1) % 24;
  else if (e.key === 'g') engine.cycleSlot();
  else if (e.key === '[') s.cruise = Math.max(0, s.cruise - 10 / 3.6);
  else if (e.key === ']') s.cruise = s.cruise + 10 / 3.6;
}

function hasWebGL2() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

async function play() {
  if (engine) return;
  // Checked before anything touches the audio path, so a fallback leaves the radio as it was.
  if (!hasWebGL2()) { emit('failed', new Error('WebGL2 is not available')); return; }
  attachNow();      // still inside the Start click: the audio context is allowed to run
  try {
    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const { createEngine } = await import('../window/engine.js');
    startChannelId = props.channel ? props.channel.id : null;
    engine = createEngine({ canvas: canvasEl.value, params, reducedMotion, profile: getProfile(startChannelId) });
    engine.setRate(props.rate);
    await engine.ready;
    engine.start();
    ready.value = true;
    if (tap) engine.setAudioProvider((dt) => (audioFeatures = tap.update(dt)));
    else attachLater();
    if (params.debug) {
      statsTimer = setInterval(() => { statsText.value = readout(engine.stats()) + DEBUG_KEYS; }, 250);
      window.addEventListener('keydown', onDebugKey);
    }
    if (typeof window !== 'undefined') window.__trainWindow = engine;   // for tuning from the console
    engine.setFpsCap(params.fps > 0 ? params.fps : props.fpsCap);
    publish();
    stateTimer = setInterval(publish, 400);
  } catch (err) {
    if (engine) { engine.dispose(); engine = null; }
    emit('failed', err);
  }
}

watch(() => props.rate, (r) => { if (engine) engine.setRate(r); });
watch(() => props.fpsCap, (n) => { if (engine && !(params.fps > 0)) engine.setFpsCap(n); });

// The audio element is replaced if CORS loading fails; follow it, and drop analysis if CORS is off.
watch(() => [props.audioElement, props.audioCors], () => {
  if (!props.audioCors || props.audioElement !== tapElement) disconnectAudio();
  preloadAudio();
  if (engine) attachLater();
});

// A new channel changes the kind of scenery, behind a tunnel.
watch(() => props.channel && props.channel.id, (id) => {
  if (!engine || !id || id === startChannelId) return;
  startChannelId = id;
  lastSongKey = null;            // the new channel's first track is not a track change
  engine.director.setProfile(getProfile(id));
});

// A new track queues a change of scenery; the first one we see is just where we started.
watch(() => props.song, (song) => {
  const key = song ? `${song.artist}|${song.title}` : null;
  if (!key || key === '|') return;
  if (lastSongKey !== null && key !== lastSongKey && engine) engine.director.onTrack(song);
  lastSongKey = key;
}, { deep: true });

onUnmounted(() => {
  if (statsTimer) clearInterval(statsTimer);
  if (stateTimer) clearInterval(stateTimer);
  window.removeEventListener('keydown', onDebugKey);
  disconnectAudio();
  if (engine) engine.dispose();
});

// --- controls from the overlay ---------------------------------------------------------------
// A change of level or scenery arrives through a tunnel. `pending` is what has been asked for: the
// queued change if one is on its way, otherwise the present state.
function pending() {
  const s = engine.director.state, t = s.tunnel;
  if (s.queued) return s.queued;
  if (t && t.phase === 'approach') return t.next;
  return { seed: s.seed, biome: s.biome, level: s.level };
}
function toggleDreamlike() {
  if (!engine) return;
  const p = pending();
  params.levelFixed = true;   // the listener has chosen: the channel no longer sets the level
  engine.director.queueTransition({ seed: p.seed, biome: p.biome, level: p.level ? 0 : 1 });
  publish();
}
function nextBiome() {
  if (!engine) return;
  const p = pending(), names = engine.biomeNames();
  const seed = (Math.random() * 0xffffffff) >>> 0;
  engine.director.queueTransition({ seed, biome: names[(names.indexOf(p.biome) + 1) % names.length], level: p.level });
  publish();
}
// What the overlay shows: where we are and what is coming.
let lastPublished = '';
function publish() {
  if (!engine) return;
  const s = engine.director.state, p = pending();
  const next = (p.biome !== s.biome || p.level !== s.level || p.seed !== s.seed) ? { biome: p.biome, level: p.level } : null;
  const state = { biome: s.biome, level: s.level, next };
  const key = JSON.stringify(state);
  if (key !== lastPublished) { lastPublished = key; emit('state', state); }
}

defineExpose({ play, toggleDreamlike, nextBiome });
</script>

<style scoped>
.window-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 0;
  overflow: hidden;
  background: #000;
  transition: opacity 1.2s ease;
}

.window-container.hidden {
  opacity: 0;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}

/* Film grain: a small noise tile, nudged around a few times a second. */
.grain {
  position: absolute;
  inset: -64px;
  pointer-events: none;
  opacity: 0.07;
  mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>");
  animation: grain-shift 0.6s steps(6) infinite;
}

@keyframes grain-shift {
  0% { transform: translate(0, 0); }
  20% { transform: translate(-23px, 17px); }
  40% { transform: translate(31px, -9px); }
  60% { transform: translate(-11px, -29px); }
  80% { transform: translate(19px, 27px); }
  100% { transform: translate(0, 0); }
}

/* A hint of the lit carriage reflected in the glass: two soft, slanted bands. */
.reflection {
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: 0.5;
  background:
    linear-gradient(105deg, rgba(255, 255, 255, 0) 58%, rgba(255, 250, 240, 0.035) 64%, rgba(255, 255, 255, 0) 72%),
    linear-gradient(105deg, rgba(255, 255, 255, 0) 12%, rgba(255, 250, 240, 0.02) 17%, rgba(255, 255, 255, 0) 24%);
}

@media (prefers-reduced-motion: reduce) {
  .grain { animation: none; }
}

/* a stopped train: nothing on the page should keep animating */
.window-container.still .grain {
  animation-play-state: paused;
}

/* Lens vignette. Droplets and dirt on the glass are still to do. */
.glass {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse at center, rgba(0, 0, 0, 0) 55%, rgba(0, 0, 0, 0.35) 100%);
}

.stats {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 2;
  font: 12px/1.4 ui-monospace, monospace;
  white-space: pre;
  color: #9f9;
  background: rgba(0, 0, 0, 0.5);
  padding: 6px 8px;
  pointer-events: none;
}
</style>
