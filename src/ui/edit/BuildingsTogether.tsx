import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { updateBuildings } from '../../commands/forms';
import type { BuildingPatch } from '../../commands/forms';
import { db } from '../../db/db';
import { BUILDING_TYPE_LABELS, enumLabel } from '../../domain/format';
import { common } from '../../domain/triage';
import type { Common } from '../../domain/triage';
import { AMENITY_KEYS, BUILDING_TYPES } from '../../model';
import type { Building } from '../../model';
import type { BuildingRow } from '../../state/derive';
import { useUi } from '../../state/ui';
import { AMENITY_LABELS } from '../detail/text';
import triage from '../triage/triage.module.css';

/**
 * Edit together for buildings (Q23, M8): ⌘/Ctrl- or Shift-click buildings in the Buildings
 * view, then set their own facts at once: type, elevator, amenities, pets and policies,
 * management. Each field starts at "Leave as is" (what they have now, or "Mixed"); only
 * fields you change are written, all in one undo step.
 */

const buildingsCount = (n: number) => `${n} building${n === 1 ? '' : 's'}`;

export function BuildingSelectionBar({ rows }: { rows: BuildingRow[] }) {
  const clear = useUi((s) => s.clearPickedBuildings);
  const edit = useUi((s) => s.setEditingBuildings);
  if (!rows.length) return null;
  return (
    <section className={triage.selectionBar} aria-label="Selected buildings">
      <div className={triage.selectionHead}>
        <p className={triage.selectionCount} aria-live="polite">
          {buildingsCount(rows.length)} selected
        </p>
        <button type="button" className={triage.smallPrimary} onClick={() => edit(true)}>
          Edit together…
        </button>
        <button
          type="button"
          className={triage.smallButton}
          onClick={clear}
          title="Clear the selection (Esc)"
        >
          Clear
        </button>
      </div>
      <p className={triage.hint}>
        Set the buildings’ own facts at once: amenities, pets, policies. ⌘/Ctrl-click adds or
        removes a building; Shift-click selects a range.
      </p>
    </section>
  );
}

const LEAVE = '';
const UNKNOWN = '?';

interface Choice {
  value: string;
  label: string;
}

const TRI: Choice[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: UNKNOWN, label: 'Unknown' },
];

const nowText = <T,>(c: Common<T>, say: (v: T) => string) => (c.mixed ? 'Mixed' : say(c.value));
const triText = (v: boolean | null) => (v === null ? 'Unknown' : v ? 'Yes' : 'No');
const triValue = (v: string) => (v === UNKNOWN ? null : v === 'yes');

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
    <label className={triage.bulkRow}>
      <span className={triage.fieldLabel}>{label}</span>
      <select
        className={triage.select}
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
    </label>
  );
}

function MoneyRow({
  label,
  now,
  value,
  onChange,
}: {
  label: string;
  now: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className={triage.bulkRow}>
      <span className={triage.fieldLabel}>{label}</span>
      <span className={triage.numberWrap}>
        <span aria-hidden="true">$</span>
        <input
          className={triage.input}
          inputMode="numeric"
          value={value}
          data-changed={value !== LEAVE || undefined}
          placeholder={`Leave as is (${now}); ? for unknown`}
          onChange={(e) => onChange(e.target.value)}
        />
      </span>
    </label>
  );
}

/** "$35" → 35; "?" → null; blank → undefined (leave); unreadable → NaN. */
function parseAmount(text: string): number | null | undefined {
  const t = text.trim();
  if (!t) return undefined;
  if (t === UNKNOWN) return null;
  const n = Number(t.replace(/[$,\s]/g, ''));
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

const enumChoices = (values: readonly string[], label: (v: string) => string = enumLabel) => [
  ...values.map((v) => ({ value: v, label: label(v) })),
  { value: UNKNOWN, label: 'Unknown' },
];

const TYPES = enumChoices(
  BUILDING_TYPES,
  (t) => BUILDING_TYPE_LABELS[t as Building['buildingType'] & string],
);
const SMOKING = enumChoices(['not-allowed', 'designated-areas', 'allowed']);
const SUBLET = enumChoices(['allowed', 'with-approval', 'not-allowed']);

export function BuildingsTogetherDialog({
  rows,
  onClose,
}: {
  rows: BuildingRow[];
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string) => (v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const val = (k: string) => draft[k] ?? LEAVE;

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
  }, []);

  const bs = rows.map((r) => r.building);
  const of = <T,>(get: (b: Building) => T) => common(bs.map(get));
  const enumNow = (get: (b: Building) => string | null) =>
    nowText(of(get), (v) => (v === null ? 'Unknown' : enumLabel(v)));

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    const patch: BuildingPatch = {};
    const t = val;
    const enumOf = <T,>(k: string) => (t(k) === UNKNOWN ? null : (t(k) as T));
    if (t('type')) patch.buildingType = enumOf('type');
    if (t('elevator')) patch.elevator = triValue(t('elevator'));
    if (t('smoking')) patch.smoking = enumOf('smoking');
    if (t('sublet')) patch.subletPolicy = enumOf('sublet');
    const amenities: BuildingPatch['amenities'] = {};
    for (const k of AMENITY_KEYS) if (t(`a.${k}`)) amenities[k] = triValue(t(`a.${k}`));
    if (Object.keys(amenities).length) patch.amenities = amenities;
    const pets: BuildingPatch['pets'] = {};
    if (t('cats')) pets.cats = triValue(t('cats'));
    if (t('dogs')) pets.dogs = triValue(t('dogs'));
    for (const [k, label, field] of [
      ['petRent', 'Pet rent', 'monthlyRent'],
      ['petDeposit', 'Pet deposit', 'deposit'],
    ] as const) {
      const n = parseAmount(t(k));
      if (n === undefined) continue;
      if (Number.isNaN(n)) {
        setError(`${label}: enter whole dollars, or ? for unknown.`);
        return;
      }
      pets[field] = n;
    }
    if (Object.keys(pets).length) patch.pets = pets;
    if (t('mgmt').trim())
      patch.managementCompany = t('mgmt').trim() === UNKNOWN ? null : t('mgmt').trim();

    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await updateBuildings(
        db,
        bs.map((b) => b.id),
        patch,
      );
      onClose();
    } catch (err) {
      setError(`Couldn’t save. ${err instanceof Error ? err.message : ''}`.trim());
      setBusy(false);
    }
  }

  const changed = Object.values(draft).filter((v) => v.trim() !== LEAVE).length;
  return (
    <dialog
      ref={dialog}
      className={`${triage.dialog} ${triage.dialogWide}`}
      aria-labelledby="bulk-b-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <form className={triage.form} onSubmit={submit} noValidate>
        <header className={triage.head}>
          <h2 id="bulk-b-title" className={triage.title}>
            Edit {buildingsCount(rows.length)} together
          </h2>
        </header>
        <div className={triage.body}>
          <p className={triage.muted}>
            Only what you change is set, for every selected building. “Mixed” means they differ now.
          </p>
          <fieldset className={triage.bulkGroup}>
            <legend className={triage.legend}>Structure and management</legend>
            <Pick
              label="Building type"
              now={nowText(
                of((b) => b.buildingType),
                (v) => (v ? BUILDING_TYPE_LABELS[v] : 'Unknown'),
              )}
              choices={TYPES}
              value={val('type')}
              onChange={set('type')}
            />
            <Pick
              label="Elevator"
              now={nowText(
                of((b) => b.elevator),
                triText,
              )}
              choices={TRI}
              value={val('elevator')}
              onChange={set('elevator')}
            />
            <label className={triage.bulkRow}>
              <span className={triage.fieldLabel}>Management company</span>
              <input
                className={triage.input}
                value={val('mgmt')}
                data-changed={val('mgmt').trim() !== LEAVE || undefined}
                placeholder={`Leave as is (${nowText(
                  of((b) => b.managementCompany),
                  (v) => v ?? 'Unknown',
                )}); ? for unknown`}
                onChange={(e) => set('mgmt')(e.target.value)}
              />
            </label>
          </fieldset>
          <fieldset className={triage.bulkGroup}>
            <legend className={triage.legend}>Amenities</legend>
            {AMENITY_KEYS.map((k) => (
              <Pick
                key={k}
                label={AMENITY_LABELS[k]}
                now={nowText(
                  of((b) => b.amenities[k] ?? null),
                  triText,
                )}
                choices={TRI}
                value={val(`a.${k}`)}
                onChange={set(`a.${k}`)}
              />
            ))}
          </fieldset>
          <fieldset className={triage.bulkGroup}>
            <legend className={triage.legend}>Pets and policies</legend>
            <Pick
              label="Cats allowed"
              now={nowText(
                of((b) => b.pets.cats),
                triText,
              )}
              choices={TRI}
              value={val('cats')}
              onChange={set('cats')}
            />
            <Pick
              label="Dogs allowed"
              now={nowText(
                of((b) => b.pets.dogs),
                triText,
              )}
              choices={TRI}
              value={val('dogs')}
              onChange={set('dogs')}
            />
            <MoneyRow
              label="Pet rent, per month"
              now={nowText(
                of((b) => b.pets.monthlyRent),
                (n) => (n === null ? 'Unknown' : `$${n}`),
              )}
              value={val('petRent')}
              onChange={set('petRent')}
            />
            <MoneyRow
              label="Pet deposit"
              now={nowText(
                of((b) => b.pets.deposit),
                (n) => (n === null ? 'Unknown' : `$${n}`),
              )}
              value={val('petDeposit')}
              onChange={set('petDeposit')}
            />
            <Pick
              label="Smoking"
              now={enumNow((b) => b.smoking)}
              choices={SMOKING}
              value={val('smoking')}
              onChange={set('smoking')}
            />
            <Pick
              label="Subletting"
              now={enumNow((b) => b.subletPolicy)}
              choices={SUBLET}
              value={val('sublet')}
              onChange={set('sublet')}
            />
          </fieldset>
          {error && (
            <p className={triage.error} role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className={triage.foot}>
          <span className={triage.footNote} aria-live="polite">
            {changed
              ? `${changed} change${changed === 1 ? '' : 's'} to apply`
              : 'Nothing changed yet'}
          </span>
          <button type="button" className={triage.secondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={triage.primary} disabled={busy || !changed}>
            Apply to {buildingsCount(rows.length)}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
