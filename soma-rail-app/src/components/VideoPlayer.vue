<template>
  <div class="video-container" :class="{ hidden: !visible }">
    <div id="youtube-player"></div>
    <div class="distraction-overlay" :style="{ opacity: overlayOpacity }"></div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { CONFIG } from '../config';

const props = defineProps({
  videoId: {
    type: String,
    default: CONFIG.YOUTUBE_VIDEO_ID
  },
  visible: {
    type: Boolean,
    default: false
  },
  distractionScore: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits(['player-ready']);

const player = ref(null);
const isReady = ref(false);

// Calculate overlay opacity based on distraction score
const overlayOpacity = computed(() => {
  // Normalize distraction score (0-100) to opacity (0-1)
  return props.distractionScore / 100;
});

function onPlayerReady(event) {
  console.log('YouTube player ready');
  isReady.value = true;

  // Set volume to 0 (we control audio separately)
  try {
    event.target.setVolume(0);
  } catch (error) {
    console.error('Error setting video volume:', error);
  }

  emit('player-ready', player.value);
}

function play() {
  if (player.value && isReady.value) {
    try {
      // Seek to 8 seconds to skip the stationary phase
      player.value.seekTo(8, true);
      player.value.playVideo();
      console.log('Video started playing from 8s');
    } catch (error) {
      console.error('Error starting video:', error);
    }
  }
}

function onPlayerStateChange(event) {
  // If video ends, restart it
  if (event.data === window.YT.PlayerState.ENDED) {
    event.target.playVideo();
  }
}

function initPlayer() {
  if (!window.YT) {
    console.error('YouTube API not loaded');
    return;
  }

  console.log('Initializing YouTube player with video ID:', props.videoId);

  player.value = new window.YT.Player('youtube-player', {
    height: '100%',
    width: '100%',
    videoId: props.videoId,
    playerVars: {
      autoplay: 0,
      mute: 1,
      controls: 0,
      disablekb: 1,
      loop: 1,
      playlist: props.videoId,
      modestbranding: 1,
      rel: 0,
      showinfo: 0,
      iv_load_policy: 3,
      playsinline: 1,
      enablejsapi: 1,
      origin: window.location.origin
    },
    events: {
      onReady: onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError: onPlayerError
    }
  });
}

function onPlayerError(event) {
  console.error('YouTube player error:', event.data);
}

onMounted(() => {
  // Wait for YouTube API to be ready
  if (window.YT && window.YT.Player) {
    initPlayer();
  } else {
    window.onYouTubeIframeAPIReady = initPlayer;
  }
});

onUnmounted(() => {
  if (player.value && typeof player.value.destroy === 'function') {
    player.value.destroy();
  }
});

defineExpose({
  player,
  play
});
</script>

<style scoped>
.video-container {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 0;
  overflow: hidden;
  background: #000;
  transition: opacity 0.5s ease;
}

.video-container.hidden {
  opacity: 0;
}

#youtube-player {
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* Make video cover the screen maintaining aspect ratio */
:deep(iframe) {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 100vw;
  height: 56.25vw; /* 16:9 aspect ratio */
  min-height: 100vh;
  min-width: 177.77vh; /* 16:9 aspect ratio */
  pointer-events: none;
}

.distraction-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: #000;
  pointer-events: none;
  z-index: 1;
  transition: opacity 0.1s linear;
}
</style>
