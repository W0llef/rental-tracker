import { z } from 'zod';
import { count, id, isoDate, isoDateTime, maybe, usd } from './common';
import { filterSpec } from './filters';
import { PHOTO_STORES } from './records';
import { costItemKey, labelColor, unitType } from './unit';
import type { CostItemKey, LabelColor } from './unit';

/** The single Settings record and its parts (PLAN.md §3.5). */

export const costProfileItem = z.object({
  monthly: usd,
  scaleBy: z.enum(['none', 'sqft', 'bedrooms']),
  basis: z.number().positive(),
});
export type CostProfileItem = z.infer<typeof costProfileItem>;

export const costProfile = z.object({
  // e.g. electric: { monthly: 55, scaleBy: 'sqft', basis: 750 } → 55 × sqft / 750
  items: z.record(costItemKey, costProfileItem),
  parkingSpacesNeeded: count, // Q5
  needsStorage: z.boolean(),
  hasPets: z.object({ cats: count, dogs: count }),
  amortizeOneTimeFees: z.boolean(), // Q5, default off
  amortizeSpecials: z.boolean(), // Q5, default off
  defaultLeaseMonths: z.number().int().min(1), // Q5; per unit via plannedLeaseMonths
});
export type CostProfile = z.infer<typeof costProfile>;

export const PIN_CONTENTS = [
  'total',
  'rent',
  'psf',
  'photo',
  'type',
  'beds',
  'rating',
  'unit',
  'dot',
  'travel', // enabled in Phase 2
] as const;

export type PinContent = (typeof PIN_CONTENTS)[number];

export const BASE_LAYERS = ['wayfinding', 'streets', 'osm', 'cycle', 'aerial'] as const;

export const mapPrefs = z.object({
  baseLayer: z.enum(BASE_LAYERS),
  pins: z.object({
    show: z.enum(PIN_CONTENTS),
    extras: z.object({ typeIcon: z.boolean(), stars: z.boolean(), newBadge: z.boolean() }),
    colorBy: z.enum(['status', 'label', 'price']),
    simplifyWhenCrowded: z.boolean(), // collapse to dots at low zoom / heavy overlap
    fadeRejected: z.boolean(),
  }),
  overlays: z.array(z.string()), // Phase 2 ids: 'skyway', 'transit', 'bike', …
});
export type MapPrefs = z.infer<typeof mapPrefs>;

/** Non-location part of the spec §4 setup (Q6). */
export const baselineCriteria = z.object({
  maxRent: maybe(usd),
  maxTotalMonthly: maybe(usd),
  minBedrooms: maybe(count),
  minBathrooms: maybe(z.number().min(0)),
  unitTypes: z.array(unitType),
  moveIn: maybe(z.object({ from: isoDate, to: isoDate })),
  mustHaves: filterSpec,
});
export type BaselineCriteria = z.infer<typeof baselineCriteria>;

export const settings = z.object({
  id: z.literal('app'),
  costProfile,
  baseline: baselineCriteria,
  labelNames: z.record(labelColor, z.string()), // 'Blue' → 'Roommate likes'
  rejectReasons: z.array(z.object({ id, label: z.string(), archived: z.boolean() })),
  map: mapPrefs,
  theme: z.enum(['system', 'light', 'dark']),
  mapStyleUrl: z.string(), // override for the Wayfinding style's tile source
  essentialFields: z.array(z.string()), // fields that count toward "ready to compare" (§5.7)
  photoArchive: z.object({
    store: z.enum(PHOTO_STORES),
    folderName: maybe(z.string()),
    keepOriginalsFor: z.enum(['all', 'starred', 'shortlisted']),
  }),
  backup: z.object({ lastBackupAt: maybe(isoDateTime), remindEveryDays: z.number().int().min(1) }),
  apiKeys: z.object({ openRouteService: maybe(z.string()), google: maybe(z.string()) }), // Phase 2; never exported
});
export type Settings = z.infer<typeof settings>;

// ── Defaults ───────────────────────────────────────────────────────────────

/**
 * Starting estimates for the cost profile. They're placeholders the owner edits in
 * Settings → Cost profile (M9); nothing here is a promise about real bills.
 */
const defaultCostItems: Record<CostItemKey, CostProfileItem> = {
  heat: { monthly: 50, scaleBy: 'sqft', basis: 750 },
  electric: { monthly: 55, scaleBy: 'sqft', basis: 750 },
  waterSewer: { monthly: 45, scaleBy: 'bedrooms', basis: 1 },
  trash: { monthly: 15, scaleBy: 'none', basis: 1 },
  gas: { monthly: 25, scaleBy: 'none', basis: 1 },
  internet: { monthly: 60, scaleBy: 'none', basis: 1 },
  parking: { monthly: 100, scaleBy: 'none', basis: 1 },
  storage: { monthly: 40, scaleBy: 'none', basis: 1 },
  'renters-insurance': { monthly: 15, scaleBy: 'none', basis: 1 },
  'pet-rent': { monthly: 35, scaleBy: 'none', basis: 1 },
};

const defaultLabelNames: Record<LabelColor, string> = {
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
};

/** Default essentials (§5.7): rent, beds, baths, sq ft, available date, laundry, parking,
 *  heat and electric, pets, lease terms. */
export const DEFAULT_ESSENTIAL_FIELDS = [
  'unit.rent',
  'unit.bedrooms',
  'unit.bathrooms',
  'unit.squareFeet',
  'unit.availableDate',
  'unit.laundry',
  'unit.parking',
  'unit.utilities.heat',
  'unit.utilities.electric',
  'building.pets',
  'unit.leaseTermsMonths',
];

/** Reusable reject reasons from spec §6 ("too far, too expensive, no laundry, bad reviews…"). */
const defaultRejectReasons = [
  ['too-far', 'Too far'],
  ['too-expensive', 'Too expensive'],
  ['no-laundry', 'No laundry'],
  ['bad-reviews', 'Bad reviews'],
  ['too-small', 'Too small'],
  ['not-available', 'Not available in time'],
] as const;

export const DEFAULT_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

export function defaultSettings(): Settings {
  return {
    id: 'app',
    costProfile: {
      items: structuredClone(defaultCostItems),
      parkingSpacesNeeded: 1,
      needsStorage: false,
      hasPets: { cats: 0, dogs: 0 },
      amortizeOneTimeFees: false,
      amortizeSpecials: false,
      defaultLeaseMonths: 12,
    },
    baseline: {
      maxRent: null,
      maxTotalMonthly: null,
      minBedrooms: null,
      minBathrooms: null,
      unitTypes: [],
      moveIn: null,
      mustHaves: {},
    },
    labelNames: { ...defaultLabelNames },
    rejectReasons: defaultRejectReasons.map(([rid, label]) => ({
      id: rid,
      label,
      archived: false,
    })),
    map: {
      baseLayer: 'wayfinding',
      pins: {
        show: 'total',
        extras: { typeIcon: false, stars: false, newBadge: true }, // DESIGN.md §4.7
        colorBy: 'status',
        simplifyWhenCrowded: true,
        fadeRejected: true,
      },
      overlays: [],
    },
    theme: 'system',
    mapStyleUrl: DEFAULT_MAP_STYLE_URL,
    essentialFields: [...DEFAULT_ESSENTIAL_FIELDS],
    photoArchive: { store: 'none', folderName: null, keepOriginalsFor: 'all' },
    backup: { lastBackupAt: null, remindEveryDays: 7 },
    apiKeys: { openRouteService: null, google: null },
  };
}
