import { z } from 'zod';
import { address, base, count, geoPoint, id, isoDate, maybe, measure, usd } from './common';
import { filterSpec, sortSpec } from './filters';

/** Listing, Destination, Collection, Note, Photo and ImportBatch (PLAN.md §3.4). */

export const SITE_KEYS = [
  'zillow',
  'apartments-com',
  'hotpads',
  'trulia',
  'craigslist',
  'facebook',
  'rent-com',
  'padmapper',
  'building-site',
  'other',
] as const;
export const siteKey = z.enum(SITE_KEYS);
export type SiteKey = z.infer<typeof siteKey>;

export const priceObservation = z.object({ date: isoDate, rent: usd, note: maybe(z.string()) });
export type PriceObservation = z.infer<typeof priceObservation>;

export const listing = base.extend({
  unitId: id,
  url: maybe(z.string()),
  site: siteKey,
  firstSeen: isoDate,
  lastSeen: isoDate,
  observations: z.array(priceObservation), // price history; ≥1 when a price was seen
  offMarketAt: maybe(isoDate),
});
export type Listing = z.infer<typeof listing>;

export const TRAVEL_MODES = ['walk', 'bike', 'drive', 'transit'] as const;
export const travelMode = z.enum(TRAVEL_MODES);
export type TravelMode = z.infer<typeof travelMode>;

/** Stored from Phase 1; the UI arrives in Phase 2. */
export const destination = base.extend({
  name: z.string(),
  address,
  location: geoPoint,
  weight: z.number().int().min(1).max(5),
  modes: z.array(travelMode),
  maxMinutes: z.partialRecord(travelMode, measure),
  departure: z.object({
    days: z.enum(['weekday', 'weekend']),
    time: z.string().regex(/^\d{2}:\d{2}$/), // '08:00'
  }),
});
export type Destination = z.infer<typeof destination>;

export const collection = base.extend({
  name: z.string(),
  kind: z.enum(['manual', 'smart']),
  filter: maybe(filterSpec), // smart only ("saved filter")
  sort: maybe(sortSpec),
  order: z.number(),
});
export type Collection = z.infer<typeof collection>;

export const noteEntry = base.extend({
  unitId: maybe(id),
  buildingId: maybe(id),
  text: z.string(),
  kind: z.enum(['note', 'tour', 'call', 'system']), // system = "Status → Toured"
  authorId: maybe(id), // the person who wrote it (M6); null for notes the app wrote itself
});
export type NoteEntry = z.infer<typeof noteEntry>;

export const PHOTO_STORES = ['fsa', 'opfs', 'idb', 'none'] as const;

export const photo = base.extend({
  ownerType: z.enum(['unit', 'building']),
  ownerId: id,
  kind: z.enum(['photo', 'floor-plan']),
  fileName: z.string(), // '2026-10-15_01.jpg'
  archivePath: maybe(z.string()), // relative path in the archive; null if original not kept
  store: z.enum(PHOTO_STORES),
  mime: z.string(),
  bytes: count,
  width: count,
  height: count,
  caption: maybe(z.string()),
  sourceUrl: maybe(z.string()),
  order: z.number(),
});
export type Photo = z.infer<typeof photo>;

/** One paste of AI output, listing text or a batch grid. */
export const importBatch = base.extend({
  kind: z.enum(['ai-json', 'listing-text', 'batch-grid']),
  raw: z.string(), // exactly what you pasted, kept for re-review
  prompt: maybe(z.string()), // the research prompt it answered (AI only)
  summary: z.object({ created: count, filled: count, changed: count, skipped: count }),
  actionId: maybe(z.string()), // change-log action, so the whole import undoes as one step
});
export type ImportBatch = z.infer<typeof importBatch>;
