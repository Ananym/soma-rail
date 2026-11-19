const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.map': 'application/json' };
(async () => {
  const srv = http.createServer((q, s) => { const p = path.join(__dirname, decodeURIComponent(q.url.split('?')[0] === '/' ? '/index.html' : q.url.split('?')[0])); fs.readFile(p, (e, d) => { if (e) { s.statusCode = 404; return s.end(); } s.setHeader('content-type', mime[path.extname(p)] || 'application/octet-stream'); s.end(d); }); }).listen(8766);
  const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('console', m => { const t = m.text(); if (t.startsWith('SMOKE') || m.type() === 'error') console.log(m.type(), t.slice(0, 600)); });
  p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 800)));
  await p.goto('http://localhost:8766/?' + (process.argv[2] || ''));
  for (const kmh of (process.argv[3] || '100').split(',')) {
    await p.waitForFunction(() => window.smoke && window.smoke.frames > 3, null, { timeout: 120000 });
    await p.evaluate(k => window.smoke.setKmh(+k), kmh); const f0 = await p.evaluate(() => window.smoke.frames);
    await p.waitForFunction(f => window.smoke.frames > f + 12, f0, { timeout: 120000 });
    await p.screenshot({ path: `shot-${kmh}.png` }); console.log('shot', kmh, await p.evaluate(() => ({ frames: window.smoke.frames, fps: +window.smoke.fps.toFixed(1) })));
  }
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
