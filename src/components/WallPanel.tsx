import { useState } from 'react';
import { useStore, useUnits } from '../state/store';
import { LengthInput, NumberInput, Section, Segmented, Select, TextInput, Toggle } from './fields';
import { attachmentDef, type AttachmentDef, type AttachmentField, type AttachmentGroup, type MountCtx, type PlacedAttachment } from '../lib/wall';
import { LOCK_DEFAULT, canLock, type WallPlacement } from '../lib/wall/plan';
import { GROUP_LABELS, attachmentUi, attachmentUis, type AttachmentUi } from '../lib/wall/ui';
import '../lib/wall/kinds/all';
import { sanitizeSkadis } from '../lib/geometry/skadis';
import type { PrintJob } from '../lib/project';
import { addAttachment, duplicateAttachment, removeAttachment, selectAttachment, setAttachmentOpts, updateAttachment } from '../state/wall';
import './wall.css';

/**
 * A Skådis board's Attachments tab (lib/wall): add hooks, bins, cups, … to
 * the board, edit the selected one, and pick how tightly the clips fit.
 */
export function WallPanel({ job }: { job: PrintJob }) {
  const drawer = useStore((s) => s.drawer);
  const selected = useStore((s) => s.ui.selectedAttachment ?? null);
  const setDrawer = useStore((s) => s.setDrawer);
  const { fmt } = useUnits();
  const wall = job.drawers[0]?.enclosure?.wall;
  const o = sanitizeSkadis(drawer.skadis);
  const list = drawer.attachments ?? [];
  const sel = list.find((a) => a.id === selected) ?? null;
  const placed = wall?.placed.find((p) => p.id === selected) ?? null;
  const def = sel ? attachmentDef(sel.type) : null;
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Set<AttachmentGroup>>(() => new Set());

  if (!wall) return <Section title="Attachments">{<p className="muted">The board can't be planned yet: check its size on the Skådis board tab.</p>}</Section>;

  // The palette, by group; a search shows every match with its group open.
  const q = query.trim().toLowerCase();
  const groups = new Map<AttachmentGroup, AttachmentUi[]>(Object.keys(GROUP_LABELS).map((g) => [g as AttachmentGroup, []]));
  for (const d of attachmentUis()) {
    if (q && !`${d.label} ${d.description} ${GROUP_LABELS[d.group]}`.toLowerCase().includes(q)) continue;
    groups.get(d.group)?.push(d);
  }
  for (const [g, defs] of groups) if (!defs.length) groups.delete(g);
  const toggle = (g: AttachmentGroup) =>
    setClosed((c) => {
      const n = new Set(c);
      if (!n.delete(g)) n.add(g);
      return n;
    });

  return (
    <>
      {sel && def && (
        <Section
          title={sel.name?.trim() || def.summary(def.sanitize(sel.opts) as never)}
          aside={
            <button className="link" onClick={() => selectAttachment(null)}>
              Done
            </button>
          }
        >
          <TextInput
            label="Name"
            value={sel.name ?? ''}
            placeholder={def.summary(def.sanitize(sel.opts) as never)}
            onChange={(name) => updateAttachment(sel.id, { name })}
          />
          {placed && <CommonFields a={sel} def={def} placed={placed} ctx={wall.board.ctx} />}
          <AttachmentFields def={def} ui={attachmentUi(sel.type)} opts={sel.opts} onChange={(p) => setAttachmentOpts(sel.id, p)} />
          {placed && (
            <div className="field-hint">
              {fmt(placed.x1 - placed.x0)} wide × {fmt(placed.y1 - placed.y0)} high, {fmt(placed.depth)} out from the board.{' '}
              {placed.ok
                ? `${placed.mounts.filter((m) => m.kind !== 'stud').length} ${placed.layout.pose === 'side' ? 'hook' : 'clip'}(s) hold it.`
                : 'It doesn’t fit here: drag it to where its mounts find slots.'}{' '}
              Prints {placed.layout.pose === 'side' ? 'on its side' : 'upright, as it hangs'}.
            </div>
          )}
          <div className="wall-actions">
            <button onClick={() => duplicateAttachment(sel.id, wall.board, wall.placed)}>Duplicate</button>
            <button className="danger" onClick={() => removeAttachment(sel.id)}>
              Delete
            </button>
          </div>
        </Section>
      )}

      <Section title="Add to the board">
        <p className="muted small">Click to add one, then drag it on the board: it snaps to the slots. Arrow keys move the selected one a slot over.</p>
        <div className="input-wrap wall-search">
          <input
            type="search"
            value={query}
            placeholder="Search parts…"
            aria-label="Search parts to add"
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {!groups.size && <p className="muted small">Nothing matches “{query.trim()}”.</p>}
        {[...groups].map(([g, defs]) => {
          const open = !!q || !closed.has(g);
          return (
            <div key={g}>
              <button className="wall-group-label" aria-expanded={open} onClick={() => toggle(g)}>
                <span>{open ? '▾' : '▸'}</span> {GROUP_LABELS[g]} <small>{defs.length}</small>
              </button>
              {open && (
                <div className="wall-types">
                  {defs.map((d) => (
                    <button key={d.type} title={d.description} onClick={() => addAttachment(d.type, wall.board, wall.placed)}>
                      <span>{d.label}</span>
                      <small>{d.description}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </Section>

      <Section title={`On this board (${list.length})`}>
        {list.length ? (
          <ul className="wall-list">
            {wall.placed.map((p) => (
              <li key={p.id}>
                <button className={p.id === selected ? 'active' : ''} onClick={() => selectAttachment(p.id)}>
                  <span>{p.name}</span>
                  <small>{p.ok ? `${fmt(p.x1 - p.x0)} × ${fmt(p.y1 - p.y0)}` : 'doesn’t fit'}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Nothing yet. Start with the fit test: print it, then pick the fit below from the tab that clicks in and holds.</p>
        )}
      </Section>

      <Section title="Fit">
        <Segmented
          label="Clips fit the slots"
          value={o.fit}
          options={[
            { value: 'snug', label: 'Snug', title: 'For a board whose slots came out large' },
            { value: 'normal', label: 'Normal' },
            { value: 'loose', label: 'Loose', title: 'For tight slots, or brittle filament' },
          ]}
          onChange={(fit) => setDrawer({ skadis: { ...o, fit } })}
          hint={`For this board: ${fmt(o.thickness)} thick, ${o.slotW} × ${o.slotL} mm slots. Clips push straight in and drop onto the slot bottoms; lift and pull firmly to take one off. PETG holds up best. Boards run 4.8 to 5.5 mm thick: measure yours with the fit test’s thickness gauge and set Thickness on the board’s tab to it, so hooks hang snug.`}
        />
      </Section>
    </>
  );
}

/**
 * The options every kind has (lib/wall/registry.ts PlacedAttachment): lock keys over its hooks, a bolt, barbs on
 * the end clips only, a label. Each shows only where it can apply.
 */
function CommonFields({ a, def, placed, ctx }: { a: PlacedAttachment; def: AttachmentDef<object>; placed: WallPlacement; ctx: MountCtx }) {
  const set = (patch: Partial<PlacedAttachment>) => updateAttachment(a.id, patch);
  const opts = def.sanitize(a.opts);
  const face = def.labelFace?.(opts, placed.layout) ?? null;
  const clips = placed.layout.mounts.filter((m) => m.kind === 'clip').length;
  return (
    <>
      {canLock(placed.layout, ctx) && (
        <Toggle
          label="Lock keys"
          checked={a.lock ?? LOCK_DEFAULT}
          hint="A little key pushed into the slot over each hook, so it can't be lifted off by accident. Pull its tab to take it out."
          onChange={(lock) => set({ lock })}
        />
      )}
      {def.backPlate?.(opts, placed.layout) !== null && (
        <Segmented
          label="Bolt it on"
          value={a.bolt ?? 'off'}
          options={[
            { value: 'off', label: 'Off' },
            { value: 'm3', label: 'M3' },
            { value: 'm4', label: 'M4' },
          ]}
          hint="For heavy things: a countersunk screw through its back and a slot into a printed T-nut behind the board."
          onChange={(v) => set({ bolt: v === 'off' ? undefined : v })}
        />
      )}
      {clips > 2 && (
        <Segmented
          label="Barbs"
          value={a.barbs ?? 'all'}
          options={[
            { value: 'all', label: 'Every clip' },
            { value: 'ends', label: 'Ends only', title: 'Easier to push on and pull off' },
          ]}
          onChange={(v) => set({ barbs: v === 'ends' ? 'ends' : undefined })}
        />
      )}
      {face && <TextInput label="Label" value={a.label ?? ''} placeholder="Cut into its front" onChange={(label) => set({ label })} />}
    </>
  );
}

/** The form for an attachment's options, from its kind's field list. */
export function AttachmentFields({
  def,
  ui,
  opts,
  onChange,
}: {
  def: AttachmentDef<object>;
  ui: AttachmentUi | null;
  opts: Record<string, unknown>;
  onChange: (p: Record<string, unknown>) => void;
}) {
  const o = def.sanitize(opts) as Record<string, unknown>;
  const show = (f: AttachmentField) => !f.when || (f.when as (v: object) => boolean)(o);
  return (
    <>
      {(ui?.fields ?? []).filter(show).map((f) => {
        const set = (v: unknown) => onChange({ [f.key]: v });
        switch (f.kind) {
          case 'length':
            return (
              <LengthInput
                key={f.key}
                label={f.label}
                value={Number(o[f.key]) || 0}
                min={f.min}
                max={f.max}
                allowEmpty={f.allowEmpty}
                hint={f.hint}
                onChange={set}
              />
            );
          case 'number':
            return (
              <NumberInput
                key={f.key}
                label={f.label}
                value={Number(o[f.key]) || 0}
                min={f.min}
                max={f.max}
                step={f.step}
                suffix={f.suffix}
                hint={f.hint}
                onChange={set}
              />
            );
          case 'select':
            return f.options.length <= 4 ? (
              <Segmented key={f.key} label={f.label} value={String(o[f.key])} options={f.options} hint={f.hint} onChange={set} />
            ) : (
              <Select key={f.key} label={f.label} value={String(o[f.key])} options={f.options} hint={f.hint} onChange={set} />
            );
          case 'toggle':
            return <Toggle key={f.key} label={f.label} checked={!!o[f.key]} hint={f.hint} onChange={set} />;
          case 'text':
            return <TextInput key={f.key} label={f.label} value={String(o[f.key] ?? '')} placeholder={f.placeholder} hint={f.hint} onChange={set} />;
          case 'preset': {
            // The preset whose sizes the options have now, else Custom.
            const now = f.presets.find((p) => Object.entries(def.sanitize({ ...o, ...p.set }) as Record<string, unknown>).every(([k, v]) => o[k] === v));
            return (
              <Select
                key={f.key}
                label={f.label}
                value={now?.value ?? ''}
                options={[...(now ? [] : [{ value: '', label: 'Custom' }]), ...f.presets.map((p) => ({ value: p.value, label: p.label, title: p.title }))]}
                hint={f.hint}
                onChange={(v) => {
                  const p = f.presets.find((q) => q.value === v);
                  if (p) onChange(p.set);
                }}
              />
            );
          }
        }
      })}
    </>
  );
}
