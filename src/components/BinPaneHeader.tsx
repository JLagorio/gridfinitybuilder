import { useEffect } from 'react';
import { useStore } from '../state/store';
import { isContainer } from '../lib/geometry/containers';
import { Segmented } from './fields';
import { ExternalBinHeaderButton } from './ExternalBins';

/**
 * The Bins tab's left pane: which editor it shows. Kept apart from the editors
 * themselves (BinInteriorEditor.tsx, CutoutEditor.tsx), which load on first use.
 */

/** Left-pane header in the Bins tab: switches between the drawer grid and the compartment editor. */
export function BinPaneHeader() {
  const pane = useStore((s) => s.ui.binPane ?? 'drawer');
  const setUI = useStore((s) => s.setUI);
  // Drawer units, parts boxes, … and bins from elsewhere (lib/external.ts) have no compartments to edit.
  const exists = useStore((s) => !!s.ui.selectedBinId && s.bins.some((b) => b.id === s.ui.selectedBinId && !isContainer(b.opts) && !b.external));
  // Leave the compartment view when the bin is deselected, so picking a bin on the grid doesn't jump away from it.
  useEffect(() => {
    if (!exists && pane === 'compartments') setUI({ binPane: 'drawer' });
  }, [exists, pane, setUI]);
  // The tool cutouts pane (CutoutEditor.tsx) stays open without a bin; it lists bins to pick from.
  const showing = pane === 'cutouts' ? 'cutouts' : exists && pane === 'compartments' ? 'compartments' : 'drawer';
  return (
    <div className="pane-head">
      <div className="pane-title">
        {showing === 'drawer'
          ? 'Layout — drag to draw bins'
          : showing === 'cutouts'
            ? 'Tool cutouts — drag tools into the bin'
            : 'Compartments — click inside the bin to add a wall'}
      </div>
      {showing === 'drawer' && <ExternalBinHeaderButton />}
      <Segmented
        value={showing}
        options={[
          { value: 'drawer', label: 'Drawer layout' },
          { value: 'compartments', label: 'Compartments', title: exists ? 'Edit the selected bin’s walls' : 'Select a bin first' },
          { value: 'cutouts', label: 'Tool cutouts', title: 'Lay out traced tools as pockets in the selected bin' },
        ]}
        onChange={(v) => (v !== 'compartments' || exists) && setUI({ binPane: v })}
      />
    </div>
  );
}

/** The bin whose compartments the left pane shows, or null for the drawer grid. */
export function useInteriorPane(): string | null {
  return useStore((s) =>
    s.ui.binPane === 'compartments' && s.ui.selectedBinId && s.bins.some((b) => b.id === s.ui.selectedBinId && !isContainer(b.opts) && !b.external) ? s.ui.selectedBinId : null,
  );
}
