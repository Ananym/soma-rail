export const CONFIG = {
  JITTER_THRESHOLD: 5,              // pixels
  DISTRACTION_INCREMENT: 1.1,       // points per frame when active (~60fps means 100 in ~1.5s)
  DISTRACTION_MAX: 100,             // maximum distraction score
  RECOVERY_DURATION: 5000,          // ms
  UI_FADE_DELAY: 3000,              // ms of inactivity before UI fades
  // How often to ask SomaFM what is playing. A new track changes the scenery, so the change should
  // be noticed soon after it happens: once a track has been on for a while the next one is due,
  // and we ask more often.
  METADATA_POLL_INTERVAL: 20000,    // ms, while a track is young
  METADATA_POLL_FAST: 8000,         // ms, once it has been playing for METADATA_FAST_AFTER
  METADATA_FAST_AFTER: 75000,       // ms
  MOUSE_MOVEMENT_SAMPLE_RATE: 16,   // ms (~60fps)
};
