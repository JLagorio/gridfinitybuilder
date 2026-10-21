import { useUnits } from '../../state/store';
import { LengthInput, Segmented, Stepper, Toggle } from '../fields';
import { LabelTextField } from '../LabelFields';
import { BOX, BOX_CONTAINER, boxClosedHeight, boxLayout, boxLidHeights, type BoxHinge, type BoxLatch, type BoxOptions, type BoxTextStyle, type BoxTop } from '../../lib/geometry/containers/box';
import { binCells } from '../../lib/geometry/bin';
import { registerContainerFields, type ContainerFieldsProps } from './registry';

const HINGES: { value: BoxHinge; label: string; title: string }[] = [
  { value: 'snap', label: 'Snap-in', title: 'The lid’s rod snaps down into open clips on the box' },
  { value: 'pin', label: 'Filament pin', title: 'Closed rings; push a piece of 1.75 mm filament through from the side' },
];
const LATCHES: { value: BoxLatch; label: string; title: string }[] = [
  { value: 'snap', label: 'Snap tab', title: 'A flexing tab on the front clicks into the lid' },
  { value: 'magnets', label: 'Magnets', title: 'Two 6 × 2 mm magnets in the box and two in the lid' },
  { value: 'none', label: 'None', title: 'The lid just lies shut' },
];
const TOPS: { value: BoxTop; label: string; title: string }[] = [
  { value: 'flat', label: 'Flat', title: 'A flat lid, optionally with text' },
  { value: 'grid', label: 'Grid', title: 'A Gridfinity receptacle per cell, so bins stand on the lid' },
  { value: 'lip', label: 'Stacking lip', title: 'Shaped like a bin’s stacking lip: a bin of the same size stacks on it' },
];
const TEXT_STYLES: { value: BoxTextStyle; label: string }[] = [
  { value: 'engraved', label: 'Engraved' },
  { value: 'raised', label: 'Raised' },
];

/** Parts box: compartments, hinge, latch and lid. */
export function BoxFields({ bin, value: o, onChange, cells }: ContainerFieldsProps<BoxOptions>) {
  const { fmt } = useUnits();
  const c = cells ?? binCells(bin);
  const L = boxLayout(bin, o, c);
  const notes = BOX_CONTAINER.notes?.(bin, o, c) ?? [];
  const inside = L.Hb - L.floorTop;
  const lid = boxLidHeights(o.top);
  const cw = L.cols[0][1] - L.cols[0][0];
  const rd = L.rows[0][1] - L.rows[0][0];

  const hingeHint =
    o.hinge === 'snap'
      ? `The lid’s rod snaps down into ${L.hinge.clips.length} open clips along the back (press the lid’s back edge down onto them); pull it up to take the lid off.`
      : `Closed rings: push a ${fmt(L.W - 1)} piece of ${BOX.hinge.pin} mm filament through from the side; a drop of glue or a melted end keeps it in.`;
  const latchHint =
    o.latch === 'snap'
      ? 'A tab in the front wall clicks into the lid. Lift the lid’s front edge to open it.'
      : o.latch === 'magnets'
        ? 'Glue 6 × 2 mm magnets into the two holes in the rim and the two under the lid, so that each pair attracts.'
        : 'The lid just lies shut.';
  const topHint =
    o.top === 'flat'
      ? `A flat lid, ${fmt(lid.T)} thick.`
      : o.top === 'grid'
        ? 'A Gridfinity receptacle per cell on top, like a baseplate, so bins stand on the closed box.'
        : 'Shaped like a bin’s stacking lip, so a bin of the same size stacks on the closed box.';

  return (
    <>
      <div className="row2">
        <Stepper label="Columns" value={o.divX} min={1} max={BOX.maxDiv} onChange={(divX) => onChange({ divX })} />
        <Stepper label="Rows" value={o.divY} min={1} max={BOX.maxDiv} onChange={(divY) => onChange({ divY })} />
      </div>
      <div className="field-hint">
        {L.cols.length * L.rows.length > 1 ? `${L.cols.length * L.rows.length} compartments ${fmt(cw)} × ${fmt(rd)}` : `One compartment ${fmt(cw)} × ${fmt(rd)}`}
        , {fmt(inside)} deep. Closed, the box is {fmt(boxClosedHeight(bin, o))} tall.
      </div>
      <Toggle
        label="Scoops"
        checked={o.scoops}
        onChange={(scoops) => onChange({ scoops })}
        hint={o.scoops && !L.scoop ? 'The compartments are too small for a scoop.' : 'A curved front wall in every compartment, so small parts slide out.'}
      />
      <LengthInput
        label="Gap under the lid"
        value={o.wallGap}
        min={BOX.minGap}
        max={BOX.maxGap}
        onChange={(wallGap) => onChange({ wallGap })}
        hint="The compartment walls stop this far under the closed lid, so parts can’t creep from one compartment to the next."
      />
      <Segmented label="Hinge" value={o.hinge} options={HINGES} onChange={(hinge) => onChange({ hinge })} hint={hingeHint} />
      <Segmented label="Latch" value={o.latch} options={LATCHES} onChange={(latch) => onChange({ latch })} hint={latchHint} />
      <Segmented label="Lid top" value={o.top} options={TOPS} onChange={(top) => onChange({ top })} hint={topHint} />
      {o.top !== 'grid' ? (
        <div className="indent">
          <LabelTextField
            label="Lid text"
            value={o.labelText}
            onChange={(labelText) => onChange({ labelText })}
            placeholder="M3 screws"
            hint={o.top === 'lip' ? 'Engraved into the floor inside the lip.' : undefined}
          />
          {o.top === 'flat' && o.labelText.trim() && (
            <Segmented label="Text" value={o.labelStyle} options={TEXT_STYLES} onChange={(labelStyle) => onChange({ labelStyle })} />
          )}
        </div>
      ) : (
        <div className="field-hint">Lid text goes on a flat or stacking-lip top.</div>
      )}
      <div className="field-hint">
        The lid prints flat as its own part and opens a little past 110°. Everything prints without supports; the snap rod and the lid over each clip bridge
        a few millimetres.
      </div>
      {notes.map((n) => (
        <div key={n} className="field-error">
          {n[0].toUpperCase() + n.slice(1)}
        </div>
      ))}
    </>
  );
}

registerContainerFields<BoxOptions>('box', BoxFields);
