import fc from 'fast-check';
import { action } from '../../src/commands/action';
import {
  addNote,
  createBuilding,
  createUnit,
  deleteBuilding,
  deleteUnit,
  updateBuilding,
  updateSettings,
  updateUnit,
} from '../../src/commands/records';
import { redo, undo } from '../../src/commands/undo';
import { RentalDB } from '../../src/db/db';
import { deriveStacks, groupActions, pruneChangeLog, readStacks } from '../../src/db/undo';
import type { ChangeEntry } from '../../src/db/changeLog';
import { makeAddress } from '../../src/model/factories';
import { dumpData, makeDb } from './helpers';

const address = makeAddress('200 Portland Ave S', 'Minneapolis');

describe('undo and redo', () => {
  it('undoes and redoes one action at a time', async () => {
    const db = makeDb();
    const b = await createBuilding(db, { address, name: 'Riverlight' });
    const u = await createUnit(db, { buildingId: b.id, unitNumber: '1504', rent: 1650 });
    await updateUnit(db, u.id, { rent: 1700 }, 'Change rent');

    expect((await undo(db))?.label).toBe('Change rent');
    expect((await db.units.get(u.id))?.rent).toBe(1650);

    expect((await undo(db))?.label).toBe('Add unit');
    expect(await db.units.get(u.id)).toBeUndefined();

    expect((await redo(db))?.label).toBe('Add unit');
    expect((await db.units.get(u.id))?.rent).toBe(1650);
    expect((await redo(db))?.label).toBe('Change rent');
    expect((await db.units.get(u.id))?.rent).toBe(1700);
    expect(await redo(db)).toBeNull();
  });

  it('records undo and redo in the history too', async () => {
    const db = makeDb();
    await createBuilding(db, { address });
    await undo(db);
    await redo(db);
    const labels = (await db.changeLog.orderBy('seq').toArray()).map((e) => [e.kind, e.label]);
    expect(labels).toEqual([
      ['do', 'Add building'],
      ['undo', 'Undo: Add building'],
      ['redo', 'Redo: Add building'],
    ]);
  });

  it('clears the redo stack when something new is done', async () => {
    const db = makeDb();
    await createBuilding(db, { address });
    await undo(db);
    expect((await readStacks(db)).redo).toHaveLength(1);
    await createBuilding(db, { address: makeAddress('1 Main St', 'St. Paul') });
    expect((await readStacks(db)).redo).toHaveLength(0);
    expect(await redo(db)).toBeNull();
  });

  it('undoes a multi-record action as one step', async () => {
    const db = makeDb();
    const b = await createBuilding(db, { address });
    await createUnit(db, { buildingId: b.id, unitNumber: '1' });
    await createUnit(db, { buildingId: b.id, unitNumber: '2' });
    await deleteBuilding(db, b.id);
    expect((await db.units.toArray()).every((u) => u.deletedAt)).toBe(true);
    await undo(db);
    expect((await db.units.toArray()).every((u) => u.deletedAt === null)).toBe(true);
    expect((await db.buildings.get(b.id))?.deletedAt).toBeNull();
  });

  it('handles an action that writes the same record twice', async () => {
    const db = makeDb();
    const b = await createBuilding(db, { address, name: 'A' });
    await action(db, 'Rename twice', async () => {
      await db.buildings.update(b.id, { name: 'B' });
      await db.buildings.update(b.id, { name: 'C' });
    });
    await undo(db);
    expect((await db.buildings.get(b.id))?.name).toBe('A');
    await redo(db);
    expect((await db.buildings.get(b.id))?.name).toBe('C');
  });

  it('keeps its history after the app is closed and reopened', async () => {
    const name = `undo-reopen-${Date.now()}`;
    const first = new RentalDB(name);
    await createBuilding(first, { address, name: 'Riverlight' });
    await updateBuilding(first, (await first.buildings.toArray())[0]!.id, { name: 'Renamed' });
    first.close();

    const second = new RentalDB(name);
    expect((await undo(second))?.label).toBe('Edit building');
    expect((await second.buildings.toArray())[0]?.name).toBe('Riverlight');
    second.close();
  });

  it('turns a floor-plan placeholder into a unit in the same step, undoably', async () => {
    const db = makeDb();
    const b = await createBuilding(db, { address });
    const plan = await createUnit(db, {
      buildingId: b.id,
      isFloorPlanOnly: true,
      floorPlanName: 'Plan C',
    });
    const updated = await updateUnit(db, plan.id, { unitNumber: 'Apt 908' });
    expect(updated).toMatchObject({ isFloorPlanOnly: false, unitKey: '908', id: plan.id });
    await undo(db);
    expect(await db.units.get(plan.id)).toMatchObject({ isFloorPlanOnly: true, unitKey: null });
  });

  it('returns null when there is nothing to undo', async () => {
    expect(await undo(makeDb())).toBeNull();
  });
});

describe('undo stacks from the change log', () => {
  const entry = (
    seq: number,
    actionId: string,
    kind: ChangeEntry['kind'],
    target: string | null = null,
  ): ChangeEntry => ({
    seq,
    actionId,
    kind,
    target,
    at: '2026-10-15T00:00:00.000Z',
    label: actionId,
    table: 'units',
    key: 'k',
    before: null,
    after: null,
  });

  it('follows do, undo, redo in order', () => {
    const stacks = deriveStacks(
      groupActions([
        entry(1, 'A', 'do'),
        entry(2, 'B', 'do'),
        entry(3, 'uB', 'undo', 'B'),
        entry(4, 'uA', 'undo', 'A'),
        entry(5, 'rA', 'redo', 'A'),
      ]),
    );
    expect(stacks.undo.map((a) => a.actionId)).toEqual(['A']);
    expect(stacks.redo.map((a) => a.actionId)).toEqual(['B']);
  });

  it('ignores undo entries whose action was pruned', () => {
    const stacks = deriveStacks(groupActions([entry(5, 'uX', 'undo', 'X'), entry(6, 'B', 'do')]));
    expect(stacks.undo.map((a) => a.actionId)).toEqual(['B']);
    expect(stacks.redo).toEqual([]);
  });
});

describe('change-log retention', () => {
  it('drops whole actions beyond the entry limit', async () => {
    const db = makeDb();
    const b = await createBuilding(db, { address });
    for (let i = 0; i < 3; i++) {
      await createUnit(db, { buildingId: b.id, unitNumber: `${i}` });
    }
    await action(db, 'Two records', async () => {
      await createUnit(db, { buildingId: b.id, unitNumber: 'x' });
      await createUnit(db, { buildingId: b.id, unitNumber: 'y' });
    });
    // 6 entries; keep at most 3 → the cut lands inside nothing, oldest 3 actions go.
    await pruneChangeLog(db, new Date(), { maxEntries: 3, maxDays: 90 });
    const labels = (await db.changeLog.orderBy('seq').toArray()).map((e) => e.label);
    expect(labels).toEqual(['Add unit', 'Two records', 'Two records']);

    // Keep at most 1 → the cut would split "Two records", so all of it goes.
    await pruneChangeLog(db, new Date(), { maxEntries: 1, maxDays: 90 });
    expect(await db.changeLog.count()).toBe(0);
  });

  it('drops entries older than the day limit', async () => {
    const db = makeDb();
    await createBuilding(db, { address });
    const later = new Date(Date.now() + 91 * 86_400_000);
    await pruneChangeLog(db, later);
    expect(await db.changeLog.count()).toBe(0);
  });
});

describe('undo property: any sequence of commands undoes back to the start', () => {
  type Step =
    | { kind: 'building'; name: string }
    | { kind: 'unit'; b: number; rent: number | null }
    | { kind: 'rent'; u: number; rent: number }
    | { kind: 'rate'; u: number; rating: 0 | 1 | 2 | 3 | 4 | 5 }
    | { kind: 'deleteUnit'; u: number }
    | { kind: 'deleteBuilding'; b: number }
    | { kind: 'note'; u: number }
    | { kind: 'settings'; months: number };

  const step: fc.Arbitrary<Step> = fc.oneof(
    fc.record({ kind: fc.constant('building' as const), name: fc.string({ maxLength: 12 }) }),
    fc.record({
      kind: fc.constant('unit' as const),
      b: fc.nat(5),
      rent: fc.option(fc.integer({ min: 500, max: 5000 })),
    }),
    fc.record({
      kind: fc.constant('rent' as const),
      u: fc.nat(10),
      rent: fc.integer({ min: 500, max: 5000 }),
    }),
    fc.record({
      kind: fc.constant('rate' as const),
      u: fc.nat(10),
      rating: fc.constantFrom(0, 1, 2, 3, 4, 5),
    }),
    fc.record({ kind: fc.constant('deleteUnit' as const), u: fc.nat(10) }),
    fc.record({ kind: fc.constant('deleteBuilding' as const), b: fc.nat(5) }),
    fc.record({ kind: fc.constant('note' as const), u: fc.nat(10) }),
    fc.record({ kind: fc.constant('settings' as const), months: fc.integer({ min: 1, max: 24 }) }),
  );

  async function run(db: RentalDB, s: Step) {
    const buildings = await db.buildings.orderBy('id').toArray();
    const units = await db.units.orderBy('id').toArray();
    const pickB = (i: number) => buildings[i % Math.max(buildings.length, 1)];
    const pickU = (i: number) => units[i % Math.max(units.length, 1)];
    switch (s.kind) {
      case 'building':
        return createBuilding(db, { address, name: s.name });
      case 'unit': {
        const b = pickB(s.b);
        return b && createUnit(db, { buildingId: b.id, rent: s.rent });
      }
      case 'rent': {
        const u = pickU(s.u);
        return u && updateUnit(db, u.id, { rent: s.rent });
      }
      case 'rate': {
        const u = pickU(s.u);
        return u && updateUnit(db, u.id, { rating: s.rating });
      }
      case 'deleteUnit': {
        const u = pickU(s.u);
        return u && deleteUnit(db, u.id);
      }
      case 'deleteBuilding': {
        const b = pickB(s.b);
        return b && deleteBuilding(db, b.id);
      }
      case 'note': {
        const u = pickU(s.u);
        return addNote(db, { unitId: u?.id ?? null, text: 'note' });
      }
      case 'settings':
        return updateSettings(db, (cur) => ({
          ...cur,
          costProfile: { ...cur.costProfile, defaultLeaseMonths: s.months },
        }));
    }
  }

  it('undo all → original data; redo all → final data', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 12 }), async (steps) => {
        const db = makeDb();
        // A starting dataset that is not empty, so "undo too far" would show.
        await createBuilding(db, { address, name: 'Start' });
        const start = await dumpData(db);
        const startActions = (await readStacks(db)).undo.length;

        for (const s of steps) await run(db, s);
        const end = await dumpData(db);

        while ((await readStacks(db)).undo.length > startActions) await undo(db);
        expect(await dumpData(db)).toEqual(start);

        while (await redo(db)) {
          /* redo everything */
        }
        expect(await dumpData(db)).toEqual(end);
        db.close();
      }),
      { numRuns: 40 },
    );
  });
});
