import { useEffect, useRef, useState } from 'react';
import { CONTENTS_FRAGMENT, ICONS, iconShape, type IconDef } from '../lib/geometry/labelIcons';
import { fitText, labelLines, type Box } from '../lib/geometry/labels';
import { fillContents } from '../lib/geometry/labelContents';
import type { Contour } from '../lib/geometry/font';
import { useLabelFont } from './labelFont';
import './labels.css';

/**
 * Label icons: a picker that inserts `{fragments}` into label text, and small
 * live previews of a label laid out the way the geometry lays it out (same
 * font, same fitting, same icons).
 */

// Still exported from here, for imports that predate labelFont.ts.
export { useLabelFont };

/** SVG path data for contours (y up), shifted by (dx, dy). */
export function contoursPath(cs: Contour[], dx = 0, dy = 0): string {
  return cs.map((c) => `M${c.map(([x, y]) => `${(x + dx).toFixed(2)},${(y + dy).toFixed(2)}`).join('L')}Z`).join('');
}

function IconGlyph({ def }: { def: IconDef }) {
  const s = iconShape(def, []);
  const pad = 0.12;
  const w = s.width + 2 * pad;
  const h = 1.24 + 2 * pad;
  return (
    <svg className="lp-icon" viewBox={`${-pad} ${-1.12 - pad} ${w} ${h}`} style={{ width: `${(w / h) * 22}px` }} aria-hidden>
      <path d={contoursPath(s.contours.map((c) => c.map(([x, y]) => [x, -y] as [number, number])))} fillRule="nonzero" />
    </svg>
  );
}

const GROUPS: IconDef['group'][] = ['Fasteners', 'Hardware', 'Electronics', 'Layout'];

/** Button + panel of icons; picking one calls `onPick` with its fragment. */
export function IconPicker({ onPick }: { onPick: (fragment: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="lp-picker" ref={ref}>
      <button
        type="button"
        className={`lp-picker-button ${open ? 'active' : ''}`}
        title="Insert an icon"
        aria-expanded={open}
        // Keep the text field's caret where it is.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setOpen((v) => !v)}
      >
        <IconGlyph def={ICONS[0]} />
        <span>Icons</span>
      </button>
      {open && (
        <div className="lp-panel" role="dialog" aria-label="Label icons">
          {GROUPS.map((g) => (
            <div key={g} className="lp-group">
              <div className="lp-group-name">{g}</div>
              <div className="lp-grid">
                {ICONS.filter((d) => d.group === g).map((d) => {
                  const frag = d.insert ?? `{${d.name}}`;
                  return (
                    <button
                      key={d.name}
                      type="button"
                      title={`${d.title} — ${frag}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onPick(frag);
                        setOpen(false);
                      }}
                    >
                      <IconGlyph def={d} />
                    </button>
                  );
                })}
                {g === 'Layout' &&
                  [
                    { frag: '{<}', label: '⇤', title: 'Align this line left — {<} at its start' },
                    { frag: '{>}', label: '⇥', title: 'Align this line right — {>} at its start' },
                    { frag: '{...}', label: '↔', title: 'Push what follows to the right edge — {...}' },
                  ].map((x) => (
                    <button
                      key={x.frag}
                      type="button"
                      className="lp-text-button"
                      title={x.title}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onPick(x.frag);
                        setOpen(false);
                      }}
                    >
                      {x.label}
                    </button>
                  ))}
              </div>
            </div>
          ))}
          <p className="lp-help">
            Icons are one capital letter tall. Give screws and bolts a length or head: <code>{'{bolt:20}'}</code>,{' '}
            <code>{'{screw:socket:12}'}</code>, <code>{'{screw:flat}'}</code>. <code>{'{contents}'}</code> prints the first item of
            What&apos;s in it.
          </p>
        </div>
      )}
    </div>
  );
}

/** What `{contents}` shows in a preview when the contents aren't known (or are empty). */
const CONTENTS_STAND_IN = 'What’s in it';

/** The text as the label will show it: `{contents}` filled in (or a stand-in). */
export function previewText(text: string, contents: string | undefined): string {
  if (!new RegExp(CONTENTS_FRAGMENT.source, 'i').test(text)) return text;
  const filled = contents === undefined ? '' : fillContents(text, contents);
  return labelLines(filled) ? filled : text.replace(new RegExp(CONTENTS_FRAGMENT.source, 'gi'), CONTENTS_STAND_IN);
}

/**
 * A label's text laid out on its face: `w` × `h` mm with `margin`, cap height
 * at most `cap`. Shows why when it doesn't fit.
 */
export function LabelPreview({
  text,
  w,
  h,
  cap,
  margin = 1,
  box: boxIn,
  contents,
  title,
}: {
  text: string;
  w: number;
  h: number;
  cap: number;
  margin?: number;
  /** Where the text goes on the face (overrides `margin`). */
  box?: Box;
  /** What `{contents}` stands for (undefined: unknown). */
  contents?: string;
  title?: string;
}) {
  const font = useLabelFont();
  const shown = previewText(text, contents);
  if (!font || !labelLines(shown) || !(w > 0 && h > 0)) return null;
  const box: Box = boxIn ?? { x0: margin, y0: margin, x1: w - margin, y1: h - margin };
  const fit = fitText(shown, box, cap);
  return (
    <div className="lp-preview" title={title}>
      <svg viewBox={`-0.5 -0.5 ${w + 1} ${h + 1}`} style={{ aspectRatio: `${w + 1} / ${h + 1}` }} role="img" aria-label={`Label preview: ${labelLines(shown)}`}>
        <rect x={0} y={0} width={w} height={h} rx={Math.min(1, h / 4)} className="lp-face" />
        {fit && (
          <g transform={`translate(0 ${h}) scale(1 -1)`}>
            <path d={contoursPath(fit.outline.contours, fit.cx, fit.cy)} fillRule="nonzero" className="lp-ink" />
          </g>
        )}
      </svg>
      {!fit && <div className="lp-warn">Too much text to print legibly here: shorten it or use fewer lines.</div>}
    </div>
  );
}

/** A preview of several pieces of text on one face (front labels): face w × h (mm, y up from the bottom). */
export function FacePreview({
  w,
  h,
  boxes,
  cap,
  bands,
}: {
  w: number;
  h: number;
  /** Text boxes in face coordinates (x from the left, y up from the bottom). */
  boxes: { text: string; box: Box }[];
  cap: number;
  /** Shaded bands (the feet, the lip). */
  bands?: { y0: number; y1: number }[];
}) {
  const font = useLabelFont();
  if (!font) return null;
  return (
    <div className="lp-preview lp-face-preview">
      <svg viewBox={`-0.5 -0.5 ${w + 1} ${h + 1}`} style={{ aspectRatio: `${w + 1} / ${h + 1}` }} role="img" aria-label="Front label preview">
        <rect x={0} y={0} width={w} height={h} rx={2} className="lp-face" />
        <g transform={`translate(0 ${h}) scale(1 -1)`}>
          {bands?.map((b, i) => <rect key={i} x={0} y={b.y0} width={w} height={b.y1 - b.y0} className="lp-band" />)}
          {boxes.map((b, i) => {
            const fit = fitText(b.text, b.box, cap);
            return (
              <g key={i}>
                <rect x={b.box.x0} y={b.box.y0} width={b.box.x1 - b.box.x0} height={b.box.y1 - b.box.y0} className="lp-zone" />
                {fit && <path d={contoursPath(fit.outline.contours, fit.cx, fit.cy)} fillRule="nonzero" className="lp-ink" />}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
