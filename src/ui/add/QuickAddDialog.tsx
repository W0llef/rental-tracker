import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { addToUnit, quickAdd } from '../../commands/quickAdd';
import type { QuickAddInput } from '../../commands/quickAdd';
import { db } from '../../db/db';
import { parseAddress } from '../../domain/address';
import { matchBuilding, matchUnit } from '../../domain/dedupe';
import { factStatus, valueAt } from '../../domain/facts';
import { buildingName, localDate, shortDate, SITE_LABELS, unitTitle } from '../../domain/format';
import type { Fact } from '../../domain/listingText';
import { parseListingText } from '../../domain/listingText';
import { parseListingUrl } from '../../domain/listingUrl';
import type { Building, SiteKey, Unit } from '../../model';
import type { Dataset } from '../../state/derive';
import { useUi } from '../../state/ui';
import { AddressField } from './AddressField';
import type { AddressChoice } from './AddressField';
import { FactChips } from './FactChips';
import {
  addressText,
  chipsFor,
  draftFromPlace,
  draftFromTyped,
  INPUT_FIELDS,
  isInputFact,
  localMatches,
  lookUp,
  numberFrom,
} from './plan';
import type { InputName } from './plan';
import { useSuggestions } from './useSuggestions';
import styles from './add.module.css';

type Mode = 'add' | 'open' | 'another';

interface Form {
  link: string;
  address: string;
  choice: AddressChoice | null;
  /** You said this isn't the building in your list that matched. */
  newBuilding: boolean;
  unit: string;
  floorPlanOnly: boolean;
  plan: string;
  rent: string;
  rentFrom: boolean;
  beds: string;
  baths: string;
  pasted: string;
  /** Chips you switched away from their default. */
  toggled: Set<string>;
  /** Values filled in from the link or pasted text, highlighted until you change them. */
  filled: Partial<Record<InputName, string>>;
  /** You chose "Add as a separate unit" on the duplicate banner. */
  separate: boolean;
  /** The listing site kept by "Add another here". */
  keptSite: SiteKey | null;
}

const choiceText = (c: AddressChoice) =>
  c.kind === 'building'
    ? buildingName(c.building) === c.building.address.line1
      ? addressText(c.building.address)
      : `${buildingName(c.building)}, ${c.building.address.line1}`
    : c.place.name
      ? `${c.place.name}, ${c.place.address.line1}`
      : addressText(c.place.address);

function startForm(preset: Building | undefined): Form {
  return {
    link: '',
    address: preset ? choiceText({ kind: 'building', building: preset }) : '',
    choice: preset ? { kind: 'building', building: preset } : null,
    newBuilding: false,
    unit: '',
    floorPlanOnly: false,
    plan: '',
    rent: '',
    rentFrom: false,
    beds: '',
    baths: '',
    pasted: '',
    toggled: new Set(),
    filled: {},
    separate: false,
    keptSite: null,
  };
}

/** A typed count: whole numbers for beds, halves for baths. */
const bedsFrom = (s: string) => {
  if (/^\s*studio\s*$/i.test(s)) return 0;
  const n = numberFrom(s);
  return n === null ? null : Math.round(n);
};
const bathsFrom = (s: string) => {
  const n = numberFrom(s);
  return n === null ? null : Math.round(n * 2) / 2;
};

/**
 * Quick-add (DESIGN.md §4.6; PLAN.md §5.1, §5.2, §5.7): a listing link, an address with
 * suggestions, unit or floor plan, rent, beds and baths, and pasted listing text whose
 * recognized details show as chips. A unit you already have shows a banner instead of a
 * duplicate. ⏎ adds, ⇧⏎ adds and starts another in the same building, Esc closes.
 */
export function QuickAddDialog({
  data,
  presetBuildingId,
  onClose,
}: {
  data: Dataset;
  presetBuildingId: string | null;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const showNotice = useUi((s) => s.showNotice);
  const today = localDate();
  const dialog = useRef<HTMLDialogElement>(null);
  const linkInput = useRef<HTMLInputElement>(null);
  const addressInput = useRef<HTMLInputElement>(null);
  const unitInput = useRef<HTMLInputElement>(null);

  const buildings = useMemo(() => [...data.buildingById.values()].map((r) => r.building), [data]);
  const units = useMemo(() => data.units.map((r) => r.unit), [data]);
  const listings = useMemo(() => data.units.flatMap((r) => r.listings), [data]);
  const preset = presetBuildingId ? data.buildingById.get(presetBuildingId)?.building : undefined;

  const [form, setForm] = useState<Form>(() => startForm(preset));
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field: InputName | null } | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    (preset ? unitInput : linkInput).current?.focus();
    // Opened once; the preset building is read on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── What the form adds up to ───────────────────────────────────────────
  const link = form.link.trim() ? parseListingUrl(form.link) : null;
  const linkInvalid = form.link.trim() !== '' && !link;
  const parsed = useMemo(
    () => (form.pasted.trim() ? parseListingText(form.pasted, today) : null),
    [form.pasted, today],
  );
  const nameHint = link?.hints.name ?? null;

  const suggestions = useSuggestions(form.address, form.choice === null);
  const local = form.choice ? [] : localMatches(buildings, form.address);

  const match = useMemo((): { building: Building; how: 'chosen' | 'address' | 'nearby' } | null => {
    if (form.choice?.kind === 'building') return { building: form.choice.building, how: 'chosen' };
    if (form.newBuilding) return null;
    if (form.choice?.kind === 'place') {
      const p = form.choice.place;
      const m = matchBuilding(buildings, {
        address: p.address,
        location: p.location,
        name: p.name ?? nameHint,
      });
      return m && { building: m.building, how: m.reason };
    }
    const typed = parseAddress(form.address);
    const m = typed
      ? matchBuilding(buildings, { address: typed, location: null, name: null })
      : null;
    return m && { building: m.building, how: m.reason };
  }, [form.choice, form.newBuilding, form.address, buildings, nameHint]);
  const existing = match?.building ?? null;

  const unitMatch = useMemo(
    () =>
      form.separate
        ? null
        : matchUnit(units, listings, {
            buildingId: existing?.id ?? null,
            unitNumber: form.unit.trim() || null,
            floorPlanName: form.plan.trim() || null,
            isFloorPlanOnly: form.floorPlanOnly,
            url: link?.url ?? null,
          }),
    [form.separate, form.unit, form.plan, form.floorPlanOnly, units, listings, existing, link],
  );
  /** A unit you already have that ⏎ adds this listing to. */
  const addingTo = unitMatch && unitMatch.reason !== 'floor-plan' ? unitMatch.unit : null;
  const matchedRow = unitMatch ? data.unitById.get(unitMatch.unit.id) : undefined;

  const chipTarget = {
    unit: addingTo ?? undefined,
    building:
      existing ?? (addingTo ? data.buildingById.get(addingTo.buildingId)?.building : undefined),
  };
  const chips = parsed ? chipsFor(parsed.facts, chipTarget, form.toggled) : [];
  const sameCount = parsed
    ? parsed.facts.filter((f) => !isInputFact(f) && factStatus(f, chipTarget) === 'same').length
    : 0;

  // ── Filling fields from the link and pasted text ───────────────────────
  /** Sets fields that are empty, or still hold what was filled in before. */
  function fillFrom(f: Form, values: Partial<Record<InputName, string>>): Form {
    const next = { ...f, filled: { ...f.filled } };
    for (const [name, value] of Object.entries(values) as [InputName, string][]) {
      if (name === 'address' && f.choice) continue;
      const cur = f[name];
      if (cur.trim() === '' || cur === f.filled[name]) {
        next[name] = value;
        next.filled[name] = value;
      }
    }
    return next;
  }

  function onLink(text: string) {
    const p = parseListingUrl(text);
    setForm((f) => {
      const next = { ...f, link: text, separate: false };
      if (!p) return next;
      const values: Partial<Record<InputName, string>> = {};
      if (p.hints.addressQuery) values.address = p.hints.addressQuery;
      if (p.hints.unitNumber) values.unit = p.hints.unitNumber;
      return fillFrom(next, values);
    });
  }

  function onPasted(text: string) {
    const p = text.trim() ? parseListingText(text, today) : null;
    setForm((f) => {
      const next = { ...f, pasted: text, toggled: new Set<string>() };
      if (!p) return next;
      const values: Partial<Record<InputName, string>> = {};
      for (const fact of p.facts) {
        const name = INPUT_FIELDS[fact.field as keyof typeof INPUT_FIELDS];
        if (name) values[name] = String(fact.value);
      }
      if (p.address) {
        values.address = addressText(p.address);
        if (p.address.unit && !values.unit) values.unit = p.address.unit;
      }
      const filled = fillFrom(next, values);
      const rentFact = p.facts.find((x) => x.field === 'unit.rent');
      if (rentFact && filled.rent === String(rentFact.value))
        filled.rentFrom = rentFact.also?.[0]?.value === true;
      return filled;
    });
  }

  const isFilled = (name: InputName) =>
    form.filled[name] !== undefined && form[name] === form.filled[name];

  // ── Adding ─────────────────────────────────────────────────────────────
  /** Pasted values that went into a box unchanged keep their source too. */
  const inputFacts = (): Fact[] =>
    (parsed?.facts ?? []).filter((f) => {
      const name = INPUT_FIELDS[f.field as keyof typeof INPUT_FIELDS];
      return name !== undefined && isFilled(name);
    });

  function fail(text: string, field: InputName | null) {
    setError({ text, field });
    const el =
      field === 'link' ? linkInput.current : field === 'address' ? addressInput.current : null;
    el?.focus();
  }

  async function submit(mode: Mode, target: Unit | null = addingTo) {
    if (busy) return;
    setError(null);
    if (linkInvalid) return fail('That link doesn’t look like a web address.', 'link');
    if (!target && !form.choice && !form.address.trim())
      return fail('Enter an address, or pick a building from your list.', 'address');
    const rentN = numberFrom(form.rent);
    if (form.rent.trim() && (rentN === null || rentN > 100_000))
      return fail('Rent should be a dollar amount, like 1650.', 'rent');
    const rent = rentN === null ? null : Math.round(rentN);
    const beds = bedsFrom(form.beds);
    const baths = bathsFrom(form.baths);
    if (form.beds.trim() && (beds === null || beds > 20))
      return fail('Beds should be a number (0 for a studio).', 'beds');
    if (form.baths.trim() && (baths === null || baths > 20))
      return fail('Baths should be a number, like 1 or 1.5.', 'baths');

    const listing = link
      ? { url: link.url, site: link.site }
      : form.keptSite
        ? { url: null, site: form.keptSite }
        : null;
    const chosen = chips.filter((c) => c.on).map((c) => c.fact);
    const pasted = form.pasted.trim() ? form.pasted : null;

    setBusy(true);
    try {
      if (target) {
        // Typed beds and baths only fill what the unit doesn't know yet.
        const typed: Fact[] = [];
        if (beds !== null && target.bedrooms === null)
          typed.push({ field: 'unit.bedrooms', value: beds, label: '' });
        if (baths !== null && target.bathrooms === null)
          typed.push({ field: 'unit.bathrooms', value: baths, label: '' });
        const facts = [...chosen.filter((f) => f.field !== 'unit.rent'), ...typed];
        if (!listing?.url && rent === null && !facts.length && !chosen.length) {
          const row = data.unitById.get(target.id);
          setError({
            text: `Nothing new to add to ${unitTitle(target, row?.building)}. Add a link, a price or pasted text, or add it as a separate unit.`,
            field: null,
          });
          return;
        }
        const r = await addToUnit(db, {
          unitId: target.id,
          today,
          listing,
          rent,
          rentIsFrom: form.rentFrom,
          facts,
          pasted,
          skipped: chips.length - chosen.length,
        });
        const b = data.buildingById.get(r.unit.buildingId)?.building;
        done(
          mode,
          r.unit,
          b,
          `${listing?.url ? 'Listing added to' : 'Updated'} ${describe(r.unit, b)}.`,
        );
        return;
      }

      let ref: QuickAddInput['building'];
      let located: boolean;
      if (existing) {
        ref = { id: existing.id };
        located = existing.location !== null;
      } else if (form.choice?.kind === 'place') {
        ref = { draft: draftFromPlace(form.choice.place, nameHint) };
        located = true;
      } else {
        const place = await lookUp(form.address, suggestions.places);
        // Typed words that aren't an address are probably the building's name.
        const typedName = parseAddress(form.address) ? null : form.address.trim();
        const name = nameHint ?? typedName;
        const m =
          place && !form.newBuilding
            ? matchBuilding(buildings, {
                address: place.address,
                location: place.location,
                name: place.name ?? name,
              })
            : null;
        if (m) {
          // Found in your list only now: show a duplicate first, if there is one.
          const dup = form.separate
            ? null
            : matchUnit(units, listings, {
                buildingId: m.building.id,
                unitNumber: form.unit.trim() || null,
                floorPlanName: form.plan.trim() || null,
                isFloorPlanOnly: form.floorPlanOnly,
                url: link?.url ?? null,
              });
          if (dup && dup.reason !== 'floor-plan') {
            set({ choice: { kind: 'building', building: m.building } });
            return;
          }
          ref = { id: m.building.id };
          located = m.building.location !== null;
        } else if (place) {
          ref = { draft: draftFromPlace(place, name) };
          located = true;
        } else {
          ref = { draft: draftFromTyped(form.address, nameHint) };
          located = false;
        }
      }

      const r = await quickAdd(db, {
        today,
        building: ref,
        unit: {
          unitNumber: form.floorPlanOnly ? null : form.unit.trim() || null,
          isFloorPlanOnly: form.floorPlanOnly,
          floorPlanName: form.plan.trim() || null,
          rent,
          rentIsFrom: form.rentFrom,
          bedrooms: beds,
          bathrooms: baths,
        },
        listing,
        facts: [...chosen, ...inputFacts()],
        pasted,
      });
      const where = located ? '' : ' It isn’t on the map yet: open it and choose Place on map.';
      done(mode, r.unit, r.building, `${capital(describe(r.unit, r.building))} added.${where}`);
    } catch (e) {
      setError({ text: `Couldn’t add the unit. ${(e as Error).message}`, field: null });
    } finally {
      setBusy(false);
    }
  }

  function done(mode: Mode, unit: Unit, building: Building | undefined, text: string) {
    if (mode === 'open') {
      showNotice(text);
      navigate(`/unit/${unit.id}`, { replace: true });
    } else if (mode === 'add') {
      showNotice(text, `/unit/${unit.id}`);
      onClose();
    } else {
      const b = building ?? data.buildingById.get(unit.buildingId)?.building;
      const next = startForm(b);
      next.keptSite = link?.site ?? form.keptSite;
      setForm(next);
      setStatus(`${text} Add the next unit${b ? ` at ${buildingName(b)}` : ''}.`);
      unitInput.current?.focus();
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit('add');
  };
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' && e.shiftKey && !(e.target instanceof HTMLTextAreaElement)) {
      e.preventDefault();
      void submit('another');
    }
  };

  const describedBy = (name: InputName, extra?: string) =>
    [error?.field === name ? 'qa-error' : null, extra].filter(Boolean).join(' ') || undefined;

  const site = link ? SITE_LABELS[link.site] : null;
  const matchedBuildingName = existing ? buildingName(existing) : null;
  const title = matchedRow ? unitTitle(matchedRow.unit, matchedRow.building) : '';
  const bName = matchedRow?.building ? buildingName(matchedRow.building) : '';
  const added = matchedRow ? shortDate(localDate(new Date(matchedRow.unit.createdAt)), today) : '';

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="qa-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={(e) => {
        // Esc closes (handled here too, as not every browser sends "cancel"); a field that
        // used Esc itself (the address list) has already prevented it.
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <form className={styles.form} onSubmit={onSubmit} onKeyDown={onKeyDown} noValidate>
        <header className={styles.head}>
          <h2 id="qa-title" className={styles.title}>
            Add a unit
          </h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" />
            </svg>
          </button>
        </header>

        <div className={styles.body}>
          <p className={styles.done} role="status">
            {status}
          </p>

          <div className={styles.field}>
            <label htmlFor="qa-link" className={styles.label}>
              Listing link
            </label>
            <input
              ref={linkInput}
              id="qa-link"
              className={styles.input}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://… (optional)"
              value={form.link}
              aria-invalid={linkInvalid || undefined}
              aria-describedby={describedBy('link', 'qa-link-note')}
              onChange={(e) => onLink(e.target.value)}
            />
            <p id="qa-link-note" className={styles.note}>
              {linkInvalid
                ? 'Not a web address.'
                : site
                  ? `Site: ${site}`
                  : form.keptSite
                    ? `Site kept: ${SITE_LABELS[form.keptSite]}`
                    : 'Paste the link from Zillow, Apartments.com, a building’s site…'}
            </p>
          </div>

          <div className={styles.field}>
            <label htmlFor="qa-address" className={styles.label}>
              Address
            </label>
            <AddressField
              ref={addressInput}
              value={form.address}
              onChange={(text) => set({ address: text, choice: null, newBuilding: false })}
              onChoose={(choice) =>
                set({ choice, address: choiceText(choice), newBuilding: false })
              }
              local={local}
              places={suggestions.places}
              status={suggestions.status}
              filled={isFilled('address')}
              invalid={error?.field === 'address'}
              describedBy={describedBy('address', 'qa-address-note')}
            />
            <p id="qa-address-note" className={styles.note} aria-live="polite">
              {existing ? (
                <>
                  <span className={styles.ok}>
                    ✓ {matchedBuildingName} is in your list; adding it there.
                  </span>{' '}
                  <button
                    type="button"
                    className={styles.linkButton}
                    onClick={() =>
                      set({
                        newBuilding: true,
                        choice: form.choice?.kind === 'building' ? null : form.choice,
                      })
                    }
                  >
                    Add as a new building
                  </button>
                </>
              ) : form.choice?.kind === 'place' ? (
                `New building${form.choice.place.neighborhood ? ` in ${form.choice.place.neighborhood}` : ''}.`
              ) : form.address.trim() ? (
                'Pick a suggestion, or add with what you typed.'
              ) : (
                'Suggestions come from OpenStreetMap (Photon).'
              )}
            </p>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor="qa-unit" className={styles.label}>
                Unit
              </label>
              <input
                ref={unitInput}
                id="qa-unit"
                className={`${styles.input} ${styles.short}`}
                data-filled={isFilled('unit') || undefined}
                autoComplete="off"
                disabled={form.floorPlanOnly}
                value={form.floorPlanOnly ? '' : form.unit}
                onChange={(e) => set({ unit: e.target.value, separate: false })}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="qa-plan" className={styles.label}>
                Floor plan
              </label>
              <input
                id="qa-plan"
                className={`${styles.input} ${styles.short}`}
                data-filled={isFilled('plan') || undefined}
                autoComplete="off"
                value={form.plan}
                onChange={(e) => set({ plan: e.target.value, separate: false })}
              />
            </div>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={form.floorPlanOnly}
                onChange={(e) => set({ floorPlanOnly: e.target.checked, separate: false })}
              />
              Floor plan only (no unit number yet)
            </label>
          </div>

          <div className={styles.row}>
            <div className={styles.field}>
              <label htmlFor="qa-rent" className={styles.label}>
                Rent
              </label>
              <span className={styles.money}>
                <span aria-hidden="true">$</span>
                <input
                  id="qa-rent"
                  className={`${styles.input} ${styles.short}`}
                  data-filled={isFilled('rent') || undefined}
                  inputMode="decimal"
                  autoComplete="off"
                  value={form.rent}
                  aria-invalid={error?.field === 'rent' || undefined}
                  aria-describedby={describedBy('rent')}
                  onChange={(e) => set({ rent: e.target.value })}
                />
              </span>
            </div>
            <div className={styles.field}>
              <label htmlFor="qa-beds" className={styles.label}>
                Beds
              </label>
              <input
                id="qa-beds"
                className={`${styles.input} ${styles.tiny}`}
                data-filled={isFilled('beds') || undefined}
                inputMode="decimal"
                autoComplete="off"
                value={form.beds}
                aria-invalid={error?.field === 'beds' || undefined}
                aria-describedby={describedBy('beds', 'qa-beds-note')}
                onChange={(e) => set({ beds: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="qa-baths" className={styles.label}>
                Baths
              </label>
              <input
                id="qa-baths"
                className={`${styles.input} ${styles.tiny}`}
                data-filled={isFilled('baths') || undefined}
                inputMode="decimal"
                autoComplete="off"
                value={form.baths}
                aria-invalid={error?.field === 'baths' || undefined}
                aria-describedby={describedBy('baths')}
                onChange={(e) => set({ baths: e.target.value })}
              />
            </div>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={form.rentFrom}
                onChange={(e) => set({ rentFrom: e.target.checked })}
              />
              Price is “from” (lowest of a range)
            </label>
          </div>
          <p id="qa-beds-note" className={styles.visuallyHidden}>
            0 for a studio
          </p>

          <div className={styles.paste} data-open={form.pasted.trim() ? true : undefined}>
            <label htmlFor="qa-paste" className={styles.label}>
              Paste listing text <span className={styles.optional}>(optional)</span>
            </label>
            <textarea
              id="qa-paste"
              className={styles.textarea}
              rows={1}
              placeholder="On the listing page: select all, copy, and paste here"
              value={form.pasted}
              aria-describedby="qa-paste-note"
              onChange={(e) => onPasted(e.target.value)}
            />
            <div id="qa-paste-note" aria-live="polite">
              {parsed && (
                <>
                  <p className={styles.note}>
                    {parsed.facts.length === 0
                      ? 'Nothing recognized in that text. You can still add the unit.'
                      : `Found ${parsed.facts.length} detail${parsed.facts.length === 1 ? '' : 's'}${
                          sameCount ? ` (${sameCount} already match)` : ''
                        }. Click one to leave it out.`}
                  </p>
                  {parsed.notes.map((n) => (
                    <p key={n} className={styles.note}>
                      {n}
                    </p>
                  ))}
                </>
              )}
            </div>
            <FactChips
              chips={chips}
              current={(field) => valueAt(field, chipTarget)}
              onToggle={(field) =>
                setForm((f) => {
                  const toggled = new Set(f.toggled);
                  if (toggled.has(field)) toggled.delete(field);
                  else toggled.add(field);
                  return { ...f, toggled };
                })
              }
            />
          </div>

          {unitMatch && matchedRow && (
            <div className={styles.banner} role="group" aria-labelledby="qa-dup">
              <p id="qa-dup" className={styles.bannerText}>
                {unitMatch.reason === 'url'
                  ? `This link is already saved for ${title}${bName && bName !== title ? ` at ${bName}` : ''}.`
                  : unitMatch.reason === 'unit-number'
                    ? `This looks like ${title} at ${bName}, added ${added}.`
                    : `${bName} already has ${title} (floor plan), added ${added}.`}
              </p>
              <div className={styles.bannerActions}>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy}
                  onClick={() => void submit('add', unitMatch.unit)}
                >
                  {unitMatch.reason === 'url'
                    ? link && form.rent.trim()
                      ? 'Add today’s price to it'
                      : 'Update it'
                    : unitMatch.reason === 'floor-plan'
                      ? 'Add to it'
                      : 'Add this listing to it'}
                </button>
                <button
                  type="button"
                  className={styles.button}
                  disabled={busy}
                  onClick={() => set({ separate: true })}
                >
                  Add as a separate unit
                </button>
              </div>
            </div>
          )}

          {error && (
            <p id="qa-error" className={styles.error} role="alert">
              {error.text}
            </p>
          )}
        </div>

        <footer className={styles.foot}>
          <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={() => void submit('open')}
          >
            {addingTo ? 'Add to it and open' : 'Add and open'}
          </button>
          <button
            type="button"
            className={styles.button}
            disabled={busy}
            onClick={() => void submit('another')}
          >
            Add another here <kbd className={styles.kbd}>⇧⏎</kbd>
          </button>
          <button type="submit" className={styles.primary} disabled={busy}>
            {busy
              ? 'Adding…'
              : addingTo
                ? `Add to ${unitTitle(addingTo, matchedRow?.building)}`
                : 'Add unit'}{' '}
            <kbd className={styles.kbd}>⏎</kbd>
          </button>
        </footer>
      </form>
    </dialog>
  );
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function describe(unit: Unit, b: Building | undefined): string {
  const title = unitTitle(unit, b);
  const name = b ? buildingName(b) : null;
  return name && name !== title ? `${title} at ${name}` : title;
}
