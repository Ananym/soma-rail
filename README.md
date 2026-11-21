# Soma Rail

A meditation/focus website that plays [Soma FM](https://somafm.com/) internet radio over the view from a train window. The view is not a video: it is drawn in the browser as you watch, and the music steers it.

## The Gimmick

The page **requires your complete attention**. Any distraction makes the journey falter:

- **Moving your mouse** → the train brakes and the music quietens
- **Switching tabs/windows** → the same
- **Stay still and focused** → after 2 seconds the train pulls away again and the music returns over 5 seconds

Fidget enough and the train stands still, the view sharp and silent. Stay settled to keep moving.

## Running Locally

```bash
cd soma-rail-app
npm install
npm run dev
```

Open http://localhost:5173

## The train window

The view is a landscape of Gaussian splats sliding past, under a shader sky, behind a carriage window frame. It needs a browser with WebGL2; without it the page says so and the radio plays on. The design is in [`docs/procedural-train-window.md`](docs/procedural-train-window.md).

What it does today:

- **Scenery** is generated ahead of the train in chunks and thrown away behind it. Changes of scenery happen inside tunnels.
- **Distraction brakes the train.** Fidget and it slows to a stop, the motion blur shrinking until the view stands sharp and still; settle and it pulls away again. The audio quietens with it. A stopped train costs almost nothing to show: the clock and the music's effects rest, the view is redrawn twice a second, and a hidden tab is not drawn at all.
- **Time of day** is drawn afresh for each stretch of scenery: dawn and dusk (golden hour) about half the time, full day the rest, and night in the city and on the motorway.
- **Music** changes the view. Each SomaFM channel starts in scenery that suits it, and a new track queues a tunnel and new scenery. The audio is analysed live: each kick or snare makes trees, buildings and lights swell briefly, the treble makes foliage shimmer and lights and stars twinkle, and the bass makes everything breathe. In Safari and on iPhones and iPads the analysis is off unless you add `audio=1`, because those browsers can go silent when a radio stream is analysed; the channel and track changes still steer the view there.
- **A few things move on their own**: prayer flags ripple in gusts, vehicles run along the motorway's light trails (tail lights one way, headlights the other, three lanes at different speeds), and mist, plumes and cloud streamers billow slowly. They stop when the train does.
- **Eight kinds of scenery** are written in code: rolling farmland, pine forest with lakes, salt flat with mesas, a city at night, karst country with limestone towers and paddies, a sand-sea desert with oases, a high Himalayan valley (tiered villages, prayer flags, yaks, the snow range behind), and an English motorway at night (lamp-lit junctions, traffic as long-exposure light trails, floodlit landmarks on a low horizon, and a sky of stars and the Milky Way filling most of the window). Each has a plausible and a dreamlike version.
- **Photo pieces** made from CC0 photographs stand among the code-made farmland (`soma-rail-app/public/kit/`, credits in its `index.json`).

Tuning parameters, added to the URL (for example `?debug=1&budget=300000`):

| Parameter | Default | Meaning |
| --- | --- | --- |
| `level` | from the channel | Surreal level: `0` plausible, `1` dreamlike |
| `biome` | from the channel | Force one biome: `downs`, `pinewood`, `saltflat`, `nightcity`, `karst`, `dunes`, `himalaya` or `motorway` |
| `budget` | `600000` | Total splats; lower it if the view stutters |
| `kmh` | `100` | Cruising speed |
| `shutter` | `0.02` | Motion-blur length in seconds |
| `blurKeep` | `0.6` | How solid blurred splats stay, 0 to 1 |
| `slot` | drawn per scenery | Start every stretch at one time of day: `dawn`, `day`, `dusk` or `night` |
| `hour` | runs | Pin the time of day, 0 to 24 |
| `horizon` | the scenery's own | How far the horizon sits below the middle of the window, `0` to `0.6`; higher gives the sky more room |
| `gold` | `1` | Strength of the warm light at dawn and dusk; `0` turns it off |
| `beat` | `1` | Strength of the swell on each beat; `0` turns it off |
| `sparkle` | `1` | Strength of the treble shimmer and twinkle; `0` turns it off |
| `move` | `1` | Strength of the things that move on their own (prayer flags, motorway traffic, mist and plumes); `0` keeps everything still |
| `seed` | random | A tuning aid: the same seed starts in the same scenery (track changes still alter it) |
| `kit` | `1` | `0` leaves out the photo pieces |
| `audio` | automatic | `1` forces music analysis on, `0` turns it off. Automatic means on, except in Safari and iOS browsers |
| `sortMs` | `0` | Least time between depth sorts, in milliseconds. Try `100` if the view hitches |
| `frame` | `1` | `0` hides the window frame |
| `debug` | `0` | `1` shows a readout (surreal level, scenery, time of day, speed, music, and a hitch meter: slow frames in the last 10 seconds and what the worst one spent its time on) and enables keys: `l` surreal level, `b` next biome, `t` new scenery, `g` next time slot, `h` +1 hour, `[` `]` speed. Changes of level and scenery happen at the next tunnel; the readout says what is coming |

Developer scripts, run from `soma-rail-app/`. The ones that take screenshots need [Playwright](https://playwright.dev) installed.

| Script | What it does |
| --- | --- |
| `node scripts/window-shot.cjs out.png "seed=1&hour=12"` | Screenshot the view on its own (`window-harness.html`) |
| `npm run build && node scripts/app-check.cjs` | Start the built app in four cases (the bare URL, a tuned run, no WebGL2, streams refusing CORS) and check each runs. `IDLE=1 ONLY=tuned` in front also waits for the train to stop and checks the engine goes idle (several minutes) |
| `node scripts/motion-frames.cjs outDir "biome=motorway&hour=1&kmh=0" --n 24 --dt 0.1` | Capture a run of frames with the motion clock stepped by hand, to look at moving things on a machine too slow to play them |
| `node scripts/biome-preview.mjs out.png "biome=downs&jump=4000&kmh=0"` | Draw the code-made scenery on the CPU in a few seconds, for iterating on a biome |
| `node scripts/check-biomes.mjs` | Test the scenery generators |
| `node scripts/check-audio.mjs` | Test the music analysis |
| `node scripts/check-sky.mjs out.png` | Render the sky at a range of hours |
| `node scripts/build-profiles.mjs` | Regenerate the channel profiles from SomaFM's channel list |
| `node scripts/photo-to-splats.mjs` | Rebuild the photo pieces from their CC0 sources |

## Credits

- Music streaming by [Soma FM](https://somafm.com/) - please [support them](https://somafm.com/support/)
- Photo pieces in the view are derived from CC0 panoramas on [Poly Haven](https://polyhaven.com) by Andreas Mischok, Alexander Scholten, Jacopo Voltolina, Dimitrios Savva, Jarod Guest and Alex Radosnov
- Splat rendering by [Spark](https://sparkjs.dev) and [three.js](https://threejs.org)
