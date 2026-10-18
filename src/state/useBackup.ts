import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { getMeta, META_KEYS, setMeta } from '../db/meta';
import { createBackupFile } from '../services/backup/exportJson';
import { snoozeUntil } from '../services/backup/reminders';
import { downloadText } from '../ui/common/download';

export interface BackupMeta {
  lastBackupAt: string | null;
  snoozedUntil: string | null;
}

/** This browser's backup facts (meta table), kept up to date. undefined while reading. */
export function useBackupMeta(): BackupMeta | undefined {
  return useLiveQuery(
    async () => ({
      lastBackupAt: await getMeta<string>(db, META_KEYS.lastBackupAt),
      snoozedUntil: await getMeta<string>(db, META_KEYS.backupSnoozedUntil),
    }),
    [],
  );
}

/** Makes a backup of everything and downloads it. Returns the file name. */
export async function backUpNow(): Promise<string> {
  const file = await createBackupFile(db);
  downloadText(file.name, file.json);
  return file.name;
}

/** "Later" on the reminder. */
export function snoozeBackupReminder(now = new Date()) {
  return setMeta(db, META_KEYS.backupSnoozedUntil, snoozeUntil(now));
}

const dateTime = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });

/** "Oct 17, 2026, 4:20 PM". */
export function dateTimeText(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTime.format(d);
}
