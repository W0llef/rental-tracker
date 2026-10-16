import type { Building, NoteEntry, Unit } from '../model';

/**
 * Text search (FilterSpec.text). Every word typed must appear somewhere in the unit's
 * searchable text: its number or plan, its building's name, address and neighborhood,
 * its own notes and the building's. Case, accents and punctuation are ignored.
 * The full filter panel arrives in M9 and adds its clauses here.
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
