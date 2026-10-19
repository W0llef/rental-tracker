import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { setCostOverride, setLeaseLength } from '../../commands/cost';
import { db } from '../../db/db';
import { perSqftLabel, profileEstimate } from '../../domain/cost';
import type { CostLine, UnitCost } from '../../domain/cost';
import { money, monthsLabel } from '../../domain/format';
import { parseMoney, parseWhole } from '../../domain/input';
import type { CostProfile, Unit } from '../../model';
import { Section } from './parts';
import styles from './detail.module.css';

/**
 * Monthly cost (DESIGN.md §4.2, PLAN.md §5.3): each line with where it came from, assumed
 * ones in amber, the total, move-in cost and cost per ft². The lease length selector shows
 * when it changes something (spreading is on, or the listing prices terms differently), and
 * lines that use a cost-profile estimate can be set for this unit (`costOverrides`).
 */

const amountText = (n: number) => (n < 0 ? `−${money(-n)}` : money(n));

function OverrideEditor({
  unit,
  line,
  profile,
  onDone,
}: {
  unit: Unit;
  line: CostLine;
  profile: CostProfile;
  onDone: () => void;
}) {
  const key = line.overrideKey!;
  const id = useId();
  const own = unit.costOverrides[key];
  const fromProfile = profileEstimate(profile, key, unit);
  const [text, setText] = useState(own === undefined ? '' : String(own));
  const [error, setError] = useState<string | null>(null);
  const per = key === 'parking' ? ' a space' : key === 'pet-rent' ? ' a pet' : '';
  const save = async () => {
    const parsed = parseMoney(text, 10_000);
    if (!parsed.ok) return setError(parsed.error);
    await setCostOverride(db, unit.id, key, parsed.value);
    onDone();
  };
  return (
    <div className={styles.override}>
      <label htmlFor={id} className={styles.overrideLabel}>
        Your estimate for this unit{per}
      </label>
      <span className={styles.overrideInput}>
        <span aria-hidden="true">$</span>
        <input
          id={id}
          className={styles.input}
          inputMode="numeric"
          value={text}
          placeholder={String(fromProfile)}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          autoFocus
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save();
            if (e.key === 'Escape') {
              e.stopPropagation();
              onDone();
            }
          }}
        />
        <span className={styles.muted}>/mo</span>
      </span>
      <button type="button" className={styles.plainButton} onClick={() => void save()}>
        Save
      </button>
      <button type="button" className={styles.linkButton} onClick={onDone}>
        Cancel
      </button>
      <p id={`${id}-hint`} className={styles.overrideHint}>
        Blank uses your cost profile: {money(fromProfile)}
        {per && ` ${per.trim()}`}.
      </p>
      {error && (
        <p id={`${id}-error`} className={styles.overrideError} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function LeaseLength({
  unit,
  cost,
  profile,
}: {
  unit: Unit;
  cost: UnitCost;
  profile: CostProfile;
}) {
  const id = useId();
  const [other, setOther] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const terms = new Map((unit.rentByTerm ?? []).map((t) => [t.months, t.rent]));
  const offered = new Set(unit.leaseTermsMonths ?? []);
  const value = unit.plannedLeaseMonths === null ? 'default' : String(unit.plannedLeaseMonths);
  const optionText = (m: number) => {
    const rent = terms.get(m);
    const parts = [monthsLabel(m)];
    if (rent !== undefined) parts.push(`${money(rent)} rent`);
    else if (offered.size && !offered.has(m)) parts.push('not listed');
    return parts.join(' · ');
  };
  const saveOther = async () => {
    const parsed = parseWhole(text, { min: 1, max: 60, what: 'a number of months' });
    if (!parsed.ok || parsed.value === null)
      return setError(parsed.ok ? 'Enter a number of months.' : parsed.error);
    await setLeaseLength(db, unit.id, parsed.value);
    setOther(false);
    setText('');
  };
  return (
    <div className={styles.lease}>
      <label htmlFor={id} className={styles.leaseLabel}>
        Lease length
      </label>
      <select
        id={id}
        className={styles.select}
        value={other ? 'other' : value}
        onChange={(e) => {
          const v = e.target.value;
          setError(null);
          if (v === 'other') return setOther(true);
          setOther(false);
          void setLeaseLength(db, unit.id, v === 'default' ? null : Number(v));
        }}
      >
        <option value="default">Your default · {optionText(profile.defaultLeaseMonths)}</option>
        {cost.leaseOptions.map((m) => (
          <option key={m} value={String(m)}>
            {optionText(m)}
          </option>
        ))}
        <option value="other">Other…</option>
      </select>
      {other && (
        <span className={styles.overrideInput}>
          <label htmlFor={`${id}-other`} className={styles.visuallyHidden}>
            Months
          </label>
          <input
            id={`${id}-other`}
            className={styles.input}
            inputMode="numeric"
            value={text}
            aria-invalid={error ? true : undefined}
            autoFocus
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveOther();
              if (e.key === 'Escape') {
                e.stopPropagation();
                setOther(false);
              }
            }}
          />
          <span className={styles.muted}>months</span>
          <button type="button" className={styles.plainButton} onClick={() => void saveOther()}>
            Use
          </button>
        </span>
      )}
      {error && (
        <p className={styles.overrideError} role="alert">
          {error}
        </p>
      )}
      <p className={styles.overrideHint}>
        {cost.rentForTerm
          ? `Rent for a ${cost.leaseMonths}-month lease. `
          : terms.size
            ? `No listed rent for ${monthsLabel(cost.leaseMonths)}, so the rent is used. `
            : ''}
        {profile.amortizeOneTimeFees || profile.amortizeSpecials
          ? `One-time amounts are spread over ${monthsLabel(cost.leaseMonths)}.`
          : ''}
      </p>
    </div>
  );
}

export function CostSection({
  unit,
  cost,
  profile,
}: {
  unit: Unit;
  cost: UnitCost;
  profile: CostProfile;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const moveIn = cost.moveIn;
  return (
    <Section
      title="Monthly cost"
      id="unit-cost"
      action={<Link to="/settings/cost">Edit cost profile</Link>}
    >
      {cost.leaseMatters && <LeaseLength unit={unit} cost={cost} profile={profile} />}
      <table className={styles.costTable}>
        <caption className={styles.visuallyHidden}>
          Monthly cost: each line, where it came from, and the amount
        </caption>
        <tbody>
          {cost.rent === null && (
            <tr>
              <th scope="row">Rent</th>
              <td className={styles.costNote}>unknown</td>
              <td className={styles.costAmount}>
                <i className={styles.muted}>?</i>
              </td>
            </tr>
          )}
          {cost.lines.map((l) => (
            <tr key={l.key} data-assumed={l.assumed || undefined}>
              <th scope="row">{l.label}</th>
              <td className={styles.costNote}>
                {l.assumed && <span className={styles.assumedTag}>assumed</span>}
                {l.note}
                {l.overrideKey && editing !== l.key && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className={styles.linkButton}
                      onClick={() => setEditing(l.key)}
                      aria-label={`Set ${l.label.toLowerCase()} for this unit`}
                    >
                      {l.source === 'override' ? 'Change' : 'Set for this unit'}
                    </button>
                  </>
                )}
                {editing === l.key && (
                  <OverrideEditor
                    unit={unit}
                    line={l}
                    profile={profile}
                    onDone={() => setEditing(null)}
                  />
                )}
              </td>
              <td className={styles.costAmount}>{amountText(l.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={styles.costTotal}>
            <th scope="row">Total</th>
            <td className={styles.costNote}>{cost.assumed > 0 && `${cost.assumed} assumed`}</td>
            <td className={styles.costAmount}>
              {cost.total === null ? (
                <i className={styles.muted}>Unknown</i>
              ) : (
                <>
                  {unit.rentIsFrom && 'from '}
                  {money(cost.total)}
                  <small>/mo</small>
                </>
              )}
            </td>
          </tr>
        </tfoot>
      </table>
      {cost.total === null && (
        <p className={styles.muted}>The total needs the rent. Edit (E) to add it.</p>
      )}
      <dl className={styles.costExtras}>
        {cost.effectiveRent !== null && (
          <div className={styles.row}>
            <dt>
              Effective rent
              <span className={styles.costSub}>
                {' '}
                with the move-in special over {monthsLabel(cost.leaseMonths)}
              </span>
            </dt>
            <dd>{money(cost.effectiveRent)}</dd>
          </div>
        )}
        <div className={styles.row}>
          <dt>
            Move-in cost
            <span className={styles.costSub}>
              {' '}
              {moveIn.parts.map((p) => p.label.toLowerCase()).join(', ') || 'first month'}
              {moveIn.unknown.length > 0 &&
                `; ${moveIn.unknown.map((u) => u.toLowerCase()).join(', ')} unknown`}
            </span>
          </dt>
          <dd>
            {moveIn.total === null ? <i className={styles.muted}>Unknown</i> : money(moveIn.total)}
          </dd>
        </div>
        <div className={styles.row}>
          <dt>Per square foot</dt>
          <dd>
            {cost.perSqft === null ? (
              <i className={styles.muted}>
                {unit.squareFeet === null ? 'Size unknown' : 'Unknown'}
              </i>
            ) : (
              perSqftLabel(cost.perSqft)
            )}
          </dd>
        </div>
      </dl>
    </Section>
  );
}
