import { registerAttachmentUi } from '../uiRegistry';
import type { ClampRackOptions } from './clampRack';

registerAttachmentUi({
  type: 'clampRack',
  label: 'Clamp rack',
  description: 'A comb of slots for F-clamp and bar-clamp bars, and a rail for spring clamps.',
  group: 'tools',
  fields: [
    {
      key: 'preset',
      label: 'Clamps',
      kind: 'preset',
      hint: 'Bars vary from maker to maker: measure yours.',
      presets: [
        { value: 'smallF', label: 'Small F-clamps (bar 20 × 6)', set: { barW: 20, barT: 6, pitch: 45 } },
        { value: 'mediumF', label: 'Medium F-clamps (bar 25 × 8)', set: { barW: 25, barT: 8, pitch: 55 } },
        { value: 'quick', label: 'Quick-release bar clamps (bar 15 × 5)', set: { barW: 15, barT: 5, pitch: 50 } },
      ],
    },
    { key: 'count', label: 'Bar clamps', kind: 'number', min: 1, max: 12, step: 1, suffix: '' },
    { key: 'barW', label: 'Bar width', kind: 'length', min: 8, max: 50, hint: 'The wide side of the bar.' },
    { key: 'barT', label: 'Bar thickness', kind: 'length', min: 3, max: 20 },
    { key: 'pitch', label: 'Spacing', kind: 'length', min: 25, max: 150, hint: 'Centre to centre: wider than the handles.' },
    { key: 'depth', label: 'Depth', kind: 'length', min: 40, max: 200, hint: 'Out from the board: the fixed jaw rests on it, pointing at the board.' },
    { key: 'springs', label: 'Spring clamp rail', kind: 'length', min: 0, max: 300, hint: 'Its length; 0 for none.' },
    {
      key: 'edge',
      label: 'Rail thickness',
      kind: 'length',
      min: 6,
      max: 25,
      hint: 'What the spring clamps grip: 10–15 mm suits most.',
      when: (o: ClampRackOptions) => o.springs > 0,
    },
    { key: 'clearance', label: 'Clearance', kind: 'length', min: 0.3, max: 3, hint: 'Added each side of the bar.' },
    { key: 'height', label: 'Back height', kind: 'length', min: 40, max: 200, hint: 'Clamps are heavy: from about 96 mm, two rows of studs.' },
  ],
});
