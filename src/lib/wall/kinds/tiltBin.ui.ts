import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'tiltBin',
  label: 'Tip-out bin',
  description: 'A bin in a frame that tips out on two pins to a stop, its top an arc; several stack in one frame.',
  group: 'storage',
  fields: [
    { key: 'width', label: 'Width', kind: 'length', min: 50, max: 300, hint: 'The frame, sides and all.' },
    { key: 'height', label: 'Height', kind: 'length', min: 40, max: 150, hint: 'Each bin.' },
    { key: 'depth', label: 'Depth', kind: 'length', min: 45, max: 160, hint: 'Out from the board. At most about as deep as it is tall.' },
    { key: 'angle', label: 'Tips out', kind: 'number', min: 30, max: 60, step: 5, suffix: '°', hint: 'Where it stops.' },
    { key: 'stack', label: 'Bins', kind: 'number', min: 1, max: 4, step: 1, suffix: '', hint: 'Stacked in one frame, 1 mm apart.' },
    { key: 'dividers', label: 'Dividers', kind: 'number', min: 0, max: 8, step: 1, suffix: '' },
    { key: 'label', label: 'Label slot on the front', kind: 'toggle', hint: 'Takes a card 12.5 mm high.' },
    { key: 'liftOff', label: 'Lift off', kind: 'toggle', hint: 'Closed, a bin lifts off its pins to carry it away.' },
  ],
});
