import { RentalDB } from '../../src/db/db';
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
