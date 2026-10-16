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

export interface UiState extends Remembered {
  query: string;
  setView: (view: ListMode) => void;
  toggleView: () => void;
  setQuery: (query: string) => void;
  setUnitSort: (sort: SortSpec) => void;
  setBuildingSort: (sort: SortSpec) => void;
}

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
  };
});

/** Back to the starting state (tests). */
export function resetUi() {
  useUi.setState({ ...defaults, query: '' });
}
