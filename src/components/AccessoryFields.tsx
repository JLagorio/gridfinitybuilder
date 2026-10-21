import { useUnits } from '../state/store';
import { LengthInput, Segmented, Stepper, Toggle } from './fields';
import { LabelTextField } from './LabelFields';
import { binSize, type BinCells, type BinOptions } from '../lib/geometry/bin';
import { RAIL, SLIDE, TRAY, accessoryParts, planAccessories, slideLidBox, type RailMode, type RailPlatePart } from '../lib/geometry/accessories';

type Props = { opts: BinOptions; onChange: (p: Partial<BinOptions>) => void; cells?: BinCells };
type Fmt = (mm: number) => string;

const RAIL_OPTIONS: { value: RailMode; label: string; title: string }[] = [
  { value: '', label: 'Off', title: 'No rails' },
  { value: 'x', label: 'X', title: 'Plates run front to back, at positions across the width' },
  { value: 'y', label: 'Y', title: 'Plates run left to right, at positions along the depth' },
  { value: 'xy', label: 'X + Y', title: 'Both ways: the plates are slotted to cross like an egg crate' },
];

/** Folding-group summary, e.g. "tray 15 mm · rails X". */
export function accessoryStatus(o: BinOptions, fmt: Fmt, cells?: BinCells): string {
  const { w, d } = binSize(o, cells);
  const p = planAccessories(o, w, d);
  const parts: string[] = [];
  if (o.tray) {
    const n = p.tray?.levels.length ?? o.trayCount;
    parts.push(`${n > 1 ? `${n} trays` : 'tray'} ${fmt(p.tray?.h ?? o.trayHeight)}${p.tray ? '' : ' (off)'}`);
  }
  if (o.slideLid) parts.push(`sliding lid${p.slide ? '' : ' (off)'}`);
  if (o.rails) parts.push(`rails ${o.rails === 'xy' ? 'X + Y' : o.rails.toUpperCase()}${p.rails ? '' : ' (off)'}`);
  return parts.length ? parts.join(' · ') : 'none';
}

/** True when any accessory is switched on (the group starts open). */
export const accessoriesActive = (o: BinOptions) => o.tray || o.slideLid || !!o.rails;

/** Lift-out trays, a sliding lid and adjustable divider rails. */
export function AccessoryFields({ opts, onChange, cells }: Props) {
  const { fmt } = useUnits();
  const { w: W, d: D } = binSize(opts, cells);
  const plan = planAccessories(opts, W, D);
  const parts = accessoryParts(opts, W, D);
  const compartments = opts.interior === 'compartments';
  const removable = !!opts.layout?.walls.some((x) => x.removable);
  const notes = (re: RegExp) => plan.notes.filter((n) => re.test(n));

  // Trays
  const trays = parts.filter((p) => p.slot === 'tray');
  let trayHint = 'A thin open box with its own compartments that rests on a ledge near the top; lift it out to reach the bin below.';
  if (opts.tray && plan.tray) {
    const t = trays[0];
    const sizes = trays.length > 1 ? `${trays.length} trays, the top one ${fmt(t.w)} × ${fmt(t.d)}` : `Tray ${fmt(t.w)} × ${fmt(t.d)}`;
    const below = plan.interiorTop - plan.zFloor;
    trayHint = `${sizes}, ${fmt(plan.tray.h)} tall. The bin below is ${fmt(below)} deep; its dividers stop under the tray.`;
    if (removable) trayHint += ' Removable dividers that reach an outer wall have to be tilted past the ledge.';
  }
  const trayWarn: string[] = [];
  if (opts.tray && !compartments) trayWarn.push('Trays need a Compartments interior.');
  else if (opts.tray && !plan.tray) trayWarn.push('The bin is too short (or too small) for a tray.');
  else if (opts.tray && plan.tray?.shortened) {
    const n = plan.tray.levels.length;
    trayWarn.push(`The bin only has room for ${n === 1 ? 'one tray' : `${n} trays`} ${fmt(plan.tray.h)} tall.`);
  }

  // Sliding lid
  const lidHint = opts.slideLid
    ? plan.slide
      ? (() => {
          const b = slideLidBox(W, D);
          return `Slides in from the front through grooves in the left, right and back walls and clicks shut on a small bump. Lid ${fmt(b.x1 - b.x0)} × ${fmt(b.y1 - b.y0)} × ${fmt(SLIDE.thickness)}; compartments stop ${fmt(SLIDE.drop)} under it.`;
        })()
      : undefined
    : 'For bins without a stacking lip: grooves near the top of the walls and a lid that slides in from the front.';
  const lidWarn = opts.slideLid ? notes(/sliding lid/) : [];

  // Rails
  const rails = plan.rails;
  const plates = parts.filter((p) => p.slot === 'rail');
  let railHint = 'Thin guide ribs on opposite walls at every pitch, so loose divider plates slide in anywhere and move later.';
  if (opts.rails && rails) {
    const counts = [rails.xs.length && `${rails.xs.length} across X`, rails.ys.length && `${rails.ys.length} along Y`].filter(Boolean).join(', ');
    const sizes = [...new Map(plates.map((p) => [p.meshKey, p.part as RailPlatePart])).values()].map((p) => `${fmt(p.length)} × ${fmt(p.height)}`);
    railHint = `${counts} rail positions.${sizes.length ? ` Plates ${sizes.join(' and ')}.` : ''}`;
    if (rails.skipped) railHint += ` ${rails.skipped} position${rails.skipped === 1 ? ' is' : 's are'} left out where a divider already stands.`;
    if (rails.crossed) railHint += ' Fixed dividers in a plate’s way get a slot so it passes.';
  }
  const railWarn = opts.rails ? notes(/[Rr]ails/) : [];

  return (
    <>
      <Toggle label="Lift-out tray" checked={opts.tray} onChange={(tray) => onChange({ tray })} hint={compartments ? trayHint : undefined} />
      {opts.tray && compartments && (
        <div className="indent">
          <div className="row2">
            <LengthInput
              label="Tray height"
              value={opts.trayHeight}
              min={TRAY.minHeight}
              max={TRAY.maxHeight}
              onChange={(trayHeight) => onChange({ trayHeight })}
            />
            <Stepper label="Stacked" value={opts.trayCount} min={1} max={TRAY.maxCount} onChange={(trayCount) => onChange({ trayCount })} />
          </div>
          <div className="row2">
            <Stepper label="Tray columns" value={opts.trayDivX} min={1} max={TRAY.maxDiv} onChange={(trayDivX) => onChange({ trayDivX })} />
            <Stepper label="Tray rows" value={opts.trayDivY} min={1} max={TRAY.maxDiv} onChange={(trayDivY) => onChange({ trayDivY })} />
          </div>
          {opts.trayCount > 1 && <div className="field-hint">Each tray rests on its own ledge; the lower ones are a little smaller so they pass the ledges above.</div>}
        </div>
      )}
      {trayWarn.map((n) => (
        <div key={n} className="field-error">
          {n}
        </div>
      ))}

      <Toggle
        label="Sliding lid"
        checked={opts.slideLid}
        onChange={(slideLid) => onChange(slideLid ? { slideLid, lip: false, lid: false } : { slideLid })}
        hint={lidHint}
      />
      {opts.slideLid && (
        <div className="indent">
          {opts.lip && (
            <button type="button" onClick={() => onChange({ lip: false, lid: false })}>
              Turn the stacking lip off
            </button>
          )}
          <LabelTextField
            label="Lid text"
            value={opts.slideLidText}
            onChange={(slideLidText) => onChange({ slideLidText })}
            placeholder="Engraved on the lid"
            hint="Engraved into the top of the lid, behind the grip ridges."
          />
        </div>
      )}
      {lidWarn.map((n) => (
        <div key={n} className="field-error">
          {n}
        </div>
      ))}

      <Segmented label="Divider rails" value={opts.rails} options={RAIL_OPTIONS} onChange={(r) => onChange({ rails: r })} hint={compartments ? railHint : undefined} />
      {opts.rails && compartments && (
        <div className="indent row2">
          <LengthInput label="Rail pitch" value={opts.railPitch} min={RAIL.minPitch} max={RAIL.maxPitch} onChange={(railPitch) => onChange({ railPitch })} />
          <Stepper
            label={opts.rails === 'xy' ? 'Plates each way' : 'Plates'}
            value={opts.railPlates}
            min={0}
            max={RAIL.maxPlates}
            onChange={(railPlates) => onChange({ railPlates })}
          />
        </div>
      )}
      {railWarn.map((n) => (
        <div key={n} className="field-error">
          {n}
        </div>
      ))}
    </>
  );
}
