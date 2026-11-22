<template>
  <div
    v-if="seen"
    class="soft-cursor"
    :class="{ over: overControl, down: pressed }"
    :style="{ transform: `translate3d(${x}px, ${y}px, 0)`, opacity }"
    aria-hidden="true"
  ><span class="dot"></span><span class="ring"></span></div>
</template>

<script setup>
// The pointer, redrawn as a small soft light. The system cursor is hidden while this is active
// (see App.vue), and this one fades with the listener's distraction: bright while the mouse
// moves, dimming as the train gathers speed again, gone when distraction reaches zero. So a
// settled listener sees nothing on the glass, and the pointer melts away instead of blinking out.
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { CONFIG } from '../config';

const props = defineProps({
  distractionScore: { type: Number, default: 0 },
  lastMouseMoveTime: { type: Number, default: 0 },
});

const x = ref(-100), y = ref(-100);
const seen = ref(false);          // only once a real mouse has moved: never on a touch screen
const overControl = ref(false);
const pressed = ref(false);
const now = ref(Date.now());
let timer = null;

function onMove(e) {
  if (e.pointerType && e.pointerType !== 'mouse') return;
  x.value = e.clientX; y.value = e.clientY; seen.value = true;
  const t = e.target;
  overControl.value = !!(t && t.closest && t.closest('button, a, input, select, label'));
}
const onDown = (e) => { if (!e.pointerType || e.pointerType === 'mouse') pressed.value = true; };
const onUp = () => { pressed.value = false; };
const onLeave = () => { seen.value = false; };

onMounted(() => {
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onDown, { passive: true });
  window.addEventListener('pointerup', onUp, { passive: true });
  document.documentElement.addEventListener('mouseleave', onLeave);
  timer = setInterval(() => { now.value = Date.now(); }, 100);
});
onUnmounted(() => {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerdown', onDown);
  window.removeEventListener('pointerup', onUp);
  document.documentElement.removeEventListener('mouseleave', onLeave);
  if (timer) clearInterval(timer);
});

const opacity = computed(() => {
  if (now.value - props.lastMouseMoveTime < CONFIG.UI_FADE_DELAY) return 1;   // in use: for as long as the overlay is up
  const k = Math.min(1, props.distractionScore / CONFIG.DISTRACTION_MAX);
  return k <= 0 ? 0 : 0.25 + 0.6 * k;                                       // settling: dimmer and dimmer, then gone
});
</script>

<style scoped>
.soft-cursor {
  position: fixed;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  z-index: 20000;
  pointer-events: none;
  transition: opacity 0.7s ease;
  will-change: transform, opacity;
}
.dot, .ring {
  position: absolute;
  left: 0;
  top: 0;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  transition: width 0.18s ease, height 0.18s ease, opacity 0.18s ease, border-color 0.18s ease;
}
.dot {
  width: 9px;
  height: 9px;
  background: rgba(255, 244, 222, 0.95);
  box-shadow: 0 0 10px 3px rgba(255, 226, 170, 0.45), 0 0 1px 1px rgba(0, 0, 0, 0.35);
}
.ring {
  width: 26px;
  height: 26px;
  border: 1.5px solid rgba(255, 240, 210, 0);
}
/* over something that can be pressed: the dot shrinks and a ring opens round it */
.over .dot { width: 6px; height: 6px; }
.over .ring { border-color: rgba(255, 240, 210, 0.85); box-shadow: 0 0 1px 1px rgba(0, 0, 0, 0.25); }
.down .ring { width: 18px; height: 18px; }
@media (prefers-reduced-motion: reduce) {
  .soft-cursor { transition: opacity 0.2s linear; }
}
</style>
