import type { Flag, LabelColor, OpinionFields, Settings } from '../model';

/**
 * Triage rules shared by the keyboard, the detail panel and the selection bar (spec §6,
 * PLAN.md §6). Pure.
 */

/** Trims and squeezes a reason or label name; at most 40 characters. Null when empty. */
export function cleanReason(text: string): string | null {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 40);
  return clean || null;
}

/** A saved reason with this name, ignoring case (archived ones too). */
export function findReason(
  reasons: Settings['rejectReasons'],
  label: string,
): Settings['rejectReasons'][number] | undefined {
  const key = label.trim().toLocaleLowerCase();
  return reasons.find((r) => r.label.trim().toLocaleLowerCase() === key);
}

/** The reasons the Reject dialog offers: live ones, plus archived ones already chosen. */
export function offeredReasons(
  reasons: Settings['rejectReasons'],
  chosen: readonly string[],
): Settings['rejectReasons'] {
  return reasons.filter((r) => !r.archived || chosen.includes(r.id));
}

/** Keys 6–9 (PLAN.md §6, Q8): red, yellow, green, blue. Purple only from the menu. */
export const LABEL_KEYS: Record<string, LabelColor> = {
  Digit6: 'red',
  Digit7: 'yellow',
  Digit8: 'green',
  Digit9: 'blue',
  Numpad6: 'red',
  Numpad7: 'yellow',
  Numpad8: 'green',
  Numpad9: 'blue',
};

/**
 * Pressing a label's key toggles it: if every target already has that label it's cleared,
 * otherwise every target gets it (Lightroom's behaviour).
 */
export function toggledLabel(
  current: readonly (LabelColor | null)[],
  pressed: LabelColor,
): LabelColor | null {
  return current.length > 0 && current.every((c) => c === pressed) ? null : pressed;
}

/** One value when all are the same, "mixed" otherwise (Edit together, Q20). */
export type Common<T> = { mixed: false; value: T } | { mixed: true };

export function common<T>(values: readonly T[]): Common<T> {
  if (!values.length) return { mixed: true };
  const first = JSON.stringify(values[0] ?? null);
  return values.every((v) => JSON.stringify(v ?? null) === first)
    ? { mixed: false, value: values[0] as T }
    : { mixed: true };
}

/** What the flag keys and buttons say they did, for buttons' pressed state. */
export function commonFlag(opinions: readonly Pick<OpinionFields, 'flag'>[]): Flag | null {
  const c = common(opinions.map((o) => o.flag));
  return c.mixed ? null : c.value;
}

/** "5 units", "1 unit". */
export const unitsCount = (n: number) => `${n} unit${n === 1 ? '' : 's'}`;

/**
 * Lease lengths as typed: "12, 15" → [12, 15]; ranges too, "9-18, 24" or "9 to 18" →
 * [9, 10, …, 18, 24] (M9 review); "none" → []; "?" → null; anything unreadable → undefined.
 */
export function parseMonths(text: string): number[] | null | undefined {
  const t = text.trim().toLowerCase();
  if (t === '?') return null;
  if (t === 'none') return [];
  const words = t
    .replace(/[–—]/g, '-')
    .replace(/\s*(?:-|\bto\b|through|thru)\s*/g, '-')
    .replace(/\b(months?|mos?|or|and)\b/g, ' ');
  if (/[^\d\s,/.-]/.test(words)) return undefined;
  const out = new Set<number>();
  const tokens = words.split(/[\s,/]+/).filter(Boolean);
  if (!tokens.length) return undefined;
  for (const tok of tokens) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(tok);
    if (!m) return undefined;
    const a = Number(m[1]);
    const b = m[2] === undefined ? a : Number(m[2]);
    if (a < 1 || b > 60 || b < a) return undefined;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

/** [9, 10, 11, 12, 15] → "9-12, 15": what the Lease terms box shows for a list of lengths. */
export function monthsText(months: readonly number[]): string {
  const sorted = [...new Set(months)].sort((a, b) => a - b);
  const out: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === (sorted[j] as number) + 1) j++;
    out.push(j - i >= 2 ? `${sorted[i]}-${sorted[j]}` : sorted.slice(i, j + 1).join(', '));
    i = j + 1;
  }
  return out.join(', ');
}
