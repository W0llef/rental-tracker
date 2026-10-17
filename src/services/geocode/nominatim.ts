import type { Place } from './types';
import { GeocodeError, METRO_BOX, stateCode } from './types';

/**
 * Nominatim, used once when you add a unit without picking a suggestion (PLAN.md §5.1). Its
 * usage policy forbids autocomplete, so it's never called while typing, and calls are
 * spaced at least a second apart (rateLimit.ts). Browsers send the page as the referrer,
 * which identifies the app as the policy asks.
 */

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export function nominatimUrl(query: string): string {
  const [w, s, e, n] = METRO_BOX;
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '1',
    countrycodes: 'us',
    viewbox: [w, n, e, s].join(','),
    bounded: '1',
  });
  return `${NOMINATIM_URL}?${params.toString()}`;
}

interface NominatimResult {
  place_id?: number;
  lat?: string;
  lon?: string;
  name?: string;
  type?: string;
  addresstype?: string;
  address?: Record<string, string | undefined>;
}

export function readNominatim(json: unknown): Place | null {
  const r = (Array.isArray(json) ? json[0] : null) as NominatimResult | null;
  if (!r) return null;
  const lat = Number(r.lat);
  const lng = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const a = r.address ?? {};
  const street = a.road ?? a.pedestrian ?? a.footway;
  const line1 = a.house_number && street ? `${a.house_number} ${street}` : (street ?? r.name);
  if (!line1) return null;
  const name = r.name && r.name !== street && r.name !== line1 ? r.name : null;
  return {
    id: `nominatim:${r.place_id ?? `${lat},${lng}`}`,
    name,
    address: {
      line1,
      city: a.city ?? a.town ?? a.village ?? a.municipality ?? null,
      state: stateCode(a.state),
      zip: a.postcode ?? null,
    },
    location: {
      lat,
      lng,
      source: 'nominatim',
      precision: a.house_number ? 'address' : street ? 'street' : 'approximate',
    },
    neighborhood: a.neighbourhood ?? a.quarter ?? a.suburb ?? null,
  };
}

export async function nominatimSearch(query: string, fetchFn: typeof fetch): Promise<Place | null> {
  let res: Response;
  try {
    res = await fetchFn(nominatimUrl(query), { headers: { Accept: 'application/json' } });
  } catch {
    throw new GeocodeError('Nominatim could not be reached');
  }
  if (!res.ok) throw new GeocodeError(`Nominatim answered ${res.status}`);
  return readNominatim(await res.json());
}
