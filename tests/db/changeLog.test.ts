import { action, systemWrite } from '../../src/commands/action';
import { createBuilding, createUnit, updateUnit } from '../../src/commands/records';
import { UntrackedWriteError } from '../../src/db/changeLog';
import { makeAddress, newBuilding } from '../../src/model/factories';
import { makeDb } from './helpers';

const address = makeAddress('200 Portland Ave S', 'Minneapolis');

describe('change-log middleware', () => {
  it('refuses writes to data tables outside a command', async () => {
    const db = makeDb();
    await expect(db.buildings.add(newBuilding({ address }))).rejects.toThrow(UntrackedWriteError);
    await expect(db.transaction('rw', db.buildings, () => db.buildings.clear())).rejects.toThrow(
      UntrackedWriteError,
    );
    expect(await db.buildings.count()).toBe(0);
  });

  it('lets caches and other non-data tables be written directly', async () => {
    const db = makeDb();
    await db.meta.put({ key: 'installId', value: 'abc' });
    await db.geocodeCache.put({ key: 'q', at: '2026-10-15T00:00:00.000Z', value: [] });
    expect(await db.changeLog.count()).toBe(0);
  });

  it('records before and after for every write in an action, under one action id', async () => {
    const db = makeDb();
    const b = await createBuilding(db, { address, name: 'Riverlight' });
    const u = await createUnit(db, { buildingId: b.id, unitNumber: '1504', rent: 1650 });
    await updateUnit(db, u.id, { rent: 1700 }, 'Change rent');

    const log = await db.changeLog.orderBy('seq').toArray();
    expect(log.map((e) => [e.label, e.table, e.before === null, e.after === null])).toEqual([
      ['Add building', 'buildings', true, false],
      ['Add unit', 'units', true, false],
      ['Change rent', 'units', false, false],
    ]);
    const last = log[2]!;
    expect((last.before as { rent: number }).rent).toBe(1650);
    expect((last.after as { rent: number }).rent).toBe(1700);
    expect(new Set(log.map((e) => e.actionId)).size).toBe(3);
  });

  it('logs every record a clear() removes and nothing for unchanged writes', async () => {
    const db = makeDb();
    const b = await createBuilding(db, { address });
    await action(db, 'Write the same value', () => db.buildings.put(b));
    expect(await db.changeLog.count()).toBe(1); // only the add

    await createBuilding(db, { address: makeAddress('1 Main St', 'Minneapolis') });
    await action(db, 'Clear', () => db.buildings.clear());
    const cleared = await db.changeLog
      .where('actionId')
      .equals((await db.changeLog.orderBy('seq').last())!.actionId)
      .toArray();
    expect(cleared).toHaveLength(2);
    expect(cleared.every((e) => e.after === null && e.before !== null)).toBe(true);
  });

  it('records modify() and bulk updates', async () => {
    const db = makeDb();
    const b = await createBuilding(db, { address });
    await action(db, 'Rename', () => db.buildings.update(b.id, { name: 'Renamed' }));
    await action(db, 'Bulk', () =>
      db.buildings.bulkUpdate([{ key: b.id, changes: { floors: 9 } }]),
    );
    await action(db, 'Modify', () =>
      db.buildings.where('id').equals(b.id).modify({ elevator: true }),
    );
    const log = await db.changeLog.orderBy('seq').toArray();
    expect(log.map((e) => e.label)).toEqual(['Add building', 'Rename', 'Bulk', 'Modify']);
    expect((log[3]!.after as { elevator: boolean }).elevator).toBe(true);
  });

  it('records nothing if the action fails, and leaves data untouched', async () => {
    const db = makeDb();
    await expect(
      action(db, 'Fails half-way', async () => {
        await db.buildings.add(newBuilding({ address }));
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.buildings.count()).toBe(0);
    expect(await db.changeLog.count()).toBe(0);
  });

  it('joins nested actions into the outer one', async () => {
    const db = makeDb();
    await action(db, 'Outer', async () => {
      await createBuilding(db, { address });
      await createBuilding(db, { address: makeAddress('2 Main St', 'St. Paul') });
    });
    const log = await db.changeLog.toArray();
    expect(log).toHaveLength(2);
    expect(new Set(log.map((e) => e.label))).toEqual(new Set(['Outer']));
  });

  it('allows declared system writes without logging them', async () => {
    const db = makeDb();
    await systemWrite(db, 'test setup', () => db.buildings.add(newBuilding({ address })));
    expect(await db.buildings.count()).toBe(1);
    expect(await db.changeLog.count()).toBe(0);
  });

  it('rejects invalid records before they reach the database', async () => {
    const db = makeDb();
    const b = await createBuilding(db, { address });
    await expect(createUnit(db, { buildingId: b.id, rent: -5 })).rejects.toThrow();
    await expect(createUnit(db, { buildingId: 'missing' })).rejects.toThrow("wasn't found");
    expect(await db.units.count()).toBe(0);
  });
});
