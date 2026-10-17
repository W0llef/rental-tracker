import {
  addressKey,
  makeAddress,
  normalizeCity,
  normalizeStreet,
  parseAddress,
  sameAddress,
  splitUnit,
} from '../../src/domain/address';

describe('address normalization', () => {
  // Real Twin Cities address shapes (PLAN.md §8)
  it.each([
    ['201 South Example Street', '201 s example st'],
    ['201 S. Example St.', '201 s example st'],
    ['1010 Nicollet Mall', '1010 nicollet mall'],
    ['200 Portland Avenue South', '200 portland ave s'],
    ['200 Portland Ave S Apt 1504', '200 portland ave s'],
    ['200 Portland Ave S, #1504', '200 portland ave s'],
    ['1800 Cedar Lake Road', '1800 cedar lake rd'],
    ['2850 Hennepin Ave.', '2850 hennepin ave'],
    ['350 Saint Peter Street', '350 st peter st'],
    ['350 St. Peter St', '350 st peter st'],
    ['3520 Example Ave S Unit 2', '3520 example ave s'],
    ['720 Washington Ave SE Ste 300', '720 washington ave se'],
    ['1 Main Street Southeast', '1 main st se'],
    ['100 Summit Parkway', '100 summit pkwy'],
  ])('%s → %s', (input, out) => {
    expect(normalizeStreet(input)).toBe(out);
  });

  it('normalizes city names', () => {
    expect(normalizeCity('Saint Paul')).toBe('st paul');
    expect(normalizeCity('St. Paul')).toBe('st paul');
    expect(normalizeCity('Mpls')).toBe('minneapolis');
    expect(normalizeCity(null)).toBe('');
  });

  it('splits the unit off a street line', () => {
    expect(splitUnit('200 Portland Ave S Apt 1504')).toEqual({
      street: '200 Portland Ave S',
      unit: '1504',
    });
    expect(splitUnit('200 Portland Ave S #4B')).toEqual({
      street: '200 Portland Ave S',
      unit: '4B',
    });
    expect(splitUnit('200 Portland Ave S, Unit 12')).toEqual({
      street: '200 Portland Ave S',
      unit: '12',
    });
    expect(splitUnit('#5')).toEqual({ street: '#5', unit: null });
    expect(splitUnit('1010 Nicollet Mall')).toEqual({ street: '1010 Nicollet Mall', unit: null });
  });

  it('compares addresses, ignoring an unknown city', () => {
    const a = makeAddress('200 Portland Avenue South', 'Minneapolis');
    expect(sameAddress(a, { line1: '200 Portland Ave S, Apt 3', city: 'Minneapolis' })).toBe(true);
    expect(sameAddress(a, { line1: '200 Portland Ave S', city: null })).toBe(true);
    expect(sameAddress(a, { line1: '200 Portland Ave S', city: 'St. Paul' })).toBe(false);
    expect(sameAddress(a, { line1: '202 Portland Ave S', city: 'Minneapolis' })).toBe(false);
    expect(sameAddress({ line1: '', city: null }, { line1: '', city: null })).toBe(false);
    expect(addressKey('200 Portland Avenue South', 'Minneapolis')).toBe(
      '200 portland ave s|minneapolis',
    );
  });

  it.each([
    [
      '201 S Example St, Apt 4, Minneapolis, MN 55401',
      { line1: '201 S Example St', unit: '4', city: 'Minneapolis', state: 'MN', zip: '55401' },
    ],
    [
      '201 S Example St Minneapolis MN 55401',
      { line1: '201 S Example St', unit: null, city: 'Minneapolis', state: 'MN', zip: '55401' },
    ],
    [
      '350 St Peter St, Saint Paul, MN',
      { line1: '350 St Peter St', unit: null, city: 'St. Paul', state: 'MN', zip: null },
    ],
    [
      '1800 Cedar Lake Rd St Louis Park',
      { line1: '1800 Cedar Lake Rd', unit: null, city: 'St. Louis Park', state: 'MN', zip: null },
    ],
    [
      '1010 Nicollet Mall',
      { line1: '1010 Nicollet Mall', unit: null, city: null, state: null, zip: null },
    ],
  ])('reads %s', (text, parsed) => {
    expect(parseAddress(text)).toEqual(parsed);
  });

  it("doesn't read text without a house number", () => {
    expect(parseAddress('Riverlight')).toBeNull();
  });
});
