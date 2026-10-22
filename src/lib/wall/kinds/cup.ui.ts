import { registerAttachmentUi } from '../uiRegistry';
import type { CupOptions } from './cup';

registerAttachmentUi({
  type: 'cup',
  label: 'Cup or ring',
  description: 'Round holders in a row: pens, brushes, cans; open rings for tools that hang through.',
  group: 'storage',
  fields: [
    {
      key: 'size',
      label: 'For',
      kind: 'preset',
      presets: [
        { value: 'spray', label: 'Spray can (⌀65–66)', set: { diameter: 68, height: 60, bottom: 'closed' } },
        { value: 'wd40', label: 'WD-40 can (⌀53.5)', set: { diameter: 55, height: 60, bottom: 'closed' } },
        { value: 'tipCleaner', label: 'Soldering tip cleaner (⌀55)', set: { diameter: 56, height: 35, bottom: 'closed' } },
        { value: 'pens', label: 'Pens and brushes', set: { diameter: 60, height: 90, bottom: 'closed' } },
      ],
      hint: 'Typical sizes, a little clearance added: measure yours.',
    },
    { key: 'diameter', label: 'Inside diameter', kind: 'length', min: 6, max: 200 },
    { key: 'height', label: 'Height', kind: 'length', min: 10, max: 250 },
    { key: 'count', label: 'How many', kind: 'number', min: 1, max: 12, step: 1, suffix: '' },
    { key: 'gap', label: 'Gap between', kind: 'length', min: 0, max: 40, when: (o: CupOptions) => o.count > 1 },
    {
      key: 'bottom',
      label: 'Bottom',
      kind: 'select',
      options: [
        { value: 'closed', label: 'Cup' },
        { value: 'open', label: 'Ring', title: 'No bottom: a holder things hang through' },
      ],
    },
    { key: 'wall', label: 'Wall', kind: 'length', min: 0.8, max: 5 },
  ],
});
