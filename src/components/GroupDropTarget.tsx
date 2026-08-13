import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Easing } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, border, animation } from '../theme';

interface Props {
  /** True while a dragged task is aimed at this group. */
  active: boolean;
  /**
   * True while one of this group's own children is being dragged. The
   * child's floating card (rendered by the nested SortableList) only paints
   * above its own siblings inside the tray — not the rest of the screen — so
   * without this, the card vanishes under whatever row sits below the tray
   * the moment it's dragged low enough to cross the tray's edge. Lifting the
   * whole tray's stacking order for the duration fixes that the same way
   * TaskItem's `itemWrapperElevated` does for an expanded row.
   */
  elevated?: boolean;
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
export function GroupDropTarget({ active, elevated = false, children }: Props) {
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
        elevated && styles.wrapperElevated,
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
  // Same zIndex/elevation pair TaskItem's itemWrapperElevated uses to sit
  // above a sibling row in the same scroll view — this is a plain sibling
  // stacking problem, not a layout one, so nothing else here changes.
  wrapperElevated: {
    zIndex: 10,
    elevation: 10,
  },
  // Traces the stack's tray (TaskGroupTray's margins and radius) — the
  // highlight has to land on the region it is offering to drop into, and the
  // tray is now that region's visible edge.
  highlight: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    top: spacing.sm,
    bottom: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: border.sm * 2,
  },
});
