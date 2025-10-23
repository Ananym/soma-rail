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
  videoPlayer: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(['started']);

const visible = ref(true);

function handleStart() {
  // Start both audio and video
  const promises = [];

  if (props.audioElement) {
    promises.push(props.audioElement.play());
  }

  if (props.videoPlayer) {
    props.videoPlayer.play();
  }

  // Hide overlay when audio starts
  Promise.all(promises).then(() => {
    visible.value = false;
    emit('started');
  }).catch(err => {
    console.error('Failed to start playback:', err);
  });
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
