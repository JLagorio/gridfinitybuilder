/**
 * Skådis boards' plans (enclosures.ts EnclosurePlan): the tiles are the floor
 * pieces, the joint plates, spacers, frame strips, screw covers and what it
 * hangs from its parts, and the drawer view shows the board lying face up as
 * it hangs. It hands its planner to skadisBoards.ts as it loads, which the app
 * does with the first board, and with it the planning of boards built from
 * tiles (geometry/skadisTiles.ts): none of it is on the first screen.
 */
import type { EnclosureHardware, EnclosurePart, EnclosurePartPlan, EnclosurePlan, EnclosureSceneItem, SkadisInfo, planEnclosure } from './enclosures';
import { packPieces, skadisAreas } from './enclosures';
import { boardBaseplate, setSkadisBoardPlanner } from './skadisBoards';
import {
  SKADIS,
  capSize,
  coverHole,
  hangPartSize,
  headDiameter,
  planSkadis,
  plannedSkadis,
  plateSize,
  rimPins,
  sanitizeSkadis,
  skadisCapPart,
  skadisGap,
  skadisPlatePart,
  skadisSpacerPart,
  skadisTileSpecs,
  tileBounds,
  type SkadisPlan,
  type SkadisRimPart,
} from './geometry/skadis';
// Boards built from tiles plan with this (geometry/skadis.ts setTilesPlanner).
import './geometry/skadisTiles';
// Its cleats, door hooks and frame strips in what's been printed (printed.ts setPrintKey).
import './printedBoards';
import { wallBoard } from './wall/plan';
import type { Vec3 } from './geometry/kernel';
import type { GridLayout } from './layout/drawer';
import type { BaseplatePlan, PrintSetup } from './layout/plan';
import type { PieceDef } from './layout/split';

const r1 = (v: number) => Math.round(v * 10) / 10;

/** A tile as a floor piece. */
const pieceOfTile = (t: SkadisPlan['tiles'][number]): PieceDef => ({
  id: t.id,
  col: t.col,
  row: t.row,
  x0: t.x0,
  y0: t.y0,
  x1: t.x1,
  y1: t.y1,
  // Not grid cells: the tile's place in the board's columns and rows.
  cells: { x0: t.col, x1: t.col + 1, y0: t.row, y1: t.row + 1 },
  outer: { left: t.outer.left, right: t.outer.right, front: t.outer.bottom, back: t.outer.top },
});

/**
 * A Skådis board for the space on the wall (drawer.skadis): its tiles are the
 * floor pieces, the joint plates and spacers its parts. The drawer view shows
 * it lying face up on its standoffs, as it hangs (the wall's up is the view's
 * back), so attachments stand on its front; the tiles, printed face down, are
 * turned over for it (EnclosureScene.pieceTurn).
 */
export function planSkadisBoard(d: Parameters<typeof planEnclosure>[0], layout: GridLayout, setup: PrintSetup): EnclosurePlan {
  const raw = plannedSkadis(sanitizeSkadis(d.drawer.skadis));
  const plan = planSkadis(raw, skadisAreas(setup));
  // Built from tiles, the board is as big as they make it.
  const o = { ...raw, width: plan.W, height: plan.H };
  const specs = skadisTileSpecs(plan, o);
  const pieces = plan.tiles.map(pieceOfTile);
  const bounds = specs.map(tileBounds);
  const warnings = [...plan.warnings];
  if (plan.error) warnings.push(plan.error);
  const byId = new Map(pieces.map((p, i) => [p.id, i]));
  const sizeOfPiece = (p: PieceDef) => bounds[byId.get(p.id)!];
  const bp: BaseplatePlan = {
    pieces,
    plates: packPieces(pieces, sizeOfPiece, setup),
    cols: plan.cols,
    rows: plan.rows,
    ...(plan.error ? { error: plan.error } : {}),
  };
  // Face up: the back (with posts, on spacers, or held off by a cleat or door hooks) at the bottom.
  const T = o.thickness;
  const back = skadisGap(o);
  const pieceAt: Record<number, Vec3> = {};
  plan.tiles.forEach((t, i) => {
    const b = bounds[i];
    pieceAt[t.id] = [r1(t.x0 + b.x0), r1(t.y0 + b.y0), o.standoff === 'posts' ? 0 : back];
  });
  const parts: EnclosurePartPlan[] = [];
  const views: EnclosurePlan['views'] = [];
  const items: EnclosureSceneItem[] = [];
  const plates = plan.joints.filter((j) => j.kind === 'plate');
  const tabs = plan.joints.length - plates.length;
  // Screws into the wall, and into the parts it hangs from.
  const screws = plan.mounts.filter((m) => m.screw && !m.hang);
  const hangScrews = plan.mounts.filter((m) => m.hang).length;
  const spacers = o.standoff === 'spacers' ? screws : [];
  // Snap-on covers over the screws through the posts.
  const hole = coverHole(o);
  const covered = hole ? screws : [];
  if (o.covers && !covered.length) warnings.push('Screw covers need screws through posts (Off the wall on posts), up to 5 mm: there are none to cover.');
  const HANG = {
    boardCleat: ['Board cleat', 'board cleat'],
    wallCleat: ['Wall cleat', 'board cleat'],
    hook: ['Door hook', 'door hooks'],
    foot: ['Desk foot', 'desk feet'],
    clamp: ['Desk clamp', 'desk clamps'],
  } as const;
  // What the board screws on to.
  const onto = plan.hang.length ? HANG[plan.hang[0].kind][1] : '';
  // Small parts share plates: named for what's on them.
  const group =
    plan.rim.length || onto || covered.length
      ? 'Board parts'
      : plates.length && spacers.length
        ? 'Joint plates & spacers'
        : plates.length
          ? 'Joint plates'
          : 'Standoff spacers';
  if (plates.length) {
    const plate = skadisPlatePart(o);
    const part: EnclosurePart = { kind: 'skadisPlate', plate };
    const meshKey = `skadisplate|${JSON.stringify(plate)}`;
    const size = plateSize(plate);
    plates.forEach((j, i) => {
      parts.push({ key: `jointplate:${i + 1}`, name: `Joint plate ${i + 1}`, kind: 'enclosure', part, meshKey, ...size, group });
      // In its pocket under the board, pins up in their holes, a hair inside the back.
      const tile = plan.tiles.find((t) => j.x >= t.x0 - 1e-6 && j.x <= t.x1 + 1e-6 && j.y >= t.y0 - 1e-6 && j.y <= t.y1 + 1e-6);
      items.push({
        id: `skadis-plate-${i}`,
        meshKey,
        x: j.x - plate.size / 2,
        y: j.y - plate.size / 2,
        z: back + SKADIS.plate.pocket - plate.t,
        ...size,
        role: 'joint',
        when: 'always',
        ...(tile ? { col: tile.col, row: tile.row } : {}),
      });
    });
  }
  if (spacers.length) {
    const spacer = skadisSpacerPart(o);
    const part: EnclosurePart = { kind: 'skadisSpacer', spacer };
    const meshKey = `skadisspacer|${JSON.stringify(spacer)}`;
    const size = { w: spacer.d, d: spacer.d, h: spacer.h };
    spacers.forEach((m, i) => {
      parts.push({ key: `standoff:${i + 1}`, name: `Standoff spacer ${i + 1}`, kind: 'enclosure', part, meshKey, ...size, group });
      const tile = plan.tiles.find((t) => t.id === m.tile);
      items.push({
        id: `skadis-spacer-${i}`,
        meshKey,
        x: m.x - spacer.d / 2,
        y: m.y - spacer.d / 2,
        z: 0,
        ...size,
        role: 'standoff',
        when: 'always',
        ...(tile ? { col: tile.col, row: tile.row } : {}),
      });
    });
  }
  // Frame strips on the front, pins down into the border.
  plan.rim.forEach((s, i) => {
    const rim: SkadisRimPart = { ...s, W: o.width, H: o.height, R: o.corner, height: o.rimHeight, pinD: SKADIS.rim.pinD, pinH: rimPins(o).pin };
    const part: EnclosurePart = { kind: 'skadisRim', rim };
    const meshKey = `skadisrim|${JSON.stringify(rim)}`;
    const size = { w: s.x1 - s.x0, d: s.y1 - s.y0, h: rim.height + rim.pinH };
    parts.push({ key: `frame:${i + 1}`, name: `Frame strip ${i + 1} (${r1(Math.max(size.w, size.d))} mm)`, kind: 'enclosure', part, meshKey, ...size, group });
    items.push({ id: `skadis-frame-${i}`, meshKey, x: s.x0, y: s.y0, z: back + T - rim.pinH, ...size, turn: [180, 0, 0], role: 'strip', when: 'always' });
  });
  if (hole && covered.length) {
    const cap = skadisCapPart(hole);
    const part: EnclosurePart = { kind: 'skadisCap', cap };
    const meshKey = `skadiscap|${JSON.stringify(cap)}`;
    const size = capSize(cap);
    covered.forEach((m, i) => {
      parts.push({ key: `cover:${i + 1}`, name: `Screw cover ${i + 1}`, kind: 'enclosure', part, meshKey, ...size, group });
      // On the front, legs down in its hole.
      const tile = plan.tiles.find((t) => t.id === m.tile);
      items.push({
        id: `skadis-cover-${i}`,
        meshKey,
        x: m.x - cap.d / 2,
        y: m.y - cap.d / 2,
        z: back + T - cap.legs,
        ...size,
        turn: [180, 0, 0],
        role: 'strip',
        when: 'always',
        ...(tile ? { col: tile.col, row: tile.row } : {}),
      });
    });
  }
  // What it hangs from, where it goes behind (or under) the board.
  const nth: Record<string, number> = {};
  plan.hang.forEach((h, i) => {
    nth[h.kind] = (nth[h.kind] ?? 0) + 1;
    const hardware =
      h.kind === 'wallCleat'
        ? [{ item: `Countersunk screws ⌀${o.screw} (French cleat)`, count: h.holes.length, note: 'into the wall' }]
        : h.bolt && [{ item: 'M6 × 30 mm bolts with nuts (desk clamps)', count: 1 }];
    const part: EnclosurePart = { kind: 'skadisHang', hang: h, ...(hardware ? { hardware } : {}) };
    const meshKey = `skadishang|${JSON.stringify(h)}`;
    const { z0, y0, ...size } = hangPartSize(h);
    parts.push({ key: `hang:${i + 1}`, name: `${HANG[h.kind][0]} ${nth[h.kind]}`, kind: 'enclosure', part, meshKey, ...size, group });
    const turn: Vec3 | undefined = h.pose === 'back' ? undefined : h.pose === 'front' ? [180, 0, 0] : [0, -90, 0];
    items.push({
      id: `skadis-hang-${i}`,
      meshKey,
      x: h.x,
      y: y0,
      z: back - h.board + z0,
      ...size,
      ...(turn ? { turn } : {}),
      role: h.pose === 'side' ? 'foot' : 'cleat',
      when: 'always',
    });
  });

  const hex = plan.shape === 'hex';
  const what = hex ? 'hexagon' : 'tile';
  const long = r1(T + (o.standoff === 'none' ? 0 : o.depth) + 30);
  const screwItem = `Countersunk screws ⌀${o.screw} × ${long} mm or longer (Skådis board)`;
  const magnets = specs.reduce((n, s) => n + (s.magnets?.length ?? 0), 0);
  const steps: string[] = [];
  if (pieces.length) {
    steps.push(
      `Skådis board: ${pieces.length} ${what}${pieces.length === 1 ? '' : 's'}, ${hex && plan.grid ? 'all alike: any goes in any place on this map' : 'numbered on the back as on this map'}.`,
    );
    if (!hex && pieces.length > 1) {
      if (tabs) steps.push('Lay the tiles face down in order and slide the dovetail tabs into their sockets, a row at a time.');
      if (plates.length)
        steps.push(`Press the ${plates.length} joint plates into the pockets across the seams (pins down); a drop of glue in each makes it one board.`);
      if (!tabs && !plates.length) steps.push('The tiles are not joined: screw each one up on its own, edge to edge.');
    }
    if (magnets) steps.push(`Glue ${magnets} magnets into the pockets on the back, all the same way up.`);
    if (o.frame === 'led') steps.push('Stick the LED strip in the channel round the back edge, LEDs to the wall.');
    if (plan.rim.length) steps.push('Glue the frame strips onto the front border, pins in their holes.');
    if (o.standoff === 'spacers') steps.push(`Put a ${o.depth} mm spacer behind each screw hole.`);
    if (screws.length) {
      const by = o.standoff === 'none' ? '' : ` ${o.depth} mm off the wall`;
      steps.push(`Screw it to the wall through the ${screws.length} countersunk holes${by}, with wall plugs where the wall needs them.`);
    }
    if (hex && o.standoff === 'posts')
      steps.push(
        plan.grid
          ? 'The posts in the side corners rest on the wall; the screws go through the top and bottom ones.'
          : 'The posts in the top and bottom corners rest on the wall; the screws go through the left and right ones.',
      );
    if (hex && plan.grid && pieces.length > 1)
      steps.push(
        plates.length
          ? `Press the ${plates.length === 1 ? 'joint plate' : `${plates.length} joint plates`} into the pockets across the gaps between hexagons side by side (pins down, a drop of glue in each): they hold them in line, so a part can span two.`
          : `Hang the hexagons ${o.hexGap} mm apart and in line, as on the map: their slots are on one lattice, so a part can span two side by side.`,
      );
    if (covered.length) steps.push(`Push a cover onto each of the ${covered.length} screw heads: its legs click into the groove round the hole.`);
    if (onto) steps.push(`Screw the ${onto} on from the front, through the ${hangScrews} holes in the board.`);
    if (o.hang === 'cleat') steps.push('Screw the wall cleat level to the wall, its sloping edge up, and hang the board on it.');
    if (o.hang === 'door') steps.push('Hang the board over the door: 2.5 mm goes over its top.');
    if (o.hang === 'desk') steps.push(o.deskMount === 'stand' ? 'Stand it on the desk.' : 'Slide the clamps over the desk’s back edge and tighten the bolts.');
    steps.push(o.pitch === 20 ? 'Skådis hooks and accessories hang in the slots.' : 'Attachments made for this board (Attachments tab) hang in its slots.');
  }

  const info: SkadisInfo = {
    shape: plan.shape,
    tiles: pieces.length,
    cols: plan.cols,
    rows: plan.rows,
    slots: plan.slots,
    tabs,
    plates: plates.length,
    mounts: plan.mounts.length,
    screws: screws.length + hangScrews,
    tileW: bounds.length ? r1(Math.max(...bounds.map((b) => b.w))) : 0,
    tileD: bounds.length ? r1(Math.max(...bounds.map((b) => b.d))) : 0,
    ...(plan.hex ? { hexW: r1(plan.hex.w), hexH: r1(plan.hex.h) } : {}),
    ...(magnets ? { magnets } : {}),
    ...(covered.length ? { covers: covered.length } : {}),
    boardW: hex && plan.hex ? r1(Math.max(...plan.tiles.map((t) => t.x1)) - Math.min(...plan.tiles.map((t) => t.x0))) : o.width,
    boardH: hex && plan.hex ? r1(Math.max(...plan.tiles.map((t) => t.y1)) - Math.min(...plan.tiles.map((t) => t.y0))) : o.height,
    ...(plan.grid ? { grid: plan.grid } : {}),
  };
  return {
    kind: 'skadis',
    pieceLayout: layout,
    // Nothing of the baseplate's: no joints, pads or holes of its own.
    baseplate: boardBaseplate(d.baseplate),
    plan: bp,
    piece: (p) => {
      const i = byId.get(p.id);
      if (i === undefined) return null;
      const tile = specs[i];
      const b = bounds[i];
      const n = tile.mounts.filter((m) => m.screw && !m.hang).length;
      const nh = tile.mounts.filter((m) => m.hang).length;
      const hardware: EnclosureHardware[] = [];
      if (n) hardware.push({ item: screwItem, count: n, note: 'into the wall, with plugs where it needs them' });
      if (nh) hardware.push({ item: `Countersunk screws ⌀${o.screw} × ${plan.hangScrew} mm (Skådis board to its ${onto})`, count: nh });
      if (tile.magnets) hardware.push({ item: 'Magnets 6 × 2 mm (Skådis board)', count: tile.magnets.length });
      // The LED strip goes with the first tile.
      if (o.frame === 'led' && !i)
        hardware.push({ item: `LED strip ${o.ledWidth} mm wide (Skådis board)`, count: 1, note: `${r1((o.width + o.height) / 500)} m round the back edge` });
      return {
        enclosure: { kind: 'skadis', origin: [0, 0, 0], cuts: [], tile, ...(hardware.length ? { hardware } : {}) },
        w: b.w,
        d: b.d,
        h: b.h,
        name: `Skådis ${what} ${p.id}`,
        meshKey: `skadis|${JSON.stringify(tile)}`,
      };
    },
    parts,
    views,
    steps,
    warnings,
    binNotes: [],
    room: Infinity,
    scene: {
      kind: 'skadis',
      pieceAt,
      items,
      shift: { x: 0, y: 0 },
      showBins: false,
      outline: false,
      seat: back + T,
      box: { x0: 0, y0: 0, x1: o.width, y1: o.height, h: back + T },
      pieceTurn: [0, 180, 0],
      wall: { board: wallBoard(plan, o), placed: [] },
      info: { skadis: info },
    },
    map: skadisMap(plan, info, o, steps),
    wall: wallBoard(plan, o),
  };
}

/** The board's assembly map: which tile goes where, seen from the front (the plates it prints on follow: project.ts assemblyMaps). */
function skadisMap(plan: SkadisPlan, info: SkadisInfo, o: ReturnType<typeof sanitizeSkadis>, steps: string[]): string {
  const lines: string[] = ['SKÅDIS BOARD ASSEMBLY MAP', '='.repeat(40)];
  const hex = plan.shape === 'hex';
  const g = plan.grid;
  lines.push(g ? `Built from tiles: ${r1(o.width)} × ${r1(o.height)} mm in all` : `Space: ${r1(o.width)} × ${r1(o.height)} mm`);
  if (hex && plan.hex)
    lines.push(
      `Hexagons: ${plan.tiles.length}, ${g ? `${r1(plan.hex.h)} mm corner to corner (top to bottom), ${r1(plan.hex.w)} mm across` : `${r1(plan.hex.w)} mm corner to corner, ${r1(plan.hex.h)} mm high`}, ${o.hexGap} mm apart${g ? ', on one slot lattice' : ''}`,
    );
  else
    lines.push(
      `Board: ${r1(o.width)} × ${r1(o.height)} mm in ${g ? `${plan.tiles.length} tiles of ${r1(g.q[0])} × ${r1(g.r[1])} mm` : `${plan.cols} × ${plan.rows} tiles`}`,
    );
  const pattern = o.pattern === 'skadis' && o.pitch === 20 ? 'standard Skådis spacing' : `${o.pattern} pattern, ${o.pitch} mm step`;
  lines.push(`Slots: ${plan.slots} (${o.slotW} × ${o.slotL} mm, ${pattern})`);
  if (info.plates || info.tabs) lines.push(`Joints: ${info.tabs} dovetail tabs, ${info.plates} joint plates`);
  if (info.mounts)
    lines.push(`Mounting: ${info.screws} screw holes${o.standoff === 'none' ? '' : `, ${o.depth} mm ${o.standoff === 'posts' ? 'posts' : 'spacers'}`}`);
  const n = plan.hang.length;
  if (n)
    lines.push(
      `Hangs from: ${o.hang === 'cleat' ? 'a French cleat' : o.hang === 'door' ? `${n} door hooks` : `${n} desk ${o.deskMount === 'stand' ? 'feet' : 'clamps'}`}`,
    );
  lines.push('', 'Seen from the front (as on the wall). Numbers are on the back of each tile.');
  if (!hex) {
    for (let r = plan.rows - 1; r >= 0; r--) {
      // A gap where a board built from tiles has none.
      const row = Array.from({ length: plan.cols }, (_, c) => plan.tiles.find((t) => t.row === r && t.col === c));
      lines.push(('  ' + row.map((t) => (t ? `[${String(t.id).padStart(3)} ]` : ' '.repeat(6))).join(' ')).trimEnd());
    }
  } else {
    for (const t of [...plan.tiles].sort((a, b) => b.y0 - a.y0 || a.x0 - b.x0)) {
      lines.push(`  Hexagon ${t.id}: centre ${r1((t.x0 + t.x1) / 2)} mm from the left, ${r1((t.y0 + t.y1) / 2)} mm up`);
    }
  }
  lines.push('', 'TILES', '-'.repeat(40));
  for (const t of plan.tiles)
    lines.push(`${hex ? 'Hexagon' : 'Tile'} ${t.id}: ${r1(t.x1 - t.x0)} × ${r1(t.y1 - t.y0)} mm, ${r1(t.x0)} mm from the left, ${r1(t.y0)} mm up`);
  if (steps.length) lines.push('', ...steps);
  if (info.screws) lines.push(`Screws: ⌀${o.screw} countersunk (head ⌀${r1(headDiameter(o.screw))} mm).`);
  if (info.covers) lines.push(`Screw covers: ${info.covers}, snapped over the screw heads.`);
  lines.push('');
  return lines.join('\n') + '\n';
}

setSkadisBoardPlanner(planSkadisBoard);
