import { z } from 'zod';
import { isoDateTime } from './common';
import { recordSchemas, SCHEMA_VERSION } from './index';
import type { DataTable } from './index';

/**
 * Backup file envelope (PLAN.md §5.5). Export and restore arrive in M5; the format and the
 * migration chain that reads old files exist from M1 so every schema version has a fixture.
 */
export const BACKUP_FORMAT = 'rental-tracker-backup';

/** Any backup, before migration: only the envelope is checked. */
export const backupEnvelope = z.object({
  format: z.literal(BACKUP_FORMAT),
  schemaVersion: z.number().int().min(1),
  exportedAt: isoDateTime,
  appVersion: z.string(),
  /**
   * The person whose copy made the file (from version 2). Restoring your own backup on a
   * new computer makes you that person again (PLAN.md §5.8).
   */
  exportedBy: z.string().nullable().optional(),
  data: z.record(z.string(), z.array(z.unknown())),
});
export type BackupEnvelope = z.infer<typeof backupEnvelope>;

const currentData = z.object(
  Object.fromEntries(
    Object.entries(recordSchemas).map(([table, schema]) => [table, z.array(schema)]),
  ) as { [T in DataTable]: z.ZodArray<(typeof recordSchemas)[T]> },
);

/** A backup at the current schema version, fully validated. */
export const currentBackup = backupEnvelope.extend({
  schemaVersion: z.literal(SCHEMA_VERSION),
  data: currentData,
});
export type CurrentBackup = z.infer<typeof currentBackup>;
