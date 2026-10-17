import type { Building, GeoPoint, Listing, Unit } from '../model';
import { sameAddress } from './address';
import { buildingName } from './format';
import { distanceMeters } from './geo';
import { canonicalUrl } from './listingUrl';
import { unitKeyOf } from './unitKey';

/**
 * Duplicate matching on add (PLAN.md §5.2). Pure.
 *
 *  - Same building: same normalized street address, or within 25 m with a similar name.
 *  - Same unit: same listing link, or same building and same unit number.
 *  - Floor plans are only ever suggested (same building, same plan name), never matched.
 */

export const NEARBY_METERS = 25;

const NAME_NOISE = new Set([
  'the',
  'apartments',
  'apartment',
  'apts',
  'apt',
  'at',
  'on',
  'of',
  'residences',
  'flats',
  'lofts',
  'homes',
  'and',
]);

const nameWords = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !NAME_NOISE.has(w));

/** "The Larch Apartments" ≈ "Larch"; "Riverlight" ≈ "Riverlight Lofts". */
export function similarName(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const wa = nameWords(a);
  const wb = nameWords(b);
  if (!wa.length || !wb.length) return false;
  const ja = wa.join(' ');
  const jb = wb.join(' ');
  if (ja === jb || ja.includes(jb) || jb.includes(ja)) return true;
  const sa = new Set(wa);
  const shared = wb.filter((w) => sa.has(w)).length;
  return shared / Math.max(wa.length, wb.length) >= 0.5;
}

export interface BuildingCandidate {
  address: { line1: string; city: string | null };
  location: Pick<GeoPoint, 'lat' | 'lng'> | null;
  name: string | null;
}

export interface BuildingMatch {
  building: Building;
  reason: 'address' | 'nearby';
}

/** The building in your list this one probably is, if any. */
export function matchBuilding(
  buildings: readonly Building[],
  c: BuildingCandidate,
): BuildingMatch | null {
  const live = buildings.filter((b) => !b.deletedAt);
  if (c.address.line1.trim()) {
    const same = live.find((b) => sameAddress(b.address, c.address));
    if (same) return { building: same, reason: 'address' };
  }
  if (c.location && c.name) {
    const near = live
      .filter((b) => b.location && distanceMeters(b.location, c.location!) <= NEARBY_METERS)
      .find((b) => similarName(buildingName(b), c.name) || similarName(b.complexName, c.name));
    if (near) return { building: near, reason: 'nearby' };
  }
  return null;
}

export interface UnitMatch {
  unit: Unit;
  reason: 'url' | 'unit-number' | 'floor-plan';
  /** The listing with the same link, when the match is by link. */
  listing: Listing | null;
}

export interface UnitCandidate {
  buildingId: string | null;
  unitNumber: string | null;
  floorPlanName: string | null;
  isFloorPlanOnly: boolean;
  url: string | null;
}

/**
 * The unit in your list this one probably is. A link match wins over a unit-number match;
 * floor plans are only a suggestion (reason "floor-plan").
 */
export function matchUnit(
  units: readonly Unit[],
  listings: readonly Listing[],
  c: UnitCandidate,
): UnitMatch | null {
  const live = new Map(units.filter((u) => !u.deletedAt).map((u) => [u.id, u]));
  const key = canonicalUrl(c.url);
  if (key) {
    for (const l of listings) {
      if (l.deletedAt || canonicalUrl(l.url) !== key) continue;
      const u = live.get(l.unitId);
      if (u) return { unit: u, reason: 'url', listing: l };
    }
  }
  if (!c.buildingId) return null;
  const inBuilding = [...live.values()].filter((u) => u.buildingId === c.buildingId);
  const unitKey = c.isFloorPlanOnly ? null : unitKeyOf(c.unitNumber);
  if (unitKey) {
    const same = inBuilding.find((u) => u.unitKey === unitKey);
    if (same) return { unit: same, reason: 'unit-number', listing: null };
  }
  const plan = c.floorPlanName?.trim().toLowerCase();
  if (c.isFloorPlanOnly && plan) {
    const same = inBuilding.find(
      (u) => u.isFloorPlanOnly && u.floorPlanName?.trim().toLowerCase() === plan,
    );
    if (same) return { unit: same, reason: 'floor-plan', listing: null };
  }
  return null;
}
