import type { Migration } from './index';

/**
 * Version 4 (M9 review): charges that differ by lease length. Units get `termCharges: []`
 * (every charge the same for every lease length, as before). Nothing moves or changes
 * meaning, so the undo history survives. Frozen once released.
 */

type Row = Record<string, unknown>;

export const v4: Migration = {
  toVersion: 4,
  description: 'Charges by lease length: one new field with an empty default',
  tables: {
    units: (u: Row) => ({
      ...u,
      termCharges: Array.isArray(u.termCharges) ? u.termCharges : [],
    }),
  },
};
