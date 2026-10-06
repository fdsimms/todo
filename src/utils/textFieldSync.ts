/**
 * The bookkeeping behind `TextField` — when JS may write text into a native
 * text field, and what the field's React-side text has to be so that it never
 * writes by accident.
 *
 * **Why a field needs this at all.** A controlled `TextInput` (`value=` +
 * `onChangeText`) changes the text React renders on every keystroke, and on
 * Fabric every change to that text becomes a state update the iOS view applies
 * with `_setAttributedString` (`RCTTextInputComponentView.mm`) whenever its
 * event count matches — which, for an ordinary keystroke, it does. That call
 * replaces the field's whole attributed string while the person is typing into
 * it and then puts the caret back by counting from the *end* of the old text.
 * Anything the keyboard has in flight at that moment that isn't plain text
 * (an inline prediction, the second half of an autocorrect, the marked text of
 * a composed character) makes that count wrong, and the caret lands somewhere
 * else: "rutabaga" typed into quick add came out "utabagar", the caret parked
 * at the start after the first letter. `useFilterField` fixed the search
 * fields by making them uncontrolled; this is the same fix in a form every
 * other field can take without giving up `value`.
 *
 * **The rule:** while someone types, React's copy of the text never changes,
 * so nothing is ever echoed back. JS writes into the field only when `value`
 * says something the field didn't — a clear after submit, a parsed phrase
 * stripped out, a token inserted, a reset — and that write goes out as one
 * explicit command rather than as a re-render.
 *
 * Kept free of React so the rule is testable; the component holds the state
 * in refs and calls these.
 */

export interface FieldSync {
  /**
   * What the native field holds as far as JS knows: the text of its last
   * change event, or the last value written into it.
   */
  known: string;
  /**
   * The text React renders as `defaultValue`. Fixed at mount, and changed
   * afterwards only by {@link nextFieldSync}'s style rule.
   */
  tree: string;
  /** A signature of the props that set text attributes (see `styleKeyOf`). */
  styleKey: string;
}

export function initialFieldSync(value: string, styleKey: string): FieldSync {
  return { known: value, tree: value, styleKey };
}

/**
 * Fold one render's props into the sync state.
 *
 * `write` is the text to push into the field with a command, or `null` when
 * the field already holds `value` (the keystroke case, which is the whole
 * point: React re-rendering with what the person just typed must do nothing).
 *
 * The style rule is the one non-obvious line. React's text is
 * an attributed string, so a style change (a colour flipping as an overlay
 * appears, say) changes it even when the words don't — and a changed tree is
 * pushed to the field exactly like a keystroke echo would be. Pushed with the
 * mount-time words, that would put the field back to how it opened. So when
 * the style changes and the tree has words in it, the tree takes the field's
 * current words. An *empty* tree is left alone: RN drops empty fragments, so
 * an empty string has no attributes to change and a style change can't push
 * anything at all. That makes a field that opened empty (quick add, every
 * "add a…" box) immune to style changes too, not just to typing.
 *
 * Immune is also the catch: the words typed into such a field keep the
 * attributes they were typed with, so a colour flipping to transparent under a
 * highlight overlay left the already-typed text dark, drawn on top of the
 * overlay's copy of it (the doubled, misaligned title in the new-task sheet).
 * So when the style changes and the tree is empty but the field has words, the
 * same words are written back with a command, which rebuilds them with the
 * current attributes. Same text, so the caret is left where it was.
 */
export function nextFieldSync(
  prev: FieldSync,
  value: string,
  styleKey: string,
): { sync: FieldSync; write: string | null } {
  const styleChanged = styleKey !== prev.styleKey;
  const restyle = styleChanged && prev.tree === '' && value !== '';
  const write = value !== prev.known || restyle ? value : null;
  const known = value;
  const tree = styleChanged && prev.tree !== '' ? known : prev.tree;
  return { sync: { known, tree, styleKey }, write };
}

/** Record a change the field made itself. Never a write. */
export function fieldChanged(prev: FieldSync, text: string): FieldSync {
  return { ...prev, known: text };
}

/**
 * A stable signature for the props that become the field's text attributes.
 * `style` is flattened by the caller; anything that can't be serialised (an
 * Animated value) reads as unchanged rather than throwing, which only costs
 * the style rule above its trigger for that one prop.
 */
export function styleKeyOf(flatStyle: unknown, allowFontScaling?: boolean, maxFontSizeMultiplier?: number | null): string {
  let style = '';
  try {
    style = JSON.stringify(flatStyle ?? null) ?? '';
  } catch {
    style = '';
  }
  return `${style}|${allowFontScaling ?? ''}|${maxFontSizeMultiplier ?? ''}`;
}
