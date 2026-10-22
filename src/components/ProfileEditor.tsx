import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Vec2 } from '../lib/geometry/kernel';
import type { MountCtx } from '../lib/wall';
import { mountBox, siteAt } from '../lib/wall/mount';
import { NumberInput, Segmented, Select, TextInput } from './fields';
import {
  CUSTOM,
  faceName,
  holeOutline,
  overhangs,
  profileFaces,
  reachOf,
  thinnest,
  type Face,
  type Feature,
  type FeatureKind,
} from '../lib/wall/custom/profile';
import { PRESETS, PRESET_KEYS, presetOptions, type PresetKey } from '../lib/wall/custom/presets';
import { customAddOns, customRibs, endHull, featureSpots } from '../lib/wall/custom/part';
import { addPoint, movePoint, nudgePoint, removePoint, snapPoint } from '../lib/wall/custom/edit';
import { customLayout, type CustomOptions } from '../lib/wall/kinds/custom';
import './profileEditor.css';

/**
 * The custom attachment's editor (lib/wall/kinds/custom.ts), its 'profile' field: start from a preset, drag the side
 * profile's points on a 1 mm grid (edges snap to 15° steps near them), add and remove points; what can't print
 * upright shows red, with the board, the back plate and the bed drawn in. Below it, the holes, slots and text on
 * the face picked (click an edge): drag them about, or set their sizes and how many. Edits reach the 3D view a few
 * times a second while dragging, and when you let go. Loaded with the first custom part (WallPanel).
 */

const STANDARD: MountCtx = { t: 5, slotW: 5.1, slotL: 15.3, pitch: 20, fit: 'normal', behind: 20 };

const KIND_LABELS: Record<FeatureKind, string> = { round: 'Hole', slot: 'Slot', rect: 'Rectangle', hex: 'Hex', notch: 'Notch', text: 'Text' };
const KIND_TITLES: Record<FeatureKind, string> = {
  round: 'A round hole: through, or as deep as you set',
  slot: 'A slot with round ends',
  rect: 'A rectangular hole or pocket',
  hex: 'A hex hole, for bits and hex keys (size across flats)',
  notch: 'A finger notch, open at the face’s nearer end',
  text: 'Text cut into the face',
};

const PROBLEMS = {
  small: 'Too small: it needs some area.',
  crossing: 'That would make edges cross.',
  loose: 'It has to stay joined to the back plate.',
} as const;

const r1 = (v: number) => Math.round(v * 10) / 10;

/** How far a point is from a segment. */
function segmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dz = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dz + (p[1] - a[1]) * dy) / (dz * dz + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dz, p[1] - a[1] - t * dy);
}
const path = (pts: readonly Vec2[], close = true) => `M${pts.map(([z, y]) => `${r1(z)},${r1(-y)}`).join('L')}${close ? 'Z' : ''}`;

/** A new feature of a kind on a face `len` long. */
function newFeature(k: FeatureKind, f: number, len: number, w: number): Feature {
  const base = { f, k, d: 0, u: 0, v: 0, n: 1, m: 1, su: 12, sv: 12 };
  if (k === 'slot') return { ...base, a: 20, b: 6 };
  if (k === 'rect') return { ...base, a: 20, b: 10 };
  if (k === 'hex') return { ...base, a: 6.6, b: 6.6 };
  if (k === 'notch') return { ...base, a: 20, b: 20, v: r1(Math.max(0, len / 2 - 10)) };
  if (k === 'text') return { ...base, a: r1(Math.min(60, w - 8)), b: 6, d: 0.6, t: 'Label' };
  return { ...base, a: 6, b: 6 };
}

/** Changes collected while dragging, handed on a few times a second (each is an undo step and a rebuild), and at the end. */
function useLiveCommit(onChange: (p: Partial<CustomOptions>) => void) {
  const latest = useRef(onChange);
  latest.current = onChange;
  const pending = useRef<Partial<CustomOptions> | null>(null);
  const timer = useRef<number | null>(null);
  const flush = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) latest.current(p);
  };
  const push = (p: Partial<CustomOptions>) => {
    pending.current = { ...pending.current, ...p };
    timer.current ??= window.setTimeout(flush, 350);
  };
  useEffect(() => flush, []);
  return { push, flush };
}

/** Pointer position in an SVG's own units, y up (the drawings flip y). */
function svgPoint(svg: SVGSVGElement, e: { clientX: number; clientY: number }): Vec2 {
  const m = svg.getScreenCTM();
  if (!m) return [0, 0];
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return [p.x, -p.y];
}

/** A preset's small drawing: the plate and its profile. */
function Thumb({ k }: { k: PresetKey }) {
  const p = PRESETS[k].profile as Vec2[];
  const zmax = Math.max(...p.map((q) => q[0]));
  const h = PRESETS[k].height;
  const s = Math.max(zmax + 4, h + 4);
  return (
    <svg viewBox={`-2 ${-h - 2} ${s} ${s}`} aria-hidden className="pe-thumb">
      <rect x={0} y={-h} width={CUSTOM.plate} height={h} className="pe-plate" />
      <path d={path(p)} className="pe-shape" />
    </svg>
  );
}

export function ProfileField({
  label,
  opts,
  ctx = STANDARD,
  onChange,
}: {
  label: string;
  opts: CustomOptions;
  ctx?: MountCtx;
  onChange: (p: Partial<CustomOptions>) => void;
}) {
  const live = useLiveCommit(onChange);
  const [draft, setDraft] = useState<Vec2[] | null>(null);
  const [draftFeatures, setDraftFeatures] = useState<Feature[] | null>(null);
  const [point, setPoint] = useState<number | null>(null);
  const [faceId, setFaceId] = useState<number | null>(null);
  const [feature, setFeature] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const faceSvg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: 'point'; i: number } | { kind: 'feature'; i: number; from: Vec2; at: Vec2 } | null>(null);

  const profile = draft ?? opts.profile;
  const features = draftFeatures ?? opts.features;
  const o: CustomOptions = { ...opts, profile, features };
  const layout = customLayout(o, ctx);
  const { w: W, h: H } = layout;
  const T = CUSTOM.plate;
  const faces = profileFaces(profile, H);
  const down = new Set(overhangs(profile));
  const thin = thinnest(profile, H);
  const add = customAddOns(o, H);
  const ribs = customRibs(o, W);
  const spots = featureSpots(o, layout, ctx);
  // The face picked: the one clicked, else the first feature's, else the longest top.
  const face: Face | undefined =
    faces.find((f) => f.id === faceId) ??
    faces.find((f) => f.id === features[0]?.f) ??
    [...faces].sort((a, b) => +(b.n[1] > 0.9) - +(a.n[1] > 0.9) || b.len - a.len)[0];
  const sel = point !== null && point < profile.length ? point : null;
  const selFeature = feature !== null && feature < features.length ? feature : null;

  // A different part, or one changed elsewhere: nothing half-done carries over.
  useEffect(() => {
    if (!drag.current) {
      setDraft(null);
      setDraftFeatures(null);
    }
  }, [opts.profile, opts.features]);

  const refuse = (problem: string | null) => setMsg(problem);
  const setProfile = (next: Vec2[] | null, why = PROBLEMS.crossing) => {
    if (!next) return refuse(why);
    refuse(null);
    onChange({ profile: next });
  };

  // --- The profile view -----------------------------------------------------
  const zmax = Math.max(reachOf(profile) + 8, 50);
  const view = { x: -ctx.t - 4, y: -H - 6, w: zmax + ctx.t + 4, h: H + 12 };
  const hr = Math.max(1.4, view.w / 48);

  /** What's under the pointer: the nearest point in reach (they can be close together), else the nearest edge, else the plate's front. */
  const hitAt = (p: Vec2): { point: number } | { edge: number } | null => {
    let point = -1;
    let near = hr * 2.4;
    profile.forEach((q, i) => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < near) [near, point] = [d, i];
    });
    if (point >= 0) return { point };
    let edge = -2;
    near = hr * 1.6;
    profile.forEach((a, i) => {
      const d = segmentDistance(p, a, profile[(i + 1) % profile.length]);
      if (d < near) [near, edge] = [d, i];
    });
    if (edge < 0 && Math.abs(p[0] - T) < near && p[1] > 0 && p[1] < H) edge = -1;
    return edge > -2 ? { edge } : null;
  };
  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!svg.current) return;
    const hit = hitAt(svgPoint(svg.current, e));
    if (hit && 'point' in hit) {
      setPoint(hit.point);
      drag.current = { kind: 'point', i: hit.point };
      svg.current.setPointerCapture(e.pointerId);
      svg.current.focus();
      return;
    }
    setPoint(null);
    if (hit && faces.some((f) => f.id === hit.edge)) setFaceId(hit.edge);
  };
  const onDouble = (e: ReactMouseEvent<SVGSVGElement>) => {
    const hit = svg.current && hitAt(svgPoint(svg.current, e));
    if (hit && 'edge' in hit && hit.edge >= 0) insertAfter(hit.edge);
  };
  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!svg.current) return;
    if (d?.kind !== 'point') {
      // What a press would do, as the cursor.
      const hit = hitAt(svgPoint(svg.current, e));
      svg.current.style.cursor = hit && 'point' in hit ? 'grab' : hit && faces.some((f) => f.id === hit.edge) ? 'pointer' : '';
      return;
    }
    const to = snapPoint(profile, d.i, svgPoint(svg.current, e), H);
    if (to[0] === profile[d.i][0] && to[1] === profile[d.i][1]) return;
    const next = movePoint(profile, d.i, to);
    if (!next) return refuse(PROBLEMS.crossing);
    refuse(null);
    setDraft(next);
    live.push({ profile: next });
  };
  const onUp = () => {
    if (drag.current?.kind === 'point') {
      live.flush();
      drag.current = null;
      // The store has it now (or will on the next render): let the draft go.
      setDraft(null);
    }
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, Vec2> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    // Here they're the profile's keys, not the board's (which would move or delete the whole part).
    if (!moves[e.key] && e.key !== 'Delete' && e.key !== 'Backspace' && !(e.key === 'Escape' && sel !== null)) return;
    e.preventDefault();
    if (sel === null) return;
    if (moves[e.key]) setProfile(nudgePoint(profile, sel, ...moves[e.key], H));
    else if (e.key === 'Escape') setPoint(null);
    else deletePoint(sel);
  };
  const insertAfter = (edge: number) => {
    const r = addPoint(profile, features, edge);
    if (!r) return refuse(profile.length >= CUSTOM.points ? `${CUSTOM.points} points at most.` : PROBLEMS.crossing);
    refuse(null);
    onChange(r);
    setPoint(edge + 1);
  };
  const deletePoint = (i: number) => {
    const r = removePoint(profile, features, i);
    if (!r) return refuse(profile.length <= 3 ? 'It needs three points at least.' : PROBLEMS.crossing);
    refuse(null);
    onChange(r);
    setPoint(null);
  };

  // --- Features ---------------------------------------------------------------
  const setFeatures = (next: Feature[]) => onChange({ features: next });
  const patchFeature = (i: number, p: Partial<Feature>) => setFeatures(features.map((f, k) => (k === i ? { ...f, ...p } : f)));
  const addFeature = (k: FeatureKind) => {
    if (!face || features.length >= CUSTOM.features) return;
    setFeatures([...features, newFeature(k, face.id, face.len, W)]);
    setFeature(features.length);
  };
  const onFeaturePointer = (i: number) => (e: ReactPointerEvent) => {
    e.stopPropagation();
    setFeature(i);
    if (!faceSvg.current) return;
    const at = svgPoint(faceSvg.current, e);
    drag.current = { kind: 'feature', i, from: [features[i].u, features[i].v], at };
    faceSvg.current.setPointerCapture(e.pointerId);
  };
  const onFaceMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (d?.kind !== 'feature' || !faceSvg.current) return;
    const p = svgPoint(faceSvg.current, e);
    // Whole millimetres, and onto the face's middle lines near them.
    const snap = (v: number) => (Math.abs(v) < 2 ? 0 : Math.round(v));
    const u = snap(d.from[0] + p[0] - d.at[0]);
    const v = snap(d.from[1] + p[1] - d.at[1]);
    const f = features[d.i];
    if (f.u === u && f.v === v) return;
    const next = features.map((q, k) => (k === d.i ? { ...q, u, v } : q));
    setDraftFeatures(next);
    live.push({ features: next });
  };
  const onFaceUp = () => {
    if (drag.current?.kind === 'feature') {
      live.flush();
      drag.current = null;
      setDraftFeatures(null);
    }
  };

  // --- Words ------------------------------------------------------------------
  const n = down.size;
  const edges = n === 1 ? 'an edge underneath is' : `${n} edges underneath are`;
  const status =
    layout.pose === 'upright'
      ? n
        ? `Prints upright, but ${edges} flatter than 45° (red): they’d need support. Print it on its side, or make them steeper.`
        : 'Prints upright, as it hangs: every edge underneath is 45° or steeper, or on the bed.'
      : opts.pose === 'side'
        ? 'Prints on its side, the profile flat on the bed, so any shape prints: a hook at its left end holds it on.'
        : n
          ? `Prints on its side (any shape prints that way): upright, ${edges} flatter than 45° (red).`
          : 'Prints on its side: upright it would stand on too little of the bed.';
  const fv = face ? spots.filter((s) => s.face.id === face.id) : [];
  const fl = face?.len ?? 0;
  const mounts = face?.id === -1 ? layout.mounts.map((m) => mountBox(m.kind, siteAt(layout, m, ctx), ctx)) : [];
  const fy0 = face?.id === -1 ? face.a[1] : 0;
  const sf = selFeature !== null ? features[selFeature] : null;

  return (
    <div className="field profile-editor">
      <span className="field-label">{label}</span>
      <div className="pe-presets" role="group" aria-label="Start from">
        {PRESET_KEYS.map((k) => (
          <button
            key={k}
            type="button"
            className={opts.preset === k ? 'active' : ''}
            title={`${PRESETS[k].title}. Starts it again from this shape.`}
            onClick={() => {
              refuse(null);
              setPoint(null);
              setFaceId(null);
              setFeature(null);
              onChange(presetOptions(k));
            }}
          >
            <Thumb k={k} />
            <span>{PRESETS[k].label}</span>
          </button>
        ))}
      </div>

      <svg
        ref={svg}
        className="pe-view"
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        tabIndex={0}
        role="application"
        aria-label="Side profile: drag a point to move it (the arrow keys move the selected one), double-click an edge to add a point, Delete removes the selected one; click an edge to put holes on it"
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerDown={onDown}
        onDoubleClick={onDouble}
        onKeyDown={onKey}
      >
        {/* The grid, every 10 mm. */}
        <g className="pe-grid">
          {Array.from({ length: Math.floor(zmax / 10) + 1 }, (_, k) => (
            <line key={`z${k}`} x1={k * 10} y1={view.y} x2={k * 10} y2={view.y + view.h} />
          ))}
          {Array.from({ length: Math.floor((H + 6) / 10) + 1 }, (_, k) => (
            <line key={`y${k}`} x1={view.x} y1={-k * 10} x2={view.x + view.w} y2={-k * 10} />
          ))}
        </g>
        <rect className="pe-board" x={-ctx.t} y={view.y} width={ctx.t} height={view.h} />
        <text className="pe-caption" transform={`translate(${-ctx.t / 2} ${-H / 2}) rotate(-90)`} fontSize={hr * 1.6}>
          Board
        </text>
        <rect className="pe-plate" x={0} y={-H} width={T} height={H} />
        {layout.pose === 'upright' ? (
          <>
            <line className="pe-bed" x1={view.x} y1={0} x2={view.x + view.w} y2={0} />
            <text className="pe-caption pe-bed-label" x={view.x + view.w - 1} y={hr * 2.2} fontSize={hr * 1.6}>
              Bed
            </text>
          </>
        ) : (
          <text className="pe-caption pe-side-label" x={view.x + view.w - 1} y={view.y + hr * 2} fontSize={hr * 1.5}>
            Flat on the bed
          </text>
        )}
        {/* Add-ons, for what they are. */}
        {ribs.ends.length > 0 && <path className="pe-addon dashed" d={path(endHull([...profile, ...(add.lip ?? [])], H))} />}
        {ribs.dividers.length > 0 && add.rim > 0 && <line className="pe-addon dashed" x1={T} y1={-add.rim} x2={reachOf(profile)} y2={-add.rim} />}
        {add.gusset && <path className="pe-addon" d={path(add.gusset)} />}
        {add.lip && <path className="pe-addon" d={path(add.lip)} />}
        <path className="pe-shape" d={path(profile)} />
        {profile.map((a, i) => {
          const b = profile[(i + 1) % profile.length];
          return (
            <line key={`e${i}`} className={`pe-edge${down.has(i) ? ' bad' : ''}${face?.id === i ? ' picked' : ''}`} x1={a[0]} y1={-a[1]} x2={b[0]} y2={-b[1]} />
          );
        })}
        {face?.id === -1 && <line className="pe-edge picked" x1={T} y1={-face.a[1]} x2={T} y2={-face.b[1]} />}
        {thin && thin.t < CUSTOM.wall - 0.05 && <circle className="pe-thin" cx={thin.at[0]} cy={-thin.at[1]} r={hr * 1.6} />}
        {sel !== null &&
          (() => {
            // Halfway along the next edge, where it's long enough to be clear of the points.
            const a = profile[sel];
            const b = profile[(sel + 1) % profile.length];
            if (Math.hypot(b[0] - a[0], b[1] - a[1]) < hr * 7) return null;
            const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
            return (
              <g className="pe-plus" onPointerDown={(e) => (e.stopPropagation(), insertAfter(sel))}>
                <title>Add a point here</title>
                <circle cx={m[0]} cy={-m[1]} r={hr * 1.2} />
                <path d={`M${m[0] - hr * 0.6},${-m[1]}h${hr * 1.2}M${m[0]},${-m[1] - hr * 0.6}v${hr * 1.2}`} />
              </g>
            );
          })()}
        {profile.map(([z, y], i) => (
          <circle key={`p${i}`} className={`pe-point${sel === i ? ' selected' : ''}`} cx={z} cy={-y} r={hr} />
        ))}
      </svg>
      <div className="pe-readout">
        <span>
          {r1(reachOf(profile))} mm out · {W} × {H} mm plate · {profile.length} points
        </span>
        {sel !== null && (
          <span className="pe-point-tools">
            <button type="button" className="link" onClick={() => insertAfter(sel)} title="A point halfway along the next edge">
              Add point
            </button>
            <button type="button" className="link danger" onClick={() => deletePoint(sel)} disabled={profile.length <= 3}>
              Remove point
            </button>
          </span>
        )}
      </div>
      {sel !== null && (
        <div className="row2">
          <NumberInput
            label="Out"
            value={profile[sel][0]}
            min={0}
            max={CUSTOM.reach}
            step={1}
            onChange={(z) => setProfile(movePoint(profile, sel, [r1(z), profile[sel][1]]))}
          />
          <NumberInput
            label="Up"
            value={profile[sel][1]}
            min={0}
            max={H}
            step={1}
            onChange={(y) => setProfile(movePoint(profile, sel, [profile[sel][0], r1(y)]))}
          />
        </div>
      )}
      {msg && <div className="field-error">{msg}</div>}
      <div className={n && layout.pose === 'upright' ? 'field-error' : 'field-hint'}>{status}</div>
      {thin && thin.t < CUSTOM.wall - 0.05 && (
        <div className="field-error">
          A wall is only {r1(thin.t)} mm thick (ringed): make it {CUSTOM.wall} mm or more.
        </div>
      )}
      <Segmented
        label="Prints"
        value={opts.pose}
        options={[
          { value: 'auto', label: 'Auto', title: 'Upright when nothing needs support that way, else on its side' },
          { value: 'upright', label: 'Upright', title: 'As it hangs: clips, and studs below them' },
          { value: 'side', label: 'On its side', title: 'The profile flat on the bed: a hook at its left, a stud below' },
        ]}
        onChange={(pose) => onChange({ pose })}
      />

      <div className="pe-features">
        <span className="field-label">Holes, slots and text</span>
        {faces.length > 0 && face && (
          <Select
            label="On the face"
            value={String(face.id)}
            options={faces.map((f) => ({ value: String(f.id), label: `${faceName(f)}, ${r1(f.len)} mm${f.id >= 0 ? ` (edge ${f.id + 1})` : ''}` }))}
            onChange={(v) => setFaceId(Number(v))}
            hint="Or click an edge in the profile."
          />
        )}
        {face && (
          <svg
            ref={faceSvg}
            className="pe-face"
            viewBox={`-3 ${-fl - 3} ${W + 6} ${fl + 6}`}
            onPointerMove={onFaceMove}
            onPointerUp={onFaceUp}
            onPointerCancel={onFaceUp}
            onPointerDown={() => setFeature(null)}
            aria-label={`The ${faceName(face).toLowerCase()} face, ${W} by ${r1(fl)} mm: drag a hole to move it`}
          >
            <rect className="pe-face-rect" x={0} y={-fl} width={W} height={fl} />
            {[...ribs.ends, ...ribs.dividers].map(([x0, x1], k) => (
              <rect key={`r${k}`} className="pe-face-rib" x={x0} y={-fl} width={x1 - x0} height={fl} />
            ))}
            {mounts.map((b, k) => (
              <rect key={`m${k}`} className="pe-face-mount" x={b.x0} y={-(b.y1 - fy0)} width={b.x1 - b.x0} height={b.y1 - b.y0} />
            ))}
            <line className="pe-face-mid" x1={W / 2} y1={-fl} x2={W / 2} y2={0} />
            <line className="pe-face-mid" x1={0} y1={-fl / 2} x2={W} y2={-fl / 2} />
            {fv.map((s, k) => {
              const cls = `pe-hole${s.ok ? '' : ' bad'}${s.i === selFeature ? ' selected' : ''}`;
              if (s.feature.k === 'text')
                return (
                  <g key={k} className={cls} onPointerDown={onFeaturePointer(s.i)}>
                    <path d={path(holeOutline(s.feature, s.c, null))} />
                    <text x={s.c[0]} y={-s.c[1]} fontSize={Math.min(s.feature.b, s.feature.a / Math.max(1, (s.feature.t ?? '').length) / 0.55)}>
                      {s.feature.t}
                    </text>
                  </g>
                );
              return <path key={k} className={cls} d={path(holeOutline(s.feature, s.c, s.tear, s.end))} onPointerDown={onFeaturePointer(s.i)} />;
            })}
          </svg>
        )}
        {face && (
          <div className="pe-face-caption">
            {face.e[1] > 0.7
              ? 'Up the face is up the wall.'
              : face.e[0] < -0.7
                ? 'Up the face is toward the board.'
                : face.e[0] > 0.7
                  ? 'Up the face is out from the board.'
                  : ''}{' '}
            {spots.some((s) => !s.ok) && 'Red ones don’t fit (off the face, or over a mount or a wall) and are left out.'}
          </div>
        )}
        {face && (
          <div className="pe-add" role="group" aria-label="Add">
            {(Object.keys(KIND_LABELS) as FeatureKind[]).map((k) => (
              <button key={k} type="button" title={KIND_TITLES[k]} disabled={features.length >= CUSTOM.features} onClick={() => addFeature(k)}>
                + {KIND_LABELS[k]}
              </button>
            ))}
          </div>
        )}
        {!faces.length && <p className="muted small">No flat face 4 mm long or more to put them on.</p>}
        {features.length > 0 && (
          <ul className="pe-feature-list">
            {features.map((f, i) => {
              const fc = faces.find((q) => q.id === f.f);
              const out = spots.filter((s) => s.i === i && !s.ok).length;
              return (
                <li key={i}>
                  <button
                    type="button"
                    className={i === selFeature ? 'active' : ''}
                    onClick={() => {
                      setFeature(i);
                      setFaceId(f.f);
                    }}
                  >
                    {f.k === 'text' ? `“${f.t}”` : `${KIND_LABELS[f.k]}${f.n * f.m > 1 ? ` × ${f.n * f.m}` : ''}`}
                    <small>
                      {fc ? faceName(fc) : 'no face'}
                      {out ? `, ${out} left out` : ''}
                    </small>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {sf && selFeature !== null && (
          <div className="pe-feature-form">
            <Segmented
              ariaLabel="What it is"
              value={sf.k}
              options={(Object.keys(KIND_LABELS) as FeatureKind[]).map((k) => ({ value: k, label: KIND_LABELS[k], title: KIND_TITLES[k] }))}
              onChange={(k) => patchFeature(selFeature, k === 'text' ? { k, t: sf.t || 'Label', d: sf.d || 0.6 } : { k })}
            />
            {sf.k === 'text' && <TextInput label="Text" value={sf.t ?? ''} onChange={(t) => patchFeature(selFeature, { t: t.slice(0, 24) })} />}
            <div className="row2">
              <NumberInput
                label={
                  sf.k === 'round' ? 'Diameter' : sf.k === 'hex' ? 'Across flats' : sf.k === 'notch' ? 'Width' : sf.k === 'text' ? 'Width at most' : 'Across'
                }
                value={sf.a}
                min={1}
                max={100}
                step={0.5}
                onChange={(a) => patchFeature(selFeature, { a })}
              />
              {(sf.k === 'slot' || sf.k === 'rect' || sf.k === 'text') && (
                <NumberInput
                  label={sf.k === 'text' ? 'Letter height' : 'Along'}
                  value={sf.b}
                  min={1}
                  max={200}
                  step={0.5}
                  onChange={(b) => patchFeature(selFeature, { b })}
                />
              )}
              <NumberInput
                label="Depth"
                value={sf.d}
                min={0}
                max={60}
                step={0.5}
                hint={sf.k === 'text' ? undefined : '0: right through.'}
                onChange={(d) => patchFeature(selFeature, { d })}
              />
            </div>
            {sf.k !== 'text' && sf.k !== 'notch' && (
              <div className="row2">
                <NumberInput
                  label="Across: how many"
                  value={sf.n}
                  min={1}
                  max={40}
                  step={1}
                  suffix=""
                  onChange={(v) => patchFeature(selFeature, { n: Math.round(v) })}
                />
                <NumberInput label="Apart" value={sf.su} min={1} max={200} step={0.5} onChange={(su) => patchFeature(selFeature, { su })} />
                <NumberInput
                  label="Along: how many"
                  value={sf.m}
                  min={1}
                  max={10}
                  step={1}
                  suffix=""
                  onChange={(v) => patchFeature(selFeature, { m: Math.round(v) })}
                />
                <NumberInput label="Apart" value={sf.sv} min={1} max={200} step={0.5} onChange={(sv) => patchFeature(selFeature, { sv })} />
              </div>
            )}
            <div className="row2">
              <NumberInput label="Across from the middle" value={sf.u} min={-400} max={400} step={1} onChange={(u) => patchFeature(selFeature, { u })} />
              <NumberInput label="Along from the middle" value={sf.v} min={-400} max={400} step={1} onChange={(v) => patchFeature(selFeature, { v })} />
            </div>
            <button
              type="button"
              className="link danger"
              onClick={() => {
                setFeatures(features.filter((_, k) => k !== selFeature));
                setFeature(null);
              }}
            >
              Remove {sf.k === 'text' ? 'the text' : `the ${KIND_LABELS[sf.k].toLowerCase()}${sf.n * sf.m > 1 ? 's' : ''}`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
