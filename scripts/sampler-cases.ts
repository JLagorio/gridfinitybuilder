/**
 * The parts scripts/sampler.ts prints and checks: every container type, the
 * plain bin's option families, baseplates, carry cases, wall grids, spacer
 * strips, TPU pads and the test-fit kit. Each group is planned like a real
 * job (planPrint / planTestFit), so the parts go through the app's own code.
 *
 * No side effects: tests/printcheck.test.ts builds a subset of these too.
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

export const SAMPLE_SETUP: PrintSetup = DEFAULT_SETUP;

export interface SampleGroup {
  /** Folder name. */
  name: string;
  /** What the group covers. */
  note: string;
  job(): PrintJob;
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
  placement,
  baseplates,
  enclosures,
  testFit('bowtie-magnets', { connector: 'bowtie', magnets: true }, { holes: 'magnets' }),
  testFit('puzzle', { connector: 'puzzle' }, {}),
  testFit('half-grid-pins', { connector: 'pin' }, { holes: 'magnets' }, true),
];

// ---------------------------------------------------------------------------
// Parts
// ---------------------------------------------------------------------------

const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-|-$/g, '');

/** File name for a part key: `drawer/slot:b:i` → `drawer.slot-i` (b is the sample's bin), the bin itself → `drawer`. */
export function partFile(job: PrintJob, key: string): string {
  const [drawer, rest] = key.includes('/') ? key.split('/', 2) : [job.drawers[0]?.id || 'part', key];
  const bits = rest.split(':');
  const what = bits[0] === 'bin' ? '' : bits.filter((b, i) => !(i === 1 && b === 'b')).join('-');
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
