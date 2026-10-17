import { useEffect, useRef } from 'react';

/**
 * List navigation keys (DESIGN.md §5), the subset that M2 needs; the rest arrive in M6.
 *   /          focus search
 *   ↓ / J      next item       ↑ / K   previous item
 *   Esc        leave search, or close the panel
 *   B          switch Units / Buildings
 *   L          open or close the Map layers panel (M3)
 *   N          add a unit (Quick-add, M4)
 * Ignored while typing in a field (except Esc), when a modifier key is held, and inside a
 * dialog (it handles its own keys, Esc included).
 */
export interface ListKeyHandlers {
  focusSearch: () => void;
  move: (delta: 1 | -1) => void;
  close: () => void;
  toggleView: () => void;
  toggleLayers?: () => void;
  /** N: open Quick-add (M4). */
  add?: () => void;
}

/** The map canvas pans with the arrow keys; let it, rather than moving the list. */
const onMapCanvas = (target: EventTarget | null) =>
  target instanceof HTMLElement && target.classList.contains('maplibregl-canvas');

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color'].includes(type);
}

export function useListKeys(handlers: ListKeyHandlers) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const h = ref.current;
      if (isTypingTarget(e.target)) return; // the search field handles its own Esc
      if (e.target instanceof Element && e.target.closest('dialog')) return;
      switch (e.key) {
        case '/':
          e.preventDefault();
          h.focusSearch();
          break;
        case 'ArrowDown':
          if (onMapCanvas(e.target)) return;
          e.preventDefault();
          h.move(1);
          break;
        case 'j':
        case 'J':
          e.preventDefault();
          h.move(1);
          break;
        case 'ArrowUp':
          if (onMapCanvas(e.target)) return;
          e.preventDefault();
          h.move(-1);
          break;
        case 'k':
        case 'K':
          e.preventDefault();
          h.move(-1);
          break;
        case 'Escape':
          h.close();
          break;
        case 'b':
        case 'B':
          h.toggleView();
          break;
        case 'l':
        case 'L':
          h.toggleLayers?.();
          break;
        case 'n':
        case 'N':
          if (!h.add) return;
          e.preventDefault();
          h.add();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
