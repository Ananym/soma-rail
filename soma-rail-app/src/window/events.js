// What a drop or a breakdown in the music sets off on screen (CONTRACT: director state.event).
// Four shows, each a short piece of engine-owned splats (or a sky effect), made when its event
// fires and disposed when it is over, so nothing is spent between shows:
//   train      a train passing on the other track: a dark rush that fills the window (a drop)
//   flock      forty to ninety birds lifting off together and wheeling away (a breakdown by day)
//   fireworks  five to nine shells over a distant town (a drop at night)
//   meteors    a meteor shower through the sky shader (a breakdown at night)
// Every show is a pure function of its own clock and a seed, so `eventT=` can hold any moment for
// a still. Splats are tagged SOLID (kit.js MOVE.SOLID): they are not thrown about by the dreamlike
// scatter, which would also re-roll each frame for splats that are rewritten every frame.
import { tagLast } from './sparkPatch.js';
import { CAMERA_HEIGHT } from './layers.js';
import { hashInts, makeRng } from './rng.js';

export const SHOWS = ['train', 'flock', 'fireworks', 'meteors'];
const SOLID = 10;                       // kit.js MOVE.SOLID
const PALE_BIRDS = new Set(['tropics', 'karst', 'monsoon', 'fuji']);   // egrets and gulls; rooks elsewhere

export function createEvents({ THREE, SplatMesh, PackedSplats, scene, sky, director, params, reducedMotion }) {
  const S = director.state;
  const tmp = { c: new THREE.Vector3(), s: new THREE.Vector3(), q: new THREE.Quaternion(), col: new THREE.Color() };
  const AXIS_Z = new THREE.Vector3(0, 0, 1);
  let show = null;                      // { kind, t, pinned, moved, obj }
  let lastSeq = S.event ? S.event.seq : 0, lastKind = '', lastFire = '', pending = '', fired = 0;

  // ---- splat helpers ---------------------------------------------------------------------------
  // push(packed, x, y, z, sx, sy, sz, r, g, b, a, rotZ): one splat, tagged SOLID.
  function push(packed, x, y, z, sx, sy, sz, r, g, b, a = 1, rotZ = 0) {
    tmp.c.set(x, y, z); tmp.s.set(sx, sy, sz); tmp.col.setRGB(r, g, b);
    if (rotZ) tmp.q.setFromAxisAngle(AXIS_Z, rotZ); else tmp.q.set(0, 0, 0, 1);
    packed.pushSplat(tmp.c, tmp.s, tmp.q, a, tmp.col); tagLast(packed, SOLID);
  }
  // set(...): rewrite splat i in place (for the shows that move their splats on the CPU).
  const view = { packedArray: null, numSplats: 0 };
  function set(packed, i, x, y, z, sx, sy, sz, r, g, b, a = 1, rotZ = 0) {
    tmp.c.set(x, y, z); tmp.s.set(sx, sy, sz); tmp.col.setRGB(r, g, b);
    if (rotZ) tmp.q.setFromAxisAngle(AXIS_Z, rotZ); else tmp.q.set(0, 0, 0, 1);
    packed.setSplat(i, tmp.c, tmp.s, tmp.q, a, tmp.col);
    view.packedArray = packed.packedArray; view.numSplats = i + 1; tagLast(view, SOLID);
  }
  // A hidden splat sits behind the eye, where the renderer drops it.
  const hide = (packed, i) => set(packed, i, 0, 0, 100, 0.01, 0.01, 0.01, 0, 0, 0, 0);
  function meshOf(packed) { const m = new SplatMesh({ packedSplats: packed }); scene.add(m); return m; }
  function drop(m, packed) { scene.remove(m); m.dispose(); packed.dispose(); }
  function touched(m, packed) { packed.needsUpdate = true; m.updateVersion(); }

  // =================================================================================================
  // 1. The train on the other track. Its near side is 2 m from the eye, taller than the window; it
  // comes the other way at its own speed plus ours. Four carriage meshes are built (the cab end,
  // two middles and the tail end, which is a cab too, mirrored) and each frame each is stood where
  // the carriage of its kind nearest the eye is: at 2 m only one carriage end is ever in view.
  // =================================================================================================
  const LIVERIES = [
    { body: [0.07, 0.1, 0.24], stripe: [0.75, 0.76, 0.78], end: [0.85, 0.68, 0.06], door: [0.07, 0.1, 0.24], roof: [0.3, 0.31, 0.33] },
    { body: [0.36, 0.06, 0.07], stripe: [0.78, 0.7, 0.52], end: [0.85, 0.68, 0.06], door: [0.36, 0.06, 0.07], roof: [0.24, 0.24, 0.25] },
    { body: [0.05, 0.19, 0.12], stripe: [0.8, 0.66, 0.1], end: [0.85, 0.68, 0.06], door: [0.8, 0.66, 0.1], roof: [0.26, 0.27, 0.27] },
    { body: [0.13, 0.14, 0.15], stripe: [0.72, 0.09, 0.07], end: [0.72, 0.08, 0.06], door: [0.72, 0.09, 0.07], roof: [0.3, 0.3, 0.31] },
    { body: [0.6, 0.62, 0.64], stripe: [0.08, 0.2, 0.5], end: [0.85, 0.68, 0.06], door: [0.08, 0.2, 0.5], roof: [0.34, 0.35, 0.36], lower: [0.08, 0.2, 0.5] },
  ];
  const CAR = 24, GAP = 1.4, SIDE_Z = -2.0, NOSE = 4.6;
  function makeTrain(rng, ctx) {
    const liv = LIVERIES[Math.floor(rng() * LIVERIES.length)];
    const n = 6 + Math.floor(rng() * 3);
    const own = 24 + 8 * rng();                                  // its own speed, m/s
    const lit = ctx.dusk;
    const ground = (d) => ctx.terrain.height(S.travelled, d);   // near the track the ground only varies with distance out
    // cab: 1 = the front (nose at u = 0), -1 = the tail (nose at u = CAR, red lamps), 0 = a middle
    function car(cab) {
      const packed = new PackedSplats();
      packed.ensureSplats(1400);
      const P = (u, ...a) => push(packed, cab < 0 ? CAR - u : u, ...a);
      const nu = (u) => (cab ? u : 99);                          // distance from the nose
      const top = (u) => (nu(u) < NOSE ? 1.5 + 2.35 * (1 - (1 - nu(u) / NOSE) ** 2) : 3.85);
      // doors and windows along the side (the window pitch varies, so it does not strobe)
      // The windows fill the run between the doors exactly, so no stretch of bare wall fills the view.
      const doors = cab ? [[CAR - 4.6, CAR - 3.3], [NOSE + 0.6, NOSE + 1.4]] : [[3.3, 4.6], [CAR - 4.6, CAR - 3.3]];
      const wins = [];
      if (!cab) wins.push([0.5, 3.0, rng()]);
      wins.push([CAR - 3.0, CAR - 0.5, rng()]);
      {
        const a = cab ? NOSE + 1.8 : 4.95, b = CAR - 4.95, ws = [], ps = [];
        for (let len = 0; ;) {
          const w = 1.6 + 0.7 * rng(), p = 0.42 + 0.14 * rng();   // (a pillar must outlast the smear)
          if (ws.length && len + w > b - a) break;
          ws.push(w); ps.push(p); len += w + p;
        }
        ps[ps.length - 1] = 0;
        const k = (b - a) / ws.reduce((s, w, i) => s + w + ps[i], 0);
        for (let i = 0, u = a; i < ws.length; i++) { wins.push([u, u + ws[i] * k, rng()]); u += (ws[i] + ps[i]) * k; }
      }
      const inAny = (list, u) => list.find((r) => u >= r[0] && u < r[1]);
      const lower = liv.lower || liv.body;
      // Each column of splats is smeared along the track a little (SX) on top of the shader's own
      // smear for the world going by: the train passes at twice the land's speed.
      const SX = 0.21, STEP = 0.38;
      const glass = (r, u) => {                                  // the window glass, lit by night
        const k = r[2] == null ? 0.5 : r[2];
        P(u, 2.2, SIDE_Z - 0.005, SX, 0.035, 0.02, 0.03, 0.03, 0.035);   // the rubber round the glass
        P(u, 3.0, SIDE_Z - 0.005, SX, 0.035, 0.02, 0.03, 0.03, 0.035);
        if (lit) {
          const g = 0.86 + 0.09 * k, b = 0.6 + 0.2 * k;
          // heads and seat backs against the light, in about half the windows
          if (k > 0.45) P(u, 2.32, SIDE_Z - 0.01, SX, 0.13, 0.02, 0.16, 0.12, 0.1, 1);
          else P(u, 2.32, SIDE_Z - 0.01, SX, 0.13, 0.02, 1.0, g - 0.06, b - 0.08, 0.85);
          P(u, 2.5, SIDE_Z - 0.01, SX, 0.13, 0.02, 1.0, g, b, 0.9 + 0.1 * k);
          P(u, 2.68, SIDE_Z - 0.01, SX, 0.13, 0.02, 1.0, g, b, 0.9 + 0.1 * k);
          P(u, 2.86, SIDE_Z - 0.01, SX, 0.12, 0.02, 1.0, g + 0.04, b + 0.08, 1);
        } else {
          // dark glass by day, the sky reflected in its upper half
          P(u, 2.32, SIDE_Z - 0.01, SX, 0.14, 0.02, 0.025, 0.028, 0.032);
          P(u, 2.5, SIDE_Z - 0.01, SX, 0.14, 0.02, 0.04, 0.045, 0.055);
          P(u, 2.68, SIDE_Z - 0.01, SX, 0.13, 0.02, 0.2 + 0.1 * k, 0.24 + 0.1 * k, 0.3 + 0.08 * k);
          P(u, 2.86, SIDE_Z - 0.01, SX, 0.13, 0.02, 0.42 + 0.1 * k, 0.48 + 0.1 * k, 0.56 + 0.08 * k);
        }
      };
      for (let u = STEP / 2; u < CAR; u += STEP) {
        const tp = top(u), door = inAny(doors, u), win = !door && inAny(wins, u);
        const nose = nu(u) < NOSE + 0.4;
        const main = nose ? liv.end : lower;
        // underframe and bogies, set back under the body
        if (nu(u) > 1.2) {
          P(u, 0.94, SIDE_Z - 0.3, SX, 0.12, 0.05, 0.07, 0.07, 0.075);
          const bogie = (u > 2 && u < 5.2) || (u > CAR - 5.2 && u < CAR - 2);
          if (bogie) { P(u, 0.62, SIDE_Z - 0.2, SX, 0.16, 0.05, 0.05, 0.05, 0.05); P(u, 0.36, SIDE_Z - 0.15, SX, 0.14, 0.05, 0.1, 0.1, 0.1); }
        } else P(u, 0.95, SIDE_Z - 0.1, SX, 0.14, 0.05, ...liv.end);   // the nose's skirt
        // the body below the windows
        for (const y of [1.14, 1.34, 1.54, 1.74, 1.92]) if (y < tp) P(u, y, SIDE_Z, SX, 0.15, 0.02, ...(door ? liv.door : y < 1.2 ? lower.map((v) => v * 0.6) : main));
        if (2.07 < tp) P(u, 2.07, SIDE_Z, SX, 0.055, 0.02, ...(door ? liv.door : nose ? liv.end : liv.stripe));
        // the window band
        if (cab && nu(u) > 0.7 && nu(u) < NOSE + 0.2) {
          // the cab's windscreen, raked back along the nose, with the nose colour below it
          const y0 = Math.max(2.0, tp - 0.95);
          for (let y = 2.2; y < tp - 0.05; y += 0.18) P(u, y, SIDE_Z - 0.02, SX, 0.11, 0.02, ...(y > y0 ? [0.04, 0.045, 0.05] : liv.end));
          if (tp - 0.3 > 2.2) P(u, tp - 0.28, SIDE_Z + 0.01, SX, 0.04, 0.02, 0.5, 0.54, 0.6, 0.7);   // a glint along its top
        } else if (2.3 < tp) {
          if (win) glass(win, u);
          else for (const y of [2.26, 2.48, 2.7, 2.92]) P(u, y, SIDE_Z, SX, 0.16, 0.02, ...(door ? liv.door : liv.body));
          if (door) {                                            // the door's own narrow window
            const mid = (door[0] + door[1]) / 2;
            if (Math.abs(u - mid) < 0.3) for (const y of [2.45, 2.8]) P(u, y, SIDE_Z + 0.01, SX * 0.8, 0.15, 0.02, ...(lit ? [1.0, 0.88, 0.66] : [0.05, 0.06, 0.07]));
          }
        }
        // above the windows, the roof's shoulder curving away
        for (const y of [3.14, 3.34, 3.54, 3.7]) if (y < tp) P(u, y, SIDE_Z, SX, 0.15, 0.02, ...(nose ? liv.end : liv.body));
        if (tp > 3.6) { P(u, 3.86, SIDE_Z - 0.06, SX, 0.09, 0.06, ...liv.roof); P(u, 4.02, SIDE_Z - 0.3, SX, 0.08, 0.15, ...liv.roof.map((v) => v * 0.85)); }
        else { P(u, tp, SIDE_Z - 0.1, SX, 0.09, 0.1, ...liv.roof); }
      }
      // the glint on dark glass by day: a pale streak along part of a few windows
      if (!lit) for (const r of wins) if (rng() < 0.7) { const a = r[0] + rng() * (r[1] - r[0]) * 0.5; P(a + 0.3, 2.93, SIDE_Z + 0.01, 0.35, 0.025, 0.02, 0.75, 0.78, 0.82, 0.85); }
      // the carriage ends, seen at a slant through the gaps: a dark wall and the gangway's bellows
      for (const e of cab ? [CAR] : [0, CAR]) {
        const ue = e === 0 ? 0.03 : CAR - 0.03;
        for (let z = SIDE_Z - 0.3; z > SIDE_Z - 2.7; z -= 0.45) {
          const bellows = z < SIDE_Z - 0.75 && z > SIDE_Z - 2.05;
          for (let y = 1.2; y < 3.9; y += 0.42) {
            if (bellows) P(e === 0 ? -0.35 : CAR + 0.35, y, z, 0.35, 0.22, 0.25, 0.04, 0.04, 0.045);
            else P(ue, y, z, 0.04, 0.22, 0.25, 0.1, 0.1, 0.11);
          }
        }
      }
      // the lamps on the nose: white at the front, with a beam lit ahead on the ground beside the
      // track and in the air (the breath of warning before it bursts in); red at the tail
      if (cab) {
        const day = lit ? 1 : 0.55;
        if (cab > 0) {
          // (the lamps sit high on the nose: from 2.6 m up, the bottom of a landscape window at 2 m
          // is about 1.7 m above the rail)
          P(0.3, 1.72, SIDE_Z + 0.04, 0.16, 0.1, 0.06, 1.0, 0.98, 0.92, 1);
          P(0.1, 1.75, SIDE_Z + 0.06, 1.1, 0.7, 0.3, 1.0, 0.97, 0.9, 0.4 * day);
          for (let k = 0; k < 14; k++) {
            const a = 1.5 + k * 2.0, f = Math.exp(-a / 11);
            for (const d of [3.6, 5.4, 7.6]) P(-a, ground(d) + 0.05, -d, 1.6, 0.05, 1.0 + 0.2 * d, 1.0, 0.96, 0.86, 0.5 * f * day * (d < 5 ? 1 : 0.6));
            if (k < 9) P(-a, 1.9 + 0.05 * a, -3.0, 1.6, 0.6 + 0.06 * a, 0.6, 1.0, 0.97, 0.9, (lit ? 0.32 : 0.14) * f);   // lit air ahead of it
          }
        } else {
          P(0.3, 1.72, SIDE_Z + 0.04, 0.16, 0.1, 0.06, 1.0, 0.1, 0.06, 1);
          P(0.1, 1.74, SIDE_Z + 0.06, 0.55, 0.4, 0.2, 1.0, 0.12, 0.08, 0.35);
        }
      }
      const mesh = meshOf(packed);
      mesh.visible = false;
      return { packed, mesh };
    }
    const front = car(1), mids = [car(0), car(0)], tail = car(-1);
    // the nose reaches the right edge of the window 0.2 s after the event
    const reach = 0.2, x0 = ctx.tanHalfH * -SIDE_Z + reach * (S.speed + own);
    return {
      update(t, moved, pinned) {
        // (held for a still, from the speed now: the first show of a load fires while the train is
        // still getting up to speed)
        const nose = pinned ? ctx.tanHalfH * -SIDE_Z + (reach - t) * (S.speed + own) : x0 - moved - own * t, pitch = CAR + GAP;
        const nearest = (list) => list.reduce((b, k) => (Math.abs(nose + k * pitch + CAR / 2) < Math.abs(nose + b * pitch + CAR / 2) ? k : b), list[0]);
        const odd = [], even = [];
        for (let k = 1; k < n - 1; k++) (k % 2 ? odd : even).push(k);
        const place = (c, k) => { if (k == null) { c.mesh.visible = false; return; } c.mesh.visible = true; c.mesh.position.x = nose + k * pitch; };
        place(front, 0); place(tail, n - 1);
        place(mids[0], odd.length ? nearest(odd) : null); place(mids[1], even.length ? nearest(even) : null);
        return nose + n * pitch > -ctx.tanHalfH * 8 - 40;        // until the tail lamps are well past
      },
      hideAll() { for (const c of [front, tail, ...mids]) c.mesh.visible = false; },
      dispose() { for (const c of [front, tail, ...mids]) drop(c.mesh, c.packed); },
      splats: () => [front, tail, ...mids].reduce((s, c) => s + c.packed.numSplats, 0),
    };
  }

  // =================================================================================================
  // 2. A flock lifting off. The birds start as a cluster on the ground ahead and to the right (the
  // land slides that way), lift in a wave, and wheel up and away, spreading as they climb. Their
  // path is traced once; each frame every bird is redrawn (four splats: body, head, two wings),
  // its wings in one of two frames. Larger than life, like the birds in the biomes.
  // =================================================================================================
  function makeFlock(rng, ctx, strength) {
    const pale = PALE_BIRDS.has(ctx.biome.name);
    const n = Math.round(55 + 45 * Math.min(1, strength) * (0.5 + 0.5 * rng()));
    const d0 = 60 + 50 * rng();
    const xs = ctx.tanHalfH * d0 * (0.5 + 0.2 * rng());       // ahead, to the right: the land slides left
    const y0 = ctx.terrain.height(S.travelled + xs, d0);        // (heights are above the rail, as in the scene)
    const mag = pale ? 2.3 : 2.6;
    const col = pale ? [0.8, 0.8, 0.77] : [0.05, 0.05, 0.06];
    const flapHz = pale ? 2.6 : 4.2;
    // the flock's middle: a climbing turn, traced every 0.05 s for 12 s
    const DT = 0.05, path = [];
    {
      let x = 0, y = 0, z = 0, th = 0.15 + 0.2 * rng();
      const om = (0.17 + 0.1 * rng()), vMax = Math.max(9, Math.min(19, 0.6 * S.speed)) * (0.95 + 0.1 * rng());   // flying the train's way, so they stay in view
      for (let i = 0; i <= 240; i++) {
        const tau = i * DT;
        path.push([x, y, z]);
        const v = vMax * (1 - Math.exp(-tau / 0.9));
        const th1 = th + om * Math.max(0, tau - 0.8);
        x += v * Math.cos(th1) * DT; z -= v * Math.sin(th1) * DT;
        y += (6.5 * Math.exp(-tau / 2.6) + 1.6) * DT;
      }
    }
    const at = (tau) => { const f = Math.min(240, Math.max(0, tau / DT)), i = Math.min(239, Math.floor(f)), a = f - i; return path[i].map((v, k) => v + (path[i + 1][k] - v) * a); };
    const birds = [];
    for (let i = 0; i < n; i++) {
      const gx = (rng() - 0.5) * 14, gz = (rng() - 0.5) * 10;
      // in the air: a loose, flattened cloud, further out than on the ground
      const a = rng() * 6.283, r = Math.sqrt(rng());
      birds.push({
        gx, gz, delay: 0.05 * (gx + 7) + 0.35 * rng(),           // a wave from one side of the cluster
        fx: Math.cos(a) * r * 22, fy: (rng() - 0.5) * 9, fz: Math.sin(a) * r * 16,
        ph: rng() * 6.283, hz: flapHz * (0.85 + 0.3 * rng()), s: mag * (0.85 + 0.3 * rng()), glide: rng(),
      });
    }
    const packed = new PackedSplats();
    packed.ensureSplats(n * 4);
    for (let i = 0; i < n * 4; i++) push(packed, 0, 0, 100, 0.01, 0.01, 0.01, 0, 0, 0, 0);
    const mesh = meshOf(packed);
    const ox = xs, oz = -d0;
    return {
      update(t, moved) {
        mesh.position.x = -moved;
        let any = false;
        for (let i = 0; i < n; i++) {
          const b = birds[i], j = i * 4, tau = t - b.delay;
          const sp = Math.min(1, Math.max(0, tau) / 4.5), e = sp * sp * (3 - 2 * sp);
          const c = at(Math.max(0, tau));
          const x = ox + c[0] + b.gx + (b.fx - b.gx) * e + 0.7 * Math.sin(1.3 * t + b.ph);
          const z = oz + c[2] + b.gz + (b.fz - b.gz) * e;
          const y = y0 + 0.25 + c[1] + b.fy * e + 0.5 * Math.sin(1.7 * t + 2 * b.ph) * e;
          const d = Math.hypot(x - moved, y - CAMERA_HEIGHT, z), s = b.s, thin = Math.max(0.045 * s, d * 0.0012);
          // fade only at the very end, when they are small and far
          const a = Math.max(0, Math.min(1, (11 - t) / 1.5));
          if (a > 0) any = true;
          if (tau < 0) {                                         // still on the ground: a hunched dark body
            set(packed, j, x, y, z, 0.16 * s, Math.max(0.09 * s, thin), 0.05, ...col, a);
            hide(packed, j + 1); hide(packed, j + 2); hide(packed, j + 3);
            continue;
          }
          // heading on screen: mostly along x, nosing up while it climbs
          const v = at(tau + 0.1), dir = Math.sign(v[0] - c[0] || 1), climb = Math.atan2(v[1] - c[1], Math.abs(v[0] - c[0]) + 0.3);
          const tilt = dir * Math.min(0.5, climb * 0.6);
          set(packed, j, x, y, z, 0.17 * s, Math.max(0.06 * s, thin), 0.05, ...col, a, tilt);
          set(packed, j + 1, x + dir * 0.18 * s * Math.cos(tilt), y + 0.18 * s * Math.sin(tilt) + 0.02 * s, z, 0.07 * s, Math.max(0.05 * s, thin), 0.05, ...col, a);
          // the wings: up (a V) or down (a shallow arch), gliding now and then once they are high
          const gliding = tau > 3.5 && Math.sin(0.7 * t + b.glide * 6.283) > 0.55;
          const up = gliding ? 0.2 : Math.sin(6.283 * b.hz * tau + b.ph) > 0 ? 1 : -0.45;
          const L = 0.56 * s, ang = up > 0 ? 0.62 * up : 0.5 * up;
          for (const side of [-1, 1]) {
            const wx = side * Math.cos(ang) * L * 0.5, wy = Math.sin(ang) * L * 0.5;
            set(packed, j + (side < 0 ? 2 : 3), x + wx, y + 0.02 * s + wy, z, L * 0.5, thin, 0.05, ...col, a, side * ang);
          }
        }
        touched(mesh, packed);
        return t < 12.5 && any;
      },
      hideAll() { mesh.visible = false; },
      dispose() { drop(mesh, packed); },
      splats: () => packed.numSplats,
    };
  }

  // =================================================================================================
  // 3. Fireworks over the distance: shells rise on a trail, burst into 80 to 160 light splats that
  // spread, slow, droop and fade, some with a second ring or a crackle, each lighting a glow in the
  // air round it. They are lights, so they keep their colour at night. One block of splats per
  // shell; only the shells alight are rewritten each frame.
  // =================================================================================================
  const FW_COLOURS = [[1.0, 0.2, 0.14], [1.0, 0.74, 0.32], [0.42, 1.0, 0.46], [0.45, 0.62, 1.0], [1.0, 0.97, 0.92], [0.86, 0.42, 1.0], [0.4, 0.95, 1.0], [1.0, 0.5, 0.75]];
  const TRAIL = 10;
  function makeFireworks(rng, ctx, strength) {
    const nShells = Math.round(5 + 4 * Math.min(1, strength) * (0.5 + 0.5 * rng()));
    const far = Math.max(1300, Math.min(2600, 0.75 * (ctx.biome.hazeDist || 3000)));
    const dBase = 900 + (far - 1100) * rng();
    const tanTop = ctx.tanHalfV * (1 + ctx.shift);
    const shells = [];
    let total = 0, launch = 0.15;
    for (let j = 0; j < nShells; j++) {
      const D = dBase * (0.85 + 0.3 * rng());
      const xr = ctx.tanHalfH * D * (-0.55 + 1.1 * rng()) + 0.25 * ctx.tanHalfH * D;   // a little ahead: they drift left
      const g = ctx.terrain.height(S.travelled + xr, D);
      const R = D * (0.11 + 0.06 * rng());                       // the burst's radius when it has spread
      const H = Math.max(150, Math.min(CAMERA_HEIGHT + tanTop * D * 0.8 - g - R, D * (0.14 + 0.16 * rng())));   // well clear of the skyline
      const type = ['peony', 'peony', 'ring', 'willow', 'crackle'][Math.floor(rng() * 5)];
      const c1 = FW_COLOURS[Math.floor(rng() * FW_COLOURS.length)];
      let c2 = FW_COLOURS[Math.floor(rng() * FW_COLOURS.length)]; if (c2 === c1) c2 = FW_COLOURS[4];
      const nStars = 80 + Math.floor(80 * rng()), nRing = type === 'ring' ? 40 + Math.floor(30 * rng()) : 0;
      const rise = 1.1 + 0.5 * rng();
      const stars = [];
      for (let i = 0; i < nStars + nRing; i++) {
        // directions spread evenly over a sphere (a spiral), jittered
        const inner = i >= nStars, m = inner ? nRing : nStars, k = inner ? i - nStars : i;
        const yy = 1 - 2 * (k + 0.5) / m, rr = Math.sqrt(1 - yy * yy), ph = k * 2.39996 + rng() * 0.3;
        const jit = 0.92 + 0.12 * rng();
        stars.push({ dx: Math.cos(ph) * rr * jit, dy: yy * jit, dz: Math.sin(ph) * rr * jit, inner, life: (type === 'willow' ? 2.8 : 2.0) * (0.8 + 0.4 * rng()), h: rng() });
      }
      shells.push({ D, xr, g, R, H, type, c1, c2, rise, launch, stars, base: total, count: TRAIL + stars.length + 2, live: false });
      total += TRAIL + stars.length + 2;
      launch += 0.5 + 1.2 * rng() * (j % 3 === 2 ? 0.4 : 1);   // now and then two close together
    }
    const end = Math.max(...shells.map((s) => s.launch + s.rise + 3.6));
    const packed = new PackedSplats();
    packed.ensureSplats(total);
    for (let i = 0; i < total; i++) push(packed, 0, 0, 100, 0.01, 0.01, 0.01, 0, 0, 0, 0);
    const mesh = meshOf(packed);
    const TAU = 0.42;
    function drawShell(sh, t) {
      const a0 = t - sh.launch, x = sh.xr, z = -sh.D, px = sh.D * 0.0021;   // about two pixels at this distance
      let i = sh.base;
      const burstY = sh.g + sh.H;
      // the rising trail: a head and sparks left behind it
      for (let k = 0; k < TRAIL; k++) {
        const ta = a0 - k * 0.07;
        if (a0 > sh.rise + 0.15 || ta < 0 || ta > sh.rise) { hide(packed, i++); continue; }
        const f = ta / sh.rise, y = sh.g + sh.H * (1 - (1 - f) * (1 - f));
        const wob = 0.004 * sh.D * Math.sin(ta * 9 + sh.D);
        set(packed, i++, x + wob, y, z, px * (k ? 1.1 : 1.6), px * (k ? 2.2 : 2.6), px, 1.0, 0.8, 0.5, k ? 0.75 * (1 - k / TRAIL) : 1);
      }
      const a = a0 - sh.rise;                                    // age of the burst
      for (const st of sh.stars) {
        const lifeLeft = a < 0 ? -1 : 1 - a / st.life;
        if (lifeLeft <= 0) { hide(packed, i++); continue; }
        const R = sh.R * (st.inner ? 0.55 : 1) * (sh.type === 'willow' ? 0.85 : 1);
        const spread = R * (1 - Math.exp(-a / TAU));
        const vt = sh.type === 'willow' ? 0.5 * R : 0.22 * R;   // how fast a spent star falls, m/s
        const droop = vt * (a - 1.1 * (1 - Math.exp(-a / 1.1)));
        const cx = x + st.dx * spread, cy = burstY + st.dy * spread - droop, cz = z + st.dz * spread;
        // the streak along the way it is going on screen (out, and more and more down)
        const vo = (R / TAU) * Math.exp(-a / TAU), vdn = vt * (1 - Math.exp(-a / 1.1));
        const vx = st.dx * vo, vy = st.dy * vo - vdn, sp = Math.hypot(vx, vy);
        const len = Math.max(px * 1.4, sp * 0.07);
        let c = st.inner ? sh.c2 : sh.c1, op = Math.min(1, 3 * lifeLeft) * (a < 0.12 ? 0.6 + 3.3 * a : 1);
        if (sh.type === 'willow') c = [1.0, 0.66 + 0.1 * st.h, 0.28];
        if (sh.type === 'crackle' && lifeLeft < 0.45) {         // the end of a crackle: white, flickering
          c = FW_COLOURS[4];
          op *= fract(Math.sin((st.h * 997 + Math.floor(a * 22)) * 12.9898) * 43758.5453) > 0.5 ? 1 : 0.1;
        }
        set(packed, i++, cx, cy, cz, len, px * 1.25, px, c[0], c[1], c[2], op, Math.atan2(vy, vx));
      }
      // the glow in the air round the burst, and a flash at its heart
      if (a < 0 || a > 3.2) { hide(packed, i++); hide(packed, i++); }
      else {
        const c = sh.type === 'willow' ? [1.0, 0.7, 0.32] : sh.c1;
        set(packed, i++, x, burstY - 0.15 * sh.R * a, z + 1, sh.R * 0.85, sh.R * 0.85, sh.R * 0.3, c[0], c[1], c[2], 0.22 * Math.exp(-a / 0.5) + 0.07 * Math.max(0, 1 - a / 3.2));
        set(packed, i++, x, burstY, z + 2, sh.R * 0.18, sh.R * 0.18, sh.R * 0.1, 1.0, 0.95, 0.85, 0.9 * Math.exp(-a / 0.09));
      }
    }
    return {
      update(t, moved) {
        mesh.position.x = -moved;
        let changed = false;
        for (const sh of shells) {
          const live = t >= sh.launch && t < sh.launch + sh.rise + 3.6;
          if (live || sh.live) { drawShell(sh, t); changed = true; }
          sh.live = live;
        }
        if (changed) touched(mesh, packed);
        return t < end;
      },
      hideAll() { mesh.visible = false; },
      dispose() { drop(mesh, packed); },
      splats: () => total,
    };
  }
  const fract = (v) => v - Math.floor(v);

  // =================================================================================================
  // 4. A meteor shower, drawn by the sky shader (sky.shower): eight to fourteen in about six seconds.
  // =================================================================================================
  function makeMeteors(rng, ctx, strength) {
    const n = Math.round(9 + 5 * Math.min(1, strength) * (0.5 + 0.5 * rng()));
    const end = sky.shower(n, 6, Math.floor(rng() * 1e9)) + 0.2;
    return {
      update(t) { sky.showerAt(t); return t < end; },
      hideAll() { sky.showerAt(-1); },
      dispose() { sky.showerAt(null); },
      splats: () => 0,
    };
  }

  // ---- choosing and running ---------------------------------------------------------------------
  const MAKERS = { train: makeTrain, flock: makeFlock, fireworks: makeFireworks, meteors: makeMeteors };
  function choose(kind, ctx) {
    // (a, b: the usual show and the other one; never the same show twice running)
    const pick = (a, b, pa) => { const k = Math.random() < pa ? a : b; return k === lastKind ? (k === a ? b : a) : k; };
    if (kind === 'drop') return ctx.night ? pick('fireworks', 'train', 0.75) : pick('train', 'flock', 0.7);
    if (kind === 'breakdown') return ctx.night ? (ctx.starsOut ? 'meteors' : null) : 'flock';
    return null;
  }
  function start(kind, ctx, { direct = false, strength = 1, seed } = {}) {
    end();
    const rng = makeRng(seed);
    const obj = MAKERS[kind](rng, ctx, strength);
    show = { kind, t: 0, direct, moved: 0, from: S.travelled, obj };
    lastKind = kind;
  }
  function end() { if (show) { show.obj.dispose(); show = null; } }

  // Once a frame. ctx: { dt, running, stopped, biome, terrain, tanHalfH, tanHalfV, shift }
  function update(ctx) {
    const on = (params.events ?? 1) > 0 && !reducedMotion;
    const lum = 0.3 * sky.lightTint.r + 0.59 * sky.lightTint.g + 0.11 * sky.lightTint.b;
    ctx.starsOut = sky.stars() > 0.05;
    ctx.night = ctx.starsOut || lum < 0.42;
    ctx.dusk = ctx.night || lum < 0.62;
    const tunnel = S.tunnel;
    // fire= in the URL (read each frame, so a script can change it): a kind of event goes through
    // the director; a show starts directly, once the view is running and out of any tunnel
    if ((params.fire || '') !== lastFire) { lastFire = params.fire || ''; pending = lastFire; }
    if (pending && ctx.running) {
      if (!on) pending = '';
      else if (pending === 'drop' || pending === 'breakdown') { director.fireEvent(pending); pending = ''; }
      else if (!MAKERS[pending]) pending = '';
      else if (!tunnel && !ctx.stopped) { fired++; start(pending, ctx, { direct: true, seed: hashInts(S.seed, 7001, fired) }); pending = ''; }
    }
    // the music's events (the director has already kept them out of tunnels, stops and quiet spells)
    const ev = S.event;
    if (ev && ev.seq !== lastSeq) {
      lastSeq = ev.seq;
      if (on && ctx.running && !ctx.stopped && !tunnel && S.time - ev.at < 2) {
        const kind = choose(ev.kind, ctx);
        if (kind) start(kind, ctx, { strength: ev.strength || 1, seed: hashInts(S.seed, 7002, ev.seq) });
      }
    }
    if (!show) return;
    if (!on || (tunnel && tunnel.phase === 'inside')) { end(); return; }
    // a held moment for a still; otherwise the show's own clock, which runs on when the train
    // stops (a show finishes rather than freezing), and the land it is set in slides past
    const pin = show.direct && params.eventT >= 0;
    if (pin) { show.t = params.eventT; show.moved = S.speed * show.t; }
    else { show.t += ctx.dt; show.moved = S.travelled - show.from; }
    if (!show.obj.update(show.t, show.moved, pin) && !pin) end();
  }

  return {
    update,
    busy: () => !!show,                    // the engine stays out of its idle mode while a show runs
    clear: end,                            // a change of scenery ends any show
    stats: () => (show ? { kind: show.kind, t: +show.t.toFixed(2), splats: show.obj.splats() } : null),
    dispose: end,
  };
}
