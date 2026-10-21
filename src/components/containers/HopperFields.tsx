import { useUnits } from '../../state/store';
import { LengthInput, Segmented, Slider, Stepper, Toggle } from '../fields';
import { LabelTextField } from '../LabelFields';
import { HOPPER, HOPPER_CONTAINER, hopperLayout, type HopperLabel, type HopperOptions } from '../../lib/geometry/containers/hopper';
import { binCells } from '../../lib/geometry/bin';
import { registerContainerFields, type ContainerFieldsProps } from './registry';

const LABELS: { value: HopperLabel; label: string; title: string }[] = [
  { value: 'none', label: 'None', title: 'A plain front lip' },
  { value: 'slot', label: 'Card slot', title: 'A pocket with a window for a paper or card label, slid in from the top' },
  { value: 'text', label: 'Text', title: 'Raised text across the front lip' },
];

const deg = (v: number) => `${Math.round(v)}°`;

/** Hopper bin: front lip, opening, floor, dividers, lip and label. */
export function HopperFields({ bin, value: o, onChange, cells }: ContainerFieldsProps<HopperOptions>) {
  const { fmt } = useUnits();
  const c = cells ?? binCells(bin);
  const L = hopperLayout(bin, o, c);
  const notes = HOPPER_CONTAINER.notes?.(bin, o, c) ?? [];
  const sections = L.sections.length;
  const width = L.sections[0][1] - L.sections[0][0];

  const lipHint = o.lip
    ? `A lintel across the top of the front closes the lip all round, so a bin stacks on top and the opening stays reachable. Its underside is a 45° roof that starts as a ${fmt(L.bridge)} bridge across ${L.dividers.length ? 'each section' : 'the bin'}.`
    : 'Off: the top is open and the side walls slope down to the front lip.';
  const slotHint =
    o.label === 'slot'
      ? `A pocket with a window on the front lip${sections > 1 ? ' of each section' : ''} for a paper label about ${fmt(Math.max(0, width - 2 * HOPPER.slot.margin))} × ${fmt(Math.max(0, L.zLip - L.zLabel))}, slid in from the top. Text (one line per section) is engraved behind it, so it shows without a card.`
      : o.label === 'text'
        ? 'Raised from a recess across the front lip, flush with the front.'
        : undefined;

  return (
    <>
      <LengthInput
        label="Front lip"
        value={o.front}
        min={HOPPER.minFront}
        max={HOPPER.maxFront}
        onChange={(front) => onChange({ front })}
        hint="How high the front lip rises above the floor at the front; it keeps parts in."
      />
      <Slider
        label="Opening angle"
        value={o.angle}
        min={HOPPER.minAngle}
        max={HOPPER.maxAngle}
        step={1}
        format={deg}
        onChange={(angle) => onChange({ angle })}
        hint={`The opening’s edge rises from the front lip toward the back at this angle (90° = straight up).${o.lip ? ' Under the lintel it meets a 45° roof.' : ''}`}
      />
      <Slider
        label="Floor slope"
        value={o.slope}
        min={0}
        max={HOPPER.maxSlope}
        step={1}
        format={deg}
        onChange={(slope) => onChange({ slope })}
        hint={`The floor runs down to the front so parts slide to the opening: ${fmt(L.rise)} higher at the back.`}
      />
      <Stepper
        label="Dividers"
        value={o.dividers}
        min={0}
        max={HOPPER.maxDividers}
        onChange={(dividers) => onChange({ dividers })}
        hint={sections > 1 ? `${sections} sections ${fmt(width)} wide.` : 'Walls across the width, each section a small hopper.'}
      />
      <Toggle label="Stacking lip" checked={o.lip} onChange={(lip) => onChange({ lip })} hint={lipHint} />
      <Segmented label="Label" value={o.label} options={LABELS} onChange={(label) => onChange({ label })} hint={slotHint} />
      {o.label !== 'none' && (
        <div className="indent">
          <LabelTextField
            label={o.label === 'slot' ? 'Text behind the cards' : 'Label text'}
            value={o.labelText}
            onChange={(labelText) => onChange({ labelText })}
            placeholder={o.label === 'slot' && sections > 1 ? 'M3\nM4' : 'M3 nuts'}
          />
        </div>
      )}
      {notes.map((n) => (
        <div key={n} className="field-error">
          {n[0].toUpperCase() + n.slice(1)}
        </div>
      ))}
    </>
  );
}

registerContainerFields<HopperOptions>('hopper', HopperFields);
