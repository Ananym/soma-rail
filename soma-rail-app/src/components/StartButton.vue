<template>
  <div v-if="visible" class="start-overlay" @click="handleStart">
    <div class="start-button">
      Click to Start
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
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  cursor: pointer;
}

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
