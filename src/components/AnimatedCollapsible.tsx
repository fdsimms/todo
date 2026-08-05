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
  children: React.ReactNode;
}

/**
 * Animates `children` open/closed by interpolating height to their measured
 * natural size on the UI thread — the same technique TaskItem uses for its
 * own detail panel. A plain `LayoutAnimation.configureNext` reflow (the
 * usual RN shortcut for this) reads as an instant snap for content nested
 * inside a FlatList/ReorderableList row rather than a smooth grow/shrink.
 *
 * Measuring costs a frame, so a section that starts out expanded must not
 * depend on the measurement to be visible: the children are laid out in
 * normal flow and the wrapper clips them, which means its natural (unset)
 * height is already the open height. The animated height only ever has to
 * take over from a value that was correct anyway — no first-paint gap where
 * a stack's rows are missing while every ordinary row beside them is drawn,
 * and no gap either on the render where the animated style first attaches.
 */
export function AnimatedCollapsible({ expanded, children }: Props) {
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const progress = useSharedValue(expanded ? 1 : 0);

  // Before the first onLayout there is no height to interpolate to, so an
  // attached animated style would clamp to 0 and hide content that should be
  // on screen from the very first paint. Until then the two states are driven
  // statically instead: open takes its height from the children, closed is
  // pinned shut.
  const unmeasured = contentHeight === null;

  useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, {
      duration: animation.duration.normal,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [expanded]);

  const style = useAnimatedStyle(() => ({
    height: interpolate(progress.value, [0, 1], [0, contentHeight ?? 0], Extrapolation.CLAMP),
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 1, 1], Extrapolation.CLAMP),
  }));

  const handleLayout = (e: LayoutChangeEvent) => {
    const height = e.nativeEvent.layout.height;
    setContentHeight(prev => (prev === height ? prev : height));
  };

  return (
    <Reanimated.View
      style={[
        !(unmeasured && expanded) && style,
        styles.clip,
        unmeasured && !expanded && styles.shut,
      ]}
    >
      {/* In normal flow, so the wrapper falls back to exactly the open height
          whenever the animated height isn't driving it. The children keep
          their natural height regardless of the clamp above them (a View
          doesn't shrink below its content in RN), so this still measures the
          full open height even while collapsed. */}
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
  // Only ever applied before the first measurement, where the animated height
  // has nothing to interpolate to; from then on the animated style owns height.
  shut: {
    height: 0,
  },
});
