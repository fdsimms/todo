import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { NO_INSET, pulseNoInset, strandedScrollOffset } from '../utils/scrollClamp';

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
 *    blurred tab is not detached but parked at `top: 30000` by react-navigation's
 *    `ResourceSavingView`, and the inset is computed from the scroll view's
 *    position in the WINDOW: `MAX(scrollViewBottomY - keyboardTopY, 0)` comes
 *    out around 30,000pt. The keyboard *hiding* recomputes the same 30,000,
 *    so it never clears. Switch to that tab and there are thirty thousand
 *    points of empty scroll range under the content. Passing the screen's own
 *    focus state means a backgrounded list simply doesn't listen.
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
 *    — it cannot take the range away. Both sizes of it happen: a leftover the
 *    height of the keyboard, and (when a keyboard frame lands in the frame
 *    between react-navigation parking the screen at `top: 30000` and
 *    `useIsFocused` flipping, which is a render later — it rides a focus event
 *    emitted from an effect) the full ~30,000. So the inset is cleared
 *    explicitly, via `contentInset`, whenever this list stops listening.
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
}

export function useKeyboardInsetScroll<T extends ScrollHandle>() {
  const focused = useIsFocused();
  const ref = useRef<T | null>(null);
  // Everything the clamp needs, read off the last settled scroll event rather
  // than from onLayout/onContentSizeChange: a scroll event carries the
  // viewport and content heights alongside the offset, so the three can never
  // describe different moments (and VirtualizedList fires the caller's
  // onLayout with the empty component's frame, not the list's).
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

  // Named apart from the `contentInset` the scroll event reports in `record`,
  // which is the live native value rather than this assertion about it.
  const insetProp = useMemo(
    () => ({ top: 0, left: 0, bottom: noInset, right: 0 }),
    [noInset],
  );

  return {
    ref,
    props: {
      automaticallyAdjustKeyboardInsets: focused,
      contentInset: insetProp,
      // A drag can end mid rubber-band; recording without clamping lets the
      // bounce finish (onMomentumScrollEnd then settles it) while still
      // keeping the offset fresh for a keyboard dismiss that never scrolls.
      onScrollEndDrag: record,
      onMomentumScrollEnd,
    },
  };
}
