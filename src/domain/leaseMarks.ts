import { leaseMark } from './cost';
import type { LeaseMarkInfo, UnitCost } from './cost';

/**
 * Which lease-length marks show, and where (Settings → Lease length marks, Q36). Display
 * choices, kept in this browser per database like pin choices, so they stay out of Undo and
 * backups and never change a cost.
 */

export type LeaseMarkKind = LeaseMarkInfo['kind'];
export type LeaseMarkPlace = 'cards' | 'map' | 'details';

export interface LeaseMarkPrefs {
  /** The master switch: off, no marks anywhere. */
  on: boolean;
  kinds: Record<LeaseMarkKind, boolean>;
  places: Record<LeaseMarkPlace, boolean>;
}

export const LEASE_MARK_KINDS: LeaseMarkKind[] = ['not-offered', 'unknown', 'empty'];
export const LEASE_MARK_PLACES: LeaseMarkPlace[] = ['cards', 'map', 'details'];

export function defaultLeaseMarkPrefs(): LeaseMarkPrefs {
  return {
    on: true,
    kinds: { 'not-offered': true, unknown: true, empty: true },
    places: { cards: true, map: true, details: true },
  };
}

/** Reads stored choices, keeping every valid part and defaulting the rest. */
export function parseLeaseMarkPrefs(raw: unknown): LeaseMarkPrefs {
  const d = defaultLeaseMarkPrefs();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as {
    on?: unknown;
    kinds?: Record<string, unknown>;
    places?: Record<string, unknown>;
  };
  const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    on: flag(r.on, d.on),
    kinds: Object.fromEntries(
      LEASE_MARK_KINDS.map((k) => [k, flag(r.kinds?.[k], d.kinds[k])]),
    ) as LeaseMarkPrefs['kinds'],
    places: Object.fromEntries(
      LEASE_MARK_PLACES.map((p) => [p, flag(r.places?.[p], d.places[p])]),
    ) as LeaseMarkPrefs['places'],
  };
}

/** The mark to show for a unit in one place, or null. */
export function shownLeaseMark(
  cost: Pick<UnitCost, 'termStatus' | 'wantedMonths' | 'leaseMonths' | 'offeredTerms'>,
  prefs: LeaseMarkPrefs,
  place: LeaseMarkPlace,
): LeaseMarkInfo | null {
  if (!prefs.on || !prefs.places[place]) return null;
  const mark = leaseMark(cost);
  return mark && prefs.kinds[mark.kind] ? mark : null;
}
