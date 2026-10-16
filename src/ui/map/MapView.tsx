import 'maplibre-gl/dist/maplibre-gl.css';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
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
  estimatePinSize,
  layoutPins,
  MARKER_R,
  PHOTO_PREVIEW,
} from '../../domain/pinLayout';
import type { Card, LayoutBuilding, Size } from '../../domain/pinLayout';
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
import type { PinPrefs, PinStyle } from '../../domain/pinPrefs';
import { buildingName, unitTitle } from '../../domain/format';
import { deriveMapItems } from '../../state/derive';
import type { Dataset, ListView, MapBuilding, UnitRow } from '../../state/derive';
import { loadViewport, saveViewport, useUi } from '../../state/ui';
import type { ListMode } from '../../state/ui';
import { BASE_MAPS, paletteFromTokens, styleFor } from './baseMaps';
import { LayersPanel } from './LayersPanel';
import { Legend } from './Legend';
import { MapCard } from './MapCard';
import type { CardRow } from './MapCard';
import { Pin } from './Pin';
import { PhotoPreview } from './PhotoPreview';
import { PinsPanel } from './PinsPanel';
import styles from './map.module.css';

/**
 * The map (PLAN.md §4.3): HTML pins for the buildings the list shows. A building with
 * several units shows one pin summarizing them (ranges, one stripe per unit) and opens a
 * card listing its units on click; several can be open at once, and at street zoom
 * buildings open by themselves where their card fits. Neighborhood bubbles at low zoom,
 * dots when crowded, a Pins panel and a Map layers panel. Loaded on demand so the list
 * appears first. (In the store, an open building is still called a "fan".)
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
  /** Open buildings' cards, relative to the building's point. */
  cards: Map<string, Card>;
  /** Cards that opened by themselves (street zoom). */
  autoOpen: string[];
}

const emptyLayout: Layout = {
  zoom: 0,
  bubbles: [],
  shown: [],
  full: new Set(),
  cards: new Map(),
  autoOpen: [],
};

type PointProps = { id: string; units: number };

const unitKey = (r: UnitRow) => `unit:${r.unit.id}`;

/** Everything that decides a pin's size, so measured sizes can be reused. */
interface PinSpec {
  style: PinStyle;
  content: PinContent;
  count: number;
  newMark: 'dot' | 'tag' | null;
  selected: boolean;
}

const specKey = (s: PinSpec) =>
  [
    s.style,
    s.content.typeIcon ?? '',
    s.content.segments.map((x) => `${x.field}:${x.text}`).join('¦'),
    s.count,
    s.newMark ?? '',
    s.selected ? 'sel' : '',
  ].join('|');

/** One building as the map draws it: the units it pins and the ones its summary covers. */
interface Placed extends MapBuilding {
  /** Units on the map ("Hide" drops rejected ones). */
  pinned: UnitRow[];
  /** Units the summary covers ("Fade"/"Hide" leave rejected ones out). */
  summary: UnitRow[];
  content: PinContent;
  /** Units view and more than one unit: a group that opens a card. */
  group: boolean;
}

export default function MapView({ data, listView, view, selectedKey }: MapViewProps) {
  const navigate = useNavigate();
  const mapRef = useRef<MapRef>(null);
  const [loaded, setLoaded] = useState(false);
  const ui = useUi();
  const { hoverKey, setHover, panel, setPanel, togglePanel, openFans, foldedFans } = ui;
  const layersBtn = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pinsBtn = useRef<HTMLButtonElement>(null);

  const prefs: PinPrefs = ui.map.pins[view];
  const baseLayer = ui.map.baseLayer;
  const sharper = ui.map.sharperRaster;

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
    styleFor(baseLayer, data.settings.mapStyleUrl, paletteFromTokens(), { sharper })
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
  }, [baseLayer, data.settings.mapStyleUrl, dark, sharper]);

  // ── Bubbles (low zoom): the selected building and open cards never hide in one ──
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

  // ── Sizes: measured from real pins and cards (hidden copies), estimated until then, then
  // scaled by the Pin size setting ──
  const k = prefs.size / 100;
  const [sizes, setSizes] = useState<ReadonlyMap<string, Size>>(() => new Map());
  const newMark = useCallback(
    (on: boolean) => (on && prefs.newBadge !== 'off' ? prefs.newBadge : null),
    [prefs.newBadge],
  );
  const sizeOf = useCallback(
    (spec: PinSpec): Size => {
      const known = sizes.get(specKey(spec));
      if (known) return { w: known.w * k, h: known.h * k };
      const est = estimatePinSize(
        spec.style,
        spec.content.segments.map((x) => x.text),
        {
          icon: !!spec.content.typeIcon,
          count: spec.count > 1,
          tag: spec.newMark === 'tag',
        },
      );
      const sized = spec.selected ? { w: est.w + 20, h: est.h + 8 } : est;
      return { w: sized.w * k, h: sized.h * k };
    },
    [sizes, k],
  );
  /** The pin a building shows when collapsed (or its only unit's pin). */
  const collapsedSpec = useCallback(
    (b: Placed): PinSpec => {
      const single = !b.group && view === 'units' ? b.pinned[0] : undefined;
      return {
        style: prefs.style,
        content: b.content,
        count: single ? 1 : b.pinned.length,
        newMark: newMark(b.pinned.some((u) => isNew(u.unit))),
        selected: single
          ? selectedKey === unitKey(single)
          : view === 'buildings'
            ? selectedKey === `building:${b.id}`
            : b.pinned.some((u) => unitKey(u) === selectedKey),
      };
    },
    [prefs.style, view, newMark, selectedKey],
  );
  /** An open building's card: one row per unit, cheapest first, rejected last. */
  const cardRows = useCallback(
    (b: Placed): CardRow[] =>
      fanOrder(b.pinned).map((r) => {
        const rejected = isRejected(r.unit);
        return {
          key: unitKey(r),
          content: pinContent([r], prefs, false),
          type: r.unit.type,
          stripe: edgeColor(r.unit, prefs.colorBy, scale),
          newMark: newMark(isNew(r.unit)),
          selected: selectedKey === unitKey(r),
          rejected,
          faded: rejected && prefs.rejected === 'fade',
          hot: false,
          label: unitPinLabel(r),
          title: unitTitle(r.unit, r.building),
        };
      }),
    [prefs, scale, newMark, selectedKey],
  );
  /** Everything that decides a card's size. */
  const cardKey = useCallback(
    (b: Placed, rows: readonly CardRow[]) =>
      [
        'card',
        prefs.style,
        buildingName(b.building),
        ...rows.map(
          (r) =>
            `${r.content.typeIcon ?? ''}:${r.content.segments.map((x) => x.text).join('¦')}:${r.newMark ?? ''}`,
        ),
      ].join('|'),
    [prefs.style],
  );
  const cardSizeOf = useCallback(
    (b: Placed): Size => {
      const rows = cardRows(b);
      const known = sizes.get(cardKey(b, rows));
      // Until measured: a header and a row per unit
      const s = known ?? { w: 200, h: 34 + rows.length * (prefs.style === 'photo' ? 40 : 30) };
      return { w: s.w * k, h: s.h * k };
    },
    [cardRows, cardKey, sizes, k, prefs.style],
  );

  // ── Relayout: which pins are in view, bubbled, fanned, full or dots ──
  const [layout, setLayout] = useState<Layout>(emptyLayout);
  const lastZoom = useRef(Infinity);
  /** Where each open card was last time, so it stays put while its spot is free. */
  const lastCards = useRef<ReadonlyMap<string, Card>>(new Map());
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

    // Cheaper buildings first: they keep their plate first
    const ranked = [...shown]
      .map((id) => byId.get(id))
      .filter((b): b is Placed => !!b)
      .sort((x, y) => lowestRent(x.summary) - lowestRent(y.summary));
    // Cards you opened go down in the order you opened them
    const openOrder = [
      ...clickedFans,
      ...(forcedFan && !clickedFans.includes(forcedFan) ? [forcedFan] : []),
    ];
    const autoOk = view === 'units' && prefs.autoFan && zoom >= AUTO_FAN_ZOOM;
    const input: LayoutBuilding[] = ranked.map((b) => {
      const pt = map.project([b.lng, b.lat]);
      const spec = collapsedSpec(b);
      return {
        id: b.id,
        x: pt.x,
        y: pt.y,
        size: sizeOf(spec),
        cardSize: b.group ? cardSizeOf(b) : undefined,
        forced: b.group && openOrder.includes(b.id),
        auto: b.group && autoOk && !foldedFans.includes(b.id),
        keepFull: b.id === selectedBuildingId,
        order: openOrder.indexOf(b.id),
        prev: lastCards.current.get(b.id),
      };
    });
    const container = map.getContainer();
    const { clientWidth, clientHeight } = container;
    // Plates stay clear of the map's own buttons, legend and notes
    const origin = container.getBoundingClientRect();
    const reserved = [...(rootRef.current?.querySelectorAll('[data-reserve]') ?? [])]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width && r.height)
      .map((r) => ({
        left: r.left - origin.left,
        right: r.right - origin.left,
        top: r.top - origin.top,
        bottom: r.bottom - origin.top,
      }));
    const out = layoutPins(input, {
      zoom,
      shrink: prefs.shrink,
      view: clientWidth ? { w: clientWidth, h: clientHeight } : undefined,
      reserved,
    });
    lastCards.current = out.cards;
    setLayout({
      zoom,
      bubbles,
      shown: ranked.map((b) => b.id),
      full: out.full,
      cards: out.cards,
      autoOpen: out.autoOpen,
    });
  }, [
    index,
    placed,
    byId,
    selectedBuildingId,
    clickedFans,
    forcedFan,
    foldedFans,
    prefs,
    view,
    sizeOf,
    collapsedSpec,
    cardSizeOf,
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
      // Leave room for cards only when the fit is close enough for them to open
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

  // A card you just opened pans the map just enough to show it and its marker (once per
  // opening)
  const shownFan = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current?.getMap();
    if (!map || !lastOpened || shownFan.current === lastOpened) return;
    const b = byId.get(lastOpened);
    const card = layout.cards.get(lastOpened);
    if (!b || !card) return;
    shownFan.current = lastOpened;
    const { clientWidth: w, clientHeight: h } = map.getContainer();
    if (!w || !h) return;
    const hub = map.project([b.lng, b.lat]);
    const size = cardSizeOf(b);
    const m = 16;
    const l = Math.min(hub.x - MARKER_R, hub.x + card.left);
    const r = Math.max(hub.x + MARKER_R, hub.x + card.left + size.w);
    const t = Math.min(hub.y - MARKER_R, hub.y + card.top);
    const btm = Math.max(hub.y + MARKER_R, hub.y + card.top + size.h);
    // Shift by what sticks out, but never push the far edge off (left/top win when the card
    // is bigger than the screen)
    const dx = l < m ? l - m : r > w - m ? Math.min(r - (w - m), l - m) : 0;
    const dy = t < m ? t - m : btm > h - m ? Math.min(btm - (h - m), t - m) : 0;
    if (dx || dy) map.panBy([dx, dy], { duration: reducedMotion() ? 0 : 400 });
  }, [layout, lastOpened, byId, cardSizeOf]);
  useEffect(() => {
    if (!lastOpened) shownFan.current = null;
  }, [lastOpened]);

  // Closing a panel returns focus to its button
  const wasOpen = useRef(panel);
  useEffect(() => {
    if (wasOpen.current && wasOpen.current !== panel && document.activeElement === document.body)
      (wasOpen.current === 'layers' ? layersBtn : pinsBtn).current?.focus();
    wasOpen.current = panel;
  }, [panel]);

  const select = (key: string) =>
    navigate(`/${key.replace(':', '/')}`, { replace: selectedKey !== null });

  // ── The larger photo: beside the card (or single pin) on whichever side has room,
  // level with the row, above everything else on the map ──
  const [preview, setPreview] = useState<{ key: string; left: number; top: number } | null>(null);
  const showPreview = useCallback(
    (key: string | null, anchor?: { card: DOMRect; row: DOMRect }) => {
      const root = rootRef.current?.getBoundingClientRect();
      if (!key || !anchor || !root) {
        setPreview(null);
        return;
      }
      const { card, row } = anchor;
      const { w, h, gap, margin } = PHOTO_PREVIEW;
      const right = card.right + gap + w <= root.right - margin;
      const left = right
        ? card.right - root.left + gap
        : Math.max(margin, card.left - root.left - gap - w);
      const top = Math.min(
        Math.max(margin, row.top + row.height / 2 - h / 2 - root.top),
        root.height - h - margin,
      );
      setPreview({ key, left, top });
    },
    [],
  );
  const previewRow = preview ? data.unitById.get(preview.key.slice(5)) : undefined;

  // ── Rendering helpers ──
  // Pointing at a card (or one of its units' list cards) brings it forward and fades the
  // other cards
  const hoverCard = hoverBuildingId && layout.cards.has(hoverBuildingId) ? hoverBuildingId : null;
  /** Pins, dots and cards scale with the Pin size setting, about the building's point. */
  const scaled = k !== 1 ? { transform: `scale(${k})` } : undefined;

  /** A building's collapsed pin (or a single unit's pin), as a plate or a dot. */
  const collapsedPin = (b: Placed, dot: boolean, opts: { peek?: boolean } = {}) => {
    const spec = collapsedSpec(b);
    const single = !b.group && view === 'units' ? (b.pinned[0] as UnitRow) : undefined;
    const key = single ? unitKey(single) : `building:${b.id}`;
    const rejected = single ? isRejected(single.unit) : allRejected(b.pinned);
    return (
      <Pin
        pinKey={opts.peek ? undefined : key}
        style={prefs.style}
        content={spec.content}
        type={single?.unit.type ?? b.summary[0]?.unit.type ?? null}
        count={spec.count}
        stripes={
          single
            ? [edgeColor(single.unit, prefs.colorBy, scale)]
            : edgeStripes(b.summary, prefs.colorBy, scale)
        }
        selected={spec.selected}
        rejected={rejected}
        faded={rejected && prefs.rejected === 'fade'}
        dot={dot && !spec.selected}
        hot={!opts.peek && !dot && hoverBuildingId === b.id}
        newMark={spec.newMark}
        label={
          single
            ? unitPinLabel(single)
            : buildingPinLabel(b.building, b.summary, view, b.pinned.length)
        }
        expanded={b.group ? false : undefined}
        onClick={() => (single ? select(key) : view === 'units' ? ui.openFan(b.id) : select(key))}
        onHover={(on) => setHover(on ? key : null)}
        onPreview={
          single && !opts.peek && prefs.style === 'photo'
            ? (a) => showPreview(a ? key : null, a ? { card: a, row: a } : undefined)
            : undefined
        }
      />
    );
  };

  const markers: ReactNode[] = [];
  for (const id of layout.shown) {
    const b = byId.get(id);
    if (!b) continue;
    const isSel = id === selectedBuildingId;
    const isHover = id === hoverBuildingId;
    const card = layout.cards.get(id);

    if (card && b.group) {
      const name = buildingName(b.building);
      const rows = cardRows(b).map((r) => ({ ...r, hot: hoverKey === r.key }));
      // The line runs from the marker's edge to the card's nearest edge
      const [ex, ey] = card.end;
      const len = Math.hypot(ex, ey) || 1;
      const [sx, sy] = [(ex / len) * MARKER_R, (ey / len) * MARKER_R];
      const reach = Math.ceil(len) + 8;
      const dim = !!hoverCard && hoverCard !== id;
      markers.push(
        <Marker
          key={id}
          longitude={b.lng}
          latitude={b.lat}
          style={{ zIndex: isHover ? 6 : isSel ? 5 : 3 }}
          className={styles.anchor}
        >
          <div data-fan={b.id} className={isHover ? styles.cardHot : undefined}>
            <svg
              className={`${styles.cardLine} ${dim ? styles.dimCard : ''}`}
              width={reach * 2}
              height={reach * 2}
              viewBox={`${-reach} ${-reach} ${reach * 2} ${reach * 2}`}
              style={{ left: -reach, top: -reach }}
              aria-hidden="true"
            >
              <line className={styles.lineHalo} x1={sx} y1={sy} x2={ex} y2={ey} />
              <line className={styles.lineInk} x1={sx} y1={sy} x2={ex} y2={ey} />
              <circle className={styles.lineEnd} cx={ex} cy={ey} r={3.5} />
            </svg>
            <div className={styles.cardAt} style={{ left: card.left, top: card.top, ...scaled }}>
              <MapCard
                id={b.id}
                name={name}
                rows={rows}
                photo={prefs.style === 'photo'}
                dim={dim}
                onSelect={select}
                onOpenBuilding={() => select(`building:${b.id}`)}
                onClose={() => ui.foldFan(b.id)}
                onHover={setHover}
                onPreview={showPreview}
              />
            </div>
            {/* The building's marker; the same ring starts the card's header */}
            <button
              type="button"
              className={styles.mark}
              aria-label={`Close units at ${name}`}
              title="Close"
              data-hub={b.id}
              onClick={(e) => {
                e.stopPropagation();
                ui.foldFan(b.id);
              }}
              onMouseEnter={() => setHover(`building:${b.id}`)}
              onMouseLeave={() => setHover(null)}
            />
          </div>
        </Marker>,
      );
      continue;
    }

    const dot = !layout.full.has(id);
    const z = isHover ? 6 : isSel ? 4 : dot ? 0 : 1;
    markers.push(
      <Marker
        key={id}
        longitude={b.lng}
        latitude={b.lat}
        style={{ zIndex: z }}
        className={styles.anchor}
      >
        <div className={styles.scaled} style={scaled}>
          {collapsedPin(b, dot)}
          {/* Pointing at a dot (or its card) previews the full pin above it, without moving
              anything, so the pin under the pointer can't flicker. */}
          {dot && isHover && (
            <div className={styles.peek} aria-hidden="true">
              {collapsedPin(b, false, { peek: true })}
            </div>
          )}
        </div>
      </Marker>,
    );
  }

  // ── Measuring: pins and cards near the view whose size isn't known yet, drawn invisibly ──
  type Measure = { kind: 'pin'; spec: PinSpec } | { kind: 'card'; b: Placed; rows: CardRow[] };
  const toMeasure = new Map<string, Measure>();
  for (const id of layout.shown) {
    const b = byId.get(id);
    if (!b) continue;
    const spec = collapsedSpec(b);
    if (!sizes.has(specKey(spec))) toMeasure.set(specKey(spec), { kind: 'pin', spec });
    if (b.group) {
      const rows = cardRows(b);
      const ck = cardKey(b, rows);
      if (!sizes.has(ck)) toMeasure.set(ck, { kind: 'card', b, rows });
    }
  }
  const measureKeys = [...toMeasure.keys()].join('\n');
  const measurer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = measurer.current;
    if (!root || !measureKeys) return;
    const found: [string, Size][] = [];
    for (const el of root.querySelectorAll<HTMLElement>('[data-spec]')) {
      const pin = el.firstElementChild as HTMLElement | null;
      if (!pin) continue;
      const key = el.dataset.spec as string;
      // The New tag sticks out past a pin's corner; leave room for it
      const tag = !key.startsWith('card|') && key.includes('|tag|');
      found.push([
        key,
        { w: pin.offsetWidth + (tag ? 12 : 0), h: pin.offsetHeight + (tag ? 8 : 0) },
      ]);
    }
    // Measuring has to happen after the copies are drawn; this is the one place it can.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (found.length) setSizes((old) => new Map([...old, ...found]));
  }, [measureKeys]);

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

  const anyFanOpen = view === 'units' && layout.cards.size > 0;
  const baseName = BASE_MAPS.find((b) => b.id === baseLayer)?.name ?? 'base';
  const zoomBy = (d: number) => {
    const map = mapRef.current;
    if (map) map.zoomTo(map.getZoom() + d, { duration: reducedMotion() ? 0 : 200 });
  };

  return (
    <div
      ref={rootRef}
      className={styles.root}
      data-base={baseLayer}
      data-zoom={layout.zoom.toFixed(1)}
    >
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
            // Zooming out to bubble level closes cards you opened; zooming out below street zoom
            // forgets which automatic cards you closed. Panning never folds anything.
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
          <p className={styles.note} data-reserve>
            {items.needLocation === 1
              ? '1 unit needs a location'
              : `${items.needLocation} units need a location`}
          </p>
        )}
        {failed && (
          <p className={`${styles.note} ${styles.warn}`} role="status" data-reserve>
            {baseLayer === 'aerial'
              ? 'Aerial photos couldn’t load. Try another base map in Layers.'
              : `Couldn’t load the ${baseName} map. Check your connection, or pick another base map in Layers.`}
          </p>
        )}
      </div>

      <div className={styles.controls} data-reserve>
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
        {/* Always takes its space, so cards laid out around it don't shift when it appears */}
        <button
          type="button"
          className={styles.collapseBtn}
          title="Collapse all (Esc)"
          style={anyFanOpen ? undefined : { visibility: 'hidden' }}
          aria-hidden={!anyFanOpen || undefined}
          tabIndex={anyFanOpen ? undefined : -1}
          onClick={() => ui.collapseFans([...layout.cards.keys()])}
        >
          Collapse all
        </button>
      </div>

      {panel === 'layers' && (
        <LayersPanel
          base={baseLayer}
          onBase={ui.setBaseLayer}
          sharper={sharper}
          onSharper={ui.setSharperRaster}
          onClose={() => setPanel(null)}
        />
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

      {preview && previewRow && (
        <PhotoPreview
          title={unitTitle(previewRow.unit, previewRow.building)}
          type={previewRow.unit.type}
          left={preview.left}
          top={preview.top}
        />
      )}

      <div ref={measurer} className={styles.measurer} aria-hidden="true" inert>
        {[...toMeasure].map(([key, m]) => (
          <div key={key} data-spec={key}>
            {m.kind === 'card' ? (
              <MapCard
                id={m.b.id}
                name={buildingName(m.b.building)}
                rows={m.rows}
                photo={prefs.style === 'photo'}
              />
            ) : (
              <Pin
                style={m.spec.style}
                content={m.spec.content}
                type="apartment"
                count={m.spec.count}
                stripes={['transparent']}
                selected={m.spec.selected}
                rejected={false}
                faded={false}
                dot={false}
                newMark={m.spec.newMark}
                label=""
                onClick={() => {}}
                onHover={() => {}}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Room around "Fit all units": plates sit above their point and are up to ~140 px wide;
 * with automatic opening on, a close fit opens buildings' cards, so leave room for them too.
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
