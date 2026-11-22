<template>
  <audio
    ref="audioElement"
    :crossorigin="cors ? 'anonymous' : null"
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
  },
  // Load the stream with CORS so the generated view can analyse the music. SomaFM allows it,
  // but if every server refuses we emit 'cors-failed' and the parent remounts us without it.
  cors: {
    type: Boolean,
    default: false
  },
  // True once the listener has pressed Start: the radio should be playing whenever it can.
  resume: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['audio-ready', 'error', 'playing', 'cors-failed']);

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
    if (props.cors) emit('cors-failed');
  }

  emit('error', event);
}

// Play as soon as the stream can, whenever playing is wanted: after Start (`resume`), after a
// change of channel, or after a recovery from a refused server. Start's own click may have come
// before the stream was ready, so this is also what makes one click enough.
function playIfWanted() {
  const el = audioElement.value;
  if (!el || !el.paused || !(props.resume || wasPlayingBeforeChange.value)) return;
  el.play().then(() => { wasPlayingBeforeChange.value = false; }).catch((err) => {
    console.warn('Could not start the radio yet:', err && err.name);
  });
}
function handleLoaded() { playIfWanted(); }
function handleCanPlay() { playIfWanted(); }

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

watch(() => props.resume, (want) => { if (want) playIfWanted(); });

// Watch for volume changes
watch(() => props.volume, (newVolume) => {
  if (audioElement.value) {
    audioElement.value.volume = Math.max(0, Math.min(1, newVolume));
  }
}, { immediate: true });

onMounted(() => {
  // On a remount the stream URL is already known, so the watcher above never fired for this element.
  if (props.streamUrl && audioElement.value && !audioElement.value.src) {
    wasPlayingBeforeChange.value = props.resume;
    audioElement.value.src = props.streamUrl;
    audioElement.value.load();
  }
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
