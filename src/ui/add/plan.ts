import type { BuildingDraft } from '../../commands/quickAdd';
import { makeAddress, parseAddress, sameAddress } from '../../domain/address';
import { factStatus } from '../../domain/facts';
import type { FactStatus } from '../../domain/facts';
import { buildingSearchText, matchesWords, queryWords } from '../../domain/filter';
import type { Fact } from '../../domain/listingText';
import type { Building, Unit } from '../../model';
import { geocoder } from '../../services/geocode';
import type { Geocoder, Place } from '../../services/geocode';

/** Helpers behind the Quick-add dialog, kept apart so they can be tested. */

/** Fields that have their own box in Quick-add; pasted values fill those boxes instead. */
export const INPUT_FIELDS = {
  'unit.rent': 'rent',
  'unit.bedrooms': 'beds',
  'unit.bathrooms': 'baths',
  'unit.unitNumber': 'unit',
  'unit.floorPlanName': 'plan',
} as const;
export type InputName = (typeof INPUT_FIELDS)[keyof typeof INPUT_FIELDS] | 'address' | 'link';

export const isInputFact = (f: Fact) => f.field in INPUT_FIELDS;

/** Your buildings whose name or address contains every word typed (at most `limit`). */
export function localMatches(buildings: readonly Building[], query: string, limit = 4): Building[] {
  const words = queryWords(query);
  if (!words.length || query.trim().length < 2) return [];
  return buildings
    .filter((b) => !b.deletedAt && matchesWords(buildingSearchText(b), words))
    .slice(0, limit);
}

/** A new building from a geocoder's place. */
export function draftFromPlace(place: Place, nameHint: string | null): BuildingDraft {
  const a = place.address;
  return {
    address: makeAddress(a.line1, a.city, a.state ?? 'MN', a.zip),
    location: place.location,
    name: place.name ?? nameHint,
    neighborhood: place.neighborhood,
  };
}

/** A new building from typed text when no geocoder found it (saved without a location). */
export function draftFromTyped(text: string, nameHint: string | null): BuildingDraft {
  const p = parseAddress(text);
  if (p) {
    return {
      address: makeAddress(p.line1, p.city, p.state ?? 'MN', p.zip),
      location: null,
      name: nameHint,
      neighborhood: null,
    };
  }
  // Not an address (a building's name, say): keep the words so you can find it again.
  const t = text.trim().replace(/\s+/g, ' ');
  return {
    address: makeAddress(t, null, 'MN'),
    location: null,
    name: nameHint ?? t,
    neighborhood: null,
  };
}

/** "201 S Example St, Minneapolis, MN 55401" from parts. */
export function addressText(a: {
  line1: string;
  city: string | null;
  state?: string | null;
  zip?: string | null;
}): string {
  const tail = [a.state, a.zip].filter(Boolean).join(' ');
  return [a.line1, a.city, tail].filter(Boolean).join(', ');
}

export interface Chip {
  fact: Fact;
  status: FactStatus;
  /** On by default: fills an unknown. Off by default: changes a value you have. */
  on: boolean;
}

/**
 * The chips to show for pasted facts, given what's already known: facts that only repeat a
 * value are left out; facts with their own box (rent, beds…) are shown in the box instead.
 */
export function chipsFor(
  facts: readonly Fact[],
  target: { unit?: Unit; building?: Building },
  toggled: ReadonlySet<string>,
  opts: { includeInputs?: boolean } = {},
): Chip[] {
  return facts
    .filter((f) => opts.includeInputs || !isInputFact(f))
    .map((fact) => {
      const status = factStatus(fact, target);
      const def = status === 'fills';
      return { fact, status, on: toggled.has(fact.field) ? !def : def };
    })
    .filter((c) => c.status !== 'same');
}

/** Parses a typed number; '' and junk are unknown. "$1,650" and "1.5" are fine. */
export function numberFrom(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Finds where a typed address is: a suggestion already on screen for the same street
 * address, else one Nominatim lookup. A lookup that comes back with a different street
 * address than the one typed is a guess about some other place, so it's not used. Null
 * when it can't be found or you're offline.
 */
export async function lookUp(
  text: string,
  shown: readonly Place[],
  service: Geocoder = geocoder(),
): Promise<Place | null> {
  const typed = parseAddress(text);
  const same = typed ? shown.find((p) => sameAddress(p.address, typed)) : undefined;
  if (same) return same;
  let place: Place | null;
  try {
    place = await service.lookup(text);
  } catch {
    return null;
  }
  return place && typed && !sameAddress(place.address, typed) ? null : place;
}
