import { create } from 'zustand';
import { dbName } from '../config';
import {
  DEFAULT_BUILDING_SORT,
  DEFAULT_UNIT_SORT,
  isBuildingSortKey,
  isUnitSortKey,
} from '../domain/sort';
import type { SortSpec } from '../model';

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

/** Map-only UI state (M3); not remembered. Keys look like `unit:<id>` or `building:<id>`. */
interface MapUi {
  /** The card or pin under the pointer, so its pin can show in full. */
  hoverKey: string | null;
  /** The Map layers panel. */
  layersOpen: boolean;
  /** Building whose units are fanned out around it (opened by clicking a grouped pin). */
  fannedId: string | null;
}

export interface UiState extends Remembered, MapUi {
  query: string;
  setView: (view: ListMode) => void;
  toggleView: () => void;
  setQuery: (query: string) => void;
  setUnitSort: (sort: SortSpec) => void;
  setBuildingSort: (sort: SortSpec) => void;
  setHover: (key: string | null) => void;
  setLayersOpen: (open: boolean) => void;
  toggleLayers: () => void;
  setFanned: (buildingId: string | null) => void;
}

const mapUiDefaults: MapUi = { hoverKey: null, layersOpen: false, fannedId: null };

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
    ...mapUiDefaults,
    setHover: (hoverKey) => {
      if (get().hoverKey !== hoverKey) set({ hoverKey });
    },
    setLayersOpen: (layersOpen) => set({ layersOpen }),
    toggleLayers: () => set({ layersOpen: !get().layersOpen }),
    setFanned: (fannedId) => set({ fannedId }),
  };
});

/** Back to the starting state (tests). */
export function resetUi() {
  useUi.setState({ ...defaults, ...mapUiDefaults, query: '' });
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
