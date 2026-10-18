import type { ChangeEntry } from '../db/changeLog';
import type { RentalDB } from '../db/db';
import { readMeId } from '../db/me';
import { readStacks } from '../db/undo';
import {
  makeLookup,
  netChanges,
  planRevert,
  RESTORE_TO_LABEL,
  stateAfter,
  UNDO_THIS_LABEL,
} from '../domain/history';
import type { HistoryLookup, RevertPlan, Write } from '../domain/history';
import type { Building, ID, Unit } from '../model';
import { nowIso } from '../model/factories';
import { action } from './action';
import { NotFoundError } from './records';
import { HistoryChangedError, undo } from './undo';

/**
 * Going back in history (PLAN.md §5.6, owner notes for M7): Restore to here, Undo this,
 * and bringing back deleted units and buildings. Each is a new, undoable action, so the
 * history stays linear and honest.
 */

/** Everything describing history needs, deleted records included. */
export async function readLookup(db: RentalDB): Promise<HistoryLookup> {
  const [meId, buildings, units, people, settings] = await Promise.all([
    readMeId(db),
    db.buildings.toArray(),
    db.units.toArray(),
    db.people.toArray(),
    db.settings.get('app'),
  ]);
  return makeLookup({ meId, buildings, units, people, settings });
}

export async function entriesOf(db: RentalDB, actionId: string): Promise<ChangeEntry[]> {
  const entries = await db.changeLog.where('actionId').equals(actionId).toArray();
  return entries.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

async function applyWrites(db: RentalDB, writes: readonly Write[]) {
  for (const w of writes) {
    const table = db.table(w.table);
    if (w.value === null) await table.delete(w.key);
    else await table.put(w.value);
  }
}

async function currentValues(db: RentalDB, entries: readonly ChangeEntry[]) {
  const current = new Map<string, unknown>();
  for (const c of netChanges(entries)) {
    current.set(`${c.table}\u0000${c.key}`, (await db.table(c.table).get(c.key)) ?? null);
  }
  return current;
}

// ── Undo this ──────────────────────────────────────────────────────────────

export interface UndoThisPlan extends RevertPlan {
  /** It's the latest action: plain Undo does it (and Redo can bring it back). */
  latest: boolean;
}

/** What "Undo this" would do for one past action, before asking (clashes) or doing it. */
export async function planUndoThis(db: RentalDB, actionId: string): Promise<UndoThisPlan> {
  const entries = await entriesOf(db, actionId);
  if (!entries.length) throw new NotFoundError('Change', actionId);
  const { undo: stack } = await readStacks(db);
  const latest = stack.at(-1)?.actionId === actionId;
  const plan = planRevert(netChanges(entries), await currentValues(db, entries), nowIso());
  return { ...plan, latest };
}

/**
 * Undoes one past action on its own (owner note 3). `mode: 'safe'` leaves values that
 * were changed again later; `'all'` sets them back too. The latest action is undone with
 * plain Undo. Returns false when there was nothing left to undo.
 */
export async function undoThis(
  db: RentalDB,
  actionId: string,
  mode: 'safe' | 'all' = 'safe',
): Promise<boolean> {
  const plan = await planUndoThis(db, actionId);
  if (plan.latest && !plan.clashes.length) return (await undo(db))?.actionId === actionId;
  const writes = mode === 'all' ? plan.all : plan.safe;
  if (!writes.length) return false;
  await action(
    db,
    UNDO_THIS_LABEL,
    async () => {
      // Re-plan inside the transaction: another tab may have changed things since asking.
      const again = planRevert(
        netChanges(await entriesOf(db, actionId)),
        await currentValues(db, await entriesOf(db, actionId)),
        nowIso(),
      );
      if (JSON.stringify(again.clashes) !== JSON.stringify(plan.clashes))
        throw new HistoryChangedError();
      await applyWrites(db, mode === 'all' ? again.all : again.safe);
    },
    { target: actionId },
  );
  return true;
}

// ── Restore to here ────────────────────────────────────────────────────────

/**
 * Puts everything back the way it was right after an action (owner note 2), as one new
 * action. Returns how many records changed (0: nothing happened since).
 */
export async function restoreToHere(db: RentalDB, actionId: string): Promise<number> {
  const mine = await entriesOf(db, actionId);
  if (!mine.length) throw new NotFoundError('Change', actionId);
  const lastSeq = Math.max(...mine.map((e) => e.seq ?? 0));
  const later = await db.changeLog.where('seq').above(lastSeq).toArray();
  const writes = stateAfter(later);
  if (!writes.length) return 0;
  await action(
    db,
    RESTORE_TO_LABEL,
    async () => {
      const still = await db.changeLog.where('seq').above(lastSeq).count();
      if (still !== later.length) throw new HistoryChangedError();
      await applyWrites(db, writes);
    },
    { target: actionId },
  );
  return writes.length;
}

// ── Recently deleted ───────────────────────────────────────────────────────

export interface DeletedItem {
  kind: 'unit' | 'building';
  id: ID;
  deletedAt: string;
  unit?: Unit;
  building?: Building;
  /** A deleted building: how many of its units went with it. */
  unitCount: number;
}

/**
 * Units and buildings that were deleted (owner note 4), newest first. A unit deleted
 * together with its building is listed under the building.
 */
export async function listDeleted(db: RentalDB): Promise<DeletedItem[]> {
  const [buildings, units] = await Promise.all([db.buildings.toArray(), db.units.toArray()]);
  const byId = new Map(buildings.map((b) => [b.id, b]));
  const items: DeletedItem[] = [];
  for (const b of buildings) {
    if (!b.deletedAt) continue;
    const together = units.filter((u) => u.buildingId === b.id && u.deletedAt === b.deletedAt);
    items.push({
      kind: 'building',
      id: b.id,
      deletedAt: b.deletedAt,
      building: b,
      unitCount: together.length,
    });
  }
  for (const u of units) {
    if (!u.deletedAt) continue;
    const b = byId.get(u.buildingId);
    if (b?.deletedAt && b.deletedAt === u.deletedAt) continue; // listed with its building
    items.push({
      kind: 'unit',
      id: u.id,
      deletedAt: u.deletedAt,
      unit: u,
      building: b,
      unitCount: 0,
    });
  }
  return items.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
}

/**
 * Brings back a deleted unit (and its building, if that was deleted too) or a deleted
 * building with the units deleted along with it. One undo step.
 */
export async function restoreDeleted(
  db: RentalDB,
  kind: 'unit' | 'building',
  id: ID,
): Promise<string> {
  const { actionId } = await action(
    db,
    kind === 'unit' ? 'Restore unit' : 'Restore building',
    async () => {
      const at = nowIso();
      const back = async (table: 'units' | 'buildings', record: Unit | Building) => {
        if (record.deletedAt)
          await db.table(table).put({ ...record, deletedAt: null, updatedAt: at });
      };
      if (kind === 'unit') {
        const u = await db.units.get(id);
        if (!u) throw new NotFoundError('Unit', id);
        await back('units', u);
        const b = await db.buildings.get(u.buildingId);
        if (b?.deletedAt) await back('buildings', b);
        return;
      }
      const b = await db.buildings.get(id);
      if (!b) throw new NotFoundError('Building', id);
      const units = await db.units.where('buildingId').equals(id).toArray();
      for (const u of units) if (u.deletedAt && u.deletedAt === b.deletedAt) await back('units', u);
      await back('buildings', b);
    },
  );
  return actionId;
}
