// The renderer for the generated train window. Owns the three.js scene, the Spark splat renderer,
// the chunk rings for each depth band and the frame loop. Imported lazily, after the Start click,
// so three.js and Spark stay out of the main bundle.
import * as THREE from 'three';
import { SparkRenderer, SplatMesh, PackedSplats } from '@sparkjsdev/spark';
import { LAYERS, CAMERA_HEIGHT, neededChunks, expectedActive } from './layers.js';
import { makeTerrain } from './terrain.js';
import { getBiome, BIOMES } from './biomes/index.js';
import { createSky } from './sky.js';
import { createFrame } from './frame.js';
import { createDirector } from './director.js';
import { buildVertexShader, PATCH_UNIFORMS } from './sparkPatch.js';
import { hashInts, makeRng } from './rng.js';
import { createKit } from './kitPieces.js';

const LEAD = 60;           // metres of track generated beyond the edge of view
const TUNNEL_Z = -2.2;     // the tunnel wall sits this far from the eye

export function createEngine({ canvas, params, reducedMotion = false, profile = null }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!params.preserve });
  if (!renderer.capabilities.isWebGL2) { renderer.dispose(); throw new Error('WebGL2 is not available'); }
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(params.fov, 16 / 9, 0.05, 60000);
  camera.position.set(0, CAMERA_HEIGHT, 0);
  scene.add(camera);

  // --- splat renderer, with the blur / haze / light patch ---------------------------------------
  const uniforms = PATCH_UNIFORMS();
  uniforms.uHazeColor.value = new THREE.Color(0.7, 0.78, 0.86);
  uniforms.uHazeHigh.value = new THREE.Color(0.6, 0.72, 0.86);
  uniforms.uLightTint.value = new THREE.Color(1, 1, 1);
  uniforms.uBlurKeep.value = params.blurKeep;
  // A side-window camera only translates sideways, so depth order never changes: sort by depth.
  const spark = new SparkRenderer({ renderer, sortRadial: false, extraUniforms: uniforms });
  const patched = buildVertexShader(spark.material.vertexShader);
  let shaderPatched = false;
  if (patched) {
    spark.material.vertexShader = patched;
    for (const k of Object.keys(uniforms)) spark.material.uniforms[k] = uniforms[k];
    spark.material.needsUpdate = true;
    shaderPatched = true;
  } else {
    console.warn('[train window] Spark shader anchors not found; running without motion blur and haze');
  }
  scene.add(spark);

  // --- sky, frame, director ----------------------------------------------------------------------
  const sky = createSky(THREE);
  scene.add(sky.object3d);
  // Below the horizon and behind the splats: a ground-coloured backdrop, so any thin spot in the
  // land reads as more land and never as sky. The camera is level, so the horizon is mid-screen.
  const underlayUniforms = { uGround: { value: new THREE.Color(0.3, 0.38, 0.2) }, uHaze: uniforms.uHazeColor, uTint: uniforms.uLightTint };
  const underlay = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: underlayUniforms, depthTest: false, depthWrite: false,   // opaque pass, right after the sky
    vertexShader: 'varying float vDown; void main() { vDown = 0.5 - 0.5 * position.y; gl_Position = vec4(position.x, position.y * 0.5 - 0.5, 1.0, 1.0); }',
    fragmentShader: 'varying float vDown; uniform vec3 uGround; uniform vec3 uHaze; uniform vec3 uTint; void main() { vec3 c = mix(uHaze, uGround * uTint, smoothstep(0.0, 0.3, vDown)); gl_FragColor = vec4(c, 1.0); }',
  }));
  underlay.frustumCulled = false; underlay.renderOrder = -999;
  scene.add(underlay);
  const setUnderlay = (b) => { const g = (b.palette && (b.palette.underlay || b.palette.ground)) || [0.3, 0.38, 0.2]; underlayUniforms.uGround.value.setRGB(g[0], g[1], g[2]); };
  const frame = createFrame(THREE);
  if (params.frame) camera.add(frame.object3d);
  const director = createDirector({ params, reducedMotion });
  if (profile) director.setProfile(profile, { immediate: true });   // the channel picks where the journey starts
  const S = director.state;

  // --- tunnel: an opaque wall close to the glass, with lamps as splats so they streak ------------
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x060606 }));
  wall.visible = false;
  scene.add(wall);
  const lampSegments = [];   // { x0, mesh, packed }
  const LAMP_SEG = 120;

  function makeLampSegment(x0) {
    const packed = new PackedSplats();
    const rng = makeRng(hashInts(S.seed, 99, Math.floor(x0)));
    const c = new THREE.Vector3(), s = new THREE.Vector3(), q = new THREE.Quaternion(), col = new THREE.Color();
    for (let x = 0; x < LAMP_SEG; x += 15) {                    // lamps
      c.set(x, CAMERA_HEIGHT + 0.9, TUNNEL_Z + 0.08); s.set(0.16, 0.07, 0.02); col.setRGB(1.0, 0.82, 0.55);
      packed.pushSplat(c, s, q, 1, col);
      c.set(x, CAMERA_HEIGHT + 0.9, TUNNEL_Z + 0.06); s.set(0.5, 0.3, 0.02); col.setRGB(1.0, 0.7, 0.4);
      packed.pushSplat(c, s, q, 0.3, col);
    }
    for (let i = 0; i < 260; i++) {                              // wall grain, so speed still reads
      c.set(rng() * LAMP_SEG, CAMERA_HEIGHT + rng.range(-1.6, 1.6), TUNNEL_Z + 0.04);
      s.set(rng.range(0.05, 0.3), rng.range(0.02, 0.09), 0.02);
      const g = rng.range(0.05, 0.13); col.setRGB(g, g * 0.95, g * 0.9);
      packed.pushSplat(c, s, q, 0.8, col);
    }
    const mesh = new SplatMesh({ packedSplats: packed });
    scene.add(mesh);
    return { x0, mesh, packed };
  }

  function updateTunnel() {
    const t = S.tunnel;
    if (!t) {
      wall.visible = false;
      while (lampSegments.length) { const seg = lampSegments.pop(); scene.remove(seg.mesh); seg.mesh.dispose(); seg.packed.dispose(); }
      return;
    }
    wall.visible = true;
    wall.scale.set(t.x1 - t.x0, 14, 1);
    wall.position.set((t.x0 + t.x1) / 2 - S.travelled, CAMERA_HEIGHT, TUNNEL_Z);
    const lastEnd = lampSegments.length ? lampSegments[lampSegments.length - 1].x0 + LAMP_SEG : t.x0 + 6;
    if (lastEnd + LAMP_SEG <= t.x1 - 4 && lastEnd < S.travelled + 40) lampSegments.push(makeLampSegment(lastEnd));
    for (const seg of lampSegments) seg.mesh.position.set(seg.x0 - S.travelled, 0, 0);
  }

  // --- world: chunk rings per depth band -----------------------------------------------------------
  let biome = getBiome(S.biome);
  let terrain = makeTerrain(S.seed, biome.terrain);
  setUnderlay(biome);
  let tanHalfHfov = 1;
  const chunks = new Map();     // key `${layer}:${index}` -> chunk
  let epoch = 0;                // bumps on every rebuild; stale chunks are dropped
  // Mast spacing follows the music's tempo, but it is fixed for each world: masts and wires only
  // meet at chunk borders if every chunk agrees on the spacing.
  let worldBeat = S.beatMetres;

  const tmp = { c: new THREE.Vector3(), s: new THREE.Vector3(), q: new THREE.Quaternion(), col: new THREE.Color() };

  function startChunk(layer, index) {
    const x0 = index * layer.chunkLen;
    const count = Math.max(200, Math.round((params.budget * layer.share) / expectedActive(layer, tanHalfHfov, LEAD)));
    const packed = new PackedSplats();
    let n = 0;
    const emit = (x, y, z, sx, sy, sz, r, g, b, opacity = 1, qx = 0, qy = 0, qz = 0, qw = 1) => {
      tmp.c.set(x, y, z); tmp.s.set(sx, sy, sz); tmp.q.set(qx, qy, qz, qw); tmp.col.setRGB(r, g, b);
      packed.pushSplat(tmp.c, tmp.s, tmp.q, opacity, tmp.col); n++;
    };
    const ctx = {
      rng: makeRng(hashInts(S.seed, layer.name.length * 131 + layer.name.charCodeAt(0), index)),
      x0, length: layer.chunkLen, zNear: layer.zNear, zFar: layer.zFar, count, index,
      terrain, palette: biome.palette, dials: S.dials, level: S.level, beatMetres: worldBeat, layer: layer.name,
      seed: S.seed, hour: S.hour,
    };
    const gen = (biome.generators[layer.name] || biome.generators.near)(ctx, emit);
    const chunk = { layer, index, x0, packed, gen, mesh: null, done: false, epoch, count: () => n };
    chunks.set(`${layer.name}:${index}`, chunk);
    return chunk;
  }

  function dropChunk(key) {
    const ch = chunks.get(key);
    if (!ch) return;
    if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.dispose(); }
    ch.packed.dispose();
    chunks.delete(key);
  }

  function manageChunks() {
    const wanted = new Set();
    for (const layer of LAYERS) {
      const { first, last } = neededChunks(layer, S.travelled, tanHalfHfov, LEAD);
      for (let i = first; i <= last; i++) {
        const key = `${layer.name}:${i}`;
        wanted.add(key);
        if (!chunks.has(key)) startChunk(layer, i);
      }
    }
    for (const key of [...chunks.keys()]) if (!wanted.has(key)) dropChunk(key);
  }

  // Run chunk generators for a few milliseconds, nearest bands first.
  function generate(budgetMs) {
    const t0 = performance.now();
    const pending = [...chunks.values()].filter((c) => !c.done)
      .sort((a, b) => LAYERS.indexOf(a.layer) - LAYERS.indexOf(b.layer) || Math.abs(a.x0 - S.travelled) - Math.abs(b.x0 - S.travelled));
    for (const ch of pending) {
      for (;;) {
        const r = ch.gen.next();
        if (r.done) {
          ch.done = true;
          if (ch.count() > 0) { ch.mesh = new SplatMesh({ packedSplats: ch.packed }); ch.mesh.position.set(ch.x0 - S.travelled, 0, 0); scene.add(ch.mesh); }
          break;
        }
        if (performance.now() - t0 > budgetMs) return false;
      }
      if (performance.now() - t0 > budgetMs) return false;
    }
    return true;
  }

  function rebuildWorld() {
    epoch++;
    for (const key of [...chunks.keys()]) dropChunk(key);
    biome = getBiome(S.biome);
    terrain = makeTerrain(S.seed, biome.terrain);
    setUnderlay(biome);
    worldBeat = S.beatMetres;
    if (kit) kit.reset();
    rebuilding = true;
  }
  let rebuilding = false;
  director.on('swap', rebuildWorld);

  // --- photo pieces ---------------------------------------------------------------------------------
  const kit = params.kit ? createKit({ THREE, SplatMesh, PackedSplats, scene, baseUrl: import.meta.env.BASE_URL }) : null;

  // --- sizing and adaptive resolution -------------------------------------------------------------
  let resScale = Math.min(1, params.scale);
  let width = 1, height = 1;
  function resize() {
    width = canvas.clientWidth || window.innerWidth; height = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * resScale;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    tanHalfHfov = Math.tan((params.fov * Math.PI) / 360) * camera.aspect;
    frame.resize(camera.aspect, params.fov);
  }
  resize();
  window.addEventListener('resize', resize);

  let frames = 0, acc = 0, fps = 60, slowFor = 0, fastFor = 0;
  function adapt(dt) {
    frames++; acc += dt;
    if (acc >= 0.5) { fps = frames / acc; frames = 0; acc = 0; }
    if (dt > 1 / 45) { slowFor += dt; fastFor = 0; } else if (dt < 1 / 58) { fastFor += dt; slowFor = 0; }
    if (slowFor > 2 && resScale > 0.4) { resScale = Math.max(0.4, resScale * 0.85); slowFor = 0; resize(); }
    if (fastFor > 8 && resScale < Math.min(1, params.scale)) { resScale = Math.min(params.scale, resScale / 0.9); fastFor = 0; resize(); }
  }

  // --- frame loop -------------------------------------------------------------------------------------
  let last = performance.now(), running = false, disposed = false, readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  let audioProvider = null;

  function tick() {
    if (disposed) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000); last = now;

    if (audioProvider) director.setAudio(audioProvider(dt));
    director.update(running ? dt : 0);

    sky.update({ hour: S.hour, level: S.level, dials: S.dials, time: S.time, dt, aspect: camera.aspect, fovDeg: params.fov, travelled: S.travelled, speed: S.speed, energy: S.energy });
    const inTunnel = S.tunnel && S.tunnel.phase === 'inside';
    uniforms.uMotionMetres.value = S.speed * params.shutter * (reducedMotion ? 0.5 : 1);
    uniforms.uHazeColor.value.copy(sky.horizonColor);
    uniforms.uHazeHigh.value.copy(sky.hazeHighColor || sky.horizonColor);
    uniforms.uLightTint.value.copy(sky.lightTint);
    uniforms.uHazeDist.value = biome.hazeDist || 3000;
    uniforms.uDissolve.value = S.dissolve;
    uniforms.uBreath.value = S.breath;

    manageChunks();
    const allDone = generate(running ? params.slice : 12);
    if (allDone && rebuilding) { rebuilding = false; director.worldReady(); }
    if (allDone && readyResolve) { readyResolve(); readyResolve = null; }
    for (const ch of chunks.values()) if (ch.mesh) ch.mesh.position.x = ch.x0 - S.travelled;
    if (kit) kit.update({ travelled: S.travelled, biomeName: biome.name, terrain, seed: S.seed, tanHalfHfov, lead: LEAD });
    updateTunnel();
    sky.object3d.visible = !inTunnel;
    underlay.visible = !inTunnel;

    if (!reducedMotion) {
      // a little carriage movement, scaled by speed
      const k = Math.min(1, S.speed / 30);
      camera.position.y = CAMERA_HEIGHT + k * 0.006 * Math.sin(S.time * 9.1) + k * 0.004 * Math.sin(S.time * 23.7);
      camera.rotation.z = k * 0.0012 * Math.sin(S.time * 1.7);
    }
    frame.update(S.time, Math.min(1, S.speed / 30));
    renderer.render(scene, camera);
    if (running && !params.preserve) adapt(dt);   // screenshot runs keep full resolution
  }
  renderer.setAnimationLoop(tick);

  return {
    ready,                                   // resolves when the first world is fully generated
    shaderPatched,
    director,
    start() { running = true; last = performance.now(); },
    setRate(r) { director.setRate(r); },
    biomeNames() { return Object.keys(BIOMES).filter((b) => b !== 'placeholder' || Object.keys(BIOMES).length === 1); },
    setAudioProvider(fn) { audioProvider = fn; },
    stats() {
      let splats = 0, pending = 0;
      for (const ch of chunks.values()) { if (ch.done) splats += ch.count(); else pending++; }
      return { fps: Math.round(fps), splats, pending, chunks: chunks.size, resScale: +resScale.toFixed(2), kmh: Math.round(S.speed * 3.6), hour: +S.hour.toFixed(2), biome: S.biome, level: S.level, tunnel: S.tunnel ? S.tunnel.phase : '', patched: shaderPatched, energy: +S.energy.toFixed(2), bpm: Math.round(S.bpm), mast: Math.round(S.beatMetres), photos: kit ? kit.stats().pieces : 0 };
    },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      for (const key of [...chunks.keys()]) dropChunk(key);
      if (kit) kit.dispose();
      renderer.dispose();
    },
  };
}
