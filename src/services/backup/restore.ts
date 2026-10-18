import Dexie from 'dexie';
import { systemWrite } from '../../commands/action';
import type { RentalDB } from '../../db/db';
import { META_KEYS, setMeta } from '../../db/meta';
import {
  migrateBackupData,
  migrationContext,
  migrations,
  NewerVersionError,
} from '../../db/migrations';
import { takeSnapshot } from '../../db/versions';
import type { Snapshot, SnapshotReason } from '../../db/versions';
import { nameTaken, nextPersonColor, resolveMe } from '../../domain/people';
import { DATA_TABLES, person, SCHEMA_VERSION } from '../../model';
import type { Person, Settings } from '../../model';
import { newPerson } from '../../model/factories';
import { backupEnvelope, currentBackup } from '../../model/backup';
import type { BackupEnvelope, CurrentBackup } from '../../model/backup';
import { backupJson, makeEnvelope, withoutSecrets } from './exportJson';
import type { BackupData } from './exportJson';

/**
 * Restore (Phase 1 = replace everything, Q7; PLAN.md §5.5):
 *   pick file → check it's a backup → migrate if it's older → validate → show counts →
 *   save the current data to a snapshot → replace everything in one transaction →
 *   clear undo history.
 * Nothing is written until the file has passed every check, and a failed restore leaves
 * the data as it was (one transaction).
 */

// ── Reading and checking a file ───────────────────────────────────────────

export interface DataSummary {
  buildings: number;
  units: number;
  listings: number;
  notes: number;
  collections: number;
  photos: number;
  /** Records that were deleted but are kept so deletes can be undone. */
  deleted: number;
}

const isDeleted = (row: unknown) =>
  typeof row === 'object' && row !== null && !!(row as { deletedAt?: unknown }).deletedAt;

/** Counts what a person would call their data: records that aren't deleted. */
export function summarize(data: BackupData): DataSummary {
  const active = (table: string) => (data[table] ?? []).filter((r) => !isDeleted(r)).length;
  let deleted = 0;
  for (const table of DATA_TABLES) deleted += (data[table] ?? []).filter(isDeleted).length;
  return {
    buildings: active('buildings'),
    units: active('units'),
    listings: active('listings'),
    notes: active('notes'),
    collections: active('collections'),
    photos: active('photos'),
    deleted,
  };
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "2 units, 1 building, 3 listings and 1 note". */
export function summaryText(s: DataSummary): string {
  const parts = [
    plural(s.units, 'unit'),
    plural(s.buildings, 'building'),
    plural(s.listings, 'listing'),
    plural(s.notes, 'note'),
  ];
  if (s.collections) parts.push(plural(s.collections, 'collection'));
  if (s.photos) parts.push(plural(s.photos, 'photo'));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]!;
}

export function isEmpty(summary: DataSummary): boolean {
  return summary.buildings + summary.units + summary.listings + summary.notes === 0;
}

export type CheckedBackup =
  | {
      ok: true;
      backup: CurrentBackup;
      /** The data format the file was written in (older files are migrated). */
      fileVersion: number;
      summary: DataSummary;
    }
  | { ok: false; message: string };

const NOT_A_BACKUP = 'This file isn’t a backup from Rental Unit Tracker.';

/** The person using this browser, so an old file's ratings become theirs when migrated. */
export interface CurrentPerson {
  id: string;
  name: string;
}

/**
 * Checks parsed JSON: envelope, version, migration, then every record against the model.
 * A file from before people existed (version 1) has its ratings and flags given to `me`,
 * the person using this browser (or a new "Me" if there's none).
 */
export function checkBackup(value: unknown, me: CurrentPerson | null = null): CheckedBackup {
  const envelope = backupEnvelope.safeParse(value);
  if (!envelope.success) return { ok: false, message: NOT_A_BACKUP };
  const file = { ...envelope.data };

  let data: BackupData;
  try {
    const ctx = migrationContext(me ? { meId: me.id, meName: me.name } : {});
    data = migrateBackupData(file.data, file.schemaVersion, SCHEMA_VERSION, migrations, ctx);
    if (file.schemaVersion < 2) file.exportedBy = ctx.meId;
  } catch (e) {
    if (e instanceof NewerVersionError) return { ok: false, message: e.message };
    return {
      ok: false,
      message: `This backup couldn’t be updated to the current data format. ${errorText(e)}`,
    };
  }
  // Tables this version doesn't know are ignored; missing ones are empty.
  const complete = Object.fromEntries(DATA_TABLES.map((t) => [t, data[t] ?? []]));

  const result = currentBackup.safeParse({
    ...file,
    schemaVersion: SCHEMA_VERSION,
    data: complete,
  });
  if (!result.success) {
    const problems = result.error.issues.slice(0, 3).map((issue) => {
      const where = issue.path.slice(1).join(' › ');
      return where ? `${where}: ${issue.message}` : issue.message;
    });
    const more = result.error.issues.length - problems.length;
    return {
      ok: false,
      message:
        `This backup has records the app can’t read, so nothing was restored. ` +
        `${problems.join('; ')}${more > 0 ? ` (and ${more} more)` : ''}.`,
    };
  }

  for (const table of DATA_TABLES) {
    const ids = new Set<string>();
    for (const row of result.data.data[table] as { id: string }[]) {
      if (ids.has(row.id)) {
        return {
          ok: false,
          message: `This backup has two ${table} with the same id, so nothing was restored.`,
        };
      }
      ids.add(row.id);
    }
  }

  const settingsRows = result.data.data.settings;
  if (settingsRows.length > 1 || settingsRows.some((s) => s.id !== 'app')) {
    return { ok: false, message: `${NOT_A_BACKUP} It has more than one settings record.` };
  }

  return {
    ok: true,
    backup: result.data,
    fileVersion: file.schemaVersion,
    summary: summarize(result.data.data),
  };
}

/** Reads a backup file's text. */
export function checkBackupText(text: string, me: CurrentPerson | null = null): CheckedBackup {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, message: `${NOT_A_BACKUP} It isn’t a readable .json file.` };
  }
  return checkBackup(value, me);
}

export async function checkBackupFile(
  file: Blob,
  me: CurrentPerson | null = null,
): Promise<CheckedBackup> {
  if (file.size > 200 * 1024 * 1024) {
    return { ok: false, message: `${NOT_A_BACKUP} It’s far larger than a backup can be.` };
  }
  return checkBackupText(await file.text(), me);
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

// ── Replacing the data ────────────────────────────────────────────────────

export interface RestoreResult {
  /** The snapshot holding the data that was replaced (null when there was none). */
  snapshotSeq: number | null;
  summary: DataSummary;
}

/**
 * Replaces every data table with the backup's records, in one transaction: first the
 * current data goes into a snapshot, then the tables are emptied and refilled, and the
 * undo history is cleared (its before/after values describe data that's gone).
 * API keys stay with the browser: a backup never carries them.
 */
export async function restoreBackup(db: RentalDB, backup: CurrentBackup): Promise<RestoreResult> {
  const snapshotSeq = await systemWrite(
    db,
    'restore a backup',
    async () => {
      const tx = Dexie.currentTransaction;
      if (!tx) throw new Error('Restore must run in a transaction.');
      // An empty database (a new browser, or after clearing site data) needs no copy.
      let hasData = false;
      for (const table of DATA_TABLES) hasData ||= (await db.table(table).count()) > 0;
      const seq = hasData
        ? await takeSnapshot(tx, SCHEMA_VERSION, SCHEMA_VERSION, 'restore')
        : null;

      const keep = await db.settings.get('app');
      // Who is "me" afterwards (domain/people.ts resolveMe): you, if the file has you; else
      // whoever made the file; else a new person with your current name.
      const metaRow = await db.meta.get(META_KEYS.meId);
      const currentMeId = typeof metaRow?.value === 'string' ? metaRow.value : null;
      const currentMe = currentMeId ? await db.people.get(currentMeId) : undefined;
      const fileMeId = resolveMe(backup.data.people, currentMeId, backup.exportedBy ?? null);
      const extraPeople: Person[] = [];
      if (!fileMeId) {
        const taken = backup.data.people.filter((p) => !p.deletedAt);
        extraPeople.push(
          person.parse({
            ...newPerson({
              name:
                currentMe && !nameTaken(taken, currentMe.name) ? currentMe.name : uniqueMe(taken),
              color: currentMe?.color ?? nextPersonColor(taken),
            }),
            ...(currentMeId && !backup.data.people.some((p) => p.id === currentMeId)
              ? { id: currentMeId }
              : {}),
          }),
        );
      }

      for (const table of DATA_TABLES) await db.table(table).clear();
      for (const table of DATA_TABLES) {
        let rows = backup.data[table] as unknown[];
        if (table === 'settings' && keep) {
          rows = (rows as Settings[]).map((s) => ({ ...s, apiKeys: keepKeys(s, keep) }));
        }
        if (table === 'people') rows = [...rows, ...extraPeople];
        if (rows.length) await db.table(table).bulkAdd(rows);
      }
      await setMeta(db, META_KEYS.meId, fileMeId ?? extraPeople[0]!.id);
      await db.changeLog.clear();
      // The data now matches the file, so that file is its latest backup.
      await setMeta(db, META_KEYS.lastBackupAt, backup.exportedAt);
      await setMeta(db, META_KEYS.backupSnoozedUntil, null);
      return seq;
    },
    ['snapshots', 'meta'],
  );
  return { snapshotSeq, summary: summarize(backup.data) };
}

function uniqueMe(people: readonly Person[]): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'Me' : `Me ${n}`;
    if (!nameTaken(people, name)) return name;
  }
}

function keepKeys(file: Settings, current: Settings): Settings['apiKeys'] {
  return {
    openRouteService: file.apiKeys.openRouteService ?? current.apiKeys.openRouteService,
    google: file.apiKeys.google ?? current.apiKeys.google,
  };
}

// ── Snapshots ─────────────────────────────────────────────────────────────

export interface SnapshotInfo {
  seq: number;
  at: string;
  reason: SnapshotReason;
  fromVersion: number;
  toVersion: number;
  summary: DataSummary;
}

/** Safety copies, newest first. */
export async function listSnapshots(db: RentalDB): Promise<SnapshotInfo[]> {
  const rows = await db.snapshots.orderBy('seq').reverse().toArray();
  return rows.map((s) => ({
    seq: s.seq!,
    at: s.at,
    reason: s.reason ?? 'migration',
    fromVersion: s.fromVersion,
    toVersion: s.toVersion,
    summary: summarize(s.data),
  }));
}

/** A snapshot as a backup file (in the data format it was taken in), without API keys. */
export function snapshotEnvelope(snapshot: Snapshot): BackupEnvelope {
  return makeEnvelope(
    withoutSecrets(snapshot.data),
    snapshot.fromVersion,
    snapshot.at,
    snapshot.meId ?? null,
  );
}

export async function snapshotFile(db: RentalDB, seq: number) {
  const snapshot = await db.snapshots.get(seq);
  if (!snapshot) return null;
  const envelope = snapshotEnvelope(snapshot);
  return { envelope, json: backupJson(envelope) };
}
