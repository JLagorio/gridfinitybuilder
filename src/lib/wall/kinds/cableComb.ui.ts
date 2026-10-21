import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'cableComb',
  label: 'Cable comb',
  description: 'Keeps cables running up and down the board apart: each clicks into its own slot.',
  group: 'power',
  fields: [
    { key: 'count', label: 'Cables', kind: 'number', min: 1, max: 16, step: 1, suffix: '' },
    { key: 'diameter', label: 'Cable diameter', kind: 'length', min: 2, max: 25 },
    { key: 'gap', label: 'Gap between', kind: 'length', min: 3, max: 30 },
  ],
});
