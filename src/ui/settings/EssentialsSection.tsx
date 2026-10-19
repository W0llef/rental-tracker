import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { getSettings, updateSettings } from '../../commands/records';
import { db } from '../../db/db';
import { BUILDING_SECTIONS, CHECKS, UNIT_SECTIONS } from '../../domain/completeness';
import type { Check } from '../../domain/completeness';
import { DEFAULT_ESSENTIAL_FIELDS } from '../../model';
import styles from './settings.module.css';

/**
 * Essential fields (DESIGN.md §4.5, PLAN.md §5.7): which facts a unit needs before it's
 * "ready to compare". They drive the essentials count in the unit's panel and form, and the
 * prompts for what's missing. Every change can be undone.
 */

const same = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

function groups(owner: 'unit' | 'building') {
  const sections = owner === 'unit' ? UNIT_SECTIONS : BUILDING_SECTIONS;
  return sections
    .map((s) => ({
      id: `${owner}-${s.id}`,
      label: s.label,
      checks: CHECKS.filter((c) => c.owner === owner && c.section === s.id),
    }))
    .filter((g) => g.checks.length > 0);
}

export function EssentialsSection() {
  const settings = useLiveQuery(() => getSettings(db), []);
  const [error, setError] = useState<string | null>(null);
  if (!settings) return null;
  const chosen = new Set(settings.essentialFields);
  const count = CHECKS.filter((c) => chosen.has(c.key)).length;
  const isDefault = same(settings.essentialFields, DEFAULT_ESSENTIAL_FIELDS);

  const save = async (next: string[], label: string) => {
    setError(null);
    try {
      await updateSettings(db, (s) => ({ ...s, essentialFields: next }), label);
    } catch (e) {
      setError(`Couldn’t save. ${e instanceof Error ? e.message : ''}`.trim());
    }
  };
  const toggle = (c: Check, on: boolean) =>
    save(
      on
        ? [...settings.essentialFields, c.key]
        : settings.essentialFields.filter((k) => k !== c.key),
      on ? `Essential: ${c.label}` : `Not essential: ${c.label}`,
    );

  return (
    <>
      <p className={styles.lead}>
        The facts a unit needs before it’s ready to compare. Each unit’s panel counts them and
        offers the missing ones as prompts that open the form at that field.
      </p>
      <div className={styles.card}>
        <div className={styles.essentialsHead}>
          <p className={styles.text} aria-live="polite">
            {count} essential field{count === 1 ? '' : 's'}
            {isDefault ? ' (the defaults)' : ''}
          </p>
          <button
            type="button"
            className={styles.button}
            disabled={isDefault}
            onClick={() => void save([...DEFAULT_ESSENTIAL_FIELDS], 'Default essential fields')}
          >
            Back to the defaults
          </button>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        {(['unit', 'building'] as const).map((owner) => (
          <div key={owner}>
            <h3 className={styles.cardTitle}>{owner === 'unit' ? 'The unit' : 'Its building'}</h3>
            {groups(owner).map((g) => (
              <fieldset key={g.id} className={styles.essentialsGroup}>
                <legend className={styles.essentialsLegend}>{g.label}</legend>
                {g.checks.map((c) => (
                  <label key={c.key} className={styles.essentialsCheck}>
                    <input
                      type="checkbox"
                      checked={chosen.has(c.key)}
                      onChange={(e) => void toggle(c, e.target.checked)}
                    />
                    {c.label}
                  </label>
                ))}
              </fieldset>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
