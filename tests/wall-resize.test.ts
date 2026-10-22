import { describe, expect, it } from 'vitest';
import { attachmentDef, attachmentDefs, type MountCtx } from '../src/lib/wall';
import { attachmentUi } from '../src/lib/wall/ui';
import { partBounds } from '../src/lib/wall/mount';
import { resizeAxes, resized } from '../src/lib/wall/resize';

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };
const size = (type: string, o: object) => {
  const def = attachmentDef(type)!;
  const b = partBounds(def.layout(def.sanitize(o), CTX), CTX);
  return { w: b.x1 - b.x0, h: b.y1 - b.y0 };
};
const axesOf = (type: string, o: object = {}) => resizeAxes(attachmentDef(type)!, attachmentUi(type), attachmentDef(type)!.sanitize(o), CTX);

describe('resizing by the edges', () => {
  it('finds the options that size a part: lengths before counts', () => {
    expect(axesOf('bin').w?.key).toBe('width');
    expect(axesOf('bin').h?.key).toBe('height');
    // A Gridfinity shelf grows a cell (42 mm) at a time.
    const g = axesOf('gridShelf').w!;
    expect(g.key).toBe('cellsX');
    expect(g.step).toBe(1);
    expect(g.per).toBeCloseTo(42, 0);
    // A depth isn't a size on the board.
    for (const t of ['bin', 'shelf', 'cradle']) for (const a of Object.values(axesOf(t))) expect(a?.key).not.toBe('depth');
  });

  it('makes every kind it can size bigger and smaller the way it is dragged', () => {
    let sized = 0;
    for (const def of attachmentDefs()) {
      const o = def.sanitize(def.defaults);
      const ax = resizeAxes(def, attachmentUi(def.type), o, CTX);
      const s0 = size(def.type, o);
      for (const [axis, d] of [
        ['w', 60],
        ['h', 60],
      ] as const) {
        const a = ax[axis];
        if (!a) continue;
        sized++;
        // Bigger by enough for a whole step, if the option has room; smaller likewise.
        const up = { ...o, ...resized(def, o, ax, axis === 'w' ? d : 0, axis === 'h' ? d : 0) };
        const down = { ...o, ...resized(def, o, ax, axis === 'w' ? -d : 0, axis === 'h' ? -d : 0) };
        const su = size(def.type, up);
        const sd = size(def.type, down);
        expect(su[axis], `${def.type} ${axis} up`).toBeGreaterThanOrEqual(s0[axis] - 1e-6);
        expect(sd[axis], `${def.type} ${axis} down`).toBeLessThanOrEqual(s0[axis] + 1e-6);
        expect(su[axis] - sd[axis], `${def.type} ${axis} moves`).toBeGreaterThan(0);
        // Only its own option changes, within its range.
        const patch = resized(def, o, ax, axis === 'w' ? d : 0, axis === 'h' ? d : 0);
        expect(Object.keys(patch)).toEqual([a.key]);
        expect(Number(patch[a.key])).toBeGreaterThanOrEqual(a.min);
        expect(Number(patch[a.key])).toBeLessThanOrEqual(a.max);
      }
    }
    // Most kinds have a width or a height to drag.
    expect(sized).toBeGreaterThan(40);
  });

  it('a count moves in whole steps', () => {
    const def = attachmentDef('gridShelf')!;
    const o = def.sanitize({});
    const ax = resizeAxes(def, attachmentUi('gridShelf'), o, CTX);
    expect(resized(def, o, ax, 30, 0)).toEqual({ cellsX: Number((o as { cellsX: number }).cellsX) + 1 });
    expect(resized(def, o, ax, 10, 0)).toEqual({ cellsX: Number((o as { cellsX: number }).cellsX) });
  });
});
