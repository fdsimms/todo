import React, { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withDelay, withTiming } from 'react-native-reanimated';
import { animation } from '../theme';
import { useReduceMotion } from '../utils/useReduceMotion';

interface Props {
  /** How full the bar draws, 0..100. */
  percent: number;
  /** The fill's own look (height, radius, colour). Its width is this component's. */
  style?: StyleProp<ViewStyle>;
  /** Wait before the sweep starts, for the second bar of a pair. */
  delayMs?: number;
}

/**
 * The fill inside a bar track: it sweeps out from empty when it first appears
 * and glides to a new length when the figure changes. **Every bar fill in the
 * app is this** (`ProgressBar` keeps its own, which is the same motion over a
 * 0..1 value). A new bar uses it rather than writing `width: \`${p}%\`` into a
 * plain `View`, which snaps.
 *
 * Reanimated with the style attached unconditionally, for the reason
 * `EmptyState` gives: the shared value is the one source of truth, so a
 * re-render can't leave the bar stranded part-way. Reduce Motion draws the bar
 * at its length with no sweep.
 */
export function AnimatedBarFill({ percent, style, delayMs = 0 }: Props) {
  const reduceMotion = useReduceMotion();
  const width = useSharedValue(0);

  useEffect(() => {
    // Assigning a plain number also cancels a sweep already running, which
    // matters because the setting resolves asynchronously after first render.
    if (reduceMotion) {
      width.value = percent;
      return;
    }
    width.value = withDelay(delayMs, withTiming(percent, { duration: animation.duration.slow }));
  }, [percent, delayMs, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  return <Reanimated.View style={[style, animatedStyle]} />;
}
