<script setup>
import { ref, onMounted, watch } from 'vue';
import VideoPlayer from './components/VideoPlayer.vue';
import TrainWindow from './components/TrainWindow.vue';
import AudioPlayer from './components/AudioPlayer.vue';
import ChannelSelector from './components/ChannelSelector.vue';
import NowPlaying from './components/NowPlaying.vue';
import StartButton from './components/StartButton.vue';
import { useSomaFM } from './composables/useSomaFM';
import { useInteraction } from './composables/useInteraction';
import { usePlaybackControl } from './composables/usePlaybackControl';
import { useLocalStorage } from './composables/useLocalStorage';
import { wantsGeneratedView, readParams } from './window/params';

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

// The generated train window is opt-in with ?view=generated; the video stays the default.
// If the generated view cannot start, we fall back to the video.
const useGenerated = ref(wantsGeneratedView());

// The generated view analyses the music, which needs the stream loaded with CORS. Only then do we
// touch the audio path; if CORS loading fails we remount a plain audio element and carry on.
const audioCors = ref(useGenerated.value && readParams().audio !== 0);
const audioKey = ref(0);
const fellBack = ref(false);
function handleCorsFailed() {
  console.warn('Stream refused CORS loading; continuing without music analysis');
  audioCors.value = false;
  audioKey.value++;
}

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
  // If we fell back from the generated view after Start, the video has to be started here.
  if (hasStarted.value && videoPlayerRef.value) videoPlayerRef.value.play();
}

// The generated view could not start (no WebGL2, or it failed to load): show the video instead.
function handleWindowFailed(err) {
  console.warn('Generated view unavailable, falling back to video:', err);
  useGenerated.value = false;
  fellBack.value = true;
  // The audio element is left alone: it is already playing, and replacing it mid-start would stop it.
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
  // After a fallback the video player may have become ready before playback started.
  if (fellBack.value && videoPlayerRef.value) videoPlayerRef.value.play();
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
    <TrainWindow
      v-if="useGenerated"
      ref="videoPlayerRef"
      :visible="hasStarted"
      :distraction-score="distractionScore"
      :rate="playbackRate"
      :audio-element="audioElement"
      :audio-cors="audioCors"
      :channel="currentChannel"
      :song="currentSong"
      @failed="handleWindowFailed"
    />
    <VideoPlayer
      v-else
      ref="videoPlayerRef"
      :visible="hasStarted"
      :distraction-score="distractionScore"
      @player-ready="handlePlayerReady"
    />

    <AudioPlayer
      :key="audioKey"
      ref="audioPlayerRef"
      :cors="audioCors"
      :resume="hasStarted"
      @cors-failed="handleCorsFailed"
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
