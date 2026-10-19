import { useEffect, useRef } from 'react';
import { accessibleName } from '../../domain/pins';
import type { PinContent } from '../../domain/pins';
import type { UnitType } from '../../model';
import { Segments, TypeGlyph } from './Pin';
import styles from './map.module.css';

/**
 * An open building's card on the map (owner review 4, DESIGN.md §2.4): a header with the
 * building's marker, name (opens its details), unit count and a close button, then one row
 * per unit with the same stripe, fields and New badge its pin would have. With photo pins
 * each row has a thumbnail; pointing at it (or focusing the row) asks the map for its larger
 * preview beside the card (`onPreview`), drawn above everything else on the map.
 */

export interface CardRow {
  /** `unit:<id>` */
  key: string;
  content: PinContent;
  type: UnitType | null;
  stripe: string;
  newMark: 'dot' | 'tag' | null;
  selected: boolean;
  rejected: boolean;
  faded: boolean;
  /** Its list card is under the pointer. */
  hot: boolean;
  /** Spoken description after the visible text. */
  label: string;
  /** For the preview's caption: "Unit 1504". */
  title: string;
}

export interface MapCardProps {
  id: string;
  name: string;
  rows: readonly CardRow[];
  photo: boolean;
  /** Another card is under the pointer: this one steps back. */
  dim?: boolean;
  /** `additive`: ⌘/Ctrl- or Shift-click, which adds to the selection (M7). */
  onSelect?: (key: string, additive: boolean) => void;
  onOpenBuilding?: (additive: boolean) => void;
  onClose?: () => void;
  onHover?: (key: string | null) => void;
  /** Show a unit's larger photo beside `card`, level with `row`; null hides it. */
  onPreview?: (key: string | null, anchor?: { card: DOMRect; row: DOMRect }) => void;
}

export function MapCard(p: MapCardProps) {
  const root = useRef<HTMLDivElement>(null);

  // A card can close under the pointer (its ✕, Esc) without a "pointer left" event; let go
  // of the hover then, or the list card would stay highlighted.
  const hovered = useRef(false);
  const previewing = useRef(false);
  const handlers = useRef({ onHover: p.onHover, onPreview: p.onPreview });
  useEffect(() => {
    handlers.current = { onHover: p.onHover, onPreview: p.onPreview };
  });
  useEffect(
    () => () => {
      if (hovered.current) handlers.current.onHover?.(null);
      if (previewing.current) handlers.current.onPreview?.(null);
    },
    [],
  );
  const hover = (key: string | null) => {
    hovered.current = key !== null;
    p.onHover?.(key);
  };
  const buildingKey = `building:${p.id}`;

  const showPreview = (key: string, row: HTMLElement) => {
    const card = root.current;
    if (!p.photo || !card) return;
    previewing.current = true;
    p.onPreview?.(key, { card: card.getBoundingClientRect(), row: row.getBoundingClientRect() });
  };
  const hidePreview = () => {
    if (!previewing.current) return;
    previewing.current = false;
    p.onPreview?.(null);
  };

  return (
    <div
      ref={root}
      className={`${styles.card} ${p.dim ? styles.dimCard : ''}`}
      role="group"
      aria-label={`Units at ${p.name}`}
      data-card={p.id}
      onMouseEnter={() => hover(buildingKey)}
      onMouseLeave={() => {
        hidePreview();
        hover(null);
      }}
    >
      <div className={styles.cardHead}>
        <span className={styles.cardMark} aria-hidden="true" />
        <button
          type="button"
          className={styles.cardName}
          title="Building details"
          onClick={(e) => {
            e.stopPropagation();
            p.onOpenBuilding?.(e.metaKey || e.ctrlKey || e.shiftKey);
          }}
        >
          {p.name}
        </button>
        <span className={styles.cardCount}>{p.rows.length} units</span>
        <button
          type="button"
          className={styles.cardClose}
          aria-label={`Close ${p.name}`}
          title="Close (Esc closes all)"
          data-close={p.id}
          onClick={(e) => {
            e.stopPropagation();
            p.onClose?.();
          }}
        >
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      </div>
      <ul className={styles.cardRows}>
        {p.rows.map((r) => {
          const cls = [styles.row];
          if (r.selected) cls.push(styles.rowSel);
          if (r.rejected) cls.push(styles.rowRej);
          if (r.faded) cls.push(styles.rowFaded);
          if (r.hot) cls.push(styles.hot);
          const empty = !r.content.typeIcon && !r.content.segments.length;
          const name = accessibleName(
            [...r.content.segments.map((s) => s.text), r.newMark === 'tag' ? 'New' : null],
            r.label,
          );
          return (
            <li key={r.key}>
              <button
                type="button"
                className={cls.join(' ')}
                aria-label={name}
                aria-pressed={r.selected}
                data-pin={r.key}
                onClick={(e) => {
                  e.stopPropagation();
                  p.onSelect?.(r.key, e.metaKey || e.ctrlKey || e.shiftKey);
                }}
                onMouseEnter={() => hover(r.key)}
                onMouseLeave={() => {
                  hidePreview();
                  hover(buildingKey);
                }}
                onFocus={(e) => {
                  hover(r.key);
                  showPreview(r.key, e.currentTarget);
                }}
                onBlur={() => {
                  hidePreview();
                  hover(null);
                }}
              >
                <i className={styles.rowEdge} style={{ background: r.stripe }} aria-hidden="true" />
                {p.photo && (
                  <span
                    className={styles.thumb}
                    aria-hidden="true"
                    onMouseEnter={(e) =>
                      showPreview(r.key, e.currentTarget.closest('button') as HTMLElement)
                    }
                    onMouseLeave={hidePreview}
                  >
                    <TypeGlyph type={r.type} />
                  </span>
                )}
                <span className={styles.rowText}>
                  {empty ? (
                    <span className={styles.ico}>
                      <TypeGlyph type={r.type} />
                    </span>
                  ) : (
                    <Segments content={r.content} />
                  )}
                </span>
                {/* The space keeps "New" a separate word for the accessible name; flex hides it */}
                {r.newMark === 'tag' && ' '}
                {r.newMark === 'tag' && <span className={styles.rowNew}>New</span>}
                {r.newMark === 'dot' && <span className={styles.rowNewDot} aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
