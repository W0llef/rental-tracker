import fixture from '../fixtures/backup-v1.json';
import { RentalDB } from '../../src/db/db';
import { checkPendingUpgrade, hasRecords, readStoredData } from '../../src/db/upgradeCheck';
import { STORES_V1 } from '../../src/db/versions';
import type { VersionSpec } from '../../src/db/versions';
import { SCHEMA_VERSION } from '../../src/model';
import { checkBackup } from '../../src/services/backup/restore';
import { makeEnvelope } from '../../src/services/backup/exportJson';
import { makeV1Db } from './helpers';

const v1: VersionSpec[] = [{ version: 1, stores: STORES_V1 }];

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
    await makeV1Db(dbName, fixture.data);

    expect(await checkPendingUpgrade(dbName, 2)).toEqual({ fromVersion: 1, toVersion: 2 });
    const data = await readStoredData(dbName);
    expect(hasRecords(data)).toBe(true);
    expect(data.units).toHaveLength(2);
    expect(data.units![0]).toHaveProperty('rating', 4); // still the old shape
    expect(data).not.toHaveProperty('people');

    // The backup it makes is a v1 file (as the previous app wrote them) the app can read.
    const envelope = makeEnvelope(data, 1);
    expect(envelope).not.toHaveProperty('exportedBy');
    expect(checkBackup(envelope).ok).toBe(true);

    // Still at version 1: the check changed nothing.
    expect(await checkPendingUpgrade(dbName, 2)).toEqual({ fromVersion: 1, toVersion: 2 });

    // Continuing opens it with the new version, which migrates and keeps a snapshot.
    const updated = new RentalDB(dbName);
    expect((await updated.units.toArray())[0]).not.toHaveProperty('rating');
    expect(await updated.people.count()).toBe(1);
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
