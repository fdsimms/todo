/**
 * Today's board (`TodayBoard`, docs/arch/wide-layout.md, "Today's board"): the
 * pure half. The board draws the same flat list Today's single column does
 * (`TodayListItem[]`, headers interleaved with their rows), cut into sections at
 * each header and dealt into columns. A drop is worked out back in that flat
 * order, so `resolveDrop` files it exactly as it would a drop in the column.
 */

/** One section of the flat list: a header and the rows under it, or the rows before the first header. */
export interface BoardSection<T> {
  /** The flat index of the section's first item. */
  start: number;
  items: T[];
}

/**
 * The flat list cut at each header. Rows before the first header (uncategorized
 * tasks, which have no header of their own) are a section of their own, first.
 */
export function boardSections<T extends { type: string }>(data: readonly T[]): BoardSection<T>[] {
  const sections: BoardSection<T>[] = [];
  data.forEach((item, index) => {
    const last = sections[sections.length - 1];
    if (item.type === 'header' || !last) sections.push({ start: index, items: [item] });
    else last.items.push(item);
  });
  return sections;
}

/**
 * Which column each section goes in: each one to the column with the least in
 * it so far (the leftmost on a tie), so the columns end near one another. Order
 * within a column is the list's order, and a column is read top to bottom.
 *
 * `weights` is a section's height in rows, which is known before anything is
 * laid out; waiting for the real heights would draw the board once in the
 * wrong shape (the reason `dealColumns` deals blindly). Returns the section
 * indices in each column.
 */
export function dealBoardSections(weights: readonly number[], columns: number): number[][] {
  const count = Math.max(1, Math.floor(columns));
  const dealt: number[][] = Array.from({ length: count }, () => []);
  const filled = new Array<number>(count).fill(0);
  weights.forEach((weight, section) => {
    let target = 0;
    for (let c = 1; c < count; c++) if (filled[c] < filled[target]) target = c;
    dealt[target].push(section);
    filled[target] += Math.max(1, weight);
  });
  return dealt;
}

/**
 * The flat list in the order the board shows it: down the first column, then
 * the next. What the keyboard's row cursor walks, so ↓ goes down the column the
 * cursor is in and on to the top of the next.
 */
export function boardReadingOrder<T>(sections: readonly BoardSection<T>[], dealt: readonly number[][]): T[] {
  return dealt.flatMap(column => column.flatMap(section => sections[section]?.items ?? []));
}

/** A drawn row's band on screen, in the board's content coordinates. */
export interface BoardRowRect {
  /** The row's flat index. */
  index: number;
  header: boolean;
  top: number;
  bottom: number;
}

/** A column's horizontal extent and its rows, top to bottom. */
export interface BoardColumnRect {
  left: number;
  right: number;
  rows: BoardRowRect[];
}

/** What a dragged row is aimed at. */
export type BoardAim =
  /** Lands at `index` in the flat list (before whatever is there now), shown as a line at `lineY` across column `column`. */
  | { kind: 'insert'; index: number; column: number; lineY: number }
  /** Joins the stack at flat index `index`. */
  | { kind: 'join'; index: number }
  | { kind: 'none' };

/**
 * How far in from a stack's top and bottom edges a drop still means "next to it"
 * rather than "into it", so a row can be placed on either side of a stack.
 */
export const BOARD_JOIN_EDGE = 14;

/**
 * Where a row dragged to (`x`, `y`) would land. The column is the one under the
 * pointer, or the nearest one. Within it, the line goes in the seam nearest
 * above the pointer's half of a row, and a seam always files the row into the
 * section above it, never the one below: the slot just above a header is the
 * end of the section before it in this column, and the slot above the
 * column's first header is the top of that header's own section. That keeps
 * what the line shows and what `resolveDrop` (the nearest header above, in the
 * flat order) decides the same, since the section before a header in the flat
 * list may be in another column.
 *
 * `canJoin(index)` says whether the stack at that flat index takes the dragged
 * row (a task can join one; a stack can't).
 */
export function boardAimAt(
  columns: readonly BoardColumnRect[],
  x: number,
  y: number,
  canJoin: (index: number) => boolean,
): BoardAim {
  if (columns.length === 0) return { kind: 'none' };
  let column = 0;
  let best = Infinity;
  columns.forEach((c, i) => {
    const distance = Math.max(c.left - x, x - c.right, 0);
    if (distance < best) {
      best = distance;
      column = i;
    }
  });
  const rows = columns[column].rows;
  if (rows.length === 0) return { kind: 'none' };
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (y >= row.top + BOARD_JOIN_EDGE && y <= row.bottom - BOARD_JOIN_EDGE && canJoin(row.index)) {
      return { kind: 'join', index: row.index };
    }
    if (y >= (row.top + row.bottom) / 2) continue;
    if (i > 0) {
      const above = rows[i - 1];
      return { kind: 'insert', index: above.index + 1, column, lineY: (above.bottom + row.top) / 2 };
    }
    if (row.header) {
      const next = rows[1];
      return { kind: 'insert', index: row.index + 1, column, lineY: next ? (row.bottom + next.top) / 2 : row.bottom };
    }
    return { kind: 'insert', index: row.index, column, lineY: row.top };
  }
  const last = rows[rows.length - 1];
  return { kind: 'insert', index: last.index + 1, column, lineY: last.bottom };
}

/**
 * The list with the item at `from` moved to land before what is at `to` now
 * (`to` may be the length, for the end). Null when that leaves it where it was.
 */
export function moveListItem<T>(data: readonly T[], from: number, to: number): T[] | null {
  if (from < 0 || from >= data.length) return null;
  const at = to > from ? to - 1 : to;
  if (at === from) return null;
  const next = data.slice();
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(at, next.length)), 0, moved);
  return next;
}
