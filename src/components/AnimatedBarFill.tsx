import React, { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Reanimated, { useSharedValue, useAnimatedStyle, withDelay, withTiming } from 'react-native-reanimated';
import { animation } from '../theme';
import { useReduceMotion } from '../utils/useReduceMotion';
import { useRestKey } from '../hooks/useRestKey';

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
 * app is this**, and `ProgressBar` (track, colours, accessibility semantics)
 * is built on it. A new progress bar uses `ProgressBar`; a bar that isn't
 * progress toward something (`ContrastBars`) uses this directly rather than writing `width: \`${p}%\`` into a
 * plain `View`, which snaps.
 *
 * Reanimated with the style attached unconditionally, for the reason
 * `EmptyState` gives: the shared value is the one source of truth, so a
 * re-render can't leave the bar stranded part-way. Keyed on its rest
 * (useRestKey), since its length differs from one figure to the next. Reduce
 * Motion draws the bar at its length with no sweep.
 */
export function AnimatedBarFill({ percent, style, delayMs = 0 }: Props) {
  const reduceMotion = useReduceMotion();
  const width = useSharedValue(0);
  const { restKey, rested, onRest } = useRestKey();

  useEffect(() => {
    // Assigning a plain number also cancels a sweep already running, which
    // matters because the setting resolves asynchronously after first render.
    if (reduceMotion) {
      width.value = percent;
      rested();
      return;
    }
    width.value = withDelay(delayMs, withTiming(percent, { duration: animation.duration.slow }, onRest));
  }, [percent, delayMs, reduceMotion]);

  const animatedStyle = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  return <Reanimated.View key={restKey} style={[style, animatedStyle]} />;
}
