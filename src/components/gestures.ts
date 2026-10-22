/**
 * Finger gestures the editors tell apart from a tap and a drag: double taps (where a mouse double-clicks) and long
 * presses (where a mouse would Shift-click), and pick distances grown for a finger. Here, not in touch.tsx, so they
 * load with the editors that use them rather than with the first screen.
 */
import { HOLD_MS, tapSlop } from './touch';

/** A pick radius in screen pixels, grown for a finger (about 9 px of slack becomes 22). */
export function fingerPx(px: number, touch: boolean): number {
  return touch ? Math.max(px * 2, px + 13) : px;
}

type At = { clientX: number; clientY: number };

/**
 * Double taps, for actions that are a double-click with a mouse (browsers don't
 * reliably send dblclick for fingers). Call `down` on each pointerdown and `up` on
 * each touch pointerup: `up` says whether this was the second of two quick taps on
 * the same target. A press that moved or was held (a drag) is never a tap.
 */
export function doubleTapper(ms = 350, slop = 24) {
  let press: { t: number; x: number; y: number } | null = null;
  let last: { t: number; x: number; y: number; key: string } | null = null;
  type Ev = At & { timeStamp: number };
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

/**
 * Long presses: `down` starts the wait, `move` calls it off once the finger has strayed further than a tap would,
 * `stop` calls it off (the finger lifted, or a second one came down). `fire` runs if the finger is still down, and
 * still, `ms` after it came down; `stop` then says it fired, so the press's lift can do nothing more.
 */
export function longPress(ms = HOLD_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let at: [number, number] | null = null;
  let fired = false;
  return {
    down(e: At, fire: () => void) {
      clearTimeout(timer);
      at = [e.clientX, e.clientY];
      fired = false;
      timer = setTimeout(() => {
        at = null;
        fired = true;
        fire();
      }, ms);
    },
    move(e: At) {
      if (at && Math.hypot(e.clientX - at[0], e.clientY - at[1]) > tapSlop(true)) {
        clearTimeout(timer);
        at = null;
      }
    },
    /** Calls off a wait; true if this press fired already. */
    stop(): boolean {
      clearTimeout(timer);
      at = null;
      const was = fired;
      fired = false;
      return was;
    },
  };
}
