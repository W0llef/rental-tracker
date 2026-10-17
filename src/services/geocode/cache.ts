import type { RentalDB } from '../../db/db';

/**
 * Geocoder answers kept for 30 days in the `geocodeCache` table (PLAN.md §5.1), so typing
 * the same address again, or adding a second unit in a building, needs no network. The cache
 * isn't your data: it's not undoable and not in backups. Failures to read or write it are
 * ignored (the lookup just goes to the network).
 */

export const CACHE_DAYS = 30;

export async function cacheGet<T>(
  db: RentalDB,
  key: string,
  now = Date.now(),
): Promise<T | undefined> {
  try {
    const row = await db.geocodeCache.get(key);
    if (!row) return undefined;
    if (now - Date.parse(row.at) > CACHE_DAYS * 86_400_000) return undefined;
    return row.value as T;
  } catch {
    return undefined;
  }
}

export async function cachePut(db: RentalDB, key: string, value: unknown, now = Date.now()) {
  try {
    await db.geocodeCache.put({ key, at: new Date(now).toISOString(), value });
  } catch {
    // Full or blocked storage: the answer still works for this visit.
  }
}

/** Cache keys ignore case and spacing: "201 S Example St" = "201 s example st ". */
export const cacheKey = (service: string, query: string) =>
  `${service}:${query.trim().toLowerCase().replace(/\s+/g, ' ')}`;
