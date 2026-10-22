import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'dinRail',
  label: 'DIN rail',
  description: 'A length of 35 mm top-hat rail for breakers, relays, terminals and power supplies.',
  group: 'adapters',
  fields: [
    { key: 'length', label: 'Length', kind: 'length', min: 40, max: 250, hint: 'About 18 mm a module. It prints standing on its end.' },
    {
      key: 'depth',
      label: 'Depth',
      kind: 'select',
      options: [
        { value: '7.5', label: '7.5 mm', title: 'The usual rail' },
        { value: '15', label: '15 mm', title: 'The deep rail: more room behind the modules' },
      ],
      hint: 'The flanges are 1.5 mm thick, as on the deep steel rail, for strength.',
    },
    { key: 'stops', label: 'End stops', kind: 'toggle', hint: 'Keep the modules from sliding off the ends.' },
  ],
});
