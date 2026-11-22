# Soma Rail

A meditation/focus website that plays [Soma FM](https://somafm.com/) internet radio over the view from a train window. The view is not a video: it is drawn in the browser as you watch, and the music steers it.

## The Gimmick

The page **requires your complete attention**. Any distraction makes the journey falter:

- **Moving your mouse** → the train brakes and the music quietens
- **Switching tabs/windows** → the same
- **Stay still and focused** → after 2 seconds the train pulls away again and the music returns over 5 seconds

Fidget enough and the train stands still, the view sharp and silent. Stay settled to keep moving.

While the mouse is moving an overlay shows the channel list, what is playing, and a few controls for the view:

- **Scenery / Next** queues a tunnel into the next kind of scenery.
- **Dreamlike** switches the surreal version on or off (through a tunnel). Once touched, the channel no longer decides it.
- **Ignore distraction** keeps the train at speed and the music up whatever you do; the overlay still comes and goes with the mouse.
- **Frame rate** caps the view at 30, 60 or 120 frames a second (60 unless you change it).

The pointer is a small soft light that dims as you settle and is gone when your distraction reaches zero.

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
- **Music** changes the view. Each SomaFM channel starts in scenery that suits it, and a new track queues a tunnel and new scenery, of a kind not seen in the last few changes where the channel has that many to offer (a channel with one kind borrows a neighbour: the night city and the night motorway, farmland and pine forest). The app asks SomaFM what is playing every 8 to 20 seconds, so the tunnel follows a new song closely. The audio is analysed live: each kick or snare makes trees, buildings and lights swell and brighten briefly (in karst, desert and Himalaya only chosen things do: houses, trees, boats, tents, camels, yaks, never the hills themselves), the treble makes foliage shimmer and lights twinkle, and the bass makes everything breathe. At night the stars scintillate, a different third of them flares on each beat, and a meteor crosses now and then. In Safari and on iPhones and iPads the analysis is off unless you add `audio=1`, because those browsers can go silent when a radio stream is analysed; the channel and track changes still steer the view there.
- **A few things move on their own**: prayer flags, washing lines and pennants ripple in gusts; vehicles run along the motorway with white headlamps, red tail lamps and amber-sided lorries, three lanes each way at different speeds; mist, smoke, dust and plumes billow slowly; snow, rain and cherry petals fall. They stop when the train does.
- **Eleven kinds of scenery** are written in code: rolling farmland; pine forest with lakes; a salt flat with mesas, salt works, a motel, a locomotive graveyard and wild horses; a city at night; karst country with limestone towers, paddies and river boats; a sand-sea desert with caravans, camps, forts and oases; a high Himalayan valley under a steep mountain wall (villages, prayer flags, yaks, caravans, monks); an English motorway at night under a sky of stars; snow country in winter (villages with lights, skaters, a sleigh, a ski lift, falling snow); Japan below Mount Fuji (paddies, tea hills, torii, pagodas, cherry blossom; there is one Fuji, and it stays with the journey, drifting slowly across the window while the country races past); and a tropical coast (palms, a lagoon, overwater bungalows) alternating with rainforest, with the odd shower. Each has a plausible and a dreamlike version.
- **Photo pieces** made from CC0 photographs stand among the code-made farmland (`soma-rail-app/public/kit/`, credits in its `index.json`).

Tuning parameters, added to the URL (for example `?debug=1&budget=300000`):

| Parameter | Default | Meaning |
| --- | --- | --- |
| `level` | from the channel | Surreal level: `0` plausible, `1` dreamlike |
| `biome` | from the channel | Force one biome: `downs`, `pinewood`, `saltflat`, `nightcity`, `karst`, `dunes`, `himalaya`, `motorway`, `winter`, `fuji` or `tropics` |
| `budget` | `600000` | Total splats; lower it if the view stutters |
| `kmh` | `100` | Cruising speed |
| `shutter` | `0.02` | Motion-blur length in seconds |
| `blurKeep` | `0.6` | How solid blurred splats stay, 0 to 1 |
| `slot` | drawn per scenery | Start every stretch at one time of day: `dawn`, `day`, `dusk` or `night` |
| `fps` | the overlay's setting | Frame-rate cap, for example `30`; overrides the overlay |
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
| `npm run build && node scripts/app-check.cjs` | Start the built app in five cases (the bare URL, a Start click before the stream is known, a tuned run that also presses the overlay's controls, no WebGL2, streams refusing CORS) and check each runs. `IDLE=1 ONLY=tuned` in front also waits for the train to stop and checks the engine goes idle (several minutes) |
| `node scripts/motion-frames.cjs outDir "biome=motorway&hour=1&kmh=0" --n 24 --dt 0.1` | Capture a run of frames with the motion clock stepped by hand, to look at moving things on a machine too slow to play them |
| `node scripts/pass-strip.mjs out.png "seed=7&biome=saltflat" --x 9013 --d 79` | One object at five angles across a pass, from the left of the frame to the right, in one image: catches things that fall apart when seen from the side |
| `node scripts/biome-preview.mjs out.png "biome=downs&jump=4000&kmh=0"` | Draw the code-made scenery on the CPU in a few seconds, for iterating on a biome |
| `node scripts/check-biomes.mjs` | Test the scenery generators |
| `node scripts/check-rng.mjs` | Check the hash and noise helpers still return exactly the values every world is built from |
| `node scripts/check-audio.mjs` | Test the music analysis |
| `node scripts/check-sky.mjs out.png` | Render the sky at a range of hours |
| `node scripts/build-profiles.mjs` | Regenerate the channel profiles from SomaFM's channel list |
| `node scripts/photo-to-splats.mjs` | Rebuild the photo pieces from their CC0 sources |

## Credits

- Music streaming by [Soma FM](https://somafm.com/) - please [support them](https://somafm.com/support/)
- Photo pieces in the view are derived from CC0 panoramas on [Poly Haven](https://polyhaven.com) by Andreas Mischok, Alexander Scholten, Jacopo Voltolina, Dimitrios Savva, Jarod Guest and Alex Radosnov
- Splat rendering by [Spark](https://sparkjs.dev) and [three.js](https://threejs.org)
