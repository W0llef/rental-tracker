import { createHashRouter, Navigate } from 'react-router-dom';
import { AppShell } from './ui/shell/AppShell';

/**
 * Hash URLs (#/unit/…) work on GitHub Pages without any server rewrite rules.
 * Only the home route exists in M0; later milestones add unit, building, compare, settings.
 */
export const router = createHashRouter([
  { path: '/', element: <AppShell /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);
