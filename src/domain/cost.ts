import type { CostItemKey, CostProfile, Unit } from '../model';

/**
 * Cost-profile estimates (PLAN.md §5.3). M8 only needs one piece: what your profile assumes
 * a unit would pay for an item, shown as the placeholder of a "You pay" estimate in the
 * form. M9 builds the total monthly cost and its breakdown on top of this. Pure.
 */

/**
 * The profile's monthly estimate for this unit: scaled by size ("$55 at 750 ft²" → $53 for
 * 720 ft²) or by bedrooms (a studio counts as one), or flat. Unknown size or bedrooms use
 * the profile's number as it is. Whole dollars.
 */
export function profileEstimate(
  profile: CostProfile,
  key: CostItemKey,
  unit: Pick<Unit, 'squareFeet' | 'bedrooms'>,
): number {
  const item = profile.items[key];
  if (!item) return 0;
  let factor = 1;
  if (item.scaleBy === 'sqft' && unit.squareFeet !== null) factor = unit.squareFeet / item.basis;
  if (item.scaleBy === 'bedrooms' && unit.bedrooms !== null)
    factor = Math.max(1, unit.bedrooms) / item.basis;
  return Math.round(item.monthly * factor);
}
