// End-to-end smoke check of the built app in headless Chromium.
//   npm run build && node scripts/app-check.cjs [out-dir]
// Runs four cases, clicking Start in each: the plain address, the same with tuning parameters (and a
// check that moving the mouse or losing focus brakes the train on time, and that it pulls away
// again on time), a browser without WebGL2 (a notice, radio still playing)
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
        notice: !!document.querySelector('.no-view'),
        engine: window.__trainWindow ? window.__trainWindow.stats() : null,
        tap: window.__trainWindowAudio ? window.__trainWindowAudio() : null,
      };
    });
    // Distraction in the generated view brakes the train instead of fading to black, and how fast it
    // brakes and pulls away is set by the clock, not by how often the page gets a turn. So this holds
    // even here, where a software renderer leaves seconds between frames:
    //   - moving the mouse, with the window still focused, stops the train in about 1.5 s;
    //   - once the mouse is still it holds for 2 s and is back to full speed 5 s later;
    //   - losing focus stops it in about 1.5 s as well;
    // and nothing may draw a black overlay. Every time is taken inside the page, from the input's
    // own timestamp to the moment the director is given the rate. The page can only act when it
    // gets a turn, so each may run late by a frame or two (SLACK), never early.
    let brake = null;
    if (c.distraction) {
      const SLACK = 7500, STOP = 1455, AWAY = 7050;   // ms; AWAY = 100 until the mouse counts as still + 2000 + 99% of 5000
      const rate = () => page.evaluate(() => window.__trainWindow.director.state.rate);
      const before = await rate();
      await page.evaluate(() => {
        const d = window.__trainWindow.director, set = d.setRate.bind(d);
        window.__rates = [];
        d.setRate = (r) => { window.__rates.push([performance.now(), r]); set(r); };
        window.__firstMove = window.__lastMove = 0;
        document.addEventListener('pointermove', (e) => {
          const raw = e.getCoalescedEvents();
          if (!window.__firstMove) window.__firstMove = raw.length ? raw[0].timeStamp : e.timeStamp;
          window.__lastMove = e.timeStamp;
        }, true);
      });
      // First time, in ms after `since`, that the director was given a rate passing `test`.
      const reached = async (since, test, patience) => {
        for (const t0 = Date.now(); ;) {
          const ms = await page.evaluate(([since, test]) => {
            const from = window[since];
            const hit = from && window.__rates.find(([t, r]) => t >= from && (test === 'stopped' ? r <= 0.02 : r >= 0.99));
            return hit ? Math.round(hit[0] - from) : null;
          }, [since, test]);
          if (ms !== null || Date.now() - t0 > patience) return ms;
          await page.waitForTimeout(500);
        }
      };
      // The mouse moves as a hand would, sixty times a second whatever the page is doing: the moves
      // are sent without waiting for the page to take each one (page.mouse.move would wait).
      const cdp = await ctx.newCDPSession(page);
      const sends = [];
      let moving = true;
      const hand = (async () => {
        for (let i = 0; moving; i++) {
          sends.push(cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 340 + (i % 50) * 12, y: 260 + (i % 7) * 20 }).catch(() => {}));
          await new Promise((r) => setTimeout(r, 16));
        }
      })();
      const mouseStopMs = await reached('__firstMove', 'stopped', 20000);
      moving = false; await hand; await Promise.all(sends);
      const pullAwayMs = await reached('__lastMove', 'moving', 25000);
      await page.evaluate(() => { const e = new Event('blur'); window.__blurAt = e.timeStamp; window.dispatchEvent(e); });
      const blurStopMs = await reached('__blurAt', 'stopped', 20000);
      const overlay = await page.evaluate(() => !!document.querySelector('.window-container .distraction-overlay'));
      const within = (ms, ideal) => ms !== null && ms >= ideal - 60 && ms <= ideal + SLACK;
      brake = { rateBefore: +before.toFixed(2), mouseStopMs, pullAwayMs, blurStopMs, moves: sends.length, overlay,
        ok: before >= 0.99 && within(mouseStopMs, STOP) && within(pullAwayMs, AWAY) && within(blurStopMs, STOP) && !overlay };
      // With IDLE=1, hold the distraction until the train itself has come to rest (the rate is zero
      // at once, but the brake is slow on a software renderer) and require the engine to go idle and
      // the music effects to rest. Off by default for its length.
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
    const ok = state.startGone && audioOk && viewOk && tapOk && !ours.length && (!brake || brake.ok);
    console.log(ok ? 'PASS' : `FAIL (start ${state.startGone}, audio ${!!audioOk}, view ${!!viewOk}, analysis ${tapOk}${brake ? `, brake ${brake.ok}` : ''})`); if (!ok) failed = true;
    await ctx.close();
  }
  await browser.close(); server.httpServer.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
