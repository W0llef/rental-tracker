import type { RentalDB } from '../db/db';
import { unitFullName } from '../domain/format';
import { diffPaths } from '../domain/history';
import { changedFields, dropStaleSources, reconcileRent } from '../domain/unitForm';
import type { RentEffect } from '../domain/unitForm';
import { building as buildingSchema, listing as listingSchema, unit as unitSchema } from '../model';
import type { Building, ID, ISODate, Listing, PetPolicy, Unit } from '../model';
import { newListing, nowIso } from '../model/factories';
import { action } from './action';
import { NotFoundError, withIdentity } from './records';

/**
 * Saving the full forms (PLAN.md §4.1, §5.7; DESIGN.md §4.3): everything the form changed is
 * written in one action, so Undo takes the whole save back in one step and History says
 * it field by field. Records are validated before anything is written.
 */

/** Everything but the bookkeeping, for "did anything change?". */
const strip = <T extends { updatedAt: string }>(r: T) => ({ ...r, updatedAt: '' });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface UnitFormInput {
  /** The edited unit (a new unit's id is made by the form). */
  unit: Unit;
  /** Its listings as the form left them; listings missing here are deleted. */
  listings: Listing[];
  today: ISODate;
  /** True for a unit that isn't stored yet ("New unit from Plan C"). */
  isNew?: boolean;
  /**
   * Its building as the form left it, when the form edits it too: a standalone home's
   * facts (Q30), or the choice of being part of a larger building. Saved in the same step.
   */
  building?: Building;
}

export interface UnitFormResult {
  unit: Unit;
  /** Whether anything was written (saving an untouched form writes nothing). */
  changed: boolean;
  actionId: string | null;
  effect: RentEffect;
}

/**
 * Saves the unit form: the unit, its listings and their price history. A typed rent goes
 * into the price history, and an edited price history moves the rent (domain/unitForm.ts);
 * sources of values typed by hand are dropped.
 */
export async function saveUnitForm(db: RentalDB, input: UnitFormInput): Promise<UnitFormResult> {
  const id = input.unit.id;
  const label = input.isNew ? 'Add unit' : 'Edit unit';
  let result: Omit<UnitFormResult, 'actionId'> = {
    unit: input.unit,
    changed: false,
    effect: null,
  };
  const { actionId } = await action(db, label, async () => {
    const at = nowIso();
    const stored = input.isNew ? undefined : await db.units.get(id);
    if (!input.isNew && (!stored || stored.deletedAt)) throw new NotFoundError('Unit', id);
    if (input.isNew && (await db.units.get(id))) throw new Error('This unit was already added.');
    const b = await db.buildings.get(input.unit.buildingId);
    if (!b || b.deletedAt) throw new NotFoundError('Building', input.unit.buildingId);
    const storedListings = stored
      ? (await db.listings.where('unitId').equals(id).toArray()).filter((l) => !l.deletedAt)
      : [];

    const draftListings = input.listings.map((l) => ({ ...l, unitId: id }));
    const r = reconcileRent({
      stored: stored ? { unit: stored, listings: storedListings } : null,
      draft: { unit: input.unit, listings: draftListings },
      today: input.today,
      newListing: () => newListing({ unitId: id, firstSeen: input.today }, at),
    });
    let next = withIdentity(r.unit);
    if (stored) {
      const changed = changedFields(stored, next);
      next = { ...next, fieldSources: dropStaleSources(next.fieldSources, changed, 'unit') };
    }
    next = unitSchema.parse({ ...next, updatedAt: stored?.updatedAt ?? at });
    const listings = r.listings.map((l) => listingSchema.parse(l));

    let changed = false;
    if (!stored) {
      await db.units.add({ ...next, createdAt: at, updatedAt: at });
      changed = true;
    } else if (!same(strip(unitSchema.parse(stored)), strip(next))) {
      await db.units.put({ ...next, updatedAt: at });
      changed = true;
    }
    const before = new Map(storedListings.map((l) => [l.id, l]));
    for (const l of listings) {
      const old = before.get(l.id);
      if (!old) await db.listings.add({ ...l, createdAt: at, updatedAt: at, deletedAt: null });
      else if (!same(strip(old), strip(l))) await db.listings.put({ ...l, updatedAt: at });
      else continue;
      changed = true;
    }
    const kept = new Set(listings.map((l) => l.id));
    for (const old of storedListings) {
      if (kept.has(old.id)) continue;
      await db.listings.put({ ...old, deletedAt: at, updatedAt: at });
      changed = true;
    }
    if (input.building) {
      if (input.building.id !== next.buildingId)
        throw new Error('The form’s building isn’t the unit’s building.');
      if (await writeBuilding(db, input.building)) changed = true;
    }
    result = { unit: next, changed, effect: r.effect };
  });
  return { ...result, actionId: result.changed ? actionId : null };
}

/**
 * Writes an edited building inside the running action. Sources recorded on its units for
 * building facts typed here by hand go, as for units (pasted building facts keep their
 * sources on the unit they were pasted into, §5.7). Returns whether anything changed.
 */
async function writeBuilding(db: RentalDB, draft: Building): Promise<Building | null> {
  const stored = await db.buildings.get(draft.id);
  if (!stored || stored.deletedAt) throw new NotFoundError('Building', draft.id);
  const next = buildingSchema.parse({ ...draft, updatedAt: stored.updatedAt });
  if (same(strip(buildingSchema.parse(stored)), strip(next))) return null;
  const at = nowIso();
  await db.buildings.put({ ...next, updatedAt: at });
  const changed = diffPaths(stored, next).map((p) => p.join('.'));
  const units = await db.units.where('buildingId').equals(draft.id).toArray();
  for (const u of units) {
    const sources = dropStaleSources(u.fieldSources, changed, 'building');
    if (sources.length !== u.fieldSources.length)
      await db.units.put({ ...u, fieldSources: sources, updatedAt: at });
  }
  return next;
}

/** Saves the building form (one undo step). */
export async function saveBuildingForm(
  db: RentalDB,
  draft: Building,
): Promise<{ building: Building; changed: boolean }> {
  let out = { building: draft, changed: false };
  await action(db, 'Edit building', async () => {
    const next = await writeBuilding(db, draft);
    if (next) out = { building: next, changed: true };
  });
  return out;
}

/**
 * What "Edit together" can set on several buildings (Q23): their own facts. Amenities and
 * pets change only the parts given, so "pool: yes" keeps each building's other amenities.
 */
export interface BuildingPatch {
  buildingType?: Building['buildingType'];
  elevator?: Building['elevator'];
  managementCompany?: Building['managementCompany'];
  amenities?: Partial<Building['amenities']>;
  pets?: Partial<PetPolicy>;
  smoking?: Building['smoking'];
  subletPolicy?: Building['subletPolicy'];
  guestParking?: Building['guestParking'];
}

export function applyBuildingPatch(b: Building, patch: BuildingPatch): Building {
  const { amenities, pets, ...plain } = patch;
  return {
    ...b,
    ...plain,
    amenities: amenities
      ? ({ ...b.amenities, ...amenities } as Building['amenities'])
      : b.amenities,
    pets: pets ? { ...b.pets, ...pets } : b.pets,
  };
}

/** Sets the same facts on several buildings (one undo step). Returns how many changed. */
export async function updateBuildings(
  db: RentalDB,
  ids: readonly ID[],
  patch: BuildingPatch,
  label = 'Edit buildings together',
): Promise<number> {
  const { value } = await action(db, label, async () => {
    const at = nowIso();
    let changed = 0;
    for (const id of ids) {
      const current = await db.buildings.get(id);
      if (!current || current.deletedAt) throw new NotFoundError('Building', id);
      const next = buildingSchema.parse(applyBuildingPatch(current, patch));
      if (same(next, current)) continue;
      await db.buildings.put({ ...next, updatedAt: at });
      changed++;
    }
    return changed;
  });
  return value;
}

/** "Unit 1504 at Riverlight", for messages after saving. */
export async function unitDisplayName(db: RentalDB, u: Unit): Promise<string> {
  return unitFullName(u, await db.buildings.get(u.buildingId));
}
