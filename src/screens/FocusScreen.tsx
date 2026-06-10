import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import DraggableFlatList, { ScaleDecorator, RenderItemParams } from 'react-native-draggable-flatlist';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { FocusSelector } from '../components/FocusSelector';
import { BulkActionBar } from '../components/BulkActionBar';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { PressableScale } from '../components/PressableScale';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, radius, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import type { Task } from '../types';

export function FocusScreen() {
  const insets = useSafeAreaInsets();
  const focusedTasks = useTaskStore(useShallow(s => s.focusedTasks()));
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const clearAllFocus = useTaskStore(s => s.clearAllFocus);
  const reorderTasks = useTaskStore(s => s.reorderTasks);
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkDeleteTasks = useTaskStore(s => s.bulkDeleteTasks);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkDefer = useTaskStore(s => s.bulkDefer);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [selectorVisible, setSelectorVisible] = useState(false);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const openEditor = (task: Task) => {
    setEditingTask(task);
    setEditorVisible(true);
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader
        title="Focus"
        subtitle={focusedTasks.length > 0 ? `${focusedTasks.length} task${focusedTasks.length !== 1 ? 's' : ''}` : undefined}
        right={
          <>
            {focusedTasks.length > 0 && (
              <PressableScale
                style={styles.clearBtn}
                haptic
                onPress={() => {
                  animateLayout();
                  clearAllFocus();
                }}
              >
                <Text style={styles.clearText}>Clear</Text>
              </PressableScale>
            )}
            <PressableScale style={styles.selectBtn} haptic onPress={() => setSelectorVisible(true)}>
              <Ionicons name="add" size={16} color={colors.onAccent} />
              <Text style={styles.selectText}>Select</Text>
            </PressableScale>
          </>
        }
      />

      {expandedTaskId !== null && !selectionMode && (
        <TouchableOpacity
          style={styles.focusOverlay}
          activeOpacity={1}
          onPress={() => setExpandedTaskId(null)}
        />
      )}

      <View
        style={[styles.listWrapper, expandedTaskId !== null && !selectionMode && styles.listWrapperElevated]}
        // The list sits above the spotlight overlay, so the overlay can't see
        // taps here — catch any touch in the list area instead. The expanded
        // card stops propagation so its own controls keep working.
        onTouchEnd={expandedTaskId !== null && !selectionMode ? () => setExpandedTaskId(null) : undefined}
      >
        {focusedTasks.length === 0 ? (
          <EmptyState
            icon="star"
            title="No focus set"
            subtitle={'Tap "Select" to pick a few tasks to focus on.\nOr star any task from the Today list.'}
            actionLabel="Select tasks"
            onAction={() => setSelectorVisible(true)}
          />
        ) : (
          <DraggableFlatList
            data={focusedTasks}
            keyExtractor={t => t.id}
            onDragEnd={({ data: reordered }) => reorderTasks(reordered.map((t: Task) => t.id))}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={styles.listContent}
            ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
            ListFooterComponentStyle={styles.listFooterCell}
            onScrollBeginDrag={() => setExpandedTaskId(null)}
            renderItem={({ item, drag, isActive }: RenderItemParams<Task>) => {
              const subs = allTasks.filter(t => t.parentId === item.id);
              return (
                <ScaleDecorator>
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
                    drag={selectionMode ? undefined : drag}
                    isActive={isActive}
                    selectionMode={selectionMode}
                    selected={selectedIds.has(item.id)}
                    onLongPress={() => enterSelection(item.id)}
                    onSelect={() => toggleSelection(item.id)}
                  />
                </ScaleDecorator>
              );
            }}
          />
        )}
      </View>

      <FocusSelector
        visible={selectorVisible}
        onClose={() => setSelectorVisible(false)}
      />

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        onClose={() => setEditorVisible(false)}
      />

      {selectionMode && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          totalCount={focusedTasks.length}
          existingTags={allTags}
          onComplete={() => { bulkCompleteTasks(Array.from(selectedIds)); exitSelection(); }}
          onDelete={() => { bulkDeleteTasks(Array.from(selectedIds)); exitSelection(); }}
          onDefer={date => { bulkDefer(Array.from(selectedIds), date); exitSelection(); }}
          onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
          onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
          onSelectAll={() => setSelectedIds(new Set(focusedTasks.map(t => t.id)))}
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
  selectText: { color: colors.onAccent, fontSize: font.sm, fontWeight: fontWeight.semibold },
  listContent: { paddingTop: spacing.sm, paddingBottom: 20, flexGrow: 1 },
  // The footer stretches to fill any space left below the last task so a tap
  // anywhere under the list dismisses the expanded-task spotlight.
  listFooterCell: { flexGrow: 1 },
  listFooter: { flexGrow: 1, minHeight: 120 },
  listWrapper: { flex: 1 },
  listWrapperElevated: { zIndex: 10 },
  focusOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.backdrop,
    zIndex: 5,
  },
});
