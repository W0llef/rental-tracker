import {
  addRows,
  normalizeLeasePrices,
  pickListed,
  pricesDiffer,
  sameCharge,
  setTermRent,
  setTermValue,
  startDiffering,
  stopDiffering,
  termValue,
  varyCharge,
  varyingCharges,
} from '../../src/domain/leasePrices';
import type { Unit } from '../../src/model';
import { newUnit } from '../../src/model/factories';

/** Q37 (layout C): prices by lease length in the Lease section. */

const unit = (extra: Partial<Unit> = {}): Unit => ({
  ...newUnit({ buildingId: 'b', unitNumber: '201' }),
  rent: 1395,
  deposit: 1395,
  applicationFee: 50,
  adminFee: 200,
  leaseTermsMonths: [9, 12, 15],
  recurringFees: [{ id: 'f1', label: 'Amenity fee', amount: 25 }],
  moveInSpecial: { text: '6 weeks free', valueUsd: 2093 },
  ...extra,
});

describe('prices by lease length', () => {
  it('starts every row at the rent, listing your lease length when the unit has it', () => {
    const u = startDiffering(unit(), 12);
    expect(u.rentByTerm).toEqual([
      { months: 9, rent: 1395 },
      { months: 12, rent: 1395 },
      { months: 15, rent: 1395 },
    ]);
    expect(u.listedTermMonths).toBe(12);
    expect(pricesDiffer(u)).toBe(true);
    expect(startDiffering(unit(), 18).listedTermMonths).toBe(9);
  });

  it('keeps the listed row’s rent as the unit’s rent, for price history', () => {
    let u = startDiffering(unit(), 12);
    u = setTermRent(u, 15, 1345);
    expect(u.rent).toBe(1395);
    u = setTermRent(u, 12, 1375);
    expect(u.rent).toBe(1375);
    u = pickListed(u, 15);
    expect(u).toMatchObject({ rent: 1345, listedTermMonths: 15 });
  });

  it('lets a charge vary, starting from its amount, and brings it back to one amount', () => {
    let u = startDiffering(unit(), 12);
    u = varyCharge(u, 'deposit');
    expect(varyingCharges(u)).toEqual(['deposit']);
    expect([9, 12, 15].map((m) => termValue(u, 'deposit', m))).toEqual([1395, 1395, 1395]);
    u = setTermValue(u, 'deposit', 15, 698);
    u = setTermValue(u, 'deposit', 12, 1000);
    expect(u.deposit).toBe(1000); // the listed length's amount is the main one
    u = varyCharge(u, 'fee:f1');
    u = setTermValue(u, 'fee:f1', 15, 0);
    u = varyCharge(u, 'moveInSpecial');
    expect(varyingCharges(u)).toEqual(['deposit', 'fee:f1', 'moveInSpecial']);
    u = sameCharge(u, 'deposit');
    expect(u.deposit).toBe(1000);
    expect(varyingCharges(u)).toEqual(['fee:f1', 'moveInSpecial']);
  });

  it('turning it off keeps the listed length’s prices for everything', () => {
    let u = startDiffering(unit(), 12);
    u = setTermRent(u, 15, 1345);
    u = varyCharge(u, 'deposit');
    u = setTermValue(u, 'deposit', 15, 698);
    u = varyCharge(u, 'fee:f1');
    u = setTermValue(u, 'fee:f1', 15, 0);
    u = pickListed(u, 15);
    const off = stopDiffering(u);
    expect(off).toMatchObject({
      rent: 1345,
      deposit: 698,
      rentByTerm: null,
      termCharges: [],
      listedTermMonths: null,
    });
    expect(off.recurringFees?.[0]?.amount).toBe(0);
    expect(pricesDiffer(off)).toBe(false);
  });

  it('gives new lease lengths rows, and drops gone ones on save', () => {
    let u = startDiffering(unit(), 12);
    u = varyCharge(u, 'deposit');
    u = setTermValue(u, 'deposit', 9, 1500);
    u = addRows({ ...u, leaseTermsMonths: [9, 12, 15, 18] });
    expect(u.rentByTerm?.map((t) => t.months)).toEqual([9, 12, 15, 18]);
    expect(termValue(u, 'deposit', 18)).toBe(1395);
    const saved = normalizeLeasePrices({ ...u, leaseTermsMonths: [12, 18] });
    expect(saved.rentByTerm?.map((t) => t.months)).toEqual([12, 18]);
    expect(saved.termCharges.every((c) => [12, 18].includes(c.months))).toBe(true);
    expect(saved.listedTermMonths).toBe(12);
  });

  it('saves a unit without prices by lease length as before', () => {
    const plain = normalizeLeasePrices(unit({ listedTermMonths: 12 }));
    expect(plain).toMatchObject({ rentByTerm: null, termCharges: [], listedTermMonths: null });
  });
});
