# Recent Updates - Soma Rail

## Fixed Issues

### ✅ Video Now Working
- YouTube video player is initialized and playing
- Train footage displays properly in fullscreen background
- Playback speed control is functioning

### ✅ UI Fade Behavior Fixed
- Channel selector and now-playing display now properly fade out after 3 seconds of mouse inactivity
- Fade is reactive and updates in real-time (checks every 100ms)
- UI returns when mouse moves

### ✅ Audio User Interaction Required
- Added prominent "Click to Start Audio" button
- Browsers require user interaction before playing audio
- Button appears in center of screen, click it to start the Soma FM stream
- Button disappears once audio starts playing

## Current State

**What You Should See:**
1. **Video**: Fullscreen train footage playing in background
2. **Channel Selector** (top-left): List of Soma FM channels with artwork
3. **Now Playing** (bottom-right): Current channel, song info, playback rate indicator
4. **Play Button** (center): Click this to start audio streaming

**Interaction System:**
- Move your mouse → video slows down, audio fades
- Stay still and focused → everything returns to normal over 5 seconds
- UI fades out after 3 seconds of stillness

## Testing Steps

1. Refresh the page at http://localhost:5173/
2. You should see the train video playing
3. Click the "Click to Start Audio" button in the center
4. Audio should start streaming from Soma FM
5. Try moving your mouse to test the distraction system
6. Stay still for 3+ seconds to see UI fade out

## If Audio Still Doesn't Work

Check the browser console (F12) for errors. The most common issues:

1. **403 Forbidden from Soma FM streams**
   - Some Soma FM servers may be restricted
   - The app tries to use ice1.somafm.com with fallback
   - Try switching to a different channel

2. **Ad Blocker Interference**
   - Temporarily disable ad blockers
   - Some blockers prevent audio streaming

3. **Browser Autoplay Policy**
   - Even with the button, some browsers may block
   - Make sure the page tab is in focus when clicking

## Debugging

Console logs to look for:
- "YouTube player ready" - video initialized
- "Initializing YouTube player with video ID" - video starting
- "Audio loaded and ready" - stream connected
- "Audio started via user interaction" - audio playing
- "Audio playing" - playback confirmed

## Configuration

You can adjust behavior in `src/config.js`:
```javascript
JITTER_THRESHOLD: 5,          // Mouse movement sensitivity
DISTRACTION_INCREMENT: 15,    // How fast distraction builds
DISTRACTION_MAX: 100,         // Maximum distraction level
RECOVERY_DURATION: 5000,      // Recovery time (ms)
UI_FADE_DELAY: 3000,         // UI fade delay (ms)
```
