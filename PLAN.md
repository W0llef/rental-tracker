# Rental Unit Tracker — Build Plan (Phase 1)

Status: **Draft 3** · Oct 15, 2026 · covers spec Draft v1 (`SPEC.md`)

This plan covers Phase 1 only (spec §12: "track and compare"). The data model, however, contains every field from spec §3 now, plus the few supporting fields later phases need, so Phases 2–4 add screens and services without reshaping stored data.

**Status:** approved in principle; Q11 answered (fast data entry is in Phase 1). Progress is in §14. Workflow, versions and progress: §13–§14 and `CLAUDE.md`.

**Draft 2 changes:** design direction C (Wayfinding) chosen; your answers to Q1–Q10 applied (§11); lease length for spreading one-time costs (§5.3); switchable base maps and customizable pins (§4.3); a fast data-entry and AI-import section (§5.7) with revised milestones (§9). One new scope question, Q11, is in §11.

---

## 1. Stack

The spec §11 stack is confirmed with four changes and a few additions. Everything is free, needs no account, and runs in the browser.

| Area | Choice | Change vs. spec? | Why |
| --- | --- | --- | --- |
| Language / build | TypeScript (strict) + Vite | Same | TypeScript is pinned to 6.0 for now: the linter (typescript-eslint) doesn't support 7.x yet. |
| Fonts | Overpass via `@fontsource-variable/overpass` | Addition (M0) | Self-hosts the typeface from the build, so it works offline (DESIGN.md §2.6). |
| UI framework | **React** (not Svelte) | Picks one of the two | Larger ecosystem for exactly what Phase 1 needs: accessible dialogs/menus (Radix), list virtualization, a MapLibre wrapper. AI coding tools are also most reliable in React, which matters since one is the builder. |
| Routing | React Router, **hash URLs** (`#/unit/…`) | Addition | Hash URLs work on GitHub Pages with no server rewrite rules. |
| UI-only state | Zustand | Addition | Small store for selection, filters, mode, viewport. Data itself lives in IndexedDB. |
| Accessible primitives | Radix UI (dialog, popover, menu, tabs, tooltip) | Addition | Keyboard and screen-reader behavior for free; styled by us. |
| Long lists | TanStack Virtual | Addition | Keeps 500 cards smooth. |
| Validation + types | **zod** (4.x) — every record type is a zod schema; TS types are inferred | Addition | One source of truth for: backup import validation, the AI research prompt and import format (zod exports JSON Schema), and migrations. Commands validate every record before writing it. |
| Storage | IndexedDB via Dexie 4 + `dexie-react-hooks` (`useLiveQuery`) | Same | |
| Photo originals | File System Access API folder; fallback **Origin Private File System (OPFS)**, then IndexedDB blobs | Refines spec §7 | OPFS is still "browser storage" (spec's fallback) but handles multi-GB files far better than IndexedDB blobs. |
| Map | MapLibre GL JS via `react-map-gl/maplibre` | Same | maplibre-gl 6 and react-map-gl 8 (M3). The map code loads on demand after the list (≈ 290 kB gzip), so the first download doesn't grow. MapLibre 6 needs its worker file pointed at explicitly (`setWorkerUrl`, `MapView.tsx`). |
| Map tiles (default) | **OpenFreeMap** (Positron restyled as "Wayfinding", light and dark) | Picks one | No key, no signup, no request limits. Style URL is a setting so a MapTiler key can be swapped in if OpenFreeMap is ever down. |
| Other base maps | OpenFreeMap Liberty; OpenStreetMap Standard and CyclOSM raster tiles; MnGeo aerial imagery (WMS) | Addition | All free and keyless. The raster servers are donation-funded, so the app loads only on-screen tiles, never caches them offline, and shows their attribution (see §4.3). |
| Pins | **HTML markers** (React) + `supercluster` for low-zoom groups | Addition | Pins can show photos, icons or text (your pin options). Only pins inside the visible map are mounted, which stays fast at 500 units. supercluster 9 ships its own types. |
| Geocoding | **Photon (komoot) for as-you-type suggestions**, Nominatim only as a single on-submit fallback | **Changed** | Nominatim's usage policy forbids client-side autocomplete; Photon is built for search-as-you-type and allows fair use. Both need no key. |
| Zip (backup with photos) | fflate (streaming zip/unzip) | Addition | Streams large archives instead of building them in memory. |
| Offline / install | `vite-plugin-pwa` | Same | |
| Testing | Vitest, Testing Library, fake-indexeddb, fast-check, Playwright, axe-core | Addition | See §8. |
| Styling | CSS Modules + CSS custom properties (design tokens) | Addition | Tokens map 1:1 to DESIGN.md and make light/dark trivial. No Tailwind, to keep markup readable. |

**Deferred to their phase, not installed in Phase 1:** Terra Draw, Turf.js (a 10-line haversine helper covers Phase 1's distance checks), Overpass, OpenRouteService, Google Routes, GTFS processing, CesiumJS.

**Hosting (decided, Q9).** A static build deployed to GitHub Pages under your account; `npm run dev` on `localhost` is for development only. Browser data belongs to the exact web address, so real data lives at `yourname.github.io/rental-tracker` and nowhere else.

**Where the code lives.** My workspace belongs to this one conversation. So in M0 the project goes into a GitHub repository (the same one Pages deploys from), and every milestone ends with a commit. That keeps the code safe and lets any later conversation, on any model, pick up from `PLAN.md` and the repo. You'll need to connect GitHub once when we get there.

---

## 2. Project folder structure

```
rental-tracker/
├─ README.md                 plain instructions to run, build, deploy, back up
├─ CLAUDE.md                 working agreement read at the start of every chat
├─ PLAN.md  DESIGN.md  SPEC.md
├─ .github/workflows/        build, test, deploy main → /, milestone branch → /preview/
├─ index.html
├─ package.json  tsconfig.json  vite.config.ts  playwright.config.ts
├─ public/                   icons, PWA manifest
├─ mockups/                  static design mockups (this step)
├─ src/
│  ├─ main.tsx  App.tsx  routes.tsx
│  ├─ model/                 zod schemas = the data model
│  │  ├─ common.ts           Maybe, Tri, IDs, dates, money, Direction, Address, Link
│  │  ├─ building.ts  unit.ts  settings.ts  filters.ts  backup.ts
│  │  ├─ records.ts          listing, destination, collection, note, photo, import batch
│  │  ├─ factories.ts        new records with every researched field unknown
│  │  └─ index.ts            SCHEMA_VERSION, re-exports, inferred TS types
│  ├─ db/
│  │  ├─ db.ts               Dexie instance + table declarations
│  │  ├─ versions.ts         every Dexie version() and its upgrade()
│  │  ├─ migrations/         pure per-version transforms (shared with backup import)
│  │  ├─ changeLog.ts        DBCore middleware that records before/after of every write
│  │  └─ undo.ts             undo/redo stacks derived from the change log; retention
│  ├─ commands/              the ONLY way the UI writes data (each = one undoable action)
│  │  ├─ action.ts           action(label, fn): transaction + change log (+ toast in M7); systemWrite
│  │  ├─ undo.ts             undo() and redo() commands
│  │  ├─ records.ts          M1's basic create/update/delete for buildings, units, listings,
│  │  │                      notes, settings; later milestones split commands by area:
│  │  ├─ units.ts  buildings.ts  listings.ts  markers.ts  collections.ts
│  │  ├─ notes.ts  photos.ts  merge.ts  settings.ts
│  ├─ domain/                pure functions, no I/O, heavily unit-tested
│  │  ├─ unitKey.ts          normalized unit number ("Apt 1504" → "1504")
│  │  ├─ cost.ts             total monthly cost, move-in cost, $/sq ft, breakdown
│  │  ├─ address.ts          normalization (USPS abbreviations, unit designators)
│  │  ├─ dedupe.ts           building/unit/listing duplicate matching
│  │  ├─ listingUrl.ts       site detection + best-effort address/name from URL slug
│  │  ├─ filter.ts  sort.ts  unknown values sort last; "needs research"
│  │  ├─ format.ts  listings.ts  display text; listing age and price history
│  │  ├─ completeness.ts     per-group % filled
│  │  ├─ links.ts            Google Maps, Street View, directions URLs (no key)
│  │  └─ geo.ts              haversine, bounds
│  ├─ services/
│  │  ├─ geocode/            photon.ts, nominatim.ts, cache.ts, rateLimit.ts, index.ts
│  │  ├─ photos/             archive.ts (interface), fsaStore.ts, opfsStore.ts,
│  │  │                      idbStore.ts, thumbnails.ts, sidecar.ts, paths.ts
│  │  ├─ backup/             exportJson.ts, exportZip.ts, restore.ts, reminders.ts
│  │  └─ storage.ts          persist() request, usage estimate
│  ├─ dev/                   sampleData.ts: made-up sample data (preview/dev builds only)
│  ├─ state/                 ui.ts (Zustand), useDataset.ts (live queries), derive.ts (pure joins,
│  │                         search + sort for the list)
│  ├─ hooks/                 useListKeys.ts (M2), useKeyboardShortcuts.ts (M7)
│  ├─ ui/
│  │  ├─ shell/              AppShell, TopBar, ModeSwitch, Toasts, Banners
│  │  ├─ list/               ListPanel (toolbar, sort, empty states), UnitCard, BuildingCard
│  │  ├─ map/                MapView, Pin, MapCard, PinsPanel, LayersPanel, Legend
│  │  ├─ detail/             UnitPanel, BuildingPanel, parts (sections), Compass, PriceChart
│  │  ├─ add/                QuickAddDialog, AddressField, FactChips, PasteIntoUnit, PlaceOnMap,
│  │  │                      plan.ts (helpers), useSuggestions.ts (M4)
│  │  ├─ edit/               UnitEditPage, BuildingEditPage, field components
│  │  ├─ triage/             FlagControl, Stars, ColorLabel, StatusSelect, RejectDialog
│  │  ├─ compare/            ComparePage, CompareTray
│  │  ├─ filters/            FilterPanel, FilterChips, SaveFilterDialog
│  │  ├─ photos/             PhotoStrip, Lightbox, DropZone
│  │  ├─ duplicates/         DuplicatesPage, MergeDialog
│  │  ├─ history/            HistoryPanel
│  │  ├─ settings/DataSection Settings → Data (was the M1 data check page, #/debug)
│  │  ├─ settings/           SettingsPage + one component per section
│  │  └─ common/             UnknownInput, MoneyInput, DirectionPicker, TriToggle, …
│  └─ styles/                tokens.css, base.css, map-style.json overrides
└─ tests/
   ├─ unit/                  domain + migrations (Vitest)
   ├─ db/                    commands, undo, backup round-trip (Vitest + fake-indexeddb)
   ├─ components/            forms, shortcuts (Testing Library)
   ├─ e2e/                   Playwright, incl. acceptance.spec.ts
   └─ fixtures/              backups for each schema version, geocoder responses
```

---

## 3. Data model

### 3.1 Conventions

- **Unknown is `null`** (spec §3 "Unknown is a value"). Every researched field is `T | null`. Yes/no fields are three-state (`true | false | null`).
- Lists that can be unknown are `T[] | null`: `null` = not researched, `[]` = researched, none.
- Money is whole US dollars (`number`). Lengths in feet, areas in sq ft.
- IDs are `crypto.randomUUID()` strings. Dates are `YYYY-MM-DD`; timestamps are ISO strings.
- Every stored record has `createdAt`, `updatedAt` and `deletedAt` (soft delete makes undo and merge safe; Settings has "Empty trash").
- The model is written as zod schemas; the interfaces below are what those schemas infer.

```ts
// ── model/common.ts ───────────────────────────────────────────────
export type Maybe<T> = T | null;          // null = unknown
export type Tri = boolean | null;         // yes / no / unknown
export type ID = string;
export type ISODate = string;             // '2027-06-01'
export type ISODateTime = string;         // '2026-10-15T21:12:00.000Z'
export type USD = number;                 // whole dollars

export type Direction = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

export interface Base {
  id: ID;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
  deletedAt: Maybe<ISODateTime>;
}

export interface Address {
  line1: string;                // '123 Example Ave S'
  city: Maybe<string>;
  state: Maybe<string>;         // 'MN'
  zip: Maybe<string>;
  formatted: string;            // display form
  normalized: string;           // dedupe key, e.g. '123 example ave s|minneapolis'
}

export interface GeoPoint {
  lat: number;
  lng: number;
  source: 'photon' | 'nominatim' | 'map-click' | 'import';
  precision: 'address' | 'street' | 'approximate';
}

export interface Link { id: ID; label: string; url: string; }
export interface FieldSource {            // where a value came from (shown as a small link in the detail panel)
  field: string;                          // 'unit.rent', 'building.yearBuilt'
  url: Maybe<string>;
  seen: ISODate;
  via: 'manual' | 'paste' | 'ai' | 'url';
  importId: Maybe<ID>;                    // the import batch that set it
}
```

### 3.2 Building

```ts
export type BuildingType = 'high-rise' | 'mid-rise' | 'walk-up' | 'house' | 'townhome-row';

export type AmenityKey =
  | 'fitness' | 'pool' | 'studyRooms' | 'outdoorDeck' | 'packageRoom' | 'bikeStorage'
  | 'evCharging' | 'guestSuites' | 'petArea' | 'frontDesk' | 'skywayConnected';

export interface PetPolicy {
  cats: Tri;
  dogs: Tri;
  limits: Maybe<string>;            // 'max 2 pets, dogs under 50 lb'
  deposit: Maybe<USD>;
  oneTimeFee: Maybe<USD>;
  monthlyRent: Maybe<USD>;          // feeds total monthly cost if household has pets
}

export interface Building extends Base {
  // Identity
  name: Maybe<string>;
  complexName: Maybe<string>;       // several Buildings may share one
  address: Address;
  location: Maybe<GeoPoint>;        // null → "Needs location", listed but not mapped
  website: Maybe<string>;
  managementCompany: Maybe<string>;
  phone: Maybe<string>;
  email: Maybe<string>;
  // Structure
  yearBuilt: Maybe<number>;
  yearRenovated: Maybe<number>;
  floors: Maybe<number>;
  totalUnits: Maybe<number>;
  buildingType: Maybe<BuildingType>;
  elevator: Tri;
  // Amenities
  amenities: Record<AmenityKey, Tri>;
  amenitiesNotes: Maybe<string>;
  // Policies
  pets: PetPolicy;
  smoking: Maybe<'allowed' | 'not-allowed' | 'designated-areas'>;
  guestParking: Maybe<string>;
  subletPolicy: Maybe<'allowed' | 'with-approval' | 'not-allowed'>;
  policyNotes: Maybe<string>;
  // Neighborhood
  neighborhood: Maybe<{ name: string; source: 'geocoder' | 'city-boundaries' | 'manual' }>;
  crime: Maybe<{ incidents12mo: number; radiusFt: number; asOf: ISODate; source: string }>; // Phase 2+
  // Media
  links: Link[];                    // photos live in the photos table (ownerType 'building')
  notes: Maybe<string>;
  // Monitoring (spec §8, tier A — UI in Phase 3)
  availabilityUrl: Maybe<string>;
  lastCheckedAt: Maybe<ISODateTime>;
  // Map extras (Phase 2 buildings layer / Phase 4 3D)
  osmId: Maybe<string>;
  floorHeightFt: Maybe<number>;     // default 10 ft when null
  // v3 (M8 review)
  standalone: boolean | null;       // a house or townhome on its own (Q30); null = default by type
  checkedUnknown: { field: string; at: ISODate }[];  // fields checked and found unknown (Q29)
}
```

### 3.3 Unit

```ts
export type UnitType = 'apartment' | 'condo' | 'townhome' | 'house' | 'room';

export type UnitStatus =
  | 'new' | 'reviewing' | 'shortlisted' | 'tour-scheduled' | 'toured'
  | 'applied' | 'approved' | 'leased' | 'declined' | 'off-market'; // leased = you signed it (Q2)

export type Flag = 'pick' | 'reject' | 'none';
export type LabelColor = 'red' | 'yellow' | 'green' | 'blue' | 'purple';

export interface WindowSpec {
  id: ID;
  room: Maybe<string>;              // 'Living', 'Bedroom 1'
  direction: Maybe<Direction>;
  size: Maybe<'small' | 'standard' | 'large' | 'floor-to-ceiling' | 'window-wall'>;
  obstruction: Maybe<string>;       // 'building across the street, ~60 ft'
}

export type UtilityKey = 'heat' | 'electric' | 'waterSewer' | 'trash' | 'gas' | 'internet';

export type UtilityTerm =
  | { mode: 'included' }
  | { mode: 'extra'; amount: Maybe<USD> }          // landlord bills a flat fee
  | { mode: 'tenant-paid'; estimate: Maybe<USD> }; // null estimate → cost profile

export interface RecurringFee { id: ID; label: string; amount: USD; } // amenity fee, tech fee, pet rent…

export interface Unit extends Base {
  // Identity
  buildingId: ID;
  unitNumber: Maybe<string>;
  unitKey: Maybe<string>;           // normalized unit number, indexed for dedupe
  floorPlanName: Maybe<string>;
  isFloorPlanOnly: boolean;
  // Specs
  type: Maybe<UnitType>;
  bedrooms: Maybe<number>;          // 0 = studio
  bathrooms: Maybe<number>;         // 0.5 steps
  squareFeet: Maybe<number>;
  floor: Maybe<number>;
  exposure: Maybe<Direction[]>;     // first item = main direction (Q3)
  windows: Maybe<WindowSpec[]>;
  viewNotes: Maybe<string>;
  layoutNotes: Maybe<string>;
  // In-unit features
  laundry: Maybe<'in-unit' | 'in-building' | 'none'>;
  dishwasher: Tri;
  acType: Maybe<'central' | 'mini-split' | 'wall-unit' | 'window-unit' | 'none' | 'other'>;
  heatingType: Maybe<'forced-air' | 'radiator' | 'baseboard' | 'radiant-floor' | 'heat-pump' | 'other'>;
  balcony: Tri;
  fireplace: Tri;
  flooring: Maybe<string>;
  furnished: Maybe<'no' | 'partial' | 'full'>;
  // Lease
  rent: Maybe<USD>;                 // current asking rent (mirrors latest listing observation)
  rentIsFrom: boolean;              // "from $X" (floor-plan-only pricing)
  rentByTerm: Maybe<{ months: number; rent: USD }[]>; // when rent differs by lease length
  availableDate: Maybe<ISODate>;
  leaseTermsMonths: Maybe<number[]>;
  plannedLeaseMonths: Maybe<number>; // the length you'd sign; null → cost profile default (Q5)
  deposit: Maybe<USD>;
  applicationFee: Maybe<USD>;
  adminFee: Maybe<USD>;
  recurringFees: Maybe<RecurringFee[]>;           // addition (Q5)
  moveInSpecial: Maybe<{ text: string; valueUsd: Maybe<USD> }>;
  // Included vs tenant-paid
  utilities: Record<UtilityKey, Maybe<UtilityTerm>>;
  // Parking & storage (Q4: these replace "parking/storage" in the utilities list)
  parking: {
    spacesIncluded: Maybe<number>;
    extraSpaceCost: Maybe<USD>;     // per space per month
    type: Maybe<'garage' | 'surface' | 'street' | 'none'>;
  };
  storage: { included: Tri; cost: Maybe<USD> };
  costOverrides: Partial<Record<CostItemKey, USD>>; // per-unit override of cost-profile estimates
  // Status & review (each person's rating, flag and notes: Opinion, §3.4a; v2, M6)
  status: UnitStatus;
  colorLabel: Maybe<LabelColor>;    // the shared label; each person also has a private one (Q16)
  collectionIds: ID[];              // multi-entry index ("date added" = createdAt)
  addedVia: 'quick-add' | 'form' | 'ai-import' | 'backup' | 'share';
  // Map (Phase 4)
  placement3d: Maybe<{ facadeBearingDeg: number; floor: number }>;
  // Media
  links: Link[];                    // listing links live in listings; photos in photos table
  fieldSources: FieldSource[];
  checkedUnknown: { field: string; at: ISODate }[];  // v3 (M8 review, Q29)
}
```

**Floor plan only (spec §13).** `isFloorPlanOnly = true`, `unitNumber = null`, `floor`/`windows`/`exposure` stay `null`, `rentIsFrom` usually `true`. Typing a unit number later flips the flag in the same action; notes, rating, listings and photos stay attached because they reference the unit's `id`.

### 3.4 Listing, Destination, Collection, Note, Photo

```ts
export type SiteKey = 'zillow' | 'apartments-com' | 'hotpads' | 'trulia' | 'craigslist'
  | 'facebook' | 'rent-com' | 'padmapper' | 'building-site' | 'other';

export interface PriceObservation { date: ISODate; rent: USD; note: Maybe<string>; }

export interface Listing extends Base {
  unitId: ID;
  url: Maybe<string>;
  site: SiteKey;
  firstSeen: ISODate;
  lastSeen: ISODate;
  observations: PriceObservation[];   // price history; ≥1 when a price was seen
  offMarketAt: Maybe<ISODate>;
}

export type TravelMode = 'walk' | 'bike' | 'drive' | 'transit';

export interface Destination extends Base {   // record exists now; UI in Phase 2
  name: string;
  address: Address;
  location: GeoPoint;
  weight: number;                             // 1–5
  modes: TravelMode[];
  maxMinutes: Partial<Record<TravelMode, number>>;
  departure: { days: 'weekday' | 'weekend'; time: string };  // '08:00'
}

export interface Collection extends Base {
  name: string;
  kind: 'manual' | 'smart';
  filter: Maybe<FilterSpec>;          // smart only ("saved filter")
  sort: Maybe<SortSpec>;
  order: number;
}

export interface NoteEntry extends Base {
  unitId: Maybe<ID>;
  buildingId: Maybe<ID>;
  text: string;
  kind: 'note' | 'tour' | 'call' | 'system';  // system = "Status → Toured"
  authorId: Maybe<ID>;                         // v2 (M6): who wrote it; null for the app's own notes
}

export interface Photo extends Base {
  ownerType: 'unit' | 'building';
  ownerId: ID;
  kind: 'photo' | 'floor-plan';
  fileName: string;                   // '2026-10-15_01.jpg'
  archivePath: Maybe<string>;         // relative path in the archive; null if original not kept
  store: 'fsa' | 'opfs' | 'idb' | 'none';
  mime: string;
  bytes: number;
  width: number;
  height: number;
  caption: Maybe<string>;
  sourceUrl: Maybe<string>;
  order: number;
}

export interface ImportBatch extends Base {  // one paste of AI output, listing text or a batch grid
  kind: 'ai-json' | 'listing-text' | 'batch-grid';
  raw: string;                        // exactly what you pasted, kept for re-review
  prompt: Maybe<string>;              // the research prompt it answered (AI only)
  summary: { created: number; filled: number; changed: number; skipped: number };
  actionId: Maybe<string>;            // change-log action, so the whole import undoes as one step
}
```

### 3.4a People and opinions (v2, M6)

```ts
export type PersonColor = 'teal' | 'plum' | 'rust' | 'navy' | 'olive' | 'rose';

export interface Person extends Base {
  name: string;                         // 1–40 characters, unique among live people (any case)
  color: PersonColor;                   // badge color (DESIGN §2.3a)
  labelNames: Record<LabelColor, string>;  // this person's private label names (Q16)
}

export interface Opinion extends Base { // one per unit and person; id = `${personId}:${unitId}`
  unitId: ID;
  personId: ID;
  rating: 0 | 1 | 2 | 3 | 4 | 5;
  ratingNote: Maybe<string>;
  flag: Flag;
  flagNote: Maybe<string>;
  rejectReasonIds: ID[];
  colorLabel: Maybe<LabelColor>;        // private label (the shared one is unit.colorLabel)
  lastReviewedAt: Maybe<ISODateTime>;
}
```

Which person is "me" is a fact about each browser's copy, kept in `meta.meId`, never in the shared data. A backup records who made it (`exportedBy` in the envelope) so a restore can work out who "me" is (§5.8 "As built"). The opinion id is made from the person and unit so two copies that create the same opinion (after household sync) get the same record.

### 3.5 Settings (one record) and supporting types

```ts
export type CostItemKey = UtilityKey | 'parking' | 'storage' | 'renters-insurance' | 'pet-rent';

export interface CostProfile {
  items: Record<CostItemKey, { monthly: USD; scaleBy: 'none' | 'sqft' | 'bedrooms'; basis: number }>;
  // e.g. electric: { monthly: 55, scaleBy: 'sqft', basis: 750 } → 55 × sqft/750
  parkingSpacesNeeded: number;        // Q5
  needsStorage: boolean;
  hasPets: { cats: number; dogs: number };
  amortizeOneTimeFees: boolean;       // Q5, default off
  amortizeSpecials: boolean;          // Q5, default off
  defaultLeaseMonths: number;         // Q5: months to spread over, default 12; per unit via plannedLeaseMonths
}

export type PinContent = 'total' | 'rent' | 'psf' | 'photo' | 'type' | 'beds' | 'rating' | 'unit' | 'dot'
  | 'travel';                         // 'travel' enabled in Phase 2

export interface MapPrefs {
  baseLayer: 'wayfinding' | 'streets' | 'osm' | 'cycle' | 'aerial';
  pins: {
    show: PinContent;
    extras: { typeIcon: boolean; stars: boolean; newBadge: boolean };
    colorBy: 'status' | 'label' | 'price';
    simplifyWhenCrowded: boolean;     // collapse to dots at low zoom / heavy overlap
    fadeRejected: boolean;
  };
  overlays: string[];                 // Phase 2 ids: 'skyway', 'transit', 'bike', …
}

export interface BaselineCriteria {   // non-location part of spec §4 setup (Q6)
  maxRent: Maybe<USD>;
  maxTotalMonthly: Maybe<USD>;
  minBedrooms: Maybe<number>;
  minBathrooms: Maybe<number>;
  unitTypes: UnitType[];
  moveIn: Maybe<{ from: ISODate; to: ISODate }>;
  mustHaves: FilterSpec;
}

export interface Settings {
  id: 'app';
  costProfile: CostProfile;
  baseline: BaselineCriteria;
  labelNames: Record<LabelColor, string>;   // 'Blue' → 'Roommate likes'
  rejectReasons: { id: ID; label: string; archived: boolean }[];
  map: MapPrefs;
  theme: 'system' | 'light' | 'dark';
  mapStyleUrl: string;                // override for the Wayfinding style's tile source
  essentialFields: string[];          // fields that count toward "ready to compare" (§5.7)
  photoArchive: { store: 'fsa' | 'opfs' | 'idb' | 'none'; folderName: Maybe<string>;
                  keepOriginalsFor: 'all' | 'starred' | 'shortlisted' };
  backup: { lastBackupAt: Maybe<ISODateTime>; remindEveryDays: number };
  apiKeys: { openRouteService: Maybe<string>; google: Maybe<string> };  // Phase 2; never exported
}

export interface FilterSpec {           // every clause optional; AND-ed together
  text?: string;
  status?: UnitStatus[];
  flag?: Flag[];
  minRating?: number;
  labels?: (LabelColor | 'none')[];
  collections?: ID[];
  rejectReasons?: ID[];
  ranges?: Partial<Record<'rent' | 'totalMonthly' | 'bedrooms' | 'bathrooms' | 'squareFeet'
          | 'floor' | 'pricePerSqft' | 'listingAgeDays', { min?: number; max?: number; includeUnknown: boolean }>>;
  enums?: Partial<Record<'type' | 'laundry' | 'furnished' | 'parkingType' | 'buildingType', string[]>>;
  tri?: Partial<Record<'dishwasher' | 'balcony' | 'fireplace' | 'elevator' | AmenityKey, boolean>>;
  exposureIncludes?: Direction[];
  needsResearch?: string[];             // field paths that must be unknown
  isFloorPlanOnly?: boolean;
  needsLocation?: boolean;
}
export interface SortSpec { key: string; dir: 'asc' | 'desc'; }   // unknowns always last
```

**Derived values** (computed in `domain/`, never stored): total monthly cost + breakdown, move-in cost, cost per sq ft, listing age (days since first `firstSeen`), skyway access (from building), completeness %, duplicate candidates. Travel times (Phase 2) will be cached in `travelCache`, not on the unit.

### 3.6 IndexedDB schema (Dexie)

Only indexed properties are declared; other fields are stored but don't need declaring. Adding an unindexed field later therefore needs no schema change — only a migration if existing records need a default.

```ts
db.version(1).stores({
  buildings:    'id, address.normalized, complexName, updatedAt, deletedAt',
  units:        'id, buildingId, [buildingId+unitKey], status, flag, rating, colorLabel, *collectionIds, updatedAt, deletedAt',
  listings:     'id, unitId, url, site, lastSeen, deletedAt',
  destinations: 'id, deletedAt',
  collections:  'id, kind, order, deletedAt',
  notes:        'id, unitId, buildingId, createdAt, deletedAt',
  photos:       'id, [ownerType+ownerId], kind, deletedAt',
  thumbs:       'photoId',                 // 480 px WebP blobs
  originals:    'photoId',                 // last-resort blob store (no FSA, no OPFS)
  imports:      'id, kind, createdAt',     // pasted AI / listing text / batch grid, for re-review
  settings:     'id',
  changeLog:    '++seq, actionId, at, [table+key]',
  snapshots:    '++seq, at',               // pre-migration safety copies (keeps last 3)
  handles:      'id',                      // FileSystemDirectoryHandle for the photo folder
  geocodeCache: 'key, at',
  travelCache:  'key, at',                 // Phase 2
  meta:         'key',                     // schemaVersion, installId, first-run flags
});

// v2 (M6): people and opinions; units drop the per-person indexes
db.version(2).stores({
  units:    'id, buildingId, [buildingId+unitKey], status, colorLabel, *collectionIds, updatedAt, deletedAt',
  people:   'id, deletedAt',
  opinions: 'id, &[unitId+personId], unitId, personId, deletedAt',
});
```

```ts
// v3 (M8 review): new unindexed fields only (building.standalone, building/unit.checkedUnknown)
db.version(3).stores({});
```

### 3.7 Schema changes (migrations)

There are two places old data can come from — the browser's own database and old backup files — and both go through the same code.

1. `SCHEMA_VERSION` (an integer) lives in `model/index.ts`, equals the Dexie version, and is written into every backup and photo sidecar.
2. Each version bump adds `db/migrations/vN.ts` exporting pure functions, e.g. `upgradeUnit(v1Unit) → v2Unit`. They take plain objects, so they're trivial to test.
3. `db/versions.ts` declares `db.version(N).stores(...).upgrade(tx => …)`; the upgrade first copies the whole dataset into `snapshots`, then applies `migrations/vN` to each table.
4. Backup import runs the same chain: `v1 → v2 → … → current`, then validates against the current zod schemas. A backup from a *newer* app version is refused with a clear message instead of being half-imported.
5. Old migrations are never edited. Each one ships with a fixture backup (`tests/fixtures/backup-vN.json`) and a test that it migrates to the current version and passes validation. Fixtures are frozen: never regenerate an old one. The framework itself is tested with throwaway v2–v6 versions (`tests/db/versions.test.ts`).
6. Rule for the build: from Milestone 1 on, data is never wiped to change its shape. You can start entering real units at Milestone 4 and keep them through Phase 4.
7. **Before any migration runs on real data**, the app asks you to download a backup file first (built in M5 with backup export; no migration ships before then) ("This update changes how your data is stored. Download a backup before continuing."). That file is what makes rolling back to an older version possible, because an older version can't open a database a newer one has upgraded (§13). *As built in M5:* before the database is opened, `main.tsx` reads the stored version with plain IndexedDB (`indexedDB.databases()`, or opening without a version and never creating one) and, if it's older than `SCHEMA_VERSION` and holds data, shows that screen instead of the app. *Download backup* reads the stored records as they are, so the file is in the old format and opens in the previous app version too; *Continue* (or *Continue without a backup*) opens the database, which runs the upgrade and its snapshot. Tested against a real v1 database (`tests/db/upgradeCheck.test.ts`, `tests/db/upgradeV2.test.ts`, and in the browser by `tests/e2e/people.spec.ts`, which builds a v0.5 database before the app opens it).
9. **v2 (M6, the first real change)**: `db/migrations/v2.ts`. A migration can now also transform several tables at once (`transform`, for records that move between tables), say that the undo history can't survive it (`clearsHistory`: the browser's database clears the change log after the snapshot; restores always did), and create this copy's person (`createsMe`: the browser records the new person in `meta.meId`). Backup files run the same transform with "me" being the person already using the browser (`checkBackup(file, me)`), so an old file's ratings become yours.
10. **v3 (M8 review)**: `db/migrations/v3.ts` adds `standalone: null` and `checkedUnknown: []` to buildings and `checkedUnknown: []` to units. Nothing changes meaning, so undo history survives. The zod schemas give both fields defaults, so a record from before v3 brought back by an undo still validates. An update across several versions (v1 → v3) now takes **one** safety copy, before the first step (`declareVersions`), instead of one per step. Fixture `tests/fixtures/backup-v3.json`; tested on a real v2 database (`tests/db/upgradeV3.test.ts`) and in the browser (`tests/e2e/review8.spec.ts`).
8. **Preview builds use a separate database** (`rental-tracker-preview`) and show a "Preview" banner, so testing a milestone never touches your real data even though both live at the same web address.

---

## 4. Screens, components and state flow

### 4.1 Screens (Phase 1)

| Route | Screen | Main components |
| --- | --- | --- |
| `#/` | **Main**: list + map (+ detail when selected) | TopBar (search, filters, mode switch Explore/Shortlist, Units/Buildings view, Add, Undo), UnitList / BuildingList, MapView, DetailPanel, CompareTray, banners (backup due, reconnect photo folder) |
| `#/unit/:id` | Main with detail panel open | DetailPanel: header + markers, photos, cost + breakdown, specs, lease, utilities, building + amenities, listings + price history, notes log, links, history |
| `#/building/:id` | Main with building panel | BuildingPanel: building info, its units, "Add unit here" |
| `#/add` (dialog) | **Quick-add** | AddressField (suggestions), ListingUrlField, "Paste listing text" box, unit #/plan, rent, beds, baths; duplicate match banner; "Place on map" fallback. A route so Back closes it; `#/add?building=<id>` starts in that building ("Add unit here") |
| map panel | **Map layers** | Base map picker (5), "Pins show" (9 options), extras, pin color, simplify, overlays section (Phase 2) |
| `#/building/:id/add` | **Batch add units** | Spreadsheet-style grid for many units in one building; accepts a pasted table |
| dialog | **AI research prompt** | Scope (unit, building, selection), which fields, copy button, tips |
| `#/import/:id` | **Import review** | Field-by-field diff for pasted AI JSON or listing text; accept/reject, source links, one undo step |
| `#/unit/:id/edit` | **Full unit form** | Section nav (Identity, Specs, Windows, Features, Lease, Costs, Parking & storage, Review, Photos, Listings, Sources), UnknownInput fields, completeness meter, building summary with "Edit building" |
| `#/new-unit?from=<id>` or `?building=<id>` (M8) | **New unit in the full form** | "New unit from Plan C": the same form, starting from the plan's copied details; nothing is stored until **Add unit** |
| `#/building/:id/edit` | **Building form** | Identity, Structure, Amenities, Policies, Neighborhood, Links, Photos |
| `#/compare?ids=…` | **Compare table** | 2–6 unit columns, grouped field rows, differences highlighted, "hide identical rows" |
| `#/duplicates` | **Duplicate review** | candidate pairs with reason, MergeDialog (pick value per conflicting field) |
| `#/settings/:section` | **Settings** | Cost profile, Baseline criteria, Labels & reasons, Display (theme; map and pin defaults), Photo archive, Backup & restore, Storage, Keyboard shortcuts, (API keys — shown disabled, "Phase 2") |
| overlay | Lightbox | full-size original, zoom/pan, caption, delete |
| `#/history` (panel, M7) | History | change log for one unit (`?unit=<id>`), or everything; Undo this, Restore to here, Deleted with Restore |
| dialog | Reject reason | reusable reasons (checkboxes) + free text |

Phone width: list and map become tabs; detail opens as a full-screen sheet; edit forms are usable but laid out for laptop (spec §11).

### 4.2 How state flows

```
 keyboard / clicks / drops
          │
          ▼
  commands/*  ── action("Flag: Pick", fn) ──▶ Dexie transaction ──▶ IndexedDB
          │                                       │
          │                         changeLog middleware records before/after
          ▼                                       ▼
  undo/redo stacks ◀──────────── actionId ── toast "Flagged as pick · Undo"
                                                  │
                         useLiveQuery re-runs automatically on change
                                                  ▼
  useDataset(): buildings, units, listings, notes(counts), photos(meta), settings
          │  derive (pure, memoized): cost, $/sqft, listing age, completeness, dupes
          ▼
  visible = sort(filter(units, FilterSpec + mode + baseline), SortSpec)
          │                    │                       │
      UnitList              MapView              DetailPanel / Compare
          └──── selectedId · hoverId · compareIds (Zustand ui store) ────┘
                             ⇅ mirrored to the URL hash
```

- **IndexedDB is the single source of truth** for data. Components never hold copies they edit; forms keep a local draft and commit through one command on blur/save.
- **Zustand holds UI-only state**: selection, hover, multi-selection, mode, view (units/buildings), applied filter and sort, panel open/closed, compare tray. Map viewport and list sort are remembered in `localStorage` (wrapped in try/catch).
- **One derived dataset feeds list, map and compare**, so a filter change or a new rating updates all three in the same frame. With 500 units this is a few milliseconds; no worker needed.
- **Selection ↔ URL**: selecting a pin or card sets `#/unit/:id`; the browser back button closes the panel.

### 4.3 Map behaviour (Phase 1)

**Pins**

- Pins are HTML markers drawn by React, one per **building that has visible units**. Only markers inside the visible map (plus a margin) are mounted.
- A building with one visible unit draws as that unit's pin; with several, as a grouped pin (lead = cheapest non-rejected unit, plus a count). Clicking a grouped pin **opens a card** listing its units (as built: see below; originally a fan-out on leader lines).
- At low zoom, `supercluster` merges nearby buildings into neighborhood bubbles with a count.
- **Building view** toggle: one pin per building labeled with count and price range.
- Units without a location are listed with a "Needs location" chip and a "Place on map" action.

**Pin options** (Map layers panel; saved in `Settings.map.pins`; try them in the updated mockup)

| "Pins show" | Single unit | Grouped building |
| --- | --- | --- |
| Total cost (default) | `$1,932` | `$2,174+ ②` (lowest total) |
| Rent | `$1,650` | `$1,890+ ②` |
| Cost per ft² | `$2.68/ft²` | lowest + `+` |
| Photo | 46 px thumbnail; type icon if no photo yet | lead unit's photo + count |
| Unit type | icon (apartment, condo, townhome, house, room) | icon + count |
| Beds and size | `1 bd 720 ft²` | lead unit + count |
| Rating | `★4` (unrated `☆`) | best rating + count |
| Unit number | `1504` | building name + count |
| Dot only | 16 px dot | 24 px dot with the count |
| Travel time | Phase 2 (needs destinations) | — |

- **Also on pins**: unit-type icon, star rating, New badge (each on/off).
- **Pin color**: status (default), label, or total cost (five-step blue scale from your cheapest to your priciest unit; legend shows the dollar range).
- **Shrink to dots when crowded** (on by default): below street zoom, or where pins would overlap, pins become dots; hovering one shows its full pin, and the selected unit always shows in full.
- **Fade rejected units** (on by default).

*As built in M3 (reworked after the owner's review):*

- **Pins follow the list**: search and the Units/Buildings switch drive the map too.
- **Pin options live in a Pins panel**, separate from Map layers. A pin has one *style* (sign plate, dot, or photo) and any number of *fields* printed on it (unit type icon, rent, beds and size, unit number or building name, rating), each in its own segment with a hairline between them; rent reads first. Dots carry no text, so their fields are greyed out; photos print the fields underneath. Total cost and cost per ft² (M9) and travel time (Phase 2) show disabled with their tag; until M9 pins show rent and the price color option reads *Rent*.
- **Settings are kept per view** (Units and Buildings); the Pins panel edits whichever view the list shows. They're remembered per database in the browser (`<db>.mapPrefs` in `localStorage`, like the list's sort), so they stay out of Undo and the data format is unchanged. The base map is remembered the same way. `Settings.map` stays in the model for the Settings → Display defaults of a later milestone.
- **A building with several units** (and every Buildings-view pin) shows only what's true of all its units: rent as a range or as "lowest +" (a setting), ranges for beds, size and rating, the building's name, the type icon only if the units share a type, one edge stripe per unit (a pie ring on a dot), and the New badge if any unit is new.
- **New units**: off, a dot, or a "New" tag (default). "New" means the unit's status is New: every unit starts there when added and stays until you move it on, so it means "not reviewed yet" (owner confirmed).
- **Rejected units**: Show, Fade (default) or Hide. Fade and Hide leave rejected units out of a building's ranges and stripes; Hide also takes them off the map (a selected one still shows).
- **Cards** (fourth review, replacing the second review's fans and the third review's trays): an open building shows **one card** listing its units, one row each (cheapest first, rejected last) with the same stripe, fields and New badge its pin would have; with photo pins each row has a thumbnail, and pointing at it (or focusing the row) shows a larger photo (280 × 200 px, just the photo and the unit's name) beside the card, above everything else on the map; a single unit's photo pin does the same. The header repeats the building's marker (a navy ring with a center dot, also drawn at the building's point), then its name (opens the building's details), the unit count and a close button (✕). A short line joins the marker to the card's nearest edge, and there is always at least 32 px between the marker's center and the card so the line shows. Hard rules: a card never covers another card, pin, marker, dot (or a dot's New tag) or the map's controls, legend and notes; its line never crosses another card, line or point. Search: the nearest free spot (every 15°, distance plus 30 px per radian turned from the preferred side, which leans up and away from other open buildings), first on screen within 360 px, then anywhere, off screen if need be, before a line may ever cross something. Cards you opened go down in the order you opened them and keep their spot while it stays free, so they don't jump around as you pan; opening one pans the map just enough to show it. Automatic cards (zoom 15+) open only if they fit on screen within 150 px. Pointing at a card brings it forward, enlarges its marker, thickens its line and fades the other cards to 40%. Collapsed pins that would cover another building's point become dots, so no dot hides under a plate. Sizes are measured from hidden copies of the real pins and cards.
- **Pin size** (fourth review): a slider in the Pins panel (70–130%, per view, default 100%) scales pins, dots and cards about the building's point; the layout uses the scaled sizes.
- **Hover never changes the layout**: pointing at a dot (or its card) shows a full preview above it that ignores the pointer, and a plate under the pointer gets an outline; this removed a flicker where a dot grew into a plate that moved off the pointer.
- **Opening buildings**: clicking a building opens its card and it stays open; any number can be open. The card's ✕ or a click on the building's marker closes one; *Collapse all* (or `Esc`, before closing the details) closes them. Zooming out below zoom 11 closes the cards you opened; panning never does. With *Open buildings’ cards when zoomed in, where they fit* (Units view, on by default) every building opens by itself from zoom 15 where its card fits; ones you close stay closed until you zoom out below 15. A selected unit's building opens unless you closed it.
- **Crowding**: *Group nearby buildings when zoomed out* (bubbles at zoom 10 and below) and *Shrink crowded pins to dots* (all dots below zoom 11, overlap-based above) are separate options, and both are honored at every zoom. Selected and hovered pins always show in full.
- **Hover works both ways**: pointing at a card shows its pin in full; pointing at a pin highlights its card (all of a building's cards for a grouped pin).
- **Sharpness**: raster maps draw their tiles stretched between zoom levels (MapLibre rounds to the nearest tile zoom). Aerial now asks MnGeo for 512 px images per 256 px tile, so photos stay sharp on high-density screens. OpenStreetMap and Cycle map have no high-resolution tiles; *Sharper OpenStreetMap and Cycle maps* in Layers (off by default, owner's choice) fetches the next zoom's tiles (`tileSize` 128), about 4× the downloads from their volunteer-run servers. Wayfinding and Detailed streets are vector maps and always sharp.
- **Legends**: the pin-color legend sits in the map corner on a laptop and inside the Pins panel everywhere (phones have no corner legend). The Map layers panel shows a key for the chosen base map: our own for Wayfinding, links to the publishers' keys for OpenStreetMap and CyclOSM, a note for Detailed streets and Aerial.
- **Fit all units** leaves room for cards when the fit is close enough for them to open.
- Photo pins show the unit-type icon until photos arrive (M12). "Place on map" for units without a location arrives with quick-add (M4); the map only counts them for now.

**Interactive layers (Phase 2).** The raster base maps are pictures, so there is nothing on them to click. The Phase 2 overlays (skyway, transit, bike, neighborhoods, …) are built from data by the app, so each gets its own key and can be clicked to say what a trail, stop or route is.

**Base maps** (one at a time; all keyless)

| Base map | Source | Notes |
| --- | --- | --- |
| Wayfinding (default) | OpenFreeMap vector tiles, our restyled Positron | Light and dark; quiet so pins stand out; the only one available offline (PWA caches recently viewed tiles within OpenFreeMap's limits) |
| Detailed streets | OpenFreeMap Liberty | More labels, shops, transit stations |
| OpenStreetMap | `tile.openstreetmap.org` raster | The osm.org look. Allowed for normal interactive use with attribution; no offline caching or prefetching, per the OSM tile policy |
| Cycle map | CyclOSM raster (openstreetmap.fr) | Bike lanes, trails, bike parking. Same rules as above; a useful preview before the Phase 2 bike overlay |
| Aerial photo | MnGeo Composite Image Service (WMS), 2025 Twin Cities metro imagery at 1 ft | State-run and free. **To verify in M3**: that it allows use from a web page (CORS) in the web-map projection. If it doesn't, the fallback is an aerial layer that needs a free key, added in Settings. |

Raster base maps have no dark version; in dark mode they show as-is with dark panels around them. Pins get a stronger outline on Aerial. The Transport and OpenCycleMap styles from osm.org need a (free) Thunderforest key, so they're left for Phase 2 alongside the other keys.

**Overlays** (skyway, transit, bike, neighborhoods, crime, all residential buildings, isochrones) appear in the same panel in Phase 2, as checkboxes that combine on top of any base map.

---

## 5. Phase 1 services

### 5.1 Geocoding (no keys)

1. **Suggestions while typing** — Photon (`photon.komoot.io/api`), biased to downtown Minneapolis and limited to a metro bounding box; 350 ms debounce, minimum 3 characters, in-flight requests cancelled, results cached in `geocodeCache` (30 days).
2. **On submit without picking a suggestion** — one Nominatim search (US, metro viewbox), rate-limited to 1/second, cached. Never used for as-you-type, per its policy.
3. **If both fail or you're offline** — the unit is saved anyway with `location: null`; it shows "Needs location", and "Place on map" lets you click the spot. Quick-add never blocks on the network.
4. **Neighborhood name** comes from the geocoder's district/neighbourhood field when present (`source: 'geocoder'`), editable. Phase 2 replaces it with city boundary data.
5. **Building match**: after geocoding, if an existing building has the same normalized street address or sits within ~25 m with a similar name, Quick-add proposes "Add to Riverlight?" instead of creating a new building.
6. Attribution ("© OpenStreetMap contributors", Photon) shows in the map corner.

**Listing URL field.** No page is ever fetched (spec §2). The app recognizes the site from the domain and, where the URL itself contains an address or name (Zillow `homedetails/…`, Apartments.com slugs), pre-fills the address search. It also catches exact URL duplicates.

*As built in M4:*

- `services/geocode/`: `photon.ts` and `nominatim.ts` read the answers into one `Place` shape (address, location with `source` and `precision`, building name, neighborhood); `cache.ts` keeps answers 30 days in `geocodeCache` (not your data: not undoable, not in backups); `rateLimit.ts` spaces Nominatim calls 1.1 s apart; `index.ts` makes one geocoder per app. Offline (`navigator.onLine === false`) both fail at once with a `GeocodeError`.
- Suggestions show your own buildings first ("In your list", by name or address words, offline), then Photon's. Picking one of yours adds to it; picking a Photon place checks it against your buildings (same address, or within 25 m with a similar name).
- On submit without a pick: a Photon suggestion already on screen for the same street address is used; otherwise one Nominatim lookup. **A lookup that answers with a different street address than the one typed is ignored** (Nominatim falls back to nearby or partial matches, which would put the unit at the wrong building); the unit is then saved without a location. Typed text that isn't an address (a building name) is kept as the new building's name.
- Photon attribution: the address field's note says "Suggestions come from OpenStreetMap (Photon)"; the map corner keeps its OpenStreetMap attribution.
- Listing links (`domain/listingUrl.ts`): Zillow, Apartments.com, HotPads, Trulia, Craigslist, Facebook, Rent.com and PadMapper get their own site key; other known listing sites (Zumper, Apartment List, RentCafe…) are "Other site"; any other domain is "Building website". Duplicate checks compare a canonical link (lowercase host without `www.`, no trailing slash, tracking parameters like `utm_*` removed).
- **Place on map**: a button on the plate of a unit or building without a location, and in the map's "N units need a location" note. The next click on the map sets the location (`source: 'map-click'`); pins let clicks through meanwhile. For the keyboard: pan the map (arrow keys) and choose **Place at the center** (a crosshair marks it). `Esc` cancels. On a phone it switches to the Map tab.

### 5.2 Duplicate detection (MVP)

- **Address normalization**: lowercase, strip punctuation, USPS street-suffix and directional abbreviations, move `Apt/Unit/#/Ste` into the unit part.
- **Same unit** = same building + same normalized unit number, or same listing URL. **Possible same building** = same normalized address, or within 25 m with a similar name. Floor-plan-only units are only suggested (same building + same plan name), never matched automatically.
- **On add**: a match shows a banner — "This looks like Unit 1504 at Riverlight, added Oct 2. Add this listing to it instead?" — default action adds a new Listing (and price observation) to the existing unit.
  *As built in M4* (`domain/address.ts`, `domain/dedupe.ts`, `commands/quickAdd.ts`): a link you already saved for that unit gets today's price on its existing listing (same day replaces, a new day adds a point) instead of a second listing; without a link, a typed or pasted price goes on the unit's most recent listing. The unit's rent follows the latest price. A floor-plan match shows the banner too, but ⏎ still adds a new unit. When the building only becomes known on submit (after the lookup), the banner shows first and nothing is added until you choose. Addresses typed without a city still match (cities are compared only when both are known).
- **Duplicate review** (`#/duplicates`) lists all candidate pairs. Merge keeps one unit, lets you pick the value for each conflicting field, moves listings, notes, photos, collections and keeps the higher rating; the other is soft-deleted. One undoable action.

### 5.3 Total monthly cost

`domain/cost.ts` returns a total plus a breakdown whose lines each say where the number came from (listing, your cost profile, per-unit override, or assumed):

```
total = rent
      + recurring fees (amenity, tech, pet rent if you have pets)
      + utilities: 'extra' amount | 'tenant-paid' estimate ?? cost-profile estimate | 'included' 0
      + parking: max(0, spacesNeeded − spacesIncluded) × extraSpaceCost
      + storage (if needed and not included)
      [+ one-time fees ÷ lease months]   ← only if enabled (Q5)
      [− move-in special ÷ lease months] ← only if enabled (Q5)

lease months = unit.plannedLeaseMonths ?? costProfile.defaultLeaseMonths (12)
rent         = rentByTerm[lease months] when the listing gives one, else rent
```

**Lease length (your Q5 addition).** Settings → Cost profile has "Spread one-time costs over [12] months". Each unit's cost breakdown then shows a "Lease length" selector listing that unit's offered terms (e.g. 12, 15 months) plus "Other…". Picking a length sets `plannedLeaseMonths`, recalculates the spread, and, when the listing gives different rents by term, switches to that term's rent. The selector only appears when spreading is turned on, or when the unit has different rents by term.

Unknown rent → unknown total. An unknown utility is treated as tenant-paid at your profile estimate and marked "assumed" so it's visible in the breakdown (Q5). Cost per sq ft = total ÷ sq ft. Move-in cost (deposit + application + admin + first month) is shown separately.

*As built in M9* (`domain/cost.ts` `unitCost`, every `UnitRow` carries its `cost`):

- **Lines and sources.** Each line is whole dollars and says where it came from: *listed* (the unit's own rent, fees, utility amounts, parking and storage prices), the *building* (pet rent), *your estimate* (the cost profile, scaled by size or bedrooms), *your estimate here* (`unit.costOverrides`, set with the pencil on a line in the unit's Monthly cost), or *spread* (one-time amounts over the lease). The total is the sum of the lines, so the breakdown always adds up (fast-check property test). A unit's own numbers win over an override, and an override over the profile.
- **Assumed** (amber) means the unit doesn't say: an unknown utility (assumed you pay), a utility billed extra with no amount, parking with unknown spaces included or price, storage with unknown terms, pet rent the building doesn't list. A utility marked *You pay* without an amount uses your estimate and isn't "assumed" (you know you pay; only the amount is yours).
- **Parking**: spaces you need beyond those included × the extra-space price (your estimate if unknown); none needed → no line; "No parking" or street parking without a price → $0 with that note.
- **Pets** (owner to confirm): with cats or dogs in the profile, the building's pet rent counts **per pet**, else your estimate per pet (assumed); a monthly fee named like "Pet rent" is the pet rent instead (counted as given, only if you have pets). Move-in cost adds the building's pet deposit and pet fee.
- **Renters insurance** (your profile) is added to every unit; at $0 the line disappears.
- **Spreading** (both off by default, Q5): application, admin and pet fees ÷ lease months; the move-in special's value ÷ lease months, subtracted. Off, the special shows as *Effective rent* under the total and one-time fees stay in the move-in cost.
- **Lease length selector** in the unit's Monthly cost: *Your default (12 months)*, the unit's offered terms and priced terms (with their rent), *Other…*; shown when spreading is on or the unit has rents by term (§5.3). Picking one sets `plannedLeaseMonths` (one undo step, `commands/cost.ts` `setLeaseLength`).
- **Move-in cost** = first month (the rent for your lease length) + deposit + application + admin (+ pet deposit and fee), naming the parts still unknown. **Cost per ft²** = total ÷ ft², to the cent.
- **Everywhere**: the unit plate and cards lead with the total ("$1,932/mo · $1,650 rent · 2 assumed", breakdown in the tooltip); building cards and panels show the range of totals; sorts *Total cost* (new default), *Cost per ft²*, *Lowest total cost* (buildings, new default); pins get the *Total cost* (new default for anyone who never changed their pin fields) and *Cost per ft²* fields, and the price color uses the total. History and toasts say each cost-profile change ("Electric estimate $55 → $60/mo", "Parking spaces you need 1 → 2") and each per-unit choice ("Lease length your default → 15 months on Unit 1504", "Your electric estimate $80/mo on …").
- **Cost limits** above the list (Q32): total up to $X/mo, per ft² up to $Y, keep or drop unknowns. UI state only (Zustand, for the visit); narrows list and map together.

### 5.4 Photo archive

One interface, three stores, chosen automatically and shown in Settings:

```ts
interface OriginalStore {
  kind: 'fsa' | 'opfs' | 'idb';
  write(path: string, data: Blob): Promise<void>;
  read(path: string): Promise<File>;
  move(from: string, to: string): Promise<void>;   // rename when unit # / building name changes
  remove(path: string): Promise<void>;
  usageBytes(): Promise<number>;
}
```

- **Chrome/Edge (FSA)**: "Choose photo folder" calls `showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' })`. The handle is saved in IndexedDB. On later visits, if the browser needs permission again, a quiet banner offers "Reconnect photo folder" (permission requests need a click). Chrome's "Allow on every visit" removes this after the first time.
- **Safari/Firefox (fallback)**: originals go to OPFS (private browser storage) with the same layout; if OPFS isn't available, IndexedDB blobs. Settings and the backup reminder say plainly that photos exist only in this browser until exported as a .zip.
- **Layout** (readable without the app): `Riverlight/Unit 1504/2026-10-15_01.jpg`, floor plans as `…/floor-plan_01.png`, floor-plan-only units as `Riverlight/Plan C (floor plan)/`. Each unit folder gets `unit.json` (its record, listings and notes), rewritten a few seconds after changes. Names are sanitized for all operating systems.
- **Adding photos (Phase 1)**: drag-and-drop, file picker, or **paste** (right-click "Copy image" on a listing, then Ctrl/⌘+V on the unit). The extension's "Save listing" is Phase 3.
- **Thumbnails**: 480 px WebP made with `createImageBitmap` (EXIF orientation respected) and stored in `thumbs`. Lists and pins use only thumbnails; the lightbox loads the original.
- **Limits**: Settings shows archive size and the "keep originals for: all / starred / shortlisted" option. HEIC files from iPhones can't be decoded by Chrome/Firefox; the app says so and asks for JPEG.
- **Deleting** a photo soft-deletes it (undo works); originals in the trash are purged after 30 days or by "Empty trash".

### 5.5 Backup export and restore

- **Backup (data)** → `rental-tracker-backup-2026-10-15.json`: every table except caches, change log, thumbnails and the folder handle; includes photo metadata. API keys are excluded by default. Small (well under 5 MB for 500 units).
- **Backup with photos** → `.zip` containing `backup.json` + `photos/<same layout>`. Streamed with fflate; on Chrome/Edge it streams straight to disk (`showSaveFilePicker`), elsewhere it builds in memory and warns above ~1 GB.
- **Restore** (Phase 1 = replace everything, Q7): pick file → validate → migrate if older → show counts ("43 units, 18 buildings, 210 photos") → the current data is first saved to `snapshots` and offered as a download → replace in one transaction → undo history cleared.
- **Photos after restore**: data-only restore on a new machine shows thumbnails as "original not here" until you reconnect the same photo folder (e.g. via Dropbox/iCloud); matching is by archive path.
- **Safety**: `navigator.storage.persist()` is requested on first data entry. A banner appears when the last backup is older than 7 days (configurable) and after any restore or bulk import.
- **"Nothing lost" check**: an automated round-trip test (export → wipe → restore → deep-equal) runs on random datasets every test run.

*As built in M5* (`services/backup/`, `services/storage.ts`, `db/upgradeCheck.ts`, `ui/settings/`):

- **Settings** (`#/settings/backup`, `#/settings/storage`; the gear in the top bar) has only the two sections M5 needs; the others arrive with their milestones. Loaded on demand like the Data check page.
- **Backup (data)**: every data table read in one transaction, ordered by id, deleted records included; API keys blanked; indented JSON so it can be read without the app. Preview and development builds name files `rental-tracker-preview-backup-…`. *Back up with photos (.zip)* stays in M12 with the photo archive.
- **Last backup time is kept per browser** in `meta` (`lastBackupAt`), not in `Settings.backup.lastBackupAt` (left in the model, always null): it isn't data, so it mustn't be undoable or travel in backups. After a restore it's set to the file's `exportedAt` (the data now matches that file), so restoring an old file shows the reminder until you back up again. The reminder interval (`Settings.backup.remindEveryDays`: 1, 3, 7, 14 or 30 days) is a normal undoable setting.
- **Reminder banner** under the top bar on the main screen when there's a building or unit and no backup from this browser in the interval (or never). *Back up data* downloads at once; *Later* hides it for 24 hours (`meta.backupSnoozedUntil`). "After a bulk import" (M11) is left to that milestone.
- **Restore**: the file is checked before anything is written: envelope, migration chain, every record against the zod schemas (first three problems named), duplicate ids, one settings record. Unknown tables are ignored, missing ones are empty. The review shows what the file holds next to what's in the browser now, with *Replace with this backup*, *Download what's here first* and *Cancel*. One `systemWrite` transaction then saves a snapshot (skipped when the database is empty), empties and refills the data tables, keeps this browser's API keys, and clears the change log; a failure part-way changes nothing.
- **Snapshots ("Safety copies")** now carry a `reason` (`migration` or `restore`; older ones read as migration) and the last 3 **of each kind** are kept, so restores never push out the copy from before an update. Each can be downloaded (`…-safety-copy-<date>.json`, in the data format it was taken in) or restored through the same review. `snapshots` isn't a data table, so this isn't a data-format change.
- **Persistent storage**: `navigator.storage.persist()` is asked once by itself (`meta.persistAskedAt`), after the first change anywhere in the app or on opening the main screen with data. Settings → Storage shows the answer, space used and available, and can ask again.
- **Nothing lost**: a fast-check property test runs random command sequences (sample data, quick-add with pasted text, edits, deletes, notes, settings, undo), exports to JSON text, restores into a fresh database and over the old one, and deep-compares every table. A browser test does the same through the real UI between two browser profiles.

### 5.6 Undo and change history

- Every write goes through `action(label, fn)`. A **Dexie DBCore middleware** records `{actionId, table, key, before, after}` for every put/delete inside it, so nothing can be written without being undoable.
- Writes to data tables outside an action are refused (an error, not a silent unlogged write). Two exceptions: Dexie upgrade transactions (migrations) and `systemWrite(reason, fn)` for restore (M5) and test setup. Caches, thumbnails, the change log and `meta` aren't logged.
- **Undo** (⌘/Ctrl+Z) writes the `before` values of the last action in reverse order; **Redo** (⇧⌘/Ctrl+Shift+Z) re-applies `after`. Both are themselves recorded, so history stays linear and honest.
- The undo and redo stacks aren't stored separately: they're derived from the change log (do pushes, undo moves to redo, redo moves back; a new action clears redo). So they survive reloads and can't drift from the history.
- Toasts after every action carry an Undo button ("Flagged as reject · Undo"). Bulk actions (multi-select, merge, restore) are single actions.
- The **History panel** shows a unit's changes with time and field, and "Restore this version" for one record.
- **Owner notes for M7 (M4 review, Oct 17)**, with the approach proposed in reply; the M7 chat confirms the details with the owner:
  1. *Say what was done, specifically* ("Deleted Unit 1504 at Riverlight", "Rent $1,650 → $1,600 on Unit 908"). The History panel builds each line from the change log's stored before/after records rather than from the action's label, so entries recorded before M7 read specifically too. No data-format change.
  2. *Go back to a point in time* without pressing Undo repeatedly: **Restore to here** on any history row reverses everything after it as one new, undoable action (the "undo to here" already listed in §4.1).
  3. *Undo one past action on its own*, out of order (e.g. bring back one deleted unit after adding others since): **Undo this** on a single row reverses just that action, recorded as a new action, so history stays linear and honest. When a record it touched was changed again later, the app shows what would be overwritten and asks first (or offers only the parts that don't clash). Restoring a deleted unit or building never clashes, since a delete only marks the record.
  4. Alternative or addition for the deletion case: a **Recently deleted** list (filter in History, or under Settings next to "Empty trash") with **Restore** per unit or building.
  History is kept 90 days or 10,000 changes (§5.6). These items make M7 larger; if it grows past one milestone, history can be split into its own milestone after M7 (owner to decide then).
- The change log keeps 90 days or 10,000 entries (whichever is smaller), pruned after each action and only in whole actions; restores clear it after the snapshot.
- **As built (M7; owner notes confirmed, Q21):**
  - *Descriptions* (`domain/history.ts`): every action is said from its stored before/after records, per table (units field by field with values, opinions as "Flagged … as pick", "Rated … 4 stars", "Your label …", notes, listings, people, settings). The same thing done to several units is said once ("Status → Reviewing on 4 units"); a building deleted with its units, a unit added with its listing, or a reject with its new reason read as one line; undo and redo name what they went back on ("Undid: …"). Toasts and History use the same text.
  - *Toasts* (`state/toasts.ts`, registered in `main.tsx`): after every action that changed something, with **Undo** (that action on its own, via Undo this; plain Undo when it's the latest) or **Redo** after an undo. A caller's own words ("Unit 1504 at Riverlight added.") keep the action's button. `⌘/Ctrl+Z`, `⇧⌘Z / Ctrl+Shift+Z` (and `Ctrl+Y`) outside text fields.
  - *History panel* (`#/history`, `#/history?unit=<id>`; detail column; clock button in the top bar; "Open history" at the end of a unit's panel): Everything / This unit / Deleted, 40 rows a page with details per action. **Undo this** (`commands/history.ts` `planUndoThis`/`undoThis`) reverts each value the action changed (nested objects key by key, so `utilities.heat` and `utilities.electric` don't clash); values changed again later are listed as clashes and the person chooses *Undo the rest* or *Undo all of it*; it's a new action with `target` = the undone action, so the row shows "Undone". **Restore to here** writes, for every record changed later, the `before` of its first later change, as one new action. Both re-check inside the transaction (another tab). **Deleted** lists soft-deleted units and buildings (a building with the units deleted with it) with **Restore**; restoring a unit in a deleted building restores the building too.
  - "Recently deleted" is the History panel's Deleted tab rather than a Settings page; Empty trash stays with photos (M12).
- Photo files aren't in the change log; soft delete covers them.

### 5.7 Fast data entry and AI import

Goal: nothing is typed twice, and each field can be filled from wherever you're looking at the time. Everything here runs locally: no server, no keys, no paid services.

**Principles**

1. **One pipeline.** Quick-add, pasted listing text, the batch grid, AI replies and backups all become a *proposed change set*. The same parser normalizes it, the same duplicate engine matches it to your units, and the same review screen shows anything that would change existing data.
2. **Fill once, share.** Building facts live on the building and every unit shows them; a floor plan acts as a template for its units.
3. **Your data wins.** Imports fill unknown fields automatically, but never replace a value you entered unless you accept it.
4. **Every value remembers its source.** `fieldSources` records how and where each imported value came from; the detail panel shows a small source link.
5. **Essentials first.** A short, editable list of essential fields (default: rent, beds, baths, sq ft, available date, laundry, parking, heat and electric, pets, lease terms) drives the completeness meter and a "ready to compare" mark. Everything else is optional depth.

**Manual paths**

| Path | How it works |
| --- | --- |
| Quick-add | As §5.1. ⇧⏎ adds the unit and starts another in the same building, with address and listing site kept. |
| Paste listing text | On a listing page, select all, copy, and paste into Quick-add or a unit's "Paste text" box. A local parser recognizes about 30 patterns (rent, beds/baths, sq ft, available date, deposit and fees, lease terms, laundry, dishwasher, AC, parking price, pet policy and pet rent, which utilities are included, common amenities like fitness, rooftop, package lockers, skyway). Recognized values appear as chips you confirm (⏎ accepts all); the raw text is kept with the import. *As built (M4, `domain/listingText.ts`):* the first mention wins (the top of a page is the listing; "similar homes" come later); when the first mention of beds, baths or size is a range, the page lists several units, so rent becomes "from" the lowest and unit-specific values (beds, baths, size, unit, floor, plan, date) are left out with a note; "No …" makes a feature a no; values outside sane limits are dropped. In Quick-add, rent, beds, baths, unit, plan and address fill their boxes (highlighted until changed) and everything else is a chip, on by default; ⏎ adds the unit with the chips that are on. On an existing unit (its **Paste text**), details it lacks start on, ones that would change a value you have start off and show yours, and ones that match are hidden; ⌘/Ctrl+⏎ applies. Building facts (amenities, pets, year built, floors, smoking, elevator) go on the building; their sources are recorded on the unit (`fieldSources`, `building.*` paths) because buildings have no source list. |
| Batch add (grid) | From a building: "Add several units" opens a spreadsheet-style grid (unit #, floor plan, beds, baths, sq ft, floor, rent, available). Paste a table copied from the building's availability page; columns are matched by their headers. Each row becomes a unit; the whole batch is one undo step. |
| Copy from | "New unit from Plan C" or "Copy details from Unit 908" copies specs, features, fees and utilities, never the unit number, floor, rent, windows, ratings or notes. |
| Bulk edit | Select several units, then "Edit together" to set any field for all of them (e.g. heat included for every Riverlight unit). Fields that differ show "Mixed". |
| Research mode | In Shortlist mode the detail panel lists missing essentials as one-click prompts. In the edit form, ⌘↓ / Ctrl+↓ jumps to the next empty field and `?` marks it unknown, so a unit can be completed without the mouse. |

*As built (M8):*

- **Forms** (`ui/edit/`; `#/unit/:id/edit`, `#/new-unit`, `#/building/:id/edit`, loaded on demand): one scrolling page per record with a sticky section nav whose dots (● ◐ ○, drawn in CSS) come from the completeness checks, the fields, and a side column (building summary, completeness, essentials; the building form lists its units). Every §3 field is there except `costOverrides` (M9's cost breakdown), `placement3d` (Phase 4), `collectionIds` (M10) and photos (M12, a placeholder section). Fields: text, numbers read leniently (`domain/input.ts`: "$1,650", "720 sq ft", "1 1/2"), dates, menus, **Yes · No** groups (Y and N), exposure (eight direction buttons, first pressed is the main one, *Add the windows' directions*), windows (room, direction, size, obstruction), utilities (**Included · Extra $ · You pay** with an amount; the estimate's hint shows the cost profile's number, `domain/cost.ts` `profileEstimate`), monthly fees (or *No monthly fees*), rent by lease length, move-in special, lease terms ("12, 15", "none"), the lease you'd sign, status and shared label, links, and **listings with their price history** (site, link, first/last seen, off market, every price with its date and note; add, correct, delete). The building form edits the address text (the pin stays; *Place on map* moves it) and the neighborhood (becomes `manual`).
- **Draft and save**: edits are a draft; **Save** (⌘/Ctrl+S) runs one action (`commands/forms.ts` `saveUnitForm`, `saveBuildingForm`), validated with zod before anything is written, so Undo and History take a save back in one step and describe it field by field ("Changed 7 details on Unit 1504 at Riverlight"; `domain/history.ts` now names building fields, says utilities and the move-in special as a whole, and keeps sources quiet). Saving an untouched form writes nothing. Typing errors are shown under the field and block saving; leaving with unsaved changes asks first (`useBlocker`, and the browser's own prompt on closing the tab).
- **Rent and price history** (`domain/unitForm.ts` `reconcileRent`): a typed rent becomes today's price on the most recent listing (same day replaces) or on a new listing without a link, as in Quick-add; editing the price history so its newest price changes moves the rent to it. The form says which will happen ("Saving records $1,600 as today's price on the Zillow listing"). A rent change and its price point read as one line in History.
- **Sources**: a value changed by hand loses its `fieldSources` entry when saved (it no longer came from there); the Sources section lists the rest with a remove button. Building facts typed in the building form drop the matching `building.*` sources on its units.
- **Unknown and research mode**: the `?` button or key marks a field unknown (italic "Unknown", no dashed border) and moves to the next empty field; pressing the button again un-marks it. Since the M8 review (Q29, v3) marks on research fields are **saved** with the record (`checkedUnknown`, with the date first checked) and count as done in the completeness meter; a value replaces the mark. Only fields that count toward completeness (`RESEARCH_FIELDS`) show the dashed border and stop ⌘/Ctrl+↓ (⌘/Ctrl+↑ goes back); notes and preferences don't. "Nothing left empty" shows when there's none.
- **Standalone homes** (Q30, `domain/standalone.ts`) and **complex names** (Q31, `ui/edit/BuildingFields.tsx`): see §11.1.
- **Completeness and essentials** (`domain/completeness.ts`): one list of *checks* (≈ 60: unit specs, features, lease, utilities, parking and storage; building structure, amenities, policies, neighborhood, website, management) with "applies" rules (a floor plan has no floor, exposure or windows; street parking has no space price; storage cost only when it isn't included; pet rent only when pets are allowed). Group checks: *Parking* (type, plus spaces included for garage or lot) and *Pet policy* (cats and dogs). `Settings.essentialFields` stores check keys (the defaults were already stored since M1); **Settings → Essential fields** chooses them (undoable). The unit panel shows **Essentials N of M** with each missing one as a prompt (*Add laundry*) linking to the form at that field (`?field=`), building ones to the building form, and **Ready to compare** when none are missing (Q28: on every unit until Shortlist mode).
- **Copy from** (`domain/copyFrom.ts`): *Copy details from* (units and plans in the same building) fills only what the unit doesn't know and says what it kept; **New unit from Plan C** / **New unit like this** opens the form for a new unit with the copied details. Copied: type, beds, baths, size, layout notes, features, lease terms, deposit and fees, monthly fees (new ids), move-in special, utilities, parking, storage. Not copied: number, floor, rent, rent by term, available date, exposure, windows, view, status, labels, opinions, notes, listings, links, the lease you'd sign.
- **Edit together for buildings** (Q23): ⌘/Ctrl- and Shift-click building cards in the Buildings view (and ⌘/Ctrl-click pins there) select buildings; a bar offers **Edit together…** for type, elevator, management company, amenities, cats, dogs, pet rent and deposit, smoking and subletting (`updateBuildings`, one undo step; amenities and pets change only the parts set). Esc clears it.
- **Going between forms** (owner, M8 review): *Edit building* in a unit's form, a building's *Your units here* links and *More about the home* take the current form's place in the history rather than stacking on it (`ui/edit/FormLink.tsx`). However often you go back and forth, Save or Cancel returns to where the first form was opened (the main screen, list and map, with that panel open); unsaved changes in the form you leave are asked about once.
- **Keys**: `E` opens the open unit's or building's form; in a form ⌘/Ctrl+S, ⌘/Ctrl+↓/↑, `?`, Y/N; the shortcut sheet lists them.

**AI-assisted path**

Works with any AI assistant that can browse the web (for example Claude with web search). The app itself never calls an AI, so it costs nothing.

1. **Copy a research prompt**, at one of three scopes:
   - *This unit*: what's known plus only the missing fields. The shortest prompt and the best answers.
   - *This building*: building facts plus every currently available unit and floor plan on its website. Creates and updates many units in one pass.
   - *Selected units*: up to 8 per prompt; larger selections are split into several prompts, because answer quality drops with longer lists.

   Each prompt contains today's date, the values already known, the requested fields with their types and allowed values (generated from the zod schemas in a compact form), the rules (verify, cite a URL per field, use null when unsure, don't infer from similar units, prices as plain numbers), and the exact reply format: one JSON code block.
2. **Paste the reply back** with ⌘V / Ctrl+V anywhere outside a text field (the app recognizes its own format), the Import button, or by dropping a `.json` file.
3. **Tolerant reading.** The JSON is pulled out of surrounding prose or code fences; common slips are repaired (trailing commas, curly quotes, comments); values like "$1,650", "720 sq ft", "1.5 baths", "June 1, 2027" and "yes/no" are understood, as are common field-name variants. Anything unusable is listed in the review rather than dropped silently.
4. **Matching.** Units match by building address + unit number. A floor-plan placeholder that now has a unit number is upgraded rather than duplicated; anything unmatched is proposed as new.
5. **Review** (Import review screen), grouped by unit:
   - fills an unknown field: pre-checked;
   - changes a value you have: unchecked, showing your value, the proposed value and its source link;
   - new unit or building: pre-checked, expandable.

   Keys: J/K move, Space toggles, A accepts a whole unit, ⏎ applies. Applying writes every checked change as one undo step, records sources, and keeps the raw reply in `imports` so it can be reviewed again later.
6. **Guardrails.** Values without a source are flagged "no source"; implausible numbers (rent under $300, 40 bedrooms) are flagged; AI-filled values carry a small "AI" source mark in the detail panel until you edit or confirm them.

**Phase placement (decided, Q11).** All of §5.7 is in Phase 1, although spec §12 had paste-listing-text and AI import in Phase 3.

### 5.8 People (M6, Q15)

A draft for the M6 chat to confirm with the owner before building:

- **People**: a `people` table (`id`, `name`, `color`). Each copy has one person who is "me" (its id in `meta`, so it never travels in a backup as "me"). First run, or the update to v2, asks for your name (default "Me"), editable in Settings → People.
- **Per person**: rating, flag (pick/reject), flag and rating notes, and reject reasons move from the unit into an `opinions` table keyed by unit and person (`[unitId+personId]`), so each person only ever writes their own rows: that's what makes household sync (§9) mostly free of conflicts. Status, color label, facts and listings stay shared, one per unit (to confirm: color labels could be personal too).
- **Notes** record their `authorId`; others' notes show their name.
- **Migration v2** (the first): creates "me", moves each unit's rating/flag/notes/reasons into opinions for me, turns `externalRatings` (unused so far) into people and opinions, and drops those unit fields. Fixture `backup-v2.json`, migration test, and the M5 pre-update backup screen shows for the owner's real data.
- **Showing it**: list cards, pins and the detail panel show **your** rating and flag by default; the detail panel shows everyone's ratings side by side ("You ★4 · Alex ★3"). Sorting and filtering by "everyone's lowest", "average" or "both rated 4+" join the filter panel (M10) and the compare table (M10). Until household sync exists, other people's ratings only arrive through sample data (preview builds get a sample roommate) or a restored backup that has them.

**Confirmed with the owner (M6 chat, Oct 18):** per person: rating, rating note, flag, flag note, reject reasons, "last reviewed" and a **private color label** (Q16); shared: status, facts, listings and the **shared color label**. Other people can be **added by hand** in Settings → People and their ratings entered for them (Q15 addition), not only through sample data or backups. The update to v2 **clears the undo history** after its safety copy (Q17).

**As built (M6):**
- `model/people.ts` (Person, Opinion, `opinionId`), `db/me.ts` (`readMeId`, `ensureMe`, `getMe`), `commands/people.ts` (`addPerson`, `updatePerson`, `removePerson`, `setOpinion`, each one undo step), `domain/people.ts` (colors, names, `resolveMe`, summaries).
- **Me.** `main.tsx` calls `ensureMe` after the database opens: a new database (or one after *Remove all data*) gets a person "Me" in a system write (not undoable; it's the copy's setup). The v2 upgrade creates "Me" from the old data and records it. The main screen asks once for your name in a banner, only once there are units (*Save* / *Not now*, remembered in `meta.nameAskedAt`); Settings → People changes it any time.
- **Opinions.** `setOpinion(db, unitIds, personId, changes)` stores one record per unit and person (empty opinions aren't created); un-rejecting clears reject reasons. Removing a person soft-deletes them with their opinions (Undo brings both back); notes they wrote stay and keep their name. You can't remove yourself.
- **Notes** get `authorId` (yours by default); notes by others show "· Alex" after the date.
- **Showing it.** `state/derive.ts` gives every unit row `mine` (your opinion or an empty one) and `opinions` (everyone, you first). Cards, pins, sorting by rating and the dimmed "rejected" look use yours; cards show everyone else in one fixed-size chip (`othersSummary`: up to 3 badges +N, star range, pick and reject counts; owner review, DESIGN §4.1); the detail panel has a **Ratings** section with everyone side by side, editable stars and flag per person (editing notes, reasons and labels comes with triage, M7).
- **Backups and restore.** Backups carry `exportedBy` (this copy's person); snapshots record `meId`. After a restore, "me" is: you, if the file has you; else whoever made the file; else the file's only person; else a new person with your name (or "Me" if the file already has that name). An old (v1) file is migrated with you as "me", so its ratings become yours under your name.
- **Sample data** (preview/dev) adds **Alex**, who rated about three in four units close to you (sometimes not) and wrote one note. *Load sample data* adds only the sample buildings you don't already have (same address, not deleted), so pressing it twice no longer makes duplicate buildings (owner review: three "The Larkin" cards on the map); it says "already loaded" when there's nothing to add. *Remove all data* keeps you.
- Not yet (after M7): filters by "everyone's lowest / average / both 4+" (M10); compare table columns per person (M10).

---

## 6. Keyboard (Phase 1)

Shortcuts act on the selected unit (or all selected units). Full table in DESIGN.md.

*As built (M7, `hooks/useListKeys.ts`, Q22):* labels by physical key (`e.code`), so ⇧6–9 set the shared label on any keyboard; `⏎` moves focus to the open unit's details; keys of later milestones (E, C, F, M, R) say which milestone brings them; `?` opens the sheet (`ui/triage/shortcuts.ts`). Targets are the multi-selection (⌘/Ctrl-click toggles, Shift-click selects the range from the last ⌘/Ctrl-clicked unit; plain click or Esc clears it), else the open unit.

*As built (M8):* `E` opens the full form of the open unit or building; in a form `⌘/Ctrl+S` saves, `⌘/Ctrl+↓` / `⌘/Ctrl+↑` move to the next / previous field still to research, `?` marks a field unknown and moves on (in a text box only while it's empty), `Y` / `N` answer a yes/no field, and the arrow keys move within a choice. Form keys work while typing.

`P` pick · `X` reject (opens reason dialog) · `U` unflag · `0`–`5` stars · `6` red · `7` yellow · `8` green · `9` blue · `↑/↓` or `J/K` previous/next unit · `Enter` open detail · `E` edit · `N` quick-add · `C` add to compare · `/` search · `F` filters · `L` map layers · `M` toggle Explore/Shortlist · `B` toggle units/buildings view · `R` copy research prompt · `⌘/Ctrl+Z` undo · `⇧⌘/Ctrl+Shift+Z` redo · `?` shortcut sheet · `Esc` close panel. In forms: `⌘/Ctrl+↓` next empty field, `?` mark unknown, `⌘/Ctrl+S` save. Disabled while typing in a field (except the form keys).

---

## 7. Phase 1 scope boundaries

In: everything in spec §12 Phase 1 and the MVP rows of §10 (total cost, price history, duplicate detection, undo, window directions, photo archive); plus base-map switching and pin options (§4.3), lease length (§5.3) and fast data entry with AI import (§5.7, Q11).
Stored but not shown yet: destinations, travel-time cache, crime, OSM id, 3D placement, monitoring dates.
People and per-person ratings are in Phase 1 (M6, Q15); household sync follows Phase 1 (§9).
Not built: search-area drawing, travel times, overlays, buildings layer, keyed base maps, weighted score, monitoring, browser extension, sharing/merge import, CSV, share links, printable summary, Market history view, 3D, tour mode.

---

## 8. Testing approach

| Layer | Tool | What it covers |
| --- | --- | --- |
| Domain | Vitest | cost calc and breakdown provenance; address normalization (table of real Twin Cities address variants); dedupe; listing URL parsing; filter/sort with unknowns last; completeness |
| Migrations | Vitest | each `backup-vN.json` fixture migrates to current and validates |
| Database + commands | Vitest + fake-indexeddb | every command; undo/redo (property test with fast-check: random command sequences, then undo all → original state); merge; soft delete |
| Backup | Vitest + fast-check | random datasets: export → wipe → restore → deep-equal |
| Photo stores | Vitest (in-memory fake of FSA handles) + Playwright (real OPFS) | write/read/move/remove, path sanitizing, sidecar contents. The real folder picker gets a short manual checklist (browsers can't automate it). |
| Import parsing | Vitest | a fixture library of real-world shapes: AI replies with prose around the JSON, broken JSON, every value format; listing text in the shape of Zillow, Apartments.com, RentCafe, Entrata and Craigslist pages (M4: made-up text in `tests/fixtures/listing-text/`, since the build workspace can't reach those sites; add a fixture whenever a real page is misread); pasted availability tables. Each fixture has an expected change set. |
| Import review | Vitest + Testing Library | your values never change unless accepted; one undo step per import; floor-plan upgrade; sources recorded |
| Pins and base maps | Playwright | every "Pins show" option renders; base map switch keeps selection and attribution; no tile requests to raster servers when offline |
| Components | Testing Library | UnknownInput states, forms commit once, shortcuts ignored while typing |
| End to end | Playwright on Chromium, WebKit, Firefox | quick-add with geocoders mocked (`page.route`), map selection sync, restore flow, phone width |
| Acceptance | Playwright `acceptance.spec.ts` | spec §12, scripted: add 15 units from Zillow, Apartments.com and building-site URLs in under 15 min of scripted time; rate and flag; assert building clustering; each listing link has the right `href` and opens in a new tab; export → clear site data → restore → identical dataset. A human run of the same steps closes Phase 1. |
| Performance | Playwright | seeded 500 units / 200 buildings: filter + sort < 100 ms, list scroll without dropped frames, map pan smooth |
| Accessibility | axe-core in Playwright + keyboard-only pass | main, quick-add, edit form, compare, settings |

Tests never call real geocoders or tile servers. `npm test` runs unit + db + component tests; `npm run e2e` runs Playwright.

---

## 9. Milestones

Each one ends with: tests green, the app running, and a short "how to try it" note from me. I wait for your OK before the next.

| # | Size | Milestone | You can try |
| --- | --- | --- | --- |
| **M0** | S | Scaffold: Vite + React + TS, lint, Vitest, Playwright, design tokens, light/dark, empty app shell, README, `CLAUDE.md`; GitHub repo with planning docs; automatic deploys of `main` (live) and of the milestone in review (`/preview/`, separate database) | Open your live and preview links; theme follows your system |
| **M1** | L | Data model as zod schemas, Dexie v1, commands, change-log middleware, undo engine, migration framework, "Load sample data" (dev only) | Load sample data; a debug page shows counts; undo/redo from it |
| **M2** | M | Unit list + detail panel (read-only), Units/Buildings toggle in list, text search, sort, unknowns-last | Browse the sample units, open details, sort by rent |
| **M3** | L | Map: Wayfinding style, HTML pins, building grouping + fan-out (built as a card per building, Q12), low-zoom clusters, building view, list ↔ map selection sync, external links; **Map layers panel**: five base maps, all pin options, pin color, shrink-to-dots | Click pins and cards; try every pin style and base map |
| **M4** | L | Quick-add: Photon suggestions, Nominatim fallback, Place on map, listing URL recognition, **paste listing text**, building match, duplicate-on-add banner, listings + first price observation, "add another in this building" | **Add your real units.** Under 30 s each |
| **M5** | M | Backup export (JSON) and restore, persistent storage request, backup reminder banner, snapshots | Export, clear site data, restore; everything returns. **Safe to rely on from here.** |
| **M6** | M | **People** (Q15): your name in Settings; ratings, flags, flag/rating notes and reject reasons become per person; notes record their author; the first data-format change (v2: migration, fixture, pre-update backup screen); sample data with a second person on preview builds; detail panel and list show everyone's ratings side by side | Name yourself; see a sample roommate's ratings next to yours |
| **M7** | M | Triage: flag, stars, color labels (named), status, reject reasons, rating/flag notes, notes log, multi-select, **bulk edit**, all keyboard shortcuts, toasts with Undo, History panel (specific descriptions, restore to a point, undo one action: owner notes in §5.6) | Triage with the keyboard; undo anything |
| **M8** | L | Full unit and building forms (every §3 field, unknown states, windows editor, exposure picker, utilities, parking/storage, recurring fees, rent by term), essentials + completeness meter, **research mode**, **copy from unit / new unit from plan**, listings and price-history editing, **Edit together for buildings** (select several in the Buildings view, Q23) | Fill a unit completely by keyboard; see price history |
| **M9** | M | Cost profile in Settings, total monthly cost + breakdown, **lease length selector**, move-in cost, cost per sq ft, sort/filter by them | Change an electric estimate or lease length; totals update everywhere |
| **M10** | L | Collections, full filter panel, saved filters (smart collections), Inbox, Explore/Shortlist mode, baseline criteria dimming, compare table | Build a shortlist and compare it |
| **M11** | L | **Batch add grid** with table paste; **AI research prompts** (unit, building, selection); **import review** with tolerant parsing, matching, field-by-field accept, sources, one-step undo | Have an AI research a building; review and apply its reply |
| **M12** | L | Photo archive: folder picker, OPFS/IDB fallback, thumbnails, drag/drop/paste, lightbox, sidecar `unit.json`, renames, trash, archive size, keep-originals option, backup with photos (.zip); photo pins come alive | Drop listing photos; find them in your folder; switch pins to Photo |
| **M13** | M | Duplicate review page and merge | Merge a unit listed on two sites |
| **M14** | M | Phone layout polish, PWA install + offline viewing, 500/200 performance pass, accessibility pass, **Clear all data** (Q14), **Colors editor** (Q18: status, New badge, badge colors, custom labels), **History search and filters** (Q24), **resizable, foldable panels and details placement** (Q27), acceptance test, final README | Install on your phone; pick your own colors; run the acceptance test |

Sizes are only for estimating time: S ≈ half an M, L ≈ twice an M, so the 15 milestones add up to about 21 "M-sized" units of work. M4 is where real use can start; M5 is where it becomes safe.

**After Phase 1: household sync (Q15, option C).** The first work after the M14 acceptance test, before Phase 2: about 2 L-sized milestones, numbered when Phase 1 is done. Each person's copy writes its own changes into a folder everyone shares through a cloud drive they already use (Dropbox, Google Drive or iCloud on a laptop) and reads the others' changes from it; no server, accounts or keys. Everyone can add and edit units; each keeps their own ratings, flags and filters. It replaces the merge import of spec §9 / Phase 3 (share links and CSV export stay in Phase 3). Limits to confirm then: Chrome/Edge on laptops (folder access), phones view-only; two edits to the same field at nearly the same time keep the later one and list what was overwritten; Undo undoes only your own changes.

---

## 10. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Data tied to one web address and browser | Data "missing" after switching URL or browser | One address decided (Q9); README explains; backup reminders |
| Safari deletes site data after ~7 days without a visit for non-installed websites | Phone copy could vanish | Phone is view-only per spec; recommend "Add to Home Screen" on iPhone (installed apps are exempt); laptop Chrome is primary |
| Browser storage eviction under disk pressure | Data loss | `storage.persist()`, weekly backup reminder, pre-migration snapshots |
| Photon / Nominatim / OpenFreeMap have no uptime guarantee | Can't geocode or see basemap temporarily | Save without location + Place on map; cached geocodes; style URL setting for a fallback provider |
| Photo folder permission must be re-granted per visit in some setups | Annoyance, missing photo saves | Banner with one-click reconnect; thumbnails always available locally |
| Multi-GB zip export in Safari/Firefox | Tab may run out of memory | Stream on Chromium; warn and offer data-only backup elsewhere; keep originals limit option |
| HEIC photos from iPhone | Can't be shown in Chrome/Firefox | Clear message; iPhone "Most Compatible" setting or convert to JPEG |
| Listing URL formats change | Pre-fill stops working | It's a convenience only; field still saves the link |
| Raster tile servers (OSM, CyclOSM) are donation-funded and can block heavy users | A base map stops loading | Normal on-screen use only, no offline caching or prefetch, attribution always shown; Wayfinding stays the default |
| MnGeo aerial service may not allow web-page access (CORS) or the web-map projection | No aerial base map | M3: MnGeo documents Web Mercator (EPSG:3857) on its `wmsll` endpoint, which the app uses (2025 metro imagery over 2025 statewide). Cross-origin access couldn't be checked from the build workspace (its network only reaches package registries), so the map says "Aerial photos couldn't load" if tiles fail; the owner checks it on the preview. Fallback: a keyed aerial layer, or drop it |
| AI replies can be wrong or invented | Bad data in your list | Nothing replaces your values without review; source link per value; "no source" and implausible-value flags; AI mark until confirmed |
| Listing-text and table formats vary by site | Paste recognizes less | Recognized values are confirmed, not trusted; fixture library grows as you hit new sites |
| Photo pins with many units | Cluttered map | Shrink-to-dots when crowded; photos load from small thumbnails only |
| Scope creep from §4–§6 items not listed in §12 | Phase 1 slips | Q6 decides them explicitly |
| Copyright of listing photos | Sharing risk | Photos stay local; exports exclude them unless chosen (Phase 3 sharing) |

---

## 11. Decisions and open questions

### 11.1 Decided (your answers, Oct 15)

| # | Question | Decision |
| --- | --- | --- |
| Q1 | Shared rating (§13) vs. per-person ratings (§9) | ~~One rating per unit (yours)~~ **Superseded by Q15 (Oct 18):** ratings are per person from M6. |
| Q2 | "Leased" status missing from §6 | Added **Leased** = you signed it, after Approved. "Rented by someone else" is Off market. |
| Q3 | Exposure: one direction or a list | A list; the first item is the main direction. |
| Q4 | Parking and storage listed twice | Only in the Parking & storage group; utilities are heat, electric, water/sewer, trash, gas, internet. |
| Q5 | Total monthly cost rules | One-time fees shown as a separate move-in cost, with an optional toggle (off) to spread them over the lease; specials shown as "effective rent", added to the total only if toggled; unknown utilities assumed tenant-paid and marked; parking spaces needed is a setting (default 1); a recurring-fees list is added. **Plus your addition:** a lease length to spread over, set as a default in Settings and per unit (§5.3). |
| Q6 | §4/§6 features not in §12 | Phase 1: Explore/Shortlist mode, baseline criteria (non-location), saved filters, Inbox. Weighted score: Phase 2. |
| Q7 | Phase 1 import | Restore replaces everything, after a snapshot. Merge import stays in Phase 3. |
| Q8 | Purple has no key | 6 red, 7 yellow, 8 green, 9 blue; purple from the menu. |
| Q9 | Where the app lives | GitHub Pages under your account; localhost for development only. |
| Q10 | Direct-sun estimate | Phase 4 with the sun slider; window directions captured from Phase 1. |

| Q11 | Fast data entry (§5.7) in Phase 1? | **Yes.** Paste listing text, batch add, AI research prompts and import review are in Phase 1 (M4, M11). |
| Q13 | Deleting a unit or building (M4 review, Oct 17): no milestone had a Delete button | **In M4.** **Delete unit…** and **Delete building…** at the end of their panels ask once inline, soft-delete (a building takes its units with it), close the panel and show a confirmation with **Undo** (undoes that delete only while it's still the latest action). Editing a building's details by hand stays in M8 (full forms). |
| Q14 | **Clear all data** (DESIGN §4.5, Settings → Storage) wasn't in any milestone (M5 review, Oct 17) | **In M14** with the other Settings polish (type DELETE, offers a backup first). Preview builds keep *Remove all data* in Settings → Data meanwhile. |
| Q15 | Several people (e.g. future roommates) using the app together: their own ratings to compare, their own filters, adding and editing units; ideally live like Google Docs (owner, M5 review, Oct 17–18) | **Both B and C.** (M6 chat: other people can also be added by hand in Settings → People and rated for, until sync.) (B) **People in M6**, a new milestone before triage, because ratings are cheap to make per person now and expensive to retrofit once triage and real data are built around one rating (§5.8). (C) **Household sync through a shared cloud-drive folder** right after Phase 1 (§9). Real-time collaboration through a hosted service is ruled out (owner rule 1). Spec §13 "one shared rating per unit" and §9's merge import are superseded. |
| Q16 | Color labels: shared or per person? (M6 chat, Oct 18) | **Both, independently.** Every unit has one **shared** label (household names) and each person one **private** label (their own names; others' private labels aren't shown). Any of the five colors in either; nothing converts between them. Stored from M6 (`unit.colorLabel`, `opinion.colorLabel`, `person.labelNames`); setting and showing them in M7. |
| Q17 | Undo history across the first data-format update (M6 chat, Oct 18) | **Cleared** by the v2 update after its safety copy: its before/after copies are in the old shape. The safety copy and the pre-update backup keep everything. |
| Q18 | Custom colors (owner, M6 review, Oct 18) | **Step 1 in M14: a Colors editor** (Settings → Display). Presets stay the default and the app looks the same for anyone who never opens it: every color picker offers the preset swatches first, plus *Custom color…*, plus *Reset to default*; a warning shows when text on a chosen color would be hard to read in light or dark mode. **Whose:** status colors (pin edges, pills, legend), the New badge and other display colors are **per person** (kept per browser, like pin choices); **people's badge colors are shared** (everyone sees a person in the same color). **Labels:** the five default colors stay for now; in M14 a person can also make **custom-colored labels**, private (theirs) or shared (same color for everyone). A custom label's name starts as the nearest named color ("Teal") and can be renamed. This will likely be a data-format change (labels stored by id with a color; badge colors beyond the six presets), so M14 says so. **Step 2, full custom themes** (sidebar, cards, pins), after Phase 1. |
| Q19 | Shared and private labels on cards and the map (M7 chat, Oct 18) | **Both on cards; choose on the map.** Cards show the shared label as the square on the thumbnail and your private label as a second square beside it. The Pins panel's color choices offer **Shared label** and **Your label** separately; the legend names whichever is chosen. |
| Q20 | Which fields **Edit together** sets in M7 (M7 chat, Oct 18) | **Markers and common facts**: flag, stars, both labels, status and reject reasons, plus utilities, laundry, dishwasher, AC, heating, parking, storage, lease terms and available date ("Mixed" where the selected units differ). M8 adds every other field with the same editors. |
| Q21 | Split History into its own milestone? (M7 chat, Oct 18; §5.6) | **No, it stays in M7** (one larger review): specific descriptions, Restore to here, Undo this with a clash check, and a Deleted list with Restore. |
| Q22 | Which label the number keys set (M7 chat, Oct 18) | **6–9 your private label, ⇧6–9 the shared label** (red, yellow, green, blue; pressing the current one clears it). Purple from the menu (Q8). |
| Q23 | ⌘/Ctrl-click in the Buildings view (M7 review, Oct 18): select buildings or their units? | **Buildings, to edit the buildings' own facts together** (amenities, pets, policies…): arrives in **M8** with the building form, which gets *Edit together* for buildings. Until then ⌘/Ctrl-click on a building card says so (it used to open a new tab). To select a building's **units**: in the Units view ⌘/Ctrl-click the building's name on its map card or its grouped pin (M7), or sort the list by building and Shift-click. |
| Q24 | Searching and filtering History (M7 review, Oct 18) | **Planned for M14**: a search box over the descriptions, a date range, and filters by kind of change (ratings and flags, status, edits, adds, deletes, undos) and by person. Can move earlier if History gets long sooner. |
| Q25 | Where the Data check page lives (M7 review, Oct 18) | **Settings → Data** (what's stored, database and version, preview-only sample data tools); the link under the list is gone and `#/debug` redirects. History stays its own panel beside the list and map (clock in the top bar), because undoing is easier with the unit and map in view; Settings → Data links to it. |
| Q26 | Hover fading and map selection (M7 review, Oct 18) | Pointing at **anything** (list card, pin, card row) fades every other pin and card; ⌘/Ctrl-click works on the map too; every selected unit is highlighted on the map. Single-unit editing waits for the M8 form (owner). |
| Q27 | Resizing, hiding and moving panels (owner, after M7 approval, Oct 18) | **In M14** (layout polish; no data change, so it can move earlier): drag the borders between list, details and map to resize; a button and the `[` key fold the list to a thin strip (a unit picked on the map then shows just details + map); the details panel can sit **left of the map, right of it, or under it** as a choice of preset layouts rather than free drag-and-drop docking (simpler, and each preset can be checked at every width); widths and layout remembered per browser. |
| Q28 | Missing-essentials prompts before Shortlist mode exists (M8 chat, Oct 18) | **On every unit's panel** when an essential is missing, "Ready to compare" otherwise (owner, M8 review, Oct 19). M10 may keep them to Shortlist mode. |
| Q29 | Remember "checked, still unknown" after the form closes? (M8 chat) | **Yes** (owner, M8 review, Oct 19), built in M8 with Q30 (data format v3): `checkedUnknown` on units and buildings. Completeness counts them as done, ⌘↓ skips them, essentials list them as "checked and unknown" (not ready to compare); giving the field a value drops the mark, and pressing `?` again un-marks it. |
| Q30 | Standalone houses and townhomes clutter the Building menu (owner, M8 review, Oct 19) | **A "Part of a larger building or complex" checkbox** in the unit form, defaulting from the unit type (house and townhome: no; apartment, condo, room: yes; a complex name or several of your units: yes), stored as `building.standalone` (null = default). A standalone home keeps its one-unit building under the hood; its unit form shows **The home** (address, landlord, contact, year built, stories, pets, smoking) saved with the unit in one step; the Building menu lists only shared buildings; its panel shows "The home" with no building to open; its essentials prompts open the unit form; the Buildings view shows it as a **Home** card that opens the unit. |
| Q31 | Name vs. Complex in the building form were confusing; both seemed to override each other (owner, M8 review, Oct 19) | **One Name box by default**; **"This complex has several buildings"** turns it into *Complex name* (with names used before offered) and adds *This building's name* (optional). Ticking moves the name into the complex; unticking moves the complex name back and says the building's own name goes. Shown as "North Tower · Cedar Mill". No data change (the checkbox is "a complex name is set"). Example text in empty boxes reads "e.g. …". |
| Q12 | SPEC §5 "clicking it fans out the units" (M3 review 4, Oct 16) | The owner chose **one card per building** listing its units instead of fanning out separate plates: it can't scatter units or cross lines, and keeps dots visible. Clicking a grouped pin still shows every unit at the building, each clickable. |

### 11.2 Open

| # | Question | Proposed (M9) |
| --- | --- | --- |
| Q32 | §9 M9 says "sort/filter by them", but the filter panel is M10 | **Cost limits** under the sort: total up to $X/mo, per ft² up to $Y, keep or drop units whose cost is unknown; for this visit only (not saved, not undoable, like search). M10's filter panel takes them over as its `totalMonthly` and `pricePerSqft` ranges. |
| Q33 | How pet rent counts (M9) | The building's pet rent **per pet** (cats + dogs in your profile); unknown → your estimate per pet, assumed. A monthly fee named "Pet rent" counts as given instead. Renters insurance is on every unit. Owner to confirm or change. |

**Assumptions I'll proceed with unless you object**

- US units throughout (sq ft, feet; default floor height 10 ft rather than 3 m).
- Neighborhood name in Phase 1 comes from the geocoder and is editable.
- Photos come in by drop, file picker or paste; nothing is downloaded from listing sites. AI replies may include photo links; they're saved as links, not downloaded.
- The §7 JSON example is illustrative. The AI-import format is generated from the internal zod schemas, so it matches the model rather than the example exactly (e.g. utilities as `{ "mode": "tenant-paid", "estimate": 45 }`).
- Full photo-folder support on desktop Chrome/Edge; OPFS fallback on Safari/Firefox. Flags, stars and status can be changed on the phone; full editing is laptop-first.
- Each person runs their own copy in their own browser; there are no accounts. From M6 each copy knows whose it is (§5.8); after Phase 1, copies can sync through a shared folder (§9).
- Settings and the Map layers panel show Phase 2 items (API keys, overlays) disabled, so the layout doesn't change later.
- The base-map and pin options (§4.3) are in Phase 1 because they're display choices over data Phase 1 already has; overlays that need new data stay in Phase 2.

---

## 12. Change log

| Date | Change |
| --- | --- |
| 2026-10-19 | M9: **total monthly cost** with a sourced breakdown, move-in cost and cost per ft² (§5.3 "As built"); **Settings → Cost profile** (`#/settings/cost`); the unit's **Monthly cost** section with the **lease length selector** and per-unit estimates (`costOverrides`' editor); totals on cards, plates, building cards and pins; sorts by total and $/ft² (total is the new default); pins' Total cost and Cost per ft² fields and price color by total; **cost limits** (Q32 proposed); pet rent per pet (Q33 proposed). No data-format change. |
| 2026-10-19 | M8, owner review: going between a unit's form and its building's no longer stacks forms; Save or Cancel goes back to where the first was opened. |
| 2026-10-19 | M8, owner review: **data format v3**: standalone homes (**Q30**), remembered unknowns (**Q29**); complex names behind "This complex has several buildings" (**Q31**); building names shown as "North Tower · Cedar Mill"; example text reads "e.g. …"; a multi-step update takes one safety copy. **Q28 decided** (prompts on every unit). |
| 2026-10-18 | M8: **full unit and building forms**, research mode, essentials and completeness, copy from unit / new unit from plan, listings and price-history editing, Edit together for buildings (Q23), Settings → Essential fields, `E` to edit (§5.7 "As built (M8)", §6). Q28 (missing-essentials prompts on every unit until Shortlist mode) and Q29 ("checked, still unknown" not remembered) proposed for the owner. New route `#/new-unit`. No data-format change. |
| 2026-10-18 | After M7 approval: **Q27** resizable and foldable panels, and the details panel left of, right of or under the map (preset layouts), planned for M14. |
| 2026-10-18 | M7, owner review: ⌘/Ctrl-click on map pins, card rows and a card's building name (all its units) adds to the selection; selected units are highlighted on the map; pointing at any card, pin or row fades the other pins and cards; ⌘/Ctrl-click on building cards no longer opens a tab (building multi-select and Edit together for buildings move to **M8**, Q23); History search and filters planned for **M14** (Q24); the Data check page became **Settings → Data** (Q25). |
| 2026-10-18 | M7: **triage and bulk edit**. Marker controls in the unit panel and a selection bar (flag, stars, your label, shared label, status), Reject dialog with reusable and new reasons and a note, flag/rating notes per person, notes log (add, edit, delete your own; units and buildings), multi-select, **Edit together** (Q20 fields), all Phase 1 keys with a `?` sheet, toasts with Undo/Redo after every action, **History** (`#/history`: specific descriptions, Undo this with clash check, Restore to here, Deleted with Restore), Settings → **Labels and reasons**, pins colored by shared or your label (pin color option `myLabel`, kept in the browser like other pin choices). `setOpinion` now records "last reviewed" and skips changes that change nothing. No data-format change. |
| 2026-10-18 | M7 chat: **Q19–Q22 decided** (labels on cards and pins, bulk edit fields, History stays in M7, label keys). |
| 2026-10-18 | M6, owner review: the pin field and sort option are called **Your rating** (they show and sort by yours). Custom colors decided as **Q18**: a Colors editor in M14 (presets first, custom optional; display colors per person, badge colors shared; custom private or shared labels named after the nearest color), full themes after Phase 1. |
| 2026-10-18 | M6, owner review: cards show other people in **one chip** of fixed size instead of one mark each (it overflowed with three people); a crowded card foot wraps instead of overlapping. *Load sample data* no longer duplicates buildings. Finding duplicates already in your list (and merging them) stays in M13. |
| 2026-10-18 | M6: **people and per-person ratings**, the first data-format change (**v2**). §5.8 confirmed with the owner (Q16: shared and private color labels; Q17: undo history cleared at the update; Q15: people can be added by hand). Model §3.3/§3.4a, Dexie v2 §3.6, migration framework additions §3.7 step 9, "As built" in §5.8. The name banner shows only once there are units. Settings → People. A slice of M7 came early: the detail panel's Ratings section sets stars and flags (per person); notes, reasons and labels stay in M7. |
| 2026-10-18 | M5, owner review: **Q15 decided**: per-person ratings in a new **M6 People** (§5.8), household sync through a shared cloud-drive folder right after Phase 1 (§9); Q1 superseded. Later milestones renumbered: old M6–M13 are now **M7–M14** (older log entries keep the numbers they had). |
| 2026-10-17 | M5: backup (JSON) and restore in Settings (`#/settings/backup`, `#/settings/storage`, gear in the top bar), backup reminder banner, safety copies (snapshots with a reason, 3 kept per kind, downloadable and restorable), persistent storage request, and the pre-update backup screen (§3.7 step 7). Last backup time and the reminder's "Later" live in `meta` per browser, not in Settings (§5.5 "As built"). Backups with photos stay in M11. No data-format change. Owner review: Clear all data goes in M13 (Q14); Q15 opened (several people using the app together). |
| 2026-10-15 | First draft for approval |
| 2026-10-15 | Draft 2: direction C chosen; Q1–Q10 decided; lease length; base maps and pin options; fast data entry and AI import (§5.7); milestones revised to M0–M13; GitHub repo from M0; Q11 opened |
| 2026-10-15 | M0: deploys use the `gh-pages` branch (live at the root, preview in `preview/`) instead of the GitHub Actions Pages artifact, because the Actions method can only serve one build at a time; Pages source must be set once to "Deploy from a branch" (README). TypeScript pinned to 6.0 (see §1). Only dependencies needed for the empty shell are installed; Zustand, Radix, Dexie and the rest arrive with the milestone that first uses them |
| 2026-10-15 | Draft 3: Q11 decided (fast entry in Phase 1); workflow, versions and backups (§13) and progress tracking (§14) added; `CLAUDE.md` added; preview builds isolated from real data; backup download before migrations |
| 2026-10-15 | M1: undo/redo stacks derived from the change log instead of stored (§5.6); writes outside a command are refused, with `systemWrite` for restore and tests; sample data is generated by `src/dev/sampleData.ts` (deterministic, always valid against the model) instead of `public/sample-data.json`; the data check page (`#/debug`) exists on every build but sample data and test changes only on preview/dev; the debug page loads on demand so the first download stays small; the pre-migration backup prompt is built in M5, before any v2; listing/destination/collection/note/photo/import schemas share `model/records.ts`. Workflow: `package.json` version is set per milestone (`0.N.0` on the branch); the owner creates tags and deletes merged branches on GitHub (this setup's GitHub access gets HTTP 403 for those) |
| 2026-10-15 | Workflow: the next-chat prompt carries a `Model:` line (default Claude Opus 5.5); each chat checks it against its own model and, on approval, checks the owner's tag and branch cleanup (`CLAUDE.md`) |
| 2026-10-17 | M4, owner review: owner's wishes for history and undo recorded for M6 (§5.6 owner notes; §9 M6 row) |
| 2026-10-17 | M4, owner review: **Delete unit** and **Delete building** (Q13); confirmations can carry an Undo button (`undoAction` undoes one action only while it's the latest); `deleteUnit` and `deleteBuilding` return their action id |
| 2026-10-16 | M4: Quick-add (`#/add`, `N`, top-bar Add), listing links, pasted listing text, building and unit matching with the duplicate banner, Place on map, "Add unit here", and **Paste text** on a unit. Geocoder lookups that answer with a different street address are ignored (§5.1 "As built"). Quick-add's text box and chips: rent, beds, baths, unit, plan and address go in their boxes; other details are chips (§5.7). A price without a link is kept on a listing with no link (shown as "No link") so price history starts at the first price. Section actions in the detail panels sit beside their heading instead of inside it (a heading's name is just its title). Confirmations after an action ("Unit 1504 at Riverlight added.") show briefly at the bottom left; toasts with Undo replace them in M6. No data-format change: everything fits model v1 (`imports`, `fieldSources`, `geocodeCache`). |
| 2026-10-16 | M3, owner review 4 follow-up: the larger photo is the map's top layer (no pin or marker over it), shows only the photo and the unit's name (280 × 200 px), and single units' photo pins show it too. |
| 2026-10-16 | M3, owner review 4: one card per open building instead of fanned plates and trays (rows per unit, header with marker, name, count and close; a visible line to the marker; larger photo preview on hover); cards never cover cards, pins, markers or dots and lines never cross, going off screen if need be; cards keep their spot while free; plates that would cover a dot shrink to dots; a Pin size slider (70–130%). §4.3 "As built", DESIGN §2.4, §4.7. |
| 2026-10-16 | M3, owner review 3: trays around each open building (frosted fill, outline, solid leader lines in a band) with colors per base map; layout keeps trays apart, reserves open centers, keeps lines off other trays, lines and centers when there's any room, and scores spots by distance plus turning; opening a fan pans just enough to show its tray |
| 2026-10-16 | M3: list keys keep up when pressed faster than the screen updates (the move handler continues from its last move instead of the last rendered selection); found as a CI-only failure once the map made renders heavier. A pin that disappears under the pointer (clicking a building swaps it for its fan) now lets go of the hover, so its card doesn't stay highlighted |
| 2026-10-16 | M3, owner review 2: fan plates placed in free spots around their building from measured sizes (no overlaps with plates, controls or legend), growing away from other open fans; automatic fans only where every unit fits on screen; pointing at a fan dims the others; hover previews a dot without re-laying out (fixes a flicker); Pins panel edits the view the list shows (no view switch); "New" confirmed as status New ("not reviewed yet"); aerial at 2× resolution; optional sharper OpenStreetMap/Cycle tiles (off by default) |
| 2026-10-15 | M3, owner review: pin options reworked (§4.3 "As built"): a Pins panel separate from Map layers; pin style plus combinable fields with greyed-out incompatible ones; per-view settings remembered per database in `localStorage` instead of `Settings.map` (owner agreed: keeps them out of Undo, no data-format change; not in backups); grouped pins summarize all units (ranges, stripes per unit, shared type icon, New if any); New badge as a tag by default; rejected Show/Fade/Hide; bubbles and dots as separate options honored at every zoom (bubbles used to ignore the dots option); several fans at once with fold, Collapse all and `Esc`, automatic fan-out from zoom 15 where there's room; two-way hover; base-map keys; legend also in the Pins panel. Clickable overlay features are planned with the Phase 2 overlays |
| 2026-10-15 | M3: the map. Pins, fan-out, neighborhood bubbles, dots when crowded, list ↔ map selection and hover, the Map layers panel (`L`), legend, Google Maps and Street View links. Zoom thresholds: bubbles at ≤ 10, all dots below 11, overlap-based above (§4.3). Total cost and cost per ft² pin options are disabled until M8 and pins show rent (extends the M2 rule); the price color is labeled *Rent* until then. Default pin extras corrected to DESIGN §4.7 (type icon and stars off, New badge on); only the built-in default changed, no stored data. Map choices are saved through `updateSettings`, so each one is an undoable change. Map viewport remembered per database in `localStorage`. The Wayfinding style is OpenFreeMap Positron recolored at load from the `--map-*` tokens (light and dark), with road shields hidden; unknown layers keep their colors. Aerial uses MnGeo `wmsll` (see §10). Browser tests answer all map-server requests locally (`tests/e2e/fixtures.ts`). Accessibility: each pin's name starts with its visible text (WCAG 2.5.3), and MapLibre's canvas landmark is named "Map view…" so it doesn't duplicate the Map region. MapLibre loads on demand (≈ 290 kB gzip); the first download is unchanged at ≈ 177 kB |
| 2026-10-15 | M2: selection lives only in the URL (`#/unit/:id`, `#/building/:id`) rather than also in Zustand, so Back closes the panel and nothing can drift; Zustand holds view, search and sort, and the view and sorts are remembered in `localStorage` per database name (preview never changes the live app's choices). The list keys `/`, `↑↓`/`J K`, `Esc` and `B` are built now; the other shortcuts stay in M6. Until total cost exists (M8), rent is the headline number on cards and the detail plate, and the sorts are rent, available date, size, bedrooms, bathrooms, floor, rating, listing age, date added, status and building (total and $/ft² join in M8); buildings sort by lowest rent, name, number of your units or date added. Search sits in the top bar at every width (on phones the app name is visually hidden to make room). Rejected cards are dimmed by switching their text to slate and fading the thumbnail, not 50% opacity on the whole card, so text keeps AA contrast; new `--pick-ink`/`--reject-ink` tokens do the same for flag text on `--frost`. Buildings with none of your units are left out of the Buildings view (still reachable by link). TanStack Virtual is deferred to the M13 performance pass (a plain list is fine at current sizes) and Radix isn't needed yet (native select). Cards no longer show a separate amber "New" badge beside the "New" status pill (owner feedback: redundant). The main screen now loads Dexie and zod up front: first download ≈ 175 kB gzip (was ≈ 100 kB plus a 66 kB Data check chunk); revisit in M13 |

---

## 13. Workflow, versions and backups

The full working agreement for every session is in `CLAUDE.md`; this is the summary.

**One chat per milestone.** Each milestone gets a fresh conversation, started with the short prompt in `CLAUDE.md`. Fixes and follow-ups for that milestone stay in its chat. The repository, not chat history, is the record: everything a later chat needs is in `PLAN.md`, `DESIGN.md`, `CLAUDE.md` and the code.

**Branches and versions**

| Where | What it is | Your data |
| --- | --- | --- |
| `main` branch → `https://<you>.github.io/rental-tracker/` | The approved app you use | Your real database |
| milestone branch, e.g. `m3-map` → `…/rental-tracker/preview/` | The milestone waiting for your OK | A separate preview database with sample data |
| tags `v0.1.0`, `v0.2.0`, … | One per approved milestone (`v0.<n>.0` for M<n>); fixes are `v0.<n>.1`, … | — |

1. I build each milestone on its own branch and deploy it to the preview link.
2. You try the preview. Fix requests go in the same chat; I update the branch.
3. When you say it's approved, I merge it into `main` (the live app updates within a few minutes), tag the version, and record it in §14.
4. Nothing reaches the live app without your approval, and every approved version can be restored from its tag.

**Changing the plan.** Ask in any milestone chat. I update `PLAN.md` (the decision in §11, the change log in §12, and any affected milestones in §9) on that milestone's branch, so the change is versioned with the code and the next chat sees it.

**Undoing a release.** Tell a chat "roll the live app back to v0.N.0". If the bad version changed the data format (every milestone report says whether it does), restoring also means restoring the backup file the app asked you to download before updating (§3.7). Otherwise your data is untouched.

**Your rental data** is separate from the code: it lives in your browser and is protected by the app's own backups (M5). Before approving any milestone marked "changes data format", download a backup.

---

## 14. Progress

| Milestone | Status | Version | Approved |
| --- | --- | --- | --- |
| Planning (PLAN, DESIGN, mockups) | Approved | — | 2026-10-15 |
| M0 Scaffold and deploys | Approved (fix v0.0.1) | v0.0.1 | 2026-10-15 |
| M1 Data model, database, undo | Approved | v0.1.0 | 2026-10-15 |
| M2 List and detail | Approved | v0.2.0 | 2026-10-15 |
| M3 Map, pins, layers | Approved | v0.3.0 | 2026-10-16 |
| M4 Quick-add and paste text | Approved | v0.4.0 | 2026-10-17 |
| M5 Backup and restore | Approved | v0.5.0 | 2026-10-18 |
| M6 People and per-person ratings | Approved | v0.6.0 | 2026-10-18 |
| M7 Triage and bulk edit | Approved | v0.7.0 | 2026-10-18 |
| M8 Forms and research mode | Approved | v0.8.0 | 2026-10-19 |
| M9 Cost profile and lease length | In review | 0.9.0 (preview) | — |
| M10 Collections, filters, compare | Not started | — | — |
| M11 Batch add and AI import | Not started | — | — |
| M12 Photo archive | Not started | — | — |
| M13 Duplicates and merge | Not started | — | — |
| M14 Phone, PWA, acceptance | Not started | — | — |

### Session log

Newest first. Each milestone chat adds one entry when the milestone is approved: what was built, known issues, whether the data format changed, and notes for the next milestone.

- **2026-10-19 · M8 Forms and research mode (v0.8.0).** Built: **full unit and building forms** (`ui/edit/`; `#/unit/:id/edit`, `#/new-unit?from=|building=`, `#/building/:id/edit`, lazy-loaded): one scrolling page per record, sticky section nav with ● ◐ ○ dots, side column (building summary, completeness meter, essentials), every §3 field with unknown states, exposure picker, windows editor, utilities (Included · Extra $ · You pay with the cost profile's estimate as a hint, `domain/cost.ts` `profileEstimate`), monthly fees, rent by lease length, move-in special, lease terms, the lease you'd sign, status and shared label, links, sources, and **listings with price-history editing**. Edits are a draft; Save (⌘S) is **one action** (`commands/forms.ts` `saveUnitForm`, `saveBuildingForm`, `updateBuildings`), described field by field in History (building fields named; utilities and specials said whole; sources quiet). Typed rent becomes today's price on the newest listing; an edited price history moves the rent (`domain/unitForm.ts` `reconcileRent`). Hand-typed values drop their `fieldSources`. **Research mode**: ⌘/Ctrl+↓/↑ to the next/previous field still to research (`RESEARCH_FIELDS`), `?` marks unknown and moves on, Y/N on yes/no fields, `E` opens the form. **Completeness and essentials** (`domain/completeness.ts`: ~60 checks with "applies" rules) with **Settings → Essential fields**; the unit panel shows "Essentials N of M" with *Add …* prompts and **Ready to compare** (Q28: on every unit until Shortlist mode). **Copy from** / **New unit from Plan C** (`domain/copyFrom.ts`). **Edit together for buildings** (Q23: ⌘/Ctrl- and Shift-click building cards and pins in the Buildings view). Owner review: **data format v3** with **standalone homes** (Q30: "Part of a larger building or complex", default by unit type, `building.standalone`; the home's facts in the unit form, saved in the same step; Home cards; Building menu lists only shared buildings) and **remembered unknowns** (Q29: `checkedUnknown` on units and buildings, counted as done); **complex names** behind "This complex has several buildings" (Q31; shown "North Tower · Cedar Mill"); example text "e.g. …"; going between a unit's form and its building's replaces the form instead of stacking (`ui/edit/FormLink.tsx`); a multi-step update takes one safety copy. Tests: 451 unit/db/component (`tests/unit/forms.test.ts`, `migrationV3.test.ts`, `tests/db/forms.test.ts`, `upgradeV3.test.ts`, `tests/components/Forms.test.tsx`), 176 Playwright passing (+18 phone skips; `forms.spec.ts` fills a unit completely by keyboard; `review8.spec.ts` updates a real v0.7 database through the backup screen; axe light/dark on both forms and Settings → Essential fields). Known issues: none open; component tests that reopen a form after saving must render afresh (`cleanup()` + render), as `router.navigate` back into the same form can race the previous one's unmount. Data format changed: **yes (v2 → v3)**, fields added only, undo history kept. *Notes for M9 (cost profile and lease length):* `domain/cost.ts` has `profileEstimate` (scaling by size or bedrooms); build `totalMonthly`/breakdown there (§5.3). `unit.costOverrides` has no editor yet: M9's breakdown is the natural place. The form's utilities and parking already hold what the total needs; `plannedLeaseMonths` is edited in the form (Lease, "Lease you'd sign"); `rentByTerm` is edited too. Pet rent lives on the building (`pets.monthlyRent`) and counts when Settings says you have pets. Pins and sorts still show rent where M9 brings total and $/ft² (`domain/pins.ts`, `domain/sort.ts`, Pins panel's disabled options). Essentials keys are stable strings (`CHECKS` keys); add a check only with a new key. GitHub runners queued ~10 minutes on Oct 19 (Ubuntu image migration); `gh run watch` in a foreground command can hit the 10-minute limit, so poll with `gh run list` instead.

- **2026-10-18 · M7 Triage and bulk edit (v0.7.0).** Built: triage (`commands/triage.ts`: `updateUnits` with partial utilities/parking/storage, `setStatus`, `setSharedLabel`, `rejectUnits` with saved + new reasons and a note, `updateNote`/`deleteNote`, label names and reasons; `setOpinion` now records "last reviewed" and skips no-op changes). UI (`ui/triage/`): marker controls in the unit panel and a selection bar (Pick/Reject…/No flag, stars, your label, shared label, status; "Mixed"), Reject dialog, notes log (units and buildings; edit/delete your own), Ratings rows with editable flag/rating notes and Reasons, **Edit together** (Q20 fields, one undo step), multi-select (⌘/Ctrl- and Shift-click in the list; ⌘/Ctrl-click pins, card rows and a card's building name on the map), keys P X U 0–5 6–9 ⇧6–9 ⏎ ⌘Z ⇧⌘Z ? (`hooks/useListKeys.ts`, labels by `e.code`; later keys say their milestone), shortcut sheet. **Toasts** after every action (`state/toasts.ts`) with Undo / Redo, worded from the change log. **History** (`domain/history.ts` descriptions; `commands/history.ts` Undo this with clash check, Restore to here, Deleted list with Restore; `ui/history/HistoryPanel.tsx`, `#/history`, clock in the top bar). Settings → **Labels and reasons**; the Data check page became Settings → **Data** (`#/debug` redirects). Cards show your private label as a ringed dot beside the shared square; pins color by shared or your label. Owner review: map multi-select and highlighting, hover fades every other pin and card, building ⌘-click no longer opens a tab (Q23, building multi-select → M8), History search → M14 (Q24), Settings → Data (Q25). Decisions Q19–Q27. Tests: 395 unit/db/component (history descriptions, Undo this clashes incl. nested values, Restore to here state equality, deleted list, toasts, pins by your label), 156 Playwright passing (+14 phone skips; `triage.spec.ts`, map multi-select, axe light/dark with dialogs and History). Known issues: faded pins and cards are below text contrast while something is pointed at (axe tests check the resting state); sample notes can sort above a just-added note (sample timestamps are later than now). Data format changed: **no**. *Notes for M8 (forms):* the bulk editor's field editors (`ui/triage/BulkEditDialog.tsx`) are the seed of the form's editors (Leave as is / Unknown / values; `parseMonths` in `domain/triage.ts`); single-unit editing waits for the form (owner); add **Edit together for buildings** with the building form (Q23: ⌘/Ctrl-click building cards in the Buildings view, currently a notice in `ui/list/BuildingCard.tsx` and `MapView.tsx` `pickUnits`); `E` currently shows "arrives in M8" (`ui/triage/shortcuts.ts` `LATER_KEYS`); every form save should be one `action()` so History and toasts describe it field by field (`UNIT_FIELDS` in `domain/history.ts` names unit fields; add building field names there too). Workspace: the full e2e suite takes ~9 min with `--workers=2`; run it in the background and poll; never `kill` by a pattern that matches your own command line (`[p]laywright` matched the shell and killed it); map card rows can sit under the detail panel at 1440 px, so tests click them with `dispatchEvent`.

- **2026-10-18 · M6 People and per-person ratings (v0.6.0).** Built: **data format v2**, the first real migration (`db/migrations/v2.ts`, frozen `tests/fixtures/backup-v2.json`): `people` and `opinions` tables; rating, rating note, flag, flag note, reject reasons and "last reviewed" move off units into one opinion per unit and person (`id = personId:unitId`); notes get `authorId`; `externalRatings` become people; the unit's color label stays as the **shared** label and opinions carry a **private** one (Q16, stored only). The migration framework gained multi-table `transform`, `clearsHistory` (the update clears undo history after its snapshot, Q17) and `createsMe`. **Me** is per browser (`meta.meId`, `db/me.ts` `ensureMe`, called from `main.tsx`); backups carry `exportedBy` and snapshots `meId`, and restore decides who "me" is (`domain/people.ts` `resolveMe`; old v1 files' ratings become yours). Commands (`commands/people.ts`): `addPerson`, `updatePerson`, `removePerson` (with their opinions, undoable), `setOpinion` (several units, one undo step). UI: list cards, pins and sort use **your** opinion, with everyone else in **one fixed-size chip** on cards (up to 3 badges +N, star range, pick/reject counts; owner review); the detail panel's **Ratings** section lists everyone with editable stars and flag (a slice of M7); notes by others name their author; **Settings → People** (your name and color, add/rename/recolor/remove others with Undo); a frost banner asks once for your name, only when there are units and no backup reminder is showing (one banner at a time; two lines on phones). Pin field and sort option are called **Your rating**. *Load sample data* adds a roommate (Alex) and only the sample buildings you don't have (owner found three copies of The Larkin). Data check counts people and opinions. Owner decisions: Q16, Q17, Q15 (people can be added by hand), **Q18 custom colors** (Colors editor in M14: presets first, display colors per person, badge colors shared, custom private/shared labels named after the nearest color; full themes after Phase 1). Tests: 367 unit/db/component (migration v1→v2 on data and on a real v1 database, restore "me" cases, opinions, people, sample data never duplicating, others chip), 141 Playwright passing (+9 phone skips), including `people.spec.ts`, which builds a v0.5 database before the app opens it and goes through the pre-update backup. Checked by hand on a copy of the published v0.5 site (preview and live, laptop and phone): ratings carried over, update screen shown, live variant identical. Known issues: none open; two older flaky tests were fixed (the font test now waits for the app to render, since rendering waits for the database; the Data check test waits for the counts). Data format changed: **yes (v1 → v2)**. *Notes for M7 (Triage):* everything per person goes through `setOpinion(db, unitIds, personId, changes, label)` with `personId = data.me.id` (from `useDataset`); `row.mine` is your opinion. Private labels: `opinion.colorLabel`, names in `person.labelNames`; shared: `unit.colorLabel`, names in `settings.labelNames`; proposed keys 6–9 private, ⇧6–9 shared (DESIGN §2.3), and decide with the owner how cards/pins show the private one and what "color by label" uses. Reject reason dialog writes `rejectReasonIds` on the opinion (`setOpinion` clears reasons when un-rejecting). The Ratings section (`ui/detail/Ratings.tsx`) is where flag/rating notes become editable. Owner history/undo wishes are in §5.6 (M7); undo entries before v0.6 are gone by design. `onAction` (commands/action.ts) and `Notice` are the seeds of toasts. Component tests: seed people with `ensureMe` + `addPerson`; `db.people.toArray()` comes back in id order, so sort before comparing. Workspace: the e2e suite takes ~7 min with `--workers=2` (run it in the background; foreground commands stop at 10 min); kill leftover `vite preview` servers before a run, or Playwright reuses an old build.

- **2026-10-18 · M5 Backup and restore (v0.5.0).** Built: **Settings** (`#/settings/backup`, `#/settings/storage`, gear in the top bar; `ui/settings/`, loaded on demand). **Back up data** (`services/backup/exportJson.ts`): every data table in one read transaction, deleted records included, API keys blanked, indented JSON, `rental-tracker-backup-<date>.json` (preview: `rental-tracker-preview-…`). **Restore from file** (`services/backup/restore.ts`): envelope → migration chain → zod validation of every record → duplicate ids → review (what the file holds vs. what's here, *Download what's here first*) → one `systemWrite` transaction that snapshots, replaces, keeps this browser's API keys and clears the change log. **Safety copies**: snapshots carry a `reason` (`migration`/`restore`), 3 kept per kind, downloadable and restorable. **Reminder banner** (`ui/shell/BackupBanner.tsx`): never backed up or older than the interval (1/3/7/14/30 days, an undoable setting); *Later* = 24 h. Last backup time and snooze live in `meta` (`db/meta.ts`), per browser, never in backups or Undo. **Persistent storage** asked once after the first change (`services/storage.ts`, `meta.persistAskedAt`); Settings → Storage shows usage and can ask again. **Pre-update backup screen** (`db/upgradeCheck.ts`, `ui/shell/UpgradeGate.tsx`, `main.tsx`): before Dexie opens, a stored version older than `SCHEMA_VERSION` with data shows "This update changes how your data is stored" and offers the old-format backup. Owner review: Clear all data goes in M14 (Q14); **Q15 decided**: per-person ratings in a new **M6 People** (§5.8) and household sync through a shared cloud folder after Phase 1 (§9); later milestones renumbered M7–M14. Tests: 340 unit/db/component (incl. a fast-check "nothing lost" round trip on random command sequences, the pre-update check against a throwaway v2), 129 Playwright passing (+9 phone skips; backup → restore between two browser profiles, safety copies, reminder, axe light/dark, live variant backs up and restores under the live name). Known issues: the pre-update screen has only run against a test v2 (M6 brings the first real one); the shell font test failed once under a parallel full run and passed 10/10 alone, like the M2 data-check flake; workflow logs can't be downloaded from the workspace (HTTP 403), but `gh api repos/<owner>/<repo>/check-runs/<job id>/annotations` shows failing tests. Data format changed: no. *Notes for M6 (People):* confirm §5.8 with the owner first (which fields are per person; whether color labels are personal). It's **the first data-format change**: add `db/migrations/v2.ts` (pure transforms), `versions.ts` entry with the `opinions` and `people` stores, `SCHEMA_VERSION = 2`, a frozen `tests/fixtures/backup-v2.json`, keep `backup-v1.json` and check it migrates, and check the pre-update screen by hand on the preview (load sample data on the live v0.5.0 build is impossible, so test with a v1 preview database: deploy order matters, the preview database must hold v1 data before the v2 preview loads). Restore runs the same chain for old files. `checkBackup` names the first three invalid records; keep it that way for v2. Undo entries from v1 hold v1-shaped records: the migration must also transform or clear the change log (clearing after the snapshot is simplest; say so to the owner). Sample data (`dev/sampleData.ts`) should add a second person with ratings on preview builds. CI runs in UTC; component tests must wait for live queries (`waitFor`) rather than read the first render.

- **2026-10-17 · M4 Quick-add and paste text (v0.4.0).** Built: **Quick-add** (`#/add`, `N`, top-bar **Add unit**, full screen on phones; `ui/add/`): listing link with site recognition and address/name/unit hints from the link (`domain/listingUrl.ts`, canonical links for duplicate checks); address combobox with your own buildings first, then Photon suggestions (`services/geocode/`: Photon while typing, one Nominatim lookup on submit, 30-day `geocodeCache`, 1.1 s rate limit, offline → saved as *Needs location*; a lookup answering a different street address is ignored); unit or floor plan, rent ("from"), beds, baths; **paste listing text** (`domain/listingText.ts`, ~30 kinds of fact, first mention wins, several-unit pages give "from" rent only) with boxes filled and other details as chips; building match (`domain/address.ts` normalization, `domain/dedupe.ts`: same address, or 25 m + similar name) and the **duplicate banner** (same link or same unit number → adds the listing/today's price to the unit you have); ⏎ / ⇧⏎ *Add another here* / *Add and open*. Commands (`commands/quickAdd.ts`, one undo step each): `quickAdd` (building, unit, listing with first price, pasted text as an `imports` record, `fieldSources` per value), `addToUnit`, `placeBuilding`. **Paste text** on a unit (new details on, changes off with "yours: …"). **Place on map** (plate button and map note; click, or *Place at the center* by keyboard; Esc cancels). **Add unit here** on buildings. Owner review: **Delete unit… / Delete building…** at the end of the panels with an inline confirm and a confirmation carrying **Undo** (`undoAction`; Q13). Bottom-left confirmations (`ui/shell/Notice.tsx`) until M6's toasts. Tests: 298 unit/db/component (listing-text fixtures for Zillow, Apartments.com, RentCafe, Entrata, Craigslist in `tests/fixtures/listing-text/`; geocoder fixtures in `tests/fixtures/geocode/`), 105 Playwright passing (+9 phone skips; geocoders answered locally by `geoNet` in `tests/e2e/fixtures.ts`; live variant adds a unit and reloads). Known issues: real Photon/Nominatim and real listing pages can't be reached from the workspace (owner checked on the preview: works); parsing will need new fixtures as real pages are misread; pasted values' sources are recorded but not yet shown (M7/M10); the Data check e2e test failed once in a full run and passed 10/10 on repeat (same flake as noted in M2). Data format changed: no. *Notes for M5:* the owner can now enter real units, so backup/restore is the priority; `imports` and `fieldSources` are data and belong in backups, `geocodeCache` is a cache and doesn't; `deleteUnit`/`deleteBuilding` soft-delete (records stay with `deletedAt`), so a backup round-trip must keep deleted records too (undo depends on them). *Notes for M6:* the owner's history and undo wishes are in §5.6 ("Owner notes for M6"): specific descriptions built from before/after records, **Restore to here**, **Undo this** for one action with a clash check, and a **Recently deleted** list; M6 may need splitting. `Notice` (`state/ui.ts` `showNotice(text, to, undo)`) is the seed of the toast system. Workspace tips: `git archive origin/gh-pages` + `python3 -m http.server` still the way to check deploys; kill servers by PID (`ps aux | grep "[p]attern"`); this clone only fetches `main`, so add a fetch refspec for a pushed branch or the stop hook reports it as unpushed.

- **2026-10-16 · M3 Map, pins, layers (v0.3.0).** Built: the map (`ui/map/`, lazy-loaded with a no-WebGL fallback) on MapLibre GL 6 via react-map-gl, following the list's search and Units/Buildings switch, with selection and hover synced both ways. Five base maps in a **Layers** panel (`L`): Wayfinding (OpenFreeMap Positron recolored from our tokens), Detailed streets (Liberty), OpenStreetMap, CyclOSM and MnGeo aerial photos, each with a key or a link to its publisher's key, a failure message per map, and *Sharper OpenStreetMap and Cycle maps* (off). A separate **Pins** panel, kept per view in `localStorage` (`<db>.mapPrefs`, out of Undo): style (sign plate, dot, photo), combinable fields, range or lowest rent, New badge (off, dot, tag), color by status, label or rent with a legend, rejected units show/fade/hide, bubbles, shrink to dots, automatic opening at street zoom, and a **Pin size** slider (70–130%). A building with several units shows one summary pin and opens **one card per building** (owner review 4, PLAN Q12, replacing fans and trays): rows per unit, header with marker, name (opens the building), count and ✕, a visible line to the marker; cards never cover cards, pins, markers or dots and lines never cross (`domain/pinLayout.ts`, measured sizes, off screen if need be, spots kept while free). Photo pins show a 280 × 200 larger photo on hover (top layer). Google Maps and Street View links in the detail panels. Owner reviews: four rounds (pin options rework; hover flicker and overlaps; trays; cards, preview and size). Tests: 174 unit/component (layout property tests with fast-check), 86 Playwright passing (+8 phone skips; laptop + phone, axe light/dark with panels and a card open, live variant). Known issues: map tile servers are blocked in the cloud workspace, so tests stub them and the owner checks the real maps; in crowded areas a card can sit a few hundred pixels from its building, and two very close buildings' cards can end up on opposite sides (lines pass each other but never cross); first download still has the Vite large-chunk warning (MapLibre is in its own lazy chunk), for M13. Data format changed: no. *Notes for M4:* quick-add creates buildings with `location` (`source`, `precision`); the map counts units without a location in a note and M4 adds "Place on map" (PLAN §4.3); Photon/Nominatim requests go through the browser and will be blocked in the workspace like tiles, so stub them in `tests/e2e/fixtures.ts` (`mapNet` shows how); new pins appear automatically from the dataset. The workspace can't reach github.io: check deploys by extracting `gh-pages` (`git fetch origin +refs/heads/gh-pages:refs/remotes/origin/gh-pages`, `git archive origin/gh-pages | tar -x -C site/rental-tracker`) and serving it with `python3 -m http.server`. Don't `pkill -f` a pattern that appears in the same command (it kills the shell); find the PID with `ps aux | grep "[p]attern"`. `tsc -b` writes `tsconfig.tsbuildinfo` (now ignored); use `npm run typecheck`.

- **2026-10-15 · M2 List and detail (v0.2.0).** Built: the unit list (`ui/list/`) with cards per DESIGN §4.1 (rent as the headline until M8; specs with `?` for unknowns; flag, status pill, color label, stars, floor-plan and "Needs location" tags, listing age); a Units/Buildings switch with building cards (neighborhood, type, rent range, "N of your units"); text search in the top bar over unit numbers, plans, building names, addresses, neighborhoods and notes (`domain/filter.ts`); sorting with unknowns always last in both directions (`domain/sort.ts`, fast-check property test), remembered per database in `localStorage`; read-only detail panels (`ui/detail/`): unit (plate header, markers, lease and fees, unit facts, windows compass, utilities, parking and storage, building amenities, listings with a price step chart, travel-times placeholder, notes, links) and building (facts, amenities, policies, contact, your units, notes, links). Selection is the URL (`#/unit/:id`, `#/building/:id`, child routes of `/`), so Back closes the panel; the detail column joins at ≥ 1280 px, overlays the map below that, and is the Unit tab on phones. List keys: `/`, `↑↓`/`J K`, `Esc`, `B` (`hooks/useListKeys.ts`). Data flows through `state/useDataset.ts` (one `useLiveQuery` over all tables) → `state/derive.ts` (pure joins, search, sort); Zustand (`state/ui.ts`) holds only view, search and sort. Owner fix during review: cards showed "New" twice (a separate badge plus the status pill); the badge is gone. Tests: 100 unit/db/component, 49 Playwright (laptop + phone, axe light/dark with a unit and a building open, live variant). Known issues: first download ≈ 175 kB gzip with a Vite "large chunk" warning (Dexie + zod now load up front), for M13; the M1 Data check undo/reload e2e test failed once locally and passed 40/40 on repeat, so watch it for flakiness. Data format changed: no. *Notes for M3:* the map reads the same `Dataset` (`useDataset`) and `ListView` as the list, so pins and cards stay in sync; select by navigating to `/unit/:id` or `/building/:id` (the list already scrolls the selected card into view); replace the map placeholder in `AppShell.tsx` (`data-panel="map"` section, region named "Map"); external Google Maps and Street View links belong in M3 (`domain/links.ts`), next to the existing listing and website links in the unit panel's Links section; pin colors use the status/label tokens and `STATUS_COLOR_VAR` in `domain/format.ts`; rejected units are already marked by `flag === 'reject'`. Use `localDate()` (`domain/format.ts`) for "today", never the UTC date. The workspace clone only fetches `main`: fetch `gh-pages` with `+gh-pages:refs/remotes/origin/gh-pages`, and add a fetch refspec for the milestone branch after pushing so git shows it tracked.

- **2026-10-15 · M1 Data model, database, undo (v0.1.0).** Built: zod schemas for every §3 record (`src/model/`, types inferred) plus factories that start every researched field unknown; Dexie v1 with the §3.6 tables (`src/db/`); a change-log middleware that records before/after of every write to a data table and refuses writes outside `action()` (exceptions: upgrade transactions and `systemWrite`); `action(label, fn)` and basic commands for buildings, units, listings, notes and settings (`src/commands/records.ts`), each validating with zod; undo/redo (`src/commands/undo.ts`) with stacks derived from the change log, so history survives reloads; retention (90 days / 10,000 entries, whole actions); a migration framework (`db/versions.ts`, `db/migrations/`) with pre-migration snapshots (last 3), a backup envelope schema and a frozen `tests/fixtures/backup-v1.json`; deterministic sample data (`src/dev/sampleData.ts`, 34 units in 10 buildings); and the Data check page (`#/debug`, lazy-loaded) with counts, history, Undo/Redo, and sample data/test changes on preview and dev builds only. Tests: 65 unit/db/component (incl. a fast-check property test: random command sequences undo back to the start and redo to the end) and 30 Playwright (laptop + phone, axe, live variant). Known issues: none. Toasts and keyboard undo are M6; the main list is still empty until M2; the first bundle is ~100 kB gzip, the Data check chunk ~66 kB (zod + Dexie), worth revisiting in M13. Data format changed: yes, introduced as version 1 (no real data existed). *Notes for M2:* read data with `useLiveQuery` from `dexie-react-hooks` against `db` (`src/db/db.ts`); filter out `deletedAt` records; every write must go through `commands/` (writes elsewhere throw `UntrackedWriteError`); sample data on the preview comes from the Data check page; Zustand is still to be added (first UI-only state). Set `package.json` to `0.2.0` on the branch. Dexie middleware must chain Dexie promises with `.then()`, not native `await`, or it loses the transaction (see `db/changeLog.ts`). The workspace can't open github.io; check deploys by serving the `gh-pages` branch locally (`git fetch --depth 1 origin gh-pages`, extract, `python3 -m http.server`, open `/rental-tracker/` and `/rental-tracker/preview/`).

- **2026-10-15 · M0 Scaffold and deploys (v0.0.0).** Built: Vite + React + TypeScript (strict) app with Direction C tokens (light/dark), empty app shell (list, map placeholder, phone tabs), non-live banner and build info, a separate `rental-tracker-preview` database name for every non-live build, Vitest and Playwright (laptop and phone, axe) tests, a Checks workflow, and a Deploy workflow (`main` to the Pages root, milestone branches to `preview/`, both on the `gh-pages` branch). Fixed after merge: the live deploy ran the tests with the live setting on and one test assumed a non-live build; tests now always run as a development build. **Fix v0.0.1:** the live app (no banner) squeezed the whole page into 56 px because the layout reserved a grid row for the banner; the app shell is now a flex column that doesn't depend on the banner, and Playwright also builds and tests the live variant (`tests/e2e/shell-live.spec.ts`, port 4174). *Lesson for every milestone:* check the live build too, not only the preview. This session's GitHub access refuses creating tags and deleting branches (HTTP 403), so the owner creates tags (`v0.0.0` done) and deletes merged branches on GitHub. Data format changed: no. *Notes for M1:* add Dexie, zod and Zustand then (not before); the database name comes from `src/config.ts` (`dbName`); run `npm run e2e` with `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` in the cloud workspace; push to `main` can fail once with a transient 403, so retry once.
- **2026-10-15 · Planning.** Spec reviewed; PLAN, DESIGN and three mockups made; direction C chosen; Q1–Q11 decided; layers panel and pin options added to mockup C. *Next:* M0. Before starting, the owner creates an empty **public** GitHub repository named `rental-tracker` (GitHub Pages is free only for public repositories; the repo holds code and docs, never rental data) and connects GitHub to Claude.
