import { registerAttachmentUi } from '../uiRegistry';
import type { FoldHookOptions } from './foldHook';

registerAttachmentUi({
  type: 'foldHook',
  label: 'Folding hook',
  description: 'A hook, or a cup holder, that folds up flat against the board and clicks open and shut.',
  group: 'hooks',
  fields: [
    {
      key: 'style',
      label: 'Style',
      kind: 'select',
      options: [
        { value: 'hook', label: 'Hook', title: 'A J hook' },
        { value: 'cup', label: 'Cup holder', title: 'A ring with a floor, for a mug or a can' },
      ],
    },
    { key: 'reach', label: 'Reach', kind: 'length', min: 30, max: 150, hint: 'Out from the board, open.', when: (o: FoldHookOptions) => o.style === 'hook' },
    { key: 'tip', label: 'Tip', kind: 'length', min: 5, max: 30, when: (o: FoldHookOptions) => o.style === 'hook' },
    { key: 'arm', label: 'Arm', kind: 'length', min: 6, max: 12, hint: 'Top to bottom.', when: (o: FoldHookOptions) => o.style === 'hook' },
    {
      key: 'cupPreset',
      label: 'Fits',
      kind: 'preset',
      presets: [
        { value: 'can', label: 'Drinks can, 330 ml (⌀66)', set: { cup: 67 } },
        { value: 'mug', label: 'Mug (⌀80–85, measure yours)', set: { cup: 86 } },
        { value: 'bottle', label: 'Bottle, 500 ml (⌀65–75, measure yours)', set: { cup: 76 } },
        { value: 'spray', label: 'Spray can (⌀66)', set: { cup: 68 } },
      ],
      when: (o: FoldHookOptions) => o.style === 'cup',
    },
    {
      key: 'cup',
      label: 'Inside ⌀',
      kind: 'length',
      min: 40,
      max: 110,
      hint: 'What it holds, plus a little.',
      when: (o: FoldHookOptions) => o.style === 'cup',
    },
    { key: 'width', label: 'Arm width', kind: 'length', min: 8, max: 30 },
    {
      key: 'pin',
      label: 'Pin',
      kind: 'select',
      options: [
        { value: 'printed', label: 'Printed', title: 'Prints with it, lying down' },
        { value: 'steel', label: 'Steel ⌀3', title: 'A 3 mm rod or a nail, cut to length' },
      ],
    },
  ],
});
