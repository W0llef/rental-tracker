import { useId, useState } from 'react';
import { perSqftLabel } from '../../domain/cost';
import { costLimitsActive, NO_COST_LIMITS } from '../../domain/filter';
import type { CostLimits } from '../../domain/filter';
import { money } from '../../domain/format';
import { parseMoney } from '../../domain/input';
import { useUi } from '../../state/ui';
import styles from './list.module.css';

/**
 * Cost limits above the list (M9): "Total up to $X", "Per ft² up to $Y". They narrow the
 * list and the map together, for this visit, like search. M10's filter panel takes them
 * over as its total-cost and $/ft² ranges.
 */

/** "Total up to $2,000/mo, up to $2.75/ft²". */
function limitsText(l: CostLimits): string {
  const parts: string[] = [];
  if (l.maxTotal !== null) parts.push(`Total up to ${money(l.maxTotal)}/mo`);
  if (l.maxPerSqft !== null) parts.push(`up to ${perSqftLabel(l.maxPerSqft)}`);
  if (l.offeredLeaseOnly) parts.push('listing your lease length');
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parsePerSqft(
  text: string,
): { ok: true; value: number | null } | { ok: false; error: string } {
  const t = text
    .trim()
    .replace(/^\$\s*/, '')
    .replace(/\s*(\/\s*)?(ft²|sq\.?\s*ft\.?|sf)$/i, '');
  if (t === '') return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t))
    return { ok: false, error: 'Enter dollars per ft², like 2.50.' };
  return { ok: true, value: Number(t) };
}

function LimitsForm({
  limits,
  leaseMonths,
  onDone,
}: {
  limits: CostLimits;
  leaseMonths: number;
  onDone: () => void;
}) {
  const setLimits = useUi((s) => s.setCostLimits);
  const id = useId();
  const [total, setTotal] = useState(limits.maxTotal === null ? '' : String(limits.maxTotal));
  const [psf, setPsf] = useState(limits.maxPerSqft === null ? '' : String(limits.maxPerSqft));
  const [unknown, setUnknown] = useState(limits.includeUnknown);
  const [offered, setOffered] = useState(limits.offeredLeaseOnly);
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    const t = parseMoney(total, 50_000);
    if (!t.ok) return setError(t.error.replace(', or ? for unknown', ''));
    const p = parsePerSqft(psf);
    if (!p.ok) return setError(p.error);
    setError(null);
    setLimits({
      maxTotal: t.value,
      maxPerSqft: p.value,
      includeUnknown: unknown,
      offeredLeaseOnly: offered,
    });
    onDone();
  };

  return (
    <form
      className={styles.limits}
      aria-label="Cost limits"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onDone();
        }
      }}
    >
      <label htmlFor={`${id}-total`} className={styles.limitLabel}>
        Total up to
      </label>
      <span className={styles.limitInput}>
        <span aria-hidden="true">$</span>
        <input
          id={`${id}-total`}
          className={styles.limitBox}
          inputMode="numeric"
          placeholder="any"
          value={total}
          autoFocus
          onChange={(e) => setTotal(e.target.value)}
        />
        <span className={styles.limitUnit}>/mo</span>
      </span>
      <label htmlFor={`${id}-psf`} className={styles.limitLabel}>
        Per ft² up to
      </label>
      <span className={styles.limitInput}>
        <span aria-hidden="true">$</span>
        <input
          id={`${id}-psf`}
          className={styles.limitBox}
          inputMode="decimal"
          placeholder="any"
          value={psf}
          onChange={(e) => setPsf(e.target.value)}
        />
        <span className={styles.limitUnit}>/ft²</span>
      </span>
      <label className={styles.limitCheck}>
        <input type="checkbox" checked={unknown} onChange={(e) => setUnknown(e.target.checked)} />
        Keep units whose cost or size is unknown
      </label>
      <label className={styles.limitCheck}>
        <input type="checkbox" checked={offered} onChange={(e) => setOffered(e.target.checked)} />
        <span>
          Only units that list your lease length
          <span className={styles.limitHint}>
            {' '}
            ({leaseMonths} months, or the one you picked for a unit; units with unknown or no lease
            terms are left out too)
          </span>
        </span>
      </label>
      {error && (
        <p className={styles.limitError} role="alert">
          {error}
        </p>
      )}
      <span className={styles.limitActions}>
        <button type="submit" className={styles.button}>
          Apply
        </button>
        <button type="button" className={styles.textButton} onClick={onDone}>
          Cancel
        </button>
      </span>
    </form>
  );
}

/** The Cost button in the list's head row. */
export function CostLimitsButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const active = costLimitsActive(useUi((s) => s.costLimits));
  return (
    <button
      type="button"
      className={styles.limitsButton}
      aria-expanded={open}
      aria-controls={open ? 'cost-limits' : undefined}
      data-active={active || undefined}
      title="Limit by total cost, cost per ft² or lease length"
      onClick={onToggle}
    >
      {active ? 'Cost limits on' : 'Cost limits'}
    </button>
  );
}

/** Under the head row: the form while open, else what the limits are while they apply. */
export function CostLimitsPanel({
  open,
  setOpen,
  leaseMonths,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Your default lease length (Settings → Cost profile). */
  leaseMonths: number;
}) {
  const limits = useUi((s) => s.costLimits);
  const setLimits = useUi((s) => s.setCostLimits);
  if (open)
    return (
      <div id="cost-limits">
        <LimitsForm limits={limits} leaseMonths={leaseMonths} onDone={() => setOpen(false)} />
      </div>
    );
  if (!costLimitsActive(limits)) return null;
  return (
    <p className={styles.limitChip}>
      <span>
        {limitsText(limits)}
        {!limits.includeUnknown && ', known costs only'}
      </span>
      <button type="button" className={styles.textButton} onClick={() => setOpen(true)}>
        Change
      </button>
      <button type="button" className={styles.textButton} onClick={() => setLimits(NO_COST_LIMITS)}>
        Clear
      </button>
    </p>
  );
}
