import type { FabHand } from '../store/useSettingsStore';

/** Where an open FAB menu hangs from, in screen coordinates. */
export interface FabMenuAnchor {
  bottom: number;
  left?: number;
  right?: number;
  /** Which way the pills grow, since they're wider than the button. */
  alignItems: 'flex-start' | 'flex-end';
}

/**
 * The anchor for a menu that opens off a button drawn at `rect` (in window
 * coordinates, from `measureInWindow`): its bottom edge level with the button's,
 * and its side edge flush with the button's own, so the pills stack straight up
 * from it and the Close circle lands on the button it replaces.
 *
 * The menu is drawn in a Modal over the whole window while the button rests in
 * a corner of its own pane, so an anchor taken from a fixed inset put the menu
 * hundreds of points from the button on any window wider than the column.
 */
export function fabMenuAnchorFor(
  rect: { x: number; y: number; width: number; height: number },
  window: { width: number; height: number },
  hand: FabHand,
): FabMenuAnchor {
  const bottom = Math.max(0, window.height - (rect.y + rect.height));
  if (hand === 'left') return { bottom, left: Math.max(0, rect.x), alignItems: 'flex-start' };
  return { bottom, right: Math.max(0, window.width - (rect.x + rect.width)), alignItems: 'flex-end' };
}
