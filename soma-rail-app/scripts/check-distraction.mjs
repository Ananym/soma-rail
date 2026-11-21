// Checks for the distraction score (src/utils/distractionModel.js), in Node with a simulated clock.
//   node scripts/check-distraction.mjs
// 1. At 60 fps the time-based score matches the tick-based one it replaced (a copy of that
//    arithmetic is kept below as the reference), to within a tick's worth of score.
// 2. The score at any moment is the same however rarely it is read and however late inputs are
//    reported, where the tick-based one fell behind.
// 3. One update after a very long gap accounts for at most DISTRACTION_MAX_STEP of it.
// Exits non-zero on any failure.
import { CONFIG } from '../src/config.js';
import { createDistractionModel, createSteppedClock } from '../src/utils/distractionModel.js';

const failures = [];
let checks = 0;
function check(ok, label) {
  checks++;
  if (!ok) failures.push(label);
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${label}`);
}
const f1 = (v) => v.toFixed(1);

// ---------- the tick-based score this replaced: 1.1 points per tick, ticks meant to be 16 ms apart ----------
function createTickReference() {
  const OLD = { INCREMENT: 1.1, TICK: 16, STILL_AFTER: 100, DELAY: 2000 };
  let score = 0, focused = true, moving = false, lastMove = -10000, lastIncrease = 0, throttledUntil = -Infinity;
  let anchor = { x: 0, y: 0 };
  return {
    pointerMoved(x, y, t) {
      if (t < throttledUntil) return;
      throttledUntil = t + CONFIG.MOUSE_MOVEMENT_SAMPLE_RATE;
      lastMove = t;
      if (Math.hypot(x - anchor.x, y - anchor.y) > CONFIG.JITTER_THRESHOLD) { moving = true; anchor = { x, y }; }
    },
    setFocused(v) { focused = v; },
    tick(t) {
      if (t - lastMove > OLD.STILL_AFTER) moving = false;
      if (moving || !focused) {
        score = Math.min(score + OLD.INCREMENT, CONFIG.DISTRACTION_MAX);
        lastIncrease = t;
      } else if (t - lastIncrease > OLD.DELAY) {
        score = Math.max(0, score - CONFIG.DISTRACTION_MAX / (CONFIG.RECOVERY_DURATION / OLD.TICK));
      }
      return score;
    },
  };
}

// ---------- scenarios: inputs as [time ms, kind, ...] ----------
function mouseRun(from, to, every = 1000 / 60, pxPerSample = 12) {
  const out = [];
  for (let t = from, i = 1; t <= to; t += every, i++) out.push([t, 'move', 100 + i * pxPerSample, 200]);
  return out;
}
const scenarios = {
  'blur 1.0 s, then settle': { inputs: [[500, 'blur'], [1500, 'focus']], length: 9000 },
  'blur 3.0 s (to a stop), then settle': { inputs: [[500, 'blur'], [3500, 'focus']], length: 11500 },
  'mouse moving 0.8 s, then still': { inputs: mouseRun(500, 1300), length: 9000 },
  'one flick of the mouse': { inputs: [[500, 'move', 300, 300]], length: 4000 },
  'two bursts 1.5 s apart': { inputs: [...mouseRun(500, 900), ...mouseRun(2400, 2800, 1000 / 60, -12)], length: 10000 },
  'jitter under the threshold': { inputs: mouseRun(500, 1300, 1000 / 60, 0).map(([t, k], i) => [t, k, 1 + (i % 2) * 3, 1]), length: 3000, still: true },
  // once the pointer counts as moving, any further moves keep it so, as before
  'a flick, then jitter for 0.8 s': { inputs: [[500, 'move', 300, 300], ...mouseRun(517, 1300, 1000 / 60, 0).map(([t, k], i) => [t, k, 300 + (i % 2) * 3, 300])], length: 9000 },
};

function feed(target, [t, kind, x, y]) {
  if (kind === 'move') target.pointerMoved(x, y, t);
  else target.setFocused(kind === 'focus', t);
}

// The reference at a given tick spacing: inputs take effect when they happen, ticks advance the score.
function runReference(sc, tickMs) {
  const ref = createTickReference();
  const trace = [];
  let i = 0;
  for (let t = tickMs; t <= sc.length; t += tickMs) {
    while (i < sc.inputs.length && sc.inputs[i][0] <= t) feed(ref, sc.inputs[i++]);
    trace.push([t, ref.tick(t)]);
  }
  return trace;
}

// The model read every readMs. With `late`, inputs are only handed over at the next read, as a
// busy page would deliver them, still carrying the times they happened.
function runModel(sc, readMs, late = false) {
  const model = createDistractionModel(CONFIG, 0);
  const trace = [];
  let i = 0;
  if (!late) for (const input of sc.inputs) feed(model, input);   // the model may be told everything up front...
  for (let t = readMs; t <= sc.length; t += readMs) {
    if (late) while (i < sc.inputs.length && sc.inputs[i][0] <= t) feed(model, sc.inputs[i++]);
    trace.push([t, late ? model.at(t).score : replayTo(sc, t)]);   // ...but then at() must not see the future
  }
  return trace;
}
function replayTo(sc, t) {
  const model = createDistractionModel(CONFIG, 0);
  for (const input of sc.inputs) if (input[0] <= t) feed(model, input);
  return model.at(t).score;
}
const peak = (trace) => trace.reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0]);
const firstZeroAfterPeak = (trace) => { const p = peak(trace); const z = trace.find(([t, s]) => t > p[0] && s === 0); return z ? z[0] : null; };
const at = (trace, t) => { let v = 0; for (const [tt, s] of trace) { if (tt > t) break; v = s; } return v; };

// ---------- 1. the same at 60 fps ----------
console.log('\n1. At 60 fps (a read every 16 ms): tick-based reference against the time-based score');
console.log('   scenario                               peak (ref / now)   back to zero at, ms (ref / now)   largest gap');
for (const [name, sc] of Object.entries(scenarios)) {
  const ref = runReference(sc, 16), now = runModel(sc, 16);
  let worst = 0;
  for (let i = 0; i < ref.length; i++) worst = Math.max(worst, Math.abs(ref[i][1] - now[i][1]));
  console.log(`   ${name.padEnd(38)} ${f1(peak(ref)[1]).padStart(6)} / ${f1(peak(now)[1]).padEnd(6)}     ${String(firstZeroAfterPeak(ref)).padStart(6)} / ${String(firstZeroAfterPeak(now)).padEnd(6)}              ${worst.toFixed(2)}`);
  // one tick of rise is 1.1 points, and the reference can start a tick early and stop a tick late
  check(worst <= 2.2, `${name}: never more than two ticks' worth (2.2 points) apart at 60 fps`);
  if (sc.still) check(peak(ref)[1] === 0 && peak(now)[1] === 0, `${name}: the score stays at zero`);
}
{
  const model = createDistractionModel(CONFIG, 0);
  model.setFocused(false, 0);
  let full = 0; while (model.at(full).score < CONFIG.DISTRACTION_MAX) full++;
  model.setFocused(true, 3000);
  let hold = 3000; while (model.at(hold + 1).score === CONFIG.DISTRACTION_MAX) hold++;
  let zero = hold; while (model.at(zero).score > 0) zero++;
  console.log(`   distracted: 0 to 100 in ${full} ms (was 91 ticks of 16 ms = 1456 ms); settled: holds ${hold - 3000} ms, then 100 to 0 in ${zero - hold} ms`);
  check(Math.abs(full - 1456) <= 2, 'full distraction takes the 1456 ms it took at 16 ms ticks');
  check(hold - 3000 === CONFIG.RECOVERY_DELAY && zero - hold === CONFIG.RECOVERY_DURATION, 'recovery starts after 2 s of calm and takes 5 s');
}

// ---------- 2. the same at any rate ----------
console.log('\n2. Slow updates: score 400 ms after the last input, and when it is back to zero');
console.log('   scenario                               read every   tick-based reference    time-based');
for (const [name, sc] of Object.entries(scenarios)) {
  const lastInput = sc.inputs[sc.inputs.length - 1][0];
  const probe = Math.ceil((lastInput + 400) / 1000) * 1000;   // a moment every read spacing below lands on
  const want = replayTo(sc, probe);
  let ok = true;
  for (const ms of [16, 100, 250, 500, 1000]) {
    const ref = runReference(sc, ms), now = runModel(sc, ms, true);
    const got = at(now, probe);
    if (Math.abs(got - want) > 1e-6) ok = false;
    if (ms === 16 || ms === 250 || ms === 1000) console.log(`   ${name.padEnd(38)} ${String(ms).padStart(6)} ms   ${f1(at(ref, probe)).padStart(6)} (zero at ${String(firstZeroAfterPeak(ref)).padEnd(5)})   ${f1(got).padStart(6)} (zero by ${firstZeroAfterPeak(now)})`);
  }
  check(ok, `${name}: the same score at ${probe} ms whether read every 16, 100, 250, 500 or 1000 ms, inputs reported late`);
}

// ---------- 3. a long gap counts as one step of DISTRACTION_MAX_STEP ----------
console.log(`\n3. A gap of five minutes between two updates counts as ${CONFIG.DISTRACTION_MAX_STEP} ms`);
{
  const step = CONFIG.DISTRACTION_MAX_STEP;
  let wall = 1000;
  const clock = createSteppedClock(step, wall);
  const t0 = clock.time(wall);
  const t1 = clock.time(wall += 300000);
  check(t1 - t0 === step, `the clock moves ${step} ms across the gap, not 300000`);
  check(clock.time(wall += 16) - t1 === 16, 'and keeps real time again afterwards');

  // A stopped train whose listener has just settled: the hold and part of the recovery fit in one
  // step, so it is on its way but has not jumped back to full speed.
  const model = createDistractionModel(CONFIG, clock.time(wall));
  model.setFocused(false, clock.time(wall));
  model.setFocused(true, clock.time(wall += 3000));
  const before = model.at(clock.time(wall)).score;
  const after = model.at(clock.time(wall += 300000)).score;
  const want = Math.max(0, CONFIG.DISTRACTION_MAX - (CONFIG.DISTRACTION_MAX / CONFIG.RECOVERY_DURATION) * Math.max(0, step - CONFIG.RECOVERY_DELAY));
  console.log(`   settled at a stop, then the gap: ${f1(before)} -> ${f1(after)} in one step (five real minutes would give 0.0)`);
  check(before === CONFIG.DISTRACTION_MAX && Math.abs(after - want) < 1e-6, `the score falls by one step's worth (to ${f1(want)}), not all the way`);

  // an input reported late is placed when it happened, not when it was handed over
  const m3 = createDistractionModel(CONFIG, 0), c3 = createSteppedClock(step, 0);
  m3.pointerMoved(300, 300, c3.time(900, 500));
  check(Math.abs(m3.at(c3.time(900)).score - CONFIG.DISTRACTION_RISE_PER_SECOND * CONFIG.MOUSE_STILL_AFTER / 1000) < 1e-9, 'a move handed over 400 ms late still counts for its own 100 ms');
}

console.log(`\n${checks - failures.length}/${checks} checks passed`);
if (failures.length) { console.log('FAILED:\n  ' + failures.join('\n  ')); process.exit(1); }
