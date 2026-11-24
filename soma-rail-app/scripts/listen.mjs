// What do the music signals do on a real recording? Decodes an audio file with ffmpeg and runs it
// through the same per-frame analysis and director the app uses, at 60 frames a second, with no
// browser and no drawing:  node scripts/listen.mjs <file> [label]
// Prints a summary and a line per half minute. The detectors are tested on synthetic signals in
// check-audio.mjs; this is for hearing how their thresholds sit on real music (record a few
// minutes of a stream with curl first). Needs ffmpeg on the path.
import { spawnSync } from 'node:child_process';
import { createMusicFeatures } from '../src/window/audioAnalysis.js';
import { createDirector } from '../src/window/director.js';

const [file, label = file] = process.argv.slice(2);
if (!file) { console.error('usage: node scripts/listen.mjs <audio file> [label]'); process.exit(2); }
const SR = 44100, FPS = 60, FFT = 2048;
const dec = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30 });
if (dec.status !== 0 || !dec.stdout.length) { console.error('ffmpeg could not decode', file, String(dec.stderr).slice(0, 300)); process.exit(1); }
const buf = new Float32Array(dec.stdout.buffer, dec.stdout.byteOffset, Math.floor(dec.stdout.length / 4));

// The analyser, as in check-audio.mjs: a Blackman window and an FFT, magnitudes in dBFS.
function makeAnalyser(n) {
  const half = n / 2, win = new Float64Array(n), rev = new Uint32Array(n), bits = Math.log2(n);
  for (let i = 0; i < n; i++) { const x = (2 * Math.PI * i) / n; win[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x); }
  for (let i = 0; i < n; i++) { let r = 0; for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1); rev[i] = r; }
  const re = new Float64Array(n), im = new Float64Array(n), cos = new Float64Array(half), sin = new Float64Array(half), spec = new Float32Array(half);
  for (let i = 0; i < half; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = -Math.sin((2 * Math.PI * i) / n); }
  return (end) => {
    for (let i = 0; i < n; i++) { const j = end - n + i; re[rev[i]] = (j >= 0 && j < buf.length ? buf[j] : 0) * win[i]; im[rev[i]] = 0; }
    for (let size = 2; size <= n; size <<= 1) {
      const h = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) for (let k = 0; k < h; k++) {
        const c = cos[k * step], si = sin[k * step], a = s + k, b = a + h;
        const tr = re[b] * c - im[b] * si, ti = re[b] * si + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
    for (let i = 0; i < half; i++) spec[i] = 20 * Math.log10(Math.hypot(re[i], im[i]) / n);
    return spec;
  };
}

const frame = makeAnalyser(FFT), fx = createMusicFeatures({ sampleRate: SR, fftSize: FFT }), f = fx.out;
f.active = true;
const dir = createDirector({ params: { seed: 'listen', kmh: 100, hour: 12, level: 0, biome: '', slot: '', beat: 1, sparkle: 1, events: 1 } });
const S = dir.state, dt = 1 / FPS, dur = buf.length / SR;
const blank = () => ({ n: 0, beats: 0, bigs: 0, smalls: 0, bigPeakSum: 0, smallPeakSum: 0, beatPeakSum: 0, mid: 0, midHi: 0, weather: 0, wLow: 0, wMin: 1, chase: 0 });
let all = blank(), part = blank(), up = { beat: false, big: false, small: false }, pk = { beat: 0, big: 0, small: 0 }, flips = 0, wasOn = false, lastSeq = 0;
const events = [], rows = [];
const edge = (name, v, acc) => {   // count pulses: a rise through 0.3, and remember each one's peak
  if (!up[name] && v > 0.3) { up[name] = true; pk[name] = v; } else if (up[name]) { pk[name] = Math.max(pk[name], v); if (v < 0.15) { up[name] = false; for (const a of acc) { a[name + 's'] = (a[name + 's'] || 0) + 1; a[name + 'PeakSum'] += pk[name]; } } }
};
for (let i = 1; i / FPS <= dur; i++) {
  const t = i / FPS, end = Math.round(t * SR);
  let ss = 0; for (let j = Math.max(0, end - FFT); j < end; j++) ss += buf[j] * buf[j];
  fx.measure(frame(end), Math.sqrt(ss / FFT), dt, t);
  dir.setAudio(f); dir.update(dt);
  for (const a of [all, part]) { a.n++; a.mid += S.mid; if (S.mid > 0.3) a.midHi++; a.weather += S.weather; if (S.weather < 0.95) a.wLow++; a.wMin = Math.min(a.wMin, S.weather); if (S.chaseOn > 0.5) a.chase++; }
  edge('beat', S.beat, [all, part]); edge('big', S.beatBig, [all, part]); edge('small', S.beatSmall, [all, part]);
  const on = S.chaseOn > 0.5; if (on !== wasOn) { flips++; wasOn = on; }
  if (S.event && S.event.seq !== lastSeq) { lastSeq = S.event.seq; events.push(`${S.event.kind}@${t.toFixed(0)}s`); }
  if (i % (FPS * 30) === 0) { rows.push({ t, ...part, bpm: Math.round(S.bpm) }); part = blank(); }
}
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0), avg = (a, b) => (b ? (a / b).toFixed(2) : '-');
const line = (a) => `pulses/min: full ${Math.round((a.beats || 0) * 60 / (a.n / FPS))} (peak ${avg(a.beatPeakSum, a.beats)}), big ${Math.round((a.bigs || 0) * 60 / (a.n / FPS))} (peak ${avg(a.bigPeakSum, a.bigs)}), small ${Math.round((a.smalls || 0) * 60 / (a.n / FPS))} (peak ${avg(a.smallPeakSum, a.smalls)})   mid mean ${avg(a.mid, a.n)}, over 0.3 for ${pct(a.midHi, a.n)}%   weather mean ${avg(a.weather, a.n)}, min ${a.wMin.toFixed(2)}, under 0.95 for ${pct(a.wLow, a.n)}%   chase on ${pct(a.chase, a.n)}%`;
console.log(`== ${label}: ${dur.toFixed(0)} s`);
for (const r of rows) console.log(`  to ${String(r.t).padStart(3)} s  ${String(r.bpm).padStart(3)} bpm  ${line(r)}`);
console.log(`  WHOLE  ${line(all)}   chase flips ${flips}   events: ${events.join(' ') || 'none'}`);
