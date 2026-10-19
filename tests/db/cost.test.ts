import { entriesOf, readLookup } from '../../src/commands/history';
import { setCostOverride, setLeaseLength, updateCostProfile } from '../../src/commands/cost';
import { createBuilding, createUnit, getSettings } from '../../src/commands/records';
import { undo } from '../../src/commands/undo';
import type { RentalDB } from '../../src/db/db';
import { ensureMe } from '../../src/db/me';
import { recentActions } from '../../src/db/undo';
import { describeAction } from '../../src/domain/history';
import { makeAddress } from '../../src/model/factories';
import { makeDb } from './helpers';

async function setup() {
  const db = makeDb();
  await ensureMe(db);
  const b = await createBuilding(db, {
    address: makeAddress('200 Portland Ave S', 'Minneapolis'),
    name: 'Riverlight',
  });
  const u = await createUnit(db, { buildingId: b.id, unitNumber: '1504', rent: 1650 });
  return { db, u };
}

async function last(db: RentalDB) {
  const [a] = await recentActions(db, 1);
  const entries = await entriesOf(db, a!.actionId);
  return describeAction(a!, entries, await readLookup(db), null);
}

describe('cost commands (M9)', () => {
  it('sets and clears a unit’s lease length, each one undo step', async () => {
    const { db, u } = await setup();
    await setLeaseLength(db, u.id, 15);
    expect((await db.units.get(u.id))?.plannedLeaseMonths).toBe(15);
    expect((await last(db)).title).toBe(
      'Lease length your default → 15 months on Unit 1504 at Riverlight',
    );
    await setLeaseLength(db, u.id, null);
    expect((await last(db)).title).toBe(
      'Lease length 15 months → your default on Unit 1504 at Riverlight',
    );
    await undo(db);
    expect((await db.units.get(u.id))?.plannedLeaseMonths).toBe(15);
  });

  it('sets your estimate for one unit and goes back to the profile', async () => {
    const { db, u } = await setup();
    await setCostOverride(db, u.id, 'electric', 80);
    expect((await db.units.get(u.id))?.costOverrides).toEqual({ electric: 80 });
    expect((await last(db)).title).toBe('Your electric estimate $80/mo on Unit 1504 at Riverlight');
    await setCostOverride(db, u.id, 'parking', 150);
    await setCostOverride(db, u.id, 'electric', null);
    expect((await last(db)).title).toBe(
      'Your cost profile’s electric estimate on Unit 1504 at Riverlight',
    );
    expect((await db.units.get(u.id))?.costOverrides).toEqual({ parking: 150 });
    await undo(db);
    expect((await db.units.get(u.id))?.costOverrides).toEqual({ electric: 80, parking: 150 });
  });

  it('changes the cost profile and History says what changed', async () => {
    const { db } = await setup();
    await updateCostProfile(db, (p) => ({
      ...p,
      items: { ...p.items, electric: { ...p.items.electric, monthly: 60 } },
    }));
    expect((await getSettings(db)).costProfile.items.electric.monthly).toBe(60);
    expect((await last(db)).title).toBe('Electric estimate $55 → $60/mo');
    await updateCostProfile(db, (p) => ({
      ...p,
      parkingSpacesNeeded: 2,
      amortizeOneTimeFees: true,
      defaultLeaseMonths: 15,
      hasPets: { cats: 1, dogs: 0 },
    }));
    const d = await last(db);
    expect(d.details).toEqual([
      'Parking spaces you need 1 → 2',
      'Pets: 1 cat, 0 dogs',
      'Spreading one-time fees over the lease',
      'Default lease length 12 months → 15 months',
    ]);
    await undo(db);
    expect((await getSettings(db)).costProfile.parkingSpacesNeeded).toBe(1);
  });
});
