import { useEffect, useRef } from 'react';

/**
 * List navigation keys (DESIGN.md §5), the subset that M2 needs; the rest arrive in M6.
 *   /          focus search
 *   ↓ / J      next item       ↑ / K   previous item
 *   Esc        leave search, or close the panel
 *   B          switch Units / Buildings
 * Ignored while typing in a field (except Esc) and when a modifier key is held.
 */
export interface ListKeyHandlers {
  focusSearch: () => void;
  move: (delta: 1 | -1) => void;
  close: () => void;
  toggleView: () => void;
}

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
      switch (e.key) {
        case '/':
          e.preventDefault();
          h.focusSearch();
          break;
        case 'ArrowDown':
        case 'j':
        case 'J':
          e.preventDefault();
          h.move(1);
          break;
        case 'ArrowUp':
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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
