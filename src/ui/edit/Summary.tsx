import { useState } from 'react';
import type { Check, Completeness, Essentials } from '../../domain/completeness';
import { rowOf, focusRow } from './formState';
import styles from './edit.module.css';

/**
 * The form's side column (DESIGN.md §4.3): how complete the record is, what's still
 * unknown (each a button to its field), and the essentials that decide "ready to compare".
 */

function jump(check: Check) {
  const row = rowOf(document, check.field);
  if (row) focusRow(row);
}

function MissingList({ checks, label }: { checks: Check[]; label: string }) {
  return (
    <ul className={styles.missing} aria-label={label}>
      {checks.map((c) => (
        <li key={c.key}>
          <button type="button" className={styles.textButton} onClick={() => jump(c)}>
            {c.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function CompletenessCard({
  title = 'Complete',
  c,
  essentials,
}: {
  title?: string;
  c: Completeness;
  /** The unit's essentials (unit forms only). Building essentials are linked, not jumped to. */
  essentials?: Essentials & { onPage: Check[]; elsewhere: Check[] };
}) {
  const [open, setOpen] = useState(false);
  const unknown = c.total - c.filled;
  return (
    <section className={styles.card} aria-labelledby="complete-title">
      <h2 className={styles.cardTitle} id="complete-title">
        {title}
      </h2>
      <div className={styles.meterRow}>
        <meter
          className={styles.meter}
          min={0}
          max={100}
          value={c.percent}
          aria-label={`${c.percent}% complete`}
        />
        <b>{c.percent}%</b>
      </div>
      <p className={styles.small}>
        {unknown === 0 ? 'Everything is known.' : `${unknown} unknown`}
        {unknown > 0 && (
          <>
            {' · '}
            <button
              type="button"
              className={styles.textButton}
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? 'Hide them' : 'Show them'}
            </button>
          </>
        )}
      </p>
      {open && <MissingList checks={c.missing} label="Unknown fields" />}
      {essentials && (
        <div className={styles.essentials}>
          <p className={styles.essentialsLine}>
            <b>
              Essentials {essentials.filled} of {essentials.total}
            </b>
            {essentials.ready && essentials.total > 0 && (
              <span className={styles.ready}>Ready to compare</span>
            )}
          </p>
          {essentials.onPage.length > 0 && (
            <MissingList checks={essentials.onPage} label="Missing essentials" />
          )}
          {essentials.elsewhere.length > 0 && (
            <p className={styles.small}>
              On the building: {essentials.elsewhere.map((c) => c.label.toLowerCase()).join(', ')}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
