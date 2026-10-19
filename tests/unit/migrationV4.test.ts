import fixture from '../fixtures/backup-v3.json';
import v4fixture from '../fixtures/backup-v4.json';
import { migrateBackupData } from '../../src/db/migrations';
import { v4 } from '../../src/db/migrations/v4';
import { currentBackup } from '../../src/model/backup';

/** Version 4 (M9 review): charges that differ by lease length. */
describe('migration to version 4', () => {
  it('gives every unit an empty list of charges by lease length and keeps everything else', () => {
    const data = migrateBackupData(fixture.data, 3, 4);
    const parsed = currentBackup.parse({ ...fixture, schemaVersion: 4, data });
    expect(parsed.data.units.every((u) => u.termCharges.length === 0)).toBe(true);
    const before = fixture.data.units[0] as Record<string, unknown>;
    const after = data.units![0] as Record<string, unknown>;
    expect({ ...after, termCharges: undefined }).toEqual({ ...before, termCharges: undefined });
  });

  it('keeps charges already there (running it twice changes nothing)', () => {
    const charges = [{ charge: 'deposit', months: 12, amount: 500 }];
    expect(v4.tables.units!({ id: 'u', termCharges: charges })).toMatchObject({
      termCharges: charges,
    });
    expect(v4.tables.units!({ id: 'u', termCharges: 'x' })).toMatchObject({ termCharges: [] });
  });

  it('reads records written before v4 (an undo can bring one back) with the default', () => {
    const old = { ...(v4fixture.data.units[1] as Record<string, unknown>) };
    delete old.termCharges;
    const parsed = currentBackup.parse({ ...v4fixture, data: { ...v4fixture.data, units: [old] } });
    expect(parsed.data.units[0]!.termCharges).toEqual([]);
  });

  it('accepts the frozen v4 fixture, and refuses unknown charges', () => {
    const parsed = currentBackup.parse(v4fixture);
    expect(parsed.data.units[0]!.termCharges).toHaveLength(3);
    const bad = structuredClone(v4fixture);
    (bad.data.units[0] as { termCharges: unknown[] }).termCharges = [
      { charge: 'parking', months: 12, amount: 1 },
    ];
    expect(currentBackup.safeParse(bad).success).toBe(false);
  });
});
