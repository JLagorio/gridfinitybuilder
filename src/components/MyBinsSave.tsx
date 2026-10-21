import { useEffect, useId, useState } from 'react';
import { create } from 'zustand';
import { useStore } from '../state/store';
import { useSelectedIds } from '../state/selection';
import { saveToMyBins, suggestedName, useMyBins } from '../state/myBins';
import { binsWithAbove } from '../lib/stacking';
import { Field, Segmented, Toggle } from './fields';
import { useCoarsePointer } from './touch';
import './myBins.css';

/**
 * "Save to My bins" for the selected bins (state/myBins.ts): a button, and a
 * short form under it (name, one set or each on its own, keep what's in it).
 * The button is in This bin's actions and in the My bins section; the form
 * opens where it was pressed.
 */

type Where = 'actions' | 'library';

interface SaveForm {
  /** Where the form is open, and for which selection (another selection closes it). */
  where: Where | null;
  sel: string;
  open(where: Where | null, sel?: string): void;
}

const useSaveForm = create<SaveForm>((set) => ({ where: null, sel: '', open: (where, sel = '') => set({ where, sel }) }));

export function SaveToMyBinsButton({ where = 'actions', className }: { where?: Where; className?: string }) {
  const sel = useSelectedIds().join();
  const open = useSaveForm((s) => s.where === where && s.sel === sel);
  return (
    <button
      type="button"
      className={className}
      aria-expanded={open}
      onClick={() => useSaveForm.getState().open(open ? null : where, sel)}
      title="Keep the whole bin (size, inside, labels, inserts, lid) in this browser, for every project"
    >
      Save to My bins…
    </button>
  );
}

interface Done {
  sel: string;
  text: string;
  error?: boolean;
}

/** The form, where it's open; after saving, what happened (until the selection changes). */
export function SaveToMyBinsForm({ where = 'actions' }: { where?: Where }) {
  const selIds = useSelectedIds();
  const sel = selIds.join();
  const open = useSaveForm((s) => s.where === where && s.sel === sel);
  const [done, setDone] = useState<Done | null>(null);
  useEffect(() => {
    if (open) setDone(null);
  }, [open]);
  // Mounted afresh each time it opens, for each selection.
  if (open) return <SaveForm key={sel} selIds={selIds} onDone={setDone} />;
  return done && done.sel === sel ? (
    <p className={`field-hint mybins-done${done.error ? ' error' : ''}`} role="status">
      {done.text}
    </p>
  ) : null;
}

function SaveForm({ selIds, onDone }: { selIds: string[]; onDone: (d: Done) => void }) {
  const sel = selIds.join();
  const bins = useStore((s) => s.bins);
  const coarse = useCoarsePointer();
  const id = useId();
  const [name, setName] = useState(() => suggestedName(selIds));
  const [separately, setSeparately] = useState(false);
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const many = selIds.length > 1;

  const picked = bins.filter((b) => selIds.includes(b.id));
  const hasContents = binsWithAbove(bins, picked).some((b) => b.contents || (b.compContents && Object.keys(b.compContents).length));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const made = saveToMyBins(selIds, { name, contents: keep, separately: many && separately });
    const status = useMyBins.getState().status;
    if (!made.length) {
      setError(status === 'newer' ? 'My bins was saved by a newer version of Gridfit: reload the page to update, then save it.' : 'There’s nothing selected to save.');
      return;
    }
    const what = made.length === 1 ? `“${made[0].name}”` : `${made.length} bins`;
    const kept =
      status === 'memory'
        ? ' This browser isn’t keeping My bins, though (a private window, or site data is blocked): export them to keep them.'
        : status === 'full'
          ? ' The browser’s storage is full, so it’s only kept until this tab closes: export My bins, or delete some.'
          : ' Place it in any drawer, in any project, from My bins.';
    onDone({ sel, text: `Saved ${what} to My bins.${kept}`, error: status !== 'saved' });
    useSaveForm.getState().open(null);
  };

  return (
    <form className="mybins-save" onSubmit={submit} aria-label="Save to My bins">
      {many && (
        <Segmented
          label="Save them"
          value={separately ? 'each' : 'set'}
          options={[
            { value: 'set', label: 'As one set', title: 'One entry: the bins together, arranged as they are' },
            { value: 'each', label: 'Each on its own', title: 'One entry per bin (a stack stays together)' },
          ]}
          onChange={(v) => {
            setSeparately(v === 'each');
            if (v === 'set') setName(suggestedName(selIds));
          }}
        />
      )}
      {!(many && separately) && (
        <Field label="Name" id={id}>
          <div className="input-wrap">
            <input id={id} value={name} maxLength={80} autoFocus={!coarse} onChange={(e) => setName(e.target.value)} placeholder="From its label or contents" />
          </div>
        </Field>
      )}
      {hasContents && <Toggle label="Keep what’s in it" checked={keep} onChange={setKeep} hint="Its contents list, and any label text that comes from it." />}
      {error && <div className="field-error">{error}</div>}
      <div className="button-row">
        <button type="submit" className="primary">
          Save
        </button>
        <button type="button" onClick={() => useSaveForm.getState().open(null)}>
          Cancel
        </button>
      </div>
      <div className="field-hint">The whole bin: size, height, inside, labels, inserts and lid. It’s kept in this browser for every project, not in this project’s file.</div>
    </form>
  );
}
