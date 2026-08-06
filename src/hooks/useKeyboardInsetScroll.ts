import { useCallback, useEffect, useRef } from 'react';
import { Keyboard, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { strandedScrollOffset } from '../utils/scrollClamp';

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
 * The clamp is deliberately not run while the keyboard is up — resting inside
 * the inset is the entire point of it while it's there — and only on a settled
 * scroll, so it can't fight iOS's own rubber-band at the end of the content.
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
  const lastScroll = useRef({ offset: 0, contentHeight: 0, viewportHeight: 0 });

  const unstrand = useCallback((animated: boolean) => {
    const { offset, contentHeight, viewportHeight } = lastScroll.current;
    const y = strandedScrollOffset(offset, contentHeight, viewportHeight);
    if (y === null) return;
    lastScroll.current = { ...lastScroll.current, offset: y };
    const list = ref.current;
    if (list?.scrollToOffset) list.scrollToOffset({ offset: y, animated });
    else list?.scrollTo?.({ y, animated });
  }, []);

  const record = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    lastScroll.current = {
      offset: contentOffset.y,
      contentHeight: contentSize.height,
      viewportHeight: layoutMeasurement.height,
    };
  }, []);

  const onMomentumScrollEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    record(e);
    if (!Keyboard.isVisible()) unstrand(false);
  }, [record, unstrand]);

  useEffect(() => {
    // Not gated on focus: a list that picked up an inset while its screen was
    // focused still has to be pulled back once the keyboard goes, whether or
    // not the user has since moved on.
    const sub = Keyboard.addListener('keyboardDidHide', () => unstrand(true));
    return () => sub.remove();
  }, [unstrand]);

  return {
    ref,
    props: {
      automaticallyAdjustKeyboardInsets: focused,
      // A drag can end mid rubber-band; recording without clamping lets the
      // bounce finish (onMomentumScrollEnd then settles it) while still
      // keeping the offset fresh for a keyboard dismiss that never scrolls.
      onScrollEndDrag: record,
      onMomentumScrollEnd,
    },
  };
}
