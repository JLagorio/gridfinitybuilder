import { registerAttachmentUi } from '../uiRegistry';
import type { SpoolRackOptions } from './spoolRack';

const axle = (o: SpoolRackOptions) => o.mode === 'axle';

registerAttachmentUi({
  type: 'spoolRack',
  label: 'Spool rack',
  description: 'Spools side by side on one axle, fed through holes in a guard: wire, solder, tape, ribbon, filament; or pegs for thread.',
  group: 'hobby',
  fields: [
    {
      key: 'preset',
      label: 'Spools',
      kind: 'preset',
      hint: 'Diameter × width, and the bore. Makes differ: measure yours.',
      presets: [
        {
          value: 'wire',
          label: 'Hookup wire (⌀64 × 24, bore 20)',
          set: { mode: 'axle', diameter: 64, width: 24, bore: 20, rod: 16, hubs: false, guard: true, eyelet: 4, teeth: false },
        },
        {
          value: 'solder',
          label: 'Solder, 250 g (⌀60 × 45, bore 18)',
          set: { mode: 'axle', diameter: 60, width: 45, bore: 18, rod: 14, hubs: false, guard: true, eyelet: 4, teeth: false },
        },
        {
          value: 'shrink',
          label: 'Heat-shrink, mini spools (⌀70 × 22, bore 20)',
          set: { mode: 'axle', diameter: 70, width: 22, bore: 20, rod: 16, hubs: false, guard: true, eyelet: 10, teeth: false },
        },
        {
          value: 'washi1',
          label: 'Washi tape, 1″ core (⌀40 × 15, bore 25.4)',
          set: { mode: 'axle', diameter: 40, width: 15, bore: 25.4, rod: 22, hubs: false, guard: true, eyelet: 0, teeth: true },
        },
        {
          value: 'washi118',
          label: 'Washi tape, 1⅛″ core (⌀42 × 15, bore 28.6)',
          set: { mode: 'axle', diameter: 42, width: 15, bore: 28.6, rod: 25, hubs: false, guard: true, eyelet: 0, teeth: true },
        },
        {
          value: 'ribbon',
          label: 'Ribbon (⌀90 × 28, bore 22)',
          set: { mode: 'axle', diameter: 90, width: 28, bore: 22, rod: 18, hubs: false, guard: true, eyelet: 0, teeth: false },
        },
        {
          value: 'labels',
          label: 'Label tape rolls (⌀60 × 30, bore 25)',
          set: { mode: 'axle', diameter: 60, width: 30, bore: 25, rod: 20, hubs: false, guard: true, eyelet: 0, teeth: true },
        },
        {
          value: 'filament',
          label: 'Filament, 1 kg (⌀200 × 70, bore 53)',
          title: 'Hubs centre it on a 20 mm axle; or put it on bearings',
          set: { mode: 'axle', diameter: 200, width: 70, bore: 53, count: 2, rod: 20, hubs: true, guard: false, eyelet: 0, teeth: false },
        },
        { value: 'thread', label: 'Sewing thread, on pegs (⌀35 × 42, bore 6.5)', set: { mode: 'pegs', diameter: 35, width: 42, bore: 6.5 } },
      ],
    },
    {
      key: 'mode',
      label: 'Spools go',
      kind: 'select',
      options: [
        { value: 'axle', label: 'On an axle', title: 'Side by side, turning as you pull' },
        { value: 'pegs', label: 'On pegs', title: 'Standing up, a peg each: thread' },
      ],
    },
    { key: 'diameter', label: 'Spool diameter', kind: 'length', min: 20, max: 260 },
    { key: 'width', label: 'Spool width', kind: 'length', min: 5, max: 150, when: axle },
    { key: 'width', label: 'Spool height', kind: 'length', min: 5, max: 150, hint: 'The pegs are 80% of it.', when: (o: SpoolRackOptions) => !axle(o) },
    { key: 'bore', label: 'Bore', kind: 'length', min: 3, max: 80, hint: 'The hole through the spool.' },
    { key: 'count', label: 'Spools', kind: 'number', min: 1, max: 12, step: 1, suffix: '', when: axle },
    { key: 'count', label: 'Pegs across', kind: 'number', min: 1, max: 12, step: 1, suffix: '', when: (o: SpoolRackOptions) => !axle(o) },
    { key: 'rows', label: 'Rows of pegs', kind: 'number', min: 1, max: 4, step: 1, suffix: '', when: (o: SpoolRackOptions) => !axle(o) },
    {
      key: 'axle',
      label: 'Axle',
      kind: 'select',
      options: [
        { value: 'printed', label: 'Printed', title: 'Prints alongside, lying down' },
        { value: 'dowel', label: 'Dowel', title: 'A wooden dowel or metal rod you cut to length' },
        { value: 'bearings', label: 'Bearings', title: 'An 8 mm rod turning in two 608 bearings that drop into the pockets: for heavy spools' },
      ],
      hint: 'Its ends rest in open pockets: lift it out to change a spool.',
      when: axle,
    },
    {
      key: 'rod',
      label: 'Axle diameter',
      kind: 'length',
      min: 5,
      max: 40,
      hint: 'Less than the bore.',
      when: (o: SpoolRackOptions) => axle(o) && o.axle !== 'bearings',
    },
    { key: 'hubs', label: 'Hubs', kind: 'toggle', hint: 'A pair per spool that centres a big bore on the axle (filament).', when: axle },
    { key: 'guard', label: 'Guard across the front', kind: 'toggle', when: axle },
    {
      key: 'eyelet',
      label: 'Feed holes',
      kind: 'length',
      min: 0,
      max: 12,
      hint: 'One before each spool; 0 for none.',
      when: (o: SpoolRackOptions) => axle(o) && o.guard,
    },
    {
      key: 'teeth',
      label: 'Teeth to tear tape on',
      kind: 'toggle',
      hint: 'Along the guard’s top: pull the tape down over them.',
      when: (o: SpoolRackOptions) => axle(o) && o.guard,
    },
    { key: 'height', label: 'Back height', kind: 'length', min: 25, max: 200 },
  ],
});
