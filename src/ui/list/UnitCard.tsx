import { Link } from 'react-router-dom';
import {
  buildingName,
  listingAgeLabel,
  num,
  rejectReasonText,
  rentLabel,
  unitTitle,
} from '../../domain/format';
import { CARD_BADGES, othersSummary, ratingsSummary, starRange } from '../../domain/people';
import type { OthersSummary } from '../../domain/people';
import type { Settings } from '../../model';
import type { UnitRow } from '../../state/derive';
import {
  FlagMark,
  LabelSwatch,
  PersonBadge,
  Stars,
  StatusPill,
  Tag,
  TypeIcon,
} from '../common/Markers';
import styles from './list.module.css';

/**
 * Everyone else's ratings and flags in one chip of fixed size (M6 owner review): up to
 * three badges (+N for more), the range of their stars, and counts of picks (✓) and
 * rejects (✕). The full list is in the tooltip, for screen readers, and in the unit's
 * Ratings section.
 */
function OthersChip({ summary }: { summary: OthersSummary }) {
  const { rows, picks, rejects } = summary;
  const shown = rows.slice(0, CARD_BADGES);
  const more = rows.length - shown.length;
  const stars = starRange(summary);
  const label = `Others: ${ratingsSummary(rows)}`;
  return (
    <span className={styles.others} role="img" aria-label={label} title={ratingsSummary(rows)}>
      <span className={styles.badges} aria-hidden="true">
        {shown.map((r) => (
          <PersonBadge key={r.person.id} person={r.person} named />
        ))}
        {more > 0 && <span className={styles.more}>+{more}</span>}
      </span>
      {stars && <span aria-hidden="true">{stars}</span>}
      {picks > 0 && (
        <span aria-hidden="true" className={styles.otherPick}>
          ✓{picks > 1 ? picks : ''}
        </span>
      )}
      {rejects > 0 && (
        <span aria-hidden="true" className={styles.otherReject}>
          ✕{rejects > 1 ? rejects : ''}
        </span>
      )}
    </span>
  );
}

/**
 * One unit in the list (DESIGN.md §4.1). Rent is the headline until total cost (M9).
 * Stars and flag are yours; other people's sit in one small chip at the foot (§5.8).
 */
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
  const mine = row.mine;
  const rejected = mine.flag === 'reject';
  const others = othersSummary(row.opinions);

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
            <Stars rating={mine.rating} />
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
            <FlagMark flag="reject" reasons={rejectReasonText(mine.rejectReasonIds, settings)} />
          ) : (
            <>
              <FlagMark flag={mine.flag} />
              <StatusPill status={u.status} />
            </>
          )}
          {others && <OthersChip summary={others} />}
          {row.listingAgeDays !== null && (
            <span className={styles.age}>{listingAgeLabel(row.listingAgeDays)}</span>
          )}
        </span>
      </span>
    </Link>
  );
}
