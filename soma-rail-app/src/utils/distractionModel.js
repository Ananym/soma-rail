// The distraction score as a function of time, not of ticks or frames.
//
// The score rises at a steady rate while the listener is distracted (the pointer is moving, or the
// window is not focused), holds for RECOVERY_DELAY once they settle, then falls linearly to zero.
// The pointer counts as moving from a move that travels past the jitter threshold until
// MOUSE_STILL_AFTER ms after the last move seen.
//
// The model only changes state when an input arrives (a pointer sample or a focus change), each
// with the time it happened. Between inputs the score follows from the clock alone, so at(t) works
// it out for any later moment and it does not matter how often, or how late, anyone asks. Inputs
// may be reported late (a busy page hands over a whole frame's pointer samples at once) as long as
// they come in order.
//
// No DOM here: scripts/check-distraction.mjs runs this in Node.

export function createDistractionModel(config, startTime = 0) {
  const max = config.DISTRACTION_MAX;
  const risePerMs = config.DISTRACTION_RISE_PER_SECOND / 1000;
  const fallPerMs = max / config.RECOVERY_DURATION;

  // Exact as of `t`, the time of the last input.
  const state = {
    t: startTime,
    score: 0,
    focused: true,
    moving: false,
    lastSample: -Infinity,    // time of the last pointer sample taken
    lastActive: startTime,    // when the listener was last distracted
    anchorX: 0,               // where the pointer was when it last travelled past the jitter threshold
    anchorY: 0,
  };

  // Carry `s` forward to time `to` with no new input.
  function run(s, to) {
    if (to <= s.t) return s;
    let activeEnd = s.t;
    if (!s.focused) {
      activeEnd = to;
    } else if (s.moving) {
      const stillAt = s.lastSample + config.MOUSE_STILL_AFTER;
      activeEnd = Math.min(to, stillAt);
      if (to > stillAt) s.moving = false;
    }
    if (activeEnd > s.t) {
      s.score = Math.min(max, s.score + risePerMs * (activeEnd - s.t));
      s.lastActive = activeEnd;
    }
    const fallFrom = Math.max(activeEnd, s.lastActive + config.RECOVERY_DELAY);
    if (to > fallFrom) s.score = Math.max(0, s.score - fallPerMs * (to - fallFrom));
    s.t = to;
    return s;
  }

  return {
    // A pointer position at time t. Returns false if it came too soon after the last sample to count.
    pointerMoved(x, y, t) {
      t = Math.max(t, state.t);
      if (t - state.lastSample < config.MOUSE_MOVEMENT_SAMPLE_RATE) return false;
      run(state, t);
      state.lastSample = t;
      if (Math.hypot(x - state.anchorX, y - state.anchorY) > config.JITTER_THRESHOLD) {
        state.moving = true;
        state.anchorX = x;
        state.anchorY = y;
      }
      return true;
    },

    setFocused(focused, t) {
      run(state, Math.max(t, state.t));
      state.focused = !!focused;
    },

    // The score and whether the pointer counts as moving at time t (at or after the last input).
    at(t) {
      const s = run({ ...state }, t);
      return { score: s.score, moving: s.moving };
    },
  };
}

// Wall-clock time for the model, with any gap between two looks at the clock counted as at most
// maxStep ms. A page that was frozen or starved for minutes then moves the score by one modest
// step, not by the whole gap at once.
export function createSteppedClock(maxStep, wallNow) {
  let lastWall = wallNow;
  let now = 0;
  return {
    // Model time at wall time `wall`; `eventWall` (optional, not after `wall`) is when an input
    // being reported now actually happened.
    time(wall, eventWall = wall) {
      now += Math.min(Math.max(0, wall - lastWall), maxStep);
      lastWall = Math.max(lastWall, wall);
      return now - Math.min(Math.max(0, wall - eventWall), maxStep);
    },
  };
}
