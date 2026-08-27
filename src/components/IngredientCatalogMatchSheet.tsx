import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { RecipeIngredient } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import {
  catalogMatchSummary,
  matchIngredientsToCatalog,
  type IngredientCatalogMatch,
} from '../utils/ingredientCatalogMatch';
import { EditorSheet } from './EditorSheet';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';

interface Props {
  visible: boolean;
  recipeId: string;
  /**
   * Ingredient ids to review, or null for the whole recipe. The paste banner
   * passes the lines its own paste just added, so a review triggered by adding
   * six ingredients doesn't open onto thirty.
   */
  scopeIds: readonly string[] | null;
  onClose: () => void;
  /** Opens one line in the full ingredient sheet — the "no thanks, let me look" way out. */
  onEditIngredient: (ingredient: RecipeIngredient) => void;
}

/**
 * Every ingredient line on a recipe that doesn't resolve to a grocery item,
 * with what it probably meant, in one pass.
 *
 * **The gap this closes is that the catalog bridge was invisible.**
 * `RecipeIngredient.nameKey` has always resolved a line to a catalog row, but
 * nothing said whether it had — so a line one character or one leading word off
 * read exactly like a line naming something genuinely new, and the only way to
 * find out was to open each one. That is fine for the line you happen to be
 * editing and useless for a recipe you just pasted in.
 *
 * **It only ever offers.** Every row here is a suggestion the user takes or
 * leaves, and taking one does the single thing the app already does to link a
 * line: renames it to the catalog item's own name and lets `nameKey`'s existing
 * derivation follow (see `CatalogLinkPicker`, and "the join is nameKey and
 * nothing else" in docs/arch/groceries.md). Nothing here mints a catalog row,
 * and nothing here writes a key. A line the app can't place is listed and left
 * alone — most one-off ingredients are exactly that, and saying so is the
 * honest answer rather than a defect to clear.
 *
 * **Sorted suggestions first, then the unplaceable**, because only the first
 * group has an action. The second is there so the count in the header adds up
 * to something a person can see, not as a to-do list.
 */
export function IngredientCatalogMatchSheet({
  visible,
  recipeId,
  scopeIds,
  onClose,
  onEditIngredient,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const updateIngredient = useRecipeStore(s => s.updateIngredient);
  const recipeIngredients = useRecipeStore(
    useShallow(s => s.recipes.find(r => r.id === recipeId)?.ingredients ?? [])
  );
  const groceryItems = useGroceryStore(useShallow(s => s.items));

  const scoped = useMemo(() => {
    if (!scopeIds) return recipeIngredients;
    const ids = new Set(scopeIds);
    return recipeIngredients.filter(i => ids.has(i.id));
  }, [recipeIngredients, scopeIds]);

  // Recomputed on every store write rather than held in state, so a line
  // resolved from this very list drops out of it as soon as it's linked —
  // the row leaving is the confirmation, the way a ticked task leaves Today.
  const rows = useMemo(() => {
    const now = new Date();
    const matches = matchIngredientsToCatalog(scoped.map(i => i.name), groceryItems, now);
    const paired = scoped.map((ingredient, i) => ({ ingredient, match: matches[i] }));
    return {
      summary: catalogMatchSummary(matches),
      suggested: paired.filter(p => p.match.kind === 'suggested'),
      unknown: paired.filter(p => p.match.kind === 'unknown'),
    };
  }, [scoped, groceryItems]);

  const accept = (ingredient: RecipeIngredient, match: IngredientCatalogMatch) => {
    if (!match.suggestedName) return;
    haptics.success();
    animateLayout();
    // The one way a line is linked anywhere in this app: rename it, and let
    // updateIngredient's own `nameKey: groceryNameKey(next.name)` follow.
    updateIngredient(recipeId, ingredient.id, { name: match.suggestedName });
  };

  const { summary, suggested, unknown } = rows;

  return (
    <EditorSheet
      visible={visible}
      onRequestClose={onClose}
      rootStyle={styles.root}
      headerStyle={styles.header}
      scrollStyle={styles.scroll}
      scrollContentStyle={styles.scrollContent}
      header={
        <>
          <SheetHeaderButton label="Done" onPress={onClose} minWidth={40} />
          <Text style={styles.headerTitle}>In your grocery catalog</Text>
          <View style={styles.headerSpacer} />
        </>
      }
    >
      <Text style={styles.count}>
        {summary.linked} of {summary.total} already in your grocery catalog.
      </Text>

      {suggested.length === 0 && unknown.length === 0 ? (
        <EmptyState
          icon="basket-outline"
          title="Every ingredient is linked"
          subtitle="Each line here matches an item in your grocery catalog, so a brand, a store or a substitute set on either one reaches the other."
        />
      ) : null}

      {suggested.length > 0 && (
        <View style={styles.sectionCard}>
          <Text style={styles.groupLabel}>Did you mean</Text>
          {suggested.map(({ ingredient, match }) => (
            <View key={ingredient.id} style={styles.row}>
              <View style={styles.rowBody}>
                <Text style={styles.rowName} numberOfLines={1}>{ingredient.name}</Text>
                <View style={styles.rowArrow}>
                  <Ionicons name="arrow-forward" size={iconSize.xs} color={colors.textTertiary} />
                  <Text style={styles.rowTarget} numberOfLines={1}>{match.suggestedName}</Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.linkButton}
                activeOpacity={interaction.activeOpacity}
                onPress={() => accept(ingredient, match)}
                accessibilityRole="button"
                accessibilityLabel={`Rename ${ingredient.name} to ${match.suggestedName}`}
                accessibilityHint="Double tap to link this line to that item in your grocery catalog"
              >
                <Text style={styles.linkButtonText}>Link</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { haptics.tap(); onEditIngredient(ingredient); }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Open ${ingredient.name}`}
                accessibilityHint="Double tap to pick a different item, or leave this line as it is"
              >
                <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          ))}
          <Text style={styles.hint}>
            Linking renames the line to match the item in your grocery catalog. It
            doesn't add anything to your shopping list.
          </Text>
        </View>
      )}

      {unknown.length > 0 && (
        <View style={styles.sectionCard}>
          <Text style={styles.groupLabel}>Not in your catalog</Text>
          {unknown.map(({ ingredient }) => (
            <TouchableOpacity
              key={ingredient.id}
              style={styles.row}
              activeOpacity={interaction.activeOpacity}
              onPress={() => { haptics.tap(); onEditIngredient(ingredient); }}
              accessibilityRole="button"
              accessibilityLabel={`${ingredient.name}, not in your grocery catalog`}
              accessibilityHint="Double tap to search your grocery catalog for it, or add it"
            >
              <Text style={styles.rowName} numberOfLines={1}>{ingredient.name}</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
            </TouchableOpacity>
          ))}
          <Text style={styles.hint}>
            These aren't in your grocery catalog. Adding one lets you set a brand, a
            store, a price or a substitute for it. Most ingredients are bought once and
            don't need that.
          </Text>
        </View>
      )}
    </EditorSheet>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.separator,
    },
    headerTitle: { fontSize: font.lg, fontWeight: fontWeight.semibold, color: colors.text },
    headerSpacer: { minWidth: 40 },
    scroll: { flex: 1 },
    scrollContent: { padding: spacing.md, paddingBottom: spacing.xl },
    count: {
      fontSize: font.sm,
      color: colors.textSecondary,
      marginBottom: spacing.md,
      marginHorizontal: spacing.xs,
    },
    sectionCard: {
      backgroundColor: colors.bgSecondary,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    groupLabel: {
      fontSize: font.xs,
      fontWeight: fontWeight.semibold,
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.textSecondary,
      marginBottom: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
    },
    rowBody: { flex: 1, gap: 2 },
    rowName: { flex: 1, fontSize: font.md, color: colors.text },
    rowArrow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    rowTarget: { flex: 1, fontSize: font.sm, color: colors.textSecondary },
    linkButton: {
      backgroundColor: colors.accentSubtle,
      borderRadius: radius.full,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    linkButtonText: { fontSize: font.sm, fontWeight: fontWeight.semibold, color: colors.accent },
    hint: {
      fontSize: font.xs,
      color: colors.textTertiary,
      marginTop: spacing.sm,
      lineHeight: 16,
    },
  });
}
