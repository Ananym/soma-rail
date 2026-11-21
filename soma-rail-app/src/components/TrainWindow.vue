<template>
  <div class="window-container" :class="{ hidden: !visible || !ready }">
    <canvas ref="canvasEl"></canvas>
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

async function play() {
  if (engine) return;
  try {
    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const { createEngine } = await import('../window/engine.js');
    startChannelId = props.channel ? props.channel.id : null;
    engine = createEngine({ canvas: canvasEl.value, params, reducedMotion, profile: getProfile(startChannelId) });
    engine.setRate(props.rate);
    await engine.ready;
    engine.start();
    ready.value = true;
    if (params.debug) statsTimer = setInterval(() => { statsText.value = JSON.stringify(engine.stats(), null, 1); }, 500);
    if (typeof window !== 'undefined') window.__trainWindow = engine;   // for tuning from the console
  } catch (err) {
    if (engine) { engine.dispose(); engine = null; }
    emit('failed', err);
  }
}

watch(() => props.rate, (r) => { if (engine) engine.setRate(r); });

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

/* A first pass at the glass and camera: a soft vignette. Reflections, droplets and grain come later. */
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
