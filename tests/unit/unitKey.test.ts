import { unitKeyOf } from '../../src/domain/unitKey';

describe('unitKeyOf', () => {
  it.each([
    ['1504', '1504'],
    ['#1504', '1504'],
    ['Apt 1504', '1504'],
    ['apt. 1504', '1504'],
    ['Unit #1504', '1504'],
    ['Suite 2B', '2b'],
    ['No. 7', '7'],
    ['15-04', '1504'],
    ['  PH 2 ', 'ph2'],
    ['North 1', 'north1'], // "no" only counts as a designator before a number or space
    ['Garden', 'garden'],
  ])('%s → %s', (input, key) => {
    expect(unitKeyOf(input)).toBe(key);
  });

  it('is null for empty or missing unit numbers', () => {
    expect(unitKeyOf(null)).toBeNull();
    expect(unitKeyOf('')).toBeNull();
    expect(unitKeyOf('Apt #')).toBeNull();
  });
});
