# Ice3 Server Update

## Changes Made

Based on your suggestion to try ice3, I've updated the entire audio system to use **ice3.somafm.com** as the default server, with automatic fallback to other servers if it fails.

## What Changed

### 1. PLS Parser (src/utils/plsParser.js)
- **Default server changed**: ice1 → ice3
- **Configurable server selection**: Can now specify which ice server to use
- **Multiple server support**: Added function to get all available server URLs
- Servers tried in order: ice3 → ice1 → ice4 → ice5 → ice6

### 2. Audio Player (src/components/AudioPlayer.vue)
- **Automatic retry logic**: If ice3 fails, automatically tries ice1, ice4, ice5, ice6
- **Enhanced error logging**: Now logs error codes and messages
- **Smart recovery**: Cycles through all 5 ice servers before giving up
- **Reset on channel change**: Server attempts reset when switching channels

### 3. Diagnostics Tool (src/components/AudioDiagnostics.vue)
- **Now uses ice3 by default** in all tests
- Shows which server is being used in results

### 4. Tests (src/utils/plsParser.test.js)
- ✅ All 15 tests passing
- Updated to test ice3 as default
- Added tests for server selection options
- Tests for 'original' mode (no replacement)

## How It Works Now

### On Initial Load:
1. Fetch channel's PLS file
2. Parse and replace server with **ice3**
3. Try to play stream

### On Error:
1. Log detailed error information
2. Try **ice1** (attempt 1/5)
3. If still failing, try **ice4** (attempt 2/5)
4. Continue through ice5, ice6
5. Give up after 5 attempts

### Example Console Output:
```
New stream URL loaded: https://ice3.somafm.com/groovesalad-128-mp3
Audio error: MEDIA_ELEMENT_ERROR: Format error
Audio error code: 4
Attempting recovery (attempt 1/5)...
Trying server ice1: https://ice1.somafm.com/groovesalad-128-mp3
...
```

## Testing the Changes

### 1. In the Diagnostic Tool:
- Click `+` at bottom-left
- Click "Run All Tests"
- Watch the "PLS File Test" - should show: "Successfully parsed PLS (using ice3 server)"
- Click "Test Audio Load" to try loading with ice3

### 2. In the Main App:
- Click "Click to Start Audio" button
- Check browser console (F12) for:
  - "New stream URL loaded: https://ice3.somafm.com/..."
  - If error, watch for retry attempts with different servers

### 3. Run Tests:
```bash
npm run test:run
```
Should see: ✅ **15 tests passed**

## Server Priority

The new server order is based on testing and your suggestion:

1. **ice3** - Your suggested server (now default)
2. **ice1** - Most commonly referenced
3. **ice4** - Backup server
4. **ice5** - Additional backup
5. **ice6** - Final fallback

## Expected Behavior

When you refresh the page and use the diagnostic tool:

**If ice3 works:**
- Stream loads immediately
- No retry attempts needed
- Audio plays successfully

**If ice3 fails:**
- Console shows "Attempting recovery"
- Automatically tries ice1
- Continues through other servers
- One of them should work!

## Manual Testing

Try the diagnostic tool's **"Test Audio Load"** button now. It should:

1. Show: "Status: success" if ice3 works
2. Display a working audio player with controls
3. Stream should load and be playable

If it still shows "Format error", the audio controls will try the other servers automatically when you click play.

## Next Steps if Still Not Working

If all servers fail:
1. Check if AAC format works better than MP3
2. Try removing `crossorigin="anonymous"` attribute
3. May need to use a proxy server
4. Could be geographic/IP restrictions

Try the diagnostic tool now and let me know what you see!
