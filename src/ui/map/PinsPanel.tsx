import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { Legend as LegendData } from '../../domain/pins';
import { PRICE_COLOR_LABEL } from '../../domain/pins';
import {
  PENDING_FIELDS,
  PIN_FIELDS,
  PIN_SIZE,
  fieldEnabled,
  toggleField,
} from '../../domain/pinPrefs';
import type {
  ColorBy,
  NewBadge,
  PinField,
  PinPrefs,
  PinStyle,
  PinView,
  RejectedMode,
} from '../../domain/pinPrefs';
import { LegendBody } from './Legend';
import styles from './map.module.css';

const FIELD_LABELS: Record<PinView, Record<PinField, string>> = {
  units: {
    type: 'Unit type icon',
    rent: 'Rent',
    total: 'Total cost',
    psf: 'Cost per ft²',
    beds: 'Beds and size',
    unit: 'Unit number',
    rating: 'Your rating',
    travel: 'Travel time',
  },
  buildings: {
    type: 'Unit type icon',
    rent: 'Rent',
    total: 'Total cost',
    psf: 'Cost per ft²',
    beds: 'Beds and size',
    unit: 'Building name',
    rating: 'Your rating',
    travel: 'Travel time',
  },
};

const PENDING_TITLE: Record<string, string> = {
  M9: 'Arrives with total cost (M9)',
  'Phase 2': 'Needs destinations (Phase 2)',
};

function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    // The surrounding fieldset names the group; buttons say which choice is on.
    <div className={styles.seg} data-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Section({ title, tag, children }: { title: string; tag?: string; children: ReactNode }) {
  return (
    <fieldset className={styles.lsec}>
      <legend className={styles.lt}>
        {title} {tag && <span className={styles.tag}>{tag}</span>}
      </legend>
      {children}
    </fieldset>
  );
}

/**
 * The Pins panel (M3 review): pin style, the fields printed on pins, how buildings with
 * several units summarize them, the New badge, colors, rejected units and crowding.
 * Settings are kept separately for the Units and Buildings views.
 */
export function PinsPanel({
  view,
  prefsFor,
  onChange,
  onClose,
  legend,
}: {
  /** The list's current view: the panel starts on its settings. */
  view: PinView;
  prefsFor: Record<PinView, PinPrefs>;
  onChange: (view: PinView, prefs: PinPrefs) => void;
  onClose: () => void;
  legend: LegendData | null;
}) {
  const ref = useRef<HTMLElement>(null);
  // Edits whichever view the list shows; the other view keeps its own settings.
  const editing = view;
  const prefs = prefsFor[editing];
  const set = (patch: Partial<PinPrefs>) => onChange(editing, { ...prefs, ...patch });

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const plateOff = prefs.style === 'dot';
  const priceOff = plateOff || !prefs.fields.includes('rent');

  return (
    <section
      ref={ref}
      id="map-pins"
      className={styles.layers}
      aria-labelledby="map-pins-title"
      tabIndex={-1}
    >
      <div className={styles.lh}>
        <h3 id="map-pins-title">Pins</h3>
        <button type="button" onClick={onClose} aria-label="Close pins" title="Close (Esc)">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </button>
      </div>

      <p className={styles.lfor}>
        For the {view === 'units' ? 'Units' : 'Buildings'} view. The{' '}
        {view === 'units' ? 'Buildings' : 'Units'} view keeps its own settings.
      </p>

      <Section title="Pin style">
        <Seg<PinStyle>
          label="Pin style"
          value={prefs.style}
          options={[
            { id: 'plate', label: 'Sign plate' },
            { id: 'dot', label: 'Dot' },
            { id: 'photo', label: 'Photo' },
          ]}
          onChange={(style) => set({ style })}
        />
        {prefs.style === 'photo' && (
          <p className={styles.lnote}>
            Fields print under the photo. Until photos arrive (M12) the frame shows the unit type.
          </p>
        )}
        <div className={styles.sizeRow}>
          <label htmlFor={`pin-size-${editing}`}>Pin size</label>
          <input
            id={`pin-size-${editing}`}
            type="range"
            min={PIN_SIZE.min}
            max={PIN_SIZE.max}
            step={PIN_SIZE.step}
            value={prefs.size}
            aria-valuetext={`${prefs.size}%`}
            onChange={(e) => set({ size: Number(e.target.value) })}
          />
          <output htmlFor={`pin-size-${editing}`}>{prefs.size}%</output>
        </div>
        {prefs.size !== PIN_SIZE.normal && (
          <button
            type="button"
            className={styles.linkBtn}
            onClick={() => set({ size: PIN_SIZE.normal })}
          >
            Reset to 100%
          </button>
        )}
      </Section>

      <Section title="On the pin">
        {PIN_FIELDS.map((f) => {
          const pending = PENDING_FIELDS[f];
          const enabled = fieldEnabled(prefs, f);
          return (
            <label
              key={f}
              className={`${styles.chk} ${enabled ? '' : styles.off}`}
              title={pending ? PENDING_TITLE[pending] : undefined}
            >
              <input
                type="checkbox"
                disabled={!enabled}
                checked={enabled && prefs.fields.includes(f)}
                onChange={(e) => onChange(editing, toggleField(prefs, f, e.target.checked))}
              />
              {FIELD_LABELS[editing][f]}
              {pending && <span className={styles.tag}>{pending}</span>}
            </label>
          );
        })}
        {plateOff && <p className={styles.lnote}>Dots carry no text: pick a plate or photo.</p>}
        <p className={`${styles.lsub} ${priceOff ? styles.off : ''}`} id="price-mode-label">
          {editing === 'units' ? 'Rent for a building with several units' : 'Rent for a building'}
        </p>
        <div role="radiogroup" aria-labelledby="price-mode-label">
          {(
            [
              ['range', 'Range, $1,090–$1,815'],
              ['lowest', 'Lowest, $1,090+'],
            ] as const
          ).map(([id, label]) => (
            <label key={id} className={`${styles.chk} ${priceOff ? styles.off : ''}`}>
              <input
                type="radio"
                name={`price-mode-${editing}`}
                disabled={priceOff}
                checked={prefs.priceMode === id}
                onChange={() => set({ priceMode: id })}
              />
              {label}
            </label>
          ))}
        </div>
      </Section>

      <Section title="New units">
        <Seg<NewBadge>
          label="New units"
          value={prefs.newBadge}
          options={[
            { id: 'off', label: 'Off' },
            { id: 'dot', label: 'Dot' },
            { id: 'tag', label: '“New” tag' },
          ]}
          onChange={(newBadge) => set({ newBadge })}
        />
      </Section>

      <Section title="Pin color">
        <Seg<ColorBy>
          label="Pin color"
          value={prefs.colorBy}
          options={[
            { id: 'status', label: 'Status' },
            { id: 'label', label: 'Label' },
            { id: 'price', label: PRICE_COLOR_LABEL },
          ]}
          onChange={(colorBy) => set({ colorBy })}
        />
        {prefs.colorBy === 'price' && (
          <p className={styles.lnote}>Uses rent until total cost arrives (M9).</p>
        )}
        {legend && (
          <div className={styles.inlineLegend}>
            <LegendBody legend={legend} />
          </div>
        )}
      </Section>

      <Section title="Rejected units">
        <Seg<RejectedMode>
          label="Rejected units"
          value={prefs.rejected}
          options={[
            { id: 'show', label: 'Show' },
            { id: 'fade', label: 'Fade' },
            { id: 'hide', label: 'Hide' },
          ]}
          onChange={(rejected) => set({ rejected })}
        />
        <p className={styles.lnote}>
          {prefs.rejected === 'show'
            ? 'Rejected units count in a building’s ranges and colors.'
            : prefs.rejected === 'fade'
              ? 'Faded, and left out of a building’s ranges and colors.'
              : 'Not on the map (a rejected unit you select still shows).'}
        </p>
      </Section>

      <Section title="When crowded">
        <label className={styles.chk}>
          <input
            type="checkbox"
            checked={prefs.bubbles}
            onChange={(e) => set({ bubbles: e.target.checked })}
          />
          Group nearby buildings when zoomed out
        </label>
        <label className={styles.chk}>
          <input
            type="checkbox"
            checked={prefs.shrink}
            onChange={(e) => set({ shrink: e.target.checked })}
          />
          Shrink crowded pins to dots
        </label>
        {editing === 'units' && (
          <label className={styles.chk}>
            <input
              type="checkbox"
              checked={prefs.autoFan}
              onChange={(e) => set({ autoFan: e.target.checked })}
            />
            Open buildings’ cards when zoomed in, where they fit
          </label>
        )}
      </Section>
    </section>
  );
}
