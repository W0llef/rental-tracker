import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BUILDING_TYPE_LABELS,
  buildingName,
  enumLabel,
  leaseTermsLabel,
  money,
  num,
  rentLabel,
  shortDate,
  SITE_LABELS,
  sqftLabel,
  UNIT_TYPE_LABELS,
  UTILITY_LABELS,
  unitTitle,
  utilityLabel,
} from '../../domain/format';
import { listingPrices, priceHistory } from '../../domain/listings';
import { UTILITY_KEYS } from '../../model';
import type { ISODate, Person, Settings, Unit } from '../../model';
import type { UnitRow } from '../../state/derive';
import { PasteIntoUnit } from '../add/PasteIntoUnit';
import { PlaceOnMapButton } from '../add/PlaceOnMap';
import { DeleteSection } from '../edit/DeleteSection';
import { EssentialsSection } from './Essentials';
import { Tag, Value } from '../common/Markers';
import { MarkerControls } from '../triage/MarkerControls';
import { NotesLog } from '../triage/NotesLog';
import { Compass } from './Compass';
import { mapLinks } from '../../domain/links';
import { Amenities, Facts, Links, Rows, Section } from './parts';
import { fromLinkRecords, isWebUrl, petsText, structureText, tri } from './text';
import type { ExternalLink } from './text';
import { PriceChart } from './PriceChart';
import { RatingsSection } from './Ratings';
import styles from './detail.module.css';

const usd = (v: number | null) => (v === null ? null : money(v));

function floorText(u: Unit, floors: number | null): string | null {
  if (u.floor === null) return u.isFloorPlanOnly ? 'Units vary' : null;
  return floors !== null ? `${u.floor} of ${floors}` : String(u.floor);
}

function LeaseSection({ u, today }: { u: Unit; today: ISODate }) {
  const extras: [string, string, string][] = [];
  for (const f of u.recurringFees ?? []) extras.push([f.label, `${money(f.amount)}/mo`, f.id]);
  for (const t of u.rentByTerm ?? [])
    extras.push([`Rent on a ${t.months}-month lease`, money(t.rent), `term-${t.months}`]);
  return (
    <Section title="Lease and fees">
      <Facts
        items={[
          ['Rent', rentLabel(u)],
          ['Available', u.availableDate && shortDate(u.availableDate, today)],
          ['Lease terms', leaseTermsLabel(u.leaseTermsMonths)],
          ['Deposit', usd(u.deposit)],
          ['Application fee', usd(u.applicationFee)],
          ['Admin fee', usd(u.adminFee)],
        ]}
      />
      {(extras.length > 0 || u.recurringFees !== null || u.moveInSpecial) && (
        <div className={styles.subBlock}>
          {u.recurringFees !== null && u.recurringFees.length === 0 && (
            <p className={styles.muted}>No monthly fees besides rent.</p>
          )}
          {extras.length > 0 && <Rows items={extras} />}
          {u.moveInSpecial && (
            <p className={styles.special}>
              <b>Move-in special:</b> {u.moveInSpecial.text}
              {u.moveInSpecial.valueUsd !== null && ` (worth ${money(u.moveInSpecial.valueUsd)})`}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

function UnitFacts({ u, floors }: { u: Unit; floors: number | null }) {
  return (
    <Section title="Unit">
      <Facts
        items={[
          ['Type', u.type && UNIT_TYPE_LABELS[u.type]],
          ['Bedrooms', u.bedrooms === null ? null : u.bedrooms === 0 ? 'Studio' : num(u.bedrooms)],
          ['Bathrooms', u.bathrooms === null ? null : num(u.bathrooms)],
          ['Size', u.squareFeet === null ? null : sqftLabel(u.squareFeet)],
          ['Floor', floorText(u, floors)],
          ['Furnished', u.furnished && enumLabel(u.furnished)],
          ['Laundry', u.laundry && enumLabel(u.laundry)],
          ['Dishwasher', tri(u.dishwasher)],
          ['AC', u.acType && enumLabel(u.acType)],
          ['Heating', u.heatingType && enumLabel(u.heatingType)],
          ['Balcony', tri(u.balcony)],
          ['Fireplace', tri(u.fireplace)],
          ['Flooring', u.flooring],
        ]}
      />
      {u.layoutNotes && (
        <p className={styles.para}>
          <b>Layout:</b> {u.layoutNotes}
        </p>
      )}
      {u.viewNotes && (
        <p className={styles.para}>
          <b>View:</b> {u.viewNotes}
        </p>
      )}
    </Section>
  );
}

function WindowsSection({ u }: { u: Unit }) {
  const exposure = u.exposure ?? [];
  const fromWindows = (u.windows ?? []).map((w) => w.direction).filter((d) => d !== null);
  const dirs = exposure.length ? exposure : fromWindows;
  return (
    <Section title="Windows and exposure">
      {dirs.length === 0 && (u.windows === null || u.windows.length === 0) ? (
        <p className={styles.muted}>
          {u.isFloorPlanOnly ? 'Depends on the unit.' : <Value>{null}</Value>}
        </p>
      ) : (
        <div className={styles.win}>
          {dirs.length > 0 && <Compass directions={dirs} />}
          <ul>
            {exposure.length > 0 && (
              <li>
                <b>Faces</b> {exposure.join(', ')}
                {exposure.length > 1 && ' (main first)'}
              </li>
            )}
            {(u.windows ?? []).map((w) => (
              <li key={w.id}>
                <b>{w.direction ?? '?'}</b>
                {[w.room, w.size && enumLabel(w.size).toLowerCase(), w.obstruction]
                  .filter(Boolean)
                  .join(', ') || 'Window'}
              </li>
            ))}
            {u.windows === null && (
              <li className={styles.muted}>Individual windows not recorded yet.</li>
            )}
          </ul>
        </div>
      )}
    </Section>
  );
}

function UtilitiesSection({ u }: { u: Unit }) {
  return (
    <Section title="Utilities">
      <Rows items={UTILITY_KEYS.map((k) => [UTILITY_LABELS[k], utilityLabel(u.utilities[k]), k])} />
    </Section>
  );
}

function ParkingSection({ u }: { u: Unit }) {
  const p = u.parking;
  const s = u.storage;
  return (
    <Section title="Parking and storage">
      <Facts
        items={[
          ['Parking', p.type && (p.type === 'none' ? 'None' : enumLabel(p.type))],
          ['Spaces included', p.spacesIncluded === null ? null : num(p.spacesIncluded)],
          ['Extra space', p.extraSpaceCost === null ? null : `${money(p.extraSpaceCost)}/mo`],
          [
            'Storage',
            tri(s.included) === 'Yes'
              ? 'Included'
              : tri(s.included) === 'No'
                ? 'Not included'
                : null,
          ],
          ['Storage cost', s.cost === null ? null : `${money(s.cost)}/mo`],
        ]}
      />
    </Section>
  );
}

function BuildingSection({ row }: { row: UnitRow }) {
  const b = row.building;
  if (!b) return null;
  const pets = petsText(b.pets);
  const structure = structureText(b, b.buildingType && BUILDING_TYPE_LABELS[b.buildingType]);
  const text = (structure || pets) && (
    <p className={styles.para}>{[structure, pets].filter(Boolean).join('. ')}.</p>
  );
  if (row.standalone) {
    // A standalone home (Q30): no separate building; amenities only when some are known.
    const anyAmenity = Object.values(b.amenities).some((v) => v !== null);
    return (
      <Section title="The home">
        {text ?? <p className={styles.muted}>Year built, pets and the rest: Edit (E).</p>}
        {b.managementCompany && <p className={styles.para}>Rented by {b.managementCompany}.</p>}
        {anyAmenity && <Amenities building={b} />}
      </Section>
    );
  }
  return (
    <Section title={buildingName(b)} action={<Link to={`/building/${b.id}`}>Open building</Link>}>
      <Amenities building={b} />
      {text}
    </Section>
  );
}

function ListingsSection({ row, today }: { row: UnitRow; today: ISODate }) {
  const listings = [...row.listings].sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
  const history = priceHistory(listings);
  const [pasting, setPasting] = useState(false);
  return (
    <Section
      title="Listings and price"
      action={
        !pasting && (
          <button type="button" className={styles.linkButton} onClick={() => setPasting(true)}>
            Paste text
          </button>
        )
      }
    >
      {pasting && <PasteIntoUnit row={row} today={today} onDone={() => setPasting(false)} />}
      {listings.length === 0 ? (
        <p className={styles.muted}>No listings yet.</p>
      ) : (
        <ul className={styles.listings}>
          {listings.map((l) => {
            const { current, previous } = listingPrices(l);
            const site = SITE_LABELS[l.site];
            return (
              <li key={l.id} className={styles.lrow}>
                <span className={styles.site}>
                  {isWebUrl(l.url) ? (
                    <a href={l.url} target="_blank" rel="noopener noreferrer">
                      {site}
                      <span className={styles.visuallyHidden}> listing (opens in a new tab)</span>
                    </a>
                  ) : l.url === null && l.site === 'other' ? (
                    'No link'
                  ) : (
                    site
                  )}
                  {l.offMarketAt && <Tag>off market</Tag>}
                </span>
                <span className={styles.lseen}>
                  {l.firstSeen === l.lastSeen
                    ? `seen ${shortDate(l.lastSeen, today)}`
                    : `${shortDate(l.firstSeen, today)} – ${shortDate(l.lastSeen, today)}`}
                </span>
                <span className={styles.lprice}>
                  {previous !== null && (
                    <s>
                      <span className={styles.visuallyHidden}>was </span>
                      {money(previous)}
                    </s>
                  )}
                  {current === null ? <Value>{null}</Value> : money(current)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <PriceChart points={history} today={today} />
    </Section>
  );
}

/** The unit detail panel (DESIGN.md §4.2): triage here (M7); Edit opens the full form (M8). */
export function UnitPanel({
  row,
  settings,
  today,
  me,
}: {
  row: UnitRow;
  settings: Settings;
  today: ISODate;
  /** You: your flag, stars and private label (M7). */
  me: Person;
}) {
  const { unit: u, building: b } = row;
  const title = unitTitle(u, b);
  const rent = rentLabel(u);
  const links: ExternalLink[] = [
    ...row.listings
      .filter((l) => isWebUrl(l.url))
      .map((l) => ({ key: l.id, label: `${SITE_LABELS[l.site]} listing`, url: l.url as string })),
    ...fromLinkRecords(u.links),
    ...(b && isWebUrl(b.website)
      ? [{ key: 'website', label: 'Building website', url: b.website }]
      : []),
    ...(b ? mapLinks(b) : []),
  ];

  return (
    <article className={styles.panel} aria-labelledby="detail-title">
      <header className={styles.plate}>
        <div className={styles.plateMain}>
          <h2 id="detail-title" className={styles.plateTitle}>
            {title}
          </h2>
          <p className={styles.where}>
            {b && buildingName(b) !== title && buildingName(b) !== b.address.line1 && (
              <b>{buildingName(b)}, </b>
            )}
            {b ? b.address.line1 : 'Building missing'}
            {b?.neighborhood && (
              <>
                <br />
                {b.neighborhood.name}
              </>
            )}
          </p>
        </div>
        <div className={styles.big}>
          {rent ? (
            <>
              <div className={styles.bigNum}>
                {rent}
                <small> /mo</small>
              </div>
              <div className={styles.bigSub}>rent</div>
            </>
          ) : (
            <div className={styles.bigSub}>Rent unknown</div>
          )}
        </div>
        {u.isFloorPlanOnly && <p className={styles.plateNote}>Floor plan: no specific unit yet.</p>}
        {b && b.location === null && (
          <p className={styles.plateNote}>
            Needs location: not on the map yet. <PlaceOnMapButton building={b} />
          </p>
        )}
      </header>

      <MarkerControls rows={[row]} me={me} settings={settings} />
      {b && (
        <EssentialsSection unit={u} building={b} settings={settings} standalone={row.standalone} />
      )}
      <RatingsSection unitId={u.id} rows={row.opinions} settings={settings} />
      <LeaseSection u={u} today={today} />
      <UnitFacts u={u} floors={b?.floors ?? null} />
      <WindowsSection u={u} />
      <UtilitiesSection u={u} />
      <ParkingSection u={u} />
      <BuildingSection row={row} />
      <ListingsSection row={row} today={today} />
      <Section title="Travel times">
        <p className={styles.travelEmpty}>
          Add places you travel to, like work or campus, to see walk, bike, drive and transit times
          here. Arrives with destinations in Phase 2.
        </p>
      </Section>
      <Section title="Notes" id="unit-notes">
        <NotesLog notes={row.notes} today={today} meId={me.id} owner={{ unitId: u.id }} />
      </Section>
      <Section title="Links">
        <Links links={links} />
      </Section>
      <Section title="History" id="unit-history">
        <p className={styles.muted}>
          Every change to this unit, with Undo for any of them.{' '}
          <Link to={`/history?unit=${u.id}`}>Open history</Link>
        </p>
      </Section>
      <DeleteSection
        kind="unit"
        id={u.id}
        name={b && buildingName(b) !== title ? `${title} at ${buildingName(b)}` : title}
      />
      <footer className={styles.actions}>
        <Link
          to={`/unit/${u.id}/edit`}
          state={{ inApp: true }}
          className={styles.actionPrimary}
          aria-keyshortcuts="e"
        >
          Edit <kbd aria-hidden="true">E</kbd>
        </Link>
        {b && !row.standalone && (
          <Link
            to={`/new-unit?from=${u.id}`}
            state={{ inApp: true }}
            className={styles.action}
            title="A new unit in this building with the same specs, features, fees and utilities"
          >
            {u.floorPlanName ? `New unit from ${u.floorPlanName}` : 'New unit like this'}
          </Link>
        )}
      </footer>
    </article>
  );
}
