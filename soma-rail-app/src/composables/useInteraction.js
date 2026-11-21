import { ref, onMounted, onUnmounted } from 'vue';
import { CONFIG } from '../config';
import { createDistractionModel, createSteppedClock } from '../utils/distractionModel';

export function useInteraction() {
  const mousePosition = ref({ x: 0, y: 0 });
  const isFocused = ref(true);
  const distractionScore = ref(0);
  // Initialize to 10 seconds in the past so UI starts faded out
  const lastMouseMoveTime = ref(Date.now() - 10000);
  const isMouseMoving = ref(false);

  // The score is a function of elapsed time (see utils/distractionModel.js), so it rises and falls
  // at the same pace whether this page gets sixty updates a second or two. The clock is
  // performance.now(), with any one gap counted as at most DISTRACTION_MAX_STEP.
  const clock = createSteppedClock(CONFIG.DISTRACTION_MAX_STEP, performance.now());
  const model = createDistractionModel(CONFIG, clock.time(performance.now()));
  let gracePeriodEnd = clock.time(performance.now()) + 2000; // 2 second grace period on start

  let updateIntervalId = null;
  let rawMoves = null;

  /**
   * Model time now or, given an event, when that event happened. A busy page runs handlers late,
   * so the event's own timestamp is used where it is on the performance.now() timeline.
   */
  function modelTime(event) {
    const now = performance.now();
    const stamp = event ? event.timeStamp : now;
    return clock.time(now, stamp > 0 && stamp <= now ? stamp : now);
  }

  /**
   * Publish the model's current values to the refs
   */
  function updateDistractionScore() {
    const { score, moving } = model.at(modelTime());
    distractionScore.value = score;
    isMouseMoving.value = moving;
  }

  /**
   * The browser hands over at most one mousemove per frame. On a slow frame that one event stands
   * for many pointer positions; a pointermove carries them all, each with its own time, and is
   * dispatched just before the mousemove made from the same input. Keep them for handleMouseMove.
   */
  function handlePointerMove(event) {
    rawMoves = null;
    if (event.pointerType !== 'mouse' || typeof event.getCoalescedEvents !== 'function') return;
    const list = event.getCoalescedEvents();
    if (list.length > 1) rawMoves = { stamp: event.timeStamp, list };
  }

  /**
   * Handle mouse movement
   */
  function handleMouseMove(event) {
    const raw = rawMoves;
    rawMoves = null;
    const samples = raw && Math.abs(raw.stamp - event.timeStamp) <= 1 ? raw.list : [event];

    let taken = false;
    for (const sample of samples) {
      const t = modelTime(sample);
      // Ignore mouse movement during grace period
      if (t < gracePeriodEnd) continue;
      // Samples closer together than MOUSE_MOVEMENT_SAMPLE_RATE are dropped by the model
      if (model.pointerMoved(sample.clientX, sample.clientY, t)) taken = true;
    }
    if (!taken) return;

    mousePosition.value = { x: event.clientX, y: event.clientY };
    lastMouseMoveTime.value = Date.now();
    updateDistractionScore();
  }

  function setFocused(focused, event) {
    isFocused.value = focused;
    model.setFocused(focused, modelTime(event));
    updateDistractionScore();
  }

  /**
   * Handle window focus
   */
  function handleFocus(event) {
    setFocused(!document.hidden, event);
  }

  /**
   * Handle window blur
   */
  function handleBlur(event) {
    setFocused(false, event);
  }

  /**
   * Handle visibility change
   */
  function handleVisibilityChange(event) {
    setFocused(!document.hidden, event);
  }

  /**
   * Start monitoring interactions
   */
  function startMonitoring() {
    // Check initial focus state
    setFocused(document.hasFocus() && !document.hidden);

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Publish the score with setInterval (runs even when tab is hidden, unlike requestAnimationFrame).
    // How often this fires only sets how smoothly the score is seen to move, not how fast it moves.
    updateIntervalId = setInterval(updateDistractionScore, 16); // ~60fps
  }

  /**
   * Stop monitoring interactions
   */
  function stopMonitoring() {
    document.removeEventListener('pointermove', handlePointerMove);
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
    gracePeriodEnd = modelTime() + 2000;
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
