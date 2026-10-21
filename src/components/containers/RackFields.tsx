import { useEffect, useId, useState } from 'react';
import { useUnits } from '../../state/store';
import { Field, LengthInput, Segmented, Select, Slider, Toggle } from '../fields';
import { formatSizeList, parseSizeList, sizeLabelText } from '../../lib/geometry/pocketPresets';
import { HEIGHT_UNIT } from '../../lib/geometry/spec';
import {
  RACK,
  RACK_PRESETS,
  findRackPreset,
  rackLayout,
  rackNotes,
  rackPresetFields,
  wrenchHead,
  type RackOptions,
  type RackStyle,
} from '../../lib/geometry/containers/rack';
import { registerContainerFields, type ContainerFieldsProps } from './registry';

const STYLES: { value: RackStyle; label: string; title: string }[] = [
  { value: 'drivers', label: 'Drivers & keys', title: 'Screwdrivers, hex keys and files: shafts down through holes, handles on top' },
  { value: 'pliers', label: 'Pliers', title: 'Jaws down in slots, handles standing up' },
  { value: 'wrenches', label: 'Wrenches', title: 'Heads down in leaning slots on steps' },
];

const SIZE_LABEL: Record<RackStyle, string> = { drivers: 'Shaft diameters', pliers: 'Jaw thicknesses', wrenches: 'Wrench sizes' };
const ROWS = [0, 1, 2, 3, 4].map((v) => ({ value: v, label: v ? String(v) : 'Auto', title: v ? undefined : 'As many per row as fit' }));

/** Sidebar fields for a tool rack (geometry: lib/geometry/containers/rack.ts). */
function RackFields({ bin, value: o, onChange, onBinChange, cells }: ContainerFieldsProps<RackOptions>) {
  const { fmt } = useUnits();
  const L = rackLayout(bin, o, cells);
  const notes = rackNotes(bin, o, cells);
  const preset = findRackPreset(o.preset);
  /** An edit to what the rack holds: no longer the preset. */
  const custom = (p: Partial<RackOptions>) => onChange({ ...p, preset: 'custom' });
  const presets = RACK_PRESETS.filter((p) => p.style === o.style);
  const hex = o.style === 'drivers' && o.hole === 'hex';
  // When steps or holes are cut short (rackNotes warns), the height that gives full-depth holes in the front row and full steps.
  const rows = Math.max(1, L.rows.length);
  const deep = o.depth * Math.cos((o.tilt * Math.PI) / 180);
  const shallow = L.places.length ? Math.min(...L.places.map((p) => p.dz)) : 0;
  const short = L.places.length > 0 && ((rows > 1 && L.step + 0.05 < o.step) || shallow + 0.5 < Math.min(deep, 15));
  const units = short ? Math.min(30, Math.ceil((L.floor + deep + (rows - 1) * o.step) / HEIGHT_UNIT - 1e-6)) : 0;
  const biggest = o.sizes.length ? Math.max(...o.sizes) : 0;
  return (
    <>
      <Segmented
        label="Holds"
        value={o.style}
        options={STYLES}
        onChange={(style) => style !== o.style && onChange(rackPresetFields(RACK_PRESETS.find((p) => p.style === style)!))}
      />
      <Select
        label="Tools"
        value={preset && preset.style === o.style ? preset.id : 'custom'}
        options={[...presets.map((p) => ({ value: p.id, label: p.label })), { value: 'custom', label: 'Custom sizes' }]}
        onChange={(id) => {
          const p = findRackPreset(id);
          onChange(p ? rackPresetFields(p) : { preset: 'custom' });
        }}
        hint={preset?.style === o.style ? preset.note : undefined}
      />
      <SizeList
        label={hex ? 'Key sizes (across flats)' : SIZE_LABEL[o.style]}
        sizes={o.sizes}
        names={o.names}
        onChange={(p) => custom({ sizes: p.sizes, names: p.names })}
        hint={
          o.style === 'wrenches' && biggest
            ? `One per wrench. Slots fit typical heads: a ${sizeLabelText(biggest, o.labels === 'inch' ? 'inch' : 'mm')} is about ${fmt(wrenchHead(biggest).width)} × ${fmt(wrenchHead(biggest).thick)}.`
            : 'One tool per size, separated by commas. Size=label names it (12=Knipex).'
        }
      />
      {o.style === 'drivers' && (
        <div className="row2">
          <Segmented
            label="Holes"
            value={o.hole}
            options={[
              { value: 'round', label: 'Round' },
              { value: 'hex', label: 'Hex', title: 'For hex keys and hex-shank bits: flats face front and back' },
            ]}
            onChange={(hole) => custom({ hole })}
          />
          <LengthInput
            label="Handle diameter"
            value={o.handle}
            min={0}
            max={80}
            allowEmpty
            placeholder="none"
            onChange={(handle) => custom({ handle })}
            hint="Spaces the holes so handles don’t touch."
          />
        </div>
      )}
      {o.style === 'pliers' && (
        <div className="row2">
          <LengthInput label="Head width" value={o.head} min={3} max={80} onChange={(head) => custom({ head })} hint="Across the closed jaws: the slot’s length." />
          <LengthInput label="Handle thickness" value={o.handle} min={0} max={80} allowEmpty placeholder="none" onChange={(handle) => custom({ handle })} />
        </div>
      )}
      <div className="row3">
        <LengthInput label="Clearance" value={o.clearance} min={0} max={5} onChange={(clearance) => custom({ clearance })} />
        <LengthInput label="Depth" value={o.depth} min={3} max={200} onChange={(depth) => onChange({ depth })} />
        <LengthInput label="Spacing" value={o.spacing} min={0.8} max={20} onChange={(spacing) => onChange({ spacing })} />
      </div>
      <div className="row2">
        <Segmented label="Rows" value={o.rows} options={ROWS} onChange={(r) => onChange({ rows: r })} />
        <Toggle label="Stagger rows" checked={o.stagger} onChange={(stagger) => onChange({ stagger })} hint="Every other row sits between." />
      </div>
      <div className="row2">
        <LengthInput label="Step per row" value={o.step} min={0} max={RACK.maxStep} allowEmpty placeholder="flat" onChange={(step) => onChange({ step })} hint="Rows behind stand higher." />
        <Slider label="Lean back" value={o.tilt} min={0} max={RACK.maxTilt[o.style]} step={1} format={(v) => `${v}°`} onChange={(tilt) => onChange({ tilt })} />
      </div>
      <Segmented
        label="Engrave sizes"
        value={o.labels}
        options={[
          { value: 'none', label: 'None' },
          { value: 'mm', label: 'mm' },
          { value: 'inch', label: 'Inch', title: 'Fractions to 1/64″' },
        ]}
        onChange={(labels) => onChange({ labels })}
      />
      <LengthInput
        label="Tool height"
        value={o.reach}
        min={0}
        max={500}
        allowEmpty
        placeholder="typical"
        onChange={(reach) => onChange({ reach })}
        hint="How far the tools stand above the rack, for the tipping check. Empty: typical for their size."
      />
      <div className="field-hint">
        {L.places.length
          ? `${L.places.length} of ${L.total} in ${L.rows.length} row${L.rows.length === 1 ? '' : 's'}, ${o.style === 'drivers' ? 'holes' : 'slots'} ${fmt(shallow)} deep${L.rows.length > 1 && L.step > 0 ? `, ${fmt(L.step)} steps` : ''}.`
          : 'Nothing fits yet.'}{' '}
        {units > bin.heightUnits && (
          <button type="button" className="link" onClick={() => onBinChange({ heightUnits: units })}>
            Make it {units}u tall
          </button>
        )}
      </div>
      {notes.map((n) => (
        <div key={n} className="field-error">
          {n}
        </div>
      ))}
    </>
  );
}

/** Sizes as one line of text in the app's units ("3, 4.5, 3/16" or "12=Knipex"). */
export function SizeList({
  label,
  sizes,
  names,
  onChange,
  hint,
}: {
  label: string;
  sizes: number[];
  names: string[];
  onChange: (p: { sizes: number[]; names: string[] }) => void;
  hint?: string;
}) {
  const id = useId();
  const { units } = useUnits();
  const shown = formatSizeList(sizes, names, units);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const r = parseSizeList(text, units);
    if (!r) {
      setBad(true);
      return;
    }
    setBad(false);
    onChange(r);
  };
  return (
    <Field label={label} id={id} hint={bad ? <span className="field-error-inline">Sizes separated by commas, like 3, 4.5, 3/16″ or 12=Knipex</span> : hint}>
      <div className={`input-wrap ${bad ? 'bad' : ''}`}>
        <input id={id} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
        <span className="suffix">{units}</span>
      </div>
    </Field>
  );
}

registerContainerFields<RackOptions>('rack', RackFields);
