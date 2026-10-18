import { PERSON_COLORS } from '../model';
import type { ID, Opinion, OpinionFields, Person, PersonColor } from '../model';

/** People and opinions: pure helpers for the list, panels, restore and commands (§5.8). */

/** The first color nobody uses yet, so people are easy to tell apart. */
export function nextPersonColor(people: readonly Pick<Person, 'color'>[]): PersonColor {
  const used = new Set(people.map((p) => p.color));
  return PERSON_COLORS.find((c) => !used.has(c)) ?? PERSON_COLORS[people.length % 6]!;
}

export const PERSON_COLOR_VAR: Record<PersonColor, string> = {
  teal: 'var(--pp-teal)',
  plum: 'var(--pp-plum)',
  rust: 'var(--pp-rust)',
  navy: 'var(--pp-navy)',
  olive: 'var(--pp-olive)',
  rose: 'var(--pp-rose)',
};

export const PERSON_COLOR_LABELS: Record<PersonColor, string> = {
  teal: 'Teal',
  plum: 'Plum',
  rust: 'Rust',
  navy: 'Navy',
  olive: 'Olive',
  rose: 'Rose',
};

/** The letter on a person's badge. */
export function initial(name: string): string {
  const first = [...name.trim()][0];
  return first ? first.toLocaleUpperCase() : '?';
}

/** Names are trimmed and must say something; at most 40 characters. */
export function cleanName(name: string): string | null {
  const trimmed = name.replace(/\s+/g, ' ').trim().slice(0, 40);
  return trimmed || null;
}

/** Whether another live person already has this name (ignoring case). */
export function nameTaken(people: readonly Person[], name: string, exceptId: ID | null = null) {
  const key = name.trim().toLocaleLowerCase();
  return people.some(
    (p) => !p.deletedAt && p.id !== exceptId && p.name.trim().toLocaleLowerCase() === key,
  );
}

/**
 * Who is "me" after a restore (PLAN.md §5.8 "As built"):
 *  1. the person already using this browser, if the file has them (your own backup);
 *  2. otherwise whoever made the file (`exportedBy`), e.g. your backup restored on a new
 *     computer or after clearing site data;
 *  3. otherwise, if the file has just one person, them (it can only be its maker's);
 *  4. otherwise nobody: a new "Me" is created.
 */
export function resolveMe(
  people: readonly Pick<Person, 'id' | 'deletedAt'>[],
  currentMeId: ID | null,
  exportedBy: ID | null,
): ID | null {
  const live = new Set(people.filter((p) => !p.deletedAt).map((p) => p.id));
  if (currentMeId && live.has(currentMeId)) return currentMeId;
  if (exportedBy && live.has(exportedBy)) return exportedBy;
  if (live.size === 1) return [...live][0]!;
  return null;
}

/** One person's view of a unit, for display: their opinion or an empty one. */
export interface PersonOpinion {
  person: Person;
  isMe: boolean;
  opinion: OpinionFields;
  /** The stored record, if there is one. */
  record: Opinion | null;
}

/** "You", or the person's name. */
export const personLabel = (p: PersonOpinion | { person: Person; isMe: boolean }) =>
  p.isMe ? 'You' : p.person.name;

/** "You ★4 · Alex ★3 · Sam not rated": the side-by-side summary in words. */
export function ratingsSummary(rows: readonly PersonOpinion[]): string {
  return rows
    .map((r) => {
      const stars = r.opinion.rating > 0 ? `${r.opinion.rating} of 5 stars` : 'not rated';
      const flag =
        r.opinion.flag === 'pick' ? ', pick' : r.opinion.flag === 'reject' ? ', reject' : '';
      return `${personLabel(r)}: ${stars}${flag}`;
    })
    .join('; ');
}

/** At most this many badges on a card; the rest are counted ("+2"). */
export const CARD_BADGES = 3;

export interface OthersSummary {
  /** Other people who rated or flagged the unit, in order. */
  rows: PersonOpinion[];
  /** Their lowest and highest rating (rated ones only); null if nobody rated. */
  min: number | null;
  max: number | null;
  picks: number;
  rejects: number;
}

/**
 * Everyone else's view of a unit in one compact chip (cards, M6 owner review): who said
 * something, the range of their stars, and how many picked or rejected it. Stays the same
 * size however many people there are.
 */
export function othersSummary(opinions: readonly PersonOpinion[]): OthersSummary | null {
  const rows = opinions.filter(
    (o) => !o.isMe && (o.opinion.rating > 0 || o.opinion.flag !== 'none'),
  );
  if (!rows.length) return null;
  const rated = rows.map((r) => r.opinion.rating).filter((n) => n > 0);
  return {
    rows,
    min: rated.length ? Math.min(...rated) : null,
    max: rated.length ? Math.max(...rated) : null,
    picks: rows.filter((r) => r.opinion.flag === 'pick').length,
    rejects: rows.filter((r) => r.opinion.flag === 'reject').length,
  };
}

/** "★3", "★2–4", or null when nobody rated. */
export function starRange(s: Pick<OthersSummary, 'min' | 'max'>): string | null {
  if (s.min === null || s.max === null) return null;
  return s.min === s.max ? `★${s.min}` : `★${s.min}–${s.max}`;
}
