<template>
  <button type="button" class="hide-bar" :class="{ 'fade-out': shouldFade }" @click="$emit('hide')">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    Hide
  </button>
</template>

<script setup>
// The bar along the bottom of the touch overlay: one press puts the whole overlay away at once,
// without waiting for it to fade or hunting for a bare patch of glass to tap.
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { CONFIG } from '../config';

const props = defineProps({ lastMouseMoveTime: { type: Number, default: Date.now() } });
defineEmits(['hide']);

const currentTime = ref(Date.now());
let intervalId = null;
onMounted(() => { intervalId = setInterval(() => { currentTime.value = Date.now(); }, 100); });
onUnmounted(() => { if (intervalId) clearInterval(intervalId); });
const shouldFade = computed(() => currentTime.value - props.lastMouseMoveTime > CONFIG.UI_FADE_DELAY);
</script>

<style scoped>
.hide-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  min-height: 48px;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 12px;
  color: #fff;
  font: inherit;
  font-size: 15px;
  letter-spacing: 0.5px;
  transition: opacity 0.5s ease;
  opacity: 1;
}
.hide-bar svg { width: 20px; height: 20px; }
.hide-bar.fade-out { opacity: 0; pointer-events: none; }
.hide-bar:focus-visible { outline: 2px solid #66d9ef; outline-offset: 2px; }
</style>
