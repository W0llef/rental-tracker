/**
 * Reading what's typed into form fields (DESIGN.md §4.3). Blank means unknown; "?" means
 * unknown too. Numbers may carry "$", commas and units ("$1,650", "720 sq ft"). Pure.
 */

export type Parsed<T> = { ok: true; value: T | null } | { ok: false; error: string };

const UNKNOWN = /^\s*\??\s*$/;

const ok = <T>(value: T | null): Parsed<T> => ({ ok: true, value });
const bad = <T>(error: string): Parsed<T> => ({ ok: false, error });

/** Strips "$", commas, spaces and trailing words like "sq ft", "/mo", "months". */
function numeric(text: string): string {
  return text
    .trim()
    .replace(/^\$\s*/, '')
    .replace(/,/g, '')
    .replace(
      /\s*(\/\s*mo(nth)?|per month|a month|sq\.?\s*ft\.?|ft²|sf|square feet|months?|mos?)$/i,
      '',
    )
    .trim();
}

/** A whole number from `min` to `max` (money, counts, years). */
export function parseWhole(text: string, opts: { min?: number; max?: number; what?: string } = {}) {
  const { min = 0, max = Number.MAX_SAFE_INTEGER, what = 'a whole number' } = opts;
  if (UNKNOWN.test(text)) return ok<number>(null);
  const t = numeric(text);
  if (!/^-?\d+(\.0+)?$/.test(t)) return bad<number>(`Enter ${what}, or ? for unknown.`);
  const n = Math.round(Number(t));
  if (n < min || n > max) return bad<number>(`Enter ${what} from ${min} to ${max}.`);
  return ok(n);
}

/** Dollars, whole (rent, fees). Cents are rounded. */
export function parseMoney(text: string, max = 100_000) {
  if (UNKNOWN.test(text)) return ok<number>(null);
  const t = numeric(text);
  if (!/^\d+(\.\d{1,2})?$/.test(t))
    return bad<number>('Enter an amount in dollars, or ? for unknown.');
  const n = Math.round(Number(t));
  if (n > max) return bad<number>(`That’s more than ${max.toLocaleString('en-US')} dollars.`);
  return ok(n);
}

/** A number in steps of `step` (bathrooms in halves; square feet whole). */
export function parseStep(text: string, step: number, opts: { max?: number; what: string }) {
  if (UNKNOWN.test(text)) return ok<number>(null);
  const t = numeric(text)
    .replace(/^(\d+)\s*1\/2$/, '$1.5')
    .replace(/^½$/, '0.5');
  if (!/^\d+(\.\d+)?$/.test(t)) return bad<number>(`Enter ${opts.what}, or ? for unknown.`);
  const n = Number(t);
  if (Math.abs(n / step - Math.round(n / step)) > 1e-9)
    return bad<number>(step === 0.5 ? `Use steps of 0.5 (like 1.5).` : `Enter ${opts.what}.`);
  if (opts.max !== undefined && n > opts.max) return bad<number>(`That’s more than ${opts.max}.`);
  return ok(n);
}

/** A floor number: whole, may be negative (garden level −1). */
export const parseFloor = (text: string) =>
  parseWhole(text, { min: -5, max: 200, what: 'a floor number' });

/** Plain text: trimmed, blank → unknown. */
export function parseText(text: string): Parsed<string> {
  const t = text.trim();
  return ok(t === '' || t === '?' ? null : t);
}

/** A year (1800 to next year + 5). */
export function parseYear(text: string, now = new Date()) {
  return parseWhole(text, { min: 1800, max: now.getFullYear() + 5, what: 'a year' });
}

/** "https://…" links; a bare domain gets https:// added. */
export function parseUrl(text: string): Parsed<string> {
  const t = text.trim();
  if (t === '' || t === '?') return ok(null);
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return bad('Enter a web address.');
    if (!u.hostname.includes('.')) return bad('Enter a web address, like example.com.');
    return ok(u.toString());
  } catch {
    return bad('Enter a web address, like example.com.');
  }
}

/** Number text for an input box: "" for unknown. */
export const numText = (n: number | null | undefined) =>
  n === null || n === undefined ? '' : String(n);
