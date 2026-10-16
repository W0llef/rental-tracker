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
}: {
  row: BuildingRow;
  selected: boolean;
  /** Its pin is under the pointer on the map. */
  hovered?: boolean;
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
    >
      <span className={styles.thumb}>
        <TypeIcon type={b.buildingType === 'house' ? 'house' : 'building'} />
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
