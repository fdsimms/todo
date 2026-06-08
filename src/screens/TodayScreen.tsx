import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  SectionList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { format } from 'date-fns';
import type { Task, SortOption, Priority, Effort } from '../types';
import { getDayStart, getCurrentDayStart, formatGroupHeader } from '../utils/dateUtils';
import { getVisibleAt } from '../utils/visibilityUtils';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { SettingsScreen } from './SettingsScreen';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { QuickAddModal } from '../components/QuickAddModal';
import { SortFilterSheet } from '../components/SortFilterSheet';
import { FocusSelector } from '../components/FocusSelector';
import { BulkActionBar } from '../components/BulkActionBar';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, radius, type Colors } from '../theme';
import { tagColor } from '../utils/tagColor';

type ViewMode = 'today' | 'focus' | 'later';

export function TodayScreen() {
  const insets = useSafeAreaInsets();
  const visibleTasks = useTaskStore(useShallow(s => s.visibleTasks()));
  const somedayTasks = useTaskStore(useShallow(s => s.somedayTasks()));
  const focusedTasks = useTaskStore(useShallow(s => s.focusedTasks()));
  const deferredTasks = useTaskStore(useShallow(s => s.deferredTasks()));
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const initialize = useTaskStore(s => s.initialize);
  const updateTask = useTaskStore(s => s.updateTask);
  const clearAllFocus = useTaskStore(s => s.clearAllFocus);
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkDeleteTasks = useTaskStore(s => s.bulkDeleteTasks);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkDefer = useTaskStore(s => s.bulkDefer);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [viewMode, setViewMode] = useState<ViewMode>('today');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorInitialTitle, setEditorInitialTitle] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusSelectorVisible, setFocusSelectorVisible] = useState(false);

  const enterSelection = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
    setExpandedTaskId(null);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  // Sort & filter state
  const [sort, setSort] = useState<SortOption>('default');
  const [filterPriorities, setFilterPriorities] = useState<Priority[]>([]);
  const [filterEfforts, setFilterEfforts] = useState<Effort[]>([]);

  const activeFilterCount =
    (sort !== 'default' ? 1 : 0) + filterPriorities.length + filterEfforts.length;

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    initialize();
    setRefreshing(false);
  }, [initialize]);

  const openEditor = (task?: Task) => {
    setEditingTask(task ?? null);
    setEditorInitialTitle('');
    setEditorVisible(true);
  };

  const handleQuickAddOpenFull = (title: string) => {
    setQuickAddVisible(false);
    setEditingTask(null);
    setEditorInitialTitle(title);
    setEditorVisible(true);
  };

  const isTaskOverdue = (task: Task): boolean => {
    if (!task.dueDate) return false;
    return getDayStart(new Date(task.dueDate)) < getCurrentDayStart();
  };

  const applyFiltersAndSort = (tasks: Task[]): Task[] => {
    let result = tasks;
    if (selectedTag) result = result.filter(t => t.tags.includes(selectedTag));
    if (filterPriorities.length > 0) result = result.filter(t => filterPriorities.includes(t.priority));
    if (filterEfforts.length > 0) result = result.filter(t => filterEfforts.includes(t.effort));

    switch (sort) {
      case 'priority': return [...result].sort((a, b) => b.priority - a.priority);
      case 'effort-asc': return [...result].sort((a, b) => (a.effort || 99) - (b.effort || 99));
      case 'effort-desc': return [...result].sort((a, b) => b.effort - a.effort);
      case 'due-date': return [...result].sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      });
      case 'streak': return [...result].sort((a, b) => b.streakCount - a.streakCount);
      default: return result;
    }
  };

  const filtered = applyFiltersAndSort(visibleTasks);
  const overdueTasks = filtered.filter(isTaskOverdue);
  const todayTasks = filtered.filter(t => !isTaskOverdue(t));
  const suggestions = somedayTasks.slice(0, 3);
  const showSomeday = activeFilterCount === 0 && !selectedTag && suggestions.length > 0;

  type ListItem =
    | { type: 'header'; label: string; isOverdue?: boolean }
    | { type: 'task'; task: Task };

  const buildOverdueSection = (tasks: Task[]): ListItem[] => {
    if (tasks.length === 0) return [];
    return [
      { type: 'header', label: 'Overdue', isOverdue: true },
      ...tasks.map(task => ({ type: 'task' as const, task })),
    ];
  };

  const buildGroupedData = (): ListItem[] => {
    const overdueItems = buildOverdueSection(overdueTasks);
    const byTag: Record<string, Task[]> = {};
    const untagged: Task[] = [];

    todayTasks.forEach(task => {
      if (task.tags.length === 0) {
        untagged.push(task);
      } else {
        const key = task.tags[0];
        if (!byTag[key]) byTag[key] = [];
        byTag[key].push(task);
      }
    });

    const groupedItems: ListItem[] = [];
    Object.entries(byTag).forEach(([tag, tasks]) => {
      groupedItems.push({ type: 'header', label: tag });
      tasks.forEach(task => groupedItems.push({ type: 'task', task }));
    });
    if (untagged.length > 0) {
      groupedItems.push({ type: 'header', label: 'Other' });
      untagged.forEach(task => groupedItems.push({ type: 'task', task }));
    }
    return [...overdueItems, ...groupedItems];
  };

  const data: ListItem[] = buildGroupedData();

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'header') {
      return (
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionHeaderText, item.isOverdue && styles.sectionHeaderOverdue]}>
            {item.label}
          </Text>
        </View>
      );
    }
    const subs = allTasks.filter(t => t.parentId === item.task.id);
    return (
      <TaskItem
        task={item.task}
        onPress={() => setExpandedTaskId(prev => prev === item.task.id ? null : item.task.id)}
        expanded={expandedTaskId === item.task.id}
        onEdit={() => openEditor(item.task)}
        subtaskCount={subs.length}
        subtaskDoneCount={subs.filter(t => t.completed).length}
        subtasks={subs}
        selectionMode={selectionMode}
        selected={selectedIds.has(item.task.id)}
        onLongPress={() => enterSelection(item.task.id)}
        onSelect={() => toggleSelection(item.task.id)}
      />
    );
  };

  const emptyComponent = showSomeday ? (
    <View>
      <View style={styles.empty}>
        <Ionicons name="checkmark-circle" size={52} color={colors.bgQuaternary} />
        <Text style={styles.emptyText}>All clear</Text>
        <Text style={styles.emptySubtext}>Nothing scheduled for today</Text>
      </View>
      <View style={styles.suggestions}>
        <Text style={styles.suggestionsLabel}>How about one of these?</Text>
        {suggestions.map(task => {
          const subs = allTasks.filter(t => t.parentId === task.id);
          return (
            <View key={task.id}>
              <TaskItem
                task={task}
                onPress={() => setExpandedTaskId(prev => prev === task.id ? null : task.id)}
                expanded={expandedTaskId === task.id}
                onEdit={() => openEditor(task)}
                subtaskCount={subs.length}
                subtaskDoneCount={subs.filter(t => t.completed).length}
                subtasks={subs}
              />
              <TouchableOpacity
                style={styles.doTodayBtn}
                onPress={() => updateTask(task.id, { someday: false })}
              >
                <Ionicons name="arrow-up-circle-outline" size={14} color={colors.accent} />
                <Text style={styles.doTodayText}>Move to today</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    </View>
  ) : (
    <View style={styles.empty}>
      <Ionicons name="checkmark-circle" size={52} color={colors.bgQuaternary} />
      <Text style={styles.emptyText}>All clear</Text>
      <Text style={styles.emptySubtext}>
        {activeFilterCount > 0
          ? 'No tasks match these filters'
          : selectedTag
            ? `No visible tasks tagged "${selectedTag}"`
            : viewMode === 'focus'
              ? 'No tasks in focus'
              : 'Nothing to do right now'}
      </Text>
    </View>
  );

  const today = format(new Date(), 'EEEE, MMMM d');

  // Later view grouping
  const laterGroupKey = (task: Task): string => {
    const visibleAt = getVisibleAt(task);
    const dayLabel = formatGroupHeader(visibleAt.toISOString());
    if (task.timeOfDay) {
      const label = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' }[task.timeOfDay];
      return `${dayLabel} — ${label}`;
    }
    return dayLabel;
  };

  const laterSections = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    [...deferredTasks]
      .sort((a, b) => getVisibleAt(a).getTime() - getVisibleAt(b).getTime())
      .forEach(task => {
        const key = laterGroupKey(task);
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(task);
      });
    return Array.from(grouped.entries()).map(([title, data]) => ({ title, data }));
  }, [deferredTasks]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          {viewMode === 'today' && <Text style={styles.dateLabel}>{today}</Text>}
          <Text style={styles.title}>
            {viewMode === 'today' ? 'Today' : viewMode === 'focus' ? 'Focus' : 'Later'}
          </Text>
        </View>
        <View style={styles.headerButtons}>
          {viewMode === 'focus' && focusedTasks.length > 0 && (
            <TouchableOpacity style={styles.clearBtn} onPress={clearAllFocus}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
          {viewMode === 'focus' && (
            <TouchableOpacity style={styles.selectBtn} onPress={() => setFocusSelectorVisible(true)}>
              <Ionicons name="add" size={16} color={colors.text} />
              <Text style={styles.selectText}>Select</Text>
            </TouchableOpacity>
          )}
          {viewMode === 'today' && (
            <TouchableOpacity
              style={[styles.iconBtn, activeFilterCount > 0 && styles.iconBtnAccent]}
              onPress={() => setFilterVisible(true)}
            >
              <Ionicons
                name="options"
                size={18}
                color={activeFilterCount > 0 ? colors.text : colors.textSecondary}
              />
              {activeFilterCount > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{activeFilterCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.iconBtn} onPress={() => setSettingsVisible(true)}>
            <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* View mode switcher */}
      <View style={styles.viewModePills}>
        {(['today', 'focus', 'later'] as ViewMode[]).map(mode => (
          <TouchableOpacity
            key={mode}
            style={[styles.viewModePill, viewMode === mode && styles.viewModePillActive]}
            onPress={() => { setViewMode(mode); setExpandedTaskId(null); setSelectionMode(false); setSelectedIds(new Set()); }}
            activeOpacity={0.7}
          >
            <Text style={[styles.viewModePillText, viewMode === mode && styles.viewModePillTextActive]}>
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
              {mode === 'focus' && focusedTasks.length > 0 ? ` ${focusedTasks.length}` : ''}
              {mode === 'later' && deferredTasks.length > 0 ? ` ${deferredTasks.length}` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {viewMode === 'today' && allTags.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterBar}
        >
          <TouchableOpacity
            style={[styles.filterChip, !selectedTag && styles.filterChipActive]}
            onPress={() => setSelectedTag(null)}
            activeOpacity={0.7}
          >
            <Text style={[styles.filterChipText, !selectedTag && styles.filterChipTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          {allTags.map(tag => (
            <TouchableOpacity
              key={`tag-${tag}`}
              style={[styles.filterChip, selectedTag === tag && { backgroundColor: tagColor(tag) }]}
              onPress={() => setSelectedTag(prev => prev === tag ? null : tag)}
              activeOpacity={0.7}
            >
              {selectedTag !== tag && <View style={[styles.filterDot, { backgroundColor: tagColor(tag) }]} />}
              <Text style={[styles.filterChipText, selectedTag === tag && styles.filterChipTextActive]}>
                {tag}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {viewMode === 'focus' && (
        focusedTasks.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="star" size={52} color={colors.bgQuaternary} />
            <Text style={styles.emptyText}>No focus set</Text>
            <Text style={styles.emptySubtext}>Tap "Select" to pick a few tasks to focus on, or star any task.</Text>
          </View>
        ) : (
          <FlatList
            data={focusedTasks}
            keyExtractor={t => t.id}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.listContent}
            ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
            onScrollBeginDrag={() => setExpandedTaskId(null)}
            renderItem={({ item }) => {
              const subs = allTasks.filter(t => t.parentId === item.id);
              return (
                <TaskItem
                  task={item}
                  onPress={() => setExpandedTaskId(prev => prev === item.id ? null : item.id)}
                  expanded={expandedTaskId === item.id}
                  onEdit={() => openEditor(item)}
                  subtaskCount={subs.length}
                  subtaskDoneCount={subs.filter(t => t.completed).length}
                  subtasks={subs}
                  selectionMode={selectionMode}
                  selected={selectedIds.has(item.id)}
                  onLongPress={() => enterSelection(item.id)}
                  onSelect={() => toggleSelection(item.id)}
                />
              );
            }}
          />
        )
      )}

      {viewMode === 'later' && (
        <SectionList
          sections={laterSections}
          keyExtractor={item => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={laterSections.length === 0 ? styles.emptyContainer : styles.listContent}
          renderItem={({ item }) => {
            const subs = allTasks.filter(t => t.parentId === item.id);
            return (
              <TaskItem
                task={item}
                onPress={() => setExpandedTaskId(prev => prev === item.id ? null : item.id)}
                expanded={expandedTaskId === item.id}
                onEdit={() => openEditor(item)}
                subtaskCount={subs.length}
                subtaskDoneCount={subs.filter(t => t.completed).length}
                subtasks={subs}
                selectionMode={selectionMode}
                selected={selectedIds.has(item.id)}
                onLongPress={() => enterSelection(item.id)}
                onSelect={() => toggleSelection(item.id)}
              />
            );
          }}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
            </View>
          )}
          stickySectionHeadersEnabled={false}
          ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
          onScrollBeginDrag={() => setExpandedTaskId(null)}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="moon" size={52} color={colors.bgQuaternary} />
              <Text style={styles.emptyText}>Nothing deferred</Text>
              <Text style={styles.emptySubtext}>Swipe left on a task to defer it</Text>
            </View>
          }
        />
      )}

      {viewMode === 'today' && (
        <FlatList
          data={data}
          keyExtractor={(item, i) =>
            item.type === 'header' ? `h-${item.label}-${i}` : item.task.id
          }
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={renderItem}
          contentContainerStyle={filtered.length === 0 ? styles.emptyContainer : styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.textSecondary}
            />
          }
          ListEmptyComponent={emptyComponent}
          ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
          onScrollBeginDrag={() => setExpandedTaskId(null)}
        />
      )}

      {viewMode === 'today' && (
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + 20 }]}
          onPress={() => setQuickAddVisible(true)}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={28} color={colors.text} />
        </TouchableOpacity>
      )}

      <QuickAddModal
        visible={quickAddVisible}
        onClose={() => setQuickAddVisible(false)}
        onOpenFull={handleQuickAddOpenFull}
      />

      <FocusSelector
        visible={focusSelectorVisible}
        onClose={() => setFocusSelectorVisible(false)}
      />

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        initialTitle={editorInitialTitle}
        onClose={() => setEditorVisible(false)}
      />

      <SortFilterSheet
        visible={filterVisible}
        onClose={() => setFilterVisible(false)}
        sort={sort}
        onSortChange={setSort}
        priorities={filterPriorities}
        onPrioritiesChange={setFilterPriorities}
        efforts={filterEfforts}
        onEffortsChange={setFilterEfforts}
      />

      <SettingsScreen visible={settingsVisible} onClose={() => setSettingsVisible(false)} />

      {selectionMode && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          totalCount={
            viewMode === 'focus' ? focusedTasks.length
            : viewMode === 'later' ? deferredTasks.length
            : filtered.length
          }
          existingTags={allTags}
          onComplete={() => { bulkCompleteTasks(Array.from(selectedIds)); exitSelection(); }}
          onDelete={() => { bulkDeleteTasks(Array.from(selectedIds)); exitSelection(); }}
          onDefer={date => { bulkDefer(Array.from(selectedIds), date); exitSelection(); }}
          onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
          onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
          onSelectAll={() => setSelectedIds(new Set(
            viewMode === 'focus' ? focusedTasks.map(t => t.id)
            : viewMode === 'later' ? deferredTasks.map(t => t.id)
            : filtered.map(t => t.id)
          ))}
          onDeselectAll={() => setSelectedIds(new Set())}
          onCancel={exitSelection}
          bottomInset={insets.bottom}
        />
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.md, paddingTop: spacing.sm,
  },
  dateLabel: { color: colors.textTertiary, fontSize: font.xs, fontWeight: '500', letterSpacing: 0.3, marginBottom: 2 },
  title: { color: colors.text, fontSize: font.xxl, fontWeight: '700', letterSpacing: -0.5 },
  headerButtons: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingBottom: 2 },
  clearBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgSecondary,
  },
  clearText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.accent,
  },
  selectText: { color: colors.text, fontSize: font.sm, fontWeight: '600' },
  viewModePills: {
    flexDirection: 'row', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  viewModePill: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.full, backgroundColor: colors.bgSecondary,
  },
  viewModePillActive: { backgroundColor: colors.accent },
  viewModePillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  viewModePillTextActive: { color: colors.text, fontWeight: '600' },
  iconBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnActive: { backgroundColor: colors.bgTertiary },
  iconBtnAccent: { backgroundColor: colors.accent },
  badge: {
    position: 'absolute', top: -3, right: -3,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.text, fontSize: 9, fontWeight: '700' },
  sectionHeader: {
    paddingHorizontal: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  sectionHeaderText: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  sectionHeaderOverdue: {
    color: colors.red,
  },
  emptyContainer: { flex: 1 },
  listContent: { paddingTop: spacing.xs, paddingBottom: 20 },
  listFooter: { height: 120 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emptyText: { color: colors.textSecondary, fontSize: font.lg, fontWeight: '600' },
  emptySubtext: { color: colors.textTertiary, fontSize: font.sm, textAlign: 'center', paddingHorizontal: spacing.xl, lineHeight: 20 },
  suggestions: { paddingTop: spacing.lg },
  suggestionsLabel: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
  },
  doTodayBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm, paddingTop: 2,
  },
  doTodayText: { color: colors.accent, fontSize: font.xs, fontWeight: '500' },
  fab: {
    position: 'absolute', right: spacing.lg,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 8,
  },
  filterBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: spacing.sm,
  },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  filterChipActive: { backgroundColor: colors.accent },
  filterDot: { width: 6, height: 6, borderRadius: radius.full },
  filterChipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: '500' },
  filterChipTextActive: { color: colors.text, fontWeight: '700', letterSpacing: 0.1 },
});
