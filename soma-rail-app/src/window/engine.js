// The renderer for the generated train window. Owns the three.js scene, the Spark splat renderer,
// the chunk rings for each depth band and the frame loop. Imported lazily, after the Start click,
// so three.js and Spark stay out of the main bundle.
import * as THREE from 'three';
import { SparkRenderer, SplatMesh, PackedSplats } from '@sparkjsdev/spark';
import { LAYERS, CAMERA_HEIGHT, neededChunks, expectedActive, shareOf } from './layers.js';
import { makeTerrain } from './terrain.js';
import { getBiome, BIOMES } from './biomes/index.js';
import { createSky } from './sky.js';
import { createFrame } from './frame.js';
import { createDirector, LEVELS, SLOTS } from './director.js';
import { buildVertexShader, PATCH_UNIFORMS, tagLast } from './sparkPatch.js';
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
  uniforms.uFlowWith.value = new THREE.Vector3(); uniforms.uFlowAgainst.value = new THREE.Vector3();
  uniforms.uFall.value = new THREE.Vector2();
  // A side-window camera only translates sideways, so depth order never changes: sort by depth.
  const spark = new SparkRenderer({ renderer, sortRadial: false, extraUniforms: uniforms, minSortIntervalMs: params.sortMs });
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
  const underlayUniforms = { uGround: { value: new THREE.Color(0.3, 0.38, 0.2) }, uHaze: uniforms.uHazeColor, uTint: uniforms.uLightTint, uShift: { value: 0 } };
  const underlay = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: underlayUniforms, depthTest: false, depthWrite: false,   // opaque pass, right after the sky
    vertexShader: 'varying float vDown; uniform float uShift; void main() { vDown = 0.5 - 0.5 * position.y; gl_Position = vec4(position.x, -1.0 + (position.y + 1.0) * 0.5 * (1.0 - uShift), 1.0, 1.0); }',
    fragmentShader: 'varying float vDown; uniform vec3 uGround; uniform vec3 uHaze; uniform vec3 uTint; void main() { vec3 c = mix(uHaze, uGround * uTint, smoothstep(0.0, 0.3, vDown)); gl_FragColor = vec4(c, 1.0); }',
  }));
  underlay.frustumCulled = false; underlay.renderOrder = -999;
  scene.add(underlay);
  const setUnderlay = (b) => { const g = (b.palette && (b.palette.underlay || b.palette.ground)) || [0.3, 0.38, 0.2]; underlayUniforms.uGround.value.setRGB(g[0], g[1], g[2]); };
  const frame = createFrame(THREE);
  // The frame hangs from a mount whose matrix undoes the lowered horizon (see setHorizon), so the
  // window frame stays put while the view through it shifts.
  const frameMount = new THREE.Group(); frameMount.matrixAutoUpdate = false;
  camera.add(frameMount);
  if (params.frame) frameMount.add(frame.object3d);
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
      packed.pushSplat(c, s, q, 1, col); tagLast(packed);
      c.set(x, CAMERA_HEIGHT + 0.9, TUNNEL_Z + 0.06); s.set(0.5, 0.3, 0.02); col.setRGB(1.0, 0.7, 0.4);
      packed.pushSplat(c, s, q, 0.3, col); tagLast(packed);
    }
    for (let i = 0; i < 260; i++) {                              // wall grain, so speed still reads
      c.set(rng() * LAMP_SEG, CAMERA_HEIGHT + rng.range(-1.6, 1.6), TUNNEL_Z + 0.04);
      s.set(rng.range(0.05, 0.3), rng.range(0.02, 0.09), 0.02);
      const g = rng.range(0.05, 0.13); col.setRGB(g, g * 0.95, g * 0.9);
      packed.pushSplat(c, s, q, 0.8, col); tagLast(packed);
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
    const count = Math.max(200, Math.round((params.budget * shareOf(layer, biome)) / expectedActive(layer, tanHalfHfov, LEAD)));
    const packed = new PackedSplats();
    packed.ensureSplats(Math.ceil(count * 1.12));   // reserve once: growing the buffer as it fills would stall
    let n = 0;
    const beatKinds = biome.beatKinds ? new Set(biome.beatKinds) : null;   // kinds that answer the beat here
    // kind (15th) is for the checks; move (16th) is the splat's motion class (kit.js MOVE, default none)
    const emit = (x, y, z, sx, sy, sz, r, g, b, opacity = 1, qx = 0, qy = 0, qz = 0, qw = 1, kind = 0, move = 0) => {
      tmp.c.set(x, y, z); tmp.s.set(sx, sy, sz); tmp.q.set(qx, qy, qz, qw); tmp.col.setRGB(r, g, b);
      if (!move && beatKinds && beatKinds.has(kind)) move = 6;   // MOVE.BEAT
      packed.pushSplat(tmp.c, tmp.s, tmp.q, opacity, tmp.col); tagLast(packed, move); n++;
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

  // A backdrop: one great far thing that stays with the journey instead of scrolling past (a
  // biome's single mountain). The biome supplies { share, x0, length, zNear, zFar, pivot,
  // generate(ctx, emit), pose(travelled, seed, tanHalfHfov) -> { x, yaw } }: it is generated once
  // per world like a chunk, in its own coordinates, and each frame the engine stands it `x` metres
  // to the right of straight ahead and turns it by `yaw` about a vertical axis `pivot` metres out.
  const BACKDROP = { name: 'backdrop' };
  function startBackdrop() {
    const B = biome.backdrop;
    const count = Math.max(200, Math.round(params.budget * (B.share || 0.1)));
    const packed = new PackedSplats();
    packed.ensureSplats(Math.ceil(count * 1.25));
    let n = 0;
    const beatKinds = biome.beatKinds ? new Set(biome.beatKinds) : null;
    const emit = (x, y, z, sx, sy, sz, r, g, b, opacity = 1, qx = 0, qy = 0, qz = 0, qw = 1, kind = 0, move = 0) => {
      tmp.c.set(B.x0 + x, y, z + B.pivot); tmp.s.set(sx, sy, sz); tmp.q.set(qx, qy, qz, qw); tmp.col.setRGB(r, g, b);
      if (!move && beatKinds && beatKinds.has(kind)) move = 6;
      packed.pushSplat(tmp.c, tmp.s, tmp.q, opacity, tmp.col); tagLast(packed, move); n++;
    };
    const ctx = {
      rng: makeRng(hashInts(S.seed, 7717)), x0: B.x0, length: B.length, zNear: B.zNear, zFar: B.zFar, count, index: 0,
      terrain, palette: biome.palette, dials: S.dials, level: S.level, beatMetres: worldBeat, layer: 'backdrop', seed: S.seed, hour: S.hour,
    };
    const chunk = { layer: BACKDROP, index: 0, x0: 0, packed, gen: B.generate(ctx, emit), mesh: null, done: false, epoch, count: () => n, backdrop: B };
    chunks.set('backdrop:0', chunk);
  }
  // Where a finished chunk's mesh stands this frame.
  function place(ch) {
    if (ch.backdrop) {
      const p = ch.backdrop.pose(S.travelled, S.seed, tanHalfHfov);
      ch.mesh.position.set(p.x, 0, -ch.backdrop.pivot); ch.mesh.rotation.y = p.yaw;
    } else ch.mesh.position.x = ch.x0 - S.travelled;
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
    if (biome.backdrop) { wanted.add('backdrop:0'); if (!chunks.has('backdrop:0')) startBackdrop(); }
    for (const key of [...chunks.keys()]) if (!wanted.has(key)) dropChunk(key);
  }

  // Run chunk generators for a few milliseconds, nearest bands first.
  const order = (c) => (c.backdrop ? LAYERS.length : LAYERS.indexOf(c.layer));   // the backdrop last: it is the furthest thing
  function generate(budgetMs) {
    const t0 = performance.now();
    const pending = [...chunks.values()].filter((c) => !c.done)
      .sort((a, b) => order(a) - order(b) || Math.abs(a.x0 - S.travelled) - Math.abs(b.x0 - S.travelled));
    for (const ch of pending) {
      for (;;) {
        const r = ch.gen.next();
        if (r.done) {
          ch.done = true;
          if (ch.count() > 0) { ch.mesh = new SplatMesh({ packedSplats: ch.packed }); place(ch); scene.add(ch.mesh); }
          frameNote = `${ch.layer.name} chunk arrived (${Math.round(ch.count() / 1000)}k)`;
          // While the train is running, hand over one finished chunk per frame at most: uploading
          // several in the same frame is the likeliest cause of a hitch.
          if (running) return pending.length === 1;
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
    frameNote = 'world rebuilt in tunnel';
    for (const key of [...chunks.keys()]) dropChunk(key);
    biome = getBiome(S.biome);
    terrain = makeTerrain(S.seed, biome.terrain);
    setUnderlay(biome); setHorizon(biome);
    worldBeat = S.beatMetres;
    if (kit) kit.reset();
    rebuilding = true;
  }
  let rebuilding = false;
  director.on('swap', rebuildWorld);

  // --- photo pieces ---------------------------------------------------------------------------------
  const kit = params.kit ? createKit({ THREE, SplatMesh, PackedSplats, scene, baseUrl: import.meta.env.BASE_URL }) : null;

  // --- sizing and adaptive resolution -------------------------------------------------------------
  // A biome may lower the horizon in the frame to give the sky more room (biome.horizon, a fraction
  // of the half-height; horizon= in the URL overrides it). The camera stays level: this is a lens
  // shift, an off-centre projection, so verticals stay vertical and nothing else needs to know
  // except the sky and the backdrop, which draw in screen space.
  let horizonShift = 0;
  // The vertical field of view is params.fov in a landscape window. A window taller than it is wide
  // (a phone held upright) would turn that into a narrow slit that scenery whips across, so there
  // the view is widened vertically until it is about 53 degrees across, up to a limit of 95 tall:
  // the same country, with more sky above and more ground below.
  const TAN_ACROSS = 0.5, TAN_TALL_MAX = 1.1;
  let fovNow = params.fov;
  function fovFor(aspect) {
    const base = Math.tan((params.fov * Math.PI) / 360);
    const t = Math.max(base, Math.min(TAN_TALL_MAX, TAN_ACROSS / aspect));
    return (Math.atan(t) * 360) / Math.PI;
  }
  function applyHorizon() {
    const tanHalf = Math.tan((fovNow * Math.PI) / 360);
    camera.projectionMatrix.elements[9] = horizonShift;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    frameMount.matrix.identity(); frameMount.matrix.elements[9] = -horizonShift * tanHalf;
    frameMount.matrixWorldNeedsUpdate = true;
    underlayUniforms.uShift.value = horizonShift;
  }
  // A change of biome changes the target inside the tunnel; the shift eases to it over a second or
  // so (see tick), so the tunnel's own lamps do not jump.
  // An upright window adds a shift of its own (horizonExtra, set in resize): its extra height would
  // otherwise go half to sky and half to the bare ground beside the track, which has nothing in it.
  let horizonTarget = 0, horizonBase = 0, horizonExtra = 0;
  function setHorizon(b, now = false) {
    const h = params.horizon >= 0 ? params.horizon : (b.horizon || 0);
    horizonBase = Math.max(0, Math.min(0.6, h));
    horizonTarget = Math.min(0.6, horizonBase + horizonExtra);
    if (now) { horizonShift = horizonTarget; applyHorizon(); }
  }
  let resScale = Math.min(1, params.scale);
  let width = 1, height = 1;
  function resize() {
    width = canvas.clientWidth || window.innerWidth; height = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * resScale;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    fovNow = fovFor(camera.aspect); camera.fov = fovNow;
    camera.updateProjectionMatrix();
    {   // 0 in a landscape window, up to 0.25 where the view has been widened to its limit
      const base = Math.tan((params.fov * Math.PI) / 360), now = Math.tan((fovNow * Math.PI) / 360);
      horizonExtra = params.horizon >= 0 ? 0 : 0.25 * Math.max(0, Math.min(1, (now - base) / (TAN_TALL_MAX - base)));
      horizonTarget = Math.min(0.6, horizonBase + horizonExtra);   // eased to in tick
    }
    applyHorizon();
    tanHalfHfov = Math.tan((fovNow * Math.PI) / 360) * camera.aspect;
    frame.resize(camera.aspect, fovNow);
  }
  resize();
  setHorizon(biome, true);
  window.addEventListener('resize', resize);
  // The canvas can change size with no window resize: a phone's address bar sliding away, a turn of
  // the screen that settles a moment later.
  const sizeWatch = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w && h && (w !== width || h !== height)) resize();
  }) : null;
  if (sizeWatch) sizeWatch.observe(canvas);
  const onVisible = () => { last = performance.now(); };   // a hidden tab is not a hitch
  document.addEventListener('visibilitychange', onVisible);

  let frames = 0, acc = 0, fps = 60, slowFor = 0, fastFor = 0;
  let beatSeq = 0, lastBeatSeen = 0, swayPhase = 0;
  // motion clock (seconds) and its wraps: 200 pi for phases, 4096 cells of 48 m for traffic
  let moveT = 0;
  const MOVE_WRAP = 200 * Math.PI, FLOW_WRAP = 48 * 4096, LANE_SPEED = [33, 29.5, 25];   // m/s, fast lane first
  // hitch meter state
  let frameNote = '', prevWork = { gen: 0, render: 0, cpu: 0, note: '' };
  let worst = { ms: 0, at: 0, gen: 0, render: 0, cpu: 0, note: '' };
  const hitchTimes = [];
  // idle state
  const IDLE_FRAME_MS = 500;
  let idleSince = 0, lastDraw = 0, isIdle = false, lastAllDone = false;
  function adapt(dt) {
    frames++; acc += dt;
    if (acc >= 0.5) { fps = frames / acc; frames = 0; acc = 0; }
    // "slow" and "fast" are judged against the frame-rate cap when it is below the display's rate
    const slowAt = fpsCap ? Math.max(1 / 45, 1.35 / fpsCap) : 1 / 45, fastAt = fpsCap ? Math.max(1 / 58, 1.05 / fpsCap) : 1 / 58;
    if (dt > slowAt) { slowFor += dt; fastFor = 0; } else if (dt < fastAt) { fastFor += dt; slowFor = 0; }
    if (slowFor > 2 && resScale > 0.4) { resScale = Math.max(0.4, resScale * 0.85); slowFor = 0; resize(); }
    if (fastFor > 8 && resScale < Math.min(1, params.scale)) { resScale = Math.min(params.scale, resScale / 0.9); fastFor = 0; resize(); }
  }

  // --- frame loop -------------------------------------------------------------------------------------
  let last = performance.now(), running = false, disposed = false, readyResolve;
  const ready = new Promise((r) => { readyResolve = r; });
  let audioProvider = null;
  let fpsCap = params.fps > 0 ? params.fps : 0, nextFrameAt = 0;   // 0 = every display refresh

  function tick() {
    if (disposed) return;
    const now = performance.now();
    // Frame-rate cap: skip this display refresh if the next frame is not due. The schedule keeps the
    // average rate exact where the cap does not divide the display's rate.
    if (fpsCap) {
      if (now < nextFrameAt - 1.5) return;
      const T = 1000 / fpsCap;
      nextFrameAt = Math.max(nextFrameAt + T, now - T);
    }
    const interval = now - last;
    const dt = Math.min(0.1, interval / 1000); last = now;
    const wasIdle = isIdle || !!idleSince;   // the gap before this frame was chosen, not suffered
    // Hitch meter: the gap since the last frame is blamed on what the last frame did.
    if (running) {
      if (interval > Math.max(25, fpsCap ? 1500 / fpsCap : 0) && !wasIdle) hitchTimes.push(now);
      while (hitchTimes.length && now - hitchTimes[0] > 10000) hitchTimes.shift();
      if (!wasIdle && (interval > worst.ms || now - worst.at > 4000)) worst = { ms: interval, at: now, ...prevWork };
    }
    frameNote = '';

    // Idle: once the train has stopped and nothing is waiting to be built, the picture is not
    // changing, so stop doing work. The director still runs (it is what notices the train may pull
    // away again), and one frame is drawn every half second so the sky and the clock drift on.
    // A hidden tab gets no frames at all: the browser stops calling us.
    const stopped = running && S.speed === 0 && S.rate === 0;
    if (stopped) { if (!idleSince) idleSince = now; } else idleSince = 0;
    isIdle = stopped && !rebuilding && lastAllDone && now - idleSince > 600;
    if (isIdle && now - lastDraw < IDLE_FRAME_MS) {
      director.update(dt);
      return;
    }
    lastDraw = now;

    if (audioProvider) director.setAudio(audioProvider(dt));
    director.update(running ? dt : 0);
    if (horizonShift !== horizonTarget) {
      horizonShift += (horizonTarget - horizonShift) * (1 - Math.exp(-dt / 0.6));
      if (Math.abs(horizonTarget - horizonShift) < 0.001) horizonShift = horizonTarget;
      applyHorizon();
    }

    sky.update({ hour: S.hour, level: S.level, dials: S.dials, time: S.time, dt, aspect: camera.aspect, fovDeg: fovNow, travelled: S.travelled, speed: S.speed, energy: S.energy, beat: params.beatPin >= 0 ? params.beatPin : S.beat, sparkle: S.sparkle, sky: biome.sky, shift: horizonShift,
      motionT: moveT, moving: !(S.speed === 0 && S.rate === 0), twinkle: reducedMotion ? 0 : Math.min(1, params.move) });
    const inTunnel = S.tunnel && S.tunnel.phase === 'inside';
    uniforms.uMotionMetres.value = S.speed * params.shutter * (reducedMotion ? 0.5 : 1);
    uniforms.uHazeColor.value.copy(sky.horizonColor);
    uniforms.uHazeHigh.value.copy(sky.hazeHighColor || sky.horizonColor);
    uniforms.uLightTint.value.copy(sky.lightTint);
    {
      // Golden hour: with the sun low but up, push the land's light warm and a little brighter, as a
      // camera exposing for the scene would see it. The sky's own tint only dims at these hours.
      const y = sky.sunDir.y, ss = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
      // (a biome may scale it: snow under the full grade turns the colour of sand)
      const low = ss(0.32, 0.1, y) * ss(-0.06, 0.03, y) * params.gold * (biome.gold != null ? biome.gold : 1);
      const t = uniforms.uLightTint.value;
      t.r *= 1 + 0.42 * low; t.g *= 1 + 0.12 * low; t.b *= 1 - 0.22 * low;
      // ... and with the sun low, a biome that takes less gold also takes less of the sky's own
      // orange: its light is pulled part of the way to neutral, so snow at dusk stays snow.
      if (biome.gold != null && biome.gold < 1) {
        const k = 0.6 * (1 - biome.gold) * ss(0.32, 0.1, y) * ss(-0.2, -0.02, y), lum = 0.3 * t.r + 0.59 * t.g + 0.11 * t.b;
        t.r += (lum - t.r) * k; t.g += (lum - t.g) * k; t.b += (lum * 1.08 - t.b) * k;
      }
    }
    uniforms.uHazeDist.value = biome.hazeDist || 3000;
    uniforms.uDissolve.value = S.dissolve;
    uniforms.uBreath.value = S.breath;
    uniforms.uBeat.value = params.beatPin >= 0 ? params.beatPin : S.beat;
    // each new beat gets a number, so that the chorus groups (kit.js chorus()) take turns
    if (S.beat > lastBeatSeen + 0.25) beatSeq = (beatSeq + 1) % 1024;
    lastBeatSeen = S.beat;
    uniforms.uBeatSeq.value = params.beatSeq >= 0 ? params.beatSeq : beatSeq;
    uniforms.uBeatRaised.value = biome.beatKinds ? 0 : 1;
    uniforms.uSparkle.value = S.sparkle;
    uniforms.uClock.value = S.time % 1000;
    uniforms.uMoveDebug.value = params.tags ? 1 : 0;
    // Things that move (sparkPatch.js): their clock runs only while the train does, so a stopped
    // train still shows a still picture, and reduced motion switches them off.
    if (params.moveT >= 0) moveT = params.moveT;
    else if (running && !(S.speed === 0 && S.rate === 0)) moveT += dt;
    uniforms.uMove.value = reducedMotion ? 0 : params.move;
    uniforms.uMoveT.value = moveT % MOVE_WRAP;
    // Crops sway once for every two beats of the last tempo the analysis trusted (0.45 Hz with none),
    // on the motion clock, so they stand still when the train does.
    if (params.moveT >= 0) swayPhase = (params.moveT * 2 * Math.PI * 0.45) % (2 * Math.PI);
    else if (running && !(S.speed === 0 && S.rate === 0)) swayPhase = (swayPhase + dt * 2 * Math.PI * (S.bpm > 40 ? Math.min(1.4, Math.max(0.3, S.bpm / 120)) : 0.45)) % (2 * Math.PI);
    uniforms.uSway.value = swayPhase;
    uniforms.uTravel.value = S.travelled % MOVE_WRAP;
uniforms.uFly.value = ((S.travelled % 49152) + 49152) % 49152;
        uniforms.uFall.value.set((1.3 * moveT) % 16, (9 * moveT) % 16);   // snow and rain: metres fallen
    for (let l = 0; l < 3; l++) {
      // where each lane's traffic pattern has got to, wrapped to a whole number of 48 m cells
      const w = S.travelled - LANE_SPEED[l] * moveT, a = S.travelled + LANE_SPEED[l] * moveT;
      uniforms.uFlowWith.value.setComponent(l, ((w % FLOW_WRAP) + FLOW_WRAP) % FLOW_WRAP);
      uniforms.uFlowAgainst.value.setComponent(l, a % FLOW_WRAP);
    }

    manageChunks();
    const tGen0 = performance.now();
    const allDone = generate(running ? params.slice : 12);
    const tGen = performance.now() - tGen0;
    lastAllDone = allDone;
    if (allDone && rebuilding) { rebuilding = false; director.worldReady(); }
    if (allDone && readyResolve) { readyResolve(); readyResolve = null; }
    for (const ch of chunks.values()) if (ch.mesh) place(ch);
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
    const tRender0 = performance.now();
    renderer.render(scene, camera);
    const tEnd = performance.now();
    prevWork = { gen: tGen, render: tEnd - tRender0, cpu: tEnd - now, note: frameNote };
    // Screenshot runs keep full resolution, and a stopped train's slow redraws say nothing about speed:
    // without this the resolution would fall while the view stands still.
    if (running && !params.preserve && !wasIdle && !isIdle) adapt(dt);
  }
  renderer.setAnimationLoop(tick);

  return {
    ready,                                   // resolves when the first world is fully generated
    shaderPatched,
    director,
    start() { running = true; last = performance.now(); },
    setRate(r) { director.setRate(r); },
    // Jump the clock to the next time-of-day slot (a tuning aid; see SLOTS in director.js).
    cycleSlot() {
      const names = Object.keys(SLOTS), next = names[(names.indexOf(S.slot) + 1) % names.length];
      S.slot = next; S.hour = (SLOTS[next][0] + 0.3) % 24;
      return next;
    },
    kitInstances() { return kit ? kit.instances() : []; },   // for the harness and tuning
    biomeNames() { return Object.keys(BIOMES).filter((b) => b !== 'placeholder' || Object.keys(BIOMES).length === 1); },
    setAudioProvider(fn) { audioProvider = fn; },
    setFpsCap(n) { fpsCap = n > 0 ? n : 0; nextFrameAt = 0; slowFor = 0; fastFor = 0; },
    sky,   // for scripts (sky._debug)
    stats() {
      let splats = 0, pending = 0;
      for (const ch of chunks.values()) { if (ch.done) splats += ch.count(); else pending++; }
      return { fps: Math.round(fps), at: Math.round(S.travelled), splats, pending, chunks: chunks.size, resScale: +resScale.toFixed(2), kmh: Math.round(S.speed * 3.6), hour: +S.hour.toFixed(2), biome: S.biome, level: S.level, tunnel: S.tunnel ? S.tunnel.phase : '', patched: shaderPatched, energy: +S.energy.toFixed(2), bpm: Math.round(S.bpm), mast: Math.round(S.beatMetres), photos: kit ? kit.stats().pieces : 0,
        levelName: LEVELS[S.level].name, slot: S.slot, beat: +S.beat.toFixed(2), sparkle: +S.sparkle.toFixed(2), tint: uniforms.uLightTint.value.toArray().map((v) => +v.toFixed(2)), dissolve: +S.dissolve.toFixed(2),
        next: S.tunnel ? { biome: S.tunnel.next.biome, levelName: LEVELS[S.tunnel.next.level].name, phase: S.tunnel.phase } : null,
        audio: !!audioProvider,
        // the slowest frame of the last few seconds, and what the frame before it spent its time on
        worst: { ms: Math.round(worst.ms), gen: Math.round(worst.gen), render: Math.round(worst.render), cpu: Math.round(worst.cpu), note: worst.note },
        hitches: hitchTimes.length, idle: isIdle, moveT: +moveT.toFixed(2), fpsCap };
    },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', resize);
      if (sizeWatch) sizeWatch.disconnect();
      document.removeEventListener('visibilitychange', onVisible);
      for (const key of [...chunks.keys()]) dropChunk(key);
      if (kit) kit.dispose();
      renderer.dispose();
    },
  };
}
