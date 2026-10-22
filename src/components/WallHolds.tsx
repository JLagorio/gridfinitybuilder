/**
 * An attachment that holds a bin (lib/wall/follow.ts): on its form, "Holds" picks the bin from the project's, drawer
 * by drawer, and the options the bin sets show as set (WallPanel's AttachmentFields); on the bin's own panel, "Held on"
 * says where it hangs.
 */
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../state/store';
import { Select, type SelectOption } from './fields';
import { binEntries } from '../lib/inventory';
import { attachmentDef, type AttachmentDef, type PlacedAttachment } from '../lib/wall';
import { holding, holdersOf } from '../lib/wall/follow';
import { holdBin, showAttachment } from '../state/follow';
import type { PlacedBin } from '../lib/project';

/** The project's saved drawers (the active one, this board, holds no bins). */
const useDrawers = () => useStore(useShallow((s) => ({ drawers: s.drawers, active: s.activeDrawerId })));

/** The options of `a` its bin sets now (none when it holds no bin, or its bin is gone). */
export function useHeldKeys(a: PlacedAttachment | null): ReadonlySet<string> | undefined {
  const { drawers } = useDrawers();
  return useMemo(() => {
    const set = a?.follow && holding(a, drawers)?.set;
    return set ? new Set(Object.keys(set)) : undefined;
  }, [a, drawers]);
}

/** "Holds": pick a bin to size it from, or none (it keeps its size). */
export function HoldsField({ a, def }: { a: PlacedAttachment; def: AttachmentDef<object> }) {
  const { drawers, active } = useDrawers();
  const entries = useMemo(() => binEntries(drawers.filter((d) => d.id !== active && d.bins.length)), [drawers, active]);
  if (!def.follow) return null;
  const at = a.follow ? entries.findIndex((e) => e.drawerId === a.follow!.drawer && e.bin.id === a.follow!.bin) : -1;
  const value = !a.follow ? '' : at < 0 ? 'gone' : String(at);
  const options: SelectOption[] = [
    { value: '', label: 'No bin: sized by hand' },
    ...(value === 'gone' ? [{ value: 'gone', label: 'A bin that’s gone', disabled: true }] : []),
    ...entries.map((e, i) => ({
      value: String(i),
      label: `${e.desc}${e.label ? ` “${e.label}”` : ''}`,
      group: e.drawerName,
      hint: [e.pos, ...e.contents.slice(0, 3)].join(' · '),
    })),
  ];
  const unlink = (
    <button className="link" onClick={() => holdBin(a.id, null)}>
      Unlink
    </button>
  );
  const hint =
    value === 'gone' ? (
      <>The bin it held is gone (deleted, or its drawer): it keeps its last size. {unlink}</>
    ) : a.follow ? (
      <>
        Sized from its bin: when the bin changes, this follows.{' '}
        <button className="link" onClick={() => useStore.getState().locateBin(a.follow!.drawer, a.follow!.bin)}>
          Show the bin
        </button>{' '}
        {unlink}
      </>
    ) : entries.length ? (
      'A Gridfinity bin in this project: it’s sized to fit it, and follows when the bin changes.'
    ) : (
      'No bins in this project yet: draw one in a drawer to size this from it.'
    );
  return (
    <Select
      label="Holds"
      value={value}
      options={options}
      hint={hint}
      onChange={(v) => {
        const e = entries[Number(v)];
        if (!v) holdBin(a.id, null);
        else if (e) holdBin(a.id, { drawer: e.drawerId, bin: e.bin.id });
      }}
    />
  );
}

/** On a bin's panel: the boards' attachments that hold it, and a way there. */
export function HeldOn({ bin }: { bin: PlacedBin }) {
  const { drawers, active } = useDrawers();
  const held = useMemo(() => holdersOf(drawers, { drawer: active, bin: bin.id }), [drawers, active, bin.id]);
  if (!held.length) return null;
  return (
    <div className="field-hint">
      {held.map(({ board, a }) => {
        const def = attachmentDef(a.type);
        const name = a.name?.trim() || (def ? def.summary(def.sanitize(a.opts) as never) : 'an attachment');
        return (
          <div key={a.id}>
            Held on {board.name} ({name}): it follows this bin’s size.{' '}
            <button className="link" onClick={() => showAttachment(board.id, a.id)}>
              Show
            </button>
          </div>
        );
      })}
    </div>
  );
}
