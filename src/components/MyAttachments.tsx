import { useId, useMemo, useRef, useState } from 'react';
import { useStore, useUnits } from '../state/store';
import {
  deleteMyAttachment,
  duplicateMyAttachment,
  importMyAttachments,
  myAttachmentLink,
  myAttachmentsFileText,
  placeMyAttachment,
  renameMyAttachment,
  saveToMyAttachments,
  suggestedName,
  undoDeleteMyAttachment,
  useMyAttachments,
  type ImportReport,
  type LibraryStatus,
} from '../state/myAttachments';
import { DEFAULT_CTX, LINK_LONG, entryKnown, entryMatches, entryView, type AttachmentEntry } from '../lib/myAttachments';
import type { MountCtx } from '../lib/wall';
import { attachmentUi } from '../lib/wall/ui';
import type { WallBoard, WallPlacement } from '../lib/wall/plan';
import { downloadBytes } from '../worker/client';
import { Field, TextInput, Toggle } from './fields';
import './myAttachments.css';

/**
 * My attachments on a board's Attachments tab (state/myAttachments.ts): parts
 * of your own, kept in this browser for every board. "Save to My attachments"
 * on the selected part (or parts, as a set), and the picker's Mine group:
 * a front view of each, Add to put it on the board, rename, duplicate,
 * delete (with undo), a link to share one, and a file to move them to
 * another browser.
 */

const kindLabel = (type: string) => attachmentUi(type)?.label ?? type;

/** How many entries a picker search finds (all of them with no search). */
export function useMineCount(query: string): number {
  const entries = useMyAttachments((s) => s.entries);
  return useMemo(() => entries.filter((e) => entryMatches(e, query, kindLabel)).length, [entries, query]);
}

// ---------------------------------------------------------------------------
// Preview: the parts from the front, as the board editor draws them
// ---------------------------------------------------------------------------

/** An entry seen from the front on a board of `ctx`: each part's body and mounts (a dashed box for a kind this version doesn't know). */
export function AttachmentPreview({ entry, ctx = DEFAULT_CTX, size = 46 }: { entry: Pick<AttachmentEntry, 'items'>; ctx?: MountCtx; size?: number }) {
  const v = useMemo(() => entryView(entry, ctx), [entry, ctx]);
  const { x0, y0, x1, y1 } = v.box;
  const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
  // Wall y is up; the picture's is down.
  const sy = (y: number) => y1 - y;
  const r = ctx.pitch * 0.14;
  return (
    <svg className="myatt-thumb" viewBox={`${x0 - pad} ${-pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`} width={size} height={size} aria-hidden>
      {v.parts.map((p, i) => (
        <g key={i}>
          <rect
            className={`myatt-body${p.unknown ? ' unknown' : ''}`}
            x={p.x}
            y={sy(p.y + p.h)}
            width={p.w}
            height={p.h}
            rx={r}
            vectorEffect="non-scaling-stroke"
          />
          {p.mounts.map((m, k) => (
            <circle key={k} className={`myatt-mount ${m.kind}`} cx={m.x} cy={sy(m.y)} r={m.kind === 'stud' ? r * 0.8 : r} />
          ))}
        </g>
      ))}
    </svg>
  );
}

/** "Tool rack · 120 × 80 mm", "3 parts · 200 × 90 mm", or why it can't be added. */
export function useEntrySummary() {
  const { fmt } = useUnits();
  return (e: AttachmentEntry, ctx: MountCtx = DEFAULT_CTX) => {
    if (!entryKnown(e)) return 'From a newer Gridfit: reload to update';
    const b = entryView(e, ctx).box;
    const what = e.items.length === 1 ? kindLabel(e.items[0].type) : `${e.items.length} parts`;
    return `${what} · ${fmt(b.x1 - b.x0)} × ${fmt(b.y1 - b.y0)}`;
  };
}

// ---------------------------------------------------------------------------
// The picker's Mine group
// ---------------------------------------------------------------------------

interface Notice {
  text: string;
  error?: boolean;
  /** Offer Undo for the deletion just made. */
  undo?: boolean;
}

const STATUS_TEXT: Record<Exclude<LibraryStatus, 'saved'>, string> = {
  memory: 'This browser isn’t keeping My attachments (a private window, or site data is blocked): they last until this tab closes. Export them to keep them.',
  full: 'The browser’s storage is full, so the last change to My attachments is only kept until this tab closes. Export them, or delete some.',
  newer: 'My attachments was last saved by a newer version of Gridfit, so it can’t be changed here. Reload the page to update.',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function importText(r: ImportReport): string {
  const parts: string[] = [];
  if (r.added) parts.push(`Added ${plural(r.added, 'entry', 'entries')} to My attachments.`);
  if (r.updated) parts.push(`${plural(r.updated, 'entry was', 'entries were')} replaced by the newer copy in the file.`);
  if (r.same)
    parts.push(
      r.added || r.updated
        ? `${plural(r.same, 'was', 'were')} here already.`
        : `Nothing new: ${plural(r.same, 'entry is', 'entries are')} in My attachments already.`,
    );
  if (r.older) parts.push(`${plural(r.older, 'older copy was', 'older copies were')} left out (the one here is newer).`);
  if (r.invalid) parts.push(`${plural(r.invalid, 'entry', 'entries')} had nothing usable and ${r.invalid === 1 ? 'was' : 'were'} skipped.`);
  return parts.join(' ') || 'The file has no attachments in it.';
}

/**
 * The picker's first group: My attachments, found by the picker's search (`query`, lower case). Add puts one on
 * `board` at the first free spot that fits, a set as it was arranged. Nothing when a search finds none of them.
 */
export function MineGroup({ query, board, placed }: { query: string; board: WallBoard; placed: readonly WallPlacement[] }) {
  const entries = useMyAttachments((s) => s.entries);
  const status = useMyAttachments((s) => s.status);
  const summary = useEntrySummary();
  const [closed, setClosed] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => entries.filter((e) => entryMatches(e, query, kindLabel)), [entries, query]);
  const locked = status === 'newer';
  if (query && !shown.length) return null;
  const open = !!query || !closed;

  const add = (e: AttachmentEntry) => {
    const r = placeMyAttachment(e.id, board, placed);
    if (!r.ok) setNotice({ error: true, text: `Couldn’t add “${e.name}”: ${r.error}` });
    else
      setNotice({
        text: r.clear
          ? `Added “${e.name}” to the board. Undo takes it off.`
          : `There’s no free spot for “${e.name}” on this board, so it’s on top of other parts: drag it, or make room.`,
        error: !r.clear,
      });
  };
  const remove = (e: AttachmentEntry) => {
    setOpenId(null);
    if (deleteMyAttachment(e.id)) setNotice({ text: `Deleted “${e.name}” from My attachments.`, undo: true });
  };
  const copyLink = async (e: AttachmentEntry) => {
    const r = myAttachmentLink(e.id, window.location.href);
    if ('error' in r) return setNotice({ error: true, text: r.error });
    const long =
      r.url.length > LINK_LONG
        ? ` It’s a long link (${Math.round(r.url.length / 100) / 10} k characters): some apps cut long links short, so a file is safer there.`
        : '';
    const models = r.models ? ' Imported models go as boxes of their size: a link can’t hold meshes.' : '';
    try {
      await navigator.clipboard.writeText(r.url);
      setNotice({ text: `Link to “${e.name}” copied. Whoever opens it can add it to their My attachments or put it on a board.${long}${models}` });
    } catch {
      window.prompt('Copy this link:', r.url);
      if (long || models) setNotice({ text: `${long}${models}`.trim() });
    }
  };
  const exportFile = async () =>
    downloadBytes(
      new TextEncoder().encode(await myAttachmentsFileText()),
      `gridfit-my-attachments-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    );
  const importFile = async (f: File) => {
    const r = importMyAttachments(await f.text());
    setNotice('error' in r ? { error: true, text: `Couldn’t import ${f.name}: ${r.error}` } : { text: importText(r) });
  };

  return (
    <div className="myatt">
      <button className="wall-group-label" aria-expanded={open} onClick={() => setClosed(open)}>
        <span>{open ? '▾' : '▸'}</span> Mine <small>{query ? shown.length : entries.length}</small>
      </button>
      {open && (
        <>
          {status !== 'saved' && (
            <div className={`myatt-status ${status}`} role="status">
              {STATUS_TEXT[status]}
            </div>
          )}
          {!entries.length && (
            <p className="muted small">
              Parts set up the way you like them, kept in this browser for every board. Select one on the board and use <b>Save to My attachments</b>; a few
              selected save as a set, arranged as they are.
            </p>
          )}
          {shown.length > 0 && (
            <ul className="myatt-list">
              {shown.map((e) => {
                const known = entryKnown(e);
                const editing = openId === e.id;
                return (
                  <li key={e.id} className={`myatt-row${editing ? ' open' : ''}${known ? '' : ' unknown'}`}>
                    <div className="myatt-main">
                      <AttachmentPreview entry={e} ctx={board.ctx} />
                      <button
                        className="myatt-name"
                        onClick={() => setOpenId(editing ? null : e.id)}
                        aria-expanded={editing}
                        title="Rename, duplicate, share, delete"
                      >
                        <b>{e.name}</b>
                        <small>{summary(e, board.ctx)}</small>
                      </button>
                      <button
                        className="primary myatt-add"
                        disabled={!known}
                        onClick={() => add(e)}
                        title={known ? 'Put it on the board at the first free spot that fits (undo takes it off)' : 'Reload the page to update Gridfit first'}
                      >
                        Add
                      </button>
                    </div>
                    {editing && (
                      <div className="myatt-edit">
                        <TextInput label="Name" value={e.name} onChange={(name) => renameMyAttachment(e.id, name)} />
                        <div className="button-row">
                          <button disabled={locked} onClick={() => duplicateMyAttachment(e.id)}>
                            Duplicate
                          </button>
                          <button onClick={() => void copyLink(e)} title="A link with it in it, to send to someone: nothing is uploaded">
                            Copy share link
                          </button>
                          <button className="danger" disabled={locked} onClick={() => remove(e)}>
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {notice && (
            <div className={notice.error ? 'field-error' : 'field-hint myatt-notice'} role="status">
              {notice.text}{' '}
              {notice.undo && (
                <button
                  className="link"
                  onClick={() => {
                    const back = useMyAttachments.getState().deleted?.entry.name;
                    if (undoDeleteMyAttachment()) setNotice({ text: `“${back}” is back in My attachments.` });
                  }}
                >
                  Undo
                </button>
              )}
            </div>
          )}
          {!query && (
            <div className="button-row myatt-transfer">
              <button onClick={exportFile} disabled={!entries.length} title="Download My attachments as a .json file, to import in another browser">
                Export file
              </button>
              <button onClick={() => fileInput.current?.click()} disabled={locked} title="Add the parts in a My attachments .json file">
                Import file…
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                hidden
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  if (f) void importFile(f);
                  ev.target.value = '';
                }}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Saving the selected part, or parts
// ---------------------------------------------------------------------------

/** "Save to My attachments…" for these parts of the active board (several: a set, arranged as they are), and its short form. */
export function SaveToMine({ ids, board }: { ids: string[]; board: WallBoard }) {
  const sel = ids.join();
  const [openFor, setOpenFor] = useState<string | null>(null);
  const [done, setDone] = useState<{ sel: string; text: string; error?: boolean } | null>(null);
  const open = openFor === sel;
  return (
    <>
      <div className="myatt-save-row">
        <button
          className="link"
          aria-expanded={open}
          onClick={() => {
            setOpenFor(open ? null : sel);
            setDone(null);
          }}
          title="Keep it, set up as it is, in this browser for every board"
        >
          Save to My attachments…
        </button>
      </div>
      {open ? (
        <SaveForm
          key={sel}
          ids={ids}
          board={board}
          onDone={(d) => {
            setOpenFor(null);
            if (d) setDone({ sel, ...d });
          }}
        />
      ) : (
        done?.sel === sel && (
          <p className={`field-hint myatt-done${done.error ? ' error' : ''}`} role="status">
            {done.text}
          </p>
        )
      )}
    </>
  );
}

function SaveForm({ ids, board, onDone }: { ids: string[]; board: WallBoard; onDone: (d: { text: string; error?: boolean } | null) => void }) {
  const id = useId();
  const hasContents = useStore((s) => (s.drawer.attachments ?? []).some((a) => ids.includes(a.id) && !!a.contents));
  const [name, setName] = useState(() => suggestedName(ids, board));
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const many = ids.length > 1;

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    const made = saveToMyAttachments(ids, board, { name, contents: keep });
    const status = useMyAttachments.getState().status;
    if (!made) {
      setError(
        status === 'newer'
          ? 'My attachments was saved by a newer version of Gridfit: reload the page to update, then save it.'
          : 'There’s nothing selected to save.',
      );
      return;
    }
    const kept =
      status === 'memory'
        ? ' This browser isn’t keeping My attachments, though (a private window, or site data is blocked): export them to keep them.'
        : status === 'full'
          ? ' The browser’s storage is full, so it’s only kept until this tab closes: export My attachments, or delete some.'
          : ' Add it to any board from Mine, at the top of Add to the board.';
    onDone({ text: `Saved “${made.name}” to My attachments.${kept}`, error: status !== 'saved' });
  };

  return (
    <form className="myatt-save" onSubmit={submit} aria-label="Save to My attachments">
      <Field label="Name" id={id}>
        <div className="input-wrap">
          <input id={id} value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Its name, or what it holds" />
        </div>
      </Field>
      {hasContents && <Toggle label="Keep what’s in it" checked={keep} onChange={setKeep} hint="Its contents list, and a label that comes from it." />}
      {error && <div className="field-error">{error}</div>}
      <div className="button-row">
        <button type="submit" className="primary">
          Save
        </button>
        <button type="button" onClick={() => onDone(null)}>
          Cancel
        </button>
      </div>
      <div className="field-hint">
        {many ? 'All of them as one set, arranged as they are: ' : 'Its kind and every option: '}
        lock keys, bolts, labels and what it’s printed in too. Kept in this browser for every board, not in this project’s file.
      </div>
    </form>
  );
}
