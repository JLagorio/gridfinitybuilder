import type { DrawerInput } from './layout/drawer';
import { sanitizeCase } from './geometry/case';
import { sanitizeWall } from './geometry/wallmount';
import { sanitizeSpacers } from './geometry/spacers';
import { sanitizeSkadis } from './geometry/skadis';

/**
 * Clean a saved drawer's enclosure fields (carry case, wall grid, spacer
 * strips, Skådis board). Each is only kept when it was there, so drawers saved
 * before they existed come back exactly as they were (same layout, same mesh
 * keys).
 */
export function cleanEnclosure(d: DrawerInput): DrawerInput {
  const out = { ...d };
  if (out.enclosure !== 'case' && out.enclosure !== 'wall' && out.enclosure !== 'skadis') delete out.enclosure;
  // A Skådis board prints itself: there is no grid to have already.
  if (out.enclosure === 'skadis') delete out.haveBaseplate;
  const obj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (obj(out.carryCase)) out.carryCase = sanitizeCase(out.carryCase);
  else delete out.carryCase;
  if (obj(out.wallMount)) out.wallMount = sanitizeWall(out.wallMount);
  else delete out.wallMount;
  if (obj(out.spacers)) out.spacers = sanitizeSpacers(out.spacers);
  else delete out.spacers;
  if (obj(out.skadis)) out.skadis = sanitizeSkadis(out.skadis);
  else delete out.skadis;
  return out;
}
