import { systemWrite } from '../../src/commands/action';
import { createBuilding } from '../../src/commands/records';
import { RentalDB } from '../../src/db/db';
import type { Migration } from '../../src/db/migrations';
import { SNAPSHOTS_KEPT, versions } from '../../src/db/versions';
import type { VersionSpec } from '../../src/db/versions';
import { SCHEMA_VERSION } from '../../src/model';
import { makeAddress, newBuilding } from '../../src/model/factories';

/**
 * The framework is exercised with throwaway versions after the real ones, which exist
 * only in this test: snapshot first, then transform. The real v1 → v2 upgrade has its own
 * test (tests/db/upgradeV2.test.ts).
 */
const CURRENT = SCHEMA_VERSION;
const rename = (n: number): Migration => ({
  toVersion: n,
  description: `test v${n}`,
  tables: { buildings: (b) => ({ ...b, name: `${String(b.name)} v${n}` }) },
});
const upTo = (n: number): VersionSpec[] => [
  ...versions,
  ...Array.from({ length: n - CURRENT }, (_, i) => ({
    version: CURRENT + i + 1,
    stores: { buildings: 'id, address.normalized, complexName, updatedAt, deletedAt, name' },
    migration: rename(CURRENT + i + 1),
  })),
];

describe('database versions', () => {
  it('upgrades stored data with the migration and keeps a snapshot of the old data', async () => {
    const name = `versions-${Date.now()}`;
    const old = new RentalDB(name, upTo(CURRENT));
    await createBuilding(old, {
      address: makeAddress('1 Main St', 'Minneapolis'),
      name: 'Riverlight',
    });
    old.close();

    const next = new RentalDB(name, upTo(CURRENT + 1));
    const [b] = await next.buildings.toArray();
    expect(b?.name).toBe(`Riverlight v${CURRENT + 1}`);
    expect(next.verno).toBe(CURRENT + 1);

    const snaps = await next.snapshots.toArray();
    expect(snaps).toHaveLength(1);
    expect(snaps[0]).toMatchObject({ fromVersion: CURRENT, toVersion: CURRENT + 1 });
    expect((snaps[0]!.data.buildings as { name: string }[])[0]?.name).toBe('Riverlight');
    // The migration itself isn't an undoable action.
    expect((await next.changeLog.toArray()).map((e) => e.label)).toEqual(['Add building']);
    next.close();
  });

  it(`keeps only the last ${SNAPSHOTS_KEPT} snapshots`, async () => {
    const name = `versions-many-${Date.now()}`;
    const first = new RentalDB(name, upTo(CURRENT));
    await systemWrite(first, 'test setup', () =>
      first.buildings.add(newBuilding({ address: makeAddress('1 Main St', null), name: 'A' })),
    );
    first.close();
    const last = CURRENT + 5;
    for (let v = CURRENT + 1; v <= last; v++) {
      const db = new RentalDB(name, upTo(v));
      await db.open();
      db.close();
    }
    const db = new RentalDB(name, upTo(last));
    const snaps = await db.snapshots.orderBy('seq').toArray();
    expect(snaps.map((s) => s.toVersion)).toEqual([last - 2, last - 1, last]);
    const suffix = Array.from({ length: 5 }, (_, i) => ` v${CURRENT + i + 1}`).join('');
    expect((await db.buildings.toArray())[0]?.name).toBe(`A${suffix}`);
    db.close();
  });
});
