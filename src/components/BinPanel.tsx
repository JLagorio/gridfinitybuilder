import { useState, type ReactNode } from 'react';
import { useStore, useUnits } from '../state/store';
import { LengthInput, Section, Segmented, Slider, Stepper, Toggle } from './fields';
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
import { TemplatesSection } from './TemplatesSection';
import { CompartmentsSection } from './CompartmentFields';
import { LabelFields } from './LabelFields';
import { ToolLibrary } from './ToolLibrary';
import { BinContentsFields } from './ContentsField';
import { AccessoryFields, accessoriesActive, accessoryStatus } from './AccessoryFields';
import { InsertFields, insertStatus, insertsActive } from './InsertFields';
import { binTotalHeight, binCells } from '../lib/geometry/bin';
import { activeContainer, containerDefs, type ContainerKind } from '../lib/geometry/containers';
import { containerFields } from './containers';
import { Select } from './fields';
import { bedCount, bedOvershoot, bedProblem, fitStretch, maxUnitsAlong, placedOvershoot, shrinkToBed, usableBeds, type Beds } from '../lib/bedfit';
import { findPrinter } from '../lib/printers';
import { sanitizeBin } from '../lib/geometry/bin';
import { BinChecksNotice } from './PrintChecks';
import { StackSection } from './StackSection';
import { FillFromListButton } from './FillFromList';

function BinFields({
  opts,
  onChange,
  sizeEditable,
  sizeError,
  cells,
  contents,
  half,
  maxX,
  maxY,
}: {
  opts: BinOptions;
  onChange: (p: Partial<BinOptions>) => void;
  sizeEditable: boolean;
  sizeError?: string | null;
  /** Cell sizes under the selected bin (partial edge cells). */
  cells?: BinCells;
  /** "What's in it" fields, shown after the label fields (placed bins only). */
  contents?: ReactNode;
  /** Half-grid drawer: sizes count 21 mm cells, shown in u (cells / 2). */
  half?: boolean;
  /** Most cells across / deep that still fit the print bed (bedfit.ts). */
  maxX?: number;
  maxY?: number;
}) {
  const capX = Math.min(half ? MAX_CELLS : 12, maxX ?? Infinity);
  const capY = Math.min(half ? MAX_CELLS : 12, maxY ?? Infinity);
  return (
    <>
      {sizeEditable && (
        <>
          {half ? (
            <div className="row2">
              <HalfStepper label="Width" cells={opts.unitsX} max={capX} suffix="u" onChange={(unitsX) => onChange({ unitsX })} />
              <HalfStepper label="Depth" cells={opts.unitsY} max={capY} suffix="u" onChange={(unitsY) => onChange({ unitsY })} />
            </div>
          ) : (
            <div className="row2">
              <Stepper label="Width" value={opts.unitsX} min={1} max={capX} suffix="u" onChange={(unitsX) => onChange({ unitsX })} />
              <Stepper label="Depth" value={opts.unitsY} min={1} max={capY} suffix="u" onChange={(unitsY) => onChange({ unitsY })} />
            </div>
          )}
          {sizeError && <div className="field-error">{sizeError}</div>}
        </>
      )}
      <ContainerTypeField opts={opts} onChange={onChange} />
      {activeContainer(opts) ? (
        <ContainerBody opts={opts} onChange={onChange} cells={cells} contents={contents} half={half} />
      ) : (
        <PlainBinFields opts={opts} onChange={onChange} cells={cells} contents={contents} half={half} />
      )}
    </>
  );
}

/** What the bin is: a plain bin, or a drawer unit, parts box, … (containers/). Hidden until a type is registered. */
function ContainerTypeField({ opts, onChange }: { opts: BinOptions; onChange: (p: Partial<BinOptions>) => void }) {
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

type BodyProps = { opts: BinOptions; onChange: (p: Partial<BinOptions>) => void; cells?: BinCells; contents?: ReactNode; half?: boolean };

/** A container's own fields, its height, contents, and the base it stands on. */
function ContainerBody({ opts, onChange, cells, contents }: BodyProps) {
  const { fmt } = useUnits();
  const active = activeContainer(opts)!;
  const Fields = containerFields(active.def.kind);
  const kind = active.def.kind;
  const setOwn = (patch: Record<string, unknown>) =>
    onChange({ containers: { ...opts.containers, [kind]: { ...(active.opts as Record<string, unknown>), ...patch } } });
  return (
    <>
      <Stepper
        label="Height"
        value={opts.heightUnits}
        min={2}
        max={30}
        suffix="u"
        onChange={(heightUnits) => onChange({ heightUnits })}
        hint={`${fmt(binTotalHeight(opts))} overall`}
      />
      {Fields && <Fields bin={opts} value={active.opts} onChange={setOwn} onBinChange={onChange} cells={cells ?? binCells(opts)} />}
      {contents}
      <OptionGroup title="Base & holes" status={baseStatus(opts)} active={opts.base !== 'standard' || opts.holes !== 'none'}>
        <BaseField opts={opts} onChange={onChange} />
        <HoleFields opts={opts} onChange={onChange} />
      </OptionGroup>
    </>
  );
}

/** A plain bin's fields: height, inside, scoop, labels, and the option groups. */
function PlainBinFields({ opts, onChange, cells, contents, half }: BodyProps) {
  const { fmt } = useUnits();
  return (
    <>
      <HeightField opts={opts} onChange={onChange} cells={cells} />
      <InteriorFields opts={opts} onChange={onChange} cells={cells} />
      <Slider
        label="Finger scoop"
        value={opts.scoop}
        min={0}
        max={1}
        step={0.05}
        format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
        onChange={(scoop) => onChange({ scoop })}
        hint="Curved front wall so small parts slide out. Compartments can override it and the label tab."
      />
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
      <LabelFields opts={opts} onChange={onChange} />
      {contents}
      <OptionGroup title="Base & holes" status={baseStatus(opts)} active={opts.base !== 'standard' || opts.holes !== 'none'}>
        <BaseField opts={opts} onChange={onChange} />
        <HoleFields opts={opts} onChange={onChange} />
        {half && opts.holes !== 'none' && opts.base !== 'flat' && (
          <div className="field-hint">
            Half grid: each 21 mm foot gets one hole, at the corner of its 42 mm unit (Gridfinity Extended&apos;s layout), so
            whole-unit bins also fit magnet baseplates. Partial edge cells get none.
          </div>
        )}
      </OptionGroup>
      <OptionGroup title="Lip & lid" status={lipStatus(opts)} active={!opts.lip || opts.lipStyle !== 'normal' || opts.lipNotches || opts.lid}>
        <LipFields opts={opts} onChange={onChange} cells={cells} />
      </OptionGroup>
      <OptionGroup title="Trays, lids & rails" status={accessoryStatus(opts, fmt, cells)} active={accessoriesActive(opts)}>
        <AccessoryFields opts={opts} onChange={onChange} cells={cells} />
      </OptionGroup>
      <OptionGroup title="Cups & grid inserts" status={insertStatus(opts, cells)} active={insertsActive(opts)}>
        <InsertFields opts={opts} onChange={onChange} cells={cells} />
      </OptionGroup>
      <OptionGroup title="Walls" status={wallStatus(opts)} active={!!(opts.cutoutWalls || opts.slideWalls || opts.patternWalls) || !opts.fillet}>
        <WallFields opts={opts} onChange={onChange} />
        <Toggle label="Rounded inside corners" checked={opts.fillet} onChange={(fillet) => onChange({ fillet })} />
      </OptionGroup>
    </>
  );
}

/**
 * A folding group of bin options. It starts open when anything in it is set
 * away from the defaults, so nothing active is hidden; the summary says what's set.
 */
function OptionGroup({ title, status, active, children }: { title: string; status: string; active: boolean; children: ReactNode }) {
  // Decided once per bin (BinFields is keyed by bin), so turning an option off doesn't snap the group shut.
  const [open] = useState(active);
  return (
    <details className="advanced option-group" open={open || undefined}>
      <summary>
        <span>{title}</span>
        <small>{status}</small>
      </summary>
      {children}
    </details>
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
      const name = `gridfinity-bin-${binUnitsText(job.layout, sel.opts).replace('×', 'x')}x${sel.opts.heightUnits}u`;
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

  return (
    <>
      {sel ? (
        <Section
          title={many ? `${selIds.length} bins selected` : 'Selected bin'}
          aside={
            <button className="link" onClick={() => setUI({ selectedBinId: null })}>
              Done
            </button>
          }
        >
          {many && <p className="muted small">Showing the first bin's settings. Changes apply to all {selIds.length}.</p>}
          {!many && <TooBigNotice bin={sel} layout={job.layout} bed={bed} printerName={printerName} />}
          {!many && <BinChecksNotice bin={sel} layout={job.layout} />}
          <BinFields
            key={sel.id}
            opts={sel.opts}
            onChange={changeSelected}
            sizeEditable={!many}
            sizeError={sizeError}
            cells={binCellsAt(job.layout, sel)}
            contents={!many && <BinContentsFields bin={sel} grid={job.layout} onLabel={(labelText) => changeSelected({ labelText })} />}
            half={half}
            maxX={maxUnitsAlong(job.layout, sel, 'x', bed, half ? MAX_CELLS : 12)}
            maxY={maxUnitsAlong(job.layout, sel, 'y', bed, half ? MAX_CELLS : 12)}
          />
          <div className="button-row">
            <button onClick={() => duplicateSelection()}>Duplicate</button>
            <button onClick={() => setNewBin({ ...sel.opts })} title="New bins you draw will use these settings">
              Use for new bins
            </button>
            <button className="danger" onClick={() => removeSelection()}>
              Delete
            </button>
          </div>
          <button className="primary wide" onClick={() => downloadSelected()} disabled={busy}>
            {busy ? 'Building…' : 'Download this bin (.3mf)'}
          </button>
          <button className="link" onClick={() => downloadSelected('stl')} disabled={busy}>
            Download as STL
          </button>
          <button className="link" onClick={() => downloadSelected('step')} disabled={busy} title="Flat-faced solid for CAD (Fusion 360, FreeCAD, Onshape, SolidWorks)">
            Download as STEP (for CAD)
          </button>
          {hasLid(sel.opts) && !binStretched(job.layout, sel) && (
            <button className="link" onClick={downloadLid} disabled={busy}>
              Download its lid (.3mf)
            </button>
          )}
        </Section>
      ) : (
        <Section title="New bin settings">
          <p className="muted small">
            Drag across empty cells on the grid to draw a bin. Click a bin to edit it, drag it to move, press Delete to remove.
          </p>
          <BinFields opts={newBin} onChange={changeNew} sizeEditable={false} sizeError={sizeError} half={half} />
        </Section>
      )}
      {sel && !many && <StackSection key={`stack-${sel.id}`} job={job} bin={sel} />}
      {sel && !many && <StretchSection key={`stretch-${sel.id}`} layout={job.layout} bin={sel} />}
      {/* Drawer units, parts boxes, … have their own insides. */}
      {sel ? (
        sel.opts.interior === 'compartments' &&
        !activeContainer(sel.opts) && <CompartmentsSection key={sel.id} opts={sel.opts} onChange={changeSelected} binId={sel.id} grid={job.layout} />
      ) : (
        newBin.interior === 'compartments' && !activeContainer(newBin) && <CompartmentsSection opts={newBin} onChange={setNewBin} />
      )}

      <TemplatesSection />
      <ToolLibrary job={job} />

      <Section title="Layout">
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
    </>
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
