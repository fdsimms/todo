/**
 * The keyboard's place in a list of rows: which one an arrow key has landed on.
 *
 * It is a position and nothing else. The cursor never selects, expands or opens a
 * row on its own, so moving down a list with a key can't act on anything it
 * passes; Return, Space and Delete act on the row it is on, and nothing acts
 * when it is `null`. It is also not the row the editor pane has open, which is
 * a different thing (the task being edited), so the two can sit on different rows.
 *
 * Rows are identified by task id, in the order they are drawn top to bottom, as
 * the screen reads them. These helpers take that list and return the new place,
 * which keeps what is easy to get subtly wrong (the ends, a row that has gone)
 * somewhere it can be tested.
 */

/**
 * The row one step from `current`. From no row, the first step lands on the
 * first row going down and the last row going up, so the key that enters a list
 * starts at the end it points toward. Stops at the ends rather than wrapping,
 * the way a Mac list does.
 */
export function stepCursor(ids: readonly string[], current: string | null, delta: 1 | -1): string | null {
  if (ids.length === 0) return null;
  const at = current === null ? -1 : ids.indexOf(current);
  if (at === -1) return delta === 1 ? ids[0] : ids[ids.length - 1];
  return ids[Math.min(ids.length - 1, Math.max(0, at + delta))];
}

/**
 * Where the cursor goes when the list changes under it. A row that is still
 * there keeps it. One that has gone (completed, deleted, moved to another day)
 * hands it to the row that took its place, which is the next one down, so a run
 * of Space presses clears a list from the top the way someone working through
 * it expects; and if there is nothing below, the one above. `null` when the list
 * is empty or the cursor wasn't anywhere.
 */
export function settleCursor(
  previousIds: readonly string[],
  nextIds: readonly string[],
  current: string | null,
): string | null {
  if (current === null || nextIds.length === 0) return null;
  const stillThere = new Set(nextIds);
  if (stillThere.has(current)) return current;
  const at = previousIds.indexOf(current);
  if (at === -1) return null;
  for (let i = at + 1; i < previousIds.length; i++) if (stillThere.has(previousIds[i])) return previousIds[i];
  for (let i = at - 1; i >= 0; i--) if (stillThere.has(previousIds[i])) return previousIds[i];
  return null;
}
