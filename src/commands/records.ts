import type { RentalDB } from '../db/db';
import { unitKeyOf } from '../domain/unitKey';
import { building, defaultSettings, listing, noteEntry, settings, unit } from '../model';
import type { Building, ID, Listing, NoteEntry, Settings, Unit } from '../model';
import { newBuilding, newListing, newNote, newUnit, nowIso } from '../model/factories';
import type { BuildingInput, ListingInput, NoteInput, UnitInput } from '../model/factories';
import { action } from './action';

/**
 * Basic record commands. Each is one undoable action and validates the record against its
 * zod schema before writing, so invalid data never reaches the database. Triage, merge,
 * photos and the rest arrive with their milestones.
 */

type Changes<T> = Partial<Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>>;

export class NotFoundError extends Error {
  constructor(what: string, id: ID) {
    super(`${what} ${id} wasn't found. It may have been deleted.`);
    this.name = 'NotFoundError';
  }
}

// ── Buildings ──────────────────────────────────────────────────────────────

export async function createBuilding(db: RentalDB, input: BuildingInput): Promise<Building> {
  const record = building.parse(newBuilding(input));
  await action(db, 'Add building', () => db.buildings.add(record));
  return record;
}

export async function updateBuilding(
  db: RentalDB,
  id: ID,
  changes: Changes<Building>,
  label = 'Edit building',
): Promise<Building> {
  const { value } = await action(db, label, async () => {
    const current = await db.buildings.get(id);
    if (!current) throw new NotFoundError('Building', id);
    const next = building.parse({ ...current, ...changes, updatedAt: nowIso() });
    await db.buildings.put(next);
    return next;
  });
  return value;
}

/** Soft-deletes a building and its units (one undo step). Returns the action's id. */
export async function deleteBuilding(db: RentalDB, id: ID): Promise<string> {
  const { actionId } = await action(db, 'Delete building', async () => {
    const at = nowIso();
    const current = await db.buildings.get(id);
    if (!current) throw new NotFoundError('Building', id);
    await db.buildings.put({ ...current, deletedAt: at, updatedAt: at });
    const units = await db.units.where('buildingId').equals(id).toArray();
    for (const u of units) {
      if (!u.deletedAt) await db.units.put({ ...u, deletedAt: at, updatedAt: at });
    }
  });
  return actionId;
}

// ── Units ──────────────────────────────────────────────────────────────────

/** Keeps the derived identity fields in step with the unit number (§3.3, floor plan only). */
function withIdentity(u: Unit): Unit {
  const unitKey = unitKeyOf(u.unitNumber);
  return { ...u, unitKey, isFloorPlanOnly: unitKey ? false : u.isFloorPlanOnly };
}

export async function createUnit(db: RentalDB, input: UnitInput): Promise<Unit> {
  const record = unit.parse(withIdentity(newUnit(input)));
  await action(db, 'Add unit', async () => {
    if (!(await db.buildings.get(record.buildingId))) {
      throw new NotFoundError('Building', record.buildingId);
    }
    await db.units.add(record);
  });
  return record;
}

/**
 * Typing a unit number on a floor-plan-only unit turns it into a real unit in the same
 * action; notes, listings and photos stay attached because they reference its id.
 */
export async function updateUnit(
  db: RentalDB,
  id: ID,
  changes: Changes<Unit>,
  label = 'Edit unit',
): Promise<Unit> {
  const { value } = await action(db, label, async () => {
    const current = await db.units.get(id);
    if (!current) throw new NotFoundError('Unit', id);
    const next = unit.parse(withIdentity({ ...current, ...changes, updatedAt: nowIso() }));
    await db.units.put(next);
    return next;
  });
  return value;
}

/** Soft-deletes a unit (one undo step); its listings and notes stay with it. Returns the action's id. */
export async function deleteUnit(db: RentalDB, id: ID): Promise<string> {
  const { actionId } = await action(db, 'Delete unit', async () => {
    const current = await db.units.get(id);
    if (!current) throw new NotFoundError('Unit', id);
    const at = nowIso();
    await db.units.put({ ...current, deletedAt: at, updatedAt: at });
  });
  return actionId;
}

// ── Listings and notes ─────────────────────────────────────────────────────

export async function addListing(db: RentalDB, input: ListingInput): Promise<Listing> {
  const record = listing.parse(newListing(input));
  await action(db, 'Add listing', async () => {
    if (!(await db.units.get(record.unitId))) throw new NotFoundError('Unit', record.unitId);
    await db.listings.add(record);
  });
  return record;
}

export async function addNote(db: RentalDB, input: NoteInput): Promise<NoteEntry> {
  const record = noteEntry.parse(newNote(input));
  await action(db, 'Add note', () => db.notes.add(record));
  return record;
}

// ── Settings ───────────────────────────────────────────────────────────────

/** The stored settings, or the defaults if none have been saved yet (reading never writes). */
export async function getSettings(db: RentalDB): Promise<Settings> {
  return (await db.settings.get('app')) ?? defaultSettings();
}

export async function updateSettings(
  db: RentalDB,
  change: (current: Settings) => Settings,
  label = 'Change settings',
): Promise<Settings> {
  const { value } = await action(db, label, async () => {
    const next = settings.parse(change(structuredClone(await getSettings(db))));
    await db.settings.put(next);
    return next;
  });
  return value;
}
