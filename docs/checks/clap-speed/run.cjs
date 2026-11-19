const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' };
(async () => {
  const srv = http.createServer((q, s) => { const u = q.url.split('?')[0]; const p = path.join(__dirname, u === '/' ? '/index.html' : u); fs.readFile(p, (e, d) => { if (e) { s.statusCode = 404; return s.end(); }
    s.setHeader('content-type', mime[path.extname(p)] || 'application/octet-stream'); if (process.env.COI) { s.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); s.setHeader('Cross-Origin-Embedder-Policy', 'credentialless'); } s.end(d); }); }).listen(8767);
  const b = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined });
  const p = await b.newPage(); let bytes = {};
  p.on('console', m => { const t = m.text(); if (t.startsWith('CLAP') || m.type() === 'error') console.log(t.slice(0, 400)); });
  p.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 400)));
  p.on('requestfinished', async r => { const u = r.url(); if (/huggingface|jsdelivr|hf\.co/.test(u)) { try { const s = await r.sizes(); const h = new URL(u).host; bytes[h] = (bytes[h] || 0) + s.responseBodySize; } catch {} } });
  await p.goto('http://localhost:8767/?' + (process.argv[2] || '')); await p.waitForFunction(() => window.done, null, { timeout: 200000 });
  console.log('transferred MB by host', Object.fromEntries(Object.entries(bytes).map(([k, v]) => [k, +(v / 1e6).toFixed(1)]))); await b.close(); srv.close();
})().catch(e => { console.error(String(e).slice(0, 400)); process.exit(1); });
