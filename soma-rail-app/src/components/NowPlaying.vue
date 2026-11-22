<template>
  <div class="now-playing" :class="{ 'fade-out': shouldFade, touch }">
    <div v-if="channel" class="channel-art">
      <img
        v-if="channel.image"
        :src="channel.image"
        :alt="channel.title"
      />
    </div>

    <div class="song-info">
      <div class="channel-name">{{ channel?.title || 'No channel selected' }}</div>
      <div v-if="song.title" class="song-title">{{ song.title }}</div>
      <div v-if="song.artist" class="song-artist">{{ song.artist }}</div>
      <div v-if="!song.title && !song.artist" class="song-title">Loading...</div>
    </div>

    <button v-if="touch" type="button" class="pause" :aria-label="paused ? 'Play' : 'Pause'" :aria-pressed="paused" @click="$emit('toggle-pause')">
      <svg v-if="paused" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>
      <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" fill="currentColor"/></svg>
    </button>

    <div class="playback-indicator">
      <div class="playback-bar">
        <div
          class="playback-fill"
          :style="{ width: `${playbackPercent}%` }"
        ></div>
      </div>
      <div class="playback-text">{{ playbackRate.toFixed(2) }}x</div>
    </div>

    <div v-if="!touch" class="volume-control">
      <label for="volume-slider">Volume</label>
      <input
        id="volume-slider"
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="volume"
        @input="handleVolumeChange"
      />
      <span class="volume-value">{{ Math.round(volume * 100) }}%</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { CONFIG } from '../config';

const props = defineProps({
  channel: {
    type: Object,
    default: null
  },
  song: {
    type: Object,
    default: () => ({ title: '', artist: '' })
  },
  playbackRate: {
    type: Number,
    default: 1.0
  },
  lastMouseMoveTime: {
    type: Number,
    default: Date.now()
  },
  volume: {
    type: Number,
    default: 0.7
  },
  // A touch screen: a compact strip with a pause button, and no volume slider (the phone has
  // its own volume keys, and some phones ignore a page's volume anyway).
  touch: {
    type: Boolean,
    default: false
  },
  paused: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:volume', 'toggle-pause']);

const currentTime = ref(Date.now());
let intervalId = null;

// Update current time every 100ms to check fade state
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

const shouldFade = computed(() => {
  const timeSinceLastMove = currentTime.value - props.lastMouseMoveTime;
  return timeSinceLastMove > CONFIG.UI_FADE_DELAY;
});

const playbackPercent = computed(() => {
  return props.playbackRate * 100;
});

function handleVolumeChange(event) {
  emit('update:volume', parseFloat(event.target.value));
}
</script>

<style scoped>
.now-playing {
  position: fixed;
  bottom: 30px;
  right: 30px;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(10px);
  border-radius: 12px;
  padding: 20px;
  color: #fff;
  min-width: 300px;
  max-width: 400px;
  z-index: 100;
  transition: opacity 0.5s ease;
  opacity: 1;
}

.now-playing.fade-out {
  opacity: 0;
  pointer-events: none;
}

.channel-art {
  margin-bottom: 15px;
}

.channel-art img {
  width: 100%;
  height: auto;
  border-radius: 8px;
}

.song-info {
  margin-bottom: 15px;
}

.channel-name {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
  margin-bottom: 8px;
}

.song-title {
  font-size: 18px;
  font-weight: 500;
  margin-bottom: 5px;
}

.song-artist {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.8);
}

.playback-indicator {
  display: flex;
  align-items: center;
  gap: 10px;
}

.playback-bar {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 3px;
  overflow: hidden;
}

.playback-fill {
  height: 100%;
  background: linear-gradient(90deg, #66d9ef, #a6e22e);
  transition: width 0.3s ease;
  border-radius: 3px;
}

.playback-text {
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  min-width: 50px;
  text-align: right;
}

.volume-control {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.volume-control label {
  font-size: 14px;
  font-weight: 300;
  color: rgba(255, 255, 255, 0.7);
}

.volume-control input[type="range"] {
  flex: 1;
  height: 4px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  outline: none;
  -webkit-appearance: none;
  appearance: none;
}

.volume-control input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.volume-control input[type="range"]::-webkit-slider-thumb:hover {
  transform: scale(1.2);
}

.volume-control input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  transition: transform 0.2s ease;
}

.volume-control input[type="range"]::-moz-range-thumb:hover {
  transform: scale(1.2);
}

.volume-value {
  font-size: 14px;
  font-weight: 300;
  color: rgba(255, 255, 255, 0.9);
  min-width: 40px;
  text-align: right;
}

/* touch: one strip: the channel's art, what is playing, the pause button; the speed bar beneath */
.now-playing.touch {
  display: grid;
  grid-template: "art info pause" auto "bar bar bar" auto / auto minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 12px;
  row-gap: 10px;
  padding: 12px 14px;
}
.now-playing.touch .channel-art { grid-area: art; margin: 0; }
.now-playing.touch .channel-art img { display: block; width: 52px; height: 52px; object-fit: cover; border-radius: 6px; }
.now-playing.touch .song-info { grid-area: info; margin: 0; min-width: 0; }
.now-playing.touch .channel-name { font-size: 12px; margin-bottom: 2px; }
.now-playing.touch .song-title { font-size: 15px; margin-bottom: 1px; }
.now-playing.touch .song-artist { font-size: 13px; }
.now-playing.touch .song-title, .now-playing.touch .song-artist, .now-playing.touch .channel-name {
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.now-playing.touch .playback-indicator { grid-area: bar; }
.pause {
  grid-area: pause;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.4);
}
.pause svg { width: 26px; height: 26px; }
.pause:focus-visible { outline: 2px solid #66d9ef; outline-offset: 2px; }
.pause[aria-pressed="true"] { background: rgba(102, 217, 239, 0.28); border-color: #66d9ef; }
</style>
