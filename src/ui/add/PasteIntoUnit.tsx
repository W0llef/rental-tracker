import { useMemo, useState } from 'react';
import { addToUnit } from '../../commands/quickAdd';
import { db } from '../../db/db';
import { valueAt } from '../../domain/facts';
import { buildingName, unitTitle } from '../../domain/format';
import { parseListingText } from '../../domain/listingText';
import type { ISODate } from '../../model';
import type { UnitRow } from '../../state/derive';
import { useUi } from '../../state/ui';
import { FactChips } from './FactChips';
import { chipsFor } from './plan';
import styles from './add.module.css';

/**
 * "Paste text" on a unit (DESIGN.md §4.2; PLAN.md §5.7): paste more listing text later.
 * Details the unit doesn't have yet start ticked; ones that would change yours start
 * unticked and show what you have. Apply is one undo step; a pasted rent becomes a price.
 */
export function PasteIntoUnit({
  row,
  today,
  onDone,
}: {
  row: UnitRow;
  today: ISODate;
  onDone: () => void;
}) {
  const showNotice = useUi((s) => s.showNotice);
  const [text, setText] = useState('');
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const b = row.building;
  const parsed = useMemo(() => (text.trim() ? parseListingText(text, today) : null), [text, today]);
  const target = { unit: row.unit, building: b };
  const chips = parsed ? chipsFor(parsed.facts, target, toggled, { includeInputs: true }) : [];
  const chosen = chips.filter((c) => c.on).map((c) => c.fact);

  async function apply() {
    if (!chosen.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      await addToUnit(db, {
        unitId: row.unit.id,
        today,
        listing: null,
        rent: null,
        rentIsFrom: false,
        facts: chosen,
        pasted: text,
        skipped: chips.length - chosen.length,
      });
      const title = unitTitle(row.unit, b);
      const name = b ? buildingName(b) : null;
      showNotice(
        `${name && name !== title ? `${title} at ${name}` : title}: ${chosen.length} detail${
          chosen.length === 1 ? '' : 's'
        } added from pasted text.`,
      );
      onDone();
    } catch (e) {
      setError(`Couldn’t apply the text. ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.panelPaste}>
      <label htmlFor="unit-paste" className={styles.label}>
        Paste listing text
      </label>
      <textarea
        id="unit-paste"
        className={styles.textarea}
        // Opened on purpose by "Paste text", so typing can start right away.
        autoFocus
        placeholder="On the listing page: select all, copy, and paste here"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setToggled(new Set());
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void apply();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            onDone();
          }
        }}
      />
      <div aria-live="polite">
        {parsed && (
          <p className={styles.note}>
            {chips.length === 0
              ? parsed.facts.length
                ? 'Everything recognized already matches this unit.'
                : 'Nothing recognized in that text.'
              : `${chips.length} detail${chips.length === 1 ? '' : 's'} to add or change. Click one to switch it.`}
          </p>
        )}
        {parsed?.notes.map((n) => (
          <p key={n} className={styles.note}>
            {n}
          </p>
        ))}
      </div>
      <FactChips
        chips={chips}
        current={(field) => valueAt(field, target)}
        onToggle={(field) =>
          setToggled((t) => {
            const next = new Set(t);
            if (next.has(field)) next.delete(field);
            else next.add(field);
            return next;
          })
        }
      />
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.panelActions}>
        <button
          type="button"
          className={styles.primary}
          disabled={!chosen.length || busy}
          onClick={() => void apply()}
        >
          {chosen.length ? `Apply ${chosen.length}` : 'Apply'}
        </button>
        <button type="button" className={styles.button} onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}
