/** Keyboard helpers shared by the app's shortcut handlers and the shortcuts overlay. */

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Name of the shortcut modifier key on this platform. */
export const MOD = IS_MAC ? '⌘' : 'Ctrl';

/** Cmd on a Mac, Ctrl elsewhere (either is accepted everywhere). */
export const isMod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey;

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file', 'image']);

/** True while the user is typing somewhere that has its own undo, copy and arrow keys. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.closest('textarea, select, [contenteditable]:not([contenteditable="false"])')) return true;
  const input = el.closest('input') as HTMLInputElement | null;
  return !!input && !NON_TEXT_INPUTS.has(input.type);
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
      { keys: [[MOD, 'A']], label: 'Select all bins' },
      { keys: [['Delete'], ['Backspace']], label: 'Delete the selected bins' },
    ],
  },
  {
    title: '3D view',
    items: [
      { keys: [['Drag']], label: 'Orbit' },
      { keys: [['Right-drag']], label: 'Pan' },
      { keys: [['Scroll']], label: 'Zoom' },
      { keys: [['Click a bin']], label: 'Select it (Bins tab)' },
    ],
  },
];
