import { registerAttachmentUi } from '../uiRegistry';
import type { MagnetBarOptions } from './magnetBar';

const disc = (o: MagnetBarOptions) => o.shape === 'disc';

registerAttachmentUi({
  type: 'magnetBar',
  label: 'Magnetic tool bar',
  description: 'A bar with magnets behind its face, for knives, bits, screwdrivers and tweezers.',
  group: 'tools',
  fields: [
    {
      key: 'preset',
      label: 'Magnets',
      kind: 'preset',
      hint: 'Neodymium (N35 or stronger). Bigger magnets hold heavier tools.',
      presets: [
        { value: 'd6x2', label: 'Discs 6 × 2 mm', set: { shape: 'disc', magD: 6, magT: 2 } },
        { value: 'd6x3', label: 'Discs 6 × 3 mm', set: { shape: 'disc', magD: 6, magT: 3 } },
        { value: 'd8x3', label: 'Discs 8 × 3 mm', set: { shape: 'disc', magD: 8, magT: 3 } },
        { value: 'd10x3', label: 'Discs 10 × 3 mm', set: { shape: 'disc', magD: 10, magT: 3 } },
        { value: 'd12x3', label: 'Discs 12 × 3 mm', set: { shape: 'disc', magD: 12, magT: 3 } },
        { value: 'd18x1', label: 'Discs 18 × 1 mm', set: { shape: 'disc', magD: 18, magT: 1 } },
        { value: 'b60', label: 'Bars 60 × 10 × 5 mm', set: { shape: 'block', magD: 60, magW: 10, magT: 5 } },
      ],
    },
    { key: 'length', label: 'Length', kind: 'length', min: 40, max: 400, hint: 'Clips go every 40 mm across the back.' },
    { key: 'height', label: 'Height', kind: 'length', min: 16, max: 80, hint: 'Of the face; it grows to fit the magnets under the clips.' },
    {
      key: 'shape',
      label: 'Magnet shape',
      kind: 'select',
      options: [
        { value: 'disc', label: 'Discs' },
        { value: 'block', label: 'Bars' },
      ],
    },
    { key: 'magD', label: 'Magnet size', kind: 'length', min: 3, max: 60, hint: 'A disc’s diameter, a bar’s length (along the tool bar).' },
    { key: 'magW', label: 'Bar height', kind: 'length', min: 3, max: 20, when: (o: MagnetBarOptions) => !disc(o) },
    { key: 'magT', label: 'Thickness', kind: 'length', min: 1, max: 10 },
    { key: 'pitch', label: 'Spacing', kind: 'length', min: 8, max: 100, hint: 'Centre to centre: at least a magnet and 3 mm.' },
    {
      key: 'fix',
      label: 'Magnets go in',
      kind: 'select',
      options: [
        { value: 'glue', label: 'From the back', title: 'Glued into pockets open at the back, 1 mm of plastic in front' },
        { value: 'skin', label: 'Sealed in', title: 'Dropped in at a pause in the print, under a thin skin: hold harder, no glue' },
      ],
    },
    {
      key: 'skin',
      label: 'Skin',
      kind: 'length',
      min: 0.3,
      max: 1,
      hint: '0.4–0.6 mm: one line of plastic over the magnets. The notes say where to pause.',
      when: (o: MagnetBarOptions) => o.fix === 'skin',
    },
    { key: 'angle', label: 'Face angle', kind: 'number', min: 0, max: 15, step: 1, suffix: '°', hint: 'Leans back so tools rest against it.' },
    { key: 'lip', label: 'Lip at the foot', kind: 'length', min: 0, max: 20, hint: 'Catches knife tips and bits that slide; 0 for none.' },
  ],
});
