import { useEffect, useRef } from 'react';
import { SHORTCUTS } from './shortcuts';
import styles from './triage.module.css';

/**
 * The shortcut sheet (`?`, DESIGN.md §5). Keys for features that don't exist yet say which
 * milestone brings them.
 */

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    close.current?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${styles.dialogWide}`}
      aria-labelledby="keys-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || e.key === '?') {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <div className={styles.form}>
        <header className={styles.head}>
          <h2 id="keys-title" className={styles.title}>
            Keyboard shortcuts
          </h2>
          <button ref={close} type="button" className={styles.smallButton} onClick={onClose}>
            Close
          </button>
        </header>
        <div className={styles.body}>
          <p className={styles.muted}>Shortcuts don’t act while you’re typing in a field.</p>
          {SHORTCUTS.map((g) => (
            <table key={g.group} className={styles.keys}>
              <caption>{g.group}</caption>
              <tbody>
                {g.rows.map(([keys, what, later]) => (
                  <tr key={keys} data-later={later ? true : undefined}>
                    <th scope="row">
                      <kbd>{keys}</kbd>
                    </th>
                    <td>
                      {what}
                      {later && <span className={styles.later}> · arrives in {later}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      </div>
    </dialog>
  );
}
