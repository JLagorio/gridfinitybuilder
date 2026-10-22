import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'bin',
  label: 'Bin',
  description: 'An open box with a low front and dividers, for parts, pens, bits.',
  group: 'storage',
  fields: [
    { key: 'width', label: 'Width', kind: 'length', min: 20, max: 400, hint: 'Clips go every 40 mm across the back.' },
    { key: 'height', label: 'Height', kind: 'length', min: 25, max: 250 },
    { key: 'depth', label: 'Depth', kind: 'length', min: 15, max: 200, hint: 'Out from the board.' },
    { key: 'front', label: 'Front height', kind: 'number', min: 20, max: 100, step: 5, suffix: '%', hint: 'Of the back: lower to reach in.' },
    { key: 'dividers', label: 'Dividers', kind: 'number', min: 0, max: 12, step: 1, suffix: '' },
    { key: 'label', label: 'Label ledge on the front', kind: 'toggle' },
    { key: 'wall', label: 'Wall', kind: 'length', min: 0.8, max: 4 },
    { key: 'floor', label: 'Floor', kind: 'length', min: 0.8, max: 5 },
  ],
});
