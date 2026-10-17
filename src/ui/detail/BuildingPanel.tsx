import { Link } from 'react-router-dom';
import {
  BUILDING_TYPE_LABELS,
  buildingName,
  enumLabel,
  num,
  rangeLabel,
  rentLabel,
  unitTitle,
} from '../../domain/format';
import { sortUnits } from '../../domain/sort';
import type { ISODate } from '../../model';
import type { BuildingRow } from '../../state/derive';
import { PlaceOnMapButton } from '../add/PlaceOnMap';
import { DeleteSection } from '../edit/DeleteSection';
import { StatusPill, Value } from '../common/Markers';
import { mapLinks } from '../../domain/links';
import { Amenities, Facts, Links, Notes, Section } from './parts';
import { fromLinkRecords, isWebUrl, petsText, tri } from './text';
import styles from './detail.module.css';

/**
 * The read-only building panel (#/building/:id, PLAN.md §4.1): building facts, amenities,
 * policies and your units in it, with "Add unit here" and "Place on map" (M4).
 */
export function BuildingPanel({ row, today }: { row: BuildingRow; today: ISODate }) {
  const b = row.building;
  const name = buildingName(b);
  const range = rangeLabel(row.minRent, row.maxRent);
  const units = sortUnits(row.units, { key: 'rent', dir: 'asc' });
  const links = [
    ...(isWebUrl(b.website) ? [{ key: 'website', label: 'Building website', url: b.website }] : []),
    ...(isWebUrl(b.availabilityUrl)
      ? [{ key: 'availability', label: 'Availability page', url: b.availabilityUrl }]
      : []),
    ...fromLinkRecords(b.links),
    ...mapLinks(b),
  ];

  return (
    <article className={styles.panel} aria-labelledby="detail-title">
      <header className={styles.plate}>
        <div className={styles.plateMain}>
          <h2 id="detail-title" className={styles.plateTitle}>
            {name}
          </h2>
          <p className={styles.where}>
            {b.address.formatted}
            {b.neighborhood && (
              <>
                <br />
                {b.neighborhood.name}
              </>
            )}
          </p>
        </div>
        <div className={styles.big}>
          {range && (
            <div className={styles.bigNum}>
              {range}
              <small> /mo</small>
            </div>
          )}
          <div className={styles.bigSub}>
            {row.unitCount} of your unit{row.unitCount === 1 ? '' : 's'}
          </div>
        </div>
        {b.location === null && (
          <p className={styles.plateNote}>
            Needs location: not on the map yet. <PlaceOnMapButton building={b} />
          </p>
        )}
      </header>

      <Section
        title="Your units here"
        action={
          <Link to={`/add?building=${b.id}`} state={{ inApp: true }}>
            Add unit here
          </Link>
        }
      >
        {units.length === 0 ? (
          <p className={styles.muted}>None of your units are in this building.</p>
        ) : (
          <ul className={styles.unitLinks}>
            {units.map((u) => (
              <li key={u.unit.id}>
                <Link to={`/unit/${u.unit.id}`}>
                  <span className={styles.ulTitle}>{unitTitle(u.unit, b)}</span>
                  <span className={styles.ulRent}>{rentLabel(u.unit) ?? 'Rent unknown'}</span>
                  <StatusPill status={u.unit.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Building">
        <Facts
          items={[
            ['Type', b.buildingType && BUILDING_TYPE_LABELS[b.buildingType]],
            ['Floors', b.floors === null ? null : num(b.floors)],
            ['Total units', b.totalUnits === null ? null : num(b.totalUnits)],
            ['Year built', b.yearBuilt === null ? null : String(b.yearBuilt)],
            ['Renovated', b.yearRenovated === null ? null : String(b.yearRenovated)],
            ['Elevator', tri(b.elevator)],
          ]}
        />
      </Section>

      <Section title="Amenities">
        <Amenities building={b} />
        {b.amenitiesNotes && <p className={styles.para}>{b.amenitiesNotes}</p>}
      </Section>

      <Section title="Policies">
        <Facts
          items={[
            ['Smoking', b.smoking && enumLabel(b.smoking)],
            ['Subletting', b.subletPolicy && enumLabel(b.subletPolicy)],
            ['Guest parking', b.guestParking],
          ]}
        />
        <p className={styles.para}>
          <b>Pets:</b> {petsText(b.pets) ?? <Value>{null}</Value>}
        </p>
        {b.policyNotes && <p className={styles.para}>{b.policyNotes}</p>}
      </Section>

      <Section title="Contact">
        <Facts
          items={[
            ['Management', b.managementCompany],
            ['Phone', b.phone],
            ['Email', b.email],
          ]}
        />
      </Section>

      <Section title="Notes">
        {b.notes && <p className={styles.para}>{b.notes}</p>}
        <Notes notes={row.notes} today={today} />
      </Section>

      <Section title="Links">
        <Links links={links} />
      </Section>
      <DeleteSection kind="building" id={b.id} name={name} unitCount={row.unitCount} />
    </article>
  );
}
