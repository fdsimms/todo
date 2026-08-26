/**
 * Cursor arithmetic for the two title fields that splice text in at the caret
 * (the quick-add sheet and the task editor).
 *
 * The reason this is its own module rather than two copies of a `slice` call
 * is the clamping. A caret position read back from a `TextInput` describes the
 * text the *native* field held when the event fired, which is not necessarily
 * the string React is about to splice into: every `applyParse`-style action
 * rewrites the title out from under the caret, and the selection event for the
 * new, shorter string lands a frame later. Splicing against an unclamped
 * offset there silently produces `undefined`-padded output, because
 * `String.slice` is happy to be handed an index past the end.
 */

export type TextSelection = { start: number; end: number };

/**
 * Pull a selection back inside `[0, length]` and put its ends in order.
 *
 * A backwards drag reports `start > end` on iOS, and a caret left over from a
 * longer version of the string sits past its end; both have to be normalised
 * before the offsets are used to cut a string up.
 */
export function clampSelection(selection: TextSelection, length: number): TextSelection {
  const max = Math.max(length, 0);
  const a = Math.min(Math.max(Math.round(selection.start), 0), max);
  const b = Math.min(Math.max(Math.round(selection.end), 0), max);
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

/** The caret parked after the last character of `text`. */
export function caretAtEnd(text: string): TextSelection {
  return { start: text.length, end: text.length };
}

/**
 * Splice `insert` in over the current selection, the way a keypress would —
 * replacing the selected run if there is one, and reporting where the caret
 * should end up afterwards.
 */
export function spliceAtSelection(
  text: string,
  selection: TextSelection,
  insert: string,
): { text: string; cursor: number } {
  const { start, end } = clampSelection(selection, text.length);
  return {
    text: text.slice(0, start) + insert + text.slice(end),
    cursor: start + insert.length,
  };
}
