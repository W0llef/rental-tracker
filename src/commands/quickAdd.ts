import type { RentalDB } from '../db/db';
import { applyFacts } from '../domain/facts';
import type { Fact } from '../domain/listingText';
import { canonicalUrl } from '../domain/listingUrl';
import { unitKeyOf } from '../domain/unitKey';
import { building, importBatch, listing, unit } from '../model';
import type {
  Address,
  Building,
  GeoPoint,
  ID,
  ImportBatch,
  ISODate,
  Listing,
  SiteKey,
  Unit,
} from '../model';
import { newBuilding, newId, newListing, newUnit, nowIso } from '../model/factories';
import { action, currentActionId } from './action';
import { NotFoundError } from './records';

/**
 * Quick-add (PLAN.md §5.1, §5.2, §5.7). Each command is one undoable action:
 *  - `quickAdd`: building (new, or one already in your list), the unit, a listing with its
 *    first price, recognized facts from pasted text, and the pasted text itself.
 *  - `addToUnit`: a listing or price for a unit you already have (the duplicate banner's
 *    "Add this listing to it"), and pasted text for a unit ("Paste text" in its panel).
 *  - `placeBuilding`: "Place on map" for a building without a location.
 *
 * Facts are applied as given: the caller has already chosen them (new values are pre-chosen;
 * values that would change yours only when you tick them).
 */

export interface BuildingDraft {
  address: Address;
  location: GeoPoint | null;
  name: string | null;
  neighborhood: string | null;
}

export interface UnitDraft {
  unitNumber: string | null;
  isFloorPlanOnly: boolean;
  floorPlanName: string | null;
  rent: number | null;
  rentIsFrom: boolean;
  bedrooms: number | null;
  bathrooms: number | null;
}

export interface ListingDraft {
  url: string;
  site: SiteKey;
}

export interface QuickAddInput {
  today: ISODate;
  building: { id: ID } | { draft: BuildingDraft };
  unit: UnitDraft;
  listing: ListingDraft | null;
  facts: readonly Fact[];
  /** The pasted listing text, kept with the import (null when nothing was pasted). */
  pasted: string | null;
}

export interface QuickAddResult {
  unit: Unit;
  building: Building;
  createdBuilding: boolean;
  actionId: string;
}

function importRecord(id: ID, raw: string, summary: ImportBatch['summary']): ImportBatch {
  const at = nowIso();
  return importBatch.parse({
    id,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    kind: 'listing-text',
    raw,
    prompt: null,
    summary,
    actionId: currentActionId(),
  });
}

/** Records a price seen today on a listing: a new day adds a point; the same day replaces it. */
function observe(l: Listing, today: ISODate, rent: number | null, from: boolean): Listing {
  const observations =
    rent === null
      ? l.observations
      : [
          ...l.observations.filter((o) => o.date !== today),
          { date: today, rent, note: from ? 'from' : null },
        ].sort((a, b) => (a.date < b.date ? -1 : 1));
  return {
    ...l,
    lastSeen: today > l.lastSeen ? today : l.lastSeen,
    firstSeen: today < l.firstSeen ? today : l.firstSeen,
    observations,
    offMarketAt: null,
    updatedAt: nowIso(),
  };
}

export async function quickAdd(db: RentalDB, input: QuickAddInput): Promise<QuickAddResult> {
  const { value, actionId } = await action(db, 'Add unit', async () => {
    let b: Building;
    let createdBuilding = false;
    if ('id' in input.building) {
      const found = await db.buildings.get(input.building.id);
      if (!found || found.deletedAt) throw new NotFoundError('Building', input.building.id);
      b = found;
    } else {
      const d = input.building.draft;
      b = newBuilding({
        address: d.address,
        location: d.location,
        name: d.name?.trim() || null,
        neighborhood: d.neighborhood ? { name: d.neighborhood, source: 'geocoder' } : null,
      });
      createdBuilding = true;
    }

    const d = input.unit;
    let u = newUnit({
      buildingId: b.id,
      unitNumber: d.isFloorPlanOnly ? null : d.unitNumber?.trim() || null,
      isFloorPlanOnly: d.isFloorPlanOnly,
      floorPlanName: d.floorPlanName?.trim() || null,
      rent: d.rent,
      rentIsFrom: d.rent !== null && d.rentIsFrom,
      bedrooms: d.bedrooms,
      bathrooms: d.bathrooms,
      addedVia: 'quick-add',
    });

    const importId = input.pasted?.trim() ? newId() : null;
    const applied = applyFacts({ unit: u, building: b }, input.facts, {
      today: input.today,
      url: input.listing?.url ?? null,
      via: 'paste',
      importId,
    });
    // A floor plan keeps no number; a number makes it a real unit (records.ts withIdentity).
    const number = applied.unit.isFloorPlanOnly ? null : applied.unit.unitNumber;
    const key = unitKeyOf(number);
    u = unit.parse({
      ...applied.unit,
      unitNumber: number,
      unitKey: key,
      isFloorPlanOnly: key ? false : applied.unit.isFloorPlanOnly,
    });
    if (createdBuilding || JSON.stringify(applied.building) !== JSON.stringify(b)) {
      b = building.parse(
        createdBuilding ? applied.building : { ...applied.building, updatedAt: nowIso() },
      );
      await db.buildings.put(b);
    }

    await db.units.add(u);

    if (input.listing || u.rent !== null) {
      const l = newListing({
        unitId: u.id,
        url: input.listing?.url ?? null,
        site: input.listing?.site ?? 'other',
        firstSeen: input.today,
      });
      await db.listings.add(listing.parse(observe(l, input.today, u.rent, u.rentIsFrom)));
    }

    if (importId && input.pasted) {
      await db.imports.add(
        importRecord(importId, input.pasted, {
          created: createdBuilding ? 2 : 1,
          filled: applied.applied.length,
          changed: 0,
          skipped: 0,
        }),
      );
    }
    return { unit: u, building: b, createdBuilding };
  });
  return { ...value, actionId };
}

export interface AddToUnitInput {
  unitId: ID;
  today: ISODate;
  listing: ListingDraft | null;
  /** A rent typed in Quick-add; a rent among the facts counts too. */
  rent: number | null;
  rentIsFrom: boolean;
  facts: readonly Fact[];
  pasted: string | null;
  /** How many recognized facts you left out (for the import's summary). */
  skipped?: number;
}

/**
 * Adds a listing or a price to a unit you already have, plus any chosen facts. A link you
 * already saved gets today's price on its existing listing instead of a second listing.
 * Without a link, the price goes on the unit's most recent listing.
 */
export async function addToUnit(
  db: RentalDB,
  input: AddToUnitInput,
): Promise<{ unit: Unit; actionId: string }> {
  const label = input.listing ? 'Add listing' : 'Paste listing text';
  const { value, actionId } = await action(db, label, async () => {
    const current = await db.units.get(input.unitId);
    if (!current || current.deletedAt) throw new NotFoundError('Unit', input.unitId);
    const b = await db.buildings.get(current.buildingId);
    if (!b) throw new NotFoundError('Building', current.buildingId);

    const importId = input.pasted?.trim() ? newId() : null;
    const applied = applyFacts({ unit: current, building: b }, input.facts, {
      today: input.today,
      url: input.listing?.url ?? null,
      via: 'paste',
      importId,
    });
    const rentFact = input.facts.find((f) => f.field === 'unit.rent');
    const rent = input.rent ?? (typeof rentFact?.value === 'number' ? rentFact.value : null);
    const rentIsFrom =
      input.rent !== null
        ? input.rentIsFrom
        : ((rentFact?.also?.find((a) => a.field === 'unit.rentIsFrom')?.value as boolean) ?? false);

    let u: Unit = { ...applied.unit, updatedAt: nowIso() };
    // The unit's rent mirrors the latest price seen.
    if (rent !== null) u = { ...u, rent, rentIsFrom };
    u = unit.parse(u);
    await db.units.put(u);
    if (JSON.stringify(applied.building) !== JSON.stringify(b)) {
      await db.buildings.put(building.parse({ ...applied.building, updatedAt: nowIso() }));
    }

    const listings = (await db.listings.where('unitId').equals(u.id).toArray()).filter(
      (l) => !l.deletedAt,
    );
    if (input.listing) {
      const key = canonicalUrl(input.listing.url);
      const same = listings.find((l) => canonicalUrl(l.url) === key);
      const l =
        same ??
        newListing({
          unitId: u.id,
          url: input.listing.url,
          site: input.listing.site,
          firstSeen: input.today,
        });
      await db.listings.put(listing.parse(observe(l, input.today, rent, rentIsFrom)));
    } else if (rent !== null) {
      const latest = [...listings].sort((a, z) => (a.lastSeen < z.lastSeen ? 1 : -1))[0];
      const l = latest ?? newListing({ unitId: u.id, site: 'other', firstSeen: input.today });
      await db.listings.put(listing.parse(observe(l, input.today, rent, rentIsFrom)));
    }

    if (importId && input.pasted) {
      const changed = applied.applied.filter((f) => {
        const [root, ...path] = f.field.split('.');
        let v: unknown = root === 'unit' ? current : b;
        for (const k of path) v = (v as Record<string, unknown> | null)?.[k];
        return v !== null && v !== undefined;
      }).length;
      await db.imports.add(
        importRecord(importId, input.pasted, {
          created: 0,
          filled: applied.applied.length - changed,
          changed,
          skipped: input.skipped ?? 0,
        }),
      );
    }
    return u;
  });
  return { unit: value, actionId };
}

/** "Place on map": sets a building's location from a click on the map. */
export async function placeBuilding(
  db: RentalDB,
  buildingId: ID,
  point: { lat: number; lng: number },
): Promise<Building> {
  const { value } = await action(db, 'Place on map', async () => {
    const current = await db.buildings.get(buildingId);
    if (!current) throw new NotFoundError('Building', buildingId);
    const next = building.parse({
      ...current,
      location: { lat: point.lat, lng: point.lng, source: 'map-click', precision: 'address' },
      updatedAt: nowIso(),
    });
    await db.buildings.put(next);
    return next;
  });
  return value;
}
