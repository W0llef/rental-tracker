/**
 * Pure, per-version data transforms (PLAN.md §3.7).
 *
 * A migration takes plain objects of version N−1 and returns version N. The same functions
 * run in two places:
 *   - the browser database, inside Dexie's upgrade transaction (db/versions.ts), and
 *   - old backup files, before they're validated and restored (migrateBackupData below).
 *
 * Rules: never edit a released migration; every new one ships with a fixture
 * (tests/fixtures/backup-vN.json) and a test that it reaches the current version.
 */

export type RecordTransform = (record: Record<string, unknown>) => Record<string, unknown>;

export interface Migration {
  /** The version this migration produces. */
  toVersion: number;
  /** One-line description, shown in the changelog of the plan. */
  description: string;
  /** Per-table record transforms. Tables not listed are copied unchanged. */
  tables: Partial<Record<string, RecordTransform>>;
  /** Tables added by this version (start empty in old backups). */
  addTables?: string[];
  /** Tables removed by this version. */
  dropTables?: string[];
}

/**
 * Version 1 is the starting point, so there are no migrations yet. The next format change
 * adds `v2.ts` and lists it here: `export const migrations: Migration[] = [v2];`
 */
export const migrations: Migration[] = [];

export type BackupData = Record<string, unknown[]>;

/**
 * Brings backup data from `fromVersion` up to `toVersion` by running every migration in
 * between, in order. Refuses data from a newer app version instead of half-importing it.
 */
export function migrateBackupData(
  data: BackupData,
  fromVersion: number,
  toVersion: number,
  chain: Migration[] = migrations,
): BackupData {
  if (fromVersion > toVersion) {
    throw new NewerVersionError(fromVersion, toVersion);
  }
  let current: BackupData = { ...data };
  for (let v = fromVersion + 1; v <= toVersion; v++) {
    const step = chain.find((m) => m.toVersion === v);
    if (!step) throw new Error(`No migration to data format version ${v}.`);
    current = applyMigration(current, step);
  }
  return current;
}

export function applyMigration(data: BackupData, step: Migration): BackupData {
  const next: BackupData = {};
  for (const [table, rows] of Object.entries(data)) {
    if (step.dropTables?.includes(table)) continue;
    const transform = step.tables[table];
    next[table] = transform
      ? rows.map((row) => transform(structuredClone(row) as Record<string, unknown>))
      : rows;
  }
  for (const table of step.addTables ?? []) next[table] ??= [];
  return next;
}

export class NewerVersionError extends Error {
  constructor(
    readonly fileVersion: number,
    readonly appVersion: number,
  ) {
    super(
      `This file was made by a newer version of the app (data format ${fileVersion}; this app reads up to ${appVersion}). Update the app, then try again.`,
    );
    this.name = 'NewerVersionError';
  }
}
