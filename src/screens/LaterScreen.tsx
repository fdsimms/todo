import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  Pressable,
  StyleSheet,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { BulkActionBar } from '../components/BulkActionBar';
import { ScreenHeader } from '../components/ScreenHeader';
import { EmptyState } from '../components/EmptyState';
import { SpotlightOverlay, useSpotlightElevation } from '../components/SpotlightOverlay';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, fontWeight, type Colors } from '../theme';
import { haptics } from '../utils/haptics';
import { animateLayout } from '../utils/layoutAnimation';
import { getVisibleAt } from '../utils/visibilityUtils';
import { formatGroupHeader } from '../utils/dateUtils';
import type { Task } from '../types';

export function LaterScreen() {
  const insets = useSafeAreaInsets();
  const deferredTasks = useTaskStore(useShallow(s => s.deferredTasks()));
  const allTasks = useTaskStore(s => s.tasks);
  const allTags = useTaskStore(useShallow(s => s.allTags()));
  const bulkCompleteTasks = useTaskStore(s => s.bulkCompleteTasks);
  const bulkDeleteTasks = useTaskStore(s => s.bulkDeleteTasks);
  const bulkSetPriority = useTaskStore(s => s.bulkSetPriority);
  const bulkDefer = useTaskStore(s => s.bulkDefer);
  const bulkAddTags = useTaskStore(s => s.bulkAddTags);
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [editorVisible, setEditorVisible] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Collapse any expanded task when navigating away from this tab so it
  // isn't still expanded when the user comes back.
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

  const SEG_LABELS: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

  const getGroupKeys = (task: Task): string[] => {
    const visibleAt = getVisibleAt(task);
    const dayLabel = formatGroupHeader(visibleAt.toISOString());
    if (task.timeSegments.length > 0) {
      return task.timeSegments.map(seg => `${dayLabel} — ${SEG_LABELS[seg]}`);
    }
    return [dayLabel];
  };

  // Group by the date (and time segment) they'll become visible
  // Tasks with multiple segments appear in each segment's group
  const grouped = new Map<string, Task[]>();
  [...deferredTasks]
    .sort((a, b) => getVisibleAt(a).getTime() - getVisibleAt(b).getTime())
    .forEach(task => {
      for (const key of getGroupKeys(task)) {
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(task);
      }
    });

  const sections = Array.from(grouped.entries()).map(([title, data]) => ({
    title,
    data,
  }));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <ScreenHeader title="Later" subtitle={`${deferredTasks.length} waiting`} />

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
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={sections.length === 0 ? styles.emptyContainer : styles.listContent}
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
              />
            );
          }}
          renderSectionHeader={({ section }) => (
            <Pressable style={styles.sectionHeader} onPress={() => setExpandedTaskId(null)}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
            </Pressable>
          )}
          stickySectionHeadersEnabled={false}
          ListFooterComponent={<TouchableOpacity style={styles.listFooter} activeOpacity={1} onPress={() => setExpandedTaskId(null)} />}
          ListFooterComponentStyle={sections.length === 0 ? undefined : styles.listFooterCell}
          onScrollBeginDrag={() => setExpandedTaskId(null)}
          ListEmptyComponent={
            <EmptyState
              icon="moon"
              title="Nothing deferred"
              subtitle="Swipe left on a task to defer it, or set a time of day in the task editor"
            />
          }
        />
      </View>

      <TaskEditor
        visible={editorVisible}
        task={editingTask}
        onClose={() => setEditorVisible(false)}
      />

      {selectionMode && (
        <BulkActionBar
          selectedCount={selectedIds.size}
          totalCount={deferredTasks.length}
          existingTags={allTags}
          onComplete={() => { bulkCompleteTasks(Array.from(selectedIds)); exitSelection(); }}
          onDelete={() => { bulkDeleteTasks(Array.from(selectedIds)); exitSelection(); }}
          onDefer={date => { bulkDefer(Array.from(selectedIds), date); exitSelection(); }}
          onAddTags={tags => { bulkAddTags(Array.from(selectedIds), tags); exitSelection(); }}
          onSetPriority={p => { bulkSetPriority(Array.from(selectedIds), p); exitSelection(); }}
          onSelectAll={() => setSelectedIds(new Set(deferredTasks.map(t => t.id)))}
          onDeselectAll={() => setSelectedIds(new Set())}
          onCancel={exitSelection}
          bottomInset={insets.bottom}
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
  // The footer stretches to fill any space left below the last task so a tap
  // anywhere under the list dismisses the expanded-task spotlight.
  listFooterCell: { flexGrow: 1 },
  listFooter: { flexGrow: 1, minHeight: 120 },
  emptyContainer: { flexGrow: 1 },
  listWrapper: { flex: 1 },
  listWrapperElevated: { zIndex: 10 },
  sectionHeader: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    backgroundColor: colors.bg,
  },
  sectionTitle: {
    color: colors.textTertiary,
    fontSize: font.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});
