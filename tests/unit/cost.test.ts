import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  breakdownText,
  isPetFee,
  perSqftLabel,
  profileEstimate,
  unitCost,
} from '../../src/domain/cost';
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
const allIncluded = Object.fromEntries(UTILITY_KEYS.map((k) => [k, { mode: 'included' }])) as Unit['utilities'];
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
    expect(line(c, 'heat')?.note).toMatch(/^unknown, so you pay/);
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
      unitIn(b, { rent: 1000, parking: { spacesIncluded: 1, extraSpaceCost: 75, type: 'surface' } }),
      b,
      p,
    );
    expect(line(one, 'parking')).toMatchObject({ amount: 75, assumed: false });
    const both = unitCost(
      unitIn(b, { rent: 1000, parking: { spacesIncluded: 2, extraSpaceCost: 75, type: 'surface' } }),
      b,
      p,
    );
    expect(line(both, 'parking')).toMatchObject({ amount: 0, note: '2 spaces included' });
    const unknown = unitCost(unitIn(b, { rent: 1000 }), b, p);
    expect(line(unknown, 'parking')).toMatchObject({ amount: 200, assumed: true, overrideKey: 'parking' });
    const street = unitCost(
      unitIn(b, { rent: 1000, parking: { spacesIncluded: null, extraSpaceCost: null, type: 'street' } }),
      b,
      p,
    );
    expect(line(street, 'parking')).toMatchObject({ amount: 0, note: 'street parking' });
    const none = unitCost(unitIn(b, { rent: 1000 }), b, profile((x) => (x.parkingSpacesNeeded = 0)));
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
      line(unitCost(unitIn(b, { rent: 1000, storage: { included: true, cost: null } }), b, p), 'storage'),
    ).toMatchObject({ amount: 0, note: 'included' });
    expect(
      line(unitCost(unitIn(b, { rent: 1000, storage: { included: false, cost: 25 } }), b, p), 'storage'),
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
    expect(line(unitCost(unitIn(unknown, { rent: 1000 }), unknown, twoPets), 'pet-rent')).toMatchObject({
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
    const withCat = unitCost(u, b, profile((x) => {
      noInsurance(x);
      x.hasPets = { cats: 1, dogs: 0 };
    }));
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
    expect(twelve).toMatchObject({ leaseMonths: 12, rent: 1650, rentForTerm: true, leaseMatters: true });
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
    expect(c.moveIn).toMatchObject({ total: 1000, unknown: ['Deposit', 'Application fee', 'Admin fee'] });
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

  it('formats cost per ft²', () => {
    expect(perSqftLabel(2.6833)).toBe('$2.68/ft²');
  });
});
