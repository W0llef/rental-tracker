import { UTILITY_KEYS } from '../model';
import type { ID, Unit } from '../model';
import { newUnit } from '../model/factories';

/**
 * "Copy details from Unit 908" and "New unit from Plan C" (PLAN.md §5.7). A floor plan, or
 * another unit with the same layout, shares its specs, features, fees and utilities, so
 * they're copied; what's particular to one unit is not: its number, floor, rent, rent by
 * lease length, available date, windows, exposure, view, status, labels, ratings, notes,
 * listings and links. Pure.
 */

/** The unit fields that are copied, as paths. */
export const COPY_PATHS: readonly string[] = [
  'type',
  'bedrooms',
  'bathrooms',
  'squareFeet',
  'layoutNotes',
  'laundry',
  'dishwasher',
  'acType',
  'heatingType',
  'balcony',
  'fireplace',
  'flooring',
  'furnished',
  'leaseTermsMonths',
  'deposit',
  'applicationFee',
  'adminFee',
  'recurringFees',
  'moveInSpecial',
  ...UTILITY_KEYS.map((k) => `utilities.${k}`),
  'parking.type',
  'parking.spacesIncluded',
  'parking.extraSpaceCost',
  'storage.included',
  'storage.cost',
];

type Rec = Record<string, unknown>;

const get = (u: Unit, path: string): unknown =>
  path.split('.').reduce<unknown>((v, k) => (v as Rec | null)?.[k], u);

function set(u: Unit, path: string, value: unknown): Unit {
  const [head, sub] = path.split('.') as [keyof Unit, string | undefined];
  if (!sub) return { ...u, [head]: value };
  return { ...u, [head]: { ...(u[head] as Rec), [sub]: value } };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface CopyResult {
  unit: Unit;
  /** Paths that were unknown and now have the source's value. */
  copied: string[];
  /** Paths where the unit already had a different value, which was kept ("your data wins"). */
  kept: string[];
}

/**
 * Fills the unit's unknown fields from another unit. Values the unit already has are kept,
 * even where they differ. Monthly fees get fresh ids so the two units don't share records.
 */
export function copyDetails(
  source: Unit,
  target: Unit,
  makeId: () => ID = () => crypto.randomUUID(),
): CopyResult {
  let unit = target;
  const copied: string[] = [];
  const kept: string[] = [];
  for (const path of COPY_PATHS) {
    const from = get(source, path);
    if (from === null || from === undefined) continue;
    const now = get(target, path);
    if (now !== null && now !== undefined) {
      if (!same(now, from)) kept.push(path);
      continue;
    }
    const value =
      path === 'recurringFees' && Array.isArray(from)
        ? (from as Unit['recurringFees'] & object).map((f) => ({ ...f, id: makeId() }))
        : structuredClone(from);
    unit = set(unit, path, value);
    copied.push(path);
  }
  return { unit, copied, kept };
}

/**
 * A new unit made from another (DESIGN.md §4.3, "New unit from Plan C"): same building and
 * floor plan name, the copied details, everything else unknown. A floor plan's copy is a
 * real unit waiting for its number, so it isn't a floor-plan-only placeholder itself.
 */
export function unitFromSource(source: Unit, makeId: () => ID = () => crypto.randomUUID()): Unit {
  const blank = newUnit({
    buildingId: source.buildingId,
    floorPlanName: source.floorPlanName,
    isFloorPlanOnly: false,
    addedVia: 'form',
  });
  return copyDetails(source, blank, makeId).unit;
}
