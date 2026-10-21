import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { activeDrawer, useStore, useUnits } from '../state/store';
import { Toggle } from './fields';
import { MOD } from './shortcuts';
import { cellEdge, type GridLayout } from '../lib/layout/drawer';
import type { PlacedBin } from '../lib/project';
import { labelCaption } from '../lib/geometry/labelContents';
import { cellsFor, fillBin, planFill, plannedBins, type BinSize, type FillPlan, type PlannedBin, type Proposal } from '../lib/autofill';
import './fillFromList.css';

const EXAMPLE = ['200 M3 screws', '50 M3 nuts', '12 AA batteries', 'hex keys 1.5–10 mm', 'SD cards x8', 'calipers', 'misc small parts'].join('\n');

/** "Fill from a list…": the button for the Layout section, and its dialog. */
export function FillFromListButton({ layout }: { layout: GridLayout }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} disabled={!layout.nx || !layout.ny} title="Type what you want to store; Gridfit proposes bins for it">
        Fill from a list…
      </button>
      {/* On the page itself, not inside the sidebar's button row. */}
      {open && createPortal(<FillFromListDialog layout={layout} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

/** Type what to store, one item per line; see the bins Gridfit proposes; add them in one step. */
export function FillFromListDialog({ layout, onClose }: { layout: GridLayout; onClose: () => void }) {
  const saved = useStore((s) => activeDrawer(s).fillList ?? '');
  const name = useStore((s) => activeDrawer(s).name);
  const drawer = useStore((s) => s.drawer);
  const baseplate = useStore((s) => s.baseplate);
  const setup = useStore((s) => s.setup);
  const bins = useStore((s) => s.bins);
  const tools = useStore((s) => s.tools);
  const newBin = useStore((s) => s.newBin);
  const addBins = useStore((s) => s.addBins);
  const setFillList = useStore((s) => s.setFillList);
  const { fmt, units } = useUnits();
  const [text, setText] = useState(saved);
  const [group, setGroup] = useState(true);
  const [replace, setReplace] = useState(false);
  const [extraDrawers, setExtraDrawers] = useState(false);
  const [sizes, setSizes] = useState<Record<string, BinSize>>({});
  const [skip, setSkip] = useState<string[]>([]);
  const [hot, setHot] = useState<string | null>(null);
  const titleId = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const list = useDeferredValue(text);

  const plan = useMemo(
    () =>
      planFill(list, { layout, drawer, baseplate, setup, bins, tools, newBin, fmt, units }, { group, replace, sizes, skip }),
    // fmt follows units.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [list, layout, drawer, baseplate, setup, bins, tools, newBin, units, group, replace, sizes, skip],
  );

  // The list is remembered for this drawer however the dialog closes.
  const close = useRef(onClose);
  close.current = () => {
    setFillList(text);
    onClose();
  };
  useEffect(() => {
    area.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      close.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const extra = extraDrawers ? plan.extra : [];
  const count = plan.placed.length + extra.reduce((t, d) => t + d.length, 0);
  const accept = () => {
    setFillList(text);
    addBins(plannedBins(plan.placed), { replace, newDrawers: extra.map(plannedBins) });
    onClose();
  };
  const setSize = (p: Proposal, s: BinSize) => setSizes({ ...sizes, [p.key]: s });
  const half = !!layout.halfGrid;
  const leftOut = plan.left.filter((p) => !plan.never.includes(p));
  const stale = list !== text;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && close.current()}>
      <div className="modal fill-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <h2 id={titleId}>Fill from a list</h2>
          <span className="muted small">{name}</span>
          <button className="link modal-close" onClick={() => close.current()} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="fill-body">
          <div className="fill-side">
            <label className="fill-label" htmlFor={`${titleId}-list`}>
              What do you want to store?
            </label>
            <div className="input-wrap fill-text">
              <textarea
                id={`${titleId}-list`}
                ref={area}
                value={text}
                spellCheck={false}
                placeholder={EXAMPLE}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && count && !stale) {
                    e.preventDefault();
                    accept();
                  }
                }}
              />
            </div>
            <p className="field-hint">
              One item per line: how many, what it is, and a size if it has one (<i>200 M3 screws</i>, <i>SD cards x8</i>, <i>drill bits 1–10 mm</i>). Tools
              in your tool library are matched by name.
            </p>
            <Toggle label="Group small items" checked={group} onChange={setGroup} hint="Small parts that go together share a bin, a compartment each." />
            <Toggle
              label="Replace the bins in this drawer"
              checked={replace}
              onChange={setReplace}
              hint={replace && bins.length ? `The ${bins.length} bin${bins.length === 1 ? '' : 's'} in this drawer go.` : 'Off: the new bins go around the ones already there.'}
            />
            {!Number.isFinite(plan.room) && drawer.mode === 'drawer' && !drawer.enclosure && (
              <p className="field-hint">Set the drawer’s inside height (Drawer tab) to keep every bin low enough for it.</p>
            )}
          </div>
          <div className="fill-main">
            {!plan.items.length ? (
              <div className="fill-empty muted">Type a list on the left to see the bins it needs.</div>
            ) : (
              <>
                <FillPreview layout={layout} existing={replace ? [] : bins} plan={plan} hot={hot} onHot={setHot} />
                <ol className={`fill-list ${stale ? 'stale' : ''}`}>
                  {plan.proposals.map((p) => {
                    const at = plan.placed.find((b) => b.proposal === p);
                    const n = at ? plan.placed.indexOf(at) + 1 : 0;
                    const skipped = skip.includes(p.key);
                    const where = plan.extra.findIndex((d) => d.some((b) => b.proposal === p));
                    return (
                      <li
                        key={p.key}
                        className={`fill-row ${hot === p.key ? 'hot' : ''} ${skipped ? 'skipped' : ''} ${!at && !skipped ? 'out' : ''}`}
                        onPointerEnter={() => setHot(p.key)}
                        onPointerLeave={() => setHot(null)}
                      >
                        <span className="fill-num" aria-hidden>
                          {n || '–'}
                        </span>
                        <div className="fill-what">
                          <b>
                            {p.title}
                            {p.part && <span className="muted"> ({p.part.index} of {p.part.of})</span>}
                          </b>
                          <span className="muted small">{p.reason}</span>
                          {at?.fill.ok && at.fill.holds && <span className="fill-holds small">{at.fill.holds}</span>}
                          {(at?.warnings ?? p.warnings).map((w) => (
                            <span key={w} className="fill-warn small">
                              {w}
                            </span>
                          ))}
                          {!at && !skipped && (
                            <span className="fill-warn small">
                              {where >= 0
                                ? 'No room in this drawer: it fits in a new one.'
                                : plan.never.includes(p)
                                  ? 'No room for it, even in an empty drawer like this one.'
                                  : 'No room in this drawer.'}
                            </span>
                          )}
                        </div>
                        <div className="fill-controls">
                          <SizeSteps
                            size={at?.size ?? p.size}
                            half={half}
                            max={{ ux: plan.ctx.maxX, uy: plan.ctx.maxY, h: plan.ctx.maxH }}
                            fits={(s) => fillBin(p, s, cellsFor(plan.ctx, s.ux, s.uy), plan.ctx).printable}
                            onChange={(s) => setSize(p, s)}
                          />
                          <label className="fill-skip small">
                            <input type="checkbox" checked={skipped} onChange={(e) => setSkip(e.target.checked ? [...skip, p.key] : skip.filter((k) => k !== p.key))} /> Leave out
                          </label>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {leftOut.length > 0 && (
                  <div className="fill-left">
                    <p>
                      <b>No room for {leftOut.length === 1 ? '1 bin' : `${leftOut.length} bins`}</b> in this drawer: {leftOut.map((p) => p.title).join('; ')}.
                    </p>
                    {plan.extra.length > 0 && (
                      <Toggle
                        label={plan.extra.length === 1 ? 'Put them in a new drawer like this one' : `Put them in ${plan.extra.length} new drawers like this one`}
                        checked={extraDrawers}
                        onChange={setExtraDrawers}
                        hint="Same size and baseplate, added after this drawer."
                      />
                    )}
                  </div>
                )}
                {plan.never.length > 0 && (
                  <p className="field-error">Too big for a drawer like this one: {plan.never.map((p) => p.title).join('; ')}. Make them smaller, or leave them out.</p>
                )}
              </>
            )}
          </div>
        </div>
        <footer className="fill-foot">
          <span className="muted small">
            {plan.placed.length
              ? `${plan.placed.length} bin${plan.placed.length === 1 ? '' : 's'} in this drawer${extra.length ? `, ${count - plan.placed.length} in ${extra.length === 1 ? 'a new drawer' : `${extra.length} new drawers`}` : ''}. You can undo this.`
              : plan.proposals.length > plan.skipped.length
                ? 'No room for any of them in this drawer.'
                : 'Nothing to add yet.'}
          </span>
          <button onClick={() => close.current()}>Cancel</button>
          <button className="primary" onClick={accept} disabled={!count || stale} title={`${MOD}+Enter`}>
            {count ? `Add ${count} bin${count === 1 ? '' : 's'}` : 'Add bins'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/**
 * Width, depth and height of a proposed bin, each with − and +, up to the
 * grid, the drawer's height and what the printer takes. Half-grid sizes show
 * in units (cells / 2).
 */
function SizeSteps({ size, half, max, fits, onChange }: { size: BinSize; half: boolean; max: BinSize; fits: (s: BinSize) => boolean; onChange: (s: BinSize) => void }) {
  const u = (n: number) => (half ? n / 2 : n);
  const more = (k: keyof BinSize) => ({ ...size, [k]: size[k] + 1 });
  const part = (k: keyof BinSize, label: string, lo: number, text: string) => (
    <span className="fill-step" title={label}>
      <button type="button" aria-label={`Less ${label.toLowerCase()}`} disabled={size[k] <= lo} onClick={() => onChange({ ...size, [k]: size[k] - 1 })}>
        −
      </button>
      <span>{text}</span>
      <button
        type="button"
        aria-label={`More ${label.toLowerCase()}`}
        disabled={size[k] >= max[k] || !fits(more(k))}
        title={size[k] < max[k] && !fits(more(k)) ? 'The printer takes no bigger' : undefined}
        onClick={() => onChange(more(k))}
      >
        +
      </button>
    </span>
  );
  return (
    <span className="fill-size" role="group" aria-label="Size">
      {part('ux', 'Width', 1, String(u(size.ux)))}
      <span className="faint">×</span>
      {part('uy', 'Depth', 1, String(u(size.uy)))}
      <span className="faint">×</span>
      {part('h', 'Height', 2, `${size.h}u`)}
    </span>
  );
}

/** The drawer grid from above (back at the top) with the bins already there and the proposed ones, numbered. */
function FillPreview({ layout, existing, plan, hot, onHot }: { layout: GridLayout; existing: PlacedBin[]; plan: FillPlan; hot: string | null; onHot: (k: string | null) => void }) {
  const { nx, ny, xs, ys, pitchX, pitchY, plateW, plateD } = layout;
  const hatch = `fill-hatch-${useId().replace(/[^\w-]/g, '')}`;
  const sy = (y: number) => plateD - y;
  const rect = (x: number, y: number, w: number, d: number, inset: number) => {
    const x0 = cellEdge(xs, x, pitchX);
    const x1 = cellEdge(xs, x + w, pitchX);
    const y0 = cellEdge(ys, y, pitchY);
    const y1 = cellEdge(ys, y + d, pitchY);
    return { x: x0 + inset, y: sy(y1) + inset, width: x1 - x0 - 2 * inset, height: y1 - y0 - 2 * inset };
  };
  const pad = 8;
  const bin = (b: PlannedBin, i: number) => {
    const r = rect(b.x, b.y, b.size.ux, b.size.uy, 0.8);
    const fs = Math.max(6, Math.min(11, Math.min(r.width, r.height) / 3.2));
    const caption = labelCaption({ opts: b.fill.opts, contents: b.fill.contents }) || b.proposal.title;
    const room = Math.max(1, Math.floor((r.width - 4) / (fs * 0.45)));
    return (
      <g
        key={b.proposal.key}
        className={`fill-bin ${hot === b.proposal.key ? 'hot' : ''} ${b.warnings.length ? 'warn' : ''}`}
        onPointerEnter={() => onHot(b.proposal.key)}
        onPointerLeave={() => onHot(null)}
      >
        <rect {...r} rx={3.5}>
          <title>{`${i + 1}. ${b.proposal.title}`}</title>
        </rect>
        <text x={r.x + r.width / 2} y={r.y + r.height / 2 - (r.height > fs * 2.6 ? fs * 0.45 : 0)} fontSize={fs} textAnchor="middle" dominantBaseline="middle">
          {i + 1}
        </text>
        {r.height > fs * 2.6 && (
          <text className="fill-bin-label" x={r.x + r.width / 2} y={r.y + r.height / 2 + fs * 0.75} fontSize={fs * 0.72} textAnchor="middle" dominantBaseline="middle">
            {caption.length > room ? `${caption.slice(0, Math.max(1, room - 1))}…` : caption}
          </text>
        )}
      </g>
    );
  };
  return (
    <div className="fill-preview">
      <svg viewBox={`${-pad} ${-pad} ${plateW + 2 * pad} ${plateD + 2 * pad}`} role="img" aria-label="Proposed bins in the drawer">
        <rect className="ge-plate" x={0} y={0} width={plateW} height={plateD} rx={4} />
        {Array.from({ length: nx }, (_, i) => Array.from({ length: ny }, (_, j) => <rect key={`${i}-${j}`} className="fill-cell" {...rect(i, j, 1, 1, 1.2)} rx={3} />))}
        {!!layout.mask?.length && (
          <defs>
            <pattern id={hatch} width={5} height={5} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={5} className="ge-hatch" />
            </pattern>
          </defs>
        )}
        {layout.mask?.map((k) => {
          const [i, j] = k.split(',').map(Number);
          return <rect key={`m${k}`} className="ge-blocked" {...rect(i, j, 1, 1, 1.2)} rx={3} fill={`url(#${hatch})`} />;
        })}
        {existing.map((b) => (
          <rect key={b.id} className="fill-existing" {...rect(b.x, b.y, b.opts.unitsX, b.opts.unitsY, 0.8)} rx={3.5}>
            <title>Already in the drawer</title>
          </rect>
        ))}
        {plan.placed.map(bin)}
        <text className="ge-caption" x={plateW / 2} y={-2} textAnchor="middle" fontSize={7}>
          back
        </text>
        <text className="ge-caption" x={plateW / 2} y={plateD + 6.5} textAnchor="middle" fontSize={7}>
          front
        </text>
      </svg>
    </div>
  );
}
