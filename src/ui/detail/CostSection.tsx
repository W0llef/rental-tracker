import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { setCostOverride, setLeaseLength } from '../../commands/cost';
import { db } from '../../db/db';
import { notOfferedLabel, notOfferedText, perSqftLabel, profileEstimate } from '../../domain/cost';
import type { CostLine, UnitCost } from '../../domain/cost';
import { aLease, money, monthsLabel } from '../../domain/format';
import { parseMoney, parseWhole } from '../../domain/input';
import type { CostProfile, Unit } from '../../model';
import { LeaseMark } from '../common/Markers';
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
  const offered = new Set(cost.offeredTerms);
  const value = unit.plannedLeaseMonths === null ? 'default' : String(unit.plannedLeaseMonths);
  const optionText = (m: number) => {
    const rent = terms.get(m);
    const parts = [monthsLabel(m)];
    if (rent !== undefined) parts.push(`${money(rent)} rent`);
    else if (offered.size && !offered.has(m)) parts.push('not listed');
    return parts.join(', ');
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
        <option value="default">Your default ({optionText(profile.defaultLeaseMonths)})</option>
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
        {cost.termStatus === 'not-offered'
          ? ''
          : cost.rentForTerm
            ? `Rent for ${aLease(cost.leaseMonths)}. `
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
      {cost.termStatus === 'not-offered' && (
        <p className={styles.leaseNote}>
          <LeaseMark label={notOfferedLabel(cost)} explain={notOfferedText(cost)} />{' '}
          {notOfferedText(cost).replace(/^Doesn’t/, 'This unit doesn’t')}
        </p>
      )}
      {cost.termStatus === 'unknown' && (
        <p className={styles.leaseNoteQuiet}>
          Lease terms unknown, so the costs assume {aLease(cost.leaseMonths)} at the listed prices.
        </p>
      )}
      {cost.leaseMatters && <LeaseLength unit={unit} cost={cost} profile={profile} />}
      <ul className={styles.costLines} aria-label="Monthly cost lines">
        {cost.rent === null && (
          <li className={styles.costLine}>
            <span className={styles.costLabel}>Rent</span>
            <span className={styles.costAmount}>
              <i className={styles.muted}>Unknown</i>
            </span>
          </li>
        )}
        {cost.lines.map((l) => (
          <li key={l.key} className={styles.costLine} data-assumed={l.assumed || undefined}>
            <span className={styles.costLabel}>{l.label}</span>
            <span className={styles.costAmount}>{amountText(l.amount)}</span>
            <span className={styles.costEdit}>
              {l.overrideKey && (
                <button
                  type="button"
                  className={styles.pencil}
                  aria-expanded={editing === l.key}
                  onClick={() => setEditing(editing === l.key ? null : l.key)}
                  title={`Your ${l.label.toLowerCase()} estimate for this unit`}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      d="M10.8 2.6l2.6 2.6-7.6 7.6-3.2.6.6-3.2 7.6-7.6z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className={styles.visuallyHidden}>
                    Set {l.label.toLowerCase()} for this unit
                  </span>
                </button>
              )}
            </span>
            <span className={styles.costNote}>
              {l.assumed && <span className={styles.assumedTag}>assumed</span>}
              {l.note}
            </span>
            {editing === l.key && (
              <OverrideEditor
                unit={unit}
                line={l}
                profile={profile}
                onDone={() => setEditing(null)}
              />
            )}
          </li>
        ))}
        <li className={`${styles.costLine} ${styles.costTotal}`}>
          <span className={styles.costLabel}>Total</span>
          <span className={styles.costAmount}>
            {cost.total === null ? (
              <i className={styles.muted}>Unknown</i>
            ) : (
              <>
                {unit.rentIsFrom && 'from '}
                {money(cost.total)}
                <small>/mo</small>
              </>
            )}
          </span>
          {cost.assumed > 0 && (
            <span className={styles.costNote}>
              {cost.assumed} of the lines {cost.assumed === 1 ? 'is' : 'are'} assumed
            </span>
          )}
        </li>
      </ul>
      {cost.total === null && (
        <p className={styles.muted}>The total needs the rent. Edit (E) to add it.</p>
      )}
      <dl className={styles.costExtras}>
        {cost.effectiveRent !== null && (
          <div className={styles.extra}>
            <dt>Effective rent</dt>
            <dd>{money(cost.effectiveRent)}</dd>
            <dd className={styles.costSub}>
              The rent less the move-in special, spread over {monthsLabel(cost.leaseMonths)}.
            </dd>
          </div>
        )}
        <div className={styles.extra}>
          <dt>Move-in cost</dt>
          <dd>
            {moveIn.total === null ? <i className={styles.muted}>Unknown</i> : money(moveIn.total)}
          </dd>
          <dd className={styles.costSub}>
            {moveIn.parts.map((p) => `${p.label} ${money(p.amount)}`).join(', ') || 'First month'}
            {moveIn.unknown.length > 0 &&
              `; ${moveIn.unknown.map((u) => u.toLowerCase()).join(', ')} unknown`}
            .
          </dd>
        </div>
        <div className={styles.extra}>
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
