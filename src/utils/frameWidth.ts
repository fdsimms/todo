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

/**
 * How wide a screen that is only a list of rows gets once the sidebar shows
 * (`columnCapFor`). A row is a title and a figure, so a line past this makes the
 * eye travel further than the row is worth.
 */
export const LIST_CONTENT_WIDTH = 960;

/**
 * How wide a dashboard (Stats, Mood, Sleep) gets when it can lay its cards out
 * in two columns (`dashboardColumnsFor`): about 500pt a card, the width a chart
 * is already read at in the single column.
 */
export const DASHBOARD_CONTENT_WIDTH = 1040;

/** The narrowest a dashboard's column can be and still hold two cards side by side. */
export const DASHBOARD_TWO_COLUMN_MIN_WIDTH = 880;

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
 * The tallest a centered picker card (date, reminder) gets: the window less a
 * gutter top and bottom. A Mac window can be as short as `MIN_WINDOW_SIZE`
 * allows, and a card taller than that had its Cancel and Save, or its Clear,
 * off the edge of the window with no way to scroll to them.
 */
export function pickerCardMaxHeightFor(windowHeight: number): number {
  return Math.max(280, windowHeight - 48);
}

/**
 * How wide an overlay's card gets. A transparent modal is a backdrop that has to
 * cover the whole window with a card on top, so `SheetModal` can't put it in the
 * column the way it does a full-screen sheet, and each card caps itself. Left
 * uncapped, quick add was 1,550pt wide on a Mac, with its chips stretched to
 * fill. Every cap is above what a phone gives a card (the widest phone is about
 * 430pt wide, less a 24 to 32pt gutter either side), so a phone never meets one.
 */
export const OVERLAY_CARD_MAX_WIDTH = 480;
/** A bottom sheet: a list or a form, a little wider than a prompt. */
export const OVERLAY_SHEET_MAX_WIDTH = 560;
/** Quick search: a list of results to read, so it takes the most. */
export const OVERLAY_SEARCH_MAX_WIDTH = 640;

/**
 * A card centered in a transparent modal. Spread it into the card's style, with
 * `alignItems: 'center'` on the container that centers it vertically.
 */
export const overlayCard = { width: '100%', maxWidth: OVERLAY_CARD_MAX_WIDTH } as const;

/** Quick search's card, which hangs from the top and is centered the same way. */
export const overlaySearchCard = { width: '100%', maxWidth: OVERLAY_SEARCH_MAX_WIDTH } as const;

/**
 * A bottom sheet's outer view, in place of `left: 0, right: 0`. It is absolutely
 * positioned from the bottom, with no inset on the cross axis, so `alignSelf`
 * centers it and `maxWidth` is what stops it spanning the window.
 */
export const overlayDock = { alignSelf: 'center', width: '100%', maxWidth: OVERLAY_SHEET_MAX_WIDTH } as const;

/**
 * A docked sheet that fills a full-window flex container (`justifyContent:
 * 'flex-end'`), which needs `alignItems: 'center'` on that container.
 */
export const overlayDocked = { width: '100%', maxWidth: OVERLAY_SHEET_MAX_WIDTH } as const;

/**
 * The tab bar's own height, without the safe-area inset underneath it.
 * Hard-coded because what floats above it (the demo banner, the undo bar, the
 * toasts) renders outside the tab navigator, where `useBottomTabBarHeight()`
 * throws. Read it through `useBottomBarHeight`, which is zero while the sidebar
 * replaces the bar.
 */
export const TAB_BAR_HEIGHT = 49;
