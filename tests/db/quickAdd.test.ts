import { addToUnit, placeBuilding, quickAdd } from '../../src/commands/quickAdd';
import type { QuickAddInput, UnitDraft } from '../../src/commands/quickAdd';
import { createBuilding, deleteUnit } from '../../src/commands/records';
import { undo, undoAction } from '../../src/commands/undo';
import { parseListingText } from '../../src/domain/listingText';
import { makeAddress } from '../../src/model/factories';
import { dumpData, makeDb } from './helpers';

const TODAY = '2026-10-16';
const unitDraft = (over: Partial<UnitDraft> = {}): UnitDraft => ({
  unitNumber: '1504',
  isFloorPlanOnly: false,
  floorPlanName: null,
  rent: 1650,
  rentIsFrom: false,
  bedrooms: 1,
  bathrooms: 1,
  ...over,
});
const newBuildingInput = (over: Partial<QuickAddInput> = {}): QuickAddInput => ({
  today: TODAY,
  building: {
    draft: {
      address: makeAddress('201 S Example St', 'Minneapolis', 'MN', '55401'),
      location: { lat: 44.98, lng: -93.26, source: 'photon', precision: 'address' },
      name: 'Riverlight',
      neighborhood: 'Downtown East',
    },
  },
  unit: unitDraft(),
  listing: { url: 'https://www.zillow.com/homedetails/x/1_zpid/', site: 'zillow' },
  facts: [],
  pasted: null,
  ...over,
});

describe('quick-add', () => {
  it('adds a building, unit and listing with its first price as one undo step', async () => {
    const db = makeDb();
    const r = await quickAdd(db, newBuildingInput());
    expect(r.createdBuilding).toBe(true);
    expect(r.building).toMatchObject({
      name: 'Riverlight',
      neighborhood: { name: 'Downtown East', source: 'geocoder' },
      location: { source: 'photon' },
    });
    expect(r.unit).toMatchObject({
      unitNumber: '1504',
      unitKey: '1504',
      rent: 1650,
      bedrooms: 1,
      bathrooms: 1,
      status: 'new',
      addedVia: 'quick-add',
    });
    const listings = await db.listings.toArray();
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      unitId: r.unit.id,
      site: 'zillow',
      firstSeen: TODAY,
      lastSeen: TODAY,
      observations: [{ date: TODAY, rent: 1650, note: null }],
    });
    expect(await db.imports.count()).toBe(0);

    expect((await undo(db))?.label).toBe('Add unit');
    const data = await dumpData(db);
    expect(data.buildings).toEqual([]);
    expect(data.units).toEqual([]);
    expect(data.listings).toEqual([]);
  });

  it('saves without a location, and without a listing when there is no link or price', async () => {
    const db = makeDb();
    const input = newBuildingInput({ listing: null, unit: unitDraft({ rent: null }) });
    if ('draft' in input.building) input.building.draft.location = null;
    const r = await quickAdd(db, input);
    expect(r.building.location).toBeNull();
    expect(await db.listings.count()).toBe(0);
  });

  it('keeps a price seen without a link on a listing with no link', async () => {
    const db = makeDb();
    await quickAdd(db, newBuildingInput({ listing: null }));
    expect(await db.listings.toArray()).toMatchObject([
      { url: null, site: 'other', observations: [{ rent: 1650 }] },
    ]);
  });

  it('adds to a building already in the list', async () => {
    const db = makeDb();
    const b = await createBuilding(db, { address: makeAddress('201 S Example St', 'Minneapolis') });
    const r = await quickAdd(db, newBuildingInput({ building: { id: b.id } }));
    expect(r.createdBuilding).toBe(false);
    expect(r.unit.buildingId).toBe(b.id);
    expect(await db.buildings.count()).toBe(1);
  });

  it('adds a floor plan with no unit number', async () => {
    const db = makeDb();
    const r = await quickAdd(
      db,
      newBuildingInput({
        unit: unitDraft({
          unitNumber: '99',
          isFloorPlanOnly: true,
          floorPlanName: 'Plan C',
          rentIsFrom: true,
        }),
      }),
    );
    expect(r.unit).toMatchObject({
      unitNumber: null,
      unitKey: null,
      isFloorPlanOnly: true,
      floorPlanName: 'Plan C',
      rentIsFrom: true,
    });
    expect((await db.listings.toArray())[0]?.observations[0]?.note).toBe('from');
  });

  it('applies pasted facts with their sources and keeps the pasted text', async () => {
    const db = makeDb();
    const pasted = 'Heat included. Fitness center. Cats OK. 720 sq ft. In-unit laundry.';
    const { facts } = parseListingText(pasted, TODAY);
    const r = await quickAdd(db, newBuildingInput({ facts, pasted }));
    expect(r.unit).toMatchObject({
      squareFeet: 720,
      laundry: 'in-unit',
      utilities: { heat: { mode: 'included' } },
    });
    expect(r.building).toMatchObject({ amenities: { fitness: true }, pets: { cats: true } });
    const [imp] = await db.imports.toArray();
    expect(imp).toMatchObject({
      kind: 'listing-text',
      raw: pasted,
      summary: { created: 2, filled: facts.length },
    });
    expect(r.unit.fieldSources).toHaveLength(facts.length);
    expect(r.unit.fieldSources[0]).toMatchObject({
      via: 'paste',
      importId: imp?.id,
      url: 'https://www.zillow.com/homedetails/x/1_zpid/',
      seen: TODAY,
    });
    // The import record belongs to the same action, so it undoes with the unit.
    const log = await db.changeLog.toArray();
    expect(imp?.actionId).toBe(log[0]?.actionId);
    await undo(db);
    expect(await db.imports.count()).toBe(0);
  });
});

describe('adding to a unit you already have', () => {
  async function setup() {
    const db = makeDb();
    const r = await quickAdd(db, newBuildingInput());
    return { db, unit: r.unit };
  }

  it('records a new price on the same link instead of a second listing', async () => {
    const { db, unit } = await setup();
    await addToUnit(db, {
      unitId: unit.id,
      today: '2026-10-20',
      listing: { url: 'zillow.com/homedetails/x/1_zpid?utm_source=copy', site: 'zillow' },
      rent: 1600,
      rentIsFrom: false,
      facts: [],
      pasted: null,
    });
    const listings = await db.listings.toArray();
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      firstSeen: TODAY,
      lastSeen: '2026-10-20',
      observations: [
        { date: TODAY, rent: 1650 },
        { date: '2026-10-20', rent: 1600 },
      ],
    });
    expect((await db.units.get(unit.id))?.rent).toBe(1600);
  });

  it('adds a listing from another site, and undoes as one step', async () => {
    const { db, unit } = await setup();
    const before = await dumpData(db);
    const r = await addToUnit(db, {
      unitId: unit.id,
      today: TODAY,
      listing: {
        url: 'https://www.apartments.com/riverlight-minneapolis-mn/abc123/',
        site: 'apartments-com',
      },
      rent: null,
      rentIsFrom: false,
      facts: [],
      pasted: null,
    });
    expect(await db.listings.count()).toBe(2);
    expect(r.unit.rent).toBe(1650); // no new price: unchanged
    expect((await undo(db))?.label).toBe('Add listing');
    expect(await dumpData(db)).toEqual(before);
  });

  it('pastes text onto a unit: chosen facts apply, a pasted rent becomes a price', async () => {
    const { db, unit } = await setup();
    const pasted = '$1,595/mo. Dishwasher. Built in 2016. 1 bd';
    const { facts } = parseListingText(pasted, TODAY);
    const chosen = facts.filter((f) => f.field !== 'unit.bedrooms');
    await addToUnit(db, {
      unitId: unit.id,
      today: '2026-10-18',
      listing: null,
      rent: null,
      rentIsFrom: false,
      facts: chosen,
      pasted,
      skipped: 1,
    });
    const u = await db.units.get(unit.id);
    expect(u).toMatchObject({ rent: 1595, dishwasher: true });
    expect((await db.buildings.get(unit.buildingId))?.yearBuilt).toBe(2016);
    const [l] = await db.listings.toArray();
    expect(l?.observations.map((o) => o.rent)).toEqual([1650, 1595]);
    expect((await db.imports.toArray())[0]?.summary).toEqual({
      created: 0,
      filled: 2,
      changed: 1,
      skipped: 1,
    });
  });
});

describe('place on map', () => {
  it('sets the location from a map click, undoably', async () => {
    const db = makeDb();
    const b = await createBuilding(db, { address: makeAddress('1 Main St', 'Minneapolis') });
    await placeBuilding(db, b.id, { lat: 44.98, lng: -93.25 });
    expect((await db.buildings.get(b.id))?.location).toEqual({
      lat: 44.98,
      lng: -93.25,
      source: 'map-click',
      precision: 'address',
    });
    expect((await undo(db))?.label).toBe('Place on map');
    expect((await db.buildings.get(b.id))?.location).toBeNull();
  });
});

describe('undoing one particular action', () => {
  it('undoes a delete only while it is still the latest action', async () => {
    const db = makeDb();
    const r = await quickAdd(db, newBuildingInput());
    const id = await deleteUnit(db, r.unit.id);
    expect((await db.units.get(r.unit.id))?.deletedAt).not.toBeNull();
    expect(await undoAction(db, id)).toBe(true);
    expect((await db.units.get(r.unit.id))?.deletedAt).toBeNull();

    const again = await deleteUnit(db, r.unit.id);
    await placeBuilding(db, r.building.id, { lat: 45, lng: -93 });
    expect(await undoAction(db, again)).toBe(false); // something else happened since
    expect((await db.units.get(r.unit.id))?.deletedAt).not.toBeNull();
  });
});
