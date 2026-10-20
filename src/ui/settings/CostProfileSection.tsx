import { useLiveQuery } from 'dexie-react-hooks';
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { updateCostProfile } from '../../commands/cost';
import { getSettings } from '../../commands/records';
import { db } from '../../db/db';
import { profileEstimate } from '../../domain/cost';
import { COST_ITEM_LABELS, money, monthsLabel, num } from '../../domain/format';
import { parseMoney, parseWhole } from '../../domain/input';
import type { Parsed } from '../../domain/input';
import { COST_ITEM_KEYS, UTILITY_KEYS } from '../../model';
import type { CostItemKey, CostProfile, CostProfileItem } from '../../model';
import styles from './settings.module.css';

/**
 * Settings → Cost profile (DESIGN.md §4.5, PLAN.md §5.3, Q5): what you expect to pay when a
 * unit doesn't include something, what your household needs, and the lease length to spread
 * one-time costs over. Every change is one undo step and updates every total at once.
 */

const SCALABLE = new Set<CostItemKey>(UTILITY_KEYS);

/**
 * A number box that saves when you leave it or press Enter (not on every key), so each
 * change is one step in History. Shows what's wrong instead of saving bad input.
 */
function NumberBox({
  label,
  value,
  parse,
  onSave,
  prefix,
  suffix,
  width = '5em',
  hideLabel = false,
}: {
  label: string;
  value: number;
  parse: (text: string) => Parsed<number>;
  onSave: (n: number) => Promise<unknown>;
  prefix?: string;
  suffix?: string;
  width?: string;
  hideLabel?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = text ?? String(value);
  const commit = async () => {
    if (text === null) return;
    const parsed = parse(text);
    if (!parsed.ok || parsed.value === null) {
      setError(parsed.ok ? 'Enter a number.' : parsed.error);
      return;
    }
    setError(null);
    setText(null);
    if (parsed.value !== value) await onSave(parsed.value);
  };
  return (
    <span className={styles.numberBox}>
      <label htmlFor={id} className={hideLabel ? styles.visuallyHidden : styles.numberLabel}>
        {label}
      </label>
      <span className={styles.numberInput}>
        {prefix && <span aria-hidden="true">{prefix}</span>}
        <input
          id={id}
          className={styles.input}
          style={{ width }}
          inputMode="numeric"
          value={shown}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commit();
            if (e.key === 'Escape' && text !== null) {
              setText(null);
              setError(null);
            }
          }}
        />
        {suffix && <span className={styles.numberSuffix}>{suffix}</span>}
      </span>
      {error && (
        <span id={`${id}-error`} className={styles.error} role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

const SCALE_OPTIONS: { id: CostProfileItem['scaleBy']; label: string }[] = [
  { id: 'none', label: 'Not scaled' },
  { id: 'sqft', label: 'Scaled by size' },
  { id: 'bedrooms', label: 'Scaled by bedrooms' },
];

/** "→ $73 for 1,000 ft²": what the estimate comes to for an example unit. */
function exampleText(profile: CostProfile, key: CostItemKey): string | null {
  const item = profile.items[key];
  if (!item || item.scaleBy === 'none') return null;
  if (item.scaleBy === 'sqft') {
    const size = item.basis === 1000 ? 750 : 1000;
    const est = profileEstimate(profile, key, { squareFeet: size, bedrooms: null });
    return `${num(size)} ft² unit: ${money(est)}`;
  }
  const beds = item.basis === 2 ? 1 : 2;
  const est = profileEstimate(profile, key, { squareFeet: null, bedrooms: beds });
  return `${beds} bd unit: ${money(est)}`;
}

function ItemRow({ profile, itemKey }: { profile: CostProfile; itemKey: CostItemKey }) {
  const item = profile.items[itemKey];
  if (!item) return null;
  const label = COST_ITEM_LABELS[itemKey];
  const name = label.replace(/, per .*$/, '');
  const save = (change: Partial<CostProfileItem>, text: string) =>
    updateCostProfile(
      db,
      (p) => ({ ...p, items: { ...p.items, [itemKey]: { ...item, ...change } } }),
      text,
    );
  const scalable = SCALABLE.has(itemKey);
  const example = exampleText(profile, itemKey);
  return (
    <tr>
      <th scope="row">{label}</th>
      <td>
        <NumberBox
          label={`${name} per month`}
          hideLabel
          value={item.monthly}
          prefix="$"
          suffix="/mo"
          parse={(t) => parseMoney(t, 10_000)}
          onSave={(n) => save({ monthly: n }, `${name} estimate ${money(n)}`)}
        />
      </td>
      <td>
        {scalable ? (
          <div className={styles.scale}>
            <select
              className={styles.select}
              aria-label={`How the ${name.toLowerCase()} estimate scales`}
              value={item.scaleBy}
              onChange={(e) => {
                const scaleBy = e.target.value as CostProfileItem['scaleBy'];
                const basis = scaleBy === 'sqft' ? 750 : 1;
                void save(
                  { scaleBy, basis },
                  `${name} estimate ${scaleBy === 'none' ? 'not scaled' : `scaled by ${scaleBy === 'sqft' ? 'size' : 'bedrooms'}`}`,
                );
              }}
            >
              {SCALE_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            {item.scaleBy !== 'none' && (
              <NumberBox
                key={item.scaleBy}
                label="at"
                value={item.basis}
                suffix={item.scaleBy === 'sqft' ? 'ft²' : item.basis === 1 ? 'bedroom' : 'bedrooms'}
                width={item.scaleBy === 'sqft' ? '5em' : '3.5em'}
                parse={(t) =>
                  parseWhole(t, {
                    min: 1,
                    max: item.scaleBy === 'sqft' ? 10_000 : 10,
                    what: item.scaleBy === 'sqft' ? 'a size in ft²' : 'a number of bedrooms',
                  })
                }
                onSave={(n) =>
                  save(
                    { basis: n },
                    `${name} estimate at ${item.scaleBy === 'sqft' ? `${num(n)} ft²` : `${n} bd`}`,
                  )
                }
              />
            )}
            {example && <span className={styles.example}>{example}</span>}
          </div>
        ) : (
          <span className={styles.example}>
            {itemKey === 'parking'
              ? 'for each space you need beyond those included'
              : itemKey === 'pet-rent'
                ? 'when the building’s pet rent is unknown'
                : itemKey === 'storage'
                  ? 'when you need storage and it isn’t included'
                  : 'added to every unit'}
          </span>
        )}
      </td>
    </tr>
  );
}

export function CostProfileSection() {
  const settings = useLiveQuery(() => getSettings(db), []);
  if (!settings) return null;
  const p = settings.costProfile;
  const set = (change: Partial<CostProfile>, label: string) =>
    updateCostProfile(db, (x) => ({ ...x, ...change }), label);
  const whole = (max: number, what: string) => (t: string) => parseWhole(t, { min: 0, max, what });

  return (
    <>
      <p className={styles.lead}>
        What you expect to pay when a unit doesn’t include something. Every unit’s total monthly
        cost uses these, and changes show everywhere at once. A unit’s own numbers (an amount billed
        extra, a listed estimate) always win.
      </p>

      <section className={styles.card} aria-labelledby="cost-estimates">
        <h3 id="cost-estimates" className={styles.cardTitle}>
          Monthly estimates
        </h3>
        <p className={styles.text}>
          Used for utilities you pay, and assumed (marked in amber) where a unit doesn’t say. Size
          scaling: “$55 at 750 ft²” comes to $53 for a 720 ft² unit.
        </p>
        <table className={`${styles.table} ${styles.costTable}`}>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Estimate</th>
              <th scope="col">
                <span className={styles.visuallyHidden}>How it scales</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {COST_ITEM_KEYS.map((k) => (
              <ItemRow key={k} profile={p} itemKey={k} />
            ))}
          </tbody>
        </table>
      </section>

      <section className={styles.card} aria-labelledby="cost-household">
        <h3 id="cost-household" className={styles.cardTitle}>
          What you need
        </h3>
        <div className={styles.costFields}>
          <NumberBox
            label="Parking spaces you need"
            value={p.parkingSpacesNeeded}
            width="3.5em"
            parse={whole(5, 'a number of spaces')}
            onSave={(n) => set({ parkingSpacesNeeded: n }, `Parking spaces you need: ${n}`)}
          />
          <label className={styles.essentialsCheck}>
            <input
              type="checkbox"
              checked={p.needsStorage}
              onChange={(e) =>
                void set(
                  { needsStorage: e.target.checked },
                  e.target.checked ? 'You need storage' : 'You don’t need storage',
                )
              }
            />
            You need a storage unit
          </label>
          <fieldset className={styles.pets}>
            <legend className={styles.numberLabel}>Pets</legend>
            <NumberBox
              label="Cats"
              value={p.hasPets.cats}
              width="3em"
              parse={whole(9, 'a number of cats')}
              onSave={(n) => set({ hasPets: { ...p.hasPets, cats: n } }, `Cats: ${n}`)}
            />
            <NumberBox
              label="Dogs"
              value={p.hasPets.dogs}
              width="3em"
              parse={whole(9, 'a number of dogs')}
              onSave={(n) => set({ hasPets: { ...p.hasPets, dogs: n } }, `Dogs: ${n}`)}
            />
          </fieldset>
          <p className={styles.note}>
            With pets, totals add each building’s pet rent per pet (or your estimate when it’s
            unknown), and move-in costs add its pet deposit and fee.
          </p>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="cost-lease">
        <h3 id="cost-lease" className={styles.cardTitle}>
          Lease length and one-time costs
        </h3>
        <div className={styles.costFields}>
          <NumberBox
            label="Lease length you expect to sign"
            value={p.defaultLeaseMonths}
            width="3.5em"
            suffix="months"
            parse={(t) => parseWhole(t, { min: 1, max: 60, what: 'a number of months' })}
            onSave={(n) =>
              set({ defaultLeaseMonths: n }, `Default lease length: ${monthsLabel(n)}`)
            }
          />
          <p className={styles.note}>
            Each unit can have its own (Lease you’d sign, in its form or Monthly cost). When a
            listing prices lease lengths differently, the total uses the rent for yours, or for the
            nearest length the unit lists.
          </p>
          <label className={styles.essentialsCheck}>
            <input
              type="checkbox"
              checked={p.compareAtDefaultLease === true}
              onChange={(e) =>
                void set(
                  { compareAtDefaultLease: e.target.checked },
                  e.target.checked
                    ? `Compare every unit at ${monthsLabel(p.defaultLeaseMonths)}`
                    : 'Use the lease picked for each unit',
                )
              }
            />
            Compare every unit at this lease length
          </label>
          <p className={styles.note}>
            Ignores the lease picked for a single unit on cards, the map and sorting, so every unit
            is priced alike. That unit’s Monthly cost still shows its own pick on a line of its own.
            Lease length marks: <Link to="/settings/lease-marks">Settings</Link>.
          </p>
          <label className={styles.essentialsCheck}>
            <input
              type="checkbox"
              checked={p.amortizeOneTimeFees}
              onChange={(e) =>
                void set(
                  { amortizeOneTimeFees: e.target.checked },
                  e.target.checked ? 'Spread one-time fees' : 'Don’t spread one-time fees',
                )
              }
            />
            Spread one-time fees over the lease (application, admin and pet fees)
          </label>
          <label className={styles.essentialsCheck}>
            <input
              type="checkbox"
              checked={p.amortizeSpecials}
              onChange={(e) =>
                void set(
                  { amortizeSpecials: e.target.checked },
                  e.target.checked ? 'Spread move-in specials' : 'Don’t spread move-in specials',
                )
              }
            />
            Spread move-in specials over the lease (take them off the total)
          </label>
          <p className={styles.note}>
            Off, they stay out of the monthly total: one-time fees show in the move-in cost and
            specials as an effective rent.
          </p>
        </div>
      </section>
    </>
  );
}
