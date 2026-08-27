import React, { useMemo } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { font, fontWeight, radius, spacing, type Colors } from '../theme';
import { PressableScale } from './PressableScale';
import { CountStepper } from './CountStepper';
import {
  RECIPE_SCALE_FACTORS,
  factorForServings,
  formatScale,
  normalizeScale,
  targetServingsFor,
} from '../utils/recipeScale';
import { formatServingsRange } from '../utils/recipeUtils';
import { haptics } from '../utils/haptics';

// Same ceiling RecipeEditor's own servings stepper caps `Recipe.servings` at —
// the base a target is a ratio against can never exceed it, so the target
// shouldn't claim to reach further either.
const MAX_SERVINGS = 99;

interface Props {
  /** The live factor. Anything absent or nonsense renders as 1× selected. */
  value: number;
  onChange: (factor: number) => void;
  /**
   * The recipe's own serving count, low end of a range — what a typed target
   * is a ratio *against*. Absent for a recipe that never gave one, which is
   * what hides the stepper below: there's nothing to compute a ratio without.
   */
  baseServings?: number | null;
  /**
   * The high end of a range ("serves 4-6"), shown as a static caption under
   * the stepper — the stepper itself only ever targets the low end, since
   * typing one number can't drive two.
   */
  baseServingsMax?: number | null;
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
 * Chips for the *common* factors — the useful ones are a short closed set,
 * and half is one of them, so a stepper over ½, 1, 1½ … would have no natural
 * step. But "makes 8, I need 3" is a genuinely open-ended number, which is
 * exactly the case this app otherwise reaches for a `CountStepper` over a
 * chip row for (see its own doc comment) — so when the recipe knows its own
 * serving count, a stepper renders below the chips, targeting servings
 * directly rather than making the cook do the division themselves. It's a
 * second view of the one `value` factor, not a separate setting: picking a
 * chip moves the stepper, typing a number moves the chip selection (usually
 * to none, since most targets aren't a preset).
 */
export function RecipeScaleChips({
  value,
  onChange,
  baseServings,
  baseServingsMax,
  surface = 'background',
  style,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const active = normalizeScale(value);
  const servings = baseServings != null && baseServings > 0
    ? targetServingsFor(baseServings, active)
    : null;
  const rangeLabel = baseServings != null && baseServingsMax != null
    ? formatServingsRange(baseServings, baseServingsMax)
    : null;

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
      {servings !== null && (
        <View style={styles.servingsBlock}>
          {/* A caption beside the stepper, not baked into its pill as
              format={n => `${n} servings`} — RecipeEditor's own servings
              stepper keeps the pill to a bare number and says what it's
              counting outside it (there as a CollapsibleField header, here as
              this label), and a pill wide enough for the word wrecks the
              "44pt key either side of the digits" sizing CountStepper is
              built around. */}
          <View style={styles.servingsRow}>
            <Text style={styles.servingsCaption}>Servings</Text>
            <CountStepper
              value={servings}
              onChange={next => {
                if (next === null) return; // no allowNull — a target below 1 isn't a thing
                haptics.tap();
                onChange(factorForServings(next, baseServings!));
              }}
              min={1}
              max={MAX_SERVINGS}
              label="Servings"
              describeValue={n => `${n} servings`}
            />
          </View>
          {!!rangeLabel && <Text style={styles.servingsHint}>Recipe says serves {rangeLabel}</Text>}
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // sm, not xs: the chips and the servings stepper are two controls, not one
  // wrapped row, and at 4pt the stepper's own 44pt keys sat hard against the
  // chips above them.
  wrap: { gap: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minWidth: 44,
    alignItems: 'center',
  },
  chipOnBackground: { backgroundColor: colors.bgSecondary },
  chipOnCard: { backgroundColor: colors.bgTertiary },
  chipSelected: { backgroundColor: colors.accent },
  chipText: { color: colors.text, fontSize: font.sm },
  chipTextSelected: { color: colors.onAccent, fontWeight: fontWeight.medium },
  servingsBlock: { gap: 4 },
  servingsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  servingsCaption: { color: colors.textSecondary, fontSize: font.sm },
  servingsHint: { color: colors.textTertiary, fontSize: font.xs },
});
