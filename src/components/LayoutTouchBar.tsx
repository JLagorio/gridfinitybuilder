import { duplicateSelection, removeSelection } from '../state/selection';
import { TouchToggle, useTouchModes } from './touch';

/**
 * Above the drawer layout on a touch screen: a toggle in place of Shift, and the
 * selection's keyboard actions (⌘D, Delete) as buttons.
 */
export function LayoutTouchBar({ selected }: { selected: number }) {
  const multi = useTouchModes((s) => s.multi);
  const set = useTouchModes((s) => s.set);
  return (
    <div className="ge-touch-bar">
      <TouchToggle
        on={multi}
        label="Select several"
        title="Tap bins to add them to the selection, or drag across the grid to select a group"
        onChange={(on) => set({ multi: on })}
      />
      <span className="ge-touch-actions">
        <button type="button" disabled={!selected} onClick={() => duplicateSelection()}>
          Duplicate
        </button>
        <button type="button" className="danger" disabled={!selected} onClick={() => removeSelection()}>
          Delete
        </button>
      </span>
    </div>
  );
}
