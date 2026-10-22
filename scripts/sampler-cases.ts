/**
 * The parts scripts/sampler.ts prints and checks: every container type, the
 * plain bin's option families, baseplates, carry cases, wall grids, spacer
 * strips, TPU pads and the test-fit kit; boards (Skådis, openGrid,
 * Multiboard) and every wall attachment kind (sampler-boards.ts). Each group is
 * planned like a real job (planPrint / planTestFit), so the parts go through
 * the app's own code.
 *
 * No side effects beyond registering the attachment kinds and the grid boards'
 * planning, as the app does with its first board: tests/printcheck.test.ts
 * builds a subset of these too.
 */
import { DEFAULT_BIN, binInnerSize, type BinOptions } from '../src/lib/geometry/bin';
import { DEFAULT_BASEPLATE, type BaseplateOptions } from '../src/lib/geometry/baseplate';
import { DEFAULT_DRAWER, type DrawerInput } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP, type PrintSetup } from '../src/lib/layout/plan';
import { planPrint, type JobPart, type NamedDrawer, type PlacedBin, type PrintJob } from '../src/lib/project';
import { planTestFit } from '../src/lib/testfit';
import { findPocketPreset, presetFields } from '../src/lib/geometry/pocketPresets';
import { findRackPreset, rackPresetFields } from '../src/lib/geometry/containers/rack';
import { cutoutFromTool, type Tool } from '../src/lib/tools';
import { addFreeWall, resolveLayout, setCompartmentOptions, setWallEnd, setWallProps, uniformLayout, type CompartmentOptions, type DividerLayout } from '../src/lib/dividers';
import { ATTACHMENT_GROUPS, BOARD_FINDINGS, BOARD_GROUPS } from './sampler-boards';

export const SAMPLE_SETUP: PrintSetup = DEFAULT_SETUP;

export interface SampleGroup {
  /** Folder name. */
  name: string;
  /** What the group covers. */
  note: string;
  job(): PrintJob;
  /** Multi-colour groups (colours.ts): the setup they're planned with; every plate is written as a 3MF in its colours. */
  setup?: PrintSetup;
}

/** One bin in a drawer of its own: a grid just its size, unless `drawer` says otherwise. */
export interface BinSample {
  id: string;
  opts: Partial<BinOptions>;
  drawer?: Partial<DrawerInput>;
  /** Where the bin sits (front-left cell) and anything else a PlacedBin carries. */
  place?: Partial<PlacedBin>;
  baseplate?: Partial<BaseplateOptions>;
}

const bin = (o: Partial<BinOptions>): BinOptions => ({ ...DEFAULT_BIN, ...o }) as BinOptions;

function binDrawer(s: BinSample): NamedDrawer {
  const o = bin(s.opts);
  const half = !!s.drawer?.halfGrid;
  return {
    id: s.id,
    name: s.id,
    drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: half ? o.unitsX / 2 : o.unitsX, gridY: half ? o.unitsY / 2 : o.unitsY, ...s.drawer },
    baseplate: { ...DEFAULT_BASEPLATE, ...s.baseplate },
    bins: [{ id: 'b', x: 0, y: 0, ...s.place, opts: o }],
  };
}

function binGroup(name: string, note: string, samples: BinSample[]): SampleGroup {
  return { name, note, job: () => planPrint(samples.map(binDrawer), SAMPLE_SETUP, { baseplate: false, bins: true }) };
}

function plateGroup(name: string, note: string, drawers: NamedDrawer[]): SampleGroup {
  return { name, note, job: () => planPrint(drawers, SAMPLE_SETUP, { baseplate: true, bins: false }) };
}

/** Compartment keys front-left first, row by row. */
function compKeys(o: Partial<BinOptions>, l: DividerLayout): string[] {
  const s = binInnerSize({ unitsX: o.unitsX ?? 1, unitsY: o.unitsY ?? 1 });
  return resolveLayout(l, s.w, s.d)
    .compartments.slice()
    .sort((a, b) => a.bounds.y0 - b.bounds.y0 || a.bounds.x0 - b.bounds.x0)
    .map((c) => c.key);
}

/** A layout with options on some compartments (by compKeys index). */
function withComps(o: Partial<BinOptions>, l: DividerLayout, opts: [number, CompartmentOptions][]): DividerLayout {
  const keys = compKeys(o, l);
  for (const [i, co] of opts) l = setCompartmentOptions(l, keys[i], co);
  return l;
}

/** A spanner-ish outline: a head and a handle, 120 × 22 mm. */
const SPANNER: Tool = {
  id: 'spanner',
  name: 'Spanner',
  depth: 8,
  clearance: 0.6,
  outline: [
    [-60, -6],
    [30, -5],
    [36, -11],
    [52, -11],
    [60, -4],
    [60, 4],
    [52, 11],
    [36, 11],
    [30, 5],
    [-60, 6],
  ],
};
/** A round tool (a tape measure), 40 mm across. */
const ROUND: Tool = {
  id: 'round',
  name: 'Tape',
  depth: 14,
  clearance: 0.5,
  outline: Array.from({ length: 40 }, (_, i) => [20 * Math.cos((i / 40) * 2 * Math.PI), 20 * Math.sin((i / 40) * 2 * Math.PI)] as [number, number]),
};

const pockets = (id: string, more: Partial<BinOptions> = {}): Partial<BinOptions> => ({ interior: 'pockets', ...presetFields(findPocketPreset(id)!), ...more });

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

const containers = binGroup('containers', 'Drawer unit, parts box, hopper, tool rack and dispenser, with their main options', [
  { id: 'drawers-default', opts: { unitsX: 2, unitsY: 2, heightUnits: 6, container: 'drawers' } },
  {
    id: 'drawers-tabs-labels-grid',
    opts: { unitsX: 3, unitsY: 2, heightUnits: 8, container: 'drawers', containers: { drawers: { rows: 2, cols: 2, pull: 'tab', labels: true, labelTexts: ['M3', 'M4', 'M5', 'M6'], top: 'grid', divX: 2 } } },
  },
  {
    id: 'drawers-knob-engraved-flat',
    opts: { unitsX: 2, unitsY: 2, heightUnits: 6, container: 'drawers', containers: { drawers: { rows: 2, pull: 'knob', labels: true, labelStyle: 'engraved', labelTexts: ['Nuts', 'Bolts'], top: 'flat', stops: false } } },
  },
  { id: 'drawers-grip-1x1', opts: { unitsX: 1, unitsY: 2, heightUnits: 4, container: 'drawers', containers: { drawers: { rows: 1, pull: 'grip' } } } },
  { id: 'drawers-rowsizes', opts: { unitsX: 2, unitsY: 2, heightUnits: 12, container: 'drawers', containers: { drawers: { rows: 4, rowSizes: [1, 2, 1, 1], divY: 2 } } } },
  { id: 'box-default', opts: { unitsX: 2, unitsY: 2, heightUnits: 4, container: 'box' } },
  { id: 'box-pin-magnets-grid', opts: { unitsX: 2, unitsY: 2, heightUnits: 5, container: 'box', containers: { box: { hinge: 'pin', latch: 'magnets', top: 'grid', divX: 3, divY: 1 } } } },
  { id: 'box-lip-label', opts: { unitsX: 3, unitsY: 2, heightUnits: 4, container: 'box', containers: { box: { top: 'lip', latch: 'none', labelText: 'Resistors', scoops: false } } } },
  { id: 'box-raised-label', opts: { unitsX: 2, unitsY: 1, heightUnits: 3, container: 'box', containers: { box: { labelText: 'SMD', labelStyle: 'raised', divX: 4, divY: 1 } } } },
  { id: 'hopper-default', opts: { unitsX: 1, unitsY: 2, heightUnits: 6, container: 'hopper' } },
  { id: 'hopper-dividers-lip-text', opts: { unitsX: 3, unitsY: 2, heightUnits: 6, container: 'hopper', containers: { hopper: { dividers: 2, lip: true, label: 'text', labelText: 'Washers' } } } },
  { id: 'hopper-steep-slot', opts: { unitsX: 2, unitsY: 2, heightUnits: 5, container: 'hopper', containers: { hopper: { angle: 90, slope: 0, label: 'slot', labelText: 'M8' } } } },
  { id: 'rack-screwdrivers', opts: { unitsX: 3, unitsY: 2, heightUnits: 4, container: 'rack', containers: { rack: rackPresetFields(findRackPreset('screwdrivers')!) } } },
  { id: 'rack-hexkeys-labels', opts: { unitsX: 2, unitsY: 1, heightUnits: 4, container: 'rack', containers: { rack: { ...rackPresetFields(findRackPreset('hexkeys')!), labels: 'mm', hole: 'hex' } } } },
  { id: 'rack-pliers-tilt', opts: { unitsX: 3, unitsY: 2, heightUnits: 5, container: 'rack', containers: { rack: { ...rackPresetFields(findRackPreset('pliers')!), tilt: 20 } } } },
  { id: 'rack-wrenches', opts: { unitsX: 4, unitsY: 2, heightUnits: 4, container: 'rack', containers: { rack: rackPresetFields(findRackPreset('wrenches-8-19')!) } } },
  {
    id: 'rack-files-stagger-step',
    opts: { unitsX: 3, unitsY: 2, heightUnits: 5, container: 'rack', containers: { rack: { ...rackPresetFields(findRackPreset('needle-files')!), rows: 2, stagger: true, step: 8 } } },
  },
  { id: 'dispenser-aa', opts: { unitsX: 2, unitsY: 2, heightUnits: 8, container: 'dispenser' } },
  { id: 'dispenser-coin-window', opts: { unitsX: 1, unitsY: 1, heightUnits: 6, container: 'dispenser', containers: { dispenser: { item: 'cr2032', shape: 'coin', itemD: 20, itemL: 3.2, window: true } } } },
  { id: 'dispenser-d-tray', opts: { unitsX: 2, unitsY: 2, heightUnits: 10, container: 'dispenser', containers: { dispenser: { item: 'd', itemD: 34.2, itemL: 61.5, tray: true, ramp: 10 } } } },
  { id: 'dispenser-tape-cutter', opts: { unitsX: 2, unitsY: 2, heightUnits: 6, container: 'dispenser', containers: { dispenser: { style: 'tape', cutter: true } } } },
  { id: 'dispenser-channels-notch', opts: { unitsX: 3, unitsY: 2, heightUnits: 3, container: 'dispenser', containers: { dispenser: { style: 'channel', notch: true, channels: 4 } } } },
]);

// ---------------------------------------------------------------------------
// Plain bins
// ---------------------------------------------------------------------------

const bases = binGroup('bases', 'Bases (standard, lite, efficient floor, flat) and hole options', [
  { id: 'standard-1x1', opts: {} },
  { id: 'standard-2x2-divs-scoop', opts: { unitsX: 2, unitsY: 2, divX: 2, divY: 2, scoop: 1 } },
  { id: 'lite-2x1', opts: { unitsX: 2, base: 'lite', divX: 2 } },
  { id: 'lite-magnets-printable', opts: { unitsX: 2, unitsY: 2, base: 'lite', holes: 'magnets', holePrintable: true } },
  { id: 'efficient-2x2', opts: { unitsX: 2, unitsY: 2, base: 'efficient' } },
  { id: 'efficient-magnets', opts: { unitsX: 2, base: 'efficient', holes: 'magnets', holeChamfer: true } },
  { id: 'flat-2x1', opts: { unitsX: 2, base: 'flat', heightUnits: 4 } },
  { id: 'magnets', opts: { holes: 'magnets' } },
  { id: 'screws', opts: { holes: 'screws' } },
  { id: 'magnets-screws', opts: { unitsX: 2, holes: 'both' } },
  { id: 'magnets-screws-printable', opts: { unitsX: 2, holes: 'both', holePrintable: true } },
  { id: 'refined', opts: { unitsX: 2, holes: 'refined' } },
  { id: 'crush-ribs-chamfer', opts: { holes: 'magnets', holeCrushRibs: true, holeChamfer: true } },
  { id: 'corners-only-3x2', opts: { unitsX: 3, unitsY: 2, holes: 'magnets', holeCorners: true } },
  { id: 'height-internal', opts: { heightMode: 'internal', heightMm: 30 } },
  { id: 'height-external', opts: { unitsX: 2, heightMode: 'external', heightMm: 40 } },
  { id: 'tall-1x1', opts: { heightUnits: 15 } },
]);

const lips = binGroup('lips', 'Stacking lips (normal, reduced, none, notches), stacking lids and pocket-grid lids', [
  { id: 'lip-normal', opts: { unitsX: 2, unitsY: 2 } },
  { id: 'lip-reduced', opts: { unitsX: 2, unitsY: 2, lipStyle: 'reduced' } },
  { id: 'lip-none', opts: { unitsX: 2, unitsY: 2, lip: false } },
  { id: 'lip-notches', opts: { unitsX: 2, unitsY: 2, lipNotches: true } },
  { id: 'lid-stack', opts: { unitsX: 2, unitsY: 1, lid: true } },
  { id: 'lid-stack-magnets', opts: { unitsX: 2, unitsY: 2, lid: true, holes: 'magnets' } },
  { id: 'lid-pockets', opts: { unitsX: 2, unitsY: 2, lid: true, lidStyle: 'pockets', ...presetFields(findPocketPreset('aa')!) } },
  { id: 'lid-pockets-hexbits', opts: { unitsX: 1, unitsY: 1, lid: true, lidStyle: 'pockets', lidPockets: presetFields(findPocketPreset('hexbit')!) } },
]);

const accessories = binGroup('accessories', 'Sliding lid, lift-out trays, divider rails, lift-out cups, drop-in egg-crate grids', [
  { id: 'slide-lid', opts: { unitsX: 2, unitsY: 2, lip: false, slideLid: true } },
  { id: 'slide-lid-text', opts: { unitsX: 2, unitsY: 1, lip: false, slideLid: true, slideLidText: 'Drill bits' } },
  { id: 'tray-1', opts: { unitsX: 2, unitsY: 2, heightUnits: 6, tray: true } },
  { id: 'tray-3', opts: { unitsX: 3, unitsY: 2, heightUnits: 10, tray: true, trayCount: 3, trayDivX: 3, trayDivY: 2 } },
  { id: 'tray-slide-lid', opts: { unitsX: 2, unitsY: 2, heightUnits: 6, lip: false, tray: true, slideLid: true } },
  { id: 'rails-x', opts: { unitsX: 2, unitsY: 2, heightUnits: 5, rails: 'x' } },
  { id: 'rails-xy', opts: { unitsX: 3, unitsY: 2, heightUnits: 5, rails: 'xy', railPlates: 3 } },
  { id: 'cups-tab', opts: { unitsX: 2, unitsY: 2, heightUnits: 5, divX: 2, divY: 2, cups: true } },
  { id: 'cups-notch-scoop', opts: { unitsX: 2, unitsY: 1, heightUnits: 4, divX: 2, cups: true, cupGrip: 'notch', cupScoop: true } },
  { id: 'cups-none', opts: { unitsX: 1, unitsY: 1, heightUnits: 4, cups: true, cupGrip: 'none' } },
  { id: 'crate', opts: { unitsX: 2, unitsY: 2, heightUnits: 4, crate: true, crateDivX: 3, crateDivY: 3 } },
  { id: 'crate-low', opts: { unitsX: 2, unitsY: 1, heightUnits: 6, divX: 2, crate: true, crateHeight: 15 } },
]);

const walls = binGroup('walls', 'Wall cutouts, finger slides, hex wall pattern, rounded inside corners', [
  { id: 'cutout-front', opts: { unitsX: 2, unitsY: 1, heightUnits: 4, cutoutWalls: 'f' } },
  { id: 'cutout-all', opts: { unitsX: 2, unitsY: 2, heightUnits: 6, cutoutWalls: 'fblr', cutoutWidth: 0.7, cutoutDepth: 20 } },
  { id: 'cutout-label', opts: { unitsX: 2, unitsY: 1, heightUnits: 4, cutoutWalls: 'b', label: 'full', labelText: 'Cut' } },
  { id: 'slides-front', opts: { unitsX: 2, unitsY: 1, heightUnits: 4, slideWalls: 'f' } },
  { id: 'slides-all-divs', opts: { unitsX: 2, unitsY: 2, heightUnits: 4, slideWalls: 'fblr', divX: 2 } },
  { id: 'pattern-all', opts: { unitsX: 2, unitsY: 2, heightUnits: 8, patternWalls: 'fblr' } },
  { id: 'pattern-small-web', opts: { unitsX: 2, unitsY: 1, heightUnits: 6, patternWalls: 'fb', patternSize: 5, patternWeb: 1.2 } },
  { id: 'pattern-reduced-nolip', opts: { unitsX: 1, unitsY: 1, heightUnits: 8, patternWalls: 'lr', lip: false } },
  { id: 'no-fillet', opts: { unitsX: 2, unitsY: 1, divX: 3, fillet: false } },
]);

const TWO = { unitsX: 2, unitsY: 1, heightUnits: 5, label: 'none', scoop: 0 } as const;
const FOUR = { unitsX: 2, unitsY: 2, heightUnits: 5 } as const;
const lShape = () => {
  let l = uniformLayout(2, 2);
  const s = binInnerSize(FOUR);
  l = setWallEnd(l, s, 'x1', 'end', 'y1')!;
  l = setWallEnd(l, s, 'y1', 'end', 'x1')!;
  return l;
};
const removable = () => setWallProps(uniformLayout(3, 1), 'x1', { removable: true });
const freeWalls = () => {
  const s = binInnerSize(FOUR);
  let l: DividerLayout = { walls: [] };
  l = addFreeWall(l, s, [0, 0], [s.w, s.d])!.layout;
  l = addFreeWall(l, s, [0, s.d * 0.8], [s.w * 0.6, s.d], 8)!.layout;
  return l;
};

const compartments = binGroup('compartments', 'Compartment floors (flat, ramp, steps), insides (pockets, tools, solid), wall tops, notches, removable and lowered walls, diagonal walls', [
  { id: 'floor-ramp', opts: { ...TWO, layout: withComps(TWO, uniformLayout(2, 1), [[0, { floorShape: 'ramp', floorRise: 12 }]]) } },
  { id: 'floor-steps', opts: { ...TWO, layout: withComps(TWO, uniformLayout(2, 1), [[1, { floorShape: 'tiers', tiers: 4, floorRise: 15, floorHigh: 'left' }]]) } },
  { id: 'floor-raised-scoop-tab', opts: { ...TWO, layout: withComps(TWO, uniformLayout(2, 1), [[0, { floor: 8, scoop: 1, label: 'full', labelText: 'Up' }]]) } },
  { id: 'inside-pockets', opts: { ...TWO, layout: withComps(TWO, uniformLayout(2, 1), [[1, { inside: 'pockets', pockets: presetFields(findPocketPreset('m4')!) }]]) } },
  {
    id: 'inside-tools',
    opts: { ...FOUR, interior: 'compartments', cutouts: [cutoutFromTool(ROUND, 21, 0)], layout: withComps(FOUR, uniformLayout(2, 1), [[1, { inside: 'tools' }]]) },
  },
  { id: 'inside-solid', opts: { ...TWO, layout: withComps(TWO, uniformLayout(2, 1), [[0, { inside: 'solid' }]]) } },
  { id: 'wall-chamfer', opts: { ...TWO, layout: setWallProps(uniformLayout(2, 1), 'x1', { top: 'chamfer' }) } },
  { id: 'wall-round-notch', opts: { ...FOUR, layout: setWallProps(setWallProps(uniformLayout(2, 2), 'x1', { top: 'round', notch: { width: 20, depth: 12 } }), 'y1', { notch: { width: 14, depth: 8 } }) } },
  { id: 'wall-lowered', opts: { ...TWO, layout: setWallProps(uniformLayout(2, 1), 'x1', { lower: 10 }) } },
  { id: 'removable', opts: { unitsX: 3, unitsY: 1, heightUnits: 5, layout: removable() } },
  { id: 'removable-notch', opts: { unitsX: 2, unitsY: 2, heightUnits: 6, layout: setWallProps(uniformLayout(1, 2), 'y1', { removable: true, notch: { width: 20, depth: 10 } }) } },
  // Label tabs with a removable wall behind them: they hang between the side walls.
  { id: 'removable-tab-center', opts: { unitsX: 2, unitsY: 2, heightUnits: 5, label: 'center', labelText: 'Mid', layout: setWallProps(uniformLayout(1, 2), 'y1', { removable: true }) } },
  { id: 'removable-grid-tabs', opts: { unitsX: 2, unitsY: 2, heightUnits: 5, label: 'left', layout: setWallProps(setWallProps(uniformLayout(2, 2), 'y1', { removable: true }), 'x1', { removable: true }) } },
  { id: 'l-shape', opts: { ...FOUR, layout: lShape(), scoop: 0.6, label: 'full' } },
  { id: 'free-walls', opts: { ...FOUR, layout: freeWalls() } },
  { id: 'sorter-3x3', opts: { unitsX: 3, unitsY: 3, heightUnits: 3, layout: uniformLayout(3, 3), scoop: 0.8, label: 'full', labelText: 'M3' } },
  { id: 'lite-compartments', opts: { unitsX: 2, unitsY: 2, base: 'lite', layout: uniformLayout(3, 2), label: 'left', labelText: 'Lite' } },
]);

const pocketGrids = binGroup('pockets', 'Pocket grids: round, cone and stepped bottoms, lean, grooves, thumb notches, magnets, graduated sets with engraving', [
  { id: 'aa', opts: { unitsX: 2, unitsY: 2, heightUnits: 4, ...pockets('aa') } },
  { id: 'aa-reduced-lip', opts: { unitsX: 2, unitsY: 1, heightUnits: 6, lipStyle: 'reduced', ...pockets('aa') } },
  { id: '9v-square', opts: { unitsX: 2, unitsY: 2, heightUnits: 5, ...pockets('9v') } },
  { id: 'microsd-slots', opts: { unitsX: 1, unitsY: 1, heightUnits: 3, ...pockets('microsd') } },
  { id: 'sd-slots', opts: { unitsX: 2, unitsY: 1, heightUnits: 4, ...pockets('sd') } },
  { id: 'nanosim', opts: { unitsX: 1, unitsY: 1, heightUnits: 3, ...pockets('nanosim') } },
  { id: 'hexbits-groove', opts: { unitsX: 2, unitsY: 1, heightUnits: 3, ...pockets('hexbit', { pocketGrip: 'groove' }) } },
  { id: 'm2-screws', opts: { unitsX: 1, unitsY: 1, heightUnits: 3, ...pockets('m2') } },
  { id: 'nozzle-stepped', opts: { unitsX: 1, unitsY: 1, heightUnits: 3, ...pockets('nozzle') } },
  { id: 'testtube-round', opts: { unitsX: 2, unitsY: 1, heightUnits: 6, ...pockets('testtube') } },
  { id: 'round-floor-square', opts: { unitsX: 2, unitsY: 1, heightUnits: 4, ...pockets('9v', { pocketFloor: 'round' }) } },
  { id: 'cone-drills-mm', opts: { unitsX: 3, unitsY: 2, heightUnits: 4, ...pockets('drills-10') } },
  { id: 'drills-inch', opts: { unitsX: 4, unitsY: 2, heightUnits: 4, ...pockets('drills-inch') } },
  { id: 'sockets', opts: { unitsX: 4, unitsY: 2, heightUnits: 4, ...pockets('sockets-14') } },
  { id: 'hexkeys-inch', opts: { unitsX: 3, unitsY: 1, heightUnits: 4, ...pockets('hexkeys-inch') } },
  { id: 'lean-30', opts: { unitsX: 2, unitsY: 2, heightUnits: 6, ...pockets('marker', { pocketTilt: 30 }) } },
  { id: 'lean-45-notch', opts: { unitsX: 2, unitsY: 2, heightUnits: 6, ...pockets('aa', { pocketTilt: 45, pocketGrip: 'notch' }) } },
  { id: 'notch', opts: { unitsX: 2, unitsY: 1, heightUnits: 4, ...pockets('cr123a', { pocketGrip: 'notch' }) } },
  { id: 'magnets', opts: { unitsX: 2, unitsY: 1, heightUnits: 4, ...pockets('citadel', { pocketMagnet: true }) } },
  { id: 'hex-lite', opts: { unitsX: 1, unitsY: 1, heightUnits: 3, base: 'lite', ...pockets('powerbit') } },
]);

const toolBins = binGroup('tools', 'Tool cutouts (chamfer, round, notches, names) and two-colour shadow boards', [
  { id: 'spanner-chamfer', opts: { unitsX: 3, unitsY: 1, heightUnits: 4, interior: 'cutouts', cutouts: [cutoutFromTool(SPANNER)] } },
  { id: 'spanner-round-label', opts: { unitsX: 3, unitsY: 1, heightUnits: 4, interior: 'cutouts', cutouts: [{ ...cutoutFromTool(SPANNER, 0, 4), label: true }], cutoutStyle: { edge: 'round', edgeSize: 1.5 } } },
  { id: 'two-tools-notch', opts: { unitsX: 3, unitsY: 2, heightUnits: 5, interior: 'cutouts', cutouts: [cutoutFromTool(SPANNER, 0, -18), cutoutFromTool(ROUND, 30, 16)], cutoutStyle: { edge: 'none' } } },
  { id: 'shadow', opts: { unitsX: 3, unitsY: 1, heightUnits: 4, interior: 'cutouts', cutouts: [cutoutFromTool(SPANNER)], shadowFloor: true } },
  { id: 'shadow-label', opts: { unitsX: 3, unitsY: 2, heightUnits: 4, interior: 'cutouts', cutouts: [{ ...cutoutFromTool(SPANNER, 0, -10), label: true }, cutoutFromTool(ROUND, -40, 18)], shadowFloor: true } },
]);

const lbl = (o: Partial<BinOptions>): Partial<BinOptions> => ({ unitsX: 2, unitsY: 1, heightUnits: 3, label: 'full', ...o });
const labels = binGroup('labels', 'Label styles: raised, engraved, inlaid, swappable plates, Cullenect, Pred, icons, front-wall labels, small tabs', [
  { id: 'raised', opts: lbl({ labelText: 'M3 × 12' }) },
  { id: 'raised-3-lines', opts: lbl({ labelText: 'Resistors\n1k – 10k\n¼ W' }) },
  { id: 'engraved', opts: lbl({ labelText: 'Washers', labelStyle: 'engraved' }) },
  { id: 'inlaid', opts: lbl({ labelText: 'Inlaid', labelStyle: 'inlaid' }) },
  { id: 'small-tab-left', opts: { label: 'left', labelText: 'Long label text here' } },
  { id: 'small-tab-right-1x1', opts: { label: 'right', labelText: 'M2', labelStyle: 'engraved' } },
  { id: 'center-tab', opts: { unitsX: 3, label: 'center', labelText: 'Centre' } },
  { id: 'per-compartment', opts: { unitsX: 3, unitsY: 1, layout: withComps({ unitsX: 3 }, uniformLayout(3, 1), [[0, { labelText: 'M3' }], [1, { labelText: 'M4' }], [2, { labelText: 'M5' }]]), label: 'full' } },
  { id: 'icons', opts: lbl({ labelText: '{bolt:12} M4 × 12' }) },
  { id: 'icons-many', opts: lbl({ unitsX: 3, labelText: '{nut} {washer} {screw:socket} {|} M5' }) },
  { id: 'icons-engraved', opts: lbl({ labelText: '{battery} AA', labelStyle: 'engraved' }) },
  { id: 'contents', opts: lbl({ labelText: '{contents}' }), place: { contents: 'Hex nuts M3\nWashers' } },
  { id: 'plate-raised', opts: lbl({ labelText: 'Plate', labelPlates: true }) },
  { id: 'plate-engraved', opts: lbl({ labelText: 'Engraved plate', labelPlates: true, labelStyle: 'engraved' }) },
  { id: 'plate-inlaid', opts: lbl({ labelText: 'Inlaid', labelPlates: true, labelStyle: 'inlaid' }) },
  { id: 'plate-blank', opts: lbl({ labelPlates: true }) },
  { id: 'plate-1x1-left', opts: { label: 'left', labelText: 'M2', labelPlates: true } },
  { id: 'cullenect', opts: lbl({ labelText: 'Cullenect', labelPlates: true, labelFormat: 'cullenect' }) },
  { id: 'pred', opts: lbl({ labelText: 'Pred', labelPlates: true, labelFormat: 'pred' }) },
  { id: 'pred-1x1', opts: { label: 'full', labelText: 'P', labelPlates: true, labelFormat: 'pred' } },
  { id: 'front-raised', opts: lbl({ label: 'none', labelText: 'Front', frontLabel: 'raised' }) },
  { id: 'front-two-tone', opts: lbl({ label: 'none', labelText: 'Two tone', frontLabel: 'two-tone' }) },
  { id: 'front-engraved', opts: lbl({ label: 'none', labelText: 'Engraved', frontLabel: 'engraved' }) },
  { id: 'front-inlaid-lite', opts: lbl({ label: 'none', base: 'lite', labelText: 'Inlaid', frontLabel: 'inlaid' }) },
  { id: 'front-and-tab-pattern', opts: lbl({ heightUnits: 6, labelText: 'Both', frontLabel: 'raised', patternWalls: 'fb' }) },
  { id: 'front-per-compartment', opts: { unitsX: 3, heightUnits: 4, frontLabel: 'engraved', layout: withComps({ unitsX: 3 }, uniformLayout(3, 1), [[0, { labelText: 'A' }], [1, { labelText: 'B' }], [2, { labelText: 'C' }]]) } },
]);

const QR_URL = 'https://example.com/inventory/bin/42';
const qrFront = (o: Partial<BinOptions>): Partial<BinOptions> => ({ unitsX: 2, unitsY: 1, heightUnits: 6, qr: 'front', qrContent: 'custom', qrText: QR_URL, ...o });
const QR_LIST: Partial<PlacedBin> = { contents: 'M3 × 8 socket screws\nM3 × 12 socket screws\nM3 nuts\nM3 washers' };
const qr = binGroup('qr', 'QR codes: front wall (inlaid, raised, engraved beside a front label), stacking and sliding lids, stick-on plates; from What’s in it or custom text', [
  { id: 'front-inlaid', opts: qrFront({}) },
  { id: 'front-raised', opts: qrFront({ qrStyle: 'raised' }) },
  { id: 'front-engraved-label', opts: qrFront({ unitsX: 3, qrStyle: 'engraved', label: 'none', labelText: 'Bits', frontLabel: 'engraved' }) },
  { id: 'lid-inlaid-contents', opts: { unitsX: 1, unitsY: 1, heightUnits: 3, lid: true, labelText: 'M3', qr: 'lid', qrContent: 'contents' }, place: QR_LIST },
  { id: 'lid-engraved', opts: { unitsX: 2, unitsY: 1, heightUnits: 3, lid: true, qr: 'lid', qrStyle: 'engraved', qrContent: 'custom', qrText: QR_URL } },
  { id: 'slide-lid-inlaid', opts: { unitsX: 2, unitsY: 2, heightUnits: 5, lip: false, slideLid: true, slideLidText: 'Bits', qr: 'lid', qrContent: 'custom', qrText: QR_URL } },
  { id: 'plate-inlaid-contents', opts: { unitsX: 1, unitsY: 1, heightUnits: 3, labelText: 'M3', qr: 'plate', qrContent: 'contents' }, place: QR_LIST },
  { id: 'plate-raised', opts: { qr: 'plate', qrStyle: 'raised', qrContent: 'custom', qrText: QR_URL } },
  { id: 'plate-engraved-h', opts: { qr: 'plate', qrStyle: 'engraved', qrEcc: 'H', qrContent: 'custom', qrText: QR_URL } },
]);

const HALF: Partial<DrawerInput> = { halfGrid: true };
const placement = binGroup('placement', 'Half-grid bins, bins on partial edge cells, stretched bins', [
  { id: 'half-1x1', opts: { unitsX: 1, unitsY: 1, heightUnits: 3, holes: 'magnets' }, drawer: HALF },
  { id: 'half-3x2', opts: { unitsX: 3, unitsY: 2, heightUnits: 4, holes: 'magnets', divX: 2 }, drawer: HALF },
  { id: 'half-lite-lid', opts: { unitsX: 2, unitsY: 2, base: 'lite', lid: true }, drawer: HALF },
  { id: 'half-pockets', opts: { unitsX: 3, unitsY: 3, heightUnits: 4, ...pockets('m3') }, drawer: HALF },
  {
    id: 'partial-cells',
    opts: { unitsX: 2, unitsY: 1, heightUnits: 3, holes: 'magnets' },
    drawer: { mode: 'drawer', width: 42 * 2 + 25.5, depth: 42 + 30.5, fill: 'fit', alignX: 0, alignY: 0 },
    place: { x: 1, y: 0 },
  },
  {
    id: 'stretched',
    opts: { unitsX: 2, unitsY: 1, heightUnits: 4, label: 'full', labelText: 'Stretch' },
    drawer: { mode: 'drawer', width: 42 * 2 + 18.5, depth: 42 + 12.5, fill: 'solid', alignX: 0, alignY: 0 },
    place: { stretch: { right: 20, back: 20 } },
  },
  {
    id: 'stretched-lite-pattern',
    opts: { unitsX: 1, unitsY: 1, heightUnits: 6, base: 'lite', patternWalls: 'fr', holes: 'magnets' },
    drawer: { mode: 'drawer', width: 42 + 12.5, depth: 42 + 12.5, fill: 'solid', alignX: 0, alignY: 0 },
    place: { stretch: { right: 20, back: 20 } },
  },
]);

const vase = (o: Partial<BinOptions>, v: Record<string, unknown> = {}): Partial<BinOptions> => ({ ...o, container: 'vase', containers: { vase: v } });
const vaseBins = binGroup('vase', 'Vase-mode bins, sliced in spiral vase mode: 1×1, 2×1, 3×2 with dividers, dividers across the depth, magnets, refined slots, a wide line, flat, half grid', [
  { id: '1x1', opts: vase({}) },
  { id: '2x1', opts: vase({ unitsX: 2 }) },
  { id: '3x2-dividers', opts: vase({ unitsX: 3, unitsY: 2, heightUnits: 4 }, { dividers: 2 }) },
  { id: '2x3-dividers-across-magnets', opts: vase({ unitsX: 2, unitsY: 3, heightUnits: 5, holes: 'magnets' }, { dividers: 3, axis: 'y' }) },
  { id: '2x1-refined-wide-line', opts: vase({ unitsX: 2, heightUnits: 4, holes: 'refined' }, { dividers: 1, line: 0.8 }) },
  { id: '1x1-flat-divider', opts: vase({ base: 'flat' }, { dividers: 1 }) },
  { id: 'half-3x2-magnets', opts: vase({ unitsX: 3, unitsY: 2, holes: 'magnets' }, { line: 0.45 }), drawer: HALF },
]);

// ---------------------------------------------------------------------------
// Baseplates, cases, wall grids, spacers, pads, test-fit kit
// ---------------------------------------------------------------------------

/** A drawer that splits on the default bed: three pieces across, two deep, partial cells on two sides. */
const SPLIT: DrawerInput = { ...DEFAULT_DRAWER, width: 320, depth: 270, fill: 'fit', alignX: 0, alignY: 0 };
const plate = (id: string, bp: Partial<BaseplateOptions>, d: Partial<DrawerInput> = {}): NamedDrawer => ({
  id,
  name: id,
  drawer: { ...SPLIT, ...d },
  baseplate: { ...DEFAULT_BASEPLATE, ...bp },
  bins: [],
});
const small = (id: string, bp: Partial<BaseplateOptions>, d: Partial<DrawerInput> = {}): NamedDrawer =>
  plate(id, bp, { mode: 'grid', gridX: 3, gridY: 2, ...d });

const baseplates = plateGroup('baseplates', 'Baseplate styles, magnet and screw options, every joint, piece numbers, blocked cells, half cells', [
  small('frame', {}),
  small('frame-magnets', { magnets: true }),
  small('weighted', { style: 'weighted' }),
  small('skeleton-magnets-screws', { style: 'skeletonized', magnets: true, screws: true }),
  small('solid', { style: 'solid' }),
  small('magnets-bottom', { magnets: true, magnetSide: 'bottom', magnetChamfer: true }),
  small('magnets-release-ribs-slot', { magnets: true, magnetRelease: true, magnetRibs: true, magnetSlot: true }),
  small('screws-pad-chamfer', { screws: true, bottomPad: 2, bottomChamfer: 0.6 }),
  small('half-grid', { magnets: true }, { halfGrid: true }),
  plate('bowtie', { connector: 'bowtie' }),
  plate('pins', { connector: 'pin', magnets: true }),
  plate('puzzle', { connector: 'puzzle', style: 'weighted' }),
  plate('screw-nut', { connector: 'screw', screwFastener: 'nut' }),
  plate('screw-insert-skeleton', { connector: 'screw', screwFastener: 'insert', style: 'skeletonized', magnets: true }),
  plate('no-numbers-mask-void', { connector: 'bowtie', pieceNumbers: false }, { mask: ['0,0', '3,2'], maskStyle: 'void' }),
  plate('mask-solid-half-fill', { connector: 'pin' }, { fill: 'half', mask: ['2,2'], maskStyle: 'solid' }),
  small('pads-dots', { pads: 'dots' }),
  plate('pads-strips-bowtie', { pads: 'strips', connector: 'bowtie' }),
]);

const caseBins: PlacedBin[] = [{ id: 'b', x: 0, y: 0, opts: bin({ unitsX: 2, unitsY: 2, heightUnits: 4 }) }];
const enclosure = (id: string, d: Partial<DrawerInput>, bins: PlacedBin[] = caseBins, bp: Partial<BaseplateOptions> = {}): NamedDrawer => ({
  id,
  name: id,
  drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX: 4, gridY: 3, ...d },
  baseplate: { ...DEFAULT_BASEPLATE, ...bp },
  bins,
});

const enclosures = plateGroup('enclosures', 'Carry cases, wall grids and spacer strips', [
  enclosure('case-default', { enclosure: 'case' }),
  enclosure('case-arch-printed-feet-label', { enclosure: 'case', carryCase: { handle: 'arch', feet: 'printed', label: 'Bits' } }),
  enclosure('case-no-handle-split', { enclosure: 'case', gridX: 6, gridY: 4, carryCase: { handle: 'none', feet: 'none', latches: 3 } }),
  enclosure('wall-countersunk', { enclosure: 'wall' }, []),
  enclosure('wall-keyhole-cleat', { enclosure: 'wall', gridX: 6, gridY: 5, wallMount: { mount: 'keyhole', cleat: true, ledgeHeight: 12 } }, [], { magnets: true }),
  enclosure('spacers-lattice', { mode: 'drawer', width: 42 * 4 + 30, depth: 42 * 3 + 22, fill: 'spacers', alignX: 0, alignY: 0 }, []),
  enclosure('spacers-solid-notabs', { mode: 'drawer', width: 42 * 3 + 40, depth: 42 * 2 + 9, fill: 'spacers', spacers: { style: 'solid', tabs: false } }, []),
]);

const testFit = (name: string, bp: Partial<BaseplateOptions>, b: Partial<BinOptions>, half = false): SampleGroup => ({
  name: `testfit/${name}`,
  note: 'Test-fit kit',
  job: () => planTestFit({ ...DEFAULT_BASEPLATE, ...bp }, bin(b), SAMPLE_SETUP, { x: 42, y: 42, halfGrid: half }),
});

// ---------------------------------------------------------------------------
// Multi-colour (colours.ts): the three ways to print colours
// ---------------------------------------------------------------------------

const PALETTE = [
  { colour: '#161616', name: 'Black' },
  { colour: '#F2F2F2', name: 'White' },
  { colour: '#C12E1F', name: 'Red' },
  { colour: '#0A2989', name: 'Blue' },
];

/** A colour setup: the sample printer, the palette above, these colours. */
export const colourSetup = (colours: PrintSetup['colours']): PrintSetup => ({ ...SAMPLE_SETUP, filaments: PALETTE, colours });

function colourGroup(name: string, note: string, setup: PrintSetup, drawers: NamedDrawer[], include = { baseplate: true, bins: true }): SampleGroup {
  return { name: `colours/${name}`, note, setup, job: () => planPrint(drawers, setup, include) };
}

const colourDrawer = (id: string, bins: PlacedBin[], gridX: number, gridY: number, bp: Partial<BaseplateOptions> = {}): NamedDrawer => ({
  id,
  name: id,
  drawer: { ...DEFAULT_DRAWER, mode: 'grid', gridX, gridY },
  baseplate: { ...DEFAULT_BASEPLATE, ...bp },
  bins,
});
const colourBin = (id: string, x: number, y: number, o: Partial<BinOptions>): PlacedBin => ({ id, x, y, opts: bin(o) });

const colourBins = [
  colourBin('screws', 0, 0, { unitsX: 2, colour: 3, label: 'full', labelText: 'M3', labelStyle: 'inlaid' }),
  colourBin('nuts', 2, 0, { unitsX: 1, colour: 4 }),
  colourBin('plain', 3, 0, { unitsX: 1 }),
  colourBin('tall', 0, 1, { unitsX: 2, heightUnits: 6, divX: 2 }),
];

const byPart = colourGroup(
  'by-part',
  'Each part one filament: red baseplate with blue keys, colour-coded bins, white label text; colours on plates of their own',
  colourSetup({ on: true, roles: { plate: 3, plateAccent: 4, binWalls: 1, labelText: 2 } }),
  [colourDrawer('drawer', colourBins, 4, 2, { connector: 'bowtie' })],
);

const byHeight = colourGroup(
  'by-height',
  'Colour changes by layer: red feet, black walls, white lip; bins of two heights on plates of their own',
  colourSetup({ on: true, strategy: 'height', roles: { plate: 3, binFeet: 3, binWalls: 1, binLip: 2 } }),
  [colourDrawer('drawer', [colourBin('low', 0, 0, { unitsX: 2 }), colourBin('low2', 2, 0, { unitsX: 1 }), colourBin('tall', 3, 0, { unitsX: 1, heightUnits: 6 })], 4, 1)],
);

const byFeature = colourGroup(
  'by-feature',
  'True multi-material: feet, floor, walls, lip, dividers, label tabs and text, drawer pulls each their own volume',
  colourSetup({ on: true, strategy: 'feature', roles: { plate: 3, binFeet: 3, binWalls: 1, binLip: 4, dividers: 2, labelTabs: 4, labelText: 2, containerPull: 3 } }),
  [
    colourDrawer('drawer', [
      colourBin('tabs', 0, 0, { unitsX: 3, unitsY: 1, divX: 3, label: 'full', labelText: 'M2\nM3\nM4', labelStyle: 'inlaid', holes: 'magnets' }),
      colourBin('lite', 3, 0, { unitsX: 1, base: 'lite' }),
      colourBin('unit', 0, 1, { unitsX: 1, unitsY: 2, heightUnits: 9, container: 'drawers', containers: { drawers: { pull: 'tab' } } } as Partial<BinOptions>),
    ], 4, 3),
  ],
  { baseplate: false, bins: true },
);

const qrByPart = colourGroup(
  'qr-by-part',
  'Inlaid QR codes by part: black modules (the QR code role) on white bins, a stick-on plate and a stacking lid',
  colourSetup({ on: true, roles: { binWalls: 2, labelTabs: 2, lids: 2, labelText: 1, qrCode: 1 } }),
  [
    colourDrawer('drawer', [
      colourBin('front', 0, 0, { unitsX: 2, unitsY: 1, heightUnits: 6, qr: 'front', qrContent: 'custom', qrText: 'https://example.com/bins/front' }),
      colourBin('plate', 2, 0, { unitsX: 1, heightUnits: 3, qr: 'plate', qrContent: 'custom', qrText: 'https://example.com/bins/plate' }),
      colourBin('lid', 3, 0, { unitsX: 1, heightUnits: 3, lid: true, qr: 'lid', qrContent: 'custom', qrText: 'https://example.com/bins/lid' }),
    ], 4, 1),
  ],
  { baseplate: false, bins: true },
);

const vaseByHeight = colourGroup(
  'vase-by-height',
  'Vase-mode bins by height: red feet, a black wall; each on a spiral plate of its own (Bambu Studio changes colour by layer only on plates printed by layer), and a plain bin',
  colourSetup({ on: true, strategy: 'height', roles: { binFeet: 3, binWalls: 1 } }),
  [
    colourDrawer('drawer', [
      colourBin('vase', 0, 0, { unitsX: 1, container: 'vase', containers: { vase: {} } } as Partial<BinOptions>),
      colourBin('vase2', 1, 0, { unitsX: 2, heightUnits: 4, container: 'vase', containers: { vase: { dividers: 1 } } } as Partial<BinOptions>),
      colourBin('plain', 3, 0, { unitsX: 1 }),
    ], 4, 1),
  ],
  { baseplate: false, bins: true },
);

export const SAMPLE_GROUPS: SampleGroup[] = [
  containers,
  bases,
  lips,
  accessories,
  walls,
  compartments,
  pocketGrids,
  toolBins,
  labels,
  qr,
  placement,
  vaseBins,
  baseplates,
  enclosures,
  testFit('bowtie-magnets', { connector: 'bowtie', magnets: true }, { holes: 'magnets' }),
  testFit('puzzle', { connector: 'puzzle' }, {}),
  testFit('half-grid-pins', { connector: 'pin' }, { holes: 'magnets' }, true),
  byPart,
  byHeight,
  byFeature,
  qrByPart,
  vaseByHeight,
  ...BOARD_GROUPS,
  ...ATTACHMENT_GROUPS,
];

// ---------------------------------------------------------------------------
// Findings by design
// ---------------------------------------------------------------------------

/**
 * Findings that are there by design (docs/print-check.md says more). `what`
 * matches a print-check issue kind or a PrusaSlicer finding ("stability: …").
 * The sampler's report marks them, so what is left stands out.
 */
export const KNOWN_FINDINGS: { file: RegExp; what: RegExp; why: string }[] = [
  { file: /^(baseplates\/(bowtie|no-numbers-mask-void|pads-strips-bowtie)\.piece)/, what: /^thin$/, why: '0.65 mm walls beside bowtie pockets (CONNECTOR_MIN_WALL), one line' },
  { file: /^placement\/stretched/, what: /^overhang$|Floating bridge anchors|Long bridging|Loose extrusions/, why: 'the stretched body overhangs the margin from just above the baseplate (README); print with supports under it' },
  { file: /^containers\/drawers-/, what: /^overhang$|Long bridging/, why: 'shelves bridge each bay; the planner warns past 60 mm (use more columns, or supports)' },
  { file: /^compartments\/removable-tab/, what: /^overhang$/, why: 'a tab in front of a removable divider bridges its compartment, side wall to side wall' },
  { file: /pattern/, what: /Thin fragile part/, why: 'the hex wall pattern leaves 0.95 mm thick webs (Gridfinity Extended)' },
  { file: /^vase\//, what: /^thin$/, why: 'a vase-mode bin is drawn as it prints: one line of wall above the bottom layers, its dividers two lines a slit apart' },
  { file: /^colours\/vase-by-height\/drawer\.vase/, what: /^thin$/, why: 'a vase-mode bin (as vase/): one line of wall above the bottom layers' },
  { file: /^colours\/vase-by-height\/drawer\.vase/, what: /^thin$/, why: 'a vase-mode bin (as vase/): one line of wall above the bottom layers' },
  { file: /\.(key|lidkey|pin)-\d|spacer-(front|back)-|\.foot-/, what: /Low bed adhesion/, why: 'small or narrow part: a brim helps' },
  // Boards and attachments (sampler-boards.ts), before the catch-alls below.
  ...BOARD_FINDINGS,
  { file: /./, what: /Long bridging extrusions/, why: 'bridges in the design (weight pockets, keyhole slots, hole roofs, half-grid foot gaps): PrusaSlicer flags any long bridge' },
  { file: /./, what: /Floating bridge anchors/, why: 'small bridges anchored on thin features (hinge-pin holes, pocket roofs): no mid-air islands or long ledges found there' },
];

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');

/**
 * File name for a part key: `drawer/slot:b:i` → `drawer.slot-i` (b is the sample's bin), the bin itself → `drawer`
 * (another bin of the drawer: `drawer.<id>`); an attachment (`drawer/att:a`, the sample's) → `drawer`, its extra
 * parts (`drawer/att:a:lid`) → `drawer.lid`.
 */
export function partFile(job: PrintJob, key: string): string {
  const [drawer, rest] = key.includes('/') ? key.split('/', 2) : [job.drawers[0]?.id || 'part', key];
  const bits = rest.split(':');
  const what =
    bits[0] === 'bin' ? (bits[1] === 'b' ? '' : bits[1]) : bits[0] === 'att' ? bits.slice(2).join('-') : bits.filter((b, i) => !(i === 1 && b === 'b')).join('-');
  return slug(drawer || 'part') + (what ? `.${slug(what)}` : '');
}

export interface SampledPart {
  part: JobPart;
  /** `group/drawer.slot-i.stl`. */
  file: string;
  /** Other parts of the job with the same mesh. */
  same: string[];
}

/**
 * What a group's job prints, one entry per mesh: the parts on its plates (not
 * the drawer view's poses, nor what `include` leaves out).
 */
export function printedParts(group: Pick<SampleGroup, 'name'>, job: PrintJob): SampledPart[] {
  const printed = new Set(job.plates.flatMap((pl) => pl.placements.map((p) => p.key)));
  const byMesh = new Map<string, SampledPart>();
  for (const part of Object.values(job.parts)) {
    if (!printed.has(part.key)) continue;
    const seen = byMesh.get(part.meshKey);
    if (seen) seen.same.push(part.key);
    else byMesh.set(part.meshKey, { part, file: `${group.name}/${partFile(job, part.key)}.stl`, same: [] });
  }
  return [...byMesh.values()];
}
