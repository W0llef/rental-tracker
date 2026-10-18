import { appInfo } from '../../config';
import type { Channel } from '../../config';
import type { RentalDB } from '../../db/db';
import { META_KEYS, setMeta } from '../../db/meta';
import { localDate } from '../../domain/format';
import { DATA_TABLES, SCHEMA_VERSION } from '../../model';
import type { ISODate, Settings } from '../../model';
import { BACKUP_FORMAT } from '../../model/backup';
import type { BackupEnvelope } from '../../model/backup';
import { nowIso } from '../../model/factories';

/**
 * Backup (data) → `rental-tracker-backup-2026-10-15.json` (PLAN.md §5.5).
 *
 * Every data table, deleted records included (undo and the coming History panel depend on
 * them), at the current data format. Not included: the change log (undo history), caches
 * (geocoder, travel times), snapshots, photo thumbnails and originals, the photo folder
 * handle, and API keys (blanked). Photos come with the .zip backup in M12.
 */

export type BackupData = Record<string, unknown[]>;

/** Removes what must never leave the browser in a backup file. */
function clean(table: string, rows: unknown[]): unknown[] {
  if (table !== 'settings') return rows;
  return (rows as Settings[]).map((s) => ({
    ...s,
    apiKeys: { openRouteService: null, google: null },
  }));
}

/** Every table cleaned of what must never leave the browser (API keys). */
export function withoutSecrets(data: BackupData): BackupData {
  return Object.fromEntries(Object.entries(data).map(([t, rows]) => [t, clean(t, rows)]));
}

/** Reads every data table in one transaction, so the backup is one consistent moment. */
export async function readBackupData(db: RentalDB): Promise<BackupData> {
  return db.transaction('r', DATA_TABLES, async () => {
    const data: BackupData = {};
    for (const table of DATA_TABLES) {
      data[table] = clean(table, await db.table(table).orderBy(':id').toArray());
    }
    return data;
  });
}

export function makeEnvelope(
  data: BackupData,
  schemaVersion = SCHEMA_VERSION,
  exportedAt = nowIso(),
): BackupEnvelope {
  return {
    format: BACKUP_FORMAT,
    schemaVersion,
    exportedAt,
    appVersion: appInfo.version,
    data,
  };
}

export async function buildBackup(db: RentalDB, at = nowIso()): Promise<BackupEnvelope> {
  return makeEnvelope(await readBackupData(db), SCHEMA_VERSION, at);
}

/** Readable JSON (indented), so the file can be opened and checked without the app. */
export function backupJson(envelope: BackupEnvelope): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

/** Preview and development builds name their files differently, so they can't be mixed up. */
export function backupFileName(
  date: ISODate,
  channel: Channel = appInfo.channel,
  kind: 'backup' | 'safety-copy' = 'backup',
): string {
  const app = channel === 'live' ? 'rental-tracker' : 'rental-tracker-preview';
  return `${app}-${kind}-${date}.json`;
}

export interface BackupFile {
  name: string;
  json: string;
  envelope: BackupEnvelope;
}

/**
 * Makes the backup file and records the time as this browser's last backup (in `meta`,
 * not in Settings: it isn't data, so it's neither undoable nor in backups).
 */
export async function createBackupFile(db: RentalDB, now = new Date()): Promise<BackupFile> {
  const envelope = await buildBackup(db, now.toISOString());
  const file = {
    name: backupFileName(localDate(now)),
    json: backupJson(envelope),
    envelope,
  };
  await setMeta(db, META_KEYS.lastBackupAt, envelope.exportedAt);
  await setMeta(db, META_KEYS.backupSnoozedUntil, null);
  return file;
}
