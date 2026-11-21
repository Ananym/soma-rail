export const CONFIG = {
  JITTER_THRESHOLD: 5,              // pixels
  DISTRACTION_RISE_PER_SECOND: 68.75, // points per second while distracted: 0 to 100 in about 1.5 s
  DISTRACTION_MAX: 100,             // maximum distraction score
  DISTRACTION_MAX_STEP: 5000,       // ms: the most time one update of the score may account for (longer than a
                                    // throttled background tab's 1 s timers, far shorter than a frozen tab's minutes)
  RECOVERY_DELAY: 2000,             // ms of calm before the score starts to fall
  RECOVERY_DURATION: 5000,          // ms for the score to fall from maximum to zero
  UI_FADE_DELAY: 3000,              // ms of inactivity before UI fades
  METADATA_POLL_INTERVAL: 45000,    // ms (45 seconds)
  MOUSE_MOVEMENT_SAMPLE_RATE: 16,   // ms: least time between two pointer samples
  MOUSE_STILL_AFTER: 100,           // ms without a move before the pointer counts as still
};
