import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { PressableScale } from './PressableScale';
import { useDemoStore } from '../store/useDemoStore';
import { useTheme } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

// The tab bar's own height, without the safe-area inset underneath it.
// Hard-coded because this banner renders outside the tab navigator (it's a
// sibling of the NavigationContainer, so it can sit over every screen), and
// useBottomTabBarHeight() throws when called from there.
const TAB_BAR_HEIGHT = 49;

// Always-visible marker that the list on screen isn't the user's own, and
// the way back out. Deliberately app-wide rather than a per-screen banner:
// demo mode swaps the whole data source, so there's no screen where "these
// aren't your tasks" doesn't apply, and no screen where being stuck in it
// would be acceptable.
//
// Sits bottom-left: every screen pads its own header by the top inset, so a
// top banner would cover titles, and the bottom-right corner belongs to the
// FABs.
export function DemoBanner() {
  const active = useDemoStore(s => s.active);
  const exitDemoMode = useDemoStore(s => s.exitDemoMode);
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (!active) return null;

  const onExit = () => {
    Alert.alert(
      'Exit demo mode?',
      'Your own tasks come back and everything created during the demo is discarded.',
      [
        { text: 'Stay in demo', style: 'cancel' },
        {
          text: 'Exit',
          onPress: () => {
            exitDemoMode();
            haptics.success();
          },
        },
      ]
    );
  };

  return (
    <View
      style={[styles.wrap, { bottom: insets.bottom + TAB_BAR_HEIGHT + spacing.md }]}
      pointerEvents="box-none"
    >
      <PressableScale
        style={[styles.pill, shadows.fab]}
        onPress={onExit}
        haptic
        accessibilityLabel="Demo mode is on. Tap to exit and restore your tasks."
      >
        <Ionicons name="sparkles" size={14} color={colors.onAccent} />
        <Text style={styles.label}>Demo mode</Text>
        <View style={styles.divider} />
        <Text style={styles.exit}>Exit</Text>
      </PressableScale>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'flex-start',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  label: {
    color: colors.onAccent,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: font.sm,
    backgroundColor: colors.onAccent,
    opacity: 0.4,
    marginHorizontal: spacing.xs,
  },
  exit: {
    color: colors.onAccent,
    fontSize: font.sm,
    fontWeight: fontWeight.bold,
  },
});
