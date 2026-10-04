import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CoinIcon } from './CoinIcon';
import { useRewardStore } from '../store/useRewardStore';
import { TAB_BAR_HEIGHT } from './DemoBanner';
import { useTheme } from '../theme/ThemeContext';
import { animation, border, font, fontWeight, iconSize, radius, spacing, type Colors } from '../theme';
import { formatCoins } from '../utils/rewards';

// Long enough to read a number, short enough that a run of ticks reads as a
// running tally rather than a queue of notices.
const VISIBLE_MS = 1500;

/**
 * The "+3 coins" a completion earns, said where it happens.
 *
 * An ordinary completion deliberately raises no undo bar (see `UndoBar`), so
 * without this the only sign a tick earned anything was a number on another
 * screen. A pill rather than a bar: it offers nothing to tap, takes no
 * touches (`pointerEvents="none"`), sits centered just above the tab bar where
 * it clears both the add button and the undo bar, and leaves on its own.
 * Losses get the same pill in red, since a slip or a miss moving the balance
 * silently is the same problem from the other side.
 *
 * Driven by `useRewardStore.lastChange`, which is only set for a change
 * happening now, so a backdated entry (the morning check-in, a widget tap
 * drained later) never announces itself on whatever screen comes next.
 * Mounted once at the navigator root beside `UndoBar`, for the same reason
 * that is: it is a moment after a tap, not a place.
 */
export function CoinToast() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const change = useRewardStore(s => s.lastChange);

  const [shown, setShown] = useState<typeof change>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!change) return;
    setShown(change);
    opacity.stopAnimation();
    Animated.timing(opacity, { toValue: 1, duration: animation.duration.fast, useNativeDriver: true }).start();
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: animation.duration.normal, useNativeDriver: true })
        .start(({ finished }) => { if (finished) setShown(null); });
    }, VISIBLE_MS);
  }, [change, opacity]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  if (!shown) return null;

  const earned = shown.kind === 'earn';
  const tint = earned ? colors.green : colors.red;
  const text = `${earned ? '+' : '-'}${formatCoins(shown.amount)}`;

  return (
    <View
      style={[styles.wrap, { bottom: insets.bottom + TAB_BAR_HEIGHT + spacing.md }]}
      pointerEvents="none"
    >
      <Animated.View
        style={[styles.pill, shadows.fab, { opacity }]}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={earned ? `Earned ${formatCoins(shown.amount)}` : `Lost ${formatCoins(shown.amount)}`}
      >
        <CoinIcon size={iconSize.sm} color={tint} />
        <Text style={[styles.label, { color: tint }]}>{text}</Text>
      </Animated.View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.full,
    borderWidth: border.md,
    borderColor: colors.separator,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.smd,
  },
  label: {
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
});
