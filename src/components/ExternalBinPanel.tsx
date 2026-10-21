import { useState, useSyncExternalStore } from 'react';
import { useStore, useUnits } from '../state/store';
import { Section, Segmented, Stepper, TextInput, Toggle } from './fields';
import { Find } from './findContext';
import { BinContentsFields } from './ContentsField';
import { StackSection } from './StackSection';
import { BinChecksNotice } from './PrintChecks';
import { ColorField, FootprintFields } from './ExternalBinDialog';
import { binTotalHeight, type BinOptions } from '../lib/geometry/bin';
import { externalOvershoot, usableBeds } from '../lib/bedfit';
import { importedSpec, meshSize } from '../lib/external';
import { detectHeight, meshOverhang } from '../lib/imported/footprint';
import { isMissing, meshStoreVersion, subscribeMeshStore } from '../lib/imported/meshStore';
import { setExternal, turnMesh } from '../state/externalBins';
import { duplicateSelection, removeSelection } from '../state/selection';
import { downloadBytes, geometry } from '../worker/client';
import type { PlacedBin, PrintJob } from '../lib/project';
import { ExternalBinDialogPortal, type ExternalMode } from './ExternalBins';
import { BinColourField } from './ColourFields';

/**
 * The Bins panel for a bin from elsewhere (lib/external.ts): name, colour,
 * footprint, height, stackable, printing or not, contents and stacking. The
 * bin options Gridfit builds (compartments, labels, holes, …) don't apply, so
 * they aren't here.
 */
export function ExternalBinPanel({
  job,
  bin,
  many,
  onChange,
  sizeError,
}: {
  job: PrintJob;
  bin: PlacedBin;
  /** How many bins are selected. */
  many: number;
  /** Option changes, checked like any bin's (room on the grid). */
  onChange: (p: Partial<BinOptions>) => void;
  sizeError: string | null;
}) {
  const setUI = useStore((s) => s.setUI);
  const setup = useStore((s) => s.setup);
  const { fmt } = useUnits();
  useSyncExternalStore(subscribeMeshStore, meshStoreVersion);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ext = bin.external!;
  const mesh = ext.mesh;
  const half = !!job.layout.halfGrid;
  const size = mesh && meshSize(mesh);
  const fitH = size && detectHeight(size.h);
  const over = meshOverhang(job.layout, bin);
  const beds = usableBeds(setup);
  const room = job.drawers[0]?.room ?? Infinity;
  const tall = (size?.h ?? binTotalHeight(bin.opts)) > room + 1e-6;

  const download = async (format: '3mf' | 'stl') => {
    const spec = importedSpec(bin);
    if (!spec) return;
    setBusy(true);
    setMsg(null);
    try {
      const base = (ext.name || mesh?.file || 'imported-bin').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-');
      if (format === 'stl') downloadBytes(await geometry.exportStlSingle(spec, ext.name), `${base}.stl`, 'model/stl');
      else downloadBytes(await geometry.exportSingle(spec, ext.name), `${base}.3mf`, 'model/3mf');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Section
        find="bin"
        title={mesh ? 'Imported bin' : 'Bin you already have'}
        aside={
          <button className="link" onClick={() => setUI({ selectedBinId: null })}>
            Done
          </button>
        }
      >
        {many > 1 && <p className="muted small">{many} bins selected: this is the first one. Its size and Stackable apply to all of them; its name, colour and printing only to it.</p>}
        <BinChecksNotice bin={bin} layout={job.layout} />
        <TextInput label="Name" value={ext.name} onChange={(name) => setExternal(bin.id, { name })} placeholder="What is it?" hint="On the grid and the drawer map, and what Find looks for." />
        <ColorField value={ext.color} onChange={(color) => setExternal(bin.id, { color })} />
        {mesh && (
          <Segmented
            label="Printing"
            value={ext.print ? 'print' : 'have'}
            options={[
              { value: 'print', label: 'Print it with my bins', title: 'Packed onto the plates and exported as it is' },
              { value: 'have', label: 'I already have it', title: 'Shown in the drawer, never printed' },
            ]}
            onChange={(v) => setExternal(bin.id, { print: v === 'print' })}
            hint={ext.print ? 'On the plates with the other bins, exactly as the file has it.' : 'Takes its place in the drawer; never printed.'}
          />
        )}
        {/* Multi-colour: an imported mesh prints as it is, in one filament, this bin's or the bins' colour. */}
        {mesh && ext.print && (
          <Find id="bin-colour" set={bin.opts.colour !== undefined}>
            <BinColourField opts={bin.opts} onChange={onChange} hint="An imported mesh prints as it is, in one filament: this one." />
          </Find>
        )}
        {mesh && isMissing(mesh.hash) && (
          <div className="field-error">
            Its mesh isn&apos;t in this browser, so it shows as a box and can&apos;t print. Open the project file it was saved in, or import {mesh.file || 'the file'} again.
          </div>
        )}
        {ext.print && externalOvershoot(bin, beds) > 1e-6 && <div className="field-error">It doesn&apos;t fit the printer, so it&apos;s left off the plates.</div>}
        <Find id="size">
          <FootprintFields w={bin.opts.unitsX} d={bin.opts.unitsY} half={half} onChange={(unitsX, unitsY) => onChange({ unitsX, unitsY })} />
          {mesh && (
            <div className="field-hint">
              The mesh sits centred on these cells.
              {over > 0.3 ? ` It reaches ${fmt(over)} past them on its widest side, into the next cells.` : ''}
            </div>
          )}
        </Find>
        <Find id="height">
          {mesh && size ? (
            <p className="muted small">
              {fmt(size.h)} tall{fitH?.exact ? ` (${fitH.units}u${fitH.lip ? ' with a stacking lip' : ''})` : ''}, from the mesh.
            </p>
          ) : (
            <Stepper
              label="Height"
              value={bin.opts.heightUnits}
              min={2}
              max={30}
              suffix="u"
              onChange={(heightUnits) => onChange({ heightUnits })}
              hint={`7 mm units without a lip: ${fmt(binTotalHeight(bin.opts))} overall.`}
            />
          )}
        </Find>
        {tall && <div className="field-error">Taller than the drawer ({fmt(room)} of room above the baseplate).</div>}
        {sizeError && <div className="field-error">{sizeError}</div>}
        <Toggle
          label="Stackable"
          checked={bin.opts.lip}
          onChange={(lip) => onChange({ lip })}
          hint="On: its top has a Gridfinity stacking lip, so bins can stand on it. Off: a flat top nothing stacks on."
        />
        {mesh && size && (
          <dl className="ext-facts">
            <dt>File</dt>
            <dd>{mesh.file || '—'}</dd>
            <dt>Size</dt>
            <dd>
              {fmt(size.w)} × {fmt(size.d)} × {fmt(size.h)}
            </dd>
            <dt>Mesh</dt>
            <dd>
              {mesh.triangles.toLocaleString()} triangles, {mesh.closed ? 'a closed solid' : 'not a closed solid (STEP leaves it out)'}
            </dd>
          </dl>
        )}
        <p className="muted small">Gridfit doesn&apos;t build this bin, so compartments, labels, holes and the other bin options don&apos;t apply to it.</p>
      </Section>

      <Section find="contents" title="What’s in it">
        <BinContentsFields bin={bin} grid={job.layout} label={null} />
      </Section>
      <StackSection job={job} bin={bin} />

      <Section find="actions" title={many > 1 ? `These ${many} bins` : 'This bin'}>
        <div className="button-row">
          <button onClick={() => duplicateSelection()}>Duplicate</button>
          {mesh && (
            <button onClick={() => setMsg(turnMesh(bin.id) ? null : 'No room to turn it here: move it or clear its neighbours first.')} title="Turn it 90° on the drawer floor">
              Turn 90°
            </button>
          )}
          <button className="danger" onClick={() => removeSelection()}>
            Delete
          </button>
        </div>
        {mesh && !isMissing(mesh.hash) && (
          <div className="field">
            <span className="field-label">{busy ? 'Building…' : 'Download the mesh'}</span>
            <div className="button-row download-row">
              <button onClick={() => download('3mf')} disabled={busy}>
                .3mf
              </button>
              <button onClick={() => download('stl')} disabled={busy}>
                .stl
              </button>
            </div>
          </div>
        )}
        {msg && <div className="field-error">{msg}</div>}
      </Section>
    </>
  );
}

/** "Add a bin I already have…" and "Import STL / 3MF…", for the Layout section. */
export function ExternalBinButtons() {
  const [open, setOpen] = useState<ExternalMode | null>(null);
  return (
    <>
      <button onClick={() => setOpen('placeholder')} title="A box for a bin you bought or printed before: it takes its place in the drawer and is never printed">
        Add a bin I already have…
      </button>
      <button onClick={() => setOpen('import')} title="A Gridfinity bin from Printables, MakerWorld, Thingiverse… as STL, 3MF or OBJ">
        Import STL / 3MF…
      </button>
      {open && <ExternalBinDialogPortal mode={open} onClose={() => setOpen(null)} />}
    </>
  );
}
