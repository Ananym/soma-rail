import { ref, computed, watch } from 'vue';
import { CONFIG } from '../config';

export function usePlaybackControl(distractionScore) {
  const youtubePlayer = ref(null);
  const audioElement = ref(null);
  const baseVolume = ref(0.7); // User-controlled volume

  /**
   * Calculate playback rate based on distraction score
   * 0 distraction = 1.0x speed
   * max distraction = 0.0x speed (stopped)
   */
  const playbackRate = computed(() => {
    const normalizedDistraction = distractionScore.value / CONFIG.DISTRACTION_MAX;
    return Math.max(0, 1 - normalizedDistraction);
  });

  /**
   * Calculate volume multiplier based on distraction score
   */
  const volumeMultiplier = computed(() => {
    const normalizedDistraction = distractionScore.value / CONFIG.DISTRACTION_MAX;
    return Math.max(0, 1 - normalizedDistraction);
  });

  /**
   * Set the YouTube player instance
   */
  function setYoutubePlayer(player) {
    youtubePlayer.value = player;
  }

  /**
   * Set the audio element
   */
  function setAudioElement(element) {
    audioElement.value = element;
  }

  /**
   * Set base volume (user preference)
   */
  function setBaseVolume(volume) {
    baseVolume.value = Math.max(0, Math.min(1, volume));
  }

  /**
   * Apply playback rate to YouTube player
   */
  function applyPlaybackRate(rate) {
    if (youtubePlayer.value && typeof youtubePlayer.value.setPlaybackRate === 'function') {
      try {
        youtubePlayer.value.setPlaybackRate(rate);
      } catch (error) {
        console.error('Error setting playback rate:', error);
      }
    }
  }

  /**
   * Apply volume to audio element
   */
  function applyVolume(multiplier) {
    if (audioElement.value) {
      audioElement.value.volume = baseVolume.value * multiplier;
    }
  }

  // Watch playback rate and apply to YouTube player
  watch(playbackRate, (rate) => {
    applyPlaybackRate(rate);
  });

  // Watch volume multiplier and apply to audio element
  watch(volumeMultiplier, (multiplier) => {
    applyVolume(multiplier);
  });

  // Watch base volume changes
  watch(baseVolume, () => {
    applyVolume(volumeMultiplier.value);
  });

  return {
    playbackRate,
    volumeMultiplier,
    baseVolume,
    setYoutubePlayer,
    setAudioElement,
    setBaseVolume
  };
}
