# Hey Jude Mashup Roulette

A live-performance tool for a mashup jam. Keep the **"Hey Jude"** outro looping —
that endless "na na na na" coda — and spin the wheel to see which song gets
mashed in over the top next. Whatever the wheel lands on, the band plays it into
the coda, then spin again for the next one. Hidden in the mix are four **Loser**
(Beck) wedges: land on one and that's the closer — Beck gets the last word and
the set ends. Every spin, Loser included, flashes its title on screen like any
other song, so the room knows what's coming.

The run always ends on Loser. Each song you land on gets added to the wheel as a
burnt-out (gold) wedge and then flips to a Loser on your next spin, so the odds
of landing the finale creep up the longer the jam goes — the set winds itself
toward Beck. The length of your longest coda is saved locally between sessions.

## Play

Live site: **https://ukuleletuesday.github.io/hey-jude-roulette/**

Or just open `index.html` in any modern browser — the whole thing is one
self-contained file with no build step and no dependencies.

## How to run a set

1. Start the **"Hey Jude"** coda looping — the "na na na na hey Jude" outro.
2. Press **Spin** (the gold hub in the middle of the wheel).
3. Whatever it lands on is the next song to mash into the coda — its title
   pops up on screen and drops into the setlist on the right.
4. Play it in over the outro, then spin again for the next one. Each landed
   song raises the share of Loser wedges.
5. When the wheel hits **Loser / Beck**, that's the finale — Beck closes the
   set. (Sweep every other song in first and you get a full coda with no Beck.)
6. To start a fresh set, wait out the lock and **hold** the hub — the same
   middle button turns into the play-again control once the set is over.

## Customizing the wheel

Press the **gear icon** in the top-right to open Settings, where you can change:

- **Initial losers** — how many Beck / "Loser" wedges the wheel starts with.
- **Songs on the wheel** — one per line as `Title - Artist` (artist optional).
- **Lock restart after the set ends** — on by default. Protects against an
  immediate re-roll: once Beck closes the set, the hub stays locked
  through a short countdown before you can hold it. Turn it off to allow
  restarting straight away.

Applying starts a fresh set, and your choices are saved in the browser
(`localStorage`) so they stick between sessions.

Repo-wide defaults live in **`config.json`** next to `index.html`:

```json
{
  "losers": 4,
  "lockRestart": true,
  "songs": [
    { "title": "Hey Jude", "artist": "The Beatles" }
  ]
}
```

Edit that file to change the defaults everyone gets. It's fetched at load time
when the page is served over HTTP (GitHub Pages, a local server, etc.). If the
file can't be fetched — for example when opening `index.html` straight off disk
via `file://` — the app falls back to the defaults baked into the page, so it
always works.

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
