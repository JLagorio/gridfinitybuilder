import { useStore } from '../state/store';
import { LengthInput, NumberInput, Section, Segmented, Select, Stepper, Toggle } from './fields';
import { baseplateFloor, baseplateHeight } from '../lib/geometry/baseplate';
import type { PrintJob } from '../lib/project';

const r1 = (v: number) => Math.round(v * 10) / 10;

export function DrawerPanel({ job }: { job: PrintJob }) {
  const drawer = useStore((s) => s.drawer);
  const bp = useStore((s) => s.baseplate);
  const units = useStore((s) => s.ui.units);
  const explode = useStore((s) => s.ui.explode);
  const setDrawer = useStore((s) => s.setDrawer);
  const setBp = useStore((s) => s.setBaseplate);
  const setUI = useStore((s) => s.setUI);
  const L = job.layout;
  const m = L.margins;
  const fmtLen = (mm: number) => (units === 'in' ? `${+(mm / 25.4).toFixed(3)}″` : `${+mm.toFixed(2)} mm`);

  return (
    <>
      <Section
        title="Drawer"
        aside={
          <Segmented
            value={units}
            options={[
              { value: 'mm', label: 'mm' },
              { value: 'in', label: 'in' },
            ]}
            onChange={(u) => setUI({ units: u })}
          />
        }
      >
        <Segmented
          label="Size from"
          value={drawer.mode}
          options={[
            { value: 'drawer', label: 'Drawer size' },
            { value: 'grid', label: 'Grid units' },
          ]}
          onChange={(mode) => setDrawer({ mode })}
        />
        {drawer.mode === 'drawer' ? (
          <>
            <div className="row2">
              <LengthInput label="Inside width" value={drawer.width} units={units} onChange={(width) => setDrawer({ width })} min={42} />
              <LengthInput label="Inside depth" value={drawer.depth} units={units} onChange={(depth) => setDrawer({ depth })} min={42} />
            </div>
            <div className="field-hint">Measure wall to wall at the floor. Fractions work too: 20 1/8 in.</div>
            <NumberInput
              label="Fit clearance"
              value={drawer.clearance}
              min={0}
              max={10}
              step={0.25}
              onChange={(clearance) => setDrawer({ clearance })}
              hint="Taken off each axis so the plate drops in without binding."
            />
            <Segmented
              label="Grid position, left to right"
              value={drawer.alignX}
              options={[
                { value: 0, label: 'Left' },
                { value: 0.5, label: 'Center' },
                { value: 1, label: 'Right' },
              ]}
              onChange={(alignX) => setDrawer({ alignX })}
            />
            <Segmented
              label="Grid position, front to back"
              value={drawer.alignY}
              options={[
                { value: 0, label: 'Front' },
                { value: 0.5, label: 'Center' },
                { value: 1, label: 'Back' },
              ]}
              onChange={(alignY) => setDrawer({ alignY })}
            />
          </>
        ) : (
          <div className="row2">
            <Stepper label="Units wide" value={drawer.gridX} min={1} max={40} onChange={(gridX) => setDrawer({ gridX })} />
            <Stepper label="Units deep" value={drawer.gridY} min={1} max={40} onChange={(gridY) => setDrawer({ gridY })} />
          </div>
        )}
        <div className="summary">
          <div className="summary-big">
            {L.nx} × {L.ny} <small>grid</small>
          </div>
          <dl>
            <dt>Baseplate</dt>
            <dd>
              {fmtLen(L.plateW)} × {fmtLen(L.plateD)}
            </dd>
            {drawer.mode === 'drawer' && (
              <>
                <dt>Solid margin</dt>
                <dd>
                  L {fmtLen(m.left)} · R {fmtLen(m.right)} · F {fmtLen(m.front)} · B {fmtLen(m.back)}
                </dd>
              </>
            )}
            <dt>Height</dt>
            <dd>{r1(baseplateHeight(bp))} mm</dd>
          </dl>
        </div>
      </Section>

      <Section title="Baseplate">
        <Toggle
          label="Magnet pockets"
          checked={bp.magnets}
          onChange={(magnets) => setBp({ magnets })}
          hint="Adds a floor with 4 pockets per cell so magnet bins snap in."
        />
        {bp.magnets && (
          <div className="indent">
            <div className="row2">
              <NumberInput label="Magnet Ø" value={bp.magnetDiameter} min={2} max={15} step={0.5} onChange={(magnetDiameter) => setBp({ magnetDiameter })} />
              <NumberInput label="Magnet height" value={bp.magnetHeight} min={0.5} max={6} step={0.5} onChange={(magnetHeight) => setBp({ magnetHeight })} />
            </div>
            <NumberInput
              label="Pocket fit"
              value={bp.magnetFit}
              min={-0.3}
              max={1}
              step={0.05}
              onChange={(magnetFit) => setBp({ magnetFit })}
              hint="Added to the magnet diameter. 0.1–0.2 = press fit, 0.3+ = glue."
            />
            <Segmented
              label="Insert magnets from"
              value={bp.magnetSide}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'bottom', label: 'Bottom' },
              ]}
              onChange={(magnetSide) => setBp({ magnetSide })}
            />
            {bp.magnetSide === 'top' && (
              <Toggle label="Push-out holes underneath" checked={bp.magnetRelease} onChange={(magnetRelease) => setBp({ magnetRelease })} />
            )}
          </div>
        )}
        <Toggle
          label="Screw holes"
          checked={bp.screws}
          onChange={(screws) => setBp({ screws })}
          hint="Countersunk hole in each cell to screw the plate down."
        />
        {bp.screws && (
          <div className="indent row2">
            <NumberInput label="Screw Ø" value={bp.screwDiameter} min={2} max={6} step={0.5} onChange={(screwDiameter) => setBp({ screwDiameter })} />
            <NumberInput label="Head Ø" value={bp.screwHeadDiameter} min={3} max={12} step={0.5} onChange={(screwHeadDiameter) => setBp({ screwHeadDiameter })} />
          </div>
        )}
        {(bp.magnets || bp.screws) && (
          <NumberInput
            label="Hole floor thickness"
            value={bp.holeFloor}
            min={Math.max(1, bp.magnets ? bp.magnetHeight + 0.6 : 1)}
            max={10}
            step={0.1}
            onChange={(holeFloor) => setBp({ holeFloor })}
          />
        )}
        <NumberInput
          label="Extra solid floor"
          value={bp.bottomPad}
          min={0}
          max={10}
          step={0.2}
          onChange={(bottomPad) => setBp({ bottomPad })}
          hint="0 = open-bottom frame (least filament)."
        />
        <Select
          label="Connectors"
          value={bp.connector}
          options={[
            { value: 'none', label: 'None' },
            { value: 'bowtie', label: 'Bowtie keys' },
          ]}
          onChange={(connector) => setBp({ connector })}
          hint={
            bp.connector === 'none'
              ? 'Bowtie keys lock the split pieces together.'
              : job.plan.pieces.length < 2
                ? 'The baseplate prints in one piece, so there are no seams to join.'
                : `Pockets underneath wherever a wall or margin crosses a seam. ${job.connectors.length} keys print with the pieces; fit them with the baseplate upside down.`
          }
        />
        <details className="advanced">
          <summary>Advanced</summary>
          <NumberInput label="Outer corner radius" value={bp.outerRadius} min={0} max={30} step={0.5} onChange={(outerRadius) => setBp({ outerRadius })} />
          <NumberInput
            label="Top ridge trim"
            value={bp.topTrim}
            min={0}
            max={1.5}
            step={0.05}
            onChange={(topTrim) => setBp({ topTrim })}
            hint="Flattens the knife-edge where cells meet so it prints cleanly."
          />
          <NumberInput
            label="Bottom clearance"
            value={bp.bottomClearance}
            min={0}
            max={1}
            step={0.05}
            onChange={(bottomClearance) => setBp({ bottomClearance })}
            hint="Spec is 0.35 (5 mm baseplate)."
          />
          <NumberInput
            label="Bottom edge chamfer"
            value={bp.bottomChamfer}
            min={0}
            max={2}
            step={0.1}
            onChange={(bottomChamfer) => setBp({ bottomChamfer })}
            hint="Elephant-foot relief on the outside edge."
          />
          <div className="field-hint">Floor under receptacles: {r1(baseplateFloor(bp))} mm</div>
        </details>
      </Section>

      <Section title="View">
        <Toggle label="Spread pieces apart" checked={explode} onChange={(v) => setUI({ explode: v })} />
      </Section>
    </>
  );
}
