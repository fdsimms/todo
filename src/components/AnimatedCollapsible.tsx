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
 */
export function AnimatedCollapsible({ expanded, children }: Props) {
  const [contentHeight, setContentHeight] = useState(0);
  const progress = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(expanded ? 1 : 0, {
      duration: animation.duration.normal,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [expanded]);

  const style = useAnimatedStyle(() => ({
    height: interpolate(progress.value, [0, 1], [0, contentHeight], Extrapolation.CLAMP),
    opacity: interpolate(progress.value, [0, 0.2, 1], [0, 1, 1], Extrapolation.CLAMP),
  }));

  const handleLayout = (e: LayoutChangeEvent) => setContentHeight(e.nativeEvent.layout.height);

  return (
    <Reanimated.View style={[style, styles.clip]}>
      {/* Absolutely positioned so it always lays out at natural height for
          measurement, independent of the animated clipping height above. */}
      <View style={styles.measure} onLayout={handleLayout}>
        {children}
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  clip: {
    overflow: 'hidden',
  },
  measure: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
});
