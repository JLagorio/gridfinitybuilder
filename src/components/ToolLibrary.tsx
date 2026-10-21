import { useMemo, useState } from 'react';
import { useStore, useUnits } from '../state/store';
import { LengthInput, Section, Segmented, TextInput } from './fields';
import { TraceDialog, type TraceTab } from './TraceDialog';
import { TOOL_DRAG_MIME, ToolThumb } from './CutoutEditor';
import { binSpec, type PrintJob } from '../lib/project';
import { binSize } from '../lib/geometry/bin';
import { cutoutArea, cutoutStyle, type CutoutStyle } from '../lib/geometry/cutouts';
import { usesToolCompartments } from '../lib/geometry/compartments';
import {
  binOptsForTools,
  cutoutFromTool,
  findFreePlacement,
  fitBinForTools,
  firstFreeSpot,
  pocketsClash,
  toolSize,
  toolUsage,
  type Tool,
} from '../lib/tools';

/** Bins-tab sidebar: the tool library, plus pocket settings for the selected bin. */
export function ToolLibrary({ job }: { job: PrintJob }) {
  const tools = useStore((s) => s.tools);
  const bins = useStore((s) => s.bins);
  const drawers = useStore((s) => s.drawers);
  const activeId = useStore((s) => s.activeDrawerId);
  const selectedId = useStore((s) => s.ui.selectedBinId);
  const binPane = useStore((s) => s.ui.binPane);
  const newBin = useStore((s) => s.newBin);
  const addBin = useStore((s) => s.addBin);
  const updateBin = useStore((s) => s.updateBin);
  const updateTool = useStore((s) => s.updateTool);
  const removeTool = useStore((s) => s.removeTool);
  const setUI = useStore((s) => s.setUI);
  const { fmt } = useUnits();
  const [dialog, setDialog] = useState<TraceTab | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const sel = bins.find((b) => b.id === selectedId) ?? null;
  // Every drawer's bins (the active drawer's entry in `drawers` may be stale).
  const allBins = useMemo(() => [...bins, ...drawers.filter((d) => d.id !== activeId).flatMap((d) => d.bins)], [bins, drawers, activeId]);
  const picked = tools.filter((t) => checked.includes(t.id));

  const place = (t: Tool) => {
    if (!sel) return;
    const { w, d } = binSize(sel.opts, binSpec(job.layout, sel).cells);
    const list = sel.opts.cutouts ?? [];
    const spot = findFreePlacement(list, t, cutoutArea(w, d, sel.opts.lip, sel.opts.lipStyle));
    const added = cutoutFromTool(t, spot.x, spot.y, spot.rotation);
    updateBin(sel.id, { opts: { interior: usesToolCompartments(sel.opts) ? 'compartments' : 'cutouts', cutouts: [...list, added] } });
    setUI({ binPane: 'cutouts' });
    setMsg(list.some((c) => pocketsClash(c, added)) ? `No free room for “${t.name}” in this bin: it was put in the middle. Move things around, or make the bin bigger.` : null);
  };

  const makeBin = (ts: Tool[]) => {
    // On a half grid the bin is sized in 21 mm cells (shown in u).
    const half = !!job.layout.halfGrid;
    const fit = fitBinForTools(ts, { lip: newBin.lip, lipStyle: newBin.lipStyle, base: newBin.base, half });
    const u = (n: number) => (half ? n / 2 : n);
    if (!fit.fits) {
      setMsg(`Too big for one bin: it would need ${u(fit.unitsX)} × ${u(fit.unitsY)} units (12 × 12 at most).`);
      return;
    }
    const spot = firstFreeSpot(job.layout, bins, fit.unitsX, fit.unitsY);
    if (!spot) {
      setMsg(`No free ${u(fit.unitsX)} × ${u(fit.unitsY)} spot in this drawer. Clear some room, or switch drawers.`);
      return;
    }
    const id = addBin(spot.x, spot.y, fit.unitsX, fit.unitsY);
    updateBin(id, { opts: binOptsForTools(fit) });
    setUI({ selectedBinId: id, binPane: 'cutouts' });
    setChecked([]);
    setMsg(null);
  };

  const remove = (t: Tool) => {
    const n = toolUsage(allBins, t.id);
    if (!confirm(n ? `Remove “${t.name}”? Its pockets in ${n} bin${n === 1 ? '' : 's'} go too.` : `Remove “${t.name}” from the library?`)) return;
    removeTool(t.id);
    setChecked(checked.filter((id) => id !== t.id));
  };

  return (
    <>
      <Section
        title="Tool library"
        aside={
          binPane !== 'cutouts' && sel ? (
            <button className="link" onClick={() => setUI({ binPane: 'cutouts' })}>
              Edit pockets
            </button>
          ) : undefined
        }
      >
        <div className="button-row">
          <button onClick={() => setDialog('photo')}>Trace a photo…</button>
          <button onClick={() => setDialog('import')}>Import SVG / DXF…</button>
        </div>
        {tools.length === 0 ? (
          <p className="muted small">
            Trace a tool from a photo on a sheet of paper, or import its outline, then drop it into a bin to cut a pocket that fits it
            (a “shadow board”).
          </p>
        ) : (
          <ul className="tool-list">
            {tools.map((t) => {
              const size = toolSize(t);
              const used = toolUsage(allBins, t.id);
              const open = openId === t.id;
              return (
                <li
                  key={t.id}
                  className={`tool-row ${open ? 'open' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(TOOL_DRAG_MIME, t.id);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                >
                  <div className="tool-main">
                    <input
                      type="checkbox"
                      aria-label={`Select ${t.name}`}
                      checked={checked.includes(t.id)}
                      onChange={(e) => setChecked(e.target.checked ? [...checked, t.id] : checked.filter((id) => id !== t.id))}
                    />
                    <ToolThumb tool={t} size={34} />
                    <button className="tool-name" onClick={() => setOpenId(open ? null : t.id)} title="Rename, thickness, clearance">
                      <b>{t.name}</b>
                      <small>
                        {fmt(size.w, { unit: false })} × {fmt(size.d)} · {fmt(t.depth)} deep{used ? ` · in ${used} bin${used === 1 ? '' : 's'}` : ''}
                      </small>
                    </button>
                    <button className="link tool-more" onClick={() => setOpenId(open ? null : t.id)} aria-expanded={open}>
                      {open ? 'Done' : 'Edit'}
                    </button>
                  </div>
                  <div className="tool-actions">
                    <button onClick={() => place(t)} disabled={!sel} title={sel ? 'Add a pocket for it to the selected bin' : 'Select a bin first'}>
                      Place in bin
                    </button>
                    <button onClick={() => makeBin([t])} title="Make the smallest bin that holds this tool, at the first free spot">
                      Make a bin
                    </button>
                  </div>
                  {open && (
                    <div className="tool-edit">
                      <TextInput label="Name" value={t.name} onChange={(name) => name.trim() && updateTool(t.id, { name: name.trim() })} />
                      <div className="row2">
                        <LengthInput label="Thickness" value={t.depth} min={0.2} max={250} onChange={(depth) => updateTool(t.id, { depth })} />
                        <LengthInput label="Clearance" value={t.clearance} min={0} max={10} onChange={(clearance) => updateTool(t.id, { clearance })} />
                      </div>
                      <div className="button-row">
                        <button className="danger" onClick={() => remove(t)}>
                          Remove from library
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {picked.length > 1 && (
          <button className="primary wide" onClick={() => makeBin(picked)}>
            Make one bin for these {picked.length} tools
          </button>
        )}
        {msg && <div className="field-error">{msg}</div>}
      </Section>
      {sel && (sel.opts.interior === 'cutouts' || usesToolCompartments(sel.opts)) ? <PocketSettings binId={sel.id} style={cutoutStyle(sel.opts)} count={sel.opts.cutouts?.length ?? 0} /> : null}
      {dialog && <TraceDialog initialTab={dialog} onClose={() => setDialog(null)} />}
    </>
  );
}

function PocketSettings({ binId, style, count }: { binId: string; style: CutoutStyle; count: number }) {
  const updateBin = useStore((s) => s.updateBin);
  const cur = useStore((s) => s.bins.find((b) => b.id === binId)?.opts.cutoutStyle);
  const set = (p: Partial<CutoutStyle>) => updateBin(binId, { opts: { cutoutStyle: { ...cur, ...p } } });
  return (
    <Section
      title={`Pockets in this bin (${count})`}
      aside={
        <button
          className="link danger"
          onClick={() => (!count || confirm('Remove every tool pocket from this bin? It goes back to compartments.')) && updateBin(binId, { opts: { interior: 'compartments', cutouts: [] } })}
        >
          Back to compartments
        </button>
      }
    >
      <p className="muted small">The bin is filled solid and each tool is cut into it. Lay them out in the Tool cutouts pane.</p>
      <Segmented
        label="Top edge"
        value={style.edge}
        options={[
          { value: 'none', label: 'Sharp' },
          { value: 'chamfer', label: 'Chamfer' },
          { value: 'round', label: 'Rounded' },
        ]}
        onChange={(edge) => set({ edge })}
      />
      <div className="row2">
        {style.edge !== 'none' && <LengthInput label="Edge size" value={style.edgeSize} min={0} max={5} onChange={(edgeSize) => set({ edgeSize })} />}
        <LengthInput label="Extra depth" value={style.extraDepth} min={0} max={20} onChange={(extraDepth) => set({ extraDepth })} hint="Below the tool." />
      </div>
      <div className="row2">
        <LengthInput label="Finger notch Ø" value={style.notchDiameter} min={5} max={60} onChange={(notchDiameter) => set({ notchDiameter })} />
        <LengthInput label="Label height" value={style.labelSize} min={2} max={20} onChange={(labelSize) => set({ labelSize })} />
      </div>
    </Section>
  );
}
