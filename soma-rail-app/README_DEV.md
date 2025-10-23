# Soma Rail - Development Status

## Current Status

The application has been built and is running at: http://localhost:5173/

### What's Working
- ✅ Vue 3 + Vite setup
- ✅ Component structure
- ✅ Interaction detection system (mouse movement, focus tracking)
- ✅ Distraction score calculation
- ✅ Playback rate control logic
- ✅ Channel selector UI with Soma FM donation link
- ✅ Now playing display
- ✅ LocalStorage persistence
- ✅ UI fade behavior

### Known Issues

#### 1. YouTube Video (Black Screen)
**Status:** Player initializes but video may not be visible
**Possible causes:**
- YouTube API postMessage warnings (shouldn't prevent playback)
- Ad blocker interference (ERR_BLOCKED_BY_CLIENT)
- Autoplay policy restrictions

**Debug steps:**
1. Open browser console
2. Look for "YouTube player ready" message
3. Check for any YT player errors
4. Try clicking on the page to enable autoplay
5. Disable ad blockers temporarily

#### 2. Soma FM Audio (403 Forbidden)
**Status:** Streams return HTTP 403 errors
**Current URLs:** `https://ice1.somafm.com/[channel]-128-mp3`

**Attempted fixes:**
- ✅ Added CORS headers
- ✅ Server fallback (ice2 → ice1)
- ✅ Prefer lower quality streams
- ⏳ May need to try AAC format instead of MP3
- ⏳ May need to adjust referrer headers
- ⏳ May need to use PLS URLs directly

**Next steps to try:**
1. Test with AAC streams instead of MP3
2. Check if geographic restrictions apply
3. Test with different user agents
4. Consider using the PLS URL directly (some browsers can handle it)

## Testing the Application

1. Open http://localhost:5173/
2. Open browser console (F12) to see debug messages
3. Test the interaction system:
   - Move mouse → video should slow down, audio should fade
   - Stay still → everything should return to normal over 5 seconds
   - Switch tabs → should trigger degradation
   - Return focus → should recover

## Configuration

Edit `src/config.js` to adjust:
- `JITTER_THRESHOLD`: Mouse movement sensitivity (default: 5px)
- `DISTRACTION_INCREMENT`: How fast distraction builds up (default: 15)
- `RECOVERY_DURATION`: How long recovery takes (default: 5000ms)
- `UI_FADE_DELAY`: When UI fades out (default: 3000ms)
- `YOUTUBE_VIDEO_ID`: The train video to use

## Development Commands

```bash
cd soma-rail-app
npm run dev    # Start dev server
npm run build  # Build for production
npm run preview # Preview production build
```

## Architecture

- **Composables**: Reusable logic (Soma FM API, interaction detection, playback control)
- **Components**: UI pieces (VideoPlayer, AudioPlayer, ChannelSelector, NowPlaying)
- **Utils**: Helper functions (PLS parser)
- **Config**: Centralized configuration constants
