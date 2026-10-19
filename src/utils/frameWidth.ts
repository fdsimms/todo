/**
 * How wide the app's column gets on a window wider than a phone.
 *
 * The layout is built for a phone: every row, header and capsule stretches to
 * the full width it is given. On an iPad or in a resizable Mac window that is
 * a task row 1,400pt wide, so the app draws everything inside one centered
 * column (`AppFrame`) and lets the rest of the window be background. A phone
 * is narrower than the cap, so nothing changes there.
 */

/** The widest the app's column gets. About the width of an iPad held upright. */
export const MAX_CONTENT_WIDTH = 720;

/** The widest the side menu gets as a drawer. A phone's 85% is already under this. */
export const MAX_DRAWER_WIDTH = 400;

/**
 * From this window width up, the menu is a sidebar that is always on screen
 * instead of a drawer opened from the tab bar. An iPad held upright (about
 * 820pt) stays on the drawer; a landscape iPad or a Mac window gets the sidebar.
 */
export const SIDEBAR_MIN_WINDOW_WIDTH = 900;

/** The sidebar's width, a fixed strip so the content column keeps the rest. */
export const SIDEBAR_WIDTH = 236;

/** How much of the window the sidebar takes: nothing, below the breakpoint. */
export function sidebarWidthFor(windowWidth: number): number {
  return windowWidth >= SIDEBAR_MIN_WINDOW_WIDTH ? SIDEBAR_WIDTH : 0;
}

/** The column's width in a window `windowWidth` wide, after the sidebar if there is one. */
export function frameWidthFor(windowWidth: number): number {
  return Math.min(windowWidth - sidebarWidthFor(windowWidth), MAX_CONTENT_WIDTH);
}

/**
 * Where the column's left edge sits in the window, which is what a touch's
 * `pageX` has to be offset by to land in the column's own coordinates. The
 * column is centered in what the sidebar leaves.
 */
export function frameLeftFor(windowWidth: number): number {
  const sidebar = sidebarWidthFor(windowWidth);
  return sidebar + Math.max(0, Math.floor((windowWidth - sidebar - frameWidthFor(windowWidth)) / 2));
}

/** The side menu's width: most of a phone, a fixed strip on anything wider. */
export function drawerWidthFor(windowWidth: number): number {
  return Math.round(Math.min(windowWidth * 0.85, MAX_DRAWER_WIDTH));
}

/** A month grid's cell: seven columns across the column, less its side margins. */
export function monthCellSizeFor(windowWidth: number, sideMargin: number): number {
  return Math.floor((frameWidthFor(windowWidth) - sideMargin * 2) / 7);
}

/** A centered picker card (date, reminder, birthday): a phone's width less a margin, never past 380. */
export function pickerCardWidthFor(windowWidth: number): number {
  return Math.min(windowWidth - 32, 380);
}

/**
 * The tab bar's own height, without the safe-area inset underneath it.
 * Hard-coded because what floats above it (the demo banner, the undo bar, the
 * toasts) renders outside the tab navigator, where `useBottomTabBarHeight()`
 * throws. Read it through `useBottomBarHeight`, which is zero while the sidebar
 * replaces the bar.
 */
export const TAB_BAR_HEIGHT = 49;
