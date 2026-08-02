import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { radius, animation } from '../theme';

interface ProgressBarProps {
  progress: number; // 0-1
  height?: number;
}

export function ProgressBar({ progress, height = 6 }: ProgressBarProps) {
  const colors = useColors();
  const clamped = Math.max(0, Math.min(1, progress));
  const widthAnim = useRef(new Animated.Value(clamped)).current;

  useEffect(() => {
    Animated.timing(widthAnim, {
      toValue: clamped,
      duration: animation.duration.normal,
      useNativeDriver: false,
    }).start();
  }, [clamped, widthAnim]);

  return (
    <View style={[styles.track, { height, borderRadius: radius.full, backgroundColor: colors.bgTertiary }]}>
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
