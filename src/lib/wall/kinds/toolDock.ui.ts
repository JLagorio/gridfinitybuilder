import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'toolDock',
  label: 'Drill dock',
  description: 'An open fork that holds a cordless drill, driver or impact driver by its head, the battery on.',
  group: 'tools',
  fields: [
    {
      key: 'tool',
      label: 'Tool',
      kind: 'preset',
      presets: [
        { value: 'drill', label: 'Drill/driver', set: { gap: 56, reach: 110, setback: 55, battery: 'down' } },
        { value: 'impact', label: 'Impact driver', set: { gap: 50, reach: 100, setback: 50, battery: 'down' } },
        { value: 'hammer', label: 'Hammer drill (a bigger head)', set: { gap: 60, reach: 130, setback: 60, battery: 'down' } },
        { value: 'up', label: 'Drill, battery up (the head hangs below)', set: { gap: 56, reach: 130, setback: 70, battery: 'up' } },
      ],
      hint: 'Typical sizes: measure your handle just under the head. Print it in PETG: PLA creeps under a tool’s weight.',
    },
    { key: 'count', label: 'Tools', kind: 'number', min: 1, max: 3, step: 1, suffix: '' },
    { key: 'gap', label: 'Fork gap', kind: 'length', min: 30, max: 90, hint: 'The handle’s width just under the head, and a few mm: 55–58 for most drills.' },
    { key: 'reach', label: 'Fork depth', kind: 'length', min: 60, max: 200, hint: 'How far the prongs reach out: most of the head’s length.' },
    {
      key: 'setback',
      label: 'Handle from the board',
      kind: 'length',
      min: 20,
      max: 180,
      hint: 'Where the slot ends: room for the back of the head (or the battery) behind the handle.',
    },
    { key: 'tilt', label: 'Tilt', kind: 'number', min: 0, max: 20, step: 1, suffix: '°', hint: 'The prongs rise toward their tips, so the tool settles back.' },
    {
      key: 'battery',
      label: 'Battery',
      kind: 'select',
      options: [
        { value: 'down', label: 'Down', title: 'The head rests on the fork in a V, the battery hangs below' },
        { value: 'up', label: 'Up', title: 'Upside down: the battery rests on the fork, the head hangs below' },
      ],
    },
    { key: 'pitch', label: 'Tools apart', kind: 'length', min: 90, max: 250, hint: 'Centre to centre: room for the heads and batteries side by side.' },
    { key: 'height', label: 'Back height', kind: 'length', min: 40, max: 200, hint: 'Taller holds more: the tools hang below the fork, over the board.' },
  ],
});
