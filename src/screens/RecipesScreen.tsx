import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  View,
  Text,
  FlatList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useShallow } from 'zustand/react/shallow';
import type { Recipe } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useRowSelection } from '../hooks/useRowSelection';
import { ScreenHeader } from '../components/ScreenHeader';
import { GroceriesHubPills } from '../components/GroceriesHubPills';
import { EmptyState } from '../components/EmptyState';
import { QuickAddNameSheet } from '../components/QuickAddNameSheet';
import { RecipeCreateSheet } from '../components/RecipeCreateSheet';
import { Fab, FabMenu, FAB_SIZE, type FabMenuItem } from '../components/Fab';
import { ListBulkBar } from '../components/ListBulkBar';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { cleanRecipeName, countLikelyInPantry, describeCookHistory, describeRecipe, rankRecipeSuggestions, rankRecipes } from '../utils/recipeUtils';
import { groceryNameKey } from '../utils/groceryParse';

/**
 * The recipe box.
 *
 * Deliberately flat — no recipe categories, which would be the fourth category
 * table in this app (task / project / template / recipe) for a list most people
 * will keep in the dozens. Favorites float to the top and the search field
 * ranks by name and by ingredient; if that stops being enough, categories are
 * the thing to add, not sections invented now.
 */
export function RecipesScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<any>();

  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const addRecipe = useRecipeStore(s => s.addRecipe);
  const bulkDeleteRecipes = useRecipeStore(s => s.bulkDeleteRecipes);
  const bulkSetFavorite = useRecipeStore(s => s.bulkSetFavorite);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const groceryItems = useGroceryStore(useShallow(s => s.items));

  const [query, setQuery] = useState('');
  const [addVisible, setAddVisible] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [bulkBarHeight, setBulkBarHeight] = useState(0);

  // Recipes are deliberately flat (no categories — see the note at the top of
  // this file), so there's nothing to reuse useTaskSelection's recurrence-aware
  // delete flow for. Plain useRowSelection plus a confirm-only delete, same
  // shape TemplatesScreen uses for its own non-task rows.
  const {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
  } = useRowSelection();

  // Bottom-up: "New recipe" ends up closest to the button, so the plain add is
  // still the one under your thumb.
  const addMenuItems = useMemo<FabMenuItem[]>(() => ([
    { key: 'import', label: 'From a photo', icon: 'camera-outline' },
    { key: 'name', label: 'New recipe', icon: 'add-circle-outline' },
  ]), []);

  const handleAddMenuSelect = useCallback((key: string) => {
    if (key === 'import') setImportVisible(true);
    else setAddVisible(true);
  }, []);

  const visible = useMemo(() => {
    const matched = rankRecipes(query, recipes);
    // rankRecipes already orders a search by weight; only the unfiltered list
    // needs the favourites-first pass, or a name match would lose its place to
    // a starred recipe that merely mentions the word.
    if (query.trim()) return matched;
    return [...matched].sort((a, b) =>
      Number(b.favorite) - Number(a.favorite) || a.sortOrder - b.sortOrder
    );
  }, [query, recipes]);

  // Only offered on the unfiltered list — a search is already a specific
  // question ("what has fennel"), and a shelf of suggestions above the
  // results would answer a question nobody asked.
  const cookAgain = useMemo(
    () => query.trim() ? [] : rankRecipeSuggestions(recipes, new Date()),
    [query, recipes]
  );

  // Computed once for the visible list rather than per row render — same
  // classifyPlanned pass RecipeToListSheet/AddWeekToListSheet already run,
  // just reduced to a count per recipe.
  const pantryCounts = useMemo(() => {
    const now = new Date();
    const map = new Map<string, number>();
    for (const recipe of visible) {
      const count = countLikelyInPantry(recipe, groceryItems, now);
      if (count !== null) map.set(recipe.id, count);
    }
    return map;
  }, [visible, groceryItems]);

  // "Favorite"/"Unfavorite" flips direction based on the selection itself, the
  // same way the grocery bulk bar's Check/Uncheck does — a selection that's
  // already all starred has nothing left to star.
  const allSelectedFavorited = useMemo(() => {
    if (selectedIds.size === 0) return false;
    return Array.from(selectedIds).every(id => recipes.find(r => r.id === id)?.favorite);
  }, [selectedIds, recipes]);

  // Extra bottom padding so the last rows aren't hidden behind the floating bar.
  const selectionListPadding = tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm;

  const handleBulkFavorite = () => {
    const next = !allSelectedFavorited;
    animateLayout();
    bulkSetFavorite(Array.from(selectedIds), next);
    haptics[next ? 'success' : 'tap']();
    exitSelection();
  };

  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    const count = ids.length;
    const plural = count === 1 ? 'recipe' : 'recipes';
    haptics.warning();
    Alert.alert(
      `Delete ${count} ${plural}?`,
      `You're about to delete ${count} ${plural}. Anything already on your grocery list stays there. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            bulkDeleteRecipes(ids);
            exitSelection();
          },
        },
      ],
    );
  };

  const openRecipe = (recipe: Recipe) => {
    haptics.tap();
    navigation.navigate('RecipeDetail', { recipeId: recipe.id });
  };

  const createRecipe = (name: string) => {
    setAddVisible(false);
    const recipe = addRecipe(name);
    if (recipe) {
      haptics.success();
      navigation.navigate('RecipeDetail', { recipeId: recipe.id });
      return;
    }
    // The only way addRecipe refuses a non-empty name is one already in the
    // box. Opening the recipe they already have beats an error — it's where
    // they were trying to get.
    const key = groceryNameKey(cleanRecipeName(name));
    const existing = recipes.find(r => r.nameKey === key);
    if (existing) openRecipe(existing);
  };

  const renderRecipe = ({ item: recipe }: { item: Recipe }) => {
    const selected = selectedIds.has(recipe.id);
    return (
      <TouchableOpacity
        style={[styles.row, selectionMode && selected && styles.rowSelected]}
        onPress={() => (selectionMode ? toggleSelection(recipe.id) : openRecipe(recipe))}
        activeOpacity={interaction.activeOpacity}
        accessibilityRole={selectionMode ? 'checkbox' : 'button'}
        accessibilityState={selectionMode ? { checked: selected } : undefined}
        accessibilityLabel={`${recipe.name}. ${describeRecipe(recipe, pantryCounts.get(recipe.id))}`}
        accessibilityHint={selectionMode ? 'Double tap to select recipe' : 'Double tap to open this recipe.'}
      >
        {selectionMode ? (
          // Takes the icon tile's place rather than sitting beside it, so every
          // row shifts by the same amount and the names stay in one column.
          <View style={styles.select}>
            <Ionicons
              name={selected ? 'checkmark-circle' : 'ellipse-outline'}
              size={24}
              color={selected ? colors.accent : colors.textTertiary}
            />
          </View>
        ) : (
          <View style={[styles.icon, { backgroundColor: colors.accentSubtle }]}>
            <Ionicons name="restaurant-outline" size={18} color={colors.accent} />
          </View>
        )}
        <View style={styles.info}>
          <Text style={styles.name} numberOfLines={2}>{recipe.name}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {[describeRecipe(recipe, pantryCounts.get(recipe.id)), describeCookHistory(recipe)].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {recipe.favorite && (
          <Ionicons name="star" size={iconSize.sm} color={colors.orange} />
        )}
        {!selectionMode && (
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        )}
      </TouchableOpacity>
    );
  };

  const cookAgainShelf = cookAgain.length === 0 ? null : (
    <View style={styles.shelf}>
      <Text style={styles.shelfLabel}>Cook again</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.shelfRow}
      >
        {cookAgain.map(recipe => (
          <TouchableOpacity
            key={recipe.id}
            style={styles.shelfCard}
            onPress={() => openRecipe(recipe)}
            activeOpacity={interaction.activeOpacity}
            accessibilityRole="button"
            accessibilityLabel={`${recipe.name}. ${describeCookHistory(recipe)}`}
          >
            <Text style={styles.shelfName} numberOfLines={2}>{recipe.name}</Text>
            <Text style={styles.shelfMeta} numberOfLines={1}>{describeCookHistory(recipe)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Recipes"
        subtitle={recipes.length > 0
          ? `${recipes.length} ${recipes.length === 1 ? 'recipe' : 'recipes'}`
          : undefined}
        actions={recipes.length > 0 ? [
          {
            icon: 'checkmark-circle-outline',
            onPress: () => (selectionMode ? exitSelection() : enterSelectionMode()),
            active: selectionMode,
            accessibilityLabel: selectionMode ? 'Done selecting' : 'Select recipes',
          },
        ] : undefined}
      />
      <GroceriesHubPills active="Recipes" />

      {recipes.length === 0 ? (
        <EmptyState
          icon="restaurant-outline"
          title="No recipes yet"
          subtitle="Keep what you cook here, with what it takes to shop for it — then put a whole recipe on the grocery list in one tap"
          actionLabel="New recipe"
          onAction={() => setAddVisible(true)}
          bottomOffset={tabBarHeight}
        />
      ) : (
        <>
          <View style={styles.searchWrap}>
            <Ionicons name="search" size={iconSize.sm} color={colors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search recipes and ingredients"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
              accessibilityLabel="Search recipes"
            />
          </View>

          {visible.length === 0 ? (
            <EmptyState
              icon="search-outline"
              title="Nothing matched"
              subtitle={`No recipe here is called “${query.trim()}” or uses it`}
              bottomOffset={tabBarHeight}
            />
          ) : (
            <FlatList
              data={visible}
              keyExtractor={r => r.id}
              renderItem={renderRecipe}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.list}
              // Hidden while selecting: it's a shortcut into a recipe, and
              // opening one out from under an in-progress selection would lose it.
              ListHeaderComponent={selectionMode ? null : cookAgainShelf}
              ListFooterComponent={
                <View style={{ height: selectionMode ? selectionListPadding : tabBarHeight + FAB_SIZE + spacing.xl }} />
              }
            />
          )}
        </>
      )}

      {/* The bulk bar sits where the button does, and adding a recipe isn't
          something you're doing mid-selection anyway. */}
      {!selectionMode && (anthropicApiKey ? (
        <FabMenu
          items={addMenuItems}
          onSelect={handleAddMenuSelect}
          accessibilityLabel="Add recipe"
          bottom={insets.bottom + tabBarHeight + spacing.md}
        />
      ) : (
        <Fab
          onPress={() => { haptics.tap(); setAddVisible(true); }}
          accessibilityLabel="Add recipe"
          bottom={insets.bottom + tabBarHeight + spacing.md}
        />
      ))}

      {selectionMode && (
        <ListBulkBar
          selectedCount={selectedIds.size}
          totalCount={visible.length}
          actions={[
            {
              key: 'favorite',
              icon: allSelectedFavorited ? 'star-outline' : 'star',
              label: allSelectedFavorited ? 'Unfavorite' : 'Favorite',
              onPress: handleBulkFavorite,
            },
            { key: 'delete', icon: 'trash', label: 'Delete', tone: 'destructive', onPress: handleBulkDelete },
          ]}
          onSelectAll={() => selectAll(visible.map(r => r.id))}
          onDeselectAll={deselectAll}
          onCancel={exitSelection}
          bottomInset={tabBarHeight}
          onHeightChange={setBulkBarHeight}
        />
      )}

      <QuickAddNameSheet
        visible={addVisible}
        placeholder="Recipe name"
        onSubmit={createRecipe}
        onClose={() => setAddVisible(false)}
      />

      <RecipeCreateSheet
        visible={importVisible}
        onClose={() => setImportVisible(false)}
        onCreated={recipeId => navigation.navigate('RecipeDetail', { recipeId })}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    // A box height rather than a lineHeight — RN maps lineHeight straight onto
    // the iOS paragraph style with no baseline compensation, which sits the
    // glyphs low in the field. See the note in CLAUDE.md.
    height: 40,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    padding: 0,
  },
  list: {
    paddingTop: spacing.xs,
  },
  shelf: {
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  shelfLabel: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginHorizontal: spacing.md,
  },
  shelfRow: {
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  shelfCard: {
    width: 160,
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: 3,
  },
  shelfName: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  shelfMeta: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  // Same inset-grouped card footprint as TaskItem and the Stacks rows.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.md,
  },
  rowSelected: {
    backgroundColor: colors.accent + '1A',
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Same footprint as the icon tile it replaces, so entering selection mode
  // doesn't move the row's text.
  select: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
    gap: 3,
  },
  name: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: fontWeight.medium,
  },
  meta: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
});
