import { entriesOf, readLookup } from '../../src/commands/history';
import { saveBuildingForm, saveUnitForm, updateBuildings } from '../../src/commands/forms';
import { addListing, createBuilding, createUnit, updateUnit } from '../../src/commands/records';
import { redo, undo } from '../../src/commands/undo';
import type { RentalDB } from '../../src/db/db';
import { ensureMe } from '../../src/db/me';
import { recentActions } from '../../src/db/undo';
import { unitFromSource } from '../../src/domain/copyFrom';
import { describeAction } from '../../src/domain/history';
import type { Listing, Unit } from '../../src/model';
import { makeAddress, newListing } from '../../src/model/factories';
import { dumpData, makeDb } from './helpers';

const today = '2026-10-18';

async function setup() {
  const db = makeDb();
  await ensureMe(db);
  const b = await createBuilding(db, {
    address: makeAddress('200 Portland Ave S', 'Minneapolis'),
    name: 'Riverlight',
  });
  const u = await createUnit(db, { buildingId: b.id, unitNumber: '1504', rent: 1650 });
  const l = await addListing(db, {
    unitId: u.id,
    url: 'https://www.zillow.com/homedetails/1',
    site: 'zillow',
    firstSeen: '2026-10-01',
    observations: [{ date: '2026-10-01', rent: 1650, note: null }],
  });
  return { db, b, u, l };
}

async function lastTitle(db: RentalDB) {
  const [a] = await recentActions(db, 1);
  const entries = await entriesOf(db, a!.actionId);
  return describeAction(a!, entries, await readLookup(db), null);
}

const liveListings = async (db: RentalDB, unitId: string) =>
  (await db.listings.where('unitId').equals(unitId).toArray()).filter((l) => !l.deletedAt);

describe('saving the unit form', () => {
  it('writes every change in one undo step, said field by field', async () => {
    const { db, u, l } = await setup();
    const before = await dumpData(db);
    const draft: Unit = {
      ...u,
      bedrooms: 1,
      bathrooms: 1.5,
      laundry: 'in-unit',
      exposure: ['S', 'W'],
      windows: [{ id: 'w1', room: 'Living', direction: 'S', size: 'large', obstruction: null }],
      utilities: { ...u.utilities, heat: { mode: 'extra', amount: 40 } },
      recurringFees: [{ id: 'f1', label: 'Amenity fee', amount: 35 }],
    };
    const r = await saveUnitForm(db, { unit: draft, listings: [l], today });
    expect(r.changed).toBe(true);
    const saved = await db.units.get(u.id);
    expect(saved).toMatchObject({ bedrooms: 1, bathrooms: 1.5, laundry: 'in-unit' });
    expect(saved?.utilities.heat).toEqual({ mode: 'extra', amount: 40 });

    const d = await lastTitle(db);
    expect(d.title).toBe('Changed 7 details on Unit 1504 at Riverlight');
    expect(d.details).toContain('Heat unknown → billed extra, $40/mo on Unit 1504 at Riverlight');
    expect(d.details).toContain('Bathrooms unknown → 1.5 on Unit 1504 at Riverlight');
    expect(d.details).toContain('Exposure unknown → S, W on Unit 1504 at Riverlight');

    await undo(db);
    expect(await dumpData(db)).toEqual(before);
    await redo(db);
    expect((await db.units.get(u.id))?.bedrooms).toBe(1);
  });

  it('writes nothing when nothing changed', async () => {
    const { db, u, l } = await setup();
    const [before] = await recentActions(db, 1);
    const r = await saveUnitForm(db, { unit: u, listings: [l], today });
    expect(r).toMatchObject({ changed: false, actionId: null });
    const [after] = await recentActions(db, 1);
    expect(after?.actionId).toBe(before?.actionId);
  });

  it('records a typed rent in the price history and says it once', async () => {
    const { db, u, l } = await setup();
    const r = await saveUnitForm(db, { unit: { ...u, rent: 1600 }, listings: [l], today });
    expect(r.effect).toMatchObject({ kind: 'observe', listingId: l.id, rent: 1600 });
    const [stored] = await liveListings(db, u.id);
    expect(stored!.observations.map((o) => o.rent)).toEqual([1650, 1600]);
    expect(stored!.lastSeen).toBe(today);
    expect((await lastTitle(db)).title).toBe('Rent $1,650 → $1,600 on Unit 1504 at Riverlight');
  });

  it('moves the rent with an edited price history', async () => {
    const { db, u, l } = await setup();
    const edited: Listing = {
      ...l,
      observations: [...l.observations, { date: '2026-10-12', rent: 1625, note: null }],
    };
    await saveUnitForm(db, { unit: u, listings: [edited], today });
    expect((await db.units.get(u.id))?.rent).toBe(1625);
  });

  it('adds, edits and deletes listings', async () => {
    const { db, u, l } = await setup();
    const added = newListing({
      unitId: u.id,
      url: 'https://www.apartments.com/riverlight',
      site: 'apartments-com',
      firstSeen: '2026-10-15',
      observations: [{ date: '2026-10-15', rent: 1650, note: null }],
    });
    await saveUnitForm(db, { unit: u, listings: [added], today });
    const live = await liveListings(db, u.id);
    expect(live.map((x) => x.site)).toEqual(['apartments-com']);
    const old = await db.listings.get(l.id);
    expect(old?.deletedAt).not.toBeNull(); // soft delete: undo brings it back
    await undo(db);
    expect((await liveListings(db, u.id)).map((x) => x.id)).toEqual([l.id]);
  });

  it('drops the sources of values typed by hand', async () => {
    const { db, u, l } = await setup();
    const src = (field: string) => ({
      field,
      url: 'https://example.com',
      seen: '2026-10-01',
      via: 'paste' as const,
      importId: null,
    });
    const withSources = await updateUnit(db, u.id, {
      bedrooms: 2,
      fieldSources: [src('unit.bedrooms'), src('unit.squareFeet')],
    });
    await saveUnitForm(db, { unit: { ...withSources, bedrooms: 1 }, listings: [l], today });
    expect((await db.units.get(u.id))?.fieldSources.map((s) => s.field)).toEqual([
      'unit.squareFeet',
    ]);
    // Sources alone don't make the title: just the field
    expect((await lastTitle(db)).title).toBe('Bedrooms 2 → 1 on Unit 1504 at Riverlight');
  });

  it('adds a new unit made from a floor plan, with its first price', async () => {
    const { db, b } = await setup();
    const plan = await createUnit(db, {
      buildingId: b.id,
      isFloorPlanOnly: true,
      floorPlanName: 'Plan C',
      bedrooms: 2,
      laundry: 'in-unit',
    });
    const draft = { ...unitFromSource(plan), unitNumber: '1201', rent: 2450 };
    const r = await saveUnitForm(db, { unit: draft, listings: [], today, isNew: true });
    const saved = await db.units.get(r.unit.id);
    expect(saved).toMatchObject({
      unitNumber: '1201',
      unitKey: '1201',
      floorPlanName: 'Plan C',
      bedrooms: 2,
      laundry: 'in-unit',
      isFloorPlanOnly: false,
    });
    const ls = await liveListings(db, r.unit.id);
    expect(ls).toHaveLength(1);
    expect(ls[0]).toMatchObject({ url: null, site: 'other', firstSeen: today });
    expect((await lastTitle(db)).title).toBe('Added Unit 1201 at Riverlight');
    await undo(db);
    expect(await db.units.get(r.unit.id)).toBeUndefined();
  });

  it('refuses invalid values and writes nothing', async () => {
    const { db, u, l } = await setup();
    const before = await dumpData(db);
    await expect(
      saveUnitForm(db, { unit: { ...u, bathrooms: 1.3 }, listings: [l], today }),
    ).rejects.toThrow();
    expect(await dumpData(db)).toEqual(before);
  });
});

describe('saving the building form and editing buildings together', () => {
  it('saves the building in one step and names its fields', async () => {
    const { db, b } = await setup();
    await saveBuildingForm(db, {
      ...b,
      yearBuilt: 2019,
      buildingType: 'high-rise',
      amenities: { ...b.amenities, pool: true },
      pets: { ...b.pets, cats: true, monthlyRent: 35 },
    });
    const d = await lastTitle(db);
    expect(d.title).toBe('Changed 5 details on Riverlight');
    expect(d.details).toEqual(
      expect.arrayContaining([
        'Year built unknown → 2019 on Riverlight',
        'Building type unknown → high-rise on Riverlight',
        'Pool unknown → yes on Riverlight',
        'Pet rent unknown → $35 on Riverlight',
      ]),
    );
    await undo(db);
    expect((await db.buildings.get(b.id))?.yearBuilt).toBeNull();
  });

  it('drops units’ sources for building facts typed by hand', async () => {
    const { db, b, u } = await setup();
    await updateUnit(db, u.id, {
      fieldSources: [
        { field: 'building.floors', url: null, seen: today, via: 'paste', importId: null },
        { field: 'building.yearBuilt', url: null, seen: today, via: 'paste', importId: null },
      ],
    });
    await saveBuildingForm(db, { ...b, floors: 24 });
    expect((await db.units.get(u.id))?.fieldSources.map((s) => s.field)).toEqual([
      'building.yearBuilt',
    ]);
    expect((await lastTitle(db)).title).toBe('Floors unknown → 24 on Riverlight');
  });

  it('sets facts on several buildings, keeping the parts it wasn’t asked to change', async () => {
    const { db, b } = await setup();
    const c = await createBuilding(db, {
      address: makeAddress('1010 Nicollet Mall', 'Minneapolis'),
      name: 'The Larkin',
    });
    await saveBuildingForm(db, { ...c, amenities: { ...c.amenities, fitness: true } });
    const changed = await updateBuildings(db, [b.id, c.id], {
      amenities: { pool: true },
      pets: { cats: true },
      smoking: 'not-allowed',
    });
    expect(changed).toBe(2);
    const larkin = await db.buildings.get(c.id);
    expect(larkin?.amenities.fitness).toBe(true);
    expect(larkin?.amenities.pool).toBe(true);
    expect(larkin?.pets.cats).toBe(true);
    expect(larkin?.pets.dogs).toBeNull();
    expect((await lastTitle(db)).title).toContain('Riverlight and The Larkin');
    await undo(db);
    expect((await db.buildings.get(c.id))?.amenities.pool).toBeNull();
    expect(await updateBuildings(db, [b.id], {})).toBe(0);
  });
});
