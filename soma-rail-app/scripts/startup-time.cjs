// How long the view takes to start: milliseconds from page load to window.harness.ready.
//   node scripts/startup-time.cjs ["query string"] [--runs N]
// Starts the Vite dev server once and opens window-harness.html in a fresh headless Chromium for
// each run (software renderer: compiling the splat shader is a large part of the time). Run it
// before and after a change to the splat shader to see what the change costs.
const path = require('path');
const args = process.argv.slice(2);
const query = args[0] && !args[0].startsWith('--') ? args[0] : 'biome=placeholder&budget=20000';
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const runs = Number(opt('runs', 3));
const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };

(async () => {
  const { createServer } = await import('vite');
  const { chromium } = require('playwright');
  const server = await createServer({ root: path.join(__dirname, '..'), logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
  await server.listen();
  const port = server.httpServer.address().port;
  const url = `http://127.0.0.1:${port}/window-harness.html?${query}&preserve=1`;
  const open = async () => {
    const browser = await chromium.launch(LAUNCH);
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const t0 = Date.now();
    await page.goto(url);
    await page.waitForFunction(() => window.harness && (window.harness.ready || window.harness.error), null, { timeout: 900000, polling: 50 });
    const ms = Date.now() - t0;
    const err = await page.evaluate(() => window.harness.error);
    if (err) { await browser.close(); throw new Error(err); }
    // ready can come before the splat shader has been compiled for the first draw: time three frames too
    await page.waitForFunction(() => window.harness.frames >= 3, null, { timeout: 900000, polling: 50 });
    const drawn = Date.now() - t0;
    await browser.close();
    return [ms, drawn];
  };
  let code = 0;
  try {
    await open();   // warms Vite's module transforms, so the first timed run does not pay for them
    const times = [];
    for (let i = 0; i < runs; i++) { const [ms, drawn] = await open(); times.push(ms); console.log(`run ${i + 1}: ready ${ms} ms, three frames drawn ${drawn} ms`); }
    console.log(`median ready ${times.slice().sort((a, b) => a - b)[Math.floor(times.length / 2)]} ms`);
  } catch (e) { console.error('FAILED:', String(e).slice(0, 600)); code = 1; }
  await server.close();
  process.exit(code);
})();
