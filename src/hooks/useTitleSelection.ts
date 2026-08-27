import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeSyntheticEvent, TextInputSelectionChangeEventData } from 'react-native';
import { caretAtEnd, clampSelection, spliceAtSelection, type TextSelection } from '../utils/textSelection';

/**
 * Caret tracking for a `TextInput` whose contents are spliced at the cursor —
 * the quick-add and task-editor title fields, which both insert tokens where
 * the caret is and jump it to the end after stripping a parsed phrase out.
 *
 * **The `selection` prop it returns is a one-shot, and that is the entire
 * point of the hook.** Both fields used to hold the caret in state and feed it
 * straight back (`selection={titleSelection}` +
 * `onSelectionChange={e => setTitleSelection(...)}`), which corrupts ordinary
 * typing: type fast enough and a character is swallowed, the caret snapping
 * back a position as though the keystroke never landed.
 *
 * The mechanism is in RN's own `useTextInputStateSynchronization`
 * (`Libraries/Components/TextInput/TextInput.js`). A controlled input pushes
 * its value back to native on *every* keystroke — `lastNativeText !==
 * props.value` is true each time — and the push it issues is
 * `setTextAndSelection(ref, eventCount, text, selection.start, selection.end)`,
 * one command carrying both. With no `selection` prop RN passes `-1, -1`,
 * which native reads as "leave the caret alone". With one, whatever the prop
 * holds at that moment is written into the field.
 *
 * A keystroke emits two separate native events, `onChange` and
 * `onSelectionChange`, and React need not process them in one batch. Commit
 * the text event on its own and the render carries the new string beside the
 * *previous* keystroke's selection — so "qu" is pushed back with the caret at
 * 1, landing it between the q and the u. The next character is then typed into
 * the middle of the word. Nothing is dropped; the caret is dragged backwards
 * and the text follows it.
 *
 * So the caret lives in a ref here, updated from every selection event but
 * never rendered, and `selection` is `undefined` for all ordinary typing. It
 * is defined for exactly one render, when {@link TitleSelection.moveCaret} or
 * {@link TitleSelection.insertToken} deliberately places the caret, and is
 * dropped again in the effect below — RN's own sync runs in a layout effect,
 * so the push has already gone out by the time the value is cleared.
 */
export type TitleSelection = {
  /** Pass to the `TextInput`. `undefined` except on a render that moves the caret. */
  selection: TextSelection | undefined;
  /** Pass to the `TextInput`. Records the caret without re-rendering. */
  onSelectionChange: (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => void;
  /** Where the caret is now, clamped to the current text. */
  getSelection: () => TextSelection;
  /**
   * Seed the recorded caret to the end of `value` without moving the field's
   * own — for opening a sheet onto text the user hasn't touched yet.
   */
  resetCaret: (value: string) => void;
  /** Put the caret at `position` (or at the end of `text`, given a string). */
  moveCaret: (position: number | string) => void;
  /**
   * Splice `token` in over the current selection, as a keypress would, and
   * leave the caret after it. Returns the new text for the caller to store.
   */
  insertToken: (token: string) => string;
};

export function useTitleSelection(text: string): TitleSelection {
  const textRef = useRef(text);
  textRef.current = text;

  const selectionRef = useRef<TextSelection>(caretAtEnd(text));
  const [forced, setForced] = useState<TextSelection | undefined>(undefined);

  // Release the prop the render after it is set. RN applies it from a layout
  // effect, which has already run by the time this passive effect fires, so
  // the caret has moved and the field is back to driving its own selection.
  useEffect(() => {
    if (forced) setForced(undefined);
  }, [forced]);

  const onSelectionChange = useCallback(
    (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
      selectionRef.current = e.nativeEvent.selection;
    },
    [],
  );

  const getSelection = useCallback(
    () => clampSelection(selectionRef.current, textRef.current.length),
    [],
  );

  const resetCaret = useCallback((value: string) => {
    selectionRef.current = caretAtEnd(value);
  }, []);

  const moveCaret = useCallback((position: number | string) => {
    const at = typeof position === 'string' ? position.length : position;
    const next = { start: at, end: at };
    selectionRef.current = next;
    setForced(next);
  }, []);

  const insertToken = useCallback((token: string) => {
    const spliced = spliceAtSelection(textRef.current, selectionRef.current, token);
    // The caller sets the text; keep the ref in step so a second token
    // inserted before the next selection event still lands in the right place.
    textRef.current = spliced.text;
    const next = { start: spliced.cursor, end: spliced.cursor };
    selectionRef.current = next;
    setForced(next);
    return spliced.text;
  }, []);

  return { selection: forced, onSelectionChange, getSelection, resetCaret, moveCaret, insertToken };
}
