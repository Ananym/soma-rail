// The director: slow state that decides what the journey is. It owns distance travelled, speed,
// time of day, the surreal dials and when the scenery changes. Inputs are attention (rate),
// music (audio features, track and channel) and the seed. It never touches the renderer.
import { hashString, hashInts, makeRng } from './rng.js';
import { BIOMES, DEFAULT_BIOME } from './biomes/index.js';

// Surreal levels: each is one setting of all five dials, tuned as a whole.
export const LEVELS = [
  { name: 'plausible', scale: 0, topology: 0, matter: 0, time: 0.03, logic: 0 },
  { name: 'dreamlike', scale: 0.8, topology: 0.6, matter: 0.5, time: 1, logic: 0.3 },
];

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
    hour: params.hour >= 0 ? params.hour : 8 + (baseSeed % 800) / 100,   // start between 08:00 and 16:00
    level: params.level,
    dials: { ...LEVELS[params.level] },
    biome: BIOMES[params.biome] ? params.biome : DEFAULT_BIOME,
    profile: null,
    dissolve: 0,            // shader "matter" amount, 0..1
    breath: 0,              // shader scale pulse
    beatMetres: 56,         // mast spacing; follows tempo when audio is available
    energy: 0,              // slow loudness, 0..1
    bpm: 0,                 // last trusted tempo, for the debug readout
    tunnel: null,           // { x0, x1, phase: 'approach' | 'inside' | 'leaving', next: {biome, seed} }
    queued: null,           // a change waiting for the current tunnel to finish
    time: 0,
  };
  const listeners = { swap: [] };

  // A biome may prefer part of the day (a night city, a dawn marsh): { hours: [from, to] }.
  // Called whenever the scenery changes.
  function placeHour() {
    const b = BIOMES[state.biome];
    if (params.hour >= 0 || !b) return;
    const roll = ((state.seed >>> 8) % 1000) / 1000;
    if (b.hours) {
      const [from, to] = b.hours;
      state.hour = (from + ((to - from + 24) % 24) * roll) % 24;
    } else if (state.level === 0 && (state.hour < 6.5 || state.hour > 19.5)) {
      // Leaving a night biome at the plausible level: come out of the tunnel into daylight rather
      // than spend an hour of real time in the dark. (The dreamlike level cycles the day quickly.)
      state.hour = 8 + 9 * roll;
    }
  }

  function chooseBiome(seed) {
    const pool = (state.profile && state.profile.biomes && state.profile.biomes.filter((b) => BIOMES[b])) || [];
    const names = pool.length ? pool : Object.keys(BIOMES).filter((b) => b !== 'placeholder' || Object.keys(BIOMES).length === 1);
    if (params.biome && BIOMES[params.biome]) return params.biome;
    // Profiles list biomes best fit first: weight them 3, 2, 1 so the best fit shows most often.
    const weights = names.map((_, i) => Math.max(1, 3 - i));
    let pick = seed % weights.reduce((x, y) => x + y, 0);
    for (let i = 0; i < names.length; i++) { if (pick < weights[i]) return names[i]; pick -= weights[i]; }
    return names[0];
  }

  // Ask for a change of scenery. It happens out of sight, inside a tunnel.
  function queueTransition(next) {
    if (state.tunnel) { state.queued = next; return; }
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
      const next = { seed, biome: chooseBiome(seed), level: params.levelFixed ? state.level : (profile && profile.level != null ? profile.level : state.level) };
      if (immediate) { state.seed = next.seed; state.biome = next.biome; state.level = next.level; state.dials = { ...LEVELS[next.level] }; placeHour(); } else queueTransition(next);
    },

    // A new track: the same track always brings the same scenery.
    onTrack(song) {
      if (!song || (!song.title && !song.artist)) return;
      const seed = hashInts(baseSeed & 0xffff, hashString(`${song.artist}|${song.title}`));
      queueTransition({ seed, biome: chooseBiome(seed), level: state.level });
    },

    // Per-frame audio features, or null when there is no signal. See audio.js.
    setAudio(f) {
      if (!f || !f.active) { state.energy *= 0.98; state.breath *= 0.9; return; }
      state.energy += (f.level - state.energy) * 0.02;
      if (!reducedMotion) state.breath = 0.035 * f.bass;
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

      if (params.hour < 0) state.hour = (state.hour + dt * (state.dials.time * 0.05 + 0.0006)) % 24;
      const wantDissolve = reducedMotion ? 0 : state.dials.matter * Math.max(0, state.energy - 0.35) * 0.9;
      state.dissolve += (wantDissolve - state.dissolve) * Math.min(1, dt * 0.5);

      const t = state.tunnel;
      if (t) {
        if (t.phase === 'approach' && state.travelled > t.x0 + 12) {
          t.phase = 'inside';
          state.seed = t.next.seed; state.biome = t.next.biome; state.level = t.next.level;
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
