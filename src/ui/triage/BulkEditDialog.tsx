import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { action } from '../../commands/action';
import { setOpinion } from '../../commands/people';
import { updateUnits } from '../../commands/triage';
import type { UnitPatch } from '../../commands/triage';
import { db } from '../../db/db';
import { enumLabel, STATUS_LABELS, UTILITY_LABELS, utilityLabel } from '../../domain/format';
import { common, parseMonths, unitsCount } from '../../domain/triage';
import type { Common } from '../../domain/triage';
import { LABEL_COLORS, UNIT_STATUSES, UTILITY_KEYS } from '../../model';
import type { OpinionFields, Rating, Unit, UtilityKey, UtilityTerm } from '../../model';
import type { Dataset, UnitRow } from '../../state/derive';
import styles from './triage.module.css';

/**
 * Edit together (PLAN.md §5.7, Q20): set markers and common facts for every selected unit
 * at once. Each field starts at "Leave as is" (saying what the units have now, or "Mixed");
 * only fields you change are written, all in one undo step.
 */

const LEAVE = '';
const UNKNOWN = '?';

interface Choice {
  value: string;
  label: string;
}

const tri: Choice[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: UNKNOWN, label: 'Unknown' },
];

const enumChoices = (values: readonly string[]): Choice[] => [
  ...values.map((v) => ({ value: v, label: enumLabel(v) })),
  { value: UNKNOWN, label: 'Unknown' },
];

const LAUNDRY = enumChoices(['in-unit', 'in-building', 'none']);
const AC = enumChoices(['central', 'mini-split', 'wall-unit', 'window-unit', 'none', 'other']);
const HEATING = enumChoices([
  'forced-air',
  'radiator',
  'baseboard',
  'radiant-floor',
  'heat-pump',
  'other',
]);
const PARKING = enumChoices(['garage', 'surface', 'street', 'none']);
const UTILITY: Choice[] = [
  { value: 'included', label: 'Included' },
  { value: 'extra', label: 'Billed extra' },
  { value: 'tenant-paid', label: 'You pay' },
  { value: UNKNOWN, label: 'Unknown' },
];

/** What the units have now, in words, for "Leave as is (…)". */
function nowText<T>(c: Common<T>, say: (v: T) => string): string {
  if (c.mixed) return 'Mixed';
  return say(c.value);
}

const triText = (v: boolean | null) => (v === null ? 'Unknown' : v ? 'Yes' : 'No');
const enumText = (v: string | null) => (v === null ? 'Unknown' : enumLabel(v));

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className={styles.bulkRow}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </label>
  );
}

function Pick({
  label,
  now,
  choices,
  value,
  onChange,
}: {
  label: string;
  now: string;
  choices: Choice[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Row label={label}>
      <select
        className={styles.select}
        value={value}
        data-changed={value !== LEAVE || undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value={LEAVE}>Leave as is ({now})</option>
        {choices.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
    </Row>
  );
}

function NumberField({
  label,
  now,
  value,
  onChange,
  prefix,
}: {
  label: string;
  now: string;
  value: string;
  onChange: (v: string) => void;
  prefix?: string;
}) {
  return (
    <Row label={label}>
      <span className={styles.numberWrap}>
        {prefix && <span aria-hidden="true">{prefix}</span>}
        <input
          className={styles.input}
          inputMode="numeric"
          value={value}
          data-changed={value !== LEAVE || undefined}
          placeholder={`Leave as is (${now}); ? for unknown`}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
    </Row>
  );
}

type Draft = Record<string, string>;

/** "$1,200" → 1200; "?" → null; blank → undefined (leave); unreadable → NaN. */
function parseNumber(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (t === UNKNOWN) return null;
  const n = Number(t.replace(/[$,\s]/g, ''));
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

function utilityTerm(mode: string): UtilityTerm | null {
  if (mode === 'included') return { mode: 'included' };
  if (mode === 'extra') return { mode: 'extra', amount: null };
  if (mode === 'tenant-paid') return { mode: 'tenant-paid', estimate: null };
  return null;
}

export function BulkEditDialog({
  rows,
  data,
  onClose,
}: {
  rows: UnitRow[];
  data: Dataset;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (key: string) => (v: string) => setDraft((d) => ({ ...d, [key]: v }));
  const val = (key: string) => draft[key] ?? LEAVE;

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, []);

  const units = rows.map((r) => r.unit);
  const of = <T,>(get: (u: Unit) => T) => common(units.map(get));
  const mine = <K extends keyof OpinionFields>(k: K) => common(rows.map((r) => r.mine[k]));

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const patch: UnitPatch = {};
    const opinion: Partial<OpinionFields> = {};
    const t = (k: string) => val(k);

    if (t('flag')) opinion.flag = t('flag') as OpinionFields['flag'];
    if (t('rating')) opinion.rating = Number(t('rating')) as Rating;
    if (t('myLabel')) opinion.colorLabel = t('myLabel') === 'none' ? null : (t('myLabel') as never);
    if (t('sharedLabel'))
      patch.colorLabel = t('sharedLabel') === 'none' ? null : (t('sharedLabel') as never);
    if (t('status')) patch.status = t('status') as Unit['status'];
    const enumOf = (k: string) => (t(k) === UNKNOWN ? null : t(k));
    if (t('laundry')) patch.laundry = enumOf('laundry') as Unit['laundry'];
    if (t('acType')) patch.acType = enumOf('acType') as Unit['acType'];
    if (t('heatingType')) patch.heatingType = enumOf('heatingType') as Unit['heatingType'];
    if (t('dishwasher'))
      patch.dishwasher = t('dishwasher') === UNKNOWN ? null : t('dishwasher') === 'yes';
    const utilities: Partial<Record<UtilityKey, UtilityTerm | null>> = {};
    for (const k of UTILITY_KEYS) if (t(`u.${k}`)) utilities[k] = utilityTerm(t(`u.${k}`));
    if (Object.keys(utilities).length) patch.utilities = utilities;

    const parking: Partial<Unit['parking']> = {};
    if (t('parkingType')) parking.type = enumOf('parkingType') as Unit['parking']['type'];
    const storage: Partial<Unit['storage']> = {};
    if (t('storage')) storage.included = t('storage') === UNKNOWN ? null : t('storage') === 'yes';
    const numbers: [string, (n: number | null) => void, string][] = [
      ['spaces', (n) => (parking.spacesIncluded = n), 'Parking spaces included'],
      ['spaceCost', (n) => (parking.extraSpaceCost = n), 'Extra parking space'],
      ['storageCost', (n) => (storage.cost = n), 'Storage cost'],
    ];
    for (const [k, apply, label] of numbers) {
      const n = parseNumber(t(k));
      if (n === undefined) continue;
      if (Number.isNaN(n)) {
        setError(`${label}: enter a whole number, or ? for unknown.`);
        return;
      }
      apply(n);
    }
    if (Object.keys(parking).length) patch.parking = parking;
    if (Object.keys(storage).length) patch.storage = storage;

    if (t('lease').trim()) {
      const months = parseMonths(t('lease'));
      if (months === undefined) {
        setError('Lease terms: enter months like “12, 15”, “none”, or ? for unknown.');
        return;
      }
      patch.leaseTermsMonths = months;
    }
    if (t('available') === UNKNOWN) patch.availableDate = null;
    else if (t('available')) patch.availableDate = t('available');

    const ids = units.map((u) => u.id);
    if (!Object.keys(patch).length && !Object.keys(opinion).length) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await action(db, 'Edit together', async () => {
        if (Object.keys(patch).length) await updateUnits(db, ids, patch);
        if (Object.keys(opinion).length) await setOpinion(db, ids, data.me.id, opinion);
      });
      onClose();
    } catch (err) {
      setError(`Couldn’t save. ${err instanceof Error ? err.message : ''}`.trim());
      setBusy(false);
    }
  }

  const labelChoices = (names: Record<string, string>): Choice[] => [
    ...LABEL_COLORS.map((c) => ({ value: c, label: names[c] ?? c })),
    { value: 'none', label: 'No label' },
  ];
  const changed = Object.values(draft).filter((v) => v !== LEAVE).length;

  return (
    <dialog
      ref={dialog}
      className={`${styles.dialog} ${styles.dialogWide}`}
      aria-labelledby="bulk-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <form className={styles.form} onSubmit={submit} noValidate>
        <header className={styles.head}>
          <h2 id="bulk-title" className={styles.title}>
            Edit {unitsCount(rows.length)} together
          </h2>
        </header>
        <div className={styles.body}>
          <p className={styles.muted}>
            Only what you change is set, for every selected unit. “Mixed” means they differ now.
          </p>
          <fieldset className={styles.bulkGroup}>
            <legend className={styles.legend}>Yours</legend>
            <Pick
              label="Your flag"
              now={nowText(mine('flag'), (f) => (f === 'none' ? 'No flag' : enumLabel(f)))}
              choices={[
                { value: 'pick', label: 'Pick' },
                { value: 'reject', label: 'Reject (add reasons with X)' },
                { value: 'none', label: 'No flag' },
              ]}
              value={val('flag')}
              onChange={set('flag')}
            />
            <Pick
              label="Your rating"
              now={nowText(mine('rating'), (n) => (n ? `${n} stars` : 'Not rated'))}
              choices={[5, 4, 3, 2, 1, 0].map((n) => ({
                value: String(n),
                label: n ? `${'★'.repeat(n)} ${n}` : 'Not rated',
              }))}
              value={val('rating')}
              onChange={set('rating')}
            />
            <Pick
              label="Your label"
              now={nowText(mine('colorLabel'), (c) => (c ? data.me.labelNames[c] : 'None'))}
              choices={labelChoices(data.me.labelNames)}
              value={val('myLabel')}
              onChange={set('myLabel')}
            />
          </fieldset>
          <fieldset className={styles.bulkGroup}>
            <legend className={styles.legend}>Shared</legend>
            <Pick
              label="Shared label"
              now={nowText(
                of((u) => u.colorLabel),
                (c) => (c ? data.settings.labelNames[c] : 'None'),
              )}
              choices={labelChoices(data.settings.labelNames)}
              value={val('sharedLabel')}
              onChange={set('sharedLabel')}
            />
            <Pick
              label="Status"
              now={nowText(
                of((u) => u.status),
                (s) => STATUS_LABELS[s],
              )}
              choices={UNIT_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] }))}
              value={val('status')}
              onChange={set('status')}
            />
          </fieldset>
          <fieldset className={styles.bulkGroup}>
            <legend className={styles.legend}>Utilities</legend>
            {UTILITY_KEYS.map((k) => (
              <Pick
                key={k}
                label={UTILITY_LABELS[k]}
                now={nowText(
                  of((u) => u.utilities[k] ?? null),
                  (v) => utilityLabel(v) ?? 'Unknown',
                )}
                choices={UTILITY}
                value={val(`u.${k}`)}
                onChange={set(`u.${k}`)}
              />
            ))}
          </fieldset>
          <fieldset className={styles.bulkGroup}>
            <legend className={styles.legend}>In the unit</legend>
            <Pick
              label="Laundry"
              now={nowText(
                of((u) => u.laundry),
                enumText,
              )}
              choices={LAUNDRY}
              value={val('laundry')}
              onChange={set('laundry')}
            />
            <Pick
              label="Dishwasher"
              now={nowText(
                of((u) => u.dishwasher),
                triText,
              )}
              choices={tri}
              value={val('dishwasher')}
              onChange={set('dishwasher')}
            />
            <Pick
              label="AC"
              now={nowText(
                of((u) => u.acType),
                enumText,
              )}
              choices={AC}
              value={val('acType')}
              onChange={set('acType')}
            />
            <Pick
              label="Heating"
              now={nowText(
                of((u) => u.heatingType),
                enumText,
              )}
              choices={HEATING}
              value={val('heatingType')}
              onChange={set('heatingType')}
            />
          </fieldset>
          <fieldset className={styles.bulkGroup}>
            <legend className={styles.legend}>Parking and storage</legend>
            <Pick
              label="Parking"
              now={nowText(
                of((u) => u.parking.type),
                enumText,
              )}
              choices={PARKING}
              value={val('parkingType')}
              onChange={set('parkingType')}
            />
            <NumberField
              label="Spaces included"
              now={nowText(
                of((u) => u.parking.spacesIncluded),
                (n) => (n === null ? 'Unknown' : String(n)),
              )}
              value={val('spaces')}
              onChange={set('spaces')}
            />
            <NumberField
              label="Extra space, per month"
              prefix="$"
              now={nowText(
                of((u) => u.parking.extraSpaceCost),
                (n) => (n === null ? 'Unknown' : `$${n}`),
              )}
              value={val('spaceCost')}
              onChange={set('spaceCost')}
            />
            <Pick
              label="Storage included"
              now={nowText(
                of((u) => u.storage.included),
                triText,
              )}
              choices={tri}
              value={val('storage')}
              onChange={set('storage')}
            />
            <NumberField
              label="Storage, per month"
              prefix="$"
              now={nowText(
                of((u) => u.storage.cost),
                (n) => (n === null ? 'Unknown' : `$${n}`),
              )}
              value={val('storageCost')}
              onChange={set('storageCost')}
            />
          </fieldset>
          <fieldset className={styles.bulkGroup}>
            <legend className={styles.legend}>Lease</legend>
            <Row label="Lease terms (months)">
              <input
                className={styles.input}
                value={val('lease')}
                data-changed={val('lease') !== LEAVE || undefined}
                placeholder={`Leave as is (${nowText(
                  of((u) => u.leaseTermsMonths),
                  (m) => (m === null ? 'Unknown' : m.length ? m.join(', ') : 'None'),
                )}); e.g. 12, 15`}
                onChange={(e) => set('lease')(e.target.value)}
              />
            </Row>
            <Row label="Available">
              <span className={styles.dateRow}>
                <input
                  className={styles.input}
                  type="date"
                  value={val('available') === UNKNOWN ? '' : val('available')}
                  data-changed={val('available') !== LEAVE || undefined}
                  onChange={(e) => set('available')(e.target.value)}
                  aria-describedby="bulk-available-now"
                />
                <span id="bulk-available-now" className={styles.hint}>
                  Now:{' '}
                  {nowText(
                    of((u) => u.availableDate),
                    (d) => d ?? 'Unknown',
                  )}
                </span>
              </span>
            </Row>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={val('available') === UNKNOWN}
                onChange={(e) => set('available')(e.target.checked ? UNKNOWN : LEAVE)}
              />
              Mark the available date unknown
            </label>
          </fieldset>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className={styles.foot}>
          <span className={styles.footNote} aria-live="polite">
            {changed
              ? `${changed} change${changed === 1 ? '' : 's'} to apply`
              : 'Nothing changed yet'}
          </span>
          <button type="button" className={styles.secondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={styles.primary} disabled={busy || !changed}>
            Apply to {unitsCount(rows.length)}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
