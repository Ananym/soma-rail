const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs');
(async () => {
  const srv = http.createServer((q, s) => { s.setHeader('content-type', 'text/html'); s.end(fs.readFileSync(__dirname + '/page.html')); }).listen(8765);
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
  const extra = process.argv[2] === 'gpc' ? { 'Sec-GPC': '1' } : {};
  const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', extraHTTPHeaders: extra });
  const p = await ctx.newPage();
  p.on('response', async r => { if (r.url().includes('somafm')) { const q = r.request().headers(); const h = r.headers(); console.log('  HTTP', r.status(), r.url().replace('https://',''), '| req origin=' + (q.origin||'-'), 'sec-gpc=' + (q['sec-gpc']||'-'), '| acao=' + (h['access-control-allow-origin']||'-'), 'ctype=' + h['content-type']); } });
  p.on('console', m => { if (m.type() === 'error') console.log('  console.error:', m.text().slice(0, 200)); });
  await p.goto('http://localhost:8765/');
  const tests = JSON.parse(process.argv[3] || '[]');
  for (const [url, cors] of tests) console.log(JSON.stringify(await p.evaluate(([u, c]) => window.run(u, c), [url, cors])));
  await b.close(); srv.close();
})().catch(e => { console.error(e); process.exit(1); });
