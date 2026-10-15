import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { radius, animation } from '../theme';
import { useReduceMotion } from '../utils/useReduceMotion';

interface ProgressBarProps {
  progress: number; // 0-1
  height?: number;
  /** What the bar measures, for screen readers ("Steps done"). */
  accessibilityLabel?: string;
}

/** Callers pass `done / total`, which is NaN for an empty set; that reads as no progress. */
export function clampProgress(progress: number): number {
  return Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
}

export function ProgressBar({ progress, height = 6, accessibilityLabel }: ProgressBarProps) {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const clamped = clampProgress(progress);
  const widthAnim = useRef(new Animated.Value(clamped)).current;

  useEffect(() => {
    if (reduceMotion) {
      widthAnim.setValue(clamped);
      return;
    }
    Animated.timing(widthAnim, {
      toValue: clamped,
      duration: animation.duration.normal,
      useNativeDriver: false,
    }).start();
  }, [clamped, widthAnim, reduceMotion]);

  return (
    <View
      style={[styles.track, { height, borderRadius: radius.full, backgroundColor: colors.bgTertiary }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <Animated.View
        style={[
          styles.fill,
          {
            borderRadius: radius.full,
            backgroundColor: colors.accent,
            width: widthAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
});
