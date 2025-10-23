<template>
  <audio
    ref="audioElement"
    referrerpolicy="no-referrer"
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
const wasPlayingBeforeChange = ref(false);

const serverAttempts = ref(0);
const maxServerAttempts = 5;

function handleError(event) {
  console.error('Audio error:', event);
  console.error('Audio error code:', audioElement.value?.error?.code);
  console.error('Audio error message:', audioElement.value?.error?.message);

  // Try to recover from error by cycling through different servers
  if (audioElement.value && audioElement.value.src && serverAttempts.value < maxServerAttempts) {
    const currentSrc = audioElement.value.src;
    // Try servers in different order - some may not check sec-gpc header
    const servers = ['ice6', 'ice5', 'ice4', 'ice1', 'ice3'];
    const currentAttempt = serverAttempts.value;

    console.log(`Attempting recovery (attempt ${currentAttempt + 1}/${maxServerAttempts})...`);

    setTimeout(() => {
      if (audioElement.value) {
        // Try next server in the list
        const nextServer = servers[currentAttempt % servers.length];
        const newSrc = currentSrc.replace(/ice[1-6]\.somafm\.com/, `${nextServer}.somafm.com`);

        if (newSrc !== currentSrc || currentAttempt === 0) {
          audioElement.value.src = newSrc;
          console.log(`Trying server ${nextServer}:`, newSrc);
          serverAttempts.value++;
          audioElement.value.load();
        }
      }
    }, 1000);
  } else if (serverAttempts.value >= maxServerAttempts) {
    console.error('All server attempts exhausted');
  }

  emit('error', event);
}

function handleLoaded() {
  console.log('Audio loaded and ready');

  // Resume playback if it was playing before channel change
  if (wasPlayingBeforeChange.value && audioElement.value) {
    audioElement.value.play().then(() => {
      console.log('Resumed playback after channel change');
      wasPlayingBeforeChange.value = false;
    }).catch(err => {
      console.error('Failed to resume playback:', err);
    });
  }
}

function handleCanPlay() {
  console.log('Audio can play');

  // Resume playback if it was playing before channel change
  if (wasPlayingBeforeChange.value && audioElement.value) {
    audioElement.value.play().then(() => {
      console.log('Resumed playback after channel change');
      wasPlayingBeforeChange.value = false;
    }).catch(err => {
      console.error('Failed to resume playback:', err);
    });
  }
}

function handlePlay() {
  isPlaying.value = true;
  emit('playing');
  console.log('Audio playing');
}

// Watch for stream URL changes
watch(() => props.streamUrl, (newUrl) => {
  if (newUrl && audioElement.value) {
    // Save playing state before changing source
    if (!audioElement.value.paused) {
      wasPlayingBeforeChange.value = true;
      console.log('Saving playback state - will resume after channel change');
    }

    // Reset server attempts when changing channels
    serverAttempts.value = 0;
    audioElement.value.src = newUrl;
    audioElement.value.load();
    console.log('New stream URL loaded:', newUrl);
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
