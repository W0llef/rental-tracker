import { describe, expect, it } from 'vitest';
import {
  CHECKS,
  checkHref,
  completeness,
  essentialChecks,
  essentials,
  fieldKnown,
  nextCheckedUnknown,
} from '../../src/domain/completeness';
import { COPY_PATHS, copyDetails, unitFromSource } from '../../src/domain/copyFrom';
import {
  numText,
  parseFloor,
  parseMoney,
  parseStep,
  parseUrl,
  parseWhole,
  parseYear,
} from '../../src/domain/input';
import {
  changedFields,
  dropStaleSources,
  latestPrice,
  normalizeListing,
  reconcileRent,
} from '../../src/domain/unitForm';
import { isStandalone, standaloneDefault } from '../../src/domain/standalone';
import { DEFAULT_ESSENTIAL_FIELDS } from '../../src/model';
import type { Listing, Unit } from '../../src/model';
import { makeAddress, newBuilding, newListing, newUnit } from '../../src/model/factories';

const building = () => newBuilding({ address: makeAddress('200 Portland Ave S', 'Minneapolis') });
const unitIn = (b = building(), extra: Partial<Unit> = {}) =>
  newUnit({ buildingId: b.id, unitNumber: '1504', ...extra });

describe('completeness checks', () => {
  it('have unique keys and every default essential is a check', () => {
    const keys = CHECKS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of DEFAULT_ESSENTIAL_FIELDS) expect(keys).toContain(k);
  });

  it('counts a new unit as empty and a filled one as complete', () => {
    const b = building();
    const u = unitIn(b);
    const empty = completeness({ unit: u, building: b }, 'unit');
    expect(empty.filled).toBe(0);
    expect(empty.percent).toBe(0);
    expect(empty.sections.get('specs')?.status).toBe('empty');

    const full: Unit = {
      ...u,
      type: 'apartment',
      bedrooms: 1,
      bathrooms: 1,
      squareFeet: 720,
      floor: 15,
      exposure: ['S'],
      windows: [],
      laundry: 'in-unit',
      dishwasher: true,
      acType: 'central',
      heatingType: 'forced-air',
      balcony: false,
      fireplace: false,
      flooring: 'Hardwood',
      furnished: 'no',
      rent: 1650,
      availableDate: '2027-06-01',
      leaseTermsMonths: [12],
      deposit: 500,
      applicationFee: 50,
      adminFee: 0,
      utilities: {
        heat: { mode: 'included' },
        electric: { mode: 'tenant-paid', estimate: null },
        waterSewer: { mode: 'extra', amount: 45 },
        trash: { mode: 'included' },
        gas: { mode: 'included' },
        internet: { mode: 'tenant-paid', estimate: 60 },
      },
      recurringFees: [],
      parking: { type: 'street', spacesIncluded: null, extraSpaceCost: null },
      storage: { included: true, cost: null },
    };
    const c = completeness({ unit: full, building: b }, 'unit');
    expect(c.missing.map((m) => m.key)).toEqual([]);
    expect(c.percent).toBe(100);
    expect(c.sections.get('parking')?.status).toBe('complete');
  });

  it('leaves out checks that don’t apply', () => {
    const b = building();
    const plan = unitIn(b, { unitNumber: null, isFloorPlanOnly: true, floorPlanName: 'Plan C' });
    const keys = completeness({ unit: plan, building: b }, 'unit').missing.map((m) => m.key);
    expect(keys).not.toContain('unit.floor');
    expect(keys).not.toContain('unit.windows');
    expect(keys).not.toContain('unit.parking.extraSpaceCost'); // parking type unknown

    const garage = unitIn(b, {
      parking: { type: 'garage', spacesIncluded: null, extraSpaceCost: null },
      storage: { included: false, cost: null },
    });
    const g = completeness({ unit: garage, building: b }, 'unit').missing.map((m) => m.key);
    expect(g).toContain('unit.parking'); // a garage needs the spaces included too
    expect(g).toContain('unit.parking.extraSpaceCost');
    expect(g).toContain('unit.storage.cost');
  });

  it('marks sections partly filled', () => {
    const b = building();
    const u = unitIn(b, { bedrooms: 2 });
    expect(completeness({ unit: u, building: b }, 'unit').sections.get('specs')?.status).toBe(
      'partly',
    );
  });

  it('works out the building’s own completeness, pets as one check', () => {
    const b = { ...building(), pets: { ...building().pets, cats: true } };
    const c = completeness({ building: b }, 'building');
    expect(c.missing.map((m) => m.key)).toContain('building.pets');
    const both = { ...b, pets: { ...b.pets, dogs: false } };
    const d = completeness({ building: both }, 'building').missing.map((m) => m.key);
    expect(d).not.toContain('building.pets');
    expect(d).toContain('building.pets.monthlyRent'); // cats allowed: is there pet rent?
  });
});

describe('essentials', () => {
  it('reads unit and building checks and says when the unit is ready to compare', () => {
    const b = building();
    const u = unitIn(b, { rent: 1650, bedrooms: 1 });
    const e = essentials({ unit: u, building: b }, DEFAULT_ESSENTIAL_FIELDS);
    expect(e.total).toBe(DEFAULT_ESSENTIAL_FIELDS.length);
    expect(e.filled).toBe(2);
    expect(e.ready).toBe(false);
    expect(e.missing.map((m) => m.key)).toContain('building.pets');

    const ready = essentials({ unit: u, building: b }, [
      'unit.rent',
      'unit.bedrooms',
      'not.a.field',
    ]);
    expect(ready).toMatchObject({ filled: 2, total: 2, ready: true });
  });

  it('keeps form order whatever order they were chosen in', () => {
    expect(essentialChecks(['building.pets', 'unit.rent']).map((c) => c.key)).toEqual([
      'unit.rent',
      'building.pets',
    ]);
  });

  it('links each missing essential to the form that edits it', () => {
    const [rent, pets] = essentialChecks(['unit.rent', 'building.pets']);
    expect(checkHref(rent!, { unitId: 'u1', buildingId: 'b1' })).toBe(
      '/unit/u1/edit?field=unit.rent',
    );
    expect(checkHref(pets!, { unitId: 'u1', buildingId: 'b1' })).toBe(
      '/building/b1/edit?field=building.pets.cats&unit=u1',
    );
  });
});

describe('copy details', () => {
  it('fills unknowns only, keeps your values, never copies unit-specific fields', () => {
    const b = building();
    let n = 0;
    const source = unitIn(b, {
      unitNumber: '908',
      floor: 9,
      rent: 1600,
      exposure: ['S'],
      windows: [{ id: 'w', room: 'Living', direction: 'S', size: 'large', obstruction: null }],
      bedrooms: 1,
      bathrooms: 1,
      laundry: 'in-unit',
      recurringFees: [{ id: 'fee-1', label: 'Amenity fee', amount: 40 }],
      utilities: { ...unitIn().utilities, heat: { mode: 'included' } },
      parking: { type: 'garage', spacesIncluded: 0, extraSpaceCost: 150 },
    });
    const target = unitIn(b, { unitNumber: '1504', bathrooms: 2 });
    const r = copyDetails(source, target, () => `id-${++n}`);
    expect(r.unit.unitNumber).toBe('1504');
    expect(r.unit.floor).toBeNull();
    expect(r.unit.rent).toBeNull();
    expect(r.unit.exposure).toBeNull();
    expect(r.unit.windows).toBeNull();
    expect(r.unit.bedrooms).toBe(1);
    expect(r.unit.bathrooms).toBe(2); // yours wins
    expect(r.kept).toEqual(['bathrooms']);
    expect(r.copied).toContain('utilities.heat');
    expect(r.unit.utilities.heat).toEqual({ mode: 'included' });
    expect(r.unit.utilities.electric).toBeNull();
    expect(r.unit.parking).toEqual({ type: 'garage', spacesIncluded: 0, extraSpaceCost: 150 });
    expect(r.unit.recurringFees).toEqual([{ id: 'id-1', label: 'Amenity fee', amount: 40 }]);
    // the source isn't touched
    expect(source.recurringFees![0]!.id).toBe('fee-1');
  });

  it('makes a new unit from a floor plan', () => {
    const b = building();
    const plan = unitIn(b, {
      unitNumber: null,
      isFloorPlanOnly: true,
      floorPlanName: 'Plan C',
      bedrooms: 2,
      rent: 2400,
      rentIsFrom: true,
    });
    const u = unitFromSource(plan);
    expect(u.id).not.toBe(plan.id);
    expect(u).toMatchObject({
      buildingId: b.id,
      floorPlanName: 'Plan C',
      isFloorPlanOnly: false,
      bedrooms: 2,
      rent: null,
      rentIsFrom: false,
      unitNumber: null,
      status: 'new',
    });
  });

  it('copies only paths that exist on a unit', () => {
    const u = unitIn();
    for (const p of COPY_PATHS) {
      const v = p.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], u);
      expect(v, p).not.toBeUndefined();
    }
  });
});

describe('form input', () => {
  it('reads money, counts and steps', () => {
    expect(parseMoney('$1,650')).toEqual({ ok: true, value: 1650 });
    expect(parseMoney('1650/mo')).toEqual({ ok: true, value: 1650 });
    expect(parseMoney('')).toEqual({ ok: true, value: null });
    expect(parseMoney('?')).toEqual({ ok: true, value: null });
    expect(parseMoney('lots').ok).toBe(false);
    expect(parseWhole('720 sq ft')).toEqual({ ok: true, value: 720 });
    expect(parseStep('1.5', 0.5, { what: 'bathrooms' })).toEqual({ ok: true, value: 1.5 });
    expect(parseStep('1 1/2', 0.5, { what: 'bathrooms' })).toEqual({ ok: true, value: 1.5 });
    expect(parseStep('1.3', 0.5, { what: 'bathrooms' }).ok).toBe(false);
    expect(parseFloor('-1')).toEqual({ ok: true, value: -1 });
    expect(parseYear('1700').ok).toBe(false);
    expect(parseYear('2019')).toEqual({ ok: true, value: 2019 });
    expect(numText(null)).toBe('');
  });

  it('reads web addresses', () => {
    expect(parseUrl('riverlight.example')).toEqual({
      ok: true,
      value: 'https://riverlight.example/',
    });
    expect(parseUrl('javascript:alert(1)').ok).toBe(false);
    expect(parseUrl('localhost').ok).toBe(false);
    expect(parseUrl(' ')).toEqual({ ok: true, value: null });
  });
});

describe('rent and price history in the form', () => {
  const today = '2026-10-18';
  const listingFor = (u: Unit, extra: Partial<Listing>) =>
    newListing({ unitId: u.id, firstSeen: '2026-10-01', site: 'zillow', ...extra });
  const fresh = (u: Unit) => () => newListing({ unitId: u.id, firstSeen: today });

  it('records a typed rent as today’s price on the newest listing', () => {
    const u = unitIn(building(), { rent: 1650 });
    const l = listingFor(u, {
      lastSeen: '2026-10-05',
      observations: [{ date: '2026-10-01', rent: 1650, note: null }],
    });
    const r = reconcileRent({
      stored: { unit: u, listings: [l] },
      draft: { unit: { ...u, rent: 1600 }, listings: [l] },
      today,
      newListing: fresh(u),
    });
    expect(r.effect).toEqual({ kind: 'observe', listingId: l.id, isNew: false, rent: 1600 });
    expect(r.listings[0]!.observations.at(-1)).toEqual({ date: today, rent: 1600, note: null });
    expect(r.listings[0]!.lastSeen).toBe(today);
  });

  it('starts a listing without a link when there is none', () => {
    const u = unitIn(building());
    const r = reconcileRent({
      stored: { unit: u, listings: [] },
      draft: { unit: { ...u, rent: 1700, rentIsFrom: true }, listings: [] },
      today,
      newListing: fresh(u),
    });
    expect(r.effect).toMatchObject({ kind: 'observe', isNew: true, rent: 1700 });
    expect(r.listings).toHaveLength(1);
    expect(r.listings[0]!.observations).toEqual([{ date: today, rent: 1700, note: 'from' }]);
  });

  it('makes the rent follow an edited price history', () => {
    const u = unitIn(building(), { rent: 1650 });
    const l = listingFor(u, { observations: [{ date: '2026-10-01', rent: 1650, note: null }] });
    const edited = {
      ...l,
      observations: [...l.observations, { date: '2026-10-10', rent: 1625, note: null }],
    };
    const r = reconcileRent({
      stored: { unit: u, listings: [l] },
      draft: { unit: u, listings: [edited] },
      today,
      newListing: fresh(u),
    });
    expect(r.effect).toEqual({ kind: 'follow', rent: 1625, from: false });
    expect(r.unit.rent).toBe(1625);
    expect(r.listings[0]!.lastSeen).toBe('2026-10-10');
  });

  it('changes nothing when neither moved, or the typed rent is already the latest price', () => {
    const u = unitIn(building(), { rent: 1650 });
    const l = listingFor(u, { observations: [{ date: '2026-10-01', rent: 1650, note: null }] });
    expect(
      reconcileRent({
        stored: { unit: u, listings: [l] },
        draft: { unit: { ...u, bedrooms: 1 }, listings: [l] },
        today,
        newListing: fresh(u),
      }).effect,
    ).toBeNull();
    const removed = reconcileRent({
      stored: { unit: u, listings: [l] },
      draft: { unit: { ...u, rent: null }, listings: [l] },
      today,
      newListing: fresh(u),
    });
    expect(removed.effect).toBeNull();
    expect(removed.unit.rent).toBeNull();
  });

  it('keeps listings tidy and finds the newest price', () => {
    const u = unitIn();
    const l = normalizeListing(
      listingFor(u, {
        firstSeen: '2026-10-05',
        lastSeen: '2026-10-05',
        observations: [
          { date: '2026-10-09', rent: 1600, note: null },
          { date: '2026-10-02', rent: 1700, note: null },
        ],
      }),
    );
    expect(l.observations.map((o) => o.date)).toEqual(['2026-10-02', '2026-10-09']);
    expect([l.firstSeen, l.lastSeen]).toEqual(['2026-10-02', '2026-10-09']);
    expect(latestPrice([l])?.observation.rent).toBe(1600);
    expect(latestPrice([{ ...l, deletedAt: '2026-10-10T00:00:00.000Z' }])).toBeNull();
  });
});

describe('sources after hand edits', () => {
  it('drops the sources of changed fields only', () => {
    const u = unitIn();
    const after = {
      ...u,
      rent: 1600,
      utilities: { ...u.utilities, heat: { mode: 'extra' as const, amount: 40 } },
    };
    const changed = changedFields(u, after);
    expect(changed.sort()).toEqual(['rent', 'utilities.heat']);
    const src = (field: string) => ({
      field,
      url: null,
      seen: '2026-10-01',
      via: 'paste' as const,
      importId: null,
    });
    const kept = dropStaleSources(
      [src('unit.rent'), src('unit.utilities.heat'), src('unit.bedrooms'), src('building.floors')],
      changed,
      'unit',
    );
    expect(kept.map((s) => s.field)).toEqual(['unit.bedrooms', 'building.floors']);
  });
});

describe('standalone homes (Q30)', () => {
  const b = (patch: Record<string, unknown> = {}) => ({
    complexName: null,
    buildingType: null,
    standalone: null,
    ...patch,
  });
  it('defaults by the unit’s type', () => {
    expect(isStandalone(b(), [{ type: 'house' }])).toBe(true);
    expect(isStandalone(b(), [{ type: 'townhome' }])).toBe(true);
    expect(isStandalone(b(), [{ type: 'apartment' }])).toBe(false);
    expect(isStandalone(b(), [{ type: 'room' }])).toBe(false);
    expect(isStandalone(b({ buildingType: 'house' }), [{ type: null }])).toBe(true);
    expect(isStandalone(b(), [{ type: null }])).toBe(false);
    expect(isStandalone(b({ buildingType: 'house' }), [])).toBe(true);
  });
  it('is shared with a complex name or several units, and follows a choice', () => {
    expect(isStandalone(b({ complexName: 'Cedar Mill' }), [{ type: 'townhome' }])).toBe(false);
    expect(isStandalone(b(), [{ type: 'house' }, { type: 'house' }])).toBe(false);
    expect(isStandalone(b({ standalone: false }), [{ type: 'house' }])).toBe(false);
    expect(isStandalone(b({ standalone: true }), [{ type: 'apartment' }])).toBe(true);
    expect(isStandalone(b({ standalone: true }), [{ type: 'house' }, { type: 'house' }])).toBe(
      false,
    );
    expect(standaloneDefault(b({ standalone: true }), [{ type: 'apartment' }])).toBe(false);
  });
});

describe('remembered unknowns (Q29)', () => {
  it('count as done in completeness, but not as known essentials', () => {
    const b = building();
    const u = {
      ...unitIn(b),
      checkedUnknown: [{ field: 'unit.balcony', at: '2026-10-19' }],
    };
    const c = completeness({ unit: u, building: b }, 'unit');
    expect(c.checked).toBe(1);
    expect(c.unknown.map((k) => k.key)).toEqual(['unit.balcony']);
    expect(c.missing.map((k) => k.key)).not.toContain('unit.balcony');

    const withRent = { ...u, checkedUnknown: [{ field: 'unit.rent', at: '2026-10-19' }] };
    const e = essentials({ unit: withRent, building: b }, ['unit.rent', 'unit.bedrooms']);
    expect(e.unknown.map((k) => k.key)).toEqual(['unit.rent']);
    expect(e.missing.map((k) => k.key)).toEqual(['unit.bedrooms']);
    expect(e.ready).toBe(false);
  });

  it('keep the first date, drop fields that became known, ignore other records and notes', () => {
    const next = nextCheckedUnknown(
      new Set(['unit.balcony', 'unit.rent', 'unit.viewNotes', 'building.pets.dogs']),
      [{ field: 'unit.balcony', at: '2026-10-01' }],
      'unit',
      (f) => f === 'unit.rent',
      '2026-10-19',
    );
    expect(next).toEqual([{ field: 'unit.balcony', at: '2026-10-01' }]);
    expect(fieldKnown({ unit: unitIn(building(), { rent: 1 }) }, 'unit.rent')).toBe(true);
    expect(fieldKnown({ building: building() }, 'building.pets.dogs')).toBe(false);
  });
});
