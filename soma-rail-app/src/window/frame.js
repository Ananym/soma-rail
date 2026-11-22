// The carriage window frame, fixed to the camera.
// createFrame(THREE) -> { object3d, resize(aspect, fovDeg), update(time, shake) }
//
// Intercity-style window surround: one wide rounded-rectangle opening, seen from inside a dim cabin.
// There are no lights in the scene, so the soft shading is faked with vertex colours on unlit
// materials. Stacked layers, nearest to the eye first:
//   1. gasket   - thin, darkest rubber seal hugging the glass opening
//   2. bevel    - slightly lighter reveal facing the window; much wider along the bottom (the sill ledge)
//   3. falloff  - a soft fade from the bevel tone into the wall tone (no hard edge)
//   4. wall     - a big flat panel (Shape + hole -> ShapeGeometry) that extends far beyond the screen
//   + a faint dark band at the very top suggesting a blind housing.
// Each layer sits a few mm nearer the eye than the next and is scaled about the camera so that it
// projects to exactly the same screen position as if it were on the wall plane. That gives depth
// ordering without z-fighting and without seams or slivers between layers.
//
// All lengths below are fractions of the visible shorter side at the wall plane, so the frame scales
// with screen size; resize() rebuilds everything for the current aspect / fov.

const D = 0.6; // wall plane distance from the eye, metres (near plane is 0.05, scenery starts at 2.5)
const CORNER_SEGS = 20; // segments per rounded corner: smooth at any resolution

export function createFrame(THREE) {
  const object3d = new THREE.Group();
  object3d.name = 'window-frame';

  // Colours are display-referred sRGB written as-is. Vertex colours are read by three as linear and
  // converted back on output, so convert on write (setRGB with SRGBColorSpace) to round-trip them.
  const tmp = new THREE.Color();
  const srgb = (v) => { tmp.setRGB(v, v, v, THREE.SRGBColorSpace); return [tmp.r, tmp.g, tmp.b]; };
  // Neutral, slightly warm-free greys; the cabin is dimmer than outside.
  const C = {
    gasketIn: 0.060, gasketOut: 0.030,
    bevelIn: 0.190, bevelOut: 0.125,       // lit edge facing the glass -> falling away
    sillIn: 0.235, sillOut: 0.140,          // the sill top catches more light
    wall: 0.095, band: 0.040,
  };

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide, toneMapped: false, fog: false,
    transparent: false, depthWrite: true, depthTest: true,
  });

  let meshes = [];

  function clearMeshes() {
    for (const m of meshes) { object3d.remove(m); m.geometry.dispose(); }
    meshes = [];
  }

  // Closed rounded-rectangle outline with a fixed point count (so two outlines can be stitched into
  // a strip). Counter-clockwise from the right edge of the top-right corner.
  function outline(l, r, b, t, rad) {
    rad = Math.max(1e-4, Math.min(rad, (r - l) / 2 - 1e-4, (t - b) / 2 - 1e-4));
    const pts = [];
    const corners = [[r - rad, t - rad, 0], [l + rad, t - rad, 0.5], [l + rad, b + rad, 1], [r - rad, b + rad, 1.5]];
    for (const [cx, cy, a0] of corners) {
      for (let i = 0; i <= CORNER_SEGS; i++) {
        const a = (a0 + (i / CORNER_SEGS) * 0.5) * Math.PI;
        pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
      }
    }
    return pts;
  }

  // Strip of triangles between consecutive loops [{pts, col}], vertex-coloured per loop.
  function strip(loops) {
    const n = loops[0].pts.length, pos = [], col = [], idx = [];
    for (const { pts, col: c } of loops) {
      const rgb = srgb(c);
      for (const [x, y] of pts) { pos.push(x, y, 0); col.push(...rgb); }
    }
    for (let k = 0; k < loops.length - 1; k++) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = k * n + i, b = k * n + j, c = (k + 1) * n + i, d = (k + 1) * n + j;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }

  function addLayer(geometry, lift, order) {
    const m = new THREE.Mesh(geometry, material);
    const d = D - lift; // actual distance from the eye
    m.position.z = -d;
    m.scale.setScalar(d / D); // keeps its screen projection identical to the wall plane
    m.renderOrder = order;
    m.frustumCulled = false;
    object3d.add(m);
    meshes.push(m);
  }

  function resize(aspect, fovDeg) {
    clearMeshes();
    const H = 2 * D * Math.tan((fovDeg * Math.PI) / 360);
    const W = H * aspect;
    const hw = W / 2, hh = H / 2;

    // Margins as fractions of the screen's shorter side U (its height, in a landscape window).
    // Spec at 16:9: top <= 6%, bottom <= 9%, sides 4-5% of width. In a window taller than wide the
    // same surround is kept in proportion to the width, so a phone held upright gets a tall window
    // with a frame no heavier than it has on its side.
    const U = Math.min(H, W);
    const top = 0.052 * U, bottom = 0.080 * U;
    const side = aspect >= 1 ? Math.min(0.075, Math.max(0.024, 0.042 * aspect)) * H : 0.045 * W;
    const L = -hw + side, R = hw - side, T = hh - top, B = -hh + bottom;
    const rad = 0.16 * Math.min(R - L, T - B); // proportional to the smaller dimension

    // Layer widths (fractions of U), sill much deeper than the rest.
    const gk = 0.005, gkSill = 0.007;
    const bv = 0.009, bvSill = 0.026;
    const fo = 0.030, foSill = 0.030;
    // Cumulative outlines, all with the same point count.
    const O0 = outline(L, R, B, T, rad);
    const O1 = outline(L - gk * U, R + gk * U, B - gkSill * U, T + gk * U, rad + gk * U);
    const O2 = outline(L - (gk + bv) * U, R + (gk + bv) * U, B - (gkSill + bvSill) * U, T + (gk + bv) * U, rad + (gk + bv) * U);
    const O3 = outline(L - (gk + bv + fo) * U, R + (gk + bv + fo) * U, B - (gkSill + bvSill + foSill) * U, T + (gk + bv + fo) * U, rad + (gk + bv + fo) * U);

    // Strips take one colour per loop, so the bevel uses the mean of the side and sill tones.
    const bevelIn = (C.bevelIn + C.sillIn) / 2, bevelOut = (C.bevelOut + C.sillOut) / 2;

    // 4. wall: Shape with the opening cut out. Extends well beyond the screen so motion never shows an edge.
    const ext = 1.5;
    const shape = new THREE.Shape();
    shape.moveTo(-hw * ext - 0.1, -hh * ext - 0.1);
    shape.lineTo(hw * ext + 0.1, -hh * ext - 0.1);
    shape.lineTo(hw * ext + 0.1, hh * ext + 0.1);
    shape.lineTo(-hw * ext - 0.1, hh * ext + 0.1);
    shape.closePath();
    const hole = new THREE.Path();
    O0.forEach(([x, y], i) => (i ? hole.lineTo(x, y) : hole.moveTo(x, y)));
    hole.closePath();
    shape.holes.push(hole);
    const wall = new THREE.ShapeGeometry(shape);
    const n = wall.attributes.position.count, wc = srgb(C.wall), arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set(wc, i * 3);
    wall.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    addLayer(wall, 0, 1000);

    // Blind-housing hint: a barely darker band at the very top, fading into the wall below it.
    {
      const x = hw * ext + 0.1, yTop = hh * ext + 0.1, yFade = hh - 0.040 * U, yEdge = hh - 0.004 * U;
      const g = new THREE.BufferGeometry();
      const lo = srgb(C.wall), mid = srgb(C.band), hi = srgb(C.band);
      g.setAttribute('position', new THREE.Float32BufferAttribute([
        -x, yFade, 0, x, yFade, 0, -x, yEdge, 0, x, yEdge, 0, -x, yTop, 0, x, yTop, 0], 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute([...lo, ...lo, ...mid, ...mid, ...hi, ...hi], 3));
      g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
      addLayer(g, 0.002, 1001);
    }

    // 3. falloff: soft fade bevel -> wall (inner loops sit under the nearer layers, flat coloured)
    addLayer(strip([
      { pts: O0, col: bevelOut }, { pts: O2, col: bevelOut }, { pts: O3, col: C.wall },
    ]), 0.004, 1002);

    // 2. bevel: lit reveal facing the glass. Inner part flat under the gasket.
    addLayer(strip([
      { pts: O0, col: bevelIn }, { pts: O1, col: bevelIn }, { pts: O2, col: bevelOut },
    ]), 0.008, 1003);

    // 1. gasket: thin dark rubber seal, a touch lighter at the glass side to read as rounded.
    addLayer(strip([
      { pts: O0, col: C.gasketIn }, { pts: O1, col: C.gasketOut },
    ]), 0.012, 1004);
  }

  // Independent, tiny motion relative to the camera: a few incommensurate sines. Exactly still at shake 0.
  function update(time, shake) {
    const s = Math.max(0, Math.min(1, shake || 0));
    if (s === 0) {
      object3d.position.set(0, 0, 0);
      object3d.rotation.set(0, 0, 0);
      return;
    }
    const t = time;
    const mm = 0.001;
    object3d.position.set(
      s * mm * (0.9 * Math.sin(t * 7.3) + 0.6 * Math.sin(t * 11.9 + 1.3) + 0.4 * Math.sin(t * 3.1 + 0.4)),
      s * mm * (1.1 * Math.sin(t * 9.1 + 2.1) + 0.5 * Math.sin(t * 5.3 + 0.7) + 0.4 * Math.sin(t * 13.7)),
      0,
    );
    object3d.rotation.set(
      s * 0.0006 * Math.sin(t * 6.1 + 0.9),
      s * 0.0006 * Math.sin(t * 8.3 + 2.4),
      s * 0.0012 * (Math.sin(t * 4.7 + 1.7) + 0.5 * Math.sin(t * 10.3)),
    );
  }

  return { object3d, resize, update };
}
