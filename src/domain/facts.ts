import type { Building, FieldSource, ID, ISODate, Unit } from '../model';
import type { Fact } from './listingText';

/**
 * Applying recognized facts to a unit and its building (PLAN.md §5.7: "Your data wins").
 * A fact either fills an unknown field, matches what's there, or would change a value you
 * have. The caller decides which to apply (Quick-add applies the ones that fill; a unit's
 * "Paste text" lets you tick changes too). Every applied value records where it came from
 * in the unit's `fieldSources`. Pure.
 */

export type FactStatus = 'fills' | 'same' | 'changes';

interface Target {
  unit: Unit;
  building: Building;
}

function read(t: Target, path: string): unknown {
  const [root, ...rest] = path.split('.');
  let v: unknown = root === 'unit' ? t.unit : root === 'building' ? t.building : undefined;
  for (const k of rest)
    v = v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined;
  return v === undefined ? null : v;
}

function write<T extends object>(obj: T, path: string[], value: unknown): T {
  const [k, ...rest] = path;
  if (k === undefined) return obj;
  const current = (obj as Record<string, unknown>)[k];
  const next = rest.length ? write((current ?? {}) as object, rest, value) : value;
  return { ...obj, [k]: next };
}

/** Recurring fees compare by label and amount (their ids are made when they're added). */
const comparable = (v: unknown) =>
  Array.isArray(v)
    ? JSON.stringify(
        v.map((x) =>
          x && typeof x === 'object' && 'label' in x ? { label: x.label, amount: x.amount } : x,
        ),
      )
    : JSON.stringify(v);

/** What applying a fact would do. With no unit (a new one), everything fills. */
export function factStatus(fact: Fact, t: Partial<Target>): FactStatus {
  const current =
    fact.field.startsWith('unit.') && !t.unit
      ? null
      : fact.field.startsWith('building.') && !t.building
        ? null
        : read(t as Target, fact.field);
  if (current === null) return 'fills';
  return comparable(current) === comparable(fact.value) ? 'same' : 'changes';
}

/** The value a field has now ("unit.rent"), for showing "yours: …" next to a change. */
export function valueAt(field: string, t: Partial<Target>): unknown {
  const root = field.split('.')[0];
  if ((root === 'unit' && !t.unit) || (root === 'building' && !t.building)) return null;
  return read(t as Target, field);
}

export interface FactSource {
  today: ISODate;
  url: string | null;
  via: FieldSource['via'];
  importId: ID | null;
}

/**
 * Writes the given facts (all of them: filter first) and records their sources. Fields not
 * on the unit or building (like the address) are skipped.
 */
export function applyFacts(
  t: Target,
  facts: readonly Fact[],
  source: FactSource,
  makeId: () => ID = () => crypto.randomUUID(),
): Target & { applied: Fact[] } {
  let { unit, building } = t;
  const applied: Fact[] = [];
  for (const fact of facts) {
    const [root, ...path] = fact.field.split('.');
    if ((root !== 'unit' && root !== 'building') || !path.length) continue;
    const value =
      fact.field === 'unit.recurringFees' && Array.isArray(fact.value)
        ? (fact.value as { label: string; amount: number }[]).map((f) => ({ id: makeId(), ...f }))
        : fact.value;
    const sets = [
      { path, value },
      ...(fact.also ?? []).map((a) => ({ path: a.field.split('.').slice(1), value: a.value })),
    ];
    for (const s of sets) {
      if (root === 'unit') unit = write(unit, s.path, s.value);
      else building = write(building, s.path, s.value);
    }
    applied.push(fact);
  }
  if (applied.length) {
    const fields = new Set(applied.map((f) => f.field));
    const sources: FieldSource[] = applied.map((f) => ({
      field: f.field,
      url: source.url,
      seen: source.today,
      via: source.via,
      importId: source.importId,
    }));
    unit = {
      ...unit,
      fieldSources: [...unit.fieldSources.filter((s) => !fields.has(s.field)), ...sources],
    };
  }
  return { unit, building, applied };
}
