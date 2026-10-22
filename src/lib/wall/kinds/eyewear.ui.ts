import { registerAttachmentUi } from '../uiRegistry';
import type { EyewearOptions } from './eyewear';

const armed = (o: EyewearOptions) => o.style !== 'temple';

registerAttachmentUi({
  type: 'eyewear',
  label: 'Glasses rest',
  description: 'Glasses hang folded by the bridge on a nose, or by one temple in a slot; goggles by the strap. One to four pairs.',
  group: 'hooks',
  fields: [
    {
      key: 'preset',
      label: 'For',
      kind: 'preset',
      presets: [
        { value: 'sunglasses', label: 'Sunglasses', set: { style: 'bridge', reach: 50, spacing: 60, width: 24, tip: 10, angle: 10 } },
        { value: 'reading', label: 'Reading glasses', set: { style: 'bridge', reach: 45, spacing: 50, width: 22, tip: 9, angle: 10 } },
        {
          value: 'safety',
          label: 'Wraparound safety glasses',
          title: 'Deeper when folded',
          set: { style: 'bridge', reach: 65, spacing: 65, width: 28, tip: 12, angle: 10 },
        },
        {
          value: 'pocket',
          label: 'Any glasses, by one temple',
          title: 'Like hanging them from a shirt pocket',
          set: { style: 'temple', spacing: 60, tip: 25, slot: 5 },
        },
        { value: 'goggles', label: 'Goggles, by the strap', set: { style: 'strap', reach: 60, spacing: 90, width: 45, tip: 10, angle: 5 } },
      ],
    },
    {
      key: 'style',
      label: 'Hang by',
      kind: 'select',
      options: [
        { value: 'bridge', label: 'Bridge', title: 'Folded, the nose pads on a nose at the end of the arm' },
        { value: 'temple', label: 'Temple', title: 'One folded temple in a slot, the glasses in front of it' },
        { value: 'strap', label: 'Strap', title: 'Goggles over a wide arm with a lip' },
      ],
    },
    { key: 'pairs', label: 'Pairs', kind: 'number', min: 1, max: 4, step: 1, suffix: '', hint: 'One above the other.' },
    { key: 'spacing', label: 'Spacing', kind: 'length', min: 30, max: 150, hint: 'One arm above the next: more than the glasses are tall.' },
    { key: 'reach', label: 'Reach', kind: 'length', min: 25, max: 120, hint: 'Out from the board: more than the folded glasses are thick.', when: armed },
    { key: 'width', label: 'Width', kind: 'length', min: 14, max: 60, hint: 'Across; the nose’s sides slope at 45° from its crest.' },
    {
      key: 'tip',
      label: 'Nose / lip height',
      kind: 'length',
      min: 4,
      max: 40,
      hint: 'Above the arm; for a temple, how deep the slot is.',
    },
    { key: 'angle', label: 'Angle', kind: 'number', min: 0, max: 30, step: 1, suffix: '°', hint: 'The arms point up this much.', when: armed },
    { key: 'slot', label: 'Slot width', kind: 'length', min: 2, max: 10, hint: 'A temple is 2–4 mm thick.', when: (o: EyewearOptions) => o.style === 'temple' },
  ],
});
