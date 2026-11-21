# Soma Rail

A meditation/focus website that combines [Soma FM](https://somafm.com/) internet radio with a fullscreen train video.

## The Gimmick

The page **requires your complete attention**. Any distraction causes the experience to degrade:

- **Moving your mouse** → Black overlay fades in, audio volume decreases
- **Switching tabs/windows** → Same degradation effect
- **Stay still and focused** → After 2 seconds, effects gradually fade away over 5 seconds

The more distracted you are, the more the video darkens and audio quiets. Stay completely still and focused to enjoy the full experience.

## Running Locally

```bash
cd soma-rail-app
npm install
npm run dev
```

Open http://localhost:5173

## The generated train window (experimental)

Add `?view=generated` to the URL to swap the YouTube video for a train-window view drawn in the browser: a landscape of Gaussian splats sliding past, under a shader sky, behind a carriage window frame. The video stays the default, and the app falls back to it if the generated view cannot start. The design is in [`docs/procedural-train-window.md`](docs/procedural-train-window.md).

What it does today:

- **Scenery** is generated ahead of the train in chunks and thrown away behind it. Changes of scenery happen inside tunnels.
- **Distraction brakes the train.** Fidget and it slows to a stop, the motion blur shrinking until the view stands sharp and still; settle and it pulls away again. There is no fade to black in this view. The audio still quietens.
- **Time of day** is drawn afresh for each stretch of scenery: dawn and dusk (golden hour) about half the time, full day the rest, and night in the city.
- **Music** changes the view. Each SomaFM channel starts in scenery that suits it, and a new track queues a tunnel and new scenery. The audio is analysed live: each kick or snare makes trees, buildings and lights swell briefly, the treble makes foliage shimmer and lights and stars twinkle, and the bass makes everything breathe.
- **Six kinds of scenery** are written in code: rolling farmland, pine forest with lakes, salt flat with mesas, a city at night, karst country with limestone towers and paddies, and a sand-sea desert with oases. Each has a plausible and a dreamlike version.
- **Photo pieces** made from CC0 photographs stand among the code-made farmland (`soma-rail-app/public/kit/`, credits in its `index.json`).

Tuning parameters, added to the URL after `?view=generated`:

| Parameter | Default | Meaning |
| --- | --- | --- |
| `level` | from the channel | Surreal level: `0` plausible, `1` dreamlike |
| `biome` | from the channel | Force one biome: `downs`, `pinewood`, `saltflat`, `nightcity`, `karst` or `dunes` |
| `budget` | `600000` | Total splats; lower it if the view stutters |
| `kmh` | `100` | Cruising speed |
| `shutter` | `0.02` | Motion-blur length in seconds |
| `blurKeep` | `0.6` | How solid blurred splats stay, 0 to 1 |
| `slot` | drawn per scenery | Start every stretch at one time of day: `dawn`, `day`, `dusk` or `night` |
| `hour` | runs | Pin the time of day, 0 to 24 |
| `gold` | `1` | Strength of the warm light at dawn and dusk; `0` turns it off |
| `beat` | `1` | Strength of the swell on each beat; `0` turns it off |
| `sparkle` | `1` | Strength of the treble shimmer and twinkle; `0` turns it off |
| `seed` | random | A tuning aid: the same seed starts in the same scenery (track changes still alter it) |
| `kit` | `1` | `0` leaves out the photo pieces |
| `audio` | `1` | `0` turns off music analysis |
| `frame` | `1` | `0` hides the window frame |
| `debug` | `0` | `1` shows a readout (surreal level, scenery, time of day, speed, music) and enables keys: `l` surreal level, `b` next biome, `t` new scenery, `g` next time slot, `h` +1 hour, `[` `]` speed. Changes of level and scenery happen at the next tunnel; the readout says what is coming |

Developer scripts, run from `soma-rail-app/`. The ones that take screenshots need [Playwright](https://playwright.dev) installed.

| Script | What it does |
| --- | --- |
| `node scripts/window-shot.cjs out.png "seed=1&hour=12"` | Screenshot the generated view on its own (`window-harness.html`) |
| `npm run build && node scripts/app-check.cjs` | Start the built app in four cases (video, generated, no WebGL2, streams refusing CORS) and check each runs |
| `node scripts/biome-preview.mjs out.png "biome=downs&jump=4000&kmh=0"` | Draw the code-made scenery on the CPU in a few seconds, for iterating on a biome |
| `node scripts/check-biomes.mjs` | Test the scenery generators |
| `node scripts/check-audio.mjs` | Test the music analysis |
| `node scripts/check-sky.mjs out.png` | Render the sky at a range of hours |
| `node scripts/build-profiles.mjs` | Regenerate the channel profiles from SomaFM's channel list |
| `node scripts/photo-to-splats.mjs` | Rebuild the photo pieces from their CC0 sources |

## Credits

- Music streaming by [Soma FM](https://somafm.com/) - please [support them](https://somafm.com/support/)
- Train video from YouTube
- Photo pieces in the generated view are derived from CC0 panoramas on [Poly Haven](https://polyhaven.com) by Andreas Mischok, Alexander Scholten, Jacopo Voltolina, Dimitrios Savva, Jarod Guest and Alex Radosnov
- Splat rendering by [Spark](https://sparkjs.dev) and [three.js](https://threejs.org)
