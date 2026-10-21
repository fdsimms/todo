import { create } from 'zustand';

/**
 * Whether the focused screen is showing an add button. App-wide floating bars
 * (CookingBar) live in the navigator and can't see a screen's tree, so they
 * read this to leave the button's corner clear instead of sitting a whole
 * button's height above the tab bar on every screen. A count so a screen
 * handing over to the next (blur and focus in either order) can't clear it.
 */
interface FabPresenceState {
  count: number;
  enter: () => void;
  leave: () => void;
}

export const useFabPresenceStore = create<FabPresenceState>(set => ({
  count: 0,
  enter: () => set(s => ({ count: s.count + 1 })),
  leave: () => set(s => ({ count: Math.max(0, s.count - 1) })),
}));
