import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'cabinet',
  label: 'Cabinet',
  description: 'A small cupboard with a hinged door, shelves, a magnet catch and a window if you like.',
  group: 'storage',
  fields: [
    { key: 'width', label: 'Width', kind: 'length', min: 60, max: 250, hint: 'Clips go every 40 mm across the back.' },
    { key: 'height', label: 'Height', kind: 'length', min: 60, max: 250 },
    { key: 'depth', label: 'Depth', kind: 'length', min: 40, max: 200, hint: 'Out from the board, door and all.' },
    { key: 'shelves', label: 'Shelves', kind: 'number', min: 0, max: 4, step: 1, suffix: '', hint: 'Evenly spaced; they slide in on ledges.' },
    {
      key: 'door',
      label: 'Hinge',
      kind: 'select',
      options: [
        { value: 'left', label: 'Left', title: 'The door opens to the left' },
        { value: 'right', label: 'Right', title: 'The door opens to the right' },
      ],
    },
    { key: 'magnets', label: 'Magnet catch', kind: 'toggle', hint: 'Two 6 × 2 mm magnets hold the door shut.' },
    { key: 'window', label: 'Window', kind: 'toggle', hint: 'An opening in the door, with a rebate behind it for a clear sheet.' },
    {
      key: 'pin',
      label: 'Hinge pin',
      kind: 'select',
      options: [
        { value: 'printed', label: 'Printed', title: 'Prints with it, lying down' },
        { value: 'steel', label: 'Steel ⌀3', title: 'A 3 mm rod or a nail, cut to length' },
      ],
    },
    { key: 'wall', label: 'Wall', kind: 'length', min: 1.6, max: 4 },
  ],
});
