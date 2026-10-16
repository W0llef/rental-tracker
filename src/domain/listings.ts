import type { ISODate, Listing, USD } from '../model';
import { daysBetween, money, shortDate } from './format';

/** Listing age and price history, derived from a unit's listings (never stored). */

/** Days since the unit was first seen on any listing; null when it has none. */
export function listingAgeDays(listings: readonly Listing[], today: ISODate): number | null {
  if (listings.length === 0) return null;
  const first = listings.reduce((min, l) => (l.firstSeen < min ? l.firstSeen : min), '9999-12-31');
  return Math.max(0, daysBetween(first, today));
}

export interface PricePoint {
  date: ISODate;
  rent: USD;
}

/**
 * Every price seen across the unit's listings, oldest first, keeping only the points where
 * the price changed (the same rent seen on two sites is one step).
 */
export function priceHistory(listings: readonly Listing[]): PricePoint[] {
  const all = listings
    .flatMap((l) => l.observations.map((o) => ({ date: o.date, rent: o.rent })))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const steps: PricePoint[] = [];
  for (const p of all) {
    const last = steps[steps.length - 1];
    if (last && last.rent === p.rent) continue;
    if (last && last.date === p.date) steps[steps.length - 1] = p;
    else steps.push(p);
  }
  return steps;
}

/** The latest and the previous price on one listing (for "$1,695 → $1,650"). */
export function listingPrices(l: Listing): { current: USD | null; previous: USD | null } {
  const obs = [...l.observations].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const current = obs[obs.length - 1]?.rent ?? null;
  let previous: USD | null = null;
  for (let i = obs.length - 2; i >= 0; i--) {
    const o = obs[i];
    if (o && o.rent !== current) {
      previous = o.rent;
      break;
    }
  }
  return { current, previous };
}

/** Describes the history in words, for the chart's accessible name. */
export function priceHistoryText(points: readonly PricePoint[], today: ISODate): string {
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return 'No prices seen yet';
  if (points.length === 1) return `${money(first.rent)} since ${shortDate(first.date, today)}`;
  const verb = last.rent < first.rent ? 'dropped' : last.rent > first.rent ? 'rose' : 'changed';
  return `Rent ${verb} from ${money(first.rent)} on ${shortDate(first.date, today)} to ${money(last.rent)} on ${shortDate(last.date, today)}`;
}
