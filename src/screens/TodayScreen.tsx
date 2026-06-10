import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  SectionList,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  RefreshControl,
  Alert,
  Animated,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
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
import { ReorderableList } from '../components/ReorderableList';
import { TaskEditor } from '../components/TaskEditor';
import { QuickAddModal } from '../components/QuickAddModal';
import { SortFilterSheet } from '../components/SortFilterSheet';
import { SpotlightOverlay, useSpotlightElevation } from '../components/SpotlightOverlay';
import { BulkActionBar } from '../components/BulkActionBar';
import { ScreenHeader, type ScreenHeaderAction } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, interaction, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';

type ViewMode = 'today' | 'later';

// Category section header that fades + slides in on mount, so a section created
// by a drop eases in rather than popping.
function SectionHeader({ label, styles }: { label: string; styles: ReturnType<typeof makeStyles> }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: 1, duration: 240, useNativeDriver: true }).start();
  }, [anim]);
  return (
    <Animated.View
      style={[
        styles.sectionHeader,
        { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }] },
      ]}
    >
      <Text style={styles.sectionHeaderText}>{label}</Text>
    </Animated.View>
  );
}

export function TodayScreen() {
  const insets = useSafeAreaInsets();
  const visibleTasks = useTaskStore(useShallow(s => s.visibleTasks()));
  const focusedTasks = useTaskStore(useShallow(s => s.focusedTasks()));
  const completedTasks = useTaskStore(useShallow(s => s.completedTasks()));
  const deferredTasks = useTaskStore(useShallow(s => s.deferredTasks()));
  const upcomingTodayTasks = useTaskStore(useShallow(s => s.upcomingTodayTasks()));
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
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

  // Collapse any expanded task when navigating away from this tab so it
  // isn't still expanded when the user comes back.
  useFocusEffect(
    useCallback(() => {
      return () => setExpandedTaskId(null);
    }, [])
  );

  const spotlightActive = expandedTaskId !== null && !selectionMode;
  const listElevated = useSpotlightElevation(spotlightActive);

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
    haptics.impactHeavy();
    animateLayout();
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
    animateLayout();
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
        if (restExpanded) items.push(...makeCategoryGroups(restTasks, allCategories));
      }
      return items;
    }

    const items = makeCategoryGroups(filtered, allCategories);
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
  }, [filtered, focusedTasks, restExpanded, showUpcoming, upcomingTodayTasks, filterPriorities, filterEfforts, allCategories]);

  const listItemKey = (item: ListItem): string =>
    item.type === 'focus-header' ? '__focus-header__'
    : item.type === 'rest-header' ? '__rest-header__'
    : item.type === 'header' ? `h-${item.label}`
    : item.task.id;

  // Local copy of data fed to ReorderableList. onReorder writes the settled
  // grouped layout here immediately so the list doesn't flash back to the
  // pre-drag order while the store write propagates; the effect below then
  // reconciles to the store-derived `data` on the next render.
  //
  // Both values are produced by makeCategoryGroups over the same tasks in the
  // same order, so they're structurally identical — the reconcile moves no
  // cells (no stranded drop), but it is essential: it hands the drag library a
  // fresh canonical array *after* the drop animation settles, so the library
  // can't get stuck showing its own internal drag order (e.g. a task left
  // resting above a header).
  const [draggableData, setDraggableData] = useState<ListItem[]>(data);
  useEffect(() => {
    setDraggableData(data);
  }, [data]);

  // A fast drag can cross several rows between frames; spacing the selection
  // ticks out keeps them from piling up into one long buzz.
  const lastDragHapticRef = useRef(0);
  const dragHaptic = () => {
    const now = Date.now();
    if (now - lastDragHapticRef.current < 80) return;
    lastDragHapticRef.current = now;
    haptics.tap();
  };

  const subtasksByParent = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of allTasks) {
      if (!t.parentId) continue;
      const list = map.get(t.parentId);
      if (list) list.push(t);
      else map.set(t.parentId, [t]);
    }
    return map;
  }, [allTasks]);

  const renderItem = ({ item, drag, isActive }: { item: ListItem; drag?: () => void; isActive?: boolean }) => {
    if (item.type === 'focus-header') {
      return (
        <Pressable style={styles.focusSectionHeader} onPress={() => setExpandedTaskId(null)}>
          <View style={styles.focusSectionTitleRow}>
            <Ionicons name="star" size={13} color={colors.orange} />
            <Text style={styles.focusSectionTitle}>Focus</Text>
          </View>
          <TouchableOpacity onPress={clearAllFocus} hitSlop={8}>
            <Text style={styles.clearText}>Clear</Text>
          </TouchableOpacity>
        </Pressable>
      );
    }
    if (item.type === 'rest-header') {
      return (
        <TouchableOpacity
          style={styles.restSectionHeader}
          onPress={() => {
            if (expandedTaskId !== null) {
              setExpandedTaskId(null);
              return;
            }
            setRestExpanded(e => !e);
          }}
          activeOpacity={interaction.activeOpacity}
        >
          <Text style={styles.sectionHeaderText}>Everything else</Text>
          <Ionicons name={restExpanded ? 'chevron-up' : 'chevron-down'} size={13} color={colors.textTertiary} />
        </TouchableOpacity>
      );
    }
    if (item.type === 'header') {
      // A newly-appearing category header mounts fresh (its row key is unique
      // per label) and fades/slides in instead of popping after a drop.
      // (Tapping it while a task is expanded still collapses the spotlight,
      // via the list wrapper's onTouchEnd.)
      return <SectionHeader label={item.label} styles={styles} />;
    }
    const subs = subtasksByParent.get(item.task.id) ?? [];
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
    return taskNode;
  };

  const emptyComponent = (
    <EmptyState
      icon="checkmark-circle"
      title="All clear"
      subtitle={activeFilterCount > 0 ? 'No tasks match these filters' : 'Nothing to do right now'}
    />
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

  const headerActions: ScreenHeaderAction[] = [
    ...(viewMode === 'today' && focusedTasks.length === 0 && upcomingTodayTasks.length > 0
      ? [{
          icon: 'time-outline' as const,
          onPress: () => setShowUpcoming(v => !v),
          active: showUpcoming,
          badge: showUpcoming ? undefined : upcomingTodayTasks.length,
        }]
      : []),
    ...(viewMode === 'today'
      ? [{
          icon: 'options' as const,
          onPress: () => setFilterVisible(true),
          active: activeFilterCount > 0,
          badge: activeFilterCount,
        }]
      : []),
    ...(viewMode === 'today' && focusedTasks.length < 3 && visibleTasks.length > 0
      ? [{
          icon: 'sparkles' as const,
          onPress: handleSuggestFocus,
          active: focusedTasks.length === 0,
          tint: 'orange' as const,
          disabled: isSuggestingFocus,
          loading: isSuggestingFocus,
        }]
      : []),
    { icon: 'settings-outline' as const, onPress: () => setSettingsVisible(true) },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title={viewMode === 'today' ? 'Today' : 'Later'}
        overline={viewMode === 'today' ? today : undefined}
        actions={headerActions}
      />

      {/* View mode switcher */}
      <View style={styles.viewModePills}>
        {(['today', 'later'] as ViewMode[]).map(mode => (
          <TouchableOpacity
            key={mode}
            style={[styles.viewModePill, viewMode === mode && styles.viewModePillActive]}
            onPress={() => {
              haptics.tap();
              setViewMode(mode);
              setExpandedTaskId(null);
              setSelectionMode(false);
              setSelectedIds(new Set());
            }}
            activeOpacity={interaction.activeOpacity}
          >
            <Text style={[styles.viewModePillText, viewMode === mode && styles.viewModePillTextActive]}>
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>


      <SpotlightOverlay
        visible={spotlightActive}
        onPress={() => setExpandedTaskId(null)}
      />

      <View
        style={[styles.listWrapper, listElevated && styles.listWrapperElevated]}
        // The list sits above the spotlight overlay, so the overlay can't see
        // taps here — catch any touch in the list area instead. The expanded
        // card stops propagation so its own controls keep working.
        onTouchEnd={spotlightActive ? () => setExpandedTaskId(null) : undefined}
      >
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
            <Pressable style={styles.sectionHeader} onPress={() => setExpandedTaskId(null)}>
              <Text style={styles.sectionHeaderText}>{section.title}</Text>
            </Pressable>
          )}
          stickySectionHeadersEnabled={false}
          ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
          ListFooterComponentStyle={laterSections.length === 0 ? undefined : styles.listFooterCell}
          onScrollBeginDrag={() => setExpandedTaskId(null)}
          ListEmptyComponent={
            <EmptyState
              icon="moon"
              title="Nothing deferred"
              subtitle="Swipe left on a task to defer it"
            />
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
          ListFooterComponentStyle={styles.listFooterCell}
          onScrollBeginDrag={() => setExpandedTaskId(null)}
        />
      )}

      {viewMode === 'today' && focusedTasks.length === 0 && (
        <ReorderableList
          data={draggableData}
          keyExtractor={listItemKey}
          renderItem={renderItem}
          onDragBegin={() => {
            setExpandedTaskId(null);
          }}
          onHoverChange={dragHaptic}
          placeholderStyle={styles.dropSlot}
          onReorder={reordered => {
            // The draggable list only ever contains header + task items.
            const dropped = reordered.filter(
              (item): item is { type: 'header'; label: string } | { type: 'task'; task: Task } =>
                item.type === 'header' || item.type === 'task',
            );
            const { taskIds, categoryUpdates, settled } = resolveDrop(dropped, {
              isUpcoming: id => upcomingTaskIds.has(id),
              showUpcoming,
              categoryOrder: allCategories,
            });

            // Show the final grouped layout immediately to avoid a flash; the
            // effect then reconciles to the store-derived `data` (structurally
            // identical) once the store write lands.
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
          ListFooterComponent={
            // Direct child of the scroll content (no cell wrapper), so its own
            // flexGrow stretches it; pinned when empty so the empty state
            // stays centered.
            <TouchableOpacity
              style={[styles.listFooter, filtered.length === 0 && styles.listFooterFixed]}
              activeOpacity={1}
              onPress={() => setExpandedTaskId(null)}
            />
          }
          onScrollBeginDrag={() => setExpandedTaskId(null)}
        />
      )}
      </View>

      {viewMode === 'today' && (
        <PressableScale
          style={[styles.fab, { bottom: insets.bottom + 64 }]}
          pressScale={0.9}
          onPress={() => {
            haptics.impactLight();
            setQuickAddVisible(true);
          }}
        >
          <Ionicons name="add" size={28} color={colors.onAccent} />
        </PressableScale>
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
  viewModePillTextActive: { color: colors.onAccent, fontWeight: fontWeight.semibold },
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
  emptyContainer: { flexGrow: 1 },
  listContent: { paddingTop: spacing.sm, paddingBottom: 20, flexGrow: 1 },
  // Subtle slot marking where a dragged task will land; mirrors the task
  // card's footprint (margin + radius).
  dropSlot: {
    marginHorizontal: spacing.md,
    marginVertical: 2,
    borderRadius: radius.md,
    backgroundColor: colors.bgSecondary,
    opacity: 0.55,
  },
  // The footer stretches to fill any space left below the last task so a tap
  // anywhere under the list dismisses the expanded-task spotlight.
  listFooterCell: { flexGrow: 1 },
  listFooter: { flexGrow: 1, minHeight: 120 },
  listFooterFixed: { flexGrow: 0 },
  listWrapper: { flex: 1 },
  listWrapperElevated: { zIndex: 10 },
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
