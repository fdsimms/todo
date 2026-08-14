import React, { useMemo, useState } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, interaction, type Colors } from '../theme';
import { useRecipeStore } from '../store/useRecipeStore';
import { rankRecipes, describeRecipe } from '../utils/recipeUtils';
import { SheetHeaderButton } from './SheetHeaderButton';
import { EmptyState } from './EmptyState';
import { haptics } from '../utils/haptics';
import type { Recipe } from '../types';

interface Props {
  visible: boolean;
  /** Only offered when the user has an API key — importing costs a network call. */
  allowAIImport: boolean;
  onPickSaved: (recipe: Recipe) => void;
  onImportWithAI: () => void;
  onClose: () => void;
}

/** Enough to scan without virtualizing, same ceiling RecipePickerSheet uses. */
const MAX_ROWS = 30;

/**
 * The "From a recipe" entry point on the grocery add sheet: pick one already
 * in the recipe box, or fall through to the AI import (GroceryAISheet's
 * `recipe` mode) for one that isn't saved yet. Picking a saved recipe hands
 * off to RecipeToListSheet — the pantry-aware needToBuy/alreadyOnList/
 * probablyHave classification RecipeDetailScreen's "Add ingredients to list"
 * already uses — rather than re-running the AI over ingredients the app
 * already has structured.
 *
 * Deliberately not RecipePickerSheet: that sheet is meal-plan shaped (slot
 * chips, "Plan {day}", free-text presets like "Leftovers") and picking a
 * recipe there plans a night, it doesn't add to the list. This is the
 * simpler "just pick one" list the grocery flow actually needs.
 */
export function RecipeSourceSheet({ visible, allowAIImport, onPickSaved, onImportWithAI, onClose }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const [query, setQuery] = useState('');

  const matches = useMemo(() => {
    const ranked = query.trim()
      ? rankRecipes(query, recipes)
      : [...recipes].sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.sortOrder - b.sortOrder);
    return ranked.slice(0, MAX_ROWS);
  }, [query, recipes]);

  const reset = () => setQuery('');

  const handleClose = () => {
    reset();
    onClose();
  };

  const pickSaved = (recipe: Recipe) => {
    haptics.tap();
    reset();
    onPickSaved(recipe);
  };

  const importWithAI = () => {
    haptics.tap();
    reset();
    onImportWithAI();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={handleClose} minWidth={72} />
          <Text style={styles.headerTitle}>From a recipe</Text>
          <View style={{ minWidth: 72 }} />
        </View>

        {recipes.length > 0 && (
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={15} color={colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search your recipes"
              placeholderTextColor={colors.textTertiary}
              autoCorrect={false}
              returnKeyType="search"
              accessibilityLabel="Search your recipes"
            />
          </View>
        )}

        {allowAIImport && (
          <TouchableOpacity
            style={styles.importRow}
            activeOpacity={interaction.activeOpacity}
            onPress={importWithAI}
            accessibilityRole="button"
            accessibilityLabel="Import a new recipe with AI"
          >
            <View style={[styles.rowIcon, { backgroundColor: colors.accentSubtle }]}>
              <Ionicons name="sparkles" size={16} color={colors.purple} />
            </View>
            <View style={styles.rowInfo}>
              <Text style={styles.rowName}>Import a new recipe</Text>
              <Text style={styles.rowHint}>Paste text or a photo. Not saved to your recipe box</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </TouchableOpacity>
        )}

        {recipes.length === 0 ? (
          <View style={styles.centered}>
            <EmptyState
              icon="restaurant-outline"
              title="No saved recipes yet"
              subtitle={
                allowAIImport
                  ? 'Import one above, or save recipes from the Recipes tab.'
                  : 'Save a recipe from the Recipes tab to add its ingredients here.'
              }
            />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
            {matches.length === 0 ? (
              <View style={styles.centered}>
                <Text style={styles.emptySub}>No matches in your recipe box.</Text>
              </View>
            ) : (
              matches.map((recipe, idx) => (
                <React.Fragment key={recipe.id}>
                  {idx > 0 && <View style={styles.inlineSep} />}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => pickSaved(recipe)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ingredients from ${recipe.name}. ${describeRecipe(recipe)}`}
                  >
                    <View style={[styles.rowIcon, { backgroundColor: colors.accentSubtle }]}>
                      <Ionicons name="restaurant-outline" size={16} color={colors.accent} />
                    </View>
                    <View style={styles.rowInfo}>
                      <Text style={styles.rowName} numberOfLines={1}>{recipe.name}</Text>
                      <Text style={styles.rowHint} numberOfLines={1}>{describeRecipe(recipe)}</Text>
                    </View>
                    {recipe.favorite && <Ionicons name="star" size={13} color={colors.orange} />}
                  </TouchableOpacity>
                </React.Fragment>
              ))
            )}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  headerTitle: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.semibold },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.bgTertiary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    paddingVertical: 8,
  },
  importRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  emptySub: { color: colors.textTertiary, fontSize: font.sm, textAlign: 'center' },
  list: { paddingTop: spacing.md, paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  rowHint: { color: colors.textTertiary, fontSize: font.xs },
  inlineSep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + 32 + spacing.md,
  },
});
