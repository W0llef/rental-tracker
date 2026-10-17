import { useEffect } from 'react';
import { onAction } from '../../commands/action';
import { db } from '../../db/db';
import { ensurePersistence } from '../../services/storage';

/**
 * Asks the browser to keep the data (persistent storage, PLAN.md §5.5) once there is data:
 * after the first change anywhere in the app (registered once at startup), or on opening
 * the main screen if data is already there. It asks only once by itself; Settings →
 * Storage can ask again.
 */
export function watchForFirstChange(): () => void {
  return onAction((e) => {
    if (e.kind === 'do') void ensurePersistence(db).catch(() => undefined);
  });
}

export function useStorageSafety(hasData: boolean) {
  useEffect(() => {
    if (hasData) void ensurePersistence(db).catch(() => undefined);
  }, [hasData]);
}
