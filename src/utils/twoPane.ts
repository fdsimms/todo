import { sidebarWidthFor } from './frameWidth';

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

/** The list pane's width at the breakpoint, and the narrowest it gets. */
export const TWO_PANE_LIST_WIDTH = 400;

/** The widest the list pane gets, so a row stays a length the eye can track. */
export const TWO_PANE_LIST_MAX_WIDTH = 560;

/** How much of the room beside the sidebar the list takes, between the two widths above. */
const TWO_PANE_LIST_SHARE = 0.4;

/**
 * The list pane's width in a window this wide. A fixed 400pt left a big
 * window's list wrapping titles beside a page with room to spare, so it grows
 * with the window; at the breakpoint it is still 400, which is what leaves the
 * page a phone's width there.
 */
export function twoPaneListWidthFor(windowWidth: number): number {
  const room = windowWidth - sidebarWidthFor(windowWidth);
  return Math.min(TWO_PANE_LIST_MAX_WIDTH, Math.max(TWO_PANE_LIST_WIDTH, Math.round(room * TWO_PANE_LIST_SHARE)));
}

/**
 * The screens that have a second pane. On these the app's column
 * (`MAX_CONTENT_WIDTH`) is lifted, because two panes are wider than one column
 * by design; every other screen keeps the cap.
 */
export const TWO_PANE_ROUTES: ReadonlySet<string> = new Set(['Today', 'Groceries', 'Recipes', 'Projects']);

/** Whether a window this wide has room for two panes. */
export function twoPaneFor(windowWidth: number): boolean {
  return windowWidth >= TWO_PANE_MIN_WINDOW_WIDTH;
}

/**
 * The layout a screen keeps while a form is open in it, given what the window
 * just did. `hold` is the layout being kept (true for two panes), or null when
 * the window's own is in use; `previousRoom` and `room` are whether the window
 * had room for two panes a render ago and now.
 *
 * Crossing the breakpoint with an editor open swaps its host (a sheet for a
 * pane, or back), and a form can't survive that: it is a different component
 * in a different place, so it comes back fresh and an unsaved edit is gone.
 * Resizing is the Mac's main gesture and it takes one nudge across 1100pt to do
 * it. So the layout the editor opened in is kept until it closes, which is the
 * caller's `null`, or until the window comes back to it.
 */
export function nextLayoutHold(
  hold: boolean | null,
  previousRoom: boolean,
  room: boolean,
  editorOpen: boolean,
): boolean | null {
  if (hold !== null) return hold === room ? null : hold;
  return editorOpen && previousRoom !== room ? previousRoom : null;
}

/**
 * How far in from the column's right edge the floating bars' layer ends
 * (`FloatingLayer`): none, except on a two-pane screen, where the layer ends at
 * the list pane so a bar sits over the list and beside the add button instead of
 * stretching across the page too. The uncapped column is the window less the
 * sidebar, which is what the list's width comes off.
 */
export function floatingLayerInsetFor(windowWidth: number, route: string | null | undefined): number {
  if (!columnUncappedFor(windowWidth, route)) return 0;
  return Math.max(0, windowWidth - sidebarWidthFor(windowWidth) - twoPaneListWidthFor(windowWidth));
}

/**
 * Whether the app's column is lifted for the screen on show. `route` is the
 * focused route, not the tab under it: a page pushed over a two-pane screen is
 * a single column again, so it keeps the cap.
 */
export function columnUncappedFor(windowWidth: number, route: string | null | undefined): boolean {
  return twoPaneFor(windowWidth) && route != null && TWO_PANE_ROUTES.has(route);
}
