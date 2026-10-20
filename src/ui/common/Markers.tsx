import type { LeaseMarkKind } from '../../domain/leaseMarks';
import type { CSSProperties, ReactNode } from 'react';
import { STATUS_COLOR_VAR, STATUS_LABELS } from '../../domain/format';
import { initial, PERSON_COLOR_VAR } from '../../domain/people';
import type { Flag, LabelColor, Person, Rating, UnitStatus, UnitType } from '../../model';
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

/**
 * A small colored square with the label's name for screen readers and as a tooltip. Your
 * private label has a ring, so it can't be mistaken for the shared one (Q19).
 */
export function LabelSwatch({
  color,
  name,
  mine = false,
}: {
  color: LabelColor;
  name: string;
  /** Your private label rather than the shared one. */
  mine?: boolean;
}) {
  const kind = mine ? 'Your label' : 'Shared label';
  return (
    <span
      className={mine ? styles.swatchMine : styles.swatch}
      style={{ background: `var(--lb-${color})` }}
      role="img"
      aria-label={`${kind}: ${name}`}
      title={`${kind}: ${name}`}
    />
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return <span className={styles.tag}>{children}</span>;
}

/**
 * Lease-length mark icons (Q36): a calendar with a slash (doesn't list your length), with a
 * question mark (terms unknown), dashed and empty (no terms entered yet).
 */
export function LeaseIcon({ kind }: { kind: LeaseMarkKind }) {
  return (
    <svg viewBox="0 0 12 12" className={styles.leaseIcon} aria-hidden="true">
      <rect
        x="1.5"
        y="2.5"
        width="9"
        height="8"
        rx="1.2"
        fill="none"
        stroke="currentColor"
        strokeDasharray={kind === 'empty' ? '1.6 1.2' : undefined}
      />
      <path d="M4 1.5v2M8 1.5v2" stroke="currentColor" />
      {kind === 'not-offered' && (
        <>
          <path d="M1.5 5h9" stroke="currentColor" />
          <path d="M2 11 10.5 2" stroke="currentColor" strokeWidth="1.4" />
        </>
      )}
      {kind === 'unknown' && (
        <path
          d="M4.9 6.1a1.2 1.2 0 1 1 1.7 1.1c-.4.2-.6.4-.6.8M6 9.2v.1"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

/**
 * A lease-length mark (M9 review, Q36): "No 15-month lease", "Lease terms unknown", "No
 * lease terms entered". On cards: the icon and the label; on the map's cards, where room is
 * short: the icon alone. Pointing at it explains, and so does its name.
 */
export function LeaseMark({
  kind,
  label,
  explain,
  compact = false,
}: {
  kind: LeaseMarkKind;
  label: string;
  /** The full sentence (tooltip and, for the icon alone, its name). */
  explain: string;
  compact?: boolean;
}) {
  if (compact)
    return (
      <span className={styles.leaseMarkIcon} role="img" aria-label={explain} title={explain}>
        <LeaseIcon kind={kind} />
      </span>
    );
  return (
    <span className={styles.leaseMark} title={explain}>
      <LeaseIcon kind={kind} />
      {label}
    </span>
  );
}

/** "12-month lease": the unit has its own lease length, so it's priced differently (slate). */
export function OwnLeaseTag({ months, defaultMonths }: { months: number; defaultMonths: number }) {
  const text = `Priced for the ${months}-month lease picked for this unit; your other units use ${defaultMonths} months.`;
  return (
    <span className={styles.tag} title={text}>
      {months}-month lease<span className={styles.visuallyHidden}>. {text}</span>
    </span>
  );
}

/** A value, or italic "Unknown" when it hasn't been researched (spec §3). */
export function Value({ children }: { children: ReactNode }) {
  if (children === null || children === undefined || children === '')
    return <span className={styles.unknown}>Unknown</span>;
  return <>{children}</>;
}

/** Placeholder thumbnail until photos arrive (M12): the unit type's icon. */
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

/**
 * A person's badge: their initial on their color (DESIGN.md §2.6). Decorative when the
 * name is written next to it; otherwise it carries the name for screen readers.
 */
export function PersonBadge({
  person,
  size = 'small',
  named = false,
}: {
  person: Pick<Person, 'name' | 'color'>;
  size?: 'small' | 'medium';
  /** The name is written next to the badge, so the badge itself stays silent. */
  named?: boolean;
}) {
  return (
    <span
      className={size === 'medium' ? styles.badgeMedium : styles.badge}
      style={{ background: PERSON_COLOR_VAR[person.color] }}
      title={person.name}
      {...(named ? { 'aria-hidden': true } : { role: 'img', 'aria-label': person.name })}
    >
      {initial(person.name)}
    </span>
  );
}

/**
 * Stars you can click: one button per star; clicking the current rating clears it.
 * `label` names whose rating it is ("Your rating", "Alex’s rating").
 */
export function StarInput({
  rating,
  label,
  onChange,
  disabled = false,
}: {
  rating: Rating;
  label: string;
  onChange: (rating: Rating) => void;
  disabled?: boolean;
}) {
  return (
    <span className={styles.starInput} role="group" aria-label={label}>
      {([1, 2, 3, 4, 5] as const).map((n) => (
        <button
          key={n}
          type="button"
          className={styles.starButton}
          data-on={n <= rating || undefined}
          aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
          aria-pressed={n === rating}
          title={n === rating ? 'Click again to clear' : `${n} of 5`}
          disabled={disabled}
          onClick={() => onChange(n === rating ? 0 : n)}
        >
          <span aria-hidden="true">★</span>
        </button>
      ))}
    </span>
  );
}
