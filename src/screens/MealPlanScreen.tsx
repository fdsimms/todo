import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View, Text, FlatList, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import { addWeeks } from 'date-fns/addWeeks';
import { format } from 'date-fns/format';
import { isToday } from 'date-fns/isToday';
import { isSameWeek } from 'date-fns/isSameWeek';
import type { MealPlanEntry, MealSlot, Recipe } from '../types';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { GroceriesHubPills } from '../components/GroceriesHubPills';
import { InlineAction } from '../components/InlineAction';
import { MealSlotRow } from '../components/MealSlotRow';
import { MealEntrySheet } from '../components/MealEntrySheet';
import { RecipePickerSheet, type MealPick } from '../components/RecipePickerSheet';
import { AddWeekToListSheet } from '../components/AddWeekToListSheet';
import { RecipeToListSheet } from '../components/RecipeToListSheet';
import { SuggestMealsSheet } from '../components/SuggestMealsSheet';
import { CalendarPicker } from '../components/CalendarPicker';
import { MealReplaceItemSheet, type MealReplacement } from '../components/MealReplaceItemSheet';
import { ListBulkBar } from '../components/ListBulkBar';
import { useRowSelection } from '../hooks/useRowSelection';
import { Fab, FAB_SIZE, type FabDragHandlers } from '../components/Fab';
import {
  FabDropZone,
  FabDropZoneProvider,
  useFabIntentChannel,
  useFabIntentSelector,
  type FabDropZonesHandle,
  type FabIntentChannel,
} from '../components/FabDropZones';
import { type DragScroller, type DropZone, type FabDropIntent } from '../utils/fabDrop';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { LeftoversCard } from '../components/LeftoversCard';
import { LeftoverSheet, type LeftoverSeed } from '../components/LeftoverSheet';
import { isLiveLeftover, leftoverPartsFor } from '../utils/leftovers';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, border, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { buildWeekDays } from '../utils/calendarGrid';
import { dayKeyOf, dayKeyToDate } from '../utils/dateUtils';
import {
  prepTaskDraftsForMeal,
  suggestRecipesForEmptyNight,
  pantryCoverageForRecipe,
  type PantryCoverage,
  type PrepTaskDraft,
} from '../utils/recipeUtils';
import { recentlyCookedTitles } from '../utils/mealIdeas';
import {
  applyChoice,
  recipeChoiceGroups,
  flattenRecipeIngredients,
  flattenRecipePrepTasks,
  recipeMap,
} from '../utils/recipeComponents';
import {
  dayKeyRange,
  defaultPlanningDay,
  describeAddedToList,
  describeWeekPlan,
  describeWeekRange,
  entriesForDay,
  recipeIndex,
  titleForEntry,
} from '../utils/mealPlan';

/**
 * Tints a day section while the add-button drag is aimed at it — the same
 * "arm on the way in, ease out on the way off" treatment `GroupDropTarget`
 * gives a stack, but flush against this screen's own card rather than traced
 * off `TaskGroupTray`'s margins, since a day section carries no tray of its
 * own to match.
 */
function DayDropHighlight({ active, children }: { active: boolean; children: React.ReactNode }) {
  const colors = useColors();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: active ? animation.duration.fast : animation.duration.normal,
      useNativeDriver: true,
    }).start();
  }, [active, progress]);

  return (
    <View style={dropHighlightStyles.wrap}>
      {children}
      <Animated.View
        pointerEvents="none"
        style={[
          dropHighlightStyles.highlight,
          { borderColor: colors.accent, backgroundColor: colors.accentSubtle, opacity: progress },
        ]}
      />
    </View>
  );
}

// Static — colors are applied inline above, since this wraps a section that
// isn't itself theme-dependent in shape.
const dropHighlightStyles = StyleSheet.create({
  wrap: { position: 'relative' },
  highlight: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.md,
    borderWidth: border.md,
  },
});

// A day section, lit up while the add button is being dragged over it. Reads
// the drag intent through the channel (not screen state) for the same reason
// TodayScreen's GroupDropTargetRow does — the target changes several times a
// second while the finger moves, and re-rendering the whole day list on every
// sample is what that channel exists to avoid.
function DayDropTargetRow({
  channel,
  dayKey,
  children,
}: {
  channel: FabIntentChannel;
  dayKey: string;
  children: React.ReactNode;
}) {
  const aimed = useFabIntentSelector(channel, intent => intent?.kind === 'day' && intent.dayKey === dayKey);
  return <DayDropHighlight active={aimed}>{children}</DayDropHighlight>;
}

// The add button, naming what a release right now would do.
function AddMealFabWithDropLabel({
  channel,
  ...props
}: {
  channel: FabIntentChannel;
} & Omit<React.ComponentProps<typeof Fab>, 'dragLabel'>) {
  const label = useFabIntentSelector(channel, intent => {
    if (intent?.kind === 'cancel') return 'Cancel';
    if (intent?.kind !== 'day') return null;
    return `Plan a meal on ${intent.dayLabel}`;
  });
  return <Fab {...props} dragLabel={label} />;
}

/**
 * The week plan.
 *
 * **Seven vertical day sections, not a horizontal week strip.** At 390pt a
 * 7-column strip gives each day about 52pt, which cannot hold "Sausage &
 * fennel ragù" — a strip is a date-*picker* affordance, and every cell here
 * carries content. Content under a day already has a settled treatment in this
 * app and it's vertical.
 *
 * **No drag *between* days in this increment.** Moving a planned meal is a row
 * action opening a compact 7-day chip row (see MealEntrySheet); cross-section
 * drag has needed bespoke math twice here and the one built for Today's
 * category headers never lined up with the finger and was deleted along with
 * its helpers. Dragging the add button *onto* a day to plan a new meal there
 * is a different gesture — the same one Projects/Templates/Grocery already
 * use to place a new row — and doesn't reopen that question: it never
 * reorders anything, it only names which day's `planningDay` opens.
 *
 * The store is loaded a week at a time rather than wholesale, and that matters
 * more here than it looks: `enableScreens(false)` makes `freezeOnBlur` inert
 * app-wide, so this screen stays mounted and re-renders on every store change
 * once it has been visited.
 */
export function MealPlanScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<any>();

  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  // #1063's gate. Without a key the suggestion sheet is exactly the offline
  // one it has always been — the ranking below is deliberately ungated.
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  // Any date inside the week on screen. Paging moves the anchor, never the days.
  const [anchor, setAnchor] = useState(() => new Date());

  const days = useMemo(() => buildWeekDays(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const range = useMemo(() => dayKeyRange(days), [days]);

  const entries = useMealPlanStore(useShallow(s => s.entries));
  const loadRange = useMealPlanStore(s => s.loadRange);
  const planMeal = useMealPlanStore(s => s.planMeal);
  const moveEntry = useMealPlanStore(s => s.moveEntry);
  const removeEntry = useMealPlanStore(s => s.removeEntry);
  const renameEntry = useMealPlanStore(s => s.renameEntry);
  const markEntryCooked = useMealPlanStore(s => s.markCooked);
  const setRecipeChoices = useMealPlanStore(s => s.setRecipeChoices);
  const addedToListAt = useMealPlanStore(useShallow(s => s.addedToListAt));
  const bulkDeleteEntries = useMealPlanStore(s => s.bulkDeleteEntries);
  const bulkMoveEntries = useMealPlanStore(s => s.bulkMoveEntries);
  const bulkReplaceItem = useMealPlanStore(s => s.bulkReplaceItem);
  const bulkSetCooked = useMealPlanStore(s => s.bulkSetCooked);

  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const recipesById = useMemo(() => recipeIndex(recipes), [recipes]);
  const markRecipeCooked = useRecipeStore(s => s.markCooked);

  const leftovers = useLeftoverStore(useShallow(s => s.leftovers));
  const logLeftover = useLeftoverStore(s => s.logLeftover);
  const renameLeftover = useLeftoverStore(s => s.renameLeftover);
  const setLeftoverStoredAt = useLeftoverStore(s => s.setStoredAt);
  const setLeftoverKeepDays = useLeftoverStore(s => s.setKeepDays);
  const finishLeftover = useLeftoverStore(s => s.finishLeftover);
  const reopenLeftover = useLeftoverStore(s => s.reopenLeftover);
  const deleteLeftover = useLeftoverStore(s => s.deleteLeftover);
  const addTask = useTaskStore(s => s.addTask);
  const groceryItems = useGroceryStore(useShallow(s => s.items));

  // The day being planned; null when the picker is closed.
  const [planningDay, setPlanningDay] = useState<string | null>(null);
  // Held by id rather than by value so the entry sheet's chips follow a move it
  // just made — the row itself is re-read from the store on every render.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = entries.find(e => e.id === selectedId) ?? null;
  const [addingToList, setAddingToList] = useState(false);
  const [suggestingMeals, setSuggestingMeals] = useState(false);
  // Per-day collapse, local-only — every day starts expanded, and folding one
  // away is just less to scroll past, not a decision worth persisting.
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());

  // ——— Bulk selection (#1110) ————————————————————————————————————————
  //
  // Plain useRowSelection, the same as RecipesScreen/TemplatesScreen use for
  // their non-task rows — no recurrence-aware delete flow to borrow from
  // useTaskSelection (a meal plan entry never repeats; recurrence lives on
  // Task, not MealPlanEntry), and no PaintSelectionProvider: painting exists
  // to save taps down one long column of checkboxes, and this list is the
  // opposite shape — a handful of entries a piece, broken into seven
  // collapsible day sections rather than one flat scroll. A drag through a
  // collapsed day's header, or across the gap between two day cards, has no
  // obvious answer for what it should paint, so the tap-per-row toggle every
  // other non-task list already settled on is the one used here too.
  const {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
  } = useRowSelection();
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const [bulkMoveVisible, setBulkMoveVisible] = useState(false);
  const [bulkReplaceVisible, setBulkReplaceVisible] = useState(false);

  const toggleDayCollapse = (key: string) => {
    haptics.tap();
    animateLayout();
    setCollapsedDays(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // ——— Dragging the add button onto a day ————————————————————————————
  //
  // Same gesture as Projects'/Templates'/Grocery's add-button drag, over a
  // much flatter shape than any of theirs: seven day bands, no ordering
  // within one, no category grouping. Each day is a `day` zone (fabDrop.ts)
  // and a drop anywhere in its band means "plan a meal on this day" — there's
  // no midpoint to split, the same "whole band" rule a stack row already gets.
  const dropZonesRef = useRef<FabDropZonesHandle>(null);
  const [fabDragging, setFabDragging] = useState(false);
  const fabIntentChannel = useFabIntentChannel();
  // Lets the drag autoscroll the day list once the finger reaches either end —
  // FlatList doesn't expose the DragScroller contract itself, so it's read off
  // a plain scroll listener the same way ReorderableList's own does.
  const scrollControl = useRef<DragScroller | null>(null);
  const flatListRef = useRef<FlatList<Date>>(null);
  const scrollOffsetRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  useEffect(() => {
    scrollControl.current = {
      getOffset: () => scrollOffsetRef.current,
      getMaxOffset: () => Math.max(0, contentHeightRef.current - viewportHeightRef.current),
      scrollToOffset: (y: number) => {
        scrollOffsetRef.current = y;
        flatListRef.current?.scrollToOffset({ offset: y, animated: false });
      },
    };
  }, []);

  const openPlanningForDrop = (intent: FabDropIntent) => {
    // Dropped back on the button: the drag is the whole of what happened.
    if (intent.kind === 'cancel') {
      haptics.tap();
      return;
    }
    const dayKey = intent.kind === 'day' ? intent.dayKey : defaultPlanningDay(days);
    if (dayKey) setPlanningDay(dayKey);
  };

  const fabDrag: FabDragHandlers = {
    onStart: () => {
      setFabDragging(true);
      dropZonesRef.current?.begin();
    },
    onMove: (pageY, home) => dropZonesRef.current?.moveTo(pageY, home),
    onEnd: (pageY, home) => {
      setFabDragging(false);
      // end()/cancel() publish a null intent themselves, which is what clears
      // the button's drag label.
      openPlanningForDrop(dropZonesRef.current?.end(pageY, home) ?? { kind: 'plain' });
    },
    onCancel: () => {
      setFabDragging(false);
      dropZonesRef.current?.cancel();
    },
  };

  // A plain tap carries no drop target, so it needs its own sane guess —
  // today when the week on screen has it, otherwise the first day shown.
  const openPlanningForTap = () => {
    const dayKey = defaultPlanningDay(days);
    if (dayKey) setPlanningDay(dayKey);
  };

  // The recipe whose ingredients we're offering to re-add after mark-cooked —
  // null closes RecipeToListSheet, same on/off pattern as `addingToList`.
  // Carries the entry's picks alongside the recipe: you cooked the roast
  // potatoes, so the re-shop offers the roast potatoes' lines.
  const [cookedRecipeForList, setCookedRecipeForList] =
    useState<{ recipe: Recipe; choices: string[] } | null>(null);

  // The leftover sheet's two modes, held apart so opening one can't leave the
  // other's state behind: an id for editing a row, a seed for logging a new
  // one. Both null means the sheet is closed. The row itself is re-read from
  // the store by id on every render, so the sheet's caption follows an edit it
  // just made — same discipline `selected` keeps above.
  const [editingLeftoverId, setEditingLeftoverId] = useState<string | null>(null);
  const [loggingLeftover, setLoggingLeftover] = useState<LeftoverSeed | null>(null);
  const editingLeftover = leftovers.find(l => l.id === editingLeftoverId) ?? null;

  useEffect(() => {
    if (range) loadRange(range.startKey, range.endKey);
  }, [range?.startKey, range?.endKey, loadRange]);

  const onThisWeek = isSameWeek(anchor, new Date(), { weekStartsOn });

  // A selection is scoped to the week on screen — the store's bulk methods
  // would still reach an off-screen id fine, but the bar's counts and
  // "Select All" wouldn't, so paging away closes the selection rather than
  // carrying stale ids into a week that doesn't render them.
  const page = (delta: number) => {
    haptics.tap();
    if (selectionMode) exitSelection();
    setAnchor(a => addWeeks(a, delta));
  };

  // The sheet itself decides when to close (its own "Done" button, backdrop
  // tap, swipe) — a pick here just writes the meal and stays open, ready for
  // the next slot on the same day. See RecipePickerSheet.pick.
  const pick = (pickResult: MealPick) => {
    if (!planningDay) return;
    animateLayout();
    const entry = planMeal({
      date: planningDay,
      slot: pickResult.slot,
      recipeId: pickResult.recipeId,
      leftoverId: pickResult.leftoverId,
      title: pickResult.title,
    });
    if (entry) offerPrepTasks(entry);
  };

  const addPrepTaskDrafts = (drafts: PrepTaskDraft[]) => {
    drafts.forEach(({ title, dueDate, reminderTime }) => addTask({ title, dueDate, reminderTime }));
    haptics.success();
  };

  // Components' prep steps come along with their ingredients — "boil the
  // potatoes the night before" is a fact about the mash, and the night before
  // is the same night whichever dinner the mash is part of.
  const addPrepTasksForSelected = () => {
    if (!selected?.recipeId) return;
    const recipe = recipesById.get(selected.recipeId);
    if (!recipe) return;
    // Under this meal's own picks: "boil the potatoes the night before" is a
    // step of the mash, and a night having the roast potatoes instead shouldn't
    // land it on the task list.
    const drafts = prepTaskDraftsForMeal(
      recipe, recipesById, dayKeyToDate(selected.date), { chosen: selected.recipeChoices }
    );
    if (drafts.length === 0) return;
    addPrepTaskDrafts(drafts);
    Alert.alert('Prep tasks added', `Added ${drafts.length} to your tasks.`);
  };

  /**
   * The ask at plan time. Prep steps are the part of a recipe that has to
   * happen before the day it's cooked — "get the beef out of the freezer" is
   * no use once you're at the hob — so the moment the meal lands on a date is
   * both the first moment those days can be worked out and the last one where
   * they're all still ahead of you. Leaving it to the entry sheet's action
   * means the dish is remembered but the defrosting isn't.
   *
   * An offer, not something planning does by itself — the same restraint
   * mark-cooked keeps about leftovers, and for the same reason: plenty of
   * prep steps are ones the user does from memory and doesn't want a task for.
   * A meal with no prep steps (and a leftover or a typed-in title, which have
   * no recipe to have any) asks nothing at all, so most picks are unchanged.
   */
  const offerPrepTasks = (entry: MealPlanEntry) => {
    const recipe = entry.recipeId ? recipesById.get(entry.recipeId) : undefined;
    if (!recipe) return;
    // A freshly planned entry has never had a choice made against it (see
    // planMeal), so this always resolves to the defaults — same as leaving
    // `resolution` off.
    const drafts = prepTaskDraftsForMeal(
      recipe, recipesById, dayKeyToDate(entry.date), { chosen: entry.recipeChoices }
    );
    if (drafts.length === 0) return;
    const one = drafts.length === 1;
    Alert.alert(
      'Add prep tasks?',
      `${recipe.name} has ${drafts.length} prep step${one ? '' : 's'}. Add ${one ? 'it' : 'them'} to your tasks?`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: 'Add', onPress: () => addPrepTaskDrafts(drafts) },
      ]
    );
  };

  // Shared by the sheet's "Mark cooked" action and the row's own badge tap —
  // same mutation, same "add ingredients back to the list" follow-up either
  // way, so marking cooked from the row isn't a lesser version of the sheet's.
  const markCooked = (entry: MealPlanEntry) => {
    markEntryCooked(entry.id);
    const recipe = entry.recipeId ? recipesById.get(entry.recipeId) : undefined;
    if (recipe) markRecipeCooked(recipe.id);
    haptics.success();

    // The "was that the last of it?" ask belongs here, not at plan time —
    // the meal has actually been eaten now. Only asked once: a leftover
    // that's already finished (or was never live) has nothing to ask about.
    if (entry.leftoverId) {
      const leftover = leftovers.find(l => l.id === entry.leftoverId);
      if (leftover && isLiveLeftover(leftover)) {
        Alert.alert(
          'Finished the leftovers?',
          `Was that the last of the ${leftover.title}?`,
          [
            { text: 'Still some left', style: 'cancel' },
            { text: 'Finished it', onPress: () => finishLeftover(leftover.id, 'eaten') },
          ]
        );
      }
    }

    // A recipe with nothing to re-shop offers nothing — same restraint
    // RecipeDetailScreen's own "Add ingredients to list" already keeps, and
    // counted the same way: a dish whose ingredients all live on its
    // components still has a shop.
    if (!recipe || flattenRecipeIngredients(recipe, recipesById, { chosen: entry.recipeChoices }).length === 0) return;
    setCookedRecipeForList({ recipe, choices: entry.recipeChoices });
  };

  // ——— Bulk selection actions (#1110) ——————————————————————————————————

  const selectedIdList = useMemo(() => Array.from(selectedIds), [selectedIds]);

  // "Cooked"/"Uncooked" flips direction based on the selection itself, same
  // as Recipes' bulk Favorite/Unfavorite and the task bar's Pin/Unpin — a
  // selection that's already all cooked has nothing left to mark.
  const allSelectedCooked = useMemo(() => {
    if (selectedIds.size === 0) return false;
    return selectedIdList.every(id => entries.find(e => e.id === id)?.cookedAt);
  }, [selectedIds, selectedIdList, entries]);

  const handleBulkMarkCooked = () => {
    const cooked = !allSelectedCooked;
    if (cooked) {
      // Bumps each distinct recipe's cookCount once, mirroring the single-row
      // markCooked flow above — but only for entries newly transitioning to
      // cooked, and never in the other direction: cookCount only ever counts
      // up (see bulkSetCooked's doc comment).
      const newlyCooked = selectedIdList
        .map(id => entries.find(e => e.id === id))
        .filter((e): e is MealPlanEntry => !!e && !e.cookedAt);
      const recipeIds = new Set(
        newlyCooked.map(e => e.recipeId).filter((id): id is string => !!id)
      );
      recipeIds.forEach(markRecipeCooked);
    }
    bulkSetCooked(selectedIdList, cooked);
    haptics.success();
    exitSelection();
  };

  const handleBulkMove = (date: Date) => {
    animateLayout();
    bulkMoveEntries(selectedIdList, { date: dayKeyOf(date) });
    setBulkMoveVisible(false);
    exitSelection();
  };

  const handleBulkReplace = (replacement: MealReplacement) => {
    bulkReplaceItem(selectedIdList, replacement);
    setBulkReplaceVisible(false);
    haptics.success();
    exitSelection();
  };

  const handleBulkDelete = () => {
    const count = selectedIdList.length;
    const plural = count === 1 ? 'meal' : 'meals';
    haptics.warning();
    Alert.alert(
      `Remove ${count} ${plural}?`,
      `You're about to take ${count} ${plural} off the plan. This can't be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            bulkDeleteEntries(selectedIdList);
            exitSelection();
          },
        },
      ],
    );
  };

  /**
   * Opens the log sheet prefilled from a planned meal — the entry point the
   * leftovers tracker is mostly reached through, since a container in the
   * fridge nearly always started as something on the plan.
   *
   * Deliberately an action on the entry rather than something mark-cooked does
   * by itself: not every meal leaves any, and a sheet that opened uninvited
   * after every cooking would be a second modal chasing the ingredient one.
   *
   * The parts are read under the entry's *own* choices, so a night the roast
   * potatoes won never offers to log leftover mash — the mash was never made.
   * An uncomposed meal yields a single part, which the sheet renders exactly as
   * it always did.
   */
  const logLeftoversFor = (entry: MealPlanEntry) => {
    setSelectedId(null);
    const title = titleForEntry(entry, recipesById);
    const recipe = entry.recipeId ? recipesById.get(entry.recipeId) : undefined;
    setLoggingLeftover({
      title,
      recipeId: entry.recipeId,
      sourceEntryId: entry.id,
      parts: leftoverPartsFor(title, recipe, recipesById, { chosen: entry.recipeChoices }),
    });
  };

  /** Whether an entry's leftover is still in the fridge and worth offering to close out. */
  const liveLeftoverFor = (leftoverId: string) => {
    const leftover = leftovers.find(l => l.id === leftoverId);
    return !!leftover && isLiveLeftover(leftover);
  };

  /**
   * Whether a meal could have left anything yet — cooked, or at least a day
   * that's arrived. Next Thursday's dinner offering to log its leftovers is the
   * kind of always-on action that makes a sheet longer without ever being the
   * one you wanted. Marking cooked is the usual route in, but it isn't required:
   * plenty of meals get eaten without the badge ever being tapped.
   */
  const couldHaveLeftovers = (entry: MealPlanEntry) =>
    !!entry.cookedAt || entry.date <= dayKeyOf(new Date());

  const renderDay = useCallback(({ item: day }: { item: Date }) => {
    const key = dayKeyOf(day);
    const dayEntries = entriesForDay(entries, key);
    const today = isToday(day);
    const collapsed = collapsedDays.has(key);
    const weekdayName = format(day, 'EEEE');
    const dayLabel = format(day, 'EEEE d MMMM');
    // Whole-band target: any drop inside this day's zone means "plan a meal
    // here", so there's no anchor/before split to carry, unlike a task row.
    const zone: DropZone = { kind: 'day', key, dayKey: key, dayLabel: weekdayName };

    return (
      <FabDropZone zone={zone}>
        <DayDropTargetRow channel={fabIntentChannel} dayKey={key}>
          <View style={styles.section}>
            <TouchableOpacity
              style={styles.dayHeader}
              onPress={() => toggleDayCollapse(key)}
              activeOpacity={interaction.activeOpacity}
              accessibilityRole="button"
              accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${dayLabel}`}
              accessibilityState={{ expanded: !collapsed }}
            >
              <View style={styles.dayHeaderLeft}>
                <Text style={[styles.dayName, today && styles.dayNameToday]}>
                  {weekdayName}
                </Text>
                {collapsed && dayEntries.length > 0 && (
                  <Text style={styles.dayCount}>({dayEntries.length})</Text>
                )}
                <Ionicons
                  name={collapsed ? 'chevron-forward' : 'chevron-down'}
                  size={13}
                  color={colors.textTertiary}
                />
              </View>
              <Text style={styles.dayDate}>{today ? 'Today' : format(day, 'd MMM')}</Text>
            </TouchableOpacity>

            {!collapsed && (
              dayEntries.length > 0 ? (
                <View style={styles.card}>
                  {dayEntries.map((entry, idx) => (
                    <React.Fragment key={entry.id}>
                      {idx > 0 && <View style={styles.sep} />}
                      <MealSlotRow
                        entry={entry}
                        title={titleForEntry(entry, recipesById)}
                        hasRecipe={!!entry.recipeId && recipesById.has(entry.recipeId)}
                        onPress={() => {
                          if (selectionMode) toggleSelection(entry.id);
                          else { haptics.tap(); setSelectedId(entry.id); }
                        }}
                        onMarkCooked={
                          selectionMode || entry.cookedAt ? undefined : () => markCooked(entry)
                        }
                        selectionMode={selectionMode}
                        selected={selectedIds.has(entry.id)}
                      />
                    </React.Fragment>
                  ))}
                </View>
              ) : (
                // No per-day add affordance any more (see #1092) — planning a
                // meal for a specific day happens by dragging the screen's FAB
                // here; this is plain status text, not a control.
                <Text style={styles.emptyDayText}>No meals planned yet</Text>
              )
            )}
          </View>
        </DayDropTargetRow>
      </FabDropZone>
    );
  }, [entries, recipesById, styles, collapsedDays, colors, fabIntentChannel, selectionMode, selectedIds, toggleSelection]);

  // Cheap enough to compute on every render: whether there's anything an "Add
  // week to list" could possibly find, without running the full ingredient
  // collection just to light up a header icon.
  const hasPlannableEntries = entries.some(e => e.recipeId && recipesById.has(e.recipeId));

  // Counted over the whole component tree, so a dish whose only prep steps
  // live on one of its parts still offers the action.
  const selectedRecipe = selected?.recipeId ? recipesById.get(selected.recipeId) : undefined;
  const selectedResolution = { chosen: selected?.recipeChoices ?? [] };
  const selectedPrepTaskCount = selectedRecipe
    ? flattenRecipePrepTasks(selectedRecipe, recipesById, selectedResolution).length
    : 0;

  // The either/or slots this meal has to answer, read under its own current
  // answers — so a choice nested inside the chosen option appears and one
  // inside the option it replaced doesn't.
  const selectedChoiceGroups = selectedRecipe
    ? recipeChoiceGroups(selectedRecipe, recipesById, selectedResolution)
    : [];

  // Offline "what can I make from what I've got" — only worth computing once
  // there's an empty week to fill, and re-ranked each time the sheet reopens
  // by staying a plain memo rather than sheet-local state.
  const emptyWeekSuggestions = useMemo(
    () => entries.length === 0 ? suggestRecipesForEmptyNight(recipes, groceryItems, new Date(), 5) : [],
    [entries.length, recipes, groceryItems]
  );

  // The visible half of #1103's pantry signal — computed only for the
  // recipes actually on the suggestions shelf, same "just the visible list"
  // scoping RecipesScreen's pantryCounts uses, not the whole library.
  const suggestionPantryCoverage = useMemo(() => {
    const byId = recipeMap(recipes);
    const map = new Map<string, PantryCoverage>();
    for (const recipe of emptyWeekSuggestions) {
      map.set(recipe.id, pantryCoverageForRecipe(recipe, groceryItems, new Date(), byId));
    }
    return map;
  }, [emptyWeekSuggestions, recipes, groceryItems]);

  // The shelf still opens on an empty week the offline ranking can't fill, so
  // long as there's a key for the generation half to use (#1063) — that empty
  // week is exactly the case AI ideas exist for. With no key the condition is
  // unchanged: nothing to rank, no button.
  const canSuggestMeals = emptyWeekSuggestions.length > 0
    || (!!anthropicApiKey && entries.length === 0);

  // Context for the AI half of that sheet (#1063), so an invented idea isn't
  // something already on the week or something cooked last Tuesday. Both are
  // cheap and only read when the sheet is open.
  const plannedMealTitles = useMemo(() => entries.map(e => e.title).filter(Boolean), [entries]);
  const recentMealTitles = useMemo(() => recentlyCookedTitles(recipes, new Date()), [recipes]);

  const planSuggestion = (recipe: Recipe, dateKey: string) => {
    animateLayout();
    const entry = planMeal({ date: dateKey, slot: 'dinner', recipeId: recipe.id, title: recipe.name });
    if (entry) offerPrepTasks(entry);
  };

  const headerActions = useMemo<ScreenHeaderAction[]>(() => {
    const actions: ScreenHeaderAction[] = [
      { icon: 'chevron-back', onPress: () => page(-1), accessibilityLabel: 'Previous week' },
      { icon: 'chevron-forward', onPress: () => page(1), accessibilityLabel: 'Next week' },
    ];
    // Only offered once there's somewhere to come back from, so the header
    // isn't carrying a permanently inert button.
    if (!onThisWeek) {
      actions.push({
        icon: 'today-outline',
        onPress: () => { haptics.tap(); if (selectionMode) exitSelection(); setAnchor(new Date()); },
        accessibilityLabel: 'Back to this week',
      });
    }
    actions.push({
      icon: 'checkmark-circle-outline',
      onPress: () => (selectionMode ? exitSelection() : enterSelectionMode()),
      active: selectionMode,
      accessibilityLabel: selectionMode ? 'Done selecting' : 'Select meals',
    });
    return actions;
  }, [onThisWeek, selectionMode]);

  const addedStamp = range ? addedToListAt[range.startKey] : undefined;
  const subtitle = [
    describeWeekPlan(entries),
    addedStamp ? describeAddedToList(addedStamp, new Date(), weekStartsOn) : null,
  ].filter(Boolean).join(' · ');

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Meal plan"
        overline={describeWeekRange(days)}
        subtitle={subtitle}
        actions={headerActions}
        right={
          selectionMode ? undefined : (
            <InlineAction
              label="Add"
              icon="cart-outline"
              onPress={() => { haptics.tap(); setAddingToList(true); }}
              disabled={!hasPlannableEntries}
              accessibilityLabel="Add this week to the grocery list"
            />
          )
        }
      />
      <GroceriesHubPills active="MealPlan" />

      <FabDropZoneProvider
        ref={dropZonesRef}
        onIntentChange={fabIntentChannel.publish}
        scroller={scrollControl}
      >
        <FlatList
          ref={flatListRef}
          data={days}
          keyExtractor={d => dayKeyOf(d)}
          renderItem={renderDay}
          contentContainerStyle={styles.list}
          // The user can't scroll during an add-button drag (the button's
          // responder has the touch); the drag scrolls it instead, through the
          // control wired up above.
          scrollEnabled={!fabDragging}
          onScroll={e => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          onLayout={e => { viewportHeightRef.current = e.nativeEvent.layout.height; }}
          onContentSizeChange={(_w, h) => { contentHeightRef.current = h; }}
          // Hidden while selecting: both are shortcuts off the week (into the
          // leftover sheet, into the suggestion sheet) and opening one out
          // from under an in-progress selection would lose it — same restraint
          // RecipesScreen's own list header takes with its "Cook again" shelf.
          ListHeaderComponent={
            selectionMode ? null : (
              <>
                {/* Above the week rather than beside it: the fridge is what should
                    be eaten before anything new is planned, and it renders nothing
                    at all when empty (see LeftoversCard). */}
                <LeftoversCard
                  leftovers={leftovers}
                  onPress={l => setEditingLeftoverId(l.id)}
                  onAdd={() => setLoggingLeftover({})}
                />
                {canSuggestMeals && (
                  <InlineAction
                    label="Suggest meals"
                    icon="restaurant-outline"
                    variant="neutral"
                    onPress={() => { haptics.tap(); setSuggestingMeals(true); }}
                    accessibilityLabel="Suggest meals made from what's in your grocery catalog"
                    style={styles.suggestMeals}
                  />
                )}
              </>
            )
          }
          ListFooterComponent={
            <View
              style={{
                height: selectionMode
                  ? tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm
                  : tabBarHeight + FAB_SIZE + spacing.xl,
              }}
            />
          }
        />
      </FabDropZoneProvider>

      {/*
        Hidden rather than merely disabled while selecting (#1110) — same
        move RecipesScreen makes for its own add button. It settles the
        selection-vs-drag conflict CLAUDE.md calls out for this change: with
        no FAB mounted there's no drag responder to arm, so a selection can't
        leave the drag armed and a drag can't be started out from under an
        in-progress selection. The bulk bar takes the button's floating spot
        instead, and planning a new meal isn't something you're doing
        mid-selection anyway — same restraint the "Add" header button and the
        leftovers/suggestions shelf above take.
      */}
      {!selectionMode && (
        <AddMealFabWithDropLabel
          channel={fabIntentChannel}
          onPress={openPlanningForTap}
          accessibilityLabel="Plan a meal"
          bottom={insets.bottom + tabBarHeight + spacing.md}
          drag={fabDrag}
          dragHint="Drag onto a day to plan a meal there, or back to the button to cancel"
        />
      )}

      {selectionMode && (
        <ListBulkBar
          selectedCount={selectedIds.size}
          totalCount={entries.length}
          actions={[
            {
              key: 'move',
              icon: 'calendar-outline',
              label: 'Move',
              onPress: () => { haptics.tap(); setBulkMoveVisible(true); },
            },
            {
              key: 'replace',
              icon: 'swap-horizontal-outline',
              label: 'Replace',
              onPress: () => { haptics.tap(); setBulkReplaceVisible(true); },
            },
            {
              key: 'cooked',
              icon: allSelectedCooked ? 'close-circle-outline' : 'checkmark-circle-outline',
              label: allSelectedCooked ? 'Uncook' : 'Cooked',
              onPress: handleBulkMarkCooked,
            },
            { key: 'delete', icon: 'trash', label: 'Delete', tone: 'destructive', onPress: handleBulkDelete },
          ]}
          onSelectAll={() => selectAll(entries.map(e => e.id))}
          onDeselectAll={deselectAll}
          onCancel={exitSelection}
          bottomInset={tabBarHeight}
          onHeightChange={setBulkBarHeight}
        />
      )}

      <CalendarPicker
        visible={bulkMoveVisible}
        value={null}
        mode="date"
        title={`Move ${selectedIds.size} meal${selectedIds.size === 1 ? '' : 's'}`}
        nlEnabled
        onConfirm={handleBulkMove}
        onCancel={() => setBulkMoveVisible(false)}
      />

      <MealReplaceItemSheet
        visible={bulkReplaceVisible}
        count={selectedIds.size}
        onReplace={handleBulkReplace}
        onClose={() => setBulkReplaceVisible(false)}
      />

      <RecipePickerSheet
        visible={planningDay !== null}
        dayLabel={planningDay ? format(dayKeyToDate(planningDay), 'EEEE') : ''}
        // Dinner is what a week plan is mostly about, and it's the slot a tap
        // means when the user didn't say. The chips are right there to say
        // otherwise.
        defaultSlot="dinner"
        onPick={pick}
        onClose={() => setPlanningDay(null)}
      />

      <MealEntrySheet
        visible={selected !== null}
        entry={selected}
        title={selected ? titleForEntry(selected, recipesById) : ''}
        weekDays={days}
        onMove={to => selected && moveEntry(selected.id, to)}
        onRemove={() => {
          if (!selected) return;
          animateLayout();
          removeEntry(selected.id);
          setSelectedId(null);
        }}
        onRename={
          selected && !selected.recipeId && !selected.leftoverId
            ? newTitle => renameEntry(selected.id, newTitle)
            : undefined
        }
        choiceGroups={selectedChoiceGroups}
        onChoose={(group, componentId) => {
          if (!selected) return;
          setRecipeChoices(
            selected.id,
            applyChoice(selected.recipeChoices, group, componentId)
          );
        }}
        onMarkCooked={selected && !selected.cookedAt ? () => markCooked(selected) : undefined}
        onOpenRecipe={
          selected?.recipeId && recipesById.has(selected.recipeId)
            ? () => navigation.navigate('RecipeDetail', { recipeId: selected.recipeId })
            : undefined
        }
        onAddPrepTasks={selectedPrepTaskCount > 0 ? addPrepTasksForSelected : undefined}
        onLogLeftovers={
          selected && !selected.leftoverId && couldHaveLeftovers(selected)
            ? () => logLeftoversFor(selected)
            : undefined
        }
        onFinishLeftover={
          selected?.leftoverId && liveLeftoverFor(selected.leftoverId)
            ? () => finishLeftover(selected.leftoverId!, 'eaten')
            : undefined
        }
        onClose={() => setSelectedId(null)}
      />

      {range && (
        <AddWeekToListSheet
          visible={addingToList}
          entries={entries}
          recipesById={recipesById}
          range={range}
          onClose={() => setAddingToList(false)}
        />
      )}

      <SuggestMealsSheet
        visible={suggestingMeals}
        recipes={emptyWeekSuggestions}
        pantryByRecipeId={suggestionPantryCoverage}
        weekDays={days}
        aiIdeasEnabled={!!anthropicApiKey}
        plannedTitles={plannedMealTitles}
        recentTitles={recentMealTitles}
        slotsToFill={days.length}
        onPlan={planSuggestion}
        onClose={() => setSuggestingMeals(false)}
      />

      <RecipeToListSheet
        visible={cookedRecipeForList !== null}
        recipe={cookedRecipeForList?.recipe ?? null}
        recipesById={recipesById}
        initialChoices={cookedRecipeForList?.choices}
        onClose={() => setCookedRecipeForList(null)}
      />

      <LeftoverSheet
        visible={editingLeftover !== null || loggingLeftover !== null}
        leftover={editingLeftover}
        seed={loggingLeftover ?? undefined}
        // The seed's own `title`/`recipeId` are deliberately not spread back in
        // — they were only ever the sheet's starting point, and by the time
        // this fires the user may have typed over the name or ticked the mash
        // instead of the meal. `sourceEntryId` is the one thing the sheet
        // can't have changed: every container here came out of that cooking,
        // whichever part of it it is.
        onLog={(picks, storedAt, keepDays) => picks.forEach(pick => logLeftover({
          title: pick.title,
          storedAt,
          keepDays,
          recipeId: pick.recipeId,
          sourceEntryId: loggingLeftover?.sourceEntryId ?? null,
        }))}
        onRename={title => editingLeftover && renameLeftover(editingLeftover.id, title)}
        onSetStoredAt={storedAt => editingLeftover && setLeftoverStoredAt(editingLeftover.id, storedAt)}
        onSetKeepDays={days => editingLeftover && setLeftoverKeepDays(editingLeftover.id, days)}
        onFinish={outcome => editingLeftover && finishLeftover(editingLeftover.id, outcome)}
        onReopen={() => editingLeftover && reopenLeftover(editingLeftover.id)}
        onDelete={() => editingLeftover && deleteLeftover(editingLeftover.id)}
        onClose={() => { setEditingLeftoverId(null); setLoggingLeftover(null); }}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  list: {
    paddingTop: spacing.xs,
  },
  section: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
  },
  dayHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  // Uppercase section-header treatment, matching every other list section
  // header in the app.
  dayName: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  dayNameToday: {
    color: colors.accent,
  },
  dayCount: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  dayDate: {
    color: colors.textTertiary,
    fontSize: font.xs,
  },
  card: {
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  sep: {
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.md + 32 + spacing.md,
  },
  // Replaces the old per-day "Add a meal"/"Add" InlineAction (#1092) — plain
  // status text, not a control, since planning now happens by dragging the
  // screen's FAB onto a day.
  emptyDayText: {
    color: colors.textTertiary,
    fontSize: font.sm,
    marginTop: spacing.xs,
  },
  suggestMeals: {
    alignSelf: 'flex-start',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
});
