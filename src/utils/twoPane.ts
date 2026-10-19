/**
 * When a screen shows a list and the thing selected in it side by side.
 *
 * Below this window width a screen is the single column it always was, and
 * opening a row pushes its page. From it, the sidebar (`sidebarWidthFor`) takes
 * its share and what is left holds the list and the open page together.
 */

/**
 * The window width from which two panes fit. Less the 236pt sidebar this leaves
 * 864pt, which is the list below plus a page at least as wide as a phone's.
 */
export const TWO_PANE_MIN_WINDOW_WIDTH = 1100;

/** The list pane's width, a fixed strip so the page beside it takes the rest. */
export const TWO_PANE_LIST_WIDTH = 400;

/**
 * The screens that have a second pane. On these the app's column
 * (`MAX_CONTENT_WIDTH`) is lifted, because two panes are wider than one column
 * by design; every other screen keeps the cap.
 */
export const TWO_PANE_ROUTES: ReadonlySet<string> = new Set(['Recipes', 'Projects']);

/** Whether a window this wide has room for two panes. */
export function twoPaneFor(windowWidth: number): boolean {
  return windowWidth >= TWO_PANE_MIN_WINDOW_WIDTH;
}

/**
 * Whether the app's column is lifted for the screen on show. `route` is the
 * focused route, not the tab under it: a page pushed over a two-pane screen is
 * a single column again, so it keeps the cap.
 */
export function columnUncappedFor(windowWidth: number, route: string | null | undefined): boolean {
  return twoPaneFor(windowWidth) && route != null && TWO_PANE_ROUTES.has(route);
}
