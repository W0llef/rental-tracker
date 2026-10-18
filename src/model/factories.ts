import type { Address, ID, ISODateTime } from './common';
import type { AmenityKey, Building } from './building';
import { AMENITY_KEYS } from './building';
import type { Opinion, OpinionFields, Person } from './people';
import { opinionId } from './people';
import type { Listing, NoteEntry } from './records';
import type { LabelColor, Unit, UtilityKey } from './unit';
import { LABEL_COLORS, UTILITY_KEYS } from './unit';

/**
 * Factories for new records: every researched field starts unknown (null), so a record
 * made here is always valid. Callers pass the few fields they know.
 */

export const newId = (): ID => crypto.randomUUID();
export const nowIso = (): ISODateTime => new Date().toISOString();

function baseFields(at: ISODateTime) {
  return { id: newId(), createdAt: at, updatedAt: at, deletedAt: null };
}

const allUnknown = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, null])) as Record<K, null>;

/** Display form and dedupe key for an address (domain/address.ts). */
export { makeAddress } from '../domain/address';

export type BuildingInput = Partial<
  Omit<Building, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>
> & {
  address: Address;
};

export function newBuilding(input: BuildingInput, at: ISODateTime = nowIso()): Building {
  return {
    ...baseFields(at),
    name: null,
    complexName: null,
    location: null,
    website: null,
    managementCompany: null,
    phone: null,
    email: null,
    yearBuilt: null,
    yearRenovated: null,
    floors: null,
    totalUnits: null,
    buildingType: null,
    elevator: null,
    amenities: allUnknown<AmenityKey>(AMENITY_KEYS),
    amenitiesNotes: null,
    pets: {
      cats: null,
      dogs: null,
      limits: null,
      deposit: null,
      oneTimeFee: null,
      monthlyRent: null,
    },
    smoking: null,
    guestParking: null,
    subletPolicy: null,
    policyNotes: null,
    neighborhood: null,
    crime: null,
    links: [],
    notes: null,
    availabilityUrl: null,
    lastCheckedAt: null,
    osmId: null,
    floorHeightFt: null,
    ...input,
  };
}

export type UnitInput = Partial<Omit<Unit, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>> & {
  buildingId: ID;
};

export function newUnit(input: UnitInput, at: ISODateTime = nowIso()): Unit {
  return {
    ...baseFields(at),
    unitNumber: null,
    unitKey: null,
    floorPlanName: null,
    isFloorPlanOnly: false,
    type: null,
    bedrooms: null,
    bathrooms: null,
    squareFeet: null,
    floor: null,
    exposure: null,
    windows: null,
    viewNotes: null,
    layoutNotes: null,
    laundry: null,
    dishwasher: null,
    acType: null,
    heatingType: null,
    balcony: null,
    fireplace: null,
    flooring: null,
    furnished: null,
    rent: null,
    rentIsFrom: false,
    rentByTerm: null,
    availableDate: null,
    leaseTermsMonths: null,
    plannedLeaseMonths: null,
    deposit: null,
    applicationFee: null,
    adminFee: null,
    recurringFees: null,
    moveInSpecial: null,
    utilities: allUnknown<UtilityKey>(UTILITY_KEYS),
    parking: { spacesIncluded: null, extraSpaceCost: null, type: null },
    storage: { included: null, cost: null },
    costOverrides: {},
    status: 'new',
    colorLabel: null,
    collectionIds: [],
    addedVia: 'form',
    placement3d: null,
    links: [],
    fieldSources: [],
    ...input,
  };
}

export type ListingInput = Partial<Omit<Listing, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>> &
  Pick<Listing, 'unitId' | 'firstSeen'>;

export function newListing(input: ListingInput, at: ISODateTime = nowIso()): Listing {
  return {
    ...baseFields(at),
    url: null,
    site: 'other',
    lastSeen: input.firstSeen,
    observations: [],
    offMarketAt: null,
    ...input,
  };
}

export type NoteInput = Partial<Omit<NoteEntry, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>> &
  Pick<NoteEntry, 'text'>;

export function newNote(input: NoteInput, at: ISODateTime = nowIso()): NoteEntry {
  return {
    ...baseFields(at),
    unitId: null,
    buildingId: null,
    kind: 'note',
    authorId: null,
    ...input,
  };
}

const defaultPrivateLabelNames = (): Record<LabelColor, string> =>
  Object.fromEntries(
    LABEL_COLORS.map((c) => [c, c.charAt(0).toUpperCase() + c.slice(1)]),
  ) as Record<LabelColor, string>;

export type PersonInput = Partial<Omit<Person, 'createdAt' | 'updatedAt' | 'deletedAt'>> &
  Pick<Person, 'name'>;

export function newPerson(input: PersonInput, at: ISODateTime = nowIso()): Person {
  return {
    ...baseFields(at),
    color: 'teal',
    labelNames: defaultPrivateLabelNames(),
    ...input,
  };
}

/** An opinion with nothing set yet: not rated, no flag, no notes, no label. */
export function emptyOpinionFields(): OpinionFields {
  return {
    rating: 0,
    ratingNote: null,
    flag: 'none',
    flagNote: null,
    rejectReasonIds: [],
    colorLabel: null,
    lastReviewedAt: null,
  };
}

export function newOpinion(
  unitId: ID,
  personId: ID,
  fields: Partial<OpinionFields> = {},
  at: ISODateTime = nowIso(),
): Opinion {
  return {
    ...baseFields(at),
    id: opinionId(unitId, personId),
    unitId,
    personId,
    ...emptyOpinionFields(),
    ...fields,
  };
}

/** Whether an opinion says anything (an empty one needn't be stored or shown). */
export function hasOpinion(o: OpinionFields): boolean {
  return (
    o.rating > 0 ||
    o.flag !== 'none' ||
    !!o.ratingNote ||
    !!o.flagNote ||
    o.rejectReasonIds.length > 0 ||
    o.colorLabel !== null
  );
}
