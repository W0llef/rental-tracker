import type { MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { BUILDING_TYPE_LABELS, buildingName, rangeLabel } from '../../domain/format';
import type { BuildingRow } from '../../state/derive';
import { Tag, TypeIcon } from '../common/Markers';
import styles from './list.module.css';

/** One building in the Buildings view (DESIGN.md §4.1, last bullet). */
export function BuildingCard({
  row,
  selected,
  hovered = false,
  picked = false,
  onPickClick,
}: {
  row: BuildingRow;
  selected: boolean;
  /** Its pin is under the pointer on the map. */
  hovered?: boolean;
  /** Selected with others to edit them together (M8, Q23). */
  picked?: boolean;
  /** Any click (with ⌘/Ctrl or Shift it selects instead of opening). */
  onPickClick?: (e: MouseEvent, buildingId: string) => void;
}) {
  const b = row.building;
  const name = buildingName(b);
  const meta = [
    b.neighborhood?.name,
    b.buildingType && BUILDING_TYPE_LABELS[b.buildingType],
  ].filter((m): m is string => !!m);
  const count =
    row.matching.length === row.unitCount
      ? `${row.unitCount} of your units`
      : `${row.matching.length} of ${row.unitCount} of your units match`;
  const range = rangeLabel(row.minRent, row.maxRent);

  return (
    <Link
      to={`/building/${b.id}`}
      className={styles.card}
      aria-current={selected ? 'true' : undefined}
      data-hover={hovered || undefined}
      data-key={`building:${b.id}`}
      data-picked={picked || undefined}
      onClick={(e) => {
        // ⌘/Ctrl- or Shift-click selects buildings to edit together (Q23) instead of
        // opening a new tab or window.
        if (e.metaKey || e.ctrlKey || e.shiftKey) e.preventDefault();
        onPickClick?.(e, b.id);
      }}
    >
      {picked && <span className={styles.visuallyHidden}>Selected: </span>}
      <span className={styles.thumb}>
        <TypeIcon type={b.buildingType === 'house' ? 'house' : 'building'} />
        {picked && (
          <span className={styles.pickBox} aria-hidden="true">
            <svg viewBox="0 0 12 12">
              <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </span>
        )}
      </span>
      <span className={styles.body}>
        <span className={styles.titleRow}>
          <span className={`${styles.unitTitle} ${styles.wide}`}>{name}</span>
        </span>
        <span className={styles.specs}>
          {meta.length > 0
            ? meta.map((m) => <span key={m}>{m}</span>)
            : name !== b.address.line1 && <span>{b.address.line1}</span>}
        </span>
        <span className={styles.money}>
          {range ? (
            <span className={styles.rent}>
              {range}
              <small>/mo rent</small>
            </span>
          ) : (
            <span className={styles.rentUnknown}>Rents unknown</span>
          )}
        </span>
        <span className={styles.foot}>
          <span>{count}</span>
          {b.location === null && <Tag>Needs location</Tag>}
        </span>
      </span>
    </Link>
  );
}
