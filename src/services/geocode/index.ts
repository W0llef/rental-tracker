import { db as appDb } from '../../db/db';
import type { RentalDB } from '../../db/db';
import { cacheGet, cacheKey, cachePut } from './cache';
import { nominatimSearch } from './nominatim';
import { photonSearch } from './photon';
import { rateLimit } from './rateLimit';
import type { Place } from './types';
import { GeocodeError } from './types';

export type { Place } from './types';
export { GeocodeError };

/**
 * Geocoding with no keys (PLAN.md §5.1):
 *  1. `suggest` while typing: Photon, cached; the caller debounces and cancels.
 *  2. `lookup` once on submit when no suggestion was picked: Nominatim, 1 per second, cached.
 *  3. Both throw GeocodeError when offline or failing; Quick-add then saves the unit
 *     without a location ("Needs location").
 */
export interface Geocoder {
  suggest(query: string, signal?: AbortSignal): Promise<Place[]>;
  lookup(query: string): Promise<Place | null>;
}

export const MIN_QUERY = 3;

export function createGeocoder(opts: {
  db: RentalDB;
  fetchFn?: typeof fetch;
  online?: () => boolean;
}): Geocoder {
  const fetchFn = opts.fetchFn ?? ((...args) => fetch(...args));
  const online =
    opts.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const nominatimQueue = rateLimit(1100);
  const offline = () => new GeocodeError('You’re offline');

  return {
    async suggest(query, signal) {
      const q = query.trim();
      if (q.length < MIN_QUERY) return [];
      const key = cacheKey('photon', q);
      const hit = await cacheGet<Place[]>(opts.db, key);
      if (hit) return hit;
      if (!online()) throw offline();
      const places = await photonSearch(q, fetchFn, signal);
      await cachePut(opts.db, key, places);
      return places;
    },
    async lookup(query) {
      const q = query.trim();
      if (q.length < MIN_QUERY) return null;
      const key = cacheKey('nominatim', q);
      const hit = await cacheGet<Place | null>(opts.db, key);
      if (hit !== undefined) return hit;
      if (!online()) throw offline();
      const place = await nominatimQueue(() => nominatimSearch(q, fetchFn));
      await cachePut(opts.db, key, place);
      return place;
    },
  };
}

let shared: Geocoder | null = null;

/** The app's geocoder (using the app's database for its cache). */
export function geocoder(): Geocoder {
  shared ??= createGeocoder({ db: appDb });
  return shared;
}
