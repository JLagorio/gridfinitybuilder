import { create } from 'zustand';

/**
 * Whether the wall planner (components/WallPlanner.tsx) is open in place of
 * the drawer's tabs. View state only: never saved or undone, like the phone
 * layout's 3D switch (PhoneNav.tsx).
 */
export const useWallView = create<{ open: boolean; set(open: boolean): void }>((set) => ({
  open: false,
  set: (open) => set({ open }),
}));
