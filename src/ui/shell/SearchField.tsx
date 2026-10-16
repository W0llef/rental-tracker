import { forwardRef } from 'react';
import { useUi } from '../../state/ui';
import styles from './AppShell.module.css';

/**
 * Text search over units, buildings and notes (top bar). Esc clears the text, then a
 * second Esc leaves the field.
 */
export const SearchField = forwardRef<HTMLInputElement>(function SearchField(_props, ref) {
  const query = useUi((s) => s.query);
  const setQuery = useUi((s) => s.setQuery);
  return (
    <div className={styles.search} role="search">
      <svg viewBox="0 0 16 16" aria-hidden="true" className={styles.searchIcon}>
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      <input
        ref={ref}
        id="search"
        type="search"
        className={styles.searchInput}
        placeholder="Search units, buildings, notes"
        aria-label="Search units, buildings and notes"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          if (query) setQuery('');
          else e.currentTarget.blur();
        }}
      />
      <kbd className={styles.kbd} aria-hidden="true">
        /
      </kbd>
    </div>
  );
});
