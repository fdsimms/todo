import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Easing } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, border, animation } from '../theme';

interface Props {
  /** True while a dragged task is aimed at this group. */
  active: boolean;
  children: React.ReactNode;
}

/**
 * Wraps a group row while a task is being dragged onto it, so the group reads
 * as a container that's opening up rather than a row that suddenly grew a
 * border. The highlight fades and swells in (and out) instead of popping,
 * which is what made the gesture feel abrupt when it was a plain conditional
 * style.
 *
 * Native-driven so the arm/disarm animation is free of the JS work happening
 * on the same frames (drag tracking, row shifts).
 */
export function GroupDropTarget({ active, children }: Props) {
  const colors = useColors();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: active ? animation.duration.fast : animation.duration.normal,
      easing: active ? Easing.out(Easing.back(1.6)) : Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [active, progress]);

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] }) }] },
      ]}
    >
      {children}
      {/* The highlight is an overlay rather than a border on the row itself: a
          border would change the row's layout the instant it appears, nudging
          every row below it mid-drag. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.highlight,
          {
            borderColor: colors.accent,
            backgroundColor: colors.accentSubtle,
            opacity: progress,
          },
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'relative' },
  highlight: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    top: 0,
    bottom: 0,
    borderRadius: radius.md,
    borderWidth: border.sm * 2,
  },
});
