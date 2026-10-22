/**
 * Starter boards: a board size and a set of attachments for a corner of the
 * house (a 3D printer's, an electronics bench, a paint station, …), ready in
 * one click from the drawer menu or an empty board's Attachments tab.
 *
 * Each attachment is a kind with one of its form's presets (the kinds' .ui.ts
 * files) and options of its own, a name, what's in it, and where it's wanted
 * on the template's board. fitTemplate puts each, in order, on the slot
 * nearest that spot where its mounts all find slots and it keeps clear of the
 * board's edges and of everything placed before it, so a template goes on any
 * board: a smaller one, or one with parts on it already. What has no room is
 * left out, and said so.
 *
 * Loaded with the template picker (components/BoardTemplates.tsx), not on the
 * first screen.
 */
import { DEFAULT_BASEPLATE } from '../geometry/baseplate';
import { DEFAULT_SKADIS, type SkadisOptions } from '../geometry/skadis';
import { DEFAULT_DRAWER } from '../layout/drawer';
import type { PrintSetup } from '../layout/plan';
import { newId } from '../bins';
import { planPrint } from '../project';
import type { Vec2 } from '../geometry/kernel';
import { attachmentDef, type MountCtx, type PlacedAttachment } from './index';
import './kinds/all';
import { attachmentUi } from './ui';
import { lockKey, partBounds, siteAt } from './mount';
import { attachmentLayout, planExtras, slotKeys, fitsAt, type WallBoard, type WallPlacement } from './plan';

/** One attachment of a template. */
export interface TemplateItem {
  type: string;
  /** One of its kind's presets (the value of its form's preset field), set before `opts`. */
  preset?: string;
  opts?: Record<string, unknown>;
  name?: string;
  /** What's in it, one item per line. */
  contents?: string;
  /** Its label says what's in it (PlacedAttachment.labelFrom). */
  labelFrom?: 'contents';
  /**
   * Where it goes on the template's board: the middle of its top edge, mm from the board's bottom-left (on another
   * board, the same share of it). Parts in a row share a top, as things hang from a line.
   */
  at: [number, number];
}

export interface BoardTemplate {
  id: string;
  name: string;
  /** One line for the picker. */
  description: string;
  /** The board's size, mm. */
  width: number;
  height: number;
  items: TemplateItem[];
}

/** Room kept between two parts (half of it from the board’s edge), mm. */
const GAP = 4;

const pliers = (p: string) => ({ mode: 'pliers', pliers: p });

export const BOARD_TEMPLATES: BoardTemplate[] = [
  {
    id: 'print3d',
    name: '3D printing corner',
    description: 'A filament spool, build plates, hex keys, the scraper, nozzles and spares, a cable channel.',
    width: 560,
    height: 560,
    items: [
      { type: 'spoolRack', preset: 'filament', name: 'Filament', at: [455, 548] },
      { type: 'toolRack', opts: { mode: 'hexKeys', hexKeys: '1.5, 2, 2.5, 3, 4, 5, 6' }, name: 'Hex keys', contents: 'Hex keys 1.5–6 mm', at: [75, 548] },
      { type: 'slotRack', preset: 'plates', name: 'Build plates', contents: 'Smooth PEI plate\nTextured PEI plate', at: [225, 548] },
      {
        type: 'bin',
        opts: { width: 60, height: 40, depth: 40 },
        name: 'Nozzles',
        contents: 'Nozzles 0.4 mm\nNozzles 0.6 mm',
        labelFrom: 'contents',
        at: [45, 468],
      },
      { type: 'holster', opts: { width: 40, depth: 14, slot: 0, back: 60 }, name: 'Scraper', at: [125, 468] },
      { type: 'cup', opts: { diameter: 30, height: 60 }, name: 'Glue stick', at: [200, 468] },
      { type: 'measureHanger', preset: 'caliper150', name: 'Calipers', at: [275, 468] },
      { type: 'toolRack', opts: pliers('8, 10'), name: 'Cutters', contents: 'Flush cutters\nNeedle-nose pliers', at: [65, 368] },
      {
        type: 'bin',
        opts: { width: 140, height: 60, depth: 50, dividers: 2 },
        name: 'Spares',
        contents: 'PTFE tube\nThermistors\nHeater cartridges',
        at: [205, 368],
      },
      { type: 'mediaBlock', preset: 'sd', name: 'SD cards', at: [325, 368] },
      { type: 'shelf', name: 'Cleaning', contents: 'Isopropyl alcohol\nPaper towels', at: [455, 308] },
      {
        type: 'bin',
        opts: { width: 160, height: 60, depth: 50, dividers: 3 },
        name: 'Fasteners',
        contents: 'M3 screws\nM3 nuts\nM3 heat-set inserts\nM2 screws',
        at: [110, 268],
      },
      { type: 'cableChannel', name: 'Cables', at: [280, 68] },
    ],
  },
  {
    id: 'electronics',
    name: 'Electronics bench',
    description: 'Solder and wire on spools, the iron’s holster, test leads, pliers and drivers, part bins, batteries.',
    width: 560,
    height: 560,
    items: [
      { type: 'spoolRack', preset: 'solder', name: 'Solder & wire', at: [120, 548] },
      { type: 'holster', preset: 'solderIron', name: 'Soldering iron', at: [280, 548] },
      { type: 'bottleRack', preset: 'flux', name: 'Flux & IPA', contents: 'Flux\nIsopropyl alcohol', at: [440, 548] },
      { type: 'leadHanger', preset: 'banana', name: 'Test leads', at: [80, 448] },
      { type: 'toolRack', opts: pliers('8, 10, 12'), name: 'Pliers', contents: 'Flush cutters\nNeedle-nose pliers\nWire strippers', at: [240, 448] },
      { type: 'toolRack', opts: { mode: 'drivers', drivers: '2, 2.5, 3, 3, 4', handle: 20 }, name: 'Screwdrivers', at: [440, 448] },
      {
        type: 'bin',
        opts: { width: 140, height: 50, depth: 45, dividers: 3 },
        name: 'Resistors',
        contents: 'Resistors 100 Ω–1 kΩ\nResistors 1–10 kΩ\nResistors 10–100 kΩ\nPotentiometers',
        at: [90, 348],
      },
      {
        type: 'bin',
        opts: { width: 140, height: 50, depth: 45, dividers: 3 },
        name: 'Capacitors',
        contents: 'Ceramic capacitors\nElectrolytic capacitors\nLEDs\nDiodes',
        at: [260, 348],
      },
      { type: 'cellDispenser', preset: 'aa', name: 'AA batteries', at: [455, 348] },
      { type: 'bin', opts: { width: 100, height: 50, depth: 45, dividers: 1 }, name: 'Headers', contents: 'Header pins\nJumper wires', at: [70, 248] },
      { type: 'mediaBlock', preset: 'microsd', name: 'microSD cards', at: [180, 248] },
      { type: 'cableComb', name: 'Leads', at: [280, 248] },
      { type: 'cableChannel', name: 'USB cables', at: [280, 68] },
    ],
  },
  {
    id: 'paint',
    name: 'Paint station',
    description: 'Dropper bottles in stepped racks, brushes, a water pot, the airbrush, a ledge for finished minis, a light.',
    width: 560,
    height: 560,
    items: [
      { type: 'ledBar', name: 'Light', at: [280, 558] },
      { type: 'bottleRack', preset: 'dropper', name: 'Paints', at: [105, 528] },
      { type: 'bottleRack', preset: 'dropper', name: 'Washes & inks', at: [290, 528] },
      { type: 'holster', preset: 'airbrush', name: 'Airbrush', at: [460, 528] },
      { type: 'stickRack', preset: 'brushSmall', name: 'Brushes', at: [50, 428] },
      { type: 'stickRack', preset: 'brushLarge', name: 'Big brushes', at: [150, 428] },
      { type: 'cup', preset: 'spray', name: 'Water pot', at: [260, 428] },
      {
        type: 'bin',
        opts: { width: 140, height: 60, depth: 50, dividers: 2 },
        name: 'Tools',
        contents: 'Hobby knife\nTweezers\nSculpting tools',
        at: [430, 428],
      },
      { type: 'displayLedge', preset: 'b25', name: 'Finished minis', at: [110, 308] },
      { type: 'rod', name: 'Paper towels', at: [300, 308] },
      { type: 'bin', opts: { width: 80, height: 60, depth: 50 }, name: 'Palette', contents: 'Wet palette paper', labelFrom: 'contents', at: [470, 308] },
      { type: 'shelf', opts: { width: 200, depth: 80, sides: true }, name: 'Primers & varnish', at: [280, 168] },
    ],
  },
  {
    id: 'kitchen',
    name: 'Kitchen wall',
    description: 'Spice racks, knives on a magnet bar, pot lids, utensils, cutting boards, mugs on hooks, herbs.',
    width: 560,
    height: 560,
    items: [
      { type: 'bottleRack', preset: 'spice46', opts: { columns: 4 }, name: 'Spices', at: [125, 548] },
      { type: 'bottleRack', preset: 'spice46', opts: { columns: 4 }, name: 'Spices', at: [320, 548] },
      { type: 'planter', preset: 'p2', name: 'Herbs', at: [500, 548] },
      { type: 'magnetBar', name: 'Knives', at: [130, 428] },
      { type: 'slotRack', preset: 'lids', name: 'Pot lids', at: [320, 428] },
      { type: 'cup', preset: 'pens', name: 'Utensils', contents: 'Spatulas\nWhisk\nWooden spoons', at: [480, 428] },
      { type: 'hook', opts: { style: 'j', reach: 60 }, name: 'Mug', at: [45, 308] },
      { type: 'hook', opts: { style: 'j', reach: 60 }, name: 'Mug', at: [85, 308] },
      { type: 'hook', opts: { style: 'j', reach: 60 }, name: 'Mug', at: [125, 308] },
      { type: 'slotRack', preset: 'boards', name: 'Cutting boards', at: [270, 308] },
      { type: 'shelf', opts: { width: 160, depth: 100 }, name: 'Oils', at: [455, 308] },
      { type: 'boxSleeve', preset: 'zip', name: 'Zip bags', at: [130, 148] },
      { type: 'hook', opts: { style: 'double', reach: 60 }, name: 'Tea towels', at: [300, 128] },
      { type: 'hook', opts: { style: 'double', reach: 60 }, name: 'Oven gloves', at: [360, 128] },
    ],
  },
  {
    id: 'garage',
    name: 'Garage tools',
    description: 'A drill dock, batteries and the charger, wrenches, sockets, drivers, clamps, a tape measure, screws.',
    width: 760,
    height: 560,
    items: [
      { type: 'toolDock', preset: 'drill', name: 'Drill', at: [70, 548] },
      { type: 'batteryDock', preset: 'm18', name: 'Battery', at: [185, 548] },
      { type: 'batteryDock', preset: 'm18', name: 'Battery', at: [285, 548] },
      { type: 'chargerCradle', preset: 'dcb112', name: 'Charger', at: [440, 548] },
      { type: 'measureHanger', preset: 'tape5', name: 'Tape measure', at: [590, 548] },
      { type: 'clipTab', preset: 'knife', name: 'Utility knife', at: [700, 548] },
      { type: 'toolRack', opts: { mode: 'wrenches' }, name: 'Wrenches', at: [140, 428] },
      { type: 'toolRack', preset: 'sockets38', name: 'Sockets', at: [380, 428] },
      { type: 'clampRack', preset: 'smallF', name: 'Clamps', at: [630, 428] },
      { type: 'toolRack', preset: 'drivers', name: 'Screwdrivers', at: [130, 288] },
      { type: 'toolRack', opts: { mode: 'bits' }, name: 'Bits', at: [350, 288] },
      {
        type: 'bin',
        opts: { width: 160, height: 60, depth: 60, dividers: 3 },
        name: 'Screws',
        contents: 'Wood screws 4 × 40\nWall plugs 6 mm\nM6 bolts\nWashers',
        at: [600, 288],
      },
      { type: 'hook', opts: { style: 'u', reach: 80 }, name: 'Extension lead', at: [50, 168] },
      { type: 'eyewear', preset: 'safety', name: 'Safety glasses', at: [140, 168] },
      { type: 'saddle', preset: 'defenders', name: 'Ear defenders', at: [230, 168] },
      { type: 'cup', opts: { diameter: 40, height: 80 }, name: 'Pencils', contents: 'Carpenter’s pencils\nMarkers', at: [330, 168] },
      { type: 'gripper', preset: 'broom25', name: 'Broom', at: [440, 168] },
      { type: 'gripper', preset: 'broom25', name: 'Rake', at: [500, 168] },
    ],
  },
  {
    id: 'desk',
    name: 'Desk & gaming',
    description: 'Headphones and controllers, the phone and its charger, game cards, pens, notes, cables, a desk light.',
    width: 760,
    height: 400,
    items: [
      { type: 'saddle', preset: 'headphones', name: 'Headphones', at: [55, 388] },
      { type: 'saddle', preset: 'dualsense', name: 'Controller', at: [155, 388] },
      { type: 'saddle', preset: 'dualsense', name: 'Controller', at: [255, 388] },
      { type: 'cradle', preset: 'magsafe', name: 'Phone charger', at: [360, 388] },
      { type: 'mediaBlock', preset: 'switch', name: 'Game cards', at: [460, 388] },
      { type: 'mediaBlock', preset: 'usbA', name: 'USB sticks', at: [550, 388] },
      { type: 'saddle', preset: 'headphones', name: 'Headset', at: [680, 388] },
      { type: 'cradle', preset: 'phoneL', name: 'Phone', at: [70, 268] },
      { type: 'eyewear', preset: 'sunglasses', name: 'Glasses', at: [165, 268] },
      { type: 'bin', opts: { width: 140, height: 60, depth: 50, dividers: 1 }, name: 'Cables', contents: 'USB-C cables\nChargers', at: [290, 268] },
      { type: 'stickRack', preset: 'pens', name: 'Pens', at: [440, 268] },
      { type: 'boxSleeve', preset: 'notes', name: 'Sticky notes', at: [570, 268] },
      { type: 'ledBar', name: 'Desk light', at: [200, 68] },
      { type: 'cableChannel', name: 'Cables', at: [560, 68] },
    ],
  },
  {
    id: 'craft',
    name: 'Craft & sewing',
    description: 'Thread on pegs, washi tape and ribbon, needles, markers, buttons, a lift-off sewing caddy, a glue gun.',
    width: 560,
    height: 560,
    items: [
      { type: 'spoolRack', preset: 'thread', name: 'Thread', at: [105, 548] },
      { type: 'spoolRack', preset: 'washi1', name: 'Washi tape', at: [260, 548] },
      { type: 'spoolRack', preset: 'ribbon', name: 'Ribbon', at: [440, 548] },
      { type: 'cup', opts: { diameter: 40, height: 70 }, name: 'Scissors', at: [45, 428] },
      { type: 'stickRack', preset: 'needles', name: 'Knitting needles', at: [130, 428] },
      { type: 'stickRack', preset: 'markers', name: 'Markers', at: [270, 428] },
      {
        type: 'bin',
        opts: { width: 140, height: 50, depth: 45, dividers: 3 },
        name: 'Notions',
        contents: 'Buttons\nPins\nSafety pins\nNeedles',
        at: [450, 428],
      },
      { type: 'caddy', preset: 'sewing', name: 'Sewing kit', at: [120, 328] },
      { type: 'holster', preset: 'glueGun', name: 'Glue gun', at: [280, 328] },
      { type: 'magnetBar', name: 'Craft knives', at: [440, 328] },
      { type: 'shelf', opts: { width: 200, depth: 100 }, name: 'Fabric', at: [280, 148] },
    ],
  },
];

export const boardTemplate = (id: string): BoardTemplate | null => BOARD_TEMPLATES.find((t) => t.id === id) ?? null;

/** A template's attachment as it goes on a board (no place yet): its kind's defaults, its preset and its options, cleaned. */
export function templateAttachment(item: TemplateItem, id = newId()): PlacedAttachment | null {
  const def = attachmentDef(item.type);
  if (!def) return null;
  let preset: Record<string, unknown> = {};
  if (item.preset) {
    const p = attachmentUi(item.type)
      ?.fields.flatMap((f) => (f.kind === 'preset' ? f.presets : []))
      .find((q) => q.value === item.preset);
    if (!p) return null;
    preset = p.set;
  }
  const opts = def.sanitize({ ...def.defaults, ...preset, ...item.opts }) as Record<string, unknown>;
  return {
    id,
    type: item.type,
    x: 0,
    y: 0,
    opts,
    ...(item.name ? { name: item.name } : {}),
    ...(item.contents ? { contents: item.contents } : {}),
    ...(item.labelFrom ? { labelFrom: item.labelFrom } : {}),
  };
}

/** What an attachment takes on the board from its anchor: its front view and, above it, its lock keys (planExtras). */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  /** Its top, lock keys included. */
  top: number;
}

function boxOf(layout: WallPlacement['layout'], lock: boolean, ctx: MountCtx): Box {
  const b = partBounds(layout, ctx);
  const keys = lock ? layout.mounts.filter((m) => m.kind === 'hook').map((m) => lockKey(siteAt(layout, m, ctx), ctx).top) : [];
  // From the anchor.
  const [ax, ay] = layout.anchor;
  return { x0: b.x0 - ax, y0: b.y0 - ay, x1: b.x1 - ax, top: Math.max(b.y1, ...keys) - ay };
}

/** Where a placed attachment is on the board (wall coordinates), its lock keys included. */
function placedBox(p: WallPlacement, ctx: MountCtx): Box {
  const b = boxOf(p.layout, !!p.lock, ctx);
  return { x0: p.x + b.x0, y0: p.y + b.y0, x1: p.x + b.x1, top: p.y + b.top };
}

export interface TemplateFit {
  /** The template's attachments, each on its slot. */
  list: PlacedAttachment[];
  /** The names of those with no room on the board. */
  left: string[];
}

/**
 * Put a template's attachments on `board`, around what's on it already (`taken`): each on the slot nearest where the
 * template wants it (scaled from the template's board to this one) where all its mounts find slots, inside the board
 * (and its frame's rim) and `GAP` clear of the others.
 */
export function fitTemplate(
  t: Pick<BoardTemplate, 'items' | 'width' | 'height'>,
  board: WallBoard,
  taken: readonly WallPlacement[] = [],
  id: () => string = newId,
): TemplateFit {
  const ctx = board.ctx;
  const keys = slotKeys(board.slots);
  const rim = board.rim ?? 0;
  const boxes: Box[] = taken.map((p) => placedBox(p, ctx));
  const list: PlacedAttachment[] = [];
  const left: string[] = [];
  const sx = board.W / t.width;
  const sy = board.H / t.height;
  for (const item of t.items) {
    const a = templateAttachment(item, id());
    const def = a && attachmentDef(a.type);
    const l = a && attachmentLayout(a, ctx);
    if (!a || !def || !l) {
      left.push(item.name ?? item.type);
      continue;
    }
    const e = planExtras(a, def, l.opts, l.layout, ctx);
    const b = boxOf(e.layout, e.lock, ctx);
    // The anchor that puts the middle of its top where it's wanted.
    const ax = item.at[0] * sx - (b.x0 + b.x1) / 2;
    const ay = item.at[1] * sy - b.top;
    const free = (x: number, y: number) =>
      x + b.x0 >= rim + GAP / 2 - 1e-6 &&
      x + b.x1 <= board.W - rim - GAP / 2 + 1e-6 &&
      y + b.y0 >= rim + GAP / 2 - 1e-6 &&
      y + b.top <= board.H - rim - GAP / 2 + 1e-6 &&
      boxes.every((q) => x + b.x1 + GAP <= q.x0 || q.x1 + GAP <= x + b.x0 || y + b.top + GAP <= q.y0 || q.top + GAP <= y + b.y0);
    // Nearest first, a step across before a step up or down (so a row keeps its top).
    const far = ([x, y]: Vec2) => Math.hypot(x - ax, 3 * (y - ay));
    const spot = [...board.slots].sort((p, q) => far(p) - far(q)).find(([x, y]) => fitsAt(keys, e.layout, ctx, x, y) && free(x, y));
    if (!spot) {
      left.push(a.name ?? def.summary(l.opts as never));
      continue;
    }
    const [x, y] = spot;
    boxes.push({ x0: x + b.x0, y0: y + b.y0, x1: x + b.x1, top: y + b.top });
    list.push({ ...a, x, y });
  }
  return { list, left };
}

/** A board with the template's size: the drawer settings for it (the rest of `base`, a board's settings, kept). */
export function templateSkadis(t: Pick<BoardTemplate, 'width' | 'height'>, base: SkadisOptions = DEFAULT_SKADIS): SkadisOptions {
  return { ...base, width: t.width, height: t.height };
}

/** The board a drawer's Skådis settings make with this printer setup (its slots, split into tiles as it prints), or null. */
export function boardOf(skadis: SkadisOptions, setup: PrintSetup): WallBoard | null {
  const job = planPrint(
    [{ id: 'template', name: '', drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis }, baseplate: DEFAULT_BASEPLATE, bins: [] }],
    setup,
    { baseplate: true, bins: false },
  );
  return job.drawers[0]?.enclosure?.wall?.board ?? null;
}
