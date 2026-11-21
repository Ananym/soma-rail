// End-to-end smoke check of the built app in headless Chromium.
//   npm run build && node scripts/app-check.cjs [out-dir]
// Loads the default (video) view and the generated view, clicks Start in each, and reports
// console errors, whether audio is playing and what the generated view's engine says.
// It talks to the real SomaFM servers, so it needs network access (HTTPS_PROXY is honoured).
// Headless Chromium renders in software here: this checks wiring, never frame rate or looks.
const path = require('path');
const fs = require('fs');
const outDir = process.argv[2] || '.';

(async () => {
  const { preview } = await import('vite');
  const { chromium } = require('playwright');
  const server = await preview({ root: path.join(__dirname, '..'), logLevel: 'error', preview: { port: 0, host: '127.0.0.1' } });
  const port = server.httpServer.address().port;
  const browser = await chromium.launch({
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
    args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  let failed = false;
  for (const [name, query, waitFor] of [
    ['video', '', 4000],
    ['generated', '?view=generated&debug=1&budget=120000&seed=check', 20000],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 240)));
    const streams = [];
    page.on('response', (r) => { if (/ice\d\.somafm\.com/.test(r.url())) streams.push(`${r.status()} ${r.url().replace('https://', '')} origin=${r.request().headers().origin ? 'sent' : 'none'}`); });
    await page.goto(`http://127.0.0.1:${port}/${query}`);
    await page.waitForSelector('.start-overlay', { timeout: 30000 });
    await page.waitForFunction(() => { const a = document.querySelector('audio'); return a && a.src; }, null, { timeout: 30000 });
    await page.click('.start-overlay');
    await page.waitForTimeout(waitFor);
    const state = await page.evaluate(() => {
      const a = document.querySelector('audio');
      return {
        audio: a ? { paused: a.paused, time: +a.currentTime.toFixed(1), crossOrigin: a.crossOrigin, error: a.error && a.error.code } : null,
        startGone: !document.querySelector('.start-overlay'),
        hasCanvas: !!document.querySelector('.window-container canvas'),
        windowHidden: !!document.querySelector('.window-container.hidden'),
        hasVideo: !!document.querySelector('.video-container'),
        engine: window.__trainWindow ? window.__trainWindow.stats() : null,
        tap: window.__trainWindowAudio ? window.__trainWindowAudio() : null,
      };
    });
    await page.screenshot({ path: path.join(outDir, `app-${name}.png`), timeout: 120000 }).catch(() => console.log('(screenshot skipped: renderer too slow)'));
    // YouTube's embed logs its own noise; only our origin's errors count.
    const ours = errors.filter((e) => !/youtube|googlevideo|doubleclick|ERR_BLOCKED|net::ERR|Permissions policy/i.test(e));
    console.log(`\n== ${name}`); console.log(JSON.stringify(state)); console.log('streams:', streams.slice(0, 3).join(' | '));
    if (ours.length) { console.log('errors:'); for (const e of ours) console.log('  ' + e); }
    const ok = state.startGone && state.audio && !state.audio.paused && state.audio.time > 0.5 && !ours.length &&
      (name === 'video' ? state.hasVideo && !state.hasCanvas : state.hasCanvas && !state.windowHidden && state.engine && state.engine.splats > 0);
    console.log(ok ? 'PASS' : 'FAIL'); if (!ok) failed = true;
    await ctx.close();
  }
  await browser.close(); server.httpServer.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
