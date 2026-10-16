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
import { DEFAULT_CENTER, DEFAULT_ZOOM, boundsOf } from '../../domain/geo';
import {
  AUTO_FAN_ZOOM,
  CLUSTER_MAX_ZOOM,
  STREET_ZOOM,
  autoFans,
  estimatePinSize,
  fanOffsets,
  fanRect,
  fullPins,
  pinRect,
} from '../../domain/pinLayout';
import type { PinBox, Rect } from '../../domain/pinLayout';
import {
  allRejected,
  buildingPinLabel,
  edgeColor,
  edgeStripes,
  fanOrder,
  isNew,
  isRejected,
  legendFor,
  lowestRent,
  pinContent,
  pinnedUnits,
  priceScale,
  summarizedUnits,
  unitPinLabel,
} from '../../domain/pins';
import type { PinContent, PriceScale } from '../../domain/pins';
import type { PinPrefs } from '../../domain/pinPrefs';
import { buildingName } from '../../domain/format';
import { deriveMapItems } from '../../state/derive';
import type { Dataset, ListView, MapBuilding, UnitRow } from '../../state/derive';
import { loadViewport, saveViewport, useUi } from '../../state/ui';
import type { ListMode } from '../../state/ui';
import { BASE_MAPS, paletteFromTokens, styleFor } from './baseMaps';
import { LayersPanel } from './LayersPanel';
import { Legend } from './Legend';
import { Pin } from './Pin';
import { PinsPanel } from './PinsPanel';
import styles from './map.module.css';

/**
 * The map (PLAN.md §4.3): HTML pins for the buildings the list shows. A building with
 * several units shows one pin summarizing them (ranges, one stripe per unit) and fans out
 * on click; several fans can be open at once, and at street zoom buildings fan out by
 * themselves where they have room. Neighborhood bubbles at low zoom, dots when crowded, a
 * Pins panel and a Map layers panel. Loaded on demand so the list appears first.
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
  shown: string[];
  /** Of those, the ones drawn in full (the rest are dots). */
  full: Set<string>;
  /** Buildings fanned out, with each unit's offset from the hub. */
  fans: Map<string, [number, number][]>;
  /** Fans that opened by themselves (street zoom). */
  autoOpen: string[];
}

const emptyLayout: Layout = {
  zoom: 0,
  bubbles: [],
  shown: [],
  full: new Set(),
  fans: new Map(),
  autoOpen: [],
};

type PointProps = { id: string; units: number };

const unitKey = (r: UnitRow) => `unit:${r.unit.id}`;

/** One building as the map draws it: the units it pins and the ones its summary covers. */
interface Placed extends MapBuilding {
  /** Units on the map ("Hide" drops rejected ones). */
  pinned: UnitRow[];
  /** Units the summary covers ("Fade"/"Hide" leave rejected ones out). */
  summary: UnitRow[];
  content: PinContent;
  /** Units view and more than one unit: a group that can fan out. */
  group: boolean;
}

export default function MapView({ data, listView, view, selectedKey }: MapViewProps) {
  const navigate = useNavigate();
  const mapRef = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  const ui = useUi();
  const { hoverKey, setHover, panel, setPanel, togglePanel, openFans, foldedFans } = ui;
  const layersBtn = useRef<HTMLButtonElement>(null);
  const pinsBtn = useRef<HTMLButtonElement>(null);

  const prefs: PinPrefs = ui.map.pins[view];
  const baseLayer = ui.map.baseLayer;

  // ── Selection ──
  const [selKind, selId] = selectedKey
    ? (selectedKey.split(':') as [string, string])
    : [null, null];
  const selectedUnitId = selKind === 'unit' ? (selId as string) : null;
  const selectedBuildingId =
    selKind === 'unit'
      ? (data.unitById.get(selId as string)?.unit.buildingId ?? null)
      : selKind === 'building'
        ? selId
        : null;

  // ── What each building pin stands for ──
  const items = useMemo(() => deriveMapItems(listView, view), [listView, view]);
  const placed = useMemo(() => {
    const out: Placed[] = [];
    for (const b of items.buildings) {
      const pinned = pinnedUnits(b.units, prefs.rejected, selectedUnitId);
      if (!pinned.length) continue;
      const summary = summarizedUnits(pinned, prefs.rejected);
      const group = view === 'units' && pinned.length > 1;
      const content = pinContent(summary, prefs, view === 'buildings' || group);
      out.push({ ...b, pinned, summary, content, group });
    }
    return out;
  }, [items, prefs, selectedUnitId, view]);
  const byId = useMemo(() => new Map(placed.map((b) => [b.id, b])), [placed]);

  const hoverBuildingId = hoverKey?.startsWith('unit:')
    ? (data.unitById.get(hoverKey.slice(5))?.unit.buildingId ?? null)
    : hoverKey?.startsWith('building:')
      ? hoverKey.slice(9)
      : null;

  // A selected unit's building opens, unless you folded it since.
  const forcedFan =
    selectedUnitId &&
    selectedBuildingId &&
    byId.get(selectedBuildingId)?.group &&
    !foldedFans.includes(selectedBuildingId)
      ? selectedBuildingId
      : null;
  const clickedFans = useMemo(() => openFans.filter((id) => byId.get(id)?.group), [openFans, byId]);

  // ── Colors ──
  const summaryUnits = useMemo(() => placed.flatMap((b) => b.summary.map((u) => u.unit)), [placed]);
  const scale: PriceScale | null = useMemo(() => priceScale(summaryUnits), [summaryUnits]);
  const legend = useMemo(
    () => (placed.length ? legendFor(summaryUnits, prefs.colorBy, data.settings.labelNames) : null),
    [placed.length, summaryUnits, prefs.colorBy, data.settings.labelNames],
  );

  // ── Base map style ──
  const dark = useDarkTheme();
  const [style, setStyle] = useState<StyleSpecification | string | null>(null);
  // Problems are remembered per base map, so switching maps clears the message.
  const [failedBase, setFailedBase] = useState<string | null>(null);
  const failed = failedBase === baseLayer;
  useEffect(() => {
    let live = true;
    styleFor(baseLayer, data.settings.mapStyleUrl, paletteFromTokens())
      .then((s) => {
        if (live) setStyle(s);
      })
      .catch(() => {
        if (live) setFailedBase(baseLayer);
      });
    return () => {
      live = false;
    };
    // `dark` re-reads the palette when the theme flips
  }, [baseLayer, data.settings.mapStyleUrl, dark]);

  // ── Bubbles (low zoom): the selected building and open fans never hide in one ──
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
      placed
        .filter((b) => b.id !== selectedBuildingId)
        .map((b) => ({
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [b.lng, b.lat] },
          properties: { id: b.id, units: b.pinned.length },
        })),
    );
    return sc;
  }, [placed, selectedBuildingId]);

  // ── Sizes ──
  const unitPinSize = useCallback(
    (r: UnitRow) => {
      const c = pinContent([r], prefs, false);
      return estimatePinSize(
        prefs.style,
        c.segments.map((s) => s.text),
        {
          icon: !!c.typeIcon,
          count: false,
          tag: prefs.newBadge === 'tag' && isNew(r.unit),
        },
      );
    },
    [prefs],
  );
  const fanGeometry = useCallback(
    (b: Placed) => {
      const sizes = b.pinned.map(unitPinSize);
      const w = Math.max(...sizes.map((s) => s.w)) + 8;
      const h = Math.max(...sizes.map((s) => s.h)) + 4;
      return { offsets: fanOffsets(b.pinned.length, w, h), w, h };
    },
    [unitPinSize],
  );

  // ── Relayout: which pins are in view, bubbled, fanned, full or dots ──
  const [layout, setLayout] = useState<Layout>(emptyLayout);
  const lastZoom = useRef(Infinity);
  const relayout = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (!map) return;
    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const padLng = (bounds.getEast() - bounds.getWest()) * 0.25;
    const padLat = (bounds.getNorth() - bounds.getSouth()) * 0.25;
    const [w, s, e, n] = [
      bounds.getWest() - padLng,
      bounds.getSouth() - padLat,
      bounds.getEast() + padLng,
      bounds.getNorth() + padLat,
    ];
    const bubbles: Bubble[] = [];
    const shown = new Set<string>();
    if (prefs.bubbles) {
      for (const f of index.getClusters([w, s, e, n], Math.floor(zoom))) {
        const [lng, lat] = f.geometry.coordinates as [number, number];
        const p = f.properties as PointProps & {
          cluster?: boolean;
          cluster_id?: number;
          units: number;
        };
        if (p.cluster) bubbles.push({ id: p.cluster_id as number, lng, lat, units: p.units });
        else shown.add(p.id);
      }
    } else {
      for (const b of placed)
        if (b.lng >= w && b.lng <= e && b.lat >= s && b.lat <= n) shown.add(b.id);
    }
    if (selectedBuildingId && byId.has(selectedBuildingId)) shown.add(selectedBuildingId);

    // Cheaper buildings first: they keep their plate and get their fan first
    const ranked = [...shown]
      .map((id) => byId.get(id))
      .filter((b): b is Placed => !!b)
      .sort((x, y) => lowestRent(x.summary) - lowestRent(y.summary));
    const pt = new Map(ranked.map((b) => [b.id, map.project([b.lng, b.lat])]));

    // Fans: clicked and selected ones, then automatic ones where there's room
    const fans = new Map<string, [number, number][]>();
    const fanRects: Rect[] = [];
    const openNow = new Set([...clickedFans, ...(forcedFan ? [forcedFan] : [])]);
    const geom = new Map<string, ReturnType<typeof fanGeometry>>();
    for (const b of ranked) {
      if (!b.group || !openNow.has(b.id)) continue;
      const g = fanGeometry(b);
      const p = pt.get(b.id)!;
      geom.set(b.id, g);
      fans.set(b.id, g.offsets);
      fanRects.push(fanRect(p.x, p.y, g.offsets, g.w, g.h));
    }
    let autoOpen: string[] = [];
    if (view === 'units' && prefs.autoFan && zoom >= AUTO_FAN_ZOOM) {
      const cands = ranked
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => b.group && !openNow.has(b.id) && !foldedFans.includes(b.id))
        .map(({ b, i }) => {
          const g = fanGeometry(b);
          geom.set(b.id, g);
          const p = pt.get(b.id)!;
          return { id: b.id, rect: fanRect(p.x, p.y, g.offsets, g.w, g.h), priority: i };
        });
      const chosen = autoFans(cands, fanRects);
      autoOpen = [...chosen];
      for (const c of cands)
        if (chosen.has(c.id)) {
          fans.set(c.id, geom.get(c.id)!.offsets);
          fanRects.push(c.rect);
        }
    }

    // Everything else: full plates where they fit, dots where crowded
    const boxes: PinBox[] = ranked
      .filter((b) => !fans.has(b.id))
      .map((b, i) => {
        const p = pt.get(b.id)!;
        const size = estimatePinSize(
          prefs.style,
          b.content.segments.map((x) => x.text),
          {
            icon: !!b.content.typeIcon,
            count: b.pinned.length > 1,
            tag: prefs.newBadge === 'tag' && b.pinned.some((u) => isNew(u.unit)),
          },
        );
        const keep = b.id === selectedBuildingId || b.id === hoverBuildingId;
        return { id: b.id, rect: pinRect(p.x, p.y, size.w, size.h), priority: i, keepFull: keep };
      });
    setLayout({
      zoom,
      bubbles,
      shown: ranked.map((b) => b.id),
      full: fullPins(boxes, zoom, prefs.shrink, fanRects),
      fans,
      autoOpen,
    });
  }, [
    index,
    placed,
    byId,
    selectedBuildingId,
    hoverBuildingId,
    clickedFans,
    forcedFan,
    foldedFans,
    fanGeometry,
    prefs,
    view,
  ]);

  useEffect(() => {
    if (loaded) relayout();
  }, [loaded, relayout]);

  // Selecting a unit in a building you folded opens it again
  useEffect(() => {
    if (selectedUnitId && selectedBuildingId) useUi.getState().unfoldFan(selectedBuildingId);
  }, [selectedUnitId, selectedBuildingId]);

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
      const b = boundsOf(placed);
      if (!map || !b) return;
      const el = map.getContainer();
      // Leave room for fans only when the fit is close enough for them to open
      const plain = map.cameraForBounds(b, { padding: fitPadding(el, false), maxZoom: 15 });
      const fans = view === 'units' && prefs.autoFan && (plain?.zoom ?? 0) >= AUTO_FAN_ZOOM - 0.25;
      map.fitBounds(b, {
        padding: fitPadding(el, fans),
        maxZoom: 15,
        duration: animate && !reducedMotion() ? 400 : 0,
      });
    },
    [placed, view, prefs.autoFan],
  );
  // On a phone the map may start hidden behind the List tab (no size yet): fit once it shows.
  const fitFirstTime = useCallback(() => {
    const el = mapRef.current?.getContainer();
    if (fitted.current || !placed.length || !el?.clientWidth || !el.clientHeight) return;
    fitted.current = true;
    fitAll(false);
  }, [placed, fitAll]);
  useEffect(() => {
    if (loaded) fitFirstTime();
  }, [loaded, fitFirstTime]);

  // ── Selecting a card (or opening a fan) brings it into view (DESIGN.md §2.9: 400 ms) ──
  // Opening the detail column narrows the map, so check again once the map has resized.
  const lastOpened = clickedFans[clickedFans.length - 1] ?? null;
  const target = useRef<string | null>(null);
  const bringIntoView = useRef<() => void>(() => {});
  useEffect(() => {
    bringIntoView.current = () => {
      const map = mapRef.current;
      const b = target.current ? byId.get(target.current) : undefined;
      if (!map || !b) return;
      const { clientWidth: w, clientHeight: h } = map.getContainer();
      if (!w || !h) return; // hidden (phone, another tab)
      const fan = b.group ? 130 : 0;
      const p = map.project([b.lng, b.lat]);
      const inside = p.x > 90 + fan && p.x < w - 110 - fan && p.y > 70 + fan && p.y < h - 50;
      if (!inside) map.easeTo({ center: [b.lng, b.lat], duration: reducedMotion() ? 0 : 400 });
    };
  });
  useEffect(() => {
    target.current = selectedBuildingId;
  }, [selectedBuildingId]);
  useEffect(() => {
    if (lastOpened) target.current = lastOpened;
  }, [lastOpened]);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!loaded || !map || !(lastOpened ?? selectedBuildingId)) return;
    const check = () => bringIntoView.current();
    check();
    map.once('resize', check);
    return () => {
      map.off('resize', check);
    };
  }, [loaded, selectedBuildingId, lastOpened]);

  // Closing a panel returns focus to its button
  const wasOpen = useRef(panel);
  useEffect(() => {
    if (wasOpen.current && wasOpen.current !== panel && document.activeElement === document.body)
      (wasOpen.current === 'layers' ? layersBtn : pinsBtn).current?.focus();
    wasOpen.current = panel;
  }, [panel]);

  const select = (key: string) =>
    navigate(`/${key.replace(':', '/')}`, { replace: selectedKey !== null });

  // ── Rendering helpers ──
  const newMark = (on: boolean) => (on && prefs.newBadge !== 'off' ? prefs.newBadge : null);

  const unitPin = (r: UnitRow) => {
    const u = r.unit;
    const rejected = isRejected(u);
    const selected = selectedKey === unitKey(r);
    return (
      <Pin
        pinKey={unitKey(r)}
        style={prefs.style}
        content={pinContent([r], prefs, false)}
        type={u.type}
        count={1}
        stripes={[edgeColor(u, prefs.colorBy, scale)]}
        selected={selected}
        rejected={rejected}
        faded={rejected && prefs.rejected === 'fade'}
        dot={false}
        newMark={newMark(isNew(u))}
        label={unitPinLabel(r)}
        onClick={() => select(unitKey(r))}
        onHover={(on) => setHover(on ? unitKey(r) : null)}
      />
    );
  };

  const markers: ReactNode[] = [];
  for (const id of layout.shown) {
    const b = byId.get(id);
    if (!b) continue;
    const isSel = id === selectedBuildingId;
    const offsets = layout.fans.get(id);

    if (offsets && b.group) {
      const ordered = fanOrder(b.pinned);
      const reach = Math.max(...offsets.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y)))) + 8;
      const name = buildingName(b.building);
      markers.push(
        <Marker
          key={id}
          longitude={b.lng}
          latitude={b.lat}
          style={{ zIndex: isSel ? 5 : 3 }}
          className={styles.anchor}
        >
          <div role="group" aria-label={`Units at ${name}`} data-fan={b.id}>
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
            </svg>
            <button
              type="button"
              className={styles.hub}
              aria-label={`Fold units at ${name}`}
              title="Fold"
              data-hub={b.id}
              onClick={(e) => {
                e.stopPropagation();
                ui.foldFan(b.id);
              }}
            >
              <svg viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 2l6 6M8 2L2 8" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </button>
            {ordered.map((r, i) => {
              const [x, y] = offsets[i] as [number, number];
              return (
                <div key={r.unit.id} className={styles.fanned} style={{ left: x, top: y }}>
                  {unitPin(r)}
                </div>
              );
            })}
          </div>
        </Marker>,
      );
      continue;
    }

    const dot = !layout.full.has(id);
    const isHover = id === hoverBuildingId;
    const z = isSel ? 4 : isHover ? 2 : dot ? 0 : 1;

    if (!b.group && view === 'units') {
      const r = b.pinned[0] as UnitRow;
      const rejected = isRejected(r.unit);
      const selected = selectedKey === unitKey(r);
      markers.push(
        <Marker
          key={id}
          longitude={b.lng}
          latitude={b.lat}
          style={{ zIndex: z }}
          className={styles.anchor}
        >
          <Pin
            pinKey={unitKey(r)}
            style={prefs.style}
            content={b.content}
            type={r.unit.type}
            count={1}
            stripes={[edgeColor(r.unit, prefs.colorBy, scale)]}
            selected={selected}
            rejected={rejected}
            faded={rejected && prefs.rejected === 'fade'}
            dot={dot && !selected}
            newMark={newMark(isNew(r.unit))}
            label={unitPinLabel(r)}
            onClick={() => select(unitKey(r))}
            onHover={(on) => setHover(on ? unitKey(r) : null)}
          />
        </Marker>,
      );
      continue;
    }

    // A building summary: a folded group (Units view) or any Buildings-view pin
    const key = `building:${b.id}`;
    const rejected = allRejected(b.pinned);
    const selected =
      view === 'buildings' ? selectedKey === key : b.pinned.some((u) => unitKey(u) === selectedKey);
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
          style={prefs.style}
          content={b.content}
          type={b.summary[0]?.unit.type ?? null}
          count={b.pinned.length}
          stripes={edgeStripes(b.summary, prefs.colorBy, scale)}
          selected={selected}
          rejected={rejected}
          faded={rejected && prefs.rejected === 'fade'}
          dot={dot && !selected}
          newMark={newMark(b.pinned.some((u) => isNew(u.unit)))}
          label={buildingPinLabel(b.building, b.summary, view, b.pinned.length)}
          expanded={view === 'units' ? false : undefined}
          onClick={() => (view === 'units' ? ui.openFan(b.id) : select(key))}
          onHover={(on) => setHover(on ? key : null)}
        />
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
          aria-label={`${c.units} units in this area. Zoom in to see them`}
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

  const anyFanOpen = view === 'units' && layout.fans.size > 0;
  const baseName = BASE_MAPS.find((b) => b.id === baseLayer)?.name ?? 'base';
  const zoomBy = (d: number) => {
    const map = mapRef.current;
    if (map) map.zoomTo(map.getZoom() + d, { duration: reducedMotion() ? 0 : 200 });
  };

  return (
    <div className={styles.root} data-base={baseLayer} data-zoom={layout.zoom.toFixed(1)}>
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
            const map = e.target;
            const c = map.getCenter();
            const zoom = map.getZoom();
            saveViewport({ longitude: c.lng, latitude: c.lat, zoom });
            // Zooming out to bubble level folds clicked fans; zooming out below street zoom
            // forgets which automatic fans you folded. Panning never folds anything.
            const out = zoom < lastZoom.current - 0.01;
            lastZoom.current = zoom;
            if (out) ui.forgetFans({ clicked: zoom < STREET_ZOOM, folded: zoom < AUTO_FAN_ZOOM });
            relayout();
          }}
          onError={(e) => {
            const err = e as unknown as { sourceId?: string; tile?: unknown };
            if (err.sourceId || err.tile) setFailedBase(baseLayer);
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
            {baseLayer === 'aerial'
              ? 'Aerial photos couldn’t load. Try another base map in Layers.'
              : `Couldn’t load the ${baseName} map. Check your connection, or pick another base map in Layers.`}
          </p>
        )}
      </div>

      <div className={styles.controls}>
        <div className={styles.btnRow}>
          <button
            ref={pinsBtn}
            type="button"
            className={styles.layersBtn}
            aria-expanded={panel === 'pins'}
            aria-controls="map-pins"
            title="Pin options"
            onClick={() => togglePanel('pins')}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="14" height="8" rx="1.5" />
              <path d="M8.5 12 10 15l1.5-3" />
            </svg>
            <span className={styles.layersLabel}>Pins</span>
          </button>
          <button
            ref={layersBtn}
            type="button"
            className={styles.layersBtn}
            aria-expanded={panel === 'layers'}
            aria-controls="map-layers"
            title="Map layers (L)"
            onClick={() => togglePanel('layers')}
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
        </div>
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
            disabled={!placed.length}
            onClick={() => fitAll(true)}
          >
            Fit
          </button>
        </div>
        {anyFanOpen && (
          <button
            type="button"
            className={styles.collapseBtn}
            title="Collapse all (Esc)"
            onClick={() => ui.collapseFans([...layout.fans.keys()])}
          >
            Collapse all
          </button>
        )}
      </div>

      {panel === 'layers' && (
        <LayersPanel base={baseLayer} onBase={ui.setBaseLayer} onClose={() => setPanel(null)} />
      )}
      {panel === 'pins' && (
        <PinsPanel
          view={view}
          prefsFor={ui.map.pins}
          onChange={ui.setPinPrefs}
          onClose={() => setPanel(null)}
          legend={legend}
        />
      )}

      {legend && <Legend legend={legend} />}
    </div>
  );
}

/**
 * Room around "Fit all units": plates sit above their point and are up to ~140 px wide;
 * with fan-out on, a close fit fans buildings out, so leave room for their arcs too.
 */
function fitPadding(el: HTMLElement, fans: boolean) {
  const k = Math.min(1, el.clientWidth / 900);
  const f = fans ? 120 : 0;
  return {
    top: Math.round((72 + f) * k) + 8,
    bottom: Math.round(40 * k) + 8,
    left: Math.round((90 + f) * k) + 8,
    right: Math.round((110 + f) * k) + 8,
  };
}
