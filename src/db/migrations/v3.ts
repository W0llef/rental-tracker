import type { Migration } from './index';

/**
 * Version 3 (M8 review): standalone homes (Q30) and remembered unknowns (Q29).
 *
 *  - Buildings get `standalone: null` (follow the default for the unit's type) and
 *    `checkedUnknown: []`.
 *  - Units get `checkedUnknown: []`.
 *
 * Nothing moves or changes meaning, so the undo history survives. Frozen once released.
 */

type Row = Record<string, unknown>;

export const v3: Migration = {
  toVersion: 3,
  description: 'Standalone homes and remembered unknowns: two new fields with empty defaults',
  tables: {
    buildings: (b: Row) => ({
      ...b,
      standalone: typeof b.standalone === 'boolean' ? b.standalone : null,
      checkedUnknown: Array.isArray(b.checkedUnknown) ? b.checkedUnknown : [],
    }),
    units: (u: Row) => ({
      ...u,
      checkedUnknown: Array.isArray(u.checkedUnknown) ? u.checkedUnknown : [],
    }),
  },
};
