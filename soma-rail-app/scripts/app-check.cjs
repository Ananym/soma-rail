// End-to-end smoke check of the built app in headless Chromium.
//   npm run build && node scripts/app-check.cjs [out-dir]
// Runs four cases, clicking Start in each: the default video view, the generated view (with music
// analysis live), the generated view without WebGL2 (must fall back to the video) and the generated
// view with streams refusing CORS (must keep playing, without analysis).
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
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  let failed = false;
  const GEN = '?view=generated&debug=1&budget=120000&seed=check';
  const cases = [
    { name: 'video', query: '', wait: 4000, expect: 'video' },
    { name: 'generated', query: GEN, wait: 20000, expect: 'generated', tap: true },
    // No WebGL2: the generated view must hand over to the video without disturbing the radio.
    { name: 'no-webgl2', query: GEN, wait: 8000, expect: 'video',
      init: () => { const orig = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl2' ? null : orig.call(this, type, ...rest); }; } },
    // Streams refuse CORS requests: the audio element must be remounted without CORS and still play.
    { name: 'cors-refused', query: GEN, wait: 20000, expect: 'generated', tap: false, settle: 12000,
      route: async (page) => page.route(/ice\d\.somafm\.com/, async (route) => { const h = await route.request().allHeaders(); return h.origin ? route.abort() : route.continue(); }) },
  ];
  for (const c of cases) {
    const name = c.name;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
    const page = await ctx.newPage();
    if (c.init) await page.addInitScript(c.init);
    if (c.route) await c.route(page);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 240)));
    await page.goto(`http://127.0.0.1:${port}/${c.query}`);
    await page.waitForSelector('.start-overlay', { timeout: 30000 });
    await page.waitForFunction(() => { const a = document.querySelector('audio'); return a && a.src; }, null, { timeout: 30000 });
    if (c.settle) await page.waitForTimeout(c.settle);     // let the CORS fallback run before Start
    await page.click('.start-overlay');
    await page.waitForTimeout(c.wait);
    const state = await page.evaluate(() => {
      const a = document.querySelector('audio');
      return {
        audio: a ? { paused: a.paused, time: +a.currentTime.toFixed(1), crossOrigin: a.crossOrigin, error: a.error && a.error.code } : null,
        startGone: !document.querySelector('.start-overlay'),
        hasCanvas: !!document.querySelector('.window-container canvas'),
        windowHidden: !!document.querySelector('.window-container.hidden'),
        hasVideo: !!document.querySelector('.video-container'),
        videoHidden: !!document.querySelector('.video-container.hidden'),
        engine: window.__trainWindow ? window.__trainWindow.stats() : null,
        tap: window.__trainWindowAudio ? window.__trainWindowAudio() : null,
      };
    });
    await page.screenshot({ path: path.join(outDir, `app-${name}.png`), timeout: 120000 }).catch(() => console.log('(screenshot skipped: renderer too slow)'));
    // YouTube's embed logs its own noise, and the cases that break things on purpose log theirs.
    const ours = errors.filter((e) => !/youtube|googlevideo|doubleclick|ERR_BLOCKED|net::ERR|Permissions policy|Failed to load resource|Audio error|server attempts/i.test(e));
    console.log(`\n== ${name}`); console.log(JSON.stringify(state));
    if (ours.length) { console.log('errors:'); for (const e of ours) console.log('  ' + e); }
    const audioOk = state.audio && !state.audio.paused && state.audio.time > 0.5;
    const viewOk = c.expect === 'video'
      ? state.hasVideo && !state.videoHidden && !state.hasCanvas
      : state.hasCanvas && !state.windowHidden && state.engine && state.engine.splats > 0;
    const tapOk = c.tap === undefined ? true
      : c.tap ? !!(state.tap && state.tap.active && state.tap.context === 'running' && state.audio.crossOrigin === 'anonymous')
        : !state.tap && state.audio.crossOrigin === null;
    const ok = state.startGone && audioOk && viewOk && tapOk && !ours.length;
    console.log(ok ? 'PASS' : `FAIL (start ${state.startGone}, audio ${!!audioOk}, view ${!!viewOk}, analysis ${tapOk})`); if (!ok) failed = true;
    await ctx.close();
  }
  await browser.close(); server.httpServer.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
