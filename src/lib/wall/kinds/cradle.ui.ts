import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'cradle',
  label: 'Device holder',
  description: 'A pocket sized from the device: a power strip, phone, tablet, USB hub, router.',
  group: 'devices',
  fields: [
    {
      key: 'width',
      label: 'Device width',
      kind: 'length',
      min: 10,
      max: 300,
      hint: 'Left to right; 0.5 mm clearance is added each side. A phone is about 75, a tablet 250, a power strip 250–350.',
    },
    { key: 'depth', label: 'Device depth', kind: 'length', min: 4, max: 150, hint: 'Out from the board: a phone about 9, a USB hub 15, a router 30–40.' },
    { key: 'height', label: 'Pocket height', kind: 'length', min: 10, max: 200, hint: 'How much of it the walls cover: the device can stand taller.' },
    {
      key: 'front',
      label: 'Front',
      kind: 'select',
      options: [
        { value: 'open', label: 'Open', title: 'Only the corners hold it: sockets, ports and screen in reach' },
        { value: 'lip', label: 'Low lip' },
        { value: 'u', label: 'U cut-out', title: 'Full height with a U down the middle, for the screen, buttons or a cable' },
      ],
    },
    { key: 'cable', label: 'Cable hole in the floor', kind: 'toggle' },
    { key: 'notches', label: 'Cable notches in the sides', kind: 'toggle' },
    { key: 'wall', label: 'Wall', kind: 'length', min: 1.2, max: 5 },
  ],
});
