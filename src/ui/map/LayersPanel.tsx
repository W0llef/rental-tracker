import { useEffect, useRef } from 'react';
import type { BaseLayer } from '../../domain/pinPrefs';
import { BASE_MAPS } from './baseMaps';
import styles from './map.module.css';

const OVERLAYS = [
  'Skyway routes',
  'Transit lines and stops',
  'Bike trails and protected lanes',
  'Neighborhood boundaries',
  'Reported crime',
  'All residential buildings',
  'Reachable within N minutes',
];

function ExtLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className={styles.vh}> (opens in a new tab)</span>
    </a>
  );
}

/** Wayfinding uses our own colors (DESIGN.md §2.5), so its key is drawn from the tokens. */
const WAYFINDING_KEY = [
  ['--map-water', 'Water'],
  ['--map-park', 'Parks'],
  ['--map-bldg', 'Buildings'],
  ['--map-hwy', 'Highways'],
  ['--map-road', 'Streets'],
] as const;

/** The key for the chosen base map: our own for Wayfinding, the publisher's for the rest. */
function BaseKey({ base }: { base: BaseLayer }) {
  switch (base) {
    case 'wayfinding':
      return (
        <ul className={styles.keyRows} aria-label="Wayfinding colors">
          {WAYFINDING_KEY.map(([token, label]) => (
            <li key={token}>
              <i
                className={styles.keySwatch}
                style={{ background: `var(${token})` }}
                aria-hidden="true"
              />
              {label}
            </li>
          ))}
        </ul>
      );
    case 'streets':
      return (
        <p className={styles.lnote}>
          Shops, transit stations, parks and other places are named on the map with their icons, so
          this map needs no separate key.
        </p>
      );
    case 'osm':
      return (
        <p className={styles.lnote}>
          The OpenStreetMap key:{' '}
          <ExtLink href="https://wiki.openstreetmap.org/wiki/OpenStreetMap_Carto/Lines">
            roads, paths and rail
          </ExtLink>{' '}
          and{' '}
          <ExtLink href="https://wiki.openstreetmap.org/wiki/OpenStreetMap_Carto/Symbols">
            map symbols
          </ExtLink>
          .
        </p>
      );
    case 'cycle':
      return (
        <p className={styles.lnote}>
          Bike lanes, trails and parking colors are explained in the{' '}
          <ExtLink href="https://www.cyclosm.org/legend.html">CyclOSM legend</ExtLink>.
        </p>
      );
    case 'aerial':
      return (
        <p className={styles.lnote}>
          Photographs: 2025 seven-county metro imagery (1 ft), with 2025 statewide imagery outside
          the metro. From MnGeo and the Metropolitan Council.
        </p>
      );
  }
}

/**
 * The Map layers panel (M3 review): the base map with its key, and the Phase 2 overlays,
 * shown disabled so nothing moves when they arrive. Pin options live in the Pins panel.
 */
export function LayersPanel({
  base,
  onBase,
  sharper,
  onSharper,
  onClose,
}: {
  base: BaseLayer;
  onBase: (base: BaseLayer) => void;
  sharper: boolean;
  onSharper: (on: boolean) => void;
  onClose: () => void;
}) {
  const raster = base === 'osm' || base === 'cycle';
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const current = BASE_MAPS.find((b) => b.id === base);

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
              aria-pressed={base === b.id}
              onClick={() => onBase(b.id)}
            >
              <span className={`${styles.bt} ${styles[`bt-${b.id}`]}`} aria-hidden="true" />
              <span className={styles.bn}>{b.name}</span>
              <span className={styles.bs}>{b.blurb}</span>
            </button>
          ))}
        </div>
      </fieldset>

      {raster && (
        <div className={styles.lsec}>
          <label className={styles.chk}>
            <input
              type="checkbox"
              checked={sharper}
              onChange={(e) => onSharper(e.target.checked)}
              aria-describedby="sharper-note"
            />
            Sharper OpenStreetMap and Cycle maps
          </label>
          <p id="sharper-note" className={styles.lnote}>
            Uses the next zoom level’s tiles: crisper, but about 4× the downloads from volunteer-run
            servers. Wayfinding and Detailed streets are always sharp.
          </p>
        </div>
      )}

      <section className={styles.lsec} aria-labelledby="base-key-title">
        <h4 id="base-key-title" className={styles.lt}>
          Key: {current?.name}
        </h4>
        <BaseKey base={base} />
      </section>

      <fieldset className={styles.lsec} disabled>
        <legend className={styles.lt}>
          Overlays <span className={styles.tag}>Phase 2</span>
        </legend>
        {OVERLAYS.map((o) => (
          <label key={o} className={`${styles.chk} ${styles.off}`}>
            <input type="checkbox" disabled /> {o}
          </label>
        ))}
        <p className={styles.lnote}>
          Coming in Phase 2, each with its own key. You’ll be able to click a trail, stop or route
          to see what it is.
        </p>
      </fieldset>
    </section>
  );
}
