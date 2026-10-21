import { useUnits } from '../../state/store';
import { LengthInput, Segmented, Select, Slider, Toggle } from '../fields';
import {
  MAGAZINE_ITEMS,
  TAPE_ROLLS,
  channelLayout,
  dispenserNotes,
  findMagazineItem,
  findTapeRoll,
  magazineItemLabel,
  magazineLayout,
  tapeLayout,
  type DispenserOptions,
  type DispenserStyle,
} from '../../lib/geometry/containers/dispenser';
import { registerContainerFields, type ContainerFieldsProps } from './registry';

const STYLES: { value: DispenserStyle; label: string; title: string }[] = [
  { value: 'magazine', label: 'Magazine', title: 'Batteries or coin cells, one at a time from the bottom' },
  { value: 'tape', label: 'Tape roll', title: 'A roll on an axle with a cutting edge' },
  { value: 'channel', label: 'Channels', title: 'Long low channels for zip ties and thin items' },
];
const COUNTS = (n: number) => Array.from({ length: n + 1 }, (_, v) => ({ value: v, label: v ? String(v) : 'Auto' }));

type Props = ContainerFieldsProps<DispenserOptions>;

/** Sidebar fields for a dispenser (geometry: lib/geometry/containers/dispenser.ts). */
function DispenserFields(props: Props) {
  const { bin, value: o, onChange, cells } = props;
  const notes = dispenserNotes(bin, o, cells);
  return (
    <>
      <Segmented label="Dispenses" value={o.style} options={STYLES} onChange={(style) => onChange({ style })} />
      {o.style === 'magazine' ? <MagazineFields {...props} /> : o.style === 'tape' ? <TapeFields {...props} /> : <ChannelFields {...props} />}
      {notes.map((n) => (
        <div key={n} className="field-error">
          {n}
        </div>
      ))}
    </>
  );
}

function MagazineFields({ bin, value: o, onChange, cells }: Props) {
  const { fmt } = useUnits();
  const L = magazineLayout(bin, o, cells);
  const preset = findMagazineItem(o.item);
  const coin = o.shape === 'coin';
  const n = L.xs.length;
  return (
    <>
      <Select
        label="Holds"
        value={preset ? preset.id : 'custom'}
        options={[
          ...MAGAZINE_ITEMS.map((p) => ({ value: p.id, label: p.label, group: p.shape === 'coin' ? 'Coin cells (stacked flat)' : 'Batteries (lying across)' })),
          { value: 'custom', label: 'Custom size', group: 'Custom' },
        ]}
        onChange={(id) => {
          const p = findMagazineItem(id);
          onChange(p ? { item: p.id, shape: p.shape, itemD: p.d, itemL: p.l } : { item: 'custom' });
        }}
        hint={preset?.note}
      />
      {!preset && (
        <>
          <Segmented
            label="Items"
            value={o.shape}
            options={[
              { value: 'cylinder', label: 'Lying across', title: 'Cylinders roll out of the bottom' },
              { value: 'coin', label: 'Stacked flat', title: 'Discs pushed out of the bottom one at a time' },
            ]}
            onChange={(shape) => onChange({ shape })}
          />
          <div className="row2">
            <LengthInput label="Diameter" value={o.itemD} min={3} max={80} onChange={(itemD) => onChange({ itemD })} />
            <LengthInput label={coin ? 'Thickness' : 'Length'} value={o.itemL} min={0.5} max={120} onChange={(itemL) => onChange({ itemL })} />
          </div>
        </>
      )}
      <div className="row2">
        <LengthInput label="Clearance" value={o.clearance} min={0.2} max={4} onChange={(clearance) => onChange({ clearance })} hint="Added to the size." />
        <Segmented label="Columns" value={o.columns} options={COUNTS(4)} onChange={(columns) => onChange({ columns })} />
      </div>
      <Toggle
        label="Tray in front"
        checked={o.tray}
        onChange={(tray) => onChange({ tray })}
        hint={coin ? 'Push the bottom cell out from the finger well behind; it lands in the tray.' : 'The bottom one rolls out onto it and holds back the next.'}
      />
      {o.tray && !coin && (
        <Slider label="Floor slope" value={o.ramp} min={0} max={15} step={1} format={(v) => `${v}°`} onChange={(ramp) => onChange({ ramp })} />
      )}
      <Toggle label="Level window" checked={o.window} onChange={(window) => onChange({ window })} hint="A slot up the front to see what’s left and push them down." />
      <div className="field-hint">
        {n
          ? `${n} column${n === 1 ? '' : 's'} of ${magazineItemLabel(o)}, about ${L.capacity} in each${L.tray ? ' (one in the tray)' : ''}. Refill from the top.`
          : `Needs ${fmt(L.colW + 3.2)} across.`}
      </div>
    </>
  );
}

function TapeFields({ bin, value: o, onChange, cells }: Props) {
  const { fmt } = useUnits();
  const L = tapeLayout(bin, o, cells);
  const preset = findTapeRoll(o.tapePreset);
  const custom = (p: Partial<DispenserOptions>) => onChange({ ...p, tapePreset: 'custom' });
  return (
    <>
      <Select
        label="Roll"
        value={preset ? preset.id : 'custom'}
        options={[...TAPE_ROLLS.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Custom roll' }]}
        onChange={(id) => {
          const p = findTapeRoll(id);
          onChange(p ? { tapePreset: p.id, tapeInner: p.inner, tapeOuter: p.outer, tapeWidth: p.width } : { tapePreset: 'custom' });
        }}
      />
      <div className="row3">
        <LengthInput label="Core" value={o.tapeInner} min={6} max={100} onChange={(tapeInner) => custom({ tapeInner })} hint="Inside diameter." />
        <LengthInput label="Outside" value={o.tapeOuter} min={o.tapeInner + 2} max={200} onChange={(tapeOuter) => custom({ tapeOuter })} />
        <LengthInput label="Width" value={o.tapeWidth} min={3} max={100} onChange={(tapeWidth) => custom({ tapeWidth })} />
      </div>
      <Toggle label="Cutting edge" checked={o.cutter} onChange={(cutter) => onChange({ cutter })} hint="Serrated top on the front wall: pull the tape down over it." />
      <div className="field-hint">
        The axle prints separately, lying on its flat: slide the roll on and drop it into the grooves. Body {fmt(L.top)} tall; a full roll stands{' '}
        {fmt(L.za + o.tapeOuter / 2 - (o.tapeInner / 2 - L.ra))} tall.
      </div>
    </>
  );
}

function ChannelFields({ bin, value: o, onChange, cells }: Props) {
  const { fmt } = useUnits();
  const L = channelLayout(bin, o, cells);
  const n = L.centers.length;
  return (
    <>
      <div className="row2">
        <LengthInput label="Channel width" value={o.channelWidth} min={3} max={150} onChange={(channelWidth) => onChange({ channelWidth })} />
        <Segmented label="Channels" value={o.channels} options={COUNTS(4)} onChange={(channels) => onChange({ channels })} />
      </div>
      <Segmented
        label="Run"
        value={o.along}
        options={[
          { value: 'auto', label: 'Long way' },
          { value: 'y', label: 'Front–back' },
          { value: 'x', label: 'Left–right' },
        ]}
        onChange={(along) => onChange({ along })}
      />
      <Toggle label="Fingertip notch" checked={o.notch} onChange={(notch) => onChange({ notch })} hint="Through the front wall at each channel’s end, to slide items out." />
      <div className="field-hint">
        {n} channel{n === 1 ? '' : 's'}, {fmt(L.width)} wide and {fmt(L.to - L.from)} long, {fmt(L.top - L.floor)} deep.
      </div>
    </>
  );
}

registerContainerFields<DispenserOptions>('dispenser', DispenserFields);
