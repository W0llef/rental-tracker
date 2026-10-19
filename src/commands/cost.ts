import type { RentalDB } from '../db/db';
import { COST_ITEM_LABELS, monthsLabel } from '../domain/format';
import type { CostItemKey, CostProfile, ID, Unit } from '../model';
import { updateSettings, updateUnit } from './records';

/**
 * Cost profile and per-unit cost choices (M9, PLAN.md §5.3). Each is one undo step and
 * goes through the record commands, so History describes it from the change log.
 */

/** The lease length you'd sign for this unit; null goes back to your default. */
export function setLeaseLength(db: RentalDB, unitId: ID, months: number | null): Promise<Unit> {
  return updateUnit(
    db,
    unitId,
    { plannedLeaseMonths: months },
    months === null ? 'Lease length: your default' : `Lease length: ${monthsLabel(months)}`,
  );
}

/**
 * Your estimate of one cost for this unit (`costOverrides`), used instead of the cost
 * profile's wherever the unit doesn't give its own number; null goes back to the profile.
 */
export async function setCostOverride(
  db: RentalDB,
  unitId: ID,
  key: CostItemKey,
  amount: number | null,
): Promise<Unit> {
  const current = await db.units.get(unitId);
  const overrides = { ...(current?.costOverrides ?? {}) };
  if (amount === null) delete overrides[key];
  else overrides[key] = amount;
  const name = COST_ITEM_LABELS[key].replace(/, per .*$/, '').toLowerCase();
  return updateUnit(
    db,
    unitId,
    { costOverrides: overrides },
    amount === null ? `Use your profile's ${name} estimate` : `Your ${name} estimate here`,
  );
}

/** Changes the cost profile (Settings → Cost profile); every total updates. */
export function updateCostProfile(
  db: RentalDB,
  change: (profile: CostProfile) => CostProfile,
  label = 'Change cost profile',
) {
  return updateSettings(db, (s) => ({ ...s, costProfile: change(s.costProfile) }), label);
}
