import Dexie from 'dexie';
import { RentalDB } from '../../src/db/db';
import { STORES_V1 } from '../../src/db/versions';
import type { VersionSpec } from '../../src/db/versions';
import { DATA_TABLES } from '../../src/model';

let counter = 0;

/** A fresh, empty database with a unique name. */
export function makeDb(versions?: VersionSpec[], name = `test-${Date.now()}-${++counter}`) {
  return versions ? new RentalDB(name, versions) : new RentalDB(name);
}

/** Every data table's rows, sorted by key, for deep comparisons. */
export async function dumpData(db: RentalDB) {
  const out: Record<string, unknown[]> = {};
  for (const table of DATA_TABLES) {
    out[table] = await db.table(table).orderBy(':id').toArray();
  }
  return out;
}

/**
 * A database as the v0.5 app (data format 1) left it, written without the app's middleware:
 * the way to test the real update to the current version.
 */
export async function makeV1Db(
  name: string,
  data: Record<string, unknown[]>,
  extra: Record<string, unknown[]> = {},
) {
  const old = new Dexie(name);
  old.version(1).stores(STORES_V1);
  await old.transaction('rw', old.tables, async () => {
    for (const [table, rows] of Object.entries({ ...data, ...extra })) {
      if (rows.length) await old.table(table).bulkAdd(rows);
    }
  });
  old.close();
}
