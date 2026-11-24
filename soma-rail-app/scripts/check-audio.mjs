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
  createMusicFeatures, createLift, createDynamics, createBeatClock,
} from '../src/window/audioAnalysis.js';
import { createDirector } from '../src/window/director.js';

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

// ---------- music signals: band onsets, mid lift, weather, events, beat clock ----------
// These run the tap's own per-frame code (createMusicFeatures, shared with audio.js) on
// synthesised music, and then the director on what it reports.

// A small sequencer for "songs": parts switched on and off by time, on a beat grid whose tempo
// may change. Returns the buffer and the true times of each kind of hit.
function song(sr, secs, { bpm = 120, bpmAt = null, parts, seed = 21, gain = 1 }) {
  const buf = new Float32Array(Math.round(sr * secs)), rnd = mulberry32(seed);
  const hits = { kick: [], hat: [], snare: [], beat: [], lead: [] };
  const on = (name, t) => { const p = parts[name]; return typeof p === 'function' ? p(t) : (p || 0); };
  let beat = 0;
  for (let t = 0.5; t < secs - 0.05; beat++) {
    const T = 60 / (bpmAt ? bpmAt(t) : bpm), inBar = beat % 4;
    hits.beat.push(t);
    let a;
    if ((a = on('kick', t))) { addKick(buf, sr, t, 0.8 * a * gain); hits.kick.push(t); }
    if ((a = on('hat', t))) { addHat(buf, sr, t + T / 2, 0.25 * a * gain, rnd); hits.hat.push(t + T / 2); }
    if ((a = on('snare', t)) && (inBar === 1 || inBar === 3)) { addSnare(buf, sr, t, 0.35 * a * gain, rnd); hits.snare.push(t); }
    if ((a = on('bass', t))) {   // a bass note on every beat: 55 or 73 Hz with a second harmonic
      const hz = [55, 55, 73.4, 65.4][Math.floor(beat / 4) % 4], i0 = Math.round(t * sr), len = Math.round(T * sr);
      for (let i = 0; i < len && i0 + i < buf.length; i++) {
        const s = i / sr, env = Math.min(1, s / 0.01) * Math.exp(-s / (T * 0.6));
        buf[i0 + i] += 0.25 * a * gain * env * (Math.sin(2 * Math.PI * hz * s) + 0.4 * Math.sin(4 * Math.PI * hz * s));
      }
    }
    if ((a = on('lead', t))) {   // a legato lead, one note a beat, 2 harmonics, soft attack
      const hz = [523, 587, 659, 784, 659, 587, 523, 440][beat % 8], i0 = Math.round(t * sr), len = Math.round(T * sr);
      for (let i = 0; i < len && i0 + i < buf.length; i++) {
        const s = i / sr, env = Math.min(1, s / 0.03) * Math.min(1, (len - i) / (0.02 * sr));
        buf[i0 + i] += 0.12 * a * gain * env * (Math.sin(2 * Math.PI * hz * s) + 0.3 * Math.sin(4 * Math.PI * hz * s));
      }
      hits.lead.push(t);
    }
    if ((a = on('pluck', t))) {   // a plucked note a beat (5 ms attack, 0.3 s decay), mid register
      const hz = [392, 440, 494, 587][beat % 4], i0 = Math.round(t * sr);
      for (let i = 0; i < 1.2 * sr && i0 + i < buf.length; i++) {
        const s = i / sr, env = Math.min(1, s / 0.005) * Math.exp(-s / 0.3);
        buf[i0 + i] += 0.2 * a * gain * env * (Math.sin(2 * Math.PI * hz * s) + 0.5 * Math.sin(4 * Math.PI * hz * s) + 0.25 * Math.sin(6 * Math.PI * hz * s));
      }
      hits.lead.push(t);
    }
    t += T;
  }
  // a pad underneath, cross-fading chords
  const chords = [[220, 277.2, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6]];
  for (let i = 0; i < buf.length; i++) {
    const t = i / sr, a = on('pad', t);
    if (!a) continue;
    const c = t / 4, ci = Math.floor(c) % 3, f = c - Math.floor(c), x = Math.min(1, f / 0.4);
    let s = 0;
    for (let k = 0; k < 3; k++) s += x * Math.sin(2 * Math.PI * chords[ci][k] * t) + (1 - x) * Math.sin(2 * Math.PI * chords[(ci + 2) % 3][k] * t);
    buf[i] += 0.03 * a * gain * s;
  }
  return { buf, hits };
}

// The tap's per-frame features (createMusicFeatures, as audio.js runs it) over a buffer.
function features(buf, sr, fps, onFrame, { fftSize = 2048 } = {}) {
  const an = makeAnalyser(fftSize);
  const fx = createMusicFeatures({ sampleRate: sr, fftSize });
  const f = fx.out;
  f.active = true;
  const dur = buf.length / sr, dt = 1 / fps;
  let cost = 0, frames = 0;
  for (let i = 1; i / fps <= dur; i++) {
    const t = i / fps, end = Math.round(t * sr);
    const spec = an.frame(buf, end);
    let ss = 0;
    for (let j = end - fftSize; j < end; j++) { const v = j >= 0 ? buf[j] : 0; ss += v * v; }
    const t0 = performance.now();
    fx.measure(spec, Math.sqrt(ss / fftSize), dt, t);
    cost += performance.now() - t0; frames++;
    onFrame(t, f, dt);
  }
  return cost / frames;
}

const DIRECTOR_PARAMS = { seed: 'check', kmh: 100, hour: 12, level: 0, biome: '', slot: '', beat: 1, sparkle: 1, events: 1 };
const near = (times, t, tol) => times.some((x) => Math.abs(x - t) <= tol);
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
// Onset timing tolerance: 40 ms, or 50 ms at 30 fps, where frames alone are 33 ms apart.
const tolFor = (fps) => (fps <= 30 ? 0.05 : 0.04);

console.log('\nBand onsets');
let worstFxCost = 0;
for (const { sr, fps } of CONFIGS) {
  // four-on-the-floor kick, hats only on the off-beat
  const { buf, hits } = song(sr, 16, { bpm: 124, parts: { kick: 1, hat: 1 } });
  const low = [], high = [], full = [];
  worstFxCost = Math.max(worstFxCost, features(buf, sr, fps, (t, f) => { if (f.onsetLow) low.push(t); if (f.onsetHigh) high.push(t); if (f.onset) full.push(t); }));
  const tol = tolFor(fps), lk = onsetScore(low, hits.kick, tol), hh = onsetScore(high, hits.hat, tol);
  const lowOnHats = low.filter((t) => near(hits.hat, t, tol)).length, highOnKicks = high.filter((t) => near(hits.kick, t, tol)).length;
  check(lk.hit >= 0.95 * hits.kick.length && lowOnHats <= 0.05 * hits.hat.length && lk.fp - lowOnHats <= 1,
    `kick + off-beat hats @ ${sr}/${fps}: low onsets ${lk.hit}/${hits.kick.length} kicks, ${lowOnHats} on hats, ${lk.fp - lowOnHats} elsewhere, worst ${(lk.worst * 1000).toFixed(1)} ms`);
  check(hh.hit >= 0.95 * hits.hat.length && highOnKicks <= 0.05 * hits.kick.length && hh.fp - highOnKicks <= 1,
    `kick + off-beat hats @ ${sr}/${fps}: high onsets ${hh.hit}/${hits.hat.length} hats, ${highOnKicks} on kicks, ${hh.fp - highOnKicks} elsewhere, worst ${(hh.worst * 1000).toFixed(1)} ms`);
}
for (const { sr, fps } of CONFIGS) {
  // with a snare on 2 and 4 (noise plus a 190 Hz body): the snare belongs to the high band
  const { buf, hits } = song(sr, 16, { bpm: 110, parts: { kick: 1, hat: 1, snare: 1 } });
  const low = [], high = [];
  features(buf, sr, fps, (t, f) => { if (f.onsetLow) low.push(t); if (f.onsetHigh) high.push(t); });
  const tol = tolFor(fps), snHigh = hits.snare.filter((t) => near(high, t, tol)).length;
  const lowOff = low.filter((t) => !near(hits.kick, t, tol)).length;
  const lk = onsetScore(low, hits.kick, tol);
  check(snHigh >= 0.95 * hits.snare.length && lk.hit >= 0.95 * hits.kick.length && lowOff <= 1,
    `kick + snare + hats @ ${sr}/${fps}: high onsets on ${snHigh}/${hits.snare.length} snares; low onsets ${lk.hit}/${hits.kick.length} kicks, ${lowOff} off the kicks`);
}
{
  // a pad with no percussion: no band onsets at all
  const sr = 48000;
  for (const fps of [60, 30]) {
    let low = 0, high = 0, full = 0;
    features(sinePad(sr, 14).buf, sr, fps, (t, f) => { low += f.onsetLow; high += f.onsetHigh; full += f.onset; });
    check(low === 0 && high === 0, `slow sine pad @ ${fps} fps: ${low} low, ${high} high band onsets in 14 s (full band ${full})`);
  }
  // a plucked melody over the pad (no drums): full-band onsets with no band onsets; through the
  // director, big things still follow the full-band pulse at 0.45 of it
  const { buf, hits } = song(sr, 14, { bpm: 90, parts: { pad: 1, pluck: 1 } });
  const dir = createDirector({ params: DIRECTOR_PARAMS });
  let low = 0, high = 0, full = 0, ratioOk = 0, frames = 0, maxBig = 0;
  features(buf, sr, 60, (t, f, dt) => {
    low += f.onsetLow; high += f.onsetHigh; full += f.onset;
    dir.setAudio(f); dir.update(dt);
    const S = dir.state;
    if (S.beat > 0.05) { frames++; if (Math.abs(S.beatBig - 0.45 * S.beat) < 1e-9 && Math.abs(S.beatSmall - 0.45 * S.beat) < 1e-9) ratioOk++; }
    maxBig = Math.max(maxBig, S.beatBig);
  });
  check(full >= 0.6 * hits.lead.length && low + high <= 2 && ratioOk === frames && maxBig > 0.2,
    `melody over a pad, no drums: ${full} full-band onsets for ${hits.lead.length} notes, ${low} low and ${high} high; beatBig = 0.45 x beat on ${ratioOk}/${frames} pulsing frames (peak ${maxBig.toFixed(2)})`);
}
{
  // through the director: kicks move big things, hats small ones
  const sr = 48000, { buf, hits } = song(sr, 16, { bpm: 124, parts: { kick: 1, hat: 1 } });
  const dir = createDirector({ params: DIRECTOR_PARAMS });
  const atKick = [], atHatBig = [], atHatSmall = [], atKickSmall = [];
  const frames = [];
  features(buf, sr, 60, (t, f, dt) => { dir.setAudio(f); dir.update(dt); frames.push([t, dir.state.beatBig, dir.state.beatSmall]); });
  const peak = (t0, i) => Math.max(...frames.filter(([t]) => t >= t0 && t < t0 + 0.08).map((r) => r[i]));
  for (const k of hits.kick.slice(2)) { atKick.push(peak(k, 1)); atKickSmall.push(peak(k, 2)); }
  for (const h of hits.hat.slice(2)) { atHatBig.push(peak(h, 1)); atHatSmall.push(peak(h, 2)); }
  check(mean(atKick) > 0.7 && mean(atHatSmall) > 0.7 && mean(atHatBig) < 0.45 && mean(atKickSmall) < 0.45,
    `director: beatBig peaks ${mean(atKick).toFixed(2)} on kicks, ${mean(atHatBig).toFixed(2)} on hats; beatSmall ${mean(atHatSmall).toFixed(2)} on hats, ${mean(atKickSmall).toFixed(2)} on kicks`);
}
check(worstFxCost < 1, `average per-frame cost of the whole feature step ${worstFxCost.toFixed(3)} ms (< 1 ms)`);

console.log('\nMid band lift');
for (const { sr, fps } of [{ sr: 48000, fps: 60 }, { sr: 44100, fps: 30 }]) {
  // a steady backing (kick, hats, snare, bass, pad); a lead enters at 12 s and stops at 20 s
  const { buf } = song(sr, 30, { bpm: 120, parts: { kick: 1, hat: 1, snare: 1, bass: 1, pad: 1, lead: (t) => (t >= 12 && t < 20 ? 1 : 0) } });
  const dir = createDirector({ params: DIRECTOR_PARAMS });
  const rows = [];
  features(buf, sr, fps, (t, f, dt) => { dir.setAudio(f); dir.update(dt); rows.push([t, dir.state.mid]); });
  const over = (a, b) => rows.filter(([t]) => t >= a && t < b).map((r) => r[1]);
  const before = Math.max(...over(4, 11.9)), rise = rows.find(([t, m]) => t >= 12 && m > 0.3), peak = Math.max(...over(12, 14));
  const held = mean(over(14, 20)), after = Math.max(...over(21.5, 30));
  const fallT = rows.find(([t, m]) => t >= 20 && m < 0.1);
  let maxStep = 0;
  for (let i = 1; i < rows.length; i++) maxStep = Math.max(maxStep, Math.abs(rows[i][1] - rows[i - 1][1]) / (rows[i][0] - rows[i - 1][0]));
  check(before < 0.2 && rise && rise[0] - 12 < 0.5 && peak > 0.5 && after < 0.1 && fallT && fallT[0] - 20 < 1.5 && maxStep < 8,
    `lead entering @ ${sr}/${fps}: mid ${before.toFixed(2)} at most before, ${rise ? ((rise[0] - 12) * 1000).toFixed(0) : 'never'} ms to 0.3, peak ${peak.toFixed(2)}, ${held.toFixed(2)} mean while held, under 0.1 ${fallT ? (fallT[0] - 20).toFixed(2) + ' s' : 'never'} after it stops, ${after.toFixed(2)} at most after; fastest change ${maxStep.toFixed(1)}/s`);
}

console.log('\nWeather and events');
// A dance track: 6 s intro (pad), full from 6 s, a 16 s breakdown (pad only) from 50 s, the drop at
// 66 s, full to 110 s.
const FULL = (t) => (t >= 6 && (t < 50 || t >= 66) ? 1 : 0);
function danceTrack(sr, secs = 110, gain = 1, seed = 21) {
  return song(sr, secs, { bpm: 126, gain, seed, parts: { kick: FULL, hat: FULL, snare: FULL, bass: FULL, pad: 1, lead: (t) => (t >= 30 && t < 50) || t >= 82 ? 1 : 0 } });
}
{
  const sr = 44100, fps = 30, { buf } = danceTrack(sr);
  const dyn = createDynamics(), events = [], weather = [];
  features(buf, sr, fps, (t, f, dt) => {
    const r = dyn.push(f.loudDb, f.bassDb, f.onset, dt);
    if (r.event) events.push({ t: +t.toFixed(2), kind: r.event, strength: +r.strength.toFixed(2) });
    weather.push([t, r.weather]);
  });
  const w = (a, b) => weather.filter(([t]) => t >= a && t < b).map((r) => r[1]);
  const bd = events.filter((e) => e.kind === 'breakdown'), dr = events.filter((e) => e.kind === 'drop');
  console.log('   events', JSON.stringify(events));
  check(events.length === 2 && bd.length === 1 && dr.length === 1 && bd[0].t > 50 && bd[0].t < 57.5 && dr[0].t >= 66 && dr[0].t < 66.6,
    `dance track (detector): ${bd.length} breakdown at ${bd.map((e) => e.t).join()} s (begins 50 s; confirmed once the quiet holds), ${dr.length} drop at ${dr.map((e) => e.t).join()} s (66 s), ${events.length} events in all`);
  const full = Math.min(...w(20, 50)), deep = Math.min(...w(50, 66)), at58 = w(58, 58.1)[0], back = w(80, 81)[0], back2 = w(92, 93)[0];
  check(full > 0.95 && deep < 0.5 && at58 < 0.8 && back > 0.8 && back2 > 0.97,
    `dance track weather: ${full.toFixed(2)} at least in the full part, ${at58.toFixed(2)} 8 s into the breakdown, ${deep.toFixed(2)} at its lowest, ${back.toFixed(2)} 14 s and ${back2.toFixed(2)} 26 s after the drop`);
}
{
  // through the director, with every guard: the start of the stream, the 45 s gap between events of a kind
  const sr = 44100, fps = 30, { buf } = danceTrack(sr);
  const dir = createDirector({ params: DIRECTOR_PARAMS }), events = [];
  let last = 0;
  features(buf, sr, fps, (t, f, dt) => { dir.setAudio(f); dir.update(dt); const e = dir.state.event; if (e && e.seq !== last) { last = e.seq; events.push({ t: +t.toFixed(2), kind: e.kind }); } });
  check(events.length === 2 && events[0].kind === 'breakdown' && events[1].kind === 'drop' && events[1].t - events[0].t > 8,
    `dance track (director): ${JSON.stringify(events)} (a drop may follow the breakdown that set it up; the 45 s gap is between events of a kind)`);
  const dir2 = createDirector({ params: { ...DIRECTOR_PARAMS, events: 0 } });
  let any = false;
  features(buf, sr, fps, (t, f, dt) => { dir2.setAudio(f); dir2.update(dt); if (dir2.state.event) any = true; });
  check(!any, 'dance track with events=0: no events');
}
{
  // steady music for five minutes (the lead comes and goes, as do the hats): no events, full weather
  const sr = 44100, fps = 30, secs = 300;
  const { buf } = song(sr, secs, { bpm: 122, seed: 5, parts: { kick: 1, snare: 1, bass: 1, pad: 1, hat: (t) => (Math.floor(t / 16) % 3 ? 1 : 0), lead: (t) => (Math.floor(t / 24) % 2 ? 1 : 0) } });
  const dyn = createDynamics(), dir = createDirector({ params: DIRECTOR_PARAMS });
  let ev = 0, minW = 1, dirEv = 0, minDirW = 1;
  features(buf, sr, fps, (t, f, dt) => {
    const r = dyn.push(f.loudDb, f.bassDb, f.onset, dt);
    if (r.event) ev++;
    if (t > 10) minW = Math.min(minW, r.weather);
    dir.setAudio(f); dir.update(dt);
    if (dir.state.event) dirEv++;
    minDirW = Math.min(minDirW, dir.state.weather);
  });
  check(ev === 0 && dirEv === 0 && minW > 0.85 && minDirW > 0.85, `five minutes of steady music: ${ev} detector events, ${dirEv} director events, weather never under ${Math.min(minW, minDirW).toFixed(2)}`);
}
{
  // a change of track: a loud track ends, a second of silence, a quieter one starts 9 dB down
  // with its own 6 s intro (pad only, then everything: a drop, were it not for the guard); the
  // metadata arrives 1.5 s before the new audio
  const sr = 44100, fps = 30;
  const steady = (secs, gain, seed) => song(sr, secs, { bpm: 124, gain, seed, parts: { kick: 1, hat: 1, snare: 1, bass: 1, pad: 1, lead: (t) => (t >= 20 ? 1 : 0) } }).buf;
  const intro = (t) => (t >= 6 ? 1 : 0);
  const a = steady(58, 1, 7), b = song(sr, 60, { bpm: 100, gain: 0.35, seed: 8, parts: { kick: intro, hat: intro, snare: intro, bass: intro, pad: 1 } }).buf;
  const buf = new Float32Array(a.length + sr + b.length);
  buf.set(a, 0); buf.set(b, a.length + sr);
  const dir = createDirector({ params: DIRECTOR_PARAMS }), dyn = createDynamics();
  let dirEv = 0, seq = 0, sent = false, minW = 1, maxJump = 0, prevW = 1;
  const rawEv = [];
  features(buf, sr, fps, (t, f, dt) => {
    if (!sent && t >= 57.5) { dir.onTrack({ artist: 'b', title: 'b' }); sent = true; }
    const r = dyn.push(f.loudDb, f.bassDb, f.onset, dt); if (r.event) rawEv.push(`${r.event}@${t.toFixed(1)}`);
    dir.setAudio(f); dir.update(dt);
    const e = dir.state.event; if (e && e.seq !== seq) { seq = e.seq; dirEv++; }
    if (t > 50) { minW = Math.min(minW, dir.state.weather); maxJump = Math.max(maxJump, Math.abs(dir.state.weather - prevW)); }
    prevW = dir.state.weather;
  });
  check(dirEv === 0 && minW > 0.9 && maxJump < 0.02,
    `change of track to one 9 dB quieter: ${dirEv} director events (the detector alone, not told of the track change: ${rawEv.join(' ') || 'none'}), weather never under ${minW.toFixed(2)} around it, largest step ${maxJump.toFixed(3)} per frame`);
  // the start of a stream: the first seconds of analysis hold weather at exactly 1
  const d3 = createDirector({ params: DIRECTOR_PARAMS });
  let exact = true;
  features(danceTrack(sr, 12).buf, sr, fps, (t, f, dt) => { d3.setAudio(f); d3.update(dt); if (t < 8 && d3.state.weather !== 1) exact = false; });
  check(exact, 'stream start: weather exactly 1 for the first 8 s of analysis');
}
{
  // the end of a track: no fade-out is a breakdown. (1) everything fades over 8 s to silence;
  // (2) the drums and bass stop and the pad then fades over 10 s (an abrupt fall that keeps
  // sliding); (3) a slow 20 s fade. None may raise anything, from the detector or the director.
  const sr = 44100, fps = 30;
  for (const [label, drumsOut, fadeFrom, fadeLen] of [['8 s fade to silence', 1e9, 60, 8], ['drums stop, then a 10 s fade', 60, 61, 10], ['slow 20 s fade', 1e9, 55, 20]]) {
    const on = (t) => (t < drumsOut ? 1 : 0);
    const { buf } = song(sr, 75, { bpm: 124, seed: 13, parts: { kick: on, hat: on, snare: on, bass: on, pad: 1, lead: (t) => (t >= 20 ? 1 : 0) } });
    for (let i = 0; i < buf.length; i++) { const t = i / sr; if (t > fadeFrom) buf[i] *= t > fadeFrom + fadeLen ? 0 : 10 ** (-3 * (t - fadeFrom) / fadeLen); }
    const dyn = createDynamics(), dir = createDirector({ params: DIRECTOR_PARAMS }), raw = [];
    let dirEv = 0, seq = 0;
    features(buf, sr, fps, (t, f, dt) => {
      const r = dyn.push(f.loudDb, f.bassDb, f.onset, dt); if (r.event) raw.push(`${r.event}@${t.toFixed(1)}`);
      dir.setAudio(f); dir.update(dt);
      const e = dir.state.event; if (e && e.seq !== seq) { seq = e.seq; dirEv++; }
    });
    check(raw.length === 0 && dirEv === 0, `end of a track, ${label}: ${raw.join(' ') || 'no'} detector events, ${dirEv} director events`);
  }
}
{
  // music that breathes (a lounge tune): swells of +-5 dB every 10 s, and every 30 s the drums and
  // bass sit out for 4 s, for four minutes. No events at all.
  const sr = 44100, fps = 30, secs = 240;
  const out = (t) => (t % 30 > 26 ? 0 : 1);
  const { buf } = song(sr, secs, { bpm: 96, seed: 17, parts: { kick: out, snare: out, hat: out, bass: out, pad: 1, pluck: (t) => (Math.floor(t / 12) % 2 ? 1 : 0), lead: (t) => (Math.floor(t / 20) % 3 === 1 ? 1 : 0) } });
  for (let i = 0; i < buf.length; i++) buf[i] *= 10 ** ((5 * Math.sin((2 * Math.PI * i) / sr / 10)) / 20);
  const dyn = createDynamics(), dir = createDirector({ params: DIRECTOR_PARAMS }), raw = [];
  let dirEv = 0, seq = 0;
  features(buf, sr, fps, (t, f, dt) => {
    const r = dyn.push(f.loudDb, f.bassDb, f.onset, dt); if (r.event) raw.push(`${r.event}@${t.toFixed(1)}`);
    dir.setAudio(f); dir.update(dt);
    const e = dir.state.event; if (e && e.seq !== seq) { seq = e.seq; dirEv++; }
  });
  check(raw.length === 0 && dirEv === 0, `four minutes of music that breathes (swells, drums out 4 s in every 30): ${raw.join(' ') || 'no'} detector events, ${dirEv} director events`);
}

console.log('\nBeat clock');
{
  // a steady four-on-the-floor track for three minutes, with what real ones have: a kick a
  // sixteenth early every other bar, and the kick out for a bar in every sixteen. Once on, the
  // chase must stay on.
  const sr = 44100, fps = 30, bpm = 124, T = 60 / bpm, secs = 180;
  const kick = (t) => (Math.floor((t - 0.5 + 0.01) / (4 * T)) % 16 === 15 ? 0 : 1);
  const { buf } = song(sr, secs, { bpm, seed: 23, parts: { kick, hat: 1, snare: 1, bass: 1, pad: 1 } });
  for (let bar = 1; 0.5 + bar * 4 * T < secs - 1; bar += 2) addKick(buf, sr, 0.5 + bar * 4 * T - T / 4, 0.6);
  const dir = createDirector({ params: DIRECTOR_PARAMS });
  let flips = 0, was = false, onFrames = 0, frames = 0, firstOn = null;
  features(buf, sr, fps, (t, f, dt) => {
    dir.setAudio(f); dir.update(dt);
    const on = dir.state.chaseOn > 0.5;
    if (on !== was) { flips++; was = on; if (on && firstOn == null) firstOn = t; }
    if (t > 20) { frames++; if (on) onFrames++; }
  });
  check(flips <= 1 && onFrames / frames > 0.97, `steady track with syncopated and missing kicks, 3 min: chase on at ${firstOn?.toFixed(1)} s, ${flips} flips in all, on ${(100 * onFrames / frames).toFixed(0)} % of the time after 20 s`);
}
{
  // 120 BPM for 40 s, then 140 BPM for 40 s (kick, off-beat hats, snare): the clock must relock,
  // whole numbers within 60 ms of the kicks, and chaseOn dip during the change rather than the
  // phase jump.
  const sr = 48000, CHANGE = 40;
  for (const fps of [60, 30]) {
    const { buf, hits } = song(sr, 80, { bpmAt: (t) => (t < CHANGE ? 120 : 140), parts: { kick: 1, hat: 1, snare: 1, bass: 1, pad: 1 } });
    const dir = createDirector({ params: DIRECTOR_PARAMS });
    const rows = [];
    let unwrapped = 0, prevChase = 0;
    features(buf, sr, fps, (t, f, dt) => {
      dir.setAudio(f); dir.update(dt);
      const S = dir.state;
      let d = S.chase - prevChase; if (d < -512) d += 1024; unwrapped += d; prevChase = S.chase;
      rows.push({ t, c: unwrapped, on: S.chaseOn, bpm: f.bpm, conf: f.confidence, step: d, dt });
    });
    const at = (t) => { let i = rows.findIndex((r) => r.t >= t); if (i <= 0) return null; const a = rows[i - 1], b = rows[i]; return a.c + (b.c - a.c) * (t - a.t) / (b.t - a.t); };
    const errMs = (k, bpm) => { const c = at(k); return c == null ? null : (c - Math.round(c)) * 60000 / bpm; };
    const e1 = hits.kick.filter((k) => k > 20 && k < CHANGE).map((k) => errMs(k, 120));
    const e2 = hits.kick.filter((k) => k > 65).map((k) => errMs(k, 140));
    const worst1 = Math.max(...e1.map(Math.abs)), worst2 = Math.max(...e2.map(Math.abs));
    const onFirst = rows.find((r) => r.on > 0.9), onDuring = Math.min(...rows.filter((r) => r.t > CHANGE && r.t < CHANGE + 15).map((r) => r.on));
    const dipAt = rows.filter((r) => r.t > CHANGE && r.t < CHANGE + 15).reduce((a, r) => (r.on < a.on ? r : a)).t;
    const back = rows.find((r) => r.t > dipAt && r.on > 0.9);
    // the clock never steps: while it is on, each frame advances it by its tempo give or take 25 %
    let worstStep = 0;
    for (const r of rows) if (r.on > 0.5 && r.bpm > 0) worstStep = Math.max(worstStep, Math.abs(r.step / (r.dt * r.bpm / 60) - 1));
    const bpmRows = rows.filter((r) => r.t > CHANGE - 1 && r.t < CHANGE + 15 && Math.round(r.t * 4) === r.t * 4 || false);
    console.log(`   ${fps} fps: on ${onFirst ? onFirst.t.toFixed(1) : '-'} s; mean error ${mean(e1).toFixed(1)} ms at 120, ${mean(e2).toFixed(1)} ms at 140; lowest at ${(dipAt - CHANGE).toFixed(1)} s after the change, relocked (on > 0.9) ${back ? (back.t - CHANGE).toFixed(1) + ' s' : 'never'} after it`);
    console.log(`      through the change (t, bpm, conf, on): ${rows.filter((r) => r.t > CHANGE - 1 && r.t < CHANGE + 14 && Math.abs(r.t - Math.round(r.t)) < 0.5 / fps).map((r) => `${r.t.toFixed(0)}:${r.bpm.toFixed(0)}/${r.conf.toFixed(2)}/${r.on.toFixed(2)}`).join(' ')}`);
    void bpmRows;
    check(onFirst && onFirst.t < 15 && worst1 <= 60 && worst2 <= 60 && onDuring < 0.5 && back && worstStep <= 0.3,
      `120 -> 140 BPM @ ${fps} fps: whole numbers within ${worst1.toFixed(1)} ms of the kicks at 120 and ${worst2.toFixed(1)} ms at 140 (after relock); chaseOn fell to ${onDuring.toFixed(2)} in the change; steps never more than ${(worstStep * 100).toFixed(0)} % off the tempo while on`);
  }
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
      const t0 = performance.now(); let last = t0, f, onsets = 0, onsetsHigh = 0, onsetsLow = 0, finite = true, frames = 0, lock = null, maxUpdateMs = 0, sumUpdateMs = 0;
      await new Promise((done) => {
        const loop = (now) => {
          const a = performance.now();
          f = tap.update((now - last) / 1000); last = now;
          const b = performance.now(); sumUpdateMs += b - a; maxUpdateMs = Math.max(maxUpdateMs, b - a);
          frames++; if (f.onset) onsets++; if (f.onsetHigh) onsetsHigh++; if (f.onsetLow) onsetsLow++;
          if (!Number.isFinite(f.loudDb) || !Number.isFinite(f.voiceDb)) finite = false;
          if (lock == null && Math.abs(f.bpm - 120) < 2.4) lock = (now - t0) / 1000;
          if (now - t0 > 10000) return done();
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      });
      const res = { ...f, onsets, onsetsHigh, onsetsLow, finite, frames, lock, avgUpdateMs: sumUpdateMs / frames, maxUpdateMs, sampleRate: sr };
      src.stop(); tap.dispose(); await ac.close();
      return res;
    });
    console.log('   click 120:', JSON.stringify(r1, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v));
    check(Math.abs(r1.bpm / 120 - 1) <= 0.02, `browser click track: bpm ${r1.bpm.toFixed(2)} (lock ${r1.lock == null ? 'never' : r1.lock.toFixed(2) + ' s'}, conf ${r1.confidence.toFixed(2)})`);
    check(r1.active === true, 'browser click track: active');
    check(r1.onsets >= 15 && r1.onsets <= 23, `browser click track: ${r1.onsets} onsets in 10 s (20 clicks)`);
    // (white-noise clicks in silence are broadband, so the low band may answer them too)
    check(r1.onsetsHigh >= 15 && r1.onsetsHigh <= 23 && r1.onsetsLow <= 23 && r1.finite, `browser click track: ${r1.onsetsHigh} high-band onsets (20 clicks), ${r1.onsetsLow} low; loudDb and voiceDb finite throughout`);
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
{
  // The mid lift must not mistake the music starting for a voice entering: from silence (the
  // stream's start, a pause, the gap between tracks) the level rises by tens of dB at once.
  const lift = createLift(), dt = 1 / 60;
  let worst = 0, t = 0;
  for (; t < 1; t += dt) worst = Math.max(worst, lift.push(-120, dt));          // silence
  for (; t < 21; t += dt) worst = Math.max(worst, lift.push(-30, dt));          // the music starts and holds
  for (; t < 22; t += dt) lift.push(-120, dt);                                    // a gap between tracks
  for (; t < 42; t += dt) worst = Math.max(worst, lift.push(-24, dt));          // the next one, louder
  let entry = 0;
  for (; t < 44; t += dt) entry = Math.max(entry, lift.push(-13, dt));          // and then a lead enters, 11 dB up
  check(worst < 0.05 && entry > 0.5, `mid lift from silence: at most ${worst.toFixed(2)} while music starts and holds (twice); a lead entering afterwards still lifts it to ${entry.toFixed(2)}`);
}
console.log(`${checks - failures.length}/${checks} checks passed`);
if (failures.length) { console.log('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
