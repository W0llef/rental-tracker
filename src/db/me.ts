import { setWriteContext } from './changeLog';
import type { RentalDB } from './db';
import { META_KEYS } from './meta';
import { nextPersonColor } from '../domain/people';
import { person as personSchema } from '../model';
import type { ID, Person } from '../model';
import { newPerson } from '../model/factories';

/**
 * "Me": the person this browser's copy of the data belongs to (PLAN.md §5.8). Their id is
 * kept in `meta`, so it's a fact about this browser, never part of the shared data: a
 * backup only says who made it (`exportedBy`), and each copy decides who "me" is.
 */

/** This copy's person id, or null if none has been set up yet. Reading never writes. */
export async function readMeId(db: RentalDB): Promise<ID | null> {
  const row = await db.meta.get(META_KEYS.meId);
  return typeof row?.value === 'string' ? row.value : null;
}

/**
 * Makes sure this copy has a person (a new database, or after "Remove all data"):
 * creates "Me" if there's none and returns their id. Not undoable, like restore: it's the
 * setup of the copy, not an edit. Safe to call from several places at once.
 */
export async function ensureMe(db: RentalDB): Promise<ID> {
  const known = await readMeId(db);
  if (known) {
    const p = await db.people.get(known);
    if (p && !p.deletedAt) return known;
  }
  return db.transaction('rw', db.people, db.meta, async (tx) => {
    setWriteContext(tx.idbtrans, { system: 'set up this copy’s person' });
    const id = (await tx.table('meta').get(META_KEYS.meId)) as { value?: unknown } | undefined;
    const current = typeof id?.value === 'string' ? await db.people.get(id.value) : undefined;
    if (current) {
      if (current.deletedAt) await db.people.put({ ...current, deletedAt: null });
      return current.id;
    }
    const others = (await db.people.toArray()).filter((p) => !p.deletedAt);
    const me = personSchema.parse(newPerson({ name: 'Me', color: nextPersonColor(others) }));
    await db.people.add(me);
    await db.meta.put({ key: META_KEYS.meId, value: me.id });
    return me.id;
  });
}

/** The person record for "me", creating it if needed. */
export async function getMe(db: RentalDB): Promise<Person> {
  const id = await ensureMe(db);
  const me = await db.people.get(id);
  if (!me) throw new Error('This copy’s person is missing.');
  return me;
}
