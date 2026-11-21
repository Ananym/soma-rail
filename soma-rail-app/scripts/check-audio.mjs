// Checks for the music-analysis module (src/window/audioAnalysis.js and src/window/audio.js).
//   node scripts/check-audio.mjs            pure checks in Node, then the browser checks if Playwright loads
//   node scripts/check-audio.mjs --node     pure checks only
//   node scripts/check-audio.mjs --live     also play a real SomaFM stream through attachElement
//                                           (needs network; uses HTTPS_PROXY when set)
// Exits non-zero on any failure.
//
// The Node part synthesises audio, then imitates what the tap sees: at each animation frame
// (60 or 30 fps) it takes the newest 2048 samples, applies a Blackman window and an FFT, and turns
// magnitudes into dBFS the way AnalyserNode.getFloatFrequencyData does (smoothingTimeConstant 0).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import {
  createOnsetDetector, createTempoEstimator, createAutoGain, createBandMeter, DEFAULT_BANDS,
} from '../src/window/audioAnalysis.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const failures = [];
let checks = 0;
function check(ok, label) {
  checks++;
  if (!ok) failures.push(label);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}`);
}

// ---------- signal synthesis ----------

// Seeded PRNG so noise-based checks are repeatable.
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Add a short decaying noise click at time t.
function addClick(buf, sr, t, amp, rnd) {
  const i0 = Math.round(t * sr), len = Math.round(0.006 * sr);
  for (let i = 0; i < len && i0 + i < buf.length; i++) buf[i0 + i] += amp * (rnd() * 2 - 1) * Math.exp(-i / (0.0015 * sr));
}
// A kick: a sine sweeping from 140 Hz to 45 Hz with a 160 ms decay.
function addKick(buf, sr, t, amp) {
  const i0 = Math.round(t * sr), len = Math.round(1.0 * sr);   // long enough to end inaudibly
  let ph = 0;
  for (let i = 0; i < len && i0 + i < buf.length; i++) {
    const s = i / sr;
    const f = 45 + 95 * Math.exp(-s / 0.03);
    ph += (2 * Math.PI * f) / sr;
    buf[i0 + i] += amp * Math.sin(ph) * Math.exp(-s / 0.16);
  }
}
// A hi-hat: differentiated (so high-passed) noise with a 30 ms decay.
function addHat(buf, sr, t, amp, rnd) {
  const i0 = Math.round(t * sr), len = Math.round(0.12 * sr);
  let prev = 0;
  for (let i = 0; i < len && i0 + i < buf.length; i++) {
    const n = rnd() * 2 - 1;
    buf[i0 + i] += amp * (n - prev) * 0.5 * Math.exp(-i / (0.03 * sr));
    prev = n;
  }
}
// A snare: band-ish noise plus a 190 Hz body.
function addSnare(buf, sr, t, amp, rnd) {
  const i0 = Math.round(t * sr), len = Math.round(0.2 * sr);
  for (let i = 0; i < len && i0 + i < buf.length; i++) {
    const s = i / sr;
    buf[i0 + i] += amp * ((rnd() * 2 - 1) * 0.6 * Math.exp(-s / 0.06) + 0.5 * Math.sin(2 * Math.PI * 190 * s) * Math.exp(-s / 0.08));
  }
}

function clickTrack(bpm, sr, secs, seed = 1) {
  const buf = new Float32Array(Math.round(sr * secs)), rnd = mulberry32(seed), times = [];
  const T = 60 / bpm;
  for (let t = 0.5; t < secs - 0.01; t += T) { addClick(buf, sr, t, 0.6, rnd); times.push(t); }
  return { buf, times };
}

// Four-on-the-floor kick with hats on every eighth (louder on the off-beat), optionally swung,
// with snare on 2 and 4, optionally dropping beats.
function drumPattern(bpm, sr, secs, { swing = 0, drop = null, snare = false, seed = 2 } = {}) {
  const buf = new Float32Array(Math.round(sr * secs)), rnd = mulberry32(seed), times = [];
  const T = 60 / bpm;
  let beat = 0;
  for (let t = 0.5; t < secs - 0.01; t += T, beat++) {
    const inBar = beat % 4, bar = Math.floor(beat / 4);
    const dropped = drop && drop(bar, inBar);
    if (!dropped) { addKick(buf, sr, t, 0.8); times.push(t); }
    if (snare && (inBar === 1 || inBar === 3)) addSnare(buf, sr, t, 0.35, rnd);
    addHat(buf, sr, t, 0.12, rnd);
    addHat(buf, sr, t + T * (0.5 + swing), 0.25, rnd);
  }
  return { buf, times };
}

function pinkNoise(sr, secs, seed = 3) {
  const buf = new Float32Array(Math.round(sr * secs)), rnd = mulberry32(seed);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < buf.length; i++) {   // Paul Kellet's refined filter
    const w = rnd() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    buf[i] = 0.06 * (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362); b6 = w * 0.115926;
  }
  return { buf, times: [] };
}

// A slow pad: three detuned chords cross-fading every 4 s, with a slow swell.
function sinePad(sr, secs) {
  const buf = new Float32Array(Math.round(sr * secs));
  const chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6]];
  for (let i = 0; i < buf.length; i++) {
    const t = i / sr, c = t / 4, ci = Math.floor(c) % 3, f = c - Math.floor(c);
    const x = Math.min(1, f / 0.4);  // 1.6 s crossfade
    const swell = 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.11 * t);
    let s = 0;
    for (const [w, ch] of [[x, chords[ci]], [1 - x, chords[(ci + 2) % 3]]])
      for (const hz of ch) s += w * (Math.sin(2 * Math.PI * hz * t) + 0.3 * Math.sin(2 * Math.PI * hz * 1.003 * t));
    buf[i] = 0.08 * swell * s;
  }
  return { buf, times: [] };
}

// ---------- an AnalyserNode imitation ----------

function makeAnalyser(fftSize) {
  const n = fftSize, half = n / 2;
  const win = new Float64Array(n);
  for (let i = 0; i < n; i++) {   // Blackman, as the Web Audio spec prescribes (alpha 0.16)
    const x = (2 * Math.PI * i) / n;
    win[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
  }
  const rev = new Uint32Array(n);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1); rev[i] = r; }
  const re = new Float64Array(n), im = new Float64Array(n);
  const cos = new Float64Array(half), sin = new Float64Array(half);
  for (let i = 0; i < half; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  const spec = new Float32Array(half);
  return {
    spec,
    // dB spectrum of the fftSize samples ending at sample index `end` (exclusive)
    frame(buf, end, gain = 1) {
      for (let i = 0; i < n; i++) {
        const j = end - n + i;
        re[rev[i]] = (j >= 0 && j < buf.length ? buf[j] * gain : 0) * win[i];
        im[rev[i]] = 0;
      }
      for (let size = 2; size <= n; size <<= 1) {
        const h = size >> 1, stepTw = n / size;
        for (let s = 0; s < n; s += size) {
          for (let k = 0; k < h; k++) {
            const c = cos[k * stepTw], si = sin[k * stepTw];
            const a = s + k, b = a + h;
            const tr = re[b] * c - im[b] * si, ti = re[b] * si + im[b] * c;
            re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          }
        }
      }
      for (let i = 0; i < half; i++) spec[i] = 20 * Math.log10(Math.hypot(re[i], im[i]) / n);   // -Infinity for silence, like Chrome
      return spec;
    },
  };
}

// Run a signal through the per-frame pipeline the tap uses.
// jitter: each frame interval is 1/fps times a random factor in [1 - jitter, 1 + jitter].
function analyse(buf, sr, fps, { fftSize = 2048, onFrame, jitter = 0 } = {}) {
  const an = makeAnalyser(fftSize);
  const det = createOnsetDetector({ sampleRate: sr, fftSize });
  const tempo = createTempoEstimator();
  const onsets = [];
  const track = [];
  const dur = buf.length / sr;
  let cost = 0, frames = 0;
  const rnd = mulberry32(99);
  for (let t = 1 / fps; t <= dur; t += (1 + jitter * (rnd() * 2 - 1)) / fps) {
    const spec = an.frame(buf, Math.round(t * sr));
    const t0 = performance.now();
    const r = det.push(spec, t);
    tempo.push(r.flux, t);
    const e = tempo.estimate();
    cost += performance.now() - t0; frames++;
    if (r.onset) onsets.push(t);
    track.push({ t, bpm: e.bpm, conf: e.confidence });
    if (onFrame) onFrame(t, spec, r, e);
  }
  return { onsets, track, final: track[track.length - 1], costMs: cost / frames, raw: tempo.raw };
}

// The first time from which the reported bpm stays within tol of any accepted value.
function lockTime(track, accepted, tol = 0.02) {
  let lock = null;
  for (const p of track) {
    const ok = p.bpm > 0 && accepted.some((a) => Math.abs(p.bpm / a - 1) <= tol);
    if (ok && lock == null) lock = p.t;
    if (!ok) lock = null;
  }
  return lock;
}

// ---------- tempo ----------

const table = [];
console.log('\nTempo (12 s of audio each)');
const BPMS = [70, 90, 100, 120, 128, 140, 174];
const CONFIGS = [{ sr: 44100, fps: 60 }, { sr: 44100, fps: 30 }, { sr: 48000, fps: 60 }, { sr: 48000, fps: 30 }];
let worstCost = 0;
for (const bpm of BPMS) {
  const octaveOk = bpm === 70 || bpm === 174;
  const accepted = octaveOk ? [bpm, bpm === 70 ? bpm * 2 : bpm / 2] : [bpm];
  for (const kind of ['click', 'kick+hat']) {
    for (const { sr, fps } of CONFIGS) {
      const { buf } = kind === 'click' ? clickTrack(bpm, sr, 12) : drumPattern(bpm, sr, 12);
      const res = analyse(buf, sr, fps);
      worstCost = Math.max(worstCost, res.costMs);
      const got = res.final.bpm;
      const lt = lockTime(res.track, accepted);
      const exact = Math.abs(got / bpm - 1) <= 0.02;
      const ok = lt != null && accepted.some((a) => Math.abs(got / a - 1) <= 0.02);
      const note = ok && !exact ? ` (octave: ${got.toFixed(1)} for ${bpm})` : '';
      table.push({ case: `${kind} ${bpm}`, sr, fps, bpm: +got.toFixed(2), lock: lt == null ? '-' : +lt.toFixed(2), conf: +res.final.conf.toFixed(2), strength: +res.raw.strength.toFixed(3),note: note.trim() });
      check(ok, `${kind} ${bpm} BPM @ ${sr} Hz / ${fps} fps -> ${got.toFixed(2)} (lock ${lt == null ? 'never' : lt.toFixed(2) + ' s'}, conf ${res.final.conf.toFixed(2)})${note}`);
    }
  }
}

console.log('\nTempo, harder patterns');
const HARD = [
  ['swing 2/3 + snare 96', 96, (sr) => drumPattern(96, sr, 12, { swing: 1 / 6, snare: true })],
  ['swing 2/3 + snare 124', 124, (sr) => drumPattern(124, sr, 12, { swing: 1 / 6, snare: true })],
  ['beat 4 missing every bar 120', 120, (sr) => drumPattern(120, sr, 12, { drop: (bar, b) => b === 3 })],
  ['bar 2 of 4 silent, 110', 110, (sr) => drumPattern(110, sr, 12, { drop: (bar) => bar % 4 === 1 })],
];
for (const [label, bpm, make] of HARD) {
  for (const { sr, fps } of CONFIGS) {
    const res = analyse(make(sr).buf, sr, fps);
    const got = res.final.bpm, lt = lockTime(res.track, [bpm]);
    table.push({ case: label, sr, fps, bpm: +got.toFixed(2), lock: lt == null ? '-' : +lt.toFixed(2), conf: +res.final.conf.toFixed(2), strength: +res.raw.strength.toFixed(3),note: '' });
    check(lt != null && Math.abs(got / bpm - 1) <= 0.02, `${label} @ ${sr}/${fps} -> ${got.toFixed(2)} (lock ${lt == null ? 'never' : lt.toFixed(2) + ' s'}, conf ${res.final.conf.toFixed(2)})`);
  }
}

console.log('\nNo tempo for arrhythmic input');
for (const [label, make] of [
  ['pink noise seed 3', (sr) => pinkNoise(sr, 14, 3)], ['pink noise seed 11', (sr) => pinkNoise(sr, 14, 11)],
  ['pink noise seed 29', (sr) => pinkNoise(sr, 14, 29)], ['slow sine pad', (sr) => sinePad(sr, 14)],
]) {
  for (const { sr, fps } of CONFIGS) {
    const res = analyse(make(sr).buf, sr, fps);
    const maxConf = Math.max(...res.track.map((p) => p.conf));
    const anyBpm = res.track.some((p) => p.bpm > 0);
    table.push({ case: label, sr, fps, bpm: res.final.bpm, lock: '-', conf: +res.final.conf.toFixed(2), strength: +res.raw.strength.toFixed(3),note: `max conf ${maxConf.toFixed(2)}${anyBpm ? ', reported a bpm at some point' : ''}` });
    check(res.final.bpm === 0 || res.final.conf < 0.3, `${label} @ ${sr}/${fps}: bpm ${res.final.bpm.toFixed(1)}, conf ${res.final.conf.toFixed(2)} (max ${maxConf.toFixed(2)}, ever reported ${anyBpm})`);
  }
}

console.log('\nTempo at 120 fps and with frame jitter');
{
  const sr = 48000, { buf } = drumPattern(128, sr, 12);
  const res = analyse(buf, sr, 120);
  check(Math.abs(res.final.bpm / 128 - 1) <= 0.02, `kick+hat 128 @ 120 fps -> ${res.final.bpm.toFixed(2)}`);
  for (const bpm of [100, 140]) {
    const j = analyse(drumPattern(bpm, sr, 12).buf, sr, 60, { jitter: 0.4 });
    check(Math.abs(j.final.bpm / bpm - 1) <= 0.02, `kick+hat ${bpm} @ 60 fps with +-40% frame jitter -> ${j.final.bpm.toFixed(2)}`);
    const c = clickTrack(bpm + 3, sr, 12), jo = analyse(c.buf, sr, 60, { jitter: 0.4 });
    const s = onsetScore(jo.onsets, c.times);
    check(s.hit >= 0.95 * s.total && s.fp < 0.1 * jo.onsets.length, `clicks ${bpm + 3} @ 60 fps with jitter: ${s.hit}/${s.total} found, ${s.fp} false, worst ${(s.worst * 1000).toFixed(1)} ms`);
  }
}

check(worstCost < 1, `average per-frame cost of onset + tempo ${worstCost.toFixed(3)} ms (< 1 ms)`);

// ---------- onsets ----------

console.log('\nOnsets');
function onsetScore(onsets, truth, tol = 0.04) {
  let hit = 0, fp = 0, worst = 0;
  const used = new Set();
  for (const o of onsets) {
    let bi = -1, bd = Infinity;
    truth.forEach((c, i) => { const d = Math.abs(o - c); if (d < bd && !used.has(i)) { bd = d; bi = i; } });
    if (bd <= tol) { hit++; used.add(bi); worst = Math.max(worst, bd); } else fp++;
  }
  return { hit, fp, total: truth.length, worst };
}
for (const bpm of [100, 120, 174]) {
  for (const { sr, fps } of [...CONFIGS, { sr: 48000, fps: 120 }]) {
    const { buf, times } = clickTrack(bpm, sr, 12);
    const res = analyse(buf, sr, fps);
    const s = onsetScore(res.onsets, times);
    check(s.hit >= 0.95 * s.total && s.fp < 0.1 * res.onsets.length,
      `clicks ${bpm} @ ${sr}/${fps}: ${s.hit}/${s.total} found, ${s.fp} false of ${res.onsets.length}, worst offset ${(s.worst * 1000).toFixed(1)} ms`);
  }
}
for (const { sr, fps } of CONFIGS) {
  // Kicks with quieter hats on every eighth: every kick must be found; hats may add onsets, but
  // nothing away from a kick or a hat may.
  const { buf, times: kicks } = drumPattern(120, sr, 12);
  const events = [];
  for (let t = 0.5; t < 11.99; t += 0.25) events.push(t);
  const res = analyse(buf, sr, fps);
  const k = onsetScore(res.onsets, kicks), all = onsetScore(res.onsets, events);
  check(k.hit >= 0.95 * kicks.length && all.fp < 0.1 * res.onsets.length,
    `kick+hat 120 @ ${sr}/${fps}: ${k.hit}/${kicks.length} kicks found, ${all.hit - k.hit} hats, ${all.fp} false of ${res.onsets.length}, worst ${(all.worst * 1000).toFixed(1)} ms`);
}
{
  const sr = 44100, res = analyse(pinkNoise(sr, 10, 5).buf, sr, 60);
  check(res.onsets.length < 10, `pink noise: ${res.onsets.length} onsets in 10 s`);
}

// ---------- bands ----------

console.log('\nBand energies');
{
  const sr = 48000, n = sr * 2;
  const bassy = new Float32Array(n), trebly = new Float32Array(n), rnd = mulberry32(9);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    bassy[i] = 0.4 * Math.sin((2 * Math.PI * 70 * i) / sr) + 0.02 * (rnd() * 2 - 1);
    const w = rnd() * 2 - 1; trebly[i] = 0.3 * (w - prev); prev = w;
  }
  const an = makeAnalyser(2048), meter = createBandMeter(sr, 2048);
  const a = meter.measure(an.frame(bassy, n), {}), b = meter.measure(an.frame(trebly, n), {});
  console.log('   bass-heavy', JSON.stringify(a, (k, v) => typeof v === 'number' ? +v.toExponential(2) : v));
  console.log('   treble-heavy', JSON.stringify(b, (k, v) => typeof v === 'number' ? +v.toExponential(2) : v));
  check(a.bass > 10 * a.treble && b.treble > 10 * b.bass, 'bass-heavy input lights bass, treble-heavy input lights treble');
  check(a.bass > 10 * b.bass && b.treble > 10 * a.treble, 'each band moves between the two inputs');
  check(Object.keys(DEFAULT_BANDS).join() === 'bass,mid,treble' && DEFAULT_BANDS.bass[0] === 40 && DEFAULT_BANDS.bass[1] === 160, 'bands are bass 40-160 Hz, mid, treble');
  // -Infinity bins (exact silence) must not produce NaN
  const s = meter.measure(an.frame(new Float32Array(4096), 4096), {});
  check(Object.values(s).every((v) => Number.isFinite(v)), 'silence gives finite band energies');
}

// ---------- automatic gain ----------

console.log('\nAutomatic gain');
{
  const g = createAutoGain();
  const rnd = mulberry32(4);
  const dt = 1 / 60;
  let before = 0, nb = 0, recovered = null;
  const win = []; // one-second running mean of the output
  for (let f = 0; f < 60 * 25; f++) {
    const t = f * dt;
    const amp = t < 10 ? 0.5 : 0.05;          // a 20 dB drop at t = 10 s
    const x = amp * (0.6 + 0.4 * rnd());
    const y = g.push(x, dt);
    win.push(y); if (win.length > 60) win.shift();
    const m = win.reduce((a, b) => a + b, 0) / win.length;
    if (t > 5 && t < 10) { before += y; nb++; }
    if (t > 10.5 && recovered == null && m >= 0.85 * (before / nb)) recovered = t - 10;
  }
  check(recovered != null && recovered <= 5.5, `normalised level back to 85% of its pre-drop mean ${recovered == null ? 'never' : recovered.toFixed(2) + ' s'} after a 20 dB drop`);
  const h = createAutoGain();
  check(h.push(0, dt) === 0 && h.push(NaN, dt) === 0, 'silence and NaN normalise to 0');
}

// ---------- browser ----------

let pw = null;
if (!args.includes('--node')) {
  try { pw = createRequire(import.meta.url)('playwright'); } catch { /* not installed locally */ }
  if (!pw) {
    // A global install is not visible to ESM resolution; ask npm where global modules live.
    try {
      const { execSync } = await import('node:child_process');
      const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
      pw = createRequire(path.join(root, 'noop.js'))('playwright');
    } catch { /* still not found */ }
  }
  if (!pw) {
    try { pw = createRequire(path.join(process.env.NODE_PATH || '/nonexistent', 'noop.js'))('playwright'); } catch { /* no luck */ }
  }
}
if (pw) await browserChecks(pw);
else console.log(`\nBrowser checks SKIPPED (${args.includes('--node') ? '--node' : 'Playwright not importable'})`);

async function browserChecks({ chromium }) {
  console.log('\nBrowser (headless Chromium)');
  const winDir = path.join(here, '..', 'src', 'window');
  const page = `<!doctype html><meta charset=utf-8><meta name="referrer" content="no-referrer"><title>audio check</title><body>
<script type=module>
import { createAudioTap } from '/window/audio.js';
window.createAudioTap = createAudioTap;
window.ready = true;
</script>`;
  const types = { '.js': 'text/javascript', '.html': 'text/html' };
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x');
    if (u.pathname === '/') { s.setHeader('content-type', 'text/html'); return s.end(page); }
    if (u.pathname.startsWith('/window/')) {
      const f = path.join(winDir, path.basename(u.pathname));
      if (fs.existsSync(f)) { s.setHeader('content-type', types[path.extname(f)] || 'application/octet-stream'); return s.end(fs.readFileSync(f)); }
    }
    s.statusCode = 404; s.end();
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required'],
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined,
  });
  const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36' });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await p.goto(`http://127.0.0.1:${port}/`);
    await p.waitForFunction(() => window.ready, null, { timeout: 20000 });

    // 1. A 120 BPM click track from an AudioBufferSourceNode through attachNode.
    const r1 = await p.evaluate(async () => {
      const ac = new AudioContext(); await ac.resume();
      const sr = ac.sampleRate, secs = 12, buf = ac.createBuffer(1, sr * secs, sr), d = buf.getChannelData(0);
      let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      for (let t = 0.1; t < secs; t += 0.5) { const i0 = Math.round(t * sr); for (let i = 0; i < 0.006 * sr; i++) d[i0 + i] += 0.6 * (rnd() * 2 - 1) * Math.exp(-i / (0.0015 * sr)); }
      const src = ac.createBufferSource(); src.buffer = buf; src.loop = true;
      const tap = window.createAudioTap();
      tap.attachNode(ac, src);
      src.start();
      const t0 = performance.now(); let last = t0, f, onsets = 0, frames = 0, lock = null, maxUpdateMs = 0, sumUpdateMs = 0;
      await new Promise((done) => {
        const loop = (now) => {
          const a = performance.now();
          f = tap.update((now - last) / 1000); last = now;
          const b = performance.now(); sumUpdateMs += b - a; maxUpdateMs = Math.max(maxUpdateMs, b - a);
          frames++; if (f.onset) onsets++;
          if (lock == null && Math.abs(f.bpm - 120) < 2.4) lock = (now - t0) / 1000;
          if (now - t0 > 10000) return done();
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      const res = { ...f, onsets, frames, lock, avgUpdateMs: sumUpdateMs / frames, maxUpdateMs, sampleRate: sr };
      src.stop(); tap.dispose(); await ac.close();
      return res;
    });
    console.log('   click 120:', JSON.stringify(r1, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
    check(Math.abs(r1.bpm / 120 - 1) <= 0.02, `browser click track: bpm ${r1.bpm.toFixed(2)} (lock ${r1.lock == null ? 'never' : r1.lock.toFixed(2) + ' s'}, conf ${r1.confidence.toFixed(2)})`);
    check(r1.active === true, 'browser click track: active');
    check(r1.onsets >= 15 && r1.onsets <= 23, `browser click track: ${r1.onsets} onsets in 10 s (20 clicks)`);
    check(r1.frames > 100, `browser rAF loop ran ${r1.frames} frames, update ${r1.avgUpdateMs.toFixed(3)} ms avg`);

    // 2. Silence: a constant-zero source must read as inactive and never throw.
    const r2 = await p.evaluate(async () => {
      const ac = new AudioContext(); await ac.resume();
      const src = ac.createConstantSource(); src.offset.value = 0; src.start();
      const tap = window.createAudioTap();
      tap.attachNode(ac, src);
      const t0 = performance.now(); let last = t0, f, everActive = false;
      await new Promise((done) => {
        const loop = (now) => { f = tap.update((now - last) / 1000); last = now; if (f.active) everActive = true; if (now - t0 > 3000) return done(); requestAnimationFrame(loop); };
        requestAnimationFrame(loop);
      });
      const res = { ...f, everActive };
      tap.dispose(); await ac.close();
      return res;
    });
    check(r2.active === false && !r2.everActive && r2.bpm === 0, `browser silence: active ${r2.active}, bpm ${r2.bpm}`);

    // 3. attachElement with a same-origin <audio> playing a generated WAV: the element's volume
    //    and muted flag must not collapse the features, and a second attach must be safe.
    const r3 = await p.evaluate(async () => {
      const sr = 44100, secs = 30, n = sr * secs;
      const pcm = new Int16Array(n);
      for (let t = 0.1; t < secs; t += 0.5) {   // 120 BPM kicks over a quiet tone
        const i0 = Math.round(t * sr);
        for (let i = 0; i < 1.0 * sr && i0 + i < n; i++) pcm[i0 + i] += 20000 * Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-i / sr / 0.03)) * i / sr) * Math.exp(-i / sr / 0.15);
      }
      for (let i = 0; i < n; i++) pcm[i] += 1500 * Math.sin(2 * Math.PI * 440 * i / sr);
      const head = new DataView(new ArrayBuffer(44));
      const str = (o, s) => { for (let i = 0; i < 4; i++) head.setUint8(o + i, s.charCodeAt(i)); };
      str(0, 'RIFF'); head.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); head.setUint32(16, 16, true);
      head.setUint16(20, 1, true); head.setUint16(22, 1, true); head.setUint32(24, sr, true); head.setUint32(28, sr * 2, true);
      head.setUint16(32, 2, true); head.setUint16(34, 16, true); str(36, 'data'); head.setUint32(40, n * 2, true);
      const el = new Audio(URL.createObjectURL(new Blob([head, pcm], { type: 'audio/wav' })));
      document.body.appendChild(el);
      const tap = window.createAudioTap();
      const first = tap.attachElement(el);
      const second = tap.attachElement(el);
      const other = window.createAudioTap();
      const third = other.attachElement(el);   // a second tap on the same element reuses its source
      other.dispose();
      await tap.resume();
      await el.play();
      let last = performance.now();
      const run = (ms, ramp = null) => new Promise((done) => {
        const t0 = performance.now(); let lv = 0, k = 0, rms = 0, act = true, f, onsets = 0, minLevel = 1;
        const loop = (now) => {
          if (ramp) el.volume = Math.max(0, Math.min(1, ramp(Math.min(1, (now - t0) / ms))));   // volume > 1 throws
          f = tap.update((now - last) / 1000); last = now;
          if (f.onset) onsets++;
          if (ramp || now - t0 > ms * 0.4) minLevel = Math.min(minLevel, f.level);
          // the first phase includes the start of playback, before any signal has arrived
          if (now - t0 > ms * 0.4) { lv += f.level; rms += tap.stats().rms; k++; act = act && f.active; }
          if (now - t0 > ms) return done({ level: lv / k, rms: rms / k, allActive: act, finalActive: f.active, bpm: f.bpm, onsets, minLevel });
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      const a = await run(6000);
      // the way the distraction mechanic moves it: a smooth fade 1 -> 0.2 -> 1 over 4 s
      const ramp = await run(4000, (x) => 1 - 0.8 * (1 - Math.abs(2 * x - 1)));
      el.volume = 0.25; const b = await run(5000);
      el.muted = true; const c = await run(3500);   // longer than silenceSeconds
      el.muted = false; el.volume = 1; const d = await run(2000);
      el.pause(); const e = await run(3000);
      tap.dispose();
      return { first, second, third, a, ramp, b, c, d, e };
    });
    console.log('   element:', JSON.stringify(r3, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v));
    check(r3.first && r3.second && r3.third, 'attachElement twice, and from a second tap, all succeed');
    check(r3.a.allActive && r3.b.allActive, 'element: active at volume 1 and 0.25');
    check(Math.abs(r3.b.rms / r3.a.rms - 1) < 0.15, `element: compensated rms at volume 0.25 is ${(r3.b.rms / r3.a.rms).toFixed(3)}x that at volume 1`);
    check(r3.b.level > 0.6 * r3.a.level, `element: level ${r3.a.level.toFixed(2)} at volume 1, ${r3.b.level.toFixed(2)} at 0.25`);
    check(r3.ramp.onsets >= 7 && r3.ramp.onsets <= 10 && r3.ramp.allActive && Math.abs(r3.ramp.bpm / 120 - 1) < 0.02 && r3.ramp.minLevel > 0.75 * r3.a.minLevel,
      `element: volume fade 1 -> 0.2 -> 1 over 4 s: ${r3.ramp.onsets} onsets (8 kicks), lowest level ${r3.ramp.minLevel.toFixed(2)} (${r3.a.minLevel.toFixed(2)} at steady volume 1), bpm ${r3.ramp.bpm.toFixed(1)}`);
    check(r3.a.onsets >= 9 && r3.a.onsets <= 13 && r3.b.onsets >= 8 && r3.b.onsets <= 11, `element: onsets ${r3.a.onsets} in the first 6 s at volume 1 (12 kicks), ${r3.b.onsets} in 5 s at 0.25 (10 kicks)`);
    check(r3.c.allActive, 'element: muted for 3.5 s holds active');
    check(r3.d.allActive, 'element: still active after unmuting');
    check(r3.e.finalActive === false, 'element: paused for 3 s reads inactive');
    check(r3.a.bpm > 0 && Math.abs(r3.d.bpm / 120 - 1) < 0.02, `element: bpm ${r3.a.bpm.toFixed(1)} -> ${r3.d.bpm.toFixed(1)} after the volume and mute changes`);

    // 4. Optional: a real SomaFM stream through attachElement, at volume 1 and 0.25.
    if (args.includes('--live')) {
      const r4 = await p.evaluate(async () => {
        const el = new Audio(); el.crossOrigin = 'anonymous'; el.src = 'https://ice6.somafm.com/groovesalad-128-aac';
        document.body.appendChild(el);
        const tap = window.createAudioTap();
        tap.attachElement(el); await tap.resume();
        try { await el.play(); } catch (e) { return { error: String(e) }; }
        // Music is not stationary, so alternate the volume every 1.5 s for 18 s and pool each
        // setting (skipping 0.3 s after every step), instead of comparing two long stretches.
        let last = performance.now();
        const acc = { 1: { rms: 0, raw: 0, k: 0 }, 0.25: { rms: 0, raw: 0, k: 0 } };
        let act = true, f;
        await new Promise((r) => setTimeout(r, 2500));   // let the stream start
        await new Promise((done) => {
          const t0 = performance.now();
          const loop = (now) => {
            const s = (now - t0) / 1000, phase = Math.floor(s / 1.5), v = phase % 2 ? 0.25 : 1;
            el.volume = v;
            f = tap.update((now - last) / 1000); last = now;
            if (s - phase * 1.5 > 0.3) { const a = acc[v]; a.rms += tap.stats().rms; a.raw += tap.stats().rawRms; a.k++; act = act && f.active; }
            if (s > 18) return done();
            requestAnimationFrame(loop);
          };
          requestAnimationFrame(loop);
        });
        el.volume = 1;
        await new Promise((done) => { const t0 = performance.now(); const loop = (now) => { f = tap.update((now - last) / 1000); last = now; if (now - t0 > 12000) return done(); requestAnimationFrame(loop); }; requestAnimationFrame(loop); });
        el.pause(); tap.dispose();
        const m = (a) => ({ rms: a.rms / a.k, rawRms: a.raw / a.k });
        return { a: m(acc[1]), b: m(acc[0.25]), active: act, after30s: { ...f } };
      });
      console.log('   SomaFM:', JSON.stringify(r4, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v));
      if (r4.error) check(false, `SomaFM live: ${r4.error}`);
      else {
        check(r4.active, 'SomaFM live: active throughout the volume changes');
        check(Math.abs(r4.b.rawRms / r4.a.rawRms - 0.25) < 0.08, `SomaFM live: raw analyser rms ratio at volume 0.25 = ${(r4.b.rawRms / r4.a.rawRms).toFixed(3)}`);
        check(Math.abs(r4.b.rms / r4.a.rms - 1) < 0.35, `SomaFM live: compensated rms ratio = ${(r4.b.rms / r4.a.rms).toFixed(3)}`);
      }
    }
    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ').slice(0, 400) : ''}`);
  } finally {
    await browser.close(); srv.close();
  }
}

// ---------- summary ----------

console.log('\nResults');
console.table(table);
console.log(`${checks - failures.length}/${checks} checks passed`);
if (failures.length) { console.log('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
