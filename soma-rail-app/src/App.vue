<script setup>
import { ref, onMounted, watch } from 'vue';
import VideoPlayer from './components/VideoPlayer.vue';
import AudioPlayer from './components/AudioPlayer.vue';
import ChannelSelector from './components/ChannelSelector.vue';
import NowPlaying from './components/NowPlaying.vue';
import StartButton from './components/StartButton.vue';
import { useSomaFM } from './composables/useSomaFM';
import { useInteraction } from './composables/useInteraction';
import { usePlaybackControl } from './composables/usePlaybackControl';
import { useLocalStorage } from './composables/useLocalStorage';

// Soma FM integration
const {
  channels,
  currentChannel,
  currentChannelId,
  currentSong,
  streamUrl,
  isLoading,
  error,
  fetchChannels,
  setChannel,
  stopMetadataPolling
} = useSomaFM();

// Interaction tracking
const {
  distractionScore,
  lastMouseMoveTime,
  resetGracePeriod
} = useInteraction();

// Playback control
const {
  playbackRate,
  volumeMultiplier,
  baseVolume,
  setYoutubePlayer,
  setAudioElement
} = usePlaybackControl(distractionScore);

// LocalStorage persistence
const savedChannelId = useLocalStorage('selectedChannel', null);
const savedVolume = useLocalStorage('volume', 0.7);

// Set saved volume
baseVolume.value = savedVolume.value;

// Refs
const videoPlayerRef = ref(null);
const audioPlayerRef = ref(null);
const audioElement = ref(null);
const hasStarted = ref(false);

// Initialize
onMounted(async () => {
  // Fetch channels
  await fetchChannels();

  // Set initial channel from localStorage, Digitalis, or first channel
  if (savedChannelId.value && channels.value.find(ch => ch.id === savedChannelId.value)) {
    await setChannel(savedChannelId.value);
  } else {
    // Try to find Digitalis as the default
    const digitalis = channels.value.find(ch => ch.id === 'digitalis');
    if (digitalis) {
      await setChannel('digitalis');
    } else if (channels.value.length > 0) {
      await setChannel(channels.value[0].id);
    }
  }
});

// Handle channel selection
async function handleChannelSelect(channelId) {
  await setChannel(channelId);
  savedChannelId.value = channelId;
}

// Handle YouTube player ready
function handlePlayerReady(player) {
  setYoutubePlayer(player);
}

// Handle audio element ready
function handleAudioReady(audioEl) {
  audioElement.value = audioEl;
  setAudioElement(audioEl);
}

// Handle start button clicked
function handleStarted() {
  hasStarted.value = true;
  // Reset grace period to ignore residual mouse movement from the click
  resetGracePeriod();
}

// Watch volume changes and save to localStorage
watch(baseVolume, (newVolume) => {
  savedVolume.value = newVolume;
});

// Cleanup on unmount
onMounted(() => {
  return () => {
    stopMetadataPolling();
  };
});
</script>

<template>
  <div class="app">
    <VideoPlayer
      ref="videoPlayerRef"
      :visible="hasStarted"
      :distraction-score="distractionScore"
      @player-ready="handlePlayerReady"
    />

    <AudioPlayer
      ref="audioPlayerRef"
      :stream-url="streamUrl"
      :volume="baseVolume * volumeMultiplier"
      @audio-ready="handleAudioReady"
    />

    <StartButton
      :audio-element="audioElement"
      :video-player="videoPlayerRef"
      @started="handleStarted"
    />

    <ChannelSelector
      v-if="hasStarted"
      :channels="channels"
      :current-channel-id="currentChannelId"
      :is-loading="isLoading"
      :error="error"
      :last-mouse-move-time="lastMouseMoveTime"
      @select-channel="handleChannelSelect"
    />

    <NowPlaying
      v-if="hasStarted"
      :channel="currentChannel"
      :song="currentSong"
      :playback-rate="playbackRate"
      :last-mouse-move-time="lastMouseMoveTime"
      :volume="baseVolume"
      @update:volume="baseVolume = $event"
    />
  </div>
</template>

<style scoped>
.app {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #000;
}
</style>
