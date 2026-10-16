import { Link } from 'react-router-dom';
import {
  buildingName,
  listingAgeLabel,
  num,
  rejectReasonText,
  rentLabel,
  unitTitle,
} from '../../domain/format';
import type { Settings } from '../../model';
import type { UnitRow } from '../../state/derive';
import { FlagMark, LabelSwatch, Stars, StatusPill, Tag, TypeIcon } from '../common/Markers';
import styles from './list.module.css';

/** One unit in the list (DESIGN.md §4.1). Rent is the headline until total cost (M8). */
export function UnitCard({
  row,
  selected,
  settings,
  hovered = false,
}: {
  row: UnitRow;
  selected: boolean;
  /** Its pin is under the pointer on the map. */
  hovered?: boolean;
  settings: Settings;
}) {
  const { unit: u, building: b } = row;
  const title = unitTitle(u, b);
  const bName = b ? buildingName(b) : null;
  const rent = rentLabel(u);
  const rejected = u.flag === 'reject';

  return (
    <Link
      to={`/unit/${u.id}`}
      className={styles.card}
      data-dim={rejected || undefined}
      aria-current={selected ? 'true' : undefined}
      data-hover={hovered || undefined}
      data-key={`unit:${u.id}`}
    >
      <span className={styles.thumb}>
        <TypeIcon type={u.type} />
        {u.colorLabel && (
          <span className={styles.thumbLabel}>
            <LabelSwatch color={u.colorLabel} name={settings.labelNames[u.colorLabel]} />
          </span>
        )}
      </span>
      <span className={styles.body}>
        <span className={styles.titleRow}>
          <span className={styles.unitTitle}>{title}</span>
          {bName && bName !== title && <span className={styles.bldg}>{bName}</span>}
          <span className={styles.starsSlot}>
            <Stars rating={u.rating} />
          </span>
        </span>
        <span className={styles.specs}>
          {u.bedrooms === 0 ? (
            <span>
              <b>Studio</b>
            </span>
          ) : (
            <span>
              <b>{u.bedrooms === null ? '?' : num(u.bedrooms)}</b> bd
            </span>
          )}
          <span>
            <b>{u.bathrooms === null ? '?' : num(u.bathrooms)}</b> ba
          </span>
          <span>
            <b>{u.squareFeet === null ? '?' : num(u.squareFeet)}</b> ft²
          </span>
          {u.isFloorPlanOnly ? (
            <span>units vary</span>
          ) : (
            u.floor !== null && <span>Floor {u.floor}</span>
          )}
          {u.exposure && u.exposure.length > 0 && <span>{u.exposure.join(' ')}</span>}
        </span>
        <span className={styles.money}>
          {rent ? (
            <span className={styles.rent}>
              {rent}
              <small>/mo rent</small>
            </span>
          ) : (
            <span className={styles.rentUnknown}>Rent unknown</span>
          )}
        </span>
        <span className={styles.foot}>
          {u.isFloorPlanOnly && <Tag>floor plan</Tag>}
          {b && b.location === null && <Tag>Needs location</Tag>}
          {rejected ? (
            <FlagMark flag="reject" reasons={rejectReasonText(u.rejectReasonIds, settings)} />
          ) : (
            <>
              <FlagMark flag={u.flag} />
              <StatusPill status={u.status} />
            </>
          )}
          {row.listingAgeDays !== null && (
            <span className={styles.age}>{listingAgeLabel(row.listingAgeDays)}</span>
          )}
        </span>
      </span>
    </Link>
  );
}
