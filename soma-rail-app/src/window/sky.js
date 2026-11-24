// Sky: one full-screen shader behind everything, plus the light it implies for the land.
// createSky(THREE) -> { object3d, update(state), horizonColor, hazeHighColor, lightTint, sunDir }
//   state = { hour (0..24), level (0|1), dials, time (seconds), dt, aspect, fovDeg, travelled (m), speed (m/s),
//             energy (0..1 slow loudness), beat (0..1 pulse on each onset), sparkle (0..1 treble) }
//   horizonColor: THREE.Color the land hazes toward; lightTint: THREE.Color multiplied into splats.
//
// How it works
// - Atmosphere: a cheap single-scattering model. Each light (sun, moon, and at level 1 a second
//   sun) has a colour computed once per frame in JavaScript from its elevation (Rayleigh + Mie
//   extinction along the Kasten-Young air mass, plus ozone, which keeps twilight blue). Per pixel
//   the shader only does phase functions and the view-path extinction. The same per-pixel formula
//   is mirrored in JavaScript (skyBaseJS) so horizonColor is exactly what the shader draws straight
//   ahead at the horizon; scripts/check-sky.mjs compares the two.
// - Exposure adapts to the sky brightness (only partly, so night stays dark), then an ACES-style
//   curve and a 2.2 gamma give display-referred sRGB. Nothing from three's colour pipeline is used.
// - Above that: sun disc with limb darkening and glow, a moon lit from the real sun direction,
//   stars on a fixed angular grid (no shimmer), two cloud layers (cumulus at ~1.6 km with true
//   parallax from `travelled`, cirrus at ~8 km), and the level-1 surrealism driven by the dials.
// - The camera never turns and looks along -z (right is +x, the train moves toward +x), so the view
//   ray comes straight from the screen uv.

// ---------------------------------------------------------------------------------------------
// Constants shared by the shader and the JavaScript mirror
// ---------------------------------------------------------------------------------------------
const TAU_R = [0.046, 0.108, 0.265];    // Rayleigh optical depth at the zenith (680/550/440 nm)
const TAU_M = [0.036, 0.038, 0.041];    // Mie (aerosol) optical depth: clean but not alpine air
const TAU_O = [0.021, 0.032, 0.001];    // ozone (Chappuis band): removes red/green on long paths
const MIE_G = 0.76;
const MS = 0.12;                         // fake multiple scattering: fraction of light re-scattered evenly

// ---------------------------------------------------------------------------------------------
// Sun and moon paths: a stylised arc, not a real latitude, built so that rising and setting
// happen inside the frame. Above the horizon the elevation follows a half sine from rise to set
// while the azimuth moves steadily from `az` left of straight ahead to `az` right of it (so the
// body climbs at a slant, as it does in mid latitudes). Below the horizon it goes on round,
// down to `depth` below the horizon, which gives proper night.
function makePath(azDeg, topElevDeg, riseHour, setHour, depthDeg) {
  const A = (azDeg * Math.PI) / 180, top = (topElevDeg * Math.PI) / 180, depth = (depthDeg * Math.PI) / 180;
  const dayLen = (setHour - riseHour + 24) % 24;
  return function dirAt(hour, out) {
    const h = (((hour - riseHour) % 24) + 24) % 24;
    let az, el;
    if (h < dayLen) { const f = h / dayLen; el = top * Math.sin(Math.PI * f); az = -A + 2 * A * f; }
    else { const f = (h - dayLen) / (24 - dayLen); el = -depth * Math.sin(Math.PI * f); az = A - 2 * A * f; }
    return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
  };
}
// The rise azimuth follows the frame width so rising and setting stay in view at any aspect.
// At 16:9 the sun rises 32 deg left of centre at 06:00, culminates at 60 deg at 13:00, sets 32 deg
// right at 20:00 and reaches -36 deg at 01:00; the moon keeps a low arc (top 21 deg, in frame)
// from 18:10 to 07:00, so sun and moon share the sky around both twilights.
function makePaths(halfHfovDeg) {
  const sunAz = clamp(0.8 * halfHfovDeg, 10, 36), moonAz = clamp(0.92 * halfHfovDeg, 11, 42);
  return { sun: makePath(sunAz, 60, 6, 20, 36), moon: makePath(moonAz, 21, 18.17, 7, 30), sunAz };
}

// ---------------------------------------------------------------------------------------------
// Small math helpers for the JavaScript mirror
// ---------------------------------------------------------------------------------------------
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

// The sky is evaluated at a flattened elevation near the horizon, so the band in which distant,
// fully hazed land sits (0..10 deg) has nearly the horizon colour and hills meet it without a seam.
const yEff = (y) => (y * y) / (y + 0.1);

// Kasten-Young air mass for a ray with sin(elevation) = y (clamped at the horizon, ~38).
function airmass(y) {
  y = clamp(y, 0, 1);
  const el = (Math.asin(y) * 180) / Math.PI;
  return 1 / (y + 0.50572 * Math.pow(el + 6.07995, -1.6364));
}

// Colour of light from a body at sin(elevation) y, after the atmosphere (Rayleigh + Mie along the
// air mass, plus ozone). `thin` scales the air mass for light that reaches high, thin air (it grazes above the dense
// layer), `fall` is how fast it fades once the body is below the horizon (Earth's shadow).
function bodyLight(y, intensity, thin = 1, fall = 40, ozone = 1) {
  const m = airmass(y) * thin;
  const mO = ozone / Math.sqrt(Math.max(y, 0) ** 2 + 0.0078);   // ozone sits high: path ~11x at the horizon
  const fade = y >= 0 ? 1 : Math.exp(fall * y);
  return [0, 1, 2].map((i) => intensity * fade * Math.exp(-(TAU_R[i] + TAU_M[i]) * m - TAU_O[i] * mO));
}

function hg(c, g) { const g2 = g * g; return (0.0795775 * (1 - g2)) / Math.pow(1 + g2 - 2 * g * c, 1.5); }

// Scattered light from one light toward the eye. Mirrors lightScatter() in the shader.
function lightScatterJS(d, L, lowCol, highCol, scat, hb, mieOnly, out) {
  const c = d[0] * L[0] + d[1] * L[1] + d[2] * L[2];
  const phR = 0.0596831 * (1 + c * c);
  const phM = hg(c, MIE_G) + 0.15 * hg(c, 0.2);
  for (let i = 0; i < 3; i++) {
    const tau = TAU_R[i] + TAU_M[i];
    const colM = lowCol[i];
    const colR = mix(lowCol[i], highCol[i], 0.4 + 0.6 * hb);
    const s = mieOnly ? TAU_M[i] * phM * colM : (TAU_R[i] * phR + MS * 0.0796 * tau) * colR + TAU_M[i] * phM * colM;
    out[i] += (s / tau) * scat[i];
  }
}

// ---------------------------------------------------------------------------------------------
// Constellations (a biome's `constellations: 1` hint; the motorway's night). Real figures from
// real star positions (right ascension, declination in degrees, visual magnitude), each projected
// about its own centre with north up (east to the left, as the sky is seen), scaled to `size`
// degrees across, turned by `rot` degrees anticlockwise and set at `at` = [azimuth, elevation] in
// the window. They are not where the real sky has them: they are laid out over the part of the sky
// the window sees, which is about +-40 deg of azimuth by 0..31 deg of elevation in a landscape
// window (motorway horizon 0.3, fov 50) and +-26 deg by 0..52 deg (to 59 on the tallest phones) in
// an upright one. The lower eight fill the landscape band; Cassiopeia and Cygnus straddle its top
// edge, and the Plough and Corona Borealis are for upright windows only (update() picks only
// figures whose centre is in frame). `lines` are the traditional stick figure, as index pairs.
// `red` marks the orange and red giants. Drawn by GLSL generated below (conGLSL), unrolled.
const CONSTELLATIONS = [
  { name: 'Orion', at: [-30, 15], size: 12, rot: 0, red: [0],
    stars: [[88.79, 7.41, 0.5], [81.28, 6.35, 1.6], [85.19, -1.94, 1.8], [84.05, -1.20, 1.7], [83.00, -0.30, 2.2], [86.94, -9.67, 2.1], [78.63, -8.20, 0.1], [83.78, 9.93, 3.4], [83.85, -4.84, 4.6], [83.82, -5.39, 4.0], [83.86, -5.91, 2.8]],
    lines: [[7, 0], [7, 1], [0, 1], [0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6], [8, 9], [9, 10]] },
  { name: 'Taurus', at: [-14, 11.5], size: 8, rot: 0, red: [0],
    stars: [[68.98, 16.51, 0.9], [67.15, 15.87, 3.4], [64.95, 15.63, 3.6], [65.73, 17.54, 3.8], [67.15, 19.18, 3.5], [81.57, 28.61, 1.7], [84.41, 21.14, 3.0]],
    lines: [[6, 0], [0, 1], [1, 2], [2, 3], [3, 4], [4, 5]] },
  { name: 'Pleiades', at: [-20, 23], size: 3, rot: 0, red: [],
    stars: [[56.87, 24.11, 2.9], [57.29, 24.05, 3.6], [56.22, 24.11, 3.7], [56.46, 24.37, 3.9], [56.58, 23.95, 4.2], [56.30, 24.47, 4.3], [57.30, 24.14, 5.1], [56.20, 24.29, 5.4]],
    lines: [] },
  { name: 'Gemini', at: [-3, 20.5], size: 10, rot: 0, red: [1],
    stars: [[113.65, 31.89, 1.6], [116.33, 28.03, 1.1], [107.78, 30.25, 4.4], [100.98, 25.13, 3.0], [95.74, 22.51, 2.9], [93.72, 22.51, 3.3], [110.03, 21.98, 3.5], [106.03, 20.57, 3.9], [99.43, 16.40, 1.9]],
    lines: [[0, 1], [0, 2], [2, 3], [3, 4], [4, 5], [1, 6], [6, 7], [7, 8]] },
  { name: 'Southern Cross', at: [-1, 8.5], size: 5.5, rot: 0, red: [2],
    stars: [[186.65, -63.10, 0.8], [191.93, -59.69, 1.3], [187.79, -57.11, 1.6], [183.79, -58.75, 2.8], [185.34, -60.40, 3.6]],
    lines: [[2, 0], [1, 3]] },
  { name: 'Leo', at: [11, 13], size: 11, rot: 0, red: [],
    stars: [[152.09, 11.97, 1.4], [151.83, 16.76, 3.5], [154.99, 19.84, 2.0], [154.17, 23.42, 3.4], [148.19, 26.01, 3.9], [146.46, 23.77, 3.0], [168.53, 20.52, 2.6], [168.56, 15.43, 3.3], [177.26, 14.57, 2.1]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [2, 6], [6, 8], [8, 7], [7, 0], [7, 6]] },
  { name: 'Lyra', at: [23, 22.5], size: 6.5, rot: 0, red: [],
    stars: [[279.23, 38.78, 0.0], [281.08, 39.67, 4.7], [281.19, 37.61, 4.3], [283.63, 36.90, 4.3], [284.74, 32.69, 3.2], [282.52, 33.36, 3.5]],
    lines: [[0, 1], [0, 2], [1, 2], [2, 3], [3, 4], [4, 5], [5, 2]] },
  { name: 'Scorpius', at: [31.5, 12.5], size: 12, rot: 0, red: [3],
    stars: [[241.36, -19.81, 2.6], [240.08, -22.62, 2.3], [245.30, -25.59, 2.9], [247.35, -26.43, 1.0], [248.97, -28.22, 2.8], [252.54, -34.29, 2.3], [252.97, -38.05, 3.0], [253.65, -42.36, 3.6], [258.04, -43.24, 3.3], [264.33, -43.00, 1.9], [265.62, -39.03, 2.4], [263.40, -37.10, 1.6]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11]] },
  { name: 'Cassiopeia', at: [-14, 35], size: 10, rot: 20, red: [],
    stars: [[2.29, 59.15, 2.3], [10.13, 56.54, 2.2], [14.18, 60.72, 2.5], [21.45, 60.24, 2.7], [28.60, 63.67, 3.4]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]] },
  { name: 'Cygnus', at: [10, 33.5], size: 12, rot: -35, red: [],
    stars: [[310.36, 45.28, 1.3], [305.56, 40.26, 2.2], [299.08, 35.08, 3.9], [292.68, 27.96, 3.1], [296.24, 45.13, 2.9], [292.43, 51.73, 3.8], [311.55, 33.97, 2.5], [318.23, 30.23, 3.2]],
    lines: [[0, 1], [1, 2], [2, 3], [4, 1], [4, 5], [1, 6], [6, 7]] },
  { name: 'Plough', at: [-5, 47], size: 12, rot: -10, red: [],
    stars: [[165.93, 61.75, 1.8], [165.46, 56.38, 2.4], [178.46, 53.69, 2.4], [183.86, 57.03, 3.3], [193.51, 55.96, 1.8], [200.98, 54.93, 2.2], [206.89, 49.31, 1.9]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4], [4, 5], [5, 6]] },
  { name: 'Corona Borealis', at: [15, 46], size: 6, rot: 0, red: [],
    stars: [[233.23, 31.36, 4.1], [231.96, 29.11, 3.7], [233.67, 26.71, 2.2], [235.69, 26.30, 3.8], [237.40, 26.07, 4.6], [239.40, 26.88, 4.1]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5]] },
];
const N_CON = CONSTELLATIONS.length;

// Gnomonic projection of a figure about its own centre, in degrees on the window's sky
// (x right, y up), scaled and turned as the table asks.
function projectFigure(c) {
  const D = Math.PI / 180;
  const ras = c.stars.map((s) => ((s[0] - c.stars[0][0] + 540) % 360) - 180 + c.stars[0][0]);
  const decs = c.stars.map((s) => s[1]);
  const a0 = ((Math.min(...ras) + Math.max(...ras)) / 2) * D, d0 = ((Math.min(...decs) + Math.max(...decs)) / 2) * D;
  const p = c.stars.map((s, i) => {
    const ra = ras[i] * D, dec = s[1] * D;
    const cosc = Math.sin(d0) * Math.sin(dec) + Math.cos(d0) * Math.cos(dec) * Math.cos(ra - a0);
    const xe = (Math.cos(dec) * Math.sin(ra - a0)) / cosc;
    const yn = (Math.cos(d0) * Math.sin(dec) - Math.sin(d0) * Math.cos(dec) * Math.cos(ra - a0)) / cosc;
    return [-xe / D, yn / D];
  });
  const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const k = c.size / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const r = c.rot * D;
  return p.map(([x, y]) => { x = (x - cx) * k; y = (y - cy) * k; return [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)]; });
}

// One unrolled block per figure, entered only while its envelope is up and the pixel is inside
// its bounding circle. q = the pixel in degrees about the figure's centre (local tangent plane).
// Lines stop short of the stars, as in a star chart. `thin` (0..1) marks the figure's footprint,
// where the ordinary field is dimmed so the figure is not lost among the random stars.
const f3 = (v) => (Math.round(v * 1000) / 1000).toFixed(3);
const conGLSL = CONSTELLATIONS.map((c, k) => {
  const p = projectFigure(c);
  const R = Math.max(...p.map(([x, y]) => Math.hypot(x, y))) + 1.6;
  const stars = p.map(([x, y], i) => {
    const b = clamp(2.2 * Math.pow(10, -0.2 * c.stars[i][2]), 0.2, 2.2);
    const col = c.red.includes(i) ? 'vec3(1.0, 0.72, 0.5)' : 'vec3(0.86, 0.92, 1.0)';
    return `    near = min(near, conStar(q, vec2(${f3(x)}, ${f3(y)}), ${f3(b)}, ${col}, s, pxd, add));`;
  });
  const lines = c.lines.map(([i, j]) => {
    const [ax, ay] = p[i], [bx, by] = p[j];
    const len = Math.hypot(bx - ax, by - ay), g = Math.min(0.45, 0.3 * len) / len;
    return `    dl = min(dl, conSeg(q, vec2(${f3(ax + (bx - ax) * g)}, ${f3(ay + (by - ay) * g)}), vec2(${f3(bx - (bx - ax) * g)}, ${f3(by - (by - ay) * g)})));`;
  });
  const [az, el] = c.at;
  return `  // ${c.name}
  if (uCon[${k}].x + uCon[${k}].y > 0.002) {
    vec2 q = vec2((az - ${f3((az * Math.PI) / 180)}) * cos(el), el - ${f3((el * Math.PI) / 180)}) * 57.29578;
    if (dot(q, q) < ${f3(R * R)}) {
    float s = uCon[${k}].x, near = 1e3, dl = 1e3;
${stars.join('\n')}
${lines.join('\n')}
    add += vec3(0.55, 0.66, 0.9) * 0.2 * uCon[${k}].y * exp(-dl * dl / (lw * lw));
    thin = max(thin, max(s, uCon[${k}].y) * (1.0 - smoothstep(0.7, 1.8, min(near, dl))));
    }
  }`;
}).join('\n');

// ---------------------------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------------------------
const vertexShader = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }   // at the far plane
`;

const fragmentShader = /* glsl */`
varying vec2 vUv;
uniform float uTanHalf, uAspect, uTime, uExposure, uShift;
uniform vec3 uTauR, uTauM;
uniform vec3 uSunDir, uSunLow, uSunHigh, uSunDirect;     // light colours: low/high atmosphere, at clouds
uniform vec3 uMoonDir, uMoonLow, uMoonHigh, uMoonDirect;
uniform vec3 uSun2Dir, uSun2Col;                           // level-1 second sun (uSun2Col = 0 when off)
uniform vec3 uNightGlow, uAmbient;                         // airglow; average sky light for clouds
uniform float uSunDisc, uMoonDisc, uMoonRadius, uSun2Disc, uStars;
uniform float uStarThresh, uDeep, uMilky;
uniform float uTwinkle, uTwT, uStarBeat, uBeatSeq;          // scintillation and the beat pulse (see update)
uniform vec3 uMeteorA, uMeteorB;
uniform vec3 uShowerA0, uShowerB0, uShowerA1, uShowerB1, uShowerA2, uShowerB2;   // a meteor shower's three slots
uniform vec3 uShowerT;                                      // each slot's place along its path, < 0 for none
uniform float uShowerGain;                                  // their brightness
uniform float uMeteorT;                                     // 0..1 along the meteor's path, < 0 for none                   // a biome's night-sky hint (see update)
uniform vec2 uCloudOffLo, uCloudOffHi;
uniform float uCoverLo, uCoverHi, uCloudGain;
uniform float uTopo, uAurora, uLandOff;
uniform vec3 uLandCol;
uniform float uConOn;                                       // 1 while a biome asks for constellations
uniform vec2 uCon[${N_CON}];                                       // per figure: star and line envelopes (see update)
uniform vec2 uFlareThr;                                     // share of ordinary stars that flare: 0.66 / 0.6 = a third
uniform float uOvercast;                                    // 0..1: a grey cloud deck over everything
uniform vec3 uDeckZen, uDeckHor, uDeckSun;                  // its radiance overhead, at the horizon, and toward the sun
uniform vec2 uDeckOff;

const float PI = 3.14159265;
const float MIE_G = ${MIE_G.toFixed(3)};
const float MS = ${MS.toFixed(3)};

// ---- noise: value noise whose lattice repeats every 256 cells. The octave transform [2 1; -1 2]
// maps the lattice onto itself, so cloud offsets can wrap at 256 with no visible jump.
float hash12(vec2 p) {
  p = mod(p, 256.0);
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float noise1(float x, float row) { return vnoise(vec2(x, row)); }
// fbm with a footprint-aware fade: octaves finer than a pixel are replaced by their mean, so
// distant clouds near the horizon do not sparkle. fw = noise units per pixel at octave 0.
float fbm(vec2 p, float fw, int octaves) {
  float s = 0.0, amp = 0.5, f = 1.0;
  for (int k = 0; k < 6; k++) {
    if (k >= octaves) break;
    float keep = 1.0 - smoothstep(0.25, 0.9, fw * f);
    s += amp * mix(0.5, vnoise(p), keep);
    p = vec2(2.0 * p.x + p.y, -p.x + 2.0 * p.y) + vec2(17.0, 31.0);
    f *= 2.236; amp *= 0.47;
  }
  return s * 0.53 / (0.5 * (1.0 - pow(0.47, float(octaves))));   // 0..1, mean 0.5
}

// ---- atmosphere (mirrored in sky.js: skyBaseJS) -------------------------------------------------
float airmass(float y) {
  y = clamp(y, 0.0, 1.0);
  float el = degrees(asin(y));
  return 1.0 / (y + 0.50572 * pow(el + 6.07995, -1.6364));
}
float hg(float c, float g) { float g2 = g * g; return 0.0795775 * (1.0 - g2) / pow(1.0 + g2 - 2.0 * g * c, 1.5); }
vec3 lightScatter(vec3 d, vec3 L, vec3 lowCol, vec3 highCol, vec3 scat, float hb, float mieOnly) {
  float c = dot(d, L);
  float phR = 0.0596831 * (1.0 + c * c);
  float phM = hg(c, MIE_G) + 0.15 * hg(c, 0.2);
  vec3 tau = uTauR + uTauM;
  // Mie (near the light) sees the reddened low-air colour; Rayleigh, spread over the whole
  // path and higher up, sees a less reddened mix, so the anti-solar horizon is not orange.
  vec3 colM = lowCol;
  vec3 colR = mix(lowCol, highCol, 0.4 + 0.6 * hb);
  vec3 s = mieOnly > 0.5 ? uTauM * phM * colM : (uTauR * phR + MS * 0.0796 * tau) * colR + uTauM * phM * colM;
  return s / tau * scat;
}
// Sky radiance (before exposure) for a direction at or above the horizon. hb blends the light
// colour seen by low air (reddened) toward that seen by high air (twilight stays lit up there).
vec3 skyBase(vec3 d, out vec3 ext) {
  float y = max(d.y, 0.0);
  y = y * y / (y + 0.1);             // flattened near the horizon, see yEff() in sky.js
  float m = airmass(y);
  ext = exp(-(uTauR + uTauM) * m);
  vec3 scat = 1.0 - ext;
  float hb = 1.0 - exp(-4.0 * y);   // smooth at the horizon (sqrt would make a seam)
  vec3 col = uNightGlow * scat;
  col += lightScatter(d, uSunDir, uSunLow, uSunHigh, scat, hb, 0.0);
  col += lightScatter(d, uMoonDir, uMoonLow, uMoonHigh, scat, hb, 0.0);
  col += lightScatter(d, uSun2Dir, uSun2Col, uSun2Col, scat, hb, 1.0);
  // overcast: the clear sky gives way to a deck, darker toward the horizon (where it is one flat
  // colour, so the land's haze meets it without a seam), with a broad brighter patch toward the sun
  if (uOvercast > 0.0) {
    float c = dot(d, uSunDir);
    vec3 deck = mix(uDeckHor, uDeckZen, 1.0 - exp(-3.5 * y)) + uDeckSun * exp(3.0 * (c - 1.0));
    col = mix(col, deck, uOvercast);
  }
  return col;
}

// ---- constellations (generated from CONSTELLATIONS in sky.js) -------------------------------------
// A star: a bright soft dot about two pixels across (never under 0.05 degrees), a faint glow for
// the brightest. Returns the distance (degrees) for the footprint.
float conStar(vec2 q, vec2 p, float b, vec3 c, float s, float pxd, inout vec3 add) {
  float d = length(q - p);
  float dd = d / pxd;
  add += c * b * s * (exp(-dd * dd * 0.42) + 0.06 * b * exp(-dd * 0.5));
  return d;
}
float conSeg(vec2 q, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float t = clamp(dot(q - a, ab) / dot(ab, ab), 0.0, 1.0);
  return length(q - a - ab * t);
}
// az, el in radians, px in radians per pixel. Returns the footprint, adds the light to add.
float constellations(float az, float el, float px, inout vec3 add) {
  float thin = 0.0;
  float pxd = max(degrees(px), 0.05);         // star size unit, degrees
  float lw = max(degrees(px) * 0.75, 0.035);  // line half-width, degrees
${conGLSL}
  return thin;
}

vec3 aces(vec3 x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

// A body disc: 1 inside radius r (radians), anti-aliased over one pixel.
// A meteor's streak from a to b at t (0..1 along the path): the head brightest, the tail 0.4 of it.
float meteor(vec3 dir, vec3 a, vec3 b, float t, float px, float wide) {
  if (t >= 1.0) return 0.0;
  vec3 hd = normalize(mix(a, b, t));
  vec3 tl = normalize(mix(a, b, max(0.0, t - 0.4)));
  vec3 ab = hd - tl;
  float tt = clamp(dot(dir - tl, ab) / max(dot(ab, ab), 1e-9), 0.0, 1.0);
  float dist = length(dir - (tl + ab * tt));
  float w = max(px * wide, 0.0007);
  return exp(-dist * dist / (w * w)) * tt * tt * sin(3.14159 * t);
}
float disc(vec3 d, vec3 c, float r, float px) {
  float ang = acos(clamp(dot(d, c), -1.0, 1.0));
  return 1.0 - smoothstep(r - px, r + px, ang);
}

// ---- clouds ----------------------------------------------------------------------------------
// Project the ray onto a horizontal layer at height H (metres); S = metres per noise unit.
// Returns premultiplied colour (rgb) and coverage (a).
vec4 cumulus(vec3 d, vec3 skyCol, float px) {
  float y = max(d.y, 0.012);
  const float H = 1600.0, S = 2600.0;
  vec2 q = d.xz / y * (H / S);
  q.y *= 0.45;                                    // clouds stretched along the view: less squashed on screen
  float fw = px * (H / S) / (y * y) * 0.6;        // noise units per pixel (grows fast near horizon)
  vec2 p = q + uCloudOffLo;
  float n = fbm(p, fw, 4);
  float dens = smoothstep(uCoverLo, uCoverLo + 0.12, n);          // crisp-ish edges
  if (dens <= 0.001) return vec4(0.0);
  float thick = smoothstep(uCoverLo, uCoverLo + 0.4, n);         // optical thickness inside
  // one look toward the light across the layer (gradient lighting): where the noise falls
  // toward the light this is the lit flank of a puff, where it rises it is the shaded side
  vec2 toSun = normalize(uSunDir.xz + vec2(1e-4)) * 0.12;
  vec2 toMoon = normalize(uMoonDir.xz + vec2(1e-4)) * 0.12;
  vec2 toL = length(uSunDirect) > length(uMoonDirect) * 4.0 ? toSun : toMoon;
  float n2 = fbm(p + toL, fw, 2);
  float shade = clamp(0.55 + 4.0 * (n - n2) - 0.35 * thick, 0.08, 1.3);
  float c1 = dot(d, uSunDir), c2 = dot(d, uMoonDir);
  float fwd1 = 0.6 + 6.0 * hg(c1, 0.6) * (1.0 - 0.6 * thick);    // silver lining toward the light
  float fwd2 = 0.6 + 6.0 * hg(c2, 0.6) * (1.0 - 0.6 * thick);
  vec3 lit = uSunDirect * shade * fwd1 + uMoonDirect * shade * fwd2;
  vec3 col = (lit * 0.3 + uAmbient * (1.15 - 0.6 * thick)) * uCloudGain;
  col *= 1.0 - 0.45 * uOvercast * thick;            // under a deck: dark ragged scud
  // aerial perspective: far clouds sink into the sky colour, and the layer fades at the horizon
  float dist = H / y;
  float aer = exp(-dist / mix(30000.0, 9000.0, uOvercast));   // (in rain the murk swallows far scud)
  col = mix(skyCol, col, aer);
  float a = dens * smoothstep(0.004, 0.05, d.y) * 0.97;
  return vec4(col * a, a);
}
vec4 cirrus(vec3 d, vec3 skyCol, float px) {
  float y = max(d.y, 0.02);
  const float H = 8000.0, S = 9000.0;
  vec2 q = d.xz / y * (H / S);
  q = vec2(q.x * 0.6 + q.y * 0.5, q.y * 1.5 - q.x * 0.25);   // gently stretched along a slanted wind
  float fw = px * (H / S) / (y * y) * 1.5;
  float n = fbm(q + uCloudOffHi, fw, 4);
  float dens = smoothstep(uCoverHi, uCoverHi + 0.25, n) * 0.4;
  if (dens <= 0.001) return vec4(0.0);
  float c1 = dot(d, uSunDir);
  vec3 col = uSunDirect * (0.12 + 1.2 * hg(c1, 0.7)) + uMoonDirect * 0.15 + uAmbient * 1.1;
  col = mix(skyCol, col * uCloudGain, exp(-(H / y) / 60000.0));
  float a = dens * smoothstep(0.03, 0.2, d.y);
  return vec4(col * a, a);
}

void main() {
  vec3 dir = normalize(vec3((vUv.x * 2.0 - 1.0) * uTanHalf * uAspect, (vUv.y * 2.0 - 1.0 + uShift) * uTanHalf, -1.0));   // uShift: a lowered horizon
  float px = length(fwidth(dir));                      // radians per pixel

  // Below the horizon the sky continues as the horizon colour of the same column.
  vec3 dh = normalize(vec3(dir.x, max(dir.y, 0.0), dir.z));
  vec3 ext;
  vec3 sky = skyBase(dh, ext);
  vec3 col = sky * uExposure;                          // from here on: exposed linear values

  if (dir.y > 0.0) {
    float az = atan(dir.x, -dir.z), el = asin(dir.y);
    float moonMask = 1.0 - disc(dir, uMoonDir, uMoonRadius * 1.04, px);   // the moon hides what is behind it

    // ---- the Milky Way (only where a biome asks for it): a broad band along a great circle that
    // crosses the window on a slant, brighter toward its middle, mottled, with a dark rift
    float mw = 0.0;
    if (uMilky > 0.003 && uStars > 0.003) {
      // a low arch from the lower left of the window (azimuth -38, 6 degrees up) to the upper right (+30, 22 up)
      const vec3 POLE = vec3(0.2272, -0.9262, -0.3009), GU = vec3(-0.6123, 0.1045, -0.7837), GV = vec3(0.7573, 0.3623, -0.5434);
      float lat = dot(dir, POLE);
      float lon = atan(dot(dir, GV), dot(dir, GU));
      float fw = px * 24.0;
      float cl = fbm(vec2(lon * 7.0, lat * 24.0) + 31.0, fw, 4);
      float band = exp(-lat * lat / 0.009);
      float rift = (1.0 - smoothstep(0.012, 0.05, abs(lat - 0.008 + 0.05 * (cl - 0.5)))) * smoothstep(0.35, 0.6, fbm(vec2(lon * 2.5, 3.0), px * 2.5, 3));
      mw = band * (0.3 + 1.1 * cl * cl) * (1.0 - 0.75 * rift);
      col += vec3(0.6, 0.66, 0.82) * mw * uMilky * uStars * 0.05 * ext.g * moonMask;
    }

    // ---- stars: one candidate per 0.45-degree cell, fixed to the sky, a soft one-pixel dot
    if (uStars > 0.003) {
      // constellations first: where one is lit, the ordinary field inside its footprint dims
      float keep = 1.0;
      if (uConOn > 0.5) {
        vec3 cadd = vec3(0.0);
        keep = 1.0 - 0.85 * constellations(az, el, px, cadd);
        col += cadd * uStars * ext.g * moonMask;
      }
      const float CELL = 0.00785;
      vec2 g = vec2(az, el) / CELL;
      vec2 ci = floor(g);
      float h = hash12(ci + 91.0);
      if (h > uStarThresh - 0.3 * mw * uMilky) {
        vec2 sp = ci + 0.2 + 0.6 * vec2(hash12(ci + 3.0), hash12(ci + 7.0));
        float dd = length((g - sp) * CELL) / max(px, 1e-5);
        float b = pow(hash12(ci + 13.0), 9.0) * 1.8 + 0.035;
        float tint = hash12(ci + 29.0);
        vec3 sc = mix(vec3(1.0, 0.82, 0.65), vec3(0.75, 0.85, 1.0), tint);
        // Each star scintillates at its own rate, more so low in the sky. On every beat a different
        // third of them flares: a bright star is already at full white, so the flare also widens
        // its dot, which is what shows.
        float tw = 1.0 + uTwinkle * (0.3 + 0.35 * (1.0 - smoothstep(0.05, 0.35, dir.y))) * sin(uTwT * (2.0 + 7.0 * hash12(ci + 41.0)) + 6.2832 * hash12(ci + 43.0));
        float flare = uStarBeat * step(uFlareThr.x, fract(hash12(ci + 47.0) + uBeatSeq * 0.382));
        col += sc * b * tw * (1.0 + 2.6 * flare) * exp(-dd * dd * 2.2 / (1.0 + 0.6 * flare)) * uStars * ext.g * moonMask * keep;
      }
      // a second, finer field of faint stars for a dark-sky site, thicker in the Milky Way
      if (uDeep > 0.003) {
        const float CELL2 = 0.0031;
        vec2 g2 = vec2(az, el) / CELL2;
        vec2 c2 = floor(g2);
        if (hash12(c2 + 57.0) > 0.8 - 0.45 * mw * uMilky) {
          vec2 sp = c2 + 0.2 + 0.6 * vec2(hash12(c2 + 5.0), hash12(c2 + 11.0));
          float dd = length((g2 - sp) * CELL2) / max(px, 1e-5);
          float b = 0.012 + 0.07 * pow(hash12(c2 + 17.0), 3.0);
          float tw2 = 1.0 + uTwinkle * 0.45 * sin(uTwT * (3.0 + 8.0 * hash12(c2 + 23.0)) + 6.2832 * hash12(c2 + 31.0));
          float fl2 = uStarBeat * step(uFlareThr.y, fract(hash12(c2 + 37.0) + uBeatSeq * 0.382));
          col += vec3(0.85, 0.9, 1.0) * b * tw2 * (1.0 + 2.5 * fl2) * exp(-dd * dd * 2.6) * uStars * uDeep * ext.g * moonMask * keep;
        }
      }
    }

    // ---- a meteor: a short bright streak along a path the CPU picks now and then, head brightest
    if (uMeteorT >= 0.0 && uMeteorT < 1.0 && uStars > 0.003) col += vec3(0.9, 0.95, 1.0) * meteor(dir, uMeteorA, uMeteorB, uMeteorT, px, 1.3) * 1.8 * uStars * ext.g;
    // ... and in a shower (events.js), up to three more at once, brighter, from one radiant
    if (uShowerT.x >= 0.0 && uStars > 0.003) col += vec3(0.85, 1.0, 0.92) * meteor(dir, uShowerA0, uShowerB0, uShowerT.x, px, 2.4) * uShowerGain * ext.g;
    if (uShowerT.y >= 0.0 && uStars > 0.003) col += vec3(0.9, 0.95, 1.0) * meteor(dir, uShowerA1, uShowerB1, uShowerT.y, px, 2.4) * uShowerGain * ext.g;
    if (uShowerT.z >= 0.0 && uStars > 0.003) col += vec3(1.0, 0.95, 0.85) * meteor(dir, uShowerA2, uShowerB2, uShowerT.z, px, 2.4) * uShowerGain * ext.g;

    // ---- aurora (level 1, topology dial, night): curtains with a sharp lower edge and rays
    if (uAurora > 0.003 && dir.y > 0.02) {
      float t = uTime;
      float base = 0.13 + 0.05 * sin(az * 2.1 + t * 0.021) + 0.06 * (noise1(az * 2.5 + t * 0.03, 5.0) - 0.5);
      float above = dir.y - base;
      float curtain = smoothstep(-0.006, 0.012, above) * exp(-max(above, 0.0) * 7.0);
      float ribbon = pow(0.5 + 0.5 * sin(az * 3.3 + 4.0 * noise1(az * 1.3 + t * 0.012, 9.0) + t * 0.04), 2.0);
      float rays = 0.55 + 0.45 * noise1(az * 70.0 + t * 0.15, 17.0);
      vec3 ac = mix(vec3(0.15, 0.95, 0.55), vec3(0.55, 0.25, 0.85), smoothstep(0.0, 0.2, above));
      col += ac * curtain * ribbon * rays * uAurora * 0.55 * moonMask;
    }

    // ---- moon: a lit sphere (the phase follows the real sun direction), faint maria
    {
      float r = uMoonRadius;
      vec3 c = uMoonDir;
      float cosd = dot(dir, c);
      if (cosd > cos(r * 6.0 + 0.01)) {
        vec3 T = normalize(cross(c, vec3(0.0, 1.0, 0.0)));
        vec3 B = cross(T, c);
        vec2 q = vec2(dot(dir - c, T), dot(dir - c, B)) / r;
        float m = disc(dir, c, r, px);
        float zq = sqrt(max(1.0 - dot(q, q), 0.0));
        vec3 n = T * q.x + B * q.y - c * zq;           // sphere normal, the visible side faces us
        float lit = smoothstep(-0.05, 0.12, dot(n, uSunDir));
        float maria = 0.72 + 0.28 * smoothstep(0.35, 0.7, vnoise(q * 2.3 + 11.0) * 0.65 + vnoise(q * 5.0 + 3.0) * 0.35);
        float limb = 0.75 + 0.25 * zq;
        vec3 mc = vec3(1.0, 0.97, 0.9) * maria * limb * (lit + 0.025);
        col += mc * m * uMoonDisc * ext / max(ext.g, 0.25);
        // a soft halo in hazy air
        float ang = acos(clamp(cosd, -1.0, 1.0));
        col += uMoonDisc * 0.05 * exp(-ang / (r * 1.5)) * (1.0 - smoothstep(r * 2.0, r * 6.0, ang)) * vec3(0.8, 0.85, 1.0) * (1.0 - m);
      }
    }

    // ---- sun discs, behind the clouds
    {
      float ang = acos(clamp(dot(dir, uSunDir), -1.0, 1.0));
      const float R = 0.0047;
      float m = 1.0 - smoothstep(R - px, R + px, ang);
      float limb = sqrt(max(1.0 - (ang / R) * (ang / R), 0.0));
      vec3 discCol = uSunDisc * pow(ext, vec3(0.55)) * (0.6 + 0.4 * limb);
      col += discCol * m;
      col += uSunDisc * 0.012 * pow(ext, vec3(0.5)) * exp(-ang / 0.03);   // tight bloom
    }
    if (uSun2Disc > 0.003) {
      float ang = acos(clamp(dot(dir, uSun2Dir), -1.0, 1.0));
      const float R = 0.011;
      float m = 1.0 - smoothstep(R - px, R + px, ang);
      col += uSun2Disc * vec3(1.0, 0.8, 0.75) * (m * 4.0 + 0.25 * exp(-ang / 0.035));
    }

    // ---- overcast: the deck's own structure, slow lumps and lighter breaks on a layer at ~1.2 km
    // (fading to its mean toward the horizon, where the noise is finer than a pixel)
    if (uOvercast > 0.003) {
      float y = max(dir.y, 0.012);
      const float H = 1200.0, S = 3200.0;
      vec2 q = dir.xz / y * (H / S);
      q.y *= 0.75;
      float fw = px * (H / S) / (y * y) * 0.6;
      float n = fbm(q + uDeckOff, fw, 5);
      float big = fbm(q * 0.3 - uDeckOff * 0.4 + 7.0, fw * 0.3, 3);
      float m = 1.0 + 1.1 * (n - 0.5) + 0.9 * (big - 0.5) + 0.25 * smoothstep(0.62, 0.8, big);
      col *= mix(1.0, max(m, 0.3), uOvercast * smoothstep(0.0, 0.08, dir.y));
    }

    // ---- clouds: cirrus high, then cumulus in front
    vec4 ci = cirrus(dir, sky, px) * (1.0 - uOvercast);
    col = col * (1.0 - ci.a) + ci.rgb * uExposure;
    vec4 cu = cumulus(dir, sky, px);
    col = col * (1.0 - cu.a) + cu.rgb * uExposure;

    // ---- inverted land (level 1, topology): two hazy ridgelines hanging from the top of
    // the sky, drawn over the clouds so the fold reads as land and not as weather
    if (uTopo > 0.003 && dir.y > 0.17) {
      float far = 0.205 + 0.035 * (noise1(az * 6.0 + uLandOff * 0.3, 41.0) + 0.5 * noise1(az * 15.0 + uLandOff * 0.3, 43.0));
      float rid = 1.0 - abs(2.0 * noise1(az * 11.0 + uLandOff, 53.0) - 1.0);   // ridged: peaks
      float near = 0.25 + 0.06 * (noise1(az * 4.0 + uLandOff, 47.0) + 0.6 * rid);
      float aFar = smoothstep(-2.0 * px, 2.0 * px, dir.y - far);   // soft, like hazed ridges
      float aNear = smoothstep(-1.5 * px, 1.5 * px, dir.y - near);
      vec3 farC = mix(col, uLandCol, 0.5);             // uLandCol is already exposed
      vec3 nearC = mix(col, uLandCol, 0.85);
      col = mix(col, farC, aFar * uTopo);
      col = mix(col, nearC, aNear * uTopo);
    }
  }

  col = pow(aces(col), vec3(1.0 / 2.2));
  // tiny dither so 8-bit gradients do not band
  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Camera exposure from the average sky luminance: it adapts only partly (power < 1), so dusk
// gets darker on screen, and it is capped so night stays night.
// The key is a geometric mean over a few directions, so glare around a low sun does not dim
// the whole frame. KEY_NOON is that key at 13:00, which maps to exposure EXP_NOON.
const KEY_NOON = 0.0255, EXP_NOON = 5.6, ADAPT = 0.55;
const exposureFor = (key) => clamp(EXP_NOON * Math.pow(Math.max(key, 1e-7) / KEY_NOON, -ADAPT), 1, 45);
function skyKey(samples) { let s = 0; for (const c of samples) s += Math.log(Math.max(lum(c), 1e-7)); return Math.exp(s / samples.length); }

// ---------------------------------------------------------------------------------------------
export function createSky(THREE) {
  const V3 = () => new THREE.Vector3();
  const C3 = () => new THREE.Color(0, 0, 0);
  const uniforms = {
    uTanHalf: { value: Math.tan((25 * Math.PI) / 180) }, uAspect: { value: 16 / 9 },
    uTime: { value: 0 }, uExposure: { value: 1 }, uShift: { value: 0 },
    uTauR: { value: new THREE.Vector3(...TAU_R) }, uTauM: { value: new THREE.Vector3(...TAU_M) },
    uSunDir: { value: V3() }, uSunLow: { value: C3() }, uSunHigh: { value: C3() }, uSunDirect: { value: C3() },
    uMoonDir: { value: V3() }, uMoonLow: { value: C3() }, uMoonHigh: { value: C3() }, uMoonDirect: { value: C3() },
    uSun2Dir: { value: new THREE.Vector3(0.3, 0.04, -0.95).normalize() }, uSun2Col: { value: C3() },
    uNightGlow: { value: C3() }, uAmbient: { value: C3() },
    uSunDisc: { value: 0 }, uMoonDisc: { value: 0 }, uMoonRadius: { value: 0.005 }, uSun2Disc: { value: 0 }, uStars: { value: 0 },
    uStarThresh: { value: 0.86 }, uDeep: { value: 0 }, uMilky: { value: 0 },
    uTwinkle: { value: 0 }, uTwT: { value: 0 }, uStarBeat: { value: 0 }, uBeatSeq: { value: 0 },
    uMeteorA: { value: new THREE.Vector3(0, 0.3, -1) }, uMeteorB: { value: new THREE.Vector3(0.2, 0.2, -1) }, uMeteorT: { value: -1 },
    uShowerA0: { value: V3() }, uShowerB0: { value: V3() }, uShowerA1: { value: V3() }, uShowerB1: { value: V3() }, uShowerA2: { value: V3() }, uShowerB2: { value: V3() },
    uShowerT: { value: new THREE.Vector3(-1, -1, -1) }, uShowerGain: { value: 0 },
    uCloudOffLo: { value: new THREE.Vector2(17.3, 5.1) }, uCloudOffHi: { value: new THREE.Vector2(3.7, 40.2) },
    uCoverLo: { value: 0.52 }, uCoverHi: { value: 0.58 }, uCloudGain: { value: 1 },
    uTopo: { value: 0 }, uAurora: { value: 0 }, uLandOff: { value: 0 }, uLandCol: { value: C3() },
    uConOn: { value: 0 }, uCon: { value: Array.from({ length: N_CON }, () => new THREE.Vector2()) }, uFlareThr: { value: new THREE.Vector2(0.66, 0.6) },
    uOvercast: { value: 0 }, uDeckZen: { value: C3() }, uDeckHor: { value: C3() }, uDeckSun: { value: C3() }, uDeckOff: { value: new THREE.Vector2(41.0, 9.0) },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, depthTest: false, depthWrite: false });
  const object3d = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  object3d.frustumCulled = false; object3d.renderOrder = -1000;

  const horizonColor = new THREE.Color(0.7, 0.78, 0.86);
  const hazeHighColor = new THREE.Color(0.6, 0.72, 0.86);
  const lightTint = new THREE.Color(1, 1, 1);
  const sunDir = new THREE.Vector3(0, 1, 0);
  const moonDir = new THREE.Vector3(0, -1, 0);
  const U = uniforms;
  const arr = (c) => [c.r, c.g, c.b];
  const setC = (c, a) => c.setRGB(a[0], a[1], a[2]);

  // JavaScript mirror of skyBase() in the shader, for one direction at or above the horizon.
  // clear = true leaves out the overcast deck (the camera exposes for the clear sky).
  function skyBaseJS(d, clear = false) {
    const y = yEff(Math.max(d[1], 0));
    const m = airmass(y);
    const scat = [0, 1, 2].map((i) => 1 - Math.exp(-(TAU_R[i] + TAU_M[i]) * m));
    const hb = 1 - Math.exp(-4 * y);
    const out = [0, 1, 2].map((i) => U.uNightGlow.value[['r', 'g', 'b'][i]] * scat[i]);
    const sd = U.uSunDir.value, md = U.uMoonDir.value, s2 = U.uSun2Dir.value;
    lightScatterJS(d, [sd.x, sd.y, sd.z], arr(U.uSunLow.value), arr(U.uSunHigh.value), scat, hb, false, out);
    lightScatterJS(d, [md.x, md.y, md.z], arr(U.uMoonLow.value), arr(U.uMoonHigh.value), scat, hb, false, out);
    lightScatterJS(d, [s2.x, s2.y, s2.z], arr(U.uSun2Col.value), arr(U.uSun2Col.value), scat, hb, true, out);
    const o = U.uOvercast.value;
    if (o > 0 && !clear) {
      const c = d[0] * sd.x + d[1] * sd.y + d[2] * sd.z, zen = arr(U.uDeckZen.value), hor = arr(U.uDeckHor.value), sun = arr(U.uDeckSun.value);
      const t = 1 - Math.exp(-3.5 * y), p = Math.exp(3 * (c - 1));
      for (let i = 0; i < 3; i++) out[i] = mix(out[i], mix(hor[i], zen[i], t) + sun[i] * p, o);
    }
    return out;
  }
  const aces = (x) => clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0, 1);
  // inverse of aces() above (solves the rational curve for x)
  const invAces = (y) => {
    y = clamp(y, 0, 0.98);
    const a = 2.51 - 2.43 * y, b = 0.03 - 0.59 * y, c = -0.14 * y;
    return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  };
  const display = (c, exposure) => c.map((v) => Math.pow(aces(v * exposure), 1 / 2.2));

  // directions used to estimate the average sky light (for exposure, clouds and the land tint)
  const PROBES = [[0, 1, 0], [0, 0.5, -0.866], [0.7, 0.3, -0.648], [-0.7, 0.3, -0.648], [0, 0.3, 0.954]]
    .map((v) => { const l = Math.hypot(...v); return v.map((x) => x / l); });

  const AMB = 2.5;         // weight of sky light against direct light on the land
  let lastTravelled = null;
  let lastBeat = 0, beatSeq = 0, meteorT = -1, meteorWait = 0, meteorPin = null;
  // A meteor starts somewhere in the upper part of the window and falls 10 to 18 degrees on a slant.
  function startMeteor(aspect, shift) {
    const th = U.uTanHalf.value, r = Math.random;
    const dirOf = (u, v) => new THREE.Vector3(u * th * aspect, (v + shift) * th, -1).normalize();   // u, v in -1..1 of the window
    const u0 = -0.8 + 1.6 * r(), v0 = 0.35 + 0.55 * r(), ang = (r() < 0.5 ? -1 : 1) * (0.5 + 0.7 * r()), len = 0.45 + 0.4 * r();
    U.uMeteorA.value.copy(dirOf(u0, v0));
    U.uMeteorB.value.copy(dirOf(u0 + Math.sin(ang) * len / aspect, v0 - Math.cos(ang) * len));
    meteorT = 0; meteorWait = 8;
  }
  // A meteor shower (events.js, on a breakdown at night): n meteors in `seconds`, all from one
  // radiant above the window, up to three at once in their own slots beside the ordinary one.
  // The schedule is fixed by `seed` and played by showerAt(t), so a still can hold any moment.
  let showerList = null;
  function shower(n, seconds, seed = 1) {
    let s = (seed * 2654435761) >>> 0;
    const r = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    const th = U.uTanHalf.value, aspect = U.uAspect.value, shift = U.uShift.value;
    const dirOf = (u, v) => new THREE.Vector3(u * th * aspect, (v + shift) * th, -1).normalize();
    const ru = -0.45 + 0.9 * r(), rv = 1.1 + 0.3 * r();           // the radiant, just above the top
    const starts = Array.from({ length: n }, (_, i) => (i === 0 ? 0.1 : 0.1 + r() * Math.max(0.5, seconds - 1))).sort((a, b) => a - b);
    const free = [0, 0, 0];
    showerList = [];
    for (const t0 of starts) {
      const dur = 0.7 + 0.5 * r();
      let k = 0; for (let j = 1; j < 3; j++) if (free[j] < free[k]) k = j;
      const at = Math.max(t0, free[k] + 0.05);
      free[k] = at + dur;
      // away from the radiant, mostly downward, fanned up to 55 degrees either side
      const phi = (r() - 0.5) * 1.9, du = Math.sin(phi) / aspect, dv = -Math.cos(phi);   // (u is aspect times longer than v)
      const d0 = 0.35 + 0.6 * r(), len = 0.25 + 0.35 * r();
      showerList.push({ at, dur, slot: k, a: dirOf(ru + du * d0, rv + dv * d0), b: dirOf(ru + du * (d0 + len), rv + dv * (d0 + len)) });
    }
    return Math.max(...free);
  }
  const SLOT_A = ['uShowerA0', 'uShowerA1', 'uShowerA2'], SLOT_B = ['uShowerB0', 'uShowerB1', 'uShowerB2'];
  function showerAt(t) {
    const T = U.uShowerT.value; T.set(-1, -1, -1);
    // brighter than the stray meteor, and bright enough to see over a city's glow wherever stars are
    U.uShowerGain.value = 4.5 * Math.min(1, 0.3 + 2.5 * U.uStars.value);
    if (!showerList || t == null || t < 0) { if (t == null) showerList = null; return; }
    for (const m of showerList) {
      const f = (t - m.at) / m.dur;
      if (f < 0 || f >= 1) continue;
      T.setComponent(m.slot, f);
      U[SLOT_A[m.slot]].value.copy(m.a); U[SLOT_B[m.slot]].value.copy(m.b);
    }
  }

  // Constellations: each figure has its own envelope, started by the beat that chose it. Stars
  // lead (a 50 ms attack, then decay with a 0.42 s time constant: gone in about 0.9 s); the
  // lines follow 60 ms behind and fade sooner (0.3 s). A beat that chooses other figures cuts the
  // ones still showing with a 0.12 s release, so each beat holds its own subset without a pop.
  // A figure surfacing by itself (no music) runs the same envelope 2.5 times slower.
  const con = { clock: 0, t0: new Float64Array(N_CON).fill(-1e9), cut: new Float64Array(N_CON).fill(1e9), slow: new Float64Array(N_CON).fill(1),
    peak: new Float64Array(N_CON).fill(1), bag: [], bagSeed: 1, lastOnset: -1e9, idleNext: 8, nextAt: 4, pin: null };
  const conCentre = CONSTELLATIONS.map((c) => {
    const az = (c.at[0] * Math.PI) / 180, el = (c.at[1] * Math.PI) / 180;
    return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
  });
  // is the figure's centre well inside the window? (u, v in -1..1 of the frame, v = 0 mid-height)
  function conInView(k, aspect, shift) {
    const [x, y, z] = conCentre[k], th = U.uTanHalf.value;
    const u = x / -z / (th * aspect), v = y / -z / th - shift;
    return Math.abs(u) < 0.86 && v < 0.84;
  }
  // The figures are dealt from a shuffled deck of all of them (reshuffled from a counter when it
  // runs out), skipping those out of frame, so every figure comes round equally often and no
  // figure shows twice in a row unless it is the only one in view.
  function conDeal(n, aspect, shift) {
    const picked = [];
    for (let tries = 0; tries < 2 * N_CON + 2 && picked.length < n; tries++) {
      if (!con.bag.length) {
        let s = (con.bagSeed++ * 2654435761) >>> 0;
        const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
        con.bag = [...Array(N_CON).keys()];
        for (let i = N_CON - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [con.bag[i], con.bag[j]] = [con.bag[j], con.bag[i]]; }
      }
      const k = con.bag.shift();
      if (conInView(k, aspect, shift) && !picked.includes(k)) picked.push(k);
    }
    return picked;
  }
  function conStart(list, slow, peak) {
    const now = con.clock;
    for (let k = 0; k < N_CON; k++) {
      if (list.includes(k)) { con.t0[k] = now; con.cut[k] = 1e9; con.slow[k] = slow; con.peak[k] = peak; }
      else con.cut[k] = Math.min(con.cut[k], now);
    }
  }
  const conEnv = (a) => [   // [stars, lines] at age a (seconds, already slowed)
    a < 0 || a > 5 ? 0 : smoothstep(0, 0.05, a) * Math.exp(-Math.max(a - 0.05, 0) / 0.42),
    a < 0 || a > 5 ? 0 : smoothstep(0.06, 0.22, a) * Math.exp(-Math.max(a - 0.22, 0) / 0.3),
  ];
  function updateConstellations(on, live, onset, beat, dt, aspect, shift) {
    con.clock += Math.max(dt, 0);
    const now = con.clock;
    U.uConOn.value = on || con.pin ? 1 : 0;
    // The ordinary stars answer every beat as they do everywhere (a third of them flare). A figure
    // is the occasional event on top of that: every ten seconds or so (never sooner than five
    // after the last) a beat lights one constellation (two, once in a while), which lingers for
    // a second or two while the beats go on beneath it.
    U.uFlareThr.value.set(0.66, 0.6);
    if (on && live && onset && now >= con.nextAt) {
      const f = Math.abs((Math.sin(beatSeq * 12.9898) * 43758.5453) % 1);
      if (f < 0.3) {
        conStart(conDeal(f < 0.045 ? 2 : 1, aspect, shift), 1.8, 0.8 + 0.2 * beat);
        con.nextAt = now + 5 + 6 * Math.random();
      }
    }
    if (onset) con.lastOnset = now;
    // with no music, one figure surfaces by itself every quarter of a minute or so
    if (on && live && now - con.lastOnset > 6 && now > con.idleNext) {
      conStart(conDeal(1, aspect, shift), 2.5, 0.85);
      con.idleNext = now + 10 + 8 * Math.random();
    }
    if (!(on && live)) for (let k = 0; k < N_CON; k++) con.cut[k] = Math.min(con.cut[k], now);   // stopped, reduced motion, day
    for (let k = 0; k < N_CON; k++) {
      let s = 0, l = 0;
      if (con.pin) { if (con.pin.list.includes(k)) [s, l] = conEnv(con.pin.age); }
      else {
        [s, l] = conEnv((now - con.t0[k]) / con.slow[k]);
        const fade = now > con.cut[k] ? Math.exp(-(now - con.cut[k]) / 0.12) : 1;
        s *= fade * con.peak[k]; l *= fade * con.peak[k];
      }
      U.uCon.value[k].set(s < 0.002 ? 0 : s, l < 0.002 ? 0 : l);
    }
  }
  let noonRef = null;    // reference daylight for normalising the land tint
  let exposureSmooth = null;
  let paths = makePaths(39.7), pathsKey = 0;

  function computeLights(hour, level, dials) {
    paths.sun(hour, sunDir);
    paths.moon(hour, moonDir);
    U.uSunDir.value.copy(sunDir);
    U.uMoonDir.value.copy(moonDir);
    const sy = sunDir.y, my = moonDir.y;
    // astronomical night: below about -12 deg the sun contributes nothing (moon and airglow own it)
    const dusk = smoothstep(-0.21, -0.12, sy);
    // low air: light enters the view path from the side, about half the horizontal air mass
    setC(U.uSunLow.value, bodyLight(sy, dusk, 0.5, 30));
    // high air sees the sun ~3.5 deg higher, through thin air; once the sun is down that light
    // crosses the ozone layer on a long grazing path, which is what keeps twilight blue
    setC(U.uSunHigh.value, bodyLight(sy + 0.06, dusk, 0.15, 28, 1 + 1.4 * smoothstep(0.05, -0.08, sy)));
    setC(U.uSunDirect.value, bodyLight(sy + 0.015, dusk, 0.8, 60)); // clouds at 1.6 km keep the light a little longer
    // moonlight relative to sunlight (a display choice), slightly blue the way night footage reads
    const MOON = 0.0035, MOON_TINT = [0.8, 0.93, 1.18];
    const moonL = (...a) => bodyLight(...a).map((v, i) => v * MOON_TINT[i]);
    setC(U.uMoonLow.value, moonL(my, MOON, 0.5, 60));
    setC(U.uMoonHigh.value, moonL(my + 0.06, MOON, 0.15, 60, 2));
    setC(U.uMoonDirect.value, moonL(my + 0.015, MOON, 0.8, 60));
    U.uNightGlow.value.setRGB(0.0002, 0.0003, 0.0006);            // airglow and starlight: a floor for night

    // level 1, scale dial: a second, paler sun resting on the horizon, right of centre
    const s2 = level >= 1 ? smoothstep(0.2, 0.7, dials.scale) : 0;
    const t = U.uTime.value;
    const az2 = 0.55 * paths.sunAz * Math.PI / 180 + 0.02 * Math.sin(t * 0.013);   // right of centre, in frame
    U.uSun2Dir.value.set(Math.sin(az2), 0.035 + 0.012 * Math.sin(t * 0.021), -Math.cos(az2)).normalize();
    // its strength is set in exposed (display) terms, so it stays an ember at night instead of
    // being amplified by the night exposure; uses last frame's exposure to avoid a loop
    const sun2 = (s2 * mix(0.02, 0.3, smoothstep(-0.2, 0.05, sunDir.y))) / (exposureSmooth || 5);
    U.uSun2Col.value.setRGB(sun2 * 1.0, sun2 * 0.62, sun2 * 0.5);
    return s2;
  }

  // Overcast: how bright the deck is for a given daylight E (the land's light before exposure,
  // see update). Chosen so a full overcast at midday shows a pale grey overhead (~0.72 on screen),
  // a darker grey at the horizon (~0.55), and the land at ~60% of a clear day's light.
  const DECK_ZEN = 0.062, DECK_HOR = 0.036, DECK_SUN = 0.012, DECK_LAND = 0.33;
  const DECK_GREY = [0.93, 0.99, 1.07];   // a slightly cool grey (luminance ~1)
  const cosOf = (y) => smoothstep(-0.03, 0.04, y) * (0.45 + 0.55 * smoothstep(0, 0.6, y));   // soft Lambert
  let hintOverride = null;
  const sunDirOut = new THREE.Vector3(0, 1, 0);

  function update(state) {
    const { hour = 12, level = 0, dials = {}, time = 0, dt = 0, aspect = 16 / 9, fovDeg = 50, travelled = 0, energy = 0, beat = 0, sparkle = 0, sky: hint = null, shift = 0, motionT = 0, moving = true, twinkle = 1 } = state;
    U.uShift.value = shift;
    // A biome may ask for a richer night sky: { stars: brightness x, deep: 0..1 extra faint stars,
    // milkyWay: 0..1, clear: 0..1 fewer clouds, constellations: 1 figures that answer the beat },
    // or for rain: { overcast: 0..1 a grey deck }. All default to the plain sky.
    const skyHint = hintOverride ? { ...(hint || {}), ...hintOverride } : hint || {};
    const o = clamp(skyHint.overcast || 0, 0, 1);
    const L1 = level >= 1 ? 1 : 0;
    const scaleDial = L1 * (dials.scale || 0), topo = L1 * (dials.topology || 0), timeDial = dials.time || 0;
    U.uTime.value = time;
    U.uTanHalf.value = Math.tan((fovDeg * Math.PI) / 360);
    U.uAspect.value = aspect;
    const halfH = (Math.atan(U.uTanHalf.value * aspect) * 180) / Math.PI;
    if (Math.abs(halfH - pathsKey) > 0.5) { paths = makePaths(halfH); pathsKey = halfH; noonRef = null; }
    const s2 = computeLights(hour, level, dials);
    const sy = sunDir.y;

    // ---- average sky light, exposure (partial adaptation: night stays dark). The camera exposes
    // for the clear sky, so an overcast day reads as a dull day and not as a re-exposed clear one.
    U.uOvercast.value = 0;
    const clearSamples = PROBES.map((d) => skyBaseJS(d, true));
    const avgClear = [0, 0, 0];
    for (const c of clearSamples) for (let i = 0; i < 3; i++) avgClear[i] += c[i] / PROBES.length;
    const sunD = arr(U.uSunDirect.value), moonD = arr(U.uMoonDirect.value);
    const cosS = cosOf(sy), cosM = cosOf(moonDir.y);
    // ---- overcast deck: lit by all the daylight there is, diffused into a grey; overhead the
    // deck is thinner and lighter, toward the horizon one sees through more of it; at twilight its
    // lower part takes a little of the clear sky's colour at the horizon (a warm or cold stain)
    if (o > 0) {
      // (lifted a little around sunset, as the eye and camera would, so dusk is slate and not black)
      const E = (lum(sunD) * cosS + lum(moonD) * cosM + lum(avgClear) * AMB) * (1 + 0.9 * smoothstep(0.2, 0, sy) * smoothstep(-0.2, -0.05, sy));
      const hzc = skyBaseJS([0, 0, -1], true), hl = Math.max(lum(hzc), 1e-9);
      const stain = 0.35 * smoothstep(0.3, 0.02, sy) * smoothstep(-0.22, -0.04, sy);
      const sunUp = lum(sunD) * smoothstep(-0.04, 0.12, sy);
      U.uDeckZen.value.setRGB(...DECK_GREY.map((g) => DECK_ZEN * E * g));
      U.uDeckHor.value.setRGB(...DECK_GREY.map((g, i) => DECK_HOR * E * mix(g, hzc[i] / hl, stain)));
      U.uDeckSun.value.setRGB(...[1.03, 1.0, 0.95].map((g) => DECK_SUN * sunUp * g));
    }
    U.uOvercast.value = o;
    const samples = o > 0 ? PROBES.map((d) => skyBaseJS(d)) : clearSamples;
    const avg = [0, 0, 0];
    for (const c of samples) for (let i = 0; i < 3; i++) avg[i] += c[i] / PROBES.length;
    // ambient for clouds: sky light from above plus a little bounce of the direct light
    const dk = 1 - o;
    U.uAmbient.value.setRGB(avg[0] * 1.6 + 0.04 * dk * (sunD[0] + moonD[0]), avg[1] * 1.6 + 0.04 * dk * (sunD[1] + moonD[1]), avg[2] * 1.6 + 0.04 * dk * (sunD[2] + moonD[2]));
    if (o > 0) { U.uSunDirect.value.multiplyScalar(dk); U.uMoonDirect.value.multiplyScalar(dk); }   // no direct light on the clouds under a deck
    const key = skyKey(clearSamples);
    let exposure = exposureFor(key);
    exposureSmooth = exposureSmooth == null || dt <= 0 ? exposure : exposureSmooth + (exposure - exposureSmooth) * Math.min(1, dt * 2);
    exposure = exposureSmooth;
    U.uExposure.value = exposure;

    // ---- discs and stars (all of them fade behind a deck)
    const night = smoothstep(0.02, -0.16, sy);
    const hide = dk * dk * dk;
    U.uSunDisc.value = 40 * smoothstep(-0.02, 0.0, sy + 0.01) * hide;
    U.uMoonRadius.value = 0.0047 * (1 + 8 * smoothstep(0, 1, scaleDial));
    U.uMoonDisc.value = mix(0.35, 1.5, night) * smoothstep(-0.03, 0.01, moonDir.y) * hide;
    // the stars brighten with the treble, so hi-hats make the night sky glitter
    U.uStars.value = smoothstep(-0.07, -0.2, sy) * (1 - 0.35 * smoothstep(0, 0.3, moonDir.y)) * (1 + 0.4 * L1) * (1 + 0.9 * sparkle) * (skyHint.stars || 1) * dk * dk;
    U.uDeep.value = skyHint.deep || 0;
    // The stars live a little: they scintillate on a clock that stops with the train (motionT), a
    // different third of them flares on each beat, and now and then a meteor crosses the window,
    // most often on a hard hit. twinkle = 0 (reduced motion) holds all of it still.
    U.uTwinkle.value = twinkle;
    U.uTwT.value = motionT % 3600;
    const onset = beat > lastBeat + 0.25;
    if (onset) { beatSeq = (beatSeq + 1) % 1024; if (twinkle > 0 && moving && meteorT < 0 && meteorWait <= 0 && beat > 0.7 && Math.random() < 0.3) startMeteor(aspect, shift); }
    lastBeat = beat;
    U.uBeatSeq.value = beatSeq;
    U.uStarBeat.value = twinkle * beat;
    meteorWait -= dt;
    if (twinkle > 0 && moving && meteorT < 0 && meteorWait <= -40 && Math.random() < dt / 30) startMeteor(aspect, shift);   // and without music, one every minute or so
    if (meteorT >= 0) { meteorT += dt / 0.75; if (meteorT >= 1) meteorT = -1; }
    if (meteorPin != null) meteorT = meteorPin;   // screenshots only
    U.uMeteorT.value = meteorT;
    // constellations: only where a biome asks, only while there are stars to see
    updateConstellations((skyHint.constellations || 0) > 0 && U.uStars.value > 0.003, twinkle > 0 && moving, onset, beat, dt, aspect, shift);
    U.uStarThresh.value = 0.86 - 0.05 * (skyHint.deep || 0);
    U.uMilky.value = skyHint.milkyWay || 0;
    // under a deck the cumulus layer becomes ragged scud below it
    U.uCoverLo.value = mix(0.52 + 0.16 * (skyHint.clear || 0), 0.5, o);
    U.uCoverHi.value = 0.58 + 0.16 * (skyHint.clear || 0);
    U.uSun2Disc.value = s2 * (0.4 + 0.6 * smoothstep(-0.25, 0.1, sy)) * dk;

    // ---- clouds: wind drift plus true parallax of the layer as the train moves (+x)
    const dTrav = lastTravelled == null ? 0 : travelled - lastTravelled;
    lastTravelled = travelled;
    const windK = 1 + 3 * L1 * timeDial;
    const lo = U.uCloudOffLo.value, hi = U.uCloudOffHi.value;
    const scud = 1 + 1.5 * o;   // the scud runs before the wind
    lo.x = (lo.x + (dTrav / 2600) + dt * 0.0035 * windK * scud) % 256;
    lo.y = (lo.y + dt * 0.0012 * windK * scud) % 256;
    hi.x = (hi.x + (dTrav / 9000) * 0.3 + dt * 0.0012 * windK) % 256;
    hi.y = (hi.y + dt * 0.0004 * windK) % 256;
    if (o > 0) {   // the deck drifts slowly, and shifts a little with the train's travel
      const dko = U.uDeckOff.value;
      dko.x = (dko.x + (dTrav / 3200) * 0.6 + dt * 0.0016 * windK) % 256;
      dko.y = (dko.y + dt * 0.0005 * windK) % 256;
    }
    // clouds catch a little light on each beat, at both levels
    U.uCloudGain.value = 1 + 0.18 * L1 * energy + 0.06 * beat;

    // ---- level-1 overhead land and aurora
    U.uTopo.value = 0.9 * smoothstep(0, 1, topo);
    U.uLandOff.value = (U.uLandOff.value + dTrav / 6000) % 256;
    U.uAurora.value = smoothstep(0.1, 0.6, topo) * smoothstep(-0.08, -0.2, sy) * (0.75 + 0.45 * energy) * dk;

    // ---- horizon colour straight ahead: exactly what the shader draws at (0, 0, -1)
    const hz = skyBaseJS([0, 0, -1]);
    const hd = display(hz, exposure);
    horizonColor.setRGB(hd[0], hd[1], hd[2]);
    // ... and 15 degrees up, so tall distant land can haze toward the sky colour at its own height
    const hh = display(skyBaseJS([0, 0.2588, -0.9659]), exposure);
    hazeHighColor.setRGB(hh[0], hh[1], hh[2]);

    // ---- light for the land: direct sun/moon (with a soft cosine) + sky light, as the camera's
    // exposure would see it, normalised so midday is ~1, then into display terms (gamma).
    // Under a deck there is no direct light, only a flat, slightly cool grey from the whole sky.
    const lightAt = (sd, md, a, e) => [0, 1, 2].map((i) => (sd[i] * cosS + md[i] * cosM + a[i] * AMB) * e);
    if (!noonRef) {
      // midday reference, computed once with the same code path
      const saved = { hour };
      computeLights(13, 0, {});
      const a2 = [0, 0, 0];
      const s2 = PROBES.map((d) => skyBaseJS(d, true));
      for (const c of s2) for (let i = 0; i < 3; i++) a2[i] += c[i] / PROBES.length;
      const e2 = exposureFor(skyKey(s2));
      const sd2 = arr(U.uSunDirect.value);
      const c13 = cosOf(sunDir.y);
      noonRef = [0, 1, 2].map((i) => (sd2[i] * c13 + a2[i] * AMB) * e2);
      noonRef = lum(noonRef);
      computeLights(saved.hour, level, dials);
      if (o > 0) { U.uSunDirect.value.multiplyScalar(dk); U.uMoonDirect.value.multiplyScalar(dk); }
    }
    let Lland = lightAt(sunD, moonD, avgClear, exposure).map((v) => v / noonRef);
    if (o > 0) {
      const flat = DECK_LAND * lum(Lland);
      Lland = Lland.map((v, i) => mix(v, flat * DECK_GREY[i], o));
    }
    // display-referred multiplier; a gentle shoulder keeps it near 1 at midday
    let tint = Lland.map((v) => Math.pow(Math.max(v, 0), 1 / 2.2));
    const tl = Math.max(...tint);
    if (tl > 1) tint = tint.map((v) => v / Math.pow(tl, 0.85));
    // night floor: dim and blue so silhouettes survive (lower under a deck, whose night is black)
    const floor = [0.12, 0.15, 0.23].map((v) => v * (1 - 0.45 * o));
    tint = tint.map((v, i) => Math.sqrt(v * v + floor[i] * floor[i] * night));
    lightTint.setRGB(tint[0], tint[1], tint[2]);

    // The engine warms the land when the sun is low (its golden-hour grade, which reads only
    // sunDir.y). Under a deck there is no low sun to see, so the sun handed out is lifted above
    // the grade's range (0.32): the grade fades out with the overcast whatever the biome's `gold`.
    sunDirOut.copy(sunDir);
    sunDirOut.y = mix(sunDir.y, Math.max(sunDir.y, 0.4), o);

    // level 1: the land seen upside down overhead, a muted green-grey lit by lightTint and half
    // lost in haze; chosen in display terms, then taken back through the tone curve
    const ALBEDO = [0.2, 0.24, 0.17];
    const land = ALBEDO.map((a, i) => mix(a * tint[i], hd[i], 0.45));
    U.uLandCol.value.setRGB(...land.map((v) => invAces(Math.pow(v, 2.2))));
  }

  update({ hour: 12, level: 0, dials: {}, time: 0, dt: 0, aspect: 16 / 9, fovDeg: 50, travelled: 0, energy: 0 });
  // sunDir: the sun as the land's grade should see it (the true sun, except under overcast)
  const sky = { object3d, update, horizonColor, hazeHighColor, lightTint, sunDir: sunDirOut,
    // for events.js: a meteor shower, and how far the stars are out (0 by day or under a deck)
    shower, showerAt, stars: () => U.uStars.value };
  // for scripts/check-sky.mjs only; not enumerable, so the interface stays the fields above
  // _debug.meteor(t) starts a meteor and holds it at t (0..1) for a screenshot
  // _debug.constellations([indices], age) holds those figures at `age` seconds into their
  //   envelope, past the gates (train stopped, reduced motion, hint off); null releases them
  // _debug.hint({ overcast: 1, ... }) is merged over the biome's sky hint; null removes it
  Object.defineProperty(sky, '_debug', { value: { skyBaseJS, uniforms, sunDir, constellations: CONSTELLATIONS.map((c) => c.name),
    meteor: (t) => { startMeteor(U.uAspect.value, U.uShift.value); meteorPin = t; },
    pinConstellations: (list, age = 0.25) => { con.pin = list ? { list, age } : null; },
    hint: (h) => { hintOverride = h || null; } }, enumerable: false });
  return sky;
}
