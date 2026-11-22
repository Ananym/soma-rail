// End-to-end smoke check of the built app in headless Chromium.
//   npm run build && node scripts/app-check.cjs [out-dir]
// Runs five cases, clicking Start in each: the plain address, the same with tuning parameters (and a
// check that distraction brakes the train), a browser without WebGL2 (a notice, radio still playing)
// and streams refusing CORS (must keep playing, without analysis). No case may contact YouTube.
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
  const Q = '?debug=1&budget=120000&seed=check';
  const cases = [
    // The plain address, as a visitor arrives: the train window, with music analysis live.
    // (At the full default splat budget a software renderer draws too slowly for the analysis to
    // settle, so this case only requires that the radio is attached and its audio context running.)
    { name: 'default', query: '', wait: 20000, expect: 'window', tap: 'attached' },
    // the listener clicks Start before the stream is known: one click must still start the radio
    { name: 'early-click', query: '?budget=120000&seed=check', wait: 25000, expect: 'window', early: true },
    { name: 'tuned', query: Q, wait: 20000, expect: 'window', tap: true, distraction: true },
    // No WebGL2: a notice instead of the view, and the radio plays on.
    { name: 'no-webgl2', query: Q, wait: 8000, expect: 'notice',
      init: () => { const orig = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl2' ? null : orig.call(this, type, ...rest); }; } },
    // Streams refuse CORS requests: the audio element must be remounted without CORS and still play.
    { name: 'cors-refused', query: Q, wait: 20000, expect: 'window', tap: false, settle: 12000, noisy: true,
      route: async (page) => page.route(/ice\d\.somafm\.com/, async (route) => { const h = await route.request().allHeaders(); return h.origin ? route.abort() : route.continue(); }) },
  ];
  for (const c of cases.filter((k) => !process.env.ONLY || k.name === process.env.ONLY)) {
    const name = c.name;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
    const page = await ctx.newPage();
    if (c.init) await page.addInitScript(c.init);
    if (c.route) await c.route(page);
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 240)));
    const youtube = [];
    page.on('request', (r) => { if (/youtube|ytimg|googlevideo/i.test(r.url())) youtube.push(r.url()); });
    await page.goto(`http://127.0.0.1:${port}/${c.query}`);
    await page.waitForSelector('.start-overlay', { timeout: 30000 });
    // `early` clicks Start the moment it appears, before the stream is known: one click must still do.
    if (!c.early) await page.waitForFunction(() => { const a = document.querySelector('audio'); return a && a.src; }, null, { timeout: 30000 });
    if (c.settle) await page.waitForTimeout(c.settle);     // let the CORS fallback run before Start
    await page.click('.start-overlay');
    await page.waitForTimeout(400);
    const goneAtOnce = await page.evaluate(() => !document.querySelector('.start-overlay'));
    await page.waitForTimeout(c.wait);
    const state = await page.evaluate(() => {
      const a = document.querySelector('audio');
      return {
        audio: a ? { paused: a.paused, time: +a.currentTime.toFixed(1), crossOrigin: a.crossOrigin, error: a.error && a.error.code } : null,
        startGone: !document.querySelector('.start-overlay'),
        goneAtOnce: false,
        hasCanvas: !!document.querySelector('.window-container canvas'),
        windowHidden: !!document.querySelector('.window-container.hidden'),
        notice: !!document.querySelector('.no-view'),
        engine: window.__trainWindow ? window.__trainWindow.stats() : null,
        tap: window.__trainWindowAudio ? window.__trainWindowAudio() : null,
      };
    });
    state.goneAtOnce = goneAtOnce;
    // Distraction in the generated view brakes the train instead of fading to black. Check the wiring:
    // losing focus must lower the rate the director runs at, and nothing may draw a black overlay.
    // (How fast it brakes cannot be judged here: on a software renderer the page's timers starve,
    // so the distraction score climbs far more slowly than on a real machine.)
    let brake = null;
    if (c.distraction) {
      const rate = () => page.evaluate(() => window.__trainWindow.director.state.rate);
      const before = await rate();
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.waitForTimeout(15000);
      const after = await rate();
      const overlay = await page.evaluate(() => !!document.querySelector('.window-container .distraction-overlay'));
      brake = { rateBefore: +before.toFixed(2), rateAfterBlur: +after.toFixed(2), overlay, ok: after < before - 0.03 && !overlay };
      // With IDLE=1, hold the distraction until the train has stopped (minutes on a software renderer)
      // and require the engine to go idle and the music effects to rest. Off by default for its length.
      if (process.env.IDLE === '1') {
        const t0 = Date.now();
        while (Date.now() - t0 < 420000 && (await rate()) > 0) await page.waitForTimeout(5000);
        const t1 = Date.now();   // then the brake itself, which is slow at a few frames a second
        while (Date.now() - t1 < 240000 && !(await page.evaluate(() => window.__trainWindow.stats().idle))) await page.waitForTimeout(3000);
        const idle = await page.evaluate(() => { const s = window.__trainWindow.stats(), d = window.__trainWindow.director.state;
          return { rate: d.rate, kmh: s.kmh, idle: s.idle, beat: d.beat, sparkle: d.sparkle, breath: d.breath,
            still: document.querySelector('.window-container').classList.contains('still') }; });
        brake.idle = idle;
        brake.ok = brake.ok && idle.rate === 0 && idle.idle === true && idle.still && idle.beat === 0 && idle.sparkle === 0 && idle.breath === 0;
      }
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      // The overlay's controls: they show while the mouse moves, and each must reach the engine.
      // (The buttons are pressed from inside the page: this renderer is too slow for a real pointer
      // to reach a button before the overlay fades again, and the wiring is what is being checked.)
      const press = async (sel, text) => {
        await page.evaluate(({ sel, text }) => {
          const b = [...document.querySelectorAll(sel)].find((e) => !text || e.textContent.trim() === text);
          if (!b) throw new Error('no button ' + sel + ' ' + text);
          b.click();
        }, { sel, text });
        await page.waitForTimeout(600);
      };
      const D = () => page.evaluate(() => { const d = window.__trainWindow.director.state; const p = d.queued || (d.tunnel && d.tunnel.phase === 'approach' ? d.tunnel.next : d); return { biome: d.biome, level: d.level, wantBiome: p.biome, wantLevel: p.level, rate: d.rate, fpsCap: window.__trainWindow.stats().fpsCap }; });
      const c0 = await D();
      await press('.view-controls .row:nth-child(1) button', 'Next');
      const c1 = await D();
      await press('.view-controls .row:nth-child(2) button');
      const c2 = await D();
      await press('.view-controls .group button', '30');
      const c3 = await D();
      await press('.view-controls .row:nth-child(3) button');
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.waitForTimeout(6000);
      const c4 = await D();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await press('.view-controls .row:nth-child(5) button', 'Credits');
      await page.waitForTimeout(1500);
      const credits = await page.evaluate(() => ({ open: !!document.querySelector('.credits'), items: document.querySelectorAll('.credits li').length, soma: !!document.querySelector('.credits a[href*="somafm.com"]') }));
      await press('.credits .close');
      const creditsClosed = await page.evaluate(() => !document.querySelector('.credits'));
      const controls = { before: c0, nextBiome: c1.wantBiome, dreamlike: c2.wantLevel, fpsCap: c3.fpsCap, rateWhileCheating: c4.rate,
        ok: c1.wantBiome !== c0.wantBiome && c2.wantLevel === 1 - c1.wantLevel && c0.fpsCap === 60 && c3.fpsCap === 30 && c4.rate === 1 && credits.open && credits.items >= 8 && credits.soma && creditsClosed, credits };
      brake.controls = controls; brake.ok = brake.ok && controls.ok;
    }
    await page.screenshot({ path: path.join(outDir, `app-${name}.png`), timeout: 120000 }).catch(() => console.log('(screenshot skipped: renderer too slow)'));
    // Only the case that breaks the streams on purpose may log load failures.
    let ours = c.noisy ? errors.filter((e) => !/Failed to load resource|net::ERR|Audio error|server attempts/i.test(e)) : errors;
    // The minutes-long IDLE run rides out the odd dropped poll through a proxy; nothing else is excused.
    if (process.env.IDLE === '1') for (let i = ours.length - 1; i >= 0; i--) if (/net::ERR_CONNECTION_RESET/.test(ours[i])) ours.splice(i, 1);
    if (youtube.length) ours.push(`requests to YouTube hosts: ${youtube.length}`);
    console.log(`\n== ${name}`); console.log(JSON.stringify(state)); if (brake) console.log('brake:', JSON.stringify(brake));
    if (ours.length) { console.log('errors:'); for (const e of ours) console.log('  ' + e); }
    const audioOk = state.audio && !state.audio.paused && state.audio.time > 0.5;
    const viewOk = c.expect === 'notice'
      ? state.notice && !state.hasCanvas
      : state.hasCanvas && !state.windowHidden && !state.notice && state.engine && state.engine.splats > 0;
    const tapOk = c.tap === undefined ? true
      : c.tap ? !!(state.tap && (c.tap === 'attached' || state.tap.active) && state.tap.context === 'running' && state.audio.crossOrigin === 'anonymous')
        : !state.tap && state.audio.crossOrigin === null;
    const ok = state.startGone && state.goneAtOnce && audioOk && viewOk && tapOk && !ours.length && (!brake || brake.ok);
    console.log(ok ? 'PASS' : `FAIL (start ${state.startGone}, at once ${state.goneAtOnce}, audio ${!!audioOk}, view ${!!viewOk}, analysis ${tapOk})`); if (!ok) failed = true;
    await ctx.close();
  }
  await browser.close(); server.httpServer.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
