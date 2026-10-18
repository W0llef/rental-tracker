import type { BackupData, Migration, MigrationContext } from './index';

/**
 * Version 2 (M6): people and per-person opinions (PLAN.md §5.8, Q15).
 *
 *  - Adds `people`, with one person for this copy ("me").
 *  - Moves each unit's rating, rating note, flag, flag note, reject reasons and "last
 *    reviewed" into an opinion of that unit by "me" (only when the unit has any of them).
 *  - Turns the unused `externalRatings` into people (one per name) and their opinions.
 *  - Notes record their author: "me", except notes the app wrote itself.
 *  - The unit's color label stays on the unit as the shared label; opinions start with no
 *    private label.
 *
 * Frozen once released: it uses plain objects and literals, never the current schemas.
 */

type Row = Record<string, unknown>;

const OPINION_FIELDS = [
  'rating',
  'ratingNote',
  'flag',
  'flagNote',
  'rejectReasonIds',
  'lastReviewedAt',
] as const;

const COLORS = ['teal', 'plum', 'rust', 'navy', 'olive', 'rose'] as const;

const LABEL_NAMES = {
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function clampRating(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
  return Math.min(5, Math.max(0, n));
}

function makePerson(id: string, name: string, color: string, at: string): Row {
  return {
    id,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    name: name.trim().slice(0, 40) || 'Someone',
    color,
    labelNames: { ...LABEL_NAMES },
  };
}

function makeOpinion(unit: Row, personId: string, fields: Row): Row {
  const at = str(unit.updatedAt) ?? str(unit.createdAt);
  return {
    id: `${personId}:${String(unit.id)}`,
    createdAt: at,
    updatedAt: at,
    deletedAt: null,
    unitId: unit.id,
    personId,
    rating: 0,
    ratingNote: null,
    flag: 'none',
    flagNote: null,
    rejectReasonIds: [],
    colorLabel: null,
    lastReviewedAt: null,
    ...fields,
  };
}

function says(o: Row): boolean {
  return (
    (o.rating as number) > 0 ||
    o.flag !== 'none' ||
    !!o.ratingNote ||
    !!o.flagNote ||
    (o.rejectReasonIds as unknown[]).length > 0 ||
    !!o.lastReviewedAt
  );
}

export function upgradeData(data: BackupData, ctx: MigrationContext): BackupData {
  const people: Row[] = [makePerson(ctx.meId, ctx.meName, COLORS[0], ctx.now)];
  const byName = new Map<string, string>(); // lower-case name → person id
  const opinions = new Map<string, Row>();

  const units = (data.units ?? []).map((raw) => {
    const u = raw as Row;
    const mine: Row = {
      rating: clampRating(u.rating),
      ratingNote: str(u.ratingNote),
      flag: u.flag === 'pick' || u.flag === 'reject' ? u.flag : 'none',
      flagNote: str(u.flagNote),
      rejectReasonIds: Array.isArray(u.rejectReasonIds) ? u.rejectReasonIds : [],
      lastReviewedAt: str(u.lastReviewedAt),
    };
    const own = makeOpinion(u, ctx.meId, mine);
    if (says(own)) opinions.set(String(own.id), own);

    const external = Array.isArray(u.externalRatings) ? (u.externalRatings as Row[]) : [];
    for (const ext of external) {
      const name = str(ext.by)?.trim();
      if (!name) continue;
      let personId = byName.get(name.toLowerCase());
      if (!personId) {
        personId = ctx.newId();
        byName.set(name.toLowerCase(), personId);
        people.push(makePerson(personId, name, COLORS[people.length % COLORS.length]!, ctx.now));
      }
      const theirs = makeOpinion(u, personId, {
        rating: clampRating(ext.rating),
        ratingNote: str(ext.note),
      });
      if (says(theirs)) opinions.set(String(theirs.id), theirs);
    }

    const next: Row = { ...u };
    for (const field of OPINION_FIELDS) delete next[field];
    delete next.externalRatings;
    return next;
  });

  const notes = (data.notes ?? []).map((raw) => {
    const n = raw as Row;
    return { ...n, authorId: n.kind === 'system' ? null : ctx.meId };
  });

  return {
    ...data,
    units,
    notes,
    people: [...(data.people ?? []), ...people],
    opinions: [...(data.opinions ?? []), ...opinions.values()],
  };
}

export const v2: Migration = {
  toVersion: 2,
  description: 'People and per-person opinions: ratings, flags and their notes move off units',
  tables: {},
  addTables: ['people', 'opinions'],
  transform: { tables: ['units', 'notes', 'people', 'opinions'], run: upgradeData },
  clearsHistory: true,
  createsMe: true,
};
