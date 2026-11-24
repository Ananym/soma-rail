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
  // Extra [lo, hi] ranges whose own flux (the mean rise of their bins, unweighted) is reported in
  // result.side, from the same pass: used for the band onsets (createPeakPicker). They must lie
  // inside the bands above; bins outside every band are never read and add nothing.
  sideBands = [],
} = {}) {
  const n = fftSize / 2;
  const ranges = bands.map(([lo, hi]) => binRange(lo, hi, sampleRate, fftSize));
  const weights = bands.map((b) => b[2]);
  const ref = new Float32Array(n);
  const sideRanges = sideBands.map(([lo, hi]) => binRange(lo, hi, sampleRate, fftSize));
  const rise = sideRanges.length ? new Float32Array(n) : null;   // this frame's rise per bin
  let primed = false;
  let lastT = null;
  let mean = 0, dev = 0, warm = 0;
  let armed = true;
  let lastOnset = -Infinity;
  const result = { flux: 0, onset: false, threshold: 0, side: new Float64Array(sideRanges.length) };

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
      if (!primed) { prime(specDb, offsetDb); lastT = t; result.flux = 0; result.onset = false; result.side.fill(0); return result; }
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
          if (rise) rise[i] = d > 0 ? d : 0;
          ref[i] += d * a;
        }
        flux += weights[b] * s / (i1 - i0);
      }
      // (Bins outside every band are never read, so their reference is left alone.)
      for (let b = 0; b < sideRanges.length; b++) {
        const i0 = sideRanges[b][0], i1 = sideRanges[b][1];
        let s = 0;
        for (let i = i0; i < i1; i++) s += rise[i];
        result.side[b] = s / (i1 - i0);
      }

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
    reset() { primed = false; lastT = null; mean = 0; dev = 0; warm = 0; armed = true; lastOnset = -Infinity; result.side.fill(0); },
  };
}

/**
 * The onset decision of createOnsetDetector on its own, for any flux signal (the band fluxes in
 * the detector's result.side): above an adaptive threshold (slow mean plus k times the slow mean
 * absolute deviation, plus minFlux), on the rising edge, re-armed below it, with a refractory
 * period, after a warm-up. Same arithmetic as the full-band detector.
 */
export function createPeakPicker({ k = 4, minFlux = 0.03, meanTau = 0.6, refractory = 0.09, warmup = 0.4 } = {}) {
  let mean = 0, dev = 0, warm = 0, armed = true, lastOnset = -Infinity;
  const out = { onset: false, threshold: 0 };
  return {
    out,
    /** One frame: flux, its time t and the frame's dt. Returns true on an onset. */
    push(flux, t, dt) {
      if (!(flux >= 0)) flux = 0;
      const threshold = mean + k * dev + minFlux;
      out.threshold = threshold; out.onset = false;
      warm += dt;
      if (warm < warmup) {
        const m = smoothing(dt, meanTau * 0.5);
        mean += (flux - mean) * m;
        dev += (Math.abs(flux - mean) - dev) * m;
        return false;
      }
      if (flux > threshold) {
        if (armed && t - lastOnset >= refractory) { out.onset = true; lastOnset = t; }
        armed = false;
      } else armed = true;
      const above = flux >= threshold;
      const m = smoothing(dt, above ? meanTau * 10 : meanTau);
      const fc = above ? threshold : flux;
      mean += (fc - mean) * m;
      dev += (Math.abs(fc - mean) - dev) * m;
      return out.onset;
    },
    reset() { mean = 0; dev = 0; warm = 0; armed = true; lastOnset = -Infinity; out.onset = false; },
  };
}

// ---------- the features the tap reports, and the slow signals made from them ----------

const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);
/** Linear amplitude to dB, with a floor so silence stays finite. */
export function ampDb(a) { return 20 * Math.log10(a > 1e-7 ? a : 1e-7); }

/** The band onsets: kicks and bass drums low, hats, snares and claps high. */
export const ONSET_BANDS = { low: [40, 160], high: [2500, 11000] };
/** The part of the mid band the voice lift reads: above where a kick or bass note's window
 *  main lobe reaches (a 140 Hz kick spreads to ~210 Hz through the Blackman window). */
export const VOICE_BAND = [250, 2500];

/**
 * Everything the tap measures from one analyser frame, in one place so that audio.js and
 * scripts/check-audio.mjs run exactly the same code. `out` is filled in place:
 *   level, bass, mid, treble   auto-gained 0..1 (slow peak normalisation: these sit near the same
 *                              value on any track, so they carry shape, not loudness)
 *   loudDb, bassDb, midDb, trebleDb   the same, volume-compensated, in dBFS and NOT auto-gained:
 *                              for anything that compares loudness over seconds (createDynamics,
 *                              createLift), since the auto-gain climbs back from a 15 dB fall in ~3 s
 *   flux, onset                the full-band spectral-flux onset (createOnsetDetector)
 *   fluxLow, onsetLow          the low band's own flux (auto-gained) and onsets (ONSET_BANDS.low)
 *   fluxHigh, onsetHigh        the same for the high band
 *   voiceDb                    VOICE_BAND in dBFS (volume-compensated, not auto-gained)
 *   bpm, confidence            the tempo estimate
 * `active` is the caller's business (audio.js decides it from silence).
 */
export function createMusicFeatures({
  sampleRate, fftSize, bands = DEFAULT_BANDS, out = {}, levelTau = 0.12, bandTau = 0.06,
  onsetBands = ONSET_BANDS, voiceBand = VOICE_BAND,
  // The low band has only a handful of bins, and a kick's falling pitch keeps moving energy into
  // them for a while after the hit: a higher floor keeps those (and bass notes gliding) from counting.
  lowPick = { k: 4, minFlux: 0.3 },
  highPick = { k: 4, minFlux: 0.05 },
} = {}) {
  const names = Object.keys(bands);
  const dbKeys = names.map((n) => `${n}Db`);
  const meter = createBandMeter(sampleRate, fftSize, bands);
  const [v0, v1] = binRange(voiceBand[0], voiceBand[1], sampleRate, fftSize);
  const detector = createOnsetDetector({ sampleRate, fftSize, sideBands: [onsetBands.low, onsetBands.high] });
  const tempo = createTempoEstimator();
  // Slow normalisation, one per output. Floors sit well under any music, so silence reads 0.
  const levelGain = createAutoGain({ floor: 1e-5 });
  const bandGains = names.map(() => createAutoGain({ floor: 1e-6 }));
  const fluxGain = createAutoGain({ floor: 1e-3, decayDbPerSec: 3 });
  const lowGain = createAutoGain({ floor: 1e-3, decayDbPerSec: 3 });
  const highGain = createAutoGain({ floor: 1e-3, decayDbPerSec: 3 });
  const lowPicker = createPeakPicker(lowPick), highPicker = createPeakPicker(highPick);
  const bandOut = {};
  for (const b of names) bandOut[b] = 0;
  let rmsSmooth = 0;

  function quiet() {
    out.flux = 0; out.onset = false; out.fluxLow = 0; out.onsetLow = false; out.fluxHigh = 0; out.onsetHigh = false;
  }
  function tempoOut() { const e = tempo.estimate(); out.bpm = e.bpm; out.confidence = e.confidence; }
  function reset() {
    rmsSmooth = 0;
    levelGain.reset(); fluxGain.reset(); lowGain.reset(); highGain.reset();
    for (const g of bandGains) g.reset();
    detector.reset(); tempo.reset(); lowPicker.reset(); highPicker.reset();
    out.active = false; out.level = 0; out.loudDb = ampDb(0); out.voiceDb = ampDb(0);
    for (let b = 0; b < names.length; b++) { out[names[b]] = 0; out[dbKeys[b]] = ampDb(0); }
    quiet(); out.bpm = 0; out.confidence = 0;
  }
  reset();

  return {
    out,
    detector,
    tempo,
    /** One measured frame: dB spectrum, compensated RMS, dt, analysis time, the dB offset. */
    measure(specDb, rms, dt, time, offsetDb = 0) {
      rmsSmooth += (rms - rmsSmooth) * smoothing(dt, 0.05);
      out.level += (levelGain.push(rmsSmooth, dt) - out.level) * smoothing(dt, levelTau);
      out.loudDb = ampDb(rmsSmooth);
      meter.measure(specDb, bandOut, offsetDb);
      const a = smoothing(dt, bandTau);
      for (let b = 0; b < names.length; b++) {
        const name = names[b];
        out[name] += (bandGains[b].push(bandOut[name], dt) - out[name]) * a;
        out[dbKeys[b]] = ampDb(bandOut[name]);
      }
      out.voiceDb = ampDb(bandEnergy(specDb, v0, v1, offsetDb));
      const r = detector.push(specDb, time, offsetDb);
      out.flux = fluxGain.push(r.flux, dt);
      out.onset = r.onset;
      tempo.push(r.flux, time);
      out.fluxLow = lowGain.push(r.side[0], dt);
      out.onsetLow = lowPicker.push(r.side[0], time, dt);
      out.fluxHigh = highGain.push(r.side[1], dt);
      out.onsetHigh = highPicker.push(r.side[1], time, dt);
      tempoOut();
      return out;
    },
    /** A frame whose samples are known to be unreliable (just after a volume step): keep the
     *  reference spectrum current, report nothing, leave the gains alone. */
    prime(specDb, offsetDb, time) {
      detector.prime(specDb, offsetDb, time);
      tempo.push(0, time);
      quiet();
      tempoOut();
      return out;
    },
    /** No frame at all (volume too low to measure): no onsets, everything else held. */
    hold() { quiet(); return out; },
    reset,
  };
}

/**
 * Lift of a sustained level (dB) over its own recent average, 0..1: rests at 0 on a steady level,
 * rises when something enters or swells, falls back as the average catches up.
 * - The level is first followed by a lower envelope (it falls in envDown, rises in envUp), so the
 *   decaying hits of drums, which fill the mid band for a few tens of ms at a time, hardly raise it,
 *   while a held voice or lead raises it in about envUp.
 * - The average follows that envelope over riseTau (up) and fallTau (down) seconds, and only a
 *   rise of more than marginDb over it counts (chord changes and the ripple of the beat stay under).
 * - It reads VOICE_BAND (createMusicFeatures' voiceDb), not the whole mid band, whose lowest bins
 *   carry every kick and bass note through the analyser's window.
 * Used for the mid band (vocals, melody): the auto-gained band value cannot show an entry, since
 * its peak simply follows it up.
 */
export function createLift({ envUp = 0.15, envDown = 0.05, riseTau = 6, fallTau = 6, marginDb = 4, rangeDb = 8, floorDb = -80, settle = 3 } = {}) {
  let env = 0, slow = 0, started = false, age = 0;
  return {
    push(db, dt) {
      // Silence is not a low level to lift from: the music starting (at the stream's start, after a
      // pause, between tracks) is a rise of tens of dB, which pinned the lift at 1 for ten seconds
      // or more while the average caught up. So silence restarts the measure, the first `settle`
      // seconds after a start only learn the level (the average follows closely, the lift is 0),
      // and a rise far beyond the full range is taken as a change of level, not as an entry.
      if (!(db > floorDb)) { started = false; return 0; }
      if (!started) { env = slow = db; started = true; age = 0; return 0; }
      age += dt;
      env += (db - env) * smoothing(dt, db > env ? envUp : envDown);
      const learning = age < settle, jump = env - slow > marginDb + rangeDb + 8;
      slow += (env - slow) * smoothing(dt, learning ? 0.4 : jump ? 0.5 : env > slow ? riseTau : fallTau);
      return learning ? 0 : clamp01((env - slow - marginDb) / rangeDb);
    },
    reset() { started = false; },
  };
}

/**
 * Loudness over seconds and minutes, from the uncompressed loudness and bass (dB), and the events
 * it implies. Each frame push(loudDb, bassDb, onset, dt) returns `res`:
 *   weather   0..1: the 12 s loudness against a loud reference (a running level that climbs in
 *             ~15 s and sinks over ~2 minutes, so it stands for "this music when it is going"):
 *             1 within 2 dB of it, 0 at 12 dB under (a 16 s breakdown 12 dB down ends near 0.3)
 *   event     null, 'drop' or 'breakdown' on the one frame it is detected; strength 0.2..1
 *   breakdown: an abrupt fall to a lower plateau that holds. A candidate opens once the fast
 *             loudness has been more than 6 dB under the reference for 1.5 s with the bass more
 *             than 8 dB under its own, if the 1 s level fell more than abruptDb over the last
 *             slideSeconds (else it is a slow fade, and nothing opens until loud music again); it is confirmed confirmSeconds later if the level (1 s
 *             smoothing) has stopped falling (less than slideDb down over the last slideSeconds),
 *             is still quiet, and is not on its way to silence (within silenceDb of the
 *             reference). It is dropped if the music comes back first (a dip, a breathing phrase),
 *             and given up maxConfirm seconds on (a fade, which keeps sliding). Re-armed after 2 s
 *             of loud music.
 *   drop:     only as the end of a confirmed breakdown (within episodeSeconds of it, whether or not
 *             the caller let the breakdown through): the fast loudness comes back within 3 dB of
 *             the reference suddenly (3 dB above its 2 s average) with the bass jumping dropBassDb
 *             above its own 2 s average; or the bass comes back within 4 dB of its reference, 6 dB
 *             above its 2 s average, with the onset rate up by half. A louder phrase in music that
 *             breathes is never a drop.
 * The first learnSeconds (and again after relearn(), on a change of track) only learn the levels;
 * meanwhile `weather` holds its last value (1 at the start).
 */
export function createDynamics({
  fastTau = 0.25, medTau = 2, slowTau = 12, refUpTau = 15, refDownTau = 120,
  learnSeconds = 8, learnTau = 1.5,
  weatherDb = [-12, -2],
  quietDb = 6, loudDb = 3, loudReset = 2,
  breakdownBassDb = 8, breakdownHold = 1.5,
  confirmSeconds = 4, maxConfirm = 10, slideSeconds = 3, slideDb = 2, abruptDb = 5, silenceDb = 30, backFor = 0.5,
  dropQuiet = 3, dropRiseDb = 3, dropBassDb = 6, episodeSeconds = 60,
  bassGoneDb = 10, bassBackDb = 4, bassJumpDb = 6,
  minGap = 8,
} = {}) {
  let started = false, learn = 0;
  let fast = 0, med = 0, slow = 0, ref = 0, bFast = 0, bMed = 0, bRef = 0, oFast = 0, oSlow = 0, lvl = 0;
  let quiet = 0, quietMin = Infinity, loudFor = 0, armedB = true, bassGone = 0, bLoudFor = 0, since = Infinity;
  let cand = false, candFor = 0, episode = Infinity;
  // the 1 s level every 0.25 s over the last few seconds, to see whether it is still falling
  const HIST_STEP = 0.25, hist = new Float32Array(Math.ceil(slideSeconds / HIST_STEP) + 1);
  let histAt = 0, histN = 0, histT = 0;
  const res = { weather: 1, event: null, strength: 0, fast: 0, slow: 0, ref: 0 };
  function clearEpisode() { quiet = 0; quietMin = Infinity; loudFor = 0; armedB = true; bassGone = 0; bLoudFor = 0; cand = false; candFor = 0; episode = Infinity; }
  return {
    res,
    push(loud, bass, onset, dt) {
      res.event = null; res.strength = 0;
      if (!(loud > -140)) loud = -140;
      if (!(bass > -140)) bass = -140;
      if (!started) {
        started = true; learn = learnSeconds;
        fast = med = slow = ref = lvl = loud; bFast = bMed = bRef = bass; oFast = oSlow = 0; clearEpisode();
        histN = 0; histT = 0;
      }
      fast += (loud - fast) * smoothing(dt, fastTau);
      med += (loud - med) * smoothing(dt, medTau);
      bFast += (bass - bFast) * smoothing(dt, fastTau);
      bMed += (bass - bMed) * smoothing(dt, medTau);
      lvl += (loud - lvl) * smoothing(dt, 1);
      histT += dt;
      if (histT >= HIST_STEP) { histT -= HIST_STEP; hist[histAt] = lvl; histAt = (histAt + 1) % hist.length; if (histN < hist.length) histN++; }
      oFast = oFast * Math.exp(-dt / 1.5) + (onset ? 1 / 1.5 : 0);
      oSlow = oSlow * Math.exp(-dt / 10) + (onset ? 1 / 10 : 0);
      since += dt;
      if (learn > 0) {
        learn -= dt;
        const a = smoothing(dt, learnTau);
        slow += (fast - slow) * a; ref += (fast - ref) * a; bRef += (bFast - bRef) * a;
        clearEpisode();
      } else {
        slow += (loud - slow) * smoothing(dt, slowTau);
        ref += (fast - ref) * smoothing(dt, fast > ref ? refUpTau : refDownTau);
        bRef += (bFast - bRef) * smoothing(dt, bFast > bRef ? refUpTau : refDownTau);
        // a quiet stretch: how long, and how low
        if (ref - fast > quietDb) { quiet += dt; if (fast < quietMin) quietMin = fast; } else quiet = Math.max(0, quiet - dt);
        if (bRef - bFast > bassGoneDb) bassGone += dt; else bassGone = Math.max(0, bassGone - 0.5 * dt);
        if (fast > ref - loudDb) loudFor += dt; else loudFor = 0;
        if (bFast > bRef - bassBackDb) bLoudFor += dt; else bLoudFor = 0;
        let ev = null, st = 0;
        episode += dt;
        // the 1 s level slideSeconds ago (the oldest sample in the history)
        const ago = histN === hist.length ? hist[histAt] : hist[0];
        if (armedB && !cand && quiet >= breakdownHold && bRef - bFast > breakdownBassDb) {
          // only an abrupt fall opens one: a level that has been drifting down is fading
          if (lvl - ago < -abruptDb) { cand = true; candFor = 0; } else armedB = false;
        }
        if (cand) {
          candFor += dt;
          if (loudFor > backFor || bFast > bRef - bassBackDb) cand = false;   // it came back: a dip
          else if (candFor >= confirmSeconds) {
            if (lvl < ref - silenceDb || candFor >= maxConfirm) { cand = false; armedB = false; }   // a fade, or the end
            else if (lvl - ago > -slideDb && lvl < ref - quietDb) {
              ev = 'breakdown'; st = clamp01((ref - lvl) / 15); cand = false; armedB = false; episode = 0;
            }
          }
        }
        if (!ev && episode < episodeSeconds) {
          if (quiet >= dropQuiet && fast > ref - loudDb && fast - med > dropRiseDb && bFast - bMed > dropBassDb) {
            ev = 'drop'; st = clamp01((fast - Math.min(quietMin, med)) / 15);
          } else if (bassGone >= dropQuiet && bFast > bRef - bassBackDb && bFast - bMed > bassJumpDb && oFast > 1.5 * oSlow + 0.5) {
            ev = 'drop'; st = clamp01((bFast - bMed) / 15);
          }
          if (ev) { quiet = 0; quietMin = Infinity; bassGone = 0; episode = Infinity; }
        }
        if (loudFor > loudReset) { quiet = 0; quietMin = Infinity; armedB = true; cand = false; episode = Infinity; }
        if (bLoudFor > loudReset) bassGone = 0;
        if (ev && since >= minGap) { res.event = ev; res.strength = Math.max(0.2, st); since = 0; }
      }
      // (while learning, the last weather is held: the caller eases it out, see director.js)
      if (learn <= 0) res.weather = clamp01((slow - ref - weatherDb[0]) / (weatherDb[1] - weatherDb[0]));
      res.fast = fast; res.slow = slow; res.ref = ref;
      return res;
    },
    /** Learn the levels afresh (a change of track): no events and full weather while it lasts. */
    relearn(seconds = learnSeconds) { if (started) { learn = Math.max(learn, seconds); clearEpisode(); } },
    reset() { started = false; since = Infinity; res.weather = 1; res.event = null; },
  };
}

/**
 * Soft cues: the small turns of phrasing that suit a scheduled event when the music offers no
 * real drop or breakdown (see the director's event schedule). push(loudDb, bassDb, onset, dt)
 * returns `res`, with res.cue set on the one frame a cue is seen:
 *   'drop'       the phrase level (loudness smoothed over fastTau, slow enough to ride over the
 *                beat) rises more than riseDb above its own average of the last few seconds
 *                (avgTau), on an onset (within onsetWindow): a part or a phrase coming in.
 *                res.bassUp says the bass rose bassDb with it.
 *   'breakdown'  the phrase level falls more than fallDb under that average and stays there for
 *                fallHold seconds: a part dropping out, a held chord.
 * Each re-arms once the level is back within half its threshold of the average. res.excess is how
 * far past the threshold (dB), for the event's strength. Nothing is reported for warmup seconds.
 * `scale` (per push) multiplies both thresholds: the director lowers it the longer an event waits.
 */
export function createSoftCues({
  fastTau = 0.4, avgTau = 4, riseDb: rise = 3, fallDb: fall = 3, fallHold = 0.6, bassDb = 3, onsetWindow = 0.4, warmup = 4,
} = {}) {
  let started = false, fast = 0, avg = 0, bFast = 0, bAvg = 0, sinceOnset = Infinity, below = 0, warm = 0;
  let armedRise = true, armedFall = true;
  const res = { cue: null, excess: 0, bassUp: false, fast: 0, avg: 0 };
  return {
    res,
    push(loud, bass, onset, dt, scale = 1) {
      res.cue = null; res.excess = 0; res.bassUp = false;
      if (!(loud > -140)) loud = -140;
      if (!(bass > -140)) bass = -140;
      const riseDb = rise * scale, fallDb = fall * scale;
      if (!started) { started = true; fast = avg = loud; bFast = bAvg = bass; warm = 0; }
      fast += (loud - fast) * smoothing(dt, fastTau);
      avg += (fast - avg) * smoothing(dt, avgTau);
      bFast += (bass - bFast) * smoothing(dt, fastTau);
      bAvg += (bFast - bAvg) * smoothing(dt, avgTau);
      sinceOnset = onset ? 0 : sinceOnset + dt;
      warm += dt;
      const d = fast - avg;
      if (d < riseDb / 2) armedRise = true;
      if (d > -fallDb / 2) armedFall = true;
      below = d < -fallDb ? below + dt : 0;
      if (warm >= warmup) {
        if (armedRise && d > riseDb && sinceOnset <= onsetWindow) {
          res.cue = 'drop'; res.excess = d - riseDb; res.bassUp = bFast - bAvg > bassDb; armedRise = false;
        } else if (armedFall && below >= fallHold) {
          res.cue = 'breakdown'; res.excess = -d - fallDb; armedFall = false;
        }
      }
      res.fast = fast; res.avg = avg;
      return res;
    },
    reset() { started = false; armedRise = true; armedFall = true; below = 0; sinceOnset = Infinity; },
  };
}

/**
 * A beat clock: `value` advances one unit per beat at the trusted tempo, and a phase-locked loop
 * pulls it so whole numbers fall on onsets. `on` (0..1) says whether to believe it.
 *
 * step(dt, active, bpm, confidence, onset, onsetLow, frozen) once per frame:
 * - the tempo is taken whenever confidence > lockConfidence (the mast-spacing test); the lock is
 *   fresh while that was seen within freshSeconds and a steering onset within onsetGap beats;
 * - with a kick present (low-band onsets at least kickShare per beat) only low onsets steer it,
 *   otherwise every full-band onset does;
 * - the phase detector is sin(2 pi e) / 2 pi of the onset's distance e from the nearest whole
 *   number: zero on the beat AND half-way between, so off-beat hats do not tug it; an integral
 *   term trims the rate (up to maxFreq) so a slightly wrong tempo leaves no standing offset;
 * - the correction is spread over frames (trackTau) and, while `on` is up, limited to maxSlew of
 *   the clock's own rate: the clock never steps, it only runs a little faster or slower. With `on`
 *   down nobody is watching, so it pulls in fast (acquireTau);
 * - quality: the running mean of max(0, cos(4 pi e)): 1 for onsets on the beat or half-beat grid,
 *   0 for syncopations a quarter-beat off, about 0.32 for a clock that does not match the music. `on` rises (upTau) once the lock has been fresh with
 *   the quality above qualityOn for holdOn seconds, and falls (downTau) only after holdOff seconds
 *   of a poor lock, or at once when the onsets or the analysis stop (see the hysteresis options);
 * - `latency` is the detector's own delay (seconds), taken off before measuring the phase;
 * - frozen (a stopped train) holds everything.
 */
export function createBeatClock({
  lockConfidence = 0.6, freshSeconds = 1, onsetGap = 3, kickShare = 0.4,
  latency = 0, trackTau = 0.4, acquireTau = 0.08, maxSlew = 0.25, ki = 0.03, maxFreq = 0.05,
  upTau = 0.6, downTau = 0.35, wrap = 1024,
  // Hysteresis, in quality and in time: the chase comes on once the lock has held (fresh, quality
  // over qualityOn) for holdOn seconds, and goes off only after holdOff seconds of a poor one
  // (quality under qualityOff, no confident tempo for holdFresh seconds, or no steering onset for
  // onsetGap beats), or at once when the analysis stops. qualityRate is the weight of each onset in
  // the running quality (about the last 1 / qualityRate onsets).
  qualityOn = 0.6, qualityOff = 0.4, qualityRate = 0.1, holdOn = 3, holdOff = 1.5, holdFresh = 1.5,
} = {}) {
  const TWO_PI = 2 * Math.PI;
  const s = { value: 0, on: 0, tempo: 0, perr: 0, quality: 0, fcorr: 0, kick: false, locked: false, gate: false };
  let t = 0, lastLock = -Infinity, lastOnset = -Infinity, lowRate = 0, goodFor = 0, badFor = 0;
  return {
    state: s,
    step(dt, active, bpm, confidence, onset, onsetLow, frozen = false) {
      if (frozen || !(dt > 0)) return s;
      t += dt;
      if (active && bpm > 40 && confidence > lockConfidence) {
        if (s.tempo > 0 && Math.abs(bpm / s.tempo - 1) > 0.03) s.fcorr = 0;   // a new tempo: the old trim is meaningless
        s.tempo = bpm; lastLock = t;
      }
      lowRate = lowRate * Math.exp(-dt / 4) + (active && onsetLow ? 0.25 : 0);
      s.kick = s.tempo > 0 && lowRate >= (kickShare * s.tempo) / 60;
      const rate = (s.tempo / 60) * (1 + s.fcorr);
      if (active && s.tempo > 0 && (s.kick ? onsetLow : onset)) {
        let e = s.value - latency * rate;
        e -= Math.round(e);
        // Once the chase is on, an onset steers in proportion to how near the beat it is, and not
        // at all from a quarter of a beat or more away: syncopated kicks a sixteenth early would
        // otherwise drag the whole clock early. While acquiring, every onset steers.
        const c1 = Math.cos(TWO_PI * e), w = s.gate ? (c1 > 0 ? c1 * c1 : 0) : 1;
        const pd = (w * Math.sin(TWO_PI * e)) / TWO_PI;
        if (w > 0) s.perr += (pd - s.perr) * 0.5 * w;
        const q = Math.cos(2 * TWO_PI * e);
        s.quality += ((q > 0 ? q : 0) - s.quality) * qualityRate;
        s.fcorr = Math.max(-maxFreq, Math.min(maxFreq, s.fcorr - ki * pd));
        lastOnset = t;
      }
      const hearing = active && s.tempo > 0 && (t - lastOnset) * s.tempo / 60 < onsetGap;
      const fresh = t - lastLock < (s.gate ? holdFresh : freshSeconds);
      s.locked = hearing && fresh;
      if (!s.gate) {
        goodFor = s.locked && s.quality > qualityOn ? goodFor + dt : 0;
        if (goodFor >= holdOn) { s.gate = true; badFor = 0; }
      } else if (!active || s.tempo <= 0) s.gate = false;
      else {
        // (leaky, so a quality that hovers about the line still counts against the lock)
        badFor = !s.locked || s.quality < qualityOff ? badFor + dt : Math.max(0, badFor - 0.5 * dt);
        if (badFor >= holdOff) s.gate = false;
      }
      if (!s.gate) badFor = 0; else goodFor = 0;
      if (s.tempo > 0 && (s.locked || s.on > 0)) {
        const tau = acquireTau + (trackTau - acquireTau) * s.on;
        const lim = (0.9 - (0.9 - maxSlew) * s.on) * rate * dt;
        let d = -s.perr * smoothing(dt, tau);
        if (d > lim) d = lim; else if (d < -lim) d = -lim;
        s.value += rate * dt + d;
        s.perr += d;
        if (s.value >= wrap) s.value -= wrap;
      }
      const target = s.gate ? 1 : 0;
      s.on += (target - s.on) * smoothing(dt, target > s.on ? upTau : downTau);
      if (target === 0 && s.on < 0.002) s.on = 0;
      return s;
    },
    reset() { s.on = 0; s.perr = 0; s.quality = 0; s.fcorr = 0; s.locked = false; s.gate = false; lastLock = -Infinity; lastOnset = -Infinity; lowRate = 0; goodFor = 0; badFor = 0; },
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
