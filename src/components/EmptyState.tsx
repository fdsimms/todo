import React, { useEffect, useMemo } from 'react';
import { Text, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Reanimated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  interpolate,
} from 'react-native-reanimated';
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
 *
 * **The entrance is Reanimated, and its styles are attached unconditionally
 * from the first render. Both halves of that are load-bearing** — this
 * component spent a long time showing up invisible, or stranded at some
 * arbitrary fraction of opacity, on every screen that has an empty state.
 *
 * The cause was RN's own `Animated` with `useNativeDriver`. A native-driven
 * value doesn't write back to its JS `_value` frame by frame, so what React
 * commits for `opacity: progress` is `progress.__getValue()` — still `0` for
 * the whole entrance. For those few hundred milliseconds the shadow tree says
 * *invisible* and only the native animated node is keeping the view on screen,
 * and RN re-asserts that stale `0` more often than it looks: it calls
 * `__restoreDefaultValues()` on the previous props node every time any prop
 * changes (`createAnimatedPropsHook`), and on Fabric that restores to what
 * React committed rather than to the view's default. Any re-render, tab blur,
 * or cell re-attach landing in that window — and the screens these sit on
 * re-render on every store change plus a 30s tick — could leave the view
 * wherever the native driver had got to, with nothing left to finish the job.
 *
 * A `settled` flag used to paper over this by swapping in plain style values
 * once the entrance finished. It only ever covered the *clean completion*
 * path, and `Animated.parallel` made even that worse: the callback waited on
 * the icon spring (~700ms) as well as the 250ms fade, so the danger window was
 * roughly three times longer than the animation the user actually sees. Any
 * run where the end callback didn't make it back to JS — a stopped or dropped
 * native animation, an end result with no `value` in it — never settled at all.
 *
 * Reanimated has none of that shape. The shared value is the single source of
 * truth on the UI thread, and animated props are re-applied after every React
 * commit, so there's no stale value to be clobbered by, no end callback the
 * resting look depends on, and a detached-then-re-attached view comes back
 * with the value it left with.
 *
 * And per the same note on `AnimatedCollapsible`: **don't make either style
 * conditional** (`cond && animatedStyle`). Reanimated records a style's
 * initial value on first render only, and attaching or detaching it later
 * moves the view in and out of its descriptor set — which is the other way to
 * arrive back at a permanently invisible empty state.
 */
export function EmptyState({ icon, title, subtitle, actionLabel, onAction, bottomOffset }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);
  const iconScale = useSharedValue(0.8);

  useEffect(() => {
    // Reduce Motion: appear in place, no fade-up or icon pop. Assigning a
    // plain number cancels any entrance already running, which matters because
    // the setting resolves asynchronously — the first pass through here always
    // sees `false`.
    if (reduceMotion) {
      progress.value = 1;
      iconScale.value = 1;
      return;
    }
    progress.value = withTiming(1, { duration: animation.duration.normal });
    iconScale.value = withSpring(1, animation.spring.smooth);
  }, [reduceMotion]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: interpolate(progress.value, [0, 1], [12, 0]) }],
  }));
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: iconScale.value }] }));

  return (
    <Reanimated.View
      style={[styles.container, { paddingBottom: bottomOffset ?? 0 }, containerStyle]}
    >
      <Reanimated.View style={[styles.iconCircle, iconStyle]}>
        <Ionicons name={icon} size={34} color={colors.textTertiary} />
      </Reanimated.View>
      <Text style={styles.title}>{title}</Text>
      {subtitle != null && <Text style={styles.subtitle}>{subtitle}</Text>}
      {actionLabel != null && onAction != null && (
        <PressableScale style={styles.actionBtn} onPress={onAction} haptic>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </PressableScale>
      )}
    </Reanimated.View>
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
    borderRadius: radius.full, backgroundColor: colors.accentFill,
  },
  actionText: { color: colors.onAccent, fontSize: font.md, fontWeight: fontWeight.semibold },
});
