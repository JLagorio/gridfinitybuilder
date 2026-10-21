import { Fragment, useState } from 'react';
import { useStore, useUnits } from '../state/store';
import { Group, LengthInput, Section, Segmented, Select, Slider, Stepper, Toggle } from './fields';
import { binLabel, type BinCells, type BinOptions } from '../lib/geometry/bin';
import { hasLid } from '../lib/geometry/lid';
import { canPlace, withBlocked } from '../lib/bins';
import { binCellsAt, binSpec, binStretched, binUnitsText, lidSpec, type PlacedBin, type PrintJob } from '../lib/project';
import { MAX_CELLS, MAX_STRETCH, STRETCH_SIDES, STRETCH_Z, hasStretch, stretchOf, type BinStretch } from '../lib/geometry/placement';
import { STRETCH_LABEL, autoStretch, effectiveStretch, stretchRoom } from '../lib/layout/stretch';
import type { GridLayout } from '../lib/layout/drawer';
import { HalfStepper } from './DrawerPanel';
import { BaseField, HeightField, HoleFields, InteriorFields, LipFields, WallFields } from './BinVariantFields';
import { downloadBytes, geometry } from '../worker/client';
import { duplicateSelection, removeSelection, useSelectedIds } from '../state/selection';
import { BinPresets, TemplatesSection } from './TemplatesSection';
import { CompartmentTools, EditWallsLink } from './CompartmentFields';
import { LabelFields } from './LabelFields';
import { ToolLibrary } from './ToolLibrary';
import { BinContentsFields } from './ContentsField';
import { AccessoryFields, accessoriesActive, accessoryStatus } from './AccessoryFields';
import { InsertFields, insertStatus, insertsActive } from './InsertFields';
import { binTotalHeight, binCells } from '../lib/geometry/bin';
import { activeContainer, containerDefs, type ContainerKind } from '../lib/geometry/containers';
import { containerFields } from './containers';
import { bedCount, bedOvershoot, bedProblem, fitStretch, maxUnitsAlong, placedOvershoot, shrinkToBed, usableBeds, type Beds } from '../lib/bedfit';
import { findPrinter } from '../lib/printers';
import { sanitizeBin } from '../lib/geometry/bin';
import { usesToolCompartments } from '../lib/geometry/compartments';
import { BinChecksNotice } from './PrintChecks';
import { StackSection } from './StackSection';
import { FillFromListButton } from './FillFromList';
import { Find } from './findContext';
import { FindPanel, MoreInAll } from './find';
import { BIN_INDEX } from './panelIndex';
import { isVaseBin } from '../lib/geometry/containers/vase';

type FieldProps = { opts: BinOptions; onChange: (p: Partial<BinOptions>) => void };

/** What the bin is: a plain bin, or a drawer unit, parts box, … (containers/). Hidden until a type is registered. */
function ContainerTypeField({ opts, onChange }: FieldProps) {
  const defs = containerDefs();
  if (!defs.length) return null;
  const active = activeContainer(opts);
  return (
    <Select<ContainerKind>
      label="Type"
      value={active ? active.def.kind : 'bin'}
      options={[{ value: 'bin', label: 'Bin' }, ...defs.map((d) => ({ value: d.kind, label: d.label }))]}
      onChange={(container) => {
        // Some types need more height than a bin (drawers): start them tall enough.
        const min = defs.find((d) => d.kind === container)?.minHeightUnits ?? 0;
        onChange({ container: container === 'bin' ? undefined : container, ...(opts.heightUnits < min ? { heightUnits: min } : {}) });
      }}
      hint={active ? active.def.description : 'An open bin with compartments, pockets or tool cutouts.'}
    />
  );
}

/** A container's height, in units (its own parts decide the rest). */
function ContainerHeight({ opts, onChange }: FieldProps) {
  const { fmt } = useUnits();
  return (
    <Stepper
      label="Height"
      value={opts.heightUnits}
      min={2}
      max={30}
      suffix="u"
      onChange={(heightUnits) => onChange({ heightUnits })}
      hint={`${fmt(binTotalHeight(opts))} overall`}
    />
  );
}

/** A container's own fields (drawers, lid, latch, …), under its type's name. */
function ContainerSection({ opts, onChange, cells }: FieldProps & { cells?: BinCells }) {
  const active = activeContainer(opts)!;
  const Fields = containerFields(active.def.kind);
  const kind = active.def.kind;
  const setOwn = (patch: Record<string, unknown>) =>
    onChange({ containers: { ...opts.containers, [kind]: { ...(active.opts as Record<string, unknown>), ...patch } } });
  if (!Fields) return null;
  return (
    <Section find="container" title={active.def.label}>
      <Fields bin={opts} value={active.opts} onChange={setOwn} onBinChange={onChange} cells={cells ?? binCells(opts)} />
    </Section>
  );
}

/** A plain bin's scoop, label tab and labels. Pocket grids and tool cutouts have no scoop or tab, only the front label. */
function LabelSection({ opts, onChange }: FieldProps) {
  const open = opts.interior === 'compartments';
  // Without compartments only the front label is left, which Basic shows once it's on.
  return (
    <Section find={open ? 'label' : 'front-label'} set={!open && opts.frontLabel !== 'none'} title={open ? 'Scoop & label' : 'Front label'}>
      {open && (
        <>
          <Find id="scoop">
            <Slider
              label="Finger scoop"
              value={opts.scoop}
              min={0}
              max={1}
              step={0.05}
              format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
              onChange={(scoop) => onChange({ scoop })}
              hint="A curved front wall, so small parts slide out. Compartments can have their own."
            />
          </Find>
          <Find id="label-tab">
            <Segmented
              label="Label tab"
              value={opts.label}
              options={[
                { value: 'none', label: 'None' },
                { value: 'full', label: 'Full' },
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Mid' },
                { value: 'right', label: 'Right' },
              ]}
              onChange={(label) => onChange({ label })}
            />
          </Find>
        </>
      )}
      <LabelFields opts={opts} onChange={onChange} />
    </Section>
  );
}

const WALL_NAMES: Record<string, string> = { f: 'front', b: 'back', l: 'left', r: 'right' };
const wallList = (mask: string) => [...mask].map((c) => WALL_NAMES[c] ?? c).join(', ');

function baseStatus(o: BinOptions) {
  const holes = { none: 'no holes', magnets: 'magnets', screws: 'screws', both: 'magnets + screws', refined: 'refined magnets' }[o.holes];
  return `${o.base} feet · ${holes}${o.holes !== 'none' && o.holeCorners ? ' (corners)' : ''}`;
}

function lipStatus(o: BinOptions) {
  if (!o.lip) return 'no lip';
  return [o.lipStyle === 'reduced' ? 'reduced lip' : 'stacking lip', o.lipNotches && 'notches', o.lid && (o.lidStyle === 'pockets' ? 'pocket lid' : 'lid')].filter(Boolean).join(' · ');
}

function wallStatus(o: BinOptions) {
  const parts = [
    o.cutoutWalls && `cutouts: ${wallList(o.cutoutWalls)}`,
    o.slideWalls && `slides: ${wallList(o.slideWalls)}`,
    o.patternWalls && `hex: ${wallList(o.patternWalls)}`,
    !o.fillet && 'square corners',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'plain';
}

const baseActive = (o: BinOptions) => o.base !== 'standard' || o.holes !== 'none';
const lipActive = (o: BinOptions) => !o.lip || o.lipStyle !== 'normal' || o.lipNotches || o.lid;
const wallsActive = (o: BinOptions) => !!(o.cutoutWalls || o.slideWalls || o.patternWalls) || !o.fillet;

/**
 * Stretch the selected bin over the solid margin toward the drawer wall, on
 * the sides where it touches the edge of the grid (layout/stretch.ts).
 */
function StretchSection({ layout, bin }: { layout: GridLayout; bin: PlacedBin }) {
  const updateBin = useStore((s) => s.updateBin);
  const bed = usableBeds(useStore((s) => s.setup));
  // No more stretch than the print bed takes (bedfit.ts).
  const stretchTo = (want: Partial<BinStretch> | null) => updateBin(bin.id, { stretch: fitStretch(layout, bin, want, bed) });
  const { fmt } = useUnits();
  const room = stretchRoom(layout, bin);
  const eff = stretchOf(effectiveStretch(layout, bin));
  const want = stretchOf(bin.stretch);
  const open = STRETCH_SIDES.filter((k) => room[k] > 0);
  const m = layout.margins;
  // Nothing to offer when the grid fills the drawer (or the margins are cells).
  if (!open.length && !hasStretch(bin.stretch) && !STRETCH_SIDES.some((k) => m[k] >= 0.5)) return null;
  const set = (k: (typeof STRETCH_SIDES)[number], mm: number) => stretchTo({ ...want, [k]: Math.min(Math.max(0, mm), room[k]) });
  const parked = STRETCH_SIDES.filter((k) => want[k] > 0 && room[k] === 0);
  const stretched = hasStretch(effectiveStretch(layout, bin));
  return (
    <Section
      title="Stretch into the gap"
      find="stretch"
      set={hasStretch(bin.stretch)}
      aside={
        open.length > 0 && (
          <span className="button-row">
            <button className="link" onClick={() => stretchTo(autoStretch(layout, bin) ?? null)} title="Reach the edge of the baseplate on every side that touches the grid edge (as far as the print bed allows)">
              Auto
            </button>
            {hasStretch(bin.stretch) && (
              <button className="link" onClick={() => updateBin(bin.id, { stretch: null })}>
                None
              </button>
            )}
          </span>
        )
      }
    >
      {open.length ? (
        <div className="row2">
          {open.map((k) => (
            <LengthInput
              key={k}
              label={`${STRETCH_LABEL[k]} (up to ${fmt(room[k], { mmDigits: 2 })})`}
              value={eff[k]}
              allowEmpty
              placeholder="0"
              // More than there is room for just reaches the plate edge.
              max={MAX_STRETCH}
              onChange={(mm) => set(k, mm)}
            />
          ))}
        </div>
      ) : (
        <p className="muted small">Move the bin against the edge of the grid to stretch it over the solid margin next to the drawer wall.</p>
      )}
      {parked.length > 0 && (
        <p className="muted small">
          Kept but not used here ({parked.map((k) => STRETCH_LABEL[k].toLowerCase()).join(', ')}): the bin isn&apos;t against that edge of the grid.
        </p>
      )}
      <div className="field-hint">
        {stretched ? 'The body' : 'A stretched bin'} reaches over the margin from {fmt(STRETCH_Z)} up, clear of the baseplate; its feet stay on
        the grid. Its stacking lip no longer lines up with the grid, so bins stacked on it sit off the grid, and it gets no lid or lip
        notches. The overhang prints over air: past a few mm, add supports from the build plate.
      </div>
    </Section>
  );
}

export function BinPanel({ job }: { job: PrintJob }) {
  const bins = useStore((s) => s.bins);
  const selectedId = useStore((s) => s.ui.selectedBinId);
  const newBin = useStore((s) => s.newBin);
  const updateBin = useStore((s) => s.updateBin);
  const setNewBin = useStore((s) => s.setNewBin);
  const fillEmpty = useStore((s) => s.fillEmpty);
  const clearBins = useStore((s) => s.clearBins);
  const setUI = useStore((s) => s.setUI);
  const templates = useStore((s) => s.templates.length);
  const tools = useStore((s) => s.tools.length);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setup = useStore((s) => s.setup);
  const { fmt } = useUnits();
  const bed = usableBeds(setup);
  // With several printers, the messages name the one that comes closest.
  const printerName = bedCount(bed) > 1 ? '' : (findPrinter(setup.printerId)?.name ?? 'this printer');
  const sel = bins.find((b) => b.id === selectedId) ?? null;
  // With several bins selected, the panel shows the primary one and edits apply to all.
  const selIds = useSelectedIds();
  const many = selIds.length > 1;
  const { nx, ny } = job.layout;
  const half = !!job.layout.halfGrid;

  const changeSelected = (p: Partial<BinOptions>) => {
    if (!sel) return;
    // The store refuses edits that push a bin past the print bed; say why here.
    const next = { ...sel, opts: sanitizeBin({ ...sel.opts, ...p }) };
    if (placedOvershoot(job.layout, next, bed) > placedOvershoot(job.layout, sel, bed) + 1e-6) {
      setSizeError(`${bedProblem(next.opts, binCellsAt(job.layout, next), bed, (mm) => fmt(mm)) ?? 'Too big for the printer.'}${printerName ? ` (${printerName})` : ''}`);
      return;
    }
    if (p.unitsX !== undefined || p.unitsY !== undefined) {
      const r = { x: sel.x, y: sel.y, w: p.unitsX ?? sel.opts.unitsX, d: p.unitsY ?? sel.opts.unitsY };
      if (!canPlace(withBlocked(bins, job.layout.mask), r, nx, ny, sel.id)) {
        setSizeError('No room to grow that way — move the bin or clear neighbours first.');
        return;
      }
    }
    setSizeError(null);
    for (const id of many ? selIds : [sel.id]) updateBin(id, { opts: p });
  };

  // New bins: their settings must leave a 1 × 1 bin that the printer takes (height, a container's parts).
  const changeNew = (p: Partial<BinOptions>) => {
    const next = sanitizeBin({ ...newBin, ...p, unitsX: 1, unitsY: 1 });
    const one = sanitizeBin({ ...newBin, unitsX: 1, unitsY: 1 });
    if (bedOvershoot(next, null, bed) > bedOvershoot(one, null, bed) + 1e-6) {
      setSizeError(`${bedProblem(next, null, bed, (mm) => fmt(mm)) ?? 'Too big for the printer.'}${printerName ? ` (${printerName})` : ''}`);
      return;
    }
    setSizeError(null);
    setNewBin(p);
  };

  const downloadSelected = async (format: '3mf' | 'stl' | 'step' = '3mf') => {
    if (!sel) return;
    setBusy(true);
    try {
      const spec = binSpec(job.layout, sel);
      const name = `gridfinity-${isVaseBin(sel.opts) ? 'vase-' : ''}bin-${binUnitsText(job.layout, sel.opts).replace('×', 'x')}x${sel.opts.heightUnits}u`;
      const label = binLabel(sel.opts, spec.cells);
      if (format === 'stl') downloadBytes(await geometry.exportStlSingle(spec, label), `${name}.stl`, 'model/stl');
      else if (format === 'step') downloadBytes(await geometry.exportStepSingle(spec, `Bin ${label}`), `${name}.step`, 'model/step');
      else downloadBytes(await geometry.exportSingle(spec, label), `${name}.3mf`, 'model/3mf');
    } finally {
      setBusy(false);
    }
  };
  const downloadLid = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      const size = binUnitsText(job.layout, sel.opts);
      const bytes = await geometry.exportSingle(lidSpec(job.layout, sel), `Lid ${size}`);
      downloadBytes(bytes, `gridfinity-lid-${size.replace('×', 'x')}.3mf`, 'model/3mf');
    } finally {
      setBusy(false);
    }
  };

  const counts = new Map<string, number>();
  for (const b of bins) {
    const label = binLabel(b.opts, binCellsAt(job.layout, b));
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  // The panel edits the selected bins, or the settings for new bins.
  const opts = sel ? sel.opts : newBin;
  const onChange = sel ? changeSelected : changeNew;
  const one = sel && !many ? sel : null;
  const cells = sel ? binCellsAt(job.layout, sel) : undefined;
  const container = activeContainer(opts);
  const stacked = !!one && (!!one.on || bins.some((b) => b.on === one.id));
  // Vase-mode bins don't stretch: one wall can't print the overhang.
  const stretchable = !!one && !isVaseBin(one.opts) && (hasStretch(one.stretch) || STRETCH_SIDES.some((k) => job.layout.margins[k] >= 0.5));
  const toolBin = !!sel && (sel.opts.interior === 'cutouts' || usesToolCompartments(sel.opts));

  const layout = (
    <Section find="layout" title="Layout">
      {!sel && <p className="muted small">Drag across empty cells on the grid to draw a bin. Click a bin to edit it, drag it to move it, press Delete to remove it.</p>}
      <div className="button-row">
        <button onClick={() => fillEmpty()} disabled={!nx || !ny}>
          Fill empty with 1×1
        </button>
        <FillFromListButton layout={job.layout} />
        <button className="danger" onClick={() => confirm('Remove all bins?') && clearBins()} disabled={!bins.length}>
          Clear all
        </button>
      </div>
      {bins.length > 0 ? (
        <ul className="bin-counts">
          {[...counts.entries()].map(([label, n]) => (
            <li key={label}>
              <span>{label}</span>
              <b>× {n}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No bins yet.</p>
      )}
    </Section>
  );

  return (
    <FindPanel index={BIN_INDEX} placeholder="Find a setting…">
      {/* Nothing selected: drawing and filling the drawer come first. */}
      {!sel && layout}

      <Section
        find="bin"
        title={many ? `${selIds.length} bins selected` : sel ? 'Selected bin' : 'New bins'}
        aside={
          sel && (
            <button className="link" onClick={() => setUI({ selectedBinId: null })}>
              Done
            </button>
          )
        }
      >
        {many && <p className="muted small">Showing the first bin’s settings. Changes apply to all {selIds.length}.</p>}
        {!sel && <p className="muted small">The bins you draw next get these settings.</p>}
        {one && <TooBigNotice bin={one} layout={job.layout} bed={bed} printerName={printerName} />}
        {one && <BinChecksNotice bin={one} layout={job.layout} />}
        <Find id="quick">
          <BinPresets />
        </Find>
        <Find id="type">
          <ContainerTypeField opts={opts} onChange={onChange} />
        </Find>
        {one && (
          <Find id="size">
            {half ? (
              <div className="row2">
                <HalfStepper label="Width" cells={one.opts.unitsX} max={maxUnitsAlong(job.layout, one, 'x', bed, MAX_CELLS)} suffix="u" onChange={(unitsX) => onChange({ unitsX })} />
                <HalfStepper label="Depth" cells={one.opts.unitsY} max={maxUnitsAlong(job.layout, one, 'y', bed, MAX_CELLS)} suffix="u" onChange={(unitsY) => onChange({ unitsY })} />
              </div>
            ) : (
              <div className="row2">
                <Stepper label="Width" value={one.opts.unitsX} min={1} max={maxUnitsAlong(job.layout, one, 'x', bed, 12)} suffix="u" onChange={(unitsX) => onChange({ unitsX })} />
                <Stepper label="Depth" value={one.opts.unitsY} min={1} max={maxUnitsAlong(job.layout, one, 'y', bed, 12)} suffix="u" onChange={(unitsY) => onChange({ unitsY })} />
              </div>
            )}
          </Find>
        )}
        <Find id="height">{container ? <ContainerHeight opts={opts} onChange={onChange} /> : <HeightField opts={opts} onChange={onChange} cells={cells} />}</Find>
        {!container && <MoreInAll ids={[['height-mode', opts.heightMode !== 'units']]} />}
        {sizeError && <div className="field-error">{sizeError}</div>}
      </Section>

      {/* Keyed by bin, so each bin's groups decide afresh whether they start open. */}
      <Fragment key={sel?.id ?? 'new'}>
        {container ? (
          <ContainerSection opts={opts} onChange={onChange} cells={cells} />
        ) : (
          <>
            <Section find="inside" title="Inside" aside={sel && opts.interior === 'compartments' ? <EditWallsLink /> : undefined}>
              <InteriorFields opts={opts} onChange={onChange} cells={cells} />
              {opts.interior === 'compartments' && (
                <Find id="compartments">
                  {sel ? <CompartmentTools opts={sel.opts} onChange={changeSelected} binId={sel.id} grid={job.layout} /> : <CompartmentTools opts={newBin} onChange={setNewBin} />}
                </Find>
              )}
            </Section>
            <LabelSection opts={opts} onChange={onChange} />
          </>
        )}

        <Section find="options" title="Options">
          <Group find="base" title="Base & holes" status={baseStatus(opts)} active={baseActive(opts)}>
            <Find id="base-feet">
              <BaseField opts={opts} onChange={onChange} />
            </Find>
            <Find id="holes">
              <HoleFields opts={opts} onChange={onChange} />
              {half && opts.holes !== 'none' && opts.base !== 'flat' && (
                <div className="field-hint">
                  Half grid: each 21 mm foot gets one hole, at the corner of its 42 mm unit (Gridfinity Extended&apos;s layout), so whole-unit bins also fit
                  magnet baseplates. Partial edge cells get none.
                </div>
              )}
            </Find>
          </Group>
          {!container && (
            <>
              <Group find="lip" title="Lip & lid" status={lipStatus(opts)} active={lipActive(opts)}>
                <LipFields opts={opts} onChange={onChange} cells={cells} />
              </Group>
              <Group find="walls" title="Walls" status={wallStatus(opts)} active={wallsActive(opts)}>
                <WallFields opts={opts} onChange={onChange} />
                <Find id="fillet">
                  <Toggle label="Rounded inside corners" checked={opts.fillet} onChange={(fillet) => onChange({ fillet })} />
                </Find>
              </Group>
              <Group find="trays" title="Trays, lids & rails" status={accessoryStatus(opts, fmt, cells)} active={accessoriesActive(opts)}>
                <AccessoryFields opts={opts} onChange={onChange} cells={cells} />
              </Group>
              <Group find="inserts" title="Cups & grid inserts" status={insertStatus(opts, cells)} active={insertsActive(opts)}>
                <InsertFields opts={opts} onChange={onChange} cells={cells} />
              </Group>
            </>
          )}
          <MoreInAll
            ids={[
              // Without compartments the front label has no section in Basic (LabelSection).
              ...(container || opts.interior === 'compartments' ? [] : ([['front-label', opts.frontLabel !== 'none']] as [string, boolean][])),
              ...(container ? [] : ([['walls', wallsActive(opts)], ['trays', accessoriesActive(opts)], ['inserts', insertsActive(opts)]] as [string, boolean][])),
              ...(one ? ([['stack', stacked]] as [string, boolean][]) : []),
              ...(stretchable ? ([['stretch', hasStretch(one!.stretch)]] as [string, boolean][]) : []),
              ['templates', templates > 0],
              ['tools', tools > 0 || toolBin],
            ]}
          />
        </Section>

        {one && (
          <Section find="contents" title="What’s in it">
            <BinContentsFields bin={one} grid={job.layout} onLabel={(labelText) => changeSelected({ labelText })} label={null} />
          </Section>
        )}
        {one && <StackSection job={job} bin={one} />}
        {stretchable && <StretchSection layout={job.layout} bin={one} />}

        {sel && (
          <Section find="actions" title={many ? `These ${selIds.length} bins` : 'This bin'}>
            <div className="button-row">
              <button onClick={() => duplicateSelection()}>Duplicate</button>
              <button onClick={() => setNewBin({ ...sel.opts })} title="New bins you draw will use these settings">
                Use for new bins
              </button>
              <button className="danger" onClick={() => removeSelection()}>
                Delete
              </button>
            </div>
            {one && (
              <div className="field">
                <span className="field-label">{busy ? 'Building…' : 'Download this bin'}</span>
                <div className="button-row download-row">
                  <button onClick={() => downloadSelected()} disabled={busy}>
                    .3mf
                  </button>
                  <button onClick={() => downloadSelected('stl')} disabled={busy}>
                    .stl
                  </button>
                  <button onClick={() => downloadSelected('step')} disabled={busy} title="Flat-faced solid for CAD (Fusion 360, FreeCAD, Onshape, SolidWorks)">
                    .step (CAD)
                  </button>
                  {hasLid(one.opts) && !binStretched(job.layout, one) && (
                    <button onClick={downloadLid} disabled={busy}>
                      Its lid (.3mf)
                    </button>
                  )}
                </div>
                <div className="field-hint">To print everything at once, use Print plates.</div>
              </div>
            )}
          </Section>
        )}
      </Fragment>

      <TemplatesSection />
      <ToolLibrary job={job} />
      {sel && layout}
    </FindPanel>
  );
}

/** A bin that doesn't fit the printer (e.g. after picking a smaller one): what's wrong, and a one-click fix. */
function TooBigNotice({ bin, layout, bed, printerName }: { bin: PlacedBin; layout: GridLayout; bed: Beds; printerName: string }) {
  const { fmt } = useUnits();
  const updateBin = useStore((s) => s.updateBin);
  const problem = bedProblem(bin.opts, binCellsAt(layout, bin), bed, (mm) => fmt(mm));
  if (!problem) return null;
  const shrink = () => {
    const fit = shrinkToBed(layout, bin, bed);
    updateBin(bin.id, {
      opts: { unitsX: fit.opts.unitsX, unitsY: fit.opts.unitsY, heightUnits: fit.opts.heightUnits, heightMode: fit.opts.heightMode },
      ...(fit.stretch !== bin.stretch ? { stretch: fit.stretch ?? null } : {}),
    });
  };
  return (
    <div className="field-error too-big" role="alert">
      <b>Too big for {printerName ? `the ${printerName}` : 'every printer'}.</b> {problem} It won’t be printed until it fits.{' '}
      <button className="link" onClick={shrink}>
        Shrink to fit
      </button>
    </div>
  );
}
