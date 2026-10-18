import { z } from 'zod';
import { base, id, isoDateTime, maybe } from './common';
import { flag, labelColor, rating } from './unit';

/**
 * People and their opinions of units (PLAN.md §3.8, §5.8, Q15).
 *
 * Several people can use the app together (e.g. future roommates). Facts, status, listings
 * and the shared color label belong to the unit; each person's rating, flag, notes on them,
 * reject reasons, private color label and "last reviewed" live in an opinion, one per unit
 * and person. Each person only ever writes their own opinions, which is what makes
 * household sync (after Phase 1) mostly free of conflicts.
 *
 * Which person is "me" isn't stored here: it's a fact about each browser's copy (`meta`).
 */

export const PERSON_COLORS = ['teal', 'plum', 'rust', 'navy', 'olive', 'rose'] as const;
export const personColor = z.enum(PERSON_COLORS);
export type PersonColor = z.infer<typeof personColor>;

export const person = base.extend({
  name: z.string().trim().min(1).max(40),
  color: personColor,
  /** Names of this person's private color labels ('Red' → 'Too far?'). */
  labelNames: z.record(labelColor, z.string()),
});
export type Person = z.infer<typeof person>;

export const opinion = base.extend({
  unitId: id,
  personId: id,
  rating,
  ratingNote: maybe(z.string()),
  flag,
  flagNote: maybe(z.string()),
  rejectReasonIds: z.array(id),
  /** This person's private label; the shared one is `unit.colorLabel`. */
  colorLabel: maybe(labelColor),
  lastReviewedAt: maybe(isoDateTime),
});
export type Opinion = z.infer<typeof opinion>;

/** The fields of an opinion a person sets (everything but identity and timestamps). */
export type OpinionFields = Pick<
  Opinion,
  | 'rating'
  | 'ratingNote'
  | 'flag'
  | 'flagNote'
  | 'rejectReasonIds'
  | 'colorLabel'
  | 'lastReviewedAt'
>;

/**
 * One opinion per unit and person, with an id made from both: two copies of the app that
 * each create the same person's opinion of a unit (after sync) end up with the same record.
 */
export const opinionId = (unitId: string, personId: string): string => `${personId}:${unitId}`;
