// Completed history, under two lenses (tasks and cooking). The screen component
// is ~600 lines; the rows below it are separate memoised components:
//
//   ==== <name> ====        the section banners through the screen's logic half
//   LogbookRow, KitchenRow, ActiveFilterPill   the rows, at module level
//   makeStyles              styles, at the bottom
//
// Filtering by tag or category is a bottom sheet, not a scrolling chip row; see
// the note on LogbookFilterSheet in CLAUDE.md before changing the filter control.
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  SectionList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import { addDays } from 'date-fns/addDays';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useProjectStore } from '../store/useProjectStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useMealPlanStore } from '../store/useMealPlanStore';
import { useLeftoverStore } from '../store/useLeftoverStore';
import { useRecipeStore } from '../store/useRecipeStore';
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader } from '../components/ScreenHeader';
import { SearchField } from '../components/SearchField';
import { EmptyState } from '../components/EmptyState';
import { LogbookEntryMenu } from '../components/LogbookEntryMenu';
import { SimpleBulkBar } from '../components/SimpleBulkBar';
import { SwipeableRow } from '../components/SwipeableRow';
import { PaintSelectionProvider, usePaintSelectionRow } from '../components/PaintSelection';
import { SelectionDot } from '../components/SelectionDot';
import { LogbookFilterSheet } from '../components/LogbookFilterSheet';
import { usePersonStore, displayNameOf } from '../store/usePersonStore';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, lineHeight, radius, iconSize, border, checkboxRadius, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { confirmDelete } from '../utils/confirmDelete';
import { animateLayout } from '../utils/layoutAnimation';
import { fuzzySearch } from '../utils/fuzzySearch';
import { tagColor } from '../utils/tagColor';
import { formatDuration } from '../utils/effort';
import { dayKeyToDate, formatTimeOfDay, getDayStart, getLogicalDayKey, getLogicalToday } from '../utils/dateUtils';
import { cookingWindow } from '../utils/cookingStats';
import {
  filterKitchenEvents,
  kitchenEvents,
  kitchenHistoryDays,
  type KitchenEvent,
} from '../utils/kitchenHistory';
import { formatScale } from '../utils/recipeScale';
import { MEAL_PLAN_RETENTION_DAYS, LEFTOVER_RETENTION_DAYS } from '../types';
import { isQuotaPartial, isMissed, displayTitleFor, quotaFraction } from '../utils/visibilityUtils';
import { formatQuotaProgress } from '../utils/quotaUnit';
import { asksOnCompletion, deliverableKindFor, formatTaskDeliverable } from '../utils/deliverables';
import { DeliverablePromptSheet } from '../components/DeliverablePromptSheet';
import { sectionListCellLayout } from '../utils/sectionListLayout';
import type { Task } from '../types';

interface LogbookSection {
  title: string;
  dateKey: string;
  data: Task[];
}

interface KitchenSection {
  title: string;
  dateKey: string;
  data: KitchenEvent[];
}

/**
 * The two things the Logbook is a history *of*.
 *
 * **Two lists behind a switch, not one list of mixed rows** (#1779). Four
 * things about a task row are meaningless on a cooked meal, and each of them
 * would have had to grow a fork: the checkbox uncompletes, the swipes
 * reschedule and select, the bulk bar offers Mark Incomplete and Delete (which
 * on a meal would delete the *plan*, not the record of having cooked it), and
 * the header's trash clears the whole logbook. `SelectionDot`'s own rule is an
 * empty ring on every eligible row, so a mixed list would ring half of what's
 * on screen and leave the rest looking excluded for no stated reason. The
 * category and tag filters are the fifth: a meal has neither, so under an
 * active filter the cooking rows would either vanish — making one control mean
 * two things — or stay, making it a lie.
 *
 * The same call #1440 reached for Search and wrote down. Within the cooking
 * lens a cooked meal and a finished leftover *are* mixed, and that's consistent
 * rather than contradictory: both are read-only rows saying something happened
 * in the kitchen on a day, so not one of the five objections applies to them.
 *
 * Pills rather than a `SegmentedControl`, matching the view-mode row TodayScreen
 * has had all along — that component's own doc rules itself out on a page
 * background, and its track is for setting a value rather than choosing which
 * list you're reading.
 */
type LogbookLens = 'tasks' | 'cooking';

const LENS_TITLES: Record<LogbookLens, string> = {
  tasks: 'Tasks',
  cooking: 'Cooking',
};

const LENSES: LogbookLens[] = ['tasks', 'cooking'];

const CHECKBOX_SIZE = 20;

// Keeps the search field's own value/onChangeText bound to the raw,
// fast-updating `query` state — only the fuzzySearch recompute waits on this
// delay. Same fix as SearchScreen's (#1210).
const SEARCH_DEBOUNCE_MS = 180;

// This is the only long virtualized list in the app — Today and its siblings
// render every row into a plain ScrollView (`ReorderableList`), so nothing else
// hits the path below.
//
// Both heights are pinned so `getItemLayout` can be exact. Left to measure
// itself the list is unstable at scroll depth: RN sizes the spacer standing in
// for the cells above the window out of `ListMetricsAggregator`, which mixes
// offsets recorded at layout time with `_averageCellLength` guesses for cells
// it hasn't laid out. Resizing that spacer physically shifts every mounted
// cell, each shifted cell re-reports `onLayout`, and that reschedules the
// window update that resizes the spacer — at some depths it settles into a
// two-frame cycle instead of converging, and the list flips between two scroll
// positions on its own (and loses the pinned day header, which rides along in
// its own render region).
//
// Rows here vary in height for a reason that's invisible in the styles: an
// emoji in a category label ("🏥 Health") renders taller than the surrounding
// text unless `lineHeight` is set explicitly, so a Logbook of mixed categories
// has several row heights and the average is never right. Every Text in a cell
// therefore carries an explicit `lineHeight`, and the title is one line — a
// wrapping title would put the height back out of reach of `getItemLayout`.
const ROW_HEIGHT = spacing.sm * 2 + lineHeight.md + 2 + lineHeight.xs; // 56
const DAY_HEADER_HEIGHT = spacing.lg + lineHeight.xs + spacing.xs; // 44

/**
 * Takes the day *key* rather than the instant it came from, so both lenses can
 * share it. The cooking lens has no instant to hand over for a cooked meal —
 * `MealPlanEntry.date` is already a calendar day (see `kitchenEvents`) — and
 * the task lens has already computed this key to group by.
 */
function formatDayHeader(dayKey: string, dayResetTime?: string): string {
  const d = dayKeyToDate(dayKey);
  const today = getDayStart(new Date(), dayResetTime);
  if (isSameDay(d, today)) return 'Today';
  if (isSameDay(d, addDays(today, -1))) return 'Yesterday';
  return format(d, 'EEEE, MMMM d');
}

function formatTime(iso: string): string {
  return formatTimeOfDay(new Date(iso));
}

export function LogbookScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const navigation = useNavigation<any>();
  const completedTasks = useTaskStore(useShallow(s => s.completedTasks()));
  const uncompleteTask = useTaskStore(s => s.uncompleteTask);
  const bulkUncompleteTasks = useTaskStore(s => s.bulkUncompleteTasks);
  const deleteTask = useTaskStore(s => s.deleteTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const setDeliverableValue = useTaskStore(s => s.setDeliverableValue);
  const clearLogbook = useTaskStore(s => s.clearLogbook);
  const getCategoryByName = useCategoryStore(s => s.getCategoryByName);
  const projects = useProjectStore(s => s.projects);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Read at the point of use rather than latched, like StatsScreen's cooking
  // section: putting the kitchen away takes this lens with it, and turning it
  // back on restores it exactly as it was. `lens` is left alone so the switch
  // doesn't quietly forget which one someone was reading.
  const kitchenEnabled = useSettingsStore(s => s.kitchenEnabled);
  const [lens, setLens] = useState<LogbookLens>('tasks');
  const activeLens: LogbookLens = kitchenEnabled ? lens : 'tasks';

  const cookHistory = useMealPlanStore(s => s.cookHistory);
  const refreshCookHistory = useMealPlanStore(s => s.refreshCookHistory);
  const leftovers = useLeftoverStore(s => s.leftovers);
  const recipes = useRecipeStore(s => s.recipes);

  // Pulled on focus, not pushed: `cookHistory` is deliberately outside the meal
  // plan's window contract (see its note there), and `enableScreens(false)`
  // keeps this tab mounted, so a window computed once at mount would still end
  // on the day the app was opened. Same shape as StatsScreen's.
  // ==== effects ====
  useFocusEffect(
    useCallback(() => {
      if (!kitchenEnabled) return;
      const window = cookingWindow(getLogicalToday(), MEAL_PLAN_RETENTION_DAYS);
      refreshCookHistory(window.startKey, window.endKey);
    }, [kitchenEnabled, refreshCookHistory])
  );

  const allKitchenEvents = useMemo(
    () =>
      kitchenEnabled
        ? kitchenEvents(cookHistory ?? [], leftovers, recipes, dayResetTime)
        : [],
    [kitchenEnabled, cookHistory, leftovers, recipes, dayResetTime]
  );

  // A completed task's projectId doesn't say which project — same map
  // SearchScreen builds once per projects change rather than looking each
  // row up by scanning the array (getProjectById) on every render.
  const projectNamesById = useMemo(
    () => new Map(projects.map(p => [p.id, p.title])),
    [projects]
  );

  const [menuTask, setMenuTask] = useState<Task | null>(null);
  // The entry whose answer is being corrected. Read back off the live list by
  // id when rendering, so the sheet re-seeds from the store rather than from a
  // snapshot taken when the menu was opened.
  // ==== local state (lens, filters, selection, sheets) ====
  const [answerTaskId, setAnswerTaskId] = useState<string | null>(null);
  const answerTask = answerTaskId !== null
    ? completedTasks.find(t => t.id === answerTaskId) ?? null
    : null;
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const people = usePersonStore(useShallow(s => s.people));
  const [filterVisible, setFilterVisible] = useState(false);
  const [bulkBarHeight, setBulkBarHeight] = useState(0);

  // The same bulk-selection machinery every task list uses. Its delete flow
  // asks about recurring tasks in a mixed selection, which never fires here:
  // isLiveRecurring is false for anything completed, so a Logbook selection
  // always takes the plain "delete N tasks, undoable by shaking" path.
  const {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
    handleBulkDelete,
    painting,
    paintProps,
  } = useTaskSelection(completedTasks);

  // Chip options are scoped to what's actually in the logbook, not every
  // category/tag in the app — an unused filter is just clutter here.
  const availableCategories = useMemo(
    () => Array.from(new Set(completedTasks.map(t => t.category).filter((c): c is string => !!c))).sort(),
    [completedTasks]
  );
  const availableTags = useMemo(
    () => Array.from(new Set(completedTasks.flatMap(t => t.tags))).sort(),
    [completedTasks]
  );
  const categoryChipItems = useMemo(
    () => availableCategories.map(category => {
      const emoji = getCategoryByName(category)?.emoji;
      return { key: category, label: emoji ? `${emoji} ${category}` : category };
    }),
    [availableCategories, getCategoryByName]
  );
  const tagChipItems = useMemo(
    () => availableTags.map(tag => ({ key: tag, label: tag, color: tagColor(tag) })),
    [availableTags]
  );

  // Archived people stay filterable: a row that names somebody is history, and
  // filing them away is about the list rather than about what you did together.
  const peopleChipItems = useMemo(
    () => people.map(p => ({ key: p.id, label: displayNameOf(p) })),
    [people]
  );

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  // ==== the lists: completed rows narrowed by lens, search and filters ====
  const filteredTasks = useMemo(() => {
    let tasks = completedTasks;
    if (selectedCategory) tasks = tasks.filter(t => t.category === selectedCategory);
    if (selectedTag) tasks = tasks.filter(t => t.tags.includes(selectedTag));
    if (selectedPerson) tasks = tasks.filter(t => t.personIds.includes(selectedPerson));
    if (debouncedQuery.trim()) tasks = fuzzySearch(tasks, debouncedQuery).map(r => r.task);
    return tasks;
  }, [completedTasks, selectedCategory, selectedTag, selectedPerson, debouncedQuery]);

  // The category and tag filters are task vocabulary and don't reach this lens
  // (see LogbookLens), so the query is all that narrows it.
  const filteredEvents = useMemo(
    () => filterKitchenEvents(allKitchenEvents, debouncedQuery),
    [allKitchenEvents, debouncedQuery]
  );

  const isFiltered =
    activeLens === 'cooking'
      ? query.trim().length > 0
      : query.trim().length > 0 || selectedCategory !== null || selectedTag !== null || selectedPerson !== null;

  // Extra bottom padding so the last rows aren't hidden behind the floating
  // bulk bar, same as the other bulk-selecting screens.
  const selectionListPadding = tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm;

  // ==== actions: clearing, bulk uncomplete, delete ====
  const handleClearLogbook = () => {
    haptics.warning();
    confirmDelete({
      title: 'Clear Logbook',
      message: `Delete all ${completedTasks.length} completed task${completedTasks.length === 1 ? '' : 's'} from the logbook? This can be undone with shake-to-undo.`,
      confirmLabel: 'Clear',
      onConfirm: () => {
        animateLayout();
        clearLogbook();
      },
    });
  };

  // Deleting one entry, from its menu. Same wording as the bulk prompt below
  // it, since both land on the same shake-to-undo.
  const handleDeleteEntry = (task: Task) => {
    haptics.warning();
    confirmDelete({
      title: 'Delete Entry',
      message: `Delete "${displayTitleFor(task)}" from the logbook? You can undo this by shaking your phone right after.`,
      onConfirm: () => {
        animateLayout();
        deleteTask(task.id);
      },
    });
  };

  const handleBulkUncomplete = () => {
    animateLayout();
    bulkUncompleteTasks(Array.from(selectedIds));
    exitSelection();
  };

  const sections = useMemo((): LogbookSection[] => {
    const sorted = [...filteredTasks].sort(
      (a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime()
    );

    const grouped = new Map<string, Task[]>();
    sorted.forEach(task => {
      const key = getLogicalDayKey(new Date(task.completedAt!), dayResetTime);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(task);
    });

    return Array.from(grouped.entries()).map(([dateKey, data]) => ({
      title: formatDayHeader(dateKey, dayResetTime),
      dateKey,
      data,
    }));
  }, [filteredTasks, dayResetTime]);

  const kitchenSections = useMemo(
    (): KitchenSection[] =>
      kitchenHistoryDays(filteredEvents).map(day => ({
        title: formatDayHeader(day.dayKey, dayResetTime),
        dateKey: day.dayKey,
        data: day.events,
      })),
    [filteredEvents, dayResetTime]
  );

  // One layout for whichever list is on screen. A kitchen row is built to the
  // same ROW_HEIGHT as a task row, on purpose — see the note on that constant;
  // a second row height here would need a second set of pinned metrics and
  // would put the list back out of getItemLayout's reach at scroll depth.
  const cellLayout = useMemo(
    () =>
      sectionListCellLayout(
        (activeLens === 'cooking' ? kitchenSections : sections).map(s => s.data.length),
        DAY_HEADER_HEIGHT,
        ROW_HEIGHT
      ),
    [activeLens, sections, kitchenSections]
  );
  const getItemLayout = useCallback(
    (_data: unknown, index: number) => cellLayout[index] ?? { length: 0, offset: 0, index },
    [cellLayout]
  );

  const openRecipe = useCallback(
    (recipeId: string) => {
      haptics.tap();
      navigation.navigate('RecipeDetail', { recipeId });
    },
    [navigation]
  );

  const switchLens = (next: LogbookLens) => {
    if (next === lens) return;
    haptics.tap();
    // Selection is over completed *tasks* and has no meaning on the other side,
    // so it leaves with the list it was made in — same call TodayScreen's view
    // pills make. The query deliberately stays: "salmon" is a fair question to
    // ask of both.
    if (selectionMode) exitSelection();
    setLens(next);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Logbook"
        subtitle={
          activeLens === 'cooking'
            ? describeKitchenCount(allKitchenEvents.length)
            : `${completedTasks.length} completed`
        }
        // The trash clears completed *tasks* (`clearLogbook` → bulkDeleteTasks),
        // so it belongs to that lens alone. There is no equivalent here and
        // there shouldn't be: the cooking rows are a read over the meal plan and
        // the fridge, and clearing them would mean deleting the plan.
        actions={activeLens === 'tasks' && completedTasks.length > 0 ? [
          {
            icon: 'trash-outline',
            onPress: handleClearLogbook,
            disabled: selectionMode,
            accessibilityLabel: 'Clear logbook',
          },
        ] : undefined}
      />

      {kitchenEnabled && (
        <View style={styles.lensRow}>
          {LENSES.map(mode => {
            const active = activeLens === mode;
            return (
              <TouchableOpacity
                key={mode}
                style={[styles.lensPill, active && styles.lensPillActive]}
                onPress={() => switchLens(mode)}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${LENS_TITLES[mode]} view`}
              >
                <Text style={[styles.lensPillText, active && styles.lensPillTextActive]}>
                  {LENS_TITLES[mode]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {activeLens === 'cooking' && allKitchenEvents.length > 0 && (
        <SearchField
          style={styles.searchBar}
          placeholder="Search cooking…"
          value={query}
          onChangeText={setQuery}
        />
      )}

      {activeLens === 'tasks' && completedTasks.length > 0 && (
        <>
          <SearchField
            style={styles.searchBar}
            placeholder="Search logbook…"
            value={query}
            onChangeText={setQuery}
          />
          {(categoryChipItems.length > 0 || tagChipItems.length > 0) && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              // ScrollView's base style is flexGrow/flexShrink: 1, so in this
              // column the SectionList's overflowing content height would
              // otherwise shrink this row until the pills are shorter than
              // their own padding. Same reason TodayScreen pins its pill row.
              style={styles.filterBarScroll}
              contentContainerStyle={styles.filterBar}
            >
              <TouchableOpacity
                style={styles.filterButton}
                onPress={() => {
                  haptics.tap();
                  setFilterVisible(true);
                }}
                activeOpacity={interaction.activeOpacity}
                accessibilityRole="button"
                accessibilityLabel="Filter logbook"
              >
                <Ionicons name="funnel-outline" size={13} color={colors.text} />
                <Text style={styles.filterButtonText}>Filter</Text>
                <Ionicons name="chevron-down" size={12} color={colors.textTertiary} />
              </TouchableOpacity>
              {selectedCategory && (
                <ActiveFilterPill
                  label={categoryChipItems.find(c => c.key === selectedCategory)?.label ?? selectedCategory}
                  color={colors.accent}
                  onRemove={() => {
                    animateLayout();
                    setSelectedCategory(null);
                  }}
                  styles={styles}
                />
              )}
              {selectedTag && (
                <ActiveFilterPill
                  label={selectedTag}
                  color={tagColor(selectedTag)}
                  onRemove={() => {
                    animateLayout();
                    setSelectedTag(null);
                  }}
                  styles={styles}
                />
              )}
            </ScrollView>
          )}
        </>
      )}

      {activeLens === 'cooking' ? (
        // Its own list rather than a union row type through the one above:
        // every prop that list carries — the paint provider, the selection
        // extraData, the bulk padding — is about a selection this lens doesn't
        // have. What the two share is the metrics (see cellLayout) and the day
        // header, which is what makes them read as one screen.
        <SectionList
          sections={kitchenSections}
          keyExtractor={item => item.key}
          getItemLayout={getItemLayout}
          contentContainerStyle={
            kitchenSections.length === 0 ? styles.emptyContainer : styles.listContent
          }
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
              <Text style={styles.sectionHeaderCount}>{section.data.length}</Text>
            </View>
          )}
          renderItem={({ item }) => (
            <KitchenRow
              event={item}
              styles={styles}
              colors={colors}
              onOpenRecipe={openRecipe}
            />
          )}
          // Named where the list stops, because it does stop and nothing else
          // on screen says why. Both horizons, not the longer one: a leftover
          // is purged four months before the meal it came from.
          ListFooterComponent={
            kitchenSections.length > 0 ? (
              <Text style={styles.historyNote}>
                Cooked meals are kept for {MEAL_PLAN_RETENTION_DAYS} days, leftovers for{' '}
                {LEFTOVER_RETENTION_DAYS}.
              </Text>
            ) : null
          }
          ListEmptyComponent={
            isFiltered ? (
              <EmptyState
                icon="search-outline"
                title="No matches"
                subtitle="Nothing you've cooked matches your search"
                bottomOffset={tabBarHeight}
              />
            ) : (
              <EmptyState
                icon="restaurant-outline"
                title="Nothing cooked yet"
                subtitle="Meals you mark cooked, and leftovers you finish, appear here"
                bottomOffset={tabBarHeight}
              />
            )
          }
        />
      ) : (
      <PaintSelectionProvider {...paintProps}>
      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        getItemLayout={getItemLayout}
        // A paint gesture owns the touch for its duration — see the note in
        // PaintSelectionProvider on why the list can't be allowed to scroll
        // out from under it.
        scrollEnabled={!painting}
        // renderItem closes over the selection, and the cells are memoized on
        // their item alone, so the list has to be told what else changed.
        extraData={paintProps}
        contentContainerStyle={
          sections.length === 0
            ? styles.emptyContainer
            : [styles.listContent, selectionMode && { paddingBottom: selectionListPadding }]
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{section.title}</Text>
            <Text style={styles.sectionHeaderCount}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const categoryEmoji = item.category ? getCategoryByName(item.category)?.emoji : null;
          return (
            <LogbookRow
              task={item}
              categoryLabel={
                item.category
                  ? (categoryEmoji ? `${categoryEmoji} ${item.category}` : item.category)
                  : null
              }
              projectTitle={item.projectId ? projectNamesById.get(item.projectId) ?? null : null}
              styles={styles}
              colors={colors}
              selectionMode={selectionMode}
              selected={selectedIds.has(item.id)}
              onToggleSelect={toggleSelection}
              onEnterSelection={enterSelectionMode}
              onUncomplete={uncompleteTask}
              onOpenMenu={setMenuTask}
            />
          );
        }}
        ListEmptyComponent={
          isFiltered ? (
            <EmptyState
              icon="search-outline"
              title="No matches"
              subtitle="No completed tasks match your search or filters"
              bottomOffset={tabBarHeight}
            />
          ) : (
            <EmptyState
              icon="book-outline"
              title="No completed tasks"
              subtitle="Tasks you complete will appear here"
              bottomOffset={tabBarHeight}
            />
          )
        }
      />
      </PaintSelectionProvider>
      )}

      {selectionMode && (
        <SimpleBulkBar
          selectedCount={selectedIds.size}
          // Counted against what's on screen, not the whole logbook — with a
          // filter applied, "Select All" can only mean the rows it left.
          totalCount={filteredTasks.length}
          primary={{
            icon: 'arrow-undo',
            label: 'Incomplete',
            onPress: handleBulkUncomplete,
            accessibilityLabel: 'Mark selected tasks incomplete',
          }}
          onDelete={handleBulkDelete}
          onSelectAll={() => selectAll(filteredTasks.map(t => t.id))}
          onDeselectAll={deselectAll}
          onCancel={exitSelection}
          bottomInset={tabBarHeight}
          onHeightChange={setBulkBarHeight}
        />
      )}

      <LogbookEntryMenu
        visible={!!menuTask}
        value={menuTask?.completedAt ? new Date(menuTask.completedAt) : null}
        onMarkIncomplete={() => {
          if (menuTask) {
            animateLayout();
            uncompleteTask(menuTask.id);
          }
          setMenuTask(null);
        }}
        onChangeDate={date => {
          if (menuTask) {
            animateLayout();
            updateTask(menuTask.id, { completedAt: date.toISOString() });
          }
          setMenuTask(null);
        }}
        onEditAnswer={menuTask && deliverableKindFor(menuTask) ? () => {
          const id = menuTask.id;
          setMenuTask(null);
          // Staggered for the same reason the calendar's confirm is: closing
          // one native Modal and presenting another in the same tick can
          // deadlock the iOS modal transition.
          setTimeout(() => setAnswerTaskId(id), animation.duration.slow);
        } : undefined}
        hasAnswer={menuTask?.deliverableValue != null}
        onDelete={() => {
          const task = menuTask;
          setMenuTask(null);
          if (task) handleDeleteEntry(task);
        }}
        onClose={() => setMenuTask(null)}
      />

      {answerTask && (
        <DeliverablePromptSheet
          visible
          task={answerTask}
          mode="edit"
          onConfirm={value => {
            setDeliverableValue(answerTask.id, value);
            setAnswerTaskId(null);
          }}
          onCancel={() => setAnswerTaskId(null)}
        />
      )}

      <LogbookFilterSheet
        visible={filterVisible}
        onClose={() => setFilterVisible(false)}
        categories={categoryChipItems}
        tags={tagChipItems}
        selectedCategory={selectedCategory}
        onSelectCategory={setSelectedCategory}
        selectedTag={selectedTag}
        onSelectTag={setSelectedTag}
        people={peopleChipItems}
        selectedPerson={selectedPerson}
        onSelectPerson={setSelectedPerson}
      />
    </View>
  );
}

interface RowProps {
  task: Task;
  /** Pre-resolved "🏥 Health", or null when the entry has no category. */
  categoryLabel: string | null;
  /** The task's project title, or null when it isn't filed under one. */
  projectTitle: string | null;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onEnterSelection: (initial: string) => void;
  onUncomplete: (id: string) => void;
  onOpenMenu: (task: Task) => void;
}

// One Logbook entry. A component rather than an inline renderItem so it can
// register itself with the paint gesture — and memoized, since a selection
// change re-renders the whole list.
//
// Every branch below keeps the row exactly ROW_HEIGHT tall: the leading
// control swaps its contents rather than its box, and the trailing slot only
// ever swaps one short control for another. getItemLayout has no way to hear
// about a row that grew (see the note on ROW_HEIGHT).
const LogbookRow = React.memo(function LogbookRow({
  task,
  categoryLabel,
  projectTitle,
  styles,
  colors,
  selectionMode,
  selected,
  onToggleSelect,
  onEnterSelection,
  onUncomplete,
  onOpenMenu,
}: RowProps) {
  const paintRef = usePaintSelectionRow(task.id);
  const partial = isQuotaPartial(task);
  const answer = formatTaskDeliverable(task);
  // A miss outranks a partial in the glyph: a quota task marked missed is both,
  // and "you didn't do this" is the more important of the two things to say.
  const missed = isMissed(task);

  // ==== render. Everything below is JSX ====
  return (
    // Swipe right to move when it was completed — the same "when" slot tasks
    // use for rescheduling; swipe left to start bulk editing with this row
    // picked, exactly as it does on Today. Square corners: these rows are
    // deliberately flat and full-bleed (see styles.row), so the panel
    // shouldn't be rounded like a card.
    <SwipeableRow
      style={styles.rowSwipe}
      enabled={!selectionMode}
      whenAction={{
        icon: 'calendar-outline',
        onAction: () => onOpenMenu(task),
        accessibilityLabel: `Change when ${task.title} was completed`,
      }}
      selectAction={{
        onSelect: () => onEnterSelection(task.id),
        accessibilityLabel: `Select ${task.title}`,
      }}
    >
      <View ref={paintRef} style={[styles.row, selectionMode && selected && styles.rowSelected]}>
        {/* Unchanged by selection mode, like TaskItem's — this circle says what
            happened to the task, and a row picked for a bulk edit must not read
            as one whose completion state just changed. Selection is the dot at
            the row's other end. */}
        <TouchableOpacity
          style={[
            styles.checkCircle,
            // A miss still outranks a partial in the border, same as the glyph:
            // no fill to show for zero progress.
            partial && !missed && styles.checkCircleQuota,
          ]}
          onPress={() => {
            if (selectionMode) {
              onToggleSelect(task.id);
              return;
            }
            haptics.tap();
            animateLayout();
            onUncomplete(task.id);
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selectionMode ? selected : true }}
          accessibilityLabel={
            selectionMode
              ? (selected ? `Deselect ${task.title}` : `Select ${task.title}`)
              : missed
                ? `Put ${task.title} back on the list`
                : `Mark ${task.title} as not done`
          }
        >
          {partial && !missed ? (
            // Same proportional fill Today's meter uses instead of a flat dash —
            // "6/12" and "1/12" no longer render identically.
            <View
              style={[styles.quotaFill, { height: `${Math.round(quotaFraction(task) * 100)}%` }]}
              pointerEvents="none"
            />
          ) : (
            <Ionicons
              name={missed ? 'close' : 'checkmark'}
              size={12}
              color={missed ? colors.textSecondary : colors.green}
            />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.rowContent}
          // Outside selection mode the row has never been tappable — the
          // checkbox and the ⋯ button are the affordances, and a completed
          // entry has nothing to open.
          disabled={!selectionMode}
          onPress={() => onToggleSelect(task.id)}
          activeOpacity={interaction.activeOpacity}
          accessible
          accessibilityLabel={[
            displayTitleFor(task),
            missed
              ? `missed, ${formatTime(task.completedAt!)}`
              : partial
                ? `fell short at ${task.progressCount} of ${task.targetCount}${task.targetUnit ? ` ${task.targetUnit}` : ''}, ${formatTime(task.completedAt!)}`
                : `completed ${formatTime(task.completedAt!)}`,
            task.category,
            projectTitle,
            task.actualMinutes != null ? `timed ${formatDuration(task.actualMinutes)}` : null,
            // Both states out loud, same as the row shows them: "no answer" is
            // what makes the ⋯ menu's "Add Answer" make sense to someone who
            // can't see the glyph.
            asksOnCompletion(task) ? (answer !== null ? `answered ${answer}` : 'no answer') : null,
          ].filter(Boolean).join(', ')}
        >
          <Text style={styles.taskTitle} numberOfLines={1}>{displayTitleFor(task)}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.taskTime}>{formatTime(task.completedAt!)}</Text>
            {/* Named, not just glyphed. The neutral × on the left says something is
                different about this row, but a Logbook is read as a list of
                things that happened and "missed" is the one entry whose
                meaning inverts — it has to survive being skimmed. */}
            {missed && <Text style={styles.missedTag}>· Missed</Text>}
            {task.targetCount !== null && (
              <Text style={styles.taskTime} numberOfLines={1}>
                · {formatQuotaProgress(task.progressCount, task.targetCount, task.targetUnit)}
              </Text>
            )}
            {categoryLabel && (
              <View style={styles.categoryChip}>
                <Ionicons name="folder-outline" size={iconSize.xs} color={colors.textTertiary} />
                <Text style={styles.categoryChipText} numberOfLines={1}>{categoryLabel}</Text>
              </View>
            )}
            {projectTitle && (
              <View style={styles.categoryChip}>
                <Ionicons name="briefcase-outline" size={iconSize.xs} color={colors.textTertiary} />
                <Text style={styles.categoryChipText} numberOfLines={1}>{projectTitle}</Text>
              </View>
            )}
            {task.actualMinutes != null && (
              <Text style={styles.taskTime}>· {formatDuration(task.actualMinutes)}</Text>
            )}
            {/* What was decided, in the row's own meta line rather than a line
                of its own — these rows are a fixed ROW_HEIGHT for
                getItemLayout, which has no way to hear about a row that grew.
                One step up from the rest of the line in colour and weight
                (see styles.answer): it's the only thing here that isn't
                bookkeeping about the completion, and it's what someone opens
                the Logbook to read back. It shrinks where the others don't, so
                a long answer truncates instead of shoving them off the row.

                A tinted pill rather than one more "· value" in the line — the
                tint alone is what stops the answer reading as a second
                timestamp, which "9:14 AM · Sat 12 Sep" plainly did. No "?" in
                it (#1735): a question mark on a decision that's already been
                made reads as the decision still being open, the opposite of
                what a tinted "here's what you decided" pill is for.

                An asked-but-unanswered entry says so rather than showing
                nothing — otherwise it's indistinguishable from an ordinary
                task and the ⋯ menu's "Add Answer" appears with no visible
                reason. Deliberately *not* in the pill: a tinted pill is the
                app saying "here's what you decided", and an empty one would
                make a claim the row can't back. */}
            {asksOnCompletion(task) && (
              answer !== null ? (
                <View style={styles.answerPill}>
                  <Text style={styles.answer} numberOfLines={1}>{answer}</Text>
                </View>
              ) : (
                <Text style={styles.noAnswer} numberOfLines={1}>No answer</Text>
              )
            )}
          </View>
        </TouchableOpacity>
        {selectionMode ? (
          // Straight into the slot the ⋯ button leaves, so the row's width
          // budget is unchanged and its fixed height (see ROW_HEIGHT) can't be
          // disturbed by the swap.
          <SelectionDot selected={selected} onPress={() => onToggleSelect(task.id)} />
        ) : (
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => onOpenMenu(task)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={`More options for ${task.title}`}
          >
            <Ionicons name="ellipsis-horizontal" size={iconSize.sm} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>
    </SwipeableRow>
  );
});

/** "12 cooked and eaten" reads wrong, and so does a bare number. */
function describeKitchenCount(count: number): string {
  return `${count} kitchen ${count === 1 ? 'entry' : 'entries'}`;
}

interface KitchenRowProps {
  event: KitchenEvent;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  onOpenRecipe: (recipeId: string) => void;
}

/**
 * One thing that happened in the kitchen.
 *
 * Built to the same ROW_HEIGHT as `LogbookRow` — title on one line, one meta
 * line under it — because both lenses share `getItemLayout` (see the note on
 * that constant, which this row is just as bound by).
 *
 * **Read-only, and every one of its differences from a task row follows from
 * that.** The glyph is a `View` rather than a `TouchableOpacity`: there is
 * nothing to un-cook here, and marking a meal not-cooked belongs on the meal
 * plan where the plan is. No `SwipeableRow`, since both of that row's actions
 * (reschedule the completion, start a selection) are task operations. No
 * trailing `⋯`, because the menu behind it offers three things this row can't
 * do. What it does have is the one thing a completed task genuinely doesn't:
 * somewhere to go. A recipe-backed row opens the recipe — "when did we last
 * have the ragù" is most of why this lens exists — and a free-text meal or a
 * hand-logged container has no recipe, so it isn't pressable and shows no
 * chevron rather than a dead one.
 */
const KitchenRow = React.memo(function KitchenRow({
  event,
  styles,
  colors,
  onOpenRecipe,
}: KitchenRowProps) {
  const cooked = event.kind === 'cooked';
  const tossed = event.outcome === 'tossed';
  // Its own glyph per kind rather than the task lens's checkmark for everything:
  // two lists this similar need to say which one you're reading at a glance, and
  // eaten-vs-thrown-out is the one distinction in here worth a shape.
  const glyph = cooked ? 'restaurant' : tossed ? 'trash-outline' : 'checkmark';
  // Deliberately not colors.red for a thrown-out container — the same call
  // describeOutcome makes in choosing "Thrown out" over "Wasted". Nothing here
  // is a grade.
  const glyphColor = cooked ? colors.accent : tossed ? colors.textSecondary : colors.green;
  const scale = event.scale !== 1 ? formatScale(event.scale) : null;

  const body = (
    <>
      <View style={styles.kitchenGlyph}>
        <Ionicons name={glyph} size={iconSize.sm} color={glyphColor} />
      </View>
      <View style={styles.rowContent}>
        <Text style={styles.taskTitle} numberOfLines={1}>{event.title}</Text>
        <View style={styles.metaRow}>
          <Text style={styles.taskTime}>{event.detail}</Text>
          {/* How much of it was made — the one fact about a particular cooking
              that isn't already on the recipe, and the reason recipeScale is a
              fact about the meal rather than about the dish. Silent at 1×,
              which is nearly every row. */}
          {scale && <Text style={styles.taskTime}>· {scale}</Text>}
        </View>
      </View>
      {event.recipeId && (
        <Ionicons name="chevron-forward" size={iconSize.sm} color={colors.textTertiary} />
      )}
    </>
  );

  const label = [event.title, event.detail, scale ? `scaled ${scale}` : null]
    .filter(Boolean)
    .join(', ');

  if (!event.recipeId) {
    return <View style={styles.row} accessible accessibilityLabel={label}>{body}</View>;
  }
  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onOpenRecipe(event.recipeId!)}
      activeOpacity={interaction.activeOpacity}
      accessible
      accessibilityRole="button"
      accessibilityLabel={`${label}. Open recipe`}
    >
      {body}
    </TouchableOpacity>
  );
});

// An applied filter, shown next to the Filter button so the current state is
// readable without opening the sheet. Tapping anywhere on it clears it.
function ActiveFilterPill({
  label,
  color,
  onRemove,
  styles,
}: {
  label: string;
  color: string;
  onRemove: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <TouchableOpacity
      // Tinted rather than filled, and colored text rather than onAccent —
      // the same treatment every other removable tag chip uses (TaskEditor,
      // QuickAddModal). A filled pill would put white text on a yellow tag.
      style={[styles.activePill, { backgroundColor: color + '33' }]}
      onPress={() => {
        haptics.tap();
        onRemove();
      }}
      activeOpacity={interaction.activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={`Remove filter ${label}`}
    >
      <Text style={[styles.activePillText, { color }]} numberOfLines={1}>{label}</Text>
      <Ionicons name="close" size={13} color={color} />
    </TouchableOpacity>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  searchBar: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  // Matching TodayScreen's view-mode pills, which is the app's other
  // list-screen lens switch — accent-filled for the active one. Two options
  // fit a 390pt line with room to spare, so unlike Today's this doesn't need
  // to scroll, and a plain row can't be shrunk by the list below it.
  lensRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  lensPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.bgQuaternary,
  },
  lensPillActive: { backgroundColor: colors.accent },
  lensPillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  lensPillTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
  filterBarScroll: { flexGrow: 0, flexShrink: 0 },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    height: DAY_HEADER_HEIGHT,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  sectionHeaderText: {
    color: colors.textSecondary,
    fontSize: font.xs,
    lineHeight: lineHeight.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sectionHeaderCount: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: lineHeight.xs,
    fontWeight: fontWeight.semibold,
  },
  listContent: { paddingBottom: 40 },
  emptyContainer: { flexGrow: 1 },
  rowSwipe: { borderRadius: 0 },
  // Deliberately flat, not the inset-grouped card TaskItem rows use — a
  // completed entry isn't draggable or tappable-to-edit like a live task,
  // so it shouldn't be styled to invite that interaction.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    height: ROW_HEIGHT,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    borderBottomWidth: border.hairline,
    borderBottomColor: colors.separator,
  },
  checkCircle: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    borderRadius: checkboxRadius(CHECKBOX_SIZE),
    borderCurve: 'continuous',
    borderWidth: border.md,
    borderColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  // A partial quota row's border and fill — matching TaskItem's circleQuota /
  // quotaFill, just painted at rest instead of animated (this is history, not
  // a live meter).
  checkCircleQuota: {
    borderColor: colors.accent,
    overflow: 'hidden', // clips the fill to the circle
  },
  quotaFill: {
    position: 'absolute',
    left: -border.md,
    right: -border.md,
    bottom: 0,
    backgroundColor: colors.accent,
    borderRadius: 0,
  },
  // These rows are flat and separator-divided rather than cards, so a selected
  // one is marked by tinting the whole band instead of the card treatment
  // TaskItem uses.
  rowSelected: { backgroundColor: colors.accent + '1A' },
  rowContent: { flex: 1 },
  taskTitle: {
    color: colors.textSecondary,
    fontSize: font.md,
    lineHeight: lineHeight.md,
    fontWeight: '400',
  },
  taskTime: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: lineHeight.xs,
    flexShrink: 0,
  },
  // **Horizontal padding only, and a height pinned to the meta line.** Every
  // row here is a fixed ROW_HEIGHT for getItemLayout, computed as
  // title + 2 + lineHeight.xs — so a pill that padded itself vertically would
  // make its row taller than the list believes every row is, and the list
  // becomes unstable at scroll depth (see the note on ROW_HEIGHT).
  answerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    height: lineHeight.xs,
    paddingHorizontal: 6,
    borderRadius: radius.full,
    backgroundColor: colors.accentSubtle,
    flexShrink: 1,
  },
  answer: {
    color: colors.accent,
    fontSize: font.xs,
    lineHeight: lineHeight.xs,
    fontWeight: fontWeight.medium,
    flexShrink: 1,
  },
  // Nothing was recorded, so this is bookkeeping again: no pill, and back to
  // the meta grey the rest of the line uses.
  noAnswer: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: lineHeight.xs,
    flexShrink: 1,
  },
  // Same metrics as taskTime so it sits on the meta row's baseline; only the
  // colour and weight lift it, matching the neutral × on the row's left.
  // Deliberately not colors.red — a miss is bookkeeping, not a failure grade.
  missedTag: {
    color: colors.textSecondary,
    fontSize: font.xs,
    lineHeight: lineHeight.xs,
    fontWeight: fontWeight.semibold,
    flexShrink: 0,
  },
  // No wrapping: the row is a fixed height, so a second meta line would be
  // clipped rather than shown. The category is the one part that gives way.
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flexShrink: 1,
  },
  categoryChipText: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: lineHeight.xs,
    flexShrink: 1,
  },
  menuButton: {
    padding: 4,
    flexShrink: 0,
  },
  // The same 20pt box `checkCircle` occupies, so the two lenses' titles start at
  // the same x and the row still lays out to exactly ROW_HEIGHT — but **bare,
  // with no ring around it**. A bordered circle at that position is this app's
  // checkbox, and none of these rows can be ticked; drawing one would be the
  // same affordance lie `styles.row` avoids by staying flat instead of taking
  // the card treatment. The colour is set per row rather than here, since it's
  // what says which of the three things happened.
  kitchenGlyph: {
    width: CHECKBOX_SIZE,
    height: CHECKBOX_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  // Outside the cells, so it costs getItemLayout nothing — a SectionList's own
  // footer isn't in the flat cell index the layout covers.
  historyNote: {
    color: colors.textTertiary,
    fontSize: font.xs,
    lineHeight: lineHeight.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
});
