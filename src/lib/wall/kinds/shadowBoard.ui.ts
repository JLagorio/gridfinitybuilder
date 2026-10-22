import { registerAttachmentUi } from '../uiRegistry';
import type { ShadowBoardOptions } from './shadowBoard';

registerAttachmentUi({
  type: 'shadowBoard',
  label: 'Shadow board',
  description: 'Your tools’ outlines, traced from a photo or imported, cut into a plate that clips on: you see what’s missing.',
  group: 'tools',
  fields: [
    {
      key: 'tools',
      label: 'Tools',
      kind: 'outlines',
      max: 12,
      hold: true,
      hint: 'Lay a tool on a sheet of paper and photograph it from straight above, or import its outline. Pegs suit most tools, a ledge narrow ones (they drop in from above), magnets flat steel ones.',
    },
    {
      key: 'arrange',
      label: 'Lay them out',
      kind: 'select',
      options: [
        { value: 'upright', label: 'Standing up', title: 'In rows, the heavier end at the top, as tools hang' },
        { value: 'across', label: 'Lying across', title: 'In rows, their long side across' },
        { value: 'keep', label: 'As in the file', title: 'Where they were in the photo or the file' },
      ],
    },
    {
      key: 'width',
      label: 'Width',
      kind: 'length',
      min: 40,
      max: 400,
      hint: 'Tools go in rows this wide; the board grows to fit them. Clips go every 40 mm across the back.',
    },
    { key: 'height', label: 'Height', kind: 'length', min: 0, max: 400, allowEmpty: true, hint: 'Empty: as tall as the tools need.' },
    { key: 'gap', label: 'Room between tools', kind: 'length', min: 2, max: 60, when: (o: ShadowBoardOptions) => o.arrange !== 'keep' },
    {
      key: 'pocket',
      label: 'Shadow depth',
      kind: 'length',
      min: 0.4,
      max: 3,
      hint: 'How deep each outline is cut. Its top edge slopes back at 45°, so it prints upright without support.',
    },
    { key: 'thick', label: 'Thickness', kind: 'length', min: 3, max: 10, hint: 'It gets thicker where magnets need it.' },
    {
      key: 'magnet',
      label: 'Magnets',
      kind: 'select',
      options: [
        { value: '6x2', label: '6 × 2' },
        { value: '8x2', label: '8 × 2' },
        { value: '8x3', label: '8 × 3' },
        { value: '10x3', label: '10 × 3' },
      ],
      hint: 'Two in each tool’s shadow, glued in.',
      when: (o: ShadowBoardOptions) => o.tools.some((t) => t.hold === 'magnets'),
    },
    { key: 'notches', label: 'Finger notches', kind: 'toggle', hint: 'Beside each tool, to get a finger behind it.' },
    { key: 'names', label: 'Names under the tools', kind: 'toggle' },
    {
      key: 'fill',
      label: 'Shadows in a second colour',
      kind: 'toggle',
      hint: 'Each outline filled flush in another filament (the tool shadows’ colour with multi-colour on): it shows when the tool’s out.',
    },
  ],
});
