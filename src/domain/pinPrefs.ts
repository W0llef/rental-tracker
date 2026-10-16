import { z } from 'zod';
import { BASE_LAYERS } from '../model';

/**
 * How pins look (M3 rework, owner review): one pin style plus any fields printed on it,
 * remembered separately for the Units and Buildings views. These are display choices, kept
 * in the browser per database like the list's sort (PLAN.md §4.3), so they stay out of Undo
 * and never change the stored data format. `Settings.map` stays in the model for the
 * Settings → Display defaults of a later milestone.
 */

export const PIN_STYLES = ['plate', 'dot', 'photo'] as const;
export type PinStyle = (typeof PIN_STYLES)[number];

/** Fields that can be printed on a plate (or under a photo), in the order they appear. */
export const PIN_FIELDS = [
  'type',
  'rent',
  'total',
  'psf',
  'beds',
  'unit',
  'rating',
  'travel',
] as const;
export type PinField = (typeof PIN_FIELDS)[number];

/** Fields that need a later milestone; shown disabled with this tag until then. */
export const PENDING_FIELDS: Partial<Record<PinField, string>> = {
  total: 'M8',
  psf: 'M8',
  travel: 'Phase 2',
};

export const NEW_BADGES = ['off', 'dot', 'tag'] as const;
export type NewBadge = (typeof NEW_BADGES)[number];

export const REJECTED_MODES = ['show', 'fade', 'hide'] as const;
export type RejectedMode = (typeof REJECTED_MODES)[number];

export const COLOR_BY = ['status', 'label', 'price'] as const;
export type ColorBy = (typeof COLOR_BY)[number];

export type PinView = 'units' | 'buildings';

/** Pin size, in percent of the standard size (owner review 4): pins, dots and cards. */
export const PIN_SIZE = { min: 70, max: 130, step: 5, normal: 100 } as const;

const fields = z
  .array(z.string())
  .transform((list) => PIN_FIELDS.filter((f) => list.includes(f) && !PENDING_FIELDS[f]));

const pinPrefsSchema = (d: PinPrefs) =>
  z.object({
    style: z.enum(PIN_STYLES).catch(d.style),
    fields: fields.catch(d.fields),
    priceMode: z.enum(['range', 'lowest']).catch(d.priceMode),
    colorBy: z.enum(COLOR_BY).catch(d.colorBy),
    newBadge: z.enum(NEW_BADGES).catch(d.newBadge),
    rejected: z.enum(REJECTED_MODES).catch(d.rejected),
    autoFan: z.boolean().catch(d.autoFan),
    shrink: z.boolean().catch(d.shrink),
    bubbles: z.boolean().catch(d.bubbles),
    size: z.number().int().min(PIN_SIZE.min).max(PIN_SIZE.max).catch(d.size),
  });

export interface PinPrefs {
  style: PinStyle;
  /** Ticked fields, in display order. Pending fields are never stored. */
  fields: PinField[];
  /** For a building with several units: the range, or the lowest with "+". */
  priceMode: 'range' | 'lowest';
  colorBy: ColorBy;
  newBadge: NewBadge;
  rejected: RejectedMode;
  /** Units view: open the card of every building with room for it at street zoom. */
  autoFan: boolean;
  /** Shrink pins to dots where they would overlap. */
  shrink: boolean;
  /** Group nearby buildings into bubbles when zoomed out. */
  bubbles: boolean;
  /** Pin size in percent (`PIN_SIZE`). */
  size: number;
}

export type BaseLayer = (typeof BASE_LAYERS)[number];

export interface MapMemory {
  baseLayer: BaseLayer;
  /** OpenStreetMap and Cycle map: fetch the next zoom's tiles (4× the downloads). Off. */
  sharperRaster: boolean;
  pins: Record<PinView, PinPrefs>;
}

const base: Omit<PinPrefs, 'fields'> = {
  style: 'plate',
  priceMode: 'range',
  colorBy: 'status',
  newBadge: 'tag',
  rejected: 'fade',
  autoFan: true,
  shrink: true,
  bubbles: true,
  size: PIN_SIZE.normal,
};

export function defaultMapMemory(): MapMemory {
  return {
    baseLayer: 'wayfinding',
    sharperRaster: false,
    pins: {
      units: { ...base, fields: ['rent'] },
      buildings: { ...base, fields: ['rent'], autoFan: false },
    },
  };
}

/** Reads stored map choices, keeping every valid part and defaulting the rest. */
export function parseMapMemory(raw: unknown): MapMemory {
  const d = defaultMapMemory();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as {
    baseLayer?: unknown;
    sharperRaster?: unknown;
    pins?: { units?: unknown; buildings?: unknown };
  };
  const view = (v: PinView): PinPrefs => {
    const parsed = pinPrefsSchema(d.pins[v]).safeParse(r.pins?.[v] ?? {});
    return parsed.success ? parsed.data : d.pins[v];
  };
  const baseLayer = z.enum(BASE_LAYERS).safeParse(r.baseLayer);
  return {
    baseLayer: baseLayer.success ? baseLayer.data : d.baseLayer,
    sharperRaster: r.sharperRaster === true,
    pins: { units: view('units'), buildings: view('buildings') },
  };
}

// ── What can be combined ───────────────────────────────────────────────────

/**
 * Whether a field can be ticked: dots carry no text; pending fields wait for their
 * milestone. Every other combination is allowed (the photo style prints fields underneath).
 */
export function fieldEnabled(prefs: Pick<PinPrefs, 'style'>, field: PinField): boolean {
  if (PENDING_FIELDS[field]) return false;
  return prefs.style !== 'dot';
}

/** The fields that actually draw, in order. */
export function activeFields(prefs: Pick<PinPrefs, 'style' | 'fields'>): PinField[] {
  return prefs.fields.filter((f) => fieldEnabled(prefs, f));
}

/** Toggles a field, keeping the stored list in display order. */
export function toggleField(prefs: PinPrefs, field: PinField, on: boolean): PinPrefs {
  const set = new Set(prefs.fields);
  if (on) set.add(field);
  else set.delete(field);
  return { ...prefs, fields: PIN_FIELDS.filter((f) => set.has(f)) };
}
