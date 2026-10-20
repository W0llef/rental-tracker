import type { Migration } from './index';

/**
 * Version 4 (M9 review): prices by lease length.
 *
 *  - Units get `termCharges: []` (every charge the same for every lease length, as before)
 *    and `listedTermMonths: null` (the lease length the listed rent is for, not said yet).
 *  - The cost profile gets `compareAtDefaultLease: false` (a lease length picked for a unit
 *    is used for that unit, as before).
 *
 * Nothing moves or changes meaning, so the undo history survives. Frozen once released.
 */

type Row = Record<string, unknown>;

export const v4: Migration = {
  toVersion: 4,
  description: 'Prices by lease length: three new fields with empty defaults',
  tables: {
    units: (u: Row) => ({
      ...u,
      termCharges: Array.isArray(u.termCharges) ? u.termCharges : [],
      listedTermMonths: typeof u.listedTermMonths === 'number' ? u.listedTermMonths : null,
    }),
    settings: (s: Row) => {
      const profile = (s.costProfile ?? {}) as Row;
      return {
        ...s,
        costProfile: {
          ...profile,
          compareAtDefaultLease: profile.compareAtDefaultLease === true,
        },
      };
    },
  },
};
