import fc from 'fast-check';
import {
  compareValues,
  sortBuildings,
  sortBy,
  sortUnits,
  UNIT_SORT_KEYS,
  unitSortValue,
} from '../../src/domain/sort';
import type { SortValue, UnitSortInput } from '../../src/domain/sort';
import type { Unit } from '../../src/model';
import { makeAddress, newBuilding, newUnit } from '../../src/model/factories';

const riverlight = newBuilding({
  name: 'Riverlight',
  address: makeAddress('200 Portland Ave S', 'Minneapolis'),
});
const larkin = newBuilding({
  name: 'The Larkin',
  address: makeAddress('1010 Nicollet Mall', 'Minneapolis'),
});

function row(
  input: Partial<Unit>,
  building = riverlight,
  listingAgeDays: number | null = null,
): UnitSortInput {
  return { unit: newUnit({ buildingId: building.id, ...input }), building, listingAgeDays };
}

const titles = (rows: UnitSortInput[]) => rows.map((r) => r.unit.unitNumber);

describe('compareValues', () => {
  it('puts unknown values last in both directions', () => {
    const values: SortValue[] = [3, null, 1, null, 2];
    const asc = [...values].sort((a, b) => compareValues(a, b, 'asc'));
    const desc = [...values].sort((a, b) => compareValues(a, b, 'desc'));
    expect(asc).toEqual([1, 2, 3, null, null]);
    expect(desc).toEqual([3, 2, 1, null, null]);
  });

  it('compares text in natural order, ignoring case', () => {
    const values: SortValue[] = ['Unit 10', 'unit 9', 'Unit 100'];
    expect([...values].sort((a, b) => compareValues(a, b, 'asc'))).toEqual([
      'unit 9',
      'Unit 10',
      'Unit 100',
    ]);
  });

  it('never lets an unknown come before a known value (property)', () => {
    const value = fc.option(fc.integer({ min: -1000, max: 1000 }), { nil: null });
    fc.assert(
      fc.property(
        fc.array(value),
        fc.constantFrom('asc' as const, 'desc' as const),
        (vals, dir) => {
          const sorted = sortBy(
            vals,
            (v) => v,
            dir,
            () => '',
          );
          const firstUnknown = sorted.indexOf(null);
          if (firstUnknown === -1) return true;
          return sorted.slice(firstUnknown).every((v) => v === null);
        },
      ),
    );
  });
});

describe('sortUnits', () => {
  const rows = [
    row({ unitNumber: '1504', rent: 1650, squareFeet: 720 }),
    row({ unitNumber: '908', rent: null, squareFeet: 690 }),
    row({ unitNumber: '310', rent: 1295, squareFeet: null }),
    row({ unitNumber: '2203', rent: 2240, squareFeet: 1080 }),
  ];

  it('sorts by rent, unknown rent last either way', () => {
    expect(titles(sortUnits(rows, { key: 'rent', dir: 'asc' }))).toEqual([
      '310',
      '1504',
      '2203',
      '908',
    ]);
    expect(titles(sortUnits(rows, { key: 'rent', dir: 'desc' }))).toEqual([
      '2203',
      '1504',
      '310',
      '908',
    ]);
  });

  it('sorts by size with unknown size last', () => {
    expect(titles(sortUnits(rows, { key: 'squareFeet', dir: 'desc' }))).toEqual([
      '2203',
      '1504',
      '908',
      '310',
    ]);
  });

  it('does not change the input array', () => {
    const before = titles(rows);
    sortUnits(rows, { key: 'rent', dir: 'desc' });
    expect(titles(rows)).toEqual(before);
  });

  it('treats an unrated unit (0 stars) as unknown', () => {
    const rated = [
      row({ unitNumber: 'a', rating: 0 }),
      row({ unitNumber: 'b', rating: 2 }),
      row({ unitNumber: 'c', rating: 5 }),
    ];
    expect(titles(sortUnits(rated, { key: 'rating', dir: 'desc' }))).toEqual(['c', 'b', 'a']);
    expect(titles(sortUnits(rated, { key: 'rating', dir: 'asc' }))).toEqual(['b', 'c', 'a']);
  });

  it('sorts status in pipeline order', () => {
    const s = [
      row({ unitNumber: 'a', status: 'declined' }),
      row({ unitNumber: 'b', status: 'new' }),
      row({ unitNumber: 'c', status: 'toured' }),
    ];
    expect(titles(sortUnits(s, { key: 'status', dir: 'asc' }))).toEqual(['b', 'c', 'a']);
  });

  it('sorts by listing age, units without listings last', () => {
    const s = [
      row({ unitNumber: 'a' }, riverlight, 20),
      row({ unitNumber: 'b' }),
      row({ unitNumber: 'c' }, riverlight, 3),
    ];
    expect(titles(sortUnits(s, { key: 'listingAge', dir: 'asc' }))).toEqual(['c', 'a', 'b']);
  });

  it('breaks ties by building, then unit number in natural order', () => {
    const s = [
      row({ unitNumber: '1504', rent: 1500 }, larkin),
      row({ unitNumber: '908', rent: 1500 }),
      row({ unitNumber: '1504', rent: 1500 }),
    ];
    const sorted = sortUnits(s, { key: 'rent', dir: 'asc' });
    expect(sorted.map((r) => `${r.building?.name} ${r.unit.unitNumber}`)).toEqual([
      'Riverlight 908',
      'Riverlight 1504',
      'The Larkin 1504',
    ]);
  });

  it('falls back to rent for an unknown sort key', () => {
    expect(titles(sortUnits(rows, { key: 'nonsense', dir: 'asc' }))).toEqual([
      '310',
      '1504',
      '2203',
      '908',
    ]);
  });

  it('has a value for every key', () => {
    const r = row({ unitNumber: '1', rent: 1 });
    for (const key of UNIT_SORT_KEYS) expect(() => unitSortValue(r, key)).not.toThrow();
  });
});

describe('sortBuildings', () => {
  const rows = [
    { building: larkin, minRent: null, unitCount: 1 },
    { building: riverlight, minRent: 1650, unitCount: 3 },
  ];

  it('sorts by lowest rent with unknown last, and by name', () => {
    expect(
      sortBuildings(rows, { key: 'minRent', dir: 'desc' }).map((r) => r.building.name),
    ).toEqual(['Riverlight', 'The Larkin']);
    expect(sortBuildings(rows, { key: 'name', dir: 'desc' }).map((r) => r.building.name)).toEqual([
      'The Larkin',
      'Riverlight',
    ]);
  });
});
