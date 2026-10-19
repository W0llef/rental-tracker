import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

/**
 * A link from one form to another (a unit's building, a building's units). It takes the
 * current form's place in the history instead of stacking on it (owner, M8 review): Save or
 * Cancel on the second form goes back to where the first was opened from, not to the first
 * form. Unsaved changes in the form being left are asked about once, as for any link.
 */
export function FormLink({ to, children }: { to: string; children: ReactNode }) {
  const location = useLocation();
  const inApp = !!(location.state as { inApp?: boolean } | null)?.inApp;
  return (
    <Link to={to} replace state={{ inApp }}>
      {children}
    </Link>
  );
}
