// A fast CPU preview of the code-made scenery: the same chunking, camera, projection, haze and
// motion blur as engine.js and sparkPatch.js, drawn back to front into a PNG in a second or two.
// It has no sky, frame or photo pieces and is not pixel-exact; use it to iterate on a biome, then
// confirm in the browser with window-shot.cjs.
//   node scripts/biome-preview.mjs out.png "seed=7&biome=downs&level=0&budget=300000&jump=4000&kmh=0" [WxH]
//   extra options: beat=<mast spacing m>, tint=r,g,b (time-of-day tint), hour=<0..24 passed to generators>
import fs from 'fs';
import zlib from 'zlib';
const APP = new URL('../src/window', import.meta.url).href;
const { getBiome } = await import(`${APP}/biomes/index.js?${Date.now()}`);
const { LAYERS, CAMERA_HEIGHT, neededChunks, expectedActive } = await import(`${APP}/layers.js`);
const { makeTerrain } = await import(`${APP}/terrain.js`);
const { hashInts, hashString, makeRng } = await import(`${APP}/rng.js`);
const { LEVELS } = await import(`${APP}/director.js`);

const out = process.argv[2];
const q = new URLSearchParams(process.argv[3] || '');
const [W, H] = (process.argv[4] || '960x540').split('x').map(Number);
const seed = hashString(q.get('seed') || '7');
const biome = getBiome(q.get('biome') || 'downs');
const level = Number(q.get('level') || 0);
const budget = Number(q.get('budget') || 300000);
const travelled = Number(q.get('jump') || 0);
const kmh = Number(q.has('kmh') ? q.get('kmh') : 100);
const beat = Number(q.get('beat') || 56);
const blurKeep = 0.6, shutter = 1 / 50;
const fov = 50, LEAD = 60;
const tanV = Math.tan((fov * Math.PI) / 360), tanH = tanV * (W / H);
const f = (H / 2) / tanV;
const terrain = makeTerrain(seed, biome.terrain);
const hazeDist = biome.hazeDist || 3000;
const haze = [0.72, 0.8, 0.88];
const tint = q.has('tint') ? q.get('tint').split(',').map(Number) : [1, 1, 1];
const motion = (kmh / 3.6) * shutter;

const splats = [];
let genMs = 0;
const only = q.get('layers') ? q.get('layers').split(',') : null;
for (const layer of LAYERS) {
  if (only && !only.includes(layer.name)) continue;
  const { first, last } = neededChunks(layer, travelled, tanH, LEAD);
  const count = Math.max(200, Math.round((budget * layer.share) / expectedActive(layer, tanH, LEAD)));
  for (let index = first; index <= last; index++) {
    const x0 = index * layer.chunkLen;
    const ctx = {
      rng: makeRng(hashInts(seed, layer.name.length * 131 + layer.name.charCodeAt(0), index)),
      x0, length: layer.chunkLen, zNear: layer.zNear, zFar: layer.zFar, count, index, terrain, palette: biome.palette,
      dials: { ...LEVELS[level] }, level, beatMetres: beat, layer: layer.name, seed, hour: Number(q.get("hour") || 12),
    };
    const emit = (x, y, z, sx, sy, sz, r, g, b, o = 1, qx = 0, qy = 0, qz = 0, qw = 1) => splats.push([x0 + x, y, z, sx, sy, sz, r, g, b, o, qx, qy, qz, qw]);
    const t0 = performance.now();
    const gen = (biome.generators[layer.name])(ctx, emit);
    while (!gen.next().done);
    genMs += performance.now() - t0;
  }
}
// sort far to near
splats.sort((a, b) => a[2] - b[2]);
const img = new Float32Array(W * H * 3);
for (let y = 0; y < H; y++) {
  const t = Math.min(1, Math.max(0, ((H - y) / H - 0.45) / 0.55)); const s = t * t * (3 - 2 * t);
  for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; img[i] = 0.72 + (0.25 - 0.72) * s; img[i + 1] = 0.8 + (0.45 - 0.8) * s; img[i + 2] = 0.88 + (0.8 - 0.88) * s; }
}
let drawn = 0;
for (const sp of splats) {
  const [wx, y, z, sx, sy, sz, r, g, b, o, qx, qy, qz, qw] = sp;
  const X = wx - travelled, Y = y - CAMERA_HEIGHT, Z = -z;   // Z = depth > 0
  if (Z < 0.1) continue;
  // rotation matrix
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wxq = qw * qx, wy = qw * qy, wz = qw * qz;
  const R = [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy), 2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wxq), 2 * (xz - wy), 2 * (yz + wxq), 1 - 2 * (xx + yy)];
  const S = [sx * sx, sy * sy, sz * sz];
  const C = new Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = R[i * 3] * R[j * 3] * S[0] + R[i * 3 + 1] * R[j * 3 + 1] * S[1] + R[i * 3 + 2] * R[j * 3 + 2] * S[2];
  // screen: u = f X / Z, v = -f Y / Z (z in splat coords is -Z, so dZ/dz = -1)
  const J = [f / Z, 0, f * X / (Z * Z), 0, -f / Z, -f * Y / (Z * Z)];
  // J acts on (x, y, z) where z = -Z: du/dz = du/dZ * dZ/dz = -(-f X / Z^2) = f X / Z^2
  const JC = [0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) JC[i * 3 + j] = J[i * 3] * C[j] + J[i * 3 + 1] * C[3 + j] + J[i * 3 + 2] * C[6 + j];
  let a = JC[0] * J[0] + JC[1] * J[1] + JC[2] * J[2] + 0.3;
  const bb = JC[0] * J[3] + JC[1] * J[4] + JC[2] * J[5];
  const d = JC[3] * J[3] + JC[4] * J[4] + JC[5] * J[5] + 0.3;
  const detOrig = a * d - bb * bb;
  const mpx = f * motion / Z;
  a += (mpx * mpx) / 12;
  const det = a * d - bb * bb;
  const blurAdjust = Math.sqrt(Math.max(0, detOrig / det)) * (1 - blurKeep) + blurKeep;
  const u0 = W / 2 + f * X / Z, v0 = H / 2 - f * Y / Z;
  const rx = 3 * Math.sqrt(a), ry = 3 * Math.sqrt(d);
  if (u0 + rx < 0 || u0 - rx > W || v0 + ry < 0 || v0 - ry > H) continue;
  const ia = d / det, ib = -bb / det, id = a / det;
  const hz = 1 - Math.exp(-Z / hazeDist);
  const glow = Math.max(r, g, b) >= 0.97 ? 1 : 0;
  const cr = (r * (glow ? 1 : tint[0])) * (1 - hz) + haze[0] * hz, cg = (g * (glow ? 1 : tint[1])) * (1 - hz) + haze[1] * hz, cb = (b * (glow ? 1 : tint[2])) * (1 - hz) + haze[2] * hz;
  const op = o * blurAdjust;
  const xa = Math.max(0, Math.floor(u0 - rx)), xb = Math.min(W - 1, Math.ceil(u0 + rx));
  const ya = Math.max(0, Math.floor(v0 - ry)), yb = Math.min(H - 1, Math.ceil(v0 + ry));
  for (let py = ya; py <= yb; py++) {
    const dy = py + 0.5 - v0;
    for (let px = xa; px <= xb; px++) {
      const dx = px + 0.5 - u0;
      const e = ia * dx * dx + 2 * ib * dx * dy + id * dy * dy;
      if (e > 9) continue;
      const al = Math.min(0.99, op * Math.exp(-0.5 * e));
      const i = (py * W + px) * 3;
      img[i] += (cr - img[i]) * al; img[i + 1] += (cg - img[i + 1]) * al; img[i + 2] += (cb - img[i + 2]) * al;
    }
  }
  drawn++;
}
// PNG
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0;
  for (let x = 0; x < W * 3; x++) raw[y * (W * 3 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(Math.pow(Math.min(1, img[y * W * 3 + x]), 1) * 255)));
}
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (buf) => { let c = -1; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
fs.writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${out}: ${splats.length} splats, ${drawn} drawn, gen ${genMs.toFixed(0)} ms`);
