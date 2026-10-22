/**
 * Shadow board: a plate that clips on with each traced tool's outline cut a
 * little way into its front, the classic workshop board where you see what's
 * missing. The tools are traced from a photo on a sheet of paper or imported
 * from an SVG or DXF file (./traced.ts), and laid out in rows with room
 * between them, standing up (the heavier end at the top, as tools hang) or
 * lying across, or kept where they were in the photo or file. The plate is as
 * big as they need, and at least as big as asked.
 *
 * What holds each tool is picked for it:
 * - pegs: two gusseted pegs under it, either side of its middle and as high
 *   as they fit (a screwdriver's straddle its shaft under the handle, a
 *   wrench's sit under its shaft by the heads), each with a lip at its end;
 * - ledge: a cup round the bottom of its outline with a lip over its front
 *   edge: it drops in from above, for narrow tools that would tip off pegs;
 * - magnets: two pockets in its shadow for magnets, glued in (steel tools);
 * - none: just its shadow (it hangs on a hook of its own).
 * Finger notches beside its long sides, its name cut in under it.
 *
 * Printed upright as it hangs, like the other plates. A recess in an upright
 * face has a roof, so each cut's top edge slopes back at 45° as it goes in
 * (on the face the outline is exact), and the pegs and ledges stand on 45°
 * gussets: nothing needs support. A two-part board (a face printed flat,
 * glued to a frame with clips) would print the shadows crisper but needs
 * glue and lines up worse; a shallow shadow with sloped tops prints as well
 * upright.
 *
 * Two colours (`fill`): each shadow filled flush in filament 2, its role
 * 'shadow' with multi-colour on, like the bins' two-colour shadow floors: the
 * outline shows in its own colour when the tool's out.
 */
import type { Vec2 } from '../../geometry/kernel';
import { bounds } from '../../trace/polygon';
import { BOLT, backMounts, minHeight } from '../mount';
import { bool, num, obj, pick, registerAttachment, type AttachmentLayout, type MountCtx } from '../registry';
import { clearOf } from './plate';
import { TRACED, cleanTraced, centred, longTurn, magnetSpots, notchSpots, pegSpots, turned, uprightTurn, type TracedTool } from './traced';

export const ARRANGE = ['upright', 'across', 'keep'] as const;
/** Magnets: diameter and thickness, mm. */
export const MAGNETS = { '6x2': [6, 2], '8x2': [8, 2], '8x3': [8, 3], '10x3': [10, 3] } as const;
export type MagnetSize = keyof typeof MAGNETS;

export interface ShadowBoardOptions {
  tools: TracedTool[];
  /** Standing up or lying across in rows, or where they were in the photo or file. */
  arrange: (typeof ARRANGE)[number];
  /** The rows' width, and the board's least width, mm. */
  width: number;
  /** The board's least height; 0: as tall as the tools need. */
  height: number;
  /** How deep each shadow is cut. */
  pocket: number;
  thick: number;
  /** Room between tools. */
  gap: number;
  notches: boolean;
  names: boolean;
  /** The shadows filled flush in a second colour. */
  fill: boolean;
  magnet: MagnetSize;
}

export const SHADOW_BOARD_DEFAULTS: ShadowBoardOptions = {
  tools: [],
  arrange: 'upright',
  width: 200,
  height: 0,
  pocket: 1,
  thick: 5,
  gap: 12,
  notches: true,
  names: true,
  fill: false,
  magnet: '8x2',
};

/**
 * Sizes, mm: room round the tools to the plate's edge, the board's least height, plastic behind every cut, the
 * widest gap between parts of a shadow that's filled in (a sliver of plate thinner than that doesn't print), the
 * lips' thickness (pegs and ledges); a peg's width, how far its lip rises over it, the gusset's height at its tip;
 * the ledge's wall, its lip's reach over the tool, the cup's height (a share of the tool's, within limits); a notch's
 * radius and how much deeper than the shadow it goes; the names' height and gap; magnets' clearance (across, and
 * deeper) and how far in from the outline their pockets keep.
 */
export const SHADOW = {
  margin: 8,
  minH: 60,
  floor: 1.2,
  close: 2,
  lip: 2,
  peg: { w: 6, rise: 3, tip: 3 },
  ledge: { wall: 2.5, over: 1.5, cup: 0.35, cupMin: 8, cupMax: 30 },
  notch: { r: 7, deeper: 1.5 },
  name: { size: 5, gap: 2 },
  magnet: { fit: 0.3, deeper: 0.2, inset: 0.8 },
} as const;

/** A box in the board's front view: x0, y0, x1, y1. */
type Box = [number, number, number, number];

/** A tool where it is on the board, and everything that goes with it (front view). */
export interface ShadowItem {
  tool: TracedTool;
  /** Its outline. */
  pts: Vec2[];
  /** The middle of each peg's top (the tool rests on it). */
  pegs: { x: number; y: number }[];
  /** How far its pegs or ledge reach out from the plate's front, to the lip's front. */
  reach: number;
  /** The top of its ledge's cup, or null. */
  cup: number | null;
  magnets: Vec2[];
  notches: Vec2[];
  /** Its name's middle and width. */
  name: { x: number; y: number; w: number } | null;
  /** Everything of it. */
  box: Box;
}

export interface ShadowPlan {
  w: number;
  h: number;
  /** The plate's thickness (more than asked where the cuts need it). */
  t: number;
  items: ShadowItem[];
  notes: string[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const around = (boxes: Box[]): Box => [
  Math.min(...boxes.map((b) => b[0])),
  Math.min(...boxes.map((b) => b[1])),
  Math.max(...boxes.map((b) => b[2])),
  Math.max(...boxes.map((b) => b[3])),
];

/** A tool's outline turned as laid out, and all that goes with it, round its own middle (or, kept as in the file, its place there). */
function itemOf(t: TracedTool, o: ShadowBoardOptions): ShadowItem {
  const base = o.arrange === 'upright' ? uprightTurn(t.outline) : o.arrange === 'across' ? longTurn(t.outline, false) : 0;
  let pts = turned(t.outline, base + t.rotation);
  pts = o.arrange === 'keep' ? pts.map(([x, y]) => [x + t.x, y + t.y] as Vec2) : centred(pts);
  const c = t.clearance;
  const b = bounds(pts);
  const boxes: Box[] = [[b.x0 - c, b.y0 - c, b.x1 + c, b.y1 + c]];
  const reach = r2(t.depth + c + SHADOW.lip);
  const P = SHADOW.peg;
  const pegs = t.hold === 'pegs' ? pegSpots(pts, P.w, c, reach + P.tip) : [];
  for (const g of pegs) boxes.push([g.x - P.w / 2, g.y - reach - P.tip, g.x + P.w / 2, g.y + P.rise]);
  const L = SHADOW.ledge;
  const cup = t.hold === 'ledge' ? b.y0 + clamp(L.cup * (b.y1 - b.y0), L.cupMin, L.cupMax) : null;
  if (cup !== null) boxes.push([b.x0 - c - L.wall, b.y0 - c - L.wall - reach, b.x1 + c + L.wall, cup]);
  const M = SHADOW.magnet;
  const magnets = t.hold === 'magnets' ? magnetSpots(pts, MAGNETS[o.magnet][0] + M.fit, Math.max(M.inset, o.pocket - c + 0.3)) : [];
  const R = SHADOW.notch.r;
  // Notches clear of its pegs and its ledge's cup (they'd fill it); either side of a narrow part, one across it.
  let notches = (o.notches ? notchSpots(pts) : []).filter(
    ([x, y]) => !boxes.slice(1).some(([x0, y0, x1, y1]) => x + R > x0 - 1 && x - R < x1 + 1 && y + R > y0 - 1 && y - R < y1 + 1),
  );
  if (notches.length === 2 && Math.hypot(notches[0][0] - notches[1][0], notches[0][1] - notches[1][1]) < 2 * R + 2)
    notches = [[(notches[0][0] + notches[1][0]) / 2, (notches[0][1] + notches[1][1]) / 2]];
  for (const [x, y] of notches) boxes.push([x - R, y - R, x + R, y + R]);
  let box = around(boxes);
  let name: ShadowItem['name'] = null;
  const N = SHADOW.name;
  if (o.names && t.name.trim()) {
    const w = Math.max(box[2] - box[0], Math.min(60, 0.6 * N.size * t.name.trim().length));
    const x = (box[0] + box[2]) / 2;
    name = { x, y: box[1] - N.gap - N.size / 2, w };
    box = around([box, [x - w / 2, box[1] - N.gap - N.size, x + w / 2, box[1]]]);
  }
  return { tool: t, pts, pegs, reach, cup, magnets, notches, name, box };
}

/** An item moved by (dx, dy). */
function moved(it: ShadowItem, dx: number, dy: number): ShadowItem {
  const m = ([x, y]: Vec2): Vec2 => [r2(x + dx), r2(y + dy)];
  return {
    ...it,
    pts: it.pts.map(m),
    pegs: it.pegs.map((g) => ({ x: r2(g.x + dx), y: r2(g.y + dy) })),
    cup: it.cup === null ? null : r2(it.cup + dy),
    magnets: it.magnets.map(m),
    notches: it.notches.map(m),
    name: it.name && { x: r2(it.name.x + dx), y: r2(it.name.y + dy), w: it.name.w },
    box: [it.box[0] + dx, it.box[1] + dy, it.box[2] + dx, it.box[3] + dy],
  };
}

// Laying out turns every outline 180 times: keep the last few boards' items (planning asks for them often).
const ITEMS = new Map<string, ShadowItem[]>();
function itemsOf(o: ShadowBoardOptions): ShadowItem[] {
  const key = JSON.stringify([o.tools, o.arrange, o.notches, o.names, o.magnet, o.pocket]);
  let out = ITEMS.get(key);
  if (!out) {
    out = o.tools.map((t) => itemOf(t, o));
    if (ITEMS.size >= 16) ITEMS.delete(ITEMS.keys().next().value!);
    ITEMS.set(key, out);
  }
  return out;
}

/**
 * The tools laid out as a block, its bottom-left at the origin: in rows from the top (each as wide as the board
 * allows, the rows centred, the tools in a row lined up along their tops) or as in the file; its size, the plate's
 * thickness (more than asked where the cuts need it) and anything worth a note. The board is round it.
 */
function arranged(o: ShadowBoardOptions): { items: ShadowItem[]; w: number; h: number; t: number; notes: string[] } {
  const M = SHADOW.margin;
  const local = itemsOf(o);
  const notes: string[] = [];
  let items: ShadowItem[] = [];
  let w = 0;
  let h = 0;
  if (local.length && o.arrange === 'keep') {
    const g = around(local.map((i) => i.box));
    [w, h] = [g[2] - g[0], g[3] - g[1]];
    items = local.map((i) => moved(i, -g[0], -g[1]));
    const hit = (a: Box, b: Box) => a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5;
    if (items.some((a, i) => items.some((b, j) => j > i && hit(a.box, b.box))))
      notes.push('Some tools overlap where they were in the file: lay them out standing up or across instead, or space them out.');
  } else if (local.length) {
    const size = (i: ShadowItem) => [i.box[2] - i.box[0], i.box[3] - i.box[1]];
    const avail = Math.max(o.width - 2 * M, ...local.map((i) => size(i)[0]));
    const rows: { items: ShadowItem[]; w: number; h: number }[] = [];
    for (const it of local) {
      const [iw, ih] = size(it);
      const row = rows[rows.length - 1];
      if (row && row.w + o.gap + iw <= avail + 1e-6) {
        row.items.push(it);
        row.w += o.gap + iw;
        row.h = Math.max(row.h, ih);
      } else rows.push({ items: [it], w: iw, h: ih });
    }
    w = Math.max(...rows.map((r) => r.w));
    h = rows.reduce((s, r) => s + r.h, 0) + o.gap * (rows.length - 1);
    let top = h;
    for (const row of rows) {
      let x = (w - row.w) / 2;
      for (const it of row.items) {
        items.push(moved(it, x - it.box[0], top - it.box[3]));
        x += size(it)[0] + o.gap;
      }
      top -= row.h + o.gap;
    }
  }
  for (const it of items) {
    const name = it.tool.name;
    if (it.tool.hold === 'pegs' && it.pegs.length < 2) notes.push(`${name} is too narrow for two pegs, so one holds it: a ledge holds it better.`);
    if (it.tool.hold === 'magnets' && !it.magnets.length)
      notes.push(`${name} is too narrow for ${MAGNETS[o.magnet][0]} mm magnets: hold it with pegs or a ledge.`);
  }
  const [, mt] = MAGNETS[o.magnet];
  const magnets = items.some((i) => i.magnets.length);
  const deeper = Math.max(magnets ? mt + SHADOW.magnet.deeper : 0, o.notches && items.length ? SHADOW.notch.deeper : 0);
  return { items, w, h, t: r2(Math.max(o.thick, o.pocket + deeper + SHADOW.floor)), notes };
}

/** The board planned: its size and thickness, each tool where it goes with its pegs, ledge, magnets, notches and name (the block in its middle), and anything worth a note. */
export function shadowPlan(o: ShadowBoardOptions, ctx: MountCtx): ShadowPlan {
  const M = SHADOW.margin;
  const a = arranged(o);
  const w = r2(Math.max(o.width, a.items.length ? a.w + 2 * M : 0));
  const h = r2(Math.max(o.height, a.items.length ? a.h + 2 * M : 0, SHADOW.minH, minHeight(ctx)));
  return { w, h, t: a.t, items: a.items.map((i) => moved(i, (w - a.w) / 2, (h - a.h) / 2)), notes: a.notes };
}

/** How far it stands out: its pegs and ledges, or the plate. */
const standsOut = (p: ShadowPlan) => r2(p.t + Math.max(0, ...p.items.filter((i) => i.pegs.length || i.cup !== null).map((i) => i.reach)));

const shadowLayout = (o: ShadowBoardOptions, ctx: MountCtx): AttachmentLayout => {
  const p = shadowPlan(o, ctx);
  const m = backMounts(p.w, p.h, ctx, { rows: 3 });
  return { w: p.w, h: p.h, depth: standsOut(p), anchor: m.anchor, mounts: m.mounts, pose: 'upright' };
};

registerAttachment<ShadowBoardOptions>({
  type: 'shadowBoard',
  defaults: SHADOW_BOARD_DEFAULTS,
  sanitize(raw) {
    const r = obj(raw);
    const d = SHADOW_BOARD_DEFAULTS;
    return {
      tools: cleanTraced(r.tools, TRACED.tools),
      arrange: pick(r.arrange, ARRANGE, d.arrange),
      width: num(r.width, 40, 400, d.width),
      height: num(r.height, 0, 400, d.height),
      pocket: num(r.pocket, 0.4, 3, d.pocket),
      thick: num(r.thick, 3, 10, d.thick),
      gap: num(r.gap, 2, 60, d.gap),
      notches: bool(r.notches, d.notches),
      names: bool(r.names, d.names),
      fill: bool(r.fill, d.fill),
      magnet: pick(r.magnet, Object.keys(MAGNETS) as MagnetSize[], d.magnet),
    };
  },
  layout: shadowLayout,
  inlaid: (o) => o.fill && o.tools.length > 0,
  summary: (o) => (o.tools.length ? `Shadow board, ${o.tools.length} tool${o.tools.length === 1 ? '' : 's'}` : 'Shadow board'),
  notes: (o) => arranged(o).notes,
  labelFace(o, l) {
    // Along the bottom, under the tools: a name for the board.
    const a = arranged(o);
    const h = Math.min(8, (a.items.length ? (l.h - a.h) / 2 : l.h) - 2.5);
    return h >= 4 && l.w > 20 ? { x: 4, y: 1.5, w: r2(l.w - 8), h: r2(h), z: a.t, normal: 'front' } : null;
  },
  backPlate(o, l, ctx) {
    // Wherever no tool is: its shadow, pegs, ledge, notches and name, and 1 mm round them.
    const p = shadowPlan(o, ctx);
    const keep = p.items.map((i): Box => [i.box[0] - 1, i.box[1] - 1, i.box[2] + 1, i.box[3] + 1]);
    return clearOf([0, 0, l.w, l.h], keep, BOLT.m3.head + 2).map(([x0, y0, x1, y1]) => ({ x0, x1, y0, y1, z: p.t }));
  },
  hardware(o) {
    const n = itemsOf(o).reduce((s, i) => s + i.magnets.length, 0);
    const [d, t] = MAGNETS[o.magnet];
    return n ? [{ item: `Magnets ${d} × ${t} mm (shadow board)`, count: n, note: 'glued into the pockets in the tools’ shadows' }] : [];
  },
});
