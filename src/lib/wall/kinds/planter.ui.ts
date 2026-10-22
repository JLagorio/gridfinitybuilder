import { registerAttachmentUi } from '../uiRegistry';
import type { PlanterOptions } from './planter';

const pot = (o: PlanterOptions) => o.mode === 'pot';
const tubes = (o: PlanterOptions) => o.mode === 'tubes';

registerAttachmentUi({
  type: 'planter',
  label: 'Planter',
  description: 'A pot holder whose saucer twists or slides out to empty, or test tubes for cuttings. Print it in PETG.',
  group: 'other',
  fields: [
    {
      key: 'preset',
      label: 'For',
      kind: 'preset',
      presets: [
        { value: 'p2', label: '2 in nursery pot', title: 'About 50 mm across the rim', set: { mode: 'pot', shape: 'round', size: 52, potH: 50 } },
        { value: 'p3', label: '3 in nursery pot', title: 'About 75 mm across the rim', set: { mode: 'pot', shape: 'round', size: 77, potH: 70 } },
        { value: 'p4', label: '4 in nursery pot', title: 'About 100 mm across the rim', set: { mode: 'pot', shape: 'round', size: 102, potH: 90 } },
        { value: 'sq85', label: 'Square pot 85 × 85 × 104', set: { mode: 'pot', shape: 'square', size: 85, potH: 104 } },
        { value: 't16', label: 'Test tubes ⌀16 × 150', title: 'For cuttings to root in water', set: { mode: 'tubes', tube: 16, tubeLen: 150, count: 6 } },
        { value: 't20', label: 'Test tubes ⌀20 × 150', set: { mode: 'tubes', tube: 20, tubeLen: 150, count: 5 } },
        { value: 't25', label: 'Test tubes ⌀25 × 150', set: { mode: 'tubes', tube: 25, tubeLen: 150, count: 4 } },
      ],
      hint: 'Pots vary: measure across the rim and the height of yours.',
    },
    {
      key: 'mode',
      label: 'Holds',
      kind: 'select',
      options: [
        { value: 'pot', label: 'A pot', title: 'Its rim rests on the sleeve; a saucer under it catches the drips' },
        { value: 'tubes', label: 'Test tubes', title: 'A row of them, for cuttings' },
      ],
    },
    {
      key: 'shape',
      label: 'Pot',
      kind: 'select',
      options: [
        { value: 'round', label: 'Round', title: 'The saucer twists in from below' },
        { value: 'square', label: 'Square', title: 'The saucer is a tray that slides in from the front' },
      ],
      when: pot,
    },
    { key: 'size', label: 'Across the rim', kind: 'length', min: 40, max: 160, hint: 'The sleeve is 5 mm narrower, so the rim rests on it.', when: pot },
    { key: 'potH', label: 'Pot height', kind: 'length', min: 30, max: 200, hint: 'So it hangs clear of the saucer.', when: pot },
    { key: 'tube', label: 'Tube diameter', kind: 'length', min: 10, max: 32, when: tubes },
    {
      key: 'tubeLen',
      label: 'Tube length',
      kind: 'length',
      min: 60,
      max: 200,
      hint: 'They stand in cups at the foot, through a ledge about halfway up.',
      when: tubes,
    },
    { key: 'count', label: 'Tubes', kind: 'number', min: 1, max: 12, step: 1, suffix: '', when: tubes },
  ],
});
