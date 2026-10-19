import type Dexie from 'dexie';
import type { Transaction } from 'dexie';
import { DATA_TABLES } from '../model';
import { migrationContext } from './migrations';
import type { Migration, MigrationContext } from './migrations';
import { v2 } from './migrations/v2';
import { v3 } from './migrations/v3';

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

/** Version 2 (M6): people and their opinions; units lose the per-person indexes. */
export const STORES_V2 = {
  units:
    'id, buildingId, [buildingId+unitKey], status, colorLabel, *collectionIds, updatedAt, deletedAt',
  people: 'id, deletedAt',
  opinions: 'id, &[unitId+personId], unitId, personId, deletedAt',
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
  { version: 2, stores: STORES_V2, migration: v2 },
  // Version 3 (M8): new unindexed fields only, so no store changes.
  { version: 3, stores: {}, migration: v3 },
  // Next: { version: 4, stores: { …only changed stores… }, migration: v4 },
];

/** The meta key holding which person this browser's copy belongs to (db/me.ts). */
export const ME_META_KEY = 'meId';

/** How many snapshots of each kind to keep. */
export const SNAPSHOTS_KEPT = 3;

/**
 * A safety copy of every data table, taken before something replaces or reshapes the data:
 * an app update that migrates the data, or a restore (M5). Not a data table itself: not
 * undoable and not in backups. Settings → Backup and restore lists them for download.
 */
export interface Snapshot {
  seq?: number;
  at: string;
  /** The data format version of `data`. */
  fromVersion: number;
  /** The version the data was about to become (same as fromVersion for a restore). */
  toVersion: number;
  /** Why it was taken. Missing on snapshots from before M5, which were all migrations. */
  reason?: SnapshotReason;
  /** Whose copy it was ("me" when it was taken; from M6), so restoring it keeps you you. */
  meId?: string | null;
  data: Record<string, unknown[]>;
}

export type SnapshotReason = 'migration' | 'restore';

/** Declares every version on a Dexie instance, with snapshot + migration upgrades. */
export function declareVersions(db: Dexie, list: VersionSpec[] = versions): void {
  const latest = Math.max(...list.map((v) => v.version));
  // An update across several versions (v1 → v3) runs each step in the same transaction;
  // one safety copy, taken before the first step, covers them all.
  const copied = new WeakSet<object>();
  for (const spec of list) {
    const version = db.version(spec.version).stores(spec.stores);
    const migration = spec.migration;
    if (migration) {
      version.upgrade(async (tx) => {
        if (!copied.has(tx.idbtrans)) {
          copied.add(tx.idbtrans);
          await takeSnapshot(tx, spec.version - 1, latest);
        }
        const ctx = await upgradeContext(tx);
        await runMigration(tx, migration, ctx);
        if (migration.clearsHistory) await tx.table('changeLog').clear();
        if (migration.createsMe) {
          await tx.table('meta').put({ key: ME_META_KEY, value: ctx.meId });
        }
      });
    }
  }
}

/**
 * Copies every data table into `snapshots` before a migration or a restore touches it, and
 * keeps the newest SNAPSHOTS_KEPT of that kind (so restores never push out the copy taken
 * before an update).
 */
export async function takeSnapshot(
  tx: Transaction,
  fromVersion: number,
  toVersion: number,
  reason: SnapshotReason = 'migration',
): Promise<number> {
  const data: Record<string, unknown[]> = {};
  for (const table of DATA_TABLES) {
    data[table] = await tx.table(table).toArray();
  }
  const snapshots = tx.table<Snapshot, number>('snapshots');
  const me = tx.storeNames.includes('meta')
    ? ((await tx.table('meta').get(ME_META_KEY)) as { value?: unknown } | undefined)
    : undefined;
  const seq = await snapshots.add({
    at: new Date().toISOString(),
    fromVersion,
    toVersion,
    reason,
    ...(typeof me?.value === 'string' ? { meId: me.value } : {}),
    data,
  });
  const all = await snapshots.orderBy('seq').toArray();
  const same = all.filter((s) => (s.reason ?? 'migration') === reason);
  const old = same.slice(0, Math.max(0, same.length - SNAPSHOTS_KEPT)).map((s) => s.seq!);
  if (old.length) await snapshots.bulkDelete(old);
  return seq;
}

/** In the browser's own database "me" is the person already stored, or a new one. */
async function upgradeContext(tx: Transaction): Promise<MigrationContext> {
  const row = (await tx.table('meta').get(ME_META_KEY)) as { value?: unknown } | undefined;
  return migrationContext(typeof row?.value === 'string' ? { meId: row.value } : {});
}

async function runMigration(tx: Transaction, migration: Migration, ctx: MigrationContext) {
  for (const [table, transform] of Object.entries(migration.tables)) {
    if (!transform) continue;
    await tx
      .table(table)
      .toCollection()
      .modify((value, ref) => {
        ref.value = transform(value as Record<string, unknown>);
      });
  }
  const multi = migration.transform;
  if (multi) {
    const input: Record<string, unknown[]> = {};
    for (const table of multi.tables) input[table] = await tx.table(table).toArray();
    const output = multi.run(input, ctx);
    for (const table of multi.tables) {
      await tx.table(table).clear();
      const rows = output[table] ?? [];
      if (rows.length) await tx.table(table).bulkAdd(rows);
    }
  }
}
