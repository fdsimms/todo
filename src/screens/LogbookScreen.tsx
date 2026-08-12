import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  SectionList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { format } from 'date-fns/format';
import { isSameDay } from 'date-fns/isSameDay';
import { addDays } from 'date-fns/addDays';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader } from '../components/ScreenHeader';
import { SearchField } from '../components/SearchField';
import { EmptyState } from '../components/EmptyState';
import { LogbookEntryMenu } from '../components/LogbookEntryMenu';
import { LogbookBulkBar } from '../components/LogbookBulkBar';
import { SwipeableRow } from '../components/SwipeableRow';
import { PaintSelectionProvider, usePaintSelectionRow } from '../components/PaintSelection';
import { SelectionDot } from '../components/SelectionDot';
import { LogbookFilterSheet } from '../components/LogbookFilterSheet';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, lineHeight, radius, iconSize, border, checkboxRadius, animation, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { fuzzySearch } from '../utils/fuzzySearch';
import { tagColor } from '../utils/tagColor';
import { formatDuration } from '../utils/effort';
import { formatTimeOfDay, getDayStart, getLogicalDayKey } from '../utils/dateUtils';
import { isQuotaPartial, isMissed, displayTitleFor } from '../utils/visibilityUtils';
import { quotaFraction } from '../components/TaskItem';
import { formatQuotaProgress } from '../utils/quotaUnit';
import { asksOnCompletion, formatTaskDeliverable } from '../utils/deliverables';
import { DeliverablePromptSheet } from '../components/DeliverablePromptSheet';
import { sectionListCellLayout } from '../utils/sectionListLayout';
import type { Task } from '../types';

interface LogbookSection {
  title: string;
  dateKey: string;
  data: Task[];
}

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

function formatDayHeader(iso: string, dayResetTime?: string): string {
  const d = getDayStart(new Date(iso), dayResetTime);
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
  const completedTasks = useTaskStore(useShallow(s => s.completedTasks()));
  const uncompleteTask = useTaskStore(s => s.uncompleteTask);
  const bulkUncompleteTasks = useTaskStore(s => s.bulkUncompleteTasks);
  const deleteTask = useTaskStore(s => s.deleteTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const setDeliverableValue = useTaskStore(s => s.setDeliverableValue);
  const clearLogbook = useTaskStore(s => s.clearLogbook);
  const getCategoryByName = useCategoryStore(s => s.getCategoryByName);
  const dayResetTime = useSettingsStore(s => s.dayResetTime);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [menuTask, setMenuTask] = useState<Task | null>(null);
  // The entry whose answer is being corrected. Read back off the live list by
  // id when rendering, so the sheet re-seeds from the store rather than from a
  // snapshot taken when the menu was opened.
  const [answerTaskId, setAnswerTaskId] = useState<string | null>(null);
  const answerTask = answerTaskId !== null
    ? completedTasks.find(t => t.id === answerTaskId) ?? null
    : null;
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
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

  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);

  const filteredTasks = useMemo(() => {
    let tasks = completedTasks;
    if (selectedCategory) tasks = tasks.filter(t => t.category === selectedCategory);
    if (selectedTag) tasks = tasks.filter(t => t.tags.includes(selectedTag));
    if (debouncedQuery.trim()) tasks = fuzzySearch(tasks, debouncedQuery).map(r => r.task);
    return tasks;
  }, [completedTasks, selectedCategory, selectedTag, debouncedQuery]);

  const isFiltered = query.trim().length > 0 || selectedCategory !== null || selectedTag !== null;

  // Extra bottom padding so the last rows aren't hidden behind the floating
  // bulk bar, same as the other bulk-selecting screens.
  const selectionListPadding = tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm;

  const handleClearLogbook = () => {
    haptics.warning();
    Alert.alert(
      'Clear Logbook',
      `Delete all ${completedTasks.length} completed task${completedTasks.length === 1 ? '' : 's'} from the logbook? This can be undone with shake-to-undo.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            clearLogbook();
          },
        },
      ]
    );
  };

  // Deleting one entry, from its menu. Same wording as the bulk prompt below
  // it, since both land on the same shake-to-undo.
  const handleDeleteEntry = (task: Task) => {
    haptics.warning();
    Alert.alert(
      'Delete Entry',
      `Delete "${displayTitleFor(task)}" from the logbook? You can undo this by shaking your phone right after.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            animateLayout();
            deleteTask(task.id);
          },
        },
      ]
    );
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
      title: formatDayHeader(data[0].completedAt!, dayResetTime),
      dateKey,
      data,
    }));
  }, [filteredTasks, dayResetTime]);

  const cellLayout = useMemo(
    () => sectionListCellLayout(sections.map(s => s.data.length), DAY_HEADER_HEIGHT, ROW_HEIGHT),
    [sections]
  );
  const getItemLayout = useCallback(
    (_data: unknown, index: number) => cellLayout[index] ?? { length: 0, offset: 0, index },
    [cellLayout]
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Logbook"
        subtitle={`${completedTasks.length} completed`}
        actions={completedTasks.length > 0 ? [
          {
            icon: 'trash-outline',
            onPress: handleClearLogbook,
            disabled: selectionMode,
            accessibilityLabel: 'Clear logbook',
          },
        ] : undefined}
      />

      {completedTasks.length > 0 && (
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

      {selectionMode && (
        <LogbookBulkBar
          selectedCount={selectedIds.size}
          // Counted against what's on screen, not the whole logbook — with a
          // filter applied, "Select All" can only mean the rows it left.
          totalCount={filteredTasks.length}
          onMarkIncomplete={handleBulkUncomplete}
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
        onEditAnswer={menuTask?.deliverableKind ? () => {
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
      />
    </View>
  );
}

interface RowProps {
  task: Task;
  /** Pre-resolved "🏥 Health", or null when the entry has no category. */
  categoryLabel: string | null;
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

                A tinted pill rather than one more "· value" in the line, and
                the "?" needs the pill as much as the pill needs it: bare, the
                glyph sits between two unrelated bits of text and reads as
                uncertainty about the value it's next to. Enclosed, it's a
                label on the thing it belongs to — and the answer stops reading
                as a second timestamp, which "9:14 AM · Sat 12 Sep" plainly
                did. Same glyph the task's own checkbox carried before it was
                ticked, so the row and its Logbook entry say the same thing.

                An asked-but-unanswered entry says so rather than showing
                nothing — otherwise it's indistinguishable from an ordinary
                task and the ⋯ menu's "Add Answer" appears with no visible
                reason. Deliberately *not* in the pill: a tinted pill is the
                app saying "here's what you decided", and an empty one would
                make a claim the row can't back. */}
            {asksOnCompletion(task) && (
              answer !== null ? (
                <View style={styles.answerPill}>
                  <Ionicons name="help" size={iconSize.xs} color={colors.accent} />
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
    color: colors.textTertiary,
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
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.accent,
    borderTopLeftRadius: Math.max(0, checkboxRadius(CHECKBOX_SIZE) - border.md),
    borderTopRightRadius: Math.max(0, checkboxRadius(CHECKBOX_SIZE) - border.md),
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
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
});
