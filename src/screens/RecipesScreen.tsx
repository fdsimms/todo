import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
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
import type { Recipe, RecipeMealType } from '../types';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useRowSelection } from '../hooks/useRowSelection';
import { ScreenHeader } from '../components/ScreenHeader';
import { GroceriesHubPills } from '../components/GroceriesHubPills';
import { TipHost } from '../components/TipHost';
import { ActiveTripBanner } from '../components/ActiveTripBanner';
import { SharedLinkBanner } from '../components/SharedLinkBanner';
import { useSharedLinkStore } from '../store/useSharedLinkStore';
import { EmptyState } from '../components/EmptyState';
import { QuickAddNameSheet } from '../components/QuickAddNameSheet';
import { RecipeCreateSheet } from '../components/RecipeCreateSheet';
import { InventRecipeSheet } from '../components/InventRecipeSheet';
import type { RecipeInputMode } from '../components/RecipeSourcePicker';
import { RecipeTagFilterSheet } from '../components/RecipeTagFilterSheet';
import { RecipeSortFilterSheet } from '../components/RecipeSortFilterSheet';
import { FabMenu, FAB_SIZE, type FabDragHandlers, type FabMenuItem } from '../components/Fab';
import {
  FabDropZone,
  FabDropZoneProvider,
  useFabIntentChannel,
  useFabIntentSelector,
  type FabDropZonesHandle,
  type FabIntentChannel,
} from '../components/FabDropZones';
import { type DragScroller, type DropZone, type FabDropIntent } from '../utils/fabDrop';
import { ListBulkBar } from '../components/ListBulkBar';
import { ReorderableList } from '../components/ReorderableList';
import { SwipeableRow } from '../components/SwipeableRow';
import { useSettingsStore } from '../store/useSettingsStore';
import { PlanMealSheet } from '../components/PlanMealSheet';
import { usePlanMeal } from '../hooks/usePlanMeal';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, iconSize, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { animateLayout } from '../utils/layoutAnimation';
import { resolveActiveTrip } from '../utils/activeTrip';
import { resetToGroceries } from '../navigation/navigationRef';
import {
  cleanRecipeName,
  countLikelyInPantry,
  type LikelyInPantryCount,
  describeCookHistory,
  describeRecipe,
  flattenRecipeMealTypeSections,
  groupRecipesByMealType,
  rankRecipes,
  recipeListItemKey,
  recipeSectionKey,
  resolveRecipeMealTypeDrop,
  sortRecipesBy,
  type RecipeListItem,
} from '../utils/recipeUtils';
import { recipeMap } from '../utils/recipeComponents';
import { resolveRecipeImagePath } from '../utils/recipePhoto';
import { allRecipeTags, filterRecipesByTags, formatTagList, recipeTagCounts } from '../utils/recipeTags';
import { tagColor } from '../utils/tagColor';
import { groceryNameKey } from '../utils/groceryParse';

/**
 * The recipe box.
 *
 * Deliberately flat — no recipe categories *table*, which would be the fourth
 * one in this app (task / project / template / recipe) for a list most people
 * will keep in the dozens. Loved recipes float to the top and the search field
 * ranks by name and by ingredient. Recipe.mealType (breakfast/lunch/dinner/
 * snack/dessert — see RecipeMealType in src/types) is the one closed-set tag
 * that earned a plain column instead: it's shown in each row's subtitle via
 * describeRecipe(), and the header's "Group" toggle switches the list between
 * that flat loved-first order and RECIPE_MEAL_TYPE_LABELS sections
 * (groupRecipesByMealType, src/utils/recipeUtils.ts). Grouping only applies to
 * the unfiltered box: a search is already a specific question, and section
 * headers over a handful of matches would just be noise.
 *
 * While grouped, a recipe row can be dragged into another section to
 * re-tag its meal type — same ReorderableList + nearest-header-above rule
 * Today uses for categories (resolveRecipeMealTypeDrop, recipeUtils.ts).
 * Recipes have no manual order of their own within a section (the box stays
 * loved-first), so a drop that doesn't cross a header boundary is a
 * no-op: the list re-settles to its loved-first order instead of keeping
 * wherever the row was released.
 *
 * A section header is also tappable, to fold its recipes away — persisted
 * per meal type in `collapsedRecipeSections` (useSettingsStore), the same
 * "a collapse is a preference about the list's shape" reasoning Today's own
 * `collapsedCategories` is kept for. Collapsing only hides rows from the
 * list actually handed to `ReorderableList` (`visibleDraggableData` below);
 * `draggableData` itself, and everything derived from the full `grouped`
 * list (section counts, drop targets), stays complete, so expanding a
 * section again never has to wait on a store round-trip to get its recipes
 * back. A drag can only ever touch what's rendered, so `onReorder` has to
 * hand a collapsed section's untouched recipes back to
 * `resolveRecipeMealTypeDrop` itself or they'd be read as deleted.
 *
 * The add button can be dragged into a section too, same FabDropZoneProvider
 * wiring ProjectsScreen uses over its own category-sectioned list — see the
 * comment above the button's drag handlers, below.
 */

/** "tagged x, y" / "loved" / "tagged x, y and loved" — for the empty state. */
function describeActiveFilters(tagFiltering: boolean, activeTags: string[], lovedOnly: boolean): string {
  const parts: string[] = [];
  if (tagFiltering) parts.push(`tagged ${formatTagList(activeTags)}`);
  if (lovedOnly) parts.push('loved');
  return parts.join(' and ');
}

/** What the drag label should read for a given drop target — see the button's drag handlers below. */
function recipeDropLabel(intent: FabDropIntent | null): string | null {
  if (intent === null) return null;
  if (intent.kind === 'cancel') return 'Cancel';
  if (intent.kind === 'insert') return intent.category ? `New recipe in ${intent.category}` : 'New recipe';
  return 'New recipe';
}

// The add button, naming what a release right now would do — mirrors
// AddProjectFabWithDropLabel (ProjectsScreen.tsx). Always a FabMenu: with no
// Anthropic key the import options drop out of `addMenuItems` below, leaving
// "New recipe" alone, and FabMenu performs a lone item on the tap rather than
// accordioning out to offer it — so there's no separate plain-Fab variant to
// keep matching this one's bottom/drag/dragHint/accessibilityLabel by hand.
function AddRecipeFabMenuWithDropLabel({
  channel,
  ...props
}: {
  channel: FabIntentChannel;
} & Omit<React.ComponentProps<typeof FabMenu>, 'dragLabel'>) {
  const label = useFabIntentSelector(channel, recipeDropLabel);
  return <FabMenu {...props} dragLabel={label} />;
}

export function RecipesScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<any>();

  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const addRecipe = useRecipeStore(s => s.addRecipe);
  const bulkDeleteRecipes = useRecipeStore(s => s.bulkDeleteRecipes);
  const bulkSetVote = useRecipeStore(s => s.bulkSetVote);
  const setMealType = useRecipeStore(s => s.setMealType);
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const recipeSort = useSettingsStore(s => s.recipeSortOption);
  const setRecipeSort = useSettingsStore(s => s.setRecipeSortOption);
  const recipeLovedOnly = useSettingsStore(s => s.recipeLovedOnly);
  const setRecipeLovedOnly = useSettingsStore(s => s.setRecipeLovedOnly);
  // Which meal-type sections are folded shut — see the doc comment above.
  // Kept as a Set locally, same wrapper shape TodayScreen uses around its own
  // collapsedCategories, so callers can toggle with a Set-updater instead of
  // reconstructing the whole array by hand each time.
  const storedCollapsedSections = useSettingsStore(useShallow(s => s.collapsedRecipeSections));
  const setStoredCollapsedSections = useSettingsStore(s => s.setCollapsedRecipeSections);
  const collapsedSections = useMemo(
    () => new Set(storedCollapsedSections),
    [storedCollapsedSections]
  );
  const setCollapsedSections = useCallback(
    (update: (prev: Set<string>) => Set<string>) => {
      setStoredCollapsedSections([...update(new Set(storedCollapsedSections))]);
    },
    [storedCollapsedSections, setStoredCollapsedSections]
  );
  const toggleSectionCollapse = useCallback((key: string) => {
    haptics.tap();
    animateLayout();
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, [setCollapsedSections]);
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  const shops = useGroceryStore(useShallow(s => s.shops));
  const tripShopId = useGroceryStore(s => s.tripShopId);
  const tripStartedAt = useGroceryStore(s => s.tripStartedAt);
  const endTrip = useGroceryStore(s => s.endTrip);
  const activeTripShop = useMemo(
    () => resolveActiveTrip(tripShopId, tripStartedAt, shops, new Date()),
    [tripShopId, tripStartedAt, shops]
  );
  const handleClearTrip = useCallback(() => {
    animateLayout();
    endTrip();
  }, [endTrip]);

  const { planRecipe, offerPrepTasks, earliestUnplannedSlotToday } = usePlanMeal();
  // The recipe whose day is being picked; null closes the sheet.
  const [planningRecipe, setPlanningRecipe] = useState<Recipe | null>(null);
  const [query, setQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagFilterVisible, setTagFilterVisible] = useState(false);
  const [sortFilterVisible, setSortFilterVisible] = useState(false);
  const [addVisible, setAddVisible] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [importMode, setImportMode] = useState<RecipeInputMode>('photo');
  const [inventVisible, setInventVisible] = useState(false);
  // The shared page the import sheet was opened for, if it was opened from the
  // banner rather than the add menu. Deliberately not cleared when the sheet
  // closes: `RecipeCreateSheet` calls `onClose` before `onCreated`, so clearing
  // there would blank it out one line before the handler that needs it reads it.
  // The add-menu path clears it instead, which is the only other way in.
  const [importUrl, setImportUrl] = useState<string | null>(null);
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const [groupByMealType, setGroupByMealType] = useState(true);

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
  // still the one under your thumb. The three import items sit in the same
  // order as RecipeSourcePicker's own Paste/Link/Photo tabs, so the menu and
  // the sheet it opens agree on which one is the "default" way in. All four AI
  // items — the three imports plus Invent — need a key, so they all drop out
  // together without one, leaving "New recipe" — which needs no AI — as the
  // menu's one remaining, and therefore only, item. FabMenu performs a lone
  // item on the tap instead of opening, so this is also what makes the
  // plain-Fab variant this used to need removable. Invent sits furthest from
  // the thumb: unlike the three imports it has nothing to read from, so it's
  // the one most likely to need a moment's thought before tapping.
  const addMenuItems = useMemo<FabMenuItem[]>(() => (anthropicApiKey ? [
    { key: 'invent', label: 'Invent a recipe', icon: 'sparkles-outline' },
    { key: 'paste', label: 'Paste text', icon: 'clipboard-outline' },
    { key: 'link', label: 'From a link', icon: 'link-outline' },
    { key: 'import', label: 'From a photo', icon: 'camera-outline' },
    { key: 'name', label: 'New recipe', icon: 'add-circle-outline' },
  ] : [
    { key: 'name', label: 'New recipe', icon: 'add-circle-outline' },
  ]), [anthropicApiKey]);

  const handleAddMenuSelect = useCallback((key: string) => {
    // All three import items open the one sheet, on their own tab — see
    // RecipeCreateSheet's initialMode. Either way this is an import the user is
    // starting from scratch, so any page left over from the shared-link banner
    // is cleared rather than turning up pre-filled in a field they came here to
    // type into themselves.
    setImportUrl(null);
    if (key === 'paste') { setImportMode('paste'); setImportVisible(true); }
    else if (key === 'link') { setImportMode('link'); setImportVisible(true); }
    else if (key === 'import') { setImportMode('photo'); setImportVisible(true); }
    else if (key === 'invent') { setInventVisible(true); }
    else setAddVisible(true);
  }, []);

  // A page saved from another app's share sheet. Only the front of the queue is
  // offered at a time — see SharedLinkBanner.
  const sharedUrls = useSharedLinkStore(useShallow(s => s.pendingUrls));
  const dismissSharedLink = useSharedLinkStore(s => s.dismiss);
  const sharedUrl = sharedUrls[0] ?? null;

  const handleImportShared = useCallback(() => {
    if (!sharedUrl) return;
    setImportUrl(sharedUrl);
    setImportMode('link');
    setImportVisible(true);
  }, [sharedUrl]);

  const handleDismissShared = useCallback(() => {
    if (sharedUrl) dismissSharedLink(sharedUrl);
  }, [sharedUrl, dismissSharedLink]);

  // Drop the queued page once a recipe has actually been made from it. Keyed on
  // the source url the sheet reports rather than on whatever it opened with:
  // the tabs are still live, so someone who opened the banner and then pasted a
  // different recipe hasn't dealt with the shared one, and it stays queued.
  const handleCreated = useCallback((recipeId: string, sourceUrl: string | null) => {
    if (sourceUrl) dismissSharedLink(sourceUrl);
    navigation.navigate('RecipeDetail', { recipeId });
  }, [dismissSharedLink, navigation]);

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
  const tagFiltering = activeTags.length > 0;
  const filtering = tagFiltering || recipeLovedOnly;
  const activeFilterCount = (recipeSort !== 'default' ? 1 : 0) + (recipeLovedOnly ? 1 : 0);

  const visible = useMemo(() => {
    // Filter, then rank — the same order GroceryCatalogSheet's store filter uses.
    // Ranking a filtered set is the same function over fewer rows; filtering a
    // ranked one would be a second pass over work already done.
    const byTag = filterRecipesByTags(recipes, activeTags);
    const byLoved = recipeLovedOnly ? byTag.filter(r => r.vote === 'loved') : byTag;
    const matched = rankRecipes(query, byLoved);
    // rankRecipes already orders a search by weight; only the unfiltered list
    // takes RecipeSortFilterSheet's own sort, or a name match would lose its
    // place to a recipe that merely ranks higher under it.
    if (query.trim()) return matched;
    return sortRecipesBy(matched, recipeSort);
  }, [query, recipes, activeTags, recipeLovedOnly, recipeSort]);

  // Grouping is only offered on the unfiltered box — see the doc comment
  // above. Built from `visible` (already sorted) so the flat and grouped
  // views agree on within-section order, not just on membership.
  const grouped = useMemo(
    () => (groupByMealType && !query.trim()
      ? groupRecipesByMealType(visible, list => sortRecipesBy(list, recipeSort))
      : null),
    [groupByMealType, query, visible, recipeSort]
  );

  // The row list ReorderableList drags. Kept as its own state (rather than
  // deriving it inline from `grouped`) so a drop can show its settled layout
  // immediately — see resolveRecipeMealTypeDrop — instead of flashing the raw
  // drop order until the store write round-trips back through `grouped`.
  const flatGrouped = useMemo(() => (grouped ? flattenRecipeMealTypeSections(grouped) : null), [grouped]);
  const [draggableData, setDraggableData] = useState<RecipeListItem[]>(flatGrouped ?? []);
  useEffect(() => {
    if (flatGrouped) setDraggableData(flatGrouped);
  }, [flatGrouped]);

  // Section-header counts, read from `grouped` (the store-derived truth)
  // rather than `draggableData` — a header's count needn't track a drag still
  // in flight, only what's actually settled.
  const sectionCounts = useMemo(() => {
    const map = new Map<string, number>();
    grouped?.forEach(section => map.set(section.mealType ?? '', section.data.length));
    return map;
  }, [grouped]);

  // `draggableData` with a collapsed section's recipe rows dropped — what
  // ReorderableList actually renders and drags. Headers always stay (see the
  // doc comment above), which is also what keeps row 0 a header for
  // dragRange below, whether or not the very first section is folded shut.
  const visibleDraggableData = useMemo(() => {
    if (collapsedSections.size === 0) return draggableData;
    let currentKey: string | null = null;
    return draggableData.filter(item => {
      if (item.type === 'header') { currentKey = recipeSectionKey(item.mealType); return true; }
      return currentKey === null || !collapsedSections.has(currentKey);
    });
  }, [draggableData, collapsedSections]);

  // Every row of `draggableData` as a target for the add button being dragged
  // in, plus the mealType a drop on it means — the nearest header's, same
  // nearest-header-above rule resolveRecipeMealTypeDrop applies to a settled
  // row drag. Built alongside the DropZone (rather than deriving the mealType
  // back out of a plain `category` string on the intent, the way Projects'
  // category already doubles as the field it writes) because a section's
  // display title and its mealType are two different values here.
  const dropTargetsByKey = useMemo(() => {
    const map = new Map<string, { zone: DropZone; mealType: RecipeMealType | null }>();
    let currentMealType: RecipeMealType | null = null;
    let currentTitle: string | null = null;
    draggableData.forEach(item => {
      const key = recipeListItemKey(item);
      if (item.type === 'header') {
        currentMealType = item.mealType;
        currentTitle = item.title;
        map.set(key, { zone: { kind: 'header', key, category: item.title }, mealType: item.mealType });
      } else {
        map.set(key, { zone: { kind: 'task', key, category: currentTitle }, mealType: currentMealType });
      }
    });
    return map;
  }, [draggableData]);

  // ——— Dragging the add button into a section ————————————————————————————
  //
  // Same FabDropZoneProvider/FabDropZone wiring ProjectsScreen uses over its
  // own category-sectioned list: no stacks or pinning here either, so a drop
  // means a meal-type section and nothing more. Only available while grouped
  // (see the box comment above) — search and the flat, ungrouped view have no
  // sections to land on, so the provider only wraps the grouped ReorderableList
  // below and a drop anywhere else resolves to `plain`, same as tapping the
  // button. Landing on a section commits to the plain "New recipe" action (the
  // one closest to the button in the menu, skipping the import items — a task
  // drag skips straight to a plain task the same way) and seeds the new
  // recipe's mealType with it. Recipes have no manual order within a section,
  // so unlike Projects there's no splicing to do: the mealType write alone is
  // enough for the row to settle into place once the store round-trips back
  // through groupRecipesByMealType.
  const dropZonesRef = useRef<FabDropZonesHandle>(null);
  const [fabDragging, setFabDragging] = useState(false);
  const scrollControl = useRef<DragScroller | null>(null);
  const fabIntentChannel = useFabIntentChannel();
  // The mealType a drop landed on, read once the recipe comes back from the
  // name sheet. Left at null for a plain drop or the Untagged section — a
  // freshly created recipe already has mealType: null, so there's nothing to
  // write in either case.
  const pendingMealTypeRef = useRef<RecipeMealType | null>(null);

  const fabDrag: FabDragHandlers = {
    onStart: () => {
      setFabDragging(true);
      dropZonesRef.current?.begin();
    },
    onMove: (pageY, home) => dropZonesRef.current?.moveTo(pageY, home),
    onEnd: (pageY, home) => {
      setFabDragging(false);
      const intent = dropZonesRef.current?.end(pageY, home) ?? { kind: 'plain' as const };
      if (intent.kind === 'cancel') {
        haptics.tap();
        return;
      }
      pendingMealTypeRef.current = intent.kind === 'insert'
        ? (dropTargetsByKey.get(intent.anchorKey)?.mealType ?? null)
        : null;
      setAddVisible(true);
    },
    onCancel: () => {
      setFabDragging(false);
      dropZonesRef.current?.cancel();
    },
  };

  // Computed once for the visible list rather than per row render — same
  // classifyPlanned pass RecipeToListSheet/AddWeekToListSheet already run,
  // just reduced to a count per recipe.
  const pantryCounts = useMemo(() => {
    const now = new Date();
    const byId = recipeMap(recipes);
    const map = new Map<string, LikelyInPantryCount>();
    for (const recipe of visible) {
      const count = countLikelyInPantry(recipe, groceryItems, now, byId, itemSubs);
      if (count !== null) map.set(recipe.id, count);
    }
    return map;
  }, [visible, recipes, groceryItems, itemSubs]);

  // "Love"/"Unlove" flips direction based on the selection itself, the
  // same way the grocery bulk bar's Check/Uncheck does — a selection that's
  // already all loved has nothing left to love.
  const allSelectedLoved = useMemo(() => {
    if (selectedIds.size === 0) return false;
    return Array.from(selectedIds).every(id => recipes.find(r => r.id === id)?.vote === 'loved');
  }, [selectedIds, recipes]);

  // Extra bottom padding so the last rows aren't hidden behind the floating bar.
  const selectionListPadding = tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm;

  const handleBulkLove = () => {
    const next = !allSelectedLoved;
    animateLayout();
    bulkSetVote(Array.from(selectedIds), next ? 'loved' : null);
    haptics[next ? 'success' : 'tap']();
    exitSelection();
  };

  const handleBulkDelete = () => {
    const ids = Array.from(selectedIds);
    const count = ids.length;
    const plural = count === 1 ? 'recipe' : 'recipes';
    haptics.warning();
    confirmDelete({
      title: `Delete ${count} ${plural}?`,
      message: `You're about to delete ${count} ${plural}. Anything already on your grocery list stays there. This can't be undone.`,
      onConfirm: () => {
        animateLayout();
        bulkDeleteRecipes(ids);
        exitSelection();
      },
    });
  };

  const openRecipe = (recipe: Recipe) => {
    haptics.tap();
    navigation.navigate('RecipeDetail', { recipeId: recipe.id });
  };

  const createRecipe = (name: string) => {
    setAddVisible(false);
    const mealType = pendingMealTypeRef.current;
    pendingMealTypeRef.current = null;
    const recipe = addRecipe(name);
    if (recipe) {
      if (mealType !== null) setMealType(recipe.id, mealType);
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

  // Icon-only because the row is already dense; the spoken label carries the
  // meaning. Deliberately a button rather than a long-press: the row's
  // long-press is already the drag-to-reorder handle. It's not on the swipe
  // panel either — that's select-only (#1378), same contract as every other
  // SwipeableRow in the app.
  const planButton = (recipe: Recipe) => (
    <TouchableOpacity
      style={styles.planButton}
      onPress={() => { haptics.tap(); setPlanningRecipe(recipe); }}
      activeOpacity={interaction.activeOpacity}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={`Plan ${recipe.name} onto a day`}
    >
      <Ionicons name="calendar-outline" size={iconSize.md} color={colors.accent} />
    </TouchableOpacity>
  );

  const renderRecipe = ({ item: recipe, drag, isActive }: { item: Recipe; drag?: () => void; isActive?: boolean }) => {
    const selected = selectedIds.has(recipe.id);
    const rowBody = (
      <TouchableOpacity
        style={[styles.row, selectionMode && selected && styles.rowSelected]}
        onPress={() => (selectionMode ? toggleSelection(recipe.id) : openRecipe(recipe))}
        onLongPress={selectionMode ? undefined : drag}
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
          <Image source={{ uri: resolveRecipeImagePath(recipe.imagePath) ?? undefined }} style={styles.thumb} />
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
        {recipe.vote === 'loved' && (
          <Ionicons name="thumbs-up" size={iconSize.sm} color={colors.orange} />
        )}
        {!selectionMode && planButton(recipe)}
        {!selectionMode && (
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        )}
      </TouchableOpacity>
    );
    return (
      <View style={[styles.itemWrapper, isActive && styles.itemWrapperActive]}>
        {selectionMode ? rowBody : (
          <SwipeableRow
            enabled={!isActive}
            selectAction={{
              onSelect: () => enterSelectionMode(recipe.id),
              accessibilityLabel: `Select ${recipe.name}`,
            }}
          >
            {rowBody}
          </SwipeableRow>
        )}
      </View>
    );
  };

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
            icon: 'funnel',
            onPress: () => { haptics.tap(); setSortFilterVisible(true); },
            active: activeFilterCount > 0,
            badge: activeFilterCount,
            accessibilityLabel: 'Sort and filter recipes',
          },
          {
            icon: 'grid-outline',
            onPress: () => { haptics.tap(); setGroupByMealType(g => !g); },
            active: groupByMealType,
            accessibilityLabel: groupByMealType ? 'Ungroup recipes' : 'Group recipes by meal type',
          },
        ] : undefined}
      />
      <GroceriesHubPills active="Recipes" />
      <TipHost screen="recipes" />
      {!selectionMode && !!activeTripShop && (
        <ActiveTripBanner
          shopName={activeTripShop.name}
          onChange={() => resetToGroceries()}
          onFinish={() => resetToGroceries(true)}
          onClear={handleClearTrip}
        />
      )}
      {/* Gated on the key for the same reason the add button's import menu is,
          below: without one there is no import to offer, and this banner would
          otherwise be the only route into a sheet that can only end at "No API
          key". The queue is persisted, so a page shared before a key is added
          isn't lost — it turns up once there's something to import it with. */}
      {!selectionMode && !!anthropicApiKey && !!sharedUrl && (
        <SharedLinkBanner
          url={sharedUrl}
          remaining={sharedUrls.length - 1}
          onImport={handleImportShared}
          onDismiss={handleDismissShared}
        />
      )}

      {recipes.length === 0 ? (
        <EmptyState
          icon="restaurant-outline"
          title="No recipes yet"
          subtitle="Keep what you cook here, with what it takes to shop for it. Then put a whole recipe on the grocery list in one tap"
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
              spellCheck={false}
              returnKeyType="search"
              clearButtonMode="while-editing"
              accessibilityLabel="Search recipes"
            />
          </View>

          {tagVocabulary.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              // flexGrow/flexShrink: 0 in the style, or this row stretches or
              // gets squeezed sharing the column with the list below it —
              // same reason the Logbook pins its own filter bar's height. A
              // missing flexShrink left the button's pill background taller
              // and wider than its own content once the list below pushed
              // back. Unlike the vocabulary itself
              // (unbounded — see RecipeTagFilterSheet), what's *selected* is
              // small enough in practice to sit in a scrolling row: it's the
              // handful the cook is actively narrowing by, not the whole box.
              style={styles.tagFilterScroll}
              contentContainerStyle={styles.tagFilterRow}
              keyboardShouldPersistTaps="handled"
            >
              <TouchableOpacity
                style={styles.filterButton}
                onPress={() => { haptics.tap(); setTagFilterVisible(true); }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Filter recipes by tag"
              >
                <Ionicons name="funnel-outline" size={13} color={colors.text} />
                <Text style={styles.filterButtonText}>
                  {filtering ? `Tags (${activeTags.length})` : 'Tags'}
                </Text>
                <Ionicons name="chevron-down" size={12} color={colors.textTertiary} />
              </TouchableOpacity>
              {activeTags.map(tag => (
                <TouchableOpacity
                  key={tag}
                  // Tinted rather than filled, and colored text rather than
                  // onAccent — the same treatment every other removable tag
                  // chip in this app uses (TaskEditor, LogbookScreen). A
                  // filled pill would put white text on a yellow tag.
                  style={[styles.activePill, { backgroundColor: tagColor(tag) + '33' }]}
                  onPress={() => {
                    haptics.tap();
                    animateLayout();
                    setSelectedTags(prev => prev.filter(t => t !== tag));
                  }}
                  activeOpacity={interaction.activeOpacity}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove tag filter ${tag}`}
                >
                  <Text style={[styles.activePillText, { color: tagColor(tag) }]} numberOfLines={1}>{tag}</Text>
                  <Ionicons name="close" size={13} color={tagColor(tag)} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {visible.length === 0 ? (
            <EmptyState
              icon={filtering && !query.trim() ? (tagFiltering ? 'pricetags-outline' : 'thumbs-up-outline') : 'search-outline'}
              title="Nothing matched"
              // Three ways to end up here (tag, loved-only, search), and
              // they combine: naming every active filter is what tells you
              // which one to lift.
              subtitle={filtering
                ? query.trim()
                  ? `No recipe ${describeActiveFilters(tagFiltering, activeTags, recipeLovedOnly)} is called “${query.trim()}” or uses it`
                  : `No recipe here is ${describeActiveFilters(tagFiltering, activeTags, recipeLovedOnly)}`
                : `No recipe here is called “${query.trim()}” or uses it`}
              actionLabel={filtering ? 'Clear filters' : undefined}
              onAction={filtering ? () => { animateLayout(); setSelectedTags([]); setRecipeLovedOnly(false); } : undefined}
              bottomOffset={tabBarHeight}
            />
          ) : grouped ? (
            <FabDropZoneProvider
              ref={dropZonesRef}
              onIntentChange={fabIntentChannel.publish}
              scroller={scrollControl}
            >
              <ReorderableList
                data={visibleDraggableData}
                keyExtractor={recipeListItemKey}
                // The user can't scroll during an add-button drag (the
                // button's responder has the touch); the drag scrolls it
                // instead, through scrollControl above.
                scrollEnabled={!fabDragging}
                scrollControlRef={scrollControl}
                renderItem={({ item, drag, isActive }) => {
                  // Every row doubles as a target for the add button being
                  // dragged in — see dropTargetsByKey above.
                  const zone = isActive ? null : dropTargetsByKey.get(recipeListItemKey(item))?.zone ?? null;
                  const row = item.type === 'header' ? (
                    <TouchableOpacity
                      style={styles.sectionHeader}
                      onPress={() => toggleSectionCollapse(recipeSectionKey(item.mealType))}
                      activeOpacity={interaction.activeOpacity}
                      accessibilityRole="button"
                      accessibilityLabel={
                        `${collapsedSections.has(recipeSectionKey(item.mealType)) ? 'Expand' : 'Collapse'} ${item.title}`
                      }
                    >
                      <View style={styles.sectionHeaderLeft}>
                        <Text style={styles.sectionHeaderText}>{item.title}</Text>
                        <Ionicons
                          name={collapsedSections.has(recipeSectionKey(item.mealType)) ? 'chevron-forward' : 'chevron-down'}
                          size={13}
                          color={colors.textTertiary}
                        />
                      </View>
                      <Text style={styles.sectionHeaderCount}>{sectionCounts.get(item.mealType ?? '') ?? 0}</Text>
                    </TouchableOpacity>
                  ) : renderRecipe({ item: item.recipe, drag: selectionMode ? undefined : drag, isActive });
                  return <FabDropZone zone={zone}>{row}</FabDropZone>;
                }}
                onHoverChange={haptics.dragTick}
                // Row 0 is always a header (groupRecipesByMealType never emits
                // an empty section) — see the note on resolveRecipeMealTypeDrop.
                // Keeping it off-limits means every recipe row always has a
                // header above it to read a mealType from.
                dragRange={(data, _activeIndex) => [1, data.length - 1]}
                placeholderStyle={styles.dropSlot}
                onReorder={reordered => {
                  // A collapsed section's recipes never appear in `reordered`
                  // (visibleDraggableData drops them) — hand them back
                  // untouched or resolveRecipeMealTypeDrop would read the
                  // whole section as deleted. See the doc comment up top.
                  const hiddenRecipes = draggableData
                    .filter((item): item is Extract<RecipeListItem, { type: 'recipe' }> =>
                      item.type === 'recipe' && collapsedSections.has(recipeSectionKey(item.recipe.mealType)))
                    .map(item => item.recipe);
                  const { mealTypeUpdates, settled } = resolveRecipeMealTypeDrop(reordered, hiddenRecipes);
                  setDraggableData(settled);
                  mealTypeUpdates.forEach(u => setMealType(u.id, u.mealType));
                }}
                contentContainerStyle={styles.list}
                ListFooterComponent={
                  <View style={{ height: selectionMode ? selectionListPadding : tabBarHeight + FAB_SIZE + spacing.xl }} />
                }
              />
            </FabDropZoneProvider>
          ) : (
            <FlatList
              data={visible}
              keyExtractor={r => r.id}
              renderItem={renderRecipe}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.list}
              ListFooterComponent={
                <View style={{ height: selectionMode ? selectionListPadding : tabBarHeight + FAB_SIZE + spacing.xl }} />
              }
            />
          )}
        </>
      )}

      {/* The bulk bar sits where the button does, and adding a recipe isn't
          something you're doing mid-selection anyway. */}
      {!selectionMode && (
        <AddRecipeFabMenuWithDropLabel
          channel={fabIntentChannel}
          items={addMenuItems}
          onSelect={handleAddMenuSelect}
          accessibilityLabel="Add recipe"
          bottom={insets.bottom + tabBarHeight + spacing.md}
          drag={fabDrag}
          dragHint="Drag onto a section to add a recipe there, or back to the button to cancel"
        />
      )}

      {selectionMode && (
        <ListBulkBar
          selectedCount={selectedIds.size}
          totalCount={visible.length}
          actions={[
            {
              key: 'love',
              icon: allSelectedLoved ? 'thumbs-up-outline' : 'thumbs-up',
              label: allSelectedLoved ? 'Unlove' : 'Love',
              onPress: handleBulkLove,
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
        placeholder="New recipe…"
        noun="recipe"
        onSubmit={createRecipe}
        onClose={() => { setAddVisible(false); pendingMealTypeRef.current = null; }}
      />

      <RecipeCreateSheet
        visible={importVisible}
        initialMode={importMode}
        initialUrl={importUrl}
        onClose={() => setImportVisible(false)}
        onCreated={handleCreated}
      />

      <InventRecipeSheet
        visible={inventVisible}
        onClose={() => setInventVisible(false)}
        onCreated={recipeId => handleCreated(recipeId, null)}
      />

      <RecipeTagFilterSheet
        visible={tagFilterVisible}
        onClose={() => setTagFilterVisible(false)}
        tags={tagVocabulary}
        counts={tagCounts}
        selected={activeTags}
        onChange={next => { animateLayout(); setSelectedTags(next); }}
      />

      <RecipeSortFilterSheet
        visible={sortFilterVisible}
        onClose={() => setSortFilterVisible(false)}
        sort={recipeSort}
        onSortChange={s => { animateLayout(); setRecipeSort(s); }}
        lovedOnly={recipeLovedOnly}
        onLovedOnlyChange={v => { animateLayout(); setRecipeLovedOnly(v); }}
      />

      <PlanMealSheet
        visible={planningRecipe !== null}
        title={planningRecipe?.name ?? null}
        defaultSlot={earliestUnplannedSlotToday()}
        onPlan={(dateKey, slot) =>
          planningRecipe ? planRecipe(planningRecipe, dateKey, slot) : null}
        // After the dismissal, never before — see PlanRecipeSheet.onPlanned.
        onPlanned={offerPrepTasks}
        onClose={() => setPlanningRecipe(null)}
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
    marginTop: spacing.md,
    marginBottom: spacing.sm,
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
  // The tag filter row — a button that opens RecipeTagFilterSheet (the
  // vocabulary is unbounded, see that component's doc comment) plus the
  // currently-active tags as removable pills. Same shape as LogbookScreen's
  // own filterButton/activePill.
  tagFilterScroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  tagFilterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.bgQuaternary,
  },
  filterButtonText: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 220,
    paddingLeft: spacing.md,
    paddingRight: 10,
    paddingVertical: 7,
    borderRadius: radius.full,
  },
  activePillText: {
    fontSize: font.sm,
    fontWeight: fontWeight.semibold,
    flexShrink: 1,
  },
  // Same treatment as LogbookScreen's day headers — section headers app-wide
  // are uppercase font.xs semibold textTertiary with 0.8 letterSpacing.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
  },
  // Title + collapse chevron, grouped so `justifyContent: 'space-between'`
  // on `sectionHeader` above pushes only the count to the far edge.
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionHeaderText: {
    color: colors.textSecondary,
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
    paddingTop: spacing.sm,
  },
  // A bare glyph, not a tinted tile. The row already opens with an
  // accentSubtle tile carrying the recipe's own icon, and a second one at the
  // other end reads as a matching pair of *icons* rather than as a control —
  // the same trap CLAUDE.md documents for an accent InlineAction sitting at
  // the end of a row of already-tinted chips. Bare, it joins the trailing
  // cluster (star, chevron) where the row's other controls already live.
  planButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Same inset-grouped card footprint as TaskItem and the Stacks rows.
  // The card: margin, radius and resting background, split from `row` below
  // so a SwipeableRow's child renders flush — see the matching split in
  // GroceryRow.tsx (#1378).
  itemWrapper: {
    backgroundColor: colors.bgSecondary,
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  itemWrapperActive: {
    backgroundColor: colors.bgSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    gap: spacing.md,
  },
  rowSelected: {
    backgroundColor: colors.accent + '1A',
  },
  // Subtle slot marking where a dragged recipe will land; mirrors the row's
  // own footprint (margin + radius), same treatment as Today's dropSlot.
  dropSlot: {
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    opacity: 0.55,
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
