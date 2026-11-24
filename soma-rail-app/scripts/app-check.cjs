// End-to-end smoke check of the built app in headless Chromium.
//   npm run build && node scripts/app-check.cjs [out-dir]
// Runs six cases, clicking Start in each: the plain address, the same with tuning parameters (and a
// check that distraction brakes the train), a browser without WebGL2 (a notice, radio still playing),
// streams refusing CORS (must keep playing, without analysis), and an emulated phone (no distraction,
// taps for the overlay, pause, silence in the background, both ways up). No case may contact YouTube.
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
    // (volume: a first visit starts at half, not at full)
    { name: 'default', query: '', wait: 20000, expect: 'window', tap: 'attached', budgetControl: true, volume: 0.5 },
    // the listener clicks Start before the stream is known: one click must still start the radio
    // (it also arrives with a volume saved on an earlier visit, which the radio must start at)
    { name: 'early-click', query: '?budget=120000&seed=check', wait: 25000, expect: 'window', early: true, volume: 0.3,
      init: () => { try { localStorage.setItem('volume', '0.3'); } catch { /* no storage */ } } },
    { name: 'tuned', query: Q, wait: 20000, expect: 'window', tap: true, distraction: true },
    // No WebGL2: a notice instead of the view, and the radio plays on.
    { name: 'no-webgl2', query: Q, wait: 8000, expect: 'notice',
      init: () => { const orig = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl2' ? null : orig.call(this, type, ...rest); }; } },
    // Streams refuse CORS requests: the audio element must be remounted without CORS and still play.
    { name: 'cors-refused', query: Q, wait: 20000, expect: 'window', tap: false, settle: 12000, noisy: true,
      route: async (page) => page.route(/ice\d\.somafm\.com/, async (route) => { const h = await route.request().allHeaders(); return h.origin ? route.abort() : route.continue(); }) },
    // A phone held upright, then turned: emulated touch, so only the wiring is proven here.
    { name: 'touch', query: '?budget=120000&seed=check', wait: 20000, expect: 'window', touch: true,
      context: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
  ];
  // Not one of the six: ONLY=signals listens to the real radio for SIGNAL_SECONDS (default 200) and
  // prints what the music signals did (director.state: beatBig, beatSmall, mid, weather, chaseOn,
  // events). The detectors behind them are tested on synthetic signals; this is the one look at
  // real music. Nothing is asserted beyond the usual start-up checks.
  if (process.env.ONLY === 'signals') cases.push({ name: 'signals', query: '?budget=60000&seed=check', wait: 20000, expect: 'window', tap: true, signals: Number(process.env.SIGNAL_SECONDS || 200) });
  for (const c of cases.filter((k) => !process.env.ONLY || k.name === process.env.ONLY)) {
    const name = c.name;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, ...(c.context || {}), userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
    const page = await ctx.newPage();
    if (c.init) await page.addInitScript(c.init);
    if (c.route) await c.route(page);
    const errors = [];
    const radioLog = [];   // what the player said about starting, printed if the radio is not playing
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); if (/radio|stream|server|Audio|playback/i.test(m.text())) radioLog.push(`${m.type()}: ${m.text().slice(0, 160)}`); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 240)));
    const youtube = [];
    page.on('request', (r) => { if (/youtube|ytimg|googlevideo/i.test(r.url())) youtube.push(r.url()); });
    await page.goto(`http://127.0.0.1:${port}/${c.query}`);
    await page.waitForSelector('.start-overlay', { timeout: 30000 });
    // `early` clicks Start the moment it appears, before the stream is known: one click must still do.
    if (!c.early) await page.waitForFunction(() => { const a = document.querySelector('audio'); return a && a.src; }, null, { timeout: 30000 });
    if (c.settle) await page.waitForTimeout(c.settle);     // let the CORS fallback run before Start
    if (c.touch) c.startText = (await page.textContent('.start-button')).trim();
    // The start screen says so when the view cannot be drawn, or only in software (which is what
    // this headless browser normally has): the warning must match what the browser really offers.
    const warn = await page.evaluate(() => {
      const w = document.querySelector('.start-warning'), text = w ? w.textContent.replace(/\s+/g, ' ').trim() : '';
      let gl = null, software = false;
      try { gl = document.createElement('canvas').getContext('webgl2'); } catch { /* none */ }
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || '');
        let caveat = false;
        try { caveat = !document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true }); } catch { caveat = true; }
        software = caveat || /swiftshader|llvmpipe|softpipe|software|basic render|warp/i.test(renderer);
      }
      return { text, webgl2: !!gl, software };
    });
    const warnOk = !warn.webgl2 ? /cannot be drawn/.test(warn.text) : warn.software ? /very slow/.test(warn.text) : warn.text === '';
    await page.click('.start-overlay');
    await page.waitForTimeout(400);
    const goneAtOnce = await page.evaluate(() => !document.querySelector('.start-overlay'));
    await page.waitForTimeout(c.wait);
    // A stream that stalls is asked for again from another server (AudioPlayer's watchdog): allow that.
    await page.waitForFunction(() => { const a = document.querySelector('audio'); return a && !a.paused && a.currentTime > 0.5; }, null, { timeout: 40000 }).catch(() => {});
    // Where live analysis is required, give the engine time to start and take its first frames: on
    // this renderer that alone can take longer than the wait above.
    if (c.tap === true) await page.waitForFunction(() => { const t = window.__trainWindowAudio && window.__trainWindowAudio(); return !!(t && t.active); }, null, { timeout: 90000 }).catch(() => {});
    const state = await page.evaluate(() => {
      const a = document.querySelector('audio');
      return {
        audio: a ? { paused: a.paused, time: +a.currentTime.toFixed(1), ready: a.readyState, net: a.networkState, hasSrc: !!a.getAttribute('src'), volume: +a.volume.toFixed(2), slider: document.querySelector('#volume-slider') ? +document.querySelector('#volume-slider').value : null, crossOrigin: a.crossOrigin, error: a.error && a.error.code } : null,
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
    if (c.signals) {
      const sig = await page.evaluate((seconds) => new Promise((done) => {
        const d = window.__trainWindow.director.state, t0 = performance.now();
        const r = { frames: 0, beatPeak: 0, bigPeak: 0, smallPeak: 0, bigSum: 0, smallSum: 0, beatSum: 0, midSum: 0, midPeak: 0, weatherMin: 1, weatherUnder95: 0, weatherSum: 0, chaseOnFrames: 0, chaseFlips: 0, events: [], bpm: 0, song: '' };
        let wasOn = false, lastSeq = d.event ? d.event.seq : 0;
        const tick = () => {
          r.frames++;
          r.beatPeak = Math.max(r.beatPeak, d.beat); r.bigPeak = Math.max(r.bigPeak, d.beatBig); r.smallPeak = Math.max(r.smallPeak, d.beatSmall);
          r.beatSum += d.beat; r.bigSum += d.beatBig; r.smallSum += d.beatSmall;
          r.midSum += d.mid; r.midPeak = Math.max(r.midPeak, d.mid);
          r.weatherMin = Math.min(r.weatherMin, d.weather); r.weatherSum += d.weather; if (d.weather < 0.95) r.weatherUnder95++;
          const on = d.chaseOn > 0.5; if (on) r.chaseOnFrames++; if (on !== wasOn) { r.chaseFlips++; wasOn = on; }
          if (d.event && d.event.seq !== lastSeq) { lastSeq = d.event.seq; r.events.push({ kind: d.event.kind, at: Math.round((performance.now() - t0) / 1000) }); }
          r.bpm = Math.round(d.bpm);
          if (performance.now() - t0 < seconds * 1000) requestAnimationFrame(tick);
          else { const n = r.frames, f = (v) => +(v / n).toFixed(3), el = document.querySelector('.song-title'); done({ seconds, frames: n, fps: +(n / seconds).toFixed(1), song: el ? el.textContent.trim() : '', beat: { peak: +r.beatPeak.toFixed(2), mean: f(r.beatSum) }, beatBig: { peak: +r.bigPeak.toFixed(2), mean: f(r.bigSum) }, beatSmall: { peak: +r.smallPeak.toFixed(2), mean: f(r.smallSum) }, mid: { peak: +r.midPeak.toFixed(2), mean: f(r.midSum) }, weather: { min: +r.weatherMin.toFixed(2), mean: f(r.weatherSum), shareUnder95: f(r.weatherUnder95) }, chaseOn: { share: f(r.chaseOnFrames), flips: r.chaseFlips }, bpm: r.bpm, events: r.events }); }
        };
        requestAnimationFrame(tick);
      }), c.signals);
      console.log('signals:', JSON.stringify(sig));
    }
    // A view that stays very slow must say so (TrainWindow's watchSpeed, App's .slow-notice). This
    // renderer usually is that slow at the default budget: if the engine's own frame rate is seen
    // under 14 for 35 seconds running, the notice must have come up; and when it does it must offer
    // fewer splats, and go when dismissed.
    let slow = null;
    if (c.budgetControl && warn.software) {
      slow = { slowRun: 0, longestSlowRun: 0, shown: false };
      for (let i = 0; i < 150 && !slow.shown; i++) {
        const s = await page.evaluate(() => ({ fps: window.__trainWindow ? window.__trainWindow.stats().fps : 99, kmh: window.__trainWindow ? window.__trainWindow.stats().kmh : 0, shown: !!document.querySelector('.slow-notice') }));
        slow.shown = s.shown; slow.slowRun = s.kmh > 5 && s.fps < 14 ? slow.slowRun + 1 : 0; slow.longestSlowRun = Math.max(slow.longestSlowRun, slow.slowRun);
        if (!slow.shown) await page.waitForTimeout(1000);
      }
      if (slow.shown) {
        slow.offersFewer = await page.evaluate(() => [...document.querySelectorAll('.slow-notice button')].some((b) => b.textContent.trim() === 'Use fewer splats'));
        await page.evaluate(() => [...document.querySelectorAll('.slow-notice button')].find((b) => b.textContent.trim() === 'Dismiss').click());
        await page.waitForTimeout(400);
        slow.goneAfterDismiss = await page.evaluate(() => !document.querySelector('.slow-notice'));
      }
      slow.ok = slow.shown ? slow.offersFewer && slow.goneAfterDismiss : slow.longestSlowRun < 35;   // else: not slow for long enough here to owe a notice
    }
    // Distraction in the generated view brakes the train instead of fading to black. Check the wiring:
    // losing focus must lower the rate the director runs at, and nothing may draw a black overlay.
    // (How fast it brakes cannot be judged here: on a software renderer the page's timers starve,
    // so the distraction score climbs far more slowly than on a real machine.)
    let brake = null;
    // The overlay's splat budget (only offered when the URL sets none): the default for a desktop is
    // 600k, and choosing another queues a tunnel to rebuild the world behind.
    if (c.budgetControl) {
      const B = await page.evaluate(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const row = () => [...document.querySelectorAll('.view-controls .row')].find((r) => r.querySelector('.label').textContent.trim() === 'Splats');
        if (!row()) return { row: false };
        const on = () => { const b = row().querySelector('button.on'); return b ? b.textContent.trim() : null; };
        const options = [...row().querySelectorAll('button')].map((b) => b.textContent.trim());
        const before = on();
        [...row().querySelectorAll('button')].find((b) => b.textContent.trim() === '300k').click();
        await wait(800);
        const d = window.__trainWindow.director.state;
        return { row: true, options, before, after: on(), note: row().querySelector('.value').textContent.trim(), tunnel: !!(d.tunnel || d.queued) };
      });
      B.ok = B.row && B.options.join() === '300k,600k,900k' && B.before === '600k' && B.after === '300k' && B.note === 'Queued' && B.tunnel;
      brake = B;
    }
    if (c.touch) {
      const T = {};
      const rate = () => page.evaluate(() => window.__trainWindow.director.state.rate);
      const audioPaused = () => page.evaluate(() => document.querySelector('audio').paused);
      const shown = () => page.evaluate(() => !!document.querySelector('.now-playing') && !document.querySelector('.now-playing').classList.contains('fade-out'));
      const until = async (fn, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(500); } return false; };
      const press = (sel) => page.evaluate((sel) => { const b = document.querySelector(sel); if (!b) throw new Error('nothing at ' + sel); b.click(); }, sel);
      T.mediaQuery = await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches);
      T.touchClass = await page.evaluate(() => document.querySelector('.app').classList.contains('touch'));
      T.startText = c.startText;
      // nothing a finger or a lost focus does may brake the train
      await until(async () => (await rate()) === 1, 60000);
      const r0 = await rate();
      await page.evaluate(() => { for (let i = 0; i < 40; i++) document.dispatchEvent(new MouseEvent('mousemove', { clientX: 20 + i * 8, clientY: 300, bubbles: true })); window.dispatchEvent(new Event('blur')); });
      await page.waitForTimeout(5000);
      T.rateAfterFidget = await rate(); T.noDistraction = r0 === 1 && T.rateAfterFidget === 1;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      // a tap on the glass brings the overlay up; another puts it away
      T.hiddenAtFirst = !(await shown());
      const playing = () => page.evaluate(() => document.querySelector('audio').src);
      const srcBefore = await playing();
      // how long the page takes to get round to a timer: on a starved software renderer this can be
      // seconds, and then the fixed waits below prove nothing (the number is printed to say so)
      T.lagMs = await page.evaluate(async () => { let worst = 0; for (let i = 0; i < 5; i++) { const t = performance.now(); await new Promise((r) => setTimeout(r, 0)); worst = Math.max(worst, performance.now() - t); } return Math.round(worst); });
      await page.touchscreen.tap(195, 420);
      T.shownAfterTap = await until(shown, 12000);
      await page.waitForTimeout(1500);
      T.tapPressedNothing = (await playing()) === srcBefore;     // the tap that reveals the channels must not choose one
      // Done inside the page in one go: step by step from here, this renderer is slow enough for the
      // overlay to fade by itself between two steps, and the tap would then bring it up instead.
      const glass = await page.evaluate(async () => {
        const c = document.querySelector('canvas'), np = document.querySelector('.now-playing');
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const up = () => !np.classList.contains('fade-out');
        // each tap is given until the panel has answered it (at most 5 s), not a fixed moment
        const tapUntil = async (want) => { c.click(); for (let i = 0; i < 50 && up() !== want; i++) await wait(100); return up(); };
        if (!up()) await tapUntil(true);
        const before = up();
        const after = await tapUntil(false);
        return { before, after, again: await tapUntil(true) };
      });
      T.shownBeforeSecondTap = glass.before; T.hiddenAfterSecondTap = glass.before && !glass.after; T.shownByThirdTap = glass.again;
      // the controls a phone gets
      T.rows = await page.evaluate(() => [...document.querySelectorAll('.view-controls .label')].map((e) => e.textContent.trim()));
      T.wakeLockOffered = await page.evaluate(() => 'wakeLock' in navigator);
      T.controlsOk = !T.rows.includes('Ignore distraction') && T.rows.includes('Scenery') && T.rows[0] === 'Channel' && (!T.wakeLockOffered || T.rows.includes('Keep screen on'));
      T.noVolume = await page.evaluate(() => !document.querySelector('.volume-control'));
      T.supportLine = await page.evaluate(() => !!document.querySelector('.now-playing .support a[href*="somafm.com/support"]'));
      // pause brakes the train and silences the radio; play brings both back
      T.overlayBeforePause = await shown();
      await press('.pause');
      await page.waitForTimeout(300);
      T.pauseShowsPaused = await page.evaluate(() => document.querySelector('.pause').getAttribute('aria-pressed'));
      T.rateSoonAfterPause = await rate();
      T.pausedAudio = await until(audioPaused, 90000);
      T.pausedTrain = await until(async () => (await rate()) === 0, 30000);
      await press('.pause');
      T.playsAgain = await until(async () => !(await audioPaused()) && (await rate()) > 0, 60000);
      // in the background the radio stops at once, and starts again on return
      const hide = (h) => page.evaluate((h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') }); document.dispatchEvent(new Event('visibilitychange')); }, h);
      await hide(true);
      await page.waitForTimeout(300);
      T.silentInBackground = await audioPaused();
      await page.waitForTimeout(3000);
      T.stillSilent = await audioPaused();
      await hide(false);
      T.resumesOnReturn = await until(async () => !(await audioPaused()), 30000);
      T.noResumePrompt = await page.evaluate(() => !document.querySelector('.resume-overlay'));
      // both ways up: every panel inside the screen, none overlapping another
      const layout = () => page.evaluate(() => {
        const r = ['.now-playing', '.view-controls', '.hide-bar'].map((s) => document.querySelector(s).getBoundingClientRect());
        const inside = r.every((b) => b.left >= 0 && b.top >= 0 && b.right <= innerWidth + 0.5 && b.bottom <= innerHeight + 0.5 && b.width > 120 && b.height > 40);
        const apart = (a, b) => a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5;
        const c = document.querySelector('.window-container canvas');
        return { inside, apart: apart(r[0], r[1]) && apart(r[1], r[2]) && apart(r[0], r[2]), canvas: [c.clientWidth, c.clientHeight], view: [innerWidth, innerHeight] };
      });
      // For the screenshots only, the overlay is pinned open: a capture takes this renderer longer
      // than the overlay stays up.
      const keep = () => page.evaluate(() => { const st = document.createElement('style'); st.id = 'pin-overlay'; st.textContent = '.app .fade-out { opacity: 1 !important; }'; document.head.appendChild(st); });
      await press('.now-playing'); await keep();
      T.portrait = await layout();
      await page.screenshot({ path: path.join(outDir, 'app-touch-portrait.png'), timeout: 120000 }).catch(() => console.log('(screenshot skipped: renderer too slow)'));
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(2500);
      T.landscape = await layout();
      T.engineAspect = await page.evaluate(() => { const c = document.querySelector('.window-container canvas'); return +(c.width / c.height).toFixed(2); });
      await page.screenshot({ path: path.join(outDir, 'app-touch-landscape.png'), timeout: 120000 }).catch(() => console.log('(screenshot skipped: renderer too slow)'));
      await page.evaluate(() => document.getElementById('pin-overlay').remove());
      // the bar at the bottom puts the overlay away at once
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(1500);
      const bar = await page.evaluate(async () => {
        const c = document.querySelector('canvas'), np = document.querySelector('.now-playing');
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const up = () => !np.classList.contains('fade-out');
        if (!up()) { c.click(); await wait(400); }
        const before = up();
        document.querySelector('.hide-bar').click(); await wait(300);
        return { before, after: up() };
      });
      T.shownBeforeHide = bar.before; T.hideBarHides = bar.before && !bar.after;
      T.noSplatsRowWithUrlBudget = await page.evaluate(() => ![...document.querySelectorAll('.view-controls .label')].some((e) => e.textContent.trim() === 'Splats'));
      // the channels are a dialog: opened from the controls, closed by choosing one, and the choice plays
      await press('canvas');
      T.noListInSheet = await page.evaluate(() => !document.querySelector('.channel-selector'));
      await press('.view-controls .row:nth-child(1) button');
      await page.waitForTimeout(500);
      T.channelDialog = await page.evaluate(() => { const d = document.querySelector('.channel-modal .channel-selector'); return d ? { items: d.querySelectorAll('.channel-item').length, close: !!d.querySelector('.close') } : null; });
      await page.screenshot({ path: path.join(outDir, 'app-touch-channels.png'), timeout: 120000 }).catch(() => console.log('(screenshot skipped: renderer too slow)'));
      const srcWas = await playing();
      await page.evaluate(() => { const b = [...document.querySelectorAll('.channel-modal .channel-item')].find((e) => !e.classList.contains('active')); b.click(); });
      T.dialogClosedByChoice = await until(() => page.evaluate(() => !document.querySelector('.channel-modal')), 3000);
      T.choicePlays = await until(async () => (await playing()) !== srcWas && !(await audioPaused()), 60000);
      const lay = (l) => l.inside && l.apart && l.canvas[0] === l.view[0] && l.canvas[1] === l.view[1];
      T.ok = T.mediaQuery && T.touchClass && T.noDistraction && T.hiddenAtFirst && T.shownAfterTap && T.tapPressedNothing && T.hiddenAfterSecondTap && T.controlsOk && T.noVolume && T.supportLine
        && T.pausedAudio && T.pausedTrain && T.playsAgain && T.silentInBackground && T.stillSilent && T.resumesOnReturn && T.noResumePrompt
        && lay(T.portrait) && lay(T.landscape) && Math.abs(T.engineAspect - 844 / 390) < 0.05
        && T.shownByThirdTap && T.noSplatsRowWithUrlBudget && T.shownBeforeHide && T.hideBarHides && T.noListInSheet && !!T.channelDialog && T.channelDialog.items > 10 && T.channelDialog.close && T.dialogClosedByChoice && T.choicePlays;
      brake = T;
    }
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
      // (no real change of track may re-aim the tunnel between two presses: see the re-aim scenario below)
      await page.evaluate(() => { const d = window.__trainWindow.director; d.__onTrack = d.onTrack; d.onTrack = () => {}; });
      const c0 = await D();
      await press('.view-controls .row:nth-child(1) button', 'Next');
      const c1 = await D();
      await press('.view-controls .row:nth-child(2) button');
      const c2 = await D();
      await page.evaluate(() => { const d = window.__trainWindow.director; d.onTrack = d.__onTrack; delete d.__onTrack; });
      await press('.view-controls .group button', '30');
      const c3 = await D();
      await press('.view-controls .row:nth-child(3) button');
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.waitForTimeout(6000);
      const c4 = await D();
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await press('.view-controls .row button', 'Credits');
      // the photo credits are fetched when the panel opens: wait for them, not for a fixed moment
      await page.waitForFunction(() => document.querySelectorAll('.credits li').length >= 8, null, { timeout: 20000 }).catch(() => {});
      const credits = await page.evaluate(() => ({ open: !!document.querySelector('.credits'), items: document.querySelectorAll('.credits li').length, soma: !!document.querySelector('.credits a[href*="somafm.com"]') }));
      await press('.credits .close');
      const creditsClosed = await page.evaluate(() => !document.querySelector('.credits'));
      const controls = { before: c0, nextBiome: c1.wantBiome, dreamlike: c2.wantLevel, fpsCap: c3.fpsCap, rateWhileCheating: c4.rate,
        ok: c1.wantBiome !== c0.wantBiome && c2.wantLevel === 1 - c1.wantLevel && c0.fpsCap === 60 && c3.fpsCap === 30 && c4.rate === 1 && credits.open && credits.items >= 8 && credits.soma && creditsClosed, credits };
      brake.controls = controls; brake.ok = brake.ok && controls.ok;
      // Next, pressed again while a change is on its way, changes the destination: before the swap by
      // re-aiming the tunnel, after it (still inside) by building the world again, and only when the
      // train is leaving the tunnel by booking a tunnel of its own. The train is carried along by
      // hand: this renderer is far too slow to ride a tunnel.
      const R = await page.evaluate(async () => {
        const d = window.__trainWindow.director.state;
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const tick = async (cond, n = 80) => { for (let i = 0; i < n && !cond(); i++) await wait(250); return cond(); };
        const row = () => [...document.querySelectorAll('.view-controls .row')].find((r) => r.querySelector('.label').textContent.trim() === 'Scenery');
        const label = () => row().querySelector('.value').textContent.trim();
        const next = async () => { row().querySelector('button').click(); await wait(700); };
        const out = {};
        // A real change of track during this scenario would re-aim the tunnel too (that is the
        // feature), so the radio's track changes are held off while it runs.
        const director = window.__trainWindow.director, onTrack = director.onTrack;
        director.onTrack = () => {};
        // first, out into the open
        for (let i = 0; i < 12 && (d.tunnel || d.queued); i++) {
          const t = d.tunnel;
          if (!t) { await wait(500); continue; }
          if (t.phase === 'approach') { d.travelled = t.x0 + 13; await tick(() => d.tunnel && d.tunnel.phase === 'inside'); }
          else if (t.phase === 'inside') { await tick(() => d.tunnel && d.tunnel.ready, 480); d.travelled = d.tunnel.x1 - 11; await tick(() => d.tunnel && d.tunnel.phase === 'leaving'); }
          else { d.travelled = t.x1 + 21; await tick(() => d.tunnel !== t); }
        }
        out.open = !d.tunnel && !d.queued; await wait(900);
        const home = d.biome; out.openLabel = label();
        await next();
        out.a = d.tunnel && d.tunnel.phase === 'approach' ? d.tunnel.next.biome : null; out.aLabel = label();
        await next();
        out.b = d.tunnel && d.tunnel.phase === 'approach' ? d.tunnel.next.biome : null; out.bLabel = label();
        out.stillHome = d.biome === home;
        d.travelled = d.tunnel.x0 + 13;
        out.swapped = await tick(() => d.tunnel && d.tunnel.phase === 'inside');
        out.insideBiome = d.biome;
        await next();
        out.c = d.biome; out.cLabel = label(); out.noQueueInside = !d.queued; out.oneTunnel = !!d.tunnel && d.tunnel.phase === 'inside';
        out.rebuilt = await tick(() => d.tunnel && d.tunnel.ready, 240);
        d.travelled = d.tunnel.x1 - 11;
        out.leaving = await tick(() => d.tunnel && d.tunnel.phase === 'leaving');
        await next();
        out.queuedAfter = d.queued ? d.queued.biome : null; out.keptC = d.biome === out.c; out.dLabel = label();
        director.onTrack = onTrack;
        return out;
      });
      R.ok = R.open && R.openLabel && !R.openLabel.startsWith('→') && !!R.a && R.aLabel.startsWith('→ ') && !!R.b && R.b !== R.a && R.bLabel.startsWith('→ ') && R.bLabel !== R.aLabel && R.stillHome
        && R.swapped && R.insideBiome === R.b && R.c !== R.b && R.noQueueInside && R.oneTunnel && R.cLabel.startsWith('→ ') && R.cLabel !== R.bLabel
        && R.rebuilt && R.leaving && !!R.queuedAfter && R.queuedAfter !== R.c && R.keptC && R.dLabel.startsWith('→ ');
      brake.reroll = R; brake.ok = brake.ok && R.ok;
    }
    await page.screenshot({ path: path.join(outDir, `app-${name}.png`), timeout: 120000 }).catch(() => console.log('(screenshot skipped: renderer too slow)'));
    // Only the case that breaks the streams on purpose may log load failures.
    let ours = c.noisy ? errors.filter((e) => !/Failed to load resource|net::ERR|Audio error|server attempts/i.test(e)) : errors;
    // A case that runs for minutes (the tuned one, and any IDLE run) rides out the odd dropped poll
    // through a proxy: a connection reset on a request that is simply made again. Nothing else is excused.
    if (process.env.IDLE === '1' || c.distraction) for (let i = ours.length - 1; i >= 0; i--) if (/net::ERR_CONNECTION_RESET/.test(ours[i])) ours.splice(i, 1);
    if (youtube.length) ours.push(`requests to YouTube hosts: ${youtube.length}`);
    console.log(`\n== ${name}`); console.log(JSON.stringify(state)); console.log('start warning:', JSON.stringify(warn)); if (slow) console.log('slow notice:', JSON.stringify(slow)); if (brake) console.log(c.touch ? 'touch:' : c.budgetControl ? 'budget:' : 'brake:', JSON.stringify(brake));
    if (ours.length) { console.log('errors:'); for (const e of ours) console.log('  ' + e); }
    const audioOk = state.audio && !state.audio.paused && state.audio.time > 0.5;
    if (!audioOk) { console.log('radio log:'); for (const l of radioLog.slice(-14)) console.log('  ' + l); }
    const viewOk = c.expect === 'notice'
      ? state.notice && !state.hasCanvas
      : state.hasCanvas && !state.windowHidden && !state.notice && state.engine && state.engine.splats > 0;
    const tapOk = c.tap === undefined ? true
      : c.tap ? !!(state.tap && (c.tap === 'attached' || state.tap.active) && state.tap.context === 'running' && state.audio.crossOrigin === 'anonymous')
        : !state.tap && state.audio.crossOrigin === null;
    const volumeOk = c.volume == null || (state.audio && Math.abs(state.audio.volume - c.volume) < 0.03 && Math.abs(state.audio.slider - c.volume) < 0.03);
    const ok = state.startGone && state.goneAtOnce && audioOk && volumeOk && viewOk && tapOk && warnOk && (!slow || slow.ok) && !ours.length && (!brake || brake.ok);
    console.log(ok ? 'PASS' : `FAIL (start ${state.startGone}, at once ${state.goneAtOnce}, audio ${!!audioOk}, view ${!!viewOk}, analysis ${tapOk}, volume ${volumeOk}, start warning ${warnOk}, slow notice ${!slow || slow.ok})`); if (!ok) failed = true;
    await ctx.close();
  }
  await browser.close(); server.httpServer.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
