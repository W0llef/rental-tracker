import fixtureV1 from '../fixtures/backup-v1.json';
import fixtureV2 from '../fixtures/backup-v2.json';
import fixtureV3 from '../fixtures/backup-v3.json';
import {
  applyMigration,
  migrateBackupData,
  migrations,
  NewerVersionError,
} from '../../src/db/migrations';
import type { Migration } from '../../src/db/migrations';
import { SCHEMA_VERSION } from '../../src/model';
import { backupEnvelope, currentBackup } from '../../src/model/backup';

/**
 * Every schema version keeps a frozen fixture backup (tests/fixtures/backup-vN.json).
 * Each must migrate to the current version and pass validation. Never edit old fixtures.
 */
const fixtures = [fixtureV1, fixtureV2, fixtureV3];

describe('backup fixtures', () => {
  it.each(fixtures.map((f) => [f.schemaVersion, f] as const))(
    'v%i migrates to the current version and validates',
    (_version, file) => {
      const envelope = backupEnvelope.parse(file);
      const data = migrateBackupData(envelope.data, envelope.schemaVersion, SCHEMA_VERSION);
      const result = currentBackup.safeParse({ ...envelope, schemaVersion: SCHEMA_VERSION, data });
      if (!result.success) throw new Error(JSON.stringify(result.error.issues, null, 2));
      expect(result.data.data.units).toHaveLength(2);
    },
  );

  it('has a fixture for every schema version', () => {
    const covered = new Set(fixtures.map((f) => f.schemaVersion));
    for (let v = 1; v <= SCHEMA_VERSION; v++) expect(covered).toContain(v);
  });

  it('has a migration for every version after 1', () => {
    for (let v = 2; v <= SCHEMA_VERSION; v++) {
      expect(migrations.map((m) => m.toVersion)).toContain(v);
    }
  });
});

describe('migration chain', () => {
  const v2: Migration = {
    toVersion: 2,
    description: 'test: rent becomes rentUsd',
    tables: {
      units: ({ rent, ...rest }) => ({ ...rest, rentUsd: rent }),
    },
    addTables: ['tours'],
  };
  const v3: Migration = {
    toVersion: 3,
    description: 'test: drop imports, mark units',
    tables: { units: (u) => ({ ...u, v3: true }) },
    dropTables: ['imports'],
  };

  it('runs every step in order and leaves other tables alone', () => {
    const data = { units: [{ id: 'u', rent: 1650 }], imports: [{ id: 'i' }], notes: [{ id: 'n' }] };
    const out = migrateBackupData(data, 1, 3, [v3, v2]);
    expect(out).toEqual({
      units: [{ id: 'u', rentUsd: 1650, v3: true }],
      notes: [{ id: 'n' }],
      tours: [],
    });
    expect(data.units[0]).toEqual({ id: 'u', rent: 1650 }); // input untouched
  });

  it('is a no-op at the same version', () => {
    const data = { units: [{ id: 'u' }] };
    expect(migrateBackupData(data, 2, 2, [v2])).toEqual(data);
  });

  it('refuses files from a newer app version', () => {
    expect(() => migrateBackupData({}, 5, 3, [v2, v3])).toThrow(NewerVersionError);
  });

  it('fails clearly when a step is missing', () => {
    expect(() => migrateBackupData({}, 1, 3, [v3])).toThrow(
      'No migration to data format version 2',
    );
  });

  it('applies one migration as a pure function', () => {
    expect(applyMigration({ units: [{ id: 'u', rent: 1 }] }, v2)).toEqual({
      units: [{ id: 'u', rentUsd: 1 }],
      tours: [],
    });
  });
});
