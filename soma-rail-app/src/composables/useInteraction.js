import { ref, onMounted, onUnmounted } from 'vue';
import { CONFIG } from '../config';

// On a touch screen (`touch`, a ref) there is no distraction mechanic: a finger on the glass is how
// the overlay is asked for, not a lapse of attention. There the score follows `running` (a ref:
// whether the journey should be under way) instead: not running, it climbs and the train brakes;
// running, it falls and the train pulls away. Taps bring the overlay up and put it away.
const PANELS = '.now-playing, .channel-selector, .channel-modal, .view-controls, .hide-bar, .slow-notice, .credits-backdrop, .start-overlay, .resume-overlay';
const TOUCH_FADE_DELAY = 7500;    // ms without a touch before the overlay fades on a touch screen

export function useInteraction({ touch = null, running = null } = {}) {
  const isTouch = () => !!(touch && touch.value);
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
  let lastTouchUpdate = Date.now();
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
    if (isTouch()) return;      // a tap also fires a mouse move; it is not a mouse
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

  // --- touch: the overlay comes and goes with taps ---------------------------------------------
  // `lastMouseMoveTime` is what the panels fade by, CONFIG.UI_FADE_DELAY after it. A touch screen
  // gets longer (no pointer rests on a panel to hold it open), so the time is set ahead by the
  // difference.
  // Whether the overlay is up, judged by what is on the screen where there is something to judge by:
  // the panels fade a moment after their time runs out (longer on a page that is working hard), and
  // a tap must answer what the listener sees.
  const overlayShown = () => {
    const panel = typeof document !== 'undefined' && document.querySelector('.view-controls, .now-playing');
    return panel ? !panel.classList.contains('fade-out') : Date.now() - lastMouseMoveTime.value <= CONFIG.UI_FADE_DELAY;
  };
  const holdOverlay = () => { lastMouseMoveTime.value = Date.now() + (TOUCH_FADE_DELAY - CONFIG.UI_FADE_DELAY); };
  const hideOverlay = () => { lastMouseMoveTime.value = Date.now() - 10000; };
  // A tap is acted on at `click`, not when the finger lands: by then the browser has already
  // decided what was tapped, so a tap that brings the overlay up cannot also press a button that
  // appears under the finger.
  function handleTap(event) {
    if (!isTouch() || Date.now() < gracePeriodEnd.value) return;
    const t = event.target;
    const onPanel = !!(t && t.closest && t.closest(PANELS));
    if (overlayShown() && !onPanel) hideOverlay();   // a tap on the glass puts it away
    else holdOverlay();
  }
  // Anything done to a panel that is showing keeps it showing: a press, a scroll of the channels.
  function handleTouchActivity() {
    if (isTouch() && overlayShown()) holdOverlay();
  }

  // Scrolling is using the overlay too: the wheel over the channel list, a dragged scroll bar, the
  // arrow keys. So is clicking: pressing Next several times with the pointer resting on the button.
  // With a mouse the overlay otherwise stays up only while the pointer moves, so a listener reading
  // down the channels with the wheel, or clicking through the sceneries, saw it fade under them.
  function handleScrollActivity() {
    if (isTouch()) { handleTouchActivity(); return; }
    if (Date.now() < gracePeriodEnd.value) return;
    if (overlayShown()) lastMouseMoveTime.value = Date.now();
  }

  function handlePressActivity() {
    if (!isTouch()) handleScrollActivity();     // (a touch screen has its own rules: handleTap, handleTouchActivity)
  }

  /**
   * Handle window blur
   */
  function handleBlur() {
    // on a touch screen only a hidden page counts: focus is unreliable in web views and home-screen apps
    if (isTouch()) return;
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
    if (isTouch()) {
      // By the clock, not by the tick: a phone working hard runs its timers late, and pause must
      // still stop the train (and then the radio) in about a second and a half.
      const ticks = Math.min(1000, Math.max(0, now - lastTouchUpdate)) / 16;
      lastTouchUpdate = now;
      const go = !running || running.value;
      const step = go ? -CONFIG.DISTRACTION_MAX / (CONFIG.RECOVERY_DURATION / 16) : CONFIG.DISTRACTION_INCREMENT;
      distractionScore.value = Math.max(0, Math.min(CONFIG.DISTRACTION_MAX, distractionScore.value + step * ticks));
      return;
    }
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
    isFocused.value = isTouch() ? !document.hidden : document.hasFocus() && !document.hidden;

    document.addEventListener('click', handleTap, true);
    document.addEventListener('pointerdown', handleTouchActivity, true);
    document.addEventListener('touchmove', handleTouchActivity, { capture: true, passive: true });
    document.addEventListener('scroll', handleScrollActivity, { capture: true, passive: true });
    document.addEventListener('wheel', handleScrollActivity, { capture: true, passive: true });
    document.addEventListener('keydown', handleScrollActivity, true);
    document.addEventListener('pointerdown', handlePressActivity, true);
    document.addEventListener('click', handlePressActivity, true);
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
    document.removeEventListener('click', handleTap, true);
    document.removeEventListener('pointerdown', handleTouchActivity, true);
    document.removeEventListener('touchmove', handleTouchActivity, true);
    document.removeEventListener('scroll', handleScrollActivity, true);
    document.removeEventListener('wheel', handleScrollActivity, true);
    document.removeEventListener('keydown', handleScrollActivity, true);
    document.removeEventListener('pointerdown', handlePressActivity, true);
    document.removeEventListener('click', handlePressActivity, true);
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
    holdOverlay,
    hideOverlay,
    startMonitoring,
    stopMonitoring,
    resetGracePeriod
  };
}
