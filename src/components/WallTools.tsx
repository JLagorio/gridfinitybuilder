/**
 * Divider-wall tools around the compartment editor: the layout clipboard,
 * mirror / rotate / "copy layout to…" (toolbar of the compartments pane), and
 * the sidebar fields of a diagonal / curved wall.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { activeDrawer, allDrawers, useStore, useUnits, type CopyLayoutReport, type LayoutSource, type LayoutTarget } from '../state/store';
import { binLabel, type BinOptions } from '../lib/geometry/bin';
import { binBodyHeight, binFloorZ } from '../lib/geometry/variants';
import { LIP_SUPPORT_HEIGHT } from '../lib/geometry/spec';
import {
  freeWallMeasure,
  mirrorLayout,
  removeFreeWall,
  rotateLayout,
  setAllWallProps,
  setWallProps,
  updateFreeWall,
  type DividerLayout,
  type WallPropsPatch,
  type WallTop,
} from '../lib/dividers';
import { defaultNotch } from '../lib/geometry/wallExtras';
import { LengthInput, Segmented, Toggle } from './fields';
import { clearInteriorSelection, type BinInterior } from './interiorState';

/** Height of a full-height divider: floor to the top of the infill (mm). */
export function dividerHeight(o: BinOptions): number {
  const top = binBodyHeight(o) - (o.lip ? LIP_SUPPORT_HEIGHT : 0);
  return Math.max(0, top - binFloorZ(o));
}

// ---------------------------------------------------------------------------
// Layout clipboard (Ctrl/Cmd+C / V in the compartment editor, Ctrl/Cmd+Shift+V on the drawer grid)
// ---------------------------------------------------------------------------

let clip: LayoutSource | null = null;

/** Remember a bin's layout (or its columns × rows) for pasting into other bins. */
export function copyLayoutOf(o: BinOptions) {
  clip = { layout: o.layout ? structuredClone(o.layout) : null, divX: o.divX, divY: o.divY };
}

export const hasLayoutClip = () => !!clip;

/** Paste the remembered layout into bins of the active drawer (one undo step). */
export function pasteLayoutInto(binIds: string[]): CopyLayoutReport | null {
  if (!clip || !binIds.length) return null;
  const s = useStore.getState();
  return s.copyLayout(
    clip,
    binIds.map((binId) => ({ drawerId: s.activeDrawerId, binId })),
  );
}

/** "Copied to 3 bins · 1 bin left out 2 fixed-size walls that don't fit." */
export function reportText(r: CopyLayoutReport | null): string {
  if (!r || !r.copied) return 'Nothing to copy to.';
  const walls = r.dropped.reduce((t, d) => t + d.walls, 0);
  const head = `Copied to ${r.copied} bin${r.copied === 1 ? '' : 's'}.`;
  if (!r.dropped.length) return head;
  return `${head} ${walls} fixed-size wall${walls === 1 ? '' : 's'} didn't fit ${r.dropped.length === 1 ? 'one bin' : `${r.dropped.length} bins`} and ${walls === 1 ? 'was' : 'were'} left out there.`;
}

// ---------------------------------------------------------------------------
// Toolbar: mirror, rotate, copy to…
// ---------------------------------------------------------------------------

export function LayoutActions({ info, onLayout }: { info: BinInterior & { binId: string }; onLayout: (l: DividerLayout) => void }) {
  const empty = !info.layout.walls.length && !info.layout.free?.length;
  return (
    <div className="ie-actions">
      <button type="button" disabled={empty} title="Mirror left ↔ right" onClick={() => onLayout(mirrorLayout(info.layout, 'x', info.size))}>
        ⇆
      </button>
      <button type="button" disabled={empty} title="Mirror front ↔ back" onClick={() => onLayout(mirrorLayout(info.layout, 'y', info.size))}>
        ⇅
      </button>
      <button type="button" disabled={empty} title="Rotate a quarter turn clockwise" onClick={() => onLayout(rotateLayout(info.layout, info.size.w, info.size.d))}>
        ↻
      </button>
      <CopyLayoutMenu binId={info.binId} />
    </div>
  );
}

interface BinRow {
  drawerId: string;
  binId: string;
  label: string;
  where: string;
  usable: boolean;
}

function CopyLayoutMenu({ binId }: { binId: string }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const drawers = useStore((s) => s.drawers);
  const bins = useStore((s) => s.bins);
  const activeId = useStore((s) => s.activeDrawerId);
  const copyLayout = useStore((s) => s.copyLayout);

  const groups = useMemo(() => {
    const s = useStore.getState();
    const docs = allDrawers({ ...s, drawers, bins, activeDrawerId: activeId });
    const active = activeDrawer({ ...s, drawers, bins, activeDrawerId: activeId });
    return [active, ...docs.filter((d) => d.id !== active.id)]
      .filter((d) => all || d.id === active.id)
      .map((d) => ({
        id: d.id,
        name: d.id === active.id ? `${d.name} (this drawer)` : d.name,
        rows: d.bins
          .filter((b) => !(d.id === active.id && b.id === binId))
          .map(
            (b): BinRow => ({
              drawerId: d.id,
              binId: b.id,
              label: binLabel(b.opts),
              where: `column ${b.x + 1}, row ${b.y + 1}`,
              usable: !b.opts.interior || b.opts.interior === 'compartments',
            }),
          ),
      }));
  }, [drawers, bins, activeId, binId, all]);

  const key = (r: Pick<BinRow, 'drawerId' | 'binId'>) => `${r.drawerId}/${r.binId}`;
  const rows = groups.flatMap((g) => g.rows).filter((r) => r.usable);
  const chosen = rows.filter((r) => picked.has(key(r)));

  // Close on a click outside, or Escape.
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);

  const toggle = (r: BinRow) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(key(r))) n.delete(key(r));
      else n.add(key(r));
      return n;
    });

  const run = () => {
    const to: LayoutTarget[] = chosen.map((r) => ({ drawerId: r.drawerId, binId: r.binId }));
    setMsg(reportText(copyLayout(binId, to)));
    setPicked(new Set());
  };

  return (
    <div className="ie-copy" ref={ref}>
      <button
        type="button"
        className={open ? 'active' : ''}
        title="Use this layout in other bins"
        onClick={() => {
          setOpen(!open);
          setMsg(null);
        }}
      >
        Copy to…
      </button>
      {open && (
        <div className="ie-copy-menu" role="dialog" aria-label="Copy layout to other bins">
          <div className="ie-copy-head">
            <b>Copy this layout to</b>
            <label className="ie-copy-all">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> all drawers
            </label>
          </div>
          <div className="ie-copy-list">
            {groups.map((g) => (
              <div key={g.id} className="ie-copy-group">
                {(all || groups.length > 1) && <div className="ie-copy-drawer">{g.name}</div>}
                {g.rows.length === 0 && <div className="muted small">No other bins.</div>}
                {g.rows.map((r) => (
                  <label key={key(r)} className={`ie-copy-row ${r.usable ? '' : 'disabled'}`} title={r.usable ? undefined : 'This bin has tool cutouts or pockets, not compartments'}>
                    <input type="checkbox" disabled={!r.usable} checked={picked.has(key(r))} onChange={() => toggle(r)} />
                    <span>{r.label}</span>
                    <small>{r.where}</small>
                  </label>
                ))}
              </div>
            ))}
          </div>
          <div className="ie-copy-foot">
            <button type="button" className="link" disabled={!rows.length} onClick={() => setPicked(new Set(rows.map(key)))}>
              All
            </button>
            <button type="button" className="link" disabled={!picked.size} onClick={() => setPicked(new Set())}>
              None
            </button>
            <button type="button" className="primary" disabled={!chosen.length} onClick={run}>
              {chosen.length ? `Copy to ${chosen.length} bin${chosen.length === 1 ? '' : 's'}` : 'Copy'}
            </button>
          </div>
          <div className="field-hint">Replaces their walls. Proportional walls fit any size; fixed-size walls that don't fit are left out.</div>
          {msg && <div className="ie-copy-msg">{msg}</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar: a straight wall's finger notch and top shape (inside WallFields)
// ---------------------------------------------------------------------------

const TOPS: { value: WallTop; label: string; title: string }[] = [
  { value: 'flat', label: 'Flat', title: 'Square top edges' },
  { value: 'chamfer', label: 'Chamfer', title: '45° chamfer on both top edges' },
  { value: 'round', label: 'Round', title: 'Rounded top' },
];

export function WallFinishFields({ info, wallId, onLayout }: { info: BinInterior; wallId: string; onLayout: (l: DividerLayout) => void }) {
  const { fmt } = useUnits();
  const W = info.resolved.byId.get(wallId);
  if (!W) return null;
  const height = Math.max(1, dividerHeight(info.opts) - W.lower);
  const notch = W.wall.notch;
  const top = W.wall.top ?? 'flat';
  const others = info.layout.walls.length > 1;
  const sameNotch = info.layout.walls.every((w) => (w.notch?.width ?? 0) === (notch?.width ?? 0) && (w.notch?.depth ?? 0) === (notch?.depth ?? 0));
  const sameTop = info.layout.walls.every((w) => (w.top ?? 'flat') === top);
  const set = (p: WallPropsPatch) => onLayout(setWallProps(info.layout, wallId, p));
  return (
    <>
      <Toggle
        label="Finger notch"
        checked={!!notch}
        onChange={(on) => set({ notch: on ? defaultNotch(height) : null })}
        hint={
          notch
            ? `A U-shaped dip in the top${W.removable ? ' of the plate' : ''}, one per stretch of wall between crossings.`
            : 'Cut a dip into the top so fingers reach in.'
        }
      />
      {notch && (
        <div className="row2">
          <LengthInput label="Notch width" value={notch.width} min={3} max={300} onChange={(width) => set({ notch: { ...notch, width } })} />
          <LengthInput
            label="Notch depth"
            value={notch.depth}
            min={0.5}
            max={300}
            onChange={(depth) => set({ notch: { ...notch, depth } })}
            hint={notch.depth > height - 1 ? `Limited to ${fmt(Math.max(0, height - 1))} here.` : undefined}
          />
        </div>
      )}
      <Segmented label="Top edge" value={top} options={TOPS} onChange={(t) => set({ top: t })} />
      {others && (!sameNotch || !sameTop) && (
        <div className="button-row">
          {!sameNotch && (
            <button type="button" onClick={() => onLayout(setAllWallProps(info.layout, { notch: notch ?? null }))} title="Give every straight wall this finger notch">
              {notch ? 'Notch all walls' : 'Remove all notches'}
            </button>
          )}
          {!sameTop && (
            <button type="button" onClick={() => onLayout(setAllWallProps(info.layout, { top }))} title="Give every straight wall this top edge">
              {top === 'flat' ? 'Flat tops on all' : `${top === 'chamfer' ? 'Chamfer' : 'Round'} all tops`}
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Sidebar: a diagonal / curved wall
// ---------------------------------------------------------------------------

export function FreeWallFields({ info, freeId, onLayout }: { info: BinInterior; freeId: string; onLayout: (l: DividerLayout) => void }) {
  const { fmt } = useUnits();
  const F = info.resolved.free.find((f) => f.id === freeId);
  if (!F) return null;
  const m = freeWallMeasure(F.a, F.b, F.bend);
  const height = dividerHeight(info.opts);
  const maxLower = Math.max(0, Math.floor(height - 2));
  const set = (p: Parameters<typeof updateFreeWall>[3]) => onLayout(updateFreeWall(info.layout, info.size, freeId, p));
  const sign = F.bend < 0 ? -1 : 1;
  return (
    <div className="cf-block">
      <div className="cf-head">
        <span>{F.bend ? 'Curved wall' : 'Diagonal wall'}</span>
        <small>
          {fmt(m.length)} long · {Math.round(m.angle * 10) / 10}°{m.radius ? ` · radius ${fmt(m.radius)}` : ''}
        </small>
      </div>
      <LengthInput
        label="Curve (bulge in the middle)"
        value={Math.round(Math.abs(F.bend) * 1000) / 1000}
        min={0}
        max={Math.round((m.chord / 2) * 1000) / 1000}
        allowEmpty
        onChange={(mm) => set({ bend: sign * mm })}
        hint="0 is straight; half the length is a half circle. You can also drag the middle handle."
      />
      {F.bend !== 0 && (
        <div className="button-row">
          <button type="button" onClick={() => set({ bend: -F.bend })}>
            Curve the other way
          </button>
          <button type="button" onClick={() => set({ bend: 0 })}>
            Straighten
          </button>
        </div>
      )}
      <Segmented
        label="Height"
        value={F.lower > 0 ? 'low' : 'full'}
        options={[
          { value: 'full', label: 'Full' },
          { value: 'low', label: 'Lowered', title: 'Lower it so fingers reach over' },
        ]}
        onChange={(v) => set({ lower: v === 'low' ? Math.max(1, Math.min(maxLower, Math.round(height / 2))) : 0 })}
      />
      {F.lower > 0 && (
        <LengthInput
          label="Lowered by"
          value={F.lower}
          min={0.5}
          max={maxLower}
          onChange={(mm) => set({ lower: mm })}
          hint={`Top ${fmt(Math.max(0, height - Math.min(F.lower, maxLower)))} above the floor.`}
        />
      )}
      <div className="field-hint">
        Diagonal and curved walls are solid walls only: they don’t split compartments, so scoops, label tabs and compartment settings ignore them.
      </div>
      <div className="button-row">
        <button
          className="danger"
          onClick={() => {
            onLayout(removeFreeWall(info.layout, freeId));
            clearInteriorSelection();
          }}
        >
          Delete wall
        </button>
      </div>
    </div>
  );
}
