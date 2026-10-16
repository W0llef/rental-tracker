import { createHashRouter, Navigate } from 'react-router-dom';
import { AppShell } from './ui/shell/AppShell';

/**
 * Hash URLs (#/unit/…) work on GitHub Pages without any server rewrite rules.
 * M1 adds the data check page (#/debug); later milestones add unit, building, compare, settings.
 */
export const router = createHashRouter([
  { path: '/', element: <AppShell /> },
  {
    path: '/debug',
    // Loaded on demand, so the database code isn't in the first download until M2 needs it.
    lazy: () => import('./ui/debug/DebugPage').then((m) => ({ Component: m.DebugPage })),
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
