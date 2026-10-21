/**
 * Sidebar fields for the vase-mode bin (geometry in
 * src/lib/geometry/containers/vase.ts, plates in src/lib/layout/spiral.ts).
 */
import { useStore, useUnits } from '../../state/store';
import { LengthInput, NumberInput, Segmented, Stepper } from '../fields';
import { binCells } from '../../lib/geometry/bin';
import { VASE, VASE_CONTAINER, VASE_LEAVES_OUT, vaseBottomLayers, vaseLayout, vaseLineFor, type VaseAxis, type VaseOptions } from '../../lib/geometry/containers/vase';
import { DEFAULT_NOZZLE } from '../../lib/layout/plan';
import { findPrinter } from '../../lib/printers';
import { registerContainerFields, type ContainerFieldsProps } from './registry';

const AXES: { value: VaseAxis; label: string; title: string }[] = [
  { value: 'x', label: 'Side by side', title: 'Dividers run front to back, folded in from slits in the back wall' },
  { value: 'y', label: 'Front to back', title: 'Dividers run side to side, folded in from slits in the right wall' },
];

const mm = (v: number) => `${Math.round(v * 100) / 100} mm`;

/** Vase-mode bin: dividers, the wall's line width, the floor, and what the slicer needs. */
export function VaseFields({ bin, value: o, onChange, cells }: ContainerFieldsProps<VaseOptions>) {
  const { fmt } = useUnits();
  const nozzle = useStore((s) => s.setup.nozzle ?? DEFAULT_NOZZLE);
  const clearance = useStore((s) => findPrinter(s.setup.printerId).sequential);
  const c = cells ?? binCells(bin);
  const L = vaseLayout(bin, o, c);
  const notes = VASE_CONTAINER.notes?.(bin, o, c) ?? [];
  const best = vaseLineFor(nozzle);
  const n = L.dividers.length;
  const from = o.axis === 'x' ? 'back' : 'right';
  const to = o.axis === 'x' ? 'front' : 'left';

  return (
    <>
      <Stepper
        label="Dividers"
        value={o.dividers}
        min={0}
        max={VASE.maxDividers}
        onChange={(dividers) => onChange({ dividers })}
        hint={
          n
            ? `${n + 1} sections ${fmt(L.sections[0])} wide. Each divider is the wall folded in through a thin slit in the ${from} wall: two lines, joined where they meet the ${to} wall.`
            : `Walls folded in through thin slits in the ${from} wall, so the one spiral line prints them too.`
        }
      />
      {o.dividers > 0 && (
        <Segmented
          label="Sections"
          value={o.axis}
          options={AXES}
          onChange={(axis) => onChange({ axis })}
          hint="Dividers run one way only: slits that crossed would cut the bin apart."
        />
      )}
      <NumberInput
        label="Wall line"
        value={o.line}
        min={VASE.line.min}
        max={VASE.line.max}
        step={0.05}
        onChange={(line) => onChange({ line })}
        hint={
          <>
            The whole wall is this one line; wider is stiffer. {mm(best)} suits the {nozzle} mm nozzle
            {Math.abs(o.line - best) > 1e-6 && (
              <>
                {' '}
                (
                <button className="link" onClick={() => onChange({ line: best })}>
                  use it
                </button>
                )
              </>
            )}
            . The part is drawn for it (feet two lines thick, the slits’ ends), and the Bambu Studio project prints with it; in other slicers set the
            wall (external perimeter) line width to it.
          </>
        }
      />
      <LengthInput
        label={L.feet ? 'Foot floors' : 'Floor'}
        value={o.floor}
        min={VASE.floor.min}
        max={VASE.floor.max}
        onChange={(floor) => onChange({ floor })}
        hint={L.feet ? 'The bottom of each hollow foot.' : 'The flat bottom, printed as the bottom layers.'}
      />
      <div className="field-hint">
        <b>Slicer:</b> spiral vase on, 1 wall, no top layers, 0 % infill, no supports, and bottom layers up to {mm(L.start)} (
        {vaseBottomLayers(L.start, 0.2)} at 0.2 mm{L.feet ? ': the hollow feet print as bottom layers' : ''}), wall line {mm(o.line)}. The Bambu
        Studio project sets this up for its vase plates; the other exports say so in their names and README. Vase bins get plates of their own:
        {clearance
          ? ` on this printer several share one, printed one after another and spaced for the gantry, if they're under ${mm(clearance.rod - 1)} tall; taller ones print alone.`
          : ' one bin per plate (PrusaSlicer prints only one object in spiral vase mode).'}
      </div>
      <div className="field-hint">{VASE_LEAVES_OUT}</div>
      {notes.map((t) => (
        <div key={t} className="field-error">
          {t[0].toUpperCase() + t.slice(1)}
        </div>
      ))}
    </>
  );
}

registerContainerFields<VaseOptions>('vase', VaseFields);
