import '@fontsource-variable/overpass';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import './styles/tokens.css';
import './styles/base.css';
import { dbName } from './config';
import { checkPendingUpgrade, hasRecords, readStoredData } from './db/upgradeCheck';
import { router } from './routes';
import { watchForFirstChange } from './ui/shell/useStorageSafety';

const element = document.getElementById('root');
if (!element) throw new Error('Missing #root element');
const root = createRoot(element);

function renderApp() {
  watchForFirstChange();
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

/**
 * Before the database is opened: if this version would change how the stored data is kept,
 * offer a backup first (PLAN.md §3.7). Opening the database is what runs the update, so
 * nothing may read it until the person continues.
 */
async function start() {
  const pending = await checkPendingUpgrade(dbName);
  const data = pending ? await readStoredData(dbName).catch(() => null) : null;
  if (!pending || !data || !hasRecords(data)) {
    renderApp();
    return;
  }
  const [{ UpgradeGate }, { db }, { META_KEYS, setMeta }] = await Promise.all([
    import('./ui/shell/UpgradeGate'),
    import('./db/db'),
    import('./db/meta'),
  ]);
  root.render(
    <StrictMode>
      <UpgradeGate
        pending={pending}
        data={data}
        onContinue={(backedUpAt) => {
          if (backedUpAt) void setMeta(db, META_KEYS.lastBackupAt, backedUpAt);
          renderApp();
        }}
      />
    </StrictMode>,
  );
}

void start();
