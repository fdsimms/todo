import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { View, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTaskStore } from '../store/useTaskStore';
import { useTaskSelection } from '../hooks/useTaskSelection';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor, type TaskDraft } from '../components/TaskEditor';
import { QuickAddModal } from '../components/QuickAddModal';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { BulkActionBar } from '../components/BulkActionBar';
import { PressableScale } from '../components/PressableScale';
import { SpotlightOverlay, useSpotlightElevation } from '../components/SpotlightOverlay';
import { useColors } from '../theme/ThemeContext';
import { spacing, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { isInboxTask, isTaskVisible } from '../utils/visibilityUtils';
import type { Task } from '../types';

// The Inbox is a triage view of "loose" tasks — title only, no category, tag,
// date, time window, recurrence, reminder or priority (see isInboxTask). It's
// where voice-added ("Hey Siri") and quickly-jotted tasks surface for sorting.
// It's a computed lens, so a task leaves the Inbox the moment it's organized.
export function InboxScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const tabBarHeight = useBottomTabBarHeight();
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const inboxTasks = useTaskStore(useShallow(s => s.inboxTasks()));
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const allCategories = useTaskStore(useShallow(s => s.allCategories()));
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkSetWhen = useTaskStore(s => s.bulkSetWhen);
  const bulkSetCategory = useTaskStore(s => s.bulkSetCategory);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const addCategory = useTaskStore(s => s.addCategory);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [editorInitialDraft, setEditorInitialDraft] = useState<Partial<TaskDraft> | null>(null);
  const [justCreatedId, setJustCreatedId] = useState<string | null>(null);
  const justCreatedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    selectionMode,
    selectedIds,
    enterSelectionMode,
    toggleSelection,
    exitSelection,
    selectAll,
    deselectAll,
    handleBulkDelete,
  } = useTaskSelection(allTasks);
  // Extra bottom padding so the last rows aren't hidden behind the floating BulkActionBar.
  const selectionListPadding = selectionMode ? tabBarHeight + spacing.sm + bulkBarHeight + spacing.sm : undefined;

  // Collapse any expanded task when leaving the tab so it isn't still expanded
  // on return.
  useFocusEffect(
    useCallback(() => {
      return () => setExpandedTaskId(null);
    }, [])
  );

  const spotlightActive = expandedTaskId !== null && !selectionMode;
  const listElevated = useSpotlightElevation(spotlightActive);

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
  };

  useEffect(() => {
    return () => {
      if (justCreatedTimeoutRef.current) clearTimeout(justCreatedTimeoutRef.current);
    };
  }, []);

  // A task quick-added here usually stays in the Inbox (no date/tags/etc set),
  // but the picker can still send it straight to Today or Later — jump there
  // and hand off the highlight so the user can see where it landed.
  const handleTaskCreated = (task: Task) => {
    if (isInboxTask(task)) {
      if (justCreatedTimeoutRef.current) clearTimeout(justCreatedTimeoutRef.current);
      setJustCreatedId(task.id);
      justCreatedTimeoutRef.current = setTimeout(() => setJustCreatedId(null), 1200);
      return;
    }
    navigation.navigate({
      name: 'Today',
      params: {
        targetViewMode: isTaskVisible(task) ? 'today' : 'later',
        highlightTaskId: task.id,
        jump: Date.now(),
      },
    } as never);
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Inbox"
        subtitle={inboxTasks.length === 0 ? 'All sorted' : `${inboxTasks.length} to sort`}
      />

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
        <FlatList
          data={inboxTasks}
          keyExtractor={t => t.id}
          contentContainerStyle={
            inboxTasks.length === 0
              ? styles.emptyContainer
              : [styles.listContent, selectionListPadding !== undefined && { paddingBottom: selectionListPadding }]
          }
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
                onSelect={() => toggleSelection(item.id)}
                onSwipeSelect={() => { setExpandedTaskId(null); enterSelectionMode(item.id); }}
                justCreated={item.id === justCreatedId}
              />
            );
          }}
          ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
          ListFooterComponentStyle={inboxTasks.length === 0 ? undefined : styles.listFooterCell}
          ListEmptyComponent={
            <EmptyState
              icon="file-tray-outline"
              title="Inbox zero"
              subtitle="Voice-added and quick tasks land here to be sorted."
              bottomOffset={tabBarHeight}
            />
          }
        />
      </View>

      {!selectionMode && (
        <View style={[styles.fabContainer, { bottom: insets.bottom + tabBarHeight + spacing.lg }]}>
          <PressableScale
            style={styles.fab}
            pressScale={0.9}
            onPress={() => {
              haptics.impactLight();
              setQuickAddVisible(true);
            }}
            accessibilityLabel="Add task"
          >
            <Ionicons name="add" size={28} color={colors.onAccent} />
          </PressableScale>
        </View>
      )}

      <QuickAddModal
        visible={quickAddVisible}
        onClose={() => setQuickAddVisible(false)}
        onOpenFull={draft => {
          setQuickAddVisible(false);
          setEditingTask(null);
          setEditorVisible(true);
          setEditorInitialDraft(draft);
        }}
        context="inbox"
        onCreated={handleTaskCreated}
      />

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        initialDraft={editorInitialDraft}
        onClose={() => {
          setEditorVisible(false);
          setEditorInitialDraft(null);
          setExpandedTaskId(null);
        }}
      />

      {selectionMode && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          totalCount={inboxTasks.length}
          existingTags={allTags}
          existingCategories={allCategories}
          onComplete={() => { bulkCompleteTasks(Array.from(selectedIds)); exitSelection(); }}
          onDelete={handleBulkDelete}
          onSetWhen={(date, segs) => { bulkSetWhen(Array.from(selectedIds), date, segs); exitSelection(); }}
          onSetCategory={category => { bulkSetCategory(Array.from(selectedIds), category); exitSelection(); }}
          onAddCategory={addCategory}
          onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
          onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
          onSelectAll={() => selectAll(inboxTasks.map(t => t.id))}
          onDeselectAll={deselectAll}
          onCancel={exitSelection}
          bottomInset={tabBarHeight}
          onHeightChange={setBulkBarHeight}
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
  listContent: { paddingTop: spacing.sm, paddingBottom: 20, flexGrow: 1 },
  emptyContainer: { flexGrow: 1 },
  // The footer stretches to fill any space left below the last task so a tap
  // anywhere under the list dismisses the expanded-task spotlight.
  listFooterCell: { flexGrow: 1 },
  listFooter: { flexGrow: 1, minHeight: 120 },
  listWrapper: { flex: 1 },
  listWrapperElevated: { zIndex: 10 },
  fabContainer: {
    position: 'absolute', right: spacing.lg,
    zIndex: 20,
  },
  fab: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45, shadowRadius: 10, elevation: 8,
  },
});
