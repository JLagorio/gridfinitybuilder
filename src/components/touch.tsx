/**
 * Touch screens: a finger told from a mouse, how far a tap moves and how long a long press is, and on-screen toggles
 * that stand in for the modifier keys a phone or tablet doesn't have.
 */
import { useSyncExternalStore } from 'react';
import { create } from 'zustand';

/** The primary pointer is a finger (phones, tablets). */
export const COARSE_QUERY = '(pointer: coarse)';

const coarseList = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(COARSE_QUERY) : null);

/** True on touch screens: handles grow and the touch toggles show. Follows the media query live. */
export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = coarseList();
      m?.addEventListener('change', cb);
      return () => m?.removeEventListener('change', cb);
    },
    () => !!coarseList()?.matches,
    () => false,
  );
}

/** A press from a finger or pen, not a mouse. */
export function isTouch(e: { pointerType?: string }): boolean {
  return e.pointerType === 'touch' || e.pointerType === 'pen';
}

/** A tap moves at most this far (screen px) and still counts as a tap, not a drag. */
export function tapSlop(touch: boolean): number {
  return touch ? 10 : 4;
}

/** A finger held still this long (ms) is a long press: it picks a part up in the 3D view, or adds it to the selection. */
export const HOLD_MS = 450;

interface TouchModes {
  /** Taps add to the selection and drags box-select (Shift on a keyboard). */
  multi: boolean;
  /** Flip the wall's direction, or 15° steps for diagonal walls (Shift). */
  flip: boolean;
  /** No snapping (Alt). */
  free: boolean;
  set(p: Partial<Omit<TouchModes, 'set'>>): void;
}

/** The on-screen modifier toggles. Transient, never saved. */
export const useTouchModes = create<TouchModes>((set) => ({
  multi: false,
  flip: false,
  free: false,
  set: (p) => set(p),
}));

/** A small on/off button standing in for a modifier key. */
export function TouchToggle({ on, label, title, onChange }: { on: boolean; label: string; title: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" className={`touch-toggle ${on ? 'on' : ''}`} aria-pressed={on} title={title} onClick={() => onChange(!on)}>
      {label}
    </button>
  );
}
