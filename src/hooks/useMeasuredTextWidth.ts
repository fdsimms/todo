import { useCallback, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';

/**
 * Measures the rendered width of a string via an invisible mirror `Text` in
 * the same style, for sizing a borderless numeric input to hug its own value
 * instead of stretching to fill its row (which strands a trailing unit label
 * far from short numbers). Render the mirror off-screen (`position:
 * 'absolute', opacity: 0`) with `onLayout={onLayout}` and the same text/style
 * the input uses, then apply `width` to the input itself.
 */
export function useMeasuredTextWidth() {
  const [width, setWidth] = useState(0);
  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);
  return { width, onLayout };
}
