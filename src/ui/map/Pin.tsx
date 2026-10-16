import type { CSSProperties } from 'react';
import type { PinContent, UnitType } from '../../model';
import styles from './map.module.css';

/** 16 px unit-type glyphs for pins (DESIGN.md §2.4): apartment, condo, townhome, house, room. */
const GLYPHS: Record<UnitType, string> = {
  apartment:
    'M3 1.5h10v13H9.5v-3h-3v3H3zM5 3.5v1.5h1.5V3.5zm4.5 0v1.5H11V3.5zM5 6.5V8h1.5V6.5zm4.5 0V8H11V6.5zM5 9.5V11h1.5V9.5zm4.5 0V11H11V9.5z',
  condo: 'M2 5.5 8 1.5l6 4v9H9.5v-3.5h-3V14.5H2zM6 6v1.6h1.5V6zm2.5 0v1.6H10V6z',
  house: 'M8 1.5 1 7.5h2v7h3.6v-4h2.8v4H13v-7h2z',
  townhome: 'M4.5 3 0.5 7h1.5v7.5h5V7h1.2zM11.5 3l-4 4h1.5v7.5h5V7h1.5z',
  room: 'M1 13.5V5h2v4h10a2 2 0 0 1 2 2v2.5h-2V12H3v1.5zM4 6.5h3.5V8H4z',
};

export function TypeGlyph({ type }: { type: UnitType | null }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d={GLYPHS[type ?? 'apartment']} />
    </svg>
  );
}

export interface PinProps {
  /** Effective "Pins show" option (pending options already resolved to rent). */
  show: PinContent;
  text: string | null;
  type: UnitType | null;
  /** Star text for the "Star rating" extra, or null when that extra is off. */
  stars: string | null;
  showTypeIcon: boolean;
  /** Units behind a grouped pin; 1 for a single unit. */
  count: number;
  edge: string;
  selected: boolean;
  rejected: boolean;
  faded: boolean;
  /** Shrunk to a dot because the map is zoomed out or crowded. */
  dot: boolean;
  newBadge: boolean;
  label: string;
  expanded?: boolean;
  pinKey: string;
  onClick: () => void;
  onHover: (on: boolean) => void;
}

/**
 * One sign-plate pin (DESIGN.md §2.4). Every variant keeps the same cues: a colored edge,
 * a tail pointing at the building, and navy when selected.
 */
export function Pin(p: PinProps) {
  const multi = p.count > 1;
  const asDot = p.dot || p.show === 'dot';
  const cls = [styles.pin];
  if (p.selected) cls.push(styles.sel);
  if (p.rejected) cls.push(styles.rej);
  if (p.faded) cls.push(styles.faded);

  // The accessible name starts with what the pin visibly says (WCAG 2.5.3, label in name),
  // so "click $1,650" works with voice control; the description follows.
  const visible: (string | number | null)[] = [];
  let inner;
  if (asDot) {
    cls.push(styles.dot);
    if (multi) cls.push(styles.multi);
    inner = multi ? <span className={styles.txt}>{p.count}</span> : null;
    if (multi) visible.push(p.count);
  } else if (p.show === 'photo') {
    // Photos arrive in M11; until then the frame holds the unit-type icon.
    cls.push(styles.photo);
    inner = (
      <>
        <span className={styles.noph}>
          <TypeGlyph type={p.type} />
        </span>
        {multi && <span className={styles.cnt}>{p.count}</span>}
      </>
    );
    if (multi) visible.push(p.count);
  } else if (p.show === 'type') {
    cls.push(styles.iconOnly);
    inner = (
      <>
        <span className={styles.ico}>
          <TypeGlyph type={p.type} />
        </span>
        {p.stars && <span className={styles.sx}>{p.stars}</span>}{' '}
        {multi && <span className={styles.cnt}>{p.count}</span>}
      </>
    );
    visible.push(p.stars, multi ? p.count : null);
  } else {
    inner = (
      <>
        {p.showTypeIcon && (
          <span className={styles.ico}>
            <TypeGlyph type={p.type} />
          </span>
        )}
        <span className={styles.txt}>{p.text}</span>{' '}
        {p.stars && p.show !== 'rating' && <span className={styles.sx}>{p.stars}</span>}{' '}
        {multi && <span className={styles.cnt}>{p.count}</span>}
      </>
    );
    visible.push(p.text, p.stars && p.show !== 'rating' ? p.stars : null, multi ? p.count : null);
  }
  const shown = visible.filter((v) => v !== null && v !== '').join(' ');

  return (
    <button
      type="button"
      className={cls.join(' ')}
      style={{ '--edge': p.edge } as CSSProperties}
      aria-label={shown ? `${shown}, ${p.label}` : p.label}
      aria-pressed={p.expanded === undefined ? p.selected : undefined}
      aria-expanded={p.expanded}
      data-pin={p.pinKey}
      data-shape={asDot ? 'dot' : 'plate'}
      onClick={(e) => {
        e.stopPropagation();
        p.onClick();
      }}
      onMouseEnter={() => p.onHover(true)}
      onMouseLeave={() => p.onHover(false)}
      onFocus={() => p.onHover(true)}
      onBlur={() => p.onHover(false)}
    >
      {inner}
      {p.newBadge && <span className={styles.newb} aria-hidden="true" />}
    </button>
  );
}
