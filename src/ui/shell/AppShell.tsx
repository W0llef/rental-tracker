import { useMemo, useRef, useState } from 'react';
import {
  Link,
  useLocation,
  useMatch,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { redo, undo } from '../../commands/undo';
import { db } from '../../db/db';
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
import { HistoryPanel } from '../history/HistoryPanel';
import {
  setFlag,
  setRating,
  startReject,
  togglePrivateLabel,
  toggleSharedLabel,
} from '../triage/actions';
import { BulkEditDialog } from '../triage/BulkEditDialog';
import { RejectDialog } from '../triage/RejectDialog';
import { LATER_KEYS } from '../triage/shortcuts';
import { ShortcutSheet } from '../triage/ShortcutSheet';
import { BackupBanner } from './BackupBanner';
import { NameBanner } from './NameBanner';
import { backupReminder } from '../../services/backup/reminders';
import { useBackupMeta } from '../../state/useBackup';
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
  const historyOpen = useMatch('/history') !== null;
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
  // One banner at a time: the backup reminder first, then the question about your name.
  const backupMeta = useBackupMeta();
  const backupDue =
    !backupMeta ||
    (!!data &&
      backupReminder({
        hasData,
        lastBackupAt: backupMeta.lastBackupAt,
        remindEveryDays: data.settings.backup.remindEveryDays,
        snoozedUntil: backupMeta.snoozedUntil,
        now: new Date(),
      }).due);

  // Phone tabs: selecting something opens the Unit tab; closing it returns to the list.
  // History (M7) opens in the same place as a unit's details.
  const panelKey = historyOpen ? 'history' : selectedKey;
  const [tab, setTab] = useState<Tab>(panelKey ? 'unit' : 'list');
  const [seenKey, setSeenKey] = useState(panelKey);
  if (seenKey !== panelKey) {
    setSeenKey(panelKey);
    if (panelKey) setTab('unit');
    else if (tab === 'unit') setTab('list');
  }
  // "Place on map" shows the map (phones).
  const [seenPlacing, setSeenPlacing] = useState(placing);
  if (seenPlacing !== placing) {
    setSeenPlacing(placing);
    if (placing) setTab('map');
  }

  // Triage targets (M7): every selected unit, or else the open one.
  const picked = useUi((s) => s.picked);
  const rejecting = useUi((s) => s.rejecting);
  const editingTogether = useUi((s) => s.editingTogether);
  const shortcutsOpen = useUi((s) => s.shortcutsOpen);
  const pickedRows = useMemo(
    () =>
      data
        ? picked.map((id) => data.unitById.get(id)).filter((r): r is NonNullable<typeof r> => !!r)
        : [],
    [data, picked],
  );
  const unitRowNow = unitId ? data?.unitById.get(unitId) : undefined;
  const targets = pickedRows.length ? pickedRows : unitRowNow ? [unitRowNow] : [];
  const showNotice = useUi((s) => s.showNotice);
  const nothingSelected = () =>
    showNotice('Select a unit first: click a card, or move with J and K.');
  const onTargets = (fn: (rows: typeof targets, meId: string) => void) => {
    if (!data) return;
    if (!targets.length) nothingSelected();
    else fn(targets, data.me.id);
  };

  const search = useRef<HTMLInputElement>(null);
  const lastMove = useRef<{ from: string | null; to: string } | null>(null);
  useListKeys({
    focusSearch: () => search.current?.focus(),
    // Esc: close a map panel, clear the selection, fold the fans you opened, close the details
    close: () => {
      const ui = useUi.getState();
      if (ui.placing) ui.setPlacing(null);
      else if (ui.panel) ui.setPanel(null);
      else if (ui.picked.length) ui.clearPicked();
      else if (ui.openFans.length) ui.collapseFans();
      else if (selectedKey || historyOpen) navigate('/');
    },
    flag: (f) => onTargets((rows, me) => void setFlag(rows, me, f)),
    reject: () => onTargets((rows, me) => startReject(rows, me)),
    rate: (n) => onTargets((rows, me) => void setRating(rows, me, n)),
    label: (color, shared) =>
      onTargets((rows, me) =>
        shared ? void toggleSharedLabel(rows, color) : void togglePrivateLabel(rows, me, color),
      ),
    open: () => {
      const title = document.getElementById('detail-title');
      if (title) {
        title.setAttribute('tabindex', '-1');
        title.focus();
      }
    },
    help: () => useUi.getState().setShortcutsOpen(true),
    undo: () =>
      void undo(db)
        .then((done) => {
          if (!done) showNotice('Nothing to undo.');
        })
        .catch((e: unknown) => showNotice(`Couldn’t undo. ${(e as Error).message}`)),
    redo: () =>
      void redo(db)
        .then((done) => {
          if (!done) showNotice('Nothing to redo.');
        })
        .catch((e: unknown) => showNotice(`Couldn’t redo. ${(e as Error).message}`)),
    later: (key) => {
      const text = LATER_KEYS[key];
      if (text) showNotice(text);
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

  const unitRow = unitRowNow;
  const buildingRow = buildingId ? data?.buildingById.get(buildingId) : undefined;
  const open = selectedKey !== null || historyOpen;

  let detail;
  if (historyOpen) {
    detail = data ? <HistoryPanel data={data} unitId={params.get('unit')} /> : null;
  } else if (!selectedKey) {
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
    detail = <UnitPanel row={unitRow} settings={data.settings} today={today} me={data.me} />;
  } else if (buildingRow) {
    detail = <BuildingPanel row={buildingRow} today={today} meId={data.me.id} />;
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
          to={historyOpen ? '/' : '/history'}
          className={styles.iconBtn}
          title="History: every change, with Undo"
          aria-label="History"
          aria-current={historyOpen ? 'page' : undefined}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path
              d="M3.5 10a6.5 6.5 0 1 0 1.9-4.6M3.5 3.5v3h3M10 6.5V10l2.5 1.8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Link>
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
      {data && !backupDue && <NameBanner me={data.me} hasData={hasData} />}
      {data && (
        <BackupBanner hasData={hasData} remindEveryDays={data.settings.backup.remindEveryDays} />
      )}

      <main className={styles.main}>
        <section className={styles.list} aria-label="List" data-panel="list">
          <ListPanel
            data={data}
            view={listView}
            selectedKey={selectedKey}
            pickedRows={pickedRows}
            onPickClick={(e, id) => {
              const ui = useUi.getState();
              if (!(e.metaKey || e.ctrlKey || e.shiftKey)) {
                if (ui.picked.length) ui.clearPicked();
                return;
              }
              const order = listView?.units.map((r) => r.unit.id) ?? [];
              const start = ui.picked.length ? ui.picked : unitId ? [unitId] : [];
              if (e.shiftKey) {
                const anchor = ui.anchor ?? unitId ?? id;
                const [a, b] = [order.indexOf(anchor), order.indexOf(id)].sort((x, y) => x - y);
                const range = a! >= 0 ? order.slice(a, (b ?? a!) + 1) : [id];
                const next = e.metaKey || e.ctrlKey ? [...new Set([...start, ...range])] : range;
                ui.setPicked(next, anchor);
              } else {
                const next = start.includes(id) ? start.filter((x) => x !== id) : [...start, id];
                ui.setPicked(next, id);
              }
            }}
          />
        </section>

        <section className={styles.detail} aria-label="Details" data-panel="unit">
          <div className={styles.panelHead}>
            <p className={styles.panelTitle}>
              {historyOpen ? 'History' : buildingId ? 'Building' : 'Unit'}
            </p>
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
          <div
            className={styles.detailScroll}
            key={historyOpen ? 'history' : (selectedKey ?? 'none')}
          >
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

      {rejecting && data && (
        <RejectDialog
          key={rejecting.unitIds.join(',') + rejecting.personId}
          rejecting={rejecting}
          data={data}
          onClose={() => useUi.getState().setRejecting(null)}
        />
      )}
      {editingTogether && data && pickedRows.length > 0 && (
        <BulkEditDialog
          rows={pickedRows}
          data={data}
          onClose={() => useUi.getState().setEditingTogether(false)}
        />
      )}
      {shortcutsOpen && <ShortcutSheet onClose={() => useUi.getState().setShortcutsOpen(false)} />}

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
