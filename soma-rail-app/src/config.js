export const CONFIG = {
  JITTER_THRESHOLD: 5,              // pixels
  DISTRACTION_INCREMENT: 1.1,       // points per frame when active (~60fps means 100 in ~1.5s)
  DISTRACTION_MAX: 100,             // maximum distraction score
  RECOVERY_DURATION: 5000,          // ms
  UI_FADE_DELAY: 3000,              // ms of inactivity before UI fades
  METADATA_POLL_INTERVAL: 45000,    // ms (45 seconds)
  MOUSE_MOVEMENT_SAMPLE_RATE: 16,   // ms (~60fps)
  YOUTUBE_VIDEO_ID: 'rQ8dD216SPs',  // Default train video
};
