// Several stills of one view, each with different pins, from a single load (a load takes minutes on
// the software renderer; changing a pin takes a few frames).
//   node scripts/pin-shots.cjs <out prefix> "query string" "name:pin=v&pin=v" ["name:..." ...] [--size WxH] [--frames N] [--page file.html]
// Each shot sets the listed params (params.js names, e.g. bigPin=1&smallPin=0) on the running view,
// waits N frames and saves <out prefix>-<name>.png. Params a shot does not list are put back to what
// the query string gave them, so shots do not leak into each other. An empty list ("base:") is the
// query as given. --page opens another harness page (any path; it must set window.harness as
// window-harness.html does), e.g. one that adds test scenery to a biome before starting the engine.
const path = require('path');
const fs = require('fs');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const flags = new Set(); for (const n of ['size', 'frames', 'page']) { const i = args.indexOf(`--${n}`); if (i >= 0) { flags.add(i); flags.add(i + 1); } }
const pos = args.filter((_, i) => !flags.has(i));
const [prefix, query, ...shots] = pos;
const frames = Number(opt('frames', 6));
const pageFile = opt('page', '');
const [W, H] = opt('size', '960x540').split('x').map(Number);

(async () => {
  const { createServer } = await import('vite');
  const { chromium } = require('playwright');
  const server = await createServer({ root: path.join(__dirname, '..'), logLevel: 'error', server: { port: 0, host: '127.0.0.1', fs: { allow: [path.join(__dirname, '..'), fs.realpathSync(path.join(__dirname, '..', 'node_modules')), ...(pageFile ? [path.dirname(path.resolve(pageFile))] : [])] } } });
  await server.listen();
  const port = server.httpServer.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(900000);
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 300)}`));
  let code = 0;
  try {
    const pagePath = pageFile ? `/@fs${path.resolve(pageFile)}` : '/window-harness.html';
    await page.goto(`http://127.0.0.1:${port}${pagePath}?${query}${query ? '&' : ''}preserve=1`);
    await page.waitForFunction(() => window.harness && (window.harness.ready || window.harness.error), null, { timeout: 900000 });
    const err = await page.evaluate(() => window.harness.error);
    if (err) throw new Error(err);
    const f0 = await page.evaluate(() => window.harness.frames);
    await page.waitForFunction((f) => window.harness.frames >= f, f0 + frames, { timeout: 900000 });
    await page.evaluate(() => { window.__pinBase = { ...window.harness.params }; });
    for (const shot of shots) {
      const at = shot.indexOf(':');
      const name = shot.slice(0, at), set = Object.fromEntries(new URLSearchParams(shot.slice(at + 1)));
      await page.evaluate((set) => {
        const p = window.harness.params;
        Object.assign(p, window.__pinBase);
        for (const [k, v] of Object.entries(set)) p[k] = typeof window.__pinBase[k] === 'number' ? Number(v) : v;
      }, set);
      const f1 = await page.evaluate(() => window.harness.frames);
      await page.waitForFunction((f) => window.harness.frames >= f, f1 + frames, { timeout: 900000 });
      const url = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
      const file = `${prefix}-${name}.png`;
      fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
      console.log(file);
    }
    console.log(JSON.stringify(await page.evaluate(() => window.harness.engine.stats())));
  } catch (e) { console.error('FAILED:', String(e).slice(0, 600)); code = 1; }
  if (problems.length) { console.log('console problems:'); for (const p of problems) console.log('  ' + p); }
  await browser.close(); await server.close();
  process.exit(code);
})();
