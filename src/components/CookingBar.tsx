import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRecipeStore } from '../store/useRecipeStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTheme } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, iconSize, interaction, type Colors } from '../theme';
import { TAB_BAR_HEIGHT } from './DemoBanner';
import { FAB_SIZE } from './Fab';
import { cookTimerElapsed, isCookTimerRunning } from '../utils/recipeTimer';
import { formatStopwatch } from '../utils/effort';
import { haptics } from '../utils/haptics';
import { resetToRecipeDetail } from '../navigation/navigationRef';

/**
 * "Cooking Chili · 4:12", floating above the tab bar on every screen while a
 * recipe's cook timer is running — the one way back into Cook Mode once
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
 * something's on the stove — but the fix stays narrow anyway: cook timers
 * only, not prep (prep keeps the tab-icon dot it already had, `hasRunning-
 * RecipeTimer`'s doc comment), and gated on `kitchenEnabled` the same as that
 * dot, so turning kitchen features off doesn't leave a bar pointing at a
 * screen the drawer no longer lists.
 *
 * Names only the *first* recipe with a running cook timer. Two cooking at
 * once is real but rare, and nothing here refuses it — a second row or a
 * count would be a lot of chrome for a case that still has the tab dot as a
 * fallback.
 */
export function CookingBar() {
  const { colors, shadows } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(colors);
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const cooking = useRecipeStore(useShallow(s => s.recipes.filter(isCookTimerRunning)));
  const recipe = cooking[0];
  const shown = kitchenEnabled && !!recipe;

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
  }, [shown, recipe?.timerStartedAt]);

  if (!shown) return null;

  const elapsed = formatStopwatch(cookTimerElapsed(recipe, nowTick));
  const bottom = insets.bottom + TAB_BAR_HEIGHT + FAB_SIZE + spacing.lg;

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <TouchableOpacity
        style={[styles.bar, shadows.fab]}
        activeOpacity={interaction.activeOpacity}
        onPress={() => { haptics.tap(); resetToRecipeDetail(recipe.id, true); }}
        accessibilityRole="button"
        accessibilityLabel={`Cooking ${recipe.name}, ${elapsed} elapsed. Return to cook mode`}
      >
        <Ionicons name="flame" size={iconSize.sm} color={colors.orange} />
        <Text style={styles.text} numberOfLines={1}>
          Cooking <Text style={styles.name}>{recipe.name}</Text>
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
  text: { flex: 1, color: colors.text, fontSize: font.md },
  name: { fontWeight: fontWeight.bold },
  elapsed: { color: colors.textSecondary, fontSize: font.sm, fontVariant: ['tabular-nums'] },
});
