// Check the sky on its own, without the land.
//   node scripts/check-sky.mjs <out.png> [--level 0|1] [--hours 5.5,6.5,...] [--size 480x270] [--energy 0..1]
//        [--sky stars=1.8,deep=1,milkyWay=1,clear=1]   a biome's sky hint (also constellations=1, overcast=0..1)
//        [--fov 50] [--shift 0.3]   the vertical field of view and the lowered horizon (motorway: 0.3;
//                                   an upright phone 540x960: --fov 83.3 --shift 0.467)
//        [--con 0,3,5@0.25]         hold these constellations at 0.25 s into their envelope
//                                   ('all' for every one), whatever the beat
// Renders the sky shader for each hour into a contact sheet (one tile per hour, labelled), and
// checks that the exported horizonColor matches the pixel the shader draws straight ahead at the
// horizon (the land hazes toward horizonColor, so a mismatch shows as a seam). Exits 1 on a
// mismatch over 3/255 or a shader error. Needs Playwright (as scripts/window-shot.cjs does).
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const out = args[0] && !args[0].startsWith('--') ? args[0] : 'sky-check.png';
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const level = Number(opt('level', 0));
const hours = opt('hours', '2,5.5,6.5,9,12,17,19.5,20.5,23').split(',').map(Number);
const [W, H] = opt('size', '480x270').split('x').map(Number);
const energy = Number(opt('energy', 0));
const travelled = Number(opt('travelled', 0));
const skyHint = opt('sky', '') ? Object.fromEntries(opt('sky', '').split(',').map((kv) => { const [k, v] = kv.split('='); return [k, Number(v)]; })) : null;   // e.g. --sky stars=1.8,deep=1,milkyWay=1,clear=1
const clouds = Number(opt('clouds', 1));
const fov = Number(opt('fov', 50)), shift = Number(opt('shift', 0));
const conOpt = opt('con', '');
const conPin = conOpt ? { list: conOpt.split('@')[0], age: Number(conOpt.split('@')[1] || 0.25) } : null;   // 0 hides the clouds, to judge the atmosphere alone

const { createServer } = await import('vite');
const { chromium } = require('playwright');
const server = await createServer({ root, logLevel: 'error', server: { port: 0, host: '127.0.0.1' } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push(m.text().slice(0, 2000)); });
page.on('pageerror', (e) => problems.push(String(e).slice(0, 2000)));
let code = 0;
try {
  // any same-origin page will do; the modules are imported directly below
  await page.goto(`http://127.0.0.1:${port}/src/window/rng.js`);
  const res = await page.evaluate(async ({ hours, W, H, level, energy, travelled, clouds, skyHint, fov, shift, conPin }) => {
    const THREE = await import('/node_modules/three/build/three.module.js');
    const { createSky } = await import('/src/window/sky.js');
    const { LEVELS } = await import('/src/window/director.js');
    const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    const renderer = new THREE.WebGLRenderer({ canvas, preserveDrawingBuffer: true });
    renderer.setSize(W, H, false); renderer.setPixelRatio(1);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
    const sky = createSky(THREE);
    if (conPin) sky._debug.pinConstellations(conPin.list === 'all' ? sky._debug.constellations.map((_, i) => i) : conPin.list.split(',').map(Number), conPin.age);
    scene.add(sky.object3d);
    const cols = Math.min(3, hours.length), rows = Math.ceil(hours.length / cols);
    const sheet = document.createElement('canvas'); sheet.width = cols * W; sheet.height = rows * H;
    const ctx = sheet.getContext('2d');
    const report = [];
    const px = new Uint8Array(4);
    const gl = renderer.getContext();
    hours.forEach((hour, k) => {
      // run a few frames so smoothed values settle
      for (let f = 0; f < 3; f++) sky.update({ hour, level, dials: LEVELS[level], time: 100 + f / 30, dt: f ? 1 / 30 : 0, aspect: W / H, fovDeg: fov, travelled: travelled + f, speed: 28, energy, sky: skyHint, shift });
      if (!clouds && sky._debug) { sky._debug.uniforms.uCoverLo.value = 3; sky._debug.uniforms.uCoverHi.value = 3; }
      renderer.render(scene, camera);
      gl.readPixels(W >> 1, Math.floor(((1 - shift) / 2) * H) - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);   // just below the horizon
      const want = [sky.horizonColor.r, sky.horizonColor.g, sky.horizonColor.b].map((v) => Math.round(v * 255));
      const diff = Math.max(...want.map((v, i) => Math.abs(v - px[i])));
      report.push({ hour, drawn: [px[0], px[1], px[2]], horizonColor: want, diff, lightTint: [sky.lightTint.r, sky.lightTint.g, sky.lightTint.b].map((v) => +v.toFixed(3)), sunEl: +(Math.asin(sky._debug.sunDir.y) * 57.3).toFixed(1) });
      ctx.drawImage(canvas, (k % cols) * W, Math.floor(k / cols) * H);
      // label and the light tint as a swatch
      const x = (k % cols) * W, y = Math.floor(k / cols) * H;
      ctx.fillStyle = `rgb(${sky.lightTint.r * 255},${sky.lightTint.g * 255},${sky.lightTint.b * 255})`;
      ctx.fillRect(x + 6, y + H - 26, 20, 20);
      ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif'; ctx.fillText(`${hour}h  L${level}`, x + 32, y + H - 10);
    });
    return { report, png: sheet.toDataURL('image/png') };
  }, { hours, W, H, level, energy, travelled, clouds, skyHint, fov, shift, conPin });
  fs.writeFileSync(out, Buffer.from(res.png.split(',')[1], 'base64'));
  for (const r of res.report) {
    const bad = r.diff > 3;
    if (bad) code = 1;
    console.log(`${String(r.hour).padStart(5)}h sun ${String(r.sunEl).padStart(6)}deg  horizon drawn ${r.drawn} vs horizonColor ${r.horizonColor} ${bad ? 'MISMATCH' : 'ok'}  lightTint ${r.lightTint}`);
  }
} catch (e) { console.error('FAILED:', String(e).slice(0, 1500)); code = 1; }
if (problems.length) { code = 1; console.log('console problems:'); for (const p of problems) console.log('  ' + p); }
await browser.close(); await server.close();
process.exit(code);
