import type { AttachmentPreset } from '../registry';
import { registerAttachmentUi } from '../uiRegistry';
import type { StickRackOptions } from './stickRack';

const same = (o: StickRackOptions) => o.mode === 'same';
/** One size: the stick's diameter (the hole is 0.5 mm bigger all round) and the cup depth. */
const p = (value: string, label: string, diameter: number, cup: number): AttachmentPreset => ({ value, label, set: { mode: 'same', diameter, cup } });

registerAttachmentUi({
  type: 'stickRack',
  label: 'Pen & brush rack',
  description: 'Holes for long thin things: pens, pencils, markers, brushes, drumsticks, knitting needles, chopsticks.',
  group: 'hobby',
  fields: [
    {
      key: 'preset',
      label: 'For',
      kind: 'preset',
      hint: 'The sticks’ diameter: measure yours if they’re thicker.',
      presets: [
        p('pencils', 'Pencils ⌀8', 8, 40),
        p('pens', 'Pens ⌀11', 11, 40),
        p('markers', 'Markers ⌀14', 14, 45),
        p('copic', 'Copic, Posca ⌀17', 17, 45),
        p('brushSmall', 'Paint brushes ⌀6', 6, 35),
        p('brushLarge', 'Paint brushes ⌀9', 9, 35),
        p('drumsticks', 'Drumsticks ⌀15.5', 15.5, 80),
        p('crayons', 'Crayons ⌀8', 8, 30),
        p('crayonsJumbo', 'Jumbo crayons ⌀11', 11, 30),
        { value: 'needles', label: 'Knitting needles 2–10 mm', set: { mode: 'list', sizes: '2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 8, 9, 10', cup: 50 } },
      ],
    },
    {
      key: 'mode',
      label: 'Holes',
      kind: 'select',
      options: [
        { value: 'same', label: 'One size' },
        { value: 'list', label: 'A list of sizes', title: 'A set: knitting needles, crochet hooks, drill bits' },
      ],
    },
    { key: 'diameter', label: 'Stick diameter', kind: 'length', min: 1, max: 40, when: same },
    { key: 'columns', label: 'Across', kind: 'number', min: 1, max: 30, step: 1, suffix: '', when: same },
    {
      key: 'sizes',
      label: 'Diameters',
      kind: 'text',
      placeholder: '2, 2.5, 3, 4',
      hint: 'In mm, one per hole, commas between: left to right, the front row first.',
      when: (o: StickRackOptions) => !same(o),
    },
    { key: 'rows', label: 'Rows', kind: 'number', min: 1, max: 6, step: 1, suffix: '' },
    {
      key: 'stagger',
      label: 'Staggered rows',
      kind: 'toggle',
      hint: 'Every other row one shorter, set between.',
      when: (o: StickRackOptions) => same(o) && o.rows > 1,
    },
    { key: 'step', label: 'Row step', kind: 'length', min: 0, max: 40, hint: 'Each row behind this much higher.', when: (o: StickRackOptions) => o.rows > 1 },
    { key: 'tilt', label: 'Tilt', kind: 'number', min: 0, max: 30, step: 1, suffix: '°', hint: 'Leans them toward you, easier to pick out.' },
    { key: 'cup', label: 'Hole depth', kind: 'length', min: 5, max: 150 },
    { key: 'clearance', label: 'Clearance', kind: 'length', min: 0, max: 3, hint: 'Each side.' },
    {
      key: 'floor',
      label: 'Bottom',
      kind: 'select',
      options: [
        { value: 'closed', label: 'Closed' },
        { value: 'drain', label: 'Drain hole', title: 'A small hole: wet brushes drain' },
        { value: 'open', label: 'Open', title: 'Right through: brushes hang bristles down by the handle’s swell' },
      ],
    },
    { key: 'label', label: 'Label strip', kind: 'toggle', hint: 'Along the front, sloped to read from above.' },
    { key: 'wall', label: 'Wall', kind: 'length', min: 1.2, max: 4 },
  ],
});
