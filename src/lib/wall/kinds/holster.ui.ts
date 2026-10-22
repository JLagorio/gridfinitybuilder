import type { AttachmentPreset } from '../registry';
import { registerAttachmentUi } from '../uiRegistry';

/** The opening across × front to back, the front slot, how tall the ring is, the lean; heat-safe for hot tools. */
const p = (
  value: string,
  label: string,
  width: number,
  depth: number,
  slot: number,
  ring: number,
  tilt: number,
  heat = false,
  title?: string,
): AttachmentPreset => ({
  value,
  label,
  ...(title ? { title } : {}),
  set: { width, depth, slot, ring, tilt, heat },
});

registerAttachmentUi({
  type: 'holster',
  label: 'Tool holster',
  description: 'A ring a tool drops into, nose down: a drill, glue gun, soldering pen, hair dryer, heat gun, spray bottle.',
  group: 'tools',
  fields: [
    {
      key: 'preset',
      label: 'For',
      kind: 'preset',
      hint: 'Tools vary: measure yours. Heavy or hot tools want PETG.',
      presets: [
        p('drill', 'Cordless drill or impact driver', 77, 77, 57, 15, 10, false, 'Opens 77 to pass the chuck; the 57 slot takes the body above the grip'),
        p('glueGun', 'Glue gun', 40, 40, 30, 12, 10),
        p('glueGunMini', 'Glue gun, mini', 28, 28, 22, 10, 10),
        p('solderPen', 'Soldering pen (Pinecil, TS101)', 15, 15, 0, 15, 10, true),
        p('solderIron', 'Soldering iron handpiece', 22, 22, 0, 18, 10, true),
        p('hairDryer', 'Hair dryer (nozzle ⌀45–60)', 62, 62, 0, 15, 5),
        p('straightener', 'Hair straightener', 45, 32, 0, 15, 5, true),
        p('heatGun', 'Heat gun', 48, 48, 0, 15, 5, true),
        p('sprayer', 'Trigger spray bottle (28 mm neck)', 30, 30, 28.5, 8, 0, false, 'Hangs by the neck under the trigger head'),
        p('vacuum', 'Handheld vacuum', 70, 70, 50, 15, 10),
        p('flashlight', 'Flashlight ⌀30', 31, 31, 0, 10, 0),
        p('airbrush', 'Airbrush', 15, 15, 12, 10, 15),
      ],
    },
    { key: 'width', label: 'Opening across', kind: 'length', min: 8, max: 200, hint: 'Wide enough for the nose to pass; the same both ways for a round one.' },
    { key: 'depth', label: 'Opening front to back', kind: 'length', min: 8, max: 200 },
    { key: 'slot', label: 'Front slot', kind: 'length', min: 0, max: 200, hint: 'For a handle or a neck to pass; 0 for a closed ring.' },
    { key: 'ring', label: 'Ring height', kind: 'length', min: 5, max: 40 },
    { key: 'tilt', label: 'Lean back', kind: 'number', min: 0, max: 30, step: 1, suffix: '°', hint: 'The tool leans toward the board, its tip away from it.' },
    { key: 'offset', label: 'Gap from the board', kind: 'length', min: 0, max: 80, hint: 'Room behind the tool: a drill’s battery, a cord.' },
    { key: 'cord', label: 'Cord notch', kind: 'toggle', hint: 'At the back of the opening, for a cord to run down behind the tool.' },
    {
      key: 'heat',
      label: 'Heat-safe',
      kind: 'toggle',
      hint: 'Ribs hold the tool with air between, and it stands 20 mm off the board. Print it in PETG or ASA; rest only the grip in it.',
    },
    { key: 'back', label: 'Back height', kind: 'length', min: 30, max: 200, hint: 'Taller holds a heavy tool steadier.' },
  ],
});
