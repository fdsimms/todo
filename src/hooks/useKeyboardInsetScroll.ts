import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  type FocusEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { NO_INSET, pulseNoInset, strandedScrollOffset } from '../utils/scrollClamp';
import { PresentationLevelContext, sheetCovered, subscribeSheetCover } from '../utils/sheetModal';

/**
 * Makes `automaticallyAdjustKeyboardInsets` safe on a list that lives on a tab
 * screen. Spread `props` onto the FlatList/ScrollView and give it `ref`.
 *
 * The prop itself is what we want — a list holding inline text inputs (task
 * titles, the inline subtask field) has to lift clear of the keyboard. What it
 * does underneath is the problem, in two layers:
 *
 * 1. **Every mounted scroll view in the app hears every keyboard event.** RN
 *    registers the listener on each `RCTScrollView` and gates it on this prop
 *    alone (`RCTScrollView.m` `_keyboardWillChangeFrame:`), so a list the user
 *    isn't even looking at gets a bottom `contentInset`. With
 *    `enableScreens(false)` (see App.tsx — load-bearing, don't revert) a
 *    blurred tab is not detached: under React Navigation v7 it stays mounted
 *    at its normal offset, stacked behind the focused one (`ScreenFallback`'s
 *    plain `View`, `zIndex: -1`). Under v6 it was parked at `top: 30000` by
 *    `ResourceSavingView`, which turned this into a ~30,000pt inset; v7 removed
 *    the parking, not the listener, so a backgrounded list still picks up a
 *    keyboard-height inset it never asked for. Passing the screen's own focus
 *    state means a backgrounded list simply doesn't listen.
 *
 *    Route focus alone misses one case: a sibling `SheetModal` (quick add, a
 *    raised sheet) presented *over* this screen doesn't blur its route, so a
 *    still-"focused" list kept listening to the covering sheet's own keyboard
 *    events and visibly scrolled itself while the user typed in the sheet
 *    above it. `PresentationLevelContext` already tracks this — a sheet
 *    registers with the level it presents from while it's up — so `focused`
 *    below folds that in too.
 *
 *    **A sheet's own list passes `{ ownsSheet: true }`.** The component that
 *    renders a `SheetModal` calls this hook from *outside* that sheet, so the
 *    level it reads is the one its own sheet registers with, and "anything
 *    presented here?" is true for exactly as long as the list is on screen.
 *    Without the flag every sheet switched its own keyboard handling off the
 *    moment it opened, and the field being typed in sat behind the keyboard
 *    (shipped for a week across every sheet using this, the task editor
 *    included). With it, the question becomes whether something is presented
 *    *from* that sheet (`sheetCovered`), which is the same "covered by a sheet
 *    above" rule one level down. A hook called from a component rendered
 *    *inside* the sheet's children already reads the sheet's own level and
 *    must not pass it.
 *
 * 2. **Shrinking an inset never re-clamps `contentOffset`.** RN calls
 *    `scrollToOffset:` after adjusting the insets, but only with an offset it
 *    already changed — on a plain keyboard dismiss that is the current offset,
 *    the call short-circuits, and iOS leaves the scroll view parked wherever it
 *    was. If that was inside the inset, the content is now above the viewport
 *    with no range left to scroll back up: the screen reads as blank and dead.
 *    So we re-clamp ourselves once the keyboard is gone.
 *
 * 3. **A list that stops listening keeps the inset it already had, for good.**
 *    The native keyboard observer is registered once at init and never removed;
 *    the prop only gates the handler, and the prop *changing* just copies the
 *    new flag (`RCTScrollViewComponentView.mm` `_keyboardWillChangeFrame:` and
 *    `updateProps`) — nothing resets `contentInset`. So gating on focus stops a
 *    blurred list picking up a *new* inset but freezes any it was already
 *    carrying: the keyboard's own dismissal is precisely the event it is no
 *    longer listening for. What that leaves behind is dead scroll range under
 *    the content, on a screen the user comes back to and can scroll down into
 *    and not easily out of, since (2) only moves the list back inside the range
 *    — it cannot take the range away. A keyboard frame can land between the
 *    blur and `useIsFocused` flipping, which is a render later (it rides a
 *    focus event emitted from an effect), and leave a keyboard-height inset
 *    behind. So the inset is cleared explicitly, via `contentInset`,
 *    whenever this list stops listening.
 *
 * The clamp is deliberately not run while the keyboard is up — resting inside
 * the inset is the entire point of it while it's there — and only on a settled
 * scroll, so it can't fight iOS's own rubber-band at the end of the content.
 *
 * It is also judged against the inset the list still has, not against the bare
 * content height. `Keyboard.isVisible()` is not the same question as "is there
 * a bottom inset": RN gates its keyboard handler on
 * `automaticallyAdjustKeyboardInsets`, which we tie to screen focus, so a list
 * that was blurred while the keyboard was up never hears the dismissal and
 * still carries that inset until (3) clears it. Against a bare content height,
 * every bounce at
 * the end of such a list settles "past" its content and got yanked up by the
 * width of the inset the instant the rubber-band finished — a visible snap
 * after an otherwise smooth return. Resting inside a *live* inset is not
 * stranded: iOS put the list there and will scroll it back. Stranding is
 * resting below the content with no inset left to justify it, which is what
 * the keyboard-dismissal clamp (inset 0) tests for.
 */

/** The two list flavours we scroll: FlatList exposes scrollToOffset, ScrollView scrollTo. */
export interface ScrollHandle {
  scrollTo?(opts: { x?: number; y?: number; animated?: boolean }): void;
  scrollToOffset?(opts: { offset: number; animated?: boolean }): void;
  // ScrollView only — see `focusInput` below for why a field needs to call it directly.
  scrollResponderScrollNativeHandleToKeyboard?(
    nodeHandle: number,
    additionalOffset?: number,
    preventNegativeScrollOffset?: boolean,
  ): void;
}

/**
 * Lets a field reach the `ScrollView` it lives in and ask to be scrolled clear
 * of the keyboard on demand, bypassing `automaticallyAdjustKeyboardInsets`
 * entirely. `null` outside one (a field rendered somewhere with no keyboard
 * scroll handling at all), so a consumer's `onFocus` wiring is always safe to
 * call unconditionally.
 */
export const KeyboardScrollIntoViewContext = createContext<((nodeHandle: number) => void) | null>(null);

/**
 * An `onFocus` handler for a `TextInput` living inside a `useKeyboardInsetScroll`
 * `ScrollView`, for the one case `automaticallyAdjustKeyboardInsets` cannot
 * cover: refocusing from one field straight onto another while the keyboard
 * never closes. iOS only recomputes the scroll-into-view offset in response to
 * `UIKeyboardWillChangeFrameNotification`, which fires on a keyboard *height*
 * change — not on a same-height refocus — so a field that opens (or is newly
 * mounted and `autoFocus`ed) while the keyboard is already up from a sibling
 * field is left exactly where it was, which can be entirely behind the
 * keyboard. `scrollResponderScrollNativeHandleToKeyboard` is RN's own answer to
 * this (its doc comment: "should be used as the callback to onFocus in a
 * TextInput's parent view") — it reads the keyboard's last-known metrics
 * rather than waiting on a new notification, so it works whether or not the
 * keyboard is already showing.
 */
export function useScrollFieldIntoView() {
  const focusInput = useContext(KeyboardScrollIntoViewContext);
  return useCallback(
    (e: FocusEvent) => {
      if (typeof e.nativeEvent.target === 'number') focusInput?.(e.nativeEvent.target);
    },
    [focusInput],
  );
}

/**
 * `fieldAbove`: the field this list makes room for sits *outside* it, above
 * (a search box over its results). RN's own handler is wrong for that shape
 * whenever the field carries an `inputAccessoryViewID` (the Done bar): it reads
 * an outside field with an accessory as a chat composer docked to the keyboard
 * and moves the list's offset by the keyboard's whole travel
 * (`RCTScrollViewComponentView.mm`, `_firstResponderViewOutsideScrollView`), so
 * the results jump up under the search box as the keyboard opens and back down
 * as it closes. In this mode the native handler is off and the bottom inset is
 * set from the keyboard events instead: the same room to scroll results out
 * from under the keyboard, with the offset left where the user put it.
 */
export function useKeyboardInsetScroll<T extends ScrollHandle>(
  { ownsSheet = false, fieldAbove = false }: { ownsSheet?: boolean; fieldAbove?: boolean } = {},
) {
  const routeFocused = useIsFocused();
  const level = useContext(PresentationLevelContext);
  const [, forceRecheck] = useState(0);
  useEffect(() => subscribeSheetCover(level, () => forceRecheck(n => n + 1)), [level]);
  const covered = ownsSheet ? sheetCovered(level) : level.presented.size > 0;
  const focused = routeFocused && !covered;
  const ref = useRef<T | null>(null);
  // Everything the clamp needs, read off the last scroll event rather than
  // from onLayout/onContentSizeChange: a scroll event carries the viewport and
  // content heights alongside the offset, so the three can never describe
  // different moments (and VirtualizedList fires the caller's onLayout with
  // the empty component's frame, not the list's). Every scroll event, not only
  // a settled one: the keyboard's own scroll-into-view is a programmatic
  // scroll, so a list the user never dragged has nothing settled on record,
  // and the clamp on `keyboardDidHide` then judges the stranding it exists to
  // undo against zeros and leaves it. Recording is separate from clamping,
  // which stays on the settled events below.
  const lastScroll = useRef({ offset: 0, contentHeight: 0, viewportHeight: 0, insetBottom: 0 });

  /**
   * `insetBottom` is the inset the list is entitled to at the moment we look:
   * whatever it last reported for a settled scroll, or 0 once the keyboard —
   * the only thing that puts one there — has gone.
   */
  const unstrand = useCallback((animated: boolean, insetBottom: number) => {
    const { offset, contentHeight, viewportHeight } = lastScroll.current;
    const y = strandedScrollOffset(offset, contentHeight, viewportHeight, insetBottom);
    if (y === null) return;
    lastScroll.current = { ...lastScroll.current, offset: y };
    const list = ref.current;
    if (list?.scrollToOffset) list.scrollToOffset({ offset: y, animated });
    else list?.scrollTo?.({ y, animated });
  }, []);

  const record = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement, contentInset } = e.nativeEvent;
    lastScroll.current = {
      offset: contentOffset.y,
      contentHeight: contentSize.height,
      viewportHeight: layoutMeasurement.height,
      insetBottom: contentInset?.bottom ?? 0,
    };
  }, []);

  const onMomentumScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    record(e);
    if (!Keyboard.isVisible()) unstrand(false, lastScroll.current.insetBottom);
  }, [record, unstrand]);

  useEffect(() => {
    // Not gated on focus: a list that picked up an inset while its screen was
    // focused still has to be pulled back once the keyboard goes, whether or
    // not the user has since moved on.
    // Inset 0: the keyboard's inset is precisely what just went away, and it's
    // the only thing that puts a measurable one on these lists (the
    // `contentInset` prop below only ever asserts zero, give or take a value
    // too small to see). Judging against the pre-dismissal inset we last
    // recorded would decide the list was fine exactly where the inset used to
    // hold it, which is the stranding this whole hook exists to undo.
    const sub = Keyboard.addListener('keyboardDidHide', () => unstrand(true, 0));
    return () => sub.remove();
  }, [unstrand]);

  // Only ever on the way *out* of focus. While the list is focused the native
  // handler is live and owns the inset — writing our own would wipe the one
  // holding a focused text field clear of the keyboard, and asserting it back
  // on `keyboardDidHide` would race a second field being tapped straight after
  // the first. Blurred, nothing will write it again, so that is exactly when a
  // leftover has to go, together with the offset that was resting in it:
  // shrinking an inset never re-clamps `contentOffset` (see (2) above), so
  // clearing one without the clamp is how the list would be left stranded
  // below its own content instead.
  const [noInset, setNoInset] = useState(NO_INSET);
  useEffect(() => {
    if (focused) return;
    setNoInset(pulseNoInset);
    unstrand(false, 0);
  }, [focused, unstrand]);

  // A caller-driven counterpart to the blur effect above, for a list that
  // stays focused but has just lost the content that justified an inset — a
  // keyboard opened for an inline field (a subtask entry, an editor row) and
  // the row it was editing is now gone, e.g. the list just emptied out from
  // under it. Guarded on `Keyboard.isVisible()` for the same reason the blur
  // effect doesn't need to be: while a field is genuinely focused this would
  // be exactly the "writing our own would wipe the one holding a focused text
  // field clear of the keyboard" mistake the hook exists to avoid. Once the
  // keyboard is confirmed down, any inset still on the list is stale by
  // definition, so clearing it can't cost a legitimate one.
  const clearStaleInset = useCallback(() => {
    if (Keyboard.isVisible()) return;
    setNoInset(pulseNoInset);
    unstrand(false, 0);
  }, [unstrand]);

  // `fieldAbove` only: the keyboard's overlap with the bottom of the screen,
  // which is where a sheet's list ends. Zero whenever this list isn't the one
  // being typed over, for the same reason the native handler is gated on focus.
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    if (!fieldAbove || !focused) {
      setKeyboardInset(0);
      return;
    }
    const frame = Keyboard.addListener('keyboardWillChangeFrame', e => {
      setKeyboardInset(Math.max(0, Dimensions.get('window').height - e.endCoordinates.screenY));
    });
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardInset(0));
    return () => { frame.remove(); hide.remove(); };
  }, [fieldAbove, focused]);

  // Named apart from the `contentInset` the scroll event reports in `record`,
  // which is the live native value rather than this assertion about it.
  const insetProp = useMemo(
    () => ({ top: 0, left: 0, bottom: fieldAbove ? keyboardInset : noInset, right: 0 }),
    [fieldAbove, keyboardInset, noInset],
  );

  // See `useScrollFieldIntoView`'s doc comment — this is what it calls through
  // `KeyboardScrollIntoViewContext`. `additionalOffset` is the inset the list
  // is already carrying so this doesn't under-scroll a field that's near the
  // bottom of the content.
  const focusInput = useCallback((nodeHandle: number) => {
    ref.current?.scrollResponderScrollNativeHandleToKeyboard?.(
      nodeHandle,
      lastScroll.current.insetBottom,
      true,
    );
  }, []);

  return {
    ref,
    clearStaleInset,
    focusInput,
    /**
     * For a list that sets its own `onScroll` after spreading `props` (which
     * would otherwise replace the one below): call this from it, so the
     * keyboard-dismissal clamp still sees where the list is.
     */
    noteScroll: record,
    props: {
      automaticallyAdjustKeyboardInsets: focused && !fieldAbove,
      contentInset: insetProp,
      // Recording only, never clamping: a scroll event mid rubber-band carries
      // an overshoot that iOS is about to settle itself. See `lastScroll`.
      onScroll: record,
      // A drag can end mid rubber-band; recording without clamping lets the
      // bounce finish (onMomentumScrollEnd then settles it) while still
      // keeping the offset fresh for a keyboard dismiss that never scrolls.
      onScrollEndDrag: record,
      onMomentumScrollEnd,
    },
  };
}
