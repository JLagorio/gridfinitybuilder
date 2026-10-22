import { registerAttachmentUi } from '../uiRegistry';

const rack = (count: number, slot: number, height: number, width: number, tilt: number, lip: number, floor: 'solid' | 'drain', notch: boolean) => ({
  count,
  slot,
  height,
  width,
  tilt,
  lip,
  floor,
  notch,
});

registerAttachmentUi({
  type: 'slotRack',
  label: 'Slot rack',
  description: 'A vertical file for flat things on edge: build plates, laptops, tablets, cutting boards, lids, mail, rulers.',
  group: 'storage',
  fields: [
    {
      key: 'preset',
      label: 'For',
      kind: 'preset',
      presets: [
        {
          value: 'plates',
          label: 'Printer build plates',
          title: 'Spring steel sheets about 1 mm thick: a 3 mm slot each',
          set: rack(4, 3, 50, 120, 8, 50, 'solid', true),
        },
        {
          value: 'laptops',
          label: 'Laptops (12–22 mm)',
          title: 'A 24 mm slot each; heavy, so two slots and a wide back',
          set: rack(2, 24, 80, 160, 6, 80, 'solid', false),
        },
        { value: 'tablets', label: 'Tablets (7–10 mm)', set: rack(3, 12, 60, 120, 8, 60, 'solid', true) },
        { value: 'casedTablets', label: 'Tablets in cases (up to 13 mm)', set: rack(3, 15, 60, 120, 8, 60, 'solid', true) },
        {
          value: 'keyboards',
          label: 'Keyboards (up to 40 mm)',
          title: 'Measure yours at the back, keycaps on',
          set: rack(2, 42, 60, 160, 6, 40, 'solid', false),
        },
        {
          value: 'boards',
          label: 'Cutting boards (up to 28 mm)',
          title: 'Drain holes so a washed board dries',
          set: rack(3, 30, 70, 160, 8, 40, 'drain', false),
        },
        { value: 'lids', label: 'Pot lids (knobs up to 40 mm)', set: rack(3, 42, 70, 120, 10, 40, 'drain', false) },
        {
          value: 'mail',
          label: 'Mail and notebooks',
          title: 'DL envelopes (110 × 220) stand on their long edge, half showing',
          set: rack(3, 20, 60, 160, 12, 25, 'solid', false),
        },
        {
          value: 'rulers',
          label: 'Quilting rulers (3 mm acrylic)',
          title: 'Up to 6 × 24 in (152 × 610): a 5 mm slot each',
          set: rack(6, 5, 60, 120, 10, 60, 'solid', true),
        },
        {
          value: 'baseplates',
          label: 'LEGO baseplates',
          title: 'About 3.2 mm over the studs: a 5 mm slot each',
          set: rack(6, 5, 50, 160, 8, 50, 'solid', true),
        },
        {
          value: 'blades',
          label: 'Saw blades (up to 254 mm)',
          title: 'A 6 mm slot clears the set of the teeth',
          set: rack(5, 6, 50, 120, 8, 50, 'solid', true),
        },
        { value: 'sandpaper', label: 'Sandpaper sheets', title: 'A 10 mm stack of sheets in each slot', set: rack(4, 10, 60, 160, 10, 30, 'solid', false) },
      ],
      hint: 'Sizes vary: measure the thickest one you have and allow 2 mm or so.',
    },
    { key: 'count', label: 'Slots', kind: 'number', min: 1, max: 12, step: 1, suffix: '' },
    { key: 'slot', label: 'Slot width', kind: 'length', min: 2, max: 60, hint: 'What goes in each, plus a little: square to the dividers.' },
    { key: 'height', label: 'Divider height', kind: 'length', min: 15, max: 150 },
    { key: 'width', label: 'Width', kind: 'length', min: 30, max: 240, hint: 'Across the board: wider things stand in it and stick out either side.' },
    { key: 'tilt', label: 'Lean back', kind: 'number', min: 0, max: 25, step: 1, suffix: '°', hint: 'So each thing rests against the divider behind it.' },
    {
      key: 'lip',
      label: 'Front wall',
      kind: 'length',
      min: 5,
      max: 150,
      hint: 'Above the front slot’s floor: lower than the dividers shows off the front one.',
    },
    {
      key: 'floor',
      label: 'Floor',
      kind: 'select',
      options: [
        { value: 'solid', label: 'Solid' },
        { value: 'drain', label: 'Drain holes', title: 'Holes under the slots (6 mm and wider): for washed boards and lids' },
      ],
    },
    { key: 'notch', label: 'Finger notch', kind: 'toggle', hint: 'A U down the middle of the dividers, to pinch a thin plate.' },
  ],
});
