import { applyFacts, factStatus } from '../../src/domain/facts';
import { parseListingText } from '../../src/domain/listingText';
import type { Fact } from '../../src/domain/listingText';
import { building, unit } from '../../src/model';
import { makeAddress, newBuilding, newUnit } from '../../src/model/factories';

const b = newBuilding({ address: makeAddress('1 Main St', 'Minneapolis') });
const u = newUnit({ buildingId: b.id, rent: 1500, bedrooms: null });
const source = {
  today: '2026-10-16',
  url: 'https://zillow.com/x',
  via: 'paste' as const,
  importId: 'imp1',
};

describe('facts', () => {
  it('says whether a fact fills, matches or changes a value', () => {
    const t = { unit: u, building: b };
    expect(factStatus({ field: 'unit.bedrooms', value: 1, label: '' }, t)).toBe('fills');
    expect(factStatus({ field: 'unit.rent', value: 1500, label: '' }, t)).toBe('same');
    expect(factStatus({ field: 'unit.rent', value: 1650, label: '' }, t)).toBe('changes');
    expect(factStatus({ field: 'unit.rent', value: 1650, label: '' }, {})).toBe('fills');
    expect(factStatus({ field: 'building.amenities.pool', value: true, label: '' }, t)).toBe(
      'fills',
    );
  });

  it('applies nested values and records their sources', () => {
    const facts: Fact[] = [
      { field: 'unit.bedrooms', value: 1, label: '1 bd' },
      { field: 'unit.utilities.heat', value: { mode: 'included' }, label: 'Heat included' },
      { field: 'unit.parking.extraSpaceCost', value: 150, label: 'Parking $150/mo' },
      { field: 'building.pets.cats', value: true, label: 'Cats OK' },
      { field: 'building.amenities.fitness', value: true, label: 'Fitness center' },
      {
        field: 'unit.rent',
        value: 1450,
        label: 'from $1,450/mo',
        also: [{ field: 'unit.rentIsFrom', value: true }],
      },
      { field: 'unit.recurringFees', value: [{ label: 'Amenity fee', amount: 50 }], label: 'Fees' },
    ];
    let n = 0;
    const r = applyFacts({ unit: u, building: b }, facts, source, () => `id${++n}`);
    expect(r.unit).toMatchObject({
      bedrooms: 1,
      rent: 1450,
      rentIsFrom: true,
      utilities: { heat: { mode: 'included' }, electric: null },
      parking: { extraSpaceCost: 150, spacesIncluded: null, type: null },
      recurringFees: [{ id: 'id1', label: 'Amenity fee', amount: 50 }],
    });
    expect(r.building.pets).toMatchObject({ cats: true, dogs: null });
    expect(r.building.amenities.fitness).toBe(true);
    expect(r.unit.fieldSources.map((s) => s.field)).toEqual(facts.map((f) => f.field));
    expect(r.unit.fieldSources[0]).toEqual({
      field: 'unit.bedrooms',
      url: 'https://zillow.com/x',
      seen: '2026-10-16',
      via: 'paste',
      importId: 'imp1',
    });
    // still valid records
    unit.parse(r.unit);
    building.parse(r.building);
    // the originals are untouched
    expect(u.bedrooms).toBeNull();
    expect(b.pets.cats).toBeNull();
  });

  it('every fact the parser makes applies to a valid record', () => {
    const text = [
      '$1,650/mo · 1 bd · 1 ba · 720 sqft · Unit 1504 · 15th floor · Plan C',
      'Available Jun 1 · 12 or 15 month lease · Deposit $500 · Application fee $50 · Admin fee $200',
      'Amenity fee $40/mo · Special: 1 month free',
      'In-unit laundry · Dishwasher · Central air · Forced air · Balcony · Fireplace · Unfurnished',
      'Condo for rent · Garage parking $150/mo · Storage included',
      'Heat included. Tenant pays electric. Water/sewer/trash: $60/mo flat fee.',
      'Cats OK · No dogs · Pet rent $35/mo · Pet deposit $300 · Pet fee $200',
      'Fitness center · Pool · Coworking · Rooftop deck · Package lockers · Bike room · EV charging',
      'Guest suite · Dog run · Concierge · Skyway · Built in 2016 · 24 stories · Elevator · No smoking',
    ].join('\n');
    const { facts } = parseListingText(text, '2026-10-16');
    expect(facts.length).toBeGreaterThanOrEqual(40);
    const r = applyFacts({ unit: newUnit({ buildingId: b.id }), building: b }, facts, source);
    expect(r.applied).toHaveLength(facts.length);
    expect(() => unit.parse(r.unit)).not.toThrow();
    expect(() => building.parse(r.building)).not.toThrow();
  });
});
