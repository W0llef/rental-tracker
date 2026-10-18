import { setOpinion } from '../../commands/people';
import { setSharedLabel, setStatus } from '../../commands/triage';
import { db } from '../../db/db';
import { toggledLabel } from '../../domain/triage';
import type { Flag, ID, LabelColor, Rating, UnitStatus } from '../../model';
import type { UnitRow } from '../../state/derive';
import { useUi } from '../../state/ui';

/**
 * Triage from the keyboard, the detail panel and the selection bar: one place that turns
 * "P on these units" into a command, so every route behaves the same. Each is one undo
 * step and shows its toast; a failure shows what went wrong instead.
 */

async function attempt(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    useUi
      .getState()
      .showNotice(`Couldn’t save that. ${e instanceof Error ? e.message : ''}`.trim());
  }
}

const ids = (rows: readonly UnitRow[]) => rows.map((r) => r.unit.id);

/** P, U and the flag buttons. Reject goes through the Reject dialog (`startReject`). */
export const setFlag = (rows: readonly UnitRow[], personId: ID, flag: Exclude<Flag, 'reject'>) =>
  attempt(() => setOpinion(db, ids(rows), personId, { flag }, flag === 'pick' ? 'Pick' : 'Unflag'));

/** X: opens the Reject dialog for these units. */
export function startReject(rows: readonly UnitRow[], personId: ID) {
  if (rows.length) useUi.getState().setRejecting({ unitIds: ids(rows), personId });
}

/** 0–5 and the stars. */
export const setRating = (rows: readonly UnitRow[], personId: ID, rating: Rating) =>
  attempt(() => setOpinion(db, ids(rows), personId, { rating }, rating ? 'Rate' : 'Clear rating'));

/** 6–9 (your label): toggles; every unit gets it unless they all have it already. */
export function togglePrivateLabel(rows: readonly UnitRow[], personId: ID, color: LabelColor) {
  const current = rows.map(
    (r) => r.opinions.find((o) => o.person.id === personId)?.opinion.colorLabel ?? null,
  );
  return setPrivateLabel(rows, personId, toggledLabel(current, color));
}

export const setPrivateLabel = (rows: readonly UnitRow[], personId: ID, color: LabelColor | null) =>
  attempt(() => setOpinion(db, ids(rows), personId, { colorLabel: color }, 'Label'));

/** ⇧6–9 (the shared label): toggles like the private one. */
export function toggleSharedLabel(rows: readonly UnitRow[], color: LabelColor) {
  return setShared(
    rows,
    toggledLabel(
      rows.map((r) => r.unit.colorLabel),
      color,
    ),
  );
}

export const setShared = (rows: readonly UnitRow[], color: LabelColor | null) =>
  attempt(() => setSharedLabel(db, ids(rows), color));

export const changeStatus = (rows: readonly UnitRow[], status: UnitStatus) =>
  attempt(() => setStatus(db, ids(rows), status));
