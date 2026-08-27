import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { Recipe } from '../types';
import { useColors } from '../theme/ThemeContext';
import { spacing, radius, font, fontWeight, border, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { useRecipeStore } from '../store/useRecipeStore';
import { describeRecipe, rankRecipes, sortRecipesForDisplay } from '../utils/recipeUtils';
import { recipeMap, wouldCreateRecipeCycle } from '../utils/recipeComponents';
import { EmptyState } from './EmptyState';
import { SheetHeaderButton } from './SheetHeaderButton';

interface Props {
  visible: boolean;
  /** The recipe a component is being added to — excluded from the list, and the pivot for loop checks. */
  recipe: Recipe;
  onClose: () => void;
  onSelect: (component: Recipe) => void;
}

/**
 * Picks a recipe to use as a part of another — NestedTemplatePicker's shape,
 * with a search field because a recipe box gets longer than a template list
 * does.
 *
 * Ineligible candidates are shown disabled with the reason rather than
 * filtered out: "Mashed potatoes" not being in the list at all reads as it
 * having been deleted, when in fact it's already a component (or would make a
 * loop). Same call NestedTemplatePicker makes.
 */
export function RecipeComponentPicker({ visible, recipe, onClose, onSelect }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const recipes = useRecipeStore(useShallow(s => s.recipes));

  const [query, setQuery] = useState('');
  useEffect(() => { if (visible) setQuery(''); }, [visible]);

  const alreadyUsed = useMemo(
    () => new Set(recipe.components.map(c => c.recipeId)),
    [recipe.components]
  );

  const candidates = useMemo(() => {
    const byId = recipeMap(recipes);
    const ranked = query.trim()
      ? rankRecipes(query, recipes)
      : sortRecipesForDisplay(recipes);
    return ranked
      .filter(r => r.id !== recipe.id)
      .map(candidate => ({
        recipe: candidate,
        reason: alreadyUsed.has(candidate.id)
          ? 'Already a component'
          : wouldCreateRecipeCycle(byId, recipe.id, candidate.id)
            ? 'Would create a loop'
            : null,
      }));
  }, [recipes, recipe.id, query, alreadyUsed]);

  const handleSelect = (candidate: Recipe) => {
    haptics.success();
    onSelect(candidate);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <SheetHeaderButton label="Cancel" role="cancel" onPress={onClose} minWidth={60} />
          <Text style={styles.headerTitle} numberOfLines={1}>Add a component</Text>
          {/* Balances Cancel so the title stays optically centered. */}
          <View style={styles.headerSpacer} />
        </View>

        {recipes.length <= 1 ? (
          <EmptyState
            icon="restaurant-outline"
            title="No other recipes"
            subtitle="Save the shared part as its own recipe first. Then it can be used inside this one"
          />
        ) : (
          <>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search recipes"
                placeholderTextColor={colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                returnKeyType="search"
                clearButtonMode="while-editing"
                accessibilityLabel="Search recipes"
              />
            </View>

            {candidates.length === 0 ? (
              <EmptyState
                icon="search-outline"
                title="Nothing matched"
                subtitle={`No recipe here is called “${query.trim()}” or uses it`}
              />
            ) : (
              <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
                {candidates.map(({ recipe: candidate, reason }) => (
                  <TouchableOpacity
                    key={candidate.id}
                    style={[styles.row, !!reason && styles.rowDisabled]}
                    onPress={() => !reason && handleSelect(candidate)}
                    disabled={!!reason}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`${candidate.name}. ${reason ?? describeRecipe(candidate)}`}
                    accessibilityState={{ disabled: !!reason }}
                  >
                    <View style={[styles.icon, { backgroundColor: colors.accentSubtle }]}>
                      <Ionicons
                        name="restaurant-outline"
                        size={16}
                        color={reason ? colors.textTertiary : colors.accent}
                      />
                    </View>
                    <View style={styles.info}>
                      <Text style={[styles.name, !!reason && styles.nameDisabled]} numberOfLines={1}>
                        {candidate.name}
                      </Text>
                      <Text style={styles.hint} numberOfLines={1}>{reason ?? describeRecipe(candidate)}</Text>
                    </View>
                    {!reason && <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />}
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </>
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
  headerSpacer: { minWidth: 60 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: font.md },
  list: { paddingVertical: spacing.sm, paddingBottom: spacing.xl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    gap: spacing.md,
  },
  rowDisabled: { opacity: 0.5 },
  icon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, gap: 2 },
  name: { color: colors.text, fontSize: font.md, fontWeight: fontWeight.medium },
  nameDisabled: { color: colors.textTertiary },
  hint: { color: colors.textTertiary, fontSize: font.xs },
});
