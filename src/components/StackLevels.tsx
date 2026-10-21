import { useMemo, useState } from 'react';
import type { PlacedBin } from '../lib/project';
import { stacksOf } from '../lib/stacking';
import { Segmented } from './fields';
import './stackLevels.css';

/**
 * Stacked bins in the drawer grid (stacking.ts). The grid lays out the floor
 * bins; with stacks in the drawer a switcher picks the level shown on them
 * (Floor / Level 2 / …), and a click selects the bin on that level. Bins with
 * bins on them get a "+1" badge. The level follows the selection, so picking a
 * stacked bin in the 3D view or Find shows its level.
 */
export interface StackLevels {
  /** Floor bins: what the grid lays out, moves and resizes (a stack goes along with its floor bin). */
  bins: PlacedBin[];
  /** The floor bins of the selected bins, primary first. */
  selectedIds: string[];
  /** Select floor bins: picks the bin on the shown level of each (its floor bin when it isn't that tall). */
  onSelect: (ids: string[], primary?: string | null) => void;
  /** Shown level, 0 = floor. */
  level: number;
  /** Levels in the drawer (1 = nothing stacked). */
  depth: number;
  setLevel: (level: number) => void;
  /** The bin on the shown level of a floor bin's stack (null when it isn't that tall), and how many bins sit above it. */
  view: (floor: PlacedBin) => { bin: PlacedBin | null; above: number };
}

export function useStackLevels(all: PlacedBin[], selected: string[], select: (ids: string[], primary?: string | null) => void): StackLevels {
  const st = useMemo(() => stacksOf(all), [all]);
  const floor = useMemo(() => all.filter((b) => !st.level.get(b.id)), [all, st]);
  // Follow the selection: the selected bin (and later, a newly selected one) shows its own level.
  const primary = selected[0] ?? null;
  const [want, setWant] = useState(() => (primary ? (st.level.get(primary) ?? 0) : 0));
  const [seen, setSeen] = useState(primary);
  if (seen !== primary) {
    setSeen(primary);
    const l = primary ? st.level.get(primary) : undefined;
    if (l !== undefined && l !== want) setWant(l);
  }
  const level = Math.min(want, st.depth - 1);
  const roots = useMemo(() => [...new Set(selected.map((id) => st.root.get(id) ?? id))], [selected, st]);
  const onLevel = (id: string, l: number) => st.columns.get(st.root.get(id) ?? id)?.[l];

  return {
    bins: floor,
    selectedIds: roots,
    onSelect: (ids, p) => {
      const pick = (id: string) => onLevel(id, level)?.id ?? id;
      select([...new Set(ids.map(pick))], p ? pick(p) : p);
    },
    level,
    depth: st.depth,
    setLevel: (l) => {
      setWant(l);
      // The selected stacks show their bin on that level.
      const there = selected.map((id) => onLevel(id, l)?.id).filter((id): id is string => !!id);
      if (there.length) select([...new Set(there)], there[0]);
    },
    view: (b) => {
      const col = st.columns.get(b.id) ?? [b];
      const bin = col[level] ?? null;
      return { bin, above: bin ? col.length - 1 - level : 0 };
    },
  };
}

const LEVEL_NAMES = (n: number) => (n === 0 ? 'Floor' : `Level ${n + 1}`);

/** Floor / Level 2 / … above the grid, shown while the drawer has stacked bins. */
export function LevelSwitcher({ levels }: { levels: StackLevels }) {
  if (levels.depth < 2) return null;
  return (
    <div className="ge-levels">
      <Segmented
        value={levels.level}
        options={Array.from({ length: levels.depth }, (_, i) => ({
          value: i,
          label: LEVEL_NAMES(i),
          title: i === 0 ? 'Bins on the baseplate' : i === 1 ? 'Bins stacked on a floor bin' : `Bins stacked on level ${i}`,
        }))}
        onChange={levels.setLevel}
      />
      <span className="ge-levels-hint">
        {levels.level === 0 ? '+1: a bin is stacked on it. A bin’s stack moves, copies and deletes with it.' : 'Faded bins have nothing stacked this high.'}
      </span>
    </div>
  );
}

/** "+1" by the back-right corner (x, y) of a bin with bins stacked on it, `inset` in from it (svg; y runs front to back downward). */
export function StackBadge({ x, y, n, size, inset }: { x: number; y: number; n: number; size: number; inset: number }) {
  const w = size * (n > 9 ? 2.6 : 2);
  const h = size * 1.3;
  return (
    <g className="ge-stack-badge" pointerEvents="none">
      <title>{`${n} bin${n === 1 ? '' : 's'} stacked on this one`}</title>
      <rect x={x - w - inset} y={y + inset} width={w} height={h} rx={h / 2} />
      <text x={x - w / 2 - inset} y={y + inset + h / 2} fontSize={size} dominantBaseline="central" textAnchor="middle">
        +{n}
      </text>
    </g>
  );
}
