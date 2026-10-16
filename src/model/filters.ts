import { z } from 'zod';
import { amenityKey } from './building';
import { direction, id } from './common';
import { flag, labelColor, unitStatus } from './unit';

/** Saved filters and sorts (PLAN.md §3.5). Every clause is optional; clauses are AND-ed. */

const range = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  includeUnknown: z.boolean(),
});

export const RANGE_KEYS = [
  'rent',
  'totalMonthly',
  'bedrooms',
  'bathrooms',
  'squareFeet',
  'floor',
  'pricePerSqft',
  'listingAgeDays',
] as const;

export const ENUM_FILTER_KEYS = [
  'type',
  'laundry',
  'furnished',
  'parkingType',
  'buildingType',
] as const;

export const TRI_FILTER_KEYS = ['dishwasher', 'balcony', 'fireplace', 'elevator'] as const;

export const filterSpec = z.object({
  text: z.string().optional(),
  status: z.array(unitStatus).optional(),
  flag: z.array(flag).optional(),
  minRating: z.number().optional(),
  labels: z.array(z.union([labelColor, z.literal('none')])).optional(),
  collections: z.array(id).optional(),
  rejectReasons: z.array(id).optional(),
  ranges: z.partialRecord(z.enum(RANGE_KEYS), range).optional(),
  enums: z.partialRecord(z.enum(ENUM_FILTER_KEYS), z.array(z.string())).optional(),
  tri: z.partialRecord(z.union([z.enum(TRI_FILTER_KEYS), amenityKey]), z.boolean()).optional(),
  exposureIncludes: z.array(direction).optional(),
  needsResearch: z.array(z.string()).optional(), // field paths that must be unknown
  isFloorPlanOnly: z.boolean().optional(),
  needsLocation: z.boolean().optional(),
});
export type FilterSpec = z.infer<typeof filterSpec>;

/** Unknown values always sort last, whatever the direction. */
export const sortSpec = z.object({ key: z.string(), dir: z.enum(['asc', 'desc']) });
export type SortSpec = z.infer<typeof sortSpec>;
