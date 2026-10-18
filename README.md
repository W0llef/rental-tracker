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
- Switching browsers or computers starts with an empty app. Move data with a backup file (below).
- Clearing "site data" for the page erases your units. Keep backups.

### Backing up and restoring

Open **Settings** (the gear in the top bar), then **Backup and restore**.

- **Back up data** downloads one file, e.g. `rental-tracker-backup-2026-10-17.json`, with all your
  buildings, units, listings, notes and settings, including deleted ones (so undo keeps working).
  It leaves out the undo history, caches and API keys. Keep it somewhere safe, like a cloud drive.
  Preview builds name their files `rental-tracker-preview-backup-…` so the two can't be mixed up.
- A **reminder** appears under the top bar when there's never been a backup, or the last one is
  older than 7 days (change it under _Remind me to back up_). **Later** hides it for a day.
- **Restore from file…** checks the file first and shows what it holds next to what's in the
  browser now. **Replace with this backup** swaps everything in one step and clears the undo
  history. Nothing changes if the file can't be read or the restore fails part-way. Files from
  older versions of the app are updated as they're restored; files from a newer version are
  refused with a message.
- **Safety copies**: before every restore the app keeps a copy of what was there (the last 3),
  and before any update that changes how data is stored it keeps another (the last 3). Each can
  be downloaded or restored. They live in the browser, so they aren't a substitute for backups.
- **Storage** shows the space used and whether the browser has promised to keep the data
  ("persistent storage"). The app asks for it after your first change; Chrome decides quietly,
  Firefox asks you.
- **To move to another computer or browser**: back up, open the live link there, then
  Settings → Restore from file.
- If an update ever changes how data is stored, the app stops before updating and offers
  **Download backup** first. That file is what lets you go back to the previous version.
  Version 0.6 is the first such update (people and per-person ratings): your ratings and flags
  become yours, and the undo history starts fresh (the safety copy keeps everything).
- A backup remembers whose copy made it, so restoring your own backup on a new computer makes
  you "you" again.

### People and ratings

- Each person keeps their own **rating, flag (pick or reject), reasons and notes** on a unit.
  Facts, status, listings and the shared color label belong to everyone.
- The app asks once for your name. Change it, or add the people you're looking with, in
  **Settings → People**.
- Cards and pins show **your** rating and flag; other people's appear small at the end of a card
  ("A ★3 ✓"). A unit's **Ratings** section lists everyone side by side: click stars to rate
  (click the same star again to clear) and pick a flag, for yourself or, until household sharing
  arrives, for someone else.
- Preview builds' sample data comes with a roommate, Alex, who has rated most units.

### Adding units

Press **Add unit** in the top bar (or `N`). Everything is optional except where the unit is.

- **Listing link**: paste the link from Zillow, Apartments.com, HotPads, a building's own site…
  The app recognizes the site, and where the link spells out an address or a building's name
  (Zillow and Apartments.com links usually do) it fills the address in for you. Nothing is
  downloaded from the site.
- **Address**: start typing a street address or a building's name. Your own buildings come
  first ("In your list"), then suggestions from OpenStreetMap (Photon). Pick one with the arrow
  keys and `⏎`, or the mouse. If you don't pick one, the app looks the address up once when you
  add the unit (Nominatim). If it can't find it, or you're offline, the unit is still saved and
  marked **Needs location**.
- **Unit**, **Floor plan**, **Rent**, **Beds** (0 for a studio), **Baths**. Tick _Floor plan only_
  for a plan with no unit number yet, and _Price is "from"_ for the low end of a range.
- **Paste listing text**: on the listing page, select all (`⌘A` / `Ctrl+A`), copy, and paste it
  in the box. The app recognizes about 30 kinds of detail (rent, beds, baths, size, available
  date, deposit and fees, lease terms, laundry, A/C and heat, parking, storage, which utilities
  are included, pet policy, amenities, year built and more). Rent, beds, baths, unit and address
  go into their boxes (highlighted); the rest show as chips. Click a chip to leave it out. The
  pasted text is kept with the unit's history.
- **Same unit twice?** If the link is already saved, or the building already has that unit
  number, a banner says so: **Add this listing to it** (the default, `⏎`) adds the link and
  today's price to the unit you have; **Add as a separate unit** adds a new one anyway.
- **Add unit** (`⏎`) closes the dialog; **Add and open** shows the new unit; **Add another
  here** (`⇧⏎`) keeps the building and listing site so you can add the next unit straight away.
- A building's panel has **Add unit here**.

Later, a unit's **Listings and price** section has **Paste text** for more listing text:
details the unit doesn't have yet start ticked; ones that would change what you have start
unticked and show your value.

**Place on map.** A unit marked _Needs location_ has **Place on map** in its panel (the map's
note offers it too). Click the spot on the map, or pan the map's center onto it and choose
**Place at the center**. `Esc` cancels.

**Deleting.** At the end of a unit's or building's panel, **Delete unit…** or **Delete
building…** asks once, then deletes (a building takes its units with it). The confirmation that
follows has **Undo**. Editing details by hand (a building's name, amenities and so on) arrives
with the full forms in M8.

Each add, paste, placement or delete is one step in the undo history: see **Undo and History**
below.

### Triage: flags, stars, labels and status

- Open a unit and use the markers row under its title: **Pick**, **Reject…**, **No flag**, your
  stars, **your label** (private: only you see it and its names), the **shared label** (the
  household's) and the **status**.
- Keys, on the open unit: `P` pick, `X` reject (asks why: tick saved reasons, type a new one,
  add a note; `⏎` rejects), `U` no flag, `0`–`5` stars, `6`–`9` your red, yellow, green or blue
  label, `⇧6`–`⇧9` the shared one (press again to take it off). Purple is in the menus. `?`
  shows every key.
- **Several units at once:** `⌘`/`Ctrl`-click cards to add or remove them, `Shift`-click to
  select a range. A bar above the list shows how many and has the same markers; the keys act on
  all of them. **Edit together…** sets flags, stars, labels, status, utilities, laundry,
  dishwasher, AC, heating, parking, storage, lease terms and the available date for all of them
  ("Mixed" where they differ). `Esc` clears the selection.
- In a unit's **Ratings** section, **Add notes** / **Edit notes** keeps a flag note and a rating
  note per person; **Reasons** changes reject reasons.
- **Notes** (units and buildings): add a note, tour note or call note; edit or delete your own.
- Name your labels and manage reject reasons in **Settings → Labels and reasons**. Cards show the
  shared label as a square and yours as a ringed dot; the map's **Pins** panel colors pins by
  **Shared label** or **Your label**.

### Undo and History

- Every change shows a message at the bottom left saying exactly what happened ("Rent $1,650 →
  $1,600 on Unit 908 at Riverlight") with **Undo**; after an undo it offers **Redo**.
- `⌘Z` / `Ctrl+Z` undoes, `⇧⌘Z` / `Ctrl+Shift+Z` redoes (not while you're typing in a field).
- **History** (the clock in the top bar, or **Open history** at the end of a unit's panel) lists
  every change for 90 days, newest first. **Undo this** reverses one change on its own, even an
  old one; if something it touched was changed again later, it shows what would be overwritten
  and lets you undo just the rest. **Restore to here** puts everything back the way it was right
  after that change. Both are new steps you can undo too.
- **History → Deleted** lists deleted units and buildings with **Restore**.

### Browsing your units

- The list shows every unit with its rent, size, status and markers. **Units / Buildings** switches
  to one card per building.
- **Search** (top bar, or press `/`) matches unit numbers, floor plans, building names, addresses,
  neighborhoods and notes.
- **Sort** by rent, available date, size, bedrooms, your rating, listing age and more; the arrow flips
  the direction. Units with an unknown value always sort last. The app remembers your sort.
- Click a card to open its details; **Back**, `Esc` or the × closes them. On a phone the details
  open in the **Unit** tab.
- Keys: `↓`/`J` and `↑`/`K` move through the list, `B` switches Units / Buildings, `⏎` jumps to
  the open unit's details, `?` lists every key.

### The map

- Each building with units in the list gets a pin; the map follows your search and the
  **Units / Buildings** switch. Pins show rent until total cost arrives (M9).
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
  can turn that off). Point at a card to fade the others; with photo pins, point at a thumbnail (or a
  single unit's photo pin) for a bigger picture. **Pin size** in the Pins panel makes pins and cards smaller or larger.
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
- Address suggestions come from Photon and Nominatim (both run on OpenStreetMap data, free, no
  key). Answers are remembered in the browser for 30 days, so adding a second unit at the same
  address needs no network.

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
Browser tests answer the map servers' and geocoders' requests themselves
(`tests/e2e/fixtures.ts`), so they run offline, never load real tiles and never ask Photon or
Nominatim anything. Pasted-text examples live in `tests/fixtures/listing-text/` (made-up pages in
the shape of real sites).

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
  first (it stops and offers one before updating). See `PLAN.md` §13.

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
