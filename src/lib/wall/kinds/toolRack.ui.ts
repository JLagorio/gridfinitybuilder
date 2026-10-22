import { registerAttachmentUi } from '../uiRegistry';
import type { ToolRackOptions } from './toolRack';

const SIZES = 'In mm, one per tool, commas between.';
const INDEX = '1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10';
const only = (mode: ToolRackOptions['mode']) => (o: ToolRackOptions) => o.mode === mode;

registerAttachmentUi({
  type: 'toolRack',
  label: 'Tool rack',
  description: 'A ledge the tools hang through: screwdrivers, pliers, wrenches, bits, hex keys, sockets, a drill index.',
  group: 'tools',
  fields: [
    {
      key: 'set',
      label: 'Set',
      kind: 'preset',
      presets: [
        { value: 'drivers', label: 'Screwdrivers', set: { mode: 'drivers', drivers: '3, 4, 5, 6, 6, 8', handle: 30, reach: 0 } },
        {
          value: 'tHandles',
          label: 'T-handle hex keys 2.5–10',
          title: 'Round holes across the keys’ corners; the T-handles rest on top, front to back',
          set: { mode: 'drivers', drivers: '2.9, 3.5, 4.6, 5.8, 6.9, 9.2, 11.5', handle: 24, reach: 55 },
        },
        { value: 'index', label: 'Drill bits 1–10 mm by 0.5', set: { mode: 'index', index: INDEX, clearance: 0.4, reach: 0 } },
        {
          value: 'sockets14',
          label: 'Sockets, 1/4″ drive, 4–14 mm',
          set: { mode: 'sockets', drive: '1/4', sockets: '12, 12, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19', reach: 0 },
        },
        {
          value: 'sockets38',
          label: 'Sockets, 3/8″ drive, 8–19 mm',
          set: { mode: 'sockets', drive: '3/8', sockets: '17, 17, 18, 19, 20, 22, 23, 25', reach: 0 },
        },
        {
          value: 'sockets12',
          label: 'Sockets, 1/2″ drive, 10–19 mm',
          set: { mode: 'sockets', drive: '1/2', sockets: '22, 22, 22, 22, 24, 24, 26, 27', reach: 0 },
        },
      ],
      hint: 'Typical sets: measure yours and edit the sizes.',
    },
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
        { value: 'sockets', label: 'Sockets', title: 'Square posts the sockets press onto' },
        { value: 'index', label: 'Drill index', title: 'Blind holes the bits stand in, each size engraved in front' },
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
    {
      key: 'sockets',
      label: 'Socket diameters',
      kind: 'text',
      placeholder: '17, 18, 19, 22',
      hint: 'Outside diameters, mm, one per socket, commas between: they space the posts.',
      when: only('sockets'),
    },
    {
      key: 'drive',
      label: 'Drive',
      kind: 'select',
      options: [
        { value: '1/4', label: '1/4″' },
        { value: '3/8', label: '3/8″' },
        { value: '1/2', label: '1/2″' },
      ],
      hint: 'Square posts a hair under the drive: the sockets press on.',
      when: only('sockets'),
    },
    {
      key: 'index',
      label: 'Bit sizes',
      kind: 'text',
      placeholder: '1, 1.5, 2, 2.5, 3',
      hint: `${SIZES} Each is engraved in front of its hole.`,
      when: only('index'),
    },
    { key: 'bits', label: 'Bits', kind: 'number', min: 1, max: 60, step: 1, suffix: '', when: (o: ToolRackOptions) => o.mode === 'bits' },
    { key: 'rows', label: 'Rows', kind: 'number', min: 1, max: 4, step: 1, suffix: '', when: (o: ToolRackOptions) => o.mode === 'bits' },
    { key: 'clearance', label: 'Clearance', kind: 'length', min: 0, max: 3, hint: 'Added to every size.', when: (o: ToolRackOptions) => o.mode !== 'bits' },
    {
      key: 'reach',
      label: 'Room behind',
      kind: 'length',
      min: 0,
      max: 80,
      hint: 'The holes this far out from the back at least: room for T-handles or big heads.',
      when: (o: ToolRackOptions) => o.mode !== 'bits',
    },
    { key: 'height', label: 'Back height', kind: 'length', min: 25, max: 150, hint: 'The tools hang below the rack, over the board.' },
  ],
});
