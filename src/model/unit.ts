import { z } from 'zod';
import {
  base,
  count,
  direction,
  fieldSource,
  id,
  isoDate,
  isoDateTime,
  link,
  maybe,
  measure,
  tri,
  usd,
} from './common';

/** Unit record (PLAN.md §3.3). */

export const UNIT_TYPES = ['apartment', 'condo', 'townhome', 'house', 'room'] as const;
export const unitType = z.enum(UNIT_TYPES);
export type UnitType = z.infer<typeof unitType>;

/** "leased" = you signed it (Q2). "Rented by someone else" is off-market. */
export const UNIT_STATUSES = [
  'new',
  'reviewing',
  'shortlisted',
  'tour-scheduled',
  'toured',
  'applied',
  'approved',
  'leased',
  'declined',
  'off-market',
] as const;
export const unitStatus = z.enum(UNIT_STATUSES);
export type UnitStatus = z.infer<typeof unitStatus>;

export const FLAGS = ['pick', 'reject', 'none'] as const;
export const flag = z.enum(FLAGS);
export type Flag = z.infer<typeof flag>;

export const LABEL_COLORS = ['red', 'yellow', 'green', 'blue', 'purple'] as const;
export const labelColor = z.enum(LABEL_COLORS);
export type LabelColor = z.infer<typeof labelColor>;

export const WINDOW_SIZES = [
  'small',
  'standard',
  'large',
  'floor-to-ceiling',
  'window-wall',
] as const;

export const windowSpec = z.object({
  id,
  room: maybe(z.string()), // 'Living', 'Bedroom 1'
  direction: maybe(direction),
  size: maybe(z.enum(WINDOW_SIZES)),
  obstruction: maybe(z.string()), // 'building across the street, ~60 ft'
});
export type WindowSpec = z.infer<typeof windowSpec>;

export const UTILITY_KEYS = ['heat', 'electric', 'waterSewer', 'trash', 'gas', 'internet'] as const;
export const utilityKey = z.enum(UTILITY_KEYS);
export type UtilityKey = z.infer<typeof utilityKey>;

export const utilityTerm = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('included') }),
  z.object({ mode: z.literal('extra'), amount: maybe(usd) }), // landlord bills a flat fee
  z.object({ mode: z.literal('tenant-paid'), estimate: maybe(usd) }), // null → cost profile
]);
export type UtilityTerm = z.infer<typeof utilityTerm>;

/** Cost lines that have a cost-profile estimate and can be overridden per unit (§3.5). */
export const COST_ITEM_KEYS = [
  ...UTILITY_KEYS,
  'parking',
  'storage',
  'renters-insurance',
  'pet-rent',
] as const;
export const costItemKey = z.enum(COST_ITEM_KEYS);
export type CostItemKey = z.infer<typeof costItemKey>;

/** Amenity fee, tech fee, pet rent… */
export const recurringFee = z.object({ id, label: z.string(), amount: usd });
export type RecurringFee = z.infer<typeof recurringFee>;

export const RATINGS = [0, 1, 2, 3, 4, 5] as const;
export const rating = z.literal(RATINGS);
export type Rating = z.infer<typeof rating>;

export const ADDED_VIA = ['quick-add', 'form', 'ai-import', 'backup', 'share'] as const;

export const unit = base.extend({
  // Identity
  buildingId: id,
  unitNumber: maybe(z.string()),
  unitKey: maybe(z.string()), // normalized unit number, indexed for dedupe
  floorPlanName: maybe(z.string()),
  isFloorPlanOnly: z.boolean(),
  // Specs
  type: maybe(unitType),
  bedrooms: maybe(count), // 0 = studio
  bathrooms: maybe(z.number().min(0).multipleOf(0.5)),
  squareFeet: maybe(measure),
  floor: maybe(z.number().int()),
  exposure: maybe(z.array(direction)), // first item = main direction (Q3)
  windows: maybe(z.array(windowSpec)),
  viewNotes: maybe(z.string()),
  layoutNotes: maybe(z.string()),
  // In-unit features
  laundry: maybe(z.enum(['in-unit', 'in-building', 'none'])),
  dishwasher: tri,
  acType: maybe(z.enum(['central', 'mini-split', 'wall-unit', 'window-unit', 'none', 'other'])),
  heatingType: maybe(
    z.enum(['forced-air', 'radiator', 'baseboard', 'radiant-floor', 'heat-pump', 'other']),
  ),
  balcony: tri,
  fireplace: tri,
  flooring: maybe(z.string()),
  furnished: maybe(z.enum(['no', 'partial', 'full'])),
  // Lease
  rent: maybe(usd), // current asking rent (mirrors the latest listing observation)
  rentIsFrom: z.boolean(), // "from $X" (floor-plan-only pricing)
  rentByTerm: maybe(z.array(z.object({ months: z.number().int().min(1), rent: usd }))),
  availableDate: maybe(isoDate),
  leaseTermsMonths: maybe(z.array(z.number().int().min(1))),
  plannedLeaseMonths: maybe(z.number().int().min(1)), // null → cost profile default (Q5)
  deposit: maybe(usd),
  applicationFee: maybe(usd),
  adminFee: maybe(usd),
  recurringFees: maybe(z.array(recurringFee)), // addition (Q5)
  moveInSpecial: maybe(z.object({ text: z.string(), valueUsd: maybe(usd) })),
  // Included vs tenant-paid
  utilities: z.record(utilityKey, maybe(utilityTerm)),
  // Parking & storage (Q4)
  parking: z.object({
    spacesIncluded: maybe(count),
    extraSpaceCost: maybe(usd), // per space per month
    type: maybe(z.enum(['garage', 'surface', 'street', 'none'])),
  }),
  storage: z.object({ included: tri, cost: maybe(usd) }),
  costOverrides: z.partialRecord(costItemKey, usd), // per-unit override of profile estimates
  // Status & review
  status: unitStatus,
  rating,
  ratingNote: maybe(z.string()),
  flag,
  flagNote: maybe(z.string()),
  rejectReasonIds: z.array(id),
  colorLabel: maybe(labelColor),
  collectionIds: z.array(id), // multi-entry index
  lastReviewedAt: maybe(isoDateTime), // "date added" = createdAt
  addedVia: z.enum(ADDED_VIA),
  externalRatings: z.array(
    z.object({ by: z.string(), rating: z.number(), note: maybe(z.string()) }),
  ), // Phase 3 merges (Q1)
  // Map (Phase 4)
  placement3d: maybe(z.object({ facadeBearingDeg: z.number(), floor: z.number().int() })),
  // Media (listing links live in listings; photos in the photos table)
  links: z.array(link),
  fieldSources: z.array(fieldSource),
});
export type Unit = z.infer<typeof unit>;
