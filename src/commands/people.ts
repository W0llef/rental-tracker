import type { RentalDB } from '../db/db';
import { readMeId } from '../db/me';
import { cleanName, nameTaken, nextPersonColor } from '../domain/people';
import { opinion as opinionSchema, person as personSchema } from '../model';
import type { ID, OpinionFields, Person, PersonColor } from '../model';
import { hasOpinion, newOpinion, newPerson, nowIso } from '../model/factories';
import { action } from './action';
import { NotFoundError } from './records';

/**
 * People and opinions (PLAN.md §5.8). Each command is one undoable action.
 *
 * Until household sync exists, other people are added by hand (Settings → People) and
 * their ratings entered for them; with sync, each person's copy writes only their own
 * opinions.
 */

export class PeopleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PeopleError';
  }
}

function requireName(people: Person[], name: string, exceptId: ID | null): string {
  const clean = cleanName(name);
  if (!clean) throw new PeopleError('Enter a name.');
  if (nameTaken(people, clean, exceptId)) {
    throw new PeopleError(`There’s already someone called ${clean}.`);
  }
  return clean;
}

export async function addPerson(db: RentalDB, name: string): Promise<Person> {
  const { value } = await action(db, 'Add person', async () => {
    const people = (await db.people.toArray()).filter((p) => !p.deletedAt);
    const record = personSchema.parse(
      newPerson({ name: requireName(people, name, null), color: nextPersonColor(people) }),
    );
    await db.people.add(record);
    return record;
  });
  return value;
}

export async function updatePerson(
  db: RentalDB,
  id: ID,
  changes: { name?: string; color?: PersonColor; labelNames?: Partial<Person['labelNames']> },
): Promise<Person> {
  const label =
    changes.name !== undefined
      ? 'Rename person'
      : changes.labelNames
        ? 'Name private label'
        : 'Change person’s color';
  const { value } = await action(db, label, async () => {
    const current = await db.people.get(id);
    if (!current || current.deletedAt) throw new NotFoundError('Person', id);
    const people = (await db.people.toArray()).filter((p) => !p.deletedAt);
    const next = personSchema.parse({
      ...current,
      ...(changes.name !== undefined ? { name: requireName(people, changes.name, id) } : {}),
      ...(changes.color ? { color: changes.color } : {}),
      ...(changes.labelNames
        ? { labelNames: { ...current.labelNames, ...changes.labelNames } }
        : {}),
      updatedAt: nowIso(),
    });
    await db.people.put(next);
    return next;
  });
  return value;
}

/**
 * Removes someone else (soft delete, with their opinions; Undo brings both back). Their
 * notes stay and still show their name. You can't remove yourself.
 */
export async function removePerson(db: RentalDB, id: ID): Promise<string> {
  const meId = await readMeId(db);
  if (id === meId) throw new PeopleError('You can’t remove yourself.');
  const { actionId } = await action(db, 'Remove person', async () => {
    const current = await db.people.get(id);
    if (!current || current.deletedAt) throw new NotFoundError('Person', id);
    const at = nowIso();
    await db.people.put({ ...current, deletedAt: at, updatedAt: at });
    const theirs = await db.opinions.where('personId').equals(id).toArray();
    for (const o of theirs) {
      if (!o.deletedAt) await db.opinions.put({ ...o, deletedAt: at, updatedAt: at });
    }
  });
  return actionId;
}

/**
 * Sets part of one person's opinion of one or more units (one undo step). A reject reason
 * or flag note only makes sense with its flag, so changing the flag away from "reject"
 * clears the reasons. An opinion that ends up saying nothing is kept (as a record of when
 * it changed), but shows as "not rated".
 */
export async function setOpinion(
  db: RentalDB,
  unitIds: ID | ID[],
  personId: ID,
  changes: Partial<OpinionFields>,
  label = 'Change rating',
): Promise<void> {
  const ids = Array.isArray(unitIds) ? unitIds : [unitIds];
  await action(db, label, async () => {
    const who = await db.people.get(personId);
    if (!who || who.deletedAt) throw new NotFoundError('Person', personId);
    const at = nowIso();
    for (const unitId of ids) {
      const unit = await db.units.get(unitId);
      if (!unit || unit.deletedAt) throw new NotFoundError('Unit', unitId);
      const current =
        (await db.opinions.where('[unitId+personId]').equals([unitId, personId]).first()) ?? null;
      const base = current && !current.deletedAt ? current : null;
      const next = { ...(base ?? newOpinion(unitId, personId, {}, at)), ...changes };
      if (changes.flag !== undefined && changes.flag !== 'reject') next.rejectReasonIds = [];
      if (!base && !hasOpinion(next)) continue; // nothing to say, nothing to store
      const said = (o: OpinionFields) =>
        JSON.stringify([
          o.rating,
          o.ratingNote,
          o.flag,
          o.flagNote,
          o.rejectReasonIds,
          o.colorLabel,
        ]);
      if (base && said(base) === said(next)) continue; // already so
      // "Last reviewed" (spec §3): when this person last flagged, rated or labeled it.
      const reviewed = ['rating', 'flag', 'colorLabel', 'rejectReasonIds'].some(
        (k) => k in changes,
      );
      if (reviewed && changes.lastReviewedAt === undefined) next.lastReviewedAt = at;
      const record = opinionSchema.parse({
        ...next,
        id: current?.id ?? next.id,
        createdAt: current?.createdAt ?? next.createdAt,
        deletedAt: null,
        updatedAt: at,
      });
      await db.opinions.put(record);
    }
  });
}
