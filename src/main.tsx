import '@fontsource-variable/overpass';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import './styles/tokens.css';
import './styles/base.css';
import { dbName } from './config';
import { checkPendingUpgrade, hasRecords, readStoredData } from './db/upgradeCheck';
import { router } from './routes';
import { watchActionsForToasts } from './state/toasts';
import { watchForFirstChange } from './ui/shell/useStorageSafety';

const element = document.getElementById('root');
if (!element) throw new Error('Missing #root element');
const root = createRoot(element);

async function renderApp() {
  // Opens the database (running any update) and makes sure this copy has its person.
  const [{ db }, { ensureMe }] = await Promise.all([import('./db/db'), import('./db/me')]);
  await ensureMe(db).catch((e: unknown) => console.error('Couldn’t set up your person.', e));
  watchForFirstChange();
  watchActionsForToasts(db);
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
    await renderApp();
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
          void renderApp();
        }}
      />
    </StrictMode>,
  );
}

void start();
