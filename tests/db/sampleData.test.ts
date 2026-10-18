import { undo } from '../../src/commands/undo';
import { deleteBuilding } from '../../src/commands/records';
import { ensureMe, readMeId } from '../../src/db/me';
import { loadSampleData, makeSampleData, removeAllData } from '../../src/dev/sampleData';
import { building, listing, noteEntry, unit } from '../../src/model';
import { makeDb } from './helpers';

describe('sample data', () => {
  it('is valid, deterministic and covers the interesting cases', () => {
    const a = makeSampleData('2026-10-15', '2026-10-15T00:00:00.000Z');
    const b = makeSampleData('2026-10-15', '2026-10-15T00:00:00.000Z');
    expect(a.units.map((u) => u.rent)).toEqual(b.units.map((u) => u.rent));

    a.buildings.forEach((x) => building.parse(x));
    a.units.forEach((x) => unit.parse(x));
    a.listings.forEach((x) => listing.parse(x));
    a.notes.forEach((x) => noteEntry.parse(x));

    expect(a.buildings).toHaveLength(10);
    expect(a.units.length).toBeGreaterThanOrEqual(25);
    expect(a.units.some((u) => u.isFloorPlanOnly)).toBe(true);
    expect(a.units.some((u) => u.squareFeet === null)).toBe(true); // unknowns
    expect(a.buildings.some((x) => x.name === null)).toBe(true); // a house with no name
    expect(new Set(a.buildings.map((x) => x.address.city))).toEqual(
      new Set(['Minneapolis', 'St. Paul']),
    );
    for (const u of a.units) {
      expect(a.buildings.some((x) => x.id === u.buildingId)).toBe(true);
      expect(a.listings.some((l) => l.unitId === u.id)).toBe(true);
    }
  });

  it('loads as one undoable action', async () => {
    const db = makeDb();
    const data = await loadSampleData(db, '2026-10-15');
    expect(await db.units.count()).toBe(data.units.length);
    expect(await db.buildings.count()).toBe(10);
    await undo(db);
    expect(await db.units.count()).toBe(0);
    expect(await db.listings.count()).toBe(0);
  });

  it('can be removed and the removal undone', async () => {
    const db = makeDb();
    const data = await loadSampleData(db, '2026-10-15');
    await removeAllData(db);
    expect(await db.units.count()).toBe(0);
    await undo(db);
    expect(await db.units.count()).toBe(data.units.length);
  });

  it('comes with a sample roommate who rated most units, once however often it loads', async () => {
    const db = makeDb();
    const meId = await ensureMe(db);
    const data = await loadSampleData(db, '2026-10-15');
    const people = await db.people.toArray();
    expect(people.map((p) => p.name).sort()).toEqual(['Alex', 'Me']);
    const alex = people.find((p) => p.name === 'Alex')!;
    const theirs = await db.opinions.where('personId').equals(alex.id).count();
    expect(theirs).toBeGreaterThan(data.units.length / 2);
    expect(await db.opinions.where('personId').equals(meId).count()).toBeGreaterThan(5);
    expect((await db.notes.toArray()).some((n) => n.authorId === alex.id)).toBe(true);

    await removeAllData(db);
    await loadSampleData(db, '2026-10-15');
    expect((await db.people.toArray()).filter((p) => p.name === 'Alex')).toHaveLength(1);
    expect(await readMeId(db)).toBe(meId);
  });

  it('never duplicates: loading again adds only the sample buildings that are missing', async () => {
    const db = makeDb();
    const first = await loadSampleData(db, '2026-10-15');
    const again = await loadSampleData(db, '2026-10-15');
    expect(again.buildings).toHaveLength(0);
    expect(again.units).toHaveLength(0);
    expect(await db.buildings.count()).toBe(first.buildings.length);
    expect(await db.units.count()).toBe(first.units.length);

    // Delete one sample building: loading brings back just that one, with its units.
    const larkin = (await db.buildings.toArray()).find((b) => b.name === 'The Larkin')!;
    await deleteBuilding(db, larkin.id);
    const refill = await loadSampleData(db, '2026-10-15');
    expect(refill.buildings.map((b) => b.name)).toEqual(['The Larkin']);
    expect(refill.units.every((u) => u.buildingId === refill.buildings[0]!.id)).toBe(true);
    expect(refill.units.length).toBeGreaterThan(0);
    const live = (await db.buildings.toArray()).filter((b) => !b.deletedAt);
    expect(live.filter((b) => b.name === 'The Larkin')).toHaveLength(1);
  });
});
