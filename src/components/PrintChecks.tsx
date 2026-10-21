import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { history, printDrawers, selectedIds, useStore, useUnits } from '../state/store';
import { Section, Segmented } from './fields';
import { useLabelFont } from './labelFont';
import { geometry } from '../worker/client';
import { formatLength } from '../lib/units';
import { DEFAULT_NOZZLE, NOZZLES } from '../lib/layout/plan';
import { nozzleOf, placedBinChecks, projectChecks, worstSeverity, type CheckFix, type CheckSeverity, type FoundCheck, type PrintCheck } from '../lib/printability';
import type { GridLayout } from '../lib/layout/drawer';
import type { PlacedBin, PrintJob } from '../lib/project';
import './printChecks.css';

/**
 * Print checks in the UI (rules in lib/printability.ts): a notice for the
 * selected bin, a summary of everything being printed before the exports,
 * the nozzle they're measured against, and the marks on the bin grid.
 */

/** Lengths in check messages: mm to 0.01, small inch values as decimals (0.006″ reads better than a fraction). */
function useCheckFmt() {
  const { units, precision } = useUnits();
  return useCallback(
    (mm: number) => (units === 'mm' ? formatLength(mm, 'mm', { mmDigits: 2 }) : formatLength(mm, 'in', { precision: mm < 10 ? 0 : precision })),
    [units, precision],
  );
}

/** Where a check's fix goes: the bin (in its drawer), or the drawer and its baseplate. */
interface FixTarget {
  drawerId?: string;
  binId?: string;
}

/** Apply a fix as one undo step, switching to its drawer first when it's another one. */
function applyFix(fix: CheckFix, at: FixTarget) {
  const s = useStore.getState();
  history.checkpoint();
  if (at.drawerId && at.drawerId !== s.activeDrawerId) s.switchDrawer(at.drawerId);
  const st = useStore.getState();
  if (fix.bin && at.binId) st.updateBin(at.binId, { opts: fix.bin });
  if (fix.baseplate) st.setBaseplate(fix.baseplate);
  if (fix.drawer) st.setDrawer(fix.drawer);
  history.checkpoint();
}

function CheckItem({ check, at }: { check: PrintCheck; at: FixTarget }) {
  return (
    <li className={`pc-item ${check.severity}`}>
      <span className="pc-part">{check.part}.</span> {check.message}
      {check.fix && (
        <>
          {' '}
          <button className="link" onClick={() => applyFix(check.fix!, at)}>
            {check.fix.label}
          </button>
        </>
      )}
    </li>
  );
}

/** The selected bin's print checks, with their fixes. Nothing when there are none. */
export function BinChecksNotice({ bin, layout }: { bin: PlacedBin; layout: GridLayout }) {
  const font = useLabelFont();
  const fmt = useCheckFmt();
  const nozzle = useStore((s) => nozzleOf(s.setup));
  const drawerId = useStore((s) => s.activeDrawerId);
  // `font`: text checks only run once the label font is in.
  const checks = useMemo(() => placedBinChecks(layout, bin, { nozzle, fmt }), [layout, bin, nozzle, fmt, font]);
  if (!checks.length) return null;
  const warns = checks.filter((c) => c.severity === 'warn').length;
  const tips = checks.length - warns;
  return (
    <div className={`print-notice ${worstSeverity(checks)}`} role="status">
      <div className="print-notice-head">
        {warns ? `${warns} print ${warns === 1 ? 'problem' : 'problems'}` : 'Print tips'}
        {warns > 0 && tips > 0 && (
          <span className="muted">
            {' '}
            · {tips} {tips === 1 ? 'tip' : 'tips'}
          </span>
        )}
      </div>
      <ul className="pc-list">
        {checks.map((c, i) => (
          <CheckItem key={`${c.rule}-${i}`} check={c} at={{ drawerId, binId: bin.id }} />
        ))}
      </ul>
    </div>
  );
}

/** Worst check per bin of the active drawer, for the marks on the bin grid. */
export function useBinCheckMarks(layout: GridLayout, bins: PlacedBin[]): ReadonlyMap<string, CheckSeverity> {
  // The marks' text checks need the label font only with bins, and it can wait until the first view is up.
  const firstView = useSyncExternalStore((cb) => geometry.subscribe(cb), () => geometry.firstViewIn);
  const font = useLabelFont(firstView && bins.length > 0);
  const nozzle = useStore((s) => nozzleOf(s.setup));
  return useMemo(() => {
    const out = new Map<string, CheckSeverity>();
    for (const b of bins) {
      const worst = worstSeverity(placedBinChecks(layout, b, { nozzle }));
      if (worst) out.set(b.id, worst);
    }
    return out;
    // `font`: text checks only run once the label font is in.
  }, [layout, bins, nozzle, font]);
}

/** Nozzle size, next to the printer. The print checks measure lines and fits against it. */
export function NozzleField() {
  const nozzle = useStore((s) => nozzleOf(s.setup));
  const setSetup = useStore((s) => s.setSetup);
  return (
    <Segmented
      label="Nozzle"
      value={nozzle}
      options={NOZZLES.map((n) => ({ value: n, label: `${n} mm` }))}
      onChange={(n) => setSetup({ nozzle: n === DEFAULT_NOZZLE ? undefined : n })}
      hint="Print checks use it to spot walls, text and fits too fine to print."
    />
  );
}

/** Groups of checks that are about the same thing (a bin, a drawer's baseplate, the printer). */
interface CheckGroup {
  key: string;
  title: string;
  at: FixTarget;
  checks: FoundCheck[];
}

/** How many groups show before "Show all". */
const SHOWN = 6;

/**
 * Print checks across everything being printed, before the exports. Clicking a
 * bin selects it (in its drawer); clicking a baseplate opens its drawer.
 */
export function PrintChecksSection({ job }: { job: PrintJob }) {
  const font = useLabelFont();
  const fmt = useCheckFmt();
  const store = useStore();
  const [all, setAll] = useState(false);
  const { setup, include, drawers, bins, drawer, baseplate, activeDrawerId, printScope, printPick } = store;
  // Printing the selected bins: the checks follow the selection.
  const selection = printScope === 'selected' ? selectedIds(store.ui).join() : '';
  const checks = useMemo(
    () => projectChecks(printDrawers(store), setup, include, { fmt }),
    // `store` changes on every edit; these are what the checks read (and `font`: text checks wait for it).
    [setup, include, drawers, bins, drawer, baseplate, activeDrawerId, printScope, printPick, selection, fmt, font],
  );
  const multi = job.drawers.length > 1;
  const names = new Map(printDrawers(store).map((d) => [d.id, d.name]));
  const groups: CheckGroup[] = [];
  for (const c of checks) {
    const key = c.binId ? `${c.drawerId}/${c.binId}` : (c.drawerId ?? 'setup');
    let g = groups.find((x) => x.key === key);
    if (!g) {
      const part = c.binId ? job.parts[multi ? `${c.drawerId}/bin:${c.binId}` : `bin:${c.binId}`] : undefined;
      const title = c.binId
        ? (part?.name ?? 'Bin')
        : c.drawerId
          ? multi
            ? `${names.get(c.drawerId) ?? 'Drawer'} · baseplate`
            : 'Baseplate'
          : 'Printer';
      g = { key, title, at: { drawerId: c.drawerId, binId: c.binId }, checks: [] };
      groups.push(g);
    }
    g.checks.push(c);
  }
  // Groups with a warning first.
  groups.sort((a, b) => Number(!a.checks.some((c) => c.severity === 'warn')) - Number(!b.checks.some((c) => c.severity === 'warn')));
  const warns = checks.filter((c) => c.severity === 'warn').length;
  const tips = checks.length - warns;
  const open = (g: CheckGroup) => {
    if (g.at.binId && g.at.drawerId) store.locateBin(g.at.drawerId, g.at.binId);
    else if (g.at.drawerId) {
      if (g.at.drawerId !== store.activeDrawerId) store.switchDrawer(g.at.drawerId);
      store.setUI({ tab: 'drawer' });
    }
  };
  const shown = all ? groups : groups.slice(0, SHOWN);
  return (
    <Section
      title="Print checks"
      aside={
        <span className="small muted">
          {checks.length ? [warns && `${warns} to fix`, tips && `${tips} ${tips === 1 ? 'tip' : 'tips'}`].filter(Boolean).join(' · ') : 'All clear'}
        </span>
      }
    >
      {!checks.length ? (
        <p className="muted small">No walls, text or fits too fine for the {nozzleOf(setup)} mm nozzle, and nothing printing over air.</p>
      ) : (
        <ul className="pc-groups">
          {shown.map((g) => (
            <li key={g.key} className={`pc-group ${worstSeverity(g.checks)}`}>
              {g.at.drawerId ? (
                <button className="link pc-title" onClick={() => open(g)} title={g.at.binId ? 'Select this bin' : 'Open its drawer'}>
                  {g.title}
                </button>
              ) : (
                <span className="pc-title">{g.title}</span>
              )}
              <ul className="pc-list">
                {g.checks.map((c, i) => (
                  <CheckItem key={`${c.rule}-${i}`} check={c} at={g.at} />
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {groups.length > SHOWN && (
        <button className="link" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${groups.length}`}
        </button>
      )}
    </Section>
  );
}
