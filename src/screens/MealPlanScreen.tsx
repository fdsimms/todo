import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Alert, TouchableOpacity } from 'react-native';
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
import { PrepTasksReviewSheet } from '../components/PrepTasksReviewSheet';
import { SuggestMealsSheet } from '../components/SuggestMealsSheet';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { LeftoversCard } from '../components/LeftoversCard';
import { LeftoverSheet, type LeftoverSeed } from '../components/LeftoverSheet';
import { isLiveLeftover } from '../utils/leftovers';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, border, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { buildWeekDays } from '../utils/calendarGrid';
import { dayKeyOf, dayKeyToDate } from '../utils/dateUtils';
import { resolvePrepTaskDraft, suggestRecipesForEmptyNight } from '../utils/recipeUtils';
import { flattenRecipeIngredients, flattenRecipePrepTasks, type FlatPrepTask } from '../utils/recipeComponents';
import {
  dayKeyRange,
  describeAddedToList,
  describeWeekPlan,
  describeWeekRange,
  entriesForDay,
  recipeIndex,
  titleForEntry,
} from '../utils/mealPlan';

/**
 * The week plan.
 *
 * **Seven vertical day sections, not a horizontal week strip.** At 390pt a
 * 7-column strip gives each day about 52pt, which cannot hold "Sausage &
 * fennel ragù" — a strip is a date-*picker* affordance, and every cell here
 * carries content. Content under a day already has a settled treatment in this
 * app and it's vertical.
 *
 * **No drag in this increment.** Moving a meal is a row action opening a
 * compact 7-day chip row (see MealEntrySheet); cross-section drag has needed
 * bespoke math twice here and the one built for Today's category headers never
 * lined up with the finger and was deleted along with its helpers.
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
  const addedToListAt = useMealPlanStore(useShallow(s => s.addedToListAt));

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

  const toggleDayCollapse = (key: string) => {
    haptics.tap();
    animateLayout();
    setCollapsedDays(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  // The recipe whose ingredients we're offering to re-add after mark-cooked —
  // null closes RecipeToListSheet, same on/off pattern as `addingToList`.
  const [cookedRecipeForList, setCookedRecipeForList] = useState<Recipe | null>(null);

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

  const page = (delta: number) => {
    haptics.tap();
    setAnchor(a => addWeeks(a, delta));
  };

  // The sheet itself decides when to close (its own "Done" button, backdrop
  // tap, swipe) — a pick here just writes the meal and stays open, ready for
  // the next slot on the same day. See RecipePickerSheet.pick.
  const pick = (pickResult: MealPick) => {
    if (!planningDay) return;
    animateLayout();
    planMeal({
      date: planningDay,
      slot: pickResult.slot,
      recipeId: pickResult.recipeId,
      leftoverId: pickResult.leftoverId,
      title: pickResult.title,
    });
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
    if (!recipe || flattenRecipeIngredients(recipe, recipesById).length === 0) return;
    setCookedRecipeForList(recipe);
  };

  /**
   * Opens the log sheet prefilled from a planned meal — the entry point the
   * leftovers tracker is mostly reached through, since a container in the
   * fridge nearly always started as something on the plan.
   *
   * Deliberately an action on the entry rather than something mark-cooked does
   * by itself: not every meal leaves any, and a sheet that opened uninvited
   * after every cooking would be a second modal chasing the ingredient one.
   */
  const logLeftoversFor = (entry: MealPlanEntry) => {
    setSelectedId(null);
    setLoggingLeftover({
      title: titleForEntry(entry, recipesById),
      recipeId: entry.recipeId,
      sourceEntryId: entry.id,
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
    const dayLabel = format(day, 'EEEE d MMMM');

    return (
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
              {format(day, 'EEEE')}
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
          <>
            {dayEntries.length > 0 && (
              <View style={styles.card}>
                {dayEntries.map((entry, idx) => (
                  <React.Fragment key={entry.id}>
                    {idx > 0 && <View style={styles.sep} />}
                    <MealSlotRow
                      entry={entry}
                      title={titleForEntry(entry, recipesById)}
                      hasRecipe={!!entry.recipeId && recipesById.has(entry.recipeId)}
                      // The rows are already sorted by slot, so "the slot changed"
                      // is the run header — captioning both halves of a two-dish
                      // dinner "DINNER" says it twice.
                      showSlot={idx === 0 || dayEntries[idx - 1].slot !== entry.slot}
                      onPress={() => { haptics.tap(); setSelectedId(entry.id); }}
                      onMarkCooked={entry.cookedAt ? undefined : () => markCooked(entry)}
                    />
                  </React.Fragment>
                ))}
              </View>
            )}

            <InlineAction
              label={dayEntries.length > 0 ? 'Add' : 'Add a meal'}
              icon="add"
              variant={dayEntries.length > 0 ? 'neutral' : 'accent'}
              onPress={() => { haptics.tap(); setPlanningDay(key); }}
              accessibilityLabel={`Plan a meal for ${dayLabel}`}
              style={styles.add}
            />
          </>
        )}
      </View>
    );
  }, [entries, recipesById, styles, collapsedDays, colors]);

  // Cheap enough to compute on every render: whether there's anything an "Add
  // week to list" could possibly find, without running the full ingredient
  // collection just to light up a header icon.
  const hasPlannableEntries = entries.some(e => e.recipeId && recipesById.has(e.recipeId));

  // Counted over the whole component tree, so a dish whose only prep steps
  // live on one of its parts still offers the action.
  const selectedRecipe = selected?.recipeId ? recipesById.get(selected.recipeId) : undefined;
  const selectedPrepTaskCount = selectedRecipe
    ? flattenRecipePrepTasks(selectedRecipe, recipesById).length
    : 0;

  // Offline "what can I make from what I've got" — only worth computing once
  // there's an empty week to fill, and re-ranked each time the sheet reopens
  // by staying a plain memo rather than sheet-local state.
  const emptyWeekSuggestions = useMemo(
    () => entries.length === 0 ? suggestRecipesForEmptyNight(recipes, groceryItems, new Date(), 5) : [],
    [entries.length, recipes, groceryItems]
  );

  const planSuggestion = (recipe: Recipe, dateKey: string) => {
    animateLayout();
    planMeal({ date: dateKey, slot: 'dinner', recipeId: recipe.id, title: recipe.name });
  };

  const headerActions = useMemo<ScreenHeaderAction[]>(() => {
    const actions: ScreenHeaderAction[] = [
      {
        icon: 'cart-outline',
        onPress: () => { haptics.tap(); setAddingToList(true); },
        disabled: !hasPlannableEntries,
        accessibilityLabel: 'Add this week to the grocery list',
      },
      { icon: 'chevron-back', onPress: () => page(-1), accessibilityLabel: 'Previous week' },
      { icon: 'chevron-forward', onPress: () => page(1), accessibilityLabel: 'Next week' },
    ];
    // Only offered once there's somewhere to come back from, so the header
    // isn't carrying a permanently inert button.
    if (!onThisWeek) {
      actions.push({
        icon: 'today-outline',
        onPress: () => { haptics.tap(); setAnchor(new Date()); },
        accessibilityLabel: 'Back to this week',
      });
    }
    return actions;
  }, [onThisWeek, hasPlannableEntries]);

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

      <FlatList
        data={days}
        keyExtractor={d => dayKeyOf(d)}
        renderItem={renderDay}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <>
            {/* Above the week rather than beside it: the fridge is what should
                be eaten before anything new is planned, and it renders nothing
                at all when empty (see LeftoversCard). */}
            <LeftoversCard
              leftovers={leftovers}
              onPress={l => setEditingLeftoverId(l.id)}
              onAdd={() => setLoggingLeftover({})}
            />
            {emptyWeekSuggestions.length > 0 && (
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
        }
        ListFooterComponent={<View style={{ height: tabBarHeight + spacing.xl }} />}
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
        onMarkCooked={selected && !selected.cookedAt ? () => markCooked(selected) : undefined}
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
        visible={suggestingMeals}
        recipes={emptyWeekSuggestions}
        weekDays={days}
        onPlan={planSuggestion}
        onClose={() => setSuggestingMeals(false)}
      />

      <RecipeToListSheet
        visible={cookedRecipeForList !== null}
        recipe={cookedRecipeForList}
        recipesById={recipesById}
        onClose={() => setCookedRecipeForList(null)}
      />

      <PrepTasksReviewSheet
        visible={reviewingPrepTasksFor !== null}
        recipe={reviewingRecipe}
        recipesById={recipesById}
        onAdd={addChosenPrepTasks}
        onClose={() => setReviewingPrepTasksFor(null)}
      />

      <LeftoverSheet
        visible={editingLeftover !== null || loggingLeftover !== null}
        leftover={editingLeftover}
        seed={loggingLeftover ?? undefined}
        // The seed's own `title` is deliberately not spread back in — it was
        // only ever the sheet's starting text, and by the time this fires the
        // user may have typed over it.
        onLog={(title, storedAt, keepDays) => logLeftover({
          title,
          storedAt,
          keepDays,
          recipeId: loggingLeftover?.recipeId ?? null,
          sourceEntryId: loggingLeftover?.sourceEntryId ?? null,
        })}
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
  add: {
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
  },
  suggestMeals: {
    alignSelf: 'flex-start',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
});
