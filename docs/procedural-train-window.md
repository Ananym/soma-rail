# Soma Rail: Procedural Train Window — Design Doc

Draft of 19 November 2026, fact-checked the same day; decisions and a first build added 21 November · committed copy of the [living doc](https://claude.ai/artifact/UeqzGYDoiugh3gkaXbHHqP)

## Summary

The view is a train window generated in the browser, which has replaced the looping YouTube video the app began with: layered Gaussian splats for the land, a shader for the sky and a glass-and-camera pass on top, all steered by a slow "director".

- **Splats can be generated procedurally, at two levels.** Code arranges photoreal pieces, and code also writes splats of its own. The first gives the photographic half of the look, the second the surreal half. Both ran here on Spark 2.4.
- **The side-window camera makes this tractable.** The world is used once, from one side, and the nearest layer is motion blur.
- **Music reactivity is unblocked.** SomaFM's streams already allow cross-origin reads: in Chromium the page gets real samples with a one-attribute change. No relay and no permission from SomaFM is needed. Safari and Firefox are still to test.
- **The distraction mechanic improves.** Train speed becomes continuous, so the world can brake to a halt and sharpen as it does.
- **It is built, and it is now the app.** The video and its player are gone; the generated window is what every listener sees. It has been watched on a real GPU and judged good enough to be the default. Add `?debug=1` for a readout and tuning keys.

## What was checked

The first draft was written without web access and flagged its facts as leads. They have now been checked against the vendors' own pages, and the three claims that could be run were run. The scripts are in [`docs/checks/`](checks/).

| Question | Answer | Evidence |
| --- | --- | --- |
| Can the page read SomaFM audio samples? | Yes, in Chromium | All six stream servers (`ice1`–`ice6`), MP3 and AAC, reply with `Access-Control-Allow-Origin: *`. An `<audio crossorigin="anonymous">` fed into an `AnalyserNode` gave a peak of 0.78; the same element without the attribute gave exact silence. |
| What caused the 403s recorded in the repo? | The `Referer` header | A stream request with a `localhost` or `github.io` referrer gets 403, as does a non-browser user agent. `Origin`, `Sec-Fetch-Mode: cors` and `Sec-GPC: 1` all get 200. Both `CROSSORIGIN_FIX.md` and `BRAVE_GPC_ISSUE.md` blame the wrong header. |
| Does Spark build splats in code and rewrite them on the GPU? | Yes | A test scene on Spark 2.4.0 built 150,000 splats with `constructSplats` and `pushSplat` in 68 ms, then scrolled and hazed them with a dyno `objectModifier`. |
| Does stretching splats give motion blur? | Yes, by a different mechanism than drafted | It is one extra term in Spark's vertex shader, not a dyno modifier. See "Why splats suit this camera". |
| How big and how fast is CLAP in a browser? | 34 MB, about half a second per 10 s of audio | Quantized audio encoder, single-threaded WebAssembly, no GPU. Speed and size only; match quality was not assessed. |
| Is Essentia.js usable? | Not worth using | No release since June 2021, and its beat trackers need a whole signal, not a stream. It is also AGPL-3.0, which would bind the whole app. |

Still unverified, because this environment cannot test them:

- **Audio on Safari, iOS and Firefox.** WebKit has an open bug where live streams play but the analyser reads zeros.
- **Frame rate.** The test scene ran on a software renderer, so it says nothing about speed on a real GPU.
- **The look.** That is spike 1.

## What is built

The whole pipeline runs as the app's only view; the YouTube player was removed once the generated window was judged good enough on a real GPU. It is built and checked in a headless browser with a software renderer, so every claim below is about behaviour, not looks or speed.

| Part | State | Where |
| --- | --- | --- |
| Starting and failing | The view starts from the bare URL. Without WebGL2 a short notice takes its place and the radio plays on. An end-to-end check covers both, and fails if anything is requested from YouTube | `App.vue`, `TrainWindow.vue`, `scripts/app-check.cjs` |
| Idling | A stopped train is redrawn twice a second, generates nothing and pauses the film grain; a hidden tab is not drawn at all | `engine.js`, `TrainWindow.vue` |
| Hitch meter | The debug readout counts frames over 25 ms in the last 10 seconds and says what the worst one spent its time on (generating, rendering, or neither, which points at the GPU) | `engine.js`, `TrainWindow.vue` |
| Renderer | three.js and Spark in a lazy chunk (1.2 MB gzipped) loaded after Start; the main bundle grew by about 4 kB gzipped | `src/window/engine.js` |
| Camera effects | Motion blur, haze toward the sky colour, time-of-day tint and a "dissolve" effect, patched into Spark's vertex shader with checked anchors | `src/window/sparkPatch.js` |
| World | Four depth bands built in chunks, generated a few milliseconds per frame; a pure function of seed, band and chunk index | `engine.js`, `layers.js`, `terrain.js` |
| Scenery | Six biomes written in code on a shared prop kit: rolling farmland, pine forest with lakes, salt flat with mesas, a city at night, karst country (limestone towers, paddies, a river, mist) and a sand-sea desert (dunes, oases). Each has a plausible and a dreamlike version. 896 generator checks pass | `src/window/biomes/`, `scripts/check-biomes.mjs` |
| Photo pieces | Six sheets made from CC0 photos are shipped (9.8 MB). Two are switched on, in the farmland biome: a woodland edge and a group of houses. Two looked like pasted cut-outs in place and are off; two are untried | `kitPieces.js`, `public/kit/`, `scripts/photo-to-splats.mjs` |
| Sky | One shader: scattering by sun height, sun, moon, stars, two cloud layers; it also sets the land's haze colour and light | `src/window/sky.js` |
| Window frame and glass | A rounded frame with a sill, plus grain, a faint reflection and a vignette | `frame.js`, `TrainWindow.vue` |
| Director | Speed from the distraction score (distraction brakes the train to a stop; nothing fades to black), two surreal levels, tunnels that hide every change of scenery. Each stretch starts in a time-of-day slot: dawn or dusk about half the time, with a warm grade on the land while the sun is low | `src/window/director.js` |
| Music | The stream is loaded with CORS and analysed for loudness, bands, onsets and tempo; each channel has a starting profile; a new track queues a tunnel | `audio.js`, `audioAnalysis.js`, `profiles.json` |

What the music changes:

| Signal | What it changes |
| --- | --- |
| Channel | Starting biomes and surreal level, from a table of all 51 channels |
| Track change | A tunnel, then scenery, terrain and time of day picked from a hash of artist and title |
| Onsets (kick, snare, a struck note) | A beat pulse: everything standing above eye level swells by up to 10% and falls back in a fraction of a second, lights swell by up to a third, and clouds catch a little light |
| Treble rising above its recent average (hi-hats, cymbals, a bright entry) | A sparkle: raised scenery shimmers, lights twinkle one by one, and the stars brighten. It rests at zero between |
| Bass | A slow breath: every splat swells by up to 3.5% |
| Loudness | At the dreamlike level, layers of the scene drift apart (the dissolve); clouds and aurora brighten |
| Tempo, when the lock is firm | Mast or pole spacing of the next stretch, one per bar |

The beat pulse follows detected onsets, not a predicted beat, so it lands on what is heard and needs no tempo lock. On the live stream it fired six times in 30 seconds in a headless browser running at 3 frames a second, which shows it is wired but says nothing about how it feels. Tempo is exact on synthetic test tracks but unverified on real music: three runs on one Groove Salad track gave 156, 105 and 88 BPM.

Three failure paths were run in a headless browser and work: without WebGL2 the app shows a notice in place of the view and the radio plays on; if the streams refuse CORS the radio keeps playing without analysis; and the audio context runs when started from the Start click with no autoplay override.

Not built yet:

- **CLAP mood matching.** Scenery is chosen from channel profiles and a hash of the track, not from how the music sounds.
- **A worker for chunk generation.** Chunks are built on the main thread in small slices.
- **Glass detail.** No droplets, dirt or real reflections.
- **Predicted beats.** The pulse reacts to onsets as they happen; nothing anticipates the next beat from the tempo.
- **Weather.**

### What to look at on a real GPU

Nothing here can judge these; they are the point of the first session with it.

| Question | How to check |
| --- | --- |
| Does it pass for footage at a glance? | Open `?debug=1` and watch a few minutes of each biome (`b` cycles them) |
| Does it hold 60 fps? | The debug readout shows fps and the resolution scale it has fallen back to; try `budget=300000` and `budget=1200000` |
| Is the blur right? | Compare `shutter=0.01`, `0.02` and `0.04`; `blurKeep` trades streak solidity against thinning |
| Do chunks pop in or hitch? | Watch the far left edge at full speed; raise `slice` if scenery arrives late, lower it if frames drop when it arrives |
| Do the photo pieces belong? | In the farmland biome, compare `kit=1` with `kit=0`. In software stills the houses are convincing and the woodland edge stands correctly, but both are much sharper than the painterly scenery around them |
| Is the radio ever silent? | Analysis is off by default in Safari and on iOS, where a tapped stream can go silent; `audio=1` forces it on there and `audio=0` turns it off anywhere. Firefox is untested |
| What causes the hitches? | The readout's hitch line names what the worst frame spent its time on. Mostly "generate": move chunk generation to a worker. Mostly neither: it is the GPU upload or the sort, so try `sortMs=100` and a lower `budget` |
| Do the two surreal levels feel right? | `l` switches level through a tunnel; `level=1` starts there. The readout names the current level and what is coming |
| Is golden hour right? | `g` steps through dawn, day, dusk and night; `gold=0.5` halves the warm grade |
| Do buildings hold together as you pass? | Buildings turned away from the line used to show an open back, in the farmland and in karst country; they now have a back wall and roof. Watch a farmstead or village from approach to departure |
| Is the dissolve dreamlike or distracting? | At the dreamlike level, loud music makes layers of the scene drift apart. It has only been seen in stills; watch it move on a spacey channel such as Drone Zone |
| Is the beat pulse subtle enough? | On a rhythmic channel, trees, buildings and lights should swell with each hit and the readout's `beat` bar should jump. `beat=0.5` halves it, `beat=0` turns it off |
| Does the sand-sea desert hitch? | It generates two to three times slower than the other biomes. Watch `biome=dunes` at full speed; lower `slice` if frames drop when scenery arrives |
| Does the treble sparkle read as shimmer or as noise? | Watch foliage, lit windows and stars on a track with hi-hats. `sparkle=0` turns it off |
| Is the bass "breath" felt or seen? | Splats swell by up to 3.5% with the bass, at both levels; it should be barely noticeable |
| Does music analysis work in your browser? | The readout shows `energy` moving and, on rhythmic channels, a `bpm`; Safari and Firefox are untested |
| Do tunnels read as tunnels? | `t` forces one |

## Where we are today

*This section describes the app before the generated window was built, as the starting point the design worked from. The video player it describes has since been removed.*

Soma Rail was a static Vue 3 + Vite app on GitHub Pages that played a SomaFM stream over a muted, full-screen YouTube embed of one train journey. Nothing was rendered by us, and nothing listened to the audio.

| Piece | How it works now | What it means for the redesign |
| --- | --- | --- |
| The view | `VideoPlayer.vue` wraps the YouTube IFrame API around one hard-coded video (`YOUTUBE_VIDEO_ID` in `src/config.js`), seeks to 8 s and loops | Swap in a canvas renderer behind the same props (`visible`, `distractionScore`). No ad-blocker or embed failures. |
| Distraction mechanic | `useInteraction` turns mouse movement and tab blur into a 0–100 score; `usePlaybackControl` maps it to video playback rate and audio volume | Train speed becomes a continuous parameter. YouTube only offers a fixed set of rates and may ignore a request; a generated world can brake smoothly to a halt and pull away again. |
| Audio | A plain `<audio>` element on a SomaFM Icecast stream, no `crossorigin`, no Web Audio graph | Adding `crossorigin="anonymous"` is enough for the renderer to read samples in Chromium (see Music reactivity). |
| Referrer | `<meta name="referrer" content="no-referrer">` in `index.html` | This tag is what keeps the streams playing on `localhost`; it must stay. The `referrerpolicy` attribute on the `<audio>` element does nothing: tested alone, the stream still returned 403. |
| Metadata | `channels.json` gives genre and description; `songs/<channel>.json` is polled every 45 s for artist and title | A signal we already have, with no audio access needed, for slow style changes. |
| Hosting | GitHub Pages from `soma-rail-app/dist`, custom domain, no backend | Assets must fit a static host or move to a CDN. Pages allows a 1 GB site and about 100 GB of traffic a month. |
| Dependencies | `vue` only | The renderer is the first heavy dependency; load it after the Start click. Spark 2.4.0 is 2.9 MB minified, 1.0 MB gzipped. |

One wiring detail for the swap: `usePlaybackControl` holds the YouTube player and calls `setPlaybackRate` on it. The new view should take the 0–1 `playbackRate` it already computes as its speed input instead of handing back a player object.

## Visual target

The view should pass for footage at a glance and reveal itself as impossible on a second look. The rule that gets us there: the physics of the camera stays real, and the contents of the world do not have to be.

The camera is a side window: it slides sideways at train speed, looks out at right angles to the track, and never turns. That constraint does most of the work for us.

- **Parallax is the whole depth cue.** On-screen speed falls off as 1/distance, so a few depth bands moving at the right rates read as a deep world.
- **The world is used once, from one side.** Scenery is generated ahead, off-screen, and thrown away behind. Nothing is ever seen from the back.
- **The near field is a blur.** At 100 km/h an object 5 m from the glass crosses the window in about a quarter of a second, so the hardest layer to make detailed is the one nobody can inspect.
- **The glass is a layer too.** Reflections of the carriage, dirt, rain and the frame say "photograph" more than anything outside does.

| Band | Distance | What lives there | How it behaves on screen |
| --- | --- | --- | --- |
| Glass | 0 m | Frame, reflections, droplets, dirt | Fixed to the screen; shakes with the carriage |
| Trackside | 2–30 m | Masts, wires, fences, embankment, passing trains | Streaks; rhythm more than detail |
| Near | 30–300 m | Trees, houses, roads, platforms | Fast slide; the band where detail is actually read |
| Mid | 300 m–3 km | Fields, water, towns, forests | Slow slide; carries the sense of place |
| Far | 3 km and beyond | Mountains, skylines, anything impossible | Barely moves; where the surreal subjects sit |
| Sky | Infinite | Sun, moon, clouds, weather | Static apart from its own drift |

What must stay real, or the picture reads as a game:

- Motion blur and parallax that match the speed
- Haze: contrast and saturation fall with distance
- One sun, lighting every band consistently
- A camera: exposure that adapts, grain, a little lens softness

What is free to break, each on a dial from 0 to 1:

- **Scale**: a moon ten times too large, a mountain range that never ends
- **Topology**: land folded overhead, islands that float, the sea where the sky should be
- **Matter**: a forest that dissolves into the points it is made of, then reforms as a city
- **Time**: dusk to dawn in two minutes, seasons changing halfway across a field
- **Logic**: the same station passing three times, each time slightly wrong

The first version ships two or three fixed surreal levels, not free dials. Each level is one setting of all five dials, tuned by eye as a whole, and a channel's profile picks its level.

## Rendering approaches compared

Gaussian splats are the right primary medium, used two ways at once, with a shader sky and a few meshes around them. No single technique covers both "photoreal" and "endless".

| Approach | Realism | Surreal and reactive | Endless | Cost in the browser | Role here |
| --- | --- | --- | --- | --- | --- |
| Splat kit: captured or generated pieces that are free to use, placed by code | High; inherits the source | Good; any piece can warp or dissolve on the GPU | Arrangement is endless, the set of pieces is finite | Assets streamed per biome, 10–23 MB per million splats compressed | Near and mid bands, wherever a good free piece exists |
| Splats written by code from noise fields | Painterly, not photographic | Best; every parameter is ours | Fully | No download; worker time per chunk | Every gap the kit leaves, plus ground, water, far band, all "matter" effects |
| Raymarched shader world | High for sky, haze, water, distant terrain; poor for trees and buildings | Best | Fully | No download; heavy per pixel at high resolution | Sky and atmosphere |
| Mesh scene with instanced props | Reads as a game without a lot of art | Moderate | Fully | Cheapest and most predictable | Rails, carriage, window frame |
| Diffusion model running in the browser | High per frame | High | Frames do not hold parallax | GB-scale download, seconds per frame (estimate, not checked) | Not in v1 |
| Worlds generated offline by a world model, shipped as splats | High, and surreal on request | Same as the kit | Bounded scenes, not strips | About $1.26 per world at build time (World Labs standard model); static files at run time | A source of kit pieces only if a free route exists; the paid API is out |

### Can splats be procedurally generated?

Yes, at two levels, and the two give different looks.

A splat is only a primitive: a position, three scales, a rotation, a colour and an opacity. Nothing requires it to come from a capture. What makes a splat scene photographic is where those numbers came from.

- **Procedural arrangement.** Pieces whose splats came from photos or from a generative model keep their realism when code places, scales and tints them. This is how the view gets its photoreal half.
- **Procedural matter.** Splats emitted by our own functions (scatter them on a noise terrain, colour them from a palette) look painterly, soft-edged and slightly unstable. That look is the surreal half, and it costs no download.

Spark, the three.js splat renderer from World Labs, supports both, and both are confirmed by a running test:

- **Building splats in code.** `new SplatMesh({ constructSplats })` hands the callback a buffer, and `pushSplat(center, scales, quaternion, opacity, color)` fills it.
- **Rewriting splats on the GPU.** `objectModifier` and `worldModifier` take a "dyno" graph that runs per splat, per frame. Spark 2.0 lets several be chained.
- **Composite worlds.** Spark 2.0 treats many splat objects as one scene, sorts them together and lets them be added and removed at any time. That matches the chunk design below.

### Why splats suit this camera in particular

The three things that must stay real are nearly free on Gaussians.

- **Motion blur.** For a camera that only translates, blur is the scene smeared along the track by speed times shutter time, at every depth. On screen that smear is horizontal and its length in pixels is focal length × speed × shutter ÷ depth. Widening each splat by that much gives correct, depth-dependent blur with no post-process. When distraction brakes the train, the blur shrinks and the world sharpens to a stop.
- **Haze.** Mix each splat's colour toward the sky colour by its distance.
- **Dissolve.** A splat scene can come apart into its points and reassemble as something else. No other medium does that natively, and it is the obvious thing for music to drive.

How the blur is actually done differs from the first draft, which proposed a dyno modifier:

- **It is one line in the vertex shader.** Spark computes each splat's footprint on screen as a 2D covariance. Adding (blur length)² ÷ 12 to its horizontal term stretches the splat by exactly the smear. Spark accepts a replacement shader through its `vertexShader` and `extraUniforms` options.
- **A dyno modifier cannot do it.** Modifiers edit a splat's scales and rotation, and a stretch along the track is not expressible that way for a rotated splat. Spark has covariance modifiers that could, but they are marked experimental.
- **The default shader is not exported.** The test read it from `spark.material.vertexShader` and patched it. That ties the patch to a Spark version, so pin the version and keep the patched shader in the repo.
- **Thin layers fade when blurred.** The shader lowers a splat's opacity as it spreads. In the test scene at 300 km/h the sparse near ground went almost transparent. The trackside band needs enough density, or a floor on opacity; spike 1 tunes this.

### On "inside out"

I read this as a scene built to be seen from within rather than orbited. The side window is the extreme case: every object is seen from one side, across a narrow range of angles. That lets us go further than inside-out capture and use one-sided pieces, such as an image plus a depth map turned into a sheet of splats. Confirmed as the intended meaning on 21 November.

## Recommended architecture

A slow-moving director decides what the journey is; a worker builds the world one chunk of track at a time; the renderer draws it as layered splats behind a pane of glass.

![Architecture: three inputs feed a director, which drives a chunk generator and the renderer](procedural-train-window-architecture.png)

Read top to bottom: the director is the only thing the inputs touch, and it talks to the renderer every frame but to the generator only when a new chunk is due.

The decisions that shape everything else:

- **Splats are the common currency.** Kit pieces, code-made terrain and generated set pieces all arrive as splats, so one set of GPU modifiers gives them the same haze, blur and warps.
- **Chunks are a pure function of seed, index and director state.** No world state is stored. The music sets the seed, so there is no share link in the first version; determinism is kept for resuming and debugging, and leaves sharing open later.
- **Scene changes happen out of sight.** A tunnel, a cutting, a passing freight train or a bank of fog covers each swap of biome or asset set. These are the natural cuts of a train journey.
- **Speed is the one fast coupling.** The world advances by speed times frame time, and the blur stretch uses the same number. Distraction lowers speed; nothing else needs to know.
- **The camera stays at the origin.** The world scrolls past it and chunks are rebased, which avoids float precision trouble on a journey with no end.
- **It slots in where the video was.** `TrainWindow.vue` took over the video player's place in the page, and the renderer is imported after the Start click.

The window frame is part of the picture. The view is framed by a visible carriage window, drawn as a mesh in front of the glass. It sets the composition, so it is there from spike 1.

Two Spark details bear on these decisions:

- **Workers can hand over finished buffers.** `PackedSplats` accepts a prebuilt `packedArray`, so the chunk worker can build the buffer and transfer it. This option is in Spark's types but was not exercised in the test.
- **The far band may need higher precision.** Spark stores splat positions as 16-bit floats relative to the camera, which its docs put at 0.1% precision. At 3 km that is steps of about 3 m, roughly a pixel, so far splats could shimmer as they slide. `accumExtSplats: true` switches to 32-bit positions; check the far band in spike 1 before paying for it.

## Music reactivity

Reaching the audio was the expected obstacle, and it is not one. SomaFM's stream servers send the CORS header the browser needs, so the page can analyse the music directly. Analysis models that fit the job run in the browser at acceptable size and speed.

### Reaching the audio

Web Audio outputs silence for a media element whose source is cross-origin and was not fetched with CORS. The fix is `crossorigin="anonymous"` on the `<audio>` element, provided the server answers with `Access-Control-Allow-Origin`. SomaFM's does.

What was tested, in headless Chromium against the live streams:

| Setup | HTTP status | Samples read by `AnalyserNode` |
| --- | --- | --- |
| `<audio>` as the app has it today | 200 | Silence (peak 0) |
| `<audio crossorigin="anonymous">`, AAC 128 kbps | 200 | Real audio (peak 0.78) |
| Same, MP3 128 and 256 kbps, a second channel | 200 | Real audio |
| Same, with `Sec-GPC: 1` as Brave sends | 200 | Real audio |
| Same, without the `no-referrer` meta tag, from `localhost` | 403 | Playback fails |

The repo's two notes on the 403 both misread it. `CROSSORIGIN_FIX.md` blames the `crossorigin` attribute and `BRAVE_GPC_ISSUE.md` blames `Sec-GPC`; neither header changes the response. The servers reject a `Referer` of `localhost` or `github.io`, and the `no-referrer` meta tag in `index.html` is what fixed playback.

What this leaves open:

- **Safari and iOS.** WebKit bug 180696, open since 2017, has live streams playing while the analyser reads zeros. It is confirmed for HLS and only reported for Icecast, so it needs a real device.
- **Firefox.** Not tested; no known problem.
- **A failure mode to handle.** With `crossorigin` set, a response that lacks the header fails outright instead of playing silently. If SomaFM ever drops the header, the player must retry without the attribute and fall back to metadata.
- **Courtesy.** No permission is needed, but a short note to SomaFM saying what the app does costs nothing.

| Route to a signal | What it gives | Cost and risk | Verdict |
| --- | --- | --- | --- |
| Read the stream directly with CORS | Full samples | One attribute plus a fallback path; Safari unproven | Use this |
| Channel and track metadata, which we already fetch | Genre, description, artist, title, track-change events | None. No beat, no energy. | Keep as the slow clock and the fallback |
| Our own relay that adds the CORS header | Full samples | New infrastructure; about 58 MB per listener-hour at 128 kbps; hides listeners from SomaFM's own counts | Not needed |
| Tab-audio capture | Full samples | Desktop Chrome and Edge only; a prompt every session that cannot be remembered; must request video as well | Not needed |

### What runs in the browser

| Tier | Refresh | Tools | Output |
| --- | --- | --- | --- |
| Signal | Every frame | `AnalyserNode` or an AudioWorklet | Loudness, brightness, onsets, energy per band |
| Rhythm | Every few seconds | Our own onset tracker in an AudioWorklet; `realtime-bpm-analyzer` (Apache-2.0) for tempo | Tempo and beat phase |
| Mood and style | Every 10–30 s, in a worker | CLAP audio encoder through transformers.js (both Apache-2.0) | How closely the music matches any text we write |

Essentia.js is dropped from the plan. Its last release was in June 2021, and its beat trackers take a whole signal, not a stream. It is also AGPL-3.0, which would require the whole app to be offered under AGPL. The non-commercial licence on its models (CC BY-NC-SA 4.0) is not the obstacle, since this project is not commercial.

CLAP is the mood model. It places audio and text in the same space, so the last ten seconds of music can be scored against our own biome descriptions ("salt flat at dusk", "neon city in rain") and the best match steers the director. No hand-built genre table.

- **Size.** The quantized audio encoder is 34 MB, plus 5.6 MB for the ONNX runtime. Load it after playback starts and cache it.
- **Speed.** A 10 s clip takes 0.4–0.6 s to embed in single-threaded WebAssembly with no GPU, so a refresh every 10–30 s in a worker is cheap.
- **The text encoder stays out of the browser.** It is 127 MB quantized. Embed the biome descriptions at build time and ship the vectors as JSON.
- **Not yet checked.** Whether the quantized model's matches are good enough is a listening test, part of spike 4.

For rhythm, `realtime-bpm-analyzer` gives tempo from a live stream; whether it also gives beat positions was not confirmed, so plan on our own onset tracker for phase.

### Three clocks

| Clock | Signal | What it drives |
| --- | --- | --- |
| Beat, under a second | Onsets, beat phase | Trackside rhythm: mast spacing, lamp flicker, a slight breath in splat scale |
| Phrase, 5–30 s | Energy, brightness | Density of the near band, weather, haze, the surreal dials |
| Track, minutes | Mood and style, track change | Biome, palette, time of day; a track change queues a tunnel |

The mapping to build first is masts on the beat: spacing = speed × seconds per bar. At 100 km/h and 120 BPM that is 56 m. Network Rail's masts normally stand 50–60 m apart, so the effect is felt without looking staged.

This is a focus tool, and the distraction mechanic already punishes fidgeting. Reactivity should be felt more than watched: no strobing, and the slow clocks carry most of the change.

### Metadata as the fallback

Where the analyser reads silence, the view still follows the music at track scale:

- Each channel gets a base profile (biomes, palette, surreal level), matched from its description at build time and shipped as JSON.
- A track change from the existing 45 s poll queues a scene transition.
- A hash of artist and title seeds the variation, so the same track always brings the same scenery.

## Performance and compatibility budget

Build on WebGL2 and treat WebGPU as a later option. Spark 2.4.0 draws through three.js's `WebGLRenderer` and targets WebGL2, which runs everywhere the current app does.

WebGPU coverage is still uneven:

| Browser | WebGPU on by default |
| --- | --- |
| Chrome and Edge, desktop | Windows, macOS, ChromeOS; on Linux only recent Intel and NVIDIA |
| Chrome, Android | Android 12 and later on most GPUs |
| Safari | Version 26 only (macOS, iOS, iPadOS, visionOS) |
| Firefox | Windows and Apple Silicon Macs; not Intel Macs, Linux or Android |

| Budget | Target | Basis |
| --- | --- | --- |
| Frame rate | 60 fps desktop, 30 fps phones | A smooth slide matters more than detail; the eye tracks the parallax |
| Splats in view | 1.5 million desktop, 750 thousand phones | My starting point. Spark's own defaults are 2.5 million desktop, 1.5 million iOS and 1 million Android, but our splats are all regenerated every frame, which Spark says becomes a bottleneck near 1 million on some systems. Spike 1 measures it. |
| Chunk build time | Under 50 ms in the worker | A 200 m chunk is needed every 7 s at 100 km/h. The test built 150,000 splats in 68 ms on the main thread. |
| First view | Under 5 s on broadband | Open on a code-made biome that needs no assets; stream kit pieces behind it. Spark adds 1.0 MB gzipped. |
| Assets per biome | 30 MB or less | About 2 million splats of kit pieces. Compressed files measured here run from 10 to 23 MB per million splats. Keeps several biomes inside GitHub Pages. |
| Render resolution | Scale down to hold frame rate | Blur and haze hide a lower internal resolution well |

Phones are best effort. The view is built and tuned on desktop, where the mouse-driven distraction mechanic already lives; on phones it lowers resolution and splat count, and music reactivity on iPhone is not promised.

What needs watching:

- **Sorting.** Splats are blended back to front, and Spark sorts on a worker a frame or more behind the picture. A camera that only slides sideways never changes any splat's depth along the view axis, so with `sortRadial: false` the order changes only when chunks arrive or leave. Spark's default, sorting by radial distance, would reorder constantly. The first draft had this backwards.
- **Per-frame regeneration and overdraw.** These, not sorting, are what Spark's docs name as the limits: about a million modified splats per frame on some systems, and many splats piled into a small area of screen.
- **Hosting.** GitHub Pages allows a 1 GB site and a soft 100 GB of traffic a month, which is about 3,300 full downloads of a 30 MB biome. Files over 100 MB are blocked and Git LFS does not work with Pages. That is enough to start; a growing audience moves the kit to object storage with a CDN.
- **WebGPU extras.** three.js r186 added a `GaussianSplat` addon and World Labs published `@sparkjsdev/radix` 0.0.1 in October 2026. Both need three.js's `WebGPURenderer`, so neither can share a canvas with mainline Spark. Neither should be on the critical path.
- **Fallback.** If the canvas cannot start, say so in a short notice and keep the radio playing, so no listener is left with an unexplained black screen. (The video was the fallback until it was removed.)
- **Motion sensitivity.** Honour `prefers-reduced-motion` with a slower train and no beat-driven effects.

## Free splat sources

Surveyed on 21 November 2026. Ready-made outdoor splats that are free, downloadable and clearly licensed are scarce, so the kit will mostly be made, not found. Three routes are worth using, in this order.

| Route | What it gives | What it needs | Status |
| --- | --- | --- | --- |
| Photo plus depth map, turned into a sheet of splats | Photoreal one-sided pieces: tree lines, hillsides, villages | Nothing: CC0 photos, an Apache-licensed depth model, CPU only | Built: `soma-rail-app/scripts/photo-to-splats.mjs` makes a piece in about 20 seconds; six are shipped and two are switched on |
| SuperSplat gallery ([superspl.at](https://superspl.at)) | About 3,100 downloadable community scenes, many of them outdoor captures | Your free PlayCanvas account; downloads return 401 without one | Not fetched; candidates listed below |
| Free object generators on Hugging Face | Single props (a tree, a barn) as splats | A few minutes of free GPU quota a day; a free account raises it | Not run |

### What can be downloaded today without an account

| File | Licence | Size | Verdict |
| --- | --- | --- | --- |
| [Big Sur cliff](https://huggingface.co/datasets/Jamesbass/bigsur-360-colmap), aerial coast | CC BY 4.0, set by the person who flew it | 133 MB `.sog`, 10 million splats | Usable once cut down; too big to ship whole |
| [Ludlow, Quality Square](https://superspl.at/scene/ca36efcc), a small town square | CC BY 4.0 on its SuperSplat page (author ijenko) | 255 MB `.ply`, 4.6 million splats | Usable once cut down |
| [Tokyo Takanawadai intersection](https://huggingface.co/datasets/dynamic-maps/hard-intersection-multimodal-sample), street level | CC BY 4.0 | 1.2 GB `.rad`, 56 million splats | Licence is clean; only practical as a small crop |
| [Padilla object set](https://marcelpadilla.com/Gaussian_Splat_Object_Dataset/): tree, mountain, house | CC BY 4.0 or CC BY-NC 4.0 per object | 3 MB at 100,000 splats | Loads in Spark, but each is one flat colour: silhouettes only |
| A handful of personal Hugging Face uploads (meadow, rural river, drone town) | A bare `mit` or `cc-by-nc-4.0` tag from the uploader | 18–55 MB | Weak: nothing shows who captured them |

I re-read the licence statements for the first, second and fourth rows and loaded the Padilla tree in Spark. The Big Sur and Ludlow files were too large to render on this machine.

### What the files look like from the window

Four files were small enough to load in Spark and view from the side, as the train would see them. The Spark samples carry no licence, so they were looked at and not kept.

| File | From the side |
| --- | --- |
| Padilla tree, 100,000 splats | A clean, solid shape in one flat colour. Usable as a silhouette if recoloured. |
| Spark sample "snow-street", 1 million splats | A lit street between two buildings, with its own sky baked in and ragged edges. Reads as a diorama. |
| Spark sample "valley", 500,000 splats | A bubble: the scene is painted on the inside of a sphere of splats. Unusable from outside. |
| Hugging Face "meadow", 1.2 million splats | Long streaks and floaters across the frame. Needs cleaning and orienting before it is anything. |

Two lessons for the kit. Scenes made to be stood inside, which is what world generators produce, do not work as pieces seen from outside without cutting away their sky and edges. And raw captures need a cleaning pass before they are usable. Both favour pieces made for this camera: photo sheets and code-made scenery.

### SuperSplat candidates, once you log in

Each scene's uploader picks a Creative Commons licence when enabling downloads; most choose CC BY. Check the licence link on each page, credit the author, and skip game rips and AI-generated worlds.

| Scene | Size |
| --- | --- |
| [Windmill, Zaanse Schans](https://superspl.at/scene/40fa433f) | 16.5 MB, 1.0 million splats |
| [Cell tower](https://superspl.at/scene/225aa5a2) | 12.4 MB |
| [Audley tree](https://superspl.at/scene/af9c6b0d) | 19.0 MB |
| [St Giles church](https://superspl.at/scene/4fa2f72e) | 15.9 MB |
| [2 Bridges](https://superspl.at/scene/3ba03cdc) | 19.4 MB |
| [Hunstanton coastguard station](https://superspl.at/scene/873fe015) | 18.8 MB |
| [Narva-Jõesuu lighthouse](https://superspl.at/scene/30995503) | 5.3 MB |
| [Jacaranda tree](https://superspl.at/scene/c171ba17) | 16.7 MB |

Sizes come from the site's listing; I confirmed the CC BY licence link on the windmill page only. PlayCanvas's terms forbid automated access, so these are for you to download by hand.

### Free generation

| Tool | Makes | Licence | How to run it free |
| --- | --- | --- | --- |
| Depth Anything V2 Small | Depth for the photo route | Apache-2.0 | On CPU, in Node or the browser |
| [TripoSplat](https://huggingface.co/spaces/VAST-AI/TripoSplat) | One object from one image, as `.ply` or `.splat` | MIT | Its Hugging Face Space |
| [TRELLIS](https://github.com/microsoft/TRELLIS) | One object from text or an image | MIT | A community Space; 16 GB GPU to run locally |
| [FlashWorld](https://github.com/imlixinyang/FlashWorld) | A whole scene from text or an image, as `.spz` | Code Apache-2.0, weights CC BY-NC-SA | Its demo Space |
| [Brush](https://github.com/ArthurBrussee/brush) | A splat trained from your own photos | Apache-2.0 | Any recent GPU, or a browser |

Hugging Face gives 2 minutes of GPU a day without an account and 5 with a free one, so each of these is a few objects a day at most. None was run here.

### Ruled out

| Source | Why |
| --- | --- |
| World Labs Marble, free plan | "The Free plan can generate worlds but not export them", and free output is for personal use only |
| Polycam, Postshot, KIRI Engine free tiers | No splat export without paying |
| Scaniverse | Other people's scans cannot be downloaded; your own captures can be exported free |
| The classic research scenes (garden, bicycle, stump, treehill) | No licence on the photos or the trained models |
| DL3DV-10K, Waymo, KITTI-360 and similar | Research use only, or no redistribution |
| Tencent HunyuanWorld models | Their licence excludes the UK and EU |
| Apple SHARP (one photo to splats) | Works on CPU, but the weights are licensed for research only |
| Tanks and Temples scenes | The licence page says CC BY 4.0 and, in another paragraph, no redistribution |
| Spark's own sample files | No licence stated; fine to hot-link while developing, not to ship |

## Prototype plan

The first risk is aesthetic, not technical: nobody knows yet whether a code-arranged splat world looks good sliding past a window. Spike 1 answers that before anything else is built.

1. **The look.** *Built, for six biomes; needs judging on a real GPU.* One biome in three.js and Spark: code-made ground, five to ten free splat pieces scattered along it, a shader sky, a plain window frame, the motion-stretch and haze, speed bound to the distraction score. Build it at two surreal levels. Start from `docs/checks/spark-smoke`, which already has the scroll, haze and blur working.
   - Pass: a 20-second recording that someone takes for footage at first glance.
   - Also yields the real splat budget on a laptop and a phone, and settles the far-band precision and near-field opacity questions.
2. **Audio on the other engines.** *The attribute and the fallback are built; the other browsers are untested.* Then run `docs/checks/somafm-audio` by hand in Safari on a Mac, Safari on an iPhone and Firefox. An hour of work, done alongside spike 1.
3. **Endless without seams.** *Chunks, biomes and tunnels are built, on the main thread; the 30-minute run is not done.* The chunk generator in a worker, deterministic by seed, with two biomes and a tunnel between them.
   - Pass: memory stays flat and no visible pop over a 30-minute run.
4. **Reactivity.** *Analysis, channel profiles, track-change tunnels, a beat pulse and a treble sparkle are built; CLAP is not.* Masts on the beat from our own onset tracker, then CLAP scoring against biome descriptions, with channel profiles and track-change transitions as the fallback.
   - Pass: someone listening can tell the scenery belongs to the music without being told how.
5. **Asset pipeline.** *The photo route is built: six pieces made, two in use; nothing from SuperSplat or the generators yet.* Build the kit from the routes in "Free splat sources": photo-plus-depth sheets first, then SuperSplat downloads and generated props. Record each piece's licence and attribution. Where nothing is good enough, make the piece in code. Compress them and judge them from the window. Settles what the kit weighs. Nothing is bought.
6. **The glass.** *Frame, grain, a faint reflection and a vignette are built.* The finished frame, reflections, droplets, exposure and grain. Last because the technique is well known, though it is the largest single gain in polish.

It shipped behind a `?view=generated` flag at first, with the video as the default. On 21 November 2026 the generated view became the only view and the flag was dropped.

## Decisions and open questions

Decided on 21 November 2026:

| Question | Decision | What it changes |
| --- | --- | --- |
| What "inside out" meant | A scene built to be seen from within | One-sided pieces are fair game |
| Default surreal level | Two or three distinct levels in the first pass | Tune whole presets, not five free dials |
| Carriage | Window frame visible | A frame mesh from spike 1; the view is no longer full-bleed |
| Phones | Best effort | Desktop sets the budgets; iPhone audio is not on the critical path |
| Assets | Anything free to use, with code-made pieces to fill gaps; nothing is bought | Paid generation is out. Non-commercial licences are acceptable, since the project is not commercial; each piece's licence is still recorded. |
| Hosting | Stay static on GitHub Pages for now | Revisit only if traffic nears 100 GB a month |
| Seed or music | Music leads; no shared journeys | No seed in the URL in the first version |
| Distraction in the generated view | The train slows to a stop; no fade to black | The stopping train, sharpening as its blur shrinks, is the whole visual penalty. Audio still quietens |
| Video or generated view | The generated view only; the YouTube player is removed | No flag and no video fallback. A browser without WebGL2 gets a notice and the radio |
| Compute when nothing changes | Idle when the train is stopped or the tab is hidden | A stopped view is redrawn twice a second; scenery is only generated while moving |

Answered earlier by the checks:

- [x] Does SomaFM send CORS headers on its streams? Yes, on every server and format tested. No relay and no request to SomaFM is needed.
- [x] Is a backend needed for audio? No.
- [x] Should a copy of this doc live in the repo under `docs/`? Yes: this file.

Still open:

- [ ] Does audio analysis work in Safari, on iOS and in Firefox? Spike 2.
- [x] Which free splat sources exist? Surveyed; see "Free splat sources". A free World Labs account cannot export splats, so that route is closed.
- [ ] Are found or photo-made pieces good enough from a train window? The few files that could be rendered here are judged in "Free splat sources"; the real test is on a GPU.
- [x] What are the surreal levels called? "Plausible" and "dreamlike". The channel picks one; `level=` in the URL overrides it.
- [ ] Should the listener be able to switch level from the page, and where does the control go?

## Sources

Opened and read on 19 November 2026, unless marked.

- Spark docs: [procedural splats](https://sparkjs.dev/docs/procedural-splats/), [dyno overview](https://sparkjs.dev/docs/dyno-overview/), [new in 2.0](https://sparkjs.dev/docs/new-features-2.0/), [SparkRenderer](https://sparkjs.dev/docs/spark-renderer/), [performance](https://sparkjs.dev/docs/performance/), [level of detail](https://sparkjs.dev/docs/lod-getting-started/)
- npm: [`@sparkjsdev/spark` 2.4.0](https://www.npmjs.com/package/@sparkjsdev/spark), [`@sparkjsdev/radix` 0.0.1](https://www.npmjs.com/package/@sparkjsdev/radix), [`realtime-bpm-analyzer`](https://www.npmjs.com/package/realtime-bpm-analyzer)
- [three.js releases](https://github.com/mrdoob/three.js/releases), r186 and r187
- WebGPU: [web.dev announcement](https://web.dev/blog/webgpu-supported-major-browsers), [gpuweb implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
- [CLAP for transformers.js](https://huggingface.co/Xenova/clap-htsat-unfused), file sizes from the model repository
- Essentia: [Essentia.js](https://mtg.github.io/essentia.js/), [licensing](https://essentia.upf.edu/licensing_information.html), [models](https://essentia.upf.edu/models.html)
- World Labs: [API FAQ](https://docs.worldlabs.ai/api/faq), [pricing](https://docs.worldlabs.ai/api/pricing), [terms of service](https://docs.worldlabs.ai/terms-of-service)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- Web Audio and CORS: [Web Audio API spec](https://webaudio.github.io/web-audio-api/), [WebKit bug 180696](https://bugs.webkit.org/show_bug.cgi?id=180696)
- [Screen Capture spec](https://w3c.github.io/mediacapture-screen-share/), for tab-audio capture
- [YouTube IFrame API reference](https://developers.google.com/youtube/iframe_api_reference), for playback rates
- [A Guide to Overhead Electrification](https://alanbaxter.co.uk/s/Scotlands-Railway-Guide-to-Overhead-Line-Equipment-November-2021.pdf), Network Rail and Alan Baxter, for mast spacing
- SomaFM stream headers: measured directly, see `docs/checks/somafm-audio`
