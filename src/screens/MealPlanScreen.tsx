import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, Alert } from 'react-native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useShallow } from 'zustand/react/shallow';
import { addWeeks } from 'date-fns/addWeeks';
import { format } from 'date-fns/format';
import { isToday } from 'date-fns/isToday';
import { isSameWeek } from 'date-fns/isSameWeek';
import type { MealSlot } from '../types';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { InlineAction } from '../components/InlineAction';
import { MealSlotRow } from '../components/MealSlotRow';
import { MealEntrySheet } from '../components/MealEntrySheet';
import { RecipePickerSheet, type MealPick } from '../components/RecipePickerSheet';
import { AddWeekToListSheet } from '../components/AddWeekToListSheet';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useGroceryStore } from '../store/useGroceryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useTaskStore } from '../store/useTaskStore';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, border, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { buildWeekDays } from '../utils/calendarGrid';
import { dayKeyOf, dayKeyToDate } from '../utils/dateUtils';
import { resolvePrepTaskDraft } from '../utils/recipeUtils';
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
  const markEntryCooked = useMealPlanStore(s => s.markCooked);
  const addedToListAt = useMealPlanStore(useShallow(s => s.addedToListAt));

  const recipes = useRecipeStore(useShallow(s => s.recipes));
  const recipesById = useMemo(() => recipeIndex(recipes), [recipes]);
  const markRecipeCooked = useRecipeStore(s => s.markCooked);
  const addTask = useTaskStore(s => s.addTask);
  const addFromPlan = useGroceryStore(s => s.addFromPlan);

  // The day being planned; null when the picker is closed.
  const [planningDay, setPlanningDay] = useState<string | null>(null);
  // Held by id rather than by value so the entry sheet's chips follow a move it
  // just made — the row itself is re-read from the store on every render.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = entries.find(e => e.id === selectedId) ?? null;
  const [addingToList, setAddingToList] = useState(false);

  useEffect(() => {
    if (range) loadRange(range.startKey, range.endKey);
  }, [range?.startKey, range?.endKey, loadRange]);

  const onThisWeek = isSameWeek(anchor, new Date(), { weekStartsOn });

  const page = (delta: number) => {
    haptics.tap();
    setAnchor(a => addWeeks(a, delta));
  };

  const pick = (pickResult: MealPick) => {
    if (!planningDay) return;
    animateLayout();
    planMeal({
      date: planningDay,
      slot: pickResult.slot,
      recipeId: pickResult.recipeId,
      title: pickResult.title,
    });
    setPlanningDay(null);
  };

  const addPrepTasksForSelected = () => {
    if (!selected?.recipeId) return;
    const recipe = recipesById.get(selected.recipeId);
    if (!recipe || recipe.prepTasks.length === 0) return;
    const mealDate = dayKeyToDate(selected.date);
    recipe.prepTasks.forEach(prepTask => {
      const { dueDate, reminderTime } = resolvePrepTaskDraft(prepTask, mealDate);
      addTask({ title: prepTask.title, dueDate, reminderTime });
    });
    haptics.success();
    Alert.alert('Prep tasks added', `Added ${recipe.prepTasks.length} to your tasks.`);
  };

  const markCookedForSelected = () => {
    if (!selected) return;
    markEntryCooked(selected.id);
    const recipe = selected.recipeId ? recipesById.get(selected.recipeId) : undefined;
    if (recipe) markRecipeCooked(recipe.id);
    haptics.success();

    // A recipe with nothing to re-shop offers nothing — same restraint
    // RecipeDetailScreen's own "Add ingredients to list" already keeps.
    if (!recipe || recipe.ingredients.length === 0) return;
    Alert.alert(
      'Marked cooked',
      `Add ${recipe.name}'s ingredients back to your grocery list?`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Add to list',
          onPress: () => {
            addFromPlan(recipe.ingredients.map(i => ({
              name: i.name,
              quantity: [i.quantity, i.prep].filter(Boolean).join(', ') || null,
              aisle: i.aisle,
            })));
            haptics.success();
          },
        },
      ]
    );
  };

  const renderDay = useCallback(({ item: day }: { item: Date }) => {
    const key = dayKeyOf(day);
    const dayEntries = entriesForDay(entries, key);
    const today = isToday(day);

    return (
      <View style={styles.section}>
        <View style={styles.dayHeader}>
          <Text style={[styles.dayName, today && styles.dayNameToday]}>
            {format(day, 'EEEE')}
          </Text>
          <Text style={styles.dayDate}>{today ? 'Today' : format(day, 'd MMM')}</Text>
        </View>

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
          accessibilityLabel={`Plan a meal for ${format(day, 'EEEE d MMMM')}`}
          style={styles.add}
        />
      </View>
    );
  }, [entries, recipesById, styles]);

  // Cheap enough to compute on every render: whether there's anything an "Add
  // week to list" could possibly find, without running the full ingredient
  // collection just to light up a header icon.
  const hasPlannableEntries = entries.some(e => e.recipeId && recipesById.has(e.recipeId));

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

      <FlatList
        data={days}
        keyExtractor={d => dayKeyOf(d)}
        renderItem={renderDay}
        contentContainerStyle={styles.list}
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
        onMarkCooked={selected && !selected.cookedAt ? markCookedForSelected : undefined}
        onOpenRecipe={
          selected?.recipeId && recipesById.has(selected.recipeId)
            ? () => navigation.navigate('RecipeDetail', { recipeId: selected.recipeId })
            : undefined
        }
        onAddPrepTasks={
          selected?.recipeId && (recipesById.get(selected.recipeId)?.prepTasks.length ?? 0) > 0
            ? addPrepTasksForSelected
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
});
