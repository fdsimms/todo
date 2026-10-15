import { create } from 'zustand';
import type { NavDestination } from '../utils/navHubs';
import {
  hubMenuIndexAt, hubMenuLayout, hubMenuRelease, isOverButton,
  type ButtonFrame, type HubMenuLayout, type HubMenuRelease,
} from '../utils/tabHubMenu';

/** The card a long press on a hub's tab has open. */
export interface TabHubMenu {
  items: NavDestination[];
  layout: HubMenuLayout;
  /** The pressed button, to tell a finger resting on it from one that has left. */
  frame: ButtonFrame;
  /** The tab the app was on when the card opened, marked in the list. */
  current: string | undefined;
  /** The row the finger is over, as an index into `items`. */
  hotIndex: number | null;
  /**
   * The finger lifted over the button, so the card stays for a tap instead of
   * closing: a long press that goes nowhere shouldn't be the only thing a
   * held press can do.
   */
  sticky: boolean;
}

interface TabHubMenuState {
  menu: TabHubMenu | null;
  open: (args: { items: NavDestination[]; frame: ButtonFrame; screenWidth: number; current: string | undefined }) => void;
  /** The finger moved. Returns whether the row under it changed, for the tick. */
  point: (x: number, y: number) => boolean;
  /** The finger lifted. Closes the card unless it is staying open (see `sticky`). */
  release: (x: number, y: number) => HubMenuRelease;
  close: () => void;
}

/**
 * Held in a store rather than in a screen's state: the tab button that starts
 * the gesture and the overlay that draws the card are far apart in the tree,
 * and a pointer move is written many times a second, so only the overlay may
 * re-render for it, and only when the row under the finger changes.
 */
export const useTabHubMenuStore = create<TabHubMenuState>((set, get) => ({
  menu: null,
  open: ({ items, frame, screenWidth, current }) => set({
    menu: {
      items,
      frame,
      current,
      hotIndex: null,
      sticky: false,
      layout: hubMenuLayout({
        buttonCenterX: frame.x + frame.width / 2,
        buttonTop: frame.y,
        screenWidth,
        itemCount: items.length,
      }),
    },
  }),
  point: (x, y) => {
    const { menu } = get();
    if (!menu) return false;
    const hotIndex = hubMenuIndexAt(menu.layout, menu.items.length, x, y);
    if (hotIndex === menu.hotIndex) return false;
    set({ menu: { ...menu, hotIndex } });
    return true;
  },
  release: (x, y) => {
    const { menu } = get();
    if (!menu) return { kind: 'close' };
    const hotIndex = hubMenuIndexAt(menu.layout, menu.items.length, x, y);
    const outcome = hubMenuRelease(menu.items, hotIndex, isOverButton(menu.frame, x, y));
    if (outcome.kind === 'stay') set({ menu: { ...menu, hotIndex: null, sticky: true } });
    else set({ menu: null });
    return outcome;
  },
  close: () => set({ menu: null }),
}));
