import { useEffect, useRef } from 'react';
import {
  PIN_SHOW_LABELS,
  PIN_SHOW_PENDING,
  PRICE_COLOR_LABEL,
  effectivePinShow,
} from '../../domain/pins';
import type { ColorBy } from '../../domain/pins';
import { PIN_CONTENTS } from '../../model';
import type { MapPrefs, PinContent } from '../../model';
import { BASE_MAPS } from './baseMaps';
import styles from './map.module.css';

/** A change to the map preferences, with the words the change log records. */
export type MapPrefsChange = (prefs: MapPrefs) => MapPrefs;

const OVERLAYS = [
  'Skyway routes',
  'Transit lines and stops',
  'Bike trails and protected lanes',
  'Neighborhood boundaries',
  'Reported crime',
  'All residential buildings',
  'Reachable within N minutes',
];

const COLOR_OPTIONS: { id: ColorBy; label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'label', label: 'Label' },
  { id: 'price', label: PRICE_COLOR_LABEL },
];

const PENDING_TITLE: Record<string, string> = {
  M8: 'Arrives with total cost (M8)',
  'Phase 2': 'Needs destinations (Phase 2)',
};

/**
 * The Map layers panel (DESIGN.md §4.7): base map, what pins show, extras, pin color,
 * shrink-to-dots and fade-rejected. Choices apply at once and are saved in Settings.
 * Phase 2 overlays are shown disabled so nothing moves when they arrive.
 */
export function LayersPanel({
  prefs,
  onChange,
  onClose,
}: {
  prefs: MapPrefs;
  onChange: (change: MapPrefsChange, label: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const show = effectivePinShow(prefs.pins.show);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const pins = (patch: Partial<MapPrefs['pins']>, label: string) =>
    onChange((m) => ({ ...m, pins: { ...m.pins, ...patch } }), label);
  const extras = (patch: Partial<MapPrefs['pins']['extras']>, label: string) =>
    onChange((m) => ({ ...m, pins: { ...m.pins, extras: { ...m.pins.extras, ...patch } } }), label);

  return (
    <section
      ref={ref}
      id="map-layers"
      className={styles.layers}
      aria-labelledby="map-layers-title"
      tabIndex={-1}
    >
      <div className={styles.lh}>
        <h3 id="map-layers-title">Map layers</h3>
        <button type="button" onClick={onClose} aria-label="Close map layers" title="Close (Esc)">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </button>
      </div>

      <fieldset className={styles.lsec}>
        <legend className={styles.lt}>Base map</legend>
        <div className={styles.bases}>
          {BASE_MAPS.map((b) => (
            <button
              key={b.id}
              type="button"
              className={styles.base}
              aria-pressed={prefs.baseLayer === b.id}
              onClick={() => onChange((m) => ({ ...m, baseLayer: b.id }), `Base map: ${b.name}`)}
            >
              <span className={`${styles.bt} ${styles[`bt-${b.id}`]}`} aria-hidden="true" />
              <span className={styles.bn}>{b.name}</span>
              <span className={styles.bs}>{b.blurb}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.lsec}>
        <legend className={styles.lt}>Pins show</legend>
        <div className={styles.chipset}>
          {PIN_CONTENTS.map((c: PinContent) => {
            const pending = PIN_SHOW_PENDING[c];
            return (
              <button
                key={c}
                type="button"
                disabled={!!pending}
                title={pending ? PENDING_TITLE[pending] : undefined}
                aria-pressed={pending ? undefined : show === c}
                onClick={() => pins({ show: c }, `Pins show: ${PIN_SHOW_LABELS[c]}`)}
              >
                {PIN_SHOW_LABELS[c]}
                {pending && <span className={styles.tag}>{pending}</span>}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset className={styles.lsec}>
        <legend className={styles.lt}>Also on pins</legend>
        <label className={styles.chk}>
          <input
            type="checkbox"
            checked={prefs.pins.extras.typeIcon}
            onChange={(e) =>
              extras(
                { typeIcon: e.target.checked },
                `Pins: unit type icon ${onOff(e.target.checked)}`,
              )
            }
          />
          Unit type icon
        </label>
        <label className={styles.chk}>
          <input
            type="checkbox"
            checked={prefs.pins.extras.stars}
            onChange={(e) =>
              extras({ stars: e.target.checked }, `Pins: star rating ${onOff(e.target.checked)}`)
            }
          />
          Star rating
        </label>
        <label className={styles.chk}>
          <input
            type="checkbox"
            checked={prefs.pins.extras.newBadge}
            onChange={(e) =>
              extras({ newBadge: e.target.checked }, `Pins: new badge ${onOff(e.target.checked)}`)
            }
          />
          New badge
        </label>
      </fieldset>

      <fieldset className={styles.lsec}>
        <legend className={styles.lt}>Pin color</legend>
        <div className={styles.seg}>
          {COLOR_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={prefs.pins.colorBy === o.id}
              onClick={() => pins({ colorBy: o.id }, `Pin color: ${o.label}`)}
            >
              {o.label}
            </button>
          ))}
        </div>
        {prefs.pins.colorBy === 'price' && (
          <p className={styles.lnote}>Uses rent until total cost arrives (M8).</p>
        )}
        <label className={styles.chk} style={{ marginTop: 8 }}>
          <input
            type="checkbox"
            checked={prefs.pins.simplifyWhenCrowded}
            onChange={(e) =>
              pins(
                { simplifyWhenCrowded: e.target.checked },
                `Shrink pins when crowded ${onOff(e.target.checked)}`,
              )
            }
          />
          Shrink pins to dots when zoomed out or crowded
        </label>
        <label className={styles.chk}>
          <input
            type="checkbox"
            checked={prefs.pins.fadeRejected}
            onChange={(e) =>
              pins(
                { fadeRejected: e.target.checked },
                `Fade rejected units ${onOff(e.target.checked)}`,
              )
            }
          />
          Fade rejected units
        </label>
      </fieldset>

      <fieldset className={styles.lsec} disabled>
        <legend className={styles.lt}>
          Overlays <span className={styles.tag}>Phase 2</span>
        </legend>
        {OVERLAYS.map((o) => (
          <label key={o} className={`${styles.chk} ${styles.off}`}>
            <input type="checkbox" disabled /> {o}
          </label>
        ))}
        <p className={styles.lnote}>Shown here for reference; these arrive with Phase 2.</p>
      </fieldset>
    </section>
  );
}

const onOff = (on: boolean) => (on ? 'on' : 'off');
