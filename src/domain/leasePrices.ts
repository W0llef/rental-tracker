import type { TermChargeKey, Unit } from '../model';

/**
 * The Lease section's prices by lease length (Q37, layout C). Pure: each step takes the
 * draft unit and returns the next one.
 *
 * - Rent has one price per lease length (`rentByTerm`) and the unit's `rent` is the price
 *   for `listedTermMonths`, the one the listing advertises: price history follows it.
 * - Every other charge (deposit, application and admin fees, each monthly fee, the move-in
 *   special's value) is the same for all lengths until it "varies": then `termCharges` holds
 *   one amount per length, and its main field keeps the listed length's amount.
 * - Turning prices by lease length off keeps the listed length's prices for everything.
 */

type Draft = Pick<
  Unit,
  | 'rent'
  | 'rentByTerm'
  | 'termCharges'
  | 'listedTermMonths'
  | 'leaseTermsMonths'
  | 'deposit'
  | 'applicationFee'
  | 'adminFee'
  | 'recurringFees'
  | 'moveInSpecial'
>;

/** The unit prices lease lengths separately (the checkbox's stored state). */
export const pricesDiffer = (u: Pick<Unit, 'rentByTerm' | 'termCharges'>): boolean =>
  (u.rentByTerm?.length ?? 0) > 0 || u.termCharges.length > 0;

/** The lease lengths the table has a row for: its lease terms, shortest first. */
export const priceRows = (u: Pick<Unit, 'leaseTermsMonths'>): number[] =>
  [...new Set(u.leaseTermsMonths ?? [])].sort((a, b) => a - b);

/** The charge's main amount (the field the Lease section shows when it's the same). */
export function mainAmount(u: Draft, charge: TermChargeKey): number | null {
  if (charge === 'deposit') return u.deposit;
  if (charge === 'applicationFee') return u.applicationFee;
  if (charge === 'adminFee') return u.adminFee;
  if (charge === 'moveInSpecial') return u.moveInSpecial?.valueUsd ?? null;
  const id = charge.slice(4);
  return (u.recurringFees ?? []).find((f) => f.id === id)?.amount ?? null;
}

function withMain<T extends Draft>(u: T, charge: TermChargeKey, amount: number | null): T {
  if (charge === 'deposit') return { ...u, deposit: amount };
  if (charge === 'applicationFee') return { ...u, applicationFee: amount };
  if (charge === 'adminFee') return { ...u, adminFee: amount };
  if (charge === 'moveInSpecial')
    return u.moveInSpecial ? { ...u, moveInSpecial: { ...u.moveInSpecial, valueUsd: amount } } : u;
  const id = charge.slice(4);
  // A monthly fee needs an amount: an unknown one keeps the fee's amount.
  if (amount === null) return u;
  return {
    ...u,
    recurringFees: (u.recurringFees ?? []).map((f) => (f.id === id ? { ...f, amount } : f)),
  };
}

/** Charges that vary by lease length, in the order the Lease section lists them. */
export function varyingCharges(u: Draft): TermChargeKey[] {
  const set = new Set(u.termCharges.map((c) => c.charge));
  return chargeKeys(u).filter((k) => set.has(k));
}

/** Every charge that can vary: deposit, fees, each monthly fee, the special's value. */
export function chargeKeys(u: Draft): TermChargeKey[] {
  return [
    'deposit',
    'applicationFee',
    'adminFee',
    ...(u.recurringFees ?? []).map((f) => `fee:${f.id}` as TermChargeKey),
    ...(u.moveInSpecial ? (['moveInSpecial'] as TermChargeKey[]) : []),
  ];
}

/** The amount a varying charge has for one lease length (blank: null). */
export const termValue = (u: Draft, charge: TermChargeKey, months: number): number | null =>
  u.termCharges.find((c) => c.charge === charge && c.months === months)?.amount ?? null;

/** The rent for one lease length, if it has one. */
export const termRent = (u: Draft, months: number): number | null =>
  u.rentByTerm?.find((t) => t.months === months)?.rent ?? null;

/** Which lease length the listed rent is for: the stored one if it's a row, else the first. */
export function listedMonths(u: Draft): number | null {
  const rows = priceRows(u);
  if (u.listedTermMonths !== null && rows.includes(u.listedTermMonths)) return u.listedTermMonths;
  return rows[0] ?? u.listedTermMonths;
}

/** Ticking "Rent or fees differ by lease length": every row starts at the listed rent. */
export function startDiffering<T extends Draft>(u: T, preferMonths: number): T {
  const rows = priceRows(u);
  const listed = rows.includes(preferMonths) ? preferMonths : (rows[0] ?? null);
  return {
    ...u,
    rentByTerm: u.rent === null ? [] : rows.map((months) => ({ months, rent: u.rent as number })),
    listedTermMonths: listed,
  };
}

/** Unticking it: everything takes the listed length's price, and the table goes. */
export function stopDiffering<T extends Draft>(u: T): T {
  const listed = listedMonths(u);
  let next: T = { ...u };
  if (listed !== null) {
    next = { ...next, rent: termRent(u, listed) ?? u.rent };
    for (const charge of varyingCharges(u)) {
      const t = u.termCharges.find((c) => c.charge === charge && c.months === listed);
      if (t) next = withMain(next, charge, t.amount);
    }
  }
  return { ...next, rentByTerm: null, termCharges: [], listedTermMonths: null };
}

/** "Varies by length": one amount per row, each starting at the charge's main amount. */
export function varyCharge<T extends Draft>(u: T, charge: TermChargeKey): T {
  const main = mainAmount(u, charge);
  const rest = u.termCharges.filter((c) => c.charge !== charge);
  return {
    ...u,
    termCharges: [...rest, ...priceRows(u).map((months) => ({ charge, months, amount: main }))],
  };
}

/** "Same for all": back to one amount, the listed length's. */
export function sameCharge<T extends Draft>(u: T, charge: TermChargeKey): T {
  const listed = listedMonths(u);
  const t =
    listed === null
      ? undefined
      : u.termCharges.find((c) => c.charge === charge && c.months === listed);
  const next = t ? withMain(u, charge, t.amount) : u;
  return { ...next, termCharges: u.termCharges.filter((c) => c.charge !== charge) };
}

/** A row's rent. The listed row's rent is the unit's rent too, so price history follows it. */
export function setTermRent<T extends Draft>(u: T, months: number, rent: number | null): T {
  const others = (u.rentByTerm ?? []).filter((t) => t.months !== months);
  const rentByTerm = rent === null ? others : [...others, { months, rent }];
  rentByTerm.sort((a, b) => a.months - b.months);
  const next = { ...u, rentByTerm };
  return listedMonths(u) === months ? { ...next, rent } : next;
}

/** A varying charge's amount for one row; the listed row's is also the main amount. */
export function setTermValue<T extends Draft>(
  u: T,
  charge: TermChargeKey,
  months: number,
  amount: number | null,
): T {
  const rest = u.termCharges.filter((c) => !(c.charge === charge && c.months === months));
  const next = { ...u, termCharges: [...rest, { charge, months, amount }] };
  return listedMonths(u) === months ? withMain(next, charge, amount) : next;
}

/** "Price history" picks the row whose rent the listing advertises. */
export function pickListed<T extends Draft>(u: T, months: number): T {
  let next: T = { ...u, listedTermMonths: months };
  const rent = termRent(u, months);
  if (rent !== null) next = { ...next, rent };
  for (const charge of varyingCharges(u))
    next = withMain(next, charge, termValue(u, charge, months));
  return next;
}

/**
 * Lease terms changed while prices differ: new rows start at the listed rent and at each
 * varying charge's main amount. Rows that went away are dropped when the form saves.
 */
export function addRows<T extends Draft>(u: T): T {
  const rows = priceRows(u);
  const base = u.rent;
  const have = new Set((u.rentByTerm ?? []).map((t) => t.months));
  const rentByTerm = [
    ...(u.rentByTerm ?? []),
    ...(base === null
      ? []
      : rows.filter((m) => !have.has(m)).map((months) => ({ months, rent: base }))),
  ].sort((a, b) => a.months - b.months);
  const termCharges = [...u.termCharges];
  for (const charge of varyingCharges(u)) {
    const main = mainAmount(u, charge);
    for (const months of rows)
      if (!termCharges.some((c) => c.charge === charge && c.months === months))
        termCharges.push({ charge, months, amount: main });
  }
  return { ...u, rentByTerm, termCharges, listedTermMonths: listedMonths({ ...u, rentByTerm }) };
}

/**
 * Before saving: only the lease lengths the unit lists keep prices, the listed length is one
 * of them, and the rent and each varying charge's main amount are the listed length's.
 */
export function normalizeLeasePrices<T extends Draft>(u: T): T {
  if (!pricesDiffer(u)) return { ...u, listedTermMonths: null };
  const rows = new Set(priceRows(u));
  const keep = (m: number) => rows.size === 0 || rows.has(m);
  let next: T = {
    ...u,
    rentByTerm: (u.rentByTerm ?? []).filter((t) => keep(t.months)),
    termCharges: u.termCharges.filter((c) => keep(c.months)),
  };
  const listed = listedMonths(next);
  next = { ...next, listedTermMonths: listed };
  if (listed !== null) next = pickListed(next, listed);
  if (!pricesDiffer(next)) return { ...next, rentByTerm: null, listedTermMonths: null };
  return next;
}

/** Column and field names for each charge. */
export function chargeLabel(u: Pick<Unit, 'recurringFees'>, charge: TermChargeKey): string {
  if (charge === 'deposit') return 'Deposit';
  if (charge === 'applicationFee') return 'Application fee';
  if (charge === 'adminFee') return 'Admin fee';
  if (charge === 'moveInSpecial') return 'Special’s value';
  const fee = (u.recurringFees ?? []).find((f) => `fee:${f.id}` === charge);
  return `${fee?.label || 'Monthly fee'} /mo`;
}
