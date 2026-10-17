import type { Geocoder, Place } from '../../src/services/geocode';
import { chipsFor, draftFromTyped, localMatches, lookUp, numberFrom } from '../../src/ui/add/plan';
import { makeAddress, newBuilding, newUnit } from '../../src/model/factories';

const place = (line1: string): Place => ({
  id: 'x',
  name: null,
  address: { line1, city: 'Minneapolis', state: 'MN', zip: null },
  location: { lat: 44.9, lng: -93.2, source: 'nominatim', precision: 'address' },
  neighborhood: null,
});
const service = (answer: Place | null | Error): Geocoder => ({
  suggest: () => Promise.resolve([]),
  lookup: () => (answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)),
});

describe('quick-add helpers', () => {
  it('finds your buildings by name or address words', () => {
    const a = newBuilding({
      name: 'Cedar Mill',
      address: makeAddress('1800 Cedar Lake Rd', 'St. Louis Park'),
    });
    const b = newBuilding({ address: makeAddress('5 Elm St', 'Minneapolis') });
    expect(localMatches([a, b], 'cedar')).toEqual([a]);
    expect(localMatches([a, b], 'elm st')).toEqual([b]);
    expect(localMatches([a, b], 'c')).toEqual([]);
  });

  it('uses a suggestion on screen for the same address before asking Nominatim', async () => {
    const shown = place('201 South Example Street');
    const lookup = vi.fn();
    expect(
      await lookUp('201 S Example St, Minneapolis', [shown], { suggest: vi.fn(), lookup }),
    ).toBe(shown);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('ignores a lookup that found a different street address', async () => {
    expect(await lookUp('3520 Example Ave S', [], service(place('1010 Nicollet Mall')))).toBeNull();
    expect(
      await lookUp('3520 Example Ave S', [], service(place('3520 Example Avenue South'))),
    ).not.toBeNull();
    // A name has no address to compare: the answer is used.
    expect(await lookUp('Riverlight', [], service(place('201 S Example St')))).not.toBeNull();
    expect(await lookUp('5 Elm St', [], service(new Error('offline')))).toBeNull();
  });

  it('makes a building from typed text when nothing was found', () => {
    expect(draftFromTyped('5 Elm St, Apt 2, Minneapolis, MN 55401', null)).toMatchObject({
      address: { line1: '5 Elm St', city: 'Minneapolis', zip: '55401' },
      location: null,
      name: null,
    });
    expect(draftFromTyped('Riverlight', null)).toMatchObject({
      address: { line1: 'Riverlight' },
      name: 'Riverlight',
    });
  });

  it('chips: fills on, changes off, same hidden, toggles flip', () => {
    const b = newBuilding({ address: makeAddress('1 Main St', null) });
    const u = newUnit({ buildingId: b.id, rent: 1500, dishwasher: true });
    const facts = [
      { field: 'unit.rent', value: 1650, label: '$1,650/mo' },
      { field: 'unit.dishwasher', value: true, label: 'Dishwasher' },
      { field: 'unit.balcony', value: true, label: 'Balcony' },
    ];
    const chips = chipsFor(facts, { unit: u, building: b }, new Set(['unit.balcony']), {
      includeInputs: true,
    });
    expect(chips.map((c) => [c.fact.field, c.status, c.on])).toEqual([
      ['unit.rent', 'changes', false],
      ['unit.balcony', 'fills', false],
    ]);
    // Quick-add shows rent in its own box, not as a chip
    expect(chipsFor(facts, {}, new Set()).map((c) => c.fact.field)).toEqual([
      'unit.dishwasher',
      'unit.balcony',
    ]);
  });

  it('reads typed numbers', () => {
    expect(numberFrom('$1,650')).toBe(1650);
    expect(numberFrom(' 1.5 ')).toBe(1.5);
    expect(numberFrom('')).toBeNull();
    expect(numberFrom('two')).toBeNull();
    expect(numberFrom('-3')).toBeNull();
  });
});
