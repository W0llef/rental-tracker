import fixture from '../fixtures/backup-v2.json';
import { migrateBackupData } from '../../src/db/migrations';
import { v3 } from '../../src/db/migrations/v3';
import { currentBackup } from '../../src/model/backup';

/** Version 3 (M8 review): standalone homes (Q30) and remembered unknowns (Q29). */
describe('migration to version 3', () => {
  it('adds the new fields with empty defaults and keeps everything else', () => {
    const data = migrateBackupData(fixture.data, 2, 3);
    const parsed = currentBackup.parse({ ...fixture, schemaVersion: 3, data });
    expect(parsed.data.buildings[0]).toMatchObject({ standalone: null, checkedUnknown: [] });
    expect(parsed.data.units.every((u) => u.checkedUnknown.length === 0)).toBe(true);
    const before = fixture.data.units[0] as Record<string, unknown>;
    const after = data.units![0] as Record<string, unknown>;
    expect({ ...after, checkedUnknown: undefined }).toEqual({
      ...before,
      checkedUnknown: undefined,
    });
  });

  it('keeps values already there (running it twice changes nothing)', () => {
    const b = v3.tables.buildings!({ id: 'b', standalone: true, checkedUnknown: [{ field: 'x' }] });
    expect(b).toMatchObject({ standalone: true, checkedUnknown: [{ field: 'x' }] });
    expect(v3.tables.buildings!({ id: 'b', standalone: 'yes' })).toMatchObject({
      standalone: null,
    });
  });

  it('reads records written before v3 (an undo can bring one back) with the defaults', () => {
    const data = migrateBackupData(fixture.data, 2, 3);
    const old = { ...(data.buildings![0] as Record<string, unknown>) };
    delete old.standalone;
    delete old.checkedUnknown;
    const parsed = currentBackup.parse({
      ...fixture,
      schemaVersion: 3,
      data: { ...data, buildings: [old] },
    });
    expect(parsed.data.buildings[0]).toMatchObject({ standalone: null, checkedUnknown: [] });
  });
});
