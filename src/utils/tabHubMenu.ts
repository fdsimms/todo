import { visibleMenuRows, type NavDestination, type NavMenuOptions } from './navHubs';

/**
 * The menu a long press on a tab opens: the other screens of the hub that tab
 * belongs to, listed above the button, picked by dragging from the button to
 * one of them. Pure geometry and rules, kept out of the component (like
 * `paintSelect.ts`) so the hit-testing can be tested without a gesture.
 *
 * Every coordinate is window-space, the one space a gesture's `absoluteX/Y`
 * and a view's `measureInWindow` already agree on.
 */

export const HUB_MENU_ROW_HEIGHT = 44;
export const HUB_MENU_PADDING = 6;
export const HUB_MENU_WIDTH = 216;
/** Least distance the card keeps from either screen edge. */
export const HUB_MENU_EDGE = 12;
/** The arrow is a square turned 45 degrees; this is its side. */
export const HUB_MENU_ARROW_SIZE = 16;
/** How far the turned square's point sticks out past the card: side x sqrt(2) / 2. */
export const HUB_MENU_ARROW_TIP = Math.ceil((HUB_MENU_ARROW_SIZE * Math.SQRT2) / 2);
/**
 * Between the arrow's point and the top of the button's band. The glass
 * capsule reaches about 4pt above the band, so this leaves the point just
 * clear of it rather than on top of it.
 */
export const HUB_MENU_TIP_GAP = 8;
/** A finger this far past the card's side or top edge still counts as over it. */
export const HUB_MENU_HIT_SLACK = 24;

/**
 * The screens a long press on `route` offers, top of the card first, or null
 * when it has nothing to offer: the route isn't in a hub, or the hub has only
 * this one screen left (simplified mode, the kitchen switch). A one-row menu
 * would just be the tab again.
 *
 * Read from `visibleMenuRows`, the rows the side menu draws, so the card can
 * never offer a screen the menu is hiding. Listed in reverse pill order: the
 * first screen sits at the bottom, nearest the thumb, and the order is the
 * same whichever of the hub's tabs was pressed.
 */
export function hubMenuItems(route: string, options: NavMenuOptions): NavDestination[] | null {
  for (const row of visibleMenuRows(options)) {
    if (row.kind !== 'hub') continue;
    if (!row.hub.members.some(m => m.route === route)) continue;
    if (row.hub.members.length < 2) return null;
    return [...row.hub.members].reverse();
  }
  return null;
}

export interface HubMenuLayout {
  /** Window-space left edge of the card. */
  left: number;
  /** Window-space top edge of the card. */
  top: number;
  width: number;
  height: number;
  /** The arrow's centre, measured from the card's left edge. */
  arrowLeft: number;
}

/**
 * Where the card goes, given the pressed button's measured frame. It is
 * centred over the button and slid back inside the screen when the button is
 * near an edge; the arrow then stays on the button's own centre line, which
 * is why it is positioned separately from the card instead of being the
 * card's middle.
 */
export function hubMenuLayout(args: {
  buttonCenterX: number;
  buttonTop: number;
  screenWidth: number;
  itemCount: number;
}): HubMenuLayout {
  const { buttonCenterX, buttonTop, screenWidth, itemCount } = args;
  const width = HUB_MENU_WIDTH;
  const height = itemCount * HUB_MENU_ROW_HEIGHT + HUB_MENU_PADDING * 2;
  const maxLeft = Math.max(HUB_MENU_EDGE, screenWidth - HUB_MENU_EDGE - width);
  const left = Math.min(Math.max(buttonCenterX - width / 2, HUB_MENU_EDGE), maxLeft);
  const top = buttonTop - HUB_MENU_TIP_GAP - HUB_MENU_ARROW_TIP - height;
  // Keep the arrow off the card's rounded corners.
  const inset = HUB_MENU_ARROW_SIZE;
  const arrowLeft = Math.min(Math.max(buttonCenterX - left, inset), width - inset);
  return { left, top, width, height, arrowLeft };
}

/**
 * The row under a finger, as an index into the items (top first), or null for
 * a finger that is not over the card. A little slack sideways and above, so a
 * drag that wobbles past the edge of the top or bottom row doesn't drop the
 * selection; none below, where the finger has gone back toward the button.
 */
export function hubMenuIndexAt(
  layout: HubMenuLayout,
  itemCount: number,
  x: number,
  y: number,
): number | null {
  if (itemCount <= 0) return null;
  if (x < layout.left - HUB_MENU_HIT_SLACK || x > layout.left + layout.width + HUB_MENU_HIT_SLACK) return null;
  const rowsTop = layout.top + HUB_MENU_PADDING;
  const rowsBottom = rowsTop + itemCount * HUB_MENU_ROW_HEIGHT;
  if (y < rowsTop - HUB_MENU_HIT_SLACK || y >= rowsBottom + HUB_MENU_PADDING) return null;
  const index = Math.floor((y - rowsTop) / HUB_MENU_ROW_HEIGHT);
  return Math.min(Math.max(index, 0), itemCount - 1);
}

/** The button's frame in window space, as `measureInWindow` reports it. */
export interface ButtonFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether a point is over the button, with slack: the finger that opened the card. */
export function isOverButton(frame: ButtonFrame, x: number, y: number): boolean {
  return (
    x >= frame.x - HUB_MENU_HIT_SLACK
    && x <= frame.x + frame.width + HUB_MENU_HIT_SLACK
    && y >= frame.y - HUB_MENU_HIT_SLACK
    && y <= frame.y + frame.height + HUB_MENU_HIT_SLACK
  );
}

/**
 * What lifting the finger does. Over a row, that screen opens. Still over the
 * button (a long press with no drag), the card stays open to be tapped, since
 * closing it would make a held press that goes nowhere the only outcome.
 * Anywhere else it closes with nothing chosen.
 */
export type HubMenuRelease = { kind: 'open'; route: string } | { kind: 'stay' } | { kind: 'close' };

export function hubMenuRelease(
  items: readonly NavDestination[],
  hotIndex: number | null,
  overButton: boolean,
): HubMenuRelease {
  if (hotIndex !== null && items[hotIndex]) return { kind: 'open', route: items[hotIndex].route };
  return overButton ? { kind: 'stay' } : { kind: 'close' };
}
