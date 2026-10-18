import fixture from '../fixtures/backup-v1.json';
import { RentalDB } from '../../src/db/db';
import { readMeId } from '../../src/db/me';
import { SCHEMA_VERSION } from '../../src/model';
import { makeV1Db } from './helpers';

/**
 * The real update from data format 1 (v0.5) to 2 (v0.6, people) on a browser database, as
 * the owner's copy will go through it.
 */
describe('updating a v1 database to v2', () => {
  it('moves ratings into your opinions, remembers you, clears undo and keeps a copy', async () => {
    const name = `upgrade-v2-${Date.now()}`;
    await makeV1Db(name, fixture.data, {
      changeLog: [
        {
          actionId: 'a1',
          label: 'Edit unit',
          kind: 'do',
          target: null,
          at: '2026-10-15T21:12:00.000Z',
          table: 'units',
          key: 'u-1',
          before: null,
          after: null,
        },
      ],
    });

    const db = new RentalDB(name);
    await db.open();
    expect(db.verno).toBe(SCHEMA_VERSION);

    const people = await db.people.toArray();
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ name: 'Me', color: 'teal', deletedAt: null });
    expect(await readMeId(db)).toBe(people[0]!.id);

    const opinions = await db.opinions.toArray();
    expect(opinions).toEqual([
      expect.objectContaining({ unitId: 'u-1', personId: people[0]!.id, rating: 4, flag: 'pick' }),
    ]);
    expect(
      await db.opinions.where('[unitId+personId]').equals(['u-1', people[0]!.id]).count(),
    ).toBe(1);

    const u1 = await db.units.get('u-1');
    expect(u1).not.toHaveProperty('rating');
    expect(u1?.colorLabel).toBe('blue');
    expect((await db.notes.toArray())[0]?.authorId).toBe(people[0]!.id);

    // Undo history recorded old-shaped records, so the update clears it.
    expect(await db.changeLog.count()).toBe(0);

    // The safety copy holds the data exactly as it was.
    const [snap] = await db.snapshots.toArray();
    expect(snap).toMatchObject({ fromVersion: 1, toVersion: 2, reason: 'migration' });
    expect(
      (snap!.data.units as { id: string; rating: number }[]).find((u) => u.id === 'u-1'),
    ).toMatchObject({ rating: 4 });
    db.close();
  });
});
