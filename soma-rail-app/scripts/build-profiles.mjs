#!/usr/bin/env node
// Builds src/window/profiles.json: for every SomaFM channel, which train-window
// biomes suit its music (best fit first) and how surreal the view should be.
//
//   node scripts/build-profiles.mjs
//
// Decisions come from two tables below, nothing else:
//   1. RULES     - keyword rules over genre + title + description, first match wins.
//   2. OVERRIDES - per-channel answers (by id) where keywords get it wrong.
// Re-runnable: output is sorted by id and formatted deterministically.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const URL_CHANNELS = 'https://api.somafm.com/channels.json';
// SomaFM answers 403 to non-browser agents. No Referer is sent (they reject those too).
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'window', 'profiles.json');

const BIOMES = ['downs', 'pinewood', 'saltflat', 'nightcity', 'karst', 'dunes', 'himalaya', 'motorway'];
const DEFAULT = { biomes: ['downs', 'pinewood'], level: 0 };

// ---- Rule table: first match wins, so order is priority. -------------------
// level 1 = dreamlike (spacey, psychedelic, drone, glitchy); 0 = plausible.
const RULES = [
  { re: /\bspace\b|nasa|cosmic|kosmische|astronaut/, biomes: ['saltflat', 'pinewood'], level: 1, why: 'space music over big open sky' },
  { re: /drone|abyss|dark(er)? .*ambient|deep ambient/, biomes: ['pinewood', 'saltflat'], level: 1, why: 'drone and dark ambient: mist, cold, emptiness' },
  { re: /vaporwave|\bidm\b|glitch/, biomes: ['nightcity', 'saltflat'], level: 1, why: 'glitchy synthetic music, dreamlike neon' },
  { re: /holiday|christmas|xmas|winter/, biomes: ['pinewood', 'downs'], level: 0, why: 'winter holiday music' },
  { re: /celtic|nordic|scandinav/, biomes: ['pinewood', 'downs'], level: 0, why: 'Celtic/Nordic roots' },
  { re: /secret agent|spies|cyber|hack|police|scanner/, biomes: ['nightcity'], level: 0, why: 'spies, hackers and city radio' },
  { re: /house|techno|drum ?(&|n|and) ?bass|dubstep|trance|synthpop|new wave|hip-?hop|industrial|metal/, biomes: ['nightcity'], level: 0, why: 'electronic, urban or heavy music' },
  { re: /americana|country|desert|playa|tiki|exotica|surf|cowboy|cowhand/, biomes: ['saltflat', 'downs'], level: 0, why: 'roots, desert or exotica sound' },
  { re: /folk|acoustic|indie|bossa|soul|jazz|lounge|reggae|oldies|\b[567]0s\b|covers/, biomes: ['downs'], level: 0, why: 'warm, earthly, song-based music' },
  { re: /ambient|chill|downtempo/, biomes: ['downs', 'pinewood'], level: 0, why: 'chilled ambient and downtempo' },
  { re: /post-rock|experimental/, biomes: ['pinewood', 'saltflat'], level: 1, why: 'experimental and post-rock' },
];

// ---- Per-channel overrides (reviewed by hand against each description). ----
const o = (biomes, level, why) => ({ biomes, level, why });
const OVERRIDES = {
  beatblender: o(['nightcity', 'motorway', 'saltflat'], 0, 'late-night deep house and downtempo'),
  bossa: o(['downs'], 0, 'laid-back Brazilian bossa nova and samba'),
  covers: o(['downs'], 0, 'familiar songs, warm and earthly'),
  dubstep: o(['nightcity', 'motorway'], 0, 'dubstep, dub and deep bass'),
  folkfwd: o(['downs'], 0, 'indie folk and alt-folk'),
  indiepop: o(['downs', 'motorway'], 0, 'bright indie pop'),
  poptron: o(['nightcity', 'downs'], 0, 'electropop and indie dance rock'),
  reggae: o(['downs'], 0, 'reggae, ska and rocksteady, sunny and earthy'),
  bootliquor: o(['saltflat', 'dunes', 'downs'], 0, 'americana roots: dusty flats, desert and farmland'),
  brfm: o(['dunes', 'saltflat', 'nightcity'], 1, 'Black Rock playa: desert by day, lights by night'),
  christmas: o(['pinewood', 'downs'], 0, 'chilled winter lounge'),
  chillits: o(['pinewood', 'karst', 'himalaya', 'downs'], 0, 'chill and camping: forest, misty valleys'),
  cliqhop: o(['nightcity', 'saltflat'], 1, 'glitchy IDM blips and beats'),
  darkzone: o(['pinewood', 'himalaya', 'dunes', 'saltflat'], 1, 'dark deep ambient, staring into the abyss'),
  deepspaceone: o(['saltflat', 'motorway', 'himalaya', 'dunes'], 1, 'deep ambient and space music: empty country'),
  defcon: o(['nightcity'], 0, 'hacker music, neon and screens'),
  deptstore: o(['downs', 'nightcity'], 0, 'vintage elevator music, shop windows'),
  digitalis: o(['downs', 'motorway', 'nightcity'], 0, 'calm, slightly electric analog rock'),
  doomed: o(['nightcity', 'pinewood'], 1, 'dark industrial ambient for tortured souls'),
  dronezone: o(['pinewood', 'himalaya', 'karst', 'saltflat'], 1, 'atmospheric drone textures: forest and mist'),
  dz2: o(['karst', 'pinewood', 'saltflat'], 1, 'eclectic atmospheric drone textures: mist and stone'),
  fluid: o(['nightcity'], 0, 'instrumental hip hop, future soul, liquid trap'),
  groovesalad: o(['downs', 'karst', 'pinewood'], 0, 'chilled ambient downtempo'),
  groovesalad2: o(['karst', 'himalaya', 'downs', 'saltflat'], 0, 'chilled ambient downtempo, other mix'),
  gsclassic: o(['downs', 'motorway', 'nightcity'], 0, 'early-2000s chilled downtempo'),
  illstreet: o(['nightcity', 'saltflat'], 0, 'bachelor-pad lounge and exotica'),
  insound: o(['downs', 'saltflat'], 1, '60s/70s psychedelic Euro pop'),
  jollysoul: o(['downs', 'pinewood'], 0, 'holiday soul'),
  live: o(['nightcity', 'downs'], 0, 'live events, mixed bag'),
  lush: o(['karst', 'motorway', 'nightcity', 'downs'], 0, 'mellow vocals with electronic edges: soft, misty'),
  metal: o(['nightcity', 'pinewood'], 0, 'metal from black to doom to industrial'),
  missioncontrol: o(['saltflat', 'dunes'], 1, 'NASA and space exploration: other-worldly ground'),
  n5md: o(['pinewood', 'himalaya', 'karst', 'saltflat'], 1, 'post-rock, ambient and experimental electronic'),
  scanner: o(['nightcity'], 0, 'San Francisco police scanner'),
  seventies: o(['downs', 'saltflat'], 0, 'mellow West Coast 70s album rock'),
  sf1033: o(['nightcity'], 0, 'ambient mixed with San Francisco emergency radio'),
  sfinsf: o(['pinewood', 'nightcity'], 1, 'sci-fi, fantasy and horror readings'),
  sonicuniverse: o(['nightcity', 'saltflat'], 1, 'avant-garde, eclectic jazz'),
  specials: o(['downs', 'nightcity'], 0, 'varied specials: jazz, surf, dub'),
  spacestation: o(['dunes', 'motorway', 'saltflat', 'nightcity'], 1, 'spaced-out ambient and mid-tempo electronica'),
  suburbsofgoa: o(['himalaya', 'dunes', 'saltflat'], 0, 'Desi-influenced world beats'),
  synphaera: o(['saltflat', 'himalaya', 'dunes', 'pinewood'], 1, 'modern electronic ambient and space music'),
  thetrip: o(['nightcity', 'motorway', 'dunes', 'saltflat'], 0, 'progressive house and trance'),
  tikitime: o(['saltflat', 'downs'], 0, 'tiki exotica and island rhythms'),
  u80s: o(['nightcity', 'motorway'], 0, 'early 80s synthpop and new wave'),
  vaporwaves: o(['nightcity', 'saltflat'], 1, 'all vaporwave'),
  xmasinfrisko: o(['nightcity', 'pinewood', 'himalaya'], 0, 'wacky eclectic holiday mix'),
  xmasrocks: o(['pinewood', 'himalaya', 'nightcity'], 0, 'indie/alternative holiday rock'),
  '7soul': o(['downs', 'nightcity'], 0, 'vintage 45 RPM soul'),
};

// ---- Fetching ---------------------------------------------------------------
async function fetchChannels() {
  try {
    const res = await fetch(URL_CHANNELS, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    // Node's fetch ignores HTTPS_PROXY; curl honours it.
    console.warn(`fetch failed (${err.message}); falling back to curl`);
    const body = execFileSync('curl', ['-sS', '-f', '-A', UA, URL_CHANNELS], { encoding: 'utf8', maxBuffer: 32 << 20 });
    return JSON.parse(body);
  }
}

function classify(ch) {
  if (OVERRIDES[ch.id]) return { ...OVERRIDES[ch.id], source: 'override' };
  const text = `${ch.genre || ''} ${ch.title || ''} ${ch.description || ''}`.toLowerCase();
  const rule = RULES.find((r) => r.re.test(text));
  if (rule) return { biomes: rule.biomes, level: rule.level, why: rule.why, source: 'rule' };
  return { ...DEFAULT, why: 'no rule matched; default', source: 'none' };
}

const data = await fetchChannels();
const channels = [...data.channels].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
const out = { _default: DEFAULT };
const unmatched = [];
const perBiome = {}, perLevel = { 0: 0, 1: 0 };
for (const ch of channels) {
  const p = classify(ch);
  if (p.source === 'none') unmatched.push(ch.id);
  out[ch.id] = { biomes: p.biomes, level: p.level, title: ch.title, why: p.why };
  for (const b of p.biomes) perBiome[b] = (perBiome[b] || 0) + 1;
  perLevel[p.level]++;
}

// One line per channel keeps diffs readable.
const lines = Object.entries(out).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
writeFileSync(OUT, `{\n${lines.join(',\n')}\n}\n`);

// ---- Sanity checks ----------------------------------------------------------
const problems = [];
for (const ch of channels) {
  const p = out[ch.id];
  if (!p) { problems.push(`missing ${ch.id}`); continue; }
  if (!p.biomes.length || p.biomes.length > 4 || p.biomes.some((b) => !BIOMES.includes(b))) problems.push(`bad biomes for ${ch.id}`);
  if (p.level !== 0 && p.level !== 1) problems.push(`bad level for ${ch.id}`);
}
for (const id of Object.keys(OVERRIDES)) if (!channels.some((c) => c.id === id)) problems.push(`override for unknown channel ${id}`);

console.log(`${channels.length} channels written to ${OUT}`);
console.log('per biome:', BIOMES.map((b) => `${b}=${perBiome[b] || 0}`).join(' '));
console.log(`per level: 0=${perLevel[0]} 1=${perLevel[1]}`);
console.log('matched no rule (default used):', unmatched.length ? unmatched.join(', ') : 'none');
if (problems.length) { console.error('PROBLEMS:\n' + problems.join('\n')); process.exit(1); }
