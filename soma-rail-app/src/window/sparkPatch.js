// Patches Spark's default splat vertex shader with the camera effects this view needs.
//
// Spark does not export its default shader, so we read it from a SparkRenderer's material and
// insert a few lines at known anchors. The anchors are checked: if a Spark upgrade moves them,
// buildVertexShader() returns null and the engine runs unpatched (no blur or haze) and says so.
// Written against @sparkjsdev/spark 2.4.0; keep that version pinned in package.json.

export const PATCH_UNIFORMS = () => ({
  uMotionMetres: { value: 0 },      // speed * shutter, metres of smear along the track
  uBlurKeep: { value: 0.6 },        // 0 = energy-conserving blur (thin layers fade), 1 = keep opacity
  uHazeColor: { value: null },      // THREE.Color, set by the engine
  uHazeHigh: { value: null },       // THREE.Color: the sky 15 degrees up, for tall distant land
  uHazeDist: { value: 2500 },       // metres at which haze reaches 63%
  uLightTint: { value: null },      // THREE.Color multiplied into every splat
  uDissolve: { value: 0 },          // 0..1, scatters splats ("matter" dial)
  uBreath: { value: 0 },            // small scale pulse from the bass
  uBeat: { value: 0 },              // 0..1, jumps on each onset (kick, snare) and decays in a fraction of a second
  uSparkle: { value: 0 },           // 0..1, follows the treble (hi-hats, cymbals, air)
  uClock: { value: 0 },             // seconds, for the sparkle's flicker
  uBeatRaised: { value: 1 },        // 1: everything above eye level swells on the beat; 0: only splats tagged for it
  uMove: { value: 0 },              // strength of the motion classes (flags, traffic, vapour); 0 = everything still
  uMoveT: { value: 0 },             // seconds of motion time; stands still while the train does
  uTravel: { value: 0 },            // metres travelled (wrapped), so patterns can be pinned to the world
  uFlowWith: { value: null },       // THREE.Vector3: per-lane pattern offsets (m) for traffic going the train's way
  uFlowAgainst: { value: null },    // ... and for traffic coming the other way
  uFall: { value: null },           // THREE.Vector2: metres fallen by snow (x) and rain (y), wrapped at 16
  uFly: { value: 0 },               // metres travelled, wrapped at 2048 flight cells of 24 m
  uMoveDebug: { value: 0 },         // 1 paints each motion class a flat colour, to check the tagging
});

const EDITS = [
  {
    anchor: 'uniform float focalAdjustment;',
    insert: `
uniform float uMotionMetres;
uniform float uBlurKeep;
uniform vec3 uHazeColor;
uniform vec3 uHazeHigh;
uniform float uHazeDist;
uniform vec3 uLightTint;
uniform float uDissolve;
uniform float uBreath;
uniform float uBeat;
uniform float uSparkle;
uniform float uClock;
uniform float uBeatRaised;
uniform float uMove;
uniform float uMoveT;
uniform float uTravel;
uniform float uMoveDebug;
uniform vec3 uFlowWith;
uniform vec3 uFlowAgainst;
uniform vec2 uFall;
uniform float uFly;`,
  },
  {
    // scatter and breathe, before the splat is moved into view space
    anchor: 'rgba.rgb = max(rgba.rgb, vec3(0.0));',
    insert: `
    // Motion class: three bits carried in the lowest bit of each colour channel (see tagLast below).
    float mvBlur = 1.0;   // how much of the world's motion blur this splat takes
    ivec3 mvBits = ivec3(floor(rgba.rgb * 255.0 + 0.5)) & 1;
    int mv = mvBits.r | (mvBits.g << 1) | (mvBits.b << 2);
    if (uMove > 0.0 && mv != 0) {
        // Things that move. Every phase is built from wrapped inputs whose wrap is a whole number of
        // cycles (uMoveT and uTravel wrap at 200 pi; every multiplier on them is a multiple of 0.01),
        // so nothing jumps when they wrap. center.z never changes as the world scrolls and center.y
        // only by the camera's millimetre shake, so they may enter a phase smoothly but never a hash.
        float wx = center.x + uTravel;                 // metres along the line
        if (mv == 1) {
            // Flags and banners: a ripple running along the string, sized by the flag itself, in gusts.
            float sz = max(scales.x, scales.y);
            float ph = 5.6 * uMoveT + 1.3 * wx + 0.9 * center.z + 2.0 * center.y;   // the y term runs the ripple down a hanging banner
            float gust = 0.55 + 0.45 * sin(0.6 * uMoveT + 0.05 * wx);
            float amp = uMove * gust * sz;
            center.x += amp * 1.1 * sin(ph);
            center.y += amp * 0.3 * sin(1.7 * ph + 1.3);
            scales.x *= 1.0 + 0.35 * min(uMove, 1.0) * gust * sin(1.3 * ph + 2.0);
        } else if (mv == 4 && max(rgba.r, max(rgba.g, rgba.b)) < 0.86) {
            // Flight (class 4 on a splat that is not a light: see kit.js flightCell, flyBody, flyWing).
            // A bird, or a flock, lives in one 24 m cell of the line and flies along it: with the
            // train in even cells, against it in odd ones. Its place is a matter of where the train
            // is, not of the clock: level with its cell it is at home, and before and after it is
            // carried a fraction k of the way the train has still to come or has gone, which is
            // exactly a bird flying at k times the train's speed. So it slides back through the
            // window more slowly than the land (or faster, flying the other way), never jumps, and
            // stops when the train does. Its wings have two frames: a wing piece carries its height
            // above the wing root in its thin axis (a fiftieth of it), and in bursts the pieces drop
            // below the root and come back.
            float cellI = floor((center.x + uFly) / 24.0 + 0.5);
            float home = cellI * 24.0 - uFly;                           // the cell's middle, from the eye
            float hf = fract(sin(mod(cellI, 2048.0) * 12.9898) * 43758.5453);   // the same cell either side of uFly's wrap
            float kf = (mod(cellI, 2.0) < 0.5 ? 1.0 : -1.0) * (0.24 + 0.12 * hf) * min(uMove, 1.0);
            center.x -= kf * home;
            mvBlur = 1.0 - kf;
            float lift = scales.z * 50.0;
            scales.z = scales.y;
            float ph = 6.2832 * hf;
            float flap = step(0.15, sin(0.9 * uMoveT + ph)) * step(0.0, sin(11.0 * uMoveT + 3.0 * ph));
            center.y -= 1.7 * lift * flap * min(uMove, 1.0);
        } else if (mv <= 4 && max(rgba.r, max(rgba.g, rgba.b)) < 0.86) {
            // Spin (classes 2 and 3 on a splat that is not a light: see kit.js blade()). The splat is a
            // piece of a blade on a rotor that faces the track. Its long axis points away from the
            // hub, and its thin axis carries the distance to the hub (a hundredth of it), so the hub
            // can be found again here; the piece is carried round it and turned with it.
            vec3 ax = quatVec(quaternion, vec3(1.0, 0.0, 0.0));
            vec3 off = ax * scales.z * 100.0;
            float ang = min(uMove, 1.0) * uMoveT * (mv == 2 ? 1.4 : 2.6);
            float cs = cos(ang), sn = sin(ang);
            center += vec3(cs * off.x - sn * off.y, sn * off.x + cs * off.y, off.z) - off;
            quaternion = quatQuat(vec4(0.0, 0.0, sin(0.5 * ang), cos(0.5 * ang)), quaternion);
        } else if (mv <= 4) {
            // Traffic. Each lane is a continuous line of small light splats, and the shader lights
            // only those that fall on a vehicle's lamps: white headlamps and a short pool of beam
            // at the front, red tail lamps at the back, and along a lorry's flank a row of amber
            // markers. One vehicle at most per 48 m of lane, placed in the traffic's own frame (the
            // CPU sends where that frame has got to), so vehicles follow every bend of the road.
            // The lane's baked colour says which way it runs (red: the train's way) and is read
            // before it is replaced. Every lamp colour keeps red at 1, so each stays a light.
            int lane = mv - 2;
            bool sameWay = rgba.g < 0.4 * rgba.r;
            float dirS = sameWay ? 1.0 : -1.0;
            float u = (center.x + (sameWay ? uFlowWith[lane] : uFlowAgainst[lane])) / 48.0;
            float cell = mod(floor(u), 4096.0);
            vec3 hc = fract(sin(vec3(cell * 12.9898 + float(lane) * 37.7 + (sameWay ? 5.0 : 0.0), cell * 78.233 + float(lane) * 11.3, cell * 37.719 + float(lane) * 3.1)) * 43758.5453);
            float present = step(0.42, hc.x);
            float lorry = step(lane == 2 ? 0.45 : 0.92, hc.z);
            float halfL = mix(2.1, 6.5, lorry);
            float f = (fract(u) - (0.25 + 0.5 * hc.y)) * 48.0 * dirS;      // metres ahead of the vehicle's middle
            // A lamp is one lane splat, the one nearest the lamp, slid along the lane to the lamp's
            // exact place: so lamps glide instead of hopping between the fixed splats. The lane's
            // spacing is read off the splat's own baked length (0.72 of the spacing).
            float sp = scales.x / 0.72;
            float dh = f - halfL, dtl = f + halfL;
            float mk = floor(f / 2.4 + 0.5) * 2.4;                          // nearest side-marker position
            float head = step(abs(dh), 0.53 * sp);                          // a shade wide: the spacing is only known to a few per cent
            float tail = step(abs(dtl), 0.5 * sp) * (1.0 - head);
            float side = lorry * step(abs(f - mk), 0.5 * sp) * step(abs(mk), halfL - 1.0) * (1.0 - head) * (1.0 - tail);
            float beam = 0.3 * step(0.5 * sp, dh) * exp(-dh / 5.0);         // a short pool of light ahead
            float slide = -(head * dh + tail * dtl + side * (f - mk)) * dirS;
            float sum = head + 0.9 * tail + beam + 0.3 * side;
            vec3 lamp = (vec3(1.0, 0.97, 0.88) * (head + beam) + vec3(1.0, 0.1, 0.07) * 0.9 * tail + vec3(1.0, 0.6, 0.15) * 0.3 * side) / max(sum, 0.001);
            float k = min(uMove, 1.0);
            center.x += slide * k;
            rgba.rgb = mix(rgba.rgb, lamp, k);
            rgba.a = mix(rgba.a, present * min(1.0, sum), k);
            float point = head + tail + side;                               // 1 for a lamp, 0 for beam or dark lane
            scales.x = mix(scales.x, mix(scales.x, 0.3 + 0.12 * head, point), k);
            scales.yz *= mix(1.0, 0.9 + 1.0 * head + 0.5 * tail - 0.2 * side, k);
        } else if (mv == 5) {
            // Vapour (plumes, mist, cloud streamers): a slow billow, each splat on its own phase.
            float sz = max(scales.x, max(scales.y, scales.z));
            // (the hash is kept apart from the wx terms so that each sine's multiplier on wx stays a
            // whole multiple of 0.01: scaling a combined phase would break the wrap rule above)
            float hp = 6.2832 * fract(sin(center.z * 78.233) * 43758.5453);
            float amp = uMove * sz;
            center.x += amp * 0.3 * sin(0.31 * uMoveT + hp + 0.02 * wx + 0.015 * center.y);
            center.y += amp * 0.12 * sin(0.23 * uMoveT + 1.7 * hp + 0.03 * wx + 0.025 * center.y);
            scales *= 1.0 + 0.1 * min(uMove, 1.0) * sin(0.4 * uMoveT + 2.3 * hp + 0.05 * wx + 0.035 * center.y);
        } else if (mv == 7) {
            // Falling things. Snow (a round splat) drifts down slowly with a sway; rain (a splat at
            // least 2.5 times taller than wide) falls fast and straight. Each keeps its place along
            // and across the line and falls through a 16 m column round the eye's height, coming
            // round again at the top; it fades in and out at the ends of the column. The CPU sends
            // how far each kind has fallen, already wrapped.
            float rain = step(2.5, scales.y / max(scales.x, 0.0001));
            float hp = fract(sin(center.z * 78.233) * 43758.5453);
            float yy = mod(center.y - mix(uFall.x, uFall.y, rain) + 6.0, 16.0) - 6.0;
            center.y = mix(center.y, yy, min(uMove, 1.0));
            center.x += (1.0 - rain) * uMove * 0.35 * sin(0.9 * uMoveT + 6.2832 * hp);
            rgba.a *= smoothstep(-6.0, -4.8, yy) * (1.0 - smoothstep(8.8, 10.0, yy));
        }
    }
    if (uDissolve > 0.0) {
        // Keyed to the splat's distance from the track, which never changes as the world scrolls:
        // the scatter is steady, and things at one distance (a facade, a wire) drift together.
        // (Keying it to the splat's index would re-roll everything each time a chunk came or went.)
        vec3 hsh = fract(sin(vec3(center.z) * vec3(12.9898, 78.233, 37.719)) * 43758.5453) - 0.5;
        center += hsh * uDissolve * (0.05 * length(center) + 0.3);
    }
    // Music. center is relative to the eye, so center.y / distance is the elevation: raised picks
    // out what stands above eye level (trees, buildings, towers, mesas) and leaves the ground alone.
    // On each beat those things, and every light, swell a little and fall back; the bass adds a slower
    // breath to everything. The treble makes raised things shimmer and lights twinkle (see below).
    // A biome whose high ground is the scenery itself (limestone towers, dunes) turns the raised rule
    // off and names what should answer the beat instead (class 6, see kit.js MOVE.BEAT and a biome's
    // beatKinds). A swell alone hardly shows on a mass of overlapping splats, so the chosen things
    // also brighten for the length of the beat: still below the level that would make them lights.
    float raised = uBeatRaised * smoothstep(0.0, 0.07, center.y / max(length(center), 1.0));
    float isLight = smoothstep(0.86, 0.98, max(rgba.r, max(rgba.g, rgba.b)));
    float picked = mv == 6 ? 1.0 : 0.0;
    scales *= 1.0 + uBreath + uBeat * (0.1 * raised + 0.32 * isLight + 0.16 * picked);
    float shimmer = 1.0 + 0.38 * uBeat * picked * (1.0 - isLight);
    if (uSparkle > 0.0) {
        float tw = fract(sin(float(splatIndex) * 12.9898 + floor(uClock * 9.0) * 78.233) * 43758.5453);
        shimmer *= 1.0 + uSparkle * (tw - 0.5) * (0.2 * max(raised, picked) + 0.6 * isLight);
    }`,
  },
  {
    // light and haze: tint, then mix toward the horizon colour with distance
    anchor: 'vRgba = rgba;',
    insert: `
    {
        // Colours with a channel near 1.0 are treated as light sources (lamps, lit windows):
        // they ignore the time-of-day tint. Natural surfaces should keep every channel below 0.8.
        float glow = smoothstep(0.86, 0.98, max(rgba.r, max(rgba.g, rgba.b)));
        float hz = 1.0 - exp(viewCenter.z / max(uHazeDist, 1.0));
        // haze toward the sky colour at the splat's own elevation, so far hills meet the sky at twilight
        vec3 hazeCol = mix(uHazeColor, uHazeHigh, smoothstep(0.0, 0.2588, viewCenter.y / length(viewCenter)));
        vRgba.rgb = mix(rgba.rgb * mix(uLightTint, vec3(1.0), glow) * shimmer, hazeCol, hz * (1.0 - 0.5 * glow));
        if (uMoveDebug > 0.5) {
            vRgba.rgb = mv == 0 ? vRgba.rgb * 0.35 : vec3(float(mv & 1), float((mv >> 1) & 1), float((mv >> 2) & 1)) * 0.8 + 0.2;
        }
    }`,
  },
  {
    // motion blur: a sideways-translating camera smears each splat horizontally by
    // focal * metres / depth pixels; a box of that length has variance L^2 / 12.
    anchor: 'float det = a * d - b * b;',
    insert: `
    float adjNoMotion = sqrt(max(0.0, detOrig / det));
    {
        float mpx = focal.x * uMotionMetres * abs(mvBlur) / max(-viewCenter.z, 0.05);
        a += mpx * mpx / 12.0;
        det = a * d - b * b;
    }`,
  },
  {
    anchor: 'float blurAdjust = sqrt(max(0.0, detOrig / det));',
    insert: `
    blurAdjust = mix(blurAdjust, adjNoMotion, uBlurKeep);`,
  },
];

export function buildVertexShader(defaultShader) {
  let src = defaultShader;
  for (const { anchor, insert } of EDITS) {
    const first = src.indexOf(anchor);
    if (first < 0 || src.indexOf(anchor, first + anchor.length) >= 0) return null;
    src = src.replace(anchor, anchor + insert);
  }
  return src;
}

// ---- motion tags ----
// A splat's motion class (kit.js MOVE, 0..7) rides in the lowest bit of its red, green and blue
// bytes: a change of at most 1/255 in colour, read back in the vertex shader above. Every splat that
// reaches the renderer must therefore have those bits set on purpose: tagLast() after each push,
// clearTags() for splats loaded from a file.
export function tagLast(packed, cls = 0) {
  const a = packed.packedArray, i4 = (packed.numSplats - 1) * 4;
  a[i4] = ((a[i4] & 0xfffefefe) | (cls & 1) | (((cls >> 1) & 1) << 8) | (((cls >> 2) & 1) << 16)) >>> 0;
}
export function clearTags(packed) {
  const a = packed.packedArray;
  if (!a) return;
  for (let i = 0, n = packed.numSplats * 4; i < n; i += 4) a[i] = (a[i] & 0xfffefefe) >>> 0;
  packed.needsUpdate = true;
}
