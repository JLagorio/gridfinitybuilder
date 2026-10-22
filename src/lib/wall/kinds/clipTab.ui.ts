import { registerAttachmentUi } from '../uiRegistry';
import type { ClipTabOptions } from './clipTab';

registerAttachmentUi({
  type: 'clipTab',
  label: 'Clip tab',
  description: 'A tongue that belt and pen clips slide onto: tape measures, utility knives, flashlights, radios, pens.',
  group: 'tools',
  fields: [
    {
      key: 'preset',
      label: 'For',
      kind: 'preset',
      hint: 'Clips vary: the tongue wants to be about as wide as the clip.',
      presets: [
        { value: 'tape', label: 'Tape measure', set: { width: 32, thick: 4, length: 40, gap: 3, bump: 0.8, pitch: 90 } },
        { value: 'knife', label: 'Utility knife', set: { width: 25, thick: 4, length: 35, gap: 2.5, bump: 0.8, pitch: 50 } },
        { value: 'flashlight', label: 'Flashlight', set: { width: 22, thick: 3.5, length: 30, gap: 2.5, bump: 0.8, pitch: 45 } },
        { value: 'radio', label: 'Two-way radio', set: { width: 40, thick: 4, length: 50, gap: 3.5, bump: 1, pitch: 80 } },
        { value: 'pens', label: 'Pens', title: 'Their pocket clips', set: { width: 8, thick: 2, length: 25, gap: 1.5, bump: 0.5, pitch: 16 } },
      ],
    },
    { key: 'width', label: 'Tongue width', kind: 'length', min: 6, max: 60 },
    { key: 'thick', label: 'Tongue thickness', kind: 'length', min: 1.5, max: 8, hint: 'Like the belt the clip is made for: about 4 mm.' },
    { key: 'length', label: 'Tongue height', kind: 'length', min: 15, max: 80 },
    { key: 'gap', label: 'Gap behind', kind: 'length', min: 1, max: 8, hint: 'For the clip’s leaf, flared tip and all.' },
    { key: 'bump', label: 'Retaining bump', kind: 'length', min: 0, max: 2, hint: 'Halfway up the back of the tongue; 0 for none.' },
    { key: 'count', label: 'How many', kind: 'number', min: 1, max: 8, step: 1, suffix: '', hint: 'In a row.' },
    {
      key: 'pitch',
      label: 'Spacing',
      kind: 'length',
      min: 10,
      max: 150,
      hint: 'Centre to centre: wider than what hangs on them.',
      when: (o: ClipTabOptions) => o.count > 1,
    },
  ],
});
