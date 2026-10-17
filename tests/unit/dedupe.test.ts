import { matchBuilding, matchUnit, similarName } from '../../src/domain/dedupe';
import { makeAddress, newBuilding, newListing, newUnit } from '../../src/model/factories';

const riverlight = newBuilding({
  name: 'Riverlight',
  address: makeAddress('201 South Example Street', 'Minneapolis', 'MN', '55401'),
  location: { lat: 44.98, lng: -93.26, source: 'photon', precision: 'address' },
});
const larch = newBuilding({
  name: 'The Larch',
  address: makeAddress('200 Example Ave S', 'Minneapolis'),
  location: null,
});

describe('building match', () => {
  it('matches the same street address, however it is written', () => {
    expect(
      matchBuilding([larch, riverlight], {
        address: { line1: '201 S. Example St, Apt 1504', city: 'Minneapolis' },
        location: null,
        name: null,
      }),
    ).toEqual({ building: riverlight, reason: 'address' });
  });

  it('matches a building within 25 m with a similar name', () => {
    const near = { lat: 44.98015, lng: -93.26, source: 'photon', precision: 'address' } as const; // ≈ 17 m
    expect(
      matchBuilding([riverlight], {
        address: { line1: '205 S Example St', city: 'Minneapolis' },
        location: near,
        name: 'Riverlight Apartments',
      })?.reason,
    ).toBe('nearby');
    // Same spot, different name: a different building
    expect(
      matchBuilding([riverlight], {
        address: { line1: '205 S Example St', city: null },
        location: near,
        name: 'Cedar Mill',
      }),
    ).toBeNull();
    // Similar name, too far
    expect(
      matchBuilding([riverlight], {
        address: { line1: '9 Other St', city: null },
        location: { lat: 44.99, lng: -93.26 },
        name: 'Riverlight',
      }),
    ).toBeNull();
  });

  it('ignores deleted buildings', () => {
    const gone = { ...riverlight, deletedAt: '2026-10-16T00:00:00.000Z' };
    expect(
      matchBuilding([gone], {
        address: { line1: '201 S Example St', city: null },
        location: null,
        name: null,
      }),
    ).toBeNull();
  });

  it('compares names loosely', () => {
    expect(similarName('The Larch Apartments', 'Larch')).toBe(true);
    expect(similarName('Riverlight Lofts', 'Riverlight')).toBe(true);
    expect(similarName('Cedar Mill', 'Mill City Quarter')).toBe(false);
    expect(similarName(null, 'X')).toBe(false);
  });
});

describe('unit match', () => {
  const u1504 = newUnit({ buildingId: riverlight.id, unitNumber: 'Apt 1504', unitKey: '1504' });
  const planC = newUnit({
    buildingId: riverlight.id,
    isFloorPlanOnly: true,
    floorPlanName: 'Plan C',
  });
  const other = newUnit({ buildingId: larch.id, unitNumber: '3F', unitKey: '3f' });
  const listing = newListing({
    unitId: other.id,
    firstSeen: '2026-10-01',
    url: 'https://www.zillow.com/homedetails/x/1_zpid/',
    site: 'zillow',
  });
  const units = [u1504, planC, other];

  it('matches the same link first', () => {
    expect(
      matchUnit(units, [listing], {
        buildingId: riverlight.id,
        unitNumber: '1504',
        floorPlanName: null,
        isFloorPlanOnly: false,
        url: 'zillow.com/homedetails/x/1_zpid?utm_source=share',
      }),
    ).toEqual({ unit: other, reason: 'url', listing });
  });

  it('matches the same unit number in the same building', () => {
    expect(
      matchUnit(units, [], {
        buildingId: riverlight.id,
        unitNumber: '#1504',
        floorPlanName: null,
        isFloorPlanOnly: false,
        url: null,
      })?.unit,
    ).toBe(u1504);
    expect(
      matchUnit(units, [], {
        buildingId: larch.id,
        unitNumber: '1504',
        floorPlanName: null,
        isFloorPlanOnly: false,
        url: null,
      }),
    ).toBeNull();
  });

  it('only suggests floor plans', () => {
    expect(
      matchUnit(units, [], {
        buildingId: riverlight.id,
        unitNumber: null,
        floorPlanName: 'plan c',
        isFloorPlanOnly: true,
        url: null,
      })?.reason,
    ).toBe('floor-plan');
  });

  it('ignores deleted units and listings', () => {
    const gone = { ...u1504, deletedAt: '2026-10-16T00:00:00.000Z' };
    expect(
      matchUnit([gone], [], {
        buildingId: riverlight.id,
        unitNumber: '1504',
        floorPlanName: null,
        isFloorPlanOnly: false,
        url: null,
      }),
    ).toBeNull();
  });
});
