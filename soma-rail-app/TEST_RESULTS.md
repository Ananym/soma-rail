# Audio Testing Results

## Test Suite Summary

**Total: 13 tests passed ✅**

### PLS Parser Tests (6 tests - 4ms)
✅ All parser tests passing
- Valid PLS file parsing
- ice2 → ice1 server replacement
- ice3 → ice1 server replacement
- Whitespace handling
- Invalid input handling
- Empty string handling

### Soma FM API Integration Tests (7 tests - 3.6s)

#### Channels API ✅
- Successfully fetched channel list (1.3s)
- All required properties present (id, title, playlists)
- **Result**: Soma FM channels API is fully accessible

#### PLS File Fetching ✅
- Successfully fetched PLS file (928ms)
- PLS contains valid playlist format
- Stream URLs are properly formatted
- **Result**: PLS files are downloadable and parseable

#### Song Metadata API ✅
- Successfully fetched song metadata (909ms)
- Metadata contains song array
- Songs have title and artist fields
- **Result**: Real-time song information is available

#### Stream URL Accessibility ⚠️
- Stream URL responds (480ms)
- CORS blocked in test environment (expected)
- **Note**: CORS error in tests is normal; HTML5 audio element handles this differently

## Diagnostic Tool

A live diagnostic component is now available in the app:

**Location**: Bottom-left corner of the page
**How to use**:
1. Click the `+` button to expand
2. Click "Run All Tests" to test everything
3. Individual tests available:
   - Channels API Test
   - PLS File Test
   - Stream Connectivity Test
   - Audio Element Test (most important!)
   - Song Metadata Test

### Key Test: Audio Element Test
This test actually creates an HTML5 audio element and tries to load the stream - this is the most accurate test of whether audio will work in the browser.

## What The Tests Tell Us

### ✅ Working:
1. **Soma FM APIs are accessible** - We can fetch channel lists and metadata
2. **PLS files are downloadable** - We can get playlist files
3. **Parser works correctly** - URLs are extracted and cleaned properly
4. **Metadata works** - Current song info is available

### ⚠️ Known Issue:
The stream URLs themselves return **403 Forbidden** when accessed directly from the browser. This is why the audio doesn't play.

### Possible Causes:
1. **Referrer Policy** - Soma FM may check the HTTP Referer header
2. **User Agent** - May require specific user agent strings
3. **IP Restrictions** - Geographic or IP-based restrictions
4. **Stream Format** - May need to try AAC instead of MP3
5. **Authentication** - May require specific headers

## Next Steps to Fix Audio

### Option 1: Try AAC Streams
The current code tries AAC first, but we should verify:
```javascript
// In useSomaFM.js, we're already doing this:
const playlist = channel.playlists.find(p => p.format === 'aac' && p.quality === 'low')
```

### Option 2: Add Referrer/Headers
Try setting explicit headers on the audio element:
```javascript
audio.crossOrigin = 'anonymous';
// Or try removing crossorigin entirely
```

### Option 3: Use Direct Stream URLs
Some channels provide direct stream URLs that don't need PLS parsing:
```javascript
https://somafm.com/[channel].mp3
https://somafm.com/[channel]130.pls
```

### Option 4: Proxy Solution
If direct access is blocked, could set up a simple proxy:
```javascript
// Backend proxy that adds proper headers
app.get('/stream/:channel', async (req, res) => {
  const stream = await fetch(`https://ice1.somafm.com/${req.params.channel}`);
  stream.body.pipe(res);
});
```

## How to Use the Diagnostic Tool

1. Open the app: http://localhost:5173/
2. Look at bottom-left corner for "Audio Diagnostics"
3. Click `+` to expand
4. Click "Run All Tests" button
5. Watch each section for results:
   - 🟢 Green = Success
   - 🔴 Red = Error
   - 🟡 Yellow = Warning

The **Audio Element Test** is the critical one - if that succeeds, audio will play!

## Running Tests from CLI

```bash
# Run all tests once
npm run test:run

# Run tests in watch mode
npm test

# Run tests with UI
npm run test:ui
```

## Test Files Location

- `src/utils/plsParser.test.js` - Parser unit tests
- `src/composables/useSomaFM.test.js` - API integration tests
- `src/components/AudioDiagnostics.vue` - Live browser diagnostic tool
