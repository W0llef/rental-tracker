import { onAction } from '../commands/action';
import type { ActionEvent } from '../commands/action';
import { entriesOf, planUndoThis, readLookup, undoThis } from '../commands/history';
import { redo } from '../commands/undo';
import type { RentalDB } from '../db/db';
import { readStacks } from '../db/undo';
import { describeAction } from '../domain/history';
import { whenLabel } from '../domain/format';
import { useUi } from './ui';

/**
 * A toast after every action, with Undo (PLAN.md §5.6): "Flagged Unit 1504 as pick · Undo".
 * After an undo the toast offers Redo. The words come from the change log's before/after
 * records (domain/history.ts), like the History panel's.
 */

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Undo from a toast: the action on its own, leaving anything changed since (and saying so). */
export async function undoFromToast(db: RentalDB, actionId: string): Promise<void> {
  const ui = useUi.getState();
  try {
    const plan = await planUndoThis(db, actionId);
    if (!plan.safe.length && !plan.clashes.length) {
      ui.showNotice('That’s already undone.');
      return;
    }
    await undoThis(db, actionId, 'safe');
    if (plan.clashes.length)
      ui.showNotice(
        `Undone, except ${plural(plan.clashes.length, 'value')} changed again since. History shows them.`,
        '/history',
      );
  } catch (e) {
    ui.showNotice(`Couldn’t undo. ${e instanceof Error ? e.message : ''}`.trim());
  }
}

async function redoFromToast(db: RentalDB, undoneId: string | null): Promise<void> {
  const ui = useUi.getState();
  const { redo: stack } = await readStacks(db);
  if (!undoneId || stack.at(-1)?.actionId !== undoneId) {
    ui.showNotice('Couldn’t redo: something else changed since. Use History to go back.');
    return;
  }
  await redo(db);
}

async function describeEvent(db: RentalDB, e: ActionEvent): Promise<string | null> {
  const [entries, lookup] = await Promise.all([entriesOf(db, e.actionId), readLookup(db)]);
  const head = entries[0];
  if (!head) return null; // nothing changed (e.g. rating a unit the stars it already has)
  const target = head.target ? await entriesOf(db, head.target) : null;
  const info = {
    actionId: e.actionId,
    label: e.label,
    kind: e.kind,
    target: head.target,
    at: head.at,
  };
  return describeAction(info, entries, lookup, target, (iso) => whenLabel(iso)).title;
}

/** Shows a toast for every action from now on (registered once at startup). */
export function watchActionsForToasts(db: RentalDB): () => void {
  let latest: string | null = null;
  return onAction((e) => {
    const since = Date.now();
    latest = e.actionId;
    const button =
      e.kind === 'undo'
        ? {
            label: 'Redo',
            run: () => void readTarget(db, e.actionId).then((t) => redoFromToast(db, t)),
          }
        : { label: 'Undo', run: () => void undoFromToast(db, e.actionId) };
    void describeEvent(db, e)
      .then((text) => {
        // A later action's toast replaces this one; don't show it after that.
        if (text && latest === e.actionId)
          useUi.getState().showActionToast({ actionId: e.actionId, text, button, since });
      })
      .catch(() => undefined);
  });
}

/** The action an undo undid. */
async function readTarget(db: RentalDB, undoId: string): Promise<string | null> {
  const [head] = await entriesOf(db, undoId);
  return head?.target ?? null;
}
