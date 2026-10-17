import type { GeoPoint } from '../../model';

/** A place a geocoder found: a street address, a street, or a named building. */
export interface Place {
  /** Stable within one geocoder ("photon:W123"). */
  id: string;
  /** The building's name when the place has one ("Riverlight"). */
  name: string | null;
  address: { line1: string; city: string | null; state: string | null; zip: string | null };
  location: GeoPoint;
  neighborhood: string | null;
}

/** "Minnesota" → "MN"; other states keep their name. */
export const stateCode = (s: string | null | undefined): string | null =>
  !s ? null : /^minnesota$/i.test(s) ? 'MN' : s.length === 2 ? s.toUpperCase() : s;

/** Twin Cities metro: [west, south, east, north]. Suggestions stay inside it. */
export const METRO_BOX = [-94.1, 44.55, -92.65, 45.45] as const;
/** Downtown Minneapolis, where suggestions are biased toward. */
export const METRO_CENTER = { lat: 44.9778, lng: -93.265 } as const;

/** Thrown when the network can't be reached or a geocoder answers with an error. */
export class GeocodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GeocodeError';
  }
}
