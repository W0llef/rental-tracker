import { parseUrl } from '../../domain/input';
import type { Building } from '../../model';

/** Web addresses as saved: https:// added where it was left off. */
export function withSchemes(b: Building): Building {
  const fix = (v: string | null) => {
    if (v === null) return null;
    const r = parseUrl(v);
    return r.ok ? r.value : v;
  };
  return { ...b, website: fix(b.website), availabilityUrl: fix(b.availabilityUrl) };
}

export const SMOKING = (['not-allowed', 'designated-areas', 'allowed'] as const).map((v) => ({
  value: v,
  label: v === 'not-allowed' ? 'Not allowed' : v === 'allowed' ? 'Allowed' : 'Designated areas',
}));
