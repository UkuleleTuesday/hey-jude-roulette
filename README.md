# Hey Jude Mashup Roulette

A single-page browser game. Spin the wheel to pile song after song into the
"Hey Jude" coda mashup — but four **Loser** (Beck) wedges are hidden in the mix.
Land on one and Beck gets the last word, ending your run. Sweep every song into
the coda without hitting Beck and you win a full coda.

Every song you land on is added to the wheel as a burnt-out (gold) wedge and
then flips to a Loser on your next spin, so the odds of hitting Beck creep up
the longer you go. Your longest coda is saved locally between sessions.

## Play

Live site: **https://ukuleletuesday.github.io/hey-jude-roulette/**

Or just open `index.html` in any modern browser — the whole game is one
self-contained file with no build step and no dependencies.

## How to play

1. Press **Spin** (the gold hub in the middle of the wheel).
2. Wherever it lands goes into the coda setlist on the right.
3. Keep spinning. Each landed song raises the share of Loser wedges.
4. The run ends when you hit **Loser / Beck** — or when every song is in.
5. After a run, wait out the lock and **hold** the button to play again.

## Publishing on GitHub Pages

This repo is set up to serve straight from the root of the default branch:

1. Push `index.html` to the branch you want to publish (e.g. `main`).
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*.
4. Choose the branch and the `/ (root)` folder, then **Save**.
5. After a minute or two the site is live at
   `https://<user>.github.io/hey-jude-roulette/`.

No framework, bundler, or CI is required — GitHub Pages serves the static
`index.html` as-is.

## Tech notes

- Single `index.html`: HTML, CSS, and vanilla JS, no external requests.
- The wheel is drawn as SVG and animated with a CSS `transform` transition.
- Respects `prefers-reduced-motion` (shorter, simpler spin).
- Best score persists via `localStorage` (and the Claude Artifacts
  `window.storage` API when running inside that environment).
