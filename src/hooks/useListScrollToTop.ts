import { useCallback, useRef, type MutableRefObject } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useFabBottom } from '../components/Fab';
import { SCROLL_TO_TOP_SIZE } from '../components/ScrollToTopButton';
import { spacing } from '../theme';
import { useScrollToTopVisibility } from './useScrollToTopVisibility';

/** The scroll handle every list type here has, whichever of the three methods it exposes. */
interface AnyScroller {
  scrollToOffset?: (p: { offset: number; animated?: boolean }) => void;
  scrollTo?: (p: { y: number; animated?: boolean }) => void;
  getScrollResponder?: () => { scrollTo?: (p: { y: number; animated?: boolean }) => void } | null;
}

/**
 * Everything a plain `FlatList`, `SectionList` or `ScrollView` needs to show a
 * `ScrollToTopButton`: spread `listProps` on the list, render
 * `<ScrollToTopButton {...buttonProps} />` beside it inside the screen's own
 * container. (`ReorderableList` has the same thing built in as `scrollToTop`.)
 *
 * Pass `useKeyboardInsetScroll`'s result for a list that also uses that hook:
 * the list has one ref, so this one is shared rather than a second made, and
 * our `onScroll` replaces the one its `props` carry, so it is called from here
 * and the keyboard-dismissal clamp still hears every event. Spread `listProps`
 * after the hook's `props`, and use the returned `ref` in place of its own.
 *
 * **The list's bottom padding is at least `clearance`.** The button floats over
 * the list's corner, so a last row that ends closer to the screen bottom than
 * this sits under it with no way to scroll it clear. The tab bar is absolute,
 * so `tabBarHeight + xl` is not enough (the button's top edge is the safe-area
 * inset + 108pt up). Use `Math.max(yourPadding, scrollTop.clearance)`.
 */
export function useListScrollToTop<T = any>(
  keyboardScroll?: {
    ref: MutableRefObject<T | null>;
    noteScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  },
  options?: { footerHeight?: number },
) {
  const ownRef = useRef<T | null>(null);
  const ref = keyboardScroll?.ref ?? ownRef;
  const noteScroll = keyboardScroll?.noteScroll;
  const { visible, onScroll } = useScrollToTopVisibility();
  const fabBottom = useFabBottom();
  // A bar in the layout (not floating) sits where the Fab's offset assumes
  // nothing is, so the button clears it by its measured height instead.
  const footerHeight = options?.footerHeight ?? 0;
  const bottom = footerHeight > 0 ? footerHeight + spacing.md : fabBottom;

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    onScroll(e);
    noteScroll?.(e);
  }, [onScroll, noteScroll]);

  const scrollToTop = useCallback(() => {
    const list = ref.current as AnyScroller | null;
    if (!list) return;
    if (list.scrollToOffset) list.scrollToOffset({ offset: 0, animated: true });
    else if (list.scrollTo) list.scrollTo({ y: 0, animated: true });
    else list.getScrollResponder?.()?.scrollTo?.({ y: 0, animated: true });
  }, []);

  // With a footer the list already ends above it, so only the button's own
  // height and gap are left to clear.
  const clearance = (footerHeight > 0 ? 0 : bottom) + SCROLL_TO_TOP_SIZE + spacing.md;

  return {
    ref,
    clearance,
    listProps: { onScroll: handleScroll, scrollEventThrottle: 16 },
    buttonProps: { visible, bottom, onPress: scrollToTop },
  };
}
