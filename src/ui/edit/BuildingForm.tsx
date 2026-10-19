import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { saveBuildingForm } from '../../commands/forms';
import { db } from '../../db/db';
import { makeAddress } from '../../domain/address';
import { BUILDING_SECTIONS, completeness } from '../../domain/completeness';
import {
  BUILDING_TYPE_LABELS,
  buildingName,
  enumLabel,
  rentLabel,
  unitTitle,
} from '../../domain/format';
import { parseMoney, parseUrl, parseWhole, parseYear } from '../../domain/input';
import { AMENITY_KEYS, BUILDING_TYPES } from '../../model';
import type { Building } from '../../model';
import type { BuildingRow } from '../../state/derive';
import { useDataset } from '../../state/useDataset';
import { useUi } from '../../state/ui';
import { AMENITY_LABELS } from '../detail/text';
import { LinksEditor } from './editors';
import { FieldRow, FormSection, NumberField, SelectField, TextField, TriField } from './fields';
import type { Option } from './fields';
import { FormFrame } from './FormFrame';
import { focusRow, rowOf, useFormApi } from './formState';
import { CompletenessCard } from './Summary';
import styles from './edit.module.css';

/**
 * The building form (#/building/:id/edit; DESIGN.md §4.3 "same frame with its own
 * sections"): identity and contact, structure, amenities, policies, neighborhood, notes and
 * links. Building facts are filled once here and every unit in the building shows them.
 */

const TYPES: Option<Building['buildingType'] & string>[] = BUILDING_TYPES.map((t) => ({
  value: t,
  label: BUILDING_TYPE_LABELS[t],
}));
const SMOKING = (['not-allowed', 'designated-areas', 'allowed'] as const).map((v) => ({
  value: v,
  label: v === 'not-allowed' ? 'Not allowed' : v === 'allowed' ? 'Allowed' : 'Designated areas',
}));
const SUBLET = (['allowed', 'with-approval', 'not-allowed'] as const).map((v) => ({
  value: v,
  label: enumLabel(v),
}));

const yearParse = (t: string) => parseYear(t);
const floorsParse = (t: string) => parseWhole(t, { min: 1, max: 200, what: 'a number of floors' });
const unitsParse = (t: string) => parseWhole(t, { min: 1, max: 5000, what: 'a number of units' });

export function BuildingFormPage() {
  const { buildingId } = useParams();
  const [params] = useSearchParams();
  const data = useDataset();
  if (!data) return <div className={styles.loading} aria-busy="true" />;
  const row = buildingId ? data.buildingById.get(buildingId) : undefined;
  if (!row)
    return (
      <div className={styles.missingPage}>
        <h1 className={styles.title}>This building isn’t in your list</h1>
        <p className={styles.lead}>
          It may have been deleted, or the link is from another browser.
        </p>
        <Link to="/">Back to the app</Link>
      </div>
    );
  return <BuildingForm key={row.building.id} row={row} focusField={params.get('field')} />;
}

function BuildingForm({ row, focusField }: { row: BuildingRow; focusField: string | null }) {
  const initial = row.building;
  const [draft, setDraft] = useState<Building>(initial);
  const [address, setAddress] = useState({
    line1: initial.address.line1,
    city: initial.address.city ?? '',
    zip: initial.address.zip ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const leave = () => {
    if ((location.state as { inApp?: boolean } | null)?.inApp) navigate(-1);
    else navigate(`/building/${initial.id}`, { replace: true });
  };
  const set =
    <K extends keyof Building>(k: K) =>
    (v: Building[K]) =>
      setDraft((d) => ({ ...d, [k]: v }));
  const setPets =
    <K extends keyof Building['pets']>(k: K) =>
    (v: Building['pets'][K]) =>
      setDraft((d) => ({ ...d, pets: { ...d.pets, [k]: v } }));

  const done = completeness({ building: draft }, 'building');
  const sections = BUILDING_SECTIONS.map((s) => ({
    id: s.id,
    label: s.label,
    status: done.sections.get(s.id)?.status,
  }));
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const petsAllowed = draft.pets.cats === true || draft.pets.dogs === true;

  const setAddressPart = (part: keyof typeof address, value: string) => {
    const next = { ...address, [part]: value };
    setAddress(next);
    if (!next.line1.trim()) return; // the street address can't be empty; saving says so
    const made = makeAddress(
      next.line1,
      next.city.trim() || null,
      initial.address.state,
      next.zip.trim() || null,
    );
    setDraft((d) => ({ ...d, address: made }));
  };

  async function onSave(errors: ReadonlyMap<string, string>, root: HTMLElement) {
    const problems = new Map(errors);
    if (!address.line1.trim()) problems.set('building.address', 'Enter the street address.');
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
      const r = await saveBuildingForm(db, withSchemes(draft));
      if (!r.changed) useUi.getState().showNotice('Nothing changed.');
      leave();
    } catch (e) {
      setSaving(false);
      setMessage(`Couldn’t save. ${e instanceof Error ? e.message : ''}`.trim());
    }
  }

  return (
    <FormFrame
      title={`${buildingName(draft)} · building`}
      subtitle={draft.address.formatted}
      sections={sections}
      dirty={dirty}
      saving={saving}
      onSave={onSave}
      onCancel={leave}
      focusField={focusField}
      message={message}
      aside={
        <>
          <CompletenessCard c={done} />
          <section className={styles.card} aria-labelledby="units-title">
            <h2 className={styles.cardTitle} id="units-title">
              Your units here
            </h2>
            {row.units.length === 0 ? (
              <p className={styles.small}>None yet.</p>
            ) : (
              <ul className={styles.unitList}>
                {row.units.map((u) => (
                  <li key={u.unit.id}>
                    <Link to={`/unit/${u.unit.id}/edit`} state={{ inApp: true }}>
                      {unitTitle(u.unit, initial)}
                    </Link>
                    <span className={styles.small}> {rentLabel(u.unit) ?? 'rent unknown'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      }
    >
      <FormSection id="identity" title="Identity">
        <TextField
          path="building.name"
          label="Name"
          value={draft.name}
          onChange={set('name')}
          placeholder="Riverlight"
        />
        <TextField
          path="building.complexName"
          label="Complex"
          value={draft.complexName}
          onChange={set('complexName')}
          hint="When several buildings share one name."
        />
        <FieldRow
          path="building.address"
          label="Street address"
          empty={false}
          controlId="b-line1"
          noUnknown
          hint="Moving the pin is separate: use Place on map from the building’s panel."
        >
          <input
            id="b-line1"
            className={`${styles.input} ${styles.grow}`}
            value={address.line1}
            autoComplete="off"
            onChange={(e) => setAddressPart('line1', e.target.value)}
          />
        </FieldRow>
        <FieldRow
          path="building.address.city"
          label="City and ZIP"
          empty={false}
          controlId="b-city"
          noUnknown
        >
          <div className={styles.listRow}>
            <input
              id="b-city"
              className={styles.input}
              value={address.city}
              placeholder="Minneapolis"
              onChange={(e) => setAddressPart('city', e.target.value)}
            />
            <input
              className={styles.inputShort}
              aria-label="ZIP code"
              value={address.zip}
              inputMode="numeric"
              placeholder="55401"
              onChange={(e) => setAddressPart('zip', e.target.value)}
            />
          </div>
        </FieldRow>
        <UrlField
          path="building.website"
          label="Website"
          value={draft.website}
          onChange={set('website')}
        />
        <UrlField
          path="building.availabilityUrl"
          label="Availability page"
          value={draft.availabilityUrl}
          onChange={set('availabilityUrl')}
          hint="The page that lists what’s for rent now."
        />
        <TextField
          path="building.managementCompany"
          label="Management company"
          value={draft.managementCompany}
          onChange={set('managementCompany')}
        />
        <TextField
          path="building.phone"
          label="Phone"
          type="tel"
          value={draft.phone}
          onChange={set('phone')}
        />
        <TextField
          path="building.email"
          label="Email"
          type="email"
          value={draft.email}
          onChange={set('email')}
        />
      </FormSection>

      <FormSection id="structure" title="Structure">
        <SelectField
          path="building.buildingType"
          label="Building type"
          value={draft.buildingType}
          options={TYPES}
          onChange={set('buildingType')}
        />
        <NumberField
          path="building.yearBuilt"
          label="Year built"
          value={draft.yearBuilt}
          onChange={set('yearBuilt')}
          parse={yearParse}
          size="medium"
        />
        <NumberField
          path="building.yearRenovated"
          label="Year renovated"
          value={draft.yearRenovated}
          onChange={set('yearRenovated')}
          parse={yearParse}
          size="medium"
        />
        <NumberField
          path="building.floors"
          label="Floors"
          value={draft.floors}
          onChange={set('floors')}
          parse={floorsParse}
        />
        <NumberField
          path="building.totalUnits"
          label="Total units"
          value={draft.totalUnits}
          onChange={set('totalUnits')}
          parse={unitsParse}
          size="medium"
          hint="In the whole building, not just yours."
        />
        <TriField
          path="building.elevator"
          label="Elevator"
          value={draft.elevator}
          onChange={set('elevator')}
        />
      </FormSection>

      <FormSection id="amenities" title="Amenities">
        {AMENITY_KEYS.map((k) => (
          <TriField
            key={k}
            path={`building.amenities.${k}`}
            label={AMENITY_LABELS[k]}
            value={draft.amenities[k] ?? null}
            onChange={(v) => setDraft((d) => ({ ...d, amenities: { ...d.amenities, [k]: v } }))}
          />
        ))}
        <TextField
          path="building.amenitiesNotes"
          label="Amenity notes"
          value={draft.amenitiesNotes}
          onChange={set('amenitiesNotes')}
          multiline
          placeholder="Rooftop grills, dog wash…"
        />
      </FormSection>

      <FormSection id="policies" title="Policies">
        <TriField
          path="building.pets.cats"
          label="Cats allowed"
          value={draft.pets.cats}
          onChange={setPets('cats')}
        />
        <TriField
          path="building.pets.dogs"
          label="Dogs allowed"
          value={draft.pets.dogs}
          onChange={setPets('dogs')}
        />
        {petsAllowed && (
          <>
            <TextField
              path="building.pets.limits"
              label="Pet limits"
              value={draft.pets.limits}
              onChange={setPets('limits')}
              placeholder="Max 2 pets, dogs under 50 lb"
            />
            <NumberField
              path="building.pets.monthlyRent"
              label="Pet rent"
              value={draft.pets.monthlyRent}
              onChange={setPets('monthlyRent')}
              parse={parseMoney}
              prefix="$"
              suffix="/mo"
            />
            <NumberField
              path="building.pets.deposit"
              label="Pet deposit"
              value={draft.pets.deposit}
              onChange={setPets('deposit')}
              parse={parseMoney}
              prefix="$"
            />
            <NumberField
              path="building.pets.oneTimeFee"
              label="One-time pet fee"
              value={draft.pets.oneTimeFee}
              onChange={setPets('oneTimeFee')}
              parse={parseMoney}
              prefix="$"
            />
          </>
        )}
        <SelectField
          path="building.smoking"
          label="Smoking"
          value={draft.smoking}
          options={SMOKING}
          onChange={set('smoking')}
        />
        <SelectField
          path="building.subletPolicy"
          label="Subletting"
          value={draft.subletPolicy}
          options={SUBLET}
          onChange={set('subletPolicy')}
        />
        <TextField
          path="building.guestParking"
          label="Guest parking"
          value={draft.guestParking}
          onChange={set('guestParking')}
          placeholder="Street only; 2-hour visitor spots"
        />
        <TextField
          path="building.policyNotes"
          label="Policy notes"
          value={draft.policyNotes}
          onChange={set('policyNotes')}
          multiline
        />
      </FormSection>

      <FormSection id="neighborhood" title="Neighborhood">
        <TextField
          path="building.neighborhood"
          label="Neighborhood"
          value={draft.neighborhood?.name ?? null}
          onChange={(v) =>
            setDraft((d) => ({
              ...d,
              neighborhood:
                v === null
                  ? null
                  : {
                      name: v,
                      source: d.neighborhood?.name === v ? d.neighborhood.source : 'manual',
                    },
            }))
          }
          hint={
            initial.neighborhood?.source === 'geocoder'
              ? 'Filled in from the map lookup; change it if it’s wrong.'
              : undefined
          }
        />
      </FormSection>

      <FormSection
        id="notes"
        title="Notes"
        lead="About the building as a whole. Dated notes go in the notes log on its panel."
      >
        <TextField
          path="building.notes"
          label="Notes"
          value={draft.notes}
          onChange={set('notes')}
          multiline
        />
      </FormSection>

      <FormSection id="links" title="Links">
        <LinksEditor path="building.links" value={draft.links} onChange={set('links')} />
      </FormSection>

      <FormSection id="photos" title="Photos">
        <p className={styles.lead}>Building photos arrive with the photo archive in M12.</p>
      </FormSection>
    </FormFrame>
  );
}

/** A web address, kept as typed; saving adds https:// when it's missing. */
function UrlField({
  path,
  label,
  value,
  onChange,
  hint,
}: {
  path: string;
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  hint?: string;
}) {
  const form = useFormApi();
  return (
    <TextField
      path={path}
      label={label}
      type="url"
      value={value}
      placeholder="example.com"
      hint={hint}
      onChange={(v) => {
        onChange(v);
        const r = v === null ? null : parseUrl(v);
        form.setError(path, r && !r.ok ? `${label}: ${r.error}` : null);
      }}
    />
  );
}

/** Web addresses as saved: https:// added where it was left off. */
function withSchemes(b: Building): Building {
  const fix = (v: string | null) => {
    if (v === null) return null;
    const r = parseUrl(v);
    return r.ok ? r.value : v;
  };
  return { ...b, website: fix(b.website), availabilityUrl: fix(b.availabilityUrl) };
}
