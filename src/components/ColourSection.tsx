import { useMemo, useSyncExternalStore } from 'react';
import { printDrawers, useStore } from '../state/store';
import { applyColourPreset, setColours, setPalette, setRoleSlot } from '../state/colours';
import { NumberInput, Section, Segmented, Select, TextInput, Toggle } from './fields';
import { Find, useFindState } from './findContext';
import { MoreInAll } from './find';
import { SlotPicker } from './SlotPicker';
import {
  BASIC_ROLES,
  MATERIALS,
  MAX_SLOTS,
  MIN_SHOWN_SLOTS,
  ROLES,
  baseMeshKey,
  paletteOf,
  printerSlots,
  roleDef,
  roleSlot,
  strategyOf,
  type ColourRole,
  type ColourStrategy,
  type FilamentMaterial,
  type RoleGroup,
} from '../lib/colours';
import { planPrint } from '../lib/project';
import { ROLE_TEXT } from '../lib/colourText';
import { COLOUR_PRESETS, inkOn } from '../lib/colourPresets';
import { estimateJob, formatDuration, currencySymbol } from '../lib/estimate';
import { findPrinter } from '../lib/printers';
import { jobPrinters } from '../lib/layout/fleet';
import { geometry } from '../worker/client';
import './colours.css';

/**
 * The Colours section of the print tab (lib/colours.ts): multi-colour on or
 * off, presets, how the colours get printed (with what each way costs), which
 * surface prints in which slot, and the palette. With multi-colour off it
 * keeps the label filament (slot 2) colour that inlaid labels and two-colour
 * pocket floors print in.
 */

const STRATEGY_OPTIONS: { value: ColourStrategy; label: string; title: string }[] = [
  { value: 'part', label: 'By part', title: 'Each part in one filament; colours on plates of their own' },
  { value: 'height', label: 'By height', title: 'Colour changes at layer heights (feet, floor, walls, lip): one swap per change, AMS or by hand' },
  { value: 'feature', label: 'By feature', title: 'True multi-material: each surface its own filament, swaps on every layer it shares' },
];

const STRATEGY_HINT: Record<ColourStrategy, string> = {
  part: 'Each part prints in one filament (label text keeps its own). Parts of different colours go on different plates, so no plate swaps filament.',
  height: 'The filament changes at heights: bin feet, floor, walls and lip can each have a colour. One swap per change per plate, by AMS or a pause to swap by hand; parts on a plate share their change heights.',
  feature: 'Parts are split into a volume per surface, each in its own filament (needs an AMS or several toolheads). Every layer with two colours swaps filament and purges.',
};

const GROUP_TITLES: Record<RoleGroup, string> = { plate: 'Baseplate', case: 'Carry case', bins: 'Bins', labels: 'Labels' };

const subscribe = (cb: () => void) => geometry.subscribe(cb);
// Parts sliced so far: the costs fill in as their slice data comes.
const sliced = () => geometry.slicedCount;

/** Plates, swaps, purge and time each strategy would take, from the slice data there is. */
function useStrategyCosts(on: boolean) {
  const store = useStore();
  const v = useSyncExternalStore(subscribe, sliced);
  const { setup, include } = store;
  const drawers = printDrawers(store);
  return useMemo(() => {
    if (!on) return null;
    void v;
    const ids = setup.printers ? jobPrinters(setup).map((p) => p.printerId) : setup.printerId;
    const stats = (k: string) => geometry.printStats(k) ?? geometry.printStats(baseMeshKey(k));
    const out = {} as Record<ColourStrategy, { plates: number; swaps: number | null; waste: number | null; seconds: number | null; manual: boolean }>;
    for (const st of STRATEGY_OPTIONS.map((o) => o.value)) {
      const alt = { ...setup, colours: { ...setup.colours, on: true, strategy: st } };
      const job = planPrint(drawers, alt, include);
      const est = estimateJob(job, stats, ids, alt);
      const done = est.every(Boolean);
      out[st] = {
        plates: job.plates.length,
        swaps: done ? est.reduce((t, e) => t + e!.swaps, 0) : null,
        waste: done ? est.reduce((t, e) => t + e!.wasteGrams, 0) : null,
        seconds: done ? est.reduce((t, e) => t + e!.seconds, 0) : null,
        manual: est.some((e) => e?.manual),
      };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, v, setup, include, store.drawers, store.bins, store.baseplate, store.drawer, store.activeDrawerId, store.printScope, store.printPick]);
}

/** A palette slot: colour, name, material, and (All settings) its price. */
function SlotRow({ i, count, price }: { i: number; count: number; price: boolean }) {
  const setup = useStore((s) => s.setup);
  const pal = paletteOf(setup, count);
  const f = pal[i];
  const symbol = currencySymbol(setup.currency);
  const set = (patch: Partial<typeof f>) => setPalette(pal.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  return (
    <div className="slot-row">
      <span className="slot-num" style={{ background: f.colour, color: inkOn(f.colour) }}>
        {i + 1}
      </span>
      <input type="color" aria-label={`Slot ${i + 1} colour`} value={f.colour.toLowerCase()} onChange={(e) => set({ colour: e.target.value.toUpperCase() })} />
      <TextInput label="Name" value={f.name ?? ''} placeholder={f.colour} onChange={(name) => set({ name: name.trim() || undefined })} />
      <Select
        label="Material"
        value={f.material ?? 'PLA'}
        options={MATERIALS.map((m) => ({ value: m.id, label: m.id }))}
        onChange={(material: FilamentMaterial) => set({ material: material === 'PLA' ? undefined : material })}
      />
      {price && (
        <NumberInput
          label={`Slot ${i + 1} price`}
          value={f.price ?? setup.filamentPrice ?? 20}
          min={0}
          max={100000}
          step={1}
          digits={2}
          suffix={`${symbol}/kg`}
          onChange={(p) => set({ price: p })}
        />
      )}
    </div>
  );
}

/** Slot picker for a role, with "same as …" for roles that follow another. */
function RoleField({ role, basic }: { role: ColourRole; basic?: boolean }) {
  const setup = useStore((s) => s.setup);
  const def = roleDef(role);
  const text = ROLE_TEXT[role];
  const own = setup.colours?.roles?.[role];
  const follows = def.follows ? ROLE_TEXT[def.follows] : null;
  return (
    <SlotPicker
      label={basic ? (text.basic ?? text.label) : text.label}
      setup={setup}
      count={Math.max(MIN_SHOWN_SLOTS, paletteOf(setup).length)}
      value={follows ? own : (own ?? roleSlot(setup, role))}
      unset={follows ? `as ${follows.basic ?? follows.label}` : undefined}
      onChange={(slot) => setRoleSlot(role, slot)}
      hint={basic ? text.note : undefined}
    />
  );
}

export function ColourSection({ twoColour }: { twoColour: boolean }) {
  const setup = useStore((s) => s.setup);
  const setSetup = useStore((s) => s.setSetup);
  const find = useFindState();
  const on = !!setup.colours?.on;
  const st = strategyOf(setup) ?? 'part';
  const costs = useStrategyCosts(on);
  const palette = paletteOf(setup);
  const count = Math.max(MIN_SHOWN_SLOTS, palette.length);
  const printer = findPrinter(setup.printerId);
  const slots = printerSlots(setup, printer.slots);
  const allRoles = !find?.basic || !!find?.result;
  const rolesSet = Object.keys(setup.colours?.roles ?? {}).some((r) => !BASIC_ROLES.includes(r as ColourRole));
  const label2 = paletteOf(setup, 2)[1];

  return (
    <Section title="Colours" find="colours" aside={on ? <span className="small muted">{STRATEGY_OPTIONS.find((o) => o.value === st)!.label}</span> : undefined}>
      <Find id="colour-mode">
        <Toggle
          label="Print in several colours"
          checked={on}
          onChange={(v) => setColours({ on: v || undefined })}
          hint={on ? undefined : 'Give the baseplate, bin walls, lips, dividers, labels… colours of their own, from a palette of filament slots.'}
        />
      </Find>
      <Find id="colour-presets">
        <div className="button-row colour-presets">
          {COLOUR_PRESETS.map((p) => (
            <button key={p.id} title={p.title} onClick={() => applyColourPreset(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </Find>
      {!on && twoColour && (
        <Find id="label-colour">
          <div className="field label-colour">
            <label className="field-label" htmlFor="label-colour">
              Label filament (slot 2)
            </label>
            <div className="field-control colour-row">
              <input
                id="label-colour"
                type="color"
                value={label2.colour.toLowerCase()}
                onChange={(e) => setPalette(paletteOf(setup, 2).map((f, i) => (i === 1 ? { ...f, colour: e.target.value.toUpperCase() } : f)))}
              />
              <span className="muted small">Inlaid label text and two-colour tool pocket floors print in this filament; the Bambu project gets a second filament set to it.</span>
            </div>
          </div>
        </Find>
      )}
      {on && (
        <>
          <Find id="colour-strategy">
            <Segmented label="How" value={st} options={STRATEGY_OPTIONS} onChange={(strategy) => setColours({ strategy: strategy === 'part' ? undefined : strategy })} hint={STRATEGY_HINT[st]} />
            {costs && (
              <table className="bom-table colour-costs">
                <thead>
                  <tr>
                    <th>Way</th>
                    <th>Plates</th>
                    <th>Swaps</th>
                    <th>Purge</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {STRATEGY_OPTIONS.map((o) => {
                    const c = costs[o.value];
                    return (
                      <tr key={o.value} className={o.value === st ? 'active' : ''} title={c.manual ? 'Colour changes by hand: the printer has fewer filament slots than these plates use' : undefined}>
                        <td>
                          {o.label}
                          {c.manual ? ' ✋' : ''}
                        </td>
                        <td>{c.plates}</td>
                        <td>{c.swaps ?? '…'}</td>
                        <td>{c.waste === null ? '…' : `${Math.round(c.waste)} g`}</td>
                        <td>{c.seconds === null ? '…' : formatDuration(c.seconds)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {st === 'part' && (
              <Toggle
                label="Keep colours on separate plates"
                checked={!setup.colours?.mix}
                onChange={(keep) => setColours({ mix: keep ? undefined : true })}
                hint={setup.colours?.mix ? 'Parts of different colours share plates: every layer they share swaps filament.' : 'No plate swaps filament (label text aside); more plates.'}
              />
            )}
          </Find>
          <Find id="colour-roles">
            <div className="colour-roles">
              {(allRoles ? (['plate', 'case', 'bins', 'labels'] as RoleGroup[]) : [null]).map((g) => (
                <div key={g ?? 'basic'} className="colour-role-group">
                  {g && <div className="colour-role-title">{GROUP_TITLES[g]}</div>}
                  {(g ? ROLES.filter((r) => r.group === g).map((r) => r.id) : BASIC_ROLES).map((r) => (
                    <RoleField key={r} role={r} basic={!g} />
                  ))}
                </div>
              ))}
            </div>
            <div className="field-hint">Drawers can have a baseplate colour of their own (Drawer & baseplate tab), and bins their own colour (Bins tab).</div>
          </Find>
          <Find id="colour-palette">
            <div className="field">
              <span className="field-label">Filament slots</span>
              <div className="slot-rows">
                {Array.from({ length: count }, (_, i) => (
                  <SlotRow key={i} i={i} count={count} price={allRoles} />
                ))}
              </div>
              <div className="button-row">
                <button disabled={count >= MAX_SLOTS} onClick={() => setPalette(paletteOf(setup, count + 1))}>
                  Add a slot
                </button>
                <button disabled={count <= MIN_SHOWN_SLOTS} onClick={() => setPalette(paletteOf(setup, count).slice(0, count - 1))}>
                  Remove slot {count}
                </button>
              </div>
              <div className="field-hint">
                Slot numbers are the filament numbers in the slicer (and the AMS slots, in order). The Bambu project starts every slot as PLA Basic in its colour: pick other
                materials there.
              </div>
            </div>
          </Find>
          <Find id="colour-slots" set={setup.filamentSlots !== undefined}>
            <NumberInput
              label="Slots the printer feeds"
              value={slots}
              min={1}
              max={MAX_SLOTS}
              step={1}
              digits={0}
              suffix={slots === 1 ? 'slot' : 'slots'}
              onChange={(n) => setSetup({ filamentSlots: n === (printer.slots ?? 1) ? undefined : Math.round(n) })}
              hint={`AMS units (4 slots each), a multi-material unit or toolheads; 1 means colour changes by hand. The ${printer.name}: ${printer.slots ?? 1} as usually sold.`}
            />
          </Find>
          <MoreInAll ids={[['colour-slots', setup.filamentSlots !== undefined]]} />
          {!allRoles && rolesSet && <p className="muted small">Some surfaces have colours of their own: see All settings.</p>}
        </>
      )}
    </Section>
  );
}
