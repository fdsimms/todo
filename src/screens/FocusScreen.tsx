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
import * as Haptics from 'expo-haptics';
import { useTaskStore } from '../store/useTaskStore';
import { useShallow } from 'zustand/react/shallow';
import { TaskItem } from '../components/TaskItem';
import { TaskEditor } from '../components/TaskEditor';
import { FocusSelector } from '../components/FocusSelector';
import { BulkActionBar } from '../components/BulkActionBar';
import { useColors } from '../theme/ThemeContext';
import { spacing, font, radius, type Colors } from '../theme';
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Focus</Text>
          {focusedTasks.length > 0 && (
            <Text style={styles.subtitle}>{focusedTasks.length} task{focusedTasks.length !== 1 ? 's' : ''}</Text>
          )}
        </View>
        <View style={styles.headerButtons}>
          {focusedTasks.length > 0 && (
            <TouchableOpacity style={styles.clearBtn} onPress={clearAllFocus}>
              <Text style={styles.clearText}>Clear</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.selectBtn}
            onPress={() => setSelectorVisible(true)}
          >
            <Ionicons name="add" size={16} color={colors.text} />
            <Text style={styles.selectText}>Select</Text>
          </TouchableOpacity>
        </View>
      </View>

      {expandedTaskId !== null && !selectionMode && (
        <TouchableOpacity
          style={styles.focusOverlay}
          activeOpacity={1}
          onPress={() => setExpandedTaskId(null)}
        />
      )}

      <View style={[styles.listWrapper, expandedTaskId !== null && !selectionMode && styles.listWrapperElevated]}>
        {focusedTasks.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="star" size={52} color={colors.bgQuaternary} />
            <Text style={styles.emptyTitle}>No focus set</Text>
            <Text style={styles.emptyText}>
              Tap "Select" to pick a few tasks to focus on.{'\n'}
              Or star any task from the Today list.
            </Text>
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={() => setSelectorVisible(true)}
            >
              <Text style={styles.emptyBtnText}>Select tasks</Text>
            </TouchableOpacity>
          </View>
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
  header: {
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between',
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm, paddingTop: spacing.sm,
  },
  title: { color: colors.text, fontSize: font.xxl, fontWeight: '700', letterSpacing: -0.5 },
  subtitle: { color: colors.textTertiary, fontSize: font.sm, marginTop: 2 },
  headerButtons: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
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
  empty: {
    flex: 1,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.textSecondary, fontSize: font.lg, fontWeight: '600',
  },
  emptyText: {
    color: colors.textTertiary, fontSize: font.sm, textAlign: 'center', lineHeight: 21,
  },
  emptyBtn: {
    marginTop: spacing.lg, paddingHorizontal: spacing.xl, paddingVertical: 13,
    borderRadius: radius.full, backgroundColor: colors.accent,
    shadowColor: colors.accent, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 8, elevation: 6,
  },
  emptyBtnText: { color: colors.text, fontSize: font.md, fontWeight: '600' },
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
    backgroundColor: 'rgba(0,0,0,0.5)',
    zIndex: 5,
  },
});
