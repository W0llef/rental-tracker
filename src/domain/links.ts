import type { Building } from '../model';

/**
 * Links that open Google Maps (no key needed; Maps URLs API). The address opens the place;
 * Street View needs a location.
 */

const MAPS = 'https://www.google.com/maps';

/** Opens the building's address (or, failing that, its location) in Google Maps. */
export function googleMapsUrl(b: Pick<Building, 'address' | 'location'>): string | null {
  const query = b.address.formatted.trim() || b.address.line1.trim();
  if (query) return `${MAPS}/search/?api=1&query=${encodeURIComponent(query)}`;
  if (b.location) return `${MAPS}/search/?api=1&query=${b.location.lat},${b.location.lng}`;
  return null;
}

/** Street View at the building's location; null when it has no location yet. */
export function streetViewUrl(b: Pick<Building, 'location'>): string | null {
  if (!b.location) return null;
  const { lat, lng } = b.location;
  return `${MAPS}/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** The map links for a building, ready for a Links section. */
export function mapLinks(
  b: Pick<Building, 'address' | 'location'>,
): { key: string; label: string; url: string }[] {
  const out: { key: string; label: string; url: string }[] = [];
  const maps = googleMapsUrl(b);
  if (maps) out.push({ key: 'google-maps', label: 'Open in Google Maps', url: maps });
  const sv = streetViewUrl(b);
  if (sv) out.push({ key: 'street-view', label: 'Street View', url: sv });
  return out;
}
