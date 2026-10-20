import { useUnits } from '../state/store';
import { Field, LengthInput, Segmented, Select, Slider, Stepper, Toggle } from './fields';
import { binSize, binTotalHeight, MIN_HEIGHT_UNITS, type BinOptions } from '../lib/geometry/bin';
import { binBodyHeight, binFloorZ, heightMmFor, heightMmRange, WALLS, type HeightMode, type Wall, type WallMask } from '../lib/geometry/variants';
import { POCKET_PRESETS, findPocketPreset, pocketLayout, presetFields } from '../lib/geometry/pockets';
import { LID_HEIGHT } from '../lib/geometry/lid';
import { HEIGHT_UNIT, LIP_SUPPORT_HEIGHT } from '../lib/geometry/spec';

type Props = { opts: BinOptions; onChange: (p: Partial<BinOptions>) => void };

/** Height, as 7 mm units or as an inside / overall length in the app's units. */
export function HeightField({ opts, onChange }: Props) {
  const { fmt } = useUnits();
  const { w, d } = binSize(opts);
  const body = binBodyHeight(opts);
  const inside = body - binFloorZ(opts);
  const total = binTotalHeight(opts);
  const mode = opts.heightMode;
  const setMode = (m: HeightMode) =>
    m === 'units'
      ? onChange({ heightMode: 'units', heightUnits: Math.min(30, Math.max(MIN_HEIGHT_UNITS, Math.round(body / HEIGHT_UNIT))) })
      : onChange({ heightMode: m, heightMm: heightMmFor(opts, m) });
  const hint = `${fmt(inside)} inside, ${fmt(total)} overall · footprint ${fmt(w)} × ${fmt(d)}`;
  const range = mode === 'units' ? null : heightMmRange(opts, mode);
  return (
    <>
      <Segmented
        label="Height given as"
        value={mode}
        options={[
          { value: 'units', label: '7 mm units', title: 'Gridfinity height units, not counting the lip' },
          { value: 'internal', label: 'Inside', title: 'Usable depth from the floor to the top of the wall' },
          { value: 'external', label: 'Overall', title: 'Overall height including the lip' },
        ]}
        onChange={setMode}
      />
      {range ? (
        <LengthInput
          label={mode === 'internal' ? 'Inside depth' : 'Overall height'}
          value={opts.heightMm}
          min={range.min}
          max={range.max}
          onChange={(heightMm) => onChange({ heightMm })}
          hint={hint}
        />
      ) : (
        <Stepper
          label="Height"
          value={opts.heightUnits}
          min={MIN_HEIGHT_UNITS}
          max={30}
          suffix="u"
          onChange={(heightUnits) => onChange({ heightUnits })}
          hint={hint}
        />
      )}
    </>
  );
}

/** Compartments or a pocket grid ("item holder"). */
export function InteriorFields({ opts, onChange }: Props) {
  const { fmt } = useUnits();
  const pockets = opts.interior === 'pockets';
  const custom = (p: Partial<BinOptions>) => onChange({ ...p, pocketPreset: 'custom' });
  let summary = '';
  if (pockets) {
    const { w, d } = binSize(opts);
    const body = binBodyHeight(opts);
    const zFloor = binFloorZ(opts);
    const topInfill = opts.lip ? body - LIP_SUPPORT_HEIGHT : body;
    const L = pocketLayout(opts, w, d, zFloor, topInfill);
    summary = `${L.centers.length} pocket${L.centers.length === 1 ? '' : 's'}, ${fmt(L.depth)} deep`;
    if (L.depth < opts.pocketDepth - 0.01) summary += ` (the bin is too short for ${fmt(opts.pocketDepth)})`;
    summary += '. Compartment, scoop and label settings are not used.';
  }
  const preset = findPocketPreset(opts.pocketPreset) ? opts.pocketPreset : 'custom';
  const sizeLabel = opts.pocketShape === 'round' ? 'Diameter' : opts.pocketShape === 'hex' ? 'Across flats' : 'Size X';
  return (
    <>
      <Segmented
        label="Inside"
        value={opts.interior}
        options={[
          { value: 'compartments', label: 'Compartments' },
          { value: 'pockets', label: 'Pocket grid', title: 'Fill the bin and cut a grid of pockets for batteries, bits, cards…' },
        ]}
        onChange={(interior) => onChange({ interior })}
      />
      {pockets && (
        <div className="indent">
          <Select
            label="Holds"
            value={preset}
            options={[
              ...POCKET_PRESETS.map((p) => ({
                value: p.id,
                label: p.label,
                group: ['aa', 'aaa', '18650', 'cr2032'].includes(p.id) ? 'Batteries' : ['sd', 'microsd'].includes(p.id) ? 'Memory cards' : 'Bits and screws',
              })),
              { value: 'custom', label: 'Custom' },
            ]}
            onChange={(id) => {
              const p = findPocketPreset(id);
              onChange(p ? presetFields(p) : { pocketPreset: 'custom' });
            }}
          />
          <Segmented
            label="Pocket shape"
            value={opts.pocketShape}
            options={[
              { value: 'round', label: 'Round' },
              { value: 'square', label: 'Square' },
              { value: 'hex', label: 'Hex' },
            ]}
            onChange={(pocketShape) => custom({ pocketShape })}
          />
          <div className="row2">
            <LengthInput label={sizeLabel} value={opts.pocketW} min={1} max={200} onChange={(pocketW) => custom({ pocketW })} />
            {opts.pocketShape === 'square' && (
              <LengthInput label="Size Y" value={opts.pocketD} min={1} max={200} onChange={(pocketD) => custom({ pocketD })} />
            )}
          </div>
          <div className="row3">
            <LengthInput label="Depth" value={opts.pocketDepth} min={1} max={200} onChange={(pocketDepth) => custom({ pocketDepth })} />
            <LengthInput label="Spacing" value={opts.pocketSpacing} min={0.8} max={20} onChange={(pocketSpacing) => custom({ pocketSpacing })} />
            <LengthInput label="Chamfer" value={opts.pocketChamfer} min={0} max={5} onChange={(pocketChamfer) => custom({ pocketChamfer })} />
          </div>
          <div className="field-hint">{summary}</div>
        </div>
      )}
    </>
  );
}

/** Foot style. */
export function BaseField({ opts, onChange }: Props) {
  const hints: Record<BinOptions['base'], string> = {
    standard: 'Solid Gridfinity feet.',
    lite: 'Hollow feet with thin walls (gridfinity-rebuilt “lite”): much less plastic. The floor follows the feet.',
    efficient: 'A pocket in each foot with 1 mm walls (Gridfinity Extended “efficient floor”).',
    flat: 'No feet: a flat-bottomed box for loose use. It does not lock into a baseplate.',
  };
  return (
    <Segmented
      label="Base"
      value={opts.base}
      options={[
        { value: 'standard', label: 'Standard' },
        { value: 'lite', label: 'Lite' },
        { value: 'efficient', label: 'Efficient' },
        { value: 'flat', label: 'Flat' },
      ]}
      onChange={(base) => onChange({ base })}
      hint={hints[opts.base] + (opts.interior === 'pockets' && (opts.base === 'lite' || opts.base === 'efficient') ? ' Pocket grids keep solid feet.' : '')}
    />
  );
}

/** Magnet / screw holes and their details. */
export function HoleFields({ opts, onChange }: Props) {
  if (opts.base === 'flat') return <div className="field-hint">Flat bins have no feet, so no magnet or screw holes.</div>;
  const magnets = opts.holes === 'magnets' || opts.holes === 'both';
  const hint =
    opts.holes === 'refined'
      ? 'Gridfinity Refined: 6 × 2 mm magnets slide in from the side and are held by friction; a toothpick hole pushes them out.'
      : magnets
        ? '6 × 2 mm magnets (6.5 mm pockets).'
        : undefined;
  return (
    <>
      <Segmented
        label="Bottom holes"
        value={opts.holes}
        options={[
          { value: 'none', label: 'None' },
          { value: 'magnets', label: 'Magnets' },
          { value: 'screws', label: 'Screws' },
          { value: 'both', label: 'Both' },
          { value: 'refined', label: 'Refined', title: 'Side-loaded press-fit magnet slots (Gridfinity Refined)' },
        ]}
        onChange={(holes) => onChange({ holes })}
        hint={hint}
      />
      {opts.holes !== 'none' && (
        <div className="indent">
          {opts.holes !== 'refined' && (
            <Toggle label="Chamfered hole mouths" checked={opts.holeChamfer} onChange={(holeChamfer) => onChange({ holeChamfer })} />
          )}
          {magnets && (
            <Toggle
              label="Crush ribs"
              checked={opts.holeCrushRibs}
              onChange={(holeCrushRibs) => onChange({ holeCrushRibs })}
              hint="Ribs inside the magnet pockets for a press fit, no glue."
            />
          )}
          {opts.holes !== 'refined' && (
            <Toggle
              label="Printable hole tops"
              checked={opts.holePrintable}
              onChange={(holePrintable) => onChange({ holePrintable })}
              hint="Bridges the top of each hole in thin stacked layers, so the holes print without supports."
            />
          )}
          <Toggle
            label="Outer corners only"
            checked={opts.holeCorners}
            onChange={(holeCorners) => onChange({ holeCorners })}
            hint="Four holes per bin instead of four per cell: fewer magnets."
          />
        </div>
      )}
    </>
  );
}

/** Lip style, anti-slide notches and the stacking lid. */
export function LipFields({ opts, onChange }: Props) {
  const { fmt } = useUnits();
  return (
    <>
      <Segmented
        label="Stacking lip"
        value={opts.lip ? opts.lipStyle : 'none'}
        options={[
          { value: 'normal', label: 'Normal' },
          { value: 'reduced', label: 'Reduced', title: 'No lower chamfer or support: more room inside, still stackable' },
          { value: 'none', label: 'None' },
        ]}
        onChange={(v) => onChange(v === 'none' ? { lip: false } : { lip: true, lipStyle: v })}
        hint={opts.lip && opts.lipStyle === 'reduced' ? 'Gridfinity Extended’s reduced lip: a wider opening, still stackable.' : undefined}
      />
      {opts.lip ? (
        <div className="indent">
          <Toggle
            label="Anti-slide notches"
            checked={opts.lipNotches}
            onChange={(lipNotches) => onChange({ lipNotches })}
            hint="On bins wider than one cell: cusps at the cell lines keep smaller bins stacked on top from sliding."
          />
          <Toggle
            label="Stacking lid"
            checked={opts.lid}
            onChange={(lid) => onChange({ lid })}
            hint={`Prints a ${fmt(LID_HEIGHT)} lid that sits in the lip; another bin stacks on top of it.`}
          />
        </div>
      ) : (
        <div className="field-hint">Lids need a stacking lip.</div>
      )}
    </>
  );
}

const WALL_NAMES: Record<Wall, string> = { f: 'Front', b: 'Back', l: 'Left', r: 'Right' };

function WallPicker({ label, value, onChange, hint }: { label: string; value: WallMask; onChange: (v: WallMask) => void; hint?: string }) {
  const toggle = (c: Wall) => onChange(WALLS.filter((k) => (k === c ? !value.includes(k) : value.includes(k))).join(''));
  return (
    <Field label={label} hint={hint}>
      <div className="segmented" role="group" aria-label={label}>
        {WALLS.map((c) => (
          <button key={c} type="button" aria-pressed={value.includes(c)} className={value.includes(c) ? 'active' : ''} onClick={() => toggle(c)}>
            {WALL_NAMES[c]}
          </button>
        ))}
      </div>
    </Field>
  );
}

/** Wall cutouts and finger slides. */
export function WallFields({ opts, onChange }: Props) {
  return (
    <>
      <WallPicker
        label="Wall cutouts"
        value={opts.cutoutWalls}
        onChange={(cutoutWalls) => onChange({ cutoutWalls })}
        hint={opts.cutoutWalls ? undefined : 'A rounded notch from the top of a wall, to reach in from the side.'}
      />
      {opts.cutoutWalls && (
        <div className="indent row2">
          <Slider
            label="Width"
            value={opts.cutoutWidth}
            min={0.1}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(cutoutWidth) => onChange({ cutoutWidth })}
          />
          <LengthInput label="Depth from top" value={opts.cutoutDepth} min={1} max={200} onChange={(cutoutDepth) => onChange({ cutoutDepth })} />
        </div>
      )}
      <WallPicker
        label="Finger slides"
        value={opts.slideWalls}
        onChange={(slideWalls) => onChange({ slideWalls })}
        hint={opts.slideWalls ? undefined : 'A curved ramp where the floor meets the wall, along the whole wall.'}
      />
      {opts.slideWalls && (
        <div className="indent">
          <LengthInput label="Slide radius" value={opts.slideRadius} min={1} max={40} onChange={(slideRadius) => onChange({ slideRadius })} />
        </div>
      )}
    </>
  );
}
