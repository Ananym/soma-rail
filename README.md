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

## Deploying to GitHub Pages

1. Push to GitHub
2. Go to your repo Settings → Pages
3. Under "Build and deployment", set Source to "GitHub Actions"
4. Push to the `main` branch - the site will automatically build and deploy

Your site will be live at: `https://yourusername.github.io/soma-rail/`

## Credits

- Music streaming by [Soma FM](https://somafm.com/) - please [support them](https://somafm.com/support/)
- Train video from YouTube
