<template>
  <button
    v-if="!isPlaying"
    class="play-button"
    @click="handleClick"
  >
    <svg width="60" height="60" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="30" cy="30" r="28" stroke="white" stroke-width="2" opacity="0.8"/>
      <path d="M22 17 L22 43 L42 30 Z" fill="white" opacity="0.9"/>
    </svg>
    <span>Click to Start Audio</span>
  </button>
</template>

<script setup>
import { ref } from 'vue';

const props = defineProps({
  audioElement: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(['play']);

const isPlaying = ref(false);

async function handleClick() {
  if (props.audioElement) {
    try {
      await props.audioElement.play();
      isPlaying.value = true;
      emit('play');
      console.log('Audio started via user interaction');
    } catch (error) {
      console.error('Error starting audio:', error);
    }
  }
}
</script>

<style scoped>
.play-button {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(10px);
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 20px;
  padding: 30px 40px;
  color: white;
  font-size: 18px;
  cursor: pointer;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 15px;
  transition: all 0.3s ease;
}

.play-button:hover {
  background: rgba(0, 0, 0, 0.9);
  border-color: rgba(255, 255, 255, 0.5);
  transform: translate(-50%, -50%) scale(1.05);
}

.play-button svg {
  filter: drop-shadow(0 0 10px rgba(255, 255, 255, 0.3));
}

.play-button span {
  font-weight: 500;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.5);
}
</style>
