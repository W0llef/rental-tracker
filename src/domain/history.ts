import type { ChangeEntry } from '../db/changeLog';
import { defaultSettings, LABEL_COLORS } from '../model';
import type {
  BuildingType,
  Building,
  CostItemKey,
  CostProfile,
  ID,
  LabelColor,
  Listing,
  NoteEntry,
  Opinion,
  Person,
  Settings,
  Unit,
  UnitStatus,
} from '../model';
import { emptyOpinionFields } from '../model/factories';
import {
  BUILDING_TYPE_LABELS,
  buildingName,
  enumLabel,
  leaseTermsLabel,
  money,
  num,
  SITE_LABELS,
  STATUS_LABELS,
  UTILITY_LABELS,
  COST_ITEM_LABELS,
  monthsLabel,
  unitFullName,
  utilityLabel,
} from './format';

/**
 * Change history in words (PLAN.md §5.6, owner notes for M7): every line is built from the
 * change log's stored before/after records, not from the action's label, so entries
 * recorded before M7 read specifically too ("Rent $1,650 → $1,600 on Unit 908").
 *
 * Also the pure parts of going back in time: which values "Undo this" would write for one
 * past action, and where that clashes with later changes. Pure; no Dexie, no React.
 */

// ── Lookup ─────────────────────────────────────────────────────────────────

/** What describing needs to name things: every record, deleted ones included. */
export interface HistoryLookup {
  meId: ID | null;
  buildings: ReadonlyMap<ID, Building>;
  units: ReadonlyMap<ID, Unit>;
  people: ReadonlyMap<ID, Person>;
  settings: Settings;
}

export function makeLookup(input: {
  meId: ID | null;
  buildings: readonly Building[];
  units: readonly Unit[];
  people: readonly Person[];
  settings: Settings | undefined;
}): HistoryLookup {
  return {
    meId: input.meId,
    buildings: new Map(input.buildings.map((b) => [b.id, b])),
    units: new Map(input.units.map((u) => [u.id, u])),
    people: new Map(input.people.map((p) => [p.id, p])),
    settings: input.settings ?? defaultSettings(),
  };
}

// ── Small helpers ──────────────────────────────────────────────────────────

type Rec = Record<string, unknown>;

const isPlain = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export const sameValue = (a: unknown, b: unknown): boolean =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export type Path = readonly string[];

/**
 * Paths to the values that differ between two records. Plain objects are compared key by
 * key (so `utilities.heat` and `utilities.electric` are separate changes); arrays and other
 * values are compared whole.
 */
export function diffPaths(a: unknown, b: unknown, at: string[] = []): string[][] {
  if (isPlain(a) && isPlain(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].flatMap((k) => diffPaths(a[k], b[k], [...at, k]));
  }
  return sameValue(a, b) ? [] : [at];
}

export function getPath(obj: unknown, path: Path): unknown {
  let v: unknown = obj;
  for (const k of path) {
    if (!isPlain(v)) return undefined;
    v = v[k];
  }
  return v;
}

/** Sets a value inside a (cloned) record, creating plain objects on the way. */
export function setPath(obj: Rec, path: Path, value: unknown): void {
  let v: Rec = obj;
  path.forEach((k, i) => {
    if (i === path.length - 1) {
      if (value === undefined) delete v[k];
      else v[k] = value;
      return;
    }
    if (!isPlain(v[k])) v[k] = {};
    v = v[k] as Rec;
  });
}

/** Fields that change on every write or follow from others; never described or reverted alone. */
const IGNORED = new Set(['updatedAt', 'createdAt', 'unitKey', 'isFloorPlanOnly', 'lastReviewedAt']);

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function listNames(names: readonly string[], noun: string, many = `${noun}s`): string {
  const unique = [...new Set(names)];
  if (unique.length === 1) return unique[0]!;
  if (unique.length <= 3)
    return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
  return plural(unique.length, noun, many);
}

const quoted = (s: string) => `“${s}”`;

function short(text: string, max = 40): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/** A stored value in a few words, for "before → after" details. */
export function valueText(v: unknown): string {
  if (v === null || v === undefined) return 'unknown';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (typeof v === 'number') return num(v);
  if (typeof v === 'string') return v === '' ? 'empty' : short(v);
  if (Array.isArray(v)) {
    if (!v.length) return 'none';
    if (v.every((x) => typeof x === 'string' || typeof x === 'number')) return short(v.join(', '));
    return plural(v.length, 'item');
  }
  return 'changed';
}

// ── Naming records ─────────────────────────────────────────────────────────

const buildingOf = (lookup: HistoryLookup, id: ID | null | undefined) =>
  id ? lookup.buildings.get(id) : undefined;

/** "Unit 1504 at Riverlight", "Plan C at The Larkin", "1840 Grand Ave". */
export function unitName(u: Unit, lookup: HistoryLookup): string {
  return unitFullName(u, buildingOf(lookup, u.buildingId));
}

function unitNameById(id: ID | null | undefined, lookup: HistoryLookup): string {
  const u = id ? lookup.units.get(id) : undefined;
  return u ? unitName(u, lookup) : 'a unit that’s gone';
}

const isMe = (personId: ID, lookup: HistoryLookup) => personId === lookup.meId;

function personName(id: ID | null | undefined, lookup: HistoryLookup): string {
  if (!id) return 'Someone';
  if (isMe(id, lookup)) return 'You';
  return lookup.people.get(id)?.name ?? 'Someone';
}

/** "Red" or the name you gave it ("Too far?"), for shared or someone's private label. */
export function labelName(color: LabelColor, lookup: HistoryLookup, personId: ID | null): string {
  if (personId) return lookup.people.get(personId)?.labelNames[color] ?? capitalize(color);
  return lookup.settings.labelNames[color] ?? capitalize(color);
}

function reasonText(ids: readonly ID[], lookup: HistoryLookup): string {
  return ids
    .map((id) => lookup.settings.rejectReasons.find((r) => r.id === id)?.label)
    .filter(Boolean)
    .join(', ');
}

// ── Field labels (units and buildings) ─────────────────────────────────────

const UNIT_FIELDS: Record<string, string> = {
  unitNumber: 'Unit number',
  floorPlanName: 'Floor plan',
  type: 'Type',
  bedrooms: 'Bedrooms',
  bathrooms: 'Bathrooms',
  squareFeet: 'Size',
  floor: 'Floor',
  exposure: 'Exposure',
  windows: 'Windows',
  viewNotes: 'View notes',
  layoutNotes: 'Layout notes',
  laundry: 'Laundry',
  dishwasher: 'Dishwasher',
  acType: 'AC',
  heatingType: 'Heating',
  balcony: 'Balcony',
  fireplace: 'Fireplace',
  flooring: 'Flooring',
  furnished: 'Furnished',
  rent: 'Rent',
  rentIsFrom: 'Rent is “from”',
  rentByTerm: 'Rent by lease length',
  availableDate: 'Available date',
  leaseTermsMonths: 'Lease terms',
  plannedLeaseMonths: 'Lease length',
  deposit: 'Deposit',
  applicationFee: 'Application fee',
  adminFee: 'Admin fee',
  recurringFees: 'Monthly fees',
  moveInSpecial: 'Move-in special',
  'parking.spacesIncluded': 'Parking spaces included',
  'parking.extraSpaceCost': 'Extra parking space',
  'parking.type': 'Parking',
  'storage.included': 'Storage',
  'storage.cost': 'Storage cost',
  costOverrides: 'Cost overrides',
  collectionIds: 'Collections',
  links: 'Links',
  fieldSources: 'Sources',
  buildingId: 'Building',
  placement3d: '3D placement',
};

/** Building fields' names (M8): what History says for building form saves. */
const BUILDING_FIELDS: Record<string, string> = {
  name: 'Name',
  complexName: 'Complex',
  address: 'Address',
  website: 'Website',
  managementCompany: 'Management company',
  phone: 'Phone',
  email: 'Email',
  yearBuilt: 'Year built',
  yearRenovated: 'Year renovated',
  floors: 'Floors',
  totalUnits: 'Total units',
  buildingType: 'Building type',
  elevator: 'Elevator',
  amenitiesNotes: 'Amenity notes',
  'pets.cats': 'Cats',
  'pets.dogs': 'Dogs',
  'pets.limits': 'Pet limits',
  'pets.deposit': 'Pet deposit',
  'pets.oneTimeFee': 'One-time pet fee',
  'pets.monthlyRent': 'Pet rent',
  smoking: 'Smoking',
  guestParking: 'Guest parking',
  subletPolicy: 'Subletting',
  policyNotes: 'Policy notes',
  neighborhood: 'Neighborhood',
  links: 'Links',
  notes: 'Building notes',
  availabilityUrl: 'Availability page',
  floorHeightFt: 'Floor height',
  standalone: 'Standalone home',
};

const BUILDING_MONEY = new Set(['pets.deposit', 'pets.oneTimeFee', 'pets.monthlyRent']);

/**
 * Where a change is described as a whole rather than key by key: a utility's terms
 * ("Heat included → billed extra, $40/mo"), a move-in special, an address, a neighborhood.
 */
const WHOLE = new Set([
  'checkedUnknown',
  'utilities',
  'moveInSpecial',
  'placement3d',
  'address',
  'neighborhood',
  'crime',
]);

/** The changed paths of two records, with the WHOLE parts kept together. */
function describedPaths(a: unknown, b: unknown): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const p of diffPaths(a, b)) {
    const depth = p[0] === 'utilities' ? 2 : WHOLE.has(p[0]!) ? 1 : p.length;
    const cut = p.slice(0, depth);
    const key = cut.join('.');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cut);
  }
  return out;
}

const MONEY_FIELDS = new Set([
  'rent',
  'deposit',
  'applicationFee',
  'adminFee',
  'parking.extraSpaceCost',
  'storage.cost',
]);

function fieldLabel(path: Path, table: 'units' | 'buildings'): string {
  const key = path.join('.');
  if (table === 'units') {
    if (path[0] === 'utilities' && path[1]) {
      return UTILITY_LABELS[path[1] as keyof typeof UTILITY_LABELS] ?? enumLabel(path[1]);
    }
    if (path[0] === 'costOverrides' && path[1]) {
      const item = COST_ITEM_LABELS[path[1] as CostItemKey] ?? enumLabel(path[1]);
      return `Your ${item.replace(/, per .*$/, '').toLowerCase()} estimate`;
    }
    if (UNIT_FIELDS[key]) return UNIT_FIELDS[key];
    if (UNIT_FIELDS[path[0]!]) return UNIT_FIELDS[path[0]!]!;
  }
  if (table === 'buildings') {
    if (path[0] === 'amenities' && path[1]) return AMENITY_NAMES[path[1]] ?? capitalize(path[1]);
    if (BUILDING_FIELDS[key]) return BUILDING_FIELDS[key];
    if (BUILDING_FIELDS[path[0]!]) return BUILDING_FIELDS[path[0]!]!;
  }
  const last = path[path.length - 1] ?? key;
  return capitalize(last.replace(/([A-Z])/g, ' $1').toLowerCase());
}

const AMENITY_NAMES: Record<string, string> = {
  fitness: 'Fitness',
  pool: 'Pool',
  studyRooms: 'Study rooms',
  outdoorDeck: 'Outdoor deck',
  packageRoom: 'Package room',
  bikeStorage: 'Bike storage',
  evCharging: 'EV charging',
  guestSuites: 'Guest suites',
  petArea: 'Pet area',
  frontDesk: 'Front desk',
  skywayConnected: 'Skyway connected',
};

/** A building field's value in words ("$35", "mid-rise", "Downtown East"). */
function buildingValue(path: Path, v: unknown): string {
  const key = path.join('.');
  if (key === 'standalone') return v === null || v === undefined ? 'automatic' : v ? 'yes' : 'no';
  if (v === null || v === undefined) return 'unknown';
  if (BUILDING_MONEY.has(key) && typeof v === 'number') return money(v);
  if (key === 'yearBuilt' || key === 'yearRenovated') return String(v);
  if (key === 'buildingType')
    return (BUILDING_TYPE_LABELS[v as BuildingType] ?? String(v)).toLowerCase();
  if (key === 'neighborhood' && typeof v === 'object') return short((v as { name: string }).name);
  if (key === 'address' && typeof v === 'object') return short((v as { line1: string }).line1);
  if (typeof v === 'string' && /^[a-z]+(-[a-z]+)*$/.test(v)) return enumLabel(v).toLowerCase();
  return valueText(v);
}

/** A unit field's value in words ("$1,650", "Included", "12 or 15 months"). */
function unitValue(path: Path, v: unknown): string {
  const key = path.join('.');
  if (path[0] === 'costOverrides' && path[1])
    return typeof v === 'number' ? `${money(v)}/mo` : 'your cost profile’s';
  if (key === 'plannedLeaseMonths') return typeof v === 'number' ? monthsLabel(v) : 'your default';
  if (v === null || v === undefined) return 'unknown';
  if (MONEY_FIELDS.has(key) && typeof v === 'number') return money(v);
  if (path[0] === 'utilities') return utilityLabel(v as never)?.toLowerCase() ?? 'unknown';
  if (key === 'leaseTermsMonths') return leaseTermsLabel(v as number[]) ?? 'unknown';
  if (key === 'squareFeet' && typeof v === 'number') return `${num(v)} ft²`;
  if (key === 'bedrooms' && v === 0) return 'studio';
  if (key === 'moveInSpecial' && typeof v === 'object') return short((v as { text: string }).text);
  if (typeof v === 'string' && /^[a-z]+(-[a-z]+)*$/.test(v)) return enumLabel(v).toLowerCase();
  return valueText(v);
}

// ── Describing one action ──────────────────────────────────────────────────

/**
 * One thing an action did, about one subject. Items with the same `group` are said once
 * for all their subjects ("Flagged Unit 908 and Unit 1504 as pick").
 */
interface Item {
  group: string;
  subject: string;
  /** Noun for counting subjects when there are many ("units"). */
  noun: string;
  text: (subjects: string) => string;
  /** The same item, on its own line, with before and after where it helps. */
  detail: string;
  /** Hidden from the title (still listed in the details), e.g. a listing added with its unit. */
  quiet?: boolean;
}

export interface Description {
  /** One line: what the action did. */
  title: string;
  /** Every change, one per line. */
  details: string[];
  /** Units the action touched (its own records, opinions, listings and notes). */
  unitIds: ID[];
  /** Buildings the action touched. */
  buildingIds: ID[];
}

/** First and last value of each record an action wrote (an action may write one twice). */
export interface RecordChange {
  table: string;
  key: string;
  before: unknown;
  after: unknown;
}

export function netChanges(entries: readonly ChangeEntry[]): RecordChange[] {
  const byKey = new Map<string, RecordChange>();
  for (const e of [...entries].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
    const id = `${e.table}\u0000${e.key}`;
    const seen = byKey.get(id);
    if (seen) seen.after = e.after;
    else byKey.set(id, { table: e.table, key: e.key, before: e.before, after: e.after });
  }
  return [...byKey.values()].filter((c) => !sameValue(c.before, c.after));
}

type Life = 'added' | 'deleted' | 'restored' | 'changed' | 'removed';

/** Whether a record appeared, was (soft) deleted, came back, or just changed. */
function lifeOf(before: Rec | null, after: Rec | null): Life {
  if (!before) return 'added';
  if (!after) return 'removed';
  if (!before.deletedAt && after.deletedAt) return 'deleted';
  if (before.deletedAt && !after.deletedAt) return 'restored';
  return 'changed';
}

function unitItems(c: RecordChange, lookup: HistoryLookup, ctx: Context): Item[] {
  const before = c.before as Unit | null;
  const after = c.after as Unit | null;
  const u = (after ?? before)!;
  const name = unitName(u, lookup);
  const base = { subject: name, noun: 'unit' };
  const life = lifeOf(before, after);
  if (life === 'added') {
    return [{ ...base, group: 'unit-add', text: (s) => `Added ${s}`, detail: `Added ${name}` }];
  }
  if (life === 'removed' || life === 'deleted') {
    const quiet = ctx.deletedBuildings.has(u.buildingId);
    return [
      { ...base, group: 'unit-del', text: (s) => `Deleted ${s}`, detail: `Deleted ${name}`, quiet },
    ];
  }
  if (life === 'restored') {
    const quiet = ctx.restoredBuildings.has(u.buildingId);
    return [
      {
        ...base,
        group: 'unit-restore',
        text: (s) => `Restored ${s}`,
        detail: `Restored ${name}`,
        quiet,
      },
    ];
  }
  const items: Item[] = [];
  for (const path of describedPaths(before, after)) {
    if (IGNORED.has(path[0]!)) continue;
    const key = path.join('.');
    if (key === 'checkedUnknown') {
      // Fields checked and found unknown (Q29) say so only in the details.
      items.push({
        ...base,
        group: 'unit:checkedUnknown',
        text: (s) => `Checked unknowns on ${s}`,
        detail: `Changed which fields are checked and unknown on ${name}`,
        quiet: true,
      });
      continue;
    }
    if (key === 'fieldSources') {
      // Sources follow the values they're for: a form save that drops them says so only
      // in the details.
      items.push({
        ...base,
        group: 'unit:fieldSources',
        text: (s) => `Changed sources on ${s}`,
        detail: `Changed sources on ${name}`,
        quiet: true,
      });
      continue;
    }
    const was = getPath(before, path);
    const now = getPath(after, path);
    if (key === 'status') {
      const to = STATUS_LABELS[now as UnitStatus];
      const from = STATUS_LABELS[was as UnitStatus];
      items.push({
        ...base,
        group: `status:${String(now)}`,
        text: (s) => `Status → ${to} on ${s}`,
        detail: `Status ${from} → ${to} on ${name}`,
      });
      continue;
    }
    if (key === 'colorLabel') {
      const color = now as LabelColor | null;
      const label = color ? labelName(color, lookup, null) : null;
      items.push({
        ...base,
        group: `shared-label:${String(color)}`,
        text: (s) =>
          label ? `Shared label ${label} on ${s}` : `Removed the shared label from ${s}`,
        detail: label
          ? `Shared label ${label} on ${name}`
          : `Removed the shared label (${labelName(was as LabelColor, lookup, null)}) from ${name}`,
      });
      continue;
    }
    const field = fieldLabel(path, 'units');
    const nowText = unitValue(path, now);
    const wasText = unitValue(path, was);
    const simple =
      typeof now !== 'object' ||
      now === null ||
      path[0] === 'utilities' ||
      key === 'moveInSpecial' ||
      Array.isArray(now);
    items.push({
      ...base,
      group: simple ? `unit:${key}:${JSON.stringify(now)}` : `unit:${key}`,
      text: simple
        ? (s) => `${field} ${wasText} → ${nowText} on ${s}`
        : (s) => `Changed ${field.toLowerCase()} on ${s}`,
      detail: simple
        ? `${field} ${wasText} → ${nowText} on ${name}`
        : `Changed ${field.toLowerCase()} on ${name}`,
    });
  }
  return items;
}

function buildingItems(c: RecordChange, ctx: Context): Item[] {
  const before = c.before as Building | null;
  const after = c.after as Building | null;
  const b = (after ?? before)!;
  const name = buildingName(b);
  const base = { subject: name, noun: 'building' };
  const life = lifeOf(before, after);
  const units = ctx.unitsByBuilding.get(b.id) ?? 0;
  const withUnits = units ? ` and ${units === 1 ? 'its unit' : `its ${units} units`}` : '';
  if (life === 'added') {
    // Quick-add creates a building with its first unit: "Added Unit 1504 at Riverlight" says it.
    const quiet = ctx.addedUnitBuildings.has(b.id);
    return [
      {
        ...base,
        group: 'building-add',
        text: (s) => `Added ${s}`,
        detail: `Added the building ${name}`,
        quiet,
      },
    ];
  }
  if (life === 'removed' || life === 'deleted') {
    return [
      {
        ...base,
        group: `building-del:${b.id}`,
        text: (s) => `Deleted ${s}${withUnits}`,
        detail: `Deleted ${name}${withUnits}`,
      },
    ];
  }
  if (life === 'restored') {
    return [
      {
        ...base,
        group: `building-restore:${b.id}`,
        text: (s) => `Restored ${s}${withUnits}`,
        detail: `Restored ${name}${withUnits}`,
      },
    ];
  }
  const items: Item[] = [];
  for (const path of describedPaths(before, after)) {
    if (IGNORED.has(path[0]!)) continue;
    if (path[0] === 'location') {
      if (items.some((i) => i.group === 'building-place')) continue;
      items.push({
        ...base,
        group: 'building-place',
        text: (s) => (after?.location ? `Placed ${s} on the map` : `Removed ${s} from the map`),
        detail: after?.location ? `Placed ${name} on the map` : `Removed ${name} from the map`,
      });
      continue;
    }
    if (path[0] === 'checkedUnknown') {
      items.push({
        ...base,
        group: 'building:checkedUnknown',
        text: (s) => `Checked unknowns on ${s}`,
        detail: `Changed which fields are checked and unknown on ${name}`,
        quiet: true,
      });
      continue;
    }
    const field = fieldLabel(path, 'buildings');
    const was = buildingValue(path, getPath(before, path));
    const now = buildingValue(path, getPath(after, path));
    const long = ['notes', 'amenitiesNotes', 'policyNotes', 'links'].includes(path[0]!);
    items.push({
      ...base,
      group: `building:${path.join('.')}:${long ? '' : now}`,
      text: long
        ? (s) => `Changed ${field.toLowerCase()} on ${s}`
        : (s) => `${field} ${was} → ${now} on ${s}`,
      detail: long
        ? `Changed ${field.toLowerCase()} on ${name}`
        : `${field} ${was} → ${now} on ${name}`,
    });
  }
  return items;
}

function opinionItems(c: RecordChange, lookup: HistoryLookup, ctx: Context): Item[] {
  const before = c.before as Opinion | null;
  const after = c.after as Opinion | null;
  const o = (after ?? before)!;
  const name = unitNameById(o.unitId, lookup);
  const me = isMe(o.personId, lookup);
  const who = me ? '' : ` for ${personName(o.personId, lookup)}`;
  const whose = me ? 'Your' : `${personName(o.personId, lookup)}’s`;
  const base = { subject: name, noun: 'unit' };
  const quiet = ctx.addedUnits.has(o.unitId) || ctx.removedPeople.has(o.personId);
  const life = lifeOf(before, after);
  // A deleted opinion (its person was removed) says nothing; its person's line says it.
  const was = before && !before.deletedAt ? before : { ...emptyOpinionFields() };
  const now = after && !after.deletedAt ? after : { ...emptyOpinionFields() };
  if (life === 'deleted' || life === 'restored' || life === 'removed') {
    if (ctx.removedPeople.has(o.personId) || ctx.restoredPeople.has(o.personId)) return [];
  }
  const items: Item[] = [];
  const push = (group: string, text: (s: string) => string, detail: string) =>
    items.push({ ...base, group: `${group}|${o.personId}`, text, detail, quiet });

  if (
    was.flag !== now.flag ||
    (now.flag === 'reject' && !sameValue(was.rejectReasonIds, now.rejectReasonIds))
  ) {
    const reasons = reasonText(now.rejectReasonIds, lookup);
    if (now.flag === 'pick')
      push('pick', (s) => `Flagged ${s} as pick${who}`, `Flagged ${name} as pick${who}`);
    else if (now.flag === 'reject') {
      const why = reasons ? `: ${reasons}` : '';
      const verb = was.flag === 'reject' ? 'Changed reject reasons on' : 'Rejected';
      push(
        `reject:${reasons}:${verb}`,
        (s) => `${verb} ${s}${who}${why}`,
        `${verb} ${name}${who}${why}`,
      );
    } else
      push(
        'unflag',
        (s) => `Removed the flag from ${s}${who}`,
        `Removed the flag from ${name}${who}`,
      );
  }
  if (was.rating !== now.rating) {
    const stars = plural(now.rating, 'star');
    if (now.rating)
      push(
        `rate:${now.rating}`,
        (s) => `Rated ${s} ${stars}${who}`,
        `Rated ${name} ${stars}${who} (was ${was.rating ? plural(was.rating, 'star') : 'not rated'})`,
      );
    else
      push(
        'unrate',
        (s) => `Cleared the rating on ${s}${who}`,
        `Cleared the rating on ${name}${who}`,
      );
  }
  if (was.colorLabel !== now.colorLabel) {
    const label = now.colorLabel ? labelName(now.colorLabel, lookup, o.personId) : null;
    push(
      `plabel:${String(now.colorLabel)}`,
      (s) =>
        label
          ? `${whose} label ${label} on ${s}`
          : `Removed ${whose.toLowerCase()} label from ${s}`,
      label
        ? `${whose} label ${label} on ${name}`
        : `Removed ${whose.toLowerCase()} label from ${name}`,
    );
  }
  for (const [field, noun] of [
    ['flagNote', 'flag note'],
    ['ratingNote', 'rating note'],
  ] as const) {
    if ((was[field] ?? '') === (now[field] ?? '')) continue;
    const text = now[field];
    const verb = !was[field] ? 'Added a' : text ? 'Edited the' : 'Removed the';
    // A note given with its flag or rating ("Rejected …" with a note) goes in the details.
    const withMarker = items.length > 0;
    items.push({
      ...base,
      group: `${field}:${verb}|${o.personId}`,
      text: (s) => `${verb} ${noun} on ${s}${who}`,
      detail: `${verb} ${noun} on ${name}${who}${text ? `: ${quoted(short(text, 60))}` : ''}`,
      quiet: quiet || withMarker,
    });
  }
  return items;
}

function listingItems(c: RecordChange, lookup: HistoryLookup, ctx: Context): Item[] {
  const before = c.before as Listing | null;
  const after = c.after as Listing | null;
  const l = (after ?? before)!;
  const name = unitNameById(l.unitId, lookup);
  const site = SITE_LABELS[l.site] ?? 'listing';
  // A unit added with its listing, or a rent typed in the form that went into the price
  // history, says it once: "Added Unit 1504", "Rent $1,650 → $1,600 on Unit 1504".
  const base = {
    subject: name,
    noun: 'unit',
    quiet: ctx.addedUnits.has(l.unitId) || ctx.rentChanged.has(l.unitId),
  };
  const life = lifeOf(before, after);
  if (life === 'added')
    return [
      {
        ...base,
        group: `listing-add:${site}`,
        text: (s) => `Added a ${site} listing to ${s}`,
        detail: `Added a ${site} listing to ${name}`,
      },
    ];
  if (life === 'deleted' || life === 'removed')
    return [
      {
        ...base,
        group: 'listing-del',
        text: (s) => `Deleted a listing on ${s}`,
        detail: `Deleted a ${site} listing on ${name}`,
      },
    ];
  const seen = (after?.observations ?? []).length > (before?.observations ?? []).length;
  const price = after?.observations.at(-1)?.rent;
  if (seen && price !== undefined)
    return [
      {
        ...base,
        group: `listing-price:${price}`,
        text: (s) => `Price ${money(price)} seen on ${s}`,
        detail: `Price ${money(price)} seen on ${site} for ${name}`,
      },
    ];
  return [
    {
      ...base,
      group: 'listing-edit',
      text: (s) => `Updated a listing on ${s}`,
      detail: `Updated the ${site} listing on ${name}`,
    },
  ];
}

function noteItems(c: RecordChange, lookup: HistoryLookup, ctx: Context): Item[] {
  const before = c.before as NoteEntry | null;
  const after = c.after as NoteEntry | null;
  const n = (after ?? before)!;
  const subject = n.unitId
    ? unitNameById(n.unitId, lookup)
    : n.buildingId
      ? buildingName(
          lookup.buildings.get(n.buildingId) ??
            ({ name: 'a building', complexName: null, address: { line1: '' } } as Building),
        )
      : 'a note';
  const noun = n.unitId ? 'unit' : 'building';
  const quiet = !!n.unitId && ctx.addedUnits.has(n.unitId);
  const life = lifeOf(before, after);
  const text = quoted(short(n.text, 60));
  const kind = n.kind === 'tour' ? 'tour note' : n.kind === 'call' ? 'call note' : 'note';
  const verb =
    life === 'added'
      ? `Added a ${kind} to`
      : life === 'deleted' || life === 'removed'
        ? `Deleted a ${kind} on`
        : life === 'restored'
          ? `Restored a ${kind} on`
          : `Edited a ${kind} on`;
  return [
    {
      subject,
      noun,
      quiet,
      group: `note:${verb}`,
      text: (s) => `${verb} ${s}`,
      detail: `${verb} ${subject}: ${text}`,
    },
  ];
}

function personItems(c: RecordChange, lookup: HistoryLookup): Item[] {
  const before = c.before as Person | null;
  const after = c.after as Person | null;
  const p = (after ?? before)!;
  const me = isMe(p.id, lookup);
  const base = { subject: p.name, noun: 'person' };
  const life = lifeOf(before, after);
  if (life === 'added')
    return [{ ...base, group: 'person-add', text: (s) => `Added ${s}`, detail: `Added ${p.name}` }];
  if (life === 'deleted' || life === 'removed')
    return [
      {
        ...base,
        group: 'person-del',
        text: (s) => `Removed ${s} and their ratings`,
        detail: `Removed ${p.name} and their ratings`,
      },
    ];
  if (life === 'restored')
    return [
      {
        ...base,
        group: 'person-restore',
        text: (s) => `Brought back ${s} and their ratings`,
        detail: `Brought back ${p.name}`,
      },
    ];
  const items: Item[] = [];
  if (before!.name !== after!.name) {
    const text = me
      ? `Changed your name to ${after!.name}`
      : `Renamed ${before!.name} to ${after!.name}`;
    items.push({ ...base, group: `person-name:${p.id}`, text: () => text, detail: text });
  }
  if (before!.color !== after!.color) {
    const text = me ? 'Changed your color' : `Changed ${p.name}’s color`;
    items.push({
      ...base,
      group: `person-color:${p.id}`,
      text: () => text,
      detail: `${text} to ${after!.color}`,
    });
  }
  for (const color of LABEL_COLORS) {
    const was = before!.labelNames[color];
    const now = after!.labelNames[color];
    if (was === now) continue;
    const whose = me ? 'your' : `${p.name}’s`;
    const text = `Named ${whose} ${color} label ${quoted(now ?? capitalize(color))}`;
    items.push({ ...base, group: `person-label:${p.id}:${color}`, text: () => text, detail: text });
  }
  return items;
}

const SCALE_TEXT = { none: 'not scaled', sqft: 'scaled by size', bedrooms: 'scaled by bedrooms' };

/** Cost profile changes in words (M9): "Electric estimate $55 → $60/mo". */
export function costProfileChanges(a: CostProfile, b: CostProfile): [string, string][] {
  const out: [string, string][] = [];
  for (const key of Object.keys(b.items) as CostItemKey[]) {
    const was = a.items[key];
    const now = b.items[key];
    if (!now) continue;
    const name = (COST_ITEM_LABELS[key] ?? key).replace(/, per .*$/, '');
    if (!was || was.monthly !== now.monthly)
      out.push([
        `cost:${key}`,
        `${name} estimate ${was ? money(was.monthly) : 'unknown'} → ${money(now.monthly)}/mo`,
      ]);
    if (was && (was.scaleBy !== now.scaleBy || was.basis !== now.basis)) {
      const basis =
        now.scaleBy === 'sqft'
          ? ` at ${num(now.basis)} ft²`
          : now.scaleBy === 'bedrooms'
            ? ` at ${plural(now.basis, 'bedroom')}`
            : '';
      out.push([`cost-scale:${key}`, `${name} estimate ${SCALE_TEXT[now.scaleBy]}${basis}`]);
    }
  }
  if (a.parkingSpacesNeeded !== b.parkingSpacesNeeded)
    out.push([
      'cost:parking-needed',
      `Parking spaces you need ${a.parkingSpacesNeeded} → ${b.parkingSpacesNeeded}`,
    ]);
  if (a.needsStorage !== b.needsStorage)
    out.push(['cost:storage', b.needsStorage ? 'You need storage' : 'You don’t need storage']);
  if (a.hasPets.cats !== b.hasPets.cats || a.hasPets.dogs !== b.hasPets.dogs)
    out.push([
      'cost:pets',
      `Pets: ${plural(b.hasPets.cats, 'cat')}, ${plural(b.hasPets.dogs, 'dog')}`,
    ]);
  if (a.amortizeOneTimeFees !== b.amortizeOneTimeFees)
    out.push([
      'cost:spread-fees',
      `${b.amortizeOneTimeFees ? 'Spreading' : 'Stopped spreading'} one-time fees over the lease`,
    ]);
  if (a.amortizeSpecials !== b.amortizeSpecials)
    out.push([
      'cost:spread-specials',
      `${b.amortizeSpecials ? 'Spreading' : 'Stopped spreading'} move-in specials over the lease`,
    ]);
  if (a.defaultLeaseMonths !== b.defaultLeaseMonths)
    out.push([
      'cost:lease',
      `Default lease length ${monthsLabel(a.defaultLeaseMonths)} → ${monthsLabel(b.defaultLeaseMonths)}`,
    ]);
  return out;
}

function settingsItems(c: RecordChange): Item[] {
  const before = (c.before as Settings | null) ?? defaultSettings();
  const after = (c.after as Settings | null) ?? defaultSettings();
  const base = { subject: 'settings', noun: 'setting' };
  const items: Item[] = [];
  const say = (group: string, text: string) =>
    items.push({ ...base, group, text: () => text, detail: text });

  for (const color of LABEL_COLORS) {
    if (before.labelNames[color] !== after.labelNames[color])
      say(
        `label:${color}`,
        `Named the shared ${color} label ${quoted(after.labelNames[color] ?? '')}`,
      );
  }
  const was = new Map(before.rejectReasons.map((r) => [r.id, r]));
  for (const r of after.rejectReasons) {
    const old = was.get(r.id);
    if (!old) say(`reason-add:${r.id}`, `Added the reject reason ${quoted(r.label)}`);
    else {
      if (old.label !== r.label)
        say(
          `reason-name:${r.id}`,
          `Renamed the reject reason ${quoted(old.label)} to ${quoted(r.label)}`,
        );
      if (old.archived !== r.archived)
        say(
          `reason-arch:${r.id}`,
          r.archived
            ? `Archived the reject reason ${quoted(r.label)}`
            : `Brought back the reject reason ${quoted(r.label)}`,
        );
    }
  }
  for (const r of before.rejectReasons) {
    if (!after.rejectReasons.some((x) => x.id === r.id))
      say(`reason-del:${r.id}`, `Removed the reject reason ${quoted(r.label)}`);
  }
  if (before.backup.remindEveryDays !== after.backup.remindEveryDays)
    say('backup', `Backup reminder every ${plural(after.backup.remindEveryDays, 'day')}`);
  for (const [group, text] of costProfileChanges(before.costProfile, after.costProfile))
    say(group, text);
  const other = diffPaths(before, after).filter(
    (p) => !['labelNames', 'rejectReasons', 'backup', 'costProfile'].includes(p[0]!),
  );
  if (other.length) {
    const areas = [...new Set(other.map((p) => p[0]!))];
    const names: Record<string, string> = {
      map: 'map settings',
      costProfile: 'the cost profile',
      baseline: 'baseline criteria',
      theme: 'the theme',
      essentialFields: 'essential fields',
      photoArchive: 'photo archive settings',
    };
    say('settings', `Changed ${areas.map((a) => names[a] ?? 'settings').join(' and ')}`);
  }
  return items;
}

interface Context {
  addedUnits: Set<ID>;
  /** Units whose rent this action changed. */
  rentChanged: Set<ID>;
  addedUnitBuildings: Set<ID>;
  deletedBuildings: Set<ID>;
  restoredBuildings: Set<ID>;
  unitsByBuilding: Map<ID, number>;
  removedPeople: Set<ID>;
  restoredPeople: Set<ID>;
}

function contextOf(changes: readonly RecordChange[]): Context {
  const ctx: Context = {
    addedUnits: new Set(),
    rentChanged: new Set(),
    addedUnitBuildings: new Set(),
    deletedBuildings: new Set(),
    restoredBuildings: new Set(),
    unitsByBuilding: new Map(),
    removedPeople: new Set(),
    restoredPeople: new Set(),
  };
  for (const c of changes) {
    const life = lifeOf(c.before as Rec | null, c.after as Rec | null);
    if (c.table === 'buildings' && (life === 'deleted' || life === 'removed'))
      ctx.deletedBuildings.add(c.key);
    if (c.table === 'buildings' && life === 'restored') ctx.restoredBuildings.add(c.key);
    if (c.table === 'people' && (life === 'deleted' || life === 'removed'))
      ctx.removedPeople.add(c.key);
    if (c.table === 'people' && life === 'restored') ctx.restoredPeople.add(c.key);
  }
  for (const c of changes) {
    if (c.table !== 'units') continue;
    const u = (c.after ?? c.before) as Unit;
    const life = lifeOf(c.before as Rec | null, c.after as Rec | null);
    if (life === 'changed' && (c.before as Unit).rent !== (c.after as Unit).rent)
      ctx.rentChanged.add(u.id);
    if (life === 'added') {
      ctx.addedUnits.add(u.id);
      ctx.addedUnitBuildings.add(u.buildingId);
    }
    const together =
      ((life === 'deleted' || life === 'removed') && ctx.deletedBuildings.has(u.buildingId)) ||
      (life === 'restored' && ctx.restoredBuildings.has(u.buildingId));
    if (together)
      ctx.unitsByBuilding.set(u.buildingId, (ctx.unitsByBuilding.get(u.buildingId) ?? 0) + 1);
  }
  return ctx;
}

function itemsOf(c: RecordChange, lookup: HistoryLookup, ctx: Context): Item[] {
  switch (c.table) {
    case 'units':
      return unitItems(c, lookup, ctx);
    case 'buildings':
      return buildingItems(c, ctx);
    case 'opinions':
      return opinionItems(c, lookup, ctx);
    case 'listings':
      return listingItems(c, lookup, ctx);
    case 'notes':
      return noteItems(c, lookup, ctx);
    case 'people':
      return personItems(c, lookup);
    case 'settings':
      return settingsItems(c);
    case 'imports':
      return [
        {
          group: 'import',
          subject: 'pasted text',
          noun: 'paste',
          text: () => 'Kept the pasted text',
          detail: 'Kept the pasted text with its sources',
          quiet: true,
        },
      ];
    default: {
      const noun = c.table.replace(/s$/, '');
      return [
        {
          group: `table:${c.table}`,
          subject: noun,
          noun,
          text: () => `Changed ${c.table}`,
          detail: `Changed a ${noun}`,
        },
      ];
    }
  }
}

function touched(changes: readonly RecordChange[]) {
  const unitIds = new Set<ID>();
  const buildingIds = new Set<ID>();
  for (const c of changes) {
    const r = (c.after ?? c.before) as Rec;
    if (c.table === 'units') {
      unitIds.add(c.key);
      buildingIds.add(r.buildingId as ID);
    } else if (c.table === 'buildings') buildingIds.add(c.key);
    else if (typeof r.unitId === 'string') unitIds.add(r.unitId);
    else if (typeof r.buildingId === 'string') buildingIds.add(r.buildingId);
  }
  return { unitIds: [...unitIds], buildingIds: [...buildingIds] };
}

/** At most this many separate things in a title; the rest are counted. */
const TITLE_PARTS = 2;

/** Says what a set of changes did, in one line plus one line per change. */
export function describeChanges(
  changes: readonly RecordChange[],
  lookup: HistoryLookup,
): Description {
  const ctx = contextOf(changes);
  // Settings changes made along the way (a new reject reason) come after what was done.
  const ordered = [...changes].sort(
    (a, b) => Number(a.table === 'settings') - Number(b.table === 'settings'),
  );
  const items = ordered.flatMap((c) => itemsOf(c, lookup, ctx));
  const groups = new Map<string, Item[]>();
  for (const item of items) {
    if (item.quiet) continue;
    const list = groups.get(item.group);
    if (list) list.push(item);
    else groups.set(item.group, [item]);
  }
  const parts = [...groups.values()].map((list) => {
    const first = list[0]!;
    const many = first.noun === 'person' ? 'people' : `${first.noun}s`;
    return first.text(
      listNames(
        list.map((i) => i.subject),
        first.noun,
        many,
      ),
    );
  });
  // Many fields of one unit or building changed at once (an edit): name them together.
  let title: string;
  if (!parts.length) {
    const first = items[0];
    title = first ? first.text(first.subject) : 'No changes';
  } else if (parts.length <= TITLE_PARTS) title = parts.join('; ');
  else {
    const subjects = new Set([...groups.values()].flat().map((i) => i.subject));
    title =
      subjects.size === 1 &&
      [...groups.keys()].every(
        (g) => g.startsWith('unit:') || g.startsWith('building:') || g.startsWith('listing-'),
      )
        ? `Changed ${plural(parts.length, 'detail')} on ${[...subjects][0]}`
        : `${parts.slice(0, TITLE_PARTS).join('; ')} and ${plural(parts.length - TITLE_PARTS, 'more change')}`;
  }
  return { title, details: items.map((i) => i.detail), ...touched(changes) };
}

/** Labels of the history actions "Undo this" and "Restore to here" write (commands/history.ts). */
export const UNDO_THIS_LABEL = 'Undo this';
export const RESTORE_TO_LABEL = 'Restore to here';

export interface ActionInfo {
  actionId: string;
  label: string;
  kind: 'do' | 'undo' | 'redo';
  target: string | null;
  at: string;
}

/**
 * Says what one action did. Undo and redo (and "Undo this") name the action they went back
 * on, when its changes are still in the history; "Restore to here" names the point.
 */
export function describeAction(
  action: ActionInfo,
  entries: readonly ChangeEntry[],
  lookup: HistoryLookup,
  targetEntries: readonly ChangeEntry[] | null = null,
  formatTime: (iso: string) => string = (iso) => iso,
): Description {
  const own = describeChanges(netChanges(entries), lookup);
  const target = targetEntries?.length ? describeChanges(netChanges(targetEntries), lookup) : null;
  if (action.kind === 'undo' || action.label === UNDO_THIS_LABEL) {
    return target
      ? { ...own, title: `Undid: ${target.title}` }
      : { ...own, title: `Undid: ${own.title}` };
  }
  if (action.kind === 'redo') return target ? { ...own, title: `Redid: ${target.title}` } : own;
  if (action.label === RESTORE_TO_LABEL && targetEntries?.length) {
    const at = formatTime(targetEntries[0]!.at);
    return { ...own, title: `Went back to ${at}: ${plural(own.details.length, 'change')}` };
  }
  return own;
}

// ── Going back on one action ───────────────────────────────────────────────

/** A value "Undo this" would set back, but which was changed again after the action. */
export interface Clash {
  table: string;
  key: string;
  /** Empty for the whole record (it was added by the action and changed since). */
  path: string[];
  /** What the action set it to. */
  actionValue: unknown;
  /** What it is now. */
  currentValue: unknown;
  /** What undoing would set it to. */
  restoreValue: unknown;
  /** The record (as it is now, or as it was), to name it. */
  record: unknown;
}

export interface Write {
  table: string;
  key: string;
  /** null = delete the record. */
  value: Rec | null;
}

export interface RevertPlan {
  /** Writes that don't overwrite anything changed later. */
  safe: Write[];
  /** Writes that go back regardless (overwriting later changes). */
  all: Write[];
  clashes: Clash[];
}

/**
 * What undoing one past action on its own would write (PLAN.md §5.6, owner note 3). Each
 * value the action changed goes back, unless it was changed again later: that's a clash,
 * which `safe` leaves alone and `all` overwrites. Undoing a soft delete only clears
 * `deletedAt`, so restoring a deleted unit or building never clashes.
 */
export function planRevert(
  changes: readonly RecordChange[],
  current: ReadonlyMap<string, unknown>,
  now: string,
): RevertPlan {
  const plan: RevertPlan = { safe: [], all: [], clashes: [] };
  for (const c of changes) {
    const id = `${c.table}\u0000${c.key}`;
    const cur = (current.get(id) ?? null) as Rec | null;
    const before = c.before as Rec | null;
    const after = c.after as Rec | null;
    if (sameValue(cur, before)) continue; // already back
    if (sameValue(cur, after)) {
      const write = { table: c.table, key: c.key, value: before };
      plan.safe.push(write);
      plan.all.push(write);
      continue;
    }
    if (!before || !after || !cur) {
      // Added by the action and changed since, or gone/back again since: the whole record.
      plan.clashes.push({
        table: c.table,
        key: c.key,
        path: [],
        actionValue: after,
        currentValue: cur,
        restoreValue: before,
        record: cur ?? after ?? before,
      });
      plan.all.push({ table: c.table, key: c.key, value: before });
      continue;
    }
    const safe = structuredClone(cur);
    const all = structuredClone(cur);
    let safeChanged = false;
    let allChanged = false;
    for (const path of diffPaths(before, after)) {
      if (path[0] === 'updatedAt') continue;
      const was = getPath(before, path);
      const set = getPath(after, path);
      const nowValue = getPath(cur, path);
      if (sameValue(nowValue, was)) continue;
      setPath(all, path, was);
      allChanged = true;
      if (sameValue(nowValue, set)) {
        setPath(safe, path, was);
        safeChanged = true;
      } else {
        plan.clashes.push({
          table: c.table,
          key: c.key,
          path,
          actionValue: set,
          currentValue: nowValue,
          restoreValue: was,
          record: cur,
        });
      }
    }
    if (safeChanged)
      plan.safe.push({ table: c.table, key: c.key, value: { ...safe, updatedAt: now } });
    if (allChanged)
      plan.all.push({ table: c.table, key: c.key, value: { ...all, updatedAt: now } });
  }
  return plan;
}

/** "Rent on Unit 908 is $1,550 now; undoing sets it back to $1,650." */
export function describeClash(clash: Clash, lookup: HistoryLookup): string {
  const rec = clash.record as Rec | null;
  let subject = 'a record';
  if (clash.table === 'units' && rec) subject = unitName(rec as Unit, lookup);
  else if (clash.table === 'buildings' && rec) subject = buildingName(rec as Building);
  else if (rec && typeof rec.unitId === 'string') subject = unitNameById(rec.unitId, lookup);
  if (!clash.path.length) {
    if (!clash.restoreValue)
      return `${capitalize(subject)} was changed after it was added; undoing removes it with those changes.`;
    if (!clash.currentValue)
      return `${capitalize(subject)} is gone now; undoing brings back the earlier version.`;
    return `${capitalize(subject)} was changed again later; undoing replaces the whole record.`;
  }
  const isUnit = clash.table === 'units';
  const field = isUnit ? fieldLabel(clash.path, 'units') : fieldLabel(clash.path, 'buildings');
  const fmt = (v: unknown) => (isUnit ? unitValue(clash.path, v) : valueText(v));
  return `${field} on ${subject} is ${fmt(clash.currentValue)} now; undoing sets it back to ${fmt(clash.restoreValue)}.`;
}

// ── Restore to a point ─────────────────────────────────────────────────────

/**
 * The values every record had right after a point in history (PLAN.md §5.6, owner note 2):
 * for each record changed later, the `before` of its first later change.
 */
export function stateAfter(laterEntries: readonly ChangeEntry[]): Write[] {
  const seen = new Set<string>();
  const writes: Write[] = [];
  for (const e of [...laterEntries].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))) {
    const id = `${e.table}\u0000${e.key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    writes.push({ table: e.table, key: e.key, value: (e.before as Rec | null) ?? null });
  }
  return writes;
}
