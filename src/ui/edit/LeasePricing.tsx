import { useId, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { leaseMonthsFor, nearestTerm } from '../../domain/cost';
import { aLease, money, monthsLabel } from '../../domain/format';
import { parseWhole } from '../../domain/input';
import {
  chargeLabel,
  listedMonths,
  pickListed,
  priceRows,
  sameCharge,
  setTermRent,
  setTermValue,
  termRent,
  termValue,
  varyCharge,
  varyingCharges,
} from '../../domain/leasePrices';
import type { CostProfile, TermChargeKey, Unit } from '../../model';
import { FieldRow } from './fields';
import { MoneyCell } from './editors';
import styles from './edit.module.css';

/**
 * The Lease section's prices by lease length (Q37, layout C, as the owner approved it from
 * the mockup): a row per lease length the unit lists, rent always per row, and a column only
 * for each charge that varies. "Price history" marks the rent the listing advertises; the
 * row the totals use is tagged from your lease length. Pure steps live in domain/leasePrices.
 */

type SetDraft = Dispatch<SetStateAction<Unit>>;

/** "Varies by length" / "Same for all" beside a charge's field. */
export function VaryButton({
  draft,
  setDraft,
  charge,
}: {
  draft: Unit;
  setDraft: SetDraft;
  charge: TermChargeKey;
}) {
  const varies = varyingCharges(draft).includes(charge);
  const name = chargeLabel(draft, charge).replace(' /mo', '');
  return (
    <button
      type="button"
      className={styles.textButton}
      aria-label={
        varies
          ? `${name}: make it the same for all lease lengths`
          : `${name} varies by lease length`
      }
      onClick={() => setDraft((d) => (varies ? sameCharge(d, charge) : varyCharge(d, charge)))}
    >
      {varies ? 'Same for all' : 'Varies by length'}
    </button>
  );
}

/** "Rent or fees differ by lease length". */
export function DifferField({
  differ,
  onChange,
  rows,
}: {
  differ: boolean;
  onChange: (on: boolean) => void;
  rows: number;
}) {
  const id = useId();
  return (
    <FieldRow
      path="unit.pricesByLength"
      label=""
      empty={false}
      noUnknown
      hint={
        differ
          ? 'Rent has a box per lease length; other charges stay the same for all until you say one varies. Turning this off keeps the price-history length’s prices.'
          : rows > 1
            ? 'Prices each lease length in its own row.'
            : 'Prices each lease length in its own row. Add the lease lengths it offers above.'
      }
    >
      <label htmlFor={id} className={styles.differLabel}>
        <input
          id={id}
          type="checkbox"
          checked={differ}
          onChange={(e) => onChange(e.target.checked)}
        />
        Rent or fees differ by lease length
      </label>
    </FieldRow>
  );
}

/** Monthly fees (named in Costs), each with "Varies by length". */
export function MonthlyFeesVary({ draft, setDraft }: { draft: Unit; setDraft: SetDraft }) {
  const fees = draft.recurringFees ?? [];
  if (!fees.length) return null;
  const varying = new Set(varyingCharges(draft));
  return (
    <FieldRow
      path="unit.recurringFeesByLength"
      label="Monthly fees"
      empty={false}
      noUnknown
      hint="Named and priced in Costs."
    >
      <ul className={styles.feeVary}>
        {fees.map((f) => {
          const charge = `fee:${f.id}` as TermChargeKey;
          return (
            <li key={f.id}>
              <span>
                {f.label || 'Monthly fee'}{' '}
                <span className={styles.per}>
                  {varying.has(charge) ? 'varies by lease length' : `${money(f.amount)}/mo`}
                </span>
              </span>
              <VaryButton draft={draft} setDraft={setDraft} charge={charge} />
            </li>
          );
        })}
      </ul>
    </FieldRow>
  );
}

/** The table: a row per lease length, rent and each varying charge, price history, remove. */
export function LeasePricesTable({
  draft,
  setDraft,
  profile,
}: {
  draft: Unit;
  setDraft: SetDraft;
  profile: CostProfile;
}) {
  const labelId = useId();
  const rows = priceRows(draft);
  const varying = varyingCharges(draft);
  const listed = listedMonths(draft);
  const wanted = leaseMonthsFor(draft, profile);
  const used = rows.length ? (rows.includes(wanted) ? wanted : nearestTerm(rows, wanted)) : null;
  const grid = {
    gridTemplateColumns: `minmax(96px, 120px) minmax(0, 130px)${' minmax(0, 130px)'.repeat(varying.length)} 72px 32px`,
  };
  const why =
    profile.compareAtDefaultLease || draft.plannedLeaseMonths === null
      ? `your lease length (${monthsLabel(profile.defaultLeaseMonths)}, Cost profile)`
      : `the lease you’d sign here (${monthsLabel(wanted)})`;
  return (
    <FieldRow
      path="unit.rentByTerm"
      label="Prices by lease length"
      empty={false}
      labelId={labelId}
      noUnknown
      wide
    >
      <div className={styles.priceTableWrap}>
        {rows.length < 2 && (
          <p className={styles.priceNote}>
            Add the lease lengths it offers in Lease terms above: each one becomes a row here.
          </p>
        )}
        {rows.length > 0 && (
          <div className={styles.priceTable} role="table" aria-labelledby={labelId}>
            <div className={`${styles.priceRow} ${styles.priceHead}`} role="row" style={grid}>
              <span role="columnheader">Lease length</span>
              <span role="columnheader" className={styles.num}>
                Rent
              </span>
              {varying.map((c) => (
                <span key={c} role="columnheader" className={styles.priceHeadCharge}>
                  {chargeLabel(draft, c)}
                  <VaryButton draft={draft} setDraft={setDraft} charge={c} />
                </span>
              ))}
              <span role="columnheader" className={styles.center}>
                Price history
              </span>
              <span role="columnheader">
                <span className={styles.visuallyHidden}>Remove</span>
              </span>
            </div>
            {rows.map((m) => (
              <div
                key={m}
                role="row"
                className={styles.priceRow}
                data-used={m === used || undefined}
                data-term={m}
                style={grid}
              >
                <span role="rowheader" className={styles.priceLength}>
                  <b>{monthsLabel(m)}</b>
                  {m === used && (
                    <span className={styles.priceUsed}>
                      {m === wanted ? 'Your lease' : 'Nearest to yours'}
                    </span>
                  )}
                </span>
                <span role="cell" data-label="Rent">
                  <MoneyCell
                    path={`unit.rentByTerm.${m}`}
                    label={`Rent on ${aLease(m)}`}
                    value={termRent(draft, m)}
                    onChange={(v) => setDraft((d) => setTermRent(d, m, v))}
                  />
                </span>
                {varying.map((c) => (
                  <span key={c} role="cell" data-label={chargeLabel(draft, c)}>
                    <MoneyCell
                      path={`unit.termCharges.${c}.${m}`}
                      label={`${chargeLabel(draft, c).replace(' /mo', '')} on ${aLease(m)}`}
                      value={termValue(draft, c, m)}
                      onChange={(v) => setDraft((d) => setTermValue(d, c, m, v))}
                    />
                  </span>
                ))}
                <span role="cell" className={styles.center} data-label="Price history">
                  <input
                    type="radio"
                    name={`price-history-${draft.id}`}
                    aria-label={`Price history follows the ${m}-month rent`}
                    checked={listed === m}
                    onChange={() => setDraft((d) => pickListed(d, m))}
                  />
                </span>
                <span role="cell" className={styles.priceRemove}>
                  <button
                    type="button"
                    className={styles.removeBtn}
                    aria-label={`Remove the ${m}-month lease`}
                    onClick={() =>
                      setDraft((d) => {
                        const left = priceRows(d).filter((x) => x !== m);
                        return { ...d, leaseTermsMonths: left.length ? left : null };
                      })
                    }
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
        {used !== null && (
          <p className={styles.priceNote}>
            <b>{used === wanted ? 'Your lease:' : 'Nearest to yours:'}</b> totals, cards and the map
            use the {used}-month row,{' '}
            {used === wanted ? `${why}.` : `the closest this unit lists to ${why}.`}
          </p>
        )}
        <p className={styles.priceNote}>
          <b>Price history:</b> the rent the listing advertises. Each price you record goes in its
          price history; it doesn’t change which rent your totals use.
        </p>
      </div>
    </FieldRow>
  );
}

/** "Lease you'd sign": your default, one of the unit's lengths, or another. */
export function PlannedLeaseField({
  draft,
  setDraft,
  profile,
}: {
  draft: Unit;
  setDraft: SetDraft;
  profile: CostProfile;
}) {
  const id = useId();
  const rows = priceRows(draft);
  const value = draft.plannedLeaseMonths;
  const options = [...new Set([...rows, ...(value !== null ? [value] : [])])].sort((a, b) => a - b);
  const [other, setOther] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const set = (v: number | null) => setDraft((d) => ({ ...d, plannedLeaseMonths: v }));
  const notListed = value !== null && rows.length > 0 && !rows.includes(value);
  return (
    <FieldRow
      path="unit.plannedLeaseMonths"
      label="Lease you’d sign"
      empty={false}
      controlId={id}
      noUnknown
      hint={
        profile.compareAtDefaultLease
          ? `Not used for comparing: you compare every unit at ${monthsLabel(profile.defaultLeaseMonths)} (Cost profile). The unit’s Monthly cost shows what this one would cost.`
          : notListed
            ? `This unit doesn’t list ${aLease(value)}, so its costs use the nearest one it lists.`
            : 'Only for this unit. Its totals use this lease length’s row.'
      }
    >
      <span className={styles.listRow}>
        <select
          id={id}
          className={styles.select}
          value={other ? 'other' : value === null ? 'default' : String(value)}
          onChange={(e) => {
            const v = e.target.value;
            setError(null);
            if (v === 'other') return setOther(true);
            setOther(false);
            set(v === 'default' ? null : Number(v));
          }}
        >
          <option value="default">Your default ({monthsLabel(profile.defaultLeaseMonths)})</option>
          {options.map((m) => (
            <option key={m} value={String(m)}>
              {monthsLabel(m)}
            </option>
          ))}
          <option value="other">Other…</option>
        </select>
        {other && (
          <span className={styles.numWrap}>
            <input
              className={styles.input}
              inputMode="numeric"
              aria-label="Lease you’d sign, in months"
              aria-invalid={error ? true : undefined}
              value={text}
              autoFocus
              onChange={(e) => {
                const t = e.target.value;
                setText(t);
                const read = parseWhole(t, { min: 1, max: 60, what: 'months from 1 to 60' });
                if (!read.ok) setError(read.error);
                else {
                  setError(null);
                  if (read.value !== null) set(read.value);
                }
              }}
              onBlur={() => {
                if (!error && text.trim()) setOther(false);
              }}
            />
            <span className={styles.affix} aria-hidden="true">
              months
            </span>
          </span>
        )}
        {error && (
          <span className={styles.error} role="alert">
            {error}
          </span>
        )}
      </span>
    </FieldRow>
  );
}
