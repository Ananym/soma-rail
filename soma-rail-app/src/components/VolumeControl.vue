<template>
  <div class="volume-control" :class="{ 'fade-out': shouldFade }">
    <label for="volume-slider">Volume</label>
    <input
      id="volume-slider"
      type="range"
      min="0"
      max="1"
      step="0.01"
      :value="modelValue"
      @input="handleVolumeChange"
    />
    <span class="volume-value">{{ Math.round(modelValue * 100) }}%</span>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { CONFIG } from '../config';

const props = defineProps({
  modelValue: {
    type: Number,
    default: 0.7
  },
  lastMouseMoveTime: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits(['update:modelValue']);

const currentTime = ref(Date.now());
let intervalId = null;

const shouldFade = computed(() => {
  const timeSinceLastMove = currentTime.value - props.lastMouseMoveTime;
  return timeSinceLastMove > CONFIG.UI_FADE_DELAY;
});

function handleVolumeChange(event) {
  emit('update:modelValue', parseFloat(event.target.value));
}

onMounted(() => {
  intervalId = setInterval(() => {
    currentTime.value = Date.now();
  }, 100);
});

onUnmounted(() => {
  if (intervalId) {
    clearInterval(intervalId);
  }
});
</script>

<style scoped>
.volume-control {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: rgba(0, 0, 0, 0.7);
  padding: 15px 20px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  transition: opacity 1s ease;
  opacity: 1;
  z-index: 100;
}

.volume-control.fade-out {
  opacity: 0;
  pointer-events: none;
}

label {
  color: #fff;
  font-size: 14px;
  font-weight: 300;
}

input[type="range"] {
  width: 120px;
  height: 4px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.2s ease;
}

input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  transition: transform 0.2s ease;
}

input[type="range"]::-moz-range-thumb:hover {
  transform: scale(1.2);
}

.volume-value {
  color: #fff;
  font-size: 14px;
  font-weight: 300;
  min-width: 40px;
  text-align: right;
}
</style>
