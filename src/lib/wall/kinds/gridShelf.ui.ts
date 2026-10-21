import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'gridShelf',
  label: 'Gridfinity shelf',
  description: 'A shelf of baseplate receptacles for Gridfinity bins, with cheeks and a lip so it doesn’t sag.',
  group: 'gridfinity',
  fields: [
    { key: 'cellsX', label: 'Cells wide', kind: 'number', min: 1, max: 10, step: 1, suffix: '', hint: '42 mm each, and a 3 mm cheek at each end.' },
    { key: 'cellsY', label: 'Cells deep', kind: 'number', min: 1, max: 4, step: 1, suffix: '', hint: 'Out from the board.' },
    {
      key: 'tilt',
      label: 'Tilt',
      kind: 'select',
      options: [
        { value: '0', label: 'Flat' },
        { value: '15', label: '15°', title: 'Bins lean out a little so you can see in' },
        { value: '30', label: '30°', title: 'Bins lean out so you can see in from above' },
      ],
    },
    { key: 'lip', label: 'Front lip', kind: 'length', min: 0, max: 40, hint: 'Above the receptacles: it keeps bins on a tilted shelf.' },
    { key: 'back', label: 'Back plate height', kind: 'length', min: 20, max: 250, hint: 'Taller: more studs, and less pull on the clips.' },
    { key: 'magnets', label: 'Magnet pockets', kind: 'toggle', hint: '6 × 2 mm, four a cell, for bins with magnets.' },
  ],
});
