import type { Building, LabelColor, Unit, UnitStatus, UnitType } from '../model';
import { LABEL_COLORS, UNIT_STATUSES } from '../model';
import {
  STATUS_COLOR_VAR,
  STATUS_LABELS,
  bedsLabel,
  buildingName,
  money,
  num,
  unitTitle,
} from './format';
import type { ColorBy, PinField, PinPrefs, RejectedMode } from './pinPrefs';
import { activeFields } from './pinPrefs';
import { sortBy } from './sort';

/**
 * What a map pin shows and how it's colored (PLAN.md §4.3, DESIGN.md §2.4). Pure: the map
 * component only turns these values into markup.
 *
 * A building with several units, when collapsed (and every pin in the Buildings view),
 * shows only what's true of all of its units: ranges for numbers, the type icon only if
 * they share a type, one edge stripe per unit, and the New badge if any unit is new.
 */

/** The price color option scales on rent until total cost exists (M8). */
export const PRICE_COLOR_LABEL = 'Rent';

export interface PinUnit {
  unit: Unit;
  building: Building | undefined;
}

export const isRejected = (u: Pick<Unit, 'flag'>): boolean => u.flag === 'reject';
export const isNew = (u: Pick<Unit, 'status'>): boolean => u.status === 'new';

const rentValue = (r: PinUnit) => r.unit.rent;
const tiebreak = (r: PinUnit) => r.unit.id;

/** Units of one building in fan-out order: cheapest first, rejected last. */
export function fanOrder<T extends PinUnit>(units: readonly T[]): T[] {
  const sorted = sortBy(units, rentValue, 'asc', tiebreak);
  return [
    ...sorted.filter((u) => !isRejected(u.unit)),
    ...sorted.filter((u) => isRejected(u.unit)),
  ];
}

/** Lowest known rent among the units, for ranking pins; Infinity when none is known. */
export function lowestRent(units: readonly PinUnit[]): number {
  const rents = units.map((u) => u.unit.rent).filter((r): r is number => r !== null);
  return rents.length ? Math.min(...rents) : Infinity;
}

// ── Rejected units ─────────────────────────────────────────────────────────

/**
 * The units a building's pin stands for. "Hide" drops rejected units from the map
 * (a selected one always stays); "Fade" and "Hide" leave them out of a group's ranges and
 * stripes unless every unit is rejected; "Show" counts them like any other.
 */
export function pinnedUnits<T extends PinUnit>(
  units: readonly T[],
  mode: RejectedMode,
  selectedUnitId: string | null = null,
): T[] {
  if (mode !== 'hide') return [...units];
  return units.filter((u) => !isRejected(u.unit) || u.unit.id === selectedUnitId);
}

export function summarizedUnits<T extends PinUnit>(units: readonly T[], mode: RejectedMode): T[] {
  if (mode === 'show') return [...units];
  const live = units.filter((u) => !isRejected(u.unit));
  return live.length ? live : [...units];
}

/** Every unit counted is rejected: the pin gets the rejected look. */
export const allRejected = (units: readonly PinUnit[]): boolean =>
  units.length > 0 && units.every((u) => isRejected(u.unit));

// ── Text segments ──────────────────────────────────────────────────────────

export const starText = (rating: number): string => (rating > 0 ? `★${rating}` : '☆');

/** "1 bd · 720 ft²", "Studio · 480 ft²", with "?" for an unknown part. */
export function bedsSizeText(u: Pick<Unit, 'bedrooms' | 'squareFeet'>): string {
  const beds = u.bedrooms === null ? '? bd' : bedsLabel(u.bedrooms);
  const size = u.squareFeet === null ? '? ft²' : `${num(u.squareFeet)} ft²`;
  return `${beds}\u00a0·\u00a0${size}`;
}

function range<T>(values: readonly T[], fmt: (v: T) => string, byNumber: (v: T) => number): string {
  const sorted = [...values].sort((a, b) => byNumber(a) - byNumber(b));
  const lo = sorted[0] as T;
  const hi = sorted[sorted.length - 1] as T;
  return byNumber(lo) === byNumber(hi) ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
}

const known = (values: readonly (number | null)[]): number[] =>
  values.filter((v): v is number => v !== null);

export interface Segment {
  field: Exclude<PinField, 'type'>;
  text: string;
}

export interface PinContent {
  /** Unit-type icon to draw first, or null (field off, or the units differ). */
  typeIcon: UnitType | null;
  segments: Segment[];
}

/**
 * What a pin prints, field by field. `asBuilding` is true for a collapsed group and for
 * every Buildings-view pin: numbers become ranges and "unit" becomes the building's name.
 */
export function pinContent(
  units: readonly PinUnit[],
  prefs: Pick<PinPrefs, 'style' | 'fields' | 'priceMode'>,
  asBuilding: boolean,
): PinContent {
  const fields = activeFields(prefs);
  const first = units[0];
  if (!first) return { typeIcon: null, segments: [] };
  const many = asBuilding && units.length > 1;
  const types = new Set(units.map((u) => u.unit.type));
  const typeIcon = fields.includes('type') && types.size === 1 ? first.unit.type : null;

  const segments: Segment[] = [];
  for (const field of fields) {
    switch (field) {
      case 'rent': {
        const rents = known(units.map((u) => u.unit.rent));
        let text: string;
        if (!rents.length) text = '?';
        else if (!many)
          text = `${first.unit.rentIsFrom ? 'from ' : ''}${money(first.unit.rent as number)}`;
        else if (prefs.priceMode === 'lowest') text = `${money(Math.min(...rents))}+`;
        else text = range(rents, money, (n) => n);
        segments.push({ field, text });
        break;
      }
      case 'beds': {
        if (!many) {
          segments.push({ field, text: bedsSizeText(first.unit) });
          break;
        }
        const beds = known(units.map((u) => u.unit.bedrooms));
        const sizes = known(units.map((u) => u.unit.squareFeet));
        const b = beds.length ? range(beds, bedsLabel, (n) => n) : '? bd';
        const s = sizes.length ? `${range(sizes, num, (n) => n)} ft²` : '? ft²';
        segments.push({ field, text: `${b}\u00a0·\u00a0${s}` });
        break;
      }
      case 'unit': {
        const name = first.building ? buildingName(first.building) : 'Unit';
        const text = asBuilding
          ? name
          : (first.unit.unitNumber ?? first.unit.floorPlanName ?? name);
        segments.push({ field, text });
        break;
      }
      case 'rating': {
        const rated = units.map((u) => u.unit.rating as number).filter((r) => r > 0);
        const text = !rated.length
          ? '☆'
          : many
            ? `★${range(rated, String, (n) => n)}`
            : starText(first.unit.rating);
        segments.push({ field, text });
        break;
      }
      default:
        break; // type is the icon; pending fields never reach here
    }
  }
  return { typeIcon, segments };
}

/** The text a pin visibly shows, for its accessible name: "$1,650, 1 bd · 720 ft²". */
export const segmentsText = (c: PinContent): string => c.segments.map((s) => s.text).join(', ');

// ── Spoken names ───────────────────────────────────────────────────────────

/** "$1,650 New, Riverlight, Unit 1504, …": what's visible first (WCAG 2.5.3, label in name). */
export function accessibleName(visible: readonly (string | null)[], label: string): string {
  const shown = visible.filter(Boolean);
  return shown.length ? `${shown.join(' ')}, ${label}` : label;
}

/** "Riverlight, Unit 1504, $1,650 rent, Shortlisted". */
export function unitPinLabel(row: PinUnit): string {
  const u = row.unit;
  const parts = [
    row.building ? buildingName(row.building) : null,
    unitTitle(u, row.building),
    u.rent === null ? 'rent unknown' : `${u.rentIsFrom ? 'from ' : ''}${money(u.rent)} rent`,
    STATUS_LABELS[u.status],
    isRejected(u) ? 'rejected' : null,
  ];
  // A unit with no number is titled with the building's name; don't say it twice.
  return [...new Set(parts.filter((p): p is string => p !== null))].join(', ');
}

/** "4 units at Lowertown Flats, $1,090 to $1,815" (Buildings view: "4 of your units"). */
export function buildingPinLabel(
  building: Building | undefined,
  units: readonly PinUnit[],
  view: 'units' | 'buildings',
  /** Units the pin stands for, if more than the ones its prices summarize. */
  count: number = units.length,
): string {
  const name = building ? buildingName(building) : 'this building';
  const rents = known(units.map((u) => u.unit.rent));
  const price = !rents.length
    ? ''
    : Math.min(...rents) === Math.max(...rents)
      ? `, ${money(rents[0] as number)}`
      : `, ${money(Math.min(...rents))} to ${money(Math.max(...rents))}`;
  const n = count;
  return view === 'buildings'
    ? `${name}, ${n} of your units${price}`
    : `${n} units at ${name}${price}`;
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
  const rents = known((live.length ? live : units).map((u) => u.rent));
  if (!rents.length) return null;
  return { min: Math.min(...rents), max: Math.max(...rents) };
}

/** Step 0–4 of a value on the scale; values outside the range clamp to the ends. */
export function priceStep(value: number, scale: PriceScale): number {
  const span = scale.max - scale.min + 1;
  const step = Math.floor(((value - scale.min) / span) * PRICE_STEPS.length);
  return Math.max(0, Math.min(PRICE_STEPS.length - 1, step));
}

/** CSS color for one unit's edge. */
export function edgeColor(u: Unit, colorBy: ColorBy, scale: PriceScale | null): string {
  if (colorBy === 'status') return `var(${STATUS_COLOR_VAR[u.status]})`;
  if (colorBy === 'label')
    return u.colorLabel ? `var(${LABEL_COLOR_VAR[u.colorLabel]})` : 'var(--ice)';
  if (u.rent === null || !scale) return 'var(--ice)';
  return PRICE_STEPS[priceStep(u.rent, scale)] as string;
}

const statusOrder = new Map(UNIT_STATUSES.map((s, i) => [s, i]));
const labelOrder = new Map<LabelColor | null, number>([
  ...LABEL_COLORS.map((c, i) => [c, i] as const),
  [null, 99],
]);

/**
 * One edge stripe per unit (a single unit has one), ordered so the same colors sit
 * together: pipeline order for status, label order, cheapest first for price.
 */
export function edgeStripes(
  units: readonly PinUnit[],
  colorBy: ColorBy,
  scale: PriceScale | null,
): string[] {
  const key = (r: PinUnit): number =>
    colorBy === 'status'
      ? (statusOrder.get(r.unit.status) ?? 0)
      : colorBy === 'label'
        ? (labelOrder.get(r.unit.colorLabel) ?? 99)
        : (r.unit.rent ?? Infinity);
  return [...units].sort((a, b) => key(a) - key(b)).map((r) => edgeColor(r.unit, colorBy, scale));
}

// ── Legend ────────────────────────────────────────────────────────────────

export type Legend =
  | { kind: 'status'; title: string; rows: { status: UnitStatus; label: string; color: string }[] }
  | { kind: 'label'; title: string; rows: { label: string; color: string }[] }
  | { kind: 'price'; title: string; steps: readonly string[]; min: string; max: string }
  | { kind: 'price-empty'; title: string; text: string };

/**
 * What the legend says (DESIGN.md §2.4): only the colors on the map, named. Label names
 * come from Settings.
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
