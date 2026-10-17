import type { Address } from '../model';

/**
 * Address normalization for duplicate detection (PLAN.md §5.2). Pure.
 *
 *  - lowercase, punctuation stripped, spaces collapsed
 *  - USPS street suffixes and directionals abbreviated ("Avenue South" → "ave s")
 *  - "Apt/Unit/#/Ste …" moved out of the street part into a unit part
 *  - city names compared the same way ("Saint Paul" = "St. Paul", "Mpls" = "Minneapolis")
 *
 * The key is `street|city`; when either city is unknown, streets alone are compared
 * (`sameAddress`), so an address typed without a city still finds its building.
 */

const SUFFIXES: Record<string, string> = {
  alley: 'aly',
  avenue: 'ave',
  av: 'ave',
  boulevard: 'blvd',
  circle: 'cir',
  court: 'ct',
  crossing: 'xing',
  drive: 'dr',
  expressway: 'expy',
  freeway: 'fwy',
  highway: 'hwy',
  lane: 'ln',
  parkway: 'pkwy',
  place: 'pl',
  plaza: 'plz',
  point: 'pt',
  road: 'rd',
  square: 'sq',
  street: 'st',
  str: 'st',
  terrace: 'ter',
  trail: 'trl',
};

const DIRECTIONALS: Record<string, string> = {
  north: 'n',
  south: 's',
  east: 'e',
  west: 'w',
  northeast: 'ne',
  northwest: 'nw',
  southeast: 'se',
  southwest: 'sw',
};

/** Words that start the unit part of an address line. */
const UNIT_WORDS = 'apartment|apt|unit|suite|ste|no|number|rm|room|#';

const UNIT_PART = new RegExp(
  `(?:,\\s*|\\s+)(?:(?:${UNIT_WORDS})\\.?\\s*#?\\s*|#\\s*)([a-z0-9][a-z0-9-]*)\\s*$`,
  'i',
);

/** Splits "123 Main St Apt 4B" into the street and the unit ("4B"). */
export function splitUnit(line: string): { street: string; unit: string | null } {
  const trimmed = line.trim().replace(/\s+/g, ' ');
  const m = UNIT_PART.exec(trimmed);
  // Only when something address-like is left before it ("#5" alone isn't an address).
  if (m && m.index > 0 && /\d/.test(trimmed.slice(0, m.index))) {
    return { street: trimmed.slice(0, m.index).replace(/[,\s]+$/, ''), unit: m[1] ?? null };
  }
  return { street: trimmed, unit: null };
}

const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

/** "123 Example Avenue South, Apt 1504" → "123 example ave s". */
export function normalizeStreet(line: string): string {
  const parts = words(splitUnit(line).street);
  return parts
    .map((w, i) => {
      if (w === 'saint') return 'st';
      if (i === 0) return w; // the house number, or a first word that only looks like one
      return SUFFIXES[w] ?? DIRECTIONALS[w] ?? w;
    })
    .join(' ');
}

const CITY_ALIASES: Record<string, string> = {
  mpls: 'minneapolis',
  'st paul': 'st paul',
  stp: 'st paul',
};

/** "Saint Paul" → "st paul", "Mpls" → "minneapolis". */
export function normalizeCity(city: string | null | undefined): string {
  if (!city) return '';
  const w = words(city).map((x) => (x === 'saint' ? 'st' : x));
  const joined = w.join(' ');
  return CITY_ALIASES[joined] ?? joined;
}

/** The stored dedupe key: "123 example ave s|minneapolis". */
export function addressKey(line1: string, city: string | null): string {
  return `${normalizeStreet(line1)}|${normalizeCity(city)}`;
}

/** Same street address; cities must agree when both are known. */
export function sameAddress(
  a: Pick<Address, 'line1' | 'city'>,
  b: Pick<Address, 'line1' | 'city'>,
): boolean {
  const sa = normalizeStreet(a.line1);
  if (!sa || !/\d/.test(sa) || sa !== normalizeStreet(b.line1)) return false;
  const ca = normalizeCity(a.city);
  const cb = normalizeCity(b.city);
  return !ca || !cb || ca === cb;
}

/** Display form and dedupe key for an address. */
export function makeAddress(
  line1: string,
  city: string | null,
  state: string | null = 'MN',
  zip: string | null = null,
): Address {
  const l1 = line1.trim().replace(/\s+/g, ' ');
  const formatted = [l1, city, [state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return { line1: l1, city, state, zip, formatted, normalized: addressKey(l1, city) };
}

// ── Reading an address someone typed or pasted ─────────────────────────────

/** Twin Cities metro cities (lowercase), longest first so "st louis park" wins over "st". */
export const METRO_CITIES = [
  'minneapolis',
  'st paul',
  'saint paul',
  'st louis park',
  'golden valley',
  'brooklyn park',
  'brooklyn center',
  'bloomington',
  'richfield',
  'edina',
  'roseville',
  'falcon heights',
  'lauderdale',
  'columbia heights',
  'fridley',
  'new brighton',
  'st anthony',
  'west st paul',
  'south st paul',
  'mendota heights',
  'maplewood',
  'north st paul',
  'woodbury',
  'eagan',
  'burnsville',
  'apple valley',
  'lakeville',
  'eden prairie',
  'minnetonka',
  'hopkins',
  'plymouth',
  'maple grove',
  'crystal',
  'new hope',
  'robbinsdale',
  'shoreview',
  'arden hills',
  'white bear lake',
  'little canada',
  'vadnais heights',
  'inver grove heights',
  'coon rapids',
  'blaine',
  'wayzata',
  'stillwater',
].sort((a, b) => b.length - a.length);

export interface ParsedAddress {
  line1: string;
  unit: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

const titleCase = (s: string) =>
  s.replace(/\b([a-z])([a-z]*)/g, (_, a: string, b: string) => a.toUpperCase() + b);

/** "St Paul" spelled the way people write it. */
export function cityDisplay(city: string): string {
  const c = city.trim().replace(/\s+/g, ' ');
  if (/^(st\.?|saint)\s/i.test(c)) return titleCase(c.replace(/^(st\.?|saint)\s/i, 'St. '));
  return c === c.toLowerCase() || c === c.toUpperCase() ? titleCase(c.toLowerCase()) : c;
}

/**
 * Reads "201 S Example St, Apt 4, Minneapolis, MN 55401" or "201 S Example St Minneapolis
 * MN 55401" into parts. Returns null when the text doesn't start with a house number.
 */
export function parseAddress(text: string): ParsedAddress | null {
  let rest = text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/,?\s*(usa|united states)$/i, '');
  if (!/^\d+[a-z]?\b/i.test(rest)) return null;

  let zip: string | null = null;
  let state: string | null = null;
  const zipM = /[,\s]+(\d{5})(?:-\d{4})?$/.exec(rest);
  if (zipM) {
    zip = zipM[1] ?? null;
    rest = rest.slice(0, zipM.index);
  }
  const stateM = /[,\s]+(mn|minnesota)\.?$/i.exec(rest);
  if (stateM) {
    state = 'MN';
    rest = rest.slice(0, stateM.index);
  }

  let city: string | null = null;
  const comma = rest.split(',').map((p) => p.trim());
  if (comma.length > 1) {
    const last = comma[comma.length - 1] ?? '';
    // "…, Apt 4" as the last part is the unit, not a city.
    if (!/\d/.test(last)) {
      city = cityDisplay(last);
      comma.pop();
    }
    rest = comma.join(', ');
  } else {
    const lower = rest.toLowerCase().replace(/\./g, '');
    const found = METRO_CITIES.find((c) => lower.endsWith(` ${c}`));
    if (found) {
      // Cut by word count, since "St." and "st" differ in length.
      const n = found.split(' ').length;
      const ws = rest.split(' ');
      city = cityDisplay(ws.slice(-n).join(' '));
      rest = ws.slice(0, -n).join(' ');
    }
  }

  const { street, unit } = splitUnit(rest);
  if (!street) return null;
  return { line1: street, unit, city, state: state ?? (zip || city ? 'MN' : null), zip };
}
