/**
 * Adding and taking away a board's tiles (SkadisOptions.tiles, a board built
 * from tiles): one undo step each, through the drawer like the board's other
 * settings. A tile added left of or below the others moves the board's
 * bottom-left corner, which wall coordinates start from, so the attachments
 * and zones move with it and stay on the slots they were on.
 */
import { history, useStore } from './store';
import { planSkadis, sanitizeSkadis, type SkadisCell } from '../lib/geometry/skadis';
import { skadisAreas } from '../lib/enclosures';

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const same = (a: SkadisCell, b: SkadisCell) => a[0] === b[0] && a[1] === b[1];

/** Where tile (0, 0) is on the board (wall coordinates), as planned for the printer. */
function originOf(skadis: unknown): [number, number] | null {
  const s = useStore.getState();
  return planSkadis(sanitizeSkadis(skadis), skadisAreas(s.setup)).grid?.origin ?? null;
}

/** The active board's tiles: these, its attachments and zones moved with them. */
export function setTiles(tiles: SkadisCell[]) {
  const s = useStore.getState();
  const o = sanitizeSkadis(s.drawer.skadis);
  const next = { ...o, tiles: sanitizeSkadis({ tiles }).tiles };
  if (String(next.tiles) === String(o.tiles)) return;
  const a = originOf(o);
  const b = originOf(next);
  const [dx, dy] = a && b ? [b[0] - a[0], b[1] - a[1]] : [0, 0];
  const attachments = s.drawer.attachments?.map((q) => ({ ...q, x: r3(q.x + dx), y: r3(q.y + dy) }));
  history.checkpoint();
  useStore.setState({
    drawer: {
      ...s.drawer,
      skadis: { ...next, zones: next.zones.map((z) => ({ ...z, x: r3(z.x + dx), y: r3(z.y + dy) })) },
      ...(attachments ? { attachments } : {}),
    },
  });
  history.checkpoint();
}

export function addTile(at: SkadisCell) {
  const tiles = sanitizeSkadis(useStore.getState().drawer.skadis).tiles;
  if (!tiles.some((t) => same(t, at))) setTiles([...tiles, at]);
}

/** Take a tile away (a board keeps one at least). */
export function removeTile(at: SkadisCell) {
  const tiles = sanitizeSkadis(useStore.getState().drawer.skadis).tiles;
  if (tiles.length > 1) setTiles(tiles.filter((t) => !same(t, at)));
}
