import { create } from 'zustand';
import { dbName } from '../config';
import {
  DEFAULT_BUILDING_SORT,
  DEFAULT_UNIT_SORT,
  isBuildingSortKey,
  isUnitSortKey,
} from '../domain/sort';
import type { SortSpec } from '../model';
import { defaultMapMemory, parseMapMemory } from '../domain/pinPrefs';
import type { BaseLayer, MapMemory, PinPrefs, PinView } from '../domain/pinPrefs';

/**
 * UI-only state (PLAN.md §4.2): never data. Selection lives in the URL (#/unit/:id,
 * #/building/:id), so Back closes the panel and links can be shared within the app.
 * The list view and sorts are remembered in localStorage, per database, so trying the
 * preview never changes how the live app looks.
 */

export type ListMode = 'units' | 'buildings';

interface Remembered {
  view: ListMode;
  unitSort: SortSpec;
  buildingSort: SortSpec;
}

export type MapPanel = 'layers' | 'pins';

/** Map-only UI state (M3). Keys look like `unit:<id>` or `building:<id>`. */
interface MapUi {
  /** The card or pin under the pointer: its pin shows in full and its card is highlighted. */
  hoverKey: string | null;
  /** The open map panel, if any. */
  panel: MapPanel | null;
  /** Buildings fanned out by clicking (stay open until folded). */
  openFans: string[];
  /** Buildings folded by hand that would otherwise fan out by themselves. */
  foldedFans: string[];
  /** Base map and pin choices, remembered per database (PLAN.md §4.3). */
  map: MapMemory;
}

export interface UiState extends Remembered, MapUi {
  query: string;
  setView: (view: ListMode) => void;
  toggleView: () => void;
  setQuery: (query: string) => void;
  setUnitSort: (sort: SortSpec) => void;
  setBuildingSort: (sort: SortSpec) => void;
  setHover: (key: string | null) => void;
  setPanel: (panel: MapPanel | null) => void;
  togglePanel: (panel: MapPanel) => void;
  openFan: (buildingId: string) => void;
  foldFan: (buildingId: string) => void;
  /** Lets a folded building open again (e.g. one of its units was just selected). */
  unfoldFan: (buildingId: string) => void;
  /** Folds every fan; `autoOpen` lists the ones that opened by themselves. */
  collapseFans: (autoOpen?: readonly string[]) => void;
  /** Zoomed out to bubble level: clicked fans fold; below street zoom the folded list resets. */
  forgetFans: (opts: { clicked: boolean; folded: boolean }) => void;
  setBaseLayer: (base: BaseLayer) => void;
  setPinPrefs: (view: PinView, prefs: PinPrefs) => void;
}

const MAP_KEY = `${dbName}.mapPrefs`;

export function loadMapMemory(): MapMemory {
  try {
    return parseMapMemory(JSON.parse(localStorage.getItem(MAP_KEY) ?? 'null'));
  } catch {
    return defaultMapMemory();
  }
}

function rememberMap(map: MapMemory) {
  try {
    localStorage.setItem(MAP_KEY, JSON.stringify(map));
  } catch {
    // Storage blocked or full: the choice still applies for this visit.
  }
}

const mapUiStart = (): MapUi => ({
  hoverKey: null,
  panel: null,
  openFans: [],
  foldedFans: [],
  map: loadMapMemory(),
});

const STORAGE_KEY = `${dbName}.list`;

const defaults: Remembered = {
  view: 'units',
  unitSort: DEFAULT_UNIT_SORT,
  buildingSort: DEFAULT_BUILDING_SORT,
};

const isDir = (d: unknown): d is 'asc' | 'desc' => d === 'asc' || d === 'desc';

/** Reads remembered settings, ignoring anything missing, unreadable or out of date. */
export function loadRemembered(): Remembered {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? 'null',
    ) as Partial<Remembered> | null;
    if (!parsed || typeof parsed !== 'object') return defaults;
    const us = parsed.unitSort;
    const bs = parsed.buildingSort;
    return {
      view: parsed.view === 'buildings' ? 'buildings' : 'units',
      unitSort: us && isUnitSortKey(us.key) && isDir(us.dir) ? us : defaults.unitSort,
      buildingSort: bs && isBuildingSortKey(bs.key) && isDir(bs.dir) ? bs : defaults.buildingSort,
    };
  } catch {
    return defaults;
  }
}

function remember(state: Remembered) {
  try {
    const { view, unitSort, buildingSort } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ view, unitSort, buildingSort }));
  } catch {
    // Storage blocked or full: the choice still applies for this visit.
  }
}

export const useUi = create<UiState>()((set, get) => {
  const update = (patch: Partial<Remembered>) => {
    set(patch);
    remember(get());
  };
  return {
    ...loadRemembered(),
    query: '',
    setView: (view) => update({ view }),
    toggleView: () => update({ view: get().view === 'units' ? 'buildings' : 'units' }),
    setQuery: (query) => set({ query }),
    setUnitSort: (unitSort) => update({ unitSort }),
    setBuildingSort: (buildingSort) => update({ buildingSort }),
    ...mapUiStart(),
    setHover: (hoverKey) => {
      if (get().hoverKey !== hoverKey) set({ hoverKey });
    },
    setPanel: (panel) => set({ panel }),
    togglePanel: (panel) => set({ panel: get().panel === panel ? null : panel }),
    openFan: (id) =>
      set({
        openFans: [...get().openFans.filter((f) => f !== id), id],
        foldedFans: get().foldedFans.filter((f) => f !== id),
      }),
    foldFan: (id) =>
      set({
        openFans: get().openFans.filter((f) => f !== id),
        foldedFans: [...get().foldedFans.filter((f) => f !== id), id],
      }),
    unfoldFan: (id) => {
      if (get().foldedFans.includes(id))
        set({ foldedFans: get().foldedFans.filter((f) => f !== id) });
    },
    collapseFans: (autoOpen = []) =>
      set({ openFans: [], foldedFans: [...new Set([...get().foldedFans, ...autoOpen])] }),
    forgetFans: ({ clicked, folded }) => {
      const s = get();
      if ((clicked && s.openFans.length) || (folded && s.foldedFans.length))
        set({
          openFans: clicked ? [] : s.openFans,
          foldedFans: folded ? [] : s.foldedFans,
        });
    },
    setBaseLayer: (baseLayer) => {
      const map = { ...get().map, baseLayer };
      set({ map });
      rememberMap(map);
    },
    setPinPrefs: (view, prefs) => {
      const map = { ...get().map, pins: { ...get().map.pins, [view]: prefs } };
      set({ map });
      rememberMap(map);
    },
  };
});

/** Back to the starting state (tests). */
export function resetUi() {
  useUi.setState({ ...defaults, ...mapUiStart(), query: '' });
}

// ── Map viewport memory (PLAN.md §4.2: "Map viewport … remembered in localStorage") ──

export interface Viewport {
  longitude: number;
  latitude: number;
  zoom: number;
}

const VIEWPORT_KEY = `${dbName}.map`;

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** The last map position for this database, or null if none was saved (or it's unreadable). */
export function loadViewport(): Viewport | null {
  try {
    const v = JSON.parse(localStorage.getItem(VIEWPORT_KEY) ?? 'null') as Partial<Viewport> | null;
    if (!v || !finite(v.longitude) || !finite(v.latitude) || !finite(v.zoom)) return null;
    if (Math.abs(v.latitude) > 85 || Math.abs(v.longitude) > 180) return null;
    return { longitude: v.longitude, latitude: v.latitude, zoom: v.zoom };
  } catch {
    return null;
  }
}

export function saveViewport(v: Viewport) {
  try {
    const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
    localStorage.setItem(
      VIEWPORT_KEY,
      JSON.stringify({
        longitude: round(v.longitude, 5),
        latitude: round(v.latitude, 5),
        zoom: round(v.zoom, 2),
      }),
    );
  } catch {
    // Storage blocked: the map just opens on your units next time.
  }
}
