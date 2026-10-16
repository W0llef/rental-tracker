import type {
  Building,
  LabelColor,
  MapPrefs,
  PinContent,
  Unit,
  UnitStatus,
  UnitType,
} from '../model';
import { LABEL_COLORS, UNIT_STATUSES } from '../model';
import { sortBy } from './sort';
import {
  STATUS_COLOR_VAR,
  STATUS_LABELS,
  UNIT_TYPE_LABELS,
  bedsLabel,
  buildingName,
  money,
  num,
  unitTitle,
} from './format';

/**
 * What a map pin shows and how it's colored (PLAN.md §4.3, DESIGN.md §2.4). Pure: the map
 * component only turns these values into markup.
 */

// ── Which "Pins show" options work yet ─────────────────────────────────────

/**
 * Total cost and cost per ft² need the cost profile (M8); travel time needs destinations
 * (Phase 2). Until then their chips are disabled and pins fall back to rent, the same rule
 * the list follows (PLAN.md §12, M2).
 */
export const PIN_SHOW_PENDING: Partial<Record<PinContent, string>> = {
  total: 'M8',
  psf: 'M8',
  travel: 'Phase 2',
};

export const PIN_SHOW_LABELS: Record<PinContent, string> = {
  total: 'Total cost',
  rent: 'Rent',
  psf: 'Cost per ft²',
  photo: 'Photo',
  type: 'Unit type',
  beds: 'Beds and size',
  rating: 'Rating',
  unit: 'Unit number',
  dot: 'Dot only',
  travel: 'Travel time',
};

/** The option pins actually use: a pending option falls back to rent. */
export function effectivePinShow(show: PinContent): PinContent {
  return PIN_SHOW_PENDING[show] ? 'rent' : show;
}

export type ColorBy = MapPrefs['pins']['colorBy'];

/** The price color option scales on rent until total cost exists (M8). */
export const PRICE_COLOR_LABEL = 'Rent';

// ── Units on pins ──────────────────────────────────────────────────────────

export interface PinUnit {
  unit: Unit;
  building: Building | undefined;
}

export const isRejected = (u: Pick<Unit, 'flag'>): boolean => u.flag === 'reject';
export const isNew = (u: Pick<Unit, 'status'>): boolean => u.status === 'new';

const rentValue = (r: PinUnit) => r.unit.rent;
const tiebreak = (r: PinUnit) => r.unit.id;

/**
 * The unit a grouped building pin shows: the cheapest one that isn't rejected (unknown
 * rents last); if every unit is rejected, the cheapest of them.
 */
export function leadUnit<T extends PinUnit>(units: readonly T[]): T | undefined {
  const live = units.filter((u) => !isRejected(u.unit));
  return sortBy(live.length ? live : units, rentValue, 'asc', tiebreak)[0];
}

/** Units of one building in fan-out order: cheapest first, rejected last. */
export function fanOrder<T extends PinUnit>(units: readonly T[]): T[] {
  const sorted = sortBy(units, rentValue, 'asc', tiebreak);
  return [
    ...sorted.filter((u) => !isRejected(u.unit)),
    ...sorted.filter((u) => isRejected(u.unit)),
  ];
}

export const starText = (rating: number): string => (rating > 0 ? `★${rating}` : '☆');

/** "$1,650", "from $2,560"; "?" when unknown. */
function rentText(u: Unit): string {
  if (u.rent === null) return '?';
  return `${u.rentIsFrom ? 'from ' : ''}${money(u.rent)}`;
}

/** "1 bd 720 ft²", "Studio 480 ft²", with "?" for an unknown part. */
export function bedsSizeText(u: Pick<Unit, 'bedrooms' | 'squareFeet'>): string {
  const beds = u.bedrooms === null ? '? bd' : bedsLabel(u.bedrooms);
  const size = u.squareFeet === null ? '? ft²' : `${num(u.squareFeet)} ft²`;
  return `${beds} ${size}`;
}

/**
 * The text on a unit pin for an option; null for options that show no text (photo, unit
 * type, dot). A grouped pin adds "+" to prices and shows the building name for "Unit number".
 */
export function pinText(row: PinUnit, show: PinContent, grouped: boolean): string | null {
  const u = row.unit;
  switch (effectivePinShow(show)) {
    case 'rent': {
      const t = rentText(u);
      return grouped && u.rent !== null ? `${t}+` : t;
    }
    case 'beds':
      return bedsSizeText(u);
    case 'rating':
      return starText(u.rating);
    case 'unit':
      if (grouped && row.building) return buildingName(row.building);
      return (
        u.unitNumber ?? u.floorPlanName ?? (row.building ? buildingName(row.building) : 'Unit')
      );
    default:
      return null;
  }
}

/** Spoken name of a unit pin: "Riverlight, Unit 1504, $1,650 rent, Shortlisted". */
export function unitPinLabel(row: PinUnit): string {
  const u = row.unit;
  const parts = [
    row.building ? buildingName(row.building) : null,
    unitTitle(u, row.building),
    u.rent === null ? 'rent unknown' : `${rentText(u)} rent`,
    STATUS_LABELS[u.status],
    isRejected(u) ? 'rejected' : null,
  ];
  // A unit with no number is titled with the building's name; don't say it twice.
  return [...new Set(parts.filter((p): p is string => p !== null))].join(', ');
}

/** Spoken name of a grouped pin: "3 units at Riverlight, from $1,575". */
export function groupPinLabel(building: Building | undefined, units: readonly PinUnit[]): string {
  const name = building ? buildingName(building) : 'this building';
  const lead = leadUnit(units);
  const price = lead && lead.unit.rent !== null ? `, from ${money(lead.unit.rent)}` : '';
  return `${units.length} units at ${name}${price}`;
}

/** Text on a Buildings-view pin: the rent range of its units. */
export function buildingRangeText(units: readonly PinUnit[]): string {
  const rents = units.map((u) => u.unit.rent).filter((r): r is number => r !== null);
  if (!rents.length) return '?';
  const lo = Math.min(...rents);
  const hi = Math.max(...rents);
  return lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`;
}

export function typeLabel(type: UnitType | null): string {
  return type === null ? 'Type unknown' : UNIT_TYPE_LABELS[type];
}

// ── Pin color ──────────────────────────────────────────────────────────────

/** Five-step blue scale from your cheapest to your priciest unit (DESIGN.md §2.4). */
export const PRICE_STEPS = ['#BCD2F0', '#8CB0E6', '#5C8DD8', '#2F67C0', '#1A458C'] as const;

export const LABEL_COLOR_VAR: Record<LabelColor, string> = {
  red: '--lb-red',
  yellow: '--lb-yellow',
  green: '--lb-green',
  blue: '--lb-blue',
  purple: '--lb-purple',
};

export interface PriceScale {
  min: number;
  max: number;
}

/**
 * The range the price colors span: known rents of the units on the map, leaving out
 * rejected ones (unless every unit is rejected). Null when no rent is known.
 */
export function priceScale(units: readonly Pick<Unit, 'rent' | 'flag'>[]): PriceScale | null {
  const live = units.filter((u) => !isRejected(u));
  const rents = (live.length ? live : units)
    .map((u) => u.rent)
    .filter((r): r is number => r !== null);
  if (!rents.length) return null;
  return { min: Math.min(...rents), max: Math.max(...rents) };
}

/** Step 0–4 of a value on the scale; values outside the range clamp to the ends. */
export function priceStep(value: number, scale: PriceScale): number {
  const span = scale.max - scale.min + 1;
  const step = Math.floor(((value - scale.min) / span) * PRICE_STEPS.length);
  return Math.max(0, Math.min(PRICE_STEPS.length - 1, step));
}

/** CSS color for a unit pin's edge. */
export function edgeColor(u: Unit, colorBy: ColorBy, scale: PriceScale | null): string {
  if (colorBy === 'status') return `var(${STATUS_COLOR_VAR[u.status]})`;
  if (colorBy === 'label')
    return u.colorLabel ? `var(${LABEL_COLOR_VAR[u.colorLabel]})` : 'var(--ice)';
  if (u.rent === null || !scale) return 'var(--ice)';
  return PRICE_STEPS[priceStep(u.rent, scale)] as string;
}

// ── Legend ────────────────────────────────────────────────────────────────

export type Legend =
  | { kind: 'status'; title: string; rows: { status: UnitStatus; label: string; color: string }[] }
  | { kind: 'label'; title: string; rows: { label: string; color: string }[] }
  | { kind: 'price'; title: string; steps: readonly string[]; min: string; max: string }
  | { kind: 'price-empty'; title: string; text: string };

/**
 * What the legend in the map corner says (DESIGN.md §2.4): only the colors on the map,
 * named. Label names come from Settings.
 */
export function legendFor(
  units: readonly Unit[],
  colorBy: ColorBy,
  labelNames: Record<LabelColor, string>,
): Legend {
  if (colorBy === 'status') {
    const present = new Set(units.map((u) => u.status));
    return {
      kind: 'status',
      title: 'Pin color: status',
      rows: UNIT_STATUSES.filter((s) => present.has(s)).map((s) => ({
        status: s,
        label: STATUS_LABELS[s],
        color: `var(${STATUS_COLOR_VAR[s]})`,
      })),
    };
  }
  if (colorBy === 'label') {
    const present = new Set(units.map((u) => u.colorLabel));
    const rows = LABEL_COLORS.filter((c) => present.has(c)).map((c) => ({
      label: labelNames[c] ?? c,
      color: `var(${LABEL_COLOR_VAR[c]})`,
    }));
    if (present.has(null) || !rows.length) rows.push({ label: 'No label', color: 'var(--ice)' });
    return { kind: 'label', title: 'Pin color: label', rows };
  }
  const title = `Pin color: ${PRICE_COLOR_LABEL.toLowerCase()}`;
  const scale = priceScale(units);
  if (!scale) return { kind: 'price-empty', title, text: 'No rents known yet' };
  return {
    kind: 'price',
    title,
    steps: PRICE_STEPS,
    min: money(scale.min),
    max: money(scale.max),
  };
}
