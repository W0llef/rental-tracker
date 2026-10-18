import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  listDeleted,
  planUndoThis,
  readLookup,
  restoreDeleted,
  restoreToHere,
  undoThis,
} from '../../commands/history';
import type { DeletedItem, UndoThisPlan } from '../../commands/history';
import type { ChangeEntry } from '../../db/changeLog';
import { db } from '../../db/db';
import { deriveStacks, groupActions } from '../../db/undo';
import type { ActionSummary } from '../../db/undo';
import { buildingName, unitFullName, whenLabel } from '../../domain/format';
import { describeAction, describeClash, UNDO_THIS_LABEL } from '../../domain/history';
import type { Description, HistoryLookup } from '../../domain/history';
import type { Dataset } from '../../state/derive';
import styles from './history.module.css';

/**
 * History (PLAN.md §5.6, owner notes for M7; DESIGN.md §4.1 "History" panel): every change,
 * newest first, said specifically; **Undo this** for any one of them, **Restore to here**
 * to go back to a point, and the **Deleted** list with Restore. Shown in the detail column
 * (#/history, or #/history?unit=<id> for one unit).
 */

const PAGE = 40;

type Tab = 'all' | 'unit' | 'deleted';

interface Row {
  action: ActionSummary;
  description: Description;
  /** Undone (by Undo or "Undo this") and not redone. */
  undone: boolean;
}

async function readHistory(): Promise<{ entries: ChangeEntry[]; lookup: HistoryLookup }> {
  const [entries, lookup] = await Promise.all([
    db.changeLog.orderBy('seq').toArray(),
    readLookup(db),
  ]);
  return { entries, lookup };
}

function useRows() {
  const raw = useLiveQuery(readHistory, []);
  return useMemo((): Row[] | undefined => {
    if (!raw) return undefined;
    const byAction = new Map<string, ChangeEntry[]>();
    for (const e of raw.entries) {
      const list = byAction.get(e.actionId);
      if (list) list.push(e);
      else byAction.set(e.actionId, [e]);
    }
    const actions = groupActions(raw.entries);
    const stacks = deriveStacks(actions);
    const undone = new Set(stacks.redo.map((a) => a.actionId));
    for (const a of actions) {
      if (a.kind === 'do' && a.label === UNDO_THIS_LABEL && a.target) undone.add(a.target);
    }
    return actions
      .map((action) => ({
        action,
        description: describeAction(
          action,
          byAction.get(action.actionId) ?? [],
          raw.lookup,
          action.target ? (byAction.get(action.target) ?? null) : null,
          (iso) => whenLabel(iso),
        ),
        undone: undone.has(action.actionId),
      }))
      .reverse();
  }, [raw]);
}

function UndoThisConfirm({
  row,
  plan,
  lookup,
  onDone,
}: {
  row: Row;
  plan: UndoThisPlan;
  lookup: HistoryLookup | undefined;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (mode: 'safe' | 'all') => {
    setBusy(true);
    try {
      await undoThis(db, row.action.actionId, mode);
      onDone();
    } catch (e) {
      setError(`Couldn’t undo. ${e instanceof Error ? e.message : ''}`.trim());
      setBusy(false);
    }
  };
  return (
    <div className={styles.confirm} role="group" aria-label="Changed since">
      <p className={styles.confirmText}>
        Some of this was changed again afterwards. Undoing it would overwrite:
      </p>
      <ul className={styles.clashes}>
        {plan.clashes.map((c, i) => (
          <li key={i}>{lookup ? describeClash(c, lookup) : 'A later change'}</li>
        ))}
      </ul>
      <div className={styles.confirmActions}>
        <button
          type="button"
          className={styles.primary}
          disabled={busy || !plan.safe.length}
          onClick={() => void run('safe')}
          title={plan.safe.length ? undefined : 'Everything it changed was changed again since'}
        >
          Undo the rest
        </button>
        <button
          type="button"
          className={styles.secondary}
          disabled={busy}
          onClick={() => void run('all')}
        >
          Undo all of it
        </button>
        <button type="button" className={styles.textButton} onClick={onDone}>
          Cancel
        </button>
      </div>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function HistoryRow({
  row,
  latest,
  lookup,
}: {
  row: Row;
  latest: boolean;
  lookup: HistoryLookup | undefined;
}) {
  const [asking, setAsking] = useState<null | 'restore' | { plan: UndoThisPlan }>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { action, description } = row;
  const when = whenLabel(action.at);
  const kindTag =
    action.kind === 'undo' || action.label === UNDO_THIS_LABEL
      ? 'Undo'
      : action.kind === 'redo'
        ? 'Redo'
        : null;

  async function startUndo() {
    setMessage(null);
    setBusy(true);
    try {
      const plan = await planUndoThis(db, action.actionId);
      if (!plan.safe.length && !plan.clashes.length) setMessage('Nothing left to undo here.');
      else if (plan.clashes.length) setAsking({ plan });
      else await undoThis(db, action.actionId, 'safe');
    } catch (e) {
      setMessage(`Couldn’t undo. ${e instanceof Error ? e.message : ''}`.trim());
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    setBusy(true);
    try {
      const n = await restoreToHere(db, action.actionId);
      if (!n) setMessage('Nothing has changed since.');
      setAsking(null);
    } catch (e) {
      setMessage(`Couldn’t go back. ${e instanceof Error ? e.message : ''}`.trim());
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={styles.row} data-undone={row.undone || undefined}>
      <div className={styles.rowHead}>
        <time className={styles.when} dateTime={action.at}>
          {when}
        </time>
        {kindTag && <span className={styles.tag}>{kindTag}</span>}
        {row.undone && <span className={styles.tag}>Undone</span>}
      </div>
      <p className={styles.title}>{description.title}</p>
      {description.details.length > 1 && (
        <details className={styles.details}>
          <summary>
            {description.details.length} changes
            <span className={styles.visuallyHidden}>: show</span>
          </summary>
          <ul>
            {description.details.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </details>
      )}
      <div className={styles.actions}>
        {action.kind === 'do' && !row.undone && (
          <button
            type="button"
            className={styles.textButton}
            disabled={busy}
            onClick={() => void startUndo()}
          >
            Undo this<span className={styles.visuallyHidden}>: {description.title}</span>
          </button>
        )}
        {!latest && (
          <button
            type="button"
            className={styles.textButton}
            disabled={busy}
            onClick={() => setAsking('restore')}
          >
            Restore to here<span className={styles.visuallyHidden}> ({when})</span>
          </button>
        )}
      </div>
      {asking === 'restore' && (
        <div className={styles.confirm} role="group" aria-label="Restore to here">
          <p className={styles.confirmText}>
            Put everything back the way it was right after this ({when})? Everything since is
            reversed as one step, which you can undo.
          </p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => void restore()}
            >
              Restore to here
            </button>
            <button type="button" className={styles.textButton} onClick={() => setAsking(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {asking && asking !== 'restore' && (
        <UndoThisConfirm
          row={row}
          plan={asking.plan}
          lookup={lookup}
          onDone={() => setAsking(null)}
        />
      )}
      {message && (
        <p className={styles.message} role="status">
          {message}
        </p>
      )}
    </li>
  );
}

function DeletedList() {
  const items = useLiveQuery(() => listDeleted(db), []);
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  if (!items) return null;
  if (!items.length) return <p className={styles.muted}>Nothing has been deleted.</p>;
  const name = (i: DeletedItem) =>
    i.kind === 'unit' && i.unit
      ? unitFullName(i.unit, i.building)
      : i.building
        ? buildingName(i.building)
        : 'Building';
  return (
    <>
      <ul className={styles.list}>
        {items.map((i) => (
          <li key={`${i.kind}:${i.id}`} className={styles.deleted}>
            <span>
              <b>{name(i)}</b>
              {i.kind === 'building' && i.unitCount > 0 && (
                <> and {i.unitCount === 1 ? 'its unit' : `its ${i.unitCount} units`}</>
              )}
              <span className={styles.when}> · deleted {whenLabel(i.deletedAt)}</span>
            </span>
            <button
              type="button"
              className={styles.secondary}
              onClick={() =>
                void restoreDeleted(db, i.kind, i.id)
                  .then(() => navigate(`/${i.kind}/${i.id}`))
                  .catch((e: unknown) => setError(`Couldn’t restore. ${(e as Error).message}`))
              }
            >
              Restore<span className={styles.visuallyHidden}> {name(i)}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export function HistoryPanel({ data, unitId }: { data: Dataset; unitId: string | null }) {
  const rows = useRows();
  const lookup = useLiveQuery(() => readLookup(db), []);
  const unitRow = unitId ? data.unitById.get(unitId) : undefined;
  const unitName = unitRow ? unitFullName(unitRow.unit, unitRow.building) : null;
  const [tab, setTab] = useState<Tab>(unitId ? 'unit' : 'all');
  const [shown, setShown] = useState(PAGE);

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (tab === 'unit' && unitId) return rows.filter((r) => r.description.unitIds.includes(unitId));
    return rows;
  }, [rows, tab, unitId]);
  const latestId = rows?.[0]?.action.actionId;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'all', label: 'Everything' },
    ...(unitId ? [{ id: 'unit' as const, label: 'This unit' }] : []),
    { id: 'deleted', label: 'Deleted' },
  ];

  return (
    <article className={styles.panel} aria-labelledby="history-title">
      <header className={styles.head}>
        <h2 id="history-title" className={styles.heading}>
          History
        </h2>
        <p className={styles.muted}>
          {tab === 'unit' && unitName ? (
            <>
              Changes to <Link to={`/unit/${unitId}`}>{unitName}</Link>.{' '}
            </>
          ) : null}
          Kept for 90 days. Undo this reverses one change; Restore to here goes back to a point.
          Both can be undone.
        </p>
        <div className={styles.tabs} role="group" aria-label="Show">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setShown(PAGE);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>
      {tab === 'deleted' ? (
        <DeletedList />
      ) : !rows ? null : filtered.length === 0 ? (
        <p className={styles.muted}>
          {tab === 'unit' ? 'No changes to this unit yet.' : 'No changes yet.'}
        </p>
      ) : (
        <>
          <ol className={styles.list}>
            {filtered.slice(0, shown).map((r) => (
              <HistoryRow
                key={r.action.actionId}
                row={r}
                latest={r.action.actionId === latestId}
                lookup={lookup}
              />
            ))}
          </ol>
          {filtered.length > shown && (
            <button
              type="button"
              className={styles.secondary}
              onClick={() => setShown((n) => n + PAGE)}
            >
              Show {Math.min(PAGE, filtered.length - shown)} more
            </button>
          )}
        </>
      )}
    </article>
  );
}
