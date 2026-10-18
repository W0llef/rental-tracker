import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../db/db';
import { readMeId } from '../db/me';
import { localDate } from '../domain/format';
import { defaultSettings } from '../model';
import { deriveDataset } from './derive';
import type { Dataset, RawData } from './derive';

async function readAll(): Promise<RawData> {
  const [buildings, units, listings, notes, settings, people, opinions, meId] = await Promise.all([
    db.buildings.toArray(),
    db.units.toArray(),
    db.listings.toArray(),
    db.notes.toArray(),
    db.settings.get('app'),
    db.people.toArray(),
    db.opinions.toArray(),
    readMeId(db),
  ]);
  return {
    buildings,
    units,
    listings,
    notes,
    settings: settings ?? defaultSettings(),
    people,
    opinions,
    meId,
  };
}

/**
 * The whole dataset, re-read automatically whenever a command changes it (useLiveQuery).
 * `undefined` while the first read is in progress.
 */
export function useDataset(): Dataset | undefined {
  const raw = useLiveQuery(readAll, []);
  // "Today" is fixed per read: listing ages update when the data does or on reload.
  return useMemo(() => (raw ? deriveDataset(raw, localDate()) : undefined), [raw]);
}
