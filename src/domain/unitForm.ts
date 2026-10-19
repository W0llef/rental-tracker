import type { FieldSource, ID, ISODate, Listing, PriceObservation, Unit, USD } from '../model';
import { diffPaths } from './history';

/**
 * Rules the unit form applies on save (PLAN.md §5.7, DESIGN.md §4.3). Pure, so the form can
 * preview them ("Saving adds $1,600 as today's price on the Zillow listing") and the
 * command applies exactly the same thing.
 */

const byDate = (a: { date: string }, b: { date: string }) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

/** A listing's prices oldest first, and its first/last seen dates widened to cover them. */
export function normalizeListing(l: Listing): Listing {
  const observations = [...l.observations].sort(byDate);
  const first = observations[0]?.date;
  const last = observations.at(-1)?.date;
  const firstSeen = first && first < l.firstSeen ? first : l.firstSeen;
  let lastSeen = last && last > l.lastSeen ? last : l.lastSeen;
  if (lastSeen < firstSeen) lastSeen = firstSeen;
  return { ...l, observations, firstSeen, lastSeen };
}

export interface Latest {
  listingId: ID;
  observation: PriceObservation;
}

/** The newest price seen across the listings (on a tie, the listing seen most recently). */
export function latestPrice(listings: readonly Listing[]): Latest | null {
  let best: Latest | null = null;
  let bestSeen = '';
  for (const l of listings) {
    if (l.deletedAt) continue;
    for (const o of l.observations) {
      if (
        !best ||
        o.date > best.observation.date ||
        (o.date === best.observation.date && l.lastSeen >= bestSeen)
      ) {
        best = { listingId: l.id, observation: o };
        bestSeen = l.lastSeen;
      }
    }
  }
  return best;
}

/** The listing a price typed in the form goes on: the one seen most recently. */
export function newestListing(listings: readonly Listing[]): Listing | null {
  const live = listings.filter((l) => !l.deletedAt);
  return live.reduce<Listing | null>((a, l) => (!a || l.lastSeen > a.lastSeen ? l : a), null);
}

/** Records a price seen today on a listing (a second price the same day replaces the first). */
export function observe(l: Listing, today: ISODate, rent: USD, from: boolean): Listing {
  const note = from ? 'from' : null;
  const others = l.observations.filter((o) => o.date !== today);
  return normalizeListing({
    ...l,
    observations: [...others, { date: today, rent, note }],
    lastSeen: today > l.lastSeen ? today : l.lastSeen,
  });
}

export type RentEffect =
  /** The rent typed in the form becomes today's price on this listing. */
  | { kind: 'observe'; listingId: ID; isNew: boolean; rent: USD }
  /** The price history's newest price changed, so the rent follows it. */
  | { kind: 'follow'; rent: USD; from: boolean }
  | null;

export interface RentInput {
  stored: { unit: Unit; listings: readonly Listing[] } | null;
  draft: { unit: Unit; listings: readonly Listing[] };
  today: ISODate;
  /** Id and timestamp for a listing made to hold a typed price, when the unit has none. */
  newListing: () => Listing;
}

/**
 * The unit's rent mirrors the latest price seen (§3.3). In the form:
 *  - typing a new rent records it as today's price on the most recent listing (or on a new
 *    listing without a link, as Quick-add does), so the price history keeps up;
 *  - editing the price history so its newest price changes makes the rent follow it,
 *    unless the rent was also typed (then the typed rent wins and is recorded).
 */
export function reconcileRent(input: RentInput): {
  unit: Unit;
  listings: Listing[];
  effect: RentEffect;
} {
  const { stored, draft, today } = input;
  let unit = draft.unit;
  let listings = draft.listings.map(normalizeListing);
  const typed =
    !stored ||
    draft.unit.rent !== stored.unit.rent ||
    draft.unit.rentIsFrom !== stored.unit.rentIsFrom;
  const latest = latestPrice(listings);

  if (typed && unit.rent !== null) {
    if (latest && latest.observation.rent === unit.rent) return { unit, listings, effect: null };
    const target = newestListing(listings);
    if (target) {
      listings = listings.map((l) =>
        l.id === target.id ? observe(l, today, unit.rent!, unit.rentIsFrom) : l,
      );
      return {
        unit,
        listings,
        effect: { kind: 'observe', listingId: target.id, isNew: false, rent: unit.rent },
      };
    }
    const fresh = observe(input.newListing(), today, unit.rent, unit.rentIsFrom);
    return {
      unit,
      listings: [...listings, fresh],
      effect: { kind: 'observe', listingId: fresh.id, isNew: true, rent: unit.rent },
    };
  }

  if (!typed && latest) {
    const before = stored ? latestPrice(stored.listings) : null;
    const moved =
      !before ||
      before.observation.date !== latest.observation.date ||
      before.observation.rent !== latest.observation.rent;
    if (moved && latest.observation.rent !== unit.rent) {
      const from = latest.observation.note === 'from';
      unit = { ...unit, rent: latest.observation.rent, rentIsFrom: from };
      return { unit, listings, effect: { kind: 'follow', rent: latest.observation.rent, from } };
    }
  }
  return { unit, listings, effect: null };
}

/** Unit field paths that differ ('rent', 'utilities.heat', 'parking.type'), for sources. */
export function changedFields(before: Unit, after: Unit): string[] {
  const out = new Set<string>();
  for (const p of diffPaths(before, after)) {
    if (p[0] === 'fieldSources' || p[0] === 'updatedAt') continue;
    // Utilities and the move-in special change as a whole ("Heat: included → billed extra").
    const depth = p[0] === 'utilities' ? 2 : p[0] === 'moveInSpecial' ? 1 : p.length;
    out.add(p.slice(0, depth).join('.'));
  }
  return [...out];
}

/**
 * A value typed by hand no longer came from where its source says, so that source goes
 * ('unit.rent' when the rent changed; 'unit.parking.type' when parking changed). Sources
 * of fields that didn't change stay.
 */
export function dropStaleSources(
  sources: readonly FieldSource[],
  changed: readonly string[],
  root: 'unit' | 'building',
): FieldSource[] {
  const paths = changed.map((c) => `${root}.${c}`);
  return sources.filter(
    (s) =>
      !paths.some(
        (p) => s.field === p || s.field.startsWith(`${p}.`) || p.startsWith(`${s.field}.`),
      ),
  );
}
