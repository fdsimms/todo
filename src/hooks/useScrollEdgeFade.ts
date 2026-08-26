import { useCallback, useMemo, useRef } from 'react';
import { Animated, LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import {
  SCROLL_FADE_HEIGHT,
  ScrollEdgeMetrics,
  edgeFadeOpacity,
  hiddenAbove,
  hiddenBelow,
} from '../utils/scrollFade';

interface Options {
  /** Ramp distance, which should match the band's own height. */
  height?: number;
}

export interface ScrollEdgeFadeScrollProps {
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  onLayout: (e: LayoutChangeEvent) => void;
  onContentSizeChange: (width: number, height: number) => void;
  scrollEventThrottle: number;
}

export interface ScrollEdgeFadeBinding {
  /** Spread onto the `ScrollView`/`FlatList`. */
  scrollProps: ScrollEdgeFadeScrollProps;
  /** Pass to a bottom-edge `ScrollEdgeFade`. */
  bottomOpacity: Animated.Value;
  /** Pass to a top-edge `ScrollEdgeFade`. */
  topOpacity: Animated.Value;
}

/**
 * Tracks how much of a list is hidden past each of its edges and drives the
 * opacity of a `ScrollEdgeFade` at each one.
 *
 * Three handlers rather than one because `onScroll` alone never fires for a
 * list nobody has touched yet, which is exactly the state the fade exists for:
 * `onLayout` supplies the viewport and `onContentSizeChange` the content, and
 * between them the band is right before the first drag. A caller with handlers
 * of its own composes them by hand rather than spreading — the props are
 * plain functions, so calling both is the whole job.
 *
 * The values are written with `setValue` rather than animated. A scroll is
 * already a continuous gesture and the opacity is a pure function of where it
 * has got to, so animating on top of it would lag the finger; the ramp in
 * `edgeFadeOpacity` is what keeps the band from blinking. Writes are skipped
 * unless the target actually moves, so the long middle of a scroll — where
 * both ends are far away and both values are pinned at 1 — costs nothing.
 */
export function useScrollEdgeFade({ height = SCROLL_FADE_HEIGHT }: Options = {}): ScrollEdgeFadeBinding {
  const bottomOpacity = useRef(new Animated.Value(0)).current;
  const topOpacity = useRef(new Animated.Value(0)).current;
  const metrics = useRef<ScrollEdgeMetrics>({ offsetY: 0, contentHeight: 0, viewportHeight: 0 });
  const applied = useRef({ bottom: 0, top: 0 });

  const sync = useCallback(() => {
    const bottom = edgeFadeOpacity(hiddenBelow(metrics.current), height);
    const top = edgeFadeOpacity(hiddenAbove(metrics.current), height);
    if (Math.abs(bottom - applied.current.bottom) > 0.005) {
      applied.current.bottom = bottom;
      bottomOpacity.setValue(bottom);
    }
    if (Math.abs(top - applied.current.top) > 0.005) {
      applied.current.top = top;
      topOpacity.setValue(top);
    }
  }, [bottomOpacity, topOpacity, height]);

  const scrollProps = useMemo<ScrollEdgeFadeScrollProps>(
    () => ({
      onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
        metrics.current = {
          offsetY: contentOffset.y,
          contentHeight: contentSize.height,
          viewportHeight: layoutMeasurement.height,
        };
        sync();
      },
      onLayout: (e: LayoutChangeEvent) => {
        metrics.current = { ...metrics.current, viewportHeight: e.nativeEvent.layout.height };
        sync();
      },
      onContentSizeChange: (_width: number, contentHeight: number) => {
        metrics.current = { ...metrics.current, contentHeight };
        sync();
      },
      scrollEventThrottle: 16,
    }),
    [sync],
  );

  return { scrollProps, bottomOpacity, topOpacity };
}
