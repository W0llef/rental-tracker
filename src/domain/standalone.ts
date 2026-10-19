import type { Building, Unit } from '../model';

/**
 * Standalone homes (Q30, M8 review). Every unit belongs to a building (spec §3), so a house
 * is a one-unit building: that's where its address, map pin and pet policy live. A
 * *standalone* home shows as just the home: its building's facts sit in the unit's own
 * form, its building isn't offered as a building to put other units in, and it has no
 * separate building to open. Pure.
 *
 * `building.standalone` stores the owner's choice; null follows the default here.
 */

type UnitLike = Pick<Unit, 'type'>;
type BuildingLike = Pick<Building, 'complexName' | 'buildingType'> & {
  standalone?: boolean | null;
};

/**
 * What a building is without a choice: a house, or a townhome on its own, stands alone;
 * apartments, condos and rooms are part of a building; a building with a complex name, or
 * with several of your units, is shared.
 */
export function standaloneDefault(b: BuildingLike, units: readonly UnitLike[]): boolean {
  if (units.length > 1 || b.complexName) return false;
  const type = units[0]?.type ?? null;
  if (type === 'house' || type === 'townhome') return true;
  if (type === null) return b.buildingType === 'house';
  return false;
}

/** Whether a building shows as a standalone home. Several units always make it shared. */
export function isStandalone(b: BuildingLike, units: readonly UnitLike[]): boolean {
  if (units.length > 1) return false;
  return b.standalone ?? standaloneDefault(b, units);
}

/** The building fields a standalone home's unit form shows (and counts toward completeness). */
export const HOME_FIELDS: ReadonlySet<string> = new Set([
  'building.managementCompany',
  'building.website',
  'building.yearBuilt',
  'building.floors',
  'building.pets.cats',
  'building.pets.dogs',
  'building.pets.monthlyRent',
  'building.smoking',
]);
