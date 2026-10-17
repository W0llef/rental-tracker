import type { Place } from './types';
import { GeocodeError, METRO_BOX, METRO_CENTER, stateCode } from './types';

/**
 * Photon (komoot) search-as-you-type (PLAN.md §5.1). Built for autocomplete and free for
 * fair use; no key. Results are biased to downtown Minneapolis and limited to the metro.
 */

export const PHOTON_URL = 'https://photon.komoot.io/api/';

export function photonUrl(query: string, limit = 6): string {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    lang: 'en',
    lat: String(METRO_CENTER.lat),
    lon: String(METRO_CENTER.lng),
    bbox: METRO_BOX.join(','),
  });
  return `${PHOTON_URL}?${params.toString()}`;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_id?: number;
    osm_type?: string;
    type?: string;
    name?: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    city?: string;
    district?: string;
    locality?: string;
    state?: string;
    countrycode?: string;
  };
}

/** Turns Photon's GeoJSON answer into places with an address. */
export function readPhoton(json: unknown): Place[] {
  const features = (json as { features?: PhotonFeature[] } | null)?.features ?? [];
  const out: Place[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const [lng, lat] = f.geometry?.coordinates ?? [];
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (p.countrycode && p.countrycode.toUpperCase() !== 'US') continue;
    const street = p.street ?? (p.type === 'street' ? p.name : undefined);
    const line1 = p.housenumber && street ? `${p.housenumber} ${street}` : (street ?? p.name);
    if (!line1) continue;
    // A name that isn't just the street is a building or place name ("Riverlight").
    const name = p.name && p.name !== street && p.type !== 'street' ? p.name : null;
    const precision = p.housenumber ? 'address' : p.type === 'street' ? 'street' : 'approximate';
    const id = `photon:${p.osm_type ?? ''}${p.osm_id ?? `${lat},${lng}`}`;
    if (out.some((x) => x.id === id)) continue;
    out.push({
      id,
      name,
      address: {
        line1,
        city: p.city ?? null,
        state: stateCode(p.state),
        zip: p.postcode ?? null,
      },
      location: { lat, lng, source: 'photon', precision },
      neighborhood: p.locality ?? p.district ?? null,
    });
  }
  return out;
}

export async function photonSearch(
  query: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<Place[]> {
  let res: Response;
  try {
    res = await fetchFn(photonUrl(query), { signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new GeocodeError('Photon could not be reached');
  }
  if (!res.ok) throw new GeocodeError(`Photon answered ${res.status}`);
  return readPhoton(await res.json());
}
