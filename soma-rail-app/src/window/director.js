// The director: slow state that decides what the journey is. It owns distance travelled, speed,
// time of day, the surreal dials and when the scenery changes. Inputs are attention (rate),
// music (audio features, track and channel) and the seed. It never touches the renderer.
import { hashString, hashInts, makeRng } from './rng.js';
import { BIOMES, DEFAULT_BIOME } from './biomes/index.js';

// Surreal levels: each is one setting of all five dials, tuned as a whole.
export const LEVELS = [
  { name: 'plausible', scale: 0, topology: 0, matter: 0, time: 0.012, logic: 0 },
  { name: 'dreamlike', scale: 0.8, topology: 0.6, matter: 0.5, time: 1, logic: 0.3 },
];

// Times of day a stretch of scenery can start in. The sky's sun rises at 06:00 and sets at 20:00
// and is below about 10 degrees for the 45 minutes after and before: those are the golden hours.
export const SLOTS = { dawn: [6.1, 6.8], day: [9, 16.5], dusk: [19.15, 19.85], night: [21.5, 3] };
const SLOT_WEIGHTS = { dawn: 0.22, day: 0.46, dusk: 0.32, night: 0 };

// Kinds of scenery close enough in character to stand in for one another now and then.
const NEIGHBOURS = {
  downs: ['pinewood', 'karst'], pinewood: ['downs', 'winter'], saltflat: ['dunes', 'himalaya'],
  nightcity: ['motorway'], motorway: ['nightcity'], karst: ['fuji', 'downs'],
  dunes: ['saltflat'], himalaya: ['pinewood', 'winter'], winter: ['pinewood', 'himalaya'],
  fuji: ['karst', 'downs'], tropics: ['karst', 'fuji'],
};
const TUNNEL_LEAD = 70;        // metres ahead that a tunnel mouth appears
const TUNNEL_MIN_SECONDS = 5;  // shortest time spent inside one

export function createDirector({ params, reducedMotion = false }) {
  const baseSeed = hashString(params.seed || String(Date.now()));
  const state = {
    seed: baseSeed,
    travelled: 0,           // metres along the track
    speed: 0,               // metres per second
    rate: 1,                // 0..1 from the distraction mechanic
    cruise: (params.kmh / 3.6) * (reducedMotion ? 0.4 : 1),
    hour: params.hour >= 0 ? params.hour : 12,   // placed in a slot just below
    slot: '',
    level: params.level,
    dials: { ...LEVELS[params.level] },
    biome: BIOMES[params.biome] ? params.biome : DEFAULT_BIOME,
    profile: null,
    dissolve: 0,            // shader "matter" amount, 0..1
    breath: 0,              // shader scale pulse from the bass
    beat: 0,                // 0..1, jumps on each onset and decays quickly
    sparkle: 0,             // 0..1, lifts when the treble rises above its recent average
    trebleNow: 0,
    trebleAvg: 0,
    beatMetres: 56,         // mast spacing; follows tempo when audio is available
    energy: 0,              // slow loudness, 0..1
    bpm: 0,                 // last trusted tempo, for the debug readout
    tunnel: null,           // { x0, x1, phase: 'approach' | 'inside' | 'leaving', next: {biome, seed} }
    queued: null,           // a change waiting for the current tunnel to finish
    time: 0,
  };
  const listeners = { swap: [] };
  const recent = [];   // the kinds of scenery shown lately, newest last (see chooseBiome)
  const seen = (b) => { if (recent[recent.length - 1] !== b) { recent.push(b); if (recent.length > 4) recent.shift(); } };
  let hourDir = 1;   // which way the clock runs for a biome that holds it inside its hours

  // Each change of scenery arrives at a time of day drawn from these slots, so journeys spend real
  // time in the low light of dawn and dusk and not only at midday. A biome can ask for its own
  // window with { hours: [from, to] } (the night city does; add holdHours: true to keep the clock
  // inside it for as long as the biome lasts, as the motorway does) or reweight the slots with
  // { slots: { dawn, day, dusk, night } }. `slot=` in the URL forces one; `hour=` pins the clock.
  function placeHour() {
    const b = BIOMES[state.biome];
    if (params.hour >= 0) return;
    const roll = ((state.seed >>> 8) % 1000) / 1000, roll2 = ((state.seed >>> 18) % 1000) / 1000;
    let range = null;
    if (SLOTS[params.slot]) { range = SLOTS[params.slot]; state.slot = params.slot; }
    else if (b && b.hours) { range = b.hours; state.slot = 'biome'; }
    else {
      const w = { ...SLOT_WEIGHTS, ...((b && b.slots) || {}) };
      const total = Object.values(w).reduce((x, y) => x + y, 0);
      let pick = roll * total;
      for (const name of Object.keys(w)) { if (pick < w[name]) { range = SLOTS[name]; state.slot = name; break; } pick -= w[name]; }
      if (!range) { range = SLOTS.day; state.slot = 'day'; }
    }
    const [from, to] = range;
    state.hour = (from + ((to - from + 24) % 24) * roll2) % 24;
  }
  placeHour();
  seen(state.biome);

  // Which scenery next. The channel's profile lists the kinds that suit its music, best fit first
  // (weights 3, 2, 1, 1). Kinds close in character to those (NEIGHBOURS) join at weight 1, so that
  // even a channel with one kind has somewhere else to go. With `fresh`, anything seen in the last
  // few changes is left out, as far as the list allows: the last three, else two, else one.
  function chooseBiome(seed, fresh = false) {
    if (params.biome && BIOMES[params.biome]) return params.biome;
    const pool = (state.profile && state.profile.biomes && state.profile.biomes.filter((b) => BIOMES[b])) || [];
    let names, weights;
    if (pool.length) {
      names = [...pool]; weights = pool.map((_, i) => Math.max(1, 3 - i));
      for (const b of pool) for (const n of NEIGHBOURS[b] || []) if (BIOMES[n] && !names.includes(n)) { names.push(n); weights.push(1); }
    } else {
      names = Object.keys(BIOMES).filter((b) => b !== 'placeholder' || Object.keys(BIOMES).length === 1);
      weights = names.map(() => 1);
    }
    let keep = names.map(() => true);
    if (fresh) {
      for (let back = Math.min(3, recent.length); back >= 1; back--) {
        const avoid = recent.slice(-back);
        const k = names.map((n) => !avoid.includes(n));
        if (k.some(Boolean)) { keep = k; break; }
      }
    }
    const total = weights.reduce((x, w, i) => x + (keep[i] ? w : 0), 0);
    let pick = seed % total;
    for (let i = 0; i < names.length; i++) { if (!keep[i]) continue; if (pick < weights[i]) return names[i]; pick -= weights[i]; }
    return names[0];
  }

  // Ask for a change of scenery. It happens out of sight, inside a tunnel.
  function queueTransition(next) {
    // A tunnel whose mouth has not been reached yet simply takes the newer destination; one we are
    // already inside finishes first, and the change follows in a tunnel of its own.
    if (state.tunnel) { if (state.tunnel.phase === 'approach') state.tunnel.next = next; else state.queued = next; return; }
    const x0 = state.travelled + TUNNEL_LEAD;
    const len = Math.max(180, state.cruise * TUNNEL_MIN_SECONDS);
    state.tunnel = { x0, x1: x0 + len, phase: 'approach', next, ready: false };
  }

  return {
    state,
    on(name, fn) { listeners[name].push(fn); },
    setRate(r) { state.rate = Math.max(0, Math.min(1, r)); },

    // A channel profile: { biomes: [...], level: 0 | 1 }. See profiles.json.
    setProfile(profile, { immediate = false } = {}) {
      state.profile = profile || null;
      const seed = hashInts(baseSeed, hashString(JSON.stringify(profile || {})));
      const next = { seed, biome: chooseBiome(seed, !immediate), level: params.levelFixed ? state.level : (profile && profile.level != null ? profile.level : state.level) };
      if (immediate) { state.seed = next.seed; state.biome = next.biome; state.level = next.level; state.dials = { ...LEVELS[next.level] }; placeHour(); recent.length = 0; seen(state.biome); } else queueTransition(next);
    },

    // A new track brings new scenery: a kind not seen in the last few changes, where the channel
    // has that many to offer.
    onTrack(song) {
      if (!song || (!song.title && !song.artist)) return;
      const seed = hashInts(baseSeed & 0xffff, hashString(`${song.artist}|${song.title}`));
      queueTransition({ seed, biome: chooseBiome(seed, true), level: state.level });
    },

    // Per-frame audio features, or null when there is no signal. See audio.js.
    setAudio(f) {
      if (!f || !f.active) { state.energy *= 0.98; state.breath *= 0.9; state.trebleNow = 0; return; }
      state.energy += (f.level - state.energy) * 0.02;
      if (!reducedMotion) {
        state.breath = 0.035 * f.bass;
        // an onset (kick, snare, a struck note) starts a pulse; a harder hit starts a bigger one
        if (f.onset) state.beat = Math.max(state.beat, (0.55 + 0.45 * Math.min(1, f.flux * 2.5)) * params.beat);
        state.trebleNow = f.treble;
      }
      if (f.bpm > 40 && f.confidence > 0.6 && state.speed > 1) {   // tempo on real music is shaky: trust only firm locks
        // one mast per bar of four beats at the current speed, kept inside a believable range
        let m = state.cruise * (240 / f.bpm);
        while (m > 80) m /= 2;
        while (m < 28) m *= 2;
        state.beatMetres = m;
        state.bpm = f.bpm;
      }
    },

    // The engine calls this when the world has been rebuilt behind the tunnel wall.
    worldReady() { if (state.tunnel) state.tunnel.ready = true; },

    update(dt) {
      state.time += dt;
      const target = state.cruise * state.rate;
      const tau = target < state.speed ? 0.5 : 1.6;     // brakes faster than it pulls away
      state.speed += (target - state.speed) * (1 - Math.exp(-dt / tau));
      if (state.speed < 0.02 && target === 0) state.speed = 0;
      state.travelled += state.speed * dt;

      // the clock: about an hour every 20 minutes at the plausible level, every 20 seconds at the dreamlike one
      // A stopped train holds the whole view still: the clock waits and the music stops moving the
      // scenery, so the engine can redraw it rarely (see its idle mode) and the picture stands sharp.
      const still = state.speed === 0 && state.rate === 0;
      if (params.hour < 0 && !still) {
        const step = dt * (state.dials.time * 0.05 + 0.0002);
        const b = BIOMES[state.biome];
        if (b && b.holdHours && b.hours && !SLOTS[params.slot]) {
          // This biome only works inside its own hours (its lights are part of the scenery), so the
          // clock turns back at either end instead of running on into day.
          const from = b.hours[0], span = (b.hours[1] - from + 24) % 24;
          let pos = Math.min(span, (state.hour - from + 24) % 24) + step * hourDir;
          if (pos > span) { pos = 2 * span - pos; hourDir = -1; } else if (pos < 0) { pos = -pos; hourDir = 1; }
          state.hour = (from + pos) % 24;
        } else state.hour = (state.hour + step) % 24;
      }
      state.beat *= Math.exp(-dt / 0.17);                                   // a beat is over in a few frames
      // Treble is a level, not an event: on most music it sits at a moderate value all the time. The
      // sparkle follows only its excess over the last few seconds' average, so it rests at zero and
      // lifts on hi-hats, cymbals and bright entries.
      state.trebleAvg += (state.trebleNow - state.trebleAvg) * (1 - Math.exp(-dt / 3));
      const lift = Math.min(1, Math.max(0, (state.trebleNow - state.trebleAvg * 1.15) * 2.4)) * params.sparkle;
      state.sparkle += (lift - state.sparkle) * (1 - Math.exp(-dt / 0.1));
      const wantDissolve = reducedMotion ? 0 : state.dials.matter * Math.max(0, state.energy - 0.35) * 0.9;
      state.dissolve += (wantDissolve - state.dissolve) * Math.min(1, dt * 0.5);
      if (still) { state.beat = 0; state.sparkle = 0; state.breath = 0; }

      const t = state.tunnel;
      if (t) {
        if (t.phase === 'approach' && state.travelled > t.x0 + 12) {
          t.phase = 'inside';
          state.seed = t.next.seed; state.biome = t.next.biome; state.level = t.next.level;
          seen(state.biome);
          state.dials = { ...LEVELS[state.level] };
          placeHour();
          for (const fn of listeners.swap) fn(t.next);
        }
        if (t.phase === 'inside') {
          // keep the far portal out of sight until the new world exists
          if (!t.ready) t.x1 = Math.max(t.x1, state.travelled + 60);
          else if (state.travelled > t.x1 - 12) t.phase = 'leaving';
        }
        if (t.phase === 'leaving' && state.travelled > t.x1 + 20) {
          state.tunnel = null;
          if (state.queued) { const q = state.queued; state.queued = null; queueTransition(q); }
        }
      }
    },
    queueTransition,
    rng: (salt = 0) => makeRng(hashInts(state.seed, salt)),
  };
}
