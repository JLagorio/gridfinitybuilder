import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_BIN } from '../src/lib/geometry/bin';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import { planPrint, type NamedDrawer } from '../src/lib/project';
import { cleanAttachments, cleanEnclosure } from '../src/lib/enclosureOptions';
import { attachmentEntries, attachmentTitle, boardPlace, inventoryRows, mapSvg, searchInventory } from '../src/lib/inventory';
import { attachmentLabel, contentsLabel, type PlacedAttachment } from '../src/lib/wall';
import { attachmentKey } from '../src/lib/wall/plan';
import { boardMap } from '../src/lib/wall/boardMap';
import { useStore } from '../src/state/store';
import { updateAttachment } from '../src/state/wall';

const att = (id: string, type: string, x: number, y: number, extra: Partial<PlacedAttachment> = {}): PlacedAttachment => ({
  id,
  type,
  x,
  y,
  opts: {},
  ...extra,
});
const board = (attachments: PlacedAttachment[], name = 'Workshop board', id = 'board'): NamedDrawer => ({
  id,
  name,
  drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS }, attachments },
  baseplate: DEFAULT_BASEPLATE,
  bins: [],
});
const drawer: NamedDrawer = {
  id: 'd',
  name: 'Desk drawer',
  drawer: DEFAULT_DRAWER,
  baseplate: DEFAULT_BASEPLATE,
  bins: [{ id: 'b1', x: 0, y: 0, opts: { ...DEFAULT_BIN }, contents: 'M3 screws long\nPaper clips' }],
};
const plan = (d: NamedDrawer) => planPrint([d], DEFAULT_SETUP, { baseplate: true, bins: true });

describe('contents of attachments', () => {
  it('are saved like a bin’s: cleaned, and left out when empty', () => {
    const [a, b] = cleanAttachments([
      { id: 'a', type: 'bin', x: 20, y: 40, opts: {}, contents: '  - M3 screws  \r\n\r\nM3 nuts\u0007\n\n', labelFrom: 'contents' },
      { id: 'b', type: 'bin', x: 20, y: 40, opts: {}, contents: '   \n ', labelFrom: 'name' },
    ]);
    expect(a.contents).toBe('  - M3 screws\n\nM3 nuts');
    expect(a.labelFrom).toBe('contents');
    expect(b).not.toHaveProperty('contents');
    expect(b).not.toHaveProperty('labelFrom');
    expect(cleanAttachments([{ id: 'c', type: 'bin', x: 0, y: 0, contents: 42 }])[0]).not.toHaveProperty('contents');
    const d = cleanEnclosure({ ...DEFAULT_DRAWER, enclosure: 'skadis', attachments: [{ ...att('x', 'bin', 20, 40), contents: 'Nozzles' }] });
    expect(d.attachments![0].contents).toBe('Nozzles');
  });

  it('give a label: the one thing, a few short ones, or the first', () => {
    expect(contentsLabel(undefined)).toBe('');
    expect(contentsLabel('\n  \n')).toBe('');
    expect(contentsLabel('M3 screws')).toBe('M3 screws');
    expect(contentsLabel('- Nozzles\n• Wipes')).toBe('Nozzles, Wipes');
    expect(contentsLabel('M3 × 8 screws\nM3 nuts\nM3 washers')).toBe('M3 × 8 screws');
    expect(contentsLabel('x'.repeat(60))).toHaveLength(40);
    expect(attachmentLabel({ label: ' Own ', contents: 'Nozzles' })).toBe('Own');
    expect(attachmentLabel({ label: 'Own', contents: 'Nozzles', labelFrom: 'contents' })).toBe('Nozzles');
  });

  it('engrave on its label face when the label follows them, and change no mesh otherwise', () => {
    const plain = plan(board([att('a', 'bin', 100, 400, { contents: 'M3 screws' })])).drawers[0].enclosure!.wall!.placed[0];
    expect(plain.extras?.label).toBeUndefined();
    const bare = plan(board([att('a', 'bin', 100, 400)])).drawers[0].enclosure!.wall!.placed[0];
    expect(attachmentKey(plain.type, plain.opts, DEFAULT_CTX, plain.extras)).toBe(attachmentKey(bare.type, bare.opts, DEFAULT_CTX, bare.extras));
    const job = plan(board([att('a', 'bin', 100, 400, { contents: 'M3 screws\nM3 nuts', labelFrom: 'contents', label: 'Ignored' })]));
    expect(job.warnings).toEqual([]);
    const p = job.drawers[0].enclosure!.wall!.placed[0];
    expect(p.extras?.label?.text).toBe('M3 screws, M3 nuts');
    // A kind without a label face: nothing to engrave.
    const hook = plan(board([att('h', 'hook', 100, 400, { contents: 'Keys', labelFrom: 'contents' })])).drawers[0].enclosure!.wall!.placed[0];
    expect(hook.extras?.label).toBeUndefined();
  });
});

const DEFAULT_CTX = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal' as const, behind: 20 };

describe('finding attachments', () => {
  const parts = [
    att('fast', 'bin', 100, 400, { name: 'Fasteners', contents: 'M3 screws\nM3 nuts\nM2 screws' }),
    att('hex', 'toolRack', 400, 500, { name: 'Hex keys' }),
    att('noz', 'bin', 400, 100, { contents: 'Nozzles 0.4', labelFrom: 'contents' }),
    att('bare', 'hook', 300, 300),
  ];
  const docs = [drawer, board(parts)];

  it('lists each with its kind, name, label, place and contents', () => {
    const es = attachmentEntries(docs);
    expect(es.map((e) => e.attachment.id)).toEqual(['hex', 'fast', 'bare', 'noz']);
    const fast = es.find((e) => e.attachment.id === 'fast')!;
    expect(fast).toMatchObject({
      drawerName: 'Workshop board',
      title: 'Fasteners',
      desc: 'Bin 80 × 50 × 60',
      pos: 'top left',
      contents: ['M3 screws', 'M3 nuts', 'M2 screws'],
    });
    const noz = es.find((e) => e.attachment.id === 'noz')!;
    expect(noz).toMatchObject({ title: 'Bin 80 × 50 × 60', label: 'Nozzles 0.4', pos: 'bottom right' });
    expect(attachmentTitle(noz)).toBe('Bin 80 × 50 × 60 “Nozzles 0.4”');
    expect(es.find((e) => e.attachment.id === 'bare')!.pos).toBe('middle');
    expect(boardPlace(10, 280, 560, 560)).toBe('left');
    expect(boardPlace(280, 10, 560, 560)).toBe('bottom');
    // Drawers aren't boards.
    expect(attachmentEntries([drawer])).toEqual([]);
  });

  it('“M3 screws” finds the board’s bin, says which board, and keeps finding drawer bins', () => {
    const r = searchInventory(docs, 'M3 screws');
    const onBoard = r.find((x) => x.attachmentId === 'fast')!;
    expect(onBoard).toMatchObject({ drawerId: 'board', drawerName: 'Workshop board', bin: 'Fasteners', pos: 'top left', kind: 'contents', text: 'M3 screws' });
    expect(onBoard.binId).toBeUndefined();
    // The exact line ranks first; the drawer's bin is still found.
    expect(r[0].attachmentId).toBe('fast');
    expect(r.some((x) => x.binId === 'b1')).toBe(true);
    // One result per attachment.
    expect(r.filter((x) => x.attachmentId === 'fast')).toHaveLength(1);
    expect(new Set(r.map((x) => x.key)).size).toBe(r.length);
  });

  it('finds them by name and by label too', () => {
    const byName = searchInventory(docs, 'hex keys');
    expect(byName[0]).toMatchObject({ attachmentId: 'hex', kind: 'part', bin: 'Hex keys' });
    const byLabel = searchInventory(docs, 'nozzles');
    expect(byLabel[0]).toMatchObject({ attachmentId: 'noz' });
    // A word only the board's name has narrows it down.
    expect(searchInventory(docs, 'workshop m2').map((x) => x.attachmentId)).toEqual(['fast']);
    expect(searchInventory(docs, 'bare hook')).toEqual([]);
  });

  it('come in the contents list (CSV rows)', () => {
    const rows = inventoryRows(docs);
    expect(rows).toContainEqual(['Workshop board', 'top left', 'Fasteners (Bin 80 × 50 × 60)', '', '', 'M3 nuts']);
    expect(rows).toContainEqual(['Workshop board', 'bottom right', 'Bin 80 × 50 × 60', 'Nozzles 0.4', '', 'Nozzles 0.4']);
    // One with nothing listed still gets a row.
    expect(rows.filter((r) => r[0] === 'Workshop board' && r[2].startsWith('J hook'))).toHaveLength(1);
  });

  it('have a board map: each numbered where it hangs, the list under it', () => {
    const d = board(parts);
    const wall = plan(d).drawers[0].enclosure!.wall!;
    const m = boardMap(d, wall);
    expect(m.w).toBeGreaterThan(560);
    expect(m.h).toBeGreaterThan(560);
    expect(m.body.match(/data-attachment=/g)).toHaveLength(parts.length);
    expect(m.body).toContain('Fasteners: M3 screws, M3 nuts, M2 screws');
    expect(m.body).toContain('Workshop board');
    expect(mapSvg(m)).toMatch(/^<svg [^>]*width="[\d.]+mm"/);
  });
});

describe('editing contents', () => {
  const s = () => useStore.getState();
  beforeEach(() => s().resetAll());

  it('is an edit to the board, not to its geometry', () => {
    s().addDrawer('Board', { skadis: true });
    s().setDrawer({ attachments: [att('a', 'bin', 100, 400)] });
    updateAttachment('a', { contents: 'M3 screws' });
    expect(s().drawer.attachments![0].contents).toBe('M3 screws');
    updateAttachment('a', { labelFrom: 'contents' });
    expect(s().drawer.attachments![0].labelFrom).toBe('contents');
  });
});
