import { AMENITY_KEYS, UTILITY_KEYS } from '../model';
import type { Building, Settings, Unit } from '../model';
import { UTILITY_LABELS } from './format';

/**
 * What's known and what's left to research (PLAN.md §5.7 "Essentials first", DESIGN.md §4.3).
 * Pure.
 *
 * A *check* is one thing a person can find out about a unit or its building: "Rent",
 * "Laundry", "Parking", "Pets allowed". Checks drive four things from one list:
 *  - the completeness meter and the section dots (● complete, ◐ partly, ○ empty) in the forms;
 *  - the essentials: the checks named in `Settings.essentialFields` (Settings → Essential
 *    fields), which decide "ready to compare";
 *  - the missing-essentials prompts in the detail panel, each opening the form at its field;
 *  - nothing else: "next empty field" in the form follows the fields on screen.
 *
 * A check's key is the field path it reads ('unit.rent', 'unit.utilities.heat'), or a short
 * name for a group of fields ('unit.parking', 'building.pets'). Keys are what Settings
 * stores, so they never change once released. Free-text notes and optional extras (rent by
 * lease length, move-in specials, contact details) aren't checks: they're depth, not gaps.
 */

export type Owner = 'unit' | 'building';

export const UNIT_SECTIONS = [
  { id: 'identity', label: 'Identity' },
  { id: 'specs', label: 'Specs' },
  { id: 'windows', label: 'Windows' },
  { id: 'features', label: 'Features' },
  { id: 'lease', label: 'Lease' },
  { id: 'costs', label: 'Costs' },
  { id: 'parking', label: 'Parking and storage' },
  { id: 'review', label: 'Review' },
  { id: 'listings', label: 'Listings' },
  { id: 'links', label: 'Links' },
  { id: 'sources', label: 'Sources' },
  { id: 'photos', label: 'Photos' },
] as const;
export type UnitSection = (typeof UNIT_SECTIONS)[number]['id'];

export const BUILDING_SECTIONS = [
  { id: 'identity', label: 'Identity' },
  { id: 'structure', label: 'Structure' },
  { id: 'amenities', label: 'Amenities' },
  { id: 'policies', label: 'Policies' },
  { id: 'neighborhood', label: 'Neighborhood' },
  { id: 'notes', label: 'Notes' },
  { id: 'links', label: 'Links' },
  { id: 'photos', label: 'Photos' },
] as const;
export type BuildingSection = (typeof BUILDING_SECTIONS)[number]['id'];

/** What a check reads: the unit (when there is one) and its building. */
export interface Target {
  unit?: Unit;
  building?: Building;
}

export interface Check {
  key: string;
  label: string;
  owner: Owner;
  section: UnitSection | BuildingSection;
  /** The form field to jump to (its `data-field`). */
  field: string;
  filled: (t: Required<Target>) => boolean;
  /** Whether it applies at all (a floor plan has no floor; street parking has no space price). */
  applies?: (t: Required<Target>) => boolean;
}

const known = (v: unknown) => v !== null && v !== undefined;

const notPlanOnly = ({ unit }: Required<Target>) => !unit.isFloorPlanOnly;

function unitCheck(
  path: string,
  label: string,
  section: UnitSection,
  applies?: Check['applies'],
): Check {
  const keys = path.split('.');
  return {
    key: `unit.${path}`,
    label,
    owner: 'unit',
    section,
    field: `unit.${path}`,
    filled: ({ unit }) => known(keys.reduce<unknown>((v, k) => (v as never)?.[k], unit)),
    ...(applies ? { applies } : {}),
  };
}

function buildingCheck(
  path: string,
  label: string,
  section: BuildingSection,
  applies?: Check['applies'],
): Check {
  const keys = path.split('.');
  return {
    key: `building.${path}`,
    label,
    owner: 'building',
    section,
    field: `building.${path}`,
    filled: ({ building }) => known(keys.reduce<unknown>((v, k) => (v as never)?.[k], building)),
    ...(applies ? { applies } : {}),
  };
}

const AMENITY_CHECK_LABELS: Record<(typeof AMENITY_KEYS)[number], string> = {
  fitness: 'Fitness',
  pool: 'Pool',
  studyRooms: 'Study rooms',
  outdoorDeck: 'Outdoor deck',
  packageRoom: 'Package room',
  bikeStorage: 'Bike storage',
  evCharging: 'EV charging',
  guestSuites: 'Guest suites',
  petArea: 'Pet area',
  frontDesk: 'Front desk',
  skywayConnected: 'Skyway connected',
};

const paidParking = (u: Unit) => u.parking.type === 'garage' || u.parking.type === 'surface';

/** Every check, in form order: unit sections first, then the building's. */
export const CHECKS: readonly Check[] = [
  unitCheck('type', 'Unit type', 'specs'),
  unitCheck('bedrooms', 'Bedrooms', 'specs'),
  unitCheck('bathrooms', 'Bathrooms', 'specs'),
  unitCheck('squareFeet', 'Square feet', 'specs'),
  unitCheck('floor', 'Floor', 'specs', notPlanOnly),
  unitCheck('exposure', 'Exposure', 'specs', notPlanOnly),
  unitCheck('windows', 'Windows', 'windows', notPlanOnly),
  unitCheck('laundry', 'Laundry', 'features'),
  unitCheck('dishwasher', 'Dishwasher', 'features'),
  unitCheck('acType', 'Air conditioning', 'features'),
  unitCheck('heatingType', 'Heating', 'features'),
  unitCheck('balcony', 'Balcony', 'features'),
  unitCheck('fireplace', 'Fireplace', 'features'),
  unitCheck('flooring', 'Flooring', 'features'),
  unitCheck('furnished', 'Furnished', 'features'),
  unitCheck('rent', 'Rent', 'lease'),
  unitCheck('availableDate', 'Available date', 'lease'),
  unitCheck('leaseTermsMonths', 'Lease terms', 'lease'),
  unitCheck('deposit', 'Deposit', 'lease'),
  unitCheck('applicationFee', 'Application fee', 'lease'),
  unitCheck('adminFee', 'Admin fee', 'lease'),
  ...UTILITY_KEYS.map((k) => unitCheck(`utilities.${k}`, UTILITY_LABELS[k], 'costs')),
  unitCheck('recurringFees', 'Monthly fees', 'costs'),
  {
    key: 'unit.parking',
    label: 'Parking',
    owner: 'unit',
    section: 'parking',
    field: 'unit.parking.type',
    // Garage or lot parking also needs to know how many spaces come with the unit.
    filled: ({ unit }) =>
      known(unit.parking.type) && (!paidParking(unit) || known(unit.parking.spacesIncluded)),
  },
  unitCheck('parking.extraSpaceCost', 'Extra parking space', 'parking', ({ unit }) =>
    paidParking(unit),
  ),
  unitCheck('storage.included', 'Storage', 'parking'),
  unitCheck(
    'storage.cost',
    'Storage cost',
    'parking',
    ({ unit }) => unit.storage.included === false,
  ),

  buildingCheck('website', 'Website', 'identity'),
  buildingCheck('managementCompany', 'Management company', 'identity'),
  buildingCheck('buildingType', 'Building type', 'structure'),
  buildingCheck('yearBuilt', 'Year built', 'structure'),
  buildingCheck('floors', 'Floors', 'structure'),
  buildingCheck('totalUnits', 'Total units', 'structure'),
  buildingCheck('elevator', 'Elevator', 'structure'),
  ...AMENITY_KEYS.map((k) => buildingCheck(`amenities.${k}`, AMENITY_CHECK_LABELS[k], 'amenities')),
  {
    key: 'building.pets',
    label: 'Pets allowed',
    owner: 'building',
    section: 'policies',
    field: 'building.pets.cats',
    filled: ({ building }) => known(building.pets.cats) && known(building.pets.dogs),
  },
  buildingCheck(
    'pets.monthlyRent',
    'Pet rent',
    'policies',
    ({ building }) => building.pets.cats === true || building.pets.dogs === true,
  ),
  buildingCheck('smoking', 'Smoking', 'policies'),
  buildingCheck('subletPolicy', 'Subletting', 'policies'),
  buildingCheck('neighborhood', 'Neighborhood', 'neighborhood'),
];

export const CHECK_BY_KEY = new Map(CHECKS.map((c) => [c.key, c]));

export interface CheckState {
  check: Check;
  filled: boolean;
}

/** The checks that apply, with whether each is filled. Building checks need the building. */
export function checkStates(t: Target, owner?: Owner): CheckState[] {
  const out: CheckState[] = [];
  for (const check of CHECKS) {
    if (owner && check.owner !== owner) continue;
    if (check.owner === 'unit' && !t.unit) continue;
    if (check.owner === 'building' && !t.building) continue;
    // A unit check can read the building and the reverse, so give both (or stand-ins).
    const full = t as Required<Target>;
    if (check.applies && !check.applies(full)) continue;
    out.push({ check, filled: check.filled(full) });
  }
  return out;
}

export type SectionStatus = 'complete' | 'partly' | 'empty';

export interface Completeness {
  /** Filled checks out of those that apply. */
  filled: number;
  total: number;
  /** 0–100, rounded down so 100 means truly complete. */
  percent: number;
  /** Per section with at least one check. */
  sections: Map<string, { filled: number; total: number; status: SectionStatus }>;
  missing: Check[];
}

export function summarize(states: readonly CheckState[]): Completeness {
  const sections = new Map<string, { filled: number; total: number; status: SectionStatus }>();
  for (const s of states) {
    const sec = sections.get(s.check.section) ?? { filled: 0, total: 0, status: 'empty' };
    sec.total++;
    if (s.filled) sec.filled++;
    sections.set(s.check.section, sec);
  }
  for (const sec of sections.values()) {
    sec.status = sec.filled === sec.total ? 'complete' : sec.filled === 0 ? 'empty' : 'partly';
  }
  const filled = states.filter((s) => s.filled).length;
  const total = states.length;
  return {
    filled,
    total,
    percent: total ? Math.floor((filled / total) * 100) : 100,
    sections,
    missing: states.filter((s) => !s.filled).map((s) => s.check),
  };
}

/** The unit's own completeness (its form's meter), or the building's (its form's). */
export function completeness(t: Target, owner: Owner): Completeness {
  return summarize(checkStates(t, owner));
}

/** Essentials that are known checks, in form order; stored keys nothing knows are ignored. */
export function essentialChecks(essentialFields: Settings['essentialFields']): Check[] {
  const chosen = new Set(essentialFields);
  return CHECKS.filter((c) => chosen.has(c.key));
}

export interface Essentials {
  filled: number;
  total: number;
  missing: Check[];
  /** Every essential that applies is known: "ready to compare". */
  ready: boolean;
}

/** How a unit stands on the essentials (unit and building checks alike). */
export function essentials(
  t: Required<Target>,
  essentialFields: Settings['essentialFields'],
): Essentials {
  const states = essentialChecks(essentialFields)
    .filter((c) => !c.applies || c.applies(t))
    .map((check) => ({ check, filled: check.filled(t) }));
  const missing = states.filter((s) => !s.filled).map((s) => s.check);
  return {
    filled: states.length - missing.length,
    total: states.length,
    missing,
    ready: missing.length === 0,
  };
}

/** Where a check's field is edited: the unit's form, or its building's. */
export function checkHref(check: Check, t: { unitId: string; buildingId: string }): string {
  const field = encodeURIComponent(check.field);
  return check.owner === 'unit'
    ? `/unit/${t.unitId}/edit?field=${field}`
    : `/building/${t.buildingId}/edit?field=${field}&unit=${t.unitId}`;
}
