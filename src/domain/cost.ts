import type { Building, CostItemKey, CostProfile, Unit, UtilityKey } from '../model';
import { UTILITY_KEYS } from '../model';
import { money, num, UTILITY_LABELS } from './format';

/**
 * Total monthly cost (PLAN.md §5.3, Q5). Pure: from a unit, its building and your cost
 * profile to a total, a breakdown whose lines say where each number came from, the
 * move-in cost and the cost per ft².
 *
 * total = rent (for the lease length you'd sign, when the listing prices terms differently)
 *       + monthly fees (pet fees only if you have pets)
 *       + pet rent if you have pets (the building's, per pet, else your estimate)
 *       + utilities: included 0 · billed extra · you pay (the unit's estimate, else your
 *         estimate for this unit, else your cost profile's); unknown = you pay, "assumed"
 *       + parking for the spaces you need beyond those included
 *       + storage if you need it and it isn't included
 *       + renters insurance (your profile)
 *       [+ one-time fees ÷ lease months]   only if "spread one-time fees" is on
 *       [− move-in special ÷ lease months] only if "spread specials" is on
 *
 * Every line is whole dollars and the total is their sum, so the breakdown adds up.
 */

/** Where a line's number came from. */
export type CostSource =
  | 'listing' // the unit's own facts (rent, fees, utility amounts, parking prices)
  | 'building' // the building's (pet rent, pet fees)
  | 'profile' // your cost profile's estimate
  | 'override' // your estimate for this unit (unit.costOverrides)
  | 'spread'; // one-time amounts spread over the lease

export interface CostLine {
  /** Stable key: 'rent', 'fee:<id>', a utility key, 'parking', 'storage', … */
  key: string;
  label: string;
  /** Monthly dollars, whole; a spread special is negative. */
  amount: number;
  source: CostSource;
  /** Short explanation in slate: "listed", "est. for 720 ft²", "2 spaces × $75". */
  note: string;
  /** Not known for this unit; an estimate stands in (Q5). Shown in amber. */
  assumed: boolean;
  /** The cost-profile item whose estimate this line uses, so it can be set for this unit. */
  overrideKey: CostItemKey | null;
}

export interface MoveInCost {
  /** First month + deposit + fees that are known; null when rent is unknown. */
  total: number | null;
  parts: { key: string; label: string; amount: number }[];
  /** Parts still unknown, by name ("Deposit"). */
  unknown: string[];
}

export interface UnitCost {
  /** The lease length the costs assume: the unit's, else your default. */
  leaseMonths: number;
  /** True when the unit has its own lease length (plannedLeaseMonths). */
  leaseIsUnits: boolean;
  /** Rent used: the rent for `leaseMonths` when the listing gives one, else the rent. */
  rent: number | null;
  /** The rent came from the listing's rent for this lease length. */
  rentForTerm: boolean;
  lines: CostLine[];
  /** Null when rent is unknown (Q5: unknown rent → unknown total). */
  total: number | null;
  /** How many lines are assumed. */
  assumed: number;
  /** Total ÷ ft², in dollars with cents; null when either is unknown. */
  perSqft: number | null;
  /** Rent less the move-in special spread over the lease, when the special has a value. */
  effectiveRent: number | null;
  moveIn: MoveInCost;
  /** Lease lengths to offer: the unit's terms, its priced terms and the current one. */
  leaseOptions: number[];
  /** Show the lease length selector (§5.3): spreading is on, or rents differ by term. */
  leaseMatters: boolean;
}

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

/** "est. for 720 ft²", "est. for 2 bd", "your estimate". */
function estimateNote(
  profile: CostProfile,
  key: CostItemKey,
  unit: Pick<Unit, 'squareFeet' | 'bedrooms'>,
): string {
  const item = profile.items[key];
  if (item?.scaleBy === 'sqft' && unit.squareFeet !== null)
    return `your estimate for ${num(unit.squareFeet)} ft²`;
  if (item?.scaleBy === 'bedrooms' && unit.bedrooms !== null)
    return `your estimate for ${unit.bedrooms === 0 ? 'a studio' : `${num(unit.bedrooms)} bd`}`;
  return 'your estimate';
}

/** Your estimate for this unit if you set one, else the cost profile's. */
function estimate(
  profile: CostProfile,
  key: CostItemKey,
  unit: Pick<Unit, 'squareFeet' | 'bedrooms' | 'costOverrides'>,
): { amount: number; source: CostSource; note: string } {
  const own = unit.costOverrides[key];
  if (own !== undefined) return { amount: own, source: 'override', note: 'your estimate here' };
  return {
    amount: profileEstimate(profile, key, unit),
    source: 'profile',
    note: estimateNote(profile, key, unit),
  };
}

export const petCount = (profile: CostProfile): number =>
  profile.hasPets.cats + profile.hasPets.dogs;

/** A monthly fee that is pet rent ("Pet rent", "Pet fee"): it counts only if you have pets. */
export const isPetFee = (label: string): boolean => /\bpets?\b/i.test(label);

/** The lease length the costs assume for a unit. */
export const leaseMonthsFor = (unit: Pick<Unit, 'plannedLeaseMonths'>, profile: CostProfile) =>
  unit.plannedLeaseMonths ?? profile.defaultLeaseMonths;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function utilityLine(key: UtilityKey, unit: Unit, profile: CostProfile): CostLine {
  const term = unit.utilities[key];
  const label = UTILITY_LABELS[key];
  const line = (
    amount: number,
    source: CostSource,
    note: string,
    assumed: boolean,
    overridable = false,
  ): CostLine => ({
    key,
    label,
    amount,
    source,
    note,
    assumed,
    overrideKey: overridable ? key : null,
  });
  if (term?.mode === 'included') return line(0, 'listing', 'included', false);
  if (term?.mode === 'extra' && term.amount !== null)
    return line(term.amount, 'listing', 'billed by the landlord', false);
  if (term?.mode === 'tenant-paid' && term.estimate !== null)
    return line(term.estimate, 'listing', 'listed estimate', false);
  const est = estimate(profile, key, unit);
  if (term?.mode === 'extra')
    return line(est.amount, est.source, `billed extra, amount not listed; ${est.note}`, true, true);
  if (term?.mode === 'tenant-paid') return line(est.amount, est.source, est.note, false, true);
  return line(est.amount, est.source, `not listed; ${est.note}`, true, true);
}

function parkingLine(unit: Unit, profile: CostProfile): CostLine | null {
  const needed = profile.parkingSpacesNeeded;
  if (needed <= 0) return null;
  const p = unit.parking;
  const base = { key: 'parking', label: 'Parking', overrideKey: null } as const;
  if (p.type === 'none')
    return { ...base, amount: 0, source: 'listing', note: 'no parking here', assumed: false };
  const included = p.spacesIncluded;
  const toPay = Math.max(0, needed - (included ?? 0));
  if (toPay === 0)
    return {
      ...base,
      amount: 0,
      source: 'listing',
      note: `${plural(included ?? 0, 'space')} included`,
      assumed: false,
    };
  if (p.type === 'street' && p.extraSpaceCost === null)
    return { ...base, amount: 0, source: 'listing', note: 'street parking', assumed: false };
  const spaces = toPay === 1 ? '1 space' : `${toPay} spaces`;
  if (p.extraSpaceCost !== null)
    return {
      ...base,
      amount: toPay * p.extraSpaceCost,
      source: 'listing',
      note:
        included === null
          ? `${spaces} × ${money(p.extraSpaceCost)}, spaces included unknown`
          : `${spaces} × ${money(p.extraSpaceCost)}`,
      assumed: included === null,
    };
  const est = estimate(profile, 'parking', unit);
  return {
    ...base,
    amount: toPay * est.amount,
    source: est.source,
    note: `${spaces} × ${money(est.amount)}, ${est.note}`,
    assumed: true,
    overrideKey: 'parking',
  };
}

function storageLine(unit: Unit, profile: CostProfile): CostLine | null {
  if (!profile.needsStorage) return null;
  const s = unit.storage;
  const base = { key: 'storage', label: 'Storage', overrideKey: null } as const;
  if (s.included === true)
    return { ...base, amount: 0, source: 'listing', note: 'included', assumed: false };
  if (s.cost !== null)
    return { ...base, amount: s.cost, source: 'listing', note: 'listed', assumed: false };
  const est = estimate(profile, 'storage', unit);
  return {
    ...base,
    amount: est.amount,
    source: est.source,
    note: est.note,
    assumed: true,
    overrideKey: 'storage',
  };
}

function petLines(unit: Unit, building: Building | undefined, profile: CostProfile): CostLine[] {
  const pets = petCount(profile);
  if (pets === 0) return [];
  // A pet fee in the unit's monthly fees is the pet rent; it's already a line.
  if ((unit.recurringFees ?? []).some((f) => isPetFee(f.label))) return [];
  const base = { key: 'pet-rent', label: 'Pet rent' } as const;
  const perPet = building?.pets.monthlyRent ?? null;
  if (perPet !== null)
    return [
      {
        ...base,
        amount: perPet * pets,
        source: 'building',
        note: pets === 1 ? 'building' : `${pets} pets × ${money(perPet)}, building`,
        assumed: false,
        overrideKey: null,
      },
    ];
  const est = estimate(profile, 'pet-rent', unit);
  return [
    {
      ...base,
      amount: est.amount * pets,
      source: est.source,
      note: pets === 1 ? est.note : `${pets} pets × ${money(est.amount)}, ${est.note}`,
      assumed: true,
      overrideKey: 'pet-rent',
    },
  ];
}

/** One-time fees that would be spread: application, admin, and the building's pet fee. */
function oneTimeFees(unit: Unit, building: Building | undefined, profile: CostProfile) {
  const fees: { key: string; label: string; amount: number | null }[] = [
    { key: 'application', label: 'Application fee', amount: unit.applicationFee },
    { key: 'admin', label: 'Admin fee', amount: unit.adminFee },
  ];
  if (petCount(profile) > 0)
    fees.push({
      key: 'pet-fee',
      label: 'Pet fee',
      amount: building ? building.pets.oneTimeFee : null,
    });
  return fees;
}

function moveInCost(
  unit: Unit,
  building: Building | undefined,
  profile: CostProfile,
  rent: number | null,
): MoveInCost {
  const items: { key: string; label: string; amount: number | null }[] = [
    { key: 'first', label: 'First month', amount: rent },
    { key: 'deposit', label: 'Deposit', amount: unit.deposit },
    ...oneTimeFees(unit, building, profile),
  ];
  if (petCount(profile) > 0)
    items.push({
      key: 'pet-deposit',
      label: 'Pet deposit',
      amount: building ? building.pets.deposit : null,
    });
  const parts = items.flatMap((i) =>
    i.amount === null ? [] : [{ key: i.key, label: i.label, amount: i.amount }],
  );
  return {
    total: rent === null ? null : parts.reduce((s, p) => s + p.amount, 0),
    parts,
    unknown: items.filter((i) => i.amount === null).map((i) => i.label),
  };
}

/** Everything the app shows about what a unit costs. */
export function unitCost(
  unit: Unit,
  building: Building | undefined,
  profile: CostProfile,
): UnitCost {
  const leaseMonths = leaseMonthsFor(unit, profile);
  const termRent = unit.rentByTerm?.find((t) => t.months === leaseMonths)?.rent ?? null;
  const rent = termRent ?? unit.rent;
  const lines: CostLine[] = [];

  if (rent !== null)
    lines.push({
      key: 'rent',
      label: 'Rent',
      amount: rent,
      source: 'listing',
      note:
        termRent !== null
          ? `for a ${leaseMonths}-month lease`
          : unit.rentIsFrom
            ? 'listed "from" price'
            : 'listed',
      assumed: false,
      overrideKey: null,
    });

  const pets = petCount(profile);
  for (const fee of unit.recurringFees ?? []) {
    if (isPetFee(fee.label) && pets === 0) continue;
    lines.push({
      key: `fee:${fee.id}`,
      label: fee.label || 'Monthly fee',
      amount: fee.amount,
      source: 'listing',
      note: isPetFee(fee.label) && pets > 1 ? 'listed (as given, not per pet)' : 'listed',
      assumed: false,
      overrideKey: null,
    });
  }
  lines.push(...petLines(unit, building, profile));
  for (const key of UTILITY_KEYS) lines.push(utilityLine(key, unit, profile));
  const parking = parkingLine(unit, profile);
  if (parking) lines.push(parking);
  const storage = storageLine(unit, profile);
  if (storage) lines.push(storage);
  const insurance = estimate(profile, 'renters-insurance', unit);
  if (insurance.amount > 0)
    lines.push({
      key: 'renters-insurance',
      label: 'Renters insurance',
      amount: insurance.amount,
      source: insurance.source,
      note: insurance.note,
      assumed: false,
      overrideKey: 'renters-insurance',
    });

  if (profile.amortizeOneTimeFees) {
    const known = oneTimeFees(unit, building, profile).filter((f) => f.amount !== null);
    const sum = known.reduce((s, f) => s + (f.amount as number), 0);
    if (sum > 0)
      lines.push({
        key: 'one-time',
        label: 'One-time fees, spread',
        amount: Math.round(sum / leaseMonths),
        source: 'spread',
        note: `${money(sum)} over ${leaseMonths} months`,
        assumed: false,
        overrideKey: null,
      });
  }
  const special = unit.moveInSpecial?.valueUsd ?? null;
  if (profile.amortizeSpecials && special !== null && special > 0)
    lines.push({
      key: 'special',
      label: 'Move-in special, spread',
      amount: -Math.round(special / leaseMonths),
      source: 'spread',
      note: `${money(special)} off over ${leaseMonths} months`,
      assumed: false,
      overrideKey: null,
    });

  const total = rent === null ? null : lines.reduce((s, l) => s + l.amount, 0);
  const sqft = unit.squareFeet;
  const terms = new Set<number>([
    ...(unit.leaseTermsMonths ?? []),
    ...(unit.rentByTerm ?? []).map((t) => t.months),
    leaseMonths,
  ]);
  return {
    leaseMonths,
    leaseIsUnits: unit.plannedLeaseMonths !== null,
    rent,
    rentForTerm: termRent !== null,
    lines,
    total,
    assumed: lines.filter((l) => l.assumed).length,
    perSqft: total !== null && sqft ? Math.round((total / sqft) * 100) / 100 : null,
    effectiveRent:
      rent !== null && special !== null && special > 0
        ? Math.round(rent - special / leaseMonths)
        : null,
    moveIn: moveInCost(unit, building, profile, rent),
    leaseOptions: [...terms].sort((a, b) => a - b),
    leaseMatters:
      profile.amortizeOneTimeFees || profile.amortizeSpecials || (unit.rentByTerm ?? []).length > 0,
  };
}

/** "$2.68/ft²". */
export const perSqftLabel = (v: number): string => `$${v.toFixed(2)}/ft²`;

/** "$1,932/mo · 1 assumed" style summary of the lines, one per line, for a tooltip. */
export function breakdownText(cost: UnitCost): string {
  const rows = cost.lines.map(
    (l) =>
      `${l.label}: ${l.amount < 0 ? '−' : ''}${money(Math.abs(l.amount))}${l.assumed ? ' (assumed)' : ''}`,
  );
  if (cost.total !== null) rows.push(`Total: ${money(cost.total)}/mo`);
  else rows.push('Total unknown until the rent is known');
  return rows.join('\n');
}
