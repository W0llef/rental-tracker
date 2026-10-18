import { DATA_TABLES, SCHEMA_VERSION } from '../model';

/**
 * Before an update changes how the data is stored (PLAN.md §3.7 step 7), the app stops and
 * offers a backup download first. That file is what makes going back to an older version
 * possible: an older version can't open a database a newer one has upgraded.
 *
 * Runs before Dexie opens the database (Dexie would upgrade it straight away), using plain
 * IndexedDB: it reads the stored version without changing anything, and can read the old
 * records as they are for the backup.
 */

export interface PendingUpgrade {
  /** The data format version stored in this browser. */
  fromVersion: number;
  /** The version this app will upgrade it to. */
  toVersion: number;
}

/** Dexie stores its version × 10 as the IndexedDB version. */
export const toDexieVersion = (idbVersion: number) => Math.floor(idbVersion / 10);

/** Opens an existing database without upgrading it; null if there is none. */
function openExisting(name: string, idb: IDBFactory): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    let creating = false;
    const req = idb.open(name);
    req.onupgradeneeded = (e) => {
      // No database yet: don't create one, Dexie will.
      if (e.oldVersion === 0) {
        creating = true;
        req.transaction?.abort();
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = (e) => {
      if (creating) {
        e.preventDefault();
        resolve(null);
      } else reject(req.error ?? new Error('Couldn’t open the database.'));
    };
    req.onblocked = () => resolve(null);
  });
}

async function storedVersion(name: string, idb: IDBFactory): Promise<number | null> {
  if (typeof idb.databases === 'function') {
    try {
      const list = await idb.databases();
      const found = list.find((d) => d.name === name);
      return found?.version ?? null;
    } catch {
      // Fall through to opening it.
    }
  }
  const conn = await openExisting(name, idb);
  if (!conn) return null;
  const version = conn.version;
  conn.close();
  return version;
}

/**
 * The upgrade this app would run on the stored data, or null if none is needed (no
 * database yet, or it's already current). Never throws: if the check itself fails, the app
 * carries on and Dexie still keeps a snapshot before migrating.
 */
export async function checkPendingUpgrade(
  name: string,
  target: number = SCHEMA_VERSION,
  idb: IDBFactory | undefined = globalThis.indexedDB,
): Promise<PendingUpgrade | null> {
  if (!idb) return null;
  try {
    const version = await storedVersion(name, idb);
    if (!version) return null;
    const from = toDexieVersion(version);
    return from >= 1 && from < target ? { fromVersion: from, toVersion: target } : null;
  } catch {
    return null;
  }
}

/** Every data table's records as stored, in the old format, for the pre-update backup. */
export async function readStoredData(
  name: string,
  idb: IDBFactory = globalThis.indexedDB,
): Promise<Record<string, unknown[]>> {
  const conn = await openExisting(name, idb);
  if (!conn) return {};
  try {
    const tables = DATA_TABLES.filter((t) => conn.objectStoreNames.contains(t));
    const data: Record<string, unknown[]> = {};
    if (!tables.length) return data;
    const tx = conn.transaction(tables, 'readonly');
    await Promise.all(
      tables.map(
        (t) =>
          new Promise<void>((resolve, reject) => {
            const req = tx.objectStore(t).getAll();
            req.onsuccess = () => {
              data[t] = req.result as unknown[];
              resolve();
            };
            req.onerror = () => reject(req.error ?? new Error(`Couldn’t read ${t}.`));
          }),
      ),
    );
    return data;
  } finally {
    conn.close();
  }
}

/** Whether the stored data has anything worth backing up. */
export function hasRecords(data: Record<string, unknown[]>): boolean {
  return ['buildings', 'units', 'listings', 'notes'].some((t) => (data[t]?.length ?? 0) > 0);
}
