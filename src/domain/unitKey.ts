/**
 * Normalized unit number, stored as `unitKey` and indexed with the building id for
 * duplicate checks: "Apt 1504", "#1504" and "unit 1504" all become "1504".
 * Full address normalization arrives with duplicate detection (M4, domain/address.ts).
 */
export function unitKeyOf(unitNumber: string | null | undefined): string | null {
  if (!unitNumber) return null;
  const key = unitNumber
    .toLowerCase()
    .trim()
    .replace(/^(?:(?:apartment|apt|unit|suite|ste|no|number)(?=[\s.#\d])\.?\s*#?|#)\s*/u, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
  return key === '' ? null : key;
}
