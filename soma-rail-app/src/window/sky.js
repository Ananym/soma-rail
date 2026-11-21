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
// Shaders
// ---------------------------------------------------------------------------------------------
const vertexShader = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }   // at the far plane
`;

const fragmentShader = /* glsl */`
varying vec2 vUv;
uniform float uTanHalf, uAspect, uTime, uExposure;
uniform vec3 uTauR, uTauM;
uniform vec3 uSunDir, uSunLow, uSunHigh, uSunDirect;     // light colours: low/high atmosphere, at clouds
uniform vec3 uMoonDir, uMoonLow, uMoonHigh, uMoonDirect;
uniform vec3 uSun2Dir, uSun2Col;                           // level-1 second sun (uSun2Col = 0 when off)
uniform vec3 uNightGlow, uAmbient;                         // airglow; average sky light for clouds
uniform float uSunDisc, uMoonDisc, uMoonRadius, uSun2Disc, uStars;
uniform float uStarThresh, uDeep, uMilky;                   // a biome's night-sky hint (see update)
uniform vec2 uCloudOffLo, uCloudOffHi;
uniform float uCoverLo, uCoverHi, uCloudGain;
uniform float uTopo, uAurora, uLandOff;
uniform vec3 uLandCol;

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
  return col;
}

vec3 aces(vec3 x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

// A body disc: 1 inside radius r (radians), anti-aliased over one pixel.
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
  // aerial perspective: far clouds sink into the sky colour, and the layer fades at the horizon
  float dist = H / y;
  float aer = exp(-dist / 30000.0);
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
  vec3 dir = normalize(vec3((vUv.x * 2.0 - 1.0) * uTanHalf * uAspect, (vUv.y * 2.0 - 1.0) * uTanHalf, -1.0));
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
        col += sc * b * exp(-dd * dd * 2.2) * uStars * ext.g * moonMask;
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
          col += vec3(0.85, 0.9, 1.0) * b * exp(-dd * dd * 2.6) * uStars * uDeep * ext.g * moonMask;
        }
      }
    }

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

    // ---- clouds: cirrus high, then cumulus in front
    vec4 ci = cirrus(dir, sky, px);
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
    uTime: { value: 0 }, uExposure: { value: 1 },
    uTauR: { value: new THREE.Vector3(...TAU_R) }, uTauM: { value: new THREE.Vector3(...TAU_M) },
    uSunDir: { value: V3() }, uSunLow: { value: C3() }, uSunHigh: { value: C3() }, uSunDirect: { value: C3() },
    uMoonDir: { value: V3() }, uMoonLow: { value: C3() }, uMoonHigh: { value: C3() }, uMoonDirect: { value: C3() },
    uSun2Dir: { value: new THREE.Vector3(0.3, 0.04, -0.95).normalize() }, uSun2Col: { value: C3() },
    uNightGlow: { value: C3() }, uAmbient: { value: C3() },
    uSunDisc: { value: 0 }, uMoonDisc: { value: 0 }, uMoonRadius: { value: 0.005 }, uSun2Disc: { value: 0 }, uStars: { value: 0 },
    uStarThresh: { value: 0.86 }, uDeep: { value: 0 }, uMilky: { value: 0 },
    uCloudOffLo: { value: new THREE.Vector2(17.3, 5.1) }, uCloudOffHi: { value: new THREE.Vector2(3.7, 40.2) },
    uCoverLo: { value: 0.52 }, uCoverHi: { value: 0.58 }, uCloudGain: { value: 1 },
    uTopo: { value: 0 }, uAurora: { value: 0 }, uLandOff: { value: 0 }, uLandCol: { value: C3() },
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
  function skyBaseJS(d) {
    const y = yEff(Math.max(d[1], 0));
    const m = airmass(y);
    const scat = [0, 1, 2].map((i) => 1 - Math.exp(-(TAU_R[i] + TAU_M[i]) * m));
    const hb = 1 - Math.exp(-4 * y);
    const out = [0, 1, 2].map((i) => U.uNightGlow.value[['r', 'g', 'b'][i]] * scat[i]);
    const sd = U.uSunDir.value, md = U.uMoonDir.value, s2 = U.uSun2Dir.value;
    lightScatterJS(d, [sd.x, sd.y, sd.z], arr(U.uSunLow.value), arr(U.uSunHigh.value), scat, hb, false, out);
    lightScatterJS(d, [md.x, md.y, md.z], arr(U.uMoonLow.value), arr(U.uMoonHigh.value), scat, hb, false, out);
    lightScatterJS(d, [s2.x, s2.y, s2.z], arr(U.uSun2Col.value), arr(U.uSun2Col.value), scat, hb, true, out);
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
  let noonRef = null;     // reference daylight for normalising the land tint
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

  function update(state) {
    const { hour = 12, level = 0, dials = {}, time = 0, dt = 0, aspect = 16 / 9, fovDeg = 50, travelled = 0, energy = 0, beat = 0, sparkle = 0, sky: hint = null } = state;
    // A biome may ask for a richer night sky: { stars: brightness x, deep: 0..1 extra faint stars,
    // milkyWay: 0..1, clear: 0..1 fewer clouds }. All default to the plain sky.
    const skyHint = hint || {};
    const L1 = level >= 1 ? 1 : 0;
    const scaleDial = L1 * (dials.scale || 0), topo = L1 * (dials.topology || 0), timeDial = dials.time || 0;
    U.uTime.value = time;
    U.uTanHalf.value = Math.tan((fovDeg * Math.PI) / 360);
    U.uAspect.value = aspect;
    const halfH = (Math.atan(U.uTanHalf.value * aspect) * 180) / Math.PI;
    if (Math.abs(halfH - pathsKey) > 0.5) { paths = makePaths(halfH); pathsKey = halfH; noonRef = null; }
    const s2 = computeLights(hour, level, dials);
    const sy = sunDir.y;

    // ---- average sky light, exposure (partial adaptation: night stays dark)
    const avg = [0, 0, 0];
    const samples = PROBES.map(skyBaseJS);
    for (const c of samples) for (let i = 0; i < 3; i++) avg[i] += c[i] / PROBES.length;
    const sunD = arr(U.uSunDirect.value), moonD = arr(U.uMoonDirect.value);
    // ambient for clouds: sky light from above plus a little bounce of the direct light
    U.uAmbient.value.setRGB(avg[0] * 1.6 + 0.04 * (sunD[0] + moonD[0]), avg[1] * 1.6 + 0.04 * (sunD[1] + moonD[1]), avg[2] * 1.6 + 0.04 * (sunD[2] + moonD[2]));
    const key = skyKey(samples);
    let exposure = exposureFor(key);
    exposureSmooth = exposureSmooth == null || dt <= 0 ? exposure : exposureSmooth + (exposure - exposureSmooth) * Math.min(1, dt * 2);
    exposure = exposureSmooth;
    U.uExposure.value = exposure;

    // ---- discs and stars
    const night = smoothstep(0.02, -0.16, sy);
    U.uSunDisc.value = 40 * smoothstep(-0.02, 0.0, sy + 0.01);
    U.uMoonRadius.value = 0.0047 * (1 + 8 * smoothstep(0, 1, scaleDial));
    U.uMoonDisc.value = mix(0.35, 1.5, night) * smoothstep(-0.03, 0.01, moonDir.y);
    // the stars brighten with the treble, so hi-hats make the night sky glitter
    U.uStars.value = smoothstep(-0.07, -0.2, sy) * (1 - 0.35 * smoothstep(0, 0.3, moonDir.y)) * (1 + 0.4 * L1) * (1 + 0.9 * sparkle) * (skyHint.stars || 1);
    U.uDeep.value = skyHint.deep || 0;
    U.uStarThresh.value = 0.86 - 0.05 * (skyHint.deep || 0);
    U.uMilky.value = skyHint.milkyWay || 0;
    U.uCoverLo.value = 0.52 + 0.16 * (skyHint.clear || 0);
    U.uCoverHi.value = 0.58 + 0.16 * (skyHint.clear || 0);
    U.uSun2Disc.value = s2 * (0.4 + 0.6 * smoothstep(-0.25, 0.1, sy));

    // ---- clouds: wind drift plus true parallax of the layer as the train moves (+x)
    const dTrav = lastTravelled == null ? 0 : travelled - lastTravelled;
    lastTravelled = travelled;
    const windK = 1 + 3 * L1 * timeDial;
    const lo = U.uCloudOffLo.value, hi = U.uCloudOffHi.value;
    lo.x = (lo.x + (dTrav / 2600) + dt * 0.0035 * windK) % 256;
    lo.y = (lo.y + dt * 0.0012 * windK) % 256;
    hi.x = (hi.x + (dTrav / 9000) * 0.3 + dt * 0.0012 * windK) % 256;
    hi.y = (hi.y + dt * 0.0004 * windK) % 256;
    // clouds catch a little light on each beat, at both levels
    U.uCloudGain.value = 1 + 0.18 * L1 * energy + 0.06 * beat;

    // ---- level-1 overhead land and aurora
    U.uTopo.value = 0.9 * smoothstep(0, 1, topo);
    U.uLandOff.value = (U.uLandOff.value + dTrav / 6000) % 256;
    U.uAurora.value = smoothstep(0.1, 0.6, topo) * smoothstep(-0.08, -0.2, sy) * (0.75 + 0.45 * energy);

    // ---- horizon colour straight ahead: exactly what the shader draws at (0, 0, -1)
    const hz = skyBaseJS([0, 0, -1]);
    const hd = display(hz, exposure);
    horizonColor.setRGB(hd[0], hd[1], hd[2]);
    // ... and 15 degrees up, so tall distant land can haze toward the sky colour at its own height
    const hh = display(skyBaseJS([0, 0.2588, -0.9659]), exposure);
    hazeHighColor.setRGB(hh[0], hh[1], hh[2]);

    // ---- light for the land: direct sun/moon (with a soft cosine) + sky light, as the camera's
    // exposure would see it, normalised so midday is ~1, then into display terms (gamma).
    const cosOf = (y) => smoothstep(-0.03, 0.04, y) * (0.45 + 0.55 * smoothstep(0, 0.6, y));   // soft Lambert
    const cosS = cosOf(sy), cosM = cosOf(moonDir.y);
    const lightAt = (sd, md, a, e) => [0, 1, 2].map((i) => (sd[i] * cosS + md[i] * cosM + a[i] * AMB) * e);
    if (!noonRef) {
      // midday reference, computed once with the same code path
      const saved = { hour };
      computeLights(13, 0, {});
      const a2 = [0, 0, 0];
      const s2 = PROBES.map(skyBaseJS);
      for (const c of s2) for (let i = 0; i < 3; i++) a2[i] += c[i] / PROBES.length;
      const e2 = exposureFor(skyKey(s2));
      const sd2 = arr(U.uSunDirect.value);
      const c13 = cosOf(sunDir.y);
      noonRef = [0, 1, 2].map((i) => (sd2[i] * c13 + a2[i] * AMB) * e2);
      noonRef = lum(noonRef);
      computeLights(saved.hour, level, dials);
    }
    const Lland = lightAt(sunD, moonD, avg, exposure).map((v) => v / noonRef);
    // display-referred multiplier; a gentle shoulder keeps it near 1 at midday
    let tint = Lland.map((v) => Math.pow(Math.max(v, 0), 1 / 2.2));
    const tl = Math.max(...tint);
    if (tl > 1) tint = tint.map((v) => v / Math.pow(tl, 0.85));
    // night floor: dim and blue so silhouettes survive
    const floor = [0.12, 0.15, 0.23];
    tint = tint.map((v, i) => Math.sqrt(v * v + floor[i] * floor[i] * night));
    lightTint.setRGB(tint[0], tint[1], tint[2]);

    // level 1: the land seen upside down overhead, a muted green-grey lit by lightTint and half
    // lost in haze; chosen in display terms, then taken back through the tone curve
    const ALBEDO = [0.2, 0.24, 0.17];
    const land = ALBEDO.map((a, i) => mix(a * tint[i], hd[i], 0.45));
    U.uLandCol.value.setRGB(...land.map((v) => invAces(Math.pow(v, 2.2))));
  }

  update({ hour: 12, level: 0, dials: {}, time: 0, dt: 0, aspect: 16 / 9, fovDeg: 50, travelled: 0, energy: 0 });
  const sky = { object3d, update, horizonColor, hazeHighColor, lightTint, sunDir };
  // for scripts/check-sky.mjs only; not enumerable, so the interface stays the five fields above
  Object.defineProperty(sky, '_debug', { value: { skyBaseJS, uniforms }, enumerable: false });
  return sky;
}
