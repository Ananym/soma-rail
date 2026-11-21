// Screenshot one photo-splat kit piece as the train would see it: left, centre and right.
//   node scripts/kit-shot.cjs <piece-id> [outDir] [--size WxH] [--slide metres] [--frames N] [--file name.ply]
// Starts the Vite dev server, opens kit-harness.html in headless Chromium and saves
// <outDir>/<id>-left.png, -centre.png and -right.png with the camera slid sideways along x.
// The default slide is tan(30°) x the piece's median depth, which puts its middle near the edge of
// the 50° (vertical) view, where disocclusion tearing and rubber sheets show worst.
// Headless Chromium renders in software here: judge framing, tearing and colour, never speed.
// Needs Playwright (`npm i -D playwright`, or NODE_PATH pointing at a global install).
const path = require('path');
const fs = require('fs');
const args = process.argv.slice(2);
const id = args[0];
const outDir = args[1] && !args[1].startsWith('--') ? args[1] : 'kit-shots';
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const [W, H] = opt('size', '960x540').split('x').map(Number);
const frames = Number(opt('frames', 6));
const file = opt('file', '');
if (!id) { console.error('usage: node scripts/kit-shot.cjs <piece-id> [outDir]'); process.exit(2); }

(async () => {
  const { createServer } = await import('vite');
  const { chromium } = require('playwright');
  const server = await createServer({ root: path.join(__dirname, '..'), logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
  await server.listen();
  const port = server.httpServer.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${String(e).slice(0, 300)}`));
  let code = 0;
  try {
    fs.mkdirSync(outDir, { recursive: true });
    await page.goto(`http://127.0.0.1:${port}/kit-harness.html?piece=${encodeURIComponent(id)}${file ? `&file=${encodeURIComponent(file)}` : ''}`);
    await page.waitForFunction(() => window.kit && (window.kit.ready || window.kit.error), null, { timeout: 300000 });
    const err = await page.evaluate(() => window.kit.error);
    if (err) throw new Error(err);
    const piece = await page.evaluate(() => window.kit.piece);
    const slide = Number(opt('slide', 0)) || Math.round(Math.tan(Math.PI / 6) * (piece.medianDepth || piece.suggestedDistance));
    const x0 = -(piece.xShift || 0);   // the capture point: the centre shot reproduces the photo
    for (const [name, x] of [['left', x0 - slide], ['centre', x0], ['right', x0 + slide]]) {
      await page.evaluate((v) => window.kit.setX(v), x);
      // let Spark re-sort in its worker and draw a few frames at the new position
      const f0 = await page.evaluate(() => window.kit.frames);
      await page.waitForFunction((f) => window.kit.frames >= f, f0 + frames, { timeout: 300000 });
      const out = path.join(outDir, `${id}${file ? '-' + path.basename(file).replace(/\./g, '_') : ''}-${name}.png`);
      await page.screenshot({ path: out });
      console.log(`${out}  (camera x = ${x} m)`);
    }
  } catch (e) { console.error('FAILED:', String(e).slice(0, 600)); code = 1; }
  if (problems.length) { console.log('console problems:'); for (const p of problems) console.log('  ' + p); }
  await browser.close(); await server.close();
  process.exit(code);
})();
