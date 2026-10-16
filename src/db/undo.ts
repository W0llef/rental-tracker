import type { ActionKind, ChangeEntry } from './changeLog';
import type { RentalDB } from './db';

/**
 * Undo/redo stacks over change-log actions (PLAN.md §5.6).
 *
 * The stacks aren't stored anywhere: they're derived from the change log, which is the one
 * record of what happened. That keeps them correct after a reload and in step with pruning.
 * Undo and redo are themselves actions in the log, so history stays linear and honest:
 *   do X        → X goes on the undo stack, the redo stack is cleared
 *   undo of X   → X moves from the undo stack to the redo stack
 *   redo of X   → X moves back to the undo stack
 */

export interface ActionSummary {
  actionId: string;
  label: string;
  kind: ActionKind;
  target: string | null;
  at: string;
  /** Number of records the action changed. */
  changes: number;
  /** Lowest change-log sequence number of the action (its position in history). */
  firstSeq: number;
}

/** Groups change-log entries (in seq order) into actions, oldest first. */
export function groupActions(entries: ChangeEntry[]): ActionSummary[] {
  const byId = new Map<string, ActionSummary>();
  for (const e of entries) {
    const existing = byId.get(e.actionId);
    if (existing) {
      existing.changes++;
      continue;
    }
    byId.set(e.actionId, {
      actionId: e.actionId,
      label: e.label,
      kind: e.kind,
      target: e.target,
      at: e.at,
      changes: 1,
      firstSeq: e.seq ?? 0,
    });
  }
  return [...byId.values()].sort((a, b) => a.firstSeq - b.firstSeq);
}

export interface Stacks {
  /** Actions that can be undone; the last one is undone next. */
  undo: ActionSummary[];
  /** Actions that can be redone; the last one is redone next. */
  redo: ActionSummary[];
}

export function deriveStacks(actions: ActionSummary[]): Stacks {
  const undo: ActionSummary[] = [];
  let redo: ActionSummary[] = [];
  const removeFrom = (stack: ActionSummary[], id: string | null) => {
    const i = stack.findIndex((a) => a.actionId === id);
    if (i === -1) return null;
    return stack.splice(i, 1)[0] ?? null;
  };

  for (const a of actions) {
    if (a.kind === 'do') {
      undo.push(a);
      redo = [];
    } else if (a.kind === 'undo') {
      const target = removeFrom(undo, a.target);
      if (target) redo.push(target);
    } else {
      const target = removeFrom(redo, a.target);
      if (target) undo.push(target);
    }
  }
  return { undo, redo };
}

export async function readStacks(db: RentalDB): Promise<Stacks> {
  const entries = await db.changeLog.orderBy('seq').toArray();
  return deriveStacks(groupActions(entries));
}

/** The newest actions first, for the history list. */
export async function recentActions(db: RentalDB, limit = 20): Promise<ActionSummary[]> {
  const entries = await db.changeLog.orderBy('seq').toArray();
  return groupActions(entries).reverse().slice(0, limit);
}

// ── Retention ──────────────────────────────────────────────────────────────

/** The change log keeps 90 days or 10,000 entries, whichever is smaller (§5.6). */
export const LOG_MAX_ENTRIES = 10_000;
export const LOG_MAX_DAYS = 90;

/**
 * Drops the oldest entries beyond the limits. Whole actions only: if the cut falls inside
 * an action, the rest of that action goes too, so nothing half-undoable remains.
 */
export async function pruneChangeLog(
  db: RentalDB,
  now: Date = new Date(),
  limits = { maxEntries: LOG_MAX_ENTRIES, maxDays: LOG_MAX_DAYS },
): Promise<number> {
  const cutoffAt = new Date(now.getTime() - limits.maxDays * 86_400_000).toISOString();
  const total = await db.changeLog.count();
  const overflow = Math.max(0, total - limits.maxEntries);
  const tooOld = await db.changeLog.where('at').below(cutoffAt).count();
  if (overflow === 0 && tooOld === 0) return 0;

  return db.transaction('rw', db.changeLog, async () => {
    const oldest = await db.changeLog.orderBy('seq').limit(Math.max(overflow, 1)).toArray();
    let cutSeq = overflow > 0 ? (oldest[oldest.length - 1]?.seq ?? 0) : 0;
    const lastOld = await db.changeLog.where('at').below(cutoffAt).toArray();
    for (const e of lastOld) cutSeq = Math.max(cutSeq, e.seq ?? 0);

    // Extend the cut to the end of any action it splits.
    const cutEntry = await db.changeLog.get(cutSeq);
    if (cutEntry) {
      const sameAction = await db.changeLog.where('actionId').equals(cutEntry.actionId).toArray();
      for (const e of sameAction) cutSeq = Math.max(cutSeq, e.seq ?? 0);
    }
    return db.changeLog.where('seq').belowOrEqual(cutSeq).delete();
  });
}
