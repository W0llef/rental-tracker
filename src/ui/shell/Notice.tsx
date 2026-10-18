import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useUi } from '../../state/ui';
import styles from './AppShell.module.css';

/**
 * A short confirmation after an action ("Unit 1504 at Riverlight added."), with a link to
 * what it's about, or an Undo button for a delete. It goes away by itself after a while (a
 * notice with Undo stays longer). Toasts with Undo after every action arrive in M7.
 */
export function Notice() {
  const notice = useUi((s) => s.notice);
  const clear = useUi((s) => s.clearNotice);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clear, notice.undo ? 20000 : 9000);
    return () => clearTimeout(t);
  }, [notice, clear]);

  return (
    <div className={styles.notice} role="status" aria-live="polite">
      {notice && (
        <p className={styles.noticeBody} key={notice.id}>
          <span>{notice.text}</span>
          {notice.undo && (
            <button
              type="button"
              className={styles.noticeAction}
              onClick={() => {
                notice.undo?.();
                clear();
              }}
            >
              Undo
            </button>
          )}
          {notice.to && (
            <Link to={notice.to} onClick={clear} className={styles.noticeLink}>
              Open
            </Link>
          )}
          <button type="button" className={styles.noticeClose} onClick={clear} aria-label="Dismiss">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>
        </p>
      )}
    </div>
  );
}
