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

/** The widest the side menu gets. A phone's 85% is already under this. */
export const MAX_DRAWER_WIDTH = 400;

/** The column's width in a window `windowWidth` wide. */
export function frameWidthFor(windowWidth: number): number {
  return Math.min(windowWidth, MAX_CONTENT_WIDTH);
}

/**
 * Where the column's left edge sits in the window, which is what a touch's
 * `pageX` has to be offset by to land in the column's own coordinates.
 */
export function frameLeftFor(windowWidth: number): number {
  return Math.max(0, Math.floor((windowWidth - frameWidthFor(windowWidth)) / 2));
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
