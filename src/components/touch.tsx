/**
 * Touch screens: finger-sized hit targets, double taps, and on-screen toggles
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

/** A pick radius in screen pixels, grown for a finger (about 9 px of slack becomes 22). */
export function fingerPx(px: number, touch: boolean): number {
  return touch ? Math.max(px * 2, px + 13) : px;
}

/** A tap moves at most this far (screen px) and still counts as a tap, not a drag. */
export function tapSlop(touch: boolean): number {
  return touch ? 10 : 4;
}

/**
 * Double taps, for actions that are a double-click with a mouse (browsers don't
 * reliably send dblclick for fingers). Call `down` on each pointerdown and `up` on
 * each touch pointerup: `up` says whether this was the second of two quick taps on
 * the same target. A press that moved or was held (a drag) is never a tap.
 */
export function doubleTapper(ms = 350, slop = 24) {
  let press: { t: number; x: number; y: number } | null = null;
  let last: { t: number; x: number; y: number; key: string } | null = null;
  type Ev = { clientX: number; clientY: number; timeStamp: number };
  return {
    down(e: Ev) {
      press = { t: e.timeStamp, x: e.clientX, y: e.clientY };
    },
    up(e: Ev, key: string): boolean {
      const tap = !!press && e.timeStamp - press.t < ms && Math.hypot(e.clientX - press.x, e.clientY - press.y) < tapSlop(true);
      press = null;
      if (!tap) {
        last = null;
        return false;
      }
      const second = !!last && last.key === key && e.timeStamp - last.t < ms && Math.hypot(e.clientX - last.x, e.clientY - last.y) < slop;
      last = second ? null : { t: e.timeStamp, x: e.clientX, y: e.clientY, key };
      return second;
    },
  };
}

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
