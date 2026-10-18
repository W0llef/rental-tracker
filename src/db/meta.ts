import type { RentalDB } from './db';

/**
 * Facts about this browser's copy of the data, kept in the `meta` table: not data, so they
 * aren't undoable and aren't in backups (a backup made elsewhere says nothing about when
 * this browser last backed up).
 */
export const META_KEYS = {
  /** When this browser last made a backup file (ISO date-time). */
  lastBackupAt: 'lastBackupAt',
  /** "Later" on the backup reminder hides it until this time (ISO date-time). */
  backupSnoozedUntil: 'backupSnoozedUntil',
  /** When the app last asked the browser to keep the data (persistent storage). */
  persistAskedAt: 'persistAskedAt',
  /** Which person this browser's copy belongs to ("me"; PLAN.md §5.8). */
  meId: 'meId',
  /** When the app last asked for your name (saved or "Not now"). */
  nameAskedAt: 'nameAskedAt',
} as const;

export type MetaKey = (typeof META_KEYS)[keyof typeof META_KEYS];

export async function getMeta<T = unknown>(db: RentalDB, key: MetaKey): Promise<T | null> {
  const row = await db.meta.get(key);
  return (row?.value as T | undefined) ?? null;
}

export async function setMeta(db: RentalDB, key: MetaKey, value: unknown): Promise<void> {
  if (value === null || value === undefined) await db.meta.delete(key);
  else await db.meta.put({ key, value });
}
