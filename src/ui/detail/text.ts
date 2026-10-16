import { money, num, triLabel } from '../../domain/format';
import type { AmenityKey, Building, Link as LinkRecord } from '../../model';

/** Plain-text helpers for the detail panels (kept apart from components for fast refresh). */

export const AMENITY_LABELS: Record<AmenityKey, string> = {
  fitness: 'Fitness',
  pool: 'Pool',
  studyRooms: 'Study rooms',
  outdoorDeck: 'Outdoor deck',
  packageRoom: 'Package room',
  bikeStorage: 'Bike storage',
  evCharging: 'EV charging',
  guestSuites: 'Guest suites',
  petArea: 'Pet area',
  frontDesk: 'Front desk',
  skywayConnected: 'Skyway connected',
};

const allowed = (v: boolean | null, what: string) =>
  v === null ? `${what} unknown` : v ? `${what} allowed` : `No ${what.toLowerCase()}`;

/** "Cats allowed, dogs unknown, max 2 pets, $35/mo pet rent". */
export function petsText(p: Building['pets']): string | null {
  if (
    p.cats === null &&
    p.dogs === null &&
    !p.limits &&
    p.monthlyRent === null &&
    p.deposit === null &&
    p.oneTimeFee === null
  )
    return null;
  const parts = [`${allowed(p.cats, 'Cats')}, ${allowed(p.dogs, 'Dogs').toLowerCase()}`];
  if (p.limits) parts.push(p.limits);
  if (p.monthlyRent !== null) parts.push(`${money(p.monthlyRent)}/mo pet rent`);
  if (p.deposit !== null) parts.push(`${money(p.deposit)} pet deposit`);
  if (p.oneTimeFee !== null) parts.push(`${money(p.oneTimeFee)} one-time pet fee`);
  return parts.join(', ');
}

/** "High-rise, 24 floors, built 2019, renovated 2022". */
export function structureText(b: Building, typeLabel: string | null): string | null {
  const parts = [
    typeLabel,
    b.floors !== null ? `${num(b.floors)} floor${b.floors === 1 ? '' : 's'}` : null,
    b.yearBuilt !== null ? `built ${b.yearBuilt}` : null,
    b.yearRenovated !== null ? `renovated ${b.yearRenovated}` : null,
    b.elevator === null ? null : b.elevator ? 'elevator' : 'no elevator',
  ].filter(Boolean);
  if (!parts.length) return null;
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const tri = (v: boolean | null) => triLabel(v);

export interface ExternalLink {
  key: string;
  label: string;
  url: string;
}

/** Only http(s) links are made clickable; anything else would be unsafe or broken. */
export const isWebUrl = (url: string | null | undefined): url is string =>
  !!url && /^https?:\/\//i.test(url.trim());

export const fromLinkRecords = (links: readonly LinkRecord[]): ExternalLink[] =>
  links
    .filter((l) => isWebUrl(l.url))
    .map((l) => ({ key: l.id, label: l.label || l.url, url: l.url }));
