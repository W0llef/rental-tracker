import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  cleanText,
  parseDate,
  parseListingText,
  readUtilities,
} from '../../src/domain/listingText';

const TODAY = '2026-10-16';
const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../fixtures/listing-text', name), 'utf8');

/** The facts as { field: value }, for compact expectations. */
const facts = (text: string, today = TODAY) =>
  Object.fromEntries(parseListingText(text, today).facts.map((f) => [f.field, f.value]));

describe('listing text fixtures', () => {
  it('Zillow unit page', () => {
    const r = parseListingText(fixture('zillow-unit.txt'), TODAY);
    expect(r.address).toEqual({
      line1: '1234 Example Ave S',
      unit: '1504',
      city: 'Minneapolis',
      state: 'MN',
      zip: '55401',
    });
    expect(facts(fixture('zillow-unit.txt'))).toEqual({
      'unit.rent': 1650,
      'unit.bedrooms': 1,
      'unit.bathrooms': 1,
      'unit.squareFeet': 720,
      'unit.unitNumber': '1504',
      'unit.floor': 15,
      'unit.availableDate': '2027-06-01',
      'unit.leaseTermsMonths': [12, 15],
      'unit.deposit': 300,
      'unit.applicationFee': 50,
      'unit.laundry': 'in-unit',
      'unit.dishwasher': true,
      'unit.balcony': true,
      'unit.acType': 'central',
      'unit.heatingType': 'forced-air',
      'unit.type': 'apartment',
      'unit.parking.type': 'garage',
      'unit.parking.extraSpaceCost': 150,
      'unit.utilities.heat': { mode: 'included' },
      'unit.utilities.waterSewer': { mode: 'included' },
      'unit.utilities.electric': { mode: 'tenant-paid', estimate: null },
      'unit.utilities.internet': { mode: 'tenant-paid', estimate: null },
      'building.pets.cats': true,
      'building.pets.dogs': true,
      'building.pets.monthlyRent': 35,
      'building.amenities.fitness': true,
      'building.amenities.outdoorDeck': true,
      'building.amenities.packageRoom': true,
      'building.amenities.skywayConnected': true,
      'building.yearBuilt': 2016,
    });
    // "Similar homes" further down don't leak in.
    expect(r.facts.find((f) => f.field === 'unit.rent')?.also).toEqual([
      { field: 'unit.rentIsFrom', value: false },
    ]);
    expect(r.notes).toEqual([]);
  });

  it('Apartments.com property page: several units, so only "from" rent and building facts', () => {
    const r = parseListingText(fixture('apartments-com-property.txt'), TODAY);
    const f = facts(fixture('apartments-com-property.txt'));
    expect(f['unit.rent']).toBe(1450);
    expect(r.facts.find((x) => x.field === 'unit.rent')?.label).toBe('from $1,450/mo');
    for (const field of [
      'unit.bedrooms',
      'unit.bathrooms',
      'unit.squareFeet',
      'unit.floorPlanName',
      'unit.availableDate',
      'unit.unitNumber',
    ])
      expect(f[field], field).toBeUndefined();
    expect(r.notes[0]).toMatch(/several units/);
    expect(f).toMatchObject({
      'unit.leaseTermsMonths': [6, 12],
      'unit.applicationFee': 45,
      'unit.adminFee': 250,
      'unit.recurringFees': [
        { label: 'Amenity fee', amount: 50 },
        { label: 'Technology fee', amount: 35 },
      ],
      'unit.parking.type': 'garage',
      'unit.parking.extraSpaceCost': 175,
      'unit.utilities.waterSewer': { mode: 'included' },
      'unit.utilities.trash': { mode: 'included' },
      'building.pets.monthlyRent': 40,
      'building.pets.oneTimeFee': 300,
      'building.yearBuilt': 2019,
      'building.floors': 12,
      'building.elevator': true,
      'building.amenities.pool': true,
      'building.amenities.evCharging': true,
      'building.amenities.guestSuites': true,
      'building.amenities.frontDesk': true,
      'building.amenities.petArea': true,
      'building.amenities.studyRooms': true,
    });
  });

  it('RentCafe unit page', () => {
    expect(facts(fixture('rentcafe-unit.txt'))).toMatchObject({
      'unit.rent': 2385,
      'unit.bedrooms': 2,
      'unit.bathrooms': 2,
      'unit.squareFeet': 1040,
      'unit.unitNumber': '908',
      'unit.floorPlanName': 'The Aspen',
      'unit.availableDate': '2027-01-15',
      'unit.leaseTermsMonths': [12, 13, 14],
      'unit.deposit': 500,
      'unit.moveInSpecial': { text: 'Receive 6 weeks free on a 13-month lease!', valueUsd: null },
      'unit.laundry': 'in-unit',
      'unit.acType': 'mini-split',
      'unit.parking.type': 'garage',
      'unit.parking.extraSpaceCost': 195,
      'unit.storage.cost': 25,
      'unit.utilities.electric': { mode: 'tenant-paid', estimate: null },
      'unit.utilities.gas': { mode: 'tenant-paid', estimate: null },
      'unit.utilities.waterSewer': { mode: 'extra', amount: 65 },
      'unit.utilities.trash': { mode: 'extra', amount: 65 },
      'building.pets.cats': true,
      'building.pets.dogs': true,
      'building.pets.deposit': 400,
      'building.pets.monthlyRent': 50,
    });
  });

  it('Entrata unit page', () => {
    const r = parseListingText(fixture('entrata-unit.txt'), TODAY);
    expect(r.address?.city).toBe('St. Louis Park');
    expect(facts(fixture('entrata-unit.txt'))).toMatchObject({
      'unit.rent': 2560,
      'unit.bedrooms': 3,
      'unit.bathrooms': 2.5,
      'unit.squareFeet': 1320,
      'unit.unitNumber': '702',
      'unit.availableDate': '2027-03-01',
      'unit.fireplace': true,
      'unit.acType': 'central',
      'unit.utilities.heat': { mode: 'included' },
      'building.pets.cats': true,
      'building.pets.dogs': false,
      'building.smoking': 'not-allowed',
    });
    expect(r.facts.find((f) => f.field === 'unit.rent')?.also?.[0]?.value).toBe(true);
    // "9-15 months" is a range, not a list of terms
    expect(facts(fixture('entrata-unit.txt'))['unit.leaseTermsMonths']).toBeUndefined();
  });

  it('Craigslist post', () => {
    expect(facts(fixture('craigslist.txt'))).toEqual({
      'unit.rent': 1095,
      'unit.bedrooms': 1,
      'unit.bathrooms': 1,
      'unit.squareFeet': 650,
      'unit.availableDate': '2026-11-01',
      'unit.laundry': 'in-building',
      'unit.acType': 'window-unit',
      'unit.heatingType': 'radiator',
      'unit.parking.type': 'surface',
      'unit.parking.spacesIncluded': 1,
      'unit.utilities.heat': { mode: 'included' },
      'unit.utilities.waterSewer': { mode: 'included' },
      'unit.utilities.electric': { mode: 'tenant-paid', estimate: null },
      'building.pets.cats': true,
      'building.pets.dogs': false,
      'building.smoking': 'not-allowed',
    });
  });
});

describe('single patterns', () => {
  it.each([
    ['$1,650/mo', 1650],
    ['Rent: $1,650', 1650],
    ['$1,650 per month', 1650],
    ['Price $2,100', 2100],
    ['Starting at $1,450', 1450],
    ['$1,450+', 1450],
  ])('rent: %s', (text, rent) => {
    expect(facts(text)['unit.rent']).toBe(rent);
  });

  it('ignores money that is not the rent', () => {
    expect(
      facts('Deposit $500\nApplication fee $50\nPet rent $35/mo')['unit.rent'],
    ).toBeUndefined();
    expect(facts('Zestimate $1,800/mo')['unit.rent']).toBeUndefined();
    expect(facts('$95/mo')['unit.rent']).toBeUndefined(); // below $300
  });

  it.each([
    ['Studio', 0],
    ['Beds: Studio', 0],
    ['2 bd | 1 ba', 2],
    ['3 bedrooms', 3],
    ['Bedrooms: 2', 2],
    ['1BR', 1],
  ])('beds: %s', (text, beds) => {
    expect(facts(text)['unit.bedrooms']).toBe(beds);
  });

  it('a studio amenity is not a studio apartment', () => {
    expect(facts('Yoga studio and fitness center')['unit.bedrooms']).toBeUndefined();
    expect(facts('Studio, 1 & 2 bedroom apartments')['unit.bedrooms']).toBeUndefined();
  });

  it.each([
    ['1.5 baths', 1.5],
    ['1 1/2 ba'.replace('1 1/2', '1½'), 1.5],
    ['2 Bathrooms', 2],
  ])('baths: %s', (text, baths) => {
    expect(facts(text)['unit.bathrooms']).toBe(baths);
  });

  it.each([
    ['720 sq ft', 720],
    ['1,040 Sq.Ft.', 1040],
    ['650ft2', 650],
    ['Square feet: 980', 980],
    ['1100 square feet', 1100],
  ])('size: %s', (text, sq) => {
    expect(facts(text)['unit.squareFeet']).toBe(sq);
  });

  it.each([
    ['Available now', '2026-10-16'],
    ['Available: Immediately', '2026-10-16'],
    ['Available Jun 1', '2027-06-01'],
    ['Available June 1, 2027', '2027-06-01'],
    ['available 11/15', '2026-11-15'],
    ['Move-in date: 2026-12-01', '2026-12-01'],
    ['Available Oct 1', '2026-10-16'], // already past: available now
  ])('available: %s', (text, date) => {
    expect(facts(text)['unit.availableDate']).toBe(date);
  });

  it('parses dates with and without a year', () => {
    expect(parseDate('jun 1', '2026-10-16')).toBe('2027-06-01');
    expect(parseDate('oct 1', '2026-10-16')).toBe('2026-10-01'); // within a month back
    expect(parseDate('feb 30', '2026-10-16')).toBeNull();
    expect(parseDate('6/1/27', '2026-10-16')).toBe('2027-06-01');
  });

  it('features and their "no" forms', () => {
    expect(facts('Dishwasher')['unit.dishwasher']).toBe(true);
    expect(facts('No dishwasher')['unit.dishwasher']).toBe(false);
    expect(facts('No pool')['building.amenities.pool']).toBe(false);
    expect(facts('Pool table in the clubhouse')['building.amenities.pool']).toBeUndefined();
    expect(facts('Rooftop patio')['unit.balcony']).toBeUndefined();
    expect(facts('Unfurnished')['unit.furnished']).toBe('no');
    expect(facts('Fully furnished')['unit.furnished']).toBe('full');
    expect(facts('Furnished units available')['unit.furnished']).toBeUndefined();
    expect(facts('No pets')).toMatchObject({
      'building.pets.cats': false,
      'building.pets.dogs': false,
    });
    expect(facts('Pet friendly')).toMatchObject({
      'building.pets.cats': true,
      'building.pets.dogs': true,
    });
    expect(facts('Walk-up building')['building.elevator']).toBe(false);
    expect(facts('Heated garage parking')['unit.utilities.heat']).toBeUndefined();
  });

  it('unit numbers and floors', () => {
    expect(facts('Unit #1504')['unit.unitNumber']).toBe('1504');
    expect(facts('Apt 4B')['unit.unitNumber']).toBe('4B');
    expect(facts('Apartment 3 bedrooms')['unit.unitNumber']).toBeUndefined();
    expect(facts('Unit features')['unit.unitNumber']).toBeUndefined();
    expect(facts('On the 3rd floor')['unit.floor']).toBe(3);
    expect(facts('24 floors')['unit.floor']).toBeUndefined();
    expect(facts('24 floors')['building.floors']).toBe(24);
  });

  it('special offers keep their text and dollar value', () => {
    expect(facts('Special: $500 off your first month')['unit.moveInSpecial']).toEqual({
      text: '$500 off your first month',
      valueUsd: 500,
    });
  });

  it('turns the Unicode a page uses into plain text', () => {
    expect(cleanText('1 bd · 1½ ba\r\n$1,450 – $1,600')).toBe('1 bd | 1.5 ba\n$1,450 - $1,600');
  });
});

describe('utilities', () => {
  const read = (s: string) => Object.fromEntries(readUtilities(s.toLowerCase()));

  it('reads included and tenant-paid in one sentence', () => {
    expect(read('Heat and water included, electric not included.')).toEqual({
      heat: { mode: 'included' },
      waterSewer: { mode: 'included' },
      electric: { mode: 'tenant-paid', estimate: null },
    });
  });

  it('reads "Utility: who" lines and lists under a heading', () => {
    expect(read('Heat: Included\nElectric: Tenant\nGas: Landlord')).toEqual({
      heat: { mode: 'included' },
      electric: { mode: 'tenant-paid', estimate: null },
      gas: { mode: 'included' },
    });
    expect(read('Utilities included\nWater\nTrash removal\nParking')).toEqual({
      waterSewer: { mode: 'included' },
      trash: { mode: 'included' },
    });
  });

  it('all utilities included leaves internet out', () => {
    expect(Object.keys(read('All utilities included!'))).toEqual([
      'heat',
      'electric',
      'waterSewer',
      'trash',
      'gas',
    ]);
  });

  it('ignores appliances and features that only mention a utility', () => {
    expect(read('Gas range. Electric fireplace. Water heater. Heat pump.')).toEqual({});
  });
});
