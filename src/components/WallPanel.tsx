import { useState, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { attachmentSelection, useStore, useUnits } from '../state/store';
import { LengthInput, NumberInput, Section, Segmented, Select, TextInput, Toggle } from './fields';
import { MOD } from './shortcuts';
import { attachmentDef, attachmentLabel, type AttachmentDef, type AttachmentField, type AttachmentGroup, type MountCtx, type PlacedAttachment } from '../lib/wall';
import { LOCK_DEFAULT, canLock, type WallBoard, type WallPlacement } from '../lib/wall/plan';
import type { AlignHow } from '../lib/wall/arrange';
import { DEFAULT_MATERIAL, MATERIALS, loadCheck, loadLine, slotsUnder, type Material } from '../lib/wall/load';
import { GROUP_LABELS, attachmentUi, attachmentUis, type AttachmentUi } from '../lib/wall/ui';
import '../lib/wall/kinds/all';
import { sanitizeSkadis } from '../lib/geometry/skadis';
import type { PrintJob } from '../lib/project';
import {
  addAttachment,
  alignAttachments,
  clipVersion,
  copyAttachments,
  distributeAttachments,
  duplicateAttachments,
  hasAttachmentClip,
  moveToFit,
  pasteAttachments,
  removeAttachment,
  removeAttachments,
  selectAttachment,
  setAttachmentOpts,
  subscribeClip,
  toggleAttachment,
  updateAttachment,
} from '../state/wall';
import { ModelField } from './ModelField';
import { AttachmentContentsField, AttachmentLabelField } from './WallContents';
import { StartFromTemplate } from './BoardTemplatesButton';
import { OutlinesField } from './WallOutlines';
import { MineGroup, SaveToMine, useMineCount } from './MyAttachments';
import { LazyPart, lazyNamed } from './lazy';
import type { CustomOptions } from '../lib/wall/kinds/custom';
import './wall.css';

// The custom part's profile editor loads with the first one selected.
const ProfileField = lazyNamed(() => import('./ProfileEditor'), 'ProfileField');

/**
 * A Skådis board's Attachments tab (lib/wall): add hooks, bins, cups, … to
 * the board, edit the selected one (or line several up), and pick how tightly
 * the clips fit.
 */
export function WallPanel({ job }: { job: PrintJob }) {
  const drawer = useStore((s) => s.drawer);
  const picked = useStore(useShallow((s) => attachmentSelection(s.ui)));
  const setDrawer = useStore((s) => s.setDrawer);
  const { fmt } = useUnits();
  const wall = job.drawers[0]?.enclosure?.wall;
  const o = sanitizeSkadis(drawer.skadis);
  const list = drawer.attachments ?? [];
  // The selection on this board, the primary (the one the form edits) first.
  const group = picked.filter((id) => list.some((a) => a.id === id));
  const selected = group[0] ?? null;
  const sel = group.length === 1 ? (list.find((a) => a.id === selected) ?? null) : null;
  // Something copied (on any board) to paste here.
  useSyncExternalStore(subscribeClip, clipVersion);
  const placed = wall?.placed.find((p) => p.id === selected) ?? null;
  const def = sel ? attachmentDef(sel.type) : null;
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Set<AttachmentGroup>>(() => new Set());
  // My attachments the search finds (the picker's Mine group).
  const mine = useMineCount(query.trim().toLowerCase());

  if (!wall) return <Section title="Attachments">{<p className="muted">The board can't be planned yet: check its size on the Skådis board tab.</p>}</Section>;
  // What the selected one's mounts hold (lib/wall/load.ts), and what it's meant to.
  const load = sel && def && placed ? loadCheck(sel, def, def.sanitize(sel.opts), wall.board.ctx, slotsUnder(placed, wall.board)) : null;

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
      {group.length > 1 && <GroupSection ids={group} board={wall.board} placed={wall.placed} />}
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
          <AttachmentContentsField a={sel} />
          {placed && <CommonFields a={sel} def={def} placed={placed} ctx={wall.board.ctx} />}
          <AttachmentFields def={def} ui={attachmentUi(sel.type)} opts={sel.opts} ctx={wall.board.ctx} onChange={(p) => setAttachmentOpts(sel.id, p)} />
          {placed && (
            <div className="field-hint">
              {fmt(placed.x1 - placed.x0)} wide × {fmt(placed.y1 - placed.y0)} high, {fmt(placed.depth)} out from the board.{' '}
              {placed.ok
                ? `${placed.mounts.filter((m) => m.kind !== 'stud').length} ${placed.layout.pose === 'side' ? 'hook' : 'clip'}(s) hold it.`
                : placed.fit
                  ? 'It doesn’t fit here: its mounts don’t all find slots.'
                  : 'It doesn’t fit anywhere on this board: make it narrower or shorter.'}{' '}
              Prints {placed.layout.pose === 'side' ? 'on its side' : 'upright, as it hangs'}.
            </div>
          )}
          {placed?.fit && (
            <button className="wide" onClick={() => moveToFit([sel.id], wall.board)}>
              Move to the nearest spot that fits
            </button>
          )}
          {load && (
            <div
              className={load.over ? 'field-error' : 'field-hint'}
              title={`A rough estimate for a load centred ${fmt(load.at)} out from the board: what its clips, hooks and bolts take, with a margin for how prints vary and for years of hanging.`}
            >
              {loadLine(load)}
            </div>
          )}
          <div className="wall-actions">
            <button title={`A copy beside it (${MOD}+D)`} onClick={() => duplicateAttachments([sel.id], wall.board)}>
              Duplicate
            </button>
            <button title={`Copy it, to paste on this board or another (${MOD}+C, then ${MOD}+V)`} onClick={() => copyAttachments([sel.id])}>
              Copy
            </button>
            <button className="danger" onClick={() => removeAttachment(sel.id)}>
              Delete
            </button>
          </div>
          <SaveToMine ids={[sel.id]} board={wall.board} />
        </Section>
      )}

      {!list.length && <StartFromTemplate />}

      <Section title="Add to the board">
        <p className="muted small">
          Click to add one, then drag it on the board: it snaps to the slots. Arrow keys move the selection a slot over; Shift-click or drag a box to select
          several.
        </p>
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
        {!groups.size && !mine && <p className="muted small">Nothing matches “{query.trim()}”.</p>}
        <MineGroup query={q} board={wall.board} placed={wall.placed} />
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

      <Section
        title={`On this board (${list.length})`}
        aside={
          hasAttachmentClip() && (
            <button className="link" title={`Paste what you copied (${MOD}+V), on the first free spot that fits`} onClick={() => pasteAttachments(wall.board)}>
              Paste
            </button>
          )
        }
      >
        {list.length ? (
          <ul className="wall-list">
            {wall.placed.map((p) => (
              <li key={p.id}>
                <button
                  className={p.id === selected ? 'active' : group.includes(p.id) ? 'picked' : ''}
                  title={`Shift- or ${MOD}-click to select several`}
                  onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey ? toggleAttachment(p.id) : selectAttachment(p.id))}
                >
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

/** Line-up buttons: how, what it does, and its icon (16 × 16: the line, and two parts against it). */
const ALIGN: { how: AlignHow; label: string; d: string }[] = [
  { how: 'left', label: 'Line up their left edges', d: 'M2 1v14M4 3h9v3H4zM4 10h6v3H4z' },
  { how: 'centre', label: 'Line up their centres, across', d: 'M8 1v14M3 3h10v3H3zM5 10h6v3H5z' },
  { how: 'right', label: 'Line up their right edges', d: 'M14 1v14M3 3h9v3H3zM6 10h6v3H6z' },
  { how: 'top', label: 'Line up their tops', d: 'M1 2h14M3 4v9h3V4zM10 4v6h3V4z' },
  { how: 'middle', label: 'Line up their middles, up the board', d: 'M1 8h14M3 3v10h3V3zM10 5v6h3V5z' },
  { how: 'bottom', label: 'Line up their bottoms', d: 'M1 14h14M3 3v9h3V3zM10 6v6h3V6z' },
];

/** Space-out buttons: three parts evenly across, and up. */
const SPREAD: { axis: 'x' | 'y'; label: string; d: string }[] = [
  {
    axis: 'x',
    label: 'Space them out evenly across: the outer two stay, the gaps come out the same (in whole slots)',
    d: 'M1 1v14M15 1v14M3.5 4h2v8h-2zM7 4h2v8H7zM10.5 4h2v8h-2z',
  },
  {
    axis: 'y',
    label: 'Space them out evenly up the board: the top and bottom ones stay, the gaps come out the same (in whole slots)',
    d: 'M1 1h14M1 15h14M4 3.5h8v2H4zM4 7h8v2H4zM4 10.5h8v2H4z',
  },
];

/** Several selected: line them up, space them out, copy, duplicate or delete them together. */
function GroupSection({ ids, board, placed }: { ids: string[]; board: WallBoard; placed: WallPlacement[] }) {
  const misfits = placed.filter((p) => ids.includes(p.id) && !p.ok && p.fit);
  const icon = (d: string) => (
    <svg viewBox="0 0 16 16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d={d} />
    </svg>
  );
  return (
    <Section
      title={`${ids.length} selected`}
      aside={
        <button className="link" onClick={() => selectAttachment(null)}>
          Done
        </button>
      }
    >
      <div className="wall-arrange" role="group" aria-label="Line up">
        <span>Line up</span>
        {ALIGN.map((a) => (
          <button key={a.how} title={a.label} aria-label={a.label} onClick={() => alignAttachments(ids, a.how, board)}>
            {icon(a.d)}
          </button>
        ))}
      </div>
      <div className="wall-arrange" role="group" aria-label="Space out">
        <span>Space out</span>
        {SPREAD.map((a) => (
          <button
            key={a.axis}
            title={ids.length < 3 ? 'Select three or more to space them out' : a.label}
            aria-label={a.label}
            disabled={ids.length < 3}
            onClick={() => distributeAttachments(ids, a.axis, board)}
          >
            {icon(a.d)}
          </button>
        ))}
      </div>
      <p className="field-hint">They move in whole slots, so they line up as near as the slots allow. Drag any of them to move them all.</p>
      {misfits.length > 0 && (
        <button className="wide" onClick={() => moveToFit(ids, board)}>
          Move the {misfits.length === 1 ? 'one that doesn’t fit' : `${misfits.length} that don’t fit`} to the nearest spots that fit
        </button>
      )}
      <div className="wall-actions">
        <button title={`Copies beside them (${MOD}+D)`} onClick={() => duplicateAttachments(ids, board)}>
          Duplicate
        </button>
        <button title={`Copy them, to paste on this board or another (${MOD}+C, then ${MOD}+V)`} onClick={() => copyAttachments(ids)}>
          Copy
        </button>
        <button className="danger" onClick={() => removeAttachments(ids)}>
          Delete {ids.length}
        </button>
      </div>
      <SaveToMine ids={ids} board={board} />
    </Section>
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
      {def.backPlate?.(opts, placed.layout, ctx) !== null && (
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
      <Segmented
        label="Printed in"
        value={a.material ?? DEFAULT_MATERIAL}
        options={(Object.keys(MATERIALS) as Material[]).map((m) => ({ value: m, label: MATERIALS[m].label }))}
        hint="For what it holds: PLA creeps under a load that stays on (and softens in a warm room); PETG and ASA hold about twice as much."
        onChange={(m) => set({ material: m === DEFAULT_MATERIAL ? undefined : m })}
      />
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
      {face && <AttachmentLabelField a={a} />}
      {face && !!attachmentLabel(a)?.trim() && (
        <Segmented
          label="Label text"
          value={a.labelStyle ?? 'engraved'}
          options={[
            { value: 'engraved', label: 'Cut in' },
            ...(face.flat === false
              ? []
              : [{ value: 'raised' as const, label: 'Raised', title: 'Stands out 0.6 mm; in the board text colour with multi-colour on' }]),
            { value: 'inlaid', label: 'Inlaid', title: 'Cut in and filled flush in a second filament: two colours, a smooth face' },
          ]}
          hint={a.labelStyle ? 'Prints in the board text colour (Print plates › Colours).' : undefined}
          onChange={(v) => set({ labelStyle: v === 'engraved' ? undefined : v })}
        />
      )}
    </>
  );
}

/** The form for an attachment's options, from its kind's field list. */
export function AttachmentFields({
  def,
  ui,
  opts,
  ctx,
  onChange,
}: {
  def: AttachmentDef<object>;
  ui: AttachmentUi | null;
  opts: Record<string, unknown>;
  /** The board it's on (the profile editor draws it). */
  ctx?: MountCtx;
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
          case 'model':
            return <ModelField key={f.key} label={f.label} value={o[f.key]} hint={f.hint} onChange={set} />;
          case 'outlines':
            return <OutlinesField key={f.key} field={f} value={o[f.key]} onChange={set} />;
          case 'profile':
            return (
              <LazyPart key={f.key} scope="The profile editor">
                <ProfileField label={f.label} opts={o as unknown as CustomOptions} ctx={ctx} onChange={onChange} />
              </LazyPart>
            );
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
