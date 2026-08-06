import React, { useEffect, useState } from 'react';
import { View, LayoutChangeEvent, StyleSheet } from 'react-native';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
  Easing,
  Extrapolation,
} from 'react-native-reanimated';
import { animation } from '../theme';

interface Props {
  expanded: boolean;
  /**
   * Set false to let content draw outside these bounds. Only safe while the
   * section is open and settled — the clip is what makes the collapse a
   * collapse — and that is the one case where it costs nothing, since
   * `maxHeight` then equals the content's own height and clips nothing.
   *
   * It exists for the floating card a drag inside the section lifts (see
   * SortableList): the card leaves these bounds by design when a row is pulled
   * out of the list, and clipped in half at the section's edge it reads as a
   * rendering fault rather than as a gesture.
   */
  clip?: boolean;
  children: React.ReactNode;
}

// Stands in for the measured height until the first onLayout lands: a cap so
// far above any real section that it doesn't clamp anything, so "open but not
// measured yet" renders at the children's natural height instead of at zero.
const UNMEASURED_MAX = 100000;

/**
 * Animates `children` open/closed on the UI thread — the same technique
 * TaskItem uses for its own detail panel. A plain
 * `LayoutAnimation.configureNext` reflow (the usual RN shortcut for this)
 * reads as an instant snap for content nested inside a
 * FlatList/ReorderableList row rather than a smooth grow/shrink.
 *
 * The clamp is `maxHeight`, not `height`, and the children stay in normal
 * flow. That combination is what makes the measurement optional rather than
 * load-bearing: the wrapper's own height is `min(natural, maxHeight)`, so an
 * unmeasured section falls back to exactly the height its children want, and
 * every state — first paint, mid-animation, settled — is driven by the one
 * animated style that has been attached since the very first render.
 *
 * **Don't reintroduce a conditional style** (`cond && animatedStyle`) to
 * special-case the unmeasured render. Reanimated records a style's initial
 * value only on a component's first render, and attaching/detaching the style
 * later moves the view in and out of its descriptor set — so a wrapper that
 * mounted without the animated style ends up with the animated height as the
 * only thing that can size it, and React's own style contributing nothing.
 * The last value Reanimated committed then sticks: after the first collapse
 * the section stayed pinned at zero and expanding it never brought the rows
 * back.
 */
export function AnimatedCollapsible({ expanded, clip = true, children }: Props) {
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const progress = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, {
      duration: animation.duration.normal,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [expanded]);

  // A zero measurement is treated as no measurement: an empty section has
  // nothing to clamp anyway (its natural height is 0), and falling back to the
  // sentinel keeps a stale zero from being able to hide real content.
  const openHeight = contentHeight || UNMEASURED_MAX;

  const style = useAnimatedStyle(() => ({
    maxHeight: interpolate(progress.value, [0, 1], [0, openHeight], Extrapolation.CLAMP),
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 1, 1], Extrapolation.CLAMP),
  }));

  const handleLayout = (e: LayoutChangeEvent) => {
    const height = e.nativeEvent.layout.height;
    setContentHeight(prev => (prev === height ? prev : height));
  };

  return (
    <Reanimated.View style={[style, clip && styles.clip]}>
      {/* In normal flow, so the wrapper falls back to exactly the open height
          whenever maxHeight isn't clamping it. The children keep their natural
          height regardless of the clamp above them (a View doesn't shrink
          below its content in RN), so this still measures the full open height
          even while collapsed. */}
      <View onLayout={handleLayout}>
        {children}
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
});
