import { money } from '../../domain/format';
import type { Chip } from './plan';
import styles from './add.module.css';

const MONEY_FIELDS = /(rent|deposit|Fee|fee|Cost|cost|monthlyRent|oneTimeFee|amount)$/;

/** "$1,500", "studio", "included": what a field holds now, to show next to a change. */
function wasText(field: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (field === 'unit.bedrooms' && value === 0) return 'studio';
    return MONEY_FIELDS.test(field) ? money(value) : String(value);
  }
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') return value.replace(/-/g, ' ');
  if (Array.isArray(value)) return value.length ? `${value.length} listed` : 'none';
  if (typeof value === 'object' && 'mode' in value) {
    const m = (value as { mode: string }).mode;
    return m === 'included' ? 'included' : m === 'extra' ? 'billed extra' : 'you pay';
  }
  return 'set';
}

/**
 * Recognized facts as toggle chips (DESIGN.md §4.6). New values start on; values that would
 * change one you have start off and say what you have now.
 */
export function FactChips({
  chips,
  current,
  onToggle,
}: {
  chips: readonly Chip[];
  /** The value each changing field has now. */
  current: (field: string) => unknown;
  onToggle: (field: string) => void;
}) {
  if (!chips.length) return null;
  return (
    <ul className={styles.chips} aria-label="Recognized details">
      {chips.map(({ fact, status, on }) => {
        const was = status === 'changes' ? wasText(fact.field, current(fact.field)) : null;
        return (
          <li key={fact.field}>
            <button
              type="button"
              className={styles.chip}
              aria-pressed={on}
              data-change={status === 'changes' || undefined}
              onClick={() => onToggle(fact.field)}
            >
              <span aria-hidden="true" className={styles.chipMark}>
                {on ? '✓' : '+'}
              </span>
              <span>{fact.label}</span>
              {was !== null && (
                <>
                  {' '}
                  <span className={styles.chipWas}>(yours: {was})</span>
                </>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
