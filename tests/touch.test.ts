import { describe, expect, it } from 'vitest';
import { doubleTapper, fingerPx, isTouch, tapSlop } from '../src/components/touch';

const ev = (t: number, x = 100, y = 100) => ({ timeStamp: t, clientX: x, clientY: y });

describe('touch helpers', () => {
  it('grows pick distances for a finger and leaves the mouse alone', () => {
    expect(fingerPx(6, false)).toBe(6);
    expect(fingerPx(6, true)).toBeGreaterThanOrEqual(18);
    expect(fingerPx(30, true)).toBe(60);
    expect(tapSlop(true)).toBeGreaterThan(tapSlop(false));
    expect(isTouch({ pointerType: 'touch' })).toBe(true);
    expect(isTouch({ pointerType: 'pen' })).toBe(true);
    expect(isTouch({ pointerType: 'mouse' })).toBe(false);
  });

  it('sees two quick taps on the same target as a double tap', () => {
    const tap = doubleTapper();
    tap.down(ev(0));
    expect(tap.up(ev(80), 'a')).toBe(false);
    tap.down(ev(200, 104, 98));
    expect(tap.up(ev(260, 104, 98), 'a')).toBe(true);
    // A third tap starts over.
    tap.down(ev(400));
    expect(tap.up(ev(450), 'a')).toBe(false);
  });

  it('never counts a slow pair, another target, or a drag', () => {
    const slow = doubleTapper();
    slow.down(ev(0));
    slow.up(ev(50), 'a');
    slow.down(ev(500));
    expect(slow.up(ev(550), 'a')).toBe(false);

    const other = doubleTapper();
    other.down(ev(0));
    other.up(ev(50), 'a');
    other.down(ev(150));
    expect(other.up(ev(200), 'b')).toBe(false);

    // The end of a drag followed by a tap at the same spot is not a double tap.
    const drag = doubleTapper();
    drag.down(ev(0, 40, 100));
    expect(drag.up(ev(200, 100, 100), 'a')).toBe(false);
    drag.down(ev(260));
    expect(drag.up(ev(300), 'a')).toBe(false);
  });
});
