import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { RECIPE_SCALE_FACTORS, formatScale, normalizeScale } from '../utils/recipeScale';
import { haptics } from '../utils/haptics';

interface Props {
  /** The live factor. Anything absent or nonsense renders as 1× selected. */
  value: number;
  onChange: (factor: number) => void;
  /**
   * "serves 8" — the scaled servings, when the recipe knows them. Rendered
   * beside the chips rather than inside one, because it's a consequence of the
   * pick, not another option.
   */
  servingsLabel?: string | null;
  /**
   * Which surface the row is sitting on, which decides the *unselected* chip's
   * fill. It has to be told: `bgTertiary` is `#EFEFF4` against a light theme's
   * `bg` of `#F2F2F7`, so a chip row on a screen background is very nearly
   * invisible until one is selected — the same reason GroceriesHubPills fills
   * its pills with `bgSecondary`. On a card or a raised sheet that inverts, and
   * `bgTertiary` is what separates.
   *
   * Defaults to `'background'`: two of the three callers (the recipe screen and
   * RecipeToListSheet, whose own root is `colors.bg`) are on one.
   */
  surface?: 'background' | 'card';
  style?: StyleProp<ViewStyle>;
}

/**
 * The ½ · 1 · 1½ · 2 · 3 row that halves or doubles a recipe.
 *
 * Shared between the recipe screen (where the factor is a way of *reading* the
 * recipe and lasts as long as you're looking at it) and the add-to-list sheets
 * (where it decides what goes in the trolley), so the control can't drift into
 * two shapes for one idea.
 *
 * Chips rather than a CountStepper, which is what this app otherwise reaches
 * for when a number is open-ended: the useful factors are a short closed set,
 * and half is one of them — a stepper over ½, 1, 1½ … has no natural step. The
 * factors are also deliberately not derived from a target servings count; see
 * RECIPE_SCALE_FACTORS.
 */
export function RecipeScaleChips({
  value,
  onChange,
  servingsLabel,
  surface = 'background',
  style,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const active = normalizeScale(value);

  return (
    <View style={[styles.wrap, style]}>
      <View style={styles.chips}>
        {RECIPE_SCALE_FACTORS.map(factor => {
          const on = Math.abs(factor - active) < 1e-9;
          return (
            <PressableScale
              key={factor}
              style={[
                styles.chip,
                surface === 'card' ? styles.chipOnCard : styles.chipOnBackground,
                on && styles.chipSelected,
              ]}
              onPress={() => {
                haptics.tap();
                onChange(factor);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={
                factor === 1 ? 'Cook as written' : `Cook ${formatScale(factor)} the recipe`
              }
            >
              <Text style={[styles.chipText, on && styles.chipTextSelected]}>
                {formatScale(factor)}
              </Text>
            </PressableScale>
          );
        })}
      </View>
      {!!servingsLabel && <Text style={styles.servings}>{servingsLabel}</Text>}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  wrap: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    minWidth: 44,
    alignItems: 'center',
  },
  chipOnBackground: { backgroundColor: colors.bgSecondary },
  chipOnCard: { backgroundColor: colors.bgTertiary },
  chipSelected: { backgroundColor: colors.accent },
  chipText: { color: colors.textSecondary, fontSize: font.sm },
  chipTextSelected: { color: colors.onAccent, fontWeight: fontWeight.medium },
  servings: { color: colors.textTertiary, fontSize: font.xs },
});
