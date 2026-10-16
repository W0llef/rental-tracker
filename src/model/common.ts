import { z } from 'zod';

/**
 * Shared building blocks of the data model (PLAN.md §3.1).
 *
 *  - Unknown is `null`. Every researched field is `T | null`; yes/no fields are three-state.
 *  - Lists that can be unknown are `T[] | null`: null = not researched, [] = researched, none.
 *  - Money is whole US dollars. Lengths in feet, areas in sq ft.
 *  - IDs are random UUID strings. Dates are YYYY-MM-DD; timestamps are ISO strings.
 */

/** `T | null`, where null means "unknown". */
export const maybe = <T extends z.ZodType>(schema: T) => schema.nullable();

export const tri = z.boolean().nullable();
export type Tri = z.infer<typeof tri>;

export const id = z.string().min(1);
export type ID = z.infer<typeof id>;

export const isoDate = z.iso.date(); // '2027-06-01'
export type ISODate = z.infer<typeof isoDate>;

export const isoDateTime = z.iso.datetime(); // '2026-10-15T21:12:00.000Z'
export type ISODateTime = z.infer<typeof isoDateTime>;

/** Whole US dollars. */
export const usd = z.number().int().min(0);
export type USD = z.infer<typeof usd>;

/** A non-negative count or measure. */
export const count = z.number().int().min(0);
export const measure = z.number().min(0);

export const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export const direction = z.enum(DIRECTIONS);
export type Direction = z.infer<typeof direction>;

/** Fields every stored record has. Soft delete makes undo and merge safe. */
export const base = z.object({
  id,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deletedAt: maybe(isoDateTime),
});
export type Base = z.infer<typeof base>;

export const address = z.object({
  line1: z.string(), // '123 Example Ave S'
  city: maybe(z.string()),
  state: maybe(z.string()), // 'MN'
  zip: maybe(z.string()),
  formatted: z.string(), // display form
  normalized: z.string(), // dedupe key, e.g. '123 example ave s|minneapolis'
});
export type Address = z.infer<typeof address>;

export const geoPoint = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  source: z.enum(['photon', 'nominatim', 'map-click', 'import']),
  precision: z.enum(['address', 'street', 'approximate']),
});
export type GeoPoint = z.infer<typeof geoPoint>;

export const link = z.object({ id, label: z.string(), url: z.string() });
export type Link = z.infer<typeof link>;

/** Where a value came from (shown as a small link in the detail panel). */
export const fieldSource = z.object({
  field: z.string(), // 'unit.rent', 'building.yearBuilt'
  url: maybe(z.string()),
  seen: isoDate,
  via: z.enum(['manual', 'paste', 'ai', 'url']),
  importId: maybe(id), // the import batch that set it
});
export type FieldSource = z.infer<typeof fieldSource>;
