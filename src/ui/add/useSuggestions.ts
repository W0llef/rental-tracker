import { useEffect, useState } from 'react';
import { geocoder, MIN_QUERY } from '../../services/geocode';
import type { Geocoder, Place } from '../../services/geocode';

export type SuggestStatus = 'idle' | 'loading' | 'done' | 'unavailable';

export const DEBOUNCE_MS = 350;

/**
 * Photon suggestions for the address being typed (PLAN.md §5.1): 350 ms after the last key,
 * 3+ characters, the previous request cancelled. Off while `enabled` is false (a suggestion
 * or a building is already chosen).
 */
export function useSuggestions(
  text: string,
  enabled: boolean,
  service: () => Geocoder = geocoder,
): { places: Place[]; status: SuggestStatus } {
  const [state, setState] = useState<{ q: string; places: Place[]; status: SuggestStatus }>({
    q: '',
    places: [],
    status: 'idle',
  });
  const q = text.trim();
  const active = enabled && q.length >= MIN_QUERY;

  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, q, status: 'loading' }));
      service()
        .suggest(q, ctrl.signal)
        .then((places) => {
          if (!ctrl.signal.aborted) setState({ q, places, status: 'done' });
        })
        .catch((e: Error) => {
          if (!ctrl.signal.aborted && e.name !== 'AbortError')
            setState({ q, places: [], status: 'unavailable' });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, active, service]);

  if (!active) return { places: [], status: 'idle' };
  // Until the debounce fires for new text, keep showing the last answer.
  return { places: state.places, status: state.q === q ? state.status : 'loading' };
}
