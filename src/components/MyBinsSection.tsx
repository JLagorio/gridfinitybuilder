import { useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  deleteMyBin,
  duplicateMyBin,
  importMyBins,
  myBinAsTemplate,
  myBinsFileText,
  placeMyBin,
  renameMyBin,
  undoDeleteMyBin,
  useMyBins,
  type ImportReport,
  type LibraryStatus,
} from '../state/myBins';
import { entryContents, entryMatches, entrySummary, placementFootprint, type LibraryEntry } from '../lib/myBins';
import { binInnerSize, binLayout, binSize, sanitizeBin, type BinCells } from '../lib/geometry/bin';
import { DEFAULT_BIN, type PrintJob } from '../lib/project';
import { binBodyHeight, binFloorZ } from '../lib/geometry/variants';
import { pocketLayout } from '../lib/geometry/pockets';
import { placedOutline } from '../lib/geometry/cutouts';
import { GRID, LIP_SUPPORT_HEIGHT, WALL } from '../lib/geometry/spec';
import { usableBeds } from '../lib/bedfit';
import { downloadBytes } from '../worker/client';
import { Section, TextInput } from './fields';
import { Find } from './findContext';
import { useCoarsePointer } from './touch';
import { CompartmentInsidePreview } from './CompartmentInsidePreview';
import { interiorOf } from './interiorState';
import { endBinDrag, startBinDrag } from './MyBinsDrop';
import { SaveToMyBinsButton, SaveToMyBinsForm } from './MyBinsSave';
import './myBins.css';

/**
 * My bins in the Bins panel: whole bins of your own, kept in the browser for
 * every project (state/myBins.ts). Search, a small top view of each, place
 * one in the active drawer (or drag it onto the grid), rename, duplicate,
 * delete (with undo), and a file to move them to another browser.
 */

interface Notice {
  text: string;
  error?: boolean;
  /** Offer Undo for the deletion just made. */
  undo?: boolean;
}

const STATUS_TEXT: Record<Exclude<LibraryStatus, 'saved'>, string> = {
  memory: 'This browser isn’t keeping My bins (a private window, or site data is blocked): they last until this tab closes. Export them to keep them.',
  full: 'The browser’s storage is full, so the last change to My bins is only kept until this tab closes. Export My bins, or delete some.',
  newer: 'My bins was last saved by a newer version of Gridfit, so it can’t be changed here. Reload the page to update.',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function importText(r: ImportReport): string {
  const parts: string[] = [];
  if (r.added) parts.push(`Added ${plural(r.added, 'bin', 'bins')} to My bins.`);
  if (r.updated) parts.push(`${plural(r.updated, 'bin was', 'bins were')} replaced by the newer copy in the file.`);
  if (r.same) parts.push(r.added || r.updated ? `${plural(r.same, 'was', 'were')} here already.` : `Nothing new: ${plural(r.same, 'bin is', 'bins are')} in My bins already.`);
  if (r.older) parts.push(`${plural(r.older, 'older copy was', 'older copies were')} left out (the one here is newer).`);
  if (r.invalid) parts.push(`${plural(r.invalid, 'entry', 'entries')} had nothing usable and ${r.invalid === 1 ? 'was' : 'were'} skipped.`);
  return parts.join(' ') || 'The file has no bins in it.';
}

export function MyBinsSection({ job }: { job: PrintJob }) {
  const entries = useMyBins((s) => s.entries);
  const status = useMyBins((s) => s.status);
  const drawerName = useStore((s) => s.drawers.find((d) => d.id === s.activeDrawerId)?.name ?? 'this drawer');
  const hasSel = useStore((s) => !!s.ui.selectedBinId);
  const coarse = useCoarsePointer();
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const shown = useMemo(() => entries.filter((e) => entryMatches(e, query)), [entries, query]);
  const room = job.drawers[0]?.room;
  const locked = status === 'newer';

  const place = (e: LibraryEntry, at?: [number, number]) => {
    const r = placeMyBin(e.id, { at, room });
    if (!r.ok) {
      setNotice({ error: true, text: `“${e.name}” doesn’t fit: ${r.error} Clear some room, or switch drawers.` });
      return;
    }
    const moved = at && (r.at[0] !== at[0] || r.at[1] !== at[1]) ? ' There was no room where you dropped it, so it went to the first free spot.' : '';
    const notes = r.notes.map((n) => ` ${n.text}`).join('');
    const tools = r.tools ? ` ${r.tools === 1 ? 'Its tool was' : 'Its tools were'} added to the tool library.` : '';
    setNotice({ text: `Placed “${e.name}” in ${drawerName}.${moved}${notes}${tools} Undo takes it out.` });
  };

  const dragStart = (ev: React.DragEvent, e: LibraryEntry) => {
    const s = useStore.getState();
    const footprint = placementFootprint(e, { layout: job.layout, bins: s.bins, bed: usableBeds(s.setup), room, wall: s.drawer.enclosure === 'wall' });
    startBinDrag(ev, { footprint, drop: (at) => place(e, at) }, e.id, e.name);
  };

  const remove = (e: LibraryEntry) => {
    setOpenId(null);
    if (deleteMyBin(e.id)) setNotice({ text: `Deleted “${e.name}” from My bins.`, undo: true });
  };

  const exportFile = () =>
    downloadBytes(new TextEncoder().encode(myBinsFileText()), `gridfit-my-bins-${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
  const importFile = async (f: File) => {
    const r = importMyBins(await f.text());
    setNotice('error' in r ? { error: true, text: `Couldn’t import ${f.name}: ${r.error}` } : { text: importText(r) });
  };

  return (
    <Section title="My bins" find="my-bins" set={entries.length > 0} aside={hasSel && !locked ? <SaveToMyBinsButton where="library" className="link" /> : undefined}>
      {status !== 'saved' && (
        <div className={`mybins-status ${status}`} role="status">
          {STATUS_TEXT[status]}
        </div>
      )}
      <SaveToMyBinsForm where="library" />
      {entries.length ? (
        <p className="muted small">
          Whole bins, kept in this browser for every project. {coarse ? 'Tap Place' : 'Click Place, or drag one onto the grid,'} to put it in {drawerName}; undo takes it
          out. (Templates only copy settings onto bins that are already there.)
        </p>
      ) : (
        <p className="muted small">
          Keep whole bins here for every project: the size, height, inside, labels, pockets, inserts and lid, and what’s in it if you like. Select a bin and use{' '}
          <b>Save to My bins</b>, then place it in any drawer. They stay in this browser, not in the project file. Templates are different: they copy a bin’s settings
          onto bins that are already there.
        </p>
      )}
      {entries.length > 4 && (
        <div className="input-wrap mybins-search">
          <input type="search" value={query} placeholder="Search My bins…" aria-label="Search My bins" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
        </div>
      )}
      {entries.length > 0 && !shown.length && <p className="muted small">Nothing in My bins matches “{query.trim()}”.</p>}
      {shown.length > 0 && (
        <ul className="mybins-list">
          {shown.map((e) => {
            const open = openId === e.id;
            const contents = entryContents(e);
            return (
              <li
                key={e.id}
                className={`mybin-row${open ? ' open' : ''}`}
                draggable={!coarse}
                onDragStart={(ev) => dragStart(ev, e)}
                onDragEnd={endBinDrag}
                title={coarse ? undefined : 'Drag onto the grid to put it there'}
              >
                <div className="mybin-main">
                  <EntryPreview entry={e} />
                  <button type="button" className="mybin-name" onClick={() => setOpenId(open ? null : e.id)} aria-expanded={open} title="Rename, duplicate, delete">
                    <b>{e.name}</b>
                    <small>{entrySummary(e)}</small>
                    {contents && <small className="mybin-contents">{contents}</small>}
                  </button>
                  <button type="button" className="primary mybin-place" onClick={() => place(e)} title={`Put it in ${drawerName} at the first free spot (undo takes it out)`}>
                    Place
                  </button>
                </div>
                {open && (
                  <div className="mybin-edit">
                    <TextInput label="Name" value={e.name} onChange={(name) => renameMyBin(e.id, name)} />
                    <div className="button-row">
                      <button type="button" disabled={locked} onClick={() => duplicateMyBin(e.id)}>
                        Duplicate
                      </button>
                      {e.bins.length === 1 && (
                        <button
                          type="button"
                          title="Keep only its settings as a template of this project, to apply to bins that are already there"
                          onClick={() => myBinAsTemplate(e.id) && setNotice({ text: `Saved “${e.name}” as a template of this project (Templates, below): apply its settings to other bins.` })}
                        >
                          Save as template
                        </button>
                      )}
                      <button type="button" className="danger" disabled={locked} onClick={() => remove(e)}>
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
        <div className={notice.error ? 'field-error' : 'field-hint mybins-notice'} role="status">
          {notice.text}{' '}
          {notice.undo && (
            <button
              type="button"
              className="link"
              onClick={() => {
                const back = useMyBins.getState().deleted?.entry.name;
                if (undoDeleteMyBin()) setNotice({ text: `“${back}” is back in My bins.` });
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
      <Find id="my-bins-transfer" set={entries.length > 0}>
        <div className="button-row mybins-transfer">
          <button type="button" onClick={exportFile} disabled={!entries.length} title="Download My bins as a .json file">
            Export file
          </button>
          <button type="button" onClick={() => fileInput.current?.click()} disabled={locked} title="Add the bins from a My bins .json file">
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
        <div className="field-hint">To use them in another browser or on another computer, export a file here and import it there. Importing adds only the bins that aren’t in My bins yet.</div>
      </Find>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Preview: a small top view (back of the drawer up), in mm
// ---------------------------------------------------------------------------

interface PreviewBin {
  key: number;
  x: number;
  y: number;
  w: number;
  d: number;
  lines: { x1: number; y1: number; x2: number; y2: number }[];
  pockets: { x: number; y: number; w: number; d: number; round: boolean }[];
  tools: string[];
  /** The cavity's front-left corner (plate mm) and size, for the compartments' insides. */
  cavity: { x: number; y: number; w: number; d: number };
  interior: ReturnType<typeof interiorOf> | null;
}

function previewOf(e: LibraryEntry): { W: number; D: number; bins: PreviewBin[]; stacked: number } {
  const pitch = e.half ? GRID / 2 : GRID;
  const floor = e.bins.filter((b) => b.on === undefined);
  const W = Math.max(...floor.map((b) => (b.dx + b.opts.unitsX) * pitch));
  const D = Math.max(...floor.map((b) => (b.dy + b.opts.unitsY) * pitch));
  const inset = 0.25;
  const bins = floor.map((b, key): PreviewBin => {
    const o = sanitizeBin({ ...DEFAULT_BIN, ...b.opts });
    const cells: BinCells = { x: Array(o.unitsX).fill(pitch), y: Array(o.unitsY).fill(pitch), ...(e.half ? { half: true } : {}) };
    const { w, d } = binSize(o, cells);
    const x = b.dx * pitch + inset;
    const y = b.dy * pitch + inset;
    const inner = binInnerSize(o, cells);
    const cavity = { x: x + WALL, y: y + WALL, w: inner.w, d: inner.d };
    const lines: PreviewBin['lines'] = [];
    const pockets: PreviewBin['pockets'] = [];
    const tools: string[] = [];
    let interior: PreviewBin['interior'] = null;
    if (o.interior === 'pockets') {
      const body = binBodyHeight(o);
      const L = pocketLayout(o, w, d, binFloorZ(o), o.lip ? body - LIP_SUPPORT_HEIGHT : body);
      for (const p of L.pockets) pockets.push({ x: x + w / 2 + p.x, y: y + d / 2 + p.y, w: p.w, d: p.d, round: o.pocketShape !== 'square' });
    } else {
      if (o.interior === 'compartments') {
        const r = binLayout(o, cells);
        for (const wl of r.walls) {
          lines.push(
            wl.orient === 'v'
              ? { x1: cavity.x + wl.pos, x2: cavity.x + wl.pos, y1: cavity.y + wl.start, y2: cavity.y + wl.end }
              : { x1: cavity.x + wl.start, x2: cavity.x + wl.end, y1: cavity.y + wl.pos, y2: cavity.y + wl.pos },
          );
        }
        for (const f of r.free) {
          for (let k = 0; k + 1 < f.path.length; k++) {
            lines.push({ x1: cavity.x + f.path[k][0], y1: cavity.y + f.path[k][1], x2: cavity.x + f.path[k + 1][0], y2: cavity.y + f.path[k + 1][1] });
          }
        }
        if (o.layout?.comps && Object.keys(o.layout.comps).length) interior = interiorOf(o, cells);
      }
      // Tool pockets (bin-centered mm), in a cutout bin or in its tool compartments.
      for (const c of o.cutouts ?? []) {
        tools.push(
          placedOutline(c)
            .map(([px, py]) => `${(x + w / 2 + px).toFixed(1)},${(D - (y + d / 2 + py)).toFixed(1)}`)
            .join(' '),
        );
      }
    }
    return { key, x, y, w, d, lines, pockets, tools, cavity, interior };
  });
  return { W, D, bins, stacked: e.bins.length - floor.length };
}

/** The entry seen from above, back of the drawer up: its bins, walls, pockets and tools. */
function EntryPreview({ entry }: { entry: LibraryEntry }) {
  const p = useMemo(() => previewOf(entry), [entry]);
  const sy = (y: number) => p.D - y;
  const pad = 2;
  return (
    <svg className="mybin-thumb" viewBox={`${-pad} ${-pad} ${p.W + 2 * pad} ${p.D + 2 * pad}`} width={46} height={46} aria-hidden>
      {p.bins.map((b) => (
        <g key={b.key}>
          <rect className="mybin-body" x={b.x} y={sy(b.y + b.d)} width={b.w} height={b.d} rx={3.75} vectorEffect="non-scaling-stroke" />
          {b.interior && (
            <g transform={`translate(${b.cavity.x} ${p.D - b.cavity.y - b.cavity.d})`}>
              {b.interior.resolved.compartments.map((c) => (
                <CompartmentInsidePreview key={c.key} c={c} info={b.interior!} sy={(y) => b.cavity.d - y} />
              ))}
            </g>
          )}
          {b.lines.map((l, k) => (
            <line key={k} className="mybin-wall" x1={l.x1} y1={sy(l.y1)} x2={l.x2} y2={sy(l.y2)} vectorEffect="non-scaling-stroke" />
          ))}
          {b.pockets.map((q, k) =>
            q.round ? (
              <ellipse key={k} className="mybin-pocket" cx={q.x} cy={sy(q.y)} rx={q.w / 2} ry={q.d / 2} vectorEffect="non-scaling-stroke" />
            ) : (
              <rect key={k} className="mybin-pocket" x={q.x - q.w / 2} y={sy(q.y + q.d / 2)} width={q.w} height={q.d} vectorEffect="non-scaling-stroke" />
            ),
          )}
          {b.tools.map((pts, k) => (
            <polygon key={k} className="mybin-tool" points={pts} vectorEffect="non-scaling-stroke" />
          ))}
        </g>
      ))}
      {p.stacked > 0 && (
        <text className="mybin-stacked" x={p.W} y={0} textAnchor="end" dominantBaseline="hanging" fontSize={Math.max(p.W, p.D) / 4}>
          +{p.stacked}
        </text>
      )}
    </svg>
  );
}
