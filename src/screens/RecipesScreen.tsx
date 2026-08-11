import React, { useCallback, useMemo, useState } from 'react';
import {
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
import { ScreenHeader } from '../components/ScreenHeader';
import { GroceriesHubPills } from '../components/GroceriesHubPills';
import { EmptyState } from '../components/EmptyState';
import { QuickAddNameSheet } from '../components/QuickAddNameSheet';
import { RecipeCreateSheet } from '../components/RecipeCreateSheet';
import { Fab, FabMenu, FAB_SIZE, type FabMenuItem } from '../components/Fab';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { cleanRecipeName, countLikelyInPantry, describeCookHistory, describeRecipe, rankRecipeSuggestions, rankRecipes } from '../utils/recipeUtils';
import { recipeMap } from '../utils/recipeComponents';
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
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const groceryItems = useGroceryStore(useShallow(s => s.items));

  const [query, setQuery] = useState('');
  const [addVisible, setAddVisible] = useState(false);
  const [importVisible, setImportVisible] = useState(false);

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
    const byId = recipeMap(recipes);
    const map = new Map<string, number>();
    for (const recipe of visible) {
      const count = countLikelyInPantry(recipe, groceryItems, now, byId);
      if (count !== null) map.set(recipe.id, count);
    }
    return map;
  }, [visible, recipes, groceryItems]);

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

  const renderRecipe = ({ item: recipe }: { item: Recipe }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => openRecipe(recipe)}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`${recipe.name}. ${describeRecipe(recipe, pantryCounts.get(recipe.id))}`}
      accessibilityHint="Double tap to open this recipe."
    >
      <View style={[styles.icon, { backgroundColor: colors.accentSubtle }]}>
        <Ionicons name="restaurant-outline" size={18} color={colors.accent} />
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={2}>{recipe.name}</Text>
        <Text style={styles.meta} numberOfLines={1}>
          {[describeRecipe(recipe, pantryCounts.get(recipe.id)), describeCookHistory(recipe)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      {recipe.favorite && (
        <Ionicons name="star" size={iconSize.sm} color={colors.orange} />
      )}
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </TouchableOpacity>
  );

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
              ListHeaderComponent={cookAgainShelf}
              ListFooterComponent={<View style={{ height: tabBarHeight + FAB_SIZE + spacing.xl }} />}
            />
          )}
        </>
      )}

      {/* Without a key there is only one way to add a recipe, and a one-item
          menu is worse than the plain button it replaced. */}
      {anthropicApiKey ? (
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
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
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
