import { create } from 'zustand';

/**
 * Whether a floating bulk-action bar is on screen. The app-wide floating bars
 * (CookingBar) sit in the navigator, outside any screen, at a fixed offset above
 * the tab bar, which is exactly where a bulk bar's selection count and close
 * button land, so they read this and step aside while selecting. A count rather
 * than a flag so one bar unmounting can't clear another's.
 */
interface BulkBarPresenceState {
  count: number;
  enter: () => void;
  leave: () => void;
}

export const useBulkBarPresenceStore = create<BulkBarPresenceState>(set => ({
  count: 0,
  enter: () => set(s => ({ count: s.count + 1 })),
  leave: () => set(s => ({ count: Math.max(0, s.count - 1) })),
}));
