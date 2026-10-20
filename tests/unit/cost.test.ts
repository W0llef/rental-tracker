import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  breakdownText,
  isPetFee,
  leaseMark,
  nearestTerm,
  notOfferedLabel,
  notOfferedText,
  offeredTerms,
  perSqftLabel,
  profileEstimate,
  unitCost,
} from '../../src/domain/cost';
import { aLease } from '../../src/domain/format';
import {
  defaultLeaseMarkPrefs,
  parseLeaseMarkPrefs,
  shownLeaseMark,
} from '../../src/domain/leaseMarks';
import { pruneTermCharges } from '../../src/domain/unitForm';
import { defaultSettings, UTILITY_KEYS } from '../../src/model';
import type { Building, CostProfile, Unit } from '../../src/model';
import { makeAddress, newBuilding, newUnit } from '../../src/model/factories';

const building = (extra: Partial<Building> = {}) => ({
  ...newBuilding({ address: makeAddress('200 Portland Ave S', 'Minneapolis') }),
  ...extra,
});
const unitIn = (b: Building, extra: Partial<Unit> = {}): Unit => ({
  ...newUnit({ buildingId: b.id, unitNumber: '1504' }),
  ...extra,
});
const profile = (change: (p: CostProfile) => void = () => {}): CostProfile => {
  const p = defaultSettings().costProfile;
  change(p);
  return p;
};
/** Every utility known as included: only the lines a test is about remain non-zero. */
const allIncluded = Object.fromEntries(
  UTILITY_KEYS.map((k) => [k, { mode: 'included' }]),
) as Unit['utilities'];
const noInsurance = (p: CostProfile) => {
  p.items['renters-insurance'].monthly = 0;
  p.parkingSpacesNeeded = 0;
};
const line = (cost: ReturnType<typeof unitCost>, key: string) =>
  cost.lines.find((l) => l.key === key);

describe('profileEstimate', () => {
  it('scales by size, by bedrooms (a studio counts as one), or not at all', () => {
    const p = profile();
    expect(profileEstimate(p, 'electric', { squareFeet: 720, bedrooms: 1 })).toBe(53);
    expect(profileEstimate(p, 'electric', { squareFeet: null, bedrooms: 1 })).toBe(55);
    expect(profileEstimate(p, 'waterSewer', { squareFeet: null, bedrooms: 0 })).toBe(45);
    expect(profileEstimate(p, 'waterSewer', { squareFeet: null, bedrooms: 2 })).toBe(90);
    expect(profileEstimate(p, 'internet', { squareFeet: 2000, bedrooms: 3 })).toBe(60);
  });
});

describe('unitCost', () => {
  it('adds rent, fees, utilities, parking and insurance into a total that matches its lines', () => {
    const b = building();
    const u = unitIn(b, {
      rent: 1650,
      squareFeet: 720,
      bedrooms: 1,
      recurringFees: [{ id: 'f1', label: 'Amenity fee', amount: 40 }],
      utilities: {
        heat: { mode: 'included' },
        electric: { mode: 'tenant-paid', estimate: null },
        waterSewer: { mode: 'extra', amount: 45 },
        trash: { mode: 'included' },
        gas: { mode: 'included' },
        internet: { mode: 'tenant-paid', estimate: 50 },
      },
      parking: { spacesIncluded: 0, extraSpaceCost: 125, type: 'garage' },
    });
    const c = unitCost(u, b, profile());
    expect(c.rent).toBe(1650);
    expect(line(c, 'electric')).toMatchObject({ amount: 53, source: 'profile', assumed: false });
    expect(line(c, 'waterSewer')).toMatchObject({ amount: 45, source: 'listing' });
    expect(line(c, 'internet')).toMatchObject({ amount: 50, source: 'listing' });
    expect(line(c, 'parking')).toMatchObject({ amount: 125, note: '1 space × $125' });
    expect(line(c, 'renters-insurance')?.amount).toBe(15);
    expect(c.total).toBe(1650 + 40 + 53 + 45 + 50 + 125 + 15);
    expect(c.assumed).toBe(0);
    expect(c.perSqft).toBe(Math.round(((c.total as number) / 720) * 100) / 100);
  });

  it('assumes unknown utilities are yours to pay at your estimate and marks them', () => {
    const b = building();
    const c = unitCost(unitIn(b, { rent: 1000 }), b, profile(noInsurance));
    expect(c.assumed).toBe(UTILITY_KEYS.length);
    expect(line(c, 'heat')).toMatchObject({ assumed: true, overrideKey: 'heat' });
    expect(line(c, 'heat')?.note).toMatch(/^not listed; your estimate/);
  });

  it('uses your estimate for this unit over the profile', () => {
    const b = building();
    const u = unitIn(b, { rent: 1000, utilities: allIncluded, costOverrides: { electric: 80 } });
    u.utilities = { ...allIncluded, electric: null };
    const c = unitCost(u, b, profile(noInsurance));
    expect(line(c, 'electric')).toMatchObject({ amount: 80, source: 'override', assumed: true });
    expect(c.total).toBe(1080);
  });

  it('has no total while the rent is unknown, but still lists the other lines', () => {
    const b = building();
    const c = unitCost(unitIn(b), b, profile());
    expect(c.total).toBeNull();
    expect(c.perSqft).toBeNull();
    expect(c.moveIn.total).toBeNull();
    expect(c.lines.length).toBeGreaterThan(0);
    expect(breakdownText(c)).toMatch(/Total unknown/);
  });

  it('charges parking only for spaces beyond those included', () => {
    const b = building();
    const p = profile((x) => (x.parkingSpacesNeeded = 2));
    const one = unitCost(
      unitIn(b, {
        rent: 1000,
        parking: { spacesIncluded: 1, extraSpaceCost: 75, type: 'surface' },
      }),
      b,
      p,
    );
    expect(line(one, 'parking')).toMatchObject({ amount: 75, assumed: false });
    const both = unitCost(
      unitIn(b, {
        rent: 1000,
        parking: { spacesIncluded: 2, extraSpaceCost: 75, type: 'surface' },
      }),
      b,
      p,
    );
    expect(line(both, 'parking')).toMatchObject({ amount: 0, note: '2 spaces included' });
    const unknown = unitCost(unitIn(b, { rent: 1000 }), b, p);
    expect(line(unknown, 'parking')).toMatchObject({
      amount: 200,
      assumed: true,
      overrideKey: 'parking',
    });
    const street = unitCost(
      unitIn(b, {
        rent: 1000,
        parking: { spacesIncluded: null, extraSpaceCost: null, type: 'street' },
      }),
      b,
      p,
    );
    expect(line(street, 'parking')).toMatchObject({ amount: 0, note: 'street parking' });
    const none = unitCost(
      unitIn(b, { rent: 1000 }),
      b,
      profile((x) => (x.parkingSpacesNeeded = 0)),
    );
    expect(line(none, 'parking')).toBeUndefined();
  });

  it('counts storage only when you need it', () => {
    const b = building();
    const without = unitCost(unitIn(b, { rent: 1000 }), b, profile());
    expect(line(without, 'storage')).toBeUndefined();
    const p = profile((x) => (x.needsStorage = true));
    expect(line(unitCost(unitIn(b, { rent: 1000 }), b, p), 'storage')).toMatchObject({
      amount: 40,
      assumed: true,
    });
    expect(
      line(
        unitCost(unitIn(b, { rent: 1000, storage: { included: true, cost: null } }), b, p),
        'storage',
      ),
    ).toMatchObject({ amount: 0, note: 'included' });
    expect(
      line(
        unitCost(unitIn(b, { rent: 1000, storage: { included: false, cost: 25 } }), b, p),
        'storage',
      ),
    ).toMatchObject({ amount: 25, assumed: false });
  });

  it('adds pet rent per pet only when you have pets', () => {
    const b = building();
    b.pets = { ...b.pets, monthlyRent: 35, deposit: 300, oneTimeFee: 250 };
    const u = unitIn(b, { rent: 1000, utilities: allIncluded });
    expect(line(unitCost(u, b, profile(noInsurance)), 'pet-rent')).toBeUndefined();
    const twoPets = profile((x) => {
      noInsurance(x);
      x.hasPets = { cats: 1, dogs: 1 };
    });
    const c = unitCost(u, b, twoPets);
    expect(line(c, 'pet-rent')).toMatchObject({ amount: 70, source: 'building' });
    expect(c.total).toBe(1070);
    expect(c.moveIn.parts.map((p) => p.key)).toEqual(['first', 'pet-fee', 'pet-deposit']);
    // Unknown pet rent: your estimate, per pet, assumed.
    const unknown = building();
    expect(
      line(unitCost(unitIn(unknown, { rent: 1000 }), unknown, twoPets), 'pet-rent'),
    ).toMatchObject({
      amount: 70,
      assumed: true,
      overrideKey: 'pet-rent',
    });
  });

  it('treats a "pet rent" monthly fee as the pet rent', () => {
    expect(isPetFee('Pet rent')).toBe(true);
    expect(isPetFee('Carpet cleaning')).toBe(false);
    const b = building();
    b.pets = { ...b.pets, monthlyRent: 35 };
    const u = unitIn(b, {
      rent: 1000,
      utilities: allIncluded,
      recurringFees: [{ id: 'p', label: 'Pet rent', amount: 50 }],
    });
    expect(unitCost(u, b, profile(noInsurance)).total).toBe(1000);
    const withCat = unitCost(
      u,
      b,
      profile((x) => {
        noInsurance(x);
        x.hasPets = { cats: 1, dogs: 0 };
      }),
    );
    expect(withCat.total).toBe(1050);
    expect(line(withCat, 'pet-rent')).toBeUndefined();
  });

  it('uses the rent for your lease length when the listing gives one', () => {
    const b = building();
    const u = unitIn(b, {
      rent: 1650,
      utilities: allIncluded,
      leaseTermsMonths: [12, 15],
      rentByTerm: [
        { months: 12, rent: 1650 },
        { months: 15, rent: 1595 },
      ],
    });
    const p = profile(noInsurance);
    const twelve = unitCost(u, b, p);
    expect(twelve).toMatchObject({
      leaseMonths: 12,
      rent: 1650,
      rentForTerm: true,
      leaseMatters: true,
    });
    const fifteen = unitCost({ ...u, plannedLeaseMonths: 15 }, b, p);
    expect(fifteen).toMatchObject({ leaseMonths: 15, rent: 1595, total: 1595, leaseIsUnits: true });
    expect(line(fifteen, 'rent')?.note).toBe('for a 15-month lease');
    const nine = unitCost({ ...u, plannedLeaseMonths: 9 }, b, p);
    expect(nine.rent).toBe(1650);
    expect(nine.leaseOptions).toEqual([9, 12, 15]);
    // Without priced terms and with spreading off, the lease length doesn't change anything.
    expect(unitCost(unitIn(b, { rent: 1000 }), b, p).leaseMatters).toBe(false);
  });

  it('spreads one-time fees and specials over the lease only when switched on', () => {
    const b = building();
    const u = unitIn(b, {
      rent: 1200,
      utilities: allIncluded,
      applicationFee: 50,
      adminFee: 250,
      deposit: 500,
      moveInSpecial: { text: '6 weeks free', valueUsd: 1800 },
    });
    const off = unitCost(u, b, profile(noInsurance));
    expect(off.total).toBe(1200);
    expect(off.effectiveRent).toBe(1050);
    expect(off.moveIn).toMatchObject({ total: 2000, unknown: [] });
    const on = unitCost(
      { ...u, plannedLeaseMonths: 15 },
      b,
      profile((x) => {
        noInsurance(x);
        x.amortizeOneTimeFees = true;
        x.amortizeSpecials = true;
      }),
    );
    expect(line(on, 'one-time')).toMatchObject({ amount: 20, note: '$300 over 15 months' });
    expect(line(on, 'special')).toMatchObject({ amount: -120 });
    expect(on.total).toBe(1200 + 20 - 120);
    expect(on.leaseMatters).toBe(true);
  });

  it('lists unknown move-in parts by name', () => {
    const b = building();
    const c = unitCost(unitIn(b, { rent: 1000 }), b, profile());
    expect(c.moveIn).toMatchObject({
      total: 1000,
      unknown: ['Deposit', 'Application fee', 'Admin fee'],
    });
  });

  it('always adds up: the total is the sum of whole-dollar lines', () => {
    const money = fc.option(fc.integer({ min: 0, max: 5000 }), { nil: null });
    fc.assert(
      fc.property(
        money,
        money,
        fc.option(fc.integer({ min: 200, max: 3000 }), { nil: null }),
        fc.integer({ min: 0, max: 3 }),
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 1, max: 24 }),
        money,
        (rent, admin, sqft, spaces, spreadFees, spreadSpecial, months, special) => {
          const b = building();
          const u = unitIn(b, {
            rent,
            adminFee: admin,
            squareFeet: sqft,
            plannedLeaseMonths: months,
            moveInSpecial: special === null ? null : { text: 'Special', valueUsd: special },
          });
          const c = unitCost(
            u,
            b,
            profile((x) => {
              x.parkingSpacesNeeded = spaces;
              x.amortizeOneTimeFees = spreadFees;
              x.amortizeSpecials = spreadSpecial;
            }),
          );
          for (const l of c.lines) expect(Number.isInteger(l.amount)).toBe(true);
          if (rent === null) expect(c.total).toBeNull();
          else expect(c.total).toBe(c.lines.reduce((s, l) => s + l.amount, 0));
          expect(c.assumed).toBe(c.lines.filter((l) => l.assumed).length);
        },
      ),
    );
  });

  it('uses the nearest lease length the unit lists when yours isn’t one of them', () => {
    expect(nearestTerm([12, 18], 15)).toBe(12); // a tie goes to the shorter lease
    expect(nearestTerm([12, 18], 16)).toBe(18);
    expect(nearestTerm([6], 15)).toBe(6);
    expect(
      offeredTerms({ leaseTermsMonths: [18, 12], rentByTerm: [{ months: 15, rent: 1 }] }),
    ).toEqual([12, 15, 18]);
    const b = building();
    const u = unitIn(b, {
      rent: 1650,
      utilities: allIncluded,
      leaseTermsMonths: [12, 18],
      rentByTerm: [
        { months: 12, rent: 1650 },
        { months: 18, rent: 1550 },
      ],
    });
    const fifteen = profile((x) => {
      noInsurance(x);
      x.defaultLeaseMonths = 15;
    });
    const c = unitCost(u, b, fifteen);
    expect(c).toMatchObject({
      wantedMonths: 15,
      leaseMonths: 12,
      termStatus: 'not-offered',
      rent: 1650,
      leaseMatters: true,
    });
    expect(notOfferedLabel(c)).toBe('No 15-month lease');
    expect(notOfferedText(c)).toBe(
      'Doesn’t list a 15-month lease (it lists 12 and 18 months), so its costs use the 12-month lease.',
    );
    expect(unitCost({ ...u, plannedLeaseMonths: 17 }, b, fifteen)).toMatchObject({
      leaseMonths: 18,
      rent: 1550,
    });
    expect(unitCost(unitIn(b, { rent: 1000 }), b, fifteen)).toMatchObject({
      termStatus: 'empty',
      leaseMonths: 15,
    });
    // Lease terms unknown: none listed, or checked and marked ? (Q29); not entered is "empty".
    expect(unitCost(unitIn(b, { rent: 1000, leaseTermsMonths: [] }), b, fifteen).termStatus).toBe(
      'unknown',
    );
    expect(
      unitCost(
        unitIn(b, {
          rent: 1000,
          checkedUnknown: [{ field: 'unit.leaseTermsMonths', at: '2026-10-20' }],
        }),
        b,
        fifteen,
      ).termStatus,
    ).toBe('unknown');
    expect(unitCost(unitIn(b, { rent: 1000, leaseTermsMonths: [15] }), b, fifteen).termStatus).toBe(
      'offered',
    );
  });

  it('prices the deposit, fees and special for the lease length used', () => {
    const b = building();
    const u = unitIn(b, {
      rent: 1650,
      utilities: allIncluded,
      deposit: 500,
      applicationFee: 50,
      adminFee: 200,
      recurringFees: [{ id: 'f1', label: 'Amenity fee', amount: 40 }],
      moveInSpecial: { text: 'A month free', valueUsd: 1650 },
      leaseTermsMonths: [12, 15],
      rentByTerm: [
        { months: 12, rent: 1650 },
        { months: 15, rent: 1595 },
      ],
      termCharges: [
        { charge: 'deposit', months: 12, amount: 500 },
        { charge: 'deposit', months: 15, amount: 250 },
        { charge: 'adminFee', months: 15, amount: null },
        { charge: 'fee:f1', months: 15, amount: 0 },
        { charge: 'moveInSpecial', months: 12, amount: 0 },
      ],
    });
    const p = profile(noInsurance);
    const twelve = unitCost(u, b, p);
    expect(twelve.moveIn.parts.find((x) => x.key === 'deposit')?.amount).toBe(500);
    expect(twelve.effectiveRent).toBeNull(); // no special on a 12-month lease
    expect(twelve.total).toBe(1650 + 40);
    const fifteen = unitCost({ ...u, plannedLeaseMonths: 15 }, b, p);
    expect(fifteen.moveIn.parts.find((x) => x.key === 'deposit')?.amount).toBe(250);
    expect(fifteen.moveIn.unknown).toContain('Admin fee');
    expect(line(fifteen, 'fee:f1')).toMatchObject({ amount: 0, note: 'for a 15-month lease' });
    expect(fifteen.effectiveRent).toBe(Math.round(1595 - 1650 / 15));
    expect(fifteen.termPriced.sort()).toEqual(['adminFee', 'deposit', 'fee:f1']);
  });

  it('compares every unit at your lease length when you ask, and says what the unit’s own would be', () => {
    const b = building();
    const u = unitIn(b, {
      rent: 1650,
      utilities: allIncluded,
      plannedLeaseMonths: 15,
      leaseTermsMonths: [12, 15],
      rentByTerm: [
        { months: 12, rent: 1650 },
        { months: 15, rent: 1595 },
      ],
    });
    const own = unitCost(u, b, profile(noInsurance));
    expect(own).toMatchObject({ wantedMonths: 15, rent: 1595, ownMonths: 15, ownIgnored: false });
    const all = unitCost(
      u,
      b,
      profile((x) => {
        noInsurance(x);
        x.compareAtDefaultLease = true;
      }),
    );
    expect(all).toMatchObject({ wantedMonths: 12, rent: 1650, ownMonths: 15, ownIgnored: true });
    // A unit set to your default has no lease of its own to tag.
    expect(unitCost({ ...u, plannedLeaseMonths: 12 }, b, profile()).ownMonths).toBeNull();
  });

  it('gives each kind of lease mark its words', () => {
    const base = { wantedMonths: 15, leaseMonths: 12, offeredTerms: [12, 18] };
    expect(leaseMark({ ...base, termStatus: 'offered' })).toBeNull();
    expect(leaseMark({ ...base, termStatus: 'not-offered' })?.label).toBe('No 15-month lease');
    expect(leaseMark({ ...base, termStatus: 'unknown' })).toMatchObject({
      label: 'Lease terms unknown',
      explain:
        'Its lease terms are unknown, so its costs assume a 15-month lease at the listed prices.',
    });
    expect(leaseMark({ ...base, termStatus: 'empty' })?.label).toBe('No lease terms entered');
    const prefs = defaultLeaseMarkPrefs();
    const cost = { ...base, termStatus: 'empty' as const };
    expect(shownLeaseMark(cost, prefs, 'cards')?.kind).toBe('empty');
    expect(shownLeaseMark(cost, { ...prefs, on: false }, 'cards')).toBeNull();
    expect(
      shownLeaseMark(cost, { ...prefs, kinds: { ...prefs.kinds, empty: false } }, 'cards'),
    ).toBeNull();
    expect(
      shownLeaseMark(cost, { ...prefs, places: { ...prefs.places, map: false } }, 'map'),
    ).toBeNull();
    expect(parseLeaseMarkPrefs({ on: false, kinds: { unknown: 'x' } })).toMatchObject({
      on: false,
      kinds: { unknown: true },
    });
  });

  it('formats cost per ft²', () => {
    expect(perSqftLabel(2.6833)).toBe('$2.68/ft²');
  });
});

describe('charges by lease length in the form (M9 review)', () => {
  it('drops charges for lengths, fees and specials that are gone', () => {
    const base = {
      rentByTerm: [
        { months: 12, rent: 1650 },
        { months: 15, rent: 1595 },
      ],
      recurringFees: [{ id: 'f1', label: 'Amenity fee', amount: 40 }],
      moveInSpecial: null,
      termCharges: [
        { charge: 'deposit' as const, months: 12, amount: 500 },
        { charge: 'deposit' as const, months: 18, amount: 400 }, // no 18-month rent
        { charge: 'fee:f1' as const, months: 15, amount: 0 },
        { charge: 'fee:gone' as const, months: 15, amount: 0 },
        { charge: 'moveInSpecial' as const, months: 15, amount: 100 },
      ],
    };
    expect(pruneTermCharges(base).termCharges.map((c) => `${c.charge}@${c.months}`)).toEqual([
      'deposit@12',
      'fee:f1@15',
    ]);
    // One priced length: nothing can differ any more.
    expect(
      pruneTermCharges({ ...base, rentByTerm: [{ months: 12, rent: 1650 }] }).termCharges,
    ).toEqual([]);
  });

  it('says "a" or "an" before a lease length', () => {
    expect(aLease(12)).toBe('a 12-month lease');
    expect(aLease(18)).toBe('an 18-month lease');
    expect(aLease(8)).toBe('an 8-month lease');
    expect(aLease(11)).toBe('an 11-month lease');
  });
});
