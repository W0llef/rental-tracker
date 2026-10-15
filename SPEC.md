# Rental Unit Tracker — Product Spec

Draft v1 · Oct 15, 2026 · Joey C.

## 1. Overview

A personal, map-first web app for finding, researching and comparing rental units, where the unit (not the complex) is the thing you track. It runs entirely in the browser, stores data on the user's own device, and needs no server to maintain.

**Problem it solves.** Listing sites like Apartments.com show one pin per complex, advertise the cheapest unit's price next to the nicest unit's photos, and give no way to keep private notes, ratings or a consistent comparison across sources.

**Core principles**

- **Units are first-class.** Every pin the user cares about is a specific unit (or floor plan), shown with its building as context.
- **The user's list, not an ad feed.** Nothing appears unless the user adds it or explicitly asks to browse an area.
- **Consistent, structured data.** Every unit has the same fields, so units can be filtered, sorted and compared side by side, and filled in by hand or by an AI research tool.
- **Location is measured, not described.** Travel times, transit, bike and skyway access are calculated against the user's own destinations.
- **Private and local.** Data stays in the browser; sharing happens by exporting a file.

**Primary user.** One renter (or a household) searching in a single metro area for a lease starting next year. Scope: the Minneapolis–St. Paul metro only, used by the owner and a few friends. Laptop first; phones for viewing.

## 2. Key decisions and reality checks

The biggest gap in the original idea: a no-server app cannot pull rental listings automatically. Several features depend on that, so they are redefined below.

| Original idea | Problem | Decision for this spec |
| --- | --- | --- |
| Set filters, then browse all available units in an area | Zillow, Apartments.com and similar sites have no public listing API, forbid scraping in their terms, and browsers block cross-site requests (CORS) from a static page | Units enter the app by user action: quick-add from a listing URL, manual form, or AI-researched JSON import. Filters apply to the user's own collection. |
| Show all buildings in an area, not just mine | Same listing-data problem | Browse **buildings** (not listings) from OpenStreetMap data: residential buildings with name, address, height or levels, and website where tagged. User opens the building's site to find units. |
| Automatically detect new units and notify | A closed browser tab cannot check anything; scraping is blocked as above | Tiered approach in section 8: manual "check" links per building, a "New / unreviewed" status, and an optional add-on (browser extension or small serverless function) for true background alerts. |
| Travel times by walk, bike, drive and transit | Routing needs a routing engine; transit routing especially is hard to run in a browser | Free keys only: OpenRouteService for walk, bike and drive; Google Routes API for transit only, kept inside its free monthly allowance by caching and a hard daily quota (section 11). |
| Runs on the user's computer, no servers | Mostly achievable | Static site (e.g. GitHub Pages) plus browser storage (IndexedDB). Third-party map tiles and routing APIs are still called over the internet. |
| Neighborhood reputation | Subjective; no single objective source | Objective data only: a crime overlay from Minneapolis and St. Paul open data. No subjective neighborhood ratings. |

**Consequence for the workflow.** The app is a research and decision tool layered on top of listing sites, not a replacement for them. That is a feature: it never shows ads or bait pricing because it only holds what the user saved.

**Device caveat.** Browser storage is per device and per browser. Data entered on a laptop will not appear on a phone unless exported and imported (or a sync add-on is built later).

## 3. Core concepts and data model

Five record types. A **Building** holds many **Units**; each Unit has one or more **Listings** over time; **Destinations** are places the user travels to; **Collections** group units.

- **Building** — one physical structure (a complex with several structures = several Buildings sharing a `complexName`).
- **Unit** — a specific rentable home. If only the floor plan is known ("2BR Plan B, units vary"), it is a Unit with `isFloorPlanOnly = true` until a unit number is known. Houses and townhomes are a Unit whose Building has one unit.
- **Listing** — where and when the unit was advertised: source URL, price seen, date seen. Keeps a price history and supports duplicates from several sites.
- **Destination** — a named point (work, campus, gym, partner's place) with a weight and preferred travel modes.
- **Collection** — a user-named group ("Downtown shortlist", "Tour Saturday"). A unit can be in many.

### Building fields

| Group | Fields |
| --- | --- |
| Identity | name, complexName, address, lat/lng, website, management company, phone, email |
| Structure | year built, year renovated, floors (stories), total units, building type (high-rise, mid-rise, walk-up, house, townhome row), elevator |
| Amenities (checklist + notes) | fitness, pool, study/conference rooms, outdoor patio/roof deck, package room, bike storage, EV charging, guest suites, pet area, doorman/front desk, **skyway connected** |
| Policies | pets (cats/dogs/limits/fees), smoking, guest parking, sublet policy |
| Neighborhood | neighborhood name (filled automatically from location), reported incidents within a set radius over the last 12 months (from crime data) |
| Media | photos, links |

### Unit fields

| Group | Fields |
| --- | --- |
| Identity | building, unit number, floor plan name, isFloorPlanOnly |
| Specs | type (apartment, condo, townhome, house, room), bedrooms, bathrooms (allow 1.5), square feet, floor number, exposure (main direction the unit faces), windows (list per window or window wall: room, direction N/NE/E/SE/S/SW/W/NW, size e.g. standard or floor-to-ceiling, obstruction e.g. building across the street), view notes, layout notes |
| In-unit features | laundry (in-unit, in-building, none), dishwasher, AC type, heating type, balcony, fireplace, flooring, furnished (no, partial, full) |
| Lease | rent (monthly), available date, lease term options, deposit, application fee, admin fee, move-in specials |
| Included vs. tenant-paid | per item: heat, electric, water/sewer, trash, gas, internet, parking, storage — each marked included, extra $ (amount), or tenant-paid (estimated $) |
| Parking & storage | spaces included, extra space cost, type (garage, surface, street), storage unit included/cost |
| Status & review | status, star rating, flag, color label, notes, date added, date last reviewed, source |
| Map | 3D placement (facade side, floor height), optional |
| Media | photos, floor plan image, listing links |

**Derived fields** (calculated, not entered): estimated total monthly cost (rent + fees + tenant-paid estimates + parking), cost per square foot, travel time to each destination by mode, skyway access (from building), age of listing.

**Unknown is a value.** Every field supports "unknown" so incomplete units still sort and filter sensibly (unknowns shown last, and filterable as "needs research").

## 4. Workflow

One map screen with two modes, not two separate programs: **Explore** (wide net, quick decisions) and **Shortlist** (deep research on fewer units). The same map, overlays and travel-time tools work in both; the mode only changes which units are shown and how much detail the side panel asks for.

1. **Setup (first launch, editable later)**
   - Search area: draw a polygon, a circle (center + radius), or pick neighborhoods.
   - Baseline criteria: max rent (or max total monthly cost), min bedrooms and bathrooms, unit types, move-in window, pets, must-haves (e.g. in-unit laundry).
   - Destinations: add one or more, with travel modes and an acceptable max time.
2. **Explore**
   - Add units: paste a listing URL, quick-add form (address, unit, rent, beds, baths, link), or import JSON.
   - Optionally turn on the **Buildings layer** to see all residential buildings in the search area and open their websites.
   - Triage each unit: pick, reject (with a reason), or leave unflagged. Units failing baseline criteria are dimmed, not deleted.
   - Overlays and travel-time isochrones ("everything within 20 min by transit of work") help narrow the area early.
3. **Shortlist**
   - Show only picked units (or one Collection).
   - Fill in the full field set, by hand or via AI import. The panel highlights missing fields.
   - Optionally place the unit on the 3D view.
   - Compare side by side (table view) and rank.
4. **Decide and share**
   - Track tours and applications through status.
   - Export or share the list with a roommate or partner.

New units found later enter at step 2 with status **New** and stay visually marked until reviewed.

## 5. Map and layers

The main screen is a Google Maps–style layout: map on the right (full screen on mobile), a scrollable list of unit cards on the left, and a detail panel that opens when a pin or card is selected.

### Pins: units vs. buildings

- **Unit view (default).** One pin per unit. Units in the same building are clustered into a single pin with a count badge; clicking it fans out the units. Each unit card shows its building name.
- **Building view.** One pin per building, showing how many of the user's units are in it and the price range.
- **Buildings layer (optional).** All residential buildings in the search area from OpenStreetMap, in a muted style, so they don't compete with the user's own pins.
- Pin color = status or color label (user's choice); pin icon = unit type; a small badge marks **New**.
- A building pin with no units yet shows building info; once the user adds a unit there, the unit's pin and info take over (this replaces the "show building until a floor plan is chosen" behavior in the original notes).

### Detail panel

Photo carousel, key specs, total monthly cost, travel times to every destination, amenities, notes and rating, plus links: listing source(s), building website, address (opens in Google Maps), and Street View.

### Overlays (toggle on or off)

| Overlay | Shows | Likely source |
| --- | --- | --- |
| Skyway | Skyway routes and connected buildings | OpenStreetMap; city or downtown council maps, imported as GeoJSON if OSM is incomplete |
| Transit | Stops and routes, colored by line; optionally frequency | Agency GTFS feed (Metro Transit for the Twin Cities) |
| Bike | Off-street trails and protected lanes (painted lanes optional, off by default) | OpenStreetMap; city bikeway data |
| Neighborhoods | Boundaries and names | City open data |
| Crime (optional) | Incident density heat map | Minneapolis crime data (public ArcGIS service, refreshed daily) and St. Paul open data; suburbs vary and may be missing |
| Search area | The user's drawn region | User |

### Travel times

- Pick a destination; every unit card shows times for walk, bike, drive and transit, and the list can sort by any of them.
- Selecting a unit draws the route to the destination on the map, so the user sees the transit line or bike path actually used.
- **Isochrones**: shade the area reachable from a destination within N minutes by walk, bike or drive (OpenRouteService). True transit isochrones need a routing engine that can't run free in a browser, so transit uses an approximation: areas within a set walk of stops on frequent routes. This is the most useful tool in Explore mode.
- Transit time depends on departure time; the user sets a typical departure (e.g. weekday 8:00 am) per destination.

### 3D view

- Toggle between 2D and 3D (tilted map with extruded or photorealistic buildings).
- A placed unit appears as a highlighted marker on the correct side of its building at its floor's height, with a short line showing which way it faces.
- Placement: choose the building footprint, click the facade side, set the floor number; height is floor × an editable floor height (default 3 m, \~10 ft).
- Optional "view from unit" camera: positions the camera at the unit's height looking out along its exposure.
- Optional sun-position slider (time of day and date) that lights the 3D scene and shows which windows get direct sun. Without 3D, the app still estimates direct-sun hours per unit from its window directions and floor, for winter and summer solstice, as a sortable field.
- 3D placement is never required.

## 6. Organization: ratings, flags, status

Modeled on Lightroom Classic: three independent markers plus a pipeline status, each with an optional note.

| Marker | Values | Purpose | Keyboard |
| --- | --- | --- | --- |
| Flag | Pick, Reject, Unflagged | Fast triage in Explore | P, X, U |
| Stars | 0–5 | How much the user likes it | 0–5 |
| Color label | Red, Yellow, Green, Blue, Purple (user-named) | Free meaning, e.g. "Blue = roommate likes" | 6–9 |
| Status | New, Reviewing, Shortlisted, Tour scheduled, Toured, Applied, Approved, Declined, Off market | Where it is in the process | — |

- **Reasons.** Rejecting prompts for a reason from a reusable list (too far, too expensive, no laundry, bad reviews…) plus free text. Reasons are filterable, so "show everything I rejected only for price" works.
- **Notes.** Every star rating and flag can carry a note; each unit also has a timestamped notes log (e.g. tour impressions).
- **Collections.** User-named groups; a unit can be in several.
- **Filters and sort.** Filter on any field, marker or derived value; save filters as smart collections ("3+ stars, under $1,800 total, <25 min transit"). Sort by any field, including travel time.
- **Compare view.** A table with units as columns and fields as rows, differences highlighted, for 2–6 units.
- **Optional weighted score.** The user assigns weights (price, commute, space, amenities) and the app computes a score to rank units. Shown alongside, never replacing, the user's own stars.

## 7. Data entry and AI import

All entry paths produce the same records, so a unit can be started by hand and finished by AI, or the reverse.

- **Quick-add**: address (autocomplete + geocode), unit number, rent, beds, baths, listing URL. Under 30 seconds.
- **Full form**: grouped by the sections in 3, with "unknown" as a valid answer and a completeness meter.
- **Paste listing text**: the user pastes the text of a listing page; the app pre-fills what it can recognize (rent, beds, sq ft) for the user to confirm. No scraping involved.
- **AI import**: the app shows a **"Copy research prompt"** button for a unit. It copies a prompt containing the unit's known details plus the JSON schema and instructions ("fill only what you can verify, cite a source URL per field, use null for unknown"). The user pastes it into any AI assistant, then pastes the JSON reply back. The app validates it and shows a **diff** of proposed changes to accept or reject field by field, so AI output never silently overwrites the user's data.
- **Photos**: full-size originals kept in a local photo folder, small previews inside the app; see Photo archive below.

The schema is versioned (`schemaVersion`) and published with the app. Abbreviated example:

```json
{
  "schemaVersion": 1,
  "building": {
    "name": "Example Tower",
    "address": "123 Example Ave, Minneapolis, MN 55402",
    "yearBuilt": 2016,
    "floors": 24,
    "amenities": { "fitness": true, "pool": false, "skywayConnected": true },
    "website": "https://example.com"
  },
  "unit": {
    "unitNumber": "1504",
    "type": "apartment",
    "bedrooms": 1,
    "bathrooms": 1,
    "squareFeet": 720,
    "floor": 15,
    "exposure": ["S", "W"],
    "laundry": "in-unit",
    "furnished": "no",
    "rent": 1650,
    "availableDate": "2027-06-01",
    "utilities": { "heat": "included", "electric": { "tenantPaid": true, "estimate": 45 } },
    "parking": { "included": 0, "extraCost": 150, "type": "garage" }
  },
  "sources": [{ "field": "unit.rent", "url": "https://example.com/listing", "seen": "2026-10-15" }]
}
```

### Photo archive

Full-size photos are kept permanently, on the user's own computer, so units stay reviewable after the listing disappears.

- **Where originals live.** In a folder the user picks once (e.g. Documents/Rental Tracker), written by the app through the browser's File System Access API. Supported in Chrome and Edge; on Safari and Firefox the fallback is originals in browser storage plus a reminder to export a .zip backup.
- **Folder layout.** Readable without the app: `Building name/Unit 1504/2026-10-15_01.jpg`, plus a small JSON file per unit with its details. If the folder sits inside Dropbox, OneDrive or iCloud Drive, the archive is backed up and visible on other devices for free.
- **Inside the app.** Only small thumbnails are stored in the browser for fast lists and map cards. Opening a photo loads the original for full zoom and pan.
- **Getting full-size images.** Listing sites usually block other web pages from downloading their photos, so the reliable routes are the browser extension's "Save listing" (grabs the largest version the site serves) or saving images manually and dropping them in. The largest version a site serves may still be compressed.
- **Space.** Roughly 0.5–3 MB per photo, so 100 units × 25 photos is about 1–7 GB. Settings shows the archive size and can limit originals to starred or shortlisted units.
- **Market history.** Units marked Off market or Leased keep their photos, listings and price history. A Market history view charts recorded rent and rent per sq ft over time by building and by neighborhood. It reflects only prices the user captured, not the full market.
- **Sharing.** Shared exports exclude photos by default, since listing photos belong to their owners; the user can include them for a roommate.

## 8. New listing monitoring

True automatic alerts need something running while the app is closed, which conflicts with "no servers". Three tiers, from zero infrastructure to small infrastructure:

| Tier | How it works | Infrastructure | Notes |
| --- | --- | --- | --- |
| A. Assisted manual (MVP) | Each building has a "check availability" link and a last-checked date. A "Due for check" view lists buildings not checked in N days. Units added afterward get status **New**. | None | Pairs well with saved-search email alerts from Zillow, Apartments.com etc. that the user already gets. |
| B. Browser extension | While the user browses a listing site, an extension offers "Add to tracker" and can re-check saved building pages when the browser is open. | None, but a separate install | Must respect each site's terms; checking a building's own website is lower risk than scraping aggregators. |
| C. Scheduled checker | A small free-tier function (e.g. Cloudflare Worker or GitHub Action) checks building pages daily and sends email or push alerts. | Minimal, user-owned | Breaks the strict "no server" goal; only per-building pages, never aggregators. |

In every tier, a newly found unit lands in an **Inbox** collection with status New and a badge on its pin until the user reviews it.

**Recommended: on-command checking via the extension (tier B).** A "Check now" button re-reads each saved building's availability page and lists units that weren't there at the last check, since the app records when each building was last checked. This works because an extension, unlike a web page, is allowed to read other sites. It is reliable for buildings' own websites (often RentCafe, Entrata or similar portals); Zillow and Apartments.com actively block automated reading and forbid it in their terms, so for those the extension only reads the page the user is already viewing. Site layouts change, so each site needs a small, maintainable reader.

## 9. Sharing and export

Without a server there is no live shared list; sharing is by file, with a merge step on import.

- **Full backup**: one file (`.json`, or `.zip` when photos are included) with everything — buildings, units, listings, ratings, notes, collections, destinations, settings.
- **Share a collection**: export selected units with an option to include or strip private notes and ratings.
- **Import with merge**: matching units (same address + unit number) show a side-by-side diff; the importer chooses per field. Ratings from another person are kept as theirs ("Alex: 4 stars") rather than overwriting.
- **Share link (small lists)**: data compressed into the URL itself for a read-only view, practical for roughly 20–50 units without photos.
- **CSV / spreadsheet export**: flat table of units for people who just want a spreadsheet.
- **Printable summary**: one page per unit for tours.

Automatic backup reminders (e.g. weekly) protect against the browser clearing storage.

## 10. Suggested additional features

Not in the original notes; each is marked with my recommended priority.

| Feature | Why | Priority |
| --- | --- | --- |
| Total monthly cost | Rent alone misleads; fees, utilities and parking can add hundreds a month. Driven by a cost profile: the user's expected monthly cost for each utility and service (optionally scaled by sq ft or bedrooms), applied wherever a unit marks that item tenant-paid. Per-unit overrides allowed; the breakdown is shown on hover. | MVP |
| Price history per unit | Shows drops and how long a unit has sat, useful for negotiating | MVP (via Listings) |
| Tour mode (mobile) | Checklist and photo capture while touring: water pressure, noise, cell signal, smells, light | v2 |
| Tour scheduling | Date, time and contact per tour; export to calendar (.ics) | v2 |
| Noise layer | Highways, rail lines, airport flight paths, bar districts | v2 |
| Grocery and essentials | Distance to nearest grocery store, pharmacy, gym | v2 |
| Winter-specific | Heated garage, skyway, distance to a skyway entrance, snow-route streets | v2 (high value in Minneapolis) |
| Landlord / management notes | Link to reviews and the user's own notes per management company | v2 |
| Application deadlines | Reminders for application and lease-signing dates | v2 |
| Duplicate detection | Same unit listed on several sites merges into one Unit with several Listings | MVP |
| Undo and change history | Protects against accidental edits and bad AI imports | MVP |

**Questioned or trimmed from the original**

- *"Most roads have dedicated bike lanes"*: true in parts of Minneapolis, not everywhere. Spec shows trails and protected lanes by default, with painted lanes as an option.
- *Photorealistic 3D everywhere*: costly (API usage) and heavy on laptops. Default to simple extruded buildings; photorealistic as an opt-in with the user's own key.
- *Fully automatic area-wide listing discovery*: dropped for the reasons in section 2.

## 11. Technical architecture and data sources

A static, installable web app (PWA): hosted free on a static host, all logic and data in the browser, external services called directly with keys the user provides. Choices below are recommendations; a developer may substitute equivalents.

| Component | Recommendation | Notes |
| --- | --- | --- |
| App framework | TypeScript + React or Svelte, built with Vite | PWA so it installs on phone and laptop and works offline for viewing |
| Hosting | GitHub Pages, Netlify or Cloudflare Pages | Free; serves files only, stores no user data |
| Local storage | IndexedDB (via Dexie.js) | Photos stored as resized blobs; request persistent storage |
| 2D map + simple 3D | MapLibre GL JS | Open source; supports pins, clustering, drawing, extruded 3D buildings, terrain |
| Map tiles | OpenFreeMap, Protomaps or MapTiler | Free or free tier; no Google key needed for basic maps |
| Photorealistic 3D (optional) | CesiumJS + Google Photorealistic 3D Tiles | Off by default. Uses the same Google key and its free monthly allowance; the free extruded buildings cover the core need |
| Drawing search areas | Terra Draw or maplibre-gl-draw | Polygon, circle, rectangle |
| Geocoding | Nominatim (light use) or MapTiler / Mapbox | Address → coordinates on add |
| Walk / bike / drive routing + isochrones | OpenRouteService (free key) | Rate-limited; cache results |
| Transit routing | Google Routes API (user key) | Transit only. Free monthly allowance is thousands of requests; \~50 units × 3 destinations is \~150 calls, cached. A hard daily quota set in Cloud Console blocks anything past the free tier |
| Buildings, skyways, bike paths | OpenStreetMap via Overpass API | Fetched once per search area and cached |
| Transit stops and routes | Agency static GTFS (Metro Transit) | Pre-processed into GeoJSON |
| Geometry helpers | Turf.js | Point-in-polygon, distances, buffers |

**API keys.** Entered in Settings, stored locally, never sent anywhere except the matching service. The app works without any keys (manual entry, map, overlays); keys unlock routing and photorealistic 3D. Settings should show estimated API usage so the user isn't surprised by a bill.

**Non-functional requirements**

- Handles 500 units and 200 buildings without lag.
- Works on current Chrome, Safari, Firefox and Edge, desktop and mobile.
- Phone is view-first: browse units, photos and the map at phone width (list and map as tabs); editing is designed for laptop.
- Every external call fails gracefully: no routing key means travel times show "add a key", not an error.

## 12. Phased roadmap

Build in phases so a useful tool exists early; each phase is shippable on its own.

1. **Phase 1 — v1: track and compare (every MVP item in section 10)**
   - Data model, quick-add and full form, local storage, backup export/import.
   - 2D map with unit pins, clustering, building grouping, detail panel, external links.
   - Flags, stars, color labels, status, notes, collections, filters, sort, compare table.
   - Cost profile and total monthly cost, price history, duplicate detection, undo, window directions, local photo archive.
2. **Phase 2 — Location intelligence**
   - Search-area drawing, destinations, travel times with caching, route display, isochrones.
   - Overlays: skyway, transit, bike, neighborhoods.
   - Buildings layer from OpenStreetMap.
3. **Phase 3 — Research helpers**
   - AI research prompt + JSON import with field-by-field diff.
   - Paste-listing-text pre-fill, "Due for check" monitoring (tier A), browser extension with Save listing and Check now (tier B), Market history view.
   - Collection sharing with merge, share links, CSV export.
4. **Phase 4 — 3D and extras**
   - 3D view with unit placement, view-from-unit camera, sun slider.
   - Tour mode, noise layer, optional scheduled checker (tier C).

**Acceptance test for the MVP:** a user can add 15 units from three sites in under 15 minutes, rate and flag them, see them clustered by building on the map, open any listing link, and export a backup that re-imports with nothing lost.

## 13. Decisions log

Owner's answers to the first draft's open questions, applied throughout the spec.

| Question | Decision |
| --- | --- |
| City | Minneapolis–St. Paul metro and its transit system only |
| Audience | Owner plus a few friends; no public launch planned |
| Servers | Everything runs on the user's device; no server, no extra hardware. Monitoring tier C is out of scope. |
| API cost | Free tiers only. Google key allowed for transit, capped by quota so it can't bill |
| Devices | Laptop primary; phone for viewing data and photos; manual export/import between devices |
| Ratings | One shared rating per unit |
| Neighborhood | Objective only: crime overlay where data exists |
| Builder | An AI coding tool; tech choices in section 11 are the default stack |
| Timeline | Search already underway; build Phase 1 first and use it immediately |

**Floor plans vs. units (decided).** A floor plan with no unit number yet is saved as a placeholder unit marked "floor plan only", pinned at its building with no floor or window data. When a unit number is known, the user fills it in and the placeholder becomes a full unit, keeping its notes, rating and history.

No open questions remain; the spec is ready to hand to an AI coding tool, starting with Phase 1.
