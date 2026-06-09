import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { format } from 'date-fns';
import type { Task, SortOption, Priority, Effort } from '../types';
import { formatGroupHeader } from '../utils/dateUtils';
import { getVisibleAt } from '../utils/visibilityUtils';
import { makeCategoryGroups, resolveDrop } from '../utils/taskGrouping';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { SettingsScreen } from './SettingsScreen';
import { suggestFocusTasks } from '../services/aiSuggestions';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { QuickAddModal } from '../components/QuickAddModal';
import { SortFilterSheet } from '../components/SortFilterSheet';
import { BulkActionBar } from '../components/BulkActionBar';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, lineHeight, radius, type Colors } from '../theme';

type ViewMode = 'today' | 'later';

export function TodayScreen() {
  const insets = useSafeAreaInsets();
  const visibleTasks = useTaskStore(useShallow(s => s.visibleTasks()));
  const focusedTasks = useTaskStore(useShallow(s => s.focusedTasks()));
  const completedTasks = useTaskStore(useShallow(s => s.completedTasks()));
  const deferredTasks = useTaskStore(useShallow(s => s.deferredTasks()));
  const upcomingTodayTasks = useTaskStore(useShallow(s => s.upcomingTodayTasks()));
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const initialize = useTaskStore(s => s.initialize);
  const updateTask = useTaskStore(s => s.updateTask);
  const clearAllFocus = useTaskStore(s => s.clearAllFocus);
  const reorderTasks = useTaskStore(s => s.reorderTasks);
  const reorderWithCategoryUpdates = useTaskStore(s => s.reorderWithCategoryUpdates);
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkDeleteTasks = useTaskStore(s => s.bulkDeleteTasks);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkDefer = useTaskStore(s => s.bulkDefer);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [viewMode, setViewMode] = useState<ViewMode>('today');
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [editorInitialTitle, setEditorInitialTitle] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filterVisible, setFilterVisible] = useState(false);
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [restExpanded, setRestExpanded] = useState(false);
  const [isSuggestingFocus, setIsSuggestingFocus] = useState(false);

  const handleSuggestFocus = async () => {
    setIsSuggestingFocus(true);
    try {
      const ids = await suggestFocusTasks(visibleTasks, focusedTasks.length, completedTasks);
      for (const id of ids) updateTask(id, { focused: true });
    } catch (e) {
      Alert.alert('Could not suggest focus', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setIsSuggestingFocus(false);
    }
  };

  const enterSelection = (id: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
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

  const filtered = useMemo(() => {
    let result = visibleTasks;
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
  }, [visibleTasks, sort, filterPriorities, filterEfforts]);

  type ListItem =
    | { type: 'focus-header' }
    | { type: 'rest-header' }
    | { type: 'header'; label: string }
    | { type: 'task'; task: Task };

  const upcomingTaskIds = useMemo(
    () => new Set(upcomingTodayTasks.map(t => t.id)),
    [upcomingTodayTasks],
  );

  const data: ListItem[] = useMemo(() => {
    if (focusedTasks.length > 0) {
      const items: ListItem[] = [{ type: 'focus-header' }];
      focusedTasks.forEach(task => items.push({ type: 'task', task }));
      const restTasks = filtered.filter(t => !t.focused);
      if (restTasks.length > 0) {
        items.push({ type: 'rest-header' });
        if (restExpanded) items.push(...makeCategoryGroups(restTasks));
      }
      return items;
    }

    const items = makeCategoryGroups(filtered);
    if (showUpcoming && upcomingTodayTasks.length > 0) {
      let upcomingFiltered = upcomingTodayTasks;
      if (filterPriorities.length > 0) upcomingFiltered = upcomingFiltered.filter(t => filterPriorities.includes(t.priority));
      if (filterEfforts.length > 0) upcomingFiltered = upcomingFiltered.filter(t => filterEfforts.includes(t.effort));
      if (upcomingFiltered.length > 0) {
        items.push({ type: 'header', label: 'Later Today' });
        upcomingFiltered.forEach(task => items.push({ type: 'task', task }));
      }
    }
    return items;
  }, [filtered, focusedTasks, restExpanded, showUpcoming, upcomingTodayTasks, filterPriorities, filterEfforts]);

  const listItemKey = (item: ListItem): string =>
    item.type === 'focus-header' ? '__focus-header__'
    : item.type === 'rest-header' ? '__rest-header__'
    : item.type === 'header' ? `h-${item.label}`
    : item.task.id;

  // Local copy of data fed to DraggableFlatList. onDragEnd writes the *final*
  // grouped layout here once (see resolveDrop) so the list shows the settled
  // result immediately, and `justDroppedRef` then skips the single redundant
  // store-driven resync that follows.
  //
  // Why this matters: react-native-draggable-flatlist animates the dropped
  // cell to its resting offset on drag end. If the `data` array identity
  // changes *again* mid-animation (which a second resync does), that cell's
  // translateY gets stranded — leaving a task floating below the list in a
  // slot you can't tap. Writing the settled layout exactly once keeps the
  // array stable across the drop animation.
  //
  // The ref self-resets on the very next `data` change (the store write always
  // produces one), so unlike the previous "is dragging" guard it can never
  // freeze the list — an interrupted drag (e.g. a screenshot) just never sets
  // it, and normal resync continues.
  const [draggableData, setDraggableData] = useState<ListItem[]>(data);
  const justDroppedRef = useRef(false);
  useEffect(() => {
    if (justDroppedRef.current) {
      justDroppedRef.current = false;
      return;
    }
    setDraggableData(data);
  }, [data]);

  const renderItem = ({ item, drag, isActive }: { item: ListItem; drag?: () => void; isActive?: boolean }) => {
    if (item.type === 'focus-header') {
      return (
        <View style={styles.focusSectionHeader}>
          <View style={styles.focusSectionTitleRow}>
            <Ionicons name="star" size={13} color={colors.orange} />
            <Text style={styles.focusSectionTitle}>Focus</Text>
          </View>
          <TouchableOpacity onPress={clearAllFocus} hitSlop={8}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (item.type === 'rest-header') {
      const restCount = filtered.filter(t => !t.focused).length;
      return (
        <TouchableOpacity
          style={styles.restSectionHeader}
          onPress={() => setRestExpanded(e => !e)}
          activeOpacity={0.7}
        >
          <Text style={styles.sectionHeaderText}>Everything else</Text>
          {restCount > 0 && <Text style={styles.restCount}>{restCount}</Text>}
          <Ionicons name={restExpanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textTertiary} />
        </TouchableOpacity>
      );
    }
    if (item.type === 'header') {
      return (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionHeaderText}>{item.label}</Text>
        </View>
      );
    }
    const subs = allTasks.filter(t => t.parentId === item.task.id);
    const taskNode = (
      <TaskItem
        task={item.task}
        onPress={() => {
          if (expandedTaskId !== null && expandedTaskId !== item.task.id) {
            setExpandedTaskId(null);
            return;
          }
          setExpandedTaskId(prev => prev === item.task.id ? null : item.task.id);
        }}
        expanded={expandedTaskId === item.task.id}
        spotlightDisabled={expandedTaskId !== null && expandedTaskId !== item.task.id && !selectionMode}
        onEdit={() => openEditor(item.task)}
        subtaskCount={subs.length}
        subtaskDoneCount={subs.filter(t => t.completed).length}
        subtasks={subs}
        drag={selectionMode || !drag || upcomingTaskIds.has(item.task.id) ? undefined : drag}
        isActive={isActive}
        selectionMode={selectionMode}
        selected={selectedIds.has(item.task.id)}
        onLongPress={() => enterSelection(item.task.id)}
        onSelect={() => toggleSelection(item.task.id)}
        hideTodayLabel
      />
    );
    return drag ? <ScaleDecorator>{taskNode}</ScaleDecorator> : taskNode;
  };

  const emptyComponent = (
    <View style={styles.empty}>
      <Ionicons name="checkmark-circle" size={52} color={colors.bgQuaternary} />
      <Text style={styles.emptyText}>All clear</Text>
      <Text style={styles.emptySubtext}>
        {activeFilterCount > 0 ? 'No tasks match these filters' : 'Nothing to do right now'}
      </Text>
    </View>
  );

  const today = format(new Date(), 'EEEE, MMMM d');

  const SEG_LABELS: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

  const laterGroupKeys = (task: Task): string[] => {
    const visibleAt = getVisibleAt(task);
    const dayLabel = formatGroupHeader(visibleAt.toISOString());
    if (task.timeSegments.length > 0) {
      return task.timeSegments.map(seg => `${dayLabel} — ${SEG_LABELS[seg]}`);
    }
    return [dayLabel];
  };

  const laterSections = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    [...deferredTasks]
      .sort((a, b) => getVisibleAt(a).getTime() - getVisibleAt(b).getTime())
      .forEach(task => {
        for (const key of laterGroupKeys(task)) {
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(task);
        }
      });
    return Array.from(grouped.entries()).map(([title, data]) => ({ title, data }));
  }, [deferredTasks]);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          {viewMode === 'today' && <Text style={styles.dateLabel}>{today}</Text>}
          <Text style={styles.title}>
            {viewMode === 'today' ? 'Today' : 'Later'}
          </Text>
        </View>
        <View style={styles.headerButtons}>
          {viewMode === 'today' && focusedTasks.length === 0 && upcomingTodayTasks.length > 0 && (
            <TouchableOpacity
              style={[styles.iconBtn, showUpcoming && styles.iconBtnAccent]}
              onPress={() => setShowUpcoming(v => !v)}
            >
              <Ionicons
                name="time-outline"
                size={18}
                color={showUpcoming ? colors.text : colors.textSecondary}
              />
              {!showUpcoming && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{upcomingTodayTasks.length}</Text>
                </View>
              )}
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
          {viewMode === 'today' && focusedTasks.length < 3 && visibleTasks.length > 0 && (
            <TouchableOpacity
              style={[styles.iconBtn, focusedTasks.length === 0 && styles.iconBtnOrange]}
              onPress={handleSuggestFocus}
              disabled={isSuggestingFocus}
              hitSlop={4}
            >
              {isSuggestingFocus
                ? <ActivityIndicator size="small" color={focusedTasks.length === 0 ? colors.text : colors.textSecondary} />
                : <Ionicons name="sparkles" size={16} color={focusedTasks.length === 0 ? colors.text : colors.textSecondary} />
              }
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.iconBtn} onPress={() => setSettingsVisible(true)}>
            <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* View mode switcher */}
      <View style={styles.viewModePills}>
        {(['today', 'later'] as ViewMode[]).map(mode => (
          <TouchableOpacity
            key={mode}
            style={[styles.viewModePill, viewMode === mode && styles.viewModePillActive]}
            onPress={() => {
              Haptics.selectionAsync();
              setViewMode(mode);
              setExpandedTaskId(null);
              setSelectionMode(false);
              setSelectedIds(new Set());
            }}
            activeOpacity={0.7}
          >
            <Text style={[styles.viewModePillText, viewMode === mode && styles.viewModePillTextActive]}>
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
              {mode === 'later' && deferredTasks.length > 0 ? ` ${deferredTasks.length}` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>


      {expandedTaskId !== null && !selectionMode && (
        <TouchableOpacity
          style={styles.focusOverlay}
          activeOpacity={1}
          onPress={() => setExpandedTaskId(null)}
        />
      )}

      <View style={[styles.listWrapper, expandedTaskId !== null && !selectionMode && styles.listWrapperElevated]}>
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
                onPress={() => {
                  if (expandedTaskId !== null && expandedTaskId !== item.id) {
                    setExpandedTaskId(null);
                    return;
                  }
                  setExpandedTaskId(prev => prev === item.id ? null : item.id);
                }}
                expanded={expandedTaskId === item.id}
                spotlightDisabled={expandedTaskId !== null && expandedTaskId !== item.id && !selectionMode}
                onEdit={() => openEditor(item)}
                subtaskCount={subs.length}
                subtaskDoneCount={subs.filter(t => t.completed).length}
                subtasks={subs}
                selectionMode={selectionMode}
                selected={selectedIds.has(item.id)}
                onLongPress={() => enterSelection(item.id)}
                onSelect={() => toggleSelection(item.id)}
                hideTodayLabel
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

      {viewMode === 'today' && focusedTasks.length > 0 && (
        <FlatList
          data={data}
          keyExtractor={listItemKey}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => renderItem({ item })}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.textSecondary}
            />
          }
          ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
          onScrollBeginDrag={() => setExpandedTaskId(null)}
        />
      )}

      {viewMode === 'today' && focusedTasks.length === 0 && (
        <DraggableFlatList
          data={draggableData}
          keyExtractor={listItemKey}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={renderItem as any}
          onDragBegin={() => {
            setExpandedTaskId(null);
          }}
          onDragEnd={({ data: reordered }) => {
            // The draggable list only ever contains header + task items.
            const dropped = reordered.filter(
              (item): item is { type: 'header'; label: string } | { type: 'task'; task: Task } =>
                item.type === 'header' || item.type === 'task',
            );
            const { taskIds, categoryUpdates, settled } = resolveDrop(dropped, {
              isUpcoming: id => upcomingTaskIds.has(id),
              showUpcoming,
            });

            // Show the final grouped layout immediately. It's rebuilt the same
            // way `data` is, so the store-driven resync that follows is a
            // structural no-op which justDroppedRef skips — keeping the list
            // array stable across the drop animation so the dropped cell can't
            // get stranded in a slot you can't tap.
            justDroppedRef.current = true;
            setDraggableData(settled);

            reorderWithCategoryUpdates(taskIds, categoryUpdates);
          }}
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
      </View>

      {viewMode === 'today' && (
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + 64 }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setQuickAddVisible(true);
          }}
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
          totalCount={viewMode === 'later' ? deferredTasks.length : filtered.length}
          existingTags={allTags}
          onComplete={() => { bulkCompleteTasks(Array.from(selectedIds)); exitSelection(); }}
          onDelete={() => { bulkDeleteTasks(Array.from(selectedIds)); exitSelection(); }}
          onDefer={date => { bulkDefer(Array.from(selectedIds), date); exitSelection(); }}
          onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
          onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
          onSelectAll={() => setSelectedIds(new Set(
            viewMode === 'later' ? deferredTasks.map(t => t.id) : filtered.map(t => t.id)
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
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm, paddingTop: spacing.xs,
  },
  dateLabel: { color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.medium, letterSpacing: 0.3, marginBottom: 2 },
  title: { color: colors.text, fontSize: font.xxl, fontWeight: fontWeight.bold, lineHeight: lineHeight.xxl, letterSpacing: -0.5 },
  headerButtons: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingBottom: 2 },
  clearBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgSecondary,
  },
  clearText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  selectBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.accent,
  },
  selectText: { color: colors.text, fontSize: font.sm, fontWeight: fontWeight.semibold },
  viewModePills: {
    flexDirection: 'row', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingBottom: 4,
  },
  viewModePill: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: radius.full, backgroundColor: colors.bgSecondary,
  },
  viewModePillActive: { backgroundColor: colors.accent },
  viewModePillText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  viewModePillTextActive: { color: colors.text, fontWeight: fontWeight.semibold },
  iconBtn: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.bgSecondary,
    alignItems: 'center', justifyContent: 'center',
  },
  iconBtnActive: { backgroundColor: colors.bgTertiary },
  iconBtnAccent: { backgroundColor: colors.accent },
  iconBtnOrange: { backgroundColor: colors.orange },
  badge: {
    position: 'absolute', top: -3, right: -3,
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: colors.text, fontSize: 9, fontWeight: '700' },
  sectionHeader: {
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  sectionHeaderText: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  focusSectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  focusSectionTitleRow: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
  },
  focusSectionTitle: {
    color: colors.orange, fontSize: font.xs, fontWeight: fontWeight.semibold,
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  restSectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  restCount: {
    color: colors.textTertiary, fontSize: font.xs, fontWeight: fontWeight.medium,
    marginLeft: 2,
  },
  emptyContainer: { flexGrow: 1 },
  listContent: { paddingTop: spacing.sm, paddingBottom: 20 },
  listFooter: { height: 120 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  emptyText: { color: colors.textSecondary, fontSize: font.lg, fontWeight: fontWeight.semibold },
  emptySubtext: { color: colors.textTertiary, fontSize: font.sm, textAlign: 'center', paddingHorizontal: spacing.xl, lineHeight: lineHeight.sm },
  listWrapper: { flex: 1 },
  listWrapperElevated: { zIndex: 10 },
  focusOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 5,
  },
  fab: {
    position: 'absolute', right: spacing.lg,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 8,
  },
  filterBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing.md, paddingVertical: 2, gap: spacing.sm,
  },
  filterChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: spacing.md, paddingVertical: 7,
    borderRadius: radius.full, backgroundColor: colors.bgTertiary,
  },
  filterChipActive: { backgroundColor: colors.accent },
  filterDot: { width: 6, height: 6, borderRadius: radius.full },
  filterChipText: { color: colors.textSecondary, fontSize: font.sm, fontWeight: fontWeight.medium },
  filterChipTextActive: { color: colors.text, fontWeight: fontWeight.semibold, letterSpacing: 0.1 },
});
