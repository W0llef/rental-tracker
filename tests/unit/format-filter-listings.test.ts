import {
  buildingSearchText,
  matchesWords,
  normalizeText,
  queryWords,
  unitSearchText,
} from '../../src/domain/filter';
import {
  bedsLabel,
  buildingName,
  daysBetween,
  enumLabel,
  leaseTermsLabel,
  listingAgeLabel,
  money,
  rangeLabel,
  rentLabel,
  shortDate,
  unitTitle,
  utilityLabel,
} from '../../src/domain/format';
import { listingAgeDays, listingPrices, priceHistory } from '../../src/domain/listings';
import { makeAddress, newBuilding, newListing, newNote, newUnit } from '../../src/model/factories';

const b = newBuilding({
  name: 'Riverlight',
  address: makeAddress('200 Portland Ave S', 'Minneapolis', 'MN', '55401'),
  neighborhood: { name: 'Downtown East', source: 'manual' },
});

describe('format', () => {
  it('formats money, beds and dates', () => {
    expect(money(1650)).toBe('$1,650');
    expect(bedsLabel(0)).toBe('Studio');
    expect(bedsLabel(2)).toBe('2 bd');
    expect(shortDate('2026-06-01', '2026-10-15')).toBe('Jun 1');
    expect(shortDate('2027-06-01', '2026-10-15')).toBe('Jun 1, 2027');
    expect(daysBetween('2026-10-01', '2026-10-15')).toBe(14);
    expect(listingAgeLabel(0)).toBe('listed today');
    expect(listingAgeLabel(1)).toBe('listed 1 day');
    expect(listingAgeLabel(17)).toBe('listed 17 days');
  });

  it('names units and buildings', () => {
    expect(unitTitle({ unitNumber: '1504', isFloorPlanOnly: false, floorPlanName: null }, b)).toBe(
      'Unit 1504',
    );
    expect(unitTitle({ unitNumber: null, isFloorPlanOnly: true, floorPlanName: 'Plan C' }, b)).toBe(
      'Plan C',
    );
    expect(unitTitle({ unitNumber: null, isFloorPlanOnly: false, floorPlanName: null }, b)).toBe(
      'Riverlight',
    );
    expect(buildingName({ ...b, name: null })).toBe('200 Portland Ave S');
  });

  it('labels rent, lease terms, utilities and enum values', () => {
    expect(rentLabel({ rent: 2560, rentIsFrom: true })).toBe('from $2,560');
    expect(rentLabel({ rent: null, rentIsFrom: false })).toBeNull();
    expect(leaseTermsLabel([15, 12])).toBe('12 or 15 months');
    expect(leaseTermsLabel([6, 12, 15])).toBe('6, 12 or 15 months');
    expect(leaseTermsLabel(null)).toBeNull();
    expect(utilityLabel({ mode: 'extra', amount: 55 })).toBe('Billed extra, $55/mo');
    expect(utilityLabel({ mode: 'tenant-paid', estimate: null })).toBe('You pay');
    expect(utilityLabel(null)).toBeNull();
    expect(enumLabel('floor-to-ceiling')).toBe('Floor to ceiling');
    expect(rangeLabel(1650, 2560)).toBe('$1,650–$2,560');
    expect(rangeLabel(1650, 1650)).toBe('$1,650');
  });
});

describe('text search', () => {
  it('ignores case, accents and punctuation', () => {
    expect(normalizeText('  Café #1504, Nicollet-Mall ')).toBe('cafe 1504 nicollet mall');
    expect(queryWords('  ')).toEqual([]);
  });

  it('matches every word against building and unit text', () => {
    const u = newUnit({ buildingId: b.id, unitNumber: '1504' });
    const note = newNote({ unitId: u.id, text: 'Hallway smelled of paint' });
    const text = `${unitSearchText(u, [note])} ${buildingSearchText(b)}`;
    expect(matchesWords(text, queryWords('riverlight 1504'))).toBe(true);
    expect(matchesWords(text, queryWords('downtown east'))).toBe(true);
    expect(matchesWords(text, queryWords('PAINT'))).toBe(true);
    expect(matchesWords(text, queryWords('portland 55401'))).toBe(true);
    expect(matchesWords(text, queryWords('riverlight 908'))).toBe(false);
  });
});

describe('listings', () => {
  const u = newUnit({ buildingId: b.id });
  const zillow = newListing({
    unitId: u.id,
    site: 'zillow',
    firstSeen: '2026-09-28',
    observations: [
      { date: '2026-09-28', rent: 1695, note: null },
      { date: '2026-10-12', rent: 1650, note: null },
    ],
  });
  const apts = newListing({
    unitId: u.id,
    site: 'apartments-com',
    firstSeen: '2026-10-12',
    observations: [{ date: '2026-10-12', rent: 1650, note: null }],
  });

  it('measures age from the first listing seen', () => {
    expect(listingAgeDays([apts, zillow], '2026-10-15')).toBe(17);
    expect(listingAgeDays([], '2026-10-15')).toBeNull();
  });

  it('merges price history into change points', () => {
    expect(priceHistory([zillow, apts])).toEqual([
      { date: '2026-09-28', rent: 1695 },
      { date: '2026-10-12', rent: 1650 },
    ]);
  });

  it('gives the current and previous price of a listing', () => {
    expect(listingPrices(zillow)).toEqual({ current: 1650, previous: 1695 });
    expect(listingPrices(apts)).toEqual({ current: 1650, previous: null });
  });
});
