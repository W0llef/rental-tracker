import { createBuilding } from '../../src/commands/records';
import { RentalDB } from '../../src/db/db';
import type { Migration } from '../../src/db/migrations';
import { checkPendingUpgrade, hasRecords, readStoredData } from '../../src/db/upgradeCheck';
import { STORES_V1 } from '../../src/db/versions';
import type { VersionSpec } from '../../src/db/versions';
import { SCHEMA_VERSION } from '../../src/model';
import { makeAddress } from '../../src/model/factories';
import { checkBackup } from '../../src/services/backup/restore';
import { makeEnvelope } from '../../src/services/backup/exportJson';

const v1: VersionSpec[] = [{ version: 1, stores: STORES_V1 }];
const testV2: Migration = {
  toVersion: 2,
  description: 'test: mark buildings',
  tables: { buildings: (b) => ({ ...b, v2: true }) },
};
const v2: VersionSpec[] = [...v1, { version: 2, stores: {}, migration: testV2 }];

let n = 0;
const name = () => `upgrade-check-${Date.now()}-${++n}`;

describe('pre-update backup check', () => {
  it('finds nothing to do for a database that doesn’t exist, and doesn’t create one', async () => {
    const dbName = name();
    expect(await checkPendingUpgrade(dbName, 2)).toBeNull();
    const list = await indexedDB.databases();
    expect(list.map((d) => d.name)).not.toContain(dbName);
  });

  it('finds nothing to do when the data is current', async () => {
    const dbName = name();
    const db = new RentalDB(dbName);
    await db.open();
    db.close();
    expect(await checkPendingUpgrade(dbName, SCHEMA_VERSION)).toBeNull();
  });

  it('spots an older database and reads its records without upgrading it', async () => {
    const dbName = name();
    const old = new RentalDB(dbName, v1);
    await createBuilding(old, { address: makeAddress('200 Portland Ave S', 'Minneapolis') });
    old.close();

    expect(await checkPendingUpgrade(dbName, 2)).toEqual({ fromVersion: 1, toVersion: 2 });
    const data = await readStoredData(dbName);
    expect(hasRecords(data)).toBe(true);
    expect(data.buildings).toHaveLength(1);
    expect(data.buildings![0]).not.toHaveProperty('v2');

    // The backup it makes is a v1 file the current app can read.
    expect(checkBackup(makeEnvelope(data, 1)).ok).toBe(true);

    // Still at version 1: the check changed nothing.
    expect(await checkPendingUpgrade(dbName, 2)).toEqual({ fromVersion: 1, toVersion: 2 });

    // Continuing opens it with the new version, which migrates and keeps a snapshot.
    const updated = new RentalDB(dbName, v2);
    expect((await updated.buildings.toArray())[0]).toHaveProperty('v2', true);
    expect(await updated.snapshots.count()).toBe(1);
    updated.close();
    expect(await checkPendingUpgrade(dbName, 2)).toBeNull();
  });

  it('also works where the browser can’t list databases', async () => {
    const dbName = name();
    const old = new RentalDB(dbName, v1);
    await old.open();
    old.close();
    const noList = Object.create(indexedDB, { databases: { value: undefined } }) as IDBFactory;
    expect(await checkPendingUpgrade(dbName, 2, noList)).toEqual({ fromVersion: 1, toVersion: 2 });
    expect(await checkPendingUpgrade(name(), 2, noList)).toBeNull();
  });
});
