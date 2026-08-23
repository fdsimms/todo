// The meal-planning week: one component of ~1,090 lines, so grep a landmark
// rather than reading it start to finish:
//
//   ==== <name> ====        the section banners through the logic half
//   DayDropHighlight, DayDropTargetRow   the drop targets, at module level
//   makeStyles              styles, at the bottom
//
// Leftovers and the fridge are planned from here too; the rules live in
// src/utils/leftovers.ts and src/utils/mealPlan.ts.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View, Text, FlatList, StyleSheet, Alert, TouchableOpacity, Share } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import { addWeeks } from 'date-fns/addWeeks';
import { format } from 'date-fns/format';
import { isToday } from 'date-fns/isToday';
import { isSameWeek } from 'date-fns/isSameWeek';
import { isBefore } from 'date-fns/isBefore';
import { MEAL_SLOTS, type Leftover, type MealPlanEntry, type MealSlot, type Recipe } from '../types';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { GroceriesHubPills } from '../components/GroceriesHubPills';
import { ActiveTripBanner } from '../components/ActiveTripBanner';
import { InlineAction } from '../components/InlineAction';
import { SegmentedControl } from '../components/SegmentedControl';
import { PeriodNav } from '../components/PeriodNav';
import { MealSlotRow } from '../components/MealSlotRow';
import { MealEntrySheet } from '../components/MealEntrySheet';
import { RecipePickerSheet, type MealPick } from '../components/RecipePickerSheet';
import { mealSlotSourceId } from '../utils/mealSlotTasks';
import { AddMealsToListSheet } from '../components/AddMealsToListSheet';
import { RecipeToListSheet } from '../components/RecipeToListSheet';
import { OfferBanner } from '../components/OfferBanner';
import { CookedUseUpOffer } from '../components/CookedUseUpOffer';
import { PrepTasksReviewSheet } from '../components/PrepTasksReviewSheet';
import { SuggestMealsSheet } from '../components/SuggestMealsSheet';
import { CalendarPicker } from '../components/CalendarPicker';
import { MealReplaceItemSheet, type MealReplacement } from '../components/MealReplaceItemSheet';
import { ListBulkBar } from '../components/ListBulkBar';
import { useRowSelection } from '../hooks/useRowSelection';
import { usePlanMeal } from '../hooks/usePlanMeal';
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
import {
  isLiveLeftover,
  leftoverKeepDaysFor,
  leftoverPartsFor,
  mealTitleForLeftover,
  suggestableLeftovers,
} from '../utils/leftovers';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, lineHeight, radius, border, animation, interaction, iconSize, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { animateLayout } from '../utils/layoutAnimation';
import { resolveActiveTrip } from '../utils/activeTrip';
import { resetToGroceries } from '../navigation/navigationRef';
import { buildWeekDays } from '../utils/calendarGrid';
import { dayKeyOf, dayKeyToDate } from '../utils/dateUtils';
import {
  resolvePrepTaskDraft,
  suggestRecipesForEmptyNight,
  rankRecipeSuggestions,
  pantryCoverageForRecipe,
  type PantryCoverage,
} from '../utils/recipeUtils';
import { expiringItemHints, recentlyCookedTitles } from '../utils/mealIdeas';
import { kitchenInventory, useUpEntries } from '../utils/kitchenInventory';
import { excludeRecipesByTags } from '../utils/recipeTags';
import {
  applyChoice,
  describeChoices,
  recipeChoiceGroups,
  flattenRecipePrepTasks,
  recipeMap,
  type FlatPrepTask,
} from '../utils/recipeComponents';
import {
  dayKeyRange,
  describeAddedToList,
  describeWeekPlan,
  describeWeekRange,
  entriesForDay,
  recipeIndex,
  slotLabel,
  titleForEntry,
} from '../utils/mealPlan';
import { liveGeneratedTask } from '../utils/generatedTasks';
import { buildWeekPlanShareText } from '../utils/shareText';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import {
  classifyPlanned,
  hasShoppableMeals,
  plannedIngredientsForRecipe,
  restockRows,
} from '../utils/mealPlanGroceries';
import { decidableNights, weekNights } from '../utils/weekPlan';
import { standingSwapMap } from '../utils/standingSwaps';
import { describeWeekCost, estimateWeekCost } from '../utils/recipeCost';

/**
 * Tints a day section while a drag is aimed at it — the same "arm on the way
 * in, ease out on the way off" treatment `GroupDropTarget` gives a stack, but
 * flush against this screen's own card rather than traced off
 * `TaskGroupTray`'s margins, since a day section carries no tray of its own to
 * match.
 *
 * **It also draws the day's four meals as columns across the band**, with the
 * one a release would land in filled. That's the whole of the "which meal"
 * affordance: across the band picks the meal exactly as down the list picks the
 * day (see slotAtX in fabDrop.ts), so the day being aimed at is also the only
 * place the columns need to exist. `slot` is null when the drag is aimed
 * somewhere else, which is what fades the whole thing back out.
 *
 * The labels are bottom-aligned rather than centred so they sit in the
 * section's own `paddingBottom` — the one strip of a day band that is empty on
 * every day, planned or not. Centred, they landed on top of the day name on a
 * bare day and on top of a meal title on a full one, and translucent text over
 * text is unreadable in a way a tint over a card is not.
 */
function DayDropHighlight({ slot, children }: { slot: MealSlot | null; children: React.ReactNode }) {
  const colors = useColors();
  const active = slot !== null;
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
          { borderColor: colors.accent, opacity: progress },
        ]}
      >
        {MEAL_SLOTS.map((s, i) => (
          <View
            key={s}
            style={[
              dropHighlightStyles.lane,
              i > 0 && { borderLeftWidth: border.hairline, borderLeftColor: colors.accent },
              s === slot && { backgroundColor: colors.accentSubtle },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                dropHighlightStyles.laneLabel,
                s === slot
                  ? { color: colors.accent, fontWeight: fontWeight.semibold }
                  : { color: colors.textTertiary },
              ]}
            >
              {slotLabel(s)}
            </Text>
          </View>
        ))}
      </Animated.View>
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
    flexDirection: 'row',
    overflow: 'hidden',
  },
  lane: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  laneLabel: {
    fontSize: font.xs,
    lineHeight: lineHeight.xs,
  },
});

// A day section, lit up while a container dragged out of the fridge is over
// it. Reads the drag intent through the channel (not screen state) for the
// same reason TodayScreen's GroupDropTargetRow does — the target changes
// several times a second while the finger moves, and re-rendering the whole
// day list on every sample is what that channel exists to avoid.
//
// The selected value is the aimed *slot* rather than a boolean, so a finger
// crossing from Lunch into Dinner within one day re-renders that day and only
// that day — still a plain comparable string, which is what the channel's
// selector contract asks for.
function DayDropTargetRow({
  channel,
  dayKey,
  children,
}: {
  channel: FabIntentChannel;
  dayKey: string;
  children: React.ReactNode;
}) {
  const slot = useFabIntentSelector(channel, intent =>
    intent?.kind === 'day' && intent.dayKey === dayKey ? intent.slot : null);
  return <DayDropHighlight slot={slot}>{children}</DayDropHighlight>;
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
 * **Each day has its own add button, and there is no floating one.** Planning
 * a meal for a specific day used to mean dragging the screen's FAB onto that
 * day's band (#1092 removed the per-day button in favour of it, this reverses
 * #1092). That gesture had no resting affordance at all — its only explanation
 * was a `dragHint` that appeared once a drag was already under way — so the
 * one route into the feature was invisible until you guessed it, and a plain
 * tap on the button could only ever plan today. The + now sits in each day's
 * header, where it costs no vertical space and is in the same place whether or
 * not the day has anything in it.
 *
 * **The button's own drag is gone, but the day drop zones aren't.** Dragging a
 * container out of the fridge onto a day (see the "Dragging a container..."
 * block below) answers the same question the button's drag used to — which
 * day — so it reuses that infrastructure wholesale: `FabDropZone` registers
 * each day's band once in `renderDay`, `DayDropTargetRow`/`DayDropHighlight`
 * above light one up, and the autoscroll controller still runs so a card
 * lifted from above Monday can reach Sunday. Only the button-specific pieces
 * left with the button: `fabDragging`, the cancel well, `dragHint`.
 *
 * **It answers "which meal" too, across the band rather than down it.** The
 * band is divided into one column per meal (`slotAtX` in fabDrop.ts), which is
 * the one axis a day section had spare: it is a full screen wide and, before
 * this, said the same thing at every point of that width. Down the list still
 * picks the day, so nothing about reaching Sunday changed, and aiming at the
 * middle of a day is still dinner.
 *
 * **No drag *between* days either.** Moving a planned meal is a row action
 * opening a compact 7-day chip row plus an "Another date…" escape (see
 * MealEntrySheet); cross-section drag has needed bespoke math twice here and
 * the one built for Today's category headers never lined up with the finger
 * and was deleted along with its helpers.
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
  // ==== store bindings and layout insets ====
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<any>();
  const route = useRoute<any>();

  const weekStartsOn = useSettingsStore(s => s.weekStartsOn);
  // #1063's gate. Without a key the suggestion sheet is exactly the offline
  // one it has always been — the ranking below is deliberately ungated.
  const anthropicApiKey = useSettingsStore(s => s.anthropicApiKey);
  const restockOfferEnabled = useSettingsStore(s => s.restockOfferEnabled);
  const currencySymbol = useSettingsStore(s => s.currencySymbol);
  const excludedRecipeTags = useSettingsStore(useShallow(s => s.excludedRecipeTags));
  /**
   * How densely the week below is drawn — a stored setting rather than screen
   * state, unlike the "Whole week" lens whose nights card it replaces (#1669).
   *
   * A lens was a way of reading the week you had open right then, so it reset
   * with the screen; how much of a week you want on one screen is a standing
   * answer, and having to give it again on every visit is what would make the
   * dense reading the one nobody uses.
   */
  const compact = useSettingsStore(s => s.mealPlanCompact);
  const setDensity = useSettingsStore(s => s.setMealPlanCompact);
  // ==== local state (the week anchor, sheets, bulk selection, the fridge) ====
  // Any date inside the week on screen. Paging moves the anchor, never the days.
  const [anchor, setAnchor] = useState(() => new Date());

  const days = useMemo(() => buildWeekDays(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const range = useMemo(() => dayKeyRange(days), [days]);

  const entries = useMealPlanStore(useShallow(s => s.entries));
  // Real "today," independent of which week is on screen — decides which of
  // this week's days fold into the "Previous days" section below
  // (previousDaysInfo). Not gated on `days` finding a match the way the old
  // hero card's `todayDay` was: a past week is entirely previous days, a
  // future week has none, and both fall out of the same key compare.
  const todayKey = dayKeyOf(new Date());
  const loadRange = useMealPlanStore(s => s.loadRange);
  const planMeal = useMealPlanStore(s => s.planMeal);
  const moveEntry = useMealPlanStore(s => s.moveEntry);
  const removeEntry = useMealPlanStore(s => s.removeEntry);
  const renameEntry = useMealPlanStore(s => s.renameEntry);
  const setEntryCooked = useMealPlanStore(s => s.setCooked);
  const setCookTask = useMealPlanStore(s => s.setCookTask);
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
  // Only the shelves that *propose* a recipe read this — recipesById above
  // stays the full box, since a night already planned from an excluded
  // recipe must still render (see excludeRecipesByTags: this only narrows
  // what gets offered next, never what's already on the calendar).
  const suggestableRecipes = useMemo(
    () => excludeRecipesByTags(recipes, excludedRecipeTags),
    [recipes, excludedRecipeTags]
  );
  const markRecipeCooked = useRecipeStore(s => s.markCooked);
  const startCookTimer = useRecipeStore(s => s.startCookTimer);
  const restoreCookStats = useRecipeStore(s => s.restoreCookStats);
  const setRecipeVote = useRecipeStore(s => s.setVote);

  const leftovers = useLeftoverStore(useShallow(s => s.leftovers));
  const logLeftover = useLeftoverStore(s => s.logLeftover);
  const renameLeftover = useLeftoverStore(s => s.renameLeftover);
  const setLeftoverStoredAt = useLeftoverStore(s => s.setStoredAt);
  const setLeftoverKeepDays = useLeftoverStore(s => s.setKeepDays);
  const finishLeftover = useLeftoverStore(s => s.finishLeftover);
  const setLeftoverFrozen = useLeftoverStore(s => s.setFrozen);
  const reopenLeftover = useLeftoverStore(s => s.reopenLeftover);
  const deleteLeftover = useLeftoverStore(s => s.deleteLeftover);
  const addTask = useTaskStore(s => s.addTask);
  // The prep-task offer lives in the hook now that four surfaces make it —
  // this screen, the recipe detail screen, a recipe row and the Cook again
  // shelf. `planRecipe` is unused here: this screen plans free text and
  // leftovers too, so it calls planMeal directly and only shares the offer.
  const { offerPrepTasks } = usePlanMeal();
  const groceryItems = useGroceryStore(useShallow(s => s.items));
  const itemSubs = useGroceryStore(useShallow(s => s.itemSubs));
  // "Always use oat milk for milk", applied to every read here that shops or
  // asks about what was cooked — see standingSwaps.ts.
  const standingSwaps = useMemo(
    () => standingSwapMap(itemSubs, groceryItems),
    [itemSubs, groceryItems]
  );
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

  // The day being planned; null when the picker is closed.
  const [planningDay, setPlanningDay] = useState<string | null>(null);
  /**
   * Which slot the picker opens on, when something asked for one.
   *
   * Null means "the caller didn't say", and the sheet falls back to its own
   * remembered/dinner default — which is right for the + button on a day, where
   * the user is choosing a slot as much as a meal. A meal task's link is the
   * case that *does* say: "Choose lunch" has already named the slot, and making
   * someone re-tap the Lunch chip after tapping a row that says Lunch is the
   * kind of re-answering this whole feature exists to remove.
   */
  const [planningSlot, setPlanningSlot] = useState<MealSlot | null>(null);
  // Held by id rather than by value so the entry sheet's chips follow a move it
  // just made — the row itself is re-read from the store on every render.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = entries.find(e => e.id === selectedId) ?? null;
  /**
   * What an "add these to the list" tap asked for — the whole week, or one
   * day. Three scopes exist (a meal, a day, a week) and the other two share
   * one sheet, so what varies is held as data at the tap: the range the sheet
   * shops, the header naming it, and whether the add stamps the week as
   * shopped (only a whole-week add does — see AddMealsToListSheet).
   *
   * Kept alongside its own visibility flag rather than nulled on close, the
   * same pair `restockOffer`/`restockSheetVisible` below use: the sheet is a
   * real Modal that slides out, and clearing the scope on close would blank
   * its title and rows mid-animation.
   */
  const [addToListScope, setAddToListScope] =
    useState<{ range: { startKey: string; endKey: string }; title: string; stampWeekKey: string | null } | null>(null);
  const [addToListVisible, setAddToListVisible] = useState(false);
  /**
   * The one meal being shopped for, snapshotted at the tap — the third scope,
   * and the one that goes to RecipeToListSheet instead: at a single meal the
   * useful controls are the recipe's scale and either/or chips, which that
   * sheet has and AddMealsToListSheet doesn't. Starts on this meal's own
   * answers, and like the restock offer nothing the sheet does is written
   * back to the entry.
   */
  const [mealShop, setMealShop] =
    useState<{ recipe: Recipe; choices: string[]; scale: number } | null>(null);
  const [mealShopVisible, setMealShopVisible] = useState(false);
  // What the suggestion shelf was opened with — the ranked recipes and the
  // nights they may land on, captured at open rather than re-read while it's
  // up. Held as a snapshot for the same reason `cookedRecipeForList` and
  // `loggingLeftover` are: accepting a suggestion changes the week, and a
  // sheet whose contents are recomputed from the week rewrites itself under
  // the finger that just tapped it. Null closes it.
  const [suggesting, setSuggesting] =
    useState<{
      recipes: Recipe[];
      cookAgainRecipes: Recipe[];
      leftovers: Leftover[];
      days: Date[];
    } | null>(null);
  // Per-day collapse, local-only — folding one away is just less to scroll
  // past, not a decision worth persisting. Days before today are already
  // folded away wholesale by `previousDaysExpanded` below, so this starts
  // empty; today and every day after it start open, same as they always did.
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(() => new Set());
  // Whether the "Previous days" section (every day before today, in this
  // week) is unfolded. Collapsed by default — what's done is out of the way
  // — and it's one toggle for the whole block rather than per-day, since
  // per-day collapse used to mean paging in last week showed seven
  // individually-collapsed headers in a row. A day inside it can still be
  // folded again on its own via `collapsedDays` once the section is open.
  const [previousDaysExpanded, setPreviousDaysExpanded] = useState(false);
  // Which of this week's days are "previous" (before today), the first one
  // (where the "Previous days" header renders), and the total planned across
  // all of them (the collapsed row's count badge). A future week has none; a
  // past week's `firstKey` is just its first day.
  const previousDaysInfo = useMemo(() => {
    const previous = days.filter(d => dayKeyOf(d) < todayKey);
    return {
      firstKey: previous.length > 0 ? dayKeyOf(previous[0]) : null,
      count: previous.reduce((sum, d) => sum + entriesForDay(entries, dayKeyOf(d)).length, 0),
    };
  }, [days, entries, todayKey]);

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

  // The recipe whose ingredients we're offering to re-add after mark-cooked.
  // Carries the entry's picks alongside the recipe: you cooked the roast
  // potatoes, so the re-shop offers the roast potatoes' lines.
  //
  // This is the *banner's* subject, not the sheet's — marking something cooked
  // used to open RecipeToListSheet outright, which is what made a tick about
  // eating read as a question about shopping (see OfferBanner).
  // Session-only, and deliberately not persisted: it's an offer about a tap
  // you just made, so there is nothing for it to mean on the next launch.
  //
  // Screen state, where the used-up offer next to it is store state, and the
  // asymmetry is the point: buying is a meal-plan question with two other entry
  // points already, while what a cook consumed is the app's only signal of its
  // kind and has to be raised wherever the meal was ticked off — see
  // useMealPlanStore.cookedOffer.
  const [restockOffer, setRestockOffer] =
    useState<{ recipe: Recipe; choices: string[]; scale: number } | null>(null);
  const [restockSheetVisible, setRestockSheetVisible] = useState(false);
  const cookedOffer = useMealPlanStore(s => s.cookedOffer);

  // One count, used twice: whether to make the offer at all, and what the
  // banner says. Computed against the live catalog rather than snapshotted at
  // cook time, which is what retires the banner without needing a dismissal
  // stamp — adding the items takes the set to 0 and it renders nothing, the
  // same "hidden rather than hedged" call StartTripPrompt makes.
  const restockCountFor = useCallback(
    (recipe: Recipe, choices: readonly string[], scale: number) =>
      restockRows(
        classifyPlanned(
          plannedIngredientsForRecipe(recipe, recipesById, { chosen: choices }, scale, standingSwaps),
          groceryItems,
          new Date()
        )
      ).length,
    [recipesById, groceryItems, standingSwaps]
  );

  const restockCount = useMemo(
    () => (restockOffer
      ? restockCountFor(restockOffer.recipe, restockOffer.choices, restockOffer.scale)
      : 0),
    [restockOffer, restockCountFor]
  );

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

  // ——— Day drop zones ——————————————————————————————————————————————
  //
  // Registers each day's band as a drop target (see renderDay) and tracks
  // which one a finger is currently over. Originally served the add button's
  // own drag too; the button is gone (see the doc comment above), but a
  // container dragged out of the fridge still needs to know which day it's
  // over, so this stays as the one piece of hit-testing and the one set of
  // highlights.
  const dropZonesRef = useRef<FabDropZonesHandle>(null);
  const fabIntentChannel = useFabIntentChannel();
  // Lets a drag autoscroll the day list once the finger reaches either end —
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
   * What a release over the week means: the day from where down the list it
   * landed, the meal from where across that day's band it landed (slotAtX).
   *
   * A drop used to always mean dinner, on the grounds that a week plan is
   * mostly dinners and a one-gesture decision has nowhere to say otherwise. The
   * band had somewhere to say it all along — it is a full screen wide and only
   * ever asked one question of that width. The columns cost no layout and no
   * extra step: aim at the middle of Thursday and it is still dinner.
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
      slot: intent.slot,
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
    onMove: (page, translation) => {
      ghostX.setValue(translation.x);
      ghostY.setValue(translation.y);
      // `home` is always 'outside': with no corner to come back to, every
      // sample is out over the list, which is also the only state that
      // autoscrolls — and autoscroll is what puts Sunday within reach of a card
      // lifted from above Monday. Both axes go through: the x is what picks the
      // meal once a day band has been found.
      dropZonesRef.current?.moveTo(page.y, 'outside', page.x);
    },
    onEnd: page => {
      const leftover = draggedLeftoverRef.current;
      draggedLeftoverRef.current = null;
      setFridgeDragging(false);
      // The release carries its own x as well, rather than leaning on the last
      // move: a hold that lifts a row and releases without travelling never
      // moves at all, and a release resolved without one would silently mean
      // whichever meal the default is.
      const intent = dropZonesRef.current?.end(page.y, 'outside', page.x)
        ?? { kind: 'plain' as const };
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

  // A `dundundun://mealplan?date=…` link asking for one particular day — what
  // the weekly nudge's seven day-tasks carry, so tapping "Wednesday 19 Aug" on
  // Today lands on that day rather than on whichever week this screen was last
  // left showing.
  //
  // Stamped rather than watched for change, the same idiom TodayScreen's
  // `resetToToday` param uses: the day is the payload and the stamp is the
  // event, so tapping the same day twice still moves the screen. Split across
  // two effects because the two halves need different timing — the anchor has
  // to move before there is a row to scroll to.
  const focusDay: string | undefined = route.params?.focusDay;
  const focusStamp: number | undefined = route.params?.focusStamp;
  const pickSlot: MealSlot | undefined = route.params?.pickSlot;
  const [handledFocus, setHandledFocus] = useState<number | null>(null);
  const pendingFocusRef = useRef<string | null>(null);

  useEffect(() => {
    if (focusStamp === undefined || focusStamp === handledFocus || !focusDay) return;
    setHandledFocus(focusStamp);
    setAnchor(dayKeyToDate(focusDay));
    // A day the user folded away, on its own or as part of "Previous days",
    // is one the link would otherwise arrive at showing nothing. Opening it
    // is the whole point of naming a day.
    setCollapsedDays(prev => {
      if (!prev.has(focusDay)) return prev;
      const next = new Set(prev);
      next.delete(focusDay);
      return next;
    });
    if (focusDay < dayKeyOf(new Date())) setPreviousDaysExpanded(true);
    pendingFocusRef.current = focusDay;
    // The other half of an unanswered meal task's link: land on the day, then
    // open the picker on the slot it named. Set here rather than in its own
    // effect so it rides the same stamp — one navigation, one open.
    if (pickSlot) {
      setPlanningDay(focusDay);
      setPlanningSlot(pickSlot);
    }
  }, [focusDay, focusStamp, handledFocus, pickSlot]);

  // Runs after `days` has been rebuilt around the new anchor, which is what
  // makes the index findable — scrolling in the effect above would search the
  // week that was on screen when the link was tapped.
  // ==== effects ====
  useEffect(() => {
    const pending = pendingFocusRef.current;
    if (!pending) return;
    const index = days.findIndex(d => dayKeyOf(d) === pending);
    if (index === -1) return;
    pendingFocusRef.current = null;
    // viewPosition 0 puts the day at the top of the viewport rather than
    // wherever it happens to fall; the day's own contents are what was asked
    // for, and a day scrolled to the middle shows half of it.
    flatListRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true });
  }, [days]);

  const onThisWeek = isSameWeek(anchor, new Date(), { weekStartsOn });

  // `anchor` is set once at mount and this screen never unmounts
  // (enableScreens(false) parks a blurred tab rather than tearing it down —
  // see the ResourceSavingView note in CLAUDE.md), so left alone it goes
  // stale exactly the way an active trip does: leave the app parked here
  // over a weekend and it's still showing last week when you come back.
  //
  // Only resets a week that's fallen into the *past* — never a future one,
  // so paging ahead on purpose and glancing away for a moment doesn't get
  // silently undone. A week that's already current needs nothing. Mirrors
  // GroceryScreen's checkTripExpiry: a memo whose inputs haven't changed
  // won't re-render itself away, so this has to be an effect, not a value.
  useFocusEffect(
    useCallback(() => {
      const thisWeekStart = buildWeekDays(new Date(), weekStartsOn)[0];
      if (isBefore(days[0], thisWeekStart)) {
        setAnchor(new Date());
        setCollapsedDays(new Set());
        setPreviousDaysExpanded(false);
      }
      // days[0] alone decides this — weekStartsOn only changes which day a
      // week starts on, not whether the anchor's week is in the past.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [days])
  );

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

  // ==== acting on the plan: prep tasks, the list, moves and replacements ====
  /**
   * Opens the review sheet on a range of the week. `useCallback` because the
   * day renderer holds it — see renderDay's deps.
   */
  const openAddToList = useCallback(
    (scope: { range: { startKey: string; endKey: string }; title: string; stampWeekKey: string | null }) => {
      haptics.tap();
      setAddToListScope(scope);
      setAddToListVisible(true);
    },
    []
  );

  /**
   * The day scope, named once — both surfaces that offer it (a day header in
   * the list, a night row in the week lens) shop the same range under the same
   * title, so neither gets to word it differently.
   */
  const openDayAddToList = useCallback(
    (dayKey: string) => openAddToList({
      range: { startKey: dayKey, endKey: dayKey },
      title: `Add ${format(dayKeyToDate(dayKey), 'EEEE')} to list`,
      stampWeekKey: null,
    }),
    [openAddToList]
  );

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

    // Asked once, the first time this recipe is ever marked cooked — before
    // is the pre-bump snapshot, so cookCount === 0 there is exactly "never
    // cooked until this tap". Skipped if a vote is already set (from the
    // edit page, or a previous prompt on a recipe with older cook history
    // than this app's own tracking, e.g. a restored backup).
    if (recipe && before && before.cookCount === 0 && recipe.vote === null) {
      Alert.alert(
        'How was it?',
        `Rate "${recipe.name}" so it's easy to find, or skip, next time.`,
        [
          { text: 'Skip', style: 'cancel' },
          { text: 'Not for me', onPress: () => setRecipeVote(recipe.id, 'down') },
          { text: 'Loved it', onPress: () => setRecipeVote(recipe.id, 'up') },
        ]
      );
    }

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

    // Stored for any cooked recipe, and *not* gated on the count being above
    // zero right now — the banner renders nothing at 0 either way (see
    // `restockCount`), and a cook whose ingredients are all in the pantry is
    // exactly the one whose restock set is about to be created: saying you're
    // out of the soy sauce in the used-up sheet moves it into `restockRows`,
    // and with the offer already standing by, the buy follows from the
    // consumption answer instead of having to be asked for.
    //
    // What the offer must still never be is "every line of the recipe" —
    // restockRows is what it can defend, since on a dish cooked for the first
    // time every line looks unbought, which is how this arrived asking to buy
    // the salt and pepper. See its note, and OfferBanner's.
    if (!recipe || !restockOfferEnabled) return;
    setRestockOffer({ recipe, choices: entry.recipeChoices, scale: entry.recipeScale });
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
    confirmDelete({
      title: `Remove ${count} ${plural}?`,
      message: `You're about to take ${count} ${plural} off the plan. This can't be undone.`,
      confirmLabel: 'Remove',
      onConfirm: () => {
        animateLayout();
        bulkDeleteEntries(selectedIdList);
        exitSelection();
      },
    });
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
      // What the dish itself says it keeps for, so the usual log is still one
      // tap for a recipe that lasts a week rather than a stepper to correct
      // every time. A free-text meal has no recipe to ask and falls back.
      keepDays: leftoverKeepDaysFor(recipe),
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

  // ==== day and row renderers ====
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
    const isPrevious = key < todayKey;
    const isFirstPrevious = isPrevious && previousDaysInfo.firstKey === key;
    // Whether this day has anything a shop could find — the same gate the
    // week's own pill is behind, read over one day instead of seven.
    const shoppable = hasShoppableMeals(dayEntries, recipesById, { startKey: key, endKey: key });
    // Folded into the "Previous days" header rendered by the first previous
    // day below — every other previous day renders nothing of its own while
    // that section is collapsed.
    if (isPrevious && !isFirstPrevious && !previousDaysExpanded) return null;
    return (
      <FabDropZone zone={zone}>
        <DayDropTargetRow channel={fabIntentChannel} dayKey={key}>
          <View style={[styles.section, compact && styles.sectionCompact]}>
            {/*
              One toggle for the whole run of already-happened days, sitting
              above the first of them — see previousDaysExpanded. Replaces
              what used to be each past day starting individually collapsed,
              which read as a repeated stutter of headers on a week (or a
              whole past week) with nothing left to plan.
            */}
            {isFirstPrevious && (
              /*
                A label with a rule running off it, rather than the day header
                shape used below. This one heads a *run* of days, and given the
                same uppercase-label-and-chevron treatment as its own children
                it read as a fourth day between Saturday and Sunday. The rule
                is the cheapest thing that says "group boundary" without
                inventing a text size the app doesn't otherwise use, and it
                carries neither of the two things every day header has (a date
                and an add button), which is the other half of the difference.
              */
              <TouchableOpacity
                style={styles.previousHeader}
                onPress={() => {
                  haptics.tap();
                  animateLayout();
                  setPreviousDaysExpanded(e => !e);
                }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel={`${previousDaysExpanded ? 'Collapse' : 'Expand'} previous days`}
                accessibilityState={{ expanded: previousDaysExpanded }}
              >
                <Text style={styles.dayName}>Previous days</Text>
                {!previousDaysExpanded && previousDaysInfo.count > 0 && (
                  <Text style={styles.dayCount}>({previousDaysInfo.count})</Text>
                )}
                <Ionicons
                  name={previousDaysExpanded ? 'chevron-down' : 'chevron-forward'}
                  size={iconSize.xs}
                  color={colors.textTertiary}
                />
                <View style={styles.previousRule} />
              </TouchableOpacity>
            )}
            {(!isPrevious || previousDaysExpanded) && (
              <>
                {/*
                  Every day carries its own add button, in its header rather than
                  under its meals. The header is a row that exists whether or not
                  the day has anything in it, so the button costs no vertical
                  space and sits in the same place on every day — which is what
                  lets an empty day stay one line tall (#1374) while still being
                  directly plannable.

                  A sibling of the collapse toggle rather than a child of it: two
                  nested touchables resolve fine, but "the whole header collapses
                  except this corner of it" is a rule worth expressing in the tree
                  rather than relying on hit resolution.
                */}
                <View style={styles.dayHeaderRow}>
                  <TouchableOpacity
                    style={styles.dayHeader}
                    onPress={() => toggleDayCollapse(key)}
                    activeOpacity={interaction.activeOpacity}
                    accessibilityRole="button"
                    accessibilityLabel={`${collapsed ? 'Expand' : 'Collapse'} ${dayLabel}`}
                    accessibilityState={{ expanded: !collapsed }}
                  >
                    <Text style={[styles.dayName, today && styles.dayNameToday]}>
                      {weekdayName}
                    </Text>
                    {/* Beside the name rather than pushed to the far edge of
                        the row. Split apart, the day and its date read as two
                        unrelated things with a gap between them, and the date
                        sat directly against the add button — the one part of
                        the row that is a target. */}
                    <Text style={styles.dayDate}>{today ? 'Today' : format(day, 'd MMM')}</Text>
                    {collapsed && dayEntries.length > 0 && (
                      <Text style={styles.dayCount}>({dayEntries.length})</Text>
                    )}
                    <Ionicons
                      name={collapsed ? 'chevron-forward' : 'chevron-down'}
                      size={iconSize.xs}
                      color={colors.textTertiary}
                    />
                  </TouchableOpacity>
                  {/*
                    Shops this day and nothing else, sitting beside the day's
                    own + rather than under its meals: the header is the row
                    that exists whether or not the day has anything in it, so
                    a second button there costs no vertical space on a week
                    that already fights for it (#1374).

                    Only rendered when the day has something to shop, the same
                    restraint "Add week to list" takes — an always-present cart
                    that opens on "Nothing to add" is a button that lies. Grey
                    and a size down from the +, because planning a meal is
                    still the thing you came to a day header to do.
                  */}
                  {!selectionMode && (
                    /*
                      Both trailing buttons in one group, spaced `md` rather
                      than the row's own `sm`. Two 20-24pt glyphs need their
                      hitSlop to reach a thumb-sized target, and at an 8pt gap
                      those targets overlap — where the + wins, being the later
                      sibling, and the cart's trailing half quietly opens the
                      meal picker instead. 16pt is exactly the two 8pt slops
                      meeting, with nothing shared.
                    */
                    <View style={styles.dayActions}>
                      {shoppable && (
                        <TouchableOpacity
                          style={styles.dayAdd}
                          onPress={() => openDayAddToList(key)}
                          activeOpacity={interaction.activeOpacity}
                          hitSlop={{ top: 10, bottom: 10, left: 10, right: 8 }}
                          accessibilityRole="button"
                          accessibilityLabel={`Add ${dayLabel}'s ingredients to the grocery list`}
                        >
                          <Ionicons name="cart-outline" size={iconSize.md} color={colors.textSecondary} />
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.dayAdd}
                        onPress={() => { haptics.tap(); setPlanningDay(key); }}
                        activeOpacity={interaction.activeOpacity}
                        hitSlop={{ top: 10, bottom: 10, left: 8, right: 10 }}
                        accessibilityRole="button"
                        accessibilityLabel={`Plan a meal on ${dayLabel}`}
                      >
                        <Ionicons name="add-circle" size={iconSize.lg} color={colors.accent} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>

                {/*
                  An empty day is its header and the band under it, and nothing
                  else. It used to carry "No meals planned yet" — plain status
                  text since #1092 took the per-day add button away — which cost
                  about 22pt a day for a sentence repeated up to seven times down
                  one screen, and on a normal week (three or four dinners planned)
                  that was most of what pushed the weekend below the fold (#1374).
                  The band stays the size it is because it is also the drop
                  target for a container dragged out of the fridge, and the
                  week-level hint above says the thing the seven copies were each
                  saying badly.
                */}
                {!collapsed && dayEntries.length > 0 && (
                  (
                    <View style={styles.card}>
                      {dayEntries.map((entry, idx) => (
                        <React.Fragment key={entry.id}>
                          {idx > 0 && (
                            <View style={[styles.sep, compact && styles.sepCompact]} />
                          )}
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
                            onSwipeSelect={id => enterSelectionMode(id)}
                            // Matches styles.card, so the swipe panel is uncovered
                            // by the row rather than showing through it.
                            surface={colors.bgSecondary}
                            compact={compact}
                          />
                        </React.Fragment>
                      ))}
                    </View>
                  )
                )}
              </>
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
  }, [entries, recipesById, styles, collapsedDays, colors, compact, fabIntentChannel, selectionMode, selectedIds, toggleSelection, enterSelectionMode, leftovers, describeEntryChoices, todayKey, previousDaysInfo, previousDaysExpanded, openDayAddToList]);

  // Cheap enough to compute on every render: whether there's anything an "Add
  // week to list" could possibly find, without running the full ingredient
  // collection just to light up a header icon. Shares one rule with the day
  // headers' cart button and with the sheet both open — including that a meal
  // already marked cooked counts for nothing, which this used to miss: a week
  // whose meals were all ticked off still offered the pill, and the sheet it
  // opened said "Nothing to add".
  const hasPlannableEntries = range
    ? hasShoppableMeals(entries, recipesById, range)
    : false;

  // Counted over the whole component tree, so a dish whose only prep steps
  // live on one of its parts still offers the action.
  const selectedRecipe = selected?.recipeId ? recipesById.get(selected.recipeId) : undefined;
  const selectedResolution = { chosen: selected?.recipeChoices ?? [] };
  const selectedPrepTaskCount = selectedRecipe
    ? flattenRecipePrepTasks(selectedRecipe, recipesById, selectedResolution).length
    : 0;

  // Read from the task list rather than from `selected.cookTask`, because the
  // flag's third state (null, "the setting decides") doesn't answer the
  // question the row is asking — whether a task exists right now. Keyed by the
  // meal's day and slot now rather than by the meal, since that's what a meal
  // task points at (see mealSlotTasks.ts).
  const selectedHasCookTask = useTaskStore(
    s => !!selected
      && !!liveGeneratedTask(s.tasks, 'mealSlot', mealSlotSourceId(selected.date, selected.slot))
  );

  // The either/or slots this meal has to answer, read under its own current
  // answers — so a choice nested inside the chosen option appears and one
  // inside the option it replaced doesn't.
  const selectedChoiceGroups = selectedRecipe
    ? recipeChoiceGroups(selectedRecipe, recipesById, selectedResolution)
    : [];

  // The week as the deciding lens reads it: what's on each day, which nights
  // have no dinner, and which of those have already gone past.
  const nights = useMemo(
    () => weekNights(entries, days, dayKeyOf(new Date())),
    [entries, days]
  );

  // The nights this week still has room for. Both the gate on the shelf below
  // and the days it may plan onto — see decidableNights for why those have to
  // be the same answer.
  //
  // **A night that has already passed is not one of them.** It used to be a
  // bare `daysWithoutMeal` over the whole week, so a suggestion accepted on a
  // Thursday landed on Monday — the sheet fills the days it's given in order,
  // without consulting the plan. Recording a meal you ate on Monday is a real
  // thing to want and is exactly what the day list's own + button is for; a
  // shelf offering to *plan* one is just wrong about which way time runs.
  const openDinnerDays = useMemo(() => decidableNights(nights), [nights]);

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
    () => suggestRecipesForEmptyNight(suggestableRecipes, groceryItems, new Date(), 5, itemSubs),
    [suggestableRecipes, groceryItems, itemSubs]
  );

  // Recipes made often and made recently — the comfort-food half of the
  // sheet, opposite in intent to the pantry ranking above (that one rewards
  // catalog coverage nudged *down* for a recent cook, this one rewards the
  // cook itself). Used to be its own "Cook again" shelf on the Recipes
  // screen; folded in here instead of duplicated, since planning a night is
  // exactly what this sheet is already for. Deduped against `mealSuggestions`
  // so a recipe that qualifies for both doesn't show up as two rows.
  const cookAgainSuggestions = useMemo(() => {
    const alreadyRanked = new Set(mealSuggestions.map(r => r.id));
    return rankRecipeSuggestions(suggestableRecipes, new Date()).filter(r => !alreadyRanked.has(r.id));
  }, [suggestableRecipes, mealSuggestions]);

  // The visible half of #1103's pantry signal — computed only for the
  // recipes actually on the suggestions shelf, same "just the visible list"
  // scoping RecipesScreen's pantryCounts uses, not the whole library.
  const suggestionPantryCoverage = useMemo(() => {
    const byId = recipeMap(recipes);
    const map = new Map<string, PantryCoverage>();
    for (const recipe of mealSuggestions) {
      map.set(recipe.id, pantryCoverageForRecipe(recipe, groceryItems, new Date(), byId, itemSubs));
    }
    return map;
  }, [mealSuggestions, recipes, groceryItems, itemSubs]);

  // What the fridge can fill a night with, for the same sheet. Live containers
  // minus the ones this week already points at — the rule and its reasons live
  // in suggestableLeftovers, so the sheet gets a list it can render in order
  // rather than a fridge it has to think about.
  const fridgeSuggestions = useMemo(
    () => suggestableLeftovers(
      leftovers,
      entries.map(e => e.leftoverId).filter((id): id is string => !!id),
    ),
    [leftovers, entries],
  );

  // Offered whenever there's a night to fill and something to fill it with —
  // a ranked recipe, or a key for the generation half to invent one (#1063).
  //
  // The gate used to demand a *completely* empty week, which hid the shelf for
  // the whole of the job it exists for: someone who has planned Monday and
  // wants help with the other six nights is exactly the person asking. A week
  // with every dinner spoken for still offers nothing, since there is nowhere
  // for an acceptance to land.
  const canSuggestMeals = openDinnerDays.length > 0
    && (mealSuggestions.length > 0 || cookAgainSuggestions.length > 0
      || fridgeSuggestions.length > 0 || !!anthropicApiKey);

  // Context for the AI half of that sheet (#1063), so an invented idea isn't
  // something already on the week or something cooked last Tuesday. Both are
  // cheap and only read when the sheet is open.
  const plannedMealTitles = useMemo(() => entries.map(e => e.title).filter(Boolean), [entries]);
  const recentMealTitles = useMemo(() => recentlyCookedTitles(recipes, new Date()), [recipes]);
  // Same "close to going bad" set the Kitchen screen's own use-up shelf reads
  // (useUpEntries), handed to the AI generator as inspiration — never a
  // requirement, see suggestMealIdeas' own doc. Doesn't touch the offline
  // ranking above, which already answers "what can I make from the catalog"
  // on its own terms.
  const expiringMealHints = useMemo(
    () => expiringItemHints(useUpEntries(kitchenInventory(groceryItems, leftovers, new Date()))),
    [groceryItems, leftovers]
  );

  /**
   * A container accepted from the suggestion sheet — the same
   * planMeal({ leftoverId, title }) write the fridge card's plan action and its
   * drag onto the week make, down to the captured title.
   *
   * Dinner, because that is what the sheet's nights *are*: `decidableNights`
   * reads the dinner slot, so there's no other slot a pick from it could mean.
   * A drag is where a container lands on some other slot, since it has a target
   * under the finger to say which one (see planLeftoverOnDrop).
   *
   * No prep-task offer: a leftover has no recipe behind it to have any.
   */
  const planLeftoverSuggestion = (leftover: Leftover, dateKey: string) => {
    animateLayout();
    planMeal({
      date: dateKey,
      slot: 'dinner',
      leftoverId: leftover.id,
      title: mealTitleForLeftover(leftover),
    });
  };

  const planSuggestion = (recipe: Recipe, dateKey: string) => {
    animateLayout();
    const entry = planMeal({ date: dateKey, slot: 'dinner', recipeId: recipe.id, title: recipe.name });
    if (entry) offerPrepTasks(entry);
  };

  // Empty for a week with nothing planned, which is what the header action's
  // disabled state gates on — see buildWeekPlanShareText.
  const weekShareText = useMemo(
    () => buildWeekPlanShareText(days, entries, recipesById),
    [days, entries, recipesById]
  );
  // Copied as it is shared, day headings and all: unlike a list of
  // ingredients or groceries, nothing is waiting to parse this — it goes in a
  // note or a message, where the headings are what make it readable.
  const { copied: copiedWeek, copy: copyWeekText } = useCopyToClipboard();

  const handleShareWeek = useCallback(() => {
    if (!weekShareText) return;
    haptics.tap();
    Share.share({ message: weekShareText }).catch(() => {});
  }, [weekShareText]);

  const headerActions = useMemo<ScreenHeaderAction[]>(() => {
    // No week chevrons here: paging the week is PeriodNav's job, in its own
    // row under the header (see the render). What's left is the three things
    // you do *to* the week on screen rather than to pick which week that is.
    const actions: ScreenHeaderAction[] = [
      {
        icon: copiedWeek ? 'checkmark' : 'copy-outline',
        onPress: () => copyWeekText(weekShareText),
        disabled: !weekShareText,
        accessibilityLabel: 'Copy this week’s meals as plain text',
      },
      {
        icon: 'share-outline',
        onPress: handleShareWeek,
        disabled: !weekShareText,
        accessibilityLabel: 'Share this week’s meals',
      },
    ];
    // Only offered once there's somewhere to come back from, so the header
    // isn't carrying a permanently inert button.
    if (!onThisWeek) {
      actions.push({
        icon: 'today-outline',
        onPress: () => {
          haptics.tap();
          if (selectionMode) exitSelection();
          animateLayout();
          setAnchor(new Date());
          setCollapsedDays(new Set());
          setPreviousDaysExpanded(false);
        },
        accessibilityLabel: 'Back to this week',
      });
    }
    return actions;
  }, [onThisWeek, selectionMode, page, exitSelection, weekStartsOn, handleShareWeek, weekShareText, copiedWeek, copyWeekText]);

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
  // Null while too little of the week is priced to say (see recipeCost.ts's
  // coverage floor) — the common case for a library that's only lightly
  // priced, same as a fresh install answering nothing at all.
  const weekCost = useMemo(
    () => (range ? estimateWeekCost(entries, recipesById, groceryItems, range, standingSwaps) : null),
    [entries, recipesById, groceryItems, range, standingSwaps]
  );
  const subtitle = [
    describeWeekPlan(entries),
    describeWeekCost(weekCost, currencySymbol, new Date()),
    addedStamp ? describeAddedToList(addedStamp, new Date(), weekStartsOn) : null,
  ].filter(Boolean).join(' · ');

  // ==== render. Everything below is JSX ====
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* No overline: the week range is PeriodNav's label below, and naming it
          twice on the same screen is what a caption above the title becomes
          once the arrows that move it are no longer beside the title. */}
      <ScreenHeader
        title="Meal plan"
        subtitle={subtitle}
        actions={headerActions}
      />
      <GroceriesHubPills active="MealPlan" />
      {!selectionMode && !!activeTripShop && (
        <ActiveTripBanner
          shopName={activeTripShop.name}
          onChange={() => resetToGroceries()}
          onFinish={() => resetToGroceries(true)}
          onClear={handleClearTrip}
        />
      )}

      {/*
        Widest scope first: the hub pills above pick a section, this picks the
        week, the track below picks how densely that week is drawn. Under the
        trip banner rather than over it, so the two week controls stay adjacent
        when a trip is running.
      */}
      <PeriodNav
        label={describeWeekRange(days)}
        onPrev={() => page(-1)}
        onNext={() => page(1)}
        prevAccessibilityLabel="Previous week"
        nextAccessibilityLabel="Next week"
      />

      {/*
        A track, not a second row of pills. The hub's own pills sit a couple of
        rows above and *navigate*; this one only changes how the week below it
        is drawn, and two rows of the same accent-filled pill would read as one
        confused eight-item row. A `SegmentedControl` is what the app reaches
        for to pick one of a small closed set, and `surface="page"` is what
        finally lets it sit straight on the page in the light theme.

        It used to switch between this list and a "Whole week" lens (#1669),
        which was a second, read-only drawing of the same week: its nights card
        is what compact density now does to the list itself, and the two
        shortcuts it carried past that — the week's shopping and a shelf of
        suggestions — are the buttons already sitting above the first day.
      */}
      <View style={styles.densityRow}>
        <SegmentedControl
          options={[
            { value: false as const, label: 'Comfortable' },
            { value: true as const, label: 'Compact' },
          ]}
          value={compact}
          onChange={setDensity}
          surface="page"
          label="Meal plan density"
        />
      </View>

      {/* Both post-cook offers are siblings of the list rather than part of its
          header, like ActiveTripBanner and unlike the cards inside
          ListHeaderComponent: the tap they answer can happen on any day of the
          week, so an offer that scrolls with the week is one you can miss
          entirely. Hidden while selecting, for the reason the list header gives
          — nothing that opens a sheet belongs over an in-progress selection. */}
      {!selectionMode && <CookedUseUpOffer />}

      {/* Ranked behind the used-up offer, never stacked with it: what a cook
          used up is the question only this moment can answer, while the shop is
          reachable from the recipe whenever you want it. Answering or
          dismissing that one clears `cookedOffer`, and this appears — by then
          counting whatever was just marked out, since restockCount reads the
          live catalog. */}
      {restockOffer && restockCount > 0 && !cookedOffer && !selectionMode && (
        <OfferBanner
          lead={`${restockCount} ingredient${restockCount === 1 ? '' : 's'}`}
          rest={`from ${restockOffer.recipe.name} aren't on your list`}
          actionLabel="Review"
          onAction={() => setRestockSheetVisible(true)}
          onDismiss={() => setRestockOffer(null)}
          accessibilityLabel={
            `${restockCount} ingredient${restockCount === 1 ? '' : 's'} from ` +
            `${restockOffer.recipe.name} are not on your shopping list`
          }
          actionAccessibilityLabel={`Review ingredients from ${restockOffer.recipe.name} to add to your shopping list`}
          dismissAccessibilityLabel="Dismiss restock notice"
        />
      )}

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
          // The user can't scroll during a fridge-row drag (its responder has
          // the touch); the drag scrolls it instead, through the control
          // wired up above — that responder is a *descendant* of this list,
          // so the native scroll would otherwise take the touch on the first
          // finger move (same reason SortableList's callers switch it off).
          scrollEnabled={!fridgeDragging}
          onScroll={e => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          onLayout={e => { viewportHeightRef.current = e.nativeEvent.layout.height; }}
          onContentSizeChange={(_w, h) => { contentHeightRef.current = h; }}
          // The focus-a-day effect above calls scrollToIndex, which throws
          // rather than no-ops when the row hasn't been laid out yet — a cold
          // start straight onto a `?date=` link, where the list mounts and the
          // effect fires in the same frame. Seven rows are inside
          // initialNumToRender, so this is the layout race and not a
          // virtualisation miss: one frame later the row exists. Deliberately
          // not adding getItemLayout to avoid it — the days are different
          // heights (a day with four meals against an empty one), so a fixed
          // length would land every scroll somewhere approximate.
          onScrollToIndexFailed={({ index }) => {
            requestAnimationFrame(() => {
              flatListRef.current?.scrollToIndex({ index, viewPosition: 0, animated: true });
            });
          }}
          // Hidden while selecting: both are shortcuts off the week (into the
          // leftover sheet, into the suggestion sheet) and opening one out
          // from under an in-progress selection would lose it — same restraint
          // RecipesScreen's own list header takes with its "Cook again" shelf.
          ListHeaderComponent={
            selectionMode ? null : (
              <>
                {/* First on the page, above today as well as the week: the
                    fridge is what should be eaten before anything new is
                    planned, so it's read before today's meals rather than
                    after them. It renders nothing at all when empty (see
                    LeftoversCard), so an empty fridge still opens on today. */}
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
                  headers.
                */}
                {entries.length === 0 && (
                  <Text style={styles.emptyWeekHint}>
                    {copySourceKey
                      ? 'Nothing planned this week. Copy the week below, or tap + on any day.'
                      : 'Nothing planned this week. Tap + on any day to plan a meal.'}
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
                        onPress={() => range && openAddToList({
                          range,
                          title: 'Add week to list',
                          stampWeekKey: range.startKey,
                        })}
                        accessibilityLabel="Add this week's ingredients to the grocery list"
                      />
                    )}
                    {canSuggestMeals && (
                      <InlineAction
                        label="Suggest meals"
                        icon="restaurant-outline"
                        variant="neutral"
                        surface="page"
                        onPress={() => {
                          haptics.tap();
                          setSuggesting({
                            recipes: mealSuggestions,
                            cookAgainRecipes: cookAgainSuggestions,
                            leftovers: fridgeSuggestions,
                            days: openDinnerDays,
                          });
                        }}
                        accessibilityLabel="Suggest meals from your recipe box and grocery catalog"
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
                  : tabBarHeight + spacing.xl,
              }}
            />
          }
        />
      </FabDropZoneProvider>

      {/*
        The container in flight, over everything else on the screen. Always
        mounted so it can measure its own origin before a drag needs it (see
        dragLayerTopRef), and inert: the finger is being tracked by the fridge
        card's responder, and a layer that could take a touch would end the
        drag it exists to draw.
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
        // otherwise — and a meal task's link *has* said, which is what
        // planningSlot carries.
        defaultSlot="dinner"
        forceSlot={planningSlot}
        onPick={pick}
        onClose={() => {
          setPlanningDay(null);
          setPlanningSlot(null);
        }}
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
        onAddToList={
          selectedRecipe
            ? () => {
                setMealShop({
                  recipe: selectedRecipe,
                  choices: selected?.recipeChoices ?? [],
                  scale: selected?.recipeScale ?? 1,
                });
                setMealShopVisible(true);
              }
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
        // Absent once the meal is cooked: its task has already been ticked (or
        // deliberately left), and either way scheduling the past is nonsense.
        onSetCookTask={
          selected && !selected.cookedAt
            ? want => setCookTask(selected.id, want)
            : undefined
        }
        hasCookTask={!!selected && selectedHasCookTask}
        onClose={() => setSelectedId(null)}
      />

      {addToListScope && (
        <AddMealsToListSheet
          visible={addToListVisible}
          entries={entries}
          recipesById={recipesById}
          range={addToListScope.range}
          title={addToListScope.title}
          stampWeekKey={addToListScope.stampWeekKey}
          onClose={() => setAddToListVisible(false)}
        />
      )}

      <SuggestMealsSheet
        visible={suggesting !== null}
        recipes={suggesting?.recipes ?? []}
        cookAgainRecipes={suggesting?.cookAgainRecipes ?? []}
        leftovers={suggesting?.leftovers ?? []}
        pantryByRecipeId={suggestionPantryCoverage}
        openDays={suggesting?.days ?? []}
        aiIdeasEnabled={!!anthropicApiKey}
        plannedTitles={plannedMealTitles}
        recentTitles={recentMealTitles}
        expiringItemHints={expiringMealHints}
        slotsToFill={suggesting?.days.length ?? 0}
        onPlan={planSuggestion}
        onPlanLeftover={planLeftoverSuggestion}
        onClose={() => setSuggesting(null)}
      />

      {/*
        One meal's shop, asked for from its own sheet. `initialSelection` is
        the default "all": the user named the action, so every line they still
        need starts ticked — where the restock offer below has to stay inside
        what its banner counted.
      */}
      <RecipeToListSheet
        visible={mealShopVisible}
        recipe={mealShop?.recipe ?? null}
        recipesById={recipesById}
        initialChoices={mealShop?.choices}
        initialScale={mealShop?.scale}
        onClose={() => setMealShopVisible(false)}
      />

      {/* Ticks stay scoped to what the banner claimed — see initialSelection. */}
      <RecipeToListSheet
        visible={restockSheetVisible}
        recipe={restockOffer?.recipe ?? null}
        recipesById={recipesById}
        initialChoices={restockOffer?.choices}
        initialScale={restockOffer?.scale}
        initialSelection="restock"
        onClose={() => setRestockSheetVisible(false)}
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
        recipe and therefore no prep steps to offer. The title is captured at
        plan time exactly as the picker's own leftover path does — see
        mealTitleForLeftover.
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
          frozen: pick.frozen,
          recipeId: pick.recipeId,
          sourceEntryId: loggingLeftover?.sourceEntryId ?? null,
        }))}
        onRename={title => editingLeftover && renameLeftover(editingLeftover.id, title)}
        onSetStoredAt={storedAt => editingLeftover && setLeftoverStoredAt(editingLeftover.id, storedAt)}
        onSetKeepDays={days => editingLeftover && setLeftoverKeepDays(editingLeftover.id, days)}
        onFinish={outcome => editingLeftover && finishLeftover(editingLeftover.id, outcome)}
        onSetFrozen={frozen => editingLeftover && setLeftoverFrozen(editingLeftover.id, frozen)}
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
    paddingTop: spacing.md,
  },
  section: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  // The other half of compact density, and the half that shows on an empty
  // day: a week where four nights are unplanned is mostly the gaps between
  // its headers, so the gap closes with the rows.
  sectionCompact: {
    paddingBottom: spacing.sm,
  },
  dayHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  // Name, date and chevron in one group at the leading edge; the trailing
  // edge carries the day's buttons (see dayActions) and nothing else.
  dayHeader: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  dayActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  dayAdd: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  previousHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  previousRule: {
    flex: 1,
    height: border.hairline,
    backgroundColor: colors.separator,
    marginLeft: spacing.xs,
  },
  // Uppercase section-header treatment, matching every other list section
  // header in the app.
  dayName: {
    color: colors.textSecondary,
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
  densityRow: { paddingHorizontal: spacing.md, paddingTop: spacing.xs, paddingBottom: spacing.sm },
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
  // Inset to where the compact row's own content starts — past the 24pt icon
  // rather than past the 32pt one, and not past the slot column, which is a
  // label on the row rather than a gutter beside it.
  sepCompact: {
    marginLeft: spacing.md + 24 + spacing.sm,
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
    // A block's worth of gap under it, not half of one: the first day header
    // has no top margin of its own, so spacing.sm left the week jammed up
    // against a row of buttons that isn't part of it.
    marginBottom: spacing.md,
  },
});
