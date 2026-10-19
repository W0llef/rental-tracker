import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { appInfo } from '../../config';
import {
  BUILDING_SORTS,
  DEFAULT_BUILDING_SORT,
  DEFAULT_UNIT_SORT,
  isBuildingSortKey,
  isUnitSortKey,
  UNIT_SORTS,
} from '../../domain/sort';
import type { SortDir } from '../../domain/sort';
import type { SortSpec } from '../../model';
import type { MouseEvent } from 'react';
import type { BuildingRow, Dataset, ListView, UnitRow } from '../../state/derive';
import { SelectionBar } from '../triage/SelectionBar';
import { BuildingSelectionBar } from '../edit/BuildingsTogether';
import { useUi } from '../../state/ui';
import type { ListMode } from '../../state/ui';
import { BuildInfo } from '../shell/BuildInfo';
import { BuildingCard } from './BuildingCard';
import { UnitCard } from './UnitCard';
import styles from './list.module.css';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

interface SortOption {
  label: string;
  dir: SortDir;
  asc: string;
  desc: string;
}

function SortControl({
  sort,
  options,
  onChange,
}: {
  sort: SortSpec;
  options: Record<string, SortOption>;
  onChange: (s: SortSpec) => void;
}) {
  const current = options[sort.key];
  const dirText = current ? current[sort.dir] : '';
  const otherDir: SortDir = sort.dir === 'asc' ? 'desc' : 'asc';
  return (
    <div className={styles.sort}>
      <select
        id="list-sort"
        className={styles.select}
        aria-label="Sort by"
        title="Sort by"
        value={sort.key}
        onChange={(e) => {
          const key = e.target.value;
          onChange({ key, dir: options[key]?.dir ?? 'asc' });
        }}
      >
        {Object.entries(options).map(([key, o]) => (
          <option key={key} value={key}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={styles.dirButton}
        onClick={() => onChange({ key: sort.key, dir: otherDir })}
        aria-label={`Sorted ${dirText}. Change to ${current ? current[otherDir] : ''}`}
        title={`Sorted ${dirText}. Click for ${current ? current[otherDir] : ''}`}
      >
        <span aria-hidden="true">{sort.dir === 'asc' ? '↑' : '↓'}</span>
      </button>
    </div>
  );
}

function ViewSwitch({ view, onChange }: { view: ListMode; onChange: (v: ListMode) => void }) {
  return (
    <div className={styles.seg} role="group" aria-label="List shows">
      {(['units', 'buildings'] as const).map((v) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          title={`Show ${v} (B)`}
        >
          {v === 'units' ? 'Units' : 'Buildings'}
        </button>
      ))}
    </div>
  );
}

function EmptyNoData() {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>No units yet</p>
      <p className={styles.emptyText}>Paste a listing link or an address to add your first one.</p>
      <Link to="/add" state={{ inApp: true }} className={styles.addLink}>
        Add a unit
      </Link>
      {appInfo.channel !== 'live' && (
        <p className={styles.emptyText}>
          Or, to try things out, <Link to="/settings/data">load sample data</Link> in Settings →
          Data.
        </p>
      )}
    </div>
  );
}

/**
 * The list column: view switch, sort, count and the cards. Search lives in the top bar.
 * `selectedKey` is "unit:<id>" or "building:<id>" from the URL.
 */
export function ListPanel({
  data,
  view: listView,
  selectedKey,
  pickedRows = [],
  onPickClick,
  pickedBuildingRows = [],
  onBuildingPickClick,
}: {
  data: Dataset | undefined;
  view: ListView | undefined;
  selectedKey: string | null;
  /** Units selected together (M7). */
  pickedRows?: UnitRow[];
  /** Any click on a unit card (with ⌘/Ctrl or Shift it selects instead of opening). */
  onPickClick?: (e: MouseEvent, unitId: string) => void;
  /** Buildings selected together (M8, Q23). */
  pickedBuildingRows?: BuildingRow[];
  onBuildingPickClick?: (e: MouseEvent, buildingId: string) => void;
}) {
  const pickedIds = new Set(pickedRows.map((r) => r.unit.id));
  const pickedBuildingIds = new Set(pickedBuildingRows.map((r) => r.building.id));
  const {
    view,
    setView,
    query,
    setQuery,
    unitSort,
    setUnitSort,
    buildingSort,
    setBuildingSort,
    setHover,
    hoverKey,
  } = useUi();
  // A pin under the pointer highlights its card; a grouped pin highlights all its units.
  const hoverBuilding = hoverKey?.startsWith('building:')
    ? hoverKey.slice(9)
    : hoverKey?.startsWith('unit:')
      ? (data?.unitById.get(hoverKey.slice(5))?.unit.buildingId ?? null)
      : null;
  // Pointing at a card (or focusing it) shows its pin in full on the map (M3).
  const hoverFrom = (e: { target: EventTarget }) => {
    const card = e.target instanceof Element ? e.target.closest('[data-key]') : null;
    setHover(card?.getAttribute('data-key') ?? null);
  };
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the selected card in view (keyboard moves, or opening a link to a unit).
  useEffect(() => {
    if (!selectedKey) return;
    const el = scroller.current?.querySelector(`[data-key="${selectedKey}"]`);
    if (el && 'scrollIntoView' in el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedKey, view]);

  const totalUnits = data?.units.length ?? 0;
  const totalBuildings = data?.buildings.filter((b) => b.unitCount > 0).length ?? 0;
  const searching = query.trim() !== '';

  let count = '';
  if (data && listView) {
    if (view === 'units')
      count = searching
        ? `${listView.units.length} of ${plural(totalUnits, 'unit')} match`
        : `${plural(totalUnits, 'unit')} in ${plural(totalBuildings, 'building')}`;
    else
      count = searching
        ? `${listView.buildings.length} of ${plural(totalBuildings, 'building')} match`
        : `${plural(totalBuildings, 'building')} with ${plural(totalUnits, 'unit')}`;
  }

  const shown = view === 'units' ? listView?.units.length : listView?.buildings.length;

  return (
    <>
      <div className={styles.head}>
        <div className={styles.headRow}>
          <h2 className={styles.visuallyHidden}>{view === 'units' ? 'Units' : 'Buildings'}</h2>
          <ViewSwitch view={view} onChange={setView} />
          {view === 'units' ? (
            <SortControl
              sort={isUnitSortKey(unitSort.key) ? unitSort : DEFAULT_UNIT_SORT}
              options={UNIT_SORTS}
              onChange={setUnitSort}
            />
          ) : (
            <SortControl
              sort={isBuildingSortKey(buildingSort.key) ? buildingSort : DEFAULT_BUILDING_SORT}
              options={BUILDING_SORTS}
              onChange={setBuildingSort}
            />
          )}
        </div>
        <p className={styles.count} aria-live="polite" data-testid="list-count">
          {count}
        </p>
      </div>

      {data && pickedRows.length > 0 && view === 'units' && (
        <SelectionBar rows={pickedRows} data={data} />
      )}
      {pickedBuildingRows.length > 0 && view === 'buildings' && (
        <BuildingSelectionBar rows={pickedBuildingRows} />
      )}
      <div className={styles.scroller} ref={scroller}>
        {data && totalUnits === 0 && <EmptyNoData />}
        {data && totalUnits > 0 && shown === 0 && (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>
              No {view} match “{query.trim()}”
            </p>
            <p className={styles.emptyText}>
              Search looks at unit numbers, floor plans, building names, addresses, neighborhoods
              and notes.
            </p>
            <button type="button" className={styles.button} onClick={() => setQuery('')}>
              Clear search
            </button>
          </div>
        )}
        {data && listView && (shown ?? 0) > 0 && (
          <ul
            className={styles.cards}
            aria-label={view === 'units' ? 'Units' : 'Buildings'}
            onMouseOver={hoverFrom}
            onFocus={hoverFrom}
            onMouseLeave={() => setHover(null)}
            onBlur={() => setHover(null)}
          >
            {view === 'units'
              ? listView.units.map((row) => (
                  <li key={row.unit.id}>
                    <UnitCard
                      row={row}
                      settings={data.settings}
                      selected={selectedKey === `unit:${row.unit.id}`}
                      picked={pickedIds.has(row.unit.id)}
                      onPickClick={onPickClick}
                      hovered={
                        hoverKey === `unit:${row.unit.id}` ||
                        hoverKey === `building:${row.unit.buildingId}`
                      }
                    />
                  </li>
                ))
              : listView.buildings.map((row) => (
                  <li key={row.building.id}>
                    <BuildingCard
                      row={row}
                      selected={selectedKey === `building:${row.building.id}`}
                      hovered={hoverBuilding === row.building.id}
                      picked={pickedBuildingIds.has(row.building.id)}
                      onPickClick={onBuildingPickClick}
                    />
                  </li>
                ))}
          </ul>
        )}
        <BuildInfo />
      </div>
    </>
  );
}
