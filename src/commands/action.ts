import Dexie from 'dexie';
import { CHANGE_LOG_TABLE, getWriteContext, setWriteContext } from '../db/changeLog';
import type { ActionContext, ActionKind } from '../db/changeLog';
import type { RentalDB } from '../db/db';
import { pruneChangeLog } from '../db/undo';
import { DATA_TABLES } from '../model';
import { newId, nowIso } from '../model/factories';

/**
 * action(label, fn) is the only way the UI writes data (PLAN.md §4.2, §5.6). Everything
 * `fn` writes happens in one transaction, is recorded in the change log under one action id,
 * and is undone or redone as one step. An action called inside another joins it.
 */

export interface ActionResult<T> {
  value: T;
  actionId: string;
  label: string;
}

export interface ActionEvent {
  actionId: string;
  label: string;
  kind: ActionKind;
}

type Listener = (event: ActionEvent) => void;
const listeners = new Set<Listener>();

/** Called after every committed action (toasts with Undo arrive in M6). */
export function onAction(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const WRITE_TABLES = [...DATA_TABLES, CHANGE_LOG_TABLE];

function currentContext(): ActionContext | undefined {
  const tx = Dexie.currentTransaction;
  const ctx = tx ? getWriteContext(tx.idbtrans) : undefined;
  return ctx && 'actionId' in ctx ? ctx : undefined;
}

/** The id of the action being run, inside an action's function (e.g. for an import record). */
export function currentActionId(): string | null {
  return currentContext()?.actionId ?? null;
}

export async function action<T>(
  db: RentalDB,
  label: string,
  fn: () => Promise<T>,
  options: { kind?: ActionKind; target?: string | null } = {},
): Promise<ActionResult<T>> {
  const outer = currentContext();
  if (outer) {
    return { value: await fn(), actionId: outer.actionId, label: outer.label };
  }

  const ctx: ActionContext = {
    actionId: newId(),
    label,
    kind: options.kind ?? 'do',
    target: options.target ?? null,
    at: nowIso(),
  };
  const value = await db.transaction('rw', WRITE_TABLES, async (tx) => {
    setWriteContext(tx.idbtrans, ctx);
    return fn();
  });

  await pruneChangeLog(db);
  const event = { actionId: ctx.actionId, label: ctx.label, kind: ctx.kind };
  listeners.forEach((listener) => listener(event));
  return { value, actionId: ctx.actionId, label };
}

/**
 * A write that is deliberately not undoable: restoring a backup (which clears history after
 * taking a snapshot) and test setup. Name the reason; it isn't stored, but makes call sites
 * easy to audit.
 */
export async function systemWrite<T>(
  db: RentalDB,
  reason: string,
  fn: () => Promise<T>,
  /** Other tables the write needs in the same transaction (e.g. snapshots for a restore). */
  extraTables: string[] = [],
): Promise<T> {
  return db.transaction('rw', [...WRITE_TABLES, ...extraTables], async (tx) => {
    setWriteContext(tx.idbtrans, { system: reason });
    return fn();
  });
}
