/** The shortcut sheet's contents and the keys of later milestones (DESIGN.md §5). */

export const SHORTCUTS: { group: string; rows: [keys: string, what: string, later?: string][] }[] =
  [
    {
      group: 'Triage (the open unit, or every selected one)',
      rows: [
        ['P', 'Flag as pick'],
        ['X', 'Reject (asks why; ⏎ to confirm)'],
        ['U', 'Remove the flag'],
        ['0–5', 'Set your stars (0 clears)'],
        ['6 7 8 9', 'Your label: red, yellow, green, blue (again to clear)'],
        ['⇧6 ⇧7 ⇧8 ⇧9', 'Shared label: red, yellow, green, blue'],
        ['⌘/Ctrl-click', 'Add a unit to the selection, or take it out'],
        ['Shift-click', 'Select a range of units'],
      ],
    },
    {
      group: 'Moving around',
      rows: [
        ['↑ ↓ or K J', 'Previous / next in the list'],
        ['⏎', 'Go to the open unit’s details'],
        ['Esc', 'Close a panel, clear the selection, or close the details'],
        ['/', 'Search'],
        ['B', 'Switch Units / Buildings'],
        ['L', 'Map layers'],
        ['N', 'Add a unit'],
        ['?', 'This sheet'],
      ],
    },
    {
      group: 'Undo',
      rows: [
        ['⌘Z / Ctrl+Z', 'Undo'],
        ['⇧⌘Z / Ctrl+Shift+Z', 'Redo'],
      ],
    },
    {
      group: 'Coming later',
      rows: [
        ['E', 'Edit the unit', 'M8'],
        ['C', 'Add to compare', 'M10'],
        ['F', 'Filters', 'M10'],
        ['M', 'Explore / Shortlist', 'M10'],
        ['R', 'Copy a research prompt', 'M11'],
        ['⌘V / Ctrl+V', 'Paste an AI reply or listing text outside a field', 'M11'],
      ],
    },
  ];

/** Keys that will do something in a later milestone: pressing one says when. */
export const LATER_KEYS: Record<string, string> = {
  e: 'Editing every detail arrives in M8.',
  c: 'Compare arrives in M10.',
  f: 'Filters arrive in M10.',
  m: 'Explore and Shortlist arrive in M10.',
  r: 'Research prompts arrive in M11.',
};
