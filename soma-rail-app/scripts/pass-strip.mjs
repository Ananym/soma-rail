// One object seen across a whole pass, in one image: the same thing at five angles from the window,
// from well to the left of the frame, through dead ahead, to well to the right. Things built to
// be seen face on (one-sided sheets, half cylinders, rows of beads, facades with no sides) fall
// apart into loose splats at the sides of the frame; this is how to catch them before a GPU does.
//   node scripts/pass-strip.mjs <out.png> "seed=7&biome=saltflat&level=0&budget=600000" --x 9013 --d 94
//        [--angles -36,-20,0,20,36] [--y 5] [--crop 360x360] [--size 1920x1080] [--kmh 0]
//   --x, --d   where the object stands: metres along the line (world x) and distance from the track
//   --y        height above rail level to centre the crop on (default 5)
//   --angles   degrees from straight ahead; negative = the object is to the left of the frame
// Each tile is a crop of a full CPU preview (scripts/biome-preview.mjs), so it shares its limits: no
// sky, not pixel-exact, and no motion. Extra query options pass through (tint, haze, hour, ...).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const out = args[0];
const query = args[1] && !args[1].startsWith('--') ? args[1] : '';
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
if (!out || opt('x') == null || opt('d') == null) { console.error('usage: pass-strip.mjs <out.png> "<query>" --x <world x> --d <distance> [--angles ...] [--y m] [--crop WxH] [--size WxH] [--kmh n]'); process.exit(2); }
const X = Number(opt('x')), D = Number(opt('d')), Y = Number(opt('y', 5));
const angles = opt('angles', '-36,-20,0,20,36').split(',').map(Number);
const [W, H] = opt('size', '1920x1080').split('x').map(Number);
const [CW, CH] = opt('crop', '360x360').split('x').map(Number);
const kmh = opt('kmh', '0');
const CAMERA_HEIGHT = 2.6, f = (H / 2) / Math.tan((50 * Math.PI) / 360);

function readPng(file) {           // the previewer's own PNGs: 8-bit RGB, one IDAT, no filtering
  const b = fs.readFileSync(file);
  const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
  let p = 8, idat = [];
  while (p < b.length) { const len = b.readUInt32BE(p), type = b.toString('latin1', p + 4, p + 8); if (type === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len)); p += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  return { w, h, px: (x, y) => { const o = y * (w * 3 + 1) + 1 + x * 3; return [raw[o], raw[o + 1], raw[o + 2]]; } };
}
function writePng(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (buf) => { let c = -1; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

const GAP = 6;
const sheetW = angles.length * CW + (angles.length - 1) * GAP;
const sheet = Buffer.alloc(sheetW * CH * 3, 30);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pass-strip-'));
angles.forEach((deg, k) => {
  const t = Math.tan((deg * Math.PI) / 180);
  const jump = X - D * t;                                  // the camera stands here: the object is `deg` off the axis
  const file = path.join(tmp, `a${k}.png`);
  const q = `${query}${query ? '&' : ''}jump=${jump.toFixed(1)}&kmh=${kmh}`;
  const r = spawnSync(process.execPath, [path.join(here, 'biome-preview.mjs'), file, q, `${W}x${H}`], { encoding: 'utf8' });
  if (r.status !== 0) { console.error(r.stderr || r.stdout); process.exit(1); }
  const img = readPng(file);
  const cx = Math.round(W / 2 + f * t), cy = Math.round(H / 2 - (f * (Y - CAMERA_HEIGHT)) / D);
  const x0 = Math.max(0, Math.min(W - CW, cx - (CW >> 1))), y0 = Math.max(0, Math.min(H - CH, cy - (CH >> 1)));
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
    const c = img.px(x0 + x, y0 + y), o = (y * sheetW + k * (CW + GAP) + x) * 3;
    sheet[o] = c[0]; sheet[o + 1] = c[1]; sheet[o + 2] = c[2];
  }
  // a tick under each tile: longer towards the side the object is on
  const tick = Math.round((CW / 2) * Math.min(1, Math.abs(deg) / 40));
  for (let x = 0; x < tick; x++) for (let y = CH - 4; y < CH; y++) { const xx = deg < 0 ? x : CW - 1 - x, o = (y * sheetW + k * (CW + GAP) + xx) * 3; sheet[o] = 255; sheet[o + 1] = 210; sheet[o + 2] = 60; }
});
writePng(out, sheetW, CH, sheet);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${out}: ${angles.length} views of x=${X} d=${D} at ${angles.join(', ')} degrees (yellow tick: which side of the frame, and how far)`);
