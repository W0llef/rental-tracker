import type Dexie from 'dexie';
import type { Transaction } from 'dexie';
import { DATA_TABLES } from '../model';
import type { Migration } from './migrations';

/**
 * Every Dexie version the app has ever had (PLAN.md §3.6–3.7). Never edit a released entry;
 * add a new one. Only indexed properties are declared: adding an unindexed field needs no
 * new version, only a migration if existing records need a default.
 */

export const STORES_V1 = {
  buildings: 'id, address.normalized, complexName, updatedAt, deletedAt',
  units:
    'id, buildingId, [buildingId+unitKey], status, flag, rating, colorLabel, *collectionIds, updatedAt, deletedAt',
  listings: 'id, unitId, url, site, lastSeen, deletedAt',
  destinations: 'id, deletedAt',
  collections: 'id, kind, order, deletedAt',
  notes: 'id, unitId, buildingId, createdAt, deletedAt',
  photos: 'id, [ownerType+ownerId], kind, deletedAt',
  thumbs: 'photoId', // 480 px WebP blobs
  originals: 'photoId', // last-resort blob store (no FSA, no OPFS)
  imports: 'id, kind, createdAt', // pasted AI / listing text / batch grid, for re-review
  settings: 'id',
  changeLog: '++seq, actionId, at, [table+key]',
  snapshots: '++seq, at', // pre-migration safety copies (keeps the last 3)
  handles: 'id', // FileSystemDirectoryHandle for the photo folder
  geocodeCache: 'key, at',
  travelCache: 'key, at', // Phase 2
  meta: 'key', // schemaVersion, installId, first-run flags
} as const;

export interface VersionSpec {
  version: number;
  /** Dexie store declarations that change in this version (null deletes a table). */
  stores: Record<string, string | null>;
  /** The data transform for this version; none for version 1. */
  migration?: Migration;
}

export const versions: VersionSpec[] = [
  { version: 1, stores: STORES_V1 },
  // Next: { version: 2, stores: { …only changed stores… }, migration: v2 },
];

/** How many pre-migration snapshots to keep. */
export const SNAPSHOTS_KEPT = 3;

export interface Snapshot {
  seq?: number;
  at: string;
  fromVersion: number;
  toVersion: number;
  data: Record<string, unknown[]>;
}

/** Declares every version on a Dexie instance, with snapshot + migration upgrades. */
export function declareVersions(db: Dexie, list: VersionSpec[] = versions): void {
  for (const spec of list) {
    const version = db.version(spec.version).stores(spec.stores);
    const migration = spec.migration;
    if (migration) {
      version.upgrade(async (tx) => {
        await takeSnapshot(tx, spec.version - 1, spec.version);
        await runMigration(tx, migration);
      });
    }
  }
}

/** Copies every data table into `snapshots` before a migration touches it. */
export async function takeSnapshot(tx: Transaction, fromVersion: number, toVersion: number) {
  const data: Record<string, unknown[]> = {};
  for (const table of DATA_TABLES) {
    data[table] = await tx.table(table).toArray();
  }
  const snapshots = tx.table<Snapshot, number>('snapshots');
  await snapshots.add({ at: new Date().toISOString(), fromVersion, toVersion, data });
  const keys = await snapshots.toCollection().primaryKeys();
  const old = keys.slice(0, Math.max(0, keys.length - SNAPSHOTS_KEPT));
  if (old.length) await snapshots.bulkDelete(old);
}

async function runMigration(tx: Transaction, migration: Migration) {
  for (const [table, transform] of Object.entries(migration.tables)) {
    if (!transform) continue;
    await tx
      .table(table)
      .toCollection()
      .modify((value, ref) => {
        ref.value = transform(value as Record<string, unknown>);
      });
  }
}
