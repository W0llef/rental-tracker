import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { createBuilding, createUnit, deleteUnit, updateUnit } from '../../commands/records';
import { appInfo, dbName } from '../../config';
import { db } from '../../db/db';
import { SCHEMA_VERSION } from '../../model';
import type { DataTable } from '../../model';
import { makeAddress } from '../../model/factories';
import styles from './settings.module.css';

/**
 * Settings → Data (M7 review; was the Data check page, #/debug): what this copy has stored,
 * where to find its history, and, on preview and development builds only, sample data and
 * test changes.
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
  { table: 'imports', label: 'Pasted text kept' },
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

const money = (usd: number) => `$${usd.toLocaleString('en-US')}`;
const randomRent = () => 1200 + Math.round(Math.random() * 80) * 10;

export function DataSection() {
  const counts = useLiveQuery(readCounts, []);
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
  const activeUnits = () => db.units.filter((u) => !u.deletedAt).sortBy('id');

  return (
    <>
      <p className={styles.lead}>
        What this copy of the app has stored in this browser. Every change is listed in{' '}
        <Link to="/history">History</Link>, where you can undo any of them.
      </p>

      <section className={styles.card} aria-labelledby="data-stored">
        <h3 id="data-stored" className={styles.cardTitle}>
          What’s stored
        </h3>
        <table className={styles.table} data-testid="record-counts">
          <thead>
            <tr>
              <th scope="col">Kind</th>
              <th scope="col">Stored</th>
              <th scope="col">Deleted (can be restored)</th>
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
        <p className={styles.note}>
          Database <code>{dbName}</code>, data format version {SCHEMA_VERSION}, app v
          {appInfo.version}.
        </p>
      </section>

      <section className={styles.card} aria-labelledby="data-sample">
        <h3 id="data-sample" className={styles.cardTitle}>
          Sample data and test changes
        </h3>
        {canEditSampleData ? (
          <>
            <p className={styles.text}>
              Made-up data for trying the app. It goes into this build&apos;s own database, never
              into your real data. Each button is one step you can undo.
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
                className={styles.danger}
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
        <p
          className={message?.error ? styles.error : styles.message}
          role="status"
          aria-live="polite"
          data-testid="debug-message"
        >
          {message?.text ?? ''}
        </p>
      </section>
    </>
  );
}
