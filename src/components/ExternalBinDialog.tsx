import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { projectOf, useStore, useUnits } from '../state/store';
import { Field, Segmented, Stepper, TextInput, Toggle } from './fields';
import { HalfStepper } from './DrawerPanel';
import { ContentsText } from './ContentsField';
import { computeLayout } from '../lib/layout/drawer';
import { planJob } from '../lib/project';
import { MAX_CELLS } from '../lib/geometry/placement';
import { MAX_BIN_UNITS } from '../lib/binLayout';
import { fitsBed, usableBeds } from '../lib/bedfit';
import { EXTERNAL_COLORS, externalOpts, type MeshRef } from '../lib/external';
import { binTotalHeight } from '../lib/geometry/bin';
import { detectFootprint, detectHeight, footprintNote } from '../lib/imported/footprint';
import { canKeepMeshes, keepMesh } from '../lib/imported/meshStore';
import type { ImportedObject } from '../lib/imported/parse';
import { addExternal } from '../state/externalBins';
import type { ExternalMode } from './ExternalBins';
import './externalBins.css';

/** Accepted files. */
const ACCEPT = '.stl,.3mf,.obj';
type Scale = 'mm' | 'cm' | 'in';
const SCALE: Record<Scale, number> = { mm: 1, cm: 10, in: 25.4 };

/** Colour swatches. */
export function ColorField({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <Field label="Colour">
      <div className="ext-swatches" role="radiogroup" aria-label="Colour">
        {EXTERNAL_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={c === value}
            aria-label={c}
            className={`ext-swatch ${c === value ? 'active' : ''}`}
            style={{ background: c }}
            onClick={() => onChange(c)}
          />
        ))}
      </div>
    </Field>
  );
}

/** Width and depth in cells (half cells on a half grid, shown as units). */
export function FootprintFields({ w, d, half, onChange }: { w: number; d: number; half: boolean; onChange: (w: number, d: number) => void }) {
  const max = half ? MAX_CELLS : MAX_BIN_UNITS;
  return half ? (
    <div className="row2">
      <HalfStepper label="Width" cells={w} max={max} suffix="u" onChange={(v) => onChange(v, d)} />
      <HalfStepper label="Depth" cells={d} max={max} suffix="u" onChange={(v) => onChange(w, v)} />
    </div>
  ) : (
    <div className="row2">
      <Stepper label="Width" value={w} min={1} max={max} suffix="u" onChange={(v) => onChange(v, d)} />
      <Stepper label="Depth" value={d} min={1} max={max} suffix="u" onChange={(v) => onChange(w, v)} />
    </div>
  );
}

/** Top view: the cells it takes, and the mesh's footprint on them. */
function FootprintPreview({ cells, mesh, half }: { cells: [number, number]; mesh?: [number, number]; half: boolean }) {
  const pitch = half ? 21 : 42;
  const W = cells[0] * pitch;
  const D = cells[1] * pitch;
  const vw = Math.max(W, mesh?.[0] ?? 0) + 16;
  const vd = Math.max(D, mesh?.[1] ?? 0) + 16;
  const cx = vw / 2;
  const cy = vd / 2;
  return (
    <svg viewBox={`0 0 ${vw} ${vd}`} role="img" aria-label="Footprint on the grid">
      {Array.from({ length: cells[0] }, (_, i) =>
        Array.from({ length: cells[1] }, (_, j) => (
          <rect key={`${i},${j}`} x={cx - W / 2 + i * pitch + 1} y={cy - D / 2 + j * pitch + 1} width={pitch - 2} height={pitch - 2} rx={3} fill="#262c36" stroke="#3a4252" strokeWidth={0.6} />
        )),
      )}
      {mesh && <rect x={cx - mesh[0] / 2} y={cy - mesh[1] / 2} width={mesh[0]} height={mesh[1]} rx={3.5} fill="rgba(245,165,36,0.18)" stroke="#f5a524" strokeWidth={0.9} />}
    </svg>
  );
}

/**
 * Add a bin from elsewhere (lib/external.ts): a placeholder box for a bin you
 * already have, or an STL / 3MF / OBJ bin, its footprint found from its size.
 */
export function ExternalBinDialog({ mode, onClose }: { mode: ExternalMode; onClose: () => void }) {
  const drawer = useStore((s) => s.drawer);
  const setup = useStore((s) => s.setup);
  const bins = useStore((s) => s.bins);
  const layout = useMemo(() => computeLayout(drawer), [drawer]);
  const half = !!layout.halfGrid;
  const room = useMemo(() => planJob(projectOf(useStore.getState())).drawers[0]?.room ?? Infinity, [drawer]);
  const { fmt } = useUnits();
  const titleId = useId();
  const [tab, setTab] = useState<ExternalMode>(mode);
  const [error, setError] = useState<string | null>(null);
  // Shared by both kinds.
  const [name, setName] = useState('');
  const [color, setColor] = useState(EXTERNAL_COLORS[bins.filter((b) => b.external).length % EXTERNAL_COLORS.length]);
  const [stackable, setStackable] = useState(false);
  const [contents, setContents] = useState('');
  // A placeholder.
  const [cells, setCells] = useState<[number, number]>(half ? [2, 2] : [1, 1]);
  const [heightUnits, setHeightUnits] = useState(3);
  // An import.
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [scale, setScale] = useState<Scale>('mm');
  const [objects, setObjects] = useState<ImportedObject[] | null>(null);
  const [reading, setReading] = useState(false);
  const [pick, setPick] = useState(0);
  const [rotate, setRotate] = useState(false);
  const [footprint, setFootprint] = useState<[number, number] | null>(null);
  const [print, setPrint] = useState(true);
  const [keeps, setKeeps] = useState<boolean | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void canKeepMeshes().then(setKeeps);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  // The import tab opens on the file picker.
  useEffect(() => {
    if (mode === 'import') input.current?.click();
  }, [mode]);

  // Read the file (again when its units change): the readers load now.
  useEffect(() => {
    if (!file) return;
    let live = true;
    setReading(true);
    setError(null);
    const t = setTimeout(async () => {
      try {
        const { parseMeshFile } = await import('../lib/imported/parse');
        const objs = parseMeshFile(file.name, file.bytes, SCALE[scale]);
        if (!live) return;
        setObjects(objs);
        setPick(0);
        setFootprint(null);
        setRotate(false);
        setName((n) => n || objs[0].name);
        // A bin with a stacking lip says so by its height; it's still the user's call.
        setStackable(false);
      } catch (e) {
        if (live) {
          setObjects(null);
          setError((e as Error).message);
        }
      } finally {
        if (live) setReading(false);
      }
    }, 30);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [file, scale]);

  const open = async (f: File) => {
    setName('');
    setFile({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  };

  const obj = objects?.[pick];
  const size = obj ? (rotate ? [obj.size[1], obj.size[0], obj.size[2]] : obj.size) : null;
  const fit = size ? detectFootprint(size[0], size[1], half) : null;
  const height = size ? detectHeight(size[2]) : null;
  const foot: [number, number] = footprint ?? (fit ? [fit.x.cells, fit.y.cells] : [1, 1]);
  const beds = usableBeds(setup);
  const tooBig = !!size && print && !fitsBed(size[0], size[1], size[2], beds);
  const heightMm = tab === 'placeholder' ? binTotalHeight(externalOpts({ unitsX: 1, unitsY: 1, heightUnits, stackable })) : (size?.[2] ?? 0);
  const tooTall = heightMm > room + 1e-6;
  const u = (n: number) => (half ? n / 2 : n);

  const add = () => {
    setError(null);
    if (tab === 'placeholder') {
      const r = addExternal({ name: name.trim() || 'Bin I have', color, unitsX: cells[0], unitsY: cells[1], heightUnits, stackable, contents });
      if (r.error) return setError(r.error);
      return onClose();
    }
    if (!obj || !size || !file) return;
    const { hash } = keepMesh(obj.mesh, file.name);
    const mesh: MeshRef = { hash, file: file.name, size: obj.size, triangles: obj.triangles, closed: obj.closed, ...(rotate ? { rotate: true } : {}) };
    const r = addExternal({ name: name.trim() || obj.name, color, unitsX: foot[0], unitsY: foot[1], stackable, mesh, print, contents });
    if (r.error) return setError(r.error);
    onClose();
  };

  const common = (
    <>
      <TextInput label="Name" value={name} onChange={setName} placeholder={tab === 'placeholder' ? 'e.g. Ammo can, IKEA box, Screw bin' : obj?.name} hint="On the grid and the drawer map, and what Find looks for." />
      <ColorField value={color} onChange={setColor} />
      <Toggle
        label="Stackable"
        checked={stackable}
        onChange={setStackable}
        hint={
          tab === 'import' && height?.lip
            ? 'Its height looks like a bin with a stacking lip. Turn this on if it has one, so bins can stand on it.'
            : 'On: its top has a Gridfinity stacking lip, so bins can stand on it. Off: a flat top nothing stacks on.'
        }
      />
      <ContentsText label="What’s in it" value={contents} onChange={setContents} placeholder={'One thing per line, e.g.\nM3 × 8 screws'} />
    </>
  );

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal ext-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-head">
          <h2 id={titleId}>Bins from elsewhere</h2>
          <Segmented
            ariaLabel="What to add"
            value={tab}
            options={[
              { value: 'placeholder', label: 'A bin I already have', title: 'A box that takes its place in the drawer and is never printed' },
              { value: 'import', label: 'Import STL / 3MF / OBJ', title: 'A Gridfinity bin made elsewhere: Printables, MakerWorld, another generator' },
            ]}
            onChange={(t) => {
              setTab(t);
              setError(null);
            }}
          />
          <button className="link modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void open(f);
            e.target.value = '';
          }}
        />
        {tab === 'placeholder' ? (
          <div className="ext-body">
            <div>
              <p className="muted small">
                A bin you bought or printed before: it takes its cells, counts for the drawer&apos;s height and for stacking, and shows in Find and on the drawer
                map. Gridfit never prints it.
              </p>
              <FootprintFields w={cells[0]} d={cells[1]} half={half} onChange={(w, d) => setCells([w, d])} />
              <Stepper
                label="Height"
                value={heightUnits}
                min={2}
                max={30}
                suffix="u"
                onChange={setHeightUnits}
                hint={`7 mm units without a lip: ${fmt(heightMm)} overall${stackable ? ' with the lip' : ''}.`}
              />
              {common}
            </div>
            <div className="ext-preview">
              <FootprintPreview cells={cells} half={half} />
              <span className="muted small">
                {u(cells[0])} × {u(cells[1])} units, {fmt(heightMm)} tall
              </span>
              {tooTall && <div className="ext-note warn">Taller than the drawer ({fmt(room)} of room above the baseplate).</div>}
            </div>
          </div>
        ) : (
          <div
            className={`ext-body ${obj ? '' : 'single'}`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void open(f);
            }}
          >
            <div>
              <div className="button-row">
                <button onClick={() => input.current?.click()}>{file ? 'Another file…' : 'Choose a file…'}</button>
                {file && <span className="muted small">{file.name}</span>}
              </div>
              {!file && (
                <p className="muted small">
                  An STL, 3MF or OBJ Gridfinity bin (drop it here). Gridfit finds its footprint from its size: n × 42 − 0.5 mm per side, 21 mm cells on a half grid.
                </p>
              )}
              {reading && (
                <p className="muted small">
                  <span className="spinner" /> Reading…
                </p>
              )}
              {objects && objects.length > 1 && (
                <>
                  <span className="field-label">This file has {objects.length} objects: pick one</span>
                  <ul className="ext-objects">
                    {objects.map((o, i) => (
                      <li key={i}>
                        <button
                          className={i === pick ? 'active' : ''}
                          onClick={() => {
                            setPick(i);
                            setFootprint(null);
                            setName(o.name);
                          }}
                        >
                          <span>{o.name}</span>
                          <span className="muted small">
                            {fmt(o.size[0])} × {fmt(o.size[1])} × {fmt(o.size[2])}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {obj && fit && height && size && (
                <>
                  <dl className="ext-facts">
                    <dt>Size</dt>
                    <dd>
                      {fmt(size[0])} × {fmt(size[1])} × {fmt(size[2])}
                    </dd>
                    <dt>Grid</dt>
                    <dd>
                      {fit.x.units} × {fit.y.units} units, {height.exact ? `${height.units}u${height.lip ? ' with a stacking lip' : ''}` : `about ${height.units}u`}
                    </dd>
                    <dt>Mesh</dt>
                    <dd>
                      {obj.triangles.toLocaleString()} triangles{obj.closed ? ', a closed solid' : ', not a closed solid'}
                    </dd>
                  </dl>
                  {fit.exact ? (
                    <div className="ext-note ok">On the grid: it takes {u(foot[0])} × {u(foot[1])} units.</div>
                  ) : (
                    <div className="ext-note warn">
                      {footprintNote(fit, half, (mm) => fmt(mm))}{' '}
                      {(fit.x.up !== fit.x.cells || fit.y.up !== fit.y.cells) && (
                        <button className="link" onClick={() => setFootprint([fit.x.up, fit.y.up])}>
                          Use {u(fit.x.up)} × {u(fit.y.up)}
                        </button>
                      )}{' '}
                      {footprint && (
                        <button className="link" onClick={() => setFootprint(null)}>
                          Nearest ({u(fit.x.cells)} × {u(fit.y.cells)})
                        </button>
                      )}
                    </div>
                  )}
                  {!obj.closed && (
                    <div className="ext-note warn">
                      It isn&apos;t a closed solid: it exports as it is (slicers usually cope), but STEP files leave it out and its filament estimate is rough.
                    </div>
                  )}
                  <FootprintFields w={foot[0]} d={foot[1]} half={half} onChange={(w, d) => setFootprint([w, d])} />
                  <Toggle
                    label="Turn 90°"
                    checked={rotate}
                    onChange={(r) => {
                      setRotate(r);
                      setFootprint((f) => (f ? [f[1], f[0]] : f));
                    }}
                    hint="Z is up as the file has it; this turns it on the drawer floor (and on the plate), width for depth."
                  />
                  <Segmented
                    label="Printing"
                    value={print ? 'print' : 'have'}
                    options={[
                      { value: 'print', label: 'Print it with my bins', title: 'Packed onto the plates and exported as it is' },
                      { value: 'have', label: 'I already have it', title: 'Shown in the drawer, never printed' },
                    ]}
                    onChange={(v) => setPrint(v === 'print')}
                  />
                  {tooBig && <div className="ext-note warn">It doesn&apos;t fit the printer, so it would be left off the plates.</div>}
                  <Segmented
                    label="File units"
                    value={scale}
                    options={[
                      { value: 'mm', label: 'mm' },
                      { value: 'cm', label: 'cm' },
                      { value: 'in', label: 'inches' },
                    ]}
                    onChange={setScale}
                    hint="STL and OBJ files don't say; Gridfinity models are in mm."
                  />
                  {common}
                </>
              )}
            </div>
            {obj && size && (
              <div className="ext-preview">
                <FootprintPreview cells={foot} mesh={[size[0], size[1]]} half={half} />
                <span className="muted small">Top view: its cells, and the mesh centred on them.</span>
                {tooTall && <div className="ext-note warn">Taller than the drawer ({fmt(room)} of room above the baseplate).</div>}
                {keeps === false && (
                  <div className="ext-note warn">
                    This browser won&apos;t keep the mesh after a reload (a private window?). Save the project (Print plates → Project) to keep it.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <footer className="ext-foot">
          <span>{error && <span className="field-error">{error}</span>}</span>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={add} disabled={tab === 'import' && !obj}>
            Add to the drawer
          </button>
        </footer>
      </div>
    </div>
  );
}
