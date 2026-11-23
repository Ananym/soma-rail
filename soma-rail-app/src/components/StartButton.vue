<template>
  <div v-if="visible" class="start-overlay" @click="handleStart">
    <div class="start-button">
      {{ touch ? 'Tap to Start' : 'Click to Start' }}
    </div>
    <!-- Said before the listener starts, not after: a view that cannot be drawn, or only by the
         processor, otherwise just looks broken. -->
    <div v-if="graphics && !graphics.webgl2" class="start-warning" role="alert">
      <strong>The train window cannot be drawn here.</strong>
      This browser does not offer WebGL2, which the view needs. The radio will still play.
    </div>
    <div v-else-if="graphics && graphics.software" class="start-warning" role="alert">
      <strong>The train window will be very slow here.</strong>
      This browser is drawing without a graphics card: hardware acceleration is switched off or
      not available on this machine. Turning it on in the browser's settings, or using another
      browser or device, should fix it. The radio will still play.
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue';

const props = defineProps({
  audioElement: {
    type: Object,
    default: null
  },
  view: {
    type: Object,
    default: null
  },
  touch: {
    type: Boolean,
    default: false
  },
  // what will draw the view: { webgl2, software, renderer } (window/graphics.js)
  graphics: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(['started']);

const visible = ref(true);

function handleStart() {
  if (!visible.value) return;
  // Everything that needs the click (the radio, the audio context, the train window) is asked for
  // here, and then the overlay goes at once. It used to wait for the radio to be audible, which
  // takes a second or two of buffering and looked as if the click had not registered; and if the
  // stream was not ready yet the first click was simply lost. The player now starts by itself as
  // soon as its stream can play (see AudioPlayer's `resume`).
  if (props.audioElement) {
    const p = props.audioElement.play();
    if (p && p.catch) p.catch((err) => console.warn('Radio not playing yet, will start when the stream is ready:', err && err.name));
  }
  if (props.view) props.view.play();
  visible.value = false;
  emit('started');
}
</script>

<style scoped>
.start-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  z-index: 10000;
  cursor: pointer;
}

.start-warning {
  max-width: min(520px, 86vw);
  padding: 14px 18px;
  border: 1px solid rgba(255, 196, 96, 0.55);
  border-radius: 8px;
  background: rgba(60, 40, 8, 0.55);
  color: rgba(255, 236, 200, 0.95);
  font-size: 15px;
  font-weight: 300;
  line-height: 1.45;
  text-align: center;
}
.start-warning strong { display: block; margin-bottom: 4px; font-weight: 500; }

.start-button {
  background: rgba(255, 255, 255, 0.1);
  border: 2px solid rgba(255, 255, 255, 0.5);
  padding: 20px 40px;
  border-radius: 8px;
  color: #fff;
  font-size: 24px;
  font-weight: 300;
  letter-spacing: 2px;
  transition: all 0.3s ease;
}

.start-button:hover {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.8);
  transform: scale(1.05);
}
</style>
