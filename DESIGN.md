# Rental Unit Tracker — Design (Phase 1)

Status: **Direction C chosen** · Draft 2 · Oct 15, 2026

Three visual directions, each with a static mockup of the main screen (map + unit list + detail panel). Open the files in any browser; no install needed (fonts load from Google Fonts, everything else is in the file). All three use the same nine fictional units in real downtown Minneapolis neighborhoods so they're directly comparable.

| Mockup | File | Try |
| --- | --- | --- |
| A · Plat Book | `mockups/a-plat-book.html` | Light and dark follow your system |
| B · Darkroom | `mockups/b-darkroom.html` | Dark only, by design |
| **C · Wayfinding (chosen)** | `mockups/c-wayfinding.html` | Sun icon toggles light/dark. **Layers** (or `L`) opens the map layers panel: switch base maps, what pins show, and pin color. Click the "2" pin to fan out Cedar Mill. Narrow the window for tablet and phone layouts (phone has List / Map / Unit tabs). |

The mockups are drawings, not the app: the map is a stylized SVG of downtown, base maps are recolorings of it rather than real tiles, photos are color placeholders, and other buttons don't do anything. The real map uses OpenFreeMap tiles restyled with the chosen palette.

---

## 1. The three directions

### A · Plat Book

The map and list borrow from the Sanborn fire-insurance atlases that mapped Minneapolis block by block, where buildings were hand-tinted by material (pink brick, yellow frame, blue stone). The list is an atlas index grouped by building; the detail panel floats over the map as a framed inset plate. Slab-serif headings (Zilla Slab) with Atkinson Hyperlegible for reading.

- **Good at:** grouping units under their building (spec §1 "units first, building as context"); a very particular sense of place; calm, printable.
- **Weak at:** pins are squares in a field of tinted squares, so they compete with the buildings; the tinting would need to fade out at street zoom. The floating plate hides a third of the map, and its look is the hardest to carry into dense forms and the compare table.

### B · Darkroom

The spec models flags, stars and color labels on Lightroom Classic, so this takes the Library module literally: collections and filters in a left rail, the map where the loupe would be, a filmstrip of units along the bottom, and an inspector on the right with collapsible panels. Neutral graphite so photos and the five label colors carry all the color. IBM Plex Sans.

- **Good at:** fast keyboard triage; photo-forward; label colors read instantly; familiar if you use Lightroom.
- **Weak at:** dark-only (a light mode would lose the point); four panels are cramped on a 13" laptop and don't translate to phone; the filmstrip shows fewer units than a list; status gets no color of its own.

### C · Wayfinding — chosen

Minneapolis in winter, read like a sign system: snow-white surfaces, lake-ice greys, a deep Mississippi navy for anything "you are here," and snowplow amber for anything new. Type is **Overpass**, an open-source typeface descended from the Highway Gothic lettering on US road signs. The one bold idea: **every pin is a small sign plate showing that unit's total monthly cost**, with a colored edge for its status, so the map itself answers "what does it really cost to live there?". The selected unit's plate and the detail header are the same navy sign. Everything else stays quiet: hairlines, white panels, no decorative shadows.

- **Good at:** the cost-first pins make the map useful at a glance (the spec's core complaint is bait pricing); three plain columns follow the spec's Google Maps–style layout; scales cleanly to the edit form, compare table and phone; equally good in light and dark.
- **Weak at:** price plates take more room than dots, so dense areas rely on building grouping and the fan-out (which the spec requires anyway); less photo-forward than B.

**Why C.** It serves the decisions the app exists for (total cost, status, where) on the map itself; it's the most legible for long sessions; and it carries into every Phase 1 screen without special cases. Two ideas from B are folded in: keyboard hints printed on the controls they trigger, and a compare tray that collects units while you browse.

---

## 2. Chosen direction: tokens

All values are CSS custom properties in `src/styles/tokens.css`. Names below are the token names.

### 2.1 Base palette

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--snow` | `#F6F8F9` | `#0E1A22` | App background |
| `--surface` | `#FFFFFF` | `#14232D` | Panels, cards, pins |
| `--frost` | `#EDF2F4` | `#1B2D39` | Hover, selected row, inset fields |
| `--ice` | `#DCE5E9` | `#26394A` | Hairlines, borders, empty stars |
| `--slate` | `#56666F` | `#9DB0BB` | Secondary text, units, sources |
| `--ink` | `#13242F` | `#E7EEF2` | Primary text |
| `--river` | `#0F2E44` | `#E7EEF2` | Sign plates: selected pin, detail header, skyway chip (inverts in dark) |
| `--on-river` | `#F3F7F9` | `#0F2E44` | Text on `--river` |
| `--lake` | `#2462C6` | `#6FA2F2` | Primary actions, links, focus ring |
| `--plow` | `#E5A11A` | `#F0B43A` | New, attention, "assumed" cost lines |

Flag text uses `--pick-ink` (`#237032` / `#4FB063`) and `--reject-ink` (`#A8341F` / `#E8826F`), darker than the status colors so it stays AA on `--frost`.

Contrast: `--ink`, `--slate` and `--lake` all meet WCAG AA (4.5:1) on `--surface` and `--snow` in both themes. Amber never carries text on white; "New" tags put dark text (`#3A2A00`) on amber.

### 2.2 Status colors (pin edge, status pill, list)

The pipeline reads left to right as cool → green; end states are red or grey.

| Status | Light | Dark |
| --- | --- | --- |
| New | `#E5A11A` | `#F0B43A` |
| Reviewing | `#6E7F89` | `#8A9BA5` |
| Shortlisted | `#2462C6` | `#5C93F0` |
| Tour scheduled | `#0F8B8D` | `#2DB3B5` |
| Toured | `#0A5F61` | `#1E8E90` |
| Applied | `#6D4BC4` | `#9C80E6` |
| Approved | `#2E8540` | `#4FB063` |
| Leased (you signed) | `#1C5B2C` | `#3E9A55` |
| Declined | `#C2412D` | `#E06A55` |
| Off market | `#9AA6AD` | `#607079` |

Status is never shown by color alone: pills always carry the word, and the legend on the map names each color.

### 2.3 Color labels (user-named)

| Label | Light | Dark | Default name |
| --- | --- | --- | --- |
| Red | `#D64545` | `#E66A6A` | Red |
| Yellow | `#E3B52F` | `#EBC452` | Yellow |
| Green | `#3A9A55` | `#56B470` | Green |
| Blue | `#3B7DDD` | `#6A9DEB` | Blue |
| Purple | `#8E5CD9` | `#A983E6` | Purple |

Names are set in Settings ("Blue = roommate likes") and shown in tooltips, filters and the legend.

### 2.4 Pins

*Reworked in the M3 review; this section describes what's built.* A pin has one **style** and any number of **fields** (Pins panel, §4.7). Every style keeps the same cues: a **colored edge** (status, label or price; one stripe per unit), a **tail** pointing at the building, and **navy for the selected unit**.

| Style | Look | Size |
| --- | --- | --- |
| Sign plate (default) | The fields in order, each a segment divided by a 1 px `--ice` hairline: type icon · **rent** (13/800, `--ink`) · beds and size · unit number (building name for a building) · rating (12.5/600, `--slate`). Example: `$1,650 │ 1 bd · 720 ft² │ 1504 │ ★4` | 26 px tall |
| Dot | 16 px dot filled with the edge color(s) as a pie ring, white ring; a building = 24 px with its count. No text | 16–24 px |
| Photo | 46 px photo in a 3 px white frame, a 5 px stripe bar under it, and the fields as a caption below; the unit-type icon until photos arrive (M11) | 52 px wide |

Pending fields: total cost and cost per ft² (M8), travel time (Phase 2). Until M8 the rent field stands in.

**A building with several units** (collapsed, or any Buildings-view pin) shows only what's true of all of them: rent as a range (`$1,090–$1,815`) or lowest with `+` (a setting), ranges for beds, size and rating (`★1–4`), the building's name for "unit number", the type icon only if the units share a type, a navy count badge, one stripe per unit (grouped by color), and the New badge if any unit is new.

**New units**: off, a 12 px amber dot, or (default) an amber **New** tag (10/800, `#3A2A00` on `--plow`) at the top-right corner.

| State | Look, in any style |
| --- | --- |
| Fanned out | Units on dotted navy leader lines around a navy hub button (×, folds the fan); several fans can be open; *Collapse all* appears with the map controls |
| Selected | Navy plate, 34 px tall, rent 17 px (photo grows to 64 px); list row gets a navy left bar |
| Rejected | Dashed outline, struck-through text, no edge; 55% opacity when "Fade" is chosen; gone when "Hide" is chosen |
| Fails baseline criteria | 55% opacity, solid outline |
| Crowded or zoomed out | Shrinks to dots (if on): all of them below zoom 11, otherwise only where plates would overlap; pointing at a pin or its card expands it; the selected pin always shows in full |
| Low zoom (10 and below) | Neighborhood bubbles (if on): navy circle with the number of units; click to zoom in |
| Hovered | Its card(s) in the list get the `--frost` hover background |

**Pin color** options: *Status* (§2.2), *Label* (§2.3, unlabeled = `--ice`), or *Total cost* (*Rent* until M8), a five-step blue scale from your cheapest to your priciest unit:

| Step | 1 (cheapest) | 2 | 3 | 4 | 5 (priciest) |
| --- | --- | --- | --- | --- | --- |
| Color | `#BCD2F0` | `#8CB0E6` | `#5C8DD8` | `#2F67C0` | `#1A458C` |

The legend in the map corner (laptop) and in the Pins panel (all widths) always says what the colors mean and, for cost, the dollar range.

### 2.5 Base maps

**Wayfinding (default)** is OpenFreeMap's Positron style recolored with tokens: land `#EEF2F3`, blocks `#E3E9EC`, buildings `#D5DDE1`, water `#B9D3E4`, parks `#D4E6D3`, highways `#F7E3B3`, labels `#6A7980` (dark: `#13222C`, `#182A35`, `#20343F`, `#0B2A3E`, `#173327`, `#4A3E22`, `#8DA0AA`). POI icons are hidden so only your pins have color.

The other four are used as their publishers draw them: **Detailed streets** (OpenFreeMap Liberty), **OpenStreetMap** (the osm.org Standard look), **Cycle map** (CyclOSM) and **Aerial photo** (MnGeo 2025 metro imagery). On Aerial, pins get a 1 px dark outline and map labels a dark halo. Raster maps have no dark version; the app's panels still follow your theme.

Phase 2 overlays (skyway, transit, bike) will use navy, transit line colors and green respectively, over any base map.

### 2.6 Typography

One family: **Overpass** (open source, SIL OFL), self-hosted in the build so it works offline. Tabular numerals everywhere (`font-feature-settings: "tnum"`), so prices line up in lists and the compare table.

| Role | Size / line height | Weight |
| --- | --- | --- |
| Detail title ("Unit 1504") | 26 / 29 | 800 |
| Headline number (total in detail header) | 28 / 28 | 800 |
| Card total | 17 / 22 | 800 |
| Card title, section values | 15 / 20 | 700 |
| Body, form fields | 14 / 20 | 400 |
| Secondary (specs, rent, sources) | 12.5–13 / 18 | 400–600 |
| Section headings in panels | 13 / 18 | 700, `--slate` |
| Small print (attribution, captions) | 11–12 / 16 | 400–600 |

Sentence case everywhere; no all-caps labels. Numbers carry their unit in the same run ("720 ft²", "$1,932/mo").

### 2.7 Spacing, shape, elevation

- 4 px base: `--s1` 4 · `--s2` 8 · `--s3` 12 · `--s4` 16 · `--s5` 24 · `--s6` 32. Panel padding 16; card padding 12 × 16.
- Radius by role, not one radius for everything: 4 px for tags and thumbnails, 8 px for buttons, fields and popovers, 5–6 px for pin plates, 0 for panels and list rows (they're separated by hairlines).
- Hairlines (`1px --ice`) separate everything. Shadows only on things that float above the map: pins, the tablet detail overlay, popovers and sheets.
- Hit targets ≥ 32 px on laptop, ≥ 44 px at phone width.

### 2.8 Light and dark

- Follows the system by default; Settings → Display offers System / Light / Dark.
- Dark swaps every token (table above); `--river` inverts to light, so the selected sign plate becomes a light plate on a dark map.
- The map switches to the matching dark style; photos are never dimmed or filtered.
- Charts (price history) and pin edges use the dark variants of status and label colors.

### 2.9 Motion

Only in response to an action: the detail panel slides in (160 ms), the fan-out expands from its hub (180 ms), toasts slide up. Map fly-to on selection is 400 ms. All of it is removed under `prefers-reduced-motion`.

---

## 3. Responsive layout

| Width | Layout |
| --- | --- |
| ≥ 1280 px (laptop) | Three columns: list 360 · detail 420 · map. The detail column closes to two columns when nothing is selected. |
| 960–1279 | List 340 · map; detail opens as a 400 px panel over the left edge of the map. Filter chips collapse into a "Filters (2)" button. |
| 760–959 | Same, with list 320 and detail covering the map. |
| < 760 (phone) | Bottom tabs: **List · Map · Unit**. Selecting a pin or card opens the Unit tab. Top bar keeps the title and Add. Quick-add and filters open full-screen. Edit forms work but are laid out for laptop (spec §11). |

Phone gestures: swipe the unit's photo strip; tap a star to rate; long-press a card to flag. The map keeps your selection when you switch tabs.

---

## 4. Component layouts

### 4.1 Unit card (list)

```
┌──────────────────────────────────────────────────────────────┐
│ ┌──────┐  Unit 1504  Riverlight                     ★★★★☆   │  title 15/700 · building 13 slate · stars
│ │ photo│  1 bd   1 ba   720 ft²   Floor 15   S W             │  specs 12.5, values bold
│ │  64² │  $1,932/mo   $1,650 rent   1 assumed                │  total 17/800 · rent · assumed (dotted, hover = breakdown)
│ └■─────┘  ⚑ Pick   ▌Shortlisted                listed 17 days │  flag · status pill · listing age
└──────────────────────────────────────────────────────────────┘
   ■ = color label square on the thumbnail   ▌= status color edge
```

- Selected: `--frost` background and a 4 px navy bar on the left. Hover: `--frost`.
- Rejected: dimmed (text in `--slate`, thumbnail at 50% opacity, so text stays AA) and "Rejected: <reason>" replaces the flag/status line.
- Floor plan only: "Plan C" plus a "floor plan" tag; specs say "units vary"; prices say "from".
- New: the status pill reads "New" with its amber edge; no separate badge on the card (it repeated the pill). The amber New dot stays an option on map pins (§2.4), which show no status text.
- Needs location: a "Needs location" chip with "Place on map".
- Multi-select: ⌘/Ctrl-click or Shift-click; a checkbox appears in the photo corner.
- The **Building card** (Buildings view) shows name, neighborhood, building type, "3 of your units", and the range "$1,857–$2,560".

### 4.2 Detail panel

```
┌────────────────────────────────────────────┐
│ [ photo grid: 1 large + 2 small, +14 ]     │  click → lightbox (originals)
├────────────────────────────────────────────┤
│ Unit 1504                     $1,932 /mo   │  navy sign plate
│ Riverlight, 201 S Example St  $1,650 rent  │
│ Downtown East                              │
├────────────────────────────────────────────┤
│ [Pick P|Reject X|None U]  ★★★★☆           │  markers row
│ ■ ■ ■ ▣ ■                   ▌Shortlisted ▾ │
├────────────────────────────────────────────┤
│ Monthly cost              Edit cost profile│  line · source · amount; "assumed" in amber
│ Rent            listing           $1,650   │
│ …                                          │
│ Total                             $1,932   │
│ Move-in cost                      $2,325   │
│ Per square foot                    $2.68   │
├────────────────────────────────────────────┤
│ Unit       3-column facts; unknown in italic│
│ Windows    compass + list per window        │
│ Building   amenity chips (yes / no / ?)     │  "Skyway connected" uses the navy plate
│ Listings and price  rows + step chart       │
│ Travel times  empty state until Phase 2     │
│ Notes       timestamped log, Add note       │
│ Links       listing(s), website, Maps, SV   │
├────────────────────────────────────────────┤
│ [Edit E] [Research R] [Compare C] [History]│  sticky footer
└────────────────────────────────────────────┘
```

Imported values carry a small source link (site name, or "AI" until you confirm them). A "Paste text" action sits next to Edit for pasting more listing text later.

In **Shortlist mode** each section header shows a completeness count ("Unit 7 of 9") and unknown fields are listed as tappable "Add balcony" prompts that open the edit form at that field.

### 4.3 Full edit form (`#/unit/:id/edit`)

```
┌ Riverlight · Unit 1504 ─────────────────────────────────── [Cancel] [Save  ⌘S] ┐
│ ┌───────────────┐ ┌───────────────────────────────────────────┐ ┌────────────┐ │
│ │ Identity   ●  │ │ Specs                                      │ │ Building   │ │
│ │ Specs      ◐  │ │ Type        [Apartment ▾]                  │ │ Riverlight │ │
│ │ Windows    ○  │ │ Bedrooms    [ 1 ] [?]   Bathrooms [ 1 ] [?]│ │ 24 floors  │ │
│ │ Features   ◐  │ │ Square feet [720] [?]   Floor     [15] [?] │ │ Edit bldg  │ │
│ │ Lease      ●  │ │ Exposure    (N)(NE)(E)(SE)[S](SW)[W](NW)   │ ├────────────┤ │
│ │ Costs      ◐  │ │ View notes  [_______________________]      │ │ Complete   │ │
│ │ Parking    ●  │ │                                            │ │ ██████░ 78%│ │
│ │ Review     ●  │ │ Windows                                    │ │ 6 unknown  │ │
│ │ Photos     ●  │ │ Room      Direction  Size        Obstruction│ │ Show them │ │
│ │ Listings   ●  │ │ Living    S          Floor-to-…  —         │ └────────────┘ │
│ │ Sources    ○  │ │ Bedroom   S          Standard    —         │                │
│ └───────────────┘ │ [+ Add window]                              │                │
│                   └───────────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────────────────────────────┘
  ● complete  ◐ partly  ○ empty      [?] = mark as unknown
```

- One scrolling page with a sticky section nav (not tabs), so ⌘F and scrolling work.
- Every field has three visible states: filled, unknown (`?` pressed, italic "Unknown"), and empty-not-yet-asked (same as unknown in data; shown with a faint dashed border so you can see what's left).
- Yes/no fields are three-way toggles: **Yes · No · ?**.
- Utilities: one row per item with **Included · Extra $ · Tenant-paid (est. $)**; the estimate placeholder shows your cost-profile number.
- Edits are a draft; Save commits once (one undo step). Leaving with unsaved changes asks first.
- The building form uses the same frame with its own sections.

### 4.4 Compare table (`#/compare?ids=…`)

```
┌ Compare 3 units ────────────── [Hide identical rows ✓] [Add unit] [Clear] ┐
│                │ Riverlight 1504 │ The Larch 3F    │ Cedar Mill 702      │  sticky header: photo, name, ★, ⚑, ✕
├────────────────┼─────────────────┼─────────────────┼─────────────────────┤
│ Total monthly  │ $1,932  lowest  │ $2,086          │ $2,174              │  best value marked in words, not only color
│ Rent           │ $1,650          │ $1,795          │ $1,890              │
│ Per ft²        │ $2.68           │ $2.07  lowest   │ $2.53               │
│ Bedrooms       │ 1               │ 2               │ 1 + den             │
│ Laundry        │ In unit         │ In building  ≠  │ In unit             │  ≠ cells differ → tinted
│ Balcony        │ Unknown         │ Yes             │ No                  │  unknown in italic slate
│ Skyway         │ Connected       │ No              │ No                  │
│ …grouped: Cost · Space · Features · Building · Lease · Review             │
└───────────────────────────────────────────────────────────────────────────┘
```

- 2–6 units; columns min 180 px, horizontal scroll with the field column sticky.
- Rows where values differ get a `--frost` background; "Hide identical rows" removes the rest.
- Numeric rows mark the best value with a small "lowest"/"highest" word.
- Drag column headers to rank; the order is kept with the compare set.
- Phone: one unit per screen width, swipe between them, field names sticky.

### 4.5 Settings (`#/settings/:section`)

```
┌ Settings ──────────────────────────────────────────────────────────────┐
│ Cost profile        │ Cost profile                                     │
│ Baseline criteria   │ What you expect to pay when a unit doesn't       │
│ Labels and reasons  │ include something.                                │
│ Display             │                                                   │
│ Photo archive       │ Electric   [$49] per month  scaled by [sq ft ▾]   │
│ Backup and restore  │            at [750] ft² → 720 ft² unit = $47      │
│ Storage             │ Internet   [$60]  not scaled                      │
│ Keyboard shortcuts  │ Gas        [$25]  scaled by bedrooms              │
│ Travel (Phase 2)    │ …                                                 │
│                     │ Parking spaces you need  [1]                      │
│                     │ You need storage          [No]                    │
│                     │ Pets  cats [0] dogs [0]                           │
│                     │ Spread one-time fees over the lease  [Off]        │
└─────────────────────┴───────────────────────────────────────────────────┘
```

Sections:
- **Cost profile** as above; changes update every total immediately.
- **Baseline criteria**: max rent or max total, min beds/baths, unit types, move-in window, must-haves. Units that fail are dimmed.
- **Labels and reasons**: rename the five labels; add, rename, archive reject reasons.
- **Display**: theme; default base map and pin options (same controls as the Map layers panel); hide rejected by default.
- **Essential fields**: which fields count toward "ready to compare" and the completeness meter.
- **Photo archive**: current store ("Folder: Documents/Rental Tracker" or "In this browser only"), Choose/Reconnect folder, keep originals for all/starred/shortlisted, archive size, Empty trash.
- **Backup and restore**: last backup date, Back up data (.json), Back up with photos (.zip), Restore from file, reminder interval.
- **Storage**: browser storage used and available, persistent storage on/off, "Clear all data" (asks you to type DELETE and offers a backup first).
- **Keyboard shortcuts**: the table below.
- **Travel (Phase 2)**: API key fields shown disabled with one line on what they'll unlock.

### 4.6 Quick-add dialog (N)

```
┌ Add a unit ─────────────────────────────────────────── Esc ┐
│ Listing link   [https://www.zillow.com/homedetails/…     ] │  site recognized: Zillow
│ Address        [201 S Example St, Minneapolis          ▾] │  suggestions as you type
│                 ✓ Riverlight is in your list; adding it there
│ Unit           [1504]   or  [ ] Floor plan only  [Plan C]  │
│ Rent [$1,650]   Beds [1]   Baths [1]                        │
│ ┌ Paste listing text (optional) ─────────────────────────┐ │
│ │ Found: [$1,650/mo ✓] [720 ft² ✓] [Avail Jun 1 ✓]       │ │  chips: click to drop one
│ │        [In-unit laundry ✓] [Heat included ✓] [Cats ok ✓]│ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌ This looks like Unit 1504 at Riverlight, added Oct 2. ┐  │
│ │ [Add this listing to it]   [Add as a separate unit]   │  │
│ └───────────────────────────────────────────────────────┘  │
│                [Add and open]  [Add another here ⇧⏎]  [Add ⏎]│
└─────────────────────────────────────────────────────────────┘
```

The paste box is collapsed to one line until you paste; anything it recognizes also fills the fields above it (highlighted until you move on). "Add another here" keeps the building, address and listing site.

### 4.7 Map layers (L) and Pins panels

*Split in the M3 review.* Two buttons sit above the zoom controls: **Pins** and **Layers** (`L`). Laptop: a 316 px panel anchored under the buttons. Phone: a bottom sheet over the map; the buttons are icon-only.

```
┌ Map layers ──────────────────────── × ┐   ┌ Pins ─────────────────────────────── × ┐
│ Base map                              │   │ Settings for [Units view|Buildings view]│
│ [Wayfinding] [Detailed streets]       │   │ Pin style   [Sign plate | Dot | Photo]  │
│ [OpenStreetMap] [Cycle map] [Aerial]  │   │ On the pin  ☐ Unit type icon  ☑ Rent    │
├───────────────────────────────────────┤   │   ☐ Total cost M8  ☐ Cost per ft² M8    │
│ Key: Wayfinding                       │   │   ☐ Beds and size  ☐ Unit number        │
│ ▭ Water  ▭ Parks  ▭ Buildings …       │   │   ☐ Rating  ☐ Travel time Phase 2       │
│ (other maps: link to their key)       │   │   Rent for a building: (•) Range ( ) Low│
├───────────────────────────────────────┤   │ New units   [Off | Dot | “New” tag]      │
│ Overlays                     Phase 2  │   │ Pin color   [Status | Label | Rent]     │
│ ☐ Skyway routes  ☐ Transit …          │   │   (legend)                              │
└───────────────────────────────────────┘   │ Rejected units [Show | Fade | Hide]     │
                                            │ When crowded ☑ Group nearby buildings   │
                                            │   ☑ Shrink crowded pins to dots         │
                                            │   ☑ Fan out buildings when zoomed in    │
                                            └─────────────────────────────────────────┘
```

Choices apply instantly. Pin settings are kept separately for the Units and Buildings views and remembered in this browser (per database); options that don't apply are greyed out (fields for dots) or hidden (fan-out in the Buildings view). Settings → Display will later hold defaults.

### 4.8 Batch add units (`#/building/:id/add`)

```
┌ Add units to Riverlight ──────────────────────── [Cancel] [Add 6 units] ┐
│ Paste a table from the building's availability page, or type below.     │
│ ┌─────┬──────────┬────┬─────┬───────┬───────┬────────┬───────────┐      │
│ │Unit │Floor plan│Beds│Baths│Sq ft  │Floor  │Rent    │Available  │      │
│ ├─────┼──────────┼────┼─────┼───────┼───────┼────────┼───────────┤      │
│ │1504 │B         │1   │1    │720    │15     │$1,650  │Jun 1      │ ⚠ already in your list
│ │1612 │B         │1   │1    │720    │16     │$1,675  │May 15     │      │
│ │2203 │C         │2   │2    │1,080  │22     │$2,240  │Jul 1      │ ↺ upgrades "Plan C" placeholder
│ │ …   │          │    │     │       │       │        │           │      │
│ └─────┴──────────┴────┴─────┴───────┴───────┴────────┴───────────┘      │
│ Columns matched: Unit, Plan, Bed, Bath, SqFt, Rent, Available.          │
│ "Floor" guessed from unit numbers (15 from 1504). [Undo guess]          │
└─────────────────────────────────────────────────────────────────────────┘
```

Tab/⏎ move like a spreadsheet; rows matching an existing unit are flagged and added as a new listing/price instead of a duplicate.

### 4.9 AI research prompt (R)

```
┌ Research with AI ──────────────────────────────────────── Esc ┐
│ Research   (This unit) (This building) (Selected: 4 units)    │
│ Fields     (Missing essentials · 7) (All missing · 31) (Pick…)│
│ ┌ Prompt preview ───────────────────────────────────────────┐ │
│ │ Today is Oct 15, 2026. Research Unit 1504 at Riverlight,  │ │
│ │ 201 S Example St, Minneapolis… Known: rent $1,650, …      │ │
│ │ Find: balcony, EV charging, guest suites, … Rules: …      │ │
│ └───────────────────────────────────────────────────────────┘ │
│ Paste it into an AI assistant that can browse the web, then   │
│ copy its whole reply and press ⌘V anywhere in this app.       │
│                                          [Copy prompt ⏎]      │
└────────────────────────────────────────────────────────────────┘
```

### 4.10 Import review (`#/import/:id`)

```
┌ Review import · AI reply · 3 units, 41 values ──── [Discard] [Apply 34 changes ⏎] ┐
│ ┌ Riverlight · Unit 1504 ───────────────────────────── [Accept all A] ┐           │
│ │ ☑ Balcony           Unknown  →  Yes            riverlight.example ↗ │  fills an unknown
│ │ ☑ EV charging       Unknown  →  Yes, 8 stalls  riverlight.example ↗ │
│ │ ☐ Rent              $1,650   →  $1,695         zillow.com ↗         │  changes yours: off by default
│ │ ☑ Pet rent          Unknown  →  $35            no source ⚠          │  flagged
│ └──────────────────────────────────────────────────────────────────────┘          │
│ ┌ Riverlight · Unit 2203 (new) ─────────────────────── ☑ Add unit ┐                │
│ │ 2 bd · 2 ba · 1,080 ft² · $2,240 · replaces "Plan C" placeholder │               │
│ └──────────────────────────────────────────────────────────────────┘               │
│ Not used: "parking_waitlist" (no matching field) · 1 value unreadable             │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Keys: J/K move between rows, Space toggles, A accepts the whole unit, ⏎ applies. After applying, a toast reads "Imported 34 changes · Undo", and imported values show a small source link in the detail panel.

---

## 5. Keyboard shortcuts

Shortcuts act on the selected unit, or every selected unit when several are selected. They're ignored while typing in a field. `?` shows this sheet in the app.

| Key | Action |
| --- | --- |
| `P` | Flag as pick |
| `X` | Flag as reject (opens reasons; ⏎ to confirm) |
| `U` | Remove flag |
| `0`–`5` | Set stars (0 clears) |
| `6` / `7` / `8` / `9` | Toggle red / yellow / green / blue label (purple from the menu, Q8) |
| `↑` `↓` or `K` `J` | Previous / next unit in the list |
| `⏎` | Open the selected unit's detail |
| `Esc` | Close panel, collapse fan-out, or clear selection |
| `E` | Edit the selected unit |
| `N` | Add a unit (quick-add) |
| `C` | Add to / remove from compare |
| `/` | Search |
| `F` | Open filters |
| `L` | Open or close map layers |
| `R` | Copy a research prompt for the selected unit(s) |
| `M` | Switch Explore / Shortlist |
| `B` | Switch Units / Buildings view |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⇧⌘Z` / `Ctrl+Shift+Z` | Redo |
| `⌘S` / `Ctrl+S` | Save (in edit form) |
| `⌘↓` / `Ctrl+↓` | Next empty field (in edit form) |
| `?` in a field | Mark that field unknown (in edit form) |
| `⇧⏎` | Add and start another in the same building (quick-add) |
| `⌘V` / `Ctrl+V` | Outside a text field: a copied photo goes onto the selected unit; a copied AI reply or listing text opens import review |
| `?` | Show shortcuts (outside the edit form) |

Controls print their key next to the label where there's room (`Pick P`, `Edit unit E`), so shortcuts are learned by use.

---

## 6. Voice

Plain and specific. Buttons say what happens ("Add unit", "Back up data", "Restore from file"), and the toast uses the same words ("Unit added", "Backed up"). Empty states point to the next step ("No units yet. Paste a listing link or an address to add your first one."). Errors say what happened and what to do ("Couldn't find that address. Check the spelling, or place the unit on the map.").
