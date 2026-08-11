import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  View,
  Text,
  FlatList,
  SectionList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Image,
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
import { Fab, FabMenu, FAB_SIZE, type FabDragHandlers, type FabMenuItem } from '../components/Fab';
import { ListBulkBar } from '../components/ListBulkBar';
import { useSettingsStore } from '../store/useSettingsStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { cleanRecipeName, countLikelyInPantry, describeCookHistory, describeRecipe, groupRecipesByMealType, rankRecipeSuggestions, rankRecipes, sortRecipesForDisplay } from '../utils/recipeUtils';
import { recipeMap } from '../utils/recipeComponents';
import { allRecipeTags, filterRecipesByTags, formatTagList, recipeTagCounts, toggleRecipeTag } from '../utils/recipeTags';
import { tagColor } from '../utils/tagColor';
import { groceryNameKey } from '../utils/groceryParse';

/**
 * The recipe box.
 *
 * Deliberately flat — no recipe categories *table*, which would be the fourth
 * one in this app (task / project / template / recipe) for a list most people
 * will keep in the dozens. Favorites float to the top and the search field
 * ranks by name and by ingredient. Recipe.mealType (breakfast/lunch/dinner/
 * snack/dessert — see RecipeMealType in src/types) is the one closed-set tag
 * that earned a plain column instead: it's shown in each row's subtitle via
 * describeRecipe(), and the header's "Group" toggle switches the list between
 * that flat favorites-first order and RECIPE_MEAL_TYPE_LABELS sections
 * (groupRecipesByMealType, src/utils/recipeUtils.ts) — no drag-reorder across
 * sections, unlike Today's category groups, since a recipe's meal type is a
 * single-select field on the editor, not something to drag a row into.
 * Grouping only applies to the unfiltered box, same as the "Cook again" shelf
 * below: a search is already a specific question, and section headers over a
 * handful of matches would just be noise.
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
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [addVisible, setAddVisible] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const [groupByMealType, setGroupByMealType] = useState(false);

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

  // ——— Dragging the add button off its corner ————————————————————————————
  //
  // Same button-drag gesture as the other list-screen FABs (Projects,
  // Templates, Today, Grocery), but with nothing underneath for it to target:
  // the recipe box is deliberately flat and unordered (see the box comment
  // above), so there's no row or category for a drop to name the way those
  // screens' FabDropZoneProvider does. A drag here only ever answers one
  // question — did it come back to the corner? — which is exactly the `home`
  // state Fab's own PanResponder already tracks, so no drop-zone plumbing is
  // needed to answer it. Landing anywhere else commits to the plain "New
  // recipe" action, the same one closest to the button in the menu, skipping
  // "From a photo" the way a task drag skips straight to a plain task rather
  // than reopening the chain/stack/template menu.
  const [fabDragActive, setFabDragActive] = useState(false);
  const [dragCanceling, setDragCanceling] = useState(false);

  const fabDrag: FabDragHandlers = {
    onStart: () => {
      setFabDragActive(true);
      setDragCanceling(false);
    },
    onMove: (_pageY, home) => {
      const canceling = home === 'returned';
      setDragCanceling(prev => (prev === canceling ? prev : canceling));
    },
    onEnd: (_pageY, home) => {
      setFabDragActive(false);
      setDragCanceling(false);
      if (home === 'returned') {
        haptics.tap();
        return;
      }
      setAddVisible(true);
    },
    onCancel: () => {
      setFabDragActive(false);
      setDragCanceling(false);
    },
  };

  const fabDragLabel = fabDragActive ? (dragCanceling ? 'Cancel' : 'New recipe') : null;

  // The whole box's vocabulary, and the counts beside each chip. Derived from
  // the recipes rather than stored (see Recipe.tags), so the row holds exactly
  // the tags that are on something right now.
  const tagVocabulary = useMemo(() => allRecipeTags(recipes), [recipes]);
  const tagCounts = useMemo(() => recipeTagCounts(recipes), [recipes]);

  // A selected tag that's since been lifted off the last recipe carrying it
  // stops filtering rather than emptying the list — resolve-or-shrug, the same
  // answer every other dangling reference in this app gives. The chip it was
  // selected from has already left the row, so there'd be no way back.
  const activeTags = useMemo(
    () => selectedTags.filter(t => tagCounts.has(t)),
    [selectedTags, tagCounts]
  );
  const filtering = activeTags.length > 0;

  const visible = useMemo(() => {
    // Filter, then rank — the same order BuyAgainSheet's store filter uses.
    // Ranking a filtered set is the same function over fewer rows; filtering a
    // ranked one would be a second pass over work already done.
    const matched = rankRecipes(query, filterRecipesByTags(recipes, activeTags));
    // rankRecipes already orders a search by weight; only the unfiltered list
    // needs the favourites-first pass, or a name match would lose its place to
    // a starred recipe that merely mentions the word.
    if (query.trim()) return matched;
    return sortRecipesForDisplay(matched);
  }, [query, recipes, activeTags]);

  // Grouping is only offered on the unfiltered box — see the doc comment
  // above. Built from `visible` (already favourites-sorted) so the flat and
  // grouped views agree on within-section order, not just on membership.
  const grouped = useMemo(
    () => (groupByMealType && !query.trim() ? groupRecipesByMealType(visible) : null),
    [groupByMealType, query, visible]
  );

  // Only offered on the unfiltered list — a search or a tag filter is already a
  // specific question ("what has fennel", "what's vegetarian"), and a shelf of
  // suggestions above the results would answer a question nobody asked. It
  // ranks the whole box, so under a filter it would also be offering exactly
  // the recipes just filtered out.
  const cookAgain = useMemo(
    () => query.trim() || filtering ? [] : rankRecipeSuggestions(recipes, new Date()),
    [query, filtering, recipes]
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
        ) : recipe.imagePath ? (
          <Image source={{ uri: recipe.imagePath }} style={styles.thumb} />
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
        // Under a tag filter the count says what's on screen against what's in
        // the box, so a short list reads as filtered rather than as a box that
        // lost most of its recipes.
        subtitle={recipes.length === 0
          ? undefined
          : filtering
            ? `${visible.length} of ${recipes.length} recipes`
            : `${recipes.length} ${recipes.length === 1 ? 'recipe' : 'recipes'}`}
        actions={recipes.length > 0 ? [
          {
            icon: 'grid-outline',
            onPress: () => { haptics.tap(); setGroupByMealType(g => !g); },
            active: groupByMealType,
            accessibilityLabel: groupByMealType ? 'Ungroup recipes' : 'Group recipes by meal type',
          },
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

          {tagVocabulary.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              // flexGrow: 0 in the style, or this row stretches to share the
              // column with the list below it — same reason the Logbook pins
              // its own filter bar's height.
              style={styles.tagFilterScroll}
              contentContainerStyle={styles.tagFilterRow}
              keyboardShouldPersistTaps="handled"
            >
              {/* Only once something is on: an always-present "All" chip would
                  be a control that does nothing most of the time, and the row
                  is already scrolled to the left where it sits. */}
              {filtering && (
                <TouchableOpacity
                  style={styles.clearChip}
                  onPress={() => { haptics.tap(); animateLayout(); setSelectedTags([]); }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel="Clear tag filter"
                >
                  <Ionicons name="close" size={12} color={colors.textSecondary} />
                  <Text style={styles.clearChipText}>Clear</Text>
                </TouchableOpacity>
              )}
              {tagVocabulary.map(tag => {
                const active = activeTags.includes(tag);
                return (
                  <TouchableOpacity
                    key={tag}
                    style={[
                      styles.tagChip,
                      active && { backgroundColor: tagColor(tag) + '33', borderColor: tagColor(tag) },
                    ]}
                    onPress={() => {
                      haptics.tap();
                      animateLayout();
                      setSelectedTags(prev => toggleRecipeTag(prev, tag));
                    }}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: active }}
                    accessibilityLabel={`${tag}, ${tagCounts.get(tag) ?? 0} recipes`}
                    accessibilityHint="Double tap to filter the recipe box by this tag"
                  >
                    <View style={[styles.tagDot, { backgroundColor: tagColor(tag) }]} />
                    <Text style={[styles.tagChipText, active && { color: tagColor(tag) }]}>{tag}</Text>
                    <Text style={[styles.tagChipCount, active && { color: tagColor(tag) }]}>
                      {tagCounts.get(tag) ?? 0}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}

          {visible.length === 0 ? (
            <EmptyState
              icon={filtering && !query.trim() ? 'pricetags-outline' : 'search-outline'}
              title="Nothing matched"
              // Two ways to end up here, and they need different answers: with
              // both on, the tags are the narrower half and naming them is what
              // tells you which one to lift.
              subtitle={filtering
                ? query.trim()
                  ? `No recipe tagged ${formatTagList(activeTags)} is called “${query.trim()}” or uses it`
                  : `No recipe here is tagged ${formatTagList(activeTags)}`
                : `No recipe here is called “${query.trim()}” or uses it`}
              actionLabel={filtering ? 'Clear tags' : undefined}
              onAction={filtering ? () => { animateLayout(); setSelectedTags([]); } : undefined}
              bottomOffset={tabBarHeight}
            />
          ) : grouped ? (
            <SectionList
              sections={grouped}
              keyExtractor={r => r.id}
              renderItem={renderRecipe}
              renderSectionHeader={({ section }) => (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>{section.title}</Text>
                  <Text style={styles.sectionHeaderCount}>{section.data.length}</Text>
                </View>
              )}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.list}
              ListHeaderComponent={cookAgainShelf}
              ListFooterComponent={<View style={{ height: tabBarHeight + FAB_SIZE + spacing.xl }} />}
              stickySectionHeadersEnabled={false}
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
          drag={fabDrag}
          dragHint="Drag off the button to add a recipe, or back to it to cancel"
          dragLabel={fabDragLabel}
        />
      ) : (
        <Fab
          onPress={() => { haptics.tap(); setAddVisible(true); }}
          accessibilityLabel="Add recipe"
          bottom={insets.bottom + tabBarHeight + spacing.md}
          drag={fabDrag}
          dragHint="Drag off the button to add a recipe, or back to it to cancel"
          dragLabel={fabDragLabel}
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
  // The tag filter row. Same chip treatment as the bulk bar's tag picker —
  // outlined, with the tag's own colour as a dot, filling in when it's on.
  tagFilterScroll: {
    flexGrow: 0,
  },
  tagFilterRow: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  tagChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: colors.bgQuaternary,
    backgroundColor: colors.bgSecondary,
  },
  tagDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  tagChipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  tagChipCount: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.medium,
  },
  clearChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.bgTertiary,
  },
  clearChipText: {
    color: colors.textSecondary,
    fontSize: font.sm,
    fontWeight: fontWeight.medium,
  },
  // Same treatment as LogbookScreen's day headers — section headers app-wide
  // are uppercase font.xs semibold textTertiary with 0.8 letterSpacing.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  sectionHeaderText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionHeaderCount: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
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
  thumb: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.bgSunken,
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
