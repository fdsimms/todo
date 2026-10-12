import { useCallback, useRef, type MutableRefObject } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useFabBottom } from '../components/Fab';
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
 */
export function useListScrollToTop<T = any>(
  keyboardScroll?: {
    ref: MutableRefObject<T | null>;
    noteScroll?: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  },
) {
  const ownRef = useRef<T | null>(null);
  const ref = keyboardScroll?.ref ?? ownRef;
  const noteScroll = keyboardScroll?.noteScroll;
  const { visible, onScroll } = useScrollToTopVisibility();
  const bottom = useFabBottom();

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

  return {
    ref,
    listProps: { onScroll: handleScroll, scrollEventThrottle: 16 },
    buttonProps: { visible, bottom, onPress: scrollToTop },
  };
}
