# Rental Unit Tracker — Build Plan (Phase 1)

Status: **Draft 3** · Oct 15, 2026 · covers spec Draft v1 (`SPEC.md`)

This plan covers Phase 1 only (spec §12: "track and compare"). The data model, however, contains every field from spec §3 now, plus the few supporting fields later phases need, so Phases 2–4 add screens and services without reshaping stored data.

**Status:** approved in principle; Q11 answered (fast data entry is in Phase 1). M0 and M1 done. Next: M2. Workflow, versions and progress: §13–§14 and `CLAUDE.md`.

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
| Map | MapLibre GL JS via `react-map-gl/maplibre` | Same | |
| Map tiles (default) | **OpenFreeMap** (Positron restyled as "Wayfinding", light and dark) | Picks one | No key, no signup, no request limits. Style URL is a setting so a MapTiler key can be swapped in if OpenFreeMap is ever down. |
| Other base maps | OpenFreeMap Liberty; OpenStreetMap Standard and CyclOSM raster tiles; MnGeo aerial imagery (WMS) | Addition | All free and keyless. The raster servers are donation-funded, so the app loads only on-screen tiles, never caches them offline, and shows their attribution (see §4.3). |
| Pins | **HTML markers** (React) + `supercluster` for low-zoom groups | Addition | Pins can show photos, icons or text (your pin options). Only pins inside the visible map are mounted, which stays fast at 500 units. |
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
│  │  ├─ action.ts           action(label, fn): transaction + change log (+ toast in M6); systemWrite
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
│  ├─ state/                 ui.ts (Zustand), useDataset.ts (live queries + derive)
│  ├─ hooks/                 useKeyboardShortcuts.ts, useSelectionUrlSync.ts
│  ├─ ui/
│  │  ├─ shell/              AppShell, TopBar, ModeSwitch, Toasts, Banners
│  │  ├─ list/               UnitList, UnitCard, BuildingCard, ListToolbar
│  │  ├─ map/                MapView, UnitPins, BuildingPins, FanOut, MapControls
│  │  ├─ detail/             DetailPanel + sections (Header, Cost, Specs, Listings…)
│  │  ├─ add/                QuickAddDialog, AddressField, PlaceOnMap
│  │  ├─ edit/               UnitEditPage, BuildingEditPage, field components
│  │  ├─ triage/             FlagControl, Stars, ColorLabel, StatusSelect, RejectDialog
│  │  ├─ compare/            ComparePage, CompareTray
│  │  ├─ filters/            FilterPanel, FilterChips, SaveFilterDialog
│  │  ├─ photos/             PhotoStrip, Lightbox, DropZone
│  │  ├─ duplicates/         DuplicatesPage, MergeDialog
│  │  ├─ history/            HistoryPanel
│  │  ├─ debug/              DebugPage: data check (#/debug), M1
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
  // Status & review
  status: UnitStatus;
  rating: 0 | 1 | 2 | 3 | 4 | 5;
  ratingNote: Maybe<string>;
  flag: Flag;
  flagNote: Maybe<string>;
  rejectReasonIds: ID[];
  colorLabel: Maybe<LabelColor>;
  collectionIds: ID[];              // multi-entry index
  lastReviewedAt: Maybe<ISODateTime>;  // "date added" = createdAt
  addedVia: 'quick-add' | 'form' | 'ai-import' | 'backup' | 'share';
  externalRatings: { by: string; rating: number; note: Maybe<string> }[]; // Phase 3 merges (Q1)
  // Map (Phase 4)
  placement3d: Maybe<{ facadeBearingDeg: number; floor: number }>;
  // Media
  links: Link[];                    // listing links live in listings; photos in photos table
  fieldSources: FieldSource[];
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
```

### 3.7 Schema changes (migrations)

There are two places old data can come from — the browser's own database and old backup files — and both go through the same code.

1. `SCHEMA_VERSION` (an integer) lives in `model/index.ts`, equals the Dexie version, and is written into every backup and photo sidecar.
2. Each version bump adds `db/migrations/vN.ts` exporting pure functions, e.g. `upgradeUnit(v1Unit) → v2Unit`. They take plain objects, so they're trivial to test.
3. `db/versions.ts` declares `db.version(N).stores(...).upgrade(tx => …)`; the upgrade first copies the whole dataset into `snapshots`, then applies `migrations/vN` to each table.
4. Backup import runs the same chain: `v1 → v2 → … → current`, then validates against the current zod schemas. A backup from a *newer* app version is refused with a clear message instead of being half-imported.
5. Old migrations are never edited. Each one ships with a fixture backup (`tests/fixtures/backup-vN.json`) and a test that it migrates to the current version and passes validation. Fixtures are frozen: never regenerate an old one. The framework itself is tested with throwaway v2–v6 versions (`tests/db/versions.test.ts`).
6. Rule for the build: from Milestone 1 on, data is never wiped to change its shape. You can start entering real units at Milestone 4 and keep them through Phase 4.
7. **Before any migration runs on real data**, the app asks you to download a backup file first (built in M5 with backup export; no migration ships before then) ("This update changes how your data is stored. Download a backup before continuing."). That file is what makes rolling back to an older version possible, because an older version can't open a database a newer one has upgraded (§13).
8. **Preview builds use a separate database** (`rental-tracker-preview`) and show a "Preview" banner, so testing a milestone never touches your real data even though both live at the same web address.

---

## 4. Screens, components and state flow

### 4.1 Screens (Phase 1)

| Route | Screen | Main components |
| --- | --- | --- |
| `#/` | **Main**: list + map (+ detail when selected) | TopBar (search, filters, mode switch Explore/Shortlist, Units/Buildings view, Add, Undo), UnitList / BuildingList, MapView, DetailPanel, CompareTray, banners (backup due, reconnect photo folder) |
| `#/unit/:id` | Main with detail panel open | DetailPanel: header + markers, photos, cost + breakdown, specs, lease, utilities, building + amenities, listings + price history, notes log, links, history |
| `#/building/:id` | Main with building panel | BuildingPanel: building info, its units, "Add unit here" |
| dialog | **Quick-add** | AddressField (suggestions), ListingUrlField, "Paste listing text" box, unit #/plan, rent, beds, baths; duplicate match banner; "Place on map" fallback |
| map panel | **Map layers** | Base map picker (5), "Pins show" (9 options), extras, pin color, simplify, overlays section (Phase 2) |
| `#/building/:id/add` | **Batch add units** | Spreadsheet-style grid for many units in one building; accepts a pasted table |
| dialog | **AI research prompt** | Scope (unit, building, selection), which fields, copy button, tips |
| `#/import/:id` | **Import review** | Field-by-field diff for pasted AI JSON or listing text; accept/reject, source links, one undo step |
| `#/unit/:id/edit` | **Full unit form** | Section nav (Identity, Specs, Windows, Features, Lease, Costs, Parking & storage, Review, Photos, Listings, Sources), UnknownInput fields, completeness meter, building summary with "Edit building" |
| `#/building/:id/edit` | **Building form** | Identity, Structure, Amenities, Policies, Neighborhood, Links, Photos |
| `#/compare?ids=…` | **Compare table** | 2–6 unit columns, grouped field rows, differences highlighted, "hide identical rows" |
| `#/duplicates` | **Duplicate review** | candidate pairs with reason, MergeDialog (pick value per conflicting field) |
| `#/settings/:section` | **Settings** | Cost profile, Baseline criteria, Labels & reasons, Display (theme; map and pin defaults), Photo archive, Backup & restore, Storage, Keyboard shortcuts, (API keys — shown disabled, "Phase 2") |
| overlay | Lightbox | full-size original, zoom/pan, caption, delete |
| panel | History | change log for one unit, or everything; undo to here |
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
- A building with one visible unit draws as that unit's pin; with several, as a grouped pin (lead = cheapest non-rejected unit, plus a count). Clicking a grouped pin **fans out** its units on leader lines around the building; Esc or clicking elsewhere collapses it.
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

### 5.2 Duplicate detection (MVP)

- **Address normalization**: lowercase, strip punctuation, USPS street-suffix and directional abbreviations, move `Apt/Unit/#/Ste` into the unit part.
- **Same unit** = same building + same normalized unit number, or same listing URL. **Possible same building** = same normalized address, or within 25 m with a similar name. Floor-plan-only units are only suggested (same building + same plan name), never matched automatically.
- **On add**: a match shows a banner — "This looks like Unit 1504 at Riverlight, added Oct 2. Add this listing to it instead?" — default action adds a new Listing (and price observation) to the existing unit.
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

### 5.6 Undo and change history

- Every write goes through `action(label, fn)`. A **Dexie DBCore middleware** records `{actionId, table, key, before, after}` for every put/delete inside it, so nothing can be written without being undoable.
- Writes to data tables outside an action are refused (an error, not a silent unlogged write). Two exceptions: Dexie upgrade transactions (migrations) and `systemWrite(reason, fn)` for restore (M5) and test setup. Caches, thumbnails, the change log and `meta` aren't logged.
- **Undo** (⌘/Ctrl+Z) writes the `before` values of the last action in reverse order; **Redo** (⇧⌘/Ctrl+Shift+Z) re-applies `after`. Both are themselves recorded, so history stays linear and honest.
- The undo and redo stacks aren't stored separately: they're derived from the change log (do pushes, undo moves to redo, redo moves back; a new action clears redo). So they survive reloads and can't drift from the history.
- Toasts after every action carry an Undo button ("Flagged as reject · Undo"). Bulk actions (multi-select, merge, restore) are single actions.
- The **History panel** shows a unit's changes with time and field, and "Restore this version" for one record.
- The change log keeps 90 days or 10,000 entries (whichever is smaller), pruned after each action and only in whole actions; restores clear it after the snapshot.
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
| Paste listing text | On a listing page, select all, copy, and paste into Quick-add or a unit's "Paste text" box. A local parser recognizes about 30 patterns (rent, beds/baths, sq ft, available date, deposit and fees, lease terms, laundry, dishwasher, AC, parking price, pet policy and pet rent, which utilities are included, common amenities like fitness, rooftop, package lockers, skyway). Recognized values appear as chips you confirm (⏎ accepts all); the raw text is kept with the import. |
| Batch add (grid) | From a building: "Add several units" opens a spreadsheet-style grid (unit #, floor plan, beds, baths, sq ft, floor, rent, available). Paste a table copied from the building's availability page; columns are matched by their headers. Each row becomes a unit; the whole batch is one undo step. |
| Copy from | "New unit from Plan C" or "Copy details from Unit 908" copies specs, features, fees and utilities, never the unit number, floor, rent, windows, ratings or notes. |
| Bulk edit | Select several units, then "Edit together" to set any field for all of them (e.g. heat included for every Riverlight unit). Fields that differ show "Mixed". |
| Research mode | In Shortlist mode the detail panel lists missing essentials as one-click prompts. In the edit form, ⌘↓ / Ctrl+↓ jumps to the next empty field and `?` marks it unknown, so a unit can be completed without the mouse. |

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

---

## 6. Keyboard (Phase 1)

Shortcuts act on the selected unit (or all selected units). Full table in DESIGN.md.

`P` pick · `X` reject (opens reason dialog) · `U` unflag · `0`–`5` stars · `6` red · `7` yellow · `8` green · `9` blue · `↑/↓` or `J/K` previous/next unit · `Enter` open detail · `E` edit · `N` quick-add · `C` add to compare · `/` search · `F` filters · `L` map layers · `M` toggle Explore/Shortlist · `B` toggle units/buildings view · `R` copy research prompt · `⌘/Ctrl+Z` undo · `⇧⌘/Ctrl+Shift+Z` redo · `?` shortcut sheet · `Esc` close panel. In forms: `⌘/Ctrl+↓` next empty field, `?` mark unknown, `⌘/Ctrl+S` save. Disabled while typing in a field (except the form keys).

---

## 7. Phase 1 scope boundaries

In: everything in spec §12 Phase 1 and the MVP rows of §10 (total cost, price history, duplicate detection, undo, window directions, photo archive); plus base-map switching and pin options (§4.3), lease length (§5.3) and fast data entry with AI import (§5.7, Q11).
Stored but not shown yet: destinations, travel-time cache, crime, OSM id, 3D placement, monitoring dates, external ratings.
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
| Import parsing | Vitest | a fixture library of real-world shapes: AI replies with prose around the JSON, broken JSON, every value format; listing text copied from Zillow, Apartments.com, RentCafe and Entrata pages (saved as text fixtures); pasted availability tables. Each fixture has an expected change set. |
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
| **M3** | L | Map: Wayfinding style, HTML pins, building grouping + fan-out, low-zoom clusters, building view, list ↔ map selection sync, external links; **Map layers panel**: five base maps, all pin options, pin color, shrink-to-dots | Click pins and cards; try every pin style and base map |
| **M4** | L | Quick-add: Photon suggestions, Nominatim fallback, Place on map, listing URL recognition, **paste listing text**, building match, duplicate-on-add banner, listings + first price observation, "add another in this building" | **Add your real units.** Under 30 s each |
| **M5** | M | Backup export (JSON) and restore, persistent storage request, backup reminder banner, snapshots | Export, clear site data, restore; everything returns. **Safe to rely on from here.** |
| **M6** | M | Triage: flag, stars, color labels (named), status, reject reasons, rating/flag notes, notes log, multi-select, **bulk edit**, all keyboard shortcuts, toasts with Undo, History panel | Triage with the keyboard; undo anything |
| **M7** | L | Full unit and building forms (every §3 field, unknown states, windows editor, exposure picker, utilities, parking/storage, recurring fees, rent by term), essentials + completeness meter, **research mode**, **copy from unit / new unit from plan**, listings and price-history editing | Fill a unit completely by keyboard; see price history |
| **M8** | M | Cost profile in Settings, total monthly cost + breakdown, **lease length selector**, move-in cost, cost per sq ft, sort/filter by them | Change an electric estimate or lease length; totals update everywhere |
| **M9** | L | Collections, full filter panel, saved filters (smart collections), Inbox, Explore/Shortlist mode, baseline criteria dimming, compare table | Build a shortlist and compare it |
| **M10** | L | **Batch add grid** with table paste; **AI research prompts** (unit, building, selection); **import review** with tolerant parsing, matching, field-by-field accept, sources, one-step undo | Have an AI research a building; review and apply its reply |
| **M11** | L | Photo archive: folder picker, OPFS/IDB fallback, thumbnails, drag/drop/paste, lightbox, sidecar `unit.json`, renames, trash, archive size, keep-originals option, backup with photos (.zip); photo pins come alive | Drop listing photos; find them in your folder; switch pins to Photo |
| **M12** | M | Duplicate review page and merge | Merge a unit listed on two sites |
| **M13** | M | Phone layout polish, PWA install + offline viewing, 500/200 performance pass, accessibility pass, acceptance test, final README | Install on your phone; run the acceptance test |

Sizes are only for estimating time: S ≈ half an M, L ≈ twice an M, so the 14 milestones add up to about 20 "M-sized" units of work. M4 is where real use can start; M5 is where it becomes safe.

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
| MnGeo aerial service may not allow web-page access (CORS) or the web-map projection | No aerial base map | Checked first thing in M3; fallback is a keyed aerial layer, or drop it |
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
| Q1 | Shared rating (§13) vs. per-person ratings (§9) | One rating per unit (yours). Ratings in files imported from others are kept read-only in `externalRatings` and shown as "Alex: ★4"; they never change yours. Used from Phase 3. |
| Q2 | "Leased" status missing from §6 | Added **Leased** = you signed it, after Approved. "Rented by someone else" is Off market. |
| Q3 | Exposure: one direction or a list | A list; the first item is the main direction. |
| Q4 | Parking and storage listed twice | Only in the Parking & storage group; utilities are heat, electric, water/sewer, trash, gas, internet. |
| Q5 | Total monthly cost rules | One-time fees shown as a separate move-in cost, with an optional toggle (off) to spread them over the lease; specials shown as "effective rent", added to the total only if toggled; unknown utilities assumed tenant-paid and marked; parking spaces needed is a setting (default 1); a recurring-fees list is added. **Plus your addition:** a lease length to spread over, set as a default in Settings and per unit (§5.3). |
| Q6 | §4/§6 features not in §12 | Phase 1: Explore/Shortlist mode, baseline criteria (non-location), saved filters, Inbox. Weighted score: Phase 2. |
| Q7 | Phase 1 import | Restore replaces everything, after a snapshot. Merge import stays in Phase 3. |
| Q8 | Purple has no key | 6 red, 7 yellow, 8 green, 9 blue; purple from the menu. |
| Q9 | Where the app lives | GitHub Pages under your account; localhost for development only. |
| Q10 | Direct-sun estimate | Phase 4 with the sun slider; window directions captured from Phase 1. |

| Q11 | Fast data entry (§5.7) in Phase 1? | **Yes.** Paste listing text, batch add, AI research prompts and import review are in Phase 1 (M4, M10). |

### 11.2 Open

None. New questions will be added here as they come up.

**Assumptions I'll proceed with unless you object**

- US units throughout (sq ft, feet; default floor height 10 ft rather than 3 m).
- Neighborhood name in Phase 1 comes from the geocoder and is editable.
- Photos come in by drop, file picker or paste; nothing is downloaded from listing sites. AI replies may include photo links; they're saved as links, not downloaded.
- The §7 JSON example is illustrative. The AI-import format is generated from the internal zod schemas, so it matches the model rather than the example exactly (e.g. utilities as `{ "mode": "tenant-paid", "estimate": 45 }`).
- Full photo-folder support on desktop Chrome/Edge; OPFS fallback on Safari/Firefox. Flags, stars and status can be changed on the phone; full editing is laptop-first.
- Each friend runs their own copy in their own browser; there are no accounts.
- Settings and the Map layers panel show Phase 2 items (API keys, overlays) disabled, so the layout doesn't change later.
- The base-map and pin options (§4.3) are in Phase 1 because they're display choices over data Phase 1 already has; overlays that need new data stay in Phase 2.

---

## 12. Change log

| Date | Change |
| --- | --- |
| 2026-10-15 | First draft for approval |
| 2026-10-15 | Draft 2: direction C chosen; Q1–Q10 decided; lease length; base maps and pin options; fast data entry and AI import (§5.7); milestones revised to M0–M13; GitHub repo from M0; Q11 opened |
| 2026-10-15 | M0: deploys use the `gh-pages` branch (live at the root, preview in `preview/`) instead of the GitHub Actions Pages artifact, because the Actions method can only serve one build at a time; Pages source must be set once to "Deploy from a branch" (README). TypeScript pinned to 6.0 (see §1). Only dependencies needed for the empty shell are installed; Zustand, Radix, Dexie and the rest arrive with the milestone that first uses them |
| 2026-10-15 | Draft 3: Q11 decided (fast entry in Phase 1); workflow, versions and backups (§13) and progress tracking (§14) added; `CLAUDE.md` added; preview builds isolated from real data; backup download before migrations |
| 2026-10-15 | M1: undo/redo stacks derived from the change log instead of stored (§5.6); writes outside a command are refused, with `systemWrite` for restore and tests; sample data is generated by `src/dev/sampleData.ts` (deterministic, always valid against the model) instead of `public/sample-data.json`; the data check page (`#/debug`) exists on every build but sample data and test changes only on preview/dev; the debug page loads on demand so the first download stays small; the pre-migration backup prompt is built in M5, before any v2; listing/destination/collection/note/photo/import schemas share `model/records.ts`. Workflow: `package.json` version is set per milestone (`0.N.0` on the branch); the owner creates tags and deletes merged branches on GitHub (this setup's GitHub access gets HTTP 403 for those) |

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
| M2 List and detail | Not started | — | — |
| M3 Map, pins, layers | Not started | — | — |
| M4 Quick-add and paste text | Not started | — | — |
| M5 Backup and restore | Not started | — | — |
| M6 Triage and bulk edit | Not started | — | — |
| M7 Forms and research mode | Not started | — | — |
| M8 Cost profile and lease length | Not started | — | — |
| M9 Collections, filters, compare | Not started | — | — |
| M10 Batch add and AI import | Not started | — | — |
| M11 Photo archive | Not started | — | — |
| M12 Duplicates and merge | Not started | — | — |
| M13 Phone, PWA, acceptance | Not started | — | — |

### Session log

Newest first. Each milestone chat adds one entry when the milestone is approved: what was built, known issues, whether the data format changed, and notes for the next milestone.

- **2026-10-15 · M1 Data model, database, undo (v0.1.0).** Built: zod schemas for every §3 record (`src/model/`, types inferred) plus factories that start every researched field unknown; Dexie v1 with the §3.6 tables (`src/db/`); a change-log middleware that records before/after of every write to a data table and refuses writes outside `action()` (exceptions: upgrade transactions and `systemWrite`); `action(label, fn)` and basic commands for buildings, units, listings, notes and settings (`src/commands/records.ts`), each validating with zod; undo/redo (`src/commands/undo.ts`) with stacks derived from the change log, so history survives reloads; retention (90 days / 10,000 entries, whole actions); a migration framework (`db/versions.ts`, `db/migrations/`) with pre-migration snapshots (last 3), a backup envelope schema and a frozen `tests/fixtures/backup-v1.json`; deterministic sample data (`src/dev/sampleData.ts`, 34 units in 10 buildings); and the Data check page (`#/debug`, lazy-loaded) with counts, history, Undo/Redo, and sample data/test changes on preview and dev builds only. Tests: 65 unit/db/component (incl. a fast-check property test: random command sequences undo back to the start and redo to the end) and 30 Playwright (laptop + phone, axe, live variant). Known issues: none. Toasts and keyboard undo are M6; the main list is still empty until M2; the first bundle is ~100 kB gzip, the Data check chunk ~66 kB (zod + Dexie), worth revisiting in M13. Data format changed: yes, introduced as version 1 (no real data existed). *Notes for M2:* read data with `useLiveQuery` from `dexie-react-hooks` against `db` (`src/db/db.ts`); filter out `deletedAt` records; every write must go through `commands/` (writes elsewhere throw `UntrackedWriteError`); sample data on the preview comes from the Data check page; Zustand is still to be added (first UI-only state). Set `package.json` to `0.2.0` on the branch. Dexie middleware must chain Dexie promises with `.then()`, not native `await`, or it loses the transaction (see `db/changeLog.ts`). The workspace can't open github.io; check deploys by serving the `gh-pages` branch locally (`git fetch --depth 1 origin gh-pages`, extract, `python3 -m http.server`, open `/rental-tracker/` and `/rental-tracker/preview/`).

- **2026-10-15 · M0 Scaffold and deploys (v0.0.0).** Built: Vite + React + TypeScript (strict) app with Direction C tokens (light/dark), empty app shell (list, map placeholder, phone tabs), non-live banner and build info, a separate `rental-tracker-preview` database name for every non-live build, Vitest and Playwright (laptop and phone, axe) tests, a Checks workflow, and a Deploy workflow (`main` to the Pages root, milestone branches to `preview/`, both on the `gh-pages` branch). Fixed after merge: the live deploy ran the tests with the live setting on and one test assumed a non-live build; tests now always run as a development build. **Fix v0.0.1:** the live app (no banner) squeezed the whole page into 56 px because the layout reserved a grid row for the banner; the app shell is now a flex column that doesn't depend on the banner, and Playwright also builds and tests the live variant (`tests/e2e/shell-live.spec.ts`, port 4174). *Lesson for every milestone:* check the live build too, not only the preview. This session's GitHub access refuses creating tags and deleting branches (HTTP 403), so the owner creates tags (`v0.0.0` done) and deletes merged branches on GitHub. Data format changed: no. *Notes for M1:* add Dexie, zod and Zustand then (not before); the database name comes from `src/config.ts` (`dbName`); run `npm run e2e` with `PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` in the cloud workspace; push to `main` can fail once with a transient 403, so retry once.
- **2026-10-15 · Planning.** Spec reviewed; PLAN, DESIGN and three mockups made; direction C chosen; Q1–Q11 decided; layers panel and pin options added to mockup C. *Next:* M0. Before starting, the owner creates an empty **public** GitHub repository named `rental-tracker` (GitHub Pages is free only for public repositories; the repo holds code and docs, never rental data) and connects GitHub to Claude.
