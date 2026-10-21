import { registerAttachmentUi } from '../uiRegistry';
import type { HookOptions } from './hook';

registerAttachmentUi({
  type: 'hook',
  label: 'Hook',
  description: 'J, L, U, double or peg hook, printed on its side for a strong arm.',
  group: 'hooks',
  fields: [
    {
      key: 'style',
      label: 'Style',
      kind: 'select',
      options: [
        { value: 'j', label: 'J', title: 'Arm with an upturned tip' },
        { value: 'l', label: 'L', title: 'Straight arm pointing up a little' },
        { value: 'u', label: 'U', title: 'A deep cradle for cables, hoses, cords' },
        { value: 'double', label: 'Double', title: 'Two J arms, one above the other' },
        { value: 'peg', label: 'Peg', title: 'A short peg with a knob' },
      ],
    },
    { key: 'reach', label: 'Reach', kind: 'length', min: 15, max: 250, hint: 'Out from the board.' },
    { key: 'width', label: 'Width', kind: 'length', min: 5, max: 40 },
    { key: 'arm', label: 'Arm thickness', kind: 'length', min: 3, max: 20 },
    { key: 'tip', label: 'Tip height', kind: 'length', min: 3, max: 80, when: (o: HookOptions) => o.style === 'j' || o.style === 'u' || o.style === 'double' },
    { key: 'angle', label: 'Angle', kind: 'number', min: 0, max: 60, step: 1, suffix: '°', when: (o: HookOptions) => o.style === 'l' || o.style === 'peg' },
    { key: 'spacing', label: 'Arm spacing', kind: 'length', min: 12, max: 120, when: (o: HookOptions) => o.style === 'double' },
  ],
});
