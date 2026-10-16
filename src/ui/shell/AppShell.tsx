import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { localDate } from '../../domain/format';
import { useListKeys } from '../../hooks/useListKeys';
import { deriveListView } from '../../state/derive';
import { useDataset } from '../../state/useDataset';
import { useUi } from '../../state/ui';
import { BuildingPanel } from '../detail/BuildingPanel';
import { UnitPanel } from '../detail/UnitPanel';
import { ListPanel } from '../list/ListPanel';
import { PreviewBanner } from './PreviewBanner';
import { SearchField } from './SearchField';
import styles from './AppShell.module.css';

type Tab = 'list' | 'map' | 'unit';

const tabs: { id: Tab; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'map', label: 'Map' },
  { id: 'unit', label: 'Unit' },
];

/**
 * The main screen (DESIGN.md §3; PLAN.md §4.1):
 *  - ≥ 1280 px: list · detail · map; the detail column joins when something is selected
 *  - 760–1279 px: list · map, with the detail panel over the map
 *  - phone (< 760 px): bottom tabs List · Map · Unit; selecting opens the Unit tab
 * Selection is the URL: #/unit/:unitId or #/building/:buildingId, so Back closes the panel.
 */
export function AppShell() {
  const { unitId, buildingId } = useParams();
  const selectedKey = unitId ? `unit:${unitId}` : buildingId ? `building:${buildingId}` : null;
  const navigate = useNavigate();

  const data = useDataset();
  const { query, unitSort, buildingSort, view, toggleView } = useUi();
  const listView = useMemo(
    () => (data ? deriveListView(data, query, unitSort, buildingSort) : undefined),
    [data, query, unitSort, buildingSort],
  );
  const today = localDate();

  // Phone tabs: selecting something opens the Unit tab; closing it returns to the list.
  const [tab, setTab] = useState<Tab>(selectedKey ? 'unit' : 'list');
  const [seenKey, setSeenKey] = useState(selectedKey);
  if (seenKey !== selectedKey) {
    setSeenKey(selectedKey);
    if (selectedKey) setTab('unit');
    else if (tab === 'unit') setTab('list');
  }

  const search = useRef<HTMLInputElement>(null);
  useListKeys({
    focusSearch: () => search.current?.focus(),
    close: () => {
      if (selectedKey) navigate('/');
    },
    toggleView,
    move: (delta) => {
      if (!listView) return;
      const keys =
        view === 'units'
          ? listView.units.map((r) => `unit:${r.unit.id}`)
          : listView.buildings.map((r) => `building:${r.building.id}`);
      if (!keys.length) return;
      const at = selectedKey ? keys.indexOf(selectedKey) : -1;
      const next =
        at === -1
          ? delta === 1
            ? keys[0]
            : keys[keys.length - 1]
          : keys[Math.min(keys.length - 1, Math.max(0, at + delta))];
      if (!next || next === selectedKey) return;
      const [kind, id] = next.split(':');
      // Moving through the list replaces the history entry, so Back still closes the panel.
      navigate(`/${kind}/${id}`, { replace: selectedKey !== null });
    },
  });

  const unitRow = unitId ? data?.unitById.get(unitId) : undefined;
  const buildingRow = buildingId ? data?.buildingById.get(buildingId) : undefined;
  const open = selectedKey !== null;

  let detail;
  if (!selectedKey) {
    detail = (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>Nothing selected</p>
        <p className={styles.emptyText}>
          Select a unit or building in the list to see its details here.
        </p>
      </div>
    );
  } else if (!data) {
    detail = null; // still reading the database
  } else if (unitRow) {
    detail = <UnitPanel row={unitRow} settings={data.settings} today={today} />;
  } else if (buildingRow) {
    detail = <BuildingPanel row={buildingRow} today={today} />;
  } else {
    detail = (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>
          {unitId ? 'This unit isn’t in your list' : 'This building isn’t in your list'}
        </p>
        <p className={styles.emptyText}>
          It may have been deleted, or the link is from another browser.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.app} data-tab={tab} data-open={open || undefined}>
      <PreviewBanner />
      <header className={styles.top}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            <svg viewBox="0 0 16 16">
              <rect x="2" y="3" width="12" height="7" rx="1.5" fill="var(--on-river)" />
              <path d="M6 10 L8 13 L10 10Z" fill="var(--on-river)" />
            </svg>
          </span>
          <h1 className={styles.title}>Rental Unit Tracker</h1>
        </div>
        <SearchField ref={search} />
      </header>

      <main className={styles.main}>
        <section className={styles.list} aria-label="List" data-panel="list">
          <ListPanel data={data} view={listView} selectedKey={selectedKey} />
        </section>

        <section className={styles.detail} aria-label="Details" data-panel="unit">
          <div className={styles.panelHead}>
            <p className={styles.panelTitle}>{buildingId ? 'Building' : 'Unit'}</p>
            {open && (
              <button
                type="button"
                className={styles.close}
                onClick={() => navigate('/')}
                aria-label="Close details"
                title="Close (Esc)"
              >
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" />
                </svg>
              </button>
            )}
          </div>
          <div className={styles.detailScroll} key={selectedKey ?? 'none'}>
            {detail}
          </div>
        </section>

        <section className={styles.map} aria-labelledby="map-heading" data-panel="map">
          <h2 id="map-heading" className={styles.visuallyHidden}>
            Map
          </h2>
          <div className={styles.mapPlaceholder}>
            <p className={styles.mapNote}>The map arrives in the next step.</p>
          </div>
        </section>
      </main>

      <nav className={styles.tabs} aria-label="Views">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            className={styles.tab}
            aria-current={tab === t.id ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
