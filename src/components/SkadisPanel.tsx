import { useStore, useUnits } from '../state/store';
import { Group, LengthInput, NumberInput, Section, Segmented, TextInput, Toggle } from './fields';
import { DEFAULT_SKADIS, headDiameter, sanitizeSkadis, type SkadisOptions } from '../lib/geometry/skadis';
import type { PrintJob } from '../lib/project';
import { Find } from './findContext';
import { FindPanel, MoreInAll } from './find';
import { SKADIS_INDEX } from './skadisIndex';

/** IKEA's boards, width × height, mm (its slots start 20 mm from each edge, as Gridfit's do). */
const IKEA_BOARDS: [number, number][] = [
  [360, 560],
  [560, 560],
  [760, 560],
];

/**
 * The Drawer tab of a Skådis board (drawer.enclosure 'skadis'): the space on
 * the wall, the tiles, how they join and hang, and the board itself.
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

  const joinHint = !several
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
              { value: 'attachments', label: 'Just attachments', title: 'You have the board (IKEA’s, or one printed before): print only what hangs on it' },
            ]}
            onChange={(v) => setHave(v === 'attachments')}
            hint={
              have
                ? 'The board isn’t printed: give its size (or pick IKEA’s) and thickness, and the attachments are made to fit it.'
                : 'Have a board already? Pick Just attachments to print only what hangs on it.'
            }
          />
          {have && (
            <div className="wall-actions">
              {IKEA_BOARDS.map(([bw, bh]) => (
                <button key={`${bw}x${bh}`} onClick={() => set({ width: bw, height: bh, thickness: 5.1, slotW: 5.1, slotL: 15.2 })} title={`IKEA SKÅDIS ${bw / 10} × ${bh / 10} cm`}>
                  IKEA {bw / 10} × {bh / 10}
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
        <Find id="skadis-space">
          <div className="row2">
            <LengthInput label="Space width" value={o.width} min={60} onChange={(width) => set({ width })} />
            <LengthInput label="Space height" value={o.height} min={60} onChange={(height) => set({ height })} />
          </div>
          <div className="field-hint">
            The space on the wall. {hex ? 'Whole hexagons fit in it, centred.' : 'The board fills it, the slots centred with at least the border around them.'}{' '}
            IKEA’s own boards are 56 × 56, 76 × 56 and 36 × 56 cm.
          </div>
        </Find>
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
                ? 'Each hexagon is a board of its own, screwed up in its left and right corners.'
                : 'Upright seams take the place of a column of slots; level seams run through a row of slots, so the slots they cut are whole once the tiles are together.'
            }
          />
        </Find>
        {hex && (
          <Find id="skadis-hex">
            <div className="row2">
              <LengthInput
                label="Hexagon width"
                value={o.hexWidth}
                allowEmpty
                placeholder={info?.hexW ? `auto (${fmt(info.hexW)})` : 'auto'}
                min={60}
                max={1000}
                onChange={(hexWidth) => set({ hexWidth })}
              />
              <LengthInput label="Gap between" value={o.hexGap} min={0} max={50} onChange={(hexGap) => set({ hexGap })} />
            </div>
            <div className="field-hint">Corner to corner. Empty: the largest the bed and the space take.</div>
          </Find>
        )}
        <div className="summary">
          <div className="summary-big">
            {hex ? (
              <>
                {tiles} <small>hexagon{tiles === 1 ? '' : 's'}</small>
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
              <dt>{hex ? 'Hexagon' : 'Largest tile'}</dt>
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
        {!hex && (
          <Find id="skadis-join">
            <Segmented
              label="Join the tiles with"
              value={o.join}
              options={[
                { value: 'both', label: 'Tabs & plates', title: 'Dovetail tabs along the seams, and plates on the back with pins' },
                { value: 'tabs', label: 'Tabs', title: 'Dovetail tabs along the seams' },
                { value: 'plates', label: 'Plates', title: 'Plates pressed into pockets on the back, with pins' },
                { value: 'none', label: 'Nothing', title: 'Tiles butt together; each is screwed up on its own' },
              ]}
              onChange={(join) => set({ join })}
              hint={joinHint}
            />
          </Find>
        )}
        <Find id="skadis-standoff">
          <Segmented
            label="Off the wall on"
            value={o.standoff}
            options={[
              { value: 'posts', label: 'Posts', title: 'Posts printed on the back of each tile, around the screw holes' },
              { value: 'spacers', label: 'Spacers', title: 'Separate printed tubes behind each screw hole' },
              { value: 'none', label: 'Nothing', title: 'Flat on its back: for a frame or spacers you have' },
            ]}
            onChange={(standoff) => set({ standoff })}
            hint={
              o.standoff === 'none'
                ? 'Hooks need room behind the board: hang it on a frame or battens.'
                : o.standoff === 'posts'
                  ? 'The posts print with the tiles, standing up from the back: no supports, nothing to lose.'
                  : 'The board prints flat and quick; the spacers print with the joint plates.'
            }
          />
          {o.standoff !== 'none' && (
            <LengthInput
              label="Gap behind the board"
              value={o.depth}
              min={5}
              max={60}
              onChange={(depth) => set({ depth })}
              hint="Room for the hooks to clip behind: IKEA’s are fine with 15–20 mm."
            />
          )}
        </Find>
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
            {!hex && <LengthInput label="Screws about every" value={o.mountEvery} min={60} max={600} onChange={(mountEvery) => set({ mountEvery })} />}
          </div>
          <div className="field-hint">
            {hex
              ? `Two per hexagon, in its side corners${o.standoff === 'spacers' ? ', plus one in each other corner to hold its spacer' : ''}.`
              : 'Every tile is screwed near its corners, and between them about this far apart; always where there is no slot.'}
          </div>
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
          <div className="field-hint">IKEA: 5 × 15 mm. A little wider (5.5–6) if your hooks or printer run tight.</div>
        </Group>
        <Find id="skadis-thickness" set={changed('thickness')}>
          <NumberInput
            label="Thickness"
            value={o.thickness}
            min={3.5}
            max={10}
            step={0.1}
            onChange={(thickness) => set({ thickness })}
            hint="IKEA’s board is 5 mm: its hooks are made for that."
          />
        </Find>
        <Find id="skadis-edge" set={changed('border', 'corner')}>
          <div className="row2">
            <LengthInput label="Border" value={o.border} min={4} max={60} onChange={(border) => set({ border })} />
            <LengthInput label="Corner radius" value={o.corner} min={0} max={30} onChange={(corner) => set({ corner })} />
          </div>
          <div className="field-hint">The least plastic between a slot and the outside edge.</div>
        </Find>
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
