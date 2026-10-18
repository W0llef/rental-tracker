import { useMemo, useRef, useState } from 'react';
import {
  Link,
  useLocation,
  useMatch,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { localDate } from '../../domain/format';
import { useListKeys } from '../../hooks/useListKeys';
import { deriveListView } from '../../state/derive';
import { useDataset } from '../../state/useDataset';
import { useUi } from '../../state/ui';
import { QuickAddDialog } from '../add/QuickAddDialog';
import { BuildingPanel } from '../detail/BuildingPanel';
import { MapPanel } from '../map/MapPanel';
import { UnitPanel } from '../detail/UnitPanel';
import { ListPanel } from '../list/ListPanel';
import { BackupBanner } from './BackupBanner';
import { NameBanner } from './NameBanner';
import { Notice } from './Notice';
import { useStorageSafety } from './useStorageSafety';
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
  const location = useLocation();
  const adding = useMatch('/add') !== null;
  const [params] = useSearchParams();
  // Quick-add is a route (#/add), so Back closes it. Opened from the app, closing goes back
  // to where you were; opened from a link, it goes to the main screen.
  const openAdd = () => navigate('/add', { state: { inApp: true } });
  const closeAdd = () => {
    if ((location.state as { inApp?: boolean } | null)?.inApp) navigate(-1);
    else navigate('/', { replace: true });
  };
  const placing = useUi((s) => s.placing);

  const data = useDataset();
  const { query, unitSort, buildingSort, view, toggleView, togglePanel } = useUi();
  const listView = useMemo(
    () => (data ? deriveListView(data, query, unitSort, buildingSort) : undefined),
    [data, query, unitSort, buildingSort],
  );
  const today = localDate();
  const hasData = !!data && (data.units.length > 0 || data.buildings.length > 0);
  useStorageSafety(hasData);

  // Phone tabs: selecting something opens the Unit tab; closing it returns to the list.
  const [tab, setTab] = useState<Tab>(selectedKey ? 'unit' : 'list');
  const [seenKey, setSeenKey] = useState(selectedKey);
  if (seenKey !== selectedKey) {
    setSeenKey(selectedKey);
    if (selectedKey) setTab('unit');
    else if (tab === 'unit') setTab('list');
  }
  // "Place on map" shows the map (phones).
  const [seenPlacing, setSeenPlacing] = useState(placing);
  if (seenPlacing !== placing) {
    setSeenPlacing(placing);
    if (placing) setTab('map');
  }

  const search = useRef<HTMLInputElement>(null);
  const lastMove = useRef<{ from: string | null; to: string } | null>(null);
  useListKeys({
    focusSearch: () => search.current?.focus(),
    // Esc: close a map panel, then fold the fans you opened, then close the details
    close: () => {
      const ui = useUi.getState();
      if (ui.placing) ui.setPlacing(null);
      else if (ui.panel) ui.setPanel(null);
      else if (ui.openFans.length) ui.collapseFans();
      else if (selectedKey) navigate('/');
    },
    toggleView,
    toggleLayers: () => togglePanel('layers'),
    add: () => {
      if (!adding) openAdd();
    },
    move: (delta) => {
      if (!listView) return;
      const keys =
        view === 'units'
          ? listView.units.map((r) => `unit:${r.unit.id}`)
          : listView.buildings.map((r) => `building:${r.building.id}`);
      if (!keys.length) return;
      // Keys pressed quickly can arrive before the screen shows the last move; until it
      // does, continue from where that move went.
      const pending = lastMove.current;
      const current = pending && pending.from === selectedKey ? pending.to : selectedKey;
      const at = current ? keys.indexOf(current) : -1;
      const next =
        at === -1
          ? delta === 1
            ? keys[0]
            : keys[keys.length - 1]
          : keys[Math.min(keys.length - 1, Math.max(0, at + delta))];
      if (!next || next === current) return;
      const [kind, id] = next.split(':');
      lastMove.current = { from: selectedKey, to: next };
      // Moving through the list replaces the history entry, so Back still closes the panel.
      navigate(`/${kind}/${id}`, { replace: current !== null });
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
        <button
          type="button"
          className={styles.addBtn}
          onClick={openAdd}
          title="Add a unit (N)"
          aria-keyshortcuts="n"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <span className={styles.addLabel}>Add unit</span>
          <kbd className={styles.kbd} aria-hidden="true">
            N
          </kbd>
        </button>
        <Link
          to="/settings/backup"
          className={styles.iconBtn}
          title="Settings"
          aria-label="Settings"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M8.6 2h2.8l.4 2.2 1.5.9 2.1-.8 1.4 2.4-1.7 1.5v1.6l1.7 1.5-1.4 2.4-2.1-.8-1.5.9-.4 2.2H8.6l-.4-2.2-1.5-.9-2.1.8-1.4-2.4 1.7-1.5V8.2L3.2 6.7l1.4-2.4 2.1.8 1.5-.9z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <circle cx="10" cy="10" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </Link>
      </header>
      {data && <NameBanner me={data.me} />}
      {data && (
        <BackupBanner hasData={hasData} remindEveryDays={data.settings.backup.remindEveryDays} />
      )}

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
          {data && listView ? (
            <MapPanel data={data} listView={listView} view={view} selectedKey={selectedKey} />
          ) : (
            <div className={styles.mapPlaceholder} aria-busy="true" />
          )}
        </section>
      </main>

      <Notice />
      {adding && data && (
        <QuickAddDialog
          // A new building chosen from its panel starts a fresh dialog.
          key={params.get('building') ?? 'new'}
          data={data}
          presetBuildingId={params.get('building')}
          onClose={closeAdd}
        />
      )}

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
