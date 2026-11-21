import { ref, computed, watch } from 'vue';
import { CONFIG } from '../config';

export function usePlaybackControl(distractionScore) {
  const audioElement = ref(null);
  const baseVolume = ref(0.7); // User-controlled volume

  /**
   * Train speed as a fraction of cruising speed, from the distraction score
   * 0 distraction = 1.0 (full speed)
   * max distraction = 0.0 (stopped)
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
   * Apply volume to audio element
   */
  function applyVolume(multiplier) {
    if (audioElement.value) {
      audioElement.value.volume = baseVolume.value * multiplier;
    }
  }

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
    setAudioElement,
    setBaseVolume
  };
}
