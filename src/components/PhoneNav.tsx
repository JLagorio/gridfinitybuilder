import { useEffect, type ReactNode } from 'react';
import { create } from 'zustand';
import { useStore, type Tab } from '../state/store';

/**
 * Phone-width layout (≤ 760 px, see styles.css): one screen at a time, picked
 * from a tab bar at the bottom. Drawer, Bins and Print are the three steps;
 * 3D shows the 3D view of the step you're on, full screen.
 */
interface PhoneView {
  /** The 3D view instead of the step's panel. */
  view3d: boolean;
  set(view3d: boolean): void;
}

export const usePhoneView = create<PhoneView>((set) => ({
  view3d: false,
  set: (view3d) => set({ view3d }),
}));

const STEPS: { tab: Tab; label: string; icon: ReactNode }[] = [
  {
    tab: 'drawer',
    label: 'Drawer',
    icon: (
      <>
        <rect x="3" y="3" width="14" height="14" rx="2" />
        <path d="M3 10h14M10 3v14" />
      </>
    ),
  },
  {
    tab: 'bins',
    label: 'Bins',
    icon: (
      <>
        <rect x="3" y="3" width="6" height="6" rx="1.2" />
        <rect x="11" y="3" width="6" height="14" rx="1.2" />
        <rect x="3" y="11" width="6" height="6" rx="1.2" />
      </>
    ),
  },
];

const ICON_3D = (
  <>
    <path d="M10 2.5 17 6.3v7.4L10 17.5 3 13.7V6.3z" />
    <path d="M3 6.3 10 10l7-3.7M10 10v7.5" />
  </>
);
const ICON_PRINT = (
  <>
    <path d="M5 7V3h10v4" />
    <rect x="2.5" y="7" width="15" height="7" rx="1.5" />
    <path d="M5.5 12h9v5h-9z" />
  </>
);

/** The bottom tab bar (shown only at phone width). */
export function PhoneNav() {
  const tab = useStore((s) => s.ui.tab);
  const setUI = useStore((s) => s.setUI);
  const { view3d, set } = usePhoneView();

  // Anything else that changes the step (Find, a jump to a bin) shows that step's panel.
  useEffect(
    () =>
      useStore.subscribe((s, prev) => {
        if (s.ui.tab !== prev.ui.tab) usePhoneView.getState().set(false);
      }),
    [],
  );

  const go = (t: Tab) => {
    setUI({ tab: t });
    set(false);
  };
  const item = (key: string, label: string, icon: ReactNode, active: boolean, onClick: () => void) => (
    <button key={key} role="tab" aria-selected={active} className={active ? 'active' : ''} onClick={onClick}>
      <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
        {icon}
      </svg>
      <span>{label}</span>
    </button>
  );
  return (
    <nav className="phone-nav" role="tablist" aria-label="Screens">
      {STEPS.map((s) => item(s.tab, s.label, s.icon, !view3d && tab === s.tab, () => go(s.tab)))}
      {item('3d', '3D', ICON_3D, view3d, () => set(true))}
      {item('print', 'Print', ICON_PRINT, !view3d && tab === 'print', () => go('print'))}
    </nav>
  );
}
