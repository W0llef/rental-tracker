import { buildingSearchText, matchesWords, queryWords, unitSearchText } from '../domain/filter';
import { listingAgeDays } from '../domain/listings';
import { isStandalone } from '../domain/standalone';
import { sortBuildings, sortUnits } from '../domain/sort';
import type { PersonOpinion } from '../domain/people';
import { emptyOpinionFields, newPerson } from '../model/factories';
import type {
  Building,
  ID,
  ISODate,
  Listing,
  NoteEntry,
  Opinion,
  OpinionFields,
  Person,
  Settings,
  SortSpec,
  Unit,
} from '../model';

/**
 * Pure derivation from stored records to what the list and panels show (PLAN.md §4.2).
 * One dataset feeds the list, the detail panel and (from M3) the map.
 */

export interface RawData {
  buildings: Building[];
  units: Unit[];
  listings: Listing[];
  notes: NoteEntry[];
  settings: Settings;
  people: Person[];
  opinions: Opinion[];
  /** This copy's person (meta), or null before it's set up. */
  meId: ID | null;
}

/** A note, with who wrote it when that wasn't you (null for yours and the app's). */
export type NoteRow = NoteEntry & { authorName: string | null };

export interface UnitRow {
  unit: Unit;
  building: Building | undefined;
  listings: Listing[];
  notes: NoteRow[];
  /** Your rating, flag and notes on this unit (empty if you haven't said anything). */
  mine: OpinionFields;
  /** Everyone's opinion, you first, then the others in the order they were added. */
  opinions: PersonOpinion[];
  listingAgeDays: number | null;
  searchText: string;
  /** Its building is a standalone home (Q30): shown as just the home. */
  standalone: boolean;
}

export interface BuildingRow {
  building: Building;
  /** All your units in this building (not deleted). */
  units: UnitRow[];
  /** Units shown under the current search. */
  matching: UnitRow[];
  /** Notes about the building itself, newest first. */
  notes: NoteRow[];
  unitCount: number;
  minRent: number | null;
  maxRent: number | null;
  searchText: string;
  /** A standalone home (Q30): one unit, shown as the home rather than as a building. */
  standalone: boolean;
}

export interface Dataset {
  settings: Settings;
  /** You (this copy's person). */
  me: Person;
  /** Everyone, you first. */
  people: Person[];
  /** Everyone, including people who were removed (their notes still name them). */
  personById: Map<ID, Person>;
  units: UnitRow[];
  buildings: BuildingRow[];
  unitById: Map<ID, UnitRow>;
  buildingById: Map<ID, BuildingRow>;
}

const live = <T extends { deletedAt: string | null }>(rows: readonly T[]): T[] =>
  rows.filter((r) => r.deletedAt === null);

function groupBy<T>(rows: readonly T[], key: (r: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (k === null) continue;
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return map;
}

function pickOpinion(o: Opinion): OpinionFields {
  return {
    rating: o.rating,
    ratingNote: o.ratingNote,
    flag: o.flag,
    flagNote: o.flagNote,
    rejectReasonIds: o.rejectReasonIds,
    colorLabel: o.colorLabel,
    lastReviewedAt: o.lastReviewedAt,
  };
}

/** Joins units with their building, listings and notes; drops soft-deleted records. */
export function deriveDataset(raw: RawData, today: ISODate): Dataset {
  const buildings = live(raw.buildings);
  const buildingMap = new Map(buildings.map((b) => [b.id, b]));
  const listingsByUnit = groupBy(live(raw.listings), (l) => l.unitId);

  const meId = raw.meId ?? '';
  const others = live(raw.people)
    .filter((p) => p.id !== meId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const me =
    raw.people.find((p) => p.id === meId && !p.deletedAt) ??
    ({ ...newPerson({ name: 'Me' }, '1970-01-01T00:00:00.000Z'), id: meId } satisfies Person);
  const people = [me, ...others];
  const opinionsByUnit = groupBy(live(raw.opinions), (o) => o.unitId);
  const everyone = new Map(raw.people.map((p) => [p.id, p]));
  const notes: NoteRow[] = live(raw.notes)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) // newest first
    .map((n) => ({
      ...n,
      authorName:
        n.authorId && n.authorId !== meId ? (everyone.get(n.authorId)?.name ?? 'Someone') : null,
    }));
  const notesByUnit = groupBy(notes, (n) => n.unitId);
  const notesByBuilding = groupBy(notes, (n) => n.buildingId);

  const buildingText = new Map(
    buildings.map((b) => [b.id, buildingSearchText(b, notesByBuilding.get(b.id))]),
  );

  const liveUnits = live(raw.units);
  const unitsIn = groupBy(liveUnits, (u) => u.buildingId);
  const standaloneById = new Map(
    buildings.map((b) => [b.id, isStandalone(b, unitsIn.get(b.id) ?? [])]),
  );

  const units: UnitRow[] = liveUnits.map((unit) => {
    const listings = listingsByUnit.get(unit.id) ?? [];
    const unitNotes = notesByUnit.get(unit.id) ?? [];
    const stored = new Map((opinionsByUnit.get(unit.id) ?? []).map((o) => [o.personId, o]));
    const opinions: PersonOpinion[] = people.map((person) => {
      const record = stored.get(person.id) ?? null;
      return {
        person,
        isMe: person.id === me.id,
        record,
        opinion: record ? pickOpinion(record) : emptyOpinionFields(),
      };
    });
    return {
      unit,
      building: buildingMap.get(unit.buildingId),
      listings,
      notes: unitNotes,
      mine: opinions[0]!.opinion,
      opinions,
      listingAgeDays: listingAgeDays(listings, today),
      searchText: `${unitSearchText(unit, unitNotes)} ${buildingText.get(unit.buildingId) ?? ''}`,
      standalone: standaloneById.get(unit.buildingId) ?? false,
    };
  });

  const unitsByBuilding = groupBy(units, (u) => u.unit.buildingId);
  const buildingRows: BuildingRow[] = buildings.map((building) => {
    const own = unitsByBuilding.get(building.id) ?? [];
    const rents = own.map((u) => u.unit.rent).filter((r): r is number => r !== null);
    return {
      building,
      units: own,
      matching: own,
      notes: notesByBuilding.get(building.id) ?? [],
      unitCount: own.length,
      minRent: rents.length ? Math.min(...rents) : null,
      maxRent: rents.length ? Math.max(...rents) : null,
      searchText: buildingText.get(building.id) ?? '',
      standalone: standaloneById.get(building.id) ?? false,
    };
  });

  return {
    settings: raw.settings,
    me,
    people,
    personById: everyone,
    units,
    buildings: buildingRows,
    unitById: new Map(units.map((u) => [u.unit.id, u])),
    buildingById: new Map(buildingRows.map((b) => [b.building.id, b])),
  };
}

export interface ListView {
  units: UnitRow[];
  buildings: BuildingRow[];
}

/**
 * What the list shows for a search and sort. Buildings view lists buildings that have at
 * least one unit (or match the search themselves), with only the matching units counted.
 */
export function deriveListView(
  data: Dataset,
  query: string,
  unitSort: SortSpec,
  buildingSort: SortSpec,
): ListView {
  const words = queryWords(query);
  const units = words.length
    ? data.units.filter((u) => matchesWords(u.searchText, words))
    : data.units;

  const buildings = data.buildings
    .map((b) => {
      if (!words.length) return b;
      const matching = b.units.filter((u) => matchesWords(u.searchText, words));
      const selfMatch = matchesWords(b.searchText, words);
      return { ...b, matching: selfMatch ? b.units : matching };
    })
    .filter((b) => b.unitCount > 0 && b.matching.length > 0);

  return {
    units: sortUnits(units, unitSort),
    buildings: sortBuildings(buildings, buildingSort),
  };
}

// ── Map (M3) ───────────────────────────────────────────────────────────────

export interface MapBuilding {
  id: ID;
  building: Building;
  lng: number;
  lat: number;
  /** The building's units the map shows (the list's units, under the current search). */
  units: UnitRow[];
}

export interface MapItems {
  buildings: MapBuilding[];
  /** Units shown in the list that can't be mapped yet ("Needs location"). */
  needLocation: number;
}

/**
 * What the map shows: one entry per building that has visible units and a location
 * (PLAN.md §4.3). Uses the list's own rows, so search and the Units/Buildings switch drive
 * the map and the list together.
 */
export function deriveMapItems(view: ListView, mode: 'units' | 'buildings'): MapItems {
  const groups =
    mode === 'buildings'
      ? view.buildings.map((b) => ({ building: b.building, units: b.matching }))
      : [...groupBy(view.units, (u) => u.unit.buildingId)].flatMap(([, units]) => {
          const building = units[0]?.building;
          return building ? [{ building, units }] : [];
        });

  let needLocation = 0;
  const buildings: MapBuilding[] = [];
  for (const g of groups) {
    const loc = g.building.location;
    if (!loc) {
      needLocation += g.units.length;
      continue;
    }
    buildings.push({
      id: g.building.id,
      building: g.building,
      lng: loc.lng,
      lat: loc.lat,
      units: g.units,
    });
  }
  if (mode === 'units') needLocation += view.units.filter((u) => !u.building).length;
  return { buildings, needLocation };
}
