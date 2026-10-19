import { addPerson, setOpinion } from '../../src/commands/people';
import {
  entriesOf,
  listDeleted,
  planUndoThis,
  readLookup,
  restoreDeleted,
  restoreToHere,
  undoThis,
} from '../../src/commands/history';
import {
  addListing,
  addNote,
  createBuilding,
  createUnit,
  deleteBuilding,
  deleteUnit,
  updateUnit,
} from '../../src/commands/records';
import {
  addReason,
  deleteNote,
  rejectUnits,
  setReasonArchived,
  setSharedLabel,
  setStatus,
  updateNote,
  updateUnits,
} from '../../src/commands/triage';
import { redo, undo } from '../../src/commands/undo';
import type { RentalDB } from '../../src/db/db';
import { ensureMe } from '../../src/db/me';
import { recentActions } from '../../src/db/undo';
import { describeAction, describeClash, netChanges } from '../../src/domain/history';
import { opinionId } from '../../src/model';
import { makeAddress } from '../../src/model/factories';
import { dumpData, makeDb } from './helpers';

async function setup() {
  const db = makeDb();
  const meId = await ensureMe(db);
  const b = await createBuilding(db, {
    address: makeAddress('200 Portland Ave S', 'Minneapolis'),
    name: 'Riverlight',
  });
  const u1 = await createUnit(db, { buildingId: b.id, unitNumber: '1504', rent: 1650 });
  const u2 = await createUnit(db, { buildingId: b.id, unitNumber: '908', rent: 1600 });
  return { db, meId, b, u1, u2 };
}

/** The newest action's description, as the toast and History show it. */
async function lastTitle(db: RentalDB) {
  const [a] = await recentActions(db, 1);
  const entries = await entriesOf(db, a!.actionId);
  const target = a!.target ? await entriesOf(db, a!.target) : null;
  return describeAction(a!, entries, await readLookup(db), target).title;
}

describe('triage commands', () => {
  it('sets status and shared labels on several units in one undo step', async () => {
    const { db, u1, u2 } = await setup();
    await setStatus(db, [u1.id, u2.id], 'shortlisted');
    expect(await lastTitle(db)).toBe(
      'Status → Shortlisted on Unit 1504 at Riverlight and Unit 908 at Riverlight',
    );
    await setSharedLabel(db, [u1.id], 'blue');
    expect(await lastTitle(db)).toBe('Shared label Blue on Unit 1504 at Riverlight');
    await undo(db);
    await undo(db);
    expect((await db.units.get(u1.id))?.status).toBe('new');
    expect((await db.units.get(u2.id))?.status).toBe('new');
  });

  it('bulk edits keep the parts of utilities and parking it wasn’t asked to change', async () => {
    const { db, u1, u2 } = await setup();
    await updateUnit(db, u1.id, {
      utilities: { ...u1.utilities, electric: { mode: 'included' } },
    });
    const changed = await updateUnits(db, [u1.id, u2.id], {
      utilities: { heat: { mode: 'included' } },
      parking: { type: 'garage' },
    });
    expect(changed).toBe(2);
    const a = await db.units.get(u1.id);
    expect(a?.utilities.heat).toEqual({ mode: 'included' });
    expect(a?.utilities.electric).toEqual({ mode: 'included' });
    expect(a?.parking).toMatchObject({ type: 'garage', spacesIncluded: null });
    expect(await lastTitle(db)).toContain('Heat unknown → included');
    // Setting what's already there changes nothing.
    expect(await updateUnits(db, [u1.id], { parking: { type: 'garage' } })).toBe(0);
  });

  it('rejects with saved and new reasons and a note, in one step', async () => {
    const { db, meId, u1 } = await setup();
    await rejectUnits(db, [u1.id], meId, {
      reasonIds: ['too-far'],
      newReasons: ['  Noisy   street ', 'too far'],
      note: 'Right on the freeway',
    });
    const o = await db.opinions.get(opinionId(u1.id, meId));
    const settings = await db.settings.get('app');
    const noisy = settings?.rejectReasons.find((r) => r.label === 'Noisy street');
    expect(noisy).toBeTruthy();
    expect(o).toMatchObject({ flag: 'reject', flagNote: 'Right on the freeway' });
    expect(o?.rejectReasonIds).toEqual(['too-far', noisy!.id]);
    expect(o?.lastReviewedAt).toBeTruthy();
    expect(await lastTitle(db)).toBe(
      'Rejected Unit 1504 at Riverlight: Too far, Noisy street; Added the reject reason “Noisy street”',
    );
    await undo(db);
    expect(await db.opinions.get(opinionId(u1.id, meId))).toBeUndefined();
    // The settings record didn't exist before, so it's gone again.
    expect(
      (await db.settings.get('app'))?.rejectReasons.some((r) => r.label === 'Noisy street'),
    ).toBeFalsy();
  });

  it('archived reasons come back when typed again; duplicates are refused', async () => {
    const { db } = await setup();
    const id = await addReason(db, 'Noisy');
    await expect(addReason(db, 'noisy')).rejects.toThrow('already a reason');
    await setReasonArchived(db, id, true);
    expect(await addReason(db, 'NOISY')).toBe(id);
    expect((await db.settings.get('app'))?.rejectReasons.find((r) => r.id === id)?.archived).toBe(
      false,
    );
  });

  it('edits and deletes notes', async () => {
    const { db, u1 } = await setup();
    const n = await addNote(db, { unitId: u1.id, text: 'Nice light' });
    await updateNote(db, n.id, { text: 'Nice light, loud street', kind: 'tour' });
    expect(await lastTitle(db)).toBe('Edited a tour note on Unit 1504 at Riverlight');
    await deleteNote(db, n.id);
    expect((await db.notes.get(n.id))?.deletedAt).toBeTruthy();
    await undo(db);
    expect((await db.notes.get(n.id))?.deletedAt).toBeNull();
  });

  it('flagging the same way twice records nothing new', async () => {
    const { db, meId, u1 } = await setup();
    await setOpinion(db, u1.id, meId, { flag: 'pick' });
    const before = await db.changeLog.count();
    await setOpinion(db, u1.id, meId, { flag: 'pick' });
    expect(await db.changeLog.count()).toBe(before);
  });
});

describe('describing history', () => {
  it('names what was done, specifically', async () => {
    const { db, meId, u1, u2 } = await setup();
    await updateUnit(db, u2.id, { rent: 1550 });
    expect(await lastTitle(db)).toBe('Rent $1,600 → $1,550 on Unit 908 at Riverlight');
    await setOpinion(db, [u1.id, u2.id], meId, { flag: 'pick' });
    expect(await lastTitle(db)).toBe(
      'Flagged Unit 1504 at Riverlight and Unit 908 at Riverlight as pick',
    );
    await setOpinion(db, u1.id, meId, { rating: 4 });
    expect(await lastTitle(db)).toBe('Rated Unit 1504 at Riverlight 4 stars');
    const alex = await addPerson(db, 'Alex');
    await setOpinion(db, u1.id, alex.id, { colorLabel: 'red' });
    expect(await lastTitle(db)).toBe('Alex’s label Red on Unit 1504 at Riverlight');
    await deleteUnit(db, u1.id);
    expect(await lastTitle(db)).toBe('Deleted Unit 1504 at Riverlight');
    await undo(db);
    expect(await lastTitle(db)).toBe('Undid: Deleted Unit 1504 at Riverlight');
    await redo(db);
    expect(await lastTitle(db)).toBe('Redid: Deleted Unit 1504 at Riverlight');
  });

  it('says a building went with its units, and a new unit with its listing', async () => {
    const { db, b, u1 } = await setup();
    await addListing(db, {
      unitId: u1.id,
      site: 'zillow',
      url: 'https://www.zillow.com/x',
      firstSeen: '2026-10-01',
      lastSeen: '2026-10-01',
    });
    expect(await lastTitle(db)).toBe('Added a Zillow listing to Unit 1504 at Riverlight');
    await deleteBuilding(db, b.id);
    expect(await lastTitle(db)).toBe('Deleted Riverlight and its 2 units');
  });

  it('counts many units instead of listing them', async () => {
    const { db, b, u1, u2 } = await setup();
    const u3 = await createUnit(db, { buildingId: b.id, unitNumber: '301' });
    const u4 = await createUnit(db, { buildingId: b.id, unitNumber: '302' });
    await setStatus(db, [u1.id, u2.id, u3.id, u4.id], 'reviewing');
    expect(await lastTitle(db)).toBe('Status → Reviewing on 4 units');
  });
});

describe('Restore to here', () => {
  it('puts everything back as it was right after a point, as one undoable action', async () => {
    const { db, meId, u1, u2 } = await setup();
    await setOpinion(db, u1.id, meId, { rating: 3 });
    const [point] = await recentActions(db, 1);
    const snapshot = await dumpData(db);
    await updateUnit(db, u2.id, { rent: 1500 });
    await deleteUnit(db, u1.id);
    await setOpinion(db, u1.id, meId, { rating: 5 }).catch(() => undefined); // deleted: refused
    await undo(db); // undo the delete
    await setStatus(db, u2.id, 'toured');

    expect(await restoreToHere(db, point!.actionId)).toBeGreaterThan(0);
    const after = await dumpData(db);
    const strip = (d: Record<string, unknown[]>) =>
      JSON.parse(JSON.stringify(d, (k, v) => (k === 'updatedAt' ? undefined : v)));
    expect(strip(after)).toEqual(strip(snapshot));
    expect(await lastTitle(db)).toMatch(/^Went back to .*: \d+ changes?$/);

    // …and undoing that brings the later state back.
    await undo(db);
    expect((await db.units.get(u2.id))?.status).toBe('toured');
    expect((await db.units.get(u2.id))?.rent).toBe(1500);
  });

  it('does nothing at the latest point', async () => {
    const { db } = await setup();
    const [latest] = await recentActions(db, 1);
    expect(await restoreToHere(db, latest!.actionId)).toBe(0);
  });
});

describe('Undo this', () => {
  it('undoes one past action on its own, keeping what came after', async () => {
    const { db, u1, u2 } = await setup();
    const del = await deleteUnit(db, u1.id);
    await updateUnit(db, u2.id, { rent: 1500 });
    await setStatus(db, u2.id, 'toured');
    const plan = await planUndoThis(db, del);
    expect(plan.clashes).toEqual([]);
    expect(await undoThis(db, del)).toBe(true);
    expect((await db.units.get(u1.id))?.deletedAt).toBeNull();
    expect(await db.units.get(u2.id)).toMatchObject({ rent: 1500, status: 'toured' });
    expect(await lastTitle(db)).toBe('Undid: Deleted Unit 1504 at Riverlight');
    // It's a new action: Undo takes it back again.
    await undo(db);
    expect((await db.units.get(u1.id))?.deletedAt).toBeTruthy();
  });

  it('finds clashes, undoes only the rest when asked, or everything', async () => {
    const { db, u2 } = await setup();
    await updateUnit(db, u2.id, { rent: 1500, floor: 9 });
    const [edit] = await recentActions(db, 1);
    await updateUnit(db, u2.id, { rent: 1450 });

    const plan = await planUndoThis(db, edit!.actionId);
    expect(plan.clashes).toHaveLength(1);
    expect(plan.clashes[0]).toMatchObject({
      path: ['rent'],
      currentValue: 1450,
      restoreValue: 1600,
    });
    expect(describeClash(plan.clashes[0]!, await readLookup(db))).toBe(
      'Rent on Unit 908 at Riverlight is $1,450 now; undoing sets it back to $1,600.',
    );

    await undoThis(db, edit!.actionId, 'safe');
    expect(await db.units.get(u2.id)).toMatchObject({ rent: 1450, floor: null });
    await undo(db);
    await undoThis(db, edit!.actionId, 'all');
    expect(await db.units.get(u2.id)).toMatchObject({ rent: 1600, floor: null });
  });

  it('nested values clash only where they really do', async () => {
    const { db, u1 } = await setup();
    await updateUnits(db, u1.id, { utilities: { heat: { mode: 'included' } } });
    const [heat] = await recentActions(db, 1);
    await updateUnits(db, u1.id, { utilities: { electric: { mode: 'included' } } });
    const plan = await planUndoThis(db, heat!.actionId);
    expect(plan.clashes).toEqual([]);
    await undoThis(db, heat!.actionId);
    const u = await db.units.get(u1.id);
    expect(u?.utilities.heat).toBeNull();
    expect(u?.utilities.electric).toEqual({ mode: 'included' });
  });

  it('uses plain Undo for the latest action, so Redo still works', async () => {
    const { db, u1 } = await setup();
    await setStatus(db, u1.id, 'toured');
    const [latest] = await recentActions(db, 1);
    await undoThis(db, latest!.actionId);
    expect((await recentActions(db, 1))[0]?.kind).toBe('undo');
    await redo(db);
    expect((await db.units.get(u1.id))?.status).toBe('toured');
  });

  it('reports nothing to do once it has been undone', async () => {
    const { db, u1 } = await setup();
    await setStatus(db, u1.id, 'toured');
    const [first] = await recentActions(db, 1);
    await setStatus(db, u1.id, 'applied');
    await setStatus(db, u1.id, 'toured');
    // Status is back to what the first action set; undoing it now would go to "new".
    expect((await planUndoThis(db, first!.actionId)).clashes).toEqual([]);
    await undoThis(db, first!.actionId);
    expect((await db.units.get(u1.id))?.status).toBe('new');
    expect(await undoThis(db, first!.actionId)).toBe(false);
  });
});

describe('recently deleted', () => {
  it('lists deleted units and buildings and brings them back', async () => {
    const { db, b, u1, u2 } = await setup();
    await deleteUnit(db, u1.id);
    // Deletes in the same millisecond look like one (units go with their building by time);
    // a person can't click that fast, a test can.
    await new Promise((r) => setTimeout(r, 5));
    await deleteBuilding(db, b.id); // takes u2 with it
    const list = await listDeleted(db);
    expect(list.map((i) => [i.kind, i.id, i.unitCount])).toEqual([
      ['building', b.id, 1],
      ['unit', u1.id, 0],
    ]);
    // A unit in a deleted building brings its building back, but not its building's other units.
    await restoreDeleted(db, 'unit', u1.id);
    expect((await db.units.get(u1.id))?.deletedAt).toBeNull();
    expect((await db.buildings.get(b.id))?.deletedAt).toBeNull();
    expect((await db.units.get(u2.id))?.deletedAt).toBeTruthy();
    await undo(db);
    await restoreDeleted(db, 'building', b.id);
    expect((await db.units.get(u2.id))?.deletedAt).toBeNull();
    expect((await db.units.get(u1.id))?.deletedAt).toBeTruthy();
    expect(await lastTitle(db)).toBe('Restored Riverlight and its unit');
    expect(netChanges(await entriesOf(db, (await recentActions(db, 1))[0]!.actionId))).toHaveLength(
      2,
    );
  });
});
