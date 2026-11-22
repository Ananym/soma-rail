// Capture a run of frames from the generated view with the motion clock stepped by hand, so that
// moving things (flags, traffic, vapour) and a passing train can be looked at as a sequence on a
// machine too slow to play them. Frames are numbered PNGs; assemble them however you like.
//   node scripts/motion-frames.cjs <outDir> "seed=7&biome=motorway&hour=1&jump=13644&kmh=0" [--n 24] [--dt 0.1] [--travel 0] [--size 960x540]
//   --dt      seconds of motion per frame          --travel  metres the train moves per frame (no blur)
// Uses the same harness and software renderer as window-shot.cjs: it shows what moves and how,
// never frame rate.
const path = require('path');
const fs = require('fs');
const args = process.argv.slice(2);
const outDir = args[0] || 'frames';
const query = args[1] && !args[1].startsWith('--') ? args[1] : '';
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const N = Number(opt('n', 24)), DT = Number(opt('dt', 0.1)), TRAVEL = Number(opt('travel', 0));
const [W, H] = opt('size', '960x540').split('x').map(Number);

(async () => {
  const { createServer } = await import('vite');
  const { chromium } = require('playwright');
  fs.mkdirSync(outDir, { recursive: true });
  const server = await createServer({ root: path.join(__dirname, '..'), logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
  await server.listen();
  const port = server.httpServer.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.setDefaultTimeout(900000);
  let code = 0;
  try {
    await page.goto(`http://127.0.0.1:${port}/window-harness.html?${query}${query ? '&' : ''}preserve=1&moveT=0`);
    await page.waitForFunction(() => window.harness && (window.harness.ready || window.harness.error), null, { timeout: 900000 });
    const err = await page.evaluate(() => window.harness.error);
    if (err) throw new Error(err);
    const x0 = await page.evaluate(() => window.harness.engine.director.state.travelled);
    for (let i = 0; i < N; i++) {
      await page.evaluate(({ t, x }) => { window.harness.params.moveT = t; window.harness.engine.director.state.travelled = x; }, { t: i * DT, x: x0 + i * TRAVEL });
      // let the world catch up (new chunks when travelling), then draw a few frames at this instant
      await page.waitForFunction(() => window.harness.engine.stats().pending === 0, null, { timeout: 900000 });
      const f0 = await page.evaluate(() => window.harness.frames);
      await page.waitForFunction((f) => window.harness.frames >= f, f0 + 3, { timeout: 900000 });
      const url = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
      fs.writeFileSync(path.join(outDir, `f${String(i).padStart(3, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
    console.log(`${N} frames in ${outDir}`);
  } catch (e) { console.error('FAILED:', String(e).slice(0, 600)); code = 1; }
  await browser.close(); await server.close();
  process.exit(code);
})();
