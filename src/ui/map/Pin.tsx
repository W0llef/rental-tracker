import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { PinContent } from '../../domain/pins';
import type { PinStyle } from '../../domain/pinPrefs';
import type { UnitType } from '../../model';
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
  /** `unit:<id>` or `building:<id>`; left out for previews and measuring copies. */
  pinKey?: string;
  style: PinStyle;
  content: PinContent;
  /** Placeholder for the photo until photos arrive (M11), and the icon of an empty plate. */
  type: UnitType | null;
  /** Units behind the pin; more than 1 shows a count. */
  count: number;
  /** One color per unit (one for a single unit). */
  stripes: readonly string[];
  selected: boolean;
  rejected: boolean;
  faded: boolean;
  /** Shrunk to a dot because the map is zoomed out or crowded. */
  dot: boolean;
  /** In a fan: centered on its spot, no tail (a leader line joins it to the hub). */
  inFan?: boolean;
  /** Its card is under the pointer: outlined. */
  hot?: boolean;
  newMark: 'dot' | 'tag' | null;
  /** Spoken description after the visible text. */
  label: string;
  expanded?: boolean;
  onClick: () => void;
  onHover: (on: boolean) => void;
}

/** Vertical stripes for a plate's edge, a bar under a photo, a ring for a dot. */
function Stripes({ colors, horizontal }: { colors: readonly string[]; horizontal?: boolean }) {
  return (
    <span className={horizontal ? styles.bar : styles.edge} aria-hidden="true">
      {colors.map((c, i) => (
        <i key={i} style={{ background: c }} />
      ))}
    </span>
  );
}

function ring(colors: readonly string[]): string {
  if (colors.length <= 1) return colors[0] ?? 'var(--ice)';
  const step = 100 / colors.length;
  return `conic-gradient(${colors
    .map((c, i) => `${c} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`)
    .join(', ')})`;
}

function Segments({ content }: { content: PinContent }) {
  return (
    <>
      {content.typeIcon && (
        <span className={styles.ico}>
          <TypeGlyph type={content.typeIcon} />
        </span>
      )}
      {content.segments.map((s, i) => (
        <span key={s.field} className={`${styles.pseg} ${styles[`f-${s.field}`] ?? ''}`}>
          {i > 0 && ' '}
          {s.text}
        </span>
      ))}
    </>
  );
}

/**
 * One pin (DESIGN.md §2.4, reworked in M3 review): a sign plate with one segment per field,
 * a dot, or a photo with the fields printed underneath. Every style keeps the same cues:
 * colored stripes (one per unit), a tail pointing at the building, and navy when selected.
 */
export function Pin(p: PinProps) {
  // A pin can disappear under the pointer (clicking a building swaps it for its fan) without
  // a "pointer left" event; let go of the hover then, or its card would stay highlighted.
  const hovered = useRef(false);
  const onHover = useRef(p.onHover);
  useEffect(() => {
    onHover.current = p.onHover;
  });
  useEffect(
    () => () => {
      if (hovered.current) onHover.current(false);
    },
    [],
  );
  const hover = (on: boolean) => {
    hovered.current = on;
    p.onHover(on);
  };
  const multi = p.count > 1;
  const asDot = p.dot || p.style === 'dot';
  const cls = [styles.pin];
  if (p.selected) cls.push(styles.sel);
  if (p.rejected) cls.push(styles.rej);
  if (p.faded) cls.push(styles.faded);
  if (p.inFan) cls.push(styles.inFan);
  if (p.hot) cls.push(styles.hot);
  const empty = !p.content.typeIcon && !p.content.segments.length;

  let inner;
  let style: CSSProperties | undefined;
  if (asDot) {
    cls.push(styles.dot);
    if (multi) cls.push(styles.multi);
    style = p.rejected ? undefined : { background: ring(p.stripes) };
    inner = multi ? <span className={styles.txt}>{p.count}</span> : null;
  } else if (p.style === 'photo') {
    cls.push(styles.photo);
    inner = (
      <>
        <span className={styles.noph}>
          <TypeGlyph type={p.type} />
        </span>
        <Stripes colors={p.stripes} horizontal />
        {!empty && (
          <span className={styles.caption}>
            <Segments content={p.content} />
          </span>
        )}
        {multi && <span className={styles.cnt}> {p.count}</span>}
      </>
    );
  } else {
    inner = (
      <>
        <Stripes colors={p.stripes} />
        {empty ? (
          <span className={styles.ico}>
            <TypeGlyph type={p.type} />
          </span>
        ) : (
          <Segments content={p.content} />
        )}
        {multi && <span className={styles.cnt}> {p.count}</span>}
      </>
    );
  }

  // The accessible name starts with what the pin visibly says (WCAG 2.5.3, label in name),
  // so "click $1,650" works with voice control; the description follows.
  const visible = [
    ...(asDot ? [] : p.content.segments.map((s) => s.text)),
    multi ? String(p.count) : null,
    p.newMark === 'tag' ? 'New' : null,
  ].filter(Boolean);
  const name = visible.length ? `${visible.join(' ')}, ${p.label}` : p.label;

  return (
    <button
      type="button"
      className={cls.join(' ')}
      style={style}
      aria-label={name}
      aria-pressed={p.expanded === undefined ? p.selected : undefined}
      aria-expanded={p.expanded}
      data-pin={p.pinKey}
      data-shape={asDot ? 'dot' : p.style}
      onClick={(e) => {
        e.stopPropagation();
        p.onClick();
      }}
      onMouseEnter={() => hover(true)}
      onMouseLeave={() => hover(false)}
      onFocus={() => hover(true)}
      onBlur={() => hover(false)}
    >
      {inner}
      {p.newMark === 'dot' && <span className={styles.newb} aria-hidden="true" />}
      {p.newMark === 'tag' && <span className={styles.newTag}> New</span>}
    </button>
  );
}
