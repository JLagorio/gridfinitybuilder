import type { AttachmentPreset } from '../registry';
import { registerAttachmentUi } from '../uiRegistry';
import type { BatteryDockOptions } from './batteryDock';

const rail = (o: BatteryDockOptions) => o.mode === 'rail';
const stem = (o: BatteryDockOptions) => o.mode === 'stem';

/**
 * Packs' outside sizes (width × depth × length, mm) are makers' and retailers' figures for one common pack
 * (M18 XC5.0, Makita BL1850B, Bosch GBA 18V 4.0 Ah, DeWalt DCB184 length and height, Parkside PAP 20 B3);
 * the Ridgid and Einhell sizes, the stem packs' and every rail profile are estimates. No maker publishes
 * its slide rails, so the rail sizes are a starting point only: print the fit coupons first, then measure
 * the pack's rails and adjust (or hold it in a pocket by its outside).
 */
const PACKS: [string, string, number, number, number][] = [
  ['m18', 'Milwaukee M18', 79, 71, 114],
  ['dewalt', 'DeWalt 20V MAX / 18V XR', 79, 66, 110],
  ['makita', 'Makita LXT 18V', 75, 62, 113],
  ['bosch', 'Bosch Professional 18V', 74, 56, 114],
  ['parkside', 'Parkside X20V', 84, 71, 126],
  ['ridgid', 'Ridgid 18V', 80, 75, 120],
  ['einhell', 'Einhell Power X-Change', 80, 70, 125],
  ['m12', 'Milwaukee M12 (stem)', 74, 54, 100],
  ['ryobi', 'Ryobi ONE+ (stem)', 82, 108, 95],
];

/** Rail receivers (starting points): between the rails' tips, how far they reach in, their thickness, room under them, length, latch. */
const RAILS: Record<string, [number, number, number, number, number, number]> = {
  m18: [52, 3, 3.2, 6, 80, 68],
  dewalt: [49, 3, 3, 5, 78, 66],
  makita: [48, 3, 3, 5.5, 80, 68],
  bosch: [50, 3, 3, 5, 80, 68],
  parkside: [50, 3, 3, 5.5, 85, 72],
  ridgid: [52, 3, 3, 5.5, 85, 72],
  einhell: [50, 3, 3, 5.5, 85, 72],
};

/** Stems (starting points): across and front to back. */
const STEMS: Record<string, [number, number]> = { m12: [32, 24], ryobi: [52, 40] };

const sizes = (id: string) => {
  const p = PACKS.find((q) => q[0] === id)!;
  return { packW: p[2], packD: p[3], packL: p[4] };
};
const label = (id: string) => PACKS.find((q) => q[0] === id)![1];

const RAIL_PRESETS: AttachmentPreset[] = Object.entries(RAILS).map(([id, [spacing, railW, railT, groove, length, latchAt]]) => ({
  value: id,
  label: `${label(id)} (starting point)`,
  set: { ...sizes(id), spacing, railW, railT, groove, length, latchAt },
}));
const STEM_PRESETS: AttachmentPreset[] = Object.entries(STEMS).map(([id, [stemW, stemD]]) => ({
  value: id,
  label: `${label(id)} (starting point)`,
  set: { ...sizes(id), stemW, stemD },
}));
const BODY_PRESETS: AttachmentPreset[] = PACKS.map(([id, name, packW, packD, packL]) => ({
  value: id,
  label: `${name}, ${packW} × ${packD} × ${packL}`,
  set: { packW, packD, packL },
}));

const START = 'A starting point, not a measurement: brands don’t publish their rails. Print the fit coupons first, then adjust.';
const MEASURE = 'Measure yours: packs of one brand differ with their capacity.';

registerAttachmentUi({
  type: 'batteryDock',
  label: 'Battery dock',
  description: 'Power-tool packs on slide rails like the tool’s, by the stem, or in pockets. Don’t charge them on it.',
  group: 'tools',
  fields: [
    {
      key: 'mode',
      label: 'Holds it by',
      kind: 'select',
      options: [
        { value: 'rail', label: 'Its rails', title: 'Slides down onto rails like the tool’s foot, its latch clicks in' },
        { value: 'stem', label: 'Its stem', title: 'Stem packs (M12, Ryobi ONE+): upside down, the stem in a socket' },
        { value: 'body', label: 'A pocket', title: 'Any pack, by its outside size' },
      ],
      hint: 'Packs weigh 0.6–1 kg: print it in PETG, and don’t charge them on it.',
    },
    { key: 'railPack', label: 'Pack', kind: 'preset', presets: RAIL_PRESETS, hint: START, when: rail },
    { key: 'stemPack', label: 'Pack', kind: 'preset', presets: STEM_PRESETS, hint: `${START} ${MEASURE}`, when: stem },
    { key: 'bodyPack', label: 'Pack', kind: 'preset', presets: BODY_PRESETS, hint: MEASURE, when: (o: BatteryDockOptions) => o.mode === 'body' },
    { key: 'count', label: 'Bays', kind: 'number', min: 1, max: 6, step: 1, suffix: '' },
    { key: 'packW', label: 'Pack width', kind: 'length', min: 30, max: 160, hint: 'Across, as it hangs.' },
    {
      key: 'packD',
      label: 'Pack depth',
      kind: 'length',
      min: 20,
      max: 160,
      hint: 'Out from the board: a slide pack’s height, rails included; a stem pack’s base front to back.',
    },
    { key: 'packL', label: 'Pack length', kind: 'length', min: 40, max: 200, hint: 'Up the board: along its rails, or a stem pack’s height.' },
    { key: 'spacing', label: 'Between the rails', kind: 'length', min: 20, max: 100, hint: 'The pack’s width between its grooves.', when: rail },
    { key: 'railW', label: 'Rail width', kind: 'length', min: 1, max: 8, hint: 'How far each rail reaches into the pack’s groove.', when: rail },
    { key: 'railT', label: 'Rail thickness', kind: 'length', min: 1.6, max: 8, hint: 'The height of the pack’s grooves.', when: rail },
    { key: 'groove', label: 'Groove depth', kind: 'length', min: 2, max: 15, hint: 'Room under the rails for the pack’s own rails.', when: rail },
    { key: 'length', label: 'Rail length', kind: 'length', min: 30, max: 160, hint: 'Up from the stop.', when: rail },
    {
      key: 'latch',
      label: 'Latch',
      kind: 'select',
      options: [
        { value: 'recess', label: 'Recess', title: 'A recess between the rails the pack’s latch clicks into: press its button to lift it off' },
        { value: 'none', label: 'None', title: 'It rests on the stop: lift it off without the button' },
      ],
      when: rail,
    },
    {
      key: 'latchAt',
      label: 'Latch at',
      kind: 'length',
      min: 5,
      max: 160,
      hint: 'From the pack’s end to the middle of its latch.',
      when: (o: BatteryDockOptions) => rail(o) && o.latch === 'recess',
    },
    { key: 'stemW', label: 'Stem width', kind: 'length', min: 10, max: 80, when: stem },
    { key: 'stemD', label: 'Stem depth', kind: 'length', min: 10, max: 80, hint: 'Front to back.', when: stem },
    { key: 'clearance', label: 'Clearance', kind: 'length', min: 0, max: 1.5, hint: 'Added each side of every fit.' },
    {
      key: 'coupons',
      label: 'Fit coupons',
      kind: 'toggle',
      hint: 'Three short lengths of the rails, tighter, as set and looser (one, two, three notches): try them on a pack first.',
      when: rail,
    },
  ],
});
