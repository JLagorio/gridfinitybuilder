/**
 * The wall's photo (Store.wall.photo, lib/wallPlanner/photo.ts): putting one
 * behind the plan, lining it up again (its corners, what they mark, where the
 * sheet is) and taking it away are one undo step each; its opacity and
 * showing it are undone too, a slider drag as one step. Loads with the first
 * photo (components/WallPhoto.tsx), not with the planner.
 */
import { history, useStore } from './store';
import { currentWall } from './wallPlanner';
import { cleanWall, type WallPhoto } from '../lib/wallPlanner/data';
import { cleanPhoto } from '../lib/wallPlanner/photo';

/** The wall's photo, cleaned (the store keeps it as it came: lib/wallPlanner/data.ts). */
export const currentPhoto = (): WallPhoto | undefined => cleanPhoto(currentWall().photo);

/** Put a photo behind the wall, or line it up again; undefined takes it away. One undo step. */
export function setWallPhoto(photo: WallPhoto | undefined) {
  const { photo: _, ...wall } = currentWall();
  const p = cleanPhoto(photo);
  history.checkpoint();
  useStore.setState({ wall: cleanWall(p ? { ...wall, photo: p } : wall) });
  history.checkpoint();
}

/** Show or hide it, change its opacity, or move it (the sheet's place on the wall). A slider's moves close together are one undo step. */
export function setPhotoView(patch: Partial<Pick<WallPhoto, 'opacity' | 'hidden' | 'at'>>) {
  const p = currentPhoto();
  if (!p) return;
  const own = !('opacity' in patch);
  if (own) history.checkpoint();
  useStore.setState({ wall: cleanWall({ ...currentWall(), photo: cleanPhoto({ ...p, ...patch }) }) });
  if (own) history.checkpoint();
}
