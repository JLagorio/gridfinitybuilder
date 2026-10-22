/**
 * Several changes as one undo step (the history groups changes made close together, so a slow one splits them):
 * used by actions that add a board and fill it, which plan in between.
 */
import { history, useStore } from './store';

/**
 * What `fn` changes in the project, as one undo step however long it takes (the history groups changes made close
 * together, and planning a new board can take a while on a slow machine): made unrecorded, then put back and made
 * again in one go.
 */
export function oneStep<T>(fn: () => T): T {
  const before = useStore.getState();
  let after = before;
  let out!: T;
  history.silently(() => {
    try {
      out = fn();
    } finally {
      after = useStore.getState();
      useStore.setState(before, true);
    }
  });
  history.checkpoint();
  if (after !== before) useStore.setState(after, true);
  history.checkpoint();
  return out;
}
