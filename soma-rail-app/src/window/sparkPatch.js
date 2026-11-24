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
  uBeatBig: { value: 0 },           // the pulse big things take (kicks); equal to uBeat when the beat is not split
  uBeatSmall: { value: 0 },         // the pulse small things and lights take (hats, snares); likewise
  uMid: { value: 0 },               // 0..1 lift of the mid band (vocals, melody); 0 leaves everything as it was
  uWeather: { value: 1 },           // 0..1: 1 is full weather; lower thins the rain, the snow and the traffic
  uChase: { value: 0 },             // the beat clock, in beats (wrapped at 1024), for lamps that chase
  uChaseOn: { value: 0 },           // 0..1: how much the chase shows; 0 rests the lamps
  uBeatSeq: { value: 0 },           // counts the beats (wrapped at 1024): which chorus groups answer this one
  uSparkle: { value: 0 },           // 0..1, follows the treble (hi-hats, cymbals, air)
  uClock: { value: 0 },             // seconds, for the sparkle's flicker
  uBeatRaised: { value: 1 },        // 1: everything above eye level swells on the beat; 0: only splats tagged for it
  uMove: { value: 0 },              // strength of the motion classes (flags, traffic, vapour); 0 = everything still
  uMoveT: { value: 0 },             // seconds of motion time; stands still while the train does
  uTravel: { value: 0 },            // metres travelled (wrapped), so patterns can be pinned to the world
  uFlowWith: { value: null },       // THREE.Vector3: per-lane pattern offsets (m) for traffic going the train's way
  uFlowAgainst: { value: null },    // ... and for traffic coming the other way
  uFall: { value: null },           // THREE.Vector2: metres fallen by snow (x) and rain (y), wrapped at 16
  uSway: { value: 0 },              // radians, wrapped at 2 pi: one sway for every two beats of the music (see engine.js)
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
uniform float uBeatSeq;
uniform float uBeatBig;
uniform float uBeatSmall;
uniform float uMid;
uniform float uWeather;
uniform float uChase;
uniform float uChaseOn;
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
uniform float uFly;
uniform float uSway;`,
  },
  {
    // scatter and breathe, before the splat is moved into view space
    anchor: 'rgba.rgb = max(rgba.rgb, vec3(0.0));',
    insert: `
    // Motion class: three bits carried in the lowest bit of each colour channel, and a fourth in the
    // opacity (see tagLast below). The renderer keeps opacity at half scale, so by here rgba.a is
    // twice a byte's worth and the byte's lowest bit is the second-lowest of the one that was packed.
    float mvBlur = 1.0;   // how much of the world's motion blur this splat takes
    ivec3 mvBits = ivec3(floor(rgba.rgb * 255.0 + 0.5)) & 1;
    int mv = mvBits.r | (mvBits.g << 1) | (mvBits.b << 2);
    int mvA = int(floor(rgba.a * 127.5 + 0.5));
    bool mvHi = (mvA & 1) == 1;                                   // classes 8 and up: see kit.js MOVE
    float chaseLvl = 1.0, chaseSz = 1.0;                          // a chasing lamp's brightness and size (class 14)
    if (mvHi) {
        if (uMove > 0.0 && mv == 1) {
            // Riders (class 9: see kit.js rideCell). Like flight, without wings and much slower:
            // whatever stands in one 24 m cell of the line is carried along it at 0.13 to 0.2 of the
            // train's speed, with the train in even cells and against it in odd ones. Its place is a
            // matter of where the train is, so it never jumps and it stops when the train does.
            float cellI = floor((center.x + uFly) / 24.0 + 0.5);
            float home = cellI * 24.0 - uFly;
            float hf = fract(sin(mod(cellI, 2048.0) * 12.9898) * 43758.5453);
            float kr = (mod(cellI, 2.0) < 0.5 ? 1.0 : -1.0) * (0.13 + 0.07 * hf) * min(uMove, 1.0);
            center.x -= kr * home;
            mvBlur = 1.0 - kr;
        } else if (uMove > 0.0 && mv == 4) {
            // Sway (class 12: see kit.js swayBlob and swayStrut): standing crops and grasses. A piece
            // carries its height above its root in its thin axis (a fiftieth of it), and leans along
            // the line by a share of that height, so a stalk bends from the ground and its ear
            // travels furthest. The lean swings once for every two beats of the music (the CPU keeps
            // the phase, at a walking pace when no tempo is known), as a wave that runs across the
            // field, stronger in gusts; each beat adds a nudge the same way.
            float wx = center.x + uTravel;
            float h = scales.z * 50.0;
            scales.z = scales.y;
            float ph = uSway + 0.07 * wx + 0.05 * center.z;
            float gust = 0.65 + 0.35 * sin(0.3 * uMoveT + 0.02 * wx + 0.013 * center.z);
            // the mid band (vocals, melody) blows harder: up to 70% more swing at uMid = 1
            float lean = min(uMove, 1.0) * h * (0.2 * gust * (1.0 + 0.7 * uMid) * sin(ph) + 0.08 * uBeatBig);
            center.x += lean;
            center.y -= 0.35 * lean * lean / max(h, 0.05);
        } else if (mv == 6 && uChaseOn > 0.0) {
            // Chase (class 14: see kit.js MOVE.CHASE): a lamp's light, in a row of lamps whose flares
            // run along the line at the music's tempo. uChase counts beats; each lamp flares once
            // every two beats, a little after the lamp behind it, so a wave of light runs down the
            // row (one wavelength is 200 pi / 3 = 209.4 m of line). Between flares it rests at 55%.
            // Wraps: uChase wraps at 1024, and 1024 * 0.5 = 512 whole cycles; uTravel wraps at 200 pi,
            // and 200 pi * 0.00477465 = 3.000001 whole cycles (0.00477465 = 3 / (200 pi)): so the phase
            // is the same either side of both wraps and no lamp jumps.
            float cp = fract(uChase * 0.5 - (center.x + uTravel) * 0.00477465);
            float flare = 1.0 - smoothstep(0.0, 0.16, min(cp, 1.0 - cp));   // peaks on its beat, gone a third of a beat (34 m) either side
            chaseLvl = mix(1.0, 0.55 + 0.45 * flare, uChaseOn);
            chaseSz = mix(1.0, 0.85 + 0.65 * flare, uChaseOn);
        }
    } else if (uMove > 0.0 && mv != 0) {
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
            float amp = uMove * gust * sz * (1.0 + 0.7 * uMid);         // the mid band blows harder: up to 70% further
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
            // with the train: 0.45 to 0.58 of its speed, so the bird drifts back at about half the land's
            // rate; against it: 0.7 to 1.2, so it whips past at about twice. (A bird going the train's way
            // is in view for longer than its chunk of the world exists unless it stays within
            // 324 * (1 - k) metres of the track: 136 m at the fastest. The flocks keep inside 120.)
            float kf = (mod(cellI, 2.0) < 0.5 ? 0.45 + 0.13 * hf : -(0.7 + 0.5 * hf)) * min(uMove, 1.0);
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
            // 58% of cells hold a vehicle at full weather; as the music quietens (uWeather falls to 0)
            // the threshold climbs to 0.75 (25%), the same vehicles staying, each fading over 0.05 of
            // the hash. At uWeather = 1 the smoothstep is 1 wherever the step is, so it is as before.
            float wT = 0.75 - 0.33 * uWeather;
            float present = step(0.42, hc.x) * smoothstep(wT - 0.05, wT, hc.x);
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
            mvBlur = 1.0 - 0.7 * rain;   // a raindrop keeps its shape: smeared the full width of the train's motion, rain turns into grey sheets
            // Weather: the music's loudness thins the fall. Each drop or flake is kept while its hash
            // (of its distance, so steady as the world scrolls) is below a level that runs from 1.05
            // at uWeather = 1 (every one kept: as before) to 0.375 at 0 (about 35% kept), fading
            // over 0.05 of the hash so none pops.
            float wKeep = 0.375 + 0.675 * uWeather;
            rgba.a *= smoothstep(-6.0, -4.8, yy) * (1.0 - smoothstep(8.8, 10.0, yy)) * (1.0 - smoothstep(wKeep - 0.05, wKeep, hp));
        }
    }
    if (uDissolve > 0.0 && !(mvHi && mv == 2)) {
        // (Class 10, SOLID, is spared: a thing hanging alone in the sky has nothing behind it to
        // fill the gaps, and scattered it reads as a cloud of specks.)
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
    // beatKinds). The chosen things swell by a good deal, since a small swell hardly shows on a mass
    // of overlapping splats, and rise by a part of their own height so that the growth goes upward
    // and not into the ground. They brighten only a little: a flash reads as a light, not as life.
    // People and animals are the other way round (classes 8 and 9): a body that swells looks wrong,
    // so they keep their size and brighten for the length of the beat instead.
    // (Classes 8 and up answer the beat in their own way or not at all: the raised rule leaves them be,
    // all but class 14, a chasing lamp, which is otherwise an ordinary light.)
    // The beat is split by band: big things (the raised rule, picked things, the sway's nudge) take
    // uBeatBig, the kick; small things (lights, a chorus) take uBeatSmall, the hats and snares; people
    // and animals keep the whole beat. Unsplit, all three are uBeat.
    // The mid band (uMid: vocals, melody) warms the lights: each grows by up to 15% and its colour
    // leans warmer and fuller (less blue, a little less green), rescaled so that its brightest
    // channel stays where it was and it stays a light.
    float raised = ((mvHi && mv != 6) ? 0.0 : uBeatRaised) * smoothstep(0.0, 0.07, center.y / max(length(center), 1.0));
    float isLight = smoothstep(0.86, 0.98, max(rgba.r, max(rgba.g, rgba.b)));
    {
        // (the rescale comes after the warming, so a light keeps its brightest channel at every uMid;
        // sign(wm) leaves the colour untouched, to the bit, where wm is 0)
        float wm = uMid * isLight;
        float m0 = max(rgba.r, max(rgba.g, rgba.b));
        vec3 warm = rgba.rgb * mix(vec3(1.0), vec3(1.0, 0.92, 0.74), wm);
        rgba.rgb = mix(rgba.rgb, warm * (m0 / max(max(warm.r, max(warm.g, warm.b)), 0.0001)), sign(wm));
        scales *= 1.0 + 0.15 * wm;
    }
    float picked = (!mvHi && mv == 6) ? 1.0 : 0.0;
    float flashed = (mvHi && mv <= 1) ? 1.0 - isLight : 0.0;
    // A chorus (class 11: see kit.js chorus()): the splat belongs to one of eight groups, carried in
    // three more bits of its opacity byte, and on each beat a different three or so of the eight
    // answer, all the members of a group together: every flower of one colour across a meadow.
    // They swell and rise like the picked things, and brighten a little more.
    float chorus = 0.0;
    if (mvHi && mv == 3) {
        chorus = step(fract(float((mvA >> 1) & 7) * 0.125 + uBeatSeq * 0.382), 0.4);
        rgba.a = 1.0;                                              // the group bits are not opacity
    }
    // A grove (class 15: see kit.js grove()): big things in turns. A splat names one of four
    // groups in two more bits of its opacity byte (its opacity keeps its top four bits), and on
    // each beat one or two of the four answer, swelling and rising as the picked things do, on
    // the big pulse: the pines of a forest on one beat, its spruces on the next.
    float grove = (mvHi && mv == 7) ? step(fract(float((mvA >> 1) & 3) * 0.25 + uBeatSeq * 0.382), 0.4) * (1.0 - isLight) : 0.0;
    scales *= (1.0 + uBreath + uBeatBig * (0.1 * raised + 0.42 * picked * (1.0 - isLight) + 0.42 * grove) + uBeatSmall * (0.32 * isLight + 0.55 * chorus)) * chaseSz;
    center.y += 0.3 * scales.y * (uBeatBig * (picked * (1.0 - isLight) + grove) + uBeatSmall * chorus);
    float shimmer = (1.0 + uBeatBig * 0.1 * (picked * (1.0 - isLight) + grove) + uBeat * 0.42 * flashed + uBeatSmall * 0.22 * chorus) * chaseLvl;
    if (uSparkle > 0.0) {
        float tw = fract(sin(float(splatIndex) * 12.9898 + floor(uClock * 9.0) * 78.233) * 43758.5453);
        shimmer *= 1.0 + uSparkle * (tw - 0.5) * (0.2 * max(raised, max(picked, max(flashed, max(chorus, grove)))) + 0.6 * isLight);
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
            vRgba.rgb = mvHi ? (mv == 0 ? vec3(1.0, 0.45, 0.75) : mv == 1 ? vec3(1.0, 0.55, 0.1) : mv == 2 ? vec3(0.55, 0.4, 1.0) : mv == 4 ? vec3(0.6, 1.0, 0.3) : mv == 5 ? vec3(0.45, 0.45, 0.5) : mv == 6 ? vec3(0.0, 0.62, 0.58) : mv == 7 ? vec3(0.95, 0.25 + 0.22 * float((mvA >> 1) & 3), 0.15 + 0.28 * float((mvA >> 1) & 3)) : 0.25 + 0.75 * vec3(float((mvA >> 1) & 1), float((mvA >> 2) & 1), float((mvA >> 3) & 1)))
                : mv == 0 ? vRgba.rgb * 0.35 : vec3(float(mv & 1), float((mv >> 1) & 1), float((mv >> 2) & 1)) * 0.8 + 0.2;
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
// A splat's motion class (kit.js MOVE, 0..15, in the low four bits of the number passed) rides in the lowest bit of its red, green and blue
// bytes (a change of at most 1/255 in colour) and, for its fourth bit, in the second-lowest bit of
// its opacity byte. The renderer halves opacity on its way to the shader, so the opacity byte is
// kept even, which makes the halving exact, and capped at 254: a change of at most 3/255 in
// opacity. Every splat that reaches the renderer must therefore have those bits set on purpose:
// tagLast() after each push, clearTags() for splats loaded from a file.
// A chorus splat (class 11) also carries its group, 0..7, in the next three bits of the opacity
// byte, with the top three set: it is drawn opaque. A grove splat (class 15) carries its group,
// 0..3, in the next two bits and keeps the top four bits of its opacity (sixteen levels). The
// group arrives as cls >> 4.
const tagWord = (w, cls) => {
  const c = cls & 15, g = cls >> 4;
  const a8 = c === 11 ? (0xe2 | ((g & 7) << 2)) : c === 15 ? ((Math.min(w >>> 24, 254) & 0xf0) | ((g & 3) << 2) | 2) : (Math.min(w >>> 24, 254) & 0xfc) | (((cls >> 3) & 1) << 1);
  return (((w & 0x00fefefe) | (cls & 1) | (((cls >> 1) & 1) << 8) | (((cls >> 2) & 1) << 16)) | (a8 << 24)) >>> 0;
};
export function tagLast(packed, cls = 0) {
  const a = packed.packedArray, i4 = (packed.numSplats - 1) * 4;
  a[i4] = tagWord(a[i4], cls);
}
export function clearTags(packed) {
  const a = packed.packedArray;
  if (!a) return;
  for (let i = 0, n = packed.numSplats * 4; i < n; i += 4) a[i] = tagWord(a[i], 0);
  packed.needsUpdate = true;
}
