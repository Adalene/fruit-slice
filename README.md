# Juice Rush

A fruit-slicing arcade game. Swipe across flying fruit to slice it, chain combos for bonus points, and dodge the bombs.

**Play:** open [index.html](index.html) locally, or deploy the repo as a static site (GitHub Pages, Netlify, Vercel, etc.).

## How to play

- Swipe with mouse or finger across fruit to slice
- Chain multiple slices in one swipe for combo points
- Don’t let 3 fruits hit the ground
- Bombs end the game instantly

## Run locally

```bash
npm start
```

Opens a static server at [http://localhost:3000](http://localhost:3000).

Or open `index.html` directly in a browser.

## Project structure

```
├── index.html      # page markup
├── css/styles.css  # styles
├── js/game.js      # game logic & audio
└── package.json
```

No build step — pure HTML, CSS, and JavaScript. Sounds are synthesized with the Web Audio API (no audio files).