import type { Building, NoteEntry, Unit } from '../model';
import type { UnitCost } from './cost';

/**
 * Text search (FilterSpec.text). Every word typed must appear somewhere in the unit's
 * searchable text: its number or plan, its building's name, address and neighborhood,
 * its own notes and the building's. Case, accents and punctuation are ignored.
 * The full filter panel arrives in M10 and adds its clauses here.
 */

/** Lowercase, accents removed, punctuation turned into spaces, single-spaced. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The words of a query; empty when there's nothing to search for. */
export const queryWords = (query: string): string[] =>
  normalizeText(query).split(' ').filter(Boolean);

/** True when every query word is found in the haystack (a normalized string). */
export function matchesWords(haystack: string, words: readonly string[]): boolean {
  return words.every((w) => haystack.includes(w));
}

export function buildingSearchText(b: Building, notes: readonly NoteEntry[] = []): string {
  return normalizeText(
    [
      b.name,
      b.complexName,
      b.address.formatted,
      b.address.line1,
      b.address.zip,
      b.neighborhood?.name,
      b.managementCompany,
      b.notes,
      ...notes.map((n) => n.text),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

export function unitSearchText(u: Unit, notes: readonly NoteEntry[] = []): string {
  return normalizeText(
    [
      u.unitNumber && `unit ${u.unitNumber}`,
      u.unitKey,
      u.floorPlanName,
      u.isFloorPlanOnly ? 'floor plan' : null,
      u.viewNotes,
      u.layoutNotes,
      u.moveInSpecial?.text,
      ...notes.map((n) => n.text),
    ]
      .filter(Boolean)
      .join(' '),
  );
}

// ── Cost limits (M9) ───────────────────────────────────────────────────────

/**
 * "Total up to $X", "per ft² up to $Y" above the list (M9). The same shape as the
 * FilterSpec ranges `totalMonthly` and `pricePerSqft` (PLAN.md §3.5), which M10's filter
 * panel takes over. A unit whose value is unknown passes only with `includeUnknown`.
 */
export interface CostLimits {
  maxTotal: number | null;
  maxPerSqft: number | null;
  includeUnknown: boolean;
  /** Only units that list the lease length you'd sign there; unknown terms are left out too. */
  offeredLeaseOnly: boolean;
}

export const NO_COST_LIMITS: CostLimits = {
  maxTotal: null,
  maxPerSqft: null,
  includeUnknown: true,
  offeredLeaseOnly: false,
};

export const costLimitsActive = (l: CostLimits): boolean =>
  l.maxTotal !== null || l.maxPerSqft !== null || l.offeredLeaseOnly;

function withinMax(value: number | null, max: number | null, includeUnknown: boolean): boolean {
  if (max === null) return true;
  if (value === null) return includeUnknown;
  return value <= max;
}

export function costLimitsMatch(
  cost: Pick<UnitCost, 'total' | 'perSqft' | 'termStatus'>,
  l: CostLimits,
): boolean {
  if (l.offeredLeaseOnly && cost.termStatus !== 'offered') return false;
  return (
    withinMax(cost.total, l.maxTotal, l.includeUnknown) &&
    withinMax(cost.perSqft, l.maxPerSqft, l.includeUnknown)
  );
}
