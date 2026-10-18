import { useEffect, useRef } from 'react';
import { LABEL_KEYS } from '../domain/triage';
import type { LabelColor, Rating } from '../model';

/**
 * The main screen's keys (DESIGN.md §5, PLAN.md §6):
 *   /          focus search
 *   ↓ / J      next item       ↑ / K   previous item
 *   Esc        leave search, or close the panel
 *   B          switch Units / Buildings
 *   L          open or close the Map layers panel (M3)
 *   N          add a unit (Quick-add, M4)
 *   P X U      pick, reject, unflag (M7)
 *   0–5        stars;  6–9 your label;  ⇧6–9 the shared label (M7, Q22)
 *   ⏎          go to the open unit's details;  ?  the shortcut sheet
 *   ⌘/Ctrl+Z   undo;  ⇧⌘Z / Ctrl+Shift+Z  redo
 *   E C F M R  keys of later milestones: say when they arrive
 * Ignored while typing in a field (except Esc), when a modifier key is held (except undo
 * and redo), and inside a dialog (it handles its own keys, Esc included).
 */
export interface ListKeyHandlers {
  focusSearch: () => void;
  move: (delta: 1 | -1) => void;
  close: () => void;
  toggleView: () => void;
  toggleLayers?: () => void;
  /** N: open Quick-add (M4). */
  add?: () => void;
  /** M7 triage, on the open unit or every selected one. */
  flag?: (flag: 'pick' | 'none') => void;
  reject?: () => void;
  rate?: (rating: Rating) => void;
  label?: (color: LabelColor, shared: boolean) => void;
  open?: () => void;
  help?: () => void;
  undo?: () => void;
  redo?: () => void;
  /** A key of a later milestone (E, C, F, M, R). */
  later?: (key: string) => void;
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
      if (e.defaultPrevented) return;
      const h = ref.current;
      if (isTypingTarget(e.target)) return; // the search field handles its own Esc
      if (e.target instanceof Element && e.target.closest('dialog')) return;
      // Undo and redo: ⌘Z / Ctrl+Z, ⇧⌘Z / Ctrl+Shift+Z (and Ctrl+Y on Windows).
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'z' && h.undo && h.redo) {
          e.preventDefault();
          if (e.shiftKey) h.redo();
          else h.undo();
        } else if (k === 'y' && e.ctrlKey && h.redo) {
          e.preventDefault();
          h.redo();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Labels by physical key, so ⇧6 works whatever the keyboard prints for it.
      const color = LABEL_KEYS[e.code];
      if (color && h.label) {
        e.preventDefault();
        h.label(color, e.shiftKey);
        return;
      }
      if (/^[0-5]$/.test(e.key) && h.rate) {
        e.preventDefault();
        h.rate(Number(e.key) as Rating);
        return;
      }
      switch (e.key) {
        case 'p':
        case 'P':
          if (!h.flag) return;
          e.preventDefault();
          h.flag('pick');
          return;
        case 'u':
        case 'U':
          if (!h.flag) return;
          e.preventDefault();
          h.flag('none');
          return;
        case 'x':
        case 'X':
          if (!h.reject) return;
          e.preventDefault();
          h.reject();
          return;
        case '?':
          if (!h.help) return;
          e.preventDefault();
          h.help();
          return;
        case 'Enter':
          // On a focused link or button, ⏎ does what that control does.
          if (!h.open || (e.target instanceof Element && e.target.closest('a, button'))) return;
          e.preventDefault();
          h.open();
          return;
        case 'e':
        case 'E':
        case 'c':
        case 'C':
        case 'f':
        case 'F':
        case 'm':
        case 'M':
        case 'r':
        case 'R':
          h.later?.(e.key.toLowerCase());
          return;
      }
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
