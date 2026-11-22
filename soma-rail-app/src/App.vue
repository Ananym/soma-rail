<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import TrainWindow from './components/TrainWindow.vue';
import AudioPlayer from './components/AudioPlayer.vue';
import ChannelSelector from './components/ChannelSelector.vue';
import NowPlaying from './components/NowPlaying.vue';
import StartButton from './components/StartButton.vue';
import ViewControls from './components/ViewControls.vue';
import SoftCursor from './components/SoftCursor.vue';
import CreditsPanel from './components/CreditsPanel.vue';
import { useSomaFM } from './composables/useSomaFM';
import { useInteraction } from './composables/useInteraction';
import { usePlaybackControl } from './composables/usePlaybackControl';
import { useLocalStorage } from './composables/useLocalStorage';
import { readParams, audioWanted } from './window/params';

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
  isFocused,
  resetGracePeriod
} = useInteraction();
// The overlay shows for a few seconds after the mouse moves, but never while the window is not
// the one in use: a pointer crossing a background window should not bring it up.
const overlayMoveTime = computed(() => (isFocused.value ? lastMouseMoveTime.value : 0));

// LocalStorage persistence
const savedChannelId = useLocalStorage('selectedChannel', null);
const savedVolume = useLocalStorage('volume', 0.7);
// Overlay settings: ignore distraction (the overlay still follows the mouse, but the train keeps
// its speed and the music its volume), and the frame-rate cap.
const cheat = useLocalStorage('ignoreDistraction', false);
const fpsCap = useLocalStorage('fpsCap', 60);
// What the train window is showing and what is coming, for the overlay.
const viewState = ref(null);
const showCredits = ref(false);

// Playback control
const {
  playbackRate,
  volumeMultiplier,
  baseVolume,
  setAudioElement
} = usePlaybackControl(distractionScore, cheat);

// Set saved volume
baseVolume.value = savedVolume.value;

// Refs
const windowRef = ref(null);
const audioPlayerRef = ref(null);
const audioElement = ref(null);
const hasStarted = ref(false);

// The train window analyses the music, which needs the stream loaded with CORS and routed through
// Web Audio. That is on where it is proven (see audioWanted); if CORS loading fails we remount a
// plain audio element and carry on without analysis.
const audioCors = ref(audioWanted(readParams()));
// Set if the train window cannot start (no WebGL2, or its code failed to load).
const viewFailed = ref(false);
const audioKey = ref(0);
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

// The train window could not start: the radio plays on, and a notice says why there is no view.
function handleWindowFailed(err) {
  console.warn('Train window unavailable:', err);
  viewFailed.value = true;
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
  <div class="app" :class="{ started: hasStarted }">
    <TrainWindow
      v-if="!viewFailed"
      ref="windowRef"
      :visible="hasStarted"
      :rate="playbackRate"
      :audio-element="audioElement"
      :audio-cors="audioCors"
      :channel="currentChannel"
      :song="currentSong"
      :fps-cap="fpsCap"
      @failed="handleWindowFailed"
      @state="viewState = $event"
    />
    <div v-else class="no-view">
      <p>The train window needs WebGL2, which this browser does not provide.</p>
      <p>The radio plays on.</p>
    </div>

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
      :view="windowRef"
      @started="handleStarted"
    />

    <ChannelSelector
      v-if="hasStarted"
      :channels="channels"
      :current-channel-id="currentChannelId"
      :is-loading="isLoading"
      :error="error"
      :last-mouse-move-time="overlayMoveTime"
      @select-channel="handleChannelSelect"
    />

    <ViewControls
      v-if="hasStarted"
      :view="viewFailed ? null : viewState"
      :cheat="cheat"
      :fps="fpsCap"
      :last-mouse-move-time="overlayMoveTime"
      @next-biome="windowRef && windowRef.nextBiome()"
      @toggle-dreamlike="windowRef && windowRef.toggleDreamlike()"
      @update:cheat="cheat = $event"
      @update:fps="fpsCap = $event"
      @credits="showCredits = true"
    />

    <CreditsPanel v-if="showCredits" @close="showCredits = false" />

    <SoftCursor
      v-if="hasStarted"
      :distraction-score="distractionScore"
      :last-mouse-move-time="lastMouseMoveTime"
    />

    <NowPlaying
      v-if="hasStarted"
      :channel="currentChannel"
      :song="currentSong"
      :playback-rate="playbackRate"
      :last-mouse-move-time="overlayMoveTime"
      :volume="baseVolume"
      @update:volume="baseVolume = $event"
    />
  </div>
</template>

<style scoped>
.no-view {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5em;
  padding: 2em;
  text-align: center;
  color: rgba(255, 255, 255, 0.6);
  background: radial-gradient(ellipse at 50% 70%, #1b2530 0%, #05070a 70%);
}

/* Once the journey has started the system cursor is hidden everywhere and SoftCursor stands in
   for it: a small light that fades as the listener settles. (Only where there is a mouse.) */
@media (hover: hover) and (pointer: fine) {
  .app.started, .app.started :deep(*) { cursor: none !important; }
}

.app {
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #000;
}
</style>
