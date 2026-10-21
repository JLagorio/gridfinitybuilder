/** Keyboard helpers shared by the app's shortcut handlers and the shortcuts overlay. */

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Name of the shortcut modifier key on this platform. */
export const MOD = IS_MAC ? '⌘' : 'Ctrl';

/** Cmd on a Mac, Ctrl elsewhere (either is accepted everywhere). */
export const isMod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image']);

/**
 * True while the user is typing somewhere that has its own undo, copy and arrow
 * keys, pick lists included (their letters jump to an option, fields.tsx Select).
 */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest('textarea, select, [role="combobox"], [contenteditable]:not([contenteditable="false"])')) return true;
  const input = el.closest('input') as HTMLInputElement | null;
  return !!input && !NON_TEXT_INPUTS.has(input.type);
}

/** An open pick list (fields.tsx Select / Combobox) has the focus: Escape is its, to close it. */
export function inOpenList(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && typeof el.closest === 'function' && !!el.closest('[role="combobox"][aria-expanded="true"]');
}

/** Letter of a key press, independent of Shift and of the keyboard layout where possible. */
export function keyLetter(e: KeyboardEvent): string {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  return e.key.toLowerCase();
}

export interface ShortcutGroup {
  title: string;
  items: { keys: string[][]; label: string }[];
}

/** Everything the "?" overlay lists. Each entry's `keys` are alternatives; each alternative is a chord. */
export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Anywhere',
    items: [
      { keys: [[MOD, 'Z']], label: 'Undo' },
      { keys: [[MOD, 'Shift', 'Z'], ...(IS_MAC ? [] : [['Ctrl', 'Y']])], label: 'Redo' },
      { keys: [[MOD, 'K'], ['/']], label: 'Find what’s in your bins' },
      { keys: [['?']], label: 'Show or hide this list' },
      { keys: [['Esc']], label: 'Clear the selection, close this list' },
    ],
  },
  {
    title: 'Bin layout',
    items: [
      { keys: [['Drag over empty cells']], label: 'Draw a bin' },
      { keys: [['Click']], label: 'Select a bin' },
      { keys: [['Shift', 'Click'], [MOD, 'Click']], label: 'Add or remove a bin from the selection' },
      { keys: [['Shift', 'Drag'], ['Drag from outside the grid']], label: 'Select every bin in a box' },
      { keys: [['Drag a selected bin']], label: 'Move the whole selection' },
      { keys: [['Drag a handle']], label: 'Resize the selected bin' },
      { keys: [['←'], ['→'], ['↑'], ['↓']], label: 'Nudge the selection one cell' },
      { keys: [[MOD, 'C']], label: 'Copy' },
      { keys: [[MOD, 'X']], label: 'Cut' },
      { keys: [[MOD, 'V']], label: 'Paste (at the cell under the pointer, or the first free spot)' },
      { keys: [[MOD, 'D']], label: 'Duplicate' },
      { keys: [[MOD, 'Shift', 'V']], label: 'Paste a copied compartment layout into the selected bins' },
      { keys: [[MOD, 'A']], label: 'Select all bins' },
      { keys: [['Delete'], ['Backspace']], label: 'Delete the selected bins' },
    ],
  },
  {
    title: 'Compartments (bin walls)',
    items: [
      { keys: [['Click inside the bin']], label: 'Add a wall across that space (snaps to 50%, 33%, 25%, other walls and cell lines)' },
      { keys: [['Shift']], label: 'Flip the new wall between across and along' },
      { keys: [['R']], label: 'Lock the direction: auto, vertical, horizontal' },
      { keys: [['Alt', 'Drag']], label: 'Move without snapping (fine steps only)' },
      { keys: [['Drag a wall']], label: 'Move it; drag an end handle to re-attach it' },
      { keys: [['Click a size']], label: 'Type an exact gap, e.g. 1 3/4 or 44.5mm' },
      { keys: [['←'], ['→'], ['↑'], ['↓']], label: 'Nudge the selected wall (Shift: 10×)' },
      { keys: [['Delete'], ['Backspace']], label: 'Remove the selected wall' },
      { keys: [['W'], ['D'], ['S']], label: 'Tools: add walls, diagonal / curved walls, select' },
      { keys: [['D', 'Drag']], label: 'Draw a diagonal wall (snaps to corners, wall ends, midpoints, 25 / 75%)' },
      { keys: [['Shift', 'Drag']], label: 'Diagonal wall: keep the angle in 15° steps' },
      { keys: [['Drag the middle handle']], label: 'Curve a diagonal wall into an arc' },
      { keys: [[MOD, 'C']], label: 'Copy this bin’s layout' },
      { keys: [[MOD, 'V']], label: 'Paste a copied layout into this bin' },
    ],
  },
  {
    title: 'Tool cutouts',
    items: [
      { keys: [['Drag a tool in']], label: 'Place it in the bin' },
      { keys: [['R']], label: 'Rotate 15°' },
      { keys: [['Alt', 'Drag']], label: 'Move without snapping' },
      { keys: [['Double-click the outline']], label: 'Add a finger notch' },
      { keys: [['Delete']], label: 'Remove the selected pocket' },
    ],
  },
  {
    title: '3D view',
    items: [
      { keys: [['Drag']], label: 'Orbit, including below the floor to see the undersides' },
      { keys: [['Iso / Top / Front / Side / Under']], label: 'Preset views (bottom right of the 3D view)' },
      { keys: [['Right-drag']], label: 'Pan' },
      { keys: [['Scroll']], label: 'Zoom' },
      { keys: [['Click a bin']], label: 'Select it (Bins tab)' },
      { keys: [['C']], label: 'Cross-section: cut through everything with a plane' },
      { keys: [['M']], label: 'Measure between two points (snaps to corners)' },
      { keys: [['Esc']], label: 'Clear the measurement; again to stop measuring' },
      { keys: [['X']], label: 'X-ray: see pockets, magnet holes and screw channels inside' },
      { keys: [['L']], label: 'Lift the bins off the baseplate, or seat them (Bins tab)' },
    ],
  },
];
