import {
  DASHBOARD_CONTENT_WIDTH,
  DASHBOARD_TWO_COLUMN_MIN_WIDTH,
  LIST_CONTENT_WIDTH,
  MAX_CONTENT_WIDTH,
  sidebarWidthFor,
} from './frameWidth';
import { columnUncappedFor } from './twoPane';

/**
 * How wide the app's column may be for the screen on show.
 *
 * One column of 720pt suits a form or a phone-shaped page, and leaves a Mac
 * window's two sides empty on a screen that has more to show. Three kinds of
 * screen ask for more, each only once the sidebar is on screen (a window of
 * 900pt or more), so an iPad held upright and every phone keep the 720pt they
 * have always had:
 *
 * - a two-pane screen lifts the cap entirely (`columnUncappedFor`);
 * - a screen that is only a list of rows (`WIDE_LIST_ROUTES`) gets
 *   `LIST_CONTENT_WIDTH`;
 * - a dashboard (`DASHBOARD_ROUTES`) gets `DASHBOARD_CONTENT_WIDTH` when it has
 *   room to lay two columns of cards out (`dashboardColumnsFor`), and stays one
 *   column otherwise, since a single card wider than 720 only stretches its chart.
 *
 * A screen on neither list keeps the cap, which is the right answer for one
 * nobody has looked at: a month grid sizes its cells from the column, so widening
 * the Calendar by default would change its cells.
 */

/** Screens that are a list of rows and nothing else, so a wider row costs them nothing. */
export const WIDE_LIST_ROUTES: ReadonlySet<string> = new Set([
  'Search', 'Cookbooks', 'Categories', 'Tags', 'People', 'Stacks', 'Templates', 'Logbook',
  'Journal', 'Dreams', 'Archived', 'UnattendedLog', 'Reminders', 'Stuck', 'Tips',
]);

/**
 * Screens that are a scroll of cards, which `WideScroll` deals into two columns.
 * A route belongs here only if its screen renders a `WideScroll` (a test checks):
 * listed without one, it would be a single column stretched to 1040.
 */
export const DASHBOARD_ROUTES: ReadonlySet<string> = new Set(['Stats', 'Mood', 'Sleep']);

/** A cap too wide for any window to reach, in place of "no cap" (see `AppFrame`). */
export const UNCAPPED_WIDTH = 100000;

/** How many columns a dashboard's cards go in, in a window this wide. */
export function dashboardColumnsFor(windowWidth: number): 1 | 2 {
  const room = Math.min(windowWidth - sidebarWidthFor(windowWidth), DASHBOARD_CONTENT_WIDTH);
  return room >= DASHBOARD_TWO_COLUMN_MIN_WIDTH ? 2 : 1;
}

/**
 * The widest the app's column gets for `route` in a window `windowWidth` wide.
 * `route` is the focused route, which is null for a sheet's own frame.
 */
export function columnCapFor(windowWidth: number, route: string | null | undefined): number {
  if (columnUncappedFor(windowWidth, route)) return UNCAPPED_WIDTH;
  if (route == null || sidebarWidthFor(windowWidth) === 0) return MAX_CONTENT_WIDTH;
  if (WIDE_LIST_ROUTES.has(route)) return LIST_CONTENT_WIDTH;
  if (DASHBOARD_ROUTES.has(route) && dashboardColumnsFor(windowWidth) === 2) return DASHBOARD_CONTENT_WIDTH;
  return MAX_CONTENT_WIDTH;
}
