import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUi } from '../../state/ui';
import styles from './AppShell.module.css';

/**
 * The toast at the bottom left: what an action did, with Undo (or Redo after an undo), or a
 * short confirmation with a link to what it's about (PLAN.md §5.6). It goes away by itself
 * after a while; one with a button stays longer, and pointing at it keeps it.
 */
export function Notice() {
  const notice = useUi((s) => s.notice);
  const clear = useUi((s) => s.clearNotice);

  const [held, setHeld] = useState(false);
  // A new toast starts its own timer, even if the pointer rested on the last one.
  const [seen, setSeen] = useState(notice?.id);
  if (seen !== notice?.id) {
    setSeen(notice?.id);
    setHeld(false);
  }
  useEffect(() => {
    if (!notice || held) return;
    const t = setTimeout(clear, notice.button ? 12000 : 8000);
    return () => clearTimeout(t);
  }, [notice, clear, held]);

  return (
    <div className={styles.notice} role="status" aria-live="polite">
      {notice && (
        <p
          className={styles.noticeBody}
          key={notice.id}
          onMouseEnter={() => setHeld(true)}
          onMouseLeave={() => setHeld(false)}
          onFocus={() => setHeld(true)}
          onBlur={() => setHeld(false)}
        >
          <span>{notice.text}</span>
          {notice.button && (
            <button
              type="button"
              className={styles.noticeAction}
              onClick={() => {
                notice.button?.run();
                clear();
                setHeld(false);
              }}
            >
              {notice.button.label}
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
