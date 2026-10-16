import { undo } from '../../src/commands/undo';
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
});
