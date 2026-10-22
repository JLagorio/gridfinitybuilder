import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'pegboardBridge',
  label: '1″ pegboard plate',
  description: 'A pegboard face with 1/4″ holes on a 1″ grid, for metal pegboard hooks and locking hooks.',
  group: 'adapters',
  fields: [
    { key: 'columns', label: 'Holes across', kind: 'number', min: 2, max: 12, step: 1, suffix: '', hint: '25.4 mm apart (1″), whatever the board’s spacing.' },
    { key: 'rows', label: 'Rows', kind: 'number', min: 1, max: 10, step: 1, suffix: '' },
    {
      key: 'cavity',
      label: 'Room behind the face',
      kind: 'length',
      min: 4,
      max: 25,
      hint: 'For the hooks’ tails, which turn up behind the face: 8 mm takes most.',
    },
  ],
});
