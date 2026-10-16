import type { ChangeEntry } from '../db/changeLog';
import type { RentalDB } from '../db/db';
import { readStacks } from '../db/undo';
import type { ActionSummary } from '../db/undo';
import { action } from './action';

/**
 * Undo writes the `before` values of the last action in reverse order; redo re-applies the
 * `after` values in order (PLAN.md §5.6). Both are recorded as actions themselves.
 * They return the action that was undone or redone, or null when there's nothing to do.
 */

async function apply(db: RentalDB, entries: ChangeEntry[], side: 'before' | 'after') {
  for (const e of entries) {
    const value = e[side];
    const table = db.table(e.table);
    if (value === null || value === undefined) await table.delete(e.key);
    else await table.put(value);
  }
}

async function entriesOf(db: RentalDB, actionId: string) {
  const entries = await db.changeLog.where('actionId').equals(actionId).toArray();
  return entries.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}

export async function undo(db: RentalDB): Promise<ActionSummary | null> {
  const { undo: stack } = await readStacks(db);
  const target = stack.at(-1);
  if (!target) return null;
  await action(
    db,
    `Undo: ${target.label}`,
    async () => {
      // Re-check inside the transaction, in case another tab changed history meanwhile.
      const { undo: current } = await readStacks(db);
      if (current.at(-1)?.actionId !== target.actionId) throw new HistoryChangedError();
      const entries = await entriesOf(db, target.actionId);
      await apply(db, entries.reverse(), 'before');
    },
    { kind: 'undo', target: target.actionId },
  );
  return target;
}

export async function redo(db: RentalDB): Promise<ActionSummary | null> {
  const { redo: stack } = await readStacks(db);
  const target = stack.at(-1);
  if (!target) return null;
  await action(
    db,
    `Redo: ${target.label}`,
    async () => {
      const { redo: current } = await readStacks(db);
      if (current.at(-1)?.actionId !== target.actionId) throw new HistoryChangedError();
      await apply(db, await entriesOf(db, target.actionId), 'after');
    },
    { kind: 'redo', target: target.actionId },
  );
  return target;
}

export class HistoryChangedError extends Error {
  constructor() {
    super('The history changed while undoing (another tab?). Try again.');
    this.name = 'HistoryChangedError';
  }
}
