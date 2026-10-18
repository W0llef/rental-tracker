import type { z } from 'zod';
import { building } from './building';
import { opinion, person } from './people';
import { collection, destination, importBatch, listing, noteEntry, photo } from './records';
import { settings } from './settings';
import { unit } from './unit';

/**
 * The data model. zod schemas are the source of truth; TypeScript types are inferred.
 *
 * SCHEMA_VERSION equals the Dexie version (db/versions.ts) and is written into every
 * backup and photo sidecar. Changing the shape of stored data means a new version, a
 * migration in db/migrations/, a fixture and a test (PLAN.md §3.7).
 */
export const SCHEMA_VERSION = 2;

export * from './common';
export * from './building';
export * from './unit';
export * from './people';
export * from './records';
export * from './filters';
export * from './settings';

/**
 * Tables that hold the owner's data: every write to them goes through a command and is
 * recorded in the change log (undoable), and they're what a backup contains.
 */
export const recordSchemas = {
  buildings: building,
  units: unit,
  people: person,
  opinions: opinion,
  listings: listing,
  destinations: destination,
  collections: collection,
  notes: noteEntry,
  photos: photo,
  imports: importBatch,
  settings,
} as const satisfies Record<string, z.ZodType>;

export type DataTable = keyof typeof recordSchemas;
export const DATA_TABLES = Object.keys(recordSchemas) as DataTable[];

export type RecordOf<T extends DataTable> = z.infer<(typeof recordSchemas)[T]>;
