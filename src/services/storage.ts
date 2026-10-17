import type { RentalDB } from '../db/db';
import { getMeta, META_KEYS, setMeta } from '../db/meta';

/**
 * Persistent storage (PLAN.md §5.5, §10). Browsers may clear a site's data when the disk is
 * nearly full unless the site has asked to keep it. The app asks once, after the first
 * change to the data; Settings → Storage shows the answer and can ask again.
 * Chrome and Edge decide quietly (they say yes for sites you use a lot or have bookmarked);
 * Firefox asks you; Safari decides by itself.
 */

export interface StorageStatus {
  /** null: this browser doesn't say (no Storage API). */
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

function storageManager(): StorageManager | null {
  return typeof navigator !== 'undefined' && navigator.storage ? navigator.storage : null;
}

export async function storageStatus(): Promise<StorageStatus> {
  const sm = storageManager();
  if (!sm) return { persisted: null, usage: null, quota: null };
  const [persisted, estimate] = await Promise.all([
    sm.persisted ? sm.persisted().catch(() => null) : Promise.resolve(null),
    sm.estimate ? sm.estimate().catch(() => null) : Promise.resolve(null),
  ]);
  return {
    persisted,
    usage: estimate?.usage ?? null,
    quota: estimate?.quota ?? null,
  };
}

/** Asks the browser to keep the data. Returns its answer (null when it can't be asked). */
export async function requestPersistence(db: RentalDB, now = new Date()): Promise<boolean | null> {
  const sm = storageManager();
  if (!sm?.persist) return null;
  await setMeta(db, META_KEYS.persistAskedAt, now.toISOString());
  try {
    return await sm.persist();
  } catch {
    return null;
  }
}

/** Asks once, automatically: only if storage isn't kept yet and the app hasn't asked before. */
export async function ensurePersistence(db: RentalDB): Promise<void> {
  const sm = storageManager();
  if (!sm?.persist || !sm.persisted) return;
  if (await sm.persisted().catch(() => true)) return;
  if (await getMeta(db, META_KEYS.persistAskedAt)) return;
  await requestPersistence(db);
}

/** "1.2 MB", "340 kB", "12 GB". */
export function bytesText(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`;
  const units = ['kB', 'MB', 'GB', 'TB'];
  let value = bytes / 1000;
  let i = 0;
  while (value >= 1000 && i < units.length - 1) {
    value /= 1000;
    i++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}
