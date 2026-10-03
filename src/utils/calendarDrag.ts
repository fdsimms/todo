/**
 * Dragging a task onto a day of the Calendar's grid: which cell the finger is
 * over, and whether a drop there moves anything.
 *
 * Pure so the hit-testing tests without a device: the screen measures each
 * cell once when a drag starts (`measureInWindow`) and hands the rectangles
 * here on every move.
 */

export interface CellRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The day key of the cell under a page point, or null between or off cells. */
export function cellAt(rects: ReadonlyMap<string, CellRect>, x: number, y: number): string | null {
  for (const [key, r] of rects) {
    if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height) return key;
  }
  return null;
}

/**
 * Whether dropping on `targetKey` is a move at all: not off the grid, and not
 * the day the row is already listed under, which would re-date a task to the
 * day it's on and, for a repeating one, still ask about its schedule.
 */
export function isMoveDrop(sourceKey: string, targetKey: string | null): targetKey is string {
  return targetKey !== null && targetKey !== sourceKey;
}
