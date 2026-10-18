import { unitsCount } from '../../domain/triage';
import type { Dataset, UnitRow } from '../../state/derive';
import { useUi } from '../../state/ui';
import { MarkerControls } from './MarkerControls';
import styles from './triage.module.css';

/**
 * Shown while several units are selected (⌘/Ctrl- or Shift-click; DESIGN.md §4.1): how
 * many, the markers for all of them, Edit together, and Clear. Keyboard shortcuts act on
 * the same units.
 */
export function SelectionBar({ rows, data }: { rows: UnitRow[]; data: Dataset }) {
  const clear = useUi((s) => s.clearPicked);
  const edit = useUi((s) => s.setEditingTogether);
  if (!rows.length) return null;
  return (
    <section className={styles.selectionBar} aria-label="Selected units">
      <div className={styles.selectionHead}>
        <p className={styles.selectionCount} aria-live="polite">
          {unitsCount(rows.length)} selected
        </p>
        <button type="button" className={styles.smallPrimary} onClick={() => edit(true)}>
          Edit together…
        </button>
        <button
          type="button"
          className={styles.smallButton}
          onClick={clear}
          title="Clear the selection (Esc)"
        >
          Clear
        </button>
      </div>
      <MarkerControls rows={rows} me={data.me} settings={data.settings} layout="bar" />
      <p className={styles.hint}>
        Keys act on all of them: P, X, U, 0–5, 6–9, ⇧6–9. ⌘/Ctrl-click adds or removes a unit;
        Shift-click selects a range.
      </p>
    </section>
  );
}
