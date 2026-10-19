import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import type { SectionStatus } from '../../domain/completeness';
import { Notice } from '../shell/Notice';
import { PreviewBanner } from '../shell/PreviewBanner';
import { FormContext, focusNextEmpty, focusRow, rowOf } from './formState';
import type { FormApi } from './formState';
import styles from './edit.module.css';

/**
 * The frame both full forms share (DESIGN.md §4.3): a header with Cancel and Save (⌘S),
 * a sticky section nav with each section's dot (● complete · ◐ partly · ○ empty), the
 * fields in one scrolling page (so ⌘F and scrolling work), and a side column.
 *
 * Keys: ⌘/Ctrl+S saves; ⌘/Ctrl+↓ and ⌘/Ctrl+↑ jump to the next and previous empty field;
 * `?` in a field marks it unknown and moves on. Leaving with unsaved changes asks first.
 */

export interface NavSection {
  id: string;
  label: string;
  status?: SectionStatus;
}

const DOT: Record<SectionStatus, string> = { complete: '●', partly: '◐', empty: '○' };
const DOT_WORDS: Record<SectionStatus, string> = {
  complete: 'complete',
  partly: 'partly filled',
  empty: 'empty',
};

export function FormFrame({
  title,
  subtitle,
  sections,
  aside,
  children,
  dirty,
  saving,
  onSave,
  onCancel,
  focusField,
  saveLabel = 'Save',
  message,
}: {
  title: string;
  subtitle?: ReactNode;
  sections: readonly NavSection[];
  aside: ReactNode;
  children: ReactNode;
  dirty: boolean;
  saving: boolean;
  /** Called with the form's errors; resolves once saved (the caller navigates away). */
  onSave: (errors: ReadonlyMap<string, string>, root: HTMLElement) => Promise<void> | void;
  onCancel: () => void;
  /** A field to open at (`?field=unit.rent`). */
  focusField?: string | null;
  saveLabel?: string;
  /** A line under the header: what the last save or copy did, or why it couldn't. */
  message?: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [marked, setMarkedState] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Map<string, string>>(() => new Map());
  const [nothingLeft, setNothingLeft] = useState(false);

  const api = useMemo<FormApi>(
    () => ({
      marked,
      errors,
      setMarked: (path, on) =>
        setMarkedState((m) => {
          if (m.has(path) === on) return m;
          const next = new Set(m);
          if (on) next.add(path);
          else next.delete(path);
          return next;
        }),
      setError: (path, error) =>
        setErrors((e) => {
          if ((e.get(path) ?? null) === error) return e;
          const next = new Map(e);
          if (error) next.set(path, error);
          else next.delete(path);
          return next;
        }),
      nextEmpty: (from, dir = 1) => {
        // Marking a field unknown re-renders it without data-empty; look after that.
        requestAnimationFrame(() => {
          const ok = root.current ? focusNextEmpty(root.current, from, dir) : false;
          setNothingLeft(!ok);
        });
        return true;
      },
    }),
    [marked, errors],
  );

  // Leaving with unsaved changes asks first (Back, links, Cancel); closing the tab too.
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!dirty || saving) return false;
    return currentLocation.pathname !== nextLocation.pathname;
  });
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = () => {
    if (saving || !root.current) return;
    void onSave(errors, root.current);
  };
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = (e.metaKey || e.ctrlKey) && !e.altKey;
      if (!mod) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!root.current) return;
        e.preventDefault();
        const ok = focusNextEmpty(
          root.current,
          document.activeElement,
          e.key === 'ArrowDown' ? 1 : -1,
        );
        setNothingLeft(!ok);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Open at a field (from a missing-essential prompt), or else at the first empty one.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !root.current) return;
    opened.current = true;
    const row = focusField ? rowOf(root.current, focusField) : null;
    if (row) focusRow(row);
    else root.current.querySelector<HTMLElement>('h1')?.focus();
  }, [focusField]);

  // The section in view is highlighted in the nav.
  const [current, setCurrent] = useState(sections[0]?.id ?? '');
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          seen.set((e.target as HTMLElement).dataset.section ?? '', e.isIntersecting);
        const first = sections.find((s) => seen.get(s.id));
        if (first) setCurrent(first.id);
      },
      { rootMargin: '-96px 0px -55% 0px' },
    );
    el.querySelectorAll('[data-section]').forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [sections]);

  const errorCount = errors.size;

  return (
    <FormContext.Provider value={api}>
      <div className={styles.page} ref={root}>
        <PreviewBanner />
        <header className={styles.top}>
          <div className={styles.topTitle}>
            <h1 className={styles.title} tabIndex={-1}>
              {title}
            </h1>
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          <div className={styles.topActions}>
            <span className={styles.status} aria-live="polite">
              {errorCount > 0
                ? `${errorCount} to fix before saving`
                : dirty
                  ? 'Unsaved changes'
                  : 'No changes yet'}
            </span>
            <button type="button" className={styles.secondary} onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className={styles.primary}
              onClick={save}
              disabled={saving}
              aria-keyshortcuts="Meta+S Control+S"
            >
              {saving ? 'Saving…' : saveLabel}
              <kbd aria-hidden="true">⌘S</kbd>
            </button>
          </div>
        </header>
        {message && (
          <div className={styles.message} role="status">
            {message}
          </div>
        )}
        <div className={styles.layout}>
          <nav className={styles.nav} aria-label="Sections">
            <ul>
              {sections.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={styles.navItem}
                    aria-current={current === s.id ? 'true' : undefined}
                    onClick={() => {
                      const h = document.getElementById(`sec-${s.id}`);
                      h?.scrollIntoView({ block: 'start' });
                      h?.focus({ preventScroll: true });
                      setCurrent(s.id);
                    }}
                  >
                    <span>{s.label}</span>
                    {s.status && (
                      <span className={styles.dot} data-status={s.status}>
                        <span aria-hidden="true">{DOT[s.status]}</span>
                        <span className={styles.visuallyHidden}>, {DOT_WORDS[s.status]}</span>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <p className={styles.keys}>
              <kbd>⌘↓</kbd> next empty field · <kbd>?</kbd> unknown · <kbd>⌘S</kbd> save
            </p>
            {nothingLeft && (
              <p className={styles.keys} role="status">
                Nothing left empty.
              </p>
            )}
          </nav>
          <main className={styles.main}>{children}</main>
          <aside className={styles.aside} aria-label="Summary">
            {aside}
          </aside>
        </div>
        <Notice />
        {blocker.state === 'blocked' && (
          <LeaveDialog onStay={() => blocker.reset()} onLeave={() => blocker.proceed()} />
        )}
      </div>
    </FormContext.Provider>
  );
}

function LeaveDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-labelledby="leave-title"
      onCancel={(e) => {
        e.preventDefault();
        onStay();
      }}
    >
      <h2 id="leave-title" className={styles.dialogTitle}>
        Leave without saving?
      </h2>
      <p className={styles.lead}>Your changes in this form will be lost.</p>
      <div className={styles.dialogActions}>
        <button type="button" className={styles.secondary} onClick={onLeave}>
          Discard changes
        </button>
        <button type="button" className={styles.primary} onClick={onStay} autoFocus>
          Keep editing
        </button>
      </div>
    </dialog>
  );
}
