/**
 * Sidebar fields for the drawer unit container (geometry in
 * src/lib/geometry/containers/drawers.ts).
 */
import { useUnits } from '../../state/store';
import { Group, LengthInput, Segmented, Stepper, Toggle } from '../fields';
import { LabelTextField } from '../LabelFields';
import { sanitizeBin } from '../../lib/geometry/bin';
import {
  DEFAULT_DRAWER_UNIT,
  DRAWER_UNIT,
  drawerUnitNotes,
  planDrawerUnit,
  type DrawerLabelStyle,
  type DrawerPull,
  type DrawerSlot,
  type DrawerTop,
  type DrawerUnitOptions,
} from '../../lib/geometry/containers/drawers';
import { registerContainerFields, type ContainerFieldsProps } from './registry';

const PULLS: { value: DrawerPull; label: string; title: string }[] = [
  { value: 'notch', label: 'Notch', title: 'A finger notch cut down from the top of each front' },
  { value: 'tab', label: 'Tab', title: 'A lip along the top of each front, with a 45° underside to hook a finger under' },
  { value: 'knob', label: 'Knob', title: 'A round knob on each front (teardrop underside, prints without supports)' },
  { value: 'grip', label: 'Grip', title: 'A pocket recessed into each front; its ceiling rises inward to hook a fingertip' },
];

const TOPS: { value: DrawerTop; label: string; title: string }[] = [
  { value: 'flat', label: 'Flat', title: 'A plain flat top' },
  { value: 'lip', label: 'Lip', title: 'A stacking lip like a bin’s: bins stack on the chest' },
  { value: 'grid', label: 'Grid', title: 'A Gridfinity receptacle per cell: bins lock into place on top' },
];

const LABEL_STYLES: { value: DrawerLabelStyle; label: string; title: string }[] = [
  { value: 'raised', label: 'Raised', title: 'Letters stand 0.6 mm proud of the front' },
  { value: 'engraved', label: 'Engraved', title: 'Letters cut 0.6 mm into the front' },
];

const SIZES = Array.from({ length: DRAWER_UNIT.maxRowSize }, (_, i) => ({ value: i + 1, label: `${i + 1}×` }));

function pullHint(pull: DrawerPull, fmt: (mm: number) => string): string {
  const reach = DRAWER_UNIT.reach[pull];
  const back = reach ? ` The fronts sit back ${fmt(reach)} so it stays inside the footprint.` : '';
  return `${PULLS.find((p) => p.value === pull)!.title}.${back}`;
}

function DrawerUnitFields({ bin, value: o, onChange, cells }: ContainerFieldsProps<DrawerUnitOptions>) {
  const { fmt } = useUnits();
  // Walls and gaps are fractions of a mm: decimals, not 1/16″.
  const thin = (mm: number) => fmt(mm, { precision: 0, mmDigits: 2 });
  const so = sanitizeBin(bin);
  const plan = planDrawerUnit(so, o, cells);
  const notes = drawerUnitNotes(so, o, cells);
  // How many fit at the most, with the rows' current shares (new rows get one share each).
  const fit = planDrawerUnit(so, { ...o, rows: DRAWER_UNIT.maxRows, cols: DRAWER_UNIT.maxCols }, cells);
  const built = plan.slots.filter((s) => s.spec);
  const rowSizes = Array.from({ length: o.rows }, (_, i) => o.rowSizes[i] ?? 1);
  const setRowSize = (i: number, v: number) => {
    const next = [...o.rowSizes];
    while (next.length < o.rows) next.push(1);
    next[i] = v;
    onChange({ rowSizes: next });
  };
  const setText = (i: number, v: string) => {
    const next = [...o.labelTexts];
    while (next.length < i) next.push('');
    next[i] = v;
    onChange({ labelTexts: next });
  };
  const rowName = (i: number) => (o.rows === 1 ? 'Row' : i === 0 ? 'Top row' : i === o.rows - 1 ? 'Bottom row' : `Row ${i + 1}`);
  const rowInside = (i: number) => plan.slots.find((s) => s.row === i && s.spec)?.inside;
  const even = rowSizes.every((v) => v === rowSizes[0]);
  const cellText = (s: DrawerSlot) => {
    const cw = (s.inside.w - (o.divX - 1) * DRAWER_UNIT.divider) / o.divX;
    const cd = (s.inside.d - (o.divY - 1) * DRAWER_UNIT.divider) / o.divY;
    return `${o.divX * o.divY} compartments ${fmt(cw)} × ${fmt(cd)}`;
  };
  // One summary line per distinct drawer size (rows of equal shares are the same).
  const sizes = new Map<string, { slots: DrawerSlot[]; rows: number[] }>();
  for (const s of built) {
    const k = `${s.inside.w.toFixed(2)}|${s.inside.d.toFixed(2)}|${s.inside.h.toFixed(2)}`;
    const e = sizes.get(k) ?? { slots: [], rows: [] };
    e.slots.push(s);
    if (!e.rows.includes(s.row)) e.rows.push(s.row);
    sizes.set(k, e);
  }

  return (
    <>
      <div className="row2">
        <Stepper
          label="Drawers"
          value={o.rows}
          min={1}
          max={Math.max(1, fit.rows, Math.min(o.rows, DRAWER_UNIT.maxRows))}
          onChange={(rows) => onChange({ rows })}
          hint="One above the other"
        />
        <Stepper
          label="Columns"
          value={o.cols}
          min={1}
          max={Math.max(1, fit.cols, Math.min(o.cols, DRAWER_UNIT.maxCols))}
          onChange={(cols) => onChange({ cols })}
          hint="Side by side"
        />
      </div>
      {o.rows > 1 && (
        <Group title="Drawer heights" status={even ? 'even' : rowSizes.join(' : ')} active={!even}>
          <div className="field-hint">Each row&apos;s share of the height, top row first: 1×, 1×, 2× makes the bottom drawers twice as deep.</div>
          {rowSizes.map((v, i) => {
            const inside = rowInside(i);
            return (
              <Segmented
                key={i}
                label={rowName(i)}
                value={v}
                options={SIZES}
                onChange={(n) => setRowSize(i, n)}
                hint={i >= plan.rows ? 'Doesn’t fit at this height' : inside ? `${fmt(inside.h)} deep inside` : undefined}
              />
            );
          })}
        </Group>
      )}
      <Segmented label="Pull" value={o.pull} options={PULLS} onChange={(pull) => onChange({ pull })} hint={pullHint(o.pull, fmt)} />
      <Segmented label="Top" value={o.top} options={TOPS} onChange={(top) => onChange({ top })} hint={TOPS.find((t) => t.value === o.top)!.title + '.'} />
      <Toggle
        label="Drawer stops"
        checked={o.stops}
        onChange={(stops) => onChange({ stops })}
        hint={
          o.stops && plan.stopFront === null
            ? 'The drawers are too short front to back for stops.'
            : 'Small ridges on the drawer sides and bay walls: a drawer clicks to a stop about two thirds of the way out instead of ' +
              'falling out; pull firmly to take it out.'
        }
      />
      <div className="row2">
        <Stepper label="Compartments across" value={o.divX} min={1} max={DRAWER_UNIT.maxDiv} onChange={(divX) => onChange({ divX })} />
        <Stepper label="Compartments deep" value={o.divY} min={1} max={DRAWER_UNIT.maxDiv} onChange={(divY) => onChange({ divY })} />
      </div>
      <Toggle
        label="Labels on the fronts"
        checked={o.labels}
        onChange={(labels) => onChange({ labels })}
        hint={o.labels ? undefined : 'Text on each drawer front, under the pull.'}
      />
      {o.labels && (
        <div className="indent">
          <Segmented label="Text" value={o.labelStyle} options={LABEL_STYLES} onChange={(labelStyle) => onChange({ labelStyle })} />
          {plan.slots.map((s) => (
            <LabelTextField
              key={s.index}
              label={plan.cols > 1 ? `Drawer ${s.index + 1} (row ${s.row + 1}, column ${s.col + 1})` : `Drawer ${s.index + 1}`}
              value={o.labelTexts[s.index] ?? ''}
              placeholder="No label"
              onChange={(v) => setText(s.index, v)}
            />
          ))}
        </div>
      )}
      <Group
        title="Walls & fit"
        status={`${thin(o.shell)} walls · ${thin(o.clearance)} gap`}
        active={o.shell !== DEFAULT_DRAWER_UNIT.shell || o.clearance !== DEFAULT_DRAWER_UNIT.clearance}
      >
        <LengthInput
          label="Chest walls"
          value={o.shell}
          min={DRAWER_UNIT.shell.min}
          max={DRAWER_UNIT.shell.max}
          onChange={(shell) => onChange({ shell })}
          hint={`Sides, back, shelves and roof. The shelves bridge each bay, so they stay at least ${thin(DRAWER_UNIT.shell.min)}.`}
        />
        <LengthInput
          label="Drawer walls"
          value={o.drawerWall}
          min={DRAWER_UNIT.drawerWall.min}
          max={DRAWER_UNIT.drawerWall.max}
          onChange={(drawerWall) => onChange({ drawerWall })}
          hint={`Sides, back and floor; the front is ${thin(DRAWER_UNIT.frontExtra)} thicker.`}
        />
        <LengthInput
          label="Clearance"
          value={o.clearance}
          min={DRAWER_UNIT.clearance.min}
          max={DRAWER_UNIT.clearance.max}
          onChange={(clearance) => onChange({ clearance })}
          hint={`Gap between each drawer and its bay, on each side and above. ${thin(0.3)}–${thin(0.5)} slides well on most printers.`}
        />
      </Group>
      {sizes.size > 0 && (
        <div className="summary">
          <dl>
            {[...sizes.values()].map(({ slots, rows }) => {
              const s = slots[0];
              const where =
                sizes.size === 1 ? '' : ` (${rows.length === 1 ? rowName(rows[0]).toLowerCase() : `rows ${rows.map((r) => r + 1).join(', ')}`})`;
              return (
                <div key={s.index} style={{ display: 'contents' }}>
                  <dt>
                    {slots.length} drawer{slots.length === 1 ? '' : 's'}
                  </dt>
                  <dd>
                    {fmt(s.inside.w)} × {fmt(s.inside.d)} inside, {fmt(s.inside.h)} deep{where}
                    {o.divX * o.divY > 1 && (
                      <>
                        <br />
                        {cellText(s)}
                      </>
                    )}
                  </dd>
                </div>
              );
            })}
            <dt>Outside</dt>
            <dd>
              {fmt(built[0].spec!.w)} × {fmt(built[0].spec!.d)} per drawer; {built.length > 1 ? 'each prints on its own, open side up' : 'prints open side up'}
            </dd>
          </dl>
        </div>
      )}
      {notes.map((n) => (
        <div key={n} className="field-error">
          {n.charAt(0).toUpperCase() + n.slice(1)}
        </div>
      ))}
    </>
  );
}

registerContainerFields<DrawerUnitOptions>('drawers', DrawerUnitFields);
