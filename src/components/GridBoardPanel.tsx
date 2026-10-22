import type { ReactNode } from 'react';
import { useStore, useUnits } from '../state/store';
import { LengthInput, NumberInput, Section, Segmented, TextInput, Toggle } from './fields';
import { GRID_BOARD_NAMES, type GridBoardKind } from '../lib/gridBoards';
import { OPENGRID, sanitizeOpenGrid, type OpenGridOptions } from '../lib/geometry/opengrid';
import { DEFAULT_MULTIBOARD, MULTIBOARD, multiboardHead, sanitizeMultiboard, type MultiboardOptions } from '../lib/geometry/multiboard';
import type { GridFit, GridScrews } from '../lib/geometry/gridTiles';
import type { PrintJob } from '../lib/project';

/**
 * The board tab of an openGrid or Multiboard board (drawer.enclosure
 * 'opengrid' / 'multiboard', lib/gridBoards.ts): its size in squares, the
 * tiles it splits into, how they join and go up, and Multiboard's measured
 * dimensions. Loads with such a board, not on the first screen.
 */
export function GridBoardPanel({ job }: { job: PrintJob }) {
  const kind = useStore((s) => s.drawer.enclosure) as GridBoardKind;
  return kind === 'multiboard' ? <MultiboardPanel job={job} /> : <OpenGridPanel job={job} />;
}

/** The board's Attachments tab: these boards take their own systems' accessories. */
export function GridBoardAttachments() {
  const kind = useStore((s) => s.drawer.enclosure) as GridBoardKind;
  const og = kind === 'opengrid';
  return (
    <Section title="Attachments">
      <p className="muted">
        {og
          ? 'An openGrid board takes openGrid’s own snaps and the accessories made for them (Multiconnect ones too, on Multiconnect snaps). Gridfit’s attachments are made for Skådis-pattern boards.'
          : 'A Multiboard board takes Multiboard’s own snaps, bolts and pegboard accessories. Gridfit’s attachments are made for Skådis-pattern boards.'}
      </p>
      <p className="muted small">
        Going the other way? On a Skådis board, the “Other systems’ accessories” plate (Attachments, adapters) carries{' '}
        {og ? 'openConnect or Multiconnect' : 'Multiconnect or Multipoint'} heads, so {og ? 'openGrid' : 'Multiboard'} accessories hang there too.
      </p>
    </Section>
  );
}

/** Name, size in squares, and what the board comes to: both boards have these. */
function BoardHead({
  job,
  kind,
  cols,
  rows,
  pitch,
  test,
  set,
}: {
  job: PrintJob;
  kind: GridBoardKind;
  cols: number;
  rows: number;
  pitch: number;
  test: boolean;
  set: (p: { cols?: number; rows?: number; test?: boolean }) => void;
}) {
  const active = useStore((s) => s.drawers.find((d) => d.id === s.activeDrawerId));
  const renameDrawer = useStore((s) => s.renameDrawer);
  const { fmt } = useUnits();
  const info = job.drawers[0]?.enclosure?.info.grid;
  const squares = (v: number) => Math.max(1, Math.min(80, Math.round(v)));
  return (
    <>
      {active && <TextInput label="Name" value={active.name} onChange={(name) => renameDrawer(active.id, name)} placeholder="Desk wall" />}
      <div className="row2">
        <NumberInput label="Squares across" value={cols} min={1} max={80} step={1} suffix="" digits={0} onChange={(v) => set({ cols: squares(v) })} />
        <NumberInput label="Squares up" value={rows} min={1} max={80} step={1} suffix="" digits={0} onChange={(v) => set({ rows: squares(v) })} />
      </div>
      <div className="field-hint">
        {fmt(cols * pitch)} × {fmt(rows * pitch)}: {pitch} mm squares. The board splits between squares into tiles that fit the bed.
      </div>
      <Toggle
        label="Print a 2 × 2 test tile"
        checked={test}
        onChange={(t) => set({ test: t })}
        hint={
          test ? 'Just one small tile, with everything the board has: try it, then turn this off for the whole board.' : 'Check the fit with your snaps first.'
        }
      />
      <div className="summary">
        <div className="summary-big">
          {info?.tileCols ?? 0} × {info?.tileRows ?? 0} <small>tiles</small>
        </div>
        {info && info.tiles > 0 && (
          <dl>
            <dt>Board</dt>
            <dd>
              {fmt(info.boardW)} × {fmt(info.boardH)} × {fmt(info.T)}
            </dd>
            <dt>Largest tile</dt>
            <dd>
              {fmt(info.tileW)} × {fmt(info.tileD)}
            </dd>
            {kind === 'opengrid' ? (
              <>
                <dt>Connectors</dt>
                <dd>{info.connectors}</dd>
              </>
            ) : (
              <>
                <dt>Holes</dt>
                <dd>
                  {info.holes} large, {info.pegs} pegs
                </dd>
              </>
            )}
            <dt>Screws</dt>
            <dd>{info.screws}</dd>
          </dl>
        )}
      </div>
    </>
  );
}

/** Screws, and the most squares a tile has: both boards have these. */
function Mounting({
  screws,
  every,
  maxTile,
  set,
  children,
}: {
  screws: GridScrews;
  every: number;
  maxTile: number;
  set: (p: { screws?: GridScrews; screwEvery?: number; maxTile?: number }) => void;
  children?: ReactNode;
}) {
  return (
    <>
      <Segmented
        label="Screws"
        value={screws}
        options={[
          { value: 'corners', label: 'Corners', title: 'One in from each corner of every tile' },
          { value: 'grid', label: 'Spread', title: 'Across each tile, every few squares' },
          { value: 'none', label: 'None', title: 'No screw holes: for tape, or holes you drill' },
        ]}
        onChange={(s) => set({ screws: s })}
        hint="Countersunk, at grid crossings inside each tile, so every tile is held on its own."
      />
      {screws === 'grid' && (
        <NumberInput
          label="A screw about every"
          value={every}
          min={1}
          max={20}
          step={1}
          suffix="squares"
          digits={0}
          onChange={(v) => set({ screwEvery: Math.round(v) })}
        />
      )}
      {children}
      <NumberInput
        label="Tiles at most"
        value={maxTile}
        min={0}
        max={40}
        step={1}
        suffix="squares"
        digits={0}
        onChange={(v) => set({ maxTile: Math.round(v) })}
        hint="Each way. 0: as large as the bed takes."
      />
    </>
  );
}

const FIT_OPTIONS: { value: GridFit; label: string; title: string }[] = [
  { value: 'snug', label: 'Snug', title: 'Least clearance: for a printer that prints true' },
  { value: 'normal', label: 'Normal', title: 'For most printers' },
  { value: 'loose', label: 'Loose', title: 'More clearance: when parts come out tight' },
];

function OpenGridPanel({ job }: { job: PrintJob }) {
  const drawer = useStore((s) => s.drawer);
  const setDrawer = useStore((s) => s.setDrawer);
  const o = sanitizeOpenGrid(drawer.opengrid);
  const set = (p: Partial<OpenGridOptions>) => setDrawer({ opengrid: { ...o, ...p } });
  const full = o.variant === 'full';
  return (
    <>
      <Section title={GRID_BOARD_NAMES.opengrid}>
        <Segmented
          label="Board"
          value={o.variant}
          options={[
            { value: 'full', label: `Full (${OPENGRID.full} mm)`, title: 'Takes snaps from either face' },
            { value: 'lite', label: `Lite (${OPENGRID.lite} mm)`, title: 'Flat on the wall: half the plastic' },
          ]}
          onChange={(variant) => set({ variant })}
          hint={
            full
              ? 'The full board: snaps go in from either face. openGrid’s own full boards hang on mounting snaps; these have screw holes at the crossings.'
              : 'The lite board, flat on the wall with screw holes at the crossings. Takes lite snaps (3.4 mm thick).'
          }
        />
        <BoardHead job={job} kind="opengrid" cols={o.cols} rows={o.rows} pitch={OPENGRID.pitch} test={o.test} set={set} />
      </Section>
      <Section title="Joining and mounting">
        <Toggle
          label="Connectors between tiles"
          checked={o.connectors}
          onChange={(connectors) => set({ connectors })}
          hint={
            o.connectors
              ? 'Holes along the seams, at every grid crossing but the tiles’ corners; the connectors click in and line the tiles up.'
              : 'The tiles butt together: each is screwed up on its own.'
          }
        />
        {o.connectors && <Segmented label="Connector fit" value={o.fit} options={FIT_OPTIONS} onChange={(fit) => set({ fit })} />}
        <Mounting screws={o.screws} every={o.screwEvery} maxTile={o.maxTile} set={set}>
          <Toggle
            label="Cut the board’s corners"
            checked={o.chamfer}
            onChange={(chamfer) => set({ chamfer })}
            hint="4.2 mm off each outer corner, as openGrid’s boards are."
          />
        </Mounting>
      </Section>
    </>
  );
}

function MultiboardPanel({ job }: { job: PrintJob }) {
  const drawer = useStore((s) => s.drawer);
  const setDrawer = useStore((s) => s.setDrawer);
  const { fmt } = useUnits();
  const o = sanitizeMultiboard(drawer.multiboard);
  const set = (p: Partial<MultiboardOptions>) => setDrawer({ multiboard: { ...o, ...p } });
  const d = DEFAULT_MULTIBOARD;
  const measured = (['thickness', 'hole', 'holeFace', 'ring', 'peg'] as const).some((k) => o[k] !== d[k]);
  return (
    <>
      <Section title={GRID_BOARD_NAMES.multiboard}>
        <p className="field-hint">
          Multiboard doesn’t publish its tiles’ dimensions: these are measured ones, and each is set under Holes. Check with one tile first: print the test tile
          and try your snaps and bolts in it.
        </p>
        <BoardHead job={job} kind="multiboard" cols={o.cols} rows={o.rows} pitch={MULTIBOARD.pitch} test={o.test} set={set} />
      </Section>
      <Section title="Holes">
        <Toggle
          label="Big thread in the large holes"
          checked={o.threads}
          onChange={(threads) => set({ threads })}
          hint={
            o.threads
              ? 'For big-thread bolts and parts: 2.5 mm pitch, 22.5 mm across, a measured profile. Snaps click in either way.'
              : 'Plain octagonal holes: snaps click in; big-thread bolts need the thread.'
          }
        />
        <Toggle
          label="Small thread in the peg holes"
          checked={o.pegThreads}
          onChange={(pegThreads) => set({ pegThreads })}
          hint={o.pegThreads ? 'For small-thread bolts: 3 mm pitch, ⌀7, measured.' : 'Plain round holes for pegboard hooks.'}
        />
        <div className="row2">
          <LengthInput
            label="Board thickness"
            value={o.thickness}
            min={4}
            max={12}
            onChange={(thickness) => set({ thickness, ring: Math.min(o.ring, thickness) })}
          />
          <LengthInput label="Peg hole ⌀" value={o.peg} min={3} max={8} onChange={(peg) => set({ peg })} />
        </div>
        <div className="row2">
          <LengthInput label="Large hole, middle" value={o.hole} min={18} max={23} onChange={(hole) => set({ hole, holeFace: Math.max(o.holeFace, hole) })} />
          <LengthInput label="… at the faces" value={o.holeFace} min={o.hole} max={24} onChange={(holeFace) => set({ holeFace })} />
        </div>
        <LengthInput
          label="Middle ring"
          value={o.ring}
          min={0.4}
          max={o.thickness}
          onChange={(ring) => set({ ring })}
          hint={`Large holes across their flats: ${fmt(o.hole)} for the middle ${fmt(o.ring)}, ${fmt(o.holeFace)} at the faces. Measured: ${d.thickness} mm thick, ${d.hole} / ${d.holeFace} mm holes, a ${d.ring} mm ring, ⌀${d.peg} pegs.`}
        />
        {measured && (
          <div className="wall-actions">
            <button onClick={() => set({ thickness: d.thickness, hole: d.hole, holeFace: d.holeFace, ring: d.ring, peg: d.peg })}>
              Back to the measured sizes
            </button>
          </div>
        )}
      </Section>
      <Section title="Joining and mounting">
        <Segmented
          label="Teeth fit"
          value={o.fit}
          options={FIT_OPTIONS}
          onChange={(fit) => set({ fit })}
          hint="The teeth on each tile’s right and top edges drop into the notches of the next tile."
        />
        <Mounting screws={o.screws} every={o.screwEvery} maxTile={o.maxTile} set={set}>
          {o.screws !== 'none' && (
            <NumberInput
              label="Screw"
              value={o.screw}
              min={3}
              max={5}
              step={0.5}
              onChange={(screw) => set({ screw })}
              hint={`Through the peg holes, countersunk to ⌀${fmt(multiboardHead(o.screw))}.`}
            />
          )}
        </Mounting>
      </Section>
    </>
  );
}
