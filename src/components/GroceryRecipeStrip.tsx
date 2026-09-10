import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import type { ShoppedRecipe } from '../utils/groceryRecipeFilter';

interface Props {
  /** The planned recipes this trolley has rows for — see `shoppedRecipes`. */
  recipes: readonly ShoppedRecipe[];
  selected: readonly string[];
  onToggle: (recipeId: string) => void;
  onClear: () => void;
}

/**
 * "Shopping for: Chili · Ragù" above the grocery list, each one a toggle that
 * narrows the list to the rows that recipe calls for.
 *
 * **Wrapping pills rather than a filter sheet**, which is the one place this
 * departs from the rule CLAUDE.md sets for `RecipeTagFilterSheet` and
 * `LogbookFilterSheet`. That rule is about an *open-ended* vocabulary: a tag box
 * or an aisle list has no ceiling a phone-width row can assume, so hiding the
 * tail behind a swipe loses options nobody is prompted to look for. This set is
 * bounded by the plan — the meals inside the shop window that have anything in
 * the trolley, which is a handful — so the whole of it fits on screen, and a
 * sheet would put a tap and a dismissal in front of a filter whose entire point
 * is being glanceable while you shop. Multi-select, so they are checkboxes
 * rather than a segmented track (see the control table in CLAUDE.md).
 *
 * Renders nothing at all when the plan has nothing to offer, which is the common
 * case for anyone not meal planning: an empty caption over an empty row is worse
 * than no strip, and this must not cost height on a list it can say nothing
 * about.
 */
export function GroceryRecipeStrip({ recipes, selected, onToggle, onClear }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

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
      <View style={styles.pills}>
        {recipes.map(recipe => {
          const active = selected.includes(recipe.recipeId);
          const done = recipe.remaining === 0;
          return (
            <TouchableOpacity
              key={recipe.recipeId}
              style={[styles.pill, active && styles.pillActive]}
              onPress={() => onToggle(recipe.recipeId)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: active }}
              accessibilityLabel={
                done
                  ? `${recipe.title}, everything in the cart`
                  : `${recipe.title}, ${recipe.remaining} still to buy`
              }
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]} numberOfLines={1}>
                {recipe.title}
              </Text>
              {done ? (
                <Ionicons
                  name="checkmark"
                  size={iconSize.xs}
                  color={active ? colors.onAccent : colors.textSecondary}
                />
              ) : (
                <Text style={[styles.pillCount, active && styles.pillTextActive]}>
                  {recipe.remaining}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
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
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '100%',
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.bgQuaternary,
    backgroundColor: colors.bgTertiary,
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { color: colors.text, fontSize: font.sm, flexShrink: 1 },
  pillTextActive: { color: colors.onAccent },
  pillCount: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.semibold },
});
