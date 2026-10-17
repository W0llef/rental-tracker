import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deleteBuilding, deleteUnit } from '../../commands/records';
import { undoAction } from '../../commands/undo';
import { db } from '../../db/db';
import { useUi } from '../../state/ui';
import styles from '../detail/detail.module.css';

/**
 * Delete at the end of a unit's or building's panel (PLAN Q13, M4 review). Asks once inline,
 * then deletes (soft delete, one undo step), closes the panel and shows a confirmation with
 * Undo. Deleting a building deletes its units too.
 */
export function DeleteSection({
  kind,
  id,
  name,
  unitCount = 0,
}: {
  kind: 'unit' | 'building';
  id: string;
  /** "Unit 1504 at Riverlight", "Riverlight". */
  name: string;
  /** For a building: how many of your units it has. */
  unitCount?: number;
}) {
  const navigate = useNavigate();
  const showNotice = useUi((s) => s.showNotice);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const units = unitCount === 1 ? 'its unit' : `its ${unitCount} units`;
  const question =
    kind === 'unit'
      ? `Delete ${name}? Its listings, prices and notes go with it.`
      : unitCount > 0
        ? `Delete ${name} and ${units}?`
        : `Delete ${name}?`;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const actionId = kind === 'unit' ? await deleteUnit(db, id) : await deleteBuilding(db, id);
      navigate('/', { replace: true });
      showNotice(`${name} deleted.`, null, () => {
        void undoAction(db, actionId).then((ok) => {
          if (!ok)
            showNotice(
              'Couldn’t undo: something else changed since. Use Undo on the Data check page.',
            );
        });
      });
    } catch (e) {
      setError(`Couldn’t delete. ${(e as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <section
      className={styles.sec}
      aria-label={kind === 'unit' ? 'Delete unit' : 'Delete building'}
    >
      {!asking ? (
        <button type="button" className={styles.dangerButton} onClick={() => setAsking(true)}>
          {kind === 'unit' ? 'Delete unit…' : 'Delete building…'}
        </button>
      ) : (
        <div className={styles.confirm} role="group" aria-labelledby={`delete-${id}`}>
          <p id={`delete-${id}`} className={styles.confirmText}>
            {question} You can undo this.
          </p>
          <div className={styles.confirmActions}>
            <button
              type="button"
              className={styles.dangerSolid}
              disabled={busy}
              onClick={() => void confirm()}
            >
              {kind === 'unit' ? 'Delete unit' : 'Delete building'}
            </button>
            <button
              type="button"
              className={styles.plainButton}
              disabled={busy}
              // Focus moves here when asked, so Esc/Enter land somewhere sensible.
              autoFocus
              onClick={() => setAsking(false)}
            >
              Cancel
            </button>
          </div>
          {error && (
            <p className={styles.confirmText} role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
