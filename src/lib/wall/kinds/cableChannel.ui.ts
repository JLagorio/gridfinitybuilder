import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'cableChannel',
  label: 'Cable channel',
  description: 'A raceway along the board with a snap-on lid, open at both ends, with side exits if you like.',
  group: 'power',
  fields: [
    { key: 'length', label: 'Length', kind: 'length', min: 40, max: 400, hint: 'Clips go every 40 mm across the back.' },
    { key: 'width', label: 'Inside width', kind: 'length', min: 8, max: 80, hint: 'Out from the board.' },
    { key: 'height', label: 'Inside height', kind: 'length', min: 10, max: 60 },
    { key: 'lid', label: 'Snap-on lid', kind: 'toggle' },
    { key: 'exits', label: 'Side exits every', kind: 'length', min: 0, max: 400, hint: 'Notches in the front for cables to leave by; 0: none.' },
  ],
});
