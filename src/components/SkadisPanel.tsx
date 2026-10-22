import { useStore, useUnits } from '../state/store';
import { Group, LengthInput, NumberInput, Section, Segmented, TextInput, Toggle } from './fields';
import {
  DEFAULT_SKADIS,
  SKADIS,
  cellsFull,
  headDiameter,
  ledChannel,
  planSkadis,
  plannedSkadis,
  rimWidth,
  sanitizeSkadis,
  type SkadisCell,
  type SkadisOptions,
  type SkadisZone,
} from '../lib/geometry/skadis';
import type { PrintJob } from '../lib/project';
import { skadisAreas } from '../lib/enclosures';
import { hexCells } from '../lib/geometry/skadisTiles';
import { Find } from './findContext';
import { FindPanel, MoreInAll } from './find';
import { SKADIS_INDEX } from './skadisIndex';

/** The common Skådis board sizes, width × height, mm (their slots start 20 mm from each edge, as Gridfit's do). */
const STANDARD_BOARDS: [number, number][] = [
  [360, 560],
  [560, 560],
  [760, 560],
];

/** Rectangle tile sizes to pick from, mm (in whole steps). */
const TILE_SIZES = [120, 160, 200, 240];

/**
 * The Drawer tab of a Skådis board (drawer.enclosure 'skadis'): its tiles (or
 * the space on the wall it fills) and their slot pattern, how they join and
 * hang, and the board itself (its slots, frame and solid zones).
 */
export function SkadisPanel({ job }: { job: PrintJob }) {
  const drawer = useStore((s) => s.drawer);
  const active = useStore((s) => s.drawers.find((d) => d.id === s.activeDrawerId));
  const renameDrawer = useStore((s) => s.renameDrawer);
  const setDrawer = useStore((s) => s.setDrawer);
  const setHaveBaseplate = useStore((s) => s.setHaveBaseplate);
  const have = !!drawer.haveBaseplate;
  const setHave = (on: boolean) => setHaveBaseplate(on);
  const { fmt } = useUnits();
  const o = sanitizeSkadis(drawer.skadis);
  const set = (p: Partial<SkadisOptions>) => setDrawer({ skadis: { ...o, ...p } });
  const info = job.drawers[0]?.enclosure?.info.skadis;
  const hex = o.shape === 'hex';
  const changed = (...keys: (keyof SkadisOptions)[]) => keys.some((k) => o[k] !== DEFAULT_SKADIS[k]);
  const tiles = info?.tiles ?? 0;
  const several = tiles > 1;
  // Built from tiles (BoardTiles.tsx adds and takes them away); its tiles make a whole rectangle (for a frame or other hanging).
  const byTiles = o.layout === 'tiles';
  const whole = !byTiles || cellsFull(o.tiles);
  const what = hex ? 'hexagon' : 'tile';
  const setup = useStore((s) => s.setup);
  const areas = skadisAreas(setup);
  const sizes = tileSizes(o, areas);
  /** Built from tiles from now on: a board of one tile gets as many as about fill its space (a honeycomb's rows half a hexagon over in turn). */
  const toTiles = () => {
    const g = o.tiles.length === 1 ? planSkadis({ ...o, layout: 'tiles' }, areas).grid : undefined;
    const [nx, ny] = g ? [Math.max(1, Math.round(o.width / g.q[0])), Math.max(1, Math.round(o.height / g.r[1]))] : [1, 1];
    const tiles = g
      ? Array.from({ length: nx * ny }, (_, k): SkadisCell => {
          const [c, r] = [k % nx, Math.floor(k / nx)];
          return hex ? [c - Math.floor(r / 2), r] : [c, r];
        })
      : o.tiles;
    set({ layout: 'tiles', tiles });
  };
  const sizeKey = !o.tileSize ? 'auto' : sizes.some((v) => v === o.tileSize) ? String(o.tileSize) : 'other';
  // As planned: the dense step, the LED frame's border, what a board that isn't screwed up rests on.
  const p = plannedSkadis(o);
  const setZone = (i: number, z: Partial<SkadisZone>) => set({ zones: o.zones.map((q, k) => (k === i ? { ...q, ...z } : q)) });
  const step = `${p.pitch} mm`;

  const patternHint = {
    skadis: `Columns ${step} apart, the slots in a column ${2 * p.pitch} mm apart, every other column ${step} higher.${p.pitch === 20 ? ' Standard Skådis hooks fit.' : ' At 20 mm standard Skådis hooks fit.'}`,
    square: `A square grid, slots ${2 * p.pitch} mm apart both ways (openGrid-like at a 14 mm step).${hex ? '' : ' Seams run between the slots and cost none.'}`,
    dense: `A slot every ${step}: twice the slots, so attachments sit at any step.${p.pitch > o.pitch ? ` The step is ${step} at least, 4 mm longer than a slot.` : ''}`,
  }[o.pattern];
  const hangHint = {
    screws: 'Screwed to the wall through countersunk holes in the board.',
    cleat: `A strip screwed to the back along the top drops over its twin on the wall, both ${p.depth} mm thick; their 45° edges pull the board in. Lift it to take it down.`,
    door: `Hooks over the top of the door, screwed to the back; 2.5 mm over the door, so it still shuts. The board is ${p.depth} mm off the door.`,
    desk:
      o.deskMount === 'stand'
        ? 'Feet its bottom edge stands in, screwed to the back.'
        : 'Clamps on the desk’s back edge, screwed to the back of the board, an M6 bolt each.',
  }[o.hang];

  const joinHint = hex
    ? o.join === 'none'
      ? 'Each hexagon is screwed up on its own: line them up carefully for a part to span two.'
      : `${info?.plates ?? 0} joint plates on the back across the gaps between hexagons side by side hold them in line, so a part can span two. Every hexagon has the pockets, so they stay one part.`
    : !several
      ? 'The board prints in one piece: no seams to join.'
      : o.join === 'none'
        ? 'Tiles butt together; each is screwed up on its own.'
        : `${info?.tabs ?? 0} dovetail tabs and ${info?.plates ?? 0} joint plates. Tabs lock the tiles together in the board's plane; plates press into pockets on the back across the seams and keep it flat (always where seams cross).`;

  return (
    <FindPanel index={SKADIS_INDEX} placeholder="Find a setting…">
      <Section title="Skådis board" find="skadis">
        <Find id="skadis-print" set={have}>
          <Segmented
            label="Print for this board"
            value={have ? 'attachments' : 'all'}
            options={[
              { value: 'all', label: 'Board and attachments' },
              { value: 'attachments', label: 'Just attachments', title: 'You have the board already: print only what hangs on it' },
            ]}
            onChange={(v) => setHave(v === 'attachments')}
            hint={
              have
                ? 'The board isn’t printed: give its size (or pick a standard one) and thickness, and the attachments are made to fit it.'
                : 'Have a board already? Pick Just attachments to print only what hangs on it.'
            }
          />
          {have && (
            <div className="wall-actions">
              {STANDARD_BOARDS.map(([bw, bh]) => (
                <button
                  key={`${bw}x${bh}`}
                  onClick={() => set({ layout: undefined, width: bw, height: bh, thickness: 5.1, slotW: 5.1, slotL: 15.2, pattern: 'skadis', pitch: 20 })}
                  title={`A standard ${bw / 10} × ${bh / 10} cm board: 5.1 mm thick, 5.1 × 15.2 mm slots`}
                >
                  {bw / 10} × {bh / 10} cm
                </button>
              ))}
            </div>
          )}
        </Find>
        {active && (
          <Find id="skadis-name">
            <TextInput label="Name" value={active.name} onChange={(name) => renameDrawer(active.id, name)} placeholder="Workbench wall" />
          </Find>
        )}
        <Find id="skadis-layout">
          <Segmented
            label="Board"
            value={byTiles ? 'tiles' : 'space'}
            options={[
              { value: 'tiles', label: 'Tiles', title: 'Tiles of one size, added one by one on the picture of the board' },
              { value: 'space', label: 'Fill a space', title: 'A width and a height on the wall, filled with tiles or hexagons' },
            ]}
            onChange={(v) => (v === 'tiles' ? toTiles() : set({ layout: undefined }))}
            hint={
              byTiles
                ? `Click + by the board’s edge on its picture to add a ${what}, ✕ to take one away. Every ${what}’s slots are on one lattice, so a part can span two.`
                : 'The board fills a space on the wall: give its width and height.'
            }
          />
        </Find>
        {!byTiles && (
          <Find id="skadis-space">
            <div className="row2">
              <LengthInput label="Space width" value={o.width} min={60} onChange={(width) => set({ width })} />
              <LengthInput label="Space height" value={o.height} min={60} onChange={(height) => set({ height })} />
            </div>
            <div className="field-hint">
              The space on the wall.{' '}
              {hex ? 'Whole hexagons fit in it, centred.' : 'The board fills it, the slots centred with at least the border around them.'} Standard boards are
              56 × 56, 76 × 56 and 36 × 56 cm.
            </div>
          </Find>
        )}
        <Find id="skadis-shape">
          <Segmented
            label="Tiles"
            value={o.shape}
            options={[
              { value: 'rect', label: 'Rectangles', title: 'One board, split into tiles that fit the bed and join seamlessly' },
              { value: 'hex', label: 'Hexagons', title: 'Hexagon boards in a honeycomb, each as large as the bed takes' },
            ]}
            onChange={(shape) => set({ shape })}
            hint={
              hex
                ? `Each hexagon is a board of its own, screwed up in its ${byTiles ? 'top and bottom corners, every one the same part' : 'left and right corners'}. Frames, zones and other ways to hang are for rectangles.`
                : o.pattern === 'square'
                  ? 'Seams run along the empty columns and rows between the slots.'
                  : o.pattern === 'dense'
                    ? 'Seams take the place of a column or a row of slots.'
                    : 'Upright seams take the place of a column of slots; level seams run through a row of slots, so the slots they cut are whole once the tiles are together.'
            }
          />
        </Find>
        <Find id="skadis-pattern" set={changed('pattern', 'pitch')}>
          <Segmented
            label="Slot pattern"
            value={o.pattern}
            options={[
              { value: 'skadis', label: 'Skådis', title: 'The standard pattern: every other column a step higher' },
              { value: 'square', label: 'Square', title: 'A square grid, two steps apart both ways' },
              { value: 'dense', label: 'Dense', title: 'A slot at every step: attachments sit anywhere' },
            ]}
            onChange={(pattern) => set({ pattern })}
            hint={patternHint}
          />
          <NumberInput
            label="Step"
            value={o.pitch}
            min={14}
            max={40}
            step={0.5}
            onChange={(pitch) => set({ pitch })}
            hint="The lattice the slots are on (standard: 20 mm). Attachments’ mounts are two steps apart."
          />
        </Find>
        {byTiles && (
          <Find id="skadis-tile-size" set={o.tileSize > 0}>
            <Segmented
              label={hex ? 'Hexagon size' : 'Tile size'}
              value={sizeKey}
              options={[
                { value: 'auto', label: 'Largest', title: `The largest ${what} your printer takes` },
                ...sizes.map((v) => ({ value: String(v), label: fmt(v), title: hex ? `${fmt(v)} from the top corner to the bottom one` : `${fmt(v)} square` })),
                { value: 'other', label: 'Other' },
              ]}
              onChange={(v) =>
                set(
                  v === 'auto'
                    ? { tileSize: 0, tileHeight: 0 }
                    : v === 'other'
                      ? { tileSize: (hex ? info?.hexH : info?.tileW) ?? 200 }
                      : { tileSize: Number(v), tileHeight: 0 },
                )
              }
              hint={
                hex
                  ? `Top corner to bottom corner${info?.hexW && info.hexH ? ` (${fmt(info.hexH)}, ${fmt(info.hexW)} across, now)` : ''}. Hexagons come in the sizes that keep every one’s slots on one lattice.`
                  : `In whole steps of the lattice${info?.tileW ? ` (${fmt(info.tileW)} × ${fmt(info.tileD)} printed now, with its tabs)` : ''}.`
              }
            />
            {sizeKey === 'other' && (
              <div className="row2">
                <LengthInput
                  label={hex ? 'Corner to corner' : 'Tile width'}
                  value={o.tileSize}
                  min={60}
                  max={1000}
                  onChange={(tileSize) => set({ tileSize })}
                />
                {!hex && (
                  <LengthInput
                    label="Tile height"
                    value={o.tileHeight}
                    allowEmpty
                    placeholder="as wide"
                    min={60}
                    max={1000}
                    onChange={(tileHeight) => set({ tileHeight })}
                  />
                )}
              </div>
            )}
          </Find>
        )}
        {hex && (
          <Find id="skadis-hex">
            <div className="row2">
              {!byTiles && (
                <LengthInput
                  label="Hexagon width"
                  value={o.hexWidth}
                  allowEmpty
                  placeholder={info?.hexW ? `auto (${fmt(info.hexW)})` : 'auto'}
                  min={60}
                  max={1000}
                  onChange={(hexWidth) => set({ hexWidth })}
                />
              )}
              <LengthInput label="Gap between" value={o.hexGap} min={0} max={50} onChange={(hexGap) => set({ hexGap })} />
            </div>
            <div className="field-hint">{byTiles ? 'Between neighbouring hexagons.' : 'Corner to corner. Empty: the largest the bed and the space take.'}</div>
          </Find>
        )}
        <div className="summary">
          <div className="summary-big">
            {hex || byTiles ? (
              <>
                {tiles}{' '}
                <small>
                  {what}
                  {tiles === 1 ? '' : 's'}
                </small>
              </>
            ) : (
              <>
                {info?.cols ?? 0} × {info?.rows ?? 0} <small>tiles</small>
              </>
            )}
          </div>
          {info && tiles > 0 && (
            <dl>
              <dt>Board</dt>
              <dd>
                {fmt(info.boardW)} × {fmt(info.boardH)}
              </dd>
              <dt>{hex ? 'Hexagon' : byTiles ? 'Tile' : 'Largest tile'}</dt>
              <dd>{hex && info.hexW && info.hexH ? `${fmt(info.hexW)} × ${fmt(info.hexH)}` : `${fmt(info.tileW)} × ${fmt(info.tileD)}`}</dd>
              <dt>Slots</dt>
              <dd>{info.slots}</dd>
              <dt>Screws</dt>
              <dd>{info.screws}</dd>
            </dl>
          )}
        </div>
      </Section>

      <Section title="Joining and hanging" find="skadis-mount">
        {(!hex || byTiles) && (
          <Find id="skadis-join">
            <Segmented
              label={`Join the ${what}s with`}
              value={hex && o.join !== 'none' ? 'plates' : o.join}
              options={[
                ...(hex ? [] : [{ value: 'both' as const, label: 'Tabs & plates', title: 'Dovetail tabs along the seams, and plates on the back with pins' }]),
                ...(hex ? [] : [{ value: 'tabs' as const, label: 'Tabs', title: 'Dovetail tabs along the seams' }]),
                { value: 'plates', label: 'Plates', title: 'Plates pressed into pockets on the back, with pins' },
                { value: 'none', label: 'Nothing', title: `${hex ? 'Hexagons' : 'Tiles'} each screwed up on their own` },
              ]}
              onChange={(join) => set({ join })}
              hint={joinHint}
            />
          </Find>
        )}
        {!hex && (
          <Find id="skadis-hang" set={changed('hang')}>
            <Segmented
              label="Hang it with"
              value={o.hang}
              options={[
                { value: 'screws', label: 'Screws', title: 'Screwed to the wall through the board' },
                { value: 'cleat', label: 'French cleat', title: 'A cleat on the back drops over one on the wall' },
                { value: 'door', label: 'Door hooks', title: 'Hooks over the top of a door' },
                { value: 'desk', label: 'On a desk', title: 'Feet it stands in, or clamps on the desk’s edge' },
              ]}
              onChange={(hang) => set({ hang })}
              hint={whole ? hangHint : 'Other ways to hang need the tiles to make a whole rectangle: this board is screwed to the wall.'}
            />
            {o.hang === 'door' && (
              <LengthInput
                label="Door thickness"
                value={o.doorThickness}
                min={20}
                max={70}
                onChange={(doorThickness) => set({ doorThickness })}
                hint="Most inside doors are 35–45 mm."
              />
            )}
            {o.hang === 'desk' && (
              <div className="row2">
                <Segmented
                  label="On the desk"
                  value={o.deskMount}
                  options={[
                    { value: 'stand', label: 'Feet', title: 'Two feet (three on a wide board) it stands in' },
                    { value: 'clamp', label: 'Clamps', title: 'Clamps on the desk’s back edge' },
                  ]}
                  onChange={(deskMount) => set({ deskMount })}
                />
                {o.deskMount === 'clamp' && (
                  <LengthInput label="Desk thickness" value={o.deskThickness} min={10} max={80} onChange={(deskThickness) => set({ deskThickness })} />
                )}
              </div>
            )}
          </Find>
        )}
        {p.hang !== 'desk' && (
          <Find id="skadis-standoff">
            <Segmented
              label="Off the wall on"
              value={p.standoff}
              options={[
                { value: 'posts', label: 'Posts', title: 'Posts printed on the back of each tile, around the screw holes' },
                ...(p.hang === 'screws' ? [{ value: 'spacers' as const, label: 'Spacers', title: 'Separate printed tubes behind each screw hole' }] : []),
                { value: 'none', label: 'Nothing', title: 'Flat on its back: for a frame or spacers you have' },
              ]}
              onChange={(standoff) => set({ standoff })}
              hint={
                p.hang !== 'screws'
                  ? p.standoff === 'posts'
                    ? 'Posts on the back, with no screws: rests that hold the bottom as far out as the top.'
                    : 'Nothing holds the bottom out: the board leans in.'
                  : o.standoff === 'none'
                    ? 'Hooks need room behind the board: hang it on a frame or battens.'
                    : o.standoff === 'posts'
                      ? 'The posts print with the tiles, standing up from the back: no supports, nothing to lose.'
                      : 'The board prints flat and quick; the spacers print with the joint plates.'
              }
            />
            {(p.standoff !== 'none' || p.hang !== 'screws') && (
              <LengthInput
                label={p.hang === 'cleat' ? 'Cleat thickness' : 'Gap behind the board'}
                value={o.depth}
                min={5}
                max={60}
                onChange={(depth) => set({ depth })}
                hint={
                  p.depth > o.depth
                    ? `${p.hang === 'cleat' ? 'A cleat needs' : 'Door hooks need'} ${p.depth} mm or more: it is ${p.depth} mm.`
                    : 'Room for the hooks to clip behind: 15–20 mm suits most.'
                }
              />
            )}
          </Find>
        )}
        <Find id="skadis-screws">
          <div className="row2">
            <NumberInput
              label="Screw"
              value={o.screw}
              min={3}
              max={6}
              step={0.5}
              onChange={(screw) => set({ screw })}
              hint={`Countersunk, head ⌀${fmt(headDiameter(o.screw))}.`}
            />
            {!hex && p.hang !== 'desk' && (
              <LengthInput
                label={p.hang === 'screws' ? 'Screws about every' : 'Rests about every'}
                value={o.mountEvery}
                min={60}
                max={600}
                onChange={(mountEvery) => set({ mountEvery })}
              />
            )}
          </div>
          <div className="field-hint">
            {hex
              ? `Two per hexagon, in its ${byTiles ? 'top and bottom' : 'side'} corners${o.standoff === 'spacers' ? ', plus one in each other corner to hold its spacer' : ''}.`
              : p.hang === 'screws'
                ? 'Every tile is screwed near its corners, and between them about this far apart; always where there is no slot.'
                : `The screws go through the board from the front into the ${p.hang === 'cleat' ? 'cleat' : p.hang === 'door' ? 'hooks' : o.deskMount === 'stand' ? 'feet' : 'clamps'}, where there is no slot; the wall takes no screws${p.hang === 'cleat' ? ' but the wall cleat’s' : ''}.`}
          </div>
        </Find>
        <Find id="skadis-covers" set={o.covers}>
          <Toggle
            label="Screw covers"
            checked={o.covers}
            onChange={(covers) => set({ covers })}
            hint={
              p.standoff !== 'posts' || o.screw > 5
                ? 'Snap-on caps over the screw heads: for screws up to 5 mm through posts.'
                : `Snap-on caps over the screw heads${info?.covers ? ` (${info.covers})` : ''}: each hole is sunk deeper, the head in its post, with a groove the cap’s legs click into.`
            }
          />
        </Find>
      </Section>

      <Section title="Board" find="skadis-board" set={changed('slotW', 'slotL', 'chamfer', 'thickness', 'border', 'corner', 'numbers')}>
        <Group find="skadis-slots" title="Slots" status={`${o.slotW} × ${o.slotL} mm, ${o.chamfer} mm chamfer`} active={changed('slotW', 'slotL', 'chamfer')}>
          <div className="row2">
            <NumberInput label="Slot width" value={o.slotW} min={4} max={8} step={0.1} onChange={(slotW) => set({ slotW })} />
            <NumberInput label="Slot length" value={o.slotL} min={10} max={25} step={0.5} onChange={(slotL) => set({ slotL })} />
          </div>
          <NumberInput
            label="Chamfer"
            value={o.chamfer}
            min={0}
            max={1.5}
            step={0.1}
            onChange={(chamfer) => set({ chamfer })}
            hint="On both faces, so hooks slide in."
          />
          <div className="field-hint">Standard: 5 × 15 mm. A little wider (5.5–6) if your hooks or printer run tight.</div>
        </Group>
        <Find id="skadis-thickness" set={changed('thickness')}>
          <NumberInput
            label="Thickness"
            value={o.thickness}
            min={3.5}
            max={10}
            step={0.1}
            onChange={(thickness) => set({ thickness })}
            hint="Standard boards are 5 mm: hooks are made for that."
          />
        </Find>
        <Find id="skadis-edge" set={changed('border', 'corner')}>
          <div className="row2">
            <LengthInput label="Border" value={o.border} min={4} max={60} onChange={(border) => set({ border })} />
            <LengthInput label="Corner radius" value={o.corner} min={0} max={30} onChange={(corner) => set({ corner })} />
          </div>
          <div className="field-hint">
            The least plastic between a slot and the outside edge.{p.border > o.border ? ` ${p.border} mm with the LED channel.` : ''}
          </div>
        </Find>
        {!hex && (
          <Find id="skadis-frame" set={changed('frame')}>
            <Segmented
              label="Frame"
              value={o.frame}
              options={[
                { value: 'none', label: 'None' },
                { value: 'rim', label: 'Rim', title: 'A rim proud of the front all round' },
                { value: 'led', label: 'Rim & LED', title: 'The rim, and a channel round the back edge for an LED strip facing the wall' },
              ]}
              onChange={(frame) => set({ frame })}
              hint={
                !whole
                  ? 'A frame needs the tiles to make a whole rectangle.'
                  : o.frame === 'none'
                    ? 'A rim round the front edge makes the board look finished.'
                    : `Strips ${rimWidth(p)} mm wide on the front border, printed flat and pressed on with pins (tiles print face down, so a rim can’t be part of them); they cross the seams, so they help hold the tiles in line.${
                        o.frame === 'led'
                          ? ` The tiles get a ${ledChannel(p)} mm channel round the back edge for the LED strip, LEDs toward the wall for a glow round the board, deeper at the corners for the wire joints.`
                          : ''
                      }`
              }
            />
            {o.frame !== 'none' && (
              <div className="row2">
                <LengthInput label="Rim height" value={o.rimHeight} min={2} max={12} onChange={(rimHeight) => set({ rimHeight })} hint="Proud of the front." />
                {o.frame === 'led' && (
                  <Segmented
                    label="LED strip"
                    value={o.ledWidth}
                    options={[8, 10, 12].map((v) => ({ value: v, label: `${v} mm` }))}
                    onChange={(ledWidth) => set({ ledWidth })}
                  />
                )}
              </div>
            )}
          </Find>
        )}
        {!hex && (
          <Find id="skadis-zones" set={o.zones.length > 0}>
            <div className="field-label">Solid zones</div>
            {o.zones.map((z, i) => (
              <div key={i} className="indent">
                <Segmented
                  label={`Zone ${i + 1}`}
                  value={z.kind}
                  options={[
                    { value: 'blank', label: 'Blank' },
                    { value: 'text', label: 'Text', title: 'Engraved in the front' },
                    { value: 'magnets', label: 'Magnets', title: '6 × 2 mm magnets glued in from the back' },
                  ]}
                  onChange={(kind) => setZone(i, { kind })}
                />
                <div className="row2">
                  <LengthInput label="From the left" value={z.x} min={0} max={o.width} onChange={(x) => setZone(i, { x })} />
                  <LengthInput label="Up from the bottom" value={z.y} min={0} max={o.height} onChange={(y) => setZone(i, { y })} />
                </div>
                <div className="row2">
                  <LengthInput label="Width" value={z.w} min={5} max={o.width} onChange={(w) => setZone(i, { w })} />
                  <LengthInput label="Height" value={z.h} min={5} max={o.height} onChange={(h) => setZone(i, { h })} />
                </div>
                {z.kind === 'text' && <TextInput label="Text" value={z.text} placeholder="SCREWDRIVERS" onChange={(text) => setZone(i, { text })} />}
                <div className="button-row">
                  <button className="danger" onClick={() => set({ zones: o.zones.filter((_, k) => k !== i) })}>
                    Remove zone {i + 1}
                  </button>
                </div>
              </div>
            ))}
            <div className="button-row">
              <button
                onClick={() =>
                  set({ zones: [...o.zones, { x: Math.max(0, o.width / 2 - 60), y: Math.max(0, o.height / 2 - 30), w: 120, h: 60, kind: 'blank', text: '' }] })
                }
              >
                Add a zone
              </button>
            </div>
            <div className="field-hint">
              Areas without slots, snapped to whole columns and rows (attachments can’t use them): blank, with text engraved in the front, or with 6 × 2 mm
              magnets glued in from the back for knives and bits{info?.magnets ? ` (${info.magnets} magnets)` : ''}. One across a seam is split between the
              tiles.
            </div>
          </Find>
        )}
        {!hex && (
          <Find id="skadis-numbers" set={changed('numbers')}>
            <Toggle
              label="Tile numbers on the back"
              checked={o.numbers}
              onChange={(numbers) => set({ numbers })}
              hint="As on the assembly map, so the tiles go up in order."
            />
          </Find>
        )}
        <MoreInAll
          ids={[
            ['skadis-slots', changed('slotW', 'slotL', 'chamfer')],
            ['skadis-thickness', changed('thickness')],
            ['skadis-edge', changed('border', 'corner')],
            ...(hex ? [] : [['skadis-numbers', changed('numbers')] as [string, boolean]]),
          ]}
        />
      </Section>
    </FindPanel>
  );
}

/** Tile sizes to pick from that fit the bed, mm: hexagons that keep one lattice, corner to corner (the four largest), or rectangles in whole steps. */
function tileSizes(o: SkadisOptions, areas: { w: number; d: number }[]): number[] {
  const P = plannedSkadis(o).pitch;
  if (o.shape === 'hex') {
    const cells = hexCells({ ...o, pitch: P }, areas).filter((c) => c.fits && c.off < 0.08);
    return [...new Set(cells.map((c) => Math.round(c.h * 10) / 10))].slice(-4);
  }
  const reach = o.join === 'both' || o.join === 'tabs' ? SKADIS.tab.depth + SKADIS.tab.gap : 0;
  const even = o.pattern === 'square';
  const snap = (v: number) => Math.round(Math.max(2, even ? 2 * Math.round(v / P / 2) : Math.round(v / P)) * P * 10) / 10;
  const fits = (v: number) => areas.some((a) => v + reach <= Math.min(a.w, a.d) + 1e-6);
  return [...new Set(TILE_SIZES.map(snap))].filter(fits);
}
