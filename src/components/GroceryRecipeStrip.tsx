import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, interaction, type Colors } from '../theme';
import { PillGroup, type PillGroupOption } from './PillGroup';
import type { ShoppedRecipe } from '../utils/groceryRecipeFilter';

interface Props {
  /** The recipes this trolley has rows for — see `shoppedRecipes`. */
  recipes: readonly ShoppedRecipe[];
  selected: readonly string[];
  onToggle: (recipeId: string) => void;
  onClear: () => void;
}

/**
 * "Shopping for: Chili · Ragù" above the grocery list, each one a toggle that
 * narrows the list to the rows that recipe calls for.
 *
 * **A `PillGroup` rather than a hand-rolled row**, because the set has no
 * ceiling: it is the planned meals inside the shop window *plus* every recipe
 * added straight to the list, and nothing bounds how many recipes one shop is
 * for. That is the case CLAUDE.md names — pills mapped straight into
 * `TouchableOpacity` are what had the grocery item sheet pushing the fields it
 * exists to edit off the first screen, and this sits directly above the list it
 * would push down. Past the cap it collapses to one "N more" with a find field,
 * and a selected pill is never hidden, both of which come from `PillGroup`.
 *
 * **Not the bottom sheet** `RecipeTagFilterSheet` and `LogbookFilterSheet` use,
 * though. That rule is for a vocabulary with a long tail worth searching; this
 * is usually three or four pills, and putting a tap and a dismissal in front of
 * a filter whose whole point is being glanceable mid-shop would cost more than
 * it saves. The cap is what handles the tail here instead.
 *
 * Renders nothing at all when there is nothing to offer, which is the common
 * case for anyone neither meal planning nor shopping from a recipe: an empty
 * caption over an empty row is worse than no strip, and this must not cost
 * height on a list it can say nothing about.
 */
export function GroceryRecipeStrip({ recipes, selected, onToggle, onClear }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const options = useMemo<PillGroupOption[]>(
    () =>
      recipes.map(recipe => ({
        key: recipe.recipeId,
        label: recipe.title,
        // A tick rather than a 0 once everything it needs is in the cart: the
        // count is how much is left to find, and "0" reads as a quantity.
        suffix: recipe.remaining === 0 ? '✓' : `${recipe.remaining}`,
        selected: selected.includes(recipe.recipeId),
        accessibilityLabel:
          recipe.remaining === 0
            ? `${recipe.title}, everything in the cart`
            : `${recipe.title}, ${recipe.remaining} still to buy`,
        onPress: () => onToggle(recipe.recipeId),
      })),
    [recipes, selected, onToggle]
  );

  if (recipes.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>Shopping for</Text>
        {selected.length > 0 && (
          <TouchableOpacity
            onPress={onClear}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel="Show all items again"
          >
            <Text style={styles.clear}>Show all</Text>
          </TouchableOpacity>
        )}
      </View>
      {/* No onCreate: a recipe is not something you can invent from the grocery
          list, so the grid is pick-only and the create affordance goes with it. */}
      <PillGroup options={options} noun="recipe" surface="page" />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  // Margin on both sides it needs, not just the one above — the list below has
  // no top margin of its own. See the spacing note in CLAUDE.md.
  wrap: { paddingHorizontal: spacing.md, marginTop: spacing.sm, marginBottom: spacing.md },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  // The app's section-header treatment, textSecondary rather than tertiary for
  // the contrast reason CLAUDE.md gives.
  label: {
    color: colors.textSecondary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  clear: { color: colors.accent, fontSize: font.sm },
});
