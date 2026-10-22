import type { AttachmentPreset } from '../registry';
import { registerAttachmentUi } from '../uiRegistry';
import type { GripperOptions } from './gripper';

const p = (value: string, label: string, diameter: number, title?: string): AttachmentPreset => ({
  value,
  label,
  ...(title ? { title } : {}),
  set: { diameter },
});

registerAttachmentUi({
  type: 'gripper',
  label: 'Handle gripper',
  description: 'C-clips round things snap into: broom, mop and rake handles, flashlights, tubes, a bike pump.',
  group: 'tools',
  fields: [
    {
      key: 'preset',
      label: 'For',
      kind: 'preset',
      hint: 'Handles vary: measure yours. PETG springs back best.',
      presets: [
        p('broom22', 'Broom or mop handle ⌀22', 22),
        p('broom24', 'Broom or mop handle ⌀24', 24),
        p('broom25', 'Broom handle ⌀25', 25),
        p('rake28', 'Rake or shovel handle ⌀28', 28),
        p('flashlight', 'Flashlight ⌀25', 25.4, 'An AA or 18650 light; measure yours'),
        p('maglite', 'Large flashlight ⌀38 (D cell)', 38.5),
        p('pump', 'Bike pump ⌀30', 30, 'Floor pumps are often 38–40: measure yours'),
        p('marker', 'Marker ⌀15', 15),
        p('tube32', 'Tube or pipe ⌀32', 32),
      ],
    },
    { key: 'diameter', label: 'Diameter', kind: 'length', min: 4, max: 100, hint: 'Of the item: the clip is 0.1 mm bigger all round.' },
    {
      key: 'axis',
      label: 'Holds it',
      kind: 'select',
      options: [
        { value: 'vertical', label: 'Upright', title: 'Standing up: brooms, mops' },
        { value: 'horizontal', label: 'Lying across', title: 'Across the board: a pump, a flashlight, a tube' },
      ],
    },
    {
      key: 'wrap',
      label: 'Wrap',
      kind: 'number',
      min: 180,
      max: 260,
      step: 5,
      suffix: '°',
      hint: 'How far round it goes: 240° snaps shut with a mouth about 87% as wide.',
    },
    { key: 'arm', label: 'Arm thickness', kind: 'length', min: 1.2, max: 8, hint: 'Thinner springs open more easily.' },
    { key: 'ribs', label: 'Grip ribs', kind: 'toggle', hint: 'Ribs inside, so a handle doesn’t slide down.' },
    { key: 'length', label: 'Length', kind: 'length', min: 6, max: 100, hint: 'Along the item.' },
    { key: 'count', label: 'How many', kind: 'number', min: 1, max: 10, step: 1, suffix: '' },
    { key: 'pitch', label: 'Centre to centre', kind: 'length', min: 10, max: 300, when: (o: GripperOptions) => o.count > 1 },
  ],
});
