import { useId, useState } from 'react';
import { makeAddress } from '../../domain/address';
import { parseMoney, parseUrl, parseWhole, parseYear } from '../../domain/input';
import type { Building } from '../../model';
import { CheckField, FieldRow, NumberField, SelectField, TextField, TriField } from './fields';
import { SMOKING } from './buildingDraft';
import { useFormApi } from './formState';
import styles from './edit.module.css';

/**
 * Building fields shared by the building form and a standalone home's unit form (Q30):
 * address, names (with "This complex has several buildings"), web addresses, and the
 * home's own facts.
 */

type Change = (next: Building) => void;

const yearParse = (t: string) => parseYear(t);
const storiesParse = (t: string) => parseWhole(t, { min: 1, max: 200, what: 'a number of floors' });

/** Street address, city and ZIP. The pin doesn't move with it (Place on map does). */
export function AddressFields({ building: b, onChange }: { building: Building; onChange: Change }) {
  const id = useId();
  const form = useFormApi();
  const [text, setText] = useState({
    line1: b.address.line1,
    city: b.address.city ?? '',
    zip: b.address.zip ?? '',
  });
  const setPart = (part: keyof typeof text, value: string) => {
    const next = { ...text, [part]: value };
    setText(next);
    if (!next.line1.trim()) {
      form.setError('building.address', 'Enter the street address.');
      return;
    }
    form.setError('building.address', null);
    onChange({
      ...b,
      address: makeAddress(
        next.line1,
        next.city.trim() || null,
        b.address.state,
        next.zip.trim() || null,
      ),
    });
  };
  return (
    <>
      <FieldRow
        path="building.address"
        label="Street address"
        empty={false}
        controlId={`${id}-line1`}
        noUnknown
        hint="Moving the pin is separate: use Place on map from the panel."
      >
        <input
          id={`${id}-line1`}
          className={`${styles.input} ${styles.grow}`}
          value={text.line1}
          autoComplete="off"
          onChange={(e) => setPart('line1', e.target.value)}
        />
      </FieldRow>
      <FieldRow
        path="building.address.city"
        label="City and ZIP"
        empty={false}
        controlId={`${id}-city`}
        noUnknown
      >
        <div className={styles.listRow}>
          <input
            id={`${id}-city`}
            className={`${styles.input} ${styles.city}`}
            value={text.city}
            placeholder="e.g. Minneapolis"
            onChange={(e) => setPart('city', e.target.value)}
          />
          <input
            className={styles.inputShort}
            aria-label="ZIP code"
            value={text.zip}
            inputMode="numeric"
            placeholder="e.g. 55401"
            onChange={(e) => setPart('zip', e.target.value)}
          />
        </div>
      </FieldRow>
    </>
  );
}

/**
 * One name box by default. "This complex has several buildings" turns it into the complex's
 * name and adds this building's own (owner, M8 review): a single building never has its
 * name split over two boxes.
 */
export function NameFields({
  building: b,
  onChange,
  complexNames,
}: {
  building: Building;
  onChange: Change;
  /** Complex names already used on other buildings, offered as suggestions. */
  complexNames: readonly string[];
}) {
  const listId = useId();
  const [several, setSeveral] = useState(b.complexName !== null);
  const [dropped, setDropped] = useState<string | null>(null);
  return (
    <>
      {several ? (
        <>
          <TextField
            path="building.complexName"
            label="Complex name"
            value={b.complexName}
            onChange={(v) => onChange({ ...b, complexName: v })}
            placeholder="e.g. Cedar Mill"
            list={listId}
            hint={
              complexNames.length
                ? 'Use the same name for every building in the complex; names you’ve used are offered.'
                : 'Use the same name for every building in the complex.'
            }
          />
          <datalist id={listId}>
            {complexNames.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <TextField
            path="building.name"
            label="This building’s name"
            value={b.name}
            onChange={(v) => onChange({ ...b, name: v })}
            placeholder="e.g. North Tower"
            hint="Optional: how this building is told apart within the complex."
          />
        </>
      ) : (
        <TextField
          path="building.name"
          label="Name"
          value={b.name}
          onChange={(v) => onChange({ ...b, name: v })}
          placeholder="e.g. Riverlight"
          hint={
            dropped
              ? `“${dropped}” was this building’s own name; it goes when you save.`
              : undefined
          }
        />
      )}
      <CheckField
        label="This complex has several buildings"
        checked={several}
        onChange={(on) => {
          setSeveral(on);
          if (on) {
            setDropped(null);
            // A name typed first is almost always the complex's.
            if (b.complexName === null) onChange({ ...b, complexName: b.name, name: null });
          } else {
            setDropped(b.complexName && b.name ? b.name : null);
            onChange({ ...b, name: b.complexName ?? b.name, complexName: null });
          }
        }}
      />
    </>
  );
}

/** A web address, kept as typed; saving adds https:// when it's missing (buildingDraft.ts). */
export function UrlField({
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
      placeholder="e.g. example.com"
      hint={hint}
      onChange={(v) => {
        onChange(v);
        const r = v === null ? null : parseUrl(v);
        form.setError(path, r && !r.ok ? `${label}: ${r.error}` : null);
      }}
    />
  );
}

/**
 * A standalone home's own facts, in its unit form (Q30): where it is, who rents it out,
 * how old and how tall it is, pets and smoking. The rest of the building form (amenities,
 * subletting…) is still there behind "More about the home".
 */
export function HomeFields({ building: b, onChange }: { building: Building; onChange: Change }) {
  const set =
    <K extends keyof Building>(k: K) =>
    (v: Building[K]) =>
      onChange({ ...b, [k]: v });
  const setPets =
    <K extends keyof Building['pets']>(k: K) =>
    (v: Building['pets'][K]) =>
      onChange({ ...b, pets: { ...b.pets, [k]: v } });
  const petsAllowed = b.pets.cats === true || b.pets.dogs === true;
  return (
    <>
      <AddressFields building={b} onChange={onChange} />
      <TextField
        path="building.managementCompany"
        label="Landlord or manager"
        value={b.managementCompany}
        onChange={set('managementCompany')}
      />
      <TextField
        path="building.phone"
        label="Phone"
        type="tel"
        value={b.phone}
        onChange={set('phone')}
      />
      <TextField
        path="building.email"
        label="Email"
        type="email"
        value={b.email}
        onChange={set('email')}
      />
      <UrlField
        path="building.website"
        label="Website"
        value={b.website}
        onChange={set('website')}
      />
      <NumberField
        path="building.yearBuilt"
        label="Year built"
        value={b.yearBuilt}
        onChange={set('yearBuilt')}
        parse={yearParse}
        size="medium"
      />
      <NumberField
        path="building.floors"
        label="Stories"
        value={b.floors}
        onChange={set('floors')}
        parse={storiesParse}
      />
      <TriField
        path="building.pets.cats"
        label="Cats allowed"
        value={b.pets.cats}
        onChange={setPets('cats')}
      />
      <TriField
        path="building.pets.dogs"
        label="Dogs allowed"
        value={b.pets.dogs}
        onChange={setPets('dogs')}
      />
      {petsAllowed && (
        <>
          <TextField
            path="building.pets.limits"
            label="Pet limits"
            value={b.pets.limits}
            onChange={setPets('limits')}
            placeholder="e.g. max 2 pets, dogs under 50 lb"
          />
          <NumberField
            path="building.pets.monthlyRent"
            label="Pet rent"
            value={b.pets.monthlyRent}
            onChange={setPets('monthlyRent')}
            parse={parseMoney}
            prefix="$"
            suffix="/mo"
          />
          <NumberField
            path="building.pets.deposit"
            label="Pet deposit"
            value={b.pets.deposit}
            onChange={setPets('deposit')}
            parse={parseMoney}
            prefix="$"
          />
        </>
      )}
      <SelectField
        path="building.smoking"
        label="Smoking"
        value={b.smoking}
        options={SMOKING}
        onChange={set('smoking')}
      />
    </>
  );
}
