# Checks behind the design doc

Three small scripts that back the claims in [`../procedural-train-window.md`](../procedural-train-window.md). Each drives headless Chromium through Playwright (`npm i playwright` if it is not already installed) and prints its result.

| Folder | What it shows | Run |
| --- | --- | --- |
| `somafm-audio` | Whether Web Audio reads real samples from a SomaFM stream, with and without `crossorigin` | `node run.cjs plain '[["https://ice6.somafm.com/groovesalad-128-aac",false],["https://ice6.somafm.com/groovesalad-128-aac",true]]'` |
| `spark-smoke` | Code-made splats, a scroll-and-haze dyno modifier and motion blur on Spark | `npm i && node shot.cjs "n=150000" "0,100,300"` |
| `clap-speed` | Download size and time per 10 s clip for the CLAP audio encoder | `npm i && node run.cjs "dtype=q8"` |

Notes:

- `somafm-audio`: the pairs are `[stream URL, use crossorigin]`. Pass `gpc` instead of `plain` to send `Sec-GPC: 1`. To test another browser by hand, serve `page.html` and call `run(url, true)` in its console.
- `spark-smoke`: writes one screenshot per speed in km/h. In headless Chromium it runs on a software renderer, so the frame rate it prints means nothing; open `index.html` from a static server in a real browser for that.
- `clap-speed`: downloads about 40 MB on first run.
