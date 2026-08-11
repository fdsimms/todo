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
import type { Leftover, MealPlanEntry, MealSlot, Recipe } from '../types';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { GroceriesHubPills } from '../components/GroceriesHubPills';
import { InlineAction } from '../components/InlineAction';
import { MealSlotRow } from '../components/MealSlotRow';
import { MealEntrySheet } from '../components/MealEntrySheet';
import { RecipePickerSheet, type MealPick } from '../components/RecipePickerSheet';
import { AddWeekToListSheet } from '../components/AddWeekToListSheet';
import { RecipeToListSheet } from '../components/RecipeToListSheet';
import { PrepTasksReviewSheet } from '../components/PrepTasksReviewSheet';
import { SuggestMealsSheet } from '../components/SuggestMealsSheet';
import { CalendarPicker } from '../components/CalendarPicker';
import { MealReplaceItemSheet, type MealReplacement } from '../components/MealReplaceItemSheet';
import { ListBulkBar } from '../components/ListBulkBar';
import { useRowSelection } from '../hooks/useRowSelection';
import { usePlanMeal } from '../hooks/usePlanMeal';
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
import {
  LeftoverDragCard,
  LeftoversCard,
  type LeftoverDragHandlers,
} from '../components/LeftoversCard';
import { LeftoverSheet, type LeftoverSeed } from '../components/LeftoverSheet';
import { PlanMealSheet } from '../components/PlanMealSheet';
import { FridgeHistorySheet } from '../components/FridgeHistorySheet';
import { isLiveLeftover, leftoverPartsFor, mealTitleForLeftover } from '../utils/leftovers';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, border, animation, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { buildWeekDays } from '../utils/calendarGrid';
import { dayKeyOf, dayKeyToDate } from '../utils/dateUtils';
import {
  resolvePrepTaskDraft,
  suggestRecipesForEmptyNight,
  pantryCoverageForRecipe,
  type PantryCoverage,
} from '../utils/recipeUtils';
import { recentlyCookedTitles } from '../utils/mealIdeas';
import {
  applyChoice,
  describeChoices,
  recipeChoiceGroups,
  flattenRecipeIngredients,
  flattenRecipePrepTasks,
  recipeMap,
  type FlatPrepTask,
} from '../utils/recipeComponents';
import {
  dayKeyRange,
  daysWithoutMeal,
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
/**
 * How far back a "copy last week" offer will look for a week worth copying.
 * Four weeks covers a holiday and a fortnightly cook; past that, whatever it
 * found would be too old to be "last week" in any useful sense.
 */
const COPY_LOOKBACK_WEEKS = 4;

/** How far a lifted fridge row swells. Deliberately SortableList's LIFT_SCALE. */
const DRAG_LIFT_SCALE = 1.03;

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
  const setEntryCooked = useMealPlanStore(s => s.setCooked);
  const setLastAction = useMealPlanStore(s => s.setLastAction);
  const setRecipeChoices = useMealPlanStore(s => s.setRecipeChoices);
  const setRecipeScale = useMealPlanStore(s => s.setRecipeScale);
  const addedToListAt = useMealPlanStore(useShallow(s => s.addedToListAt));
  const bulkDeleteEntries = useMealPlanStore(s => s.bulkDeleteEntries);
  const bulkMoveEntries = useMealPlanStore(s => s.bulkMoveEntries);
  const bulkReplaceItem = useMealPlanStore(s => s.bulkReplaceItem);
  const bulkSetCooked = useMealPlanStore(s => s.bulkSetCooked);
  const copyWeek = useMealPlanStore(s => s.copyWeek);
  const findPlannedWeekBefore = useMealPlanStore(s => s.findPlannedWeekBefore);

  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const recipesById = useMemo(() => recipeIndex(recipes), [recipes]);
  const markRecipeCooked = useRecipeStore(s => s.markCooked);
  const startCookTimer = useRecipeStore(s => s.startCookTimer);
  const restoreCookStats = useRecipeStore(s => s.restoreCookStats);

  const leftovers = useLeftoverStore(useShallow(s => s.leftovers));
  const logLeftover = useLeftoverStore(s => s.logLeftover);
  const renameLeftover = useLeftoverStore(s => s.renameLeftover);
  const setLeftoverStoredAt = useLeftoverStore(s => s.setStoredAt);
  const setLeftoverKeepDays = useLeftoverStore(s => s.setKeepDays);
  const finishLeftover = useLeftoverStore(s => s.finishLeftover);
  const reopenLeftover = useLeftoverStore(s => s.reopenLeftover);
  const deleteLeftover = useLeftoverStore(s => s.deleteLeftover);
  const addTask = useTaskStore(s => s.addTask);
  // The prep-task offer lives in the hook now that four surfaces make it —
  // this screen, the recipe detail screen, a recipe row and the Cook again
  // shelf. `planRecipe` is unused here: this screen plans free text and
  // leftovers too, so it calls planMeal directly and only shares the offer.
  const { offerPrepTasks } = usePlanMeal();
  const groceryItems = useGroceryStore(useShallow(s => s.items));

  // The day being planned; null when the picker is closed.
  const [planningDay, setPlanningDay] = useState<string | null>(null);
  // Held by id rather than by value so the entry sheet's chips follow a move it
  // just made — the row itself is re-read from the store on every render.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = entries.find(e => e.id === selectedId) ?? null;
  const [addingToList, setAddingToList] = useState(false);
  // What the suggestion shelf was opened with — the ranked recipes and the
  // nights they may land on, captured at open rather than re-read while it's
  // up. Held as a snapshot for the same reason `cookedRecipeForList` and
  // `loggingLeftover` are: accepting a suggestion changes the week, and a
  // sheet whose contents are recomputed from the week rewrites itself under
  // the finger that just tapped it. Null closes it.
  const [suggesting, setSuggesting] =
    useState<{ recipes: Recipe[]; days: Date[] } | null>(null);
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
  // The entry whose date is being picked outside this week (#1364) — held by
  // id, since MealEntrySheet has closed by the time the calendar is up.
  const [movingFurtherId, setMovingFurtherId] = useState<string | null>(null);
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
    useState<{ recipe: Recipe; choices: string[]; scale: number } | null>(null);

  // The leftover sheet's two modes, held apart so opening one can't leave the
  // other's state behind: an id for editing a row, a seed for logging a new
  // one. Both null means the sheet is closed. The row itself is re-read from
  // the store by id on every render, so the sheet's caption follows an edit it
  // just made — same discipline `selected` keeps above.
  const [editingLeftoverId, setEditingLeftoverId] = useState<string | null>(null);
  const [loggingLeftover, setLoggingLeftover] = useState<LeftoverSeed | null>(null);
  const [historyVisible, setHistoryVisible] = useState(false);
  // The container whose night is being picked, off the fridge card's calendar
  // button; null closes the sheet.
  const [planningLeftover, setPlanningLeftover] = useState<Leftover | null>(null);
  const editingLeftover = leftovers.find(l => l.id === editingLeftoverId) ?? null;

  // ——— Dragging a container out of the fridge onto a day ————————————————
  //
  // The card's calendar button opens PlanMealSheet's day chips; this is the
  // same question answered by pointing at the week that is already on screen
  // underneath it. It reuses the add button's drop zones wholesale — the day
  // bands are registered once (see renderDay) and answer both gestures, so
  // there is one piece of hit-testing here and one set of highlights, and a
  // container drop lands on exactly the day a new meal would.
  //
  // What it does NOT reuse is the button's cancel well: dropping a container
  // anywhere that isn't a day already means "nothing happened" (there is no
  // sheet it would otherwise open), so `plain` is the way out and the corner
  // needs no second meaning.
  const [fridgeDrag, setFridgeDrag] = useState<{ leftover: Leftover; top: number } | null>(null);
  // Whether a finger is still on a container, which is *not* the same question
  // as whether a card is on screen: the card outlives the gesture by the length
  // of its spring home, and the week has to be scrollable again the moment the
  // finger lifts rather than a third of a second later.
  const [fridgeDragging, setFridgeDragging] = useState(false);
  // The same container, for the handlers: `onEnd` fires from a responder that
  // was created before this render, and the state above is what draws the card
  // rather than what the drop reads.
  const draggedLeftoverRef = useRef<Leftover | null>(null);
  const ghostX = useRef(new Animated.Value(0)).current;
  const ghostY = useRef(new Animated.Value(0)).current;
  const ghostOpacity = useRef(new Animated.Value(1)).current;
  // Bumped per drag, so a settle animation left over from the previous one
  // can't clear the card of the drag that has already replaced it.
  const ghostRunRef = useRef(0);
  // The layer the floating card is positioned inside. Measured rather than
  // assumed: it is a child of a container that carries the top safe-area
  // inset as padding, and an absolutely-positioned child is laid out from the
  // padding edge — so its own window origin is the only honest thing to
  // subtract a row's measured band from.
  const dragLayerRef = useRef<View | null>(null);
  const dragLayerTopRef = useRef(0);

  /**
   * Puts the floating card back where it was lifted from and fades it out.
   *
   * The same ending whether the drop landed or not, and deliberately so: the
   * container does not leave the fridge either way (see Leftover.finishedAt),
   * so a card that flew off to Thursday would be describing a move that didn't
   * happen. What says the drop landed is the meal row appearing on the day.
   */
  const settleFridgeDrag = () => {
    const run = ghostRunRef.current;
    Animated.parallel([
      Animated.spring(ghostX, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }),
      Animated.spring(ghostY, { toValue: 0, ...animation.spring.snappy, useNativeDriver: true }),
      Animated.timing(ghostOpacity, {
        toValue: 0, duration: animation.duration.normal, useNativeDriver: true,
      }),
    ]).start(() => {
      if (ghostRunRef.current === run) setFridgeDrag(null);
    });
  };

  /**
   * What a release over the week means. Dinner, for the same reason the
   * picker defaults to it — a week plan is mostly about dinners, and a drop is
   * a one-gesture decision with nowhere to say otherwise. The row's calendar
   * button still opens the sheet for anyone who wants lunch.
   *
   * `planMeal` registers its own undo, so a mis-drop is a shake away.
   */
  const planLeftoverOnDrop = (leftover: Leftover, intent: FabDropIntent) => {
    // Released clear of every day: the drag is the whole of what happened, and
    // the card springing home has already said so.
    if (intent.kind !== 'day') return;
    animateLayout();
    planMeal({
      date: intent.dayKey,
      slot: 'dinner',
      leftoverId: leftover.id,
      title: mealTitleForLeftover(leftover),
    });
    haptics.success();
  };

  const fridgeDragHandlers: LeftoverDragHandlers = {
    onStart: (leftover, frame) => {
      ghostRunRef.current += 1;
      ghostX.setValue(0);
      ghostY.setValue(0);
      ghostOpacity.setValue(1);
      draggedLeftoverRef.current = leftover;
      setFridgeDragging(true);
      setFridgeDrag({ leftover, top: frame.top - dragLayerTopRef.current });
      dropZonesRef.current?.begin();
    },
    onMove: (pageY, translation) => {
      ghostX.setValue(translation.x);
      ghostY.setValue(translation.y);
      // No `home` argument: with no corner to come back to, every sample is
      // "out over the list", which is also the only state that autoscrolls —
      // and autoscroll is what puts Sunday within reach of a card lifted from
      // above Monday.
      dropZonesRef.current?.moveTo(pageY);
    },
    onEnd: pageY => {
      const leftover = draggedLeftoverRef.current;
      draggedLeftoverRef.current = null;
      setFridgeDragging(false);
      const intent = dropZonesRef.current?.end(pageY) ?? { kind: 'plain' as const };
      settleFridgeDrag();
      if (leftover) planLeftoverOnDrop(leftover, intent);
    },
    onCancel: () => {
      draggedLeftoverRef.current = null;
      setFridgeDragging(false);
      dropZonesRef.current?.cancel();
      settleFridgeDrag();
    },
  };

  useEffect(() => {
    if (range) loadRange(range.startKey, range.endKey);
  }, [range?.startKey, range?.endKey, loadRange]);

  const onThisWeek = isSameWeek(anchor, new Date(), { weekStartsOn });

  // A selection is scoped to the week on screen — the store's bulk methods
  // would still reach an off-screen id fine, but the bar's counts and
  // "Select All" wouldn't, so paging away closes the selection rather than
  // carrying stale ids into a week that doesn't render them.
  // useCallback so headerActions can depend on it honestly: the memo below
  // reads `page`, and listing an inline function there would rebuild the
  // actions every render, which is the memo's whole job to avoid.
  const page = useCallback((delta: number) => {
    haptics.tap();
    if (selectionMode) exitSelection();
    setAnchor(a => addWeeks(a, delta));
  }, [selectionMode, exitSelection]);

  // A pick arrives *after* the sheet has closed itself — see
  // RecipePickerSheet.pick, which dismisses first so the prep-task alert below
  // isn't raised from underneath a live Modal. `planningDay` has been cleared
  // by then, which is why the day rides along on the pick rather than being
  // read back off screen state here.
  const pick = (pickResult: MealPick) => {
    if (!pickResult.date) return;
    animateLayout();
    const entry = planMeal({
      date: pickResult.date,
      slot: pickResult.slot,
      recipeId: pickResult.recipeId,
      leftoverId: pickResult.leftoverId,
      title: pickResult.title,
    });
    if (entry) offerPrepTasks(entry);
  };

  // Components' prep steps come along with their ingredients — "boil the
  // potatoes the night before" is a fact about the mash, and the night before
  // is the same night whichever dinner the mash is part of.
  //
  // Which entry the review sheet is open for — held by id like `selected`,
  // so a prep task added or removed on the recipe mid-review is reflected
  // rather than frozen at the moment the sheet opened.
  const [reviewingPrepTasksFor, setReviewingPrepTasksFor] = useState<string | null>(null);
  const reviewingEntry = entries.find(e => e.id === reviewingPrepTasksFor) ?? null;
  const reviewingRecipe = reviewingEntry?.recipeId ? recipesById.get(reviewingEntry.recipeId) ?? null : null;

  const addChosenPrepTasks = (chosen: FlatPrepTask[]) => {
    if (!reviewingEntry) return;
    const mealDate = dayKeyToDate(reviewingEntry.date);
    chosen.forEach(({ prepTask }) => {
      const { dueDate, reminderTime } = resolvePrepTaskDraft(prepTask, mealDate);
      addTask({ title: prepTask.title, dueDate, reminderTime });
    });
    haptics.success();
    Alert.alert('Prep tasks added', `Added ${chosen.length} to your tasks.`);
  };

  // Shared by the sheet's "Mark cooked" action and the row's own badge tap —
  // same mutation, same "add ingredients back to the list" follow-up either
  // way, so marking cooked from the row isn't a lesser version of the sheet's.
  /**
   * Ticking a meal off, and un-ticking it.
   *
   * Two writes — the entry's own `cookedAt` and the recipe's counters — and
   * one action, which is why the undo is registered here rather than in either
   * store: only this knows they belong together.
   *
   * **Undo hands the recipe's counters back; "not cooked" does not.** They are
   * different claims. Un-ticking says "this meal isn't cooked *now*", a state
   * going forward, and cookCount is a counter that only rises everywhere else
   * in this app. Undo says the tap never happened, so it puts back exactly
   * what was there — including `lastCookedAt`, which matters more than the
   * count: a stray tap otherwise tells the suggestion ranking this dish was
   * cooked today and quietly drops it from "cook again" for weeks.
   */
  const setCooked = (entry: MealPlanEntry, cooked: boolean) => {
    setEntryCooked(entry.id, cooked);
    const recipe = entry.recipeId ? recipesById.get(entry.recipeId) : undefined;
    // Only a cooking bumps the recipe. Un-ticking leaves it alone — see above.
    const before = cooked && recipe ? markRecipeCooked(recipe.id) : null;
    cooked ? haptics.success() : haptics.tap();

    setLastAction({
      label: cooked ? `Cooked "${entry.title}"` : `Un-cooked "${entry.title}"`,
      undo: () => {
        setEntryCooked(entry.id, !cooked);
        if (recipe && before) restoreCookStats(recipe.id, before);
      },
    });

    if (!cooked) return;

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
    setCookedRecipeForList({ recipe, choices: entry.recipeChoices, scale: entry.recipeScale });
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
      // The snapshot markRecipeCooked returns is for the single-row undo; a
      // bulk mark registers its own undo through the store and never restores
      // recipe counters (see bulkSetCooked), so it's discarded here.
      recipeIds.forEach(id => markRecipeCooked(id));
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

  /**
   * What a row says about the either/or this meal answers. Empty for the many
   * meals that pose none, which is the common path and costs a map lookup.
   */
  const describeEntryChoices = useCallback((entry: MealPlanEntry): string => {
    const recipe = entry.recipeId ? recipesById.get(entry.recipeId) : undefined;
    if (!recipe || recipe.components.length === 0) return '';
    return describeChoices(recipeChoiceGroups(recipe, recipesById, { chosen: entry.recipeChoices }));
  }, [recipesById]);

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
                  size={iconSize.xs}
                  color={colors.textTertiary}
                />
              </View>
              <Text style={styles.dayDate}>{today ? 'Today' : format(day, 'd MMM')}</Text>
            </TouchableOpacity>

            {/*
              An empty day is its header and the band under it, and nothing
              else. It used to carry "No meals planned yet" — plain status text
              since #1092 took the per-day add button away — which cost about
              22pt a day for a sentence repeated up to seven times down one
              screen, and on a normal week (three or four dinners planned) that
              was most of what pushed the weekend below the fold (#1374). The
              band stays the size it is because it is also the drop target for
              the add button, and the week-level hint above says the thing the
              seven copies were each saying badly.
            */}
            {!collapsed && dayEntries.length > 0 && (
              (
                <View style={styles.card}>
                  {dayEntries.map((entry, idx) => (
                    <React.Fragment key={entry.id}>
                      {idx > 0 && <View style={styles.sep} />}
                      <MealSlotRow
                        entry={entry}
                        title={titleForEntry(entry, recipesById)}
                        hasRecipe={!!entry.recipeId && recipesById.has(entry.recipeId)}
                        choices={describeEntryChoices(entry)}
                        onPress={() => {
                          if (selectionMode) toggleSelection(entry.id);
                          else { haptics.tap(); setSelectedId(entry.id); }
                        }}
                        onToggleCooked={
                          selectionMode ? undefined : () => setCooked(entry, !entry.cookedAt)
                        }
                        selectionMode={selectionMode}
                        selected={selectedIds.has(entry.id)}
                      />
                    </React.Fragment>
                  ))}
                </View>
              )
            )}
          </View>
        </DayDropTargetRow>
      </FabDropZone>
    );
    // `leftovers` is not referenced in the JSX above and still belongs here:
    // the row's cooked toggle calls setCooked, which reads the fridge to
    // decide whether to ask "was that the last of it?". Left out, a container
    // closed from the fridge card while this list stayed mounted is still live
    // to this closure, and the badge asks about a leftover that's already been
    // finished. Don't prune it as unused.
  }, [entries, recipesById, styles, collapsedDays, colors, fabIntentChannel, selectionMode, selectedIds, toggleSelection, leftovers, describeEntryChoices]);

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

  // The nights this week still has room for. Both the gate on the shelf below
  // and the days it may plan onto — see daysWithoutMeal for why those have to
  // be the same answer.
  const openDinnerDays = useMemo(
    () => daysWithoutMeal(entries, days, 'dinner'),
    [entries, days]
  );

  // Offline "what can I make from what I've got", ranked over the recipe box
  // and the grocery catalog.
  //
  // **Deliberately independent of what's already planned.** It used to be
  // `entries.length === 0 ? rank(...) : []`, which made the ranking collapse to
  // nothing the moment the week held anything — including the moment the user
  // accepted the sheet's own first suggestion, which emptied the list they were
  // reading out from under them mid-flow. The week decides whether the shelf is
  // *offered* (canSuggestMeals), never what is on it.
  const mealSuggestions = useMemo(
    () => suggestRecipesForEmptyNight(recipes, groceryItems, new Date(), 5),
    [recipes, groceryItems]
  );

  // The visible half of #1103's pantry signal — computed only for the
  // recipes actually on the suggestions shelf, same "just the visible list"
  // scoping RecipesScreen's pantryCounts uses, not the whole library.
  const suggestionPantryCoverage = useMemo(() => {
    const byId = recipeMap(recipes);
    const map = new Map<string, PantryCoverage>();
    for (const recipe of mealSuggestions) {
      map.set(recipe.id, pantryCoverageForRecipe(recipe, groceryItems, new Date(), byId));
    }
    return map;
  }, [mealSuggestions, recipes, groceryItems]);

  // Offered whenever there's a night to fill and something to fill it with —
  // a ranked recipe, or a key for the generation half to invent one (#1063).
  //
  // The gate used to demand a *completely* empty week, which hid the shelf for
  // the whole of the job it exists for: someone who has planned Monday and
  // wants help with the other six nights is exactly the person asking. A week
  // with every dinner spoken for still offers nothing, since there is nowhere
  // for an acceptance to land.
  const canSuggestMeals = openDinnerDays.length > 0
    && (mealSuggestions.length > 0 || !!anthropicApiKey);

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
  }, [onThisWeek, selectionMode, page, enterSelectionMode, exitSelection]);

  /**
   * The week a "copy" would take from, and only while this one is empty.
   *
   * **Offered into an empty week and no other**, which is what keeps the whole
   * feature free of a merge question: no "does it replace or add alongside",
   * no double-booked Tuesday, no confirm dialog explaining which. A week with
   * anything in it is a week the user is already working on.
   *
   * Searched rather than assumed — a fortnightly cook, or anyone back from a
   * holiday, has an empty week directly behind them and nothing to copy from
   * it (see findPlannedWeekBefore).
   */
  const copySourceKey = useMemo(
    () => (range && entries.length === 0 ? findPlannedWeekBefore(range.startKey, COPY_LOOKBACK_WEEKS) : null),
    [range?.startKey, entries.length, findPlannedWeekBefore]
  );

  const copySourceLabel = useMemo(
    () => copySourceKey ? describeWeekRange(buildWeekDays(dayKeyToDate(copySourceKey), weekStartsOn)) : '',
    [copySourceKey, weekStartsOn]
  );

  const handleCopyWeek = () => {
    if (!copySourceKey || !range) return;
    animateLayout();
    const n = copyWeek(copySourceKey, range.startKey);
    if (n > 0) haptics.success();
  };

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
          // control wired up above. A fridge-row drag has to switch it off
          // explicitly for the same reason SortableList's callers do — that
          // responder is a *descendant* of this list, so the native scroll
          // would otherwise take the touch on the first finger move.
          scrollEnabled={!fabDragging && !fridgeDragging}
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
                  onPlan={l => setPlanningLeftover(l)}
                  onAdd={() => setLoggingLeftover({})}
                  onHistory={() => { haptics.tap(); setHistoryVisible(true); }}
                  drag={fridgeDragHandlers}
                />
                {/*
                  The two things you do to a *week* rather than to a meal, in
                  one row above it. "Add week to list" used to live in the
                  header's `right` slot — the only use of it in the app — beside
                  four icon buttons and the longest subtitle in the app, which
                  is what made that header the most crowded one here (#1373).
                  It belongs next to "Suggest meals" anyway: same object, same
                  weight, and neither is a per-meal action.
                */}
                {/*
                  Said once for the week rather than once per day. A brand-new
                  user's first sight of this screen is otherwise seven bare day
                  headers, and this is also the only resting place anything
                  mentions the add button's drag (its own `dragHint` only
                  appears once a drag is already under way — #1369).
                */}
                {entries.length === 0 && (
                  <Text style={styles.emptyWeekHint}>
                    {copySourceKey
                      ? 'Nothing planned this week. Copy the week below, tap + to plan today, or drag it onto a day.'
                      : 'Nothing planned this week. Tap + to plan today, or drag it onto a day.'}
                  </Text>
                )}
                {/* Reads as the answer to the hint directly above it, and
                    disappears the moment the week has anything — see
                    copySourceKey. */}
                {!!copySourceKey && (
                  <View style={styles.weekActions}>
                    <InlineAction
                      label={`Copy ${copySourceLabel}`}
                      icon="copy-outline"
                      onPress={handleCopyWeek}
                      accessibilityLabel={`Copy the meals from ${copySourceLabel} onto this week`}
                    />
                  </View>
                )}
                {(hasPlannableEntries || canSuggestMeals) && (
                  <View style={styles.weekActions}>
                    {hasPlannableEntries && (
                      <InlineAction
                        label="Add week to list"
                        icon="cart-outline"
                        onPress={() => { haptics.tap(); setAddingToList(true); }}
                        accessibilityLabel="Add this week's ingredients to the grocery list"
                      />
                    )}
                    {canSuggestMeals && (
                      <InlineAction
                        label="Suggest meals"
                        icon="restaurant-outline"
                        variant="neutral"
                        onPress={() => {
                          haptics.tap();
                          setSuggesting({ recipes: mealSuggestions, days: openDinnerDays });
                        }}
                        accessibilityLabel="Suggest meals made from what's in your grocery catalog"
                      />
                    )}
                  </View>
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

      {/*
        The container in flight, over everything else on the screen — the add
        button included, since a drag can pass across the corner it sits in.
        Always mounted so it can measure its own origin before a drag needs it
        (see dragLayerTopRef), and inert: the finger is being tracked by the
        fridge card's responder, and a layer that could take a touch would end
        the drag it exists to draw.
      */}
      <View
        ref={dragLayerRef}
        style={styles.dragLayer}
        pointerEvents="none"
        onLayout={() => dragLayerRef.current?.measureInWindow?.((_x, y) => {
          if (Number.isFinite(y)) dragLayerTopRef.current = y;
        })}
      >
        {fridgeDrag && (
          <Animated.View
            style={[
              styles.dragCard,
              {
                top: fridgeDrag.top,
                opacity: ghostOpacity,
                transform: [
                  { translateX: ghostX },
                  { translateY: ghostY },
                  // The same lift the row drags elsewhere in the app use, so
                  // one gesture doesn't pick things up further than another.
                  { scale: DRAG_LIFT_SCALE },
                ],
              },
            ]}
          >
            <LeftoverDragCard leftover={fridgeDrag.leftover} channel={fabIntentChannel} />
          </Animated.View>
        )}
      </View>

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
        dayKey={planningDay ?? ''}
        dayLabel={planningDay ? format(dayKeyToDate(planningDay), 'EEEE') : ''}
        // Dinner is what a week plan is mostly about, and it's the slot a tap
        // means when the user didn't say. The chips are right there to say
        // otherwise.
        defaultSlot="dinner"
        onPick={pick}
        onClose={() => setPlanningDay(null)}
      />

      {/*
        The way past the sheet's seven day chips. It opens after that sheet has
        gone — two modals can't be up at once — and lands on the same
        CalendarPicker the bulk move uses, natural language included.
      */}
      <CalendarPicker
        visible={movingFurtherId !== null}
        value={null}
        mode="date"
        title="Move to"
        nlEnabled
        onConfirm={date => {
          if (movingFurtherId) {
            animateLayout();
            moveEntry(movingFurtherId, { date: dayKeyOf(date) });
          }
          setMovingFurtherId(null);
        }}
        onCancel={() => setMovingFurtherId(null)}
      />

      <MealEntrySheet
        visible={selected !== null}
        entry={selected}
        title={selected ? titleForEntry(selected, recipesById) : ''}
        weekDays={days}
        onMove={to => selected && moveEntry(selected.id, to)}
        onMoveFurther={selected ? () => setMovingFurtherId(selected.id) : undefined}
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
        onScale={
          selected?.recipeId && recipesById.has(selected.recipeId)
            ? factor => selected && setRecipeScale(selected.id, factor)
            : undefined
        }
        baseServings={selectedRecipe?.servings}
        baseServingsMax={selectedRecipe?.servingsMax}
        onSetCooked={selected ? cooked => setCooked(selected, cooked) : undefined}
        onStartCooking={
          selected?.recipeId && recipesById.has(selected.recipeId)
            ? () => {
                // The timer lives on the recipe, so starting it here means the
                // screen opens with it already running — no navigation param,
                // no second source of truth. Idempotent if one is already going.
                startCookTimer(selected.recipeId!);
                navigation.navigate('RecipeDetail', { recipeId: selected.recipeId });
              }
            : undefined
        }
        onOpenRecipe={
          selected?.recipeId && recipesById.has(selected.recipeId)
            ? () => navigation.navigate('RecipeDetail', { recipeId: selected.recipeId })
            : undefined
        }
        onAddPrepTasks={
          selectedPrepTaskCount > 0
            ? () => selected && setReviewingPrepTasksFor(selected.id)
            : undefined
        }
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
        visible={suggesting !== null}
        recipes={suggesting?.recipes ?? []}
        pantryByRecipeId={suggestionPantryCoverage}
        openDays={suggesting?.days ?? []}
        aiIdeasEnabled={!!anthropicApiKey}
        plannedTitles={plannedMealTitles}
        recentTitles={recentMealTitles}
        slotsToFill={suggesting?.days.length ?? 0}
        onPlan={planSuggestion}
        onClose={() => setSuggesting(null)}
      />

      <RecipeToListSheet
        visible={cookedRecipeForList !== null}
        recipe={cookedRecipeForList?.recipe ?? null}
        recipesById={recipesById}
        initialChoices={cookedRecipeForList?.choices}
        initialScale={cookedRecipeForList?.scale}
        onClose={() => setCookedRecipeForList(null)}
      />

      <PrepTasksReviewSheet
        visible={reviewingPrepTasksFor !== null}
        recipe={reviewingRecipe}
        recipesById={recipesById}
        resolution={{ chosen: reviewingEntry?.recipeChoices ?? [] }}
        onAdd={addChosenPrepTasks}
        onClose={() => setReviewingPrepTasksFor(null)}
      />

      {/* Closes itself before handing a row over, so the two sheets are never
          up at once — the history's rows lead into LeftoverSheet, which is
          where reopening and deleting already live. */}
      {/*
        Planning a container is the same "pick a night" question planning a
        recipe is, so it's the same sheet. No `onPlanned`: a leftover has no
        recipe and therefore no prep steps to offer. The title captures the age
        at plan time exactly as the picker's own leftover path does — see
        mealTitleForLeftover for why that isn't resolved live.
      */}
      <PlanMealSheet
        visible={planningLeftover !== null}
        title={planningLeftover?.title ?? null}
        onPlan={(dateKey, slot) => planningLeftover ? planMeal({
          date: dateKey,
          slot,
          leftoverId: planningLeftover.id,
          title: mealTitleForLeftover(planningLeftover),
        }) : null}
        onClose={() => setPlanningLeftover(null)}
      />

      <FridgeHistorySheet
        visible={historyVisible}
        leftovers={leftovers}
        weekStartsOn={weekStartsOn}
        onOpen={l => setEditingLeftoverId(l.id)}
        onClose={() => setHistoryVisible(false)}
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
  emptyWeekHint: {
    color: colors.textTertiary,
    fontSize: font.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  // Above the list and above the add button (zIndex 20), so nothing the
  // dragged container passes over is drawn on top of it.
  dragLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
  },
  // Inset to match the fridge card's own margins, so the copy starts exactly
  // over the row it was lifted from.
  dragCard: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
  },
  weekActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
});
