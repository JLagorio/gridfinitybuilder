/**
 * Pins and hinges: what the moving kinds (tip-out bin, lidded box, cabinet,
 * swivel tower, folding hook) share. Moving parts are separate parts, each
 * printed without support, joined by pins: a printed pin ⌀4 with a head, or a
 * 3 mm steel rod (a nail cut to length). A pin is a push fit in the part it
 * stays in (`fixed` clearance) and turns freely in the part that moves (`free`,
 * 0.6 mm on the diameter). A printed pin prints lying down, cut flat 0.3 mm
 * underneath, so its layers run along it. Planning side: sizes only
 * (hinge.geom.ts draws them).
 */
import type { AttachmentHardware, AttachmentPart } from '../registry';

export type PinKind = 'printed' | 'steel';

/**
 * Pin sizes, mm: a printed pin's diameter, its head's diameter and thickness, the counterbore that sinks the head
 * (diameter, depth), clearance on the diameter where it stays and where it turns, the flat under a printed pin, a
 * steel pin's diameter, a knuckle's radius round the pin, and the gap between knuckles along the pin.
 */
export const PIN = { d: 4, head: 7, headT: 1.6, bore: 7.6, boreT: 1.8, fixed: 0.15, free: 0.6, flat: 0.3, steel: 3, knuckle: 5, gap: 0.5 } as const;

export const pinD = (k: PinKind) => (k === 'steel' ? PIN.steel : PIN.d);
/** A pin's hole: where it stays (a push fit) or where it turns. */
export const pinHole = (k: PinKind, free: boolean) => pinD(k) + (free ? PIN.free : k === 'steel' ? 0.1 : PIN.fixed);

/** What a printed pin's part builder needs: its length past the head, mm. */
export interface PinSpec {
  p: 'pin';
  len: number;
}

/** A printed pin `len` long past its head, shown along the hinge (`turn` and `at` as AttachmentPart.place). */
export function pinPart(key: string, len: number, place?: AttachmentPart['place']): AttachmentPart {
  const spec: PinSpec = { p: 'pin', len: Math.round(len * 10) / 10 };
  return { key, name: 'Pin', spec, w: spec.len + PIN.headT, d: PIN.head, h: PIN.head / 2 + PIN.d / 2 - PIN.flat, ...(place ? { place } : {}) };
}

/** Where a printed pin along x lands, its axis at (y, z): its head at x (pointing left, or right when `flip`). */
export function pinAlongX(x: number, y: number, z: number, len: number, flip = false): AttachmentPart['place'] {
  const c = PIN.d / 2 - PIN.flat;
  return { at: [flip ? x - len - PIN.headT : x, y - PIN.head / 2, z - c], turn: [0, 0, flip ? 180 : 0] };
}

/** Steel pins to buy, or nothing for printed ones. */
export const pinHardware = (k: PinKind, count: number, len: number): AttachmentHardware[] =>
  k === 'steel' && count ? [{ item: 'Steel rod or nail ⌀3 mm', count, note: `cut to ${Math.round(len)} mm` }] : [];

/** Magnets for a catch, when it has them. */
export const magnetHardware = (on: boolean, count: number): AttachmentHardware[] =>
  on ? [{ item: 'Magnets 6 × 2 mm', count, note: 'glued in, poles facing each other to attract' }] : [];
