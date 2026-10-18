import fixture from '../fixtures/backup-v1.json';
import { migrateBackupData, migrationContext } from '../../src/db/migrations';
import { upgradeData } from '../../src/db/migrations/v2';
import { SCHEMA_VERSION } from '../../src/model';
import { currentBackup } from '../../src/model/backup';

/** Version 2 (M6): ratings, flags and their notes move from units into people's opinions. */

const ctx = migrationContext({
  meId: 'me',
  meName: 'Jordan',
  now: '2026-10-18T12:00:00.000Z',
  newId: (() => {
    let n = 0;
    return () => `p${++n}`;
  })(),
});

const unit = (patch: Record<string, unknown>) => ({
  id: 'u',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  rating: 0,
  ratingNote: null,
  flag: 'none',
  flagNote: null,
  rejectReasonIds: [],
  lastReviewedAt: null,
  externalRatings: [],
  colorLabel: null,
  ...patch,
});

describe('migration to version 2', () => {
  it('turns the v1 fixture into valid v2 data, with your ratings as your opinions', () => {
    const data = migrateBackupData(fixture.data, 1, 2, undefined, ctx);
    const parsed = currentBackup.parse({
      ...fixture,
      schemaVersion: SCHEMA_VERSION,
      exportedBy: 'me',
      data,
    });
    expect(parsed.data.people).toEqual([
      expect.objectContaining({ id: 'me', name: 'Jordan', color: 'teal', deletedAt: null }),
    ]);
    // u-1 was rated 4 and picked; u-2 had nothing to say, so it has no opinion.
    expect(parsed.data.opinions).toEqual([
      expect.objectContaining({
        id: 'me:u-1',
        unitId: 'u-1',
        personId: 'me',
        rating: 4,
        flag: 'pick',
        colorLabel: null,
      }),
    ]);
    // The color label stays on the unit as the shared label.
    expect(parsed.data.units.find((u) => u.id === 'u-1')?.colorLabel).toBe('blue');
    for (const u of data.units as Record<string, unknown>[]) {
      expect(u).not.toHaveProperty('rating');
      expect(u).not.toHaveProperty('flag');
      expect(u).not.toHaveProperty('externalRatings');
    }
    expect(parsed.data.notes[0]?.authorId).toBe('me');
  });

  it('keeps notes, reasons and "last reviewed" with the opinion', () => {
    const out = upgradeData(
      {
        units: [
          unit({
            rating: 2,
            flag: 'reject',
            flagNote: 'Too dark',
            ratingNote: 'Nice kitchen',
            rejectReasonIds: ['too-far'],
            lastReviewedAt: '2026-10-03T00:00:00.000Z',
          }),
        ],
      },
      ctx,
    );
    expect(out.opinions).toEqual([
      {
        id: 'me:u',
        createdAt: '2026-10-02T00:00:00.000Z',
        updatedAt: '2026-10-02T00:00:00.000Z',
        deletedAt: null,
        unitId: 'u',
        personId: 'me',
        rating: 2,
        ratingNote: 'Nice kitchen',
        flag: 'reject',
        flagNote: 'Too dark',
        rejectReasonIds: ['too-far'],
        colorLabel: null,
        lastReviewedAt: '2026-10-03T00:00:00.000Z',
      },
    ]);
  });

  it('turns external ratings into people, one per name, and their opinions', () => {
    const out = upgradeData(
      {
        units: [
          unit({
            id: 'a',
            externalRatings: [
              { by: 'Alex', rating: 3, note: 'ok' },
              { by: ' Sam ', rating: 9, note: null },
            ],
          }),
          unit({ id: 'b', externalRatings: [{ by: 'alex', rating: 4.6, note: null }] }),
          unit({ id: 'c', externalRatings: [{ by: '', rating: 5, note: null }] }),
        ],
      },
      migrationContext({
        meId: 'me',
        newId: (
          (n = 0) =>
          () =>
            `p${++n}`
        )(),
      }),
    );
    const people = out.people as { id: string; name: string; color: string }[];
    expect(people.map((p) => [p.id, p.name, p.color])).toEqual([
      ['me', 'Me', 'teal'],
      ['p1', 'Alex', 'plum'],
      ['p2', 'Sam', 'rust'],
    ]);
    const opinions = out.opinions as { id: string; rating: number; ratingNote: string | null }[];
    expect(opinions.map((o) => [o.id, o.rating, o.ratingNote])).toEqual([
      ['p1:a', 3, 'ok'],
      ['p2:a', 5, null], // clamped to 5 stars
      ['p1:b', 5, null], // same person whatever the case; rounded
    ]);
  });

  it('gives notes the app wrote no author, and leaves the input untouched', () => {
    const notes = [
      { id: 'n1', kind: 'note', text: 'mine' },
      { id: 'n2', kind: 'system', text: 'Status → Toured' },
    ];
    const units = [unit({ rating: 5 })];
    const out = upgradeData({ notes, units }, ctx);
    expect((out.notes as { authorId: string | null }[]).map((n) => n.authorId)).toEqual([
      'me',
      null,
    ]);
    expect(notes[0]).not.toHaveProperty('authorId');
    expect(units[0]).toHaveProperty('rating', 5);
  });
});
