import type { Building, SortSpec, Unit, UnitStatus } from '../model';
import { UNIT_STATUSES } from '../model';
import { buildingName, unitTitle } from './format';

/**
 * Sorting with unknown values always last, whatever the direction (spec §3 "Unknown is a
 * value"; PLAN.md §3.5 SortSpec). Ties fall back to a stable, readable order.
 */

export type SortValue = string | number | null;
export type SortDir = 'asc' | 'desc';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/** Compares two values; null (unknown) sorts after every known value in both directions. */
export function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const raw =
    typeof a === 'string' || typeof b === 'string' ? collator.compare(String(a), String(b)) : a - b;
  return dir === 'asc' ? raw : -raw;
}

/** Returns a new array sorted by `valueOf(row)`, unknowns last, ties by `tiebreak(row)`. */
export function sortBy<T>(
  rows: readonly T[],
  valueOf: (row: T) => SortValue,
  dir: SortDir,
  tiebreak: (row: T) => string,
): T[] {
  return rows
    .map((row) => ({ row, v: valueOf(row), t: tiebreak(row) }))
    .sort((a, b) => compareValues(a.v, b.v, dir) || collator.compare(a.t, b.t))
    .map((x) => x.row);
}

// ── Units ──────────────────────────────────────────────────────────────────

export interface UnitSortInput {
  unit: Unit;
  /** Your rating: sorting by rating sorts by yours (PLAN.md §5.8). */
  mine: { rating: number };
  building: Building | undefined;
  /** Days since the unit was first seen listed; null when it has no listings. */
  listingAgeDays: number | null;
}

export const UNIT_SORT_KEYS = [
  'rent',
  'availableDate',
  'squareFeet',
  'bedrooms',
  'bathrooms',
  'floor',
  'rating',
  'listingAge',
  'createdAt',
  'status',
  'building',
] as const;
export type UnitSortKey = (typeof UNIT_SORT_KEYS)[number];

/** Label and the direction a sort starts in when picked. Total cost and $/ft² join in M9. */
export const UNIT_SORTS: Record<
  UnitSortKey,
  { label: string; dir: SortDir; asc: string; desc: string }
> = {
  rent: { label: 'Rent', dir: 'asc', asc: 'low to high', desc: 'high to low' },
  availableDate: {
    label: 'Available date',
    dir: 'asc',
    asc: 'soonest first',
    desc: 'latest first',
  },
  squareFeet: { label: 'Size', dir: 'desc', asc: 'smallest first', desc: 'largest first' },
  bedrooms: { label: 'Bedrooms', dir: 'desc', asc: 'fewest first', desc: 'most first' },
  bathrooms: { label: 'Bathrooms', dir: 'desc', asc: 'fewest first', desc: 'most first' },
  floor: { label: 'Floor', dir: 'desc', asc: 'lowest first', desc: 'highest first' },
  rating: { label: 'Rating', dir: 'desc', asc: 'lowest first', desc: 'highest first' },
  listingAge: { label: 'Listing age', dir: 'asc', asc: 'newest first', desc: 'oldest first' },
  createdAt: { label: 'Date added', dir: 'desc', asc: 'oldest first', desc: 'newest first' },
  status: { label: 'Status', dir: 'asc', asc: 'pipeline order', desc: 'reverse order' },
  building: { label: 'Building', dir: 'asc', asc: 'A to Z', desc: 'Z to A' },
};

export const DEFAULT_UNIT_SORT: SortSpec = { key: 'rent', dir: 'asc' };

const statusOrder = (s: UnitStatus): number => UNIT_STATUSES.indexOf(s);

export const isUnitSortKey = (key: string): key is UnitSortKey =>
  (UNIT_SORT_KEYS as readonly string[]).includes(key);

export function unitSortValue(row: UnitSortInput, key: UnitSortKey): SortValue {
  const u = row.unit;
  switch (key) {
    case 'rent':
      return u.rent;
    case 'availableDate':
      return u.availableDate;
    case 'squareFeet':
      return u.squareFeet;
    case 'bedrooms':
      return u.bedrooms;
    case 'bathrooms':
      return u.bathrooms;
    case 'floor':
      return u.floor;
    case 'rating':
      return row.mine.rating === 0 ? null : row.mine.rating; // 0 = not rated yet
    case 'listingAge':
      return row.listingAgeDays;
    case 'createdAt':
      return u.createdAt;
    case 'status':
      return statusOrder(u.status);
    case 'building':
      return row.building ? buildingName(row.building) : null;
  }
}

/** "Riverlight Unit 1504 <id>": building, then unit number in natural order. */
export const unitTiebreak = (row: UnitSortInput): string =>
  `${row.building ? buildingName(row.building) : ''}\u0000${unitTitle(row.unit, row.building)}\u0000${row.unit.id}`;

export function sortUnits<T extends UnitSortInput>(rows: readonly T[], spec: SortSpec): T[] {
  const key = isUnitSortKey(spec.key) ? spec.key : 'rent';
  return sortBy(rows, (r) => unitSortValue(r, key), spec.dir, unitTiebreak);
}

// ── Buildings ──────────────────────────────────────────────────────────────

export interface BuildingSortInput {
  building: Building;
  minRent: number | null;
  unitCount: number;
}

export const BUILDING_SORT_KEYS = ['minRent', 'name', 'unitCount', 'createdAt'] as const;
export type BuildingSortKey = (typeof BUILDING_SORT_KEYS)[number];

export const BUILDING_SORTS: Record<
  BuildingSortKey,
  { label: string; dir: SortDir; asc: string; desc: string }
> = {
  minRent: { label: 'Lowest rent', dir: 'asc', asc: 'low to high', desc: 'high to low' },
  name: { label: 'Name', dir: 'asc', asc: 'A to Z', desc: 'Z to A' },
  unitCount: { label: 'Your units', dir: 'desc', asc: 'fewest first', desc: 'most first' },
  createdAt: { label: 'Date added', dir: 'desc', asc: 'oldest first', desc: 'newest first' },
};

export const DEFAULT_BUILDING_SORT: SortSpec = { key: 'minRent', dir: 'asc' };

export const isBuildingSortKey = (key: string): key is BuildingSortKey =>
  (BUILDING_SORT_KEYS as readonly string[]).includes(key);

export function buildingSortValue(row: BuildingSortInput, key: BuildingSortKey): SortValue {
  switch (key) {
    case 'minRent':
      return row.minRent;
    case 'name':
      return buildingName(row.building);
    case 'unitCount':
      return row.unitCount;
    case 'createdAt':
      return row.building.createdAt;
  }
}

export function sortBuildings<T extends BuildingSortInput>(
  rows: readonly T[],
  spec: SortSpec,
): T[] {
  const key = isBuildingSortKey(spec.key) ? spec.key : 'minRent';
  return sortBy(
    rows,
    (r) => buildingSortValue(r, key),
    spec.dir,
    (r) => `${buildingName(r.building)}\u0000${r.building.id}`,
  );
}
