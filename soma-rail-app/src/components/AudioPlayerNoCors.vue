<template>
  <audio
    ref="audioElement"
    @error="handleError"
    @loadeddata="handleLoaded"
    @play="handlePlay"
    @canplay="handleCanPlay"
  ></audio>
</template>

<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue';

const props = defineProps({
  streamUrl: {
    type: String,
    default: null
  },
  volume: {
    type: Number,
    default: 0.7
  }
});

const emit = defineEmits(['audio-ready', 'error', 'playing']);

const audioElement = ref(null);
const isPlaying = ref(false);
const serverAttempts = ref(0);
const maxServerAttempts = 5;

function handleError(event) {
  console.error('[NO CORS] Audio error:', event);
  console.error('[NO CORS] Audio error code:', audioElement.value?.error?.code);
  console.error('[NO CORS] Audio error message:', audioElement.value?.error?.message);

  // Try to recover from error by cycling through different servers
  if (audioElement.value && audioElement.value.src && serverAttempts.value < maxServerAttempts) {
    const currentSrc = audioElement.value.src;
    const servers = ['ice3', 'ice1', 'ice4', 'ice5', 'ice6'];
    const currentAttempt = serverAttempts.value;

    console.log(`[NO CORS] Attempting recovery (attempt ${currentAttempt + 1}/${maxServerAttempts})...`);

    setTimeout(() => {
      if (audioElement.value) {
        const nextServer = servers[currentAttempt % servers.length];
        const newSrc = currentSrc.replace(/ice[1-6]\.somafm\.com/, `${nextServer}.somafm.com`);

        if (newSrc !== currentSrc || currentAttempt === 0) {
          audioElement.value.src = newSrc;
          console.log(`[NO CORS] Trying server ${nextServer}:`, newSrc);
          serverAttempts.value++;
          audioElement.value.load();
        }
      }
    }, 1000);
  } else if (serverAttempts.value >= maxServerAttempts) {
    console.error('[NO CORS] All server attempts exhausted');
  }

  emit('error', event);
}

function handleLoaded() {
  console.log('[NO CORS] Audio loaded and ready - THIS WORKED!');
}

function handleCanPlay() {
  console.log('[NO CORS] Audio can play - THIS WORKED!');
}

function handlePlay() {
  isPlaying.value = true;
  emit('playing');
  console.log('[NO CORS] Audio playing - THIS WORKED!');
}

// Watch for stream URL changes
watch(() => props.streamUrl, (newUrl) => {
  if (newUrl && audioElement.value) {
    serverAttempts.value = 0;
    audioElement.value.src = newUrl;
    audioElement.value.load();
    console.log('[NO CORS] New stream URL loaded:', newUrl);
  }
}, { immediate: true });

// Watch for volume changes
watch(() => props.volume, (newVolume) => {
  if (audioElement.value) {
    audioElement.value.volume = Math.max(0, Math.min(1, newVolume));
  }
}, { immediate: true });

onMounted(() => {
  emit('audio-ready', audioElement.value);
  console.log('[NO CORS] AudioPlayer mounted WITHOUT crossorigin attribute');
});

onUnmounted(() => {
  if (audioElement.value) {
    audioElement.value.pause();
    audioElement.value.src = '';
  }
});

defineExpose({
  audioElement
});
</script>
