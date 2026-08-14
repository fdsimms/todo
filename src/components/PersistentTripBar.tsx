import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useGroceryStore } from '../store/useGroceryStore';
import { resolveActiveTrip, isTripStale, describeTripElapsed } from '../utils/activeTrip';
import { openFinishShoppingFromTripBar, resetToGroceries } from '../navigation/navigationRef';
import { PressableScale } from './PressableScale';
import { TAB_BAR_HEIGHT } from './DemoBanner';
import { FAB_SIZE } from './Fab';
import { useColors, useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';

/**
 * "You're mid-trip and might forget" — the counterpart to `ActiveTripBanner`
 * (GroceryScreen.tsx), which only exists on the one screen a trip was started
 * from. Mounted once at the navigator root (AppNavigator.tsx), a sibling of
 * `NavigationContainer` like `DemoBanner`, so it floats above the tab bar on
 * every tab rather than only Groceries — that's the whole point, so don't
 * move it back inside a screen.
 *
 * Two states, not one: a plain status for most of a trip, and — past
 * `TRIP_STALE_MS` (activeTrip.ts), especially on reopening the app — a
 * warning-tinted nudge for a trip that's probably been left running rather
 * than actively shopped. `scheduleTripReminder` (notifications.ts) is the
 * other half of the same idea, for when the app isn't even open to show this.
 *
 * Positioned clear of the FAB band `DemoBanner`'s own note describes
 * (`insets.bottom + 64` to `+120` on Today) — full-width, so it can't dodge
 * into a corner the way that pill does, and has to sit above the whole band
 * instead. `TAB_BAR_HEIGHT + FAB_SIZE` is that band's height; the margin on
 * top is headroom, not a measurement.
 */
export function PersistentTripBar() {
  const colors = useColors();
  const { shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);

  const tripShopId = useGroceryStore(s => s.tripShopId);
  const tripStartedAt = useGroceryStore(s => s.tripStartedAt);
  const shops = useGroceryStore(useShallow(s => s.shops));
  const items = useGroceryStore(useShallow(s => s.items));
  const endTrip = useGroceryStore(s => s.endTrip);

  // Recomputed on mount and whenever the app returns to the foreground —
  // the same "no timer running to notice" reasoning checkTripExpiry
  // (useGroceryStore.ts) and isTripLive's own doc comment give for reading a
  // stamp against the clock only at natural trigger points, rather than
  // ticking one live while the bar sits on screen.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') setNow(new Date());
    });
    return () => sub.remove();
  }, []);

  const shop = resolveActiveTrip(tripShopId, tripStartedAt, shops, now);
  if (!shop || !tripStartedAt) return null;

  const stale = isTripStale(tripStartedAt, now);
  const elapsed = describeTripElapsed(tripStartedAt, now);

  const handleBody = () => {
    haptics.tap();
    resetToGroceries();
  };

  const handleFinish = () => {
    haptics.tap();
    openFinishShoppingFromTripBar();
  };

  const handleClear = () => {
    haptics.tap();
    endTrip();
  };

  return (
    <View
      style={[styles.wrap, { bottom: insets.bottom + TAB_BAR_HEIGHT + FAB_SIZE + spacing.lg }]}
      pointerEvents="box-none"
    >
      <View style={[styles.bar, stale && styles.barStale, shadows.fab]}>
        <TouchableOpacity
          style={styles.summary}
          onPress={handleBody}
          activeOpacity={interaction.activeOpacity}
          accessibilityRole="button"
          accessibilityLabel={`Shopping at ${shop.name}, ${elapsed}. Opens the grocery list.`}
        >
          <View style={[styles.iconBadge, stale && styles.iconBadgeStale]}>
            <Ionicons
              name="storefront-outline"
              size={iconSize.md}
              color={stale ? colors.onWarning : colors.accent}
            />
          </View>
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1}>
              {stale ? `Still at ${shop.name}?` : `Shopping at ${shop.name}`}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {stale ? `${elapsed} · reopened` : elapsed}
            </Text>
          </View>
        </TouchableOpacity>
        <PressableScale
          style={[styles.cta, stale && styles.ctaStale]}
          onPress={handleFinish}
          accessibilityLabel={`Finish shopping at ${shop.name}`}
        >
          <Text style={[styles.ctaText, stale && styles.ctaTextStale]}>
            {stale ? 'Finish shopping' : 'Finish'}
          </Text>
        </PressableScale>
        <PressableScale
          style={styles.dismiss}
          hitSlop={8}
          onPress={handleClear}
          accessibilityLabel={`Stop shopping at ${shop.name}`}
        >
          <Ionicons name="close" size={iconSize.sm} color={stale ? colors.text : colors.textTertiary} />
        </PressableScale>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgSunken,
    borderRadius: radius.lg,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  barStale: {
    backgroundColor: colors.warningBg,
  },
  summary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSubtle,
  },
  iconBadgeStale: {
    backgroundColor: colors.warning,
  },
  text: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.bold },
  subtitle: { color: colors.textSecondary, fontSize: font.sm, marginTop: 1 },
  cta: {
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  ctaStale: {
    backgroundColor: colors.warning,
  },
  ctaText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.bold },
  ctaTextStale: { color: colors.onWarning },
  dismiss: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
