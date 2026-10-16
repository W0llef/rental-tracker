import { action } from '../commands/action';
import type { RentalDB } from '../db/db';
import { localDate } from '../domain/format';
import { unitKeyOf } from '../domain/unitKey';
import { building, listing, noteEntry, unit } from '../model';
import type {
  Building,
  BuildingType,
  Direction,
  ISODate,
  Listing,
  NoteEntry,
  SiteKey,
  Unit,
  UnitStatus,
  UnitType,
} from '../model';
import { makeAddress, newBuilding, newListing, newNote, newUnit } from '../model/factories';

/**
 * Made-up sample data for preview and development builds only (never offered on the live
 * app). Building names, unit details and prices are fictional; streets and coordinates are
 * real places in Minneapolis–St. Paul so the map in M3 has something sensible to show.
 * Deterministic: the same call always produces the same records (apart from ids).
 */

interface BuildingSeed {
  name: string | null;
  line1: string;
  city: string;
  zip: string;
  lat: number;
  lng: number;
  type: BuildingType;
  floors: number;
  year: number;
  neighborhood: string;
  skyway?: boolean;
}

const BUILDINGS: BuildingSeed[] = [
  {
    name: 'Riverlight',
    line1: '200 Portland Ave S',
    city: 'Minneapolis',
    zip: '55401',
    lat: 44.9798,
    lng: -93.2585,
    type: 'high-rise',
    floors: 24,
    year: 2019,
    neighborhood: 'Downtown East',
  },
  {
    name: 'The Larkin',
    line1: '1010 Nicollet Mall',
    city: 'Minneapolis',
    zip: '55403',
    lat: 44.9737,
    lng: -93.2762,
    type: 'high-rise',
    floors: 31,
    year: 2016,
    neighborhood: 'Downtown West',
    skyway: true,
  },
  {
    name: 'Cedar Row',
    line1: '2400 Cedar Ave S',
    city: 'Minneapolis',
    zip: '55404',
    lat: 44.9586,
    lng: -93.2474,
    type: 'walk-up',
    floors: 3,
    year: 1924,
    neighborhood: 'Seward',
  },
  {
    name: 'Lyndale Commons',
    line1: '3001 Lyndale Ave S',
    city: 'Minneapolis',
    zip: '55408',
    lat: 44.9485,
    lng: -93.2882,
    type: 'mid-rise',
    floors: 6,
    year: 2014,
    neighborhood: 'Lyndale',
  },
  {
    name: 'Hennepin Lofts',
    line1: '1500 Hennepin Ave',
    city: 'Minneapolis',
    zip: '55403',
    lat: 44.9712,
    lng: -93.2818,
    type: 'mid-rise',
    floors: 7,
    year: 1912,
    neighborhood: 'Loring Park',
  },
  {
    name: 'Northloop Yards',
    line1: '700 Washington Ave N',
    city: 'Minneapolis',
    zip: '55401',
    lat: 44.9871,
    lng: -93.2775,
    type: 'mid-rise',
    floors: 8,
    year: 2021,
    neighborhood: 'North Loop',
  },
  {
    name: 'Grand Terrace',
    line1: '1100 Grand Ave',
    city: 'St. Paul',
    zip: '55105',
    lat: 44.9399,
    lng: -93.1515,
    type: 'walk-up',
    floors: 3,
    year: 1931,
    neighborhood: 'Macalester-Groveland',
  },
  {
    name: 'Lowertown Flats',
    line1: '250 E 6th St',
    city: 'St. Paul',
    zip: '55101',
    lat: 44.9512,
    lng: -93.0861,
    type: 'mid-rise',
    floors: 6,
    year: 1908,
    neighborhood: 'Lowertown',
    skyway: true,
  },
  {
    name: null,
    line1: '3624 15th Ave S',
    city: 'Minneapolis',
    zip: '55407',
    lat: 44.9375,
    lng: -93.2516,
    type: 'house',
    floors: 2,
    year: 1915,
    neighborhood: 'Powderhorn',
  },
  {
    name: 'Como Park Townhomes',
    line1: '1400 Como Ave',
    city: 'St. Paul',
    zip: '55108',
    lat: 44.9784,
    lng: -93.1588,
    type: 'townhome-row',
    floors: 2,
    year: 1998,
    neighborhood: 'Como',
  },
];

/** Small seeded random number generator (mulberry32). */
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES: UnitStatus[] = [
  'new',
  'new',
  'reviewing',
  'shortlisted',
  'tour-scheduled',
  'toured',
  'declined',
  'off-market',
];
const DIRS: Direction[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const SITES: SiteKey[] = ['zillow', 'apartments-com', 'hotpads', 'building-site', 'craigslist'];

export interface SampleData {
  buildings: Building[];
  units: Unit[];
  listings: Listing[];
  notes: NoteEntry[];
}

/** Builds the sample records relative to `today` (YYYY-MM-DD). */
export function makeSampleData(today: ISODate, at: string = new Date().toISOString()): SampleData {
  const rand = rng(1504);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;
  const day = (offset: number): ISODate => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const buildings: Building[] = [];
  const units: Unit[] = [];
  const listings: Listing[] = [];
  const notes: NoteEntry[] = [];

  BUILDINGS.forEach((seed, bi) => {
    const b = newBuilding(
      {
        name: seed.name,
        address: makeAddress(seed.line1, seed.city, 'MN', seed.zip),
        location: { lat: seed.lat, lng: seed.lng, source: 'import', precision: 'address' },
        buildingType: seed.type,
        floors: seed.floors,
        yearBuilt: seed.year,
        elevator: seed.floors > 3,
        neighborhood: { name: seed.neighborhood, source: 'manual' },
        managementCompany: bi % 3 === 0 ? 'Sample Property Co.' : null,
      },
      at,
    );
    b.amenities.fitness = seed.floors > 5 ? true : null;
    b.amenities.skywayConnected = seed.skyway ?? (seed.floors > 3 ? false : null);
    b.amenities.packageRoom = seed.floors > 3 ? true : null;
    b.pets = {
      ...b.pets,
      cats: true,
      dogs: bi % 2 === 0 ? true : null,
      monthlyRent: bi % 2 === 0 ? 35 : null,
    };
    buildings.push(building.parse(b));

    const unitCount =
      seed.type === 'house' ? 1 : seed.type === 'townhome-row' ? 2 : 2 + (bi % 3) + 1;
    for (let i = 0; i < unitCount; i++) {
      const floorPlanOnly = seed.type === 'high-rise' && i === unitCount - 1;
      const floor = seed.type === 'house' ? 1 : 1 + Math.floor(rand() * seed.floors);
      const bedrooms = Math.floor(rand() * 3);
      const sqft = 450 + bedrooms * 280 + Math.round(rand() * 150);
      const type: UnitType =
        seed.type === 'house' ? 'house' : seed.type === 'townhome-row' ? 'townhome' : 'apartment';
      const rent = Math.round((1050 + bedrooms * 520 + rand() * 600) / 5) * 5;
      const unitNumber = floorPlanOnly
        ? null
        : seed.type === 'house'
          ? null
          : `${floor}${String(i + 1).padStart(2, '0')}`;
      const status = floorPlanOnly ? 'new' : pick(STATUSES);
      const u = newUnit(
        {
          buildingId: b.id,
          unitNumber,
          unitKey: unitKeyOf(unitNumber),
          isFloorPlanOnly: floorPlanOnly,
          floorPlanName: floorPlanOnly ? `Plan ${String.fromCharCode(65 + bedrooms)}` : null,
          type,
          bedrooms,
          bathrooms: bedrooms >= 2 && rand() > 0.4 ? 2 : 1,
          squareFeet: rand() > 0.15 ? sqft : null, // some sizes still unknown
          floor: floorPlanOnly ? null : floor,
          exposure: floorPlanOnly || rand() < 0.3 ? null : [pick(DIRS)],
          laundry: rand() > 0.3 ? 'in-unit' : rand() > 0.5 ? 'in-building' : null,
          dishwasher: rand() > 0.2 ? true : null,
          balcony: rand() > 0.5,
          rent,
          rentIsFrom: floorPlanOnly,
          availableDate: day(14 + Math.floor(rand() * 90)),
          leaseTermsMonths: rand() > 0.4 ? [12, 15] : null,
          deposit: rand() > 0.3 ? rent : null,
          applicationFee: rand() > 0.3 ? 50 : null,
          utilities: {
            heat: rand() > 0.5 ? { mode: 'included' } : { mode: 'tenant-paid', estimate: null },
            electric: { mode: 'tenant-paid', estimate: null },
            waterSewer: rand() > 0.5 ? { mode: 'extra', amount: 55 } : null,
            trash: { mode: 'included' },
            gas: null,
            internet: rand() > 0.7 ? { mode: 'extra', amount: 65 } : null,
          },
          parking: {
            spacesIncluded: seed.type === 'house' ? 1 : 0,
            extraSpaceCost:
              seed.type === 'high-rise' || seed.type === 'mid-rise'
                ? 150 + Math.round(rand() * 6) * 10
                : null,
            type: seed.type === 'house' ? 'surface' : seed.type === 'walk-up' ? 'street' : 'garage',
          },
          status,
          rating: status === 'declined' ? 1 : (Math.floor(rand() * 6) as Unit['rating']),
          flag: status === 'declined' ? 'reject' : status === 'shortlisted' ? 'pick' : 'none',
          rejectReasonIds: status === 'declined' ? ['too-expensive'] : [],
          colorLabel: rand() > 0.8 ? 'blue' : null,
          addedVia: 'form',
        },
        at,
      );
      units.push(unit.parse(u));

      const firstSeen = day(-Math.floor(rand() * 40) - 1);
      const raise = rand() > 0.6 ? 50 : 0;
      listings.push(
        listing.parse(
          newListing(
            {
              unitId: u.id,
              site: pick(SITES),
              url: null,
              firstSeen,
              lastSeen: day(-1),
              observations: [
                { date: firstSeen, rent: rent - raise, note: null },
                ...(raise ? [{ date: day(-2), rent, note: 'Price went up' }] : []),
              ],
            },
            at,
          ),
        ),
      );

      if (status === 'toured') {
        notes.push(
          noteEntry.parse(
            newNote(
              {
                unitId: u.id,
                kind: 'tour',
                text: 'Toured. Good light in the afternoon; hallway smelled of paint.',
              },
              at,
            ),
          ),
        );
      }
    }
  });

  return { buildings, units, listings, notes };
}

/** Adds the sample data as one undoable action. */
export async function loadSampleData(db: RentalDB, today = localDate()) {
  const data = makeSampleData(today);
  await action(db, 'Load sample data', async () => {
    await db.buildings.bulkAdd(data.buildings);
    await db.units.bulkAdd(data.units);
    await db.listings.bulkAdd(data.listings);
    await db.notes.bulkAdd(data.notes);
  });
  return data;
}

/** Permanently removes every record in the data tables, as one undoable action. */
export async function removeAllData(db: RentalDB) {
  await action(db, 'Remove all data', async () => {
    await Promise.all([
      db.buildings.clear(),
      db.units.clear(),
      db.listings.clear(),
      db.notes.clear(),
      db.destinations.clear(),
      db.collections.clear(),
      db.photos.clear(),
      db.imports.clear(),
      db.settings.clear(),
    ]);
  });
}
