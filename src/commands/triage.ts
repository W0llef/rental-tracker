import type { RentalDB } from '../db/db';
import { cleanReason, findReason } from '../domain/triage';
import { noteEntry, settings as settingsSchema, unit as unitSchema } from '../model';
import type {
  ID,
  LabelColor,
  NoteEntry,
  Settings,
  Unit,
  UnitStatus,
  UtilityKey,
  UtilityTerm,
} from '../model';
import { newId, nowIso } from '../model/factories';
import { action } from './action';
import { setOpinion } from './people';
import { getSettings, NotFoundError } from './records';

/**
 * Triage and bulk edit (PLAN.md §5.6, §5.7, M7). Every command takes one unit or many and
 * is one undo step, however many units it changes.
 */

const asList = (ids: ID | readonly ID[]): ID[] => (Array.isArray(ids) ? [...ids] : [ids as ID]);

/**
 * What "Edit together" can set (Q20): any of these, for every selected unit. Utilities,
 * parking and storage change only the parts given, so "heat included" keeps each unit's
 * electric as it was.
 */
export interface UnitPatch {
  status?: UnitStatus;
  colorLabel?: LabelColor | null;
  laundry?: Unit['laundry'];
  dishwasher?: Unit['dishwasher'];
  acType?: Unit['acType'];
  heatingType?: Unit['heatingType'];
  leaseTermsMonths?: Unit['leaseTermsMonths'];
  availableDate?: Unit['availableDate'];
  utilities?: Partial<Record<UtilityKey, UtilityTerm | null>>;
  parking?: Partial<Unit['parking']>;
  storage?: Partial<Unit['storage']>;
}

export function applyPatch(u: Unit, patch: UnitPatch): Unit {
  const { utilities, parking, storage, ...plain } = patch;
  return {
    ...u,
    ...plain,
    utilities: utilities ? { ...u.utilities, ...utilities } : u.utilities,
    parking: parking ? { ...u.parking, ...parking } : u.parking,
    storage: storage ? { ...u.storage, ...storage } : u.storage,
  };
}

/** Sets the same values on several units (one undo step). Returns how many changed. */
export async function updateUnits(
  db: RentalDB,
  unitIds: ID | readonly ID[],
  patch: UnitPatch,
  label = 'Edit units',
): Promise<number> {
  const ids = asList(unitIds);
  const { value } = await action(db, label, async () => {
    const at = nowIso();
    let changed = 0;
    for (const id of ids) {
      const current = await db.units.get(id);
      if (!current || current.deletedAt) throw new NotFoundError('Unit', id);
      const next = unitSchema.parse(applyPatch(current, patch));
      if (JSON.stringify(next) === JSON.stringify(current)) continue;
      await db.units.put({ ...next, updatedAt: at });
      changed++;
    }
    return changed;
  });
  return value;
}

export const setStatus = (db: RentalDB, unitIds: ID | readonly ID[], status: UnitStatus) =>
  updateUnits(db, unitIds, { status }, 'Set status');

export const setSharedLabel = (
  db: RentalDB,
  unitIds: ID | readonly ID[],
  colorLabel: LabelColor | null,
) => updateUnits(db, unitIds, { colorLabel }, 'Set shared label');

// ── Rejecting with reasons ─────────────────────────────────────────────────

export interface RejectInput {
  /** Saved reasons, by id. */
  reasonIds: ID[];
  /** New reasons typed in the dialog: added to the saved list (or matched to one there). */
  newReasons?: string[];
  /** Free text, kept as the flag note. */
  note?: string | null;
}

/**
 * Rejects units for one person with reasons (spec §6): saved reasons plus any new ones,
 * which join the reusable list, and an optional note. One undo step for all of it.
 */
export async function rejectUnits(
  db: RentalDB,
  unitIds: ID | readonly ID[],
  personId: ID,
  input: RejectInput,
): Promise<void> {
  const ids = asList(unitIds);
  await action(db, 'Reject', async () => {
    const reasonIds = [...input.reasonIds];
    const typed = (input.newReasons ?? []).map(cleanReason).filter((r): r is string => !!r);
    if (typed.length) {
      const current = await getSettings(db);
      const next = structuredClone(current);
      for (const label of typed) {
        const found = findReason(next.rejectReasons, label);
        if (found) {
          found.archived = false;
          reasonIds.push(found.id);
        } else {
          const id = newId();
          next.rejectReasons.push({ id, label, archived: false });
          reasonIds.push(id);
        }
      }
      await db.settings.put(settingsSchema.parse(next));
    }
    const note = input.note?.trim() || null;
    await setOpinion(db, ids, personId, {
      flag: 'reject',
      rejectReasonIds: [...new Set(reasonIds)],
      ...(input.note !== undefined ? { flagNote: note } : {}),
    });
  });
}

// ── Notes log ──────────────────────────────────────────────────────────────

export async function updateNote(
  db: RentalDB,
  id: ID,
  changes: Partial<Pick<NoteEntry, 'text' | 'kind'>>,
): Promise<NoteEntry> {
  const { value } = await action(db, 'Edit note', async () => {
    const current = await db.notes.get(id);
    if (!current || current.deletedAt) throw new NotFoundError('Note', id);
    const next = noteEntry.parse({ ...current, ...changes, updatedAt: nowIso() });
    await db.notes.put(next);
    return next;
  });
  return value;
}

/** Soft-deletes a note (one undo step). */
export async function deleteNote(db: RentalDB, id: ID): Promise<string> {
  const { actionId } = await action(db, 'Delete note', async () => {
    const current = await db.notes.get(id);
    if (!current || current.deletedAt) throw new NotFoundError('Note', id);
    const at = nowIso();
    await db.notes.put({ ...current, deletedAt: at, updatedAt: at });
  });
  return actionId;
}

// ── Labels and reasons (Settings) ──────────────────────────────────────────

async function changeSettings(db: RentalDB, label: string, change: (s: Settings) => void) {
  await action(db, label, async () => {
    const next = structuredClone(await getSettings(db));
    change(next);
    await db.settings.put(settingsSchema.parse(next));
  });
}

/** Names a shared label ("Blue" → "Roommate likes"); empty goes back to the color's name. */
export const nameSharedLabel = (db: RentalDB, color: LabelColor, name: string) =>
  changeSettings(db, 'Name shared label', (s) => {
    s.labelNames[color] = cleanReason(name) ?? color.charAt(0).toUpperCase() + color.slice(1);
  });

export class ReasonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReasonError';
  }
}

export async function addReason(db: RentalDB, label: string): Promise<ID> {
  const clean = cleanReason(label);
  if (!clean) throw new ReasonError('Enter a reason.');
  const current = await getSettings(db);
  const found = findReason(current.rejectReasons, clean);
  if (found && !found.archived) throw new ReasonError(`“${found.label}” is already a reason.`);
  const id = found?.id ?? newId();
  await changeSettings(db, 'Add reject reason', (s) => {
    const existing = s.rejectReasons.find((r) => r.id === id);
    if (existing) existing.archived = false;
    else s.rejectReasons.push({ id, label: clean, archived: false });
  });
  return id;
}

export async function renameReason(db: RentalDB, id: ID, label: string): Promise<void> {
  const clean = cleanReason(label);
  if (!clean) throw new ReasonError('Enter a reason.');
  const current = await getSettings(db);
  const other = findReason(current.rejectReasons, clean);
  if (other && other.id !== id) throw new ReasonError(`“${other.label}” is already a reason.`);
  await changeSettings(db, 'Rename reject reason', (s) => {
    const r = s.rejectReasons.find((x) => x.id === id);
    if (!r) throw new NotFoundError('Reason', id);
    r.label = clean;
  });
}

/**
 * Archived reasons leave the Reject dialog but stay on the units that have them, so
 * filtering by them (M10) still works.
 */
export const setReasonArchived = (db: RentalDB, id: ID, archived: boolean) =>
  changeSettings(db, archived ? 'Archive reject reason' : 'Bring back reject reason', (s) => {
    const r = s.rejectReasons.find((x) => x.id === id);
    if (!r) throw new NotFoundError('Reason', id);
    r.archived = archived;
  });
