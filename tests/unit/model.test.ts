import { z } from 'zod';
import { versions } from '../../src/db/versions';
import {
  building,
  DATA_TABLES,
  defaultSettings,
  listing,
  noteEntry,
  recordSchemas,
  SCHEMA_VERSION,
  settings,
  unit,
} from '../../src/model';
import { currentBackup } from '../../src/model/backup';
import { makeAddress, newBuilding, newListing, newNote, newUnit } from '../../src/model/factories';

const address = makeAddress('200 Portland Ave S', 'Minneapolis', 'MN', '55401');

describe('data model', () => {
  it('makes valid new records with every researched field unknown', () => {
    const b = building.parse(newBuilding({ address }));
    expect(b.name).toBeNull();
    expect(Object.values(b.amenities).every((v) => v === null)).toBe(true);

    const u = unit.parse(newUnit({ buildingId: b.id }));
    expect(u).toMatchObject({ rent: null, status: 'new', rating: 0, flag: 'none', exposure: null });
    expect(Object.values(u.utilities).every((v) => v === null)).toBe(true);

    expect(listing.parse(newListing({ unitId: u.id, firstSeen: '2026-10-15' })).lastSeen).toBe(
      '2026-10-15',
    );
    expect(noteEntry.parse(newNote({ text: 'Hi' })).kind).toBe('note');
  });

  it('has valid default settings', () => {
    const s = settings.parse(defaultSettings());
    expect(s.costProfile.defaultLeaseMonths).toBe(12);
    expect(s.costProfile.parkingSpacesNeeded).toBe(1);
    expect(s.costProfile.amortizeOneTimeFees).toBe(false);
    expect(s.map.pins.show).toBe('total');
    expect(s.rejectReasons.map((r) => r.label)).toContain('Too expensive');
  });

  it('keeps unknown distinct from "none": null vs empty list', () => {
    const b = newBuilding({ address });
    const u = newUnit({ buildingId: b.id, exposure: [], windows: [] });
    expect(unit.parse(u).exposure).toEqual([]);
    expect(unit.parse({ ...u, exposure: null }).exposure).toBeNull();
  });

  it('rejects values outside the model', () => {
    const u = newUnit({ buildingId: 'b' });
    expect(() => unit.parse({ ...u, rent: -1 })).toThrow();
    expect(() => unit.parse({ ...u, rent: 1650.5 })).toThrow(); // whole dollars
    expect(() => unit.parse({ ...u, bathrooms: 1.25 })).toThrow(); // half steps
    expect(() => unit.parse({ ...u, status: 'maybe' })).toThrow();
    expect(() => unit.parse({ ...u, rating: 6 })).toThrow();
    expect(() => unit.parse({ ...u, availableDate: 'June 1' })).toThrow();
    expect(() =>
      unit.parse({ ...u, utilities: { ...u.utilities, heat: { mode: 'free' } } }),
    ).toThrow();
    const missingTrash: Record<string, unknown> = { ...u.utilities };
    delete missingTrash.trash;
    expect(() => unit.parse({ ...u, utilities: missingTrash })).toThrow();
  });

  it('accepts every utility term shape', () => {
    const u = newUnit({ buildingId: 'b' });
    const parsed = unit.parse({
      ...u,
      utilities: {
        ...u.utilities,
        heat: { mode: 'included' },
        electric: { mode: 'tenant-paid', estimate: null },
        waterSewer: { mode: 'extra', amount: 55 },
      },
    });
    expect(parsed.utilities.waterSewer).toEqual({ mode: 'extra', amount: 55 });
  });

  it('exports JSON Schema for every record type (used by AI prompts in M11)', () => {
    for (const schema of Object.values(recordSchemas)) {
      expect(() => z.toJSONSchema(schema, { unrepresentable: 'any' })).not.toThrow();
    }
  });

  it('uses the latest Dexie version as SCHEMA_VERSION', () => {
    expect(SCHEMA_VERSION).toBe(Math.max(...versions.map((v) => v.version)));
  });

  it('declares a Dexie table for every data table', () => {
    const declared = new Set(versions.flatMap((v) => Object.keys(v.stores)));
    for (const table of DATA_TABLES) expect(declared).toContain(table);
  });

  it('validates the full backup envelope', () => {
    const backup = {
      format: 'rental-tracker-backup',
      schemaVersion: SCHEMA_VERSION,
      exportedAt: '2026-10-15T21:12:00.000Z',
      appVersion: '0.1.0',
      data: Object.fromEntries(DATA_TABLES.map((t) => [t, []])),
    };
    expect(currentBackup.safeParse(backup).success).toBe(true);
    expect(currentBackup.safeParse({ ...backup, format: 'other' }).success).toBe(false);
  });
});
