import Dexie from 'dexie';
import type {
  DBCore,
  DBCoreMutateRequest,
  DBCoreMutateResponse,
  DBCoreTable,
  DBCoreTransaction,
  Middleware,
} from 'dexie';
import { DATA_TABLES } from '../model';

/**
 * Change log (PLAN.md §5.6). A DBCore middleware records `{actionId, table, key, before,
 * after}` for every write to a data table, so nothing can be written without being undoable.
 *
 * Writes to data tables must happen inside an action (commands/action.ts) or a declared
 * system write (restore, tests); anything else throws. Dexie upgrade transactions
 * (migrations) are exempt: they run before the app can record anything.
 */

export type ActionKind = 'do' | 'undo' | 'redo';

/** One stored change: a record's value before and after one write. */
export interface ChangeEntry {
  seq?: number;
  actionId: string;
  at: string;
  label: string;
  kind: ActionKind;
  /** For undo/redo: the original action being undone or redone. */
  target: string | null;
  table: string;
  key: string;
  /** null = the record didn't exist. */
  before: unknown;
  /** null = the record doesn't exist afterwards (hard delete). */
  after: unknown;
}

export interface ActionContext {
  actionId: string;
  label: string;
  kind: ActionKind;
  target: string | null;
  at: string;
}

/** What a transaction is allowed to do with data tables. */
export type WriteContext = ActionContext | { system: string };

const contexts = new WeakMap<DBCoreTransaction, WriteContext>();

/** Marks a Dexie transaction (by its underlying IDB transaction) as an action or system write. */
export function setWriteContext(trans: DBCoreTransaction, ctx: WriteContext) {
  contexts.set(trans, ctx);
}

export function getWriteContext(trans: DBCoreTransaction): WriteContext | undefined {
  return contexts.get(trans);
}

export const CHANGE_LOG_TABLE = 'changeLog';
const TRACKED = new Set<string>(DATA_TABLES);

export class UntrackedWriteError extends Error {
  constructor(table: string) {
    super(
      `Writes to "${table}" must go through a command (commands/action.ts) so they can be undone.`,
    );
    this.name = 'UntrackedWriteError';
  }
}

function isVersionChange(trans: DBCoreTransaction) {
  return (trans as unknown as IDBTransaction).mode === 'versionchange';
}

/**
 * Keys a put/add/delete request will touch (deleteRange is resolved separately by
 * querying the range first).
 */
function requestKeys(
  table: DBCoreTable,
  req: Exclude<DBCoreMutateRequest, { type: 'deleteRange' }>,
) {
  if (req.type === 'delete') return req.keys as string[];
  const pk = table.schema.primaryKey;
  const keys = new Set<string>();
  if (req.keys) req.keys.forEach((k) => keys.add(k as string));
  else req.values.forEach((v) => keys.add(pk.extractKey?.(v) as string));
  if (req.type === 'put' && req.updates) req.updates.keys.forEach((k) => keys.add(k as string));
  return [...keys].filter((k) => k !== undefined);
}

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/*
 * Note: the steps below are chained with .then() on the promises Dexie returns, not with
 * async/await. Dexie keeps track of the current transaction through its own promises; a
 * native await inside a middleware can lose it (bulkUpdate showed this).
 */
export function changeLogMiddleware(): Middleware<DBCore> {
  return {
    stack: 'dbcore',
    name: 'changeLog',
    create(down) {
      return {
        ...down,
        table(name) {
          const table = down.table(name);
          if (!TRACKED.has(name)) return table;

          const logged = (
            req: DBCoreMutateRequest,
            ctx: ActionContext,
            keys: string[],
          ): Promise<DBCoreMutateResponse> => {
            const { trans } = req;
            return table.getMany({ trans, keys }).then((before) =>
              table
                // deleteRange becomes a keyed delete, so exactly the logged keys go.
                .mutate(req.type === 'deleteRange' ? { type: 'delete', trans, keys } : req)
                .then((res) =>
                  table.getMany({ trans, keys }).then((after) => {
                    const entries: ChangeEntry[] = [];
                    keys.forEach((key, i) => {
                      const b = before[i] ?? null;
                      const a = after[i] ?? null;
                      if (sameValue(b, a)) return;
                      entries.push({
                        actionId: ctx.actionId,
                        at: ctx.at,
                        label: ctx.label,
                        kind: ctx.kind,
                        target: ctx.target,
                        table: name,
                        key,
                        before: b,
                        after: a,
                      });
                    });
                    if (!entries.length) return res;
                    return down
                      .table(CHANGE_LOG_TABLE)
                      .mutate({ type: 'add', trans, values: entries })
                      .then(() => res);
                  }),
                ),
            );
          };

          return {
            ...table,
            mutate(req) {
              if (isVersionChange(req.trans)) return table.mutate(req);
              const ctx = getWriteContext(req.trans);
              if (!ctx) return Dexie.Promise.reject(new UntrackedWriteError(name));
              if ('system' in ctx) return table.mutate(req);
              if (req.type !== 'deleteRange') return logged(req, ctx, requestKeys(table, req));
              return table
                .query({
                  trans: req.trans,
                  values: false,
                  query: { index: table.schema.primaryKey, range: req.range },
                })
                .then((res) => logged(req, ctx, res.result as string[]));
            },
          };
        },
      };
    },
  };
}
