import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { appInfo } from '../../config';
import { BUILDING_SORTS, isBuildingSortKey, isUnitSortKey, UNIT_SORTS } from '../../domain/sort';
import type { SortDir } from '../../domain/sort';
import type { SortSpec } from '../../model';
import type { Dataset, ListView } from '../../state/derive';
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
      {appInfo.channel === 'live' ? (
        <p className={styles.emptyText}>Adding units arrives in a later update.</p>
      ) : (
        <p className={styles.emptyText}>
          To try the list, <Link to="/debug">load sample data</Link> on the Data check page.
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
}: {
  data: Dataset | undefined;
  view: ListView | undefined;
  selectedKey: string | null;
}) {
  const { view, setView, query, setQuery, unitSort, setUnitSort, buildingSort, setBuildingSort } =
    useUi();
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
              sort={isUnitSortKey(unitSort.key) ? unitSort : { key: 'rent', dir: 'asc' }}
              options={UNIT_SORTS}
              onChange={setUnitSort}
            />
          ) : (
            <SortControl
              sort={
                isBuildingSortKey(buildingSort.key) ? buildingSort : { key: 'minRent', dir: 'asc' }
              }
              options={BUILDING_SORTS}
              onChange={setBuildingSort}
            />
          )}
        </div>
        <p className={styles.count} aria-live="polite" data-testid="list-count">
          {count}
        </p>
      </div>

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
          <ul className={styles.cards} aria-label={view === 'units' ? 'Units' : 'Buildings'}>
            {view === 'units'
              ? listView.units.map((row) => (
                  <li key={row.unit.id}>
                    <UnitCard
                      row={row}
                      settings={data.settings}
                      selected={selectedKey === `unit:${row.unit.id}`}
                    />
                  </li>
                ))
              : listView.buildings.map((row) => (
                  <li key={row.building.id}>
                    <BuildingCard
                      row={row}
                      selected={selectedKey === `building:${row.building.id}`}
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
