import { registerAttachmentUi } from '../uiRegistry';
import type { ToolRackOptions } from './toolRack';

const SIZES = 'In mm, one per tool, commas between.';

registerAttachmentUi({
  type: 'toolRack',
  label: 'Tool rack',
  description: 'A ledge the tools hang through: screwdrivers, pliers, wrenches, bits, hex keys.',
  group: 'tools',
  fields: [
    {
      key: 'mode',
      label: 'For',
      kind: 'select',
      options: [
        { value: 'drivers', label: 'Screwdrivers', title: 'Round holes for the shafts: screwdrivers, files, awls' },
        { value: 'pliers', label: 'Pliers', title: 'Slots: jaws down, the joint rests on top' },
        { value: 'wrenches', label: 'Wrenches', title: 'A comb open at the front: the handle slides in, the ring end rests on the teeth' },
        { value: 'bits', label: '1/4″ bits', title: 'Hex sockets the bits stand in' },
        { value: 'hexKeys', label: 'Hex keys', title: 'Hex holes, long legs down' },
      ],
    },
    { key: 'drivers', label: 'Shaft diameters', kind: 'text', placeholder: '3, 4, 5, 6', hint: SIZES, when: (o: ToolRackOptions) => o.mode === 'drivers' },
    {
      key: 'handle',
      label: 'Handle diameter',
      kind: 'length',
      min: 0,
      max: 60,
      hint: 'Spaces the holes so the handles don’t touch.',
      when: (o: ToolRackOptions) => o.mode === 'drivers',
    },
    {
      key: 'pliers',
      label: 'Jaw thicknesses',
      kind: 'text',
      placeholder: '10, 11, 12',
      hint: `${SIZES} Just below the joint, which rests on the slot.`,
      when: (o: ToolRackOptions) => o.mode === 'pliers',
    },
    {
      key: 'head',
      label: 'Slot length',
      kind: 'length',
      min: 5,
      max: 60,
      hint: 'Front to back: about the jaws’ width just below the joint.',
      when: (o: ToolRackOptions) => o.mode === 'pliers',
    },
    {
      key: 'wrenches',
      label: 'Wrench sizes',
      kind: 'text',
      placeholder: '8, 10, 13, 17',
      hint: `${SIZES} Combination wrenches: the slots fit typical ones.`,
      when: (o: ToolRackOptions) => o.mode === 'wrenches',
    },
    {
      key: 'hexKeys',
      label: 'Hex key sizes',
      kind: 'text',
      placeholder: '2, 2.5, 3, 4, 5, 6',
      hint: `${SIZES} Across flats.`,
      when: (o: ToolRackOptions) => o.mode === 'hexKeys',
    },
    { key: 'bits', label: 'Bits', kind: 'number', min: 1, max: 60, step: 1, suffix: '', when: (o: ToolRackOptions) => o.mode === 'bits' },
    { key: 'rows', label: 'Rows', kind: 'number', min: 1, max: 4, step: 1, suffix: '', when: (o: ToolRackOptions) => o.mode === 'bits' },
    { key: 'clearance', label: 'Clearance', kind: 'length', min: 0, max: 3, hint: 'Added to every size.', when: (o: ToolRackOptions) => o.mode !== 'bits' },
    { key: 'height', label: 'Back height', kind: 'length', min: 25, max: 150, hint: 'The tools hang below the rack, over the board.' },
  ],
});
