import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { saveUnitForm } from '../../commands/forms';
import { db } from '../../db/db';
import { completeness, CHECK_BY_KEY, essentials, UNIT_SECTIONS } from '../../domain/completeness';
import { copyDetails, unitFromSource } from '../../domain/copyFrom';
import { profileEstimate } from '../../domain/cost';
import {
  BUILDING_TYPE_LABELS,
  buildingName,
  enumLabel,
  localDate,
  money,
  num,
  shortDate,
  SITE_LABELS,
  STATUS_LABELS,
  UNIT_TYPE_LABELS,
  UTILITY_LABELS,
  unitFullName,
  unitTitle,
} from '../../domain/format';
import { parseFloor, parseMoney, parseStep, parseWhole } from '../../domain/input';
import { feeProblem, reconcileRent } from '../../domain/unitForm';
import { LABEL_COLORS, UNIT_STATUSES, UNIT_TYPES, UTILITY_KEYS } from '../../model';
import type { Building, FieldSource, Listing, Settings, Unit, UnitStatus } from '../../model';
import { newListing, newUnit } from '../../model/factories';
import type { Dataset } from '../../state/derive';
import { useDataset } from '../../state/useDataset';
import { useUi } from '../../state/ui';
import {
  ExposureField,
  FeesEditor,
  LeaseTermsField,
  LinksEditor,
  RentByTermEditor,
  SpecialField,
  UtilityField,
  WindowsEditor,
} from './editors';
import {
  CheckField,
  DateField,
  FieldRow,
  FormSection,
  NumberField,
  SelectField,
  TextField,
  TriField,
} from './fields';
import type { Option } from './fields';
import { FormFrame } from './FormFrame';
import { focusRow, rowOf } from './formState';
import { ListingsEditor } from './ListingsEditor';
import { CompletenessCard } from './Summary';
import styles from './edit.module.css';

/**
 * The full unit form (#/unit/:id/edit; new units at #/new-unit?building=…&from=…;
 * DESIGN.md §4.3, PLAN.md §4.1). Every §3 unit field, its listings and their price history,
 * as one draft that Save writes in one undoable step.
 */

const opts = <T extends string>(values: readonly T[], label: (v: T) => string = enumLabel) =>
  values.map((v) => ({ value: v, label: label(v) })) as Option<T>[];

const TYPE_OPTIONS = opts(UNIT_TYPES, (t) => UNIT_TYPE_LABELS[t]);
const LAUNDRY = opts(['in-unit', 'in-building', 'none'] as const);
const AC = opts(['central', 'mini-split', 'wall-unit', 'window-unit', 'none', 'other'] as const);
const HEATING = opts([
  'forced-air',
  'radiator',
  'baseboard',
  'radiant-floor',
  'heat-pump',
  'other',
] as const);
const FURNISHED = opts(['no', 'partial', 'full'] as const, (v) =>
  v === 'no' ? 'Unfurnished' : v === 'partial' ? 'Partly furnished' : 'Furnished',
);
const PARKING = opts(['garage', 'surface', 'street', 'none'] as const, (v) =>
  v === 'surface' ? 'Surface lot' : v === 'none' ? 'No parking' : enumLabel(v),
);

const money$ = (text: string) => parseMoney(text);
const sqftParse = (t: string) => parseWhole(t, { max: 20000, what: 'square feet' });
const bedsParse = (t: string) => parseWhole(t, { max: 20, what: 'a number of bedrooms' });
const bathsParse = (t: string) => parseStep(t, 0.5, { max: 20, what: 'bathrooms' });
const spacesParse = (t: string) => parseWhole(t, { max: 10, what: 'a number of spaces' });
const monthsParse = (t: string) => parseWhole(t, { min: 1, max: 60, what: 'months' });

const VIA_LABELS: Record<FieldSource['via'], string> = {
  manual: 'By hand',
  paste: 'Pasted listing text',
  ai: 'AI research',
  url: 'From the link',
};

/** Where the form goes after Save or Cancel: back where you came from, or to the unit. */
function useLeave(fallback: string) {
  const navigate = useNavigate();
  const location = useLocation();
  return (to?: string) => {
    if (to) navigate(to, { replace: true });
    else if ((location.state as { inApp?: boolean } | null)?.inApp) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}

export function UnitFormPage() {
  const { unitId } = useParams();
  const [params] = useSearchParams();
  const data = useDataset();
  const today = localDate();
  if (!data) return <div className={styles.loading} aria-busy="true" />;

  if (unitId) {
    const row = data.unitById.get(unitId);
    if (!row || !row.building) return <Missing what="unit" />;
    return (
      <UnitForm
        key={unitId}
        data={data}
        initial={row.unit}
        initialListings={row.listings}
        building={row.building}
        isNew={false}
        today={today}
        focusField={params.get('field')}
      />
    );
  }
  // A new unit: in a building, made from another unit or plan (or blank).
  const source = params.get('from') ? data.unitById.get(params.get('from')!) : undefined;
  const buildingId = source?.unit.buildingId ?? params.get('building');
  const building = buildingId ? data.buildingById.get(buildingId)?.building : undefined;
  if (!building) return <Missing what="building" />;
  return (
    <NewUnit
      key={`${building.id}:${source?.unit.id ?? ''}`}
      data={data}
      building={building}
      source={source?.unit}
      today={today}
    />
  );
}

function NewUnit({
  data,
  building,
  source,
  today,
}: {
  data: Dataset;
  building: Building;
  source: Unit | undefined;
  today: string;
}) {
  const [initial] = useState(() =>
    source ? unitFromSource(source) : newUnit({ buildingId: building.id, addedVia: 'form' }),
  );
  return (
    <UnitForm
      data={data}
      initial={initial}
      initialListings={[]}
      building={building}
      isNew
      source={source}
      today={today}
      focusField="unit.unitNumber"
    />
  );
}

function Missing({ what }: { what: 'unit' | 'building' }) {
  return (
    <div className={styles.missingPage}>
      <h1 className={styles.title}>This {what} isn’t in your list</h1>
      <p className={styles.lead}>It may have been deleted, or the link is from another browser.</p>
      <Link to="/">Back to the app</Link>
    </div>
  );
}

function UnitForm({
  data,
  initial,
  initialListings,
  building: storedBuilding,
  isNew,
  source,
  today,
  focusField,
}: {
  data: Dataset;
  initial: Unit;
  initialListings: Listing[];
  building: Building;
  isNew: boolean;
  source?: Unit;
  today: string;
  focusField?: string | null;
}) {
  const [draft, setDraft] = useState<Unit>(initial);
  const [listings, setListings] = useState<Listing[]>(initialListings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(
    source
      ? `Started from ${unitFullName(source, storedBuilding)}: specs, features, fees and utilities copied. Unit number, floor, rent, windows, ratings and notes are this unit’s own.`
      : null,
  );
  const [copyFrom, setCopyFrom] = useState('');
  const leave = useLeave(isNew ? `/building/${storedBuilding.id}` : `/unit/${initial.id}`);
  const settings = data.settings;
  const set =
    <K extends keyof Unit>(k: K) =>
    (v: Unit[K]) =>
      setDraft((d) => ({ ...d, [k]: v }));

  const building = data.buildingById.get(draft.buildingId)?.building ?? storedBuilding;
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(initial) ||
    JSON.stringify(listings) !== JSON.stringify(initialListings);

  const target = { unit: draft, building };
  const unitDone = completeness(target, 'unit');
  const ess = essentials(target, settings.essentialFields);
  const essSplit = {
    ...ess,
    onPage: ess.missing.filter((c) => c.owner === 'unit'),
    elsewhere: ess.missing.filter((c) => c.owner === 'building'),
  };
  const sections = UNIT_SECTIONS.map((s) => ({
    id: s.id,
    label: s.label,
    status: unitDone.sections.get(s.id)?.status,
  }));

  // What saving will do to the rent and the price history.
  const preview = useMemo(
    () =>
      reconcileRent({
        stored: isNew ? null : { unit: initial, listings: initialListings },
        draft: { unit: draft, listings },
        today,
        newListing: () => newListing({ unitId: draft.id, firstSeen: today }),
      }).effect,
    [draft, listings, initial, initialListings, isNew, today],
  );
  const rentHint =
    preview?.kind === 'observe'
      ? preview.isNew
        ? `Saving records ${money(preview.rent)} as today’s price on a new listing without a link.`
        : `Saving records ${money(preview.rent)} as today’s price on the ${
            SITE_LABELS[listings.find((l) => l.id === preview.listingId)?.site ?? 'other']
          } listing.`
      : preview?.kind === 'follow'
        ? `Saving sets the rent to ${money(preview.rent)}, the newest price in the listings.`
        : 'The rent follows the newest price you’ve seen; change either one.';

  const others = data.units
    .filter((r) => r.unit.buildingId === draft.buildingId && r.unit.id !== draft.id)
    .sort((a, b) => Number(b.unit.isFloorPlanOnly) - Number(a.unit.isFloorPlanOnly));
  const planOnly = draft.isFloorPlanOnly;
  const notForPlans = planOnly ? 'Depends on the unit (floor plan only).' : undefined;
  const paidParking = draft.parking.type === 'garage' || draft.parking.type === 'surface';
  const parkingNA =
    draft.parking.type === 'street' || draft.parking.type === 'none'
      ? 'Not for street parking or none.'
      : undefined;
  const fromWindows = [
    ...new Set((draft.windows ?? []).map((w) => w.direction).filter((d) => d !== null)),
  ];

  async function onSave(errors: ReadonlyMap<string, string>, root: HTMLElement) {
    const problems = new Map(errors);
    const fees = feeProblem(draft.recurringFees);
    if (fees) problems.set('unit.recurringFees', fees);
    if (problems.size) {
      setMessage(
        `Fix ${problems.size === 1 ? 'one field' : `${problems.size} fields`} first: ${[...problems.values()][0]}`,
      );
      const first =
        root.querySelector<HTMLElement>('[data-invalid]') ?? rowOf(root, [...problems.keys()][0]!);
      if (first) focusRow(first);
      return;
    }
    setSaving(true);
    try {
      const r = await saveUnitForm(db, { unit: draft, listings, today, isNew });
      if (!r.changed) useUi.getState().showNotice('Nothing changed.');
      leave(isNew ? `/unit/${r.unit.id}` : undefined);
    } catch (e) {
      setSaving(false);
      setMessage(`Couldn’t save. ${e instanceof Error ? e.message : ''}`.trim());
    }
  }

  const title = isNew
    ? `New unit at ${buildingName(building)}`
    : `${buildingName(building)} · ${unitTitle(draft, building)}`;

  return (
    <FormFrame
      title={title}
      subtitle={building.address.formatted}
      sections={sections}
      dirty={dirty}
      saving={saving}
      onSave={onSave}
      onCancel={() => leave()}
      focusField={focusField}
      saveLabel={isNew ? 'Add unit' : 'Save'}
      message={message}
      aside={
        <>
          <section className={styles.card} aria-labelledby="bldg-title">
            <h2 className={styles.cardTitle} id="bldg-title">
              Building
            </h2>
            <p className={styles.cardMain}>{buildingName(building)}</p>
            <p className={styles.small}>
              {[
                building.buildingType && BUILDING_TYPE_LABELS[building.buildingType],
                building.floors !== null && `${num(building.floors)} floors`,
                building.yearBuilt !== null && `built ${building.yearBuilt}`,
              ]
                .filter(Boolean)
                .join(', ') || 'Not much known yet.'}
            </p>
            <Link to={`/building/${building.id}/edit`} state={{ inApp: true }}>
              Edit building
            </Link>
          </section>
          <CompletenessCard c={unitDone} essentials={essSplit} />
        </>
      }
    >
      <FormSection id="identity" title="Identity">
        <FieldRow
          path="unit.buildingId"
          label="Building"
          empty={false}
          controlId="unit-building"
          noUnknown
        >
          <select
            id="unit-building"
            className={styles.select}
            value={draft.buildingId}
            onChange={(e) => set('buildingId')(e.target.value)}
          >
            {data.buildings
              .map((b) => b.building)
              .sort((a, b) => buildingName(a).localeCompare(buildingName(b)))
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {buildingName(b)} ({b.address.line1})
                </option>
              ))}
          </select>
        </FieldRow>
        <TextField
          path="unit.unitNumber"
          label="Unit number"
          value={draft.unitNumber}
          onChange={(v) =>
            setDraft((d) => ({
              ...d,
              unitNumber: v,
              isFloorPlanOnly: v ? false : d.isFloorPlanOnly,
            }))
          }
          placeholder="1504"
        />
        <TextField
          path="unit.floorPlanName"
          label="Floor plan"
          value={draft.floorPlanName}
          onChange={set('floorPlanName')}
          placeholder="Plan C"
        />
        <CheckField
          label="Floor plan only (no specific unit yet)"
          checked={draft.isFloorPlanOnly}
          disabled={!!draft.unitNumber}
          onChange={set('isFloorPlanOnly')}
          hint={
            draft.unitNumber
              ? 'A unit number makes it a specific unit.'
              : 'For “Plan C, units vary”: floor, exposure and windows wait for a real unit.'
          }
        />
        {others.length > 0 && (
          <div className={styles.copyRow}>
            <label className={styles.inline} htmlFor="copy-from">
              Copy details from
            </label>
            <select
              id="copy-from"
              className={styles.select}
              value={copyFrom}
              onChange={(e) => setCopyFrom(e.target.value)}
            >
              <option value="">Choose a unit or plan…</option>
              {others.map((r) => (
                <option key={r.unit.id} value={r.unit.id}>
                  {unitTitle(r.unit, building)}
                  {r.unit.isFloorPlanOnly ? ' (floor plan)' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={styles.secondary}
              disabled={!copyFrom}
              onClick={() => {
                const src = data.unitById.get(copyFrom)?.unit;
                if (!src) return;
                const r = copyDetails(src, draft);
                setDraft(r.unit);
                const name = unitTitle(src, building);
                setMessage(
                  r.copied.length === 0
                    ? `Nothing to copy from ${name}: it knows nothing this unit doesn’t.`
                    : `Copied ${r.copied.length} detail${r.copied.length === 1 ? '' : 's'} from ${name}${
                        r.kept.length
                          ? `; kept ${r.kept.length} you already had (${r.kept.join(', ')})`
                          : ''
                      }. Save to keep them.`,
                );
              }}
            >
              Copy
            </button>
            <p className={styles.hint}>
              Fills only what this unit doesn’t know: specs, features, fees and utilities. Never its
              number, floor, rent, windows, ratings or notes.
            </p>
          </div>
        )}
      </FormSection>

      <FormSection id="specs" title="Specs">
        <SelectField
          path="unit.type"
          label="Unit type"
          value={draft.type}
          options={TYPE_OPTIONS}
          onChange={set('type')}
        />
        <NumberField
          path="unit.bedrooms"
          label="Bedrooms"
          value={draft.bedrooms}
          onChange={set('bedrooms')}
          parse={bedsParse}
          hint="0 for a studio."
        />
        <NumberField
          path="unit.bathrooms"
          label="Bathrooms"
          value={draft.bathrooms}
          onChange={set('bathrooms')}
          parse={bathsParse}
          hint="Halves allowed: 1.5."
        />
        <NumberField
          path="unit.squareFeet"
          label="Square feet"
          value={draft.squareFeet}
          onChange={set('squareFeet')}
          parse={sqftParse}
          suffix="ft²"
          size="medium"
        />
        <NumberField
          path="unit.floor"
          label="Floor"
          value={draft.floor}
          onChange={set('floor')}
          parse={parseFloor}
          notApplicable={notForPlans}
          hint={
            building.floors !== null ? `The building has ${building.floors} floors.` : undefined
          }
        />
        <ExposureField
          path="unit.exposure"
          value={draft.exposure}
          onChange={set('exposure')}
          fromWindows={fromWindows}
          notApplicable={notForPlans}
        />
        <TextField
          path="unit.viewNotes"
          label="View"
          value={draft.viewNotes}
          onChange={set('viewNotes')}
          multiline
          placeholder="What you see from the windows"
        />
        <TextField
          path="unit.layoutNotes"
          label="Layout"
          value={draft.layoutNotes}
          onChange={set('layoutNotes')}
          multiline
          placeholder="Open kitchen, den, walk-in closet…"
        />
      </FormSection>

      <FormSection id="windows" title="Windows">
        <WindowsEditor
          path="unit.windows"
          value={draft.windows}
          onChange={set('windows')}
          notApplicable={notForPlans}
        />
      </FormSection>

      <FormSection id="features" title="Features">
        <SelectField
          path="unit.laundry"
          label="Laundry"
          value={draft.laundry}
          options={LAUNDRY}
          onChange={set('laundry')}
        />
        <TriField
          path="unit.dishwasher"
          label="Dishwasher"
          value={draft.dishwasher}
          onChange={set('dishwasher')}
        />
        <SelectField
          path="unit.acType"
          label="Air conditioning"
          value={draft.acType}
          options={AC}
          onChange={set('acType')}
        />
        <SelectField
          path="unit.heatingType"
          label="Heating"
          value={draft.heatingType}
          options={HEATING}
          onChange={set('heatingType')}
        />
        <TriField
          path="unit.balcony"
          label="Balcony"
          value={draft.balcony}
          onChange={set('balcony')}
        />
        <TriField
          path="unit.fireplace"
          label="Fireplace"
          value={draft.fireplace}
          onChange={set('fireplace')}
        />
        <TextField
          path="unit.flooring"
          label="Flooring"
          value={draft.flooring}
          onChange={set('flooring')}
          placeholder="Hardwood, carpet in bedrooms"
        />
        <SelectField
          path="unit.furnished"
          label="Furnished"
          value={draft.furnished}
          options={FURNISHED}
          onChange={set('furnished')}
        />
      </FormSection>

      <FormSection id="lease" title="Lease">
        <NumberField
          path="unit.rent"
          label="Rent"
          value={draft.rent}
          onChange={set('rent')}
          parse={money$}
          prefix="$"
          suffix="/mo"
          size="medium"
          hint={rentHint}
        />
        <CheckField
          label="Rent is a starting price (“from $…”, for floor plans)"
          checked={draft.rentIsFrom}
          onChange={set('rentIsFrom')}
        />
        <DateField
          path="unit.availableDate"
          label="Available"
          value={draft.availableDate}
          onChange={set('availableDate')}
        />
        <LeaseTermsField
          path="unit.leaseTermsMonths"
          value={draft.leaseTermsMonths}
          onChange={set('leaseTermsMonths')}
        />
        <NumberField
          path="unit.deposit"
          label="Deposit"
          value={draft.deposit}
          onChange={set('deposit')}
          parse={money$}
          prefix="$"
          size="medium"
        />
        <NumberField
          path="unit.applicationFee"
          label="Application fee"
          value={draft.applicationFee}
          onChange={set('applicationFee')}
          parse={money$}
          prefix="$"
        />
        <NumberField
          path="unit.adminFee"
          label="Admin fee"
          value={draft.adminFee}
          onChange={set('adminFee')}
          parse={money$}
          prefix="$"
        />
        <RentByTermEditor
          path="unit.rentByTerm"
          value={draft.rentByTerm}
          onChange={set('rentByTerm')}
        />
        <SpecialField
          path="unit.moveInSpecial"
          value={draft.moveInSpecial}
          onChange={set('moveInSpecial')}
        />
        <PlannedLease
          value={draft.plannedLeaseMonths}
          onChange={set('plannedLeaseMonths')}
          settings={settings}
        />
      </FormSection>

      <FormSection
        id="costs"
        title="Costs"
        lead="Who pays each utility. “You pay” takes your estimate, or your cost profile’s when it’s blank."
      >
        {UTILITY_KEYS.map((k) => (
          <UtilityField
            key={k}
            path={`unit.utilities.${k}`}
            label={UTILITY_LABELS[k]}
            value={draft.utilities[k] ?? null}
            onChange={(v) => setDraft((d) => ({ ...d, utilities: { ...d.utilities, [k]: v } }))}
            profileEstimate={profileEstimate(settings.costProfile, k, draft)}
          />
        ))}
        <FeesEditor
          path="unit.recurringFees"
          value={draft.recurringFees}
          onChange={set('recurringFees')}
        />
      </FormSection>

      <FormSection id="parking" title="Parking and storage">
        <SelectField
          path="unit.parking.type"
          label="Parking"
          value={draft.parking.type}
          options={PARKING}
          onChange={(v) => setDraft((d) => ({ ...d, parking: { ...d.parking, type: v } }))}
        />
        <NumberField
          path="unit.parking.spacesIncluded"
          label="Spaces included"
          value={draft.parking.spacesIncluded}
          onChange={(v) =>
            setDraft((d) => ({ ...d, parking: { ...d.parking, spacesIncluded: v } }))
          }
          parse={spacesParse}
          notApplicable={parkingNA}
          hint={paidParking ? 'In the rent; 0 if every space costs extra.' : undefined}
        />
        <NumberField
          path="unit.parking.extraSpaceCost"
          label="Extra space"
          value={draft.parking.extraSpaceCost}
          onChange={(v) =>
            setDraft((d) => ({ ...d, parking: { ...d.parking, extraSpaceCost: v } }))
          }
          parse={money$}
          prefix="$"
          suffix="/mo"
          notApplicable={parkingNA}
        />
        <TriField
          path="unit.storage.included"
          label="Storage included"
          value={draft.storage.included}
          onChange={(v) => setDraft((d) => ({ ...d, storage: { ...d.storage, included: v } }))}
        />
        <NumberField
          path="unit.storage.cost"
          label="Storage cost"
          value={draft.storage.cost}
          onChange={(v) => setDraft((d) => ({ ...d, storage: { ...d.storage, cost: v } }))}
          parse={money$}
          prefix="$"
          suffix="/mo"
          notApplicable={draft.storage.included === true ? 'Included in the rent.' : undefined}
        />
      </FormSection>

      <FormSection
        id="review"
        title="Review"
        lead="Shared with everyone. Your own stars, flag and label are set from the unit’s panel or with the keys."
      >
        <FieldRow path="unit.status" label="Status" empty={false} controlId="unit-status" noUnknown>
          <select
            id="unit-status"
            className={styles.select}
            value={draft.status}
            onChange={(e) => set('status')(e.target.value as UnitStatus)}
          >
            {UNIT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </FieldRow>
        <SharedLabel value={draft.colorLabel} onChange={set('colorLabel')} settings={settings} />
      </FormSection>

      <FormSection
        id="listings"
        title="Listings"
        lead="Where the unit is advertised and every price you’ve seen. The rent follows the newest price."
      >
        <ListingsEditor
          unitId={draft.id}
          listings={listings}
          onChange={setListings}
          today={today}
        />
      </FormSection>

      <FormSection
        id="links"
        title="Links"
        lead="Other links: floor plan, virtual tour, reviews. Listing links go under Listings."
      >
        <LinksEditor path="unit.links" value={draft.links} onChange={set('links')} />
      </FormSection>

      <FormSection
        id="sources"
        title="Sources"
        lead="Where pasted and researched values came from. A value you change here by hand loses its source when you save."
      >
        <Sources
          sources={draft.fieldSources}
          today={today}
          onRemove={(i) => set('fieldSources')(draft.fieldSources.filter((_, j) => j !== i))}
        />
      </FormSection>

      <FormSection id="photos" title="Photos">
        <p className={styles.lead}>
          Photos and floor plan images arrive with the photo archive in M12.
        </p>
      </FormSection>
    </FormFrame>
  );
}

function PlannedLease({
  value,
  onChange,
  settings,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  settings: Settings;
}) {
  return (
    <NumberField
      path="unit.plannedLeaseMonths"
      label="Lease you’d sign"
      value={value}
      onChange={onChange}
      parse={monthsParse}
      suffix="months"
      size="medium"
      hint={`Blank uses your default, ${settings.costProfile.defaultLeaseMonths} months. Used for the cost spread in M9.`}
    />
  );
}

function SharedLabel({
  value,
  onChange,
  settings,
}: {
  value: Unit['colorLabel'];
  onChange: (v: Unit['colorLabel']) => void;
  settings: Settings;
}) {
  return (
    <FieldRow
      path="unit.colorLabel"
      label="Shared label"
      empty={false}
      labelId="shared-label"
      noUnknown
    >
      <div className={styles.swatches} role="radiogroup" aria-labelledby="shared-label">
        {LABEL_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            className={styles.swatch}
            style={{ '--c': `var(--lb-${c})` } as CSSProperties}
            title={settings.labelNames[c]}
            aria-label={settings.labelNames[c]}
            onClick={() => onChange(value === c ? null : c)}
          />
        ))}
        <span className={styles.small}>{value ? settings.labelNames[value] : 'None'}</span>
      </div>
    </FieldRow>
  );
}

function Sources({
  sources,
  today,
  onRemove,
}: {
  sources: FieldSource[];
  today: string;
  onRemove: (i: number) => void;
}) {
  if (!sources.length) return <p className={styles.lead}>No sources recorded.</p>;
  return (
    <ul className={styles.sources}>
      {sources.map((s, i) => {
        const label =
          CHECK_BY_KEY.get(s.field)?.label ??
          enumLabel(
            s.field
              .split('.')
              .pop()!
              .replace(/([A-Z])/g, '-$1')
              .toLowerCase(),
          );
        return (
          <li key={`${s.field}-${i}`}>
            <span>
              <b>{label}</b>
              {s.field.startsWith('building.') && ' (building)'} · {VIA_LABELS[s.via]},{' '}
              {shortDate(s.seen, today)}
              {s.url && /^https?:\/\//.test(s.url) && (
                <>
                  {' · '}
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    {new URL(s.url).hostname.replace(/^www\./, '')}
                    <span className={styles.visuallyHidden}> (opens in a new tab)</span>
                  </a>
                </>
              )}
            </span>
            <button
              type="button"
              className={styles.removeBtn}
              aria-label={`Remove the source of ${label}`}
              onClick={() => onRemove(i)}
            >
              ✕
            </button>
          </li>
        );
      })}
    </ul>
  );
}
