import { useState } from 'react';
import { history, useStore, useUnits } from '../state/store';
import { Group, LengthInput, NumberInput, Section, Segmented, Select, Stepper, TextInput, Toggle } from './fields';
import { DEFAULT_BASEPLATE, baseplateFloor, baseplateHeight, binSeatHeight, screwPlacement, type BaseplateStyle } from '../lib/geometry/baseplate';
import { PIN, SCREW_JOIN, WEIGHTED } from '../lib/geometry/spec';
import { CellMaskEditor } from './CellMaskEditor';
import { DEFAULT_DRAWER, effectiveSize, spacerMargins, type EdgeFill } from '../lib/layout/drawer';
import { unitsAcross } from '../lib/layout/halfgrid';
import { maxBinUnits } from '../lib/bins';
import type { PrintJob } from '../lib/project';
import { PadFields } from './PadFields';
import { EnclosureSection } from './EnclosureFields';
import { Find } from './findContext';
import { FindPanel, MoreInAll } from './find';
import { DRAWER_INDEX } from './panelIndex';
import { HaveBaseplateFold, justBinsHint } from './HaveBaseplate';

/** What a style becomes on a half grid, where its per-cell features don't fit 21 mm cells. */
const HALF_STYLE_HINT: Partial<Record<BaseplateStyle, string>> = {
  weighted: 'The weight pockets don’t fit 21 mm half cells, so on this half grid it is the thick floor without them.',
  skeletonized: 'The corner bosses don’t fit 21 mm half cells, so on this half grid it is open under every cell, like a frame.',
};

/**
 * A ± stepper over half steps (half-grid sizes in u): the value shown is in
 * u, and each click moves one 21 mm cell.
 */
export function HalfStepper({
  label,
  cells,
  max,
  onChange,
  suffix,
}: {
  label: string;
  /** Value in cells (half units). */
  cells: number;
  /** Most cells. */
  max: number;
  onChange: (cells: number) => void;
  suffix?: string;
}) {
  // Stepper steps by 1: read its new value as a direction and move one cell.
  return (
    <Stepper
      label={label}
      value={cells / 2}
      min={0.5}
      max={max / 2}
      suffix={suffix}
      onChange={(v) => onChange(Math.min(max, Math.max(1, cells + Math.sign(v - cells / 2))))}
    />
  );
}

const STYLE_HINT: Record<BaseplateStyle, string> = {
  frame: 'Open bottom: least filament. Magnets or screws add a floor.',
  weighted: `${WEIGHTED.floor} mm floor with a ${WEIGHTED.pocket} mm pocket under each cell for a weight (steel squares, washers, coins).`,
  skeletonized: 'Floor only around the corner holes, the rest cut away: holds magnets and screws with less filament.',
  solid: 'Closed floor under every cell.',
};

function Samples({
  label,
  values,
  onChange,
}: {
  label: string;
  values: number[];
  onChange: (v: number[]) => void;
}) {
  // Nothing at all without extra measurements, so it adds no gap.
  if (!values.length) return null;
  return (
    <div className="samples">
      {values.map((v, i) => (
        <div className="sample-row" key={i}>
          <LengthInput
            label={`${label} ${i + 2}`}
            value={v}
            min={10}
            onChange={(mm) => onChange(values.map((x, k) => (k === i ? mm : x)))}
          />
          <button className="link" onClick={() => onChange(values.filter((_, k) => k !== i))} aria-label={`Remove ${label} ${i + 2}`}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

export function DrawerPanel({ job }: { job: PrintJob }) {
  const drawer = useStore((s) => s.drawer);
  const bp = useStore((s) => s.baseplate);
  const precision = useStore((s) => s.ui.inchPrecision);
  const active = useStore((s) => s.drawers.find((d) => d.id === s.activeDrawerId));
  const renameDrawer = useStore((s) => s.renameDrawer);
  const setDrawer = useStore((s) => s.setDrawer);
  const setHaveBaseplate = useStore((s) => s.setHaveBaseplate);
  const setHalfGrid = useStore((s) => s.setHalfGrid);
  const binCount = useStore((s) => s.bins.length);
  // What the last half-grid switch did, shown while that drawer stays that way.
  const [lastSwitch, setLastSwitch] = useState<{ id: string; on: boolean; text: string } | null>(null);
  const setBp = useStore((s) => s.setBaseplate);
  const setUI = useStore((s) => s.setUI);
  const { units, fmt } = useUnits();
  const L = job.layout;
  const m = L.margins;
  const usedW = effectiveSize(drawer.width, drawer.widthSamples);
  const usedD = effectiveSize(drawer.depth, drawer.depthSamples);
  // Spacer-strip drawers: the plate is just the grid; the margins print as strips.
  const strips = spacerMargins(drawer);
  const partialX = L.xs.slice(1).map((v, i) => v - L.xs[i]).filter((v) => Math.abs(v - L.pitchX) > 1e-6);
  const partialY = L.ys.slice(1).map((v, i) => v - L.ys[i]).filter((v) => Math.abs(v - L.pitchY) > 1e-6);
  const room = drawer.height > 0 ? drawer.height - binSeatHeight(bp) : 0;
  const maxLip = maxBinUnits(room, true);
  const maxFlat = maxBinUnits(room, false);
  const nBlocked = L.mask?.length ?? 0;
  const half = !!drawer.halfGrid;
  // "Just bins": the baseplate is there already; only what places and fits the bins matters.
  const binsOnly = !!drawer.haveBaseplate;
  // On a half grid the cells already are half cells, so 'half' leaves the margin solid.
  const fill: EdgeFill = half && drawer.fill === 'half' ? 'solid' : drawer.fill;
  const across = unitsAcross(L);
  const toggleHalf = (on: boolean) => {
    // Its own undo step, even right after another edit.
    history.checkpoint();
    const n = setHalfGrid(on);
    history.checkpoint();
    const text = n
      ? `${n} bin${n === 1 ? '' : 's'} changed size or moved to fit the ${on ? 'half' : 'whole-unit'} grid.`
      : binCount
        ? `Bins converted: ${on ? 'each 1 u is now 2 × 2 half cells' : 'back to whole units'}.`
        : '';
    setLastSwitch(text && active ? { id: active.id, on, text } : null);
  };
  const gridNote = lastSwitch && lastSwitch.id === active?.id && lastSwitch.on === half ? lastSwitch.text : null;
  const sp = screwPlacement(bp);
  const screwHint = !bp.screws
    ? 'Countersunk holes to screw the plate down.'
    : sp === 'center'
      ? 'Countersunk hole in each cell to screw the plate down.'
      : sp === 'corner'
        ? `In the four corner bosses of each cell${bp.magnets ? ', under the magnets' : ''}.`
        : 'This style puts screws in the corner bosses, which bottom-loaded magnets already use. Load the magnets from the top to add screws.';
  const joints = job.sites.length;
  const connectorHint =
    bp.connector === 'none'
      ? 'Lock the split pieces together: bowtie keys, filament pins, puzzle tabs or M3 screws.'
      : job.plan.pieces.length < 2
        ? 'The baseplate prints in one piece, so there are no seams to join.'
        : bp.connector === 'bowtie'
          ? `Pockets underneath wherever a wall or margin crosses a seam. ${job.connectors.length} keys print with the pieces; fit them with the baseplate upside down.`
          : bp.connector === 'pin'
            ? `${joints} holes across the seams for 1.75 mm filament: cut ${joints} pins ${PIN.length - 0.5} mm long. Nothing extra to print.`
            : bp.connector === 'puzzle'
              ? `${joints} jigsaw tabs on the left / front piece of each seam. Lower each neighbor onto them.`
              : `${joints} × ${SCREW_JOIN.screw} socket-head screws across the seams, in slots open underneath. Raises the floor to ${SCREW_JOIN.floor} mm.`;

  const centered = drawer.alignX === DEFAULT_DRAWER.alignX && drawer.alignY === DEFAULT_DRAWER.alignY;
  const edges = (['outerRadius', 'topTrim', 'bottomClearance', 'bottomChamfer'] as const).filter((k) => bp[k] !== DEFAULT_BASEPLATE[k]);
  const EDGE_NAMES = { outerRadius: 'corner radius', topTrim: 'ridge trim', bottomClearance: 'bottom clearance', bottomChamfer: 'chamfer' };

  return (
    <FindPanel index={DRAWER_INDEX} placeholder="Find a setting…">
      <Section title="Drawer" find="drawer">
        <Find id="print-what" set={binsOnly}>
          <Segmented
            label="Print for this drawer"
            value={binsOnly ? 'bins' : 'all'}
            options={[
              { value: 'all', label: 'Baseplate and bins', title: 'Print the baseplate and the bins for it' },
              { value: 'bins', label: 'Just bins', title: 'You have the baseplate already: print only bins for it' },
            ]}
            onChange={(v) => setHaveBaseplate(v === 'bins')}
            hint={binsOnly ? justBinsHint(drawer) : 'Already have the baseplate? Pick Just bins to print only bins for it.'}
          />
        </Find>
        {active && (
          <Find id="drawer-name">
            <TextInput label="Name" value={active.name} onChange={(name) => renameDrawer(active.id, name)} placeholder="Workbench, top drawer" />
          </Find>
        )}
        <Find id="drawer-size">
          <Segmented
            label={binsOnly ? 'Size of your baseplate' : 'Size from'}
            value={drawer.mode}
            options={[
              { value: 'drawer', label: 'Drawer size' },
              { value: 'grid', label: 'Grid units' },
            ]}
            onChange={(mode) => setDrawer({ mode })}
            hint={
              binsOnly
                ? drawer.mode === 'grid'
                  ? 'Count its cells. A 21 mm half grid: turn on Half grid below.'
                  : 'Made by Gridfit for a drawer? Give that drawer’s size, so the cells (and any partial edge cells) match.'
                : undefined
            }
          />
          {drawer.mode === 'drawer' ? (
            <>
              <div className="row2">
                <LengthInput label="Inside width" value={drawer.width} onChange={(width) => setDrawer({ width })} min={42} />
                <LengthInput label="Inside depth" value={drawer.depth} onChange={(depth) => setDrawer({ depth })} min={42} />
              </div>
              <Samples label="Width" values={drawer.widthSamples} onChange={(widthSamples) => setDrawer({ widthSamples })} />
              <Samples label="Depth" values={drawer.depthSamples} onChange={(depthSamples) => setDrawer({ depthSamples })} />
              <div className="field-hint">
                Measure wall to wall at the floor, in {units === 'in' ? 'inches (20 1/8, 1\' 8 1/8")' : 'mm (or 20 1/8 in)'}.{' '}
                Drawers are rarely square:{' '}
                <button className="link" onClick={() => setDrawer({ widthSamples: [...drawer.widthSamples, drawer.width] })}>
                  + width
                </button>{' '}
                <button className="link" onClick={() => setDrawer({ depthSamples: [...drawer.depthSamples, drawer.depth] })}>
                  + depth
                </button>{' '}
                measured elsewhere, and the smallest is used.
                {(drawer.widthSamples.length > 0 || drawer.depthSamples.length > 0) && (
                  <>
                    {' '}
                    Using <b>{fmt(usedW)}</b> × <b>{fmt(usedD)}</b>.
                  </>
                )}
              </div>
            </>
          ) : half ? (
            <div className="row2">
              <HalfStepper label="Units wide" cells={Math.round(drawer.gridX * 2)} max={80} onChange={(c) => setDrawer({ gridX: c / 2 })} />
              <HalfStepper label="Units deep" cells={Math.round(drawer.gridY * 2)} max={80} onChange={(c) => setDrawer({ gridY: c / 2 })} />
            </div>
          ) : (
            <div className="row2">
              <Stepper label="Units wide" value={drawer.gridX} min={1} max={40} onChange={(gridX) => setDrawer({ gridX })} />
              <Stepper label="Units deep" value={drawer.gridY} min={1} max={40} onChange={(gridY) => setDrawer({ gridY })} />
            </div>
          )}
        </Find>
        {/* A bins-only drawer given in grid units still has a height to fit (layout/drawer.ts insideHeight). */}
        {(drawer.mode === 'drawer' || (binsOnly && !drawer.enclosure)) && (
          <Find id="drawer-height">
            <LengthInput
              label="Inside height (optional)"
              value={drawer.height}
              allowEmpty
              placeholder="e.g. 3 1/2"
              onChange={(height) => setDrawer({ height })}
              hint={
                drawer.height > 0
                  ? maxLip > 0 || maxFlat > 0
                    ? `Bins up to ${maxLip}u with a stacking lip (${maxFlat}u without) fit under ${fmt(room)} above the baseplate floor.`
                    : 'Too shallow for a bin on this baseplate.'
                  : 'Floor to the underside of whatever is above the drawer. Used to warn about bins that are too tall.'
              }
            />
          </Find>
        )}
        <div className="summary">
          <div className="summary-big">
            {half ? (
              <>
                {across.x} × {across.y} <small>u · {L.nx} × {L.ny} half cells</small>
              </>
            ) : (
              <>
                {L.nx} × {L.ny} <small>grid</small>
              </>
            )}
          </div>
          <dl>
            <dt>Baseplate</dt>
            <dd>
              {fmt(L.plateW)} × {fmt(L.plateD)}
            </dd>
            {drawer.mode === 'drawer' && (
              <>
                <dt>{strips ? 'Spacer strips' : 'Solid margin'}</dt>
                <dd>
                  L {fmt((strips ?? m).left)} · R {fmt((strips ?? m).right)} · F {fmt((strips ?? m).front)} · B {fmt((strips ?? m).back)}
                </dd>
              </>
            )}
            <dt>Height</dt>
            <dd>{fmt(baseplateHeight(bp))}</dd>
          </dl>
        </div>
        {units === 'in' && (
          <Find id="inch-precision">
            <Segmented
              label="Show inches to"
              value={precision}
              options={[
                { value: 8, label: '1/8' },
                { value: 16, label: '1/16' },
                { value: 32, label: '1/32' },
                { value: 0, label: 'Decimal' },
              ]}
              onChange={(inchPrecision) => setUI({ inchPrecision })}
            />
          </Find>
        )}
      </Section>

      <Section title="Grid" find="grid">
        {drawer.mode === 'drawer' && (
          <Find id="leftover">
            <Segmented
              label="Leftover space"
              value={fill}
              options={[
                { value: 'solid', label: 'Solid', title: 'Fill the gap around the grid with solid plastic' },
                // On a half grid every cell is a half cell already.
                ...(half ? [] : [{ value: 'half' as const, label: 'Half cells', title: 'Add a row of 21 mm half cells where the gap allows' }]),
                { value: 'fit', label: 'Partial cells', title: 'Turn each gap into a row of narrower cells, so bins can use the space' },
                // A case or wall grid has no drawer walls to wedge strips against.
                ...(drawer.enclosure ? [] : [{ value: 'spacers' as const, label: 'Spacer strips', title: 'The baseplate is just the grid; the gaps print as separate strips' }]),
              ]}
              onChange={(fill) => setDrawer({ fill })}
              hint={
                fill === 'spacers'
                  ? 'The baseplate is just the grid, and each gap prints as a strip that wedges in beside it (settings under Drawer, case or wall).'
                  : fill === 'solid'
                    ? 'Partial cells use the gap for bins with narrower feet, or stretch a bin over it (Bins tab). Push the grid to one side to get one wide row instead of two thin ones.'
                    : partialX.length + partialY.length
                      ? `Partial cells: ${[...new Set([...partialX, ...partialY].map((v) => fmt(v)))].join(', ')}. Bins drawn on them get matching feet.`
                      : `No gap is wide enough (${fill === 'half' ? fmt(21) : `at least ${fmt(drawer.minFill)}`}). Push the grid to one side to combine the gaps.`
              }
            />
            {fill === 'fit' && (
              <LengthInput
                label="Narrowest partial cell"
                value={drawer.minFill}
                min={8}
                max={41}
                onChange={(minFill) => setDrawer({ minFill })}
                hint="Thinner gaps stay solid."
              />
            )}
          </Find>
        )}
        <Group find="blocked" title="Blocked cells" status={nBlocked ? `${nBlocked} blocked` : 'none'} active={nBlocked > 0}>
          <CellMaskEditor layout={L} mask={drawer.mask ?? []} onChange={(mask) => setDrawer({ mask })} />
          <div className="field-hint">
            Click or drag to mark cells that slide hardware or a bump gets in the way of. They get no receptacle, and bins
            can&apos;t go there.
            {nBlocked > 0 && (
              <>
                {' '}
                {nBlocked} blocked.{' '}
                <button className="link" onClick={() => setDrawer({ mask: [] })}>
                  Clear
                </button>
              </>
            )}
          </div>
          {nBlocked > 0 && (
            <Segmented
              label="Blocked cells are"
              value={drawer.maskStyle ?? 'solid'}
              options={[
                { value: 'solid', label: 'Filled flat', title: 'Solid plastic, level with the top of the plate' },
                { value: 'void', label: 'Cut out', title: 'A hole or notch in the plate, so the obstacle pokes through' },
              ]}
              onChange={(maskStyle) => setDrawer({ maskStyle })}
            />
          )}
        </Group>
        {drawer.mode === 'drawer' && (
          <>
            <Find id="grid-position" set={!centered}>
              <Segmented
                label="Grid position, left to right"
                value={drawer.alignX}
                options={[
                  { value: 0, label: 'Left' },
                  { value: 0.5, label: 'Center' },
                  { value: 1, label: 'Right' },
                ]}
                onChange={(alignX) => setDrawer({ alignX })}
              />
              <Segmented
                label="Grid position, front to back"
                value={drawer.alignY}
                options={[
                  { value: 0, label: 'Front' },
                  { value: 0.5, label: 'Center' },
                  { value: 1, label: 'Back' },
                ]}
                onChange={(alignY) => setDrawer({ alignY })}
              />
            </Find>
            <Find id="clearance" set={drawer.clearance !== DEFAULT_DRAWER.clearance}>
              <LengthInput
                label="Fit clearance"
                value={drawer.clearance}
                max={20}
                onChange={(clearance) => setDrawer({ clearance })}
                hint="Taken off each axis so the plate drops in without binding."
              />
            </Find>
          </>
        )}
        {/* A baseplate you have may well be a half grid: in Basic view too. */}
        <Find id="half-grid" set={half || binsOnly}>
          <Toggle
            label="Half grid (21 mm)"
            checked={half}
            onChange={toggleHalf}
            hint={
              gridNote ??
              (half
                ? 'Cells, receptacles and bin feet are 21 mm: bins come in half units (1.5 × 2.5 u) and sit at any half-cell offset. A 1 × 1 u bin stands on 2 × 2 half feet.'
                : 'Gridfinity Extended’s half pitch: 21 mm cells, so bins can be sized and placed in half units. Bins already drawn are converted.')
            }
          />
        </Find>
        <MoreInAll
          ids={[
            ...(drawer.mode === 'drawer'
              ? ([
                  ['grid-position', !centered],
                  ['clearance', drawer.clearance !== DEFAULT_DRAWER.clearance],
                ] as [string, boolean][])
              : []),
            ['half-grid', half || binsOnly],
          ]}
        />
      </Section>

      <EnclosureSection job={job} />

      <Section title={binsOnly ? 'Baseplate · not printed' : 'Baseplate'} find="baseplate">
        <HaveBaseplateFold on={binsOnly} floor={fmt(binSeatHeight(bp))}>
        <Find id="bp-style">
          <Segmented
            label="Style"
            value={bp.style}
            options={[
              { value: 'frame', label: 'Frame', title: 'Open bottom, least filament' },
              { value: 'weighted', label: 'Weighted', title: 'Pockets underneath for weights' },
              { value: 'skeletonized', label: 'Skeleton', title: 'Floor only around the corner holes' },
              { value: 'solid', label: 'Solid', title: 'Closed floor' },
            ]}
            onChange={(style) => setBp({ style })}
            hint={half && HALF_STYLE_HINT[bp.style] ? `${STYLE_HINT[bp.style]} ${HALF_STYLE_HINT[bp.style]}` : STYLE_HINT[bp.style]}
          />
        </Find>
        <Find id="bp-magnets">
          <Toggle
            label="Magnet pockets"
            checked={bp.magnets}
            onChange={(magnets) => setBp({ magnets })}
            hint={
              half
                ? bp.magnets
                  ? '21 mm half cells have no room for 4 corner magnets, so none are cut on this half grid: turn this off to drop the floor they need. Bins keep their own magnets (one per half foot).'
                  : 'Not on a half grid: 21 mm cells have no room for the 4 corner magnets.'
                : '4 pockets per cell so magnet bins snap in (none in partial edge cells).'
            }
          />
          {bp.magnets && (
            <div className="indent">
              <div className="row2">
                <NumberInput label="Magnet Ø" value={bp.magnetDiameter} min={2} max={15} step={0.5} onChange={(magnetDiameter) => setBp({ magnetDiameter })} />
                <NumberInput label="Magnet height" value={bp.magnetHeight} min={0.5} max={6} step={0.5} onChange={(magnetHeight) => setBp({ magnetHeight })} />
              </div>
              <NumberInput
                label="Pocket fit"
                value={bp.magnetFit}
                min={-0.3}
                max={1}
                step={0.05}
                onChange={(magnetFit) => setBp({ magnetFit })}
                hint="Added to the magnet diameter. 0.1–0.2 = press fit, 0.3+ = glue."
              />
              <Segmented
                label="Insert magnets from"
                value={bp.magnetSide}
                options={[
                  { value: 'top', label: 'Top' },
                  { value: 'bottom', label: 'Bottom' },
                ]}
                onChange={(magnetSide) => setBp({ magnetSide })}
              />
              {bp.magnetSide === 'top' && (
                <Toggle label="Push-out holes underneath" checked={bp.magnetRelease} onChange={(magnetRelease) => setBp({ magnetRelease })} />
              )}
              <Toggle
                label="Crush ribs"
                checked={bp.magnetRibs}
                onChange={(magnetRibs) => setBp({ magnetRibs })}
                hint="8 ribs grip the magnet, so it holds without glue."
              />
              <Toggle label="Chamfered mouth" checked={bp.magnetChamfer} onChange={(magnetChamfer) => setBp({ magnetChamfer })} />
              <Toggle
                label="Pry slot"
                checked={bp.magnetSlot}
                onChange={(magnetSlot) => setBp({ magnetSlot })}
                hint="A slot beside each pocket to lever a magnet back out."
              />
            </div>
          )}
        </Find>
        <Find id="bp-screws">
          <Toggle label="Screw holes" checked={bp.screws} onChange={(screws) => setBp({ screws })} hint={screwHint} />
          {bp.screws && (
            <div className="indent row2">
              <NumberInput label="Screw Ø" value={bp.screwDiameter} min={2} max={6} step={0.5} onChange={(screwDiameter) => setBp({ screwDiameter })} />
              <NumberInput label="Head Ø" value={bp.screwHeadDiameter} min={3} max={12} step={0.5} onChange={(screwHeadDiameter) => setBp({ screwHeadDiameter })} />
            </div>
          )}
        </Find>
        {/* Under both: the floor the magnet pockets and screw heads sit in. */}
        {(bp.magnets || bp.screws) && (
          <Find id={bp.magnets ? 'bp-magnets' : 'bp-screws'}>
            <NumberInput
              label="Hole floor thickness"
              value={bp.holeFloor}
              min={Math.max(1, bp.magnets ? bp.magnetHeight + 0.6 : 1)}
              max={10}
              step={0.1}
              onChange={(holeFloor) => setBp({ holeFloor })}
            />
          </Find>
        )}
        <Find id="bp-connectors">
          <Select
            label="Connectors"
            value={bp.connector}
            options={[
              { value: 'none', label: 'None' },
              { value: 'bowtie', label: 'Bowtie keys' },
              { value: 'pin', label: 'Filament pins' },
              { value: 'puzzle', label: 'Puzzle tabs' },
              { value: 'screw', label: 'M3 screws' },
            ]}
            onChange={(connector) => setBp({ connector })}
            hint={connectorHint}
          />
          {bp.connector === 'screw' && (
            <Segmented
              label="Screws go into"
              value={bp.screwFastener}
              options={[
                { value: 'nut', label: 'Hex nuts', title: 'A slot for an M3 hex nut, open underneath' },
                { value: 'insert', label: 'Heat-set inserts', title: 'A 4 mm hole in the seam face for an M3 insert' },
              ]}
              onChange={(screwFastener) => setBp({ screwFastener })}
            />
          )}
        </Find>
        <Find id="bp-numbers" set={!bp.pieceNumbers}>
          <Toggle
            label="Piece numbers underneath"
            checked={bp.pieceNumbers}
            onChange={(pieceNumbers) => setBp({ pieceNumbers })}
            hint="Debossed in a solid spot and mirrored, so they read with the piece upside down. They match the assembly map."
          />
        </Find>
        <Find id="bp-floor" set={bp.bottomPad !== DEFAULT_BASEPLATE.bottomPad}>
          <NumberInput
            label="Extra solid floor"
            value={bp.bottomPad}
            min={0}
            max={10}
            step={0.2}
            onChange={(bottomPad) => setBp({ bottomPad })}
            hint={bp.style === 'frame' ? '0 = open-bottom frame (least filament).' : 'Added under the floor the style needs.'}
          />
        </Find>
        <Find id="bp-pads" set={!!bp.pads}>
          <PadFields bp={bp} setBp={setBp} job={job} />
        </Find>
        <Group find="bp-edges" title="Edges and fit" status={edges.length ? edges.map((k) => EDGE_NAMES[k]).join(' · ') : 'standard'} active={edges.length > 0}>
          <NumberInput label="Outer corner radius" value={bp.outerRadius} min={0} max={30} step={0.5} onChange={(outerRadius) => setBp({ outerRadius })} />
          <NumberInput
            label="Top ridge trim"
            value={bp.topTrim}
            min={0}
            max={1.5}
            step={0.05}
            onChange={(topTrim) => setBp({ topTrim })}
            hint="Flattens the knife-edge where cells meet so it prints cleanly."
          />
          <NumberInput
            label="Bottom clearance"
            value={bp.bottomClearance}
            min={0}
            max={1}
            step={0.05}
            onChange={(bottomClearance) => setBp({ bottomClearance })}
            hint="Spec is 0.35 (5 mm baseplate)."
          />
          <NumberInput
            label="Bottom edge chamfer"
            value={bp.bottomChamfer}
            min={0}
            max={2}
            step={0.1}
            onChange={(bottomChamfer) => setBp({ bottomChamfer })}
            hint="Elephant-foot relief on the outside edge."
          />
          <div className="field-hint">Floor under the receptacles: {fmt(baseplateFloor(bp))}</div>
        </Group>
        <MoreInAll
          ids={[
            ['bp-numbers', !bp.pieceNumbers],
            ['bp-floor', bp.bottomPad !== DEFAULT_BASEPLATE.bottomPad],
            ['bp-pads', !!bp.pads],
            ['bp-edges', edges.length > 0],
          ]}
        />
        </HaveBaseplateFold>
      </Section>
    </FindPanel>
  );
}
