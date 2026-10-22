import { registerAttachmentUi } from '../uiRegistry';

registerAttachmentUi({
  type: 'model',
  label: 'Your own model',
  description: 'Hang anything: import a holder or box you downloaded (STL, 3MF, OBJ), and it gets clips on its back.',
  group: 'other',
  fields: [
    {
      key: 'mesh',
      label: 'Model',
      kind: 'model',
      hint: 'It prints standing as it hangs. The clips and the plate need no support; overhangs of its own may (let your slicer add them).',
    },
    {
      key: 'back',
      label: 'Its back',
      kind: 'select',
      options: [
        { value: 'auto', label: 'Auto: its largest flat face' },
        { value: '+y', label: 'Back (+Y)', title: 'The side away from you in most modelling programs' },
        { value: '-y', label: 'Front (−Y)' },
        { value: '-x', label: 'Left (−X)' },
        { value: '+x', label: 'Right (+X)' },
        { value: '-z', label: 'Bottom (−Z)', title: 'The face it stands on in the file' },
        { value: '+z', label: 'Top (+Z)' },
      ],
      hint: 'Which side of it goes against the board, as its file has it.',
    },
    {
      key: 'turn',
      label: 'Turn',
      kind: 'select',
      options: [
        { value: '0', label: '0°' },
        { value: '90', label: '90°' },
        { value: '180', label: '180°' },
        { value: '270', label: '270°' },
      ],
      hint: 'About its back, anticlockwise.',
    },
    { key: 'scale', label: 'Scale', kind: 'number', min: 25, max: 400, step: 5, suffix: '%' },
    {
      key: 'attach',
      label: 'Attach with',
      kind: 'select',
      options: [
        { value: 'clips', label: 'Clips on its back', title: 'Fused straight onto its back where it is flat' },
        { value: 'plate', label: 'A back plate', title: 'A plate with clips that fills in behind it' },
      ],
      hint: 'Clips go straight onto a flat back. A plate fills in behind a curved or uneven one.',
    },
  ],
  resize: { w: null, h: null },
});
