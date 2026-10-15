import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { radius, animation } from '../theme';
import { useReduceMotion } from '../utils/useReduceMotion';

interface ProgressBarProps {
  progress: number; // 0-1
  height?: number;
  /** What the bar measures, for screen readers ("Steps done"). */
  accessibilityLabel?: string;
  /** Fill colour. Defaults to the accent; a status or `done` colour goes here. */
  color?: string;
  /** Track colour. Defaults to `bgTertiary`; `separator` for a bar on a tertiary surface. */
  trackColor?: string;
  /** Layout on the track (margins, `flex`). Not for colour or size. */
  style?: StyleProp<ViewStyle>;
  /**
   * Hides the bar from screen readers, for one whose row or card already
   * reads the same figures aloud (a bar announcing itself would say them twice).
   */
  decorative?: boolean;
}

/** Callers pass `done / total`, which is NaN for an empty set; that reads as no progress. */
export function clampProgress(progress: number): number {
  return Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
}

export function ProgressBar({ progress, height = 6, accessibilityLabel, color, trackColor, style, decorative }: ProgressBarProps) {
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
      style={[styles.track, { height, borderRadius: radius.full, backgroundColor: trackColor ?? colors.bgTertiary }, style]}
      {...(decorative
        ? { accessible: false, importantForAccessibility: 'no-hide-descendants' as const }
        : {
            accessible: true,
            accessibilityRole: 'progressbar' as const,
            accessibilityLabel,
            accessibilityValue: { min: 0, max: 100, now: Math.round(clamped * 100) },
          })}
    >
      <Animated.View
        style={[
          styles.fill,
          {
            borderRadius: radius.full,
            backgroundColor: color ?? colors.accent,
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
