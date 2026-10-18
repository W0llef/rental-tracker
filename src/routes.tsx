import { createHashRouter, Navigate } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { AppShell } from './ui/shell/AppShell';

/**
 * Hash URLs (#/unit/…) work on GitHub Pages without any server rewrite rules.
 * The main screen is one route; selecting a unit or building only adds a child path, so
 * the list keeps its scroll position and state while the detail panel changes (M2).
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [{ path: 'unit/:unitId' }, { path: 'building/:buildingId' }, { path: 'add' }],
  },
  {
    path: '/debug',
    // Loaded on demand: the Data check page isn't part of everyday use.
    lazy: () => import('./ui/debug/DebugPage').then((m) => ({ Component: m.DebugPage })),
  },
  { path: '/settings', element: <Navigate to="/settings/backup" replace /> },
  {
    path: '/settings/:section',
    // Loaded on demand, like the Data check page.
    lazy: () => import('./ui/settings/SettingsPage').then((m) => ({ Component: m.SettingsPage })),
  },
  { path: '*', element: <Navigate to="/" replace /> },
];

export const router = createHashRouter(routes);
