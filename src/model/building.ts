import { z } from 'zod';
import {
  address,
  base,
  count,
  geoPoint,
  isoDate,
  isoDateTime,
  link,
  maybe,
  measure,
  tri,
  usd,
} from './common';

/** Building record (PLAN.md §3.2). */

export const BUILDING_TYPES = [
  'high-rise',
  'mid-rise',
  'walk-up',
  'house',
  'townhome-row',
] as const;
export const buildingType = z.enum(BUILDING_TYPES);
export type BuildingType = z.infer<typeof buildingType>;

export const AMENITY_KEYS = [
  'fitness',
  'pool',
  'studyRooms',
  'outdoorDeck',
  'packageRoom',
  'bikeStorage',
  'evCharging',
  'guestSuites',
  'petArea',
  'frontDesk',
  'skywayConnected',
] as const;
export const amenityKey = z.enum(AMENITY_KEYS);
export type AmenityKey = z.infer<typeof amenityKey>;

export const petPolicy = z.object({
  cats: tri,
  dogs: tri,
  limits: maybe(z.string()), // 'max 2 pets, dogs under 50 lb'
  deposit: maybe(usd),
  oneTimeFee: maybe(usd),
  monthlyRent: maybe(usd), // feeds total monthly cost if the household has pets
});
export type PetPolicy = z.infer<typeof petPolicy>;

export const building = base.extend({
  // Identity
  name: maybe(z.string()),
  complexName: maybe(z.string()), // several buildings may share one
  address,
  location: maybe(geoPoint), // null → "Needs location", listed but not mapped
  website: maybe(z.string()),
  managementCompany: maybe(z.string()),
  phone: maybe(z.string()),
  email: maybe(z.string()),
  // Structure
  yearBuilt: maybe(z.number().int()),
  yearRenovated: maybe(z.number().int()),
  floors: maybe(count),
  totalUnits: maybe(count),
  buildingType: maybe(buildingType),
  elevator: tri,
  // Amenities
  amenities: z.record(amenityKey, tri),
  amenitiesNotes: maybe(z.string()),
  // Policies
  pets: petPolicy,
  smoking: maybe(z.enum(['allowed', 'not-allowed', 'designated-areas'])),
  guestParking: maybe(z.string()),
  subletPolicy: maybe(z.enum(['allowed', 'with-approval', 'not-allowed'])),
  policyNotes: maybe(z.string()),
  // Neighborhood
  neighborhood: maybe(
    z.object({ name: z.string(), source: z.enum(['geocoder', 'city-boundaries', 'manual']) }),
  ),
  crime: maybe(
    z.object({ incidents12mo: count, radiusFt: measure, asOf: isoDate, source: z.string() }),
  ), // Phase 2+
  // Media (photos live in the photos table, ownerType 'building')
  links: z.array(link),
  notes: maybe(z.string()),
  // Monitoring (spec §8, tier A — UI in Phase 3)
  availabilityUrl: maybe(z.string()),
  lastCheckedAt: maybe(isoDateTime),
  // Map extras (Phase 2 buildings layer / Phase 4 3D)
  osmId: maybe(z.string()),
  floorHeightFt: maybe(measure), // default 10 ft when null
});
export type Building = z.infer<typeof building>;
