import { useState } from 'react';
import { useStore, useUnits } from '../state/store';
import type { GridLayout } from '../lib/layout/drawer';
import { HEIGHT_UNIT, LIP_SUPPORT_HEIGHT, BASE_HEIGHT } from '../lib/geometry/spec';
import { removableInserts, type BinOptions, type LabelStyle } from '../lib/geometry/bin';
import { LabelTextField } from './LabelFields';
import { binCellsAt } from '../lib/project';
import {
  MIN_GAP,
  PRESETS,
  compartmentByKey,
  distributeEvenly,
  makeRatio,
  parseRatio,
  removeWall,
  resolveLayout,
  setCompartmentOptions,
  setWallGap,
  setWallProps,
  splitByMinSize,
  splitCompartment,
  wallGaps,
  type DividerLayout,
  type Orient,
  type Preset,
  type SplitResult,
} from '../lib/dividers';
import { LengthInput, Section, Segmented, Slider, Stepper, Toggle } from './fields';
import { clearInteriorSelection, compartmentOptions, interiorOf, useBinInterior, useInteriorSelection, type BinInterior } from './interiorState';
import { binCompartmentPockets } from '../lib/geometry/bin';
import { binBodyHeight, binFloorZ, sanitizePocketFields } from '../lib/geometry/variants';
import { PocketSettings } from './PocketFields';
import { compartmentFloorShape, compartmentPocketOpts, defaultFloorRise } from '../lib/geometry/compartments';
import {
  MAX_TIERS,
  MIN_TIERS,
  type Compartment,
  type CompartmentInside,
  type CompartmentOptions,
  type FloorHigh,
} from '../lib/dividers';
import { FreeWallFields, WallFinishFields } from './WallTools';
import { CompartmentInsertField } from './InsertFields';

/**
 * Sidebar section for a bin's compartments: the quick columns × rows split,
 * presets, auto-divide, and the options of the wall or compartment selected in
 * the compartment editor. Without `binId` it edits the settings for new bins
 * (no size yet, so only ratio-based tools).
 */
export function CompartmentsSection({
  opts,
  onChange,
  binId,
  grid,
}: {
  opts: BinOptions;
  onChange: (p: Partial<BinOptions>) => void;
  binId?: string;
  grid?: GridLayout;
}) {
  const placed = useBinInterior(binId ?? null, grid ?? null);
  const info = placed ?? interiorOf(opts);
  const sel = useInteriorSelection(binId ?? null, info.resolved);
  const pane = useStore((s) => s.ui.binPane);
  const setUI = useStore((s) => s.setUI);
  const updateBin = useStore((s) => s.updateBin);
  const n = info.resolved.compartments.length;
  // Whole-layout changes (columns × rows, presets) go through onChange, which may cover several selected bins.
  const setLayout = (layout: DividerLayout | null, extra: Partial<BinOptions> = {}) => onChange({ layout, ...extra });
  // Edits that refer to this bin's own walls and compartments only apply to it.
  const setOwn = (layout: DividerLayout) => (binId ? updateBin(binId, { opts: { layout } }) : onChange({ layout }));

  return (
    <Section
      title="Compartments"
      aside={
        binId ? (
          <button className="link" onClick={() => setUI({ binPane: pane === 'compartments' ? 'drawer' : 'compartments' })}>
            {pane === 'compartments' ? 'Show drawer' : 'Edit walls'}
          </button>
        ) : undefined
      }
    >
      <div className="row2">
        <Stepper label="Columns" value={opts.divX} min={1} max={12} onChange={(divX) => onChange({ divX, layout: null })} />
        <Stepper label="Rows" value={opts.divY} min={1} max={12} onChange={(divY) => onChange({ divY, layout: null })} />
      </div>
      {info.custom ? (
        <div className="field-hint">
          Custom layout · {n} compartment{n === 1 ? '' : 's'}. Columns and rows replace it.{' '}
          <button className="link" onClick={() => setLayout(null)}>
            Back to {opts.divX} × {opts.divY}
          </button>
        </div>
      ) : (
        binId &&
        pane !== 'compartments' && (
          <div className="field-hint">
            For any other layout,{' '}
            <button className="link" onClick={() => setUI({ binPane: 'compartments' })}>
              draw walls
            </button>{' '}
            or start from a preset.
          </div>
        )
      )}
      <PresetPicker
        opts={opts}
        info={info}
        onPick={(p) =>
          setLayout(p.layout, p.defaults ? { scoop: p.defaults.scoop ?? opts.scoop, label: p.defaults.label ?? opts.label } : {})
        }
      />
      <AutoDivide info={info} compKey={sel.compKey} sized={!!binId} onLayout={(l, whole) => (whole ? setLayout(l) : setOwn(l))} />
      {binId && sel.freeId && <FreeWallFields info={info} freeId={sel.freeId} onLayout={setOwn} />}
      {binId && sel.wallId && <WallFields info={info} wallId={sel.wallId} onLayout={setOwn} />}
      {binId && sel.compKey && <CompartmentFields info={info} compKey={sel.compKey} onLayout={setOwn} />}
      {binId && !sel.wallId && !sel.compKey && !sel.freeId && pane === 'compartments' && (
        <p className="muted small">Click a wall or a compartment’s size label to edit it here.</p>
      )}
      {binId && <InsertSummary opts={opts} grid={grid} binId={binId} />}
    </Section>
  );
}

function PresetPicker({ opts, info, onPick }: { opts: BinOptions; info: BinInterior; onPick: (p: Preset) => void }) {
  const aspect = info.size.d / info.size.w;
  return (
    <div className="field">
      <span className="field-label">Presets</span>
      <div className="preset-grid">
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className="preset-btn" title={p.hint} onClick={() => onPick(p)}>
            <LayoutThumb layout={p.layout} aspect={aspect} />
            <span>{p.name}</span>
          </button>
        ))}
      </div>
      {opts.layout && <div className="field-hint">A preset replaces the current walls.</div>}
    </div>
  );
}

/** Tiny drawing of a layout, for preset buttons. */
function LayoutThumb({ layout, aspect }: { layout: DividerLayout; aspect: number }) {
  const W = 60;
  const D = Math.max(18, Math.min(60, W * aspect));
  const r = resolveLayout(layout, W, D);
  return (
    <svg className="layout-thumb" viewBox={`-2 -2 ${W + 4} ${D + 4}`} aria-hidden>
      <rect x={0} y={0} width={W} height={D} rx={3} />
      {r.walls.map((w) =>
        w.orient === 'v' ? (
          <line key={w.id} x1={w.pos} x2={w.pos} y1={D - w.start} y2={D - w.end} />
        ) : (
          <line key={w.id} x1={w.start} x2={w.end} y1={D - w.pos} y2={D - w.pos} />
        ),
      )}
    </svg>
  );
}

type DivideMode = 'equal' | 'ratio' | 'min';

function AutoDivide({
  info,
  compKey,
  sized,
  onLayout,
}: {
  info: BinInterior;
  compKey: string | null;
  sized: boolean;
  /** `whole`: the split replaces the whole bin's layout. */
  onLayout: (l: DividerLayout, whole: boolean) => void;
}) {
  const [mode, setMode] = useState<DivideMode>('equal');
  const [orient, setOrient] = useState<Orient>('v');
  const [count, setCount] = useState(3);
  const [ratio, setRatio] = useState('1:2:1');
  const [min, setMin] = useState(30);
  const [error, setError] = useState<string | null>(null);
  const { fmt } = useUnits();
  const n = info.resolved.compartments.length;
  // A selected compartment is split; otherwise the whole bin (replacing its walls when it has several compartments).
  const target = compKey ?? (n === 1 ? info.resolved.compartments[0]?.key : null);
  const base: DividerLayout = target ? info.layout : { walls: [] };
  const apply = () => {
    let res: SplitResult;
    if (mode === 'equal') res = splitCompartment(base, info.size, target, orient, Array(count).fill(1));
    else if (mode === 'ratio') {
      const parts = parseRatio(ratio);
      if (!parts) {
        setError('Type sizes like 1:2:1.');
        return;
      }
      res = splitCompartment(base, info.size, target, orient, parts);
    } else res = splitByMinSize(base, info.size, target, orient, min);
    if (res.error !== undefined) setError(res.error);
    else {
      setError(null);
      onLayout(res.layout, !compKey);
    }
  };
  return (
    <div className="cf-block">
      <div className="cf-head">
        <span>Divide</span>
        <small>{compKey ? 'selected compartment' : n === 1 ? 'whole bin' : 'whole bin (replaces walls)'}</small>
      </div>
      <Segmented
        value={mode}
        options={[
          { value: 'equal', label: 'Equal' },
          { value: 'ratio', label: 'Ratio' },
          { value: 'min', label: 'Min size', title: sized ? 'As many as fit' : 'Needs a bin size: select a bin' },
        ]}
        onChange={(m) => {
          setMode(m);
          setError(null);
        }}
      />
      <div className="cf-row">
        <Segmented
          value={orient}
          options={[
            { value: 'v', label: 'Columns' },
            { value: 'h', label: 'Rows' },
          ]}
          onChange={setOrient}
        />
        {mode === 'equal' && <Stepper label="Parts" value={count} min={2} max={12} onChange={setCount} />}
        {mode === 'ratio' && (
          <label className="cf-inline">
            <span className="field-label">Sizes</span>
            <div className="input-wrap">
              <input value={ratio} onChange={(e) => setRatio(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} placeholder="1:2:1" />
            </div>
          </label>
        )}
        {mode === 'min' && <LengthInput label="Each at least" value={min} min={MIN_GAP} max={500} onChange={setMin} />}
      </div>
      <button type="button" onClick={apply} disabled={mode === 'min' && !sized}>
        {mode === 'min' ? `Split, each ≥ ${fmt(min)}` : mode === 'ratio' ? `Split ${ratio}` : `Split into ${count}`}
      </button>
      {error && <div className="field-error">{error}</div>}
    </div>
  );
}

function innerHeight(o: BinOptions) {
  const H = HEIGHT_UNIT * o.heightUnits;
  return (o.lip ? H - LIP_SUPPORT_HEIGHT : H) - BASE_HEIGHT;
}

function WallFields({ info, wallId, onLayout }: { info: BinInterior; wallId: string; onLayout: (l: DividerLayout) => void }) {
  const { fmt } = useUnits();
  const r = info.resolved;
  const W = r.byId.get(wallId);
  const g = wallGaps(r, wallId);
  if (!W || !g) return null;
  const [loName, hiName] = W.orient === 'v' ? ['Left gap', 'Right gap'] : ['Front gap', 'Back gap'];
  const pos = W.wall.pos;
  const maxLower = Math.max(0, Math.floor(innerHeight(info.opts) - 2));
  const sideWord = (side: 'lo' | 'hi') => (W.orient === 'v' ? (side === 'lo' ? 'left' : 'right') : side === 'lo' ? 'front' : 'back');
  return (
    <div className="cf-block">
      <div className="cf-head">
        <span>{W.orient === 'v' ? 'Front-to-back wall' : 'Side-to-side wall'}</span>
        <small>{fmt(W.end - W.start)} long</small>
      </div>
      <div className="row2">
        <LengthInput label={loName} value={round(g.loGap)} min={MIN_GAP} max={2000} onChange={(mm) => onLayout(setWallGap(info.layout, info.size, wallId, 'lo', mm))} />
        <LengthInput label={hiName} value={round(g.hiGap)} min={MIN_GAP} max={2000} onChange={(mm) => onLayout(setWallGap(info.layout, info.size, wallId, 'hi', mm))} />
      </div>
      <div className="field-hint">
        {pos.kind === 'ratio' ? (
          <>Stays at {Math.round(pos.t * 1000) / 10}% between its neighbours when things move. Type a gap to fix it.</>
        ) : (
          <>
            Fixed {fmt(pos.mm)} from the {sideWord(pos.from)}.{' '}
            <button className="link" onClick={() => onLayout(makeRatio(info.layout, info.size, wallId))}>
              Make proportional
            </button>
          </>
        )}
      </div>
      <Segmented
        label="Height"
        value={W.lower > 0 ? 'low' : 'full'}
        options={[
          { value: 'full', label: 'Full' },
          { value: 'low', label: 'Lowered', title: 'Lower it so fingers reach over' },
        ]}
        onChange={(v) =>
          // Default to half the wall's height.
          onLayout(setWallProps(info.layout, wallId, { lower: v === 'low' ? Math.max(1, Math.min(maxLower, Math.round(innerHeight(info.opts) / 2))) : 0 }))
        }
      />
      {W.lower > 0 && (
        <LengthInput
          label="Lowered by"
          value={W.lower}
          min={0.5}
          max={maxLower}
          onChange={(mm) => onLayout(setWallProps(info.layout, wallId, { lower: mm }))}
          hint={`Top ${fmt(Math.max(0, innerHeight(info.opts) - Math.min(W.lower, maxLower)))} above the floor.`}
        />
      )}
      <Toggle
        label="Removable"
        checked={W.removable}
        onChange={(removable) => onLayout(setWallProps(info.layout, wallId, { removable }))}
        hint={W.removable ? 'Prints as a separate plate that slides into slots.' : 'Slide-in plate instead of a fixed wall.'}
      />
      <WallFinishFields info={info} wallId={wallId} onLayout={onLayout} />
      <div className="button-row">
        <button onClick={() => onLayout(distributeEvenly(info.layout, info.size, wallId))} title="Space this wall and its neighbours in the row evenly">
          Distribute evenly
        </button>
        <button
          className="danger"
          onClick={() => {
            onLayout(removeWall(info.layout, info.size, wallId));
            clearInteriorSelection();
          }}
        >
          Delete wall
        </button>
      </div>
    </div>
  );
}

const LABELS: { value: LabelStyle | 'default'; label: string }[] = [
  { value: 'default', label: 'Bin' },
  { value: 'none', label: 'None' },
  { value: 'full', label: 'Full' },
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Mid' },
  { value: 'right', label: 'Right' },
];

const INSIDES: { value: CompartmentInside; label: string; title: string }[] = [
  { value: 'open', label: 'Open', title: 'An empty compartment' },
  { value: 'pockets', label: 'Pockets', title: 'Filled up to the pocket depth, with a grid of pockets for batteries, bits, cards…' },
  { value: 'tools', label: 'Tools', title: 'Filled solid, with the bin’s tool cutouts cut into it' },
  { value: 'solid', label: 'Solid', title: 'Filled flat to the top: a blank or a spacer' },
];

type CompartmentPatch = Parameters<typeof setCompartmentOptions>[2];

function CompartmentFields({ info, compKey, onLayout }: { info: BinInterior; compKey: string; onLayout: (l: DividerLayout) => void }) {
  const { fmt } = useUnits();
  const c = compartmentByKey(info.resolved, compKey);
  if (!c) return null;
  const own = info.layout.comps?.[compKey] ?? {};
  const eff = compartmentOptions(info, compKey);
  const set = (patch: CompartmentPatch) => onLayout(setCompartmentOptions(info.layout, compKey, patch));
  const depth = innerHeight(info.opts);
  const maxFloor = Math.max(0, Math.floor(depth - 2));
  const open = eff.inside === 'open';
  return (
    <div className="cf-block">
      <div className="cf-head">
        <span>Compartment</span>
        <small>
          {fmt(c.bounds.x1 - c.bounds.x0, { unit: false })} × {fmt(c.bounds.y1 - c.bounds.y0)}
          {c.isRect ? '' : ' (L-shaped)'}
        </small>
      </div>
      <Segmented label="Inside" value={eff.inside} options={INSIDES} onChange={(v) => set({ inside: v === 'open' ? undefined : v })} />
      {eff.inside === 'pockets' && <CompartmentPocketFields info={info} c={c} own={own} set={set} />}
      {eff.inside === 'tools' && <ToolsHint info={info} c={c} />}
      {eff.inside === 'solid' && <div className="field-hint">Filled flat to the top: a blank, or a spacer for something that sits on it.</div>}
      {open && (
        <>
          <Slider
            label={own.scoop === undefined ? 'Finger scoop (bin setting)' : 'Finger scoop'}
            value={eff.scoop}
            min={0}
            max={1}
            step={0.05}
            format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
            onChange={(scoop) => set({ scoop })}
          />
          <Segmented label="Label tab" value={own.label ?? 'default'} options={LABELS} onChange={(v) => set({ label: v === 'default' ? undefined : v })} />
          {eff.label !== 'none' && (
            <LabelTextField
              label="Label text"
              value={own.labelText ?? ''}
              placeholder={info.opts.labelText.trim() ? `${info.opts.labelText.split('\n')[0]} (bin text)` : 'e.g. M3 × 8'}
              onChange={(t) => set({ labelText: t.trim() ? t : undefined })}
            />
          )}
        </>
      )}
      {(open || eff.inside === 'pockets') && (
        <LengthInput
          label="Raise floor"
          value={own.floor ?? 0}
          min={0}
          max={maxFloor}
          allowEmpty
          onChange={(mm) => set({ floor: mm > 0 ? mm : undefined })}
          hint={open ? `${fmt(Math.max(0, depth - (own.floor ?? 0)))} deep` : 'The pockets start this far above the bin’s floor.'}
        />
      )}
      {open && <FloorShapeFields info={info} own={own} set={set} />}
      {open && info.opts.interior === 'compartments' && <CompartmentInsertField opts={info.opts} cells={info.cells} comp={c} own={own} set={set} />}
      {Object.keys(own).length > 0 && (
        <button className="link" onClick={() => set(Object.fromEntries(Object.keys(own).map((k) => [k, undefined])))}>
          Use the bin’s settings
        </button>
      )}
    </div>
  );
}

/** Usable depth above the bin's floor (to the top of the infill). */
function binDepth(o: BinOptions) {
  return binBodyHeight(o) - (o.lip ? LIP_SUPPORT_HEIGHT : 0) - binFloorZ(o);
}

const HIGH_SIDES: { value: FloorHigh; label: string }[] = [
  { value: 'back', label: 'Back' },
  { value: 'front', label: 'Front' },
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];
const LOW_SIDE: Record<FloorHigh, string> = { back: 'front', front: 'back', left: 'right', right: 'left' };

/** Flat, ramp or steps, for an open compartment. */
function FloorShapeFields({ info, own, set }: { info: BinInterior; own: CompartmentOptions; set: (p: CompartmentPatch) => void }) {
  const { fmt } = useUnits();
  const depth = binDepth(info.opts) - (own.floor ?? 0);
  const kind = own.floorShape ?? 'flat';
  const shape = compartmentFloorShape(own, depth);
  const high = own.floorHigh ?? 'back';
  const maxRise = Math.max(0.5, Math.floor((depth - 2) * 10) / 10);
  let hint = 'Not deep enough for a shaped floor.';
  if (shape?.kind === 'ramp') hint = `Slopes up ${fmt(shape.rise)} toward the ${high}, so parts slide to the ${LOW_SIDE[high]}.`;
  else if (shape) hint = `${shape.tiers} steps, ${fmt(shape.rise / (shape.tiers - 1))} apart, rising toward the ${high}.`;
  return (
    <>
      <Segmented
        label="Floor"
        value={kind}
        options={[
          { value: 'flat', label: 'Flat' },
          { value: 'ramp', label: 'Ramp', title: 'A sloped floor: parts slide toward the low side (and the scoop)' },
          { value: 'tiers', label: 'Steps', title: 'A stepped floor, like stadium seating' },
        ]}
        onChange={(v) =>
          set(
            v === 'flat'
              ? { floorShape: undefined }
              : { floorShape: v, floorRise: own.floorRise ?? defaultFloorRise(depth), tiers: v === 'tiers' ? (own.tiers ?? 3) : own.tiers },
          )
        }
      />
      {kind !== 'flat' && (
        <div className="indent">
          <Segmented label="Rises toward" value={high} options={HIGH_SIDES} onChange={(v) => set({ floorHigh: v === 'back' ? undefined : v })} />
          <div className="row2">
            <LengthInput
              label={kind === 'tiers' ? 'Top step' : 'Rise'}
              value={shape?.rise ?? own.floorRise ?? 0}
              min={0.5}
              max={maxRise}
              onChange={(floorRise) => set({ floorRise })}
            />
            {kind === 'tiers' && <Stepper label="Steps" value={own.tiers ?? 3} min={MIN_TIERS} max={MAX_TIERS} onChange={(tiers) => set({ tiers })} />}
          </div>
          <div className="field-hint">{hint}</div>
        </div>
      )}
    </>
  );
}

/** Pocket settings of a pocket compartment (over the bin's), with the count that fits. */
function CompartmentPocketFields({ info, c, own, set }: { info: BinInterior; c: Compartment; own: CompartmentOptions; set: (p: CompartmentPatch) => void }) {
  const opts = sanitizePocketFields(compartmentPocketOpts(info.opts, own));
  const layouts = binCompartmentPockets(info.opts, info.cells, c);
  // An L-shaped compartment gets a grid per rectangle; the summary covers the first, the note the total.
  const count = layouts.reduce((t, L) => t + L.centers.length, 0);
  const note = layouts.length > 1 ? `${count} pockets in all, across ${layouts.length} parts of this compartment.` : undefined;
  return (
    <div className="indent">
      <PocketSettings value={opts} onChange={(p) => set({ pockets: { ...own.pockets, ...p } })} layout={layouts[0] ?? null} note={note} />
      {own.pockets && (
        <button className="link" onClick={() => set({ pockets: undefined })}>
          Use the bin’s pocket settings
        </button>
      )}
    </div>
  );
}

/** Where the tools of a tool compartment come from. */
function ToolsHint({ info, c }: { info: BinInterior; c: Compartment }) {
  const setUI = useStore((s) => s.setUI);
  // Tool centers are bin-centered; compartments are in cavity mm.
  const n = (info.opts.cutouts ?? []).filter((t) =>
    c.rects.some((r) => {
      const x = t.x + info.size.w / 2;
      const y = t.y + info.size.d / 2;
      return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
    }),
  ).length;
  return (
    <div className="field-hint">
      Filled to the top; the bin’s tool cutouts are cut only inside this compartment ({n} tool{n === 1 ? '' : 's'} here now).{' '}
      <button className="link" onClick={() => setUI({ binPane: 'cutouts' })}>
        Lay out tools
      </button>{' '}
      in the Tool cutouts pane; their pocket settings are in the Tool library section.
    </div>
  );
}

function InsertSummary({ opts, grid, binId }: { opts: BinOptions; grid?: GridLayout; binId: string }) {
  const { fmt } = useUnits();
  const bin = useStore((s) => s.bins.find((b) => b.id === binId));
  if (!opts.layout || !opts.layout.walls.some((w) => w.removable) || !bin) return null;
  const inserts = removableInserts(opts, grid ? binCellsAt(grid, bin) : undefined);
  if (!inserts.length) return null;
  return (
    <div className="field-hint">
      {inserts.length} removable plate{inserts.length === 1 ? '' : 's'}:{' '}
      {inserts.map((p) => `${fmt(p.length, { unit: false })} × ${fmt(p.height)}`).join(', ')}
    </div>
  );
}

const round = (v: number) => Math.round(v * 1000) / 1000;
