import { createContext, useContext } from 'react';

/**
 * Shared state of one open form (DESIGN.md §4.3): which empty fields were marked unknown in
 * this session (`?`), the typing errors that block saving, and moving between empty fields
 * (⌘/Ctrl+↓). Unknown and not-yet-asked are the same in the data (null); the mark only
 * changes how the field looks and whether "next empty field" stops there.
 */
export interface FormApi {
  marked: ReadonlySet<string>;
  setMarked: (path: string, on: boolean) => void;
  errors: ReadonlyMap<string, string>;
  setError: (path: string, error: string | null) => void;
  /** Focus the next (or previous) empty field after this element; false if there's none. */
  nextEmpty: (from: Element | null, dir?: 1 | -1) => boolean;
}

export const FormContext = createContext<FormApi | null>(null);

const fallback: FormApi = {
  marked: new Set(),
  setMarked: () => undefined,
  errors: new Map(),
  setError: () => undefined,
  nextEmpty: () => false,
};

export const useFormApi = (): FormApi => useContext(FormContext) ?? fallback;

/** What can take focus inside a field row, in order of preference. */
const FOCUSABLE =
  'input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled), [role=radio][tabindex="0"], button:not([tabindex="-1"]):not(:disabled)';

/** The empty rows of a form, in document order. */
export function emptyRows(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-field][data-empty]')];
}

/**
 * Focuses the next empty row after `from` (wrapping around), so a form can be filled by
 * keyboard alone. Returns false when nothing is left empty.
 */
export function focusNextEmpty(root: ParentNode, from: Element | null, dir: 1 | -1 = 1): boolean {
  const rows = emptyRows(root);
  if (!rows.length) return false;
  const here = from?.closest('[data-field]') ?? from;
  let target: HTMLElement | undefined;
  if (here) {
    const after = (r: HTMLElement) =>
      r !== here &&
      !!(here.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_FOLLOWING) &&
      !here.contains(r);
    const before = (r: HTMLElement) =>
      r !== here &&
      !!(here.compareDocumentPosition(r) & Node.DOCUMENT_POSITION_PRECEDING) &&
      !r.contains(here);
    target = dir === 1 ? rows.find(after) : [...rows].reverse().find(before);
  }
  target ??= dir === 1 ? rows[0] : rows[rows.length - 1];
  if (!target || target === here) return false;
  return focusRow(target);
}

/** Focuses a field row's first control and brings it into view. */
export function focusRow(row: HTMLElement): boolean {
  const control = row.querySelector<HTMLElement>(FOCUSABLE);
  if (!control) return false;
  control.focus({ preventScroll: true });
  control.scrollIntoView?.({ block: 'center' });
  return true;
}

/** Finds a field's row by its path ("unit.rent"). */
export function rowOf(root: ParentNode, path: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-field="${path.replace(/["\\]/g, '')}"]`);
}
