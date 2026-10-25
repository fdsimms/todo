import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useBulkBarPresenceStore } from '../store/useBulkBarPresenceStore';
import { useFabPresenceStore } from '../store/useFabPresenceStore';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, iconSize, interaction, type Colors } from '../theme';
import { useBottomBarHeight } from '../hooks/useBottomBarHeight';
import { FAB_SIZE, useFabBottom } from './Fab';
import { activeKitchenTimer, cookTimerElapsed, isCookTimerRunning, isPrepTimerRunning, prepTimerElapsed } from '../utils/recipeTimer';
import { formatStopwatch } from '../utils/effort';
import { haptics } from '../utils/haptics';
import { resetToRecipeDetail } from '../navigation/navigationRef';
import { GlassLayer, glassSupported } from './GlassLayer';

/**
 * "Cooking Chili · 4:12" (or "Prepping Chili"), floating just above the tab bar on every screen while a
 * recipe's cook or prep timer is running — the one way back into Cook Mode once
 * RecipeDetailScreen is left behind. A shopping trip gets `ActiveTripBanner`
 * on the four kitchen screens because there's always a kitchen screen to
 * stand on mid-shop; a cook has no equivalent "somewhere relevant" — the
 * point of starting the timer and walking away is to go do something else
 * entirely while it simmers — so this is app-wide instead.
 *
 * `ActiveTripBanner`'s own doc comment records that a truly app-wide floating
 * bar (`PersistentTripBar`) was tried for the shopping trip and removed for
 * showing on screens a trip had nothing to do with. Cooking doesn't have that
 * problem the same way — every screen is somewhere you might be while
 * something's on the stove — but the fix stays narrow anyway: it is gated on
 * `kitchenEnabled`, so turning kitchen features off doesn't leave a bar
 * pointing at a screen the drawer no longer lists.
 *
 * Prep timers show here too. They used to get only an unlabelled dot on the
 * More tab, which said something was running but not what, or where to stop it.
 *
 * Names only one timer (`activeKitchenTimer`: a cook timer first, else a prep
 * timer). Two at once is real but rare, and nothing here refuses it — a
 * second row or a count would be a lot of chrome; finishing the one shown
 * brings up the next.
 */
export function CookingBar() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const barHeight = useBottomBarHeight();
  const fabBottom = useFabBottom();
  const styles = makeStyles(colors);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const timing = useRecipeStore(useShallow(s => s.recipes.filter(r => isCookTimerRunning(r) || isPrepTimerRunning(r))));
  const active = activeKitchenTimer(timing);
  const recipe = active?.recipe;
  const prep = active?.kind === 'prep';
  // Its offset above the tab bar is where a bulk bar's count and close button
  // land, so it steps aside while one is up rather than covering them.
  const bulkSelecting = useBulkBarPresenceStore(s => s.count > 0);
  const shown = kitchenEnabled && !!recipe && !bulkSelecting;
  const fabShown = useFabPresenceStore(s => s.count > 0);
  const fabHand = useSettingsStore(s => s.fabHand);

  // Same once-a-second-while-visible clock useRecipeTimer keeps, kept
  // separately here rather than through that hook: this has no single
  // recipe to bind it to until `recipe` is resolved, and unlike the sheet,
  // this component never unmounts, so the interval has to start and stop
  // itself as `shown` changes instead of coming free with mount/unmount.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!shown) return;
    setNowTick(Date.now());
    const interval = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [shown, recipe?.id, prep]);

  if (!shown) return null;

  const elapsed = formatStopwatch(prep ? prepTimerElapsed(recipe, nowTick) : cookTimerElapsed(recipe, nowTick));
  const verb = prep ? 'Prepping' : 'Cooking';
  // Just above the tab bar, stopping short of the add button's corner when the
  // screen has one (it rests in the same band, see `FAB_BOTTOM_OFFSET`). With a button, the bar is
  // centered on it vertically instead: the wrap is the button's own height, at its bottom.
  const bottom = insets.bottom + barHeight + spacing.sm;
  const clearance = spacing.lg + FAB_SIZE + spacing.sm;
  const sideInset = fabShown ? { [fabHand === 'left' ? 'left' : 'right']: clearance } : null;

  return (
    <View
      style={[styles.wrap, fabShown ? { bottom: fabBottom, height: FAB_SIZE, justifyContent: 'center' } : { bottom }, sideInset]}
      pointerEvents="box-none"
    >
      <TouchableOpacity
        style={[styles.bar, glassSupported() ? styles.barGlass : shadows.fab]}
        activeOpacity={interaction.activeOpacity}
        onPress={() => { haptics.tap(); resetToRecipeDetail(recipe.id, { openCookMode: true }); }}
        accessibilityRole="button"
        accessibilityLabel={`${verb} ${recipe.name}, ${elapsed} elapsed. Return to cook mode`}
      >
        <GlassLayer interactive style={styles.glassRadius} />
        <Ionicons name={prep ? 'timer-outline' : 'flame'} size={iconSize.sm} color={colors.orangeText} />
        <Text style={styles.text} numberOfLines={1}>
          {verb} <Text style={styles.name}>{recipe.name}</Text>
        </Text>
        <Text style={styles.elapsed}>{elapsed}</Text>
        <Ionicons name="chevron-forward" size={iconSize.xs} color={colors.textTertiary} />
      </TouchableOpacity>
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
    gap: spacing.xs,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.lg,
    borderWidth: border.md,
    borderColor: colors.separator,
    paddingVertical: spacing.smd,
    paddingHorizontal: spacing.md,
  },
  // The glass supplies its own fill, edge and depth, so the solid card's come off together.
  barGlass: {
    backgroundColor: 'transparent',
    borderWidth: 0,
  },
  glassRadius: { borderRadius: radius.lg },
  text: { flex: 1, color: colors.text, fontSize: font.md },
  name: { fontWeight: fontWeight.bold },
  elapsed: { color: colors.textSecondary, fontSize: font.sm, fontVariant: ['tabular-nums'] },
});
