<template>
  <div class="view-controls" :class="{ 'fade-out': shouldFade }">
    <div class="row">
      <span class="label">Scenery</span>
      <span class="value">{{ sceneryText }}</span>
      <button type="button" :disabled="!view" @click="$emit('next-biome')">Next</button>
    </div>
    <div class="row">
      <span class="label">Dreamlike</span>
      <span class="value">{{ dreamText }}</span>
      <button type="button" class="switch" :class="{ on: dreamWanted }" :disabled="!view" :aria-pressed="dreamWanted" @click="$emit('toggle-dreamlike')">
        {{ dreamWanted ? 'On' : 'Off' }}
      </button>
    </div>
    <div class="row">
      <span class="label">Ignore distraction</span>
      <span class="value">{{ cheat ? 'train and music carry on' : '' }}</span>
      <button type="button" class="switch" :class="{ on: cheat }" :aria-pressed="cheat" @click="$emit('update:cheat', !cheat)">
        {{ cheat ? 'On' : 'Off' }}
      </button>
    </div>
    <div class="row">
      <span class="label">Frame rate</span>
      <span class="group">
        <button v-for="n in [30, 60, 120]" :key="n" type="button" :class="{ on: fps === n }" :aria-pressed="fps === n" @click="$emit('update:fps', n)">{{ n }}</button>
      </span>
    </div>
    <div class="row">
      <span class="label">About</span>
      <span class="value"></span>
      <button type="button" @click="$emit('credits')">Credits</button>
    </div>
  </div>
</template>

<script setup>
// Controls for the train window, shown with the rest of the overlay while the mouse is moving.
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { CONFIG } from '../config';

const props = defineProps({
  // { biome, level, next: { biome, level } | null } from the train window, or null before it starts
  view: { type: Object, default: null },
  cheat: { type: Boolean, default: false },
  fps: { type: Number, default: 60 },
  lastMouseMoveTime: { type: Number, default: Date.now() },
});
defineEmits(['next-biome', 'toggle-dreamlike', 'update:cheat', 'update:fps', 'credits']);

const NAMES = {
  downs: 'Farmland', pinewood: 'Pine forest', saltflat: 'Salt flat', nightcity: 'City at night',
  karst: 'Karst', dunes: 'Desert', himalaya: 'Himalaya', motorway: 'Night motorway', winter: 'Winter',
  fuji: 'Japan', tropics: 'Tropics', placeholder: 'Test ground',
};
const nameOf = (b) => NAMES[b] || b || '';

const sceneryText = computed(() => {
  const v = props.view;
  if (!v) return 'starting';
  if (v.next && v.next.biome !== v.biome) return `${nameOf(v.biome)}, ${nameOf(v.next.biome)} after the tunnel`;
  if (v.next) return `${nameOf(v.biome)}, new stretch after the tunnel`;
  return nameOf(v.biome);
});
// what the listener has asked for: the pending level if a change is on its way
const dreamWanted = computed(() => { const v = props.view; return !!v && (v.next ? v.next.level : v.level) === 1; });
const dreamText = computed(() => {
  const v = props.view;
  return v && v.next && v.next.level !== v.level ? 'after the tunnel' : '';
});

const currentTime = ref(Date.now());
let intervalId = null;
onMounted(() => { intervalId = setInterval(() => { currentTime.value = Date.now(); }, 100); });
onUnmounted(() => { if (intervalId) clearInterval(intervalId); });
const shouldFade = computed(() => currentTime.value - props.lastMouseMoveTime > CONFIG.UI_FADE_DELAY);
</script>

<style scoped>
.view-controls {
  position: fixed;
  top: 20px;
  right: 30px;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 14px 16px;
  color: #fff;
  min-width: 300px;
  max-width: 400px;
  z-index: 100;
  transition: opacity 0.5s ease;
  opacity: 1;
  font-size: 14px;
}
.view-controls.fade-out { opacity: 0; pointer-events: none; }
.row { display: flex; align-items: center; gap: 10px; min-height: 34px; }
.row + .row { border-top: 1px solid rgba(255, 255, 255, 0.1); }
.label { flex: 0 0 auto; color: rgba(255, 255, 255, 0.85); }
.value { flex: 1 1 auto; text-align: right; color: rgba(255, 255, 255, 0.55); font-size: 13px; min-width: 0; overflow-wrap: anywhere; }
.group { flex: 1 1 auto; display: flex; justify-content: flex-end; gap: 4px; }
button {
  flex: 0 0 auto;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.35);
  color: #fff;
  border-radius: 6px;
  padding: 4px 10px;
  min-width: 46px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease;
}
button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.2); border-color: rgba(255, 255, 255, 0.7); }
button:focus-visible { outline: 2px solid #66d9ef; outline-offset: 2px; }
button:disabled { opacity: 0.4; cursor: default; }
button.on { background: rgba(102, 217, 239, 0.28); border-color: #66d9ef; }
@media (max-width: 720px) {
  .view-controls { top: auto; bottom: 20px; left: 20px; right: 20px; max-width: none; min-width: 0; }
}
</style>
