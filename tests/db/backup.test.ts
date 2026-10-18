import fc from 'fast-check';
import fixture from '../fixtures/backup-v1.json';
import { systemWrite } from '../../src/commands/action';
import { quickAdd } from '../../src/commands/quickAdd';
import {
  addNote,
  createBuilding,
  createUnit,
  deleteBuilding,
  deleteUnit,
  updateSettings,
  updateUnit,
} from '../../src/commands/records';
import { undo } from '../../src/commands/undo';
import type { RentalDB } from '../../src/db/db';
import { ensureMe } from '../../src/db/me';
import { getMeta, META_KEYS } from '../../src/db/meta';
import { setOpinion } from '../../src/commands/people';
import { STORES_V1, STORES_V2, takeSnapshot } from '../../src/db/versions';
import { loadSampleData } from '../../src/dev/sampleData';
import { parseListingText } from '../../src/domain/listingText';
import { SCHEMA_VERSION } from '../../src/model';
import { makeAddress } from '../../src/model/factories';
import {
  backupFileName,
  buildBackup,
  createBackupFile,
} from '../../src/services/backup/exportJson';
import {
  checkBackup,
  checkBackupText,
  listSnapshots,
  restoreBackup,
  snapshotFile,
  summarize,
} from '../../src/services/backup/restore';
import Dexie from 'dexie';
import { dumpData, makeDb } from './helpers';

const address = makeAddress('200 Portland Ave S', 'Minneapolis');

async function seed(db: RentalDB) {
  const b = await createBuilding(db, { address, name: 'Riverlight' });
  const u1 = await createUnit(db, { buildingId: b.id, unitNumber: '1504', rent: 1650 });
  const u2 = await createUnit(db, { buildingId: b.id, unitNumber: '908', rent: 1490 });
  await addNote(db, { unitId: u1.id, text: 'South light' });
  await deleteUnit(db, u2.id);
  return { b, u1, u2 };
}

/** Export → JSON text → check, the way a real file travels. */
async function viaFile(db: RentalDB) {
  const file = await createBackupFile(db);
  const checked = checkBackupText(file.json);
  if (!checked.ok) throw new Error(checked.message);
  return checked;
}

describe('backup export', () => {
  it('includes every data table and deleted records, and nothing else', async () => {
    const db = makeDb();
    const { u2 } = await seed(db);
    await db.geocodeCache.put({ key: 'k', at: '2026-10-17T00:00:00.000Z', value: {} });
    const backup = await buildBackup(db);
    expect(backup.schemaVersion).toBe(SCHEMA_VERSION);
    expect(Object.keys(backup.data).sort()).toEqual(
      [
        'buildings',
        'collections',
        'destinations',
        'imports',
        'listings',
        'notes',
        'opinions',
        'people',
        'photos',
        'settings',
        'units',
      ].sort(),
    );
    const units = backup.data.units as { id: string; deletedAt: string | null }[];
    expect(units.find((u) => u.id === u2.id)?.deletedAt).not.toBeNull();
    expect(JSON.stringify(backup)).not.toContain('geocodeCache');
    expect(summarize(backup.data)).toMatchObject({ buildings: 1, units: 1, notes: 1, deleted: 1 });
  });

  it('never carries API keys', async () => {
    const db = makeDb();
    await updateSettings(db, (s) => ({
      ...s,
      apiKeys: { openRouteService: 'secret', google: null },
    }));
    const backup = await buildBackup(db);
    expect(JSON.stringify(backup)).not.toContain('secret');
  });

  it('remembers when this browser last backed up, outside the undo history', async () => {
    const db = makeDb();
    await seed(db);
    const before = await db.changeLog.count();
    const file = await createBackupFile(db, new Date('2026-10-17T15:00:00'));
    expect(file.name).toBe('rental-tracker-preview-backup-2026-10-17.json');
    expect(await getMeta(db, META_KEYS.lastBackupAt)).toBe(file.envelope.exportedAt);
    expect(await db.changeLog.count()).toBe(before);
  });

  it('names live and preview files differently', () => {
    expect(backupFileName('2026-10-15', 'live')).toBe('rental-tracker-backup-2026-10-15.json');
    expect(backupFileName('2026-10-15', 'preview')).toBe(
      'rental-tracker-preview-backup-2026-10-15.json',
    );
  });
});

describe('checking a backup file', () => {
  it('accepts the frozen v1 fixture', () => {
    const checked = checkBackup(fixture);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.summary).toMatchObject({ units: 1, deleted: 1 });
  });

  it('refuses files that aren’t backups', () => {
    for (const text of ['not json', '{"hello":1}', '[]']) {
      const checked = checkBackupText(text);
      expect(checked.ok).toBe(false);
      if (!checked.ok) expect(checked.message).toMatch(/isn’t a backup from Rental Unit Tracker/);
    }
  });

  it('refuses a file from a newer app version', () => {
    const checked = checkBackup({ ...fixture, schemaVersion: SCHEMA_VERSION + 1 });
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.message).toMatch(/newer version of the app/);
  });

  it('says which records it can’t read', () => {
    const broken = structuredClone(fixture);
    (broken.data.units[1] as Record<string, unknown>).rent = 'a lot';
    const checked = checkBackup(broken);
    expect(checked.ok).toBe(false);
    if (!checked.ok) {
      expect(checked.message).toMatch(/can’t read, so nothing was restored/);
      expect(checked.message).toMatch(/units › 1 › rent/);
    }
  });

  it('refuses duplicate ids', () => {
    const doubled = structuredClone(fixture);
    doubled.data.units.push(doubled.data.units[0]!);
    const checked = checkBackup(doubled);
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(checked.message).toMatch(/two units with the same id/);
  });

  it('treats missing tables as empty', () => {
    const partial = structuredClone(fixture) as { data: Record<string, unknown> };
    delete partial.data.imports;
    const checked = checkBackup(partial);
    expect(checked.ok && checked.backup.data.imports).toEqual([]);
  });
});

describe('restore', () => {
  it('replaces everything, keeps a safety copy and clears undo history', async () => {
    const source = makeDb();
    await seed(source);
    const { backup } = await viaFile(source);

    const target = makeDb();
    const other = await createBuilding(target, { address: makeAddress('1 Main St', 'St. Paul') });
    const result = await restoreBackup(target, backup);

    expect(await dumpData(target)).toEqual(await dumpData(source));
    expect(await target.buildings.get(other.id)).toBeUndefined();
    expect(await target.changeLog.count()).toBe(0);
    expect(await undo(target)).toBeNull();
    expect(result.snapshotSeq).not.toBeNull();

    const [snap] = await listSnapshots(target);
    expect(snap).toMatchObject({ reason: 'restore', summary: { buildings: 1, units: 0 } });
    expect(await getMeta(target, META_KEYS.lastBackupAt)).toBe(backup.exportedAt);
  });

  it('takes no safety copy of an empty database', async () => {
    const target = makeDb();
    const checked = checkBackup(fixture);
    if (!checked.ok) throw new Error(checked.message);
    expect((await restoreBackup(target, checked.backup)).snapshotSeq).toBeNull();
    expect(await target.snapshots.count()).toBe(0);
    expect(await target.units.count()).toBe(2);
  });

  it('keeps this browser’s API keys', async () => {
    const target = makeDb();
    await updateSettings(target, (s) => ({
      ...s,
      apiKeys: { openRouteService: 'k1', google: null },
    }));
    const source = makeDb();
    await updateSettings(source, (s) => ({ ...s, theme: 'dark' }));
    const { backup } = await viaFile(source);
    await restoreBackup(target, backup);
    const settings = await target.settings.get('app');
    expect(settings).toMatchObject({ theme: 'dark', apiKeys: { openRouteService: 'k1' } });
  });

  it('changes nothing if writing fails part-way', async () => {
    const target = makeDb();
    await seed(target);
    const before = await dumpData(target);
    const checked = checkBackup(fixture);
    if (!checked.ok) throw new Error(checked.message);
    const bad = structuredClone(checked.backup);
    bad.data.units.push(bad.data.units[0]!); // skips the file check: duplicate key
    await expect(restoreBackup(target, bad)).rejects.toThrow();
    expect(await dumpData(target)).toEqual(before);
    expect(await target.snapshots.count()).toBe(0);
    expect(await target.changeLog.count()).toBeGreaterThan(0);
  });

  it('restores a safety copy', async () => {
    const db = makeDb();
    await seed(db);
    const original = await dumpData(db);
    const checked = checkBackup(fixture);
    if (!checked.ok) throw new Error(checked.message);
    const { snapshotSeq } = await restoreBackup(db, checked.backup);
    const file = await snapshotFile(db, snapshotSeq!);
    const again = checkBackupText(file!.json);
    if (!again.ok) throw new Error(again.message);
    await restoreBackup(db, again.backup);
    expect(await dumpData(db)).toEqual(original);
  });
});

describe('snapshots', () => {
  async function snap(db: RentalDB, reason: 'migration' | 'restore') {
    await systemWrite(db, 'test', () => takeSnapshot(Dexie.currentTransaction!, 1, 1, reason), [
      'snapshots',
    ]);
  }

  it('keeps the newest three of each kind', async () => {
    const db = makeDb();
    await snap(db, 'migration');
    for (let i = 0; i < 5; i++) await snap(db, 'restore');
    const list = await listSnapshots(db);
    expect(list.filter((s) => s.reason === 'restore')).toHaveLength(3);
    expect(list.filter((s) => s.reason === 'migration')).toHaveLength(1);
    expect(list[0]!.seq).toBeGreaterThan(list[1]!.seq); // newest first
  });

  it('reads snapshots from before M5 as migrations', async () => {
    const db = makeDb();
    await systemWrite(
      db,
      'test',
      () =>
        db.snapshots.add({
          at: '2026-10-15T00:00:00.000Z',
          fromVersion: 1,
          toVersion: 2,
          data: {},
        }),
      ['snapshots'],
    );
    expect((await listSnapshots(db))[0]?.reason).toBe('migration');
  });

  it('downloads without API keys, in the format it was taken in', async () => {
    const db = makeDb();
    await updateSettings(db, (s) => ({
      ...s,
      apiKeys: { openRouteService: 'secret', google: null },
    }));
    await snap(db, 'restore');
    const [info] = await listSnapshots(db);
    const file = await snapshotFile(db, info!.seq);
    expect(file?.envelope.schemaVersion).toBe(1);
    expect(file?.json).not.toContain('secret');
  });
});

describe('nothing lost: export → wipe → restore gives back the same data', () => {
  type Step =
    | { kind: 'sample' }
    | { kind: 'building'; name: string }
    | { kind: 'unit'; b: number; rent: number | null; num: string }
    | { kind: 'edit'; u: number; rent: number; rating: 0 | 1 | 2 | 3 | 4 | 5 }
    | { kind: 'deleteUnit'; u: number }
    | { kind: 'deleteBuilding'; b: number }
    | { kind: 'note'; u: number; text: string }
    | { kind: 'quickAdd'; text: string }
    | { kind: 'settings'; months: number; days: number }
    | { kind: 'undo' };

  const step: fc.Arbitrary<Step> = fc.oneof(
    { weight: 1, arbitrary: fc.constant({ kind: 'sample' as const }) },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant('building' as const),
        name: fc.string({ maxLength: 20 }),
      }),
    },
    {
      weight: 4,
      arbitrary: fc.record({
        kind: fc.constant('unit' as const),
        b: fc.nat(9),
        rent: fc.option(fc.integer({ min: 300, max: 9000 })),
        num: fc.string({ maxLength: 6 }),
      }),
    },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant('edit' as const),
        u: fc.nat(40),
        rent: fc.integer({ min: 300, max: 9000 }),
        rating: fc.constantFrom(
          0 as const,
          1 as const,
          2 as const,
          3 as const,
          4 as const,
          5 as const,
        ),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({ kind: fc.constant('deleteUnit' as const), u: fc.nat(40) }),
    },
    {
      weight: 1,
      arbitrary: fc.record({ kind: fc.constant('deleteBuilding' as const), b: fc.nat(9) }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        kind: fc.constant('note' as const),
        u: fc.nat(40),
        text: fc.string({ minLength: 1, maxLength: 40, unit: 'grapheme' }),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        kind: fc.constant('quickAdd' as const),
        text: fc.constantFrom(
          '$1,650/mo · 1 bd · 1 ba · 720 sqft · In-unit laundry · Cats OK',
          'Studio, 480 sq ft, $1,195. Available Nov 1. Heat included.',
          '2 beds 2 baths 1,050 sqft $2,400 dishwasher balcony',
        ),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant('settings' as const),
        months: fc.integer({ min: 1, max: 24 }),
        days: fc.constantFrom(1, 3, 7, 14, 30),
      }),
    },
    { weight: 1, arbitrary: fc.constant({ kind: 'undo' as const }) },
  );

  async function run(db: RentalDB, s: Step) {
    const buildings = await db.buildings.orderBy('id').toArray();
    const units = await db.units.orderBy('id').toArray();
    const pickB = (i: number) => buildings[i % Math.max(buildings.length, 1)];
    const pickU = (i: number) => units[i % Math.max(units.length, 1)];
    switch (s.kind) {
      case 'sample':
        if (!buildings.length) await loadSampleData(db, '2026-10-17');
        return;
      case 'building':
        return createBuilding(db, { address, name: s.name || null });
      case 'unit': {
        const b = pickB(s.b);
        return b && createUnit(db, { buildingId: b.id, rent: s.rent, unitNumber: s.num || null });
      }
      case 'edit': {
        const u = pickU(s.u);
        if (!u || u.deletedAt) return;
        await updateUnit(db, u.id, { rent: s.rent });
        return setOpinion(db, u.id, await ensureMe(db), { rating: s.rating });
      }
      case 'deleteUnit': {
        const u = pickU(s.u);
        return u && !u.deletedAt && deleteUnit(db, u.id);
      }
      case 'deleteBuilding': {
        const b = pickB(s.b);
        return b && !b.deletedAt && deleteBuilding(db, b.id);
      }
      case 'note': {
        const u = pickU(s.u);
        return addNote(db, { unitId: u?.id ?? null, text: s.text });
      }
      case 'quickAdd': {
        const b = pickB(0);
        if (!b || b.deletedAt) return;
        const parsed = parseListingText(s.text, '2026-10-17');
        return quickAdd(db, {
          today: '2026-10-17',
          building: { id: b.id },
          unit: {
            unitNumber: null,
            isFloorPlanOnly: false,
            floorPlanName: null,
            rent: 1500,
            rentIsFrom: false,
            bedrooms: null,
            bathrooms: null,
          },
          listing: { url: 'https://www.zillow.com/homedetails/x/1_zpid/', site: 'zillow' },
          facts: parsed.facts,
          pasted: s.text,
        });
      }
      case 'settings':
        return updateSettings(db, (cur) => ({
          ...cur,
          costProfile: { ...cur.costProfile, defaultLeaseMonths: s.months },
          backup: { ...cur.backup, remindEveryDays: s.days },
        }));
      case 'undo':
        return undo(db);
    }
  }

  it('holds for random datasets', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 25 }), async (steps) => {
        const db = makeDb();
        await ensureMe(db); // the app sets this copy's person up before anything else
        for (const s of steps) await run(db, s);
        const original = await dumpData(db);

        const { backup } = await viaFile(db);
        const fresh = makeDb(); // a new browser, or after clearing site data
        await restoreBackup(fresh, backup);
        expect(await dumpData(fresh)).toEqual(original);

        // Restoring over existing data gives the same result.
        await restoreBackup(db, backup);
        expect(await dumpData(db)).toEqual(original);
        db.close();
        fresh.close();
      }),
      { numRuns: 25 },
    );
  }, 120_000);
});

describe('stores', () => {
  it('back up every table Dexie declares for data', () => {
    // A guard: a new data table must be added to recordSchemas (and so to backups).
    const all = Object.entries({ ...STORES_V1, ...STORES_V2 }).filter(([, spec]) => spec !== null);
    const declared = all
      .map(([t]) => t)
      .filter(
        (t) =>
          ![
            'thumbs',
            'originals',
            'changeLog',
            'snapshots',
            'handles',
            'geocodeCache',
            'travelCache',
            'meta',
          ].includes(t),
      );
    const checked = checkBackup(fixture);
    expect(checked.ok && Object.keys(checked.backup.data).sort()).toEqual(declared.sort());
  });
});
