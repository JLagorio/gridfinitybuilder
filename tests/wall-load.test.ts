import { describe, expect, it } from 'vitest';
import { DEFAULT_BASEPLATE } from '../src/lib/geometry/baseplate';
import { DEFAULT_SKADIS } from '../src/lib/geometry/skadis';
import { DEFAULT_DRAWER } from '../src/lib/layout/drawer';
import { DEFAULT_SETUP } from '../src/lib/layout/plan';
import { planPrint, type NamedDrawer } from '../src/lib/project';
import { cleanAttachments } from '../src/lib/enclosureOptions';
import { attachmentDef, attachmentDefs, type AttachmentDef, type MountCtx, type PlacedAttachment } from '../src/lib/wall';
import { attachmentUi } from '../src/lib/wall/ui';
import { placeAttachments, planExtras, type WallBoard } from '../src/lib/wall/plan';
import { KG, MATERIALS, boltStrength, holding, kg, loadCheck, loadLine, loadWarning, mountStrength, mountWords, type Material } from '../src/lib/wall/load';
import type { CellDispenserOptions } from '../src/lib/wall/kinds/cellDispenser';
import type { ToolDockOptions } from '../src/lib/wall/kinds/toolDock';

const CTX: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };
const def = (type: string) => attachmentDef(type)!;
const opts = (type: string, o: Record<string, unknown> = {}) => def(type).sanitize(o);
const check = (type: string, o: Record<string, unknown> = {}, a: Partial<PlacedAttachment> = {}, ctx = CTX) => loadCheck(a, def(type), opts(type, o), ctx);
/** What its mounts hold, kg, for a load `at` out (as planned with its common options). */
function holds(type: string, o: Record<string, unknown> = {}, at = 50, material: Material = 'pla', a: Partial<PlacedAttachment> = {}, ctx = CTX) {
  const d = def(type);
  const op = d.sanitize(o);
  const e = planExtras(a, d, op, d.layout(op, ctx), ctx);
  return holding(e.layout, ctx, material, at, e.extras).kg;
}
/** The yoke as the guitar preset sets it. */
const guitarPreset = () => {
  const f = attachmentUi('saddle')!.fields.find((x) => x.kind === 'preset')!;
  return (f.kind === 'preset' ? f.presets.find((p) => p.value === 'guitar')!.set : {}) as Record<string, unknown>;
};

/** A big staggered lattice: room for anything (wall coordinates). */
function bigBoard(ctx = CTX): WallBoard {
  const slots: [number, number][] = [];
  for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) if ((i + j) % 2 === 0) slots.push([i * ctx.pitch, j * ctx.pitch]);
  return { W: 800, H: 800, slots, ctx, outlines: [], front: 25 };
}
const loadWarnings = (w: string[]) => w.filter((m) => /its mounts hold/.test(m));

describe('what the mounts hold', () => {
  it('each mount and a bolt: positive, PETG and ASA above PLA, hooks pull harder than clips, studs only carry', () => {
    for (const m of ['pla', 'petg', 'asa'] as const) {
      const clip = mountStrength('clip', CTX, m, 'upright');
      const stud = mountStrength('stud', CTX, m, 'upright');
      const hook = mountStrength('hook', CTX, m, 'side');
      for (const s of [clip.down, clip.out, stud.down, hook.down, hook.out, boltStrength('m3', CTX, m), boltStrength('m4', CTX, m)]) {
        expect(s).toBeGreaterThan(0);
        expect(Number.isFinite(s)).toBe(true);
      }
      expect(stud.out).toBe(0);
      expect(mountStrength('clip', CTX, m, 'upright', false).out).toBe(0);
      expect(hook.out).toBeGreaterThan(clip.out);
      expect(boltStrength('m3', CTX, m)).toBeGreaterThan(clip.out);
      expect(boltStrength('m4', CTX, m)).toBeGreaterThanOrEqual(boltStrength('m3', CTX, m));
    }
    for (const m of ['petg', 'asa'] as const) {
      expect(mountStrength('clip', CTX, m, 'upright').out).toBeGreaterThan(mountStrength('clip', CTX, 'pla', 'upright').out);
      expect(mountStrength('hook', CTX, m, 'side').out).toBeGreaterThan(mountStrength('hook', CTX, 'pla', 'side').out);
    }
    // The constants say what they are: a lasting share under 1, PLA's the least.
    for (const m of Object.values(MATERIALS)) expect(m.lasting).toBeLessThan(1);
    expect(MATERIALS.pla.lasting).toBeLessThan(MATERIALS.petg.lasting);
    // A clip in the plane of its layers pulls out at roughly what a firm hand does (60–150 N) before the margins.
    const short = (mountStrength('clip', CTX, 'pla', 'upright').out * 3) / MATERIALS.pla.lasting;
    expect(short).toBeGreaterThan(60);
    expect(short).toBeLessThan(150);
  });

  it('every kind holds a finite, positive load at its defaults, more in PETG and ASA than in PLA', () => {
    for (const d of attachmentDefs()) {
      const o = d.sanitize(undefined);
      const pla = loadCheck({}, d, o, CTX);
      expect(Number.isFinite(pla.holds), d.type).toBe(true);
      expect(pla.holds, d.type).toBeGreaterThan(0.1);
      expect(pla.at, d.type).toBeGreaterThan(0);
      expect(mountWords(pla.mounts), d.type).not.toBe('');
      const petg = loadCheck({ material: 'petg' }, d, o, CTX);
      const asa = loadCheck({ material: 'asa' }, d, o, CTX);
      expect(petg.holds, d.type).toBeGreaterThan(pla.holds);
      expect(asa.holds, d.type).toBeGreaterThan(pla.holds);
      // And on a thick board, a thin one and loose and snug fits.
      for (const ctx of [
        { ...CTX, t: 5.5 },
        { ...CTX, t: 4.8 },
        { ...CTX, fit: 'loose' as const },
        { ...CTX, fit: 'snug' as const },
      ]) {
        const c = loadCheck({}, d, d.sanitize(undefined), ctx);
        expect(Number.isFinite(c.holds) && c.holds > 0, `${d.type} ${JSON.stringify(ctx)}`).toBe(true);
      }
    }
  });

  it('more clips, a taller back and a bolt hold more; a load further out, less', () => {
    // Wider: more clip columns.
    const wide = [80, 160, 240].map((width) => holds('shelf', { width, depth: 100 }));
    expect(wide[1]).toBeGreaterThan(wide[0]);
    expect(wide[2]).toBeGreaterThan(wide[1]);
    // Taller: the top row further up (and a row of studs more).
    const tall = [30, 60, 100, 140].map((height) => holds('shelf', { height }));
    for (let i = 1; i < tall.length; i++) expect(tall[i]).toBeGreaterThan(tall[i - 1]);
    expect(
      def('shelf')
        .layout(opts('shelf', { height: 30 }), CTX)
        .mounts.some((m) => m.kind === 'stud'),
    ).toBe(false);
    expect(
      def('shelf')
        .layout(opts('shelf', { height: 100 }), CTX)
        .mounts.filter((m) => m.kind === 'stud').length,
    ).toBeGreaterThan(0);
    // Further out: less, all the way.
    const out = [0, 20, 50, 100, 200].map((at) => holds('shelf', {}, at));
    for (let i = 1; i < out.length; i++) expect(out[i]).toBeLessThan(out[i - 1]);
    // PETG ≥ PLA at any lever.
    for (const at of [0, 30, 120]) expect(holds('bin', {}, at, 'petg')).toBeGreaterThanOrEqual(holds('bin', {}, at, 'pla'));
    // A bolt pulls too; barbs at the ends only leave plain pegs between, which don't.
    expect(holds('shelf', {}, 50, 'pla', { bolt: 'm3' })).toBeGreaterThan(holds('shelf', {}, 50));
    expect(holds('shelf', { width: 240 }, 50, 'pla', { barbs: 'ends' })).toBeLessThan(holds('shelf', { width: 240 }));
    // Snug clips have thicker legs than loose ones.
    expect(holds('bin', {}, 25, 'pla', {}, { ...CTX, fit: 'snug' })).toBeGreaterThan(holds('bin', {}, 25, 'pla', {}, { ...CTX, fit: 'loose' }));
  });
});

describe('what each kind is meant to hold', () => {
  const meant = (type: string, o: Record<string, unknown> = {}) => {
    const d = def(type);
    const op = d.sanitize(o);
    return d.load!(op, d.layout(op, CTX));
  };

  it('known loads', () => {
    expect(meant('batteryDock', { count: 2 }).kg).toBeCloseTo(1.4);
    expect(meant('toolDock', { count: 2 })).toEqual({ kg: 4, at: (opts('toolDock') as ToolDockOptions).setback });
    expect(meant('holster').kg).toBe(1.5);
    expect(meant('saddle', guitarPreset())).toEqual({ kg: 4.5, at: 29 });
    expect(meant('saddle', { ...guitarPreset(), heavy: false }).kg).toBe(0.6);
    expect(meant('saddle', { count: 2 }).kg).toBe(1);
    // A 160 × 100 shelf: 1.6 kg halfway out.
    expect(meant('shelf')).toEqual({ kg: 1.6, at: 50 });
    // A 1 kg filament spool (⌀200 × 65) on a spool rack, and a dropper bottle and a spray can on a bottle rack.
    expect(meant('spoolRack', { diameter: 200, width: 65, count: 1 }).kg).toBeCloseTo(1, 0);
    expect(meant('bottleRack', { columns: 1, rows: 1 }).kg).toBeCloseTo(0.03, 2);
    expect(meant('bottleRack', { diameter: 67, cup: 60, columns: 1, rows: 1 }).kg).toBeGreaterThan(0.35);
    expect(meant('bottleRack', { diameter: 67, cup: 60, columns: 1, rows: 1 }).kg).toBeLessThan(0.5);
    // AA cells weigh about 23 g.
    const cells = opts('cellDispenser') as CellDispenserOptions;
    expect(meant('cellDispenser').kg / (cells.columns * cells.capacity)).toBeCloseTo(0.021, 2);
    // A full bin: about 1 kg a litre.
    expect(meant('lidBox', { width: 100, height: 100, depth: 100 }).kg).toBeCloseTo(1);
    expect(KG.full).toBe(1e-6);
    // Hooks: anything, near the tip.
    expect(meant('hook')).toEqual({ kg: 0, at: 44 });
    // More things, more load.
    expect(meant('bottleRack', { rows: 4 }).kg).toBeGreaterThan(meant('bottleRack').kg);
    expect(meant('clampRack', { count: 5 }).kg).toBeGreaterThan(meant('clampRack').kg);
  });

  it('every load is finite, not negative, and out from the board', () => {
    for (const d of attachmentDefs()) {
      if (!d.load) continue;
      for (const raw of [undefined, d.defaults]) {
        const o = d.sanitize(raw);
        const l = d.load(o, d.layout(o, CTX));
        expect(Number.isFinite(l.kg) && l.kg >= 0, d.type).toBe(true);
        expect(Number.isFinite(l.at) && l.at > 0, d.type).toBe(true);
        expect(l.at, d.type).toBeLessThan(400);
      }
    }
  });

  it('a kind meant for anything is never over', () => {
    const c = check('hook', { reach: 250 });
    expect(c.meant).toBe(0);
    expect(c.over).toBe(false);
    expect(loadWarning(c)).toBeNull();
    expect(loadLine(c)).toMatch(/^Its mounts hold about [\d.]+ kg in PLA \(1 hook, 1 stud\)\.$/);
  });
});

describe('the check', () => {
  it('no kind is over at its defaults, in PLA, on any fit', () => {
    for (const d of attachmentDefs())
      for (const fit of ['snug', 'normal', 'loose'] as const) {
        const c = loadCheck({}, d, d.sanitize(undefined), { ...CTX, fit });
        expect(c.over, `${d.type} ${fit}: ${loadWarning(c)}`).toBe(false);
      }
  });

  it('a guitar on a yoke in PLA is too much: PETG, a bolt or a taller back fixes it', () => {
    const c = check('saddle', guitarPreset());
    expect(c.meant).toBe(4.5);
    expect(c.over).toBe(true);
    expect(c.fixes).toEqual(['print it in PETG', 'turn on Bolt it on', expect.stringMatching(/^make it \d+ mm tall$/)]);
    expect(loadWarning(c)).toMatch(
      /^meant for about 4\.5 kg, but its mounts hold about [\d.]+ kg in PLA: print it in PETG, turn on Bolt it on or make it \d+ mm tall\.$/,
    );
    expect(loadLine(c)).toMatch(/\(2 clips, 4 studs\); it's meant for about 4\.5 kg\. Too much: print it in PETG/);
    // Each fix, alone, is enough.
    expect(check('saddle', guitarPreset(), { material: 'petg' }).over).toBe(false);
    expect(check('saddle', guitarPreset(), { material: 'asa' }).over).toBe(false);
    const bolted = check('saddle', guitarPreset(), { bolt: 'm3' });
    expect(bolted.over).toBe(false);
    expect(bolted.mounts.bolts).toBe(1);
    expect(loadLine(bolted)).toMatch(/\(2 clips, 4 studs, 1 bolt\)/);
    const h = Number(c.fixes[2].match(/\d+/)![0]);
    expect(check('saddle', { ...guitarPreset(), height: h }).over).toBe(false);
  });

  it('a drill dock on a short back is too much; a taller one holds it', () => {
    const c = check('toolDock', { height: 40 });
    expect(c.over).toBe(true);
    expect(c.mounts.studs).toBe(0);
    const tall = c.fixes.find((f) => /tall/.test(f))!;
    expect(check('toolDock', { height: Number(tall.match(/\d+/)![0]) }).over).toBe(false);
    expect(check('toolDock').over).toBe(false);
  });

  it('when nothing alone is enough, it says so', () => {
    // A deep cradle for a big charger (4.5 kg, 130 mm out): neither PETG, a bolt nor a taller back alone; PETG and a bolt.
    const big = { width: 150, depth: 250, height: 120 };
    const both = check('chargerCradle', big);
    expect(both.over).toBe(true);
    expect(both.fixes).toEqual(['print it in PETG and bolt it on']);
    expect(check('chargerCradle', big, { material: 'petg', bolt: 'm3' }).over).toBe(false);
    // 48 spray cans (20 kg): nothing will.
    const cans = check('bottleRack', { diameter: 67, cup: 60, columns: 6, rows: 8 });
    expect(cans.over).toBe(true);
    expect(cans.fixes).toEqual(['hang less on it, or split it in two']);
    expect(loadWarning(cans)).toMatch(/: hang less on it, or split it in two\.$/);
  });

  it('planning warns about an overloaded guitar hanger, and not once it is bolted on or in PETG', () => {
    const at: PlacedAttachment = { id: 'g', type: 'saddle', x: 200, y: 300, opts: guitarPreset() };
    const board = bigBoard();
    const w = placeAttachments([at], board).warnings;
    expect(loadWarnings(w)).toEqual([expect.stringMatching(/^Guitar hanger, 46 mm gap: meant for about 4\.5 kg, but its mounts hold about/)]);
    expect(loadWarnings(placeAttachments([{ ...at, bolt: 'm3' }], board).warnings)).toEqual([]);
    expect(loadWarnings(placeAttachments([{ ...at, material: 'petg' }], board).warnings)).toEqual([]);
  });

  it('planning puts every kind on a board at its defaults without a load warning', () => {
    const board = bigBoard();
    for (const d of attachmentDefs()) {
      const w = placeAttachments([{ id: 'a', type: d.type, x: 400, y: 400, opts: {} }], board).warnings;
      expect(loadWarnings(w), d.type).toEqual([]);
    }
  });

  it('the whole print job carries the warning, for a guitar on a real board', () => {
    const drawer = (atts: PlacedAttachment[]): NamedDrawer => ({
      id: 'b',
      name: 'Board',
      drawer: { ...DEFAULT_DRAWER, enclosure: 'skadis', skadis: { ...DEFAULT_SKADIS }, attachments: atts },
      baseplate: DEFAULT_BASEPLATE,
      bins: [],
    });
    const at: PlacedAttachment = { id: 'g', type: 'saddle', x: 100, y: 200, opts: guitarPreset() };
    const plan = (a: PlacedAttachment) => planPrint([drawer([a])], DEFAULT_SETUP, { baseplate: true, bins: true });
    expect(plan(at).warnings.join('\n')).toMatch(/meant for about 4\.5 kg, but its mounts hold about [\d.]+ kg in PLA/);
    expect(loadWarnings(plan({ ...at, bolt: 'm3' }).warnings)).toEqual([]);
  });

  it('what it is printed in is saved with it', () => {
    const a = { id: 'a', type: 'bin', x: 0, y: 0, opts: {} };
    expect(cleanAttachments([{ ...a, material: 'petg' }])[0].material).toBe('petg');
    expect(cleanAttachments([{ ...a, material: 'asa' }])[0].material).toBe('asa');
    expect(cleanAttachments([{ ...a, material: 'wood' }])[0].material).toBeUndefined();
    expect(cleanAttachments([a])[0].material).toBeUndefined();
    // Unset is PLA.
    expect(check('bin').material).toBe('pla');
  });

  it('weights read as "about": rounded, what it holds rounded down', () => {
    expect(kg(0.04)).toBe('0.1 kg');
    expect(kg(1.26)).toBe('1.3 kg');
    expect(kg(1.26, true)).toBe('1.2 kg');
    expect(kg(4.4, true)).toBe('4 kg');
    expect(kg(4.4)).toBe('4.5 kg');
    expect(kg(12.6)).toBe('13 kg');
    expect(kg(12.6, true)).toBe('12 kg');
  });

  it('the kinds that say what they hold are the ones that hold something in particular', () => {
    const none = attachmentDefs()
      .filter((d: AttachmentDef<object>) => !d.load)
      .map((d) => d.type);
    // Cable clips, labels, LED bars, fit tests and the like: only what their mounts take.
    for (const t of ['batteryDock', 'toolDock', 'holster', 'saddle', 'bottleRack', 'shelf', 'gridShelf', 'rod', 'spoolRack']) expect(none).not.toContain(t);
  });
});
