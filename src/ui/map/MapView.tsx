import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import MapGL, { AttributionControl, Marker } from 'react-map-gl/maplibre';
import type { MapRef } from 'react-map-gl/maplibre';
import { setWorkerUrl } from 'maplibre-gl';
import type { StyleSpecification } from 'maplibre-gl';
// MapLibre 6 runs its tile parsing in a module worker it can't locate once bundled; ship the
// worker file as an asset and point MapLibre at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useNavigate } from 'react-router-dom';
import Supercluster from 'supercluster';
import { updateSettings } from '../../commands/records';
import { db } from '../../db/db';
import { DEFAULT_CENTER, DEFAULT_ZOOM, boundsOf } from '../../domain/geo';
import { CLUSTER_MAX_ZOOM, estimatePinSize, fanOffsets, fullPins } from '../../domain/pinLayout';
import type { PinBox } from '../../domain/pinLayout';
import {
  buildingRangeText,
  edgeColor,
  effectivePinShow,
  fanOrder,
  groupPinLabel,
  isNew,
  isRejected,
  leadUnit,
  legendFor,
  pinText,
  priceScale,
  starText,
  unitPinLabel,
} from '../../domain/pins';
import type { PriceScale } from '../../domain/pins';
import { buildingName, rangeLabel } from '../../domain/format';
import { deriveMapItems } from '../../state/derive';
import type { Dataset, ListView, MapBuilding, UnitRow } from '../../state/derive';
import { loadViewport, saveViewport, useUi } from '../../state/ui';
import type { ListMode } from '../../state/ui';
import type { MapPrefs } from '../../model';
import { BASE_MAPS, paletteFromTokens, styleFor } from './baseMaps';
import { LayersPanel } from './LayersPanel';
import type { MapPrefsChange } from './LayersPanel';
import { Legend } from './Legend';
import { Pin } from './Pin';
import styles from './map.module.css';

/**
 * The map (PLAN.md §4.3): HTML sign-plate pins for the buildings the list shows, grouped
 * per building with a fan-out, neighborhood bubbles at low zoom, dots when crowded, the
 * Map layers panel and a legend. Loaded on demand so the list appears without waiting for
 * MapLibre.
 */

export interface MapViewProps {
  data: Dataset;
  listView: ListView;
  view: ListMode;
  /** `unit:<id>` or `building:<id>` from the URL. */
  selectedKey: string | null;
}

setWorkerUrl(workerUrl);

const MAP_LOCALE = {
  'Map.Title': 'Map view. Use the arrow keys to pan, plus and minus to zoom.',
};

// ── Theme ──────────────────────────────────────────────────────────────────

const darkQuery = '(prefers-color-scheme: dark)';

function subscribeTheme(cb: () => void) {
  const mq = window.matchMedia?.(darkQuery);
  mq?.addEventListener('change', cb);
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    mq?.removeEventListener('change', cb);
    obs.disconnect();
  };
}

function isDark(): boolean {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'dark' || forced === 'light') return forced === 'dark';
  return window.matchMedia?.(darkQuery).matches ?? false;
}

const useDarkTheme = () => useSyncExternalStore(subscribeTheme, isDark, () => false);

const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// ── Layout of pins on screen ───────────────────────────────────────────────

interface Bubble {
  id: number;
  lng: number;
  lat: number;
  units: number;
}

interface Layout {
  zoom: number;
  bubbles: Bubble[];
  /** Buildings drawn as pins (in view, not inside a bubble). */
  shown: Set<string>;
  /** Of those, the ones drawn in full (the rest are dots). */
  full: Set<string>;
}

const emptyLayout: Layout = { zoom: 0, bubbles: [], shown: new Set(), full: new Set() };

type PointProps = { id: string; units: number };

/** A building's key for hover and selection matching. */
const unitKey = (r: UnitRow) => `unit:${r.unit.id}`;

export default function MapView({ data, listView, view, selectedKey }: MapViewProps) {
  const navigate = useNavigate();
  const mapRef = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  const { hoverKey, setHover, layersOpen, setLayersOpen, toggleLayers, fannedId, setFanned } =
    useUi();
  const layersBtn = useRef<HTMLButtonElement>(null);

  // Choices show at once; the saved settings take over as soon as the database has them.
  const [pending, setPending] = useState<{ from: MapPrefs; value: MapPrefs } | null>(null);
  const prefs = pending && pending.from === data.settings.map ? pending.value : data.settings.map;
  const show = effectivePinShow(prefs.pins.show);
  const items = useMemo(() => deriveMapItems(listView, view), [listView, view]);
  const byId = useMemo(() => new Map(items.buildings.map((b) => [b.id, b])), [items]);

  // ── Selection ──
  const [selKind, selId] = selectedKey
    ? (selectedKey.split(':') as [string, string])
    : [null, null];
  const selectedBuildingId =
    selKind === 'unit'
      ? (data.unitById.get(selId as string)?.unit.buildingId ?? null)
      : selKind === 'building'
        ? selId
        : null;
  // A selected unit in a grouped building opens its fan, so its own pin shows.
  const autoFan =
    view === 'units' &&
    selKind === 'unit' &&
    selectedBuildingId &&
    (byId.get(selectedBuildingId)?.units.length ?? 0) > 1
      ? selectedBuildingId
      : null;
  const fanned = view === 'units' ? (fannedId ?? autoFan) : null;
  const hoverBuildingId = hoverKey?.startsWith('unit:')
    ? (data.unitById.get(hoverKey.slice(5))?.unit.buildingId ?? null)
    : hoverKey?.startsWith('building:')
      ? hoverKey.slice(9)
      : null;

  // ── Colors ──
  const allUnits = useMemo(
    () => items.buildings.flatMap((b) => b.units.map((u) => u.unit)),
    [items],
  );
  const scale: PriceScale | null = useMemo(() => priceScale(allUnits), [allUnits]);
  const legend = useMemo(
    () => legendFor(allUnits, prefs.pins.colorBy, data.settings.labelNames),
    [allUnits, prefs.pins.colorBy, data.settings.labelNames],
  );

  // ── Base map style ──
  const dark = useDarkTheme();
  const [style, setStyle] = useState<StyleSpecification | string | null>(null);
  // Problems are remembered per base map, so switching maps clears the message.
  const [failedBase, setFailedBase] = useState<string | null>(null);
  const failed = failedBase === prefs.baseLayer;
  useEffect(() => {
    let live = true;
    const base = prefs.baseLayer;
    styleFor(base, data.settings.mapStyleUrl, paletteFromTokens())
      .then((s) => {
        if (live) setStyle(s);
      })
      .catch(() => {
        if (live) setFailedBase(base);
      });
    return () => {
      live = false;
    };
    // `dark` re-reads the palette when the theme flips
  }, [prefs.baseLayer, data.settings.mapStyleUrl, dark]);

  // ── Clustering (low zoom) — the selected building never hides in a bubble ──
  const index = useMemo(() => {
    const sc = new Supercluster<PointProps, { units: number }>({
      radius: 56,
      maxZoom: CLUSTER_MAX_ZOOM,
      map: (p) => ({ units: p.units }),
      reduce: (acc, p) => {
        acc.units += p.units;
      },
    });
    sc.load(
      items.buildings
        .filter((b) => b.id !== selectedBuildingId)
        .map((b) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [b.lng, b.lat] },
          properties: { id: b.id, units: b.units.length },
        })),
    );
    return sc;
  }, [items, selectedBuildingId]);

  // ── What each building's pin looks like (text, size) ──
  const pinInfo = useCallback(
    (b: MapBuilding) => {
      if (view === 'buildings') {
        return { text: buildingRangeText(b.units), lead: leadUnit(b.units), count: b.units.length };
      }
      const lead = leadUnit(b.units);
      const grouped = b.units.length > 1;
      return { text: lead ? pinText(lead, show, grouped) : null, lead, count: b.units.length };
    },
    [view, show],
  );

  // ── Relayout: which pins are in view, bubbled, full or dots ──
  const [layout, setLayout] = useState<Layout>(emptyLayout);
  const relayout = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const padLng = (bounds.getEast() - bounds.getWest()) * 0.25;
    const padLat = (bounds.getNorth() - bounds.getSouth()) * 0.25;
    const bbox: [number, number, number, number] = [
      bounds.getWest() - padLng,
      bounds.getSouth() - padLat,
      bounds.getEast() + padLng,
      bounds.getNorth() + padLat,
    ];
    const bubbles: Bubble[] = [];
    const shown = new Set<string>();
    for (const f of index.getClusters(bbox, Math.floor(zoom))) {
      const [lng, lat] = f.geometry.coordinates as [number, number];
      const p = f.properties as PointProps & {
        cluster?: boolean;
        cluster_id?: number;
        units: number;
      };
      if (p.cluster) bubbles.push({ id: p.cluster_id as number, lng, lat, units: p.units });
      else shown.add(p.id);
    }
    if (selectedBuildingId && byId.has(selectedBuildingId)) shown.add(selectedBuildingId);

    // Rank cheaper leads first for who gets drawn in full
    const ranked = [...shown]
      .map((id) => byId.get(id))
      .filter((b): b is MapBuilding => !!b)
      .map((b) => ({ b, info: pinInfo(b) }))
      .sort((x, y) => (x.info.lead?.unit.rent ?? Infinity) - (y.info.lead?.unit.rent ?? Infinity));
    const boxes: PinBox[] = ranked.map(({ b, info }, i) => {
      const pt = map.project([b.lng, b.lat]);
      const size = estimatePinSize(view === 'buildings' ? 'rent' : show, info.text, {
        icon: prefs.pins.extras.typeIcon,
        stars: prefs.pins.extras.stars,
        count: info.count > 1,
      });
      const keep = b.id === selectedBuildingId || b.id === hoverBuildingId || b.id === fanned;
      return { id: b.id, x: pt.x, y: pt.y, w: size.w, h: size.h, priority: i, keepFull: keep };
    });
    setLayout({
      zoom,
      bubbles,
      shown,
      full: fullPins(boxes, zoom, prefs.pins.simplifyWhenCrowded),
    });
  }, [index, byId, selectedBuildingId, hoverBuildingId, fanned, pinInfo, show, view, prefs.pins]);

  useEffect(() => {
    if (loaded) relayout();
  }, [loaded, relayout]);

  // ── Initial view: remembered, else fit your units, else downtown ──
  const [initialView] = useState(
    () =>
      loadViewport() ?? {
        longitude: DEFAULT_CENTER.lng,
        latitude: DEFAULT_CENTER.lat,
        zoom: DEFAULT_ZOOM,
      },
  );
  const fitted = useRef(loadViewport() !== null);
  const fitAll = useCallback(
    (animate: boolean) => {
      const map = mapRef.current;
      const b = boundsOf(items.buildings);
      if (!map || !b) return;
      // Plates sit above their point and are up to ~140 px wide: leave room for them.
      map.fitBounds(b, {
        padding: fitPadding(map.getContainer()),
        maxZoom: 15,
        duration: animate && !reducedMotion() ? 400 : 0,
      });
    },
    [items],
  );
  // On a phone the map may start hidden behind the List tab (no size yet): fit once it shows.
  const fitFirstTime = useCallback(() => {
    const el = mapRef.current?.getContainer();
    if (fitted.current || !items.buildings.length || !el?.clientWidth || !el.clientHeight) return;
    fitted.current = true;
    fitAll(false);
  }, [items, fitAll]);
  useEffect(() => {
    if (loaded) fitFirstTime();
  }, [loaded, fitFirstTime]);

  // ── Selecting a card (or opening a fan) brings it into view (DESIGN.md §2.9: 400 ms) ──
  // Opening the detail column narrows the map, so check again once the map has resized.
  const bringIntoView = useRef<() => void>(() => {});
  useEffect(() => {
    bringIntoView.current = () => {
      const map = mapRef.current;
      const target = fanned ?? selectedBuildingId;
      const b = target ? byId.get(target) : undefined;
      if (!map || !b) return;
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      if (!w || !h) return; // hidden (phone, another tab)
      const fan = b.units.length > 1 && view === 'units' ? 130 : 0;
      const p = map.project([b.lng, b.lat]);
      const inside = p.x > 90 + fan && p.x < w - 110 - fan && p.y > 70 + fan && p.y < h - 50;
      if (!inside) map.easeTo({ center: [b.lng, b.lat], duration: reducedMotion() ? 0 : 400 });
    };
  });
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!loaded || !map || !(fanned ?? selectedBuildingId)) return;
    const check = () => bringIntoView.current();
    check();
    map.once('resize', check);
    return () => {
      map.off('resize', check);
    };
  }, [loaded, selectedBuildingId, fanned]);

  // A fan opened by clicking closes when the selection moves elsewhere
  useEffect(() => {
    if (fannedId && selectedBuildingId && selectedBuildingId !== fannedId) setFanned(null);
  }, [selectedBuildingId, fannedId, setFanned]);
  useEffect(() => {
    if (fannedId && !byId.get(fannedId)) setFanned(null);
  }, [byId, fannedId, setFanned]);

  // Closing the layers panel returns focus to its button
  const wasOpen = useRef(layersOpen);
  useEffect(() => {
    if (wasOpen.current && !layersOpen && document.activeElement === document.body)
      layersBtn.current?.focus();
    wasOpen.current = layersOpen;
  }, [layersOpen]);

  const changePrefs = useCallback(
    (change: MapPrefsChange, label: string) => {
      setPending({ from: data.settings.map, value: change(prefs) });
      void updateSettings(db, (s) => ({ ...s, map: change(s.map) }), label);
    },
    [data.settings.map, prefs],
  );

  const select = (key: string) =>
    navigate(`/${key.replace(':', '/')}`, { replace: selectedKey !== null });

  // ── Rendering helpers ──
  const fadeRejected = prefs.pins.fadeRejected;
  const unitPin = (r: UnitRow, opts: { grouped?: MapBuilding; dot: boolean; pinKey: string }) => {
    const u = r.unit;
    const grouped = opts.grouped;
    const count = grouped ? grouped.units.length : 1;
    const selected = !grouped && selectedKey === unitKey(r);
    const rejected = isRejected(u) && (!grouped || grouped.units.every((x) => isRejected(x.unit)));
    return (
      <Pin
        pinKey={opts.pinKey}
        show={show}
        text={pinText(r, show, !!grouped)}
        type={u.type}
        stars={prefs.pins.extras.stars ? starText(u.rating) : null}
        showTypeIcon={prefs.pins.extras.typeIcon}
        count={count}
        edge={edgeColor(u, prefs.pins.colorBy, scale)}
        selected={selected}
        rejected={rejected}
        faded={rejected && fadeRejected}
        dot={opts.dot && !selected}
        newBadge={
          prefs.pins.extras.newBadge &&
          (grouped ? grouped.units.some((x) => isNew(x.unit)) : isNew(u))
        }
        label={grouped ? groupPinLabel(grouped.building, grouped.units) : unitPinLabel(r)}
        expanded={grouped ? false : undefined}
        onClick={() => (grouped ? setFanned(grouped.id) : select(unitKey(r)))}
        onHover={(on) => setHover(on ? (grouped ? `building:${grouped.id}` : unitKey(r)) : null)}
      />
    );
  };

  const markers: ReactNode[] = [];
  for (const id of layout.shown) {
    const b = byId.get(id);
    if (!b) continue;
    const dot = !layout.full.has(id);
    const isSel = id === selectedBuildingId;
    const isHover = id === hoverBuildingId;
    const z = isSel ? 4 : id === fanned ? 3 : isHover ? 2 : dot ? 0 : 1;

    if (view === 'buildings') {
      const lead = leadUnit(b.units);
      const key = `building:${b.id}`;
      const selected = selectedKey === key;
      const rejected = b.units.every((x) => isRejected(x.unit));
      markers.push(
        <Marker
          key={id}
          longitude={b.lng}
          latitude={b.lat}
          style={{ zIndex: z }}
          className={styles.anchor}
        >
          <Pin
            pinKey={key}
            show={show === 'dot' ? 'dot' : 'rent'}
            text={buildingRangeText(b.units)}
            type={lead?.unit.type ?? null}
            stars={null}
            showTypeIcon={false}
            count={b.units.length}
            edge={lead ? edgeColor(lead.unit, prefs.pins.colorBy, scale) : 'var(--ice)'}
            selected={selected}
            rejected={rejected}
            faded={rejected && fadeRejected}
            dot={dot && !selected}
            newBadge={prefs.pins.extras.newBadge && b.units.some((x) => isNew(x.unit))}
            label={`${buildingName(b.building)}, ${b.units.length} of your units${
              rangeLabel(...minMax(b.units)) ? `, ${rangeLabel(...minMax(b.units))}` : ''
            }`}
            onClick={() => select(key)}
            onHover={(on) => setHover(on ? key : null)}
          />
        </Marker>,
      );
      continue;
    }

    if (b.units.length === 1) {
      const r = b.units[0] as UnitRow;
      markers.push(
        <Marker
          key={id}
          longitude={b.lng}
          latitude={b.lat}
          style={{ zIndex: z }}
          className={styles.anchor}
        >
          {unitPin(r, { dot, pinKey: unitKey(r) })}
        </Marker>,
      );
      continue;
    }

    if (id === fanned) {
      const ordered = fanOrder(b.units);
      const offsets = fanOffsets(ordered.length, show === 'photo' ? 64 : 96);
      const reach = Math.max(...offsets.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y)))) + 8;
      markers.push(
        <Marker
          key={id}
          longitude={b.lng}
          latitude={b.lat}
          style={{ zIndex: 3 + (isSel ? 1 : 0) }}
          className={styles.anchor}
        >
          <div role="group" aria-label={`Units at ${buildingName(b.building)}`} data-fan={b.id}>
            <svg
              className={styles.fan}
              width={reach * 2}
              height={reach * 2}
              viewBox={`${-reach} ${-reach} ${reach * 2} ${reach * 2}`}
              style={{ left: -reach, top: -reach }}
              aria-hidden="true"
            >
              {offsets.map(([x, y], i) => (
                <line key={i} className={styles.fanLine} x1={0} y1={0} x2={x} y2={y} />
              ))}
              <circle className={styles.fanHub} cx={0} cy={0} r={7} />
            </svg>
            {ordered.map((r, i) => {
              const [x, y] = offsets[i] as [number, number];
              return (
                <div key={r.unit.id} className={styles.fanned} style={{ left: x, top: y }}>
                  {unitPin(r, { dot: false, pinKey: unitKey(r) })}
                </div>
              );
            })}
          </div>
        </Marker>,
      );
      continue;
    }

    const lead = leadUnit(b.units) as UnitRow;
    markers.push(
      <Marker
        key={id}
        longitude={b.lng}
        latitude={b.lat}
        style={{ zIndex: z }}
        className={styles.anchor}
      >
        {unitPin(lead, { grouped: b, dot, pinKey: `building:${b.id}` })}
      </Marker>,
    );
  }

  for (const c of layout.bubbles) {
    markers.push(
      <Marker
        key={`c${c.id}`}
        longitude={c.lng}
        latitude={c.lat}
        style={{ zIndex: 1 }}
        className={styles.anchor}
      >
        <button
          type="button"
          className={styles.bubble}
          aria-label={`${c.units} units here. Zoom in`}
          data-bubble={c.units}
          onClick={(e) => {
            e.stopPropagation();
            const zoom = Math.min(index.getClusterExpansionZoom(c.id), CLUSTER_MAX_ZOOM + 1);
            mapRef.current?.easeTo({
              center: [c.lng, c.lat],
              zoom: Math.max(zoom, layout.zoom + 1),
              duration: reducedMotion() ? 0 : 400,
            });
          }}
        >
          <span>{c.units}</span>
        </button>
      </Marker>,
    );
  }

  const baseName = BASE_MAPS.find((b) => b.id === prefs.baseLayer)?.name ?? 'base';
  const zoomBy = (d: number) => {
    const map = mapRef.current;
    if (map) map.zoomTo(map.getZoom() + d, { duration: reducedMotion() ? 0 : 200 });
  };

  return (
    <div className={styles.root} data-base={prefs.baseLayer} data-zoom={layout.zoom.toFixed(1)}>
      {style && (
        <MapGL
          ref={mapRef}
          initialViewState={initialView}
          mapStyle={style}
          style={{ position: 'absolute', inset: 0 }}
          attributionControl={false}
          // The canvas is its own landmark; name it apart from our "Map" region
          locale={MAP_LOCALE}
          maxZoom={20}
          minZoom={3}
          dragRotate={false}
          pitchWithRotate={false}
          touchPitch={false}
          onLoad={() => setLoaded(true)}
          onResize={() => {
            fitFirstTime();
            relayout();
          }}
          onMoveEnd={(e) => {
            const c = e.target.getCenter();
            saveViewport({ longitude: c.lng, latitude: c.lat, zoom: e.target.getZoom() });
            relayout();
          }}
          onClick={(e) => {
            const target = e.originalEvent?.target as Element | null;
            if (target?.closest?.('[data-pin],[data-bubble]')) return;
            if (fannedId) setFanned(null);
          }}
          onError={(e) => {
            const err = e as unknown as { sourceId?: string; tile?: unknown };
            if (err.sourceId || err.tile) setFailedBase(prefs.baseLayer);
          }}
        >
          <AttributionControl compact position="bottom-right" />
          {markers}
        </MapGL>
      )}

      <div className={styles.notes}>
        {items.needLocation > 0 && (
          <p className={styles.note}>
            {items.needLocation === 1
              ? '1 unit needs a location'
              : `${items.needLocation} units need a location`}
          </p>
        )}
        {failed && (
          <p className={`${styles.note} ${styles.warn}`} role="status">
            {prefs.baseLayer === 'aerial'
              ? 'Aerial photos couldn’t load. Try another base map in Layers.'
              : `Couldn’t load the ${baseName} map. Check your connection, or pick another base map in Layers.`}
          </p>
        )}
      </div>

      <div className={styles.controls}>
        <button
          ref={layersBtn}
          type="button"
          className={styles.layersBtn}
          aria-expanded={layersOpen}
          aria-controls="map-layers"
          title="Map layers (L)"
          onClick={toggleLayers}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M10 3 2.5 7 10 11l7.5-4z" />
            <path d="m2.5 10.5 7.5 4 7.5-4" />
            <path d="m2.5 14 7.5 4 7.5-4" />
          </svg>
          <span className={styles.layersLabel}>Layers</span>
          <span className={styles.kbd} aria-hidden="true">
            L
          </span>
        </button>
        <div className={styles.grp}>
          <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1)}>
            +
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoomBy(-1)}>
            −
          </button>
        </div>
        <div className={styles.grp}>
          <button
            type="button"
            className={styles.fit}
            aria-label="Fit all units"
            title="Fit all units"
            disabled={!items.buildings.length}
            onClick={() => fitAll(true)}
          >
            Fit
          </button>
        </div>
      </div>

      {layersOpen && (
        <LayersPanel prefs={prefs} onChange={changePrefs} onClose={() => setLayersOpen(false)} />
      )}

      {items.buildings.length > 0 && <Legend legend={legend} />}
    </div>
  );
}

function minMax(units: readonly UnitRow[]): [number | null, number | null] {
  const rents = units.map((u) => u.unit.rent).filter((r): r is number => r !== null);
  return rents.length ? [Math.min(...rents), Math.max(...rents)] : [null, null];
}

/** Room around "Fit all units": plates sit above their point and are up to ~140 px wide. */
function fitPadding(el: HTMLElement) {
  const k = Math.min(1, el.clientWidth / 900);
  return {
    top: Math.round(72 * k) + 8,
    bottom: Math.round(40 * k) + 8,
    left: Math.round(90 * k) + 8,
    right: Math.round(110 * k) + 8,
  };
}
