/** Small geometry helpers (PLAN.md §1: no Turf in Phase 1). */

export interface LngLat {
  lng: number;
  lat: number;
}

/** [[west, south], [east, north]] around the points, or null when there are none. */
export function boundsOf(points: readonly LngLat[]): [[number, number], [number, number]] | null {
  if (!points.length) return null;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of points) {
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return [
    [w, s],
    [e, n],
  ];
}

/** Whether a point lies inside [[west, south], [east, north]]. */
export function contains(bounds: [[number, number], [number, number]], p: LngLat): boolean {
  const [[w, s], [e, n]] = bounds;
  return p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n;
}

/** Distance in metres between two points (haversine). */
export function distanceMeters(a: LngLat, b: LngLat): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Downtown Minneapolis: where the map opens before any unit has a location. */
export const DEFAULT_CENTER: LngLat = { lng: -93.265, lat: 44.9778 };
export const DEFAULT_ZOOM = 12;
