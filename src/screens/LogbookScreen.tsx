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
import { isToday } from 'date-fns/isToday';
import { isYesterday } from 'date-fns/isYesterday';
import { useTaskStore } from '../store/useTaskStore';
import { useCategoryStore } from '../store/useCategoryStore';
import { useShallow } from 'zustand/react/shallow';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { LogbookEntryMenu } from '../components/LogbookEntryMenu';
import { SwipeableRow } from '../components/SwipeableRow';
import { LogbookFilterSheet } from '../components/LogbookFilterSheet';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, lineHeight, radius, iconSize, border, checkboxRadius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { fuzzySearch } from '../utils/fuzzySearch';
import { tagColor } from '../utils/tagColor';
import { formatDuration } from '../utils/effort';
import { isQuotaPartial } from '../utils/visibilityUtils';
import { sectionListCellLayout } from '../utils/sectionListLayout';
import type { Task } from '../types';

interface LogbookSection {
  title: string;
  dateKey: string;
  data: Task[];
}

const CHECKBOX_SIZE = 20;

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

function formatDayHeader(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return 'Today';
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'EEEE, MMMM d');
}

function formatTime(iso: string): string {
  return format(new Date(iso), 'h:mm a');
}

export function LogbookScreen() {
  const insets = useSafeAreaInsets();
  const tabBarHeight = useBottomTabBarHeight();
  const completedTasks = useTaskStore(useShallow(s => s.completedTasks()));
  const uncompleteTask = useTaskStore(s => s.uncompleteTask);
  const updateTask = useTaskStore(s => s.updateTask);
  const clearLogbook = useTaskStore(s => s.clearLogbook);
  const getCategoryByName = useCategoryStore(s => s.getCategoryByName);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [menuTask, setMenuTask] = useState<Task | null>(null);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);

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

  const filteredTasks = useMemo(() => {
    let tasks = completedTasks;
    if (selectedCategory) tasks = tasks.filter(t => t.category === selectedCategory);
    if (selectedTag) tasks = tasks.filter(t => t.tags.includes(selectedTag));
    if (query.trim()) tasks = fuzzySearch(tasks, query).map(r => r.task);
    return tasks;
  }, [completedTasks, selectedCategory, selectedTag, query]);

  const isFiltered = query.trim().length > 0 || selectedCategory !== null || selectedTag !== null;

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

  const sections = useMemo((): LogbookSection[] => {
    const sorted = [...filteredTasks].sort(
      (a, b) => new Date(b.completedAt!).getTime() - new Date(a.completedAt!).getTime()
    );

    const grouped = new Map<string, Task[]>();
    sorted.forEach(task => {
      const key = format(new Date(task.completedAt!), 'yyyy-MM-dd');
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(task);
    });

    return Array.from(grouped.entries()).map(([dateKey, data]) => ({
      title: formatDayHeader(data[0].completedAt!),
      dateKey,
      data,
    }));
  }, [filteredTasks]);

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
            accessibilityLabel: 'Clear logbook',
          },
        ] : undefined}
      />

      {completedTasks.length > 0 && (
        <>
          <View style={styles.searchBar}>
            <Ionicons name="search" size={16} color={colors.textTertiary} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search logbook…"
              placeholderTextColor={colors.textTertiary}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            {query.length > 0 && Platform.OS !== 'ios' && (
              <TouchableOpacity onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
              </TouchableOpacity>
            )}
          </View>
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

      <SectionList
        sections={sections}
        keyExtractor={item => item.id}
        getItemLayout={getItemLayout}
        contentContainerStyle={sections.length === 0 ? styles.emptyContainer : styles.listContent}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionHeaderText}>{section.title}</Text>
            <Text style={styles.sectionHeaderCount}>{section.data.length}</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const categoryEmoji = item.category ? getCategoryByName(item.category)?.emoji : null;
          const categoryLabel = item.category
            ? (categoryEmoji ? `${categoryEmoji} ${item.category}` : item.category)
            : null;
          return (
          // Swipe right to move when it was completed — the same "when" slot
          // tasks use for rescheduling. No select side: there's no bulk mode
          // here, and "complete" would mean nothing to a completed row.
          // Square corners: these rows are deliberately flat and full-bleed
          // (see styles.row), so the panel shouldn't be rounded like a card.
          <SwipeableRow
            style={styles.rowSwipe}
            whenAction={{
              icon: 'calendar-outline',
              onAction: () => setMenuTask(item),
              accessibilityLabel: `Change when ${item.title} was completed`,
            }}
          >
            <View style={styles.row}>
              <TouchableOpacity
                style={styles.checkCircle}
                onPress={() => {
                  haptics.tap();
                  animateLayout();
                  uncompleteTask(item.id);
                }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: true }}
                accessibilityLabel={`Mark ${item.title} as not done`}
              >
                <Ionicons
                  name={isQuotaPartial(item) ? 'remove' : 'checkmark'}
                  size={12}
                  color={isQuotaPartial(item) ? colors.textTertiary : colors.green}
                />
              </TouchableOpacity>
              <View
                style={styles.rowContent}
                accessible
                accessibilityLabel={[
                  item.title,
                  isQuotaPartial(item)
                    ? `fell short at ${item.progressCount} of ${item.targetCount}, ${formatTime(item.completedAt!)}`
                    : `completed ${formatTime(item.completedAt!)}`,
                  item.category,
                  item.actualMinutes != null ? `timed ${formatDuration(item.actualMinutes)}` : null,
                ].filter(Boolean).join(', ')}
              >
                <Text style={styles.taskTitle} numberOfLines={1}>{item.title}</Text>
                <View style={styles.metaRow}>
                  <Text style={styles.taskTime}>{formatTime(item.completedAt!)}</Text>
                  {item.targetCount !== null && (
                    <Text style={styles.taskTime}>· {item.progressCount}/{item.targetCount}</Text>
                  )}
                  {categoryLabel && (
                    <View style={styles.categoryChip}>
                      <Ionicons name="folder-outline" size={iconSize.xs} color={colors.textTertiary} />
                      <Text style={styles.categoryChipText} numberOfLines={1}>{categoryLabel}</Text>
                    </View>
                  )}
                  {item.actualMinutes != null && (
                    <Text style={styles.taskTime}>· {formatDuration(item.actualMinutes)}</Text>
                  )}
                </View>
              </View>
              <TouchableOpacity
                style={styles.menuButton}
                onPress={() => setMenuTask(item)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`More options for ${item.title}`}
              >
                <Ionicons name="ellipsis-horizontal" size={iconSize.sm} color={colors.textTertiary} />
              </TouchableOpacity>
            </View>
          </SwipeableRow>
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
        onClose={() => setMenuTask(null)}
      />

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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bgSecondary,
    borderRadius: radius.md,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: Platform.OS === 'ios' ? 10 : 4,
    gap: spacing.xs,
  },
  searchIcon: { marginRight: 2 },
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
    backgroundColor: colors.bgTertiary,
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
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: font.md,
    height: 20,
    padding: 0,
    textAlignVertical: 'center',
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
