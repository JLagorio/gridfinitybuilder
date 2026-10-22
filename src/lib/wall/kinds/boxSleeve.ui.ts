import { registerAttachmentUi } from '../uiRegistry';
import type { BoxSleeveOptions } from './boxSleeve';

const framed = (o: BoxSleeveOptions) => o.open !== 'top';

registerAttachmentUi({
  type: 'boxSleeve',
  label: 'Box sleeve',
  description: 'Holds a box or a roll you pull from: gloves, tissues, foil and film, zip bags, sticky notes, index cards.',
  group: 'kitchen',
  fields: [
    {
      key: 'preset',
      label: 'Holds',
      kind: 'preset',
      hint: 'Boxes vary by make: measure yours. 1 mm clearance is added all round.',
      presets: [
        {
          value: 'glovesUp',
          label: 'Glove box on end, slot to the front (125 × 65 × 240)',
          title: 'Narrow enough for a 256 mm bed',
          set: { width: 125, depth: 65, height: 240, open: 'front', rim: 12 },
        },
        {
          value: 'gloves',
          label: 'Glove box lying, slot to the front (240 × 65 × 125)',
          title: '246 mm wide: a bed of 256 mm with small margins, or bigger',
          set: { width: 240, depth: 65, height: 125, open: 'front', rim: 12 },
        },
        {
          value: 'glovesDown',
          label: 'Glove box, slot down (240 × 125 × 65)',
          set: { width: 240, depth: 125, height: 65, open: 'bottom', rim: 12, slot: 45, cutter: false },
        },
        {
          value: 'tissues',
          label: 'Tissue box, from below (240 × 120 × 90)',
          set: { width: 240, depth: 120, height: 90, open: 'bottom', rim: 12, slot: 45, cutter: false },
        },
        {
          value: 'tissueCube',
          label: 'Tissue cube, from below (115 × 115 × 125)',
          set: { width: 115, depth: 115, height: 125, open: 'bottom', rim: 10, slot: 45, cutter: false },
        },
        {
          value: 'roll',
          label: 'Foil or film roll, 30 cm (305 × ⌀50)',
          title: '311 mm wide: for a big printer. The sheet comes out through the floor and tears on the teeth',
          set: { width: 305, depth: 52, height: 52, open: 'bottom', rim: 6, slot: 16, cutter: true },
        },
        { value: 'zip', label: 'Zip bag box, slot to the front (190 × 60 × 100)', set: { width: 190, depth: 60, height: 100, open: 'front', rim: 10 } },
        { value: 'notes', label: 'Sticky notes 76 × 76', set: { width: 77, depth: 20, height: 77, open: 'front', rim: 5 } },
        { value: 'cards35', label: 'Index cards 3 × 5″, on edge', set: { width: 128, depth: 40, height: 55, open: 'top', front: 40 } },
        { value: 'cards46', label: 'Index cards 4 × 6″, on edge', set: { width: 153, depth: 40, height: 75, open: 'top', front: 40 } },
      ],
    },
    { key: 'width', label: 'Box width', kind: 'length', min: 20, max: 320, hint: 'Left to right.' },
    { key: 'depth', label: 'Box depth', kind: 'length', min: 5, max: 200, hint: 'Out from the board.' },
    { key: 'height', label: 'Height', kind: 'length', min: 10, max: 250, hint: 'The box’s height, or less to leave its top out.' },
    {
      key: 'open',
      label: 'Take from',
      kind: 'select',
      options: [
        { value: 'front', label: 'Front', title: 'A frame round the box’s face: pull from its slot' },
        { value: 'top', label: 'Top', title: 'A low front with a thumb notch: lift things out' },
        { value: 'bottom', label: 'Bottom', title: 'A slot through the floor: tissues, gloves, a roll’s sheet' },
      ],
    },
    { key: 'rim', label: 'Frame width', kind: 'length', min: 3, max: 40, hint: 'Round the opening at the front.', when: framed },
    { key: 'front', label: 'Front height', kind: 'number', min: 10, max: 100, step: 5, suffix: '%', when: (o: BoxSleeveOptions) => o.open === 'top' },
    {
      key: 'slot',
      label: 'Floor slot',
      kind: 'length',
      min: 5,
      max: 100,
      hint: 'Front to back, across the middle.',
      when: (o: BoxSleeveOptions) => o.open === 'bottom',
    },
    {
      key: 'cutter',
      label: 'Teeth to tear on',
      kind: 'toggle',
      hint: 'Along the slot’s front edge: pull the sheet down and forward.',
      when: (o: BoxSleeveOptions) => o.open === 'bottom',
    },
    { key: 'wall', label: 'Wall', kind: 'length', min: 1.2, max: 5 },
  ],
});
