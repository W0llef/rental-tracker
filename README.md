# Rental Unit Tracker

A personal, map-first tracker for rental units in Minneapolis–St. Paul. It runs entirely in your
browser: no server, no account, no paid services, no API keys. Your data stays on your device.

**Status:** under construction, one milestone at a time. See `PLAN.md` §14 for what exists so far.

| Where                                              | What it is                               |
| -------------------------------------------------- | ---------------------------------------- |
| `https://w0llef.github.io/rental-tracker/`         | The live app. This is the one you use.   |
| `https://w0llef.github.io/rental-tracker/preview/` | The milestone waiting for your approval. |

## Using the app

Open the live link in Chrome or Edge on a laptop. Your units, notes and settings are saved in that
browser for that exact web address. That means:

- Use **one address** for real data. The preview link has its own separate, throwaway database.
- Switching browsers or computers starts with an empty app. Move data with **Export backup** and
  **Restore** (arrives in milestone M5).
- Clearing "site data" for the page erases your units. Keep backups.

### Browsing your units

- The list shows every unit with its rent, size, status and markers. **Units / Buildings** switches
  to one card per building.
- **Search** (top bar, or press `/`) matches unit numbers, floor plans, building names, addresses,
  neighborhoods and notes.
- **Sort** by rent, available date, size, bedrooms, rating, listing age and more; the arrow flips
  the direction. Units with an unknown value always sort last. The app remembers your sort.
- Click a card to open its details; **Back**, `Esc` or the × closes them. On a phone the details
  open in the **Unit** tab.
- Keys: `↓`/`J` and `↑`/`K` move through the list, `B` switches Units / Buildings.

### The map

- Each building with units in the list gets a pin; the map follows your search and the
  **Units / Buildings** switch. Pins show rent until total cost arrives (M8).
- **Pins** (button on the map) sets how pins look for the view the list is showing (Units and
  Buildings keep separate settings):
  a sign plate, a dot or a photo; which details to print (rent, beds and size, unit number,
  rating, unit type icon); the New badge; the colors; and whether rejected units show, fade or
  hide. The color legend is in this panel too.
- A building with several units shows one pin with what's true of all of them: rent range, a
  count, a stripe per unit, and New if any unit is new. Click it to **open its card**: one row
  per unit with the same details, joined to the building's marker by a short line. Cards stay
  open, and you can open several; they never cover each other, other pins or dots (they move
  further out, even past the edge of the map, instead). Close one with its ✕ or by clicking its
  marker; **Collapse all** or `Esc` closes them all. The building's name on the card opens the
  building. Zoomed in to street level, buildings open by themselves where their card fits (you
  can turn that off). Point at a card to fade the others; with photo pins, point at a thumbnail
  for a bigger picture. **Pin size** in the Pins panel makes pins and cards smaller or larger.
- Zoomed out, nearby buildings merge into round **bubbles** with a unit count, and crowded pins
  shrink to **dots**; both can be turned off. Point at a card to see its pin in full, or at a pin
  to highlight its cards.
- **Layers** (or `L`) picks the base map (Wayfinding, Detailed streets, OpenStreetMap, Cycle map,
  Aerial photo) and shows its key. OpenStreetMap and Cycle map can look soft between zoom levels;
  _Sharper OpenStreetMap and Cycle maps_ fixes that at the cost of about 4× the downloads.
  **Fit** shows all your units.
- **New** on a pin means the unit's status is still New, i.e. you haven't reviewed it yet.
- Your pin and base-map choices are remembered in this browser. They aren't part of backups.
- The unit and building panels link to **Google Maps** and **Street View**.
- Map pictures come from free services (OpenFreeMap, OpenStreetMap, CyclOSM and Minnesota's MnGeo
  aerial photos). They load only while you look at the map and need an internet connection; if
  one is down, the map says so and you can pick another in Layers.

## Running it on your computer (for development)

You need [Node.js](https://nodejs.org) 22 or newer.

```sh
npm install        # once, downloads the tools
npm run dev        # starts the app at http://localhost:5173
```

Other commands:

| Command             | What it does                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `npm run build`     | Type-checks and makes the production files in `dist/`              |
| `npm run preview`   | Serves `dist/` at http://localhost:4173                            |
| `npm run lint`      | Checks code style and common mistakes                              |
| `npm run typecheck` | Checks TypeScript types                                            |
| `npm test`          | Runs unit and component tests                                      |
| `npm run e2e`       | Runs browser tests (first time: `npx playwright install chromium`) |
| `npm run format`    | Fixes formatting                                                   |

`localhost` uses a separate database from the live app, so development never touches real data.
Browser tests answer the map servers' requests themselves (`tests/e2e/fixtures.ts`), so they run
offline and never load real tiles.

### Checking the data

**Data check** (link at the bottom of the list, or `#/debug`) shows what the build has stored, the
undo history, and Undo/Redo buttons. On preview and development builds it can also load made-up
sample data and make test changes; the live app never offers that.

## How it gets published

Two GitHub Actions workflows in `.github/workflows/` do everything automatically:

- **Checks** runs on every push: lint, types, unit tests and browser tests.
- **Deploy** runs when `main` or a milestone branch (`m0-…`, `m1-…`) is pushed. It builds the app
  and copies it onto the `gh-pages` branch: `main` goes to the site root (the live app) and a
  milestone branch goes into `preview/`. Updates appear within a couple of minutes.

### One-time setup of GitHub Pages

1. In the repository on GitHub: **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **Deploy from a branch**.
3. Branch: **gh-pages**, folder: **/ (root)**, then **Save**.

The `gh-pages` branch is created by the first deploy, so do this after the first workflow run.

## Versions and going back

- Every approved milestone is tagged `v0.<N>.0` (M1 is `v0.1.0`, and so on).
- To see or restore an older version, ask in a chat: "roll the live app back to v0.3.0".
- Milestones that change how data is stored say so, and the app asks you to download a backup
  first. See `PLAN.md` §13.

## Files

| File             | What it is                                                         |
| ---------------- | ------------------------------------------------------------------ |
| `SPEC.md`        | The product spec (what the app should do)                          |
| `PLAN.md`        | How it's built: stack, data model, milestones, decisions, progress |
| `DESIGN.md`      | Look and feel: colors, type, layouts, keyboard shortcuts           |
| `CLAUDE.md`      | Working agreement read at the start of every build session         |
| `mockups/`       | Static design mockups (open `c-wayfinding.html` in a browser)      |
| `src/`, `tests/` | The app and its tests                                              |

## Privacy

The repository is public so GitHub Pages is free. It contains code and documents only. Rental data,
photos and keys are never committed: they live in your browser and, for photos, a folder you choose.
