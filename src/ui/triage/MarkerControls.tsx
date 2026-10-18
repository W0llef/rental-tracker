import type { CSSProperties } from 'react';
import { STATUS_COLOR_VAR, STATUS_LABELS } from '../../domain/format';
import { LABEL_COLOR_VAR } from '../../domain/pins';
import { common } from '../../domain/triage';
import type { Common } from '../../domain/triage';
import { LABEL_COLORS, UNIT_STATUSES } from '../../model';
import type { LabelColor, Person, Rating, Settings, UnitStatus } from '../../model';
import type { UnitRow } from '../../state/derive';
import { StarInput } from '../common/Markers';
import {
  changeStatus,
  setFlag,
  setPrivateLabel,
  setRating,
  setShared,
  startReject,
} from './actions';
import styles from './triage.module.css';

/**
 * Your flag and stars, your private label, the shared label and the status, for one unit
 * (the detail panel's markers row) or several (the selection bar). Where the units differ
 * nothing is shown as chosen and the text says "Mixed" (DESIGN.md §4.2, §5).
 */

const LABEL_KEY: Partial<Record<LabelColor, string>> = {
  red: '6',
  yellow: '7',
  green: '8',
  blue: '9',
};

export function LabelPicker({
  title,
  current,
  names,
  shift = false,
  onPick,
}: {
  title: string;
  current: Common<LabelColor | null>;
  names: Record<LabelColor, string>;
  /** The shared label's keys are ⇧6–9. */
  shift?: boolean;
  onPick: (color: LabelColor | null) => void;
}) {
  const chosen = current.mixed ? null : current.value;
  const nameNow = current.mixed ? 'Mixed' : chosen ? names[chosen] : 'None';
  return (
    <div className={styles.labelPicker} role="group" aria-label={title}>
      <span className={styles.pickerTitle}>
        {title}: <b>{nameNow}</b>
      </span>
      <span className={styles.swatches}>
        {LABEL_COLORS.map((c) => {
          const key = LABEL_KEY[c];
          const hint = key ? ` (${shift ? '⇧' : ''}${key})` : ' (menu only)';
          return (
            <button
              key={c}
              type="button"
              className={styles.swatchButton}
              style={{ '--c': `var(${LABEL_COLOR_VAR[c]})` } as CSSProperties}
              aria-pressed={chosen === c}
              aria-label={names[c]}
              title={chosen === c ? `${names[c]}: click to clear` : `${names[c]}${hint}`}
              onClick={() => onPick(chosen === c ? null : c)}
            />
          );
        })}
      </span>
    </div>
  );
}

export function MarkerControls({
  rows,
  me,
  settings,
  layout = 'panel',
}: {
  rows: UnitRow[];
  me: Person;
  settings: Settings;
  layout?: 'panel' | 'bar';
}) {
  if (!rows.length) return null;
  const flag = common(rows.map((r) => r.mine.flag));
  const rating = common(rows.map((r) => r.mine.rating));
  const mine = common(rows.map((r) => r.mine.colorLabel));
  const shared = common(rows.map((r) => r.unit.colorLabel));
  const status = common(rows.map((r) => r.unit.status));
  const flagIs = (f: string) => !flag.mixed && flag.value === f;
  const many = rows.length > 1;

  return (
    <div className={layout === 'bar' ? styles.controlsBar : styles.controls}>
      <div className={styles.controlRow}>
        <div className={styles.flagGroup} role="group" aria-label={many ? 'Flag' : 'Your flag'}>
          <button
            type="button"
            className={styles.flagButton}
            data-flag="pick"
            aria-pressed={flagIs('pick')}
            aria-keyshortcuts="p"
            onClick={() => void setFlag(rows, me.id, flagIs('pick') ? 'none' : 'pick')}
          >
            Pick <kbd aria-hidden="true">P</kbd>
          </button>
          <button
            type="button"
            className={styles.flagButton}
            data-flag="reject"
            aria-pressed={flagIs('reject')}
            aria-keyshortcuts="x"
            onClick={() => startReject(rows, me.id)}
          >
            Reject… <kbd aria-hidden="true">X</kbd>
          </button>
          <button
            type="button"
            className={styles.flagButton}
            aria-pressed={flagIs('none')}
            aria-keyshortcuts="u"
            onClick={() => void setFlag(rows, me.id, 'none')}
          >
            No flag <kbd aria-hidden="true">U</kbd>
          </button>
        </div>
        <span className={styles.stars}>
          <StarInput
            rating={rating.mixed ? 0 : rating.value}
            label={many ? 'Your rating for all of them' : 'Your rating'}
            onChange={(n: Rating) => void setRating(rows, me.id, n)}
          />
          {rating.mixed && <span className={styles.mixed}>Mixed</span>}
        </span>
      </div>
      <div className={styles.controlRow}>
        <LabelPicker
          title="Your label"
          current={mine}
          names={me.labelNames}
          onPick={(c) => void setPrivateLabel(rows, me.id, c)}
        />
        <LabelPicker
          title="Shared label"
          current={shared}
          names={settings.labelNames}
          shift
          onPick={(c) => void setShared(rows, c)}
        />
        <label className={styles.statusField}>
          <span className={styles.pickerTitle}>Status</span>
          <select
            className={styles.statusSelect}
            value={status.mixed ? '' : status.value}
            style={
              status.mixed
                ? undefined
                : ({ '--c': `var(${STATUS_COLOR_VAR[status.value]})` } as CSSProperties)
            }
            onChange={(e) => {
              if (e.target.value) void changeStatus(rows, e.target.value as UnitStatus);
            }}
          >
            {status.mixed && (
              <option value="" disabled>
                Mixed
              </option>
            )}
            {UNIT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
