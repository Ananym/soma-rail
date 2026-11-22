// Photo pieces: one-sided sheets of splats made from CC0 photos (see scripts/photo-to-splats.mjs
// and public/kit/index.json). They give the view its photographic half; the code-made biomes give
// the rest. A piece is authored for exactly this camera, so it is placed by sliding it along the
// track (x), pushing it further away (z) and lifting it onto the terrain (y); it is never rotated.
import { hashInts } from './rng.js';

// Which pieces each biome uses. `every` is the average spacing along the track in metres,
// `push` a range of extra distance from the track, `chance` how many slots are filled.
export const KIT_RULES = {
  downs: [
    // The woodland edge is a sheet cut from a panorama, and its right-hand end is a straight cut
    // through the trees. `mirror` stands a reflected copy against that end, so the wood closes
    // with its own ragged left edge on both sides.
    { id: 'treeline-meadow', every: 900, push: [0, 90], chance: 0.8, mirror: 'right' },
    { id: 'town-edge', every: 1900, push: [0, 60], chance: 0.75 },
  ],
  // Only pieces that were looked at in place are switched on. Tried and left out: 'orchard-field'
  // in downs and 'conifer-pasture' in pinewood (both read as pasted cut-outs beside the code-made
  // trees). Not yet tried in place: 'mountain-lake' (pinewood) and 'mountain-range' (saltflat).
  pinewood: [],
  saltflat: [],
  nightcity: [],
  himalaya: [],
  motorway: [],
  winter: [],
  fuji: [],
  tropics: [],
  placeholder: [],
};

import { clearTags, tagLast } from './sparkPatch.js';

export function createKit({ THREE, SplatMesh, PackedSplats, scene, baseUrl = '/' }) {
  let index = null;                 // id -> piece metadata, once index.json has loaded
  const packs = new Map();          // id -> { packed, ready }
  const live = new Map();           // `${id}:${slot}` -> { mesh, x, y, z }
  let failed = false;

  fetch(`${baseUrl}kit/index.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then((d) => { index = new Map(d.pieces.map((p) => [p.id, p])); })
    .catch((e) => { failed = true; console.warn('[train window] photo kit unavailable:', e); });

  // A reflected copy of a pack about its own right-hand (or left-hand) end. The end is taken a
  // little inside the outermost splats, so the two halves overlap and no seam shows.
  function mirrored(src, side) {
    const xs = [];
    src.forEachSplat((i, c) => { if (i % 16 === 0) xs.push(c.x); });
    xs.sort((a, b) => a - b);
    const edge = side === 'left' ? xs[Math.floor(xs.length * 0.01)] : xs[Math.floor(xs.length * 0.99)];
    const out = new PackedSplats();
    out.ensureSplats(src.numSplats);
    const c2 = new THREE.Vector3(), q2 = new THREE.Quaternion();
    src.forEachSplat((i, c, sc, q, opacity, color) => {
      if (side === 'left' ? c.x < edge : c.x > edge) return;       // beyond the mirror line: leave out
      c2.set(2 * edge - c.x, c.y, c.z); q2.set(q.x, -q.y, -q.z, q.w);   // reflect in x: position and rotation
      out.pushSplat(c2, sc, q2, opacity, color); tagLast(out);
    });
    return out;
  }

  function pack(id, mirror) {
    let p = packs.get(id);
    if (!p) {
      p = { packed: new PackedSplats({ url: `${baseUrl}kit/${index.get(id).file}` }), ready: false };
      // a file's colour bytes are arbitrary: clear the motion-class bits so nothing in it moves
      p.packed.initialized.then(() => { clearTags(p.packed); if (mirror) p.mirror = mirrored(p.packed, mirror); p.ready = true; }).catch(() => { p.failed = true; });
      packs.set(id, p);
    }
    return p;
  }

  function drop(key) {
    const inst = live.get(key);
    if (inst.mesh) { scene.remove(inst.mesh); inst.mesh.dispose(); }
    if (inst.mesh2) { scene.remove(inst.mesh2); inst.mesh2.dispose(); }
    live.delete(key);
  }

  return {
    // Called every frame: keeps the pieces near the camera alive and positioned.
    update({ travelled, biomeName, terrain, seed, tanHalfHfov, lead }) {
      if (!index) return;
      const rules = KIT_RULES[biomeName] || [];
      const wanted = new Set();
      for (const rule of rules) {
        const meta = index.get(rule.id);
        if (!meta) continue;
        const salt = hashInts(seed, meta.splats);
        // how far along the track the piece can be and still be in view
        const reach = (meta.depthRange[1] + rule.push[1]) * tanHalfHfov * 1.1 + meta.widthMetres / 2 + lead;
        const first = Math.floor((travelled - reach) / rule.every), last = Math.floor((travelled + reach) / rule.every);
        for (let slot = first; slot <= last; slot++) {
          const h = hashInts(salt, slot);
          if ((h & 0xffff) / 65536 >= rule.chance) continue;
          const x = (slot + 0.15 + 0.7 * ((h >>> 16) / 65536)) * rule.every;
          const push = rule.push[0] + (rule.push[1] - rule.push[0]) * (((h >>> 8) & 0xff) / 255);
          const depth = meta.medianDepth + push;
          if (Math.abs(x - travelled) > depth * tanHalfHfov * 1.1 + meta.widthMetres / 2 + lead) continue;
          const key = `${rule.id}:${slot}`;
          wanted.add(key);
          if (!live.has(key)) {
            // Stand the piece on the terrain where it lands. Pieces with a known ground plane meet the
            // ground there; far pieces without one simply sit at the terrain's height.
            const ground = terrain.height(x, depth);
            const y = meta.groundY != null ? ground - meta.groundY : ground;
            live.set(key, { id: rule.id, x, y, z: -push, mesh: null, mesh2: null, mirror: rule.mirror || null });
          }
        }
      }
      for (const key of [...live.keys()]) if (!wanted.has(key)) drop(key);
      for (const inst of live.values()) {
        if (!inst.mesh) {
          const p = pack(inst.id, inst.mirror);
          if (!p.ready) continue;
          inst.mesh = new SplatMesh({ packedSplats: p.packed });
          scene.add(inst.mesh);
          if (p.mirror) { inst.mesh2 = new SplatMesh({ packedSplats: p.mirror }); scene.add(inst.mesh2); }
        }
        inst.mesh.position.set(inst.x - travelled, inst.y, inst.z);
        if (inst.mesh2) inst.mesh2.position.copy(inst.mesh.position);
      }
    },
    // The world changed (new biome or seed): every placement is stale.
    reset() { for (const key of [...live.keys()]) drop(key); },
    stats() { let n = 0; for (const i of live.values()) if (i.mesh) n++; return { pieces: n, failed }; },
    instances() { return [...live.values()].map((i) => ({ id: i.id, x: Math.round(i.x), y: +i.y.toFixed(1), push: Math.round(-i.z), loaded: !!i.mesh })); },
    dispose() { this.reset(); for (const p of packs.values()) { p.packed.dispose(); if (p.mirror) p.mirror.dispose(); } packs.clear(); },
  };
}
