# Brave Browser GPC (Global Privacy Control) Issue

## The Real Problem

Your **Brave browser** is sending `sec-gpc: 1` header, which Soma FM servers are **blocking with 403 Forbidden**.

## Header Comparison

### Your Request (403 Forbidden) ❌
```
sec-gpc: 1                          ← THIS IS THE PROBLEM
referer: http://localhost:5173/
sec-fetch-mode: no-cors
```

### Soma FM Popup (200 OK) ✅
```
(no sec-gpc header)
referer: https://somafm.com/
sec-fetch-mode: no-cors
```

## What is sec-gpc?

**Global Privacy Control (GPC)** is a privacy signal that Brave sends to tell websites:
- "Don't sell my data"
- "Don't track me"
- "Respect my privacy"

Unfortunately, Soma FM's servers are configured to **block** requests with this header, likely to prevent automated scraping or unauthorized embedding.

## Solutions

### 🎯 Solution 1: Test in Different Browser (Quickest)

Open in **Chrome** or **Firefox** (without privacy extensions):
- Should work immediately
- Confirms GPC is the issue

### ⚙️ Solution 2: Disable GPC in Brave (Temporary)

1. Go to `brave://settings/shields`
2. Find "Global Privacy Control"
3. Toggle it **OFF**
4. Refresh the page: http://localhost:5173/

⚠️ This reduces privacy protection system-wide.

### 🔧 Solution 3: Try Different Servers (What I Just Did)

I've updated the code to try servers in this order:
1. **ice6** (default now) - Might have different GPC handling
2. ice5
3. ice4
4. ice1
5. ice3

**Refresh the page now** - it will try ice6 first!

### 🌐 Solution 4: Try AAC Format

Different stream formats might use different servers with different GPC policies.

I can update the code to prefer AAC over MP3 if ice6 doesn't work.

### 🛠️ Solution 5: Proxy Server (Most Reliable)

If all else fails, we need a backend proxy:

```javascript
// Backend (Express)
app.get('/stream/:channel', async (req, res) => {
  const stream = await fetch(`https://ice1.somafm.com/${req.params.channel}`);
  stream.body.pipe(res);
});

// Frontend
audio.src = '/stream/groovesalad-128-mp3';
```

This bypasses browser headers entirely.

### 🔬 Solution 6: Contact Soma FM

Ask them to whitelist GPC requests for legitimate apps.

## Why This Happens

Soma FM likely blocks GPC to:
1. **Prevent scraping** - Automated tools often respect privacy headers
2. **Control distribution** - They want to know who's embedding their streams
3. **Server configuration** - May be unintentional blocking of privacy-focused browsers

## Testing Steps

1. **First**: Refresh page - try ice6 server
2. **If still 403**: Test in Chrome/Firefox
3. **If works in Chrome**: It's definitely GPC
4. **If still fails everywhere**: Try solutions 4-6

## Expected Console Output

After refresh, you should see:
```
New stream URL loaded: https://ice6.somafm.com/groovesalad-128-mp3
Audio loaded and ready
Audio can play
Audio playing
```

If you still see errors, check which ice server it tried and the error details.

## Current Status

✅ Changed default server: ice3 → ice6
✅ Updated retry order: ice6, ice5, ice4, ice1, ice3
⏳ Waiting to test if ice6 bypasses GPC check

**Refresh the page now and check if ice6 works!**

If not, we'll need to either:
- Disable GPC in Brave
- Use a different browser
- Implement a proxy solution
