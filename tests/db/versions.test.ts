import { systemWrite } from '../../src/commands/action';
import { createBuilding } from '../../src/commands/records';
import { RentalDB } from '../../src/db/db';
import type { Migration } from '../../src/db/migrations';
import { SNAPSHOTS_KEPT, STORES_V1 } from '../../src/db/versions';
import type { VersionSpec } from '../../src/db/versions';
import { makeAddress, newBuilding } from '../../src/model/factories';

/**
 * The framework is exercised with throwaway versions that exist only in this test, so the
 * first real migration (v2) arrives with a tested path: snapshot first, then transform.
 */
const v1: VersionSpec = { version: 1, stores: STORES_V1 };
const rename = (n: number): Migration => ({
  toVersion: n,
  description: `test v${n}`,
  tables: { buildings: (b) => ({ ...b, name: `${String(b.name)} v${n}` }) },
});
const upTo = (n: number): VersionSpec[] => [
  v1,
  ...Array.from({ length: n - 1 }, (_, i) => ({
    version: i + 2,
    stores: { buildings: 'id, address.normalized, complexName, updatedAt, deletedAt, name' },
    migration: rename(i + 2),
  })),
];

describe('database versions', () => {
  it('upgrades stored data with the migration and keeps a snapshot of the old data', async () => {
    const name = `versions-${Date.now()}`;
    const old = new RentalDB(name, upTo(1));
    await createBuilding(old, {
      address: makeAddress('1 Main St', 'Minneapolis'),
      name: 'Riverlight',
    });
    old.close();

    const next = new RentalDB(name, upTo(2));
    const [b] = await next.buildings.toArray();
    expect(b?.name).toBe('Riverlight v2');
    expect(next.verno).toBe(2);

    const snaps = await next.snapshots.toArray();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ fromVersion: 1, toVersion: 2 });
    expect((snaps[0]!.data.buildings as { name: string }[])[0]?.name).toBe('Riverlight');
    // The migration itself isn't an undoable action.
    expect((await next.changeLog.toArray()).map((e) => e.label)).toEqual(['Add building']);
    next.close();
  });

  it(`keeps only the last ${SNAPSHOTS_KEPT} snapshots`, async () => {
    const name = `versions-many-${Date.now()}`;
    const first = new RentalDB(name, upTo(1));
    await systemWrite(first, 'test setup', () =>
      first.buildings.add(newBuilding({ address: makeAddress('1 Main St', null), name: 'A' })),
    );
    first.close();
    for (let v = 2; v <= 6; v++) {
      const db = new RentalDB(name, upTo(v));
      await db.open();
      db.close();
    }
    const db = new RentalDB(name, upTo(6));
    const snaps = await db.snapshots.orderBy('seq').toArray();
    expect(snaps.map((s) => s.toVersion)).toEqual([4, 5, 6]);
    expect((await db.buildings.toArray())[0]?.name).toBe('A v2 v3 v4 v5 v6');
    db.close();
  });
});
