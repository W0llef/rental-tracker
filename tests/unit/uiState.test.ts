import { loadRemembered } from '../../src/state/ui';

const KEY = 'rental-tracker-preview.list';

describe('remembered list settings', () => {
  beforeEach(() => localStorage.clear());

  it('starts with units sorted by total cost, low to high', () => {
    expect(loadRemembered()).toEqual({
      view: 'units',
      unitSort: { key: 'total', dir: 'asc' },
      buildingSort: { key: 'minTotal', dir: 'asc' },
    });
  });

  it('keeps valid choices', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ view: 'buildings', unitSort: { key: 'squareFeet', dir: 'desc' } }),
    );
    expect(loadRemembered()).toMatchObject({
      view: 'buildings',
      unitSort: { key: 'squareFeet', dir: 'desc' },
    });
  });

  it('ignores unreadable or out-of-date values', () => {
    localStorage.setItem(KEY, '{not json');
    expect(loadRemembered().unitSort).toEqual({ key: 'total', dir: 'asc' });
    localStorage.setItem(KEY, JSON.stringify({ unitSort: { key: 'totalMonthly', dir: 'up' } }));
    expect(loadRemembered().unitSort).toEqual({ key: 'total', dir: 'asc' });
  });
});
