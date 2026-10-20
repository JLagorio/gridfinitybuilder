import { useState } from 'react';
import { useStore } from '../state/store';
import { Section, Segmented, Slider, Stepper, Toggle } from './fields';
import { binLabel, type BinOptions } from '../lib/geometry/bin';
import { hasLid } from '../lib/geometry/lid';
import { canPlace, withBlocked } from '../lib/bins';
import { binSpec, lidSpec, type PrintJob } from '../lib/project';
import { BaseField, HeightField, HoleFields, InteriorFields, LipFields, WallFields } from './BinVariantFields';
import { downloadBytes, geometry } from '../worker/client';
import { duplicateSelection, removeSelection, useSelectedIds } from '../state/selection';
import { TemplatesSection } from './TemplatesSection';
import { CompartmentsSection } from './CompartmentFields';

function BinFields({
  opts,
  onChange,
  sizeEditable,
  sizeError,
}: {
  opts: BinOptions;
  onChange: (p: Partial<BinOptions>) => void;
  sizeEditable: boolean;
  sizeError?: string | null;
}) {
  return (
    <>
      {sizeEditable && (
        <>
          <div className="row2">
            <Stepper label="Width" value={opts.unitsX} min={1} max={12} suffix="u" onChange={(unitsX) => onChange({ unitsX })} />
            <Stepper label="Depth" value={opts.unitsY} min={1} max={12} suffix="u" onChange={(unitsY) => onChange({ unitsY })} />
          </div>
          {sizeError && <div className="field-error">{sizeError}</div>}
        </>
      )}
      <HeightField opts={opts} onChange={onChange} />
      <InteriorFields opts={opts} onChange={onChange} />
      <Slider
        label="Finger scoop"
        value={opts.scoop}
        min={0}
        max={1}
        step={0.05}
        format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)}
        onChange={(scoop) => onChange({ scoop })}
        hint="Curved front wall so small parts slide out. Compartments can override it and the label tab."
      />
      <Segmented
        label="Label tab"
        value={opts.label}
        options={[
          { value: 'none', label: 'None' },
          { value: 'full', label: 'Full' },
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Mid' },
          { value: 'right', label: 'Right' },
        ]}
        onChange={(label) => onChange({ label })}
      />
      <BaseField opts={opts} onChange={onChange} />
      <HoleFields opts={opts} onChange={onChange} />
      <LipFields opts={opts} onChange={onChange} />
      <WallFields opts={opts} onChange={onChange} />
      <Toggle label="Rounded inside corners" checked={opts.fillet} onChange={(fillet) => onChange({ fillet })} />
    </>
  );
}

export function BinPanel({ job }: { job: PrintJob }) {
  const bins = useStore((s) => s.bins);
  const selectedId = useStore((s) => s.ui.selectedBinId);
  const newBin = useStore((s) => s.newBin);
  const updateBin = useStore((s) => s.updateBin);
  const setNewBin = useStore((s) => s.setNewBin);
  const fillEmpty = useStore((s) => s.fillEmpty);
  const clearBins = useStore((s) => s.clearBins);
  const setUI = useStore((s) => s.setUI);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sel = bins.find((b) => b.id === selectedId) ?? null;
  // With several bins selected, the panel shows the primary one and edits apply to all.
  const selIds = useSelectedIds();
  const many = selIds.length > 1;
  const { nx, ny } = job.layout;

  const changeSelected = (p: Partial<BinOptions>) => {
    if (!sel) return;
    if (p.unitsX !== undefined || p.unitsY !== undefined) {
      const r = { x: sel.x, y: sel.y, w: p.unitsX ?? sel.opts.unitsX, d: p.unitsY ?? sel.opts.unitsY };
      if (!canPlace(withBlocked(bins, job.layout.mask), r, nx, ny, sel.id)) {
        setSizeError('No room to grow that way — move the bin or clear neighbours first.');
        return;
      }
    }
    setSizeError(null);
    for (const id of many ? selIds : [sel.id]) updateBin(id, { opts: p });
  };

  const downloadSelected = async (format: '3mf' | 'stl' = '3mf') => {
    if (!sel) return;
    setBusy(true);
    try {
      const spec = binSpec(job.layout, sel);
      const name = `gridfinity-bin-${sel.opts.unitsX}x${sel.opts.unitsY}x${sel.opts.heightUnits}u`;
      if (format === 'stl') downloadBytes(await geometry.exportStlSingle(spec, binLabel(sel.opts)), `${name}.stl`, 'model/stl');
      else downloadBytes(await geometry.exportSingle(spec, binLabel(sel.opts)), `${name}.3mf`, 'model/3mf');
    } finally {
      setBusy(false);
    }
  };
  const downloadLid = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      const bytes = await geometry.exportSingle(lidSpec(job.layout, sel), `Lid ${sel.opts.unitsX}×${sel.opts.unitsY}`);
      downloadBytes(bytes, `gridfinity-lid-${sel.opts.unitsX}x${sel.opts.unitsY}.3mf`, 'model/3mf');
    } finally {
      setBusy(false);
    }
  };

  const counts = new Map<string, number>();
  for (const b of bins) counts.set(binLabel(b.opts), (counts.get(binLabel(b.opts)) ?? 0) + 1);

  return (
    <>
      {sel ? (
        <Section
          title={many ? `${selIds.length} bins selected` : 'Selected bin'}
          aside={
            <button className="link" onClick={() => setUI({ selectedBinId: null })}>
              Done
            </button>
          }
        >
          {many && <p className="muted small">Showing the first bin's settings. Changes apply to all {selIds.length}.</p>}
          <BinFields opts={sel.opts} onChange={changeSelected} sizeEditable={!many} sizeError={sizeError} />
          <div className="button-row">
            <button onClick={() => duplicateSelection()}>Duplicate</button>
            <button onClick={() => setNewBin({ ...sel.opts })} title="New bins you draw will use these settings">
              Use for new bins
            </button>
            <button className="danger" onClick={() => removeSelection()}>
              Delete
            </button>
          </div>
          <button className="primary wide" onClick={() => downloadSelected()} disabled={busy}>
            {busy ? 'Building…' : 'Download this bin (.3mf)'}
          </button>
          <button className="link" onClick={() => downloadSelected('stl')} disabled={busy}>
            Download as STL
          </button>
          {hasLid(sel.opts) && (
            <button className="link" onClick={downloadLid} disabled={busy}>
              Download its lid (.3mf)
            </button>
          )}
        </Section>
      ) : (
        <Section title="New bin settings">
          <p className="muted small">
            Drag across empty cells on the grid to draw a bin. Click a bin to edit it, drag it to move, press Delete to remove.
          </p>
          <BinFields opts={newBin} onChange={setNewBin} sizeEditable={false} />
        </Section>
      )}
      {sel ? (
        sel.opts.interior !== 'pockets' && (
          <CompartmentsSection key={sel.id} opts={sel.opts} onChange={changeSelected} binId={sel.id} grid={job.layout} />
        )
      ) : (
        newBin.interior !== 'pockets' && <CompartmentsSection opts={newBin} onChange={setNewBin} />
      )}

      <TemplatesSection />

      <Section title="Layout">
        <div className="button-row">
          <button onClick={() => fillEmpty()} disabled={!nx || !ny}>
            Fill empty with 1×1
          </button>
          <button className="danger" onClick={() => confirm('Remove all bins?') && clearBins()} disabled={!bins.length}>
            Clear all
          </button>
        </div>
        {bins.length > 0 ? (
          <ul className="bin-counts">
            {[...counts.entries()].map(([label, n]) => (
              <li key={label}>
                <span>{label}</span>
                <b>× {n}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No bins yet.</p>
        )}
      </Section>
    </>
  );
}
