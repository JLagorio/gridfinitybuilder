import { useRef, useState, useSyncExternalStore } from 'react';
import { useUnits } from '../state/store';
import { Field } from './fields';
import { isMissing, keepMesh, meshStoreVersion, subscribeMeshStore } from '../lib/imported/meshStore';
import type { ModelRef } from '../lib/wall/kinds/model';

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * An attachment's 'model' field (lib/wall/kinds/model.ts): choose an STL, 3MF or OBJ file. It's read like an
 * imported bin's (lib/imported/parse.ts, loaded now), kept in this browser and in saved project files by its
 * content hash (lib/imported/meshStore.ts), and each of its faces mapped for where clips can go
 * (lib/wall/modelMesh.ts). Shows the file, its size, and what's wrong with it, if anything.
 */
export function ModelField({ label, value, hint, onChange }: { label: string; value: unknown; hint?: string; onChange: (ref: ModelRef) => void }) {
  const ref = (value && typeof value === 'object' ? value : null) as ModelRef | null;
  const { fmt } = useUnits();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  useSyncExternalStore(subscribeMeshStore, meshStoreVersion);

  const choose = async (f: File) => {
    setBusy(true);
    setNote(null);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const [{ parseMeshFile }, { flatMasks }] = await Promise.all([import('../lib/imported/parse'), import('../lib/wall/modelMesh')]);
      const objs = parseMeshFile(f.name, bytes);
      const o = objs[0];
      const { hash } = keepMesh(o.mesh, f.name);
      onChange({ hash, file: f.name, size: o.size.map(r3) as [number, number, number], triangles: o.triangles, closed: o.closed, flat: flatMasks(o.mesh) });
      if (objs.length > 1) setNote({ text: `The file has ${objs.length} objects: this is the first, “${o.name}”.`, error: false });
    } catch (e) {
      setNote({ text: `Couldn’t read ${f.name}: ${(e as Error).message}`, error: true });
    } finally {
      setBusy(false);
    }
  };

  const problem = !ref
    ? null
    : !ref.hash
      ? 'Its mesh didn’t come with the link it was shared by (a link can’t carry one), so a box of its size stands in. Choose its file again.'
      : isMissing(ref.hash)
        ? `Its mesh isn’t in this browser, so it can’t be shown or printed. Open the project file it was saved in, or choose ${ref.file || 'its file'} again.`
        : !ref.closed
          ? 'It isn’t a closed solid, so clips can’t be fused to it. Repair it (most slicers can) and choose it again.'
          : null;

  return (
    <Field label={label} hint={hint}>
      <div className="model-field">
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? 'Reading…' : ref ? 'Choose another…' : 'Choose a model…'}
        </button>
        {ref && (
          <span className="model-file" title={ref.file}>
            <strong>{ref.file || 'Model'}</strong>
            <small>
              {ref.size.map((v) => fmt(v)).join(' × ')} · {ref.triangles.toLocaleString()} triangles
            </small>
          </span>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept=".stl,.3mf,.obj"
        hidden
        aria-label="Model file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void choose(f);
          e.target.value = '';
        }}
      />
      {!ref && !note && <div className="field-hint">STL, 3MF or OBJ, in mm. A box stands in till you choose one.</div>}
      {problem && <div className="field-error">{problem}</div>}
      {note && <div className={note.error ? 'field-error' : 'field-hint'}>{note.text}</div>}
    </Field>
  );
}
