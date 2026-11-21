// Pure music-analysis helpers for the train window. No DOM, no Web Audio: everything here takes
// numbers and typed arrays, so it runs in Node for scripts/check-audio.mjs and in the browser
// behind audio.js.
//
// Conventions:
// - A "spectrum" is what AnalyserNode.getFloatFrequencyData gives: fftSize/2 bins of dBFS, with
//   bin i centred on i * sampleRate / fftSize. Silent bins can be -Infinity, so every reader here
//   clamps to DB_FLOOR first. An optional offsetDb is added to every bin before use; audio.js uses
//   it to undo the element's volume without touching the analyser's array.
// - Times are in seconds on whatever clock the caller keeps; only differences matter.
// - Nothing here allocates once it has been set up, so the per-frame path stays garbage-free.

export const DB_FLOOR = -120;

const LN10_20 = Math.LN10 / 20;   // dB -> natural-log amplitude
const LN10_10 = Math.LN10 / 10;   // dB -> natural-log power

/** Smoothing factor for a one-pole low-pass with time constant tau, over a step dt. */
export function smoothing(dt, tau) {
  return tau > 0 ? 1 - Math.exp(-dt / tau) : 1;
}

/** Bin index range [i0, i1) covering lo..hi Hz, always at least one bin wide. */
export function binRange(loHz, hiHz, sampleRate, fftSize) {
  const hz = sampleRate / fftSize;
  const n = fftSize / 2;
  const i0 = Math.max(1, Math.min(n - 1, Math.round(loHz / hz)));
  const i1 = Math.max(i0 + 1, Math.min(n, Math.round(hiHz / hz) + 1));
  return [i0, i1];
}

/** RMS amplitude (linear) of the bins in [i0, i1) of a dB spectrum. */
export function bandEnergy(specDb, i0, i1, offsetDb = 0) {
  let sum = 0;
  for (let i = i0; i < i1; i++) {
    let d = specDb[i];
    if (!(d > DB_FLOOR)) d = DB_FLOOR;     // also catches NaN and -Infinity
    sum += Math.exp((d + offsetDb) * LN10_10);
  }
  return Math.sqrt(sum / (i1 - i0));
}

/** The default bands the tap reports. Bass is the kick and bass line, treble the hats and air. */
export const DEFAULT_BANDS = {
  bass: [40, 160],
  mid: [160, 2500],
  treble: [2500, 12000],
};

/**
 * Prepare band bin ranges once for a sample rate and fftSize, then fill `out` each frame:
 *   const bands = createBandMeter(48000, 2048); bands.measure(spec, out, offsetDb)
 * `out` gets one linear RMS amplitude per band name.
 */
export function createBandMeter(sampleRate, fftSize, bands = DEFAULT_BANDS) {
  const names = Object.keys(bands);
  const ranges = names.map((k) => binRange(bands[k][0], bands[k][1], sampleRate, fftSize));
  return {
    names,
    ranges,
    measure(specDb, out, offsetDb = 0) {
      for (let b = 0; b < names.length; b++) out[names[b]] = bandEnergy(specDb, ranges[b][0], ranges[b][1], offsetDb);
      return out;
    },
  };
}

/**
 * Automatic gain: a running peak that jumps up at once and sinks slowly (decayDbPerSec), used to
 * map a positive signal to 0..1 so quiet and loud channels both use the whole range. At the
 * default 5 dB/s it recovers from a 20 dB drop in about 4 s. `floor` keeps silence at 0 instead
 * of amplifying noise.
 */
export function createAutoGain({ decayDbPerSec = 5, floor = 1e-6, initial = 0 } = {}) {
  const decayPerSec = decayDbPerSec * LN10_20;
  let peak = Math.max(initial, floor);
  return {
    push(x, dt) {
      if (!(x >= 0)) x = 0;
      if (x > peak) peak = x;
      else peak = Math.max(floor, peak * Math.exp(-decayPerSec * dt));
      return x <= floor ? 0 : Math.min(1, x / peak);
    },
    /** Normalise without moving the peak (used while the input is known to be unreliable). */
    peek(x) { return x <= floor ? 0 : Math.min(1, x / peak); },
    get peak() { return peak; },
    reset(p = 0) { peak = Math.max(p, floor); },
  };
}

/**
 * Spectral flux and onset detection.
 *
 * Flux is the half-wave rectified rise of log-compressed magnitude, averaged within each of a few
 * bands and then mixed with weights that favour the low band. Averaging per band first stops the
 * hundreds of hi-hat bins from outvoting the handful of kick bins, which matters for tempo: a
 * flux dominated by off-beat hats invites double-tempo answers.
 *
 * The rise is measured against a reference spectrum that follows the current one with a fixed
 * time constant (refTau), not against the previous frame. The analyser's window taper spreads a
 * click over ~25 ms, so a previous-frame difference would shrink as the frame rate grows; a
 * time-constant reference gives about the same peak at 30, 60 and 120 fps.
 *
 * Onsets: flux above an adaptive threshold (slow mean plus a multiple of the slow mean absolute
 * deviation, plus a small absolute floor), detected on the rising edge, re-armed once flux falls
 * back under the threshold, with a short refractory period.
 */
export function createOnsetDetector({
  sampleRate,
  fftSize,
  bands = [[30, 200, 0.55], [200, 2500, 0.3], [2500, 11000, 0.15]],
  compression = 1000,     // log1p(compression * amplitude): the knee sits near -60 dBFS
  refTau = 0.03,
  meanTau = 0.6,
  k = 4,
  minFlux = 0.03,
  refractory = 0.09,
  warmup = 0.4,          // seconds of statistics before the first onset is reported
} = {}) {
  const n = fftSize / 2;
  const ranges = bands.map(([lo, hi]) => binRange(lo, hi, sampleRate, fftSize));
  const weights = bands.map((b) => b[2]);
  const ref = new Float32Array(n);
  let primed = false;
  let lastT = null;
  let mean = 0, dev = 0, warm = 0;
  let armed = true;
  let lastOnset = -Infinity;
  const result = { flux: 0, onset: false, threshold: 0 };

  // Compressed magnitude of bin i, clamped against -Infinity and NaN.
  function comp(specDb, i, offsetDb) {
    let d = specDb[i];
    if (!(d > DB_FLOOR)) d = DB_FLOOR;
    return Math.log1p(compression * Math.exp((d + offsetDb) * LN10_20));
  }

  function prime(specDb, offsetDb = 0) {
    for (let i = 0; i < n; i++) ref[i] = comp(specDb, i, offsetDb);
    primed = true;
  }

  return {
    result,
    /** Snap the reference to this spectrum without reporting flux (after a volume step). */
    prime(specDb, offsetDb = 0, t = null) { prime(specDb, offsetDb); if (t != null) lastT = t; },
    push(specDb, t, offsetDb = 0) {
      if (!primed) { prime(specDb, offsetDb); lastT = t; result.flux = 0; result.onset = false; return result; }
      const dt = lastT == null ? 1 / 60 : Math.max(0, Math.min(0.25, t - lastT));
      lastT = t;
      const a = smoothing(dt, refTau);
      let flux = 0;
      for (let b = 0; b < ranges.length; b++) {
        const i0 = ranges[b][0], i1 = ranges[b][1];
        let s = 0;
        for (let i = i0; i < i1; i++) {
          const c = comp(specDb, i, offsetDb);
          const d = c - ref[i];
          if (d > 0) s += d;
          ref[i] += d * a;
        }
        flux += weights[b] * s / (i1 - i0);
      }
      // (Bins outside every band are never read, so their reference is left alone.)

      const threshold = mean + k * dev + minFlux;
      let onset = false;
      warm += dt;
      if (warm < warmup) {
        // Learn the background first; reporting onsets against an empty history would fire on
        // every frame of a noisy start.
        const m = smoothing(dt, meanTau * 0.5);
        mean += (flux - mean) * m;
        dev += (Math.abs(flux - mean) - dev) * m;
        result.flux = flux; result.onset = false; result.threshold = threshold;
        return result;
      }
      if (flux > threshold) {
        if (armed && t - lastOnset >= refractory) { onset = true; lastOnset = t; }
        armed = false;
      } else armed = true;

      // Update the slow statistics after the decision. They describe the background between
      // onsets, so frames above the threshold count clipped and ten times more slowly: dense
      // strong onsets cannot ratchet the bar up and hide the next one, while a real rise of the
      // background (noise fading in) is still absorbed within a few seconds.
      const above = flux >= threshold;
      const m = smoothing(dt, above ? meanTau * 10 : meanTau);
      const fc = above ? threshold : flux;
      mean += (fc - mean) * m;
      dev += (Math.abs(fc - mean) - dev) * m;

      result.flux = flux; result.onset = onset; result.threshold = threshold;
      return result;
    },
    reset() { primed = false; lastT = null; mean = 0; dev = 0; warm = 0; armed = true; lastOnset = -Infinity; },
  };
}

/**
 * Tempo from the onset-strength envelope.
 *
 * push(flux, t) resamples the envelope to `rate` Hz (each grid slot holds the largest flux of the
 * frames that ended in it, so 30, 60 and 120 fps all give the same kind of envelope) into a ring
 * of `seconds`. At most every `interval` seconds it:
 *   1. detrends the envelope (subtracts a local mean and half-wave rectifies, so slow swells of an
 *      ambient pad do not look like rhythm), then removes the global mean;
 *   2. takes the unbiased autocorrelation, normalised so lag 0 is 1;
 *   3. scores every beat period L between 60 and 180 BPM by a comb: the weighted sum of the
 *      autocorrelation at L, 2L, 3L, 4L. A true period collects all its multiples, while half the
 *      period only collects every other one, which settles most double-tempo errors; the long
 *      lags also pin the period down far more precisely than lag L alone;
 *   4. multiplies by a mild log-Gaussian prior around 120 BPM to break the remaining tie between
 *      a period and twice that period;
 *   5. refines the best lag by parabolic interpolation;
 *   6. turns the peak's salience (score at the peak minus the average score) into a confidence.
 * Raw estimates then pass through hysteresis: a tempo is reported only after a few agreeing
 * estimates, follows small drifts smoothly, needs a sustained run to jump elsewhere (longer still
 * for an octave jump), and falls back to 0 after a few seconds of low confidence.
 */
export function createTempoEstimator({
  rate = 100,
  seconds = 12,
  minBpm = 60,
  maxBpm = 180,
  priorBpm = 120,
  priorOctaves = 1.0,     // standard deviation of the prior, in octaves
  interval = 0.25,        // seconds between recomputations
  minSeconds = 3,         // envelope needed before a first estimate
  combWeights = [1, 0.5, 0.33, 0.25],
  detrendSeconds = 0.25,  // half-width of the local mean
  lockConfidence = 0.35,
  dropConfidence = 0.25,
  dropSeconds = 3,
  agree = 0.03,           // relative difference that counts as the same tempo
  strengthGate = [0.012, 0.035],   // RMS of the detrended envelope: no confidence below, full above
} = {}) {
  const N = Math.round(rate * seconds);
  const step = 1 / rate;
  const lagMin = (60 * rate) / maxBpm;
  const lagMax = (60 * rate) / minBpm;
  const K = combWeights.length;
  const maxLag = Math.min(N - 1, Math.ceil(lagMax * K) + 2);
  const ring = new Float32Array(N);
  const lin = new Float64Array(N);
  const prefix = new Float64Array(N + 1);
  const acf = new Float64Array(maxLag + 2);
  const gridStep = 0.25;   // lag resolution of the search, before parabolic refinement
  const nGrid = Math.floor((lagMax - lagMin) / gridStep) + 1;
  const score = new Float64Array(nGrid);
  const prior = new Float64Array(nGrid);
  for (let g = 0; g < nGrid; g++) {
    const bpm = (60 * rate) / (lagMin + g * gridStep);
    const o = Math.log2(bpm / priorBpm) / priorOctaves;
    prior[g] = Math.exp(-0.5 * o * o);
  }

  let write = 0, count = 0;
  let nextGrid = null;   // time of the next grid slot
  let pending = 0;       // max flux since the last slot was written
  let lastT = null;
  let lastCompute = -Infinity;
  const raw = { bpm: 0, confidence: 0, strength: 0 };
  const out = { bpm: 0, confidence: 0 };
  let bpm = 0, conf = 0;
  let cand = 0, candCount = 0, lowTime = 0;

  function reset() {
    ring.fill(0); write = 0; count = 0; nextGrid = null; pending = 0; lastT = null; lastCompute = -Infinity;
  }

  function acfAt(l) {   // linear interpolation between integer lags
    const i = Math.floor(l), f = l - i;
    return acf[i] * (1 - f) + acf[i + 1] * f;
  }

  function compute() {
    const n = count;
    // unroll the ring, oldest first
    const start = (write - n + N) % N;
    for (let i = 0; i < n; i++) lin[i] = ring[(start + i) % N];
    // detrend: subtract a centred local mean, half-wave rectify
    prefix[0] = 0;
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + lin[i];
    const w = Math.max(1, Math.round(detrendSeconds * rate));
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - w), b = Math.min(n, i + w + 1);
      const v = lin[i] - (prefix[b] - prefix[a]) / (b - a);
      lin[i] = v > 0 ? v : 0;
    }
    let mean = 0;
    for (let i = 0; i < n; i++) mean += lin[i];
    mean /= n;
    for (let i = 0; i < n; i++) lin[i] -= mean;
    // unbiased autocorrelation up to the longest lag the data supports
    const usable = Math.min(maxLag, Math.floor(n * 0.7));
    for (let l = 0; l <= usable + 1 && l <= maxLag + 1; l++) {
      let s = 0;
      const m = n - l;
      for (let i = 0; i < m; i++) s += lin[i] * lin[i + l];
      acf[l] = m > 0 ? s / m : 0;
    }
    const a0 = acf[0];
    raw.strength = Math.sqrt(a0 > 0 ? a0 : 0);
    if (!(a0 > 1e-12)) { raw.bpm = 0; raw.confidence = 0; return; }
    for (let l = 0; l <= usable + 1 && l <= maxLag + 1; l++) acf[l] /= a0;

    // comb score per candidate lag
    let best = -1, bestScore = -Infinity, sum = 0;
    for (let g = 0; g < nGrid; g++) {
      const L = lagMin + g * gridStep;
      let s = 0, ws = 0;
      for (let k = 0; k < K; k++) {
        const l = L * (k + 1);
        if (l > usable) break;
        s += combWeights[k] * acfAt(l); ws += combWeights[k];
      }
      s = ws > 0 ? s / ws : 0;
      score[g] = s;
      sum += s;
      const p = s * prior[g];
      if (p > bestScore) { bestScore = p; best = g; }
    }
    const avg = sum / nGrid;
    // parabolic refinement on the prior-weighted score
    let L = lagMin + best * gridStep;
    if (best > 0 && best < nGrid - 1) {
      const y0 = score[best - 1] * prior[best - 1], y1 = score[best] * prior[best], y2 = score[best + 1] * prior[best + 1];
      const den = y0 - 2 * y1 + y2;
      if (den < 0) L += gridStep * Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den));
    }
    raw.bpm = (60 * rate) / L;
    // salience: how far the chosen period stands above the typical candidate
    // Gate by how much the envelope moves at all. Flux is log-compressed, so it hardly depends on
    // loudness; a smooth pad changes the spectrum so little that any periodicity found in it (slow
    // beating, cross-fades) is not a beat. Drums and clicks sit far above the gate.
    const g = Math.max(0, Math.min(1, (raw.strength - strengthGate[0]) / (strengthGate[1] - strengthGate[0])));
    raw.confidence = Math.max(0, Math.min(1, (score[best] - avg) * 2)) * g * g * (3 - 2 * g);
  }

  function same(x, y) { return y > 0 && Math.abs(x / y - 1) < agree; }

  function settle() {
    const c = raw.confidence, b = raw.bpm;
    conf += (c - conf) * 0.35;
    if (c < dropConfidence) {
      lowTime += interval;
      if (lowTime >= dropSeconds) { bpm = 0; cand = 0; candCount = 0; }
      return;
    }
    lowTime = 0;
    if (c < lockConfidence) return;
    if (bpm > 0 && same(b, bpm)) {
      bpm += (b - bpm) * 0.25;   // follow small drifts smoothly
      candCount = 0;
      return;
    }
    if (same(b, cand)) { candCount++; cand += (b - cand) * 0.5; } else { cand = b; candCount = 1; }
    const octave = bpm > 0 && (same(b, bpm * 2) || same(b, bpm / 2));
    const needed = bpm === 0 ? 3 : octave ? 16 : 6;
    if (candCount >= needed) { bpm = cand; candCount = 0; }
  }

  return {
    push(v, t) {
      if (!(v >= 0)) v = 0;
      if (lastT != null && (t - lastT > 0.5 || t < lastT)) {   // a stall (hidden tab) breaks the envelope
        const keepBpm = bpm, keepConf = conf;
        reset(); bpm = keepBpm; conf = keepConf;
      }
      lastT = t;
      if (nextGrid == null) nextGrid = t;
      if (v > pending) pending = v;
      let wrote = false;
      while (nextGrid <= t) {
        ring[write] = pending; write = (write + 1) % N; if (count < N) count++;
        nextGrid += step; wrote = true;
      }
      if (wrote) pending = 0;
      if (count >= minSeconds * rate && t - lastCompute >= interval) {
        lastCompute = t;
        compute();
        settle();
      }
    },
    estimate() {
      out.bpm = bpm;
      out.confidence = conf;
      return out;
    },
    /** The latest unsmoothed estimate, for tests and tuning. */
    raw,
    reset() { reset(); bpm = 0; conf = 0; cand = 0; candCount = 0; lowTime = 0; },
  };
}
