import { useEffect, useState } from 'react';
import { useStore, useUnits } from '../state/store';
import { Field, Segmented, Select } from './fields';
import { LazyDialog, lazyNamed } from './lazy';
import type { TraceTab } from './TraceDialog';
import type { AttachmentField } from '../lib/wall';
import { bounds } from '../lib/trace/polygon';
import { HOLDS, cleanTraced, type Hold, type TracedOutline, type TracedTool } from '../lib/wall/kinds/traced';
import './wallOutlines.css';

// Photo tracing and SVG / DXF import load when the dialog first opens.
const TraceDialog = lazyNamed(() => import('./TraceDialog'), 'TraceDialog');

type OutlinesField = Extract<AttachmentField, { kind: 'outlines' }>;

const HOLD_LABELS: Record<Hold, { label: string; title: string }> = {
  pegs: { label: 'Pegs', title: 'Two pegs under it, a lip on each' },
  ledge: { label: 'Ledge', title: 'A cup round its bottom: it drops in from above' },
  magnets: { label: 'Magnets', title: 'Two magnets in its shadow, for steel tools' },
  none: { label: 'None', title: 'Just its shadow: it hangs on a hook of its own' },
};

/** A small drawing of an outline. */
function Thumb({ outline }: { outline: [number, number][] }) {
  const b = bounds(outline);
  const s = Math.max(b.x1 - b.x0, b.y1 - b.y0) || 1;
  const pad = s * 0.08;
  return (
    <svg className="tool-thumb" width={34} height={34} viewBox={`${b.x0 - pad} ${-b.y1 - pad} ${s + 2 * pad} ${s + 2 * pad}`} aria-hidden>
      <path d={`M${outline.map(([x, y]) => `${x.toFixed(1)},${(-y).toFixed(1)}`).join('L')}Z`} />
    </svg>
  );
}

/** A tool's name, kept when it's done with (Enter, or leaving the box), like the panel's other text boxes. */
function NameInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => text.trim() && text !== value && onChange(text.trim());
  return (
    <input
      className="wall-outline-name"
      aria-label={label}
      value={text}
      maxLength={40}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  );
}

/**
 * A shadow board's or a tool holder's tools (lib/wall/kinds/traced.ts): trace one from a photo, import outlines from
 * an SVG or DXF file (the trace dialog hands them back here instead of to the library), or take one from the tool
 * library; then rename, turn, pick what holds each, or remove them. With room for one, a new one replaces it.
 */
export function OutlinesField({ field, value, onChange }: { field: OutlinesField; value: unknown; onChange: (tools: TracedTool[]) => void }) {
  const { fmt } = useUnits();
  const library = useStore((s) => s.tools);
  const [dialog, setDialog] = useState<TraceTab | null>(null);
  const tools = cleanTraced(value, field.max);
  const one = field.max === 1;
  const room = one || tools.length < field.max;

  const add = (incoming: (TracedOutline & { toolId?: string })[]) => {
    const fresh = cleanTraced(
      incoming.map((t) => ({ ...t, hold: 'pegs' })),
      field.max,
    );
    onChange(one ? fresh.slice(0, 1) : [...tools, ...fresh].slice(0, field.max));
  };
  const set = (i: number, patch: Partial<TracedTool>) => onChange(tools.map((t, k) => (k === i ? { ...t, ...patch } : t)));

  return (
    <Field label={field.label} hint={field.hint}>
      <div className="wall-outlines">
        {!tools.length && <p className="muted small">None yet.</p>}
        {tools.length > 0 && (
          <ul className="tool-list">
            {tools.map((t, i) => {
              const b = bounds(t.outline);
              return (
                <li key={i} className="tool-row wall-outline">
                  <div className="tool-main">
                    <Thumb outline={t.outline} />
                    <div className="tool-name">
                      <NameInput label={`Name of tool ${i + 1}`} value={t.name} onChange={(name) => set(i, { name })} />
                      <small>
                        {fmt(b.x1 - b.x0, { unit: false })} × {fmt(b.y1 - b.y0)} · {fmt(t.depth)} thick
                      </small>
                    </div>
                    <button
                      className="link"
                      title="Turn it a quarter turn"
                      aria-label={`Turn ${t.name}`}
                      onClick={() => set(i, { rotation: (t.rotation + 90) % 360 })}
                    >
                      ↻
                    </button>
                    <button className="link danger" title="Remove it" aria-label={`Remove ${t.name}`} onClick={() => onChange(tools.filter((_, k) => k !== i))}>
                      ✕
                    </button>
                  </div>
                  {field.hold && (
                    <div className="wall-outline-hold">
                      <Segmented
                        ariaLabel={`What holds ${t.name}`}
                        value={t.hold}
                        options={HOLDS.map((h) => ({ value: h, ...HOLD_LABELS[h] }))}
                        onChange={(hold) => set(i, { hold })}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {room && (
          <div className="button-row">
            <button onClick={() => setDialog('photo')}>Trace a photo…</button>
            <button onClick={() => setDialog('import')}>Import SVG or DXF…</button>
          </div>
        )}
        {room && library.length > 0 && (
          <Select
            label="Or from your tool library"
            value=""
            options={[{ value: '', label: 'Pick a tool…' }, ...library.map((t) => ({ value: t.id, label: t.name }))]}
            onChange={(id) => {
              const t = library.find((q) => q.id === id);
              if (t) add([{ name: t.name, outline: t.outline, depth: t.depth, clearance: t.clearance, toolId: t.id }]);
            }}
          />
        )}
      </div>
      {dialog && (
        <LazyDialog scope="The trace dialog" onClose={() => setDialog(null)}>
          <TraceDialog initialTab={dialog} onClose={() => setDialog(null)} onOutlines={add} />
        </LazyDialog>
      )}
    </Field>
  );
}
