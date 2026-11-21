// Web Audio wiring for music reactivity: taps the radio's <audio> element (or any AudioNode) with
// an AnalyserNode and turns each animation frame's samples into the features the director reads
// in setAudio(f). The analysis itself lives in audioAnalysis.js; this file only moves samples.
//
//   const tap = createAudioTap();
//   tap.attachElement(audioEl);          // once the element exists; audioEl has crossorigin="anonymous"
//   startButton.onclick = () => tap.resume();
//   each frame: director.setAudio(tap.update(dt));
//
// update() returns the same features object every frame (it is mutated in place, so nothing is
// allocated per frame); copy fields out if you need to keep them.
import {
  DEFAULT_BANDS, createBandMeter, createOnsetDetector, createTempoEstimator, createAutoGain, smoothing,
} from './audioAnalysis.js';

// A media element can feed only one MediaElementAudioSourceNode, ever: a second call throws, and
// once the first exists the element is heard only through that node's AudioContext. So the graph
// for each element is created once, here, and shared by every tap that asks for the same element.
// It is never torn down: disconnecting it would silence the radio for the rest of the page's life.
const elementGraphs = new WeakMap();   // HTMLMediaElement -> { ctx, source }

function graphFor(el) {
  let g = elementGraphs.get(el);
  if (g) return g;
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  let source;
  try {
    source = ctx.createMediaElementSource(el);
  } catch (err) {
    ctx.close().catch(() => {});
    throw err;
  }
  // Straight to the speakers, unchanged; analysers hang off the side.
  source.connect(ctx.destination);
  g = { ctx, source };
  elementGraphs.set(el, g);
  // A suspended context would mute the radio. Browsers suspend it until a user gesture, so try
  // again whenever the element starts playing (play() itself is usually called from a click).
  const wake = () => { if (ctx.state === 'suspended') ctx.resume().catch(() => {}); };
  el.addEventListener('play', wake);
  el.addEventListener('playing', wake);
  return g;
}

export function createAudioTap({
  fftSize = 2048,
  bands = DEFAULT_BANDS,
  silenceSeconds = 2,     // exact silence for this long while playing means no usable signal
  silencePeak = 1e-5,     // a sample above this (about -100 dBFS) counts as signal
  minVolume = 0.02,       // below this element volume, hold the last features instead of measuring
  graceSeconds = 0.12,    // after a volume jump the analyser still holds old-gain samples
  levelTau = 0.12,        // light smoothing of the reported values
  bandTau = 0.06,
} = {}) {
  let ctx = null, analyser = null, input = null, element = null;
  let td = null, fd = null;
  let meter = null, detector = null, tempo = null;
  const bandNames = Object.keys(bands);
  const bandOut = {};
  for (const b of bandNames) bandOut[b] = 0;

  // Slow normalisation, one per output. Floors sit well under any music, so silence reads 0.
  const levelGain = createAutoGain({ floor: 1e-5 });
  const bandGains = {};
  for (const b of bandNames) bandGains[b] = createAutoGain({ floor: 1e-6 });
  const fluxGain = createAutoGain({ floor: 1e-3, decayDbPerSec: 3 });

  const features = { active: false, level: 0, flux: 0, onset: false, bpm: 0, confidence: 0 };
  for (const b of bandNames) features[b] = 0;
  const stats = { rms: 0, rawRms: 0, volume: 1, sampleRate: 0, state: 'none' };

  let time = 0;            // analysis clock: advances only while measuring, so holds leave no gap
  let lastSignal = -Infinity;
  let seen = false;
  let holding = false;
  let lastEff = 1;
  let grace = 0;
  let rmsSmooth = 0;

  function resetAnalysis() {
    time = 0; lastSignal = -Infinity; seen = false; holding = false; lastEff = 1; grace = 0; rmsSmooth = 0;
    levelGain.reset(); fluxGain.reset();
    for (const b of bandNames) { bandGains[b].reset(); features[b] = 0; }
    features.active = false; features.level = 0; features.flux = 0; features.onset = false; features.bpm = 0; features.confidence = 0;
  }

  function detach() {
    if (analyser && input) { try { input.disconnect(analyser); } catch { /* already gone */ } }
    analyser = null; input = null; ctx = null; element = null;
  }

  function setup(audioContext, node) {
    detach();
    ctx = audioContext;
    input = node;
    analyser = ctx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0;   // flux needs raw frames; we smooth ourselves, by dt
    node.connect(analyser);
    if (!td || td.length !== fftSize) { td = new Float32Array(fftSize); fd = new Float32Array(fftSize / 2); }
    const sr = ctx.sampleRate;
    meter = createBandMeter(sr, fftSize, bands);
    detector = createOnsetDetector({ sampleRate: sr, fftSize });
    tempo = createTempoEstimator();
    stats.sampleRate = sr;
    resetAnalysis();
  }

  function measure(dt) {
    // Effective gain the element applies before our analyser. Measured in Chromium against a
    // live SomaFM stream: the analyser sees volume x the signal (0.25 gives 0.251x the RMS), and
    // muted or volume 0 gives exact zeros. So divide by volume, and when there is nothing left to
    // divide, hold everything (including `active` and the clocks) until the volume comes back.
    let eff = 1;
    if (element) {
      eff = element.muted ? 0 : Number(element.volume);
      if (!(eff >= 0)) eff = 1;
    }
    stats.volume = eff;
    if (eff < minVolume) {
      holding = true;
      features.onset = false;
      features.flux = 0;
      return;
    }
    // The distraction mechanic ramps the volume a little every frame; that is simply compensated.
    // Only a jump (or coming back from a hold) leaves the analyser window holding samples at a
    // very different gain, which would read as a fake onset, so only then pause for a moment.
    if (holding || Math.abs(eff / lastEff - 1) > 0.2) grace = graceSeconds;
    holding = false;
    lastEff = eff;
    time += dt;

    analyser.getFloatTimeDomainData(td);
    let sumsq = 0, peak = 0;
    for (let i = 0; i < td.length; i++) {
      const v = td[i];
      if (v === v) {   // skip NaN
        sumsq += v * v;
        const a = v < 0 ? -v : v;
        if (a > peak) peak = a;
      }
    }
    const rawRms = Math.sqrt(sumsq / td.length);
    // Exact zeros while playing are what a CORS-tainted or broken (Safari) source delivers.
    if (peak > silencePeak) { lastSignal = time; seen = true; }
    features.active = seen && time - lastSignal < silenceSeconds;

    const gain = 1 / eff;
    const offsetDb = 20 * Math.log10(gain);
    const rms = rawRms * gain;
    stats.rawRms = rawRms; stats.rms = rms;
    analyser.getFloatFrequencyData(fd);

    if (grace > 0) {
      // The analyser window still mixes samples from before the volume step: keep the reference
      // spectrum current but report nothing, and leave the gain peaks alone.
      grace -= dt;
      detector.prime(fd, offsetDb, time);
      tempo.push(0, time);
      features.flux = 0; features.onset = false;
    } else {
      rmsSmooth += (rms - rmsSmooth) * smoothing(dt, 0.05);
      features.level += (levelGain.push(rmsSmooth, dt) - features.level) * smoothing(dt, levelTau);
      meter.measure(fd, bandOut, offsetDb);
      const a = smoothing(dt, bandTau);
      for (let b = 0; b < bandNames.length; b++) {
        const name = bandNames[b];
        features[name] += (bandGains[name].push(bandOut[name], dt) - features[name]) * a;
      }
      const r = detector.push(fd, time, offsetDb);
      features.flux = fluxGain.push(r.flux, dt);
      features.onset = r.onset;
      tempo.push(r.flux, time);
    }
    const e = tempo.estimate();
    features.bpm = e.bpm;
    features.confidence = e.confidence;
  }

  return {
    features,

    /** Analyse an <audio> element and keep it audible. Safe to call repeatedly for the same element. */
    attachElement(audioEl) {
      try {
        if (!audioEl) return false;
        if (element === audioEl && analyser) return true;
        const g = graphFor(audioEl);
        if (!g) return false;
        setup(g.ctx, g.source);
        element = audioEl;
        if (g.ctx.state === 'suspended' && !audioEl.paused) g.ctx.resume().catch(() => {});
        return true;
      } catch {
        detach();
        return false;
      }
    },

    /** Analyse any AudioNode in an existing context. Does not connect anything to the speakers. */
    attachNode(audioContext, sourceNode) {
      setup(audioContext, sourceNode);
    },

    /** Call once per animation frame with the frame's duration in seconds. Never throws. */
    update(dt) {
      if (!(dt > 0)) dt = 1 / 60;
      if (dt > 0.25) dt = 0.25;   // a stalled tab: treat as one long frame, not a jump in time
      if (!analyser) { features.active = false; features.onset = false; features.flux = 0; return features; }
      try {
        stats.state = ctx.state;
        measure(dt);
      } catch {
        features.onset = false;
      }
      return features;
    },

    /** Resume the AudioContext; call from a user gesture (the Start click). */
    resume() {
      if (!ctx || ctx.state !== 'suspended') return Promise.resolve();
      return ctx.resume().catch(() => {});
    },

    /** Raw numbers for debugging and checks: compensated and raw RMS, volume, sample rate. */
    stats() { return stats; },

    /** Stop analysing. An element keeps playing through its (shared, permanent) graph. */
    dispose() { detach(); },
  };
}
