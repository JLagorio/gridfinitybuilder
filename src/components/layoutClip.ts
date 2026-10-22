/**
 * The compartment layout clipboard: Ctrl/Cmd+C / V in the compartment editor,
 * Ctrl/Cmd+Shift+V on the drawer grid (useLayoutShortcuts.ts). On its own, so
 * the drawer grid's shortcuts don't bring the divider-wall tools (WallTools.tsx)
 * onto the first screen.
 */
import { useStore, type CopyLayoutReport, type LayoutSource } from '../state/store';
import type { BinOptions } from '../lib/geometry/bin';

let clip: LayoutSource | null = null;

/** Remember a bin's layout (or its columns × rows) for pasting into other bins. */
export function copyLayoutOf(o: BinOptions) {
  clip = { layout: o.layout ? structuredClone(o.layout) : null, divX: o.divX, divY: o.divY };
}

export const hasLayoutClip = () => !!clip;

/** Paste the remembered layout into bins of the active drawer (one undo step). */
export function pasteLayoutInto(binIds: string[]): CopyLayoutReport | null {
  if (!clip || !binIds.length) return null;
  const s = useStore.getState();
  return s.copyLayout(
    clip,
    binIds.map((binId) => ({ drawerId: s.activeDrawerId, binId })),
  );
}
