<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import TrainWindow from './components/TrainWindow.vue';
import AudioPlayer from './components/AudioPlayer.vue';
import ChannelSelector from './components/ChannelSelector.vue';
import NowPlaying from './components/NowPlaying.vue';
import StartButton from './components/StartButton.vue';
import ViewControls from './components/ViewControls.vue';
import SoftCursor from './components/SoftCursor.vue';
import CreditsPanel from './components/CreditsPanel.vue';
import HideBar from './components/HideBar.vue';
import { useSomaFM } from './composables/useSomaFM';
import { useInteraction } from './composables/useInteraction';
import { usePlaybackControl } from './composables/usePlaybackControl';
import { useLocalStorage } from './composables/useLocalStorage';
import { readParams, audioWanted } from './window/params';
import { probeGraphics } from './window/graphics';

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

// --- touch screens ---------------------------------------------------------------------------
// Where the main pointer is a finger (or with touch=1 in the URL) the page behaves differently:
// there is no distraction mechanic, a tap brings the overlay up, a pause button stops the journey,
// and the radio never plays while the page is in the background.
const urlParams = readParams();
const touchQuery = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(hover: none) and (pointer: coarse)') : null;
const touch = ref(urlParams.touch === 1 || (urlParams.touch !== 0 && !!touchQuery && touchQuery.matches));
const hasStarted = ref(false);
const userPaused = ref(false);                  // the pause button
const pageVisible = ref(typeof document === 'undefined' || !document.hidden);
const needsTap = ref(false);                    // the browser refused to restart the radio without a touch
// whether the journey should be under way (touch screens only; elsewhere distraction decides)
const running = computed(() => hasStarted.value && !userPaused.value && pageVisible.value && !needsTap.value);
const splatBudget = computed(() => savedBudget.value || (touch.value ? 300000 : 600000));

// Interaction tracking
const {
  distractionScore,
  lastMouseMoveTime,
  isFocused,
  holdOverlay,
  hideOverlay,
  resetGracePeriod
} = useInteraction({ touch, running: computed(() => !hasStarted.value || running.value) });   // before Start the train is not held back
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
// Splats in all: 0 until the listener chooses, which means the default for the kind of device
// (see splatBudget above: a touch screen gets half a desktop's).
const savedBudget = useLocalStorage('splatBudget', 0);
// What the train window is showing and what is coming, for the overlay.
const viewState = ref(null);
const showCredits = ref(false);

// What will draw the view (asked once: the start screen warns when it is nothing, or the
// processor), and a notice for a view that turns out to be struggling once it is running.
const graphics = probeGraphics();
const slowDismissed = ref(false);
const showSlow = computed(() => hasStarted.value && !viewFailed.value && !slowDismissed.value && !!(viewState.value && viewState.value.struggling));
const canLighten = computed(() => !(viewState.value && viewState.value.budgetFixed) && splatBudget.value > 300000);
function lighten() { savedBudget.value = 300000; slowDismissed.value = true; }
const showChannels = ref(false);    // touch: the channel list as a dialog

// Playback control
const {
  playbackRate,
  volumeMultiplier,
  baseVolume,
  setAudioElement
} = usePlaybackControl(distractionScore, computed(() => cheat.value && !touch.value));   // nothing to ignore on a touch screen

// Set saved volume
baseVolume.value = savedVolume.value;

// Refs
const windowRef = ref(null);
const audioPlayerRef = ref(null);
const audioElement = ref(null);

// --- touch: pause, the background, and keeping the screen awake -------------------------------
// Some phones ignore a page's volume setting, so nothing here relies on the fade to silence the
// radio: the element itself is paused.
const volumeSettable = (() => {
  try { const a = document.createElement('audio'); a.volume = 0.5; return a.volume === 0.5; } catch { return false; }
})();
let stoppedAt = 0;          // when the radio was last paused, to know whether to rejoin the stream live
function stopRadio() {
  if (audioPlayerRef.value) audioPlayerRef.value.pauseNow();
  if (!stoppedAt) stoppedAt = Date.now();
}
function startRadio() {
  const rejoin = stoppedAt > 0 && Date.now() - stoppedAt > 5000;
  stoppedAt = 0;
  if (windowRef.value) windowRef.value.resumeAudio();
  return audioPlayerRef.value ? audioPlayerRef.value.playNow({ rejoin }) : Promise.resolve();
}
// The pause button. Pausing brakes the train as distraction does on a desktop; where the volume can
// fade the radio is paused once the train has stopped, elsewhere at once.
function togglePause() {
  if (!touch.value || !hasStarted.value) return;
  if (!userPaused.value) {
    userPaused.value = true;
    if (!volumeSettable) stopRadio();
  } else {
    userPaused.value = false;
    needsTap.value = false;
    startRadio().catch((err) => console.warn('Could not restart the radio:', err && err.name));   // inside the tap
  }
  holdOverlay();
}
watch(distractionScore, (score) => {
  if (touch.value && userPaused.value && score >= 100) stopRadio();
});
// The page left for the background (another app, another tab, the screen locked): the radio stops
// at once. Back in view it starts again by itself, or asks for a tap where the browser insists.
function handleVisibility() {
  pageVisible.value = !document.hidden;
  if (!touch.value || !hasStarted.value) return;
  if (document.hidden) {
    stopRadio();
    distractionScore.value = 100;      // so the train pulls away again on return, and the music with it
  } else if (!userPaused.value) {
    startRadio().catch(() => { needsTap.value = true; });
  }
}
function handleResumeTap() {
  needsTap.value = false;
  startRadio().catch((err) => console.warn('Could not restart the radio:', err && err.name));
  resetGracePeriod();
}
// Something else started the radio while it should be silent (lock-screen or headset controls).
function handlePlaying() {
  if (touch.value && hasStarted.value && (document.hidden || userPaused.value)) stopRadio();
}

// Keeping the screen awake: off unless asked for, and only while the journey is under way. The
// browser drops the lock whenever the page is hidden, and may refuse it (battery saver).
const wakeSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
const keepAwake = useLocalStorage('keepScreenOn', false);
const wakeNote = ref('');
let wakeLock = null;
async function syncWakeLock() {
  const want = wakeSupported && touch.value && keepAwake.value && running.value;
  if (want && !wakeLock) {
    try {
      const lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
      wakeLock = lock;
      wakeNote.value = '';
      if (!(wakeSupported && touch.value && keepAwake.value && running.value)) syncWakeLock();   // changed meanwhile
    } catch {
      keepAwake.value = false;         // say so plainly: the switch goes back off
      wakeNote.value = 'Not allowed';
    }
  } else if (!want && wakeLock) {
    const lock = wakeLock; wakeLock = null;
    lock.release().catch(() => {});
  }
}
watch([keepAwake, running, touch], syncWakeLock);
function setKeepAwake(on) { wakeNote.value = ''; keepAwake.value = on; }

const onTouchQuery = (e) => { if (urlParams.touch !== 0 && urlParams.touch !== 1) touch.value = e.matches; };
onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibility);
  if (touchQuery && touchQuery.addEventListener) touchQuery.addEventListener('change', onTouchQuery);
});
onUnmounted(() => {
  document.removeEventListener('visibilitychange', handleVisibility);
  if (touchQuery && touchQuery.removeEventListener) touchQuery.removeEventListener('change', onTouchQuery);
});

// The train window analyses the music, which needs the stream loaded with CORS and routed through
// Web Audio. That is on where it is proven (see audioWanted); if CORS loading fails we remount a
// plain audio element and carry on without analysis.
const audioCors = ref(audioWanted(urlParams));
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
  showChannels.value = false;
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
  <div class="app" :class="{ started: hasStarted, touch }">
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
      :budget="splatBudget"
      :graphics="graphics"
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
      :resume="touch ? running : hasStarted"
      @playing="handlePlaying"
      @cors-failed="handleCorsFailed"
      :stream-url="streamUrl"
      :volume="baseVolume * volumeMultiplier"
      @audio-ready="handleAudioReady"
    />

    <StartButton
      :audio-element="audioElement"
      :view="windowRef"
      :touch="touch"
      :graphics="graphics"
      @started="handleStarted"
    />

    <div v-if="showSlow" class="slow-notice" :class="{ touch }" role="status">
      <span>The view is running slowly on this device.</span>
      <button v-if="canLighten" type="button" @click="lighten">Use fewer splats</button>
      <button type="button" @click="slowDismissed = true">Dismiss</button>
    </div>

    <div v-if="touch && hasStarted && needsTap" class="resume-overlay" @click="handleResumeTap">
      <div class="resume-button">Tap to resume</div>
    </div>

    <!-- The overlay's three panels. With a mouse each sits in its own corner; on a touch screen
         they are laid out together as one sheet (see .sheet below). -->
    <div class="panels" :class="{ sheet: touch }">
    <ChannelSelector
      v-if="hasStarted && !touch"
      :channels="channels"
      :current-channel-id="currentChannelId"
      :is-loading="isLoading"
      :error="error"
      :touch="touch"
      :last-mouse-move-time="overlayMoveTime"
      @select-channel="handleChannelSelect"
    />

    <ViewControls
      v-if="hasStarted"
      :view="viewFailed ? null : viewState"
      :cheat="cheat"
      :fps="fpsCap"
      :budget="splatBudget"
      @update:budget="savedBudget = $event"
      :touch="touch"
      :keep-awake="keepAwake"
      :wake-supported="wakeSupported"
      :wake-note="wakeNote"
      :channel-name="currentChannel ? currentChannel.title : ''"
      @channels="showChannels = true"
      @update:keep-awake="setKeepAwake"
      :last-mouse-move-time="overlayMoveTime"
      @next-biome="windowRef && windowRef.nextBiome()"
      @toggle-dreamlike="windowRef && windowRef.toggleDreamlike()"
      @update:cheat="cheat = $event"
      @update:fps="fpsCap = $event"
      @credits="showCredits = true"
    />

    <NowPlaying
      v-if="hasStarted"
      :channel="currentChannel"
      :song="currentSong"
      :playback-rate="playbackRate"
      :last-mouse-move-time="overlayMoveTime"
      :volume="baseVolume"
      :touch="touch"
      :paused="userPaused"
      @update:volume="baseVolume = $event"
      @toggle-pause="togglePause"
    />

    <HideBar v-if="hasStarted && touch" :last-mouse-move-time="overlayMoveTime" @hide="hideOverlay" />
    </div>

    <!-- touch: the channels as a dialog over everything, so the sheet is not squeezed around them -->
    <div v-if="touch && hasStarted && showChannels" class="channel-modal" @click.self="showChannels = false">
      <ChannelSelector
        modal
        touch
        :channels="channels"
        :current-channel-id="currentChannelId"
        :is-loading="isLoading"
        :error="error"
        @select-channel="handleChannelSelect"
        @close="showChannels = false"
      />
    </div>

    <CreditsPanel v-if="showCredits" @close="showCredits = false" />

    <SoftCursor
      v-if="hasStarted && !touch"
      :distraction-score="distractionScore"
      :last-mouse-move-time="lastMouseMoveTime"
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
  height: 100dvh;
  overflow: hidden;
  background: #000;
}
.app.touch {
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;      /* no double-tap zoom on the glass */
  cursor: pointer;                 /* iOS sends no click for a tap on plain glass otherwise, and a tap is how the overlay is asked for */
}

/* With a mouse the wrapper does nothing: each panel is fixed in its own corner. */
.panels { display: contents; }
/* On a touch screen the panels share the screen as one sheet: what is playing (and the pause
   button) at the top, the view's controls at the bottom, and under them a bar that puts the whole
   overlay away. The glass shows between; taps there fall through to it. On its side, what is
   playing takes the left and the controls the right. The channels open as a dialog (.channel-modal). */
.panels.sheet {
  display: grid;
  position: fixed;
  inset: 0;
  height: 100dvh;
  padding: 12px;
  padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
  gap: 10px;
  grid-template: "now" auto "." minmax(0, 1fr) "view" auto "hide" auto / minmax(0, 1fr);
  z-index: 100;
  pointer-events: none;
}
.panels.sheet > * {
  position: static;
  min-width: 0;
  max-width: none;
  max-height: none;
}
.panels.sheet > :not(.fade-out) { pointer-events: auto; }
.panels.sheet > .now-playing { grid-area: now; }
.panels.sheet > .view-controls { grid-area: view; overflow-y: auto; max-height: 100%; }
.panels.sheet > .hide-bar { grid-area: hide; }
@media (orientation: landscape) {
  .panels.sheet {
    grid-template: "now view" minmax(0, 1fr) "hide hide" auto / minmax(0, 1fr) minmax(0, 1fr);
  }
  .panels.sheet > .now-playing { align-self: start; }
  .panels.sheet > .view-controls { align-self: end; }
}

.channel-modal {
  position: fixed;
  inset: 0;
  height: 100dvh;
  padding: max(12px, env(safe-area-inset-top)) max(12px, env(safe-area-inset-right)) max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  z-index: 200;
}

.resume-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}
.slow-notice {
  position: fixed;
  left: 50%;
  top: 14px;
  transform: translateX(-50%);
  z-index: 9000;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 10px;
  max-width: min(560px, 92vw);
  padding: 10px 14px;
  border: 1px solid rgba(255, 196, 96, 0.5);
  border-radius: 8px;
  background: rgba(30, 22, 8, 0.82);
  color: rgba(255, 236, 200, 0.95);
  font-size: 14px;
  font-weight: 300;
}
.slow-notice.touch { top: 36%; }
.slow-notice button {
  padding: 6px 12px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  font: inherit;
  cursor: pointer;
}
.resume-button {
  background: rgba(255, 255, 255, 0.1);
  border: 2px solid rgba(255, 255, 255, 0.5);
  padding: 18px 34px;
  border-radius: 8px;
  color: #fff;
  font-size: 22px;
  font-weight: 300;
  letter-spacing: 2px;
}
</style>
