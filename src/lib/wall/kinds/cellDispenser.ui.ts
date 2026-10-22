import { registerAttachmentUi } from '../uiRegistry';
import type { CellDispenserOptions } from './cellDispenser';

const round = (o: CellDispenserOptions) => o.shape === 'round';
const coin = (o: CellDispenserOptions) => o.shape === 'coin';
const block = (o: CellDispenserOptions) => o.shape === 'block';

registerAttachmentUi({
  type: 'cellDispenser',
  label: 'Battery dispenser',
  description: 'Cells drop down a chute and come out at the bottom one at a time: AA to D, 9V, 18650, coin cells.',
  group: 'storage',
  fields: [
    {
      key: 'preset',
      label: 'Cells',
      kind: 'preset',
      hint: 'Sizes vary a little by make: measure yours if they come out tight.',
      presets: [
        { value: 'aa', label: 'AA (⌀14.5 × 50.5)', set: { shape: 'round', diameter: 14.5, length: 50.5 } },
        { value: 'aaa', label: 'AAA (⌀10.5 × 44.5)', set: { shape: 'round', diameter: 10.5, length: 44.5 } },
        { value: 'c', label: 'C (⌀26.2 × 50)', set: { shape: 'round', diameter: 26.2, length: 50 } },
        { value: 'd', label: 'D (⌀34.2 × 61.5)', set: { shape: 'round', diameter: 34.2, length: 61.5, capacity: 6 } },
        { value: '9v', label: '9V (26.5 × 17.5 × 48.5, flat)', set: { shape: 'block', diameter: 26.5, length: 48.5, thick: 17.5 } },
        { value: '18650', label: '18650 (⌀18.5 × 65)', set: { shape: 'round', diameter: 18.5, length: 65 } },
        {
          value: '18650p',
          label: '18650, protected (⌀18.5 × 69)',
          title: 'Protected cells are up to 4 mm longer',
          set: { shape: 'round', diameter: 18.5, length: 69 },
        },
        { value: '21700', label: '21700 (⌀21 × 70)', set: { shape: 'round', diameter: 21, length: 70 } },
        { value: 'cr2032', label: 'CR2032 coin (⌀20 × 3.2)', set: { shape: 'coin', diameter: 20, thick: 3.2 } },
        { value: 'cr2025', label: 'CR2025 coin (⌀20 × 2.5)', set: { shape: 'coin', diameter: 20, thick: 2.5 } },
        { value: 'cr2016', label: 'CR2016 coin (⌀20 × 1.6)', set: { shape: 'coin', diameter: 20, thick: 1.6 } },
        { value: 'lr44', label: 'LR44 button (⌀11.6 × 5.4)', set: { shape: 'coin', diameter: 11.6, thick: 5.4 } },
      ],
    },
    {
      key: 'shape',
      label: 'Cells lie',
      kind: 'select',
      options: [
        { value: 'round', label: 'Round', title: 'On their side, across the chute: they roll out' },
        { value: 'coin', label: 'Coins', title: 'Flat in a stack: slide the bottom one out' },
        { value: 'block', label: 'Blocks', title: 'Flat in a stack, like 9V: slide the bottom one out' },
      ],
    },
    { key: 'diameter', label: 'Diameter', kind: 'length', min: 5, max: 60, when: (o: CellDispenserOptions) => !block(o) },
    { key: 'diameter', label: 'Depth', kind: 'length', min: 5, max: 60, hint: 'Front to back, lying flat.', when: block },
    {
      key: 'length',
      label: 'Length',
      kind: 'length',
      min: 5,
      max: 120,
      hint: 'Left to right in the chute.',
      when: (o: CellDispenserOptions) => round(o) || block(o),
    },
    { key: 'thick', label: 'Thickness', kind: 'length', min: 1, max: 40, when: (o: CellDispenserOptions) => coin(o) || block(o) },
    { key: 'columns', label: 'Columns', kind: 'number', min: 1, max: 8, step: 1, suffix: '' },
    { key: 'capacity', label: 'Cells per column', kind: 'number', min: 2, max: 60, step: 1, suffix: '', hint: 'Sets the height: load them from the top.' },
    {
      key: 'clearance',
      label: 'Clearance',
      kind: 'length',
      min: 0,
      max: 3,
      hint: 'Added to the diameter, twice to the length. Under 0.5 mm cells tend to jam.',
    },
    { key: 'window', label: 'Window', kind: 'length', min: 0, max: 20, hint: 'A slot down the front to see how many are left; 0 for none.' },
  ],
});
