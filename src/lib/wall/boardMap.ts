/**
 * A Skådis board's map, for the drawer map dialog (components/DrawerMapDialog.tsx): the board from the front with
 * every attachment outlined where it hangs and numbered, its name in it where there's room, and under the board a
 * list of each one with its label and what's in it. Like a drawer's map (lib/inventory.ts drawerMap), it's in mm;
 * its text is sized to the board, so a print fitted to a page reads, to pin up beside it.
 */
import { attachmentEntries, attachmentTitle, fitLines, textBlock, type DrawerMap, type TextLine } from '../inventory';
import { formatLength, type InchPrecision, type Units } from '../units';
import type { NamedDrawer } from '../project';
import type { WallBoard, WallPlacement } from './plan';

const INK = '#1d2025';
const SOFT = '#6b7380';
const n2 = (v: number) => String(Math.round(v * 100) / 100);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const rect = (x: number, y: number, w: number, h: number, extra: string) => `<rect x="${n2(x)}" y="${n2(y)}" width="${n2(w)}" height="${n2(h)}" ${extra}/>`;

export function boardMap(d: NamedDrawer, wall: { board: WallBoard; placed: WallPlacement[] }, o: { units?: Units; precision?: InchPrecision } = {}): DrawerMap {
  const { board, placed } = wall;
  const fmt = (mm: number) => formatLength(mm, o.units ?? 'mm', { precision: o.precision });
  const W = board.W;
  const H = board.H;
  // The text unit: 1% of the board's longer side.
  const u = Math.max(W, H) / 100;
  const M = 3 * u;
  const HEAD = 8 * u;
  const ox = M;
  const oy = M + HEAD;
  const X = (x: number) => ox + x;
  const Y = (y: number) => oy + H - y;
  // In reading order: top to bottom, left to right.
  const parts = [...placed].sort((p, q) => q.y1 - p.y1 || p.x0 - q.x0);
  const byId = new Map(attachmentEntries([d]).map((e) => [e.attachment.id, e]));
  const rows = Math.ceil(parts.length / 2);
  const lineH = 2.4 * u;
  const listTop = oy + H + 3 * u;
  const total = { w: W + 2 * M, h: listTop + rows * lineH + M };
  const s: string[] = [rect(0, 0, total.w, total.h, 'fill="#ffffff"')];

  s.push(
    `<text x="${n2(M)}" y="${n2(M + 4 * u)}" font-size="${n2(4 * u)}" font-weight="700" fill="${INK}">${esc(d.name)}</text>`,
    `<text x="${n2(M)}" y="${n2(M + 6.8 * u)}" font-size="${n2(1.9 * u)}" fill="${SOFT}">${esc(
      `Skådis board ${fmt(W)} × ${fmt(H)} · ${parts.length} part${parts.length === 1 ? '' : 's'} · seen from the front`,
    )}</text>`,
  );
  // The board: its tiles, and its slots faintly.
  for (const t of board.outlines) {
    s.push(`<polygon points="${t.map(([x, y]) => `${n2(X(x))},${n2(Y(y))}`).join(' ')}" fill="#f2f4f7" stroke="#b9bec6" stroke-width="${n2(0.25 * u)}"/>`);
  }
  const slots = board.slots.map(
    ([x, y]) => `M${n2(X(x) - board.ctx.slotW / 2)} ${n2(Y(y) - board.ctx.slotL / 2)}h${n2(board.ctx.slotW)}v${n2(board.ctx.slotL)}h${n2(-board.ctx.slotW)}z`,
  );
  s.push(`<path d="${slots.join('')}" fill="#dfe2e6"/>`);

  parts.forEach((p, i) => {
    const e = byId.get(p.id);
    const x = X(p.x0);
    const y = Y(p.y1);
    const w = p.x1 - p.x0;
    const h = p.y1 - p.y0;
    const g: string[] = [rect(x, y, w, h, `rx="${n2(0.6 * u)}" fill="#e9ecf0" stroke="${INK}" stroke-width="${n2(0.3 * u)}"`)];
    // Its number in a dot at the top left; its name under it where there's room.
    const r = Math.min(1.5 * u, w / 2, h / 2);
    g.push(
      `<circle cx="${n2(x + r)}" cy="${n2(y + r)}" r="${n2(r)}" fill="${INK}"/>`,
      `<text x="${n2(x + r)}" y="${n2(y + r + r * 0.42)}" font-size="${n2(r * 1.2)}" font-weight="700" text-anchor="middle" fill="#ffffff">${i + 1}</text>`,
    );
    const name = e ? e.title : p.name;
    if (w > 6 * u && h > 4.5 * u)
      g.push(textBlock([{ text: name, bold: true }], x + 0.6 * u, y + 2 * r + 0.3 * u, w - 1.2 * u, h - 2 * r - 0.9 * u, 2.4 * u, 1.2 * u));
    s.push(`<g data-attachment="${esc(p.id)}">${g.join('')}</g>`);
  });

  // The list: two columns, top to bottom.
  const colW = (W - 2 * u) / 2;
  parts.forEach((p, i) => {
    const e = byId.get(p.id);
    const col = i < rows ? 0 : 1;
    const row = col ? i - rows : i;
    const title = e ? attachmentTitle(e) : p.name;
    const line: TextLine = { text: `${i + 1}  ${title}${e?.contents.length ? `: ${e.contents.join(', ')}` : ''}` };
    // Left-aligned, smaller (or wrapped, or cut short) to fit its row.
    let at = listTop + row * lineH;
    for (const l of fitLines([line], colW, lineH, 1.8 * u, 1.1 * u).lines) {
      s.push(`<text x="${n2(X(col * (colW + 2 * u)))}" y="${n2(at + l.size)}" font-size="${n2(l.size)}" fill="${INK}">${esc(l.text)}</text>`);
      at += l.size * 1.22;
    }
  });
  return { id: `${d.id}:board`, name: d.name, w: total.w, h: total.h, body: s.join('') };
}
