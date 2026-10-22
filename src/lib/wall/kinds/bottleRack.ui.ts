import type { AttachmentPreset } from '../registry';
import { registerAttachmentUi } from '../uiRegistry';
import type { BottleRackOptions } from './bottleRack';

const round = (o: BottleRackOptions) => o.shape === 'round';
/** A round bottle: its diameter (the hole is 0.5 mm bigger all round) and cup depth (about 40% of its height). */
const r = (value: string, label: string, diameter: number, cup: number, title?: string): AttachmentPreset => ({
  value,
  label,
  ...(title ? { title } : {}),
  set: { shape: 'round', diameter, cup },
});
const sq = (value: string, label: string, diameter: number, corner: number, cup: number): AttachmentPreset => ({
  value,
  label,
  set: { shape: 'square', diameter, corner, cup },
});

registerAttachmentUi({
  type: 'bottleRack',
  label: 'Bottle & pot rack',
  description: 'Rows of cups stepped like stadium seats: paint bottles and pots, spice jars, spray cans, test tubes.',
  group: 'hobby',
  fields: [
    {
      key: 'preset',
      label: 'For',
      kind: 'preset',
      hint: 'Sizes vary: measure yours, and set the diameter and clearance to suit.',
      presets: [
        r('dropper', 'Dropper bottle 17–18 ml (Vallejo, Army Painter, AK, Scale75, Reaper)', 25, 30, 'Also Two Thin Coats: a 26 mm hole'),
        r('dropperNew', 'Army Painter dropper, new style', 26, 30, 'A 27 mm hole'),
        r('citadel', 'Citadel pot', 33, 18, 'A 34 mm hole; the pots are about 45 tall'),
        r('proAcryl', 'Pro Acryl bottle', 32, 30, 'A 33 mm hole'),
        sq('tamiya10', 'Tamiya 10 ml jar (square)', 28, 4, 15),
        r('tamiya23', 'Tamiya 23 ml jar', 40, 20, 'A 41 mm hole'),
        r('spiceUs', 'Spice jar, US standard (44.5–46)', 45.5, 40, 'A 46.5 mm hole'),
        r('penzeys', 'Spice jar, Penzeys', 50, 40, 'A 51 mm hole'),
        r('spice41', 'Spice jar, ⌀40 (EU)', 40, 35),
        r('spice46', 'Spice jar, ⌀45 (EU)', 45, 40),
        r('spice50', 'Spice jar, ⌀49 (EU)', 49, 40),
        r('spice54', 'Spice jar, ⌀53 (EU)', 53, 40),
        r('verstegen', 'Spice jar, Verstegen', 54, 40, 'A 55 mm hole'),
        sq('spiceSquare', 'Spice jar, square 53 × 53', 52, 12, 40),
        r('aerosol', 'Spray can (⌀65–66.7)', 67, 60, 'A 68 mm hole'),
        r('wd40', 'WD-40 180 ml', 52.5, 80, 'A 53.5 mm hole, 80 deep'),
        r('glue', 'Glue bottle, small (CA, ⌀30)', 30, 25, 'Measure yours'),
        r('flux', 'Flux syringe', 15, 40, 'A 16 mm hole'),
        r('tube16', 'Test tube ⌀16', 16, 40),
        r('tube20', 'Test tube ⌀20', 20, 45),
        r('tube25', 'Test tube ⌀25', 25, 50),
        r('tipCleaner', 'Soldering tip cleaner ⌀55', 55, 20),
        r('nailPolish', 'Nail polish (⌀30–35)', 34, 20, 'Shapes vary: measure yours'),
      ],
    },
    {
      key: 'shape',
      label: 'Shape',
      kind: 'select',
      options: [
        { value: 'round', label: 'Round' },
        { value: 'square', label: 'Square', title: 'Square jars: Tamiya, square spice jars' },
      ],
    },
    { key: 'diameter', label: 'Bottle diameter', kind: 'length', min: 3, max: 150, hint: 'The bottle, not the hole.', when: round },
    { key: 'diameter', label: 'Bottle width', kind: 'length', min: 3, max: 150, hint: 'The jar, not the pocket.', when: (o: BottleRackOptions) => !round(o) },
    { key: 'corner', label: 'Corner radius', kind: 'length', min: 0, max: 30, when: (o: BottleRackOptions) => !round(o) },
    { key: 'clearance', label: 'Clearance', kind: 'length', min: 0, max: 3, hint: 'Each side: 0.5 drops in easily.' },
    { key: 'columns', label: 'Across', kind: 'number', min: 1, max: 20, step: 1, suffix: '' },
    { key: 'rows', label: 'Rows', kind: 'number', min: 1, max: 8, step: 1, suffix: '' },
    {
      key: 'stagger',
      label: 'Staggered rows',
      kind: 'toggle',
      hint: 'Every other row one shorter, set between: shallower.',
      when: (o: BottleRackOptions) => round(o) && o.rows > 1,
    },
    {
      key: 'step',
      label: 'Row step',
      kind: 'length',
      min: 0,
      max: 60,
      hint: 'Each row behind this much higher, so they show over the front.',
      when: (o: BottleRackOptions) => o.rows > 1,
    },
    {
      key: 'tilt',
      label: 'Tilt',
      kind: 'number',
      min: 0,
      max: 30,
      step: 1,
      suffix: '°',
      hint: 'Leans them toward you: caps and labels face you on a rack above your eyes.',
    },
    { key: 'cup', label: 'Cup depth', kind: 'length', min: 5, max: 150, hint: 'About 40% of the bottle’s height holds it well.' },
    {
      key: 'floor',
      label: 'Bottom',
      kind: 'select',
      options: [
        { value: 'closed', label: 'Closed', title: 'Catches drips' },
        { value: 'hole', label: 'Lip', title: 'A lip round a hole: push a bottle up from below' },
        { value: 'ring', label: 'Ring', title: 'No bottom: things go through, or hang by their rim' },
        { value: 'neck', label: 'Upside down', title: 'Dropper bottles cap down: the shoulder rests in a funnel, the cap in a hole' },
      ],
    },
    {
      key: 'neck',
      label: 'Cap diameter',
      kind: 'length',
      min: 4,
      max: 60,
      hint: 'Upside down: the cap goes through this hole.',
      when: (o: BottleRackOptions) => o.floor === 'neck',
    },
    { key: 'label', label: 'Label strip', kind: 'toggle', hint: 'Along the front, sloped to read from above.' },
    { key: 'wall', label: 'Wall', kind: 'length', min: 1.2, max: 4 },
  ],
});
