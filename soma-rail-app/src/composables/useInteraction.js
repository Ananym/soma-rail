import { ref, onMounted, onUnmounted } from 'vue';
import { CONFIG } from '../config';

export function useInteraction() {
  const mousePosition = ref({ x: 0, y: 0 });
  const lastMousePosition = ref({ x: 0, y: 0 });
  const isFocused = ref(true);
  const distractionScore = ref(0);
  // Initialize to 10 seconds in the past so UI starts faded out
  const lastMouseMoveTime = ref(Date.now() - 10000);
  const isMouseMoving = ref(false);
  const lastDistractionIncreaseTime = ref(Date.now());
  const gracePeriodEnd = ref(Date.now() + 2000); // 2 second grace period on start

  let updateIntervalId = null;
  let mouseMoveThrottle = null;

  /**
   * Calculate distance between two points
   */
  function distance(x1, y1, x2, y2) {
    return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  }

  /**
   * Handle mouse movement
   */
  function handleMouseMove(event) {
    // Ignore mouse movement during grace period
    const now = Date.now();
    if (now < gracePeriodEnd.value) {
      return;
    }

    // Throttle mouse move events
    if (mouseMoveThrottle) return;

    mouseMoveThrottle = setTimeout(() => {
      mouseMoveThrottle = null;
    }, CONFIG.MOUSE_MOVEMENT_SAMPLE_RATE);

    const newPos = { x: event.clientX, y: event.clientY };
    mousePosition.value = newPos;
    lastMouseMoveTime.value = now;

    // Check if movement exceeds jitter threshold
    const dist = distance(
      newPos.x,
      newPos.y,
      lastMousePosition.value.x,
      lastMousePosition.value.y
    );

    if (dist > CONFIG.JITTER_THRESHOLD) {
      isMouseMoving.value = true;
      lastMousePosition.value = { ...newPos };
    }
  }

  /**
   * Handle window focus
   */
  function handleFocus() {
    isFocused.value = !document.hidden;
  }

  /**
   * Handle window blur
   */
  function handleBlur() {
    isFocused.value = false;
  }

  /**
   * Handle visibility change
   */
  function handleVisibilityChange() {
    isFocused.value = !document.hidden;
  }

  /**
   * Update distraction score based on current state
   */
  function updateDistractionScore() {
    const now = Date.now();
    const timeSinceLastMove = now - lastMouseMoveTime.value;

    // If mouse has been still for a bit, mark as not moving
    if (timeSinceLastMove > 100) {
      isMouseMoving.value = false;
    }

    // Increase distraction if mouse is moving or window is not focused
    if (isMouseMoving.value || !isFocused.value) {
      // Increase with activity
      distractionScore.value = Math.min(
        distractionScore.value + CONFIG.DISTRACTION_INCREMENT,
        CONFIG.DISTRACTION_MAX
      );
      lastDistractionIncreaseTime.value = now;
    } else {
      // Only start recovery after 2 seconds of being calm
      const timeSinceLastDistraction = now - lastDistractionIncreaseTime.value;
      if (timeSinceLastDistraction > 2000) {
        // Linear decrease when calm
        const recoveryRate = CONFIG.DISTRACTION_MAX / (CONFIG.RECOVERY_DURATION / 16);
        distractionScore.value = Math.max(0, distractionScore.value - recoveryRate);
      }
    }
  }

  /**
   * Start monitoring interactions
   */
  function startMonitoring() {
    // Check initial focus state
    isFocused.value = document.hasFocus() && !document.hidden;

    document.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Start the update loop with setInterval (runs even when tab is hidden, unlike requestAnimationFrame)
    updateIntervalId = setInterval(updateDistractionScore, 16); // ~60fps
  }

  /**
   * Stop monitoring interactions
   */
  function stopMonitoring() {
    document.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('focus', handleFocus);
    window.removeEventListener('blur', handleBlur);
    document.removeEventListener('visibilitychange', handleVisibilityChange);

    if (updateIntervalId) {
      clearInterval(updateIntervalId);
      updateIntervalId = null;
    }
  }

  onMounted(() => {
    startMonitoring();
  });

  onUnmounted(() => {
    stopMonitoring();
  });

  /**
   * Reset grace period (used when starting the app)
   */
  function resetGracePeriod() {
    gracePeriodEnd.value = Date.now() + 2000;
    lastMouseMoveTime.value = Date.now() - 10000;
  }

  return {
    mousePosition,
    isFocused,
    distractionScore,
    lastMouseMoveTime,
    isMouseMoving,
    startMonitoring,
    stopMonitoring,
    resetGracePeriod
  };
}
