// Photo -> one-sided splat "sheet" pipeline for the train-window scenery kit.
//
//   node scripts/photo-to-splats.mjs [--only id,id] [--width 760] [--keep-ply] [--no-spz]
//
// For every piece in scripts/kit-sources.json this script
//   1. downloads the source photo with curl (cached in node_modules/.cache/kit/, never committed)
//      and checks that the source page still states the CC0 licence;
//   2. cuts an ordinary perspective view (centre / pitch / horizontal FOV) out of the 360°
//      equirectangular panorama, so the horizon is level and sits on the view's centre row;
//   3. runs Depth Anything V2 Small (Apache-2.0, ONNX, CPU) on that view: relative inverse depth;
//   4. removes the sky (far + sky-coloured + smooth, connected to the top, plus sky seen through
//      crowns), feathers the top edge of the land, maps disparity to metres (scaled from the open
//      ground in front of the camera, or from the piece's near/far hints), snaps "flying" pixels at
//      depth edges to one side so no splat bridges a gap (the hole is left open), drops what is
//      nearer than minKeepMetres, and optionally compresses relief so near pieces tear less;
//   5. writes one Gaussian per kept pixel as a standard 3DGS .ply, then compresses it to .spz with
//      Spark's own CPU transcoder (@sparkjsdev/spark transcodeSpz, which runs in Node);
//   6. writes public/kit/index.json with placement hints, licence and attribution per piece.
//
// COORDINATE CONVENTION of every file in public/kit/ (identical to the app's camera):
//   x right (along the track), y up, z toward the viewer: the piece is authored for a camera at
//   the origin looking along -z. Depth is absolute: a pixel seen Z metres away has z = -Z.
//   y = 0 is RAIL LEVEL; the capture point (and the photo's horizon) is at y = 2.6, the app's eye
//   height. x is recentred on the piece (the shift is recorded as xShift). Place a piece with
//   position.z = 0 and it stands exactly where it was captured: its front at suggestedDistance.
//   Do not add suggestedDistance again.
//
// Colours are 8-bit sRGB straight from the (tonemapped) photo, display-referred, gently normalised
// between pieces, with highlights compressed so no channel exceeds ~0.8 (the app treats near-white
// as a light source). Each splat is oriented to the local surface (from its neighbours' positions)
// with sigma = 0.55 x its spacing to them, and thin along the normal; where the surface is torn it
// falls back to a camera-facing card with sigma = 0.55 x the pixel footprint at its depth.
// Run with --debug to write view | depth | mask sheets to node_modules/.cache/kit/debug/.
//
// Dependencies: this script needs @huggingface/transformers (which brings sharp and
// onnxruntime-node). They are deliberately not in package.json, to keep installs and deploys light:
//   npm i --no-save @huggingface/transformers
//
// Network: downloads go through curl (it uses the session's HTTPS proxy); the model files are
// fetched the same way into the local model cache and transformers.js runs fully offline.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'node_modules/.cache/kit');
const OUT = path.join(ROOT, 'public/kit');
const EYE = 2.6;                      // app camera height above rail, metres (src/window/layers.js)
const C0 = 0.28209479177387814;       // SH band-0 constant: f_dc = (rgb - 0.5) / C0
const MODEL_ID = 'onnx-community/depth-anything-v2-small-ONNX';
const MODEL_FILES = ['config.json', 'preprocessor_config.json', 'onnx/model.onnx', 'onnx/model.onnx_data'];
const EQ_W = 8192;                    // panoramas are decoded once at 8192 x 4096 and cached

// ---------- command line ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const ONLY = opt('only', '') ? opt('only').split(',') : null;
const WIDTH = Number(opt('width', 0)) || null;   // overrides every piece's view.width

// ---------- small helpers --------------------------------------------------------------------------
const log = (...a) => console.log('[kit]', ...a);
function curl(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  execFileSync('curl', ['-sS', '-L', '--fail', '--retry', '3', '-o', tmp, url], { stdio: 'inherit' });
  fs.renameSync(tmp, dest);
}
function cached(url, dest) { if (!fs.existsSync(dest)) { log('download', url); curl(url, dest); } return dest; }
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
function percentile(arr, p) {
  const a = Float32Array.from(arr).sort();
  return a.length ? a[clamp(Math.floor(p * (a.length - 1)), 0, a.length - 1)] : 0;
}

// ---------- licence check: the source page itself must still say CC0 ------------------------------
function checkLicence(src) {
  const f = cached(src.sourcePage, path.join(CACHE, 'pages', src.id + '.html'));
  const text = fs.readFileSync(f, 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\s+/g, ' ');
  if (!/CC0 License/.test(text)) throw new Error(`${src.id}: source page does not show "CC0 License"`);
  const m = text.match(/Author\s*:\s*([^\n<]{2,60}?)\s+(Copied|CC0)/);
  if (m && !src.author.includes(m[1].trim())) log(`warning: ${src.id} page author "${m[1].trim()}" differs from kit-sources.json`);
}

// ---------- panorama -> perspective view -----------------------------------------------------------
async function loadEquirect(src) {
  const small = path.join(CACHE, 'eq', `${src.id}-${EQ_W}.raw`);
  if (!fs.existsSync(small)) {
    const jpg = cached(src.sourceUrl, path.join(CACHE, 'src', src.id + '.jpg'));
    log('decode', src.id);
    fs.mkdirSync(path.dirname(small), { recursive: true });
    const buf = await sharp(jpg, { limitInputPixels: false }).resize(EQ_W, EQ_W / 2, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer();
    fs.writeFileSync(small, buf);
  }
  return { data: fs.readFileSync(small), w: EQ_W, h: EQ_W / 2 };
}

// Camera-frame ray for normalised pixel coords, rotated by the view pitch into the level frame.
function rayLevel(xn, yn, tanH, tanV, pitch) {
  const x = xn * tanH, y = yn * tanV, z = -1;
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  return [x, y * cp - z * sp, y * sp + z * cp];
}

// Sample the panorama for a W x H view, `ss` x `ss` bilinear samples per pixel. Returns RGB floats 0..1.
function cutView(eq, view, W, H, ss = 2) {
  const tanH = Math.tan((view.hfovDeg * Math.PI) / 360), tanV = tanH * H / W;
  const pitch = ((view.pitchDeg || 0) * Math.PI) / 180;
  const out = new Float32Array(W * H * 3);
  const { data, w: EW, h: EH } = eq;
  const px = (ix, iy, c) => data[((iy * EW) + ((ix % EW) + EW) % EW) * 3 + c];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let r = 0, g = 0, b = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const xn = (2 * (i + (sx + 0.5) / ss)) / W - 1, yn = 1 - (2 * (j + (sy + 0.5) / ss)) / H;
      const [dx, dy, dz] = rayLevel(xn, yn, tanH, tanV, pitch);
      const lon = Math.atan2(dx, -dz), lat = Math.atan2(dy, Math.hypot(dx, dz));
      // equirect: u grows to the right (turning right), v = 0 at the zenith
      const u = (view.centerU + lon / (2 * Math.PI)) * EW - 0.5, v = clamp((0.5 - lat / Math.PI) * EH - 0.5, 0, EH - 1.001);
      const u0 = Math.floor(u), v0 = Math.floor(v), fu = u - u0, fv = v - v0;
      for (let c = 0; c < 3; c++) {
        const val = (px(u0, v0, c) * (1 - fu) + px(u0 + 1, v0, c) * fu) * (1 - fv) + (px(u0, v0 + 1, c) * (1 - fu) + px(u0 + 1, v0 + 1, c) * fu) * fv;
        if (c === 0) r += val; else if (c === 1) g += val; else b += val;
      }
    }
    const k = 1 / (ss * ss * 255), o = (j * W + i) * 3;
    out[o] = r * k; out[o + 1] = g * k; out[o + 2] = b * k;
  }
  return { rgb: out, W, H, tanH, tanV, pitch };
}

// ---------- depth model -------------------------------------------------------------------------------
let depthPipe = null;
async function getDepthPipe() {
  if (depthPipe) return depthPipe;
  const modelsDir = path.join(CACHE, 'models');
  for (const f of MODEL_FILES) cached(`https://huggingface.co/${MODEL_ID}/resolve/main/${f}`, path.join(modelsDir, MODEL_ID, f));
  const { pipeline, env } = await import('@huggingface/transformers');
  env.allowRemoteModels = false;     // everything is already on disk; Node's fetch would bypass the proxy
  env.localModelPath = modelsDir + '/';
  env.cacheDir = modelsDir;
  depthPipe = await pipeline('depth-estimation', MODEL_ID, { dtype: 'fp32', device: 'cpu', use_external_data_format: true });
  return depthPipe;
}

// Disparity (relative inverse depth, larger = nearer) for a view, at the view's own resolution.
async function disparity(src, view, W, H, eq) {
  const f = path.join(CACHE, 'depth', `${src.id}-${W}x${H}-${view.centerU}-${view.pitchDeg || 0}-${view.hfovDeg}.f32`);
  if (fs.existsSync(f)) return new Float32Array(fs.readFileSync(f).buffer.slice(0));
  // The model works at ~518 px on the short side; feed it a sharp ~2x view.
  const s = Math.max(1, Math.round(1036 / H));
  const hi = cutView(eq, view, W * s, H * s, 1);
  const { RawImage } = await import('@huggingface/transformers');
  const u8 = new Uint8ClampedArray(hi.rgb.length);
  for (let i = 0; i < u8.length; i++) u8[i] = hi.rgb[i] * 255;
  const pipe = await getDepthPipe();
  const t0 = Date.now();
  const res = await pipe(new RawImage(u8, hi.W, hi.H, 3));
  log(`depth ${src.id}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const pd = res.predicted_depth, [dh, dw] = pd.dims.slice(-2), d = pd.data;
  // box-downsample the (already full-res) prediction to W x H
  const out = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let acc = 0, n = 0;
    for (let y = Math.floor(j * dh / H); y < Math.floor((j + 1) * dh / H); y++)
      for (let x = Math.floor(i * dw / W); x < Math.floor((i + 1) * dw / W); x++) { acc += d[y * dw + x]; n++; }
    out[j * W + i] = n ? acc / n : 0;
  }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, Buffer.from(out.buffer));
  return out;
}

// ---------- image ops on W x H masks -------------------------------------------------------------------
function lumOf(rgb, n) { const L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = 0.2126 * rgb[3 * i] + 0.7152 * rgb[3 * i + 1] + 0.0722 * rgb[3 * i + 2]; return L; }
function localStd(L, W, H, r) {   // standard deviation of luminance in a (2r+1)^2 window
  const S = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let s = 0, s2 = 0, n = 0;
    for (let y = Math.max(0, j - r); y <= Math.min(H - 1, j + r); y++)
      for (let x = Math.max(0, i - r); x <= Math.min(W - 1, i + r); x++) { const v = L[y * W + x]; s += v; s2 += v * v; n++; }
    S[j * W + i] = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
  }
  return S;
}
function morph(mask, W, H, r, dilate) {  // square dilate (true) / erode (false), radius r
  let m = mask;
  for (let k = 0; k < r; k++) {
    const o = new Uint8Array(W * H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let v = dilate ? 0 : 1;
      for (let y = j - 1; y <= j + 1; y++) for (let x = i - 1; x <= i + 1; x++) {
        const inside = x >= 0 && y >= 0 && x < W && y < H;
        const s = inside ? m[y * W + x] : m[j * W + i];
        if (dilate ? s : !s) { v = dilate ? 1 : 0; }
      }
      o[j * W + i] = v;
    }
    m = o;
  }
  return m;
}
function floodFromTop(cand, W, H) {   // 4-connected fill through candidate pixels, seeded on row 0
  const m = new Uint8Array(W * H), stack = [];
  for (let i = 0; i < W; i++) if (cand[i]) { m[i] = 1; stack.push(i); }
  while (stack.length) {
    const p = stack.pop(), x = p % W, y = (p - x) / W;
    for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1])
      if (q >= 0 && cand[q] && !m[q]) { m[q] = 1; stack.push(q); }
  }
  return m;
}
function distToMask(mask, W, H, maxD) {  // chessboard distance to nearest set pixel, capped
  const d = new Uint8Array(W * H).fill(maxD + 1);
  let front = mask;
  for (let k = 0; k <= maxD; k++) {
    for (let i = 0; i < W * H; i++) if (front[i] && d[i] > k) d[i] = k;
    front = morph(front, W, H, 1, true);
  }
  return d;
}

// ---------- one piece ---------------------------------------------------------------------------------
async function buildPiece(src) {
  const t0 = Date.now();
  checkLicence(src);
  const eq = await loadEquirect(src);
  const view = src.view;
  const W = WIDTH || view.width || 760, H = Math.round(W / (view.aspect || 16 / 9));
  const V = cutView(eq, view, W, H, 2);
  const D = await disparity(src, view, W, H, eq);
  const N = W * H, rgb = V.rgb;

  // per-pixel elevation angle in the level frame
  const elev = new Float32Array(N);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const [x, y, z] = rayLevel((2 * (i + 0.5)) / W - 1, 1 - (2 * (j + 0.5)) / H, V.tanH, V.tanV, V.pitch);
    elev[j * W + i] = Math.atan2(y, Math.hypot(x, z));
  }

  // --- sky: far + sky-like colour + smooth, above the horizon, connected to the top -----------------
  const sk = { maxDisp: 0.07, minLum: 0.38, maxSat: 0.3, maxTex: 0.045, ...(src.sky || {}) };
  const L = lumOf(rgb, N), T = localStd(L, W, H, 2);
  const dRef = percentile(D, 0.99) || 1;
  const cand = new Uint8Array(N), strict = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const r = rgb[3 * p], g = rgb[3 * p + 1], b = rgb[3 * p + 2];
    const mx = Math.max(r, g, b), sat = mx > 0 ? (mx - Math.min(r, g, b)) / mx : 0;
    const blue = b > r + 0.04 && b >= g - 0.01;
    const far = D[p] / dRef < sk.maxDisp;
    const colour = (L[p] > sk.minLum && sat < sk.maxSat) || (blue && L[p] > 0.3);
    cand[p] = elev[p] > -0.01 && far && colour && T[p] < sk.maxTex ? 1 : 0;
    // sky seen through gaps in crowns: not connected to the top and textured by the leaves around
    // it, so ignore texture but demand the model put it at (almost) infinite distance
    strict[p] = sk.holes !== false && elev[p] > 0 && colour && D[p] / dRef < sk.maxDisp * 0.4 ? 1 : 0;
  }
  let sky = floodFromTop(cand, W, H);
  sky = morph(morph(sky, W, H, 1, false), W, H, 1, true);  // open: drop sky speckles inside land
  sky = morph(morph(sky, W, H, 1, true), W, H, 1, false);  // close: fill single land pixels in the sky
  for (let p = 0; p < N; p++) if (strict[p]) sky[p] = 1;
  const skyGrow = morph(sky, W, H, sk.erode ?? 1, true);    // eat the bright fringe off the land
  const edge = distToMask(skyGrow, W, H, 4);                 // for feathering the top of the land

  // --- disparity -> metres ---------------------------------------------------------------------------
  // Far pieces (a mountain range, a town across a bay) keep only what lies above a given elevation:
  // the foreground plain below it belongs to other bands. Those pixels count as dropped-near, and
  // the hint mapping below is then fitted to what is kept, so near/far describe the piece itself.
  const minElev = src.minElevDeg != null ? (src.minElevDeg * Math.PI) / 180 : -Infinity;
  const cut = new Uint8Array(N);
  // cutNearerThanDisp: also drop anything the model puts nearer than this fraction of the 99th
  // percentile disparity (a road in the foreground of a town seen from a hill).
  const dCut = src.cutNearerThanDisp != null ? src.cutNearerThanDisp * dRef : Infinity;
  for (let p = 0; p < N; p++) cut[p] = elev[p] < minElev || D[p] > dCut ? 1 : 0;
  const land = [];
  for (let p = 0; p < N; p++) if (!skyGrow[p] && !cut[p]) land.push(D[p]);
  const dFar = percentile(land, 0.005), dNear = percentile(land, 0.995);
  const near = src.nearMetres, far = src.farMetres;
  // Scale. The model's disparity D is inverse depth up to an unknown affine map, 1/Z = a*D + b.
  // The hint mapping (D percentiles -> nearMetres / farMetres) fixes a and b by guesswork, and the
  // far end is very sensitive to it. Better, when the lower part of the view is open ground: a
  // level camera h metres up sees flat ground at elevation e at depth h / tan(-e), so those
  // pixels give 1/Z directly. Default ("ground"): b = 0, i.e. the model's zero disparity (where it
  // puts the sky) is infinity, and a is the trimmed median of (1/Z)/D over the ground pixels; this
  // extrapolates to the far field far better than a free affine fit to near ground only
  // ("ground-affine"). farMetres caps the depth; "hints" uses nearMetres/farMetres as the mapping.
  // captureHeight (default 1.7 m, a tripod) and scaleGain (multiplies depth) tune it per piece.
  let a = (1 / near - 1 / far) / Math.max(1e-6, dNear - dFar), b = 1 / far - a * dFar, scaleMode = 'hints';
  const mode = src.scale || 'ground';
  const h = src.captureHeight ?? 1.7;
  const eMin = elev[N - 1], pts = [];
  const below = src.groundBelowDeg != null ? (-src.groundBelowDeg * Math.PI) / 180 : eMin * 0.35;
  if (mode !== 'hints') for (let p = 0; p < N; p += 2) if (!skyGrow[p] && elev[p] < below && D[p] > 0) pts.push([D[p], Math.tan(-elev[p]) / h]);
  if (mode === 'ground' && pts.length > 200) {
    const ratios = pts.map(([x, y]) => y / x);
    const lo = percentile(ratios, 0.25), hi = percentile(ratios, 0.75);
    a = percentile(ratios.filter((r) => r >= lo && r <= hi), 0.5) / (src.scaleGain ?? 1); b = 0;
    scaleMode = `ground scale (${pts.length} px, h ${h} m)`;
  } else if (mode === 'ground-affine') {
    let keep = pts, fit = null;
    for (let it = 0; it < 4 && keep.length > 200; it++) {
      let sx = 0, sy = 0, sxx = 0, sxy = 0; const m = keep.length;
      for (const [x, y] of keep) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
      const fa = (m * sxy - sx * sy) / Math.max(1e-12, m * sxx - sx * sx), fb = (sy - fa * sx) / m;
      const res = keep.map(([x, y]) => Math.abs(y - (fa * x + fb))), cut = 2.5 * percentile(res, 0.5);
      fit = { a: fa, b: fb, n: m, mad: percentile(res, 0.5) };
      keep = keep.filter(([x, y]) => Math.abs(y - (fa * x + fb)) <= cut);
    }
    if (fit && fit.a > 0) { a = fit.a; b = fit.b; scaleMode = `ground fit (${fit.n} px)`; }
    else log(`${src.id}: ground fit failed, using near/far hints`);
  }
  const Z = new Float32Array(N);
  for (let p = 0; p < N; p++) Z[p] = clamp(1 / Math.max(a * D[p] + b, 1 / far), near * 0.5, far);
  log(`${src.id}: scale by ${scaleMode}; land disparity ${dFar.toFixed(2)}..${dNear.toFixed(2)} -> ${(1 / Math.max(a * dNear + b, 1e-9)).toFixed(1)}..${(1 / Math.max(a * dFar + b, 1 / far)).toFixed(0)} m`);
  // Flying pixels: at a horizontal depth jump, snap pixels between the two sides to the nearer side
  // value so no splat sits in mid-air between a tree and the hills behind it. Only horizontal
  // neighbours matter: the camera slides in x, so vertical depth ratios (grazing ground) never tear.
  const JUMP = src.jumpLog ?? 0.12, R = 2;
  const lz = Z.map(Math.log), snapped = new Float32Array(lz);
  const isEdge = new Uint8Array(N);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let mn = Infinity, mx = -Infinity;
    for (let x = Math.max(0, i - R); x <= Math.min(W - 1, i + R); x++) { const v = lz[j * W + x]; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mx - mn > JUMP) {
      const v = lz[j * W + i];
      snapped[j * W + i] = v - mn < mx - v ? mn : mx;
      isEdge[j * W + i] = 1;
    }
  }

  // diagnostic: implied capture height from the ground in the bottom rows (should be ~1.5-1.8 m)
  const hs = [];
  for (let j = Math.floor(H * 0.9); j < H; j++) for (let i = 0; i < W; i += 3) { const p = j * W + i; if (elev[p] < -0.02) hs.push(Math.exp(snapped[p]) * Math.tan(-elev[p])); }
  const captureHeight = percentile(hs, 0.5);

  // --- colour normalisation ----------------------------------------------------------------------------
  const means = [0, 0, 0]; let nl = 0;
  for (let p = 0; p < N; p++) if (!skyGrow[p]) { means[0] += rgb[3 * p]; means[1] += rgb[3 * p + 1]; means[2] += rgb[3 * p + 2]; nl++; }
  for (let c = 0; c < 3; c++) means[c] /= Math.max(1, nl);
  const mLum = 0.2126 * means[0] + 0.7152 * means[1] + 0.0722 * means[2];
  const gain = clamp((src.targetLum ?? 0.34) / Math.max(1e-3, mLum), 0.75, 1.35);
  const wb = means.map((m) => 1 + 0.25 * (mLum / Math.max(1e-3, m) - 1));   // 25% grey-world
  const KNEE = 0.62, TOP = 0.8;
  const tone = (x) => (x <= KNEE ? x : KNEE + (TOP - KNEE) * (1 - Math.exp(-(x - KNEE) / (TOP - KNEE))));

  const minKeep = src.minKeepMetres ?? near;

  // --- debug sheet: view | log depth | what is kept (sky red, dropped-near blue, edges yellow) ------------
  if (flag('debug')) {
    const img = Buffer.alloc(W * 3 * H * 3);
    const lzMin = Math.log(near), lzMax = Math.log(far);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const p = j * W + i, o = (j * W * 3 + i) * 3;
      for (let c = 0; c < 3; c++) img[o + c] = clamp(rgb[3 * p + c] * 255, 0, 255);
      const g = clamp((1 - (snapped[p] - lzMin) / (lzMax - lzMin)) * 255, 0, 255);
      img[o + W * 3] = img[o + W * 3 + 1] = img[o + W * 3 + 2] = g;
      const q = o + 2 * W * 3;
      for (let c = 0; c < 3; c++) img[q + c] = clamp(rgb[3 * p + c] * 255, 0, 255);
      if (skyGrow[p]) { img[q] = 230; img[q + 1] = 40; img[q + 2] = 40; }
      else if (Math.exp(snapped[p]) < minKeep || cut[p]) { img[q] = 40; img[q + 1] = 60; img[q + 2] = 230; }
      else if (isEdge[p]) { img[q] = 240; img[q + 1] = 220; img[q + 2] = 0; }
      else if (edge[p] <= 3) { img[q] = 250; img[q + 1] = 120; img[q + 2] = 250; }
    }
    fs.mkdirSync(path.join(CACHE, 'debug'), { recursive: true });
    await sharp(img, { raw: { width: W * 3, height: H, channels: 3 } }).png().toFile(path.join(CACHE, 'debug', src.id + '.png'));
  }

  // --- splats --------------------------------------------------------------------------------------------
  const pix = (2 * V.tanH) / W;    // pixel footprint per metre of depth
  const cp = Math.cos(V.pitch), sp = Math.sin(V.pitch);
  // Relief: optionally compress depth variation (in log depth, around the median of the kept land)
  // so close pieces flatten toward a billboard and tear less when seen 30° off axis.
  const relief = src.relief ?? 1;
  // The model blends depth toward the sky at a skyline, so the outermost land pixels come out too
  // far and, seen from the side, hang in the sky as loose dots. Pull them to the nearest land depth
  // close by (the ridge or crown they belong to).
  {
    const fixed = new Float32Array(snapped), r = 3;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const p = j * W + i;
      if (skyGrow[p] || edge[p] > 4) continue;
      let mn = snapped[p];
      for (let y = Math.max(0, j - r); y <= Math.min(H - 1, j + r); y++)
        for (let x = Math.max(0, i - r); x <= Math.min(W - 1, i + r); x++) { const q = y * W + x; if (!skyGrow[q] && snapped[q] < mn) mn = snapped[q]; }
      fixed[p] = mn;
    }
    snapped.set(fixed);
  }
  const keepMask = new Uint8Array(N);   // decided on true depth, before any relief compression
  for (let p = 0; p < N; p++) keepMask[p] = !skyGrow[p] && !cut[p] && Math.exp(snapped[p]) >= minKeep ? 1 : 0;
  // A thin near object standing in front of kept content (a fence post) would leave a post-shaped
  // hole in the sheet. Fill such short gaps from the side: copy depth and colour of the farther of
  // the nearest kept pixels to the left and right in the same row (the background behind it).
  const GAP = src.fillGapPx ?? 14;
  for (let j = 0; j < H; j++) {
    const row = j * W;
    for (let i = 0; i < W; i++) {
      const p = row + i;
      if (keepMask[p] || skyGrow[p] || cut[p]) continue;
      let l = i - 1, r = i + 1;
      while (l >= 0 && i - l <= GAP && !keepMask[row + l]) l--;
      while (r < W && r - i <= GAP && !keepMask[row + r]) r++;
      if (l < 0 || r >= W || i - l > GAP || r - i > GAP) continue;
      const q = snapped[row + l] > snapped[row + r] ? row + l : row + r;
      snapped[p] = snapped[q];
      rgb[3 * p] = rgb[3 * q]; rgb[3 * p + 1] = rgb[3 * q + 1]; rgb[3 * p + 2] = rgb[3 * q + 2];
      keepMask[p] = 2;   // filled (counts as kept from here on)
    }
  }
  // Drop small islands of kept pixels (wisps of cloud the sky test missed, specks above a ridge).
  {
    const minComp = src.minIslandPx ?? 300, label = new Int32Array(N).fill(-1), stack = [];
    for (let s = 0; s < N; s++) {
      if (!keepMask[s] || label[s] >= 0) continue;
      const members = [s]; label[s] = s; stack.push(s);
      while (stack.length) {
        const p = stack.pop(), x = p % W;
        for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, p - W, p + W])
          if (q >= 0 && q < N && keepMask[q] && label[q] < 0) { label[q] = s; members.push(q); stack.push(q); }
      }
      if (members.length < minComp) for (const q of members) keepMask[q] = 0;
    }
  }
  if (relief !== 1) {
    const kept = []; for (let p = 0; p < N; p += 3) if (keepMask[p]) kept.push(snapped[p]);
    const ref = percentile(kept, 0.5);
    for (let p = 0; p < N; p++) if (keepMask[p]) snapped[p] = ref + relief * (snapped[p] - ref);
  }
  // 3D position of every pixel (level frame, eye at y = 2.6); NaN where nothing is kept
  const P = new Float32Array(N * 3).fill(NaN);
  let dropped = { sky: 0, near: 0 };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const p = j * W + i;
    if (skyGrow[p]) { dropped.sky++; continue; }
    const z = Math.exp(snapped[p]);
    if (!keepMask[p]) { dropped.near++; continue; }
    const xn = (2 * (i + 0.5)) / W - 1, yn = 1 - (2 * (j + 0.5)) / H;
    const cx = xn * V.tanH * z, cy = yn * V.tanV * z, cz = -z;       // camera frame, z-depth = z
    P[3 * p] = cx; P[3 * p + 1] = cy * cp - cz * sp + EYE; P[3 * p + 2] = cy * sp + cz * cp;
  }
  // Tangent to a neighbour: of the two one-sided differences, the shorter valid one (so a splat on a
  // depth edge leans along its own side, never across the gap); null if neither is usable.
  const tangent = (p, q1, q2, maxLen) => {
    let best = null, bl = Infinity;
    for (const [q, sgn] of [[q1, 1], [q2, -1]]) {
      if (q < 0 || Number.isNaN(P[3 * q])) continue;
      const t = [(P[3 * q] - P[3 * p]) * sgn, (P[3 * q + 1] - P[3 * p + 1]) * sgn, (P[3 * q + 2] - P[3 * p + 2]) * sgn];
      const l = Math.hypot(t[0], t[1], t[2]);
      if (l < bl && l < maxLen) { best = t; bl = l; }
    }
    return best;
  };
  const pos = [], col = [], sc = [], op = [], rot = [];
  const orient = src.orient ?? true;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const p = j * W + i;
    if (Number.isNaN(P[3 * p])) continue;
    const z = Math.exp(snapped[p]), fp = pix * z;                      // pixel footprint at depth
    pos.push(P[3 * p], P[3 * p + 1], P[3 * p + 2]);
    for (let c = 0; c < 3; c++) col.push(tone(clamp(rgb[3 * p + c] * gain * wb[c], 0, 1.5)));
    let a = 0.97;
    if (edge[p] <= 3) a *= (edge[p] + 1) / 5;                         // feather the land's top edge
    if (isEdge[p]) a *= 0.85;                                         // soften torn edges a little
    op.push(a);
    // Orient the splat to the local surface (spanned by its right and lower neighbours), so a
    // surface that recedes in depth stays closed when the camera looks at it from the side.
    // Falls back to a camera-facing card where the surface is torn or seen edge-on.
    const tx = orient ? tangent(p, i < W - 1 ? p + 1 : -1, i > 0 ? p - 1 : -1, 4 * fp) : null;
    const ty = orient ? tangent(p, j < H - 1 ? p + W : -1, j > 0 ? p - W : -1, 4 * fp) : null;
    if (tx && ty) {
      const lu = Math.hypot(...tx), u = tx.map((v) => v / lu);
      const d = ty[0] * u[0] + ty[1] * u[1] + ty[2] * u[2];
      const vr = [ty[0] - d * u[0], ty[1] - d * u[1], ty[2] - d * u[2]], lv = Math.hypot(...vr);
      if (lv > 0.2 * fp) {
        const v = vr.map((x) => x / lv);
        const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        // rotation matrix with columns u, v, n -> quaternion (w, x, y, z)
        const m00 = u[0], m10 = u[1], m20 = u[2], m01 = v[0], m11 = v[1], m21 = v[2], m02 = nrm[0], m12 = nrm[1], m22 = nrm[2];
        const tr = m00 + m11 + m22; let qw, qx, qy, qz;
        if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; qw = 0.25 * s; qx = (m21 - m12) / s; qy = (m02 - m20) / s; qz = (m10 - m01) / s; }
        else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; qw = (m21 - m12) / s; qx = 0.25 * s; qy = (m01 + m10) / s; qz = (m02 + m20) / s; }
        else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; qw = (m02 - m20) / s; qx = (m01 + m10) / s; qy = 0.25 * s; qz = (m12 + m21) / s; }
        else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; qw = (m10 - m01) / s; qx = (m02 + m20) / s; qy = (m12 + m21) / s; qz = 0.25 * s; }
        const su = 0.55 * Math.max(lu, 0.5 * fp), sv = 0.55 * Math.max(lv, 0.5 * fp);
        sc.push(su, sv, 0.15 * Math.min(su, sv));
        rot.push(qw, qx, qy, qz);
        continue;
      }
    }
    const s = 0.55 * fp;
    sc.push(s, s, s * (src.thickness ?? 0.3));
    rot.push(1, 0, 0, 0);
  }
  const n = op.length;
  // Recentre x on the piece: the middle of the near half of its content (far splats fan out over
  // hundreds of metres and would drag a plain bounding-box centre around). For a view centred on
  // its optical axis this is a small shift; the capture point ends up at x = -xShift.
  const zs = []; for (let k = 0; k < n; k += 5) zs.push(-pos[3 * k + 2]);
  const zMid = percentile(zs, 0.5), xs = [];
  for (let k = 0; k < n; k += 3) if (-pos[3 * k + 2] <= zMid) xs.push(pos[3 * k]);
  const xShift = (percentile(xs, 0.02) + percentile(xs, 0.98)) / 2;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let k = 0; k < n; k++) {
    pos[3 * k] -= xShift;
    minX = Math.min(minX, pos[3 * k]); maxX = Math.max(maxX, pos[3 * k]);
    minY = Math.min(minY, pos[3 * k + 1]); maxY = Math.max(maxY, pos[3 * k + 1]);
  }
  const depths = []; for (let k = 0; k < n; k += 5) depths.push(-pos[3 * k + 2]);

  // --- write .ply, then .spz via Spark's own transcoder ----------------------------------------------------
  const props = ['x', 'y', 'z', 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
  const header = `ply\nformat binary_little_endian 1.0\ncomment soma-rail kit piece ${src.id}: x right, y up (rail = 0, eye = 2.6), camera looks along -z\nelement vertex ${n}\n${props.map((q) => `property float ${q}\n`).join('')}end_header\n`;
  const body = Buffer.alloc(n * props.length * 4);
  const logit = (a) => Math.log(a / (1 - a));
  for (let k = 0, o = 0; k < n; k++) {
    const vals = [pos[3 * k], pos[3 * k + 1], pos[3 * k + 2],
      (col[3 * k] - 0.5) / C0, (col[3 * k + 1] - 0.5) / C0, (col[3 * k + 2] - 0.5) / C0,
      logit(clamp(op[k], 0.01, 0.995)), Math.log(sc[3 * k]), Math.log(sc[3 * k + 1]), Math.log(sc[3 * k + 2]), rot[4 * k], rot[4 * k + 1], rot[4 * k + 2], rot[4 * k + 3]];
    for (const v of vals) { body.writeFloatLE(v, o); o += 4; }
  }
  const ply = Buffer.concat([Buffer.from(header), body]);
  fs.mkdirSync(OUT, { recursive: true });
  let file = `${src.id}.ply`, bytes = ply;
  const plyCache = path.join(CACHE, 'ply', file);
  fs.mkdirSync(path.dirname(plyCache), { recursive: true });
  fs.writeFileSync(plyCache, ply);
  if (!flag('no-spz')) {
    const { transcodeSpz } = await import('@sparkjsdev/spark');
    let maxAbs = 1; for (let k = 0; k < pos.length; k++) maxAbs = Math.max(maxAbs, Math.abs(pos[k]));
    const fractionalBits = clamp(Math.floor(Math.log2((2 ** 23 - 1) / maxAbs)), 4, 12);   // 24-bit fixed point
    const r = await transcodeSpz({ inputs: [{ fileBytes: new Uint8Array(ply), pathOrUrl: file }], maxSh: 0, fractionalBits });
    file = `${src.id}.spz`; bytes = Buffer.from(r.fileBytes);
  }
  for (const ext of ['.ply', '.spz']) { const f = path.join(OUT, src.id + ext); if (fs.existsSync(f)) fs.unlinkSync(f); }
  fs.writeFileSync(path.join(OUT, file), bytes);
  if (flag('keep-ply') && file.endsWith('.spz')) fs.writeFileSync(path.join(OUT, `${src.id}.ply`), ply);

  const secs = (Date.now() - t0) / 1000;
  log(`${src.id}: ${n} splats, ${(bytes.length / 1e6).toFixed(2)} MB, sky ${dropped.sky}, near ${dropped.near}, implied capture height ${captureHeight.toFixed(2)} m, ${secs.toFixed(1)} s`);
  const r1 = (x) => Math.round(x * 10) / 10;
  return {
    id: src.id, title: src.title, file, splats: n, bytes: bytes.length,
    widthMetres: r1(maxX - minX), heightMetres: r1(maxY - minY), yRange: [r1(minY), r1(maxY)],
    depthRange: [r1(percentile(depths, 0.01)), r1(percentile(depths, 0.99))],
    suggestedDistance: r1(percentile(depths, 0.05)), medianDepth: r1(percentile(depths, 0.5)),
    // groundY only means something when the scale came from the ground under a ~1.7 m camera
    groundY: scaleMode.startsWith('ground') ? r1(EYE - captureHeight) : null, impliedCaptureHeight: Math.round(captureHeight * 100) / 100,
    xShift: r1(xShift), band: src.band,
    licence: src.licence, author: src.author, attribution: src.attribution, sourcePage: src.sourcePage, sourceUrl: src.sourceUrl,
    view: { ...view, width: W, height: H }, nearMetres: near, farMetres: far, scale: scaleMode,
    minKeepMetres: minKeep, relief,
  };
}

// ---------- main ----------------------------------------------------------------------------------------
const sources = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/kit-sources.json'), 'utf8'));
const indexPath = path.join(OUT, 'index.json');
const prev = fs.existsSync(indexPath) ? JSON.parse(fs.readFileSync(indexPath, 'utf8')).pieces || [] : [];
const pieces = new Map(prev.map((p) => [p.id, p]));
for (const src of sources.pieces) {
  if (src.disabled) {   // dropped pieces: remove their files too
    pieces.delete(src.id);
    for (const ext of ['.ply', '.spz']) { const f = path.join(OUT, src.id + ext); if (fs.existsSync(f)) fs.unlinkSync(f); }
    continue;
  }
  if (ONLY && !ONLY.includes(src.id)) continue;
  pieces.set(src.id, await buildPiece(src));
}
const order = sources.pieces.map((s) => s.id);
const index = {
  about: 'One-sided Gaussian-splat relief sheets made from CC0 photos (photo + monocular depth). Generated by scripts/photo-to-splats.mjs from scripts/kit-sources.json.',
  convention: 'x right (along the track), y up, camera at the origin looking along -z. y = 0 is rail level; the capture point and the photo horizon are at y = 2.6 (eye height). Depth is absolute: place a piece at position.z = 0 and its front stands at suggestedDistance metres (do not add it again). x is recentred on the piece (xShift records the shift). yRange is the lowest and highest splat (y = 0 is rail level: pieces seen from a hill reach well below it, where the engine terrain would hide them). groundY is roughly where the photo\'s own ground plane lands (2.6 minus the implied capture height); null for pieces scaled from near/far hints (views from a hilltop, far ranges), whose content may sit far below rail level. depthRange, suggestedDistance and medianDepth are measured on the file as written, i.e. after relief compression (relief < 1 squeezes log depth toward the median so near pieces tear less from the side). Colours are display-referred sRGB, max channel ~0.8.',
  format: 'Spark-loadable .spz (gzip, 24-bit fixed-point positions, SH degree 0), transcoded from a standard 3DGS binary .ply by @sparkjsdev/spark transcodeSpz.',
  depthModel: { id: MODEL_ID, base: 'depth-anything/Depth-Anything-V2-Small', licence: 'Apache-2.0', url: 'https://huggingface.co/depth-anything/Depth-Anything-V2-Small' },
  pieces: [...pieces.values()].filter((p) => order.includes(p.id)).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)),
};
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
log(`wrote ${indexPath}: ${index.pieces.length} pieces, ${(index.pieces.reduce((s, p) => s + p.bytes, 0) / 1e6).toFixed(1)} MB`);
