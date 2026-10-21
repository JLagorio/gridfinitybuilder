import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useStore, useUnits } from '../state/store';
import { Field, Section, Segmented, Slider } from './fields';
import { Find } from './findContext';
import { binChecks, nozzleOf, CHECK, type PrintCheck } from '../lib/printability';
import { binQrPlan, resolveQrText } from '../lib/geometry/binQr';
import { QR, qrSide, sanitizeQrText, type QrContent, type QrStyle, type QrSurface } from '../lib/geometry/qrCode';
import { QR_QUIET, QR_RECOVERY, qrByteLength, type QrEcc } from '../lib/qr';
import { encodeQr, qrRects } from '../lib/qrEncode';
import type { BinCells, BinOptions } from '../lib/geometry/bin';
import type { PlacedBin } from '../lib/project';
import './qr.css';

/**
 * The bin's QR code (geometry/qrCode.ts, binQr.ts): where it goes, what it
 * says, how it prints, its size, and a live preview of the code as it will
 * print, with what it holds and how large its modules come out.
 */

const SURFACES: { value: QrSurface; label: string; title: string }[] = [
  { value: 'none', label: 'None', title: 'No QR code' },
  { value: 'front', label: 'Front', title: 'On the outside of the front wall' },
  { value: 'lid', label: 'Lid', title: 'On the stacking lid’s floor, or the sliding lid’s top' },
  { value: 'plate', label: 'Plate', title: 'A flat tag that prints with the bins and sticks on' },
];

const CONTENTS: { value: QrContent; label: string; title: string }[] = [
  { value: 'contents', label: 'What’s in it', title: 'The bin’s label and each line of What’s in it, as plain text' },
  { value: 'custom', label: 'Custom text', title: 'Your own text or a link' },
];

const STYLES: { value: QrStyle; label: string; title: string }[] = [
  { value: 'inlaid', label: 'Inlaid', title: 'Cut in and filled flush in filament 2 (AMS): the best contrast' },
  { value: 'raised', label: 'Raised', title: `Modules stand ${QR.raise} mm proud, one filament` },
  { value: 'engraved', label: 'Engraved', title: `Modules cut ${QR.depth} mm in, one filament` },
];

const ECCS: { value: QrEcc; label: string; title: string }[] = (['L', 'M', 'Q', 'H'] as const).map((e) => ({
  value: e,
  label: e,
  title: `Reads with up to ${Math.round(QR_RECOVERY[e] * 100)} % of the code scuffed or dirty`,
}));

const SURFACE_HINTS: Record<Exclude<QrSurface, 'none'>, string> = {
  front: 'On the outside of the front wall, as large as the flat face allows: for bins you see from the front (a shelf, the front row).',
  lid: 'On the lid: one cell of a stacking lid (Lip & lid), or a sliding lid’s top behind the grip ridges.',
  plate: 'A flat tag that prints with the bins: stick it on the bin’s front, its lid or the drawer front (double-sided tape).',
};

/** A text box that commits after a short pause and on blur, like the label and contents fields. */
function QrTextField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  const [text, setText] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const commit = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const clean = sanitizeQrText(v);
    if (clean !== value) onChange(clean);
  };
  const bytes = qrByteLength(text.trim());
  return (
    <Field label="Text or link" id={id} hint={`${bytes} byte${bytes === 1 ? '' : 's'}. A link opens on the phone; anything else shows as text.`}>
      <div className="input-wrap qr-text">
        <textarea
          id={id}
          rows={Math.min(5, Math.max(2, text.split('\n').length))}
          value={text}
          maxLength={QR.maxText}
          placeholder="https://… or any text"
          spellCheck={false}
          onFocus={() => (focused.current = true)}
          onChange={(e) => {
            setText(e.target.value);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => commit(e.target.value), 600);
          }}
          onBlur={() => {
            focused.current = false;
            commit(text);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setText(value);
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
        />
      </div>
    </Field>
  );
}

/**
 * A QR code drawn as it prints: the modules on the light body with the quiet
 * zone around them. Inlaid codes show the second filament's colour; one-colour
 * codes are drawn low-contrast, as they look. Null when the text doesn't fit
 * any code.
 */
export function QrPreview({ text, ecc, version, style = 'inlaid', ink, size = 148, title }: { text: string; ecc: QrEcc; version?: number; style?: QrStyle; ink?: string; size?: number; title?: string }) {
  const code = useMemo(() => (text ? encodeQr(text, ecc, version ? { minVersion: version, maxVersion: version } : {}) : null), [text, ecc, version]);
  const path = useMemo(() => (code ? qrRects(code).map(([x, y, w, h]) => `M${x + QR_QUIET} ${y + QR_QUIET}h${w}v${h}h${-w}z`).join('') : ''), [code]);
  if (!code) return null;
  const n = code.size + 2 * QR_QUIET;
  const two = style === 'inlaid';
  return (
    <svg className={`qr-preview ${two ? '' : 'one-colour'}`} viewBox={`0 0 ${n} ${n}`} width={size} height={size} role="img" aria-label={title ?? `QR code: ${text}`} shapeRendering="crispEdges">
      <rect width={n} height={n} className="qr-body" />
      <path d={path} style={two && ink ? { fill: ink } : undefined} className="qr-ink" />
    </svg>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The QR code section of the bin panel. `bin`: the one selected bin (null for several, or for new bins). */
export function QrSection({ opts, onChange, bin, cells, many }: { opts: BinOptions; onChange: (p: Partial<BinOptions>) => void; bin: PlacedBin | null; cells?: BinCells; many?: boolean }) {
  const { fmt, units, precision } = useUnits();
  const setup = useStore((s) => s.setup);
  const nozzle = nozzleOf(setup);
  const on = opts.qr !== 'none';
  const resolved = useMemo(() => (on ? resolveQrText(opts, bin ?? {}, cells) : opts), [on, opts, bin, cells]);
  const plan = useMemo(() => (on ? binQrPlan(resolved, cells) : null), [on, resolved, cells]);
  const checks = useMemo<PrintCheck[]>(() => (on ? binChecks(resolved, cells, { nozzle, fmt: (mm) => fmt(mm, { mmDigits: 2 }) }).filter((c) => c.rule.startsWith('qr')) : []), [on, resolved, cells, nozzle, units, precision]);
  const spot = plan?.spot ?? null;
  const fit = plan?.fit ?? null;
  const min = CHECK.qrLines * nozzle;
  const maxSize = plan ? (opts.qr === 'plate' ? QR.maxPlate : Math.max(10, Math.floor(plan.room))) : QR.maxPlate;
  const problems = checks.filter((c) => c.severity === 'warn');
  const tips = checks.filter((c) => c.severity === 'info' && !(c.rule === 'qr-fit' && plan?.error === 'empty'));

  return (
    <Section find="qr" set={on} title="QR code">
      <Find id="qr-surface" set={on}>
        <Segmented
          label="Where"
          value={opts.qr}
          options={SURFACES}
          onChange={(qr) => onChange({ qr })}
          hint={on ? SURFACE_HINTS[opts.qr as Exclude<QrSurface, 'none'>] : 'A code a phone camera reads to show what’s in the bin, offline.'}
        />
      </Find>
      {on && (
        <>
          <Find id="qr-content" set={on}>
            <Segmented
              label="It says"
              value={opts.qrContent}
              options={CONTENTS}
              onChange={(qrContent) => onChange({ qrContent })}
              hint={
                opts.qrContent === 'contents'
                  ? 'The bin’s label and each line of What’s in it as plain text: any phone camera shows the list, no app or internet. It follows the list as you edit it.'
                  : 'Text, or a link to your own inventory (it must fit the code: shorter is bigger).'
              }
            />
            {opts.qrContent === 'custom' ? (
              <QrTextField value={opts.qrText} onChange={(qrText) => onChange({ qrText })} />
            ) : bin && plan?.text ? (
              <pre className="qr-says" aria-label="What the code says">
                {plan.text}
              </pre>
            ) : (
              <p className="muted small">
                {many ? 'Each bin’s code lists its own label and contents.' : bin ? 'Nothing to list yet: give the bin a label or fill in What’s in it below.' : 'Each bin’s code lists its own label and What’s in it.'}
              </p>
            )}
          </Find>
          <Find id="qr-style" set={on}>
            <Segmented
              label="Printed"
              value={opts.qrStyle}
              options={STYLES}
              onChange={(qrStyle) => onChange({ qrStyle })}
              hint={
                opts.qrStyle === 'inlaid'
                  ? 'Dark modules in filament 2 (pick its colour in Print plates); the bin is the light part, so print it in a light colour.'
                  : `One colour: only shadows show the modules, so it scans poorly unless lit from the side.${
                      opts.qrStyle === 'raised' && opts.qr === 'front' ? ` Raised ${QR.raise} mm, it touches a bin right in front of it: for the front row or a shelf.` : ''
                    }`
              }
            />
          </Find>
          <Find id="qr-ecc" set={on}>
            <Segmented
              label="Error correction"
              value={opts.qrEcc}
              options={ECCS}
              onChange={(qrEcc) => onChange({ qrEcc })}
              hint="How much of the code can be scuffed and still read (L 7 %, M 15 %, Q 25 %, H 30 %). More needs more modules, so they come out smaller."
            />
          </Find>
          <Find id="qr-size" set={on}>
            <Slider
              label={opts.qr === 'plate' ? 'Plate size' : 'Size'}
              value={Math.min(opts.qrSize, maxSize)}
              min={0}
              max={maxSize}
              step={0.5}
              format={(v) => (v === 0 ? 'Auto' : fmt(v))}
              onChange={(v) => onChange({ qrSize: v > 0 && v < 10 ? 10 : v })}
              hint={
                opts.qr === 'plate'
                  ? `Auto: as large as the bin’s front face, and at least large enough for ${fmt(QR.autoModule)} modules.`
                  : 'Auto: as large as the surface allows. The code with its 4-module quiet zone.'
              }
            />
          </Find>
          <div className="qr-status">
            {fit && (
              <QrPreview text={plan!.text} ecc={opts.qrEcc} version={fit.version} style={spot?.style ?? opts.qrStyle} ink={setup.labelColour ?? '#161616'} />
            )}
            <div className="qr-readout">
              {fit ? (
                <>
                  <div>
                    <b>{fit.mode === 'byte' ? plural(fit.length, 'byte') : plural(fit.length, fit.mode === 'numeric' ? 'digit' : 'character')}</b> ·
                    version {fit.version} · {fit.size} × {fit.size} modules · error correction {opts.qrEcc}
                  </div>
                  {spot ? (
                    <div>
                      <b>{fmt(spot.module, { mmDigits: 2 })}</b> modules, {fmt(qrSide(spot), { mmDigits: 1 })} square with the quiet zone, on the {plan!.where}
                      {spot.style !== opts.qrStyle ? ` (${spot.style} there)` : ''}.{' '}
                      <span className={spot.module >= min - 1e-6 ? 'ok' : 'bad'}>
                        {spot.module >= min - 1e-6 ? `Prints with the ${nozzle} mm nozzle.` : `Under two lines of the ${nozzle} mm nozzle (${fmt(min)}).`}
                      </span>
                    </div>
                  ) : (
                    <div className="bad">Not printed: it doesn’t fit the {plan!.where}.</div>
                  )}
                </>
              ) : (
                plan?.error !== 'empty' && <div className="bad">{plan?.text ? 'Too long for any QR code.' : ''}</div>
              )}
            </div>
          </div>
          {problems.map((c, i) => (
            <div key={`p${i}`} className="field-error qr-problem" role="alert">
              {c.message}
              {c.fix && (
                <>
                  {' '}
                  <button className="link" onClick={() => onChange(c.fix!.bin ?? {})}>
                    {c.fix.label}
                  </button>
                </>
              )}
            </div>
          ))}
          {tips.map((c, i) => (
            <div key={`t${i}`} className="field-hint qr-tip">
              {c.message}
              {c.fix && (
                <>
                  {' '}
                  <button className="link" onClick={() => onChange(c.fix!.bin ?? {})}>
                    {c.fix.label}
                  </button>
                </>
              )}
            </div>
          ))}
        </>
      )}
    </Section>
  );
}
