// Screenshot the generated view without the rest of the app.
//   node scripts/window-shot.cjs <out.png> ["query string"] [--frames N] [--size WxH] [--eval "js"]
// Starts the Vite dev server, opens window-harness.html in headless Chromium and saves a PNG once
// the world has generated and N more frames have been drawn. Headless Chromium uses a software
// renderer here, so this checks framing, colour and errors, never frame rate.
// Needs Playwright (`npm i -D playwright` if it is not already available).
const path = require('path');
const args = process.argv.slice(2);
const out = args[0] || 'window.png';
const query = args[1] && !args[1].startsWith('--') ? args[1] : '';
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const frames = Number(opt('frames', 8));
const [W, H] = opt('size', '960x540').split('x').map(Number);
const evalJs = opt('eval', '');

(async () => {
  const { createServer } = await import('vite');
  const { chromium } = require('playwright');
  const server = await createServer({ root: path.join(__dirname, '..'), logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
  await server.listen();
  const port = server.httpServer.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(600000);
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 300)}`));
  let code = 0;
  try {
    await page.goto(`http://127.0.0.1:${port}/window-harness.html?${query}${query ? '&' : ''}preserve=1`);
    await page.waitForFunction(() => window.harness && (window.harness.ready || window.harness.error), null, { timeout: 900000 });
    const err = await page.evaluate(() => window.harness.error);
    if (err) throw new Error(err);
    if (evalJs) await page.evaluate(evalJs);
    const f0 = await page.evaluate(() => window.harness.frames);
    await page.waitForFunction((f) => window.harness.frames >= f, f0 + frames, { timeout: 900000 });
    // Read the canvas itself: a page screenshot can time out on the software renderer.
    const url = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
    require('fs').writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
    console.log(JSON.stringify(await page.evaluate(() => window.harness.engine.stats())));
  } catch (e) { console.error('FAILED:', String(e).slice(0, 600)); code = 1; }
  if (problems.length) { console.log('console problems:'); for (const p of problems) console.log('  ' + p); }
  await browser.close(); await server.close();
  process.exit(code);
})();
