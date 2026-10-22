import { registerAttachmentUi } from '../uiRegistry';
import type { FaceoutOptions } from './faceout';

const arm = (length: number, angle: number, width: number, thick: number, notches: number, stopper: FaceoutOptions['stopper'], label: boolean) => ({
  length,
  angle,
  width,
  arm: thick,
  notches,
  stopper,
  label,
});

registerAttachmentUi({
  type: 'faceout',
  label: 'Faceout arm',
  description: 'A long arm for bagged parts, spools and cards on hang tabs, with a stop at the end, notches and a label.',
  group: 'display',
  fields: [
    {
      key: 'preset',
      label: 'For',
      kind: 'preset',
      presets: [
        {
          value: 'bags',
          label: 'Bagged parts (Euro slot)',
          title: 'A flat arm that fits the slot of a hang tab, a label at the tip',
          set: arm(150, 10, 8, 5, 0, 'tip', true),
        },
        { value: 'waterfall', label: 'Waterfall of cards', title: 'Eight notches, one card or packet in each', set: arm(200, 10, 8, 7, 8, 'tip', false) },
        { value: 'spools', label: 'Thread and wire spools', title: 'Bores from 15 mm: a stout arm', set: arm(120, 5, 12, 10, 0, 'tip', false) },
        { value: 'short', label: 'Short peg with a knob', set: arm(80, 10, 6, 6, 0, 'ball', false) },
      ],
      hint: 'What hangs on it slides on over the stop: the arm and the stop must pass its hole.',
    },
    { key: 'length', label: 'Length', kind: 'length', min: 50, max: 250, hint: 'Out from the board.' },
    { key: 'angle', label: 'Slope up', kind: 'number', min: 0, max: 30, step: 1, suffix: '°' },
    { key: 'width', label: 'Arm width', kind: 'length', min: 4, max: 16, hint: 'Left to right.' },
    { key: 'arm', label: 'Arm thickness', kind: 'length', min: 4, max: 14, hint: 'Top to bottom: thicker bends less.' },
    { key: 'notches', label: 'Notches', kind: 'number', min: 0, max: 12, step: 1, suffix: '', hint: 'Along the top, to keep each thing in its place.' },
    {
      key: 'stopper',
      label: 'End',
      kind: 'select',
      options: [
        { value: 'tip', label: 'Upturned', title: 'The tip turns up' },
        { value: 'ball', label: 'Knob', title: 'A round knob on the end' },
        { value: 'none', label: 'Plain' },
      ],
      when: (o: FaceoutOptions) => !o.label,
    },
    { key: 'label', label: 'Label plate', kind: 'toggle', hint: 'At the tip, beside the arm on its right, as on a scanning hook.' },
    { key: 'labelW', label: 'Label width', kind: 'length', min: 20, max: 80, when: (o: FaceoutOptions) => o.label },
  ],
});
