import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { longPress } from '../src/components/gestures';
import { HOLD_MS, tapSlop } from '../src/components/touch';
import { FINGER_PX, atLeastPx, boxDistance, handleHit, heldSelection, nearestPart } from '../src/components/wallTouch';

const at = (x: number, y = 100) => ({ clientX: x, clientY: y });

describe('finger targets on the board editors', () => {
  it('grows a target to a fingertip and leaves a big one alone', () => {
    // A phone shows a 220 mm board about 360 px wide: 0.6 mm a pixel.
    expect(atLeastPx(3, FINGER_PX, 0.6)).toBeCloseTo(24);
    expect(atLeastPx(30, FINGER_PX, 0.6)).toBe(30);
    expect(FINGER_PX).toBeGreaterThanOrEqual(40);
  });

  it('gives each resize handle a fingertip, mostly outside the part', () => {
    const big = { x0: 0, x1: 100, y0: 0, y1: 60 };
    const reach = 24;
    for (const edge of ['e', 's', 'se'] as const) {
      const z = handleHit(edge, big, 4, reach);
      expect(z.x1 - z.x0).toBeCloseTo(reach);
      expect(z.y1 - z.y0).toBeCloseTo(reach);
    }
    // On a big part it's centred on the handle.
    const e = handleHit('e', big, 8, reach);
    expect(e.x0).toBeCloseTo(88);
    expect(e.x1).toBeCloseTo(112);
    expect((e.y0 + e.y1) / 2).toBeCloseTo(30);
    const s = handleHit('s', big, 8, reach);
    expect((s.x0 + s.x1) / 2).toBeCloseTo(50);
    expect(s.y1).toBeCloseTo(12);
    expect(s.y0).toBeCloseTo(-12);
    const se = handleHit('se', big, 4, reach);
    expect([se.x0, se.x1, se.y0, se.y1].map((v) => Math.round(v))).toEqual([88, 112, -12, 12]);
  });

  it('leaves most of a small part to drag', () => {
    // A hook 12 mm wide and 30 tall: the handles reach in a third of it at most.
    const hook = { x0: 40, x1: 52, y0: 100, y1: 130 };
    const e = handleHit('e', hook, 4, 24);
    expect(hook.x1 - e.x0).toBeLessThanOrEqual(4 + 1e-9);
    expect(e.x1 - e.x0).toBeCloseTo(24);
    const s = handleHit('s', hook, 4, 24);
    expect(s.y1 - hook.y0).toBeLessThanOrEqual(10 + 1e-9);
    const se = handleHit('se', hook, 4, 24);
    expect(hook.x1 - se.x0).toBeLessThanOrEqual(4 + 1e-9);
    expect(se.y1 - hook.y0).toBeLessThanOrEqual(10 + 1e-9);
  });

  it('never shrinks a handle below how it is drawn', () => {
    // With a mouse the editor draws no extra target; a tiny reach still covers the handle.
    const z = handleHit('e', { x0: 0, x1: 100, y0: 0, y1: 60 }, 8, 1);
    expect(z.y1 - z.y0).toBe(8);
  });

  it('takes the part a finger lands just beside', () => {
    const parts = [
      { id: 'hook', x0: 40, x1: 46, y0: 100, y1: 150 },
      { id: 'bin', x0: 80, x1: 160, y0: 100, y1: 160 },
    ];
    expect(boxDistance(parts[0], 43, 120)).toBe(0);
    expect(boxDistance(parts[0], 50, 120)).toBe(4);
    expect(boxDistance(parts[0], 49, 154)).toBe(5);
    expect(nearestPart(parts, 50, 120, 12)?.id).toBe('hook');
    // Nearer the bin than the hook.
    expect(nearestPart(parts, 72, 120, 12)?.id).toBe('bin');
    // Too far from both: the empty board.
    expect(nearestPart(parts, 63, 120, 12)).toBeNull();
    expect(nearestPart(parts, 43, 40, 12)).toBeNull();
    expect(nearestPart([], 0, 0, 12)).toBeNull();
  });

  it('adds a long-pressed part to the selection, or takes it out', () => {
    expect(heldSelection([], 'a')).toEqual(['a']);
    expect(heldSelection(['b', 'c'], 'a')).toEqual(['a', 'b', 'c']);
    expect(heldSelection(['b', 'a', 'c'], 'a')).toEqual(['b', 'c']);
    expect(heldSelection(['a'], 'a')).toEqual([]);
  });
});

describe('long presses', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires for a finger held still, once', () => {
    const hold = longPress();
    const fire = vi.fn();
    hold.down(at(100), fire);
    vi.advanceTimersByTime(HOLD_MS - 10);
    // A finger wobbles a little: still a hold.
    hold.move(at(100 + tapSlop(true) - 1));
    expect(fire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(fire).toHaveBeenCalledTimes(1);
    // Its lift is spent.
    expect(hold.stop()).toBe(true);
    expect(hold.stop()).toBe(false);
  });

  it('is a tap when lifted early, and a drag once it moves', () => {
    const fire = vi.fn();
    const tap = longPress();
    tap.down(at(100), fire);
    vi.advanceTimersByTime(HOLD_MS / 2);
    expect(tap.stop()).toBe(false);
    vi.advanceTimersByTime(HOLD_MS);

    const drag = longPress();
    drag.down(at(100), fire);
    vi.advanceTimersByTime(50);
    drag.move(at(100 + tapSlop(true) + 1));
    vi.advanceTimersByTime(HOLD_MS);
    // Moving back doesn't start it again.
    drag.move(at(100));
    vi.advanceTimersByTime(HOLD_MS);
    expect(drag.stop()).toBe(false);
    expect(fire).not.toHaveBeenCalled();
  });

  it('starts over on each press', () => {
    const hold = longPress(100);
    const first = vi.fn();
    const second = vi.fn();
    hold.down(at(0), first);
    vi.advanceTimersByTime(60);
    hold.down(at(0), second);
    vi.advanceTimersByTime(60);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
