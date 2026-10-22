import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'receiver',
  label: 'Other systems’ accessories',
  description: 'A plate of Multiconnect, openConnect or Multipoint heads, so their accessories hang on this board.',
  group: 'adapters',
  fields: [
    {
      key: 'preset',
      label: 'System',
      kind: 'preset',
      presets: [
        { value: 'mc25', label: 'Multiconnect, Multiboard spacing (25 mm)', set: { system: 'multiconnect', pitch: 25 } },
        { value: 'mc28', label: 'Multiconnect, openGrid spacing (28 mm)', set: { system: 'multiconnect', pitch: 28 } },
        { value: 'oc', label: 'openConnect (openGrid, 28 mm)', set: { system: 'openconnect', pitch: 28 } },
        { value: 'mp', label: 'Multipoint (Multiboard, 25 mm)', set: { system: 'multipoint', pitch: 25 } },
      ],
      hint: 'The accessories have the slots; this plate has the heads they slide down onto.',
    },
    {
      key: 'system',
      label: 'Heads',
      kind: 'select',
      options: [
        { value: 'multiconnect', label: 'Multiconnect', title: 'Round, ⌀20, 4 mm out: the slot slides down over it' },
        { value: 'openconnect', label: 'openConnect', title: '17 × 10.6 mm, 2.6 mm out: push on 10.6 mm higher and drop' },
        { value: 'multipoint', label: 'Multipoint', title: 'Round, ⌀15.8, 3 mm out: a beta profile, try one head first' },
      ],
      hint: 'Multipoint’s profile isn’t published: this is the community’s beta one, so print a one-head plate first.',
    },
    { key: 'pitch', label: 'Spacing', kind: 'length', min: 20, max: 50, hint: 'Between heads, across and up: the accessories’ slot spacing.' },
    {
      key: 'columns',
      label: 'Heads across',
      kind: 'number',
      min: 1,
      max: 8,
      step: 1,
      suffix: '',
      hint: 'Only where the accessory has a slot: a head under its flat back holds it off.',
    },
    { key: 'rows', label: 'Rows', kind: 'number', min: 1, max: 4, step: 1, suffix: '' },
    { key: 'height', label: 'Plate height', kind: 'length', min: 20, max: 200, hint: 'At least what the heads and the clips need.' },
  ],
});
