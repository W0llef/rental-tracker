import type {
  Building,
  BuildingType,
  Direction,
  ISODate,
  Settings,
  SiteKey,
  Unit,
  UnitStatus,
  UnitType,
  UtilityKey,
  UtilityTerm,
} from '../model';

/**
 * Display text for stored values (DESIGN.md §2.6 and §6): sentence case, numbers carry
 * their unit in the same run ("720 ft²", "$1,650"). Pure; no React, no I/O.
 */

const usdFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const numberFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

export const money = (n: number): string => usdFormat.format(n);
export const num = (n: number): string => numberFormat.format(n);

export const bedsLabel = (n: number): string => (n === 0 ? 'Studio' : `${num(n)} bd`);
export const bathsLabel = (n: number): string => `${num(n)} ba`;
export const sqftLabel = (n: number): string => `${num(n)} ft²`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jun 1" in the current year, "Jun 1, 2027" otherwise. Dates are calendar dates, no zone. */
export function shortDate(date: ISODate, today: ISODate): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const label = `${MONTHS[m - 1]} ${d}`;
  return date.slice(0, 4) === today.slice(0, 4) ? label : `${label}, ${y}`;
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: ISODate, to: ISODate): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** "listed today", "listed 1 day", "listed 17 days". */
export function listingAgeLabel(days: number): string {
  if (days <= 0) return 'listed today';
  return `listed ${days} day${days === 1 ? '' : 's'}`;
}

/** Local calendar date (YYYY-MM-DD) of a moment, for "today". */
export function localDate(d: Date = new Date()): ISODate {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const STATUS_LABELS: Record<UnitStatus, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  shortlisted: 'Shortlisted',
  'tour-scheduled': 'Tour scheduled',
  toured: 'Toured',
  applied: 'Applied',
  approved: 'Approved',
  leased: 'Leased',
  declined: 'Declined',
  'off-market': 'Off market',
};

/** CSS custom property holding each status color (src/styles/tokens.css). */
export const STATUS_COLOR_VAR: Record<UnitStatus, string> = {
  new: '--st-new',
  reviewing: '--st-reviewing',
  shortlisted: '--st-shortlisted',
  'tour-scheduled': '--st-tour',
  toured: '--st-toured',
  applied: '--st-applied',
  approved: '--st-approved',
  leased: '--st-leased',
  declined: '--st-declined',
  'off-market': '--st-off',
};

export const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  apartment: 'Apartment',
  condo: 'Condo',
  townhome: 'Townhome',
  house: 'House',
  room: 'Room',
};

export const BUILDING_TYPE_LABELS: Record<BuildingType, string> = {
  'high-rise': 'High-rise',
  'mid-rise': 'Mid-rise',
  'walk-up': 'Walk-up',
  house: 'House',
  'townhome-row': 'Townhome row',
};

export const SITE_LABELS: Record<SiteKey, string> = {
  zillow: 'Zillow',
  'apartments-com': 'Apartments.com',
  hotpads: 'HotPads',
  trulia: 'Trulia',
  craigslist: 'Craigslist',
  facebook: 'Facebook',
  'rent-com': 'Rent.com',
  padmapper: 'PadMapper',
  'building-site': 'Building website',
  other: 'Other site',
};

export const UTILITY_LABELS: Record<UtilityKey, string> = {
  heat: 'Heat',
  electric: 'Electric',
  waterSewer: 'Water and sewer',
  trash: 'Trash',
  gas: 'Gas',
  internet: 'Internet',
};

export const DIRECTION_NAMES: Record<Direction, string> = {
  N: 'north',
  NE: 'northeast',
  E: 'east',
  SE: 'southeast',
  S: 'south',
  SW: 'southwest',
  W: 'west',
  NW: 'northwest',
};

/** Stored enum values like "in-unit" or "floor-to-ceiling" → "In unit", "Floor to ceiling". */
export function enumLabel(value: string): string {
  const words = value.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export const triLabel = (v: boolean | null): string | null =>
  v === null ? null : v ? 'Yes' : 'No';

/** "Included", "Extra, $55/mo", "You pay, est. $45/mo", "You pay"; null when unknown. */
export function utilityLabel(term: UtilityTerm | null): string | null {
  if (!term) return null;
  switch (term.mode) {
    case 'included':
      return 'Included';
    case 'extra':
      return term.amount === null ? 'Billed extra' : `Billed extra, ${money(term.amount)}/mo`;
    case 'tenant-paid':
      return term.estimate === null ? 'You pay' : `You pay, est. ${money(term.estimate)}/mo`;
  }
}

/** Building's display name: its name, else the complex, else the street address. */
export function buildingName(b: Pick<Building, 'name' | 'complexName' | 'address'>): string {
  return b.name ?? b.complexName ?? b.address.line1;
}

/**
 * A unit's title: "Unit 1504"; a floor plan's name ("Plan C"); otherwise, for a whole house
 * or an unnumbered unit, the building's display name.
 */
export function unitTitle(
  u: Pick<Unit, 'unitNumber' | 'isFloorPlanOnly' | 'floorPlanName'>,
  b: Pick<Building, 'name' | 'complexName' | 'address'> | undefined,
): string {
  if (u.unitNumber) return `Unit ${u.unitNumber}`;
  if (u.isFloorPlanOnly) return u.floorPlanName ?? 'Floor plan';
  return b ? buildingName(b) : 'Unit';
}

/** "$1,650", "from $2,560", or null when the rent is unknown. */
export function rentLabel(u: Pick<Unit, 'rent' | 'rentIsFrom'>): string | null {
  if (u.rent === null) return null;
  return u.rentIsFrom ? `from ${money(u.rent)}` : money(u.rent);
}

/** "12 or 15 months", "12 months"; null when unknown, "None listed" when empty. */
export function leaseTermsLabel(months: number[] | null): string | null {
  if (months === null) return null;
  if (months.length === 0) return 'None listed';
  const sorted = [...months].sort((a, b) => a - b);
  const list =
    sorted.length === 1
      ? String(sorted[0])
      : `${sorted.slice(0, -1).join(', ')} or ${sorted[sorted.length - 1]}`;
  return `${list} month${sorted.length === 1 && sorted[0] === 1 ? '' : 's'}`;
}

/** "$1,650–$2,560", "$1,650", or null when no unit has a known rent. */
export function rangeLabel(min: number | null, max: number | null): string | null {
  if (min === null || max === null) return null;
  return min === max ? money(min) : `${money(min)}–${money(max)}`;
}

/** Names of a unit's reject reasons, joined: "Too far, No laundry". */
export function rejectReasonText(
  ids: readonly string[],
  settings: Pick<Settings, 'rejectReasons'>,
): string {
  return ids
    .map((id) => settings.rejectReasons.find((r) => r.id === id)?.label)
    .filter(Boolean)
    .join(', ');
}

/** "Faces south and west" for the compass's accessible name. */
export function facingText(dirs: readonly Direction[]): string {
  const names = dirs.map((d) => DIRECTION_NAMES[d]);
  if (names.length <= 1) return `Faces ${names[0] ?? 'an unknown direction'}`;
  return `Faces ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
