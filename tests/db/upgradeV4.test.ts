import Dexie from 'dexie';
import fixture from '../fixtures/backup-v3.json';
import { RentalDB } from '../../src/db/db';
import { checkPendingUpgrade } from '../../src/db/upgradeCheck';
import { STORES_V1, STORES_V2 } from '../../src/db/versions';
import { SCHEMA_VERSION } from '../../src/model';

/** The real update from data format 3 (v0.8) to 4 (v0.9) on a browser database. */
describe('updating a v3 database to v4', () => {
  it('adds charges by lease length, keeps undo history and one safety copy', async () => {
    const name = `upgrade-v4-${Date.now()}`;
    const old = new Dexie(name);
    old.version(1).stores(STORES_V1);
    old.version(2).stores(STORES_V2);
    old.version(3).stores({});
    const log = {
      actionId: 'a1',
      label: 'Edit unit',
      kind: 'do',
      target: null,
      at: '2026-10-18T21:12:00.000Z',
      table: 'units',
      key: 'u-1',
      before: null,
      after: null,
    };
    await old.transaction('rw', old.tables, async () => {
      for (const [table, rows] of Object.entries(fixture.data)) {
        if ((rows as unknown[]).length) await old.table(table).bulkAdd(rows as object[]);
      }
      await old.table('changeLog').add(log);
      await old.table('meta').put({ key: 'meId', value: 'p-me' });
    });
    old.close();
    expect(await checkPendingUpgrade(name, SCHEMA_VERSION)).toEqual({
      fromVersion: 3,
      toVersion: SCHEMA_VERSION,
    });

    const db = new RentalDB(name);
    await db.open();
    expect(db.verno).toBe(SCHEMA_VERSION);
    expect((await db.units.toArray()).every((u) => Array.isArray(u.termCharges))).toBe(true);
    expect(await db.units.get('u-1')).toMatchObject({ termCharges: [], rent: 1650 });
    expect(await db.changeLog.count()).toBe(1); // nothing changed meaning: undo survives
    const snaps = await db.snapshots.toArray();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({
      fromVersion: 3,
      toVersion: SCHEMA_VERSION,
      reason: 'migration',
    });
    db.close();
  });
});
