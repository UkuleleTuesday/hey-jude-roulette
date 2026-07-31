# Hey Jude Mashup Roulette

A live-performance tool for a mashup jam. Keep the **"Hey Jude"** outro looping —
that endless "na na na na" coda — and spin the wheel to see which song gets
mashed in over the top next. Whatever the wheel lands on, the band plays it into
the coda, then spin again for the next one. Hidden in the mix are four **Loser**
(Beck) wedges: land on one and that's the closer — Beck gets the last word and
the set ends. Every spin, Loser included, flashes its title on screen like any
other song, so the room knows what's coming.

The run always ends on Loser. Each song you land on gets added to the wheel as a
burnt-out (gold) wedge and then flips to a Loser as you load the next spin —
you watch the wheel turn against you while you hold — so the odds
of landing the finale creep up the longer the jam goes — the set winds itself
toward Beck. The length of your longest coda is saved locally between sessions.

## Play

Live site: **https://ukuleletuesday.github.io/hey-jude-roulette/**

Or just open `index.html` in any modern browser — the whole thing is one
self-contained file with no build step and no dependencies.

## How to run a set

1. Start the **"Hey Jude"** coda looping — the "na na na na hey Jude" outro.
2. Spin, either way you like:
   - Press and **hold** the gold hub in the middle. The ring around it fills as
     the spin loads and the wheel winds back like a slingshot; let go and it
     fires. The longer you hold, the more revolutions and the faster it goes —
     a quick tap still spins, just weakly.
   - Or grab the wheel itself and **flick** it. It follows your finger, and the
     speed you let go at sets the spin, same as the length of a hold. Let go
     without a flick and the wheel just stays where you put it — nothing is
     landed, so a stray touch mid-set is harmless. It won't turn backwards:
     drag against it and it gives a little, then blocks.

   Either way, the gesture only changes how the spin *feels*. It never changes
   the odds.
3. Whatever it lands on is the next song to mash into the coda — its title
   pops up on screen and drops into the setlist on the right.
4. Play it in over the outro, then spin again for the next one. Each landed
   song raises the share of Loser wedges.
5. When the wheel hits **Loser / Beck**, that's the finale — Beck closes the
   set. (Sweep every other song in first and you get a full coda with no Beck.)
6. To start a fresh set, wait out the countdown and just **spin again** — the
   same hold or flick clears the board and starts the next run. There's no
   separate play-again button; the hub only ever means one thing.

## Customizing the wheel

Press the **gear icon** in the top-right to open Settings, where you can change:

- **Initial losers** — how many Beck / "Loser" wedges the wheel starts with.
- **Songs on the wheel** — one per line as `Title - Artist` (artist optional).
- **Lock restart after the set ends** — on by default. Protects against an
  immediate re-roll: once Beck closes the set, the hub locks out for a
  short countdown, and after that the next spin starts a fresh set. Turn it off
  to allow spinning again straight away.

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

No framework or bundler is required — GitHub Pages serves the static
`index.html` as-is.

## Tests

The spin gestures are covered by browser tests that drive the real page in
Chromium. They run on every pull request, and locally with:

```sh
npm install
npx playwright install chromium
npm test
```

`npm test` serves the repo on an ephemeral port and runs each suite against it —
`tests/hub.test.mjs` for the hold gesture and `tests/wheel.test.mjs` for the
flick. Pass a name to run just one: `npm test wheel`.

These are the only dependencies in the repo, and they are test-only: `index.html`
itself still ships with nothing.

## Tech notes

- Single `index.html`: HTML, CSS, and vanilla JS, no external requests.
- The wheel is drawn as SVG and animated with a CSS `transform` transition
  written from JS: the duration and the number of revolutions both scale with
  the strength of the gesture, so a tap and a full charge are visibly different
  spins. Hold length and flick speed feed the same curve, so both gestures
  produce the same family of spins.
- The rim is milled with grip notches, which is the whole hint that the wheel
  can be grabbed — a wheel you can turn looks like one. On a first visit it also
  nudges itself once, and never again after that.
- Respects `prefers-reduced-motion` (no wind-up, no nudge, and one short
  single-turn spin).
- Best score persists via `localStorage` (and the Claude Artifacts
  `window.storage` API when running inside that environment).
