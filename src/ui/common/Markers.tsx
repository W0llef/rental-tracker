import type { CSSProperties, ReactNode } from 'react';
import { STATUS_COLOR_VAR, STATUS_LABELS } from '../../domain/format';
import type { Flag, LabelColor, Rating, UnitStatus, UnitType } from '../../model';
import styles from './common.module.css';

/** Read-only marker displays shared by cards and panels (DESIGN.md §2.2–2.3, §4.1). */

export function StatusPill({ status }: { status: UnitStatus }) {
  return (
    <span
      className={styles.status}
      style={{ '--c': `var(${STATUS_COLOR_VAR[status]})` } as CSSProperties}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** Five stars, filled up to the rating; "Not rated" for 0. */
export function Stars({ rating, size = 'small' }: { rating: Rating; size?: 'small' | 'large' }) {
  const label = rating === 0 ? 'Not rated' : `${rating} of 5 stars`;
  return (
    <span
      className={size === 'large' ? styles.starsLarge : styles.stars}
      role="img"
      aria-label={label}
    >
      <span aria-hidden="true">{'★'.repeat(rating)}</span>
      <span aria-hidden="true" className={styles.starsOff}>
        {'★'.repeat(5 - rating)}
      </span>
    </span>
  );
}

const FlagIcon = () => (
  <svg viewBox="0 0 12 12" aria-hidden="true" className={styles.flagIcon}>
    <path d="M2 1v10M2 1h7l-2 3 2 3H2" fill="currentColor" stroke="currentColor" strokeWidth="1" />
  </svg>
);

/** "Pick" or "Rejected: reason". Nothing for an unflagged unit unless `showNone`. */
export function FlagMark({
  flag,
  reasons,
  showNone = false,
}: {
  flag: Flag;
  reasons?: string;
  showNone?: boolean;
}) {
  if (flag === 'pick')
    return (
      <span className={`${styles.flag} ${styles.pick}`}>
        <FlagIcon />
        Pick
      </span>
    );
  if (flag === 'reject')
    return (
      <span className={`${styles.flag} ${styles.reject}`}>
        <FlagIcon />
        {reasons ? `Rejected: ${reasons}` : 'Rejected'}
      </span>
    );
  return showNone ? <span className={styles.flag}>No flag</span> : null;
}

/** A small colored square with the label's name for screen readers and as a tooltip. */
export function LabelSwatch({ color, name }: { color: LabelColor; name: string }) {
  return (
    <span
      className={styles.swatch}
      style={{ background: `var(--lb-${color})` }}
      role="img"
      aria-label={`Label: ${name}`}
      title={name}
    />
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className={styles.tag}>{children}</span>;
}

/** A value, or italic "Unknown" when it hasn't been researched (spec §3). */
export function Value({ children }: { children: ReactNode }) {
  if (children === null || children === undefined || children === '')
    return <span className={styles.unknown}>Unknown</span>;
  return <>{children}</>;
}

/** Placeholder thumbnail until photos arrive (M11): the unit type's icon. */
export function TypeIcon({ type }: { type: UnitType | 'building' | null }) {
  const house = type === 'house' || type === 'townhome';
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.typeIcon}>
      {house ? (
        <path d="M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5" />
      ) : (
        <path d="M6 20V4h12v16M4 20h16M9 7h2M13 7h2M9 10.5h2M13 10.5h2M9 14h2M13 14h2M11 20v-3h2v3" />
      )}
    </svg>
  );
}
