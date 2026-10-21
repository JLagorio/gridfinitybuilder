import { useMemo } from 'react';
import { useUnits } from '../state/store';
import { LengthInput, Segmented, Stepper, Toggle } from './fields';
import { PocketSettings } from './PocketFields';
import type { BinCells, BinOptions } from '../lib/geometry/bin';
import { insertParts, planInserts, type InsertPartPlan } from '../lib/geometry/cups';
import { CRATE, CUP, SHADOW, wantsInserts, type CupGrip } from '../lib/geometry/insertOptions';
import { isPocketLid, lidPocketOpts, pocketLidHeight, pocketLidLayout } from '../lib/geometry/pocketLid';
import { LID_HEIGHT } from '../lib/geometry/lid';
import { usesToolCompartments } from '../lib/geometry/compartments';
import type { Compartment, CompartmentOptions } from '../lib/dividers';
import { WALL } from '../lib/geometry/spec';
import { Find } from './findContext';

type Props = { opts: BinOptions; onChange: (p: Partial<BinOptions>) => void; cells?: BinCells };
type Fmt = (mm: number) => string;

const GRIPS: { value: CupGrip; label: string; title: string }[] = [
  { value: 'tab', label: 'Pull tab', title: 'A tab rising from the rim to pinch' },
  { value: 'notch', label: 'Finger groove', title: 'A groove down the outside of a wall, to pinch the wall' },
  { value: 'none', label: 'None', title: 'A plain cup' },
];

/** "38 × 35.7 × 19.3, 24.2 × 38 × 33.3" for the distinct sizes of some parts. */
function sizes(parts: InsertPartPlan[], fmt: Fmt, max = 3) {
  const seen = [...new Map(parts.map((p) => [`${p.w}|${p.d}|${p.h}`, p])).values()];
  const text = seen.slice(0, max).map((p) => `${fmt(p.w)} × ${fmt(p.d)} × ${fmt(p.h)}`);
  return text.join(', ') + (seen.length > max ? ', …' : '');
}

/** Folding-group summary: "4 cups · 1 grid". */
export function insertStatus(o: BinOptions, cells?: BinCells): string {
  if (!wantsInserts(o)) return 'none';
  const parts = insertParts(o, cells);
  const n = (slot: string) => parts.filter((p) => p.slot === slot).length;
  const out = [n('cup') && `${n('cup')} cup${n('cup') === 1 ? '' : 's'}`, n('crate') && `${n('crate')} grid${n('crate') === 1 ? '' : 's'}`].filter(Boolean);
  return out.length ? out.join(' · ') : 'none fit';
}

/** True when cups or grids are asked for anywhere (the group starts open). */
export const insertsActive = (o: BinOptions) => wantsInserts(o);

/** Lift-out cups and egg-crate grid inserts for the bin's compartments. */
export function InsertFields({ opts, onChange, cells }: Props) {
  const { fmt } = useUnits();
  const parts = useMemo(() => insertParts(opts, cells), [opts, cells]);
  const plan = useMemo(() => planInserts(opts, cells), [opts, cells]);
  const cups = parts.filter((p) => p.slot === 'cup');
  const grids = parts.filter((p) => p.slot === 'crate');
  if (opts.interior !== 'compartments') return <div className="field-hint">Cups and grid inserts drop into compartments: choose a Compartments interior.</div>;
  const cupHint = opts.cups
    ? cups.length
      ? `${cups.length} cup${cups.length === 1 ? '' : 's'} ${sizes(cups, fmt)}, ${fmt(CUP.clearance)} clear of the walls, rims ${fmt(CUP.headroom)} under the dividers. They print as separate parts and show in the bin.`
      : undefined
    : `A thin-walled cup that lifts out of each compartment, so a whole set of parts comes out at once. Compartments can opt in or out in the compartment editor; L-shaped ones get a cup per rectangle.`;
  const gridHint = opts.crate
    ? grids.length
      ? `${grids.length} grid${grids.length === 1 ? '' : 's'} ${sizes(grids, fmt)}: one printed lattice each, no floor, that drops in and lifts out.`
      : undefined
    : 'A printed egg-crate lattice that drops into each compartment (or the whole bin when it has one), splitting it into small cells you can lift out at once.';
  return (
    <>
      <Find id="cups">
        <Toggle label="A cup in every compartment" checked={opts.cups} onChange={(c) => onChange({ cups: c })} hint={cupHint} />
        {opts.cups && (
          <div className="indent">
            <Segmented
              label="Lift with"
              value={opts.cupGrip}
              options={GRIPS}
              onChange={(cupGrip) => onChange({ cupGrip })}
              hint={
                opts.cupGrip === 'tab'
                  ? 'A tab rises from the back rim (the front, under a label tab); the rest of the rim is a little lower.'
                  : opts.cupGrip === 'notch'
                    ? 'A round groove down the outside of the back wall (the front, under a label tab): pinch the wall there.'
                    : undefined
              }
            />
            <Toggle
              label="Scoop inside"
              checked={opts.cupScoop}
              onChange={(cupScoop) => onChange({ cupScoop })}
              hint="A curved inside front, so screws pour out when you tip the cup."
            />
          </div>
        )}
      </Find>
      <Find id="crate">
        <Toggle label="A grid insert in every compartment" checked={opts.crate} onChange={(crate) => onChange({ crate })} hint={gridHint} />
        {(opts.crate || Object.values(opts.layout?.comps ?? {}).some((c) => c?.crate)) && (
          <div className="indent">
            <div className="row2">
              <Stepper label="Grid columns" value={opts.crateDivX} min={CRATE.minDiv} max={CRATE.maxDiv} onChange={(crateDivX) => onChange({ crateDivX })} />
              <Stepper label="Grid rows" value={opts.crateDivY} min={CRATE.minDiv} max={CRATE.maxDiv} onChange={(crateDivY) => onChange({ crateDivY })} />
            </div>
            <div className="row2">
              <LengthInput
                label="Grid height"
                value={opts.crateHeight}
                min={0}
                max={CRATE.maxHeight}
                allowEmpty
                placeholder="full"
                onChange={(crateHeight) => onChange({ crateHeight })}
                hint="Empty: as deep as the compartment."
              />
              <LengthInput label="Grid walls" value={opts.crateWall} min={CRATE.minWall} max={CRATE.maxWall} onChange={(crateWall) => onChange({ crateWall })} />
            </div>
          </div>
        )}
      </Find>
      {plan.notes.map((n) => (
        <div key={n} className="field-error">
          {n}
        </div>
      ))}
    </>
  );
}

type InsertChoice = 'default' | 'cup' | 'crate' | 'none';

/** A compartment's own choice, from its options. */
function choiceOf(own: CompartmentOptions): InsertChoice {
  if (own.cup === true) return 'cup';
  if (own.crate === true) return 'crate';
  if (own.cup === false || own.crate === false) return 'none';
  return 'default';
}

const CHOICE_PATCH: Record<InsertChoice, Pick<CompartmentOptions, 'cup' | 'crate'>> = {
  default: { cup: undefined, crate: undefined },
  cup: { cup: true, crate: undefined },
  crate: { cup: false, crate: true },
  none: { cup: false, crate: false },
};

/** Cup / grid insert for one open compartment (`comp`, cavity mm), over the bin's setting. */
export function CompartmentInsertField({
  opts,
  cells,
  comp,
  own,
  set,
}: {
  opts: BinOptions;
  cells?: BinCells | null;
  comp: Compartment;
  own: CompartmentOptions;
  set: (p: Pick<CompartmentOptions, 'cup' | 'crate'>) => void;
}) {
  const { fmt } = useUnits();
  // By where they sit: a plain divX × divY bin's parts are keyed by grid position, not by layout key.
  const inside = (p: InsertPartPlan) => {
    const x = p.assembled.x + p.w / 2 - WALL;
    const y = p.assembled.y + p.d / 2 - WALL;
    return comp.rects.some((r) => x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1);
  };
  const parts = useMemo(() => insertParts(opts, cells).filter(inside), [opts, cells, comp]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => planInserts(opts, cells), [opts, cells]);
  const miss = plan.misses.find((m) => m.key === comp.key);
  const bin = opts.cups ? 'cup' : opts.crate ? 'grid' : 'nothing';
  let hint: string | undefined;
  if (parts.length) {
    const what = parts[0].slot === 'cup' ? 'Cup' : 'Grid';
    hint = `${what}${parts.length > 1 ? `s (one per rectangle)` : ''} ${sizes(parts, fmt)}.`;
  } else if (miss) hint = `No ${miss.kind === 'cup' ? 'cup' : 'grid'}: this compartment ${miss.why}.`;
  else if (plan.notes.length) hint = plan.notes[0];
  return (
    <Segmented
      label="Drop-in"
      value={choiceOf(own)}
      options={[
        { value: 'default', label: 'Bin', title: `The bin’s setting (${bin})` },
        { value: 'cup', label: 'Cup', title: 'A lift-out cup' },
        { value: 'crate', label: 'Grid', title: 'An egg-crate grid insert' },
        { value: 'none', label: 'None', title: 'Nothing, whatever the bin says' },
      ]}
      onChange={(v) => set(CHOICE_PATCH[v])}
      hint={hint}
    />
  );
}

/** The stacking lid's top: receptacles, or a pocket grid with its settings. */
export function LidTopFields({ opts, onChange, cells }: Props) {
  const { fmt } = useUnits();
  const pockets = isPocketLid(opts);
  const layout = useMemo(() => (pockets ? pocketLidLayout(opts, cells) : null), [pockets, opts, cells]);
  return (
    <>
      <Segmented
        label="Lid top"
        value={opts.lidStyle}
        options={[
          { value: 'stack', label: 'Stacking', title: 'Receptacles on top: another bin stacks on the lid' },
          { value: 'pockets', label: 'Pocket grid', title: 'A pocket grid on top for bits, batteries…' },
        ]}
        onChange={(lidStyle) => onChange({ lidStyle })}
        hint={
          pockets
            ? `A ${fmt(pocketLidHeight(opts))} lid with a pocket grid on top, so bits or batteries sit on the closed bin. Nothing stacks on it.`
            : `Prints a ${fmt(LID_HEIGHT)} lid that sits in the lip; another bin stacks on top of it.`
        }
      />
      {pockets && (
        <div className="indent">
          <PocketSettings value={lidPocketOpts(opts)} onChange={(p) => onChange({ lidPockets: { ...opts.lidPockets, ...p } })} layout={layout} />
          {opts.lidPockets && (
            <button className="link" onClick={() => onChange({ lidPockets: undefined })}>
              Use the bin’s pocket settings
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** Two-colour shadow board for tool pockets (whole-bin tool cutouts, or tool compartments). */
export function ShadowFloorField({ opts, onChange }: Omit<Props, 'cells'>) {
  const { fmt } = useUnits();
  if (opts.interior !== 'cutouts' && !usesToolCompartments(opts)) return null;
  return (
    <Toggle
      label="Two-colour pocket floors"
      checked={opts.shadowFloor}
      onChange={(shadowFloor) => onChange({ shadowFloor })}
      hint={`Each tool pocket gets a ${fmt(SHADOW.depth)} floor printed in filament 2 (Label filament, under Print), so a missing tool stands out.`}
    />
  );
}
