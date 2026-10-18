import fixtureV1 from '../fixtures/backup-v1.json';
import fixtureV2 from '../fixtures/backup-v2.json';
import { addPerson, removePerson, setOpinion, updatePerson } from '../../src/commands/people';
import { addNote, createBuilding, createUnit } from '../../src/commands/records';
import { undo } from '../../src/commands/undo';
import type { RentalDB } from '../../src/db/db';
import { ensureMe, getMe, readMeId } from '../../src/db/me';
import { opinionId } from '../../src/model';
import { makeAddress } from '../../src/model/factories';
import { createBackupFile } from '../../src/services/backup/exportJson';
import { checkBackup, checkBackupText, restoreBackup } from '../../src/services/backup/restore';
import { makeDb } from './helpers';

const address = makeAddress('200 Portland Ave S', 'Minneapolis');

async function twoUnits(db: RentalDB) {
  const b = await createBuilding(db, { address, name: 'Riverlight' });
  const u1 = await createUnit(db, { buildingId: b.id, unitNumber: '1504' });
  const u2 = await createUnit(db, { buildingId: b.id, unitNumber: '908' });
  return { u1, u2 };
}

describe('me', () => {
  it('sets up one person per copy, however many ask at once, outside undo', async () => {
    const db = makeDb();
    const ids = await Promise.all([ensureMe(db), ensureMe(db), ensureMe(db)]);
    expect(new Set(ids).size).toBe(1);
    expect(await db.people.count()).toBe(1);
    expect(await readMeId(db)).toBe(ids[0]);
    expect((await getMe(db)).name).toBe('Me');
    expect(await db.changeLog.count()).toBe(0);
    expect(await ensureMe(db)).toBe(ids[0]);
  });
});

describe('people', () => {
  it('adds, renames and recolors people, refusing blank or duplicate names', async () => {
    const db = makeDb();
    const meId = await ensureMe(db);
    const alex = await addPerson(db, '  Alex  ');
    expect(alex).toMatchObject({ name: 'Alex', color: 'plum' }); // the first color not in use
    await expect(addPerson(db, 'alex')).rejects.toThrow('already someone called alex');
    await expect(addPerson(db, '   ')).rejects.toThrow('Enter a name');
    await updatePerson(db, meId, { name: 'Jordan' });
    await expect(updatePerson(db, alex.id, { name: 'JORDAN' })).rejects.toThrow('already');
    await updatePerson(db, alex.id, { color: 'navy' });
    expect((await db.people.get(alex.id))?.color).toBe('navy');
    await undo(db);
    expect((await db.people.get(alex.id))?.color).toBe('plum');
    expect((await getMe(db)).name).toBe('Jordan');
  });

  it('removes someone with their opinions; undo brings both back; never you', async () => {
    const db = makeDb();
    const meId = await ensureMe(db);
    const { u1 } = await twoUnits(db);
    const alex = await addPerson(db, 'Alex');
    await setOpinion(db, u1.id, alex.id, { rating: 3 });
    await addNote(db, { unitId: u1.id, text: 'Bike room?', authorId: alex.id });

    await removePerson(db, alex.id);
    expect((await db.people.get(alex.id))?.deletedAt).not.toBeNull();
    expect((await db.opinions.get(opinionId(u1.id, alex.id)))?.deletedAt).not.toBeNull();
    expect(await db.notes.where('unitId').equals(u1.id).count()).toBe(1); // notes stay

    await undo(db);
    expect((await db.people.get(alex.id))?.deletedAt).toBeNull();
    expect((await db.opinions.get(opinionId(u1.id, alex.id)))?.deletedAt).toBeNull();
    await expect(removePerson(db, meId)).rejects.toThrow('can’t remove yourself');
  });
});

describe('opinions', () => {
  it('keeps one opinion per unit and person, each person separate', async () => {
    const db = makeDb();
    const meId = await ensureMe(db);
    const alex = await addPerson(db, 'Alex');
    const { u1, u2 } = await twoUnits(db);

    await setOpinion(db, u1.id, meId, { rating: 4 });
    await setOpinion(db, u1.id, alex.id, {
      rating: 2,
      flag: 'reject',
      rejectReasonIds: ['too-far'],
    });
    await setOpinion(db, u1.id, meId, { flag: 'pick' });
    expect(await db.opinions.get(opinionId(u1.id, meId))).toMatchObject({
      rating: 4,
      flag: 'pick',
    });
    expect(await db.opinions.get(opinionId(u1.id, alex.id))).toMatchObject({
      rating: 2,
      flag: 'reject',
      rejectReasonIds: ['too-far'],
    });

    // Un-rejecting drops the reasons, which only make sense with the flag.
    await setOpinion(db, u1.id, alex.id, { flag: 'none' });
    expect((await db.opinions.get(opinionId(u1.id, alex.id)))?.rejectReasonIds).toEqual([]);

    // Several units in one undo step; an opinion that says nothing isn't stored.
    const before = await db.opinions.count();
    await setOpinion(db, [u1.id, u2.id], meId, { rating: 5 });
    await setOpinion(db, u2.id, alex.id, { rating: 0 });
    expect(await db.opinions.count()).toBe(before + 1);
    await undo(db); // the no-op above recorded nothing, so this undoes the 5 stars
    expect((await db.opinions.get(opinionId(u1.id, meId)))?.rating).toBe(4);
    expect(await db.opinions.get(opinionId(u2.id, meId))).toBeUndefined();
  });

  it('refuses units and people that are gone', async () => {
    const db = makeDb();
    const meId = await ensureMe(db);
    await expect(setOpinion(db, 'nope', meId, { rating: 1 })).rejects.toThrow('wasn');
    const { u1 } = await twoUnits(db);
    await expect(setOpinion(db, u1.id, 'nobody', { rating: 1 })).rejects.toThrow('wasn');
  });

  it('records you as the author of new notes', async () => {
    const db = makeDb();
    const note = await addNote(db, { text: 'Hi' });
    expect(note.authorId).toBe(await readMeId(db));
  });
});

describe('who is "me" after a restore', () => {
  it('your own backup on a new computer makes you you again', async () => {
    const source = makeDb();
    const meId = await ensureMe(source);
    await updatePerson(source, meId, { name: 'Jordan' });
    const file = await createBackupFile(source);
    expect(file.envelope.exportedBy).toBe(meId);

    const fresh = makeDb();
    const checked = checkBackupText(file.json, null);
    if (!checked.ok) throw new Error(checked.message);
    await restoreBackup(fresh, checked.backup);
    expect(await readMeId(fresh)).toBe(meId);
    expect((await getMe(fresh)).name).toBe('Jordan');
  });

  it('an old (v1) file’s ratings become yours, keeping your name', async () => {
    const db = makeDb();
    const meId = await ensureMe(db);
    await updatePerson(db, meId, { name: 'Jordan' });
    const checked = checkBackup(fixtureV1, { id: meId, name: 'Jordan' });
    if (!checked.ok) throw new Error(checked.message);
    await restoreBackup(db, checked.backup);
    expect(await readMeId(db)).toBe(meId);
    expect(await db.people.toArray()).toEqual([
      expect.objectContaining({ id: meId, name: 'Jordan' }),
    ]);
    expect(await db.opinions.get(opinionId('u-1', meId))).toMatchObject({ rating: 4 });
  });

  it('a v2 file from someone else: you become whoever made it', async () => {
    const db = makeDb();
    await ensureMe(db);
    const checked = checkBackup(fixtureV2);
    if (!checked.ok) throw new Error(checked.message);
    await restoreBackup(db, checked.backup);
    expect(await readMeId(db)).toBe('p-me');
    expect(await db.people.count()).toBe(3); // Jordan, Alex and the removed Sam
  });

  it('a file that doesn’t say who made it, with several people, adds you', async () => {
    const db = makeDb();
    const meId = await ensureMe(db);
    await updatePerson(db, meId, { name: 'Jordan' }); // the file has a Jordan already
    const anonymous = { ...structuredClone(fixtureV2), exportedBy: null };
    const checked = checkBackup(anonymous);
    if (!checked.ok) throw new Error(checked.message);
    await restoreBackup(db, checked.backup);
    const me = await getMe(db);
    expect(me.id).toBe(meId);
    expect(me.name).toBe('Me'); // "Jordan" is taken in the file
    expect(await db.people.count()).toBe(4);
  });
});
