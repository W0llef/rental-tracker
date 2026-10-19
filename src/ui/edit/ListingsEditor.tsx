import { useState } from 'react';
import { money, shortDate, SITE_LABELS } from '../../domain/format';
import { numText, parseMoney } from '../../domain/input';
import { parseListingUrl } from '../../domain/listingUrl';
import { priceHistory } from '../../domain/listings';
import { SITE_KEYS } from '../../model';
import type { ID, ISODate, Listing, PriceObservation, SiteKey } from '../../model';
import { newListing } from '../../model/factories';
import { PriceChart } from '../detail/PriceChart';
import { useFormApi } from './formState';
import styles from './edit.module.css';

/**
 * Listings and their price history (PLAN.md §3.4, M8): where the unit was advertised and
 * every price seen there. Add, correct or remove prices and listings; the unit's rent
 * follows the newest price when you save (domain/unitForm.ts).
 */

interface Props {
  unitId: ID;
  listings: Listing[];
  onChange: (next: Listing[]) => void;
  today: ISODate;
}

const PATH = 'listings';

export function ListingsEditor({ unitId, listings, onChange, today }: Props) {
  const form = useFormApi();
  const set = (id: ID, patch: Partial<Listing>) =>
    onChange(listings.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const history = priceHistory(listings);
  const add = () => {
    const l = newListing({ unitId, firstSeen: today, site: 'other' });
    onChange([...listings, l]);
    requestAnimationFrame(() =>
      document.querySelector<HTMLInputElement>(`[data-listing="${l.id}"] input`)?.focus(),
    );
  };
  return (
    <div className={styles.listings} data-field={PATH}>
      {listings.length === 0 && <p className={styles.lead}>No listings yet.</p>}
      {listings.map((l, i) => (
        <ListingCard
          key={l.id}
          n={i + 1}
          listing={l}
          today={today}
          onChange={(patch) => set(l.id, patch)}
          onRemove={() => {
            for (const k of form.errors.keys())
              if (k.startsWith(`${PATH}.${l.id}`)) form.setError(k, null);
            onChange(listings.filter((x) => x.id !== l.id));
          }}
        />
      ))}
      <button type="button" className={styles.addBtn} onClick={add}>
        + Add listing
      </button>
      {history.length > 0 && (
        <div className={styles.chart}>
          <PriceChart points={history} today={today} />
        </div>
      )}
    </div>
  );
}

function ListingCard({
  n,
  listing: l,
  today,
  onChange,
  onRemove,
}: {
  n: number;
  listing: Listing;
  today: ISODate;
  onChange: (patch: Partial<Listing>) => void;
  onRemove: () => void;
}) {
  const form = useFormApi();
  const [urlText, setUrlText] = useState(l.url ?? '');
  const base = `${PATH}.${l.id}`;
  const name = `Listing ${n}`;
  const obs = l.observations;
  const setObs = (next: PriceObservation[]) => onChange({ observations: next });
  const errors = [...form.errors].filter(([k]) => k.startsWith(base)).map(([, v]) => v);
  return (
    <fieldset className={styles.listing} data-listing={l.id}>
      <legend className={styles.listingTitle}>
        {name}: {SITE_LABELS[l.site]}
        {l.offMarketAt && <span className={styles.tag}>off market</span>}
      </legend>
      <div className={styles.listingGrid}>
        <label className={styles.stack}>
          <span className={styles.small}>Link</span>
          <input
            className={styles.input}
            value={urlText}
            placeholder="https://… (optional)"
            onChange={(e) => {
              const t = e.target.value;
              setUrlText(t);
              if (!t.trim()) {
                form.setError(`${base}.url`, null);
                onChange({ url: null });
                return;
              }
              const parsed = parseListingUrl(t);
              if (!parsed) {
                form.setError(
                  `${base}.url`,
                  `${name}: enter a web address, or leave the link empty.`,
                );
                return;
              }
              form.setError(`${base}.url`, null);
              // A link from a known site names the site, unless you chose one yourself.
              onChange({
                url: parsed.url,
                ...(l.site === 'other' || l.url ? { site: parsed.site } : {}),
              });
            }}
          />
        </label>
        <label className={styles.stack}>
          <span className={styles.small}>Site</span>
          <select
            className={styles.select}
            value={l.site}
            onChange={(e) => onChange({ site: e.target.value as SiteKey })}
          >
            {SITE_KEYS.map((k) => (
              <option key={k} value={k}>
                {SITE_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.stack}>
          <span className={styles.small}>First seen</span>
          <input
            type="date"
            className={styles.input}
            value={l.firstSeen}
            max={today}
            onChange={(e) => {
              if (!e.target.value)
                form.setError(`${base}.first`, `${name}: enter when you first saw it.`);
              else {
                form.setError(`${base}.first`, null);
                onChange({ firstSeen: e.target.value });
              }
            }}
          />
        </label>
        <label className={styles.stack}>
          <span className={styles.small}>Last seen</span>
          <input
            type="date"
            className={styles.input}
            value={l.lastSeen}
            onChange={(e) => {
              if (!e.target.value)
                form.setError(`${base}.last`, `${name}: enter when you last saw it.`);
              else {
                form.setError(`${base}.last`, null);
                onChange({ lastSeen: e.target.value });
              }
            }}
          />
        </label>
        <div className={styles.stack}>
          <label className={styles.check}>
            <input
              type="checkbox"
              checked={l.offMarketAt !== null}
              onChange={(e) => onChange({ offMarketAt: e.target.checked ? today : null })}
            />
            Off market
          </label>
          {l.offMarketAt !== null && (
            <input
              type="date"
              className={styles.input}
              aria-label={`${name}: off market since`}
              value={l.offMarketAt}
              onChange={(e) => onChange({ offMarketAt: e.target.value || today })}
            />
          )}
        </div>
      </div>

      <table className={styles.table} aria-label={`${name} prices`}>
        <thead>
          <tr>
            <th scope="col">Date seen</th>
            <th scope="col">Rent</th>
            <th scope="col">Note</th>
            <th scope="col">
              <span className={styles.visuallyHidden}>Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {obs.map((o, j) => (
            <PriceRow
              // A price's date is its identity within one listing.
              key={`${j}-${obs.length}`}
              label={`${name}, price ${j + 1}`}
              errorKey={`${base}.obs.${j}`}
              observation={o}
              today={today}
              onChange={(next) => setObs(obs.map((x, k) => (k === j ? next : x)))}
              onRemove={() => {
                for (const k of form.errors.keys())
                  if (k.startsWith(`${base}.obs.`)) form.setError(k, null);
                setObs(obs.filter((_, k) => k !== j));
              }}
            />
          ))}
        </tbody>
      </table>
      {obs.length === 0 && <p className={styles.small}>No prices seen on this listing yet.</p>}
      <div className={styles.listActions}>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => {
            const last = obs.at(-1);
            setObs([...obs, { date: today, rent: last?.rent ?? 0, note: null }]);
          }}
        >
          + Add price
        </button>
        <button type="button" className={styles.dangerText} onClick={onRemove}>
          Delete this listing
        </button>
      </div>
      {errors.length > 0 && (
        <div className={styles.below}>
          {errors.map((m) => (
            <p key={m} className={styles.error} role="alert">
              {m}
            </p>
          ))}
        </div>
      )}
    </fieldset>
  );
}

function PriceRow({
  label,
  errorKey,
  observation: o,
  today,
  onChange,
  onRemove,
}: {
  label: string;
  errorKey: string;
  observation: PriceObservation;
  today: ISODate;
  onChange: (o: PriceObservation) => void;
  onRemove: () => void;
}) {
  const form = useFormApi();
  const [text, setText] = useState(numText(o.rent));
  return (
    <tr>
      <td>
        <input
          type="date"
          className={styles.input}
          aria-label={`${label}: date`}
          value={o.date}
          max={today}
          onChange={(e) => {
            if (!e.target.value) form.setError(`${errorKey}.date`, `${label}: enter the date.`);
            else {
              form.setError(`${errorKey}.date`, null);
              onChange({ ...o, date: e.target.value });
            }
          }}
        />
      </td>
      <td>
        <span className={styles.numWrap}>
          <span className={styles.affix} aria-hidden="true">
            $
          </span>
          <input
            className={styles.input}
            inputMode="decimal"
            aria-label={`${label}: rent`}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              const r = parseMoney(e.target.value);
              if (!r.ok || r.value === null)
                form.setError(`${errorKey}.rent`, `${label}: enter the rent in dollars.`);
              else {
                form.setError(`${errorKey}.rent`, null);
                onChange({ ...o, rent: r.value });
              }
            }}
          />
        </span>
      </td>
      <td>
        <input
          className={styles.input}
          aria-label={`${label}: note`}
          value={o.note ?? ''}
          placeholder={o.note === null ? '' : undefined}
          onChange={(e) => onChange({ ...o, note: e.target.value.trim() ? e.target.value : null })}
        />
      </td>
      <td>
        <button
          type="button"
          className={styles.removeBtn}
          aria-label={`Remove ${label.toLowerCase()} (${money(o.rent)}, ${shortDate(o.date, today)})`}
          onClick={onRemove}
        >
          ✕
        </button>
      </td>
    </tr>
  );
}
