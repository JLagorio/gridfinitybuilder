import { registerAttachmentUi } from '../uiRegistry';
import type { MeasureHangerOptions } from './measureHanger';

const beamed = (o: MeasureHangerOptions) => o.tool === 'caliper' || o.tool === 'square';
const bodied = (o: MeasureHangerOptions) => beamed(o) || o.tool === 'tape';

registerAttachmentUi({
  type: 'measureHanger',
  label: 'Measuring tool hanger',
  description: 'Calipers, combination and speed squares, rulers and tape measures: they drop in from the front or the top.',
  group: 'tools',
  fields: [
    {
      key: 'preset',
      label: 'For',
      kind: 'preset',
      hint: 'Typical sizes with room to spare: measure yours.',
      presets: [
        {
          value: 'caliper150',
          label: 'Digital caliper 150 mm',
          title: 'Beam 16 × 3.5, slider about 75 × 40 × 16',
          set: { tool: 'caliper', beamW: 16, beamT: 3.5, beamAt: 10, bodyW: 40, bodyD: 16, bodyH: 75 },
        },
        {
          value: 'caliper200',
          label: 'Digital caliper 200 mm',
          set: { tool: 'caliper', beamW: 20, beamT: 4, beamAt: 12, bodyW: 46, bodyD: 18, bodyH: 85 },
        },
        { value: 'dial150', label: 'Dial caliper 150 mm', set: { tool: 'caliper', beamW: 16, beamT: 3.5, beamAt: 10, bodyW: 52, bodyD: 24, bodyH: 70 } },
        { value: 'vernier150', label: 'Vernier caliper 150 mm', set: { tool: 'caliper', beamW: 16, beamT: 3.5, beamAt: 10, bodyW: 30, bodyD: 10, bodyH: 60 } },
        {
          value: 'combo300',
          label: 'Combination square 300 mm (12″)',
          set: { tool: 'square', beamW: 25, beamT: 1.3, beamAt: 14, bodyW: 100, bodyD: 25, bodyH: 60 },
        },
        {
          value: 'combo150',
          label: 'Combination square 150 mm (6″)',
          set: { tool: 'square', beamW: 16, beamT: 1, beamAt: 10, bodyW: 65, bodyD: 16, bodyH: 45 },
        },
        {
          value: 'speed7',
          label: 'Speed square 7″ (178 mm)',
          title: 'The plate through a slot, the fence on top',
          set: { tool: 'speed', beamW: 180, beamT: 5, bodyD: 20 },
        },
        { value: 'rule150', label: 'Steel rule 150 mm (19 × 0.8)', set: { tool: 'ruler', beamW: 19, beamT: 0.8 } },
        { value: 'rule300', label: 'Steel rule 300 mm (25 × 1)', set: { tool: 'ruler', beamW: 25, beamT: 1 } },
        { value: 'rule600', label: 'Steel rule 600 mm (30 × 1.2)', set: { tool: 'ruler', beamW: 30, beamT: 1.2 } },
        { value: 'tape5', label: 'Tape measure 5 m', set: { tool: 'tape', bodyW: 70, bodyD: 40, bodyH: 70 } },
        { value: 'tape8', label: 'Tape measure 8 m', set: { tool: 'tape', bodyW: 85, bodyD: 48, bodyH: 85 } },
      ],
    },
    {
      key: 'tool',
      label: 'Tool',
      kind: 'select',
      options: [
        { value: 'caliper', label: 'Caliper', title: 'The beam down through a slot open at the front, the slider in a pocket' },
        { value: 'square', label: 'Combination square', title: 'The blade down through a slot open at the front, the head in a pocket' },
        { value: 'speed', label: 'Speed square', title: 'The plate down through a slot, the fence resting on top' },
        { value: 'ruler', label: 'Rulers', title: 'Slots the rulers stand in, one in front of the other' },
        { value: 'tape', label: 'Tape measure', title: 'A cradle; or hang it by its belt clip on a clip tab' },
      ],
    },
    {
      key: 'beamW',
      label: 'Beam width',
      kind: 'length',
      min: 5,
      max: 400,
      hint: 'Across: a caliper’s beam, a square’s blade, a speed square’s fence side, a ruler.',
      when: (o: MeasureHangerOptions) => o.tool !== 'tape',
    },
    { key: 'beamT', label: 'Beam thickness', kind: 'length', min: 0.3, max: 20, when: (o: MeasureHangerOptions) => o.tool !== 'tape' },
    {
      key: 'beamAt',
      label: 'Beam from the right',
      kind: 'length',
      min: -20,
      max: 200,
      hint: 'Hung jaws up and face out: from the slider’s (head’s) right edge to the middle of the beam.',
      when: beamed,
    },
    { key: 'bodyW', label: 'Body width', kind: 'length', min: 10, max: 200, hint: 'The slider, the head or the tape, across.', when: bodied },
    {
      key: 'bodyD',
      label: 'Body depth',
      kind: 'length',
      min: 3,
      max: 100,
      hint: 'Out from the board (a speed square: its fence).',
      when: (o: MeasureHangerOptions) => o.tool !== 'ruler',
    },
    { key: 'bodyH', label: 'Body height', kind: 'length', min: 10, max: 200, hint: 'Sets how high the walls go.', when: bodied },
    { key: 'count', label: 'Rulers', kind: 'number', min: 1, max: 8, step: 1, suffix: '', when: (o: MeasureHangerOptions) => o.tool === 'ruler' },
    { key: 'clearance', label: 'Clearance', kind: 'length', min: 0.2, max: 3, hint: 'Added each side of every size.' },
    { key: 'height', label: 'Back height', kind: 'length', min: 16, max: 150 },
  ],
});
