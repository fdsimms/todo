import { useCallback, useEffect, useRef, useState } from 'react';
import type { TextInput } from 'react-native';

/**
 * The search/filter field that narrows a list as you type, wired so the
 * keyboard can't fight it.
 *
 * **The field is uncontrolled and `query` is a mirror of it, not its source.**
 * That inversion is the whole point. A controlled field (`value={query}`)
 * round-trips every character native -> state -> render -> native, and iOS's
 * text view, handed a `value` that doesn't match what is already in the field,
 * replaces the text and restores the caret by counting *backwards from the end*
 * of the string it just replaced (`_setAttributedString`,
 * RCTTextInputComponentView.mm). Any commit that lands after the next keypress
 * has already gone in therefore drops the caret mid-word, and everything typed
 * afterwards is inserted in the wrong place.
 *
 * It is not a hypothetical race and it is not "typing too fast": typing
 * "protein shake" into the meal picker produced "Potein shakr", caret parked
 * before that last stray r. These fields are the ones it bites, because they
 * are the ones whose every keystroke re-renders a whole list. The damage
 * clusters on the first two or three characters for the same reason: that is
 * while the list is still at full height and churning hardest, and by the time
 * the query has narrowed to nothing there is no list left to re-render.
 *
 * Spread `props` onto the TextInput and read `query` for the filtering:
 *
 * ```tsx
 * const filter = useFilterField();
 * <TextInput {...filter.props} placeholder="Search recipes" />
 * const matches = useMemo(() => rank(filter.query, rows), [filter.query, rows]);
 * ```
 *
 * `props` carries the ref, so don't pass a second `ref` — and don't add a
 * `value`, which would make it controlled again and hand the bug straight back.
 * `noControlledFilterField.test.ts` fails the build on that, since it is
 * invisible in review and typechecks perfectly.
 *
 * **Clear it with `clear()`, never `setQuery('')`.** The field is the source of
 * truth, so the setter alone moves the mirror and leaves the typed text sitting
 * on screen. That is the one thing an uncontrolled field costs, and it is why
 * these two are handed out as a pair.
 */
export interface FilterField {
  /**
   * What's in the field, as of the last keystroke React has seen. Drives the
   * list; it never drives the field.
   */
  query: string;
  /**
   * The field itself, for a caller that focuses it. Same ref `props` carries,
   * so attach `props` and read this — never attach a second one.
   */
  inputRef: React.RefObject<TextInput | null>;
  /** Spread onto the TextInput. Carries the ref — don't pass another. */
  props: {
    ref: React.RefObject<TextInput | null>;
    defaultValue: string;
    onChangeText: (text: string) => void;
  };
  /** Empties the field and the mirror together. */
  clear: () => void;
  /**
   * Replaces what's in the field — the "you tapped a saved search" write, not
   * anything a keystroke does.
   *
   * RN 0.86 has no imperative way to put text *into* a TextInput (`clear` is
   * the only write left since `setNativeProps` went), so this remounts the
   * field around the new text. That is why `fieldKey` has to be attached: skip
   * it and the field keeps whatever was in it while `query` says otherwise.
   * Focus is carried across the remount only when the field had it, so seeding
   * from a tap doesn't raise the keyboard on somebody who wasn't typing.
   */
  seed: (text: string) => void;
  /**
   * Pass as the TextInput's `key`. It is deliberately not in `props`: React 19
   * warns about a `key` arriving through a spread.
   */
  fieldKey: string;
  /**
   * The bare setter, for a caller that has to mirror a change the field made
   * itself. It does **not** write the field, so it is never the way to clear
   * one — that's `clear`.
   */
  setQuery: (text: string) => void;
}

/**
 * `initial` seeds the field at mount and is never read again — `defaultValue`
 * semantics, because that is exactly what it becomes. A field that has to be
 * re-seeded *after* mount can't be served by this: RN 0.86 dropped
 * `setNativeProps`, and `clear()` is the only imperative write a TextInput
 * still has, so there is no way to push new text into an uncontrolled field.
 * Those fields stay controlled for now; see the PR that introduced this hook.
 */
export function useFilterField(initial = ''): FilterField {
  const ref = useRef<TextInput>(null);
  const [query, setQuery] = useState(initial);
  const [seeded, setSeeded] = useState<{ n: number; refocus: boolean } | null>(null);

  const clear = useCallback(() => {
    ref.current?.clear();
    setQuery('');
  }, []);

  const seed = useCallback((text: string) => {
    // Read off the outgoing instance, while it is still the mounted one.
    const refocus = ref.current?.isFocused() ?? false;
    setSeeded(prev => ({ n: (prev?.n ?? 0) + 1, refocus }));
    setQuery(text);
  }, []);

  // Runs after the remounted field has committed, so `ref` is already the new
  // instance by the time this asks for focus back.
  useEffect(() => {
    if (seeded?.refocus) ref.current?.focus();
  }, [seeded]);

  /**
   * What the *next* field to mount starts with, and the one piece of this that
   * has to be got exactly right.
   *
   * `defaultValue` is not the inert mount-only prop it reads as: RN funnels it
   * and `value` into the same native `text`, and Fabric applies that through
   * `updateState` under the same `mostRecentEventCount` guard (line 354 of
   * RCTTextInputComponentView.mm). Tracking `query` with it would therefore
   * hand back the exact race this hook exists to end. So while a field is up,
   * this is frozen at whatever it mounted with and can never be pushed at it.
   *
   * It refreshes only when there is no field to disturb — nothing mounted
   * (`ref.current == null`), or a `seed` remount about to swap one instance for
   * another. That is what lets these fields keep their text across the
   * conditional remounts several of their hosts do: picking a row in
   * SubstituteSheet or collapsing TaskGroupEditor's picker unmounts the field
   * and mounting it again restores what was typed, rather than leaving a list
   * filtered by a word no longer on screen.
   */
  const mountText = useRef(initial);
  const mountedKey = useRef('initial');
  const fieldKey = seeded ? `seed-${seeded.n}` : 'initial';
  if (ref.current == null || mountedKey.current !== fieldKey) {
    mountText.current = query;
    mountedKey.current = fieldKey;
  }

  return {
    query,
    setQuery,
    clear,
    seed,
    fieldKey,
    inputRef: ref,
    // Rebuilt per render rather than memoised: the two callbacks are stable and
    // `defaultValue` is settled above, so nothing downstream can tell.
    props: { ref, defaultValue: mountText.current, onChangeText: setQuery },
  };
}
