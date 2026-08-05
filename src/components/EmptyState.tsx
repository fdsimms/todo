import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { animation, font, fontWeight, lineHeight, spacing, radius, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { useReduceMotion } from '../utils/useReduceMotion';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  /** Optional call-to-action pill button below the text. */
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Extra bottom padding so content centers in the space actually visible
   * above a floating (position: absolute) tab bar, instead of the full
   * screen height behind it. Pass `useBottomTabBarHeight()` from screens
   * that render this above the tab bar; omit in modals/sheets that don't.
   */
  bottomOffset?: number;
}

/**
 * Shared empty state: tinted icon circle + title + subtitle that gently
 * fades and rises in on mount. Use for every empty list in the app.
 */
export function EmptyState({ icon, title, subtitle, actionLabel, onAction, bottomOffset }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(0.8)).current;
  // Once the entrance has played, the settled look has to live in React state
  // and not only in the Animated values. An animated value doesn't re-render
  // the component, so React's committed opacity for this view stays at 0 for
  // as long as the component is mounted — and the tab navigator doesn't
  // unmount a blurred screen, it parks it offscreen with
  // `removeClippedSubviews`, which detaches its native views and drops any
  // frame the animation writes while it's away. Leaving a tab mid-entrance
  // used to strand the empty state at whatever opacity it had reached, with
  // nothing left to finish the fade. Rendering plain style values once
  // settled means the values React re-applies on re-attach are the right ones.
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    // Reduce Motion: appear in place, no fade-up or icon pop.
    if (reduceMotion) {
      setSettled(true);
      return;
    }
    let cancelled = false;
    const entrance = Animated.parallel([
      Animated.timing(progress, {
        toValue: 1,
        duration: animation.duration.normal,
        useNativeDriver: true,
      }),
      Animated.spring(iconScale, {
        toValue: 1,
        ...animation.spring.smooth,
        useNativeDriver: true,
      }),
    ]);
    // Settles on interruption too — a half-faded empty state is never the
    // state we want to be left in.
    entrance.start(() => {
      if (!cancelled) setSettled(true);
    });
    return () => {
      cancelled = true;
      entrance.stop();
    };
  }, [progress, iconScale, reduceMotion]);

  return (
    <Animated.View
      style={[
        styles.container,
        { paddingBottom: bottomOffset ?? 0 },
        !settled && {
          opacity: progress,
          transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
        },
      ]}
    >
      <Animated.View style={[styles.iconCircle, !settled && { transform: [{ scale: iconScale }] }]}>
        <Ionicons name={icon} size={34} color={colors.textTertiary} />
      </Animated.View>
      <Text style={styles.title}>{title}</Text>
      {subtitle != null && <Text style={styles.subtitle}>{subtitle}</Text>}
      {actionLabel != null && onAction != null && (
        <PressableScale style={styles.actionBtn} onPress={onAction} haptic>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </PressableScale>
      )}
    </Animated.View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  iconCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  title: { color: colors.textSecondary, fontSize: font.lg, fontWeight: fontWeight.semibold },
  subtitle: {
    color: colors.textTertiary, fontSize: font.sm, textAlign: 'center',
    paddingHorizontal: spacing.xl, lineHeight: lineHeight.sm,
  },
  actionBtn: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg, paddingVertical: 10,
    borderRadius: radius.full, backgroundColor: colors.accent,
  },
  actionText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
});
