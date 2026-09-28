import { useCallback, useRef, useState } from 'react';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

/** How far down a list has to scroll before the "back to top" button appears. */
const SCROLL_TO_TOP_THRESHOLD = 400;

/**
 * Tracks whether a scroll view has been scrolled down far enough to show a
 * "back to top" button (see ScrollToTopButton), without re-rendering on every
 * scroll frame — `visible` only changes, and only triggers a render, at the
 * moment the offset actually crosses the threshold.
 */
export function useScrollToTopVisibility(threshold: number = SCROLL_TO_TOP_THRESHOLD) {
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = e.nativeEvent.contentOffset.y > threshold;
    if (next !== visibleRef.current) {
      visibleRef.current = next;
      setVisible(next);
    }
  }, [threshold]);

  return { visible, onScroll };
}
