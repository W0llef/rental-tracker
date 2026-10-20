import type { Building, CostItemKey, CostProfile, TermChargeKey, Unit, UtilityKey } from '../model';
import { UTILITY_KEYS } from '../model';
import { aLease, money, num, UTILITY_LABELS } from './format';

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

/**
 * Whether the unit lists the lease length its costs are for (M9 review): it does; it lists
 * others but not that one (its costs then use the nearest one it lists); its lease terms are
 * unknown (marked `?`, or the listing lists none); or no lease terms are entered yet.
 */
export type TermStatus = 'offered' | 'not-offered' | 'unknown' | 'empty';

export interface UnitCost {
  /**
   * The lease length the costs are for: your default when you compare every unit at it
   * (`compareAtDefaultLease`), else the unit's own choice, else your default.
   */
  wantedMonths: number;
  /** The unit's own lease length when it differs from your default (shown as a tag), else null. */
  ownMonths: number | null;
  /** The unit has its own lease length but you compare every unit at yours: it's not used. */
  ownIgnored: boolean;
  /**
   * The lease length the costs use: `wantedMonths` when the unit lists it (or its terms are
   * unknown), else the nearest one it lists (a tie goes to the shorter).
   */
  leaseMonths: number;
  termStatus: TermStatus;
  /** Lease lengths the unit lists (its terms and its priced terms), shortest first. */
  offeredTerms: number[];
  /** True when the unit has its own lease length (plannedLeaseMonths). */
  leaseIsUnits: boolean;
  /** Rent used: the rent for `leaseMonths` when the listing gives one, else the rent. */
  rent: number | null;
  /** The rent came from the listing's rent for this lease length. */
  rentForTerm: boolean;
  /** Charges whose amount came from their price for this lease length (`termCharges`). */
  termPriced: string[];
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
  /** Lease lengths to choose from: the unit's terms, its priced terms and the wanted one. */
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
  profile.compareAtDefaultLease === true
    ? profile.defaultLeaseMonths
    : (unit.plannedLeaseMonths ?? profile.defaultLeaseMonths);

/** Lease terms checked and found unknown, or none listed: "Lease terms unknown". */
export const leaseTermsUnknown = (
  unit: Pick<Unit, 'leaseTermsMonths' | 'checkedUnknown'>,
): boolean =>
  (unit.leaseTermsMonths !== null && unit.leaseTermsMonths.length === 0) ||
  (unit.checkedUnknown ?? []).some((c) => c.field === 'unit.leaseTermsMonths');

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

/** Lease lengths a unit lists: its lease terms and the lengths it prices, shortest first. */
export function offeredTerms(unit: Pick<Unit, 'leaseTermsMonths' | 'rentByTerm'>): number[] {
  const set = new Set([
    ...(unit.leaseTermsMonths ?? []),
    ...(unit.rentByTerm ?? []).map((t) => t.months),
  ]);
  return [...set].sort((a, b) => a - b);
}

/** The listed length closest to `months`; a tie goes to the shorter lease. */
export function nearestTerm(offered: readonly number[], months: number): number {
  let best = offered[0] ?? months;
  for (const m of offered) if (Math.abs(m - months) < Math.abs(best - months)) best = m;
  return best;
}

/** The amount a charge has for a lease length, if it differs by length (`termCharges`). */
export function termAmount(
  unit: Pick<Unit, 'termCharges'>,
  charge: TermChargeKey,
  months: number,
): { found: boolean; amount: number | null } {
  const entry = unit.termCharges.find((c) => c.charge === charge && c.months === months);
  return entry ? { found: true, amount: entry.amount } : { found: false, amount: null };
}

/**
 * The unit as priced for one lease length: the deposit, application and admin fees, monthly
 * fees and the special's value for that length where they differ by length. A monthly fee
 * or special with no amount for that length keeps its main amount; an unknown deposit or
 * fee for that length is unknown.
 */
export function pricedForTerm(unit: Unit, months: number): { unit: Unit; termPriced: string[] } {
  const termPriced: string[] = [];
  const pick = (charge: TermChargeKey, main: number | null): number | null => {
    const t = termAmount(unit, charge, months);
    if (!t.found) return main;
    termPriced.push(charge);
    return t.amount;
  };
  const fees = (unit.recurringFees ?? []).map((f) => {
    const amount = pick(`fee:${f.id}`, f.amount);
    return { ...f, amount: amount ?? f.amount };
  });
  const special = unit.moveInSpecial;
  const value = special ? pick('moveInSpecial', special.valueUsd) : null;
  return {
    unit: {
      ...unit,
      deposit: pick('deposit', unit.deposit),
      applicationFee: pick('applicationFee', unit.applicationFee),
      adminFee: pick('adminFee', unit.adminFee),
      recurringFees: unit.recurringFees === null ? null : fees,
      moveInSpecial: special ? { ...special, valueUsd: value ?? special.valueUsd } : null,
    },
    termPriced,
  };
}

/** Everything the app shows about what a unit costs. */
export function unitCost(
  stored: Unit,
  building: Building | undefined,
  profile: CostProfile,
): UnitCost {
  const wantedMonths = leaseMonthsFor(stored, profile);
  const offered = offeredTerms(stored);
  const termStatus: TermStatus = !offered.length
    ? leaseTermsUnknown(stored)
      ? 'unknown'
      : 'empty'
    : offered.includes(wantedMonths)
      ? 'offered'
      : 'not-offered';
  const own = stored.plannedLeaseMonths;
  const ownMonths = own !== null && own !== profile.defaultLeaseMonths ? own : null;
  const leaseMonths =
    termStatus === 'not-offered' ? nearestTerm(offered, wantedMonths) : wantedMonths;
  const { unit, termPriced } = pricedForTerm(stored, leaseMonths);
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
          ? `for ${aLease(leaseMonths)}`
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
      note: termPriced.includes(`fee:${fee.id}`)
        ? `for ${aLease(leaseMonths)}`
        : isPetFee(fee.label) && pets > 1
          ? 'listed (as given, not per pet)'
          : 'listed',
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
  const terms = new Set<number>([...offered, wantedMonths]);
  return {
    wantedMonths,
    ownMonths,
    ownIgnored: ownMonths !== null && profile.compareAtDefaultLease === true,
    leaseMonths,
    termStatus,
    offeredTerms: offered,
    leaseIsUnits: unit.plannedLeaseMonths !== null,
    rent,
    rentForTerm: termRent !== null,
    termPriced,
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
      profile.amortizeOneTimeFees ||
      profile.amortizeSpecials ||
      (unit.rentByTerm ?? []).length > 0 ||
      unit.termCharges.length > 0 ||
      termStatus === 'not-offered',
  };
}

/** "No 15-month lease": the short mark for a unit that doesn't list your lease length. */
export const notOfferedLabel = (c: Pick<UnitCost, 'wantedMonths'>): string =>
  `No ${c.wantedMonths}-month lease`;

/** A lease-length mark (Q36): which kind, its short label, and the sentence explaining it. */
export interface LeaseMarkInfo {
  kind: 'not-offered' | 'unknown' | 'empty';
  label: string;
  explain: string;
}

/** The mark a unit's costs call for, or null when it lists the lease length they're for. */
export function leaseMark(
  c: Pick<UnitCost, 'termStatus' | 'wantedMonths' | 'leaseMonths' | 'offeredTerms'>,
): LeaseMarkInfo | null {
  const lease = aLease(c.wantedMonths);
  switch (c.termStatus) {
    case 'not-offered':
      return { kind: 'not-offered', label: notOfferedLabel(c), explain: notOfferedText(c) };
    case 'unknown':
      return {
        kind: 'unknown',
        label: 'Lease terms unknown',
        explain: `Its lease terms are unknown, so its costs assume ${lease} at the listed prices.`,
      };
    case 'empty':
      return {
        kind: 'empty',
        label: 'No lease terms entered',
        explain: `No lease terms are entered yet, so its costs assume ${lease} at the listed prices. Add them with Edit (E), Lease.`,
      };
    default:
      return null;
  }
}

/** "Doesn't list a 15-month lease (it lists 12 and 18 months), so its costs use 12." */
export function notOfferedText(
  c: Pick<UnitCost, 'wantedMonths' | 'leaseMonths' | 'offeredTerms'>,
): string {
  const list = c.offeredTerms;
  const listed =
    list.length === 1
      ? String(list[0])
      : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
  return `Doesn’t list ${aLease(c.wantedMonths)} (it lists ${listed} months), so its costs use the ${c.leaseMonths}-month lease.`;
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
