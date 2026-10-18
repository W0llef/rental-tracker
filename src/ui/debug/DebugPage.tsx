import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createBuilding, createUnit, deleteUnit, updateUnit } from '../../commands/records';
import { redo, undo } from '../../commands/undo';
import { appInfo, dbName } from '../../config';
import { db } from '../../db/db';
import { readStacks, recentActions } from '../../db/undo';
import { SCHEMA_VERSION } from '../../model';
import type { DataTable } from '../../model';
import { makeAddress } from '../../model/factories';
import { PreviewBanner } from '../shell/PreviewBanner';
import styles from './DebugPage.module.css';

/**
 * Data check (#/debug): what's in this build's database, the undo history, and, on preview
 * and development builds only, buttons that load sample data and make test changes.
 * It's a developer page for M1; the real list, map and triage arrive in later milestones.
 */

const TABLES: { table: DataTable; label: string }[] = [
  { table: 'buildings', label: 'Buildings' },
  { table: 'units', label: 'Units' },
  { table: 'people', label: 'People' },
  { table: 'opinions', label: 'Ratings and flags' },
  { table: 'listings', label: 'Listings' },
  { table: 'notes', label: 'Notes' },
  { table: 'collections', label: 'Collections' },
  { table: 'destinations', label: 'Destinations' },
  { table: 'photos', label: 'Photos' },
  { table: 'imports', label: 'Imports' },
];

const canEditSampleData = appInfo.channel !== 'live';

async function readCounts() {
  return Promise.all(
    TABLES.map(async ({ table, label }) => {
      const total = await db.table(table).count();
      const deleted = await db
        .table<{ deletedAt: string | null }>(table)
        .filter((r) => !!r.deletedAt)
        .count();
      return { table, label, active: total - deleted, deleted };
    }),
  );
}

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

const money = (usd: number) => `$${usd.toLocaleString('en-US')}`;

const randomRent = () => 1200 + Math.round(Math.random() * 80) * 10;

export function DebugPage() {
  const counts = useLiveQuery(readCounts, []);
  const stacks = useLiveQuery(() => readStacks(db), []);
  const history = useLiveQuery(() => recentActions(db, 15), []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  const run = async (work: () => Promise<string>) => {
    setBusy(true);
    try {
      setMessage({ text: await work() });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(false);
    }
  };

  const nextUndo = stacks?.undo.at(-1);
  const nextRedo = stacks?.redo.at(-1);

  const activeUnits = () => db.units.filter((u) => !u.deletedAt).sortBy('id');

  return (
    <div className={styles.page}>
      <PreviewBanner />
      <header className={styles.top}>
        <Link to="/" className={styles.back}>
          ← Back to the app
        </Link>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Data check</h1>
        <p className={styles.lead}>
          What this build has stored, and its undo history. Database <code>{dbName}</code>, data
          format version {SCHEMA_VERSION}.
        </p>

        <section className={styles.section} aria-labelledby="records-heading">
          <h2 id="records-heading" className={styles.heading}>
            Records
          </h2>
          <table className={styles.table} data-testid="record-counts">
            <thead>
              <tr>
                <th scope="col">Table</th>
                <th scope="col">Stored</th>
                <th scope="col">Deleted (undoable)</th>
              </tr>
            </thead>
            <tbody>
              {TABLES.map(({ table, label }) => {
                const row = counts?.find((c) => c.table === table);
                return (
                  <tr key={table} data-table={table}>
                    <th scope="row">{label}</th>
                    <td>{row?.active ?? '…'}</td>
                    <td>{row?.deleted ?? '…'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className={styles.section} aria-labelledby="undo-heading">
          <h2 id="undo-heading" className={styles.heading}>
            Undo and redo
          </h2>
          <div className={styles.buttons}>
            <button
              type="button"
              className={styles.button}
              disabled={busy || !nextUndo}
              onClick={() =>
                run(async () => {
                  const done = await undo(db);
                  return done ? `Undid: ${done.label}` : 'Nothing to undo';
                })
              }
            >
              {nextUndo ? `Undo: ${nextUndo.label}` : 'Nothing to undo'}
            </button>
            <button
              type="button"
              className={styles.button}
              disabled={busy || !nextRedo}
              onClick={() =>
                run(async () => {
                  const done = await redo(db);
                  return done ? `Redid: ${done.label}` : 'Nothing to redo';
                })
              }
            >
              {nextRedo ? `Redo: ${nextRedo.label}` : 'Nothing to redo'}
            </button>
          </div>
          <p
            className={message?.error ? styles.error : styles.message}
            role="status"
            aria-live="polite"
            data-testid="debug-message"
          >
            {message?.text ?? ''}
          </p>
        </section>

        <section className={styles.section} aria-labelledby="test-heading">
          <h2 id="test-heading" className={styles.heading}>
            Test changes
          </h2>
          {canEditSampleData ? (
            <>
              <p className={styles.text}>
                Made-up data for trying the app. It goes into this build&apos;s own database, never
                into your real data.
              </p>
              <div className={styles.buttons}>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const { loadSampleData } = await import('../../dev/sampleData');
                      const data = await loadSampleData(db);
                      return data.units.length
                        ? `Loaded ${data.units.length} units in ${data.buildings.length} buildings`
                        : 'Sample data is already loaded: nothing added.';
                    })
                  }
                >
                  Load sample data
                </button>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      let b = (await db.buildings.filter((x) => !x.deletedAt).first()) ?? null;
                      b ??= await createBuilding(db, {
                        address: makeAddress('100 Test St', 'Minneapolis'),
                        name: 'Test building',
                      });
                      const u = await createUnit(db, {
                        buildingId: b.id,
                        rent: randomRent(),
                        bedrooms: 1,
                      });
                      return `Unit added (${money(u.rent ?? 0)}/mo)`;
                    })
                  }
                >
                  Add a test unit
                </button>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const u = (await activeUnits())[0];
                      if (!u) return 'No units to change. Load sample data first.';
                      const rent = (u.rent ?? 1500) + 25;
                      await updateUnit(db, u.id, { rent }, 'Change rent');
                      return `Rent changed to ${money(rent)}/mo`;
                    })
                  }
                >
                  Raise a rent by $25
                </button>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const u = (await activeUnits()).at(-1);
                      if (!u) return 'No units to delete.';
                      await deleteUnit(db, u.id);
                      return 'Unit deleted';
                    })
                  }
                >
                  Delete a unit
                </button>
                <button
                  type="button"
                  className={`${styles.button} ${styles.danger}`}
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const { removeAllData } = await import('../../dev/sampleData');
                      await removeAllData(db);
                      return 'All data removed. Undo brings it back.';
                    })
                  }
                >
                  Remove all data
                </button>
              </div>
            </>
          ) : (
            <p className={styles.text}>
              Sample data and test changes are only available in preview and development builds.
            </p>
          )}
        </section>

        <section className={styles.section} aria-labelledby="history-heading">
          <h2 id="history-heading" className={styles.heading}>
            History
          </h2>
          {history && history.length > 0 ? (
            <ol className={styles.history} data-testid="history">
              {history.map((a) => (
                <li key={a.actionId} className={styles.historyItem}>
                  <span className={styles.historyLabel}>{a.label}</span>
                  <span className={styles.historyMeta}>
                    {`${a.changes} ${a.changes === 1 ? 'record' : 'records'} · ${timeFormat.format(new Date(a.at))}`}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.text}>Nothing has changed yet.</p>
          )}
        </section>
      </main>
    </div>
  );
}
