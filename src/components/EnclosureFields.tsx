import { history, useStore, useUnits } from '../state/store';
import { Group, LengthInput, NumberInput, Section, Segmented, Stepper, TextInput, Toggle } from './fields';
import { CASE, HINGE_CLEARANCE, sanitizeCase, type CaseOptions } from '../lib/geometry/case';
import { sanitizeWall, type WallOptions } from '../lib/geometry/wallmount';
import { SPACER, sanitizeSpacers, type SpacerOptions } from '../lib/geometry/spacers';
import type { Enclosure } from '../lib/layout/drawer';
import type { PrintJob } from '../lib/project';

type Kind = Enclosure | 'drawer';

const SIDES = { left: 'Left', right: 'Right', front: 'Front', back: 'Back' } as const;
const JOINTS = { none: 'none', bowtie: 'bowtie keys', pin: 'filament pins', puzzle: 'puzzle tabs', screw: 'M3 screws' } as const;

/** Drawer tab: what the grid goes in — a drawer (with optional spacer strips), a printed carry case, or a wall. */
export function EnclosureSection({ job }: { job: PrintJob }) {
  const drawer = useStore((s) => s.drawer);
  const bp = useStore((s) => s.baseplate);
  const setDrawer = useStore((s) => s.setDrawer);
  const setBp = useStore((s) => s.setBaseplate);
  const kind: Kind = drawer.enclosure ?? 'drawer';
  const enc = job.drawers[0]?.enclosure;

  const pick = (k: Kind) => {
    if (k === kind) return;
    // One undo step, magnets included.
    history.checkpoint();
    const fill = k !== 'drawer' && drawer.fill === 'spacers' ? { fill: 'solid' as const } : {};
    setDrawer({ enclosure: k === 'drawer' ? undefined : k, ...fill });
    // Bins only stay on a wall with magnets in both: switch the plate's pockets on.
    if (k === 'wall' && !bp.magnets && !drawer.halfGrid) setBp({ magnets: true });
    history.checkpoint();
  };

  return (
    <Section title="Drawer, case or wall" find="enclosure">
      <Segmented
        label="The grid goes in"
        value={kind}
        options={[
          { value: 'drawer', label: 'A drawer', title: 'A baseplate that drops into a drawer' },
          { value: 'case', label: 'Carry case', title: 'The baseplate is the floor of a printed case with a hinged lid' },
          { value: 'wall', label: 'On a wall', title: 'A baseplate screwed to a wall or hung on a French cleat' },
        ]}
        onChange={pick}
        hint={
          kind === 'case'
            ? 'The baseplate becomes the floor of a printed box with a hinged, latching lid. Drawer size or grid units set the inside.'
            : kind === 'wall'
              ? 'A baseplate to screw to a wall. The 3D view shows it lying flat: the back of the layout is the top on the wall.'
              : drawer.mode === 'drawer'
                ? 'Leftover space → Spacer strips prints the margins as separate strips that wedge in beside the grid.'
                : undefined
        }
      />
      {drawer.haveBaseplate && kind !== 'drawer' && (
        <div className="field-hint">Not printed (Just bins, top of this panel): you have it. Its settings still say where the bins sit and how much room they have.</div>
      )}
      {kind === 'case' && <CaseFields opts={sanitizeCase(drawer.carryCase)} onChange={(p) => setDrawer({ carryCase: { ...sanitizeCase(drawer.carryCase), ...p } })} info={enc?.info} box={enc?.box} />}
      {kind === 'wall' && <WallFields opts={sanitizeWall(drawer.wallMount)} onChange={(p) => setDrawer({ wallMount: { ...sanitizeWall(drawer.wallMount), ...p } })} info={enc?.info} />}
      {kind === 'drawer' && drawer.mode === 'drawer' && drawer.fill === 'spacers' && (
        <SpacerFields opts={sanitizeSpacers(drawer.spacers)} onChange={(p) => setDrawer({ spacers: { ...sanitizeSpacers(drawer.spacers), ...p } })} info={enc?.info} />
      )}
    </Section>
  );
}

type Info = NonNullable<PrintJob['drawers'][number]['enclosure']>['info'];

function CaseFields({ opts: c, onChange, info, box }: { opts: CaseOptions; onChange: (p: Partial<CaseOptions>) => void; info?: Info; box?: { x0: number; x1: number; y0: number; y1: number; h: number } }) {
  const { fmt } = useUnits();
  const bp = useStore((s) => s.baseplate);
  const auto = !(c.height > 0);
  return (
    <div className="indent">
      <LengthInput
        label="Room above the floor"
        value={c.height}
        allowEmpty
        placeholder="auto"
        min={0}
        max={400}
        onChange={(height) => onChange({ height: height > 0 ? Math.max(CASE.minRoom, height) : 0 })}
        hint={
          auto
            ? `Empty: the tallest bin plus the headroom${info?.room ? ` (${fmt(info.room)} now)` : ''}. Bins stay below the wall top; the lid only holds its lip.`
            : 'Floor to the top of the walls. Taller bins get a warning.'
        }
      />
      {auto && <NumberInput label="Headroom" value={c.headroom} min={0} max={30} step={0.5} onChange={(headroom) => onChange({ headroom })} hint="Space over the tallest bin." />}
      <div className="row2">
        <NumberInput label="Wall" value={c.wall} min={2} max={8} step={0.2} onChange={(wall) => onChange({ wall })} />
        <NumberInput label="Lid height" value={c.lidHeight} min={CASE.minLid} max={60} step={0.5} onChange={(lidHeight) => onChange({ lidHeight })} />
      </div>
      <Segmented
        label="Handle"
        value={c.handle}
        options={[
          { value: 'none', label: 'None' },
          { value: 'fold', label: 'Fold-down', title: 'A bail on round pegs on the lid sides: lies on the lid when not in use' },
          { value: 'arch', label: 'Fixed arch', title: 'The same bail on diamond pegs: it stays upright' },
        ]}
        onChange={(handle) => onChange({ handle })}
        hint="Prints flat and snaps over pegs on the lid's sides (wide cases: two halves, glued)."
      />
      <Segmented
        label="Feet"
        value={c.feet}
        options={[
          { value: 'none', label: 'None' },
          { value: 'bumpers', label: 'Bumpers', title: 'Recesses for four 10 mm stick-on rubber bumpers' },
          { value: 'printed', label: 'Printed', title: 'Four printed feet that press into recesses (TPU grips best)' },
        ]}
        onChange={(feet) => onChange({ feet })}
      />
      <TextInput label="Lid label" value={c.label} placeholder="e.g. DRILL BITS" onChange={(label) => onChange({ label })} hint="Debossed in the lid; shrinks to fit." />
      {c.label.trim() && <NumberInput label="Label size" value={c.labelSize} min={4} max={40} step={1} onChange={(labelSize) => onChange({ labelSize })} hint="Capital height." />}
      <Group
        title="Hinges and latches"
        status={c.hinges || c.latches ? `${c.hinges || 'auto'} hinges · ${c.latches || 'auto'} latches` : 'automatic'}
        active={!!(c.hinges || c.latches)}
      >
        <div className="row2">
          <Stepper label="Hinges" value={c.hinges} min={0} max={6} onChange={(hinges) => onChange({ hinges })} />
          <Stepper label="Latches" value={c.latches} min={0} max={6} onChange={(latches) => onChange({ latches })} />
        </div>
        <div className="field-hint">
          0 = automatic. Each hinge is two body knuckles and one lid knuckle on a printed snap pin ({HINGE_CLEARANCE} mm play); each latch is a flexing arm on
          the lid that hooks under a ridge on the body.
        </div>
      </Group>
      {box && info && (
        <div className="summary">
          <dl>
            <dt>Outside</dt>
            <dd>
              {fmt(box.x1 - box.x0)} × {fmt(box.y1 - box.y0)} × {fmt(box.h)}
            </dd>
            <dt>Walls</dt>
            <dd>{fmt(info.wallTop ?? 0)} high</dd>
            <dt>Prints as</dt>
            <dd>
              {info.pieces === 1 ? 'one body and one lid' : `${info.pieces} body and ${info.pieces} lid pieces${info.lidKeys ? `, ${info.lidKeys} lid keys` : ''}`}
            </dd>
            {info.joints && (
              <>
                <dt>Floor joints</dt>
                <dd>{JOINTS[info.joints]}</dd>
              </>
            )}
            <dt>Hardware</dt>
            <dd>
              {info.hinges} hinge{info.hinges === 1 ? '' : 's'}, {info.latches} latch{info.latches === 1 ? '' : 'es'}
            </dd>
          </dl>
        </div>
      )}
      <div className="field-hint">
        The floor is always closed{bp.style === 'frame' || bp.style === 'skeletonized' ? ' (this style prints solid in a case)' : ''}. Lid closed / open / off: buttons over the 3D
        view.
      </div>
    </div>
  );
}

function WallFields({ opts: o, onChange, info }: { opts: WallOptions; onChange: (p: Partial<WallOptions>) => void; info?: Info }) {
  const bp = useStore((s) => s.baseplate);
  const half = useStore((s) => !!s.drawer.halfGrid);
  const setBp = useStore((s) => s.setBaseplate);
  const { fmt } = useUnits();
  return (
    <div className="indent">
      <Segmented
        label="Mounting"
        value={o.mount}
        options={[
          { value: 'countersunk', label: 'Countersunk', title: 'Screws through the posts where four cells meet' },
          { value: 'keyhole', label: 'Keyholes', title: 'Slots in the back that hang on screw heads' },
          { value: 'none', label: 'None', title: 'Only the French cleat (or adhesive)' },
        ]}
        onChange={(mount) => onChange({ mount })}
        hint={
          o.mount === 'countersunk'
            ? 'At cell corners, through the post where four walls meet; the head sits in the floor, clear of the bins.'
            : o.mount === 'keyhole'
              ? 'Hang the plate on screw heads in the wall and let it drop; the slots run up the wall.'
              : undefined
        }
      />
      {o.mount !== 'none' && (
        <>
          <Stepper
            label="A screw every"
            value={o.every}
            min={1}
            max={8}
            suffix=" cells"
            onChange={(every) => onChange({ every })}
            hint={`${info?.holes ?? 0} holes. The outermost cell corners of each piece always get one.`}
          />
          <div className="row2">
            <NumberInput label="Screw Ø" value={o.screwDiameter} min={2.5} max={6} step={0.5} onChange={(screwDiameter) => onChange({ screwDiameter })} />
            <NumberInput label="Head Ø" value={o.headDiameter} min={5} max={12} step={0.5} onChange={(headDiameter) => onChange({ headDiameter })} />
          </div>
        </>
      )}
      <Toggle
        label="French cleat"
        checked={o.cleat}
        onChange={(cleat) => onChange({ cleat })}
        hint="A groove across the back near the top, and a printed cleat to screw to the wall: lift the plate on and off. Thickens the floor."
      />
      <Toggle label="Ledge along the bottom" checked={o.ledge} onChange={(ledge) => onChange({ ledge })} hint="Stops the bottom row tipping out when knocked; bins above rest on the row below." />
      {o.ledge && <NumberInput label="Ledge height" value={o.ledgeHeight} min={3} max={30} step={0.5} onChange={(ledgeHeight) => onChange({ ledgeHeight })} hint="Above the top of the plate." />}
      <div className="field-hint">
        <b>Keeping bins on:</b> magnets in both the plate and the bins (give bins magnet holes on the Bins tab). A standard bin&apos;s outside is flush with its feet, so
        there is nothing a plate could hook without hitting the next bin.{' '}
        {half && 'Half-grid cells have no room for magnets: rely on the ledge and keep bins light. '}
        {info?.floor !== undefined && `Floor: ${fmt(info.floor)}. `}
        {!bp.magnets && !half && (
          <button className="link" onClick={() => setBp({ magnets: true })}>
            Turn on magnet pockets
          </button>
        )}
      </div>
    </div>
  );
}

function SpacerFields({ opts: o, onChange, info }: { opts: SpacerOptions; onChange: (p: Partial<SpacerOptions>) => void; info?: Info }) {
  const { fmt } = useUnits();
  return (
    <div className="indent">
      <Segmented
        label="Spacer strips"
        value={o.style}
        options={[
          { value: 'lattice', label: 'Lattice', title: 'A frame with diagonal ribs: rigid, less filament' },
          { value: 'solid', label: 'Solid' },
        ]}
        onChange={(style) => onChange({ style })}
        hint={`Strips at least ${SPACER.latticeMin} mm wide get the lattice. Long strips print in lengths that join with a dovetail.`}
      />
      <Toggle
        label="Tabs into the baseplate"
        checked={o.tabs}
        onChange={(tabs) => onChange({ tabs })}
        hint="Small jigsaw tabs on each strip drop into sockets under the plate's edge, so nothing shifts."
      />
      {info?.strips && (
        <div className="field-hint">
          {info.strips.length
            ? info.strips.map((s) => `${SIDES[s.side]} ${fmt(s.width)}${s.pieces > 1 ? ` (${s.pieces} lengths)` : ''}`).join(' · ')
            : `No margin is ${SPACER.minWidth} mm or wider: nothing to fill.`}
        </div>
      )}
    </div>
  );
}
