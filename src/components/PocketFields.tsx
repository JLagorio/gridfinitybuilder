import { useEffect, useId, useState, type ReactNode } from 'react';
import { useUnits } from '../state/store';
import { Field, Group, LengthInput, Segmented, Slider, Toggle } from './fields';
import { Combobox } from './combobox';
import {
  CUSTOM_SET,
  customEdit,
  FIT_DEFAULTS,
  POCKET_PRESETS,
  findPocketPreset,
  fitItem,
  formatSizeList,
  parseSizeList,
  pocketSummary,
  presetFields,
  type PocketItem,
  type PocketLayout,
} from '../lib/geometry/pockets';
import { MAX_POCKET_TILT, type PocketFields } from '../lib/geometry/variants';
import { Find } from './findContext';

/** A starting list for "Custom set of sizes". */
const CUSTOM_SET_START = [3, 4, 5, 6, 8, 10];

/**
 * Editor for the `pocket…` options: what the pockets hold (presets, graduated
 * sets, or an item you measure), their shape and size, bottoms, lean, finger
 * access and magnets. `layout` is the grid as laid out where it is cut, for
 * the summary and warnings; `note` follows the summary.
 */
export function PocketSettings({
  value: o,
  onChange,
  layout,
  note,
  find = false,
}: {
  value: PocketFields;
  onChange: (patch: Partial<PocketFields>) => void;
  layout?: PocketLayout | null;
  note?: ReactNode;
  /** The bin's own pocket grid: its fields are in the panel's search (panelIndex.ts). */
  find?: boolean;
}) {
  const { fmt } = useUnits();
  const set = o.pocketSizes.length > 0;
  /** An edit to what the pockets hold: no longer the preset, the same item height. */
  const custom = (p: Partial<PocketFields>) => onChange(customEdit(o, p));
  const preset = findPocketPreset(o.pocketPreset);
  const presetId = preset ? preset.id : set ? CUSTOM_SET : 'custom';
  const sizeLabel = o.pocketShape === 'round' ? 'Diameter' : o.pocketShape === 'hex' ? 'Across flats' : 'Size X';
  const summary = layout ? pocketSummary(o, layout, (v) => fmt(v)) : null;
  return (
    <>
      {/* Search ids only for the bin's own grid: a lid's or a compartment's grid shows whole, with what it's in. */}
      <Find id={find ? 'pocket-holds' : undefined}>
        <Combobox
          label="Holds"
          value={presetId}
          options={[
            ...POCKET_PRESETS.map((p) => ({ value: p.id, label: p.label, group: p.group, keywords: p.aliases })),
            { value: 'custom', label: 'Custom size', group: 'Custom' },
            { value: CUSTOM_SET, label: 'Custom set of sizes', group: 'Custom' },
          ]}
          onChange={(id) => {
            const p = findPocketPreset(id);
            if (p) onChange(presetFields(p));
            else if (id === CUSTOM_SET) onChange({ pocketPreset: CUSTOM_SET, ...(set ? {} : { pocketSizes: CUSTOM_SET_START, pocketSizeNames: [] }) });
            else onChange({ pocketPreset: 'custom', pocketSizes: [], pocketSizeNames: [], pocketItemH: o.pocketItemH });
          }}
          hint={preset?.note ?? (set ? 'One pocket per size, smallest first from the front.' : undefined)}
        />
        <FitItem onFit={onChange} />
      </Find>
      <Find id={find ? 'pocket-shape' : undefined}>
        <Segmented
          label="Pocket shape"
          value={o.pocketShape}
          options={[
            { value: 'round', label: 'Round' },
            { value: 'square', label: 'Square' },
            { value: 'hex', label: 'Hex' },
          ]}
          onChange={(pocketShape) => custom({ pocketShape })}
        />
        {set ? (
          <>
            <SizeList sizes={o.pocketSizes} names={o.pocketSizeNames} onChange={(p) => custom({ pocketSizes: p.sizes, pocketSizeNames: p.names })} />
            <div className="row2">
              <LengthInput
                label="Clearance"
                value={o.pocketClearance}
                min={0}
                max={5}
                onChange={(pocketClearance) => custom({ pocketClearance })}
                hint="Added to each size."
              />
              <Segmented
                label="Labels"
                value={o.pocketSizeLabels}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'mm', label: 'mm' },
                  { value: 'inch', label: 'Inch', title: 'Fractions to 1/64″' },
                ]}
                onChange={(pocketSizeLabels) => onChange({ pocketSizeLabels })}
              />
            </div>
          </>
        ) : (
          <div className="row2">
            <LengthInput label={sizeLabel} value={o.pocketW} min={1} max={200} onChange={(pocketW) => custom({ pocketW })} />
            {o.pocketShape === 'square' && <LengthInput label="Size Y" value={o.pocketD} min={1} max={200} onChange={(pocketD) => custom({ pocketD })} />}
          </div>
        )}
        <div className="row3">
          <LengthInput label="Depth" value={o.pocketDepth} min={1} max={200} onChange={(pocketDepth) => custom({ pocketDepth })} />
          <LengthInput label="Spacing" value={o.pocketSpacing} min={0.8} max={20} onChange={(pocketSpacing) => custom({ pocketSpacing })} />
          <LengthInput label="Chamfer" value={o.pocketChamfer} min={0} max={5} onChange={(pocketChamfer) => custom({ pocketChamfer })} />
        </div>
        {/* Set by a preset (cartridges) or Fit an item; kept when the pockets change. It doesn't change the pockets, so the preset stays. */}
        {o.pocketItemH > 0 && (
          <>
            <LengthInput
              label="Item height"
              value={o.pocketItemH}
              min={1}
              max={400}
              onChange={(pocketItemH) => onChange({ pocketItemH })}
              hint="How tall what stands in each pocket is: the note below and the print checks say how tall the bin must be for it."
            />
            <button type="button" className="link" onClick={() => onChange({ pocketItemH: -1 })}>
              Don’t check the height
            </button>
          </>
        )}
      </Find>
      <Find id={find ? 'pocket-bottom' : undefined}>
        <Segmented
          label="Bottom"
          value={o.pocketFloor}
          options={[
            { value: 'flat', label: 'Flat' },
            { value: 'round', label: 'Round', title: 'Rounded bottom so small parts slide out' },
            { value: 'cone', label: 'Cone', title: '118° point, like a drill tip, for bits and screws' },
            { value: 'stepped', label: 'Stepped', title: 'A narrower bore below a ledge, for items with a collar' },
          ]}
          onChange={(pocketFloor) =>
            custom(
              pocketFloor === 'stepped' && o.pocketStepW > o.pocketW - 0.8
                ? { pocketFloor, pocketStepW: Math.max(0.5, Math.round(o.pocketW * 6) / 10) }
                : { pocketFloor },
            )
          }
        />
        {o.pocketFloor === 'stepped' && (
          <div className="indent row2">
            <LengthInput label="Bore width" value={o.pocketStepW} min={0.5} max={200} onChange={(pocketStepW) => custom({ pocketStepW })} />
            <LengthInput
              label="Bore depth"
              value={o.pocketStepDepth}
              min={0.5}
              max={200}
              onChange={(pocketStepDepth) => custom({ pocketStepDepth })}
              hint="Part of the depth."
            />
          </div>
        )}
      </Find>
      <Find id={find ? 'pocket-lean' : undefined}>
        <Slider
          label="Lean"
          value={o.pocketTilt}
          min={0}
          max={MAX_POCKET_TILT}
          step={1}
          format={(v) => (v === 0 ? 'Off' : `${v}°`)}
          onChange={(pocketTilt) => onChange({ pocketTilt })}
          hint={o.pocketTilt > 0 ? 'Items tip toward the front. Depth is measured along the lean; leaning pockets take more room.' : undefined}
        />
      </Find>
      <Find id={find ? 'pocket-access' : undefined}>
        <Segmented
          label="Finger access"
          value={o.pocketGrip}
          options={[
            { value: 'none', label: 'None' },
            { value: 'groove', label: 'Groove', title: 'A rounded channel along each row of pockets' },
            { value: 'notch', label: 'Notch', title: 'A thumb notch in front of each pocket' },
          ]}
          onChange={(pocketGrip) => onChange({ pocketGrip })}
        />
      </Find>
      <Find id={find ? 'pocket-magnet' : undefined}>
        <Toggle
          label="Magnet under each pocket"
          checked={o.pocketMagnet}
          onChange={(pocketMagnet) => onChange({ pocketMagnet })}
          hint={o.pocketMagnet ? 'Press-fit recesses; the floor rises so 0.6 mm of plastic stays under each magnet.' : 'Holds steel items (bits, screws) in place.'}
        />
        {o.pocketMagnet && (
          <div className="indent row2">
            <LengthInput label="Magnet diameter" value={o.pocketMagnetD} min={1} max={30} onChange={(pocketMagnetD) => onChange({ pocketMagnetD })} />
            <LengthInput label="Thickness" value={o.pocketMagnetH} min={0.5} max={20} onChange={(pocketMagnetH) => onChange({ pocketMagnetH })} />
          </div>
        )}
      </Find>
      {(summary || note) && (
        <div className="field-hint">
          {summary && `${summary.text}. `}
          {note}
        </div>
      )}
      {summary?.warnings.map((m) => (
        <div key={m} className="field-error">
          {m}
        </div>
      ))}
    </>
  );
}

/** Measure an item and size the pockets for it. */
function FitItem({ onFit }: { onFit: (p: Partial<PocketFields>) => void }) {
  const { fmt } = useUnits();
  const [item, setItem] = useState<PocketItem>({ shape: 'round', w: 14.5, d: 10, height: 50 });
  const [clearance, setClearance] = useState<number>(FIT_DEFAULTS.clearance);
  const [share, setShare] = useState<number>(FIT_DEFAULTS.share);
  const edit = (p: Partial<PocketItem>) => setItem({ ...item, ...p });
  const fit = fitItem(item, clearance, share);
  const size = item.shape === 'square' ? `${fmt(fit.pocketW!)} × ${fmt(fit.pocketD!)}` : fmt(fit.pocketW!);
  return (
    <Group title="Fit an item" status="pockets sized from what you measure">
      <Segmented
        label="Item"
        value={item.shape}
        options={[
          { value: 'round', label: 'Round' },
          { value: 'square', label: 'Rectangle' },
          { value: 'hex', label: 'Hex' },
        ]}
        onChange={(shape) => edit({ shape })}
      />
      <div className={item.shape === 'square' ? 'row2' : 'row3'}>
        <LengthInput
          label={item.shape === 'round' ? 'Diameter' : item.shape === 'hex' ? 'Across flats' : 'Width'}
          value={item.w}
          min={0.5}
          max={200}
          onChange={(w) => edit({ w })}
        />
        {item.shape === 'square' && <LengthInput label="Thickness" value={item.d ?? item.w} min={0.5} max={200} onChange={(d) => edit({ d })} />}
        {item.shape !== 'square' && <LengthInput label="Height" value={item.height} min={1} max={400} onChange={(height) => edit({ height })} />}
        {item.shape !== 'square' && <LengthInput label="Clearance" value={clearance} min={0} max={5} onChange={setClearance} />}
      </div>
      {item.shape === 'square' && (
        <div className="row2">
          <LengthInput label="Height" value={item.height} min={1} max={400} onChange={(height) => edit({ height })} />
          <LengthInput label="Clearance" value={clearance} min={0} max={5} onChange={setClearance} />
        </div>
      )}
      <Slider
        label="Depth, as a share of its height"
        value={share}
        min={0.2}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={setShare}
        hint="Clearance is the total gap, not per side."
      />
      <div className="field">
        <button type="button" className="wide" onClick={() => onFit(fit)}>
          Size pockets for it
        </button>
        <div className="field-hint">
          {size} pockets, {fmt(fit.pocketDepth!)} deep.
        </div>
      </div>
    </Group>
  );
}

/** Graduated set sizes as one line of text, in the app's units; "12.6=8" names a size. */
function SizeList({ sizes, names, onChange }: { sizes: number[]; names: string[]; onChange: (p: { sizes: number[]; names: string[] }) => void }) {
  const id = useId();
  const { units } = useUnits();
  const shown = formatSizeList(sizes, names, units);
  const [text, setText] = useState(shown);
  const [bad, setBad] = useState(false);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const r = parseSizeList(text, units);
    if (!r || !r.sizes.length) {
      setBad(true);
      return;
    }
    setBad(false);
    onChange(r);
  };
  return (
    <Field
      label="Item sizes"
      id={id}
      hint={
        bad ? (
          <span className="field-error-inline">Sizes separated by commas, like 3, 4.5, 3/16″ or 12.6=8</span>
        ) : (
          'Separated by commas. Size=label names a pocket (12.6=8 is a 12.6 socket labelled 8).'
        )
      }
    >
      <div className={`input-wrap ${bad ? 'bad' : ''}`}>
        <input id={id} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
        <span className="suffix">{units}</span>
      </div>
    </Field>
  );
}
