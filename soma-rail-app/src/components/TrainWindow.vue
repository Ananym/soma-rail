<template>
  <div class="window-container" :class="{ hidden: !visible || !ready }">
    <canvas ref="canvasEl"></canvas>
    <!-- The glass and camera, first pass: grain, a faint interior reflection and a vignette. -->
    <div class="grain"></div>
    <div class="reflection"></div>
    <div class="glass"></div>
    <pre v-if="params.debug" class="stats">{{ statsText }}</pre>
    <div class="distraction-overlay" :style="{ opacity: overlayOpacity }"></div>
  </div>
</template>

<script setup>
// The generated train window: a drop-in for VideoPlayer.vue behind ?view=generated.
// The heavy renderer (three.js + Spark) is imported only when play() is called, after the Start click.
import { ref, computed, watch, onUnmounted } from 'vue';
import { readParams } from '../window/params';
import { getProfile } from '../window/profiles';

const props = defineProps({
  visible: { type: Boolean, default: false },
  distractionScore: { type: Number, default: 0 },
  rate: { type: Number, default: 1 },            // 0..1 train speed from the distraction mechanic
  audioElement: { type: Object, default: null },
  audioCors: { type: Boolean, default: false },   // true when the stream was loaded with CORS, so it can be analysed
  channel: { type: Object, default: null },
  song: { type: Object, default: null },
});
const emit = defineEmits(['failed']);

const params = readParams();
const canvasEl = ref(null);
const ready = ref(false);
const statsText = ref('');
const overlayOpacity = computed(() => props.distractionScore / 100);

let engine = null;
let statsTimer = null;
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
const DEBUG_KEYS = '\n\nkeys: t new scenery   b next biome   l surreal level\n      h +1 hour   [ ] speed -/+ 10 km/h';
function onDebugKey(e) {
  if (!engine || e.metaKey || e.ctrlKey || e.altKey) return;
  const d = engine.director, s = d.state;
  const seed = (Math.random() * 0xffffffff) >>> 0;
  if (e.key === 't') d.queueTransition({ seed, biome: s.biome, level: s.level });
  else if (e.key === 'b') { const names = engine.biomeNames(); d.queueTransition({ seed, biome: names[(names.indexOf(s.biome) + 1) % names.length], level: s.level }); }
  else if (e.key === 'l') d.queueTransition({ seed: s.seed, biome: s.biome, level: s.level ? 0 : 1 });
  else if (e.key === 'h') s.hour = (s.hour + 1) % 24;
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
      statsTimer = setInterval(() => { statsText.value = JSON.stringify(engine.stats(), null, 1) + DEBUG_KEYS; }, 500);
      window.addEventListener('keydown', onDebugKey);
    }
    if (typeof window !== 'undefined') window.__trainWindow = engine;   // for tuning from the console
  } catch (err) {
    if (engine) { engine.dispose(); engine = null; }
    emit('failed', err);
  }
}

watch(() => props.rate, (r) => { if (engine) engine.setRate(r); });

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
  window.removeEventListener('keydown', onDebugKey);
  disconnectAudio();
  if (engine) engine.dispose();
});

defineExpose({ play });
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
  font: 11px/1.3 ui-monospace, monospace;
  color: #9f9;
  background: rgba(0, 0, 0, 0.5);
  padding: 6px 8px;
  pointer-events: none;
}

.distraction-overlay {
  position: absolute;
  inset: 0;
  background: #000;
  pointer-events: none;
  z-index: 1;
  transition: opacity 0.1s linear;
}
</style>
