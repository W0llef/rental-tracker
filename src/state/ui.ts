import { defaultLeaseMarkPrefs, parseLeaseMarkPrefs } from '../domain/leaseMarks';
import type { LeaseMarkPrefs } from '../domain/leaseMarks';
import { NO_COST_LIMITS } from '../domain/filter';
import type { CostLimits } from '../domain/filter';
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

/** "Place on map" in progress: the next click on the map sets this building's location. */
export interface Placing {
  buildingId: string;
  name: string;
}

/** The button on a toast: Undo after an action, Redo after an undo. */
export interface NoticeButton {
  label: string;
  run: () => void;
}

/**
 * A toast after an action ("Flagged Unit 1504 as pick · Undo", PLAN.md §5.6), or a short
 * confirmation with a link to what it's about.
 */
export interface Notice {
  id: number;
  text: string;
  to: string | null;
  button: NoticeButton | null;
  /** The action the toast is about, if any. */
  actionId: string | null;
  /** When it was shown (ms), so a caller's own words can join the toast of its action. */
  at: number;
  /** A caller's own words: the action's description doesn't replace them. */
  custom: boolean;
}

/** A caller's notice this soon after an action's toast joins it (keeping its Undo). */
const JOIN_MS = 1500;

/** The Reject dialog, open for these units and this person's opinion (M7). */
export interface Rejecting {
  unitIds: string[];
  personId: string;
}

/** Triage UI (M7): multi-selection, the Reject dialog, Edit together, the shortcut sheet. */
interface TriageUi {
  /** Units chosen with ⌘/Ctrl- or Shift-click; shortcuts act on all of them. */
  picked: string[];
  /** Where a Shift-click range starts. */
  anchor: string | null;
  rejecting: Rejecting | null;
  editingTogether: boolean;
  shortcutsOpen: boolean;
  setPicked: (ids: string[], anchor?: string | null) => void;
  /**
   * ⌘/Ctrl-click on the map (M7 review): adds these units to the selection, or takes them
   * out if they're all in it. The open unit joins a selection that starts here.
   */
  togglePicked: (ids: string[], openUnitId: string | null) => void;
  clearPicked: () => void;
  setRejecting: (r: Rejecting | null) => void;
  setEditingTogether: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  /** Buildings chosen with ⌘/Ctrl- or Shift-click in the Buildings view (M8, Q23). */
  pickedBuildings: string[];
  buildingAnchor: string | null;
  editingBuildings: boolean;
  setPickedBuildings: (ids: string[], anchor?: string | null) => void;
  /** Adds buildings to the selection, or takes them out if they're all in it. */
  togglePickedBuildings: (ids: string[], openBuildingId: string | null) => void;
  clearPickedBuildings: () => void;
  setEditingBuildings: (open: boolean) => void;
}

export interface UiState extends Remembered, MapUi, TriageUi {
  query: string;
  /** Cost limits above the list (M9); for this visit only, like search. */
  costLimits: CostLimits;
  setCostLimits: (limits: CostLimits) => void;
  /** Which lease-length marks show, and where (Q36); remembered in this browser. */
  leaseMarks: LeaseMarkPrefs;
  setLeaseMarks: (prefs: LeaseMarkPrefs) => void;
  placing: Placing | null;
  notice: Notice | null;
  setPlacing: (placing: Placing | null) => void;
  /** A confirmation; right after an action it joins that action's toast (and its Undo). */
  showNotice: (text: string, to?: string | null, undo?: (() => void) | null) => void;
  /**
   * The toast for an action (toasts.ts), once its words are ready. If the code that ran
   * the action has shown its own words since (`since`, ms), those stay and gain the button.
   */
  showActionToast: (toast: {
    actionId: string;
    text: string;
    button: NoticeButton | null;
    since: number;
  }) => void;
  clearNotice: () => void;
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
  setSharperRaster: (on: boolean) => void;
  setPinPrefs: (view: PinView, prefs: PinPrefs) => void;
}

const MAP_KEY = `${dbName}.mapPrefs`;
const LEASE_MARKS_KEY = `${dbName}.leaseMarks`;

export function loadLeaseMarks(): LeaseMarkPrefs {
  try {
    return parseLeaseMarkPrefs(JSON.parse(localStorage.getItem(LEASE_MARKS_KEY) ?? 'null'));
  } catch {
    return defaultLeaseMarkPrefs();
  }
}

function rememberLeaseMarks(prefs: LeaseMarkPrefs) {
  try {
    localStorage.setItem(LEASE_MARKS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage blocked or full: the choice still applies for this visit.
  }
}

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
    costLimits: NO_COST_LIMITS,
    setCostLimits: (costLimits) => set({ costLimits }),
    leaseMarks: loadLeaseMarks(),
    setLeaseMarks: (leaseMarks) => {
      set({ leaseMarks });
      rememberLeaseMarks(leaseMarks);
    },
    placing: null,
    notice: null,
    setPlacing: (placing) => set({ placing }),
    showNotice: (text, to = null, undo = null) => {
      const current = get().notice;
      const join = !!current?.actionId && !current.custom && Date.now() - current.at < JOIN_MS;
      set({
        notice: {
          id: Date.now(),
          text,
          to,
          button: undo ? { label: 'Undo', run: undo } : join ? current.button : null,
          actionId: join ? current.actionId : null,
          at: Date.now(),
          custom: true,
        },
      });
    },
    showActionToast: ({ actionId, text, button, since }) => {
      const current = get().notice;
      // Words shown after this action started are about it (they may have joined an
      // earlier action's toast in the meantime): keep them, with this action's button.
      if (current?.custom && current.at >= since) {
        const own = current.button && current.actionId === null ? current.button : button;
        set({ notice: { ...current, button: own, actionId } });
        return;
      }
      set({
        notice: { id: Date.now(), text, to: null, button, actionId, at: Date.now(), custom: false },
      });
    },
    clearNotice: () => set({ notice: null }),
    picked: [],
    anchor: null,
    rejecting: null,
    editingTogether: false,
    shortcutsOpen: false,
    setPicked: (picked, anchor) => set({ picked, ...(anchor !== undefined ? { anchor } : {}) }),
    togglePicked: (ids, openUnitId) => {
      const current = get().picked;
      const start = current.length ? current : openUnitId ? [openUnitId] : [];
      const all = ids.length > 0 && ids.every((id) => start.includes(id));
      const next = all
        ? start.filter((id) => !ids.includes(id))
        : [...start, ...ids.filter((id) => !start.includes(id))];
      set({ picked: next, anchor: ids.at(-1) ?? null });
    },
    clearPicked: () => set({ picked: [], anchor: null, editingTogether: false }),
    setRejecting: (rejecting) => set({ rejecting }),
    setEditingTogether: (editingTogether) => set({ editingTogether }),
    setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
    pickedBuildings: [],
    buildingAnchor: null,
    editingBuildings: false,
    setPickedBuildings: (pickedBuildings, anchor) =>
      set({ pickedBuildings, ...(anchor !== undefined ? { buildingAnchor: anchor } : {}) }),
    togglePickedBuildings: (ids, openBuildingId) => {
      const current = get().pickedBuildings;
      const start = current.length ? current : openBuildingId ? [openBuildingId] : [];
      const all = ids.length > 0 && ids.every((id) => start.includes(id));
      const next = all
        ? start.filter((id) => !ids.includes(id))
        : [...start, ...ids.filter((id) => !start.includes(id))];
      set({ pickedBuildings: next, buildingAnchor: ids.at(-1) ?? null });
    },
    clearPickedBuildings: () =>
      set({ pickedBuildings: [], buildingAnchor: null, editingBuildings: false }),
    setEditingBuildings: (editingBuildings) => set({ editingBuildings }),
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
    setSharperRaster: (sharperRaster) => {
      const map = { ...get().map, sharperRaster };
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
  useUi.setState({
    ...defaults,
    ...mapUiStart(),
    query: '',
    costLimits: NO_COST_LIMITS,
    leaseMarks: defaultLeaseMarkPrefs(),
    placing: null,
    notice: null,
    picked: [],
    anchor: null,
    rejecting: null,
    editingTogether: false,
    shortcutsOpen: false,
    pickedBuildings: [],
    buildingAnchor: null,
    editingBuildings: false,
  });
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
